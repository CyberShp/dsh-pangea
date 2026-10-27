import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createSourceFirstAcpRun, inspectSourceFirstAcpRecovery, stopSourceFirstAcpRun } from '../src/source-first-acp.js'
import { inspectAcpBindings } from '../src/acp-recovery.js'
const progressPolicy = { readyWarnMs: 5, readyIdleMs: 20, warnMs: 5, idleMs: 20, cancelMs: 10, pollMs: 2 }
// These scenarios test process-tree/result reconciliation, not idle deadlines.
// Their real log/binding I/O must not race a 20 ms liveness watchdog on Windows.
// Keep the short policy above for tests that deliberately exercise idle recovery.
const reconciliationPolicy = { readyWarnMs: 1000, readyIdleMs: 5000, warnMs: 1000, idleMs: 5000, cancelMs: 200, pollMs: 10 }
const completed = { stopReason: 'completed', protocolStopReason: 'end_turn' }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

for (const mode of ['saved', 'resume', 'stale-revision', 'second-pending', 'rejected-proof', 'cleanup-error', 'cleanup-timeout',
  'no-capability', 'result-read-error', 'cannot-load', 'wrong-session', 'aborted', 'restore-aborted', 'wrong-provider', 'cancelled-end']) {
  test(`CodeAgent ended turn requires owned process-tree proof before recovery (${mode})`, { timeout: 10000 }, async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'codeagent-tool-recovery-'))
    const controller = new AbortController(), events = [], prompts = [], starts = [], restoredDisposed = deferred()
    let activeToolCount = 0, taskId, settled = false, quiescences = 0, reads = 0, stopped = false
    const outcome = mode === 'cancelled-end' ? { stopReason: 'aborted', protocolStopReason: 'cancelled' } : completed
    const oldWorker = { id: 'worker', remoteSessionId: 'original-remote', result: Promise.resolve(completed),
      readDiagnostics: () => ({ activeToolCount, canLoadSession: mode !== 'cannot-load' }),
      dispose: async () => {},
      continuePrompt: async prompt => { prompts.push(prompt[0].text); activeToolCount = 4; return outcome },
      ...(mode === 'no-capability' ? {} : { quiesceForRecovery: async () => {
        quiescences++
        assert.equal(settled, false)
        if (mode === 'cleanup-error') throw new Error('owned process cleanup failed')
        if (mode === 'cleanup-timeout') return new Promise(() => {})
        if (mode === 'aborted') { controller.abort(new Error('fixture abort')); return new Promise(() => {}) }
        if (mode === 'rejected-proof') return { confirmed: true, processTreeStopped: false }
        stopped = true
        return { confirmed: true, processTreeStopped: true }
      } }),
    }
    let recoveredActive = 0
    const resumedWorker = { id: 'worker', remoteSessionId: mode === 'wrong-session' ? 'replacement-remote' : 'original-remote',
      result: Promise.resolve(completed), dispose: async () => { restoredDisposed.resolve() },
      readDiagnostics: () => ({ activeToolCount: recoveredActive, canLoadSession: true }),
      continuePrompt: async prompt => {
        assert.equal(stopped, true)
        assert.ok(reads > 0)
        prompts.push(prompt[0].text)
        recoveredActive = mode === 'second-pending' ? 4 : 0
        return completed
      },
      quiesceForRecovery: async () => { restoredDisposed.resolve(); return { confirmed: true, processTreeStopped: true } },
    }
    const options = { dataRoot, cwd: dataRoot, runId: 'run', providerId: mode === 'wrong-provider' ? 'pangea-nga' : 'pangea-codeagent',
      signal: controller.signal, progressPolicy: reconciliationPolicy, onEvent: async event => {
        events.push(event)
        // Model Windows/loaded-runner latency while the completed request log
        // is being persisted. This must not turn a result-read test into idle recovery.
        if (mode === 'result-read-error' && event.stage === 'source_first_acp_request' && event.finished_at_ms) {
          await new Promise(resolve => setTimeout(resolve, 80))
        }
      },
      subagents: { start: async (_, request) => {
        starts.push(request)
        if (starts.length === 1) return oldWorker
        assert.deepEqual(request.resume, { taskId: 'worker', remoteSessionId: 'original-remote' })
        assert.equal(request.scratchDirectory, starts[0].scratchDirectory)
        if (mode === 'restore-aborted') controller.abort(new Error('fixture restore abort'))
        return resumedWorker
      } },
      runner: async ({ args }) => {
        if (args[0] === 'task-open') return { task: {} }
        if (args[0] === 'result-read') {
          reads++
          if (mode === 'result-read-error') throw new Error('saved result unavailable')
          return { revision: 3, completion_complete: ['saved', 'stale-revision'].includes(mode), completion_declared_revision: mode === 'stale-revision' ? 2 : 3 }
        }
        if (args[1] === 'bind') taskId = args.at(-1)
        if (args[1] === 'settle') { assert.equal(stopped, true); settled = true; return {} }
        if (args[1] === 'next') return { run_id: 'run', lifecycle_status: settled ? 'complete' : 'running', actions: settled ? [] : [
          { action_id: 'run:planning', action: taskId ? 'continue_agent' : 'dispatch_agent', task_id: taskId, role: 'planning', stage: 'unit_planning' },
        ] }
        return {}
      },
    }
    const run = createSourceFirstAcpRun(options)
    try {
      if (['aborted', 'restore-aborted', 'wrong-session'].includes(mode)) {
        await assert.rejects(run.result, mode === 'wrong-session' ? /未恢复原会话/ : /fixture (restore )?abort/)
        if (mode === 'restore-aborted') await restoredDisposed.promise
        assert.equal(settled, false)
        assert.equal(prompts.length, 1)
      } else {
        const result = await run.result
        const successful = ['saved', 'resume', 'stale-revision'].includes(mode)
        assert.equal(Boolean(result.attentionRequired), !successful)
        assert.equal(settled, successful)
        assert.equal(quiescences, ['no-capability', 'wrong-provider', 'cancelled-end'].includes(mode) ? 0 : 1)
        assert.equal(prompts.length, ['resume', 'stale-revision', 'second-pending'].includes(mode) ? 2 : 1)
        assert.equal(activeToolCount, 4, 'quiescence never fabricates terminal tool events')
        const bindings = JSON.parse(await readFile(path.join(dataRoot, 'runs/run/acp-workers.json'), 'utf8'))
        if (!successful) assert.equal(bindings.workers.worker.blocked, !['result-read-error', 'cannot-load'].includes(mode))
        if (mode === 'result-read-error') assert.equal(reads, 1, 'a failed saved-result read does not dispatch or silently retry')
        if (prompts.length === 2) assert.match(prompts[1], /先 result-read.*核对已有临时文件/)
        if (stopped) assert.ok(events.some(event => event.stage === 'source_first_tool_recovery' && event.process_tree_stopped === true))
        if (mode === 'rejected-proof') {
          await assert.rejects(stopSourceFirstAcpRun(options), /无法确认旧执行进程树停止/)
          await assert.rejects(run.dispose(), /无法确认旧执行进程树停止/)
          const blocked = JSON.parse(await readFile(path.join(dataRoot, 'runs/run/acp-workers.json'), 'utf8'))
          assert.equal(blocked.workers.worker.requires_process_tree_confirmation, true)
          assert.equal(inspectAcpBindings(blocked, { presence: () => 'absent' }).can_resume, false)
          oldWorker.quiesceForRecovery = async () => ({ confirmed: true, processTreeStopped: true })
          assert.equal(await stopSourceFirstAcpRun(options), true, 'failed ordinary dispose must retain the owned handle for an explicit stop retry')
          const stoppedBinding = JSON.parse(await readFile(path.join(dataRoot, 'runs/run/acp-workers.json'), 'utf8'))
          assert.equal(stoppedBinding.workers.worker.requires_process_tree_confirmation, false)
        }
      }
    } finally {
      // Explicit test cleanup supplies a new positive tree proof. Failure cases
      // above must never be released by ordinary root-only dispose.
      oldWorker.quiesceForRecovery = async () => ({ confirmed: true, processTreeStopped: true })
      await stopSourceFirstAcpRun(options)
      await rm(dataRoot, { recursive: true, force: true })
    }
  })
}

