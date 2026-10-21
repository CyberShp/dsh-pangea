import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { CALL_GRAPH_EXAMPLE } from './fixtures/call-graph.mjs'

async function harness() {
  let cursor = 0, client
  const hooks = [], requests = [], downloads = []
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
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    console, URLSearchParams, AbortController, Blob, setTimeout: fn => fn(),
    URL: { createObjectURL(blob) { downloads.push(blob); return 'blob:local' }, revokeObjectURL() {} },
    document: { createElement() { return { click() {} } } },
    fetch(...args) { requests.push(args); throw new Error('native view must not request an Agent') },
    window: { __ModuleLoader__: { load(spec) { client = spec.factory(name => name === 'react' ? react : {}) } } },
  })
  return { client, requests, downloads, render(name, props) { cursor = 0; return client[name](props) } }
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return tree && typeof tree === 'object' ? [tree, ...(tree.children ?? []).flatMap(nodes)] : []
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ')
  return tree && typeof tree === 'object' ? (tree.children ?? []).map(text).join(' ') : tree == null ? '' : String(tree)
}
const find = (tree, name, value) => nodes(tree).find(node => node.props[name] === value)
const button = (tree, label) => nodes(tree).find(node => node.type === 'button' && text(node) === label)
const sequence = () => ({ format_version: 'sequence-v1', status: 'ready', title: '提交请求',
  participants: [{ id: 'caller', label: '调用方' }, { id: 'service', label: '服务' }],
  messages: [{ id: 'm1', from: 'caller', to: 'service', label: '提交请求', kind: 'call', source_evidence: ['src/submit.c:20'] },
    { id: 'm2', from: 'service', to: 'caller', label: '返回结果', kind: 'return' }], fragments: [], notes: [] })

test('sequence renders authored messages locally, activates evidence and clears selection on revision', async () => {
  const app = await harness(), source = [], flow = { flow_id: 'f', revision: 1, sequence: sequence() }
  const render = () => app.render('SequenceGraphView', { flow, onSource: (...args) => source.push(args) })
  let tree = render()
  assert.ok(find(tree, 'data-message-id', 'm1'))
  assert.ok(find(tree, 'aria-label', '适应时序图画布'))
  for (const format of ['SVG', 'PNG', 'HTML']) assert.ok(button(tree, `导出 ${format}`))
  assert.equal(nodes(tree).some(node => node.type === 'iframe'), false)
  find(tree, 'data-message-id', 'm1').props.onKeyDown({ key: 'Enter', preventDefault() {} })
  tree = render()
  assert.match(text(find(tree, 'aria-label', '交互详情')), /调用方 → 服务.*提交请求.*src\/submit.c:20/)
  button(tree, 'src/submit.c:20').props.onClick()
  assert.equal(source[0][0], 'src/submit.c:20')
  flow.revision++
  assert.equal(find(render(), 'aria-label', '交互详情'), undefined)
  assert.deepEqual(app.requests, [])
})

test('legacy and explicitly unknown views stay honest without generation buttons or network calls', async () => {
  for (const component of ['SequenceGraphView', 'FunctionVariablesView']) {
    const app = await harness()
    const tree = app.render(component, { flow: { flow_id: 'old' } })
    assert.match(text(tree), /本次分析未提供/)
    assert.equal(nodes(tree).some(node => node.type === 'svg' || node.type === 'iframe' || node.type === 'button'), false)
    assert.deepEqual(app.requests, [])
  }
  for (const status of ['unknown', 'not_applicable']) {
    const app = await harness()
    const tree = app.render('FunctionVariablesView', { flow: { call_graph: { ...CALL_GRAPH_EXAMPLE, status, notes: ['声明理由'] } } })
    assert.match(text(tree), /声明理由/)
    assert.equal(nodes(tree).some(node => node.type?.name === 'CallGraphView'), false)
    assert.match(text(tree), status === 'unknown' ? /尚未确认/ : /不适用/)
    const encoded = app.render('FunctionVariablesView', { flow: { call_graph: JSON.stringify({ ...CALL_GRAPH_EXAMPLE, status }) } })
    assert.equal(nodes(encoded).some(node => node.type?.name === 'CallGraphView'), false)
  }
})

