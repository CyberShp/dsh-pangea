import path from 'node:path'

import { dataRootFor, runPangea, workspaceRoot } from './pangea-api.js'

function rpc(payload) {
  return { rpcId: `pangea-methodology-${Date.now()}-${Math.random()}`, payload }
}

function apiValue(response) {
  if (!response?.result?.ok) throw new Error(response?.result?.error?.message ?? 'DSH API request failed')
  return response.result.value
}

function jobView(job) {
  if (!job) return null
  return {
    status: job.status,
    session_id: job.sessionId,
    started_at: job.startedAt,
    source_asset_ids: job.assetIds,
    task_path: job.action.task_path,
    ...(job.completedAt ? { completed_at: job.completedAt } : {}),
    ...(job.error ? { error: job.error } : {}),
  }
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

  async start({ cwd, dataRoot, assetIds }) {
    const resolvedDataRoot = dataRootFor(cwd, dataRoot)
    const uniqueAssetIds = [...new Set((assetIds ?? []).filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))]
    if (uniqueAssetIds.length === 0) throw new Error('至少选择一个已批准历史缺陷资产')
    const deriveArgs = ['methodologies', 'derive', '--data-root', resolvedDataRoot]
    for (const assetId of uniqueAssetIds) deriveArgs.push('--asset-id', assetId)
    const prepared = await this.runner({ cwd, args: deriveArgs })
    if (!prepared?.action?.task_path) throw new Error('PANGEA 未返回方法论提炼 task_path')
    const root = workspaceRoot(cwd)
    const workerPath = path.join(root, '.agents', 'pangea', 'methodology-worker.md')
    const sessionId = await this.createSession(cwd, 'PANGEA 方法论候选')
    const job = {
      cwd, dataRoot: resolvedDataRoot, assetIds: uniqueAssetIds, action: prepared.action,
      workerPath, sessionId, status: 'queued', retries: 0, startedAt: new Date().toISOString(),
    }
    this.jobs.set(sessionId, job)
    this.latest.set(path.resolve(resolvedDataRoot), job)
    apiValue(await this.api.sessions.prompt(rpc({
      sessionId,
      mode: 'queue',
      content: [{
        type: 'text',
        text: [
          `读取 ${workerPath} 并严格执行。`,
          `task_path: ${prepared.action.task_path}`,
          '只读取 task 指定的输入，只把完整 JSON 写入 task 的 result_path；不要修改其他文件。',
        ].join('\n'),
      }],
    })))
    return { session_id: sessionId, action: prepared.action }
  }

  async finish(job) {
    if (!job || ['completed', 'failed', 'finalizing'].includes(job.status)) return
    job.status = 'finalizing'
    try {
      await this.runner({
        cwd: job.cwd,
        args: ['methodologies', 'complete-derivation', '--task', job.action.task_path],
      })
      job.status = 'completed'
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (job.retries === 0) {
        job.retries = 1
        job.status = 'queued'
        try {
          apiValue(await this.api.sessions.prompt(rpc({
            sessionId: job.sessionId,
            mode: 'queue',
            content: [{
              type: 'text',
              text: [
                `PANGEA 方法论结果校验失败：${message}`,
                `重新读取 ${job.workerPath} 和 task_path: ${job.action.task_path}。`,
                '只修正同一 result_path，完成后结束。',
              ].join('\n'),
            }],
          })))
          return
        } catch (promptError) {
          job.error = promptError instanceof Error ? promptError.message : String(promptError)
        }
      } else {
        job.error = message
      }
      job.status = 'failed'
    }
    job.completedAt = new Date().toISOString()
  }

  handleAgentStatus(agent, status) {
    const job = this.jobs.get(agent?.session?.id)
    if (!job || ['completed', 'failed', 'finalizing'].includes(job.status)) return
    if (status === 'running') job.status = 'running'
    if (status === 'idle' && job.status === 'running') void this.finish(job)
  }

  handleAgentError(agent, error) {
    const job = this.jobs.get(agent?.session?.id)
    if (!job || ['completed', 'failed'].includes(job.status)) return
    job.status = 'failed'
    job.error = error instanceof Error ? error.message : String(error)
    job.completedAt = new Date().toISOString()
  }
}
