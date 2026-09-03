import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { AssetActionRuntime, dataRootFor, runPangea } from './pangea-api.js'
import { MethodologyCandidateRuntime } from './methodology-runtime.js'

export const name = 'dsh-pangea-asset-catalog'
export const inject = ['tools', 'webServer', 'apiProxy']

const API_PATH = '/api/pangea-asset-catalog/state'
const PAGE_SIZES = new Set([20, 50, 100])
const ASSET_TYPES = new Set(['requirement', 'design', 'historical_defect', 'reference', 'coverage', 'test_case_example'])
const ASSET_STATUSES = new Set(['imported', 'extracting', 'awaiting_review', 'available', 'no_items', 'rejected', 'failed', 'archived'])
const KNOWLEDGE_KINDS = new Set(['semantic', 'evidence'])

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
    if (body.length > 32 * 1024 * 1024) throw new Error('request body is too large')
  }
  const value = JSON.parse(body || '{}')
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('request body must be an object')
  return value
}

async function materializeImportSource(body, dataRoot) {
  if (typeof body.path === 'string' && body.path.trim() !== '') {
    return { path: body.path.trim(), cleanup: async () => {} }
  }
  if (typeof body.file_data !== 'string' || body.file_data.trim() === '') {
    throw new Error('请选择要导入的文件')
  }
  if (typeof body.file_name !== 'string' || path.basename(body.file_name) !== body.file_name || body.file_name.trim() === '') {
    throw new Error('导入文件名无效')
  }
  const encoded = body.file_data.trim()
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('导入文件编码无效')
  const content = Buffer.from(encoded, 'base64')
  if (content.length === 0 || content.length > 24 * 1024 * 1024) throw new Error('导入文件超过 24 MiB 限制')
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'pangea-asset-import-'))
  const temporaryPath = path.join(temporaryRoot, body.file_name)
  await writeFile(temporaryPath, content)
  return { path: temporaryPath, cleanup: () => rm(temporaryRoot, { recursive: true, force: true }) }
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function listOptions(searchParams) {
  const pageSizeValue = positiveInteger(searchParams.get('page_size'), 20)
  const typeValue = searchParams.get('type') ?? ''
  const statusValue = searchParams.get('status') ?? ''
  const kindValue = searchParams.get('kind') ?? ''
  return {
    page: positiveInteger(searchParams.get('page'), 1),
    pageSize: PAGE_SIZES.has(pageSizeValue) ? pageSizeValue : 20,
    type: ASSET_TYPES.has(typeValue) ? typeValue : '',
    status: ASSET_STATUSES.has(statusValue) ? statusValue : '',
    kind: KNOWLEDGE_KINDS.has(kindValue) ? kindValue : '',
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
  if (options.kind) args.push('--kind', options.kind)
  if (options.query) args.push('--query', options.query)
  const [result, methodologies, capabilities, methodologyJob] = await Promise.all([
    runPangea({ cwd, args }),
    runPangea({ cwd, args: ['methodologies', 'list', '--data-root', resolvedDataRoot, '--limit', '200'] }),
    runPangea({ cwd, args: ['system', 'capabilities', '--data-root', resolvedDataRoot] }),
    runtime.methodologies.job(cwd, resolvedDataRoot),
  ])
  const totalPages = Math.max(1, Math.ceil(result.total / options.pageSize))
  return {
    status: 'ok',
    data_root: resolvedDataRoot,
    assets: result.items.map(asset => ({
      ...asset,
      extraction_job: runtime.job(resolvedDataRoot, asset.asset_id),
    })),
    summary: result.summary ?? {},
    methodologies: {
      ...methodologies,
      candidate_schema_path: capabilities.methodologies?.candidate_schema_path ?? capabilities.candidate_schema_path ?? null,
      generation_job: methodologyJob,
    },
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
    normalized_preview: detail.normalized_preview ?? null,
    integrity: detail.integrity ?? null,
    allowed_steps: detail.allowed_steps ?? [],
    review: detail.review ?? null,
  }
}

async function methodologyDetail({ cwd, dataRoot, methodologyId }) {
  const resolvedDataRoot = dataRootFor(cwd, dataRoot)
  return {
    status: 'ok', data_root: resolvedDataRoot,
    methodology: await runPangea({ cwd, args: ['methodologies', 'get', '--data-root', resolvedDataRoot, '--id', methodologyId] }),
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
      const methodologyId = url.searchParams.get('methodology_id')
      const value = methodologyId
        ? await methodologyDetail({ cwd, dataRoot, methodologyId })
        : assetId
        ? await assetDetail({ cwd, dataRoot, runtime, assetId })
        : await listState({ cwd, dataRoot, runtime, options })
      return json(res, 200, value)
    }
    if (req.method !== 'POST') return json(res, 405, { status: 'error', error: 'method-not-allowed' })
    const body = await readBody(req)
    const resolvedDataRoot = dataRootFor(cwd, dataRoot)
    if (body.action === 'preview_import') {
      const source = await materializeImportSource(body, resolvedDataRoot)
      try {
        const args = [
          'assets', 'preview', '--data-root', resolvedDataRoot,
          '--path', source.path, '--type', body.asset_type,
        ]
        if (body.title) args.push('--title', body.title)
        return json(res, 200, { status: 'ok', preview: await runPangea({ cwd, args }) })
      } finally {
        await source.cleanup()
      }
    } else if (body.action === 'import') {
      const source = await materializeImportSource(body, resolvedDataRoot)
      try {
        const previewArgs = [
          'assets', 'preview', '--data-root', resolvedDataRoot,
          '--path', source.path, '--type', body.asset_type,
        ]
        if (body.title) previewArgs.push('--title', body.title)
        const preview = await runPangea({ cwd, args: previewArgs })
        if (body.confirmed_sha256 !== preview.source_sha256) {
          throw new Error('资产内容已变化，请重新预览后再导入')
        }
        if (preview.duplicate) {
          throw new Error(`检测到重复资产：${preview.duplicate.asset_id}`)
        }
        const strategy = body.strategy ?? 'create_new'
        const args = strategy === 'new_revision'
          ? [
              'assets', 'revise', '--data-root', resolvedDataRoot,
              '--asset-id', body.conflict_asset_id, '--path', source.path,
            ]
          : strategy === 'create_new'
            ? [
                'assets', 'import', '--data-root', resolvedDataRoot,
                '--path', source.path, '--type', body.asset_type,
              ]
            : null
        if (!args) throw new Error(`不支持的冲突策略：${strategy}`)
        if (strategy === 'new_revision' && !preview.conflicts.some(item => item.asset_id === body.conflict_asset_id)) {
          throw new Error('新修订目标不在本次预览的冲突列表中')
        }
        if (body.title) args.push('--title', body.title)
        await runPangea({ cwd, args })
      } finally {
        await source.cleanup()
      }
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
    } else if (body.action === 'review_items') {
      if (!Number.isInteger(body.revision) || typeof body.result_sha256 !== 'string' || !Array.isArray(body.decisions)) {
        throw new Error('逐条审核需要 revision、result_sha256 和 decisions')
      }
      const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'pangea-review-'))
      const decisionsPath = path.join(temporaryRoot, 'decisions.json')
      try {
        await writeFile(decisionsPath, `${JSON.stringify(body.decisions)}\n`, 'utf8')
        await runPangea({
          cwd,
          args: [
            'assets', 'review-items', '--data-root', resolvedDataRoot,
            '--asset-id', body.asset_id, '--revision', String(body.revision),
            '--result-sha256', body.result_sha256, '--decisions', decisionsPath,
          ],
        })
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true })
      }
    } else if (body.action === 'archive') {
      await runPangea({
        cwd,
        args: ['assets', 'archive', '--data-root', resolvedDataRoot, '--asset-id', body.asset_id],
      })
    } else if (body.action === 'restore') {
      await runPangea({
        cwd,
        args: ['assets', 'restore', '--data-root', resolvedDataRoot, '--asset-id', body.asset_id],
      })
    } else if (body.action === 'update_metadata') {
      if (typeof body.title !== 'string' || body.title.trim() === '') throw new Error('资产标题不能为空')
      for (const field of ['repository_ids', 'module_tags', 'language_tags']) {
        if (body[field] !== undefined && (!Array.isArray(body[field]) || body[field].some(value => typeof value !== 'string'))) {
          throw new Error(`${field} 必须是字符串数组`)
        }
      }
      const args = [
        'assets', 'update-metadata', '--data-root', resolvedDataRoot,
        '--asset-id', body.asset_id, '--title', body.title.trim(),
      ]
      for (const value of body.repository_ids ?? []) args.push('--repository-id', value)
      for (const value of body.module_tags ?? []) args.push('--module-tag', value)
      for (const value of body.language_tags ?? []) args.push('--language-tag', value)
      await runPangea({ cwd, args })
    } else if (body.action === 'generate_methodology') {
      await runtime.methodologies.start({ cwd, dataRoot: resolvedDataRoot, assetIds: body.asset_ids })
    } else if (body.action === 'enable_methodology' || body.action === 'disable_methodology') {
      await runPangea({
        cwd,
        args: [
          'methodologies', body.action === 'enable_methodology' ? 'enable' : 'disable',
          '--data-root', resolvedDataRoot, '--id', body.methodology_id,
        ],
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
  runtime.methodologies = new MethodologyCandidateRuntime(ctx.apiProxy)
  const toolDisposers = [ctx.tools.register({
    name: 'pangea_assets_list',
    description: '只读列出 PANGEA 已导入资产及其结构化/审核状态。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        data_root: { type: 'string' }, type: { type: 'string' },
        status: { type: 'string' }, kind: { type: 'string' }, query: { type: 'string' },
      },
    },
    async execute(args, exec) {
      return listState({
        cwd: workspaceCwd(exec), dataRoot: args.data_root, runtime,
        options: { page: 1, pageSize: 50, type: args.type ?? '', status: args.status ?? '', kind: args.kind ?? '', query: args.query ?? '' },
      })
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
  })]
  const disposeRoute = ctx.webServer.register({ kind: 'exact', path: API_PATH, handler: (req, res) => routeHandler(req, res, runtime) })
  ctx.effect?.(() => () => {
    disposeRoute()
    for (const dispose of toolDisposers) dispose()
  }, 'dsh-pangea-asset-catalog: PANGEA Asset Management 2.0 API')
}

export { AssetActionRuntime, dataRootFor, runPangea } from './pangea-api.js'
export { MethodologyCandidateRuntime } from './methodology-runtime.js'
