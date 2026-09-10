import { createView, listViews, loadView, updateView, viewArtifact } from './architecture-views.js'
import { supportsHostReview } from './analysis-review.js'
import { companionSnapshot, discoverPangeaDataRoot, summarizeRun } from './reader.js'
import { parseEvidenceLocation, readEvidenceSnippet } from './source.js'
import { buildTestCaseCsv, buildTestCaseXlsx } from './export.js'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRuntimeMonitor } from './monitor.js'
import { createTaskStore } from './task-store.js'
import { ATTENTION_REQUIRED_CODE, decodeAcpOutcomeDetail } from './acp-outcome.js'
import { createLaunchLogStore } from './launch-log.js'
import { createAcpSettingsStore } from './acp-settings.js'
import { discoverAgentModels } from './agent-models.js'
import { EnvironmentStore } from './execution/environment.js'
import { launchExecution } from './execution/launch.js'
import { PangeaSshRuntime } from './execution/ssh.js'
import { createRun, runSourceFirstCommand, runPangea, workspaceRoot } from './pangea-api.js'
import { acpProviderOption, acpProviderOptions, createTaskConversation, dataRootFor, internalModelOptions, launchAnalysisSession, launchArchitectureSession, requireInternalModel, stopAnalysisRun, workbenchSnapshot } from './workbench-api.js'
import { importRepository, repositoryStatus } from './repositories/import.js'

export const name = 'dsh-pangea-companion'
export const inject = ['tools', 'webServer', 'agents', 'apiProxy', 'subagents', 'jobs']

const API_PATH = '/api/pangea-companion/state'
const SOURCE_API_PATH = '/api/pangea-companion/source'
const EXPORT_API_PATH = '/api/pangea-companion/export'
const ENVIRONMENT_API_PATH = '/api/pangea-companion/environments'
const EXECUTION_API_PATH = '/api/pangea-companion/executions'
const WORKBENCH_API_PATH = '/api/pangea-companion/workbench'
const LAUNCH_LOG_API_PATH = '/api/pangea-companion/launch-log'
const REPOSITORY_API_PATH = '/api/pangea-companion/repositories'
const ACP_SETTINGS_API_PATH = '/api/pangea-companion/acp-settings'

function rpc(payload) {
  return { rpcId: `pangea-companion-${Date.now()}-${Math.random()}`, payload }
}

function apiValue(response) {
  if (!response?.result?.ok) throw new Error(response?.result?.error?.message ?? 'DSH API request failed')
  return response.result.value
}

function runtimeService(runtime, name) {
  return runtime?.[name] ?? runtime?.get?.(name)
}

async function appendLaunchSafe(launchLogs, taskId, event) {
  if (!taskId) return
  try { await launchLogs.append(taskId, event) } catch { /* diagnostics must never change workflow */ }
}

const STATUS_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['run_id'],
  properties: {
    data_root: { type: 'string', description: '可选：PANGEA 数据目录绝对路径。省略时从当前 DSH 工作区自动发现 pangea-data。' },
    run_id: { type: 'string', minLength: 1, description: '必填：当前会话已明确持有或用户指定的 PANGEA Run ID。不允许用无参数查询猜测历史 Run。' },
  },
}

const RUN_CREATE_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['repository', 'target', 'source_scope'],
  properties: {
    repository: { type: 'string', minLength: 1, description: '当前冻结输入中的仓库 ID。创建前只做确定性目录/文件名范围准备。' },
    target: { type: 'string', minLength: 1, description: '用户确认的分析对象原文。' },
    source_scope: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 }, description: '相对仓库根目录的源码范围。' },
    focus: { type: 'array', items: { type: 'string', minLength: 1 } },
    asset_ids: { type: 'array', items: { type: 'string', minLength: 1 } },
    test_case_examples: { type: 'array', items: { type: 'string', minLength: 1 } },
    data_root: { type: 'string' },
    runtime_commit: { type: 'string' },
    model_id: { type: 'string' },
    effective_context_budget: { type: 'integer', minimum: 1 },
  },
}

const RUN_RESUME_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['run_id'],
  properties: {
    data_root: { type: 'string' },
    run_id: { type: 'string', minLength: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 8 },
  },
}

const PHASE_LABELS = {
  PREPARING: '等待 Skill 初始化', STEP_BOOTSTRAP: '初始化 Skill',
  STEP_01: 'Step 01 · 范围与契约', STEP_02: 'Step 02 · 输入与计划', STEP_03: 'Step 03 · 广度盘点',
  STEP_04: 'Step 04 · 深度讲解', STEP_05: 'Step 05 · 场景与风险', STEP_06: 'Step 06 · SFMEA 翻译',
  STEP_07: 'Step 07 · 测试设计', STEP_08: 'Step 08 · 独立 Judge', STEP_09: 'Step 09 · 正式交付',
  PLANNING: 'source-first · Planning 单元划分', ANALYZING: 'source-first · 源码区域分析',
  REVIEWING: 'source-first · 盲审与同会话对照', CLOSING: 'source-first · 定向 closure',
  REPORTING: 'source-first · 报告组装',
  COMPLETE: '已完成', INCOMPLETE: '未完整结束', STOPPED: '已停止', FAILED: '运行失败', UNKNOWN: '未知',
}
const QUALITY_LABELS = { PASS: '通过', UNRESOLVED: '未解决' }
const SOURCE_LABELS = { 'final-state': '最终聚合结果', 'worker-results': '运行中 Worker 结果' }
const HEALTH_LABELS = { ok: '正常', warning: '需关注', error: '异常' }

function workspaceCwd(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : undefined
}

function resolvedDataRoot(exec, value) {
  const root = workspaceRoot(workspaceCwd(exec))
  return path.resolve(root, typeof value === 'string' && value.trim() !== '' ? value : 'pangea-data')
}

function renderCount(run, key, label) {
  const check = run.reader_health?.count_checks?.[key]
  if (check?.status === 'mismatch') {
    return `${label}：读取异常（结构化 ${check.structured} / 报告 ${check.report}）`
  }
  if (run.counts?.[key] === null || run.counts?.[key] === undefined) return `${label}：暂不可读取`
  return `${label}：${run.counts?.[key] ?? 0}`
}

function renderStatus(value) {
  const run = value.current
  if (run === null) return [{ type: 'text', text: `PANGEA 数据目录：${value.data_root}\n当前没有可读取的 Run。` }]
  const health = run.reader_health
  const lines = [
    `PANGEA Run：${run.run_id}`,
    `阶段：${run.phase_title ?? PHASE_LABELS[run.phase] ?? run.phase}`,
    `质量状态：${QUALITY_LABELS[run.quality_status] ?? run.quality_status ?? '待定'}`,
    run.workflow_version === 'source-first-v1'
      ? `源码分析单元：${run.analysis.completed}/${run.analysis.total || '由 Graph action 记录'}`
      : `Skill 步骤：${run.analysis.completed}/${run.analysis.total}`,
    `执行：当前 ${run.analysis.running ?? 0} / 等待 ${run.analysis.pending ?? 0} / 已完成 ${run.analysis.submitted ?? 0}`,
    renderCount(run, 'risks', '风险'),
    renderCount(run, 'test_cases', '测试用例'),
    renderCount(run, 'evidence', '证据'),
    `数据源：${SOURCE_LABELS[run.data_source] ?? run.data_source ?? '未知'}`,
    `源码快照：${['frozen', 'verified', 'manifest_verified'].includes(run.source_snapshot?.status) ? `${run.source_snapshot.file_count ?? 0} 个文件，已复制到 Run` : run.source_snapshot?.status === 'legacy_unavailable' ? '历史 Run 未冻结' : '需要检查'}`,
    `读取健康：${HEALTH_LABELS[health?.status] ?? health?.status ?? '未知'}`,
  ]
  if (health?.status === 'warning') {
    lines.push('重要：当前结构化结果与报告不一致，不能把 0 条风险/用例解释为“没有风险/用例”。')
  }
  if (run.errors.length > 0) {
    lines.push(`当前错误：${run.errors.length}`)
    lines.push(...run.errors.slice(0, 20).map(item => `- ${item.code ?? 'validation_error'}${item.step ? ` · Step ${item.step}` : ''}: ${item.message ?? item}`))
  }
  if (Array.isArray(health?.issues) && health.issues.length > 0) {
    lines.push(`读取诊断：${health.issues.join('；')}`)
  }
  if (run.artifacts.report_md !== null) lines.push(`报告：${run.artifacts.report_md}`)
  return [{ type: 'text', text: lines.join('\n') }]
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function sameOriginBrowserRequest(req) {
  if (req.headers['sec-fetch-site'] === 'same-origin') return true
  const origin = req.headers.origin
  const host = req.headers.host
  if (typeof origin !== 'string' || typeof host !== 'string') return false
  try { return new URL(origin).host === host } catch { return false }
}

async function requestJson(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk.toString('utf8')
    if (body.length > 1024 * 1024) throw new Error('request body is too large')
  }
  const value = JSON.parse(body || '{}')
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('request body must be an object')
  return value
}

function textResponse(res, status, contentType, body, headers = {}) {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store', ...headers })
  res.end(body)
}

