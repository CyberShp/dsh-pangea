import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import { apply, isPangeaWorkspace } from '../src/report-policy.js'

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

function harness() {
  const listeners = new Map()
  const tools = new Map()
  const starts = []
  const followups = []
  const binds = []
  const continuableSetups = []
  let guard
  const ctx = {
    subagents: {
      async startContinuable(spec) {
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
  apply(ctx, adapter)
  return {
    tools,
    starts,
    followups,
    binds,
    continuableSetups,
    guard(value) { return guard(value) },
    async post(exec, value) {
      return listeners.get('tools/post-execute')(
        exec,
        { isError: false, value },
        async () => ({ kind: 'accept', value }),
      )
    },
    settle(owner, childId) {
      const listener = listeners.get('agent/inbox/inserted')
      listener({ agent: owner, message: { source: { kind: 'subagent-settled', senderSessionId: childId } } })
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
  h.settle(owner, 'child-1')
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
