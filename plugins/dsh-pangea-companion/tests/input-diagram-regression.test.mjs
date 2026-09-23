import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { readFlowDocuments, readInputMaterials } from '../src/reader.js'
import { TaskStore } from '../src/task-store.js'
import { workbenchRouteHandler } from '../src/index.js'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-input-diagram-'))
  await mkdir(path.join(root, '.agents/pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents/pangea/dsh.md'), '# Synthetic workspace')
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('two live flow documents show explicit steps before Step 03 ends; prose remains readable', async t => {
  const root = await fixture(t)
  const folder = path.join(root, '活文档/流程讲解')
  await mkdir(folder, { recursive: true })
  for (const id of ['FLOW-1', 'FLOW-2']) await writeFile(path.join(folder, `流程-${id}-synthetic.md`),
    '# Synthetic\n```pangea-flow\n' + JSON.stringify({ flow_id: id, title: id, mainline_steps: [{ step_id: 'S1', title: 'Open session' }], branches: [] }) + '\n```\n')
  await writeFile(path.join(folder, '流程-FLOW-3-legacy.md'), '# Legacy\nReadable analysis already exists.')
  const documents = await readFlowDocuments(root)
  assert.equal(documents.length, 3)
  assert.equal(documents.filter(d => d.flow?.mainline_steps.length === 1).length, 2)
  assert.equal(documents.find(d => d.title.includes('legacy')).status, 'unparsed')
})

test('material import alone does not claim consumption; explicit ranges and links stay visible', async t => {
  const root = await fixture(t)
  await mkdir(path.join(root, 'inputs/assets'), { recursive: true })
  await mkdir(path.join(root, '内部索引'))
  await writeFile(path.join(root, 'inputs/assets/manifest.json'), JSON.stringify({ assets: [{ asset_id: 'A1', title: 'Design' }] }))
  assert.match((await readInputMaterials(root))[0].consumption_state, /尚无/)
  await writeFile(path.join(root, '内部索引/输入材料索引.json'), JSON.stringify({ items: [{ asset_id: 'A1', consumed_ranges: ['section 2'], linked_flow_ids: ['FLOW-1'] }] }))
  const material = (await readInputMaterials(root))[0]
  assert.deepEqual(material.linked_ids, ['FLOW-1'])
  assert.deepEqual(material.consumption.consumed_ranges, ['section 2'])
})

test('background diagram conversation preserves active analysis conversation', async t => {
  const root = await fixture(t)
  const tasks = new TaskStore({ storePath: path.join(root, 'tasks.json') })
  const task = await tasks.create({ workspace: root, input: { repository: 'repo', target: 'synthetic' } })
  await tasks.addConversation(task.task_id, { sessionId: 'analysis', kind: 'analysis' })
  await tasks.addConversation(task.task_id, { sessionId: 'diagram', kind: 'architecture', activate: false })
  assert.equal((await tasks.get(task.task_id)).active_conversation_id, 'analysis')
  await tasks.activateConversation(task.task_id, 'diagram')
  assert.equal((await tasks.get(task.task_id)).active_conversation_id, 'diagram')
})

test('diagram API captures Job output, isolates missing Jobs and preserves validated artifacts', async t => {
  const root = await fixture(t)
  const run = path.join(root, 'runs/run')
  const views = path.join(run, '派生视图/archify')
  const task = { task_id: 'task', workspace: root, data_root: root, run_id: 'run' }
  for (const id of ['live', 'missing', 'ready']) {
    const folder = path.join(views, id)
    await mkdir(folder, { recursive: true })
    await writeFile(path.join(folder, 'manifest.json'), JSON.stringify({ view_id: id, task_id: 'task', run_id: 'run', status: 'generating',
      job_id: id, job_started_at: 100, owner_session_id: 'owner', created_at: '2026-01-01' }))
    if (id === 'ready') {
      await writeFile(path.join(folder, 'validation-receipt.json'), '{"ok":true}')
      await writeFile(path.join(folder, 'diagram.html'), '<svg></svg>')
    }
  }
  const request = Readable.from([JSON.stringify({ action: 'architecture-list', task_id: 'task' })])
  Object.assign(request, { method: 'POST', url: '/api/pangea-companion/workbench?' + new URLSearchParams({ cwd: root }), headers: { 'sec-fetch-site': 'same-origin' } })
  let code, body
  await workbenchRouteHandler(request, { writeHead(value) { code = value }, end(value) { body = JSON.parse(value) } }, {}, { get: async () => task }, new Set(), {},
    { agents: { get: () => ({ id: 'owner' }) }, jobs: {
      get(id) { if (id !== 'live') throw new Error(`unknown job ${id}`); return { startedAt: 100, status: 'running' } },
      read() { return { text: 'Reading implementation and preparing diagram' } },
    } }, {})
  assert.equal(code, 200, JSON.stringify(body))
  assert.equal(body.views.find(v => v.view_id === 'missing').status, 'interrupted')
  assert.equal(body.views.find(v => v.view_id === 'ready').available, true)
  assert.match(body.views.find(v => v.view_id === 'live').output, /Reading implementation/)
  assert.match(JSON.parse(await readFile(path.join(views, 'live/manifest.json'), 'utf8')).output, /Reading implementation/)
})

