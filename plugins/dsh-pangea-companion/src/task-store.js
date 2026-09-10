import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const STORE_VERSION = 1
const WINDOWS_RENAME_RETRY_DELAYS = Object.freeze([50, 100, 200, 400, 800])
const DEFAULT_FILE_OPERATIONS = Object.freeze({ mkdir, rename, rm, writeFile })

function wait(delay) {
  return new Promise(resolve => setTimeout(resolve, delay))
}

function errorCode(error) {
  return typeof error?.code === 'string' && error.code ? error.code : 'UNKNOWN'
}

function taskStoreWriteError(stage, storePath, temporary, error, attempts = 1) {
  const code = errorCode(error)
  return Object.assign(new Error(
    `任务存储发布失败：stage=${stage}，code=${code}，attempts=${attempts}，target=${storePath}，temporary=${temporary}：${error instanceof Error ? error.message : String(error)}`,
    { cause: error }
  ), { code })
}

export async function writeTaskStoreFile(storePath, content, options = {}) {
  const operations = options.operations ?? DEFAULT_FILE_OPERATIONS
  const platform = options.platform ?? process.platform
  const retryDelays = options.retryDelays ?? WINDOWS_RENAME_RETRY_DELAYS
  const pause = options.wait ?? wait
  const temporary = `${storePath}.${process.pid}.${randomUUID()}.tmp`
  let stage = 'mkdir'
  let attempts = 0
  try {
    await operations.mkdir(path.dirname(storePath), { recursive: true })
    stage = 'write'
    await operations.writeFile(temporary, content, 'utf8')
    stage = 'rename'
    while (true) {
      attempts += 1
      try {
        await operations.rename(temporary, storePath)
        return
      } catch (error) {
        const retryable = platform === 'win32'
          && ['EPERM', 'EBUSY', 'EACCES'].includes(errorCode(error))
          && attempts <= retryDelays.length
        if (!retryable) throw taskStoreWriteError(stage, storePath, temporary, error, attempts)
        await pause(retryDelays[attempts - 1])
      }
    }
  } catch (error) {
    let failure = error
    if (!(error instanceof Error) || !error.message.startsWith('任务存储发布失败：')) {
      failure = taskStoreWriteError(stage, storePath, temporary, error, Math.max(attempts, 1))
    }
    try {
      await operations.rm(temporary, { force: true })
    } catch (cleanupError) {
      failure.message += `；临时文件清理失败：code=${errorCode(cleanupError)}：${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
    }
    throw failure
  }
}

function defaultStorePath() {
  const configured = process.env.DSH_HOME
  const root = typeof configured === 'string' && configured.trim() !== ''
    ? path.resolve(configured)
    : path.join(homedir(), '.dsh')
  return path.join(root, 'dsh-pangea-companion', 'tasks-v1.json')
}

function emptyStore() {
  return { version: STORE_VERSION, tasks: {} }
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

function strings(value) {
  return Array.isArray(value)
    ? [...new Set(value.map(item => text(item)).filter(Boolean))]
    : []
}

function normalizeConversation(value) {
  const sessionId = text(value?.session_id)
  if (!sessionId) return null
  return {
    conversation_id: text(value?.conversation_id, sessionId),
    session_id: sessionId,
    title: text(value?.title, '任务会话'),
    kind: ['analysis', 'architecture'].includes(value?.kind) ? value.kind : 'assistant',
    created_at: Number.isFinite(value?.created_at) ? value.created_at : null,
  }
}

function normalizeModelRoute(value) {
  const provider = text(value?.provider)
  const model = text(value?.model)
  if (!provider || !model) return null
  const reasoningEffort = text(value?.reasoning_effort)
  return {
    provider,
    model,
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    route_class: value?.route_class === 'external-acp' ? 'external-acp' : 'configured-internal',
  }
}

function normalizeAttempt(value) {
  const jobId = text(value?.job_id)
  const attemptId = text(value?.attempt_id) || (jobId ? `legacy-${jobId}` : '')
  if (!attemptId) return null
  const executionStatus = ['queued', 'starting', 'running', 'stopping', 'completed', 'failed', 'stopped', 'interrupted'].includes(value?.execution_status)
    ? value.execution_status
    : null
  return {
    attempt_id: attemptId,
    job_id: jobId || null,
    provider: text(value?.provider) || null,
    owner_session_id: text(value?.owner_session_id) || null,
    runtime_instance_id: text(value?.runtime_instance_id) || null,
    job_started_at: Number.isFinite(value?.job_started_at) ? value.job_started_at : null,
    agent_session_id: text(value?.agent_session_id) || null,
    execution_status: executionStatus,
    terminal_error: text(value?.terminal_error) || null,
    last_output: text(value?.last_output) || null,
    last_activity_at: Number.isFinite(value?.last_activity_at) ? value.last_activity_at : null,
    started_at: Number.isFinite(value?.started_at) ? value.started_at : null,
    ended_at: Number.isFinite(value?.ended_at) ? value.ended_at : null,
  }
}

function normalizeTask(taskId, value) {
  const conversations = Array.isArray(value?.conversations)
    ? value.conversations.map(normalizeConversation).filter(Boolean)
    : []
  const attempts = Array.isArray(value?.attempts)
    ? value.attempts.map(normalizeAttempt).filter(Boolean)
    : []
  if (attempts.length === 0 && value?.job_id) {
    const legacyAttempt = normalizeAttempt({
      attempt_id: value?.attempt_id,
      job_id: value.job_id,
      provider: value.provider,
      owner_session_id: value.owner_session_id,
      runtime_instance_id: value.runtime_instance_id,
      job_started_at: value.job_started_at,
      agent_session_id: value.agent_session_id,
      execution_status: value.execution_status,
      terminal_error: value.terminal_error,
      last_output: value.last_output,
      last_activity_at: value.last_activity_at,
      started_at: value.launch_started_at,
    })
    if (legacyAttempt) attempts.push(legacyAttempt)
  }
  return {
    task_id: taskId,
    request_version: value?.request_version === '2.0' ? '2.0' : null,
    workflow_version: ['legacy-v1', 'source-first-v1'].includes(value?.workflow_version) ? value.workflow_version : null,
    workspace: text(value?.workspace),
    data_root: text(value?.data_root) || null,
    title: text(value?.title, text(value?.target, taskId)),
    source_task_id: text(value?.source_task_id) || null,
    repository: text(value?.repository),
    target: text(value?.target),
    scenario: text(value?.scenario, 'module-analysis'),
    mode: value?.mode === 'speed' ? 'speed' : 'depth',
    source_scope: strings(value?.source_scope),
    effective_context_budget: Number.isInteger(value?.effective_context_budget) ? value.effective_context_budget : undefined,
    focus: strings(value?.focus),
    coverage_input: value?.scenario === 'coverage-analysis' ? value?.coverage_input ?? null : null,
    asset_ids: strings(value?.asset_ids),
    test_case_examples: strings(value?.test_case_examples),
    model_route: normalizeModelRoute(value?.model_route),
    agent_model: text(value?.agent_model) || null,
    provider: text(value?.provider) || null,
    job_id: text(value?.job_id) || null,
    attempt_id: text(value?.attempt_id) || attempts.at(-1)?.attempt_id || null,
    owner_session_id: text(value?.owner_session_id) || null,
    runtime_instance_id: text(value?.runtime_instance_id) || null,
    job_started_at: Number.isFinite(value?.job_started_at) ? value.job_started_at : null,
    agent_session_id: text(value?.agent_session_id) || null,
    process_id: Number.isInteger(value?.process_id) && value.process_id > 0 ? value.process_id : null,
    execution_status: ['queued', 'starting', 'running', 'stopping', 'completed', 'failed', 'stopped', 'interrupted'].includes(value?.execution_status)
      ? value.execution_status
      : null,
    terminal_error: text(value?.terminal_error) || null,
    last_activity_at: Number.isFinite(value?.last_activity_at) ? value.last_activity_at : null,
    last_output: text(value?.last_output) || null,
    status: ['preparing', 'running', 'needs_attention', 'completed', 'stopped', 'failed'].includes(value?.status)
      ? value.status
      : 'preparing',
    run_id: text(value?.run_id) || null,
    launch_error: text(value?.launch_error) || null,
    launch_error_code: text(value?.launch_error_code) || null,
    launch_started_at: Number.isFinite(value?.launch_started_at) ? value.launch_started_at : null,
    launch_attempts: Number.isInteger(value?.launch_attempts) && value.launch_attempts >= 0 ? value.launch_attempts : 0,
    conversations,
    attempts,
    host_review: value?.host_review && typeof value.host_review === 'object' ? structuredClone(value.host_review) : null,
    active_conversation_id: text(value?.active_conversation_id) || conversations[0]?.conversation_id || null,
    created_at: Number.isFinite(value?.created_at) ? value.created_at : null,
    updated_at: Number.isFinite(value?.updated_at) ? value.updated_at : null,
  }
}

function normalizeJobRef(value, options = {}) {
  const source = typeof value === 'string' ? { jobId: value, ...(typeof options === 'number' ? { jobStartedAt: options } : options) } : value
  return {
    jobId: text(source?.jobId ?? source?.job_id),
    attemptId: text(source?.attemptId ?? source?.attempt_id) || null,
    ownerSessionId: text(source?.ownerSessionId ?? source?.owner_session_id) || null,
    jobStartedAt: Number.isFinite(source?.jobStartedAt ?? source?.job_started_at) ? (source.jobStartedAt ?? source.job_started_at) : null,
    runtimeInstanceId: text(source?.runtimeInstanceId ?? source?.runtime_instance_id) || null,
    agentSessionId: text(source?.agentSessionId ?? source?.agent_session_id) || null,
  }
}

function attemptMatches(attempt, ref) {
  if (!attempt || (ref.jobId && attempt.job_id !== ref.jobId)) return false
  if (ref.attemptId && attempt.attempt_id !== ref.attemptId) return false
  if (ref.ownerSessionId && attempt.owner_session_id !== ref.ownerSessionId) return false
  if (Number.isFinite(ref.jobStartedAt) && attempt.job_started_at !== ref.jobStartedAt) return false
  if (ref.runtimeInstanceId && attempt.runtime_instance_id !== ref.runtimeInstanceId) return false
  if (ref.agentSessionId && attempt.agent_session_id !== ref.agentSessionId) return false
  return true
}

function findAttempt(task, value, options = {}) {
  const ref = normalizeJobRef(value, options)
  if (!ref.jobId) return null
  const attempts = task.attempts.filter(attempt => attemptMatches(attempt, ref))
  if (attempts.length === 1) return attempts[0]
  if (attempts.length > 1 && (ref.attemptId || ref.ownerSessionId || ref.runtimeInstanceId || ref.agentSessionId)) return null
  if (attempts.length > 1) return null
  if (task.job_id === ref.jobId && !task.attempts.length) return task
  return null
}

function taskMatchesJob(task, value, options = {}) {
  const ref = normalizeJobRef(value, options)
  if (!ref.jobId) return false
  return Boolean(findAttempt(task, ref)) || (!task.attempts.length && task.job_id === ref.jobId)
}

function taskStatusFromRun(run) {
  const lifecycle = text(run?.lifecycle_status).toLowerCase()
  const status = text(run?.status).toLowerCase()
  const quality = text(run?.quality_status).toUpperCase()
  const phase = text(run?.phase).toUpperCase()
  if (['stopped', 'cancelled'].includes(lifecycle)) return 'stopped'
  if (lifecycle === 'failed') return 'failed'
  if (
    run?.attention_required === true
    || lifecycle === 'attention_required'
    || status === 'attention_required'
    || quality === 'REWORK'
    || quality === 'UNRESOLVED'
    || phase === 'INCOMPLETE'
    || phase === 'ATTENTION_REQUIRED'
    || (run?.errors?.length ?? 0) > 0
  ) return 'needs_attention'
  if (lifecycle === 'complete' || phase === 'COMPLETE') return 'completed'
  return 'running'
}

export class TaskStore {
  constructor({ storePath = defaultStorePath(), now = () => Date.now(), idFactory, attemptIdFactory, writeStore = writeTaskStoreFile } = {}) {
    this.storePath = storePath
    this.now = now
    this.idFactory = idFactory ?? (() => {
      const stamp = new Date(this.now()).toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
      return `task-${stamp}-${randomUUID().slice(0, 6)}`
    })
    this.attemptIdFactory = attemptIdFactory ?? (() => `attempt-${randomUUID()}`)
    this.writeStore = writeStore
    this.store = emptyStore()
    this.saveQueue = Promise.resolve()
    this.ready = this.load()
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.storePath, 'utf8'))
      if (parsed?.version !== STORE_VERSION || !parsed.tasks || typeof parsed.tasks !== 'object') return
      const tasks = {}
      for (const [taskId, value] of Object.entries(parsed.tasks)) tasks[taskId] = normalizeTask(taskId, value)
      this.store = { version: STORE_VERSION, tasks }
    } catch (error) {
      if (error?.code !== 'ENOENT') console.warn('[dsh-pangea-companion] task history could not be loaded:', error)
    }
  }

  async create({ workspace, dataRoot, input }) {
    await this.ready
    const root = text(workspace)
    const repository = text(input?.repository)
    const target = text(input?.target)
    if (!root) throw new Error('workspace is required')
    if (!repository) throw new Error('repository is required')
    if (!target) throw new Error('target is required')
    let taskId = this.idFactory()
    while (this.store.tasks[taskId]) taskId = this.idFactory()
    const time = this.now()
    const task = normalizeTask(taskId, {
      workspace: root,
      data_root: text(dataRoot) || null,
      title: target,
      workflow_version: input?.workflow_version,
      effective_context_budget: input?.effective_context_budget,
      focus: input?.focus,
      source_task_id: input?.source_task_id,
      request_version: '2.0',
      repository,
      target,
      scenario: input?.scenario,
      mode: input?.mode,
      source_scope: input?.source_scope,
      coverage_input: input?.coverage_input,
      asset_ids: input?.asset_ids,
      test_case_examples: input?.test_case_examples,
      model_route: input?.model_route,
      provider: input?.provider_id ?? input?.provider,
      agent_model: input?.provider_id ? input?.agent_model : null,
      status: 'preparing',
      created_at: time,
      updated_at: time,
    })
    this.store.tasks[taskId] = task
    try {
      await this.persistQueued()
    } catch (error) {
      if (this.store.tasks[taskId] === task) delete this.store.tasks[taskId]
      throw error
    }
    return structuredClone(task)
  }

  async list({ workspace } = {}) {
    await this.ready
    const root = text(workspace)
    return Object.values(this.store.tasks)
      .filter(task => !root || task.workspace === root)
      .sort((left, right) => (right.updated_at ?? 0) - (left.updated_at ?? 0))
      .map(task => structuredClone(task))
  }

  async get(taskId) {
    await this.ready
    const task = this.store.tasks[text(taskId)]
    return task ? structuredClone(task) : null
  }

  async getBySession(sessionId) {
    await this.ready
    const id = text(sessionId)
    if (!id) return null
    const task = Object.values(this.store.tasks).find(item => item.conversations.some(conversation => conversation.session_id === id))
    return task ? structuredClone(task) : null
  }

  async getByRun(runId, { dataRoot } = {}) {
    await this.ready
    const id = text(runId)
    const root = text(dataRoot)
    if (!id) return null
    const matches = Object.values(this.store.tasks).filter(item => (
      item.run_id === id
      && (!root || (item.data_root && path.resolve(item.data_root) === path.resolve(root)))
    ))
    if (matches.length > 1) throw new Error(`ambiguous Task binding for Run: ${id}`)
    return matches[0] ? structuredClone(matches[0]) : null
  }

  async addConversation(taskId, { sessionId, title, kind = 'assistant', activate = true }) {
    await this.ready
    const task = this.requireTask(taskId)
    const id = text(sessionId)
    if (!id) throw new Error('session_id is required')
    let conversation = task.conversations.find(item => item.session_id === id)
    if (!conversation) {
      conversation = normalizeConversation({
        conversation_id: id,
        session_id: id,
        title,
        kind,
        created_at: this.now(),
      })
      task.conversations.push(conversation)
    }
    if (activate) task.active_conversation_id = conversation.conversation_id
    if (kind === 'analysis') task.status = 'preparing'
    task.updated_at = this.now()
    if (kind === 'analysis') {
      task.launch_error = null
      task.launch_error_code = null
    }
    await this.persistQueued()
    return structuredClone(task)
  }

  async prepareLaunch(taskId, modelRoute) {
    await this.ready
    const task = this.requireTask(taskId)
    const selected = normalizeModelRoute(modelRoute)
    if (!selected) throw new Error('请选择一个已配置的内部模型')
    this.prepareAttempt(task, selected.provider)
    task.model_route = selected
    task.provider = null
    task.status = 'preparing'
    task.launch_error = null
    task.launch_error_code = null
    task.launch_started_at = this.now()
    task.launch_attempts += 1
    task.updated_at = this.now()
    await this.persistQueued()
    return structuredClone(task)
  }

  async prepareProviderLaunch(taskId, provider) {
    await this.ready
    const task = this.requireTask(taskId)
    const selected = text(provider)
    if (!selected) throw new Error('请选择一个 ACP 执行 Agent')
    this.prepareAttempt(task, selected)
    if (task.provider !== selected) task.agent_model = null
    task.provider = selected
    task.model_route = null
    task.status = 'preparing'
    task.execution_status = 'starting'
    task.terminal_error = null
    task.launch_error = null
    task.launch_error_code = null
    task.launch_started_at = this.now()
    task.launch_attempts += 1
    task.updated_at = this.now()
    await this.persistQueued()
    return structuredClone(task)
  }

  prepareAttempt(task, provider) {
    const now = this.now()
    const attemptId = text(this.attemptIdFactory()) || `attempt-${randomUUID()}`
    const attempt = normalizeAttempt({
      attempt_id: attemptId,
      provider,
      execution_status: 'starting',
      started_at: now,
      last_activity_at: now,
    })
    task.attempts.push(attempt)
    task.attempt_id = attemptId
    task.job_id = null
    task.owner_session_id = null
    task.runtime_instance_id = null
    task.job_started_at = null
    task.agent_session_id = null
    task.process_id = null
    task.execution_status = 'starting'
    task.terminal_error = null
    task.last_output = null
    task.last_activity_at = now
    task.status = 'preparing'
    return attempt
  }

  async bindJob(taskId, { jobId, provider, ownerSessionId, runtimeInstanceId, attemptId, agentSessionId, jobStartedAt, startedAt }) {
    jobStartedAt ??= startedAt
    await this.ready
    const task = this.requireTask(taskId)
    const job = text(jobId)
    if (!job) throw new Error('job_id is required')
    const now = this.now()
    const id = text(attemptId) || task.attempt_id || this.attemptIdFactory()
    const previousAttempt = task.attempts.find(item => item.attempt_id === id)
    const preservedStopping = previousAttempt?.execution_status === 'stopping'
    const bindCurrent = !task.attempt_id || task.attempt_id === id
    const attempt = normalizeAttempt({
      attempt_id: id,
      job_id: job,
      provider,
      owner_session_id: ownerSessionId,
      runtime_instance_id: runtimeInstanceId,
      job_started_at: jobStartedAt,
      agent_session_id: agentSessionId,
      execution_status: preservedStopping ? 'stopping' : 'running',
      last_activity_at: now,
      started_at: previousAttempt?.started_at ?? now,
    })
    task.attempts = task.attempts.filter(item => item.attempt_id !== id)
    task.attempts.push(attempt)
    if (bindCurrent) {
      task.attempt_id = id
      task.job_id = job
      task.provider = text(provider) || task.provider
      task.owner_session_id = text(ownerSessionId) || task.owner_session_id
      task.runtime_instance_id = text(runtimeInstanceId) || task.runtime_instance_id
      task.job_started_at = Number.isFinite(jobStartedAt) ? jobStartedAt : task.job_started_at
      task.agent_session_id = text(agentSessionId) || task.agent_session_id
      task.execution_status = preservedStopping ? 'stopping' : 'running'
      if (!preservedStopping) task.status = 'running'
      task.last_activity_at = now
    }
    task.updated_at = this.now()
    await this.persistQueued()
    return structuredClone(task)
  }

  async bindOwnerSession(taskId, { ownerSessionId, attemptId }) {
    await this.ready
    const task = this.requireTask(taskId)
    const id = text(attemptId) || task.attempt_id
    const attempt = id ? task.attempts.find(item => item.attempt_id === id) : null
    if (!attempt || !text(ownerSessionId)) return structuredClone(task)
    attempt.owner_session_id = text(ownerSessionId)
    if (attempt.attempt_id === task.attempt_id) task.owner_session_id = attempt.owner_session_id
    task.updated_at = this.now()
    await this.persistQueued()
    return structuredClone(task)
  }

  async getByJob(jobId, options = {}) {
    await this.ready
    const ref = normalizeJobRef(jobId, options)
    if (!ref.jobId) return null
    const matches = Object.values(this.store.tasks).filter(item => taskMatchesJob(item, ref))
    const task = matches.length === 1 ? matches[0] : null
    return task ? structuredClone(task) : null
  }

  async bindAgentRuntime(taskId, { agentSessionId, processId, attemptId }) {
    await this.ready
    const task = this.requireTask(taskId)
    const id = text(attemptId) || task.attempt_id
    const attempt = id ? task.attempts.find(item => item.attempt_id === id) : null
    const now = this.now()
    if (attempt) {
      attempt.agent_session_id = text(agentSessionId) || attempt.agent_session_id
      attempt.last_activity_at = now
      if (attempt.attempt_id === task.attempt_id) {
        task.agent_session_id = text(agentSessionId) || task.agent_session_id
        task.process_id = Number.isInteger(processId) && processId > 0 ? processId : task.process_id
        task.last_activity_at = now
      }
    }
    if (!attempt) return structuredClone(task)
    task.updated_at = this.now()
    await this.persistQueued()
    return structuredClone(task)
  }

  async recordReview(taskId, value) {
    await this.ready
    const task = this.requireTask(taskId)
    if (value.task_id !== task.task_id || value.run_id !== task.run_id || value.attempt_id !== task.attempt_id
      || !value.data_root || !task.data_root || path.resolve(value.data_root) !== path.resolve(task.data_root)
      || (value.producer_session_id && value.producer_session_id !== task.agent_session_id)) {
      throw new Error('宿主复核与当前任务/Run/Producer 绑定不成立')
    }
    task.host_review = { ...structuredClone(value), job_id: task.job_id, owner_session_id: task.owner_session_id }
    task.updated_at = this.now()
    await this.persistQueued()
    return structuredClone(task)
  }

  async recordJobActivity(jobId, output, options = {}) {
    await this.ready
    const ref = normalizeJobRef(jobId, options)
    const matches = Object.values(this.store.tasks).filter(item => taskMatchesJob(item, ref))
    const task = matches.length === 1 ? matches[0] : null
    if (!task) return null
    const attempt = findAttempt(task, ref)
    const chunk = typeof output === 'string' ? output : ''
    if (attempt && chunk) attempt.last_output = `${attempt.last_output ?? ''}${chunk}`.slice(-8192)
    if (attempt) attempt.last_activity_at = this.now()
    if (attempt?.attempt_id === task.attempt_id) {
      if (chunk) task.last_output = `${task.last_output ?? ''}${chunk}`.slice(-8192)
      task.last_activity_at = this.now()
    }
    task.updated_at = this.now()
    await this.persistQueued()
    return structuredClone(task)
  }

  async settleJob(jobId, snapshot, options = {}) {
    if (Number.isFinite(snapshot?.startedAt) && !options.jobStartedAt) options = { ...options, jobStartedAt: snapshot.startedAt }
    await this.ready
    const ref = normalizeJobRef(jobId, options)
    const matches = Object.values(this.store.tasks).filter(item => taskMatchesJob(item, ref))
    const task = matches.length === 1 ? matches[0] : null
    if (!task) return null
    const attempt = findAttempt(task, ref)
    if (attempt && ['completed', 'failed', 'stopped', 'interrupted'].includes(attempt.execution_status)) return structuredClone(task)
    const status = snapshot?.status === 'completed' ? 'completed' : snapshot?.status === 'killed' ? 'stopped' : 'failed'
    const attentionRequired = status === 'failed' && snapshot?.attention_required === true
    const ended = this.now()
    if (attempt) {
      attempt.execution_status = status
      attempt.terminal_error = status === 'failed' ? text(snapshot?.detail, 'ACP Agent 执行失败') : null
      attempt.ended_at = ended
      attempt.last_activity_at = ended
    }
    if (attempt?.attempt_id === task.attempt_id) {
      task.execution_status = status
      if (status === 'completed') task.status = 'completed'
      else task.status = attentionRequired ? 'needs_attention' : status
      task.terminal_error = status === 'failed' ? text(snapshot?.detail, 'ACP Agent 执行失败') : null
      task.launch_error = task.terminal_error
      task.launch_error_code = attentionRequired
        ? text(snapshot?.attention_code, 'RUN_ATTENTION_REQUIRED')
        : status === 'failed' ? 'ACP_AGENT_FAILED' : null
      task.last_activity_at = ended
    }
    task.updated_at = this.now()
    await this.persistQueued()
    return structuredClone(task)
  }

  async markLaunchFailed(taskId, error, code) {
    await this.ready
    const task = this.requireTask(taskId)
    task.status = 'failed'
    task.execution_status = 'failed'
    task.launch_error = text(error, '无法启动分析')
    task.launch_error_code = text(code) || null
    const attempt = task.attempts.find(item => item.attempt_id === task.attempt_id)
    if (attempt) {
      attempt.execution_status = 'failed'
      attempt.terminal_error = task.launch_error
      attempt.ended_at = this.now()
      attempt.last_activity_at = attempt.ended_at
    }
    task.updated_at = this.now()
    await this.persistQueued()
    return structuredClone(task)
  }

  async markStopping(taskId, error = null) {
    await this.ready
    const task = this.requireTask(taskId)
    if (['completed', 'failed', 'stopped', 'interrupted'].includes(task.execution_status)) return structuredClone(task)
    task.execution_status = 'stopping'
    if (error) task.launch_error = text(error)
    const attempt = task.attempts.find(item => item.attempt_id === task.attempt_id)
    if (attempt && !['completed', 'failed', 'stopped', 'interrupted'].includes(attempt.execution_status)) {
      attempt.execution_status = 'stopping'
      if (error) attempt.terminal_error = text(error)
      attempt.last_activity_at = this.now()
    }
    task.last_activity_at = this.now()
    task.updated_at = this.now()
    await this.persistQueued()
    return structuredClone(task)
  }

  async markStopped(taskId, error = null) {
    await this.ready
    const task = this.requireTask(taskId)
    if (['completed', 'failed', 'interrupted', 'stopped'].includes(task.execution_status)) return structuredClone(task)
    task.status = 'stopped'
    task.execution_status = 'stopped'
    task.launch_error = text(error) || null
    task.launch_error_code = text(error) ? 'STOP_FAILED' : null
    const attempt = task.attempts.find(item => item.attempt_id === task.attempt_id)
    if (attempt) {
      attempt.execution_status = 'stopped'
      attempt.terminal_error = text(error) || null
      attempt.ended_at = this.now()
      attempt.last_activity_at = attempt.ended_at
    }
    task.updated_at = this.now()
    await this.persistQueued()
    return structuredClone(task)
  }

  async markInterrupted(taskId, error) {
    await this.ready
    const task = this.requireTask(taskId)
    task.status = 'failed'
    task.execution_status = 'interrupted'
    task.terminal_error = text(error, 'ACP Job 已丢失，无法证明外部 Agent 仍在运行')
    task.launch_error = task.terminal_error
    task.launch_error_code = 'ACP_JOB_LOST'
    task.last_activity_at = this.now()
    const attempt = task.attempts.find(item => item.attempt_id === task.attempt_id)
    if (attempt) {
      attempt.execution_status = 'interrupted'
      attempt.terminal_error = task.terminal_error
      attempt.ended_at = task.last_activity_at
      attempt.last_activity_at = task.last_activity_at
    }
    task.updated_at = this.now()
    await this.persistQueued()
    return structuredClone(task)
  }

  // A portable install can move the repository without changing the durable
  // task/run identity.  The stop endpoint may explicitly prove the target by
  // supplying both task_id and its run_id; in that narrow case it can rebind
  // the task to the current workspace so the stopped history remains visible.
  async rebindWorkspace(taskId, workspace) {
    await this.ready
    const task = this.requireTask(taskId)
    const root = text(workspace)
    if (!root) throw new Error('workspace is required')
    if (task.workspace === root) return structuredClone(task)
    task.workspace = root
    task.updated_at = this.now()
    await this.persistQueued()
    return structuredClone(task)
  }

  async activateConversation(taskId, conversationId) {
    await this.ready
    const task = this.requireTask(taskId)
    const id = text(conversationId)
    const conversation = task.conversations.find(item => item.conversation_id === id)
    if (!conversation) throw new Error(`conversation not found: ${conversationId}`)
    task.active_conversation_id = conversation.conversation_id
    task.updated_at = this.now()
    await this.persistQueued()
    return structuredClone(task)
  }

  async bindRunBySession(sessionId, run) {
    await this.ready
    const id = text(sessionId)
    const runId = text(run?.run_id)
    if (!id || !runId) return null
    const task = Object.values(this.store.tasks).find(item => item.conversations.some(conversation => conversation.session_id === id))
    if (!task) return null
    if (task.run_id && task.run_id !== runId) return structuredClone(task)
    task.run_id = runId
    if (['legacy-v1', 'source-first-v1'].includes(run?.workflow_version)) task.workflow_version = run.workflow_version
    task.status = taskStatusFromRun(run)
    task.launch_error = task.status === 'needs_attention' ? text(run?.error, 'Run 需要处理，分析未正常完成') : null
    task.launch_error_code = task.status === 'needs_attention' ? 'RUN_ATTENTION_REQUIRED' : null
    task.updated_at = this.now()
    await this.persistQueued()
    return structuredClone(task)
  }

  async bindRun(taskId, runId, workflowVersion) {
    await this.ready
    const task = this.requireTask(taskId)
    const id = text(runId)
    if (!id) throw new Error('run_id is required')
    if (task.run_id && task.run_id !== id) throw new Error(`Task is already bound to another Run: ${task.run_id}`)
    task.run_id = id
    if (['legacy-v1', 'source-first-v1'].includes(workflowVersion)) task.workflow_version = workflowVersion
    task.status = 'preparing'
    task.launch_error = null
    task.launch_error_code = null
    task.updated_at = this.now()
    await this.persistQueued()
    return structuredClone(task)
  }

  async reconcileRuns(runs, { dataRoot } = {}) {
    await this.ready
    const root = text(dataRoot)
    const byId = new Map((Array.isArray(runs) ? runs : []).map(run => [text(run?.run_id), run]))
    let changed = false
    for (const task of Object.values(this.store.tasks)) {
      if (root && (!task.data_root || path.resolve(task.data_root) !== path.resolve(root))) continue
      const run = task.run_id ? byId.get(task.run_id) : undefined
      if (!run) continue
      if (run.workflow_version === 'source-first-v1') {
        if (task.workflow_version !== run.workflow_version) { task.workflow_version = run.workflow_version; changed = true }
        if (task.host_review?.status === 'pending' && !task.host_review?.reviewer_session_id) { task.host_review = null; changed = true }
      }
      if (task.host_review && task.host_review.status !== 'complete') continue
      if (task.provider && ['starting', 'running', 'stopping'].includes(task.execution_status)) continue
      // A terminal ACP/stop observation is stronger than a stale Run
      // snapshot. The Runtime may publish its own terminal state slightly
      // later; do not resurrect a stopped or interrupted attempt as running
      // during that gap.
      if (['failed', 'stopped', 'interrupted'].includes(task.execution_status)
        && !['complete', 'failed', 'stopped', 'cancelled'].includes(text(run?.lifecycle_status).toLowerCase())) continue
      const status = taskStatusFromRun(run)
      if (status === 'running' && task.status === 'failed' && task.launch_error_code && task.launch_error_code !== 'RUN_ATTENTION_REQUIRED') continue
      if (task.status !== status) {
        task.status = status
        if (status === 'needs_attention' && !task.launch_error) {
          task.launch_error = text(run?.error, 'Run 需要处理，分析未正常完成')
          task.launch_error_code = 'RUN_ATTENTION_REQUIRED'
        } else if (status !== 'needs_attention' && task.launch_error_code === 'RUN_ATTENTION_REQUIRED') {
          task.launch_error = null
          task.launch_error_code = null
        }
        task.updated_at = this.now()
        changed = true
      }
    }
    if (changed) await this.persistQueued()
  }

  requireTask(taskId) {
    const task = this.store.tasks[text(taskId)]
    if (!task) throw new Error(`task not found: ${taskId}`)
    return task
  }

  persistQueued() {
    this.saveQueue = this.saveQueue.then(() => this.persist(), () => this.persist())
    return this.saveQueue
  }

  async persist() {
    await this.writeStore(this.storePath, `${JSON.stringify(this.store, null, 2)}\n`)
  }

  async flush() {
    await this.ready
    await this.saveQueue
  }
}

export function createTaskStore(options) {
  return new TaskStore(options)
}

export { taskStatusFromRun }
