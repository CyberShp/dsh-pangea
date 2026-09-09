import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { applyTaskExecutionState } from '../src/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientPath = path.resolve(here, '..', 'lib', 'client.js')

function fakeReact() {
  return {
    createElement(type, props, ...children) { return { type, props: props ?? {}, children } },
    Fragment: Symbol('Fragment'),
    useState(initial) { return [initial, () => {}] },
    useCallback(fn) { return fn },
    useEffect() {},
    useRef(initial) { return { current: initial } },
  }
}

test('create form shows and can remove selected assets absent from its repository catalog', async () => {
  const form = { repository: 'repo', target: 'clamp', source_scope_text: 'src/clamp.c', asset_ids: ['tagged', 'untagged'], scenario: 'module-analysis', mode: 'speed', provider_id: 'pangea-opencode', model_route_key: '' }
  const states = { 1: { compatibility: { compatible: true }, capabilities: { repositories: ['repo'] }, acp_providers: [{ id: 'pangea-opencode', registered: true }] }, 16: { type: 'create' }, 33: form, 34: { assets: [{ asset_id: 'tagged', title: '仓库需求', asset_type: 'requirement' }] } }
  let index = 0, changed
  const client = await loadClientExports({ ...fakeReact(), useState(initial) {
    const key = index++
    return [Object.hasOwn(states, key) ? states[key] : initial, value => { if (key === 33) changed = typeof value === 'function' ? value(form) : value }]
  } })
  const pages = []
  const ctx = { pangea: { registerPage(page) { pages.push(page) } }, effect(fn) { return fn() } }
  client.apply(ctx)
  const panel = pages.find(page => page.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true })
  const nodes = [], strings = []
  const walk = node => { if (typeof node === 'string') strings.push(node); else if (Array.isArray(node)) node.forEach(walk); else if (node?.children) { nodes.push(node); node.children.forEach(walk) } }
  walk(panel.type(panel.props))
  assert.ok(strings.join('\n').includes('untagged'))
  assert.ok(strings.join('\n').includes('仓库需求'))
  const remove = nodes.find(node => node.props['aria-label'] === '移除资产 untagged')
  assert.ok(remove)
  remove.props.onClick()
  assert.deepEqual(Array.from(changed.asset_ids), ['tagged'])
})

async function loadClientExports(react = fakeReact(), fetcher = async () => { throw new Error('fetch must not run during registration') }) {
  const source = await readFile(clientPath, 'utf8')
  let exported
  const sandbox = { URLSearchParams, AbortController, console, fetch: fetcher, setInterval, clearInterval }
  sandbox.window = { setInterval, clearInterval, setTimeout: (...args) => setTimeout(...args).unref(), clearTimeout, __ModuleLoader__: { load(spec) { exported = spec.factory(name => name === 'react' ? react : {}) } } }
  vm.runInNewContext(source, sandbox, { filename: clientPath })
  return exported
}

function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants)
  if (!node?.children) return []
  return [node, ...node.children.flatMap(descendants)]
}

for (const providerId of ['pangea-nga', 'pangea-opencode', 'pangea-codeagent', 'pangea-claude-code']) {
  test(`new analysis selects advertised ${providerId} models and clears selection when changing Agent`, async () => {
    let index = 0, phase = 'form', changed
    const form = { repository: 'repo', target: 'analysis', source_scope_text: '.', asset_ids: [], provider_id: providerId, agent_model: '' }
    const states = { 1: { compatibility: { compatible: true }, acp_providers: [{ id: providerId, registered: true }] },
      16: { type: 'create' }, 33: form }
    const client = await loadClientExports({ ...fakeReact(), useState(initial) {
      const key = index++
      if (phase === 'model') return [key === 0 ? { provider_id: providerId, models: [{ id: 'wire/selected', label: 'Selected' }] } : key === 2 ? false : initial, () => {}]
      return [Object.hasOwn(states, key) ? states[key] : initial, value => { if (key === 33) changed = typeof value === 'function' ? value(form) : value }]
    } })
    const pages = [], ctx = { pangea: { registerPage(page) { pages.push(page) } }, effect(fn) { return fn() } }
    client.apply(ctx)
    const panel = pages.find(page => page.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true })
    const nodes = descendants(panel.type(panel.props))
    const model = nodes.find(node => node.type?.name === 'AgentModelSelect')
    assert.ok(model)
    phase = 'model'; index = 0
    const modelNodes = descendants(model.type(model.props))
    const select = modelNodes.find(node => node.props['aria-label'] === 'Agent 模型')
    assert.deepEqual(descendants(select).filter(node => node.type === 'option').map(node => node.props.value), ['', 'wire/selected'])
    select.props.onChange({ target: { value: 'wire/selected' } })
    assert.equal(changed.agent_model, 'wire/selected')
    const request = client.buildAnalysisRequest(changed)
    assert.equal(request.agent_model, 'wire/selected')
    assert.equal(request.provider_id, providerId)
    form.agent_model = 'wire/selected'
    nodes.find(node => node.type === 'select' && node.props.value === providerId).props.onChange({ target: { value: '' } })
    assert.equal(changed.agent_model, '')
  })
}

test('Agent Runtime keeps all editable commands inside a closed advanced section', async () => {
  let index = 0
  const client = await loadClientExports({ ...fakeReact(), useState(initial) {
    return [index++ === 0 ? { providers: [{ id: 'pangea-nga', label: 'NGA', command: 'nga', args: ['acp'], available: true, registered: true }] } : initial, () => {}]
  } })
  const pages = [], ctx = { pangea: { registerPage(page) { pages.push(page) } }, effect(fn) { return fn() } }
  client.apply(ctx)
  const panel = pages.find(page => page.id === 'agent-runtime').component({ visible: true })
  const nodes = descendants(panel.type(panel.props))
  const advanced = nodes.find(node => node.type === 'details')
  assert.ok(advanced)
  assert.notEqual(advanced.props.open, true)
  const editable = nodes.filter(node => ['input', 'textarea'].includes(node.type))
  assert.ok(editable.length)
  assert.ok(editable.every(node => descendants(advanced).includes(node)))
})

test('model discovery sends the current provider, workspace and cancellation signal', async () => {
  const client = await loadClientExports()
  const signal = new AbortController().signal
  await client.requestAgentModels({ providerId: 'pangea-nga', cwd: '/workspace', signal, fetcher: async (_url, options) => {
    assert.equal(options.signal, signal)
    assert.deepEqual(JSON.parse(options.body), { action: 'models', provider_id: 'pangea-nga', cwd: '/workspace' })
    return { ok: true, json: async () => ({ status: 'ok', models: [] }) }
  } })
})

test('READY does not imply complete delivery, independent review, or semantic approval', async () => {
  const client = await loadClientExports()
  const labels = client.outcomePresentation({ lifecycle_status: 'complete', quality_status: 'READY', delivery_integrity: { status: 'incomplete' }, semantic_review: { method: 'self_review', verdict: 'UNRESOLVED' } })
  assert.equal(labels.workflow, '流程完成')
  assert.equal(labels.delivery, '交付不完整')
  assert.equal(labels.review, '自审')
  assert.equal(labels.semantic, 'UNRESOLVED（审查者结论）')
  assert.equal(client.outcomePresentation({ quality_status: 'READY' }).semantic, '未给出语义结论')
})

