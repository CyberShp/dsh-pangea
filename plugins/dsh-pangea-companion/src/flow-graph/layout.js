// Deterministic layout for behavior-flow-v1 and call-graph-v1 diagrams.
// Ported from pangea-agent report/flow_diagram.py (BFS layering). The same
// input always yields the same geometry; no node or edge is invented.

export const FLOW_KIND_COLORS = {
  entry: '#3157d5', main: '#5b6b83', branch: '#b47700', error: '#c53d4d',
  propagation: '#8c4fb3', recovery: '#18875d', exit: '#4a667a',
}
export const FLOW_KIND_LABELS = {
  entry: '入口', main: '主线', branch: '分支', error: '异常', propagation: '传播', recovery: '恢复', exit: '出口',
}
export const FLOW_COLLAPSE_THRESHOLD = 60

const BOX_W = 220
const BOX_H = 76
const COL_GAP = 48
const ROW_GAP = 72
const MARGIN_X = 40
const MARGIN_Y = 36
const BACK_CHANNEL = 14
const MAIN_KINDS = new Set(['entry', 'main', 'exit'])
const RIGHT_KINDS = new Set(['error', 'propagation'])

const listOf = value => Array.isArray(value) ? value : []
const charWidth = char => char.charCodeAt(0) < 128 ? 1 : 2

/** Wrap text into lines by display width (CJK counts as 2). */
export function wrapLabel(value, limit = 26, maxLines = 3) {
  const tokens = String(value ?? '').match(/[A-Za-z0-9_./:=<>()|+\-]+|\s+|./gu) ?? []
  const lines = []
  let current = ''
  let width = 0
  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      if (current && !current.endsWith(' ')) { current += ' '; width += 1 }
      continue
    }
    const tokenWidth = [...token].reduce((sum, char) => sum + charWidth(char), 0)
    if (current && '，。；：！？、）】》」』”’'.includes(token)) { current += token; width += tokenWidth; continue }
    if (current && width + tokenWidth > limit) {
      lines.push(current.trimEnd())
      if (lines.length === maxLines) {
        lines[maxLines - 1] = truncateText(lines[maxLines - 1], limit - 1) + '…'
        return lines
      }
      current = ''
      width = 0
    }
    current += token
    width += tokenWidth
  }
  if (current && lines.length < maxLines) lines.push(current.trimEnd())
  return lines
}

/** Truncate to a display width, appending an ellipsis when shortened. */
export function truncateText(value, limit) {
  const text = String(value ?? '')
  let width = 0
  let out = ''
  for (const char of text) {
    width += charWidth(char)
    if (width > limit) return out
    out += char
  }
  return out
}

export function shortLabel(value, limit = 24) {
  const text = String(value ?? '')
  const cut = truncateText(text, limit)
  return cut === text ? text : `${truncateText(text, limit - 1)}…`
}

// Validate nodes and edges the same way as the Python renderer.
function collectGraph(flow) {
  const warnings = []
  const nodes = []
  const known = new Map()
  for (const item of listOf(flow?.nodes)) {
    const id = item && typeof item === 'object' ? String(item.id ?? '') : ''
    if (!id) { warnings.push('存在缺少 id 的流程节点，已保留文字说明但未绘制该节点。'); continue }
    if (known.has(id)) { warnings.push(`流程节点 ${id} 重复，图中只显示第一次声明。`); continue }
    const node = { id, label: String(item.label ?? item.name ?? id), kind: item.kind ?? null, description: item.description ?? '', source_evidence: item.source_evidence ?? [] }
    known.set(id, node)
    nodes.push(node)
  }
  const edges = []
  for (const [index, item] of listOf(flow?.edges).entries()) {
    if (!item || typeof item !== 'object') continue
    const source = String(item.source_step_key ?? '')
    const target = String(item.target_step_key ?? '')
    if (!known.has(source) || !known.has(target)) {
      warnings.push(`流程连线 ${source || '未提供'} → ${target || '未提供'} 引用了不存在的节点，未绘制。`)
      continue
    }
    edges.push({ index, source, target, condition: String(item.condition ?? '') })
  }
  return { nodes, edges, warnings, known }
}

