import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const tick = () => new Promise(resolve => setImmediate(resolve))
const sameDeps = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
const deferred = () => {
  let resolve
  return { promise: new Promise(done => { resolve = done }), resolve: value => resolve(value) }
}
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes)
  return node?.children ? [node, ...node.children.flatMap(nodes)] : []
}
function content(node) {
  if (Array.isArray(node)) return node.map(content).join(' ')
  return node?.children ? content(node.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''
}
const activeTask = { task_id: 'task-1', run_id: 'run-1', title: 'TLS 握手分析', repository: 'repo', target: 'TLS', status: 'running', execution_status: 'running' }
const homeResponse = (tasks = [activeTask]) => ({ status: 'ok', view: 'home', compatibility: { compatible: null, checked: false },
  tasks: { items: tasks }, runs: { items: [] }, capabilities: { repositories: ['repo'] } })

// Exercise the real page's request/effect dependencies, including deferred HTTP
// responses and polling clocks. Callback memoization follows React semantics.
async function harness({ page = 'workbench', visible = true, onWorkbench, onRepositories, onState, runDraft } = {}) {
  const states = [], refs = [], effects = [], callbacks = [], requests = [], navigation = [], events = [], timers = new Map(), pages = []
  let stateIndex, refIndex, effectIndex, callbackIndex, pending, tree, exported, dirty = true, now = 0, timerId = 0
  let scope = { cwd: '/workspace', sessionId: 'session-1' }, shown = visible
  const bodyAttributes = new Map()
  const schedule = (fn, delay = 0) => { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id }
  const react = {
    Fragment: Symbol('Fragment'), createElement(type, props, ...children) { return { type, props: props ?? {}, children } },
    useState(initial) {
      const key = stateIndex++
      if (!(key in states)) states[key] = typeof initial === 'function' ? initial() : initial
      return [states[key], update => { const value = typeof update === 'function' ? update(states[key]) : update; if (!Object.is(value, states[key])) { states[key] = value; dirty = true } }]
    },
    useRef(initial) { const key = refIndex++; return refs[key] ??= { current: initial } },
    useCallback(fn, deps) { const key = callbackIndex++; if (!sameDeps(callbacks[key]?.deps, deps)) callbacks[key] = { fn, deps }; return callbacks[key].fn },
    useEffect(fn, deps) {
      const key = effectIndex++, previous = effects[key]
      if (!sameDeps(previous?.deps, deps)) pending.push(() => { previous?.cleanup?.(); effects[key] = { deps, cleanup: fn() } })
    },
  }
  const sandbox = { URLSearchParams, AbortController, console,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail } },
    document: { visibilityState: 'visible', body: { setAttribute(key, value) { bodyAttributes.set(key, value) }, getAttribute(key) { return bodyAttributes.get(key) }, removeAttribute(key) { bodyAttributes.delete(key) } }, addEventListener() {}, removeEventListener() {} },
    fetch: async (input, init = {}) => {
      const url = new URL(input, 'https://fixture'), call = { path: url.pathname, query: Object.fromEntries(url.searchParams), signal: init.signal }
      requests.push(call)
      let result
      if (url.pathname.endsWith('/workbench')) result = await (onWorkbench?.(call) ?? homeResponse())
      else if (url.pathname.endsWith('/repositories')) result = await (onRepositories?.(call) ?? { status: 'ok', repositories: [{ name: 'repo' }], onboarding_required: false })
      else if (url.pathname.endsWith('/state')) result = await (onState?.(call) ?? { status: 'ok', current: { run_id: 'run-1', details: {} }, runs: [] })
      else throw new Error(`Unexpected request ${input}`)
      return { ok: result.status === 'ok', status: result.status === 'ok' ? 200 : 500, json: async () => result }
    },
  }
  sandbox.window = { dispatchEvent(event) { events.push(event) }, setTimeout: schedule, clearTimeout: id => timers.delete(id), addEventListener() {}, removeEventListener() {}, localStorage: { getItem() { return null } },
    __ModuleLoader__: { load(spec) { exported = spec.factory(name => name === 'react' ? react : {}) } } }
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), sandbox)
  const ctx = { pangea: {
    registerPage(value) { pages.push(value) },
    getRunDraft() { return runDraft },
    requestRunCreation(value) { navigation.push({ type: 'create', scope: value }); return true },
    selectTask(taskId) { navigation.push({ type: 'select-task', taskId }) },
    updateRunDraft(value) { navigation.push({ type: 'draft', value }) },
    openPage(value, pageId) { navigation.push({ type: 'page', pageId, scope: value }); return true },
  }, effect(fn) { return fn() } }
  exported.apply(ctx)
  function render() {
    let iterations = 0
    do {
      assert.ok(++iterations < 25, 'effects must settle without repeated request/render loops')
      dirty = false; stateIndex = refIndex = effectIndex = callbackIndex = 0; pending = []
      const panel = pages.find(value => value.id === page).component({ scope, visible: shown })
      tree = panel.type(panel.props)
      for (const run of pending) run()
    } while (dirty)
  }
  async function settle() {
    for (let turn = 0; turn < 8; turn++) {
      if (dirty) render()
      const due = [...timers].filter(([, value]) => value.at <= now)
      for (const [id, timer] of due) { timers.delete(id); timer.fn() }
      await tick()
    }
    if (dirty) render()
  }
  render(); await settle()
  return { requests, navigation, events, settle, text: () => content(tree), nodes: () => nodes(tree),
    async click(label) {
      const button = nodes(tree).find(node => node.type === 'button' && content(node).trim() === label)
      assert.ok(button, `missing button ${label}`)
      assert.equal(Boolean(button.props.disabled), false, `${label} must be usable`)
      await button.props.onClick(); await settle()
    },
    async advance(milliseconds) { now += milliseconds; await settle() },
    async change(next = {}) { scope = { ...scope, ...next }; dirty = true; await settle() },
    async show(value) { shown = value; dirty = true; await settle() },
    cleanup() { for (const effect of effects) effect?.cleanup?.(); timers.clear() },
  }
}

