import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSequence, layoutSequence, renderSequenceTree } from '../src/sequence-diagram.js'
import { toSvgString } from '../src/flow-graph/render.js'

function fixture() {
  return {
    format_version: 'sequence-v1', title: '连接建立与拒绝', status: 'ready',
    participants: [{ id: 'host', label: '主机' }, { id: 'target', label: '阵列连接处理器' }],
    messages: [
      { id: 'request', from: 'host', to: 'target', label: '发送建链请求', kind: 'call', source_evidence: ['repo:connect.c:12'] },
      { id: 'accept', from: 'target', to: 'host', label: '接受并返回连接状态', kind: 'return' },
      { id: 'cleanup', from: 'target', to: 'target', label: '拒绝时回收已经申请的连接资源', kind: 'self' },
      { id: 'reject', from: 'target', to: 'host', label: '返回拒绝原因', kind: 'return' },
      { id: 'notify', from: 'target', to: 'host', label: '异步通知状态变化', kind: 'async' },
    ],
    fragments: [{ id: 'outcome', kind: 'alt', label: '请求处理结果', operands: [
      { condition: '参数合法，允许建链', message_ids: ['accept'] },
      { condition: '参数非法，拒绝建链', message_ids: ['cleanup', 'reject'] },
    ] }], notes: ['静态源码交互关系，纵向间距不代表耗时。'],
  }
}
function objectTree(tree) {
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...(tree.children ?? []).flatMap(objectTree)]
}

test('coordinates are computed locally and source data is unchanged', () => {
  const input = fixture()
  input.messages[0].y = -999
  input.fragments[0].from = 500000
  const before = structuredClone(input)
  const result = normalizeSequence(input)
  assert.equal(result.status, 'ok')
  assert.equal(result.raw, input)
  assert.deepEqual(result.errors, [])
  const first = layoutSequence(result.graph)
  const second = layoutSequence(result.graph)
  assert.deepEqual(first, second)
  assert.deepEqual(input, before)
  assert.equal(first.messages[0].y > 0, true)
  assert.equal(first.fragments[0].y < first.height, true)
  assert.deepEqual(first.messages.map(row => row.id), input.messages.map(row => row.id))
})

test('alt operands retain declared causal order and self calls stay inside their operand', () => {
  const layout = layoutSequence(fixture())
  const fragment = layout.fragments[0]
  const [allowed, rejected] = fragment.operands
  assert.ok(allowed.y + allowed.height <= rejected.y)
  for (const operand of fragment.operands) for (const id of operand.message_ids) {
    const message = layout.messages.find(row => row.id === id)
    assert.ok(message.labelBox.y > operand.y)
    assert.ok(message.y + (message.self ? 28 : 0) < operand.y + operand.height)
    assert.ok(message.labelBox.x >= fragment.x)
    assert.ok(message.labelBox.x + message.labelBox.w <= fragment.x + fragment.w)
  }
  const tree = renderSequenceTree(layout)
  assert.equal(objectTree(tree).filter(row => row.attrs?.['data-operand']).length, 2)
  assert.match(toSvgString(tree), /stroke-dasharray="6 4"/)
  assert.match(toSvgString(tree), /data-arrow-kind="async"/)
})

test('loop, opt and par frames carry semantic guards without numeric coordinates', () => {
  for (const kind of ['loop', 'opt', 'par']) {
    const input = fixture()
    input.fragments = [{ id: kind, kind, label: `${kind} 范围`, operands: kind === 'par'
      ? [{ condition: '接收任务', message_ids: ['accept'] }, { condition: '清理任务', message_ids: ['cleanup', 'reject'] }]
      : [{ condition: '仅在条件成立时；收到退出事件结束', message_ids: ['accept', 'cleanup', 'reject'] }] }]
    const result = normalizeSequence(input)
    assert.equal(result.status, 'ok')
    const layout = layoutSequence(result.graph)
    assert.equal(layout.fragments[0].kind, kind)
    assert.equal(layout.fragments[0].h > 100, true)
    assert.deepEqual(layout.messages.map(row => row.id), input.messages.map(row => row.id))
  }
})

