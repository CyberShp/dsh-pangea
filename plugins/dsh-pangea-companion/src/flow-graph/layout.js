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
const LABEL_GAP = 12
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

const compareText = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
const nodeOrder = (a, b) => compareText(a.semantic_key || a.id, b.semantic_key || b.id) || compareText(a.id, b.id)
const stableMode = flow => flow?.layout_version === 'stable-v1' || Array.isArray(flow?.main_path_ids)
const pairKey = (source, target) => `${source}\u0000${target}`

// Old reports do not have edge IDs. This identity survives array reordering and
// distinguishes parallel conditions without changing the persisted source graph.
function hashIdentity(value) {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 0x01000193) >>> 0
  return hash.toString(16).padStart(8, '0')
}

function collectGraph(flow) {
  const warnings = []
  const nodes = []
  const known = new Map()
  for (const item of listOf(flow?.nodes)) {
    const id = item && typeof item === 'object' ? String(item.id ?? '') : ''
    if (!id) { warnings.push('存在缺少 id 的流程节点，已保留文字说明但未绘制该节点。'); continue }
    if (known.has(id)) { warnings.push(`流程节点 ${id} 重复，图中只显示第一次声明。`); continue }
    const node = { id, semantic_key: String(item.semantic_key ?? ''), label: String(item.label ?? item.name ?? id), kind: item.kind ?? null, description: item.description ?? '', source_evidence: item.source_evidence ?? [] }
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
    edges.push({ source, target, condition: String(item.condition ?? ''), declared_id: String(item.edge_id ?? ''), index })
  }
  edges.sort((a, b) => nodeOrder(known.get(a.source), known.get(b.source)) || nodeOrder(known.get(a.target), known.get(b.target)) || compareText(a.condition, b.condition) || compareText(a.declared_id, b.declared_id))
  const used = new Set(edges.map(e => e.declared_id).filter(Boolean))
  const declared = new Map()
  for (const edge of edges) if (edge.declared_id) declared.set(edge.declared_id, (declared.get(edge.declared_id) ?? 0) + 1)
  const duplicateWarnings = new Set()
  const collected = []
  for (const edge of edges) {
    let edgeId = edge.declared_id
    if (edgeId && declared.get(edgeId) > 1) {
      if (!duplicateWarnings.has(edgeId)) warnings.push(`流程连线 ID ${edgeId} 重复；重名连线使用临时身份，原路径引用无法唯一定位。`)
      duplicateWarnings.add(edgeId)
      edgeId = ''
    }
    if (!edgeId) {
      const source = known.get(edge.source), target = known.get(edge.target)
      const base = `legacy-${hashIdentity(JSON.stringify([source.semantic_key || source.id, target.semantic_key || target.id, edge.condition]))}`
      edgeId = base
      let suffix = 2
      while (used.has(edgeId)) edgeId = `${base}-${suffix++}`
    }
    used.add(edgeId)
    const { declared_id, ...rest } = edge
    // Preserve the source index for legacy branch->edge references. Geometry and
    // route selection use stable edge_id, never this declaration-order field.
    collected.push({ ...rest, edge_id: edgeId })
  }
  return { nodes, edges: collected, warnings, known }
}

// BFS depths are independent of declaration order. Explicit entry nodes remain
// roots even when a recovery edge loops back into the entry.
function bfsDepths(nodes, edges) {
  const ordered = [...nodes].sort(nodeOrder)
  const incoming = new Map(ordered.map(n => [n.id, 0]))
  const outgoing = new Map(ordered.map(n => [n.id, []]))
  for (const edge of edges) {
    incoming.set(edge.target, incoming.get(edge.target) + 1)
    outgoing.get(edge.source).push(edge.target)
  }
  const known = new Map(ordered.map(n => [n.id, n]))
  for (const targets of outgoing.values()) targets.sort((a, b) => nodeOrder(known.get(a), known.get(b)))
  let roots = ordered.filter(n => incoming.get(n.id) === 0 || n.kind === 'entry').map(n => n.id)
  if (!roots.length && ordered.length) roots = [ordered[0].id]
  const depths = new Map(roots.map(id => [id, 0]))
  const walk = queue => {
    for (let i = 0; i < queue.length; i += 1) {
      const source = queue[i]
      for (const target of outgoing.get(source)) {
        if (!depths.has(target)) { depths.set(target, depths.get(source) + 1); queue.push(target) }
      }
    }
  }
  walk([...roots])
  for (const node of ordered) {
    if (depths.has(node.id)) continue
    depths.set(node.id, Math.max(-1, ...depths.values()) + 1)
    walk([node.id])
  }
  return { depths, outgoing }
}

