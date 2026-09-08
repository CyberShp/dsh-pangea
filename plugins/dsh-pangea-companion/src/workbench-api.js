import path from 'node:path'
import { attentionRequiredOutcome } from './acp-outcome.js'

import { assertCodetalksSkill, createRun, resumeRun, runPangea, workspaceRoot } from './pangea-api.js'

const DEFAULT_PAGE_SIZE = 20
const ACP_RUNTIME_CONFIG_ENV = 'PANGEA_ACP_RUNTIME_CONFIG'

const ACP_PROVIDER_DEFAULTS = [
  { id: 'pangea-nga', label: 'NGA', command: 'nga', args: ['acp'] },
  { id: 'pangea-codeagent', label: 'CodeAgent', command: 'codeagent', args: ['acp'] },
  { id: 'pangea-opencode', label: 'OpenCode', command: 'opencode', args: ['acp'] },
  { id: 'pangea-claude-code', label: 'Claude Code', kind: 'claude-code', command: 'DSH Claude Code Provider', args: [] },
]
const ANALYSIS_SCENARIOS = new Set(['module-analysis', 'issue-regression', 'root-cause', 'special-risk', 'custom'])
const ANALYSIS_MODES = new Set(['speed', 'depth'])

function configuredProviders(env) {
  const raw = env[ACP_RUNTIME_CONFIG_ENV]
  if (typeof raw !== 'string' || raw.trim() === '') return {}
  let parsed
  try { parsed = JSON.parse(raw) } catch (error) {
    throw new Error(`${ACP_RUNTIME_CONFIG_ENV} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`)
  }
  if (parsed?.version !== 1 || !parsed.providers || typeof parsed.providers !== 'object' || Array.isArray(parsed.providers)) {
    throw new Error(`${ACP_RUNTIME_CONFIG_ENV} 必须包含 version=1 和 providers 对象`)
  }
  return parsed.providers
}

// External ACP agents are intentionally configured as commands rather than
// model routes.  This keeps credentials and process ownership in DSH.
export function acpProviderOptions(env = process.env) {
  const configured = configuredProviders(env)
  return ACP_PROVIDER_DEFAULTS.map(defaults => {
    const value = configured[defaults.id]
    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) {
      throw new Error(`${defaults.id} 的 ACP 配置必须是对象`)
    }
    const command = typeof value?.command === 'string' && value.command.trim() ? value.command.trim() : defaults.command
    const args = value?.args === undefined ? defaults.args : value.args
    if (!Array.isArray(args) || args.some(item => typeof item !== 'string' || !item.trim())) {
      throw new Error(`${defaults.id} 的 args 必须是非空字符串数组`)
    }
    return {
      ...defaults,
      command,
      args: args.map(item => item.trim()),
      configured: value !== undefined,
      resolved_command: typeof value?.resolved_command === 'string' && value.resolved_command.trim() ? value.resolved_command.trim() : null,
      available: value?.available !== false,
      resolution_status: typeof value?.resolution_status === 'string' ? value.resolution_status : null,
      resolution_error: typeof value?.resolution_error === 'string' ? value.resolution_error : null,
      version: typeof value?.version === 'string' ? value.version : null,
      version_status: typeof value?.version_status === 'string' ? value.version_status : null,
      version_error: typeof value?.version_error === 'string' ? value.version_error : null,
      login_status: typeof value?.login_status === 'string' ? value.login_status : null,
      launcher_kind: typeof value?.launcher_kind === 'string' ? value.launcher_kind : null,
    }
  })
}

export function validateAcpRuntimeConfig(value) {
  const encoded = JSON.stringify(value)
  acpProviderOptions({ ...process.env, [ACP_RUNTIME_CONFIG_ENV]: encoded })
  return JSON.parse(encoded)
}

export function acpProviderOption(providerId, env = process.env) {
  const id = typeof providerId === 'string' ? providerId.trim() : ''
  return acpProviderOptions(env).find(provider => provider.id === id) ?? null
}

