import assert from 'node:assert/strict'
import test from 'node:test'
import { layoutFlow, layoutCallGraph } from '../src/flow-graph/layout.js'

const edge = (source, target) => ({ source_step_key: source, target_step_key: target })

test('nodes layer by depth with branch left, error right and back edges for cycles', () => {
  const layout = layoutFlow({
    nodes: [{ id: 'a', kind: 'entry', label: 'A' }, { id: 'b', kind: 'main', label: 'B' }, { id: 'c', kind: 'branch', label: 'C' }, { id: 'd', kind: 'error', label: 'D' }],
    edges: [edge('a', 'b'), edge('b', 'c'), edge('b', 'd'), edge('c', 'a')],
  })
  const byId = Object.fromEntries(layout.nodes.map(n => [n.id, n]))
  assert.deepEqual(['a', 'b', 'c', 'd'].map(id => byId[id].depth), [0, 1, 2, 2])
  assert.equal(byId.c.column, 'left')
  assert.equal(byId.d.column, 'right')
  assert.equal(byId.a.on_main, true)
  assert.ok(byId.a.y < byId.b.y && byId.b.y < byId.c.y)
  assert.ok(byId.c.x < byId.d.x)
  assert.equal(layout.edges.filter(e => e.back).length, 1)
  assert.deepEqual(layout.warnings, [])
  assert.ok(layout.width > 0 && layout.height > 0)
})

test('empty, duplicate and dangling inputs produce warnings instead of throwing', () => {
  assert.deepEqual(layoutFlow({ nodes: [], edges: [] }).warnings, ['当前流程没有可绘制节点。'])
  const layout = layoutFlow({ nodes: [{ id: 'a', kind: 'entry', label: 'A' }, { id: 'a', kind: 'main', label: 'B' }], edges: [edge('a', 'zz')] })
  assert.equal(layout.nodes.length, 1)
  assert.deepEqual(layout.warnings, ['流程节点 a 重复，图中只显示第一次声明。', '流程连线 a → zz 引用了不存在的节点，未绘制。'])
})

test('large flows fold nodes beyond the first branch layer unless expanded', () => {
  const flow = {
    nodes: [{ id: 'a', kind: 'entry', label: 'A' }, { id: 'b', kind: 'main', label: 'B' }, { id: 'c', kind: 'exit', label: 'C' },
      { id: 'x', kind: 'branch', label: 'X' }, { id: 'y', kind: 'branch', label: 'Y' }, { id: 'z', kind: 'branch', label: 'Z' }],
    edges: [edge('a', 'b'), edge('b', 'c'), edge('b', 'x'), edge('x', 'y'), edge('y', 'z')],
  }
  const folded = layoutFlow(flow, { collapseThreshold: 3 })
  assert.deepEqual(folded.collapsed, { count: 2, ids: ['y', 'z'] })
  assert.deepEqual(folded.nodes.map(n => n.id).sort(), ['a', 'b', 'c', 'x'])
  const expanded = layoutFlow(flow, { collapseThreshold: 3, expandAll: true })
  assert.equal(expanded.collapsed.count, 0)
  assert.equal(expanded.nodes.length, 6)
})

test('call graph merges repeated calls and marks unreached functions', () => {
  const layout = layoutCallGraph({ root: 'a', functions: [{ id: 'a', kind: 'function', label: 'a' }, { id: 'b', kind: 'function', label: 'b' }, { id: 'x', kind: 'function', label: 'x' }],
    calls: [{ from: 'a', to: 'b', args: [], returns: '' }, { from: 'a', to: 'b', args: [], returns: '' }], variables: [] })
  assert.deepEqual(layout.edges.map(e => [e.from, e.to, e.count]), [['a', 'b', 2]])
  assert.deepEqual(layout.nodes.map(n => [n.id, n.unreached]), [['a', false], ['b', false], ['x', true]])
  assert.deepEqual(layoutCallGraph({ functions: [], calls: [] }).warnings, ['当前调用图没有可绘制函数。'])
})
