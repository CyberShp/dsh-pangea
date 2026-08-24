import { ALLOWED_ROLES, generateCatalog, readGeneratedState, saveOverride } from './catalog.js'
import { loadBundledSkills } from './bundled-skills.js'
import {
  AssetExtractionRuntime, ISSUE_SUBMISSION_PARAMETERS, METHODOLOGY_SUBMISSION_PARAMETERS,
  saveHistoricalIssueReview,
} from './extraction.js'

export const name = 'dsh-pangea-asset-catalog'
export const inject = ['tools', 'webServer', 'skills', 'apiProxy', 'agents']

const API_PATH = '/api/pangea-asset-catalog/state'
const DEFAULT_PAGE_SIZE = 20
const PAGE_SIZES = new Set([20, 50, 100])

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

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function paginationOptions(searchParams) {
  const requestedSize = positiveInteger(searchParams.get('page_size'), DEFAULT_PAGE_SIZE)
  const requestedRole = searchParams.get('role') ?? 'all'
  return {
    page: positiveInteger(searchParams.get('page'), 1),
    pageSize: PAGE_SIZES.has(requestedSize) ? requestedSize : DEFAULT_PAGE_SIZE,
    role: requestedRole === 'all' || ALLOWED_ROLES.has(requestedRole) ? requestedRole : 'all',
  }
}

export function paginateSnapshot(snapshot, { page = 1, pageSize = DEFAULT_PAGE_SIZE, role = 'all' } = {}) {
  const matching = [...snapshot.assets]
    .filter(asset => role === 'all' || asset.suggested_roles?.includes(role))
    .sort((left, right) => left.source_path < right.source_path ? -1 : left.source_path > right.source_path ? 1 : 0)
  const total = matching.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const offset = (currentPage - 1) * pageSize
  const assets = matching.slice(offset, offset + pageSize).map(asset => ({
    asset_id: asset.asset_id,
    source_path: asset.source_path,
    source_group: asset.source_group,
    file_type: asset.file_type,
    parse_status: asset.parse_status,
    size_bytes: asset.size_bytes,
    ...(asset.normalization ? { normalization: asset.normalization } : {}),
    kind: asset.kind,
    suggested_roles: asset.suggested_roles,
    suggestion_source: asset.suggestion_source,
    summary: asset.summary ?? '',
    non_binding: true,
  }))
  return {
    ...snapshot,
    assets,
    methodology_candidates: [],
    automation_capabilities: [],
    pagination: { page: currentPage, page_size: pageSize, total, total_pages: totalPages, role },
  }
}

async function currentState(runtime, cwd, options) {
  const snapshot = paginateSnapshot(await readGeneratedState({ cwd }), options)
  return runtime.decorateState(snapshot, { includeIssues: false })
}

async function assetDetail(runtime, cwd, assetId) {
  const snapshot = await readGeneratedState({ cwd })
  const asset = snapshot.assets.find(item => item.asset_id === assetId)
  if (!asset) throw new Error(`asset not found: ${assetId}`)
  const decorated = await runtime.decorateState({ ...snapshot, assets: [asset] })
  return { status: 'ok', asset: decorated.assets[0] }
}

async function routeHandler(req, res, runtime) {
  if (!sameOriginBrowserRequest(req)) return json(res, 403, { status: 'error', error: 'same-origin-browser-request-required' })
  const url = new URL(req.url ?? API_PATH, 'http://localhost')
  const cwd = url.searchParams.get('cwd') ?? undefined
  const options = paginationOptions(url.searchParams)
  try {
    if (req.method === 'GET') {
      const assetId = url.searchParams.get('asset_id')
      return json(res, 200, assetId ? await assetDetail(runtime, cwd, assetId) : await currentState(runtime, cwd, options))
    }
    if (req.method !== 'POST') return json(res, 405, { status: 'error', error: 'method-not-allowed' })
    const body = await readBody(req)
    if (body.action === 'generate') {
      await generateCatalog({ cwd })
      return json(res, 200, await currentState(runtime, cwd, options))
    }
    if (body.action === 'override') {
      await saveOverride({ cwd, assetId: body.asset_id, suggestedRoles: body.suggested_roles, kind: body.kind })
      return json(res, 200, await currentState(runtime, cwd, options))
    }
    if (body.action === 'extract_historical_issues') {
      const launched = await runtime.startHistoricalIssues({ cwd, assetId: body.asset_id })
      return json(res, 200, { ...await currentState(runtime, cwd, options), launched })
    }
    if (body.action === 'review_historical_issue') {
      await saveHistoricalIssueReview({
        cwd, assetId: body.asset_id, issueId: body.issue_id, decision: body.decision,
        correctedIssue: body.corrected_issue,
      })
      return json(res, 200, await currentState(runtime, cwd, options))
    }
    if (body.action === 'derive_methodology') {
      const launched = await runtime.startMethodology({ cwd })
      return json(res, 200, { ...await currentState(runtime, cwd, options), launched })
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

function toolOutput() {
  return { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

export async function apply(ctx) {
  const runtime = new AssetExtractionRuntime(ctx.apiProxy)
  const skillDisposers = (await loadBundledSkills()).map(skill => ctx.skills.register(skill))
  const toolDisposers = [ctx.tools.register({
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
  }), ctx.tools.register({
    name: 'pangea_asset_issue_submit',
    description: '仅供资产目录创建的历史问题提取会话提交结构化草稿；会校验会话、资产、原文位置和摘录，不接受普通会话调用。',
    parameters: ISSUE_SUBMISSION_PARAMETERS,
    execute: (args, exec) => runtime.submitHistoricalIssues(args, exec),
    output: toolOutput(),
  }), ctx.tools.register({
    name: 'pangea_asset_methodology_submit',
    description: '仅供资产目录创建的方法论会话提交候选；只接受已确认问题编号及其原有证据，不接受普通会话调用。',
    parameters: METHODOLOGY_SUBMISSION_PARAMETERS,
    execute: (args, exec) => runtime.submitMethodology(args, exec),
    output: toolOutput(),
  })]
  const disposeStatus = ctx.on?.('agent/status', ({ agent, status }) => runtime.handleAgentStatus(agent, status)) ?? (() => {})
  const disposeError = ctx.on?.('agent/error', ({ agent, error }) => runtime.handleAgentError(agent, error)) ?? (() => {})
  const disposeRoute = ctx.webServer.register({ kind: 'exact', path: API_PATH, handler: (req, res) => routeHandler(req, res, runtime) })
  ctx.effect?.(() => () => {
    disposeRoute()
    disposeError()
    disposeStatus()
    for (const dispose of toolDisposers) dispose()
    for (const dispose of skillDisposers) dispose()
  }, 'dsh-pangea-asset-catalog: skills, model extraction, reviews, and catalog API')
}

export { discoverDataRoot, generateCatalog, readGeneratedState, saveOverride, scanAssets } from './catalog.js'
export { AssetExtractionRuntime, saveHistoricalIssueReview } from './extraction.js'
