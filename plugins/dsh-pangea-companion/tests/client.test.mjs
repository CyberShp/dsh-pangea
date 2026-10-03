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
  const states = { 1: { compatibility: { compatible: true }, capabilities: { repositories: ['repo'] }, acp_providers: [{ id: 'pangea-opencode', registered: true }] }, 16: { type: 'create', createStep: 2 }, 33: form, 34: { assets: [{ asset_id: 'tagged', title: '仓库需求', asset_type: 'requirement' }] } }
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

test('new analysis reference-source placeholder matches the approved prototype', async () => {
  const form = { repository: 'repo', target: 'CPU 使用率计算分析', source_scope_text: 'src/cpuload.c', context_scope_text: '', asset_ids: [], scenario: 'module-analysis', mode: 'depth', provider_id: '', model_route_key: '' }
  const states = {
    1: { compatibility: { compatible: true }, capabilities: { repositories: ['repo'] }, acp_providers: [] },
    16: { type: 'create', createStep: 1 },
    33: form,
    34: { assets: [] },
  }
  let index = 0
  const client = await loadClientExports({ ...fakeReact(), useState(initial) {
    const key = index++
    return [Object.hasOwn(states, key) ? states[key] : initial, () => {}]
  } })
  const pages = []
  const ctx = { pangea: { registerPage(page) { pages.push(page) } }, effect(fn) { return fn() } }
  client.apply(ctx)
  const panel = pages.find(page => page.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true })
  const sourceScope = descendants(panel.type(panel.props)).find(node => node.type === 'textarea' && node.props['aria-label'] === '参考源码范围')
  assert.equal(sourceScope.props.placeholder, '例如：tests/cpuload_test.c')
})

test('empty model catalog preserves a saved reasoning effort as disabled without making creation ready', async () => {
  for (const [savedRoute, expectedValue, expectedLabel] of [
    [null, '', '默认'],
    [{ provider: 'openai', model: 'gpt-5.4', reasoning_effort: 'high' }, 'high', '高'],
  ]) {
    let index = 0, fetchCalls = 0
    const form = { repository: 'dperf', target: 'CPU 使用率计算分析', source_scope_text: 'src/cpuload.c\nsrc/cpuload.h',
      asset_ids: ['asset-requirement', 'asset-design', 'asset-defect'], scenario: 'module-analysis', mode: 'depth',
      provider_id: '', model_route_key: '', agent_model: '' }
    const states = {
      1: { compatibility: { compatible: true }, capabilities: { repositories: ['dperf'], workflow_versions: ['source-first-v1'],
        source_first: { version: 'source-first-v1', analysis_options_by_profile: { 'behavior-test-v2': { scenarios: ['module-analysis'], modes: ['depth'] } } } },
        model_routing: { status: 'ok', models: [] }, acp_providers: [] },
      16: { type: 'create', createStep: 3 },
      33: form,
      34: { assets: [] },
      49: {
        'asset-requirement': { asset_id: 'asset-requirement', title: 'CPU 采样与利用率需求', asset_type: 'requirement', revision: 3, input_revision: 'r3' },
        'asset-design': { asset_id: 'asset-design', title: 'CPU 负载计算设计说明', asset_type: 'design', revision: 2, input_revision: 'r2' },
        'asset-defect': { asset_id: 'asset-defect', title: '历史问题：采样间隔异常', asset_type: 'historical_defect', revision: 1, input_revision: 'r1' },
      },
    }
    const executionStorage = new Map([['pangea-execution:/workspace', JSON.stringify({
      provider_id: '', agent_model: '', ...(savedRoute ? { model_route: savedRoute } : {}),
    })]])
    const react = {
      ...fakeReact(),
      useState(initial) {
        const key = index++
        if (!(key in states)) states[key] = initial
        return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value }]
      },
      useEffect(effect) {
        if (String(effect).includes('const saved = JSON.parse(window.localStorage')) effect()
      },
    }
    const client = await loadClientExports(react, async () => { fetchCalls++; throw new Error('unexpected request') }, () => {}, {
      localStorage: { getItem: key => executionStorage.get(key) ?? null, setItem: (key, value) => executionStorage.set(key, value) },
    })
    const pages = [], ctx = { pangea: { registerPage(page) { pages.push(page) } }, effect(fn) { return fn() } }
    client.apply(ctx)
    const render = () => {
      index = 0
      const panel = pages.find(page => page.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true })
      return descendants(panel.type(panel.props))
    }
    render() // Run the component's existing workspace-scoped saved-selection restore effect.
    const nodes = render()
    const reasoning = nodes.find(node => node.type === 'select' && node.props['aria-label'] === '推理级别')
    assert.equal(reasoning.props.disabled, true)
    assert.equal(reasoning.props.value, expectedValue)
    assert.equal(reasoning.children[0].children[0], expectedLabel)
    const continueButton = nodes.find(node => node.type === 'button' && node.props.className === 'create-disabled')
    assert.equal(continueButton.props.disabled, true)
    assert.equal(fetchCalls, 0)
  }
})

async function loadClientExports(react = fakeReact(), fetcher = async () => { throw new Error('fetch must not run during registration') }, onEvent = () => {}, windowProperties = {}) {
  const source = await readFile(clientPath, 'utf8')
  let exported
  const sandbox = { URLSearchParams, AbortController, console, fetch: fetcher, setInterval, clearInterval,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail } } }
  sandbox.window = { dispatchEvent: onEvent, setInterval, clearInterval, setTimeout: (...args) => setTimeout(...args).unref(), clearTimeout, ...windowProperties, __ModuleLoader__: { load(spec) { exported = spec.factory(name => name === 'react' ? react : {}) } } }
  vm.runInNewContext(source, sandbox, { filename: clientPath })
  return exported
}

function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants)
  if (node?.type?.name === 'RunWorkspace') return descendants(node.type(node.props))
  if (!node?.children) return []
  return [node, ...node.children.flatMap(descendants)]
}

test('incremental dialog preserves exact record identity and literal changed paths', async () => {
  const client = await loadClientExports()
  let input
  let state = { title: 'TLS', run_id: 'parent-run', pending: '', error: '',
    options: { can_derive: true, units: [], records: [
      { action_id: 'analysis-a', record_id: 'rec-1', title: '连接失败', kind: 'test_case' },
      { action_id: 'analysis-b', record_id: 'rec-1', title: '资源释放', kind: 'test_case' },
    ] },
    draft: { mode: 'changed-files', instruction: '检查删除后的清理路径', changed_paths_text: 'src\\tcp\\tls.c\n源码/删除.c\nsrc\\tcp\\tls.c', selected_unit_ids: [], selected_records: [], query: '' } }
  const render = () => descendants(client.RunDerivationDialog({ state, onChange: draft => { state = { ...state, draft } }, onSubmit: value => { input = value }, onClose() {} }))
  render().find(node => node.props['aria-label'] === '选择记录 资源释放').props.onChange({ target: { checked: true } })
  assert.equal(render().find(node => node.props['aria-label'] === '选择记录 连接失败').props.checked, false)
  render().find(node => node.children.includes('创建并开始分析')).props.onClick()
  assert.deepEqual(JSON.parse(JSON.stringify(input)), { mode: 'changed-files', instruction: '检查删除后的清理路径',
    changed_paths: ['src\\tcp\\tls.c', '源码/删除.c'], selected_unit_ids: [], selected_records: [{ action_id: 'analysis-b', record_id: 'rec-1' }] })
  render().find(node => node.children.includes('定向补充')).props.onClick()
  render().find(node => node.children.includes('创建并开始分析')).props.onClick()
  assert.deepEqual(Array.from(input.changed_paths), [])
})

test('incremental dialog blocks incomplete input and retains request errors for retry', async () => {
  const client = await loadClientExports()
  const draft = { mode: 'changed-files', instruction: '检查改动', changed_paths_text: '', selected_unit_ids: [], selected_records: [] }
  const render = value => descendants(client.RunDerivationDialog({ state: { title: 'TLS', run_id: 'parent', draft, pending: '', options: { can_derive: true }, ...value }, onChange() {}, onClose() {}, onSubmit() {}, onRetry() {} }))
  assert.equal(render().find(node => node.children.includes('创建并开始分析')).props.disabled, true)
  assert.equal(render({ draft: { ...draft, changed_paths_text: 'src/tls.c' } }).find(node => node.children.includes('创建并开始分析')).props.disabled, false)
  const blocked = render({ options: { can_derive: false, blocked_reason: '原分析源码快照缺失' } })
  assert.match(JSON.stringify(blocked), /原分析源码快照缺失/)
  assert.equal(blocked.find(node => node.children.includes('创建并开始分析')).props.disabled, true)
  const failed = render({ options: null, error: '暂时无法读取来源' })
  assert.ok(failed.find(node => node.children.includes('重新读取')))
  const creating = render({ pending: 'create' })
  assert.equal(creating.find(node => node.props['aria-label'] === '关闭增量分析').props.disabled, true)
  assert.equal(creating.find(node => node.children.includes('正在创建…')).props.disabled, true)
})

test('overview derivation loads only its bound Run and is disabled during execution', async () => {
  for (const running of [false, true]) {
    const task = { task_id: 'parent-task', run_id: 'parent-run', title: 'TLS分析', repository: 'repo', status: running ? 'running' : 'completed', execution_status: running ? 'running' : 'succeeded' }
    const current = { run_id: task.run_id, workflow_version: 'source-first-v1', terminal: !running, lifecycle_status: running ? 'running' : 'complete', details: {}, workflow: { steps: [], units: [], actions: [] } }
    const states = { 0: { status: 'ok', current }, 1: { compatibility: { compatible: true }, tasks: { items: [task] } }, 4: task.run_id, 5: task.task_id, 16: { type: 'overview' } }
    let index = 0
    const requests = []
    const react = { ...fakeReact(), useState(initial) { const key = index++; if (!(key in states)) states[key] = initial; return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value }] } }
    const client = await loadClientExports(react, async (url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ status: 'ok', options: { can_derive: true, records: [], units: [] } }) } })
    const pages = [], ctx = { pangea: { registerPage(page) { pages.push(page) } }, effect(fn) { return fn() } }
    client.apply(ctx)
    const panel = pages.find(page => page.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true })
    const nodes = descendants(panel.type(panel.props))
    const button = nodes.find(node => node.children.includes('补充 / 增量分析'))
    assert.equal(button.props.disabled, running)
    if (!running) {
      button.props.onClick()
      await new Promise(resolve => setImmediate(resolve))
      assert.deepEqual(requests, [{ action: 'derivation-options', task_id: 'parent-task', run_id: 'parent-run' }])
    }
  }
})

test('v2 Run navigation follows risk presentation instead of populated historical risk counts', async () => {
  const client = await loadClientExports()
  for (const enabled of [true, false]) {
    const current = { run_id: 'scene-navigation', analysis_profile: 'behavior-test-v2', analysis_scene: { presentation: { risks: enabled } }, counts: { risks: 7 }, workflow: { steps: [] } }
    let destination
    const nodes = descendants(client.RunWorkspace({ current, task: { run_id: current.run_id }, navigate(value) { destination = value } }))
    const risk = nodes.find(node => node.type === 'button' && node.children.includes('风险'))
    assert.equal(Boolean(risk), enabled)
    if (risk) { risk.props.onClick(); assert.equal(destination, 'risks') }
  }
})

test('completed workflow distinguishes missing report, partial delivery and review verdict', async () => {
  const client = await loadClientExports()
  const current = { run_id: 'run-quality', lifecycle_status: 'complete', terminal: true,
    workflow: { steps: [], units: [], actions: [] }, details: {},
    delivery_integrity: { status: 'incomplete' }, semantic_review: { method: 'self_review', verdict: 'UNRESOLVED' } }
  const render = value => client.RunWorkspace({ current: value, task: { run_id: value.run_id }, navigate() {} })
  const missing = render(current)
  assert.match(JSON.stringify(missing), /当前没有已验证可读取的分析报告/)
  assert.ok(!descendants(missing).some(node => node.type === 'button' && node.children.includes('查看报告')))
  assert.match(JSON.stringify(missing), /UNRESOLVED（审查者结论）/)
  assert.match(JSON.stringify(missing), /交付不完整/)
  const partial = render({ ...current, partial_delivery: true, report_available: true, artifacts: { report_html: '/runs/run-quality/report.html' } })
  assert.match(JSON.stringify(partial), /未解决事项随已有结果保留/)
  assert.ok(descendants(partial).some(node => node.type === 'button' && node.children.includes('查看报告')))
})

