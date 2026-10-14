import test from 'node:test'
import assert from 'node:assert/strict'
import { sourceFirstProjection, coverageSummary, caseQualitySummary } from '../src/source-first-projection.js'
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

test('three units preserve normal records and render explicit aliases only in unit 3', () => {
  const good = { flow_id: 'F1', title: '正常', nodes: [{ id: 'a', label: '提交请求' }], edges: [], paths: [] }
  const third = { flow_id: 'F1', 标题: '异常单元', 说明: '原文', nodes: [{ node_id: 'a', name: '提交请求' }, { node_id: 'b', name: '收到拒绝' }], edges: [{ source: 'a', target: 'b' }] }
  const normal = [action('u1', [record('f', 'flow', good)]), action('u2', [record('f', 'flow', good)])]
  const before = sourceFirstProjection(normal)
  const value = sourceFirstProjection([...normal, action('u3', [record('f', 'flow', third)])])
  assert.deepEqual(value.business_flows.slice(0, 2), before.business_flows)
  const flow = value.business_flows[2]
  assert.equal(flow.title, '异常单元')
  assert.deepEqual(flow.nodes.map(n => [n.id, n.label]), [['a', '提交请求'], ['b', '收到拒绝']])
  assert.equal(flow.edges[0].target_step_key, 'b')
  assert.equal(flow.source_record.body, third)
})
test('invalid or duplicate nodes are diagnosed without invented identifiers', () => {
  const body = { nodes: [null, { name: 'missing id' }, { id: 'a', label: 'first' }, { id: 'a', label: 'second' }], edges: [{ source: 'a', target: 'missing' }] }
  const flow = sourceFirstProjection([action('u3', [record('f', 'flow', body)])]).business_flows[0]
  assert.deepEqual(flow.mainline_steps, [])
  assert.deepEqual(flow.edges, [])
  assert.ok(flow.projection_warnings.some(x => x.includes('重复')))
  assert.ok(flow.projection_warnings.some(x => x.includes('缺少')))
  assert.equal(flow.source_record.body, body)
})
test('coverage counts cases, added cases and distinct gaps separately for reused and unverified references', () => {
  const cases = [{ purpose: 'coverage', coverage_refs: ['C1', 'C1'] }, { purpose: 'branch', coverage_refs: ['C1', { coverage_id: 'C2' }] },
    { purpose: 'risk', coverage_refs: ['C2', 'outside'] }, { purpose: 'coverage', coverage_refs: ['outside'] }]
  assert.deepEqual(coverageSummary(cases, ['C1', 'C2', 'C3'].map(coverage_id => ({ coverage_id }))), {
    valid_gaps: 3, coverage_cases: 2, linked_cases: 3, linked_coverage_cases: 1, linked_valid_gaps: 2, unverified_refs: 1,
  })
  assert.deepEqual(coverageSummary(cases, null), {
    valid_gaps: null, coverage_cases: 2, linked_cases: null, linked_coverage_cases: null, linked_valid_gaps: null, unverified_refs: 3,
  })
  assert.deepEqual(coverageSummary(cases, []), {
    valid_gaps: 0, coverage_cases: 2, linked_cases: 0, linked_coverage_cases: 0, linked_valid_gaps: 0, unverified_refs: 3,
  })
  assert.deepEqual(coverageSummary([], []), {
    valid_gaps: 0, coverage_cases: 0, linked_cases: 0, linked_coverage_cases: 0, linked_valid_gaps: 0, unverified_refs: 0,
  })
})

test('case quality requires ready for both blackbox and graybox and retains all auxiliary and unknown cases', () => {
  const cases = ['business_blackbox', 'developer_assisted', 'whitebox_support', 'interface_contract', 'future_level'].flatMap(test_level =>
    ['ready', 'needs_instrumentation', 'unknown', undefined].map(execution_readiness => ({ format_version: 'behavior-test-case-v1', test_level, execution_readiness })))
  cases.push({ test_level: 'business_blackbox', execution_readiness: 'ready' })
  const original = JSON.stringify(cases)
  assert.deepEqual(caseQualitySummary(cases), {
    total_cases: 21, business_blackbox: 4, developer_assisted: 4, ready_blackbox: 1, ready_graybox: 1, ready_cases: 2,
    has_legacy_groups: false, ready_ratio: 2 / 21,
  })
  assert.equal(JSON.stringify(cases), original)
  assert.equal(caseQualitySummary([{ format_version: 'behavior-test-case-v1', test_level: 'whitebox_support' }]).ready_ratio, 0)
  assert.equal(caseQualitySummary([]).ready_ratio, null)
  const legacy = caseQualitySummary([...cases, { source_record: { kind: 'test_case_group' } }])
  assert.equal(legacy.total_cases, 22)
  assert.equal(legacy.has_legacy_groups, true)
  assert.equal(legacy.ready_ratio, null)
})

