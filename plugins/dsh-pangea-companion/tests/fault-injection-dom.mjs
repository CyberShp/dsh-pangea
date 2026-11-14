// React DOM integration using the Desktop's existing happy-dom dependency.
// Unlike the browser script this runs without a native browser process.
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { FaultInjectionService, injectionGit } from '../src/fault-injection.js'
import { faultInjectionRouteHandler } from '../src/index.js'
import { createFaultInjectionPanel } from '../src/fault-injection-view.js'

const { Window } = await import(process.env.HAPPY_DOM_MODULE || 'happy-dom')
const window = new Window({ url: 'http://localhost/' })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'MouseEvent']) Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true, writable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'), { createRoot } = await import('react-dom/client'), { act } = React
const root = await mkdtemp(path.join(os.tmpdir(), 'fi-dom-')), dataRoot = path.join(root, 'data'), source = path.join(dataRoot, 'repositories', 'target'), remote = path.join(root, 'remote.git')
await mkdir(source, { recursive: true })
await injectionGit(source, ['init', '-b', 'main'])
await injectionGit(source, ['config', 'user.name', 'Fixture']); await injectionGit(source, ['config', 'user.email', 'fixture@example.test'])
await writeFile(path.join(source, 'target.c'), 'int operation(void) { return 0; }\n')
await injectionGit(source, ['add', 'target.c']); await injectionGit(source, ['commit', '-m', 'baseline'])
const base = await injectionGit(source, ['rev-parse', 'HEAD'])
await injectionGit(root, ['init', '--bare', remote]); await injectionGit(source, ['remote', 'add', 'origin', remote])
const cases = [{ projection_id: 'unit/A', title: '资源申请失败后的恢复', instrumentation: { points: [{ id: 'A', action: '模拟资源不足' }] } }]
const run = { run_id: 'dom-run', source_snapshot: { repositories: [{ repo_id: 'target', git: { commit: base } }] }, details: { test_cases: cases } }
await mkdir(path.join(dataRoot, 'runs', run.run_id), { recursive: true })
await writeFile(path.join(dataRoot, 'runs', run.run_id, 'progress.json'), JSON.stringify({ model_settings: { provider: 'fixture' }, model_id: 'fixture-model' }))
const service = new FaultInjectionService({ generate: async ({ record }) => ({ summary: '工程测试夹具', points: [{ id: 'A', repo_id: 'target', path: 'target.c', action: '模拟故障', enable: 'fixture enable', disable: 'fixture disable', observe: 'hit:A' }],
  profiles: [{ case_key: record.case_keys[0], point_ids: ['A'], steps: ['开启 A', '执行业务', '关闭 A 并恢复'] }], edits: [{ repo_id: 'target', path: 'target.c', before: 'return 0;', after: 'return -1;' }] }) })
const calls = []
globalThis.fetch = async (url, options = {}) => {
  const req = Readable.from(options.body ? [Buffer.from(options.body)] : [])
  req.url = url; req.method = options.method || 'GET'; req.headers = { 'sec-fetch-site': 'same-origin' }
  let status, response
  if (options.body) calls.push(JSON.parse(options.body))
  await faultInjectionRouteHandler(req, { writeHead(code) { status = code }, end(body) { response = body } }, service, {}, { resolveRoot: async () => dataRoot, readRun: async () => run })
  return new Response(response, { status, headers: { 'content-type': 'application/json' } })
}
const container = document.createElement('div'); document.body.append(container)
let renderer = createRoot(container)
const Panel = createFaultInjectionPanel(React)
const render = async () => act(async () => { renderer.render(React.createElement(Panel, { runId: run.run_id, dataRoot, cwd: root, cases })) })
const button = label => [...container.querySelectorAll('button')].find(node => node.textContent === label)
const click = async label => { const node = button(label); assert.ok(node, label); assert.equal(node.disabled, false); await act(async () => { node.click() }) }
const until = async predicate => {
  for (let count = 0; count < 160; count++) {
    if (predicate()) return
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
  }
  assert.ok(predicate(), container.textContent)
}
const change = async (label, value) => {
  const element = container.querySelector(`[aria-label="${label}"]`); assert.ok(element, label)
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set
  await act(async () => { setter.call(element, value); element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
}
try {
  await render(); await click('打开打桩工作区')
  await until(() => button('生成打桩修改（1 条用例）'))
  await click('生成打桩修改（1 条用例）')
  await until(() => button('推送个人分支'))
  assert.match(container.textContent, /逐用例执行说明/)
  assert.equal(calls[0].cwd, root)
  assert.deepEqual(calls[0].case_keys, ['unit/A'])
  await click('推送个人分支')
  await until(() => container.textContent.includes('个人分支已推送'))
  await change('构建链接', 'https://ci.example.test/1')
  await change('个人包名称或版本', 'personal-001.zip')
  await change('实际结果', 'passed')
  await change('桩点实际命中', 'A=1')
  await change('验证现象与记录', '撤桩后恢复正常')
  await click('保存构建与验证记录')
  await until(() => container.textContent.includes('通过 · A=1'))
  const task = (await service.list(dataRoot, run.run_id))[0]
  assert.equal(task.verification[0].result, 'passed')
  assert.equal(task.build.package_id, 'personal-001.zip')
  assert.equal(task.verification[0].hits, 'A=1')
  assert.equal(await injectionGit(remote, ['rev-parse', `refs/heads/${task.branch}`]), task.repositories[0].commit)
  await act(async () => renderer.unmount()); renderer = createRoot(container)
  await render(); await click('打开打桩工作区')
  await until(() => container.querySelector('[aria-label="已有打桩任务"]'))
  await change('已有打桩任务', task.id)
  assert.match(container.textContent, /撤桩后恢复正常/)
  assert.equal(container.querySelector('[aria-label="个人包名称或版本"]').value, 'personal-001.zip')
  assert.ok(![...container.querySelectorAll('button')].some(node => node.textContent.includes('导出')))
  console.log('PASS: React DOM → real route → isolated Git commit/push → saved build/verification → reopened. External model is a fixture; native browser not used.')
} finally {
  await act(async () => renderer.unmount()); await service.dispose(); await window.happyDOM.abort(); await rm(root, { recursive: true, force: true })
}