test('workflow exposes unreadable collections without presenting them as zero results', async () => {
  const client = await loadClientExports()
  const current = { run_id: 'missing-artifacts', lifecycle_status: 'complete', terminal: true,
    workflow: { steps: [] }, counts: { business_flows: 0, test_cases: 0 },
    reader_health: { status: 'warning', issues: ['分析单元任务不可读取'], collection_status: { business_flows: 'unavailable', test_cases: 'unavailable' } } }
  const nodes = descendants(client.RunWorkspace({ current, task: { run_id: current.run_id }, navigate() {}, retry() {} }))
  assert.ok(nodes.some(node => node.props.role === 'alert' && JSON.stringify(node).includes('分析单元任务不可读取')))
  const counts = nodes.filter(node => node.type === 'small' && node.props.title === '产物暂不可读取')
  assert.equal(counts.length, 2)
  assert.ok(counts.every(node => node.children.includes('—')))
})

test('open stop dialog rejects stale, stopping and terminal state', async () => {
  for (const kind of ['stale', 'stopping', 'terminal']) {
    let index = 0, calls = 0
    const client = await loadClientExports({ ...fakeReact(), useState(initial) { return [index++ === 2 ? true : initial, () => {}] } })
    const current = { run_id: 'r', lifecycle_status: kind === 'terminal' ? 'complete' : 'running', terminal: kind === 'terminal', workflow: { steps: [] } }
    const rendered = client.RunWorkspace({ current, task: { run_id: 'r', execution_status: kind === 'stopping' ? 'stopping' : 'running' }, error: kind === 'stale' ? 'offline' : null, stop() { calls++ } })
    const confirm = descendants(rendered).find(node => node.type === 'button' && node.children.includes('确认停止'))
    assert.equal(confirm.props.disabled, true, kind)
    await confirm.props.onClick()
    assert.equal(calls, 0, kind)
  }
})

test('taskless attention disables delivery and corrupt snapshot does not claim frozen', async () => {
  const client = await loadClientExports()
  const current = { run_id: 'r', lifecycle_status: 'running', needs_user: true, source_snapshot: { file_count: 2, status: 'corrupt' }, workflow: { steps: [] } }
  const rendered = client.RunWorkspace({ current })
  const deliver = descendants(rendered).find(node => node.type === 'button' && node.children.includes('交付已有结果'))
  assert.equal(deliver.props.disabled, true)
  assert.match(JSON.stringify(rendered), /无法继续执行或交付/)
  assert.match(JSON.stringify(rendered), /资料损坏，待检查/)
  assert.doesNotMatch(JSON.stringify(rendered), /已冻结|基于冻结/)
  const verified = client.RunWorkspace({ current: { ...current, source_snapshot: { file_count: 2, status: 'manifest_verified' } } })
  assert.match(JSON.stringify(verified), /2 个文件 · 已冻结/)
  assert.match(JSON.stringify(verified), /基于冻结的源码快照/)
  assert.doesNotMatch(JSON.stringify(verified), /尚未验证|资料损坏/)
})

test('legacy terminal phase takes precedence over stale running task state', async () => {
  const client = await loadClientExports()
  for (const [phase, label] of [['COMPLETE', '已完成'], ['FAILED', '分析失败'], ['STOPPED', '已停止']]) {
    const result = client.deriveRunPresentation({ run_id: 'legacy', status: 'running', execution_status: 'running' }, { run_id: 'legacy', terminal: true, phase })
    assert.equal(result.executionLabel, label)
    assert.equal(result.running, false)
  }
})

test('planning detail includes formal source_first_plan action', async () => {
  let index = 0
  const client = await loadClientExports({ ...fakeReact(), useState(initial) { return [index++ === 1 ? 'tasks' : initial, () => {}] } })
  const current = { run_id: 'r', stage: 'planning', lifecycle_status: 'running', workflow: { steps: [{ step: '02', stage: 'planning', title: '规划', status: 'running' }], actions: [{ action_id: 'plan-real', stage: 'source_first_plan', status: 'dispatched' }] } }
  assert.match(JSON.stringify(client.RunWorkspace({ current })), /plan-real/)
})

test('stopped workflow explains why continuation is unavailable', async () => {
  const client = await loadClientExports()
  const current = { run_id: 'run-stop', lifecycle_status: 'stopped', terminal: true, workflow: { steps: [] } }
  const rendered = client.RunWorkspace({ current, task: { run_id: current.run_id, can_resume: false, resume_blocked_reason: '旧执行停止尚未确认' }, navigate() {} })
  assert.match(JSON.stringify(rendered), /旧执行停止尚未确认/)
  assert.ok(!descendants(rendered).some(node => node.type === 'button' && node.children.includes('继续分析')))
})

test('module analysis queries coverage, selects partial results and removes stale selection on failed requery', async () => {
  let index = 0, resolveQuery
  const form = { repository: 'repo', target: 'TLS', source_scope_text: 'tls', asset_ids: ['design'], scenario: 'module-analysis', mode: 'depth',
    provider_id: 'pangea-opencode', coverage_product: 'PANGEA', coverage_version: ' V600R013C00 ', coverage_module: 'nvme tcp', coverage_b_version: '' }
  const states = { 1: { data_root: '/workspace/custom-data', compatibility: { compatible: true }, capabilities: {
    repositories: ['repo'], workflow_versions: ['source-first-v1'], coverage_query_skill: { available: true } },
    acp_providers: [{ id: 'pangea-opencode', registered: true }] }, 16: { type: 'create', createStep: 2, createView: 'coverage' }, 33: form }
  const calls = []
  const react = { ...fakeReact(), useState(initial) {
    const key = index++
    if (!(key in states)) states[key] = initial
    return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value }]
  } }
  const client = await loadClientExports(react, async (url, options) => {
    calls.push(JSON.parse(options.body))
    return new Promise(resolve => { resolveQuery = acquisition => resolve({ ok: true, json: async () => ({ status: 'ok', acquisition }) }) })
  })
  const pages = [], ctx = { pangea: { registerPage(page) { pages.push(page) } }, effect(fn) { return fn() } }
  client.apply(ctx)
  const render = () => {
    index = 0
    const panel = pages.find(page => page.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true })
    return descendants(panel.type(panel.props))
  }
  const button = nodes => nodes.find(node => node.type === 'button' && (node.children.includes('查询并添加') || node.children.includes('重新查询')))
  const first = button(render()).props.onClick()
  assert.equal(calls[0].action, 'coverage-query')
  assert.equal(calls[0].query.c_version, ' V600R013C00 ')
  assert.equal(calls[0].data_root, '/workspace/custom-data')
  assert.equal(render().find(node => node.children.includes('正在查询…')).props.disabled, true)
  resolveQuery({ status: 'partial', record_count: 4, asset: { asset_id: 'query-1', title: '内网覆盖率', asset_type: 'coverage', status: 'available' },
    missing: ['summary/branch'], warnings: ['部分数据'], query_input: calls[0].query })
  await first
  assert.deepEqual(Array.from(states[33].asset_ids), ['design', 'query-1'])
  let nodes = render()
  assert.ok(nodes.some(node => node.props['aria-label'] === '移除资产 内网覆盖率'))
  const request = client.buildAnalysisRequest(states[33])
  assert.deepEqual(Array.from(request.asset_ids), ['design', 'query-1'])
  assert.equal(request.coverage_input, undefined)
  const retry = button(nodes).props.onClick()
  resolveQuery({ status: 'error', asset: null, message: '版本匹配失败' })
  await retry
  assert.deepEqual(Array.from(states[33].asset_ids), ['design'])
  nodes = render()
  assert.ok(nodes.some(node => node.children.includes('版本匹配失败')))
  states[1].capabilities.coverage_query_skill.available = false
  assert.equal(button(render()).props.disabled, true)
})

