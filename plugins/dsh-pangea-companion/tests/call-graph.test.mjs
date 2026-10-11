import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { validateCallGraph, callGraphRepairPrompt, callsForVariable, callGraphSkeleton, CALL_GRAPH_EXAMPLE, CALL_GRAPH_FORMAT } from '../src/call-graph.js'
import { archifyExperimental, createView, validateView, listViews, viewArtifact, loadView, CALL_GRAPH_RENDERER } from '../src/architecture-views.js'
import { writeArchitectureRun } from './architecture-source-first-fixture.mjs'

const fn = id => ({ id, kind: 'function', label: id, signature: '', file: 'a.c', line: 1 })

test('example graph validates as ok and the empty skeleton is invalid', () => {
  const result = validateCallGraph(JSON.stringify(CALL_GRAPH_EXAMPLE))
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.errors, [])
  assert.equal(result.graph.functions.length, 4)
  const empty = validateCallGraph(callGraphSkeleton('t', ''))
  assert.equal(empty.status, 'invalid')
  assert.ok(empty.errors.includes('functions 中没有有效函数'))
  assert.match(validateCallGraph('{oops').errors[0], /^不是有效 JSON：/)
})

test('dangling calls, duplicate ids and bad root are partial with itemized errors', () => {
  const result = validateCallGraph({ format_version: CALL_GRAPH_FORMAT, root: 'nope', functions: [fn('a'), fn('b'), fn('a')],
    calls: [{ from: 'a', to: 'b' }, { from: 'x', to: 'b' }], variables: [{ function: 'ghost', name: 'v' }] })
  assert.equal(result.status, 'partial')
  assert.deepEqual(result.errors, [
    "functions[2].id='a' 重复",
    "calls[1].from='x' 不在 functions 中",
    "variables[0].function='ghost' 不在 functions 中",
    "root='nope' 不在 functions 中，改用 a",
  ])
  assert.equal(result.graph.root, 'a')
  assert.deepEqual(result.graph.calls.map(c => [c.from, c.to]), [['a', 'b']])
  assert.equal(callGraphRepairPrompt([], 'c.json'), '')
  const prompt = callGraphRepairPrompt(result.errors, 'c.json')
  assert.ok(prompt.startsWith('c.json 的 call-graph-v1 结构有以下问题'))
  assert.ok(prompt.includes("- calls[1].from='x' 不在 functions 中"))
})

test('callsForVariable finds calls mentioning the variable by whole word', () => {
  const graph = validateCallGraph(CALL_GRAPH_EXAMPLE).graph
  const variable = graph.variables[0]
  assert.deepEqual([...callsForVariable(graph, 'login_handler', variable)], [0])
  assert.deepEqual([...callsForVariable(graph, 'login_handler', { name: 'use' })], [])
  assert.deepEqual([...callsForVariable(graph, 'login_handler', null)], [])
})

test('string argument mappings stay readable and unsupported evidence types make the graph partial', () => {
  const candidate = structuredClone(CALL_GRAPH_EXAMPLE)
  candidate.calls[0].args = 'req->user → user'
  let result = validateCallGraph(candidate)
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.graph.calls[0].args, ['req->user → user'])
  assert.deepEqual([...callsForVariable(result.graph, 'login_handler', { name: 'user' })], [0])
  candidate.functions[0].file = 123
  candidate.title = 123
  candidate.functions[0].line = '20'
  candidate.calls[0].line = -1
  candidate.calls[0].args = { mapping: 'user' }
  candidate.variables[0].reads = ['user', 7]
  const original = structuredClone(candidate)
  result = validateCallGraph(candidate)
  assert.equal(result.status, 'partial')
  for (const field of ['title', 'functions[0].file', 'functions[0].line', 'calls[0].line', 'calls[0].args', 'variables[0].reads[1]']) {
    assert.ok(result.errors.some(error => error.includes(field)), field)
  }
  assert.deepEqual(result.graph.variables[0].reads, ['user'])
  assert.deepEqual(candidate, original)
})

test('variable highlighting follows declared writes into arguments without matching a longer field name', () => {
  const graph = validateCallGraph({ format_version: CALL_GRAPH_FORMAT, root: 'a', functions: [fn('a'), fn('b'), fn('c')],
    calls: [
      { from: 'a', to: 'b', args: 'ctx->size → size' },
      { from: 'a', to: 'b', args: 'ctx->size_limit → limit' },
      { from: 'b', to: 'c', args: 'ctx->size → size' },
      { from: 'b', to: 'a', returns: 'ctx->size' },
    ] }).graph
  assert.deepEqual([...callsForVariable(graph, 'a', { name: 'temp', writes: 'ctx->size' })], [0, 3])
})

test('Archify export is only enabled by the explicit experimental flag', () => {
  assert.equal(archifyExperimental({}), false)
  assert.equal(archifyExperimental({ PANGEA_ARCHIFY_EXPERIMENTAL: 'true' }), false)
  assert.equal(archifyExperimental({ PANGEA_ARCHIFY_EXPERIMENTAL: '1' }), true)
})

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'call-graph-host-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const folder = path.join(root, 'runs/run/派生视图/archify/view')
  await mkdir(folder, { recursive: true })
  const task = { data_root: root, run_id: 'run', task_id: 'task' }
  await writeFile(path.join(folder, 'manifest.json'), JSON.stringify({ ...task, view_id: 'view', type: 'workflow', profile: 'function_variables',
    status: 'generating', created_at: new Date().toISOString(), renderer: CALL_GRAPH_RENDERER, format_version: CALL_GRAPH_FORMAT }))
  return { task, folder }
}

