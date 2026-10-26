import assert from 'node:assert/strict'
import test from 'node:test'
import { assetCatalogUpdateBusy, installAssetUpdateAdmission } from '../src/update-admission.js'

function runtime() {
  return { jobs: new Map(), async start() { return 'started' },
    queue: { pending: [], active: new Map(), archiving: new Map(), enqueue(value) { this.pending.push({ state: 'waiting' }); return value } },
    methodologies: { jobs: new Map(), async start() { return 'methodology' } } }
}

test('asset participant sees queued work, preparation, cleanup, archive and methodology without a running session', () => {
  const value = runtime()
  assert.equal(assetCatalogUpdateBusy(value), false)
  value.queue.pending.push({ state: 'waiting' }); assert.equal(assetCatalogUpdateBusy(value), true)
  value.queue.pending[0].state = 'stopped'; assert.equal(assetCatalogUpdateBusy(value), false)
  for (const map of [value.queue.active, value.queue.archiving]) {
    map.set('asset', {}); assert.equal(assetCatalogUpdateBusy(value), true); map.clear()
  }
  for (const status of ['preparing', 'queued', 'running', 'repairing', 'finalizing', 'stopping']) {
    value.jobs.set('asset', { status }); assert.equal(assetCatalogUpdateBusy(value), true)
  }
  value.jobs.set('asset', { status: 'completed' }); assert.equal(assetCatalogUpdateBusy(value), false)
  value.jobs.set('asset', { status: 'failed', commandPending: true }); assert.equal(assetCatalogUpdateBusy(value), true)
  value.jobs.set('asset', { status: 'failed', cleanupPending: true }); assert.equal(assetCatalogUpdateBusy(value), true)
  value.jobs.get('asset').cleanupConfirmed = true; assert.equal(assetCatalogUpdateBusy(value), false)
  value.methodologies.jobs.set('methodology', { status: 'finalizing' }); assert.equal(assetCatalogUpdateBusy(value), true)
  value.methodologies.jobs.get('methodology').status = 'completed'; assert.equal(assetCatalogUpdateBusy(value), false)
})

test('asset direct admission blocks before enqueue and tracks asynchronous starts', async () => {
  let frozen = false, inFlight = 0, participant
  const gate = {
    assertOpen() { if (frozen) throw new Error('frozen') },
    async run(callback) { this.assertOpen(); inFlight++; try { return await callback() } finally { inFlight-- } },
    registerParticipant(id, callback) { assert.equal(id, 'asset-catalog'); participant = callback; return () => {} },
  }
  const value = runtime()
  let finish
  value.start = () => new Promise(resolve => { finish = resolve })
  installAssetUpdateAdmission({ get: () => gate, effect: factory => factory() }, value)
  assert.equal(participant(), false)
  const started = value.start()
  assert.equal(inFlight, 1)
  finish(); await started; assert.equal(inFlight, 0)
  assert.equal(value.queue.enqueue('queued'), 'queued')
  assert.equal(participant(), true)
  frozen = true
  assert.throws(() => value.queue.enqueue('rejected'), /frozen/)
  await assert.rejects(value.start(), /frozen/)
  await assert.rejects(value.methodologies.start(), /frozen/)
  assert.equal(value.queue.pending.length, 1)
})

test('standalone asset plugin runs without Desktop admission service', async () => {
  const value = runtime()
  installAssetUpdateAdmission({}, value)
  assert.equal(value.queue.enqueue(8), 8)
  assert.equal(await value.start(), 'started')
  assert.equal(await value.methodologies.start(), 'methodology')
})

test('force upgrade cancels waiting assets before stopping active jobs and methodologies', async () => {
  const value = runtime(), order = []
  let stop
  value.queue.pending = [{ state: 'waiting', params: { assetId: 'queued' } }]
  value.queue.stop = async params => { order.push(params.assetId); if (params.assetId === 'queued') value.queue.pending[0].state = 'terminal' }
  value.queue.schedule = () => order.push('schedule')
  value.jobs.set('active', { status: 'running', cwd: '/tmp', dataRoot: '/tmp', assetId: 'active' })
  value.methodologies.stopForUpdate = async () => order.push('methodology')
  installAssetUpdateAdmission({ get: () => ({ registerParticipant(_id, _check, callback) { stop = callback } }) }, value)
  await stop()
  assert.deepEqual(order, ['queued', 'active', 'methodology', 'schedule'])
})
