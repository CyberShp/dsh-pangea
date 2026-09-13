import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { sourceFirstProjection } from './source-first-projection.js'

const STEP_TITLES = [
  '范围和任务契约',
  '输入材料消费和运行计划',
  '广度盘点和模块地图',
  '开发给测试讲代码',
  '多源场景增殖和风险解释',
  'SFMEA 和黑盒翻译',
  '测试场景、流程和用例设计',
  '独立审查',
  '正式交付',
]

const SOURCE_FIRST_STAGES = [
  ['preparing', '准备冻结输入'],
  ['planning', 'Planning 单元划分'],
  ['analyzing', '源码区域分析'],
  ['reviewing', '盲审与同会话对照'],
  ['closing', '定向 closure'],
  ['reporting', '报告组装'],
  ['complete', '已完成'],
]

async function pathKind(filePath) {
  try {
    const details = await stat(filePath)
    if (details.isFile()) return 'file'
    if (details.isDirectory()) return 'directory'
    return 'other'
  } catch (error) {
    if (error?.code === 'ENOENT') return 'missing'
    throw error
  }
}

async function readJson(filePath) {
  const source = await readFile(filePath, 'utf8')
  return JSON.parse(source.charCodeAt(0) === 0xFEFF ? source.slice(1) : source)
}

async function readTextIfFile(filePath) {
  return await pathKind(filePath) === 'file' ? readFile(filePath, 'utf8') : ''
}

function markdownSection(markdown, title) {
  const start = markdown.match(new RegExp(`^(#{1,6})\\s+${title}\\s*$`, 'm'))
  if (!start || start.index === undefined) return ''
  const bodyStart = start.index + start[0].length
  const remaining = markdown.slice(bodyStart)
  const end = remaining.search(new RegExp(`^#{1,${start[1].length}}\\s+`, 'm'))
  return (end === -1 ? remaining : remaining.slice(0, end)).trim()
}

function bulletItems(markdown, pattern = /^[-*]\s+(.+)$/) {
  return markdown.split(/\r?\n/).map(line => line.trim().match(pattern)?.[1]?.trim()).filter(Boolean)
}

function prefixedIds(value, prefix) {
  const result = []
  const expression = new RegExp(`\\b${prefix}-(\\d+)((?:[,/]\\d+)*)`, 'g')
  for (const match of value.matchAll(expression)) {
    result.push(`${prefix}-${match[1]}`)
    for (const suffix of match[2].matchAll(/[,/](\d+)/g)) result.push(`${prefix}-${suffix[1]}`)
  }
  return [...new Set(result)]
}

function tableRows(markdown) {
  return markdown.split(/\r?\n/)
    .filter(line => /^\s*\|/.test(line) && !/^\s*\|[\s:-]+\|/.test(line))
    .map(line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()))
}

function riskSeverityById(markdown) {
  const result = new Map()
  const severity = { P0: 'Critical', P1: 'High', P2: 'Medium', P3: 'Low' }
  for (const cells of tableRows(markdown)) {
    const id = cells[0]?.match(/\b((?:RP|R)(?:-[A-Z0-9]+)+)\b/i)?.[1]
    const level = cells.find(cell => /^P[0-3]$/.test(cell))
    if (id && level) result.set(id, severity[level])
  }
  return result
}

function canonicalSeverity(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return ({
    p0: 'Critical', critical: 'Critical', '严重': 'Critical',
    p1: 'High', high: 'High', '高': 'High',
    p2: 'Medium', medium: 'Medium', '中': 'Medium',
    p3: 'Low', low: 'Low', '低': 'Low',
  })[normalized] ?? null
}

function uniqueStrings(...values) {
  return [...new Set(values.flat().filter(value => typeof value === 'string' && value.trim() !== '').map(value => value.trim()))]
}

function traceabilityByCase(markdown) {
  const result = new Map()
  for (const cells of tableRows(markdown)) {
    const caseId = cells[0]?.match(/\b([A-Z0-9]+(?:-[A-Z0-9]+)+)\b/i)?.[1]
    if (!caseId) continue
    const row = cells.join(' | ')
    const exact = [...row.matchAll(/\b((?:RP|R)(?:-[A-Z0-9]+)+)\b/gi)].map(match => match[1])
    result.set(caseId, uniqueStrings(exact, prefixedIds(row, 'RP'), prefixedIds(row, 'R')))
  }
  return result
}

