// Render layouts into a framework-neutral element tree {tag, attrs, children}.
// The client maps the tree to React elements; the host serializes it with
// toSvgString keeps ordinary trees static. Interactive downloads explicitly opt
// into toInteractiveFlowSvg, which embeds only our fixed local event handler.
import { FLOW_KIND_COLORS, FLOW_KIND_LABELS, layoutFlow, pathMembers } from './layout.js'

const FONT = "'Microsoft YaHei UI','PingFang SC','Noto Sans CJK SC',sans-serif"
const NEUTRAL = '#7c8798'
const HIGHLIGHT = '#3157d5'

const el = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.flat().filter(c => c != null && c !== false) })

function arrowDefs(prefix) {
  const marker = (id, color) => el('marker', { id: `${prefix}-${id}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' },
    el('path', { d: 'M0 0 L10 5 L0 10 z', fill: color }))
  return el('defs', {}, marker('arrow', NEUTRAL), marker('arrow-hi', HIGHLIGHT))
}

function textLines(lines, x, y, attrs = {}) {
  const lineHeight = 17
  const top = y - ((lines.length - 1) * lineHeight) / 2
  return el('text', { x, 'text-anchor': 'middle', 'font-size': 13, fill: '#1f2937', ...attrs },
    lines.map((line, index) => el('tspan', { x, y: top + index * lineHeight + 4 }, line)))
}

/**
 * Render exact edge identities, visible condition badges and an accessible hit
 * region. Pointer handlers are attached by the client only to the edge group.
 * @param {ReturnType<import('./layout.js').layoutFlow>} layout
 * @param {{highlight?: object|null, selected?: string|null, focusedEdgeId?: string|null, idPrefix?: string}} options
 */
export function renderFlowTree(layout, options = {}) {
  const prefix = options.idPrefix ?? 'pf'
  const highlight = options.highlight ?? null
  const focusedId = options.focusedEdgeId ?? options.hoverEdge ?? options.selectedEdge ?? null
  const focused = layout.edges.find(edge => edge.edge_id === focusedId)
  const focusNodes = new Set(focused ? [focused.source, focused.target] : [])
  const pairCounts = new Map()
  for (const edge of layout.edges) {
    const key = `${edge.source}\u0000${edge.target}`
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
  }
  const edgeOn = edge => {
    if (edge.edge_id === focusedId) return true
    if (!highlight) return false
    if (highlight.edge_ids instanceof Set) return highlight.edge_ids.has(edge.edge_id)
    // Compatibility for old branch highlights: an ambiguous pair must not
    // accidentally light every parallel condition edge.
    const pair = `${edge.source}\u0000${edge.target}`
    return pairCounts.get(pair) === 1 && Boolean(highlight.pairs?.has(pair))
  }
  const nodeOn = id => focusNodes.has(id) || Boolean(highlight?.nodes?.has(id))
  const hasHighlight = Boolean(highlight || focused)
  const edges = layout.edges.map(edge => {
    const on = edgeOn(edge), focusedEdge = edge.edge_id === focusedId
    const dim = hasHighlight && !on
    const color = on ? HIGHLIGHT : NEUTRAL
    const condition = edge.condition
    const box = edge.label_box
    const leader = edge.label_leader
    return el('g', { 'data-edge': `${edge.source}->${edge.target}`, 'data-edge-id': edge.edge_id,
      'data-highlighted': on ? 'true' : 'false', 'data-focused': focusedEdge ? 'true' : 'false',
      'aria-label': `${edge.source} → ${edge.target}${condition ? `：${condition}` : ''}`,
      cursor: 'pointer', opacity: dim ? 0.16 : 1 },
      el('title', {}, `${edge.source} → ${edge.target}${condition ? `：${condition}` : ''}`),
      el('path', { d: edge.path, fill: 'none', stroke: 'transparent', 'stroke-width': 8, 'pointer-events': 'stroke', 'data-edge-hit': 'true' }),
      el('path', { d: edge.path, fill: 'none', stroke: color, 'stroke-width': focusedEdge ? 3.6 : on ? 2.8 : 1.4,
        'data-edge-line': 'true', 'pointer-events': 'none',
        'stroke-dasharray': edge.back ? '6 4' : null, 'marker-end': `url(#${prefix}-${on ? 'arrow-hi' : 'arrow'})` }),
      condition ? el('g', { 'data-edge-label': edge.edge_id },
        leader ? el('path', { d: `M${leader.from.x} ${leader.from.y} L${leader.to.x} ${leader.to.y}`, fill: 'none', stroke: color,
          'stroke-width': on ? 1.5 : 1, 'stroke-dasharray': '2 2', 'pointer-events': 'none' }) : null,
        leader ? el('circle', { cx: leader.from.x, cy: leader.from.y, r: on ? 3 : 2, fill: color, 'pointer-events': 'none' }) : null,
        box ? el('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: 4, 'data-edge-label-box': 'true',
          fill: on ? '#eff6ff' : '#ffffff', stroke: on ? HIGHLIGHT : '#cbd5e1', 'stroke-width': on ? 1.4 : 1 }) : null,
        el('text', { x: edge.label_x, 'text-anchor': 'middle', 'font-size': 11, fill: on ? '#1e40af' : '#334155', 'font-weight': on ? 600 : 400 },
          (edge.label_lines ?? [edge.label]).map((line, index, lines) => el('tspan', {
            x: edge.label_x, y: edge.label_y - ((lines.length - 1) * 15) / 2 + index * 15 + 4 }, line)))) : null)
  })
  const nodes = layout.nodes.map(node => {
    const on = nodeOn(node.id)
    const color = on ? HIGHLIGHT : FLOW_KIND_COLORS[node.kind] ?? NEUTRAL
    const selected = options.selected === node.id
    return el('g', { 'data-node-id': node.id, 'data-highlighted': on ? 'true' : 'false', 'data-selected': selected ? 'true' : 'false',
      cursor: 'pointer', opacity: hasHighlight && !on ? 0.25 : 1 },
      el('title', {}, `${node.label}${node.kind ? `（${FLOW_KIND_LABELS[node.kind] ?? node.kind}）` : ''}${node.description ? `\n${node.description}` : ''}`),
      el('rect', { x: node.x, y: node.y, width: node.w, height: node.h, rx: 10, 'data-node-shape': 'true', fill: on ? '#eff6ff' : '#ffffff', stroke: color,
        'stroke-width': selected || focusNodes.has(node.id) ? 3 : on ? 2.6 : node.on_main ? 2 : 1.4 }),
      el('rect', { x: node.x, y: node.y, width: 6, height: node.h, rx: 3, fill: color }),
      node.kind ? el('text', { x: node.x + node.w - 8, y: node.y + 15, 'text-anchor': 'end', 'font-size': 10, fill: color }, FLOW_KIND_LABELS[node.kind] ?? node.kind) : null,
      textLines(node.lines, node.x + node.w / 2 + 3, node.y + node.h / 2 + 3))
  })
  const extra = []
  if (layout.collapsed?.count) {
    extra.push(el('text', { x: layout.width / 2, y: layout.height - 22, 'text-anchor': 'middle', 'font-size': 13, fill: '#64748b', 'data-collapsed': 'true' },
      `+${layout.collapsed.count} 个节点（已折叠）`))
  }
  return el('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: `0 0 ${layout.width} ${layout.height}`, width: layout.width, height: layout.height,
    'font-family': FONT, role: 'img', 'data-layout-version': layout.layout_version ?? 'legacy' },
    arrowDefs(prefix),
    // Hover/focus is deliberately local and does not change geometry, page
    // state, or the opacity of other paths. Keyboard activation still selects.
    el('style', {}, '[data-edge-label]:hover [data-edge-label-box], [data-edge-id]:focus-visible [data-edge-label-box] { stroke: #3157d5; fill: #eff6ff; } [data-node-id]:focus-visible [data-node-shape] { stroke: #3157d5; stroke-width: 3; }'),
    el('rect', { x: 0, y: 0, width: layout.width, height: layout.height, fill: '#fbfcfe' }),
    el('g', { class: 'edges' }, edges), el('g', { class: 'nodes' }, nodes), extra)
}

