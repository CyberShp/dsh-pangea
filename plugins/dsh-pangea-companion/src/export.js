function cell(value) {
  if (Array.isArray(value)) return value.map(item => cell(item)).join('；')
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value, null, 0)
  return String(value)
}

function testCaseRows(run) {
  const rows = [
    ['Run', run?.run_id],
    ['结果状态', run?.publication?.state ?? 'pending'],
    ['结果 revision', run?.publication?.revision ?? 0],
    ['发布步骤', run?.publication?.step_id],
    ['复核结论', run?.semantic_review?.verdict ?? '未给出语义结论'],
    ['源码快照', run?.source_snapshot?.snapshot_digest ?? run?.source_snapshot?.status],
    ['目标', run?.target],
    ['流程状态', run?.lifecycle_status],
    ['交付完整性', run?.delivery_integrity?.status ?? 'not_checked'],
    ['审查方式', run?.semantic_review?.method ?? 'not_recorded'],
    [],
    ['用例 ID', '标题', '类型', '状态', '关联风险', '前置条件', '执行步骤', '预期结果', '观察点', '清理动作'],
  ]
  for (const item of run?.details?.test_cases ?? []) {
    rows.push([
      item.test_case_id,
      item.title,
      item.case_type,
      item.status,
      item.linked_risk_ids,
      item.preconditions,
      item.steps,
      item.expected_results,
      item.observability,
      item.cleanup,
    ])
  }
  return rows
}

export function csvCell(value) {
  const text = cell(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function buildTestCaseCsv(run) {
  const rows = testCaseRows(run)
  return `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`
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
      const style = row[0] === '用例 ID' ? ' s="1"' : ''
      const content = cell(value)
      if (!content) return `<c r="${reference}"${style}/>`
      return `<c r="${reference}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(content)}</t></is></c>`
    }).join('')
    return `<row r="${rowIndex + 1}">${cells}</row>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`+
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`+
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${rows.findIndex(row => row[0] === '用例 ID') + 1}" topLeftCell="A${rows.findIndex(row => row[0] === '用例 ID') + 2}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`+
    `<sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="10" width="28" customWidth="1"/></cols>`+
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

function zipStore(entries) {
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
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="测试用例" sheetId="1" r:id="rId1"/></sheets></workbook>`
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs></styleSheet>`
  return zipStore([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', worksheetXml(rows)],
    ['xl/styles.xml', styles],
  ])
}