function rpc(payload) {
  return { rpcId: `pangea-workbench-${Date.now()}-${Math.random()}`, payload }
}

function apiValue(response) {
  if (!response?.result?.ok) {
    throw new Error(response?.result?.error?.message ?? 'DSH API request failed')
  }
  return response.result.value
}

function valueAtPath(value, path) {
  let current = value
  for (const segment of Array.isArray(path) ? path : []) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, segment)) return undefined
    current = current[segment]
  }
  return current
}

function modelRoute(value) {
  const provider = typeof value?.provider === 'string' ? value.provider.trim() : ''
  const model = typeof value?.model === 'string' ? value.model.trim() : ''
  const reasoningEffort = typeof value?.reasoning_effort === 'string' ? value.reasoning_effort.trim() : ''
  if (!provider || !model) return null
  return { provider, model, ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}) }
}

export async function internalModelOptions(api) {
  const [providerValue, modelValue, settingsValue] = await Promise.all([
    apiValue(await api.llm.providers(rpc({}))),
    apiValue(await api.llm.models(rpc({}))),
    apiValue(await api.settings.describe(rpc({}))),
  ])
  const namespaces = new Map((settingsValue.namespaces ?? []).map(item => [item.ns, item]))
  const providers = (providerValue.providers ?? []).filter(item => item.declared === true && item.active === true)
  const providerRows = providers.map(entry => {
    const namespace = namespaces.get(entry.settingsNs)
    const profile = valueAtPath(namespace?.value, entry.settingsPath)
    const apiKeyEnv = typeof profile?.apiKeyEnv === 'string' && profile.apiKeyEnv.trim()
      ? profile.apiKeyEnv.trim()
      : null
    return { entry, apiKeyEnv }
  })
  const refs = [...new Set(providerRows.map(item => item.apiKeyEnv).filter(Boolean))]
  const credentials = refs.length > 0
    ? apiValue(await api.credentials.describe(rpc({ refs }))).credentials ?? {}
    : {}
  const groups = new Map((modelValue.groups ?? []).map(group => [group.id, group]))
  const options = []
  for (const { entry, apiKeyEnv } of providerRows) {
    const credentialConfigured = apiKeyEnv === null
      || credentials[apiKeyEnv]?.configured === true
      || (typeof process.env[apiKeyEnv] === 'string' && process.env[apiKeyEnv].trim() !== '')
    for (const model of groups.get(entry.provider)?.models ?? []) {
      options.push({
        provider: entry.provider,
        provider_name: entry.displayName,
        model: model.id,
        model_name: model.name,
        reasoning: model.reasoning ?? entry.reasoning ?? null,
        credential_configured: credentialConfigured,
        route_class: 'configured-internal',
      })
    }
  }
  return { models: options, failures: modelValue.failures ?? [] }
}

export async function requireInternalModel(api, value) {
  const selected = modelRoute(value)
  if (!selected) throw new Error('请选择一个已配置的内部模型')
  const catalog = await internalModelOptions(api)
  const option = catalog.models.find(item => item.provider === selected.provider && item.model === selected.model)
  if (!option) throw new Error(`所选模型不属于当前已配置的内部模型：${selected.provider}/${selected.model}`)
  if (!option.credential_configured) throw new Error(`所选内部模型尚未配置凭证：${selected.provider}/${selected.model}`)
  if (selected.reasoning_effort) {
    const efforts = option.reasoning?.efforts ?? []
    if (!efforts.some(item => item.id === selected.reasoning_effort)) {
      throw new Error(`所选模型不支持推理级别：${selected.reasoning_effort}`)
    }
  }
  return { ...selected, route_class: option.route_class }
}

function dataRootFor(root, explicit) {
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    return path.isAbsolute(explicit) ? path.resolve(explicit) : path.resolve(root, explicit)
  }
  return path.join(root, 'pangea-data')
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback
}

function stringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.map(item => typeof item === 'string' ? item.trim() : '').filter(Boolean))]
    : []
}

function normalizeAnalysisInput(value, capabilities, allowEmptySourceScope) {
  assertCodetalksSkill(capabilities)
  const rejectedFields = ['focus', 'test_case_examples'].filter(field => Object.hasOwn(value ?? {}, field))
  if (rejectedFields.length) throw new Error(`新建分析不支持字段：${rejectedFields.join(', ')}`)
  const repository = typeof value?.repository === 'string' ? value.repository.trim() : ''
  const target = typeof value?.target === 'string' ? value.target.trim() : ''
  const scenario = typeof value?.scenario === 'string' && value.scenario.trim() ? value.scenario.trim() : 'module-analysis'
  const mode = typeof value?.mode === 'string' && value.mode.trim() ? value.mode.trim() : 'depth'
  const sourceScope = stringList(value?.source_scope)
  if (!repository) throw new Error('repository is required')
  if (!target) throw new Error('target is required')
  if (!ANALYSIS_SCENARIOS.has(scenario)) throw new Error(`不支持的分析场景：${scenario}`)
  if (!ANALYSIS_MODES.has(mode)) throw new Error(`不支持的分析模式：${mode}`)
  if (sourceScope.length === 0 && !allowEmptySourceScope) {
    throw new Error('source_scope must contain at least one path')
  }
  if (Array.isArray(capabilities?.repositories) && !capabilities.repositories.includes(repository)) {
    throw new Error(`repository is not registered: ${repository}`)
  }
  return {
    request_version: '2.0',
    repository,
    target,
    scenario,
    mode,
    source_scope: sourceScope,
    asset_ids: stringList(value?.asset_ids),
    provider_id: typeof value?.provider_id === 'string' && value.provider_id.trim() ? value.provider_id.trim() : null,
  }
}

export function normalizeRunInput(value, capabilities) {
  return normalizeAnalysisInput(value, capabilities, false)
}

export async function workbenchSnapshot({ cwd, dataRoot, runId, cursor = 0, limit = DEFAULT_PAGE_SIZE, runner = runPangea }) {
  const root = workspaceRoot(cwd)
  const resolvedDataRoot = dataRootFor(root, dataRoot)
  const pageCursor = boundedInteger(cursor, 0, 0, Number.MAX_SAFE_INTEGER)
  const pageLimit = boundedInteger(limit, DEFAULT_PAGE_SIZE, 1, 100)
  try {
    const capabilities = await runner({
      cwd: root,
      args: ['system', 'capabilities', '--data-root', resolvedDataRoot],
    })
    const runs = await runner({
      cwd: root,
      args: ['runs', 'list', '--data-root', resolvedDataRoot, '--cursor', String(pageCursor), '--limit', String(pageLimit)],
    })
    const requestedRunId = typeof runId === 'string' ? runId.trim() : ''
    let run = null
    let runDetail = null
    if (requestedRunId) {
      try {
        run = await runner({
          cwd: root,
          args: ['runs', 'get', '--data-root', resolvedDataRoot, '--run-id', requestedRunId],
        })
        runDetail = { run_id: requestedRunId, status: 'ok', error: null }
      } catch (error) {
        runDetail = { run_id: requestedRunId, status: 'error', error: error instanceof Error ? error.message : String(error) }
      }
    }
    return {
      status: 'ok',
      data_root: resolvedDataRoot,
      compatibility: { compatible: true, api_version: '1.0' },
      capabilities,
      runs,
      run,
      run_detail: runDetail,
      pagination: { cursor: pageCursor, limit: pageLimit },
    }
  } catch (error) {
    return {
      status: 'ok',
      data_root: resolvedDataRoot,
      compatibility: {
        compatible: false,
        api_version: null,
        error: error instanceof Error ? error.message : String(error),
      },
      capabilities: null,
      runs: { items: [], next_cursor: null, total: 0 },
      run: null,
      run_detail: null,
      pagination: { cursor: pageCursor, limit: pageLimit },
    }
  }
}