// A shortcut must not pull a declared main-path terminal ahead of its own
// prerequisite steps. Rank main-path constraints first, then layer side nodes
// from those anchors. Loop closures are routes, not new ordering constraints.
function declaredMainDepths(flow, graph, fallback) {
  if (!stableMode(flow)) return fallback
  const mainIds = new Set(listOf(flow?.main_path_ids))
  const paths = listOf(flow?.paths).filter(path => mainIds.has(path?.path_id))
  const nodes = new Set(paths.flatMap(path => listOf(path.node_ids)).filter(id => graph.known.has(id)))
  if (!nodes.size) return fallback
  const outgoing = new Map([...nodes].map(id => [id, new Set()]))
  const incoming = new Map([...nodes].map(id => [id, 0]))
  const actualPairs = new Set(graph.edges.map(edge => pairKey(edge.source, edge.target)))
  for (const path of paths) {
    const ids = listOf(path.node_ids), seen = new Set(ids.slice(0, 1))
    for (let i = 1; i < ids.length; i += 1) {
      const source = ids[i - 1], target = ids[i]
      if (nodes.has(source) && nodes.has(target) && !seen.has(target) && actualPairs.has(pairKey(source, target)) && !outgoing.get(source).has(target)) {
        outgoing.get(source).add(target)
        incoming.set(target, incoming.get(target) + 1)
      }
      seen.add(target)
    }
  }
  const order = (a, b) => nodeOrder(graph.known.get(a), graph.known.get(b))
  const ready = [...nodes].filter(id => incoming.get(id) === 0).sort(order)
  const depths = new Map([...nodes].map(id => [id, 0]))
  let processed = 0
  while (ready.length) {
    const source = ready.shift(); processed += 1
    for (const target of [...outgoing.get(source)].sort(order)) {
      depths.set(target, Math.max(depths.get(target), depths.get(source) + 1))
      incoming.set(target, incoming.get(target) - 1)
      if (incoming.get(target) === 0) { ready.push(target); ready.sort(order) }
    }
  }
  if (processed !== nodes.size) {
    graph.warnings.push('多个主路径的节点先后关系存在循环冲突；已使用中性层次排版，请核对主路径声明。')
    return fallback
  }
  const allIncoming = new Set(graph.edges.map(edge => edge.target))
  for (const node of graph.nodes) if (!nodes.has(node.id) && (!allIncoming.has(node.id) || node.kind === 'entry')) depths.set(node.id, 0)
  const walk = queue => {
    while (queue.length) {
      queue.sort((a, b) => depths.get(a) - depths.get(b) || order(a, b))
      const source = queue.shift()
      for (const target of fallback.outgoing.get(source)) {
        if (nodes.has(target)) continue
        const depth = depths.get(source) + 1
        if (!depths.has(target) || depth < depths.get(target)) { depths.set(target, depth); queue.push(target) }
      }
    }
  }
  walk([...depths.keys()])
  for (const node of [...graph.nodes].sort(nodeOrder)) if (!depths.has(node.id)) {
    depths.set(node.id, Math.max(-1, ...depths.values()) + 1)
    walk([node.id])
  }
  return { depths, outgoing: fallback.outgoing }
}