for (const providerId of ['pangea-nga', 'pangea-opencode', 'pangea-codeagent', 'pangea-claude-code']) {
  test(`new analysis selects advertised ${providerId} models and clears selection when changing Agent`, async () => {
    let index = 0, phase = 'form', changed
    const form = { repository: 'repo', target: 'analysis', source_scope_text: '.', asset_ids: [], provider_id: providerId, agent_model: '' }
    const states = { 1: { compatibility: { compatible: true }, acp_providers: [{ id: providerId, registered: true }] },
      16: { type: 'create', createStep: 3 }, 33: form }
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

test('overview keeps configured review method separate from live review status', async () => {
  const client = await loadClientExports()
  assert.equal(client.configuredReviewMethod({ analysis_settings: { scenario: 'module-analysis', mode: 'depth' } }), '未记录')
  assert.equal(client.configuredReviewMethod({ analysis_settings: { review_method: '独立盲审＋对照复核' } }), '独立盲审＋对照复核')

  const cases = [
    [{ method: 'graph_review', verdict: 'PASS' }, 'Graph 复核结果 · PASS'],
    [{ method: 'independent_pending', verdict: null }, '待独立核验'],
    [{ method: 'independent_verified', verdict: 'UNRESOLVED' }, '宿主已核验执行 · 结论 UNRESOLVED'],
    [{ method: 'independent_declared', verdict: 'PASS' }, 'Agent 已声明 · 结论 PASS · 宿主待核验'],
    [{ method: 'self_review', verdict: 'UNRESOLVED' }, '自审结果 · UNRESOLVED'],
    [{ method: 'unavailable', verdict: null }, '审查记录不可读取'],
    [{ method: 'not_recorded', verdict: null }, '未记录'],
  ]
  for (const [semantic_review, expected] of cases) assert.equal(client.semanticReviewStatusLabel({ semantic_review }), expected)
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
  assert.match(source, /运行阶段/)
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
  assert.match(source, /stop: \(\) => stopCurrentRun\(true\)/, 'the overview delegates Run controls to the workflow workspace')
  assert.match(source, /启动错误/)
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
  assert.match(source, /分析发现与验证缺口/)
  assert.match(source, /本次执行/)
  assert.match(source, /用例尚未编号，不能选择/)
  assert.match(source, /filter\(hasText\)/)
  assert.match(source, /← 返回/)
  assert.match(source, /数据状态/)
  assert.match(source, /数据读取异常/)
  assert.match(source, /renderIssueCard\('未解决事项'/)
  assert.doesNotMatch(source, /JSON\.stringify\(workflow\.unresolved/)
  assert.match(source, /空风险列表本身不代表读取失败/)
  assert.match(source, /不能把空列表解释为/)
  assert.match(source, /AbortController/)
  assert.match(source, /const ACTIVE_POLL_INTERVAL_MS = 2_000/)
  assert.match(source, /const IDLE_POLL_INTERVAL_MS = 45_000/)
  assert.match(source, /snapshotPollInterval\(value\)/)
  assert.match(source, /同步失败，继续显示上次结果/)
  assert.match(source, /finally \{[\s\S]*sequence === workbenchRequestRef\.current\.sequence\) setWorkbenchLoading\(false\)/)
  assert.match(source, /\['home', 'tasks', 'create', 'repository-import', 'report'\]\.includes\(screen\.type\).*header/)
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
  assert.match(source, /查看分析报告/)
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
  assert.equal(pages[3].available(), false)
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
  assert.equal(failed.dataStateLabel, '尚待读取验证')
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
  assert.equal(running.dataStateLabel, '尚待读取验证')
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
  assert.equal(failedDraft.dataStateLabel, '数据可读取')
  assert.equal(failedDraft.executionLabel, '分析失败')
  assert.equal(failedDraft.qualityLabel, '未给出语义结论')
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

  const userPaused = exported.deriveRunPresentation(
    { status: 'needs_attention', execution_status: 'paused', run_id: 'run-paused', can_resume: true },
    { run_id: 'run-paused', lifecycle_status: 'running', terminal: false, needs_user: true, publication: { state: 'draft' } },
    { status: 'pending' },
  )
  assert.equal(userPaused.failed, false)
  assert.equal(userPaused.needsAttention, true)
  assert.equal(userPaused.running, false)
  assert.equal(userPaused.isAnimating, false)
  assert.equal(userPaused.executionLabel, '需要处理')
  assert.equal(userPaused.publicationLabel, 'draft')
  assert.equal(userPaused.canResume, true)
})

test('partial publication keeps readable report collection counts available', async () => {
  const client = await loadClientExports()
  const task = { task_id: 'task-partial', run_id: 'run-partial', status: 'completed', execution_status: 'completed' }
  const current = { run_id: 'run-partial', lifecycle_status: 'complete', terminal: true,
    publication: { state: 'partial' }, partial_delivery: true }
  const presentation = client.deriveRunPresentation(task, current, {
    status: 'ok', collection_status: { business_flows: 'readable', risks: 'readable', test_cases: 'readable' },
  })
  assert.equal(presentation.countsAvailability, 'partial')
  assert.equal(presentation.healthStatus, 'ok')
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
  const overview = source.slice(source.indexOf('function renderOverview()'), source.indexOf('function renderReport()'))
  const workflow = source.slice(source.indexOf('function renderWorkflow()'), source.indexOf('function renderFlows()'))

  assert.doesNotMatch(overview, /'当前任务'/)
  assert.doesNotMatch(overview, /'分析进度'/)
  assert.doesNotMatch(overview, /field\('质量结论'/)
  assert.doesNotMatch(overview, /field\('独立复核'/)
  assert.doesNotMatch(overview, /'运行记录'/, 'Run history stays in the task list instead of being repeated in the overview')
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

test('selected asset details are resolved by ID from the authoritative catalog endpoint', async () => {
  const client = await loadClientExports()
  const urls = []
  const controller = new AbortController()
  const asset = { asset_id: 'asset-requirement', title: 'CPU 采样需求', asset_type: 'requirement', revision: 3, input_revision: 'r3' }
  const detail = await client.requestAssetDetail({ cwd: '/workspace', assetId: asset.asset_id, signal: controller.signal,
    fetcher: async (url, options) => {
      urls.push(new URL(url, 'http://localhost'))
      assert.equal(options.cache, 'no-store')
      assert.equal(options.signal, controller.signal)
      return { ok: true, async json() { return { status: 'ok', asset } } }
    },
  })
  assert.deepEqual(JSON.parse(JSON.stringify(detail)), asset)
  assert.equal(urls[0].pathname, '/api/pangea-asset-catalog/state')
  assert.equal(urls[0].searchParams.get('cwd'), '/workspace')
  assert.equal(urls[0].searchParams.get('asset_id'), asset.asset_id)
  assert.equal(urls[0].searchParams.has('page'), false)
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
  assert.match(source, /需要关注的实现风险/)
  assert.match(source, /结论与影响/)
  assert.match(source, /直接源码依据/)
  assert.doesNotMatch(source, /严重度来自 SFMEA/)
  assert.match(source, /测试用例/)
  assert.match(source, /从分析发现到可验证步骤/)
  assert.match(source, /操作步骤与逐步预期/)
  assert.doesNotMatch(source, /置信度.*\?\? '—'/)
  assert.doesNotMatch(source, /TRANSLATION\[risk\.translation_status\].*未标注/)
  assert.doesNotMatch(source, /RISK_STATUS\[risk\.status\].*未标注/)
  assert.match(source, /text\(risk\.narrative, '风险说明未提供，请核对分析原文。'\)/)
  assert.match(source, /hasText\(risk\.blackbox_proof\)/)
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
  test(`renders ${screenType} with coverage hidden and legacy navigation safe`, async () => {
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
    assert.ok(!descendants(nav).some(node => node.type === 'button' && node.children[0] === '覆盖缺口'))
    if (screenType === 'coverage') {
      assert.equal(coverage, undefined)
      assert.ok(JSON.stringify(nodes).includes('超时恢复'))
      return
    }
    assert.match(active.children[0], /^业务流程 1$/)
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
  assert.ok(render().some(node => node.type === 'nav' && node.props['aria-label'] === '图表类型'))
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
  const states = { 1: workbench, 4: 'previous-run', 16: { type: 'create', createStep: 4 }, 33: { repository: 'repo', target: 'synthetic', source_scope_text: 'request.c', asset_ids: [], scenario: 'module-analysis', mode: 'speed', provider_id: 'external', model_route_key: '', agent_model: 'selected' } }
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
  descendants(panel.type(panel.props)).find(node => node.type === 'button' && node.children.includes('创建并开始分析')).props.onClick()
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

for (const body of [{ description: '真实风险说明', trigger: '边界输入', impact: '具体影响', expectation: '预期行为内容', unknown_field: '额外原始信息' }, '# Markdown 风险\n\n完整风险说明和触发细节']) {
  test(`risk page exposes ${typeof body} content and keeps case links scoped`, async () => {
    const { sourceFirstProjection } = await import('../src/source-first-projection.js')
    const details = sourceFirstProjection([{ action_id: 'run:analysis:a', task_id: 'job-a', task: { unit_id: 'a' }, stage: 'unit_analysis', status: 'accepted', revision: 2, result_path: '/data/runs/run/result.json', records: [
      { record_id: 'r', kind: 'risk', body }, { record_id: 'c', kind: 'test_case', body: { case_id: 'TC-1', title: '边界验证', risk_refs: ['r'] } },
    ] }])
    const task = { task_id: 'task', run_id: 'run', data_root: '/data', status: 'complete' }
    const current = { run_id: 'run', data_root: '/data', workflow_version: 'source-first-v1', lifecycle_status: 'complete', terminal: true, details }
    const states = { 0: { current, data_root: '/data' }, 1: { tasks: { items: [task] } }, 4: 'run', 5: 'task', 16: { type: 'risk', id: 'a/r' } }
    let index = 0, nextScreen
    const client = await loadClientExports({ ...fakeReact(), useState(initial) { const key = index++; return [Object.hasOwn(states, key) ? states[key] : initial, value => { if (key === 16) nextScreen = value }] } })
    const pages = [], ctx = { pangea: { registerPage(p) { pages.push(p) } }, effect(fn) { return fn() } }
    client.apply(ctx)
    const panel = pages.find(p => p.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true })
    const nodes = descendants(panel.type(panel.props))
    const rendered = JSON.stringify(nodes)
    assert.ok(rendered.includes(typeof body === 'string' ? '完整风险说明和触发细节' : '真实风险说明'))
    assert.ok(!rendered.includes('该项尚未记录'))
    assert.ok(nodes.some(n => n.type === 'details' && JSON.stringify(n).includes(typeof body === 'string' ? 'Markdown 风险' : '真实风险说明')), 'original risk record remains available')
    const nav = nodes.find(n => n.type === 'nav' && n.props['aria-label'] === 'PANGEA 分析页面')
    assert.ok(!JSON.stringify(nav).includes('复核'))
    const link = nodes.find(n => n.type === 'button' && n.children.some(value => String(value).includes('TC-1')))
    assert.ok(link)
    link.props.onClick()
    assert.equal(nextScreen.id, 'a/c')
  })
}

test('source-first create form disables unsupported analysis options', async () => {
  const form = { repository: 'repo', target: 'sample', source_scope_text: 'sample.c', asset_ids: [], scenario: 'module-analysis', mode: 'depth', provider_id: 'pangea-opencode' }
  const states = { 1: { compatibility: { compatible: true }, capabilities: { workflow_versions: ['source-first-v1'], repositories: ['repo'] }, acp_providers: [{ id: 'pangea-opencode', registered: true }] }, 16: { type: 'create' }, 33: form }
  let index = 0
  const client = await loadClientExports({ ...fakeReact(), useState(initial) { const key = index++; return [Object.hasOwn(states, key) ? states[key] : initial, () => {}] } })
  const pages = [], ctx = { pangea: { registerPage(p) { pages.push(p) } }, effect(fn) { return fn() } }
  client.apply(ctx)
  const panel = pages.find(p => p.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true })
  const nodes = descendants(panel.type(panel.props))
  for (const value of ['coverage-analysis', 'risk-analysis', 'branch-analysis']) assert.equal(nodes.find(n => n.props['data-scenario'] === value).props.disabled, true)
  assert.equal(nodes.find(n => n.type === 'option' && n.props.value === 'speed').props.disabled, true)
  assert.equal(nodes.find(n => n.type === 'option' && n.props.value === 'depth').props.disabled, false)
})


test('short case detail renders variants, opens unit notes and navigates to the explicit flow', async () => {
  const { sourceFirstProjection } = await import('../src/source-first-projection.js')
  const details = sourceFirstProjection([{ action_id: 'run:a', task: { unit_id: 'a' }, stage: 'unit_analysis', status: 'accepted', records: [
    { record_id: 'c', kind: 'test_case', body: { case_id: 'TC-1', entry: '共用操作', variants: [{ input: 'sha256', expected: '连接成功' }] } },
    { record_id: 'n', kind: 'note', body: '# 共用操作\nconnect --digest sha256' },
    { record_id: 'f', kind: 'flow', body: { flow_id: 'F-1', title: '连接流程', paths: [{ case_ids: ['TC-1'] }] } },
  ] }])
  const task = { task_id: 'task', run_id: 'run', data_root: '/data', status: 'complete' }
  const current = { run_id: 'run', data_root: '/data', workflow_version: 'source-first-v1', lifecycle_status: 'complete', terminal: true, details }
  const states = { 0: { current, data_root: '/data' }, 1: { tasks: { items: [task] } }, 4: 'run', 5: 'task', 16: { type: 'case', id: 'a/c' } }
  let index = 0, nextScreen
  const client = await loadClientExports({ ...fakeReact(), useState(initial) { const key = index++; return [Object.hasOwn(states, key) ? states[key] : initial, value => { if (key === 16) nextScreen = value }] } })
  const pages = [], ctx = { pangea: { registerPage(p) { pages.push(p) } }, effect(fn) { return fn() } }
  client.apply(ctx)
  const panel = pages.find(p => p.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true })
  const nodes = descendants(panel.type(panel.props))
  const rendered = JSON.stringify(nodes)
  for (const text of ['参数变体', 'sha256', '连接成功', '本分析单元说明', 'connect --digest sha256']) assert.ok(rendered.includes(text), text)
  const link = nodes.find(n => n.type === 'button' && n.children.some(value => String(value).includes('F-1')))
  assert.ok(link)
  link.props.onClick()
  assert.equal(nextScreen.type, 'flows')
})

test('reference scope form preserves the analysis target and emits separate reference paths', async () => {
  const form = { repository: 'repo', target: 'auth', source_scope_text: 'src/auth.c', context_scope_text: '', asset_ids: [], provider_id: 'pangea-opencode' }
  const states = { 1: { compatibility: { compatible: true }, capabilities: { repositories: ['repo'], workflow_versions: ['source-first-v1'] }, acp_providers: [{ id: 'pangea-opencode', registered: true }] }, 16: { type: 'create' }, 33: form }
  let index = 0, changed
  const client = await loadClientExports({ ...fakeReact(), useState(initial) { const key = index++; return [Object.hasOwn(states, key) ? states[key] : initial, value => { if (key === 33) changed = typeof value === 'function' ? value(form) : value }] } })
  const pages = [], ctx = { pangea: { registerPage(p) { pages.push(p) } }, effect(fn) { return fn() } }
  client.apply(ctx)
  const panel = pages.find(p => p.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true })
  const input = descendants(panel.type(panel.props)).find(n => n.props['aria-label'] === '参考源码范围')
  assert.ok(input)
  input.props.onChange({ target: { value: 'include/auth.h\ndocs/usage.md' } })
  const request = client.buildAnalysisRequest(changed)
  assert.deepEqual(Array.from(request.source_scope), ['src/auth.c'])
  assert.deepEqual(Array.from(request.context_scope), ['include/auth.h', 'docs/usage.md'])
  assert.equal(client.buildAnalysisRequest(form).context_scope, undefined)
})


test('run diagnostics remain attached to their selected Run and zero risks do not inherit other warnings', async () => {
  const c = await loadClientExports()
  assert.equal(c.collectionWarning({ status: 'warning', count_checks: {} }, 'risks'), false)
  assert.equal(c.collectionWarning({ count_checks: { risks: { status: 'mismatch' } } }, 'risks'), true)
  const task = { run_id: 'A' }, run = { run_id: 'A' }
  for (const type of ['tasks', 'home', 'create', 'environment']) assert.equal(c.showRunHealth({ type }, task, run, 'analysis'), false)
  assert.equal(c.showRunHealth({ type: 'risks' }, task, run, 'analysis'), true)
  assert.equal(c.showRunHealth({ type: 'risks' }, task, { run_id: 'B' }, 'analysis'), false)
  assert.equal(c.showRunHealth({ type: 'risks' }, task, run, 'execution'), false)
})

test('record renderer makes tables and JSON fields readable without HTML execution', async () => {
  const c = await loadClientExports()
  const tree = c.renderReadableBody('# 说明\n| 条件 | 结果 |\n| --- | --- |\n| A | B |\n<script>alert(1)</script>')
  const nodes = []
  const visit = n => { if (Array.isArray(n)) n.forEach(visit); else if (n?.children) { nodes.push(n); visit(n.children) } }
  visit(tree)
  assert.ok(nodes.some(n => n.type === 'table'))
  assert.ok(nodes.some(n => n.type === 'h2' && n.children.includes('说明')))
  assert.ok(nodes.some(n => n.props.role === 'region' && n.props.tabIndex === 0 && n.props['aria-label'] === '条件、结果'))
  assert.ok(nodes.filter(n => n.type === 'th').every(n => n.props.scope === 'col'))
  assert.ok(nodes.every(n => !n.props?.dangerouslySetInnerHTML && n.type !== 'script'))
  assert.ok(JSON.stringify(tree).includes('<script>alert(1)</script>'))
  assert.equal(c.renderReadableBody('{"title":"条件","gap":"需要连接"}').type, 'dl')
  assert.equal(c.artifactLabel('C:\\run\\inputs\\source-index.json'), '源码索引')
})

test('task filters can reset a no-results state without changing the selected task', async () => {
  let index = 0
  const states = {
    1: { compatibility: { compatible: true }, tasks: { items: [
      { task_id: 'T-1', title: '较旧 CPU 分析', repository: 'demo', status: 'completed', updated_at: '2026-09-20T08:00:00Z' },
      { task_id: 'T-2', title: '较新 CPU 分析', repository: 'demo', status: 'needs_attention', updated_at: '2026-09-24T08:00:00Z' },
      { task_id: 'T-3', title: 'TLS 握手检查', repository: 'demo', status: 'completed', updated_at: '2026-09-23T08:00:00Z' },
      { task_id: 'T-4', title: '请求队列分析', repository: 'demo', status: 'running', execution_status: 'running', updated_at: '2026-09-22T08:00:00Z' },
      { task_id: 'T-5', title: '配置回归分析', repository: 'demo', status: 'stopped', updated_at: '2026-09-21T08:00:00Z' },
    ] } },
    5: 'T-1', 6: '', 7: '全部',
  }
  const client = await loadClientExports({ ...fakeReact(), useState(initial) {
    const key = index++
    return [Object.hasOwn(states, key) ? states[key] : initial, value => { states[key] = typeof value === 'function' ? value(states[key]) : value }]
  } })
  const pages = [], ctx = { pangea: { registerPage(page) { pages.push(page) } }, effect(fn) { return fn() } }
  client.apply(ctx)
  const render = () => { index = 0; const panel = pages.find(page => page.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true }); return descendants(panel.type(panel.props)) }
  let nodes = render()
  const rowTitles = () => nodes.filter(n => n.type === 'tr' && n.props.className === 'pangea-task-row')
    .map(row => descendants(row).find(n => n.type === 'button' && n.props.className === 'b03-task-title')?.children[0])
  assert.deepEqual(rowTitles(), ['较新 CPU 分析', 'TLS 握手检查', '请求队列分析', '配置回归分析', '较旧 CPU 分析'], 'default task order follows most recent update')
  const statusFilter = nodes.find(n => n.type === 'button' && n.children.includes('需要处理'))
  assert.ok(statusFilter)
  statusFilter.props.onClick()
  assert.equal(states[7], 'needs_attention')
  nodes = render()
  assert.deepEqual(rowTitles(), ['较新 CPU 分析'], 'status filters keep matching rows')
  nodes.find(n => n.props.id === 'pangea-task-search').props.onChange({ target: { value: 'missing' } })
  assert.equal(states[6], 'missing')
  nodes = render()
  assert.ok(nodes.some(n => n.type === 'h2' && n.children.includes('没有找到匹配的任务')))
  nodes.find(n => n.type === 'button' && n.children.includes('清除筛选')).props.onClick()
  assert.equal(states[6], '')
  assert.equal(states[7], '全部')
  assert.equal(states[5], 'T-1')
  nodes = render()
  assert.deepEqual(rowTitles(), ['较新 CPU 分析', 'TLS 握手检查', '请求队列分析', '配置回归分析', '较旧 CPU 分析'])
  assert.ok(nodes.some(n => n.props['aria-label'] === '搜索分析任务'))
  assert.ok(nodes.some(n => n.type === 'span' && n.props.className === 'b03-task-sort' && n.children.includes('按最近更新排序')))
})

test('successful empty task catalog presents the first-use creation action and exact three-step guide', async () => {
  let index = 0
  const states = { 1: { compatibility: { compatible: true }, tasks: { items: [], total: 0 }, runs: { items: [] } }, 16: { type: 'tasks' } }
  const client = await loadClientExports({ ...fakeReact(), useState(initial) {
    const key = index++
    if (!Object.hasOwn(states, key)) states[key] = initial
    return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value }]
  } })
  const pages = [], ctx = { pangea: { registerPage(page) { pages.push(page) } }, effect(fn) { return fn() } }
  client.apply(ctx)
  const render = () => { index = 0; const panel = pages.find(page => page.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true }); return descendants(panel.type(panel.props)) }
  const nodes = render()
  const steps = nodes.find(node => node.props.className === 'b03-task-first-use-steps')
  assert.ok(steps)
  const stepCards = descendants(steps).filter(node => node.type === 'div' && node !== steps)
  assert.equal(stepCards.length, 3)
  assert.deepEqual(stepCards.map(card => descendants(card).find(node => node.type === 'strong')?.children[0]), ['确定目标', '补充资料', '查看结果'])
  assert.deepEqual(stepCards.map(card => descendants(card).find(node => node.type === 'p')?.children[0]), [
    '明确要分析的模块与源码范围。', '按需加入需求、设计和历史缺陷。', '在运行过程中查看阶段与产物。',
  ])
  assert.ok(nodes.some(node => node.type === 'p' && node.children.includes('从一个明确的分析目标开始。')))
  assert.ok(nodes.some(node => node.type === 'button' && node.children.includes('新建分析')))
  assert.ok(!nodes.some(node => node.type === 'button' && node.children.includes('添加仓库')))
  assert.ok(!nodes.some(node => node.props.className === 'b03-task-metrics' || node.props.className === 'b03-task-breadcrumb'))
  const createActions = nodes.filter(node => node.type === 'button' && node.children.includes('新建分析'))
  assert.equal(createActions.length, 2, 'the header action and first-use card action both remain visible as in the locked prototype')
  for (const action of createActions) {
    action.props.onClick()
    assert.equal(states[16].type, 'create')
    states[16] = { type: 'tasks' }
  }
})

test('task rows open their own Run and keep unlinked Runs in a read-only route', async () => {
  let index = 0
  const states = {
    1: {
      compatibility: { compatible: true },
      tasks: { items: [{ task_id: 'T-1', title: 'CPU分析', repository: 'dperf', target: 'CPU边界', run_id: 'run-23', status: 'completed' }] },
      runs: { items: [
        { run_id: 'run-23', task_id: 'T-1', target: 'CPU边界' },
        { run_id: 'run-18', target: 'CPU计时边界', repository: 'dperf' },
      ] },
    },
    4: null,
    5: undefined,
    16: { type: 'tasks' },
  }
  const client = await loadClientExports({ ...fakeReact(), useState(initial) {
    const key = index++
    if (!Object.hasOwn(states, key)) states[key] = initial
    return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value }]
  } })
  const selectedTasks = []
  const pages = [], ctx = { pangea: { registerPage(page) { pages.push(page) }, selectTask(id) { selectedTasks.push(id) } }, effect(fn) { return fn() } }
  client.apply(ctx)
  const render = () => { index = 0; const panel = pages.find(page => page.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true }); return descendants(panel.type(panel.props)) }
  let nodes = render()
  const ownRun = nodes.find(node => node.type === 'button' && node.props.className === 'b03-task-run' && node.props['aria-label']?.includes('RUN 23'))
  assert.ok(ownRun)
  ownRun.props.onClick()
  assert.equal(states[4], 'run-23')
  assert.equal(states[5], 'T-1')
  assert.equal(states[16].type, 'overview')

  states[5] = undefined
  states[4] = null
  states[16] = { type: 'tasks' }
  nodes = render()
  const unlinked = nodes.find(node => node.type === 'button' && node.children.includes('查看运行'))
  assert.ok(unlinked)
  unlinked.props.onClick()
  assert.equal(states[4], 'run-18')
  assert.equal(states[5], undefined)
  assert.equal(states[16].type, 'run-record')
  assert.equal(selectedTasks.at(-1), undefined)
})

test('unlinked Run opens a read-only record from the selected frozen snapshot', async () => {
  let index = 0
  let selectedScreen
  const current = {
    run_id: 'run-18', data_root: '/workspace/data', repository: 'dperf', target: 'CPU计时边界分析',
    lifecycle_status: 'complete', phase: 'COMPLETE', terminal: true, partial_delivery: true,
    report_available: true, delivery_integrity: { status: 'partial' },
    publication: { state: 'partial' },
    analysis_settings: { scenario: 'module-analysis', mode: 'standard' },
    started_at: '2026-09-20T07:47:00.000Z', ended_at: '2026-09-20T08:08:06.000Z',
    input_materials: [], artifacts: { report_md: 'data/report.md' },
    details: { business_flows: [{ flow_id: 'F-1', title: 'CPU读取' }], test_cases: [{ test_case_id: 'TC-1', title: '读取边界' }], risks: [], evidence: [], review_issues: [],
      notes: [{ kind: 'summary', source_record: { kind: 'summary', record_id: 'summary-18', revision: 2, status: 'accepted', body: { summary: 'CPU 使用率分析摘要。' } } }] },
    workflow: { units: [], unresolved: [{ id: 'CL-03', message: '跨周期状态重置的补充依据尚未完成。' }] }, analysis: { total: 1, completed: 1 },
  }
  const states = {
    0: { data_root: '/workspace/data', current },
    1: { compatibility: { compatible: true }, tasks: { items: [] }, runs: { items: [{ run_id: 'run-18', target: current.target }] } },
    4: 'run-18', 5: undefined, 16: { type: 'run-record' },
  }
  const client = await loadClientExports({ ...fakeReact(), useState(initial) {
    const key = index++
    if (!Object.hasOwn(states, key)) states[key] = initial
    return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value }]
  } })
  const pages = [], ctx = { pangea: { registerPage(page) { pages.push(page) } }, effect(fn) { return fn() } }
  client.apply(ctx)
  const render = () => { index = 0; const panel = pages.find(page => page.id === 'analysis').component({ ctx, scope: { cwd: '/workspace', sessionId: 'test-session' }, visible: true }); return descendants(panel.type(panel.props)) }
  let nodes = render()
  const record = nodes.find(node => node.type === 'div' && node.props['aria-label'] === '运行记录 · 只读')
  assert.ok(record)
  assert.equal(record.props['data-run-id'], 'run-18')
  assert.equal(record.props['data-task-id'], '')
  assert.equal(record.props['aria-readonly'], 'true')
  assert.ok(nodes.some(node => node.type === 'h1' && node.children.includes('CPU计时边界分析')))
  assert.ok(nodes.some(node => node.type === 'p' && node.children.includes('dperf / CPU计时边界分析 · RUN 18 · 9 月 20 日 16:08')))
  assert.ok(nodes.some(node => node.type === 'strong' && node.children.includes('此运行未关联分析任务')))
  assert.ok(nodes.some(node => node.type === 'p' && node.children.includes('可阅读保留的运行记录、冻结输入与交付摘要。')))
  assert.ok(nodes.some(node => node.type === 'section' && node.props['aria-label'] === '运行结果'))
  assert.ok(nodes.some(node => node.type === 'section' && node.props['aria-label'] === '冻结输入'))
  assert.ok(nodes.some(node => node.type === 'dd' && node.children.includes('9 月 20 日 15:47')))
  assert.ok(nodes.some(node => node.type === 'h3' && node.props.className === 'b03-run-record-summary-title' && node.children.includes('CPU计时边界分析')))
  assert.ok(nodes.some(node => node.type === 'p' && node.children.includes('CPU 使用率分析摘要。')))
  assert.ok(nodes.some(node => node.type === 'p' && node.props.className === 'b03-run-record-summary-meta' && node.children.includes('RUN 18 · 已完成 · 模块分析 · 标准型')))
  assert.ok(!nodes.some(node => node.type === 'button' && ['停止 Run', '继续分析', '查看分析报告', '打开 HTML 报告'].includes(node.children[0])))
  const backButton = nodes.find(node => node.type === 'button' && node.children.includes('返回任务列表'))
  assert.ok(backButton)
  backButton.props.onClick()
  assert.equal(states[16].type, 'tasks')
  const breadcrumb = nodes.find(node => node.type === 'nav' && node.props.className === 'b03-run-record-breadcrumb')
  assert.ok(breadcrumb)
  descendants(breadcrumb).find(node => node.type === 'button' && node.children.includes('PANGEA 分析')).props.onClick()
  assert.equal(states[16].type, 'tasks')
})