// The ACP job is an execution boundary around a Skill Run.  If that boundary
// reaches a terminal failure, the Run's own state file may still say
// "running" because the Skill process did not get a chance to settle it.
// Expose the stronger observed terminal state to readers immediately instead
// of showing a red ACP error next to an apparently active analysis forever.
export function applyTaskExecutionState(snapshot, task) {
  if (!snapshot?.current || !task) return snapshot
  let current = snapshot.current
  const sameRun = typeof task.run_id === 'string' && task.run_id === current.run_id
  const sameDataRoot = !task.data_root || !current.data_root
    || path.resolve(task.data_root) === path.resolve(current.data_root)
  const currentAttempt = Array.isArray(task.attempts)
    ? task.attempts.find(attempt => attempt?.attempt_id === task.attempt_id)
    : null
  if (!sameRun || !sameDataRoot || !task.attempt_id || (currentAttempt && currentAttempt.attempt_id !== task.attempt_id)) return snapshot
  const review = task.host_review
  if (review?.task_id === task.task_id && review.run_id === task.run_id && review.attempt_id === task.attempt_id) {
    const verified = review.status === 'complete' && review.reviewer_turn_completed_at
      && review.producer_session_id && review.reviewer_session_id && review.producer_session_id !== review.reviewer_session_id
    const waiting = review.status === 'waiting' || task.status === 'needs_attention'
    current = { ...current,
      semantic_review: { ...current.semantic_review, method: verified ? 'independent_verified' : 'independent_pending',
        verdict: verified ? review.verdict : null, summary: review.summary ?? '', evidence_status: 'host_recorded',
        producer_session_id: review.producer_session_id, reviewer_session_id: review.reviewer_session_id,
        execution_verification: review.execution_verification ?? null },
      ...(!verified ? { lifecycle_status: waiting ? 'attention_required' : 'running', terminal: waiting,
        phase: review.status === 'pending' && current.lifecycle_status !== 'complete' ? current.phase : 'REVIEW',
        phase_title: review.status === 'pending' && current.lifecycle_status !== 'complete' ? current.phase_title : waiting ? '独立复核需要处理' : review.status === 'verifying' ? '执行校验中' : '独立复核中', attention_required: waiting } : {}),
    }
    snapshot = { ...snapshot, current }
  }
  const executionStatus = task.execution_status
  const failed = task.status === 'failed' || ['failed', 'interrupted'].includes(executionStatus)
  const stopped = task.status === 'stopped' || executionStatus === 'stopped'
  if (!failed && !stopped) return snapshot
  const stateUpdatedAt = Date.parse(current.state_read?.updated_at ?? '')
  const executionEndedAt = currentAttempt?.ended_at ?? task.ended_at
  // The Skill may keep advancing after a runtime connection was classified as
  // interrupted. A newer state file is direct evidence that this terminal
  // execution observation no longer describes the active workflow.
  if (Number.isFinite(stateUpdatedAt) && Number.isFinite(executionEndedAt) && stateUpdatedAt > executionEndedAt) return snapshot
  const message = task.terminal_error || task.launch_error || (failed ? '外部 Agent 执行失败' : 'Run 已停止')
  const error = failed && !(current.errors ?? []).some(item => item?.code === 'ACP_AGENT_FAILED')
    ? { code: 'ACP_AGENT_FAILED', message }
    : null
  return {
    ...snapshot,
    current: {
      ...current,
      lifecycle_status: failed ? 'failed' : 'stopped',
      phase: failed ? 'FAILED' : 'STOPPED',
      phase_title: failed ? '执行失败' : '已停止',
      terminal: true,
      attention_required: failed,
      errors: error ? [...(current.errors ?? []), error] : current.errors,
      external_execution: {
        status: executionStatus || task.status,
        provider: task.provider ?? null,
        task_id: task.task_id,
        attempt_id: task.attempt_id,
        message,
      },
    },
  }
}

async function stateRouteHandler(req, res, monitor, tasks) {
  if (req.method !== 'GET') return json(res, 405, { status: 'error', error: 'method-not-allowed' })
  if (!sameOriginBrowserRequest(req)) return json(res, 403, { status: 'error', error: 'same-origin-browser-request-required' })
  const url = new URL(req.url ?? API_PATH, 'http://localhost')
  const cwd = url.searchParams.get('cwd') ?? undefined
  const dataRoot = url.searchParams.get('data_root') ?? undefined
  const runId = url.searchParams.get('run_id') ?? undefined
  const sessionId = url.searchParams.get('session_id') ?? undefined
  try {
    const snapshot = await companionSnapshot({ cwd, dataRoot, runId, limit: 12 })
    const task = snapshot.current?.run_id ? await tasks.getByRun(snapshot.current.run_id, { dataRoot: snapshot.data_root }) : null
    const effectiveSnapshot = applyTaskExecutionState(snapshot, task)
    if (effectiveSnapshot.current) await monitor.observeRunSnapshot(snapshot.data_root, effectiveSnapshot.current)
    effectiveSnapshot.monitor = await monitor.snapshot({ sessionId, dataRoot: snapshot.data_root, runId: effectiveSnapshot.current?.run_id })
    json(res, 200, effectiveSnapshot)
  } catch (error) {
    json(res, 404, { status: 'error', error: error instanceof Error ? error.message : String(error) })
  }
}

async function sourceRouteHandler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { status: 'error', error: 'method-not-allowed' })
  if (!sameOriginBrowserRequest(req)) return json(res, 403, { status: 'error', error: 'same-origin-browser-request-required' })
  const url = new URL(req.url ?? SOURCE_API_PATH, 'http://localhost')
  const cwd = url.searchParams.get('cwd') ?? undefined
  const dataRoot = url.searchParams.get('data_root') ?? undefined
  const location = url.searchParams.get('location') ?? undefined
  const runId = url.searchParams.get('run_id') ?? undefined
  try {
    let snapshotRoot
    let repositoryId
    let snapshotLayout
    if (runId && dataRoot) {
      const sourceFirstManifestPath = path.join(dataRoot, 'runs', runId, 'inputs', 'source-manifest.json')
      try {
        const sourceFirstManifest = JSON.parse(await readFile(sourceFirstManifestPath, 'utf8'))
        if (sourceFirstManifest?.workflow_version === 'source-first-v1') {
          const parsed = parseEvidenceLocation(location)
          const repositoryLocation = /^([^:/\\]+):(.+)$/.exec(parsed.source)
          if (!repositoryLocation) throw new Error('source-first 原文位置必须使用 repo_id:path:line')
          repositoryId = repositoryLocation[1]
          const known = (sourceFirstManifest.repositories ?? []).some(item => item?.repo_id === repositoryId)
          if (!known) throw new Error(`source-first 原文仓库不在当前冻结输入：${repositoryId}`)
          snapshotRoot = path.join(dataRoot, 'runs', runId, 'inputs', 'source')
          snapshotLayout = 'source-first'
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      if (!snapshotRoot) {
        const metadataPath = path.join(dataRoot, '.pangea', 'skill-runs', runId, 'metadata.json')
        const metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
        repositoryId = metadata.request?.repository
        const candidate = path.join(metadata.run_root, 'inputs', 'source')
        if (metadata.source_snapshot && candidate) snapshotRoot = candidate
      }
    }
    const snippet = await readEvidenceSnippet({ cwd, dataRoot, location, snapshotRoot, repositoryId, snapshotLayout })
    json(res, 200, snippet)
  } catch (error) {
    json(res, 404, { status: 'error', error: error instanceof Error ? error.message : String(error) })
  }
}

async function launchLogRouteHandler(req, res, launchLogs) {
  if (req.method !== 'GET') return json(res, 405, { status: 'error', error: 'method-not-allowed' })
  if (!sameOriginBrowserRequest(req)) return json(res, 403, { status: 'error', error: 'same-origin-browser-request-required' })
  try {
    const url = new URL(req.url ?? LAUNCH_LOG_API_PATH, 'http://localhost')
    const taskId = url.searchParams.get('task_id') ?? ''
    const record = await launchLogs.read(taskId, { limit: 100 })
    return json(res, 200, { status: 'ok', task_id: taskId, ...record })
  } catch (error) {
    return json(res, 400, { status: 'error', error: error instanceof Error ? error.message : String(error) })
  }
}

async function environmentRouteHandler(req, res, store, ssh) {
  if (!sameOriginBrowserRequest(req)) return json(res, 403, { status: 'error', error: 'same-origin-browser-request-required' })
  try {
    if (req.method === 'GET') return json(res, 200, { status: 'ok', environments: await store.list() })
    if (req.method === 'POST') {
      const input = await requestJson(req)
      if (input?.action === 'test') return json(res, 200, { status: 'ok', result: await ssh.test(input.endpoint) })
      return json(res, 200, { status: 'ok', environment: await store.save(input) })
    }
    if (req.method === 'DELETE') {
      const url = new URL(req.url ?? ENVIRONMENT_API_PATH, 'http://localhost')
      const id = url.searchParams.get('id')
      if (!id) return json(res, 400, { status: 'error', error: 'id-is-required' })
      return json(res, 200, { status: 'ok', removed: await store.remove(id) })
    }
    return json(res, 405, { status: 'error', error: 'method-not-allowed' })
  } catch (error) {
    return json(res, 400, { status: 'error', error: error instanceof Error ? error.message : String(error) })
  }
}

async function executionRouteHandler(req, res, store, api) {
  if (req.method !== 'POST') return json(res, 405, { status: 'error', error: 'method-not-allowed' })
  if (!sameOriginBrowserRequest(req)) return json(res, 403, { status: 'error', error: 'same-origin-browser-request-required' })
  try {
    const input = await requestJson(req)
    if (typeof input.analysis_run_id !== 'string' || input.analysis_run_id === '') throw new Error('analysis_run_id is required')
    if (!Array.isArray(input.test_case_ids) || input.test_case_ids.length === 0 || input.test_case_ids.some(value => typeof value !== 'string' || value === '')) {
      throw new Error('test_case_ids must be a non-empty string array')
    }
    if (typeof input.environment_id !== 'string' || input.environment_id === '') throw new Error('environment_id is required')
    if (typeof input.data_root !== 'string' || input.data_root === '') throw new Error('data_root is required')
    const environment = await store.get(input.environment_id)
    if (!environment) throw new Error(`environment not found: ${input.environment_id}`)
    const launched = await launchExecution(api, input, environment)
    return json(res, 200, { status: 'ok', ...launched })
  } catch (error) {
    return json(res, 400, { status: 'error', error: error instanceof Error ? error.message : String(error) })
  }
}

function requireWorkspaceTask(task, cwd, taskId) {
  if (!task) throw new Error(`task not found: ${taskId}`)
  if (task.workspace !== workspaceRoot(cwd)) throw new Error(`task does not belong to current workspace: ${taskId}`)
  return task
}

function sessionFailure(history) {
  const entries = Array.isArray(history?.events) ? history.events : []
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const event = entries[index]?.event ?? entries[index]
    if (event?.type !== 'turn/end' && event?.name !== 'turn/end') continue
    const data = event.data ?? event.payload ?? {}
    if (data?.reason?.kind !== 'error') return null
    const error = data.reason.error ?? data.error
    return {
      code: typeof error?.code === 'string' ? error.code : 'MODEL_REQUEST_FAILED',
      message: typeof error?.message === 'string' ? error.message : '模型请求失败，未创建 PANGEA Run',
    }
  }
  return null
}

async function resolveTaskModel(api, requested) {
  if (requested?.provider && requested?.model) return requireInternalModel(api, requested)
  const catalog = await internalModelOptions(api)
  const usable = catalog.models.filter(item => item.credential_configured)
  if (usable.length === 1) return requireInternalModel(api, usable[0])
  if (usable.length === 0) throw new Error('没有可用的内部模型，请先在“模型”设置中完成配置')
  throw new Error('请选择本次 PANGEA 任务使用的内部模型')
}

function assertRegisteredAcpProvider(runtime, providerId) {
  const option = acpProviderOption(providerId)
  if (!option) throw new Error(`未知的 ACP 执行 Agent：${providerId}`)
  const subagents = runtimeService(runtime, 'subagents')
  if (!subagents?.getProvider?.(option.id)) throw new Error(`ACP Provider 未注册：${option.id}`)
  return option
}