async function createDshSession(api, root, title) {
  let payload = { cwd: root }
  if (api.workspace?.list) {
    const workspaces = apiValue(await api.workspace.list(rpc({}))).items
    const workspace = workspaces.find(item => path.resolve(item.path) === root)
    if (!workspace) throw new Error(`current DSH workspace is not registered: ${root}`)
    payload = { workspaceId: workspace.workspaceId }
  }
  const sessionId = apiValue(await api.sessions.create(rpc(payload))).sessionId
  apiValue(await api.sessions.rename(rpc({ sessionId, title })))
  return sessionId
}

async function emitLaunch(onEvent, event) {
  try { await onEvent(event) } catch { /* logging must never change launch behavior */ }
}

function launchDetails(value, fallback = {}) {
  const error = value && typeof value === 'object' ? value : {}
  const text = (camel, snake, defaultValue) => {
    const candidate = error[camel] ?? error[snake] ?? defaultValue
    return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined
  }
  return {
    launch_stage: text('launchStage', 'launch_stage', fallback.launch_stage),
    configured_command: text('configuredCommand', 'configured_command', fallback.configured_command),
    resolved_command: text('resolvedCommand', 'resolved_command', fallback.resolved_command),
    launcher_kind: text('launcherKind', 'launcher_kind', fallback.launcher_kind),
    launcher_command: text('launcherCommand', 'launcher_command', fallback.launcher_command),
    cwd: text('cwd', 'cwd', fallback.cwd),
    error_code: Number.isInteger(error.code) ? String(error.code) : text('code', 'error_code', fallback.error_code),
    syscall: text('syscall', 'syscall', fallback.syscall),
    ...(text('stderrSummary', 'stderr_summary', fallback.stderr_summary) ? { stderr_summary: text('stderrSummary', 'stderr_summary', fallback.stderr_summary) } : {}),
    errno: Number.isInteger(error.errno) ? error.errno : fallback.errno,
  }
}

async function launchStep(onEvent, stage, action, successDetails = () => ({})) {
  const startedAt = Date.now()
  await emitLaunch(onEvent, { stage, status: 'start' })
  try {
    const value = await action()
    await emitLaunch(onEvent, { stage, status: 'ok', duration_ms: Date.now() - startedAt, ...successDetails(value) })
    return value
  } catch (error) {
    await emitLaunch(onEvent, { stage, status: 'error', duration_ms: Date.now() - startedAt, error })
    throw error
  }
}

function runtimeService(runtime, name) {
  return runtime?.[name] ?? runtime?.get?.(name)
}

function runProgressFingerprint(run) {
  return JSON.stringify([
    run?.lifecycle_status ?? null,
    run?.phase ?? null,
    run?.completed_steps?.length ?? null,
    run?.publication?.revision ?? null,
    run?.report_available === true,
  ])
}

function continuationPrompt(run) {
  return [
    '上一轮回答已经结束，但当前 Codetalks Run 尚未完成。',
    run?.phase === 'PREPARING' ? '当前 Run 尚未写出初始化状态。先使用首轮提供的 Python 路径执行请求中的 run_guard.py init；若执行失败，报告具体命令、退出码和受限错误摘要并结束。' : null,
    '请读取运行根目录中的 `内部索引/运行状态.json` 以及当前步骤交接文件，以落盘状态为准继续执行。',
    `当前阶段：${run?.phase ?? '未知'}；已完成步骤：${run?.completed_steps?.length ?? '未知'}/9。`,
    '继续当前 Run，不要创建新的 Run。',
  ].filter(Boolean).join('\n')
}

