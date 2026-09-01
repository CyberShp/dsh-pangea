import { appendFile, mkdir, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

export const name = 'dsh-pangea-run-ui'
export const inject = ['webServer', 'tools']

const API_PATH = '/api/pangea-run-ui/outputs'
const TRACE_RELATIVE_PATH = path.join('runtime', 'worker-trace.jsonl')
const MAX_TRACE_RECORDS = 5000
const RECENT_ACTIVITY_LIMIT = 8

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

async function listDirectories(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

async function validDataRoot(value) {
  if (typeof value !== 'string' || value.trim() === '') return null
  const resolved = path.resolve(value)
  return await pathKind(path.join(resolved, 'runs')) === 'directory' ? resolved : null
}

async function findDataRootFrom(startPath) {
  if (typeof startPath !== 'string' || startPath.trim() === '') return null
  let cursor = path.resolve(startPath)
  for (let depth = 0; depth < 8; depth += 1) {
    if (path.basename(cursor) === 'pangea-data' && await pathKind(path.join(cursor, 'runs')) === 'directory') return cursor
    const candidate = path.join(cursor, 'pangea-data')
    if (await pathKind(path.join(candidate, 'runs')) === 'directory') return candidate
    const parent = path.dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  return null
}

async function discoverDataRoot(cwd, explicitDataRoot) {
  if (explicitDataRoot !== undefined) {
    const resolved = await validDataRoot(explicitDataRoot)
    if (!resolved) throw new Error(`PANGEA data_root does not contain runs/: ${path.resolve(String(explicitDataRoot))}`)
    return resolved
  }

  const environmentRoot = await validDataRoot(process.env.PANGEA_DATA_ROOT)
  if (environmentRoot) return environmentRoot

  for (const candidate of [cwd, process.env.PANGEA_WORKSPACE_ROOT]) {
    const discovered = await findDataRootFrom(candidate)
    if (discovered) return discovered
  }
  throw new Error('Cannot discover PANGEA data root for the current workspace')
}

function safeRunId(runId) {
  if (typeof runId !== 'string' || !/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error('invalid run_id')
  return runId
}

function resolveTaskPath(cwd, value) {
  if (typeof value !== 'string' || value.trim() === '') return null
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(cwd, value)
}

function unitIdFromTask(task, fallback = null) {
  if (typeof task?.unit?.unit_id === 'string' && task.unit.unit_id !== '') return task.unit.unit_id
  if (typeof task?.unit_id === 'string' && task.unit_id !== '') return task.unit_id
  return fallback
}

function resultRecord(kind, file, value) {
  const raw = value && typeof value === 'object' ? value : {}
  const fileUnit = ['analysis', 'rework'].includes(kind) ? path.basename(file, '.json') : null
  return {
    kind,
    file,
    unit_id: typeof raw.unit_id === 'string' && raw.unit_id !== '' ? raw.unit_id : fileUnit,
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

function actionRecords(progress) {
  return Object.values(progress?.actions ?? {}).map(action => ({
    action_id: action?.action_id ?? null,
    action: action?.action ?? null,
    role: action?.role ?? null,
    stage: action?.stage ?? null,
    status: action?.status ?? null,
    task_id: action?.task_id ?? null,
    task_path: action?.task_path ?? null,
    error: action?.error ?? null,
    incomplete_attempts: Number.isInteger(action?.incomplete_attempts) ? action.incomplete_attempts : 0,
    validation_failures: Number.isInteger(action?.validation_failures) ? action.validation_failures : 0,
  }))
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

async function readTraceRecords(runDirectory) {
  const tracePath = path.join(runDirectory, TRACE_RELATIVE_PATH)
  if (await pathKind(tracePath) !== 'file') return []
  try {
    const lines = (await readFile(tracePath, 'utf8')).split(/\r?\n/).filter(Boolean)
    return lines.slice(-MAX_TRACE_RECORDS).map(line => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean)
  } catch {
    return []
  }
}

async function appendTrace(binding, event) {
  if (!binding?.run_directory) return
  const tracePath = path.join(binding.run_directory, TRACE_RELATIVE_PATH)
  await mkdir(path.dirname(tracePath), { recursive: true })
  await appendFile(tracePath, `${JSON.stringify({ at: Date.now(), ...event })}\n`, 'utf8')
}

async function resultState(task, actionStatus) {
  const resultPath = resolveTaskPath(task.__cwd, task?.result_path)
  const skeletonPath = resolveTaskPath(task.__cwd, task?.result_skeleton_path)
  if (!resultPath) return { state: 'unknown', result_path: null }
  if (await pathKind(resultPath) !== 'file') return { state: 'missing', result_path: resultPath }
  let result
  try { result = await readJson(resultPath) } catch { return { state: 'invalid_json', result_path: resultPath } }
  if (skeletonPath && await pathKind(skeletonPath) === 'file') {
    try {
      const skeleton = await readJson(skeletonPath)
      if (JSON.stringify(result) === JSON.stringify(skeleton)) return { state: 'skeleton', result_path: resultPath }
    } catch { /* result still counts as written if skeleton cannot be read */ }
  }
  return { state: actionStatus === 'accepted' ? 'accepted' : 'written', result_path: resultPath }
}

async function actionBinding({ cwd, dataRoot, runId, actionId, childId } = {}) {
  const resolvedDataRoot = await discoverDataRoot(cwd, dataRoot)
  const runs = runId ? [safeRunId(runId)] : await listDirectories(path.join(resolvedDataRoot, 'runs'))
  for (const candidateRunId of runs) {
    const runDirectory = path.join(resolvedDataRoot, 'runs', candidateRunId)
    const progress = await readJsonIfPresent(path.join(runDirectory, 'progress.json'))
    for (const action of Object.values(progress?.actions ?? {})) {
      if (actionId && action?.action_id !== actionId) continue
      if (childId && action?.task_id !== childId) continue
      const taskPath = resolveTaskPath(cwd, action?.task_path)
      const task = taskPath ? await readJsonIfPresent(taskPath) : null
      return {
        data_root: resolvedDataRoot,
        run_id: candidateRunId,
        run_directory: runDirectory,
        action_id: action?.action_id ?? actionId ?? null,
        child_id: action?.task_id ?? childId ?? null,
        role: action?.role ?? null,
        stage: action?.stage ?? null,
        task_path: taskPath,
        unit_id: unitIdFromTask(task),
        task: task && typeof task === 'object' ? { ...task, __cwd: cwd } : { __cwd: cwd },
      }
    }
  }
  return null
}

function acceptedToolValue(result, downstream) {
  return downstream?.kind === 'accept' && Object.hasOwn(downstream, 'value') ? downstream.value : result?.value
}

function workspaceCwd(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : undefined
}

function toolTarget(exec) {
  const args = exec?.arguments ?? {}
  const pathValue = args.file_path ?? args.path ?? args.location
  if (typeof pathValue === 'string' && pathValue.trim() !== '') return pathValue
  if (typeof args.command === 'string' && args.command.trim() !== '') return args.command.slice(0, 320)
  return null
}

function settledReason(message) {
  const candidates = [message?.source?.reason, message?.reason, message?.data?.reason]
  for (const value of candidates) {
    if (typeof value === 'string' && value) return value
    if (typeof value?.kind === 'string' && value.kind) return value.kind
  }
  return 'subagent-settled'
}

export function createWorkerTraceObserver(ctx) {
  const childBindings = new Map()

  const observeSettled = ({ agent, message }) => {
    if (message?.source?.kind !== 'subagent-settled') return
    const childId = message.source.senderSessionId
    if (!childId) return
    void (async () => {
      try {
        const binding = childBindings.get(childId) ?? await actionBinding({ cwd: agent?.session?.header?.cwd, childId })
        if (!binding) return
        childBindings.set(childId, binding)
        await appendTrace(binding, { type: 'settled', child_id: childId, action_id: binding.action_id, unit_id: binding.unit_id, reason: settledReason(message) })
      } catch { /* diagnostics must never affect workflow */ }
    })()
  }
  const disposeInserted = ctx.on('agent/inbox/inserted', observeSettled)
  const disposeClaimed = ctx.on('agent/inbox/claimed', observeSettled)

  const disposeTools = ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next()
    try {
      const cwd = workspaceCwd(exec)
      if (!cwd || result?.isError) return downstream
      const value = acceptedToolValue(result, downstream)

      if (exec.name === 'pangea_action_dispatch') {
        const childId = value?.subagent_id ?? value?.subagentId
        const actionId = exec.arguments?.action_id
        if (childId && actionId) {
          const binding = await actionBinding({ cwd, actionId })
          if (binding) {
            binding.child_id = childId
            childBindings.set(childId, binding)
            const state = await resultState(binding.task, 'dispatched')
            await appendTrace(binding, { type: 'started', child_id: childId, action_id: binding.action_id, unit_id: binding.unit_id, role: binding.role, stage: binding.stage, result_state: state.state })
          }
        }
        return downstream
      }

      if (exec.name === 'pangea_action_settle') {
        const binding = await actionBinding({ cwd, dataRoot: exec.arguments?.data_root, runId: exec.arguments?.run_id, actionId: exec.arguments?.action_id })
        if (binding) {
          const state = await resultState(binding.task, value?.status === 'valid' ? 'accepted' : 'settled')
          await appendTrace(binding, {
            type: 'validation', child_id: binding.child_id, action_id: binding.action_id, unit_id: binding.unit_id,
            status: value?.status ?? null, result_state: state.state, attention_required: value?.attention_required === true,
            error: value?.error?.message ?? value?.error ?? null,
          })
        }
        return downstream
      }

      if (exec?.agent?.session?.header?.origin !== 'subagent') return downstream
      const childId = String(exec.agent.id)
      const binding = childBindings.get(childId) ?? await actionBinding({ cwd, childId })
      if (!binding) return downstream
      childBindings.set(childId, binding)
      const state = await resultState(binding.task, 'dispatched')
      await appendTrace(binding, {
        type: 'tool', child_id: childId, action_id: binding.action_id, unit_id: binding.unit_id,
        tool: exec.name ?? 'unknown', target: toolTarget(exec), ok: true, result_state: state.state,
      })
    } catch { /* diagnostics must never affect workflow */ }
    return downstream
  })

  return () => {
    disposeTools?.()
    disposeClaimed?.()
    disposeInserted?.()
  }
}

function samePath(cwd, left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  try { return resolveTaskPath(cwd, left) === resolveTaskPath(cwd, right) } catch { return false }
}

function actionStatusLabel(status) {
  return {
    pending: '待派发', dispatched: '分析中', settled: '待校验', accepted: '已完成', failed: '失败', attention_required: '需要处理',
  }[status] ?? status ?? '未知'
}

function resultStateLabel(state) {
  return {
    skeleton: '仍为骨架', written: '已写入', accepted: '已校验', missing: '结果文件缺失', invalid_json: '结果 JSON 不可读', unknown: '未知',
  }[state] ?? state
}

function runtimeSummary(diagnostic) {
  if (!diagnostic) return null
  const traceLabel = diagnostic.trace_observed
    ? `task ${diagnostic.task_read ? '已读' : '未观察到读取'} · 工具 ${diagnostic.tool_count}`
    : '本次运行没有可用的历史工具轨迹'
  const settled = diagnostic.settled ? ` · Worker 已结束${diagnostic.settled_reason ? `(${diagnostic.settled_reason})` : ''}` : ''
  const validation = diagnostic.validation_status ? ` · 校验 ${diagnostic.validation_status}` : ''
  return `执行轨迹：${actionStatusLabel(diagnostic.status)} · ${traceLabel} · result_path ${resultStateLabel(diagnostic.result_state)}${settled}${validation}`
}

export async function buildWorkerDiagnostics({ cwd, progress, runDirectory, traceRecords = [] }) {
  const diagnostics = []
  for (const action of Object.values(progress?.actions ?? {})) {
    if (!['analysis', 'closure', 'planning', 'review'].includes(action?.role)) continue
    const taskPath = resolveTaskPath(cwd, action?.task_path)
    const taskValue = taskPath ? await readJsonIfPresent(taskPath) : null
    const task = taskValue && typeof taskValue === 'object' ? { ...taskValue, __cwd: cwd } : { __cwd: cwd }
    const unitId = unitIdFromTask(taskValue, action?.role === 'analysis' || action?.role === 'closure' ? null : action?.role)
    const state = await resultState(task, action?.status)
    const events = traceRecords.filter(item => item?.action_id === action?.action_id || (action?.task_id && item?.child_id === action.task_id))
    const tools = events.filter(item => item.type === 'tool')
    const taskRead = tools.some(item => samePath(cwd, item.target, taskPath))
    const resultTouched = tools.some(item => samePath(cwd, item.target, state.result_path) || ['written', 'accepted'].includes(item.result_state))
    const settled = [...events].reverse().find(item => item.type === 'settled')
    const validation = [...events].reverse().find(item => item.type === 'validation')
    diagnostics.push({
      action_id: action?.action_id ?? null,
      unit_id: unitId,
      role: action?.role ?? null,
      stage: action?.stage ?? null,
      status: action?.status ?? null,
      child_id: action?.task_id ?? null,
      task_path: taskPath,
      result_path: state.result_path,
      result_state: state.state,
      trace_observed: events.length > 0,
      task_read: taskRead,
      tool_count: tools.length,
      result_write_observed: resultTouched,
      settled: Boolean(settled) || ['settled', 'accepted', 'failed'].includes(action?.status),
      settled_reason: settled?.reason ?? null,
      validation_status: validation?.status ?? (action?.status === 'accepted' ? 'valid' : null),
      incomplete_attempts: Number.isInteger(action?.incomplete_attempts) ? action.incomplete_attempts : 0,
      validation_failures: Number.isInteger(action?.validation_failures) ? action.validation_failures : 0,
      error: action?.error ?? validation?.error ?? null,
      recent_activity: events.slice(-RECENT_ACTIVITY_LIMIT),
    })
  }
  return diagnostics
}

function attachDiagnostics(records, diagnostics, role) {
  return records.map(record => {
    const diagnostic = diagnostics.find(item => item.role === role && item.unit_id === record.unit_id)
    if (!diagnostic) return record
    const runtime = runtimeSummary(diagnostic)
    return {
      ...record,
      worker_id: record.worker_id ?? diagnostic.child_id,
      summary: [runtime, record.summary].filter(Boolean).join('\n\n') || null,
      runtime: diagnostic,
    }
  })
}

export async function readRunOutputs({ cwd, runId, dataRoot } = {}) {
  const resolvedDataRoot = await discoverDataRoot(cwd, dataRoot)
  const resolvedRunId = safeRunId(runId)
  const runDirectory = path.join(resolvedDataRoot, 'runs', resolvedRunId)
  if (await pathKind(runDirectory) !== 'directory') throw new Error(`PANGEA run does not exist: ${resolvedRunId}`)
  const effectiveCwd = cwd ?? process.env.PANGEA_WORKSPACE_ROOT ?? path.dirname(resolvedDataRoot)

  const [progress, plan, rawAnalysis, rawRework, independentReview, comparisonReview, traceRecords] = await Promise.all([
    readJsonIfPresent(path.join(runDirectory, 'progress.json')),
    readJsonIfPresent(path.join(runDirectory, 'agent-results', 'plan.json')),
    readResultDirectory(runDirectory, 'analysis'),
    readResultDirectory(runDirectory, 'rework'),
    readJsonIfPresent(path.join(runDirectory, 'agent-results', 'review.json')),
    readJsonIfPresent(path.join(runDirectory, 'agent-results', 'comparison-review.json')),
    readTraceRecords(runDirectory),
  ])
  const diagnostics = await buildWorkerDiagnostics({ cwd: effectiveCwd, progress, runDirectory, traceRecords })
  const analysis = attachDiagnostics(rawAnalysis, diagnostics, 'analysis')
  const rework = attachDiagnostics(rawRework, diagnostics, 'closure')
  const reportPresent = await pathKind(path.join(runDirectory, 'report.md')) === 'file' || await pathKind(path.join(runDirectory, 'report.html')) === 'file'
  const completedRework = Array.isArray(progress?.completed_closure_units)
    ? progress.completed_closure_units.length
    : Array.isArray(progress?.completed_rework_units) ? progress.completed_rework_units.length : 0
  const hasRework = rework.length > 0 || completedRework > 0 || progress?.stage === 'closing'
  const reviews = [
    independentReview ? resultRecord('independent-review', 'review.json', independentReview) : null,
    comparisonReview ? resultRecord('comparison-review', 'comparison-review.json', comparisonReview) : null,
  ].filter(Boolean)
  const actions = actionRecords(progress)

  return {
    status: 'ok',
    run_id: resolvedRunId,
    progress: {
      stage: typeof progress?.stage === 'string' ? progress.stage : null,
      phase: typeof progress?.phase === 'string' ? progress.phase : null,
      lifecycle_status: typeof progress?.lifecycle_status === 'string' ? progress.lifecycle_status : null,
      attention_required: progress?.attention_required === true || String(progress?.status ?? '').toLowerCase() === 'attention_required',
      quality_status: typeof progress?.quality_status === 'string' ? progress.quality_status : null,
      analysis_units: Array.isArray(progress?.analysis_units) ? progress.analysis_units : [],
      completed_analysis_units: Array.isArray(progress?.completed_analysis_units) ? progress.completed_analysis_units : [],
      completed_rework_units: Array.isArray(progress?.completed_closure_units)
        ? progress.completed_closure_units
        : Array.isArray(progress?.completed_rework_units) ? progress.completed_rework_units : [],
      actions,
    },
    plan: plan ? resultRecord('planning', 'plan.json', plan) : null,
    analysis,
    rework,
    reviews,
    worker_diagnostics: diagnostics,
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
  const disposeTrace = createWorkerTraceObserver(ctx)
  const disposeRoute = ctx.webServer.register({ kind: 'exact', path: API_PATH, handler: outputRoute })
  ctx.effect?.(() => () => { disposeTrace(); disposeRoute() })
}