test('partial call graph keeps authored status in wrapper and downloaded SVG/HTML, with local function evidence', async () => {
  const app = await harness(), raw = { ...structuredClone(CALL_GRAPH_EXAMPLE), status: 'partial', notes: ['外部依赖尚未确认'] }
  const wrapper = app.render('FunctionVariablesView', { flow: { call_graph: raw } })
  assert.match(text(wrapper), /部分可用.*外部依赖尚未确认/)
  const child = nodes(wrapper).find(node => node.type?.name === 'CallGraphView')
  assert.equal(child.props.authoredStatus, 'partial')
  assert.equal(child.props.status, 'ok')
  const source = [], render = () => app.render('CallGraphView', { ...child.props, onSource: (...args) => source.push(args) })
  let tree = render()
  find(tree, 'data-node-id', 'login_handler').props.onClick()
  tree = render()
  assert.match(text(find(tree, 'aria-label', '函数变量流')), /变量.*读取.*计算.*check_password.*返回：ok/)
  button(tree, 'src/login.c:20').props.onClick()
  assert.equal(source[0][0], 'src/login.c:20')
  button(tree, '导出 SVG').props.onClick()
  button(tree, '导出 HTML').props.onClick()
  assert.match(await app.downloads[0].text(), /&quot;status&quot;:&quot;partial&quot;/)
  assert.match(await app.downloads[0].text(), /外部依赖尚未确认/)
  assert.match(await app.downloads[0].text(), /变量 ok：读取 user, pw；计算 check_password/)
  assert.match(await app.downloads[0].text(), /<metadata>/)
  assert.match(await app.downloads[1].text(), /&quot;status&quot;: &quot;partial&quot;/)
  assert.deepEqual(app.requests, [])
})

test('malformed sequence preserves raw records and incomplete status in standalone exports', async () => {
  const app = await harness(), flow = { sequence: sequence() }
  flow.sequence.messages.push({ id: 'broken', from: 'missing', to: 'caller', kind: 'call', label: '不可确认的交互' })
  const tree = app.render('SequenceGraphView', { flow })
  assert.match(text(tree), /部分可用/)
  assert.equal(find(tree, 'data-message-id', 'broken'), undefined)
  assert.match(text(tree), /不可确认的交互/)
  button(tree, '导出 SVG').props.onClick()
  const svg = await app.downloads[0].text()
  assert.match(svg, /不完整|待确认/)
  assert.match(svg, /broken/)
})

test('id-less interactions with explicit endpoints stay visible in the built client and exported SVG', async () => {
  const app = await harness(), raw = sequence()
  raw.participants = raw.participants.map(({ id, label }) => ({ id, name: label }))
  raw.messages = Array.from({ length: 5 }, (_, index) => ({ from: 'caller', to: 'service', kind: 'call', label: `交互 ${index + 1}` }))
  raw.notes = '原始说明保留'
  const before = JSON.stringify(raw)
  const tree = app.render('SequenceGraphView', { flow: { sequence: raw } })
  assert.match(text(tree), /部分可用/)
  assert.equal(nodes(tree).filter(node => node.props['data-message-id']).length, 5)
  assert.match(text(tree), /调用方.*服务/s)
  assert.match(text(tree), /原始说明保留/)
  button(tree, '导出 SVG').props.onClick()
  const svg = await app.downloads[0].text()
  for (let index = 1; index <= 5; index++) assert.match(svg, new RegExp(`交互 ${index}`))
  assert.equal(JSON.stringify(raw), before)
  assert.deepEqual(app.requests, [])
})

test('unreadable fragment membership preserves all readable facts without inventing a sequential trace', async () => {
  const app = await harness(), raw = sequence()
  raw.fragments = [{ description: '分支结构未提供' }]
  const tree = app.render('SequenceGraphView', { flow: { sequence: raw } })
  const facts = find(tree, 'aria-label', '分支关系待确认的交互')
  assert.ok(facts)
  assert.match(text(facts), /2 条/)
  assert.match(text(facts), /不表示它们依次执行/)
  assert.match(text(facts), /提交请求.*返回结果/s)
  assert.equal(nodes(tree).filter(node => node.props['data-message-id']).length, 0)
  assert.match(text(tree), /部分可用|尚未明确/)
  assert.deepEqual(app.requests, [])
})

