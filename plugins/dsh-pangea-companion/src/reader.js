import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const TERMINAL_PHASES = new Set(['COMPLETE', 'INCOMPLETE'])

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
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function listJsonFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => path.join(directory, entry.name))
      .sort()
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

async function findPangeaDataFrom(startPath) {
  let cursor = path.resolve(startPath)
  if (await pathKind(cursor) === 'file') cursor = path.dirname(cursor)
  for (let depth = 0; depth < 8; depth += 1) {
    if (path.basename(cursor) === 'pangea-data' && await pathKind(path.join(cursor, 'runs')) === 'directory') return cursor
    const candidate = path.join(cursor, 'pangea-data')
    if (await pathKind(path.join(candidate, 'runs')) === 'directory') return candidate
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
  if (discovered === undefined) throw new Error(`No pangea-data/runs directory found from workspace: ${cwd}`)
  return discovered
}

async function readWorkerResults(runDirectory, acceptedAnalysis, acceptedRework) {
  const roots = [path.join(runDirectory, 'agent-results', 'analysis'), path.join(runDirectory, 'agent-results', 'rework')]
  const byUnit = new Map()
  for (const root of roots) {
    for (const filePath of await listJsonFiles(root)) {
      let value
      try { value = await readJson(filePath) } catch { continue }
      const unitId = typeof value?.unit_id === 'string' && value.unit_id !== '' ? value.unit_id : path.basename(filePath, '.json')
      const attempt = Number.isInteger(value?.attempt) ? value.attempt : root.endsWith(`${path.sep}rework`) ? 1 : 0
      const accepted = attempt >= 1 ? acceptedRework.has(unitId) : acceptedAnalysis.has(unitId)
      if (!accepted) continue
      const previous = byUnit.get(unitId)
      if (previous === undefined || attempt >= previous.attempt) byUnit.set(unitId, { ...value, unit_id: unitId, attempt })
    }
  }
  return [...byUnit.values()]
}

function evidenceKey(value) {
  return [value?.chunk_id ?? '', value?.location ?? '', value?.observation ?? ''].join('\u0000')
}

function buildDetails(workerResults, review) {
  const risks = []
  const testCases = []
  const businessFlows = []
  const evidenceByKey = new Map()

  const addEvidence = (raw, { unitId, riskId } = {}) => {
    if (!raw || typeof raw !== 'object') return
    const normalized = {
      chunk_id: typeof raw.chunk_id === 'string' ? raw.chunk_id : typeof raw.evidence_id === 'string' ? raw.evidence_id : '',
      location: typeof raw.location === 'string' ? raw.location : typeof raw.source === 'string' ? raw.source : typeof raw.path === 'string' ? raw.path : '',
      observation: typeof raw.observation === 'string' ? raw.observation : typeof raw.summary === 'string' ? raw.summary : typeof raw.reason === 'string' ? raw.reason : '',
      unit_ids: [],
      risk_ids: [],
    }
    const key = evidenceKey(normalized)
    let current = evidenceByKey.get(key)
    if (current === undefined) {
      current = normalized
      evidenceByKey.set(key, current)
    }
    if (unitId && !current.unit_ids.includes(unitId)) current.unit_ids.push(unitId)
    if (riskId && !current.risk_ids.includes(riskId)) current.risk_ids.push(riskId)
  }

  for (const result of workerResults) {
    const unitId = result.unit_id
    const attempt = result.attempt
    for (const raw of Array.isArray(result.risks) ? result.risks : []) {
      if (!raw || typeof raw !== 'object') continue
      const riskId = typeof raw.risk_id === 'string' ? raw.risk_id : typeof raw.id === 'string' ? raw.id : ''
      const risk = { ...raw, risk_id: riskId, unit_id: unitId, attempt, linked_test_case_ids: [] }
      risks.push(risk)
      for (const item of Array.isArray(raw.evidence) ? raw.evidence : []) addEvidence(item, { unitId, riskId })
    }
    for (const raw of Array.isArray(result.test_cases) ? result.test_cases : []) {
      if (!raw || typeof raw !== 'object') continue
      const testCaseId = typeof raw.test_case_id === 'string' ? raw.test_case_id : typeof raw.id === 'string' ? raw.id : ''
      testCases.push({ ...raw, test_case_id: testCaseId, unit_id: unitId, attempt })
    }
    for (const raw of Array.isArray(result.evidence) ? result.evidence : []) addEvidence(raw, { unitId })
    for (const raw of Array.isArray(result.business_flows) ? result.business_flows : []) {
      if (!raw || typeof raw !== 'object') continue
      businessFlows.push({ ...raw, unit_id: unitId, attempt })
      for (const item of Array.isArray(raw.evidence) ? raw.evidence : []) addEvidence(item, { unitId })
    }
  }

  const risksById = new Map(risks.filter(item => item.risk_id).map(item => [item.risk_id, item]))
  for (const testCase of testCases) {
    for (const riskId of Array.isArray(testCase.linked_risk_ids) ? testCase.linked_risk_ids : []) {
      const risk = risksById.get(riskId)
      if (risk && !risk.linked_test_case_ids.includes(testCase.test_case_id)) risk.linked_test_case_ids.push(testCase.test_case_id)
    }
  }

  risks.sort((a, b) => String(a.risk_id).localeCompare(String(b.risk_id)))
  testCases.sort((a, b) => String(a.test_case_id).localeCompare(String(b.test_case_id)))
  businessFlows.sort((a, b) => String(a.title ?? '').localeCompare(String(b.title ?? '')))
  const evidence = [...evidenceByKey.values()].sort((a, b) => String(a.location).localeCompare(String(b.location)))

  return { risks, test_cases: testCases, evidence, business_flows: businessFlows, review_issues: Array.isArray(review?.issues) ? review.issues : [] }
}

function stateArray(state, ...names) {
  for (const name of names) {
    if (Array.isArray(state?.[name])) return state[name]
  }
  return []
}

function finalStateHasResultCollections(state) {
  if (!state || typeof state !== 'object') return false
  return ['risks', 'risk_cards', 'test_cases', 'testcases', 'cases', 'business_flows', 'flows', 'flow_diagrams']
    .some(name => Object.prototype.hasOwnProperty.call(state, name))
}

function buildDetailsFromFinalState(state, review) {
  const synthetic = {
    unit_id: 'final-state',
    attempt: 2,
    risks: stateArray(state, 'risks', 'risk_cards'),
    test_cases: stateArray(state, 'test_cases', 'testcases', 'cases'),
    evidence: stateArray(state, 'evidence'),
    business_flows: stateArray(state, 'business_flows', 'flows', 'flow_diagrams'),
  }
  return buildDetails([synthetic], review)
}

async function readFinalState(runDirectory) {
  const finalStatePath = path.join(runDirectory, 'final-state.json')
  if (await pathKind(finalStatePath) !== 'file') return { path: null, value: null, error: null }
  try {
    return { path: finalStatePath, value: await readJson(finalStatePath), error: null }
  } catch (error) {
    return { path: finalStatePath, value: null, error: error instanceof Error ? error.message : String(error) }
  }
}

function plainReportText(raw, format) {
  if (format !== 'html') return raw
  return raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
}

function parseReportCounts(raw, format) {
  const text = plainReportText(raw, format)
  const pick = pattern => {
    const match = pattern.exec(text)
    if (match === null) return null
    const value = Number(match[1])
    return Number.isSafeInteger(value) && value >= 0 ? value : null
  }
  return {
    business_flows: pick(/(\d+)\s*条业务流程/),
    risks: pick(/(\d+)\s*个风险/),
    test_cases: pick(/(\d+)\s*个测试用例/),
  }
}

async function readReportCounts(runDirectory, { checked = true } = {}) {
  const candidates = [
    { path: path.join(runDirectory, 'report.md'), format: 'markdown' },
    { path: path.join(runDirectory, 'report.html'), format: 'html' },
  ]
  const existing = []
  for (const candidate of candidates) {
    if (await pathKind(candidate.path) === 'file') existing.push(candidate)
  }
  if (existing.length === 0) {
    return { present: false, checked, path: null, format: null, counts: null, parseable: false, warnings: [] }
  }
  if (!checked) {
    return { present: true, checked: false, path: existing[0].path, format: existing[0].format, counts: null, parseable: false, warnings: [] }
  }

  const warnings = []
  let firstUnreadable = null
  for (const candidate of existing) {
    try {
      const raw = await readFile(candidate.path, 'utf8')
      const counts = parseReportCounts(raw, candidate.format)
      const parseable = Object.values(counts).some(Number.isInteger)
      if (parseable) return { present: true, checked: true, path: candidate.path, format: candidate.format, counts, parseable: true, warnings }
      firstUnreadable ??= { path: candidate.path, format: candidate.format, counts }
    } catch (error) {
      warnings.push(`${path.basename(candidate.path)} 读取失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return {
    present: true,
    checked: true,
    path: firstUnreadable?.path ?? existing[0].path,
    format: firstUnreadable?.format ?? existing[0].format,
    counts: firstUnreadable?.counts ?? null,
    parseable: false,
    warnings,
  }
}

async function readReview(runDirectory) {
  const candidates = [path.join(runDirectory, 'agent-results', 'rework-review.json'), path.join(runDirectory, 'agent-results', 'review.json')]
  for (const candidate of candidates) {
    if (await pathKind(candidate) !== 'file') continue
    try {
      const value = await readJson(candidate)
      return {
        status: typeof value?.status === 'string' ? value.status : null,
        reviewer_id: typeof value?.reviewer_id === 'string' ? value.reviewer_id : null,
        summary: typeof value?.summary === 'string' ? value.summary : null,
        issues: Array.isArray(value?.issues) ? value.issues : [],
        path: candidate,
      }
    } catch {
      return { status: 'UNREADABLE', issues: [], path: candidate }
    }
  }
  return null
}

function buildReaderHealth({ phase, dataSource, counts, finalStateRecord, reportRecord }) {
  const issues = []
  const countChecks = {}
  const labels = { risks: '风险', test_cases: '测试用例', business_flows: '业务流程' }
  let status = 'ok'
  let trusted = true

  if (finalStateRecord.error) {
    status = 'warning'
    issues.push(`final-state.json 读取失败：${finalStateRecord.error}`)
  }
  for (const warning of reportRecord.warnings ?? []) {
    if (status === 'ok') status = 'warning'
    issues.push(warning)
  }

  if (reportRecord.present && reportRecord.checked && !reportRecord.parseable) {
    if (status === 'ok') status = 'warning'
    issues.push('检测到报告，但无法从报告摘要提取风险/测试用例计数，无法自动对账。')
  }

  if (reportRecord.present && dataSource === 'worker-results') {
    if (status === 'ok') status = 'warning'
    issues.push('检测到已生成报告，但缺少可用的 final-state 聚合结果，当前使用 worker result 兼容回退。')
  }

  if (TERMINAL_PHASES.has(phase) && !reportRecord.present) {
    if (status === 'ok') status = 'warning'
    issues.push('Run 已进入终态，但未检测到 report.md/report.html。')
  }

  for (const key of ['risks', 'test_cases', 'business_flows']) {
    const structured = Number.isInteger(counts?.[key]) ? counts[key] : null
    const reported = reportRecord.checked && Number.isInteger(reportRecord.counts?.[key]) ? reportRecord.counts[key] : null
    const check = {
      structured,
      report: reported,
      status: reported === null || structured === null ? 'unknown' : structured === reported ? 'match' : 'mismatch',
    }
    countChecks[key] = check
    if (check.status === 'mismatch') {
      status = 'error'
      trusted = false
      issues.push(`${labels[key]}计数不一致：结构化数据 ${structured}，报告 ${reported}。`)
    }
  }

  return {
    status,
    trusted,
    data_source: dataSource,
    report_checked: reportRecord.checked,
    report_path: reportRecord.path,
    count_checks: countChecks,
    issues,
  }
}

async function runModifiedAt(runDirectory, candidates) {
  let latest = (await stat(runDirectory)).mtimeMs
  for (const candidate of candidates) {
    if (!candidate || await pathKind(candidate) !== 'file') continue
    latest = Math.max(latest, (await stat(candidate)).mtimeMs)
  }
  return latest
}

export async function summarizeRun(dataRoot, runId, { includeDetails = false, checkReport = includeDetails } = {}) {
  const runDirectory = path.join(dataRoot, 'runs', runId)
  if (await pathKind(runDirectory) !== 'directory') throw new Error(`PANGEA run does not exist: ${runId}`)
  const progressPath = path.join(runDirectory, 'progress.json')
  const progress = await pathKind(progressPath) === 'file' ? await readJson(progressPath) : {}
  const finalStateRecord = await readFinalState(runDirectory)
  const finalState = finalStateRecord.value
  const phase = typeof progress?.phase === 'string' ? progress.phase : typeof finalState?.phase === 'string' ? finalState.phase : typeof finalState?.run_status === 'string' ? finalState.run_status : 'UNKNOWN'
  const analysisUnits = Array.isArray(progress?.analysis_units) ? progress.analysis_units : stateArray(finalState, 'analysis_units')
  const completedAnalysisUnits = Array.isArray(progress?.completed_analysis_units) ? progress.completed_analysis_units : []
  const completedReworkUnits = Array.isArray(progress?.completed_rework_units) ? progress.completed_rework_units : []
  const review = includeDetails ? await readReview(runDirectory) : null
  const errors = Array.isArray(progress?.errors) ? progress.errors : stateArray(finalState, 'errors')
  const errorHistory = Array.isArray(progress?.error_history) ? progress.error_history : []
  const reportMd = path.join(runDirectory, 'report.md')
  const reportHtml = path.join(runDirectory, 'report.html')
  const reportRecord = await readReportCounts(runDirectory, { checked: checkReport })

  const dataSource = finalStateHasResultCollections(finalState) ? 'final-state' : 'worker-results'
  let details
  let counts = { risks: null, test_cases: null, evidence: null, business_flows: null, review_issues: null }

  if (includeDetails) {
    if (dataSource === 'final-state') {
      details = buildDetailsFromFinalState(finalState, review)
    } else {
      const workerResults = await readWorkerResults(runDirectory, new Set(completedAnalysisUnits), new Set(completedReworkUnits))
      details = buildDetails(workerResults, review)
    }
    counts = {
      risks: details.risks.length,
      test_cases: details.test_cases.length,
      evidence: details.evidence.length,
      business_flows: details.business_flows.length,
      review_issues: details.review_issues.length,
    }
  }
  const readerHealth = buildReaderHealth({ phase, dataSource, counts, finalStateRecord, reportRecord })
  const qualityFromFinal = typeof finalState?.quality_report?.status === 'string' ? finalState.quality_report.status : null
  const completedFallback = TERMINAL_PHASES.has(phase) && analysisUnits.length > 0 ? analysisUnits.length : completedAnalysisUnits.length

  const summary = {
    run_id: runId,
    phase,
    terminal: TERMINAL_PHASES.has(phase),
    quality_status: typeof progress?.quality_status === 'string' ? progress.quality_status : qualityFromFinal,
    analysis: { total: analysisUnits.length, completed: completedAnalysisUnits.length || completedFallback, reworked: completedReworkUnits.length },
    counts,
    errors,
    error_history: errorHistory,
    review,
    data_source: dataSource,
    reader_health: readerHealth,
    reader_warnings: readerHealth.issues,
    artifacts: {
      run_directory: runDirectory,
      progress: await pathKind(progressPath) === 'file' ? progressPath : null,
      final_state: finalStateRecord.path,
      report_md: await pathKind(reportMd) === 'file' ? reportMd : null,
      report_html: await pathKind(reportHtml) === 'file' ? reportHtml : null,
    },
    modified_at: await runModifiedAt(runDirectory, [progressPath, finalStateRecord.path, reportMd, reportHtml]),
  }
  if (includeDetails) summary.details = details
  return summary
}

export async function listRuns(dataRoot, { limit = 20 } = {}) {
  const runsRoot = path.join(dataRoot, 'runs')
  const entries = await readdir(runsRoot, { withFileTypes: true })
  const summaries = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try { summaries.push(await summarizeRun(dataRoot, entry.name, { checkReport: false })) } catch { /* corrupt run must not hide healthy runs */ }
  }
  summaries.sort((a, b) => b.modified_at - a.modified_at)
  return summaries.slice(0, limit)
}

export function chooseCurrentRun(runs) {
  return runs.find(run => !run.terminal) ?? runs[0] ?? null
}

export async function companionSnapshot({ cwd, dataRoot, runId, limit = 20 } = {}) {
  const resolvedDataRoot = await discoverPangeaDataRoot({ cwd, dataRoot })
  const runs = await listRuns(resolvedDataRoot, { limit })
  const selected = runId !== undefined ? (runs.find(run => run.run_id === runId) ?? { run_id: runId }) : chooseCurrentRun(runs)
  const current = selected === null ? null : await summarizeRun(resolvedDataRoot, selected.run_id, { includeDetails: true, checkReport: true })
  return { status: 'ok', data_root: resolvedDataRoot, current, runs }
}