test('a delayed tree proof unlocks explicit recovery without reusing the fenced handle or relying on root PID exit', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'codeagent-late-tree-proof-'))
  const quiescence = deferred(), unlocked = deferred()
  let taskId, starts = 0, prompts = 0, settled = false, diagnostic, activeToolCount = 0
  const oldWorker = { id: 'worker', remoteSessionId: 'remote', result: Promise.resolve(completed),
    readDiagnostics: () => ({ activeToolCount, canLoadSession: true }), dispose: async () => {},
    quiesceForRecovery: () => quiescence.promise,
    continuePrompt: async () => { assert.equal(prompts++, 0, 'a fenced handle cannot accept another prompt'); activeToolCount = 4; return completed },
  }
  const restored = { id: 'worker', remoteSessionId: 'remote', result: Promise.resolve(completed),
    readDiagnostics: () => ({ activeToolCount: 0, canLoadSession: true }), dispose: async () => {},
    continuePrompt: async () => { assert.fail('the completed saved revision needs no new model turn') },
  }
  const options = { dataRoot, cwd: dataRoot, runId: 'run', providerId: 'pangea-codeagent', progressPolicy,
    signal: new AbortController().signal,
    onEvent: event => { if (event.stage === 'source_first_late_response' && event.process_tree_stopped) unlocked.resolve() },
    subagents: { start: async (_, request) => {
      starts++
      if (starts === 1) { diagnostic = request.onDiagnostic; return oldWorker }
      assert.deepEqual(request.resume, { taskId: 'worker', remoteSessionId: 'remote' })
      return restored
    } },
    runner: async ({ args }) => {
      if (args[0] === 'task-open') return { task: {} }
      if (args[0] === 'result-read') return { revision: 3, completion_complete: true, completion_declared_revision: 3 }
      if (args[1] === 'bind') taskId = args.at(-1)
      if (args[1] === 'settle') { settled = true; return {} }
      if (args[1] === 'next') return { run_id: 'run', lifecycle_status: settled ? 'complete' : 'running', actions: settled ? [] : [
        { action_id: 'run:planning', action: taskId ? 'continue_agent' : 'dispatch_agent', task_id: taskId, role: 'planning', stage: 'unit_planning' },
      ] }
      return {}
    },
  }
  const binding = async () => JSON.parse(await readFile(path.join(dataRoot, 'runs/run/acp-workers.json'), 'utf8'))
  try {
    const run = createSourceFirstAcpRun(options)
    assert.equal((await run.result).attentionRequired, true)
    const paused = await binding()
    assert.equal(paused.workers.worker.requires_process_tree_confirmation, true)
    assert.equal(inspectAcpBindings(paused, { presence: () => 'absent' }).can_resume, false)
    activeToolCount = 0
    diagnostic({ stage: 'tool_event', lastToolStatus: 'completed', activeToolCount: 0 })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal((await inspectSourceFirstAcpRecovery(options)).can_resume, false, 'tool updates cannot clear a process-tree fence')
    activeToolCount = 4
    quiescence.resolve({ confirmed: true, processTreeStopped: true })
    await unlocked.promise
    const confirmed = await binding()
    assert.equal(confirmed.workers.worker.requires_process_tree_confirmation, false)
    assert.equal((await inspectSourceFirstAcpRecovery(options)).can_resume, true)
    assert.equal(prompts, 1); assert.equal(starts, 1); assert.equal(settled, false)
    const continued = createSourceFirstAcpRun(options)
    assert.equal((await continued.result).attentionRequired, false)
    assert.equal(starts, 2); assert.equal(prompts, 1); assert.equal(settled, true)
    assert.equal(activeToolCount, 4, 'the old pending records are preserved')
  } finally {
    quiescence.resolve({ confirmed: true, processTreeStopped: true })
    await stopSourceFirstAcpRun(options)
    await rm(dataRoot, { recursive: true, force: true })
  }
})