test('explicit call aliases preserve arrows and variable details in built client without rewriting raw facts', async () => {
  const app = await harness(), raw = structuredClone(CALL_GRAPH_EXAMPLE)
  raw.functions = raw.functions.map(({ kind, label, ...row }) => ({ ...row, type: kind, name: label }))
  raw.calls = raw.calls.map(({ from, to, ...row }) => ({ ...row, caller: from, callee: to }))
  raw.variables = raw.variables.map(({ function: fn, ...row }) => ({ ...row, function_id: fn }))
  raw.notes = '函数关系原始说明'
  const before = JSON.stringify(raw)
  const wrapper = app.render('FunctionVariablesView', { flow: { call_graph: raw } })
  const child = nodes(wrapper).find(node => node.type?.name === 'CallGraphView')
  assert.equal(child.props.status, 'partial')
  assert.equal(child.props.graph.calls.length, raw.calls.length)
  assert.equal(child.props.graph.variables.length, raw.variables.length)
  assert.match(text(wrapper), /函数关系原始说明/)
  const tree = app.render('CallGraphView', child.props)
  button(tree, '导出 SVG').props.onClick()
  const svg = await app.downloads[0].text()
  assert.match(svg, /变量/)
  assert.doesNotMatch(svg, /NaN|Infinity/)
  assert.equal(JSON.stringify(raw), before)
  assert.deepEqual(app.requests, [])
})

test('HTML export escapes authored text and preserves searchable analysis without executable content', async () => {
  const app = await harness(), malicious = '</pre><script>alert(1)</script>'
  const html = app.client.diagramHtmlDocument({ tag: 'svg', attrs: {}, children: [{ tag: 'text', children: [malicious] }] }, malicious, { notes: [malicious] })
  assert.doesNotMatch(html, /<script>|<\/pre><script>/)
  assert.match(html, /&lt;\/pre&gt;&lt;script&gt;/)
  assert.match(html, /分析数据与源码依据/)
})


test('variable explanations remain complete outside SVG geometry and in standalone metadata', async () => {
  const app = await harness()
  const graph = { format_version: 'call-graph-v1', root: 'f', title: '窄图变量说明',
    functions: [{ id: 'f', label: '处理请求', kind: 'function', file: 'src/main.c', line: 12 }], calls: [], notes: [],
    variables: [{ function: 'f', name: '最终处理结果', reads: ['输入请求参数与缓存状态'],
      compute: '检查所有输入字段后根据业务条件计算最终处理结果并保留未决状态'.repeat(3) + 'VeryLongIdentifierWithoutAnySpaces'.repeat(3), writes: '输出结果结构体', line: 28 }] }
  const tree = app.render('CallGraphView', { graph })
  button(tree, '导出 SVG').props.onClick()
  const svg = await app.downloads[0].text()
  const width = Number(svg.match(/<svg[^>]* width="([\d.]+)"/)[1])
  assert.ok(width <= 360, `fixture must exercise a narrow graph, got ${width}`)
  assert.doesNotMatch(svg, /data-diagram-caption/)
  assert.match(svg, /<metadata>/)
  assert.ok(svg.includes(graph.variables[0].compute), 'standalone metadata/tooltips retain the full variable text')
  assert.ok(text(tree).includes(graph.variables[0].compute), 'HTML explanation is readable outside the zoom canvas')
  const height = Number(svg.match(/<svg[^>]* height="([\d.]+)"/)[1])
  const withoutVariables = app.render('CallGraphView', { graph: { ...graph, variables: [] } })
  button(withoutVariables, '导出 SVG').props.onClick()
  const simple = await app.downloads[1].text()
  assert.equal(height, Number(simple.match(/<svg[^>]* height="([\d.]+)"/)[1]), 'long variable explanations must not change fit geometry')
})