// BFS depths: roots have no incoming edge; unreached nodes get new depths.
function bfsDepths(nodes, edges) {
  const incoming = new Map(nodes.map(n => [n.id, 0]))
  const outgoing = new Map(nodes.map(n => [n.id, []]))
  for (const edge of edges) {
    incoming.set(edge.target, incoming.get(edge.target) + 1)
    outgoing.get(edge.source).push(edge.target)
  }
  let roots = nodes.filter(n => incoming.get(n.id) === 0).map(n => n.id)
  if (!roots.length && nodes.length) roots = [nodes[0].id]
  const depths = new Map(roots.map(id => [id, 0]))
  const walk = queue => {
    while (queue.length) {
      const source = queue.shift()
      for (const target of outgoing.get(source)) {
        if (!depths.has(target)) { depths.set(target, depths.get(source) + 1); queue.push(target) }
      }
    }
  }
  walk([...roots])
  for (const node of nodes) {
    if (depths.has(node.id)) continue
    depths.set(node.id, Math.max(-1, ...depths.values()) + 1)
    walk([node.id])
  }
  return { depths, outgoing }
}

/** Determine the main path: paths[0], else entry/main/exit kinds, else a greedy chain from the first root. */
export function mainPathOf(flow, nodes, depths, outgoing) {
  const known = new Set(nodes.map(n => n.id))
  const first = listOf(flow?.paths)[0]
  const fromPath = listOf(first?.node_ids).filter(id => known.has(id))
  if (fromPath.length) return [...new Set(fromPath)]
  const byKind = nodes.filter(n => MAIN_KINDS.has(n.kind)).map(n => n.id)
  if (byKind.length) return byKind.sort((a, b) => depths.get(a) - depths.get(b))
  if (!nodes.length) return []
  const chain = []
  const seen = new Set()
  let current = [...depths].sort((a, b) => a[1] - b[1])[0][0]
  while (current && !seen.has(current)) {
    chain.push(current)
    seen.add(current)
    current = (outgoing.get(current) ?? []).find(target => !seen.has(target) && depths.get(target) > depths.get(chain.at(-1)))
  }
  return chain
}

/**
 * Lay out a behavior flow.
 * @returns {{width:number,height:number,nodes:object[],edges:object[],warnings:string[],main_path:string[],collapsed:{count:number,ids:string[]}}}
 */
