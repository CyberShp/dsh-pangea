export const CASE_TYPE_LABELS = {
  business_blackbox: '业务黑盒', developer_assisted: '业务灰盒',
  interface_contract: '接口契约', whitebox_support: '白盒辅助',
  positive: '正向验证', negative: '反向验证', boundary: '边界验证',
  functional: '功能验证', performance: '性能验证', recovery: '恢复验证',
  concurrency: '并发验证', robustness: '健壮性验证', security: '安全验证',
  branch: '业务分支', coverage: '覆盖率补测', risk: '风险验证',
}

export const REVIEW_LABELS = Object.freeze({ unreviewed: '未评审', adopted: '已采纳', excluded: '暂不采纳', needs_recheck: '需重新评审' })

export function caseIdentity(item) {
  const id = item?.projection_id || item?.test_case_id
  return typeof id === 'string' && id.trim() ? id : null
}

// Display only: keep malformed authored fields available without inventing a
// case title or repairing identity from an embedded record.
export function caseTitlePresentation(item) {
  const original = item?.title
  const unavailable = () => ({ title: '用例记录（标题待核对）', issue: '标题格式需核对', original })
  const fromRecord = value => value && typeof value === 'object' && !Array.isArray(value)
    && Object.hasOwn(value, 'title') && typeof value.title === 'string' && value.title.trim()
    ? { title: value.title, issue: '', original }
    : unavailable()
  if (typeof original !== 'string') return fromRecord(original)
  const text = original.trim()
  if (!text) return unavailable()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text)
  // Bracketed labels such as "[TLS] 握手失败" are ordinary titles.
  const structured = fenced || /^\{|^\[\s*(?:[\[{"\]\d-]|true\b|false\b|null\b|$)|^```json\b/i.test(text)
  if (!structured) return { title: original, issue: '', original }
  try { return fromRecord(JSON.parse(fenced ? fenced[1] : text)) } catch { return unavailable() }
}

export function caseRecordParseNotice(item) {
  const state = item?.record_parse
  if (!['recovered', 'invalid'].includes(state?.status)) return null
  return state.status === 'recovered'
    ? { summary: '原文格式异常 · 已恢复读取', detail: '原始用例记录有一处括号格式错误，读取时已恢复标题与完整字段。原始记录保持不变，可在下方查看。' }
    : { summary: '原始记录无法解析', detail: '原始用例记录存在格式错误，无法可靠读取结构化字段。请查看下方原文和解析说明。' }
}

export function filterTestCases(items = [], filters = {}, reviews = {}) {
  const query = String(filters.query ?? '').trim().toLocaleLowerCase()
  return items.filter(item => {
    const review = reviews[caseIdentity(item)]?.review_status ?? 'unreviewed'
    return (!query || JSON.stringify(item).toLocaleLowerCase().includes(query))
      && (!filters.unit || item.unit_id === filters.unit)
      && (!filters.type || (item.case_type || item.test_level || 'unclassified') === filters.type)
      && (!filters.readiness || (['ready', 'needs_setup'].includes(item.readiness) ? item.readiness : 'unclassified') === filters.readiness)
      && (!filters.review || review === filters.review)
  })
}

export function reviewProjection(items = [], decisions = {}, hashes = {}) {
  const counts = { unreviewed: 0, adopted: 0, excluded: 0, needs_recheck: 0 }
  const frequencies = new Map()
  for (const item of items) { const id = caseIdentity(item); if (id) frequencies.set(id, (frequencies.get(id) || 0) + 1) }
  const cases = items.map(item => {
    const key = caseIdentity(item), valid = key && frequencies.get(key) === 1
    const saved = valid ? decisions[key] : null
    const review_status = !saved ? 'unreviewed' : saved.content_hash === hashes[key] ? saved.decision : 'needs_recheck'
    counts[review_status] += 1
    return { case_key: valid ? key : null, content_hash: valid ? hashes[key] : null, review_status,
      decision: saved?.decision ?? null, updated_at: saved?.updated_at ?? null }
  })
  return { cases, counts }
}

// Versioned records select one authored field, including intentional emptiness.
// Unknown/legacy records retain their original precedence; never merge aliases.
export function caseField(item, canonical, legacy) {
  return item?.format_version === 'behavior-test-case-v1'
    ? item[canonical]
    : item?.[legacy] ?? item?.[canonical]
}
