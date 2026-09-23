import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createSourceFirstAcpRun } from '../src/source-first-acp.js'
const progressPolicy = { readyWarnMs: 5, readyIdleMs: 20, warnMs: 5, idleMs: 20, cancelMs: 10, pollMs: 2 }
const completed = { stopReason: 'completed', protocolStopReason: 'end_turn' }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

for (const mode of ['recover', 'saved', 'twice', 'unconfirmed', 'ready', 'disconnect']) test(`coordinator ${mode} preserves identity and results`, async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'acp-recovery-'))
  const controller = new AbortController(), events = [], prompts = []
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
  const options = { dataRoot, runId: 'run', cwd: dataRoot, providerId: 'pangea-nga', signal: controller.signal, progressPolicy,
    onEvent: async e => events.push(e), subagents: { start: async (_, request) => {
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
  } finally { controller.abort(); pending.resolve(completed); await run.dispose(); await rm(dataRoot, { recursive: true, force: true }) }
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
