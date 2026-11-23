import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createInjectionGenerator, injectionWrapUpPrompt } from '../src/fault-injection-agent.js'

test('code generation uses the selected external model, isolated scratch and saved session identity', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fi-agent-')); t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(path.join(directory, '.agents', 'pangea'), { recursive: true }); await writeFile(path.join(directory, '.agents', 'pangea', 'dsh.md'), 'fixture')
  const outputPath = path.join(directory, 'result.json'), payload = { summary: 'generated', edits: [] }
  await writeFile(outputPath, JSON.stringify(payload))
  let request, started, disposed = false
  const parent = { id: 'parent' }
  const runtime = { agents: { get: () => parent }, subagents: { start: async (provider, input) => {
    assert.equal(provider, 'configured'); request = input
    return { id: 'worker', remoteSessionId: 'remote', result: Promise.resolve({ stopReason: 'completed' }), dispose: async () => { disposed = true } }
  } } }
  const generate = createInjectionGenerator(runtime, { resolveModel: async (_, options) => options.model, createSession: async () => 'parent' })
  const result = await generate({ record: { id: 'task-1', provider_id: 'configured', agent_model: 'selected-model' }, cwd: directory, scratchDirectory: directory, outputPath,
    prompt: 'read current case and generate', signal: new AbortController().signal, onStarted: async value => { started = value } })
  assert.deepEqual(result, payload); assert.equal(request.parent, parent); assert.equal(request.agentOptions.model, 'selected-model')
  assert.equal(request.scratchDirectory, directory); assert.equal(started.agent_session_id, 'worker'); assert.equal(disposed, true)
})

test('external model errors are reported and the worker is disposed without inventing edits', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fi-agent-')); t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(path.join(directory, '.agents', 'pangea'), { recursive: true }); await writeFile(path.join(directory, '.agents', 'pangea', 'dsh.md'), 'fixture')
  let disposed = false
  const generate = createInjectionGenerator({ agents: { get: () => ({}) }, subagents: { start: async () => ({
    id: 'failed', result: Promise.resolve({ stopReason: 'error', diagnostic: 'provider test error' }), dispose: async () => { disposed = true },
  }) } }, { resolveModel: async () => 'model', createSession: async () => 'parent' })
  await assert.rejects(generate({ record: { id: 'task', provider_id: 'configured' }, cwd: directory, scratchDirectory: '/unused', outputPath: '/unused/result.json',
    prompt: 'generate', signal: new AbortController().signal, onStarted: async () => {} }), /provider test error/)
  assert.equal(disposed, true)
})

for (const [name, content, expected] of [['missing', null, /未交付.*task-missing.*remote-missing/], ['invalid JSON', '{broken', /打桩生成结果不可读取.*JSON/]]) {
  test(`completed worker with ${name} reports delivery failure and disposes`, async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'fi-delivery-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    await mkdir(path.join(directory, '.agents', 'pangea'), { recursive: true }); await writeFile(path.join(directory, '.agents', 'pangea', 'dsh.md'), 'fixture')
    const outputPath = path.join(directory, 'result.json')
    if (content !== null) await writeFile(outputPath, content)
    let disposed = false
    const generate = createInjectionGenerator({ agents: { get: () => ({}) }, subagents: { start: async () => ({
      id: 'worker', remoteSessionId: 'remote-missing', result: Promise.resolve({ stopReason: 'completed' }),
      dispose: async () => { disposed = true },
    }) } }, { resolveModel: async () => 'model', createSession: async () => 'parent' })
    await assert.rejects(generate({ record: { id: 'task-missing', provider_id: 'configured' }, cwd: directory,
      outputPath, prompt: 'generate', signal: new AbortController().signal, onStarted: async () => {} }), expected)
    assert.equal(disposed, true)
  })
}

