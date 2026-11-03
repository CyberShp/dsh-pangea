// Host-recorded execution windows only. No model calls and no inferred history.
export function createExecutionTimelineView(React) {
  const h = React.createElement
  const labels = { running: '执行中', finished: '回合结束', paused: '已暂停', unknown: '边界未知' }
  const time = value => Number.isFinite(value) ? new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) : '未知'
  return function ExecutionTimelineView({ timeline, stale = false, onSession }) {
    const [now, setNow] = React.useState(Date.now())
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
    return h('section', { className: 'pangea-execution-timeline', 'aria-label': '执行与 Agent 会话时间轴' },
      h('div', { className: 'pangea-timeline-heading' }, h('h3', null, '执行与 Agent 会话时间轴'), h('span', null, live ? '实时 · 当前时间线' : stale ? '读取中断 · 保留最后观测' : '历史记录')),
      h('p', { className: 'small muted' }, '横条仅表示有明确起止的宿主执行窗口；回合结束不等于进程停止。空白与未知边界不补造。'),
      !lanes.length ? h('p', { role: 'status', className: 'small muted' }, '尚无可读取的时间轴记录；仍可使用 Agent 会话管理查看已有内容。') : h('div', { className: 'pangea-timeline-scroll', tabIndex: 0, role: 'region', 'aria-label': '执行泳道横向浏览' },
        h('div', { className: 'pangea-timeline-grid' },
          h('div', { className: 'pangea-timeline-axis' }, h('span', null, '原 Agent / 执行'), h('div', null, hasRange ? [0, 0.25, 0.5, 0.75, 1].map(fraction => h('time', { key: fraction, style: { left: `${fraction * 100}%` } }, time(start + span * fraction))) : '时间边界未记录')),
          lanes.map((lane, index) => h('div', { key: lane.session_id || index, className: 'pangea-timeline-row' },
            h('div', { className: 'pangea-timeline-label' }, h('button', { type: 'button', disabled: !lane.session_id, onClick: () => open(lane) }, lane.title || 'Agent'), h('small', null, lane.agent_session_id || lane.session_id || '会话身份未知'), lane.history_status !== 'recorded' ? h('small', null, '历史不完整') : null),
            h('div', { className: 'pangea-timeline-track' },
              hasRange ? h(React.Fragment, null,
                (lane.segments ?? []).filter(segment => Number.isFinite(segment.start_at_ms) && (Number.isFinite(segment.end_at_ms) || segment.status === 'running')).map(segment => {
                  const finish = Number.isFinite(segment.end_at_ms) ? segment.end_at_ms : live ? end : observed
                  if (!Number.isFinite(finish) || finish < segment.start_at_ms) return null
                  const label = stale && segment.status === 'running' ? '最后观测执行中' : labels[segment.status] || '边界未知'
                  return h('button', { key: segment.execution_id, type: 'button', className: `pangea-timeline-segment ${segment.status}`, disabled: !lane.session_id, style: { left: left(segment.start_at_ms), width: `${Math.max(0.3, (finish - segment.start_at_ms) / span * 100)}%` }, title: `${segment.action_id || '任务未记录'} · ${label}\n${time(segment.start_at_ms)} – ${Number.isFinite(segment.end_at_ms) ? time(segment.end_at_ms) : live ? '现在' : '最后观测'}\n点击查看原会话`, 'aria-label': `${segment.action_id || segment.execution_id} ${label}，查看原会话`, onClick: () => open(lane, segment) }, label)
                }),
                (lane.events ?? []).map((event, eventIndex) => h('button', { key: `${event.seq}:${eventIndex}`, type: 'button', className: `pangea-timeline-event ${event.kind}`, disabled: !lane.session_id, style: { left: left(event.at_ms) }, title: `${event.label} · ${time(event.at_ms)}`, 'aria-label': `${event.label} ${time(event.at_ms)}，查看原会话`, onClick: () => open(lane, event) }, '◆')),
                live ? h('span', { className: 'pangea-timeline-now', style: { left: left(end) }, 'aria-label': '现在' }) : null) : null,
              h('div', { className: 'pangea-timeline-unknown' }, (lane.segments ?? []).filter(segment => !Number.isFinite(segment.start_at_ms) || (!Number.isFinite(segment.end_at_ms) && segment.status !== 'running')).map(segment => h('button', { key: segment.execution_id, type: 'button', disabled: !lane.session_id, onClick: () => open(lane, segment) }, `${segment.action_id || segment.execution_id} · ${Number.isFinite(segment.start_at_ms) ? '结束未知' : Number.isFinite(segment.end_at_ms) ? '开始未知' : '起止未知'}`)))))))),
      (timeline?.notices ?? []).length ? h('details', { className: 'small muted' }, h('summary', null, '记录范围与限制'), h('ul', null, timeline.notices.map((notice, index) => h('li', { key: index }, notice)))) : null)
  }
}