test('an ended ready turn with unclosed tools pauses Graph without inventing a formal worker turn', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'acp-ready-pending-'))
  let taskId, prompts = 0, settled = false, graphPaused = false, formalTurns = 0
  const worker = { id: 'ready-worker', remoteSessionId: 'ready-remote', result: Promise.resolve(completed),
    readDiagnostics: () => ({ activeToolCount: 1 }), dispose: async () => {},
    continuePrompt: async () => { prompts++; return completed },
  }
  const options = { dataRoot, cwd: dataRoot, runId: 'run', providerId: 'pangea-codeagent', signal: new AbortController().signal,
    subagents: { start: async () => worker }, runner: async ({ args }) => {
      if (args[0] === 'task-open') return { task: {} }
      if (args[0] === 'result-read') return { revision: 1, completion_complete: false }
      if (args[0] === 'runs' && args[1] === 'execution') {
        const event = args[args.indexOf('--event') + 1]
        if (event === 'started') formalTurns++
        if (event === 'paused') {
          // Graph ignores a finish/pause for an execution ID never started.
          if (args.includes('--execution-id')) return { event_ignored: true, reason: 'stale_execution' }
          graphPaused = true
        }
      }
      if (args[1] === 'bind') taskId = args.at(-1)
      if (args[1] === 'settle') settled = true
      if (args[1] === 'next') return { run_id: 'run', actions: [
        { action_id: 'run:planning', action: taskId ? 'continue_agent' : 'dispatch_agent', task_id: taskId, role: 'planning', stage: 'unit_planning' },
      ] }
      return {}
    },
  }
  try {
    const run = createSourceFirstAcpRun(options)
    assert.equal((await run.result).attentionRequired, true)
    assert.equal(prompts, 0)
    assert.equal(formalTurns, 0)
    assert.equal(graphPaused, true)
    assert.equal(settled, false)
    assert.equal((await inspectSourceFirstAcpRecovery(options)).can_resume, false)
  } finally { await stopSourceFirstAcpRun(options); await rm(dataRoot, { recursive: true, force: true }) }
})