function acpRunDiagnostics(run) {
  const value = run.readDiagnostics?.() ?? {}
  return {
    remote_session_id: run.remoteSessionId,
    model: value.model || 'unavailable',
    message_chunks: value.messageChunks,
    tool_calls: value.toolCalls,
    tool_failures: value.toolFailures,
    error_code: value.errorCode,
    error_summary: value.errorSummary,
    stderr_summary: value.stderrSummary,
    agent_version: value.agentVersion,
    last_tool_id: value.lastToolId,
    last_tool_status: value.lastToolStatus,
    turn_duration_ms: value.turnDurationMs,
    first_event_ms: value.firstEventMs,
    stderr_bytes: value.stderrBytes,
    stderr_truncated: value.stderrTruncated,
    output_truncated: value.outputTruncated,
    process_exited: value.processExited,
    exit_code: value.exitCode,
    exit_signal: value.exitSignal,
  }
}

async function settleAcpRun(start, signal, wasCancelled, lifecycle = {}) {
  let run
  try {
    run = await start
    let result = await run.result
    let output = ''
    let previousProgress = null
    let unchangedTurns = 0
    let turn = 1
    while (true) {
      await lifecycle.onTurnEvent?.({
        stage: 'acp_turn_finished', status: result.stopReason === 'error' ? 'error' : 'info', turn,
        stop_reason: result.stopReason, protocol_stop_reason: result.protocolStopReason,
        ...acpRunDiagnostics(run),
      })
      output += (result.output ?? [])
        .filter(item => item?.type === 'text')
        .map(item => item.text)
        .join('')
      if (result.stopReason === 'aborted' && result.diagnostic === undefined && wasCancelled()) return { status: 'killed' }
      if (result.stopReason !== 'completed') {
        return { status: 'failed', detail: result.diagnostic ? `${result.stopReason}; diagnostic: ${result.diagnostic}` : result.stopReason, output }
      }
      if (typeof lifecycle.inspectRun !== 'function') return { status: 'completed', output }
      const state = await lifecycle.inspectRun()
      await lifecycle.onTurnEvent?.({ stage: 'acp_run_inspected', status: 'info', turn, phase: state?.phase,
        completed: state?.completed_steps?.length,
        state_path: state?.run_root ? path.join(state.run_root, '内部索引', '运行状态.json') : undefined,
      })
      if (state?.lifecycle_status === 'complete' && state?.report_available === true) return { status: 'completed', output }
      if (signal.aborted || wasCancelled()) return { status: 'killed' }
      if (typeof run.continuePrompt !== 'function') {
        return {
          ...attentionRequiredOutcome(`ACP 本轮已结束，但当前 Run 尚未完成（${state?.phase ?? state?.lifecycle_status ?? 'unknown'}）`),
          output,
        }
      }
      const fingerprint = runProgressFingerprint(state)
      unchangedTurns = fingerprint === previousProgress ? unchangedTurns + 1 : 0
      previousProgress = fingerprint
      if (unchangedTurns >= 2) {
        return {
          ...attentionRequiredOutcome(`ACP 连续续接未推进当前 Run（${state?.phase ?? 'unknown'}）`),
          output,
        }
      }
      turn += 1
      await lifecycle.onTurnEvent?.({ turn, stage: 'acp_turn_continued', phase: state?.phase, completed: state?.completed_steps?.length })
      result = await run.continuePrompt([{ type: 'text', text: continuationPrompt(state) }])
    }
  } catch (error) {
    return wasCancelled()
      ? { status: 'killed' }
      : { status: 'failed', detail: error instanceof Error ? error.message : String(error) }
  } finally {
    try {
      await run?.dispose?.()
      if (run) await lifecycle.onTurnEvent?.({ stage: 'acp_process_cleanup', status: 'info', ...acpRunDiagnostics(run) })
    } catch { /* job settlement retains the failure */ }
  }
}

