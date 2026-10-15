import assert from 'node:assert/strict'
import test from 'node:test'
import { behaviorCoverageProjection, behaviorCoverageForCase, caseDesignCounts, caseSearchText, caseVariantLines } from '../src/behavior-coverage.js'
import { sourceFirstProjection } from '../src/source-first-projection.js'
import { buildTestCaseCsv, buildTestCaseXlsx } from '../src/export.js'

const record = (record_id, kind, body, extra = {}) => ({ record_id, kind, body, ...extra })
const action = (unit_id, records) => ({ action_id: `action-${unit_id}`, stage: 'unit_analysis', status: 'accepted', task: { unit_id }, records })
const ledger = overrides => ({ format_version: 'behavior-coverage-v1', unit_id: 'u1', scope: '配置与重连', combination_strategy: '按处理差异选择', unresolved_dependencies: ['重连观察命令待核实'], items: [
  { item_id: 'B1', operation: '连接', conditions: ['摘要 sha384'], constraints: ['双方支持组'], expected_behavior: '连接成功', source_evidence: ['r:a.c:12'], status: 'designed', reason: '已设计数据组合', case_refs: [{ case_id: 'TC-1', variant_id: 'V384' }] },
  { item_id: 'B2', operation: '取消后重试', conditions: [], constraints: [], expected_behavior: '恢复可用', source_evidence: [], status: 'missing', reason: '恢复入口待核实', case_refs: [] },
], ...overrides })

test('behavior coverage preserves declarations, explicit per-unit case/variant links and unlinked gaps', () => {
  const body = ledger()
  const cases = { case_id: 'TC-1', variants: [{ variant_id: 'V384', input: 'sha384 / ffdhe3072', expected: '连接成功' }, { input: '旧变体', expected: '拒绝' }], execution_readiness: 'unknown' }
  const source = [action('u1', [record('c', 'test_case', cases), record('n', 'note', body)]), action('u2', [record('c', 'test_case', cases)])]
  const before = JSON.stringify(source)
  const view = sourceFirstProjection(source)
  const item = view.behavior_coverage[0].items[0]
  assert.equal(item.case_links[0].target_case_id, 'u1/c')
  assert.equal(item.case_links[0].variant_index, 0)
  assert.equal(item.case_links[0].variant.variant_id, 'V384')
  assert.equal(view.behavior_coverage[0].items[1].status, 'missing')
  assert.equal(view.behavior_coverage[0].items[1].case_links.length, 0)
  assert.deepEqual(view.behavior_coverage[0].declared_counts, { designed: 1, missing: 1, unresolved: 0, not_applicable: 0, unclassified: 0 })
  assert.equal(view.notes[0].source_record.body, body)
  assert.deepEqual(caseDesignCounts(view.test_cases), { cases: 2, variants: 4, has_legacy_groups: false })
  assert.equal(behaviorCoverageForCase(view.behavior_coverage, view.test_cases[1]).length, 0)
  assert.equal(behaviorCoverageForCase(view.behavior_coverage, view.test_cases[0])[0].item_id, 'B1')
  assert.equal(JSON.stringify(source), before)
})

test('unknown, malformed, duplicate and superseded declarations are not completed or silently linked', () => {
  const bad = ledger({ items: [null, { item_id: 'B0', status: 'future', case_refs: [{ case_id: 'TC-404' }] },
    { item_id: 'B3', status: 'designed', case_refs: [{ case_id: 'TC-1', variant_id: 'missing' }] }] })
  const view = sourceFirstProjection([action('u1', [record('old', 'note', ledger()), record('new', 'note', bad, { supersedes: ['old'] }),
    record('future', 'note', { format_version: 'behavior-coverage-v9', items: ['unknown'] }),
    record('c', 'test_case', { case_id: 'TC-1', variants: [] })])])
  assert.equal(view.behavior_coverage.length, 1)
  assert.equal(view.notes.length, 2)
  assert.equal(view.behavior_coverage[0].items[0].source_item, null)
  assert.ok(view.behavior_coverage[0].items[0].projection_warnings.length)
  assert.equal(view.behavior_coverage[0].items[1].status, 'future')
  assert.equal(view.behavior_coverage[0].items[1].case_links[0].target_case_id, null)
  assert.match(view.behavior_coverage[0].items[2].case_links[0].issue, /未找到.*参数变体/)
  const duplicate = behaviorCoverageProjection([{ ...ledger(), projection_id: 'n' }], [
    { unit_id: 'u1', case_id: 'TC-1', test_case_id: 'c1' }, { unit_id: 'u1', case_id: 'TC-1', test_case_id: 'c2' }])
  assert.match(duplicate[0].items[0].case_links[0].issue, /不唯一/)
  const malformed = behaviorCoverageProjection([{ ...ledger({ items: '原始清单' }), projection_id: 'n' }], [])
  assert.ok(malformed[0].projection_warnings.length)
  const mismatchedUnit = sourceFirstProjection([action('u1', [record('n', 'note', ledger({ unit_id: 'u2' }))])]).behavior_coverage[0]
  assert.equal(mismatchedUnit.unit_id, 'u1')
  assert.ok(mismatchedUnit.projection_warnings.some(value => value.includes('单元不一致')))
})