async function reconcileTaskLaunches(api, tasks, taskItems, launchLogs, now = Date.now()) {
  const timeoutMs = 5 * 60 * 1000
  for (const task of taskItems) {
    if (!['preparing', 'running'].includes(task.status)) continue
    if (task.execution_status === 'stopping') continue
    if (task.job_id) continue
    const conversation = [...task.conversations].reverse().find(item => item.kind === 'analysis')
    if (!conversation) continue
    try {
      const history = apiValue(await api.sessions.history(rpc({ sessionId: conversation.session_id, maxMessages: 12 })))
      const failure = sessionFailure(history)
      if (failure) {
        await appendLaunchSafe(launchLogs, task.task_id, {
          stage: 'session_turn_end', status: 'error', session_id: conversation.session_id,
          error_code: failure.code, error: failure.message,
        })
        await tasks.markLaunchFailed(task.task_id, failure.message, failure.code)
        continue
      }
      if (!task.run_id && task.launch_started_at && now - task.launch_started_at >= timeoutMs) {
        try { apiValue(await api.sessions.cancel(rpc({ sessionId: conversation.session_id }))) } catch { /* already stopped */ }
        await appendLaunchSafe(launchLogs, task.task_id, {
          stage: 'launch_timeout', status: 'error', session_id: conversation.session_id,
          error_code: 'LAUNCH_TIMEOUT', error: '启动超时：会话未在 5 分钟内创建 PANGEA Run',
        })
        await tasks.markLaunchFailed(task.task_id, '启动超时：会话未在 5 分钟内创建 PANGEA Run', 'LAUNCH_TIMEOUT')
      }
    } catch (error) {
      if (!task.run_id && task.launch_started_at && now - task.launch_started_at >= timeoutMs) {
        const message = `无法恢复启动会话：${error instanceof Error ? error.message : String(error)}`
        await appendLaunchSafe(launchLogs, task.task_id, {
          stage: 'session_reconcile', status: 'error', session_id: conversation.session_id,
          error_code: 'SESSION_RECONCILE_FAILED', error: message,
        })
        await tasks.markLaunchFailed(task.task_id, message, 'SESSION_RECONCILE_FAILED')
      }
    }
  }
}

function jobOwner(runtime, task) {
  return runtimeService(runtime, 'agents')?.get?.(task.owner_session_id)
}

async function exportRouteHandler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { status: 'error', error: 'method-not-allowed' })
  if (!sameOriginBrowserRequest(req)) return json(res, 403, { status: 'error', error: 'same-origin-browser-request-required' })
  const url = new URL(req.url ?? EXPORT_API_PATH, 'http://localhost')
  const runId = url.searchParams.get('run_id') ?? ''
  const format = url.searchParams.get('format') ?? 'csv'
  try {
    if (!/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error('run_id is required')
    if (!['csv', 'xlsx'].includes(format)) throw new Error('仅支持 CSV 或 XLSX 用例导出')
    const dataRoot = await discoverPangeaDataRoot({
      cwd: url.searchParams.get('cwd') ?? undefined,
      dataRoot: url.searchParams.get('data_root') ?? undefined,
    })
    const run = await summarizeRun(dataRoot, runId, { includeDetails: true })
    const filename = `pangea-${runId}-test-cases.${format}`
    const body = format === 'xlsx' ? buildTestCaseXlsx(run) : buildTestCaseCsv(run)
    const contentType = format === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'text/csv; charset=utf-8'
    return textResponse(res, 200, contentType, body, {
      'content-disposition': `attachment; filename="${filename}"`,
    })
  } catch (error) {
    return json(res, 404, { status: 'error', error: error instanceof Error ? error.message : String(error) })
  }
}

function jobReference(runtime, task, jobId = task?.job_id) {
  return {
    jobId: String(jobId ?? ''),
    ...(task?.attempt_id ? { attemptId: task.attempt_id } : {}),
    ...(task?.owner_session_id ? { ownerSessionId: task.owner_session_id } : {}),
    ...(Number.isFinite(task?.job_started_at) ? { jobStartedAt: task.job_started_at } : {}),
  }
}

function jobIdentityIssue(task, snapshot) {
  if (!snapshot) return `ACP Job ${task?.job_id ?? ''} 不存在，旧执行停止尚未确认`
  if (!Number.isFinite(task?.job_started_at)) return `ACP Job ${task?.job_id ?? ''} 缺少持久化 startedAt，旧执行身份无法确认`
  if (!Number.isFinite(snapshot.startedAt) || snapshot.startedAt !== task.job_started_at) {
    return `ACP Job ${task?.job_id ?? ''} 身份不匹配，旧执行停止尚未确认`
  }
  return null
}

function readJobSnapshot(runtime, task) {
  if (!task?.job_id) return null
  const jobs = runtimeService(runtime, 'jobs')
  if (!jobs?.get) return null
  const snapshot = jobs.get(task.job_id, jobOwner(runtime, task))
  if (snapshot && task.job_started_at !== snapshot.startedAt) throw new Error('ACP Job 身份不匹配，旧执行停止尚未确认')
  return snapshot
}

function deriveTaskResumeEligibility(runtime, task) {
  if (!task?.run_id) return { can_resume: false, resume_blocked_reason: '没有可继续的 Run' }
  if (task.host_review?.reviewer_session_id && task.host_review.status !== 'complete') {
    return { can_resume: false, resume_blocked_reason: '独立复核尚未结束；需恢复原 Producer/Reviewer 会话，不能创建替代会话' }
  }
  if (task.execution_status === 'interrupted') return { can_resume: false, resume_blocked_reason: '旧执行停止尚未确认' }
  if (['preparing', 'starting', 'running', 'stopping'].includes(task.execution_status)) {
    return { can_resume: false, resume_blocked_reason: task.execution_status === 'stopping' ? '正在等待停止确认' : '当前执行仍在进行' }
  }
  const terminal = ['failed', 'stopped'].includes(task.execution_status)
    || ['failed', 'needs_attention', 'stopped'].includes(task.status)
  if (!terminal) return { can_resume: false, resume_blocked_reason: '当前 Run 不满足续跑条件' }
  if (!task.provider) return { can_resume: true, resume_blocked_reason: null }
  if (!task.job_id) {
    return task.agent_session_id || task.process_id
      ? { can_resume: false, resume_blocked_reason: '旧执行停止尚未确认' }
      : { can_resume: true, resume_blocked_reason: null }
  }
  const persistedAttempt = task.attempts?.find(attempt => attempt.attempt_id === task.attempt_id)
  const persistedTerminal = persistedAttempt
    && persistedAttempt.job_id === task.job_id
    && persistedAttempt.owner_session_id === task.owner_session_id
    && Number.isFinite(task.job_started_at)
    && persistedAttempt.job_started_at === task.job_started_at
    && ['completed', 'failed', 'stopped'].includes(persistedAttempt.execution_status)
    && Number.isFinite(persistedAttempt.ended_at)
  if (persistedTerminal) return { can_resume: true, resume_blocked_reason: null }
  let snapshot
  try { snapshot = readJobSnapshot(runtime, task) } catch { return { can_resume: false, resume_blocked_reason: '旧执行停止尚未确认' } }
  const identityIssue = jobIdentityIssue(task, snapshot)
  if (identityIssue) return { can_resume: false, resume_blocked_reason: identityIssue }
  if (!['completed', 'failed', 'killed'].includes(snapshot.status)) {
    return { can_resume: false, resume_blocked_reason: '旧执行仍未结束' }
  }
  return { can_resume: true, resume_blocked_reason: null }
}

