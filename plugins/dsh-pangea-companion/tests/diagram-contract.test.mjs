import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { activeDiagramDiagnostics, diagramDiagnostics } from '../src/diagram-contract.js'
import { normalizeSequence, layoutSequence, renderSequenceTree } from '../src/sequence-diagram.js'
import { validateCallGraph } from '../src/call-graph.js'
import { layoutFlow } from '../src/flow-graph/layout.js'
import { toSvgString } from '../src/flow-graph/render.js'

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