for (const scenario of [
  { name: 'RPC rejection retained only in diagnostics', stopReason: 'error', diagnostics: { errorSummary: 'Unable to connect: ConnectionRefused' }, expected: /Unable to connect: ConnectionRefused/ },
  { name: 'primary diagnostic takes precedence', stopReason: 'error', diagnostic: 'primary failure', diagnostics: { errorSummary: 'secondary failure' }, expected: /^primary failure$/ },
  { name: 'diagnostic reader failure preserves stop reason', stopReason: 'error', readerFails: true, expected: /打桩生成结束：error/ },
  { name: 'false completion includes available cause', stopReason: 'completed', diagnostics: { errorSummary: 'ConnectionRefused' }, expected: /未交付.*ConnectionRefused/ },
  { name: 'false completion survives diagnostic reader failure', stopReason: 'completed', readerFails: true, expected: /未交付/ },
  { name: 'abort wins over provider diagnostic', stopReason: 'error', abort: true, diagnostics: { errorSummary: 'ConnectionRefused' }, expected: /fixture aborted/ },
]) {
  test(scenario.name, async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'fi-diagnostic-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    await mkdir(path.join(directory, '.agents', 'pangea'), { recursive: true })
    await writeFile(path.join(directory, '.agents', 'pangea', 'dsh.md'), 'fixture')
    let disposed = false, diagnosticReads = 0
    const controller = new AbortController()
    const generate = createInjectionGenerator({ agents: { get: () => ({}) }, subagents: { start: async () => ({
      id: 'worker', remoteSessionId: 'remote',
      result: Promise.resolve({ stopReason: scenario.stopReason, diagnostic: scenario.diagnostic }),
      readDiagnostics: async () => { diagnosticReads++; if (scenario.readerFails) throw new Error('reader failed'); return scenario.diagnostics },
      dispose: async () => { disposed = true },
    }) } }, { resolveModel: async () => 'model', createSession: async () => 'parent' })
    await assert.rejects(generate({ record: { id: 'task', provider_id: 'configured' }, cwd: directory,
      outputPath: path.join(directory, 'missing.json'), prompt: 'generate', signal: controller.signal,
      onStarted: async () => { if (scenario.abort) controller.abort(new Error('fixture aborted')) },
    }), error => { assert.match(error.message, scenario.expected); return true })
    assert.equal(disposed, true)
    if (scenario.abort || scenario.diagnostic) assert.equal(diagnosticReads, 0)
  })
}

test('Round 4 guard A: authoring tools and active result writes are exempt from exploration budget interruption', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fi-authoring-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(path.join(directory, '.agents', 'pangea'), { recursive: true })
  await writeFile(path.join(directory, '.agents', 'pangea', 'dsh.md'), 'fixture')
  const scratch = path.join(directory, 'generation')
  await mkdir(scratch, { recursive: true })
  const outputPath = path.join(scratch, 'result.json')
  let cancelCalls = 0
  const generate = createInjectionGenerator({
    agents: { get: () => ({ id: 'parent' }) },
    subagents: {
      start: async (_provider, req) => {
        const turn = (async () => {
          req.onSessionEvent({ type: 'turn_start' })
          // 2 exploration calls (budget softToolCalls = 3)
          req.onSessionEvent({ type: 'session_update', update: { sessionUpdate: 'tool_call', toolCallId: 'e1', kind: 'read', status: 'completed' } })
          req.onSessionEvent({ type: 'session_update', update: { sessionUpdate: 'tool_call', toolCallId: 'e2', kind: 'grep', status: 'completed' } })
          // Tool #3 and #4 are authoring tools (edit + bash writing result.json) and must NOT count as exploration or be interrupted
          req.onSessionEvent({ type: 'session_update', update: { sessionUpdate: 'tool_call', toolCallId: 'a1', kind: 'edit', status: 'in_progress' } })
          await new Promise(resolve => setTimeout(resolve, 45))
          req.onSessionEvent({ type: 'session_update', update: { sessionUpdate: 'tool_call_update', toolCallId: 'a1', kind: 'edit', status: 'completed' } })
          req.onSessionEvent({
            type: 'session_update',
            update: { sessionUpdate: 'tool_call', toolCallId: 'a2', kind: 'bash', title: `python3 -c "open('${outputPath}','w')"`, status: 'in_progress' },
          })
          await new Promise(resolve => setTimeout(resolve, 45))
          await writeFile(outputPath, JSON.stringify({ summary: 'delivered in turn 1', edits: [{ repo_id: 'r', path: 'a.c', before: '0', after: '1' }] }))
          req.onSessionEvent({ type: 'session_update', update: { sessionUpdate: 'tool_call_update', toolCallId: 'a2', status: 'completed' } })
          return { stopReason: 'completed' }
        })()
        return {
          id: 'worker-auth',
          remoteSessionId: 'remote-auth',
          result: turn,
          cancelTurn: async () => { cancelCalls += 1; return { confirmed: true } },
          dispose: async () => {},
        }
      },
    },
  }, {
    resolveModel: async () => 'fast-model',
    createSession: async () => 'parent',
    budget: { softToolCalls: 3, pollMs: 15 },
  })
  let telemetry = null
  const result = await generate({
    record: { id: 'task-auth', provider_id: 'configured', case_keys: ['unit/A'] },
    cwd: directory,
    scratchDirectory: scratch,
    outputPath,
    prompt: 'generate',
    signal: new AbortController().signal,
    onStarted: async () => {},
    onTelemetry: value => { telemetry = value },
  })
  assert.equal(result.summary, 'delivered in turn 1')
  assert.equal(cancelCalls, 0)
  assert.equal(telemetry.budget_wrapup_triggered, false)
  assert.equal(telemetry.explore_tool_calls, 2)
  assert.equal(telemetry.authoring_tool_calls, 2)
  assert.equal(telemetry.turns, 1)
})

