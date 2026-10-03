import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const clone = value => JSON.parse(JSON.stringify(value))
const tick = () => new Promise(resolve => setImmediate(resolve))
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes)
  return node?.children ? [node, ...node.children.flatMap(nodes)] : []
}

// Keep hook state and refs across actual component rerenders. The only effect
// enabled here is the feature's selection invalidation; unrelated page polling
// and browser integrations belong to the existing workbench integration tests.
function hookRuntime() {
  const banks = new Map()
  let current
  function bank(name) {
    if (!banks.has(name)) banks.set(name, { states: [], refs: [], effects: [], dirty: false })
    return banks.get(name)
  }
  const react = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) { return { type, props: props ?? {}, children } },
    useState(initial) {
      const owner = current, index = owner.stateIndex++
      if (!(index in owner.states)) owner.states[index] = typeof initial === 'function' ? initial() : initial
      return [owner.states[index], update => {
        const value = typeof update === 'function' ? update(owner.states[index]) : update
        if (!Object.is(value, owner.states[index])) { owner.states[index] = value; owner.dirty = true }
      }]
    },
    useRef(initial) {
      const index = current.refIndex++
      return current.refs[index] ??= { current: initial }
    },
    useCallback(callback) { return callback },
    useEffect(effect, deps) {
      const owner = current, index = owner.effectIndex++
      if (!String(effect).includes('++derivationRequestRef.current')) return
      const old = owner.effects[index]
      if (!old || deps.some((value, i) => !Object.is(value, old[i]))) {
        owner.effects[index] = [...deps]
        owner.pending.push(effect)
      }
    },
  }
  return {
    react, bank,
    render(name, callback) {
      const owner = bank(name)
      let tree, attempts = 0
      do {
        assert.ok(++attempts < 10, 'render did not settle')
        owner.dirty = false; owner.stateIndex = 0; owner.refIndex = 0; owner.effectIndex = 0; owner.pending = []
        current = owner
        tree = callback()
        for (const effect of owner.pending) effect()
      } while (owner.dirty)
      return tree
    },
  }
}

const parent = { task_id: 'parent-task', run_id: 'parent-run', title: 'TLS 原分析', repository: 'repo',
  workspace: '/workspace', data_root: '/workspace/data-a', status: 'completed', execution_status: 'completed' }
const record = { action_id: 'analysis-one', record_id: 'record-one', unit_id: 'unit-one', title: '资源释放', kind: 'test_case' }
const options = { can_derive: true, parent_run_id: parent.run_id, units: [{ unit_id: 'unit-one', title: 'TLS' }], records: [record] }
function snapshot(task, extra = {}) {
  return { status: 'ok', data_root: task.data_root, current: { run_id: task.run_id, data_root: task.data_root,
    workflow_version: 'source-first-v1', lifecycle_status: 'complete', terminal: true,
    publication: { state: 'final' }, details: {}, workflow: { steps: [], units: [], actions: [] }, ...extra } }
}
const instruction = '仅补充断链后的资源释放场景'