function callNodeShape(node, stroke, width) {
  const { x, y, w, h } = node
  if (node.kind === 'macro') {
    const c = 14
    return el('polygon', { points: `${x + c},${y} ${x + w - c},${y} ${x + w},${y + h / 2} ${x + w - c},${y + h} ${x + c},${y + h} ${x},${y + h / 2}`,
      fill: '#fff8e8', stroke, 'stroke-width': width })
  }
  if (node.kind === 'external') {
    return el('rect', { x, y, width: w, height: h, rx: h / 2, fill: '#f3f4f6', stroke, 'stroke-width': width, 'stroke-dasharray': '5 3' })
  }
  return el('rect', { x, y, width: w, height: h, rx: 8, fill: '#ffffff', stroke, 'stroke-width': width })
}

const CALL_KIND_LABELS = { function: '函数', macro: '宏', external: '外部' }

/**
 * @param {ReturnType<import('./layout.js').layoutCallGraph>} layout
 * @param {{selected?: string|null, highlightCalls?: Set<number>|null, idPrefix?: string}} options
 */
export function renderCallGraphTree(layout, options = {}) {
  const prefix = options.idPrefix ?? 'cg'
  const highlight = options.highlightCalls ?? null
  const edges = layout.edges.map(edge => {
    const on = highlight && edge.indexes.some(i => highlight.has(i))
    const dim = highlight && !on
    const details = edge.calls.map(call => [call.file && `${call.file}${call.line ? `:${call.line}` : ''}`,
      call.args?.length ? `参数：${call.args.join(', ')}` : '', call.returns ? `返回：${call.returns}` : ''].filter(Boolean).join(' ')).filter(Boolean)
    return el('g', { 'data-edge': `${edge.from}->${edge.to}`, opacity: dim ? 0.15 : 1 },
      el('title', {}, [`${edge.from} → ${edge.to}${edge.count > 1 ? `（${edge.count} 次调用）` : ''}`, ...details].join('\n')),
      el('path', { d: edge.path, fill: 'none', stroke: on ? HIGHLIGHT : NEUTRAL, 'stroke-width': on ? 2.4 : 1.4,
        'stroke-dasharray': edge.back ? '6 4' : null, 'marker-end': `url(#${prefix}-${on ? 'arrow-hi' : 'arrow'})` }),
      edge.label ? el('text', { x: edge.label_x, y: edge.label_y, 'text-anchor': 'middle', 'font-size': 11, fill: '#475569',
        stroke: '#ffffff', 'stroke-width': 3, 'paint-order': 'stroke' }, edge.label) : null)
  })
  const nodes = layout.nodes.map(node => {
    const selected = options.selected === node.id
    const isRoot = node.id === layout.root
    const stroke = selected ? HIGHLIGHT : isRoot ? '#3157d5' : node.kind === 'macro' ? '#b47700' : node.kind === 'external' ? '#94a3b8' : '#5b6b83'
    return el('g', { 'data-node-id': node.id, cursor: 'pointer', opacity: node.unreached ? 0.7 : 1 },
      el('title', {}, [node.signature || node.label || node.id, node.file ? `${node.file}${node.line ? `:${node.line}` : ''}` : ''].filter(Boolean).join('\n')),
      callNodeShape(node, stroke, selected ? 3 : isRoot ? 2.2 : 1.4),
      el('text', { x: node.x + node.w - 10, y: node.y + 13, 'text-anchor': 'end', 'font-size': 10, fill: '#64748b' }, CALL_KIND_LABELS[node.kind] ?? ''),
      textLines(node.lines, node.x + node.w / 2, node.y + node.h / 2 + 3, { 'font-family': `Consolas,'Cascadia Mono',${FONT}` }))
  })
  return el('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: `0 0 ${layout.width} ${layout.height}`, width: layout.width, height: layout.height,
    'font-family': FONT, role: 'img' },
    arrowDefs(prefix), el('rect', { x: 0, y: 0, width: layout.width, height: layout.height, fill: '#fbfcfe' }),
    el('g', { class: 'edges' }, edges), el('g', { class: 'nodes' }, nodes))
}