async function settleAcpTask(runtime, tasks, launchLogs, snapshot, owner, runner = runPangea, readSnapshot = companionSnapshot) {
  if (snapshot?.kind !== 'subagent') return null
  const ownerSessionId = typeof owner?.id === 'string' ? owner.id : typeof owner?.session_id === 'string' ? owner.session_id : null
  const lookup = {
    ...(ownerSessionId ? { ownerSessionId } : {}),
    ...(Number.isFinite(snapshot?.startedAt) ? { jobStartedAt: snapshot.startedAt } : {}),
  }
  const task = await tasks.getByJob(String(snapshot.id), lookup)
  if (!task) return null
  const attempt = task.attempts?.find(item => item.job_id === String(snapshot.id)
    && (!ownerSessionId || item.owner_session_id === ownerSessionId)
    && (!Number.isFinite(snapshot?.startedAt) || item.job_started_at === snapshot.startedAt))
  const reference = jobReference(runtime, attempt ?? {
    ...task,
    owner_session_id: task.owner_session_id ?? ownerSessionId,
    job_started_at: Number.isFinite(snapshot?.startedAt) ? snapshot.startedAt : task.job_started_at,
  }, snapshot.id)
  let output = ''
  try {
    output = runtimeService(runtime, 'jobs')?.read?.(snapshot.id, owner)?.text ?? ''
  } catch { /* terminal state remains authoritative even if final output cannot be read */ }
  if (output) await tasks.recordJobActivity(reference, output)
  let outcome = snapshot
  const attention = decodeAcpOutcomeDetail(snapshot.detail)
  if (attention) {
    outcome = {
      ...snapshot,
      detail: attention.message,
      attention_required: true,
      attention_code: ATTENTION_REQUIRED_CODE,
    }
  }
  if (snapshot.status === 'completed') {
    try {
      let run = await runner({
        cwd: task.workspace,
        args: ['runs', 'get', '--data-root', task.data_root, '--run-id', task.run_id],
      })
      // Semantic runtime reports use the same source-first reader as the UI.
      // The public CLI's legacy report_available projection does not describe them.
      if (run.workflow_version === 'source-first-v1') {
        const view = await readSnapshot({ cwd: task.workspace, dataRoot: task.data_root, runId: task.run_id })
        if (view.current?.run_id !== task.run_id) throw new Error('当前任务的 source-first Run 不可读取')
        run = view.current
      }
      if (run.lifecycle_status !== 'complete' || run.report_available !== true) {
        outcome = {
          ...snapshot,
          status: 'failed',
          detail: `ACP Agent 已结束，但 Run 未形成通过验证的正式交付（${run.phase ?? run.lifecycle_status ?? 'unknown'}）`,
        }
      }
    } catch (error) {
      outcome = {
        ...snapshot,
        status: 'failed',
        detail: `ACP Agent 已结束，但无法验证 Run 正式交付：${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }
  await appendLaunchSafe(launchLogs, task.task_id, {
    stage: 'acp_job_settled',
    status: outcome.status === 'completed' ? 'ok' : outcome.status === 'killed' ? 'info' : 'error',
    job_id: String(snapshot.id),
    provider: task.provider,
    model: task.model_route?.model,
    reasoning_effort: task.model_route?.reasoning_effort,
    attempt_id: reference.attemptId,
    exit_status: outcome.status,
    detail: outcome.detail,
    output,
  })
  return tasks.settleJob(reference, outcome)
}

async function reconcileAcpJobs(runtime, tasks, taskItems, launchLogs) {
  for (const task of taskItems) {
    if (!task.job_id || !['starting', 'running', 'stopping'].includes(task.execution_status)) continue
    let snapshot
    try {
      const owner = jobOwner(runtime, task)
      const jobs = runtimeService(runtime, 'jobs')
      snapshot = readJobSnapshot(runtime, task)
      const identityIssue = jobIdentityIssue(task, snapshot)
      if (identityIssue) throw new Error(identityIssue)
      const update = jobs?.read?.(task.job_id, owner)
      if (update?.snapshot) {
        const updateIdentityIssue = jobIdentityIssue(task, update.snapshot)
        if (updateIdentityIssue) throw new Error(updateIdentityIssue)
        snapshot = update.snapshot
      }
      if (update?.text) {
        await tasks.recordJobActivity(jobReference(runtime, task), update.text)
        await appendLaunchSafe(launchLogs, task.task_id, {
          stage: 'acp_output', status: 'info', job_id: task.job_id, attempt_id: task.attempt_id, output: update.text,
        })
      }
    } catch (error) {
      const message = `无法恢复 ACP Job ${task.job_id}：${error instanceof Error ? error.message : String(error)}`
      await appendLaunchSafe(launchLogs, task.task_id, {
        stage: 'acp_job_reconcile', status: 'error', job_id: task.job_id,
        attempt_id: task.attempt_id, error_code: 'ACP_JOB_LOST', error: message,
      })
      await tasks.markInterrupted(task.task_id, message)
      continue
    }
    if (!snapshot) {
      const message = `ACP Job ${task.job_id} 不存在，无法证明外部 Agent 仍在运行`
      await appendLaunchSafe(launchLogs, task.task_id, {
        stage: 'acp_job_reconcile', status: 'error', job_id: task.job_id,
        attempt_id: task.attempt_id, error_code: 'ACP_JOB_LOST', error: message,
      })
      await tasks.markInterrupted(task.task_id, message)
      continue
    }
    if (snapshot && ['completed', 'killed', 'failed'].includes(snapshot.status)) {
      await settleAcpTask(runtime, tasks, launchLogs, snapshot, jobOwner(runtime, task))
    }
  }
}

export async function architectureArtifactRoute(req, res, tasks) {
  if (!sameOriginBrowserRequest(req)) return json(res, 403, { status: 'error', error: 'same-origin-browser-request-required' })
  try {
    if (req.method !== 'GET') return json(res, 405, { status: 'error' })
    const url = new URL(req.url, 'http://localhost')
    const task = requireWorkspaceTask(await tasks.get(url.searchParams.get('task_id')), url.searchParams.get('cwd'), url.searchParams.get('task_id'))
    const format = url.searchParams.get('format') || 'html'
    const data = await viewArtifact(task, url.searchParams.get('view_id'), format)
    res.setHeader('Content-Type', format === 'svg' ? 'image/svg+xml' : 'text/html; charset=utf-8')
    res.setHeader('Content-Security-Policy', "sandbox allow-scripts allow-downloads; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'")
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (url.searchParams.get('download') === '1') res.setHeader('Content-Disposition', `attachment; filename="diagram.${format}"`)
    res.end(data)
  } catch (error) { return json(res, 400, { status: 'error', error: error.message }) }
}

export async function workbenchRouteHandler(req, res, api, tasks, launchLocks, launchLogs, runtime, monitor, runner = runPangea) {
  if (!sameOriginBrowserRequest(req)) return json(res, 403, { status: 'error', error: 'same-origin-browser-request-required' })
  const url = new URL(req.url ?? WORKBENCH_API_PATH, 'http://localhost')
  const cwd = url.searchParams.get('cwd') ?? undefined
  const dataRoot = url.searchParams.get('data_root') ?? undefined
  const runId = url.searchParams.get('run_id') ?? undefined
  const taskId = url.searchParams.get('task_id') ?? undefined
  const sessionId = url.searchParams.get('session_id') ?? undefined
  try {
    if (req.method === 'GET') {
      const snapshot = await workbenchSnapshot({
        cwd,
        dataRoot,
        runId,
        cursor: url.searchParams.get('cursor') ?? 0,
        limit: url.searchParams.get('limit') ?? 20,
      })
      await tasks.reconcileRuns(snapshot.runs?.items, { dataRoot: snapshot.data_root })
      let taskItems = await tasks.list({ workspace: workspaceRoot(cwd) })
      await reconcileAcpJobs(runtime, tasks, taskItems, launchLogs)
      taskItems = await tasks.list({ workspace: workspaceRoot(cwd) })
      await reconcileTaskLaunches(api, tasks, taskItems, launchLogs)
      taskItems = await tasks.list({ workspace: workspaceRoot(cwd) })
      taskItems = taskItems.map(task => ({ ...task, ...deriveTaskResumeEligibility(runtime, task) }))
      let modelRouting
      try {
        modelRouting = { status: 'ok', ...await internalModelOptions(api) }
      } catch (error) {
        modelRouting = { status: 'error', models: [], failures: [], error: error instanceof Error ? error.message : String(error) }
      }
      const selectedCandidate = taskId
        ? taskItems.find(item => item.task_id === taskId)
        : sessionId ? taskItems.find(item => item.conversations?.some(conversation => conversation.session_id === sessionId)) : null
      const selectedTask = selectedCandidate?.workspace === workspaceRoot(cwd) ? selectedCandidate : null
      const launchLog = selectedTask ? await launchLogs.read(selectedTask.task_id, { limit: 100 }) : null
      let acpJob = null
      if (selectedTask?.job_id && ['starting', 'running', 'stopping'].includes(selectedTask.execution_status)) {
        try { acpJob = readJobSnapshot(runtime, selectedTask) } catch { /* reconciliation already persisted the exact error */ }
      }
      return json(res, 200, {
        ...snapshot,
        tasks: { items: taskItems, total: taskItems.length },
        model_routing: modelRouting,
        acp_providers: acpProviderOptions().map(provider => ({
          ...provider,
          registered: Boolean(runtimeService(runtime, 'subagents')?.getProvider?.(provider.id)),
        })),
        selected_task_id: selectedTask?.task_id ?? null,
        acp_job: acpJob,
        launch_log: launchLog,
      })
    }
    if (req.method !== 'POST') return json(res, 405, { status: 'error', error: 'method-not-allowed' })
    const body = await requestJson(req)
    const actionDataRoot = typeof body.data_root === 'string' ? body.data_root : dataRoot
    if (body.action === 'coverage-refresh') {
      const task = requireWorkspaceTask(await tasks.get(body.task_id), cwd, body.task_id)
      if (!task.run_id || body.run_id !== task.run_id) throw new Error('覆盖率请求不属于当前任务的 Run')
      if (['starting', 'running', 'stopping'].includes(task.execution_status)) throw new Error('请先停止当前分析，再修正覆盖率查询，避免输入在分析过程中变化')
      const folder = await mkdtemp(path.join(os.tmpdir(), 'pangea-coverage-refresh-'))
      try {
        const file = path.join(folder, 'query.json')
        await writeFile(file, JSON.stringify(body.query), 'utf8')
        const page = await runner({ cwd: task.workspace, args: ['runs', 'coverage-refresh', '--data-root', task.data_root, '--run-id', task.run_id, '--query-file', file] })
        return json(res, 200, { status: 'ok', run_id: task.run_id, page })
      } finally { await rm(folder, { recursive: true, force: true }) }
    }
    if (body.action === 'coverage-page') {
      const task = requireWorkspaceTask(await tasks.get(body.task_id), cwd, body.task_id)
      if (!task.run_id || body.run_id !== task.run_id) throw new Error('覆盖率请求不属于当前任务的 Run')
      const args = ['runs', 'coverage-page', '--data-root', task.data_root, '--run-id', task.run_id]
      for (const [key, flag] of Object.entries({ cursor: '--cursor', limit: '--limit', source: '--source',
        file_path: '--file-path', kind: '--kind', scope_status: '--scope-status', flow_id: '--flow-id', query: '--query',
        analysis_status: '--analysis-status', disposition: '--disposition' })) {
        if (body[key] !== undefined && body[key] !== null && body[key] !== '') args.push(flag, String(body[key]))
      }
      const page = await runner({ cwd: task.workspace, args })
      return json(res, 200, { status: 'ok', run_id: task.run_id, page })
    }
    if (body.action.startsWith('architecture-')) {
      const task = requireWorkspaceTask(await tasks.get(body.task_id), cwd, body.task_id)
      if (!task.run_id) throw new Error('任务尚未关联 Run')
      if (body.action === 'architecture-list') {
        const views = await listViews(task)
        for (const view of views.filter(v => ['generating', 'ready'].includes(v.status))) {
          if (view.available && !view.job_id) continue
          if (view.job_id) {
            const owner = runtimeService(runtime, 'agents')?.get?.(view.owner_session_id)
            const jobs = runtimeService(runtime, 'jobs')
            let job
            try { job = owner ? jobs?.get?.(view.job_id, owner) : null } catch { job = null }
            if (job?.startedAt === view.job_started_at) {
              let output = view.output ?? ''
              try { output = jobs.read(view.job_id, owner)?.text?.slice(-12000) || output } catch { /* Retain last captured output. */ }
              const changed = output !== (view.output ?? '')
              const changes = { execution_status: job.status, output,
                ...(changed ? { last_activity_at: new Date().toISOString() } : {}) }
              if (changed || view.execution_status !== job.status) Object.assign(view, await updateView(task, view.view_id, changes), { status: view.status })
            }
            if (view.available) continue
            if (!job || job.startedAt !== view.job_started_at || ['failed', 'killed', 'completed'].includes(job.status)) {
              Object.assign(view, await updateView(task, view.view_id, { status: !job || job.startedAt !== view.job_started_at ? 'interrupted' : job.status === 'killed' ? 'stopped' : 'failed', execution_status: job?.status ?? 'interrupted', error: !job ? '执行状态不可确认：画图 Job 已不可读取。已保留会话和输出。' : job.detail || '画图执行已结束，尚无验证通过的产物。' }))
            }
          } else if (view.session_id) {
            try {
            const history = apiValue(await api.sessions.history(rpc({ sessionId: view.session_id, maxMessages: 12 })))
            const failure = sessionFailure(history)
            const lastTurnEvent = [...(history?.events ?? [])].reverse().map(item => item.event ?? item).find(event => ['turn/start', 'turn/end'].includes(event.type ?? event.name))
            if (failure || (lastTurnEvent?.type ?? lastTurnEvent?.name) === 'turn/end') Object.assign(view, await updateView(task, view.view_id, { status: 'failed', error: failure?.message ?? '画图回合已结束，尚无验证通过的产物。可打开会话继续处理。' }))
            } catch (error) {
              Object.assign(view, await updateView(task, view.view_id, { status: 'interrupted', error: `画图会话状态不可确认：${error.message}` }))
            }
          }
        }
        return json(res, 200, { status: 'ok', views })
      }
      if (body.action === 'architecture-create') {
        const prepared = await createView(task, { type: body.type, flow_id: body.flow_id, previous_view_id: body.previous_view_id, branch_ids: body.branch_ids })
        try {
          const launched = await launchArchitectureSession(api, { cwd, task, prompt: prepared.prompt + (body.instruction ? `\n用户修改要求：${body.instruction}` : ''),
            onEvent: event => updateView(task, prepared.view.view_id, { launch_stage: event.stage, last_activity_at: new Date().toISOString(),
              ...(event.error ? { error: event.error.message ?? String(event.error) } : {}) }),
            onSession: async sessionId => {
              await updateView(task, prepared.view.view_id, { session_id: sessionId })
              await tasks.addConversation(task.task_id, { sessionId, title: `架构视图 · ${task.target}`, kind: 'architecture', activate: false })
            },
            onJob: details => updateView(task, prepared.view.view_id, { job_id: details.jobId, job_started_at: details.jobStartedAt, owner_session_id: details.ownerSessionId }),
          }, runtime)
          return json(res, 200, { status: 'ok', ...launched, view: await loadView(task, prepared.view.view_id) })
        } catch (error) {
          await updateView(task, prepared.view.view_id, { status: 'failed', error: error.message })
          throw error
        }
      }
      if (body.action === 'architecture-stop') {
        const view = await loadView(task, body.view_id)
        if (view.job_id) {
          const owner = runtimeService(runtime, 'agents')?.get?.(view.owner_session_id)
          if (!owner) throw new Error('图会话所有者不可用，未确认停止')
          const jobs = runtimeService(runtime, 'jobs')
          const job = jobs?.get?.(view.job_id, owner)
          if (!job || job.startedAt !== view.job_started_at) throw new Error('图任务绑定不可验证')
          await jobs.kill(view.job_id, owner)
        }
        if (view.session_id) apiValue(await api.sessions.cancel(rpc({ sessionId: view.session_id })))
        return json(res, 200, { status: 'ok', view: await updateView(task, body.view_id, { status: 'stopped' }) })
      }
      throw new Error('Unknown architecture action')
    }
    if (body.action === 'task-create') {
      const root = workspaceRoot(cwd)
      if (body.input?.source_task_id) requireWorkspaceTask(await tasks.get(body.input.source_task_id), cwd, body.input.source_task_id)
      const providerId = typeof body.input?.provider_id === 'string' ? body.input.provider_id.trim() : ''
      if (providerId && !acpProviderOption(providerId)) throw new Error(`未知的 ACP 执行 Agent：${providerId}`)
      const selectedModel = providerId ? null : await resolveTaskModel(api, body.input?.model_route)
      const task = await tasks.create({
        workspace: root,
        dataRoot: dataRootFor(root, actionDataRoot),
        input: { ...body.input, provider_id: providerId || null, model_route: selectedModel },
      })
      await appendLaunchSafe(launchLogs, task.task_id, { stage: 'task_created', status: 'ok' })
      return json(res, 200, { status: 'ok', task })
    }
    if (body.action === 'task-start') {
      const task = requireWorkspaceTask(await tasks.get(body.task_id), cwd, body.task_id)
      const resume = body.resume === true
      const resumeEligibility = deriveTaskResumeEligibility(runtime, task)
      if (task.run_id && !resume) throw new Error('task already has a Run; use resume to continue it')
      if (resume && !task.run_id) throw new Error('没有可继续的 Run')
      if (resume && !resumeEligibility.can_resume) throw new Error(resumeEligibility.resume_blocked_reason)
      if (launchLocks.has(task.task_id)) throw new Error('task launch is already in progress')
      launchLocks.add(task.task_id)
      await appendLaunchSafe(launchLogs, task.task_id, { stage: 'launch_requested', status: 'start', message: `${resume ? '继续分析' : '启动'}尝试 ${task.launch_attempts + 1}` })
      let preparedTask = task
      try {
        const selectedProvider = body.provider_id ?? task.provider
        let selectedModel = null
        if (selectedProvider) {
          const providerOption = assertRegisteredAcpProvider(runtime, selectedProvider)
          await appendLaunchSafe(launchLogs, task.task_id, {
            stage: 'acp_provider_resolve', status: 'ok', provider: selectedProvider,
            configured_command: providerOption.command,
            resolved_command: providerOption.resolved_command ?? providerOption.command,
            launcher_kind: providerOption.launcher_kind
              ?? (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(providerOption.resolved_command ?? providerOption.command)
                ? 'windows-batch'
                : 'direct'),
          })
          preparedTask = await tasks.prepareProviderLaunch(task.task_id, selectedProvider)
        } else {
          await appendLaunchSafe(launchLogs, task.task_id, { stage: 'model_route_resolve', status: 'start' })
          selectedModel = await resolveTaskModel(api, body.model_route ?? task.model_route)
          await appendLaunchSafe(launchLogs, task.task_id, {
            stage: 'model_route_resolve', status: 'ok', provider: selectedModel.provider, model: selectedModel.model,
          })
          preparedTask = await tasks.prepareLaunch(task.task_id, selectedModel)
        }
        await appendLaunchSafe(launchLogs, task.task_id, { stage: 'task_prepare', status: 'ok' })
        let launchedRun = null
        const launched = await launchAnalysisSession(api, {
          cwd,
          dataRoot: actionDataRoot ?? task.data_root,
          input: { ...task, provider_id: selectedProvider || null, agent_model: preparedTask.agent_model },
          model: selectedModel,
          resumeRunId: resume ? task.run_id : null,
        }, runner, session => tasks.addConversation(task.task_id, {
          sessionId: session.session_id,
          title: `${task.title} · 分析`,
          kind: 'analysis',
        }), async event => {
          await launchLogs.append(task.task_id, { ...event, attempt_id: preparedTask.attempt_id })
        }, runtime, process.env, {
          reviewBinding: { task_id: task.task_id, attempt_id: preparedTask.attempt_id },
          onReviewState: value => tasks.recordReview(task.task_id, value),
          onReviewWaiting: async message => {
            const current = await tasks.get(task.task_id)
            if (current.host_review) await tasks.recordReview(task.task_id, { ...current.host_review, status: 'waiting', summary: message })
          },
          onRunReady: async run => {
            launchedRun = run
            const bound = await tasks.bindRun(task.task_id, run.run_id, run.workflow_version)
            if (!resume && selectedProvider && supportsHostReview(bound)) await tasks.recordReview(task.task_id, {
              task_id: task.task_id, attempt_id: preparedTask.attempt_id, run_id: run.run_id, data_root: bound.data_root, status: 'pending',
            })
            return bound
          },
          onOwnerReady: async ({ ownerSessionId }) => {
            const bound = await tasks.bindOwnerSession(task.task_id, {
              attemptId: preparedTask.attempt_id,
              ownerSessionId,
            })
            try {
              await monitor.bindExecution(ownerSessionId, {
                run_id: launchedRun?.run_id ?? bound.run_id,
                data_root: bound.data_root,
                phase: 'PREPARING',
                analysis: { completed: 0, total: launchedRun?.workflow?.steps?.length ?? null, reworked: 0 },
              }, {
                dataRoot: bound.data_root,
                taskId: bound.task_id,
                attemptId: preparedTask.attempt_id,
              })
            } catch (error) {
              await appendLaunchSafe(launchLogs, task.task_id, {
                stage: 'monitor_bind', status: 'error', error,
                error_code: 'MONITOR_IDENTITY_CONFLICT', attempt_id: preparedTask.attempt_id,
              })
            }
            return bound
          },
          onJobCreated: async ({ jobId, ownerSessionId, jobStartedAt }) => {
            const bound = await tasks.bindJob(task.task_id, {
              jobId,
              provider: selectedProvider,
              ownerSessionId,
              attemptId: preparedTask.attempt_id,
              jobStartedAt,
            })
            if (bound.execution_status === 'stopping') {
              const error = new Error('PANGEA 分析已请求停止，ACP 尚未放行')
              error.code = 'PANGEA_STOP_REQUESTED'
              throw error
            }
            return bound
          },
          onAgentStarted: ({ agent_session_id, pid }) => tasks.bindAgentRuntime(task.task_id, {
            attemptId: preparedTask.attempt_id,
            agentSessionId: agent_session_id,
            processId: pid,
          }),
        })
        await appendLaunchSafe(launchLogs, task.task_id, { stage: 'session_launch_complete', status: 'ok', session_id: launched.session_id, attempt_id: preparedTask.attempt_id })
        const updatedTask = await tasks.get(task.task_id)
        return json(res, 200, { ...launched, task: { ...updatedTask, ...deriveTaskResumeEligibility(runtime, updatedTask) } })
      } catch (error) {
        await appendLaunchSafe(launchLogs, task.task_id, {
          stage: 'launch_failed', status: 'error', error,
          error_code: typeof error?.code === 'string' ? error.code : 'LAUNCH_FAILED',
          attempt_id: preparedTask.attempt_id,
        })
        const latest = await tasks.get(task.task_id)
        if (latest?.execution_status === 'stopping' || error?.code === 'PANGEA_STOP_REQUESTED') {
          await tasks.markStopped(task.task_id, error?.code === 'PANGEA_STOP_REQUESTED' ? null : error)
        } else {
          await tasks.markLaunchFailed(
            task.task_id,
            error instanceof Error ? error.message : String(error),
            typeof error?.code === 'string' ? error.code : 'LAUNCH_FAILED',
          )
        }
        throw error
      } finally {
        launchLocks.delete(task.task_id)
      }
    }
    if (body.action === 'task-conversation-create') {
      const task = requireWorkspaceTask(await tasks.get(body.task_id), cwd, body.task_id)
      const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : `${task.title} · 新会话`
      const created = await createTaskConversation(api, { cwd, title })
      const updated = await tasks.addConversation(task.task_id, { sessionId: created.session_id, title })
      return json(res, 200, { ...created, task: updated })
    }
    if (body.action === 'task-conversation-activate') {
      requireWorkspaceTask(await tasks.get(body.task_id), cwd, body.task_id)
      const task = await tasks.activateConversation(body.task_id, body.conversation_id)
      return json(res, 200, { status: 'ok', task })
    }
    if (body.action === 'stop') {
      // Legacy ordering contract: const stopped = await stopAnalysisRun({ cwd, dataRoot: actionDataRoot, runId: body.run_id })
      const currentWorkspace = workspaceRoot(cwd)
      const storedTask = body.task_id ? await tasks.get(body.task_id) : null
      if (body.task_id && !storedTask) throw new Error(`task not found: ${body.task_id}`)
      const runId = body.run_id ?? storedTask?.run_id
      if (!runId) throw new Error('run_id or task_id is required')
      let requestedTask = storedTask
      // The UI can retain a task selection while the user changes workspace
      // (or after a portable install moves the repository).  Do not reject an
      // explicit, exact task+Run stop; rebind only that task so its history is
      // visible in the current workspace.  A task-only request remains strict.
      if (requestedTask && requestedTask.workspace !== currentWorkspace) {
        if (!body.run_id || requestedTask.run_id !== runId) {
          throw new Error(`task does not belong to current workspace: ${body.task_id}`)
        }
        requestedTask = await tasks.rebindWorkspace(requestedTask.task_id, currentWorkspace)
        await appendLaunchSafe(launchLogs, requestedTask.task_id, {
          stage: 'workspace_rebind', status: 'ok', previous_workspace: storedTask.workspace, workspace: currentWorkspace,
        })
      }
      const stopJobs = runtimeService(runtime, 'jobs')
      if (requestedTask && ['preparing', 'starting', 'running'].includes(requestedTask.execution_status ?? (requestedTask.status === 'running' ? 'running' : ''))) {
        requestedTask = await tasks.markStopping(requestedTask.task_id)
      }
      let jobStop = { status: 'not_bound', job_id: requestedTask?.job_id ?? null, error: null }
      if (requestedTask?.job_id && stopJobs?.kill) {
        const owner = runtimeService(runtime, 'agents')?.get?.(requestedTask.owner_session_id)
        try {
          const identityIssue = jobIdentityIssue(requestedTask, stopJobs.get?.(requestedTask.job_id, owner))
          if (identityIssue) throw new Error(identityIssue)
          const result = await stopJobs.kill(requestedTask.job_id, owner, '用户请求停止 PANGEA 分析')
          jobStop = { status: 'ok', job_id: requestedTask.job_id, result, error: null }
          await appendLaunchSafe(launchLogs, requestedTask.task_id, { stage: 'acp_job_stop', status: 'ok', job_id: requestedTask.job_id, result })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          jobStop = { status: 'error', job_id: requestedTask.job_id, error: message }
          // A dead/unavailable ACP service must not prevent the local Run and
          // DSH session cancellation from being attempted.  Keep the precise
          // error in launch diagnostics and in the response instead.
          await appendLaunchSafe(launchLogs, requestedTask.task_id, { stage: 'acp_job_stop', status: 'error', job_id: requestedTask.job_id, error: message })
        }
      }
      // Resolve the data root from the task record. This prevents a stale UI
      // selection from stopping a run in another workspace/data directory.
      let stopped
      let runStopError = null
      try {
        stopped = await stopAnalysisRun({ cwd, dataRoot: requestedTask?.data_root ?? actionDataRoot, runId })
      } catch (error) {
        runStopError = error instanceof Error ? error.message : String(error)
        stopped = {
          status: 'partial',
          data_root: requestedTask?.data_root ?? actionDataRoot,
          run: { run_id: runId, lifecycle_status: 'stopped', status: 'stopped' },
        }
        if (requestedTask) await appendLaunchSafe(launchLogs, requestedTask.task_id, { stage: 'run_stop_sync', status: 'error', error: runStopError })
      }
      const task = requestedTask ?? await tasks.getByRun(runId, { dataRoot: stopped.data_root })
      const analysis = task ? [...task.conversations].reverse().find(item => item.kind === 'analysis') : null
      let sessionCancel = { status: 'not_bound', session_id: null, error: null }
      if (analysis) {
        try {
          apiValue(await api.sessions.cancel(rpc({ sessionId: analysis.session_id })))
          sessionCancel = { status: 'ok', session_id: analysis.session_id, error: null }
        } catch (error) {
          sessionCancel = {
            status: 'error',
            session_id: analysis.session_id,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      }
      await tasks.reconcileRuns([stopped.run], { dataRoot: stopped.data_root })
      const stopError = [runStopError, jobStop.error].filter(Boolean).join('；') || null
      const jobBound = Boolean(task?.job_id)
      const stopConfirmed = !jobBound && !launchLocks.has(task?.task_id) || jobStop.result === 'already-finished'
      if (task && stopConfirmed) {
        if (jobStop.result === 'already-finished') {
          try {
            const snapshot = readJobSnapshot(runtime, task)
            if (['completed', 'failed', 'killed'].includes(snapshot?.status)) {
              await settleAcpTask(runtime, tasks, launchLogs, snapshot, jobOwner(runtime, task))
            }
          } catch { /* the stop response still reports the exact confirmation state */ }
        }
        await tasks.markStopped(task.task_id, stopError)
      } else if (task && stopError) {
        await tasks.markStopping(task.task_id, stopError)
      }
      const updatedTask = task ? await tasks.get(task.task_id) : null
      return json(res, 200, {
        ...stopped,
        job_stop: jobStop,
        run_stop: runStopError ? { status: 'error', error: runStopError } : { status: 'ok', error: null },
        session_cancel: sessionCancel,
        task: updatedTask ? { ...updatedTask, ...deriveTaskResumeEligibility(runtime, updatedTask) } : null,
      })
    }
    return json(res, 400, { status: 'error', error: 'unsupported-action' })
  } catch (error) {
    return json(res, 400, { status: 'error', error: error instanceof Error ? error.message : String(error) })
  }
}

async function repositoryRouteHandler(req, res) {
  if (!sameOriginBrowserRequest(req)) return json(res, 403, { status: 'error', error: 'same-origin-browser-request-required' })
  const url = new URL(req.url ?? REPOSITORY_API_PATH, 'http://localhost')
  const cwd = url.searchParams.get('cwd') ?? process.env.PANGEA_WORKSPACE_ROOT ?? undefined
  const explicitDataRoot = url.searchParams.get('data_root') ?? undefined
  try {
    const dataRoot = dataRootFor(workspaceRoot(cwd), explicitDataRoot ?? process.env.PANGEA_DATA_ROOT)
    if (req.method === 'GET') return json(res, 200, await repositoryStatus(dataRoot))
    if (req.method !== 'POST') return json(res, 405, { status: 'error', error: 'method-not-allowed' })
    const body = await requestJson(req)
    const imported = await importRepository({
      dataRoot,
      sourcePath: body.source_path,
      repositoryId: body.repository_name,
    })
    return json(res, 200, { status: 'ok', repository: imported })
  } catch (error) {
    return json(res, 400, { status: 'error', error: error instanceof Error ? error.message : String(error) })
  }
}

export async function acpSettingsRouteHandler(req, res, settings, runtime) {
  if (!sameOriginBrowserRequest(req)) return json(res, 403, { status: 'error', error: 'same-origin-browser-request-required' })
  try {
    if (req.method === 'GET') {
      const config = await settings.read()
      return json(res, 200, {
        status: 'ok',
        config,
        providers: acpProviderOptions().map(provider => ({
          ...provider,
          registered: Boolean(runtimeService(runtime, 'subagents')?.getProvider?.(provider.id)),
        })),
      })
    }
    if (req.method === 'POST') {
      const body = await requestJson(req)
      if (body.action === 'models') {
        const controller = new AbortController()
        const disconnect = () => { if (!res.writableEnded) controller.abort(new Error('模型列表请求已取消')) }
        res.on('close', disconnect)
        try {
          const catalog = await discoverAgentModels(runtime, { providerId: body.provider_id, cwd: body.cwd, signal: controller.signal })
          return json(res, 200, { status: 'ok', ...catalog })
        } finally { res.removeListener('close', disconnect) }
      }
      if (body.action === 'test') {
        const checks = acpProviderOptions().map(provider => {
          const registered = Boolean(runtimeService(runtime, 'subagents')?.getProvider?.(provider.id))
          const reasons = []
          if (!provider.available) reasons.push(provider.resolution_error ?? '启动命令不可用')
          if (!registered) reasons.push('Provider 未注册')
          return { id: provider.id, label: provider.label, ok: reasons.length === 0, registered, reasons }
        })
        return json(res, 200, { status: 'ok', checks })
      }
      if (body.action !== 'save') return json(res, 400, { status: 'error', error: 'unsupported-action' })
      const config = await settings.save(body.config)
      return json(res, 200, { status: 'ok', config, restart_required: true })
    }
    return json(res, 405, { status: 'error', error: 'method-not-allowed' })
  } catch (error) {
    return json(res, 400, { status: 'error', error: error instanceof Error ? error.message : String(error) })
  }
}

function toolOutput() {
  return { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

const SOURCE_BINDING_PROPERTIES = {
  data_root: { type: 'string', minLength: 1, description: 'Graph 返回的当前 Run 数据根目录。' },
  run_id: { type: 'string', minLength: 1 },
  action_id: { type: 'string', minLength: 1 },
  task_id: { type: 'string', minLength: 1 },
}

function sourceCommandArgs(args, { includeTask = true } = {}) {
  const values = ['--data-root', args.data_root, '--run-id', args.run_id, '--action-id', args.action_id]
  if (includeTask) values.push('--task-id', args.task_id)
  return values
}

function optionalCommandArg(values, flag, value) {
  if (value === undefined || value === null || value === '') return
  values.push(flag, String(value))
}

async function executeSourceFirst(exec, command, values) {
  return runSourceFirstCommand(workspaceCwd(exec), [command, ...values])
}

export function sourceFirstTools(ctx, execute = executeSourceFirst) {
  const binding = (required = ['data_root', 'run_id', 'action_id', 'task_id']) => ({
    type: 'object',
    additionalProperties: false,
    required,
    properties: SOURCE_BINDING_PROPERTIES,
  })
  return [
    ctx.tools.register({
      name: 'pangea_task_open',
      description: '读取 Graph 为当前真实 task_id 创建的任务合同。',
      parameters: binding(),
      async execute(args, exec) {
        return execute(exec, 'task-open', sourceCommandArgs(args))
      },
      output: toolOutput(),
    }),
    ctx.tools.register({
      name: 'pangea_input_read',
      description: '按 input_id 分页读取当前 task 明确授权的冻结资料或方法论。',
      parameters: { ...binding(), required: [...binding().required, 'input_id'], properties: { ...SOURCE_BINDING_PROPERTIES, input_id: { type: 'string', minLength: 1 }, cursor: { type: 'string' }, max_chars: { type: 'integer', minimum: 1, maximum: 24000 } } },
      async execute(args, exec) {
        const values = [...sourceCommandArgs(args), '--input-id', args.input_id]
        optionalCommandArg(values, '--cursor', args.cursor)
        optionalCommandArg(values, '--max-chars', args.max_chars)
        return execute(exec, 'input-read', values)
      },
      output: toolOutput(),
    }),
    ctx.tools.register({
      name: 'pangea_action_next',
      description: '读取当前明确 Run 的待处理 action。只把 Graph 返回的 exact action_id 交给 bind/settle，不根据顺序或单元名猜测。',
      parameters: { type: 'object', additionalProperties: false, required: ['data_root', 'run_id'], properties: { data_root: SOURCE_BINDING_PROPERTIES.data_root, run_id: SOURCE_BINDING_PROPERTIES.run_id, limit: { type: 'integer', minimum: 1, maximum: 8 } } },
      async execute(args, exec) {
        const values = ['--data-root', args.data_root, '--run-id', args.run_id]
        optionalCommandArg(values, '--limit', args.limit)
        return execute(exec, 'adapter', ['next', ...values])
      },
      output: toolOutput(),
    }),
    ctx.tools.register({
      name: 'pangea_action_bind',
      description: '把一个 Graph action 绑定到当前真实 Agent task。continue_agent 只能回显并复用 Graph 已记录的原 task_id。',
      parameters: binding(),
      async execute(args, exec) {
        return execute(exec, 'adapter', ['bind', ...sourceCommandArgs(args)])
      },
      output: toolOutput(),
    }),
    ctx.tools.register({
      name: 'pangea_action_settle',
      description: '按 exact action_id 在一次调用内校验并推进当前 Run；不要先调用 validate，也不要把另一个 action 的通知当作当前 action。',
      parameters: binding(['data_root', 'run_id', 'action_id']),
      async execute(args, exec) {
        return execute(exec, 'adapter', ['settle', ...sourceCommandArgs(args, { includeTask: false })])
      },
      output: toolOutput(),
    }),
    ctx.tools.register({
      name: 'pangea_source_index',
      description: '先读取紧凑文件目录；提供 repo_id+path 后分页读取该文件的稳定 region 坐标。',
      parameters: { ...binding(), properties: { ...SOURCE_BINDING_PROPERTIES, repo_id: { type: 'string' }, path: { type: 'string' }, cursor: { type: 'string' }, page_size: { type: 'integer', minimum: 1, maximum: 200 } } },
      async execute(args, exec) {
        const values = [...sourceCommandArgs(args)]
        optionalCommandArg(values, '--repo-id', args.repo_id)
        optionalCommandArg(values, '--path', args.path)
        optionalCommandArg(values, '--cursor', args.cursor)
        optionalCommandArg(values, '--page-size', args.page_size)
        return execute(exec, 'source-index', values)
      },
      output: toolOutput(),
    }),
    ctx.tools.register({
      name: 'pangea_source_read',
      description: '按当前 task 的 region 或精确范围读取冻结原文；越权路径与不属于本 task 的 region 会被拒绝。',
      parameters: { ...binding(), required: [...binding().required, 'repo_id'], properties: { ...SOURCE_BINDING_PROPERTIES, repo_id: { type: 'string', minLength: 1 }, path: { type: 'string' }, region_id: { type: 'string' }, line_start: { type: 'integer', minimum: 1 }, line_end: { type: 'integer', minimum: 1 }, cursor: { type: 'string' }, max_lines: { type: 'integer', minimum: 1, maximum: 2000 } } },
      async execute(args, exec) {
        const values = [...sourceCommandArgs(args), '--repo-id', args.repo_id]
        for (const [flag, value] of [['--path', args.path], ['--region-id', args.region_id], ['--line-start', args.line_start], ['--line-end', args.line_end], ['--cursor', args.cursor], ['--max-lines', args.max_lines]]) optionalCommandArg(values, flag, value)
        return execute(exec, 'source-read', values)
      },
      output: toolOutput(),
    }),
    ctx.tools.register({
      name: 'pangea_source_search',
      description: '在当前 task 允许的冻结源码范围内做字面搜索，只返回原文命中和定位，不生成语义调用关系。',
      parameters: { ...binding(), required: [...binding().required, 'query'], properties: { ...SOURCE_BINDING_PROPERTIES, query: { type: 'string', minLength: 1 }, repo_id: { type: 'string' }, path: { type: 'string' }, cursor: { type: 'string' }, page_size: { type: 'integer', minimum: 1, maximum: 512 } } },
      async execute(args, exec) {
        const values = [...sourceCommandArgs(args), '--query', args.query]
        for (const [flag, value] of [['--repo-id', args.repo_id], ['--path', args.path], ['--cursor', args.cursor], ['--page-size', args.page_size]]) optionalCommandArg(values, flag, value)
        return execute(exec, 'source-search', values)
      },
      output: toolOutput(),
    }),
    ctx.tools.register({
      name: 'pangea_result_write',
      description: '向 Graph 创建的当前 task result_path 增量写入少量原文 records；body 原样保存，revision 冲突局部恢复。',
      parameters: { ...binding(), required: [...binding().required, 'expected_revision', 'records'], properties: { ...SOURCE_BINDING_PROPERTIES, expected_revision: { type: 'integer', minimum: 0 }, records: { type: 'array', minItems: 1 }, request_id: { type: 'string' } } },
      async execute(args, exec) {
        const values = [...sourceCommandArgs(args), '--expected-revision', String(args.expected_revision), '--records', JSON.stringify(args.records)]
        optionalCommandArg(values, '--request-id', args.request_id)
        return execute(exec, 'result-write', values)
      },
      output: toolOutput(),
    }),
    ctx.tools.register({
      name: 'pangea_result_read',
      description: '读取当前 task 已保存的原文 records、revision 和 completion；不从其他 Run 或结果路径兜底。',
      parameters: { ...binding(), properties: { ...SOURCE_BINDING_PROPERTIES, record_id: { type: 'string' }, cursor: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 500 } } },
      async execute(args, exec) {
        const values = [...sourceCommandArgs(args)]
        for (const [flag, value] of [['--record-id', args.record_id], ['--cursor', args.cursor], ['--limit', args.limit]]) optionalCommandArg(values, flag, value)
        return execute(exec, 'result-read', values)
      },
      output: toolOutput(),
    }),
    ctx.tools.register({
      name: 'pangea_result_repair',
      description: '仅当当前唯一结果外壳不可读取时，由同一已绑定 worker 使用诊断 sha256 重发自己的 records；可读结果不会被覆盖。',
      parameters: { ...binding(), required: [...binding().required, 'expected_sha256', 'records'], properties: { ...SOURCE_BINDING_PROPERTIES, expected_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' }, records: { type: 'array' } } },
      async execute(args, exec) {
        return execute(exec, 'result-repair', [
          ...sourceCommandArgs(args),
          '--expected-sha256', args.expected_sha256,
          '--records', JSON.stringify(args.records),
        ])
      },
      output: toolOutput(),
    }),
    ctx.tools.register({
      name: 'pangea_comparison_read',
      description: 'comparison Reviewer 的只读输入。必须使用 Graph 给出的 opaque version_set_id，只能读取被锁定的 accepted analysis 与 independent review 版本。',
      parameters: { ...binding(), required: [...binding().required, 'version_set_id'], properties: { ...SOURCE_BINDING_PROPERTIES, version_set_id: { type: 'string', minLength: 1 }, unit_id: { type: 'string' }, cursor: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 500 } } },
      async execute(args, exec) {
        const values = [...sourceCommandArgs(args), '--version-set-id', args.version_set_id]
        for (const [flag, value] of [['--unit-id', args.unit_id], ['--cursor', args.cursor], ['--limit', args.limit]]) optionalCommandArg(values, flag, value)
        return execute(exec, 'comparison-read', values)
      },
      output: toolOutput(),
    }),
    ctx.tools.register({
      name: 'pangea_plan_write',
      description: '保存 Planning Agent 的一个原文单元计划。新建由程序分配 unit_id；更新只能复用已返回的 unit_id，并返回 owned region 完整性诊断。',
      parameters: {
        ...binding(),
        required: [...binding().required, 'expected_revision', 'unit'],
        properties: {
          ...SOURCE_BINDING_PROPERTIES,
          expected_revision: { type: 'integer', minimum: 0 },
          unit: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'purpose'],
            properties: {
              unit_id: { type: 'string', minLength: 1 },
              title: { type: 'string', minLength: 1 },
              purpose: { type: 'string', minLength: 1 },
              owned_regions: { type: 'array', items: { type: 'string', minLength: 1 } },
              owned_files: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['repo_id', 'path'], properties: { repo_id: { type: 'string' }, path: { type: 'string' } } } },
              context_regions: { type: 'array', items: { type: 'string', minLength: 1 } },
              context_files: { type: 'array', items: { type: 'string', minLength: 1 } },
              coverage_ids: { type: 'array', items: { type: 'string', minLength: 1 } },
              asset_item_ids: { type: 'array', items: { type: 'string', minLength: 1 } },
              mechanism_ids: { type: 'array', items: { type: 'string', minLength: 1 } },
            },
          },
          request_id: { type: 'string' },
        },
      },
      async execute(args, exec) {
        const values = [...sourceCommandArgs(args), '--expected-revision', String(args.expected_revision), '--unit', JSON.stringify(args.unit)]
        optionalCommandArg(values, '--request-id', args.request_id)
        return execute(exec, 'plan-write', values)
      },
      output: toolOutput(),
    }),
    ctx.tools.register({
      name: 'pangea_work_finish',
      description: '提交当前 result revision 的 Agent 完成声明；不按字数、关键词或字段数量判断内容质量。',
      parameters: { ...binding(), required: [...binding().required, 'revision'], properties: { ...SOURCE_BINDING_PROPERTIES, revision: { type: 'integer', minimum: 0 }, complete: { type: 'boolean' }, note: { type: 'string' }, request_id: { type: 'string' } } },
      async execute(args, exec) {
        const values = [...sourceCommandArgs(args), '--revision', String(args.revision)]
        if (args.complete === false) values.push('--no-complete')
        optionalCommandArg(values, '--note', args.note)
        optionalCommandArg(values, '--request-id', args.request_id)
        return execute(exec, 'work-finish', values)
      },
      output: toolOutput(),
    }),
    ctx.tools.register({
      name: 'pangea_review_decide',
      description: '保存 Reviewer 的原文决定；仅 disposition 和 comparison version_set_id 用于确定性路由，其余语义字段不受 Python 重写。',
      parameters: {
        ...binding(),
        required: [...binding().required, 'expected_revision', 'decision'],
        properties: {
          ...SOURCE_BINDING_PROPERTIES,
          expected_revision: { type: 'integer', minimum: 0 },
          decision: {
            type: 'object',
            additionalProperties: false,
            required: ['version_set_id', 'disposition', 'summary'],
            properties: {
              version_set_id: { type: 'string', minLength: 1 },
              disposition: { type: 'string', enum: ['pass', 'unresolved', 'finding'] },
              summary: { type: 'string' },
              finding_keys: { type: 'array', items: { type: 'string' } },
              closure_units: { type: 'array', items: { type: 'string' } },
              body: {},
            },
          },
          request_id: { type: 'string' },
        },
      },
      async execute(args, exec) {
        const values = [...sourceCommandArgs(args), '--expected-revision', String(args.expected_revision), '--decision', JSON.stringify(args.decision)]
        optionalCommandArg(values, '--request-id', args.request_id)
        return execute(exec, 'review-decide', values)
      },
      output: toolOutput(),
    }),
  ]
}

export function apply(ctx) {
  const monitor = createRuntimeMonitor()
  const disposeMonitor = monitor.start(ctx)
  const tasks = createTaskStore()
  const launchLogs = createLaunchLogStore()
  const acpSettings = createAcpSettingsStore()
  acpSettings.loadIntoEnvironment()
  const launchLocks = new Set()
  const environments = new EnvironmentStore()
  const ssh = new PangeaSshRuntime(environments)

  const toolDisposers = [ctx.tools.register({
    name: 'pangea_run_create',
    description: '创建 source-first PANGEA Run：Graph 冻结源码索引、结果外壳、task/action/result 绑定，并返回第一批待派发 action。',
    parameters: RUN_CREATE_PARAMETERS,
    async execute(args, exec) {
      const result = await createRun(workspaceCwd(exec), {
        ...args,
        effective_context_budget: args.effective_context_budget ?? 250000,
      })
      if (result?.workflow_version !== 'source-first-v1') {
        throw new Error('PANGEA 新 Run 未返回 source-first-v1，拒绝进入 DSH 派发流程')
      }
      return { ...result, data_root: result.data_root ?? resolvedDataRoot(exec, args.data_root) }
    },
    output: toolOutput(),
  }), ctx.tools.register({
    name: 'pangea_run_resume',
    description: '按明确 run_id 恢复 source-first Run 的待执行 action；不扫描、猜测或重建历史 task。',
    parameters: RUN_RESUME_PARAMETERS,
    async execute(args, exec) {
      const dataRoot = resolvedDataRoot(exec, args.data_root)
      const values = ['adapter', 'next', '--data-root', dataRoot, '--run-id', args.run_id]
      optionalCommandArg(values, '--limit', args.limit)
      const result = await runSourceFirstCommand(workspaceCwd(exec), values)
      if (result?.workflow_version !== 'source-first-v1') {
        throw new Error('历史 Run 缺少 source-first-v1 workflow_version，不能猜测恢复路径')
      }
      return { ...result, data_root: dataRoot }
    },
    output: toolOutput(),
  }), ctx.tools.register({
    name: 'pangea_status',
    description: '只读查看一个明确 run_id 的 PANGEA 阶段、质量状态、分析进度、结果数量和读取健康状态；不得用它扫描或猜测历史 Run。',
    parameters: STATUS_PARAMETERS,
    async execute(args, exec) {
      return companionSnapshot({ cwd: workspaceCwd(exec), dataRoot: args.data_root, runId: args.run_id })
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => renderStatus(value) },
  }), ctx.tools.register({
    name: 'pangea_environment_get',
    description: '读取 PANGEA 用例执行环境，返回环境名称、主机与阵列连接信息，以及供 SSH 工具使用的内部目标。',
    parameters: { type: 'object', additionalProperties: false, required: ['environment_id'], properties: { environment_id: { type: 'string' } } },
    async execute(args) {
      const environment = await environments.get(args.environment_id)
      if (!environment) throw new Error(`environment not found: ${args.environment_id}`)
      return environment
    },
    output: toolOutput(),
  }), ctx.tools.register({
    name: 'pangea_ssh_exec',
    description: '在环境返回的主机或阵列 SSH 目标上执行一条非交互命令。',
    parameters: { type: 'object', additionalProperties: false, required: ['alias', 'command'], properties: { alias: { type: 'string' }, command: { type: 'string' }, timeout_ms: { type: 'integer' } } },
    execute: args => ssh.exec(args.alias, args.command, args.timeout_ms),
    output: toolOutput(),
  }), ctx.tools.register({
    name: 'pangea_ssh_start',
    description: '在远程 SSH alias 上启动持续运行的后台命令，返回供 read/stop 使用的 job_id。',
    parameters: { type: 'object', additionalProperties: false, required: ['alias', 'command'], properties: { alias: { type: 'string' }, command: { type: 'string' } } },
    execute: args => ssh.start(args.alias, args.command),
    output: toolOutput(),
  }), ctx.tools.register({
    name: 'pangea_ssh_read',
    description: '读取 PANGEA 后台 SSH 任务的当前输出和完成状态，可短暂等待任务结束。',
    parameters: { type: 'object', additionalProperties: false, required: ['job_id'], properties: { job_id: { type: 'string' }, wait_ms: { type: 'integer' } } },
    execute: args => ssh.read(args.job_id, args.wait_ms),
    output: toolOutput(),
  }), ctx.tools.register({
    name: 'pangea_ssh_stop',
    description: '停止 PANGEA 后台 SSH 任务并返回最后输出；用于用例清理。',
    parameters: { type: 'object', additionalProperties: false, required: ['job_id'], properties: { job_id: { type: 'string' } } },
    execute: args => ssh.stop(args.job_id),
    output: toolOutput(),
  }), ctx.tools.register({
    name: 'pangea_ssh_interactive',
    description: '在阵列 SSH PTY 中保持同一交互会话，按 send 后 expect 正则的顺序执行 diagnose/attach/dtoe 等命令。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['alias', 'exchanges'],
      properties: {
        alias: { type: 'string' },
        exchanges: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['send', 'expect'], properties: { send: { type: 'string' }, expect: { type: 'string' }, timeout_seconds: { type: 'integer' } } } },
      },
    },
    execute: args => ssh.interactive(args.alias, args.exchanges),
    output: toolOutput(),
  }), ...sourceFirstTools(ctx)]

  const disposeStateRoute = ctx.webServer.register({ kind: 'exact', path: API_PATH, handler: (req, res) => stateRouteHandler(req, res, monitor, tasks) })
  const disposeSourceRoute = ctx.webServer.register({ kind: 'exact', path: SOURCE_API_PATH, handler: sourceRouteHandler })
  const disposeExportRoute = ctx.webServer.register({ kind: 'exact', path: EXPORT_API_PATH, handler: exportRouteHandler })
  const disposeLaunchLogRoute = ctx.webServer.register({ kind: 'exact', path: LAUNCH_LOG_API_PATH, handler: (req, res) => launchLogRouteHandler(req, res, launchLogs) })
  const disposeEnvironmentRoute = ctx.webServer.register({ kind: 'exact', path: ENVIRONMENT_API_PATH, handler: (req, res) => environmentRouteHandler(req, res, environments, ssh) })
  const disposeExecutionRoute = ctx.webServer.register({ kind: 'exact', path: EXECUTION_API_PATH, handler: (req, res) => executionRouteHandler(req, res, environments, ctx.apiProxy) })
  const disposeAcpSettingsRoute = ctx.webServer.register({ kind: 'exact', path: ACP_SETTINGS_API_PATH, handler: (req, res) => acpSettingsRouteHandler(req, res, acpSettings, ctx) })
  const jobs = ctx.jobs ?? ctx.get?.('jobs')
  const disposeJobController = jobs?.attachController?.('pangea-companion')
  const disposeJobDone = jobs?.onJobDone?.((snapshot, owner) => settleAcpTask(ctx, tasks, launchLogs, snapshot, owner).catch(() => undefined))
  const disposeArchitectureRoute = ctx.webServer.register({ kind: 'exact', path: '/api/pangea-companion/architecture-artifact', handler: (req, res) => architectureArtifactRoute(req, res, tasks) })
  const disposeWorkbenchRoute = ctx.webServer.register({ kind: 'exact', path: WORKBENCH_API_PATH, handler: (req, res) => workbenchRouteHandler(req, res, ctx.apiProxy, tasks, launchLocks, launchLogs, ctx, monitor) })
  const disposeRepositoryRoute = ctx.webServer.register({ kind: 'exact', path: REPOSITORY_API_PATH, handler: repositoryRouteHandler })
  ctx.effect?.(() => async () => {
    disposeRepositoryRoute()
    disposeArchitectureRoute()
    disposeWorkbenchRoute()
    disposeExecutionRoute()
    disposeAcpSettingsRoute()
    disposeEnvironmentRoute()
    disposeLaunchLogRoute()
    disposeSourceRoute()
    disposeExportRoute()
    disposeStateRoute()
    disposeJobDone?.()
    disposeJobController?.()
    for (const dispose of toolDisposers) dispose()
    await ssh.dispose()
    await tasks.flush()
    await disposeMonitor()
  }, 'dsh-pangea-companion: state, launch diagnostics, repositories, executor environments, SSH tools, and execution launch')
}

export { companionSnapshot } from './reader.js'
export { parseEvidenceLocation, readEvidenceSnippet, resolveEvidenceFile } from './source.js'
export { createRuntimeMonitor, RuntimeMonitor } from './monitor.js'
export { createTaskStore, TaskStore } from './task-store.js'
export { createLaunchLogStore, LaunchLogStore } from './launch-log.js'
export { AcpSettingsStore, createAcpSettingsStore } from './acp-settings.js'
export { EnvironmentStore } from './execution/environment.js'
export { PangeaSshRuntime } from './execution/ssh.js'
export { createRun, resumeRun, runAdapter, runSourceFirstCommand, runPangea, workspaceRoot } from './pangea-api.js'
export { launchAnalysisSession, normalizeRunInput, resumeAnalysisRun, stopAnalysisRun, workbenchSnapshot } from './workbench-api.js'
export { importRepository, normalizeRepositoryId, repositoryStatus } from './repositories/import.js'
export { deriveTaskResumeEligibility, reconcileAcpJobs, sessionFailure, settleAcpTask }
