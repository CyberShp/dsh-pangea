// A factual projection of already-read stage records. No log interpretation,
// prose summarization, inferred completion, wall-clock stall rules or I/O.
const list = value => Array.isArray(value) ? value : []
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const string = value => typeof value === 'string' && value.trim() ? value : null
const integer = value => Number.isInteger(value) && value >= 0 ? value : null
const timestamp = value => Number.isFinite(value) && value > 0 ? value : null
const rawText = value => typeof value === 'string' ? value : value == null ? null : JSON.stringify(value, null, 2)
const stages = {
  unit_planning: 'planning', source_first_plan: 'planning', unit_analysis: 'analyzing',
  independent_review: 'reviewing', comparison_review: 'reviewing', targeted_closure: 'closing',
}
const stageNames = { preparing: '准备输入', planning: '分析规划', analyzing: '单元分析', reviewing: '结果复核', closing: '定向修正', reporting: '汇总报告', complete: '交付结果' }
export const RUN_INSIGHT_KIND_LABELS = {
  flow: '业务流程记录', test_case: '测试用例', test_case_group: '用例组', risk: '风险记录',
  finding: '复核发现', review_finding: '复核发现', unresolved: '待确认事项',
  unit_plan: '单元计划', review_decision: '复核结论', summary: '分析总结', note: '分析说明',
  branch: '分支记录', evidence: '证据记录', scenario: '业务场景', check: '检查记录', blackbox_translation: '业务转译记录',
}
const actionStates = { pending: '等待执行', dispatched: '执行中', settled: '结果待接收', paused: '已暂停', failed: '执行失败' }
const stageOf = value => stages[value] ?? value

function activeRecords(records) {
  const known = new Set(), retired = new Set()
  for (const record of records) {
    for (const ref of list(record?.supersedes)) if (typeof ref === 'string' && known.has(ref)) retired.add(ref)
    if (typeof record?.record_id === 'string') known.add(record.record_id)
  }
  return records.filter(record => record && typeof record === 'object' && !Array.isArray(record) && !retired.has(record.record_id))
}

function mapping(body) {
  if (typeof body !== 'string') return object(body)
  try { return object(JSON.parse(body)) } catch { return {} }
}

function labelFor(kind) { return Object.hasOwn(RUN_INSIGHT_KIND_LABELS, kind) ? RUN_INSIGHT_KIND_LABELS[kind] : '其他记录' }
function findingExcerpt(value) {
  if (!string(value)) return null
  const firstLine = [...value.trim().split(/\r?\n/, 1)[0]]
  return firstLine.length > 100 ? `${firstLine.slice(0, 100).join('')}…` : firstLine.join('')
}
function recordTitle(record) {
  const body = mapping(record.body)
  return string(body.title) ?? string(body['标题']) ?? (record.kind === 'unit_plan' ? string(body.unit?.title) : null)
    ?? (['finding', 'review_finding'].includes(record.kind) ? findingExcerpt(body.summary) : null)
    ?? `${labelFor(record.kind)}${record.record_id ? ` · ${record.record_id}` : ''}`
}

function exactNavigation(current, ref) {
  if (!ref.record_id || ref.revision === null) return null
  const candidates = []
  for (const [collection, key] of [['business_flows', 'flow_id'], ['test_cases', 'test_case_id'], ['risks', 'risk_id']]) {
    for (const item of list(current.details?.[collection])) {
      const source = item?.source_record
      if (source?.action_id === ref.action_id && source.record_id === ref.record_id && source.revision === ref.revision && string(item[key])) {
        candidates.push({ type: ({ business_flows: 'flow', test_cases: 'case', risks: 'risk' })[collection], id: item[key] })
      }
    }
  }
  // A multi-flow wrapper or duplicate identity cannot be routed to an arbitrary
  // first object. The exact source record remains available for inspection.
  return candidates.length === 1 ? candidates[0] : null
}

function selectedStage(current, selected) {
  const explicit = typeof selected === 'string' ? selected : selected?.stage ?? selected?.step
  const step = list(current.workflow?.steps).find(item => item.stage === explicit || item.step === explicit)
  const stage = stageOf(step?.stage ?? explicit ?? current.stage ?? current.workflow?.current_step)
  return { stage, title: string(step?.title) ?? string(selected?.title) ?? stageNames[stage] ?? '所选阶段', status: step?.status ?? selected?.status ?? null }
}

