import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const STORE_VERSION = 1

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
    kind: value?.kind === 'analysis' ? 'analysis' : 'assistant',
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

function normalizeTask(taskId, value) {
  const conversations = Array.isArray(value?.conversations)
    ? value.conversations.map(normalizeConversation).filter(Boolean)
    : []
  return {
    task_id: taskId,
    request_version: value?.request_version === '2.0' ? '2.0' : '1.0',
    workspace: text(value?.workspace),
    data_root: text(value?.data_root) || null,
    title: text(value?.title, text(value?.target, taskId)),
    repository: text(value?.repository),
    target: text(value?.target),
    source_scope: strings(value?.source_scope),
    asset_ids: strings(value?.asset_ids),
    model_route: normalizeModelRoute(value?.model_route),
    provider: text(value?.provider) || null,
    job_id: text(value?.job_id) || null,
    owner_session_id: text(value?.owner_session_id) || null,
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
    active_conversation_id: text(value?.active_conversation_id) || conversations[0]?.conversation_id || null,
    created_at: Number.isFinite(value?.created_at) ? value.created_at : null,
    updated_at: Number.isFinite(value?.updated_at) ? value.updated_at : null,
  }
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
  constructor({ storePath = defaultStorePath(), now = () => Date.now(), idFactory } = {}) {
    this.storePath = storePath
    this.now = now
    this.idFactory = idFactory ?? (() => {
      const stamp = new Date(this.now()).toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
      return `task-${stamp}-${randomUUID().slice(0, 6)}`
    })
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
      request_version: '2.0',
      repository,
      target,
      source_scope: input?.source_scope,
      asset_ids: input?.asset_ids,
      model_route: input?.model_route,
      provider: input?.provider_id ?? input?.provider,
      status: 'preparing',
      created_at: time,
      updated_at: time,
    })
    this.store.tasks[taskId] = task
    await this.persistQueued()
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
    const task = Object.values(this.store.tasks).find(item => (
      item.run_id === id
      && (!root || (item.data_root && path.resolve(item.data_root) === path.resolve(root)))
    ))
    return task ? structuredClone(task) : null
  }

  async addConversation(taskId, { sessionId, title, kind = 'assistant' }) {
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
    task.active_conversation_id = conversation.conversation_id
    if (kind === 'analysis') task.status = 'preparing'
    task.updated_at = this.now()
    task.launch_error = null
    task.launch_error_code = null
    await this.persistQueued()
    return structuredClone(task)
  }

  async prepareLaunch(taskId, modelRoute) {
    await this.ready
    const task = this.requireTask(taskId)
    const selected = normalizeModelRoute(modelRoute)
    if (!selected) throw new Error('请选择一个已配置的内部模型')
    task.model_route = selected
    task.status = 'preparing'
    task.launch_error = null
    task.launch_error_code = null
    task.launch_started_at = this.now()
    task.launch_attempts += 1
    task.updated_at = this.now()
    await this.persistQueued()
    return structuredClone(task)
  }

  async prepareProviderLaunch(taskId, provider, modelRoute) {
    await this.ready
    const task = this.requireTask(taskId)
    const selected = text(provider)
    if (!selected) throw new Error('请选择一个 ACP 执行 Agent')
    const selectedModel = normalizeModelRoute(modelRoute)
    if (!selectedModel || selectedModel.provider !== selected || selectedModel.route_class !== 'external-acp') {
      throw new Error('请选择当前 ACP 执行 Agent 的模型')
    }
    task.provider = selected
    task.model_route = selectedModel
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

  async bindJob(taskId, { jobId, provider, ownerSessionId }) {
    await this.ready
    const task = this.requireTask(taskId)
    task.job_id = text(jobId) || null
    task.provider = text(provider) || task.provider
    task.owner_session_id = text(ownerSessionId) || task.owner_session_id
    task.execution_status = 'running'
    task.status = 'running'
    task.last_activity_at = this.now()
    task.updated_at = this.now()
    await this.persistQueued()
    return structuredClone(task)
  }

  async getByJob(jobId) {
    await this.ready
    const id = text(jobId)
    if (!id) return null
    const task = Object.values(this.store.tasks).find(item => item.job_id === id)
    return task ? structuredClone(task) : null
  }

  async bindAgentRuntime(taskId, { agentSessionId, processId }) {
    await this.ready
    const task = this.requireTask(taskId)
    task.agent_session_id = text(agentSessionId) || task.agent_session_id
    task.process_id = Number.isInteger(processId) && processId > 0 ? processId : task.process_id
    task.last_activity_at = this.now()
    task.updated_at = this.now()
    await this.persistQueued()
    return structuredClone(task)
  }

  async recordJobActivity(jobId, output) {
    await this.ready
    const id = text(jobId)
    const task = Object.values(this.store.tasks).find(item => item.job_id === id)
    if (!task) return null
    const chunk = typeof output === 'string' ? output : ''
    if (chunk) task.last_output = `${task.last_output ?? ''}${chunk}`.slice(-8192)
    task.last_activity_at = this.now()
    task.updated_at = this.now()
    await this.persistQueued()
    return structuredClone(task)
  }

  async settleJob(jobId, snapshot) {
    await this.ready
    const id = text(jobId)
    const task = Object.values(this.store.tasks).find(item => item.job_id === id)
    if (!task) return null
    const status = snapshot?.status === 'completed' ? 'completed' : snapshot?.status === 'killed' ? 'stopped' : 'failed'
    task.execution_status = status
    if (status === 'completed') task.status = 'completed'
    else task.status = status
    task.terminal_error = status === 'failed' ? text(snapshot?.detail, 'ACP Agent 执行失败') : null
    task.launch_error = task.terminal_error
    task.launch_error_code = status === 'failed' ? 'ACP_AGENT_FAILED' : null
    task.last_activity_at = this.now()
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
    task.updated_at = this.now()
    await this.persistQueued()
    return structuredClone(task)
  }

  async markStopped(taskId, error = null) {
    await this.ready
    const task = this.requireTask(taskId)
    task.status = 'stopped'
    task.execution_status = 'stopped'
    task.launch_error = text(error) || null
    task.launch_error_code = text(error) ? 'STOP_FAILED' : null
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
    task.run_id = runId
    task.status = taskStatusFromRun(run)
    task.launch_error = task.status === 'needs_attention' ? text(run?.error, 'Run 需要处理，分析未正常完成') : null
    task.launch_error_code = task.status === 'needs_attention' ? 'RUN_ATTENTION_REQUIRED' : null
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
      if (task.model_route?.route_class === 'external-acp' && ['starting', 'running', 'stopping'].includes(task.execution_status)) continue
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
    await mkdir(path.dirname(this.storePath), { recursive: true })
    const temporary = `${this.storePath}.tmp`
    await writeFile(temporary, `${JSON.stringify(this.store, null, 2)}\n`, 'utf8')
    await rename(temporary, this.storePath)
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
