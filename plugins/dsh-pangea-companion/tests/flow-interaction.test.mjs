import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { behaviorCoverageProjection } from '../src/behavior-coverage.js'
import { toInteractiveFlowSvg, renderFlowTree, toSvgString } from '../src/flow-graph/render.js'
import { layoutFlow } from '../src/flow-graph/layout.js'

async function harness() {
  let cursor = 0, exported
  const hooks = []
  const react = {
    createElement(type, props, ...children) { return { type, props: props ?? {}, children } },
    Fragment: Symbol('Fragment'), useEffect() {}, useCallback(fn) { return fn },
    useState(initial) {
      const key = cursor++
      if (!(key in hooks)) hooks[key] = typeof initial === 'function' ? initial() : initial
      return [hooks[key], value => { hooks[key] = typeof value === 'function' ? value(hooks[key]) : value }]
    },
    useRef(initial) { const key = cursor++; return hooks[key] ??= { current: initial } },
  }
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  vm.runInNewContext(source, { console, URLSearchParams, AbortController, setInterval, clearInterval,
    window: { __ModuleLoader__: { load(spec) { exported = spec.factory(name => name === 'react' ? react : {}) } } } })
  return { client: exported, render(name, props) { cursor = 0; return exported[name](props) } }
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return tree && typeof tree === 'object' ? [tree, ...(tree.children ?? []).flatMap(nodes)] : []
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ')
  return tree && typeof tree === 'object' ? (tree.children ?? []).map(text).join(' ') : tree == null ? '' : String(tree)
}
const find = (tree, key, value) => nodes(tree).find(node => node.props[key] === value)
const flow = () => ({ unit_id: 'u', flow_id: 'f', layout_version: 'stable-v1', revision: 1, main_path_ids: [],
  nodes: ['a', 'b', 'c', 'd'].map(id => ({ id, label: id.toUpperCase() })),
  edges: [{ edge_id: 'ab', source_step_key: 'a', target_step_key: 'b', condition: '算法 A / DH 组 1' },
    { edge_id: 'ac', source_step_key: 'a', target_step_key: 'c', condition: '算法 B' },
    { edge_id: 'ab2', source_step_key: 'a', target_step_key: 'b', condition: '算法 C / DH 组 2' }],
  paths: [{ path_id: 'p1', node_ids: ['a', 'b'], edge_ids: ['ab'] }, { path_id: 'p2', node_ids: ['a', 'c'], edge_ids: ['ac'] }] })

test('node click selects the sole declared route, asks on shared nodes, retains valid choice and resets on revision', async () => {
  const app = await harness(), data = flow()
  const render = () => app.render('FlowGraphView', { flow: data })
  let tree = render()
  find(tree, 'data-node-id', 'a').props.onClick()
  tree = render()
  assert.equal(find(tree, 'aria-label', '高亮路径').props.value, '')
  assert.match(text(find(tree, 'aria-label', '节点路径选择')), /2 条已声明路径.*请选择/)
  find(tree, 'data-node-id', 'b').props.onKeyDown({ key: 'Enter', preventDefault() {} })
  tree = render()
  assert.equal(find(tree, 'aria-label', '高亮路径').props.value, 'p1')
  assert.equal(find(tree, 'data-edge-id', 'ab').props['data-highlighted'], 'true')
  assert.equal(find(tree, 'data-edge-id', 'ab2').props['data-highlighted'], 'false')
  find(tree, 'data-node-id', 'a').props.onClick()
  tree = render()
  assert.equal(find(tree, 'aria-label', '高亮路径').props.value, 'p1')
  find(tree, 'data-node-id', 'd').props.onClick()
  tree = render()
  assert.equal(find(tree, 'aria-label', '高亮路径').props.value, '')
  assert.match(text(find(tree, 'aria-label', '节点路径选择')), /没有已声明路径.*不推断/)
  find(tree, 'data-node-id', 'b').props.onClick()
  data.revision++
  tree = render()
  assert.equal(find(tree, 'aria-label', '高亮路径').props.value, '')
  assert.equal(find(tree, 'aria-label', '节点详情'), undefined)
})

