import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, paginateSnapshot, paginationOptions } from '../src/index.js'

test('paginates at 20 assets, filters roles on the server, and sorts by source path', () => {
  const assets = Array.from({ length: 25 }, (_, index) => ({
    asset_id: `asset-${index}`,
    source_path: `inbox/${String(24 - index).padStart(2, '0')}.md`,
    suggested_roles: [index % 2 === 0 ? 'input_candidate' : 'semantic_reference'],
    requirements: [{ id: `REQ-${index}`, text: 'large evidence' }],
  }))
  const first = paginateSnapshot({ status: 'ok', assets, methodology_candidates: [1], automation_capabilities: [2] })
  assert.equal(first.assets.length, 20)
  assert.equal(first.assets[0].source_path, 'inbox/00.md')
  assert.deepEqual(first.pagination, { page: 1, page_size: 20, total: 25, total_pages: 2, role: 'all' })
  assert.deepEqual(first.methodology_candidates, [])
  assert.deepEqual(first.automation_capabilities, [])
  assert.equal('requirements' in first.assets[0], false)

  const filtered = paginateSnapshot({ status: 'ok', assets }, { page: 2, pageSize: 20, role: 'input_candidate' })
  assert.equal(filtered.pagination.page, 1)
  assert.equal(filtered.pagination.total, 13)
  assert.ok(filtered.assets.every(asset => asset.suggested_roles.includes('input_candidate')))

  const options = paginationOptions(new URLSearchParams('page=2&page_size=50&role=semantic_reference'))
  assert.deepEqual(options, { page: 2, pageSize: 50, role: 'semantic_reference' })
  assert.deepEqual(paginationOptions(new URLSearchParams('page=-1&page_size=999&role=bad')), { page: 1, pageSize: 20, role: 'all' })
})

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
