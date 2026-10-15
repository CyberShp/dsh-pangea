// Display only explicit behavior coverage declarations. Never infer coverage
// from case names, source positions, path reachability or execution readiness.
export const BEHAVIOR_COVERAGE_FORMAT = 'behavior-coverage-v1'
export const BEHAVIOR_STATUS_LABELS = {
  designed: '已设计', missing: '待补用例', unresolved: '待确认', not_applicable: '不适用',
}
const array = value => Array.isArray(value) ? value : []
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const valueText = value => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)
function bodyOf(note) {
  const body = note?.source_record?.body ?? note?.body
  if (object(body)) return body
  if (typeof body === 'string') {
    try { const parsed = JSON.parse(body); return object(parsed) ? parsed : {} } catch { return {} }
  }
  return note?.format_version ? note : {}
}

export function caseDesignCounts(cases) {
  const rows = array(cases)
  return { cases: rows.length, variants: rows.reduce((total, item) => total + array(item?.variants).length, 0),
    has_legacy_groups: rows.some(item => item?.source_record?.kind === 'test_case_group') }
}

export function caseSearchText(item) {
  return [item?.display_id, item?.test_case_id, item?.title, item?.case_type, item?.verification_goal,
    ...array(item?.linked_flow_ids), ...array(item?.linked_gap_ids), ...array(item?.linked_risk_ids),
    ...array(item?.variants).flatMap(variant => object(variant)
      ? [variant.variant_id, variant.input, variant.expected] : [variant])].map(valueText).join(' ').toLowerCase()
}

export function caseVariantLines(item) {
  return array(item?.variants).map((variant, index) => object(variant)
    ? `参数组合 ${variant.variant_id || index + 1}：${valueText(variant.input) || '输入未提供'} → ${valueText(variant.expected) || '预期未提供'}`
    : `参数组合 ${index + 1}：${valueText(variant)}`)
}

export function behaviorCoverageProjection(notes, cases) {
  return array(notes).flatMap((note, noteIndex) => {
    const body = bodyOf(note)
    if (body.format_version !== BEHAVIOR_COVERAGE_FORMAT) return []
    const unitId = note.unit_id ?? body.unit_id
    const warnings = []
    if (!Array.isArray(body.items)) warnings.push('行为清单 items 不是数组，原文已保留。')
    if (note.unit_id && body.unit_id && note.unit_id !== body.unit_id) warnings.push('声明的分析单元与记录所属单元不一致，关联按记录所属单元展示。')
    const items = array(body.items).map((item, itemIndex) => {
      const row = object(item) ? item : {}
      const itemWarnings = []
      if (!object(item)) itemWarnings.push('该行为项不是对象，原文已保留。')
      if (!Array.isArray(row.case_refs)) itemWarnings.push('未提供可解析的用例关联。')
      const caseLinks = array(row.case_refs).map(ref => {
        if (!object(ref) || typeof ref.case_id !== 'string' || !ref.case_id.trim()) return { reference: ref, issue: '关联未提供 case_id。' }
        const matches = array(cases).filter(testCase => typeof unitId === 'string' && unitId && testCase.unit_id === unitId
          && [testCase.case_id, testCase.display_id, testCase.test_case_id].includes(ref.case_id))
        const link = { ...ref, reference: ref, target_case_id: null }
        if (matches.length !== 1) return { ...link, issue: matches.length ? '用例编号不唯一。' : '当前单元中未找到该用例。' }
        const testCase = matches[0]
        link.target_case_id = testCase.test_case_id ?? testCase.projection_id
        if (ref.variant_id != null) {
          if (typeof ref.variant_id !== 'string' || !ref.variant_id.trim()) return { ...link, issue: '参数变体关联未提供有效 variant_id。' }
          const variants = array(testCase.variants).map((variant, index) => ({ variant, index }))
            .filter(({ variant }) => object(variant) && variant.variant_id === ref.variant_id)
          if (variants.length !== 1) return { ...link, issue: variants.length ? '参数变体编号不唯一。' : '该用例中未找到声明的参数变体。' }
          link.variant_index = variants[0].index
          link.variant = variants[0].variant
        }
        return link
      })
      return { ...row, source_item: item, display_key: `${note.projection_id ?? noteIndex}/item-${itemIndex}`,
        case_links: caseLinks, projection_warnings: itemWarnings }
    })
    const counts = Object.fromEntries(Object.keys(BEHAVIOR_STATUS_LABELS).map(status => [status, items.filter(item => item.status === status).length]))
    return [{ ...body, unit_id: unitId, projection_id: note.projection_id ?? `coverage-note-${noteIndex}`,
      source_record: note.source_record, items, declared_counts: { ...counts, unclassified: items.filter(item => !Object.hasOwn(BEHAVIOR_STATUS_LABELS, item.status)).length },
      projection_warnings: warnings }]
  })
}

export function behaviorCoverageForCase(ledgers, testCase) {
  return array(ledgers).flatMap(ledger => array(ledger.items).filter(item => array(item.case_links).some(link => link.target_case_id === testCase.test_case_id))
    .map(item => ({ unit_id: ledger.unit_id, item_id: item.item_id, operation: item.operation, status: item.status,
      case_refs: array(item.case_refs).filter(ref => [testCase.case_id, testCase.display_id, testCase.test_case_id].includes(ref?.case_id)) })))
}
