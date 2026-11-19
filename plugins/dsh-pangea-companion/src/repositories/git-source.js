import { repositoryOperationSignal } from './operations.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, readdir, realpath, lstat, mkdir, rm } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { writeTaskStoreFile } from '../task-store.js'
import { withGitLongPaths, disabledHooksPath } from './git-environment.js'
import { protectedBranchReason } from './branch-policy.js'

const exec = promisify(execFile)
export async function sourceGit(cwd, args) {
  const startedAt = Date.now()
  const hooksPath = await disabledHooksPath()
  try {
    // Do not pass a potentially >260-character path to Windows process creation.
    const signal = repositoryOperationSignal()
    return (await withGitLongPaths(env => exec('git', ['-c', `core.hooksPath=${hooksPath}`, '-c', 'core.longpaths=true', '-C', path.resolve(cwd), ...args], { signal, windowsHide: true, timeout: ['clone', 'lfs'].includes(args[0]) ? 1800000 : 30000, maxBuffer: 32 * 1024 * 1024,
      env: { ...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_LFS_SKIP_SMUDGE: '1' } }), { cwd, signal })).stdout.trimEnd()
  } catch (error) {
    repositoryOperationSignal()?.throwIfAborted()
    const failure = error.code === 'ENOENT'
      ? Object.assign(new Error('未安装 Git；本地目录分析仍可使用，克隆和打桩需要 Git'), { code: 'GIT_MISSING' })
      : new Error(String(error.stderr || error.message).replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/g, '$1***@'))
    failure.gitDiagnostic = {
      subcommand: /^[a-z][a-z-]*$/.test(args[0] || '') ? args[0] : 'git',
      exit_code: Number.isInteger(error.code) ? error.code : null,
      signal: error.signal || null,
      elapsed_ms: Math.max(0, Date.now() - startedAt),
      lfs_skip_smudge: '1',
    }
    throw failure
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
    const [commit, branch, status, remote] = await Promise.all([
      sourceGit(root, ['rev-parse', '--verify', 'HEAD^{commit}']),
      sourceGit(root, ['branch', '--show-current']),
      sourceGit(root, ['status', '--porcelain']),
      sourceGit(root, ['remote', 'get-url', '--push', 'origin']).catch(() => ''),
    ])
    const dirty = Boolean(status)
    const entries = status.split('\n').filter(Boolean)
    const tracked_changes = entries.some(line => !line.startsWith('?? '))
    const untracked_files = entries.some(line => line.startsWith('?? '))
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
  const branch = String(input.personal_branch ?? previous.personal_branch ?? '').trim()
  const remote = String(input.remote ?? previous.remote ?? 'origin').trim()
  const remoteBranch = String(input.remote_branch ?? previous.remote_branch ?? branch).trim()
  const changed = ['personal_branch', 'remote', 'remote_branch', 'git_path'].some(key => input[key] !== undefined && input[key] !== previous[key])
  if (branch && changed) {
    const root = next.git_path || path.join(dataRoot, 'repositories', repoId)
    await sourceGit(root, ['check-ref-format', '--branch', branch])
    await sourceGit(root, ['check-ref-format', '--branch', remoteBranch])
    if (branch === 'HEAD' || branch.startsWith('refs/') || remoteBranch.startsWith('refs/')) throw new Error('请选择分支名称，不要填写完整引用')
    const forbidden = protectedBranchReason(branch) || protectedBranchReason(remoteBranch)
    if (forbidden) throw new Error(`${forbidden}；请选择或新建自己的个人开发分支`)
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)) throw new Error('远端名称无效')
    const remotes = (await sourceGit(root, ['remote'])).split('\n').filter(Boolean)
    if (!remotes.includes(remote)) throw new Error(`推送远端 ${remote} 不存在；现有远端：${remotes.join('、') || '无'}。请选择现有远端，或先使用 git remote add 添加远端。`)
    const urls = (await sourceGit(root, ['remote', 'get-url', '--push', '--all', remote])).split('\n').filter(Boolean)
    if (urls.length !== 1) throw new Error('请选择只有一个推送地址的远端')
    try { await sourceGit(root, ['rev-parse', '--verify', `refs/heads/${branch}^{commit}`]) }
    catch {
      const tracked = `refs/remotes/${remote}/${remoteBranch}`
      let exists = false
      try { await sourceGit(root, ['rev-parse', '--verify', `${tracked}^{commit}`]); exists = true } catch {}
      throw new Error(exists ? `本地分支 ${branch} 不存在；请选择“创建本地跟踪分支”，或执行 git branch --track ${branch} ${tracked}` : `本地分支 ${branch} 不存在，缓存中也没有 ${remote}/${remoteBranch}；请刷新分支后选择。`)
    }
  }
  if (input.personal_branch !== undefined || previous.personal_branch) {
    next.personal_branch = branch; next.remote = remote; next.remote_branch = remoteBranch
  }
  await writeTaskStoreFile(file, JSON.stringify(next, null, 2))
  return next
}
// Compare only the analysis snapshot; no whole-repository model review is needed.
export async function compareSnapshot(gitRoot, ref, snapshotRoot) {
  let stat; try { stat = await lstat(snapshotRoot) } catch (error) { if (error.code === 'ENOENT') return { available: false, changed_count: 0, files: [] }; throw error }
  if (!stat.isDirectory()) throw new Error('分析源码快照目录无效')
  const tree = await sourceGit(gitRoot, ['ls-tree', '-r', '-l', '-z', validateRef(ref)])
  const blobs = new Map(tree.split('\0').filter(Boolean).map(line => { const split = line.indexOf('\t'); return [line.slice(split + 1), line.slice(0, split).split(' ')[2]] }))
  const blobSizes = new Map(tree.split('\0').filter(Boolean).map(line => { const parts = line.slice(0, line.indexOf('\t')).trim().split(/\s+/); return [parts[2], Number(parts[3])] }))
  let compared = 0, changed = 0, eolOnly = 0, lfsEquivalent = 0; const files = [], eolFiles = []
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
          else {
          if (expected) {
            const size = blobSizes.get(expected)
            if (size >= 120 && size <= 1024) {
              const pointer = await sourceGit(gitRoot, ['cat-file', 'blob', expected])
              const match = /^version https:\/\/git-lfs.github.com\/spec\/v1\noid sha256:([a-f0-9]{64})\nsize (\d+)\n?$/.exec(pointer)
              if (match && BigInt(match[2]) === BigInt(bytes.length) && createHash('sha256').update(bytes).digest('hex') === match[1]) { lfsEquivalent++; continue }
            }
          }
            changed++; if (files.length < 30) files.push(relative)
          }
        }
      }
    }
  }
  await walk(snapshotRoot)
  return { available: true, compared_count: compared, changed_count: changed, files, eol_only_count: eolOnly, eol_only_files: eolFiles, lfs_equivalent_count: lfsEquivalent }
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
    await sourceGit(parent, ['clone', '--no-checkout', '--', url, target])
    await checkoutImportedBranch(target, input.personal_branch || ref)
    const commit = await sourceGit(target, ['rev-parse', '--verify', `${ref}^{commit}`]).catch(() => sourceGit(target, ['rev-parse', '--verify', `refs/remotes/origin/${ref}^{commit}`]))
    return await saveRepositorySettings(dataRoot, repoId, { ...input, git_path: target, base_ref: commit })
  } catch (error) { await rm(target, { recursive: true, force: true }); throw error }
}

