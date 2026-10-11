import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeFlow, normalizeFlows, COMPAT_PREFIX } from '../src/flow-normalize.js'

const base = {
  flow_id: 'F', title: '登录', role: 'main',
  nodes: [{ id: 'a', kind: 'entry', label: 'A' }, { id: 'b', kind: 'main', label: 'B' }],
  edges: [{ source_step_key: 'a', target_step_key: 'b' }],
}
const FENCE = '`'.repeat(3)

test('fenced and string JSON bodies parse with compatibility notes', () => {
  const fenced = normalizeFlow(`${FENCE}json\n${JSON.stringify(base)}\n${FENCE}`)
  assert.deepEqual(fenced.nodes.map(n => n.id), ['a', 'b'])
  assert.equal(fenced.structure_errors.length, 0)
  assert.ok(fenced.normalize_notes.some(note => note.startsWith(COMPAT_PREFIX) && note.includes('代码块')))
  const plain = normalizeFlow(JSON.stringify(base))
  assert.equal(plain.edges.length, 1)
  assert.ok(plain.normalize_notes.includes(`${COMPAT_PREFIX}body 是字符串，已按 JSON 解析`))
})

test('flows wrapper splits into flows and keeps role and attach_to', () => {
  const flows = normalizeFlows(JSON.stringify({ flows: [base, { ...base, flow_id: 'G', role: 'sub', attach_to: { flow_id: 'F', node_id: 'b' } }] }))
  assert.deepEqual(flows.map(f => [f.flow_id, f.role]), [['F', 'main'], ['G', 'sub']])
  assert.equal(flows[0].attach_to, null)
  assert.deepEqual(flows[1].attach_to, { flow_id: 'F', node_id: 'b' })
  assert.ok(flows[0].normalize_notes.includes(`${COMPAT_PREFIX}flows 外壳已拆分为 2 个流程`))
})

test('flow wrapper with steps becomes nodes with inferred edges', () => {
  const flow = normalizeFlow(JSON.stringify({ flow: { flow_id: 'H', steps: [{ id: 's1', label: 'x' }, { id: 's2', label: 'y' }] } }))
  assert.deepEqual(flow.nodes.map(n => [n.id, n.kind]), [['s1', 'entry'], ['s2', 'exit']])
  assert.deepEqual(flow.edges.map(e => [e.source_step_key, e.target_step_key]), [['s1', 's2']])
  assert.equal(flow.role, 'sub')
  assert.ok(flow.normalize_notes.includes(`${COMPAT_PREFIX}flow 外壳已拆开`))
  assert.ok(flow.normalize_notes.includes(`${COMPAT_PREFIX}由步骤顺序推断连线`))
})

test('Chinese keys map to canonical fields', () => {
  const flow = normalizeFlow(JSON.stringify({ flow_id: 'Z', 标题: '中', 节点: [{ id: 'a', 类型: 'entry', 名称: 'A' }], 连线: [] }))
  assert.equal(flow.title, '中')
  assert.deepEqual(flow.nodes.map(n => [n.id, n.kind, n.label]), [['a', 'entry', 'A']])
  assert.ok(flow.normalize_notes.includes(`${COMPAT_PREFIX}流程字段 节点 视为 nodes`))
})

test('duplicate node ids drop the graph and report positions', () => {
  const flow = normalizeFlow(JSON.stringify({ flow_id: 'D', nodes: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }], edges: [] }))
  assert.deepEqual(flow.nodes, [])
  assert.deepEqual(flow.structure_errors, ["节点 id 'a' 重复（nodes[0], nodes[1]）"])
})

test('dangling edges are dropped and list available ids', () => {
  const flow = normalizeFlow(JSON.stringify({ flow_id: 'E', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ source_step_key: 'a', target_step_key: 'q' }] }))
  assert.deepEqual(flow.nodes.map(n => n.id), ['a', 'b'])
  assert.deepEqual(flow.edges, [])
  assert.deepEqual(flow.structure_errors, ["edges[0].target_step_key='q' 不是节点 id；可用 id：a, b"])
})

test('invalid or non-object bodies keep the raw text', () => {
  const broken = normalizeFlow('not json')
  assert.equal(broken.raw_text, 'not json')
  assert.equal(broken.role, 'sub')
  assert.deepEqual(broken.nodes, [])
  assert.match(broken.structure_errors[0], /^body 不是有效 JSON：/)
  assert.match(normalizeFlow('[1,2]').structure_errors[0], /^body 必须是 JSON 对象/)
  assert.deepEqual(normalizeFlow(JSON.stringify({ flow_id: 'X', nodes: [] })).structure_errors, ['nodes 缺失或为空'])
})

test('objects without a drawable graph preserve their original body for the unparsed group', () => {
  for (const body of [
    { flow_id: 'missing', title: 'Unparsed', nodes: [] },
    { flow_id: 'invalid', nodes: [{ label: 'No id' }] },
    { flow_id: 'duplicate', nodes: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] },
  ]) {
    const before = structuredClone(body)
    const flow = normalizeFlow(body)
    assert.deepEqual(flow.nodes, [])
    assert.deepEqual(JSON.parse(flow.raw_text), before)
    assert.deepEqual(body, before)
  }
  const textFlow = normalizeFlow({ format_version: 'module-flow-text-v1', text: 'Legacy flow text' })
  assert.equal(textFlow.text, 'Legacy flow text')
  assert.equal(textFlow.raw_text, undefined)
})
