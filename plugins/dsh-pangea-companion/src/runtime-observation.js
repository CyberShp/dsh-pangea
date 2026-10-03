const toolKinds = {
  read: ['reading', '读取工具执行中'],
  edit: ['writing', '文件写入工具执行中'],
  delete: ['tool_running', '文件删除工具执行中'],
  search: ['searching', '检索工具执行中'],
  execute: ['tool_running', '命令工具执行中'],
  fetch: ['tool_running', '资料获取工具执行中'],
}
const communicationStages = new Set(['source_first_tool_event', 'source_first_file_permission', 'source_first_worker_finished',
  'source_first_late_response', 'source_first_worker_bound', 'acp_output', 'acp_turn_finished'])

// Titles and model output are untrusted prose. Activity derives exclusively
// from ACP protocol kinds, worker routing stages, and terminal job facts.
export function runtimeObservation(task, events = [], recovery = {}) {
  const relevant = events.filter(event => event.attempt_id === task?.attempt_id)
  const activities = new Map()
  let lastCommunication = null
  for (const event of relevant) {
    const at = Date.parse(event.at ?? '')
    if (!Number.isFinite(at)) continue
    if (communicationStages.has(event.stage)) lastCommunication = Math.max(lastCommunication ?? 0, at)
    const actionId = event.action_id
    if (!actionId) continue
    const value = { kind: 'waiting_provider', label: '等待执行器返回', at_ms: at, action_id: actionId, unit_id: event.unit_id ?? null }
    if (event.stage === 'source_first_worker_started') {
      value.label = ['independent_review', 'comparison_review'].includes(event.action_stage) ? '等待复核执行器返回' : '等待执行器返回'
      activities.set(actionId, value)
    } else if (event.stage === 'source_first_tool_event') {
      if (['pending', 'in_progress'].includes(event.last_tool_status)) {
        const [kind, label] = toolKinds[event.tool_kind] ?? ['tool_running', '工具执行中']
        Object.assign(value, { kind, label })
      } else if (event.active_tool_count > 0) {
        Object.assign(value, { kind: 'tool_running', label: '工具仍在执行' })
      }
      activities.set(actionId, value)
    } else if (['source_first_worker_finished', 'source_first_worker_paused', 'source_first_action_settled'].includes(event.stage)) {
      activities.delete(actionId)
    }
  }
  const active = ['starting', 'running'].includes(task?.execution_status)
  const list = active ? [...activities.values()].sort((a, b) => b.at_ms - a.at_ms) : []
  const activity = list.find(item => item.kind !== 'waiting_provider') ?? list[0] ?? {
    kind: task?.execution_status === 'interrupted' ? 'disconnected' : active ? 'unknown' : 'idle',
    label: task?.execution_status === 'interrupted' ? '连接已中断' : active ? '活动未记录' : '当前没有活动执行',
    at_ms: null, action_id: null, unit_id: null,
  }
  return {
    activity, activities: list, last_communication_at_ms: lastCommunication,
    connection_status: task?.execution_status === 'interrupted' ? 'disconnected'
      : active ? lastCommunication !== null ? 'connected' : task?.execution_status === 'starting' ? 'connecting' : 'unknown' : 'idle',
    recovery: { can_resume: recovery.can_resume === true, blocked_reason: recovery.resume_blocked_reason ?? recovery.blocked_reason ?? null,
      summary: recovery.summary ?? (recovery.can_resume ? '保留已保存结果，从未完成部分继续' : '当前执行不能续跑') },
  }
}