// Network discovery is explicit. Cached remote-tracking refs are never labelled live.
export async function discoverRemoteBranches(cwd, url) {
  const output = await sourceGit(cwd, ['ls-remote', '--symref', '--', validateGitUrl(url), 'HEAD', 'refs/heads/*'])
  const branches = [], seen = new Set()
  let default_branch = ''
  for (const line of output.split('\n')) {
    const [oid, ref] = line.split('\t')
    if (ref === 'HEAD' && oid.startsWith('ref: refs/heads/')) default_branch = oid.slice(16)
    if (ref?.startsWith('refs/heads/') && !seen.has(ref)) { seen.add(ref); branches.push({ name: ref.slice(11), commit: oid }) }
  }
  return { branches, default_branch, refreshed_at: new Date().toISOString() }
}
export async function repositoryBranches(dataRoot, repoId, { git_path, remote = 'origin', refresh = false } = {}) {
  configPath(dataRoot, repoId)
  const settings = await readRepositorySettings(dataRoot, repoId)
  const root = git_path || settings.git_path || path.join(dataRoot, 'repositories', repoId)
  const info = await inspectSource(root)
  if (info.kind !== 'git') throw new Error(info.error || '请选择完整 Git 仓库')
  const remotes = []
  for (const name of (await sourceGit(root, ['remote'])).split('\n').filter(Boolean)) {
    const urls = (await sourceGit(root, ['remote', 'get-url', '--push', '--all', name])).split('\n').filter(Boolean)
    remotes.push({ name, url: urls[0]?.replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/g, '$1***@'), multiple: urls.length !== 1 })
  }
  const refs = (await sourceGit(root, ['for-each-ref', '--format=%(refname) %(objectname) %(upstream)', 'refs/heads', 'refs/remotes'])).split('\n').filter(Boolean)
  const local = refs.filter(line => line.startsWith('refs/heads/')).map(line => { const [ref, commit, upstream] = line.split(' '); return { name: ref.slice(11), commit, upstream } })
  let remote_branches = refs.filter(line => line.startsWith(`refs/remotes/${remote}/`) && !line.startsWith(`refs/remotes/${remote}/HEAD `)).map(line => { const [ref, commit] = line.split(' '); return { name: ref.slice(`refs/remotes/${remote}/`.length), commit } })
  if (refresh) {
    const selected = remotes.find(item => item.name === remote)
    if (!selected || selected.multiple) throw new Error('请选择具有唯一推送地址的远端')
    const pushUrl = await sourceGit(root, ['remote', 'get-url', '--push', remote])
    const output = await sourceGit(root, ['ls-remote', '--heads', '--', pushUrl])
    remote_branches = output.split('\n').filter(Boolean).map(line => { const [commit, ref] = line.split('\t'); return { name: ref.slice(11), commit } })
  }
  return { local, remotes, remote_branches, current_branch: info.branch, live: refresh }
}
export async function createTrackingBranch(dataRoot, repoId, input) {
  configPath(dataRoot, repoId)
  const settings = await readRepositorySettings(dataRoot, repoId)
  const root = input.git_path || settings.git_path || path.join(dataRoot, 'repositories', repoId)
  const branch = String(input.personal_branch || ''), remoteBranch = String(input.remote_branch || branch), remote = String(input.remote || 'origin')
  await sourceGit(root, ['check-ref-format', '--branch', branch])
  await sourceGit(root, ['check-ref-format', '--branch', remoteBranch])
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)) throw new Error('远端名称无效')
  const urls = (await sourceGit(root, ['remote', 'get-url', '--push', '--all', remote])).split('\n').filter(Boolean)
  if (urls.length !== 1) throw new Error('远端必须只有一个推送地址')
  const fetchUrl = await sourceGit(root, ['remote', 'get-url', remote])
  if (fetchUrl !== urls[0]) throw new Error('读取与推送地址不同，请先在本地建立正确的个人分支')
  await sourceGit(root, ['fetch', '--no-tags', remote, `refs/heads/${remoteBranch}:refs/remotes/${remote}/${remoteBranch}`])
  await sourceGit(root, ['branch', '--track', branch, `refs/remotes/${remote}/${remoteBranch}`])
  return repositoryBranches(dataRoot, repoId, input)
}
export async function checkoutImportedBranch(root, ref = 'HEAD') {
  let branch = validateRef(ref)
  if (branch === 'HEAD') {
    const head = await sourceGit(root, ['symbolic-ref', 'refs/remotes/origin/HEAD'])
    branch = head.replace(/^refs\/remotes\/origin\//, '')
  }
  let remoteExists = false
  try { await sourceGit(root, ['rev-parse', '--verify', `refs/remotes/origin/${branch}^{commit}`]); remoteExists = true } catch {}
  if (!remoteExists) {
    // Preserve explicit tag/commit imports for analysis; never mistake them for a local branch.
    const commit = await sourceGit(root, ['rev-parse', '--verify', `${branch}^{commit}`])
    await sourceGit(root, ['checkout', '--detach', commit])
    await verifyImportedCheckout(root)
    return ''
  }
  await sourceGit(root, ['check-ref-format', '--branch', branch])
  const local = await sourceGit(root, ['for-each-ref', '--format=%(refname)', `refs/heads/${branch}`])
  if (!local.split('\n').includes(`refs/heads/${branch}`)) await sourceGit(root, ['branch', '--track', branch, `refs/remotes/origin/${branch}`])
  await sourceGit(root, ['checkout', branch])
  await verifyImportedCheckout(root)
  return branch
}
export async function verifyImportedCheckout(root) {
  const diagnostic = { head_tree: null, index_tree: null, status_entries: [], status_entry_count: 0, status_entries_truncated: false }
  let primaryError, statusOutput
  try {
    diagnostic.head_tree = await sourceGit(root, ['rev-parse', 'HEAD^{tree}'])
    diagnostic.index_tree = await sourceGit(root, ['write-tree'])
  } catch (error) { primaryError = error }
  const indexMismatch = diagnostic.head_tree !== null && diagnostic.index_tree !== null && diagnostic.head_tree !== diagnostic.index_tree
  try {
    statusOutput = await sourceGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    const fields = statusOutput.split('\0')
    for (let i = 0; i < fields.length; i++) {
      if (!fields[i]) continue
      const entry = { status: fields[i].slice(0, 2), path: fields[i].slice(3) }
      // Porcelain -z emits destination first, then the original path as a
      // separate NUL field for rename/copy records. Do not split on newlines.
      if (/[RC]/.test(entry.status)) entry.original_path = fields[++i] ?? ''
      diagnostic.status_entry_count++
      if (diagnostic.status_entries.length < 100) diagnostic.status_entries.push(entry)
    }
    diagnostic.status_entries_truncated = diagnostic.status_entry_count > diagnostic.status_entries.length
  } catch (error) {
    // If a tree mismatch is already established, failure to collect additional
    // status evidence must not replace that failure with a secondary error.
    diagnostic.status_error = error.message
    if (!primaryError && !indexMismatch) primaryError = error
  }
  if (primaryError) {
    primaryError.checkoutDiagnostic = diagnostic
    throw primaryError
  }
  if (!indexMismatch && !statusOutput) return
  const reasons = []
  if (indexMismatch) reasons.push('索引与 HEAD 不一致')
  if (diagnostic.status_entry_count) {
    const describe = entry => {
      const kind = entry.status === '??' ? '未跟踪' : entry.status.includes('U') ? '冲突'
        : entry.status.includes('D') ? '缺失/删除' : entry.status.includes('R') ? '重命名'
          : entry.status.includes('C') ? '复制' : entry.status.includes('A') ? '新增'
            : entry.status.includes('T') ? '类型变化' : '修改'
      return `${kind} [${entry.status}] ${JSON.stringify(entry.path)}${entry.original_path !== undefined ? `（原路径 ${JSON.stringify(entry.original_path)}）` : ''}`
    }
    reasons.push(`工作区/索引有 ${diagnostic.status_entry_count} 项差异：${diagnostic.status_entries.slice(0, 6).map(describe).join('；')}${diagnostic.status_entry_count > 6 ? '；其余见诊断记录' : ''}`)
  }
  if (diagnostic.status_error) reasons.push('工作区差异读取失败，详见诊断记录')
  throw Object.assign(new Error(`克隆后的索引或工作区不完整：${reasons.join('；')}。仓库尚未发布。`), {
    code: 'GIT_CHECKOUT_INCOMPLETE', checkoutDiagnostic: diagnostic,
  })
}

export async function pullRepositoryLfs(dataRoot, repoId, input) {
  configPath(dataRoot, repoId)
  const settings = await readRepositorySettings(dataRoot, repoId)
  const root = settings.git_path || path.join(dataRoot, 'repositories', repoId)
  const include = String(input.include || '').trim()
  if (!include || include.startsWith('/') || /[\\:\x00-\x1f]/.test(include) || include.split('/').some(part => part === '..' || part === '.git')) throw new Error('请填写仓库内的 LFS 文件或目录范围，例如 assets/*')
  await sourceGit(root, ['lfs', 'version'])
  await sourceGit(root, ['lfs', 'pull', `--include=${include}`, '--exclude='])
  return { include }
}
