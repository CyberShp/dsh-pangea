import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const PANGEA_MARKER = path.join('.agents', 'pangea', 'dsh.md')
const PENDING_CONTRACT = path.join('pangea-data', '.pangea', 'pending-task-contract.json')

export function workspaceRoot(cwd) {
  if (typeof cwd !== 'string' || cwd.trim() === '') throw new Error('workspace cwd is required')
  let cursor = path.resolve(cwd)
  while (true) {
    if (existsSync(path.join(cursor, PANGEA_MARKER))) return cursor
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
      // Only the PANGEA JSON envelope is accepted.
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

export async function createRun(cwd, input, runner = runPangea) {
  const root = workspaceRoot(cwd)
  const pendingPath = path.join(root, PENDING_CONTRACT)
  const dataRoot = typeof input.data_root === 'string' && input.data_root.trim() !== ''
    ? path.resolve(root, input.data_root)
    : path.join(root, 'pangea-data')
  const contract = {
    data_root: dataRoot,
    mode: 'module_analysis',
    repository: input.repository,
    target: input.target,
    source_scope: input.source_scope,
    focus: input.focus ?? [],
  }
  await mkdir(path.dirname(pendingPath), { recursive: true })
  await rm(pendingPath, { force: true })
  await writeFile(pendingPath, `${JSON.stringify(contract, null, 2)}\n`, 'utf8')
  try {
    return await runner({ cwd: root, args: ['runs', 'create', '--contract', pendingPath] })
  } finally {
    await rm(pendingPath, { force: true })
  }
}

export function runAdapter(cwd, operation, input, runner = runPangea) {
  return runner({
    cwd,
    args: [
      'adapter', operation, '--data-root', input.data_root,
      '--run-id', input.run_id, '--action-id', input.action_id,
      ...(operation === 'bind' ? ['--task-id', input.task_id] : []),
    ],
  })
}
