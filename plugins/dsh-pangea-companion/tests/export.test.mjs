import assert from 'node:assert/strict'
import test from 'node:test'

import { buildTestCaseCsv, csvCell } from '../src/export.js'

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
