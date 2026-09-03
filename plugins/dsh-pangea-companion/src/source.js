import { readFile } from 'node:fs/promises'
import path from 'node:path'

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

export function resolveEvidenceFile({ cwd, dataRoot, location, snapshotRoot, repositoryId }) {
  const parsed = parseEvidenceLocation(location)
  if (path.isAbsolute(parsed.source)) {
    if (hasText(snapshotRoot)) throw new Error('frozen Run evidence must use repo_id:path:line locations')
    return { ...parsed, filePath: path.resolve(parsed.source) }
  }

  const repositoryLocation = /^([^:/\\]+):(.+)$/.exec(parsed.source)
  if (repositoryLocation !== null && hasText(snapshotRoot) && (!repositoryId || repositoryLocation[1] === repositoryId)) {
    const snapshotRepository = path.resolve(snapshotRoot, 'repository')
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

export async function readEvidenceSnippet({ cwd, dataRoot, location, snapshotRoot, repositoryId, contextLines = 3, maxLines = 160 }) {
  const resolved = resolveEvidenceFile({ cwd, dataRoot, location, snapshotRoot, repositoryId })
  const raw = await readFile(resolved.filePath, 'utf8')
  if (raw.includes('\u0000')) throw new Error('evidence file is not readable text')

  const allLines = raw.split(/\r?\n/)
  const targetStart = resolved.startLine ?? 1
  const targetEnd = Math.min(resolved.endLine ?? Math.min(allLines.length, 32), allLines.length)
  if (targetStart > allLines.length) throw new Error(`evidence line ${targetStart} exceeds file length ${allLines.length}`)

  const windowStart = Math.max(1, targetStart - contextLines)
  const requestedEnd = Math.min(allLines.length, targetEnd + contextLines)
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
