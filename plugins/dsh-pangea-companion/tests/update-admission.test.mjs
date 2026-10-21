import assert from 'node:assert/strict'
import test from 'node:test'
import { companionUpdateBusy, guardUpdateMethods, registerUpdateParticipant } from '../src/update-admission.js'
import { createSourceFirstAcpRun, sourceFirstAcpUpdateBusy } from '../src/source-first-acp.js'

test('optional admission participant follows service activation and effect disposal', () => {
  let activate, check, cleanup, disposed = false
  const ctx = { inject(names, callback) { assert.deepEqual(names, ['pangeaUpdateAdmission']); activate = callback } }
  registerUpdateParticipant(ctx, 'companion', () => true)
  activate({
    get: () => ({ registerParticipant(id, callback) { assert.equal(id, 'companion'); check = callback; return () => { disposed = true } } }),
    effect(factory) { cleanup = factory() },
  })
  // The scope owns the effect; registration itself does not require a service at plugin startup.
  assert.equal(check(), true)
  assert.equal(disposed, false)
  cleanup()
  assert.equal(disposed, true)
})

test('direct guards preserve standalone return values and resolve a replaced admission service', async () => {
  let service, calls = 0, tracked = 0
  const ctx = { get: () => service }
  const target = { enqueue(value) { calls++; return value }, async start() { calls++; return 7 } }
  guardUpdateMethods(ctx, target, ['enqueue'], { synchronous: true })
  guardUpdateMethods(ctx, target, ['start'])
  assert.equal(target.enqueue(4), 4)
  assert.equal(await target.start(), 7)
  service = { assertOpen() { throw new Error('frozen') }, run() { throw new Error('frozen') } }
  assert.throws(() => target.enqueue(9), /frozen/)
  assert.throws(() => target.start(), /frozen/)
  assert.equal(calls, 2)
  service = { assertOpen() {}, async run(operation) { tracked++; return operation() } }
  assert.equal(await target.start(), 7)
  assert.equal(tracked, 1)
})

test('companion busy includes every in-flight task operation and SSH work', () => {
  const state = { operations: { launches: new Map(), stops: new Map(), deletions: new Map() }, launchLocks: new Set(),
    sourceFirstBusy: () => false, ssh: { jobs: new Map() } }
  assert.equal(companionUpdateBusy(state), false)
  for (const map of Object.values(state.operations)) {
    map.set('task', {})
    assert.equal(companionUpdateBusy(state), true)
    map.clear()
  }
  state.launchLocks.add('task'); assert.equal(companionUpdateBusy(state), true); state.launchLocks.clear()
  state.ssh.jobs.set('remote', { running: true }); assert.equal(companionUpdateBusy(state), true)
  state.ssh.jobs.get('remote').running = false; assert.equal(companionUpdateBusy(state), false)
  assert.equal(companionUpdateBusy({ ...state, sourceFirstBusy: () => true }), true)
})

test('source-first allows retained idle workers but rejects actual and unconfirmed activity', () => {
  let diagnostics = { activeToolCount: 0 }, pending = 0
  const state = { busy: false, closed: new Set(), workers: new Map([['worker', { id: 'worker', readDiagnostics: () => diagnostics }]]),
    pendingStarts: () => pending, blockedReconciliations: new Map() }
  const states = new Map([['run', state]])
  assert.equal(sourceFirstAcpUpdateBusy(states), false)
  diagnostics.activeToolCount = 1; assert.equal(sourceFirstAcpUpdateBusy(states), true)
  diagnostics = { lastToolStatus: 'in_progress' }; assert.equal(sourceFirstAcpUpdateBusy(states), true)
  diagnostics = { activeToolCount: 0 }; pending = 1; assert.equal(sourceFirstAcpUpdateBusy(states), true)
  pending = 0; state.busy = true; assert.equal(sourceFirstAcpUpdateBusy(states), true)
  state.busy = false; state.blockedReconciliations.set('worker', () => {}); assert.equal(sourceFirstAcpUpdateBusy(states), true)
})

test('direct source-first launch is rejected before creating coordinator state', () => {
  assert.throws(() => createSourceFirstAcpRun({ admission: { assertOpen() { throw new Error('frozen') } } }), /frozen/)
  assert.equal(sourceFirstAcpUpdateBusy(), false)
})
