// Presentation only: never translate arbitrary Agent prose, infer a verdict,
// drop unknown fields, or rewrite saved records. IDs and source quotes stay raw.
export const REVIEW_FIELD_LABELS = {
  disposition: '复核裁决', verdict: '复核结果', status: '状态', quality_status: '质量状态',
  summary: '复核摘要', conclusion: '结论', decision: '裁决说明', decisions: '对照裁决', reason: '原因',
  rationale: '裁决依据', reasoning: '推导依据', basis: '依据', evidence: '证据',
  source_evidence: '源码依据', evidence_quotes: '源码引文', ref: '位置', snippet: '原样引文',
  what_is_known: '已确认事实', missing_to_resolve: '仍缺少的信息',
  open_issues: '未解决事项', unresolved: '待确认事项', unresolved_items: '待确认事项',
  unresolved_reasons: '待确认原因', limitations: '限制与缺口', remaining_gaps: '剩余缺口',
  findings: '复核发现', issues: '复核问题', required_change: '要求修改',
  required_changes: '要求修改', recommendation: '建议', recommended_action: '建议操作',
  corrections: '定向修正', correction_record_ids: '需修正的记录',
  finding_dispositions: '问题处置', finding_record_id: '复核发现编号',
  finding_key: '发现标识', finding_id: '发现编号', issue_id: '问题编号',
  updated_record_ids: '已更新记录', affected_records: '受影响记录',
  affected_record_ids: '受影响记录编号', target_record_ids: '目标记录编号',
  record_id: '记录编号', record_ids: '记录编号', case_id: '用例编号',
  case_ids: '用例编号', variant_id: '变体编号', unit_id: '分析单元',
  unit: '分析单元', action_id: '阶段动作编号', task_id: '任务编号',
  version_set_id: '本次对照版本', format_version: '格式版本',
  review_stage: '复核阶段', review_mode: '复核模式', review_status: '复核状态',
  scope: '审查范围', scope_notes: '范围说明', checked_items: '已核对事项',
  checks: '检查记录', coverage: '覆盖说明', coverage_summary: '覆盖说明',
  title: '标题', description: '说明', content: '正文', notes: '补充说明',
  note: '补充说明', text: '正文', result: '结果', expected: '预期', actual: '实际结果',
  original: '原结论', original_conclusion: '原结论', source_counterexample: '源码反证',
  category: '问题类别', severity: '严重程度', related_record_ids: '关联记录',
  counts: '数量汇总', independent: '独立复核', comparison: '对照复核',
  confirmed: '已确认', dismissed: '已驳回', effective: '有效问题',
}

export const REVIEW_STATUS_LABELS = {
  pass: '通过', passed: '通过', fail: '未通过', failed: '失败',
  unresolved: '待确认', finding: '需定向修正', pending: '待处理',
  accepted: '已接受', rejected: '未采纳', dismissed: '已驳回',
  confirmed: '已确认', corrected: '已修正', resolved: '已解决',
  completed: '已完成', complete: '已完成', running: '进行中',
  not_applicable: '不适用', excluded: '已排除', unknown: '未知',
  refuted: '已反证', uncertain: '待确认', covered: '已有对应', missed: '遗漏',
  agree: '同意', disagree: '不同意',
  independent_review: '独立复核', comparison_review: '对照复核',
  speed: '速度型', depth: '标准型', standard: '标准型',
}

const ENUM_FIELDS = new Set(['disposition', 'verdict', 'status', 'quality_status', 'review_status', 'review_stage', 'review_mode'])
const ID_FIELDS = new Set(['version_set_id', 'format_version', 'unit_id', 'unit', 'action_id', 'task_id', 'record_id', 'record_ids',
  'case_id', 'case_ids', 'variant_id', 'finding_record_id', 'finding_key', 'finding_id', 'issue_id', 'updated_record_ids',
  'affected_record_ids', 'target_record_ids', 'correction_record_ids', 'related_record_ids', 'ref', 'snippet', 'source_evidence'])
const ORDER = ['disposition', 'verdict', 'status', 'quality_status', 'review_status', 'summary', 'conclusion', 'decision',
  'basis', 'rationale', 'reasoning', 'reason', 'what_is_known', 'open_issues', 'unresolved', 'unresolved_items',
  'unresolved_reasons', 'missing_to_resolve', 'remaining_gaps', 'limitations', 'findings', 'issues', 'corrections',
  'required_change', 'required_changes', 'correction_record_ids', 'finding_dispositions']
const textValue = value => value == null ? String(value) : typeof value === 'string' ? value : String(value)
const labelValue = (labels, key) => Object.prototype.hasOwnProperty.call(labels, key) ? labels[key] : key