test('overview status variants separate analysis quality from test execution and gate continuation', async () => {
  const variants = [
    { lifecycle_status: 'complete', terminal: true, publication: { state: 'final' }, delivery_integrity: { status: 'complete' }, report_available: true, taskStatus: 'completed', canResume: false, expected: '分析结果已就绪', report: true },
    { lifecycle_status: 'running', terminal: false, publication: { state: 'draft' }, delivery_integrity: { status: 'incomplete' }, taskStatus: 'running', canResume: false, expected: '正在分析源码', report: false },
    { lifecycle_status: 'running', terminal: false, needsUser: true, executionStatus: 'paused', publication: { state: 'draft' }, delivery_integrity: { status: 'incomplete' }, taskStatus: 'needs_attention', canResume: true, expected: '修正结果等待你的决定', report: false,
      correctionActions: [{ stage: 'targeted_closure', correction_id: 'CL-01', status: 'accepted' }, { stage: 'targeted_closure', correction_id: 'CL-02', status: 'accepted' }, { stage: 'targeted_closure', correction_id: 'CL-03', status: 'paused' }] },
    { lifecycle_status: 'attention_required', terminal: true, publication: { state: 'draft' }, delivery_integrity: { status: 'incomplete' }, taskStatus: 'needs_attention', canResume: true, expected: '修正结果等待你的决定', report: false },
    { lifecycle_status: 'stopped', terminal: true, completed: 4, publication: { state: 'draft' }, delivery_integrity: { status: 'incomplete' }, taskStatus: 'stopped', canResume: true, expected: '本次运行已停止', report: false },
  ]
  let index = 0
  const states = {}
  const client = await loadClientExports({ ...fakeReact(), useState(initial) {
    const key = index++
    if (!Object.hasOwn(states, key)) states[key] = initial
    return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value }]
  } })
  const pages = [], ctx = { pangea: { registerPage(page) { pages.push(page) } }, effect(fn) { return fn() } }
  client.apply(ctx)
  const task = { task_id: 'task-23', title: 'CPU 使用率计算分析', target: 'CPU 使用率计算', repository: 'dperf', data_root: '/workspace/data', run_id: 'run-23' }
  for (const variant of variants) {
    const current = {
      run_id: 'run-23', data_root: '/workspace/data', target: task.target, repository: task.repository,
      scenario: 'module-analysis', lifecycle_status: variant.lifecycle_status, terminal: variant.terminal, needs_user: variant.needsUser ?? false,
      publication: variant.publication, delivery_integrity: variant.delivery_integrity,
      report_available: variant.report, partial_delivery: false,
      analysis_settings: { scenario: 'module-analysis', mode: 'standard' },
      analysis: { total: 6, completed: variant.completed ?? (variant.terminal ? 6 : 4) },
      details: { business_flows: [{ flow_id: 'F-1', title: 'CPU path' }], risks: [{ risk_id: 'R-1', title: 'Boundary' }],
        test_cases: [{ test_case_id: 'TC-1', title: 'Boundary input', summary: 'Check boundary', linked_risk_ids: ['R-1'] }], evidence: [], review_issues: [] },
      workflow: { units: [{ unit_id: 'U-1' }], actions: variant.correctionActions ?? [], unresolved: variant.needsUser || variant.lifecycle_status === 'attention_required' ? [{ code: 'U-1', message: '跨周期状态依据仍待补齐' }] : [] },
      semantic_review: { method: 'independent_verified', verdict: 'PASS' },
      artifacts: variant.report ? { report_html: '/workspace/data/report.html' } : {},
    }
    states[0] = { data_root: '/workspace/data', current, executor_runs: [] }
    states[1] = { compatibility: { compatible: true }, selected_task_id: task.task_id, tasks: { items: [{ ...task, status: variant.taskStatus, execution_status: variant.executionStatus ?? variant.taskStatus, can_resume: variant.canResume }] }, runs: { items: [{ run_id: task.run_id, task_id: task.task_id }] } }
    states[4] = task.run_id
    states[5] = task.task_id
    states[16] = { type: 'overview' }
    index = 0
    const panel = pages.find(page => page.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true })
    const nodes = descendants(panel.type(panel.props))
    assert.ok(nodes.some(node => node.type === 'h2' && node.children.includes(variant.expected)), variant.expected)
    const texts = nodes.flatMap(node => node.children.filter(child => typeof child === 'string'))
    if (variant.lifecycle_status === 'running' && !variant.needsUser) {
      assert.ok(texts.some(value => value.includes('已接受 4 / 6 个源码单元')))
      assert.ok(!texts.some(value => value.includes('0 条设计用例')))
    } else if (variant.lifecycle_status === 'stopped') {
      assert.ok(texts.some(value => value.includes('已接受 4 / 6 个源码单元') && value.includes('检查点已保存')))
    } else assert.ok(texts.some(value => value.includes('用例已设计') && value.includes('0 条执行结果已回传')), texts.join(' | '))
    if (variant.needsUser) assert.ok(texts.some(value => value.includes('2 项修正已完成，还有 1 项待处理')), texts.join(' | '))
    const qualityVerdict = nodes.find(node => node.props?.['aria-label']?.startsWith('质量结论：'))
    assert.equal(qualityVerdict?.props['aria-label'] ?? null,
      variant.terminal ? '质量结论：PASS（审查者结论）' : null,
      'quality verdict is shown accessibly only for a terminal run')
    assert.ok(!texts.some(value => /已通过测试/.test(value)), 'quality verdict must not claim the test case passed')
    assert.equal(nodes.some(node => node.type === 'button' && node.children.includes('查看分析报告')), variant.report)
    assert.equal(nodes.some(node => node.type === 'button' && node.children.includes('继续分析')), variant.canResume)
    if (variant.needsUser) assert.ok(!nodes.some(node => node.type === 'button' && node.children.includes('停止 Run')))
    if (variant.lifecycle_status === 'attention_required') assert.ok(JSON.stringify(nodes).includes('跨周期状态依据仍待补齐'))
  }
})

