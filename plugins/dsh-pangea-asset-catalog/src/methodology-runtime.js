import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { dataRootFor, runPangea, workspaceRoot } from './pangea-api.js'

function rpc(payload) {
  return { rpcId: `pangea-methodology-${Date.now()}-${Math.random()}`, payload }
}

function apiValue(response) {
  if (!response?.result?.ok) throw new Error(response?.result?.error?.message ?? 'DSH API request failed')
  return response.result.value
}

function structuredItems(result) {
  if (!result || typeof result !== 'object') return []
  for (const key of ['items', 'defects', 'records']) {
    if (Array.isArray(result[key])) return result[key]
  }
  return []
}

function itemId(item) {
  for (const key of ['item_id', 'defect_id', 'id']) {
    if (typeof item?.[key] === 'string' && item[key].trim()) return item[key].trim()
  }
  return ''
}

function jobView(job) {
  if (!job) return null
  return {
    status: job.status,
    session_id: job.sessionId,
    started_at: job.startedAt,
    source_asset_ids: job.assetIds,
    ...(job.completedAt ? { completed_at: job.completedAt } : {}),
    ...(job.error ? { error: job.error } : {}),
  }
}

export const METHODOLOGY_SUBMISSION_PARAMETERS = {
  type: 'object', additionalProperties: false, required: ['candidates'],
  properties: {
    candidates: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['methodology_id', 'title', 'applicable_when', 'checks', 'expected_signals', 'failure_signals', 'source_item_ids'],
        properties: {
          methodology_id: { type: 'string', minLength: 1 },
          title: { type: 'string', minLength: 1 },
          applicable_when: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
          checks: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
          expected_signals: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
          failure_signals: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
          exceptions: { type: 'array', items: { type: 'string', minLength: 1 } },
          source_item_ids: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
        },
      },
    },
  },
}

export class MethodologyCandidateRuntime {
  constructor(api, runner = runPangea) {
    this.api = api
    this.runner = runner
    this.jobs = new Map()
    this.latest = new Map()
  }

  job(dataRoot) {
    return jobView(this.latest.get(path.resolve(dataRoot)))
  }

  async createSession(cwd, title) {
    const root = workspaceRoot(cwd)
    let payload = { cwd: root }
    if (this.api.workspace?.list) {
      const workspaces = apiValue(await this.api.workspace.list(rpc({}))).items
      const workspace = workspaces.find(item => path.resolve(item.path) === root)
      if (!workspace) throw new Error(`current DSH workspace is not registered: ${root}`)
      payload = { workspaceId: workspace.workspaceId }
    }
    const sessionId = apiValue(await this.api.sessions.create(rpc(payload))).sessionId
    apiValue(await this.api.sessions.rename(rpc({ sessionId, title })))
    return sessionId
  }

  async approvedSources(cwd, dataRoot, assetIds) {
    const sources = []
    for (const assetId of assetIds) {
      const detail = await this.runner({ cwd, args: ['assets', 'get', '--data-root', dataRoot, '--asset-id', assetId] })
      const asset = detail.asset
      if (asset?.asset_type !== 'historical_defect' || asset?.status !== 'available') {
        throw new Error(`只有已批准的历史缺陷资产可以生成方法论：${assetId}`)
      }
      for (const item of structuredItems(detail.result)) {
        const id = itemId(item)
        if (!id) continue
        sources.push({ source_item_id: `${assetId}:${id}`, asset_id: assetId, item })
      }
    }
    if (sources.length === 0) throw new Error('所选历史缺陷资产没有可引用的已批准条目')
    return sources
  }

