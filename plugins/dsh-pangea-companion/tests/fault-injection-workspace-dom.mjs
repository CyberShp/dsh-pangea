// React DOM integration using the Desktop's existing happy-dom dependency.
// Unlike the browser script this runs without a native browser process.
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtemp, mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises'
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
await writeFile(path.join(source, 'other.c'), 'int other_op(void) { return 10; }\n')
await injectionGit(source, ['add', 'target.c', 'other.c']); await injectionGit(source, ['commit', '-m', 'baseline'])
const base = await injectionGit(source, ['rev-parse', 'HEAD'])
await injectionGit(source, ['branch', 'personal'])
await injectionGit(root, ['init', '--bare', remote]); await injectionGit(source, ['remote', 'add', 'origin', remote])
await injectionGit(source, ['push', 'origin', 'main', 'personal'])
await mkdir(path.join(dataRoot, '.pangea', 'repository-settings'), { recursive: true })
await writeFile(path.join(dataRoot, '.pangea', 'repository-settings', 'target.json'), JSON.stringify({ personal_branch: 'personal', remote: 'origin' }))
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
let failCheckout = false, emitBrokenBefore = false, modelCalls = 0
const service = new FaultInjectionService({ validateModel: options => requireAgentModel(runtime, options), git: async (cwd, args, signal) => {
  if (args[0] === 'checkout' && failCheckout) throw new Error('error: unable to create file nested/header.h: Filename too long')
  return injectionGit(cwd, args, signal)
}, generate: async ({ record, outputPath }) => {
  modelCalls += 1
  const isRun2 = record.run_id === 'dom-run-2'
  const filePath = isRun2 ? 'other.c' : 'target.c'
  const pointId = isRun2 ? 'B_PT' : 'A'
  const payload = {
    summary: isRun2 ? '乙任务测试夹具' : '工程测试夹具',
    delivery: {
      mode: 'product_package',
      build_requirement: '标准产品配置即可编入',
      replace_files: [{ artifact: isRun2 ? 'libother.a' : 'libtarget.a', kind: 'static_lib', source_files: [filePath], build_evidence: 'CMakeLists.txt:1', post_replace_action: '替换静态库并重链' }],
      marker_strings: [isRun2 ? 'return -10;' : 'return -1;'],
      artifact_verify: [`grep -aFq "${isRun2 ? 'return -10;' : 'return -1;'}" ${isRun2 ? 'libother.a' : 'libtarget.a'}`],
    },
    points: [{ id: pointId, trigger_scope: { current_input: 'fixture operation argument', excluded_inputs: ['previous operations'] }, repo_id: 'target', path: filePath, action: '模拟故障', enable: 'fixture enable', disable: 'fixture disable', observe: `hit:${pointId}` }],
    profiles: record.case_keys.map(case_key => ({ case_key, point_ids: [pointId], safety: { setup: [':'], negative_steps: [':'], negative_point_ids: [pointId], cleanup: [':'], cleanup_verify: [':'] }, steps: [`开启 ${pointId}`, '', '执行业务', `关闭 ${pointId} 并恢复`] })),
    edits: [{
      repo_id: 'target',
      path: filePath,
      before: emitBrokenBefore ? 'nonexistent_symbol();' : (isRun2 ? 'return 10;' : 'return 0;'),
      after: isRun2 ? 'return -10;' : 'return -1;',
    }],
  }
  if (outputPath) await writeFile(outputPath, JSON.stringify(payload, null, 2))
  return payload
} })
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
const enabled = label => { const node = button(label); return Boolean(node && !node.disabled) }
const click = async label => { const node = button(label); assert.ok(node, label); assert.equal(node.disabled, false); await act(async () => { node.click() }) }
const until = async predicate => {
  for (let count = 0; count < 160; count++) {
    if (predicate()) return
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
  }
  assert.ok(predicate(), [...container.querySelectorAll('p,[role=alert],h3,h4')].map(n => n.textContent).join('\n'))
}
const change = async (label, value) => {
  const element = container.querySelector(`[aria-label="${label}"]`); assert.ok(element, label)
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set
  await act(async () => { setter.call(element, value); element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
}
try {
  // §7 #13: Entering 代码打桩 lands directly on FaultInjectionHome, never the wizard.
  await render()
  await until(() => container.textContent.includes('暂无打桩任务') && enabled('新建打桩任务') && enabled('合成出包'))
  assert.equal(container.querySelector('[aria-label="新建打桩步骤"]'), null)

  // Create Task 1 from 任务甲 via 3-step wizard (Step 1 → Step 2 → Step 3 设置与生成)
  await click('新建打桩任务')
  await until(() => container.textContent.includes('任务甲'))
  const choose = async name => { const node = [...container.querySelectorAll('button')].find(node => node.textContent.includes(name)); assert.ok(node, name); await act(async () => node.click()) }
  await choose('任务甲')
  await until(() => container.querySelector('[aria-label="选择打桩用例 资源申请失败后的恢复"]'))
  assert.equal(button('下一步：设置与生成').disabled, true)
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
  await until(() => enabled('下一步：设置与生成'))
  await click('下一步：设置与生成')
  assert.equal(button('核对打桩基线'), undefined)
  assert.equal(container.querySelector('[aria-label="使用所选 Git 提交作为打桩基线"]'), null)
  await click('上一步')
  assert.match(container.textContent, /已选择 3 条/)
  await click('下一步：设置与生成')
  await until(() => enabled('生成打桩修改'))
  await click('生成打桩修改')
  await until(() => enabled('加入出包 / 推送个人分支'))
  const generate = calls.find(item => item.action === 'generate')
  assert.deepEqual(generate.case_keys, ['unit/A', 'unit/B', 'unit/C'])
  assert.equal(generate.run_id, run.run_id)
  assert.ok(container.querySelector('[aria-label="安全执行流程"]'))
  for (const label of ['当前输入来源', '排除的历史与非目标输入', '准备与原状态快照', '历史与非目标输入验证', '退出清理', '独立恢复检查']) assert.ok(container.textContent.includes(label), label)
  assert.equal(container.querySelector('[aria-label="搜索打桩用例"]'), null)
  assert.equal(await injectionGit(source, ['rev-parse', 'HEAD']), developerHead)

  // Return to Home and create Task 2 from 任务乙 (exercising preparing failure + hotfix revalidate)
  await click('返回打桩任务列表')
  await until(() => container.querySelector('[aria-label="打桩任务列表"]') && enabled('合成出包（1 个可用）'))
  assert.match(container.textContent, /任务甲/)
  await click('新建打桩任务')
  await until(() => container.textContent.includes('任务乙'))
  await choose('任务乙')
  await until(() => container.querySelector('[aria-label="选择打桩用例 乙任务用例"]'))
  assert.equal(button('下一步：设置与生成').disabled, true)
  await toggle('乙任务用例')
  await until(() => enabled('下一步：设置与生成'))
  await click('下一步：设置与生成')
  await until(() => enabled('生成打桩修改'))
  failCheckout = true
  await click('生成打桩修改')
  await until(() => container.textContent.includes('准备源码失败，尚未开始生成打桩修改。') && enabled('沿用本任务配置重新生成'))
  assert.match(container.textContent, /Filename too long/)
  assert.equal(button('加入出包 / 推送个人分支'), undefined)
  failCheckout = false
  emitBrokenBefore = true
  await click('沿用本任务配置重新生成')
  await until(() => enabled('原地重新验收（不调用模型）'))
  const callsBeforeRevalidate = modelCalls
  const run2Task = (await service.list(dataRoot, run2.run_id)).find(item => item.result_saved)
  const hotfixPath = path.join(dataRoot, '.pangea', 'fault-injection', run2.run_id, run2Task.id, 'generation', 'result.json')
  const brokenPayload = JSON.parse(await readFile(hotfixPath, 'utf8'))
  brokenPayload.edits[0].before = 'return 10;'
  brokenPayload.edits[0].after = 'return -10;'
  await new Promise(resolve => setTimeout(resolve, 15))
  await writeFile(hotfixPath, JSON.stringify(brokenPayload, null, 2))
  emitBrokenBefore = false
  await click('原地重新验收（不调用模型）')
  await until(() => enabled('加入出包 / 推送个人分支'))
  assert.equal(modelCalls, callsBeforeRevalidate)
  assert.ok(calls.some(item => item.action === 'revalidate' && item.task_id === run2Task.id))

  // §7 #14: Cross-Run synthesis build + pre-receive commit gate retry + pipeline URL + default selection persistence
  const hookPath = path.join(remote, 'hooks', 'pre-receive')
  await writeFile(hookPath, [
    '#!/bin/sh',
    'set -eu',
    'RULE=\'^(\\s*【问题单号\\/AR\\/STORY\\/CR】[:：]\\s*((SR\\d{14}|AR\\d{14}|DTS\\d{13}|DTS\\d{8}\\w{11})[;；]*)+([^\\diISAD;；].*)*\\s+【修改人】[:：]\\s*.+\\s+【审核人】[:：]\\s*.+\\s+【修改说明】[:：]\\s*.+\\s*)+$\'',
    'while read oldrev newrev refname; do',
    '  full=$(git log -1 --format=%B "$newrev")',
    '  case "$full" in',
    '    *【问题单号/AR/STORY/CR】：AR2026*【修改人】：*【审核人】：*【修改说明】：*) ;;',
    '    *) printf "Commit message does not follow the pattern %s\\n" "$RULE" >&2; exit 1 ;;',
    '  esac',
    'done',
    '',
  ].join('\n'))
  await chmod(hookPath, 0o755)

  await click('加入出包 / 推送个人分支')
  await until(() => container.querySelector('[aria-label="可出包打桩任务列表"]'))
  assert.equal(container.querySelector('[aria-label="勾选出包任务 乙任务用例"]').checked, true)
  await act(async () => container.querySelector('[aria-label="勾选出包任务 资源申请失败后的恢复"]').click())
  await until(() => button('合成并推送到个人分支（2 个任务）'))
  assert.equal(button('合成并推送到个人分支（2 个任务）').disabled, true)
  assert.match(container.textContent, /请填写问题单号/)
  await change('构建流水线 URL', 'https://ci.example.test/pipeline')
  // Switch to hookless default mode to exercise remote pre-receive rejection + helper recovery
  await change('提交信息格式', 'default')
  await until(() => enabled('合成并推送到个人分支（2 个任务）'))
  await click('合成并推送到个人分支（2 个任务）')
  await until(() => enabled('重试本次出包') && enabled('按远端门禁规则填写'))
  assert.ok(container.querySelector('.pangea-fi-banner.danger details[open]'), 'push hook error details must auto-expand')
  await click('按远端门禁规则填写')
  assert.equal(button('重试本次出包').disabled, true)
  assert.match(container.textContent, /请填写问题单号/)
  assert.match(container.querySelector('[aria-label="修改说明"]').value, /^合成打桩：/)
  await change('问题单号', 'AR20269999')
  await change('修改人', 'h00111111')
  await change('审核人', 'z00222222')
  assert.equal(button('重试本次出包').disabled, true)
  assert.match(container.textContent, /不符合门禁规则.*SR\+14位数字/)
  await change('问题单号', 'AR20261118000001')
  await until(() => enabled('重试本次出包'))
  assert.match(container.querySelector('[aria-label="提交信息预览"]').textContent, /【问题单号\/AR\/STORY\/CR】：AR20261118000001\n【修改人】：h00111111\n【审核人】：z00222222\n【修改说明】：合成打桩：/)
  await click('重试本次出包')
  await until(() => enabled('在 DSH 浏览器打开构建流水线'))
  assert.equal(modelCalls, callsBeforeRevalidate)
  await click('在 DSH 浏览器打开构建流水线')
  assert.deepEqual(openedPipelines, ['https://ci.example.test/pipeline'])
  assert.match(await injectionGit(remote, ['log', '-1', '--format=%B', 'refs/heads/personal']), /【问题单号\/AR\/STORY\/CR】：AR20261118000001/)
  assert.match(await injectionGit(remote, ['show', 'refs/heads/personal:target.c']), /return -1;/)
  assert.match(await injectionGit(remote, ['show', 'refs/heads/personal:other.c']), /return -10;/)
  assert.equal(await injectionGit(source, ['rev-parse', 'HEAD']), developerHead)
  assert.equal(await injectionGit(source, ['branch', '--list', 'main_*', 'personal_*', 'pangea-fi/*']), '')

  // Re-enter 合成出包 from Home: default selection equals the 2 tasks from the latest pushed build
  await click('返回打桩任务列表')
  await until(() => enabled('合成出包（2 个可用）'))
  await click('合成出包（2 个可用）')
  await until(() => container.querySelector('[aria-label="可出包打桩任务列表"]'))
  assert.equal(container.querySelector('[aria-label="勾选出包任务 资源申请失败后的恢复"]').checked, true)
  assert.equal(container.querySelector('[aria-label="勾选出包任务 乙任务用例"]').checked, true)

  // Open Task 1 detail directly from Home, copy verification script, parse log, and save verification record
  await click('返回打桩任务列表')
  await until(() => container.querySelector('[aria-label="打桩任务列表"]'))
  await click('资源申请失败后的恢复')
  await until(() => container.querySelector('[aria-label="执行日志内容"]'))
  let copiedScript = ''
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { copiedScript = text } }, configurable: true })
  await click('复制验证脚本')
  assert.match(copiedScript, /^#!\/usr\/bin\/env bash/)
  assert.match(copiedScript, /\[PANGEA_CASE_END\] case=%s status=%s.*'unit\/C' "\$final_status"/)
  assert.match(copiedScript, /trap '__pangea_finish/)
  assert.doesNotMatch(copiedScript, /\[PANGEA_VERIFY\].*result=passed/)
  await change('执行日志内容', '[PANGEA_CASE_BEGIN] case=unit/C points=A\n[PANGEA_VERIFY] case=unit/C result=passed hits=A=2\n[PANGEA_CLEANUP] case=unit/C cleanup=0 verify=0\n[PANGEA_CASE_END] case=unit/C status=0')
  await click('解析日志填充')
  assert.equal(container.querySelector('[aria-label="验证用例"]').value, 'unit/C')
  assert.equal(container.querySelector('[aria-label="实际结果"]').value, 'passed')
  assert.equal(container.querySelector('[aria-label="桩点实际命中"]').value, 'A=2')
  assert.equal(container.textContent.includes('已保存'), false)
  await click('保存构建与验证记录')
  await until(() => container.textContent.includes('已保存'))
  const task1 = (await service.list(dataRoot, run.run_id))[0]
  const pushedBuilds = await service.listBuilds(dataRoot)
  assert.equal(task1.status, 'ready')
  assert.equal(task1.verification.at(-1).case_key, 'unit/C')
  assert.equal(task1.verification.at(-1).result, 'passed')
  assert.equal(task1.verification.at(-1).hits, 'A=2')
  assert.equal(task1.verification.at(-1).build.build_id, pushedBuilds[0].id)

  // §7 #15: Upstream HEAD advance causes mismatch on Task 1 -> build reports failure -> jump directly to Task 1 detail
  await writeFile(path.join(source, 'target.c'), 'int operation(void) { return 42; }\n')
  await injectionGit(source, ['add', 'target.c'])
  await injectionGit(source, ['commit', '-m', 'upstream target.c refactor'])
  const advancedHead = await injectionGit(source, ['rev-parse', 'HEAD'])
  await click('加入出包 / 推送个人分支')
  await until(() => button('合成并推送到个人分支（2 个任务）'))
  await change('问题单号', 'AR20261118000001')
  await until(() => enabled('合成并推送到个人分支（2 个任务）'))
  await click('合成并推送到个人分支（2 个任务）')
  await until(() => enabled('打开任务重新生成'))
  assert.match(container.textContent, /部分打桩补丁与当前 HEAD 失配，本次未提交且未推送/)
  assert.match(container.textContent, /任务「资源申请失败后的恢复」失配/)
  assert.equal(await injectionGit(source, ['rev-parse', 'HEAD']), advancedHead)
  await click('打开任务重新生成')
  await until(() => container.textContent.includes('正在查看：资源申请失败后的恢复'))
  assert.equal(container.querySelector('[aria-label="新建打桩步骤"]'), null)

  // Corrupt one task.json and drop 任务甲 from workbench tasks; other tasks stay visible and clickable on Home.
  await mkdir(path.join(dataRoot, '.pangea', 'fault-injection', run.run_id, 'corrupt-task'), { recursive: true })
  await writeFile(path.join(dataRoot, '.pangea', 'fault-injection', run.run_id, 'corrupt-task', 'task.json'), '{not-json')
  tasks.splice(0, 1)
  await click('返回打桩任务列表')
  await until(() => container.querySelector('[aria-label="打桩任务列表"]') && container.textContent.includes('corrupt-task') && enabled('刷新'))
  await click('刷新')
  await until(() => container.textContent.includes('Run dom-run（分析任务已删除或不在当前工作区）') && enabled('资源申请失败后的恢复'))
  assert.match(container.textContent, /任务乙/)
  assert.match(container.textContent, /记录不可读/)
  await click('资源申请失败后的恢复')
  await until(() => container.textContent.includes('正在查看：资源申请失败后的恢复'))
  assert.equal(container.querySelector('[aria-label="新建打桩步骤"]'), null)
  assert.equal(container.querySelector('[aria-label="搜索打桩用例"]'), null)

  // §7 #16: Cross-page injectionDraft handoff jumps directly to Step 2 with selected case pre-checked
  await act(async () => {
    injectionDraft = { requestId: 1, runId: run2.run_id, taskId: 'b', caseKeys: ['unit/A'] }
    for (const notify of injectionListeners) notify()
  })
  await until(() => container.querySelector('[aria-label="选择打桩用例 乙任务用例"]')?.checked === true && button('直接进入设置与生成'))
  assert.match(container.textContent, /已选择 1 条/)
  console.log('PASS: registered injection page → Home default entry → 3-step wizard → cross-Run synthesis build → pre-receive gate retry → DSH pipeline → default selection persistence → mismatch task jump → corrupt record isolation → cross-page handoff.')
} finally {
  await act(async () => renderer.unmount()); await service.dispose(); await rm(root, { recursive: true, force: true }); window.happyDOM.abort()
}