test('completed planning turn retains two unclosed pending tools with compact evidence even when a saved result exists', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'acp-pending-evidence-'))
  const events = [], toolIds = ['chatcmpl-tool-a873a78f7e539d5e', 'chatcmpl-tool-9e4b74cbae3ac799']
  const pendingTools = toolIds.map(tool_id => ({ tool_id, status: 'pending', kind: 'execute', request_id: 'driver-request', remote_session_id: 'remote',
    first_seen_at_ms: 1000, last_update_at_ms: 1000, seen_in_progress: false, input_observed: true, input_nonempty: false,
    output_observed: false, received_update_count: 1, accepted_update_count: 1, rawInput: { command: 'private command' } }))
  const toolLifecycle = { schema_version: 1, request_id: 'driver-request', remote_session_id: 'remote',
    unclosed_count: 0, pending_count: 0, in_progress_count: 0, unknown_count: 0,
    received_tool_events: 0, accepted_tool_events: 0, unaccepted_tool_events: 0, validation_error_count: 0, tools: [] }
  let activeToolCount = 0, prompts = 0, settled = false, taskId, disposed = false
  const worker = { id: 'worker', remoteSessionId: 'remote', result: Promise.resolve(completed),
    readDiagnostics: () => ({ activeToolCount, toolLifecycle }), dispose: async () => { disposed = true },
    continuePrompt: async () => {
      prompts++
      activeToolCount = 2
      Object.assign(toolLifecycle, {
        unclosed_count: 2, pending_count: 2, received_tool_events: 4, accepted_tool_events: 4, tools: pendingTools,
      })
      return completed
    },
  }
  const options = { dataRoot, cwd: dataRoot, runId: 'run', providerId: 'fixture', signal: new AbortController().signal,
    onEvent: event => events.push(event), subagents: { start: async () => worker },
    runner: async ({ args }) => {
      if (args[0] === 'task-open') return { task: {} }
      if (args[0] === 'result-read') return { revision: 3, completion_complete: true, completion_declared_revision: 3 }
      if (args[1] === 'bind') taskId = args.at(-1)
      if (args[1] === 'settle') { settled = true; return {} }
      if (args[1] === 'next') return { run_id: 'run', lifecycle_status: 'running', actions: [
        { action_id: 'run:planning', action: taskId ? 'continue_agent' : 'dispatch_agent', task_id: taskId, role: 'planning', stage: 'unit_planning' },
      ] }
      return {}
    },
  }
  try {
    const run = createSourceFirstAcpRun(options)
    assert.equal((await run.result).attentionRequired, true)
    const pause = events.find(event => event.stage === 'source_first_worker_paused')
    assert.match(pause.message, /2 条工具记录尚无结束确认/)
    assert.equal(pause.tool_lifecycle.pending_count, 2)
    assert.deepEqual(pause.tool_lifecycle.tools.map(tool => tool.tool_id), toolIds)
    assert.doesNotMatch(JSON.stringify(pause.tool_lifecycle), /rawInput|private command/)
    toolLifecycle.tools[0].status = 'completed'
    assert.equal(pause.tool_lifecycle.tools[0].status, 'pending', 'persisted evidence is detached from mutable worker diagnostics')
    assert.equal((await inspectSourceFirstAcpRecovery(options)).can_resume, false)
    assert.equal((await run.dispose()).retained, true)
    assert.equal(prompts, 1)
    assert.equal(settled, false)
    assert.equal(disposed, false)
    assert.equal(activeToolCount, 2)
    assert.ok(events.some(event => event.stage === 'source_first_saved_result_checked' && event.phase === 'saved_complete'))
  } finally {
    await stopSourceFirstAcpRun(options)
    await rm(dataRoot, { recursive: true, force: true })
  }
})

