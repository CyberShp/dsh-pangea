// React DOM integration using the Desktop's existing happy-dom dependency.
// Unlike the browser script this runs without a native browser process.
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { FaultInjectionService, injectionGit } from '../src/fault-injection.js'
import { requireAgentModel } from '../src/agent-models.js'
import { acpSettingsRouteHandler, faultInjectionRouteHandler } from '../src/index.js'
import { createFaultInjectionBuild, createFaultInjectionHome, createFaultInjectionPanel, createFaultInjectionTaskDetail } from '../src/fault-injection-view.js'

const { Window } = await import(process.env.HAPPY_DOM_MODULE || 'happy-dom')
const window = new Window({ url: 'http://localhost/' })
for (const key of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Event', 'MouseEvent']) Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true, writable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'), { createRoot } = await import('react-dom/client'), { act } = React
const root = await mkdtemp(path.join(os.tmpdir(), 'fi-dom-')), dataRoot = path.join(root, 'data'), source = path.join(dataRoot, 'repositories', 'target'), remote = path.join(root, 'remote.git')
await mkdir(source, { recursive: true })
await injectionGit(source, ['init', '-b', 'main'])
await injectionGit(source, ['config', 'user.name', 'Fixture']); await injectionGit(source, ['config', 'user.email', 'fixture@example.test'])
await writeFile(path.join(source, 'target.c'), 'int operation(void) { return 0; }\n')
await injectionGit(source, ['add', 'target.c']); await injectionGit(source, ['commit', '-m', 'baseline'])
const base = await injectionGit(source, ['rev-parse', 'HEAD'])
await injectionGit(source, ['branch', 'personal'])
await injectionGit(root, ['init', '--bare', remote]); await injectionGit(source, ['remote', 'add', 'origin', remote])
await injectionGit(source, ['push', 'origin', 'main', 'personal'])
await mkdir(path.join(dataRoot, '.pangea', 'repository-settings'), { recursive: true })
await writeFile(path.join(dataRoot, '.pangea', 'repository-settings', 'target.json'), JSON.stringify({ personal_branch: 'personal', remote: 'origin' }))
const cases = [{ projection_id: 'unit/A', title: '资源申请失败后的恢复', instrumentation: { points: [{ id: 'A', action: '模拟资源不足' }] } }]
cases.push({ projection_id: 'unit/B', title: '第二个故障场景' })
const run = { run_id: 'dom-run', source_snapshot: { repositories: [{ repo_id: 'target', git: { commit: base } }] }, details: { test_cases: cases } }
await mkdir(path.join(dataRoot, 'runs', run.run_id), { recursive: true })
await writeFile(path.join(dataRoot, 'runs', run.run_id, 'progress.json'), JSON.stringify({ model_settings: { provider: 'pangea-nga' }, model_id: 'fixture-model' }))
await mkdir(path.join(root, '.agents', 'pangea'), { recursive: true })
await writeFile(path.join(root, '.agents', 'pangea', 'dsh.md'), '# fixture')
const provider = { discoverModels: async () => ({ current_model: 'fixture-model', models: [{ id: 'fixture-model' }] }) }
const runtime = { subagents: { getProvider: () => provider } }
let holdPush = true
const service = new FaultInjectionService({ validateModel: options => requireAgentModel(runtime, options), git: async (cwd, args, signal) => {
  if (args[0] === 'push' && holdPush) await new Promise((resolve, reject) => {
    if (signal.aborted) reject(signal.reason)
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  return injectionGit(cwd, args, signal)
}, generate: async ({ record }) => ({ summary: '工程测试夹具', points: [{ id: 'A', trigger_scope: { current_input: 'fixture operation argument', excluded_inputs: ['previous operations'] }, repo_id: 'target', path: 'target.c', action: '模拟故障', enable: 'fixture enable', disable: 'fixture disable', observe: 'hit:A' }],
  profiles: record.case_keys.map(case_key => ({ case_key, point_ids: ['A'], safety: { setup: [':'], negative_steps: [':'], negative_point_ids: ['A'], cleanup: [':'], cleanup_verify: [':'] }, steps: ['开启 A', '执行业务', '关闭 A 并恢复'] })), edits: [{ repo_id: 'target', path: 'target.c', before: 'return 0;', after: 'return -1;' }] }) })
const calls = []
let runReadable = true
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url, 'http://localhost')
  const req = Readable.from(options.body ? [Buffer.from(options.body)] : [])
  req.url = url; req.method = options.method || 'GET'; req.headers = { 'sec-fetch-site': 'same-origin' }
  let status, response
  if (parsed.pathname.endsWith('/acp-settings')) {
    await acpSettingsRouteHandler(req, { on() {}, once() {}, off() {}, removeListener() {}, writeHead(code) { status = code }, end(body) { response = body } }, {}, runtime)
    return new Response(response, { status, headers: { 'content-type': 'application/json' } })
  }
  if (options.body) calls.push(JSON.parse(options.body))
  await faultInjectionRouteHandler(req, { writeHead(code) { status = code }, end(body) { response = body } }, service, runtime, { resolveRoot: async () => dataRoot, readRun: async () => { if (!runReadable) throw new Error('fixture Run read failure'); return run } })
  return new Response(response, { status, headers: { 'content-type': 'application/json' } })
}
const container = document.createElement('div'); document.body.append(container)
let renderer = createRoot(container)
const openedPipelines = []
const Panel = createFaultInjectionPanel(React), Detail = createFaultInjectionTaskDetail(React), Home = createFaultInjectionHome(React), Build = createFaultInjectionBuild(React)
const Harness = () => {
  const [view, setView] = React.useState({ mode: 'panel' })
  if (view.mode === 'build') {
    return React.createElement(Build, {
      dataRoot,
      cwd: root,
      initialItems: view.initialItems,
      onOpenPipeline: url => openedPipelines.push(url),
      onOpenTask: task => setView({ mode: 'detail', task }),
    })
  }
  if (view.mode === 'detail') {
    return React.createElement(Detail, {
      key: view.task.id,
      runId: view.task.run_id || run.run_id,
      taskId: view.task.id,
      dataRoot,
      cwd: root,
      onSwitch: task => setView({ mode: 'detail', task }),
      onOpenBuild: item => setView({ mode: 'build', initialItems: [item] }),
    })
  }
  return React.createElement(Panel, { runId: run.run_id, dataRoot, cwd: root, cases, onCreated: task => setView({ mode: 'detail', task }) })
}
const render = async () => act(async () => { renderer.render(React.createElement(Harness)) })
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
  await until(() => button('生成打桩修改（2 条用例）') && !button('生成打桩修改（2 条用例）').disabled)
  await click('生成打桩修改（2 条用例）')
  await until(() => button('加入出包 / 推送个人分支'))
  assert.match(container.textContent, /逐用例执行说明/)
  assert.equal(calls[0].cwd, root)
  assert.deepEqual(calls[0].case_keys, ['unit/A', 'unit/B'])
  await click('加入出包 / 推送个人分支')
  await until(() => button('合成并推送到个人分支（1 个任务）'))
  assert.equal(button('合成并推送到个人分支（1 个任务）').disabled, true)
  await change('问题单号', 'DTS2026111111059')
  await change('修改人', 'h00600350')
  await change('审核人', 'h00600350')
  await until(() => !button('合成并推送到个人分支（1 个任务）').disabled)
  await change('构建流水线 URL', 'https://ci.example.test/pipeline')
  assert.equal(button('在 DSH 浏览器打开构建流水线'), undefined)
  await click('合成并推送到个人分支（1 个任务）')
  await until(() => button('停止本次出包') && !button('停止本次出包').disabled)
  await click('停止本次出包')
  await until(() => button('重试本次出包'))
  holdPush = false
  await click('重试本次出包')
  await until(() => container.textContent.includes('个人分支已推送'))
  await click('在 DSH 浏览器打开构建流水线')
  assert.deepEqual(openedPipelines, ['https://ci.example.test/pipeline'])
  await change('构建流水线 URL', 'https://ci.example.test/updated')
  assert.equal(button('在 DSH 浏览器打开构建流水线').disabled, true)
  await click('保存流水线地址')
  await until(() => !button('在 DSH 浏览器打开构建流水线').disabled)
  await click('在 DSH 浏览器打开构建流水线')
  assert.equal(openedPipelines.at(-1), 'https://ci.example.test/updated')
  await click('资源申请失败后的恢复')
  await until(() => container.querySelector('[aria-label="构建链接"]'))
  await change('构建链接', 'https://ci.example.test/1')
  await change('个人包名称或版本', 'personal-001.zip')
  await change('实际结果', 'passed')
  await change('桩点实际命中', 'A=1')
  await change('验证现象与记录', '撤桩后恢复正常')
  await change('验证用例', 'unit/B')
  assert.equal(container.querySelector('[aria-label="实际结果"]').value, 'not_run')
  assert.equal(container.querySelector('[aria-label="验证现象与记录"]').value, '')
  await change('验证现象与记录', 'B 的独立草稿')
  await change('验证用例', 'unit/A')
  assert.equal(container.querySelector('[aria-label="实际结果"]').value, 'passed')
  assert.equal(container.querySelector('[aria-label="验证现象与记录"]').value, '撤桩后恢复正常')
  await click('保存构建与验证记录')
  await until(() => container.textContent.includes('通过 · A=1'))
  const task = (await service.list(dataRoot, run.run_id))[0]
  const builds = await service.listBuilds(dataRoot)
  assert.equal(task.verification[0].result, 'passed')
  assert.equal(task.build.package_id, 'personal-001.zip')
  assert.equal(task.verification[0].hits, 'A=1')
  assert.equal(task.verification[0].build.build_id, builds[0].id)
  assert.equal(task.verification[0].build.commits[0].commit, builds[0].repositories[0].commit)
  assert.equal(await injectionGit(remote, ['rev-parse', 'refs/heads/personal']), builds[0].repositories[0].commit)
  assert.match(await injectionGit(remote, ['log', '-1', '--format=%B', 'refs/heads/personal']), /【问题单号\/AR\/STORY\/CR】：DTS2026111111059\n【修改人】：h00600350\n【审核人】：h00600350\n【修改说明】：合成打桩：/)
  assert.equal(await injectionGit(source, ['rev-parse', 'HEAD']), base)
  // Reopen from the global list while Run reads fail: list and detail only read task.json and build.json.
  runReadable = false
  await act(async () => renderer.unmount()); renderer = createRoot(container)
  const Reopen = () => {
    const [opened, setOpened] = React.useState(null)
    return opened
      ? React.createElement(Detail, { runId: opened.run_id, taskId: opened.id, dataRoot, cwd: root, onSwitch: setOpened })
      : React.createElement(Home, { dataRoot, cwd: root, analysisLabel: id => `label:${id}`, onOpen: setOpened, onCreate: () => {} })
  }
  await act(async () => { renderer.render(React.createElement(Reopen)) })
  await until(() => button(task.name || '资源申请失败后的恢复'))
  assert.match(container.textContent, /label:dom-run/)
  assert.match(container.textContent, /1\/2 通过/)
  assert.match(container.textContent, /已推送/)
  await click(task.name || '资源申请失败后的恢复')
  await until(() => container.querySelector('[aria-label="个人包名称或版本"]'))
  assert.equal(container.querySelector('[aria-label="新建打桩步骤"]'), null)
  assert.match(container.textContent, /撤桩后恢复正常/)
  assert.equal(container.querySelector('[aria-label="个人包名称或版本"]').value, 'personal-001.zip')
  assert.ok(![...container.querySelectorAll('button')].some(node => node.textContent.includes('导出')))
  console.log('PASS: React DOM → real route → generate → task detail → synthesis build stop/retry/push → saved build/verification → reopened from the global list with Run reads failing. External model is a fixture; native browser not used.')
} finally {
  await act(async () => renderer.unmount()); await service.dispose(); await window.happyDOM.abort(); await rm(root, { recursive: true, force: true })
}
