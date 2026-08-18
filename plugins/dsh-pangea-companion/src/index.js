import { companionSnapshot } from './reader.js'

export const name = 'dsh-pangea-companion'
export const inject = ['tools', 'webServer']

const API_PATH = '/api/pangea-companion/state'

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

function workspaceCwd(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : undefined
}

function renderStatus(value) {
  const run = value.current
  if (run === null) return [{ type: 'text', text: `PANGEA 数据目录：${value.data_root}\n当前没有可读取的 Run。` }]
  const lines = [
    `PANGEA Run：${run.run_id}`,
    `阶段：${PHASE_LABELS[run.phase] ?? run.phase}`,
    `质量状态：${QUALITY_LABELS[run.quality_status] ?? run.quality_status ?? '待定'}`,
    `分析进度：${run.analysis.completed}/${run.analysis.total}`,
    `风险：${run.counts.risks}`,
    `测试用例：${run.counts.test_cases}`,
    `证据：${run.counts.evidence}`,
    `数据源：${SOURCE_LABELS[run.data_source] ?? run.data_source ?? '未知'}`,
  ]
  if (run.errors.length > 0) lines.push(`当前错误：${run.errors.length}`)
  if (Array.isArray(run.reader_warnings) && run.reader_warnings.length > 0) {
    lines.push(`读取提示：${run.reader_warnings.join('；')}`)
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

function routeHandler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { status: 'error', error: 'method-not-allowed' })
  if (!sameOriginBrowserRequest(req)) return json(res, 403, { status: 'error', error: 'same-origin-browser-request-required' })
  const url = new URL(req.url ?? API_PATH, 'http://localhost')
  const cwd = url.searchParams.get('cwd') ?? undefined
  const dataRoot = url.searchParams.get('data_root') ?? undefined
  const runId = url.searchParams.get('run_id') ?? undefined
  companionSnapshot({ cwd, dataRoot, runId, limit: 12 })
    .then(snapshot => json(res, 200, snapshot))
    .catch(error => json(res, 404, { status: 'error', error: error instanceof Error ? error.message : String(error) }))
}

export function apply(ctx) {
  ctx.tools.register({
    name: 'pangea_status',
    description: '只读查看当前 PANGEA Run 的阶段、质量状态、分析进度和结构化结果数量；不会推进或修改 PANGEA 工作流。',
    parameters: STATUS_PARAMETERS,
    async execute(args, exec) {
      return companionSnapshot({ cwd: workspaceCwd(exec), dataRoot: args.data_root, runId: args.run_id })
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => renderStatus(value) },
  })

  const disposeRoute = ctx.webServer.register({ kind: 'exact', path: API_PATH, handler: routeHandler })
  ctx.effect?.(() => disposeRoute, 'dsh-pangea-companion: read-only state route')
}

export { companionSnapshot } from './reader.js'
