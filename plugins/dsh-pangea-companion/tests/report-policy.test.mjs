import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import { apply, isPangeaWorkspace, reportDeliveryForWorkspace, workspaceInstructions } from '../src/report-policy.js'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pangea-companion-policy-'))
  const markerDir = join(root, '.agents', 'pangea')
  mkdirSync(markerDir, { recursive: true })
  writeFileSync(join(markerDir, 'dsh.md'), 'PANGEA DSH adapter\n')
  writeFileSync(join(markerDir, 'planning-worker.md'), '# Planning worker\n')
  writeFileSync(join(markerDir, 'analysis-worker.md'), '# Analysis worker\n')
  writeFileSync(join(markerDir, 'review-worker.md'), '# Review worker\n')
  writeFileSync(join(markerDir, 'closure-worker.md'), '# Closure worker\n')
  return root
}

function policyHarness({ failFirstBind = false } = {}) {
  const listeners = new Map()
  const registeredTools = new Map()
  const starts = []
  const adapterCalls = []
  const followups = []
  let bindFailuresRemaining = failFirstBind ? 1 : 0
  let guard
  const fakeAdapter = async (cwd, operation, input) => {
    adapterCalls.push({ cwd, operation, input })
    if (operation === 'bind' && bindFailuresRemaining > 0) {
      bindFailuresRemaining -= 1
      throw new Error('simulated bind failure')
    }
    return { action_id: input.action_id, status: 'dispatched' }
  }
  const ctx = {
    subagents: {
      registerContinuableSetup() {},
      async startContinuable(spec) {
        starts.push(spec)
        return { childId: `child-${starts.length}`, messageId: `message-${starts.length}` }
      },
      async followup(parent, childId, content, options) {
        followups.push({ parent, childId, content, options })
        return `repair-${followups.length}`
      },
    },
    tools: {
      guard(value) { guard = value; return () => {} },
      register(tool) { registeredTools.set(tool.name, tool); return () => registeredTools.delete(tool.name) },
    },
    on(name, value) { listeners.set(name, value); return () => {} },
  }
  apply(ctx, fakeAdapter)
  return {
    guard: exec => guard(exec),
    tool(name) { return registeredTools.get(name) },
    starts,
    adapterCalls,
    followups,
    settled(agent, childId) {
      listeners.get('agent/inbox/inserted')({
        agent,
        message: { source: { kind: 'subagent-settled', senderSessionId: childId } },
      })
    },
    post(exec, value, isError = false) {
      return listeners.get('tools/post-execute')(
        exec,
        { isError, value },
        async () => ({ kind: 'accept' }),
      )
    },
  }
}

function fakeAgent(cwd, id = `agent-${cwd}`) {
  return {
    id,
    options: { provider: 'test-provider', model: 'test-model', reasoningEffort: 'high' },
    session: { header: { cwd } },
  }
}

function fakeExec(agent, name, args) {
  let concluded = false
  return {
    agent, name, arguments: args,
    concludeTurn() { concluded = true },
    get concluded() { return concluded },
  }
}

function envelope(result) {
  return JSON.stringify({ api_version: '1.0', ok: true, result })
}

function action(taskPath, actionId = 'run-01:analysis:U00') {
  return {
    schema_version: '1.0', action_id: actionId, action: 'dispatch_agent',
    role: 'analysis', stage: 'unit_analysis', task_path: taskPath, task_id: null,
  }
}

test('uses quiet delivery only inside a PANGEA workspace', () => {
  const root = fixture()
  const unrelated = mkdtempSync(join(tmpdir(), 'dsh-unrelated-'))
  try {
    assert.equal(isPangeaWorkspace(root), true)
    assert.equal(reportDeliveryForWorkspace(root), 'quiet')
    assert.equal(reportDeliveryForWorkspace(unrelated), 'next-step')
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(unrelated, { recursive: true, force: true })
  }
})

test('injects DSH rules only for a PANGEA root agent', () => {
  const root = fixture()
  const unrelated = mkdtempSync(join(tmpdir(), 'dsh-unrelated-'))
  try {
    assert.match(workspaceInstructions({ agent: fakeAgent(root) }), /PANGEA DSH adapter/)
    assert.equal(workspaceInstructions({ agent: fakeAgent(unrelated) }), '')
    assert.equal(workspaceInstructions({
      agent: { session: { header: { cwd: root, origin: 'subagent' } } },
    }), '')
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(unrelated, { recursive: true, force: true })
  }
})