function parseRisks(markdown, severityById, riskCases) {
  const headings = [...markdown.matchAll(/^###\s+((?:RP|R)(?:-[A-Z0-9]+)+)\s*(?:[：:]|[—–]|\s-\s)\s*(.+)$/gmi)]
  const labels = new Map([
    ['条件', 'trigger'], ['什么条件发生', 'trigger'],
    ['代码失效', 'system_result'], ['代码内部哪里失效', 'system_result'],
    ['残留', 'residual_effect'], ['状态/数据留下什么', 'residual_effect'], ['状态/资源/数据留下什么问题', 'residual_effect'],
    ['看似正常', 'apparent_normality'], ['为什么看似正常', 'apparent_normality'], ['为什么当前操作可能仍看似正常', 'apparent_normality'],
    ['暴露', 'external_observation'], ['何时对外暴露', 'external_observation'], ['什么时候对外暴露', 'external_observation'],
    ['黑盒证明', 'blackbox_proof'], ['黑盒如何证明', 'blackbox_proof'],
  ])
  return headings.map(heading => {
    const riskId = heading[1]
    const tail = markdown.slice(heading.index + heading[0].length)
    const nextHeading = tail.search(/^#{1,3}\s+/m)
    const section = (nextHeading === -1 ? tail : tail.slice(0, nextHeading)).trim()
    const causal = {}
    let activeField = null
    for (const line of section.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || /^```/.test(trimmed)) continue
      const match = trimmed.replace(/^[-*]\s*/, '').replace(/^→\s*/, '').match(/^(?:\*\*)?(.+?)(?:\*\*)?[：:]\s*(.*)$/)
      const field = match ? labels.get(match[1].trim()) : null
      if (field) {
        activeField = field
        causal[field] = match[2].trim()
      } else if (match || /^[-*]\s+\*\*/.test(trimmed)) {
        activeField = null
      } else if (activeField) {
        causal[activeField] = [causal[activeField], trimmed].filter(Boolean).join('\n')
      }
    }
    const linkedTestCaseIds = riskCases.get(riskId) ?? []
    const severity = canonicalSeverity(severityById.get(riskId))
    return {
      risk_id: riskId,
      title: heading[2].replace(/（.*$/, '').trim(),
      severity,
      severity_source: severity ? 'sfmea' : null,
      translation_status: linkedTestCaseIds.length ? 'Test-ready' : 'Uncovered',
      trigger: causal.trigger ?? '',
      system_result: causal.system_result ?? '',
      residual_effect: causal.residual_effect ?? '',
      apparent_normality: causal.apparent_normality ?? '',
      external_observation: causal.external_observation ?? '',
      blackbox_proof: causal.blackbox_proof ?? '',
      source_section: section,
      linked_test_case_ids: linkedTestCaseIds,
      evidence: [],
    }
  })
}

const CASE_FIELDS = {
  preconditions: ['前置条件', '前置'],
  steps: ['操作步骤', '执行步骤', '步骤', '操作', '输入'],
  expected_results: ['预期结果和 Oracle', '预期结果 Oracle', '预期接口结果', '预期结果', '期望结果（Oracle）', '预期结果（Oracle）', '期望结果', '预期'],
  observability: ['观测方式', '观察点', '观测', '观测点'],
  cleanup: ['清理或恢复', '清理/恢复', '清理和复原', '清理步骤', '清理动作', '清理', '恢复'],
}

function parseTestCase(markdown, linkedRiskIds) {
  const heading = markdown.match(/^#{1,6}\s+([A-Z0-9]+(?:-[A-Z0-9]+)+)(?:[：:]\s*|\s+)(.+)$/mi)
  if (!heading) return null
  const metadata = markdownSection(markdown, '用例定位').replaceAll('**', '')
  const value = label => metadata.match(new RegExp(`^-\\s+${label}[：:]\\s*(.+)$`, 'm'))?.[1]?.trim() ?? ''
  const aliases = Object.values(CASE_FIELDS).flat()
  const labels = [...aliases, '后续业务验证', '后续', '故障注入', '注入'].sort((a, b) => b.length - a.length).map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const fields = new Map()
  let activeLabel = null
  let sectionLevel = null
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.replaceAll('**', '').trim()
    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (heading && (sectionLevel === null || heading[1].length <= sectionLevel)) {
      activeLabel = aliases.includes(heading[2]) ? heading[2] : null
      sectionLevel = activeLabel ? heading[1].length : null
      continue
    }
    // Inside an explicit Markdown field, words such as “前置：” are content.
    // Only a peer/parent heading closes that field; inline syntax is for compact cases.
    if (sectionLevel !== null) {
      if (trimmed && !/^[-*_]{3,}$/.test(trimmed)) fields.set(activeLabel, [...(fields.get(activeLabel) ?? []), trimmed.replace(/^(?:[-*]|\d+[.)、])\s*/, '')])
      continue
    }
    const expression = new RegExp(`(?:^|\\s)(?:[-*]\\s+)?(${labels})(（[^）]*）|\\([^)]*\\))?[：:]\\s*(.*?)(?=\\s+(?:${labels})(?:（[^）]*）|\\([^)]*\\))?[：:]|$)`, 'g')
    const matches = [...line.replaceAll('**', '').matchAll(expression)]
    for (const match of matches) {
      const value = match[3].trim()
      fields.set(match[1], [...(fields.get(match[1]) ?? []), ...(value ? [(match[2] ?? '') + value] : [])])
      activeLabel = match[1]
    }
    if (!matches.length) {
      const trimmed = line.replaceAll('**', '').trim()
      const subheading = trimmed.match(/^#{1,6}\s+(.+)$/)
      if (subheading) activeLabel = aliases.includes(subheading[1]) ? subheading[1] : null
      else if (activeLabel && trimmed && !/^[-*_]{3,}$/.test(trimmed)) fields.set(activeLabel, [...(fields.get(activeLabel) ?? []), trimmed.replace(/^(?:[-*]|\d+[.)、])\s*/, '')])
      else if (trimmed) activeLabel = null
    }
  }
  const items = (title, aliases, pattern) => {
    const values = aliases.map(label => fields.get(label) ?? []).find(values => values.length)
    if (values) return values
    const section = bulletItems(markdownSection(markdown, title), pattern)
    return section
  }
  return {
    test_case_id: heading[1],
    title: heading[2].trim(),
    case_type: value('测试类型'),
    priority: value('优先级'),
    linked_risk_ids: linkedRiskIds,
    preconditions: items('前置条件', CASE_FIELDS.preconditions),
    steps: items('操作步骤', CASE_FIELDS.steps, /^\d+[.)、]\s*(.+)$/),
    expected_results: items('预期结果和 Oracle', CASE_FIELDS.expected_results),
    observability: items('观察点', CASE_FIELDS.observability),
    cleanup: items('清理和复原', CASE_FIELDS.cleanup),
  }
}

export function parseTestCases(markdown, traceability = new Map(), knownIds = []) {
  markdown = markdown.replace(/^\s*(`{3,}|~{3,}).*?^\s*\1\s*$/gms, '')
  const headings = [...markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)]
  const cases = headings.flatMap((heading, index) => {
    const caseId = heading[2].match(/^([A-Z0-9]+(?:-[A-Z0-9]+)+)(?=[：:\s])/i)?.[1]
    if (!caseId || (!/^TC-/i.test(caseId) && !knownIds.includes(caseId))) return []
    const end = headings.slice(index + 1).find(next => next[1].length <= heading[1].length)?.index ?? markdown.length
    const parsed = parseTestCase(markdown.slice(heading.index, end), traceability.get(caseId) ?? traceability.get(caseId.slice(3)) ?? [])
    return parsed ? [parsed] : []
  })
  const byId = new Map(cases.map(item => [item.test_case_id, item]))
  let columns = []
  for (const row of tableRows(markdown)) {
    if (row.some(cell => /^(?:用例 ID|用例ID|Case ID)$/i.test(cell))) { columns = row; continue }
    const field = (...names) => row[columns.findIndex(column => names.includes(column))] ?? ''
    const id = field('用例 ID', '用例ID', 'Case ID')
    if ((!/^TC-[A-Z0-9-]+$/i.test(id) && !knownIds.includes(id)) || byId.has(id)) continue
    const values = (...names) => { const text = field(...names); return text ? [text] : [] }
    byId.set(id, {
      test_case_id: id, title: field('名称', '标题', '用例名称'),
      case_type: field('类型', '测试类型'), priority: field('优先级'),
      linked_risk_ids: uniqueStrings(traceability.get(id) ?? [], prefixedIds(field('关联风险'), 'R'), prefixedIds(field('关联风险'), 'RP')),
      ...Object.fromEntries(Object.entries(CASE_FIELDS).map(([key, names]) => [key, values(...names)])),
    })
  }
  return [...byId.values()]
}

function deliveryIntegrity(projected, formalCases, formalPath) {
  const byId = new Map(formalCases.map(item => [item.test_case_id, item]))
  const issues = []
  for (const item of projected) {
    const detail = byId.get(item.test_case_id) ?? byId.get(`TC-${item.test_case_id}`)
    const missing = Object.keys(CASE_FIELDS).filter(field => !detail?.[field]?.some(value => typeof value === 'string' && value.trim()))
    if (missing.length) issues.push({ test_case_id: item.test_case_id, missing_fields: missing })
  }
  return { status: issues.length ? 'incomplete' : 'complete', expected_count: projected.length, complete_count: projected.length - issues.length, issues, repair_path: formalPath }
}

async function semanticReview(runDirectory) {
  const file = path.join(runDirectory, '内部索引/独立审查状态.json')
  if (await pathKind(file) !== 'file') return { method: 'not_recorded', verdict: null, summary: '' }
  try {
    const value = await readJson(file)
    return {
      method: value.independent === true ? 'independent_declared' : value.independent === false ? 'self_review' : 'not_recorded',
      verdict: ['PASS', 'UNRESOLVED'].includes(value.semantic_verdict) ? value.semantic_verdict : null,
      summary: typeof value.summary === 'string' ? value.summary : '',
      producer_session_id: value.producer_session_id ?? null,
      reviewer_session_id: value.reviewer_session_id ?? null,
      evidence_status: 'agent_declared',
    }
  } catch { return { method: 'unavailable', verdict: null, summary: '审查记录不可读取' } }
}

async function readLiveDocumentDraft(runDirectory, state, manifest) {
  const completed = new Set(state?.completed_steps ?? [])
  const liveRoot = path.join(runDirectory, '活文档')
  const details = { risks: [], test_cases: [], evidence: [], business_flows: [], review_issues: [] }
  let stepId = null
  if (['module-five-stage', 'coverage-five-stage'].includes(manifest.workflow_id)) {
    details.flow_documents = await readFlowDocuments(runDirectory)
    details.business_flows = details.flow_documents.filter(item => item.flow).map(item => ({ ...item.flow, document_path: item.path, document_status: 'live_draft' }))
    details.risks = parseRisks(await readTextIfFile(path.join(liveRoot, '风险点与SFMEA.md')), new Map(), new Map())
    details.test_cases = parseTestCases(await readTextIfFile(path.join(liveRoot, '黑盒测试用例.md')), new Map())
    // New workflows publish explicitly; Markdown enriches details but never
    // guesses a publication state from text or a completed stage number.
    return { step_id: null, details }
  }
  if (completed.has('05')) {
    const risksMarkdown = await readTextIfFile(path.join(liveRoot, '14-风险点清单与因果说明.md'))
    const sfmeaMarkdown = await readTextIfFile(path.join(liveRoot, '15-SFMEA分析.md'))
    const traceabilityMarkdown = completed.has('07')
      ? await readTextIfFile(path.join(liveRoot, '18-测试追溯矩阵.md')) : ''
    const traceability = traceabilityByCase(traceabilityMarkdown)
    const riskCases = new Map()
    for (const [caseId, riskIds] of traceability) {
      for (const riskId of riskIds) riskCases.set(riskId, [...(riskCases.get(riskId) ?? []), caseId])
    }
    details.risks = parseRisks(risksMarkdown, riskSeverityById(sfmeaMarkdown), riskCases)
    if (details.risks.length > 0) stepId = '05'
    if (completed.has('07')) {
      const caseRoot = path.join(liveRoot, '测试设计')
      if (await pathKind(caseRoot) === 'directory') {
        for (const entry of (await readdir(caseRoot, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
          if (!entry.isFile() || !entry.name.endsWith('.md')) continue
          const markdown = await readFile(path.join(caseRoot, entry.name), 'utf8')
          details.test_cases.push(...parseTestCases(markdown, traceability))
        }
      }
      if (completed.has('09')) {
        const formalCases = await readTextIfFile(path.join(runDirectory, '正式输出/黑盒测试用例.md'))
        details.test_cases.push(...parseTestCases(formalCases, traceability))
      }
      if (details.test_cases.length > 0) stepId = '07'
    }
  }
  return { step_id: stepId, details }
}

export async function readFlowDocuments(runDirectory) {
  const folder = path.join(runDirectory, '活文档/流程讲解')
  const documents = []
  if (await pathKind(folder) !== 'directory') return documents
  const root = await realpath(folder)
  const relativeRoot = path.relative(await realpath(runDirectory), root)
  if (relativeRoot.startsWith('..') || path.isAbsolute(relativeRoot)) return documents
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const file = path.join(folder, entry.name)
    if (path.dirname(await realpath(file)) !== root) continue
    const text = await readTextIfFile(file)
    const item = { path: path.relative(runDirectory, file).split(path.sep).join('/'), title: entry.name, status: 'unparsed' }
    try {
      const blocks = [...text.matchAll(/^```pangea-flow\s*\n([\s\S]*?)^```\s*$/gm)]
      if (blocks.length === 1) {
        const flow = JSON.parse(blocks[0][1])
        if (typeof flow.flow_id === 'string' && typeof flow.title === 'string' && Array.isArray(flow.mainline_steps) && Array.isArray(flow.branches)
          && [...flow.mainline_steps, ...flow.branches].every(row => row && typeof row === 'object' && !Array.isArray(row))) Object.assign(item, { flow, status: 'parsed' })
      }
    } catch { /* Preserve the readable document while an Agent is still writing. */ }
    documents.push(item)
  }
  const ids = documents.filter(d => d.flow).map(d => d.flow.flow_id)
  for (const item of documents) if (item.flow && ids.filter(id => id === item.flow.flow_id).length > 1) {
    delete item.flow
    item.status = 'ambiguous'
  }
  return documents
}

export async function readInputMaterials(runDirectory) {
  const read = async file => { try { return await readJson(path.join(runDirectory, file)) } catch { return null } }
  const manifest = await read('inputs/assets/manifest.json')
  const consumption = await read('内部索引/输入材料索引.json')
  const assets = Array.isArray(manifest?.assets) ? manifest.assets : []
  const items = Array.isArray(consumption?.items) ? consumption.items : []
  const array = value => Array.isArray(value) ? value : []
  return assets.filter(asset => asset && typeof asset === 'object').map(asset => {
    const entries = items.filter(item => item && (item.asset_id === asset.asset_id || item.id === asset.asset_id
      || (typeof item.verified_path === 'string' && item.verified_path === asset.frozen_normalized_text_path)
      || (typeof item.raw_path === 'string' && item.raw_path === asset.frozen_source_path))
    )
    const item = entries.length === 1 ? entries[0] : null
    const ranges = array(item?.consumed_ranges)
    const links = [...array(item?.linked_flow_ids), ...array(item?.linked_risk_ids), ...array(item?.linked_test_case_ids)]
    const state = !item ? '已冻结，尚无唯一消费记录' : item.status === 'out_of_scope' ? '未采用'
      : ['blocked', 'unreadable'].includes(item.status) ? '材料读取受阻'
      : ranges.length && links.length ? '已记录引用，待核对分析证据' : ranges.length ? '已记录读取范围' : '消费记录尚未填写读取范围'
    return { ...asset, consumption: item, consumption_state: state, linked_ids: links }
  })
}

function normalizeProjectionDetails(projection, liveDetails) {
  const projectedRisks = Array.isArray(projection?.risks) ? projection.risks : []
  const projectedCases = Array.isArray(projection?.test_cases) ? projection.test_cases : []
  const projectedEvidence = Array.isArray(projection?.evidence) ? projection.evidence : []
  const liveRiskById = new Map((liveDetails?.risks ?? []).map(item => [item.risk_id, item]))
  const liveCaseById = new Map((liveDetails?.test_cases ?? []).map(item => [item.test_case_id, item]))
  const evidenceRiskIds = new Map()
  for (const risk of projectedRisks) {
    for (const evidenceId of uniqueStrings(risk?.evidence_ids ?? [])) {
      evidenceRiskIds.set(evidenceId, uniqueStrings(evidenceRiskIds.get(evidenceId) ?? [], risk.risk_id))
    }
  }
  const evidence = projectedEvidence.map(item => {
    const chunkId = item?.chunk_id ?? item?.evidence_id
    return {
      ...item,
      ...(chunkId ? { chunk_id: chunkId } : {}),
      observation: item?.observation ?? item?.narrative ?? '',
      risk_ids: uniqueStrings(item?.risk_ids ?? [], chunkId ? evidenceRiskIds.get(chunkId) ?? [] : []),
    }
  })
  const evidenceById = new Map()
  for (const item of evidence) {
    if (item.chunk_id) evidenceById.set(item.chunk_id, item)
    if (item.evidence_id) evidenceById.set(item.evidence_id, item)
  }
  const risks = projectedRisks.map(projected => {
    const live = liveRiskById.get(projected.risk_id) ?? {}
    const linkedTestCaseIds = uniqueStrings(projected.linked_test_case_ids ?? [], live.linked_test_case_ids ?? [])
    const evidenceIds = uniqueStrings(projected.evidence_ids ?? [])
    const directEvidence = Array.isArray(projected.evidence) ? projected.evidence : []
    const resolvedEvidence = [...directEvidence, ...evidenceIds.map(id => evidenceById.get(id)).filter(Boolean)]
    const deduplicatedEvidence = [...new Map(resolvedEvidence.map(item => [item?.chunk_id ?? item?.evidence_id ?? `${item?.location ?? ''}\u0000${item?.observation ?? item?.narrative ?? ''}`, item])).values()]
    const severityInput = projected.severity ?? live.severity
    const severity = canonicalSeverity(severityInput)
    const nonEmpty = (...values) => values.find(value => typeof value === 'string' && value.trim() !== '') ?? ''
    return {
      ...live,
      ...projected,
      severity,
      severity_raw: severity ? undefined : severityInput ?? null,
      severity_source: projected.severity !== undefined ? 'workbench_projection' : live.severity_source ?? null,
      narrative: nonEmpty(projected.narrative, projected.description, live.narrative, live.description),
      trigger: nonEmpty(projected.trigger, live.trigger),
      system_result: nonEmpty(projected.system_result, live.system_result),
      residual_effect: nonEmpty(projected.residual_effect, live.residual_effect),
      apparent_normality: nonEmpty(projected.apparent_normality, live.apparent_normality),
      external_observation: nonEmpty(projected.external_observation, live.external_observation),
      blackbox_proof: nonEmpty(projected.blackbox_proof, live.blackbox_proof),
      source_section: nonEmpty(projected.source_section, live.source_section),
      linked_test_case_ids: linkedTestCaseIds,
      evidence: deduplicatedEvidence,
      translation_status: projected.translation_status ?? (linkedTestCaseIds.length ? 'Test-ready' : 'Uncovered'),
    }
  })
  const testCases = projectedCases.map(projected => {
    const live = liveCaseById.get(projected.test_case_id) ?? liveCaseById.get(`TC-${projected.test_case_id}`) ?? {}
    const merged = { ...live, ...projected }
    delete merged.status
    if (projected.status !== undefined) merged.status = projected.status
    return {
      ...merged,
      case_type: projected.case_type ?? projected.type ?? live.case_type ?? '',
      priority: projected.priority ?? live.priority ?? '',
      linked_risk_ids: uniqueStrings(projected.linked_risk_ids ?? [], live.linked_risk_ids ?? []),
      preconditions: Array.isArray(projected.preconditions) && projected.preconditions.length ? projected.preconditions : live.preconditions ?? [],
      steps: Array.isArray(projected.steps) && projected.steps.length ? projected.steps : live.steps ?? [],
      expected_results: Array.isArray(projected.expected_results) && projected.expected_results.length ? projected.expected_results : live.expected_results ?? [],
      observability: Array.isArray(projected.observability) && projected.observability.length ? projected.observability : live.observability ?? [],
      cleanup: Array.isArray(projected.cleanup) && projected.cleanup.length ? projected.cleanup : live.cleanup ?? [],
    }
  })
  return {
    ...projection,
    flow_documents: liveDetails?.flow_documents ?? [],
    business_flows: [...(projection.business_flows ?? []).map(flow => {
      const live = liveDetails?.business_flows?.find(item => item.flow_id === flow.flow_id)
      return live && !flow.mainline_steps?.length ? { ...flow, ...live } : flow
    }), ...(liveDetails?.business_flows ?? []).filter(flow => !(projection.business_flows ?? []).some(item => item.flow_id === flow.flow_id))],
    risks,
    test_cases: testCases,
    evidence,
  }
}

async function readWorkbenchProjection(runDirectory, runId) {
  const projectionPath = path.join(runDirectory, '内部索引', '工作台投影.json')
  if (await pathKind(projectionPath) !== 'file') {
    return { status: 'legacy_unavailable', path: projectionPath, value: null, issues: ['缺少工作台结构化投影'] }
  }
  try {
    const value = await readJson(projectionPath)
    const issues = []
    if (!value || typeof value !== 'object' || Array.isArray(value)) issues.push('工作台投影必须是 JSON 对象')
    if (value?.schema_version !== '1.0') issues.push('工作台投影 schema_version 不受支持')
    if (value?.run_id !== runId) issues.push('工作台投影 run_id 与当前 Run 不一致')
    for (const key of ['business_flows', 'risks', 'test_cases', 'evidence', 'review_issues']) {
      if (!Array.isArray(value?.[key])) issues.push(`工作台投影缺少数组：${key}`)
    }
    return { status: issues.length ? 'invalid' : 'verified', path: projectionPath, value, issues }
  } catch (error) {
    return { status: 'invalid', path: projectionPath, value: null, issues: [`工作台投影解析失败：${error instanceof Error ? error.message : String(error)}`] }
  }
}

async function readSourceSnapshotManifest(runDirectory, runId, recordedSnapshot) {
  const manifestPath = path.join(runDirectory, 'inputs', 'source', 'manifest.json')
  if (await pathKind(manifestPath) !== 'file') return { status: 'legacy_unavailable', issues: [] }
  try {
    const manifest = await readJson(manifestPath)
    const issues = []
    if (manifest.run_id !== runId) issues.push('源码快照 run_id 与当前 Run 不一致')
    const files = manifest.files
    if (!Array.isArray(files) || files.length === 0) issues.push('源码快照清单没有文件')
    if (manifest.file_count !== files?.length) issues.push('源码快照 file_count 与清单不一致')
    for (const item of files ?? []) {
      if (!item?.path || !Number.isInteger(item.size) || item.size < 0) { issues.push('源码快照清单包含非法文件项'); continue }
      const relative = path.normalize(item.path)
      if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) issues.push(`源码快照路径越界：${item.path}`)
    }
    if (Number.isInteger(recordedSnapshot?.file_count) && recordedSnapshot.file_count !== manifest.file_count) issues.push('源码快照文件数与 Run 元数据不一致')
    return { status: issues.length ? 'invalid' : 'frozen', issues, manifest }
  } catch (error) {
    return { status: 'invalid', issues: [error instanceof Error ? error.message : String(error)] }
  }
}

async function markdownFiles(root) {
  if (await pathKind(root) !== 'directory') return []
  const output = []
  const visit = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(candidate)
      else if (entry.isFile() && entry.name.endsWith('.md')) output.push(candidate)
    }
  }
  await visit(root)
  return output.sort()
}