test('unclosed lifecycle alone rejects continuation before another prompt is dispatched', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'acp-unclosed-admit-'))
  const events = []
  let prompts = 0, taskId, settled = false
  let diagnostics = { activeToolCount: 0, toolCalls: 0, toolLifecycle: { unclosed_count: 0, tools: [] } }
  const worker = {
    id: 'worker', remoteSessionId: 'remote', result: Promise.resolve(completed),
    readDiagnostics: () => diagnostics,
    dispose: async () => {},
    continuePrompt: async () => {
      prompts++
      // A bare end_turn with no counted tool call still leaves unclosed evidence.
      // The zero-tool follow-up must not dispatch another prompt over it.
      diagnostics = {
        activeToolCount: 0,
        toolCalls: 0,
        toolLifecycle: { unclosed_count: 1, pending_count: 1, tools: [{ tool_id: 'stuck-read', status: 'pending' }] },
      }
      return completed
    },
  }
  const options = {
    dataRoot, cwd: dataRoot, runId: 'run', providerId: 'pangea-nga', signal: new AbortController().signal,
    onEvent: event => events.push(event), progressPolicy, subagents: { start: async () => worker },
    runner: async ({ args }) => {
      if (args[0] === 'task-open') return { task: {} }
      if (args[0] === 'result-read') return { revision: 1, completion_complete: false }
      if (args[1] === 'bind') taskId = args.at(-1)
      if (args[1] === 'settle') settled = true
      if (args[1] === 'next') return { run_id: 'run', actions: [
        { action_id: 'run:planning', action: taskId ? 'continue_agent' : 'dispatch_agent', task_id: taskId, role: 'planning', stage: 'unit_planning' },
      ] }
      return {}
    },
  }
  try {
    const run = createSourceFirstAcpRun(options)
    assert.equal((await run.result).attentionRequired, true)
    assert.equal(prompts, 1)
    assert.equal(settled, false)
    assert.ok(events.some(event => event.stage === 'source_first_zero_tool_turn'))
    const rejected = events.find(event => event.stage === 'source_first_continuation_rejected')
    assert.equal(rejected?.reason, 'unclosed_tools')
    assert.equal(rejected?.unclosed_count, 1)
    assert.match(rejected.message, /未发送续接/)
  } finally {
    await stopSourceFirstAcpRun(options)
    await rm(dataRoot, { recursive: true, force: true })
  }
})

test('Desktop ACP continuation admission rejection pauses without a follow-up prompt', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'acp-desktop-admit-'))
  const events = []
  let prompts = 0, taskId, settled = false
  const worker = {
    id: 'worker', remoteSessionId: 'remote', result: Promise.resolve(completed),
    readDiagnostics: () => ({ activeToolCount: 0, toolLifecycle: { unclosed_count: 0, tools: [] } }),
    dispose: async () => {},
    continuePrompt: async () => {
      prompts++
      throw Object.assign(new Error('ACP turn is not idle for continuation; 1 tool(s) still lack a terminal status'), {
        code: 'ACP_CONTINUATION_NOT_IDLE',
      })
    },
  }
  const options = {
    dataRoot, cwd: dataRoot, runId: 'run', providerId: 'pangea-nga', signal: new AbortController().signal,
    onEvent: event => events.push(event), progressPolicy, subagents: { start: async () => worker },
    runner: async ({ args }) => {
      if (args[0] === 'task-open') return { task: {} }
      if (args[0] === 'result-read') return { revision: 1, completion_complete: false }
      if (args[1] === 'bind') taskId = args.at(-1)
      if (args[1] === 'settle') settled = true
      if (args[1] === 'next') return { run_id: 'run', actions: [
        { action_id: 'run:planning', action: taskId ? 'continue_agent' : 'dispatch_agent', task_id: taskId, role: 'planning', stage: 'unit_planning' },
      ] }
      return {}
    },
  }
  try {
    const run = createSourceFirstAcpRun(options)
    assert.equal((await run.result).attentionRequired, true)
    assert.equal(prompts, 1)
    assert.equal(settled, false)
    assert.equal(events.filter(event => event.stage === 'source_first_continuation_rejected').length, 1)
    assert.match(events.find(event => event.stage === 'source_first_continuation_rejected').message, /not idle for continuation/)
    assert.equal(events.filter(event => event.stage === 'source_first_acp_request' && event.request_dispatched === true).length, 1)
  } finally {
    await stopSourceFirstAcpRun(options)
    await rm(dataRoot, { recursive: true, force: true })
  }
})

