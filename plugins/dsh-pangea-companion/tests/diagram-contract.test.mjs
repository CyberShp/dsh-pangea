import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { activeDiagramDiagnostics, diagramDiagnostics } from '../src/diagram-contract.js'
import { normalizeSequence, layoutSequence, renderSequenceTree } from '../src/sequence-diagram.js'
import { validateCallGraph } from '../src/call-graph.js'
import { layoutFlow } from '../src/flow-graph/layout.js'
import { toSvgString } from '../src/flow-graph/render.js'
import { sourceFirstProjection } from '../src/source-first-projection.js'
import { summarizeRun } from '../src/reader.js'
import { writeArchitectureRun } from './architecture-source-first-fixture.mjs'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/diagram-contract-v1.json', import.meta.url), 'utf8'))
const candidate = scenario => {
  const body = structuredClone(fixture.base)
  for (const [path, value] of scenario.patch) {
    const keys = path.split('.')
    let row = body
    for (const key of keys.slice(0, -1)) row = row[key]
    row[keys.at(-1)] = structuredClone(value)
  }
  return body
}

for (const row of fixture.cases) test(`shared contract fixture: ${row.name}`, () => {
  const input = candidate(row), before = structuredClone(input)
  const diagnostics = diagramDiagnostics(input, { strict: row.strict })
  assert.deepEqual(diagnostics.map(item => ['diagram', 'field', 'code', 'classification'].map(key => item[key])), row.expected)
  assert.deepEqual(input, before)
})

test('legal branch group permutation preserves all messages, declared guards and raw facts', () => {
  const input = structuredClone(fixture.base.sequence), before = structuredClone(input)
  const normalized = normalizeSequence(input)
  assert.equal(normalized.status, 'ok')
  assert.deepEqual(normalized.graph.messages.map(row => row.id), ['request', 'ok', 'full', 'bad'])
  assert.deepEqual(normalized.graph.fragments[0].operands.map(row => row.condition), ['非法参数', '队列已满', '成功'])
  const layout = layoutSequence(normalized.graph)
  assert.deepEqual(layout.messages.map(row => row.id), ['request', 'bad', 'full', 'ok'])
  assert.equal(new Set(layout.messages.map(row => row.id)).size, 4)
  assert.deepEqual(layout.fragments[0].operands.map(row => row.message_ids), [['bad'], ['full'], ['ok']])
  const svg = toSvgString(renderSequenceTree(layout))
  for (const row of input.messages) assert.ok(svg.includes(row.label), row.label)
  assert.deepEqual(input, before)
})

test('multiple reordered fragments anchor to their occupied span and retain later messages', () => {
  const input = structuredClone(fixture.base.sequence)
  input.messages.push({ id: 'done', from: 'caller', to: 'caller', label: '完成', kind: 'self' })
  input.fragments.push({ id: 'after', kind: 'opt', operands: [{ condition: '已返回', message_ids: ['done'] }] })
  const layout = layoutSequence(input)
  assert.deepEqual(layout.messages.map(row => row.id), ['request', 'bad', 'full', 'ok', 'done'])
  assert.equal(layout.fragments.length, 2)
  assert.ok(layout.fragments[0].y + layout.fragments[0].h < layout.fragments[1].y)
})

test('old writes arrays preserve every variable and write item without a format blame', () => {
  const input = structuredClone(fixture.base.call_graph)
  input.variables[0].writes = ['result', 'queue.count']
  const before = structuredClone(input), result = validateCallGraph(input)
  assert.equal(result.status, 'ok')
  assert.equal(result.graph.variables.length, 1)
  assert.equal(result.graph.variables[0].writes, 'result\nqueue.count')
  assert.deepEqual(result.graph.variables[0].writes.split('\n'), input.variables[0].writes)
  assert.deepEqual(input, before)
})