test('out-of-order and non-contiguous branches are not flattened into false execution traces', () => {
  for (const ids of [['reject', 'cleanup'], ['accept', 'reject']]) {
    const input = fixture()
    input.fragments = [{ id: 'bad', kind: 'loop', operands: [{ condition: '待核对范围', message_ids: ids }] }]
    const result = normalizeSequence(input)
    assert.equal(result.status, 'partial')
    assert.match(result.errors.join('\n'), /顺序不连续/)
    assert.equal(result.graph.fragments.length, 0)
    for (const id of ids) assert.equal(result.graph.messages.some(row => row.id === id), false)
    assert.deepEqual(result.raw, input)
    // Match visible text across SVG wrapping boundaries.
    assert.match(toSvgString(renderSequenceTree(layoutSequence(result.graph))).replace(/<[^>]+>/g, ''), /相关消息未绘制/)
  }
})

test('overlapping fragments and unknown references remain explicit partial data', () => {
  const input = fixture()
  input.fragments.push({ id: 'nested', kind: 'opt', operands: [{ condition: '清理', message_ids: ['cleanup'] }] })
  const overlap = normalizeSequence(input)
  assert.equal(overlap.status, 'partial')
  assert.equal(overlap.graph.fragments.length, 0)
  assert.deepEqual(overlap.graph.messages.map(row => row.id), ['request', 'notify'])
  assert.match(overlap.errors.join('\n'), /多个片段/)
  const missing = fixture()
  missing.fragments[0].operands[1].message_ids.push('not-an-authored-message')
  const result = normalizeSequence(missing)
  assert.match(result.errors.join('\n'), /未知或无法绘制/)
  assert.equal(result.graph.messages.some(row => row.id === 'not-an-authored-message'), false)
})

test('duplicate identities do not arbitrarily choose a participant or branch', () => {
  const input = fixture()
  input.participants.push({ id: 'target', label: '另一个同名身份' })
  const result = normalizeSequence(input)
  assert.equal(result.status, 'invalid')
  assert.equal(result.graph.participants.some(row => row.id === 'target'), false)
  assert.equal(result.graph.messages.length, 0)
  assert.equal(result.raw.participants.length, 3)
  const duplicated = fixture()
  duplicated.messages.push({ ...duplicated.messages[0] })
  const messages = normalizeSequence(duplicated)
  assert.equal(messages.graph.messages.some(row => row.id === 'request'), false)
  assert.match(messages.errors.join('\n'), /消息 id.*重复/)
})

test('invalid message in the middle cannot disappear and make a fragment look contiguous', () => {
  const input = fixture()
  input.messages.splice(2, 0, { id: 'unknown', from: 'missing', to: 'host', label: '缺失主体', kind: 'call' })
  const result = normalizeSequence(input)
  assert.equal(result.status, 'partial')
  assert.equal(result.graph.fragments.length, 0)
  assert.match(result.errors.join('\n'), /顺序不连续/)
})

test('long Unicode labels wrap without clipping or shrinking away information', () => {
  const input = fixture()
  input.title = '长标题'.repeat(60)
  input.participants[1].label = '存储连接生命周期管理器'.repeat(14)
  input.messages[2].label = '回收资源，通知等待者，并核对关闭状态🙂'.repeat(24)
  input.fragments[0].operands[1].condition = '条件成立且存在未完成请求'.repeat(30)
  const layout = layoutSequence(input)
  assert.equal(layout.titleLines.join(''), input.title)
  assert.equal(layout.participants[1].lines.join(''), input.participants[1].label)
  assert.equal(layout.messages[2].labelLines.join(''), input.messages[2].label)
  assert.equal(layout.height > layoutSequence(fixture()).height, true)
  for (const row of layout.messages) {
    assert.ok(row.labelBox.x >= 0)
    assert.ok(row.labelBox.x + row.labelBox.w <= layout.width)
    assert.ok(row.labelBox.y + row.labelBox.h < layout.height)
  }
  const many = fixture()
  many.participants.push(...Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, label: `参与者 ${i}` })))
  const expanded = layoutSequence(many)
  assert.ok(expanded.width > layout.width)
  assert.equal(expanded.participants.length, 10)
})

