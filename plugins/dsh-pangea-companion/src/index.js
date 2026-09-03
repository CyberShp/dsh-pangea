import { companionSnapshot } from './reader.js'
import { readEvidenceSnippet } from './source.js'
import { createRuntimeMonitor } from './monitor.js'
import { createTaskStore } from './task-store.js'
import { createLaunchLogStore } from './launch-log.js'
import { createAcpSettingsStore } from './acp-settings.js'
import { EnvironmentStore } from './execution/environment.js'
import { launchExecution } from './execution/launch.js'
import { PangeaSshRuntime } from './execution/ssh.js'
import { runPangea, workspaceRoot } from './pangea-api.js'
import { acpProviderOption, acpProviderOptions, createTaskConversation, dataRootFor, internalModelOptions, launchAnalysisSession, requireAcpModel, requireInternalModel, stopAnalysisRun, workbenchSnapshot } from './workbench-api.js'
import { importRepository, repositoryStatus } from './repositories/import.js'

export const name = 'dsh-pangea-companion'
export const inject = ['tools', 'webServer', 'agents', 'apiProxy', 'subagents', 'jobs']

const API_PATH = '/api/pangea-companion/state'
const SOURCE_API_PATH = '/api/pangea-companion/source'
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

const PHASE_LABELS = {
  PREPARING: '等待 Skill 初始化', STEP_BOOTSTRAP: '初始化 Skill',
  STEP_01: 'Step 01 · 范围与契约', STEP_02: 'Step 02 · 输入与计划', STEP_03: 'Step 03 · 广度盘点',
  STEP_04: 'Step 04 · 深度讲解', STEP_05: 'Step 05 · 场景与风险', STEP_06: 'Step 06 · SFMEA 翻译',
  STEP_07: 'Step 07 · 测试设计', STEP_08: 'Step 08 · 独立 Judge', STEP_09: 'Step 09 · 正式交付',
  COMPLETE: '已完成', INCOMPLETE: '未完整结束', STOPPED: '已停止', FAILED: '运行失败', UNKNOWN: '未知',
}
const QUALITY_LABELS = { PASS: '通过', UNRESOLVED: '未解决' }
const SOURCE_LABELS = { 'final-state': '最终聚合结果', 'worker-results': '运行中 Worker 结果' }
const HEALTH_LABELS = { ok: '正常', warning: '需关注', error: '异常' }

function workspaceCwd(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : undefined
}

function renderCount(run, key, label) {
  const check = run.reader_health?.count_checks?.[key]
  if (check?.status === 'mismatch') {
    return `${label}：读取异常（结构化 ${check.structured} / 报告 ${check.report}）`
  }
  return `${label}：${run.counts?.[key] ?? 0}`
}

function renderStatus(value) {
  const run = value.current
  if (run === null) return [{ type: 'text', text: `PANGEA 数据目录：${value.data_root}\n当前没有可读取的 Run。` }]
  const health = run.reader_health
  const lines = [
    `PANGEA Run：${run.run_id}`,
    `阶段：${PHASE_LABELS[run.phase] ?? run.phase}`,
    `质量状态：${QUALITY_LABELS[run.quality_status] ?? run.quality_status ?? '待定'}`,
    `Skill 步骤：${run.analysis.completed}/${run.analysis.total}`,
    `执行：当前 ${run.analysis.running ?? 0} / 等待 ${run.analysis.pending ?? 0} / 已完成 ${run.analysis.submitted ?? 0}`,
    renderCount(run, 'risks', '风险'),
    renderCount(run, 'test_cases', '测试用例'),
    `证据：${run.counts.evidence}`,
    `数据源：${SOURCE_LABELS[run.data_source] ?? run.data_source ?? '未知'}`,
    `读取健康：${HEALTH_LABELS[health?.status] ?? health?.status ?? '未知'}`,
  ]
  if (health?.trusted === false) {
    lines.push('重要：当前结构化结果与报告不一致，不能把 0 条风险/用例解释为“没有风险/用例”。')
  }
  if (run.errors.length > 0) lines.push(`当前错误：${run.errors.length}`)
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
    if (runId === undefined && sessionId && snapshot.current) {
      await monitor.bindRun(sessionId, snapshot.current)
      await tasks.bindRunBySession(sessionId, snapshot.current)
    }
    snapshot.monitor = await monitor.snapshot({ sessionId, runId: snapshot.current?.run_id })
    json(res, 200, snapshot)
  } catch (error) {
    json(res, 404, { status: 'error', error: error instanceof Error ? error.message : String(error) })
  }
}