/** Stable-v1 only uses declared main paths; older reports retain their main-path convention. */
export function mainPathOf(flow, nodes, depths, outgoing) {
  const known = new Map(nodes.map(n => [n.id, n]))
  if (stableMode(flow)) {
    const mainIds = new Set(listOf(flow?.main_path_ids))
    const members = new Set(listOf(flow?.paths).filter(p => mainIds.has(p?.path_id)).flatMap(p => listOf(p.node_ids)).filter(id => known.has(id)))
    return [...members].sort((a, b) => depths.get(a) - depths.get(b) || nodeOrder(known.get(a), known.get(b)))
  }
  const fromPath = listOf(listOf(flow?.paths)[0]?.node_ids).filter(id => known.has(id))
  if (fromPath.length) return [...new Set(fromPath)]
  const byKind = nodes.filter(n => MAIN_KINDS.has(n.kind)).map(n => n.id)
  if (byKind.length) return byKind.sort((a, b) => depths.get(a) - depths.get(b) || nodeOrder(known.get(a), known.get(b)))
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

/** Declared routes through a node. This never invents a route from reachability. */
export function pathsForNode(flow, nodeId) {
  return listOf(flow?.paths).filter(path => listOf(path?.node_ids).includes(nodeId))
    .sort((a, b) => compareText(a.path_id, b.path_id))
}

function membersForGraph(flow, pathId, graph) {
  const path = listOf(flow?.paths).find(p => p?.path_id === pathId)
  if (!path) return null
  const ids = listOf(path.node_ids).map(String)
  const warnings = []
  const pairs = new Set()
  const edgeIds = new Set()
  const ambiguous = []
  const byId = new Map(graph.edges.map(edge => [edge.edge_id, edge]))
  const byPair = new Map()
  for (const edge of graph.edges) {
    const key = pairKey(edge.source, edge.target)
    if (!byPair.has(key)) byPair.set(key, [])
    byPair.get(key).push(edge)
  }
  const explicit = Array.isArray(path.edge_ids)
  if (explicit && path.edge_ids.length !== Math.max(0, ids.length - 1)) {
    warnings.push(`路径 ${pathId} 的 edge_ids 与节点步数不一致；未匹配的连线不会高亮。`)
  }
  for (let i = 1; i < ids.length; i += 1) {
    const key = pairKey(ids[i - 1], ids[i])
    if (explicit) {
      const edge = byId.get(String(path.edge_ids[i - 1] ?? ''))
      if (edge?.source === ids[i - 1] && edge?.target === ids[i]) { edgeIds.add(edge.edge_id); pairs.add(key) }
      else warnings.push(`路径 ${pathId} 的第 ${i} 条连线与节点顺序不符或不存在，未高亮。`)
    } else {
      const candidates = byPair.get(key) ?? []
      if (candidates.length === 1) { edgeIds.add(candidates[0].edge_id); pairs.add(key) }
      else if (candidates.length > 1) {
        ambiguous.push(key)
        warnings.push(`路径 ${pathId} 在 ${ids[i - 1]} → ${ids[i]} 存在多条条件连线，缺少 edge_ids，无法唯一确定路线。`)
      } else warnings.push(`路径 ${pathId} 的 ${ids[i - 1]} → ${ids[i]} 没有声明连线，未补画。`)
    }
  }
  for (const id of ids) if (!graph.known.has(id)) warnings.push(`路径 ${pathId} 引用了不存在的节点 ${id}。`)
  return { nodes: new Set(ids.filter(id => graph.known.has(id))), pairs, edge_ids: edgeIds, ambiguous_pairs: ambiguous, warnings }
}

/** Exact declared edge membership; legacy parallel edges are reported, never guessed. */
export function pathMembers(flow, pathId) {
  return membersForGraph(flow, pathId, collectGraph(flow))
}

// Condition text is fully wrapped, including long single ASCII tokens. Fixed font
// metrics deliberately overestimate width so badges remain safe across CJK fonts.
function conditionLabel(text) {
  const lines = []
  let current = '', width = 0
  const tokens = String(text).match(/[A-Za-z0-9_./:=<>()|+\-]+|[^\S\r\n]+|\r\n|\n|./gu) ?? []
  const finishLine = () => { lines.push(current); current = ''; width = 0 }
  for (const token of tokens) {
    if (token === '\n' || token === '\r\n') { finishLine(); continue }
    const tokenWidth = [...token].reduce((sum, char) => sum + charWidth(char), 0)
    if (tokenWidth <= 30) {
      if (current && width + tokenWidth > 30) finishLine()
      current += token; width += tokenWidth
      continue
    }
    // Split only a token longer than the entire badge, never a normal algorithm
    // or group name just because it happens to start near the end of a line.
    for (const char of token) {
      const next = charWidth(char)
      if (current && width + next > 30) finishLine()
      current += char; width += next
    }
  }
  if (current || !lines.length) lines.push(current)
  const measured = Math.max(...lines.map(line => [...line].reduce((sum, char) => sum + charWidth(char) * 6, 0)))
  return { lines, w: measured + 16, h: lines.length * 15 + 12 }
}

const rectOverlap = (a, b, padding = 0) => a.x < b.x + b.w + padding && a.x + a.w + padding > b.x && a.y < b.y + b.h + padding && a.y + a.h + padding > b.y
function segmentHitsRect(a, b, box, padding = 3) {
  const rect = { x: box.x - padding, y: box.y - padding, w: box.w + padding * 2, h: box.h + padding * 2 }
  let lo = 0, hi = 1
  const dx = b.x - a.x, dy = b.y - a.y
  for (const [p, q] of [[-dx, a.x - rect.x], [dx, rect.x + rect.w - a.x], [-dy, a.y - rect.y], [dy, rect.y + rect.h - a.y]]) {
    if (!p) { if (q < 0) return false; continue }
    const r = q / p
    if (p < 0) lo = Math.max(lo, r)
    else hi = Math.min(hi, r)
    if (lo > hi) return false
  }
  return true
}
function curvePoints(sx, sy, tx, ty, midY) {
  return Array.from({ length: 33 }, (_, index) => {
    const t = index / 32, u = 1 - t
    return { x: u ** 3 * sx + 3 * u * u * t * sx + 3 * u * t * t * tx + t ** 3 * tx,
      y: u ** 3 * sy + 3 * u * u * t * midY + 3 * u * t * t * midY + t ** 3 * ty }
  })
}

function placeEdgeLabels(edges, nodes, contentRight, contentBottom) {
  const occupied = []
  const labelEdges = edges.filter(edge => edge.condition)
  const fieldRight = Math.max(contentRight, ...edges.flatMap(edge => edge.points.map(p => p.x)))
  let fallbackY = MARGIN_Y
  for (const edge of labelEdges) {
    const size = conditionLabel(edge.condition)
    const candidates = []
    const push = (cx, cy, anchor) => candidates.push({ x: cx - size.w / 2, y: cy - size.h / 2, w: size.w, h: size.h, anchor })
    if (edge.routed) {
      const low = Math.min(edge.route_top, edge.route_bottom), high = Math.max(edge.route_top, edge.route_bottom)
      const center = (low + high) / 2
      const spacing = size.h + LABEL_GAP
      const count = Math.ceil((high - low) / spacing)
      for (let offset = 0; offset <= count; offset += 1) {
        for (const sign of offset ? [-1, 1] : [0]) {
          const y = center + offset * sign * spacing
          if (y - size.h / 2 < low + 4 || y + size.h / 2 > high - 4) continue
          push(edge.lane_x + LABEL_GAP + size.w / 2, y, { x: edge.lane_x, y })
        }
      }
    } else {
      for (const index of [16, 12, 20, 8, 24]) {
        const anchor = edge.points[index]
        for (const dy of [0, -(size.h / 2 + 8), size.h / 2 + 8, -(size.h + 16), size.h + 16]) {
          for (const dx of [0, -(size.w / 2 + 12), size.w / 2 + 12]) push(anchor.x + dx, anchor.y + dy, anchor)
        }
      }
    }
    const fits = box => box.x >= 12 && box.y >= 12
      && !nodes.some(node => rectOverlap(box, node, 7))
      && !occupied.some(label => rectOverlap(box, label, 7))
      && !edges.some(other => other !== edge && other.points.slice(1).some((point, index) => segmentHitsRect(other.points[index], point, box)))
    let box = candidates.find(fits)
    if (!box) {
      // Dense crossings can leave no safe local position. An outside callout is
      // preferable to placing a condition on an unrelated edge or truncating it.
      const anchor = edge.routed ? { x: edge.lane_x, y: (edge.route_top + edge.route_bottom) / 2 } : edge.points[16]
      box = { x: fieldRight + 32, y: fallbackY, w: size.w, h: size.h, anchor }
      while (!fits(box)) box.y += size.h + LABEL_GAP
      fallbackY = box.y + size.h + LABEL_GAP
    }
    const { anchor, ...rect } = box
    const end = { x: Math.min(Math.max(anchor.x, rect.x), rect.x + rect.w), y: Math.min(Math.max(anchor.y, rect.y), rect.y + rect.h) }
    const displaced = Math.hypot(end.x - anchor.x, end.y - anchor.y) > 2
    Object.assign(edge, { label: edge.condition, label_lines: size.lines, label_box: rect,
      label_x: rect.x + rect.w / 2, label_y: rect.y + rect.h / 2,
      label_leader: displaced ? { from: anchor, to: end } : null })
    occupied.push(rect)
  }
  return { right: Math.max(contentRight, fieldRight + 12, ...occupied.map(r => r.x + r.w)), bottom: Math.max(contentBottom, ...occupied.map(r => r.y + r.h)) }
}

/** Stable business-flow geometry and exact identities; no graph edges are inferred. */
export function layoutFlow(flow, options = {}) {
  const graph = collectGraph(flow)
  const version = stableMode(flow) ? 'stable-v1' : 'legacy'
  if (!graph.nodes.length) {
    return { width: 0, height: 0, nodes: [], edges: [], main_path: [], layout_version: version, collapsed: { count: 0, ids: [] },
      warnings: graph.warnings.length ? graph.warnings : ['当前流程没有可绘制节点。'] }
  }
  const full = declaredMainDepths(flow, graph, bfsDepths(graph.nodes, graph.edges))
  const mainPath = mainPathOf(flow, graph.nodes, full.depths, full.outgoing)
  const mainSet = new Set(mainPath)
  const mainEdges = new Set()
  const mainIds = stableMode(flow) ? listOf(flow?.main_path_ids) : listOf(flow?.paths).slice(0, 1).map(path => path.path_id)
  const knownPaths = new Set(listOf(flow?.paths).map(path => path?.path_id))
  for (const id of mainIds) if (!knownPaths.has(id)) graph.warnings.push(`声明的主路径 ${id} 不存在，未推断替代主路径。`)
  for (const path of listOf(flow?.paths)) {
    const members = membersForGraph(flow, path.path_id, graph)
    graph.warnings.push(...members.warnings)
    if (mainIds.includes(path.path_id)) for (const id of members.edge_ids) mainEdges.add(id)
  }
  const activeMembers = options.activePathId ? membersForGraph(flow, options.activePathId, graph) : null
  const orderedNodes = [...graph.nodes].sort(nodeOrder)
  let visible = orderedNodes
  let collapsedIds = []
  const threshold = options.collapseThreshold ?? FLOW_COLLAPSE_THRESHOLD
  if (!options.expandAll && mainPath.length && graph.nodes.length > threshold) {
    const keep = new Set([...mainPath, ...listOf(options.keepNodeIds), ...(activeMembers?.nodes ?? [])])
    for (const edge of graph.edges) {
      if (mainSet.has(edge.source)) keep.add(edge.target)
      if (mainSet.has(edge.target)) keep.add(edge.source)
    }
    visible = orderedNodes.filter(n => keep.has(n.id))
    collapsedIds = orderedNodes.filter(n => !keep.has(n.id)).map(n => n.id)
  }
  const visibleIds = new Set(visible.map(n => n.id))
  const edges = graph.edges.filter(e => visibleIds.has(e.source) && visibleIds.has(e.target))
  // Keep full graph depths while folding so selecting a route does not reshuffle
  // existing rows or change whether one of its edges is a return edge.
  const { depths } = full
  const rows = new Map()
  for (const node of visible) {
    const depth = depths.get(node.id)
    if (!rows.has(depth)) rows.set(depth, { left: [], main: [], right: [] })
    const row = rows.get(depth)
    if (mainSet.has(node.id)) row.main.push(node)
    else if (RIGHT_KINDS.has(node.kind)) row.right.push(node)
    else if (node.kind === 'branch' || node.kind === 'recovery') row.left.push(node)
    else if (!mainSet.size) row.main.push(node) // neutral centered layout, not a semantic main path
    else (row.left.length <= row.right.length ? row.left : row.right).push(node)
  }
  const orderedDepths = [...rows.keys()].sort((a, b) => a - b)
  const maxOf = side => Math.max(0, ...[...rows.values()].map(row => row[side].length))
  const maxLeft = maxOf('left'), maxRight = maxOf('right'), maxMain = Math.max(1, maxOf('main'))
  const colW = BOX_W + COL_GAP
  const axis = MARGIN_X + maxLeft * colW + (maxMain * colW - COL_GAP) / 2
  const groups = new Map()
  for (const edge of edges) {
    const key = pairKey(edge.source, edge.target)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(edge.edge_id)
  }
  const needsLane = edge => depths.get(edge.target) !== depths.get(edge.source) + 1 || groups.get(pairKey(edge.source, edge.target)).length > 1
  const outgoingRails = new Map(), incomingRails = new Map()
  for (const edge of edges.filter(needsLane)) {
    for (const [rails, depth] of [[outgoingRails, depths.get(edge.source)], [incomingRails, depths.get(edge.target)]]) {
      if (!rails.has(depth)) rails.set(depth, [])
      rails.get(depth).push(edge.edge_id)
    }
  }
  const maxRails = Math.max(0, ...[...outgoingRails.values(), ...incomingRails.values()].map(ids => ids.length))
  const largestLabel = Math.max(0, ...edges.filter(e => e.condition).map(e => conditionLabel(e.condition).h))
  const rowGap = Math.max(ROW_GAP, largestLabel + 32 + maxRails * 24)
  const topMargin = Math.max(MARGIN_Y, maxRails * 12 + 18)
  const placed = new Map()
  orderedDepths.forEach((depth, rowIndex) => {
    const row = rows.get(depth), y = topMargin + rowIndex * (BOX_H + rowGap)
    const halfMain = (maxMain - 1) / 2
    const put = (node, cx, column) => placed.set(node.id, { ...node, x: Math.round(cx - BOX_W / 2), y, w: BOX_W, h: BOX_H, depth, column,
      lines: wrapLabel(node.label, 26, 3), on_main: mainSet.has(node.id) })
    row.main.forEach((node, i) => put(node, axis + (i - (row.main.length - 1) / 2) * colW, 'main'))
    row.left.forEach((node, i) => put(node, axis - (halfMain + i + 1) * colW, 'left'))
    row.right.forEach((node, i) => put(node, axis + (halfMain + i + 1) * colW, 'right'))
  })
  const contentRight = Math.max(...[...placed.values()].map(node => node.x + node.w))
  const contentBottom = Math.max(...[...placed.values()].map(node => node.y + node.h))
  let nextLane = contentRight + 36
  const laidEdges = edges.map(edge => {
    const a = placed.get(edge.source), b = placed.get(edge.target)
    const parallels = groups.get(pairKey(edge.source, edge.target))
    const portOffset = (parallels.indexOf(edge.edge_id) - (parallels.length - 1) / 2) * Math.min(22, 120 / parallels.length)
    const forward = b.depth > a.depth
    const base = { ...edge, label: edge.condition, on_main: mainEdges.has(edge.edge_id) }
    if (!needsLane(edge)) {
      const sx = a.x + a.w / 2 + portOffset, sy = a.y + a.h, tx = b.x + b.w / 2 + portOffset, ty = b.y
      const my = (sy + ty) / 2
      return { ...base, back: false, routed: false, path: `M${sx} ${sy} C${sx} ${my} ${tx} ${my} ${tx} ${ty}`,
        points: curvePoints(sx, sy, tx, ty, my), label_x: (sx + tx) / 2, label_y: my }
    }
    // Return, same-row, self, and skipped-layer edges use gutters outside nodes.
    // Each lane reserves the full measured condition width, not a fixed 14px.
    const outside = nextLane
    nextLane += (edge.condition ? conditionLabel(edge.condition).w : 0) + 36
    const sx = a.x + a.w / 2 + portOffset, sy = a.y + a.h
    const tx = b.x + b.w / 2 + portOffset, ty = b.y
    const bottom = sy + 12 + outgoingRails.get(a.depth).indexOf(edge.edge_id) * 12
    const top = ty - 12 - incomingRails.get(b.depth).indexOf(edge.edge_id) * 12
    const points = [{ x: sx, y: sy }, { x: sx, y: bottom }, { x: outside, y: bottom }, { x: outside, y: top }, { x: tx, y: top }, { x: tx, y: ty }]
    return { ...base, back: !forward, routed: true, lane_x: outside, route_top: top, route_bottom: bottom,
      path: points.map((point, i) => `${i ? 'L' : 'M'}${point.x} ${point.y}`).join(' '), points,
      label_x: outside + LABEL_GAP, label_y: (bottom + top) / 2 }
  })
  const extent = placeEdgeLabels(laidEdges, [...placed.values()], contentRight, Math.max(contentBottom, ...laidEdges.flatMap(edge => edge.points.map(point => point.y))))
  const height = extent.bottom + MARGIN_Y + (collapsedIds.length ? 56 : 0)
  const width = Math.max(480, extent.right + MARGIN_X)
  return { width: Math.ceil(width), height: Math.ceil(height), nodes: [...placed.values()], edges: laidEdges,
    warnings: [...new Set(graph.warnings)], layout_version: version, main_path: mainPath.filter(id => visibleIds.has(id)),
    collapsed: { count: collapsedIds.length, ids: collapsedIds } }
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