test('SVG escapes untrusted labels, identities and evidence and exposes keyboard selections', () => {
  const input = fixture()
  const payload = '<script>alert("x")</script> & <img onerror="bad">'
  input.title = payload
  input.participants[0].label = payload
  input.messages[0].label = payload
  input.messages[0].source_evidence = [payload]
  input.messages[0].id = 'request" onload="bad'
  const tree = renderSequenceTree(layoutSequence(input), { selectedMessage: input.messages[0].id, idPrefix: '"><script>' })
  const group = objectTree(tree).find(row => row.attrs?.['data-message-id'] === input.messages[0].id)
  assert.equal(group.attrs.tabindex, 0)
  assert.equal(group.attrs.role, 'button')
  assert.equal(group.attrs['data-selected'], 'true')
  const svg = toSvgString(tree)
  assert.doesNotMatch(svg, /<script|<img|<foreignObject|onload="bad"/)
  assert.match(svg, /&lt;script&gt;/)
  assert.match(svg, /&amp;/)
  assert.match(svg, /data-selected="true"/)
  assert.equal(objectTree(tree).filter(row => row.tag === 'title').some(row => row.children.join('').includes(payload)), true)
})

test('missing or explicitly unconfirmed facts never become a completed diagram', () => {
  assert.equal(normalizeSequence(null).status, 'unknown')
  const broken = normalizeSequence('broken json')
  assert.equal(broken.status, 'invalid')
  assert.match(toSvgString(renderSequenceTree(layoutSequence(broken.graph))), /不是可读取/)
  const empty = normalizeSequence({ format_version: 'sequence-v1', status: 'ready', participants: [], messages: [] })
  assert.equal(empty.status, 'unknown')
  const unknown = fixture(); unknown.status = 'unknown'
  assert.equal(normalizeSequence(unknown).status, 'unknown')
  assert.match(toSvgString(renderSequenceTree(layoutSequence(unknown))), /不代表已完成/)
  const na = normalizeSequence({ format_version: 'sequence-v1', status: 'not_applicable', notes: ['只有纯计算，没有可确认参与者交互。'] })
  assert.equal(na.status, 'not_applicable')
  assert.match(toSvgString(renderSequenceTree(layoutSequence(na.graph))), /不适合时序图/)
  const incorrect = fixture(); incorrect.messages[0].kind = 'self'
  assert.match(normalizeSequence(incorrect).errors.join('\n'), /self.*两端不同/)
})


test('five idless interactions retain explicit endpoints with display-only identities', () => {
  const input = fixture()
  input.fragments = []
  input.participants = input.participants.map(({ id, label }) => ({ id, name: label }))
  input.messages = input.messages.map(({ id, ...row }) => row)
  input.notes = 'Agent 给出的单条说明仍然可读。'
  const before = structuredClone(input)
  const result = normalizeSequence(input)
  assert.equal(result.status, 'partial')
  assert.equal(result.graph.messages.length, 5)
  assert.deepEqual(result.graph.messages.map(row => [row.from, row.to, row.label]), input.messages.map(row => [row.from, row.to, row.label]))
  assert.equal(new Set(result.graph.messages.map(row => row.id)).size, 5)
  assert.equal(result.graph.messages.every(row => row.view_generated_id), true)
  assert.deepEqual(result.graph.notes, [input.notes])
  assert.deepEqual(result.graph.participants.map(row => row.label), ['主机', '阵列连接处理器'])
  assert.match(result.errors.join('\n'), /临时标识/)
  assert.equal(layoutSequence(result.graph).messages.length, 5)
  assert.deepEqual(normalizeSequence(input).graph, result.graph)
  assert.deepEqual(input, before)
  assert.equal(result.raw, input)
})

