import { companionSnapshot } from './reader.js'
import { readEvidenceSnippet } from './source.js'
import { createRuntimeMonitor } from './monitor.js'

export const name = 'dsh-pangea-companion'
export const inject = ['tools', 'webServer', 'agents']

const API_PATH = '/api/pangea-companion/state'
const SOURCE_API_PATH = '/api/pangea-companion/source'

const STATUS_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    data_root: { type: 'string', description: '可选：PANGEA 数据目录绝对路径。省略时从当前 DSH 工作区自动发现 pangea-data。' },
    run_id: { type: 'string', description: '可选：指定 PANGEA Run ID。省略时优先读取最近的未结束 Run，否则读取最近 Run。' },
  },
}

const PHASE_LABELS = {
  PREPARING: '准备中', WAITING_ANALYSIS: '等待分析', WAITING_REVIEW: '等待复核',
  WAITING_REWORK: '等待返工', WAITING_REWORK_REVIEW: '等待返工复核', READY_TO_FINALIZE: '等待生成报告',
  COMPLETE: '已完成', INCOMPLETE: '未完整结束', UNKNOWN: '未知',
}
const QUALITY_LABELS = { PASS: '通过', REWORK: '需要返工', UNRESOLVED: '未解决' }
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

export function apply(ctx) {
  const monitor = createRuntimeMonitor()
  const disposeMonitor = monitor.start(ctx)

  ctx.tools.register({
    name: 'pangea_status',
    description: '只读查看当前 PANGEA Run 的阶段、质量状态、分析进度、结构化结果数量和读取健康状态；不会推进或修改 PANGEA 工作流。',
    parameters: STATUS_PARAMETERS,
    async execute(args, exec) {
      return companionSnapshot({ cwd: workspaceCwd(exec), dataRoot: args.data_root, runId: args.run_id })
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => renderStatus(value) },
  })

  const disposeStateRoute = ctx.webServer.register({ kind: 'exact', path: API_PATH, handler: (req, res) => stateRouteHandler(req, res, monitor) })
  const disposeSourceRoute = ctx.webServer.register({ kind: 'exact', path: SOURCE_API_PATH, handler: sourceRouteHandler })
  ctx.effect?.(() => async () => {
    disposeSourceRoute()
    disposeStateRoute()
    await disposeMonitor()
  }, 'dsh-pangea-companion: read-only state and source routes')
}

export { companionSnapshot } from './reader.js'
export { parseEvidenceLocation, readEvidenceSnippet, resolveEvidenceFile } from './source.js'
export { createRuntimeMonitor, RuntimeMonitor } from './monitor.js'
