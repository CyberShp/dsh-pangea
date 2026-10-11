// call-graph-v1: function call graph with per-function variable flow.
// Validation is structural only: it reports itemized Chinese errors, drops the
// broken items from the sanitized graph and never invents content.

export const CALL_GRAPH_FORMAT = 'call-graph-v1'
export const CALL_GRAPH_KINDS = ['function', 'macro', 'external']

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const str = value => typeof value === 'string' ? value.trim() : ''
function textField(value, where, errors) {
  if (value != null && typeof value !== 'string') errors.push(`${where} 必须是字符串`)
  return str(value)
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

/** Empty skeleton seeded into candidate.json. */
export function callGraphSkeleton(title = '', root = '') {
  return { format_version: CALL_GRAPH_FORMAT, title, root, functions: [], calls: [], variables: [], notes: [] }
}

export const CALL_GRAPH_EXAMPLE = {
  format_version: CALL_GRAPH_FORMAT,
  title: '登录请求处理',
  root: 'login_handler',
  functions: [
    { id: 'login_handler', kind: 'function', label: 'login_handler', signature: 'int login_handler(req_t *req)', file: 'src/login.c', line: 20 },
    { id: 'check_password', kind: 'function', label: 'check_password', signature: 'bool check_password(const char *user, const char *pw)', file: 'src/auth.c', line: 41 },
    { id: 'MAX_RETRY', kind: 'macro', label: 'MAX_RETRY', signature: '#define MAX_RETRY 5', file: 'src/auth.h', line: 8 },
    { id: 'strcmp', kind: 'external', label: 'strcmp', signature: '', file: '', line: null },
  ],
  calls: [
    { from: 'login_handler', to: 'check_password', file: 'src/login.c', line: 33, args: ['user', 'pw'], returns: 'ok' },
    { from: 'check_password', to: 'strcmp', file: 'src/auth.c', line: 47, args: ['hash', 'stored'], returns: '' },
  ],
  variables: [
    { function: 'login_handler', name: 'ok', reads: ['user', 'pw'], compute: 'check_password(user, pw)', writes: 'ok', line: 33 },
  ],
  notes: [],
}

/**
 * Validate a call-graph-v1 candidate.
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
    let kind = str(row.kind)
    if (!CALL_GRAPH_KINDS.includes(kind)) {
      errors.push(`${where}.kind='${kind}' 不是 function|macro|external，按 function 显示`)
      kind = 'function'
    }
    ids.add(id)
    functions.push({ id, kind, label: textField(row.label, `${where}.label`, errors) || id,
      signature: textField(row.signature, `${where}.signature`, errors), file: textField(row.file, `${where}.file`, errors), line: lineField(row.line, `${where}.line`, errors) })
  }
  if (Array.isArray(value.functions) && !functions.length) errors.push('functions 中没有有效函数')

  const calls = []
  for (const [index, row] of (Array.isArray(value.calls) ? value.calls : []).entries()) {
    const where = `calls[${index}]`
    if (!isObject(row)) { errors.push(`${where} 不是对象`); continue }
    let broken = false
    for (const key of ['from', 'to']) {
      const end = str(row[key])
      if (!ids.has(end)) { errors.push(`${where}.${key}='${end}' 不在 functions 中`); broken = true }
    }
    if (broken) continue
    calls.push({ from: str(row.from), to: str(row.to), file: textField(row.file, `${where}.file`, errors), line: lineField(row.line, `${where}.line`, errors),
      args: stringList(row.args, `${where}.args`, errors, true), returns: textField(row.returns, `${where}.returns`, errors) })
  }

  const variables = []
  for (const [index, row] of (Array.isArray(value.variables) ? value.variables : []).entries()) {
    const where = `variables[${index}]`
    if (!isObject(row)) { errors.push(`${where} 不是对象`); continue }
    const fn = str(row.function)
    const name = str(row.name)
    if (!ids.has(fn)) { errors.push(`${where}.function='${fn}' 不在 functions 中`); continue }
    if (!name) { errors.push(`${where} 缺少 name`); continue }
    variables.push({ function: fn, name, reads: stringList(row.reads, `${where}.reads`, errors), compute: textField(row.compute, `${where}.compute`, errors),
      writes: textField(row.writes, `${where}.writes`, errors), line: lineField(row.line, `${where}.line`, errors) })
  }

  let root = str(value.root)
  if (!ids.has(root)) {
    if (functions.length) errors.push(`root='${root}' 不在 functions 中，改用 ${functions[0].id}`)
    root = functions[0]?.id ?? ''
  }
  const graph = { format_version: CALL_GRAPH_FORMAT, title: textField(value.title, 'title', errors), root, functions, calls, variables,
    notes: stringList(value.notes, 'notes', errors) }
  const status = !functions.length ? 'invalid' : errors.length ? 'partial' : 'ok'
  return { status, errors, graph }
}

/** Repair instructions handed back to the model when validation finds errors. */
export function callGraphRepairPrompt(errors, candidatePath = 'candidate.json') {
  if (!errors?.length) return ''
  return [
    `${candidatePath} 的 call-graph-v1 结构有以下问题，请只修改该文件：`,
    ...errors.slice(0, 40).map(error => `- ${error}`),
    errors.length > 40 ? `- 另有 ${errors.length - 40} 条同类问题` : '',
    '规则：calls 的 from/to 与 variables 的 function 必须是 functions 中已有的 id；不要删除已正确的内容；不要自行运行校验。',
  ].filter(Boolean).join('\n')
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
