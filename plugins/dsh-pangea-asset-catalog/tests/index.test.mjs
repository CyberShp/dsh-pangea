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
