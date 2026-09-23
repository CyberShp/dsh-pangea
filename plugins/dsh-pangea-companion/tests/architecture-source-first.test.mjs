import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, mkdir, rm, access, symlink, rename, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createView, recordViewEvent, listViews, updateView } from '../src/architecture-views.js'
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
  const candidate = JSON.parse(await readFile(path.join(f.run, '派生视图/archify', created.view.view_id, 'candidate.json'), 'utf8'))
  assert.equal(candidate.schema_version, 2)
  assert.equal(candidate.meta.quality_profile, 'showcase')
  assert.deepEqual(candidate.nodes, [])
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
  const previousCandidate = '{"schema_version":1,"nodes":[{"id":"existing"}]}'
  await writeFile(path.join(f.run, '派生视图/archify', created.view.view_id, 'candidate.json'), previousCandidate)
  const revised = await createView(f.task, { previous_view_id: created.view.view_id }, f.env)
  assert.equal(revised.view.flow_id, f.flowId)
  assert.deepEqual(revised.view.branch_ids, ['reject'])
  assert.equal(await readFile(path.join(f.run, '派生视图/archify', revised.view.view_id, 'candidate.json'), 'utf8'), previousCandidate)
})

test('generated command runs the bound renderer with literal spaces, quotes and shell metacharacters', async t => {
  const f = await fixture(t)
  const archify = `${f.env.PANGEA_ARCHIFY_ROOT} ' $literal &`
  await rename(f.env.PANGEA_ARCHIFY_ROOT, archify)
  await writeFile(path.join(archify, 'bin/archify.mjs'), `
    import { writeFileSync } from 'node:fs';
    writeFileSync(process.argv[5], '<html><svg viewBox="0 0 20 20"></svg></html>');
    console.log(JSON.stringify({ ok: true, args: process.argv.slice(2) }));
  `)
  const created = await createView(f.task, { flow_id: f.flowId }, { PANGEA_ARCHIFY_ROOT: archify, PANGEA_NODE: process.execPath })
  const command = created.prompt.match(/```(?:powershell|sh)\n([^\n]+)\n```/)[1]
  const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh'
  const args = process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command]
  const result = spawnSync(shell, args, { encoding: 'utf8', timeout: 15000 })
  assert.equal(result.status, 0, result.stderr)
  const folder = await realpath(path.join(f.run, '派生视图/archify', created.view.view_id))
  const receipt = JSON.parse(await readFile(path.join(folder, 'validation-receipt.json'), 'utf8'))
  assert.deepEqual(receipt.args, ['deliver', 'workflow', path.join(folder, 'candidate.json'), path.join(folder, 'diagram.html'), '--quality', 'showcase', '--json'])
  assert.match(await readFile(path.join(folder, 'diagram.svg'), 'utf8'), /xmlns=/)
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



test('edge-scoped diagram keeps only selected endpoints; diagnostic text stays valid JSON and stop survives late events', async t => {
  const f = await fixture(t)
  const edgeId = `${f.flowId}:edge-2`
  const created = await createView(f.task, { flow_id: f.flowId, branch_ids: [edgeId] }, f.env)
  const value = await context(f, created), flow = value.business_flows[0]
  assert.equal(flow.edges.length, 1)
  assert.equal(flow.nodes.length, 2)
  assert.equal(flow.paths.length, 0)
  assert.equal(flow.source_record.body.edges.length, 1)
  await recordViewEvent(f.task, created.view.view_id, { stage: 'diagram_failed', terminal: true, status: 'error', error: 'failure "quoted" ' + 'x'.repeat(270000) })
  let view = (await listViews(f.task)).find(v => v.view_id === created.view.view_id)
  assert.equal(view.generation_events.length, 1)
  assert.equal(view.status, 'failed')
  await updateView(f.task, created.view.view_id, { status: 'stopped' })
  await recordViewEvent(f.task, created.view.view_id, { stage: 'late_failure', terminal: true, error: 'cancelled' })
  view = (await listViews(f.task)).find(v => v.view_id === created.view.view_id)
  assert.equal(view.status, 'stopped')
})
