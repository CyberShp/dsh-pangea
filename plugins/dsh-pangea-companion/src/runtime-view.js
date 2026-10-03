// Mirrors pangea_agent.execution_view using already-read, identity-checked files.
// File timestamps, output prose, and transport chatter are never work progress.
export function readableNotesEnvelope(result) {
  return Boolean(result && Number.isInteger(result.revision) && result.revision >= 0 && Array.isArray(result.records)
    && result.records.every(record => record && typeof record === 'object' && !Array.isArray(record)))
}

function activeRecords(records) {
  const known = new Set(), retired = new Set()
  for (const record of records) {
    for (const target of Array.isArray(record.supersedes) ? record.supersedes : []) {
      if (typeof target === 'string' && known.has(target)) retired.add(target)
    }
    known.add(record.record_id)
  }
  return records.filter(record => !retired.has(record.record_id))
}

function plannedUnits(plan) {
  if (!Array.isArray(plan?.units)) return null
  const units = new Map()
  for (const unit of plan.units) {
    if (unit && typeof unit === 'object' && unit.unit_id && !units.has(unit.unit_id)) units.set(unit.unit_id, unit)
  }
  return [...units.values()]
}

function effectiveAction(actions, unitId) {
  const unitActions = actions.filter(action => action.unit_id === unitId && ['analysis', 'closure'].includes(action.role))
  return unitActions.filter(action => action.role === 'closure').at(-1) ?? unitActions.at(-1) ?? null
}

export function sourceFirstUnitRows(plan, executionView, artifacts = []) {
  // A missing plan leaves the total unknown. Existing action rows can still be
  // inspected, but are not presented as the entire planned scope.
  const units = plannedUnits(plan) ?? [...new Map(artifacts.filter(item => item.task?.unit_id && ['analysis', 'closure'].includes(item.role))
    .map(item => [item.task.unit_id, item.task])).values()]
  return units.map(unit => ({
    unit_id: unit.unit_id,
    title: unit.title ?? unit.unit_id,
    status: effectiveAction(executionView.actions, unit.unit_id)?.status ?? 'pending',
    owned_regions: unit.owned_regions ?? [],
    context_regions: unit.context_regions ?? [],
  }))
}

