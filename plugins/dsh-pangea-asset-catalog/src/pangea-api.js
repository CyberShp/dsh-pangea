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
  // Compatibility name for hosts that already construct this runtime. Asset
  // processing is now deterministic and local; it never creates a DSH model
  // session and never binds, repairs, validates, or settles an action.
  constructor(_api, runner = runPangea) {
    this.runner = runner
    this.jobs = new Map()
  }

  job(dataRoot, assetId) {
    const value = this.jobs.get(`${path.resolve(dataRoot)}\n${assetId}`)
    if (!value) return null
    return {
      status: value.status,
      started_at: value.startedAt,
      ...(value.completedAt ? { completed_at: value.completedAt } : {}),
      ...(value.error ? { error: value.error } : {}),
    }
  }

  async start({ cwd, dataRoot, assetId }) {
    const resolvedDataRoot = dataRootFor(cwd, dataRoot)
    const key = `${path.resolve(resolvedDataRoot)}\n${assetId}`
    const job = {
      cwd, dataRoot: resolvedDataRoot, assetId, status: 'running',
      startedAt: new Date().toISOString(),
    }
    this.jobs.set(key, job)
    try {
      const prepared = await this.runner({
        cwd,
        args: ['assets', 'extract', '--data-root', resolvedDataRoot, '--asset-id', assetId],
      })
      job.status = 'completed'
      job.completedAt = new Date().toISOString()
      return { completed: true, asset: prepared.asset }
    } catch (error) {
      job.status = 'failed'
      job.error = error instanceof Error ? error.message : String(error)
      job.completedAt = new Date().toISOString()
      throw error
    }
  }

  handleAgentStatus() {}
  handleAgentError() {}
}

export { workspaceRoot }
