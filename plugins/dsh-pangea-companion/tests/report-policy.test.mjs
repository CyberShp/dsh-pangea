import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import { apply, inspectSourceFirstChildren, interruptSourceFirstChildren, isPangeaWorkspace } from '../src/report-policy.js'

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-source-first-policy-'))
  const rules = path.join(root, '.agents', 'pangea')
  await mkdir(rules, { recursive: true })
  await writeFile(path.join(rules, 'dsh.md'), 'source-first DSH rules')
  for (const role of ['planning', 'analysis', 'review', 'closure']) {
    await writeFile(path.join(rules, `${role}-worker.md`), `# ${role} source-first worker`)
  }
  return root
}

function agent(cwd, id) {
  return {
    id,
    options: { provider: 'test-provider', model: 'test-model', reasoningEffort: 'high' },
    session: { header: { cwd } },
  }
}

function execFor(owner, name, args) {
  let concluded = false
  return {
    agent: owner,
    name,
    arguments: args,
    signal: undefined,
    concludeTurn() { concluded = true },
    get concluded() { return concluded },
  }
}

function harness(execution = async () => ({})) {
  const listeners = new Map()
  const tools = new Map()
  const interrupts = []
  const starts = []
  const followups = []
  const binds = []
  const drains = []
  const continuableSetups = []
  let guard
  const ctx = {
    subagents: {
      interrupt(id) { interrupts.push(id) },
      async drainContinuableChildren(parent, childIds) { drains.push({ parent, childIds }) },
      async startContinuable(spec) {
        // The real host rejects child-local tools in the global allow list.
        assert.equal(spec.request.toolFilter.allow.includes('report'), false)
        starts.push(spec)
        return { childId: `child-${starts.length}` }
      },
      async followup(parent, childId, content, options) {
        followups.push({ parent, childId, content, options })
        return `followup-${followups.length}`
      },
      registerContinuableSetup(setup) {
        continuableSetups.push(setup)
        return () => {}
      },
    },
    tools: {
      register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) },
      guard(value) { guard = value; return () => {} },
    },
    systemPrompt: { section() { return () => {} } },
    on(name, listener) { listeners.set(name, listener); return () => {} },
  }
  const adapter = async (_cwd, operation, input) => {
    binds.push({ operation, input })
    return { action_id: input.action_id, status: 'dispatched' }
  }
  apply(ctx, adapter, execution)
  return {
    tools,
    ctx,
    interrupts,
    drains,
    starts,
    followups,
    binds,
    continuableSetups,
    emit(name, payload) { return listeners.get(name)?.(payload) },
    guard(value) { return guard(value) },
    async post(exec, value) {
      return listeners.get('tools/post-execute')(
        exec,
        { isError: false, value },
        async () => ({ kind: 'accept', value }),
      )
    },
    settle(owner, childId, messageId = `settled-${childId}`) {
      const listener = listeners.get('agent/inbox/inserted')
      return listener({ agent: owner, message: { id: messageId, source: { kind: 'subagent-settled', senderSessionId: childId } } })
    },
  }
}

test('reuses the host report setup instead of registering a duplicate child prompt section', async () => {
  const root = await fixture()
  const h = harness()
  assert.equal(isPangeaWorkspace(root), true)
  assert.deepEqual(h.continuableSetups, [])
})

function action(root, name, actionType = 'dispatch_agent', taskId = null) {
  const taskPath = path.join(root, 'pangea-data', 'runs', 'run-01', 'agent-tasks', `${name}.json`)
  const resultPath = path.join(root, 'pangea-data', 'runs', 'run-01', 'agent-results', `${name}.json`)
  return {
    action_id: `run-01:${name}`,
    action: actionType,
    role: name === 'review' ? 'review' : 'analysis',
    stage: name === 'review' ? 'independent_review' : 'unit_analysis',
    task_path: taskPath,
    task_id: taskId,
    resultPath,
  }
}

async function prepareAction(root, current) {
  await mkdir(path.dirname(current.task_path), { recursive: true })
  await mkdir(path.dirname(current.resultPath), { recursive: true })
  await writeFile(current.task_path, JSON.stringify({
    workflow_version: 'source-first-v1',
    action_id: current.action_id,
    run_id: 'run-01',
    result_path: current.resultPath,
  }))
}

