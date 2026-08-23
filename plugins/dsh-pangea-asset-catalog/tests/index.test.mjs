import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../src/index.js'

test('host registers catalog and model-submission tools, bundled skills, and one same-origin API route', async () => {
  const tools = []
  const skills = []
  const routes = []
  let effectDescription = ''
  await apply({
    tools: { register(tool) { tools.push(tool) } },
    skills: { register(skill) { skills.push(skill); return () => {} } },
    apiProxy: {},
    agents: {},
    webServer: { register(route) { routes.push(route); return () => {} } },
    effect(factory, description) { effectDescription = description; return factory() },
  })
  assert.deepEqual(tools.map(tool => tool.name), [
    'pangea_asset_catalog_generate', 'pangea_asset_issue_submit', 'pangea_asset_methodology_submit',
  ])
  assert.match(tools[0].description, /不修改 PANGEA、Run 或原始资产/)
  assert.deepEqual(skills.map(skill => skill.name), [
    'pangea-extract-historical-issues', 'pangea-derive-methodology-candidates',
  ])
  assert.ok(skills.every(skill => skill.invocation.modelInvocable === false && skill.invocation.userInvocable === true))
  assert.equal(routes.length, 1)
  assert.equal(routes[0].path, '/api/pangea-asset-catalog/state')
  assert.match(effectDescription, /model extraction/)
})