test('home loads one lightweight summary without a full Run snapshot or immediate running-task repoll', async () => {
  const h = await harness()
  try {
    assert.equal(h.requests.filter(call => call.path.endsWith('/workbench')).length, 1)
    assert.equal(h.requests.filter(call => call.path.endsWith('/state')).length, 0)
    const query = h.requests.find(call => call.path.endsWith('/workbench')).query
    assert.equal(query.view, 'home')
    for (const key of ['run_id', 'task_id', 'session_id']) assert.equal(key in query, false)
    assert.match(h.text(), /TLS 握手分析/)
    await h.advance(1)
    assert.equal(h.requests.filter(call => call.path.endsWith('/workbench')).length, 1)
    await h.advance(10_000)
    assert.equal(h.requests.filter(call => call.path.endsWith('/workbench')).length, 2)
  } finally { h.cleanup() }
})

test('slow repository detection does not hide loaded task data or block the workbench shell', async () => {
  const repository = deferred(), h = await harness({ onRepositories: () => repository.promise })
  try {
    assert.match(h.text(), /测试工作台/)
    assert.match(h.text(), /TLS 握手分析/)
    assert.doesNotMatch(h.text(), /正在初始化 PANGEA/)
    repository.resolve({ status: 'ok', repositories: [{ name: 'repo' }], onboarding_required: false })
    await h.settle()
    assert.equal(h.requests.filter(call => call.path.endsWith('/workbench')).length, 1)
  } finally { h.cleanup() }
})

test('unknown task metrics stay unavailable until their real summary arrives', async () => {
  const response = deferred(), h = await harness({ onWorkbench: () => response.promise })
  try {
    const metrics = h.nodes().filter(node => node.props.className === 'b06-metric')
    assert.equal(metrics.length, 4)
    assert.ok(metrics.every(node => content(node).includes('—')))
    assert.doesNotMatch(h.text(), /当前没有待处理事项|当前没有进行中的分析/)
    response.resolve(homeResponse())
    await h.settle()
    assert.match(h.text(), /TLS 握手分析/)
  } finally { h.cleanup() }
})

test('repository errors are isolated to their card and first-use onboarding remains reachable', async () => {
  const h = await harness({ onRepositories: () => ({ status: 'error', error: 'marker unavailable' }) })
  try {
    assert.match(h.text(), /源码仓库状态读取失败/)
    assert.match(h.text(), /TLS 握手分析/)
  } finally { h.cleanup() }
  const initial = await harness({ onRepositories: () => ({ status: 'ok', repositories: [], onboarding_required: true }) })
  try { assert.match(initial.text(), /欢迎使用 PANGEA/); assert.match(initial.text(), /完成初始化/) }
  finally { initial.cleanup() }
})