test('crossing edges never changes page state; explicit activation selects exact endpoints and stable details', async () => {
  const app = await harness(), data = flow()
  const render = () => app.render('FlowGraphView', { flow: data })
  let tree = render()
  const edge = find(tree, 'data-edge-id', 'ab2')
  assert.ok(find(edge, 'data-edge-label', 'ab2'))
  assert.equal(nodes(tree).filter(node => node.props['data-edge-id'] === 'ab2').length, 1)
  // Hover/focus can style the condition badge, but must not render an inserted
  // detail block that displaces the SVG under the pointer (the flicker loop).
  for (const name of ['onPointerEnter', 'onPointerLeave', 'onFocus', 'onBlur']) assert.equal(edge.props[name], undefined)
  assert.equal(find(tree, 'aria-label', '连线详情'), undefined)
  edge.props.onClick()
  tree = render()
  assert.equal(find(tree, 'data-edge-id', 'ab2').props['data-focused'], 'true')
  assert.equal(find(tree, 'data-edge-id', 'ab').props['data-highlighted'], 'false')
  for (const id of ['a', 'b']) assert.equal(find(tree, 'data-node-id', id).props['data-highlighted'], 'true')
  assert.match(text(find(tree, 'aria-label', '连线详情')), /算法 C.*DH 组 2/)
  const contents = nodes(tree)
  assert.ok(contents.indexOf(find(tree, 'aria-label', '流程图画布，Ctrl加滚轮缩放，普通滚轮滚动页面，拖拽移动')) < contents.indexOf(find(tree, 'aria-label', '连线详情')))
  find(tree, 'data-edge-id', 'ac').props.onKeyDown({ key: ' ', preventDefault() {}, stopPropagation() {} })
  tree = render()
  assert.equal(find(tree, 'data-edge-id', 'ac').props['data-focused'], 'true')
  assert.equal(find(tree, 'data-edge-id', 'ab2').props['data-focused'], 'false')
  data.revision++
  tree = render()
  assert.equal(find(tree, 'aria-label', '连线详情'), undefined)
})

test('interactive SVG embeds escaped data and verified route identities while static SVG remains script-free', () => {
  const data = flow()
  const malicious = '</metadata><script>globalThis.pwned = true</script><![CDATA['
  data.nodes[0].label = malicious
  data.paths[0].title = malicious
  data.paths.push({ path_id: 'broken', node_ids: ['a', 'c'], edge_ids: ['ab'] })
  const svg = toInteractiveFlowSvg(data)
  assert.equal((svg.match(/<script /g) ?? []).length, 1)
  assert.doesNotMatch(svg, /<script>globalThis/)
  assert.match(svg, /&lt;\/metadata&gt;&lt;script&gt;/)
  const metadata = svg.match(/<metadata[^>]*>(.*?)<\/metadata>/s)[1]
  const decode = value => value.replace(/&(quot|#39|lt|gt|amp);/g, (_, key) => ({ quot: '"', '#39': "'", lt: '<', gt: '>', amp: '&' })[key])
  const payload = JSON.parse(decode(metadata))
  assert.equal(payload.nodes.find(node => node.id === 'a').label, malicious)
  assert.deepEqual(payload.paths.find(path => path.path_id === 'p1').edge_ids, ['ab'])
  assert.deepEqual(payload.paths.find(path => path.path_id === 'broken').edge_ids, [])
  assert.ok(payload.paths.find(path => path.path_id === 'broken').warnings.length > 0)
  assert.match(svg, /data-control="next"/)
  assert.match(svg, /addEventListener\('keydown'/)
  assert.doesNotMatch(toSvgString(renderFlowTree(layoutFlow(data))), /<script/)
})

// A small DOM surface for executing the actual embedded SVG script with no
// browser/test dependencies. It deliberately implements no selection behavior.
function svgDom(tree, parent = null) {
  if (!tree || typeof tree !== 'object') return { textContent: String(tree ?? ''), parentElement: parent }
  const attrs = { ...tree.attrs }, listeners = {}
  const element = {
    tagName: tree.tag, parentElement: parent, children: [],
    getAttribute(name) { return Object.hasOwn(attrs, name) ? String(attrs[name]) : null },
    hasAttribute(name) { return Object.hasOwn(attrs, name) },
    setAttribute(name, value) { attrs[name] = String(value) }, removeAttribute(name) { delete attrs[name] },
    matches(selector) {
      return selector.split(',').some(part => {
        const match = part.trim().match(/^\[([^\]]+)\]$/)
        return match ? this.hasAttribute(match[1]) : this.tagName === part.trim()
      })
    },
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) },
    querySelectorAll(selector) { return this.children.flatMap(child => child.tagName ? [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)] : []) },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null },
    contains(child) { return child === this || Boolean(child.parentElement && this.contains(child.parentElement)) },
    addEventListener(name, handler) { listeners[name] = handler },
    dispatch(name, target, key) {
      const event = { target, key, prevented: false, preventDefault() { this.prevented = true } }
      listeners[name](event); return event
    },
    get textContent() { return this.children.map(child => child.textContent).join('') },
    set textContent(value) { this.children = [{ textContent: String(value), parentElement: this }] },
  }
  element.children = (tree.children ?? []).map(child => svgDom(child, element))
  return element
}