export function sourceFirstExecutionView({ progress, plan = null, artifacts = [], diagnostics = [], now = Date.now() }) {
  const lifecycle = progress.lifecycle_status ?? null
  const stage = progress.stage ?? null
  const partialReporting = progress.partial_delivery && ['reporting', 'complete'].includes(stage)
  const byId = new Map(artifacts.map(item => [item.action_id, item]))
  const issues = [...diagnostics]
  const actions = [], preserved = [], unresolved = []
  let lastProgress = null
  for (const [actionId, action] of Object.entries(progress.actions ?? {})) {
    if (!action || typeof action !== 'object') continue
    const artifact = byId.get(actionId)
    const task = artifact?.task ?? {}
    const rawResult = artifact?.runtime_result ?? null
    const result = readableNotesEnvelope(rawResult) ? rawResult : null
    if (rawResult && !result) issues.push({ action_id: actionId, message: '结果记录外壳不可读取，已保存数量与时间未知' })
    const records = result && Array.isArray(result.records) ? activeRecords(result.records) : null
    const taskId = action.task_id ?? null, unitId = task.unit_id ?? null, status = action.status ?? null
    const declared = Boolean(result?.completion?.complete === true && result.completion.declared_revision === result.revision)
    let operation = 'none'
    if (lifecycle !== 'complete' && status !== 'accepted' && !partialReporting) {
      if (status === 'settled') operation = 'advance_workflow'
      else if (declared && taskId) operation = 'settle_action'
      else if (['pending', 'dispatched', 'paused'].includes(status) || (status === 'failed' && action.error === '用户停止 Run')) {
        operation = taskId ? 'continue_agent' : 'dispatch_agent'
      }
    }
    const start = Number.isFinite(action.execution_started_at_ms) ? action.execution_started_at_ms : null
    const finish = Number.isFinite(action.execution_finished_at_ms) ? action.execution_finished_at_ms : null
    const timed = start !== null || finish !== null || action.execution_elapsed_ms > 0
    const seed = Boolean(result && action.role === 'closure' && Number.isInteger(task.base_revision)
      && result.revision === task.base_revision && !result.completion?.complete && !Object.keys(result.receipts ?? {}).length)
    // A pending shell/closure seed has not received a bound worker write.
    const timestamp = seed || result?.binding?.task_id === 'pending' ? null : result?.last_record_write_at_ms
    const savedAt = Number.isInteger(timestamp) && timestamp > 0 ? timestamp : null
    const row = {
      action_id: actionId, task_id: taskId, unit_id: unitId,
      title: task.title || task.target || null, role: action.role ?? null,
      stage: action.stage ?? null, status,
      saved_revision: Number.isInteger(result?.revision) ? result.revision : null,
      saved_record_count: records?.length ?? null, last_saved_at_ms: savedAt,
      completion_declared: declared,
      accepted_revision: progress.accepted_revisions?.[actionId] ?? null,
      delivery_revision: action.delivery_revision ?? null, execution_id: action.execution_id ?? null,
      elapsed_ms: timed ? action.execution_elapsed_ms ?? 0 : null,
      current_turn_elapsed_ms: start !== null ? Math.max(0, (finish ?? now) - start) : null,
      budget_ms: action.execution_budget_ms ?? task.execution_budget_ms ?? null, resume_action: operation, error: action.error ?? null,
    }
    actions.push(row)
    if (savedAt !== null && (lastProgress === null || savedAt > lastProgress.at_ms)) {
      lastProgress = { kind: 'records_saved', at_ms: savedAt, action_id: actionId, unit_id: unitId,
        revision: row.saved_revision, record_count: records.length }
    }
    if (records?.length) {
      const acceptance = status === 'accepted' ? 'accepted' : action.delivery_revision != null ? 'delivered'
        : seed ? 'seed' : 'draft'
      preserved.push({ action_id: actionId, unit_id: unitId, revision: row.saved_revision, record_count: records.length, acceptance })
    }
    if (['paused', 'failed'].includes(status) || action.attention_required) {
      unresolved.push({ action_id: actionId, unit_id: unitId, status, reason: action.error || '执行尚未完成，已保存结果保留' })
    }
  }
  const units = plannedUnits(plan)
  const counts = { total: units?.length ?? null, completed: 0, pending: 0, active: 0, paused: 0, failed: 0 }
  for (const unit of units ?? []) {
    const action = effectiveAction(actions, unit.unit_id)
    const status = action?.status ?? 'pending'
    const key = ['settled', 'accepted'].includes(status) ? 'completed' : status === 'dispatched' ? 'active'
      : status === 'paused' || action?.error === '用户停止 Run' ? 'paused' : status === 'failed' ? 'failed' : 'pending'
    counts[key] += 1
  }
  const canResume = ['running', 'stopped'].includes(lifecycle)
  const requiresQuiescence = canResume && stage !== 'reporting' && !partialReporting && actions.some(action => action.task_id
    && (['dispatched', 'paused'].includes(action.status) || (action.status === 'failed' && action.error === '用户停止 Run')))
  let resumeFrom = actions.filter(action => action.resume_action !== 'none')
    .map(action => ({ action_id: action.action_id, task_id: action.task_id, operation: action.resume_action }))
  if (stage === 'reporting' && lifecycle !== 'complete') resumeFrom = [{ action_id: null, task_id: null, operation: 'finalize_report' }]
  return {
    format_version: 'pangea-execution-view-v1', stage, lifecycle_status: lifecycle,
    quality_status: progress.quality_status ?? null, unit_counts: counts,
    last_effective_progress: lastProgress, actions, preserved, unresolved,
    recovery: { can_resume: canResume, requires_host_quiescence: requiresQuiescence,
      resume_from: resumeFrom, blocked_reason: canResume ? null : 'Run 已结束或冻结输入异常，不能续跑' },
    diagnostics: issues,
  }
}