function sourceRouteHandler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { status: 'error', error: 'method-not-allowed' })
  if (!sameOriginBrowserRequest(req)) return json(res, 403, { status: 'error', error: 'same-origin-browser-request-required' })
  const url = new URL(req.url ?? SOURCE_API_PATH, 'http://localhost')
  const cwd = url.searchParams.get('cwd') ?? undefined
  const dataRoot = url.searchParams.get('data_root') ?? undefined
  const location = url.searchParams.get('location') ?? undefined
  readEvidenceSnippet({ cwd, dataRoot, location })
    .then(snippet => json(res, 200, snippet))
    .catch(error => json(res, 404, { status: 'error', error: error instanceof Error ? error.message : String(error) }))
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

function readJobSnapshot(runtime, task) {
  if (!task?.job_id) return null
  const jobs = runtimeService(runtime, 'jobs')
  if (!jobs?.get) return null
  return jobs.get(task.job_id, jobOwner(runtime, task))
}

async function settleAcpTask(runtime, tasks, launchLogs, snapshot, owner, runner = runPangea) {
  if (snapshot?.kind !== 'subagent') return null
  const task = await tasks.getByJob(String(snapshot.id))
  if (!task) return null
  let output = ''
  try {
    output = runtimeService(runtime, 'jobs')?.read?.(snapshot.id, owner)?.text ?? ''
  } catch { /* terminal state remains authoritative even if final output cannot be read */ }
  if (output) await tasks.recordJobActivity(String(snapshot.id), output)
  let outcome = snapshot
  if (snapshot.status === 'completed') {
    try {
      const run = await runner({
        cwd: task.workspace,
        args: ['runs', 'get', '--data-root', task.data_root, '--run-id', task.run_id],
      })
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
    exit_status: outcome.status,
    detail: outcome.detail,
    output,
  })
  return tasks.settleJob(String(snapshot.id), outcome)
}

async function reconcileAcpJobs(runtime, tasks, taskItems, launchLogs) {
  for (const task of taskItems) {
    if (!task.job_id || !['starting', 'running', 'stopping'].includes(task.execution_status)) continue
    let snapshot
    try {
      const owner = jobOwner(runtime, task)
      const jobs = runtimeService(runtime, 'jobs')
      const update = jobs?.read?.(task.job_id, owner)
      snapshot = update?.snapshot ?? readJobSnapshot(runtime, task)
      if (update?.text) {
        await tasks.recordJobActivity(task.job_id, update.text)
        await appendLaunchSafe(launchLogs, task.task_id, {
          stage: 'acp_output', status: 'info', job_id: task.job_id, output: update.text,
        })
      }
    } catch (error) {
      const message = `无法恢复 ACP Job ${task.job_id}：${error instanceof Error ? error.message : String(error)}`
      await appendLaunchSafe(launchLogs, task.task_id, {
        stage: 'acp_job_reconcile', status: 'error', job_id: task.job_id,
        error_code: 'ACP_JOB_LOST', error: message,
      })
      await tasks.markInterrupted(task.task_id, message)
      continue
    }
    if (!snapshot) {
      const message = `ACP Job ${task.job_id} 不存在，无法证明外部 Agent 仍在运行`
      await appendLaunchSafe(launchLogs, task.task_id, {
        stage: 'acp_job_reconcile', status: 'error', job_id: task.job_id,
        error_code: 'ACP_JOB_LOST', error: message,
      })
      await tasks.markInterrupted(task.task_id, message)
      continue
    }
    if (snapshot && ['completed', 'killed', 'failed'].includes(snapshot.status)) {
      await settleAcpTask(runtime, tasks, launchLogs, snapshot, jobOwner(runtime, task))
    }
  }
}

