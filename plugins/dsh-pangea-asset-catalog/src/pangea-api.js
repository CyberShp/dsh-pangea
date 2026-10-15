import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { acpProviderOption, internalModelOptions, requireInternalModel } from '../../dsh-pangea-companion/src/workbench-api.js'

function workspaceRoot(cwd) {
  if (typeof cwd !== 'string' || cwd.trim() === '') throw new Error('workspace cwd is required')
  let cursor = path.resolve(cwd)
  while (true) {
    if (existsSync(path.join(cursor, '.agents', 'pangea', 'dsh.md'))) return cursor
    const parent = path.dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  throw new Error(`PANGEA workspace not found from: ${cwd}`)
}

function pythonExecutable(root) {
  if (typeof process.env.PANGEA_PYTHON === 'string' && process.env.PANGEA_PYTHON.trim() !== '') {
    return process.env.PANGEA_PYTHON
  }
  const candidates = process.platform === 'win32'
    ? [path.join(root, '.venv', 'Scripts', 'python.exe'), 'python']
    : [path.join(root, '.venv', 'bin', 'python'), 'python3']
  return candidates.find(candidate => !path.isAbsolute(candidate) || existsSync(candidate))
}

function parseEnvelope(stdout) {
  const lines = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const value = JSON.parse(lines[index])
      if (value?.api_version === '1.0' && typeof value.ok === 'boolean') return value
    } catch {
      // Only the CLI JSON envelope is accepted.
    }
  }
  throw new Error('PANGEA CLI did not return a JSON envelope')
}

export function runPangea({ cwd, args }) {
  const root = workspaceRoot(cwd)
  const executable = pythonExecutable(root)
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-m', 'pangea_agent.cli.main', ...args], {
      cwd: root,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONPATH: [path.join(root, 'src'), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('close', code => {
      try {
        const envelope = parseEnvelope(stdout)
        if (code !== 0 || envelope.ok !== true) {
          reject(new Error(envelope.error?.message ?? stderr.trim() ?? `PANGEA CLI exited with ${code}`))
          return
        }
        resolve(envelope.result)
      } catch (error) {
        reject(new Error(/页面文件太小|paging file is too small|WinError 1455/i.test(stderr) ? `Windows 提交内存不足，Python 尚未启动；请检查已提交内存、页面文件及残留进程。\n${stderr.trim()}` : stderr.trim() || error.message))
      }
    })
  })
}

export function dataRootFor(cwd, explicit) {
  if (typeof explicit === 'string' && explicit.trim() !== '') return path.resolve(explicit)
  return path.join(workspaceRoot(cwd), 'pangea-data')
}

function rpc(payload) { return { rpcId: `pangea-asset-${Date.now()}-${Math.random()}`, payload } }
function apiValue(response) {
  if (!response?.result?.ok) throw Object.assign(new Error(response?.result?.error?.message ?? 'DSH API request failed'), { code: response?.result?.error?.code })
  return response.result.value
}

const ACTIVE_JOB_STATUSES = new Set(['preparing', 'queued', 'running', 'repairing', 'finalizing', 'stopping'])
const CLOSED_JOB_STATUSES = new Set(['completed', 'failed', 'needs_attention', 'stopped', 'stopping'])
const PHASE_LABELS = {
  preparing: '正在准备资产内容', starting: '正在启动执行器', ready: '等待执行器就绪',
  queued: '任务已提交，等待模型处理', extracting: '正在提取资产内容',
  repairing: '正在修正提取结果', finalizing: '正在校验并保存提取结果',
  stopping: '正在停止提取', stopped: '提取已停止', completed: '提取结果已保存', failed: '提取未完成',
}