test('hidden pages do not request data; changing the chat session does not reload home', async () => {
  const h = await harness({ visible: false })
  try {
    assert.equal(h.requests.length, 0)
    await h.show(true)
    assert.equal(h.requests.filter(call => call.path.endsWith('/workbench')).length, 1)
    await h.change({ sessionId: 'session-2' })
    assert.equal(h.requests.filter(call => call.path.endsWith('/workbench')).length, 1)
    await h.show(false)
    await h.advance(60_000)
    assert.equal(h.requests.filter(call => call.path.endsWith('/workbench')).length, 1)
  } finally { h.cleanup() }
})

test('late home summary cannot replace a different workspace or a hidden page', async () => {
  const old = deferred(), h = await harness({ onWorkbench: call => call.query.cwd === '/workspace' ? old.promise : homeResponse([{ ...activeTask, title: 'new workspace' }]) })
  try {
    await h.change({ cwd: '/new-workspace' })
    old.resolve(homeResponse([{ ...activeTask, title: 'stale workspace' }]))
    await h.settle()
    assert.match(h.text(), /new workspace/)
    assert.doesNotMatch(h.text(), /stale workspace/)
  } finally { h.cleanup() }
  const response = deferred(), hidden = await harness({ onWorkbench: () => response.promise })
  try {
    await hidden.show(false)
    response.resolve(homeResponse())
    await hidden.settle()
    assert.doesNotMatch(hidden.text(), /TLS 握手分析/)
  } finally { hidden.cleanup() }
})


test('manual home refresh reloads summary and repositories without requesting Run details', async () => {
  const h = await harness()
  try {
    await h.click('刷新')
    assert.equal(h.requests.filter(call => call.path.endsWith('/workbench')).length, 2)
    assert.equal(h.requests.filter(call => call.path.endsWith('/repositories')).length, 2)
    assert.equal(h.requests.filter(call => call.path.endsWith('/state')).length, 0)
    assert.ok(h.requests.filter(call => call.path.endsWith('/workbench')).every(call => call.query.view === 'home'))
    assert.match(h.text(), /工作台已同步/)
  } finally { h.cleanup() }
})

test('unprobed home compatibility permits page navigation without claiming runtime health', async () => {
  const h = await harness()
  try {
    assert.match(h.text(), /TLS 握手分析/)
    assert.doesNotMatch(h.text(), /当前工作区需要更新/)
    assert.equal(h.events.filter(event => event.type === 'pangea:system-state').at(-1).detail.state, 'checking')
    await h.click('新建分析')
    assert.equal(h.navigation.at(-1).type, 'create')
    await h.click('查看进度')
    assert.ok(h.navigation.some(item => item.type === 'select-task' && item.taskId === activeTask.task_id))
    assert.equal(h.navigation.at(-1).pageId, 'analysis')
    const assetShortcut = h.nodes().find(node => node.type === 'button' && content(node).includes('测试资产') && content(node).includes('管理资料'))
    assert.ok(assetShortcut)
    assetShortcut.props.onClick(); await h.settle()
    assert.equal(h.navigation.at(-1).pageId, 'assets')
    assert.equal(h.requests.filter(call => call.path.endsWith('/state')).length, 0)
  } finally { h.cleanup() }
})

const failedPersistence = {
  status: 'degraded', pending: true, last_success_at_ms: 10, last_failure_at_ms: 20,
  consecutive_failures: 1, recovered_at_ms: null, error: { code: 'EPERM', message: 'rename monitor-v1.json.tmp -> monitor-v1.json' },
}
const recoveredPersistence = {
  status: 'healthy', pending: false, last_success_at_ms: 30, last_failure_at_ms: 20,
  consecutive_failures: 0, recovered_at_ms: 30, error: null,
}
const oldHealthyPersistence = { ...recoveredPersistence, last_success_at_ms: 10, last_failure_at_ms: null, recovered_at_ms: null }

