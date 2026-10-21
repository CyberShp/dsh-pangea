const list = value => Array.isArray(value) ? value : []
const bodyText = value => typeof value === 'string' ? value : value?.message ?? value?.summary ?? value?.title ?? ''

// Projection only: preserve the original findings and their provenance.
export function buildOverviewFindings({ current = {}, risks = [], notes = [] } = {}) {
  const found = [], seen = new Set()
  const add = item => {
    if (!item.id || seen.has(item.id)) return
    seen.add(item.id); found.push(item)
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