test('task list distinguishes loading and request failure from a successful first-use empty result', async () => {
  for (const scenario of [
    { name: 'loading', workbench: undefined, workbenchError: undefined, expectedRole: 'status', expectedMessage: '正在读取分析任务…' },
    { name: 'request failure', workbench: undefined, workbenchError: 'fixture backend unavailable', expectedRole: 'alert', expectedMessage: '任务列表暂不可用，请重试同步。' },
  ]) {
    let index = 0
    const states = { 1: scenario.workbench, 3: scenario.workbenchError }
    const client = await loadClientExports({ ...fakeReact(), useState(initial) {
      const key = index++
      if (!Object.hasOwn(states, key)) states[key] = initial
      return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value }]
    } })
    const pages = [], ctx = { pangea: { registerPage(page) { pages.push(page) } }, effect(fn) { return fn() } }
    client.apply(ctx)
    const panel = pages.find(page => page.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true })
    const nodes = descendants(panel.type(panel.props))
    assert.ok(nodes.some(n => n.props.role === scenario.expectedRole && n.children.includes(scenario.expectedMessage)), scenario.name)
    assert.ok(!nodes.some(n => n.children.includes('创建你的第一个分析任务')), `${scenario.name} must not claim this is a first-use empty result`)
    assert.ok(!nodes.some(n => n.props.className === 'b03-task-first-use-steps'), `${scenario.name} must not show the first-use steps`)
    if (scenario.name === 'loading') {
      assert.equal(nodes.find(n => n.type === 'button' && n.children.includes('新建分析')).props.disabled, true)
    }
  }
})

test('create form explains the next missing requirement and enables only a ready task', async () => {
  let index = 0
  const states = { 1: { compatibility: { compatible: true }, capabilities: { repositories: ['demo'] }, acp_providers: [{ id: 'agent', label: 'Agent', registered: true }] }, 16: { type: 'create', createStep: 4 } }
  const client = await loadClientExports({ ...fakeReact(), useState(initial) {
    const key = index++
    if (!Object.hasOwn(states, key)) states[key] = initial
    return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value }]
  } })
  const pages = [], ctx = { pangea: { registerPage(page) { pages.push(page) } }, effect(fn) { return fn() } }
  client.apply(ctx)
  const render = () => { index = 0; const panel = pages.find(page => page.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true }); return descendants(panel.type(panel.props)) }
  assert.ok(render().some(n => n.props.id === 'pangea-create-hint' && n.children.includes('请先选择源码仓库。')))
  states[33] = { ...states[33], repository: 'demo' }
  assert.ok(render().some(n => n.props.id === 'pangea-create-hint' && n.children.includes('请填写本次分析目标。')))
  states[33] = { ...states[33], target: 'TLS', provider_id: 'agent' }
  const nodes = render()
  assert.equal(nodes.find(n => n.type === 'button' && n.children.includes('创建并开始分析')).props.disabled, false)
  assert.ok(!nodes.some(n => n.props.id === 'pangea-create-hint'))
})


for (const body of [
  { preconditions: ['ready'], steps: [{ action: 'connect now', expected: 'connected response' }] },
  { precondition: ['ready'], test_steps: [{ step: 'connect now', expected: 'connected response' }], expected_results: ['global expectation'] },
]) test('case detail renders canonical and existing alias steps as paired table cells', async () => {
  const { sourceFirstProjection } = await import('../src/source-first-projection.js')
  const details = sourceFirstProjection([{ stage: 'unit_analysis', status: 'accepted', task: { unit_id: 'u' }, records: [{ record_id: 'c', kind: 'test_case', body }] }])
  const task = { task_id: 'task', run_id: 'run', data_root: '/data', status: 'complete' }
  const current = { run_id: 'run', data_root: '/data', workflow_version: 'source-first-v1', lifecycle_status: 'complete', terminal: true, details }
  const states = { 0: { current, data_root: '/data' }, 1: { tasks: { items: [task] } }, 4: 'run', 5: 'task', 16: { type: 'case', id: 'u/c' } }
  let index = 0
  const client = await loadClientExports({ ...fakeReact(), useState(initial) { const key = index++; return [Object.hasOwn(states, key) ? states[key] : initial, () => {}] } })
  const pages = [], ctx = { pangea: { registerPage(p) { pages.push(p) } }, effect(fn) { return fn() } }
  client.apply(ctx)
  const panel = pages.find(p => p.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true })
  const nodes = descendants(panel.type(panel.props))
  const table = nodes.find(node => node.type === 'table' && JSON.stringify(node).includes('connect now'))
  assert.ok(table)
  const cells = descendants(table).filter(node => node.type === 'td')
  assert.ok(cells.some(node => node.children.includes('connect now')))
  assert.ok(cells.some(node => node.children.includes('connected response')))
})

test('path-only flow renders complete entry and path content without inventing graph nodes', async () => {
  const body = { flow_id: 'F2', title: 'TLS flow', trigger: 'bad key', entry_points: ['connect --tls'], paths: [{ path_id: 'P2', steps: [{ action: 'connect', expected: 'handshake rejected' }], cleanup: 'disconnect now' }] }
  const { sourceFirstProjection } = await import('../src/source-first-projection.js')
  const details = sourceFirstProjection([{ stage: 'unit_analysis', status: 'accepted', task: { unit_id: 'u' }, records: [{ record_id: 'f', kind: 'flow', body }] }])
  const task = { task_id: 'task', run_id: 'run', data_root: '/data', status: 'complete' }
  const current = { run_id: 'run', data_root: '/data', workflow_version: 'source-first-v1', lifecycle_status: 'complete', terminal: true, details }
  const states = { 0: { current, data_root: '/data' }, 1: { tasks: { items: [task] } }, 4: 'run', 5: 'task', 16: { type: 'flows' } }
  let index = 0
  const client = await loadClientExports({ ...fakeReact(), useState(initial) { const key = index++; return [Object.hasOwn(states, key) ? states[key] : initial, () => {}] } })
  const pages = [], ctx = { pangea: { registerPage(p) { pages.push(p) } }, effect(fn) { return fn() } }
  client.apply(ctx)
  const panel = pages.find(p => p.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true })
  const nodes = descendants(panel.type(panel.props))
  const pathView = nodes.find(node => node.props['aria-label'] === '业务路径阅读')
  assert.ok(pathView)
  const rendered = JSON.stringify(pathView)
  for (const text of ['connect --tls', 'handshake rejected', 'disconnect now']) assert.ok(rendered.includes(text))
  assert.ok(JSON.stringify(nodes).includes('暂不能据此绘制流程图'))
})

