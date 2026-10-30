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
