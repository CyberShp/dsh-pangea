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

const countSummary = value => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length > 0
  && Object.keys(value).every(key => ['total', 'designed', 'missing', 'unresolved', 'not_applicable'].includes(key)
    && typeof value[key] === 'number' && Number.isFinite(value[key]))

// Only named prose fields can become a label. An unfamiliar record must remain
// a record, rather than silently promoting its JSON envelope into a conclusion.
function proseText(value, depth = 0) {
  if (depth > 5 || value == null) return ''
  if (typeof value === 'string') {
    const text = value.trim()
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text)
    if (fenced) { try { return proseText(JSON.parse(fenced[1]), depth + 1) } catch { return '' } }
    if (/^\{|^\[\s*(?:\{|"|\d|true\b|false\b|null\b|\])/.test(text)) {
      try { return proseText(JSON.parse(text), depth + 1) } catch { return '' }
    }
    return text
  }
  if (typeof value !== 'object' || Array.isArray(value)) return ''
  for (const key of ['title', 'message', 'summary']) {
    const text = proseText(value[key], depth + 1)
    if (text) return text
  }
  return countSummary(value) ? summaryText(value) : ''
}

function excerpt(value, limit) {
  const text = value.replace(/^\s{0,3}#{1,6}\s+/gm, '').replace(/\[([^\]]+)\]\([^\n)]*\)/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/`([^`\n]+)`/g, '$1').replace(/\s+/g, ' ').trim()
  const characters = Array.from(text)
  return characters.length <= limit ? text : `${characters.slice(0, limit - 1).join('').trimEnd()}…`
}

const reviewRefs = value => [...new Set(list(value?.record_ids).filter(id => typeof id === 'string' && id.trim()).map(id => id.trim()))]
const workflowLabel = value => {
  if (value?.kind !== 'source_first_review_finding') return '待处理记录'
  const refs = reviewRefs(value)
  return refs.length ? `审查发现 · ${refs.length} 条记录` : '审查发现'
}

// Projection only: preserve the original findings and their provenance.
export function buildOverviewFindings({ current = {}, risks = [], notes = [] } = {}) {
  const found = [], seen = new Set()
  const add = item => {
    if (!item.id || seen.has(item.id)) return
    const title = proseText(item.title) || item.fallbackTitle
    const summary = summaryText(item.summary)
    const preview = proseText(item.summary) || item.previewFallback || (summary ? '结构化记录，展开查看原文' : '')
    const { fallbackTitle, previewFallback, ...row } = item
    seen.add(item.id); found.push({ ...row, title, titlePreview: excerpt(title, 80),
      summary, summaryPreview: excerpt(preview, 180) })
  }
  for (const [index, value] of list(current.workflow?.unresolved).entries()) {
    if (value == null || typeof value === 'string' && !value.trim()) continue
    const refs = reviewRefs(value)
    add({ id: `workflow:${value?.id ?? value?.code ?? index}`, title: value, fallbackTitle: workflowLabel(value),
      summary: bodyText(value), previewFallback: refs.length ? `引用记录：${refs.join('、')}` : '',
      sourceRecord: value, kind: 'workflow', validationState: '待处理', sourceRefs: [], caseRefs: [] })
  }
  for (const risk of list(risks)) {
    const id = risk.projection_id ?? risk.risk_id
    if (!id) continue
    add({ id: `risk:${id}`, title: risk.title ?? risk.risk_id, fallbackTitle: '待验证风险',
      summary: risk.narrative ?? risk.trigger ?? risk.residual_effect ?? '', kind: 'risk', validationState: '待验证',
      sourceRecord: risk.source_record ?? risk, sourceRefs: [id], caseRefs: list(risk.linked_test_case_ids) })
  }
  for (const note of list(notes)) {
    const record = note.source_record ?? note
    if (record.kind !== 'note') continue
    const id = note.projection_id ?? record.record_id
    const body = note.body ?? record.body
    const summary = bodyText(body)
    if (id && summary) add({ id: `note:${id}`, title: body?.title ?? note.title, fallbackTitle: '分析记录', summary,
      sourceRecord: record, kind: 'note', validationState: '待验证', sourceRefs: [id], caseRefs: [] })
  }
  return found
}
