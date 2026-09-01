import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

export const name = 'dsh-pangea-run-ui'
export const inject = ['webServer']

const API_PATH = '/api/pangea-run-ui/outputs'

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

async function readJsonIfPresent(filePath) {
  if (await pathKind(filePath) !== 'file') return null
  try {
    return await readJson(filePath)
  } catch (error) {
    return { __read_error: error instanceof Error ? error.message : String(error) }
  }
}

async function listJson(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => entry.name)
      .sort()
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

async function discoverDataRoot(cwd, explicitDataRoot) {
  if (typeof explicitDataRoot === 'string' && explicitDataRoot.trim()) {
    const resolved = path.resolve(explicitDataRoot)
    if (await pathKind(path.join(resolved, 'runs')) !== 'directory') throw new Error(`PANGEA data_root does not contain runs/: ${resolved}`)
    return resolved
  }
  if (typeof cwd !== 'string' || !cwd.trim()) throw new Error('cwd is required')
  let cursor = path.resolve(cwd)
  for (let depth = 0; depth < 8; depth += 1) {
    if (path.basename(cursor) === 'pangea-data' && await pathKind(path.join(cursor, 'runs')) === 'directory') return cursor
    const candidate = path.join(cursor, 'pangea-data')
    if (await pathKind(path.join(candidate, 'runs')) === 'directory') return candidate
    const parent = path.dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  throw new Error(`No pangea-data/runs directory found from workspace: ${cwd}`)
}

function safeRunId(runId) {
  if (typeof runId !== 'string' || !/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error('invalid run_id')
  return runId
}

function resultRecord(kind, file, value) {
  const raw = value && typeof value === 'object' ? value : {}
  return {
    kind,
    file,
    unit_id: typeof raw.unit_id === 'string' ? raw.unit_id : null,
    attempt: Number.isInteger(raw.attempt) ? raw.attempt : kind === 'rework' ? 1 : 0,
    worker_id: typeof raw.worker_id === 'string' ? raw.worker_id : typeof raw.reviewer_id === 'string' ? raw.reviewer_id : null,
    summary: typeof raw.summary === 'string' ? raw.summary : null,
    analyzed_scope: Array.isArray(raw.analyzed_scope) ? raw.analyzed_scope : [],
    analyzed_context_scope: Array.isArray(raw.analyzed_context_scope) ? raw.analyzed_context_scope : [],
    counts: {
      business_flows: Array.isArray(raw.business_flows) ? raw.business_flows.length : 0,
      evidence: Array.isArray(raw.evidence) ? raw.evidence.length : 0,
      risks: Array.isArray(raw.risks) ? raw.risks.length : 0,
      test_cases: Array.isArray(raw.test_cases) ? raw.test_cases.length : 0,
      errors: Array.isArray(raw.errors) ? raw.errors.length : 0,
    },
    raw,
  }
}

async function readResultDirectory(runDirectory, kind) {
  const directory = path.join(runDirectory, 'agent-results', kind)
  const records = []
  for (const file of await listJson(directory)) {
    const value = await readJsonIfPresent(path.join(directory, file))
    records.push(resultRecord(kind, file, value))
  }
  records.sort((a, b) => String(a.unit_id ?? a.file).localeCompare(String(b.unit_id ?? b.file)) || a.attempt - b.attempt)
  return records
}

export async function readRunOutputs({ cwd, runId, dataRoot } = {}) {
  const resolvedDataRoot = await discoverDataRoot(cwd, dataRoot)
  const resolvedRunId = safeRunId(runId)
  const runDirectory = path.join(resolvedDataRoot, 'runs', resolvedRunId)
  if (await pathKind(runDirectory) !== 'directory') throw new Error(`PANGEA run does not exist: ${resolvedRunId}`)

  const [progress, plan, analysis, rework, independentReview, comparisonReview] = await Promise.all([
    readJsonIfPresent(path.join(runDirectory, 'progress.json')),
    readJsonIfPresent(path.join(runDirectory, 'agent-results', 'plan.json')),
    readResultDirectory(runDirectory, 'analysis'),
    readResultDirectory(runDirectory, 'rework'),
    readJsonIfPresent(path.join(runDirectory, 'agent-results', 'review.json')),
    readJsonIfPresent(path.join(runDirectory, 'agent-results', 'comparison-review.json')),
  ])
  const reportPresent = await pathKind(path.join(runDirectory, 'report.md')) === 'file' || await pathKind(path.join(runDirectory, 'report.html')) === 'file'
  const completedRework = Array.isArray(progress?.completed_rework_units) ? progress.completed_rework_units.length : 0
  const hasRework = rework.length > 0 || completedRework > 0 || progress?.stage === 'closing'
  const reviews = [
    independentReview ? resultRecord('independent-review', 'review.json', independentReview) : null,
    comparisonReview ? resultRecord('comparison-review', 'comparison-review.json', comparisonReview) : null,
  ].filter(Boolean)

  return {
    status: 'ok',
    run_id: resolvedRunId,
    data_root: resolvedDataRoot,
    progress: {
      stage: typeof progress?.stage === 'string' ? progress.stage : null,
      phase: typeof progress?.phase === 'string' ? progress.phase : null,
      lifecycle_status: typeof progress?.lifecycle_status === 'string' ? progress.lifecycle_status : null,
      quality_status: typeof progress?.quality_status === 'string' ? progress.quality_status : null,
      analysis_units: Array.isArray(progress?.analysis_units) ? progress.analysis_units : [],
      completed_analysis_units: Array.isArray(progress?.completed_analysis_units) ? progress.completed_analysis_units : [],
      completed_rework_units: Array.isArray(progress?.completed_rework_units) ? progress.completed_rework_units : [],
    },
    plan: plan ? resultRecord('planning', 'plan.json', plan) : null,
    analysis,
    rework,
    reviews,
    has_rework: hasRework,
    report_present: reportPresent,
  }
}

function sameOriginBrowserRequest(req) {
  if (req.headers['sec-fetch-site'] === 'same-origin') return true
  const origin = req.headers.origin
  const host = req.headers.host
  if (typeof origin !== 'string' || typeof host !== 'string') return false
  try { return new URL(origin).host === host } catch { return false }
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function outputRoute(req, res) {
  if (req.method !== 'GET') return json(res, 405, { status: 'error', error: 'method-not-allowed' })
  if (!sameOriginBrowserRequest(req)) return json(res, 403, { status: 'error', error: 'same-origin-browser-request-required' })
  try {
    const url = new URL(req.url ?? API_PATH, 'http://localhost')
    const payload = await readRunOutputs({
      cwd: url.searchParams.get('cwd') ?? undefined,
      runId: url.searchParams.get('run_id') ?? undefined,
      dataRoot: url.searchParams.get('data_root') ?? undefined,
    })
    return json(res, 200, payload)
  } catch (error) {
    return json(res, 404, { status: 'error', error: error instanceof Error ? error.message : String(error) })
  }
}

export function apply(ctx) {
  const dispose = ctx.webServer.register({ kind: 'exact', path: API_PATH, handler: outputRoute })
  ctx.effect?.(() => () => dispose())
}
