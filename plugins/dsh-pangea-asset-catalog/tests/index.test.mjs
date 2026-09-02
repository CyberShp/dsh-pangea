import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, listOptions } from '../src/index.js'

test('normalizes asset pagination filters for the public API', () => {
  assert.deepEqual(
    listOptions(new URLSearchParams('page=2&page_size=50&type=historical_defect&status=awaiting_review&q=callback')),
    { page: 2, pageSize: 50, type: 'historical_defect', status: 'awaiting_review', query: 'callback' },
  )
  assert.deepEqual(
    listOptions(new URLSearchParams('page=-1&page_size=999&type=bad&status=bad')),
    { page: 1, pageSize: 20, type: '', status: '', query: '' },
  )
})

test('host registers the asset catalog tool and same-origin page route without agent listeners', async () => {
  const tools = []
  const routes = []
  let effectDescription = ''
  await apply({
    tools: { register(tool) { tools.push(tool); return () => {} } },
    apiProxy: {},
    webServer: { register(route) { routes.push(route); return () => {} } },
    effect(factory, description) { effectDescription = description; return factory() },
  })
  assert.deepEqual(tools.map(tool => tool.name), ['pangea_assets_list'])
  assert.match(tools[0].description, /已导入资产/)
  assert.equal(routes.length, 1)
  assert.equal(routes[0].path, '/api/pangea-asset-catalog/state')
  assert.match(effectDescription, /PANGEA Asset Management 2\.0 API/)
})
