import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { dataRootFor } from './pangea-api.js'

const TERMINAL = new Set(['completed', 'failed', 'needs_attention', 'interrupted', 'stopped', 'cancelled'])
const ACTIVE = new Set(['preparing', 'queued', 'running', 'repairing', 'finalizing', 'stopping'])

/** One queue per application runtime, shared by all workspaces and data roots. */
export class AssetExtractionQueue {
  constructor(runtime, { concurrency = 2, pollIntervalMs = 500 } = {}) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('提取并发数必须为正整数')
    this.runtime = runtime
    this.concurrency = concurrency
    this.pollIntervalMs = Math.max(10, pollIntervalMs)
    this.entries = new Map()
    this.pending = []
    this.active = new Map()
    this.archiving = new Map()
    this.archived = new Set()
    this.scheduled = false
    this.disposed = false
    this.timer = null
  }

  key(dataRoot, assetId) { return `${path.resolve(dataRoot)}\n${assetId}` }
  recordPath(dataRoot, assetId) {
    return path.join(path.resolve(dataRoot), '.pangea', 'asset-queue', `${createHash('sha256').update(assetId).digest('hex')}.json`)
  }
  saved(dataRoot, assetId) {
    const file = this.recordPath(dataRoot, assetId)
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
  }
  persist(entry) {
    const file = this.recordPath(entry.params.dataRoot, entry.params.assetId)
    mkdirSync(path.dirname(file), { recursive: true })
    const temporary = `${file}.${randomUUID()}.tmp`
    // Queue records deliberately omit prompts, source content and executor credentials.
    writeFileSync(temporary, JSON.stringify(entry.record), 'utf8')
    renameSync(temporary, file)
  }
  position(entry) {
    return this.pending.filter(candidate => candidate.state === 'waiting' && this.entries.get(candidate.key) === candidate).indexOf(entry) + 1
  }
  snapshot(record, state = record.status) {
    const interrupted = state === 'waiting' || state === 'started'
    return {
      status: interrupted ? 'interrupted' : state,
      queued_at: record.queued_at,
      started_at: record.started_at,
      completed_at: record.completed_at,
      events: record.events ?? [],
      history: record.history ?? [],
      output: '',
      error: interrupted ? '应用已重启，尚未完成的排队请求已保留；请重新提取此资产。' : record.error,
      session_available: false,
      queue_pending: false,
      queue_position: 0,
    }
  }
  job(dataRoot, assetId) {
    const entry = this.entries.get(this.key(dataRoot, assetId))
    const record = entry?.record ?? this.saved(dataRoot, assetId)
    if (entry?.state === 'waiting') return {
      ...this.snapshot(record, 'waiting'), status: 'waiting', error: undefined,
      queue_pending: true, queue_position: this.position(entry),
    }
    if (record && (['stopped', 'failed', 'completed'].includes(record.status) || (!entry && record.status === 'waiting'))) return this.snapshot(record)
    const job = this.runtime.job(dataRoot, assetId)
    if (job) return {
      ...job,
      ...(record ? { queued_at: record.queued_at, history: [...(record.history ?? []), ...(job.history ?? [])] } : {}),
      ...(entry?.stopError ? { stop_error: entry.stopError } : {}),
      queue_pending: false, queue_position: 0,
    }
    if (entry && this.active.get(entry.key) === entry) return {
      ...this.snapshot(record, 'preparing'), status: entry.stopPending ? 'stopping' : 'preparing',
    }
    return record ? this.snapshot(record) : null
  }

  enqueue(params) {
    if (this.disposed) throw new Error('资产提取队列已关闭')
    if (typeof params.assetId !== 'string' || !params.assetId.trim()) throw new Error('资产编号不能为空')
    const dataRoot = dataRootFor(params.cwd, params.dataRoot)
    const key = this.key(dataRoot, params.assetId)
    if (this.archiving.has(key)) throw new Error('资产正在删除，请等待操作完成')
    if (this.archived.has(key)) throw new Error('资产已删除，恢复后才能重新提取')
    const current = this.entries.get(key)
    if (current && (current.state === 'waiting' || this.active.get(key) === current)) {
      return { completed: false, queued: current.state === 'waiting', reused: true, extraction_job: this.job(dataRoot, params.assetId) }
    }
    const existing = this.runtime.job(dataRoot, params.assetId)
    if (existing && ACTIVE.has(existing.status)) {
      // Adopt an already running task rather than dispatching a duplicate or ignoring its slot.
      const entry = { key, params: { ...params, dataRoot }, state: 'active', startPending: false,
        record: this.saved(dataRoot, params.assetId) ?? { status: 'started', queued_at: new Date().toISOString(), history: [], events: [] } }
      this.entries.set(key, entry)
      this.active.set(key, entry)
      this.schedule()
      return { completed: false, queued: false, reused: true, extraction_job: this.job(dataRoot, params.assetId) }
    }
    const previous = this.saved(dataRoot, params.assetId)
    const history = [...(previous?.history ?? [])]
    if (previous && previous.status !== 'started') history.push({ ...this.snapshot(previous), history: undefined })
    const queuedAt = new Date().toISOString()
    const entry = { key, params: { ...params, dataRoot }, state: 'waiting', startPending: false,
      record: { status: 'waiting', queued_at: queuedAt, history,
        events: [{ at: queuedAt, label: '已加入提取队列，等待可用执行位置' }] } }
    this.persist(entry)
    this.entries.set(key, entry)
    this.pending.push(entry)
    this.schedule()
    return { completed: false, queued: true, reused: false, extraction_job: this.job(dataRoot, params.assetId) }
  }
  start(params) { return this.enqueue(params) }

  schedule() {
    if (this.disposed || this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      if (!this.disposed) this.drain()
    })
  }
  failStart(entry, error) {
    entry.record.status = 'failed'
    entry.record.error = error instanceof Error ? error.message : String(error)
    entry.record.completed_at = new Date().toISOString()
    entry.record.events.push({ at: entry.record.completed_at, label: '提取任务未能启动' })
    try { this.persist(entry) } catch { /* The in-memory failure remains visible. */ }
  }
  drain() {
    for (const [key, entry] of this.active) {
      if (entry.startPending || entry.stopPending || entry.stopError) continue
      if (entry.unobservedStartFailure) {
        let observed
        try { observed = this.runtime.job(entry.params.dataRoot, entry.params.assetId) } catch { continue }
        if (!observed || (!ACTIVE.has(observed.status) && observed.status !== 'failed')) this.failStart(entry, entry.unobservedStartFailure)
        entry.unobservedStartFailure = null
      }
      let job
      try { job = this.job(entry.params.dataRoot, entry.params.assetId) } catch { continue }
      if (TERMINAL.has(job?.status)) {
        this.active.delete(key)
        entry.state = 'terminal'
      }
    }
    while (this.active.size < this.concurrency && this.pending.length) {
      const entry = this.pending.shift()
      if (entry.state !== 'waiting' || this.entries.get(entry.key) !== entry) continue
      entry.state = 'active'
      entry.startPending = true
      this.active.set(entry.key, entry)
      void this.launch(entry)
    }
    if (this.active.size && !this.timer) {
      this.timer = setInterval(() => this.schedule(), this.pollIntervalMs)
      this.timer.unref?.()
    } else if (!this.active.size && this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
  async launch(entry) {
    try {
      entry.record.status = 'started'
      entry.record.started_at = new Date().toISOString()
      this.persist(entry)
      const result = await this.runtime.start(entry.params)
      // Some deterministic runtimes finish without retaining an in-memory job.
      if (result?.completed && !this.runtime.job(entry.params.dataRoot, entry.params.assetId)) {
        entry.record.status = 'completed'
        entry.record.completed_at = new Date().toISOString()
        this.persist(entry)
      }
    } catch (error) {
      let job, observed = false
      try { job = this.runtime.job(entry.params.dataRoot, entry.params.assetId); observed = true } catch { /* Keep any live job's slot. */ }
      if (!observed) entry.unobservedStartFailure = error instanceof Error ? error.message : String(error)
      else if (!job || (!ACTIVE.has(job.status) && job.status !== 'failed')) this.failStart(entry, error)
    } finally {
      entry.startPending = false
      this.schedule()
    }
  }

  async stop(params) {
    const dataRoot = dataRootFor(params.cwd, params.dataRoot)
    const key = this.key(dataRoot, params.assetId)
    let entry = this.entries.get(key)
    const record = entry?.record ?? this.saved(dataRoot, params.assetId)
    if (entry?.state === 'waiting' || (!entry && record?.status === 'waiting')) {
      entry ??= { key, params: { ...params, dataRoot }, record }
      entry.state = 'terminal'
      entry.record.status = 'stopped'
      entry.record.completed_at = new Date().toISOString()
      entry.record.events.push({ at: entry.record.completed_at, label: '已取消排队，未启动 Agent' })
      this.persist(entry)
      this.entries.set(key, entry)
      this.schedule()
      return { stopped: true, job: this.job(dataRoot, params.assetId) }
    }
    if (record?.status === 'stopped' && !this.active.has(key)) return { stopped: true, job: this.job(dataRoot, params.assetId) }
    if (!entry && record) {
      entry = { key, params: { ...params, dataRoot }, record, state: 'terminal' }
      this.entries.set(key, entry)
    }
    if (entry?.stopPromise) return entry.stopPromise
    if (entry) entry.stopPending = true
    const promise = Promise.resolve().then(async () => {
      try {
        const result = await this.runtime.stop({ ...params, dataRoot })
        if (entry) {
          entry.stopError = null
          if (entry.record.status !== 'started') {
            entry.record.history.push({ ...this.snapshot(entry.record), history: undefined })
            entry.record.status = (result?.job ?? this.runtime.job(dataRoot, params.assetId)) ? 'started' : result?.completed ? 'completed' : 'stopped'
            entry.record.completed_at = new Date().toISOString()
            this.persist(entry)
          }
        }
        return { ...result, job: this.job(dataRoot, params.assetId) }
      } catch (error) {
        // A failed cancellation must never free capacity while its worker may still be alive.
        if (entry && this.active.get(key) === entry) entry.stopError = error instanceof Error ? error.message : String(error)
        throw error
      } finally {
        if (entry) { entry.stopPending = false; entry.stopPromise = null }
        this.schedule()
      }
    })
    if (entry) entry.stopPromise = promise
    return promise
  }

  archive(params, archiveFn) {
    const dataRoot = dataRootFor(params.cwd, params.dataRoot)
    const key = this.key(dataRoot, params.assetId)
    if (this.archiving.has(key)) return this.archiving.get(key)
    const promise = Promise.resolve().then(async () => {
      await this.stop({ ...params, dataRoot })
      const result = await archiveFn()
      this.archived.add(key)
      return result
    }).finally(() => this.archiving.delete(key))
    this.archiving.set(key, promise)
    return promise
  }
  restored(params) {
    const dataRoot = dataRootFor(params.cwd, params.dataRoot)
    const key = this.key(dataRoot, params.assetId)
    if (this.archiving.has(key)) throw new Error('资产正在删除，请等待操作完成后再恢复')
    this.archived.delete(key)
  }

  dispose() {
    this.disposed = true
    clearInterval(this.timer)
    this.timer = null
  }
}
