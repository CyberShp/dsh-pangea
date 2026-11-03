// A deterministic projection of recorded boundaries. Never infer process death,
// missing turns, or historical start times from prose or cumulative elapsed time.
const time = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
const eventTime = event => time(event.at_ms) ?? time(Date.parse(event.at))
const markerPriority = kind => ({ process_exit: 4, turn_end: 3, error: 2 })[kind] ?? 1
const labels = { prompt: '发送请求', turn_end: '回合返回（非进程停止）', process_exit: '进程退出', error: '执行器错误',
  session_bound: '绑定会话', execution_started: '开始执行', execution_finished: '执行结束', execution_paused: '暂停执行' }

export function buildExecutionTimeline({ progress = {}, sessions = [], histories = [], now = Date.now(), diagnostics = [] } = {}) {
  const notices = [...diagnostics], lanes = [], times = []
  const historyById = new Map(histories.map(history => [history.session_id, history]))
  const boundExecutions = new Set(), recordedOwners = new Map()
  for (const history of histories) for (const event of history.events ?? []) {
    if (event.replay === true || !event.execution_id) continue
    const owners = recordedOwners.get(event.execution_id) ?? new Set()
    owners.add(history.session_id); recordedOwners.set(event.execution_id, owners)
  }
  const addTime = value => { if (value !== null) times.push(value) }
  for (const session of sessions) {
    const history = historyById.get(session.session_id)
    const executions = new Map(), events = []
    const explicitBoundaries = new Set((history?.events ?? []).filter(event => event.replay !== true
      && event.type === 'host_event' && event.stage === 'source_first_execution')
      .map(event => JSON.stringify([event.execution_id, event.execution_event])))
    let omitted = 0
    const get = (id, event) => {
      if (!executions.has(id)) executions.set(id, { execution_id: id, action_id: event.action_id ?? null,
        stage: event.action_stage ?? session.stage ?? null, start_at_ms: null, end_at_ms: null,
        start_source: null, end_source: null, status: 'unknown', process_stopped: false })
      boundExecutions.add(id)
      return executions.get(id)
    }
    for (const event of history?.events ?? []) {
      if (event.replay === true) continue // Replay arrival is not original execution time.
      const at = eventTime(event)
      if (at === null) continue
      let kind = event.type
      if (kind === 'host_event') {
        // Legacy worker notifications can arrive after disposal. Prefer the
        // accepted execution boundary, never extend a pause through cleanup.
        const fallback = event.stage === 'source_first_worker_started' ? 'started'
          : event.stage === 'source_first_worker_paused' ? 'paused' : null
        if (fallback && event.execution_boundary_recorded === true) continue
        if (fallback && explicitBoundaries.has(JSON.stringify([event.execution_id, fallback]))) continue
        kind = event.stage === 'source_first_execution' ? `execution_${event.execution_event}`
          : event.stage === 'source_first_worker_started' ? 'execution_started'
          : event.stage === 'source_first_worker_paused' ? 'execution_paused' : null
      }
      if (!Object.hasOwn(labels, kind)) continue
      addTime(at)
      const marker = { kind, label: labels[kind], at_ms: at, seq: event.seq ?? null,
        action_id: event.action_id ?? null, execution_id: event.execution_id ?? null,
        protocol_stop_reason: event.protocol_stop_reason ?? null }
      if (events.length < 200) events.push(marker)
      else {
        omitted++
        // Keep protocol returns and process confirmations before repetitive
        // dispatch markers. Within a priority, favor recent observations.
        const minimum = Math.min(...events.map(item => markerPriority(item.kind)))
        if (markerPriority(kind) >= minimum) events.splice(events.findIndex(item => markerPriority(item.kind) === minimum), 1, marker)
      }
      if (!event.execution_id) continue
      const segment = get(event.execution_id, event)
      if (kind === 'execution_started' && event.stage === 'source_first_execution' && segment.start_at_ms === null) {
        segment.start_at_ms = at; segment.start_source = 'recorded_execution_event'
      }
      if (['execution_finished', 'execution_paused'].includes(kind) && event.stage === 'source_first_execution') {
        segment.end_at_ms = at; segment.end_source = 'recorded_execution_event'
        segment.status = kind === 'execution_paused' ? 'paused' : 'finished'
      }
      // A process event is a separate marker, not a replacement for a missing
      // workflow boundary; turn_end never sets this flag or closes a segment.
      if (kind === 'process_exit') segment.process_stopped = true
    }
    for (const [actionId, action] of Object.entries(progress.actions ?? {})) {
      if (!action.execution_id) continue
      const owners = recordedOwners.get(action.execution_id)
      const uniquelyBound = !owners && session.agent_session_id && action.task_id === session.agent_session_id
        && sessions.filter(item => item.agent_session_id === action.task_id).length === 1
      if (!(owners?.has(session.session_id) || uniquelyBound)) continue
      const segment = get(action.execution_id, { action_id: actionId, action_stage: action.stage })
      const start = time(action.execution_started_at_ms)
      segment.reported_finish_at_ms = time(action.execution_finished_at_ms)
      if (start !== null) { segment.start_at_ms = start; segment.start_source = 'progress_current_execution' }
      // Resume reconciliation and stop requests can both synthesize the
      // snapshot finish metric. Preserve it as a report, never a confirmed end.
      if (segment.reported_finish_at_ms !== null && segment.end_at_ms === null) notices.push('结束时间仅状态快照，未核实；未绘制完整执行区间。')
      if (segment.end_at_ms === null && segment.reported_finish_at_ms === null && start !== null && action.status === 'dispatched'
        && progress.lifecycle_status === 'running' && history?.complete === true && !segment.process_stopped
        && !['exited', 'error', 'paused'].includes(session.status)) segment.status = 'running'
    }
    for (const segment of executions.values()) {
      if (segment.start_at_ms !== null && segment.end_at_ms !== null && segment.end_at_ms < segment.start_at_ms) {
        notices.push('执行边界时间顺序异常，未绘制持续区间。')
        segment.end_at_ms = null; segment.end_source = null; segment.status = 'unknown'
      }
      segment.duration_ms = segment.start_at_ms !== null && segment.end_at_ms !== null ? segment.end_at_ms - segment.start_at_ms : null
      addTime(segment.start_at_ms); addTime(segment.end_at_ms)
      if (segment.status === 'running') addTime(now)
    }
    lanes.push({ session_id: session.session_id, agent_session_id: session.agent_session_id ?? null,
      title: session.role || session.agent_session_id || 'Agent', provider: session.provider ?? null,
      status: session.status ?? 'unknown', history_status: history?.complete ? 'recorded' : 'partial',
      segments: [...executions.values()], events: events.sort((a, b) => a.at_ms - b.at_ms), omitted_events: omitted })
    if (!history?.complete || omitted) notices.push('部分会话记录不可读取或显示已限量；不代表完整执行历史。')
  }
  // Old runs may retain only the latest execution snapshot. Show its known
  // boundaries without assigning an invented session or recreating old turns.
  const unbound = []
  for (const [actionId, action] of Object.entries(progress.actions ?? {})) {
    if (!action.execution_id || boundExecutions.has(action.execution_id)) continue
    const start = time(action.execution_started_at_ms)
    const reportedFinish = time(action.execution_finished_at_ms)
    if (reportedFinish !== null) notices.push('结束时间仅状态快照，未核实；未绘制完整执行区间。')
    addTime(start)
    unbound.push({ execution_id: action.execution_id, action_id: actionId, stage: action.stage ?? null,
      reported_finish_at_ms: reportedFinish, start_at_ms: start, end_at_ms: null, status: 'unknown',
      start_source: start === null ? null : 'progress_current_execution', end_source: null,
      duration_ms: null, process_stopped: false })
  }
  if (unbound.length) lanes.push({ session_id: null, agent_session_id: null, title: '未绑定会话的执行',
    history_status: 'partial', segments: unbound, events: [], omitted_events: 0 })
  // Bound the wire payload across the whole run as well as each lane. This
  // trims markers only; execution boundaries and segments remain intact.
  const candidates = lanes.flatMap(lane => lane.events)
  if (candidates.length > 2000) {
    const retained = new Set(candidates.sort((a, b) => markerPriority(b.kind) - markerPriority(a.kind) || b.at_ms - a.at_ms).slice(0, 2000))
    for (const lane of lanes) {
      const kept = lane.events.filter(event => retained.has(event))
      lane.omitted_events += lane.events.length - kept.length; lane.events = kept
    }
    notices.push('事件标记显示已限量；完整执行区间保留，可打开原会话查看事件。')
  }
  return { format_version: 'pangea-execution-timeline-v1', observed_at_ms: now, projected_at_ms: now, is_live: lanes.some(lane => lane.segments.some(segment => segment.status === 'running')),
    history_scope: 'recorded_events_and_current_execution',
    start_at_ms: times.length ? times.reduce((a, b) => Math.min(a, b), Infinity) : null, end_at_ms: times.length ? times.reduce((a, b) => Math.max(a, b), -Infinity) : null,
    lanes, notices: [...new Set(['仅显示已记录边界；空白表示没有已知执行区间，未知边界不补齐。', ...notices])] }
}

// Retain timing/identity only, never transcript body or tool payloads.
export function timelineEvent(event) {
  if (!['prompt', 'turn_end', 'process_exit', 'error', 'session_bound'].includes(event.type)
    && !(event.type === 'host_event' && ['source_first_execution', 'source_first_worker_started', 'source_first_worker_paused'].includes(event.stage))) return null
  return Object.fromEntries(['type', 'stage', 'execution_event', 'execution_boundary_recorded', 'at', 'at_ms', 'seq', 'action_id', 'execution_id', 'action_stage', 'replay', 'protocol_stop_reason']
    .filter(key => event[key] !== undefined).map(key => [key, event[key]]))
}