test('closure diagnostics remain available and delivery has one primary control', async () => {
  const task = { task_id: 'task', run_id: 'run', data_root: '/data', status: 'running' }
  const current = { run_id: 'run', data_root: '/data', workflow_version: 'source-first-v1', stage: 'closing', lifecycle_status: 'running', needs_user: true, analysis: { total: 1, completed: 1 }, details: {}, execution_progress: [{ action_id: 'closure-u', unit_id: 'u', stage: 'targeted_closure', status: 'paused', elapsed_ms: 900000, worker_turns: 2, auto_continuations: 1, finding_count: 4, modified_records: 3 }] }
  const states = { 0: { current, data_root: '/data' }, 1: { tasks: { items: [task] } }, 4: 'run', 5: 'task', 16: { type: 'workflow' } }
  let index = 0
  const client = await loadClientExports({ ...fakeReact(), useState(initial) { const key = index++; return [Object.hasOwn(states, key) ? states[key] : initial, () => {}] } })
  const pages = [], ctx = { pangea: { registerPage(p) { pages.push(p) } }, effect(fn) { return fn() } }
  client.apply(ctx)
  const panel = pages.find(p => p.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true })
  const nodes = descendants(panel.type(panel.props))
  const progress = nodes.find(node => node.props['aria-label'] === '实际执行进度')
  assert.ok(progress)
  assert.match(JSON.stringify(progress), /worker 回合 2 · 自动续接 1/)
  assert.match(JSON.stringify(progress), /不代表已解决数量/)
  assert.equal(nodes.filter(node => node.type === 'button' && node.children.includes('交付已有结果')).length, 1)
})

async function executionMetricsView(metrics, { detailRunId = 'run', screen = 'workflow' } = {}) {
  const task = { task_id: 'task', run_id: 'run', data_root: '/data', status: 'running' }
  const current = { run_id: 'run', data_root: '/data', workflow_version: 'source-first-v1', lifecycle_status: 'running', quality_status: 'not_reviewed',
    analysis: { total: 1, completed: 0 }, details: {} }
  const states = { 0: { current, data_root: '/data' }, 1: { tasks: { items: [task] }, run: { run_id: detailRunId, execution_metrics: metrics } }, 4: 'run', 5: 'task', 16: { type: screen } }
  const before = JSON.stringify(states)
  let index = 0
  const client = await loadClientExports({ ...fakeReact(), useState(initial) { const key = index++; return [Object.hasOwn(states, key) ? states[key] : initial, () => {}] } })
  const pages = [], ctx = { pangea: { registerPage(page) { pages.push(page) } }, effect(fn) { return fn() } }
  client.apply(ctx)
  const panel = pages.find(page => page.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true })
  const nodes = descendants(panel.type(panel.props))
  assert.equal(JSON.stringify(states), before, 'reading execution metrics must not change Run or quality state')
  return nodes
}

const metricsText = node => typeof node === 'string' || typeof node === 'number' ? String(node)
  : (Array.isArray(node) ? node : node?.children ?? []).map(metricsText).join('')

test('workflow execution metrics preserve recorded zero, missing counters and per-stage coverage', async () => {
  const stages = [
    { stage: 'unit_analysis', action_count: 2, timed_action_count: 1, unfinished_timed_action_count: 1, worker_elapsed_ms: 60000,
      worker_turns: 2, auto_continuations: 0, repair_dispatches: null, counter_action_counts: { worker_turns: 1, auto_continuations: 1, repair_dispatches: 0 } },
    { stage: 'comparison_review', action_count: 1, timed_action_count: 1, unfinished_timed_action_count: 0, worker_elapsed_ms: 1000,
      worker_turns: 1, auto_continuations: null, repair_dispatches: 0, counter_action_counts: { worker_turns: 1, auto_continuations: 0, repair_dispatches: 1 } },
  ]
  const metrics = { action_count: 3, timed_action_count: 2, unfinished_timed_action_count: 1, worker_elapsed_ms: 61000,
    worker_turns: 3, auto_continuations: 0, repair_dispatches: 0, counter_action_counts: { worker_turns: 2, auto_continuations: 1, repair_dispatches: 1 }, stages }
  const nodes = await executionMetricsView(metrics)
  const details = nodes.find(node => node.props['aria-label'] === '耗时与往返')
  assert.equal(details.type, 'details')
  assert.notEqual(details.props.open, true)
  const rows = descendants(details).filter(node => node.type === 'tr')
  assert.equal(rows.length, 4, 'one header, two stages and the recorded subtotal')
  const analysisCells = rows[1].children.flat(Infinity).filter(node => node.type === 'td')
  assert.match(metricsText(analysisCells[0]), /1 分 0 秒.*计时覆盖 1 \/ 2 个任务.*1 个任务计时未结束/)
  assert.equal(metricsText(analysisCells[1]), '2记录覆盖 1 / 2 个任务')
  assert.equal(metricsText(analysisCells[2]), '0记录覆盖 1 / 2 个任务')
  assert.equal(metricsText(analysisCells[3]), '未记录')
  const reviewCells = rows[2].children.flat(Infinity).filter(node => node.type === 'td')
  assert.equal(metricsText(reviewCells[2]), '未记录')
  assert.equal(metricsText(reviewCells[3]), '0')
  assert.match(metricsText(rows[3]), /已记录合计.*1 分 1 秒.*计时覆盖 2 \/ 3 个任务/)
  assert.match(metricsText(details), /并行 worker 的累计时间不等于整次运行耗时或模型推理时间/)
  assert.match(metricsText(details), /当前未结束回合尚未计入累计时间/)
})

test('legacy or different Run execution metrics never appear as measured zero or leak another Run', async () => {
  const metrics = { action_count: 2, timed_action_count: 0, worker_elapsed_ms: null,
    stages: [{ stage: 'unit_analysis', action_count: 2, timed_action_count: 0, worker_elapsed_ms: null, worker_turns: null, auto_continuations: null, repair_dispatches: null }] }
  for (const [value, options] of [[undefined, {}], [metrics, { detailRunId: 'another-run' }]]) {
    const nodes = await executionMetricsView(value, options)
    const details = nodes.find(node => node.props['aria-label'] === '耗时与往返')
    assert.match(metricsText(details), /未记录当前 Run 的阶段执行指标/)
    assert.ok(!descendants(details).some(node => node.type === 'table'))
  }
  const nodes = await executionMetricsView(metrics)
  const table = nodes.find(node => node.props['aria-label'] === '阶段执行指标')
  const stageRow = descendants(table).filter(node => node.type === 'tr')[1]
  const cells = stageRow.children.flat(Infinity).filter(node => node.type === 'td')
  assert.match(metricsText(cells[0]), /^未记录计时覆盖 0 \/ 2 个任务$/)
  for (const cell of cells.slice(1)) assert.equal(metricsText(cell), '未记录')
  assert.doesNotMatch(metricsText(table), /NaN|undefined|0 毫秒/)
})

test('execution diagnostics stay off the analysis overview', async () => {
  const nodes = await executionMetricsView({ stages: [] }, { screen: 'overview' })
  assert.ok(!nodes.some(node => node.props['aria-label'] === '耗时与往返'))
})

test('flow views default to text and isolate function diagrams by flow, run and profile', async () => {
  const task = { task_id: 'task', run_id: 'run', status: 'complete' }
  const current = { run_id: 'run', details: { business_flows: [{ flow_id: 'F1', title: 'One' }, { flow_id: 'F2', title: 'Two' }] } }
  const states = { 0: { current }, 1: { tasks: { items: [task] } }, 4: 'run', 5: 'task', 16: { type: 'flows' } }
  const views = [
    { view_id: 'standard', flow_id: 'F1' },
    { view_id: 'functions', flow_id: 'F1', profile: 'function_variables' },
    { view_id: 'other-flow', flow_id: 'F2', profile: 'function_variables' },
    { view_id: 'other-run', flow_id: 'F1', profile: 'function_variables', run_id: 'old' },
  ].map(v => ({ task_id: 'task', run_id: 'run', type: 'workflow', available: true, status: 'ready', ...v }))
  const requests = []
  let index = 0
  const client = await loadClientExports({ ...fakeReact(), useState(initial) {
    const key = index++
    if (!Object.hasOwn(states, key)) states[key] = initial
    return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value }]
  } }, async (_url, options) => {
    requests.push(JSON.parse(options.body))
    return { ok: true, async json() { return { status: 'ok', views } } }
  })
  const pages = [], ctx = { pangea: { registerPage(page) { pages.push(page) } }, effect(fn) { return fn() } }
  client.apply(ctx)
  const panel = pages.find(page => page.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true })
  const render = () => { index = 0; return descendants(panel.type(panel.props)) }
  const find = label => render().find(n => n.props['aria-label'] === label)
  const button = label => render().find(n => n.type === 'button' && n.children[0] === label)
  assert.equal(find('流程阅读视图').props['aria-pressed'], true)
  assert.ok(render().some(n => n.props['aria-label'] === '业务流程文字阅读'))
  find('函数与变量流程图视图').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(render().find(n => n.type === 'iframe').props.title, '函数与变量图预览')
  assert.match(render().find(n => n.type === 'iframe').props.src, /view_id=functions&/)
  assert.equal(find('架构图类型'), undefined)
  button('版本与修改').props.onClick()
  assert.equal(button('生成修改版').props.disabled, true)
  find('架构图修改要求').props.onChange({ target: { value: '标注关键变量变化' } })
  assert.equal(button('生成修改版').props.disabled, false)
  render().find(n => n.type === 'form' && descendants(n).some(child => child.props['aria-label'] === '架构图修改要求')).props.onSubmit({ preventDefault() {} })
  await new Promise(resolve => setImmediate(resolve))
  const request = requests.filter(r => r.action === 'architecture-create').at(-1)
  assert.equal(request.profile, 'function_variables')
  assert.equal(request.flow_id, 'F1')
  assert.equal(request.type, 'workflow')
  assert.equal(request.previous_view_id, 'functions')
  assert.equal(request.instruction, '标注关键变量变化')
  button('返回图表').props.onClick()
  find('流程图视图').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.match(render().find(n => n.type === 'iframe').props.src, /view_id=standard&/)
  find('流程阅读视图').props.onClick()
  render().find(n => n.props.className === 'b04-flow-nav-item' && JSON.stringify(n).includes('Two')).props.onClick()
  assert.equal(find('流程阅读视图').props['aria-pressed'], true)
  find('函数与变量流程图视图').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.match(render().find(n => n.type === 'iframe').props.src, /view_id=other-flow&/)
})

