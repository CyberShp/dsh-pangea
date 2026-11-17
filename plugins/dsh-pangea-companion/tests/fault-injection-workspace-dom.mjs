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
import { createFaultInjectionPanel } from '../src/fault-injection-view.js'

const { Window } = await import(process.env.HAPPY_DOM_MODULE || 'happy-dom')
const window = new Window({ url: 'http://localhost/' })
for (const key of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Event', 'CustomEvent', 'MouseEvent']) Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true, writable: true })
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
  await injectionGit(source, ['push', 'origin', 'main'])
  await mkdir(path.join(dataRoot, '.pangea', 'repository-settings'), { recursive: true })
  await writeFile(path.join(dataRoot, '.pangea', 'repository-settings', 'target.json'), JSON.stringify({ personal_branch: 'main', remote: 'origin' }))
const cases = [{ projection_id: 'unit/A', title: '资源申请失败后的恢复', instrumentation: { points: [{ id: 'A', action: '模拟资源不足' }] } }]
cases.push({ projection_id: 'unit/B', title: '第二个故障场景', execution_readiness: 'needs_instrumentation' })
cases.push({ projection_id: 'unit/C', title: '未标记按需打桩用例', preconditions: ['模拟内存分配失败'] })
cases.push({ projection_id: 'unit/D', title: '常规业务校验路径' })
const run = { run_id: 'dom-run', source_snapshot: { repositories: [{ repo_id: 'target', git: { commit: base } }] }, details: { test_cases: cases } }
await mkdir(path.join(dataRoot, 'runs', run.run_id), { recursive: true })
await writeFile(path.join(dataRoot, 'runs', run.run_id, 'progress.json'), JSON.stringify({ model_settings: { provider: 'pangea-nga' }, model_id: 'fixture-model' }))
await writeFile(path.join(source, 'developer.txt'), 'existing developer commit')
await injectionGit(source, ['add', 'developer.txt']); await injectionGit(source, ['commit', '-m', 'unpublished developer work'])
const developerHead = await injectionGit(source, ['rev-parse', 'HEAD'])
await mkdir(path.join(root, '.agents', 'pangea'), { recursive: true })
await writeFile(path.join(root, '.agents', 'pangea', 'dsh.md'), '# fixture')
const provider = { discoverModels: async () => ({ current_model: 'fixture-model', models: [{ id: 'fixture-model' }] }) }
const runtime = { subagents: { getProvider: () => provider } }
let holdPush = true, failCheckout = false
const service = new FaultInjectionService({ validateModel: options => requireAgentModel(runtime, options), git: async (cwd, args, signal) => {
  if (args[0] === 'checkout' && failCheckout) throw new Error('error: unable to create file nested/header.h: Filename too long')
  if (args[0] === 'push' && holdPush) await new Promise((resolve, reject) => {
    if (signal.aborted) reject(signal.reason)
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  return injectionGit(cwd, args, signal)
}, generate: async ({ record }) => ({ summary: '工程测试夹具', points: [{ id: 'A', repo_id: 'target', path: 'target.c', action: '模拟故障', enable: 'fixture enable', disable: 'fixture disable', observe: 'hit:A' }],
  profiles: record.case_keys.map(case_key => ({ case_key, point_ids: ['A'], steps: ['开启 A', '执行业务', '关闭 A 并恢复'] })), edits: [{ repo_id: 'target', path: 'target.c', before: 'return 0;', after: 'return -1;' }] }) })
const run2 = { ...run, run_id: 'dom-run-2', details: { test_cases: [{ projection_id: 'unit/A', title: '乙任务用例', execution_readiness: 'needs_instrumentation' }] } }
await mkdir(path.join(dataRoot, 'runs', run2.run_id), { recursive: true })
await writeFile(path.join(dataRoot, 'runs', run2.run_id, 'progress.json'), JSON.stringify({ model_settings: { provider: 'pangea-nga' }, model_id: 'fixture-model' }))
const tasks = [{ task_id: 'a', title: '任务甲', run_id: run.run_id, data_root: dataRoot }, { task_id: 'b', title: '任务乙', run_id: run2.run_id, data_root: dataRoot }]
const calls = []
globalThis.fetch = async (url, options = {}) => {
  const query = new URL(url, 'http://localhost'); const selected = query.searchParams.get('run_id') === run2.run_id ? run2 : run
  if (query.pathname.endsWith('/workbench')) return Response.json({ status: 'ok', data_root: dataRoot, tasks: { items: tasks }, compatibility: { compatible: true } })
  if (query.pathname.endsWith('/state')) return Response.json({ status: 'ok', data_root: dataRoot, current: { ...selected, data_root: dataRoot } })
  if (query.pathname.endsWith('/acp-settings')) {
    const req = Readable.from(options.body ? [Buffer.from(options.body)] : [])
    req.url = url; req.method = options.method || 'GET'; req.headers = { 'sec-fetch-site': 'same-origin' }
    let status, response
    await acpSettingsRouteHandler(req, { on() {}, once() {}, off() {}, removeListener() {}, writeHead(code) { status = code }, end(body) { response = body } }, {}, runtime)
    return new Response(response, { status, headers: { 'content-type': 'application/json' } })
  }
  if (!query.pathname.endsWith('/fault-injection')) return Response.json({ status: 'ok' })
  const req = Readable.from(options.body ? [Buffer.from(options.body)] : [])
  req.url = url; req.method = options.method || 'GET'; req.headers = { 'sec-fetch-site': 'same-origin' }
  let status, response
  if (options.body) calls.push(JSON.parse(options.body))
  await faultInjectionRouteHandler(req, { writeHead(code) { status = code }, end(body) { response = body } }, service, runtime, { resolveRoot: async () => dataRoot, readRun: async (_root, runId) => runId === run2.run_id ? run2 : run })
  return new Response(response, { status, headers: { 'content-type': 'application/json' } })
}
const container = document.createElement('div'); document.body.append(container)
let renderer = createRoot(container)
const openedPipelines = []
let client
window.__ModuleLoader__ = { load: ({ factory }) => { client = factory(() => React) } }
const { runInThisContext } = await import('node:vm')
runInThisContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'))
let injectionDraft = { requestId: 0, caseKeys: [] }
const injectionListeners = new Set()
const pages = [], ctx = { effect: fn => fn(), pangea: {
  registerPage: page => pages.push(page),
  getInjectionDraft: () => injectionDraft,
  subscribeInjectionDraft: fn => { injectionListeners.add(fn); return () => injectionListeners.delete(fn) },
  openTool: (_scope, kind, { path: url }) => { assert.equal(kind, 'browser'); openedPipelines.push(url); return true },
} }
client.apply(ctx)
const registration = pages.find(page => page.id === 'injection')
assert.ok(registration)
const render = async () => act(async () => { renderer.render(registration.component({ scope: { cwd: root }, visible: true })) })
const button = label => [...container.querySelectorAll('button')].find(node => node.textContent === label)
const click = async label => { const node = button(label); assert.ok(node, label); assert.equal(node.disabled, false); await act(async () => { node.click() }) }
const until = async predicate => {
  for (let count = 0; count < 160; count++) {
    if (predicate()) return
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
  }
  assert.ok(predicate(), [...container.querySelectorAll('p,[role=alert]')].map(n => n.textContent).join('\n'))
}
const change = async (label, value) => {
  const element = container.querySelector(`[aria-label="${label}"]`); assert.ok(element, label)
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set
  await act(async () => { setter.call(element, value); element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
}
try {
  await render()
  await until(() => button('选择用例与查看已有打桩任务 →') || container.textContent.includes('任务甲'))
  const choose = async name => { const node = [...container.querySelectorAll('button')].find(node => node.textContent.includes(name)); assert.ok(node, name); await act(async () => node.click()) }
  await choose('任务甲')
  await until(() => container.querySelector('[aria-label="选择打桩用例 资源申请失败后的恢复"]'))
  assert.equal(button('下一步：设置与提交').disabled, true)
  const toggle = async title => act(async () => container.querySelector(`[aria-label="选择打桩用例 ${title}"]`).click())
  assert.equal(container.querySelector('[aria-label="选择打桩用例 未标记按需打桩用例"]').disabled, false)
  assert.equal(container.querySelector('[aria-label="选择打桩用例 常规业务校验路径"]').disabled, false)
  assert.match(container.textContent, /建议打桩/)
  assert.match(container.textContent, /可按需打桩/)
  await toggle('资源申请失败后的恢复')
  await change('搜索打桩用例', '第二个')
  await toggle('第二个故障场景')
  await change('搜索打桩用例', '')
  await toggle('未标记按需打桩用例')
  assert.match(container.textContent, /已选择 3 条/)
  await choose('资源申请失败后的恢复')
  assert.match(container.querySelector('[aria-label="打桩用例详情"]').textContent, /模拟资源不足/)
  await until(() => !button("下一步：设置与提交").disabled)
  await click('下一步：设置与提交')
  assert.equal(button('核对打桩基线'), undefined)
  assert.equal(container.querySelector('[aria-label="使用所选 Git 提交作为打桩基线"]'), null)
  await change('构建流水线 URL', 'https://ci.example.test/pipeline')
  await click('上一步')
  assert.match(container.textContent, /已选择 3 条/)
  await click('下一步：设置与提交')
  assert.equal(container.querySelector('[aria-label="构建流水线 URL"]').value, 'https://ci.example.test/pipeline')
  await until(() => button('生成打桩修改') && !button('生成打桩修改').disabled)
  await click('生成打桩修改')
  await until(() => button('提交并推送到 main'))
  const generate = calls.find(item => item.action === 'generate')
  assert.deepEqual(generate.case_keys, ['unit/A', 'unit/B', 'unit/C'])
  assert.equal(generate.run_id, run.run_id)
  assert.equal(container.querySelector('[aria-label="搜索打桩用例"]'), null)
  assert.equal(button('提交并推送到 main').disabled, true)
  assert.match(container.textContent, /1 个已有未推送提交/)
  assert.equal(await injectionGit(source, ['rev-parse', 'HEAD']), developerHead)
  await act(async () => container.querySelector('[aria-label="确认推送已有提交 target"]').click())
  holdPush = false
  await click('提交并推送到 main')
  await until(() => button('在 DSH 浏览器打开构建流水线'))
  await click('在 DSH 浏览器打开构建流水线')
  assert.deepEqual(openedPipelines, ['https://ci.example.test/pipeline'])
  let copiedScript = ''
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { copiedScript = text } }, configurable: true })
  await click('复制验证脚本')
  assert.match(copiedScript, /^#!\/usr\/bin\/env bash/)
  assert.match(copiedScript, /\[PANGEA_VERIFY\] case=unit\/C/)
  await change('执行日志内容', '[PANGEA_VERIFY] case=unit/C result=passed hits=A=2')
  await click('解析日志填充')
  assert.equal(container.querySelector('[aria-label="验证用例"]').value, 'unit/C')
  assert.equal(container.querySelector('[aria-label="实际结果"]').value, 'passed')
  assert.equal(container.querySelector('[aria-label="桩点实际命中"]').value, 'A=2')
  assert.ok(button('再次出桩（复用本次结果，不调用模型）'))
  assert.equal(container.textContent.includes('已保存'), false)
  await click('保存构建与验证记录')
  await until(() => container.textContent.includes('已保存'))
  const task = (await service.list(dataRoot, run.run_id))[0]
  assert.equal(task.status, 'pushed')
  assert.equal(task.verification.at(-1).case_key, 'unit/C')
  assert.equal(task.verification.at(-1).result, 'passed')
  assert.equal(task.verification.at(-1).hits, 'A=2')
  assert.equal(await injectionGit(source, ['rev-parse', 'HEAD']), task.repositories[0].commit)
  assert.equal(await injectionGit(source, ['branch', '--list', 'main_*', 'pangea-fi/*']), '')
  assert.equal(await injectionGit(remote, ['rev-parse', `refs/heads/${task.branch}`]), task.repositories[0].commit)
  await click('更换分析任务')
  await choose('任务乙')
  await until(() => container.querySelector('[aria-label="选择打桩用例 乙任务用例"]'))
  assert.equal(button('下一步：设置与提交').disabled, true)
  assert.doesNotMatch(container.textContent, /个人分支已推送/)
  await toggle('乙任务用例')
  await until(() => !button('下一步：设置与提交').disabled)
  await click('下一步：设置与提交')
  await until(() => button('生成打桩修改') && !button('生成打桩修改').disabled)
  failCheckout = true
  await click('生成打桩修改')
  await until(() => container.textContent.includes('准备源码失败，尚未开始生成打桩修改。'))
  assert.match(container.textContent, /Filename too long/)
  assert.equal(button('提交并推送到 main'), undefined)
  failCheckout = false
  await click('更换分析任务')
  await choose('任务甲')
  await until(() => button('在 DSH 浏览器打开构建流水线'))
  assert.equal(container.querySelector('[aria-label="搜索打桩用例"]'), null)
  await click('新建打桩任务')
  assert.equal(container.querySelector('[aria-label="选择打桩用例 资源申请失败后的恢复"]').checked, false)
  await act(async () => {
    injectionDraft = { requestId: 1, runId: run2.run_id, taskId: 'b', caseKeys: ['unit/A'] }
    for (const notify of injectionListeners) notify()
  })
  await until(() => container.querySelector('[aria-label="选择打桩用例 乙任务用例"]')?.checked === true)
  assert.match(container.textContent, /已选择 1 条/)
  console.log('PASS: registered injection page → select analysis task → filtered multi-selection → point details → back retains selection/settings → generate → real Git push → DSH browser callback → switch tasks isolates state → reopen persisted task → cross-page handoff pre-selects cases.')
} finally {
  await act(async () => renderer.unmount()); await service.dispose(); await rm(root, { recursive: true, force: true }); window.happyDOM.abort()
}
