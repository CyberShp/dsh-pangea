import path from 'node:path'
import { createHash } from 'node:crypto'
import { appendFile, lstat, mkdir, open, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { writeTaskStoreFile } from './task-store.js'

const MAX_EVENT_BYTES = 256 * 1024
const MAX_PAGE_BYTES = 1024 * 1024
const queues = new Map()
const recordingErrors = new Map()
export function isAgentSessionPathInside(root, value, pathApi = path) {
  // Windows realpath may change drive/directory casing. Use the platform's
  // path semantics while retaining case-sensitive comparisons on POSIX.
  const relative = pathApi.relative(root, value)
  return relative === '' || relative !== '..' && !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative)
}
const inside = isAgentSessionPathInside

async function recordedPath(file) {
  try { return await realpath(file) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    // ENOENT can also mean a dangling symlink. Do not let a later append
    // follow that link and create a file outside the checked directory.
    const entry = await lstat(file).catch(cause => { if (cause.code === 'ENOENT') return null; throw cause })
    if (entry) throw new Error('Agent 会话路径包含无法解析的链接')
    const parent = path.dirname(file)
    if (parent === file) throw error
    return path.join(await recordedPath(parent), path.basename(file))
  }
}
const present = value => typeof value === 'string' && value.length > 0
const sessionTimestamp = session => {
  for (const value of [session.updated_at, session.created_at]) {
    const timestamp = typeof value === 'string' && value.trim() ? Date.parse(value) : NaN
    if (Number.isFinite(timestamp)) return timestamp
  }
  return -Infinity
}
const safeRunId = value => {
  if (!present(value) || value === '.' || value === '..' || /[\\/\0]/.test(value)) throw new Error('无效 run_id')
  return value
}
const sessionKey = meta => {
  if (!present(meta.provider) || !(present(meta.remote_session_id) || present(meta.agent_session_id))) throw new Error('Agent 会话缺少执行器或身份')
  return createHash('sha256').update(JSON.stringify([meta.provider, meta.remote_session_id || `${meta.owner_instance_id || 'legacy'}:${meta.agent_session_id}`])).digest('hex')
}
const serial = (key, operation) => {
  const result = (queues.get(key) || Promise.resolve()).then(operation)
  const pending = result.catch(() => {})
  queues.set(key, pending)
  void pending.finally(() => { if (queues.get(key) === pending) queues.delete(key) })
  return result
}

// Preserve protocol structure and command/output details. Bound individual
// records explicitly; never silently pretend omitted content was recorded.
function compactEvent(value) {
  let budget = MAX_EVENT_BYTES / 2, truncated = false
  const visit = (item, depth = 0, key = '') => {
    if (/^(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password)$/i.test(key)) return '[redacted]'
    if (depth > 16 || budget <= 0) { truncated = true; return '[truncated]' }
    if (typeof item === 'string') {
      let text = item.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/=._~-]+/gi, '$1 [redacted]')
        .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password)(["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1$2[redacted]')
      if (Buffer.byteLength(text) > budget) { text = Buffer.from(text).subarray(0, Math.max(0, budget)).toString('utf8'); truncated = true }
      budget -= Buffer.byteLength(text)
      return text
    }
    if (item === null || typeof item === 'boolean' || typeof item === 'number') { budget -= 16; return item }
    if (Array.isArray(item)) { if (item.length > 500) truncated = true; return item.slice(0, 500).map(part => visit(part, depth + 1)) }
    if (item && typeof item === 'object') {
      const entries = Object.entries(item)
      if (entries.length > 200) truncated = true
      return Object.fromEntries(entries.slice(0, 200).map(([name, child]) => [name.slice(0, 200), visit(child, depth + 1, name)]))
    }
    return null
  }
  const event = visit(value)
  if (Buffer.byteLength(JSON.stringify(event)) > MAX_EVENT_BYTES) return { type: value.type || 'unknown', truncated: true, content: '[event exceeded recording limit]' }
  return { ...event, ...(truncated ? { truncated: true } : {}) }
}

