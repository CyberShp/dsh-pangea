import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

const STORE_VERSION = 2

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

function normalizedDataRoot(value) {
  const root = plainText(value)
  if (!root) return ''
  const resolved = path.resolve(root)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function runIdentityKey(dataRoot, runId) {
  const root = normalizedDataRoot(dataRoot)
  const id = plainText(runId)
  return root && id ? JSON.stringify([root, id]) : ''
}

function normalizeStoredRun(key, value) {
  return {
    run_key: key,
    run_id: plainText(value?.run_id) || null,
    data_root: normalizedDataRoot(value?.data_root) || null,
    task_id: plainText(value?.task_id) || null,
    attempt_id: plainText(value?.attempt_id) || null,
    session_id: plainText(value?.session_id) || null,
    session_created_at: Number.isFinite(value?.session_created_at) ? value.session_created_at : null,
    workspace: plainText(value?.workspace) || null,
    first_seen: Number.isFinite(value?.first_seen) ? value.first_seen : null,
    observed_at: Number.isFinite(value?.observed_at) ? value.observed_at : null,
    progress_changed_at: Number.isFinite(value?.progress_changed_at) ? value.progress_changed_at : null,
    execution_last_activity_at: Number.isFinite(value?.execution_last_activity_at) ? value.execution_last_activity_at : null,
    state_updated_at: plainText(value?.state_updated_at) || null,
    pangea_phase: plainText(value?.pangea_phase) || null,
    pangea_progress: value?.pangea_progress && typeof value.pangea_progress === 'object' ? value.pangea_progress : null,
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
      // v1 had neither data_root nor attempt identity and allowed browser
      // sessions to rewrite ownership. It is a disposable cache, not evidence
      // that can be guessed into the v2 identity model.
      if (parsed?.version !== STORE_VERSION || !parsed.runs || typeof parsed.runs !== 'object') return
      const runs = {}
      for (const [key, value] of Object.entries(parsed.runs)) {
        const normalized = normalizeStoredRun(key, value)
        if (runIdentityKey(normalized.data_root, normalized.run_id) === key) runs[key] = normalized
      }
      this.store = { version: STORE_VERSION, runs }
    } catch (error) {
      if (error?.code !== 'ENOENT') console.warn('[dsh-pangea-companion] run observation history could not be loaded:', error)
    }
  }

  start(ctx) {
    const disposers = []
    const attach = agent => {
      if (!agent || agent.session?.header?.origin === 'subagent' || this.agents.has(agent)) return
      const sessionId = String(agent.id)
      const existing = this.sessions.get(sessionId)
      const session = {
        session_id: sessionId,
        workspace: plainText(agent.session?.header?.cwd) || null,
        created_at: agent.session?.header?.createdAt ?? null,
        live: true,
        last_activity: this.now(),
        bound_run_key: existing?.bound_run_key ?? null,
      }
      this.sessions.set(sessionId, session)
      this.agents.set(agent, session)
      if (session.bound_run_key) {
        void this.ready.then(() => {
          const run = this.store.runs[session.bound_run_key]
          if (!run || run.session_id !== sessionId) return
          run.workspace = session.workspace
          run.session_created_at = session.created_at
          run.execution_last_activity_at = session.last_activity
          this.scheduleSave()
        })
      }
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
    if (session.bound_run_key) {
      const run = this.store.runs[session.bound_run_key]
      if (run && run.session_id === session.session_id) run.execution_last_activity_at = session.last_activity
    }
    this.agents.delete(agent)
    this.scheduleSave()
  }

  ensureRun(dataRoot, runId) {
    const key = runIdentityKey(dataRoot, runId)
    if (!key) throw new Error('monitor requires data_root and run_id')
    let run = this.store.runs[key]
    if (!run) {
      const time = this.now()
      run = normalizeStoredRun(key, { run_id: plainText(runId), data_root: normalizedDataRoot(dataRoot), first_seen: time })
      this.store.runs[key] = run
    }
    return run
  }

  async bindExecution(sessionId, summary, { dataRoot, taskId, attemptId } = {}) {
    await this.ready
    const ownerSessionId = plainText(sessionId)
    const runId = plainText(summary?.run_id)
    const root = normalizedDataRoot(dataRoot ?? summary?.data_root)
    const task = plainText(taskId)
    const attempt = plainText(attemptId)
    if (!ownerSessionId || !runId || !root || !task || !attempt) {
      throw new Error('monitor execution binding requires session_id, data_root, run_id, task_id, and attempt_id')
    }
    const key = runIdentityKey(root, runId)
    let session = this.sessions.get(ownerSessionId)
    if (!session) {
      session = { session_id: ownerSessionId, workspace: null, created_at: null, live: false, last_activity: this.now(), bound_run_key: null }
      this.sessions.set(ownerSessionId, session)
    }
    if (session.bound_run_key && session.bound_run_key !== key) {
      throw new Error(`monitor session is already bound to another Run: ${ownerSessionId}`)
    }
    const run = this.ensureRun(root, runId)
    if (run.attempt_id === attempt && run.session_id && run.session_id !== ownerSessionId) {
      throw new Error(`monitor attempt is already bound to another session: ${attempt}`)
    }
    session.bound_run_key = key
    session.last_activity = this.now()
    run.task_id = task
    run.attempt_id = attempt
    run.session_id = ownerSessionId
    run.session_created_at = session.created_at
    run.workspace = session.workspace
    run.execution_last_activity_at = session.last_activity
    this.observePangeaSnapshot(run, summary)
    this.scheduleSave()
  }

  observePangeaSnapshot(run, summary) {
    const completed = summary?.analysis?.completed ?? 0
    const total = summary?.analysis?.total ?? 0
    const phase = plainText(summary?.phase, 'UNKNOWN')
    const ackCount = Object.keys(summary?.workflow?.core_rules_ack ?? {}).length
    const next = { completed, total, reworked: summary?.analysis?.reworked ?? 0, core_rules_ack: ackCount }
    const stateUpdatedAt = summary?.state_read?.updated_at ?? null
    const changed = run.pangea_phase !== phase
      || run.pangea_progress?.completed !== completed
      || run.pangea_progress?.total !== total
      || run.pangea_progress?.reworked !== next.reworked
      || run.pangea_progress?.core_rules_ack !== ackCount
      || run.state_updated_at !== stateUpdatedAt
    const observedAt = this.now()
    run.pangea_phase = phase
    run.pangea_progress = next
    run.state_updated_at = stateUpdatedAt
    run.observed_at = observedAt
    if (changed) run.progress_changed_at = observedAt
  }

  async observeRunSnapshot(dataRoot, summary) {
    await this.ready
    const runId = plainText(summary?.run_id)
    const root = normalizedDataRoot(dataRoot ?? summary?.data_root)
    if (!runId || !root) return
    const run = this.ensureRun(root, runId)
    this.observePangeaSnapshot(run, summary)
    this.scheduleSave()
  }

  async snapshot({ sessionId, dataRoot, runId } = {}) {
    await this.ready
    const session = plainText(sessionId) ? this.sessions.get(sessionId) : undefined
    const explicitKey = runIdentityKey(dataRoot, runId)
    const selectedRunKey = explicitKey || session?.bound_run_key || null
    const run = selectedRunKey ? this.store.runs[selectedRunKey] : undefined
    const ownerSession = run?.session_id ? this.sessions.get(run.session_id) : undefined
    return {
      session: session ? {
        session_id: session.session_id,
        workspace: session.workspace,
        created_at: session.created_at,
        live: session.live,
        last_activity: session.last_activity,
        bound_run_id: session.bound_run_key ? this.store.runs[session.bound_run_key]?.run_id ?? null : null,
      } : null,
      run: run ? { ...run, last_seen: run.progress_changed_at, session_live: ownerSession?.live === true } : null,
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
