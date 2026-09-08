import { appendFile, mkdir, open } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

const MAX_READ_RECORDS = 200
const MAX_READ_BYTES = 256 * 1024
const MAX_EVENT_TEXT = 8192

export function diagnosticText(value, limit = MAX_EVENT_TEXT) {
  return String(value ?? '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/https?:\/\/[^\s<>"']+/gi, '[url]')
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, '[authorization]')
    .replace(/\b[\w-]*(?:key|password|secret|token)[\w-]*["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '[credential]')
    .slice(0, limit)
}

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

function utc8IsoString(value = Date.now()) {
  const shifted = new Date(value + 8 * 60 * 60 * 1000)
  return `${shifted.toISOString().slice(0, -1)}+08:00`
}

function compactEvent(value = {}) {
  const event = {
    schema_version: 1,
    at: utc8IsoString(),
    stage: typeof value.stage === 'string' ? value.stage : 'unknown',
    status: ['start', 'ok', 'error', 'info'].includes(value.status) ? value.status : 'info',
  }
  for (const key of [
    'message', 'session_id', 'agent_session_id', 'run_id', 'attempt_id', 'job_id', 'provider', 'model',
    'reasoning_effort', 'requested_model', 'error_code', 'exit_status', 'detail', 'output', 'configured_command',
    'resolved_command', 'launcher_kind', 'launcher_command', 'cwd', 'launch_stage', 'syscall',
    'remote_session_id', 'stop_reason', 'protocol_stop_reason', 'phase', 'error_summary', 'stderr_summary',
    'state_path', 'agent_version', 'last_tool_id', 'last_tool_status', 'exit_signal',
  ]) {
    if (typeof value[key] === 'string' && value[key].trim() !== '') event[key] = diagnosticText(value[key].trim())
  }
  for (const key of [
    'turn', 'completed', 'message_chunks', 'tool_calls', 'tool_failures', 'turn_duration_ms',
    'first_event_ms', 'stderr_bytes', 'duration_ms', 'file_count', 'total_bytes', 'snapshot_duration_ms',
  ]) {
    if (Number.isInteger(value[key]) && value[key] >= 0) event[key] = value[key]
  }
  for (const key of ['process_exited', 'stderr_truncated', 'output_truncated']) {
    if (typeof value[key] === 'boolean') event[key] = value[key]
  }
  if (Number.isInteger(value.repository_count) && value.repository_count >= 0) event.repository_count = value.repository_count
  if (Number.isInteger(value.pid) && value.pid > 0) event.pid = value.pid
  if (Number.isInteger(value.errno)) event.errno = value.errno
  if (Number.isInteger(value.exit_code)) event.exit_code = value.exit_code
  const error = errorMessage(value.error)
  if (error) event.error = diagnosticText(error)
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
    let handle
    try {
      handle = await open(file, 'r')
      const { size } = await handle.stat()
      const start = Math.max(0, size - MAX_READ_BYTES)
      const buffer = Buffer.alloc(Math.min(size, MAX_READ_BYTES))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
      let tail = buffer.subarray(0, bytesRead).toString('utf8')
      // The first record may begin before the retained byte window.
      if (start > 0) tail = tail.includes('\n') ? tail.slice(tail.indexOf('\n') + 1) : ''
      const records = tail
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => {
          try { return JSON.parse(line) } catch { return null }
        })
        .filter(Boolean)
      return { path: file, events: records.slice(-bounded), bytes_read: bytesRead, truncated: start > 0 || records.length > bounded }
    } catch (error) {
      if (error?.code === 'ENOENT') return { path: file, events: [] }
      throw error
    } finally { await handle?.close() }
  }
}

export function createLaunchLogStore(options) {
  return new LaunchLogStore(options)
}
