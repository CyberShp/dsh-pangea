import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, listOptions } from '../src/index.js'

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
  assert.deepEqual(events, ['agent/status', 'agent/error'])
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