async function startAcpJob(runtime, parent, providerId, prompt, label, onEvent, lifecycle = {}) {
  const subagents = runtimeService(runtime, 'subagents')
  const jobs = runtimeService(runtime, 'jobs')
  if (!subagents?.start) throw new Error('DSH subagent runtime unavailable: load dsh-subagent')
  if (!jobs?.start) throw new Error('DSH background jobs unavailable: load dsh-jobs and dsh-jobs-local')
  if (!parent) throw new Error('DSH owner Agent is not live for this analysis session')
  if (!subagents.getProvider?.(providerId)) throw new Error(`ACP Provider 未注册：${providerId}`)
  let hooks
  let releaseStart
  let rejectStart
  const startGate = new Promise((resolve, reject) => {
    releaseStart = resolve
    rejectStart = reject
  })
  const jobId = jobs.start({
    kind: 'subagent',
    label,
    owner: parent,
    run: () => {
      const controller = new AbortController()
      let activeRun
      let cancelled = false
      const observed = startGate.then(async () => {
        await emitLaunch(onEvent, {
          stage: 'acp_process_spawn', status: 'start', provider: providerId,
          ...lifecycle.launchContext,
        })
        return subagents.start(providerId, {
          label,
          prompt: [{ type: 'text', text: prompt }],
          parent,
          signal: controller.signal,
        })
      }).then(async run => {
        activeRun = run
        const details = launchDetails(run.launch, lifecycle.launchContext)
        await lifecycle.onAgentStarted?.({
          provider: providerId,
          agent_session_id: String(run.id),
          pid: Number.isInteger(run.processId) ? run.processId : undefined,
        })
        void emitLaunch(onEvent, {
          stage: 'acp_session_created', status: 'ok', provider: providerId,
          agent_session_id: String(run.id), pid: Number.isInteger(run.processId) ? run.processId : undefined,
          ...acpRunDiagnostics(run),
          ...details,
        })
        return run
      }).catch(async error => {
        await emitLaunch(onEvent, {
          stage: 'acp_process_spawn', status: 'error', provider: providerId, error,
          ...launchDetails(error, { ...lifecycle.launchContext, launch_stage: 'spawn_process' }),
        })
        controller.abort(error)
        try { await activeRun?.dispose?.() } catch { /* the failed launch remains observable through the Job */ }
        throw error
      })
      hooks = {
        cancel: reason => {
          cancelled = true
          controller.abort(reason ?? 'PANGEA analysis stopped')
        },
        abort: reason => controller.abort(reason),
        done: settleAcpRun(observed, controller.signal, () => cancelled, lifecycle),
        readOutput: () => typeof activeRun?.readOutput === 'function' ? activeRun.readOutput() : '',
      }
      return hooks
    },
  })
  try {
    const job = jobs.get?.(jobId, parent)
    if (!Number.isFinite(job?.startedAt)) throw new Error(`ACP Job snapshot 缺少 startedAt：${jobId}`)
    await lifecycle.onJobCreated?.({
      jobId: String(jobId),
      ownerSessionId: parent.id,
      jobStartedAt: job.startedAt,
    })
    releaseStart()
  } catch (error) {
    rejectStart(error)
    try {
      if (error?.code === 'PANGEA_STOP_REQUESTED') hooks?.cancel?.(error)
      else hooks?.abort?.(error)
    } catch { /* local cleanup below remains authoritative */ }
    try { await hooks?.done } catch { /* settlement has already captured the launch failure */ }
    throw error
  }
  return jobId
}

