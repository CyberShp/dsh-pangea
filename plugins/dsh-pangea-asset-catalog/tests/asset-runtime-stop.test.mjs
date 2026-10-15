import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import test from 'node:test'
import { AssetActionRuntime, dataRootFor } from '../src/pangea-api.js'

const ok = value => ({ result: { ok: true, value } })
const tick = () => new Promise(resolve => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function fixture() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'asset-stop-'))
  await mkdir(path.join(cwd, '.agents', 'pangea'), { recursive: true })
  await writeFile(path.join(cwd, '.agents', 'pangea', 'dsh.md'), 'rules')
  const calls = [], cancellations = []
  const api = {
    llm: { providers: async () => ok({ providers: [{ provider: 'configured', declared: true, active: true }] }),
      models: async () => ok({ groups: [{ id: 'configured', models: [{ id: 'model' }] }] }) },
    settings: { describe: async () => ok({ namespaces: [] }) },
    sessions: { create: async () => ok({ sessionId: 'session' }), rename: async () => ok({}), selectModel: async () => ok({}),
      prompt: async () => ok({}), cancel: async request => { cancellations.push(request.payload.sessionId); return ok({}) } },
  }
  const prepared = { asset: { asset_id: 'a', asset_type: 'design', status: 'extracting' },
    action: { action_id: 'asset:a:extract:1', task_path: '/task.json' } }
  const runner = async ({ args }) => {
    calls.push(args)
    if (args[0] === 'assets' && args[1] === 'extract') return prepared
    if (args[0] === 'assets' && args[1] === 'stop') return { asset_id: 'a', status: 'imported' }
    return { asset: { asset_id: 'a', status: 'available' } }
  }
  const request = { cwd, assetId: 'a', model: { provider: 'configured', model: 'model' } }
  return { cwd, api, runner, calls, cancellations, prepared, request, cleanup: () => rm(cwd, { recursive: true, force: true }) }
}

test('stop cancels the bound internal session and ignores late idle, error and result events', async () => {
  const f = await fixture(), runtime = new AssetActionRuntime(f.api, f.runner)
  try {
    await runtime.start(f.request)
    runtime.handleAgentStatus({ session: { id: 'session' } }, 'running')
    const stopped = await runtime.stop(f.request)
    assert.equal(stopped.stopped, true)
    assert.deepEqual(f.cancellations, ['session'])
    assert.ok(f.calls.find(args => args[1] === 'stop').includes('asset:a:extract:1'))
    runtime.handleAgentStatus({ session: { id: 'session' } }, 'idle')
    runtime.handleAgentError({ session: { id: 'session' } }, new Error('late error'))
    runtime.handleSessionEvent({ id: 'session' }, { type: 'assistant/message', data: { message: { content: 'late output' } } })
    await tick()
    assert.equal(f.calls.filter(args => args[1] === 'settle').length, 0)
    assert.equal(runtime.job(dataRootFor(f.cwd), 'a').status, 'stopped')
    assert.doesNotMatch(runtime.job(dataRootFor(f.cwd), 'a').output, /late/)
    const recovered = new AssetActionRuntime({}).job(dataRootFor(f.cwd), 'a')
    assert.equal(recovered.status, 'stopped')
  } finally { await f.cleanup() }
})

test('stop cancels an internal session before waiting for a blocked prompt response', async () => {
  const f = await fixture(), prompt = deferred()
  f.api.sessions.prompt = () => prompt.promise
  f.api.sessions.cancel = async request => { f.cancellations.push(request.payload.sessionId); prompt.resolve(ok({})); return ok({}) }
  const runtime = new AssetActionRuntime(f.api, f.runner)
  try {
    const started = runtime.start(f.request)
    const rejected = assert.rejects(started, /用户停止/)
    await tick()
    await runtime.stop(f.request)
    await rejected
    assert.deepEqual(f.cancellations, ['session'])
    assert.equal(runtime.job(dataRootFor(f.cwd), 'a').status, 'stopped')
  } finally { await f.cleanup() }
})

test('stop during preparation waits for the prepare boundary and never launches a session', async () => {
  const f = await fixture(), preparation = deferred()
  let created = false
  f.api.sessions.create = async () => { created = true; return ok({ sessionId: 'session' }) }
  const runtime = new AssetActionRuntime(f.api, async input => input.args[1] === 'extract' ? preparation.promise : f.runner(input))
  try {
    const started = runtime.start(f.request), rejected = assert.rejects(started, /用户停止/)
    await tick()
    const stopping = runtime.stop(f.request)
    assert.equal(f.calls.length, 0, 'durable stop cannot race ahead of prepare')
    preparation.resolve(f.prepared)
    await stopping; await rejected
    assert.equal(created, false)
    assert.equal(f.calls[0][1], 'stop')
  } finally { await f.cleanup() }
})