async function findPangeaDataFrom(startPath) {
  let cursor = path.resolve(startPath)
  if (await pathKind(cursor) === 'file') cursor = path.dirname(cursor)
  for (let depth = 0; depth < 8; depth += 1) {
    const direct = path.basename(cursor) === 'pangea-data' ? cursor : path.join(cursor, 'pangea-data')
    if (await pathKind(path.join(direct, 'runs')) === 'directory') return direct
    const parent = path.dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  return undefined
}

export async function discoverPangeaDataRoot({ cwd, dataRoot } = {}) {
  if (dataRoot !== undefined) {
    if (typeof dataRoot !== 'string' || dataRoot.trim() === '') throw new TypeError('data_root must be a non-empty string')
    if (!path.isAbsolute(dataRoot)) throw new Error('data_root must be an absolute path')
    const resolved = path.resolve(dataRoot)
    if (await pathKind(path.join(resolved, 'runs')) !== 'directory') throw new Error(`PANGEA data_root does not contain runs/: ${resolved}`)
    return realpath(resolved)
  }
  if (typeof cwd !== 'string' || cwd.trim() === '') throw new Error('Cannot discover PANGEA data root without a workspace cwd or explicit data_root')
  const discovered = await findPangeaDataFrom(cwd)
  if (!discovered) throw new Error(`No pangea-data/runs directory found from workspace: ${cwd}`)
  return realpath(discovered)
}

function lifecycle(metadata, state) {
  if (metadata?.status === 'stopped') return { lifecycle_status: 'stopped', phase: 'STOPPED', terminal: true }
  if (!state) return { lifecycle_status: 'preparing', phase: 'PREPARING', terminal: false }
  if (state.status === 'complete') return { lifecycle_status: 'complete', phase: 'COMPLETE', terminal: true }
  if (state.status === 'validation_failed') return { lifecycle_status: 'attention_required', phase: 'INCOMPLETE', terminal: true }
  return { lifecycle_status: 'running', phase: `STEP_${state.current_step || 'BOOTSTRAP'}`, terminal: false }
}

async function resolveRunDirectory(dataRoot, runId, metadata) {
  const runsRoot = path.resolve(dataRoot, 'runs')
  const canonical = path.resolve(runsRoot, runId)
  if (await pathKind(canonical) === 'directory') return canonical

  if (typeof metadata?.run_root === 'string' && path.isAbsolute(metadata.run_root)) {
    const recorded = path.resolve(metadata.run_root)
    const relative = path.relative(runsRoot, recorded)
    const withinDataRoot = relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
    if (withinDataRoot && path.basename(recorded) === runId && await pathKind(recorded) === 'directory') return recorded
  }
  throw new Error(`Codetalks Skill run directory does not exist in data_root: ${runId}`)
}

function stepRows(state, liveDocuments, formalOutputs, manifest, runDirectory) {
  const completed = new Set(state?.completed_steps ?? [])
  const current = state?.current_step ?? null
  let ownership = new Map()
  {
    for (const step of manifest.steps ?? []) {
      for (const artifact of step.required ?? []) {
        const file = path.resolve(runDirectory, artifact.replace(/\\/g, '/'))
        ownership.set(file, String(step.id ?? '').padStart(2, '0'))
      }
    }
  }
  const definitions = manifest.steps?.length ? manifest.steps : STEP_TITLES.map((title, index) => ({ id: String(index + 1).padStart(2, '0'), title }))
  return definitions.map((definition, index) => {
    const step = definition.id
    const title = definition.title ?? STEP_TITLES[index] ?? step
    const status = completed.has(step) ? 'completed' : current === step ? 'running' : 'pending'
    const artifacts = step === definitions.at(-1).id
      ? formalOutputs
      : liveDocuments.filter(file => ownership.size > 0
        ? ownership.get(path.resolve(file)) === step || (definition.requires_glob ?? []).some(pattern => pattern === '活文档/流程讲解/流程-*.md' && path.basename(file).startsWith('流程-'))
        : path.basename(file).startsWith(step + '-'))
    return { step, title, status, artifacts }
  })
}

function inside(root, candidate) {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
}

function sourceFirstLifecycle(progress) {
  const lifecycleStatus = ['running', 'complete', 'stopped', 'failed'].includes(progress?.lifecycle_status)
    ? progress.lifecycle_status
    : 'running'
  const stage = typeof progress?.stage === 'string' && progress.stage.trim() !== ''
    ? progress.stage
    : 'preparing'
  const phase = lifecycleStatus === 'complete' ? 'COMPLETE'
    : lifecycleStatus === 'stopped' ? 'STOPPED'
      : lifecycleStatus === 'failed' ? 'FAILED'
        : stage.toUpperCase()
  return { lifecycle_status: lifecycleStatus, phase, terminal: lifecycleStatus !== 'running', stage }
}

function sourceFirstStepRows(progress, runDirectory, artifacts) {
  const life = sourceFirstLifecycle(progress)
  const currentIndex = Math.max(0, SOURCE_FIRST_STAGES.findIndex(([stage]) => stage === life.stage))
  const actionArtifacts = new Map()
  for (const item of artifacts) {
    const actionStage = item.stage ?? item.task?.review_stage ?? item.task?.task_type
    const stage = actionStage === 'unit_analysis' ? 'analyzing'
      : ['independent_review', 'comparison_review'].includes(actionStage) ? 'reviewing'
        : actionStage === 'targeted_closure' ? 'closing'
          : actionStage === 'unit_planning' || actionStage === 'source_first_plan' ? 'planning'
            : actionStage
    if (!stage) continue
    if (!actionArtifacts.has(stage)) actionArtifacts.set(stage, [])
    for (const file of [item.task_path, item.result_path]) {
      if (typeof file === 'string' && inside(runDirectory, file) && !actionArtifacts.get(stage).includes(file)) {
        actionArtifacts.get(stage).push(file)
      }
    }
  }
  const stageArtifactNames = {
    preparing: [path.join(runDirectory, 'inputs', 'task-contract.json')],
    planning: [
      path.join(runDirectory, 'inputs', 'source-manifest.json'),
      path.join(runDirectory, 'inputs', 'source-index.json'),
      path.join(runDirectory, 'inputs', 'source-first-plan.json'),
    ],
    reporting: [path.join(runDirectory, 'report.md'), path.join(runDirectory, 'report.html'), path.join(runDirectory, 'report-complete.json')],
    complete: [path.join(runDirectory, 'report.md'), path.join(runDirectory, 'report.html'), path.join(runDirectory, 'report-complete.json')],
  }
  return SOURCE_FIRST_STAGES.map(([stage, title], index) => {
    const status = life.lifecycle_status === 'complete'
      ? 'completed'
      : index < currentIndex
        ? 'completed'
        : index === currentIndex
          ? life.lifecycle_status === 'running' ? 'running' : life.lifecycle_status
          : 'pending'
    const stageArtifacts = [
      ...(stageArtifactNames[stage] ?? []),
      ...(actionArtifacts.get(stage) ?? []),
    ]
    return {
      step: String(index + 1).padStart(2, '0'),
      stage,
      title,
      status,
      artifacts: stageArtifacts.filter((file, position) => stageArtifacts.indexOf(file) === position),
    }
  })
}

async function sourceFirstActionArtifacts(runDirectory, progress) {
  const artifacts = []
  const issues = []
  for (const [actionId, action] of Object.entries(progress?.actions ?? {})) {
    if (!action || typeof action !== 'object') continue
    const recordedTaskPath = typeof action.task_path === 'string' ? path.resolve(action.task_path) : null
    const taskPath = recordedTaskPath && await pathKind(recordedTaskPath) === 'file' ? await realpath(recordedTaskPath) : recordedTaskPath
    if (!taskPath || !inside(runDirectory, taskPath) || await pathKind(taskPath) !== 'file') {
      issues.push(`source-first action task 不可读取：${actionId}`)
      continue
    }
    let task
    try { task = await readJson(taskPath) } catch (error) {
      issues.push(`source-first task JSON 不可读取：${actionId}：${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    const recordedResultPath = typeof task?.result_path === 'string' ? path.resolve(task.result_path) : null
    const resultPath = recordedResultPath && await pathKind(recordedResultPath) === 'file' ? await realpath(recordedResultPath) : recordedResultPath
    let result = null
    if (!resultPath || !inside(runDirectory, resultPath)) {
      issues.push(`source-first result_path 越出 Run：${actionId}`)
    } else if (await pathKind(resultPath) === 'file') {
      try { result = await readJson(resultPath) } catch (error) {
        issues.push(`source-first result JSON 不可读取：${actionId}：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    // Comparison reuses the reviewer session; its empty shell is initialized
    // before that session is bound. Only this exact live transition may wait.
    const awaitingBinding = result?.format_version === 'pangea-notes-v1'
      && progress.lifecycle_status === 'running'
      && action.stage === 'comparison_review'
      && ['pending', 'dispatched'].includes(action.status)
      && result.binding?.run_id === progress.run_id
      && result.binding?.action_id === actionId
      && result.binding?.task_id === 'pending'
      && result.revision === 0
      && Array.isArray(result.records) && result.records.length === 0
      && (result.completion === null || result.completion?.complete === false)
      && !Object.hasOwn(progress.accepted_revisions ?? {}, actionId)
    if (awaitingBinding) result = null
    if (result && (result.binding?.run_id !== progress.run_id || result.binding?.action_id !== actionId || (action.task_id && result.binding?.task_id !== action.task_id))) {
      issues.push(`source-first result 绑定与当前任务不一致：${actionId}`)
      result = null
    }
    if (result && action.status === 'accepted' && Number.isInteger(progress.accepted_revisions?.[actionId]) && result.revision !== progress.accepted_revisions[actionId]) {
      issues.push(`source-first result revision 与已接受版本不一致：${actionId}`)
      result = null
    }
    const records = Array.isArray(result?.records) ? result.records : []
    artifacts.push({
      action_id: actionId,
      ...action,
      binding_status: awaitingBinding ? 'pending' : 'bound',
      task,
      task_path: taskPath,
      result_path: resultPath,
      revision: Number.isInteger(result?.revision) ? result.revision : null,
      completion: result?.completion ?? null,
      records,
    })
  }
  return { artifacts, issues }
}

async function sourceFirstSnapshot(runDirectory, progress, contract, actionArtifacts) {
  const manifestPath = path.join(runDirectory, 'inputs', 'source-manifest.json')
  const indexPath = path.join(runDirectory, 'inputs', 'source-index.json')
  const issues = []
  let manifest = null
  let index = null
  if (await pathKind(manifestPath) !== 'file') issues.push('缺少冻结 source manifest')
  else {
    try { manifest = await readJson(manifestPath) } catch (error) { issues.push(`source manifest 不可读取：${error instanceof Error ? error.message : String(error)}`) }
  }
  if (await pathKind(indexPath) !== 'file') issues.push('缺少冻结 source index')
  else {
    try { index = await readJson(indexPath) } catch (error) { issues.push(`source index 不可读取：${error instanceof Error ? error.message : String(error)}`) }
  }
  if (manifest && manifest.workflow_version && manifest.workflow_version !== 'source-first-v1') {
    issues.push('source manifest workflow_version 与 source-first 不一致')
  }
  if (index && index.format_version !== 'pangea-source-index-v1') issues.push('source index format_version 不受支持')
  if (manifest?.source_index_path) {
    const recordedIndexPath = path.resolve(manifest.source_index_path)
    const canonicalRecordedIndexPath = await pathKind(recordedIndexPath) === 'file' ? await realpath(recordedIndexPath) : recordedIndexPath
    const canonicalIndexPath = await realpath(indexPath)
    if (canonicalRecordedIndexPath !== canonicalIndexPath) issues.push('source manifest 没有指向当前 Run 的 source index')
  }
  const fileCount = Number.isInteger(index?.file_count)
    ? index.file_count
    : Array.isArray(index?.files) ? index.files.length : null
  return {
    status: issues.length ? 'corrupt' : manifest && index ? 'manifest_verified' : 'legacy_unavailable',
    snapshot_digest: null,
    file_count: fileCount,
    issues,
    manifest_path: manifestPath,
    index_path: indexPath,
    repositories: Array.isArray(manifest?.repositories) ? manifest.repositories : [],
    requested_scope: Array.isArray(manifest?.requested_scope) ? manifest.requested_scope : [],
  }
}

export async function sourceFirstReportAvailable(runDirectory, lifecycleStatus) {
  return lifecycleStatus === 'complete'
    && await pathKind(path.join(runDirectory, 'report.md')) === 'file'
    && await pathKind(path.join(runDirectory, 'report.html')) === 'file'
    && await pathKind(path.join(runDirectory, 'report-complete.json')) === 'file'
}

async function summarizeSourceFirstRun(dataRoot, runId, { includeDetails = false } = {}) {
  const runDirectory = path.join(dataRoot, 'runs', runId)
  const progressPath = path.join(runDirectory, 'progress.json')
  const progress = await readJson(progressPath)
  const contractPath = path.join(runDirectory, 'inputs', 'task-contract.json')
  let contract = null
  if (await pathKind(contractPath) === 'file') {
    try { contract = await readJson(contractPath) } catch { contract = null }
  }
  const actionView = await sourceFirstActionArtifacts(runDirectory, progress)
  const projection = sourceFirstProjection(actionView.artifacts)
  const life = sourceFirstLifecycle(progress)
  const sourceSnapshot = await sourceFirstSnapshot(runDirectory, progress, contract, actionView.artifacts)
  const analysisActions = actionView.artifacts.filter(item => item.role === 'analysis')
  const acceptedAnalysis = analysisActions.filter(item => item.status === 'accepted')
  const reportMd = path.join(runDirectory, 'report.md')
  const reportHtml = path.join(runDirectory, 'report.html')
  const reportComplete = path.join(runDirectory, 'report-complete.json')
  const reportAvailable = await sourceFirstReportAvailable(runDirectory, life.lifecycle_status)
  const records = actionView.artifacts.map(item => ({
    action_id: item.action_id,
    action: item.action,
    role: item.role,
    stage: item.stage,
    task_id: item.task_id ?? null,
    unit_id: item.task?.unit_id ?? null,
    revision: item.revision,
    completion: item.completion,
    records: item.records,
  }))
  const workflow = {
    steps: sourceFirstStepRows(progress, runDirectory, actionView.artifacts),
    completed_steps: sourceFirstStepRows(progress, runDirectory, actionView.artifacts).filter(item => item.status === 'completed').map(item => item.step),
    current_step: life.stage,
    core_rules_ack: {},
    judge: { required: true, status: progress.stage === 'reviewing' || progress.stage === 'complete' ? 'running' : 'pending' },
    actions: actionView.artifacts.map(item => ({
      action_id: item.action_id,
      action: item.action,
      role: item.role,
      stage: item.stage,
      binding_status: item.binding_status,
      task_path: item.task_path,
      task_id: item.task_id ?? null,
      status: item.status,
      error: item.error ?? null,
      revision: item.revision,
      completion: item.completion,
      first_finish_revision: progress.first_finish_revisions?.[item.action_id] ?? null,
      accepted_revision: progress.accepted_revisions?.[item.action_id] ?? null,
    })),
    units: analysisActions.map(item => ({
      unit_id: item.task?.unit_id ?? item.action_id,
      title: item.task?.title ?? item.task?.unit_id ?? item.action_id,
      status: item.status,
      owned_regions: item.task?.owned_regions ?? [],
      context_regions: item.task?.context_regions ?? [],
    })),
    quality_checks: [],
    unresolved: [...(Array.isArray(progress.degradations) ? progress.degradations : []), ...(progress.blocking_reason ? [progress.blocking_reason] : [])],
    error_history: [...(Array.isArray(progress.errors) ? progress.errors : []), ...actionView.issues],
    step_progress: null,
  }
  const summary = {
    run_id: runId,
    workflow_version: progress.workflow_version ?? 'source-first-v1',
    scenario: contract?.analysis_settings?.scenario ?? 'module-analysis',
    mode: contract?.analysis_settings?.mode ?? null,
    analysis_settings: contract?.analysis_settings ?? null,
    runtime_provenance: contract?.runtime_provenance ?? null,
    publication: { state: reportAvailable ? 'final' : actionView.artifacts.some(a => a.records.length) ? 'draft' : 'pending', revision: null },
    delivery_integrity: { status: reportAvailable ? 'complete' : 'incomplete' },
    semantic_review: { verdict: progress.quality_status ?? null, method: 'graph_review' },
    ...life,
    target: contract?.target ?? runId,
    repository: contract?.repository ?? null,
    repositories: contract?.repositories ?? sourceSnapshot.repositories.map(item => item.repo_id).filter(Boolean),
    verdict: progress.quality_status ?? null,
    quality_status: progress.quality_status ?? null,
    needs_user: progress.needs_user === true,
    blocking_reason: progress.blocking_reason ?? null,
    first_finish_revisions: progress.first_finish_revisions ?? {},
    accepted_revisions: progress.accepted_revisions ?? {},
    attention_required: progress.needs_user === true || life.lifecycle_status === 'failed',
    analysis: {
      total: analysisActions.length,
      completed: acceptedAnalysis.length,
      reworked: 0,
      running: analysisActions.filter(item => ['dispatched', 'settled'].includes(item.status)).length,
      pending: analysisActions.filter(item => item.status === 'pending').length,
      submitted: analysisActions.filter(item => ['settled', 'accepted'].includes(item.status)).length,
      max_parallel: 8,
    },
    counts: Object.fromEntries(['risks', 'test_cases', 'evidence', 'business_flows'].map(key => [key, projection[key].length])),
    errors: Array.isArray(progress.errors) ? progress.errors : [],
    error_history: actionView.issues,
    review: {
      status: progress.stage === 'complete' || (progress.stage === 'reporting' && progress.quality_status) ? 'COMPLETE' : 'PENDING',
      summary: progress.quality_status ?? 'pending',
      issues: [],
      counts: { effective: null },
      independent: records.find(item => item.stage === 'independent_review') ?? null,
      comparison: records.find(item => item.stage === 'comparison_review') ?? null,
    },
    data_source: 'source-first-notes',
    reader_health: {
      status: sourceSnapshot.status === 'corrupt' || actionView.issues.length ? 'warning' : 'ok',
      trusted: sourceSnapshot.status !== 'corrupt' && actionView.issues.length === 0,
      data_source: 'source-first-notes',
      issues: [...sourceSnapshot.issues, ...actionView.issues],
      count_checks: {},
    },
    reader_notices: actionView.artifacts.filter(item => item.binding_status === 'pending').map(() => '复核准备中，正在绑定复核任务。'),
    reader_warnings: [...sourceSnapshot.issues, ...actionView.issues],
    artifacts: {
      run_directory: runDirectory,
      request: await pathKind(contractPath) === 'file' ? contractPath : null,
      state: progressPath,
      live_documents: [],
      formal_outputs: [],
      report_md: await pathKind(reportMd) === 'file' ? reportMd : null,
      report_html: await pathKind(reportHtml) === 'file' ? reportHtml : null,
      report_complete: await pathKind(reportComplete) === 'file' ? reportComplete : null,
      source_snapshot_manifest: await pathKind(sourceSnapshot.manifest_path) === 'file' ? sourceSnapshot.manifest_path : null,
      source_index: await pathKind(sourceSnapshot.index_path) === 'file' ? sourceSnapshot.index_path : null,
    },
    source_snapshot: sourceSnapshot,
    validation: { status: 'not_checked', error_count: 0, errors: [] },
    report_available: reportAvailable,
    modified_at: (await stat(runDirectory)).mtimeMs,
    source_first_records: records,
  }
  if (includeDetails) {
    summary.details = {
      ...projection,
      source_first_records: records,
    }
    summary.workflow = workflow
  }
  return summary
}

export async function summarizeRun(dataRoot, runId, { includeDetails = false } = {}) {
  if (typeof runId !== 'string' || runId.trim() === '' || path.basename(runId) !== runId || ['.', '..'].includes(runId)) {
    throw new Error('Codetalks Skill run_id must be one path segment')
  }
  const sourceFirstRunDirectory = path.join(dataRoot, 'runs', runId)
  const sourceFirstProgressPath = path.join(sourceFirstRunDirectory, 'progress.json')
  if (await pathKind(sourceFirstProgressPath) === 'file') {
    const progress = await readJson(sourceFirstProgressPath)
    if (progress?.workflow_version === 'source-first-v1') {
      return summarizeSourceFirstRun(dataRoot, runId, { includeDetails })
    }
  }
  const metadataPath = path.join(dataRoot, '.pangea', 'skill-runs', runId, 'metadata.json')
  if (await pathKind(metadataPath) !== 'file') throw new Error(`Codetalks Skill run does not exist: ${runId}`)
  const metadata = await readJson(metadataPath)
  let manifest = {}
  if (metadata.skill_root && await pathKind(path.join(metadata.skill_root, 'workflow-manifest.json')) === 'file') {
    manifest = await readJson(path.join(metadata.skill_root, 'workflow-manifest.json'))
  }
  const finalStep = manifest.steps?.at(-1)?.id ?? '09'
  const reviewStep = manifest.review_step ?? '08'
  if (metadata?.run_id && metadata.run_id !== runId) throw new Error(`Codetalks Skill metadata run_id mismatch: expected ${runId}, received ${metadata.run_id}`)
  const runDirectory = await resolveRunDirectory(dataRoot, runId, metadata)
  const statePath = path.join(runDirectory, '内部索引', '运行状态.json')
  const stateKind = await pathKind(statePath)
  const state = stateKind === 'file' ? await readJson(statePath) : null
  const stateDetails = stateKind === 'file' ? await stat(statePath) : null
  const stateRead = {
    status: stateKind === 'file' ? 'ok' : 'not_initialized',
    updated_at: typeof state?.updated_at === 'string' ? state.updated_at : null,
    observed_at: Date.now(),
    mtime_ms: stateDetails?.mtimeMs ?? null,
    path: statePath,
  }
  const liveDocuments = await markdownFiles(path.join(runDirectory, '活文档'))
  const formalOutputs = await markdownFiles(path.join(runDirectory, '正式输出'))
  const reportMd = path.join(runDirectory, '正式输出', '完整分析报告.md')
  const reportAvailable = await pathKind(reportMd) === 'file'
  const life = lifecycle(metadata, state)
  const projection = await readWorkbenchProjection(runDirectory, runId)
  const liveDraft = await readLiveDocumentDraft(runDirectory, state, manifest)
  const recordedSourceSnapshot = metadata.source_snapshot ?? { status: 'legacy_unavailable', file_count: null }
  const sourceSnapshot = { ...recordedSourceSnapshot, ...(await readSourceSnapshotManifest(runDirectory, runId, recordedSourceSnapshot)) }
  const validation = state?.validation ?? { status: 'not_checked', error_count: 0, errors: [] }
  const performance = state?.performance && typeof state.performance === 'object'
    ? {
        version: 1,
        progress_updates: Number.isInteger(state.performance.progress_updates) ? state.performance.progress_updates : 0,
        steps: state.performance.steps && typeof state.performance.steps === 'object' ? state.performance.steps : {},
      }
    : { version: 1, progress_updates: 0, steps: {} }
  const completed = state?.completed_steps?.length ?? 0
  const finalExpected = life.lifecycle_status === 'complete'
    || state?.status === 'complete'
    || (!['module-five-stage', 'coverage-five-stage'].includes(manifest.workflow_id) && (state?.completed_steps ?? []).includes(finalStep))
  const recordedPublication = state?.publication && typeof state.publication === 'object'
    ? state.publication
    : projection.value?.publication && typeof projection.value.publication === 'object'
      ? projection.value.publication
      : null
  const recordedState = ['pending', 'draft', 'final', 'broken'].includes(recordedPublication?.state)
    ? recordedPublication.state
    : null
  const publicationState = projection.status === 'verified'
    ? (recordedState === 'broken' ? 'broken' : recordedState === 'final' && finalExpected ? 'final' : finalExpected ? 'final' : 'draft')
    : (projection.status === 'invalid' || finalExpected ? 'broken' : liveDraft.step_id ? 'draft' : 'pending')
  const publicationRevision = Number.isInteger(recordedPublication?.revision) && recordedPublication.revision >= 0
    ? recordedPublication.revision
    : projection.status === 'verified' ? 1 : 0
  const publicationStep = typeof recordedPublication?.step_id === 'string'
    ? recordedPublication.step_id
    : projection.status === 'verified' ? (finalExpected ? finalStep : null) : liveDraft.step_id
  const publicationIssues = publicationState === 'broken' && recordedState === 'broken'
    ? ['工作台结构化投影已标记为 broken']
    : []
  const projectionIssues = projection.status === 'legacy_unavailable' && ['pending', 'draft'].includes(publicationState)
    ? []
    : projection.status === 'verified' && publicationState !== 'broken'
      ? []
      : [...projection.issues, ...publicationIssues]
  const workflow = {
    steps: stepRows(state, liveDocuments, formalOutputs, manifest, runDirectory),
    workflow_id: manifest.workflow_id ?? 'legacy-nine-step',
    completed_steps: state?.completed_steps ?? [],
    current_step: state?.current_step ?? null,
    core_rules_ack: state?.core_rules_ack ?? {},
    judge: state?.judge ?? { required: true, status: 'pending' },
    actions: [],
    units: [],
    quality_checks: [],
    unresolved: [],
    error_history: [],
    step_progress: state?.step_progress ?? null,
  }
  if (projectionIssues.length > 0) {
    workflow.unresolved = projectionIssues.map(message => ({ code: 'PROJECTION_UNAVAILABLE', message }))
  }
  const projectionValue = projection.value ?? {}
  const resultDetails = projection.status === 'verified'
    ? normalizeProjectionDetails(projectionValue, liveDraft.details)
    : liveDraft.details
  const formalPath = path.join(runDirectory, '正式输出/黑盒测试用例.md')
  let delivery = { status: 'not_checked', issues: [] }
  if (finalExpected && projection.status === 'verified') {
    const projected = projectionValue.test_cases
    const formalCases = parseTestCases(await readTextIfFile(formalPath), new Map(), projected.map(item => item.test_case_id))
    delivery = deliveryIntegrity(projected, formalCases, formalPath)
    if (await pathKind(formalPath) !== 'file') {
      delivery.status = 'incomplete'
      delivery.issues.push({ code: 'formal_cases_missing', path: formalPath })
    }
    // Formal delivery/export consumes only formal fields. A complete draft or
    // projection must never conceal missing content in the final document.
    const byId = new Map(formalCases.map(item => [item.test_case_id, item]))
    resultDetails.test_cases = resultDetails.test_cases.map(item => {
      const detail = byId.get(item.test_case_id) ?? byId.get(`TC-${item.test_case_id}`)
      return { ...item, ...Object.fromEntries(Object.keys(CASE_FIELDS).map(key => [key, detail?.[key] ?? []])) }
    })
  }
  const semantic = await semanticReview(runDirectory)
  const summary = {
    run_id: runId,
    data_root: path.resolve(dataRoot),
    ...life,
    phase_title: workflow.steps.find(step => step.step === state?.current_step)?.title ?? null,
    scenario: metadata.request?.scenario ?? 'module-analysis',
    coverage_input: metadata.coverage_input ?? null,
    input_materials: includeDetails ? await readInputMaterials(runDirectory) : [],
    target: metadata.request?.target ?? runId,
    repository: metadata.request?.repository ?? null,
    verdict: state?.verdict ?? null,
    quality_status: state?.verdict ?? null,
    delivery_integrity: delivery,
    semantic_review: semantic,
    attention_required: life.lifecycle_status === 'attention_required',
    analysis: {
      total: workflow.steps.length,
      completed,
      reworked: 0,
      running: life.terminal ? 0 : 1,
      pending: Math.max(0, workflow.steps.length - completed - (state?.current_step ? 1 : 0)),
      submitted: completed,
      max_parallel: 1,
    },
    performance,
    state_read: stateRead,
    counts: {
      risks: ['draft', 'final'].includes(publicationState) ? resultDetails.risks.length : null,
      test_cases: ['draft', 'final'].includes(publicationState) ? resultDetails.test_cases.length : null,
      evidence: projection.status === 'verified' ? resultDetails.evidence.length : liveDocuments.length,
      business_flows: resultDetails.business_flows.length,
      review_issues: projection.status === 'verified' ? projectionValue.review_issues.length : null,
    },
    errors: validation.status === 'failed' ? validation.errors : [],
    error_history: [],
    review: {
      status: (state?.completed_steps ?? []).includes(reviewStep) ? 'COMPLETE' : 'PENDING',
      summary: state?.judge?.status ?? 'pending',
      issues: [],
      counts: { effective: 0 },
    },
    publication: {
      state: publicationState,
      revision: publicationRevision,
      step_id: publicationStep,
    },
    data_source: projection.status === 'verified' ? 'codetalks-workbench-projection' : 'codetalks-markdown',
    reader_health: {
      status: projection.status === 'verified' && publicationState !== 'broken' && sourceSnapshot.status !== 'invalid'
        ? 'ok'
        : ['pending', 'draft'].includes(publicationState) && sourceSnapshot.status !== 'invalid' ? 'pending' : 'warning',
      trusted: projection.status === 'verified' && publicationState !== 'broken' && sourceSnapshot.status !== 'invalid',
      data_source: projection.status === 'verified' ? 'codetalks-workbench-projection' : 'codetalks-markdown',
      issues: [...projectionIssues, ...(sourceSnapshot.status === 'invalid' ? ['源码清单不可读取'] : [])],
      count_checks: {},
    },
    reader_warnings: projectionIssues,
    artifacts: {
      run_directory: runDirectory,
      request: metadata.request_path,
      state: stateKind === 'file' ? statePath : null,
      live_documents: liveDocuments,
      formal_outputs: formalOutputs,
      report_md: reportAvailable ? reportMd : null,
      report_html: null,
      source_snapshot_manifest: await pathKind(path.join(runDirectory, 'inputs', 'source', 'manifest.json')) === 'file'
        ? path.join(runDirectory, 'inputs', 'source', 'manifest.json') : null,
    },
    source_snapshot: sourceSnapshot,
    validation,
    report_available: reportAvailable && life.lifecycle_status === 'complete',
    modified_at: Math.max(stateDetails?.mtimeMs ?? 0, (await stat(runDirectory)).mtimeMs),
  }
  if (includeDetails) {
    summary.details = publicationState === 'draft' || projection.status === 'verified'
      ? resultDetails
      : { risks: [], test_cases: [], evidence: [], business_flows: [], review_issues: [] }
    summary.workflow = workflow
  }
  return summary
}

export async function listRuns(dataRoot, { limit = 20 } = {}) {
  const roots = [path.join(dataRoot, 'runs'), path.join(dataRoot, '.pangea', 'skill-runs')]
  const runIds = new Set()
  for (const root of roots) {
    if (await pathKind(root) !== 'directory') continue
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isDirectory()) runIds.add(entry.name)
    }
  }
  const values = []
  for (const runId of runIds) {
    try { values.push(await summarizeRun(dataRoot, runId)) } catch { /* one damaged run must not hide others */ }
  }
  values.sort((a, b) => b.modified_at - a.modified_at)
  return values.slice(0, limit)
}

export function chooseCurrentRun(runs) {
  return runs.find(run => !run.terminal) ?? runs[0] ?? null
}

export async function listExecutorRuns() {
  return []
}

export async function companionSnapshot({ cwd, dataRoot, runId, limit = 20 } = {}) {
  const resolvedDataRoot = await discoverPangeaDataRoot({ cwd, dataRoot })
  const runs = await listRuns(resolvedDataRoot, { limit })
  // A requested historical Run must not fall back to the newest Run merely
  // because it is older than the first page. Read that exact id directly.
  const requestedRunId = typeof runId === 'string' ? runId.trim() : ''
  const selected = runId === undefined
    ? chooseCurrentRun(runs)
    : requestedRunId ? { run_id: requestedRunId } : null
  // Explicit selection is an identity contract: a damaged or missing Run must
  // fail as that Run instead of disappearing or falling back to another one.
  const current = selected ? await summarizeRun(resolvedDataRoot, selected.run_id, { includeDetails: true }) : null
  return { status: 'ok', data_root: resolvedDataRoot, current, runs, executor_runs: [] }
}
