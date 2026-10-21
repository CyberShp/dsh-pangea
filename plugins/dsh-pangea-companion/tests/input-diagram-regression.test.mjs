import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { readFlowDocuments, readInputMaterials } from '../src/reader.js'
import { TaskStore } from '../src/task-store.js'

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

test('live flow documents normalize behavior graphs and wrappers while preserving malformed content', async t => {
  const root = await fixture(t)
  const folder = path.join(root, '活文档/流程讲解')
  await mkdir(folder, { recursive: true })
  const canonical = { format_version: 'behavior-flow-v1', flow_id: 'F1', title: 'Canonical', role: 'main',
    nodes: [{ id: 'b', label: 'Finish', kind: 'exit' }, { id: 'a', label: 'Start', kind: 'entry' }],
    edges: [{ source_step_key: 'a', target_step_key: 'b', condition: 'ready' }],
    paths: [{ path_id: 'P1', node_ids: ['a', 'b'] }] }
  const compatible = { flow_id: 'F2', 标题: 'Compatible', 节点: [{ node_id: 'a', 名称: 'First', 类型: 'entry' }, { node_id: 'b', 名称: 'Last', 类型: 'exit' }],
    连线: [{ from: 'a', to: 'b', 条件: 'compatible' }] }
  const malformed = { flow_id: 'F3', title: 'Malformed', nodes: [{ label: 'No identifier' }], edges: [] }
  await writeFile(path.join(folder, 'flows.md'), '```pangea-flow\n' + JSON.stringify({ flows: [canonical, compatible, malformed] }) + '\n```\n')
  const documents = await readFlowDocuments(root)
  assert.equal(documents.length, 3)
  const first = documents.find(item => item.flow?.flow_id === 'F1')
  assert.equal(first.status, 'parsed')
  assert.deepEqual(first.flow.mainline_steps.map(step => step.step_id), ['a', 'b'])
  assert.deepEqual(first.flow.branches[0].path_ids, ['P1'])
  const second = documents.find(item => item.flow?.flow_id === 'F2')
  assert.equal(second.status, 'parsed')
  assert.deepEqual(second.flow.nodes.map(node => node.id), ['a', 'b'])
  assert.equal(second.flow.branches[0].condition, 'compatible')
  assert.ok(second.flow.projection_warnings.some(message => message.includes('字段 from 视为 source_step_key')))
  const third = documents.find(item => item.flow?.flow_id === 'F3')
  assert.equal(third.status, 'unparsed')
  assert.match(third.flow.raw_text, /No identifier/)
  assert.deepEqual(third.flow.mainline_steps, [])
  await writeFile(path.join(folder, 'duplicate.md'), '```pangea-flow\n' + JSON.stringify(canonical) + '\n```\n')
  const duplicate = await readFlowDocuments(root)
  assert.equal(duplicate.filter(item => item.status === 'ambiguous').length, 2)
  assert.equal(duplicate.filter(item => item.flow?.flow_id === 'F1').length, 0)
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
