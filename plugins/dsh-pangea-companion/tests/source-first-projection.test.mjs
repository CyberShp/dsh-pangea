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
