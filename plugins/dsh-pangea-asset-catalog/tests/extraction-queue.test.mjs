import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AssetExtractionQueue } from '../src/extraction-queue.js'

const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-asset-queue-'))
  const jobs = new Map(), starts = [], stops = []
  const key = (dataRoot, assetId) => `${path.resolve(dataRoot)}\n${assetId}`
  const runtime = {
    job(dataRoot, assetId) { return jobs.get(key(dataRoot, assetId)) ?? null },
    async start(params) { starts.push(params); jobs.set(key(params.dataRoot, params.assetId), { status: 'running', history: [] }); return { completed: false } },
    async stop(params) { stops.push(params); jobs.set(key(params.dataRoot, params.assetId), { status: 'stopped', history: [] }); return { stopped: true } },
  }
  const queue = new AssetExtractionQueue(runtime, { pollIntervalMs: 10, ...options })
  t.after(async () => { queue.dispose(); await rm(root, { recursive: true, force: true }) })
  return { root, runtime, queue, starts, stops, jobs, key,
    params: (assetId, extra = {}) => ({ cwd: root, dataRoot: root, assetId, ...extra }),
    finish: (assetId, status = 'completed', dataRoot = root) => jobs.set(key(dataRoot, assetId), { status, history: [] }) }
}

test('enqueue returns immediately and one global queue limits all data roots to two live extractions', async t => {
  const { root, queue, starts, params, finish } = await fixture(t)
  assert.equal(queue.enqueue(params('a')).extraction_job.status, 'waiting')
  queue.enqueue(params('b', { dataRoot: path.join(root, 'other') }))
  const waiting = queue.enqueue(params('c')).extraction_job
  assert.equal(waiting.queue_position, 3)
  assert.equal(starts.length, 0)
  await tick()
  assert.deepEqual(starts.map(x => x.assetId), ['a', 'b'])
  assert.equal(queue.job(root, 'c').queue_position, 1)
  await tick()
  assert.equal(starts.length, 2, 'start() resolving is not completion')
  finish('a')
  queue.schedule()
  await tick()
  assert.deepEqual(starts.map(x => x.assetId), ['a', 'b', 'c'])
})

test('internal model jobs release their slot by polling even without an external done promise', async t => {
  const { queue, starts, params, finish } = await fixture(t, { concurrency: 1 })
  queue.enqueue(params('internal'))
  queue.enqueue(params('next'))
  await tick()
  finish('internal')
  await new Promise(resolve => setTimeout(resolve, 35))
  assert.deepEqual(starts.map(x => x.assetId), ['internal', 'next'])
})

test('pending retry overlays old completed results and duplicate restart preserves the first request', async t => {
  const { root, queue, starts, params, jobs, key } = await fixture(t, { concurrency: 1 })
  queue.enqueue(params('blocker'))
  await tick()
  jobs.set(key(root, 'a'), { status: 'completed', output: 'previous', history: [] })
  queue.enqueue(params('a', { providerId: 'first', restart: true }))
  const duplicate = queue.enqueue(params('a', { providerId: 'replacement', restart: true }))
  assert.equal(duplicate.reused, true)
  assert.equal(queue.job(root, 'a').status, 'waiting')
  await queue.stop(params('blocker'))
  await tick()
  assert.deepEqual(starts.map(x => x.assetId), ['blocker', 'a'])
  assert.equal(starts[1].providerId, 'first')
  assert.equal(queue.enqueue(params('a', { restart: true })).reused, true)
  assert.equal(starts.length, 2)
})

test('cancelling pending work never starts or stops a worker and shifts following queue positions', async t => {
  const { root, queue, starts, stops, params } = await fixture(t, { concurrency: 1 })
  queue.enqueue(params('a')); queue.enqueue(params('b')); queue.enqueue(params('c'))
  await tick()
  const result = await queue.stop(params('b'))
  assert.equal(result.job.status, 'stopped')
  assert.equal(stops.length, 0)
  assert.equal(queue.job(root, 'c').queue_position, 1)
  await queue.stop(params('a'))
  await tick()
  assert.deepEqual(starts.map(x => x.assetId), ['a', 'c'])
})

test('stop before the scheduled drain cancels even the first pending task', async t => {
  const { queue, starts, stops, params } = await fixture(t)
  queue.enqueue(params('a'))
  await queue.stop(params('a'))
  await tick()
  assert.equal(starts.length, 0)
  assert.equal(stops.length, 0)
})