export async function launchAnalysisSession(
  api,
  { cwd, dataRoot, input, model, resumeRunId },
  runner = runPangea,
  onSession = async () => {},
  onEvent = async () => {},
  runtime,
  env = process.env,
  lifecycle = {},
) {
  const root = workspaceRoot(cwd)
  const resolvedDataRoot = dataRootFor(root, dataRoot)
  await emitLaunch(onEvent, { stage: 'workspace_resolved', status: 'ok' })
  const capabilities = await launchStep(onEvent, 'capabilities_check', () => runner({
    cwd: root,
    args: ['system', 'capabilities', '--data-root', resolvedDataRoot],
  }), value => ({ repository_count: Array.isArray(value?.repositories) ? value.repositories.length : 0 }))
  const request = normalizeAnalysisInput(input, capabilities, true)
  await emitLaunch(onEvent, { stage: 'input_validated', status: 'ok' })
  const selectedProvider = request.provider_id
  if (selectedProvider && !runtime) throw new Error(`外部执行 Agent 需要 DSH ACP runtime：${selectedProvider}`)
  const selectedModel = selectedProvider
    ? null
    : await launchStep(
      onEvent,
      'model_validate',
      () => requireInternalModel(api, model),
      value => ({ provider: value.provider, model: value.model }),
    )
  const requestedResumeRunId = typeof resumeRunId === 'string' ? resumeRunId.trim() : ''
  const run = await launchStep(
    onEvent,
    requestedResumeRunId ? 'skill_run_resume' : 'skill_run_create',
    () => requestedResumeRunId
      ? resumeRun(root, { dataRoot: resolvedDataRoot, runId: requestedResumeRunId }, runner)
      : (() => {
        const { provider_id: _providerId, ...skillRequest } = request
        return createRun(root, { ...skillRequest, data_root: resolvedDataRoot }, runner)
      })(),
    value => ({
      run_id: value.run_id,
      request_path: value.request_path,
      file_count: value.source_snapshot?.file_count,
      total_bytes: value.source_snapshot?.total_bytes,
      snapshot_duration_ms: value.source_snapshot?.snapshot_duration_ms,
    }),
  )
  await lifecycle.onRunReady?.(run)
  const sessionId = await launchStep(
    onEvent,
    'session_create',
    () => createDshSession(api, root, `PANGEA 分析 · ${request.target}`),
    value => ({ session_id: value }),
  )
  if (!runtime || !selectedProvider) await launchStep(onEvent, 'model_select', async () => {
    apiValue(await api.sessions.selectModel(rpc({
      sessionId,
      provider: selectedModel.provider,
      model: selectedModel.model,
      ...(selectedModel.reasoning_effort ? { reasoningEffort: selectedModel.reasoning_effort } : {}),
    })))
  }, () => ({ session_id: sessionId, provider: selectedModel.provider, model: selectedModel.model }))
  await launchStep(onEvent, 'session_record', () => onSession({
    session_id: sessionId,
    input: request,
    data_root: resolvedDataRoot,
    model: selectedModel,
    run,
  }), () => ({ session_id: sessionId }))
  await lifecycle.onOwnerReady?.({ ownerSessionId: sessionId })
  const prompt = [
    requestedResumeRunId
      ? `继续已有的 Codetalks Skill ${request.mode === 'speed' ? '速度型' : '深度型'} ${request.scenario} 分析，从最近检查点恢复执行，不要创建第二个 Run。`
      : `立即开始已经创建好的 Codetalks Skill ${request.mode === 'speed' ? '速度型' : '深度型'} ${request.scenario} 分析，完整执行 Step 01–09，不需要再次确认，也不要创建第二个 Run。`,
    '必须先读取 `.agents/pangea/dsh.md`，再读取下面的 Skill 运行请求并严格执行。',
    `运行请求：${run.request_path}`,
    `Run ID：${run.run_id}`,
    `运行根目录：${run.run_root}`,
    env.PANGEA_PYTHON ? `Desktop Python 可执行文件：${env.PANGEA_PYTHON}。执行 run_guard.py 时使用此路径；PowerShell 用 & 调用并单引号引用路径（路径内单引号写成两个）。` : null,
    '遇到宿主环境阻塞时，报告失败步骤、命令退出码和必要错误摘要，然后结束；不要搜索安装目录、凭据配置或历史日志。',
    requestedResumeRunId ? '这是一次续跑：先读取内部索引/运行状态.json，调用 run_guard.py init --resume 保留已完成步骤，再从当前步骤继续。' : null,
    '旧 PANGEA Graph、Planning、Worker action、Review、Closure、Reporting、bind、validate 和 settle 均不存在。',
    '生命周期只以运行根目录中的 `内部索引/运行状态.json` 为准。',
    '',
    '现在读取运行请求并执行。',
  ].filter(Boolean).join('\n')
  if (runtime && selectedProvider) {
    const parent = runtimeService(runtime, 'agents')?.get?.(sessionId)
    const providerOption = acpProviderOption(selectedProvider, env)
    const resolvedCommand = providerOption?.resolved_command ?? providerOption?.command
    const launcherKind = providerOption?.launcher_kind
      ?? (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(resolvedCommand ?? '') ? 'windows-batch' : 'direct')
    const launchContext = {
      configured_command: providerOption?.command,
      resolved_command: resolvedCommand,
      launcher_kind: launcherKind,
      launcher_command: launcherKind === 'windows-batch' ? env.ComSpec ?? 'cmd.exe' : resolvedCommand,
      cwd: root,
    }
    const acpLifecycle = {
      ...lifecycle,
      launchContext,
      inspectRun: () => runner({
        cwd: root,
        args: ['runs', 'get', '--data-root', resolvedDataRoot, '--run-id', run.run_id],
      }),
      onTurnEvent: event => emitLaunch(onEvent, { status: 'ok', provider: selectedProvider, run_id: run.run_id, ...event }),
    }
    const jobId = await launchStep(onEvent, 'acp_job_create', () => startAcpJob(runtime, parent, selectedProvider, prompt, `PANGEA · ${request.target} · ${selectedProvider}`, onEvent, acpLifecycle), value => ({ job_id: value, provider: selectedProvider }))
    await emitLaunch(onEvent, { stage: 'skill_started', status: 'ok', session_id: sessionId, job_id: jobId, provider: selectedProvider, run_id: run.run_id, message: 'Codetalks Skill ACP 分析已启动。' })
    return { status: 'ok', session_id: sessionId, job_id: jobId, provider: selectedProvider, input: request, data_root: resolvedDataRoot, model: selectedModel, run }
  }
  await launchStep(onEvent, 'prompt_submit', async () => {
    apiValue(await api.sessions.prompt(rpc({ sessionId, mode: 'queue', content: [{ type: 'text', text: prompt }] })))
  }, () => ({ session_id: sessionId }))
  await emitLaunch(onEvent, { stage: 'skill_started', status: 'ok', session_id: sessionId, run_id: run.run_id, message: 'Codetalks Skill 分析会话已启动。' })
  return { status: 'ok', session_id: sessionId, input: request, data_root: resolvedDataRoot, model: selectedModel, run }
}