test('explicit alternative field names remain a partial view without changing recorded facts', () => {
  const input = fixture()
  input.messages[0] = { id: 'request', source: 'host', target: 'target', text: '发送建链请求', type: 'call' }
  input.fragments = [{ type: 'alt', branches: [
    { guard: '参数合法，允许建链', messages: ['accept'] },
    { guard: '参数非法，拒绝建链', messages: ['cleanup', 'reject'] },
  ] }]
  const before = structuredClone(input)
  const result = normalizeSequence(input)
  assert.equal(result.status, 'partial')
  assert.equal(result.graph.fragments[0].kind, 'alt')
  assert.deepEqual(result.graph.fragments[0].operands.map(row => row.message_ids), [['accept'], ['cleanup', 'reject']])
  assert.equal(layoutSequence(result.graph).messages.length, 5)
  assert.match(result.errors.join('\n'), /读取 branches/)
  assert.deepEqual(input, before)
})

test('display identities cannot collide with authored ids or resolve fragment references', () => {
  const input = fixture()
  input.fragments = []
  delete input.messages[0].id
  input.messages[1].id = '__view_message_1'
  input.messages[2].id = '__view_message_1_1'
  const result = normalizeSequence(input)
  assert.equal(result.graph.messages[0].id, '__view_message_1_2')
  assert.equal(new Set(result.graph.messages.map(row => row.id)).size, 5)
  input.fragments = [{ id: 'guess', kind: 'opt', operands: [{ condition: '未有正式标识', message_ids: ['__view_message_1_2'] }] }]
  const unresolved = normalizeSequence(input)
  assert.equal(unresolved.graph.fragments.length, 0)
  assert.match(unresolved.errors.join('\n'), /未知或无法绘制的消息/)
  assert.equal(unresolved.graph.unsequenced_messages.length, 5)
})

test('conflicting aliases never override explicit participant, endpoint or fragment facts', () => {
  const input = fixture()
  input.participants[0].name = '与主机相冲突的名称'
  input.messages[0].source = 'target'
  input.fragments[0].type = 'loop'
  const before = structuredClone(input)
  const result = normalizeSequence(input)
  assert.equal(result.status, 'partial')
  assert.equal(result.graph.participants[0].label, 'host')
  assert.equal(result.graph.messages.some(row => row.id === 'request'), false)
  assert.equal(result.graph.fragments.length, 0)
  assert.match(result.errors.join('\n'), /participants\[0\].label.*冲突/)
  assert.match(result.errors.join('\n'), /messages\[0\].from.*冲突/)
  assert.match(result.errors.join('\n'), /fragments\[0\].kind.*冲突/)
  assert.deepEqual(input, before)
  const conflict = fixture()
  conflict.fragments[0].branches = [{ condition: '另一个范围', message_ids: ['request'] }]
  assert.equal(normalizeSequence(conflict).graph.fragments.length, 0)
  assert.match(normalizeSequence(conflict).errors.join('\n'), /operands.*branches.*冲突/)
})

test('malformed fragments retain all readable interaction facts without implying a trace', () => {
  const input = fixture()
  input.messages = input.messages.map(({ id, ...row }) => row)
  input.fragments = [{ description: '片段字段未按合同提供' }]
  const result = normalizeSequence(input)
  assert.equal(result.status, 'partial')
  assert.equal(result.graph.messages.length, 0)
  assert.equal(result.graph.unsequenced_messages.length, 5)
  const layout = layoutSequence(result.graph)
  assert.equal(layout.messages.length, 0)
  assert.equal(layout.unsequenced_messages.length, 5)
  const svg = toSvgString(renderSequenceTree(layout))
  assert.match(svg, /以下排列不表示执行顺序或同一路径/)
  for (const row of input.messages) assert.match(svg, new RegExp(row.label))
  assert.match(svg, /repo:connect.c:12/)
  assert.deepEqual(result.raw, input)
})

