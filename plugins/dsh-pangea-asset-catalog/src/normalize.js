import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import ExcelJS from 'exceljs'
import mammoth from 'mammoth'
import PDFParser from 'pdf2json'
import TurndownService from 'turndown'

const NORMALIZABLE_SUFFIXES = new Set(['.docx', '.pdf', '.xlsx'])
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024
const MAX_WORKBOOK_CELLS = 100_000
const MAX_WORKBOOK_COLUMNS = 256
const MAX_WORKBOOK_SHEETS = 100

function sourceRef(relative, anchor = '') {
  const encoded = encodeURI(relative).replace(/--/g, '%2D%2D')
  return `${encoded}${anchor}`
}

function cleanMarkdown(value) {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function escapeTableCell(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
    .trim()
}

function annotateBlocks(markdown, relative) {
  const blocks = cleanMarkdown(markdown).split(/\n{2,}/).filter(Boolean)
  return blocks.map((block, index) => (
    `<!-- source: ${sourceRef(relative, `#block=${index + 1}`)} -->\n${block}`
  )).join('\n\n')
}

function tableMarkdown(node) {
  const rows = Array.from(node.querySelectorAll('tr')).filter(row => {
    let parent = row.parentNode
    while (parent && parent !== node && parent.nodeName !== 'TABLE') parent = parent.parentNode
    return parent === node
  }).map(row => Array.from(row.children)
    .filter(cell => cell.nodeName === 'TH' || cell.nodeName === 'TD')
    .map(cell => escapeTableCell(cell.textContent)))
    .filter(row => row.length > 0)
  if (!rows.length) return ''
  const width = Math.max(...rows.map(row => row.length))
  const padded = rows.map(row => [...row, ...Array(Math.max(0, width - row.length)).fill('')])
  const header = padded[0]
  const body = padded.slice(1)
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map(row => `| ${row.join(' | ')} |`),
  ].join('\n')
}

