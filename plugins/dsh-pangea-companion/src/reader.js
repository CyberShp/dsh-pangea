import { readdir, readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

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
  const start = markdown.match(new RegExp(`^##\\s+${title}\\s*$`, 'm'))
  if (!start || start.index === undefined) return ''
  const bodyStart = start.index + start[0].length
  const remaining = markdown.slice(bodyStart)
  const end = remaining.search(/^##\s+/m)
  return (end === -1 ? remaining : remaining.slice(0, end)).trim()
}

function bulletItems(markdown, pattern = /^[-*]\s+(.+)$/) {
  return markdown.split(/\r?\n/).map(line => line.trim().match(pattern)?.[1]?.trim()).filter(Boolean)
}

function prefixedIds(value, prefix) {
  const result = []
  const expression = new RegExp(`${prefix}-(\\d+)((?:[,/]\\d+)*)`, 'g')
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
    const caseId = cells[0]?.match(/\b(TC-[A-Z0-9-]+)\b/)?.[1]
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

function parseTestCase(markdown, linkedRiskIds) {
  const heading = markdown.match(/^#\s+(TC-[A-Z0-9-]+)\s+(.+)$/m)
  if (!heading) return null
  const metadata = markdownSection(markdown, '用例定位')
  const value = label => metadata.match(new RegExp(`^-\\s+${label}[：:]\\s*(.+)$`, 'm'))?.[1]?.trim() ?? ''
  return {
    test_case_id: heading[1],
    title: heading[2].trim(),
    case_type: value('测试类型'),
    priority: value('优先级'),
    linked_risk_ids: linkedRiskIds,
    preconditions: bulletItems(markdownSection(markdown, '前置条件')),
    steps: bulletItems(markdownSection(markdown, '操作步骤'), /^\d+[.)、]\s*(.+)$/),
    expected_results: bulletItems(markdownSection(markdown, '预期结果和 Oracle')),
    observability: [],
    cleanup: bulletItems(markdownSection(markdown, '清理和复原')),
  }
}

async function readLiveDocumentDraft(runDirectory, state) {
  const completed = new Set(state?.completed_steps ?? [])
  const liveRoot = path.join(runDirectory, '活文档')
  const details = { risks: [], test_cases: [], evidence: [], business_flows: [], review_issues: [] }
  let stepId = null
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
          const caseId = markdown.match(/^#\s+(TC-[A-Z0-9-]+)/m)?.[1]
          const parsed = parseTestCase(markdown, caseId ? traceability.get(caseId) ?? [] : [])
          if (parsed) details.test_cases.push(parsed)
        }
      }
      if (details.test_cases.length > 0) stepId = '07'
    }
  }
  return { step_id: stepId, details }
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
    const live = liveCaseById.get(projected.test_case_id) ?? {}
    const merged = { ...live, ...projected }
    delete merged.status
    if (projected.status !== undefined) merged.status = projected.status
    return {
      ...merged,
      case_type: projected.case_type ?? live.case_type ?? '',
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

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

async function verifySourceSnapshot(runDirectory, runId, recordedSnapshot) {
  const manifestPath = path.join(runDirectory, 'inputs', 'source', 'manifest.json')
  if (await pathKind(manifestPath) !== 'file') return { status: 'legacy_unavailable', issues: [] }
  try {
    const manifest = await readJson(manifestPath)
    const issues = []
    if (manifest.run_id !== runId) issues.push('源码快照 run_id 与当前 Run 不一致')
    const files = manifest.files
    if (!Array.isArray(files) || files.length === 0) issues.push('源码快照清单没有文件')
    if (manifest.file_count !== files?.length) issues.push('源码快照 file_count 与清单不一致')
    if (typeof manifest.snapshot_digest !== 'string') {
      issues.push('源码快照缺少 snapshot_digest')
    } else if (manifest.snapshot_digest !== `sha256:${createHash('sha256').update(canonicalJson(files ?? [])).digest('hex')}`) {
      issues.push('源码快照清单 digest 不匹配')
    }
    for (const item of files ?? []) {
      if (!item?.path || typeof item.sha256 !== 'string') { issues.push('源码快照清单包含非法文件项'); continue }
      const relative = path.normalize(item.path)
      if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) issues.push(`源码快照路径越界：${item.path}`)
    }
    if (recordedSnapshot?.snapshot_digest && recordedSnapshot.snapshot_digest !== manifest.snapshot_digest) issues.push('源码快照清单与 Run 元数据不一致')
    if (Number.isInteger(recordedSnapshot?.file_count) && recordedSnapshot.file_count !== manifest.file_count) issues.push('源码快照文件数与 Run 元数据不一致')
    return { status: issues.length ? 'corrupt' : 'manifest_verified', issues, manifest }
  } catch (error) {
    return { status: 'corrupt', issues: [error instanceof Error ? error.message : String(error)] }
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
    return resolved
  }
  if (typeof cwd !== 'string' || cwd.trim() === '') throw new Error('Cannot discover PANGEA data root without a workspace cwd or explicit data_root')
  const discovered = await findPangeaDataFrom(cwd)
  if (!discovered) throw new Error(`No pangea-data/runs directory found from workspace: ${cwd}`)
  return discovered
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

async function stepRows(state, liveDocuments, formalOutputs, skillRoot) {
  const completed = new Set(state?.completed_steps ?? [])
  const current = state?.current_step ?? null
  let ownership = new Map()
  try {
    const manifest = await readJson(path.join(skillRoot, 'workflow-manifest.json'))
    for (const step of manifest.steps ?? []) {
      for (const artifact of step.required ?? []) {
        const name = path.basename(artifact)
        ownership.set(name, String(step.id ?? '').padStart(2, '0'))
      }
    }
  } catch { /* older runs may not contain a manifest */ }
  return STEP_TITLES.map((title, index) => {
    const step = String(index + 1).padStart(2, '0')
    const status = completed.has(step) ? 'completed' : current === step ? 'running' : 'pending'
    const artifacts = step === '09'
      ? formalOutputs
      : liveDocuments.filter(file => ownership.size > 0
        ? ownership.get(path.basename(file)) === step
        : path.basename(file).startsWith(step + '-'))
    return { step, title, status, artifacts }
  })
}

export async function summarizeRun(dataRoot, runId, { includeDetails = false } = {}) {
  if (typeof runId !== 'string' || runId.trim() === '' || path.basename(runId) !== runId || ['.', '..'].includes(runId)) {
    throw new Error('Codetalks Skill run_id must be one path segment')
  }
  const metadataPath = path.join(dataRoot, '.pangea', 'skill-runs', runId, 'metadata.json')
  if (await pathKind(metadataPath) !== 'file') throw new Error(`Codetalks Skill run does not exist: ${runId}`)
  const metadata = await readJson(metadataPath)
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
  const liveDraft = await readLiveDocumentDraft(runDirectory, state)
  const recordedSourceSnapshot = metadata.source_snapshot ?? { status: 'legacy_unavailable', snapshot_digest: null, file_count: null }
  const sourceSnapshot = { ...recordedSourceSnapshot, ...(await verifySourceSnapshot(runDirectory, runId, recordedSourceSnapshot)) }
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
    || (state?.completed_steps ?? []).includes('09')
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
    : projection.status === 'verified' ? (finalExpected ? '09' : null) : liveDraft.step_id
  const publicationIssues = publicationState === 'broken' && recordedState === 'broken'
    ? ['工作台结构化投影已标记为 broken']
    : []
  const projectionIssues = projection.status === 'legacy_unavailable' && ['pending', 'draft'].includes(publicationState)
    ? []
    : projection.status === 'verified' && publicationState !== 'broken'
      ? []
      : [...projection.issues, ...publicationIssues]
  const workflow = {
    steps: await stepRows(state, liveDocuments, formalOutputs, metadata.skill_root),
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
  const summary = {
    run_id: runId,
    data_root: path.resolve(dataRoot),
    ...life,
    target: metadata.request?.target ?? runId,
    repository: metadata.request?.repository ?? null,
    verdict: state?.verdict ?? null,
    quality_status: state?.verdict ?? null,
    attention_required: life.lifecycle_status === 'attention_required',
    analysis: {
      total: 9,
      completed,
      reworked: 0,
      running: life.terminal ? 0 : 1,
      pending: Math.max(0, 9 - completed - (state?.current_step ? 1 : 0)),
      submitted: completed,
      max_parallel: 1,
    },
    performance,
    state_read: stateRead,
    counts: {
      risks: ['draft', 'final'].includes(publicationState) ? resultDetails.risks.length : null,
      test_cases: ['draft', 'final'].includes(publicationState) ? resultDetails.test_cases.length : null,
      evidence: projection.status === 'verified' ? resultDetails.evidence.length : liveDocuments.length,
      business_flows: projection.status === 'verified' ? projectionValue.business_flows.length : null,
      review_issues: projection.status === 'verified' ? projectionValue.review_issues.length : null,
    },
    errors: validation.status === 'failed' ? validation.errors : [],
    error_history: [],
    review: {
      status: (state?.completed_steps ?? []).includes('08') ? 'COMPLETE' : 'PENDING',
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
      status: projection.status === 'verified' && publicationState !== 'broken' && sourceSnapshot.status !== 'corrupt'
        ? 'ok'
        : ['pending', 'draft'].includes(publicationState) && sourceSnapshot.status !== 'corrupt' ? 'pending' : 'warning',
      trusted: projection.status === 'verified' && publicationState !== 'broken' && sourceSnapshot.status !== 'corrupt',
      data_source: projection.status === 'verified' ? 'codetalks-workbench-projection' : 'codetalks-markdown',
      issues: [...projectionIssues, ...(sourceSnapshot.status === 'corrupt' ? ['源码快照完整性校验失败'] : [])],
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
  const root = path.join(dataRoot, '.pangea', 'skill-runs')
  if (await pathKind(root) !== 'directory') return []
  const values = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try { values.push(await summarizeRun(dataRoot, entry.name)) } catch { /* one damaged run must not hide others */ }
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