test('diagram validation retries remain live until the Job ends and a later delivery clears the error', async t => {
  const root = await fixture(t)
  const folder = path.join(root, 'runs/run/派生视图/archify/view')
  await mkdir(folder, { recursive: true })
  await writeFile(path.join(folder, 'manifest.json'), JSON.stringify({ view_id: 'view', task_id: 'task', run_id: 'run',
    status: 'generating', job_id: 'job', job_started_at: 100, owner_session_id: 'owner', created_at: '2026-01-01' }))
  const diagnostic = { code: 'workflow/node-overlap', severity: 'error', message: 'Nodes overlap' }
  await writeFile(path.join(folder, 'validation-receipt.json'), JSON.stringify({ ok: false, error: 'Nodes overlap', diagnostics: [diagnostic] }))
  const task = { task_id: 'task', workspace: root, data_root: root, run_id: 'run' }
  let status = 'running'
  const runtime = { agents: { get: () => ({ id: 'owner' }) }, jobs: {
    get: () => ({ startedAt: 100, status }), read: () => ({ text: 'Adjusting the candidate layout' }),
  } }
  async function list() {
    const req = Readable.from([JSON.stringify({ action: 'architecture-list', task_id: 'task' })])
    Object.assign(req, { method: 'POST', url: '/api/pangea-companion/workbench?' + new URLSearchParams({ cwd: root }), headers: { 'sec-fetch-site': 'same-origin' } })
    let body
    await workbenchRouteHandler(req, { writeHead(code) { assert.equal(code, 200) }, end(value) { body = JSON.parse(value) } },
      {}, { get: async () => task }, new Set(), {}, runtime, {})
    return body.views[0]
  }
  const repairing = await list()
  assert.equal(repairing.status, 'generating')
  assert.equal(repairing.execution_status, 'running')
  assert.equal(repairing.available, false)
  assert.equal(repairing.validation_error, 'Nodes overlap')
  assert.deepEqual(repairing.validation_diagnostics, [diagnostic])
  assert.match(repairing.output, /Adjusting/)

  // The renderer exhausts its attempts before the host Job settles.
  const manifestPath = path.join(folder, 'manifest.json')
  const exhausted = JSON.parse(await readFile(manifestPath, 'utf8'))
  await writeFile(manifestPath, JSON.stringify({ ...exhausted, status: 'failed', error: 'Nodes overlap' }))
  status = 'completed'
  const failed = await list()
  assert.equal(failed.status, 'failed')
  assert.equal(failed.execution_status, 'completed')
  assert.equal(failed.error, 'Nodes overlap')
  assert.equal(failed.available, false)

  await writeFile(path.join(folder, 'validation-receipt.json'), '{"ok":true}')
  assert.equal((await list()).available, false, 'a receipt alone is not a viewable artifact')
  await writeFile(path.join(folder, 'diagram.html'), '<svg></svg>')
  const ready = await list()
  assert.equal(ready.status, 'ready')
  assert.equal(ready.available, true)
  assert.equal(ready.error, null)
  assert.equal(ready.validation_error, null)
  assert.deepEqual(ready.validation_diagnostics, [])
})

test('frozen asset items expose conditions and problems without borrowing the live asset catalog', async t => {
  const root = await fixture(t)
  await mkdir(path.join(root, 'inputs'), { recursive: true })
  const item = { asset_id: 'asset-1', asset_title: '重连示例', candidate_id: 'asset-1:E1', item_id: 'E1', item_type: 'test_case_example', preconditions: ['连接已建立'], related_problems: ['重连超时'], expected_results: ['恢复连接'] }
  await writeFile(path.join(root, 'inputs/asset-items.json'), JSON.stringify({ 'asset-1:E1': item }))
  const materials = await readInputMaterials(root)
  assert.equal(materials.length, 1)
  assert.equal(materials[0].title, '重连示例')
  assert.deepEqual(materials[0].structured_items, [item])
  assert.deepEqual(materials[0].linked_ids, [])
})