const escapeXml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

/** Serialize an element tree to standalone SVG markup. */
export function toSvgString(tree) {
  if (tree == null || tree === false) return ''
  if (typeof tree !== 'object') return escapeXml(tree)
  const attrs = Object.entries(tree.attrs ?? {})
    .filter(([, value]) => value != null && value !== false)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`).join('')
  const children = (tree.children ?? []).map(toSvgString).join('')
  return children ? `<${tree.tag}${attrs}>${children}</${tree.tag}>` : `<${tree.tag}${attrs}/>`
}

// This function is serialized as trusted application code. All model-authored
// content is separately XML-escaped in metadata and rendered with textContent.
function interactiveFlowRuntime() {
  const svg = document.documentElement
  const data = JSON.parse(svg.querySelector('[data-flow-payload]').textContent)
  const nodes = [...svg.querySelectorAll('[data-node-id]')]
  const edges = [...svg.querySelectorAll('[data-edge-id]')]
  const status = svg.querySelector('[data-flow-status]')
  const detail = svg.querySelector('[data-flow-detail]')
  let selectedNode = '', selectedPath = '', selectedEdge = ''
  const routesForNode = id => data.paths.filter(path => path.node_ids.includes(id))
  const choices = () => selectedNode ? routesForNode(selectedNode) : data.paths
  function caption(target, value) {
    const full = String(value), lines = [...target.querySelectorAll('[data-caption-line]')]
    target.querySelector('title').textContent = full
    target.setAttribute('aria-label', full)
    const capacity = Math.max(20, Math.floor((data.width - 32) / 7.5))
    const chunks = ['']; let used = 0
    for (const char of full) {
      const width = char.codePointAt(0) > 255 ? 2 : 1
      if (char === '\n' || used + width > capacity) { chunks.push(''); used = 0 }
      if (char !== '\n') { chunks[chunks.length - 1] += char; used += width }
    }
    lines.forEach((line, index) => {
      const content = chunks[index] || ''
      line.textContent = index === lines.length - 1 && chunks.length > lines.length
        ? [...content].slice(0, Math.max(0, [...content].length - 12)).join('') + '…（悬停查看全文）' : content
    })
  }
  const original = new Map()
  for (const item of [...nodes, ...edges]) {
    item.setAttribute('role', 'button')
    item.setAttribute('tabindex', '0')
    item.setAttribute('aria-label', item.querySelector('title')?.textContent || '查看详情')
    for (const shape of item.querySelectorAll('[data-node-shape], [data-edge-line]')) {
      original.set(shape, ['stroke', 'stroke-width', 'fill', 'marker-end'].map(name => [name, shape.getAttribute(name)]))
    }
  }
  function update() {
    const route = data.paths.find(path => path.path_id === selectedPath)
    const edge = data.edges.find(item => item.edge_id === selectedEdge)
    const nodeIds = new Set(route?.node_ids || [])
    const edgeIds = new Set(route?.edge_ids || [])
    if (selectedNode) nodeIds.add(selectedNode)
    if (edge) { nodeIds.add(edge.source); nodeIds.add(edge.target); edgeIds.add(edge.edge_id) }
    const dim = Boolean(route || edge)
    for (const [shape, attrs] of original) for (const [name, value] of attrs) {
      if (value === null) shape.removeAttribute(name)
      else shape.setAttribute(name, value)
    }
    for (const item of nodes) {
      const id = item.getAttribute('data-node-id'), on = nodeIds.has(id)
      item.setAttribute('data-highlighted', String(on))
      item.setAttribute('data-selected', String(id === selectedNode))
      item.setAttribute('aria-pressed', String(id === selectedNode))
      item.setAttribute('opacity', dim && !on ? '0.25' : '1')
      if (on) {
        const shape = item.querySelector('[data-node-shape]')
        shape.setAttribute('stroke', '#3157d5'); shape.setAttribute('fill', '#eff6ff'); shape.setAttribute('stroke-width', '3')
      }
    }
    for (const item of edges) {
      const id = item.getAttribute('data-edge-id'), on = edgeIds.has(id)
      item.setAttribute('data-highlighted', String(on))
      item.setAttribute('data-focused', String(id === selectedEdge))
      item.setAttribute('aria-pressed', String(id === selectedEdge))
      item.setAttribute('opacity', dim && !on ? '0.16' : '1')
      if (on) {
        const line = item.querySelector('[data-edge-line]')
        line.setAttribute('stroke', '#3157d5'); line.setAttribute('stroke-width', '3')
        line.setAttribute('marker-end', `url(#${data.prefix}-arrow-hi)`)
      }
    }
    const candidates = choices(), position = candidates.findIndex(path => path.path_id === selectedPath)
    caption(status, route ? `${route.title || route.path_id} · 路径 ${position + 1}/${candidates.length}${route.warnings.length ? ' · 部分连线未确认，未高亮' : ''}`
      : selectedNode ? candidates.length ? `此节点属于 ${candidates.length} 条声明路径，请用上一条 / 下一条选择。` : '此节点没有声明路径；仅显示节点，不推断路线。'
        : '点击节点查看声明路径；多路径用上一条 / 下一条选择。')
    const node = data.nodes.find(item => item.id === selectedNode)
    caption(detail, edge ? `${edge.source} → ${edge.target}：${edge.condition || '未提供条件'}`
      : node ? `${node.label}${node.description ? `：${node.description}` : ''}` : '支持 Tab、Enter / 空格；Esc 清除。请在浏览器中直接打开本 SVG。')
    for (const button of svg.querySelectorAll('[data-control]')) {
      const disabled = button.getAttribute('data-control') !== 'reset' && candidates.length === 0
      button.setAttribute('aria-disabled', String(disabled))
      button.setAttribute('opacity', disabled ? '0.45' : '1')
    }
  }
  function activate(target) {
    const control = target.getAttribute('data-control')
    if (control === 'reset') { selectedNode = ''; selectedPath = ''; selectedEdge = '' }
    else if (control) {
      const candidates = choices()
      if (!candidates.length) return
      const current = candidates.findIndex(path => path.path_id === selectedPath)
      const next = current < 0 ? control === 'previous' ? candidates.length - 1 : 0
        : (current + (control === 'previous' ? -1 : 1) + candidates.length) % candidates.length
      selectedPath = candidates[next].path_id; selectedEdge = ''
    } else if (target.hasAttribute('data-node-id')) {
      selectedNode = target.getAttribute('data-node-id'); selectedEdge = ''
      const candidates = routesForNode(selectedNode)
      if (!candidates.some(path => path.path_id === selectedPath)) selectedPath = candidates.length === 1 ? candidates[0].path_id : ''
    } else { selectedEdge = target.getAttribute('data-edge-id'); selectedNode = '' }
    update()
  }
  svg.addEventListener('click', event => {
    const target = event.target.closest('[data-node-id], [data-edge-id], [data-control]')
    if (target && svg.contains(target)) activate(target)
  })
  svg.addEventListener('keydown', event => {
    if (event.key === 'Escape') { selectedNode = ''; selectedPath = ''; selectedEdge = ''; update(); event.preventDefault(); return }
    if (event.key !== 'Enter' && event.key !== ' ') return
    const target = event.target.closest('[data-node-id], [data-edge-id], [data-control]')
    if (target && svg.contains(target)) { event.preventDefault(); activate(target) }
  })
  update()
}