test('filters canonical risk severities and includes the complete causal chain in discussion context', async () => {
  const client = await loadClientExports()
  const risks = [
    { risk_id: 'R-001', severity: 'High' },
    { risk_id: 'R-002', severity: 'High' },
    { risk_id: 'R-003', severity: 'Medium' },
    { risk_id: 'R-004', severity: 'Low' },
    { risk_id: 'R-005', severity: null },
  ]
  assert.deepEqual({ ...client.riskSeverityCounts(risks) }, { Critical: 0, High: 2, Medium: 1, Low: 1, Ungraded: 1 })
  assert.deepEqual(Array.from(client.filterRisks(risks, 'High', '')).map(item => item.risk_id), ['R-001', 'R-002'])
  assert.deepEqual(Array.from(client.filterRisks(risks, 'Ungraded', '')).map(item => item.risk_id), ['R-005'])

  const draft = client.buildDiscussionDraft({
    kind: 'risk', runId: 'run-1', risks, testCases: [],
    item: {
      risk_id: 'R-001', title: '父资源误判', severity: 'High', narrative: '风险说明',
      trigger: '父键缺失', system_result: '读取路径失效', residual_effect: '状态残留',
      apparent_normality: '当前请求仍可能成功', external_observation: '后续查询返回 404', blackbox_proof: '删除父键后查询',
      evidence: [], linked_test_case_ids: [],
    },
  })
  for (const value of ['风险说明', '父键缺失', '读取路径失效', '状态残留', '当前请求仍可能成功', '后续查询返回 404', '删除父键后查询']) {
    assert.match(draft, new RegExp(value))
  }
})

