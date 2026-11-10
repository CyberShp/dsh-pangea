import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

function hasText(value) {
  return typeof value === 'string' && value.trim() !== ''
}

export function parseEvidenceLocation(location) {
  if (!hasText(location)) throw new TypeError('location must be a non-empty string')
  const value = location.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) throw new Error('remote evidence locations cannot be previewed')

  const hash = /^(.*)#L(\d+)(?:-L?(\d+))?$/i.exec(value)
  const colon = hash === null ? /^(.*):(\d+)(?:-(\d+))?$/.exec(value) : null
  const match = hash ?? colon
  const source = (match?.[1] ?? value).trim()
  if (source === '') throw new Error('evidence location does not contain a file path')

  const startLine = match === null ? null : Number(match[2])
  const rawEnd = match?.[3]
  const endLine = match === null ? null : rawEnd === undefined ? startLine : Number(rawEnd)
  if (startLine !== null && (!Number.isSafeInteger(startLine) || startLine < 1 || !Number.isSafeInteger(endLine) || endLine < startLine)) {
    throw new Error('evidence line range is invalid')
  }
  return { source, startLine, endLine }
}

export function resolveEvidenceFile({ cwd, dataRoot, location, snapshotRoot, repositoryId, snapshotLayout }) {
  const parsed = parseEvidenceLocation(location)
  if (snapshotLayout === 'source-first' && (!hasText(repositoryId) || parsed.startLine === null || !/^([^:/\\]+):(.+)$/.test(parsed.source))) {
    throw new Error('source-first 原文位置必须使用当前 Run 的 repo_id:path:line')
  }
  if (path.isAbsolute(parsed.source)) {
    if (hasText(snapshotRoot)) throw new Error('frozen Run evidence must use repo_id:path:line locations')
    return { ...parsed, filePath: path.resolve(parsed.source) }
  }

  const repositoryLocation = /^([^:/\\]+):(.+)$/.exec(parsed.source)
  if (repositoryLocation !== null && hasText(snapshotRoot) && (!repositoryId || repositoryLocation[1] === repositoryId)) {
    const snapshotRepository = path.resolve(snapshotRoot, snapshotLayout === 'source-first' ? repositoryId : 'repository')
    if (!snapshotRepository.startsWith(`${path.resolve(snapshotRoot)}${path.sep}`)) throw new Error('repository escapes the frozen source snapshot')
    const filePath = path.resolve(snapshotRepository, repositoryLocation[2])
    if (filePath !== snapshotRepository && !filePath.startsWith(`${snapshotRepository}${path.sep}`)) {
      throw new Error('evidence path escapes the frozen source snapshot')
    }
    return { ...parsed, filePath }
  }
  if (repositoryLocation !== null && hasText(snapshotRoot)) {
    throw new Error('evidence repository does not match the frozen Run source')
  }
  if (repositoryLocation !== null && hasText(dataRoot)) {
    return {
      ...parsed,
      filePath: path.resolve(dataRoot, 'repositories', repositoryLocation[1], repositoryLocation[2]),
    }
  }
  if (!hasText(cwd)) throw new Error('workspace cwd is required for a relative evidence path')
  return { ...parsed, filePath: path.resolve(cwd, parsed.source) }
}

export async function readEvidenceSnippet({ cwd, dataRoot, location, snapshotRoot, repositoryId, snapshotLayout, contextLines = 3, contextBefore = contextLines, contextAfter = contextLines, maxLines = 160 }) {
  const resolved = resolveEvidenceFile({ cwd, dataRoot, location, snapshotRoot, repositoryId, snapshotLayout })
  let readPath = resolved.filePath
  if (hasText(snapshotRoot)) {
    const [root, file] = await Promise.all([realpath(snapshotRoot), realpath(resolved.filePath)])
    const relative = path.relative(root, file)
    if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) throw new Error('evidence path escapes the frozen source snapshot')
    readPath = file
  }
  const raw = await readFile(readPath, 'utf8')
  if (raw.includes('\u0000')) throw new Error('evidence file is not readable text')

  const allLines = raw.split(/\r?\n/)
  const targetStart = resolved.startLine ?? 1
  const targetEnd = Math.min(resolved.endLine ?? Math.min(allLines.length, 32), allLines.length)
  if (targetStart > allLines.length) throw new Error(`evidence line ${targetStart} exceeds file length ${allLines.length}`)

  const windowStart = Math.max(1, targetStart - contextBefore)
  const requestedEnd = Math.min(allLines.length, targetEnd + contextAfter)
  const windowEnd = Math.min(requestedEnd, windowStart + maxLines - 1)
  const lines = allLines.slice(windowStart - 1, windowEnd).map((text, index) => ({
    number: windowStart + index,
    text,
    target: windowStart + index >= targetStart && windowStart + index <= targetEnd,
  }))

  return {
    status: 'ok',
    file_path: resolved.filePath,
    location,
    target_start: targetStart,
    target_end: targetEnd,
    visible_start: windowStart,
    visible_end: windowEnd,
    truncated: windowEnd < requestedEnd,
    lines,
  }
}

// Only files explicitly saved by source tools are listed. Never enumerate the
// live repository or widen an old Run's original manifest when presenting it.
export async function readSupplementalSourceManifest(runDirectory) {
  const filename = path.join(runDirectory, 'inputs', 'source-supplemental.json')
  let raw
  try { raw = await readFile(filename, 'utf8') } catch (error) { if (error.code === 'ENOENT') return { files: [] }; throw error }
  const value = JSON.parse(raw)
  if (value.format_version !== 'pangea-source-supplemental-v1' || !Array.isArray(value.files)) throw new Error('补充源码清单格式无效')
  const seen = new Set()
  const files = value.files.map(item => {
    if (!item || typeof item.repo_id !== 'string' || !/^[^:/\\]+$/.test(item.repo_id) || ['.', '..'].includes(item.repo_id)
      || typeof item.path !== 'string' || !item.path || /^(?:[\\/]|[A-Za-z]:)/.test(item.path)
      || item.path.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) throw new Error('补充源码清单包含越界路径')
    const key = JSON.stringify([item.repo_id, item.path])
    if (seen.has(key)) throw new Error('补充源码清单包含重复文件')
    seen.add(key)
    return { repo_id: item.repo_id, path: item.path, captured_at: item.captured_at, sha256: item.sha256, bytes: item.bytes, action_id: item.action_id }
  })
  return { format_version: value.format_version, files }
}

export async function readSavedSupplementalSources(runDirectory) {
  const manifest = await readSupplementalSourceManifest(runDirectory)
  if (!manifest.files.length) return []
  const runRoot = await realpath(runDirectory)
  const root = await realpath(path.join(runDirectory, 'inputs', 'source'))
  const sourceRelative = path.relative(runRoot, root)
  if (path.isAbsolute(sourceRelative) || sourceRelative === '..' || sourceRelative.startsWith(`..${path.sep}`)) throw new Error('补充源码路径越出 Run 快照')
  const result = []
  for (const item of manifest.files) {
    const repository = path.join(root, item.repo_id)
    const file = await realpath(path.join(repository, item.path))
    const relative = path.relative(repository, file)
    if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) throw new Error('补充源码路径越出仓库快照')
    const bytes = await readFile(file)
    if (item.bytes !== bytes.length || item.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw new Error(`补充源码校验失败：${item.repo_id}:${item.path}`)
    result.push({ ...item, content: bytes.toString('utf8') })
  }
  return result
}
