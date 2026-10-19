import assert from 'node:assert/strict'
import test from 'node:test'
import { inflateRawSync } from 'node:zlib'

import { buildTestCaseCsv, buildTestCaseXlsx, csvCell } from '../src/export.js'
import { sourceFirstProjection } from '../src/source-first-projection.js'

const headers = ['用例ID', '标题', '类型', '前置条件', '操作步骤', '预期结果', '观察点', '清理动作（环境恢复）']

function csvRows(csv) {
  const rows = [], row = []
  let value = '', quoted = false
  const input = csv.replace(/^\uFEFF/, '')
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { value += '"'; i++ }
      else quoted = !quoted
    } else if (char === ',' && !quoted) { row.push(value); value = '' }
    else if ((char === '\r' || char === '\n') && !quoted) {
      if (char === '\r' && input[i + 1] === '\n') i++
      row.push(value); rows.push([...row]); row.length = 0; value = ''
    } else value += char
  }
  if (value || row.length) { row.push(value); rows.push(row) }
  assert.equal(quoted, false, 'CSV must not end inside a quoted field')
  return rows
}

function xlsxSheet(xlsx) {
  const data = Buffer.from(xlsx)
  assert.equal(data.subarray(0, 2).toString(), 'PK')
  for (let offset = 0; offset + 30 <= data.length && data.readUInt32LE(offset) === 0x04034b50;) {
    const method = data.readUInt16LE(offset + 8), size = data.readUInt32LE(offset + 18)
    const nameLength = data.readUInt16LE(offset + 26), extraLength = data.readUInt16LE(offset + 28)
    const name = data.subarray(offset + 30, offset + 30 + nameLength).toString()
    const start = offset + 30 + nameLength + extraLength
    if (name === 'xl/worksheets/sheet1.xml') {
      const bytes = data.subarray(start, start + size)
      return (method === 8 ? inflateRawSync(bytes) : bytes).toString()
    }
    offset = start + size
  }
  assert.fail('XLSX package has no test-case worksheet')
}

const unescapeXml = value => value.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name])
function xlsxRows(xlsx) {
  return [...xlsxSheet(xlsx).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(([, row]) =>
    [...row.matchAll(/<c\b[^>]*\/>|<c\b[^>]*>([\s\S]*?)<\/c>/g)].map(([, cell = '']) =>
      unescapeXml([...cell.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(([, text]) => text).join(''))))
}

function exportedRows(run) {
  const csv = buildTestCaseCsv(run)
  assert.ok(csv.startsWith('\uFEFF'), 'Excel CSV keeps its UTF-8 BOM')
  const rows = csvRows(csv)
  assert.deepEqual(rows[0], headers)
  assert.ok(rows.every(row => row.length === 8), 'every row has exactly eight columns')
  assert.equal(rows.length, (run?.details?.test_cases ?? []).length + 1, 'one row per case, without metadata or ledger rows')
  assert.deepEqual(xlsxRows(buildTestCaseXlsx(run)), rows, 'CSV and XLSX expose identical content')
  return rows
}

test('all analysis metadata, arbitrary unit notes and review notes stay out of the eight-column export', () => {
  const details = sourceFirstProjection([
    { action_id: 'analysis', stage: 'unit_analysis', task: { unit_id: 'u' }, records: [
      { record_id: 'c', kind: 'check', body: { check_id: 'C1', object: 'ledger-only-text' } },
      { record_id: 't', kind: 'test_case', body: { case_id: 'T1', title: 'case' } },
      { record_id: 'n', kind: 'note', body: 'unit-note-text' },
    ] },
    { action_id: 'comparison', stage: 'comparison_review', task: { unit_id: 'u' }, records: [
      { record_id: 'review', kind: 'note', body: { format_version: 'behavior-review-check-v1', summary: 'review-only-text' } },
    ] },
  ])
  const run = { workflow_version: 'source-first-v1', run_id: 'internal-run-id', publication: { state: 'draft', revision: 2 }, details }
  const rows = exportedRows(run)
  assert.equal(rows[1][0], 'T1')
  assert.doesNotMatch(JSON.stringify(rows), /unit-note-text|ledger-only-text|review-only-text|internal-run-id|结果状态|分析原文/)
})

test('CSV quoting and XLSX preserve commas, quotes, newlines and XML punctuation inside cells', () => {
  assert.equal(csvCell('a,b'), '"a,b"')
  assert.equal(csvCell('say "hi"'), '"say ""hi"""')
  const title = '重连,"恢复"\n检查 <连接> & 会话'
  const rows = exportedRows({ details: { test_cases: [{
    test_case_id: 'TC-1', title, case_type: '恢复', status: 'draft', linked_risk_ids: ['R-1'],
    preconditions: ['网络已连接'], steps: ['断开网络\n等待连接消失', '恢复网络'], expected_results: ['会话恢复'],
    observability: ['日志无泄漏'], cleanup: ['清理会话'],
  }] } })
  assert.equal(rows[1][1], title)
  assert.match(rows[1][4], /断开网络\n等待连接消失/)
  assert.match(rows[1][4], /恢复网络/)
  assert.match(rows[1][5], /会话恢复/)
  assert.doesNotMatch(JSON.stringify(rows), /draft|R-1/)
})

test('XLSX freezes the first header row and uses only columns A through H', () => {
  const run = { details: { test_cases: [{ test_case_id: 'TC-1', title: '重连' }] } }
  exportedRows(run)
  const sheet = xlsxSheet(buildTestCaseXlsx(run))
  assert.match(sheet, /ySplit="1"/)
  assert.match(sheet, /topLeftCell="A2"/)
  assert.doesNotMatch(sheet, /<c\b[^>]* r="(?:[I-Z]|[A-Z]{2,})\d+"/)
})

test('real source-first projection exports object actions and their expectations in separate numbered columns', () => {
  const details = sourceFirstProjection([{ action_id: 'analysis', stage: 'unit_analysis', task: { unit_id: 'u' }, records: [
    { record_id: 'case', kind: 'test_case', body: {
      case_id: 'TC-001', title: '错误密钥拒绝后恢复', test_level: 'business_blackbox',
      steps: [{ action: '使用错误密钥连接', expected: '连接被拒绝' }, { action: '改为正确密钥重连', expected: '连接成功' }],
      external_observations: ['设备列表变化'], cleanup: ['断开连接并恢复密钥'],
    } },
  ] }])
  assert.deepEqual(details.test_cases[0].expected_results, [], 'current record contract stores expectations inside steps')
  const before = JSON.stringify(details)
  const rows = exportedRows({ workflow_version: 'source-first-v1', details })
  assert.equal(rows[1][0], 'TC-001')
  assert.equal(rows[1][2], '业务黑盒')
  assert.match(rows[1][4], /1[.、)]\s*使用错误密钥连接/)
  assert.match(rows[1][4], /2[.、)]\s*改为正确密钥重连/)
  assert.doesNotMatch(rows[1][4], /连接被拒绝|连接成功/)
  assert.match(rows[1][5], /1[.、)]\s*连接被拒绝/)
  assert.match(rows[1][5], /2[.、)]\s*连接成功/)
  assert.doesNotMatch(rows[1][5], /使用错误密钥|改为正确密钥/)
  assert.match(rows[1][6], /设备列表变化/)
  assert.match(rows[1][7], /断开连接并恢复密钥/)
  assert.equal(JSON.stringify(details), before, 'export must not rewrite persisted projections')
})