async function diagramWorkspace(overrides = []) {
  const views = [
    { view_id: 'functions-v2', flow_id: 'F1', profile: 'function_variables', session_id: 'function-session-2' },
    { view_id: 'functions-v1', flow_id: 'F1', profile: 'function_variables', session_id: 'function-session-1' },
    { view_id: 'archify-v2', flow_id: 'F1', type: 'sequence', session_id: 'archify-session-2' },
    { view_id: 'archify-v1', flow_id: 'F1', session_id: 'archify-session-1' },
    { view_id: 'functions-other-flow', flow_id: 'F2', profile: 'function_variables', session_id: 'other-flow-session' },
    { view_id: 'functions-old-run', flow_id: 'F1', profile: 'function_variables', run_id: 'old-run' },
    { view_id: 'functions-other-task', flow_id: 'F1', profile: 'function_variables', task_id: 'other-task' },
  ].map(view => ({ task_id: 'task', run_id: 'run', type: 'workflow', status: 'ready', available: true, ...view,
    ...overrides.find(override => override.view_id === view.view_id) }))
  const task = { task_id: 'task', run_id: 'run', status: 'complete', title: 'CPU usage', active_conversation_id: 'analysis-session',
    conversations: [{ conversation_id: 'analysis-session', session_id: 'analysis-session', kind: 'analysis' },
      ...views.filter(view => view.session_id).map(view => ({ conversation_id: view.session_id, session_id: view.session_id, kind: 'architecture' }))] }
  const current = { run_id: 'run', details: { business_flows: [{ flow_id: 'F1', title: 'Calculation' }, { flow_id: 'F2', title: 'Initialization' }] } }
  const states = { 0: { current }, 1: { compatibility: { compatible: true }, tasks: { items: [task] } }, 4: 'run', 5: 'task', 16: { type: 'flows' } }
  const requests = [], opened = [], registered = [], refs = [], events = []
  let index = 0, refIndex = 0, publishContext
  const client = await loadClientExports({ ...fakeReact(), useState(initial) {
    const key = index++
    if (!Object.hasOwn(states, key)) states[key] = typeof initial === 'function' ? initial() : initial
    return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value }]
  }, useRef(initial) {
    return refs[refIndex++] ??= { current: initial }
  }, useEffect(effect, dependencies) {
    // Exercise the cross-panel context effect; polling is supplied by the HTTP fixture.
    if (dependencies.includes(current) && dependencies.includes(states[1].tasks.items[0])) publishContext = effect
  } }, async (_url, options = {}) => {
    if (!options.body) return { ok: true, json: async () => ({ status: 'ok', ...states[1] }) }
    const request = JSON.parse(options.body)
    requests.push(request)
    if (request.action === 'task-conversation-create') {
      assert.equal(request.task_id, 'task')
      const conversation = { conversation_id: 'discussion-new', session_id: 'discussion-session-new', kind: 'assistant', title: request.title }
      states[1] = { ...states[1], tasks: { items: [{ ...states[1].tasks.items[0],
        active_conversation_id: conversation.conversation_id,
        conversations: [...states[1].tasks.items[0].conversations, conversation],
      }] } }
      return { ok: true, json: async () => ({ status: 'ok', session_id: conversation.session_id }) }
    }
    if (request.action === 'task-conversation-activate') {
      assert.equal(request.task_id, 'task')
      assert.ok(task.conversations.some(item => item.conversation_id === request.conversation_id))
      states[1] = { ...states[1], tasks: { items: [{ ...states[1].tasks.items[0], active_conversation_id: request.conversation_id }] } }
      return { ok: true, json: async () => ({ status: 'ok' }) }
    }
    assert.equal(request.action, 'architecture-list')
    return { ok: true, json: async () => ({ status: 'ok', views }) }
  }, event => events.push(event))
  const pages = [], ctx = { sessions: { open(session) { opened.push(session) } }, pangea: {
    registerPage(page) { pages.push(page) }, registerProductSession(session, page) { registered.push([session, page]) },
  }, effect(fn) { return fn() } }
  client.apply(ctx)
  const panel = pages.find(page => page.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true })
  const render = () => { index = 0; refIndex = 0; return descendants(panel.type(panel.props)) }
  const find = label => render().find(node => node.props['aria-label'] === label)
  const context = () => {
    render()
    assert.ok(publishContext, 'the analysis page must publish its right-panel context')
    publishContext()
    return events.findLast(event => event.type === 'pangea:run-context').detail
  }
  return { render, find, context, requests, opened, registered }
}

test('analysis record creates a separate discussion session through the companion task route', async () => {
  const workspace = await diagramWorkspace()
  const record = workspace.context()
  assert.equal(record.activeConversationKind, 'analysis')
  await record.onCreateConversation()
  assert.equal(workspace.requests.at(-1).action, 'task-conversation-create')
  assert.equal(workspace.opened.at(-1), 'discussion-session-new')
  assert.deepEqual(workspace.registered.at(-1), ['discussion-session-new', 'analysis'])
  assert.equal(workspace.context().activeConversationKind, 'assistant')
})

test('switching diagram profiles and versions activates the matching conversation and keeps scope isolated', async () => {
  const workspace = await diagramWorkspace()
  const { find, render, requests, opened, registered } = workspace
  const selectedView = () => new URL(render().find(node => node.type === 'iframe').props.src, 'http://localhost').searchParams.get('view_id')
  const versionItems = () => render().filter(node => node.props.className === 'b04-version-item')
  const expectSession = session => {
    assert.equal(requests.filter(request => request.action === 'task-conversation-activate').at(-1).conversation_id, session)
    assert.equal(opened.at(-1), session)
    assert.deepEqual(registered.at(-1), [session, 'analysis'])
  }
  await find('函数与变量流程图视图').props.onClick()
  assert.equal(selectedView(), 'functions-v2')
  expectSession('function-session-2')
  render().find(node => node.type === 'button' && node.children.includes('版本与修改')).props.onClick()
  assert.equal(versionItems().length, 2)
  await versionItems()[1].props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(selectedView(), 'functions-v1')
  expectSession('function-session-1')
  await find('流程图视图').props.onClick()
  assert.equal(selectedView(), 'archify-v1')
  expectSession('archify-session-1')
  await render().find(node => node.type === 'button' && node.children.includes('时序')).props.onClick()
  assert.equal(selectedView(), 'archify-v2')
  expectSession('archify-session-2')
  render().find(node => node.type === 'button' && node.children.includes('版本与修改')).props.onClick()
  assert.equal(versionItems().length, 1, 'versions are scoped to the selected graph type')
  render().find(node => node.type === 'button' && node.children.includes('返回图表')).props.onClick()
  await render().find(node => node.type === 'button' && node.children.includes('业务流程') && node.props['aria-pressed'] === false).props.onClick()
  assert.equal(selectedView(), 'archify-v1')
  expectSession('archify-session-1')
  await find('流程阅读视图').props.onClick()
  render().find(node => node.props.className === 'b04-flow-nav-item' && JSON.stringify(node).includes('Initialization')).props.onClick()
  assert.equal(find('流程阅读视图').props['aria-pressed'], true)
  await find('函数与变量流程图视图').props.onClick()
  assert.equal(selectedView(), 'functions-other-flow')
  expectSession('other-flow-session')
})

test('right-panel diagram conversation selection updates the left flow, profile and version', async () => {
  const { find, render, context, opened } = await diagramWorkspace()
  await find('函数与变量流程图视图').props.onClick()
  await context().onSelectConversation('archify-session-2')
  assert.equal(find('流程图视图').props['aria-pressed'], true)
  assert.match(render().find(node => node.type === 'iframe').props.src, /view_id=archify-v2&/)
  assert.equal(render().find(node => node.type === 'button' && node.children.includes('时序')).props['aria-pressed'], true)
  await context().onSelectConversation('archify-session-1')
  assert.equal(find('流程图视图').props['aria-pressed'], true)
  assert.match(render().find(node => node.type === 'iframe').props.src, /view_id=archify-v1&/)
  assert.equal(render().find(node => node.type === 'button' && node.children.includes('业务流程')).props['aria-pressed'], true)
  assert.equal(render().find(node => node.type === 'iframe').props.title, '业务流程图预览')
  assert.equal(opened.at(-1), 'archify-session-1')
  await context().onSelectConversation('other-flow-session')
  assert.match(JSON.stringify(render().find(node => node.props.className === 'b04-modebar')), /Initialization/)
  assert.equal(find('函数与变量流程图视图').props['aria-pressed'], true)
  assert.match(render().find(node => node.type === 'iframe').props.src, /view_id=functions-other-flow&/)
  assert.equal(context().activeConversationSessionId, 'other-flow-session')
  await context().onSelectConversation('function-session-1')
  assert.match(render().find(node => node.type === 'iframe').props.src, /view_id=functions-v1&/)
  assert.equal(context().activeConversationSessionId, 'function-session-1')
})

test('a diagram still generating after layout validation shows repair progress in both panels', async () => {
  const validationError = 'node_overflow: label extends past the viewport'
  const { find, render, context } = await diagramWorkspace([{ view_id: 'functions-v2', available: false,
    status: 'generating', execution_status: 'running', validation_error: validationError }])
  await find('函数与变量流程图视图').props.onClick()
  const workspace = find('函数与变量图工作区')
  const nodes = descendants(workspace)
  const progress = nodes.find(node => node.props.className === 'b04-progress-art')
  assert.ok(progress)
  assert.match(JSON.stringify(workspace), /正在修正布局/)
  assert.match(JSON.stringify(progress), /后台进行/)
  assert.ok(!nodes.some(node => node.props.role === 'alert'))
  assert.ok(!render().some(node => node.type === 'iframe'))
  const diagnostics = nodes.find(node => node.props.className === 'b04-progress-log')
  assert.ok(diagnostics)
  assert.equal(context().phase, '正在修正布局')
  assert.equal(context().process.status, 'running')
  assert.ok(nodes.some(node => node.type === 'button' && node.children.includes('停止生成')))
})

test('a terminal diagram failure remains actionable instead of showing layout repair', async () => {
  const { find, context } = await diagramWorkspace([{ view_id: 'functions-v2', available: false,
    status: 'failed', execution_status: 'failed', validation_error: 'node_overflow', error: 'Layout generation ended without a usable artifact' }])
  await find('函数与变量流程图视图').props.onClick()
  const nodes = descendants(find('函数与变量图工作区'))
  const failure = nodes.find(node => node.props.className === 'b04-progress-art')
  assert.ok(failure)
  assert.match(JSON.stringify(failure), /node_overflow/)
  assert.doesNotMatch(JSON.stringify(failure), /正在修正布局/)
  assert.ok(!nodes.some(node => node.type === 'button' && node.children.includes('停止生成')))
  assert.equal(context().phase, '需要处理')
  assert.equal(context().process.status, 'failed')
})


test('v2 text-only flow is readable and branch discussion does not add risk context', async () => {
  const client = await loadClientExports()
  const run = { analysis_profile: 'behavior-test-v2', analysis_scene: { presentation: { risks: false } } }
  assert.equal(client.flowContentState({ text: '入口→拒绝或成功' }), '已有文字流程')
  assert.equal(client.riskApplicable(run), false)
  const draft = client.buildDiscussionDraft({ kind: 'case', runId: 'r', run, item: { title: '拒绝', linked_risk_ids: ['risk-1'] }, risks: [{ risk_id: 'risk-1', title: '历史风险' }] })
  assert.doesNotMatch(draft, /关联风险/)
  const record = { action_id: 'r:analysis:tls', record_id: 'flow', revision: 1 }
  const view = { workflow_version: 'source-first-v1', source_records: [record] }
  assert.equal(client.diagramIsStale(view, { workflow_version: 'source-first-v1', details: { business_flows: [{ source_record: record }] } }), false)
  assert.equal(client.diagramIsStale(view, { workflow_version: 'source-first-v1', details: { business_flows: [{ source_record: { ...record, revision: 2 } }] } }), true)
})


test('flow reader hides nested source evidence without changing stored records or other readers', async () => {
  const c = await loadClientExports()
  const body = { title: '连接流程', source_evidence: ['private.c:10-20'], nodes: [{ label: '建立连接', source_evidence: [{ path: 'nested.c', lines: [30, 40] }] }] }
  const original = JSON.stringify(body)
  const rendered = JSON.stringify(c.renderReadableBody(body, true))
  assert.ok(rendered.includes('建立连接'))
  assert.ok(!rendered.includes('private.c'))
  assert.ok(!rendered.includes('nested.c'))
  assert.ok(!rendered.includes('源码依据'))
  assert.equal(JSON.stringify(body), original)
  assert.ok(JSON.stringify(c.renderReadableBody(body)).includes('private.c'))
})

test('renderable draft has visible warning and draft exports without claiming ready', async () => {
  const { find, render } = await diagramWorkspace([{ view_id: 'functions-v2', available: false, status: 'failed',
    preview_available: true, preview_kind: 'draft', validation_error: 'phase overlap', validation_diagnostics: [{ code: 'workflow/phase-overlap' }] }])
  await find('函数与变量流程图视图').props.onClick()
  const nodes = descendants(find('函数与变量图工作区'))
  assert.match(JSON.stringify(nodes), /草稿：仍有 1 处布局问题/)
  assert.match(render().find(n => n.type === 'iframe').props.src, /variant=draft/)
  const exports = nodes.filter(n => n.type === 'a' && n.props.download)
  assert.equal(exports.length, 1)
  assert.ok(exports.every(n => n.props.href.includes('variant=draft')))
})

test('uncompilable graph shows readable relationships without an empty iframe', async () => {
  const { find, render } = await diagramWorkspace([{ view_id: 'functions-v2', available: false, status: 'failed',
    preview_available: false, candidate_summary: { nodes: [{ id: 'caller', label: 'caller' }], edges: [{ from: 'caller', to: 'missing' }] },
    validation_error: 'missing reference' }])
  await find('函数与变量流程图视图').props.onClick()
  assert.ok(!render().some(n => n.type === 'iframe'))
  const text = JSON.stringify(find('函数与变量图工作区'))
  assert.match(text, /图表未能生成/)
  assert.match(text, /caller/)
  assert.match(text, /missing/)
})

