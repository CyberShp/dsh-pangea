import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

const STORE_VERSION = 1
const MAX_TIMELINE = 120

function defaultStorePath() {
  const configured = process.env.DSH_HOME
  const root = typeof configured === 'string' && configured.trim() !== ''
    ? path.resolve(configured)
    : path.join(homedir(), '.dsh')
  return path.join(root, 'dsh-pangea-companion', 'monitor-v1.json')
}

function emptyStore() {
  return { version: STORE_VERSION, runs: {} }
}

function plainText(value, fallback = '') {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

function outcomeFromToolResult(event) {
  const block = event?.data?.message?.content?.[0]
  return block?.isError === true || event?.data?.error ? 'error' : 'success'
}

function eventLabel(kind, value) {
  if (kind === 'agent') return value === 'running' ? 'Agent 开始运行' : 'Agent 已空闲'
  if (kind === 'pangea') return `PANGEA：${value}`
  return value
}

function timelineKey(event) {
  return event.key ?? `${event.kind}:${event.time}:${event.title}`
}

function trimTimeline(events) {
  return events.length > MAX_TIMELINE ? events.slice(events.length - MAX_TIMELINE) : events
}

function normalizeStoredRun(runId, value) {
  const firstSeen = Number.isFinite(value?.first_seen) ? value.first_seen : null
  const rawTimeline = Array.isArray(value?.timeline)
    ? value.timeline.filter(item => item && typeof item === 'object' && (firstSeen === null || !Number.isFinite(item.time) || item.time >= firstSeen || item.ended_at >= firstSeen || item.state === 'running'))
    : []
  const byKey = new Map()
  for (const item of rawTimeline) {
    const bindingSession = item.kind === 'binding'
      ? plainText(item.session_id) || /^binding:[^:]+:(.+)$/.exec(plainText(item.key))?.[1] || plainText(value?.session_id, 'unknown')
      : null
    const normalized = item.kind === 'binding'
      ? { ...item, key: `binding:${runId}:${bindingSession}`, session_id: bindingSession }
      : item
    byKey.set(timelineKey(normalized), normalized)
  }
  const timeline = [...byKey.values()].sort((a, b) => (a.time ?? 0) - (b.time ?? 0)).slice(-MAX_TIMELINE)
  return {
    run_id: runId,
    session_id: plainText(value?.session_id) || null,
    session_created_at: Number.isFinite(value?.session_created_at) ? value.session_created_at : null,
    workspace: plainText(value?.workspace) || null,
    first_seen: firstSeen,
    last_seen: Number.isFinite(value?.last_seen) ? value.last_seen : null,
    agent_status: value?.agent_status === 'running' ? 'running' : 'idle',
    pangea_phase: plainText(value?.pangea_phase) || null,
    pangea_progress: value?.pangea_progress && typeof value.pangea_progress === 'object' ? value.pangea_progress : null,
    timeline,
  }
}

function openRuntimeEvents(events) {
  const calls = new Map()
  const workflows = new Map()
  const workers = new Map()
  for (const event of events) {
    if (event.type === 'tool/call') calls.set(String(event.data.callId), event)
    else if (event.type === 'tool/result') {
      const callId = String(event.data.message?.source?.callId ?? event.data.message?.content?.[0]?.toolCallId ?? '')
      if (callId) calls.delete(callId)
    } else if (event.type === 'tool-workflow/run-start') workflows.set(String(event.data.runId), event)
    else if (event.type === 'tool-workflow/run-end') workflows.delete(String(event.data.runId))
    else if (event.type === 'tool-workflow/agent-start') workers.set(`${event.data.runId}:${event.data.seq}`, event)
    else if (event.type === 'tool-workflow/agent-end') workers.delete(`${event.data.runId}:${event.data.seq}`)
  }
  return [...calls.values(), ...workflows.values(), ...workers.values()].sort((a, b) => (a.time ?? 0) - (b.time ?? 0))
}

export class RuntimeMonitor {
  constructor({ storePath = defaultStorePath(), now = () => Date.now() } = {}) {
    this.storePath = storePath
    this.now = now
    this.store = emptyStore()
    this.sessions = new Map()
    this.agents = new WeakMap()
    this.saveTimer = undefined
    this.saveQueue = Promise.resolve()
    this.ready = this.load()
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.storePath, 'utf8'))
      if (parsed?.version !== STORE_VERSION || !parsed.runs || typeof parsed.runs !== 'object') return
      const runs = {}
      for (const [runId, value] of Object.entries(parsed.runs)) runs[runId] = normalizeStoredRun(runId, value)
      this.store = { version: STORE_VERSION, runs }
    } catch (error) {
      if (error?.code !== 'ENOENT') console.warn('[dsh-pangea-companion] monitor history could not be loaded:', error)
    }
  }

  start(ctx) {
    const disposers = []
    const attach = agent => {
      if (!agent || agent.session?.header?.origin === 'subagent' || this.agents.has(agent)) return
      const sessionId = String(agent.id)
      const session = {
        session_id: sessionId,
        workspace: plainText(agent.session?.header?.cwd) || null,
        created_at: agent.session?.header?.createdAt ?? null,
        live: true,
        status: agent.status === 'running' ? 'running' : 'idle',
        last_activity: this.now(),
        bound_run_id: null,
        active_tools: new Map(),
        active_subagents: new Map(),
        agent,
      }
      this.sessions.set(sessionId, session)
      this.agents.set(agent, session)

      const scoped = []
      scoped.push(agent.ctx.on('agent/status', ({ status }) => {
        void this.ready.then(() => this.observeAgentStatus(sessionId, status))
      }))
      scoped.push(agent.ctx.on('session/event', (_current, event) => {
        void this.ready.then(() => this.observeSessionEvent(sessionId, event))
      }))
      scoped.push(agent.ctx.on('subagent/start', info => {
        void this.ready.then(() => this.observeSubagent(sessionId, 'start', info))
      }))
      scoped.push(agent.ctx.on('subagent/end', info => {
        void this.ready.then(() => this.observeSubagent(sessionId, 'end', info))
      }))
      this.agents.set(agent, { ...session, scoped })
    }

    for (const agent of ctx.agents?.roots?.() ?? []) attach(agent)
    disposers.push(ctx.on('agent/created', ({ agent }) => attach(agent)))
    disposers.push(ctx.on('agent/disposed', ({ agent }) => {
      void this.ready.then(() => this.disposeAgent(agent))
    }))
    return async () => {
      for (const dispose of disposers.reverse()) dispose()
      for (const session of this.sessions.values()) session.live = false
      await this.flush()
    }
  }

  disposeAgent(agent) {
    const tracked = this.agents.get(agent)
    if (!tracked) return
    for (const dispose of tracked.scoped ?? []) dispose()
    const session = this.sessions.get(String(agent.id))
    if (session) {
      session.live = false
      session.status = 'idle'
      session.active_tools.clear()
      session.active_subagents.clear()
      session.last_activity = this.now()
      if (session.bound_run_id) {
        const run = this.store.runs[session.bound_run_id]
        if (run) {
          run.agent_status = 'idle'
          run.last_seen = session.last_activity
          this.append(run, {
            kind: 'agent', time: session.last_activity, state: 'ended', session_id: session.session_id,
            title: 'DSH 会话已结束', detail: '历史 Run 数据仍可独立浏览。',
          })
        }
      }
    }
    this.agents.delete(agent)
    this.scheduleSave()
  }

  append(run, event) {
    const key = timelineKey(event)
    const index = run.timeline.findIndex(item => timelineKey(item) === key)
    if (index >= 0) run.timeline[index] = { ...run.timeline[index], ...event }
    else run.timeline.push(event)
    run.timeline = trimTimeline(run.timeline.sort((a, b) => (a.time ?? 0) - (b.time ?? 0)))
  }

  ensureRun(runId, session) {
    let run = this.store.runs[runId]
    if (!run) {
      const time = this.now()
      run = normalizeStoredRun(runId, {
        session_id: session?.session_id,
        session_created_at: session?.created_at,
        workspace: session?.workspace,
        first_seen: time,
        last_seen: time,
      })
      this.store.runs[runId] = run
    }
    if (session) {
      run.session_id = session.session_id
      run.session_created_at = session.created_at
      run.workspace = session.workspace
      run.agent_status = session.status
      run.first_seen ??= this.now()
      run.last_seen ??= this.now()
    }
    return run
  }

  observeAgentStatus(sessionId, status) {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.status = status === 'running' ? 'running' : 'idle'
    session.last_activity = this.now()
    if (!session.bound_run_id) return
    const run = this.ensureRun(session.bound_run_id, session)
    run.agent_status = session.status
    const previous = run.timeline.at(-1)
    if (previous?.kind !== 'agent' || previous.state !== session.status) {
      this.append(run, {
        kind: 'agent', time: session.last_activity, state: session.status, session_id: session.session_id,
        title: eventLabel('agent', session.status),
      })
    }
    this.scheduleSave()
  }

  observeSessionEvent(sessionId, event, { replay = false } = {}) {
    const session = this.sessions.get(sessionId)
    if (!session || !session.bound_run_id || !event) return
    const run = this.ensureRun(session.bound_run_id, session)
    const eventTime = event.time ?? this.now()
    if (!replay) session.last_activity = eventTime
    run.last_seen = Math.max(run.last_seen ?? 0, eventTime)

    if (event.type === 'tool/call') {
      const callId = String(event.data.callId)
      const item = {
        key: `tool:${session.session_id}:${callId}`, kind: 'tool', time: event.time, state: 'running',
        title: plainText(event.data.name, '未命名工具'), call_id: callId, session_id: session.session_id,
      }
      session.active_tools.set(callId, item)
      this.append(run, item)
    } else if (event.type === 'tool/result') {
      const callId = String(event.data.message?.source?.callId ?? event.data.message?.content?.[0]?.toolCallId ?? '')
      if (callId) {
        const active = session.active_tools.get(callId)
        const key = `tool:${session.session_id}:${callId}`
        const previous = run.timeline.find(item => item.key === key)
        this.append(run, {
          ...(previous ?? active ?? {}), key, kind: 'tool',
          time: previous?.time ?? active?.time ?? event.time, ended_at: event.time,
          state: outcomeFromToolResult(event), title: previous?.title ?? active?.title ?? '工具调用', call_id: callId, session_id: session.session_id,
        })
        session.active_tools.delete(callId)
      }
    } else if (event.type === 'tool-workflow/run-start') {
      this.append(run, {
        key: `workflow:${session.session_id}:${event.data.runId}`, kind: 'workflow', time: event.time, state: 'running',
        title: plainText(event.data.name, '工作流'), detail: '工作流已开始', session_id: session.session_id,
      })
    } else if (event.type === 'tool-workflow/run-end') {
      const key = `workflow:${session.session_id}:${event.data.runId}`
      const previous = run.timeline.find(item => item.key === key)
      this.append(run, {
        ...(previous ?? {}), key, kind: 'workflow', time: previous?.time ?? event.time,
        ended_at: event.time, state: event.data.stopReason === 'completed' ? 'success' : plainText(event.data.stopReason, 'ended'),
        title: previous?.title ?? '工作流', detail: `工作流结束：${plainText(event.data.stopReason, '未知原因')}`, session_id: session.session_id,
      })
    } else if (event.type === 'tool-workflow/agent-start') {
      this.append(run, {
        key: `worker:${session.session_id}:${event.data.runId}:${event.data.seq}`, kind: 'worker', time: event.time, state: 'running',
        title: plainText(event.data.label, '工作流成员'), detail: plainText(event.data.phase), session_id: session.session_id,
      })
    } else if (event.type === 'tool-workflow/agent-end') {
      const key = `worker:${session.session_id}:${event.data.runId}:${event.data.seq}`
      const previous = run.timeline.find(item => item.key === key)
      this.append(run, {
        ...(previous ?? {}), key, kind: 'worker', time: previous?.time ?? event.time, ended_at: event.time,
        state: event.data.outcome === 'completed' ? 'success' : plainText(event.data.outcome, 'ended'),
        title: previous?.title ?? '工作流成员', detail: `成员结束：${plainText(event.data.outcome, '未知')}`, session_id: session.session_id,
      })
    } else if (event.type === 'turn/end' && event.data?.reason?.kind === 'error') {
      this.append(run, {
        kind: 'agent', time: event.time, state: 'error', title: 'Agent 本轮执行失败', session_id: session.session_id,
        detail: plainText(event.data.reason.error?.message, '未提供错误说明'),
      })
    } else return

    if (!replay) this.scheduleSave()
  }

  observeSubagent(sessionId, edge, info) {
    const session = this.sessions.get(sessionId)
    if (!session || !session.bound_run_id) return
    const run = this.ensureRun(session.bound_run_id, session)
    const key = `subagent:${session.session_id}:${String(info.runId)}`
    const time = this.now()
    if (edge === 'start') {
      const item = {
        key, kind: 'subagent', time, state: 'running',
        title: `子 Agent ${String(info.id).slice(0, 8)}`, detail: plainText(info.provider, '默认提供方'), session_id: session.session_id,
      }
      session.active_subagents.set(key, item)
      this.append(run, item)
    } else {
      const previous = run.timeline.find(item => item.key === key) ?? session.active_subagents.get(key)
      this.append(run, {
        ...(previous ?? {}), key, kind: 'subagent', time: previous?.time ?? time, ended_at: time,
        state: info.stopReason === 'completed' ? 'success' : plainText(info.stopReason, 'ended'),
        title: previous?.title ?? `子 Agent ${String(info.id).slice(0, 8)}`,
        detail: `子 Agent 结束：${plainText(info.stopReason, '未知')}`, session_id: session.session_id,
      })
      session.active_subagents.delete(key)
    }
    session.last_activity = time
    run.last_seen = time
    this.scheduleSave()
  }

  async bindRun(sessionId, summary) {
    await this.ready
    const session = this.sessions.get(sessionId)
    const runId = plainText(summary?.run_id)
    if (!session || !runId) return
    const changed = session.bound_run_id !== runId
    session.bound_run_id = runId
    const run = this.ensureRun(runId, session)
    if (changed) {
      const bindingTime = this.now()
      run.last_seen = Math.max(run.last_seen ?? 0, bindingTime)
      this.append(run, {
        key: `binding:${runId}:${sessionId}`, kind: 'binding', time: bindingTime, state: session.live ? 'live' : 'historical', session_id: sessionId,
        title: '已关联当前 DSH 会话', detail: `会话 ${sessionId.slice(0, 8)} · Run ${runId}`,
      })
      session.active_tools.clear()
      const relevant = openRuntimeEvents(session.agent?.session?.events ?? [])
      for (const event of relevant) this.observeSessionEvent(sessionId, event, { replay: true })
    }
    this.observePangeaSnapshot(run, summary)
    this.scheduleSave()
  }

  observePangeaSnapshot(run, summary) {
    const completed = summary?.analysis?.completed ?? 0
    const total = summary?.analysis?.total ?? 0
    const phase = plainText(summary?.phase, 'UNKNOWN')
    const next = { completed, total, reworked: summary?.analysis?.reworked ?? 0 }
    const changed = run.pangea_phase !== phase
      || run.pangea_progress?.completed !== completed
      || run.pangea_progress?.total !== total
      || run.pangea_progress?.reworked !== next.reworked
    run.pangea_phase = phase
    run.pangea_progress = next
    if (changed) {
      const observedAt = this.now()
      run.last_seen = observedAt
      this.append(run, {
        kind: 'pangea', time: observedAt, state: summary?.terminal ? 'ended' : 'running',
        title: eventLabel('pangea', phase), detail: `分析进度 ${completed}/${total} · 返工 ${next.reworked}`,
      })
    }
  }

  async snapshot({ sessionId, runId } = {}) {
    await this.ready
    const session = plainText(sessionId) ? this.sessions.get(sessionId) : undefined
    const selectedRunId = plainText(runId) || session?.bound_run_id || null
    const run = selectedRunId ? this.store.runs[selectedRunId] : undefined
    const currentBinding = Boolean(session && run && session.bound_run_id === run.run_id)
    const activeTools = session ? [...session.active_tools.values()] : []
    const activeSubagents = session ? [...session.active_subagents.values()] : []
    const timeline = run
      ? run.timeline.filter(item => !currentBinding || !item.session_id || item.session_id === session.session_id)
      : []
    return {
      session: session ? {
        session_id: session.session_id,
        workspace: session.workspace,
        created_at: session.created_at,
        live: session.live,
        status: session.status,
        last_activity: session.last_activity,
        bound_run_id: session.bound_run_id,
        active_tools: activeTools,
        active_subagents: activeSubagents,
      } : null,
      run: run ? {
        ...run,
        session_id: currentBinding ? session.session_id : run.session_id,
        session_live: currentBinding ? session.live : false,
        timeline: timeline.sort((a, b) => (b.time ?? 0) - (a.time ?? 0)),
      } : null,
    }
  }

  scheduleSave() {
    if (this.saveTimer !== undefined) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      this.saveQueue = this.saveQueue.then(() => this.persist(), () => this.persist())
    }, 250)
  }

  async persist() {
    await mkdir(path.dirname(this.storePath), { recursive: true })
    const temporary = `${this.storePath}.tmp`
    await writeFile(temporary, `${JSON.stringify(this.store, null, 2)}\n`, 'utf8')
    await rename(temporary, this.storePath)
  }

  async flush() {
    await this.ready
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer)
      this.saveTimer = undefined
      this.saveQueue = this.saveQueue.then(() => this.persist(), () => this.persist())
    }
    await this.saveQueue
  }
}

export function createRuntimeMonitor(options) {
  return new RuntimeMonitor(options)
}
