import { repositoryOperationSignal, repositoryOperation } from './operations.js'
import { inspectSource, checkoutImportedBranch, sourceGit, validateGitUrl, validateRef, validatePipeline, readRepositorySettings, saveRepositorySettings } from './git-source.js'
import { createHash, randomUUID } from 'node:crypto'
import { writeTaskStoreFile } from '../task-store.js'
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const MARKER_NAME = 'desktop-initialized.json'
const MEANINGFUL_DIRECTORIES = ['repositories', 'inbox', 'coverage', 'assets', 'runs', 'methodologies', '.pangea']
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function directoryHasEntries(directory) {
  try {
    return (await readdir(directory)).length > 0
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function hasMeaningfulData(dataRoot) {
  for (const name of MEANINGFUL_DIRECTORIES) {
    if (name === 'repositories' || name === '.pangea') {
      let entries
      try { entries = await readdir(path.join(dataRoot, name)) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
      if (entries.some(entry => name === 'repositories' ? !entry.startsWith('.pangea-import-') : !['repository-imports', 'repository-locks'].includes(entry))) return true
      continue
    }
    if (await directoryHasEntries(path.join(dataRoot, name))) return true
  }
  return false
}

async function readMarker(markerPath) {
  try {
    const value = JSON.parse(await readFile(markerPath, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return undefined
    throw error
  }
}

async function replaceFile(temporaryPath, targetPath) {
  try {
    await rename(temporaryPath, targetPath)
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error
    await rm(targetPath, { force: true })
    await rename(temporaryPath, targetPath)
  }
}

async function writeMarker(dataRoot, repositoryId) {
  const markerDirectory = path.join(dataRoot, '.pangea')
  const markerPath = path.join(markerDirectory, MARKER_NAME)
  await mkdir(markerDirectory, { recursive: true })
  const previous = await readMarker(markerPath)
  const now = new Date().toISOString()
  const temporaryPath = path.join(markerDirectory, `.${MARKER_NAME}.${randomUUID()}.tmp`)
  await writeFile(temporaryPath, `${JSON.stringify({
    schema_version: 1,
    ...previous,
    initialized_at: typeof previous?.initialized_at === 'string' ? previous.initialized_at : now,
    adopted_existing_data: previous?.adopted_existing_data === true,
    desktop_version: process.env.PANGEA_DESKTOP_VERSION ?? previous?.desktop_version ?? null,
    last_repository_import_at: now,
    last_repository_id: repositoryId,
  }, null, 2)}\n`, 'utf8')
  await replaceFile(temporaryPath, markerPath)
}

function normalizeRepositoryId(value) {
  if (typeof value !== 'string') throw new Error('repository name is required')
  const name = value.trim()
  if (!name) throw new Error('repository name is required')
  if (name === '.' || name === '..' || /[\\/]/.test(name)) throw new Error('repository name cannot contain a path separator')
  if (/[\u0000-\u001f<>:"|?*]/.test(name)) throw new Error('repository name contains characters unsupported by Windows')
  if (/[. ]$/.test(name) || WINDOWS_RESERVED_NAME.test(name)) throw new Error('repository name is not supported by Windows')
  return name
}

async function repositoryItems(repositoriesRoot) {
  await mkdir(repositoriesRoot, { recursive: true })
  const entries = await readdir(repositoriesRoot, { withFileTypes: true })
  return entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.pangea-import-'))
    .map(entry => ({ repository_id: entry.name, name: entry.name }))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
}

// The key binds a retained clone to this exact import request. Do not persist
// credential-bearing URLs, and never reuse a directory selected by a journal.
function remoteImportPaths(dataRoot, repositoriesRoot, name, url, ref) {
  const key = createHash('sha256').update(JSON.stringify([name, url, ref])).digest('hex')
  return {
    key,
    staging: path.join(repositoriesRoot, `.pangea-import-${key}`),
    journal: path.join(dataRoot, '.pangea', 'repository-imports', `${key}.json`),
  }
}

async function reusableClone(attempt) {
  let stat
  try { stat = await lstat(attempt.staging) } catch (error) { if (error.code === 'ENOENT') return false; throw error }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`导入暂存路径不是普通目录：${attempt.staging}`)
  let previous
  try { previous = JSON.parse(await readFile(attempt.journal, 'utf8')) } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
  if (previous?.import_key !== attempt.key || previous.clone_complete !== true) {
    throw new Error(`上次导入暂存目录尚未确认克隆完成，已保留：${attempt.staging}；诊断记录：${attempt.journal}`)
  }
  const git = await lstat(path.join(attempt.staging, '.git'))
  if (!git.isDirectory() || git.isSymbolicLink()) throw new Error(`导入暂存目录缺少独立 Git 数据：${attempt.staging}`)
  return true
}

const REPOSITORY_STATUS_CACHE = new Map()
const REPOSITORY_STATUS_TTL_MS = 15_000

export function invalidateRepositoryStatusCache(dataRoot) {
  if (!dataRoot) { REPOSITORY_STATUS_CACHE.clear(); return }
  REPOSITORY_STATUS_CACHE.delete(path.resolve(dataRoot))
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index], index)
    }
  }))
  return results
}

