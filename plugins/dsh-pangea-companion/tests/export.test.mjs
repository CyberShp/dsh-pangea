import assert from 'node:assert/strict'
import test from 'node:test'
import { inflateRawSync } from 'node:zlib'

import { buildTestCaseCsv, buildTestCaseCsvBundle, buildTestCaseXlsx, caseEvidenceRows, csvCell } from '../src/export.js'
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

function zipEntry(archive, entryName) {
  const data = Buffer.from(archive)
  assert.equal(data.subarray(0, 2).toString(), 'PK')
  for (let offset = 0; offset + 30 <= data.length && data.readUInt32LE(offset) === 0x04034b50;) {
    const method = data.readUInt16LE(offset + 8), size = data.readUInt32LE(offset + 18)
    const nameLength = data.readUInt16LE(offset + 26), extraLength = data.readUInt16LE(offset + 28)
    const name = data.subarray(offset + 30, offset + 30 + nameLength).toString()
    const start = offset + 30 + nameLength + extraLength
    if (name === entryName) {
      const bytes = data.subarray(start, start + size)
      return (method === 8 ? inflateRawSync(bytes) : bytes).toString()
    }
    offset = start + size
  }
  assert.fail(`ZIP package has no ${entryName}`)
}

const xlsxSheet = xlsx => zipEntry(xlsx, 'xl/worksheets/sheet1.xml')
const unescapeXml = value => value.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name])
function xlsxRows(xlsx, sheet = 'sheet1.xml') {
  return [...zipEntry(xlsx, `xl/worksheets/${sheet}`).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(([, row]) =>
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


test('canonical observation exports stay eight columns and preserve coverage rationale in evidence only', () => {
  for (const observations of [[], ['原文 request() at repo:src/file.c:123']]) {
    const body = { format_version: 'behavior-test-case-v1', case_id: 'C', case_type: 'stale', test_level: 'business_blackbox', observability: ['stale'], external_observations: observations, summary: '原文依据\n第二行', coverage_refs: ['G'] }
    const run = { details: sourceFirstProjection([{ stage: 'unit_analysis', task: { unit_id: 'u' }, records: [{ record_id: 'c', kind: 'test_case', body }] }]) }
    const rows = csvRows(buildTestCaseCsv(run))
    assert.equal(rows[1].length, 8)
    assert.equal(rows[1][6], observations.join('\n'))
    assert.equal(rows[1][2], '业务黑盒')
    const evidence = caseEvidenceRows(run)
    assert.equal(evidence[1][evidence[0].indexOf('summary')], body.summary)
    assert.deepEqual(evidence[1][evidence[0].indexOf('coverage_refs')], ['G'])
  }
})

test('recovered and invalid case exports retain parse diagnostics and exact source bodies only in evidence', () => {
  const recoveredBody = '{\r\n  "case_id": "TC-11", "title": "空队列,出队 <边界> & 状态",\r\n' +
    '  "steps": [{"action": "读取空队列", "expected": "返回 EAGAIN"],\r\n' +
    '    {"action": "再次读取", "expected": "队列仍为空"}], "status": "not_run"\r\n}'
  const invalidBody = '{"case_id":"TC-12","steps":[\n"完整未能解析的原文，保留末段 <&>"'
  const offset = recoveredBody.indexOf('],')
  const recovered = { status: 'recovered', code: 'mismatched_closer', diagnostics: [
    { offset, line: 3, column: offset - recoveredBody.lastIndexOf('\n', offset), found: ']', expected: '}', message: '对象结束符与结构不匹配' },
  ] }
  const invalid = { status: 'invalid', code: 'incomplete_json', diagnostics: [
    { offset: invalidBody.length, line: 2, column: 25, found: '', expected: ']}', message: '原文未完整结束，未恢复内容' },
  ] }
  const items = [
    { projection_id: 'u/rec11', unit_id: 'u', display_id: 'TC-11', title: '空队列,出队 <边界> & 状态', status: 'not_run',
      step_pairs: [{ action: '读取空队列', expected: '返回 EAGAIN' }, { action: '再次读取', expected: '队列仍为空' }],
      record_parse: recovered, source_record: { record_id: 'rec11', kind: 'test_case', created_revision: 4, body: recoveredBody } },
    { projection_id: 'u/rec12', unit_id: 'u', display_id: 'TC-12', title: '待核对的用例记录', record_parse: invalid,
      source_record: { record_id: 'rec12', kind: 'test_case', created_revision: 5, body: invalidBody } },
    { projection_id: 'u/rec13', unit_id: 'u', display_id: 'TC-13', title: '正常用例',
      source_record: { record_id: 'rec13', kind: 'test_case', body: { title: '正常用例', status: 'not_run', external_observations: ['保留原文'] } } },
  ]
  const run = { run_id: 'run-parse', publication: { state: 'draft' }, details: { test_cases: items } }
  const before = JSON.stringify(run)
  const baseline = { ...run, details: { test_cases: items.map(({ record_parse, source_record, ...item }) => item) } }
  const mainRows = exportedRows(run)
  assert.equal(mainRows[1][4], '1. 读取空队列\n2. 再次读取')
  assert.equal(mainRows[1][5], '1. 返回 EAGAIN\n2. 队列仍为空')
  assert.equal(buildTestCaseCsv(run), buildTestCaseCsv(baseline), 'diagnostics do not alter the eight-column case projection')
  assert.equal(xlsxSheet(buildTestCaseXlsx(run)), xlsxSheet(buildTestCaseXlsx(baseline)))
  const bundle = buildTestCaseCsvBundle(run)
  assert.equal(zipEntry(bundle, 'cases.csv'), buildTestCaseCsv(run))
  assert.deepEqual(JSON.parse(zipEntry(bundle, 'manifest.json')).case_order, items.map(item => item.projection_id))
  const csvEvidence = csvRows(zipEntry(bundle, 'case-evidence.csv'))
  const xlsxEvidence = xlsxRows(buildTestCaseXlsx(run), 'sheet2.xml')
  assert.deepEqual(xlsxEvidence, csvEvidence, 'CSV and XLSX appendices preserve the same diagnostics and sources')
  const evidenceHeaders = csvEvidence[0]
  assert.deepEqual(evidenceHeaders.slice(-2), ['record_parse', 'source_record'])
  for (const [index, item] of items.entries()) {
    const row = csvEvidence[index + 1]
    assert.equal(row[evidenceHeaders.indexOf('用例身份')], item.projection_id)
    const parseCell = row[evidenceHeaders.indexOf('record_parse')]
    assert.deepEqual(parseCell ? JSON.parse(parseCell) : undefined, item.record_parse)
    const original = JSON.parse(row[evidenceHeaders.indexOf('source_record')])
    assert.deepEqual(original, item.source_record)
    assert.deepEqual(original.body, item.source_record.body, 'export does not substitute repaired content for the saved record body')
  }
  assert.equal(JSON.parse(csvEvidence[1][evidenceHeaders.indexOf('source_record')]).body.includes('"status": "not_run"'), true)
  assert.equal(JSON.stringify(run), before, 'export does not mutate parse status, source body or execution status')
})

test('ordinary case exports retain the existing evidence schema without parse columns', () => {
  const run = { details: { test_cases: [{ projection_id: 'u/c', title: '正常用例', oracle_detail: { expected: '未改变' }, source_record: { body: { title: '正常用例' } } }] } }
  const rows = caseEvidenceRows(run)
  assert.equal(rows[0].includes('record_parse'), false)
  assert.equal(rows[0].includes('source_record'), false)
  assert.equal(rows[0].at(-1), 'oracle_detail')
  assert.deepEqual(rows[1].at(-1), { expected: '未改变' })
  exportedRows(run)
})
