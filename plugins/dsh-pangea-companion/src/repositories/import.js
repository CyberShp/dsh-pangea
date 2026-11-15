import { inspectSource, sourceGit, validateGitUrl, validateRef, validatePipeline, readRepositorySettings, saveRepositorySettings } from './git-source.js'
import { randomUUID } from 'node:crypto'
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

export async function repositoryStatus(dataRoot) {
  const repositoriesRoot = path.join(dataRoot, 'repositories')
  const repositories = await repositoryItems(repositoriesRoot)
  for (const repo of repositories) {
    repo.source = await inspectSource(path.join(repositoriesRoot, repo.repository_id))
    repo.settings = await readRepositorySettings(dataRoot, repo.repository_id)
  }
  const marker = await readMarker(path.join(dataRoot, '.pangea', MARKER_NAME))
  const existingData = repositories.length > 0 || await hasMeaningfulData(dataRoot)
  return {
    status: 'ok',
    initialized: Boolean(marker) || existingData,
    onboarding_required: !marker && !existingData,
    repositories,
  }
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

  const temporaryDestination = path.join(resolvedRepositoriesRoot, `.pangea-import-${randomUUID()}`)
  let destinationCreated = false
  try {
    if (remoteUrl) {
      await sourceGit(resolvedRepositoriesRoot, ['clone', '--', remoteUrl, temporaryDestination])
      const commit = await sourceGit(temporaryDestination, ['rev-parse', '--verify', `${ref}^{commit}`]).catch(async error => {
        if (ref === 'HEAD') throw error
        return sourceGit(temporaryDestination, ['rev-parse', '--verify', `refs/remotes/origin/${ref}^{commit}`])
      })
      await sourceGit(temporaryDestination, ['checkout', '--detach', commit])
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
        filter: file => !worktree || file !== path.join(source, '.git'),
        preserveTimestamps: true,
        verbatimSymlinks: true,
      })
    }
    await rename(temporaryDestination, destination)
    destinationCreated = true
    await saveRepositorySettings(dataRoot, name, { pipeline_url: pipeline })
    await writeMarker(dataRoot, name)
  } catch (error) {
    await rm(temporaryDestination, { recursive: true, force: true })
    if (destinationCreated) await rm(destination, { recursive: true, force: true })
    throw error
  }

  return { repository_id: name, name, source: await inspectSource(destination) }
}

export { normalizeRepositoryId }
