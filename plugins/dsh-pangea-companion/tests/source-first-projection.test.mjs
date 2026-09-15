import test from 'node:test'
import assert from 'node:assert/strict'
import { sourceFirstProjection } from '../src/source-first-projection.js'
const record = (id, kind, body, extra = {}) => ({ record_id: id, kind, body, ...extra })
const action = (unit, records, extra = {}) => ({ action_id: `run:analysis:${unit}`, stage: 'unit_analysis', status: 'accepted', task: { unit_id: unit }, result_path: `/run/${unit}.json`, revision: 4, records, ...extra })

test('projects typed records and links within each unit, preserving bodies and step expectations', () => {
  const records = [
    record('r1', 'risk', { risk_id: 'R-001', title: 'Overflow', behavior: 'No range check', related_case_ids: ['TC-001'], evidence: ['repo:sample.c:1'] }),
    record('c1', 'test_case', JSON.stringify({ case_id: 'TC-001', title: 'Boundary', steps: [{ action: 'call', expected: 'result' }], test_level: 'interface_contract', execution_status: 'not_run', risk_refs: ['R-001'] })),
    record('f1', 'flow', { flow_id: 'F-001', paths: [{ path_id: 'P-1', case_ids: ['TC-001'] }] }),
  ]
  const value = sourceFirstProjection([action('unit-a', records), action('unit-b', records)])
  assert.equal(value.risks.length, 2)
  assert.deepEqual(value.risks[0].linked_test_case_ids, ['unit-a/c1'])
  assert.deepEqual(value.test_cases[1].linked_risk_ids, ['unit-b/r1'])
  assert.deepEqual(value.test_cases[0].steps, ['call → result'])
  assert.equal(value.test_cases[0].status, 'not_run')
  assert.equal(value.test_cases[0].case_type, 'interface_contract')
  assert.deepEqual(value.business_flows[1].paths[0].linked_test_case_ids, ['unit-b/c1'])
  assert.equal(value.evidence[0].location, 'repo:sample.c:1')
  assert.deepEqual(value.evidence[0].risk_ids, ['unit-a/r1'])
  assert.equal(value.risks[0].source_record.body, records[0].body)
  assert.equal(value.risks[0].severity, undefined)
})
test('accepted closure replaces its unit and explicit supersession retires earlier records; reviews stay separate', () => {
  const value = sourceFirstProjection([
    action('a', [record('old', 'risk', 'Old risk')]),
    action('a', [record('v1', 'risk', 'First'), record('v2', 'risk', 'Revised', { supersedes: ['v1'] })], { stage: 'targeted_closure' }),
    action('b', [record('live', 'risk', 'Still current')]),
    action('b', [record('pending', 'risk', 'Unaccepted closure')], { stage: 'targeted_closure', status: 'dispatched' }),
    action('review', [record('r', 'risk', 'Reviewer finding')], { stage: 'independent_review' }),
  ])
  assert.deepEqual(value.risks.map(r => r.title), ['Revised', 'Still current'])
})
test('keeps prose and group records intact without fabricating cases or semantic associations', () => {
  const value = sourceFirstProjection([action('a', [
    record('raw-risk', 'risk', '# R-1\nmentions TC-1 but no typed relation'),
    record('group', 'test_case_group', 'three suggested cases in original prose'),
    record('note', 'note', 'risk R-99 is only prose, not a risk record'),
    record('unresolved', 'unresolved', { gap: 'No product entry' }),
  ])])
  assert.equal(value.risks.length, 1)
  assert.equal(value.test_cases.length, 1)
  assert.equal(value.test_cases[0].source_record.kind, 'test_case_group')
  assert.equal(value.notes.length, 2)
  assert.deepEqual(value.risks[0].linked_test_case_ids, [])
  assert.equal(value.risks[0].system_result, '')
})

test('retains complete risk content and resolves record links without matching titles', () => {
  const body = { risk_id: 'R-1', title: 'Shared title', description: 'Overflow description', trigger: 'INT_MAX + 1', impact: 'Undefined result', expectation: 'Reject input', source_evidence: [{ repo_id: 'sample', path: 'sample.c', line_start: 1, observation: 'Addition' }], extra_detail: { boundary: 'INT_MAX' } }
  const value = sourceFirstProjection([action('a', [record('r', 'risk', body), record('c', 'test_case', { case_id: 'TC-1' }, { relates_to: [{ record_id: 'r' }] })]), action('b', [record('r', 'risk', { ...body, description: 'Another risk' }), record('c', 'test_case', { case_id: 'TC-1', linked_risk_ids: ['b/r'] })])])
  assert.equal(value.risks[0].narrative, body.description)
  assert.equal(value.risks[0].impact, body.impact)
  assert.equal(value.risks[0].expectation, body.expectation)
  assert.deepEqual(value.risks[0].source_record.body, body)
  assert.deepEqual(value.risks[0].linked_test_case_ids, ['a/c'])
  assert.deepEqual(value.risks[1].linked_test_case_ids, ['b/c'])
  assert.equal(value.risks[0].evidence[0].location, 'sample:sample.c:1')
})


