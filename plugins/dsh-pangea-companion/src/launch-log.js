import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

const MAX_READ_RECORDS = 200

function logRoot() {
  const configured = process.env.DSH_HOME
  const root = typeof configured === 'string' && configured.trim() !== ''
    ? path.resolve(configured)
    : path.join(homedir(), '.dsh')
  return path.join(root, 'dsh-pangea-companion', 'launch-logs')
}

function safeTaskId(value) {
  const taskId = typeof value === 'string' ? value.trim() : ''
  if (!taskId || !/^[A-Za-z0-9._-]+$/.test(taskId)) throw new Error(`invalid task_id for launch log: ${value}`)
  return taskId
}

function errorMessage(value) {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  if (typeof value?.message === 'string') return value.message
  return value == null ? null : String(value)
}

function compactEvent(value = {}) {
  const event = {
    schema_version: 1,
    at: new Date().toISOString(),
    stage: typeof value.stage === 'string' ? value.stage : 'unknown',
    status: ['start', 'ok', 'error', 'info'].includes(value.status) ? value.status : 'info',
  }
  for (const key of ['message', 'session_id', 'run_id', 'provider', 'model', 'error_code']) {
    if (typeof value[key] === 'string' && value[key].trim() !== '') event[key] = value[key].trim()
  }
  if (Number.isInteger(value.repository_count) && value.repository_count >= 0) event.repository_count = value.repository_count
  const error = errorMessage(value.error)
  if (error) event.error = error
  return event
}

export class LaunchLogStore {
  constructor({ root = logRoot() } = {}) {
    this.root = path.resolve(root)
  }

  filePath(taskId) {
    return path.join(this.root, `${safeTaskId(taskId)}.jsonl`)
  }

  async append(taskId, event) {
    const file = this.filePath(taskId)
    await mkdir(path.dirname(file), { recursive: true })
    await appendFile(file, `${JSON.stringify({ task_id: safeTaskId(taskId), ...compactEvent(event) })}\n`, 'utf8')
    return file
  }

  async read(taskId, { limit = 80 } = {}) {
    const file = this.filePath(taskId)
    const bounded = Math.max(1, Math.min(MAX_READ_RECORDS, Number.isInteger(limit) ? limit : 80))
    try {
      const records = (await readFile(file, 'utf8'))
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => {
          try { return JSON.parse(line) } catch { return null }
        })
        .filter(Boolean)
      return { path: file, events: records.slice(-bounded) }
    } catch (error) {
      if (error?.code === 'ENOENT') return { path: file, events: [] }
      throw error
    }
  }
}

export function createLaunchLogStore(options) {
  return new LaunchLogStore(options)
}