async function harness({ selected = parent, tasks = [selected], current = snapshot(selected), onOptions, onDerive, onStart } = {}) {
  const hooks = hookRuntime(), states = hooks.bank('panel').states
  let cwd = selected.workspace, exported
  let serverTasks = clone(tasks)
  const workbench = () => ({ status: 'ok', compatibility: { compatible: true }, tasks: { items: clone(serverTasks), total: serverTasks.length }, runs: { items: [] } })
  Object.assign(states, { 0: current, 1: workbench(), 4: selected.run_id, 5: selected.task_id, 16: { type: 'overview' } })
  const child = { ...clone(parent), task_id: 'child-task', run_id: null, title: 'TLS 定向补充',
    source_task_id: parent.task_id, status: 'preparing', execution_status: null, conversations: [] }
  const requests = [], selectedIds = [], openedSessions = [], pages = []
  const fetcher = async (url, request = {}) => {
    if (request.method !== 'POST') return { ok: true, json: async () => workbench() }
    const body = JSON.parse(request.body)
    requests.push({ cwd: new URL(url, 'https://fixture').searchParams.get('cwd'), ...body })
    let response
    if (body.action === 'derivation-options') response = await (onOptions?.(body) ?? { status: 'ok', options })
    else if (body.action === 'task-derive') {
      response = await (onDerive?.(body) ?? { status: 'ok', task: child })
      if (response.status === 'ok') serverTasks.unshift(clone(response.task))
    } else if (body.action === 'task-start') {
      // React commits the child selection while the network request is in
      // flight. Update persistent scope refs before delivering its response.
      render()
      response = await (onStart?.(body) ?? { status: 'ok', session_id: 'child-session', task: { ...child, run_id: 'child-run' } })
      if (response.status === 'ok') serverTasks = serverTasks.map(task => task.task_id === body.task_id ? { ...task, run_id: 'child-run' } : task)
    } else throw new Error(`Unexpected workbench action: ${body.action}`)
    return { ok: response.status === 'ok', status: response.status === 'ok' ? 200 : 400, json: async () => response }
  }
  const sandbox = { URLSearchParams, AbortController, console, fetch: fetcher, setInterval, clearInterval,
    CustomEvent: class { constructor(type, value) { this.type = type; this.detail = value?.detail } } }
  sandbox.window = { dispatchEvent() {}, setInterval, clearInterval, setTimeout: (...args) => setTimeout(...args).unref(), clearTimeout,
    __ModuleLoader__: { load(spec) { exported = spec.factory(name => name === 'react' ? hooks.react : {}) } } }
  vm.runInNewContext(await readFile(new URL('../src/client.js', import.meta.url), 'utf8'), sandbox)
  const ctx = { effect(fn) { return fn() }, sessions: { open: async id => openedSessions.push(id) },
    pangea: { registerPage(page) { pages.push(page) }, selectTask(id) { selectedIds.push(id) }, registerProductSession() {}, openPage() { return true } } }
  exported.apply(ctx)
  function render() {
    const panel = pages.find(page => page.id === 'analysis').component({ ctx, scope: { cwd }, visible: true })
    return nodes(hooks.render('panel', () => panel.type(panel.props)))
  }
  function dialog() {
    const node = render().find(node => node.type === exported.RunDerivationDialog)
    return node ? { ...node, nodes: nodes(hooks.render('dialog', () => node.type(node.props))) } : null
  }
  async function open() {
    const button = render().find(node => node.children.includes('补充 / 增量分析') || node.children.includes('补充这条结果'))
    assert.ok(button)
    assert.equal(button.props.disabled, false)
    button.props.onClick()
    await tick()
    return dialog()
  }
  function fill() {
    const modal = dialog()
    assert.ok(modal)
    modal.nodes.find(node => node.props['aria-label'] === '本次分析要求').props.onChange({ target: { value: instruction } })
  }
  function submit() {
    const modal = dialog()
    const button = modal.nodes.find(node => node.children.includes('创建并开始分析'))
    assert.equal(Boolean(button.props.disabled), false)
    button.props.onClick()
  }
  function select(task, workspace = task.workspace) {
    cwd = workspace
    states[1] = { ...workbench(), tasks: { items: [...serverTasks.filter(item => item.task_id !== task.task_id), task] } }
    states[0] = snapshot(task); states[4] = task.run_id; states[5] = task.task_id
    render()
  }
  return { states, requests, selectedIds, openedSessions, child, render, dialog, open, fill, submit, select }
}

test('incremental client creates then starts exactly one child with the selected input and independent identity', async () => {
  const h = await harness()
  await h.open(); h.fill()
  h.dialog().nodes.find(node => node.props['aria-label'] === '选择记录 资源释放').props.onChange({ target: { checked: true } })
  h.submit()
  await tick(); await tick()
  assert.deepEqual(h.requests.map(item => item.action), ['derivation-options', 'task-derive', 'task-start'])
  assert.deepEqual(h.requests[1], { cwd: '/workspace', action: 'task-derive', task_id: parent.task_id, run_id: parent.run_id,
    input: { mode: 'supplement', instruction, selected_unit_ids: [], selected_records: [{ action_id: record.action_id, record_id: record.record_id }], changed_paths: [] } })
  assert.deepEqual(h.requests[2], { cwd: '/workspace', action: 'task-start', task_id: 'child-task', data_root: parent.data_root, resume: false })
  assert.equal(h.states[5], 'child-task')
  assert.deepEqual(h.openedSessions, ['child-session'])
  assert.equal(h.dialog(), null)
})

test('incremental create failure retains the draft for retry and never starts a nonexistent task', async () => {
  let attempts = 0
  const h = await harness({ onDerive: () => ++attempts === 1 ? { status: 'error', error: '来源记录已变化' } : { status: 'ok', task: h.child } })
  await h.open(); h.fill(); h.submit(); await tick()
  assert.equal(h.dialog().props.state.error, '来源记录已变化')
  assert.equal(h.dialog().props.state.draft.instruction, instruction)
  assert.equal(h.requests.some(item => item.action === 'task-start'), false)
  assert.ok(h.dialog().nodes.find(node => node.children.includes('重新读取')))
  h.submit(); await tick(); await tick()
  assert.equal(h.requests.filter(item => item.action === 'task-derive').length, 2)
  assert.equal(h.requests.filter(item => item.action === 'task-start').length, 1)
})

