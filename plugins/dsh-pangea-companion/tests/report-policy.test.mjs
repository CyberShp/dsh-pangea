import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import {
  apply,
  isPangeaWorkspace,
  reportDeliveryForWorkspace,
} from '../src/report-policy.js'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pangea-companion-policy-'))
  const markerDir = join(root, '.agents', 'pangea')
  const nested = join(root, 'pangea-data', 'repositories', 'demo')
  mkdirSync(markerDir, { recursive: true })
  mkdirSync(nested, { recursive: true })
  writeFileSync(join(markerDir, 'dsh.md'), 'PANGEA DSH adapter\n')
  return { root, nested }
}

function policyHarness() {
  const listeners = new Map()
  let guard
  let setup
  const ctx = {
    subagents: {
      registerContinuableSetup(value) { setup = value },
    },
    tools: {
      guard(value) {
        guard = value
        return () => {}
      },
    },
    on(name, value) {
      listeners.set(name, value)
      return () => {}
    },
  }
  apply(ctx)
  return {
    guard(exec) { return guard(exec) },
    inserted(payload) { listeners.get('agent/inbox/inserted')(payload) },
    claimed(payload) { listeners.get('agent/inbox/claimed')(payload) },
    async post(exec, value, { isError = false } = {}) {
      return listeners.get('tools/post-execute')(
        exec,
        { isError, value },
        async () => ({ kind: 'accept' }),
      )
    },
    setup() { return setup },
  }
}

function fakeAgent(cwd) {
  return { id: `agent-${cwd}`, session: { header: { cwd } } }
}

function fakeExec(agent, name, args) {
  let concluded = false
  return {
    agent,
    name,
    arguments: args,
    concludeTurn() { concluded = true },
    get concluded() { return concluded },
  }
}

function graphOutput({ runId = 'lua-run-01', dataRoot = 'pangea-data/acceptance', phase = 'WAITING_SOURCE_CHECKPOINT', actions = [] } = {}) {
  return [
    `run_id=${runId}`,
    `data_root=${dataRoot}`,
    `phase=${phase}`,
    ...actions.map(action => `action=${JSON.stringify(action)}`),
  ].join('\n')
}

function dispatchAction(taskPath, overrides = {}) {
  return {
    action: 'dispatch_agent',
    role: 'analysis',
    stage: 'source_checkpoint',
    session_key: 'analysis:U00',
    unit_id: 'U00',
    task_path: taskPath,
    task_id: null,
    replacement_allowed: false,
    after_completion: 'resume_run',
    ...overrides,
  }
}

test('uses quiet delivery only inside a PANGEA workspace', () => {
  const { root, nested } = fixture()
  const unrelated = mkdtempSync(join(tmpdir(), 'dsh-unrelated-'))
  try {
    assert.equal(isPangeaWorkspace(root), true)
    assert.equal(isPangeaWorkspace(nested), true)
    assert.equal(reportDeliveryForWorkspace(nested), 'quiet')
    assert.equal(reportDeliveryForWorkspace(unrelated), 'next-step')
    assert.equal(reportDeliveryForWorkspace(undefined), 'next-step')
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(unrelated, { recursive: true, force: true })
  }
})

test('report tool resolves delivery from the reporting agent workspace', async () => {
  const { root } = fixture()
  const unrelated = mkdtempSync(join(tmpdir(), 'dsh-unrelated-'))
  const deliveries = []
  let setup
  let reportTool
  const ctx = {
    subagents: {
      registerContinuableSetup(value) { setup = value },
      async reportFrom(_agent, _content, options) {
        deliveries.push(options.delivery)
        return `message-${deliveries.length}`
      },
    },
    tools: { guard() { return () => {} } },
    on() { return () => {} },
  }
  const childCtx = {
    systemPrompt: { section() { return () => {} } },
    tools: {
      register(value) {
        reportTool = value
        return () => {}
      },
    },
  }
  try {
    apply(ctx)
    setup(childCtx)
    const signal = new AbortController().signal
    await reportTool.execute({ output: 'pangea result' }, {
      agent: { session: { header: { cwd: root } } },
      signal,
    })
    await reportTool.execute({ output: 'ordinary result' }, {
      agent: { session: { header: { cwd: unrelated } } },
      signal,
    })
    assert.deepEqual(deliveries, ['quiet', 'next-step'])
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(unrelated, { recursive: true, force: true })
  }
})