for (const stage of ['startup', 'ready', 'extracting']) {
  test(`external stop during ${stage} aborts and disposes without a late settle`, async () => {
    const f = await fixture(), launch = deferred(), ready = deferred(), extraction = deferred()
    let signal, disposed = 0, prompts = 0
    const worker = { id: 'worker', result: ready.promise, readOutput: () => '',
      continuePrompt: async () => { prompts++; return extraction.promise }, dispose: async () => { disposed++ } }
    const runtime = new AssetActionRuntime(f.api, f.runner, { agents: { get: id => ({ id }) }, subagents: {
      getProvider: () => ({}), start: async (_id, request) => { signal = request.signal; return launch.promise },
    } })
    try {
      await runtime.start({ ...f.request, providerId: 'pangea-codeagent' })
      if (stage !== 'startup') launch.resolve(worker)
      await tick()
      if (stage === 'extracting') { ready.resolve({ stopReason: 'completed' }); await tick() }
      const stopping = runtime.stop(f.request)
      if (stage === 'startup') launch.resolve(worker)
      await stopping
      ready.resolve({ stopReason: 'completed' }); extraction.resolve({ stopReason: 'completed' })
      await tick()
      assert.equal(signal.aborted, true)
      assert.equal(disposed, 1)
      assert.equal(prompts, stage === 'extracting' ? 1 : 0)
      assert.equal(f.calls.filter(args => args[1] === 'settle').length, 0)
      assert.equal(runtime.job(dataRootFor(f.cwd), 'a').status, 'stopped')
    } finally { await f.cleanup() }
  })
}

test('unconfirmed cancellation stays stopping, blocks duplicate start, and supports retry', async () => {
  const f = await fixture(), runtime = new AssetActionRuntime(f.api, f.runner)
  try {
    await runtime.start(f.request)
    f.api.sessions.cancel = async () => { throw new Error('transport failure') }
    await assert.rejects(runtime.stop(f.request), /停止尚未确认/)
    assert.equal(runtime.job(dataRootFor(f.cwd), 'a').status, 'stopping')
    assert.equal((await runtime.start(f.request)).reused, true)
    f.api.sessions.cancel = async () => ok({})
    await runtime.stop(f.request)
    assert.equal(runtime.job(dataRootFor(f.cwd), 'a').status, 'stopped')
  } finally { await f.cleanup() }
})

test('internal cancellation waits for the live agent driver to become idle', async () => {
  const f = await fixture(), idle = deferred()
  const runtime = new AssetActionRuntime(f.api, f.runner, { agents: { get: () => ({ whenIdle: () => idle.promise }) } })
  try {
    await runtime.start(f.request)
    const stopping = runtime.stop(f.request)
    await tick()
    assert.equal(f.cancellations.length, 1)
    assert.equal(runtime.job(dataRootFor(f.cwd), 'a').status, 'stopping')
    idle.resolve()
    await stopping
    assert.equal(runtime.job(dataRootFor(f.cwd), 'a').status, 'stopped')
  } finally { await f.cleanup() }
})

test('a settle that committed before stop is reported as completed', async () => {
  const f = await fixture(), settle = deferred()
  const runtime = new AssetActionRuntime(f.api, async input => {
    if (input.args[1] === 'settle') return settle.promise
    if (input.args[1] === 'stop') return { asset_id: 'a', status: 'available' }
    return f.runner(input)
  })
  try {
    await runtime.start(f.request)
    runtime.handleAgentStatus({ session: { id: 'session' } }, 'running')
    runtime.handleAgentStatus({ session: { id: 'session' } }, 'idle')
    await tick()
    const stopping = runtime.stop(f.request)
    settle.resolve({ asset: { asset_id: 'a', status: 'available' } })
    const result = await stopping
    assert.equal(result.completed, true)
    assert.equal(result.stopped, false)
    assert.equal(result.job.status, 'completed')
  } finally { await f.cleanup() }
})

test('streamed text is visible before the final message, reasoning is activity only, and polling is read-only', async () => {
  const f = await fixture(), runtime = new AssetActionRuntime(f.api, f.runner)
  try {
    await runtime.start(f.request)
    const stream = chunk => runtime.handleSessionEvent({ id: 'session' }, { type: 'assistant/chunk', data: { turn: 0, step: 0, chunk } })
    stream({ type: 'reasoning-delta', text: 'private reasoning' })
    stream({ type: 'text-delta', text: '正在读取' })
    let value = runtime.job(dataRootFor(f.cwd), 'a')
    assert.equal(value.output, '正在读取')
    assert.equal(value.phase, 'extracting')
    assert.equal(value.diagnostics.messageChunks, 2)
    runtime.handleSessionEvent({ id: 'session' }, { type: 'assistant/message', data: { message: { content: '正在读取' } } })
    assert.equal(runtime.job(dataRootFor(f.cwd), 'a').output, '正在读取\n')
    let writes = 0
    const persist = runtime.persist.bind(runtime)
    runtime.persist = job => { writes++; return persist(job) }
    runtime.job(dataRootFor(f.cwd), 'a')
    writes = 0
    for (let i = 0; i < 10; i++) runtime.job(dataRootFor(f.cwd), 'a')
    assert.equal(writes, 0)
    await runtime.stop(f.request)
  } finally { await f.cleanup() }
})