for (const mode of ['late-tool', 'repeat-late-tool', 'unconfirmed-prompt', 'saved-read-failed']) test(`pending tool safety and saved result reconciliation (${mode})`, { timeout: 10000 }, async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'acp-late-tool-'))
  const controller = new AbortController(), events = []
  let pending = deferred(), released = deferred()
  let diagnostic, activeToolCount = 0, taskId, settled = false, prompts = 0, reads = 0
  const worker = { id: 'late-worker', remoteSessionId: 'late-remote', result: Promise.resolve(completed),
    readDiagnostics: () => ({ activeToolCount }), dispose: async () => {},
    continuePrompt: async () => { prompts++; activeToolCount = 1; return pending.promise },
    cancelTurn: async () => {
      if (mode === 'unconfirmed-prompt') return new Promise(() => {})
      const outcome = { stopReason: 'aborted', protocolStopReason: 'cancelled' }
      pending.resolve(outcome)
      return { confirmed: true, outcome }
    },
  }
  const options = { dataRoot, cwd: dataRoot, runId: 'late-run', providerId: 'fixture', signal: controller.signal, progressPolicy,
    onEvent: event => { events.push(event); if (event.stage === 'source_first_late_response') released.resolve() },
    subagents: { start: async (_, request) => { diagnostic = request.onDiagnostic; return worker } },
    runner: async ({ args }) => {
      if (args[0] === 'task-open') return { task: {} }
      if (args[0] === 'result-read') {
        reads++
        if (mode === 'saved-read-failed') throw new Error('fixture result read failed')
        return { revision: 3, completion_complete: mode !== 'repeat-late-tool' || prompts >= 2, completion_declared_revision: 3 }
      }
      if (args[1] === 'bind') taskId = args.at(-1)
      if (args[1] === 'settle') { settled = true; return {} }
      if (args[1] === 'next') return { run_id: 'late-run', lifecycle_status: settled ? 'complete' : 'running', actions: settled ? [] : [
        { action_id: 'late:a', action: taskId ? 'continue_agent' : 'dispatch_agent', task_id: taskId, role: 'analysis', stage: 'unit_analysis' },
      ] }
      return {}
    },
  }
  const run = createSourceFirstAcpRun(options)
  try {
    assert.equal((await run.result).attentionRequired, true)
    assert.equal(prompts, 1); assert.equal(reads, 1); assert.equal(settled, false)
    assert.equal((await inspectSourceFirstAcpRecovery(options)).can_resume, false)
    assert.equal((await run.dispose()).retained, true)
    activeToolCount = 0
    diagnostic({ stage: 'tool_event', lastToolId: 'pending-tool', lastToolStatus: 'completed', activeToolCount: 0 })
    if (mode === 'unconfirmed-prompt') {
      assert.equal((await inspectSourceFirstAcpRecovery(options)).can_resume, false)
      pending.resolve({ stopReason: 'aborted', protocolStopReason: 'cancelled' })
    }
    await released.promise
    assert.equal((await inspectSourceFirstAcpRecovery(options)).can_resume, true)
    assert.equal(prompts, 1)
    if (mode === 'repeat-late-tool') {
      pending = deferred(); released = deferred()
      const repeated = createSourceFirstAcpRun(options)
      assert.equal((await repeated.result).attentionRequired, true)
      assert.equal(prompts, 2)
      assert.equal((await inspectSourceFirstAcpRecovery(options)).can_resume, false)
      activeToolCount = 0
      // The callback was bound when the original worker was created, before
      // this second execution installed its own reconciliation handler.
      diagnostic({ stage: 'tool_event', lastToolId: 'second-tool', lastToolStatus: 'completed', activeToolCount: 0 })
      await released.promise
      assert.equal((await inspectSourceFirstAcpRecovery(options)).can_resume, true)
      await repeated.dispose()
    }
    if (['late-tool', 'repeat-late-tool'].includes(mode)) {
      const continued = createSourceFirstAcpRun(options)
      assert.equal((await continued.result).attentionRequired, false)
      assert.equal(settled, true); assert.equal(prompts, mode === 'repeat-late-tool' ? 2 : 1)
      await continued.dispose()
    }
    assert.ok(events.some(event => event.stage === 'source_first_saved_result_checked' && event.status === (mode === 'saved-read-failed' ? 'error' : 'info')))
  } finally {
    pending.resolve(completed); controller.abort(); await run.dispose()
    await rm(dataRoot, { recursive: true, force: true })
  }
})

