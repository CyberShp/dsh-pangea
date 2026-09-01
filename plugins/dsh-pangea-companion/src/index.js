import { companionSnapshot } from './reader.js'
import { readEvidenceSnippet } from './source.js'
import { createRuntimeMonitor } from './monitor.js'
import { createTaskStore } from './task-store.js'
import { createLaunchLogStore } from './launch-log.js'
import { EnvironmentStore } from './execution/environment.js'
import { launchExecution } from './execution/launch.js'
import { PangeaSshRuntime } from './execution/ssh.js'
import { createRun, runAdapter, workspaceRoot } from './pangea-api.js'
import { createTaskConversation, dataRootFor, internalModelOptions, launchAnalysisSession, requireInternalModel, stopAnalysisRun, workbenchSnapshot } from './workbench-api.js'
import { importRepository, repositoryStatus } from './repositories/import.js'

export const name = 'dsh-pangea-companion'
export const inject = ['tools', 'webServer', 'agents', 'apiProxy']

const API_PATH = '/api/pangea-companion/state'
const SOURCE_API_PATH = '/api/pangea-companion/source'
const ENVIRONMENT_API_PATH = '/api/pangea-companion/environments'
const EXECUTION_API_PATH = '/api/pangea-companion/executions'
const WORKBENCH_API_PATH = '/api/pangea-companion/workbench'
const LAUNCH_LOG_API_PATH = '/api/pangea-companion/launch-log'
const REPOSITORY_API_PATH = '/api/pangea-companion/repositories'

function rpc(payload) {
  return { rpcId: `pangea-companion-${Date.now()}-${Math.random()}`, payload }
}

function apiValue(response) {
  if (!response?.result?.ok) throw new Error(response?.result?.error?.message ?? 'DSH API request failed')
  return response.result.value
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
    repository: { type: 'string', minLength: 1, description: '从当前工作区 pangea-data/repositories 的一级目录中确定的仓库 ID。准备阶段只可列目录、按文件名搜索或 grep 符号，不得 Read/通读业务源码；不得从历史 Run 或 PANGEA 自身实现中推测。' },
    target: {
      type: 'string', minLength: 1,
      description: '逐字复制用户确认的本次分析对象；不得添加仓库名、产品名或范围说明，不翻译、不重排、不自行缩写。',
    },
    source_scope: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 }, description: '通过列目录、文件名搜索或 grep 符号确定、相对仓库根目录的最小源码路径集合。准备该字段时不得 Read/通读文件内容，也不得读取 pangea-data/runs、CLI、graph 或 schema。' },
    focus: { type: 'array', items: { type: 'string', minLength: 1 } },
    asset_ids: { type: 'array', items: { type: 'string', minLength: 1 } },
    test_case_examples: { type: 'array', items: { type: 'string', minLength: 1 }, description: '可选：当前工作区中少量已有用例文件的路径；不是自然语言用例描述。没有文件就省略。' },
    data_root: { type: 'string', description: '可选。默认使用当前 PANGEA 工作区的 pangea-data。' },
  },
}

const ACTION_PARAMETERS = {
  type: 'object', additionalProperties: false,
  required: ['data_root', 'run_id', 'action_id'],
  properties: {
    data_root: { type: 'string', minLength: 1 },
    run_id: { type: 'string', minLength: 1 },
    action_id: { type: 'string', minLength: 1 },
  },
}

const ACTION_BIND_PARAMETERS = {
  ...ACTION_PARAMETERS,
  required: [...ACTION_PARAMETERS.required, 'task_id'],
  properties: { ...ACTION_PARAMETERS.properties, task_id: { type: 'string', minLength: 1 } },
}