  async start({ cwd, dataRoot, assetIds }) {
    const resolvedDataRoot = dataRootFor(cwd, dataRoot)
    const uniqueAssetIds = [...new Set((assetIds ?? []).filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))]
    if (uniqueAssetIds.length === 0) throw new Error('至少选择一个已批准历史缺陷资产')
    const [capabilities, sources, existing] = await Promise.all([
      this.runner({ cwd, args: ['system', 'capabilities', '--data-root', resolvedDataRoot] }),
      this.approvedSources(cwd, resolvedDataRoot, uniqueAssetIds),
      this.runner({ cwd, args: ['methodologies', 'list', '--data-root', resolvedDataRoot, '--limit', '200'] }),
    ])
    const sessionId = await this.createSession(cwd, 'PANGEA 方法论候选')
    const job = {
      cwd, dataRoot: resolvedDataRoot, assetIds: uniqueAssetIds, sources,
      sessionId, status: 'queued', startedAt: new Date().toISOString(),
    }
    this.jobs.set(sessionId, job)
    this.latest.set(path.resolve(resolvedDataRoot), job)
    apiValue(await this.api.sessions.prompt(rpc({
      sessionId,
      mode: 'queue',
      content: [{
        type: 'text',
        text: [
          '根据下面已批准的历史缺陷条目，生成少量可复用、非约束性的方法论候选。',
          '候选只描述适用条件、检查方向和信号，不得把历史结论直接当作当前项目事实。',
          '完成后调用 pangea_methodology_candidate_submit；不要写入资产目录或自行修改 PANGEA 文件。',
          `候选 schema：${capabilities.methodologies?.candidate_schema_path ?? capabilities.candidate_schema_path ?? '由提交工具参数约束'}`,
          `现有方法论 ID：${(existing.items ?? []).map(item => item.methodology_id).join('、') || '无'}`,
          '',
          '[已批准历史缺陷条目]',
          JSON.stringify(sources, null, 2),
        ].join('\n'),
      }],
    })))
    return { session_id: sessionId, source_item_count: sources.length }
  }

  async submit(args, exec) {
    const sessionId = exec?.agent?.session?.id
    const job = this.jobs.get(sessionId)
    if (!job) throw new Error('该会话不是 Desktop 启动的方法论候选会话')
    if (job.status === 'completed') throw new Error('该会话已经提交过方法论候选')
    const allowed = new Set(job.sources.map(item => item.source_item_id))
    for (const candidate of args.candidates ?? []) {
      for (const sourceId of candidate.source_item_ids ?? []) {
        if (!allowed.has(sourceId)) throw new Error(`候选引用了本会话未提供的历史缺陷条目：${sourceId}`)
      }
    }
    const directory = path.join(job.dataRoot, 'methodologies')
    await mkdir(directory, { recursive: true })
    const inputPath = path.join(directory, `.desktop-candidate-${randomUUID()}.json`)
    await writeFile(inputPath, `${JSON.stringify({
      schema_version: '1.0', generated_at: new Date().toISOString(),
      source: 'confirmed_historical_defects', non_binding: true, candidates: args.candidates,
    }, null, 2)}\n`, 'utf8')
    try {
      const imported = await this.runner({
        cwd: job.cwd,
        args: ['methodologies', 'import', '--data-root', job.dataRoot, '--input', inputPath],
      })
      job.status = 'completed'
      job.completedAt = new Date().toISOString()
      return { status: 'ok', imported }
    } finally {
      await unlink(inputPath).catch(() => {})
    }
  }

  handleAgentStatus(agent, status) {
    const job = this.jobs.get(agent?.session?.id)
    if (!job || ['completed', 'failed'].includes(job.status)) return
    if (status === 'running') job.status = 'running'
    if (status === 'idle' && job.status === 'running') {
      job.status = 'failed'
      job.error = '语义会话结束，但没有提交方法论候选'
      job.completedAt = new Date().toISOString()
    }
  }

  handleAgentError(agent, error) {
    const job = this.jobs.get(agent?.session?.id)
    if (!job || ['completed', 'failed'].includes(job.status)) return
    job.status = 'failed'
    job.error = error instanceof Error ? error.message : String(error)
    job.completedAt = new Date().toISOString()
  }
}
