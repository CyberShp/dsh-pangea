import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { behaviorCoverageProjection } from '../src/behavior-coverage.js'

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

test('edge and condition label share exact selection, with endpoints, hover restoration and keyboard focus', async () => {
  const app = await harness(), data = flow()
  const render = () => app.render('FlowGraphView', { flow: data })
  let tree = render()
  const edge = find(tree, 'data-edge-id', 'ab2')
  assert.ok(find(edge, 'data-edge-label', 'ab2'))
  assert.equal(nodes(tree).filter(node => node.props['data-edge-id'] === 'ab2').length, 1)
  edge.props.onPointerEnter()
  tree = render()
  assert.equal(find(tree, 'data-edge-id', 'ab2').props['data-focused'], 'true')
  assert.equal(find(tree, 'data-edge-id', 'ab').props['data-highlighted'], 'false')
  for (const id of ['a', 'b']) assert.equal(find(tree, 'data-node-id', id).props['data-highlighted'], 'true')
  assert.match(text(find(tree, 'aria-label', '连线详情')), /算法 C.*DH 组 2/)
  find(tree, 'data-edge-id', 'ab2').props.onKeyDown({ key: ' ', preventDefault() {}, stopPropagation() {} })
  find(tree, 'data-edge-id', 'ab2').props.onPointerLeave()
  tree = render()
  find(tree, 'data-edge-id', 'ac').props.onFocus()
  tree = render()
  assert.equal(find(tree, 'data-edge-id', 'ac').props['data-focused'], 'true')
  find(tree, 'data-edge-id', 'ac').props.onBlur()
  tree = render()
  assert.equal(find(tree, 'data-edge-id', 'ab2').props['data-focused'], 'true')
  data.revision++
  tree = render()
  assert.equal(find(tree, 'aria-label', '连线详情'), undefined)
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
  const canvas = find(tree, 'aria-label', '流程图画布，滚轮缩放，拖拽移动')
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
