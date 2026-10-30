const list = value => Array.isArray(value) ? value : []
// Text-only projection; keep structured source records unchanged.
export function summaryText(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value !== 'object') return String(value)
  const labels = { total: '总计', designed: '已设计', missing: '待补用例', unresolved: '待确认', not_applicable: '不适用' }
  const keys = Object.keys(value)
  if (keys.length && keys.every(key => Object.hasOwn(labels, key)) &&
      keys.every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))) {
    return Object.entries(labels).filter(([key]) => Object.hasOwn(value, key))
      .map(([key, label]) => `${label} ${value[key]}`).join(' · ')
  }
  return JSON.stringify(value)
}
const bodyText = value => summaryText(typeof value === 'object' && value !== null
  ? value.message ?? value.summary ?? value.title ?? value : value)

// Projection only: preserve the original findings and their provenance.
export function buildOverviewFindings({ current = {}, risks = [], notes = [] } = {}) {
  const found = [], seen = new Set()
  const add = item => {
    if (!item.id || seen.has(item.id)) return
    seen.add(item.id); found.push({ ...item, title: summaryText(item.title), summary: summaryText(item.summary) })
  }
  for (const [index, value] of list(current.workflow?.unresolved).entries()) {
    const title = bodyText(value)
    if (title) add({ id: `workflow:${value?.id ?? value?.code ?? index}`, title, summary: '', kind: 'workflow', validationState: '待处理', sourceRefs: [], caseRefs: [] })
  }
  for (const risk of list(risks)) {
    const id = risk.projection_id ?? risk.risk_id
    if (!id) continue
    add({ id: `risk:${id}`, title: risk.title ?? risk.risk_id ?? '待验证风险',
      summary: risk.narrative ?? risk.trigger ?? risk.residual_effect ?? '', kind: 'risk', validationState: '待验证',
      sourceRefs: [id], caseRefs: list(risk.linked_test_case_ids) })
  }
  for (const note of list(notes)) {
    const record = note.source_record ?? note
    if (record.kind !== 'note') continue
    const id = note.projection_id ?? record.record_id
    const body = note.body ?? record.body
    const summary = bodyText(body)
    if (id && summary) add({ id: `note:${id}`, title: body?.title ?? note.title ?? '分析记录', summary, kind: 'note', validationState: '待验证', sourceRefs: [id], caseRefs: [] })
  }
  return found
}