test('legacy string steps and overall expectations remain readable without guessing a step association', () => {
  const rows = exportedRows({ details: { test_cases: [{
    test_case_id: 'TC-OLD', case_type: 'legacy_custom',
    steps: ['设置输入 1 → 观察结果 1', '恢复环境'], expected_results: ['最终会话恢复'],
    preconditions: ['旧前置'], observability: ['旧观察点'], cleanup: ['旧清理'],
  }] } })
  assert.equal(rows[1][2], 'legacy_custom')
  assert.match(rows[1][4], /设置输入 1 → 观察结果 1/)
  assert.match(rows[1][4], /恢复环境/)
  assert.match(rows[1][5], /最终会话恢复/)
  assert.doesNotMatch(rows[1][5], /观察结果 1|未提供逐步预期/)
  assert.doesNotMatch(rows[1][4], /最终会话恢复/)
})

test('entry and parameter variants stay in the corresponding operation and expectation cells without adding rows', () => {
  const rows = exportedRows({ workflow_version: 'source-first-v1', details: { test_cases: [{
    display_id: 'TC-1', test_case_id: 'u/c', entry: 'connect --target <target>',
    variants: [{ variant_id: 'V256', input: 'sha256', expected: '连接成功' }, { variant_id: 'V384', input: 'sha384', expected: '连接拒绝' }],
    unit_notes: [{ source_record: { body: 'unrelated-analysis-notes' } }],
    source_record: { record_id: 'c', body: 'raw-case-body' },
  }] } })
  assert.equal(rows[1][0], 'TC-1')
  for (const value of ['connect --target <target>', 'V256', 'sha256', 'V384', 'sha384']) assert.ok(rows[1][4].includes(value), value)
  for (const value of ['V256', '连接成功', 'V384', '连接拒绝']) assert.ok(rows[1][5].includes(value), value)
  assert.doesNotMatch(rows[1][4], /连接成功|连接拒绝/)
  assert.doesNotMatch(JSON.stringify(rows), /unrelated-analysis-notes|raw-case-body/)
})

test('known type enums are Chinese while existing Chinese and unknown types are preserved', () => {
  const types = ['business_blackbox', 'developer_assisted', 'interface_contract', 'whitebox_support', '协议异常', 'future_level']
  const rows = exportedRows({ details: { test_cases: types.map((case_type, index) => ({ test_case_id: `TC-${index}`, case_type })) } })
  assert.deepEqual(rows.slice(1).map(row => row[2]), ['业务黑盒', '业务灰盒', '接口契约', '白盒辅助', '协议异常', 'future_level'])
})

test('empty exports still contain the eight-column header and whole runs keep every case exactly once', () => {
  assert.deepEqual(exportedRows({ details: { test_cases: [] } }), [headers])
  const cases = Array.from({ length: 8 }, (_, index) => ({ display_id: `TC-${index + 1}`, title: `验证目标 ${index + 1}` }))
  const rows = exportedRows({ details: { test_cases: cases } })
  assert.deepEqual(rows.slice(1).map(row => row[0]), cases.map(item => item.display_id))
})