test('unverified latest edits retain a labelled previous preview and local verification action', async () => {
  const { find, render } = await diagramWorkspace([{ view_id: 'functions-v2', available: false, status: 'failed',
    preview_available: true, preview_kind: 'verified', candidate_unverified: true }])
  await find('函数与变量流程图视图').props.onClick()
  assert.match(JSON.stringify(find('函数与变量图工作区')), /当前预览对应上次验证的候选/)
  assert.ok(render().some(n => n.type === 'button' && n.children.includes('验证最新候选')))
  assert.match(render().find(n => n.type === 'iframe').props.src, /variant=verified/)
  render().find(n => n.type === 'button' && n.children.includes('版本与修改')).props.onClick()
  await render().filter(n => n.props.className === 'b04-version-item')[1].props.onClick()
  assert.match(JSON.stringify(find('函数与变量图工作区')), /历史版本：最新版本请在版本与修改中选择/)
})

test('legacy reader publication exposes collections and its Markdown report', async () => {
  const client = await loadClientExports()
  const opened = []
  const current = { run_id: 'legacy-report', workflow_version: 'codetalks', terminal: true, lifecycle_status: 'complete',
    publication: { state: 'final' }, reader_health: { status: 'ok', trusted: true },
    report_available: true, artifacts: { report_html: null, report_md: '/run/report.md', formal_outputs: ['/run/report.md'] },
    workflow: { steps: [] }, details: { business_flows: [{}], risks: [{}], test_cases: [{}] } }
  const rendered = client.RunWorkspace({ current, navigate() {}, openFile(file) { opened.push(file) } })
  const nodes = descendants(rendered)
  const report = nodes.find(node => node.type === 'button' && node.children.includes('查看报告'))
  assert.ok(report)
  report.props.onClick()
  assert.deepEqual(opened, ['/run/report.md'])
  assert.match(JSON.stringify(rendered), /Markdown · 已保存/)
  assert.doesNotMatch(JSON.stringify(rendered), /没有已验证可读取的分析报告/)
  for (const label of ['业务流程', '风险记录', '测试用例']) {
    assert.ok(nodes.some(node => node.props.className === 'file-row' && JSON.stringify(node).includes(label) && JSON.stringify(node).includes('1 条')))
  }
  const broken = client.RunWorkspace({ current: { ...current, publication: { state: 'broken' } } })
  assert.doesNotMatch(JSON.stringify(broken), /1 条/)
})


test('completed partial delivery cannot offer stage continuation from a stale task', async () => {
  const client = await loadClientExports()
  const current = { run_id: 'delivered', lifecycle_status: 'complete', terminal: true, partial_delivery: true,
    workflow: { steps: [{ step: '05', title: '定向修正', status: 'stopped' }] } }
  const rendered = client.RunWorkspace({ current, task: { run_id: 'delivered', can_resume: true, execution_status: 'stopped' } })
  assert.doesNotMatch(JSON.stringify(rendered), /已停止 · 可继续/)
  assert.ok(!descendants(rendered).some(node => node.type === 'button' && node.children.includes('继续分析')))
})

test('failed stage task remains failed and is excluded from accepted count', async () => {
  let index = 0
  const client = await loadClientExports({ ...fakeReact(), useState(initial) { return [index++ === 1 ? 'tasks' : initial, () => {}] } })
  const current = { run_id: 'failed-unit', workflow_version: 'source-first-v1', stage: 'analyzing', lifecycle_status: 'running', analysis: { total: 2, completed: 1 },
    workflow: { steps: [{ step: '03', stage: 'analyzing', title: '源码区域分析', status: 'running' }], units: [{ unit_id: 'accepted', title: '已接受单元', status: 'accepted' }, { unit_id: 'failed', title: '失败单元', status: 'failed' }] } }
  const rendered = client.RunWorkspace({ current })
  const row = descendants(rendered).find(node => node.props.key === 'failed' && node.props.className === 'list-row')
  assert.match(JSON.stringify(row), /失败/)
  assert.doesNotMatch(JSON.stringify(row), /已接受/)
  assert.match(JSON.stringify(rendered), /1 \/ 2 已接受/)
})

test('initial workflow read keeps known task identity without inventing run results', async () => {
  const client = await loadClientExports()
  const rendered = client.RunWorkspace({ loading: true, task: { run_id: 'bound-run', title: 'Known task' } })
  const nodes = descendants(rendered)
  assert.ok(nodes.some(node => node.props.className === 'mono' && node.children.includes('bound-run')))
  assert.match(JSON.stringify(rendered), /正在读取当前运行/)
  assert.ok(!nodes.some(node => ['hero-band', 'run-layout'].includes(node.props.className)))
})

test('pending host review does not become a completed workflow or verified report', async () => {
  const client = await loadClientExports()
  const current = { run_id: 'host-review', phase: 'REVIEW', terminal: false, lifecycle_status: 'running', report_available: false, artifacts: { report_md: '/draft/report.md' }, workflow: { steps: [] } }
  const rendered = client.RunWorkspace({ current })
  assert.doesNotMatch(JSON.stringify(rendered), /本次分析已完成/)
  assert.ok(!descendants(rendered).some(node => node.type === 'button' && node.children.includes('查看报告')))
  const workflow = { core_rules_ack: Object.fromEntries(['path-fidelity', 'evidence-consumption', 'narrative-first'].map(key => [key, { ack_at: '2026-09-24T00:00:00Z' }])) }
  assert.equal(client.workflowAckPresentation(workflow, 'stale').label, '最近快照（刷新失败）')
  assert.equal(client.workflowAckPresentation(workflow, 'unavailable').label, '等待状态初始化')
})

test('failed attempt does not describe its active stage as still executing', async () => {
  const client = await loadClientExports()
  const current = { run_id: 'failed-attempt', data_root: '/isolated', workflow_version: 'source-first-v1', lifecycle_status: 'failed', stage: 'closing', workflow: { steps: [{ step: '03', stage: 'analyzing', title: '源码分析', status: 'completed' }, { step: '05', stage: 'closing', title: '定向修正', status: 'running' }] } }
  const rendered = client.RunWorkspace({ current, task: { run_id: current.run_id, data_root: '/isolated', execution_status: 'failed', status: 'failed' } })
  const text = JSON.stringify(rendered)
  assert.match(text, /本次分析失败/)
  assert.match(text, /本次执行失败/)
  assert.doesNotMatch(text, /当前正在执行/)
  assert.ok(!descendants(rendered).some(node => node.children.includes('分析中')))
  assert.match(text, /已完成/)
})


test('asset picker commits only on confirmation and preserves selected revisions across filters', async () => {
  let state, confirmed, closed = 0
  const client = await loadClientExports({ ...fakeReact(), useState(initial) {
    if (!state) state = typeof initial === 'function' ? initial() : initial
    return [state, value => { state = typeof value === 'function' ? value(state) : value }]
  } })
  const original = { asset_id: 'one', title: 'Original', revision: 3, input_revision: 'frozen-one', status: 'available' }
  const added = { asset_id: 'two', title: 'Added', revision: 2, input_revision: 'frozen-two', status: 'available' }
  const props = { items: [added], selectedAssets: [original], typeLabels: {}, onClose() { closed++ }, onConfirm(items) { confirmed = items } }
  const render = () => descendants(client.CreateAssetPicker(props))
  render().find(node => node.props['aria-label'] === '选择Added').props.onChange()
  assert.equal(confirmed, undefined)
  props.items = []
  render().find(node => node.children.includes('使用所选资产并返回')).props.onClick()
  assert.deepEqual(Array.from(confirmed, item => [item.asset_id, item.input_revision]), [['one', 'frozen-one'], ['two', 'frozen-two']])
  confirmed = undefined
  render().find(node => node.children.includes('取消')).props.onClick()
  assert.equal(closed, 1)
  assert.equal(confirmed, undefined)
  render().find(node => node.props.onKeyDown).props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} })
  assert.equal(closed, 2)
  assert.equal(confirmed, undefined)
  assert.equal(original.input_revision, 'frozen-one')
})

test('creation wizard preserves draft across scenarios and blocks forward navigation until ready', async () => {
  let index = 0
  const form = { repository: 'repo', target: '', source_scope_text: 'src/a.c', context_scope_text: 'test/a.c', asset_ids: ['asset'], scenario: 'module-analysis', mode: 'depth', provider_id: 'agent' }
  const states = { 1: { compatibility: { compatible: true }, capabilities: { repositories: ['repo'], source_first: { version: 'source-first-v1', analysis_options_by_profile: { 'behavior-test-v2': { scenarios: ['module-analysis', 'risk-analysis', 'branch-analysis', 'coverage-analysis'], modes: ['depth', 'speed'] } } } } }, 16: { type: 'create' }, 33: form }
  const client = await loadClientExports({ ...fakeReact(), useState(initial) { const key = index++; if (!(key in states)) states[key] = initial; return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value }] } })
  const pages = [], ctx = { pangea: { registerPage(page) { pages.push(page) } }, effect(fn) { return fn() } }
  client.apply(ctx)
  const render = () => { index = 0; const panel = pages.find(page => page.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true }); return descendants(panel.type(panel.props)) }
  let nodes = render()
  const next = nodes.find(node => node.children.includes('下一步 · 输入资料'))
  assert.equal(next.props.disabled, true)
  next.props.onClick()
  assert.equal(states[16].createStep, undefined)
  nodes.find(node => node.props['data-scenario'] === 'branch-analysis').props.onClick()
  assert.equal(states[33].scenario, 'branch-analysis')
  assert.equal(states[33].context_scope_text, 'test/a.c')
  assert.deepEqual(Array.from(states[33].asset_ids), ['asset'])
  render().find(node => node.props['aria-label'] === '分析目标').props.onChange({ target: { value: 'A module' } })
  render().find(node => node.children.includes('下一步 · 输入资料')).props.onClick()
  assert.equal(states[16].createStep, 2)
  render().find(node => node.children.includes('上一步')).props.onClick()
  assert.equal(states[16].createStep, 1)
  assert.equal(states[33].target, 'A module')
})

test('creation wizard resolves selected asset IDs without opening the asset picker', async () => {
  let index = 0
  const form = { repository: 'repo', target: 'CPU analysis', source_scope_text: 'src/cpu.c', context_scope_text: '',
    asset_ids: ['asset-requirement', 'asset-design'], scenario: 'module-analysis', mode: 'depth', provider_id: 'agent' }
  const states = {
    1: { compatibility: { compatible: true }, capabilities: { repositories: ['repo'], workflow_versions: ['source-first-v1'],
      source_first: { version: 'source-first-v1', analysis_options_by_profile: { 'behavior-test-v2': { scenarios: ['module-analysis'], modes: ['depth'] } } } },
      acp_providers: [{ id: 'agent', registered: true }] },
    16: { type: 'create', createStep: 2 },
    33: form,
    34: { assets: [] },
  }
  const requests = []
  const react = {
    ...fakeReact(),
    useState(initial) {
      const key = index++
      if (!(key in states)) states[key] = initial
      return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value }]
    },
    useEffect(effect) { if (String(effect).includes('missingAssetIds')) effect() },
  }
  const client = await loadClientExports(react, async (url, options) => {
    const parsed = new URL(url, 'http://localhost')
    requests.push({ url: parsed, options })
    const assetId = parsed.searchParams.get('asset_id')
    const asset = assetId === 'asset-requirement'
      ? { asset_id: assetId, title: 'CPU 采样需求', asset_type: 'requirement', revision: 3, input_revision: 'r3', status: 'available' }
      : { asset_id: assetId, title: '负载计算设计', asset_type: 'design', revision: 2, input_revision: 'r2', status: 'available' }
    return { ok: true, async json() { return { status: 'ok', asset } } }
  })
  const pages = [], ctx = { pangea: { registerPage(page) { pages.push(page) } }, effect(fn) { return fn() } }
  client.apply(ctx)
  const render = () => {
    index = 0
    const panel = pages.find(page => page.id === 'analysis').component({ ctx, scope: { cwd: '/workspace' }, visible: true })
    return descendants(panel.type(panel.props))
  }
  render()
  await new Promise(resolve => setTimeout(resolve, 0))
  const nodes = render()
  assert.deepEqual(requests.map(item => item.url.searchParams.get('asset_id')).sort(), ['asset-design', 'asset-requirement'])
  assert.ok(requests.every(item => item.url.searchParams.get('cwd') === '/workspace'))
  const text = JSON.stringify(nodes)
  assert.match(text, /CPU 采样需求/)
  assert.match(text, /负载计算设计/)
  assert.match(text, /输入版本 r3/)
  assert.match(text, /输入版本 r2/)
  assert.doesNotMatch(text, /正在读取资产详情|待读取/)
})