for (const mode of ['recover', 'saved', 'twice', 'unconfirmed', 'ready', 'disconnect']) test(`coordinator ${mode} preserves identity and results`, { timeout: 10000 }, async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'acp-recovery-'))
  const controller = new AbortController(), events = [], prompts = [], lateResponse = deferred()
  const scratchDirectories = []
  let pending = deferred(), settled = false, starts = 0, turns = 0, taskId
  const worker = { id: 'worker', remoteSessionId: 'remote', result: mode === 'ready' ? pending.promise : Promise.resolve(completed),
    readDiagnostics: () => ({ activeToolCount: 0, canLoadSession: true, processExited: mode === 'disconnect' && starts === 1 && turns > 0 }),
    dispose: async () => {},
    cancelTurn: async () => {
      if (mode === 'unconfirmed') return new Promise(() => {})
      const outcome = { stopReason: 'aborted', protocolStopReason: 'cancelled' }; pending.resolve(outcome); return { confirmed: true, outcome }
    },
    continuePrompt: async prompt => {
      turns++; prompts.push(prompt[0].text)
      if (mode === 'disconnect' && turns === 1) return { stopReason: 'error' }
      if ((turns === 2 && mode !== 'twice') || mode === 'ready') return completed
      pending = deferred(); return pending.promise
    },
  }
  const options = { dataRoot, runId: 'run', cwd: dataRoot, providerId: 'pangea-nga', agentModel: 'fixture/model',
    attemptId: 'recovery-attempt', signal: controller.signal, progressPolicy,
    onEvent: async e => { events.push(e); if (e.stage === 'source_first_late_response') lateResponse.resolve() }, subagents: { start: async (_, request) => {
      assert.equal(request.pangeaCliWorker, true)
      scratchDirectories.push(request.scratchDirectory)
      request.onDiagnostic({ stage: 'file_permission', lastPermissionKind: 'edit',
        lastPermissionPaths: [path.join(request.scratchDirectory, 'unit.json')], lastPermissionDecision: 'allow_once' })
      starts++; if (starts > 1) assert.deepEqual(request.resume, { taskId: 'worker', remoteSessionId: 'remote' }); return worker
    } }, runner: async ({ args }) => {
      if (args[0] === 'task-open') return { task: {} }
      if (args[0] === 'result-read') return { revision: 2, completion_complete: mode === 'saved', completion_declared_revision: 2 }
      if (args[1] === 'bind') { taskId = args.at(-1); return {} }
      if (args[1] === 'settle') { settled = true; return {} }
      if (args[1] === 'next') return { run_id: 'run', lifecycle_status: settled ? 'complete' : 'running', actions: settled ? [] : [{ action_id: 'run:a', action: taskId ? 'continue_agent' : 'dispatch_agent', task_id: taskId, role: 'analysis', stage: 'unit_analysis' }] }
      return {}
    } }
  const run = createSourceFirstAcpRun(options)
  assert.throws(() => createSourceFirstAcpRun(options), /当前 Run 已由宿主执行/)
  try {
    const result = await run.result
    assert.equal(starts, mode === 'disconnect' ? 2 : 1)
    assert.ok(path.isAbsolute(scratchDirectories[0]))
    assert.equal(new Set(scratchDirectories).size, 1)
    const permissions = events.filter(event => event.stage === 'source_first_file_permission')
    assert.equal(permissions.length, scratchDirectories.length)
    for (const [index, event] of permissions.entries()) {
      const { agent_session_id, remote_session_id, execution_id, request_id, ...permission } = event
      assert.deepEqual(permission, {
        run_id: 'run', attempt_id: 'recovery-attempt', provider: 'pangea-nga', requested_model: 'fixture/model',
        stage: 'source_first_file_permission', action_id: 'run:a', action_stage: 'unit_analysis', unit_id: undefined,
        kind: 'edit', paths: [path.join(scratchDirectories[index], 'unit.json')], decision: 'allow_once',
      })
      if (index === 0) {
        // Startup diagnostics precede the first returned worker binding.
        assert.deepEqual([agent_session_id, remote_session_id, execution_id, request_id], [undefined, undefined, undefined, undefined])
      } else {
        assert.equal(agent_session_id, 'worker'); assert.equal(remote_session_id, 'remote')
        const original = events.find(item => item.stage === 'source_first_acp_request' && item.request_id === request_id)
        assert.ok(original)
        assert.equal(original.action_id, event.action_id); assert.equal(original.execution_id, execution_id)
        assert.equal(original.attempt_id, event.attempt_id)
      }
    }
    assert.equal(turns, ['ready', 'saved', 'unconfirmed'].includes(mode) ? 1 : 2)
    assert.equal(Boolean(result.attentionRequired), ['twice', 'unconfirmed'].includes(mode))
    assert.equal(settled, !['twice', 'unconfirmed'].includes(mode))
    if (mode === 'unconfirmed') {
      const state = JSON.parse(await readFile(path.join(dataRoot, 'runs/run/acp-workers.json'), 'utf8'))
      assert.equal(state.workers.worker.blocked, true)
      const resumed = createSourceFirstAcpRun(options)
      assert.equal((await resumed.result).attentionRequired, true)
      assert.equal(turns, 1)
    }
    if (turns === 2) assert.match(prompts[1], /保留已保存内容/)
  } finally {
    pending.resolve(completed)
    // Releasing the test's pending response starts a real persisted-state write.
    // Wait for its completion before removing the temporary Run directory.
    if (mode === 'unconfirmed') await lateResponse.promise
    controller.abort(); await run.dispose(); await rm(dataRoot, { recursive: true, force: true })
  }
})