function htmlToMarkdown(html) {
  const converter = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
  })
  converter.remove(['script', 'style', 'img', 'svg'])
  converter.addRule('safe-link', {
    filter: 'a',
    replacement(content, node) {
      const href = node.getAttribute('href') ?? ''
      if (!/^(?:https?:|mailto:|#)/i.test(href)) return content
      return `[${content || href}](<${href.replace(/>/g, '%3E')}>)`
    },
  })
  converter.addRule('gfm-table', {
    filter: 'table',
    replacement(_content, node) { return `\n\n${tableMarkdown(node)}\n\n` },
  })
  return cleanMarkdown(converter.turndown(html))
}

async function convertDocx(absolute, relative) {
  const result = await mammoth.convertToHtml({ path: absolute }, {
    externalFileAccess: false,
    includeEmbeddedStyleMap: false,
    convertImage: mammoth.images.imgElement(async () => ({ src: '' })),
  })
  const markdown = annotateBlocks(htmlToMarkdown(result.value), relative)
  if (!markdown) throw new Error('document contains no extractable text')
  return {
    markdown,
    metadata: {
      location_scheme: 'normalized_block',
      block_count: (markdown.match(/<!-- source:/g) ?? []).length,
      warnings: result.messages.map(item => item.message).filter(Boolean).slice(0, 20),
    },
  }
}

function decodedPdfText(value) {
  try { return decodeURIComponent(value) } catch { return value }
}

function pageText(items) {
  const groups = []
  for (const item of items) {
    const text = Array.isArray(item?.R)
      ? item.R.map(run => decodedPdfText(String(run?.T ?? ''))).join('')
      : ''
    if (!text.trim()) continue
    const x = Number(item.x ?? 0)
    const y = Number(item.y ?? 0)
    const width = Number(item.w ?? 0)
    let line = groups.find(candidate => Math.abs(candidate.y - y) <= 0.25)
    if (!line) {
      line = { y, items: [] }
      groups.push(line)
    }
    line.items.push({ text, x, width })
  }
  groups.sort((left, right) => left.y - right.y)
  return groups.map(group => {
    group.items.sort((left, right) => left.x - right.x)
    let output = ''
    let previousEnd
    for (const item of group.items) {
      const gap = previousEnd === undefined ? 0 : item.x - previousEnd
      if (output && gap > 0.15) output += ' '
      output += item.text
      previousEnd = Math.max(previousEnd ?? item.x, item.x + item.width)
    }
    return output.trim()
  }).filter(Boolean).join('\n')
}

async function convertPdf(absolute, relative) {
  const buffer = await readFile(absolute)
  const parser = new PDFParser()
  const data = await new Promise((resolve, reject) => {
    parser.once('pdfParser_dataReady', resolve)
    parser.once('pdfParser_dataError', value => reject(value?.parserError ?? value))
    parser.parseBuffer(buffer, 0)
  })
  try {
    const sections = []
    let textPages = 0
    const pages = Array.isArray(data?.Pages) ? data.Pages : []
    for (const [index, page] of pages.entries()) {
      const pageNumber = index + 1
      const text = pageText(Array.isArray(page?.Texts) ? page.Texts : [])
      if (text) textPages += 1
      sections.push([
        `<!-- source: ${sourceRef(relative, `#page=${pageNumber}`)} -->`,
        `## Page ${pageNumber}`,
        text || '<!-- no-extractable-text -->',
      ].join('\n'))
    }
    if (textPages === 0) throw new Error('PDF contains no extractable text; it may be scanned or image-only')
    return {
      markdown: cleanMarkdown(sections.join('\n\n')),
      metadata: {
        location_scheme: 'page',
        page_count: pages.length,
        text_page_count: textPages,
        warnings: textPages < pages.length ? [`${pages.length - textPages} page(s) contain no extractable text`] : [],
      },
    }
  } finally {
    parser.destroy()
  }
}

function columnName(number) {
  let value = number
  let output = ''
  while (value > 0) {
    value -= 1
    output = String.fromCharCode(65 + (value % 26)) + output
    value = Math.floor(value / 26)
  }
  return output
}

function headingText(value) {
  return String(value).replace(/\r?\n/g, ' ').replace(/#+/g, '').trim()
}

function cellText(cell) {
  const value = cell.value
  const display = cell.text ?? ''
  if (value && typeof value === 'object' && 'formula' in value) {
    const formula = String(value.formula ?? '').replace(/`/g, '\\`')
    return display ? `${display} (formula: \`=${formula}\`)` : `\`=${formula}\``
  }
  if (value && typeof value === 'object' && 'hyperlink' in value) {
    const href = String(value.hyperlink ?? '')
    if (/^(?:https?:|mailto:)/i.test(href)) return `[${display || href}](<${href.replace(/>/g, '%3E')}>)`
  }
  return display
}

function worksheetBounds(worksheet) {
  let minRow = Infinity
  let maxRow = 0
  let minColumn = Infinity
  let maxColumn = 0
  worksheet.eachRow({ includeEmpty: false }, row => {
    row.eachCell({ includeEmpty: false }, cell => {
      if (cell.value === null || cell.value === undefined || cell.text === '') return
      minRow = Math.min(minRow, cell.row)
      maxRow = Math.max(maxRow, cell.row)
      minColumn = Math.min(minColumn, cell.col)
      maxColumn = Math.max(maxColumn, cell.col)
    })
  })
  return maxRow === 0 ? null : { minRow, maxRow, minColumn, maxColumn }
}

async function convertXlsx(absolute, relative) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(absolute)
  const sections = []
  const warnings = []
  let cellsWritten = 0
  let sheetCount = 0
  let truncated = false
  for (const worksheet of workbook.worksheets.slice(0, MAX_WORKBOOK_SHEETS)) {
    sheetCount += 1
    const bounds = worksheetBounds(worksheet)
    const sheetName = headingText(worksheet.name) || `Sheet ${sheetCount}`
    if (!bounds) {
      sections.push(`<!-- source: ${sourceRef(relative, `#sheet=${encodeURIComponent(worksheet.name)}`)} -->\n## Sheet: ${sheetName}\n\n<!-- empty-sheet -->`)
      continue
    }
    const maxColumn = Math.min(bounds.maxColumn, bounds.minColumn + MAX_WORKBOOK_COLUMNS - 1)
    if (maxColumn < bounds.maxColumn) {
      truncated = true
      warnings.push(`${worksheet.name}: columns after ${columnName(maxColumn)} were omitted`)
    }
    const width = maxColumn - bounds.minColumn + 1
    const remainingCells = MAX_WORKBOOK_CELLS - cellsWritten
    const maxRows = Math.max(0, Math.floor(remainingCells / Math.max(1, width)))
    if (maxRows === 0) {
      truncated = true
      warnings.push(`${worksheet.name}: sheet was omitted after reaching the cell limit`)
      break
    }
    const maxRow = Math.min(bounds.maxRow, bounds.minRow + maxRows - 1)
    if (maxRow < bounds.maxRow) {
      truncated = true
      warnings.push(`${worksheet.name}: rows after ${Math.max(bounds.minRow - 1, maxRow)} were omitted`)
    }
    const range = `${columnName(bounds.minColumn)}${bounds.minRow}:${columnName(maxColumn)}${Math.max(bounds.minRow, maxRow)}`
    const columns = Array.from({ length: width }, (_value, index) => columnName(bounds.minColumn + index))
    const rows = []
    for (let rowNumber = bounds.minRow; rowNumber <= maxRow; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber)
      rows.push(`| ${rowNumber} | ${columns.map((_column, index) => escapeTableCell(cellText(row.getCell(bounds.minColumn + index)))).join(' | ')} |`)
      cellsWritten += width
    }
    sections.push([
      `<!-- source: ${sourceRef(relative, `#sheet=${encodeURIComponent(worksheet.name)}&range=${range}`)} -->`,
      `## Sheet: ${sheetName}`,
      `Used range: \`${range}\``,
      '',
      `| Row | ${columns.join(' | ')} |`,
      `| --- | ${columns.map(() => '---').join(' | ')} |`,
      ...rows,
    ].join('\n'))
    if (cellsWritten >= MAX_WORKBOOK_CELLS) break
  }
  if (workbook.worksheets.length > MAX_WORKBOOK_SHEETS) {
    truncated = true
    warnings.push(`sheets after ${MAX_WORKBOOK_SHEETS} were omitted`)
  }
  const markdown = cleanMarkdown(sections.join('\n\n'))
  if (!markdown || cellsWritten === 0) throw new Error('workbook contains no extractable cells')
  return {
    markdown,
    metadata: {
      location_scheme: 'sheet_cell',
      sheet_count: workbook.worksheets.length,
      converted_sheet_count: sheetCount,
      cell_count: cellsWritten,
      truncated,
      warnings,
    },
  }
}

function failureCode(error) {
  const message = error instanceof Error ? error.message : String(error)
  if (/password|encrypted/i.test(message) || error?.name === 'PasswordException') return 'password_required'
  if (/no extractable/i.test(message)) return 'no_extractable_text'
  return 'conversion_failed'
}

export async function normalizeDocument({ absolute, relative, assetId } = {}) {
  const suffix = path.extname(absolute ?? '').toLowerCase()
  const format = suffix.replace(/^\./, '')
  const info = await stat(absolute)
  if (!NORMALIZABLE_SUFFIXES.has(suffix)) {
    return { status: 'not_supported', size_bytes: info.size, text: '', normalization: null }
  }
  const markdownPath = `asset-catalog/normalized/${assetId}.md`
  if (info.size > MAX_DOCUMENT_BYTES) {
    return {
      status: 'too_large',
      size_bytes: info.size,
      text: '',
      normalization: {
        status: 'too_large', source_format: format, markdown_path: markdownPath,
        error_code: 'document_too_large', error: `document exceeds ${MAX_DOCUMENT_BYTES} byte limit`, warnings: [],
      },
    }
  }
  try {
    const converted = suffix === '.docx'
      ? await convertDocx(absolute, relative)
      : suffix === '.pdf'
        ? await convertPdf(absolute, relative)
        : await convertXlsx(absolute, relative)
    const warnings = converted.metadata.warnings ?? []
    return {
      status: warnings.length > 0 ? 'parsed_with_warnings' : 'parsed',
      size_bytes: info.size,
      text: converted.markdown,
      normalization: {
        status: warnings.length > 0 ? 'converted_with_warnings' : 'converted',
        source_format: format,
        markdown_path: markdownPath,
        ...converted.metadata,
      },
    }
  } catch (error) {
    return {
      status: 'conversion_failed',
      size_bytes: info.size,
      text: '',
      normalization: {
        status: 'failed', source_format: format, markdown_path: markdownPath,
        error_code: failureCode(error), error: error instanceof Error ? error.message : String(error), warnings: [],
      },
    }
  }
}

export { NORMALIZABLE_SUFFIXES }
