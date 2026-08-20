import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

const STORE_VERSION = 1

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

function normalizeStoredRun(runId, value) {
  return {
    run_id: runId,
    session_id: plainText(value?.session_id) || null,
    session_created_at: Number.isFinite(value?.session_created_at) ? value.session_created_at : null,
    workspace: plainText(value?.workspace) || null,
    first_seen: Number.isFinite(value?.first_seen) ? value.first_seen : null,
    last_seen: Number.isFinite(value?.last_seen) ? value.last_seen : null,
    pangea_phase: plainText(value?.pangea_phase) || null,
    pangea_progress: value?.pangea_progress && typeof value.pangea_progress === 'object'
      ? value.pangea_progress
      : null,
  }
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
      if (error?.code !== 'ENOENT') console.warn('[dsh-pangea-companion] run association history could not be loaded:', error)
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
        last_activity: this.now(),
        bound_run_id: null,
      }
      this.sessions.set(sessionId, session)
      this.agents.set(agent, session)
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
    const session = this.agents.get(agent)
    if (!session) return
    session.live = false
    session.last_activity = this.now()
    if (session.bound_run_id) {
      const run = this.store.runs[session.bound_run_id]
      if (run) run.last_seen = Math.max(run.last_seen ?? 0, session.last_activity)
    }
    this.agents.delete(agent)
    this.scheduleSave()
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
      run.first_seen ??= this.now()
      run.last_seen ??= this.now()
    }
    return run
  }

  async bindRun(sessionId, summary) {
    await this.ready
    const session = this.sessions.get(sessionId)
    const runId = plainText(summary?.run_id)
    if (!session || !runId) return
    const changedBinding = session.bound_run_id !== runId
    session.bound_run_id = runId
    if (changedBinding) session.last_activity = this.now()
    const run = this.ensureRun(runId, session)
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
    if (changed) run.last_seen = this.now()
  }

  async snapshot({ sessionId, runId } = {}) {
    await this.ready
    const session = plainText(sessionId) ? this.sessions.get(sessionId) : undefined
    const selectedRunId = plainText(runId) || session?.bound_run_id || null
    const run = selectedRunId ? this.store.runs[selectedRunId] : undefined
    const currentBinding = Boolean(session && run && session.bound_run_id === run.run_id)
    return {
      session: session ? {
        session_id: session.session_id,
        workspace: session.workspace,
        created_at: session.created_at,
        live: session.live,
        last_activity: session.last_activity,
        bound_run_id: session.bound_run_id,
      } : null,
      run: run ? {
        ...run,
        session_id: currentBinding ? session.session_id : run.session_id,
        session_live: currentBinding ? session.live : false,
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
