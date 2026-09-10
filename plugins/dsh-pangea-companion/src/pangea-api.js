import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const PANGEA_MARKER = path.join('.agents', 'pangea', 'dsh.md')
const PENDING_REQUEST = path.join('pangea-data', '.pangea', 'pending-skill-request.json')
const REQUIRED_ANALYSIS_SKILL = Object.freeze({ skill_id: 'codetalks-skill', version: '1.3.0' })
const SOURCE_FIRST_VERSION = 'source-first-v1'

export function normalizeSourceScope(values, repository) {
  const items = Array.isArray(values) ? values : []
  const repositoryName = typeof repository === 'string' ? repository.trim() : ''
  return [...new Set(items.map(item => {
    const original = typeof item === 'string' ? item.trim() : ''
    let value = original.replace(/^['"]|['"]$/g, '')
    if (/^file:\/\//i.test(value)) value = value.replace(/^file:\/\/+?/i, '')
    if (!value) return ''
    const absolute = path.win32.isAbsolute(value) || path.posix.isAbsolute(value)
    if (!absolute) return value.replaceAll('\\', '/').replace(/^\.\/+/, '')
    const parts = value.split(/[\\/]+/).filter(Boolean)
    const repositoryIndex = parts.map(part => part.toLowerCase()).lastIndexOf(repositoryName.toLowerCase())
    if (!repositoryName || repositoryIndex < 0) {
      throw new Error(`源码范围不属于已选仓库“${repositoryName}”：${original}。请粘贴该仓库内的地址，或填写仓库相对路径。`)
    }
    return parts.slice(repositoryIndex + 1).join('/') || '.'
  }).filter(Boolean))]
}

export function assertCodetalksSkill(capabilities) {
  const skill = capabilities?.analysis_skill
  if (skill?.skill_id !== REQUIRED_ANALYSIS_SKILL.skill_id || skill?.version !== REQUIRED_ANALYSIS_SKILL.version) {
    throw new Error('PANGEA backend must provide codetalks-skill 1.3.0')
  }
  return skill
}

export function assertSourceFirstCapabilities(capabilities) {
  const versions = Array.isArray(capabilities?.workflow_versions)
    ? capabilities.workflow_versions
    : []
  if (!versions.includes(SOURCE_FIRST_VERSION) && capabilities?.source_first?.version !== SOURCE_FIRST_VERSION) {
    throw new Error(`PANGEA backend must provide ${SOURCE_FIRST_VERSION}`)
  }
  return capabilities.source_first ?? { version: SOURCE_FIRST_VERSION }
}

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

export async function createRun(cwd, input, runner = runPangea) {
  const root = workspaceRoot(cwd)
  const pendingPath = path.join(root, PENDING_REQUEST)
  const dataRoot = typeof input.data_root === 'string' && input.data_root.trim() !== ''
    ? path.resolve(root, input.data_root)
    : path.join(root, 'pangea-data')
  const request = {
    workflow_version: SOURCE_FIRST_VERSION,
    data_root: dataRoot,
    repository: input.repository,
    target: input.target,
    source_scope: normalizeSourceScope(input.source_scope, input.repository),
    asset_ids: input.asset_ids ?? [],
    focus: Array.isArray(input.focus) ? input.focus : [],
    test_case_examples: Array.isArray(input.test_case_examples) ? input.test_case_examples : [],
    ...(typeof input.runtime_commit === 'string' && input.runtime_commit.trim() ? { runtime_commit: input.runtime_commit.trim() } : {}),
    ...(typeof input.model_id === 'string' && input.model_id.trim() ? { model_id: input.model_id.trim() } : {}),
    ...(Number.isInteger(input.effective_context_budget) && input.effective_context_budget > 0
      ? { effective_context_budget: input.effective_context_budget }
      : {}),
  }
  const capabilities = await runner({
    cwd: root,
    args: ['system', 'capabilities', '--data-root', dataRoot],
  })
  assertSourceFirstCapabilities(capabilities)
  await mkdir(path.dirname(pendingPath), { recursive: true })
  await rm(pendingPath, { force: true })
  await writeFile(pendingPath, `${JSON.stringify(request, null, 2)}\n`, 'utf8')
  try {
    return await runner({ cwd: root, args: ['runs', 'create', '--contract', pendingPath] })
  } finally {
    await rm(pendingPath, { force: true })
  }
}

export async function runSourceFirstCommand(cwd, args, runner = runPangea) {
  const root = workspaceRoot(cwd)
  if (!Array.isArray(args) || args.length === 0 || args.some(item => typeof item !== 'string' || item.trim() === '')) {
    throw new TypeError('PANGEA command arguments must be non-empty strings')
  }
  return runner({ cwd: root, args })
}

// The DSH lifecycle policy needs the same deterministic CLI boundary as the
// explicit source-first tools.  Keep the adapter operation and its identity
// fields together so a dispatched child can only bind/settle the Graph action
// that created it.
export async function runAdapter(cwd, operation, input) {
  if (!['bind', 'settle'].includes(operation)) throw new Error(`unsupported PANGEA adapter operation: ${operation}`)
  const values = [
    'adapter', operation,
    '--data-root', input?.data_root,
    '--run-id', input?.run_id,
    '--action-id', input?.action_id,
  ]
  if (operation === 'bind') values.push('--task-id', input?.task_id)
  return runSourceFirstCommand(cwd, values)
}
