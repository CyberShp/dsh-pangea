import assert from 'node:assert/strict'
import test from 'node:test'
import { createExecutionTimelineView } from '../src/execution-timeline-view.js'
import { createResultDrawer } from '../src/result-drawers.js'

const react = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }), Fragment: 'fragment', useState: value => [value, () => {}], useEffect() {}, useRef: value => ({ current: value }) }
const walk = node => Array.isArray(node) ? node.flatMap(walk) : node?.children ? [node, ...node.children.flatMap(walk)] : []
const text = node => Array.isArray(node) ? node.map(text).join('') : node?.children ? text(node.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''
const timeline = { start_at_ms: 1000, end_at_ms: 6000, observed_at_ms: 6000, projected_at_ms: 6000, is_live: false, lanes: [
  { session_id: 'session', title: '分析', history_status: 'recorded', segments: [
    { execution_id: 'one', action_id: 'a', start_at_ms: 1000, end_at_ms: 2000, status: 'finished' },
    { execution_id: 'two', action_id: 'a', start_at_ms: 4000, end_at_ms: 5000, status: 'paused' },
    { execution_id: 'old', action_id: 'b', start_at_ms: 5500, end_at_ms: null, status: 'unknown' },
  ], events: [{ seq: 1, execution_id: 'one', action_id: 'a', kind: 'turn_end', label: '回合返回（非进程停止）', at_ms: 1900 }] },
] }

test('timeline draws separate known execution windows and preserves unknown boundaries', () => {
  const View = createExecutionTimelineView(react), selected = []
  const nodes = walk(View({ timeline, onSession: value => selected.push(value) }))
  const bars = nodes.filter(node => node.props.className?.startsWith('pangea-timeline-segment'))
  assert.equal(bars.length, 2)
  assert.deepEqual(bars.map(node => node.props.style), [{ left: '0%', width: '20%' }, { left: '60%', width: '20%' }])
  assert.equal(nodes.some(node => node.props.className === 'pangea-timeline-now'), false)
  assert.match(text(nodes), /结束未知/)
  bars[1].props.onClick()
  assert.deepEqual(selected, [{ initialSessionId: 'session', initialActionId: 'a', initialExecutionId: 'two' }])
  assert.ok(nodes.some(node => node.props['aria-label']?.includes('回合返回（非进程停止）')))
})

test('stale running view stops at the last observed boundary without a live current line', () => {
  const running = { ...timeline, is_live: true, lanes: [{ session_id: 's', segments: [{ execution_id: 'x', start_at_ms: 1000, end_at_ms: null, status: 'running' }] }] }
  const nodes = walk(createExecutionTimelineView(react)({ timeline: running, stale: true }))
  const bar = nodes.find(node => node.props.className?.startsWith('pangea-timeline-segment'))
  assert.equal(bar.props.style.width, '100%')
  assert.match(text(bar), /最后观测执行中/)
  assert.equal(nodes.some(node => node.props.className === 'pangea-timeline-now'), false)
})

test('missing historical timestamps never create a current-time duration', () => {
  const nodes = walk(createExecutionTimelineView(react)({ timeline: { lanes: [{ session_id: null, segments: [{ execution_id: 'legacy', status: 'unknown' }] }] } }))
  assert.equal(nodes.some(node => node.props.className?.startsWith('pangea-timeline-segment')), false)
  assert.match(text(nodes), /起止未知/)
  const unknown = nodes.find(node => node.type === 'button' && text(node).includes('起止未知'))
  assert.equal(unknown.props.disabled, true)
})

test('obscured basis stays mounted and does not handle Escape behind source drawer', () => {
  let closes = 0
  const Drawer = createResultDrawer(react)
  const obscured = Drawer({ title: '拟覆盖依据', obscured: true, onClose: () => closes++, children: '原文' })
  assert.equal(obscured.props['aria-hidden'], 'true')
  assert.equal(obscured.props.inert, '')
  const body = walk(obscured).find(node => node.props.role === 'dialog')
  body.props.onKeyDown({ key: 'Escape' })
  assert.equal(closes, 0)
  assert.match(text(obscured), /原文/)
  const shown = walk(Drawer({ title: '拟覆盖依据', onClose: () => closes++ })).find(node => node.props.role === 'dialog')
  shown.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} })
  assert.equal(closes, 1)
})