export function layoutFlow(flow, options = {}) {
  const graph = collectGraph(flow)
  if (!graph.nodes.length) {
    return { width: 0, height: 0, nodes: [], edges: [], main_path: [], collapsed: { count: 0, ids: [] },
      warnings: graph.warnings.length ? graph.warnings : ['当前流程没有可绘制节点。'] }
  }
  const full = bfsDepths(graph.nodes, graph.edges)
  const mainPath = mainPathOf(flow, graph.nodes, full.depths, full.outgoing)
  const mainSet = new Set(mainPath)
  let visible = graph.nodes
  let collapsedIds = []
  const threshold = options.collapseThreshold ?? FLOW_COLLAPSE_THRESHOLD
  if (!options.expandAll && graph.nodes.length > threshold) {
    // Main path plus one layer of branches; everything else is folded.
    const keep = new Set(mainPath)
    for (const edge of graph.edges) {
      if (mainSet.has(edge.source)) keep.add(edge.target)
      if (mainSet.has(edge.target)) keep.add(edge.source)
    }
    visible = graph.nodes.filter(n => keep.has(n.id))
    collapsedIds = graph.nodes.filter(n => !keep.has(n.id)).map(n => n.id)
  }
  const visibleIds = new Set(visible.map(n => n.id))
  const edges = graph.edges.filter(e => visibleIds.has(e.source) && visibleIds.has(e.target))
  const { depths } = visible === graph.nodes ? full : bfsDepths(visible, edges)

  // Rows by depth; within a row: left side, main column(s), right side.
  const rows = new Map()
  for (const node of visible) {
    const depth = depths.get(node.id)
    if (!rows.has(depth)) rows.set(depth, { left: [], main: [], right: [] })
    const row = rows.get(depth)
    if (mainSet.has(node.id)) row.main.push(node)
    else if (RIGHT_KINDS.has(node.kind)) row.right.push(node)
    else if (node.kind === 'branch' || node.kind === 'recovery') row.left.push(node)
    else (row.left.length <= row.right.length ? row.left : row.right).push(node)
  }
  const orderedDepths = [...rows.keys()].sort((a, b) => a - b)
  const maxOf = side => Math.max(0, ...[...rows.values()].map(row => row[side].length))
  const maxLeft = maxOf('left')
  const maxRight = maxOf('right')
  const maxMain = Math.max(1, maxOf('main'))
  const colW = BOX_W + COL_GAP
  const axis = MARGIN_X + maxLeft * colW + (maxMain * colW - COL_GAP) / 2
  const placed = new Map()
  orderedDepths.forEach((depth, rowIndex) => {
    const row = rows.get(depth)
    const y = MARGIN_Y + rowIndex * (BOX_H + ROW_GAP)
    const halfMain = (maxMain - 1) / 2
    const put = (node, cx, column) => placed.set(node.id, { ...node, x: Math.round(cx - BOX_W / 2), y, w: BOX_W, h: BOX_H, depth, column,
      lines: wrapLabel(node.label, 26, 3), on_main: mainSet.has(node.id) })
    row.main.forEach((node, i) => put(node, axis + (i - (row.main.length - 1) / 2) * colW, 'main'))
    row.left.forEach((node, i) => put(node, axis - (halfMain + i + 1) * colW, 'left'))
    row.right.forEach((node, i) => put(node, axis + (halfMain + i + 1) * colW, 'right'))
  })
  const contentRight = MARGIN_X + (maxLeft + maxMain + maxRight) * colW - COL_GAP
  let backCount = 0
  const laidEdges = edges.map(edge => {
    const a = placed.get(edge.source)
    const b = placed.get(edge.target)
    const forward = b.depth > a.depth
    const base = { ...edge, label: shortLabel(edge.condition, 22), on_main: mainSet.has(edge.source) && mainSet.has(edge.target) }
    if (forward) {
      const sx = a.x + a.w / 2, sy = a.y + a.h, tx = b.x + b.w / 2, ty = b.y
      const my = (sy + ty) / 2
      return { ...base, back: false, path: `M${sx} ${sy} C${sx} ${my} ${tx} ${my} ${tx} ${ty}`,
        label_x: (sx + tx) / 2, label_y: my }
    }
    // Back-edge or same-row edge: route around the right side.
    const outside = contentRight + 22 + backCount++ * BACK_CHANNEL
    const sx = a.x + a.w, sy = a.y + a.h / 2 + 8, tx = b.x + b.w, ty = b.y + b.h / 2 - 8
    return { ...base, back: true, path: `M${sx} ${sy} L${outside} ${sy} L${outside} ${ty} L${tx} ${ty}`,
      label_x: outside + 4, label_y: (sy + ty) / 2 }
  })
  const height = MARGIN_Y * 2 + orderedDepths.length * (BOX_H + ROW_GAP) - ROW_GAP + (collapsedIds.length ? 56 : 0)
  const width = Math.max(480, contentRight + MARGIN_X + (backCount ? 22 + backCount * BACK_CHANNEL + 120 : 0))
  return { width: Math.round(width), height: Math.round(height), nodes: [...placed.values()], edges: laidEdges,
    warnings: graph.warnings, main_path: mainPath.filter(id => visibleIds.has(id)),
    collapsed: { count: collapsedIds.length, ids: collapsedIds } }
}

/** Nodes and edge indexes belonging to a path (for highlight). */
export function pathMembers(flow, pathId) {
  const path = listOf(flow?.paths).find(p => p?.path_id === pathId)
  if (!path) return null
  const ids = listOf(path.node_ids)
  const pairs = new Set(ids.slice(1).map((id, i) => `${ids[i]}\u0000${id}`))
  return { nodes: new Set(ids), pairs }
}