test('incremental start failure keeps the already-created child selected and reports a retryable launch failure', async () => {
  const h = await harness({ onStart: () => ({ status: 'error', error: '执行 Agent 尚不可用' }) })
  await h.open(); h.fill(); h.submit(); await tick(); await tick()
  assert.equal(h.states[5], 'child-task')
  assert.equal(h.states[1].tasks.items.some(task => task.task_id === 'child-task'), true)
  assert.match(h.states[22].message, /启动失败.*执行 Agent 尚不可用/)
  assert.equal(h.dialog(), null)
  assert.equal(h.requests.filter(item => item.action === 'task-derive').length, 1)
  assert.equal(h.requests.filter(item => item.action === 'task-start').length, 1)
  assert.deepEqual(h.openedSessions, [])
})

for (const switchWorkspace of [false, true]) {
  test(`delayed derivation cannot take over a newly selected ${switchWorkspace ? 'workspace' : 'task'} or start its saved child`, async () => {
    const pending = deferred()
    const h = await harness({ onDerive: () => pending.promise })
    await h.open(); h.fill(); h.submit()
    const other = { ...parent, task_id: 'other-task', run_id: 'other-run',
      ...(switchWorkspace ? { workspace: '/other-workspace', data_root: '/other-workspace/data' } : {}) }
    h.select(other)
    pending.resolve({ status: 'ok', task: h.child })
    await tick(); await tick()
    assert.equal(h.states[5], 'other-task')
    assert.equal(h.states[4], 'other-run')
    assert.equal(h.dialog(), null)
    assert.equal(h.requests.some(item => item.action === 'task-start'), false)
    assert.deepEqual(h.selectedIds, [])
    assert.deepEqual(h.openedSessions, [])
  })
}

test('delayed options do not reopen a dialog after task selection changes', async () => {
  const pending = deferred()
  const h = await harness({ onOptions: () => pending.promise })
  await h.open()
  assert.equal(h.dialog().props.state.pending, 'options')
  h.select({ ...parent, task_id: 'next-task', run_id: 'next-run' })
  pending.resolve({ status: 'ok', options })
  await tick()
  assert.equal(h.dialog(), null)
  assert.equal(h.states[5], 'next-task')
})

for (const switchWorkspace of [false, true]) {
  test(`a delayed child launch response cannot reopen its session after switching ${switchWorkspace ? 'workspaces' : 'tasks'}`, async () => {
    const pending = deferred()
    const h = await harness({ onStart: () => pending.promise })
    await h.open(); h.fill(); h.submit(); await tick()
    assert.equal(h.requests.at(-1).action, 'task-start')
    h.select({ ...parent, task_id: 'next-task', run_id: 'next-run',
      ...(switchWorkspace ? { workspace: '/other-workspace', data_root: '/other-workspace/data' } : {}) })
    pending.resolve({ status: 'ok', session_id: 'old-selection-child-session' })
    await tick(); await tick()
    assert.equal(h.states[5], 'next-task')
    assert.deepEqual(h.openedSessions, [])
  })
}

test('source navigation uses exact parent task and data root when another Run has the same ID', async () => {
  const wrong = { ...parent, task_id: 'wrong-parent', data_root: '/workspace/data-b' }
  const child = { ...parent, task_id: 'child-task', run_id: 'child-run', source_task_id: parent.task_id,
    incremental_request: { parent_run_id: parent.run_id, mode: 'supplement', instruction } }
  const h = await harness({ selected: child, tasks: [wrong, child, parent] })
  h.render().find(node => node.children.includes('查看来源分析')).props.onClick()
  assert.equal(h.states[5], parent.task_id)
  assert.equal(h.states[4], parent.run_id)
  assert.deepEqual(h.selectedIds, [parent.task_id])
})

test('missing source task does not fall back to an unrelated task with the same Run ID', async () => {
  const wrong = { ...parent, task_id: 'wrong-parent', data_root: '/workspace/data-b' }
  const child = { ...parent, task_id: 'child-task', run_id: 'child-run', source_task_id: 'missing-parent',
    incremental_request: { parent_run_id: parent.run_id, mode: 'supplement', instruction } }
  const h = await harness({ selected: child, tasks: [wrong, child] })
  h.render().find(node => node.children.includes('查看来源分析')).props.onClick()
  assert.equal(h.states[5], child.task_id)
  assert.match(h.states[22].message, /来源任务已不在当前工作区/)
  assert.deepEqual(h.selectedIds, [])
})

test('loading current candidates removes an obsolete preselected record and explains the change', async () => {
  const stale = { test_case_id: 'stale-case', title: '旧记录', source_record: { action_id: 'old-action', record_id: 'old-record' } }
  const h = await harness({ current: snapshot(parent, { details: { test_cases: [stale] } }) })
  h.states[16] = { type: 'case', id: stale.test_case_id }
  await h.open()
  const state = h.dialog().props.state
  assert.deepEqual(clone(state.draft.selected_records), [])
  assert.match(state.notice, /已取消这些选择/)
  h.fill(); h.submit(); await tick(); await tick()
  assert.deepEqual(h.requests.find(item => item.action === 'task-derive').input.selected_records, [])
})
