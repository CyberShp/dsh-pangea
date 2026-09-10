import assert from 'node:assert/strict'
import test from 'node:test'

import { buildTestCaseCsv, buildTestCaseXlsx, csvCell } from '../src/export.js'

test('escapes CSV cells and preserves multi-line test steps', () => {
  assert.equal(csvCell('a,b'), '"a,b"')
  assert.equal(csvCell('say "hi"'), '"say ""hi"""')
  const csv = buildTestCaseCsv({
    run_id: 'run-1', target: '认证流程', publication: { state: 'draft', revision: 2 },
    details: { test_cases: [{
      test_case_id: 'TC-1', title: '重连', case_type: 'recovery', status: 'draft', linked_risk_ids: ['R-1'],
      preconditions: ['网络已连接'], steps: ['断开网络', '恢复网络'], expected_results: ['会话恢复'],
      observability: ['日志无泄漏'], cleanup: ['清理会话'],
    }] },
  })
  assert.match(csv, /^\uFEFFRun,run-1/)
  assert.match(csv, /结果状态,draft/)
  assert.match(csv, /TC-1,重连,recovery,draft,R-1,网络已连接,断开网络；恢复网络,会话恢复,日志无泄漏,清理会话/)
})

test('builds a readable XLSX package with frozen header and wrapped test fields', () => {
  const xlsx = buildTestCaseXlsx({
    run_id: 'run-1', target: '认证流程', publication: { state: 'draft', revision: 2 },
    details: { test_cases: [{
      test_case_id: 'TC-1', title: '重连', case_type: 'recovery', status: 'draft', linked_risk_ids: ['R-1'],
      preconditions: ['网络已连接'], steps: ['断开网络', '恢复网络'], expected_results: ['会话恢复'],
      observability: ['日志无泄漏'], cleanup: ['清理会话'],
    }] },
  })
  assert.equal(Buffer.from(xlsx).subarray(0, 2).toString('ascii'), 'PK')
  assert.ok(Buffer.from(xlsx).includes(Buffer.from('ySplit="12"')))
  assert.ok(Buffer.from(xlsx).includes(Buffer.from('TC-1')))
})

test('semantic exports preserve business IDs, unit identity and original case text', () => {
  const run = { workflow_version: 'source-first-v1', details: { test_cases: [{
    test_case_id: 'unit-1/rec-1', display_id: 'TC-001', unit_id: 'unit-1',
    source_record: { record_id: 'rec-1', body: '输入：1,2\n预期：3' },
  }] } }
  const csv = buildTestCaseCsv(run)
  assert.match(csv, /分析单元,原始记录,分析原文/)
  assert.match(csv, /TC-001,/)
  assert.match(csv, /unit-1,rec-1,"输入：1,2\n预期：3"/)
  const xlsx = Buffer.from(buildTestCaseXlsx(run))
  assert.ok(xlsx.includes(Buffer.from('TC-001')))
  assert.ok(xlsx.includes(Buffer.from('输入：1,2\n预期：3')))
})
