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

// Metadata only: tool input/output and command text never belong in this
// compact launch diagnostic. Full accepted events stay in the session log.
export function compactToolLifecycle(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const compact = (source, strings, numbers, booleans) => {
    const result = {}
    for (const key of strings) if (typeof source[key] === 'string') result[key] = diagnosticText(source[key], 256)
    for (const key of numbers) if (Number.isSafeInteger(source[key]) && source[key] >= 0) result[key] = source[key]
    for (const key of booleans) if (typeof source[key] === 'boolean') result[key] = source[key]
    return result
  }
  const result = compact(value, ['request_id', 'remote_session_id'],
    ['schema_version', 'captured_at_ms', 'unclosed_count', 'pending_count', 'in_progress_count', 'unknown_count',
      'received_tool_events', 'accepted_tool_events', 'unaccepted_tool_events', 'validation_error_count', 'evidence_evicted_count', 'observer_error_count'],
    ['tools_truncated', 'validation_errors_truncated'])
  if (Array.isArray(value.tools)) {
    result.tools = value.tools.slice(0, 50).filter(tool => tool && typeof tool === 'object').map(tool => compact(tool,
      ['tool_id', 'status', 'kind', 'request_id', 'remote_session_id', 'last_received_status', 'last_accepted_status'],
      ['first_seen_at_ms', 'last_update_at_ms', 'last_received_at_ms', 'received_update_count', 'accepted_update_count'],
      ['seen_in_progress', 'input_observed', 'input_nonempty', 'output_observed', 'evidence_missing']))
    if (value.tools.length > 50) result.tools_truncated = true
  }
  if (Array.isArray(value.validation_errors)) {
    result.validation_errors = value.validation_errors.slice(-10).filter(error => error && typeof error === 'object').map(error => {
      const entry = compact(error, ['tool_id', 'remote_session_id', 'request_id', 'code'], ['at_ms'], [])
      if (Array.isArray(error.path)) entry.path = error.path.slice(0, 12).map(part => diagnosticText(part, 64))
      return entry
    })
    if (value.validation_errors.length > 10) result.validation_errors_truncated = true
  }
  return result
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
    'review_status', 'review_request_id', 'producer_session_id', 'reviewer_session_id', 'semantic_verdict',
    'diagnostic_path', 'state_path', 'agent_version', 'last_tool_id', 'last_tool_status', 'last_tool_name', 'action_id', 'unit_id', 'execution_id', 'action_stage', 'tool_kind', 'exit_signal', 'kind', 'decision',
    'request_id', 'host_call_id', 'request_kind', 'prompt_kind', 'model_request_timing', 'model_source',
  ]) {
    if (typeof value[key] === 'string' && value[key].trim() !== '') event[key] = diagnosticText(value[key].trim())
  }
  if (Array.isArray(value.paths)) {
    event.paths = []
    let remaining = MAX_EVENT_TEXT
    for (const item of value.paths) {
      if (remaining <= 0) break
      if (typeof item !== 'string') continue
      const text = diagnosticText(item, remaining)
      event.paths.push(text)
      remaining -= text.length + 1
    }
  }
  for (const key of [
    'turn', 'completed', 'message_chunks', 'tool_calls', 'tool_failures', 'turn_duration_ms', 'active_tool_count',
    'first_event_ms', 'tool_started_at_ms', 'tool_finished_at_ms', 'tool_duration_ms', 'stderr_bytes', 'duration_ms', 'file_count', 'total_bytes', 'snapshot_duration_ms', 'prompt_chars', 'prompt_bytes',
    'started_at_ms', 'finished_at_ms', 'queue_duration_ms', 'idle_duration_ms', 'budget_ms',
  ]) {
    if (Number.isInteger(value[key]) && value[key] >= 0) event[key] = value[key]
  }
  for (const key of ['model', 'requested_model', 'first_event_ms', 'first_token_ms']) {
    if (value[key] === null) event[key] = null
  }
  for (const key of ['process_exited', 'stderr_truncated', 'output_truncated', 'request_dispatched']) {
    if (typeof value[key] === 'boolean') event[key] = value[key]
  }
  const toolLifecycle = compactToolLifecycle(value.tool_lifecycle)
  if (toolLifecycle) event.tool_lifecycle = toolLifecycle
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
