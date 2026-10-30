// Render the supported document notation as React nodes. Source HTML and
// unsupported notation remain text; no source value becomes an HTML attribute.
export function createAssetContentRenderer(h) {
  function inline(text) {
    const nodes = []
    let plain = ''
    const flush = () => { if (plain) { nodes.push(plain); plain = '' } }
    for (let index = 0; index < text.length;) {
      if (text[index] === '\\' && /[\\`*_\[\]|]/.test(text[index + 1] ?? '')) {
        plain += text[index + 1]; index += 2; continue
      }
      const marker = text[index] === '`' ? text.slice(index).match(/^`+/)[0]
        : text.startsWith('**', index) ? '**' : text.startsWith('__', index) ? '__' : null
      if (marker) {
        const end = text.indexOf(marker, index + marker.length)
        if (end > index + marker.length) {
          flush()
          const value = text.slice(index + marker.length, end)
          nodes.push(h(marker[0] === '`' ? 'code' : 'strong', { key: nodes.length }, marker[0] === '`' ? value : inline(value)))
          index = end + marker.length; continue
        }
      }
      plain += text[index++]
    }
    flush()
    return nodes
  }

  function tableCells(line) {
    let text = line.trim()
    if (text.startsWith('|')) text = text.slice(1)
    if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1)
    const cells = []
    let cell = '', code = ''
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index]
      if (char === '\\' && index + 1 < text.length) { cell += char + text[++index]; continue }
      if (char === '`') {
        const run = text.slice(index).match(/^`+/)[0]
        if (!code) code = run
        else if (code === run) code = ''
        cell += run; index += run.length - 1; continue
      }
      if (char === '|' && !code) { cells.push(cell.trim()); cell = '' }
      else cell += char
    }
    cells.push(cell.trim())
    return cells
  }

  const listMatch = line => line.match(/^(\s*)([-+*]|\d+[.)])\s+(.+)$/)
  function blocks(lines) {
    const result = []
    let index = 0
    const isTable = at => Boolean(lines[at]?.includes('|') && lines[at + 1]?.includes('|')
      && tableCells(lines[at + 1]).every(cell => /^:?-{3,}:?$/.test(cell))
      && tableCells(lines[at]).length === tableCells(lines[at + 1]).length)
    const isBlock = at => /^(?:\s*(`{3,}|~{3,})|#{1,6}\s+| {0,3}>)/.test(lines[at] ?? '') || Boolean(listMatch(lines[at] ?? '')) || isTable(at)
    while (index < lines.length) {
      const line = lines[index]
      if (!line.trim()) { index += 1; continue }
      const key = result.length
      const fence = line.match(/^\s*(`{3,}|~{3,})(.*)$/)
      if (fence) {
        const content = []
        index += 1
        const closing = new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`)
        while (index < lines.length && !closing.test(lines[index])) content.push(lines[index++])
        if (index < lines.length) index += 1
        result.push(h('pre', { key }, h('code', null, content.join('\n'))))
        continue
      }
      const heading = line.match(/^(#{1,6})\s+(.+)$/)
      if (heading) {
        result.push(h(`h${Math.min(6, heading[1].length + 2)}`, { key }, inline(heading[2])))
        index += 1; continue
      }
      if (/^ {0,3}>/.test(line)) {
        const quote = []
        while (index < lines.length && /^ {0,3}>/.test(lines[index])) quote.push(lines[index++].replace(/^ {0,3}> ?/, ''))
        result.push(h('blockquote', { key }, blocks(quote)))
        continue
      }
      if (isTable(index)) {
        const header = tableCells(line), rows = []
        index += 2
        while (index < lines.length && lines[index].trim() && lines[index].includes('|')) rows.push(tableCells(lines[index++]))
        const width = Math.max(header.length, ...rows.map(row => row.length))
        result.push(h('div', { key, className: 'pangea-asset-rich-table' }, h('table', null,
          h('thead', null, h('tr', null, Array.from({ length: width }, (_, cell) => h('th', { key: cell, scope: 'col' }, inline(header[cell] ?? ''))))),
          h('tbody', null, rows.map((row, rowIndex) => h('tr', { key: rowIndex }, Array.from({ length: width }, (_, cell) => h('td', { key: cell }, inline(row[cell] ?? '')))))))))
        continue
      }
      const first = listMatch(line)
      if (first) {
        const ordered = /^\d/.test(first[2]), indent = first[1].length, items = []
        while (index < lines.length) {
          const match = listMatch(lines[index])
          if (!match || match[1].length !== indent || /^\d/.test(match[2]) !== ordered) break
          const content = [match[3]]
          index += 1
          while (index < lines.length && lines[index].trim() && /^\s+/.test(lines[index]) && (lines[index].match(/^\s*/)[0].length > indent)) {
            content.push(lines[index].slice(Math.min(lines[index].match(/^\s*/)[0].length, indent + 2)))
            index += 1
          }
          items.push(h('li', { key: items.length, ...(ordered ? { value: Number.parseInt(match[2], 10) } : {}) }, blocks(content)))
        }
        result.push(h(ordered ? 'ol' : 'ul', { key, ...(ordered ? { start: Number.parseInt(first[2], 10) } : {}) }, items))
        continue
      }
      const paragraph = [line]
      index += 1
      while (index < lines.length && lines[index].trim() && !isBlock(index)) paragraph.push(lines[index++])
      result.push(h('p', { key }, inline(paragraph.join('\n'))))
    }
    return result
  }

  function body(text) {
    return h('div', { className: 'pangea-asset-rich-text' }, blocks(String(text ?? '').split(/\r?\n/)))
  }

  const literalFields = new Set(['path', 'file_path', 'source_path', 'source_name', 'location', 'url', 'uri', 'code', 'id', 'item_id', 'asset_id'])
  function value(input, { literal = false } = {}) {
    if (Array.isArray(input)) return input.length
      ? h('ul', { className: 'pangea-asset-value-list' }, input.map((entry, index) => h('li', { key: index }, value(entry, { literal })))) : '[]'
    if (input && typeof input === 'object') return Object.keys(input).length
      ? h('dl', { className: 'pangea-asset-value-fields' }, Object.entries(input).map(([key, entry]) => h('div', { key }, h('dt', null, key), h('dd', null, value(entry, { literal: literal || literalFields.has(key) }))))) : '{}'
    if (literal) return h('span', { className: 'pangea-asset-literal-value' }, input === null ? 'null' : String(input ?? ''))
    return body(input === null ? 'null' : String(input ?? ''))
  }
  return { body, value }
}

export const assetContentStyles = `
.pangea-asset-rich-text{font:inherit;line-height:1.75;white-space:normal;overflow-wrap:anywhere;min-width:0}
.pangea-asset-rich-text p{margin:0 0 .8em;white-space:pre-wrap;font-size:inherit;line-height:inherit}
.pangea-asset-rich-text :is(h3,h4,h5,h6){font-weight:650;line-height:1.45;margin:1.35em 0 .65em;font-size:1em}
.pangea-asset-rich-text h3{font-size:1.2em}.pangea-asset-rich-text h4{font-size:1.08em}
.pangea-asset-rich-text :is(ol,ul),.pangea-asset-value-list{margin:.5em 0 .9em;padding-left:1.6em}
.pangea-asset-rich-text ul,.pangea-asset-value-list{list-style:disc outside}.pangea-asset-rich-text ol{list-style:decimal outside}
.pangea-asset-rich-text li,.pangea-asset-value-list>li{margin:.3em 0;padding-left:.15em}
.pangea-asset-rich-text li>p{margin:0}.pangea-asset-rich-text li>:is(ol,ul){margin:.35em 0}
.pangea-asset-rich-text code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.92em;background:#eef0ed;border-radius:3px;padding:.12em .3em;color:inherit}
.pangea-asset-rich-text pre{margin:.9em 0;padding:14px 16px;background:#f4f5f2;border:1px solid #e1e5df;border-radius:6px;overflow-x:auto;white-space:pre;line-height:1.6}
.pangea-asset-rich-text pre code{padding:0;background:none;border-radius:0;white-space:pre}
.pangea-asset-rich-text blockquote{margin:.9em 0;padding:.2em 0 .2em 1em;border-left:3px solid #c9d3c3;color:#637384}
.pangea-asset-rich-table{overflow-x:auto;margin:.9em 0}.pangea-asset-rich-table table{border-collapse:collapse;width:100%;font-size:inherit;line-height:1.6}
.pangea-asset-rich-table :is(th,td){text-align:left;padding:9px 12px;border:1px solid #dfe4dc;vertical-align:top;min-width:90px;white-space:pre-wrap}.pangea-asset-rich-table th{background:#f3f5f0;font-weight:600}
.pangea-asset-rich-text>:first-child{margin-top:0}.pangea-asset-rich-text>:last-child{margin-bottom:0}
.pangea-asset-value-fields{display:grid;gap:6px;margin:0}.pangea-asset-value-fields>div{display:grid;grid-template-columns:minmax(0,112px) minmax(0,1fr);align-items:baseline;gap:4px 12px;min-width:0}.pangea-asset-value-fields dt{font-size:.88em;color:#637384;overflow-wrap:anywhere;min-width:0}.pangea-asset-value-fields dd{margin:0;min-width:0;overflow-wrap:anywhere}
.pangea-asset-value-list{margin-top:0;margin-bottom:0}.pangea-asset-detail-source-note>.pangea-asset-value-list,.pangea-asset-detail-source-note>.pangea-asset-value-fields{margin-top:8px}
.pangea-asset-literal-value{white-space:pre-wrap;overflow-wrap:anywhere}
`