function cancelled(job) { return job.stopRequested || job.status === 'stopped' }
function checkActive(job) { if (cancelled(job)) throw new Error('资产提取已由用户停止') }
function errorText(error) { return error instanceof Error ? error.message : String(error) }
function pendingCleanup(job) { return Boolean(job.worker && job.cleanupPending && !job.cleanupConfirmed) }
function waitUnlessStopped(job, operation) {
  const signal = job.controller?.signal
  if (!signal) return Promise.resolve(operation)
  if (signal.aborted) { Promise.resolve(operation).catch(() => {}); return Promise.reject(signal.reason ?? new Error('资产提取已停止')) }
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('资产提取已停止'))
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(operation).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export class AssetActionRuntime {
  constructor(api, runner = runPangea, runtime = {}) {
    this.api = api
    this.runner = runner
    this.jobs = new Map()
    this.sessions = new Map()
    this.runtime = runtime
  }
  async executionOptions() {
    return internalModelOptions(this.api)
  }
  historyPath(dataRoot, assetId) {
    return path.join(path.resolve(dataRoot), '.pangea', 'asset-jobs', `${createHash('sha256').update(assetId).digest('hex')}.json`)
  }
  saved(dataRoot, assetId) {
    const file = this.historyPath(dataRoot, assetId)
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, 'utf8'))
  }
  current(job) {
    const current = this.jobs.get(`${path.resolve(job.dataRoot)}\n${job.assetId}`)
    return !current || current === job
  }
  snapshot(job) {
    return { status: pendingCleanup(job) && CLOSED_JOB_STATUSES.has(job.status) ? 'stopping' : job.status,
      started_at: job.startedAt, completed_at: job.completedAt,
      action_id: job.action?.action_id,
      session_id: job.ownerSessionId ?? job.sessionId, worker_id: job.sessionId,
      provider_id: job.providerId, model: job.model, output: `${job.output ?? ''}${job.streamText ?? ''}`,
      error: [job.error, job.storageError, job.backgroundError].filter(Boolean).join('；') || undefined,
      storage_error: job.storageError ?? null, background_error: job.backgroundError ?? null,
      phase: job.phase, phase_label: PHASE_LABELS[job.phase] ?? job.phase,
      phase_started_at: job.phaseStartedAt, last_activity_at: job.lastActivityAt,
      cleanup_confirmed: job.cleanupConfirmed ?? false,
      diagnostics: job.diagnostics ?? {},
      events: job.events ?? [], history: job.history ?? [] }
  }
  persist(job) {
    if (!this.current(job)) return this.snapshot(job)
    let temporary
    try {
      const file = this.historyPath(job.dataRoot, job.assetId)
      mkdirSync(path.dirname(file), { recursive: true })
      const value = this.snapshot({ ...job, storageError: null })
      temporary = `${file}.${randomUUID()}.tmp`
      writeFileSync(temporary, JSON.stringify(value), 'utf8')
      renameSync(temporary, file)
      job.storageError = null
      job.persistenceFailure = null
      return value
    } catch (error) {
      // Keep the original exception for awaited identity/stop boundaries. A
      // background observer may contain it without inventing a terminal state.
      let cleanupError = ''
      if (temporary) {
        try { rmSync(temporary, { force: true }) }
        catch (cleanup) { cleanupError = `；临时记录清理失败：${errorText(cleanup)}` }
      }
      job.persistenceFailure = error
      job.storageError = `运行记录保存失败：${errorText(error)}${cleanupError}`
      job.dirty = true
      throw error
    }
  }
  backgroundFailure(job, error) {
    if (!this.current(job)) return
    // Never write from this error path: the filesystem may still be blocked.
    if (job.persistenceFailure !== error) job.backgroundError = `后台处理需要关注：${errorText(error)}`
  }
  observeSafely(job, operation) {
    try { return operation() } catch (error) { this.backgroundFailure(job, error) }
  }
  capture(job) {
    if (!this.current(job)) return
    const output = job.worker?.readOutput?.()
    let changed = job.dirty ?? false
    if (output) { job.output = `${job.output ?? ''}${output}`; job.lastActivityAt = new Date().toISOString(); changed = true }
    const diagnostics = job.worker?.readDiagnostics?.()
    if (diagnostics) changed = this.observe(job, diagnostics, false) || changed
    if (changed) { this.persist(job); job.dirty = false }
  }
  observe(job, diagnostics, persist = true) {
    // Record protocol facts, never guess semantic progress from model text.
    const next = { ...(job.diagnostics ?? {}) }
    for (const key of ['stage', 'lastActivityAt', 'messageChunks', 'toolCalls', 'lastToolName', 'lastToolStatus', 'lastToolFinishedAt', 'activeToolCount', 'firstEventMs']) {
      if (diagnostics[key] !== undefined) next[key] = diagnostics[key]
    }
    const changed = JSON.stringify(next) !== JSON.stringify(job.diagnostics ?? {})
    if (changed) {
      job.diagnostics = next
      job.lastActivityAt = new Date().toISOString()
      if (persist) this.persist(job)
    }
    return changed
  }
  watch(job) {
    job.timer = setInterval(() => this.observeSafely(job, () => this.capture(job)), 1000)
    job.timer.unref?.()
  }
  record(job, label) {
    if (!this.current(job)) return this.snapshot(job)
    job.events ??= []
    job.events.push({ at: new Date().toISOString(), label })
    return this.persist(job)
  }
  phase(job, phase, label = PHASE_LABELS[phase]) {
    if (!this.current(job)) return this.snapshot(job)
    job.phase = phase
    job.phaseStartedAt = new Date().toISOString()
    job.lastActivityAt = job.phaseStartedAt
    return this.record(job, label)
  }
  view(value) {
    const end = value.completed_at ? Date.parse(value.completed_at) : Date.now()
    const started = Date.parse(value.started_at)
    const lastActivity = Date.parse(value.last_activity_at ?? value.started_at)
    const idleMs = Number.isFinite(lastActivity) ? Math.max(0, end - lastActivity) : 0
    return { ...value, elapsed_ms: Number.isFinite(started) ? Math.max(0, end - started) : 0, idle_ms: idleMs,
      warning: [value.storage_error, value.background_error,
        ACTIVE_JOB_STATUSES.has(value.status) && value.status !== 'stopping' && idleMs >= 180000
          ? `已 ${Math.floor(idleMs / 1000)} 秒未收到新的执行事件；可能正在等待模型或工具，可查看处理记录或手动停止。` : null,
      ].filter(Boolean).join('；') || null }
  }
  handleSessionEvent(session, event) {
    const job = this.sessions.get(session?.id)
    if (!job || !this.current(job) || CLOSED_JOB_STATUSES.has(job.status)) return
    if (event.type === 'assistant/chunk') {
      const chunk = event.data?.chunk
      if (!chunk || !['text-delta', 'reasoning-delta', 'tool-call-delta'].includes(chunk.type)) return
      if (job.status === 'queued') { job.status = 'running'; this.observeSafely(job, () => this.phase(job, 'extracting', '已收到模型输出，正在提取资产内容')) }
      job.lastActivityAt = new Date().toISOString()
      job.diagnostics = { ...(job.diagnostics ?? {}), messageChunks: (job.diagnostics?.messageChunks ?? 0) + 1 }
      // Stream public text immediately; reasoning chunks are activity only.
      if (chunk.type === 'text-delta') job.streamText = `${job.streamText ?? ''}${chunk.text ?? ''}`
      job.dirty = true
    } else if (event.type === 'assistant/message') {
      const content = event.data?.message?.content
      const text = typeof content === 'string' ? content : (content ?? []).filter(item => item.type === 'text').map(item => item.text).join('\n')
      if (text) { job.output = `${job.output ?? ''}${text}\n`; job.streamText = ''; job.lastActivityAt = new Date().toISOString(); this.observeSafely(job, () => this.persist(job)) }
    } else if (event.type === 'tool/call') {
      job.lastActivityAt = new Date().toISOString()
      job.diagnostics = { ...(job.diagnostics ?? {}), toolCalls: (job.diagnostics?.toolCalls ?? 0) + 1,
        lastToolName: event.data?.name, lastToolStatus: 'in_progress' }
      this.observeSafely(job, () => this.record(job, `正在使用工具：${event.data?.name ?? '工具'}`))
    } else if (event.type === 'tool/result') {
      job.lastActivityAt = new Date().toISOString()
      job.diagnostics = { ...(job.diagnostics ?? {}), lastToolStatus: event.data?.error ? 'failed' : 'completed' }
      this.observeSafely(job, () => this.record(job, event.data?.error ? '工具返回错误，等待模型处理' : '工具执行结束，模型继续处理'))
    }
  }
  job(dataRoot, assetId) {
    const job = this.jobs.get(`${path.resolve(dataRoot)}\n${assetId}`)
    if (!job) {
      const saved = this.saved(dataRoot, assetId)
      if (!saved) return null
      if (ACTIVE_JOB_STATUSES.has(saved.status)) return this.view({ ...saved, status: 'interrupted', error: '应用已重启，处理过程已保存。可以重新处理此资产。', session_available: false })
      return this.view({ ...saved, session_available: false })
    }
    this.observeSafely(job, () => this.capture(job))
    return this.view({ ...this.snapshot(job), session_available: Boolean(job.sessionId) })
  }

  async command(job, args) {
    checkActive(job)
    if (!this.current(job)) throw new Error('资产提取已被新的尝试替代')
    const pending = Promise.resolve().then(() => this.runner({ cwd: job.cwd, args }))
    job.commandPending = pending
    try { const result = await pending; checkActive(job); if (!this.current(job)) throw new Error('资产提取已被新的尝试替代'); return result }
    finally { if (job.commandPending === pending) job.commandPending = null }
  }

  async adapter(job, operation) {
    const args = ['adapter', operation, '--data-root', job.dataRoot, '--asset-id', job.assetId,
      '--action-id', job.action.action_id]
    if (operation === 'bind') args.push('--task-id', job.sessionId)
    return this.command(job, args)
  }
  async start({ cwd, dataRoot, assetId, providerId = '', model, agentModel, restart = false }) {
    const resolvedDataRoot = dataRootFor(cwd, dataRoot)
    const key = `${path.resolve(resolvedDataRoot)}\n${assetId}`
    const active = this.jobs.get(key)
    if (active && ACTIVE_JOB_STATUSES.has(this.snapshot(active).status)) {
      return { completed: false, reused: true, session_id: active.ownerSessionId ?? active.sessionId }
    }
    if (active?.commandPending || active?.cleanupPending) throw new Error('原资产提取仍在结束，请稍后重试')
    const previous = this.job(resolvedDataRoot, assetId)
    const job = { history: previous ? [...(previous.history ?? []), { ...previous, history: undefined }] : [], events: [], cwd, dataRoot: resolvedDataRoot, assetId, status: 'preparing', startedAt: new Date().toISOString(),
      worker: active?.worker, ownerSessionId: active?.ownerSessionId, providerId, model: providerId ? agentModel : model,
      controller: new AbortController() }
    job.setupDone = new Promise(resolve => { job.resolveSetup = resolve })
    this.jobs.set(key, job)
    clearInterval(active?.timer)
    try {
      this.phase(job, 'preparing')
      if (restart && active?.worker) await this.disposeWorker(active)
      const prepared = await this.command(job, ['assets', 'extract', '--data-root', resolvedDataRoot, '--asset-id', assetId, ...(restart ? ['--restart'] : [])])
      if (!prepared.action) {
        if (!['available', 'awaiting_review', 'no_items'].includes(prepared.asset?.status)) throw new Error('资产未完成提取且没有返回提取任务')
        job.status = 'completed'
        job.completedAt = new Date().toISOString()
        this.phase(job, 'completed', '资产处理完成')
        return { completed: true, asset: prepared.asset }
      }
      job.action = prepared.action
      job.sessionId = prepared.action.task_id || null
      if (!job.sessionId) { job.worker = null; job.ownerSessionId = null }
      else if (job.worker && String(job.worker.id) === job.sessionId && !active?.controller?.signal.aborted) job.controller = active?.controller ?? job.controller
      if (job.sessionId) {
        // A restart resumes the asset's persisted identity, never a guessed latest session.
        try {
          const settled = await this.adapter(job, 'settle')
          job.status = 'completed'
          job.completedAt = new Date().toISOString()
          this.record(job, '已接收保存的提取结果')
          return { completed: true, asset: settled.asset }
        } catch (error) { checkActive(job); job.repairReason = error.message }
      }
      if (providerId) {
        if (!acpProviderOption(providerId) || !this.runtime.subagents?.getProvider?.(providerId)) throw new Error('所选执行器不可用，请在资产解析设置中选择可用执行器')
        if (job.sessionId && (!job.worker || String(job.worker.id) !== job.sessionId)) throw new Error(`原资产会话不能由所选执行器续接：${job.sessionId}。请保持原执行器，不能替换已绑定会话。`)
        if (job.worker && (active.providerId !== providerId || active.model !== agentModel)) throw new Error('资产续接必须保持原执行器与模型')
      } else {
        // Explicitly configure the actual extraction session, never rely on
        // Desktop's intentionally empty agent-default-model route.
        job.model = await requireInternalModel(this.api, model)
        checkActive(job)
        if (job.worker) throw new Error('资产已绑定外部执行器，请保持原执行器续接')
      }
      if (!job.sessionId) {
        const root = workspaceRoot(cwd)
        let payload = { cwd: root }
        if (this.api.workspace?.list) {
          const workspace = apiValue(await this.api.workspace.list(rpc({}))).items.find(item => path.resolve(item.path) === root)
          checkActive(job)
          if (!workspace) throw new Error(`current DSH workspace is not registered: ${root}`)
          payload = { workspaceId: workspace.workspaceId }
        }
        job.ownerSessionId = apiValue(await this.api.sessions.create(rpc(payload))).sessionId
        if (!providerId) job.sessionId = job.ownerSessionId
        checkActive(job)
        apiValue(await this.api.sessions.rename(rpc({ sessionId: job.ownerSessionId, title: `资产提取 · ${prepared.asset.title ?? assetId}` })))
        checkActive(job)
        if (!providerId) await this.adapter(job, 'bind')
      }
      job.repairCount = 0
      const prompt = [
        providerId ? '你是资产提取 worker，直接读取下面的 task JSON，按其 result_schema_path 提取 extracted_text_path 和 attachments 中的原文；不调用插件工具、不创建 Run、不派发子 Agent。保留原文出处，不臆造需求或缺陷。'
          : `读取 ${path.join(workspaceRoot(cwd), '.agents', 'pangea', 'asset-extraction-worker.md')} 并执行。`,
        `task_path: ${job.action.task_path}`,
        `本次资产类型：${prepared.asset.asset_type}。每条 item_type 必须等于 task.asset_type；只提取该类型，不混合其他类型。`,
        '先读取 task.extraction_instructions 中当前类型的冻结方法和 task.result_schema_path。原文不支持当前类型时返回空 items 并说明，不机械转换类型、不编造内容。',
        '用中文简要说明正在读取的资料、提取进度和处理结果。只读取此 task 的输入，在 task 指定 result_path 写完整提取 JSON。宿主负责提交，不要另建 action 或运行分析。',
        ...(job.repairReason ? [`修正同一结果后完成：${job.repairReason}`] : []),
      ].join('\n')
      if (providerId) {
        job.status = 'queued'
        this.phase(job, 'starting', '已选择外部 Agent，正在启动')
        job.done = this.runExternal(job, prompt, agentModel).catch(error => this.backgroundFailure(job, error))
        return { completed: false, session_id: job.ownerSessionId, action: job.action }
      }
      apiValue(await this.api.sessions.selectModel(rpc({ sessionId: job.sessionId, provider: job.model.provider,
        model: job.model.model, ...(job.model.reasoning_effort ? { reasoningEffort: job.model.reasoning_effort } : {}) })))
      checkActive(job)
      this.sessions.set(job.sessionId, job)
      this.watch(job)
      this.record(job, '已绑定所选 API 模型')
      job.status = 'queued'
      job.promptDispatched = true
      apiValue(await this.api.sessions.prompt(rpc({ sessionId: job.sessionId, mode: 'queue', content: [{ type: 'text', text: prompt }] })))
      checkActive(job)
      // The prompt can synchronously emit running/idle events. Never overwrite
      // their newer phase with a stale queued response.
      if (job.status === 'queued') this.phase(job, 'queued')
      return { completed: false, session_id: job.sessionId, action: job.action }
    } catch (error) {
      if (cancelled(job)) throw new Error('资产提取已由用户停止')
      const failure = error.code === 'session-not-found'
        ? new Error(`原资产解析会话不存在：${job.sessionId}。已有结果已保留；可点击“重新处理资产”创建新的提取尝试。`, { cause: error }) : error
      job.error = errorText(failure)
      // A prompt may already be running when its acknowledgement or the next
      // observation write fails. Keep its slot and exact stop identity.
      if (!job.promptDispatched && !job.worker && !job.workerStartPending) {
        job.status = 'failed'; job.completedAt = new Date().toISOString()
      }
      this.observeSafely(job, () => this.phase(job, job.status, '资产处理未完成，需要查看错误或停止当前任务'))
      throw failure
    } finally { if (job.status === 'failed') clearInterval(job.timer); job.resolveSetup() }
  }
  async runExternal(job, prompt, agentModel) {
    try {
      checkActive(job)
      job.status = 'running'
      if (!job.worker) {
        const parent = this.runtime.agents?.get?.(job.ownerSessionId)
        if (!parent) throw new Error('资产提取的宿主会话不可用')
        job.workerStartPending = Promise.resolve(this.runtime.subagents.start(job.providerId, { parent, signal: job.controller.signal, label: `资产提取 · ${job.assetId}`,
          onDiagnostic: value => { if (!cancelled(job)) this.observeSafely(job, () => this.observe(job, value)) },
          prompt: [{ type: 'text', text: '等待宿主绑定资产任务，不读取文件或调用工具，只回复就绪并结束本轮。' }],
          ...(agentModel ? { agentOptions: { model: agentModel } } : {}) })).then(worker => { job.worker = worker; return worker })
        await waitUnlessStopped(job, job.workerStartPending)
        checkActive(job)
        if (!job.worker?.id || typeof job.worker.continuePrompt !== 'function') throw new Error('所选执行器不支持资产任务原会话续接')
        job.sessionId = String(job.worker.id)
        this.watch(job)
        this.phase(job, 'ready', 'Agent 已启动，等待初始化回合结束')
        await this.adapter(job, 'bind')
        const ready = await waitUnlessStopped(job, job.worker.result)
        checkActive(job)
        if (ready.stopReason !== 'completed') throw new Error(`资产会话初始化失败：${ready.stopReason} ${ready.diagnostic ?? ''}`)
      }
      this.phase(job, 'extracting')
      const result = await waitUnlessStopped(job, job.worker.continuePrompt([{ type: 'text', text: prompt }]))
      checkActive(job)
      if (result.stopReason !== 'completed') throw new Error(`资产提取未完成：${result.stopReason} ${result.diagnostic ?? ''}`)
      await this.finish(job)
      if (job.status === 'completed') await this.disposeWorker(job)
    } catch (error) {
      if (cancelled(job)) return
      job.error = errorText(error)
      try { if (job.worker) await this.disposeWorker(job) } catch (cleanup) { job.error += `；进程清理失败：${errorText(cleanup)}` }
      if (job.worker && !job.cleanupConfirmed) {
        job.status = 'stopping'; job.completedAt = undefined
      } else {
        job.status = 'failed'; job.completedAt = new Date().toISOString()
      }
    } finally {
      clearInterval(job.timer)
      this.observeSafely(job, () => this.capture(job))
      if (!cancelled(job)) this.observeSafely(job, () => this.phase(job, job.status, job.status === 'completed' ? '资产处理完成' : '资产处理未完成'))
    }
  }
  async finish(job) {
    if (!job || !this.current(job) || cancelled(job) || CLOSED_JOB_STATUSES.has(job.status) || job.status === 'finalizing') return
    job.status = 'finalizing'
    this.phase(job, 'finalizing')
    try { await this.adapter(job, 'settle'); job.status = 'completed' }
    catch (error) {
      if (cancelled(job) || !this.current(job)) return
      job.error = errorText(error)
      const typeMismatch = error.message.includes('提取结果类型与资产类型不一致')
      if (typeMismatch && !job.repairCount) {
        job.repairCount = 1
        job.status = 'repairing'
        this.phase(job, 'repairing', '条目类型不匹配，交回原会话修正一次')
        const content = [{ type: 'text', text: `修正当前资产的同一结果文件，不新建任务、不丢弃有效内容。task_path: ${job.action.task_path}。读取 task.asset_type、extraction_instructions 和 result_schema_path。${error.message}` }]
        try {
          if (job.worker) {
            const repaired = await waitUnlessStopped(job, job.worker.continuePrompt(content))
            checkActive(job)
            if (repaired.stopReason !== 'completed') throw new Error(`资产修正未完成：${repaired.stopReason}`)
            await this.finish(job)
          } else {
            job.status = 'queued'
            apiValue(await this.api.sessions.prompt(rpc({ sessionId: job.sessionId, mode: 'queue', content })))
          }
          return
        } catch (repairError) { if (cancelled(job)) return; error = repairError }
      }
      job.status = typeMismatch ? 'needs_attention' : 'failed'; job.error = error.message
    }
    if (job.status === 'completed') job.error = undefined
    job.completedAt = new Date().toISOString()
    clearInterval(job.timer)
    this.observeSafely(job, () => this.capture(job))
    this.observeSafely(job, () => this.phase(job, job.status === 'completed' ? 'completed' : 'failed', job.status === 'completed' ? '提取结果已保存' : '提取结果需要处理'))
  }
  handleAgentStatus(agent, status) {
    const job = this.sessions.get(agent?.session?.id)
    if (!job || !this.current(job) || cancelled(job) || CLOSED_JOB_STATUSES.has(job.status) || ['repairing', 'finalizing'].includes(job.status)) return
    if (status === 'running' && job.status !== 'running') { job.status = 'running'; this.observeSafely(job, () => this.phase(job, 'extracting', '模型正在处理资产')) }
    if (status === 'idle' && job.status === 'running') void this.finish(job).catch(error => this.backgroundFailure(job, error))
  }
  handleAgentError(agent, error) {
    const job = this.sessions.get(agent?.session?.id)
    if (!job || !this.current(job) || cancelled(job) || CLOSED_JOB_STATUSES.has(job.status) || job.status === 'finalizing') return
    job.status = 'failed'; job.error = error?.message ?? String(error); job.completedAt = new Date().toISOString()
    clearInterval(job.timer)
    this.observeSafely(job, () => this.phase(job, 'failed', '模型运行失败'))
  }

  async stop({ cwd, dataRoot, assetId }) {
    const resolvedDataRoot = dataRootFor(cwd, dataRoot)
    const key = `${path.resolve(resolvedDataRoot)}\n${assetId}`
    let job = this.jobs.get(key)
    if (job?.status === 'stopped' && !pendingCleanup(job)) return { stopped: true, job: this.job(resolvedDataRoot, assetId) }
    if (job?.status === 'completed' && !pendingCleanup(job)) return { stopped: false, completed: true, job: this.job(resolvedDataRoot, assetId) }
    if (job?.stopPromise) return job.stopPromise
    if (!job) {
      const saved = this.saved(resolvedDataRoot, assetId)
      if (saved?.status === 'completed' || saved?.status === 'stopped') return { stopped: saved.status === 'stopped', completed: saved.status === 'completed', job: this.view({ ...saved, session_available: false }) }
      job = { cwd, dataRoot: resolvedDataRoot, assetId, status: 'stopping', startedAt: saved?.started_at ?? new Date().toISOString(),
        ownerSessionId: saved?.session_id, sessionId: saved?.worker_id, providerId: saved?.provider_id, model: saved?.model,
        action: saved?.action_id ? { action_id: saved.action_id } : undefined,
        output: saved?.output, events: saved?.events ?? [], history: saved?.history ?? [], recovered: true, cleanupConfirmed: saved?.cleanup_confirmed }
      this.jobs.set(key, job)
    }
    job.stopRequested = true
    job.status = 'stopping'
    job.error = undefined
    // Observation failures must not prevent cancellation of a known worker.
    // The final stop record remains an awaited, mandatory save below.
    this.observeSafely(job, () => this.phase(job, 'stopping'))
    job.controller?.abort(new Error('用户停止资产提取'))
    const stop = async () => {
      try {
        // An in-flight prepare/settle must reach its atomic boundary before the
        // durable pause. No later command is allowed past checkActive().
        await this.stopWait(job.commandPending?.catch(() => {}))
        const result = await this.stopWait(this.runner({ cwd, args: ['assets', 'stop', '--data-root', resolvedDataRoot, '--asset-id', assetId,
          ...(job.action?.action_id ? ['--action-id', job.action.action_id] : [])] }))
        const cancelledSessions = new Set()
        const cancelSession = async () => {
          if (!job.sessionId || job.providerId || cancelledSessions.has(job.sessionId)) return
          const sessionId = job.sessionId
          try { apiValue(await this.stopWait(this.api.sessions.cancel(rpc({ sessionId })))) }
          catch (error) { if (error.code !== 'session-not-found') throw error }
          const agent = this.runtime.agents?.get?.(sessionId)
          if (agent?.whenIdle) await this.stopWait(agent.whenIdle())
          cancelledSessions.add(sessionId)
        }
        // A blocked prompt response must not prevent cancelling the session
        // that is already known. Check again for a late create() response.
        await cancelSession()
        await this.stopWait(job.setupDone)
        await cancelSession()
        if (job.workerStartPending) await this.stopWait(job.workerStartPending.catch(() => {}))
        if (job.worker) {
          if (typeof job.worker.dispose !== 'function') throw new Error('执行器没有提供停止接口')
          await this.stopWait(this.disposeWorker(job))
        } else if (job.recovered && job.providerId && !job.cleanupConfirmed) throw new Error('提取结果提交已冻结，但原外部执行器句柄不可用，无法确认进程已结束')
        job.completedAt = new Date().toISOString()
        const asset = result?.asset ?? result
        // A settle that already committed wins its atomic boundary; stopping
        // does not remove a successfully saved result.
        const completed = ['available', 'awaiting_review', 'no_items'].includes(asset?.status)
        job.status = completed ? 'completed' : 'stopped'
        clearInterval(job.timer)
        this.capture(job)
        this.phase(job, job.status)
        return { stopped: !completed, completed, asset, job: this.job(resolvedDataRoot, assetId) }
      } catch (error) {
        job.status = 'stopping'
        job.completedAt = undefined
        job.error = `停止尚未确认：${error.message}。可重试停止。`
        this.observeSafely(job, () => this.record(job, '停止未完成，保留当前任务'))
        throw Object.assign(new Error(job.error, { cause: error }), { code: error?.code })
      }
    }
    job.stopPromise = stop()
    try { return await job.stopPromise } finally { job.stopPromise = null }
  }
  async stopWait(promise) {
    let timer
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('等待执行器结束超时')), this.runtime.stopTimeoutMs ?? 15000)
      })])
    } finally { clearTimeout(timer) }
  }
  async disposeWorker(job) {
    if (job.cleanupPending) return job.cleanupPending
    if (job.cleanupConfirmed) { this.persist(job); return }
    job.cleanupPending = Promise.resolve().then(() => job.worker.dispose())
    try { await job.cleanupPending; job.cleanupConfirmed = true; this.persist(job) }
    finally { job.cleanupPending = null }
  }
}

export { workspaceRoot }
