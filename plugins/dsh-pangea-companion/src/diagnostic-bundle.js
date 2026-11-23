import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { zipStore } from './export.js'
import { summarizeRunVerifications } from './fault-injection-summary.js'

const RUN_ID_RE = /^[A-Za-z0-9._-]+$/

const inside = (root, target) => {
  const rel = path.relative(root, target)
  return Boolean(rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
}

function sanitizeText(value) {
  if (typeof value !== 'string') return value
  return value
    .replace(/(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, '$1<redacted>@')
    .replace(/([A-Za-z]:\\Users\\|\/home\/|\/Users\/)[^\\/\s"']+/g, '$1<user>')
    .replace(/(?:Bearer\s+|token=|api[_-]?key=|password=|secret=)[^\s&"']+/gi, '<redacted>')
}

function sanitizeDeep(value) {
  if (typeof value === 'string') return sanitizeText(value)
  if (Array.isArray(value)) return value.map(sanitizeDeep)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeDeep(v)]))
  }
  return value
}

function sanitizeProgress(raw) {
  if (!raw || typeof raw !== 'object') return null
  const actions = {}
  for (const [id, act] of Object.entries(raw.actions || {})) {
    if (!act || typeof act !== 'object') continue
    actions[id] = {
      action_id: act.action_id,
      role: act.role,
      stage: act.stage,
      status: act.status,
      worker_turns: act.worker_turns ?? 0,
      auto_continuations: act.auto_continuations ?? 0,
      execution_elapsed_ms: act.execution_elapsed_ms ?? 0,
      validation_failures: act.validation_failures ?? 0,
      has_error: Boolean(act.error),
    }
  }
  return {
    schema_version: raw.schema_version ?? null,
    run_id: raw.run_id ?? null,
    workflow_version: raw.workflow_version ?? null,
    lifecycle_status: raw.lifecycle_status ?? null,
    stage: raw.stage ?? null,
    quality_status: raw.quality_status ?? null,
    partial_delivery: Boolean(raw.partial_delivery),
    actions,
    degradations_count: Array.isArray(raw.degradations) ? raw.degradations.length : 0,
    errors_count: Array.isArray(raw.errors) ? raw.errors.length : 0,
  }
}

export async function buildDiagnosticBundle({ dataRoot, runId, summary = null, version = 'unknown' }) {
  if (!RUN_ID_RE.test(runId || '') || runId === '.' || runId === '..') {
    const err = new Error('run_id 无效')
    err.statusCode = 400
    throw err
  }
  let progress = null
  let injectionSummary = null
  if (dataRoot) {
    try {
      const root = await realpath(dataRoot)
      const progressCandidate = path.join(root, 'runs', runId, 'progress.json')
      if (inside(root, progressCandidate)) {
        const progressReal = await realpath(progressCandidate)
        if (inside(root, progressReal)) {
          progress = sanitizeProgress(JSON.parse(await readFile(progressReal, 'utf8')))
        }
      }
    } catch {}
    try {
      const { injection_counts } = await summarizeRunVerifications(dataRoot, runId)
      injectionSummary = { injection_counts }
    } catch {}
  }
  const manifest = {
    format_version: 'pangea-diagnostic-bundle-v1',
    generated_at: new Date().toISOString(),
    plugin_version: version,
    platform: process.platform,
    arch: process.arch,
    node_version: process.version,
    run_id: runId,
    redaction_policy: 'No user source code, raw tool stdout/stderr, environment variables, or credentials included.',
    run_summary: summary ? sanitizeDeep({
      run_id: summary.run_id ?? runId,
      status: summary.status ?? null,
      scenario: summary.scenario ?? null,
      workflow_version: summary.workflow_version ?? null,
      counts: summary.counts ?? null,
      case_readiness: summary.case_readiness ?? null,
      reader_health: summary.reader_health ? { status: summary.reader_health.status } : null,
    }) : null,
  }
  const entries = [
    ['manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')],
    ...(progress ? [['progress.json', Buffer.from(`${JSON.stringify(progress, null, 2)}\n`, 'utf8')]] : []),
    ...(injectionSummary ? [['fault-injection-summary.json', Buffer.from(`${JSON.stringify(injectionSummary, null, 2)}\n`, 'utf8')]] : []),
  ]
  return {
    filename: `pangea-diagnostic-${runId}.zip`,
    contentType: 'application/zip',
    buffer: zipStore(entries),
  }
}
