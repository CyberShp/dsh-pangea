// Pure advisory contract, aligned with pangea_agent.diagram_contract and the
// cross-language fixtures. No business completeness checks or write gates.
export const DIAGRAM_CONTRACT = 'diagram-contract-v1'
const FORMATS = { flow: 'behavior-flow-v1', sequence: 'sequence-v1', call_graph: 'call-graph-v1' }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

export function diagramDiagnostics(body, { strict = false } = {}) {
  const out = []
  const emit = (diagram, field, code, message, classification = 'invalid') => out.push({
    kind: 'diagram_format_diagnostic', contract_version: DIAGRAM_CONTRACT, diagram, field, code,
    classification, severity: classification === 'invalid' ? 'warning' : 'info', message,
  })
  const check = (diagram, row, key, kind, where, required = false, choices = null) => {
    const field = where ? `${where}.${key}` : key, value = row[key]
    if (value == null) {
      if (strict && required) emit(diagram, field, 'missing_field', '字段未提供；保留已保存内容，请原 worker 确认', 'missing')
      return null
    }
    const valid = { object: object(value), array: Array.isArray(value), string: typeof value === 'string', line: Number.isInteger(value) && value > 0 }[kind]
    if (!valid) { emit(diagram, field, 'invalid_type', `字段必须是 ${kind}；原值保留`); return null }
    if (choices && !choices.includes(value)) emit(diagram, field, 'invalid_enum', `字段应为 ${choices.join(' | ')}；原值保留`)
    return value
  }
  const rows = (diagram, row, key, where, required = false) => {
    const values = check(diagram, row, key, 'array', where, required)
    return (values ?? []).flatMap((item, index) => {
      const field = where ? `${where}.${key}[${index}]` : `${key}[${index}]`
      if (!object(item)) { emit(diagram, field, 'invalid_type', '项目必须是 object；原值保留'); return [] }
      return [[item, field]]
    })
  }
  const strings = (diagram, row, key, where, required = false) => {
    const values = check(diagram, row, key, 'array', where, required)
    for (const [index, value] of (values ?? []).entries()) if (typeof value !== 'string') emit(diagram, `${where}.${key}[${index}]`, 'invalid_type', '项目必须是 string；原值保留')
    return values ?? []
  }
  const identities = (diagram, items) => {
    const ids = new Set()
    for (const [item, where] of items) {
      const value = check(diagram, item, 'id', 'string', where, true)
      if (value == null) continue
      if (!value.trim()) emit(diagram, `${where}.id`, 'empty_id', 'id 必须是非空字符串')
      else if (ids.has(value)) emit(diagram, `${where}.id`, 'duplicate_id', 'id 重复，关系归属待确认')
      ids.add(value)
    }
    return ids
  }
  const reference = (diagram, row, key, known, where) => {
    const value = check(diagram, row, key, 'string', where, true)
    if (value != null && !known.has(value)) emit(diagram, `${where}.${key}`, 'unknown_reference', '引用未声明的 id；原值保留')
  }
  if (!object(body)) { emit('flow', 'body', 'invalid_type', '流程 body 必须是 object；原值保留'); return out }
  for (const diagram of Object.keys(FORMATS)) {
    const value = diagram === 'flow' ? body : body[diagram], where = diagram === 'flow' ? '' : diagram
    if (value == null) { if (strict) emit(diagram, where, 'missing_diagram', '附图资料未提供，不代表已完成', 'missing'); continue }
    if (!object(value)) { emit(diagram, where || 'body', 'invalid_type', '图资料必须是 object；原值保留'); continue }
    const version = check(diagram, value, 'format_version', 'string', where, true)
    if (version != null && version !== FORMATS[diagram]) {
      emit(diagram, where ? `${where}.format_version` : 'format_version', 'unsupported_version', '格式版本暂不支持，原始资料保留', 'valid_but_unsupported')
      continue
    }
    if (diagram !== 'flow') {
      const status = check(diagram, value, 'status', 'string', where, true, ['ready', 'partial', 'unknown', 'not_applicable'])
      if (['unknown', 'not_applicable', 'partial'].includes(status)) emit(diagram, `${where}.status`, 'declared_status', `worker 声明 ${status}；保留原结论`, 'unknown')
    }
    check(diagram, value, 'title', 'string', where, true)
    if (diagram === 'flow') {
      const nodes = rows(diagram, value, 'nodes', where, true), ids = identities(diagram, nodes)
      for (const [node, path] of nodes) {
        check(diagram, node, 'label', 'string', path, true)
        check(diagram, node, 'kind', 'string', path, false, ['entry', 'main', 'branch', 'error', 'propagation', 'recovery', 'exit'])
      }
      for (const [edge, path] of rows(diagram, value, 'edges', where, true)) for (const key of ['source_step_key', 'target_step_key']) reference(diagram, edge, key, ids, path)
      for (const [row, path] of rows(diagram, value, 'paths', where, true)) {
        for (const [index, ref] of strings(diagram, row, 'node_ids', path, true).entries()) if (typeof ref === 'string' && !ids.has(ref)) emit(diagram, `${path}.node_ids[${index}]`, 'unknown_reference', '引用未声明的 id；原值保留')
      }
    } else if (diagram === 'sequence') {
      const participants = rows(diagram, value, 'participants', where, true), participantIds = identities(diagram, participants)
      for (const [participant, path] of participants) check(diagram, participant, 'label', 'string', path, true)
      const messages = rows(diagram, value, 'messages', where, true), messageIds = identities(diagram, messages)
      const positions = new Map(messages.flatMap(([message], index) => typeof message.id === 'string' ? [[message.id, index]] : []))
      for (const [message, path] of messages) {
        for (const key of ['from', 'to']) reference(diagram, message, key, participantIds, path)
        check(diagram, message, 'label', 'string', path, true)
        check(diagram, message, 'kind', 'string', path, true, ['call', 'return', 'async', 'self'])
        if (message.kind === 'self' && message.from !== message.to) emit(diagram, `${path}.kind`, 'self_endpoints', 'self 消息的 from/to 必须相同')
        strings(diagram, message, 'source_evidence', path)
      }
      const fragments = rows(diagram, value, 'fragments', where, true), owned = new Set()
      identities(diagram, fragments)
      for (const [fragment, path] of fragments) {
        const kind = check(diagram, fragment, 'kind', 'string', path, true, ['alt', 'opt', 'loop', 'par'])
        const operands = rows(diagram, fragment, 'operands', path, true)
        if (['alt', 'par'].includes(kind) && operands.length < 2 || ['opt', 'loop'].includes(kind) && operands.length !== 1) emit(diagram, `${path}.operands`, 'operand_count', '分支数量与片段类型不符')
        const indexes = []
        for (const [operand, operandPath] of operands) {
          check(diagram, operand, 'condition', 'string', operandPath, true)
          for (const [index, ref] of strings(diagram, operand, 'message_ids', operandPath, true).entries()) {
            if (typeof ref !== 'string') continue
            const refPath = `${operandPath}.message_ids[${index}]`
            if (!messageIds.has(ref)) emit(diagram, refPath, 'unknown_reference', '引用未声明的 id；原值保留')
            else indexes.push(positions.get(ref))
            if (owned.has(ref)) emit(diagram, refPath, 'overlapping_fragment', '消息同时属于多个分支或片段；归属待确认')
            owned.add(ref)
          }
        }
        const ordered = [...new Set(indexes)].sort((a, b) => a - b)
        if (ordered.length && ordered.at(-1) - ordered[0] + 1 !== ordered.length) emit(diagram, `${path}.operands`, 'noncontiguous_fragment', '片段消息在 messages 中不连续；保留原始关系')
      }
    } else {
      const functions = rows(diagram, value, 'functions', where, true), ids = identities(diagram, functions)
      reference(diagram, value, 'root', ids, where)
      for (const [fn, path] of functions) {
        check(diagram, fn, 'kind', 'string', path, true, ['function', 'macro', 'external'])
        for (const key of ['label', 'signature', 'file']) check(diagram, fn, key, 'string', path, true)
        check(diagram, fn, 'line', 'line', path)
      }
      for (const [call, path] of rows(diagram, value, 'calls', where, true)) {
        for (const key of ['from', 'to']) reference(diagram, call, key, ids, path)
        strings(diagram, call, 'args', path, true)
        for (const key of ['file', 'returns']) check(diagram, call, key, 'string', path, true)
        check(diagram, call, 'line', 'line', path)
      }
      for (const [variable, path] of rows(diagram, value, 'variables', where, true)) {
        reference(diagram, variable, 'function', ids, path)
        for (const key of ['name', 'compute']) check(diagram, variable, key, 'string', path, true)
        strings(diagram, variable, 'reads', path, true)
        if (!strict && Array.isArray(variable.writes) && variable.writes.every(item => typeof item === 'string')) emit(diagram, `${path}.writes`, 'legacy_writes_array', '旧冻结合同的 writes 数组按原项目兼容展示', 'valid_but_unsupported')
        else check(diagram, variable, 'writes', 'string', path, true)
        check(diagram, variable, 'line', 'line', path)
      }
    }
    if (diagram !== 'flow') strings(diagram, value, 'notes', where, true)
  }
  return out
}

/** Persisted diagnostics are scoped to exact result + authored record revision. */
export function activeDiagramDiagnostics(result) {
  const records = Array.isArray(result?.records) ? result.records : []
  const known = new Set(), retired = new Set()
  for (const record of records) {
    for (const id of Array.isArray(record.supersedes) ? record.supersedes : []) if (known.has(id)) retired.add(id)
    known.add(record.record_id)
  }
  const active = new Map(records.filter(record => !retired.has(record.record_id)).map(record => [record.record_id, record]))
  return (result?.warnings ?? []).filter(item => item.kind === 'diagram_format_diagnostic'
    && active.has(item.record_id) && item.record_revision === active.get(item.record_id).created_revision)
}