test('PANGEA client registers the workbench and task-oriented product pages', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /测试工作台/)
  assert.match(source, /任务指标/)
  assert.match(source, /需要处理/)
  assert.match(source, /已有报告/)
  assert.match(source, /data-pangea-product-mode/)
  assert.match(source, /ctx\?\.pangea\?\.openPage\?\.\(\{ \.\.\.scope, sessionId \}, pageId\)/)
  assert.match(source, /Codetalks Skill 完整流程/)
  assert.match(source, /阶段流程/)
  assert.doesNotMatch(source, /Step 01–09 生命周期|\/ 9`/)
  assert.match(source, /核心规则 ACK/)
  assert.match(source, /独立 Judge/)
  assert.match(source, /分析任务/)
  assert.match(source, /React\.useState\(\{ type: initialScreen \}\)/)
  assert.match(source, /gridAutoFlow: 'column', gridAutoColumns: 'minmax\(72px, 1fr\)'/)
  assert.match(source, /\['flows', '业务流程'\]/)
  assert.match(source, /\['workflow', '运行过程'\]/)
  assert.doesNotMatch(source, /\['monitor', '监控'\]/)
  assert.doesNotMatch(source, /if \(screen\.type === 'monitor'\) body = renderMonitor/)
  assert.match(source, /风险/)
  assert.match(source, /用例/)
  assert.match(source, /证据/)
  assert.match(source, /复核/)
  assert.match(source, /业务流/)
  assert.match(source, /新建分析/)
  assert.doesNotMatch(source, /Action 生命周期/)
  assert.match(source, /后端与工作台不兼容/)
  assert.match(source, /停止 Run/)
  assert.match(source, /失败阶段：/)
  assert.match(source, /Agent 尚未产生可显示的消息输出/)
  assert.match(source, /直接在“新建分析”选择 Agent 和模型/)
  assert.doesNotMatch(source, /const externalModelFields =/)
  assert.doesNotMatch(source, /模型未知.*effort.*不支持/)
  assert.match(source, /field\('PID'/)
  assert.match(source, /setSelectedRun\(task\.run_id \?\? null\)/)
  assert.match(source, /requestRunSelection/)
  assert.match(source, /intent === 'select-run'/)
  assert.match(source, /task-conversation-create/)
  assert.match(source, /task-conversation-activate/)
  assert.match(source, /registerProductSession/)
  assert.match(source, /优先失败场景/)
  assert.match(source, /技术详情/)
  assert.match(source, /用例尚未编号，不能选择/)
  assert.match(source, /filter\(hasText\)/)
  assert.match(source, /← 返回/)
  assert.match(source, /数据状态/)
  assert.match(source, /数据读取异常/)
  assert.match(source, /renderIssueCard\('未解决事项'/)
  assert.doesNotMatch(source, /JSON\.stringify\(workflow\.unresolved/)
  assert.match(source, /当前结构化结果不可信/)
  assert.match(source, /不能把空列表解释为/)
  assert.match(source, /AbortController/)
  assert.match(source, /const ACTIVE_POLL_INTERVAL_MS = 2_000/)
  assert.match(source, /const IDLE_POLL_INTERVAL_MS = 45_000/)
  assert.match(source, /snapshotPollInterval\(value\)/)
  assert.match(source, /同步失败，继续显示上次结果/)
  assert.match(source, /finally \{[\s\S]*sequence === workbenchRequestRef\.current\.sequence\) setWorkbenchLoading\(false\)/)
  assert.match(source, /\['home', 'tasks'\]\.includes\(screen\.type\) \? null : header/)
  assert.doesNotMatch(source, /\$\{selectedTask\.title\} · \$\{selectedTask\.task_id\}/)
  assert.doesNotMatch(source, /任务编号/)
  assert.doesNotMatch(source, /\}, task\.task_id\),/)
  assert.match(source, /刷新中…/)
  assert.match(source, /和 DSH 讨论/)
  assert.match(source, /在讨论会话中继续/)
  assert.match(source, /打开完整文件/)
  assert.match(source, /源码片段/)
  assert.match(source, /检查这段源码/)
  assert.match(source, /选择风险证据源码/)
  assert.match(source, /选择待核对结论/)
  assert.match(source, /选择核对证据/)
  assert.match(source, /核对选中证据/)
  assert.match(source, /转成定向测试/)
  assert.match(source, /打开 HTML 报告/)
  assert.doesNotMatch(source, /Current Run|Recent Runs|Refreshing/)

  let exported
  const sandbox = { URLSearchParams, console, fetch: async () => { throw new Error('fetch must not run during registration') }, setInterval, clearInterval }
  sandbox.window = {
    setInterval, clearInterval,
    __ModuleLoader__: {
      load(spec) {
        const require = name => {
          if (name === 'react') return fakeReact()
          throw new Error(`unexpected client require: ${name}`)
        }
        exported = spec.factory(require)
      },
    },
  }
  vm.runInNewContext(source, sandbox, { filename: clientPath })

  assert.deepEqual(Array.from(exported.inject), ['pangea', 'sessions'])
  const pages = []
  exported.apply({
    pangea: { registerPage(page) { pages.push(page); return () => {} } },
    effect(factory) { return factory() },
  })
  assert.equal(pages.length, 4)
  assert.deepEqual(pages.map(page => page.id), ['workbench', 'analysis', 'execution', 'agent-runtime'])
  assert.deepEqual(pages.map(page => page.title()), ['工作台', 'PANGEA 分析', '环境配置', 'Agent Runtime'])
  assert.deepEqual(pages.map(page => page.order), [0, 10, 20, 30])
  assert.equal(pages[2].available(), false)
})

test('shows a health alert only for an actual reader warning', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /const healthAlert = .*health\?\.status === 'warning'/s)
  assert.doesNotMatch(source, /const healthAlert = .*health\?\.trusted === false/s)
  assert.doesNotMatch(source, /health\?\.trusted === false/)
})

test('keeps concrete Run errors in the AI assistant instead of the overview', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.doesNotMatch(source, /renderIssueCard\('当前错误', current\.errors, 'error'\)/)
  assert.doesNotMatch(source, /renderIssueCard\('当前错误', \[\{ code: selectedTask\.launch_error_code/)
  const healthCard = source.slice(source.indexOf('function renderHealthCard'), source.indexOf('function renderMonitor'))
  assert.doesNotMatch(healthCard, /terminal_error|launch_error/)
})

test('keeps the analysis page active when selecting a Task opens its conversation', async () => {
  const source = await readFile(clientPath, 'utf8')
  const chooseTask = source.slice(source.indexOf('function chooseTask'), source.indexOf('function openTaskFromWorkbench'))
  assert.match(chooseTask, /ctx\?\.sessions\?\.open\?\.\(activeConversation\.session_id\)[\s\S]*openProductPage\('analysis', '分析任务', activeConversation\?\.session_id\)/)
  const workbenchTask = source.slice(source.indexOf('function openTaskFromWorkbench'), source.indexOf('async function startTask'))
  assert.match(workbenchTask, /openProductPage\('analysis', '分析任务', activeConversation\?\.session_id\)/)
  assert.match(source, /function openProductPage\(pageId, label, sessionId = scope\?\.sessionId\)/)
})

test('does not present a failed task as pending publication', async () => {
  const source = await readFile(clientPath, 'utf8')
  let exported
  const sandbox = { URLSearchParams, console }
  sandbox.window = { __ModuleLoader__: { load(spec) { exported = spec.factory(name => name === 'react' ? fakeReact() : {}) } } }
  vm.runInNewContext(source, sandbox, { filename: clientPath })
  const failed = exported.deriveRunPresentation(
    { status: 'failed', execution_status: 'failed', run_id: 'run-1', terminal_error: 'ACP Agent 启动失败', can_resume: true },
    { run_id: 'run-1', publication: { state: 'pending' } },
    { status: 'pending' },
  )
  assert.equal(failed.failed, true)
  assert.equal(failed.executionLabel, '分析失败')
  assert.equal(failed.reliabilityLabel, '分析失败')
  assert.equal(failed.healthStatus, 'pending')
  assert.equal(failed.dataTone, 'neutral')
  assert.equal(failed.publicationLabel, '未发布（运行失败）')
  assert.equal(failed.countsAvailability, 'unpublished')
  assert.equal(failed.canResume, true)
  const running = exported.deriveRunPresentation(
    { status: 'running', execution_status: 'running', run_id: 'run-2' },
    { run_id: 'run-2', publication: { state: 'pending' } },
    { status: 'pending' },
  )
  assert.equal(running.reliabilityLabel, '阶段结果待发布')
  assert.equal(running.executionLabel, '分析中')
  assert.equal(running.isAnimating, true)
  assert.equal(running.canResume, false)
  const stopping = exported.deriveRunPresentation(
    { status: 'running', execution_status: 'stopping', run_id: 'run-1' },
    { run_id: 'run-1', publication: { state: 'pending' } },
    { status: 'pending' },
  )
  assert.equal(stopping.stopping, true)
  assert.equal(stopping.executionLabel, '正在停止')
  assert.equal(stopping.publicationLabel, '未发布（停止中）')
  assert.equal(stopping.isAnimating, false)
  assert.equal(stopping.canResume, false)

  const failedDraft = exported.deriveRunPresentation(
    { status: 'failed', execution_status: 'failed', run_id: 'run-draft', can_resume: false, resume_blocked_reason: '旧执行停止尚未确认' },
    { run_id: 'run-draft', publication: { state: 'draft' } },
    { status: 'ok' },
  )
  assert.equal(failedDraft.countsAvailability, 'draft')
  assert.equal(failedDraft.canResume, false)
  assert.equal(failedDraft.resumeBlockedReason, '旧执行停止尚未确认')

  const unrelatedFailure = exported.deriveRunPresentation(
    { status: 'failed', execution_status: 'failed', run_id: 'run-05' },
    { run_id: 'run-06', publication: { state: 'pending' } },
    { status: 'pending' },
  )
  assert.equal(unrelatedFailure.identityMatched, false)
  assert.equal(unrelatedFailure.failed, false)
  assert.equal(unrelatedFailure.publicationLabel, 'pending')

  const needsAttention = exported.deriveRunPresentation(
    { status: 'needs_attention', execution_status: 'completed', run_id: 'run-attention' },
    { run_id: 'run-attention', lifecycle_status: 'attention_required', publication: { state: 'pending' } },
    { status: 'pending' },
  )
  assert.equal(needsAttention.failed, false)
  assert.equal(needsAttention.needsAttention, true)
  assert.equal(needsAttention.executionLabel, '需要处理')
  assert.equal(needsAttention.publicationLabel, '尚未发布（需要处理）')
})

test('presents the run-06 file snapshot as 2 of 9 running with 3 acknowledged rules', async () => {
  const exported = await loadClientExports()
  const workflow = {
    completed_steps: ['01', '02'], current_step: '03',
    core_rules_ack: {
      'path-fidelity': { ack_at: '2026-09-07T03:22:02Z' },
      'evidence-consumption': { ack_at: '2026-09-07T03:22:03Z' },
      'narrative-first': { ack_at: '2026-09-07T03:22:03Z' },
    },
  }
  const current = {
    run_id: 'run-06', data_root: 'C:\\work\\pangea-data', lifecycle_status: 'running', phase: 'STEP_03', terminal: false,
    publication: { state: 'pending', revision: 0 }, workflow, state_read: { status: 'ok', updated_at: '2026-09-07T03:38:18Z' },
  }
  const task = { task_id: 'task-06', run_id: 'run-06', data_root: 'c:/work/pangea-data', status: 'running', execution_status: 'running' }
  assert.equal(exported.snapshotMatchesSelection({ data_root: current.data_root, current }, { runId: 'run-06', dataRoot: task.data_root, task }), true)
  assert.deepEqual({ ...exported.workflowAckPresentation(workflow, 'ok') }, { completed: 3, total: 3, label: '3 / 3' })
  const presentation = exported.deriveRunPresentation(task, current, { status: 'pending' })
  assert.equal(presentation.failed, false)
  assert.equal(presentation.running, true)
  assert.equal(presentation.publicationLabel, '阶段结果待发布')
})

test('renders the backend Run verdict without reapplying an older failed Task', async () => {
  const client = await loadClientExports()
  const task = {
    task_id: 'task-06', run_id: 'run-06', data_root: '/workspace/pangea-data', attempt_id: 'attempt-06',
    status: 'failed', execution_status: 'interrupted', can_resume: true,
    terminal_error: 'old connection failure',
    attempts: [{ attempt_id: 'attempt-06', ended_at: Date.parse('2026-09-07T03:22:11Z') }],
  }
  const snapshot = { current: {
    run_id: 'run-06', data_root: task.data_root, lifecycle_status: 'running', phase: 'STEP_03', terminal: false,
    state_read: { updated_at: '2026-09-07T03:38:18Z' }, publication: { state: 'pending', revision: 0 }, errors: [],
  } }
  const active = client.deriveRunPresentation(task, applyTaskExecutionState(snapshot, task).current, { status: 'pending' })
  assert.equal(active.failed, false)
  assert.equal(active.running, true)
  assert.equal(active.canResume, false)
  assert.equal(active.publicationLabel, '阶段结果待发布')
  assert.equal(task.terminal_error, 'old connection failure')

  const stale = { current: { ...snapshot.current, state_read: { updated_at: '2026-09-07T03:20:00Z' } } }
  const failed = client.deriveRunPresentation(task, applyTaskExecutionState(stale, task).current, { status: 'pending' })
  assert.equal(failed.failed, true)
  assert.equal(failed.publicationLabel, '未发布（运行失败）')
  const complete = client.deriveRunPresentation(task, { ...snapshot.current, lifecycle_status: 'complete', terminal: true }, { status: 'ok' })
  assert.equal(complete.failed, false)
  assert.equal(complete.executionLabel, '已完成')
  assert.equal(complete.canResume, false)
})

test('overview does not show another Task or an old attempt error while its Run is loading', async () => {
  for (const [selectedTaskId, eventAttempt, shouldShow] of [
    ['task-05', 'attempt-05', false],
    ['task-06', 'attempt-05', false],
    ['task-06', 'attempt-06', true],
  ]) {
    const task = { task_id: 'task-06', run_id: 'run-06', attempt_id: 'attempt-06', status: 'running', execution_status: 'running', title: 'ACTIVE RUN 06' }
    const states = {
      0: undefined,
      1: { tasks: { items: [task] }, selected_task_id: selectedTaskId, compatibility: { compatible: true },
        launch_log: { events: [{ task_id: selectedTaskId, attempt_id: eventAttempt, status: 'error', stage: 'acp_job_settled', error: 'fixture spawn EINVAL', error_summary: 'fixture request rejected', tool_calls: 0, exit_code: 0, process_exited: true }] } },
      4: task.run_id, 5: task.task_id, 16: { type: 'overview' },
    }
    let stateIndex = 0
    const client = await loadClientExports({ ...fakeReact(), useState(initial) {
      const index = stateIndex++
      return [Object.hasOwn(states, index) ? states[index] : initial, () => {}]
    } })
    const pages = []
    const ctx = { pangea: { registerPage(page) { pages.push(page) } }, effect(fn) { return fn() } }
    client.apply(ctx)
    const panel = pages.find(page => page.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true })
    const strings = []
    const walk = node => {
      if (typeof node === 'string') strings.push(node)
      else if (Array.isArray(node)) node.forEach(walk)
      else if (node?.children) node.children.forEach(walk)
    }
    walk(panel.type(panel.props))
    assert.ok(strings.includes(task.title))
    assert.equal(strings.includes('fixture spawn EINVAL'), shouldShow)
    assert.equal(strings.join('\n').includes('错误摘要: fixture request rejected'), shouldShow)
    assert.equal(strings.join('\n').includes('工具事件: 0'), shouldShow)
    assert.equal(strings.join('\n').includes('退出码: 0'), shouldShow)
  }
})

test('keeps a previous failed attempt visible while a resumed attempt is running', async () => {
  const source = await readFile(clientPath, 'utf8')
  let exported
  const sandbox = { URLSearchParams, console }
  sandbox.window = { __ModuleLoader__: { load(spec) { exported = spec.factory(name => name === 'react' ? fakeReact() : {}) } } }
  vm.runInNewContext(source, sandbox, { filename: clientPath })

  const failures = exported.previousAttemptFailures({
    attempt_id: 'attempt-2',
    attempts: [
      { attempt_id: 'attempt-1', execution_status: 'failed', terminal_error: 'STEP_09 未形成正式交付', ended_at: 200 },
      { attempt_id: 'attempt-2', execution_status: 'running', terminal_error: null, started_at: 300 },
    ],
  })
  assert.equal(failures.length, 1)
  assert.equal(failures[0].attempt_id, 'attempt-1')
  assert.equal(failures[0].terminal_error, 'STEP_09 未形成正式交付')
  assert.match(source, /上一次尝试失败/)
})

test('returns from a run detail to its selected Run overview', async () => {
  const source = await readFile(clientPath, 'utf8')
  let exported
  const sandbox = { URLSearchParams, console }
  sandbox.window = { __ModuleLoader__: { load(spec) { exported = spec.factory(name => name === 'react' ? fakeReact() : {}) } } }
  vm.runInNewContext(source, sandbox, { filename: clientPath })
  assert.equal(exported.analysisBackTarget('workflow', {
    pageMode: 'analysis', selectedTaskId: 'task-1', hasHistory: false, initialScreen: 'tasks',
  }), 'overview')
  assert.equal(exported.analysisBackTarget('workflow', {
    pageMode: 'analysis', selectedTaskId: undefined, hasHistory: false, initialScreen: 'tasks',
  }), 'tasks')
})

test('builds analysis requests with explicit scenario and mode', async () => {
  const source = await readFile(clientPath, 'utf8')
  let exported
  const sandbox = { URLSearchParams, console }
  sandbox.window = { __ModuleLoader__: { load(spec) { exported = spec.factory(name => name === 'react' ? fakeReact() : {}) } } }
  vm.runInNewContext(source, sandbox, { filename: clientPath })

  assert.deepEqual(JSON.parse(JSON.stringify(exported.buildAnalysisRequest({
    repository: 'open-iscsi', target: '认证恢复', source_scope_text: 'src/auth\n src/session', asset_ids: ['asset-1'],
    scenario: 'root-cause', mode: 'speed', provider_id: 'pangea-opencode', model_route_key: 'ignored', agent_model: 'native/selected',
  }))), {
    request_version: '2.0', repository: 'open-iscsi', target: '认证恢复',
    source_scope: ['src/auth', 'src/session'], asset_ids: ['asset-1'],
    scenario: 'root-cause', mode: 'speed', provider_id: 'pangea-opencode', model_route: null, agent_model: 'native/selected',
  })
  assert.equal(exported.buildAnalysisRequest({ source_scope_text: '.', asset_ids: [] }).scenario, 'module-analysis')
  assert.equal(exported.buildAnalysisRequest({ source_scope_text: '.', asset_ids: [] }).mode, 'depth')
})

test('continues background reconciliation while the window is unfocused', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.doesNotMatch(source, /document\.hasFocus\(\)/)
  assert.match(source, /WORKBENCH_BACKGROUND_POLL_INTERVAL_MS/)
  assert.match(source, /const poll = async \(\) => \{[\s\S]*await loadWorkbench\(\{ background: true \}\)[\s\S]*window\.setTimeout\(poll,/)
  assert.doesNotMatch(source, /void loadWorkbench\(\{ background: true \}\)[\s\S]*window\.setTimeout\(poll,/)
})

test('keeps Run lifecycle details in the workflow tab instead of repeating them in overview', async () => {
  const source = await readFile(clientPath, 'utf8')
  const overview = source.slice(source.indexOf('function renderOverview()'), source.indexOf('function renderRisks()'))
  const workflow = source.slice(source.indexOf('function renderWorkflow()'), source.indexOf('function renderFlows()'))

  assert.doesNotMatch(overview, /'当前任务'/)
  assert.doesNotMatch(overview, /'分析进度'/)
  assert.doesNotMatch(overview, /field\('质量结论'/)
  assert.doesNotMatch(overview, /field\('独立复核'/)
  assert.match(workflow, /'Codetalks Skill 完整流程'/)
  assert.match(workflow, /field\('当前步骤'/)
  assert.match(workflow, /field\('运行状态'/)
})

test('workbench API lists runs and starts or stops through explicit actions', async () => {
  const source = await readFile(clientPath, 'utf8')
  let exported
  const sandbox = { URLSearchParams, console }
  sandbox.window = { __ModuleLoader__: { load(spec) { exported = spec.factory(name => name === 'react' ? fakeReact() : {}) } } }
  vm.runInNewContext(source, sandbox, { filename: clientPath })
  const calls = []
  const fetcher = async (url, options = {}) => {
    calls.push({ url, options })
    return { ok: true, status: 200, async json() { return { status: 'ok' } } }
  }

  await exported.requestWorkbench({ cwd: '/tmp/workspace', cursor: 20, limit: 10, fetcher })
  await exported.requestWorkbenchAction({ cwd: '/tmp/workspace', action: 'stop', payload: { run_id: 'run-1' }, fetcher })
  await exported.requestAssetCatalog({ cwd: '/tmp/workspace', repositoryId: 'repo-one', fetcher })
  await exported.testAcpSettings(fetcher)

  const listUrl = new URL(calls[0].url, 'http://localhost')
  assert.equal(listUrl.searchParams.get('cursor'), '20')
  assert.equal(listUrl.searchParams.get('limit'), '10')
  assert.equal(calls[1].options.method, 'POST')
  assert.deepEqual(JSON.parse(calls[1].options.body), { action: 'stop', run_id: 'run-1' })
  const assetsUrl = new URL(calls[2].url, 'http://localhost')
  assert.equal(assetsUrl.searchParams.get('repository_id'), 'repo-one')
  assert.equal(calls[3].options.method, 'POST')
  assert.deepEqual(JSON.parse(calls[3].options.body), { action: 'test' })
})

test('asset picker defaults to all usable assets and sends explicit search and pagination', async () => {
  const client = await loadClientExports()
  const urls = []
  const controller = new AbortController()
  const fetcher = async (url, options) => {
    urls.push(new URL(url, 'http://localhost'))
    assert.equal(options.signal, controller.signal)
    return { ok: true, async json() { return { status: 'ok', assets: [{ asset_id: 'shared', repository_ids: [] }] } } }
  }
  const shared = await client.requestAssetCatalog({ cwd: '/workspace', signal: controller.signal, fetcher })
  assert.equal(shared.assets[0].asset_id, 'shared')
  assert.equal(urls[0].searchParams.has('repository_id'), false)
  assert.equal(urls[0].searchParams.get('status'), 'available')
  await client.requestAssetCatalog({ cwd: '/workspace', page: 2, query: 'TLS', type: 'design', repositoryId: 'repo-one', signal: controller.signal, fetcher })
  assert.equal(urls[1].searchParams.get('page'), '2')
  assert.equal(urls[1].searchParams.get('page_size'), '20')
  assert.equal(urls[1].searchParams.get('q'), 'TLS')
  assert.equal(urls[1].searchParams.get('type'), 'design')
  assert.equal(urls[1].searchParams.get('repository_id'), 'repo-one')
})

test('client builds focused discussion drafts, appends them to the active DSH composer, and resolves evidence paths', async () => {
  const source = await readFile(clientPath, 'utf8')
  let exported
  const sandbox = { URLSearchParams, console, fetch: async () => { throw new Error('default fetch must not run') }, setTimeout, clearTimeout }
  sandbox.window = {
    setTimeout,
    clearTimeout,
    __ModuleLoader__: {
      load(spec) {
        exported = spec.factory(name => {
          if (name === 'react') return fakeReact()
          throw new Error(`unexpected client require: ${name}`)
        })
      },
    },
  }
  vm.runInNewContext(source, sandbox, { filename: clientPath })

  const draft = exported.buildDiscussionDraft({
    kind: 'risk',
    runId: 'run-17',
    intent: 'evidence',
    item: {
      risk_id: 'R-017', title: '认证状态残留', severity: 'High', trigger: '重连', system_result: '旧状态被复用',
      external_observation: '日志出现旧会话', exclusion_condition: '正常退出不触发',
      upstream_semantics: { conclusion: 'risk_remains' },
      evidence: [
        { location: 'src/auth.c:88-91', observation: '失败路径未清理' },
        { location: 'src/session.c:12-30', observation: '另一条证据' },
      ],
      linked_test_case_ids: ['TC-023'],
    },
    testCases: [{ test_case_id: 'TC-023', title: '认证中断后重连' }],
    sourceSnippet: {
      file_path: '/tmp/src/auth.c', location: 'src/auth.c:88-91', visible_start: 87, visible_end: 89,
      lines: [{ number: 87, text: 'before' }, { number: 88, text: 'if (failed) return;' }, { number: 89, text: 'after' }],
    },
  })
  assert.match(draft, /只基于下方“选中源码片段”/)
  assert.match(draft, /不要调用工具/)
  assert.match(draft, /Run：run-17/)
  assert.match(draft, /对象：风险 R-017/)
  assert.match(draft, /待核对结论：旧状态被复用/)
  assert.match(draft, /选中源码片段：\/tmp\/src\/auth\.c:87-89/)
  assert.match(draft, /88 \| if \(failed\) return;/)
  assert.doesNotMatch(draft, /src\/session\.c:12-30|另一条证据/)
  assert.doesNotMatch(draft, /直接证据|关联测试用例|TC-023/)
  assert.doesNotMatch(draft, /重连|日志出现旧会话|正常退出不触发|risk_remains/)
  assert.doesNotMatch(draft, /final-state\.json|progress\.json/)

  assert.deepEqual(Array.from(exported.splitRiskClaims('注销超时；连接保持活动。新连接失败')), ['注销超时；', '连接保持活动。', '新连接失败'])
  assert.deepEqual(Array.from(exported.splitRiskClaims('NOP 因 !full_feature 直接返回；连接保持活动。')), ['NOP 因 !full_feature 直接返回；', '连接保持活动。'])

  const multiEvidenceDraft = exported.buildDiscussionDraft({
    kind: 'risk', runId: 'run-17', intent: 'evidence', selectedClaim: '连接保持活动。',
    item: {
      risk_id: 'R-017', title: '认证状态残留', system_result: '注销超时；连接保持活动。新连接失败',
      trigger: '重连', external_observation: '日志出现旧会话',
      evidence: [{ location: 'a.c:1-2' }, { location: 'b.c:3-4' }, { location: 'c.c:5-6' }],
    },
    sourceSnippets: [
      { file_path: '/tmp/a.c', visible_start: 1, visible_end: 2, lines: [{ number: 1, text: 'a();' }] },
      { file_path: '/tmp/b.c', visible_start: 3, visible_end: 4, lines: [{ number: 3, text: 'b();' }] },
    ],
  })
  assert.match(multiEvidenceDraft, /待核对结论：连接保持活动。/)
  assert.match(multiEvidenceDraft, /选中源码片段 1\/2：\/tmp\/a\.c:1-2/)
  assert.match(multiEvidenceDraft, /选中源码片段 2\/2：\/tmp\/b\.c:3-4/)
  assert.doesNotMatch(multiEvidenceDraft, /重连|日志出现旧会话|c\.c/)

  const targetedTestDraft = exported.buildDiscussionDraft({
    kind: 'risk', runId: 'run-17', intent: 'targeted-executable', selectedClaim: '连接保持活动。',
    item: {
      risk_id: 'R-017', title: '认证状态残留', system_result: '注销超时；连接保持活动。新连接失败',
      trigger: '登录后中断', external_observation: '连接列表持续可见',
      evidence: [{ location: 'a.c:1-2' }, { location: 'b.c:3-4' }],
    },
    sourceSnippets: [{ file_path: '/tmp/b.c', visible_start: 3, visible_end: 4, lines: [{ number: 3, text: 'b();' }] }],
  })
  assert.match(targetedTestDraft, /待测试结论：连接保持活动。/)
  assert.match(targetedTestDraft, /触发条件：登录后中断/)
  assert.match(targetedTestDraft, /外部观察：连接列表持续可见/)
  assert.match(targetedTestDraft, /选中源码片段：\/tmp\/b\.c:3-4/)
  assert.match(targetedTestDraft, /只生成这一个结论对应的单个测试/)
  assert.match(targetedTestDraft, /不得增加可选扩展、其他风险后果或第二个测试/)
  assert.doesNotMatch(targetedTestDraft, /注销超时|新连接失败|a\.c/)

  const reviewDraft = exported.buildDiscussionDraft({
    kind: 'risk', runId: 'run-17', intent: 'review',
    item: {
      risk_id: 'R-017', title: '认证状态残留', system_result: '旧状态被复用',
      evidence: [{ location: 'src/auth.c:88-91', observation: '失败路径未清理' }],
      linked_test_case_ids: ['TC-023'],
    },
    testCases: [{ test_case_id: 'TC-023', title: '认证中断后重连' }],
  })
  assert.match(reviewDraft, /直接证据：/)
  assert.match(reviewDraft, /src\/auth\.c:88-91 — 失败路径未清理/)
  assert.match(reviewDraft, /TC-023 认证中断后重连/)

  let currentDraft = '我原来的问题'
  const input = { state: { getSnapshot: () => ({ draft: currentDraft }) }, setDraft(value) { currentDraft = value } }
  const actx = { id: 'session-context' }
  const ctx = {
    sessions: { scope: id => id === 'session-1' ? actx : undefined },
    get: name => name === 'conversation' ? { input: { for: value => value === actx ? input : undefined } } : undefined,
  }
  assert.equal(exported.appendConversationDraft(ctx, { sessionId: 'session-1' }, draft), true)
  assert.match(currentDraft, /^我原来的问题\n\n/)
  assert.match(currentDraft, /对象：风险 R-017/)
  assert.equal(exported.appendConversationDraft(ctx, { sessionId: 'missing' }, draft), false)

  assert.equal(exported.filePathFromLocation('src/auth.c:88-91'), 'src/auth.c')
  assert.equal(exported.filePathFromLocation('docs/spec.md#L12-L16'), 'docs/spec.md')
  assert.equal(exported.filePathFromLocation('https://example.com/spec#L12'), undefined)
  assert.equal(exported.absoluteWorkspacePath('/Volumes/Media/pangea-agent', 'src/auth.c'), '/Volumes/Media/pangea-agent/src/auth.c')
  assert.equal(exported.absoluteWorkspacePath('/Volumes/Media/pangea-agent', '/tmp/report.html'), '/tmp/report.html')
  assert.equal(exported.evidenceFilePath('spdk-full:lib/iscsi/conn.c:121-240', '/Volumes/Media/pangea-agent', '/Volumes/Media/pangea-agent/pangea-data'), '/Volumes/Media/pangea-agent/pangea-data/repositories/spdk-full/lib/iscsi/conn.c')
  assert.equal(exported.evidenceFilePath('src/auth.c:88-91', '/Volumes/Media/pangea-agent', '/Volumes/Media/pangea-agent/pangea-data'), '/Volumes/Media/pangea-agent/src/auth.c')
  assert.equal(exported.evidenceIdentity({ chunk_id: 'e-1', location: 'src/auth.c:88-91', observation: '状态未清理' }), 'e-1\u0000src/auth.c:88-91\u0000状态未清理')
  assert.equal(exported.evidenceTabLabel({ location: 'spdk-full:lib/iscsi/conn.c:121-240' }, 0), '1 · conn.c:121–240')
  assert.equal(exported.evidenceTabLabel({ location: 'docs/spec.md#L12-L16' }, 1), '2 · spec.md:12–16')
  assert.equal(exported.runLabel({ run_id: 'analysis-20260905-01', target: 'DHCP 模块' }), 'DHCP 模块')
  assert.equal(exported.runLabel({ run_id: 'analysis-20260905-01' }), 'analysis-20260905-01')
})

test('risk and test case pages use result-focused copy and only show recorded metadata', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.doesNotMatch(source, /行动清单|风险需要判断|这里不自动改写结论|选择只影响本次执行|不修改分析产物/)
  assert.match(source, /风险概览/)
  assert.match(source, /查看风险等级、触发条件和关联测试用例/)
  assert.doesNotMatch(source, /严重度来自 SFMEA/)
  assert.match(source, /测试用例/)
  assert.match(source, /按独立验证目标查看用例、关联路径、覆盖缺口和执行步骤/)
  assert.doesNotMatch(source, /置信度.*\?\? '—'/)
  assert.doesNotMatch(source, /TRANSLATION\[risk\.translation_status\].*未标注/)
  assert.doesNotMatch(source, /RISK_STATUS\[risk\.status\].*未标注/)
  assert.match(source, /causalSection\('风险说明', risk\.narrative\)/)
  assert.match(source, /causalSection\('黑盒证明', risk\.blackbox_proof\)/)
})

test('selects a writable discussion conversation instead of the read-only analysis session', async () => {
  const source = await readFile(clientPath, 'utf8')
  let exported
  const sandbox = { URLSearchParams, console }
  sandbox.window = { __ModuleLoader__: { load(spec) { exported = spec.factory(name => name === 'react' ? fakeReact() : {}) } } }
  vm.runInNewContext(source, sandbox, { filename: clientPath })

  const task = {
    active_conversation_id: 'analysis',
    conversations: [
      { conversation_id: 'analysis', kind: 'analysis', session_id: 'session-analysis' },
      { conversation_id: 'discussion', kind: 'assistant', session_id: 'session-discussion' },
    ],
  }
  assert.equal(exported.writableConversation(task).session_id, 'session-discussion')
  task.active_conversation_id = 'discussion'
  assert.equal(exported.writableConversation(task).session_id, 'session-discussion')
  assert.equal(exported.writableConversation({ conversations: task.conversations.slice(0, 1) }), null)
  assert.match(source, /task-conversation-create/)
  assert.match(source, /task-conversation-activate/)
  assert.match(source, /在讨论会话中继续/)
})

test('client source request encodes the evidence location and returns a line-aware snippet', async () => {
  const source = await readFile(clientPath, 'utf8')
  let exported
  const sandbox = { URLSearchParams, console, fetch: async () => { throw new Error('default fetch must not run') }, setTimeout, clearTimeout }
  sandbox.window = {
    setTimeout,
    clearTimeout,
    __ModuleLoader__: {
      load(spec) {
        exported = spec.factory(name => {
          if (name === 'react') return fakeReact()
          throw new Error(`unexpected client require: ${name}`)
        })
      },
    },
  }
  vm.runInNewContext(source, sandbox, { filename: clientPath })

  const calls = []
  const result = await exported.requestSourceSnippet({
    cwd: '/Volumes/Media/pangea-agent',
    dataRoot: '/Volumes/Media/pangea-agent/pangea-data',
    location: 'spdk-full:lib/iscsi/conn.c:121-124',
    async fetcher(url, options) {
      calls.push({ url, options })
      return { ok: true, status: 200, async json() { return { status: 'ok', target_start: 121, target_end: 124, lines: [] } } }
    },
  })
  assert.equal(result.target_start, 121)
  assert.match(calls[0].url, /^\/api\/pangea-companion\/source\?/)
  assert.match(calls[0].url, /location=spdk-full%3Alib%2Fiscsi%2Fconn\.c%3A121-124/)
  assert.equal(calls[0].options.cache, 'no-store')
})

test('client export request returns a downloadable CSV response and filename', async () => {
  const source = await readFile(clientPath, 'utf8')
  let exported
  const sandbox = { URLSearchParams, console, fetch: async () => { throw new Error('default fetch must not run') }, setTimeout, clearTimeout }
  sandbox.window = {
    setTimeout,
    clearTimeout,
    __ModuleLoader__: {
      load(spec) {
        exported = spec.factory(name => {
          if (name === 'react') return fakeReact()
          throw new Error(`unexpected client require: ${name}`)
        })
      },
    },
  }
  vm.runInNewContext(source, sandbox, { filename: clientPath })

  const blob = { marker: 'csv' }
  const result = await exported.requestRunExport({
    cwd: '/tmp/pangea', dataRoot: '/tmp/pangea/pangea-data', runId: 'run-1',
    async fetcher(url, options) {
      assert.match(url, /^\/api\/pangea-companion\/export\?/)
      assert.match(url, /format=csv/)
      assert.equal(options.cache, 'no-store')
      return {
        ok: true, status: 200, async blob() { return blob },
        headers: { get(name) { return name === 'content-disposition' ? 'attachment; filename="pangea-run-1-test-cases.csv"' : null } },
      }
    },
  })
  assert.equal(result.blob, blob)
  assert.equal(result.filename, 'pangea-run-1-test-cases.csv')
})

test('client state request encodes workspace and run, passes cancellation, and returns only ok snapshots', async () => {
  const source = await readFile(clientPath, 'utf8')
  let exported
  const sandbox = { URLSearchParams, console, fetch: async () => { throw new Error('default fetch must not run') }, setTimeout, clearTimeout }
  sandbox.window = {
    setTimeout,
    clearTimeout,
    __ModuleLoader__: {
      load(spec) {
        exported = spec.factory(name => {
          if (name === 'react') return fakeReact()
          throw new Error(`unexpected client require: ${name}`)
        })
      },
    },
  }
  vm.runInNewContext(source, sandbox, { filename: clientPath })

  const calls = []
  const signal = { marker: 'cancel-signal' }
  const result = await exported.requestSnapshot({
    cwd: '/Volumes/Media/pangea agent',
    dataRoot: '/Volumes/Media/pangea agent/pangea-data',
    runId: 'run 01',
    sessionId: 'session 17',
    signal,
    async fetcher(url, options) {
      calls.push({ url, options })
      return { ok: true, status: 200, async json() { return { status: 'ok', current: { run_id: 'run 01' } } } }
    },
  })

  assert.equal(result.current.run_id, 'run 01')
  assert.match(calls[0].url, /^\/api\/pangea-companion\/state\?/)
  assert.match(calls[0].url, /cwd=%2FVolumes%2FMedia%2Fpangea\+agent/)
  assert.match(calls[0].url, /data_root=%2FVolumes%2FMedia%2Fpangea\+agent%2Fpangea-data/)
  assert.match(calls[0].url, /run_id=run\+01/)
  assert.match(calls[0].url, /session_id=session\+17/)
  assert.equal(calls[0].options.cache, 'no-store')
  assert.equal(calls[0].options.signal, signal)

  await exported.requestSnapshot({
    cwd: '/tmp/pangea',
    runId: null,
    async fetcher(url) {
      assert.match(url, /run_id=/)
      return { ok: true, status: 200, async json() { return { status: 'ok', current: null } } }
    },
  })

  await assert.rejects(() => exported.requestSnapshot({
    cwd: '/tmp/pangea',
    async fetcher() { return { ok: false, status: 404, async json() { return { status: 'error', error: 'not-found' } } } },
  }), /not-found/)

  await assert.rejects(() => exported.requestSnapshot({
    cwd: '/tmp/pangea', runId: 'run-06',
    async fetcher() { return { ok: true, status: 200, async json() { return { status: 'ok', current: { run_id: 'run-05' } } } } },
  }), /Run 身份不一致/)
})

for (const screenType of ['flows', 'coverage']) {
  test(`renders ${screenType} as its own reader with explicit evidence and case links`, async () => {
    const task = { task_id: 'task', run_id: 'run', data_root: '/data', target: 'synthetic', status: 'complete' }
    const current = { run_id: 'run', data_root: '/data', lifecycle_status: 'complete', scenario: 'coverage-analysis', publication: { state: 'final', revision: 1 }, details: {
      business_flows: [{ flow_id: 'FLOW-1', title: '连接请求', mainline_steps: [{ step_id: 'S1', title: '接收请求', external_action: '请求连接' }], branches: [{ branch_id: 'B1', from_step_id: 'S1', kind: 'timeout', condition: '响应超时', linked_test_case_ids: ['TC-1'], evidence_ids: ['E1'] }] }],
      coverage_gaps: [{ gap_id: 'GAP-1', source: 'auto', file_path: 'a.c', kind: 'branch', raw: { line: 1, branch: '0' }, coverage_status: 'uncovered', analysis_status: 'analyzed', linked_test_case_ids: ['TC-1'], evidence_ids: ['E1'] }],
      risks: [], test_cases: [{ test_case_id: 'TC-1', title: '超时恢复' }], evidence: [{ evidence_id: 'E1', location: 'repo:a.c:1' }], review_issues: [],
    } }
    const states = { 0: { current, data_root: '/data' }, 1: { tasks: { items: [task] } }, 4: 'run', 5: 'task', 16: { type: screenType } }
    let index = 0, nextScreen
    const client = await loadClientExports({ ...fakeReact(), useState(initial) {
      const key = index++
      return [Object.hasOwn(states, key) ? states[key] : initial, value => { if (key === 16) nextScreen = value }]
    } })
    const pages = [], ctx = { pangea: { registerPage(page) { pages.push(page) } }, effect(fn) { return fn() } }
    client.apply(ctx)
    const panel = pages.find(page => page.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true })
    const nodes = descendants(panel.type(panel.props))
    const coverage = nodes.find(node => node.type === client.CoverageBrowser)
    if (coverage) nodes.push(...descendants(coverage.type({ ...coverage.props, task: null })))
    const nav = nodes.find(node => node.type === 'nav' && node.props['aria-label'] === 'PANGEA 分析页面')
    const active = descendants(nav).find(node => node.props['aria-current'] === 'page')
    assert.equal(active.children[0], screenType === 'flows' ? '业务流程' : '覆盖缺口')
    const linked = nodes.find(node => node.type === 'button' && node.children[0] === 'TC-1')
    assert.ok(linked)
    linked.props.onClick()
    assert.equal(nextScreen.type, 'case')
    assert.equal(nextScreen.id, 'TC-1')
    assert.ok(nodes.some(node => node.type === 'button' && node.children[0] === 'E1'))
  })
}

test('dense flow reader pages branches, focuses a step and keeps search, destinations and case links usable', async () => {
  const task = { task_id: 'task', run_id: 'run', data_root: '/data', target: 'dense', status: 'complete' }
  const flow = { flow_id: 'F1', title: '请求生命周期', mainline_steps: [{ step_id: 'S1', title: '请求校验' }, { step_id: 'S2', title: '持久化' }], branches: [
    ...Array.from({ length: 30 }, (_, i) => ({ branch_id: `B${i + 1}`, from_step_id: 'S1', to_step_id: 'S2', kind: i % 2 ? 'retry' : 'timeout', condition: `条件 ${i + 1}`, processing: `处理 ${i + 1}`, linked_test_case_ids: ['TC1'] })),
    { branch_id: 'B31', from_step_id: 'S2', kind: 'exception', condition: '写入失败', terminal_result: '返回失败' },
    { branch_id: 'B32', from_step_id: 'missing', condition: '来源待确认' },
  ] }
  const current = { run_id: 'run', data_root: '/data', details: { business_flows: [flow], test_cases: [{ test_case_id: 'TC1', title: '验收' }] } }
  const states = { 0: { current }, 1: { tasks: { items: [task] } }, 4: 'run', 5: 'task', 16: { type: 'flows' } }
  let index = 0
  const requests = []
  const openedSessions = []
  const client = await loadClientExports({ ...fakeReact(), useState(initial) {
    const key = index++
    if (!Object.hasOwn(states, key)) states[key] = initial
    return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value }]
  } }, async (_url, options) => {
    requests.push(JSON.parse(options.body))
    return { ok: true, async json() { return { status: 'ok', views: [], session_id: requests.at(-1).action === 'architecture-create' ? 'diagram-session' : undefined } } }
  })
  const pages = [], ctx = { sessions: { open(id) { openedSessions.push(id) } }, pangea: { registerPage(page) { pages.push(page) } }, effect(fn) { return fn() } }
  client.apply(ctx)
  const panel = pages.find(page => page.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true })
  const render = () => { index = 0; return descendants(panel.type(panel.props)) }
  const find = label => render().find(node => node.props['aria-label'] === label)
  const rows = () => render().filter(node => node.props['aria-label']?.startsWith('查看分支 '))
  assert.equal(rows().length, 12)
  assert.equal(rows()[0].props['aria-label'], '查看分支 B1')
  find('下一页分支').props.onClick()
  assert.equal(rows()[0].props['aria-label'], '查看分支 B13')
  find('搜索分支').props.onChange({ target: { value: '条件 30' } })
  assert.equal(rows().length, 1)
  assert.equal(rows()[0].props['aria-label'], '查看分支 B30')
  assert.ok(render().some(node => node.type === 'button' && node.children[0] === 'TC1'))
  find('搜索分支').props.onChange({ target: { value: '' } })
  find('查看步骤 S2 的分支').props.onClick()
  assert.equal(rows().length, 1)
  assert.equal(rows()[0].props['aria-label'], '查看分支 B31')
  find('查看未挂接分支').props.onClick()
  assert.equal(rows()[0].props['aria-label'], '查看分支 B32')
  find('查看全部分支').props.onClick()
  find('筛选分支').props.onChange({ target: { value: 'timeout' } })
  assert.equal(rows().length, 12)
  find('下一页分支').props.onClick()
  assert.equal(rows().length, 3)
  assert.ok(rows().every(node => Number(node.props['aria-label'].match(/B(\d+)/)[1]) % 2 === 1))
  await find('绘制本页分支').props.onClick()
  const drawing = requests.find(request => request.action === 'architecture-create')
  assert.ok(drawing)
  assert.equal(drawing.flow_id, 'F1')
  assert.match(drawing.instruction, /B25、B27、B29/)
  assert.match(drawing.instruction, /本页 3 条.*筛选结果 15 条/)
  assert.doesNotMatch(drawing.instruction, /B1、/)
  assert.equal(openedSessions.length, 0, 'background drawing must keep the user in the flow page')
  assert.equal(rows().length, 0)
  assert.ok(find('架构图类型'))
  find('流程阅读视图').props.onClick()
  assert.equal(rows().length, 3)
})

test('selected task overview shows loading until its workbench request settles and preserves real errors', async () => {
  for (const [workbench, pending, failure, loadingExpected] of [[undefined, false, undefined, true], [{ tasks: { items: [] } }, true, undefined, true], [undefined, false, 'fixture backend unavailable', false]]) {
    const states = { 1: workbench, 3: failure, 5: 'selected-task', 9: pending, 16: { type: 'overview' } }
    let index = 0
    const client = await loadClientExports({ ...fakeReact(), useState(initial) { const key = index++; return [Object.hasOwn(states, key) ? states[key] : initial, () => {}] } })
    const pages = [], ctx = { pangea: { registerPage(page) { pages.push(page) } }, effect(fn) { return fn() } }
    client.apply(ctx)
    const panel = pages.find(page => page.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true })
    const nodes = descendants(panel.type(panel.props))
    assert.equal(nodes.some(node => node.props.role === 'status' && node.children.flat().includes('正在读取分析任务…')), loadingExpected)
    assert.equal(nodes.some(node => node.type === 'button' && node.children.includes('返回任务列表')), !loadingExpected)
    if (failure) assert.ok(nodes.some(node => node.props.role === 'alert'))
  }
})

test('new analysis binds no Run while preparing and registers the analysis destination before opening its session', { timeout: 2000 }, async () => {
  const task = { task_id: 'new-task', title: 'New analysis', run_id: null, data_root: '/data', status: 'preparing' }
  const workbench = { compatibility: { compatible: true }, tasks: { items: [] }, acp_providers: [{ id: 'external', registered: true }] }
  const states = { 1: workbench, 4: 'previous-run', 16: { type: 'create' }, 33: { repository: 'repo', target: 'synthetic', source_scope_text: 'request.c', asset_ids: [], scenario: 'module-analysis', mode: 'speed', provider_id: 'external', model_route_key: '', agent_model: 'selected' } }
  let index = 0, releaseStart, enteredStart, refreshed
  const preparing = new Promise(resolve => { enteredStart = resolve })
  const started = new Promise(resolve => { releaseStart = resolve })
  const complete = new Promise(resolve => { refreshed = resolve })
  const actions = []
  const client = await loadClientExports({ ...fakeReact(), useState(initial) {
    const key = index++
    if (!Object.hasOwn(states, key)) states[key] = initial
    return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value }]
  } }, async (_url, options) => {
    const action = options.body ? JSON.parse(options.body).action : 'get'
    if (action === 'task-create') return { ok: true, async json() { return { status: 'ok', task } } }
    if (action === 'task-start') { enteredStart(); await started; return { ok: true, async json() { return { status: 'ok', session_id: 'new-session' } } } }
    refreshed()
    return { ok: true, async json() { return { status: 'ok', ...workbench, tasks: { items: [task] } } } }
  })
  const pages = [], ctx = { sessions: { open(id) { actions.push(['open', id]) } }, pangea: {
    registerPage(page) { pages.push(page) }, registerProductSession(id, page) { actions.push(['register', id, page]) }, selectTask() {},
  }, effect(fn) { return fn() } }
  client.apply(ctx)
  const panel = pages.find(page => page.id === 'analysis').component({ ctx, scope: { cwd: '/workspace', sessionId: 'old-session' }, visible: true })
  descendants(panel.type(panel.props)).find(node => node.type === 'button' && node.children.includes('创建分析任务')).props.onClick()
  await preparing
  const preparingRun = states[4]
  releaseStart()
  await complete
  assert.equal(preparingRun, null)
  assert.deepEqual(actions.slice(0, 2), [['register', 'new-session', 'analysis'], ['open', 'new-session']])
  assert.equal(states[5], 'new-task')
  assert.equal(states[16].type, 'overview')
})

test('coverage browser pages raw gaps, resets filters and ignores stale Run responses', async () => {
  const states = [], effects = [], calls = []
  let index = 0, effectKey, cleanup
  const react = { ...fakeReact(), useState(initial) {
    const key = index++
    if (!(key in states)) states[key] = initial
    return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value }]
  }, useEffect(fn, deps) {
    if (deps[0] !== effectKey) { cleanup?.(); effectKey = deps[0]; effects.push(() => { cleanup = fn() }) }
  } }
  const client = await loadClientExports(react, (_url, options) => new Promise(resolve => calls.push({ body: JSON.parse(options.body), resolve })))
  let props = { cwd: '/workspace', task: { task_id: 'task', run_id: 'run' }, runId: 'run', revision: 1,
    target: 'SecureLink', gaps: [], flows: [{ flow_id: 'F1' }], filters: { query: '' }, onFilter() {}, renderLinks: item => item.gap_id }
  const render = () => { index = 0; const nodes = descendants(client.CoverageBrowser(props)); while (effects.length) effects.shift()(); return nodes }
  const reply = async (call, runId, items, total, next_cursor) => {
    call.resolve({ ok: true, json: async () => ({ status: 'ok', run_id: runId, page: { items, total, next_cursor,
      scope_summary: { total: 80, in_scope: 1, out_of_scope: 1, unresolved: 0, unclassified: 78, designed_in_scope: 0 } } }) })
    await new Promise(resolve => setImmediate(resolve))
  }
  let nodes = render()
  assert.equal(calls[0].body.cursor, 0)
  assert.equal(calls[0].body.task_id, 'task')
  await reply(calls[0], 'run', [{ gap_id: 'GAP-1', file_path: 'a.c', kind: 'function', raw: 'open', scope_status: 'unclassified' }], 80, 50)
  nodes = render()
  assert.ok(nodes.some(n => n.type === 'summary' && n.children[0].includes('GAP-1 · 未判定')))
  assert.ok(nodes.some(n => n.props['aria-label'] === '覆盖缺口范围统计'))
  nodes.find(n => n.type === 'button' && n.children[0] === '下一页').props.onClick()
  nodes = render()
  assert.equal(calls[1].body.cursor, 50)
  nodes.find(n => n.props['aria-label'] === '全部范围').props.onChange({ target: { value: 'in_scope' } })
  render()
  assert.equal(calls[2].body.cursor, 0)
  assert.equal(calls[2].body.scope_status, 'in_scope')
  await reply(calls[1], 'run', [{ gap_id: 'STALE' }], 80, null)
  nodes = render()
  assert.ok(!nodes.some(n => n.type === 'summary'))
  await reply(calls[2], 'run', [{ gap_id: 'GAP-2', file_path: 'a.c', kind: 'function', scope_status: 'in_scope' }], 1, null)
  nodes = render()
  assert.ok(nodes.some(n => n.type === 'summary' && n.children[0].includes('GAP-2')))
  props = { ...props, runId: 'new-run', task: { task_id: 'new-task', run_id: 'new-run' } }
  nodes = render()
  assert.equal(calls[3].body.run_id, 'new-run')
  assert.ok(!nodes.some(n => n.type === 'summary'))
  await reply(calls[3], 'run', [{ gap_id: 'WRONG-RUN' }], 1, null)
  assert.ok(!render().some(n => n.type === 'summary'))
  cleanup?.()
})

test('flow names remain drafts until steps exist and straight paths need no branches', async () => {
  const client = await loadClientExports()
  assert.equal(client.flowContentState({ title: 'title only' }), '流程内容待补齐')
  assert.equal(client.flowContentState({ mainline_steps: [] }), '流程内容待补齐')
  assert.equal(client.flowContentState({ mainline_steps: [{ step_id: 'S1' }], branches: [] }), '已有步骤')
})