test('coverage display accepts explicit legacy declarations and single references without converting numeric identifiers', () => {
  const cases = [{ purpose: 'coverage', coverage_refs: ['G1'] },
    { format_version: 'behavior-test-case-v1', purpose: 'branch', coverage_refs: 'G1' },
    { purpose: 'coverage', coverage_refs: { coverage_id: 'G2' } }]
  assert.deepEqual(coverageSummary(cases, [{ coverage_id: 'G1' }, { coverage_id: 'G2' }]), {
    valid_gaps: 2, coverage_cases: 2, linked_cases: 3, linked_coverage_cases: 2, linked_valid_gaps: 2, unverified_refs: 0,
  })
  assert.deepEqual(coverageSummary([{ purpose: 'coverage', coverage_refs: ['7', 7, { coverage_id: 7 }] },
    { purpose: 'branch', coverage_refs: ['G1'] }], [{ coverage_id: 'G1' }, { coverage_id: 7 }, { coverage_id: '' }]), {
    valid_gaps: 1, coverage_cases: 1, linked_cases: 1, linked_coverage_cases: 0, linked_valid_gaps: 1, unverified_refs: 1,
  })
})

test('risk display maps explicit historical aliases while retaining canonical values and original bodies', () => {
  for (const format_version of ['pangea-risk-v1', 'risk-v1', 'behavior-risk-v1', 'behavior-risk-v2']) {
    const body = { format_version, title: 'Risk', result: 'Declared system result', observed: 'Declared observation', test_case_refs: ['TC-1'], body: 'Original prose remains intact' }
    const original = JSON.stringify(body)
    const value = sourceFirstProjection([action('u', [record('r', 'risk', original), record('c', 'test_case', { case_id: 'TC-1' })])])
    assert.equal(value.risks[0].system_result, body.result)
    assert.equal(value.risks[0].external_observation, body.observed)
    assert.deepEqual(value.risks[0].linked_test_case_ids, ['u/c'])
    assert.equal(value.risks[0].source_record.body, original)
    assert.equal(value.risks[0].trigger, '')
    const canonical = { ...body, system_result: 'Canonical result', external_observation: 'Canonical observation', linked_test_case_ids: [] }
    const preferred = sourceFirstProjection([action('u', [record('r', 'risk', canonical), record('c', 'test_case', { case_id: 'TC-1' })])]).risks[0]
    assert.equal(preferred.system_result, 'Canonical result')
    assert.equal(preferred.external_observation, 'Canonical observation')
    assert.deepEqual(preferred.linked_test_case_ids, [])
    assert.equal(preferred.source_record.body, canonical)
  }
})

test('inspection ledger stays separate from notes, aliases and case exports; risk quotes retain locations', () => {
  const body = { format_version: 'behavior-risk-v2', risk_id: 'R1', source_evidence: ['r:a.c:2'], evidence_quotes: [{ ref: 'r:a.c:2', snippet: ' * original comment' }] }
  const check = { check_id: 'C1', risk_id: 'R1', risk_ids: ['R1'], sites: ['r:a.c:2'] }
  const value = sourceFirstProjection([action('u', [record('r', 'risk', body), record('c', 'check', check), record('t', 'test_case', { case_id: 'T1', risk_refs: ['R1'] })])])
  assert.equal(value.checks.length, 1)
  assert.equal(value.notes.length, 0)
  assert.equal(value.test_cases[0].unit_notes.length, 0)
  assert.deepEqual(value.test_cases[0].linked_risk_ids, ['u/r'])
  assert.equal(value.risks[0].evidence[0].location, 'r:a.c:2')
  assert.equal(value.risks[0].evidence[0].quote, ' * original comment')
  assert.equal(value.evidence.some(e => !e.location), false)
})