const partial = JSON.stringify({ format_version: CALL_GRAPH_FORMAT, root: 'a', functions: [fn('a'), fn('b')],
  calls: [{ from: 'a', to: 'b', args: ['x'] }, { from: 'a', to: 'missing' }] })

test('host validation keeps partial graphs repairable, then delivers them on the last round', async t => {
  const { task, folder } = await fixture(t)
  await writeFile(path.join(folder, 'candidate.json'), partial)
  const first = await validateView(task, 'view', { attempt: 1 }, {})
  assert.equal(first.ok, true)
  assert.equal(first.status, 'partial')
  assert.equal(first.repairable, true)
  assert.ok(first.repair_prompt.includes("calls[1].to='missing' 不在 functions 中"))
  assert.equal((await loadView(task, 'view')).status, 'generating')
  const last = await validateView(task, 'view', { attempt: 3 }, {})
  assert.equal(last.repairable, false)
  assert.equal((await loadView(task, 'view')).status, 'ready')
  const [listed] = await listViews(task)
  assert.equal(listed.status, 'ready')
  assert.equal(listed.call_graph_status, 'partial')
  assert.deepEqual(listed.call_graph.calls.map(c => [c.from, c.to]), [['a', 'b']])
  assert.deepEqual(listed.call_graph_errors, ["calls[1].to='missing' 不在 functions 中"])
  assert.equal(JSON.parse((await viewArtifact(task, 'view', 'json')).toString()).root, 'a')
  assert.match((await viewArtifact(task, 'view', 'svg')).toString(), /^<svg/)
  await assert.rejects(viewArtifact(task, 'view', 'html'), /Unsupported/)
  await assert.rejects(viewArtifact(task, 'view', 'svg', 'draft'), /Unsupported/)
})

test('host validation fails invalid graphs after the repair rounds are exhausted', async t => {
  const { task, folder } = await fixture(t)
  await writeFile(path.join(folder, 'candidate.json'), 'not json')
  const early = await validateView(task, 'view', { attempt: 1 }, {})
  assert.equal(early.ok, false)
  assert.equal(early.attempts_exhausted, false)
  assert.equal((await loadView(task, 'view')).status, 'generating')
  const last = await validateView(task, 'view', { attempt: 3 }, {})
  assert.equal(last.attempts_exhausted, true)
  assert.match(last.error, /^调用图未通过结构校验：不是有效 JSON/)
  const view = await loadView(task, 'view')
  assert.equal(view.status, 'failed')
  await assert.rejects(readFile(path.join(folder, 'graph.json')))
  const [listed] = await listViews(task)
  assert.equal(listed.available, false)
  assert.equal(listed.call_graph, null)
  await assert.rejects(viewArtifact(task, 'view', 'json'))
})

test('changed call-graph candidates retain a labelled previous preview and require validation before export', async t => {
  const { task, folder } = await fixture(t)
  await writeFile(path.join(folder, 'candidate.json'), partial)
  await validateView(task, 'view', { attempt: 3 }, {})
  await writeFile(path.join(folder, 'candidate.json'), 'invalid replacement')
  const [listed] = await listViews(task)
  assert.equal(listed.available, false)
  assert.equal(listed.candidate_unverified, true)
  assert.equal(listed.preview_available, true)
  assert.equal(listed.preview_is_previous, true)
  assert.equal(listed.call_graph_status, 'partial')
  await assert.rejects(viewArtifact(task, 'view', 'json'), /尚未验证/)
  await assert.rejects(viewArtifact(task, 'view', 'svg'), /尚未验证/)
  await writeFile(path.join(folder, 'candidate.json'), JSON.stringify(CALL_GRAPH_EXAMPLE))
  await validateView(task, 'view', { manual: true }, {})
  assert.equal((await listViews(task))[0].available, true)
  assert.equal(JSON.parse((await viewArtifact(task, 'view', 'json')).toString()).root, CALL_GRAPH_EXAMPLE.root)
})

test('function diagrams preserve selected branch evidence and inherit their profile without Archify', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'call-graph-source-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fixture = await writeArchitectureRun(root)
  const result = JSON.parse(await readFile(fixture.resultPath, 'utf8'))
  result.records.find(record => record.record_id === 'flow').body.edges[2].condition = 'selected rejection condition'
  await writeFile(fixture.resultPath, JSON.stringify(result))
  const original = await readFile(fixture.resultPath, 'utf8')
  const selected = `${fixture.flowId}:edge-3`
  const first = await createView(fixture.task, { profile: 'function_variables', flow_id: fixture.flowId, branch_ids: [selected] }, {})
  const context = JSON.parse(await readFile(path.join(fixture.run, '派生视图/archify', first.view.view_id, 'context.json'), 'utf8'))
  assert.deepEqual(context.branch_scope.branch_ids, [selected])
  assert.deepEqual(context.branch_scope.nodes.map(node => node.id), ['A', 'C'])
  assert.equal(context.branch_scope.edges.length, 1)
  assert.equal(context.branch_scope.edges[0].condition, 'selected rejection condition')
  assert.deepEqual(context.branch_scope.paths, [])
  assert.equal(context.business_flows, undefined)
  assert.match(first.prompt, /branch_scope/)
  const revised = await createView(fixture.task, { previous_view_id: first.view.view_id }, { PANGEA_ARCHIFY_ROOT: path.join(root, 'missing-archify') })
  assert.equal(revised.view.renderer, CALL_GRAPH_RENDERER)
  assert.equal(revised.view.profile, 'function_variables')
  assert.deepEqual(revised.view.branch_ids, [selected])
  assert.equal(await readFile(fixture.resultPath, 'utf8'), original)
})