test('standalone evidence explicitly linked to a risk appears in that risk detail', () => {
  const records = [record('r', 'risk', { risk_id: 'R-1', title: 'Same' }), record('e', 'evidence', { location: 'sample:sample.c:1', observation: 'Source observation' }, { relates_to: [{ record_id: 'r' }] })]
  const value = sourceFirstProjection([action('a', records), action('b', records)])
  assert.deepEqual(value.risks[0].evidence.map(e => e.chunk_id), ['a/e/evidence-1'])
  assert.deepEqual(value.risks[1].evidence.map(e => e.chunk_id), ['b/e/evidence-1'])
})


test('projects expectation and case identifiers emitted by the live risk-v1 sample', () => {
  const body = { title: 'Overflow', description: 'Real description', correct_expectation: 'Check ranges', current_behavior: 'Unchecked addition', case_ids: ['TC-003'] }
  const value = sourceFirstProjection([action('a', [record('r', 'risk', JSON.stringify(body)), record('c', 'test_case', { case_id: 'TC-003' })])])
  assert.equal(value.risks[0].expectation, 'Check ranges')
  assert.equal(value.risks[0].current_behavior, 'Unchecked addition')
  assert.deepEqual(value.risks[0].linked_test_case_ids, ['a/c'])
})


test('short cases retain variants and unit notes and follow explicit flow paths in both directions', () => {
  const cases = [record('c', 'test_case', { case_id: 'TC-1', flow_refs: [], variants: [{ input: 'sha256', expected: 'connected' }] }), record('n', 'note', 'Shared commands: connect --digest sha256'), record('f', 'flow', { flow_id: 'F-1', paths: [{ case_ids: ['TC-1'] }] })]
  const value = sourceFirstProjection([action('a', cases), action('b', cases)])
  assert.deepEqual(value.test_cases[0].linked_flow_ids, ['a/f'])
  assert.deepEqual(value.test_cases[1].linked_flow_ids, ['b/f'])
  assert.deepEqual(value.test_cases[0].variants, [{ input: 'sha256', expected: 'connected' }])
  assert.deepEqual(value.test_cases[0].unit_notes.map(n => n.projection_id), ['a/n'])
  const missing = sourceFirstProjection([action('a', [cases[0], record('f', 'flow', { paths: [{ case_ids: ['unknown'] }] })])])
  assert.deepEqual(missing.test_cases[0].linked_flow_ids, [])
})


test('notes use stable titles for JSON and punctuation while preserving originals', () => {
  const value = sourceFirstProjection([action('a', [record('n', 'note', '{\n"gap": "missing"\n}'), record('u', 'unresolved', '}'), record('s', 'summary', '# 业务范围\n正文')])])
  assert.deepEqual(value.notes.map(n => n.title), ['分析说明 · n', '待确认事项 · u', '业务范围'])
  assert.equal(value.notes[0].source_record.body, '{\n"gap": "missing"\n}')
})


test('existing unit aliases display paired operations without changing source bodies', () => {
  const body = { title: 'legacy unit', precondition: ['ready'], test_steps: [{ step: 'connect', expected: 'success' }], expected_results: ['connected'] }
  const view = sourceFirstProjection([{ stage: 'unit_analysis', status: 'accepted', task: { unit_id: 'u2' }, records: [{ record_id: 'r1', kind: 'test_case', body }] }])
  const row = view.test_cases[0]
  assert.deepEqual(row.preconditions, ['ready'])
  assert.deepEqual(row.step_pairs, [{ action: 'connect', expected: 'success' }])
  assert.deepEqual(row.steps, ['connect → success'])
  assert.deepEqual(row.expected_results, ['connected'])
  assert.equal(row.source_record.body, body)
  assert.equal(body.steps, undefined)
})

test('execution readiness uses explicit declarations and partial closure preserves the source body', () => {
  const ready = record('ready', 'test_case', { title: 'CLI connect', execution_readiness: 'ready' })
  const pending = record('pending', 'test_case', { title: 'inject failure', execution_readiness: 'needs_instrumentation', readiness_reason: '需开发提供注入桩' })
  const old = record('old', 'test_case', { title: 'legacy' })
  const partial = { ...action('a', [ready, pending, old]), stage: 'targeted_closure', status: 'paused', delivery_revision: 4 }
  const result = sourceFirstProjection([action('a', [record('first', 'test_case', { title: 'before' })]), partial])
  assert.deepEqual(result.test_cases.map(item => item.readiness), ['ready', 'needs_setup', 'unclassified'])
  assert.equal(result.test_cases[1].source_record.body, pending.body)
  assert.deepEqual(result.test_cases[1].missing_execution_conditions, ['需开发提供注入桩'])
})
