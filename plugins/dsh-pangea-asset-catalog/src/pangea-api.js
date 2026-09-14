import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

function workspaceRoot(cwd) {
  if (typeof cwd !== 'string' || cwd.trim() === '') throw new Error('workspace cwd is required')
  let cursor = path.resolve(cwd)
  while (true) {
    if (existsSync(path.join(cursor, '.agents', 'pangea', 'dsh.md'))) return cursor
    const parent = path.dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  throw new Error(`PANGEA workspace not found from: ${cwd}`)
}

function pythonExecutable(root) {
  if (typeof process.env.PANGEA_PYTHON === 'string' && process.env.PANGEA_PYTHON.trim() !== '') {
    return process.env.PANGEA_PYTHON
  }
  const candidates = process.platform === 'win32'
    ? [path.join(root, '.venv', 'Scripts', 'python.exe'), 'python']
    : [path.join(root, '.venv', 'bin', 'python'), 'python3']
  return candidates.find(candidate => !path.isAbsolute(candidate) || existsSync(candidate))
}

function parseEnvelope(stdout) {
  const lines = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const value = JSON.parse(lines[index])
      if (value?.api_version === '1.0' && typeof value.ok === 'boolean') return value
    } catch {
      // Only the CLI JSON envelope is accepted.
    }
  }
  throw new Error('PANGEA CLI did not return a JSON envelope')
}

export function runPangea({ cwd, args }) {
  const root = workspaceRoot(cwd)
  const executable = pythonExecutable(root)
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-m', 'pangea_agent.cli.main', ...args], {
      cwd: root,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONPATH: [path.join(root, 'src'), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('close', code => {
      try {
        const envelope = parseEnvelope(stdout)
        if (code !== 0 || envelope.ok !== true) {
          reject(new Error(envelope.error?.message ?? stderr.trim() ?? `PANGEA CLI exited with ${code}`))
          return
        }
        resolve(envelope.result)
      } catch (error) {
        reject(new Error(stderr.trim() || error.message))
      }
    })
  })
}

export function dataRootFor(cwd, explicit) {
  if (typeof explicit === 'string' && explicit.trim() !== '') return path.resolve(explicit)
  return path.join(workspaceRoot(cwd), 'pangea-data')
}

function rpc(payload) { return { rpcId: `pangea-asset-${Date.now()}-${Math.random()}`, payload } }
function apiValue(response) {
  if (!response?.result?.ok) throw new Error(response?.result?.error?.message ?? 'DSH API request failed')
  return response.result.value
}

export class AssetActionRuntime {
  constructor(api, runner = runPangea) {
    this.api = api
    this.runner = runner
    this.jobs = new Map()
    this.sessions = new Map()
  }
  job(dataRoot, assetId) {
    const job = this.jobs.get(`${path.resolve(dataRoot)}\n${assetId}`)
    if (!job) return null
    return { status: job.status, started_at: job.startedAt, session_id: job.sessionId,
      completed_at: job.completedAt, error: job.error }
  }
  async adapter(job, operation) {
    const args = ['adapter', operation, '--data-root', job.dataRoot, '--asset-id', job.assetId,
      '--action-id', job.action.action_id]
    if (operation === 'bind') args.push('--task-id', job.sessionId)
    return this.runner({ cwd: job.cwd, args })
  }
  async start({ cwd, dataRoot, assetId }) {
    const resolvedDataRoot = dataRootFor(cwd, dataRoot)
    const key = `${path.resolve(resolvedDataRoot)}\n${assetId}`
    const active = this.jobs.get(key)
    if (active && ['preparing', 'queued', 'running', 'finalizing'].includes(active.status)) {
      return { completed: false, reused: true, session_id: active.sessionId }
    }
    const job = { cwd, dataRoot: resolvedDataRoot, assetId, status: 'preparing', startedAt: new Date().toISOString() }
    this.jobs.set(key, job)
    try {
      const prepared = await this.runner({ cwd, args: ['assets', 'extract', '--data-root', resolvedDataRoot, '--asset-id', assetId] })
      if (!prepared.action) {
        if (!['available', 'awaiting_review', 'no_items'].includes(prepared.asset?.status)) throw new Error('资产未完成提取且没有返回提取任务')
        job.status = 'completed'
        job.completedAt = new Date().toISOString()
        return { completed: true, asset: prepared.asset }
      }
      job.action = prepared.action
      job.sessionId = prepared.action.task_id || null
      if (job.sessionId) {
        // A restart resumes the asset's persisted identity, never a guessed latest session.
        try {
          const settled = await this.adapter(job, 'settle')
          job.status = 'completed'
          job.completedAt = new Date().toISOString()
          return { completed: true, asset: settled.asset }
        } catch (error) { job.repairReason = error.message }
      } else {
        const root = workspaceRoot(cwd)
        let payload = { cwd: root }
        if (this.api.workspace?.list) {
          const workspace = apiValue(await this.api.workspace.list(rpc({}))).items.find(item => path.resolve(item.path) === root)
          if (!workspace) throw new Error(`current DSH workspace is not registered: ${root}`)
          payload = { workspaceId: workspace.workspaceId }
        }
        job.sessionId = apiValue(await this.api.sessions.create(rpc(payload))).sessionId
        await this.adapter(job, 'bind')
        apiValue(await this.api.sessions.rename(rpc({ sessionId: job.sessionId, title: `资产提取 · ${prepared.asset.title ?? assetId}` })))
      }
      this.sessions.set(job.sessionId, job)
      job.status = 'queued'
      apiValue(await this.api.sessions.prompt(rpc({ sessionId: job.sessionId, mode: 'queue', content: [{ type: 'text', text: [
        `读取 ${path.join(workspaceRoot(cwd), '.agents', 'pangea', 'asset-extraction-worker.md')} 并执行。`,
        `task_path: ${job.action.task_path}`,
        '只读取此 task 的输入，在 task 指定 result_path 写完整提取 JSON。宿主负责提交，不要另建 action 或运行分析。',
        ...(job.repairReason ? [`修正同一结果后完成：${job.repairReason}`] : []),
      ].join('\n') }] })))
      return { completed: false, session_id: job.sessionId, action: job.action }
    } catch (error) {
      job.status = 'failed'; job.error = error.message; job.completedAt = new Date().toISOString()
      throw error
    }
  }
  async finish(job) {
    if (!job || ['completed', 'failed', 'finalizing'].includes(job.status)) return
    job.status = 'finalizing'
    try { await this.adapter(job, 'settle'); job.status = 'completed' }
    catch (error) { job.status = 'failed'; job.error = error.message }
    job.completedAt = new Date().toISOString()
  }
  handleAgentStatus(agent, status) {
    const job = this.sessions.get(agent?.session?.id)
    if (!job || ['completed', 'failed', 'finalizing'].includes(job.status)) return
    if (status === 'running') job.status = 'running'
    if (status === 'idle' && job.status === 'running') void this.finish(job)
  }
  handleAgentError(agent, error) {
    const job = this.sessions.get(agent?.session?.id)
    if (!job || job.status === 'completed') return
    job.status = 'failed'; job.error = error?.message ?? String(error); job.completedAt = new Date().toISOString()
  }
}

export { workspaceRoot }