test('decision edge belongs to its source node, full path does not move condition to entry', () => {
  const flow = sourceFirstProjection([action('a', [record('flow', 'flow', {
    nodes: [{ id: 'entry', label: 'TCP进入' }, { id: 'peek', label: '窥探首字节' }, { id: 'plain', label: '明文处理' }],
    edges: [{ source: 'entry', target: 'peek' }, { source: 'peek', target: 'plain', condition: '首字节 != 0x16' }],
    paths: [{ path_id: 'plain-path', node_ids: ['entry', 'peek', 'plain'], condition: '首字节 != 0x16' }]
  })])]).business_flows[0]
  assert.equal(flow.branches[0].condition, '')
  assert.equal(flow.branches[1].from_step_id, 'peek')
  assert.equal(flow.branches[1].condition, '首字节 != 0x16')
  assert.equal(flow.paths[0].condition, '首字节 != 0x16')
})

test('flow compatibility notes reach visible projection warnings without changing source records', () => {
  const body = JSON.stringify({ flow: { nodes: [{ node_id: 'a', name: 'Start' }], edges: [] } })
  const flow = sourceFirstProjection([action('a', [record('f', 'flow', body)])]).business_flows[0]
  assert.ok(flow.normalize_notes.length)
  for (const note of flow.normalize_notes) assert.ok(flow.projection_warnings.includes(note))
  assert.equal(new Set(flow.projection_warnings).size, flow.projection_warnings.length)
  assert.equal(flow.source_record.body, body)
  const broken = sourceFirstProjection([action('a', [record('broken', 'flow', { title: 'Declared title', nodes: [] })])]).business_flows[0]
  assert.equal(broken.title, 'Declared title')
  assert.deepEqual(JSON.parse(broken.raw_text), broken.source_record.body)
})

const projectFlow = body => sourceFirstProjection([action('u', [record('f', 'flow', body)])]).business_flows[0]
const branchedFlow = () => ({
  nodes: [{ id: 'error', kind: 'error', label: 'Failure' }, { id: 'end', kind: 'exit', label: 'End' },
    { id: 'middle', kind: 'main', label: 'Work' }, { id: 'start', kind: 'entry', label: 'Start' }],
  edges: [{ source_step_key: 'start', target_step_key: 'middle' }, { source_step_key: 'middle', target_step_key: 'end' },
    { source_step_key: 'middle', target_step_key: 'error' }],
})

test('mainline follows the declared first path while retaining all graph nodes and branches', () => {
  const body = { ...branchedFlow(), paths: [{ node_ids: ['start', 'middle', 'start', 'end'] }] }
  const before = structuredClone(body)
  const flow = projectFlow(body)
  assert.deepEqual(flow.mainline_steps.map(step => step.step_id), ['start', 'middle', 'start', 'end'])
  assert.equal(flow.nodes.length, 4)
  assert.equal(flow.branches.length, 3)
  assert.deepEqual(body, before)
})

test('mainline without a valid first path topologically orders only declared main kinds', () => {
  for (const paths of [[], [{ node_ids: ['start', 'missing', 'end'] }]]) {
    const flow = projectFlow({ ...branchedFlow(), paths })
    assert.deepEqual(flow.mainline_steps.map(step => step.step_id), ['start', 'middle', 'end'])
    assert.equal(flow.nodes.length, 4)
  }
  const flow = projectFlow({ nodes: [{ id: 'a', label: 'Undeclared role' }], edges: [] })
  assert.deepEqual(flow.mainline_steps, [])
  assert.equal(flow.nodes.length, 1)
})

test('cyclic main nodes remain visible with an ordering notice', () => {
  const body = branchedFlow()
  body.edges.push({ source_step_key: 'end', target_step_key: 'middle' })
  const flow = projectFlow(body)
  assert.equal(flow.mainline_steps.length, 3)
  assert.ok(flow.projection_warnings.some(note => note.includes('拓扑')))
  assert.equal(flow.nodes.length, 4)
})
