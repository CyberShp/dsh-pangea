import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, rm, access, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createView } from '../src/architecture-views.js'
import { writeArchitectureRun } from './architecture-source-first-fixture.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'archify-source-first-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const value = await writeArchitectureRun(root)
  const archify = path.join(root, 'archify')
  await mkdir(path.join(archify, 'bin'), { recursive: true })
  await writeFile(path.join(archify, 'SKILL.md'), '# fixture')
  await writeFile(path.join(archify, 'bin/archify.mjs'), '')
  return { ...value, env: { PANGEA_ARCHIFY_ROOT: archify } }
}
async function context(f, created) {
  return JSON.parse(await readFile(path.join(f.run, '派生视图/archify', created.view.view_id, 'context.json'), 'utf8'))
}
test('existing source-first Run creates views with no legacy index and keeps full topology', async t => {
  const f = await fixture(t), before = await readFile(f.resultPath, 'utf8')
  const created = await createView(f.task, { flow_id: f.flowId }, f.env)
  const value = await context(f, created)
  assert.equal(value.business_flows.length, 1)
  assert.equal(value.business_flows[0].nodes.length, 4)
  assert.equal(value.business_flows[0].edges.length, 4)
  assert.equal(value.business_flows[0].paths.length, 2)
  assert.equal(value.test_cases.length, 2)
  assert.ok(!JSON.stringify(value).includes('other.c'))
  assert.ok(value.source_snapshot.repositories[0].source_root.endsWith(path.join('inputs', 'repo')))
  assert.equal(created.view.source_records.find(r => r.record_id === 'flow').revision, 3)
  assert.equal(created.view.publication.state, 'final')
  assert.doesNotMatch(created.prompt, /inputs\/source\/repository/)
  assert.equal(await readFile(f.resultPath, 'utf8'), before)
  await assert.rejects(access(path.join(f.run, '内部索引')))
})
test('partial diagram trims paths, edges, nodes, raw flow body and cases; revision inherits scope', async t => {
  const f = await fixture(t)
  const created = await createView(f.task, { flow_id: f.flowId, branch_ids: ['reject'] }, f.env)
  const value = await context(f, created), flow = value.business_flows[0]
  assert.deepEqual(flow.nodes.map(n => n.id), ['A', 'C', 'D'])
  assert.deepEqual(flow.edges, [{ source_step_key: 'A', target_step_key: 'C' }, { source_step_key: 'C', target_step_key: 'D' }])
  assert.deepEqual(flow.paths.map(p => p.path_id), ['reject'])
  assert.deepEqual(flow.source_record.body.paths.map(p => p.path_id), ['reject'])
  assert.deepEqual(value.test_cases.map(c => c.test_case_id), ['tls/c2'])
  await writeFile(path.join(f.run, '派生视图/archify', created.view.view_id, 'candidate.json'), '{}')
  const revised = await createView(f.task, { previous_view_id: created.view.view_id }, f.env)
  assert.equal(revised.view.flow_id, f.flowId)
  assert.deepEqual(revised.view.branch_ids, ['reject'])
})
test('stale legacy projection cannot override source-first records; absent content and stale selection are explicit', async t => {
  const f = await fixture(t)
  await mkdir(path.join(f.run, '内部索引'))
  await writeFile(path.join(f.run, '内部索引/工作台投影.json'), '{"business_flows":[{"flow_id":"stale"}]}')
  await assert.rejects(createView(f.task, { flow_id: 'stale' }, f.env), /流程已更新/)
  const result = JSON.parse(await readFile(f.resultPath, 'utf8'))
  result.records = []
  await writeFile(f.resultPath, JSON.stringify(result))
  await assert.rejects(createView(f.task, {}, f.env), /尚无足够/)
  result.records = [{ record_id: 'note', kind: 'note', body: 'TLS module reads handshake messages', evidence: ['repo:tls.c:1'] }]
  await writeFile(f.resultPath, JSON.stringify(result))
  const value = await context(f, await createView(f.task, { type: 'architecture' }, f.env))
  assert.equal(value.notes[0].source_record.body, result.records[0].body)
})
test('accepted closure replaces analysis for diagrams and corrupt accepted bindings never fall back to legacy', async t => {
  const f = await fixture(t)
  const progressPath = path.join(f.run, 'progress.json')
  const progress = JSON.parse(await readFile(progressPath, 'utf8'))
  const closureId = `${f.task.run_id}:closure:tls`
  const closureTask = path.join(f.run, 'agent-tasks', 'closure.json')
  const closureResult = path.join(f.run, 'agent-results', 'closure.json')
  await writeFile(closureTask, JSON.stringify({ unit_id: 'tls', result_path: closureResult, task_type: 'source_first_closure' }))
  const result = { format_version: 'pangea-notes-v1', binding: { run_id: f.task.run_id, action_id: closureId, task_id: 'closure-worker' }, revision: 5,
    records: [{ record_id: 'flow', kind: 'flow', body: { title: 'Corrected TLS path', nodes: [{ id: 'Z', label: 'Corrected' }] } }] }
  await writeFile(closureResult, JSON.stringify(result))
  progress.actions[closureId] = { stage: 'targeted_closure', status: 'accepted', task_path: closureTask, task_id: 'closure-worker' }
  progress.accepted_revisions[closureId] = 5
  await writeFile(progressPath, JSON.stringify(progress))
  const created = await createView(f.task, { flow_id: f.flowId }, f.env)
  assert.equal((await context(f, created)).business_flows[0].title, 'Corrected TLS path')
  assert.equal(created.view.source_records[0].revision, 5)
  result.binding.run_id = 'another-run'
  await writeFile(closureResult, JSON.stringify(result))
  await assert.rejects(createView(f.task, {}, f.env), /不可读取/)
})

test('direct architecture reader accepts an aliased data root without weakening Run boundaries', async t => {
  const f = await fixture(t)
  const alias = `${f.task.data_root}-alias`
  await symlink(f.task.data_root, alias, process.platform === 'win32' ? 'junction' : 'dir')
  t.after(() => rm(alias, { recursive: true, force: true }))
  const created = await createView({ ...f.task, data_root: alias }, { flow_id: f.flowId }, f.env)
  assert.equal((await context(f, created)).business_flows[0].title, 'TLS session')
  const progressPath = path.join(f.run, 'progress.json')
  const progress = JSON.parse(await readFile(progressPath, 'utf8'))
  const outsideTask = path.join(f.task.data_root, 'outside-task.json')
  await writeFile(outsideTask, JSON.stringify({ unit_id: 'tls', result_path: f.resultPath }))
  progress.actions[f.actionId].task_path = outsideTask
  await writeFile(progressPath, JSON.stringify(progress))
  await assert.rejects(createView({ ...f.task, data_root: alias }, {}, f.env), /不可读取/)
})
