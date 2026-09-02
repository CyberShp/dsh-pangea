import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const PANGEA_MARKER = path.join('.agents', 'pangea', 'dsh.md')
const PENDING_REQUEST = path.join('pangea-data', '.pangea', 'pending-skill-request.json')
const REQUIRED_ANALYSIS_SKILL = Object.freeze({ skill_id: 'codetalks-skill', version: '1.0.0' })

export function normalizeSourceScope(values, repository) {
  const items = Array.isArray(values) ? values : []
  const repositoryName = typeof repository === 'string' ? repository.trim() : ''
  return [...new Set(items.map(item => {
    const value = typeof item === 'string' ? item.trim() : ''
    if (!value) return ''
    const absolute = path.win32.isAbsolute(value) || path.posix.isAbsolute(value)
    if (!absolute) return value.replaceAll('\\', '/').replace(/^\.\/+/, '')
    const parts = value.split(/[\\/]+/).filter(Boolean)
    const repositoryIndex = parts.map(part => part.toLowerCase()).lastIndexOf(repositoryName.toLowerCase())
    if (!repositoryName || repositoryIndex < 0) {
      throw new Error(`源码范围不属于已选仓库“${repositoryName}”：${value}。请粘贴该仓库内的地址，或填写仓库相对路径。`)
    }
    return parts.slice(repositoryIndex + 1).join('/') || '.'
  }).filter(Boolean))]
}

export function assertCodetalksSkill(capabilities) {
  const skill = capabilities?.analysis_skill
  if (skill?.skill_id !== REQUIRED_ANALYSIS_SKILL.skill_id || skill?.version !== REQUIRED_ANALYSIS_SKILL.version) {
    throw new Error('PANGEA backend must provide codetalks-skill 1.0.0')
  }
  return skill
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
    data_root: dataRoot,
    repository: input.repository,
    target: input.target,
    source_scope: normalizeSourceScope(input.source_scope, input.repository),
    focus: input.focus ?? [],
    asset_ids: input.asset_ids ?? [],
    test_case_examples: input.test_case_examples ?? [],
  }
  const capabilities = await runner({
    cwd: root,
    args: ['system', 'capabilities', '--data-root', dataRoot],
  })
  assertCodetalksSkill(capabilities)
  await mkdir(path.dirname(pendingPath), { recursive: true })
  await rm(pendingPath, { force: true })
  await writeFile(pendingPath, `${JSON.stringify(request, null, 2)}\n`, 'utf8')
  try {
    return await runner({ cwd: root, args: ['runs', 'create', '--request', pendingPath] })
  } finally {
    await rm(pendingPath, { force: true })
  }
}
