import assert from 'node:assert/strict'
import test from 'node:test'
import { layoutFlow, pathsForNode, pathMembers } from '../src/flow-graph/layout.js'
import { renderFlowTree, toSvgString } from '../src/flow-graph/render.js'

const edge = (source, target, condition = '', edge_id) => ({ source_step_key: source, target_step_key: target, condition, ...(edge_id ? { edge_id } : {}) })
const node = (id, kind = 'main') => ({ id, kind, semantic_key: `business.${id}`, label: `业务操作 ${id}` })
const path = (path_id, node_ids, edge_ids) => ({ path_id, node_ids, ...(edge_ids ? { edge_ids } : {}) })
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
const flatten = tree => tree && typeof tree === 'object' ? [tree, ...(tree.children ?? []).flatMap(flatten)] : []
const geometry = layout => ({ ...layout, edges: layout.edges.map(({ index, ...edge }) => edge) })

function stableFixture() {
  return { layout_version: 'stable-v1', main_path_ids: ['connect', 'query'],
    nodes: [node('start', 'entry'), node('choose'), node('ready', 'exit'), node('deny', 'error'), node('query', 'entry'), node('result', 'exit')],
    edges: [edge('start', 'choose', '', 'prepare'), edge('choose', 'ready', '支持模式 A', 'a'), edge('choose', 'ready', '支持模式 B', 'b'),
      edge('choose', 'deny', '双方能力无交集', 'reject'), edge('deny', 'start', '修改配置后重新连接', 'retry'), edge('query', 'result', '查询完成', 'read')],
    paths: [path('connect', ['start', 'choose', 'ready'], ['prepare', 'a']), path('alternate', ['start', 'choose', 'ready'], ['prepare', 'b']),
      path('reject', ['start', 'choose', 'deny', 'start'], ['prepare', 'reject', 'retry']), path('query', ['query', 'result'], ['read'])] }
}

test('stable-v1 geometry and SVG survive permutations of nodes, edges, paths and main IDs', () => {
  const flow = stableFixture()
  const baseline = layoutFlow(flow)
  for (let offset = 0; offset < flow.nodes.length; offset += 1) {
    const shuffle = array => [...array.slice(offset % array.length), ...array.slice(0, offset % array.length)].reverse()
    const other = { ...flow, nodes: shuffle(flow.nodes), edges: shuffle(flow.edges), paths: shuffle(flow.paths), main_path_ids: shuffle(flow.main_path_ids) }
    assert.deepEqual(geometry(layoutFlow(other)), geometry(baseline))
    assert.equal(toSvgString(renderFlowTree(layoutFlow(other))), toSvgString(renderFlowTree(baseline)))
  }
  assert.deepEqual(baseline.warnings, [])
  assert.equal(baseline.layout_version, 'stable-v1')
  assert.ok(baseline.nodes.find(n => n.id === 'query').on_main)
  assert.ok(baseline.nodes.find(n => n.id === 'start').on_main)
  assert.equal(baseline.edges.find(e => e.edge_id === 'a').on_main, true)
  assert.equal(baseline.edges.find(e => e.edge_id === 'b').on_main, false)
})

test('stable-v1 without declared main paths stays neutral; legacy main selection remains compatible', () => {
  const flow = { layout_version: 'stable-v1', nodes: [node('a', 'entry'), node('b', 'exit')], edges: [edge('a', 'b')], paths: [path('normal', ['a', 'b'])] }
  assert.deepEqual(layoutFlow(flow).main_path, [])
  assert.ok(layoutFlow(flow).nodes.every(n => n.on_main === false))
  assert.equal(layoutFlow(flow, { collapseThreshold: 1 }).nodes.length, 2)
  const { layout_version, ...legacy } = flow
  assert.deepEqual(layoutFlow(legacy).main_path, ['a', 'b'])
  const missing = layoutFlow({ ...flow, main_path_ids: ['missing'] })
  assert.deepEqual(missing.main_path, [])
  assert.match(missing.warnings.join('\n'), /主路径 missing 不存在/)
})

