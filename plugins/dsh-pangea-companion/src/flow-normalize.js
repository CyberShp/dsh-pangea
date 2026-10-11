// Lenient behavior-flow-v1 normalizer shared by the projection, the diagram
// scope selection and the legacy reader. It only repairs field names and
// wrappers; it never invents nodes or semantic content. Every repair is
// recorded as a note starting with "已自动兼容：" and is not an error.

export const FLOW_NODE_KINDS = ['entry', 'main', 'branch', 'error', 'propagation', 'recovery', 'exit']
export const COMPAT_PREFIX = '已自动兼容：'

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const asList = value => Array.isArray(value) ? value : value == null ? [] : [value]
const text = value => typeof value === 'string' ? value.trim() : ''

const FENCE = /^\s*```[\w-]*[^\S\n]*\n([\s\S]*?)\n?[^\S\n]*```\s*$/

/** Parse a flow body that may be a JSON string, optionally wrapped in a code fence. */
export function parseFlowText(body) {
  if (typeof body !== 'string') return { value: body, notes: [] }
  const notes = []
  let source = body
  const fenced = FENCE.exec(body)
  if (fenced) {
    source = fenced[1]
    notes.push(`${COMPAT_PREFIX}body 是包含代码块的字符串，已去掉代码块后解析`)
  } else notes.push(`${COMPAT_PREFIX}body 是字符串，已按 JSON 解析`)
  try {
    return { value: JSON.parse(source.replace(/^﻿/, '')), notes }
  } catch (error) {
    return { value: null, notes: [], error: `body 不是有效 JSON：${error.message}` }
  }
}

/** Split {flow:{}}, {flows:[]} or a top-level array into individual flow bodies. */
export function unwrapFlows(value) {
  const notes = []
  if (Array.isArray(value)) {
    notes.push(`${COMPAT_PREFIX}body 是流程数组，已拆分为 ${value.length} 个流程`)
    return { bodies: value, notes }
  }
  if (!isObject(value)) return { bodies: [value], notes }
  const hasOwnGraph = ['nodes', '节点', 'steps'].some(key => value[key] != null)
  if (!hasOwnGraph && Array.isArray(value.flows)) {
    const { flows, ...shared } = value
    notes.push(`${COMPAT_PREFIX}flows 外壳已拆分为 ${flows.length} 个流程`)
    const inherited = shared.format_version ? { format_version: shared.format_version } : {}
    return { bodies: flows.map(flow => isObject(flow) ? { ...inherited, ...flow } : flow), notes }
  }
  if (!hasOwnGraph && isObject(value.flow)) {
    const { flow, ...shared } = value
    notes.push(`${COMPAT_PREFIX}flow 外壳已拆开`)
    return { bodies: [{ ...shared, ...flow }], notes }
  }
  return { bodies: [value], notes }
}

function compatCounter() {
  const counts = new Map()
  return {
    add(message) { counts.set(message, (counts.get(message) ?? 0) + 1) },
    notes() { return [...counts].map(([message, count]) => `${COMPAT_PREFIX}${message}${count > 1 ? `（${count} 处）` : ''}`) },
  }
}

// Pick key, else the first present alternate. Conflicting values keep the
// canonical key and add a warning; using an alternate adds a compat note.
function pick(row, key, alternates, where, warnings, compat, scope) {
  const canonical = row[key]
  for (const alternate of alternates) {
    const other = row[alternate]
    if (other == null) continue
    if (canonical != null) {
      if (canonical !== other && typeof other !== 'object') warnings.push(`${where}: ${key} 与 ${alternate} 不一致，按 ${key} 展示；原文保留`)
      continue
    }
    compat.add(`${scope}字段 ${alternate} 视为 ${key}`)
    return other
  }
  return canonical
}

function stepsToNodes(steps, compat) {
  compat.add('steps 已按顺序转换为 nodes')
  return steps.map((step, index) => {
    const position = index === 0 ? 'entry' : index === steps.length - 1 ? 'exit' : 'main'
    if (!isObject(step)) return { id: `s${index + 1}`, kind: position, label: typeof step === 'string' ? step : JSON.stringify(step) }
    const id = [step.step_id, step.id, step.node_id].find(v => typeof v === 'string' && v.trim()) ?? `s${index + 1}`
    const label = [step.label, step.name, step.title, step['名称']].find(v => typeof v === 'string' && v.trim()) ?? ''
    return { ...step, id, kind: step.kind ?? position, label,
      description: step.description ?? step.processing ?? step['说明'] ?? step['描述'] }
  })
}

