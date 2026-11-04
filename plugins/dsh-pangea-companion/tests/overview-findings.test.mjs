import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOverviewFindings } from '../src/overview-findings.js'
test('overview findings keep provenance and never turn expected case outcomes into findings', () => {
  const current = { workflow: { unresolved: [{ id: 'w', message: '需要补充外部验证' }] }, details: { test_cases: [{ title: '用例', expected_result: '测试应该通过' }] } }
  const rows = buildOverviewFindings({ current, risks: [{ risk_id: 'r', title: '清理路径待验证', trigger: '连接中断', linked_test_case_ids: ['case-a'] }], notes: [{ record_id: 'n', kind: 'note', body: { summary: '已整理的源码观察' } }] })
  assert.equal(rows[0].kind, 'workflow'); assert.deepEqual(rows[1].sourceRefs, ['r']); assert.equal(rows[1].validationState, '待验证')
  assert.doesNotMatch(JSON.stringify(rows), /测试应该通过/)
  assert.equal(buildOverviewFindings({ current: { details: current.details } }).length, 0)
})

test('structured summaries remain readable text without mutating source records', () => {
  const summary = { total: 4, designed: 1, missing: 1, unresolved: 2, not_applicable: 0 }
  const notes = [{ record_id: 'n', kind: 'note', body: { summary } }]
  const before = JSON.stringify(notes)
  const rows = buildOverviewFindings({ notes, current: { workflow: { unresolved: [{ summary }] } },
    risks: [{ risk_id: 'r', title: { message: 'risk' }, narrative: { conditions: ['a', 'b'] } }] })
  for (const row of rows) {
    assert.equal(typeof row.title, 'string')
    assert.equal(typeof row.summary, 'string')
  }
  assert.equal(rows.find(row => row.kind === 'note').summary, '总计 4 · 已设计 1 · 待补用例 1 · 待确认 2 · 不适用 0')
  assert.equal(rows.find(row => row.kind === 'risk').summary, '{"conditions":["a","b"]}')
  assert.equal(JSON.stringify(notes), before)
})

test('record-only NVMe review findings use a neutral label and retain their complete source', () => {
  const finding = { kind: 'source_first_review_finding', record_ids: ['rec-000001', 'rec-000002', 'rec-000003'] }
  const before = JSON.stringify(finding)
  const [row] = buildOverviewFindings({ current: { workflow: { unresolved: [finding] } } })
  assert.equal(row.title, '审查发现 · 3 条记录')
  assert.equal(row.titlePreview, row.title)
  assert.equal(row.summaryPreview, '引用记录：rec-000001、rec-000002、rec-000003')
  assert.equal(row.sourceRecord, finding)
  assert.equal(row.summary, before)
  assert.equal(row.validationState, '待处理')
  assert.deepEqual(row.caseRefs, [])
  assert.equal(JSON.stringify(finding), before)
})

test('unknown structured values and encoded JSON never become default-surface labels', () => {
  const unknown = { kind: 'future_record', unexpected: { result: 'not verified' } }
  const rows = buildOverviewFindings({ current: { workflow: { unresolved: [unknown, JSON.stringify(unknown)] } },
    risks: [{ risk_id: 'r', title: { message: '明确的原始标题' }, narrative: unknown },
      { risk_id: 'encoded', title: '```json\n{"title":"已记录的标题"}\n```' }],
    notes: [{ kind: 'note', record_id: 'n', body: { title: JSON.stringify(unknown), summary: unknown } }] })
  for (const row of rows) {
    assert.doesNotMatch(row.title, /[{}]|unexpected|future_record|not verified/)
    assert.doesNotMatch(row.summaryPreview, /[{}]|unexpected|future_record|not verified/)
  }
  assert.equal(rows.find(row => row.id === 'risk:r').title, '明确的原始标题')
  assert.equal(rows.find(row => row.id === 'risk:encoded').title, '已记录的标题')
  assert.equal(rows.find(row => row.id === 'note:n').summary, JSON.stringify(unknown))
})

test('bounded previews retain full authored prose and function identifiers without fabricating a summary', () => {
  const title = '认证路径 '.repeat(30)
  const summary = '**Analysis unit**: `nvme_fabric_qpair_authenticate_poll`\n\n' + '原始分析说明包含具体约束。'.repeat(100)
  const record = { kind: 'note', record_id: 'long', body: { title, summary } }
  const [row] = buildOverviewFindings({ notes: [record] })
  assert.equal(row.title, title.trim())
  assert.ok(Array.from(row.titlePreview).length <= 80)
  assert.ok(Array.from(row.summaryPreview).length <= 180)
  assert.ok(row.titlePreview.endsWith('…'))
  assert.ok(row.summaryPreview.endsWith('…'))
  assert.match(row.summaryPreview, /nvme_fabric_qpair_authenticate_poll/)
  assert.equal(row.summary, summary)
  assert.equal(row.sourceRecord, record)
})

test('record counts reflect unique explicit IDs and never claim verified or resolved results', () => {
  const rows = buildOverviewFindings({ current: { workflow: { unresolved: [
    { kind: 'source_first_review_finding', record_ids: ['a', '', null, 'a', ' b '] },
    { kind: 'source_first_review_finding', record_ids: null },
  ] } } })
  assert.deepEqual(rows.map(row => row.title), ['审查发现 · 2 条记录', '审查发现'])
  assert.ok(rows.every(row => row.validationState === '待处理'))
  assert.doesNotMatch(JSON.stringify(rows.map(row => [row.titlePreview, row.summaryPreview])), /已验证|已解决|通过/)
})