test('path highlight selects exactly one parallel condition and node helpers only return declared paths', () => {
  const flow = stableFixture()
  const members = pathMembers(flow, 'alternate')
  assert.deepEqual([...members.edge_ids], ['prepare', 'b'])
  assert.deepEqual(pathsForNode(flow, 'ready').map(p => p.path_id), ['alternate', 'connect'])
  assert.deepEqual(pathsForNode(flow, 'absent'), [])
  assert.equal(pathMembers(flow, 'absent'), null)
  const tree = renderFlowTree(layoutFlow(flow), { highlight: members })
  const groups = flatten(tree).filter(item => item.attrs?.['data-edge-id'])
  assert.deepEqual(groups.filter(item => item.attrs['data-highlighted'] === 'true').map(item => item.attrs['data-edge-id']).sort(), ['b', 'prepare'])
  const parallel = layoutFlow(flow).edges.filter(e => ['a', 'b'].includes(e.edge_id))
  assert.notEqual(parallel[0].path, parallel[1].path)
})

test('legacy ambiguous parallel edges are diagnosed and never all highlighted', () => {
  const flow = { nodes: [node('a', 'entry'), node('b', 'exit')], edges: [edge('a', 'b', 'A'), edge('a', 'b', 'B')], paths: [path('old', ['a', 'b'])] }
  const members = pathMembers(flow, 'old')
  assert.equal(members.edge_ids.size, 0)
  assert.deepEqual(members.ambiguous_pairs, ['a\u0000b'])
  assert.match(members.warnings.join('\n'), /缺少 edge_ids/)
  assert.equal(layoutFlow(flow).warnings.length, 1)
  for (const highlight of [members, { nodes: new Set(['a', 'b']), pairs: new Set(['a\u0000b']) }]) {
    const groups = flatten(renderFlowTree(layoutFlow(flow), { highlight })).filter(item => item.attrs?.['data-edge-id'])
    assert.ok(groups.every(item => item.attrs['data-highlighted'] === 'false'))
  }
  const first = layoutFlow({ ...flow, layout_version: 'stable-v1' })
  const reordered = layoutFlow({ ...flow, layout_version: 'stable-v1', edges: [...flow.edges].reverse(), nodes: [...flow.nodes].reverse() })
  assert.deepEqual(geometry(first), geometry(reordered))
})

test('declared edge IDs must follow the path node sequence; mismatches never invent route links', () => {
  const flow = stableFixture()
  flow.paths.push(path('broken', ['start', 'choose', 'ready'], ['read', 'reject']))
  const members = pathMembers(flow, 'broken')
  assert.equal(members.edge_ids.size, 0)
  assert.equal(members.warnings.length, 2)
  assert.match(members.warnings[0], /第 1 条连线/)
  assert.match(members.warnings[0], /edge_ids\[0\] 应连接 start → choose，实际为 read（query → result）/)
})

test('length mismatches preserve verified segments and diagnose missing and extra positions without repairing records', () => {
  const flow = stableFixture()
  flow.paths.push(path('short', ['start', 'choose', 'deny', 'start'], ['prepare', 'reject']))
  flow.paths.push(path('long', ['start', 'choose'], ['prepare', 'reject', 'retry']))
  const before = structuredClone(flow)
  const short = pathMembers(flow, 'short')
  assert.deepEqual([...short.edge_ids], ['prepare', 'reject'])
  assert.match(short.warnings.join('\n'), /edge_ids\[2\] 应连接 deny → start，实际为 未提供/)
  assert.deepEqual([...pathMembers(flow, 'long').edge_ids], ['prepare'])
  assert.match(pathMembers(flow, 'long').warnings.join('\n'), /edge_ids\[1\] 起的 2 条连线没有对应节点步/)
  assert.deepEqual(flow, before)
})

test('loop occurrences retain their positions and duplicate path IDs do not select an arbitrary route', () => {
  const flow = stableFixture()
  flow.paths.push(path('retry-twice', ['start', 'choose', 'deny', 'start', 'choose', 'deny', 'start'],
    ['prepare', 'reject', 'retry', 'prepare', 'reject', 'retry']))
  const members = pathMembers(flow, 'retry-twice')
  assert.deepEqual(members.warnings, [])
  assert.deepEqual([...members.edge_ids], ['prepare', 'reject', 'retry'])
  flow.paths.push(path('reject', ['query', 'result'], ['read']))
  assert.equal(pathMembers(flow, 'reject').edge_ids.size, 0)
  assert.match(pathMembers(flow, 'reject').warnings[0], /路径 ID reject 重复/)
})