test('Round 4 guard B: sliding progress lease keeps slow streaming wrap-up alive well past base wrapUpDurationMs', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fi-lease-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(path.join(directory, '.agents', 'pangea'), { recursive: true })
  await writeFile(path.join(directory, '.agents', 'pangea', 'dsh.md'), 'fixture')
  const scratch = path.join(directory, 'generation')
  await mkdir(scratch, { recursive: true })
  const outputPath = path.join(scratch, 'result.json')
  let cancelCalls = 0
  const generate = createInjectionGenerator({
    agents: { get: () => ({ id: 'parent' }) },
    subagents: {
      start: async (_provider, req) => {
        let resolveFirst
        const firstTurn = new Promise(resolve => { resolveFirst = resolve })
        req.onSessionEvent({ type: 'turn_start' })
        req.onSessionEvent({ type: 'session_update', update: { sessionUpdate: 'tool_call', toolCallId: 'c1', kind: 'read', status: 'completed' } })
        req.onSessionEvent({ type: 'session_update', update: { sessionUpdate: 'tool_call', toolCallId: 'c2', kind: 'read', status: 'completed' } })
        return {
          id: 'worker-lease',
          remoteSessionId: 'remote-lease',
          result: firstTurn,
          readDiagnostics: () => ({ activeTools: 0, toolCalls: 2, toolFailures: 0 }),
          cancelTurn: async () => {
            cancelCalls += 1
            resolveFirst({ stopReason: 'cancelled' })
            return { confirmed: true }
          },
          continuePrompt: async () => {
            req.onSessionEvent({ type: 'turn_start' })
            // Stream chunks for ~220ms (> 3x base wrapUpDurationMs=60ms) before writing 20KB result.json
            for (let i = 0; i < 8; i++) {
              await new Promise(resolve => setTimeout(resolve, 28))
              req.onSessionEvent({ type: 'session_update', update: { sessionUpdate: 'agent_message_chunk', text: 'x'.repeat(2500) } })
            }
            const bigSummary = 'S'.repeat(19000)
            await writeFile(outputPath, JSON.stringify({ summary: bigSummary, edits: [{ repo_id: 'r', path: 'a.c', before: '0', after: '1' }] }))
            return { stopReason: 'completed' }
          },
          dispose: async () => {},
        }
      },
    },
  }, {
    resolveModel: async () => 'slow-fallback-model',
    createSession: async () => 'parent',
    budget: { softToolCalls: 2, wrapUpDurationMs: 60, progressLeaseMs: 90, hardDurationMs: 3000, pollMs: 15 },
  })
  const result = await generate({
    record: { id: 'task-lease', provider_id: 'configured', case_keys: ['unit/A'] },
    cwd: directory,
    scratchDirectory: scratch,
    outputPath,
    prompt: 'generate',
    signal: new AbortController().signal,
    onStarted: async () => {},
  })
  assert.equal(result.summary.length, 19000)
  // cancelTurn was called exactly once (to transition from exploration to wrap-up), never during active wrap-up!
  assert.equal(cancelCalls, 1)
})