test('dispatch creates one real child and binds the exact Graph action', async () => {
  const root = await fixture()
  const owner = agent(root, 'root-agent')
  const current = action(root, 'analysis-u0')
  await prepareAction(root, current)
  const h = harness()
  const create = execFor(owner, 'pangea_run_create', {})
  await h.post(create, {
    workflow_version: 'source-first-v1',
    run_id: 'run-01',
    data_root: path.join(root, 'pangea-data'),
    actions: [current],
  })
  assert.equal(h.guard(execFor(owner, 'pangea_action_next', { run_id: 'run-01', data_root: path.join(root, 'pangea-data') })), undefined)
  assert.equal(h.guard(execFor(owner, 'pangea_status', {})), undefined)
  assert.equal(h.guard(execFor(owner, 'ask_user_question', {})), undefined)
  const dispatch = execFor(owner, 'pangea_action_dispatch', { action_id: current.action_id })
  const value = await h.tools.get('pangea_action_dispatch').execute(dispatch.arguments, dispatch)
  assert.deepEqual(value, { kind: 'continuable', subagent_id: 'child-1', action_id: current.action_id, bound: true })
  assert.equal(h.starts.length, 1)
  assert.match(h.starts[0].request.prompt[0].text, /等待宿主完成 Graph bind/)
  assert.match(h.starts[0].request.persona, /analysis source-first worker/)
  assert.equal(h.starts[0].request.toolFilter.allow.includes('pangea_task_open'), true)
  assert.equal(h.starts[0].request.toolFilter.allow.includes('pangea_result_repair'), true)
  assert.equal(h.starts[0].request.toolFilter.allow.includes('pangea_result_supersede'), true)
  assert.equal(h.starts[0].request.toolFilter.allow.includes('bash'), false)
  assert.equal(h.starts[0].request.toolFilter.allow.includes('read'), false)
  assert.deepEqual(h.binds[0].input, {
    data_root: path.join(root, 'pangea-data'),
    run_id: 'run-01',
    action_id: current.action_id,
    task_id: 'child-1',
  })
  assert.equal(h.followups.length, 1)
  assert.equal(h.followups[0].childId, 'child-1')
  assert.match(h.followups[0].content[0].text, /task_id="child-1"/)
  assert.match(h.followups[0].content[0].text, new RegExp(current.task_path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  await h.post(dispatch, value)
  assert.equal(dispatch.concluded, true)
})

test('settle merges the returned continuation and reuses the original task', async () => {
  const root = await fixture()
  const owner = agent(root, 'root-agent')
  const current = action(root, 'review')
  await prepareAction(root, current)
  const h = harness()
  await h.post(execFor(owner, 'pangea_run_create', {}), {
    workflow_version: 'source-first-v1', run_id: 'run-01',
    data_root: path.join(root, 'pangea-data'), actions: [current],
  })
  const dispatch = execFor(owner, 'pangea_action_dispatch', { action_id: current.action_id })
  const first = await h.tools.get('pangea_action_dispatch').execute(dispatch.arguments, dispatch)
  await h.post(dispatch, first)
  await h.settle(owner, 'child-1')
  const continuation = action(root, 'comparison', 'continue_agent', 'child-1')
  continuation.stage = 'comparison_review'
  await prepareAction(root, continuation)
  const settle = execFor(owner, 'pangea_action_settle', {
    data_root: path.join(root, 'pangea-data'), run_id: 'run-01', action_id: current.action_id,
  })
  await h.post(settle, {
    workflow_version: 'source-first-v1', run_id: 'run-01',
    data_root: path.join(root, 'pangea-data'), actions: [continuation],
  })
  const resume = execFor(owner, 'pangea_action_dispatch', { action_id: continuation.action_id })
  const resumed = await h.tools.get('pangea_action_dispatch').execute(resume.arguments, resume)
  assert.equal(resumed.subagent_id, 'child-1')
  assert.equal(h.starts.length, 1)
  assert.equal(h.followups.length, 2)
  assert.equal(h.followups[1].childId, 'child-1')
  assert.match(h.followups[1].content[0].text, /pangea_task_open/)
  assert.match(h.followups[1].content[0].text, /本轮阶段要求/)
  assert.match(h.followups[1].content[0].text, new RegExp(continuation.task_path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.equal(h.binds.at(-1).input.task_id, 'child-1')
  await h.post(resume, resumed)
})

test('child can use only its bound result/source scope and cannot advance lifecycle', async () => {
  const root = await fixture()
  const owner = agent(root, 'root-agent')
  const current = action(root, 'analysis-u1')
  await prepareAction(root, current)
  const h = harness()
  await h.post(execFor(owner, 'pangea_run_create', {}), {
    workflow_version: 'source-first-v1', run_id: 'run-01',
    data_root: path.join(root, 'pangea-data'), actions: [current],
  })
  const dispatch = execFor(owner, 'pangea_action_dispatch', { action_id: current.action_id })
  const value = await h.tools.get('pangea_action_dispatch').execute(dispatch.arguments, dispatch)
  await h.post(dispatch, value)
  const child = agent(root, 'child-1')
  const boundArgs = {
    data_root: path.join(root, 'pangea-data'),
    run_id: 'run-01',
    action_id: current.action_id,
    task_id: 'child-1',
  }
  assert.equal(h.guard(execFor(child, 'pangea_result_read', boundArgs)), undefined)
  assert.match(h.guard(execFor(child, 'pangea_result_read', { ...boundArgs, run_id: 'run-02' })), /只能使用当前 task/)
  assert.match(h.guard(execFor(child, 'pangea_action_settle', boundArgs)), /只能由根 Agent/)
  assert.match(h.guard(execFor(child, 'write', { file_path: path.join(root, 'pangea-data', 'runs', 'run-01', 'other.json') })), /只能写当前 task/)
  assert.match(h.guard(execFor(child, 'write', { file_path: current.resultPath })), /必须通过已绑定的 result\/plan\/review 工具/)
})

test('internal closure timeout pauses and interrupts the exact original worker', async () => {
  const root = await fixture()
  const owner = agent(root, 'budget-root')
  const current = { ...action(root, 'closure', 'continue_agent', 'original-worker'), stage: 'targeted_closure' }
  await prepareAction(root, current)
  await writeFile(current.task_path, JSON.stringify({ workflow_version: 'source-first-v1', action_id: current.action_id, run_id: 'run-01', result_path: current.resultPath, execution_budget_ms: 20 }))
  const events = []
  const h = harness(async (_cwd, binding, event) => { events.push({ binding, event }) })
  await h.post(execFor(owner, 'pangea_run_create', {}), { workflow_version: 'source-first-v1', run_id: 'run-01', data_root: path.join(root, 'pangea-data'), actions: [current] })
  const dispatch = execFor(owner, 'pangea_action_dispatch', { action_id: current.action_id })
  const result = await h.tools.get('pangea_action_dispatch').execute(dispatch.arguments, dispatch)
  await h.post(dispatch, result)
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.deepEqual(h.interrupts, ['original-worker'])
  assert.deepEqual(events.map(item => item.event), ['started', 'paused'])
  assert.equal(events[1].binding.childId, 'original-worker')
  assert.match(h.guard(execFor(agent(root, 'original-worker'), 'pangea_result_write', {})), /暂停/)
})

test('internal dispatch limits running unit workers to three', async () => {
  const root = await fixture()
  const owner = agent(root, 'cap-root')
  const actions = Array.from({ length: 4 }, (_, i) => action(root, `analysis-${i}`))
  for (const current of actions) await prepareAction(root, current)
  const h = harness()
  await h.post(execFor(owner, 'pangea_run_create', {}), { workflow_version: 'source-first-v1', run_id: 'run-01', data_root: path.join(root, 'pangea-data'), actions })
  for (const current of actions.slice(0, 3)) {
    const dispatch = execFor(owner, 'pangea_action_dispatch', { action_id: current.action_id })
    await h.post(dispatch, await h.tools.get('pangea_action_dispatch').execute(dispatch.arguments, dispatch))
  }
  const dispatch = execFor(owner, 'pangea_action_dispatch', { action_id: actions[3].action_id })
  await assert.rejects(h.tools.get('pangea_action_dispatch').execute(dispatch.arguments, dispatch), /三个单元/)
  assert.equal(h.starts.length, 3)
})

test('replaying dispatch after a lost tool result does not bind, start, or follow up twice', async () => {
  const root = await fixture(), owner = agent(root, 'idempotent-root')
  const current = action(root, 'analysis-replay')
  await prepareAction(root, current)
  const events = [], h = harness(async (_cwd, binding, event) => events.push({ binding, event }))
  const selected = { dataRoot: path.join(root, 'pangea-data'), runId: 'run-01' }
  await h.post(execFor(owner, 'pangea_run_create', {}), { workflow_version: 'source-first-v1', run_id: selected.runId, data_root: selected.dataRoot, actions: [current] })
  const dispatch = execFor(owner, 'pangea_action_dispatch', { action_id: current.action_id })
  const first = await h.tools.get(dispatch.name).execute(dispatch.arguments, dispatch)
  const repeated = await h.tools.get(dispatch.name).execute(dispatch.arguments, dispatch)
  assert.deepEqual(repeated, first)
  assert.equal(h.starts.length, 1)
  assert.equal(h.binds.length, 1)
  assert.equal(h.followups.length, 1)
  assert.equal(events.length, 1)
  assert.match(events[0].binding.executionId, /^[0-9a-f-]{36}$/)
  await interruptSourceFirstChildren(selected)
})

test('retries a followup rejected before admission using the same execution identity', async () => {
  const root = await fixture(), owner = agent(root, 'retry-root')
  const current = { ...action(root, 'analysis-retry'), stage: 'targeted_closure', pending_repair: { error: 'repair' } }
  await prepareAction(root, current)
  const events = [], h = harness(async (_cwd, binding, event, _reason, _budget, automatic) => events.push({ binding, event, automatic }))
  const selected = { dataRoot: path.join(root, 'pangea-data'), runId: 'run-01' }
  await h.post(execFor(owner, 'pangea_run_create', {}), { workflow_version: 'source-first-v1', run_id: selected.runId, data_root: selected.dataRoot, actions: [current] })
  const dispatch = execFor(owner, 'pangea_action_dispatch', { action_id: current.action_id })
  const followup = h.ctx.subagents.followup
  h.ctx.subagents.followup = async () => { throw new Error('inbox admission rejected') }
  await assert.rejects(h.tools.get(dispatch.name).execute(dispatch.arguments, dispatch), /admission rejected/)
  h.ctx.subagents.followup = followup
  await h.tools.get(dispatch.name).execute(dispatch.arguments, dispatch)
  assert.equal(h.starts.length, 1)
  assert.equal(h.followups.length, 1)
  assert.equal(events[0].binding.executionId, events[1].binding.executionId)
  assert.equal(events[0].automatic, events[1].automatic)
  await interruptSourceFirstChildren(selected)
})

test('native cancellation is confirmed only after exact tracked children finish draining', async () => {
  const root = await fixture(), owner = agent(root, 'drain-root')
  const current = action(root, 'analysis-drain')
  await prepareAction(root, current)
  const h = harness(), selected = { dataRoot: path.join(root, 'pangea-data'), runId: 'run-01' }
  assert.deepEqual(inspectSourceFirstChildren(selected), { known: false, quiescent: false, blocked_reason: '缺少原宿主的子任务释放证据，不能推定旧执行已经停止' })
  await h.post(execFor(owner, 'pangea_run_create', {}), { workflow_version: 'source-first-v1', run_id: selected.runId, data_root: selected.dataRoot, actions: [current] })
  const dispatch = execFor(owner, 'pangea_action_dispatch', { action_id: current.action_id })
  await h.tools.get(dispatch.name).execute(dispatch.arguments, dispatch)
  let release
  h.ctx.subagents.drainContinuableChildren = async (parent, ids) => {
    assert.equal(parent, owner); assert.deepEqual(ids, ['child-1'])
    await new Promise(resolve => { release = resolve })
  }
  const stopping = interruptSourceFirstChildren(selected)
  assert.equal(inspectSourceFirstChildren(selected).quiescent, false)
  assert.deepEqual(h.interrupts, ['child-1'])
  release()
  assert.equal(await stopping, true)
  assert.deepEqual(inspectSourceFirstChildren(selected), { known: true, quiescent: true, blocked_reason: null })
})

test('a runtime without a drain API cannot turn an interrupt request into stop confirmation', async () => {
  const root = await fixture(), owner = agent(root, 'missing-drain-root')
  const current = action(root, 'analysis-no-drain')
  await prepareAction(root, current)
  const h = harness(), selected = { dataRoot: path.join(root, 'pangea-data'), runId: 'run-01' }
  await h.post(execFor(owner, 'pangea_run_create', {}), { workflow_version: 'source-first-v1', run_id: selected.runId, data_root: selected.dataRoot, actions: [current] })
  const dispatch = execFor(owner, 'pangea_action_dispatch', { action_id: current.action_id })
  await h.tools.get(dispatch.name).execute(dispatch.arguments, dispatch)
  const drain = h.ctx.subagents.drainContinuableChildren
  delete h.ctx.subagents.drainContinuableChildren
  await assert.rejects(interruptSourceFirstChildren(selected), /停止尚未确认/)
  assert.equal(inspectSourceFirstChildren(selected).quiescent, false)
  h.ctx.subagents.drainContinuableChildren = drain
  await interruptSourceFirstChildren(selected)
})

test('ignored core execution events do not advance native child state or interrupt a live turn', async () => {
  const root = await fixture(), owner = agent(root, 'ignored-root')
  const current = { ...action(root, 'closure-ignored', 'continue_agent', 'ignored-worker'), stage: 'targeted_closure' }
  await prepareAction(root, current)
  await writeFile(current.task_path, JSON.stringify({ action_id: current.action_id, run_id: 'run-01', result_path: current.resultPath, execution_budget_ms: 10 }))
  let sawPause
  const paused = new Promise(resolve => { sawPause = resolve })
  const h = harness(async (_cwd, _binding, event) => {
    if (event === 'paused') sawPause()
    return event === 'started' ? {} : { event_ignored: true }
  })
  const selected = { dataRoot: path.join(root, 'pangea-data'), runId: 'run-01' }
  await h.post(execFor(owner, 'pangea_run_create', {}), { workflow_version: 'source-first-v1', run_id: selected.runId, data_root: selected.dataRoot, actions: [current] })
  await h.emit('subagent/start', { id: 'ignored-worker', runId: 'ignored-epoch' })
  const dispatch = execFor(owner, 'pangea_action_dispatch', { action_id: current.action_id })
  await h.post(dispatch, await h.tools.get(dispatch.name).execute(dispatch.arguments, dispatch))
  const hold = setTimeout(() => {}, 1000)
  await paused
  clearTimeout(hold)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(h.interrupts, [])
  await h.settle(owner, 'ignored-worker')
  await h.emit('subagent/end', { id: 'ignored-worker', runId: 'ignored-epoch', stopReason: 'completed' })
  assert.equal(inspectSourceFirstChildren(selected).quiescent, false)
  assert.match(h.guard(execFor(owner, 'pangea_action_next', { data_root: selected.dataRoot, run_id: selected.runId })), /仍在运行/)
  await interruptSourceFirstChildren(selected)
})

test('a rejected start for another execution identity never sends a worker followup', async () => {
  const root = await fixture(), owner = agent(root, 'rejected-start-root')
  const current = action(root, 'analysis-rejected-start')
  await prepareAction(root, current)
  const h = harness(async () => ({ event_ignored: true, reason: 'duplicate_execution', execution_id: 'another-execution', status: 'dispatched' }))
  const selected = { dataRoot: path.join(root, 'pangea-data'), runId: 'run-01' }
  await h.post(execFor(owner, 'pangea_run_create', {}), { workflow_version: 'source-first-v1', run_id: selected.runId, data_root: selected.dataRoot, actions: [current] })
  const dispatch = execFor(owner, 'pangea_action_dispatch', { action_id: current.action_id })
  await assert.rejects(h.tools.get(dispatch.name).execute(dispatch.arguments, dispatch), /未获 Graph 接受/)
  assert.deepEqual(h.followups, [])
  await interruptSourceFirstChildren(selected)
})

test('a late pause from a prior execution cannot interrupt the resumed worker', async () => {
  const root = await fixture(), owner = agent(root, 'late-pause-root')
  const current = { ...action(root, 'closure-race', 'continue_agent', 'original-race-worker'), stage: 'targeted_closure' }
  await prepareAction(root, current)
  const task = { action_id: current.action_id, run_id: 'run-01', result_path: current.resultPath, execution_budget_ms: 10 }
  await writeFile(current.task_path, JSON.stringify(task))
  let pauseStarted, releasePause
  const waiting = new Promise(resolve => { pauseStarted = resolve })
  const events = [], h = harness(async (_cwd, binding, event) => {
    events.push({ binding, event })
    if (event === 'paused') { pauseStarted(); await new Promise(resolve => { releasePause = resolve }) }
  })
  const selected = { dataRoot: path.join(root, 'pangea-data'), runId: 'run-01' }
  const response = { workflow_version: 'source-first-v1', run_id: selected.runId, data_root: selected.dataRoot, actions: [current] }
  await h.post(execFor(owner, 'pangea_run_create', {}), response)
  const dispatch = execFor(owner, 'pangea_action_dispatch', { action_id: current.action_id })
  await h.post(dispatch, await h.tools.get(dispatch.name).execute(dispatch.arguments, dispatch))
  // Keep the test event loop alive while the production budget timer is unref'd.
  const hold = setTimeout(() => {}, 1000)
  await waiting
  clearTimeout(hold)
  await writeFile(current.task_path, JSON.stringify({ ...task, execution_budget_ms: 10000 }))
  await h.post(execFor(owner, 'pangea_run_resume', {}), response)
  await h.post(dispatch, await h.tools.get(dispatch.name).execute(dispatch.arguments, dispatch))
  releasePause()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(h.interrupts, [])
  const starts = events.filter(event => event.event === 'started')
  assert.notEqual(starts[0].binding.executionId, starts[1].binding.executionId)
  assert.equal(events.find(event => event.event === 'paused').binding.executionId, starts[0].binding.executionId)
  assert.equal(h.guard(execFor(agent(root, 'original-race-worker'), 'pangea_result_read', {
    data_root: selected.dataRoot, run_id: selected.runId, action_id: current.action_id, task_id: 'original-race-worker',
  })), undefined)
  await interruptSourceFirstChildren(selected)
})

for (const ordering of ['end-first', 'notice-first']) test(`native lifecycle confirmation ignores old activation and duplicate notices (${ordering})`, async () => {
  const root = await fixture(), owner = agent(root, 'epoch-root')
  const current = action(root, 'analysis-epoch'), next = action(root, 'analysis-next', 'continue_agent', 'child-1')
  await prepareAction(root, current); await prepareAction(root, next)
  const events = [], h = harness(async (_cwd, binding, event) => events.push({ binding, event }))
  const selected = { dataRoot: path.join(root, 'pangea-data'), runId: 'run-01' }
  const response = actions => ({ workflow_version: 'source-first-v1', run_id: selected.runId, data_root: selected.dataRoot, actions })
  await h.post(execFor(owner, 'pangea_run_create', {}), response([current]))
  await h.emit('subagent/start', { id: 'child-1', runId: 'epoch-one' })
  const dispatch = execFor(owner, 'pangea_action_dispatch', { action_id: current.action_id })
  await h.post(dispatch, await h.tools.get(dispatch.name).execute(dispatch.arguments, dispatch))
  if (ordering === 'notice-first') await h.settle(owner, 'child-1', 'notice-one')
  await h.emit('subagent/end', { id: 'child-1', runId: 'epoch-one', stopReason: 'completed' })
  if (ordering === 'end-first') await h.settle(owner, 'child-1', 'notice-one')
  assert.equal(events.filter(event => event.event === 'finished').length, 1)
  assert.equal(inspectSourceFirstChildren(selected).quiescent, true)
  await h.post(execFor(owner, 'pangea_action_settle', { data_root: selected.dataRoot, run_id: selected.runId, action_id: current.action_id }), response([next]))
  await h.emit('subagent/start', { id: 'child-1', runId: 'epoch-two' })
  const resumed = execFor(owner, 'pangea_action_dispatch', { action_id: next.action_id })
  await h.post(resumed, await h.tools.get(resumed.name).execute(resumed.arguments, resumed))
  await h.emit('subagent/end', { id: 'child-1', runId: 'epoch-one', stopReason: 'completed' })
  await h.emit('agent/inbox/claimed', { agent: owner, message: { id: 'notice-one', source: { kind: 'subagent-settled', senderSessionId: 'child-1' } } })
  assert.equal(inspectSourceFirstChildren(selected).quiescent, false)
  assert.equal(events.filter(event => event.event === 'finished').length, 1)
  await interruptSourceFirstChildren(selected)
})