export function reviewStatusLabel(value) {
  if (typeof value !== 'string') return textValue(value)
  const key = value.trim().toLowerCase()
  return Object.prototype.hasOwnProperty.call(REVIEW_STATUS_LABELS, key) ? REVIEW_STATUS_LABELS[key] : value
}

function parseBody(value) {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i)
  const candidate = fenced ? fenced[1] : trimmed
  if (!/^[\[{]/.test(candidate)) return value
  try {
    const parsed = JSON.parse(candidate)
    return parsed && typeof parsed === 'object' ? parsed : value
  } catch { return value }
}

function rawText(value) {
  if (typeof value === 'string') return value
  if (value === undefined) return 'undefined'
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

function projectValue(value, key = '', seen = new Set()) {
  // Evidence and identity fields are literal subtrees, not review metadata.
  // A nested property named status/disposition must not translate source data.
  if (ID_FIELDS.has(key)) return { type: 'scalar', text: rawText(value), value, preserve: true }
  if (value == null) return { type: 'scalar', text: textValue(value), value }
  if (typeof value !== 'object') return {
    type: 'scalar', text: ENUM_FIELDS.has(key) ? reviewStatusLabel(value) : textValue(value),
    value, preserve: ID_FIELDS.has(key),
  }
  if (seen.has(value)) return { type: 'scalar', text: '[循环引用]', value: null }
  const next = new Set(seen).add(value)
  if (Array.isArray(value)) return { type: 'array', items: value.map(item => projectValue(item, key, next)) }
  // Keep fields as entries: translated labels can collide, keys never do.
  const entries = Object.entries(value)
  entries.sort(([left], [right]) => {
    const rank = name => { const index = ORDER.indexOf(name); return index < 0 ? ORDER.length : index }
    return rank(left) - rank(right)
  })
  return { type: 'object', fields: entries.map(([name, item]) => ({
    key: name, label: labelValue(REVIEW_FIELD_LABELS, name), value: projectValue(item, name, next),
  })) }
}

export function reviewPresentation(body) {
  const parsed = parseBody(body)
  return { tree: projectValue(parsed), raw: rawText(body), parsed }
}

export function isReviewRecord(record, stage = '') {
  return ['review_decision', 'review_finding', 'finding'].includes(record?.kind)
    || ['independent_review', 'comparison_review'].includes(stage)
}

// Accept React.createElement (or a test element factory); no runtime dependency.
// renderText optionally reuses the host's existing safe Markdown prose reader.
export function renderReviewPresentation(h, body, { renderText, showRaw = true } = {}) {
  const projection = reviewPresentation(body)
  const render = (node, path = 'review', depth = 0) => {
    if (node.type === 'scalar') {
      if (node.preserve) return h('pre', { key: path, style: { margin: '6px 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit' } }, node.text)
      return renderText ? renderText(node.text) : h('p', { key: path, style: { margin: '7px 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.7 } }, node.text)
    }
    if (node.type === 'array') return node.items.length
      ? h('ol', { key: path, style: { margin: '8px 0', paddingLeft: 24 } }, node.items.map((item, i) => h('li', { key: `${path}.${i}`, style: { margin: '8px 0' } }, render(item, `${path}.${i}`, depth + 1))))
      : h('p', { key: path, style: { margin: '7px 0', color: 'var(--dsw-alias-label-secondary, #68736a)' } }, '空列表（原记录）')
    if (!node.fields.length) return h('p', { key: path }, '空对象（原记录）')
    return h('div', { key: path, className: 'pangea-review-fields', style: { display: 'grid', gap: depth ? 8 : 14 } }, node.fields.map(field =>
      h('section', { key: `${path}.${field.key}`, 'data-review-field': field.key, style: { minWidth: 0, padding: depth ? '0' : '10px 12px', borderLeft: depth ? undefined : '3px solid var(--dsw-alias-border, #d8dfda)', background: depth ? undefined : 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.04))' } },
        h('div', { style: { fontWeight: 650, fontSize: depth ? 12 : 13, color: 'var(--dsw-alias-label-secondary, #68736a)', marginBottom: 5 } }, field.label),
        render(field.value, `${path}.${field.key}`, depth + 1))))
  }
  return h('div', { className: 'pangea-review-presentation', style: { overflowWrap: 'anywhere', lineHeight: 1.65 } },
    render(projection.tree),
    showRaw ? h('details', { style: { marginTop: 14 } }, h('summary', { style: { cursor: 'pointer', fontSize: 12 } }, '查看原始复核记录'),
      h('pre', { style: { margin: '8px 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12, lineHeight: 1.6 } }, projection.raw)) : null)
}
