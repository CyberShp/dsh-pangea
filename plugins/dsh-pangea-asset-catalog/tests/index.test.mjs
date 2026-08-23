import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../src/index.js'

test('host registers one explicit generation tool and one same-origin API route', () => {
  const tools = []
  const routes = []
  let effectDescription = ''
  apply({
    tools: { register(tool) { tools.push(tool) } },
    webServer: { register(route) { routes.push(route); return () => {} } },
    effect(factory, description) { effectDescription = description; return factory() },
  })
  assert.equal(tools.length, 1)
  assert.equal(tools[0].name, 'pangea_asset_catalog_generate')
  assert.match(tools[0].description, /不修改 PANGEA、Run 或原始资产/)
  assert.equal(routes.length, 1)
  assert.equal(routes[0].path, '/api/pangea-asset-catalog/state')
  assert.match(effectDescription, /catalog API/)
})
