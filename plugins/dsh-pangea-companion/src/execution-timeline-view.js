// Host-recorded execution windows only. No model calls and no inferred history.
// At the minimum 600px track width, markers within 27px share one target.
// Exact recorded events remain independently reachable in the event list.
export function groupTimelineEvents(events, start, end) {
  const span = Math.max(end - start, 1000), groups = []
  for (const event of [...events].filter(event => Number.isFinite(event.at_ms)).sort((a, b) => a.at_ms - b.at_ms)) {
    const previous = groups.at(-1)
    if (previous && (event.at_ms - previous.at_ms) / span < 0.045) previous.events.push(event)
    else groups.push({ at_ms: event.at_ms, events: [event] })
  }
  return groups
}

export function createExecutionTimelineView(React) {
  const h = React.createElement
  const labels = { running: '执行中', finished: '执行结束', paused: '已暂停', unknown: '边界未知' }
  const time = value => Number.isFinite(value) ? new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) : '未知'
  const preciseTime = value => Number.isFinite(value) ? new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, fractionalSecondDigits: 3 }) : '未知'
  return function ExecutionTimelineView({ timeline, stale = false, onSession }) {
    const [now, setNow] = React.useState(Date.now())
    const [eventSelection, setEventSelection] = React.useState(null)
    React.useEffect(() => {
      if (!timeline?.is_live || stale) return undefined
      setNow(Date.now())
      const timer = setInterval(() => setNow(Date.now()), 1000)
      return () => clearInterval(timer)
    }, [timeline?.is_live, timeline?.projected_at_ms, stale])
    const lanes = timeline?.lanes ?? []
    const live = timeline?.is_live === true && !stale
    const observed = timeline?.observed_at_ms ?? timeline?.projected_at_ms
    const end = live ? Math.max(now, timeline?.end_at_ms || now) : timeline?.end_at_ms
    const start = timeline?.start_at_ms
    const hasRange = Number.isFinite(start) && Number.isFinite(end)
    const span = hasRange ? Math.max(end - start, 1000) : 1000
    const left = value => `${Math.max(0, Math.min(100, (value - start) / span * 100))}%`
    const open = (lane, segment) => { if (lane.session_id && onSession) onSession({ initialSessionId: lane.session_id, initialActionId: segment?.action_id, initialExecutionId: segment?.execution_id }) }
    const selectedLane = eventSelection && lanes.find((lane, index) => (lane.session_id || `unbound-${index}`) === eventSelection.lane)
    const selectedEvents = selectedLane ? (selectedLane.events ?? []).filter(event => Number.isFinite(event.at_ms) && (!eventSelection.events || eventSelection.events.some(key => key === `${event.seq}:${event.at_ms}:${event.kind}`))) : []
    const eventKey = event => `${event.seq}:${event.at_ms}:${event.kind}`
    return h('section', { className: 'pangea-execution-timeline', 'aria-label': '执行与 Agent 会话时间轴' },
      h('div', { className: 'pangea-timeline-heading' }, h('h3', null, '执行与 Agent 会话时间轴'), h('span', null, live ? '实时 · 当前时间线' : stale ? '读取中断 · 保留最后观测' : '历史记录')),
      h('p', { className: 'small muted' }, '横条表示已记录的执行区间，空白表示没有已知执行区间。相邻事件合并显示，可展开查看。'),
      !lanes.length ? h('p', { role: 'status', className: 'small muted' }, '尚无可读取的时间轴记录；仍可使用 Agent 会话管理查看已有内容。') : h('div', { className: 'pangea-timeline-scroll', tabIndex: 0, role: 'region', 'aria-label': '执行泳道横向浏览' },
        h('div', { className: 'pangea-timeline-grid' },
          h('div', { className: 'pangea-timeline-axis' }, h('span', null, '原 Agent / 执行'), h('div', null, hasRange ? [0, 0.25, 0.5, 0.75, 1].map(fraction => h('time', { key: fraction, style: { left: `${fraction * 100}%` } }, time(start + span * fraction))) : '时间边界未记录')),
          lanes.map((lane, index) => h('div', { key: lane.session_id || index, className: 'pangea-timeline-row' },
            h('div', { className: 'pangea-timeline-label' }, h('button', { type: 'button', disabled: !lane.session_id, onClick: () => open(lane) }, lane.title || 'Agent'),
              h('small', { title: lane.agent_session_id || lane.session_id || '会话身份未知', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, lane.agent_session_id || lane.session_id || '会话身份未知'),
              lane.history_status !== 'recorded' ? h('small', null, '历史不完整') : null,
              (lane.events ?? []).length ? h('button', { type: 'button', className: 'pangea-timeline-event-list-toggle', style: { display: 'block', marginTop: 7, fontSize: 11 }, 'aria-expanded': selectedLane === lane,
                onClick: () => setEventSelection(value => value?.lane === (lane.session_id || `unbound-${index}`) && !value.events ? null : { lane: lane.session_id || `unbound-${index}` }) }, `${lane.events.length} 条事件`) : null),
            h('div', { className: 'pangea-timeline-track' },
              hasRange ? h(React.Fragment, null,
                (lane.segments ?? []).filter(segment => Number.isFinite(segment.start_at_ms) && (Number.isFinite(segment.end_at_ms) || segment.status === 'running')).map(segment => {
                  const finish = Number.isFinite(segment.end_at_ms) ? segment.end_at_ms : live ? end : observed
                  if (!Number.isFinite(finish) || finish < segment.start_at_ms) return null
                  const label = stale && segment.status === 'running' ? '最后观测执行中' : labels[segment.status] || '边界未知'
                  return h('button', { key: segment.execution_id, type: 'button', className: `pangea-timeline-segment ${segment.status}`, disabled: !lane.session_id, style: { left: left(segment.start_at_ms), width: `${Math.max(0.3, (finish - segment.start_at_ms) / span * 100)}%` }, title: `${segment.action_id || '任务未记录'} · ${label}\n${time(segment.start_at_ms)} – ${Number.isFinite(segment.end_at_ms) ? time(segment.end_at_ms) : live ? '现在' : '最后观测'}\n点击查看原会话`, 'aria-label': `${segment.action_id || segment.execution_id} ${label}，查看原会话`, onClick: () => open(lane, segment) }, label)
                }),
                groupTimelineEvents(lane.events ?? [], start, end).map((group, eventIndex) => {
                  const event = group.events[0], grouped = group.events.length > 1
                  return h('button', { key: `${event.seq}:${eventIndex}`, type: 'button', className: `pangea-timeline-event ${grouped ? 'cluster' : event.kind}`, disabled: !grouped && !lane.session_id,
                    style: { left: left(group.at_ms), minWidth: grouped ? 24 : undefined, fontSize: grouped ? 11 : undefined, fontWeight: grouped ? 650 : undefined },
                    title: grouped ? `${group.events.length} 条相邻事件，展开查看` : `${event.label} · ${time(event.at_ms)}`,
                    'aria-label': grouped ? `${time(group.at_ms)} 起的 ${group.events.length} 条相邻事件，展开查看` : `${event.label} ${time(event.at_ms)}，查看原会话`,
                    onClick: () => grouped ? setEventSelection({ lane: lane.session_id || `unbound-${index}`, events: group.events.map(eventKey) }) : open(lane, event) }, grouped ? group.events.length : '◆')
                }),
                live ? h('span', { className: 'pangea-timeline-now', style: { left: left(end) }, 'aria-label': '现在' }) : null) : null,
              h('div', { className: 'pangea-timeline-unknown' }, (lane.segments ?? []).filter(segment => !Number.isFinite(segment.start_at_ms) || (!Number.isFinite(segment.end_at_ms) && segment.status !== 'running')).map(segment => h('button', { key: segment.execution_id, type: 'button', disabled: !lane.session_id, onClick: () => open(lane, segment) }, `${segment.action_id || segment.execution_id} · ${Number.isFinite(segment.start_at_ms) ? '结束未知' : Number.isFinite(segment.end_at_ms) ? '开始未知' : '起止未知'}`)))))))),
      selectedLane ? h('section', { className: 'pangea-timeline-event-list', 'aria-label': '执行事件明细', style: { border: '1px solid var(--pangea-border, #dce3dc)', borderRadius: 8, padding: 12, margin: '10px 0' } },
        h('div', { className: 'pangea-timeline-heading' }, h('strong', null, `${selectedLane.title || 'Agent'} · ${selectedEvents.length} 条事件`), h('button', { type: 'button', onClick: () => setEventSelection(null), 'aria-label': '收起执行事件明细' }, '收起')),
        h('p', { className: 'small muted' }, '回合返回与进程退出是独立记录。选择事件查看对应执行的原始会话。'),
        h('div', { style: { maxHeight: 260, overflow: 'auto' } }, selectedEvents.map((event, index) => h('button', { key: `${eventKey(event)}:${index}`, type: 'button', disabled: !selectedLane.session_id, onClick: () => open(selectedLane, event),
          style: { display: 'grid', gridTemplateColumns: '104px minmax(0,1fr)', gap: 12, width: '100%', textAlign: 'left', padding: '9px 6px', border: 0, borderTop: index ? '1px solid var(--pangea-border, #e8ede6)' : 0, background: 'transparent', color: 'inherit', cursor: 'pointer' } },
          h('time', { style: { fontVariantNumeric: 'tabular-nums' } }, preciseTime(event.at_ms)), h('span', null, h('strong', { style: { display: 'block', fontWeight: 550 } }, event.label), h('small', { className: 'muted', style: { overflowWrap: 'anywhere' } }, event.action_id || event.execution_id || '任务未记录')))))) : null,
      (timeline?.notices ?? []).length ? h('details', { className: 'small muted' }, h('summary', null, '记录范围与限制'), h('ul', null, timeline.notices.map((notice, index) => h('li', { key: index }, notice)))) : null)
  }
}