function normalizeOne(input, inheritedNotes = []) {
  const warnings = []
  const errors = []
  const compat = compatCounter()
  const notes = [...inheritedNotes]
  if (!isObject(input)) {
    const raw = typeof input === 'string' ? input : input == null ? '' : JSON.stringify(input, null, 2)
    errors.push('body 必须是 JSON 对象，不能是字符串或代码块')
    warnings.push('没有可解析的节点，请查看原文；这不代表分析已完成')
    return { nodes: [], edges: [], paths: [], role: 'sub', attach_to: null, raw_text: raw,
      projection_warnings: warnings, normalize_notes: notes, structure_errors: errors }
  }
  const body = input
  const title = pick(body, 'title', ['标题', 'name', '名称'], 'flow', warnings, compat, '流程')
  const description = pick(body, 'description', ['说明', '描述'], 'flow', warnings, compat, '流程')
  let rawNodes = pick(body, 'nodes', ['节点'], 'flow', warnings, compat, '流程')
  let rawEdges = pick(body, 'edges', ['连线'], 'flow', warnings, compat, '流程')
  const rawPaths = pick(body, 'paths', ['路径'], 'flow', warnings, compat, '流程')
  const sourceEvidence = pick(body, 'source_evidence', ['源码依据'], 'flow', warnings, compat, '流程')
  let inferredEdges = false
  if ((rawNodes == null || (Array.isArray(rawNodes) && !rawNodes.length)) && Array.isArray(body.steps) && body.steps.length) {
    rawNodes = stepsToNodes(body.steps, compat)
    if (rawEdges == null || (Array.isArray(rawEdges) && !rawEdges.length)) {
      rawEdges = rawNodes.slice(1).map((node, index) => ({ source_step_key: rawNodes[index].id, target_step_key: node.id, condition: '' }))
      inferredEdges = rawEdges.length > 0
    }
  }

  const declared = []
  const nodes = asList(rawNodes).flatMap((node, index) => {
    if (!isObject(node)) { warnings.push(`nodes[${index}] 不是节点对象`); errors.push(`nodes[${index}] 不是对象`); return [] }
    const where = `nodes[${index}]`
    const id = pick(node, 'id', ['node_id', 'step_id'], where, warnings, compat, '节点')
    const label = pick(node, 'label', ['name', 'title', '名称'], where, warnings, compat, '节点')
    const missing = [typeof id === 'string' && id.trim() ? null : 'id', typeof label === 'string' && label.trim() ? null : 'label'].filter(Boolean)
    if (missing.length) {
      warnings.push(`${where} 缺少字符串 id/node_id 或 label/name，未绘制；请查看原文`)
      for (const field of missing) errors.push(`${where} 缺少 ${field}`)
      return []
    }
    declared.push({ id, index })
    return [{ ...node, id, label,
      kind: pick(node, 'kind', ['类型'], where, warnings, compat, '节点'),
      description: pick(node, 'description', ['说明', '描述'], where, warnings, compat, '节点'),
      source_evidence: pick(node, 'source_evidence', ['源码依据'], where, warnings, compat, '节点') }]
  })
  const positions = new Map()
  for (const { id, index } of declared) positions.set(id, [...(positions.get(id) ?? []), index])
  const duplicates = [...positions].filter(([, at]) => at.length > 1)
  for (const [id, at] of duplicates) errors.push(`节点 id '${id}' 重复（${at.map(i => `nodes[${i}]`).join(', ')}）`)
  const duplicate = duplicates.length > 0
  if (duplicate) warnings.push('节点 ID 重复，无法可靠定位连线；请修正当前流程原记录')
  const ids = new Set(nodes.map(n => n.id))
  const available = [...ids].join(', ') || '无'
  const byLabel = new Map()
  for (const node of nodes) byLabel.set(node.label, [...(byLabel.get(node.label) ?? []), node.id])

  const edges = asList(rawEdges).flatMap((edge, index) => {
    if (!isObject(edge)) { warnings.push(`edges[${index}] 不是连线对象`); errors.push(`edges[${index}] 不是对象`); return [] }
    const where = `edges[${index}]`
    const ends = {}
    for (const [key, alternates] of [['source_step_key', ['source', 'from']], ['target_step_key', ['target', 'to']]]) {
      let value = pick(edge, key, alternates, where, warnings, compat, '连线')
      if (!ids.has(value) && typeof value === 'string' && byLabel.has(value)) {
        const matches = byLabel.get(value)
        if (matches.length === 1) {
          compat.add(`连线端点使用节点名称，已改写为节点 id`)
          value = matches[0]
        } else {
          notes.push(`${COMPAT_PREFIX}${where}.${key}='${value}' 匹配多个同名节点，已丢弃该连线`)
          return []
        }
      }
      if (!ids.has(value)) errors.push(`${where}.${key}='${value ?? ''}' 不是节点 id；可用 id：${available}`)
      ends[key] = value
    }
    if (!ids.has(ends.source_step_key) || !ids.has(ends.target_step_key) || duplicate) {
      warnings.push(`edges[${index}] 端点无法对应唯一节点，未绘制；原文保留`); return []
    }
    return [{ ...edge, ...ends,
      condition: pick(edge, 'condition', ['条件'], where, warnings, compat, '连线'),
      description: pick(edge, 'description', ['说明', '描述'], where, warnings, compat, '连线') }]
  })
  if (inferredEdges) notes.push(`${COMPAT_PREFIX}由步骤顺序推断连线`)

  const paths = asList(rawPaths).flatMap((row, index) => {
    if (!isObject(row)) { errors.push(`paths[${index}] 不是对象`); return [] }
    const where = `paths[${index}]`
    const path = { ...row,
      path_id: pick(row, 'path_id', ['id'], where, warnings, compat, '路径') ?? `P-${String(index + 1).padStart(2, '0')}`,
      title: pick(row, 'title', ['标题', '名称', 'name'], where, warnings, compat, '路径'),
      condition: pick(row, 'condition', ['条件'], where, warnings, compat, '路径'),
      explanation: pick(row, 'explanation', ['说明', '描述'], where, warnings, compat, '路径'),
      node_ids: asList(pick(row, 'node_ids', ['nodes', '节点'], where, warnings, compat, '路径')) }
    const unknown = path.node_ids.filter(id => !ids.has(id))
    if (unknown.length) {
      warnings.push(`paths[${index}] 引用了缺失节点；原文路径保留`)
      for (const id of new Set(unknown)) errors.push(`paths[${index}].node_ids 含未知 id '${id}'`)
    }
    return [path]
  })
  const textOnly = body.format_version === 'module-flow-text-v1' && typeof body.text === 'string' && body.text.trim()
  if (!nodes.length && !textOnly) {
    if (!asList(rawNodes).length) errors.unshift('nodes 缺失或为空')
    warnings.push('没有可解析的节点，请查看原文；这不代表分析已完成')
  }
  const attach = isObject(body.attach_to) && text(body.attach_to.flow_id) ? { flow_id: body.attach_to.flow_id, node_id: text(body.attach_to.node_id) || null } : null
  return { ...body, title, description, role: body.role === 'main' ? 'main' : 'sub', attach_to: attach,
    nodes: duplicate ? [] : nodes, edges, paths, source_evidence: sourceEvidence,
    ...((!nodes.length || duplicate) && !textOnly ? { raw_text: JSON.stringify(body, null, 2) } : {}),
    projection_warnings: warnings, normalize_notes: [...notes, ...compat.notes()], structure_errors: errors }
}

/** Normalize a raw flow body into one or more flows (wrappers are split). */
export function normalizeFlows(body) {
  const parsed = parseFlowText(body)
  if (parsed.error) {
    const flow = normalizeOne(body)
    return [{ ...flow, structure_errors: [parsed.error, ...flow.structure_errors.filter(e => !e.startsWith('body 必须'))] }]
  }
  const { bodies, notes } = unwrapFlows(parsed.value)
  if (!bodies.length) return [normalizeOne({ nodes: [] }, [...parsed.notes, ...notes])]
  return bodies.map(item => normalizeOne(item, [...parsed.notes, ...notes]))
}

/** Normalize a single flow body; wrappers resolve to their first flow. */
export function normalizeFlow(body) {
  return normalizeFlows(body)[0]
}
