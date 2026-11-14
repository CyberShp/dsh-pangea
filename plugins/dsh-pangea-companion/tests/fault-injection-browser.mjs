// Real React + HTTP + Git round trip. The external model is a deterministic
// fixture; no product hardware, credentials or CI pipeline are used.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import { FaultInjectionService, injectionGit } from '../src/fault-injection.js'
import { faultInjectionRouteHandler } from '../src/index.js'

const require = createRequire(import.meta.url)
const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-fi-browser-'))
const dataRoot = path.join(root, 'data'), source = path.join(dataRoot, 'repositories', 'target'), remote = path.join(root, 'target.git')
await mkdir(source, { recursive: true })
await injectionGit(source, ['init', '-b', 'main'])
await injectionGit(source, ['config', 'user.name', 'Fixture'])
await injectionGit(source, ['config', 'user.email', 'fixture@example.test'])
await writeFile(path.join(source, 'target.c'), 'int allocate(void) { return 0; }\n')
await injectionGit(source, ['add', 'target.c'])
await injectionGit(source, ['commit', '-m', 'baseline'])
const base = await injectionGit(source, ['rev-parse', 'HEAD'])
await injectionGit(root, ['init', '--bare', remote])
await injectionGit(source, ['remote', 'add', 'origin', remote])
const run = { run_id: 'browser-run', source_snapshot: { repositories: [{ repo_id: 'target', git: { commit: base } }] },
  details: { test_cases: [{ projection_id: 'unit/allocation', title: '队列资源申请失败后的恢复', instrumentation: { points: [{ id: 'queue-fail', repo_id: 'target', path: 'target.c', action: '资源申请失败' }] } }] } }
await mkdir(path.join(dataRoot, 'runs', run.run_id), { recursive: true })
await writeFile(path.join(dataRoot, 'runs', run.run_id, 'progress.json'), JSON.stringify({ model_settings: { provider: 'fixture' }, model_id: 'fixture-model' }))
const service = new FaultInjectionService({ generate: async ({ record }) => ({
  summary: '为所选队列增加一次性资源申请失败注入。',
  points: [{ id: 'queue-fail', case_keys: record.case_keys, repo_id: 'target', path: 'target.c', action: '模拟一次资源申请失败', trigger: '创建测试队列时', times: 1,
    enable: '测试夹具开启 queue-fail', disable: '测试夹具关闭 queue-fail', observe: '检查 queue-fail 命中次数', cleanup: '重新建立测试队列', depends_on: [], exclusive_with: [] }],
  profiles: record.case_keys.map(case_key => ({ case_key, point_ids: ['queue-fail'], steps: ['开启目标桩', '创建测试队列并检查失败上报', '撤桩后重新创建队列'] })),
  edits: [{ repo_id: 'target', path: 'target.c', before: 'return 0;', after: 'return -1; /* browser fixture */' }], limitations: ['此处为浏览器工程测试夹具，不用于产品验证。'],
}) })
const assets = {
  '/react.js': path.join(path.dirname(require.resolve('react/package.json')), 'umd', 'react.development.js'),
  '/react-dom.js': path.join(path.dirname(require.resolve('react-dom/package.json')), 'umd', 'react-dom.development.js'),
  '/panel.js': new URL('../src/fault-injection-view.js', import.meta.url),
}
const server = createServer(async (req, res) => {
  try {
    if (assets[req.url]) { res.writeHead(200, { 'content-type': 'text/javascript;charset=utf-8' }); res.end(await readFile(assets[req.url])); return }
    if (req.url.startsWith('/api/')) {
      await faultInjectionRouteHandler(req, res, service, {}, { resolveRoot: async () => dataRoot, readRun: async () => run }); return
    }
    res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' })
    res.end(`<!doctype html><html lang="zh"><meta charset="utf-8"><title>用例打桩工作区</title><style>body{font:15px system-ui;background:#f5f7fb;color:#19243b;margin:32px}main{max-width:1040px;margin:auto}.b05-card{padding:24px;border:1px solid #e2e7ef;border-radius:16px;background:white}.b05-head-actions{display:flex;gap:12px;align-items:center}.b05-subtle{color:#66758b}button,input,textarea,select{font:inherit;padding:9px;border:1px solid #cfd7e5;border-radius:7px}button{cursor:pointer;background:white}.primary{background:#3157d5;color:white}dt{font-weight:600}dd{margin:4px 0 12px}summary{cursor:pointer;padding:12px 0}label select{display:block;width:100%;margin-top:6px}pre{white-space:pre-wrap}</style><main><h1>队列资源申请失败后的恢复</h1><div id="app"></div></main><script src="/react.js"></script><script src="/react-dom.js"></script><script type="module">import {createFaultInjectionPanel} from '/panel.js'; const Panel=createFaultInjectionPanel(React); ReactDOM.createRoot(document.getElementById('app')).render(React.createElement(Panel,${JSON.stringify({ runId: run.run_id, dataRoot, cases: run.details.test_cases })}));</script></html>`)
  } catch (error) { res.writeHead(500); res.end(error.message) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await playwright.chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) })
  const page = await browser.newPage({ viewport: { width: 1365, height: 1000 } }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  await page.getByRole('button', { name: '打开打桩工作区' }).click()
  await page.getByLabel('打桩模型').waitFor()
  await page.getByRole('button', { name: '生成打桩修改（1 条用例）' }).click()
  await page.getByRole('button', { name: '推送个人分支', exact: true }).waitFor({ timeout: 20000 })
  assert.match(await page.locator('[data-testid="fault-injection-panel"]').innerText(), /逐用例执行说明/)
  await page.getByRole('button', { name: '推送个人分支', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '个人分支已推送' }).waitFor()
  await page.getByLabel('构建链接', { exact: true }).fill('https://ci.example.test/build/001')
  await page.getByLabel('个人包名称或版本').fill('personal-001.zip')
  await page.getByLabel('实际结果').selectOption('passed')
  await page.getByLabel('桩点实际命中').fill('queue-fail=1')
  await page.getByLabel('验证现象与记录').fill('失败上报正确，撤桩后队列重建成功。')
  await page.getByRole('button', { name: '保存构建与验证记录' }).click()
  await page.getByText(/通过 · queue-fail=1/).waitFor()
  const stored = (await service.list(dataRoot, run.run_id))[0]
  assert.equal(stored.verification[0].result, 'passed')
  assert.equal(await injectionGit(remote, ['rev-parse', `refs/heads/${stored.branch}`]), stored.repositories[0].commit)
  await page.reload(); await page.getByRole('button', { name: '打开打桩工作区' }).click()
  await page.getByLabel('已有打桩任务').selectOption(stored.id)
  await page.getByText(/通过 · queue-fail=1/).waitFor()
  assert.equal(await page.getByLabel('个人包名称或版本').inputValue(), 'personal-001.zip')
  assert.equal(await page.getByRole('button', { name: /导出/ }).count(), 0)
  await page.screenshot({ path: process.env.INJECTION_SCREENSHOT || path.join(root, 'injection.png'), fullPage: true })
  assert.deepEqual(errors, [])
  console.log('PASS: real browser selected case → generated diff → pushed Git branch → recorded build and result → reopened persisted task; no export control or browser errors.')
} finally {
  await browser?.close(); await service.dispose(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true })
}