function buildActions(current) {
  const actions = new Map()
  for (const action of [...list(current.workflow?.actions), ...list(current.execution_view?.actions)]) {
    if (string(action?.action_id)) actions.set(action.action_id, { ...actions.get(action.action_id), ...action })
  }
  for (const group of list(current.source_first_records)) {
    if (string(group?.action_id)) actions.set(group.action_id, { ...group, ...actions.get(group.action_id), group })
  }
  const saved = new Map(list(current.execution_progress).map(item => [item?.action_id, item]))
  const preserved = new Map(list(current.execution_view?.preserved).map(item => [item?.action_id, item]))
  return [...actions.values()].map(action => {
    const result = action.group
    const accepted = integer(action.accepted_revision ?? current.accepted_revisions?.[action.action_id])
    const delivered = integer(action.delivery_revision)
    const revision = integer(result?.revision)
    const seed = preserved.get(action.action_id)?.acceptance === 'seed' || ['pending', 'not_delivered'].includes(action.binding_status)
    const readable = Boolean(result && Array.isArray(result.records) && revision !== null
      && (accepted === null || accepted === revision) && (delivered === null || delivered === revision)
      && (integer(action.saved_revision) === null || action.saved_revision === revision))
    const acceptance = action.status === 'accepted' ? 'accepted' : delivered !== null ? 'delivered'
      : ['pending', 'dispatched', 'paused', 'settled', 'failed'].includes(action.status) ? 'draft' : 'saved'
    return { ...action, stage: stageOf(action.stage), action_stage: action.stage,
      unit_id: action.unit_id ?? result?.unit_id ?? null, revision, acceptance,
      readable, seed, records: readable && !seed ? activeRecords(result.records) : [],
      saved_at_ms: seed ? null : timestamp(action.last_saved_at_ms ?? saved.get(action.action_id)?.last_saved_at_ms) }
  })
}

function scopeRows(current, allActions, selectedActions, stage) {
  const plans = new Map()
  for (const action of allActions.filter(item => item.stage === 'planning' && item.acceptance === 'accepted' && item.readable)) {
    for (const record of action.records.filter(item => item.kind === 'unit_plan')) {
      const body = mapping(record.body), unit = object(body.unit ?? body)
      if (string(unit.unit_id)) plans.set(unit.unit_id, plans.has(unit.unit_id) ? null : unit)
    }
  }
  const declared = new Map(list(current.workflow?.units).filter(unit => string(unit?.unit_id)).map(unit => [unit.unit_id, unit]))
  const restricted = new Set(selectedActions.map(action => action.unit_id).filter(Boolean))
  // Reviewing covers the explicit plan. Closing covers only bound closure units.
  const candidates = stage === 'closing' ? [...restricted] : ['planning', 'analyzing', 'reviewing', 'reporting', 'complete'].includes(stage) ? [...declared.keys()] : []
  if (stage === 'analyzing') for (const id of restricted) if (!candidates.includes(id)) candidates.push(id)
  const units = candidates.map(id => {
    const unit = declared.get(id) ?? {}, plan = plans.get(id) ?? {}, action = selectedActions.find(item => item.unit_id === id)
    return { unit_id: id, title: string(unit.title) ?? string(plan.title) ?? string(action?.title) ?? id,
      purpose: string(unit.purpose) ?? string(plan.purpose), owned_regions: list(unit.owned_regions ?? plan.owned_regions),
      context_regions: list(unit.context_regions ?? plan.context_regions) }
  })
  const unknownPlan = Object.hasOwn(object(current.execution_view?.unit_counts), 'total') && current.execution_view.unit_counts.total === null
  return { target: string(current.target), unit_count: stage === 'closing' && selectedActions.length ? units.length
    : Array.isArray(current.workflow?.units) && !unknownPlan ? units.length : null, units }
}

