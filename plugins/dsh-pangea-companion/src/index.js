import { companionSnapshot } from './reader.js'

export const name = 'dsh-pangea-companion'
export const inject = ['tools', 'webServer']

const API_PATH = '/api/pangea-companion/state'

const STATUS_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    data_root: {
      type: 'string',
      description: 'Optional absolute PANGEA data root. Omit to discover pangea-data from the current DSH workspace.',
    },
    run_id: {
      type: 'string',
      description: 'Optional PANGEA run id. Omit to inspect the latest active run, falling back to the latest run.',
    },
  },
}

function workspaceCwd(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : undefined
}

function renderStatus(value) {
  const run = value.current
  if (run === null) {
    return [{ type: 'text', text: `PANGEA data: ${value.data_root}\nNo runs found.` }]
  }
  const lines = [
    `PANGEA run: ${run.run_id}`,
    `Phase: ${run.phase}`,
    `Quality: ${run.quality_status ?? 'pending'}`,
    `Analysis: ${run.analysis.completed}/${run.analysis.total}`,
    `Risks: ${run.counts.risks}`,
    `Test cases: ${run.counts.test_cases}`,
    `Evidence: ${run.counts.evidence}`,
  ]
  if (run.errors.length > 0) lines.push(`Errors: ${run.errors.length}`)
  if (run.artifacts.report_md !== null) lines.push(`Report: ${run.artifacts.report_md}`)
  return [{ type: 'text', text: lines.join('\n') }]
}

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function sameOriginBrowserRequest(req) {
  if (req.headers['sec-fetch-site'] === 'same-origin') return true
  const origin = req.headers.origin
  const host = req.headers.host
  if (typeof origin !== 'string' || typeof host !== 'string') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
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
    .catch(error => json(res, 404, {
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    }))
}

export function apply(ctx) {
  ctx.tools.register({
    name: 'pangea_status',
    description: 'Read the current PANGEA run status and artifact counts. This tool is read-only and never advances or modifies a PANGEA run.',
    parameters: STATUS_PARAMETERS,
    async execute(args, exec) {
      return companionSnapshot({
        cwd: workspaceCwd(exec),
        dataRoot: args.data_root,
        runId: args.run_id,
      })
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => renderStatus(value),
    },
  })

  const disposeRoute = ctx.webServer.register({
    kind: 'exact',
    path: API_PATH,
    handler: routeHandler,
  })
  ctx.effect?.(() => disposeRoute, 'dsh-pangea-companion: read-only state route')
}

export { companionSnapshot } from './reader.js'
