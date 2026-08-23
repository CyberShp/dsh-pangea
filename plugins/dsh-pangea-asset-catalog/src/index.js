import { generateCatalog, readGeneratedState, saveOverride } from './catalog.js'

export const name = 'dsh-pangea-asset-catalog'
export const inject = ['tools', 'webServer']

const API_PATH = '/api/pangea-asset-catalog/state'

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
    body += chunk
    if (body.length > 64 * 1024) throw new Error('request body is too large')
  }
  return body ? JSON.parse(body) : {}
}

async function routeHandler(req, res) {
  if (!sameOriginBrowserRequest(req)) return json(res, 403, { status: 'error', error: 'same-origin-browser-request-required' })
  const url = new URL(req.url ?? API_PATH, 'http://localhost')
  const cwd = url.searchParams.get('cwd') ?? undefined
  try {
    if (req.method === 'GET') return json(res, 200, await readGeneratedState({ cwd }))
    if (req.method !== 'POST') return json(res, 405, { status: 'error', error: 'method-not-allowed' })
    const body = await readBody(req)
    if (body.action === 'generate') {
      await generateCatalog({ cwd })
      return json(res, 200, await readGeneratedState({ cwd }))
    }
    if (body.action === 'override') {
      await saveOverride({ cwd, assetId: body.asset_id, suggestedRoles: body.suggested_roles, kind: body.kind })
      return json(res, 200, await readGeneratedState({ cwd }))
    }
    return json(res, 400, { status: 'error', error: 'unsupported-action' })
  } catch (error) {
    return json(res, 400, { status: 'error', error: error instanceof Error ? error.message : String(error) })
  }
}

function renderGenerated(value) {
  const lines = [
    `资产目录：${value.output_root}`,
    `资料：${value.counts.materials}`,
    `自动化资产：${value.counts.automations}`,
    `已标准化文档：${value.counts.normalized_documents}`,
    `方法论候选：${value.counts.methodology_candidates}`,
    `诊断：${value.counts.diagnostics}`,
    '说明：生成结果仅供引用，不修改或约束 PANGEA 决策。',
  ]
  return [{ type: 'text', text: lines.join('\n') }]
}

export function apply(ctx) {
  ctx.tools.register({
    name: 'pangea_asset_catalog_generate',
    description: '只读扫描当前工作区的 pangea-data/inbox 与 pangea-data/test-automation，把 inbox 中的 DOCX、PDF、XLSX 转成可引用的 Markdown，并生成非约束性的资产目录；不修改 PANGEA、Run 或原始资产。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        data_root: { type: 'string', description: '可选：pangea-data 绝对路径；省略时从当前 DSH 工作区向上发现。' },
      },
    },
    async execute(args, exec) {
      const value = await generateCatalog({ cwd: workspaceCwd(exec), dataRoot: args.data_root })
      return {
        status: value.status,
        output_root: value.output_root,
        generated_at: value.generated_at,
        counts: value.counts,
        generated_files_are_non_binding: true,
      }
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => renderGenerated(value) },
  })
  const disposeRoute = ctx.webServer.register({ kind: 'exact', path: API_PATH, handler: routeHandler })
  ctx.effect?.(() => () => disposeRoute(), 'dsh-pangea-asset-catalog: catalog API')
}

export { discoverDataRoot, generateCatalog, readGeneratedState, saveOverride, scanAssets } from './catalog.js'
