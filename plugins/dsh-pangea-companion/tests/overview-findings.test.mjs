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