test('a completed unit can repair before its slow sibling finishes, with at most three workers', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'acp-scheduler-'))
  const controller = new AbortController(), slow = deferred(), states = [0, 0, 0, 0]
  let running = 0, peak = 0, repairedBeforeSlow = false
  const run = createSourceFirstAcpRun({ dataRoot, runId: 'run', cwd: dataRoot, providerId: 'pangea-nga', signal: controller.signal,
    runner: async ({ args }) => {
      if (args[0] === 'task-open') return { task: {} }
      if (args[1] === 'settle') { states[Number(args[args.indexOf('--action-id') + 1].split(':')[1])]++; return {} }
      if (args[1] === 'next') return { run_id: 'run', lifecycle_status: states.every((s, i) => s >= (i === 0 ? 2 : 1)) ? 'complete' : 'running', actions: states.flatMap((s, i) => s >= (i === 0 ? 2 : 1) ? [] : [{ action_id: `run:${i}`, task_id: s ? `w${i}` : undefined, action: s ? 'continue_agent' : 'dispatch_agent', role: 'analysis', stage: 'unit_analysis' }]) }
      return {}
    }, subagents: { start: async (_, request) => {
      const i = Number(request.label.split(':').at(-1))
      return { id: `w${i}`, result: Promise.resolve(completed), dispose: async () => {}, continuePrompt: async () => {
        running++; peak = Math.max(peak, running)
        if (i === 1) await slow.promise
        if (i === 0 && states[0] === 1) { repairedBeforeSlow = states[1] === 0; slow.resolve() }
        running--; return completed
      } }
    } } })
  const deadline = setTimeout(() => controller.abort(new Error('scheduler blocked')), 1000)
  try { await run.result; assert.equal(repairedBeforeSlow, true); assert.ok(peak <= 3) }
  finally { clearTimeout(deadline); controller.abort(); slow.resolve(); await run.dispose(); await rm(dataRoot, { recursive: true, force: true }) }
})

test('attention stores full diagnostic beyond launch log limit and keeps user message short', async t => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'acp-diagnostic-'))
  t.after(() => rm(dataRoot, { recursive: true, force: true }))
  let bound, done = false
  const events = [], detail = 'x'.repeat(20000)
  const run = createSourceFirstAcpRun({ dataRoot, runId: 'run', cwd: dataRoot, providerId: 'test', signal: new AbortController().signal,
    onEvent: e => events.push(e),
    subagents: { start: async () => ({ id: 'worker', result: Promise.resolve(completed), continuePrompt: async () => completed, dispose: async () => {} }) },
    runner: async ({ args }) => {
      if (args[0] === 'task-open') return { task: {} }
      if (args[0] === 'result-read') return { revision: 7, active_count: 0, total_count: 38 }
      if (args[1] === 'bind') { bound = args.at(-1); return {} }
      if (args[1] === 'settle') { done = true; return { attention_required: true, validation: { error: { code: 'IncompleteSourceFirstResult', message: '没有当前有效 records' }, details: detail } } }
      if (args[1] === 'next') return { run_id: 'run', lifecycle_status: 'running', actions: done ? [] : [{ action_id: 'run:a', action: bound ? 'continue_agent' : 'dispatch_agent', task_id: bound, role: 'analysis', stage: 'unit_analysis' }] }
      return {}
    } })
  const result = await run.result
  assert.equal(result.attentionRequired, true)
  assert.ok(result.diagnostic.length < 2000)
  const event = events.find(e => e.stage === 'source_first_action_attention')
  const saved = JSON.parse(await readFile(event.diagnostic_path, 'utf8'))
  assert.equal(saved.settled.validation.details, detail)
  assert.equal(saved.result_snapshot.total_count, 38)
  await run.dispose()
})