test('report tool resolves delivery from the reporting workspace', async () => {
  const root = fixture()
  const unrelated = mkdtempSync(join(tmpdir(), 'dsh-unrelated-'))
  const deliveries = []
  let setup
  let reportTool
  const ctx = {
    subagents: {
      registerContinuableSetup(value) { setup = value },
      async reportFrom(_agent, _content, options) { deliveries.push(options.delivery); return 'message' },
    },
    tools: { guard() { return () => {} }, register() { return () => {} } },
    on() { return () => {} },
  }
  const childCtx = {
    systemPrompt: { section() { return () => {} } },
    tools: { register(value) { reportTool = value; return () => {} } },
  }
  try {
    apply(ctx)
    setup(childCtx)
    await reportTool.execute({ output: 'result' }, { agent: fakeAgent(root), signal: undefined })
    await reportTool.execute({ output: 'result' }, { agent: fakeAgent(unrelated), signal: undefined })
    assert.deepEqual(deliveries, ['quiet', 'next-step'])
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(unrelated, { recursive: true, force: true })
  }
})

test('root lifecycle rejects pending-contract and legacy CLI mutations', async () => {
  const root = fixture()
  try {
    const harness = policyHarness()
    const parent = fakeAgent(root)
    assert.match(harness.guard(fakeExec(parent, 'read', {
      path: join(root, 'pangea-data', '.pangea', 'pending-task-contract.json'),
    })), /pangea_run_create/)
    assert.match(harness.guard(fakeExec(parent, 'write', {
      file_path: 'pangea-data/.pangea/pending-task-contract.json', content: '{}',
    })), /pangea_run_create/)
    assert.match(harness.guard(fakeExec(parent, 'bash', {
      command: 'python -m pangea_agent.cli.main module-analysis --contract pending.json',
    })), /pangea_run_create/)
    assert.match(harness.guard(fakeExec(parent, 'bash', {
      command: 'python -m pangea_agent.cli.main resume-run --data-root pangea-data --run-id run-01',
    })), /pangea_action_dispatch/)
    assert.match(harness.guard(fakeExec(parent, 'pangea_action_bind', {})), /自动绑定/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('lifecycle accepts direct PANGEA run and action tools', async () => {
  const root = fixture()
  try {
    const harness = policyHarness()
    const parent = fakeAgent(root)
    const dataRoot = join(root, 'pangea-data')
    const taskPath = join(dataRoot, 'runs', 'run-tools', 'agent-tasks', 'planning.json')
    const resultPath = join(dataRoot, 'runs', 'run-tools', 'agent-results', 'planning.json')
    mkdirSync(dirname(taskPath), { recursive: true })
    writeFileSync(taskPath, JSON.stringify({ result_path: resultPath }))
    const currentAction = { ...action(taskPath, 'run-tools:planning'), role: 'planning' }
    await harness.post(
      fakeExec(parent, 'pangea_run_create', { repository: 'repo', target: 'target', source_scope: ['src/a.c'] }),
      { run_id: 'run-tools', data_root: dataRoot, agent_actions: [currentAction] },
    )

    const dispatch = fakeExec(parent, 'pangea_action_dispatch', { action_id: currentAction.action_id })
    assert.equal(harness.guard(dispatch), undefined)
    assert.equal(harness.tool('pangea_action_dispatch').isConcurrencySafe(), false)
    const dispatched = await harness.tool('pangea_action_dispatch').execute(dispatch.arguments, dispatch)
    assert.equal(dispatched.subagent_id, 'child-1')
    assert.equal(dispatched.bound, true)
    assert.equal(harness.starts[0].request.prompt[0].text, taskPath)
    assert.match(harness.starts[0].request.persona, /Planning worker/)
    assert.deepEqual(harness.starts[0].request.agentOptions, parent.options)
    assert.notEqual(harness.starts[0].request.agentOptions, parent.options)
    assert.equal(harness.adapterCalls[0].operation, 'bind')
    assert.equal(harness.adapterCalls[0].input.task_id, 'child-1')
    await harness.post(dispatch, dispatched)
    assert.equal(dispatch.concluded, true)
    harness.settled(parent, 'child-1')

    const validate = fakeExec(parent, 'pangea_action_validate', {
      data_root: dataRoot, run_id: 'run-tools', action_id: currentAction.action_id,
    })
    assert.equal(harness.guard(validate), undefined)
    await harness.post(validate, {
      action_id: currentAction.action_id,
      status: 'invalid',
      result_path: resultPath,
      expected_contract: join(root, 'schemas', 'planning_result.schema.json'),
      errors: [{
        loc: ['input_decisions', 0, 'input_id'],
        type: 'missing',
        message: 'Field required',
      }],
    })
    assert.equal(validate.concluded, true)
    assert.equal(harness.followups.length, 1)
    assert.equal(harness.followups[0].childId, 'child-1')
    assert.match(harness.followups[0].content[0].text, /"result_path"/)
    assert.match(harness.followups[0].content[0].text, /planning_result\.schema\.json/)
    assert.match(harness.followups[0].content[0].text, /"input_decisions"/)
    assert.match(harness.followups[0].content[0].text, /Field required/)
    assert.match(harness.guard(fakeExec(parent, 'list_agents', {})), /仍在运行/)
    harness.settled(parent, 'child-1')
    const repairGuidance = harness.guard(fakeExec(parent, 'list_agents', {}))
    assert.match(repairGuidance, /上一次 invalid.*已过期/)
    assert.match(repairGuidance, /必须重新调用下面的 pangea_action_validate/)
    assert.match(repairGuidance, /不得调用 settle、resume-run、status、Bash/)
    assert.match(repairGuidance, /run-tools:planning/)
    const revalidate = fakeExec(parent, 'pangea_action_validate', {
      data_root: dataRoot, run_id: 'run-tools', action_id: currentAction.action_id,
    })
    assert.equal(harness.guard(revalidate), undefined)
    await harness.post(revalidate, { action_id: currentAction.action_id, status: 'valid' })
    const settle = fakeExec(parent, 'pangea_action_settle', {
      data_root: dataRoot, run_id: 'run-tools', action_id: currentAction.action_id,
    })
    assert.equal(harness.guard(settle), undefined)
    await harness.post(settle, { run_id: 'run-tools', data_root: dataRoot, lifecycle_status: 'complete', actions: [] })
    assert.equal(harness.guard(fakeExec(parent, 'list_agents', {})), undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('dispatches rework actions with analysis worker rules', async () => {
  const root = fixture()
  try {
    rmSync(join(root, '.agents', 'pangea', 'analysis-worker.md'))
    const openCodeAgents = join(root, '.opencode', 'agents')
    mkdirSync(openCodeAgents, { recursive: true })
    writeFileSync(join(openCodeAgents, 'analysis-worker.md'), '# OpenCode analysis worker\n')
    const harness = policyHarness()
    const parent = fakeAgent(root)
    const dataRoot = join(root, 'pangea-data')
    const taskPath = join(dataRoot, 'runs', 'run-rework', 'agent-tasks', 'rework-u1.json')
    const resultPath = join(dataRoot, 'runs', 'run-rework', 'agent-results', 'rework', 'u1.json')
    mkdirSync(dirname(taskPath), { recursive: true })
    writeFileSync(taskPath, JSON.stringify({ result_path: resultPath }))
    const currentAction = { ...action(taskPath, 'run-rework:rework:u1'), role: 'rework' }
    await harness.post(
      fakeExec(parent, 'pangea_run_create', { repository: 'repo', target: 'target', source_scope: ['src/a.c'] }),
      { run_id: 'run-rework', data_root: dataRoot, agent_actions: [currentAction] },
    )

    const dispatch = fakeExec(parent, 'pangea_action_dispatch', { action_id: currentAction.action_id })
    const dispatched = await harness.tool('pangea_action_dispatch').execute(dispatch.arguments, dispatch)

    assert.equal(dispatched.bound, true)
    assert.match(harness.starts[0].request.persona, /OpenCode analysis worker/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('completed actions can be validated and settled without cross-action blocking', async () => {
  const root = fixture()
  try {
    const harness = policyHarness()
    const parent = fakeAgent(root)
    const dataRoot = join(root, 'pangea-data')
    const firstTask = join(dataRoot, 'runs', 'run-parallel', 'agent-tasks', 'analysis', 'U00.json')
    const secondTask = join(dataRoot, 'runs', 'run-parallel', 'agent-tasks', 'analysis', 'U01.json')
    mkdirSync(dirname(firstTask), { recursive: true })
    writeFileSync(firstTask, JSON.stringify({ result_path: join(dataRoot, 'U00.json') }))
    writeFileSync(secondTask, JSON.stringify({ result_path: join(dataRoot, 'U01.json') }))
    const first = action(firstTask, 'run-parallel:analysis:U00')
    const second = action(secondTask, 'run-parallel:analysis:U01')
    await harness.post(
      fakeExec(parent, 'pangea_run_create', {}),
      { run_id: 'run-parallel', data_root: dataRoot, actions: [first, second] },
    )

    for (const current of [first, second]) {
      const dispatch = fakeExec(parent, 'pangea_action_dispatch', { action_id: current.action_id })
      const started = await harness.tool('pangea_action_dispatch').execute(dispatch.arguments, dispatch)
      await harness.post(dispatch, started)
    }
    harness.settled(parent, 'child-1')
    harness.settled(parent, 'child-2')

    const validateSecond = fakeExec(parent, 'pangea_action_validate', {
      data_root: dataRoot, run_id: 'run-parallel', action_id: second.action_id,
    })
    assert.equal(harness.guard(validateSecond), undefined)
    await harness.post(validateSecond, { action_id: second.action_id, status: 'valid' })

    const settleSecond = fakeExec(parent, 'pangea_action_settle', {
      data_root: dataRoot, run_id: 'run-parallel', action_id: second.action_id,
    })
    assert.equal(harness.guard(settleSecond), undefined)

    const guidance = harness.guard(fakeExec(parent, 'list_agents', {}))
    assert.match(guidance, /run-parallel:analysis:U00/)
    assert.match(guidance, /pangea_action_validate/)
    assert.match(guidance, /run-parallel:analysis:U01/)
    assert.match(guidance, /pangea_action_settle/)
    assert.match(guidance, /一次只处理一个 action/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('dispatch retries bind with the original child instead of spawning a duplicate', async () => {
  const root = fixture()
  try {
    const harness = policyHarness({ failFirstBind: true })
    const parent = fakeAgent(root)
    const dataRoot = join(root, 'pangea-data')
    const taskPath = join(dataRoot, 'runs', 'run-retry', 'agent-tasks', 'analysis', 'U00.json')
    mkdirSync(dirname(taskPath), { recursive: true })
    writeFileSync(taskPath, JSON.stringify({ result_path: join(dataRoot, 'result.json') }))
    const currentAction = action(taskPath, 'run-retry:analysis:U00')
    await harness.post(
      fakeExec(parent, 'pangea_run_create', {}),
      { run_id: 'run-retry', data_root: dataRoot, actions: [currentAction] },
    )

    const dispatch = fakeExec(parent, 'pangea_action_dispatch', { action_id: currentAction.action_id })
    await assert.rejects(
      harness.tool('pangea_action_dispatch').execute(dispatch.arguments, dispatch),
      /simulated bind failure/,
    )
    assert.equal(harness.starts.length, 1)

    const retried = await harness.tool('pangea_action_dispatch').execute(dispatch.arguments, dispatch)
    assert.equal(retried.subagent_id, 'child-1')
    assert.equal(harness.starts.length, 1)
    assert.equal(harness.adapterCalls.length, 2)
    assert.equal(harness.adapterCalls[1].input.task_id, 'child-1')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('validation failure can return to the same child and result writes stay scoped', async () => {
  const root = fixture()
  try {
    const harness = policyHarness()
    const parent = fakeAgent(root)
    const taskPath = join(root, 'pangea-data', 'runs', 'run-01', 'agent-tasks', 'closure', 'U00.json')
    const resultPath = join(root, 'pangea-data', 'runs', 'run-01', 'agent-results', 'closure', 'U00.json')
    const originalPath = join(root, 'pangea-data', 'runs', 'run-01', 'agent-results', 'analysis', 'U00.json')
    const priorPath = join(root, 'pangea-data', 'runs', 'run-01', 'agent-results', 'prior', 'U00.json')
    mkdirSync(dirname(taskPath), { recursive: true })
    writeFileSync(taskPath, JSON.stringify({
      result_path: resultPath, prior_result_path: priorPath, original_result_path: originalPath,
    }))
    const currentAction = action(taskPath, 'run-01:closure:U00')
    await harness.post(
      fakeExec(parent, 'pangea_run_create', {}),
      { run_id: 'run-01', data_root: 'pangea-data', agent_actions: [currentAction] },
    )
    const dispatch = fakeExec(parent, 'pangea_action_dispatch', { action_id: currentAction.action_id })
    const dispatched = await harness.tool('pangea_action_dispatch').execute(dispatch.arguments, dispatch)
    await harness.post(dispatch, dispatched)
    const child = fakeAgent(root, 'child-1')
    assert.equal(harness.guard(fakeExec(child, 'write', { file_path: resultPath })), undefined)
    assert.match(harness.guard(fakeExec(child, 'write', { file_path: originalPath })), /只能写当前 task/)
    assert.match(harness.guard(fakeExec(child, 'write', { file_path: priorPath })), /只能写当前 task/)
    assert.equal(harness.guard(fakeExec(child, 'bash', {
      command: `python3 -c "from pathlib import Path; Path('${resultPath}').write_text('{}')"`,
    })), undefined)
    assert.match(harness.guard(fakeExec(child, 'bash', {
      command: `python3 -c "from pathlib import Path; Path('${originalPath}').write_text('{}')"`,
    })), /只能修改当前 task/)
    assert.match(harness.guard(fakeExec(child, 'pangea_action_settle', {
      data_root: 'pangea-data', run_id: 'run-01', action_id: currentAction.action_id,
    })), /只能由根 Agent 推进/)
    assert.match(harness.guard(fakeExec(child, 'bash', {
      command: `python -m pangea_agent.cli.main adapter settle --data-root pangea-data --run-id run-01 --action-id ${currentAction.action_id}`,
    })), /只能由根 Agent 推进/)

    harness.settled(parent, 'child-1')
    const repair = fakeExec(parent, 'send_message', { subagent_id: 'child-1', message: '修正当前 result_path' })
    assert.equal(harness.guard(repair), undefined)
    await harness.post(repair, { messageId: 'message-01' })
    assert.equal(repair.concluded, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('continue action resumes the original reviewer instead of spawning another agent', async () => {
  const root = fixture()
  try {
    const harness = policyHarness()
    const parent = fakeAgent(root)
    const dataRoot = join(root, 'pangea-data')
    const firstTask = join(dataRoot, 'runs', 'run-review', 'agent-tasks', 'review.json')
    const secondTask = join(dataRoot, 'runs', 'run-review', 'agent-tasks', 'comparison-review.json')
    mkdirSync(dirname(firstTask), { recursive: true })
    writeFileSync(firstTask, JSON.stringify({ result_path: join(dataRoot, 'review.json') }))
    writeFileSync(secondTask, JSON.stringify({ result_path: join(dataRoot, 'comparison.json') }))
    const first = { ...action(firstTask, 'run-review:review'), role: 'review', stage: 'independent_review' }
    await harness.post(
      fakeExec(parent, 'pangea_run_create', {}),
      { run_id: 'run-review', data_root: dataRoot, actions: [first] },
    )
    const dispatch = fakeExec(parent, 'pangea_action_dispatch', { action_id: first.action_id })
    const started = await harness.tool('pangea_action_dispatch').execute(dispatch.arguments, dispatch)
    await harness.post(dispatch, started)
    harness.settled(parent, 'child-1')
    const validate = fakeExec(parent, 'pangea_action_validate', {
      data_root: dataRoot, run_id: 'run-review', action_id: first.action_id,
    })
    await harness.post(validate, { status: 'valid' })
    const continuation = {
      ...action(secondTask, 'run-review:comparison-review'),
      action: 'continue_agent', role: 'review', stage: 'comparison_review', task_id: 'child-1',
    }
    const settle = fakeExec(parent, 'pangea_action_settle', {
      data_root: dataRoot, run_id: 'run-review', action_id: first.action_id,
    })
    await harness.post(settle, {
      run_id: 'run-review', data_root: dataRoot, actions: [continuation],
    })
    const resume = fakeExec(parent, 'pangea_action_dispatch', { action_id: continuation.action_id })
    const resumed = await harness.tool('pangea_action_dispatch').execute(resume.arguments, resume)
    assert.equal(resumed.subagent_id, 'child-1')
    assert.equal(harness.starts.length, 1)
    assert.equal(harness.followups.at(-1).childId, 'child-1')
    assert.equal(harness.followups.at(-1).content[0].text, secondTask)
    await harness.post(resume, resumed)
    assert.equal(resume.concluded, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('policy does not affect ordinary workspaces', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-unrelated-'))
  try {
    const harness = policyHarness()
    const agent = fakeAgent(root)
    await harness.post(
      fakeExec(agent, 'bash', { command: 'python -m pangea_agent.cli.main runs create --contract pending.json' }),
      envelope({ run_id: 'run-01', agent_actions: [action('task.json')] }),
    )
    assert.equal(harness.guard(fakeExec(agent, 'list_agents', {})), undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