test('an early start failure does not stall later work', async t => {
  const { root, runtime, queue, starts, params } = await fixture(t, { concurrency: 1 })
  const start = runtime.start.bind(runtime)
  runtime.start = input => { if (input.assetId === 'bad') throw new Error('executor unavailable'); return start(input) }
  queue.enqueue(params('bad')); queue.enqueue(params('good'))
  await tick()
  assert.equal(queue.job(root, 'bad').status, 'failed')
  assert.match(queue.job(root, 'bad').error, /executor unavailable/)
  assert.deepEqual(starts.map(x => x.assetId), ['good'])
})

test('stop cannot free a slot while asynchronous start is still pending', async t => {
  const { runtime, queue, starts, params } = await fixture(t, { concurrency: 1 })
  const pending = deferred(), start = runtime.start.bind(runtime)
  runtime.start = async input => { await start(input); if (input.assetId === 'a') await pending.promise; return { completed: false } }
  queue.enqueue(params('a')); queue.enqueue(params('b'))
  await tick()
  await queue.stop(params('a'))
  await tick()
  assert.deepEqual(starts.map(x => x.assetId), ['a'])
  assert.equal(queue.enqueue(params('a', { restart: true })).reused, true)
  pending.resolve()
  await tick()
  assert.deepEqual(starts.map(x => x.assetId), ['a', 'b'])
})

test('failed stop keeps its slot even if cancellation reports a terminal-looking failure; a retry releases it', async t => {
  const { root, runtime, queue, starts, params, finish } = await fixture(t, { concurrency: 1 })
  queue.enqueue(params('a')); queue.enqueue(params('b'))
  await tick()
  const stop = runtime.stop.bind(runtime)
  runtime.stop = () => { finish('a', 'failed'); throw new Error('process still running') }
  await assert.rejects(queue.stop(params('a')), /process still running/)
  queue.schedule(); await tick()
  assert.deepEqual(starts.map(x => x.assetId), ['a'])
  assert.equal(queue.job(root, 'a').stop_error, 'process still running')
  runtime.stop = stop
  await queue.stop(params('a'))
  await tick()
  assert.deepEqual(starts.map(x => x.assetId), ['a', 'b'])
})

test('simultaneous stop requests delegate only once', async t => {
  const { runtime, queue, stops, params } = await fixture(t)
  queue.enqueue(params('a')); await tick()
  const pending = deferred(), stop = runtime.stop.bind(runtime)
  runtime.stop = async input => { await pending.promise; return stop(input) }
  const first = queue.stop(params('a')), second = queue.stop(params('a'))
  await tick()
  pending.resolve()
  await Promise.all([first, second])
  assert.equal(stops.length, 1)
})

test('waiting requests survive recreation as interrupted and cancellation history survives a later start', async t => {
  const { root, runtime, queue, starts, params, jobs, key } = await fixture(t, { concurrency: 1 })
  queue.enqueue(params('blocker')); await tick()
  jobs.set(key(root, 'a'), { status: 'completed', history: [] })
  queue.enqueue(params('a', { credentials: 'SECRET', model: { provider: 'test', apiKey: 'SECRET' } }))
  queue.dispose()
  const restarted = new AssetExtractionQueue(runtime, { concurrency: 1 })
  t.after(() => restarted.dispose())
  assert.equal(restarted.job(root, 'a').status, 'interrupted', 'old completed job must not mask the lost queue request')
  assert.equal(starts.length, 1, 'a recreated queue does not resume extraction automatically')
  const file = await readFile(restarted.recordPath(root, 'a'), 'utf8')
  assert.doesNotMatch(file, /SECRET|credentials|apiKey/)
  await restarted.stop(params('a'))
  assert.equal(restarted.job(root, 'a').status, 'stopped')
  restarted.enqueue(params('a', { restart: true }))
  await tick()
  assert.ok(restarted.job(root, 'a').history.some(job => job.status === 'stopped'))
})

test('a deterministic completion without a retained runtime job releases capacity', async t => {
  const { runtime, queue, starts, params } = await fixture(t, { concurrency: 1 })
  const start = runtime.start.bind(runtime)
  runtime.start = async input => input.assetId === 'done' ? { completed: true } : start(input)
  queue.enqueue(params('done')); queue.enqueue(params('next'))
  await tick()
  assert.deepEqual(starts.map(x => x.assetId), ['next'])
})

