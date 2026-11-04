// Read-only presentation of authored associations. Planned coverage references
// never constitute observed coverage or proof that a case has been executed.
const array = value => Array.isArray(value) ? value : []
const list = value => value == null ? [] : Array.isArray(value) ? value : [value]
const object = value => value != null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && value.trim() !== ''
const bodyOf = item => {
  const body = item?.source_record?.body
  if (object(body)) return body
  if (typeof body === 'string') { try { const parsed = JSON.parse(body); return object(parsed) ? parsed : {} } catch {} }
  return {}
}
const identities = row => [row?.evidence_id, row?.chunk_id, row?.projection_id, row?.record_id, row?.display_id, row?.source_record?.record_id].filter(text)

function validLocation(value, structuredPath = false) {
  if (!text(value) || (structuredPath ? /[\r\n\t]/.test(value) : /\s/.test(value)) || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false
  const match = /^(.*)#L(\d+)(?:-L?(\d+))?$/i.exec(value) ?? /^(.*):(\d+)(?:-(\d+))?$/.exec(value)
  const source = match?.[1] ?? value
  if (match) {
    const start = Number(match[2]), end = Number(match[3] ?? match[2])
    if (!Number.isSafeInteger(start) || start < 1 || !Number.isSafeInteger(end) || end < start) return false
  } else if (/#|:\d/.test(source)) return false
  return /[/\\]/.test(source) || /\.[a-z0-9_-]+$/i.test(source)
}

function sourceLocation(value, structuredPath = false) {
  if (validLocation(value, structuredPath)) return value
  if (structuredPath || typeof value !== 'string') return null
  // Historical records append a short parenthesized explanation to an exact
  // repo:path:line[-end] reference. Keep that text as the displayed location;
  // only the strictly parsed prefix is suitable for the source API.
  const annotated = /^([^\s]+)[ \t]+(\([\s\S]*\))$/.exec(value)
  if (!annotated) return null
  const annotation = annotated[2]
  if (/[\r\n\v\f\u0085\u2028\u2029]/.test(annotation) || !annotation.slice(1, -1).trim()) return null
  let depth = 0
  for (let index = 0; index < annotation.length; index++) {
    if (annotation[index] === '(') depth++
    else if (annotation[index] === ')') depth--
    // Exactly one outer annotation may follow the source prefix. Nested calls
    // such as sizeof(*challenge) stay literal; later segments are not consumed.
    if (depth < 0 || (depth === 0 && index !== annotation.length - 1)) return null
  }
  if (depth !== 0) return null
  const explicit = /^([^:/\\()\s]+):([^:()\s]+):(\d+)(?:-(\d+))?$/.exec(annotated[1])
  if (!explicit || ['.', '..'].includes(explicit[1]) || /^[\\/]/.test(explicit[2])
    || /(?:^|[\\/])\.{1,2}(?:[\\/]|$)/.test(explicit[2]) || !validLocation(annotated[1])) return null
  return annotated[1]
}

function locationOf(ref) {
  if (typeof ref === 'string') return ref
  if (!object(ref)) return null
  if (text(ref.location)) return ref.location
  if (!text(ref.path)) return null
  const prefix = text(ref.repo_id) ? `${ref.repo_id}:` : ''
  const start = ref.line_start ?? ref.line
  const end = ref.line_end
  // Never repair ranges, infer a repository or turn a missing line into line 1.
  if (start == null && end == null) return `${prefix}${ref.path}`
  if (!Number.isSafeInteger(start) || start < 1 || (end != null && (!Number.isSafeInteger(end) || end < start))) return null
  return `${prefix}${ref.path}:${start}${end != null ? `-${end}` : ''}`
}

export function caseEvidenceProjection(item, evidence = [], coverageGaps) {
  const body = bodyOf(item), items = [], unresolved = []
  const fields = [['evidence', item?.evidence], ['source_evidence', item?.source_evidence],
    ['source_record.evidence', item?.source_record?.evidence], ['source_record.body.evidence', body.evidence],
    ['source_record.body.source_evidence', body.source_evidence]]
  // Standalone evidence may use explicit record-envelope links in either
  // direction. Do not walk links through risks/flows or match titles.
  const matchesRef = (owner, reference, target) => {
    const id = typeof reference === 'string' ? reference : reference?.record_id
    const unit = object(reference) ? reference.unit_id ?? owner?.unit_id : owner?.unit_id
    return text(id) && ((id === target?.projection_id && id.includes('/'))
      || (text(unit) && unit === target?.unit_id && id === target?.source_record?.record_id))
  }
  const standalone = array(evidence).filter(row => ['evidence', 'blackbox_translation'].includes(row?.source_record?.kind))
  const related = standalone.filter(row => list(item?.source_record?.relates_to).some(ref => matchesRef(item, ref, row))
    || list(row.source_record.relates_to).some(ref => matchesRef(row, ref, item)))
  fields.push(['related_evidence', related])
  // Coverage-input locations are planned targets, never observed execution.
  for (const ref of caseCoverageBasisProjection(item, coverageGaps).references) {
    if (ref.status !== 'matched') continue
    const row = ref.matches[0]
    const explicit = [...list(row.source_evidence), ...list(row.evidence), ...list(row.matches)]
    if (text(row.location) || text(row.path)) explicit.push(row)
    fields.push([`coverage_refs:${ref.coverage_id}`, explicit])
  }
  const originals = [...list(item?.source_evidence), ...list(item?.source_record?.evidence),
    ...list(body.evidence), ...list(body.source_evidence)]
  const isRedundantAdapter = reference => object(reference) && text(item?.projection_id)
    && reference.projection_id === item.projection_id
    && reference.unit_id === item.unit_id
    && reference.source_record?.record_id === item.source_record?.record_id
    && ['test_case', 'test_case_group'].includes(reference.source_record?.kind)
    && typeof reference.chunk_id === 'string'
    && reference.chunk_id.startsWith(`${item.projection_id}/evidence-`)
    && /^\d+$/.test(reference.chunk_id.slice(`${item.projection_id}/evidence-`.length))
    && originals.some(original => {
      const location = locationOf(original)
      const structuredPath = object(original) && !text(original.location) && text(original.path)
      const observation = object(original) ? original.observation ?? original.note ?? '' : ''
      return sourceLocation(location, structuredPath) && location === reference.location
        && (observation || item.title) === reference.observation
        && (!text(reference.quote) || reference.quote === original?.quote)
        && (!text(reference.evidence_id) || reference.evidence_id === original?.evidence_id)
    })
  for (const [field, values] of fields) for (const [index, reference] of list(values).entries()) {
    if (field === 'evidence' && isRedundantAdapter(reference)) continue
    const origin = { field, index, reference }
    const refId = object(reference) ? reference.evidence_id ?? reference.chunk_id ?? reference.record_id : reference
    const scopedUnit = object(reference) ? reference.unit_id ?? item?.unit_id : item?.unit_id
    const matches = text(refId) ? array(evidence).filter(row => identities(row).includes(refId)
      && (text(scopedUnit) ? row.unit_id === scopedUnit || row.unit_id == null : row.unit_id == null)) : []
    const direct = object(reference) && (text(reference.location) || text(reference.path))
    if (!direct && matches.length > 1) { unresolved.push({ ...origin, issue: '证据编号不唯一。' }); continue }
    const resolved = !direct && matches.length === 1 ? matches[0] : reference
    const location = locationOf(resolved)
    const source_location = sourceLocation(location, object(resolved) && !text(resolved.location) && text(resolved.path))
    // A bare record identifier is not a file path. Preserve it for inspection.
    if (!source_location) {
      unresolved.push({ ...origin, issue: '未提供可定位的源码位置或无法解析证据引用。' }); continue
    }
    const evidenceId = identities(resolved)[0] ?? (matches.length ? refId : null)
    const observation = object(resolved) ? resolved.observation ?? resolved.note ?? '' : ''
    const quote = object(resolved) ? resolved.quote ?? '' : ''
    // Keep distinct IDs, quotes and observations, even when locations coincide.
    const key = JSON.stringify([evidenceId, location, observation, quote])
    const existing = items.find(row => row.key === key)
    if (existing) { existing.origins.push(origin); continue }
    items.push({ ...(object(resolved) ? resolved : {}), key, evidence_id: evidenceId, location, source_location,
      observation, quote, reference, origins: [origin] })
  }
  return { items, unresolved }
}

export function caseCoverageBasisProjection(item, coverageGaps) {
  const raw = item?.coverage_refs ?? bodyOf(item).coverage_refs
  const validContainer = raw == null || Array.isArray(raw)
  const available = Array.isArray(coverageGaps)
  const references = list(raw).map(reference => {
    const id = typeof reference === 'string' ? reference : reference?.coverage_id
    const matches = text(id) && available ? coverageGaps.filter(row => row && (row.coverage_id ?? row.gap_id) === id) : []
    const status = !validContainer || !text(id) ? 'invalid' : !available ? 'unavailable' : matches.length > 1 ? 'ambiguous' : matches.length === 1 ? 'matched' : 'unresolved'
    return { reference, coverage_id: text(id) ? id : null, matches, status, association: 'planned' }
  })
  return { association: 'planned', raw, references, available, valid_container: validContainer,
    summary: item?.summary ?? bodyOf(item).summary ?? null,
    disclaimer: '仅表示拟覆盖关联，不代表实际覆盖、已执行或验证通过。' }
}

export function caseFeasibilityProjection(item) {
  const body = bodyOf(item)
  const declared = item?.execution_readiness ?? body.execution_readiness ?? item?.readiness ?? body.readiness
  const status = declared === 'ready' ? 'ready' : ['needs_setup', 'needs_instrumentation'].includes(declared) ? 'needs_setup' : 'unknown'
  return { status, declared_status: declared ?? null,
    label: status === 'ready' ? '具备执行条件' : status === 'needs_setup' ? '待补执行条件' : '执行条件未知',
    reason: item?.readiness_reason ?? body.readiness_reason ?? null,
    missing_conditions: list(item?.missing_execution_conditions ?? body.missing_execution_conditions),
    test_level: item?.test_level ?? body.test_level ?? item?.case_type ?? null,
    entry: item?.entry ?? body.entry ?? null,
    source_evidence: item?.source_evidence ?? body.source_evidence ?? null,
    execution_status: item?.execution_status ?? body.execution_status ?? null,
    disclaimer: '执行条件声明不代表已经执行或验证通过。' }
}

export function caseFeasibilitySummary(quality) {
  const source = object(quality) ? quality : {}
  const countFields = ['business_blackbox', 'ready_blackbox', 'developer_assisted', 'ready_graybox', 'ready_cases', 'total_cases']
  const counts = Object.fromEntries(countFields.map(key => [key,
    Number.isSafeInteger(source[key]) && source[key] >= 0 ? source[key] : null]))
  const ratio = typeof source.ready_ratio === 'number' && Number.isFinite(source.ready_ratio)
    && source.ready_ratio >= 0 && source.ready_ratio <= 1 ? source.ready_ratio : null
  return { ...counts, ready_ratio: source.has_legacy_groups === true ? null : ratio,
    blackbox_target: typeof source.blackbox_target === 'boolean' ? source.blackbox_target : null,
    blackbox_target_reason: source.blackbox_target_reason ?? null,
    has_legacy_groups: typeof source.has_legacy_groups === 'boolean' ? source.has_legacy_groups : null,
    status: object(quality) ? 'reported' : 'unknown', source_summary: quality ?? null,
    disclaimer: '这里只展示执行条件声明，不代表实际执行通过率；未提供的指标保持未知。' }
}