export async function repositoryStatus(dataRoot, { forceRefresh = false } = {}) {
  await recoverRepositoryImports(dataRoot)
  const resolvedRoot = path.resolve(dataRoot)
  const repositoriesRoot = path.join(resolvedRoot, 'repositories')
  const repositories = await repositoryItems(repositoriesRoot)
  const fingerprint = repositories.map(repo => repo.repository_id).join('\0')
  const cached = !forceRefresh ? REPOSITORY_STATUS_CACHE.get(resolvedRoot) : null
  if (cached && cached.fingerprint === fingerprint && Date.now() - cached.at < REPOSITORY_STATUS_TTL_MS) {
    return structuredClone(cached.value)
  }
  await mapWithConcurrency(repositories, 6, async repo => {
    const [source, settings] = await Promise.all([
      inspectSource(path.join(repositoriesRoot, repo.repository_id)),
      readRepositorySettings(resolvedRoot, repo.repository_id),
    ])
    repo.source = source
    repo.settings = settings
  })
  const marker = await readMarker(path.join(resolvedRoot, '.pangea', MARKER_NAME))
  const existingData = repositories.length > 0 || await hasMeaningfulData(resolvedRoot)
  const value = {
    status: 'ok',
    initialized: Boolean(marker) || existingData,
    onboarding_required: !marker && !existingData,
    repositories,
  }
  REPOSITORY_STATUS_CACHE.set(resolvedRoot, { at: Date.now(), fingerprint, value })
  return structuredClone(value)
}

