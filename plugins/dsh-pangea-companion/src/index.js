import { companionSnapshot } from './reader.js'
import { readEvidenceSnippet } from './source.js'
import { createRuntimeMonitor } from './monitor.js'
import { EnvironmentStore } from './execution/environment.js'
import { launchExecution } from './execution/launch.js'
import { PangeaSshRuntime } from './execution/ssh.js'
import { createRun, runAdapter } from './pangea-api.js'
import { launchAnalysisSession, stopAnalysisRun, workbenchSnapshot } from './workbench-api.js'

export const name = 'dsh-pangea-companion'
export const inject = ['tools', 'webServer', 'agents', 'apiProxy']

const API_PATH = '/api/pangea-companion/state'
const SOURCE_API_PATH = '/api/pangea-companion/source'
const ENVIRONMENT_API_PATH = '/api/pangea-companion/environments'
const EXECUTION_API_PATH = '/api/pangea-companion/executions'
const WORKBENCH_API_PATH = '/api/pangea-companion/workbench'

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

async function stateRouteHandler(req, res, monitor) {
  if (req.method !== 'GET') return json(res, 405, { status: 'error', error: 'method-not-allowed' })
  if (!sameOriginBrowserRequest(req)) return json(res, 403, { status: 'error', error: 'same-origin-browser-request-required' })
  const url = new URL(req.url ?? API_PATH, 'http://localhost')
  const cwd = url.searchParams.get('cwd') ?? undefined
  const dataRoot = url.searchParams.get('data_root') ?? undefined
  const runId = url.searchParams.get('run_id') ?? undefined
  const sessionId = url.searchParams.get('session_id') ?? undefined
  try {
    const snapshot = await companionSnapshot({ cwd, dataRoot, runId, limit: 12 })
    if (runId === undefined && sessionId && snapshot.current) await monitor.bindRun(sessionId, snapshot.current)
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

async function environmentRouteHandler(req, res, store) {
  if (!sameOriginBrowserRequest(req)) return json(res, 403, { status: 'error', error: 'same-origin-browser-request-required' })
  try {
    if (req.method === 'GET') return json(res, 200, { status: 'ok', environments: await store.list() })
    if (req.method === 'POST') return json(res, 200, { status: 'ok', environment: await store.save(await requestJson(req)) })
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

async function workbenchRouteHandler(req, res, api) {
  if (!sameOriginBrowserRequest(req)) return json(res, 403, { status: 'error', error: 'same-origin-browser-request-required' })
  const url = new URL(req.url ?? WORKBENCH_API_PATH, 'http://localhost')
  const cwd = url.searchParams.get('cwd') ?? undefined
  const dataRoot = url.searchParams.get('data_root') ?? undefined
  try {
    if (req.method === 'GET') {
      return json(res, 200, await workbenchSnapshot({
        cwd,
        dataRoot,
        cursor: url.searchParams.get('cursor') ?? 0,
        limit: url.searchParams.get('limit') ?? 20,
      }))
    }
    if (req.method !== 'POST') return json(res, 405, { status: 'error', error: 'method-not-allowed' })
    const body = await requestJson(req)
    const actionDataRoot = typeof body.data_root === 'string' ? body.data_root : dataRoot
    if (body.action === 'create') {
      return json(res, 200, await launchAnalysisSession(api, { cwd, dataRoot: actionDataRoot, input: body.input }))
    }
    if (body.action === 'stop') {
      return json(res, 200, await stopAnalysisRun({ cwd, dataRoot: actionDataRoot, runId: body.run_id }))
    }
    return json(res, 400, { status: 'error', error: 'unsupported-action' })
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
  const environments = new EnvironmentStore()
  const ssh = new PangeaSshRuntime()

  const toolDisposers = [ctx.tools.register({
    name: 'pangea_run_create',
    description: '创建新的 PANGEA 模块分析 Run。首次准备仅可在 pangea-data/repositories 下列目录、按文件名搜索或 grep 符号，用于确定仓库和最小 source_scope，随后直接调用本工具；不得在创建 Run 前 Read、分段读取或通读业务源码。不得先列举或读取 pangea-data/runs、历史契约和报告。不要读取 PANGEA CLI 源码、graph、schema，也不要手写 pending contract 来学习用法。target 必须逐字复制用户确认的分析对象，不得增删或改写。返回的 actions 必须逐条派发。',
    parameters: RUN_CREATE_PARAMETERS,
    execute: (args, exec) => createRun(workspaceCwd(exec), args),
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
    description: '读取 PANGEA 用例执行环境，返回主机/阵列 SSH alias、自动化仓库 ID 和非秘密设备绑定。',
    parameters: { type: 'object', additionalProperties: false, required: ['environment_id'], properties: { environment_id: { type: 'string' } } },
    async execute(args) {
      const environment = await environments.get(args.environment_id)
      if (!environment) throw new Error(`environment not found: ${args.environment_id}`)
      return environment
    },
    output: toolOutput(),
  }), ctx.tools.register({
    name: 'pangea_ssh_exec',
    description: '在 DSH SSH 配置中的主机或阵列 alias 上执行一条非交互命令。',
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

  const disposeStateRoute = ctx.webServer.register({ kind: 'exact', path: API_PATH, handler: (req, res) => stateRouteHandler(req, res, monitor) })
  const disposeSourceRoute = ctx.webServer.register({ kind: 'exact', path: SOURCE_API_PATH, handler: sourceRouteHandler })
  const disposeEnvironmentRoute = ctx.webServer.register({ kind: 'exact', path: ENVIRONMENT_API_PATH, handler: (req, res) => environmentRouteHandler(req, res, environments) })
  const disposeExecutionRoute = ctx.webServer.register({ kind: 'exact', path: EXECUTION_API_PATH, handler: (req, res) => executionRouteHandler(req, res, environments, ctx.apiProxy) })
  const disposeWorkbenchRoute = ctx.webServer.register({ kind: 'exact', path: WORKBENCH_API_PATH, handler: (req, res) => workbenchRouteHandler(req, res, ctx.apiProxy) })
  ctx.effect?.(() => async () => {
    disposeWorkbenchRoute()
    disposeExecutionRoute()
    disposeEnvironmentRoute()
    disposeSourceRoute()
    disposeStateRoute()
    for (const dispose of toolDisposers) dispose()
    await ssh.dispose()
    await disposeMonitor()
  }, 'dsh-pangea-companion: state, executor environments, SSH tools, and execution launch')
}

export { companionSnapshot } from './reader.js'
export { parseEvidenceLocation, readEvidenceSnippet, resolveEvidenceFile } from './source.js'
export { createRuntimeMonitor, RuntimeMonitor } from './monitor.js'
export { EnvironmentStore } from './execution/environment.js'
export { PangeaSshRuntime } from './execution/ssh.js'
export { createRun, runAdapter, runPangea, workspaceRoot } from './pangea-api.js'
export { launchAnalysisSession, normalizeRunInput, stopAnalysisRun, workbenchSnapshot } from './workbench-api.js'