test('an unreadable job after a start failure cannot prematurely free its slot', async t => {
  const { runtime, queue, starts, params } = await fixture(t, { concurrency: 1 })
  const start = runtime.start.bind(runtime), job = runtime.job.bind(runtime)
  let unreadable = false
  runtime.start = input => {
    if (input.assetId !== 'a') return start(input)
    unreadable = true
    throw new Error('partial startup failure')
  }
  runtime.job = (dataRoot, assetId) => {
    if (unreadable && assetId === 'a') throw new Error('temporarily unreadable')
    return job(dataRoot, assetId)
  }
  queue.enqueue(params('a')); queue.enqueue(params('b'))
  await tick()
  assert.equal(starts.length, 0)
  unreadable = false
  queue.schedule(); await tick()
  assert.deepEqual(starts.map(x => x.assetId), ['b'])
})

test('runtime startup failures keep their processing output and later successful stop updates the visible state', async t => {
  const { root, runtime, queue, jobs, key, params } = await fixture(t)
  runtime.start = input => {
    jobs.set(key(input.dataRoot, input.assetId), { status: 'failed', output: 'provider diagnostic', error: 'runtime failure', history: [] })
    throw new Error('runtime failure')
  }
  queue.enqueue(params('a')); await tick()
  assert.equal(queue.job(root, 'a').output, 'provider diagnostic')
  await queue.stop(params('a'))
  assert.equal(queue.job(root, 'a').status, 'stopped')
  runtime.start = () => { throw new Error('early failure') }
  queue.enqueue(params('b')); await tick()
  assert.equal(queue.job(root, 'b').status, 'failed')
  await queue.stop(params('b'))
  assert.equal(queue.job(root, 'b').status, 'stopped', 'a queue-only startup failure must not mask a successful later stop')
})

test('queue cancellation history stays flat across repeated cancel and enqueue attempts', async t => {
  const { root, queue, params } = await fixture(t)
  for (let i = 0; i < 4; i++) {
    queue.enqueue(params('a'))
    await queue.stop(params('a'))
  }
  assert.equal(queue.job(root, 'a').history.length, 3)
  assert.ok(queue.job(root, 'a').history.every(item => item.history === undefined))
})

test('archive blocks new extraction throughout stop and persistence, and restore unlocks it', async t => {
  const { runtime, queue, params } = await fixture(t)
  queue.enqueue(params('a')); await tick()
  const stopping = deferred(), archiving = deferred(), stop = runtime.stop.bind(runtime)
  runtime.stop = async input => { await stopping.promise; return stop(input) }
  let calls = 0
  const removal = queue.archive(params('a'), async () => { calls++; await archiving.promise; return { archived: true } })
  assert.throws(() => queue.enqueue(params('a')), /正在删除/)
  await tick()
  assert.equal(calls, 0)
  stopping.resolve(); await tick()
  assert.equal(calls, 1)
  assert.throws(() => queue.enqueue(params('a')), /正在删除/)
  archiving.resolve(); await removal
  assert.throws(() => queue.enqueue(params('a')), /已删除/)
  queue.restored(params('a'))
  assert.equal(queue.enqueue(params('a')).extraction_job.status, 'waiting')
})

test('archive failure allows retry, while a failed stop prevents archive and retains the running slot', async t => {
  const { runtime, queue, starts, params } = await fixture(t, { concurrency: 1 })
  queue.enqueue(params('a')); queue.enqueue(params('b')); await tick()
  const stop = runtime.stop.bind(runtime)
  runtime.stop = () => { throw new Error('stop failed') }
  let archives = 0
  await assert.rejects(queue.archive(params('a'), async () => { archives++ }), /stop failed/)
  await tick()
  assert.equal(archives, 0)
  assert.deepEqual(starts.map(x => x.assetId), ['a'])
  assert.equal(queue.enqueue(params('a')).reused, true)
  runtime.stop = stop
  await assert.rejects(queue.archive(params('a'), async () => { throw new Error('archive failed') }), /archive failed/)
  assert.equal(queue.enqueue(params('a', { restart: true })).extraction_job.status, 'waiting')
})