test('unknown branch membership does not hide sound fragments or flatten contradictory branches', () => {
  const input = fixture()
  input.fragments.push({ kind: 'unknown', description: '未提供消息归属' })
  const result = normalizeSequence(input)
  assert.equal(result.graph.fragments.length, 1)
  assert.deepEqual(result.graph.messages.map(row => row.id), ['accept', 'cleanup', 'reject'])
  assert.deepEqual(result.graph.unsequenced_messages.map(row => row.id), ['request', 'notify'])
  assert.deepEqual(layoutSequence(result.graph).messages.map(row => row.id), ['accept', 'cleanup', 'reject'])
  const crossing = fixture()
  crossing.fragments[0].operands[1].message_ids.reverse()
  const unresolved = normalizeSequence(crossing)
  assert.deepEqual(unresolved.graph.unsequenced_messages.map(row => row.id), ['accept', 'cleanup', 'reject'])
  assert.deepEqual(unresolved.graph.messages.map(row => row.id), ['request', 'notify'])
})

test('literal participant ids keep exact identity semantics in endpoint aliases', () => {
  const input = fixture()
  input.fragments = []
  input.participants[0].id = ' host '
  input.messages = [{ id: 'literal', source: ' host ', target: 'target', type: 'call', text: '按字面标识引用' }]
  const result = normalizeSequence(input)
  assert.equal(result.graph.messages[0].from, ' host ')
  assert.equal(result.graph.messages.length, 1)
  input.messages[0].from = 'host'
  const conflict = normalizeSequence(input)
  assert.equal(conflict.graph.messages.length, 0)
  assert.match(conflict.errors.join('\n'), /from.*source.*冲突/)
})


test('non-array fragment or operand containers preserve facts outside a fabricated sequence', () => {
  for (const fragments of [{}, 'alt', [{ id: 'bad', kind: 'alt', operands: { accept: ['accept'], reject: ['reject'] } }]]) {
    const input = fixture()
    input.fragments = fragments
    const result = normalizeSequence(input)
    assert.equal(result.status, 'partial')
    assert.equal(result.graph.messages.length, 0)
    assert.equal(result.graph.fragments.length, 0)
    assert.equal(result.graph.unsequenced_messages.length, 5)
    const svg = toSvgString(renderSequenceTree(layoutSequence(result.graph)))
    assert.match(svg, /已有交互事实/)
    assert.match(svg, /以下排列不表示执行顺序或同一路径/)
    assert.doesNotMatch(svg, /未提供可展示的交互消息/)
  }
})


test('partly resolved fragments cannot turn idless alternatives into unconditional messages', () => {
  const input = {
    format_version: 'sequence-v1', status: 'ready',
    participants: [{ id: 'a', label: '调用者' }, { id: 'b', label: '处理者' }],
    messages: [
      { id: 'yes', from: 'a', to: 'b', kind: 'call', label: 'yes branch' },
      { from: 'a', to: 'b', kind: 'call', label: 'no branch' },
    ],
    fragments: [{ id: 'choice', kind: 'alt', operands: [
      { condition: 'yes', message_ids: ['yes'] }, { condition: 'no', message_ids: ['no'] },
    ] }],
  }
  const before = structuredClone(input)
  const result = normalizeSequence(input)
  assert.equal(result.status, 'partial')
  assert.equal(result.graph.fragments.length, 0)
  assert.equal(result.graph.messages.length, 0)
  assert.deepEqual(result.graph.unsequenced_messages.map(row => row.label), ['yes branch', 'no branch'])
  assert.equal(layoutSequence(result.graph).messages.length, 0)
  assert.deepEqual(input, before)
})

test('partly known and empty operand membership quarantines only messages outside sound fragments', () => {
  for (const unresolvedIds of [['unknown'], [], ['request', 42]]) {
    const input = fixture()
    input.fragments.push({ id: 'uncertain', kind: 'alt', operands: [
      { condition: 'known', message_ids: ['request'] },
      { condition: 'unknown', message_ids: unresolvedIds },
    ] })
    const result = normalizeSequence(input)
    assert.equal(result.graph.fragments.length, 1)
    assert.deepEqual(result.graph.messages.map(row => row.id), ['accept', 'cleanup', 'reject'])
    assert.deepEqual(result.graph.unsequenced_messages.map(row => row.id), ['request', 'notify'])
  }
})
