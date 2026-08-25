import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

function rpc(payload) {
  return { rpcId: `pangea-asset-${Date.now()}-${Math.random()}`, payload }
}

function apiValue(response) {
  if (!response?.result?.ok) {
    throw new Error(response?.result?.error?.message ?? 'DSH API request failed')
  }
  return response.result.value
}

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

export class AssetActionRuntime {
  constructor(api, runner = runPangea) {
    this.api = api
    this.runner = runner
    this.jobs = new Map()
  }

  job(dataRoot, assetId) {
    const value = this.jobs.get(`${path.resolve(dataRoot)}\n${assetId}`)
    if (!value) return null
    return {
      status: value.status,
      session_id: value.sessionId,
      started_at: value.startedAt,
      ...(value.completedAt ? { completed_at: value.completedAt } : {}),
      ...(value.error ? { error: value.error } : {}),
    }
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

  async start({ cwd, dataRoot, assetId }) {
    const resolvedDataRoot = dataRootFor(cwd, dataRoot)
    const prepared = await this.runner({
      cwd,
      args: ['assets', 'extract', '--data-root', resolvedDataRoot, '--asset-id', assetId],
    })
    if (!prepared.action) return { completed: true, asset: prepared.asset }
    const sessionId = await this.createSession(cwd, `资产提取 · ${prepared.asset.title}`)
    await this.runner({
      cwd,
      args: [
        'adapter', 'bind', '--data-root', resolvedDataRoot, '--asset-id', assetId,
        '--action-id', prepared.action.action_id, '--task-id', sessionId,
      ],
    })
    const job = {
      cwd, dataRoot: resolvedDataRoot, assetId, action: prepared.action,
      sessionId, status: 'queued', retries: 0, startedAt: new Date().toISOString(),
    }
    this.jobs.set(`${path.resolve(resolvedDataRoot)}\n${assetId}`, job)
    this.jobs.set(sessionId, job)
    const prompted = await this.api.sessions.prompt(rpc({
      sessionId,
      mode: 'queue',
      content: [{
        type: 'text',
        text: [
          '读取 .agents/pangea/asset-extraction-worker.md 并严格执行。',
          `task_path: ${prepared.action.task_path}`,
          '只把完整结构化 JSON 写入 task 的 result_path；不要修改其他文件。',
        ].join('\n'),
      }],
    }))
    apiValue(prompted)
    return { completed: false, session_id: sessionId, asset: prepared.asset, action: prepared.action }
  }

  async finish(job) {
    if (!job || ['completed', 'failed', 'finalizing'].includes(job.status)) return
    job.status = 'finalizing'
    try {
      await this.runner({
        cwd: job.cwd,
        args: [
          'adapter', 'validate', '--data-root', job.dataRoot, '--asset-id', job.assetId,
          '--action-id', job.action.action_id,
        ],
      })
      await this.runner({
        cwd: job.cwd,
        args: [
          'adapter', 'settle', '--data-root', job.dataRoot, '--asset-id', job.assetId,
          '--action-id', job.action.action_id,
        ],
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
              text: `PANGEA 结果契约校验失败：${message}\n请读取原 task，只修正同一 result_path 后结束。`,
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

export { workspaceRoot }
