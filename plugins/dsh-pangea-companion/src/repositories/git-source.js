import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, readdir, realpath, lstat, mkdir, rm } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { writeTaskStoreFile } from '../task-store.js'

const exec = promisify(execFile)
export async function sourceGit(cwd, args) {
  try {
    return (await exec('git', ['-c', 'core.hooksPath=', '-c', 'core.longpaths=true', ...args], { cwd, windowsHide: true, timeout: args[0] === 'clone' ? 1800000 : 30000, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_LFS_SKIP_SMUDGE: '1' } })).stdout.trimEnd()
  } catch (error) {
    if (error.code === 'ENOENT') throw Object.assign(new Error('未安装 Git；本地目录分析仍可使用，克隆和打桩需要 Git'), { code: 'GIT_MISSING' })
    throw new Error(String(error.stderr || error.message).replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/g, '$1***@'))
  }
}
export function validateGitUrl(value) {
  const url = String(value || '').trim()
  if (!/^(https?:\/\/|ssh:\/\/|git@[^\s:]+:)/.test(url) || /[\x00-\x20]/.test(url)) throw new Error('请输入 HTTP、HTTPS 或 SSH Git 仓库地址')
  if (/^https?:\/\//.test(url) && (new URL(url).username || new URL(url).password)) throw new Error('仓库地址请勿包含账号密码，使用本机 Git 凭据')
  return url
}
export function validateRef(value) {
  const ref = String(value || 'HEAD').trim()
  if (!ref || ref.startsWith('-') || /[\x00-\x20]/.test(ref)) throw new Error('请输入有效分支、标签或提交')
  return ref
}
export function validatePipeline(value) {
  const url = String(value || '').trim()
  if (url) { let parsed; try { parsed = new URL(url) } catch { throw new Error('请输入完整的流水线 HTTP/HTTPS 地址') }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('流水线地址需使用 HTTP/HTTPS，且不能包含账号密码') }
  return url
}
export async function inspectSource(sourcePath) {
  const root = await realpath(sourcePath)
  if (!(await lstat(root)).isDirectory()) throw new Error('请选择源码目录')
  // A plain folder works even when Git is not installed. Do not adopt a parent repository.
  try { await lstat(path.join(root, '.git')) } catch (error) { if (error.code === 'ENOENT') return { kind: 'folder', path: root }; throw error }
  try {
    const top = await sourceGit(root, ['rev-parse', '--show-toplevel'])
    if (await realpath(top) !== root) return { kind: 'folder', path: root }
    const commit = await sourceGit(root, ['rev-parse', '--verify', 'HEAD^{commit}'])
    const branch = await sourceGit(root, ['branch', '--show-current'])
    const status = await sourceGit(root, ['status', '--porcelain'])
    const dirty = Boolean(status)
    const entries = status.split('\n').filter(Boolean)
    const tracked_changes = entries.some(line => !line.startsWith('?? '))
    const untracked_files = entries.some(line => line.startsWith('?? '))
    let remote = ''; try { remote = await sourceGit(root, ['remote', 'get-url', '--push', 'origin']) } catch {}
    return { kind: 'git', path: root, commit, branch, dirty, tracked_changes, untracked_files, remote: remote.replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/g, '$1***@') }
  } catch (error) { return { kind: 'git-unavailable', path: root, error: error.message } }
}
function configPath(dataRoot, repoId) {
  if (!repoId || /[\\/\x00-\x1f]/.test(repoId) || ['.', '..'].includes(repoId)) throw new Error('仓库标识无效')
  return path.join(dataRoot, '.pangea', 'repository-settings', `${repoId}.json`)
}
export async function readRepositorySettings(dataRoot, repoId) {
  try { return JSON.parse(await readFile(configPath(dataRoot, repoId), 'utf8')) } catch (error) { if (error.code === 'ENOENT') return {}; throw error }
}
export async function saveRepositorySettings(dataRoot, repoId, input) {
  const file = configPath(dataRoot, repoId)
  await realpath(path.join(dataRoot, 'repositories', repoId))
  const previous = await readRepositorySettings(dataRoot, repoId)
  const next = { ...previous, pipeline_url: validatePipeline(input.pipeline_url ?? previous.pipeline_url) }
  if (input.git_path !== undefined) {
    if (input.git_path) {
      const info = await inspectSource(input.git_path)
      if (info.kind !== 'git') throw new Error(info.error || '请选择完整的 Git 仓库根目录')
      const ref = validateRef(input.base_ref)
      next.git_path = info.path
      next.base_ref = await sourceGit(info.path, ['rev-parse', '--verify', `${ref}^{commit}`])
    } else { delete next.git_path; delete next.base_ref }
  }
  if (input.personal_branch !== undefined || next.personal_branch) {
    const branch = String(input.personal_branch ?? next.personal_branch).trim()
    if (!branch || branch.startsWith('-') || branch === 'HEAD' || branch.startsWith('refs/')) throw new Error('请选择已存在的个人开发分支')
    const root = next.git_path || path.join(dataRoot, 'repositories', repoId)
    await sourceGit(root, ['check-ref-format', '--branch', branch])
    await sourceGit(root, ['rev-parse', '--verify', `refs/heads/${branch}^{commit}`])
    const remote = String(input.remote ?? next.remote ?? 'origin').trim()
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)) throw new Error('远端名称无效')
    await sourceGit(root, ['remote', 'get-url', '--push', remote])
    next.personal_branch = branch; next.remote = remote
  }
  await writeTaskStoreFile(file, JSON.stringify(next, null, 2))
  return next
}
// Compare only the analysis snapshot; no whole-repository model review is needed.
export async function compareSnapshot(gitRoot, ref, snapshotRoot) {
  let stat; try { stat = await lstat(snapshotRoot) } catch (error) { if (error.code === 'ENOENT') return { available: false, changed_count: 0, files: [] }; throw error }
  if (!stat.isDirectory()) throw new Error('分析源码快照目录无效')
  const tree = await sourceGit(gitRoot, ['ls-tree', '-r', '-z', validateRef(ref)])
  const blobs = new Map(tree.split('\0').filter(Boolean).map(line => { const split = line.indexOf('\t'); return [line.slice(split + 1), line.slice(0, split).split(' ')[2]] }))
  let compared = 0, changed = 0, eolOnly = 0; const files = [], eolFiles = []
  const walk = async (directory, prefix = '') => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.name === '.git') continue
      const relative = prefix + item.name, file = path.join(directory, item.name)
      if (item.isDirectory()) await walk(file, relative + '/')
      else if (item.isFile()) {
        const bytes = await readFile(file), expected = blobs.get(relative)
        const actual = createHash(expected?.length === 64 ? 'sha256' : 'sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
        compared++
        if (expected !== actual) {
          // Classify only exact CRLF -> LF equivalence. Never execute clean filters
          // or rewrite snapshots; binary/invalid UTF-8 and all other changes remain visible.
          let normalized
          if (expected && !bytes.includes(0)) {
            try { normalized = Buffer.from(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes).replace(/\r\n/g, '\n')) } catch {}
          }
          const eolHash = normalized && createHash(expected.length === 64 ? 'sha256' : 'sha1').update(`blob ${normalized.length}\0`).update(normalized).digest('hex')
          if (expected && eolHash === expected) { eolOnly++; if (eolFiles.length < 30) eolFiles.push(relative) }
          else { changed++; if (files.length < 30) files.push(relative) }
        }
      }
    }
  }
  await walk(snapshotRoot)
  return { available: true, compared_count: compared, changed_count: changed, files, eol_only_count: eolOnly, eol_only_files: eolFiles }
}

export async function configureRepository(dataRoot, repoId, input) {
  if (!input.git_url) return saveRepositorySettings(dataRoot, repoId, input)
  configPath(dataRoot, repoId)
  await realpath(path.join(dataRoot, 'repositories', repoId))
  const url = validateGitUrl(input.git_url), ref = validateRef(input.base_ref)
  const parent = path.join(dataRoot, '.pangea', 'linked-repositories')
  await mkdir(parent, { recursive: true })
  const target = path.join(parent, randomUUID())
  try {
    await sourceGit(parent, ['clone', '--', url, target])
    const commit = await sourceGit(target, ['rev-parse', '--verify', `${ref}^{commit}`]).catch(() => sourceGit(target, ['rev-parse', '--verify', `refs/remotes/origin/${ref}^{commit}`]))
    return await saveRepositorySettings(dataRoot, repoId, { ...input, git_path: target, base_ref: commit })
  } catch (error) { await rm(target, { recursive: true, force: true }); throw error }
}