export async function importRepository({ dataRoot, sourcePath, repositoryId, gitUrl, baseRef, pipelineUrl }) {
  if (!gitUrl && (typeof sourcePath !== 'string' || !sourcePath.trim())) throw new Error('source folder is required')
  const name = normalizeRepositoryId(repositoryId)
  const pipeline = validatePipeline(pipelineUrl)
  const remoteUrl = gitUrl ? validateGitUrl(gitUrl) : null
  const ref = validateRef(baseRef)
  await mkdir(dataRoot, { recursive: true })
  const repositoriesRoot = path.join(dataRoot, 'repositories')
  await mkdir(repositoriesRoot, { recursive: true })

  const source = remoteUrl ? null : await realpath(sourcePath.trim())
  if (source && !(await lstat(source)).isDirectory()) throw new Error('source path must be a folder')
  const resolvedRepositoriesRoot = await realpath(repositoriesRoot)
  if (source && (isInside(resolvedRepositoriesRoot, source) || isInside(source, resolvedRepositoriesRoot))) {
    throw new Error('choose a source folder outside the PANGEA data directory')
  }

  const destination = path.join(resolvedRepositoriesRoot, name)
  try {
    await lstat(destination)
    throw new Error(`repository already exists: ${name}`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const attempt = remoteUrl ? remoteImportPaths(dataRoot, resolvedRepositoriesRoot, name, remoteUrl, ref) : null
  const temporaryDestination = attempt?.staging || path.join(resolvedRepositoriesRoot, `.pangea-import-${randomUUID()}`)
  let cloneComplete = false, phase = remoteUrl ? 'clone' : 'copy'
  const startedAt = new Date().toISOString()
  const recordAttempt = async extra => {
    if (!attempt) return
    await writeTaskStoreFile(attempt.journal, JSON.stringify({
      schema_version: 1, import_key: attempt.key, repository_id: name,
      started_at: startedAt, updated_at: new Date().toISOString(), phase,
      clone_complete: cloneComplete, lfs_skip_smudge: '1', ...extra,
    }, null, 2), { errorLabel: '导入诊断保存失败' })
  }
  // Resolve ownership before entering cleanup: an unrecognised retained path
  // must never be deleted, even if its journal is missing or damaged.
  if (attempt) cloneComplete = await reusableClone(attempt)
  let destinationCreated = false
  try {
    if (remoteUrl) {
      if (!cloneComplete) {
        await recordAttempt({ status: 'running' })
        await sourceGit(resolvedRepositoriesRoot, ['clone', '--no-checkout', '--', remoteUrl, temporaryDestination])
        cloneComplete = true
      }
      phase = 'checkout-and-verify'
      await recordAttempt({ status: 'running' })
      await checkoutImportedBranch(temporaryDestination, ref)
    } else {
      // A linked worktree's .git file points outside the directory. Materialize its history first.
      let worktree = false
      try { worktree = (await lstat(path.join(source, '.git'))).isFile() } catch {}
      if (worktree) {
        const info = await inspectSource(source)
        if (info.kind !== 'git') throw new Error(info.error || '无法读取 Git 工作树')
        await sourceGit(resolvedRepositoriesRoot, ['clone', '--no-hardlinks', '--', source, temporaryDestination])
        await sourceGit(temporaryDestination, ['checkout', '--detach', info.commit])
        if (info.remote) await sourceGit(temporaryDestination, ['remote', 'set-url', 'origin', await sourceGit(source, ['remote', 'get-url', '--push', 'origin'])])
        else await sourceGit(temporaryDestination, ['remote', 'remove', 'origin'])
        for (const entry of await readdir(temporaryDestination)) if (entry !== '.git') await rm(path.join(temporaryDestination, entry), { recursive: true, force: true })
      }
      await cp(source, temporaryDestination, {
        recursive: true,
        force: worktree,
        errorOnExist: !worktree,
        filter: file => { repositoryOperationSignal()?.throwIfAborted(); return !worktree || file !== path.join(source, '.git') },
        preserveTimestamps: true,
        verbatimSymlinks: true,
      })
    }
    repositoryOperationSignal()?.throwIfAborted()
    phase = 'publish'
    await rename(temporaryDestination, destination)
    destinationCreated = true
    await saveRepositorySettings(dataRoot, name, { pipeline_url: pipeline })
    await writeMarker(dataRoot, name)
  } catch (error) {
    // Keep a completed download even when checkout/validation/publication fails.
    // Retry uses normal checkout, never reset/restore/clean over retained edits.
    if (attempt && cloneComplete) {
      let retainedPath = temporaryDestination
      if (destinationCreated) {
        try { await rename(destination, temporaryDestination) }
        catch { retainedPath = destination }
      }
      error.message += `；已保留下载的仓库：${retainedPath}。${retainedPath === temporaryDestination ? '使用相同地址、分支和仓库名称重试将复用下载内容。' : '目录回移失败，请先检查该目录；再次导入不会覆盖它。'}`
    } else {
      await rm(temporaryDestination, { recursive: true, force: true }).catch(() => {})
      if (destinationCreated) await rm(destination, { recursive: true, force: true }).catch(() => {})
    }
    if (attempt) {
      try {
        await recordAttempt({ status: 'failed', error: error.message, checkout: error.checkoutDiagnostic, git: error.gitDiagnostic })
        error.message += ` 诊断记录：${attempt.journal}`
      } catch (diagnosticError) { error.message += `；诊断记录未能保存：${diagnosticError.message}` }
    }
    throw error
  }

  // Diagnostics are ancillary after publication; a log write cannot turn a
  // successfully imported repository into a failed import.
  if (attempt) await recordAttempt({ status: 'completed', clone_complete: false }).catch(() => {})
  invalidateRepositoryStatusCache(dataRoot)

  return { repository_id: name, name, source: await inspectSource(destination) }
}

export { normalizeRepositoryId }

// Repair import is a staged replacement. Old Git history and settings are retained.
// The caller owns the repository operation lock and excludes active analysis.
export async function reimportRepository({ dataRoot, repositoryId, baseRef }) {
  const name = normalizeRepositoryId(repositoryId)
  const root = path.join(dataRoot, 'repositories', name)
  const info = await inspectSource(root)
  if (info.kind !== 'git') throw new Error('修复性重导需要完整 Git 仓库及来源地址；普通目录请重新添加')
  if (info.dirty) throw new Error('仓库存在未提交或未跟踪内容，请先保存到其他位置；本次未替换源码')
  const url = await sourceGit(root, ['remote', 'get-url', 'origin'])
  const ref = validateRef(baseRef || info.branch || info.commit)
  const token = randomUUID(), staging = path.join(dataRoot, 'repositories', `.pangea-import-${token}`)
  const backup = path.join(dataRoot, '.pangea', 'repository-backups', name, token)
  const journal = path.join(dataRoot, '.pangea', 'repository-recovery', `${name}.json`)
  const settings = await readRepositorySettings(dataRoot, name)
  let moved = false, published = false
  try {
    await sourceGit(dataRoot, ['clone', '--no-checkout', '--', url, staging])
    await checkoutImportedBranch(staging, ref)
    // Compare against the freshly cloned remote, not stale/missing tracking refs.
    await sourceGit(staging, ['fetch', '--no-tags', '--', root, 'refs/heads/*:refs/pangea-reimport/*'])
    if (await sourceGit(staging, ['rev-list', '--glob=refs/pangea-reimport/*', '--not', '--remotes'])) throw new Error('仓库存在本地独有提交，请先推送或备份后重导')
    for (const oldRef of (await sourceGit(staging, ['for-each-ref', '--format=%(refname)', 'refs/pangea-reimport'])).split('\n').filter(Boolean)) await sourceGit(staging, ['update-ref', '-d', oldRef])
    await sourceGit(staging, ['remote', 'set-url', '--push', 'origin', await sourceGit(root, ['remote', 'get-url', '--push', 'origin'])])
    if (!settings.git_path && settings.personal_branch) {
      const local = settings.personal_branch, remote = settings.remote || 'origin', branch = settings.remote_branch || local
      await sourceGit(staging, ['check-ref-format', '--branch', local])
      if (remote !== 'origin') {
        const fetchUrl = await sourceGit(root, ['remote', 'get-url', remote])
        const pushUrl = await sourceGit(root, ['remote', 'get-url', '--push', remote])
        await sourceGit(staging, ['remote', 'add', remote, fetchUrl])
        await sourceGit(staging, ['remote', 'set-url', '--push', remote, pushUrl])
        await sourceGit(staging, ['fetch', '--no-tags', remote])
      }
      const refs = await sourceGit(staging, ['for-each-ref', '--format=%(refname)', `refs/heads/${local}`])
      if (!refs.split('\n').includes(`refs/heads/${local}`)) await sourceGit(staging, ['branch', '--track', local, `refs/remotes/${remote}/${branch}`])
    }
    // Preserve local author identity, never copy hooks or credential secrets.
    for (const setting of ['user.name', 'user.email']) {
      let value
      try { value = await sourceGit(root, ['config', '--local', '--get', setting]) } catch {}
      if (value) await sourceGit(staging, ['config', setting, value])
    }
    repositoryOperationSignal()?.throwIfAborted()
    await mkdir(path.dirname(backup), { recursive: true }); await mkdir(path.dirname(journal), { recursive: true })
    await writeFile(journal, JSON.stringify({ root, backup, staging, repository_id: name }))
    await rename(root, backup); moved = true
    await rename(staging, root); published = true
    await writeMarker(dataRoot, name)
    await rm(journal, { force: true })
    invalidateRepositoryStatusCache(dataRoot)
    return { repository_id: name, source: await inspectSource(root), backup_path: backup, settings }
  } catch (error) {
    if (moved) {
      try { if (published) await rename(root, staging); await rename(backup, root); await rm(journal, { force: true }) }
      catch { throw new Error(`重导未完成，旧仓库保留在 ${backup}；恢复记录：${journal}；原错误：${error.message}`) }
    }
    throw error
  } finally { await rm(staging, { recursive: true, force: true }).catch(() => {}) }
}

export async function recoverRepositoryImports(dataRoot) {
  const directory = path.join(dataRoot, '.pangea', 'repository-recovery')
  let files
  try { files = await readdir(directory) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  for (const file of files.filter(name => name.endsWith('.json'))) {
    const repoId = normalizeRepositoryId(file.slice(0, -5))
    try {
      await repositoryOperation(dataRoot, repoId, async () => {
        const journal = path.join(directory, file)
        let record
        try { record = JSON.parse(await readFile(journal, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return; throw error }
        const root = path.resolve(dataRoot, 'repositories', repoId)
        const backups = path.resolve(dataRoot, '.pangea', 'repository-backups', repoId)
        if (path.resolve(record.root) !== root || !isInside(backups, path.resolve(record.backup)) || path.resolve(record.backup) === backups) throw new Error('仓库恢复记录路径无效')
        let exists = false
        try { exists = (await lstat(root)).isDirectory() } catch (error) { if (error.code !== 'ENOENT') throw error }
        if (!exists) await rename(record.backup, root)
        // If new root was published, its complete clone was verified before the swap.
        // Preserve backup and settings in both outcomes; never delete user data here.
        await rm(journal, { force: true })
      })
    } catch (error) { if (error.statusCode !== 409) throw error }
  }
}