const PHASE_LABELS = {
  PREPARING: '准备输入', PLANNING: '规划分析单元', ANALYZING: '并行分析',
  REVIEWING: '独立复核', CLOSING: '定向补齐', REPORTING: '生成报告',
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
    `分析进度：${run.analysis.completed}/${run.analysis.total}`,
    `Worker：运行 ${run.analysis.running ?? 0} / 等待 ${run.analysis.pending ?? 0} / 已提交 ${run.analysis.submitted ?? 0}（最大并发 ${run.analysis.max_parallel ?? 8}）`,
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

async function reconcileTaskLaunches(api, tasks, taskItems, launchLogs, now = Date.now()) {
  const timeoutMs = 5 * 60 * 1000
  for (const task of taskItems) {
    if (task.status !== 'preparing' || task.run_id) continue
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
      if (task.launch_started_at && now - task.launch_started_at >= timeoutMs) {
        try { apiValue(await api.sessions.cancel(rpc({ sessionId: conversation.session_id }))) } catch { /* already stopped */ }
        await appendLaunchSafe(launchLogs, task.task_id, {
          stage: 'launch_timeout', status: 'error', session_id: conversation.session_id,
          error_code: 'LAUNCH_TIMEOUT', error: '启动超时：会话未在 5 分钟内创建 PANGEA Run',
        })
        await tasks.markLaunchFailed(task.task_id, '启动超时：会话未在 5 分钟内创建 PANGEA Run', 'LAUNCH_TIMEOUT')
      }
    } catch (error) {
      if (task.launch_started_at && now - task.launch_started_at >= timeoutMs) {
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

async function workbenchRouteHandler(req, res, api, tasks, launchLocks, launchLogs) {
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
      await tasks.reconcileRuns(snapshot.runs?.items)
      let taskItems = await tasks.list({ workspace: workspaceRoot(cwd) })
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
      return json(res, 200, {
        ...snapshot,
        tasks: { items: taskItems, total: taskItems.length },
        model_routing: modelRouting,
        selected_task_id: selectedTask?.task_id ?? null,
        launch_log: launchLog,
      })
    }
    if (req.method !== 'POST') return json(res, 405, { status: 'error', error: 'method-not-allowed' })
    const body = await requestJson(req)
    const actionDataRoot = typeof body.data_root === 'string' ? body.data_root : dataRoot
    if (body.action === 'task-create') {
      const root = workspaceRoot(cwd)
      const selectedModel = await resolveTaskModel(api, body.input?.model_route)
      const task = await tasks.create({
        workspace: root,
        dataRoot: dataRootFor(root, actionDataRoot),
        input: { ...body.input, model_route: selectedModel },
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
        await appendLaunchSafe(launchLogs, task.task_id, { stage: 'model_route_resolve', status: 'start' })
        const selectedModel = await resolveTaskModel(api, body.model_route ?? task.model_route)
        await appendLaunchSafe(launchLogs, task.task_id, {
          stage: 'model_route_resolve', status: 'ok', provider: selectedModel.provider, model: selectedModel.model,
        })
        await tasks.prepareLaunch(task.task_id, selectedModel)
        await appendLaunchSafe(launchLogs, task.task_id, { stage: 'task_prepare', status: 'ok' })
        const launched = await launchAnalysisSession(api, {
          cwd,
          dataRoot: actionDataRoot ?? task.data_root,
          input: task,
          model: selectedModel,
        }, undefined, session => tasks.addConversation(task.task_id, {
          sessionId: session.session_id,
          title: `${task.title} · 分析`,
          kind: 'analysis',
        }), event => launchLogs.append(task.task_id, event))
        await appendLaunchSafe(launchLogs, task.task_id, { stage: 'session_launch_complete', status: 'ok', session_id: launched.session_id })
        return json(res, 200, { ...launched, task: await tasks.get(task.task_id) })
      } catch (error) {
        await appendLaunchSafe(launchLogs, task.task_id, {
          stage: 'launch_failed', status: 'error', error,
        })
        await tasks.markLaunchFailed(task.task_id, error instanceof Error ? error.message : String(error))
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
      return json(res, 200, await stopAnalysisRun({ cwd, dataRoot: actionDataRoot, runId: body.run_id }))
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

function toolOutput() {
  return { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

export function apply(ctx) {
  const monitor = createRuntimeMonitor()
  const disposeMonitor = monitor.start(ctx)
  const tasks = createTaskStore()
  const launchLogs = createLaunchLogStore()
  const launchLocks = new Set()
  const environments = new EnvironmentStore()
  const ssh = new PangeaSshRuntime(environments)

  const toolDisposers = [ctx.tools.register({
    name: 'pangea_run_create',
    description: '创建新的 PANGEA 模块分析 Run。首次准备仅可在 pangea-data/repositories 下列目录、按文件名搜索或 grep 符号，用于确定仓库和最小 source_scope，随后直接调用本工具；不得在创建 Run 前 Read、分段读取或通读业务源码。不得先列举或读取 pangea-data/runs、历史契约和报告。不要读取 PANGEA CLI 源码、graph、schema，也不要手写 pending contract 来学习用法。target 必须逐字复制用户确认的本次分析对象，不得增删或改写。返回的 actions 必须逐条派发。',
    parameters: RUN_CREATE_PARAMETERS,
    async execute(args, exec) {
      const sessionId = String(exec.agent.id)
      const task = await tasks.getBySession(sessionId)
      await appendLaunchSafe(launchLogs, task?.task_id, {
        stage: 'pangea_run_create', status: 'start', session_id: sessionId,
      })
      try {
        const run = await createRun(workspaceCwd(exec), args)
        await appendLaunchSafe(launchLogs, task?.task_id, {
          stage: 'pangea_run_create', status: 'ok', session_id: sessionId, run_id: run.run_id,
        })
        await monitor.bindRun(sessionId, run)
        await tasks.bindRunBySession(sessionId, run)
        await appendLaunchSafe(launchLogs, task?.task_id, {
          stage: 'run_bound', status: 'ok', session_id: sessionId, run_id: run.run_id,
        })
        return run
      } catch (error) {
        await appendLaunchSafe(launchLogs, task?.task_id, {
          stage: 'pangea_run_create', status: 'error', session_id: sessionId, error,
        })
        throw error
      }
    },
    output: toolOutput(),
  }), ctx.tools.register({
    name: 'pangea_action_bind',
    description: '兼容接口：手动把 action 与真实 DSH subagent_id 绑定。pangea_action_dispatch 已自动完成绑定，正常流程无需调用。',
    parameters: ACTION_BIND_PARAMETERS,
    execute: (args, exec) => runAdapter(workspaceCwd(exec), 'bind', args),
    output: toolOutput(),
  }), ctx.tools.register({
    name: 'pangea_action_validate',
    description: '兼容接口，当前流程已停用。子 Agent 结束后直接调用 pangea_action_settle；settle 会完成校验，并在失败时返回原 Agent 的返修 action。',
    parameters: ACTION_PARAMETERS,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      try {
        return await runAdapter(workspaceCwd(exec), 'validate', args)
      } catch (error) {
        return {
          action_id: args.action_id,
          status: 'invalid',
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
    output: toolOutput(),
  }), ctx.tools.register({
    name: 'pangea_action_settle',
    description: '子 Agent 结束后直接调用。工具会校验并接收当前 action；失败时返回携带结构化错误的原 Agent 返修 action，通过时返回下一批 actions 或最终 Run 状态。',
    parameters: ACTION_PARAMETERS,
    isConcurrencySafe: () => false,
    execute: (args, exec) => runAdapter(workspaceCwd(exec), 'settle', args),
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
  })]

  const disposeStateRoute = ctx.webServer.register({ kind: 'exact', path: API_PATH, handler: (req, res) => stateRouteHandler(req, res, monitor, tasks) })
  const disposeSourceRoute = ctx.webServer.register({ kind: 'exact', path: SOURCE_API_PATH, handler: sourceRouteHandler })
  const disposeLaunchLogRoute = ctx.webServer.register({ kind: 'exact', path: LAUNCH_LOG_API_PATH, handler: (req, res) => launchLogRouteHandler(req, res, launchLogs) })
  const disposeEnvironmentRoute = ctx.webServer.register({ kind: 'exact', path: ENVIRONMENT_API_PATH, handler: (req, res) => environmentRouteHandler(req, res, environments, ssh) })
  const disposeExecutionRoute = ctx.webServer.register({ kind: 'exact', path: EXECUTION_API_PATH, handler: (req, res) => executionRouteHandler(req, res, environments, ctx.apiProxy) })
  const disposeWorkbenchRoute = ctx.webServer.register({ kind: 'exact', path: WORKBENCH_API_PATH, handler: (req, res) => workbenchRouteHandler(req, res, ctx.apiProxy, tasks, launchLocks, launchLogs) })
  const disposeRepositoryRoute = ctx.webServer.register({ kind: 'exact', path: REPOSITORY_API_PATH, handler: repositoryRouteHandler })
  ctx.effect?.(() => async () => {
    disposeRepositoryRoute()
    disposeWorkbenchRoute()
    disposeExecutionRoute()
    disposeEnvironmentRoute()
    disposeLaunchLogRoute()
    disposeSourceRoute()
    disposeStateRoute()
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
export { EnvironmentStore } from './execution/environment.js'
export { PangeaSshRuntime } from './execution/ssh.js'
export { createRun, runAdapter, runPangea, workspaceRoot } from './pangea-api.js'
export { launchAnalysisSession, normalizeRunInput, stopAnalysisRun, workbenchSnapshot } from './workbench-api.js'
export { importRepository, normalizeRepositoryId, repositoryStatus } from './repositories/import.js'
export { sessionFailure }
