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
    task_path: job.task.task_path,
    ...(job.completedAt ? { completed_at: job.completedAt } : {}),
    ...(job.error ? { error: job.error } : {}),
  }
}

function sameAssets(left, right) {
  const a = [...(left ?? [])].sort()
  const b = [...(right ?? [])].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export class MethodologyCandidateRuntime {
  constructor(api, runner = runPangea) {
    this.api = api
    this.runner = runner
    this.jobs = new Map()
    this.latest = new Map()
  }

  async derivations(cwd, dataRoot) {
    const result = await this.runner({
      cwd,
      args: ['methodologies', 'derivations', 'list', '--data-root', dataRoot, '--limit', '50'],
    })
    return result.items ?? []
  }

  async job(cwd, dataRoot) {
    const active = this.latest.get(path.resolve(dataRoot))
    if (active && !['completed', 'failed'].includes(active.status)) return jobView(active)
    const latest = (await this.derivations(cwd, dataRoot))[0]
    return latest ? {
      status: latest.status,
      started_at: latest.created_at,
      completed_at: latest.completed_at,
      source_asset_ids: latest.source_asset_ids,
      task_path: latest.task_path,
    } : null
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
    const active = this.latest.get(path.resolve(resolvedDataRoot))
    if (active && !['completed', 'failed'].includes(active.status) && sameAssets(active.assetIds, uniqueAssetIds)) {
      return { session_id: active.sessionId, task: active.task, execution: 'direct-skill', reused: true }
    }
    const recoverable = (await this.derivations(cwd, resolvedDataRoot)).find(item =>
      ['pending', 'ready'].includes(item.status) && sameAssets(item.source_asset_ids, uniqueAssetIds))
    if (recoverable?.status === 'ready') {
      await this.runner({
        cwd,
        args: ['methodologies', 'complete-derivation', '--task', recoverable.task_path],
      })
      return { completed: true, task_path: recoverable.task_path }
    }
    let prepared
    if (recoverable) {
      prepared = {
        execution: 'direct-skill',
        task: {
          task_id: recoverable.task_id,
          task_path: recoverable.task_path,
        },
      }
    } else {
      const deriveArgs = ['methodologies', 'derive', '--data-root', resolvedDataRoot]
      for (const assetId of uniqueAssetIds) deriveArgs.push('--asset-id', assetId)
      prepared = await this.runner({ cwd, args: deriveArgs })
    }
    if (prepared?.execution !== 'direct-skill' || !prepared?.task?.task_path) {
      throw new Error('PANGEA 未返回 direct-skill 方法论 task_path')
    }
    const root = workspaceRoot(cwd)
    const workerPath = path.join(root, '.agents', 'pangea', 'methodology-worker.md')
    const sessionId = await this.createSession(cwd, 'PANGEA 方法论候选')
    const job = {
      cwd, dataRoot: resolvedDataRoot, assetIds: uniqueAssetIds, task: prepared.task,
      workerPath, sessionId, status: 'queued', startedAt: new Date().toISOString(),
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
          `task_path: ${prepared.task.task_path}`,
          '只读取 task 指定的输入，只把完整 JSON 写入 task 的 result_path；不要创建 action、绑定器或 settle 记录。',
        ].join('\n'),
      }],
    })))
    return { session_id: sessionId, task: prepared.task, execution: 'direct-skill' }
  }

  async finish(job) {
    if (!job || ['completed', 'failed', 'finalizing'].includes(job.status)) return
    job.status = 'finalizing'
    try {
      await this.runner({
        cwd: job.cwd,
        args: ['methodologies', 'complete-derivation', '--task', job.task.task_path],
      })
      job.status = 'completed'
    } catch (error) {
      job.error = error instanceof Error ? error.message : String(error)
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
