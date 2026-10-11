// Render layouts into a framework-neutral element tree {tag, attrs, children}.
// The client maps the tree to React elements; the host serializes it with
// toSvgString to store graph.svg. No scripts or external resources are emitted.
import { FLOW_KIND_COLORS, FLOW_KIND_LABELS } from './layout.js'

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
 * @param {ReturnType<import('./layout.js').layoutFlow>} layout
 * @param {{highlight?: {nodes:Set<string>, pairs:Set<string>}|null, selected?: string|null, idPrefix?: string}} options
 */
export function renderFlowTree(layout, options = {}) {
  const prefix = options.idPrefix ?? 'pf'
  const highlight = options.highlight ?? null
  const dimNode = id => highlight && !highlight.nodes.has(id)
  const edgeOn = edge => highlight && highlight.pairs.has(`${edge.source}\u0000${edge.target}`)
  const edges = layout.edges.map(edge => {
    const on = edgeOn(edge)
    const dim = highlight && !on
    const condition = edge.condition
    return el('g', { 'data-edge': `${edge.source}->${edge.target}`, opacity: dim ? 0.18 : 1 },
      el('path', { d: edge.path, fill: 'none', stroke: on ? HIGHLIGHT : NEUTRAL, 'stroke-width': on ? 2.4 : 1.4,
        'stroke-dasharray': edge.back ? '6 4' : null, 'marker-end': `url(#${prefix}-${on ? 'arrow-hi' : 'arrow'})` }),
      condition ? el('g', {},
        el('title', {}, condition),
        el('text', { x: edge.label_x, y: edge.label_y - 4, 'text-anchor': edge.back ? 'start' : 'middle', 'font-size': 11,
          fill: '#475569', stroke: '#ffffff', 'stroke-width': 3, 'paint-order': 'stroke' }, edge.label)) : null)
  })
  const nodes = layout.nodes.map(node => {
    const color = FLOW_KIND_COLORS[node.kind] ?? NEUTRAL
    const selected = options.selected === node.id
    return el('g', { 'data-node-id': node.id, cursor: 'pointer', opacity: dimNode(node.id) ? 0.25 : 1 },
      el('title', {}, `${node.label}${node.kind ? `（${FLOW_KIND_LABELS[node.kind] ?? node.kind}）` : ''}${node.description ? `\n${node.description}` : ''}`),
      el('rect', { x: node.x, y: node.y, width: node.w, height: node.h, rx: 10, fill: '#ffffff', stroke: color,
        'stroke-width': selected ? 3 : node.on_main ? 2 : 1.4 }),
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
    'font-family': FONT, role: 'img' },
    arrowDefs(prefix), el('rect', { x: 0, y: 0, width: layout.width, height: layout.height, fill: '#fbfcfe' }),
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