test('stalled wrap-up with zero events and zero scratch activity terminates cleanly', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fi-stall-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(path.join(directory, '.agents', 'pangea'), { recursive: true })
  await writeFile(path.join(directory, '.agents', 'pangea', 'dsh.md'), 'fixture')
  const scratch = path.join(directory, 'generation')
  await mkdir(scratch, { recursive: true })
  const outputPath = path.join(scratch, 'result.json')
  let cancelCalls = 0
  const generate = createInjectionGenerator({
    agents: { get: () => ({ id: 'parent' }) },
    subagents: {
      start: async (_provider, req) => {
        let resolveFirst, rejectWrapUp
        const firstTurn = new Promise(resolve => { resolveFirst = resolve })
        req.onSessionEvent({ type: 'turn_start' })
        req.onSessionEvent({ type: 'session_update', update: { sessionUpdate: 'tool_call', toolCallId: 'c1', kind: 'read', status: 'completed' } })
        req.onSessionEvent({ type: 'session_update', update: { sessionUpdate: 'tool_call', toolCallId: 'c2', kind: 'read', status: 'completed' } })
        return {
          id: 'worker-stall',
          remoteSessionId: 'remote-stall',
          result: firstTurn,
          readDiagnostics: () => ({ activeTools: 0, toolCalls: 2, toolFailures: 0 }),
          cancelTurn: async () => {
            cancelCalls += 1
            if (cancelCalls === 1) resolveFirst({ stopReason: 'cancelled' })
            else if (rejectWrapUp) rejectWrapUp(new Error('MessageAbortedError'))
            return { confirmed: true }
          },
          continuePrompt: () => new Promise((_resolve, reject) => { rejectWrapUp = reject }),
          dispose: async () => {},
        }
      },
    },
  }, {
    resolveModel: async () => 'model',
    createSession: async () => 'parent',
    budget: { softToolCalls: 2, wrapUpDurationMs: 55, progressLeaseMs: 55, hardDurationMs: 1000, pollMs: 15 },
  })
  await assert.rejects(generate({
    record: { id: 'task-stall', provider_id: 'configured', case_keys: ['unit/A'] },
    cwd: directory,
    scratchDirectory: scratch,
    outputPath,
    prompt: 'generate',
    signal: new AbortController().signal,
    onStarted: async () => {},
  }), /探索预算收口超时/)
  assert.ok(cancelCalls >= 2)
})

