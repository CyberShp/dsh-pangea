// call-graph-v1: function call graph with per-function variable flow.
// Validation is structural only: it reports itemized Chinese errors, drops the
// broken items from the display graph and never invents relationships. Explicit
// field aliases are read-only compatibility: the authored record is not changed.

export const CALL_GRAPH_FORMAT = 'call-graph-v1'
export const CALL_GRAPH_KINDS = ['function', 'macro', 'external']

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const str = value => typeof value === 'string' ? value.trim() : ''
function textField(value, where, errors) {
  if (value != null && typeof value !== 'string') errors.push(`${where} 必须是字符串`)
  return str(value)
}

// References must still be exact function ids. Never resolve an alias by label,
// source order or a single remaining candidate. Canonical fields take priority;
// conflicting aliases cannot supply a missing canonical reference.
function displayText(row, key, aliases, where, errors, reference = false) {
  const canonical = textField(row[key], `${where}.${key}`, errors)
  if (!reference && canonical) return canonical
  if (row[key] != null && typeof row[key] !== 'string') return ''
  const values = [key, ...aliases].flatMap(field => {
    if (field === key) return canonical ? [{ field, value: canonical }] : []
    if (row[field] == null) return []
    const value = textField(row[field], `${where}.${field}`, errors)
    return value ? [{ field, value }] : []
  })
  if (new Set(values.map(item => item.value)).size > 1) {
    errors.push(`${where}.${key} 的字段 ${values.map(item => item.field).join('/')} 相互冲突，${canonical ? `保留标准字段 ${key}` : '未采用兼容值'}`)
    return canonical
  }
  if (canonical) return canonical
  if (!values.length) return ''
  errors.push(`${where}.${key} 缺失，使用 ${values[0].field} 仅作兼容显示；原记录保留`)
  return values[0].value
}
function lineField(value, where, errors) {
  if (value == null) return null
  if (Number.isInteger(value) && value > 0) return value
  errors.push(`${where} 必须是正整数或 null`)
  return null
}
function stringList(value, where, errors, allowString = false) {
  if (value == null) return []
  if (allowString && typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (!Array.isArray(value)) {
    errors.push(`${where} 必须是${allowString ? '字符串或' : ''}字符串数组`)
    return []
  }
  return value.flatMap((item, index) => {
    if (typeof item !== 'string') { errors.push(`${where}[${index}] 必须是字符串`); return [] }
    return item.trim() ? [item.trim()] : []
  })
}

/** Empty result used when an Agent record cannot be parsed. */
function callGraphSkeleton(title = '', root = '') {
  return { format_version: CALL_GRAPH_FORMAT, title, root, functions: [], calls: [], variables: [], notes: [] }
}


/**
 * Normalize and validate a call-graph-v1 analysis record.
 * @returns {{status:'ok'|'partial'|'invalid', errors:string[], graph:object}}
 */
export function validateCallGraph(input) {
  const errors = []
  let value = input
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch (error) {
      return { status: 'invalid', errors: [`不是有效 JSON：${error.message}`], graph: callGraphSkeleton() }
    }
  }
  if (!isObject(value)) return { status: 'invalid', errors: ['顶层必须是 JSON 对象'], graph: callGraphSkeleton() }
  if (value.format_version !== CALL_GRAPH_FORMAT) errors.push(`format_version 缺失或不是 ${CALL_GRAPH_FORMAT}`)
  if (!Array.isArray(value.functions)) errors.push('functions 必须是数组')
  for (const key of ['calls', 'variables']) if (value[key] != null && !Array.isArray(value[key])) errors.push(`${key} 必须是数组`)

  const functions = []
  const ids = new Set()
  for (const [index, row] of (Array.isArray(value.functions) ? value.functions : []).entries()) {
    const where = `functions[${index}]`
    if (!isObject(row)) { errors.push(`${where} 不是对象`); continue }
    const id = str(row.id)
    if (!id) { errors.push(`${where} 缺少 id`); continue }
    if (ids.has(id)) { errors.push(`${where}.id='${id}' 重复`); continue }
    let kind = displayText(row, 'kind', ['type'], where, errors)
    if (!CALL_GRAPH_KINDS.includes(kind)) {
      errors.push(`${where}.kind='${kind}' 不是 function|macro|external，按 function 显示`)
      kind = 'function'
    }
    ids.add(id)
    functions.push({ id, kind, label: displayText(row, 'label', ['name'], where, errors) || id,
      signature: textField(row.signature, `${where}.signature`, errors), file: textField(row.file, `${where}.file`, errors), line: lineField(row.line, `${where}.line`, errors) })
  }
  if (Array.isArray(value.functions) && !functions.length) errors.push('functions 中没有有效函数')

  const calls = []
  for (const [index, row] of (Array.isArray(value.calls) ? value.calls : []).entries()) {
    const where = `calls[${index}]`
    if (!isObject(row)) { errors.push(`${where} 不是对象`); continue }
    let broken = false
    const endpoints = {
      from: displayText(row, 'from', ['caller', 'source'], where, errors, true),
      to: displayText(row, 'to', ['callee', 'target'], where, errors, true),
    }
    for (const key of ['from', 'to']) {
      const end = endpoints[key]
      if (!ids.has(end)) { errors.push(`${where}.${key}='${end}' 不在 functions 中`); broken = true }
    }
    if (broken) continue
    calls.push({ ...endpoints, file: textField(row.file, `${where}.file`, errors), line: lineField(row.line, `${where}.line`, errors),
      args: stringList(row.args, `${where}.args`, errors, true), returns: textField(row.returns, `${where}.returns`, errors) })
  }

  const variables = []
  for (const [index, row] of (Array.isArray(value.variables) ? value.variables : []).entries()) {
    const where = `variables[${index}]`
    if (!isObject(row)) { errors.push(`${where} 不是对象`); continue }
    const fn = displayText(row, 'function', ['function_id'], where, errors, true)
    const name = str(row.name)
    if (!ids.has(fn)) { errors.push(`${where}.function='${fn}' 不在 functions 中`); continue }
    if (!name) { errors.push(`${where} 缺少 name`); continue }
    // Older frozen rubrics did not constrain writes to string. Preserve every
    // authored array entry in the display; diagnostics for the current frozen
    // contract are produced separately by diagram-contract, never retroactively.
    const writes = Array.isArray(row.writes) && row.writes.every(item => typeof item === 'string')
      ? row.writes.join('\n') : textField(row.writes, `${where}.writes`, errors)
    variables.push({ function: fn, name, reads: stringList(row.reads, `${where}.reads`, errors), compute: textField(row.compute, `${where}.compute`, errors),
      writes, line: lineField(row.line, `${where}.line`, errors) })
  }

  let root = str(value.root)
  if (!ids.has(root)) {
    if (functions.length) errors.push(`root='${root}' 不在 functions 中，改用 ${functions[0].id}`)
    root = functions[0]?.id ?? ''
  }
  let notes
  if (typeof value.notes === 'string') {
    errors.push('notes 必须是字符串数组；原字符串仅作说明显示，原记录保留')
    notes = stringList(value.notes, 'notes', errors, true)
  } else notes = stringList(value.notes, 'notes', errors)
  const graph = { format_version: CALL_GRAPH_FORMAT, title: textField(value.title, 'title', errors), root, functions, calls, variables, notes }
  const status = !functions.length ? 'invalid' : errors.length ? 'partial' : 'ok'
  return { status, errors, graph }
}

/** Variable flow helper: call indexes whose args/returns mention a variable. */
export function callsForVariable(graph, fnId, variable) {
  const out = new Set()
  const name = variable?.name
  if (!name) return out
  const patterns = [name, variable.writes].filter(Boolean).map(value => new RegExp(`(^|[^A-Za-z0-9_])${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_]|$)`))
  const mentions = text => typeof text === 'string' && patterns.some(pattern => pattern.test(text))
  for (const [index, call] of (graph?.calls ?? []).entries()) {
    if (call.from !== fnId && call.to !== fnId) continue
    if (call.args.some(mentions) || mentions(call.returns)) out.add(index)
  }
  return out
}