function outputRow(current, action, record, index) {
  const ref = { action_id: action.action_id, record_id: string(record.record_id), revision: action.revision,
    unit_id: action.unit_id, stage: action.action_stage }
  return { key: JSON.stringify([ref.action_id, ref.record_id, ref.revision, index]), kind: record.kind,
    label: labelFor(record.kind), title: recordTitle(record), acceptance: action.acceptance,
    created_revision: integer(record.created_revision), saved_at_ms: action.saved_at_ms,
    time_basis: 'result_file', ref, navigation: exactNavigation(current, ref), record, index }
}

function explicitlyHandledFindings(allActions, selectedUnits) {
  const comparisons = allActions.filter(action => action.action_stage === 'comparison_review' && action.readable
    && ['accepted', 'delivered'].includes(action.acceptance))
  const dispositions = new Map()
  for (const closure of allActions.filter(action => action.stage === 'closing' && action.readable && !action.seed
    && ['accepted', 'delivered'].includes(action.acceptance) && string(action.unit_id))) {
    for (const summary of closure.records.filter(record => record.kind === 'summary')) {
      for (const entry of list(mapping(summary.body).finding_dispositions)) {
        if (!string(entry?.finding_record_id)) continue
        // Record IDs are local to an action. Older reader payloads do not carry
        // the closure task's comparison binding, so only a unique comparison is
        // sufficient without an explicit action identity on the disposition.
        const actionId = string(entry.finding_action_id) ?? string(entry.review_action_id)
        const candidates = actionId ? comparisons.filter(action => action.action_id === actionId) : comparisons
        if (candidates.length !== 1) continue
        const matches = candidates[0].records.filter(record => ['finding', 'review_finding'].includes(record.kind)
          && record.record_id === entry.finding_record_id && list(record.relates_to).includes(closure.unit_id))
        if (matches.length !== 1) continue
        const key = JSON.stringify([candidates[0].action_id, entry.finding_record_id])
        const units = dispositions.get(key) ?? new Map(), values = units.get(closure.unit_id) ?? new Set()
        values.add(entry.disposition); units.set(closure.unit_id, values); dispositions.set(key, units)
      }
    }
  }
  const handled = new Set()
  for (const action of comparisons) for (const finding of action.records.filter(record => ['finding', 'review_finding'].includes(record.kind))) {
    const key = JSON.stringify([action.action_id, finding.record_id]), units = dispositions.get(key)
    const related = [...(selectedUnits.get(key) ?? [])]
    if (related.length && related.every(unitId => {
      const values = units?.get(unitId)
      return values?.size === 1 && [...values].every(value => ['accepted', 'rejected'].includes(value))
    })) handled.add(key)
  }
  return handled
}

function declaredPending(rows, allActions) {
  const selectedFindings = new Set(), selectedUnits = new Map()
  const decisions = new Map()
  for (const row of rows.filter(item => item.kind === 'review_decision')) decisions.set(row.ref.action_id, row)
  for (const row of decisions.values()) {
    const body = mapping(row.record.body)
    if (row.ref.stage !== 'comparison_review' || body.disposition !== 'finding') continue
    if (Object.hasOwn(body, 'correction_record_ids')) {
      for (const id of list(body.correction_record_ids)) if (typeof id === 'string') {
        const key = JSON.stringify([row.ref.action_id, id])
        selectedFindings.add(key)
        selectedUnits.set(key, new Set(rows.filter(item => ['finding', 'review_finding'].includes(item.kind)
          && item.ref.action_id === row.ref.action_id && item.ref.record_id === id)
          .flatMap(item => list(item.record.relates_to).filter(unitId => string(unitId)))))
      }
    } else {
      // Frozen older decisions selected units instead of individual findings.
      // Preserve that exact relation, without deriving a unit from prose.
      const units = new Set(list(body.closure_units).filter(id => typeof id === 'string'))
      for (const finding of rows.filter(item => ['finding', 'review_finding'].includes(item.kind) && item.ref.action_id === row.ref.action_id)) {
        const related = list(finding.record.relates_to).filter(id => units.has(id))
        if (related.length) {
          const key = JSON.stringify([row.ref.action_id, finding.ref.record_id])
          selectedFindings.add(key); selectedUnits.set(key, new Set(related))
        }
      }
    }
  }
  const handled = explicitlyHandledFindings(allActions, selectedUnits)
  const isUnresolved = row => row.kind === 'unresolved' || (row.kind === 'review_decision'
    && decisions.get(row.ref.action_id) === row && mapping(row.record.body).disposition === 'unresolved')
  return rows.filter(row => isUnresolved(row) || (['finding', 'review_finding'].includes(row.kind)
    && selectedFindings.has(JSON.stringify([row.ref.action_id, row.ref.record_id]))
    && !handled.has(JSON.stringify([row.ref.action_id, row.ref.record_id])))).map(row => {
    const body = mapping(row.record.body)
    return { ...row, source: 'record', source_label: isUnresolved(row) ? '待确认记录' : '复核选定修正',
      declared_status: isUnresolved(row) ? 'unresolved' : 'selected_for_correction',
      reason: rawText(body.reason ?? body.missing_to_resolve ?? body.description ?? body.summary ?? body.issue
        ?? (typeof row.record.body === 'string' ? row.record.body : null)),
      action: rawText(body.recommended_action ?? body.requested_change ?? body.required_action ?? body.action),
      note: isUnresolved(row) ? '原记录声明待确认；未推断后续已解决。' : '复核明确选中修正；尚未读到覆盖全部选定单元且身份明确的接收或反驳记录。' }
  })
}

