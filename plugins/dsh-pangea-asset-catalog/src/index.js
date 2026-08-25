import { AssetActionRuntime, dataRootFor, runPangea } from './pangea-api.js'

export const name = 'dsh-pangea-asset-catalog'
export const inject = ['tools', 'webServer', 'apiProxy']

const API_PATH = '/api/pangea-asset-catalog/state'
const PAGE_SIZES = new Set([20, 50, 100])
const ASSET_TYPES = new Set(['requirement', 'design', 'historical_defect', 'reference', 'coverage'])
const ASSET_STATUSES = new Set(['imported', 'extracting', 'awaiting_review', 'available', 'no_items', 'rejected', 'failed', 'archived'])

function workspaceCwd(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : undefined
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

async function readBody(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk.toString('utf8')
    if (body.length > 64 * 1024) throw new Error('request body is too large')
  }
  const value = JSON.parse(body || '{}')
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('request body must be an object')
  return value
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function listOptions(searchParams) {
  const pageSizeValue = positiveInteger(searchParams.get('page_size'), 20)
  const typeValue = searchParams.get('type') ?? ''
  const statusValue = searchParams.get('status') ?? ''
  return {
    page: positiveInteger(searchParams.get('page'), 1),
    pageSize: PAGE_SIZES.has(pageSizeValue) ? pageSizeValue : 20,
    type: ASSET_TYPES.has(typeValue) ? typeValue : '',
    status: ASSET_STATUSES.has(statusValue) ? statusValue : '',
    query: (searchParams.get('q') ?? '').trim().slice(0, 200),
  }
}

async function listState({ cwd, dataRoot, runtime, options }) {
  const resolvedDataRoot = dataRootFor(cwd, dataRoot)
  const cursor = (options.page - 1) * options.pageSize
  const args = [
    'assets', 'list', '--data-root', resolvedDataRoot,
    '--cursor', String(cursor), '--limit', String(options.pageSize),
  ]
  if (options.type) args.push('--type', options.type)
  if (options.status) args.push('--status', options.status)
  if (options.query) args.push('--query', options.query)
  const result = await runPangea({ cwd, args })
  const totalPages = Math.max(1, Math.ceil(result.total / options.pageSize))
  return {
    status: 'ok',
    data_root: resolvedDataRoot,
    assets: result.items.map(asset => ({
      ...asset,
      extraction_job: runtime.job(resolvedDataRoot, asset.asset_id),
    })),
    pagination: {
      page: Math.min(options.page, totalPages), page_size: options.pageSize,
      total: result.total, total_pages: totalPages,
      type: options.type, status: options.status, query: options.query,
    },
  }
}

async function assetDetail({ cwd, dataRoot, runtime, assetId }) {
  const resolvedDataRoot = dataRootFor(cwd, dataRoot)
  const detail = await runPangea({
    cwd,
    args: ['assets', 'get', '--data-root', resolvedDataRoot, '--asset-id', assetId],
  })
  return {
    status: 'ok', data_root: resolvedDataRoot,
    asset: { ...detail.asset, extraction_job: runtime.job(resolvedDataRoot, assetId) },
    result: detail.result,
  }
}

async function routeHandler(req, res, runtime) {
  if (!sameOriginBrowserRequest(req)) return json(res, 403, { status: 'error', error: 'same-origin-browser-request-required' })
  const url = new URL(req.url ?? API_PATH, 'http://localhost')
  const cwd = url.searchParams.get('cwd') ?? undefined
  const dataRoot = url.searchParams.get('data_root') ?? undefined
  const options = listOptions(url.searchParams)
  try {
    if (req.method === 'GET') {
      const assetId = url.searchParams.get('asset_id')
      const value = assetId
        ? await assetDetail({ cwd, dataRoot, runtime, assetId })
        : await listState({ cwd, dataRoot, runtime, options })
      return json(res, 200, value)
    }
    if (req.method !== 'POST') return json(res, 405, { status: 'error', error: 'method-not-allowed' })
    const body = await readBody(req)
    const resolvedDataRoot = dataRootFor(cwd, dataRoot)
    if (body.action === 'import') {
      const args = [
        'assets', 'import', '--data-root', resolvedDataRoot,
        '--path', body.path, '--type', body.asset_type,
      ]
      if (body.title) args.push('--title', body.title)
      await runPangea({ cwd, args })
    } else if (body.action === 'extract') {
      await runtime.start({ cwd, dataRoot: resolvedDataRoot, assetId: body.asset_id })
    } else if (body.action === 'review') {
      await runPangea({
        cwd,
        args: [
          'assets', 'review', '--data-root', resolvedDataRoot,
          '--asset-id', body.asset_id, '--decision', body.decision,
        ],
      })
    } else if (body.action === 'archive') {
      await runPangea({
        cwd,
        args: ['assets', 'archive', '--data-root', resolvedDataRoot, '--asset-id', body.asset_id],
      })
    } else {
      return json(res, 400, { status: 'error', error: 'unsupported-action' })
    }
    return json(res, 200, await listState({ cwd, dataRoot: resolvedDataRoot, runtime, options }))
  } catch (error) {
    return json(res, 400, { status: 'error', error: error instanceof Error ? error.message : String(error) })
  }
}

export async function apply(ctx) {
  const runtime = new AssetActionRuntime(ctx.apiProxy)
  const disposeTool = ctx.tools.register({
    name: 'pangea_assets_list',
    description: '只读列出 PANGEA 已导入资产及其结构化/审核状态。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        data_root: { type: 'string' }, type: { type: 'string' },
        status: { type: 'string' }, query: { type: 'string' },
      },
    },
    async execute(args, exec) {
      return listState({
        cwd: workspaceCwd(exec), dataRoot: args.data_root, runtime,
        options: { page: 1, pageSize: 50, type: args.type ?? '', status: args.status ?? '', query: args.query ?? '' },
      })
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
  })
  const disposeStatus = ctx.on?.('agent/status', ({ agent, status }) => runtime.handleAgentStatus(agent, status)) ?? (() => {})
  const disposeError = ctx.on?.('agent/error', ({ agent, error }) => runtime.handleAgentError(agent, error)) ?? (() => {})
  const disposeRoute = ctx.webServer.register({ kind: 'exact', path: API_PATH, handler: (req, res) => routeHandler(req, res, runtime) })
  ctx.effect?.(() => () => {
    disposeRoute(); disposeError(); disposeStatus(); disposeTool()
  }, 'dsh-pangea-asset-catalog: PANGEA asset API and extraction sessions')
}

export { AssetActionRuntime, dataRootFor, runPangea } from './pangea-api.js'