test('downloaded SVG script runs standalone: node routes, exact parallel edges, keyboard, and escaping', () => {
  const data = flow()
  data.nodes[0].description = '</script><script>globalThis.pwned=true</script>' + '接收数据后验证消息边界并记录异常原因。'.repeat(30)
  const markup = toInteractiveFlowSvg(data)
  const decode = value => value.replace(/&(quot|#39|lt|gt|amp);/g, (_, key) => ({ quot: '"', '#39': "'", lt: '<', gt: '>', amp: '&' })[key])
  const json = decode(markup.match(/<metadata[^>]*>(.*?)<\/metadata>/s)[1])
  const script = markup.match(/<script[^>]*><!\[CDATA\[([\s\S]*)\]\]><\/script>/)[1]
  const tree = renderFlowTree(layoutFlow(data), { idPrefix: 'flow-export' })
  tree.children.push({ tag: 'metadata', attrs: { 'data-flow-payload': 'true' }, children: [json] },
    ...['status', 'detail'].map(name => ({ tag: 'g', attrs: { [`data-flow-${name}`]: 'true' }, children: [
      { tag: 'title', attrs: {}, children: [] },
      ...[0, 1].map(index => ({ tag: 'text', attrs: { 'data-caption-line': index }, children: [] })),
    ] })),
    ...['previous', 'next', 'reset'].map(name => ({ tag: 'g', attrs: { 'data-control': name }, children: [] })))
  const svg = svgDom(tree), context = vm.createContext({ document: { documentElement: svg } })
  vm.runInContext(script, context)
  const group = (attr, id) => svg.querySelectorAll(`[${attr}]`).find(item => item.getAttribute(attr) === id)
  const click = (attr, id) => svg.dispatch('click', group(attr, id))
  const high = id => group('data-edge-id', id).getAttribute('data-highlighted')
  click('data-node-id', 'b')
  assert.equal(high('ab'), 'true')
  assert.equal(high('ab2'), 'false')
  click('data-control', 'reset')
  click('data-node-id', 'a')
  assert.match(svg.querySelector('[data-flow-status]').textContent, /2 条声明路径/)
  assert.equal(high('ab'), 'false')
  assert.equal(context.pwned, undefined)
  assert.match(svg.querySelector('[data-flow-detail]').textContent, /<script>globalThis/)
  const detail = svg.querySelector('[data-flow-detail]')
  assert.equal(detail.querySelector('title').textContent, `A：${data.nodes[0].description}`)
  const lines = detail.querySelectorAll('[data-caption-line]')
  assert.match(lines.at(-1).textContent, /悬停查看全文/)
  assert.ok(lines.every(line => [...line.textContent].reduce((sum, char) => sum + (char.codePointAt(0) > 255 ? 2 : 1), 0) <= Math.floor((JSON.parse(json).width - 32) / 7.5)))
  svg.dispatch('keydown', group('data-control', 'next'), 'Enter')
  assert.equal(high('ab'), 'true')
  svg.dispatch('keydown', group('data-control', 'next'), ' ')
  assert.equal(high('ab'), 'false')
  assert.equal(high('ac'), 'true')
  // Clicking nested label text delegates to its edge, without guessing siblings.
  const edge = group('data-edge-id', 'ab2')
  svg.dispatch('click', edge.querySelector('text'))
  assert.equal(edge.getAttribute('data-focused'), 'true')
  const escaped = svg.dispatch('keydown', edge, 'Escape')
  assert.equal(escaped.prevented, true)
  assert.ok(svg.querySelectorAll('[data-edge-id]').every(item => item.getAttribute('data-highlighted') === 'false'))
})

test('cycle route preserves repeated ordered steps and drag suppression does not consume keyboard clicks', async () => {
  const app = await harness(), data = flow()
  data.edges.push({ edge_id: 'ba', source_step_key: 'b', target_step_key: 'a', condition: '重试' })
  data.paths = [{ path_id: 'retry', node_ids: ['a', 'b', 'a', 'c'], edge_ids: ['ab', 'ba', 'ac'] }]
  const render = () => app.render('FlowGraphView', { flow: data })
  let tree = render()
  find(tree, 'data-node-id', 'b').props.onClick()
  tree = render()
  assert.match(text(find(tree, 'aria-label', '所选路径步骤')), /1\. A → 2\. B → 3\. A → 4\. C/)
  const canvas = find(tree, 'aria-label', '流程图画布，Ctrl加滚轮缩放，普通滚轮滚动页面，拖拽移动')
  const target = { setPointerCapture() {}, hasPointerCapture() { return true }, releasePointerCapture() {} }
  const event = { button: 0, pointerId: 1, clientX: 10, clientY: 10, currentTarget: target, preventDefault() {} }
  canvas.props.onPointerDown(event)
  canvas.props.onPointerMove({ ...event, clientX: 30 })
  canvas.props.onPointerUp(event)
  let prevented = 0, stopped = 0
  const click = detail => ({ detail, preventDefault() { prevented++ }, stopPropagation() { stopped++ } })
  canvas.props.onClickCapture(click(0))
  assert.equal(prevented, 0)
  canvas.props.onClickCapture(click(1))
  assert.equal(prevented, 1)
  assert.equal(stopped, 1)
  canvas.props.onClickCapture(click(1))
  assert.equal(prevented, 1)
})

test('coverage list links declared variants and comparison distinguishes structural equality from text changes', async () => {
  const app = await harness()
  const ledgers = behaviorCoverageProjection([{ projection_id: 'n', unit_id: 'u', format_version: 'behavior-coverage-v1', scope: '连接', items: [
    { item_id: 'B', operation: '连接', status: 'designed', case_refs: [{ case_id: 'TC', variant_id: 'V' }], reason: '已设计组合' },
    { item_id: 'M', operation: '取消', status: 'missing', case_refs: [], reason: '缺少核实依据' },
  ] }], [{ unit_id: 'u', test_case_id: 'u/c', case_id: 'TC', variants: [{ variant_id: 'V', input: 'sha384', expected: '连接' }] }])
  let selected
  const tree = app.render('BehaviorCoverageView', { ledgers, onCase(link) { selected = link } })
  assert.match(text(tree), /不代表已执行.*实测代码覆盖率/)
  assert.match(text(tree), /待补用例.*缺少核实依据/)
  nodes(tree).find(node => node.type === 'button' && text(node) === 'TC / V').props.onClick()
  assert.equal(selected.target_case_id, 'u/c')
  assert.equal(selected.variant_id, 'V')
  const comparison = app.render('FlowComparisonView', {
    stability: { fingerprint: 'hash', model: { metadata_status: 'unknown' } },
    comparison: { comparison_scope: 'delivery', reviewed: false, comparability: { status: 'unknown' }, flows: [
      { flow_id: 'f', status: 'unchanged', content_changed: true, content_changes: { changed: [{ before: '旧依据', after: '新依据' }] } },
    ] },
  })
  assert.match(text(comparison), /结构相同.*文字\/依据变化待核实/)
  assert.match(text(comparison), /旧依据.*新依据/s)
  assert.match(text(comparison), /未作语义裁决/)
  assert.match(text(comparison), /模型设置记录：未知/)
})

test('analysis request includes only explicitly chosen flow baseline', async () => {
  const { client } = await harness()
  assert.equal(Object.hasOwn(client.buildAnalysisRequest({ repository: 'r' }), 'flow_baseline'), false)
  const baseline = { run_id: 'reviewed-run', version_id: 'v17' }
  const request = client.buildAnalysisRequest({ repository: 'r', flow_baseline: baseline })
  assert.equal(request.flow_baseline.run_id, 'reviewed-run')
  assert.equal(request.flow_baseline.version_id, 'v17')
  assert.notEqual(request.flow_baseline, baseline)
})