test('selected declared paths and explicitly kept nodes expand through a collapsed branch', () => {
  const flow = { layout_version: 'stable-v1', main_path_ids: ['main'],
    nodes: [node('a', 'entry'), node('b'), node('c', 'exit'), node('x', 'branch'), node('y'), node('z', 'exit')],
    edges: [edge('a', 'b'), edge('b', 'c'), edge('b', 'x'), edge('x', 'y'), edge('y', 'z')],
    paths: [path('main', ['a', 'b', 'c']), path('side', ['a', 'b', 'x', 'y', 'z'])] }
  assert.deepEqual(layoutFlow(flow, { collapseThreshold: 3 }).collapsed.ids, ['y'])
  const selected = layoutFlow(flow, { collapseThreshold: 3, activePathId: 'side' })
  assert.equal(selected.collapsed.count, 0)
  for (const id of pathMembers(flow, 'side').edge_ids) assert.ok(selected.edges.some(e => e.edge_id === id))
  assert.ok(layoutFlow(flow, { collapseThreshold: 3, keepNodeIds: ['z'] }).nodes.some(n => n.id === 'z'))
})

test('large-flow folding keeps declared decisions, exceptions, propagation, recovery and exits visible', () => {
  const flow = { layout_version: 'stable-v1', main_path_ids: ['main'],
    nodes: [node('a', 'entry'), node('done', 'exit'), node('side'), node('decision', 'branch'), node('failed', 'error'),
      node('notify', 'propagation'), node('cleanup', 'recovery'), node('closed', 'exit')],
    edges: [edge('a', 'done'), edge('a', 'side'), edge('side', 'decision'), edge('decision', 'failed'), edge('failed', 'notify'),
      edge('notify', 'cleanup'), edge('cleanup', 'closed')], paths: [path('main', ['a', 'done'])] }
  const layout = layoutFlow(flow, { collapseThreshold: 2 })
  for (const id of ['decision', 'failed', 'notify', 'cleanup', 'closed']) assert.ok(layout.nodes.some(item => item.id === id))
})

test('dense return/crossing labels preserve full text, reserve lanes and stay clear of nodes and labels', () => {
  const long = '认证算法不匹配时重新配置并恢复连接，验证完整条件不会在静态导出中被省略：SHA512_LONG_UNBROKEN_ALGORITHM_NAME'
  const flow = { layout_version: 'stable-v1', main_path_ids: ['main'],
    nodes: [node('a', 'entry'), node('b'), node('c'), node('d', 'exit'), node('e', 'error')],
    edges: [edge('a', 'b', '准备完成'), edge('b', 'c', '双方算法一致'), edge('c', 'd', '认证成功'), edge('b', 'e', '协商失败'),
      edge('e', 'a', long), edge('c', 'a', '发生超时后重新建立连接'), edge('d', 'b', '用户修改配置并再次执行操作'), edge('c', 'c', '重复请求'),
      edge('a', 'd', '已存在有效会话时复用')], paths: [path('main', ['a', 'b', 'c', 'd'])] }
  const layout = layoutFlow(flow)
  const labels = layout.edges.filter(e => e.condition)
  for (const item of labels) {
    assert.equal(item.label_lines.join(''), item.condition)
    assert.ok(item.label_box.x >= 0 && item.label_box.y >= 0)
    assert.ok(item.label_box.x + item.label_box.w <= layout.width)
    assert.ok(item.label_box.y + item.label_box.h <= layout.height)
    assert.ok(layout.nodes.every(n => !overlap(item.label_box, n)), `label overlaps node: ${item.condition}`)
    assert.ok(labels.filter(other => other !== item).every(other => !overlap(item.label_box, other.label_box)), `label overlaps label: ${item.condition}`)
  }
  for (const item of layout.edges) {
    assert.ok(item.points.every(p => p.x >= 0 && p.y >= 0 && p.x <= layout.width && p.y <= layout.height))
  }
  const routed = layout.edges.filter(e => e.routed)
  for (let i = 1; i < routed.length; i += 1) {
    assert.ok(routed[i].lane_x - routed[i - 1].lane_x >= routed[i - 1].label_box.w + 24)
  }
  assert.ok(labels.some(e => e.label_leader))
  const svg = toSvgString(renderFlowTree(layout))
  assert.ok(svg.includes('SHA512_LONG_UNBROKEN_ALGORITHM'))
  assert.ok(!svg.includes('…'))
  assert.match(svg, /data-edge-label=/)
})