test('home persistence warning keeps real tasks visible and recovers through the existing lightweight poll', async () => {
  let persistence = failedPersistence
  const h = await harness({ onWorkbench: () => ({ ...homeResponse(), monitor_persistence: persistence }) })
  try {
    assert.match(h.text(), /运行观察记录暂未保存/)
    assert.match(h.text(), /部分运行观察历史可能在重启后丢失/)
    assert.match(h.text(), /分析结果和测试用例的状态仍以各自产物为准/)
    assert.match(h.text(), /TLS 握手分析/)
    assert.match(h.text(), /EPERM/)
    assert.ok(h.nodes().some(node => node.props.role === 'alert' && node.props['aria-label'] === '监控记录保存异常'))
    assert.equal(h.events.filter(event => event.type === 'pangea:system-state').at(-1).detail.label, '监控保存异常')
    assert.equal(h.requests.filter(call => call.path.endsWith('/workbench')).length, 1)
    assert.equal(h.requests.filter(call => call.path.endsWith('/state')).length, 0)
    persistence = recoveredPersistence
    await h.advance(2_000)
    assert.doesNotMatch(h.text(), /运行观察记录暂未保存/)
    assert.match(h.text(), /TLS 握手分析/)
    assert.equal(h.requests.filter(call => call.path.endsWith('/workbench')).length, 2)
    assert.equal(h.requests.filter(call => call.path.endsWith('/state')).length, 0)
    assert.equal(h.events.filter(event => event.type === 'pangea:system-state').at(-1).detail.state, 'checking')
  } finally { h.cleanup() }
})

test('idle home checks persistence recovery without continuous polling after recovery', async () => {
  let persistence = failedPersistence
  const h = await harness({ onWorkbench: () => ({ ...homeResponse([]), monitor_persistence: persistence }) })
  try {
    assert.match(h.text(), /运行观察记录暂未保存/)
    assert.equal(h.requests.filter(call => call.path.endsWith('/workbench')).length, 1)
    persistence = recoveredPersistence
    await h.advance(2_000)
    assert.doesNotMatch(h.text(), /运行观察记录暂未保存/)
    assert.equal(h.requests.filter(call => call.path.endsWith('/workbench')).length, 2)
    await h.advance(10_000)
    assert.equal(h.requests.filter(call => call.path.endsWith('/workbench')).length, 2)
    assert.equal(h.requests.filter(call => call.path.endsWith('/state')).length, 0)
  } finally { h.cleanup() }
})

test('analysis chooses the newest persistence event across state and workbench responses', async () => {
  let workbenchPersistence = oldHealthyPersistence
  let statePersistence = failedPersistence
  const h = await harness({ page: 'analysis',
    onWorkbench: () => ({ ...homeResponse(), compatibility: { compatible: true }, monitor_persistence: workbenchPersistence }),
    onState: () => ({ status: 'ok', current: null, runs: [], monitor: { persistence: statePersistence } }),
  })
  try {
    assert.match(h.text(), /运行观察记录暂未保存/)
    assert.match(h.text(), /TLS 握手分析/)
    assert.equal(h.events.filter(event => event.type === 'pangea:system-state').at(-1).detail.label, '监控保存异常')
    workbenchPersistence = recoveredPersistence
    await h.advance(2_000)
    assert.doesNotMatch(h.text(), /运行观察记录暂未保存/)
    assert.equal(h.events.filter(event => event.type === 'pangea:system-state').at(-1).detail.state, 'ok')
    // A fresh failure from /state must supersede the previous recovery; its
    // later successful save must clear the warning even if /workbench is stale.
    statePersistence = { ...failedPersistence, last_failure_at_ms: 40 }
    await h.advance(45_000)
    assert.match(h.text(), /运行观察记录暂未保存/)
    statePersistence = { ...recoveredPersistence, last_success_at_ms: 50, recovered_at_ms: 50, last_failure_at_ms: 40 }
    await h.advance(45_000)
    assert.doesNotMatch(h.text(), /运行观察记录暂未保存/)
    assert.match(h.text(), /TLS 握手分析/)
  } finally { h.cleanup() }
})

test('workflow early return also exposes monitor persistence failures without changing Run status', async () => {
  const run = { run_id: 'run-1', workflow_version: 'source-first-v1', execution_status: 'running', details: {} }
  const h = await harness({ page: 'analysis', runDraft: { requestId: 1, intent: 'select-run', runId: 'run-1' },
    onWorkbench: () => ({ ...homeResponse([]), monitor_persistence: failedPersistence }),
    onState: () => ({ status: 'ok', current: run, runs: [], monitor: { persistence: failedPersistence } }),
  })
  try {
    assert.match(h.text(), /运行观察记录暂未保存/)
    const workspace = h.nodes().find(node => node.type?.name === 'RunWorkspace')
    assert.ok(workspace, 'the workflow route renders its Run workspace')
    assert.equal(workspace.props.current.execution_status, 'running')
  } finally { h.cleanup() }
})
