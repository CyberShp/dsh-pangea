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
    if (path.basename(cursor) === 'pangea-data' && await pathKind(path.join(cursor, 'runs')) === 'directory') {
      return cursor
    }
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
    if (await pathKind(path.join(resolved, 'runs')) !== 'directory') {
      throw new Error(`PANGEA data_root does not contain runs/: ${resolved}`)
    }
    return resolved
  }
  if (typeof cwd !== 'string' || cwd.trim() === '') {
    throw new Error('Cannot discover PANGEA data root without a workspace cwd or explicit data_root')
  }
  const discovered = await findPangeaDataFrom(cwd)
  if (discovered === undefined) throw new Error(`No pangea-data/runs directory found from workspace: ${cwd}`)
  return discovered
}

async function readWorkerResults(runDirectory, acceptedAnalysis, acceptedRework) {
  const roots = [
    path.join(runDirectory, 'agent-results', 'analysis'),
    path.join(runDirectory, 'agent-results', 'rework'),
  ]
  const byUnit = new Map()
  for (const root of roots) {
    for (const filePath of await listJsonFiles(root)) {
      let value
      try {
        value = await readJson(filePath)
      } catch {
        continue
      }
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

function countList(results, field) {
  return results.reduce((sum, item) => sum + (Array.isArray(item?.[field]) ? item[field].length : 0), 0)
}

async function readReview(runDirectory) {
  const candidates = [
    path.join(runDirectory, 'agent-results', 'rework-review.json'),
    path.join(runDirectory, 'agent-results', 'review.json'),
  ]
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

async function runModifiedAt(runDirectory, progressPath) {
  const target = await pathKind(progressPath) === 'file' ? progressPath : runDirectory
  return (await stat(target)).mtimeMs
}

export async function summarizeRun(dataRoot, runId) {
  const runDirectory = path.join(dataRoot, 'runs', runId)
  if (await pathKind(runDirectory) !== 'directory') throw new Error(`PANGEA run does not exist: ${runId}`)
  const progressPath = path.join(runDirectory, 'progress.json')
  const progress = await pathKind(progressPath) === 'file' ? await readJson(progressPath) : {}
  const phase = typeof progress?.phase === 'string' ? progress.phase : 'UNKNOWN'
  const analysisUnits = Array.isArray(progress?.analysis_units) ? progress.analysis_units : []
  const completedAnalysisUnits = Array.isArray(progress?.completed_analysis_units) ? progress.completed_analysis_units : []
  const completedReworkUnits = Array.isArray(progress?.completed_rework_units) ? progress.completed_rework_units : []
  const workerResults = await readWorkerResults(
    runDirectory,
    new Set(completedAnalysisUnits),
    new Set(completedReworkUnits),
  )
  const review = await readReview(runDirectory)
  const errors = Array.isArray(progress?.errors) ? progress.errors : []
  const errorHistory = Array.isArray(progress?.error_history) ? progress.error_history : []
  const reportMd = path.join(runDirectory, 'report.md')
  const reportHtml = path.join(runDirectory, 'report.html')
  return {
    run_id: runId,
    phase,
    terminal: TERMINAL_PHASES.has(phase),
    quality_status: typeof progress?.quality_status === 'string' ? progress.quality_status : null,
    analysis: {
      total: analysisUnits.length,
      completed: completedAnalysisUnits.length,
      reworked: completedReworkUnits.length,
    },
    counts: {
      risks: countList(workerResults, 'risks'),
      test_cases: countList(workerResults, 'test_cases'),
      evidence: countList(workerResults, 'evidence'),
      business_flows: countList(workerResults, 'business_flows'),
      review_issues: review?.issues?.length ?? 0,
    },
    errors,
    error_history: errorHistory,
    review,
    artifacts: {
      run_directory: runDirectory,
      progress: await pathKind(progressPath) === 'file' ? progressPath : null,
      report_md: await pathKind(reportMd) === 'file' ? reportMd : null,
      report_html: await pathKind(reportHtml) === 'file' ? reportHtml : null,
    },
    modified_at: await runModifiedAt(runDirectory, progressPath),
  }
}

export async function listRuns(dataRoot, { limit = 20 } = {}) {
  const runsRoot = path.join(dataRoot, 'runs')
  const entries = await readdir(runsRoot, { withFileTypes: true })
  const summaries = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      summaries.push(await summarizeRun(dataRoot, entry.name))
    } catch {
      // A partially-created or corrupted run must not hide healthy runs.
    }
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
  let current
  if (runId !== undefined) {
    current = runs.find(run => run.run_id === runId) ?? await summarizeRun(resolvedDataRoot, runId)
  } else {
    current = chooseCurrentRun(runs)
  }
  return {
    status: 'ok',
    data_root: resolvedDataRoot,
    current,
    runs,
  }
}