test('focused condition highlights only its exact edge and endpoints with a generous hit region', () => {
  const flow = stableFixture(), layout = layoutFlow(flow)
  const tree = renderFlowTree(layout, { focusedEdgeId: 'b' })
  const all = flatten(tree)
  const edgeGroups = all.filter(item => item.attrs?.['data-edge-id'])
  assert.equal(edgeGroups.length, layout.edges.length)
  assert.deepEqual(edgeGroups.filter(item => item.attrs['data-highlighted'] === 'true').map(item => item.attrs['data-edge-id']), ['b'])
  const nodes = all.filter(item => item.attrs?.['data-node-id'])
  assert.deepEqual(nodes.filter(item => item.attrs['data-highlighted'] === 'true').map(item => item.attrs['data-node-id']).sort(), ['choose', 'ready'])
  assert.equal(all.filter(item => item.attrs?.['data-edge-hit'] === 'true').length, layout.edges.length)
  assert.equal(all.filter(item => item.attrs?.['data-edge-label'] === 'b').length, 1)
  const svg = toSvgString(tree)
  assert.ok(!svg.includes('<script'))
  assert.ok(!svg.includes('undefined'))
})

test('duplicate declared edge IDs remain visible but cannot resolve an ambiguous path', () => {
  const flow = { layout_version: 'stable-v1', nodes: [node('a', 'entry'), node('b', 'exit')],
    edges: [edge('a', 'b', 'algorithm A', 'same'), edge('a', 'b', 'algorithm B', 'same')], paths: [path('bad', ['a', 'b'], ['same'])] }
  const layout = layoutFlow(flow)
  assert.equal(layout.edges.length, 2)
  assert.ok(layout.edges.every(e => e.edge_id !== 'same'))
  assert.equal(new Set(layout.edges.map(e => e.edge_id)).size, 2)
  assert.match(layout.warnings.join('\n'), /ID same 重复/)
  assert.equal(pathMembers(flow, 'bad').edge_ids.size, 0)
})

test('condition wrapping preserves normal algorithm tokens and source edge indexes stay available', () => {
  const flow = stableFixture()
  flow.edges[1].condition = '双方能力匹配：SHA256 + FFDHE2048'
  const layout = layoutFlow(flow)
  assert.ok(layout.edges.find(e => e.edge_id === 'a').label_lines.some(line => line.includes('FFDHE2048')))
  for (const item of layout.edges) assert.equal(flow.edges[item.index].edge_id, item.edge_id)
})

test('a shortcut cannot reorder declared main steps and recovery loops do not collapse them', () => {
  const flow = { layout_version: 'stable-v1', main_path_ids: ['connect', 'inspect'],
    nodes: [node('start', 'entry'), node('prepare'), node('authenticate'), node('ready', 'exit'), node('query', 'entry'), node('result', 'exit')],
    edges: [edge('start', 'prepare'), edge('prepare', 'authenticate'), edge('authenticate', 'ready'), edge('start', 'ready', 'reuse existing connection'),
      edge('authenticate', 'prepare', 'retry'), edge('query', 'result')],
    paths: [path('connect', ['start', 'prepare', 'authenticate', 'ready']), path('inspect', ['query', 'result'])] }
  const layout = layoutFlow(flow), byId = new Map(layout.nodes.map(n => [n.id, n]))
  assert.ok(byId.get('start').y < byId.get('prepare').y)
  assert.ok(byId.get('prepare').y < byId.get('authenticate').y)
  assert.ok(byId.get('authenticate').y < byId.get('ready').y)
  assert.equal(byId.get('query').depth, 0)
  assert.equal(byId.get('result').depth, 1)
  assert.equal(layout.edges.find(e => e.condition === 'reuse existing connection').back, false)
  assert.equal(layout.edges.find(e => e.condition === 'retry').back, true)
})
