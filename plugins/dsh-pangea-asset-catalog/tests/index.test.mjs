import assert from 'node:assert/strict'
import test from 'node:test'
import { Readable } from 'node:stream'

import { apply, extractionJobs, importAndExtract, listOptions } from '../src/index.js'
import { AssetExtractionQueue } from '../src/extraction-queue.js'

test('normalizes asset pagination filters for the public API', () => {
  assert.deepEqual(
    listOptions(new URLSearchParams('page=2&page_size=50&type=historical_defect&status=awaiting_review&kind=semantic&repository_id=repo-one&module_tag=dhcp&q=callback')),
    { page: 2, pageSize: 50, type: 'historical_defect', status: 'awaiting_review', kind: 'semantic', repositoryId: 'repo-one', moduleTag: 'dhcp', query: 'callback' },
  )
  assert.deepEqual(
    listOptions(new URLSearchParams('page=-1&page_size=999&type=bad&status=bad')),
    { page: 1, pageSize: 20, type: '', status: '', kind: '', repositoryId: '', moduleTag: '', query: '' },
  )
})

test('host registers asset APIs and methodology lifecycle listeners', async () => {
  const tools = []
  const routes = []
  const events = []
  let effectDescription = ''
  await apply({
    on(name) { events.push(name); return () => {} },
    tools: { register(tool) { tools.push(tool); return () => {} } },
    apiProxy: {},
    webServer: { register(route) { routes.push(route); return () => {} } },
    effect(factory, description) { effectDescription = description; return factory() },
  })
  assert.deepEqual(tools.map(tool => tool.name), ['pangea_assets_list'])
  assert.match(tools[0].description, /已导入资产/)
  assert.equal(routes.length, 1)
  assert.equal(routes[0].path, '/api/pangea-asset-catalog/state')
  assert.deepEqual(events, ['session/event', 'agent/status', 'agent/error'])
  assert.match(effectDescription, /PANGEA Asset Management 2\.0 API/)
})

test('semantic asset pagination excludes archived records before slicing', async () => {
  const { semanticAssetList } = await import('../src/index.js')
  const result = await semanticAssetList({ cwd: '/tmp', dataRoot: '/tmp/data',
    options: { page: 1, pageSize: 1, type: '', status: '', query: '' },
    runner: async ({ args }) => {
      assert.equal(args.includes('--exclude-archived'), false)
      return { items: [{ asset_id: 'old', status: 'archived' }, { asset_id: 'live', status: 'available' }], next_cursor: null }
    },
  })
  assert.equal(result.total, 1)
  assert.equal(result.items[0].asset_id, 'live')
  assert.equal(result.summary.available, 1)
})

test('asset actions follow declared capabilities independently of workflow version', async () => {
  const { assetFeatures } = await import('../src/index.js')
  const capabilities = { workflow_versions: ['source-first-v1'], asset_operations: { restore: true, metadata: true, preview: true } }
  assert.equal(assetFeatures(capabilities).restore, true)
  assert.equal(assetFeatures(capabilities).metadata, true)
  assert.equal(assetFeatures(capabilities).revisions, false)
  assert.equal(assetFeatures({ asset_operations: { restore: false } }).restore, false)
  assert.equal(assetFeatures({ workflow_versions: ['source-first-v1'] }).preview, false)
})

test('interrupted extraction appears in failed filter while preserving asset status', async () => {
  const { semanticAssetList } = await import('../src/index.js')
  const result = await semanticAssetList({ cwd: '/tmp', dataRoot: '/tmp/data',
    options: { page: 1, pageSize: 20, status: 'failed' },
    runtime: { job: () => ({ status: 'interrupted' }) },
    runner: async () => ({ items: [{ asset_id: 'working', status: 'extracting' }, { asset_id: 'archived', status: 'archived' }], next_cursor: null }),
  })
  assert.equal(result.total, 1)
  assert.equal(result.summary.failed, 1)
  assert.equal(result.items[0].asset_id, 'working')
  assert.equal(result.items[0].status, 'extracting')
})

test('lightweight progress is keyed by asset and reads queue state without starting Python', () => {
  const calls = []
  const jobs = { a: { status: 'running', output: 'A 日志' }, b: { status: 'waiting', output: '', queue_position: 1 } }
  const value = extractionJobs({ dataRoot: '/tmp/asset-job-test', assetIds: ['b', 'a', 'b'], runtime: {
    job() { throw new Error('the queue must take precedence') },
    queue: { job(root, id) { calls.push([root, id]); return jobs[id] } },
  } })
  assert.deepEqual(value, { status: 'ok', jobs: { b: jobs.b, a: jobs.a } })
  assert.equal(calls.length, 2)
  assert.throws(() => extractionJobs({ assetIds: Array(101).fill('a'), runtime: {} }), /100/)
  assert.throws(() => extractionJobs({ assetIds: [''], runtime: {} }), /有效资产编号/)
})

test('batch import returns after enqueue rather than waiting for a model start', async () => {
  const calls = []
  const asset = await importAndExtract({ cwd: '/fixture', dataRoot: '/fixture/data', sourcePath: '/input/design.md',
    body: { asset_type: 'design', provider_id: 'configured', agent_model: 'selected' },
    runner: async ({ args }) => { calls.push(args); return { asset: { asset_id: 'asset-1' } } },
    runtime: { start() { throw new Error('must enqueue') }, queue: { start(params) { calls.push(params); return { queued: true } } } },
  })
  assert.equal(asset.asset_id, 'asset-1')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].assetId, 'asset-1')
  assert.equal(calls[1].agentModel, 'selected')
})

test('retired Claude Code import is rejected before importing the file or enqueuing extraction', async () => {
  await assert.rejects(importAndExtract({
    cwd: '/fixture', dataRoot: '/fixture/data', sourcePath: '/input/design.md',
    body: { asset_type: 'design', provider_id: 'pangea-claude-code', agent_model: 'old-model' },
    runner() { assert.fail('must not import an asset for a retired executor') },
    runtime: { queue: { start() { assert.fail('must not enqueue extraction') } } },
  }), /Claude Code 支持已移除/)
})

test('retired Claude Code HTTP import and extraction reject before entering the persistent queue', async t => {
  const enqueue = t.mock.method(AssetExtractionQueue.prototype, 'enqueue', () => assert.fail('must not alter the saved queue'))
  let route, dispose
  await apply({
    on: () => () => {}, tools: { register: () => () => {} }, apiProxy: {},
    webServer: { register(value) { route = value; return () => {} } },
    effect(factory) { dispose = factory() },
  })
  t.after(() => dispose?.())
  for (const action of ['import', 'extract']) {
    const req = Readable.from([Buffer.from(JSON.stringify({ action, asset_id: 'saved-asset', asset_type: 'design',
      provider_id: 'pangea-claude-code', agent_model: 'old-model', restart: true }))])
    req.method = 'POST'
    req.url = '/api/pangea-asset-catalog/state?cwd=/fixture&data_root=/fixture/data'
    req.headers = { 'sec-fetch-site': 'same-origin' }
    const response = {}
    await route.handler(req, { writeHead(status) { response.status = status }, end(body) { response.body = JSON.parse(body) } })
    assert.equal(response.status, 400)
    assert.match(response.body.error, /Claude Code 支持已移除/)
  }
  assert.equal(enqueue.mock.callCount(), 0)
})