test('case search and copy include explicit variant IDs, inputs and expectations without readiness claims', () => {
  const item = { title: '连接', variants: [{ variant_id: 'KEY-384', input: 'sha384，DH ffdhe3072', expected: '连接被拒绝后恢复' }] }
  for (const query of ['key-384', 'sha384', 'ffdhe3072', '拒绝后恢复']) assert.ok(caseSearchText(item).includes(query))
  assert.match(caseVariantLines(item)[0], /KEY-384.*sha384.*ffdhe3072.*恢复/)
  assert.deepEqual(caseDesignCounts([item]), { cases: 1, variants: 1, has_legacy_groups: false })
  assert.deepEqual(caseDesignCounts([{ source_record: { kind: 'test_case_group' } }]), { cases: 1, variants: 0, has_legacy_groups: true })
})

test('CSV and XLSX retain variants, missed behavior items, linkage diagnostics and original notes', () => {
  const details = sourceFirstProjection([action('u1', [record('c', 'test_case', { case_id: 'TC-1', variants: [{ variant_id: 'V384', input: 'sha384 / ffdhe3072', expected: '连接成功' }] }), record('n', 'note', ledger())])])
  // Records without source metadata still get the same source-first columns.
  details.test_cases.push({ test_case_id: 'old', title: '旧用例', variants: [] })
  const run = { workflow_version: 'source-first-v1', analysis_profile: 'behavior-test-v2', scenario: 'branch-analysis', details }
  for (const output of [buildTestCaseCsv(run), Buffer.from(buildTestCaseXlsx(run)).toString()]) {
    for (const value of ['已设计参数组合数', '参数组合数', 'V384', 'ffdhe3072', '业务行为覆盖清单', 'B2', '恢复入口待核实', '待补用例', '清单原文']) assert.ok(output.includes(value), value)
    assert.ok(!output.includes('可执行变体'))
  }
})

test('stable mainline and parallel-edge path associations follow explicit identities only', () => {
  const body = { layout_version: 'stable-v1', main_path_ids: [], flow_id: 'f', nodes: [{ id: 'a', label: '入口' }, { id: 'b', label: '完成' }],
    edges: [{ edge_id: 'yes', source_step_key: 'a', target_step_key: 'b', condition: '允许' }, { edge_id: 'no', source_step_key: 'a', target_step_key: 'b', condition: '拒绝' }],
    paths: [{ path_id: 'p', node_ids: ['a', 'b'], edge_ids: ['yes'] }, { path_id: 'legacy', node_ids: ['a', 'b'] }] }
  const project = value => sourceFirstProjection([action('u1', [record('f', 'flow', value)])]).business_flows[0]
  let flow = project(body)
  assert.deepEqual(flow.mainline_steps, [])
  assert.equal(flow.branches[0].edge_id, 'yes')
  assert.deepEqual(flow.branches.map(row => row.path_ids), [['p'], []])
  flow = project({ ...body, main_path_ids: ['p'] })
  assert.deepEqual(flow.mainline_steps.map(step => step.step_id), ['a', 'b'])
  assert.deepEqual(project({ ...body, main_path_ids: ['p', 'legacy'] }).mainline_steps, [])
  const duplicate = project({ ...body, edges: body.edges.map(edge => ({ ...edge, edge_id: 'yes' })) })
  assert.deepEqual(duplicate.branches.map(row => row.path_ids), [[], []])
  assert.ok(duplicate.projection_warnings.some(value => value.includes('不唯一')))
  const mismatch = project({ ...body, paths: [{ path_id: 'p', node_ids: ['b', 'a'], edge_ids: ['yes'] }] })
  assert.deepEqual(mismatch.branches.map(row => row.path_ids), [[], []])
  assert.ok(mismatch.projection_warnings.some(value => value.includes('节点顺序不一致')))
})