/**
 * Lay out a sanitized call-graph-v1 graph: depth layers from the root, left to right.
 * Duplicate calls between the same pair are merged with a count.
 */
export function layoutCallGraph(graph) {
  const functions = listOf(graph?.functions)
  if (!functions.length) return { width: 0, height: 0, nodes: [], edges: [], warnings: ['当前调用图没有可绘制函数。'] }
  const ids = new Set(functions.map(f => f.id))
  const merged = new Map()
  for (const [index, call] of listOf(graph.calls).entries()) {
    if (!ids.has(call.from) || !ids.has(call.to)) continue
    const key = `${call.from}\u0000${call.to}`
    if (!merged.has(key)) merged.set(key, { from: call.from, to: call.to, count: 0, calls: [], indexes: [] })
    const edge = merged.get(key)
    edge.count += 1
    edge.calls.push(call)
    edge.indexes.push(index)
  }
  const outgoing = new Map(functions.map(f => [f.id, []]))
  for (const edge of merged.values()) outgoing.get(edge.from).push(edge.to)
  const root = ids.has(graph.root) ? graph.root : functions[0].id
  const depths = new Map([[root, 0]])
  const queue = [root]
  while (queue.length) {
    const source = queue.shift()
    for (const target of outgoing.get(source)) if (!depths.has(target)) { depths.set(target, depths.get(source) + 1); queue.push(target) }
  }
  // Functions not reachable from the root stay independent in a trailing column.
  const unreachedDepth = Math.max(0, ...depths.values()) + 1
  for (const fn of functions) if (!depths.has(fn.id)) depths.set(fn.id, unreachedDepth)
  const columns = new Map()
  for (const fn of functions) {
    const depth = depths.get(fn.id)
    if (!columns.has(depth)) columns.set(depth, [])
    columns.get(depth).push(fn)
  }
  const order = [...columns.keys()].sort((a, b) => a - b)
  const w = 200, h = 64, colGap = 90, rowGap = 26
  const tallest = Math.max(...order.map(d => columns.get(d).length))
  const contentH = tallest * (h + rowGap) - rowGap
  const placed = new Map()
  order.forEach((depth, columnIndex) => {
    const column = columns.get(depth)
    const offset = (contentH - (column.length * (h + rowGap) - rowGap)) / 2
    column.forEach((fn, i) => placed.set(fn.id, { ...fn, x: MARGIN_X + columnIndex * (w + colGap), y: MARGIN_Y + offset + i * (h + rowGap), w, h, depth,
      unreached: depth === unreachedDepth,
      lines: wrapLabel(fn.label ?? fn.id, 22, 2) }))
  })
  let loopCount = 0
  const edges = [...merged.values()].map(edge => {
    const a = placed.get(edge.from), b = placed.get(edge.to)
    const count = edge.count > 1 ? `×${edge.count}` : ''
    if (b.x > a.x) {
      const sx = a.x + a.w, sy = a.y + a.h / 2, tx = b.x, ty = b.y + b.h / 2, mx = (sx + tx) / 2
      return { ...edge, back: false, label: count, path: `M${sx} ${sy} C${mx} ${sy} ${mx} ${ty} ${tx} ${ty}`, label_x: mx, label_y: (sy + ty) / 2 - 4 }
    }
    const below = MARGIN_Y + contentH + 18 + loopCount++ * 12
    const sx = a.x + a.w / 2, sy = a.y + a.h, tx = b.x + b.w / 2 + (a.id === b.id ? 30 : 0), ty = b.y + b.h
    return { ...edge, back: true, label: count, path: `M${sx} ${sy} L${sx} ${below} L${tx} ${below} L${tx} ${ty}`, label_x: (sx + tx) / 2, label_y: below - 4 }
  })
  const width = MARGIN_X * 2 + order.length * (w + colGap) - colGap
  const height = MARGIN_Y * 2 + contentH + (loopCount ? 24 + loopCount * 12 : 0)
  return { width: Math.max(360, width), height: Math.round(height), nodes: [...placed.values()], edges, root, warnings: [] }
}