test('elapsed time changes do not masquerade as worker activity', async () => {
  const f = await fixture(), runtime = new AssetActionRuntime(f.api, f.runner)
  try {
    const job = { cwd: f.cwd, dataRoot: dataRootFor(f.cwd), assetId: 'a', status: 'running', startedAt: new Date(Date.now() - 300000).toISOString(),
      lastActivityAt: new Date(Date.now() - 240000).toISOString(), diagnostics: { toolCalls: 1 },
      worker: { readOutput: () => '', readDiagnostics: () => ({ toolCalls: 1, turnDurationMs: Math.random() * 10000 }) } }
    runtime.jobs.set(`${dataRootFor(f.cwd)}\na`, job)
    const before = job.lastActivityAt
    const value = runtime.job(dataRootFor(f.cwd), 'a')
    assert.equal(job.lastActivityAt, before)
    assert.ok(value.idle_ms >= 240000)
    assert.match(value.warning, /未收到新的执行事件/)
  } finally { await f.cleanup() }
})

test('a stopped external asset can be extracted again with a fresh cancellation signal', async () => {
  const f = await fixture(), signals = []
  const runtime = new AssetActionRuntime(f.api, f.runner, { agents: { get: id => ({ id }) }, subagents: {
    getProvider: () => ({}), start: async (_id, request) => {
      signals.push(request.signal)
      return { id: `worker-${signals.length}`, result: new Promise(() => {}), continuePrompt: async () => assert.fail('still initializing'), dispose: async () => {} }
    },
  } })
  try {
    const request = { ...f.request, providerId: 'pangea-codeagent' }
    await runtime.start(request); await tick(); await runtime.stop(request)
    await runtime.start(request); await tick()
    assert.equal(signals.length, 2)
    assert.equal(signals[0].aborted, true)
    assert.equal(signals[1].aborted, false)
    await runtime.stop(request)
  } finally { await f.cleanup() }
})

test('a recovered internal job cancels its exact saved session but an unowned external process is not claimed stopped', async () => {
  for (const external of [false, true]) {
    const f = await fixture()
    try {
      new AssetActionRuntime({}).persist({ cwd: f.cwd, dataRoot: dataRootFor(f.cwd), assetId: 'a', status: 'running',
        sessionId: 'exact-worker', ownerSessionId: 'owner', providerId: external ? 'pangea-codeagent' : '', startedAt: new Date().toISOString() })
      const runtime = new AssetActionRuntime(f.api, f.runner)
      if (external) {
        await assert.rejects(runtime.stop(f.request), /原外部执行器句柄不可用/)
        assert.equal(runtime.job(dataRootFor(f.cwd), 'a').status, 'stopping')
      } else {
        await runtime.stop(f.request)
        assert.deepEqual(f.cancellations, ['exact-worker'])
      }
      assert.equal(f.calls[0][1], 'stop')
    } finally { await f.cleanup() }
  }
})

test('late callbacks cannot fail finalization or overwrite a newer attempt on disk', async () => {
  const f = await fixture(), settle = deferred()
  const runtime = new AssetActionRuntime(f.api, async input => input.args[1] === 'settle' ? settle.promise : f.runner(input))
  try {
    await runtime.start(f.request)
    const old = [...runtime.jobs.values()][0]
    old.status = 'running'
    const finished = runtime.finish(old)
    await tick()
    runtime.handleAgentError({ session: { id: 'session' } }, new Error('late transport error'))
    assert.equal(old.status, 'finalizing')
    assert.equal((await runtime.start(f.request)).reused, true)
    // Also exercise the generation fence if a future recovery path installs a
    // replacement while an old promise is still settling.
    const replacement = { ...old, status: 'queued', output: 'new attempt', phase: 'queued', events: [], commandPending: null }
    runtime.jobs.set(`${dataRootFor(f.cwd)}\na`, replacement)
    runtime.persist(replacement)
    settle.resolve({ asset: { asset_id: 'a', status: 'available' } })
    await finished
    runtime.record(old, 'old callback')
    assert.equal(runtime.saved(dataRootFor(f.cwd), 'a').status, 'queued')
    assert.equal(runtime.saved(dataRootFor(f.cwd), 'a').output, 'new attempt')
    clearInterval(old.timer)
  } finally { await f.cleanup() }
})