async function workbenchRouteHandler(req, res, api, tasks, launchLocks, launchLogs, runtime) {
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
      let modelRouting
      try {
        modelRouting = { status: 'ok', ...await internalModelOptions(api) }
      } catch (error) {
        modelRouting = { status: 'error', models: [], failures: [], error: error instanceof Error ? error.message : String(error) }
      }
      const selectedCandidate = taskId ? await tasks.get(taskId) : sessionId ? await tasks.getBySession(sessionId) : null
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
    if (body.action === 'task-create') {
      const root = workspaceRoot(cwd)
      const providerId = typeof body.input?.provider_id === 'string' ? body.input.provider_id.trim() : ''
      if (providerId && !acpProviderOption(providerId)) throw new Error(`未知的 ACP 执行 Agent：${providerId}`)
      const selectedModel = providerId
        ? requireAcpModel(providerId, body.input?.model_route)
        : await resolveTaskModel(api, body.input?.model_route)
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
      if (task.run_id) throw new Error('task already has a Run')
      if (launchLocks.has(task.task_id)) throw new Error('task launch is already in progress')
      launchLocks.add(task.task_id)
      await appendLaunchSafe(launchLogs, task.task_id, { stage: 'launch_requested', status: 'start', message: `启动尝试 ${task.launch_attempts + 1}` })
      try {
        const selectedProvider = body.provider_id ?? task.provider
        let selectedModel = null
        if (selectedProvider) {
          assertRegisteredAcpProvider(runtime, selectedProvider)
          selectedModel = requireAcpModel(selectedProvider, body.model_route ?? task.model_route)
          await appendLaunchSafe(launchLogs, task.task_id, {
            stage: 'acp_provider_resolve', status: 'ok', provider: selectedProvider,
            model: selectedModel.model, reasoning_effort: selectedModel.reasoning_effort,
          })
          await tasks.prepareProviderLaunch(task.task_id, selectedProvider, selectedModel)
        } else {
          await appendLaunchSafe(launchLogs, task.task_id, { stage: 'model_route_resolve', status: 'start' })
          selectedModel = await resolveTaskModel(api, body.model_route ?? task.model_route)
          await appendLaunchSafe(launchLogs, task.task_id, {
            stage: 'model_route_resolve', status: 'ok', provider: selectedModel.provider, model: selectedModel.model,
          })
          await tasks.prepareLaunch(task.task_id, selectedModel)
        }
        await appendLaunchSafe(launchLogs, task.task_id, { stage: 'task_prepare', status: 'ok' })
        const launched = await launchAnalysisSession(api, {
          cwd,
          dataRoot: actionDataRoot ?? task.data_root,
          input: { ...task, provider_id: selectedProvider || null },
          model: selectedModel,
        }, undefined, session => tasks.addConversation(task.task_id, {
          sessionId: session.session_id,
          title: `${task.title} · 分析`,
          kind: 'analysis',
        }), async event => {
          await launchLogs.append(task.task_id, event)
          if (event.stage === 'acp_session_created') {
            await tasks.bindAgentRuntime(task.task_id, {
              agentSessionId: event.agent_session_id,
              processId: event.pid,
            })
          }
        }, runtime)
        await tasks.bindRunBySession(launched.session_id, launched.run)
        if (launched.job_id) await tasks.bindJob(task.task_id, { jobId: launched.job_id, provider: launched.provider, ownerSessionId: launched.session_id })
        await appendLaunchSafe(launchLogs, task.task_id, { stage: 'session_launch_complete', status: 'ok', session_id: launched.session_id })
        return json(res, 200, { ...launched, task: await tasks.get(task.task_id) })
      } catch (error) {
        await appendLaunchSafe(launchLogs, task.task_id, {
          stage: 'launch_failed', status: 'error', error,
          error_code: typeof error?.code === 'string' ? error.code : 'LAUNCH_FAILED',
        })
        await tasks.markLaunchFailed(
          task.task_id,
          error instanceof Error ? error.message : String(error),
          typeof error?.code === 'string' ? error.code : 'LAUNCH_FAILED',
        )
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
      let jobStop = { status: 'not_bound', job_id: requestedTask?.job_id ?? null, error: null }
      if (requestedTask?.job_id && stopJobs?.kill) {
        const owner = runtimeService(runtime, 'agents')?.get?.(requestedTask.owner_session_id)
        try {
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
      if (task) await tasks.markStopped(task.task_id, stopError)
      return json(res, 200, {
        ...stopped,
        job_stop: jobStop,
        run_stop: runStopError ? { status: 'error', error: runStopError } : { status: 'ok', error: null },
        session_cancel: sessionCancel,
        task: task ? await tasks.get(task.task_id) : null,
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

async function acpSettingsRouteHandler(req, res, settings, runtime) {
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
      if (body.action === 'test') {
        const checks = acpProviderOptions().map(provider => {
          const registered = Boolean(runtimeService(runtime, 'subagents')?.getProvider?.(provider.id))
          const reasons = []
          if (!provider.available) reasons.push(provider.resolution_error ?? '启动命令不可用')
          if (!registered) reasons.push('Provider 未注册')
          if (provider.models.length === 0) reasons.push('尚未配置模型目录')
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
  })]

  const disposeStateRoute = ctx.webServer.register({ kind: 'exact', path: API_PATH, handler: (req, res) => stateRouteHandler(req, res, monitor, tasks) })
  const disposeSourceRoute = ctx.webServer.register({ kind: 'exact', path: SOURCE_API_PATH, handler: sourceRouteHandler })
  const disposeLaunchLogRoute = ctx.webServer.register({ kind: 'exact', path: LAUNCH_LOG_API_PATH, handler: (req, res) => launchLogRouteHandler(req, res, launchLogs) })
  const disposeEnvironmentRoute = ctx.webServer.register({ kind: 'exact', path: ENVIRONMENT_API_PATH, handler: (req, res) => environmentRouteHandler(req, res, environments, ssh) })
  const disposeExecutionRoute = ctx.webServer.register({ kind: 'exact', path: EXECUTION_API_PATH, handler: (req, res) => executionRouteHandler(req, res, environments, ctx.apiProxy) })
  const disposeAcpSettingsRoute = ctx.webServer.register({ kind: 'exact', path: ACP_SETTINGS_API_PATH, handler: (req, res) => acpSettingsRouteHandler(req, res, acpSettings, ctx) })
  const jobs = ctx.jobs ?? ctx.get?.('jobs')
  const disposeJobController = jobs?.attachController?.('pangea-companion')
  const disposeJobDone = jobs?.onJobDone?.((snapshot, owner) => settleAcpTask(ctx, tasks, launchLogs, snapshot, owner).catch(() => undefined))
  const disposeWorkbenchRoute = ctx.webServer.register({ kind: 'exact', path: WORKBENCH_API_PATH, handler: (req, res) => workbenchRouteHandler(req, res, ctx.apiProxy, tasks, launchLocks, launchLogs, ctx) })
  const disposeRepositoryRoute = ctx.webServer.register({ kind: 'exact', path: REPOSITORY_API_PATH, handler: repositoryRouteHandler })
  ctx.effect?.(() => async () => {
    disposeRepositoryRoute()
    disposeWorkbenchRoute()
    disposeExecutionRoute()
    disposeAcpSettingsRoute()
    disposeEnvironmentRoute()
    disposeLaunchLogRoute()
    disposeSourceRoute()
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
export { createRun, runPangea, workspaceRoot } from './pangea-api.js'
export { launchAnalysisSession, normalizeRunInput, stopAnalysisRun, workbenchSnapshot } from './workbench-api.js'
export { importRepository, normalizeRepositoryId, repositoryStatus } from './repositories/import.js'
export { reconcileAcpJobs, sessionFailure, settleAcpTask }