test('multi-case batch dynamically expands default softToolCalls and non-user-abort salvages valid disk result.json', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fi-salvage-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(path.join(directory, '.agents', 'pangea'), { recursive: true })
  await writeFile(path.join(directory, '.agents', 'pangea', 'dsh.md'), 'fixture')
  const scratch = path.join(directory, 'generation')
  await mkdir(scratch, { recursive: true })
  const outputPath = path.join(scratch, 'result.json')
  let cancelCalls = 0
  const generate = createInjectionGenerator({
    agents: { get: () => ({ id: 'parent' }) },
    subagents: {
      start: async (_provider, req) => {
        const turn = (async () => {
          req.onSessionEvent({ type: 'turn_start' })
          // 24 read calls: exceeds single-case 18, within 4-case scaled budget (18 + 3*4 = 30)
          for (let i = 1; i <= 24; i++) {
            req.onSessionEvent({ type: 'session_update', update: { sessionUpdate: 'tool_call', toolCallId: `r-${i}`, kind: 'read', status: 'completed' } })
          }
          await new Promise(resolve => setTimeout(resolve, 35))
          await writeFile(outputPath, JSON.stringify({ summary: 'salvaged', edits: [{ repo_id: 'r', path: 'a.c', before: '0', after: '1' }] }))
          // Simulate non-completed stopReason right after result.json hit disk
          return { stopReason: 'cancelled', diagnostic: 'late stream close after write' }
        })()
        return {
          id: 'worker-salvage',
          remoteSessionId: 'remote-salvage',
          result: turn,
          cancelTurn: async () => { cancelCalls += 1; return { confirmed: true } },
          dispose: async () => {},
        }
      },
    },
  }, {
    resolveModel: async () => 'model',
    createSession: async () => 'parent',
    budget: { pollMs: 15 },
  })
  let telemetry = null
  const result = await generate({
    record: { id: 'task-salvage', provider_id: 'configured', case_keys: ['c1', 'c2', 'c3', 'c4'] },
    cwd: directory,
    scratchDirectory: scratch,
    outputPath,
    prompt: 'generate',
    signal: new AbortController().signal,
    onStarted: async () => {},
    onTelemetry: value => { telemetry = value },
  })
  assert.equal(cancelCalls, 0)
  assert.equal(result.summary, 'salvaged')
  assert.equal(telemetry.salvaged_disk_result, true)
  assert.equal(telemetry.soft_tool_budget, 30)
})

test('F6 stall watchdog: authoring-phase stream stall triggers stopExecution and single loadSession resume without hitting hardDurationMs', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fi-stall-resume-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(path.join(directory, '.agents', 'pangea'), { recursive: true })
  await writeFile(path.join(directory, '.agents', 'pangea', 'dsh.md'), 'fixture')
  const scratch = path.join(directory, 'generation')
  await mkdir(scratch, { recursive: true })
  const outputPath = path.join(scratch, 'result.json')
  let startCalls = 0, stopped = 0, resumeReq = null
  const generate = createInjectionGenerator({
    agents: { get: () => ({ id: 'parent' }) },
    subagents: {
      start: async (_provider, req) => {
        startCalls += 1
        if (startCalls === 1) {
          // Simulate model entering authoring phase (which previously exempted pollTimer) and then hanging silently
          req.onSessionEvent({ type: 'turn_start' })
          req.onSessionEvent({ type: 'session_update', update: { sessionUpdate: 'tool_call', toolCallId: 'a1', kind: 'edit', status: 'in_progress' } })
          return {
            id: 'worker-stuck',
            remoteSessionId: 'remote-stuck-1',
            result: new Promise(() => {}),
            readDiagnostics: () => ({ activeToolCount: 1, canLoadSession: true, processExited: false }),
            cancelTurn: async () => ({ confirmed: false }),
            continuePrompt: async () => ({ stopReason: 'error' }),
            stopExecution: async () => { stopped += 1; return { confirmed: true, processTreeStopped: true } },
            dispose: async () => {},
          }
        }
        resumeReq = req
        return {
          id: 'worker-stuck',
          remoteSessionId: 'remote-stuck-1',
          result: Promise.resolve({ stopReason: 'completed' }),
          readDiagnostics: () => ({ activeToolCount: 0, canLoadSession: true }),
          continuePrompt: async () => {
            await writeFile(outputPath, JSON.stringify({ summary: 'resumed ok', edits: [{ repo_id: 'r', path: 'a.c', before: '0', after: '1' }] }))
            return { stopReason: 'completed' }
          },
          dispose: async () => {},
        }
      },
    },
  }, {
    resolveModel: async () => 'model',
    createSession: async () => 'parent',
    budget: { stallDurationMs: 70, cancelGraceMs: 40, hardDurationMs: 5000, pollMs: 15 },
  })
  let telemetry = null
  const result = await generate({
    record: { id: 'task-stall-resume', provider_id: 'configured', case_keys: ['unit/A'] },
    cwd: directory,
    scratchDirectory: scratch,
    outputPath,
    prompt: 'generate',
    signal: new AbortController().signal,
    onStarted: async () => {},
    onTelemetry: value => { telemetry = value },
  })
  assert.equal(result.summary, 'resumed ok')
  assert.equal(startCalls, 2)
  assert.equal(stopped, 1)
  assert.deepEqual(resumeReq.resume, { taskId: 'worker-stuck', remoteSessionId: 'remote-stuck-1' })
  assert.equal(telemetry.stall_detected, true)
  assert.equal(telemetry.session_resumes, 1)
})