/**
 * availability: readable | partial | unavailable | not_started | unsupported.
 * Counts refer to active saved records, not semantic coverage or executed tests.
 * For an earlier stage these are that stage's own records; delivery stages use
 * the accepted/delivered closure for each unit. Inputs are never mutated.
 */
export function buildRunInsights(current = {}, selected = null, { stale = false, limit = 6 } = {}) {
  current = object(current)
  limit = Number.isInteger(limit) && limit >= 0 ? limit : 6
  const selectedInfo = selectedStage(current, selected), stage = selectedInfo.stage
  const empty = { format_version: 'run-insights-v1', stage, stage_title: selectedInfo.title, availability: 'unavailable',
    notices: [], scope: { target: string(current.target), units: [], unit_count: null },
    outputs: { total_records: null, counts: [], latest: [], more: 0, count_basis: 'active_saved_records', complete: false },
    current_work: [], current_work_more: 0, pending: [], pending_more: 0, last_saved_at_ms: null }
  if (current.workflow_version !== 'source-first-v1' || !Object.hasOwn(stageNames, stage)) {
    return { ...empty, availability: 'unsupported', notices: [{ code: 'unsupported', message: '该阶段没有结构化进展数据，可继续查看已有阶段产物。' }] }
  }
  const notices = [], allActions = buildActions(current), deliveryStage = ['reporting', 'complete'].includes(stage)
  const acceptedClosures = new Set(allActions.filter(action => action.stage === 'closing' && ['accepted', 'delivered'].includes(action.acceptance)).map(action => action.unit_id).filter(Boolean))
  const selectedActions = deliveryStage ? allActions.filter(action => ['accepted', 'delivered'].includes(action.acceptance)
    && ((action.stage === 'closing') || (action.stage === 'analyzing' && !acceptedClosures.has(action.unit_id)) || action.action_stage === 'comparison_review'))
    : allActions.filter(action => action.stage === stage)
  const scope = scopeRows(current, allActions, selectedActions, stage)
  const byUnit = new Map(scope.units.map(unit => [unit.unit_id, unit]))
  const unreadable = selectedActions.filter(action => !action.readable && !action.seed)
  const rows = selectedActions.flatMap(action => action.records.filter(record => record.kind !== 'completion')
    .map((record, index) => outputRow(current, action, record, index)))
  const pending = declaredPending(rows, allActions)
  const counts = new Map()
  for (const row of rows) {
    const kind = string(row.kind) ?? 'other'
    const count = counts.get(kind) ?? { kind, label: labelFor(kind), count: 0, accepted: 0, delivered: 0, draft: 0, saved: 0 }
    count.count++; count[row.acceptance]++; counts.set(kind, count)
  }
  const latest = [...rows]
    .sort((a, b) => (b.saved_at_ms ?? -1) - (a.saved_at_ms ?? -1) || (b.created_revision ?? -1) - (a.created_revision ?? -1)
      || (a.ref.action_id === b.ref.action_id ? b.index - a.index : a.ref.action_id.localeCompare(b.ref.action_id)))
  const savedTimes = selectedActions.filter(action => action.readable).map(action => action.saved_at_ms).filter(value => value !== null)
  const lifecycle = current.lifecycle_status ?? current.execution_view?.lifecycle_status
  const currentWork = deliveryStage ? [] : selectedActions.filter(action => Object.hasOwn(actionStates, action.status)).map(action => ({
    action_id: action.action_id, unit_id: action.unit_id,
    title: byUnit.get(action.unit_id)?.title ?? string(action.title) ?? (action.unit_id || selectedInfo.title),
    purpose: byUnit.get(action.unit_id)?.purpose ?? null,
    state: stale ? 'last_observed' : ['stopped', 'failed', 'complete'].includes(lifecycle) ? lifecycle : action.status,
    state_label: stale ? '上次读取的任务' : lifecycle === 'stopped' ? '已停止，记录保留' : lifecycle === 'failed' ? '执行已中断'
      : lifecycle === 'complete' ? '运行已结束' : actionStates[action.status],
    last_saved_at_ms: action.saved_at_ms,
  }))
  for (const item of list(current.execution_view?.unresolved)) {
    if (!selectedActions.some(action => action.action_id === item.action_id)) continue
    pending.push({ key: `execution:${item.action_id}`, source: 'execution', source_label: '执行状态', kind: 'execution', label: '执行待处理',
      title: byUnit.get(item.unit_id)?.title ?? selectedInfo.title, reason: string(item.reason), action: null,
      declared_status: item.status, ref: { action_id: item.action_id, record_id: null, revision: null, unit_id: item.unit_id ?? null },
      note: '执行状态记录，不代表分析结论有误。' })
  }
  if (stale) notices.push({ code: 'stale', message: '正在显示上次读取的记录，当前执行状态尚未刷新。' })
  if (current.partial_delivery) notices.push({ code: 'partial_delivery', message: '本次为部分交付；已保存内容不代表全部分析或修正完成。' })
  if (lifecycle === 'stopped') notices.push({ code: 'stopped', message: '本次运行已停止，以下为停止前保留的阶段内容。' })
  if (unreadable.length) notices.push({ code: 'unreadable', message: `${unreadable.length} 个阶段结果暂不可读取，数量仅代表当前可读取内容。`, action_ids: unreadable.map(action => action.action_id) })
  if (selectedActions.some(action => action.seed)) notices.push({ code: 'pending_binding', message: '部分任务尚无本轮有效写入；准备外壳和复制的修正底稿不计入新产物。' })
  if (stage === 'analyzing' && selectedActions.some(action => acceptedClosures.has(action.unit_id))) {
    notices.push({ code: 'stage_history', message: '这里保留单元分析阶段的记录；后续已交付修订请查看定向修正或交付结果。' })
  }
  let availability = unreadable.length ? rows.length ? 'partial' : 'unavailable' : 'readable'
  if (!Array.isArray(current.source_first_records)) {
    availability = 'unavailable'; notices.push({ code: 'missing_records', message: '阶段记录尚未读取，不能据此认定没有产物。' })
  } else if (!selectedActions.length && selectedInfo.status === 'pending') availability = 'not_started'
  else if (!selectedActions.length && !deliveryStage && !['preparing', 'planning'].includes(stage)) {
    notices.push({ code: 'no_stage_records', message: '当前没有该阶段的已保存记录，不据此判断覆盖情况。' })
  }
  const complete = availability === 'readable' || availability === 'not_started'
  return { ...empty, availability, notices, scope,
    outputs: { total_records: availability === 'unavailable' && !rows.length ? null : rows.length,
      counts: [...counts.values()], latest: latest.slice(0, limit), more: Math.max(0, latest.length - limit),
      count_basis: 'active_saved_records', complete },
    current_work: currentWork.slice(0, limit), current_work_more: Math.max(0, currentWork.length - limit),
    pending: pending.slice(0, limit), pending_more: Math.max(0, pending.length - limit),
    last_saved_at_ms: savedTimes.length ? Math.max(...savedTimes) : null }
}