test('supersession clears exactly the repaired current record and retains unrelated diagnostics', () => {
  const binding = { run_id: 'run', action_id: 'run:closure:mq', task_id: 'original-worker' }
  const warning = (recordId, recordRevision, changes = {}) => ({ kind: 'diagram_format_diagnostic', ...binding,
    record_id: recordId, record_revision: recordRevision, ...changes })
  const result = { binding, records: [
    { record_id: 'one', created_revision: 1 }, { record_id: 'two', created_revision: 1 },
    { record_id: 'fixed', created_revision: 3, supersedes: ['one'] },
  ], warnings: [warning('one', 1), warning('two', 1), warning('fixed', 2), warning('fixed', 3, { task_id: 'other' })] }
  assert.deepEqual(activeDiagramDiagnostics(result), [result.warnings[1]])
})

test('declared main paths without a layout version never fall back to paths array order', () => {
  const input = structuredClone(fixture.base)
  input.main_path_ids = []
  assert.deepEqual(layoutFlow(input).main_path, [])
  input.main_path_ids = ['success']
  assert.deepEqual(layoutFlow(input).main_path, ['send', 'done'])
})

test('reader exposes frozen strict current diagnostics per flow and clears only retired revisions', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-reader-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const run = await writeArchitectureRun(root)
  const taskPath = path.join(run.run, 'agent-tasks', 'analysis.json')
  const task = JSON.parse(await readFile(taskPath, 'utf8'))
  task.record_contracts = { diagram: 'diagram-contract-v1' }
  await writeFile(taskPath, JSON.stringify(task))
  const result = JSON.parse(await readFile(run.resultPath, 'utf8'))
  const broken = structuredClone(fixture.base)
  broken.sequence.title = null
  broken.call_graph.variables[0].writes = ['result']
  result.records = [
    { record_id: 'retired', kind: 'flow', body: broken, created_revision: 1 },
    { record_id: 'fixed', kind: 'flow', body: structuredClone(fixture.base), created_revision: 2, supersedes: ['retired'] },
    { record_id: 'current', kind: 'flow', body: broken, created_revision: 2 },
  ]
  result.warnings = ['retired', 'current'].map(recordId => ({ ...result.binding, kind: 'diagram_format_diagnostic',
    record_id: recordId, record_revision: recordId === 'retired' ? 1 : 2, diagram: 'sequence',
    field: 'sequence.title', code: 'missing_field', classification: 'missing', message: 'persisted diagnostic marker' }))
  await writeFile(run.resultPath, JSON.stringify(result))
  const view = await summarizeRun(root, run.task.run_id, { includeDetails: true })
  assert.equal(view.details.business_flows.length, 2)
  const fixed = view.details.business_flows.find(flow => flow.source_record.record_id === 'fixed')
  const current = view.details.business_flows.find(flow => flow.source_record.record_id === 'current')
  assert.deepEqual(fixed.diagram_diagnostics, [])
  assert.equal(current.record_contracts.diagram, 'diagram-contract-v1')
  assert.ok(current.diagram_diagnostics.some(item => item.message === 'persisted diagnostic marker'))
  assert.ok(current.diagram_diagnostics.some(item => item.field === 'call_graph.variables[0].writes' && item.classification === 'invalid'))
  assert.ok(current.diagram_diagnostics.every(item => item.record_id === 'current' && item.record_revision === 2))
  assert.deepEqual(current.source_record.body, broken)
  assert.ok(view.source_first_records[0].diagram_diagnostics.every(item => item.record_id === 'current'))
})

test('old flow projection retains the tolerant presentation fallback without new strict requirements', () => {
  const body = structuredClone(fixture.base)
  delete body.sequence
  body.call_graph.variables[0].writes = ['result']
  const view = sourceFirstProjection([{ action_id: 'a', stage: 'unit_analysis', status: 'accepted', task: { unit_id: 'u' },
    records: [{ record_id: 'flow', kind: 'flow', created_revision: 1, body }] }])
  assert.equal(Object.hasOwn(view.business_flows[0], 'diagram_diagnostics'), false)
  assert.deepEqual(view.business_flows[0].source_record.body, body)
})