test('PANGEA lifecycle permits only Graph action, binding, settlement, and resume', async () => {
  const { root } = fixture()
  try {
    const harness = policyHarness()
    const agent = fakeAgent(root)
    const taskPath = 'pangea-data/acceptance/runs/lua-run-01/agent-tasks/analysis/U00-source_checkpoint.json'
    const action = dispatchAction(taskPath)
    const moduleExec = fakeExec(agent, 'bash', {
      command: 'python -m pangea_agent.cli.main module-analysis --contract pending.json',
    })
    await harness.post(moduleExec, graphOutput({ actions: [action] }))

    const listExec = fakeExec(agent, 'list_agents', {})
    assert.match(harness.guard(listExec), /Graph 已返回待执行 action/)
    const cleanupExec = fakeExec(agent, 'bash', {
      command: `rm -f ${root}/pangea-data/.pangea/pending-task-contract.json`,
    })
    assert.equal(harness.guard(cleanupExec), undefined)
    const powershellCleanup = fakeExec(agent, 'bash', {
      command: `Remove-Item -LiteralPath '${root}\\pangea-data\\.pangea\\pending-task-contract.json' -Force`,
    })
    assert.equal(harness.guard(powershellCleanup), undefined)
    const unrelatedDelete = fakeExec(agent, 'bash', { command: `rm -f ${root}/other.json` })
    assert.match(harness.guard(unrelatedDelete), /Graph 已返回待执行 action/)
    const dispatchExec = fakeExec(agent, 'subagent', {
      prompt: taskPath,
      description: '分析 Lua 模块',
      run_in_background: true,
    })
    assert.equal(harness.guard(dispatchExec), undefined)
    await harness.post(dispatchExec, { kind: 'continuable', subagentId: 'child-01' })

    const earlyResume = fakeExec(agent, 'bash', {
      command: 'python -m pangea_agent.cli.main resume-run --run-id lua-run-01 --data-root pangea-data/acceptance',
    })
    assert.match(harness.guard(earlyResume), /record-agent-session/)
    const recordExec = fakeExec(agent, 'bash', {
      command: `python -m pangea_agent.cli.main record-agent-session --task '${taskPath}' --role analysis --unit-id U00 --task-id child-01`,
    })
    assert.equal(harness.guard(recordExec), undefined)
    const recordDecision = await harness.post(recordExec, 'session recorded')
    assert.equal(recordExec.concluded, true)
    assert.equal(recordDecision.kind, 'accept')
    assert.match(harness.guard(listExec), /仍在运行/)
    assert.match(harness.guard(earlyResume), /仍在运行/)

    harness.claimed({
      agent,
      message: { source: { kind: 'subagent-settled', senderSessionId: 'other-child' } },
    })
    assert.match(harness.guard(earlyResume), /仍在运行/)
    harness.inserted({
      agent: { ...agent },
      message: { source: { kind: 'subagent-settled', senderSessionId: 'child-01' } },
    })
    assert.equal(harness.guard(earlyResume), undefined)
    assert.match(harness.guard(listExec), /下一步只能执行当前 Run/)
    assert.match(harness.guard(listExec), /--run-id lua-run-01 --data-root pangea-data\/acceptance/)

    const nextTask = 'pangea-data/acceptance/runs/lua-run-01/agent-tasks/analysis/U00-risk_analysis.json'
    const continueAction = dispatchAction(nextTask, {
      action: 'continue_agent',
      stage: 'risk_analysis',
      task_id: 'child-01',
    })
    await harness.post(earlyResume, graphOutput({ actions: [continueAction] }))
    const wrongMessage = fakeExec(agent, 'send_message', {
      subagent_id: 'child-01',
      message: 'check status',
    })
    assert.match(harness.guard(wrongMessage), /Graph 已返回待执行 action/)
    const continueExec = fakeExec(agent, 'send_message', {
      subagent_id: 'child-01',
      message: nextTask,
    })
    assert.equal(harness.guard(continueExec), undefined)
    await harness.post(continueExec, { messageId: 'message-01' })
    assert.equal(continueExec.concluded, true)
    assert.match(harness.guard(listExec), /仍在运行/)

    harness.claimed({
      agent,
      message: { source: { kind: 'subagent-settled', senderSessionId: 'child-01' } },
    })
    const finalResume = fakeExec(agent, 'bash', {
      command: 'python -m pangea_agent.cli.main resume-run --run-id lua-run-01 --data-root pangea-data/acceptance',
    })
    assert.equal(harness.guard(finalResume), undefined)
    await harness.post(finalResume, graphOutput({ phase: 'COMPLETE', actions: [] }))
    assert.equal(harness.guard(listExec), undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('PANGEA child can write only its current Graph result', async () => {
  const { root } = fixture()
  try {
    const harness = policyHarness()
    const rootAgent = fakeAgent(root)
    const run = join(root, 'pangea-data', 'acceptance', 'runs', 'lua-run-01')
    const taskPath = join(run, 'agent-tasks', 'rework', 'U00.json')
    const currentResult = join(run, 'agent-results', 'rework', 'U00.json')
    const priorResult = join(run, 'agent-results', 'analysis', 'U00.json')
    mkdirSync(dirname(taskPath), { recursive: true })
    mkdirSync(dirname(currentResult), { recursive: true })
    mkdirSync(dirname(priorResult), { recursive: true })
    writeFileSync(taskPath, JSON.stringify({
      result_path: currentResult,
      prior_result_path: priorResult,
    }))
    writeFileSync(currentResult, '{}\n')
    writeFileSync(priorResult, '{}\n')

    const action = dispatchAction(taskPath, { role: 'rework', stage: 'rework' })
    await harness.post(
      fakeExec(rootAgent, 'bash', {
        command: 'python -m pangea_agent.cli.main module-analysis --contract pending.json',
      }),
      graphOutput({ actions: [action] }),
    )
    const dispatchExec = fakeExec(rootAgent, 'subagent', {
      prompt: taskPath,
      description: '返工 Lua 单元',
      run_in_background: true,
    })
    await harness.post(dispatchExec, { kind: 'continuable', subagentId: 'child-01' })

    const child = { id: 'child-01', session: { header: { cwd: root } } }
    assert.equal(harness.guard(fakeExec(child, 'edit', { file_path: currentResult })), undefined)
    assert.match(
      harness.guard(fakeExec(child, 'write', { file_path: currentResult })),
      /禁止整文件 Write/,
    )
    assert.match(
      harness.guard(fakeExec(child, 'edit', { file_path: priorResult })),
      /只能编辑当前 Graph task 的 result_path/,
    )
    assert.match(
      harness.guard(fakeExec(child, 'write', { file_path: join(root, 'src', 'core.py') })),
      /禁止整文件 Write/,
    )
    assert.match(
      harness.guard(fakeExec(child, 'bash', {
        command: `python3 - <<'PY'\nrewrite('${currentResult}')\nPY`,
      })),
      /当前 result_path 只能用 Edit/,
    )
    assert.match(
      harness.guard(fakeExec(child, 'bash', {
        command: `python -c "rewrite('${priorResult}')"`,
      })),
      /不得通过 Bash 修改正式 JSON/,
    )
    assert.equal(
      harness.guard(fakeExec(child, 'bash', {
        command: `python -m pangea_agent.cli.main validate-worker-result --task '${taskPath}'`,
      })),
      undefined,
    )
    assert.equal(harness.guard(fakeExec(child, 'read', { file_path: priorResult })), undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('PANGEA lifecycle fails closed when a waiting phase has no parseable action', async () => {
  const { root } = fixture()
  try {
    const harness = policyHarness()
    const agent = fakeAgent(root)
    const resume = fakeExec(agent, 'bash', {
      command: 'python -m pangea_agent.cli.main resume-run --run-id lua-run-01 --data-root pangea-data/acceptance',
    })
    await harness.post(
      fakeExec(agent, 'bash', {
        command: 'python -m pangea_agent.cli.main module-analysis --contract pending.json',
      }),
      graphOutput({ actions: [] }),
    )
    assert.match(
      harness.guard(fakeExec(agent, 'read', { file_path: 'pangea-data/runs/anything.json' })),
      /没有解析到合法 action/,
    )
    assert.equal(harness.guard(resume), undefined)
    await harness.post(resume, graphOutput({ actions: [] }))
    assert.match(
      harness.guard(fakeExec(agent, 'subagent', { prompt: 'guessed-task', run_in_background: true })),
      /不得读取产物、猜阶段或自行派发/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('PANGEA lifecycle policy does not affect ordinary DSH workspaces', async () => {
  const unrelated = mkdtempSync(join(tmpdir(), 'dsh-unrelated-'))
  try {
    const harness = policyHarness()
    const agent = fakeAgent(unrelated)
    const taskPath = 'pangea-data/runs/demo/agent-tasks/analysis/U00-source_checkpoint.json'
    await harness.post(
      fakeExec(agent, 'bash', { command: 'python -m pangea_agent.cli.main module-analysis --contract pending.json' }),
      graphOutput({ actions: [dispatchAction(taskPath)] }),
    )
    assert.equal(harness.guard(fakeExec(agent, 'list_agents', {})), undefined)
    assert.equal(harness.guard(fakeExec(agent, 'send_message', { subagent_id: 'x', message: 'status' })), undefined)
  } finally {
    rmSync(unrelated, { recursive: true, force: true })
  }
})

test('PANGEA lifecycle binds every parallel Graph dispatch before waiting', async () => {
  const { root } = fixture()
  try {
    const harness = policyHarness()
    const agent = fakeAgent(root)
    const firstPath = 'pangea-data/runs/multi/agent-tasks/analysis/U00-source_checkpoint.json'
    const secondPath = 'pangea-data/runs/multi/agent-tasks/analysis/U01-source_checkpoint.json'
    await harness.post(
      fakeExec(agent, 'bash', { command: 'python -m pangea_agent.cli.main module-analysis --contract pending.json' }),
      graphOutput({
        runId: 'multi',
        dataRoot: 'pangea-data',
        actions: [
          dispatchAction(firstPath),
          dispatchAction(secondPath, { session_key: 'analysis:U01', unit_id: 'U01' }),
        ],
      }),
    )

    const firstDispatch = fakeExec(agent, 'subagent', {
      prompt: firstPath,
      description: '分析单元零',
      run_in_background: true,
    })
    await harness.post(firstDispatch, { kind: 'continuable', subagentId: 'child-00' })
    const secondDispatch = fakeExec(agent, 'subagent', {
      prompt: secondPath,
      description: '分析单元一',
      run_in_background: true,
    })
    assert.equal(harness.guard(secondDispatch), undefined)
    await harness.post(secondDispatch, { kind: 'continuable', subagentId: 'child-01' })

    const firstRecord = fakeExec(agent, 'bash', {
      command: `python -m pangea_agent.cli.main record-agent-session --task '${firstPath}' --role analysis --unit-id U00 --task-id child-00`,
    })
    await harness.post(firstRecord, 'recorded')
    assert.equal(firstRecord.concluded, false)
    const secondRecord = fakeExec(agent, 'bash', {
      command: `python -m pangea_agent.cli.main record-agent-session --task '${secondPath}' --role analysis --unit-id U01 --task-id child-01`,
    })
    await harness.post(secondRecord, 'recorded')
    assert.equal(secondRecord.concluded, true)
    assert.match(harness.guard(fakeExec(agent, 'list_agents', {})), /仍在运行/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