test('F6 stall watchdog: unrecoverable stream stall fails fast well before hardDurationMs', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fi-stall-fastfail-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(path.join(directory, '.agents', 'pangea'), { recursive: true })
  await writeFile(path.join(directory, '.agents', 'pangea', 'dsh.md'), 'fixture')
  const scratch = path.join(directory, 'generation')
  await mkdir(scratch, { recursive: true })
  const outputPath = path.join(scratch, 'result.json')
  const started = Date.now()
  const generate = createInjectionGenerator({
    agents: { get: () => ({ id: 'parent' }) },
    subagents: {
      start: async (_provider, req) => {
        req.onSessionEvent({ type: 'turn_start' })
        req.onSessionEvent({ type: 'session_update', update: { sessionUpdate: 'tool_call', toolCallId: 'a1', kind: 'edit', status: 'in_progress' } })
        return {
          id: 'worker-dead',
          remoteSessionId: 'remote-dead',
          result: new Promise(() => {}),
          readDiagnostics: () => ({ activeToolCount: 1, canLoadSession: false, errorSummary: 'stream closed prematurely' }),
          cancelTurn: async () => ({ confirmed: false }),
          continuePrompt: async () => ({ stopReason: 'error' }),
          stopExecution: async () => ({ confirmed: true, processTreeStopped: true }),
          dispose: async () => {},
        }
      },
    },
  }, {
    resolveModel: async () => 'model',
    createSession: async () => 'parent',
    budget: { stallDurationMs: 60, cancelGraceMs: 30, hardDurationMs: 10000, pollMs: 15 },
  })
  await assert.rejects(generate({
    record: { id: 'task-fastfail', provider_id: 'configured', case_keys: ['unit/A'] },
    cwd: directory,
    scratchDirectory: scratch,
    outputPath,
    prompt: 'generate',
    signal: new AbortController().signal,
    onStarted: async () => {},
  }), /工具流静默中断.*stream closed prematurely/)
  assert.ok(Date.now() - started < 2000, 'must fail fast instead of waiting for hardDurationMs')
})

test('F2 same-session repair: deterministic validation failure triggers at most one continuePrompt repair before disposing worker', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fi-repair-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(path.join(directory, '.agents', 'pangea'), { recursive: true })
  await writeFile(path.join(directory, '.agents', 'pangea', 'dsh.md'), 'fixture')
  const scratch = path.join(directory, 'generation')
  await mkdir(scratch, { recursive: true })
  const outputPath = path.join(scratch, 'result.json')
  let repairPrompts = []
  const generate = createInjectionGenerator({
    agents: { get: () => ({ id: 'parent' }) },
    subagents: {
      start: async () => {
        await writeFile(outputPath, JSON.stringify({ summary: 'broken', edits: [{ repo_id: 'r', path: 'CMakeLists.txt', before: ')', after: ') stray_token' }] }))
        return {
          id: 'worker-repair',
          remoteSessionId: 'remote-repair',
          result: Promise.resolve({ stopReason: 'completed' }),
          readDiagnostics: () => ({ activeToolCount: 0 }),
          continuePrompt: async parts => {
            repairPrompts.push(parts[0].text)
            await writeFile(outputPath, JSON.stringify({ summary: 'repaired', edits: [{ repo_id: 'r', path: 'CMakeLists.txt', before: ')', after: '  good_file.c\n)' }] }))
            return { stopReason: 'completed' }
          },
          dispose: async () => {},
        }
      },
    },
  }, {
    resolveModel: async () => 'model',
    createSession: async () => 'parent',
    budget: { pollMs: 15 },
  })
  let telemetry = null
  const result = await generate({
    record: { id: 'task-repair', provider_id: 'configured', case_keys: ['unit/A'] },
    cwd: directory,
    scratchDirectory: scratch,
    outputPath,
    prompt: 'generate',
    signal: new AbortController().signal,
    onStarted: async () => {},
    onTelemetry: value => { telemetry = value },
    validateOutput: candidate => {
      if (candidate.summary === 'broken') throw new Error('CMake 语法错误（CMakeLists.txt:3）：闭括号外存在裸标记「stray_token」')
    },
  })
  assert.equal(result.summary, 'repaired')
  assert.equal(repairPrompts.length, 1)
  assert.match(repairPrompts[0], /CMake 语法错误.*stray_token/)
  assert.equal(telemetry.repair_turns, 1)
})

