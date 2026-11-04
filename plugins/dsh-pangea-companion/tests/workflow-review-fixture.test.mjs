import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { uiWorkbenchFixture } from './fixtures/ui-workbench.mjs'
import { transformFixture, responseFor, resetFixture } from './fixtures/workflow-review.mjs'

const make = scene => transformFixture(uiWorkbenchFixture('/isolated-ui', scene), { scene })
const request = (path, scene = 'running', extra = {}) => responseFor({ url: new URL(path, 'http://localhost'), req: { method: 'GET' }, ...make(scene), scene, dataRoot: '/isolated-ui', ...extra })
test('workflow review keeps task navigation unselected and empty collections explicit', async () => {
  const tasks = await request('/api/pangea-companion/workbench')
  assert.equal(tasks.tasks.items.length, 1)
  assert.equal(tasks.selected_task_id, undefined)
  assert.equal(tasks.tasks.items[0].run_id, tasks.run.run_id)
  const empty = await request('/api/pangea-companion/workbench', 'empty')
  assert.deepEqual(empty.tasks.items, [])
  assert.equal(empty.run, null)
  assert.equal((await request('/api/pangea-companion/state', 'empty')).current, null)
})
test('dense scene provides multiple items per unit and preserves distinct evidence', () => {
  const { run } = make('dense')
  assert.equal(run.workflow.units.length, 12)
  assert.equal(run.details.test_cases[0].source_evidence[0].location, run.details.test_cases[0].source_evidence[1].location)
  assert.notEqual(run.details.test_cases[0].source_evidence[0].quote, run.details.test_cases[0].source_evidence[1].quote)
  assert.ok(Date.now() - Date.parse(run.started_at) < 17 * 60000)
})
test('review create uses synthetic state and other controls explicitly reject real execution', async () => {
  const req = Readable.from([JSON.stringify({ action: 'task-create', input: { target: '验收输入', source_scope: ['transport'] } })]); req.method = 'POST'
  const result = await request('/api/pangea-companion/workbench', 'running', { req })
  assert.equal(result.task.title, '验收输入')
  assert.equal(make('running').run.target, '验收输入')
  resetFixture()
  const stop = Readable.from([JSON.stringify({ action: 'stop' })]); stop.method = 'POST'
  assert.equal((await request('/api/pangea-companion/workbench', 'running', { req: stop })).status, 'error')
})