export async function createTaskConversation(api, { cwd, title }) {
  const root = workspaceRoot(cwd)
  const sessionId = await createDshSession(api, root, textTitle(title))
  return { status: 'ok', session_id: sessionId }
}

function textTitle(value) {
  const title = typeof value === 'string' ? value.trim() : ''
  return title || 'PANGEA 任务会话'
}

export async function stopAnalysisRun({ cwd, dataRoot, runId, runner = runPangea }) {
  const root = workspaceRoot(cwd)
  const resolvedDataRoot = dataRootFor(root, dataRoot)
  if (typeof runId !== 'string' || runId.trim() === '') throw new Error('run_id is required')
  const run = await runner({
    cwd: root,
    args: ['runs', 'stop', '--data-root', resolvedDataRoot, '--run-id', runId.trim()],
  })
  return { status: 'ok', data_root: resolvedDataRoot, run }
}

export async function resumeAnalysisRun({ cwd, dataRoot, runId, runner = runPangea }) {
  const root = workspaceRoot(cwd)
  const resolvedDataRoot = dataRootFor(root, dataRoot)
  if (typeof runId !== 'string' || runId.trim() === '') throw new Error('run_id is required')
  const run = await resumeRun(root, { dataRoot: resolvedDataRoot, runId: runId.trim() }, runner)
  return { status: 'ok', data_root: resolvedDataRoot, run }
}

export { dataRootFor }