/** Offline interactive SVG. Static/PNG serialization never includes this code. */
export function toInteractiveFlowSvg(graph, options = {}) {
  const prefix = String(options.idPrefix ?? 'flow-export').replace(/[^\w-]/g, '_')
  // Include all nodes so an exported path never disappears behind a collapsed
  // view. Route membership uses the same exact edge validator as the UI.
  const layout = layoutFlow(graph, { expandAll: true })
  const drawing = renderFlowTree(layout, { idPrefix: prefix })
  const width = Math.max(720, layout.width), header = 156
  const payload = {
    prefix, width,
    nodes: layout.nodes.map(({ id, label, description }) => ({ id, label, description })),
    edges: layout.edges.map(({ edge_id, source, target, condition }) => ({ edge_id, source, target, condition })),
    paths: (graph.paths ?? []).filter(path => path?.path_id).map(path => {
      const members = pathMembers(graph, path.path_id)
      return { path_id: path.path_id, title: path.title, node_ids: Array.isArray(path.node_ids) ? path.node_ids.filter(id => members?.nodes?.has(id)) : [],
        edge_ids: [...(members?.edge_ids ?? [])], warnings: members?.warnings ?? [] }
    }),
  }
  const button = (action, title, x) => el('g', { 'data-control': action, role: 'button', tabindex: 0, cursor: 'pointer', 'aria-label': title },
    el('rect', { x, y: 10, width: 86, height: 30, rx: 5, fill: '#ffffff', stroke: '#94a3b8' }),
    el('text', { x: x + 43, y: 30, 'text-anchor': 'middle', 'font-size': 13, fill: '#1f2937' }, title))
  const caption = (name, ys, label, color) => el('g', { [`data-flow-${name}`]: 'true', 'aria-live': name === 'status' ? 'polite' : null },
    el('title', {}, label), ys.map((y, index) => el('text', { x: 16, y, 'font-size': 13, fill: color, 'data-caption-line': index }, index === 0 ? label : '')))
  const tree = el('svg', { ...drawing.attrs, width, height: layout.height + header,
    viewBox: `0 0 ${width} ${layout.height + header}`, role: 'group', 'aria-label': '可交互流程图', 'data-interactive-flow': 'v1' },
    el('metadata', { 'data-flow-payload': 'true' }, JSON.stringify(payload)),
    el('rect', { width, height: layout.height + header, fill: '#fbfcfe' }),
    button('previous', '上一条路径', 16), button('next', '下一条路径', 112), button('reset', '清除选择', 208),
    caption('status', [61, 79], '点击节点查看声明路径；多路径用上一条 / 下一条选择。', '#1e40af'),
    caption('detail', [105, 123, 141], '支持 Tab、Enter / 空格；Esc 清除。请在浏览器中直接打开本 SVG。', '#475569'),
    el('g', { transform: `translate(0 ${header})` }, drawing.children))
  const staticMarkup = toSvgString(tree)
  // The fixed source has no model interpolation and no external dependencies.
  const script = `(${interactiveFlowRuntime.toString()})()`
  return staticMarkup.replace(/<\/svg>$/, `<script type="application/ecmascript"><![CDATA[${script.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]></script></svg>`)
}