test('v3 wrap-up prompt includes delivery contract and runWatchedContinue aborts hung authoring stream at stallDurationMs', async t => {
  assert.match(injectionWrapUpPrompt('/tmp/result.json', { id: 't3', generation_contract_version: 3 }), /顶层须包含 delivery/)
  assert.doesNotMatch(injectionWrapUpPrompt('/tmp/result.json', { id: 't2', generation_contract_version: 2 }), /顶层须包含 delivery/)

  const directory = await mkdtemp(path.join(os.tmpdir(), 'fi-continue-stall-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(path.join(directory, '.agents', 'pangea'), { recursive: true })
  await writeFile(path.join(directory, '.agents', 'pangea', 'dsh.md'), 'fixture')
  const scratch = path.join(directory, 'generation')
  await mkdir(scratch, { recursive: true })
  const outputPath = path.join(scratch, 'result.json')
  let stopped = 0
  let activeToolCount = 0
  let telemetry = null
  const started = Date.now()
  const generate = createInjectionGenerator({
    agents: { get: () => ({ id: 'parent' }) },
    subagents: {
      start: async (_provider, req) => {
        await writeFile(outputPath, JSON.stringify({ summary: 'broken', edits: [] }))
        return {
          id: 'worker-continue-hung',
          remoteSessionId: 'remote-continue-hung',
          result: Promise.resolve({ stopReason: 'completed' }),
          readDiagnostics: () => ({ activeToolCount }),
          cancelTurn: async () => ({ confirmed: false }),
          stopExecution: async () => { stopped += 1; return { confirmed: true } },
          continuePrompt: async () => {
            // Simulate an authoring tool ('write') left in_progress forever when stream dies mid-repair
            activeToolCount = 1
            req.onSessionEvent({
              type: 'session_update',
              update: { sessionUpdate: 'tool_call', toolCallId: 'write-hung', kind: 'write', status: 'in_progress' },
            })
            return new Promise(() => {})
          },
          dispose: async () => {},
        }
      },
    },
  }, {
    resolveModel: async () => 'model',
    createSession: async () => 'parent',
    budget: { wrapUpDurationMs: 30, stallDurationMs: 80, hardDurationMs: 10000, pollMs: 20 },
  })
  const returned = await generate({
    record: { id: 'task-continue-hung', provider_id: 'configured', case_keys: ['unit/A'], generation_contract_version: 3 },
    cwd: directory,
    scratchDirectory: scratch,
    outputPath,
    prompt: 'generate',
    signal: new AbortController().signal,
    onStarted: async () => {},
    onTelemetry: value => { telemetry = value },
    validateOutput: candidate => {
      if (candidate.summary === 'broken') throw new Error('broken initial output')
    },
  })
  const elapsedMs = Date.now() - started
  assert.equal(returned.summary, 'broken')
  assert.equal(telemetry.repair_turns, 1)
  assert.ok(elapsedMs >= 70 && elapsedMs < 2000, `expected breakout near stallDurationMs (~80ms), got ${elapsedMs}ms`)
  assert.equal(stopped, 1, 'must invoke stopExecution when continue turn stalls')
})