async function boundedJson(file, limit = 4 * 1024 * 1024) {
  try {
    if ((await stat(file)).size > limit) throw new Error('Agent 会话索引超过读取上限')
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

export class AgentSessionStore {
  constructor({ dataRoot, runId }) {
    this.dataRoot = path.resolve(dataRoot)
    this.runId = safeRunId(runId)
    this.runRoot = path.join(this.dataRoot, 'runs', this.runId)
    this.root = path.join(this.runRoot, 'agent-sessions')
    this.replayHistoryExists = new Map()
  }

  async safePath(file, { create = false } = {}) {
    // Check real paths as well as lexical paths; a symlink must not turn this
    // read-only API into an arbitrary local-file reader.
    const dataRoot = await realpath(this.dataRoot)
    const runRoot = await realpath(this.runRoot)
    if (path.relative(path.join(dataRoot, 'runs', this.runId), runRoot) !== '') throw new Error('Agent 会话目录越出当前 Run')
    const root = await recordedPath(this.root)
    if (!inside(runRoot, root)) throw new Error('Agent 会话目录越出当前 Run')
    if (create) await mkdir(root, { recursive: true })
    const target = await recordedPath(file)
    if (!inside(root, target)) throw new Error('Agent 会话文件越出当前 Run')
    return target
  }

  async append(meta, value) {
    meta = { ...meta }
    value = compactEvent(value)
    const id = sessionKey(meta)
    return serial(this.root, async () => {
      const metaPath = await this.safePath(path.join(this.root, `${id}.json`), { create: true })
      const eventPath = await this.safePath(path.join(this.root, `${id}.jsonl`))
      const old = await boundedJson(metaPath) || {}
      if (old.run_id && (old.run_id !== this.runId || old.session_id !== id)) throw new Error('Agent 会话身份不一致')
      if (value.replay === true) {
        if (!this.replayHistoryExists.has(id)) this.replayHistoryExists.set(id, old.has_transcript_content === true)
        if (this.replayHistoryExists.get(id)) {
          if (!old.history_replay_skipped) await writeTaskStoreFile(metaPath, JSON.stringify({ ...old, history_replay_skipped: true,
            history_message: '保留已有采集记录；恢复回放未重复写入，不保证覆盖此前全部历史。' }))
          return old
        }
      }
      // session/load emits replay before session_bound. Reset the per-load
      // decision only when that load has finished, never per repeated chunk.
      if (value.type === 'session_bound') this.replayHistoryExists.delete(id)
      const at = present(value.at) ? value.at : new Date().toISOString()
      const offset = await stat(eventPath).then(value => value.size).catch(error => { if (error.code === 'ENOENT') return 0; throw error })
      const event = { ...value, action_id: meta.action_id ?? value.action_id, execution_id: meta.execution_id ?? value.execution_id,
        run_id: this.runId, session_id: id, seq: offset + 1, at }
      const supported = old.transcript_available === true || value.type !== 'host_event'
      const hasContent = old.has_transcript_content === true || value.type === 'prompt' || value.type === 'permission'
        || value.type === 'session_update' && /(?:message|thought)_chunk|tool_call/.test(value.update?.sessionUpdate || value.update?.type || '')
      const current = { ...old, schema_version: 1, run_id: this.runId, session_id: id, created_at: old.created_at || at, updated_at: at,
        event_count: (old.event_count || 0) + 1, transcript_available: supported, history_status: supported ? 'recorded' : 'metadata_only',
        has_transcript_content: hasContent,
        recording_error: recordingErrors.get(this.root) || old.recording_error || null,
        history_message: old.history_replay_skipped ? old.history_message : supported ? null : '执行器未提供会话事件，仅记录宿主摘要；没有可还原的 Agent 正文。',
        truncated: Boolean(old.truncated || event.truncated), status: old.status || 'ready' }
      for (const key of ['agent_session_id', 'remote_session_id', 'provider', 'role', 'stage', 'unit_id', 'attempt_id', 'owner_session_id']) {
        if (meta[key] != null) current[key] = meta[key]
      }
      if (meta.model != null) current.requested_model = meta.model
      if (present(value.model)) { current.model = value.model; current.model_source = 'agent' }
      else if (current.model_source !== 'agent' && meta.model != null) { current.model = meta.model; current.model_source = 'requested' }
      current.action_ids = [...new Set([...(old.action_ids || []), meta.action_id].filter(Boolean))]
      if (value.type === 'prompt') current.status = 'running'
      if (value.type === 'turn_end') current.status = value.response_received === false ? 'unconfirmed'
        : value.protocol_stop_reason === 'cancelled' ? 'paused' : 'idle'
      if (value.type === 'error') current.status = 'error'
      if (value.type === 'process_exit') current.status = 'exited'
      if (value.type === 'host_event' && /paused|attention/.test(value.stage || '')) current.status = 'paused'
      if (value.type === 'host_event' && value.stage === 'source_first_action_settled') current.status = 'completed'
      const update = value.update || {}
      if (update.toolCallId && !value.replay) current.last_tool_id = update.toolCallId
      if (update.status && !value.replay) current.last_tool_status = update.status
      if (value.last_tool_id) current.last_tool_id = value.last_tool_id
      if (value.last_tool_status) current.last_tool_status = value.last_tool_status
      await appendFile(eventPath, `${JSON.stringify(event)}\n`, 'utf8')
      await writeTaskStoreFile(metaPath, JSON.stringify(current))
      return current
    }).catch(error => { recordingErrors.set(this.root, error.message); throw error })
  }

  async legacySessions() {
    const read = async filename => {
      const file = path.join(this.runRoot, filename)
      const canonical = await recordedPath(file)
      const root = await realpath(this.runRoot)
      if (!inside(root, canonical)) throw new Error('Agent 会话来源越出当前 Run')
      return boundedJson(canonical)
    }
    const [bindings, progress] = await Promise.all([read('acp-workers.json'), read('progress.json')])
    if (bindings?.runId && bindings.runId !== this.runId || progress?.run_id && progress.run_id !== this.runId) throw new Error('Agent 会话来源与 Run 不一致')
    const actions = Object.entries(progress?.actions || {})
    return Object.entries(bindings?.workers || {}).map(([id, value]) => {
      const matched = actions.filter(([, action]) => action.task_id === id)
      const action = matched.at(-1)?.[1] || {}
      const meta = { provider: value.providerId || 'unknown', agent_session_id: id, remote_session_id: value.remoteSessionId || null }
      return { ...meta, session_id: sessionKey(meta), run_id: this.runId, model: value.agentModel || null,
        role: action.role || null, stage: action.stage || null, unit_id: action.unit_id || null,
        action_ids: matched.map(([key]) => key), status: value.blocked ? 'paused' : value.inflight ? 'running' : action.status || 'unknown',
        event_count: 0, transcript_available: false, history_status: 'metadata_only',
        history_message: '此会话创建时未记录正文，仅保留身份与执行摘要。', recording_error: null, truncated: false }
    })
  }

  async list() {
    await this.safePath(this.root)
    await queues.get(this.root)
    let files
    try { files = await readdir(this.root) } catch (error) { if (error.code !== 'ENOENT') throw error; files = [] }
    const items = [], errors = []
    for (const name of files.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).slice(0, 2000)) {
      try {
        const value = await boundedJson(await this.safePath(path.join(this.root, name)))
        if (value?.run_id !== this.runId || `${value.session_id}.json` !== name) throw new Error('会话身份不一致')
        items.push(value)
      } catch (error) { errors.push(error.message) }
    }
    const seen = new Set(items.map(item => item.session_id))
    try { for (const item of await this.legacySessions()) if (!seen.has(item.session_id)) items.push(item) }
    catch (error) { errors.push(error.message) }
    return { status: 'ok', run_id: this.runId, items: items.sort((a, b) => {
      const left = sessionTimestamp(a), right = sessionTimestamp(b)
      return left === right ? a.session_id.localeCompare(b.session_id) : left > right ? -1 : 1
    }), total: items.length,
      recording_error: recordingErrors.get(this.root) || errors.join('；') || null, truncated: files.length > 4000 }
  }

  async flush() { await queues.get(this.root) }

  async read(sessionId, { cursor = 0, limit = 100 } = {}) {
    if (!/^[a-f0-9]{64}$/.test(sessionId || '')) throw new Error('无效 session_id')
    const latest = cursor === 'latest', earlier = typeof cursor === 'string' && cursor.startsWith('before:')
    const offset = latest ? 0 : earlier && /^before:\d+$/.test(cursor) ? Number(cursor.slice(7)) : earlier ? NaN : Number(cursor)
    const count = Number(limit)
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(count) || count < 1 || count > 200) throw new Error('无效会话分页参数')
    const listing = await this.list(), session = listing.items.find(item => item.session_id === sessionId)
    if (!session) throw new Error('Agent 会话不属于当前 Run')
    const result = { status: 'ok', run_id: this.runId, session, events: [], next_cursor: offset, has_more: false,
      history_cursor: offset, has_history: offset > 0,
      history_status: session.history_status, recording_error: listing.recording_error }
    if (!session.event_count) return result
    const file = await this.safePath(path.join(this.root, `${sessionId}.jsonl`))
    const handle = await open(file, 'r')
    try {
      const { size } = await handle.stat()
      if (offset > size) throw new Error('会话游标超出记录范围')
      if (offset > 0) {
        const before = Buffer.alloc(1); await handle.read(before, 0, 1, offset - 1)
        if (before[0] !== 10) throw new Error('会话游标不在记录边界')
      }
      let start = offset, buffer
      if (latest || earlier) {
        // The extra record budget locates the first complete boundary and
        // excludes an in-progress tail. Returned page bytes still stay within
        // MAX_PAGE_BYTES; reading an entire growing transcript is unnecessary.
        const boundary = latest ? size : offset
        const scanStart = Math.max(0, boundary - MAX_PAGE_BYTES - MAX_EVENT_BYTES - 1)
        const scanned = Buffer.alloc(boundary - scanStart)
        const { bytesRead } = await handle.read(scanned, 0, scanned.length, scanStart)
        const completeEnd = bytesRead > 0 ? scanned.lastIndexOf(10, bytesRead - 1) + 1 : 0
        let begin = completeEnd, records = 0
        while (begin > 0 && records < count) {
          const previous = begin > 1 ? scanned.lastIndexOf(10, begin - 2) : -1
          const candidate = previous + 1
          if ((candidate === 0 && scanStart > 0) || completeEnd - candidate > MAX_PAGE_BYTES) break
          begin = candidate
          records++
        }
        start = scanStart + begin
        if (!records) {
          // Do not advance a live cursor past any incomplete/unread record.
          // Valid recorded events fit in the bounded scan; an oversized or
          // damaged tail is surfaced rather than silently skipped.
          start = boundary === 0 || scanStart === 0 ? 0 : offset
          if (boundary > 0) result.recording_error = '会话尾部尚未写完或记录超过读取上限'
        }
        buffer = scanned.subarray(begin, completeEnd)
      } else {
        buffer = Buffer.alloc(Math.min(MAX_PAGE_BYTES, size - start))
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
        buffer = buffer.subarray(0, bytesRead)
      }
      let begin = 0
      while (begin < buffer.length && result.events.length < count) {
        const end = buffer.indexOf(10, begin)
        if (end < 0) break // A concurrently appended partial record is retried.
        try {
          const event = JSON.parse(buffer.subarray(begin, end).toString('utf8'))
          if (event.run_id !== this.runId || event.session_id !== sessionId) throw new Error('事件身份不一致')
          result.events.push(event)
        } catch (error) {
          result.recording_error = `会话记录损坏：${error.message}`
          result.events.push({ type: 'recording_error', seq: start + begin + 1, at: null, message: result.recording_error })
        }
        begin = end + 1
      }
      result.next_cursor = start + begin
      result.history_cursor = start
      result.has_history = start > 0
      result.has_more = result.next_cursor < size
      if (buffer.length > 0 && begin === 0) result.recording_error = '会话尾部尚未写完或记录超过读取上限'
      return result
    } finally { await handle.close() }
  }
}

export function createAgentSessionRecorder(options) {
  const store = new AgentSessionStore(options)
  return { store, record: (meta, event) => store.append(meta, event).catch(() => null), flush: () => store.flush() }
}
