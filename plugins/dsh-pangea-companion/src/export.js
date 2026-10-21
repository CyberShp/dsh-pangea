import { CASE_TYPE_LABELS, caseIdentity } from './case-review-projection.js'
function cell(value) {
  if (Array.isArray(value)) return value.map(item => cell(item)).join('；')
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value, null, 0)
  return String(value)
}

const CASE_HEADERS = ['用例ID', '标题', '类型', '前置条件', '操作步骤', '预期结果', '观察点', '清理动作（环境恢复）']

const list = value => Array.isArray(value) ? value : value == null ? [] : [value]
const lines = value => list(value).map(cell).filter(Boolean).join('\n')
const numbered = values => values.map((value, index) => `${index + 1}. ${value}`).join('\n')

function caseSteps(item) {
  // The projection's steps include "action → expected". Use its explicit pairs
  // instead of splitting that text, which may legitimately contain arrows.
  const steps = list(item.step_pairs?.length ? item.step_pairs : item.steps)
  const pairs = steps.map(step => step && typeof step === 'object'
    ? { action: cell(step.action ?? step.step), expected: cell(step.expected ?? step.expected_result) }
    : { action: cell(step), expected: '' })
  const hasExpected = pairs.some(step => step.expected)
  let actions = numbered(pairs.map(step => step.action || '未提供操作'))
  let expected = hasExpected ? numbered(pairs.map(step => step.expected || '未提供逐步预期')) : ''
  const overall = lines(item.expected_results)
  if (overall) expected = [expected, hasExpected ? `整体预期：\n${overall}` : overall].filter(Boolean).join('\n\n')
  if (cell(item.entry)) actions = [`操作入口：${cell(item.entry)}`, actions].filter(Boolean).join('\n\n')

  // Keep parameter combinations and their labels within the requested columns;
  // they remain part of the same case rather than extra rows.
  const variants = list(item.variants).map((value, index) => value && typeof value === 'object'
    ? { label: cell(value.variant_id) || String(index + 1), input: cell(value.input), expected: cell(value.expected) }
    : { label: String(index + 1), input: cell(value), expected: '' })
  if (variants.length) {
    actions = [actions, `参数组合：\n${variants.map(value => `${value.label}. ${value.input || '未提供输入'}`).join('\n')}`].filter(Boolean).join('\n\n')
    expected = [expected, `参数组合预期：\n${variants.map(value => `${value.label}. ${value.expected || '未提供预期'}`).join('\n')}`].filter(Boolean).join('\n\n')
  }
  return { actions, expected }
}

function testCaseRows(run) {
  return [CASE_HEADERS, ...(run?.details?.test_cases ?? []).map(item => {
    const { actions, expected } = caseSteps(item)
    const type = cell(item.case_type || item.test_level)
    return [
      item.display_id ?? item.test_case_id,
      item.title,
      CASE_TYPE_LABELS[type] ?? type,
      lines(item.preconditions),
      actions,
      expected,
      lines(item.observability ?? item.external_observations),
      lines(item.cleanup),
    ]
  })]
}

export function csvCell(value) {
  const text = cell(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function buildTestCaseCsv(run) {
  const rows = testCaseRows(run)
  return `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

export function caseEvidenceRows(run) {
  const fields = ['execution_readiness', 'readiness_reason', 'test_level', 'purpose', 'source_evidence', 'entry', 'oracle', 'oracles', 'oracle_source', 'oracle_evidence', 'entry_source', 'entry_evidence', 'test_entry', 'test_oracle', 'readiness']
  const items = run?.details?.test_cases ?? []
  // Preserve additional entry/oracle fields verbatim as the contract evolves.
  const extras = [...new Set(items.flatMap(item => Object.keys(item).filter(key => /entry|oracle/.test(key) && !fields.includes(key))))].sort()
  const keys = [...fields, ...extras]
  return [['序号', '用例身份', '单元ID', '用例ID', ...keys], ...items.map((item, index) => [index + 1, caseIdentity(item), item.unit_id, item.display_id ?? item.test_case_id, ...keys.map(key => item[key])])]
}

export function buildTestCaseCsvBundle(run) {
  const evidence = `\uFEFF${caseEvidenceRows(run).map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`
  return zipStore([['cases.csv', buildTestCaseCsv(run)], ['case-evidence.csv', evidence], ['manifest.json', JSON.stringify({ run_id: run.run_id, publication: run.publication, case_order: (run.details?.test_cases ?? []).map(caseIdentity) }, null, 2)]])
}

function xml(value) {
  return cell(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function columnName(index) {
  let value = index + 1
  let result = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}

function worksheetXml(rows) {
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`
      const style = rowIndex === 0 ? ' s="1"' : ''
      const content = cell(value)
      if (!content) return `<c r="${reference}"${style}/>`
      return `<c r="${reference}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(content)}</t></is></c>`
    }).join('')
    return `<row r="${rowIndex + 1}">${cells}</row>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`+
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`+
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`+
    `<sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="18" customWidth="1"/><col min="2" max="2" width="32" customWidth="1"/><col min="3" max="3" width="16" customWidth="1"/><col min="4" max="${Math.max(8, rows[0]?.length ?? 8)}" width="48" customWidth="1"/></cols>`+
    `<sheetData>${sheetRows}</sheetData></worksheet>`
}

function crc32(data) {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function u16(value) {
  const output = Buffer.alloc(2)
  output.writeUInt16LE(value, 0)
  return output
}

function u32(value) {
  const output = Buffer.alloc(4)
  output.writeUInt32LE(value >>> 0, 0)
  return output
}

export function zipStore(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const [name, value] of entries) {
    const nameBuffer = Buffer.from(name, 'utf8')
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8')
    const checksum = crc32(data)
    const local = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(checksum), u32(data.length), u32(data.length), u16(nameBuffer.length), u16(0), nameBuffer, data,
    ])
    localParts.push(local)
    const central = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x01, 0x02]), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(checksum), u32(data.length), u32(data.length), u16(nameBuffer.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBuffer,
    ])
    centralParts.push(central)
    offset += local.length
  }
  const centralDirectory = Buffer.concat(centralParts)
  const locals = Buffer.concat(localParts)
  const end = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06]), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralDirectory.length), u32(locals.length), u16(0),
  ])
  return Buffer.concat([locals, centralDirectory, end])
}

export function buildTestCaseXlsx(run) {
  const rows = testCaseRows(run)
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`+
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="测试用例" sheetId="1" r:id="rId1"/><sheet name="执行条件与依据" sheetId="2" r:id="rId3"/></sheets></workbook>`
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs></styleSheet>`
  return zipStore([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', worksheetXml(rows)],
    ['xl/worksheets/sheet2.xml', worksheetXml(caseEvidenceRows(run))],
    ['xl/styles.xml', styles],
  ])
}
