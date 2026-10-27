import assert from 'node:assert/strict'
import test from 'node:test'
import { waitForAcpTurn, AcpStalled, continuationNotIdleError, hasUnconfirmedAcpTools } from '../src/acp-progress.js'
const policy = { readyWarnMs: 10, readyIdleMs: 30, warnMs: 10, idleMs: 30, cancelMs: 15, pollMs: 2 }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const signal = () => new AbortController().signal

test('unclosed tool lifecycle blocks idle admission even when activeToolCount is zero', () => {
  assert.equal(hasUnconfirmedAcpTools({ activeToolCount: 0, toolLifecycle: { unclosed_count: 1 } }), true)
  assert.equal(hasUnconfirmedAcpTools({ activeToolCount: 0, toolLifecycle: { unclosed_count: 0 } }), false)
  assert.equal(hasUnconfirmedAcpTools({ activeToolCount: 2 }), true)
  assert.equal(hasUnconfirmedAcpTools({ lastToolStatus: 'pending' }), true)
  assert.equal(hasUnconfirmedAcpTools({ activeToolCount: 0, lastToolStatus: 'pending' }), false)
})

test('continuationNotIdleError recognizes Desktop admission rejections', () => {
  assert.equal(continuationNotIdleError({ code: 'ACP_CONTINUATION_NOT_IDLE' }), true)
  assert.equal(continuationNotIdleError(new Error('ACP turn is not idle for continuation; 1 tool(s) still lack a terminal status')), true)
  assert.equal(continuationNotIdleError(new Error('network reset')), false)
})

test('readiness text without a protocol return cannot release the request', async () => {
  const turn = deferred(), events = []
  const worker = { readDiagnostics: () => ({ messageChunks: 1 }), cancelTurn: () => new Promise(() => {}) }
  await assert.rejects(waitForAcpTurn({ worker, turn: turn.promise, signal: signal(), ready: true, policy, emit: async e => events.push(e) }), e => e instanceof AcpStalled && !e.confirmed)
  assert.ok(events.some(e => e.stage === 'source_first_waiting'))
  assert.ok(!events.some(e => e.stage === 'source_first_cancel_confirmed'))
})
for (const activeToolCount of [0, 1]) test(`cancel response with ${activeToolCount} active tools`, async () => {
  const turn = deferred()
  const worker = { readDiagnostics: () => ({ activeToolCount }), cancelTurn: async () => {
    const outcome = { stopReason: 'aborted', protocolStopReason: 'cancelled' }; turn.resolve(outcome); return { confirmed: true, outcome }
  } }
  await assert.rejects(waitForAcpTurn({ worker, turn: turn.promise, signal: signal(), policy }), e => e.confirmed === !activeToolCount)
})
test('late successful result wins over recovery', async () => {
  const turn = deferred(), outcome = { stopReason: 'completed', protocolStopReason: 'end_turn' }
  const worker = { cancelTurn: async () => { turn.resolve(outcome); return { confirmed: true, outcome } } }
  assert.equal(await waitForAcpTurn({ worker, turn: turn.promise, signal: signal(), policy }), outcome)
})
test('activity including compaction refreshes idle time without reading text', async () => {
  const turn = deferred(); let activity = 0, cancels = 0
  const worker = { readDiagnostics: () => ({ lastActivityAt: activity }), cancelTurn: () => { cancels++ } }
  const interval = setInterval(() => activity++, 5)
  const end = setTimeout(() => turn.resolve({ stopReason: 'completed' }), 80)
  try { assert.equal((await waitForAcpTurn({ worker, turn: turn.promise, signal: signal(), policy })).stopReason, 'completed'); assert.equal(cancels, 0) }
  finally { clearInterval(interval); clearTimeout(end) }
})
test('user stop interrupts cancellation wait', async () => {
  const controller = new AbortController()
  const worker = { cancelTurn: async () => { controller.abort(new Error('user stop')); return new Promise(() => {}) } }
  await assert.rejects(waitForAcpTurn({ worker, turn: new Promise(() => {}), signal: controller.signal, policy }), /user stop/)
})
