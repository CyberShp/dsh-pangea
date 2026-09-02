import path from 'node:path'

import { assertCodetalksSkill, createRun, runPangea, workspaceRoot } from './pangea-api.js'

const DEFAULT_PAGE_SIZE = 20
const INTERNAL_PROVIDER_SETTINGS_NS = 'llm-pi-ai'

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
  const providers = (providerValue.providers ?? []).filter(item => (
    item.settingsNs === INTERNAL_PROVIDER_SETTINGS_NS
    && item.declared === true
    && item.active === true
  ))
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
    const credentialConfigured = apiKeyEnv === null || credentials[apiKeyEnv]?.configured === true
    for (const model of groups.get(entry.provider)?.models ?? []) {
      options.push({
        provider: entry.provider,
        provider_name: entry.displayName,
        model: model.id,
        model_name: model.name,
        reasoning: model.reasoning ?? null,
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
  const repository = typeof value?.repository === 'string' ? value.repository.trim() : ''
  const target = typeof value?.target === 'string' ? value.target.trim() : ''
  const sourceScope = stringList(value?.source_scope)
  if (!repository) throw new Error('repository is required')
  if (!target) throw new Error('target is required')
  if (sourceScope.length === 0 && !allowEmptySourceScope) {
    throw new Error('source_scope must contain at least one path')
  }
  if (Array.isArray(capabilities?.repositories) && !capabilities.repositories.includes(repository)) {
    throw new Error(`repository is not registered: ${repository}`)
  }
  return {
    repository,
    target,
    source_scope: sourceScope,
    focus: stringList(value?.focus),
    asset_ids: stringList(value?.asset_ids),
    test_case_examples: stringList(value?.test_case_examples),
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

async function launchStep(onEvent, stage, action, successDetails = () => ({})) {
  await emitLaunch(onEvent, { stage, status: 'start' })
  try {
    const value = await action()
    await emitLaunch(onEvent, { stage, status: 'ok', ...successDetails(value) })
    return value
  } catch (error) {
    await emitLaunch(onEvent, { stage, status: 'error', error })
    throw error
  }
}

export async function launchAnalysisSession(
  api,
  { cwd, dataRoot, input, model },
  runner = runPangea,
  onSession = async () => {},
  onEvent = async () => {},
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
  const selectedModel = await launchStep(
    onEvent,
    'model_validate',
    () => requireInternalModel(api, model),
    value => ({ provider: value.provider, model: value.model }),
  )
  const run = await launchStep(
    onEvent,
    'skill_run_create',
    () => createRun(root, { ...request, data_root: resolvedDataRoot }, runner),
    value => ({ run_id: value.run_id, request_path: value.request_path }),
  )
  const sessionId = await launchStep(
    onEvent,
    'session_create',
    () => createDshSession(api, root, `PANGEA 分析 · ${request.target}`),
    value => ({ session_id: value }),
  )
  await launchStep(onEvent, 'model_select', async () => {
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
  const prompt = [
    '立即开始已经创建好的 Codetalks Skill 深度型模块分析，完整执行 Step 01–09，不需要再次确认，也不要创建第二个 Run。',
    '必须先读取 `.agents/pangea/dsh.md`，再读取下面的 Skill 运行请求并严格执行。',
    `运行请求：${run.request_path}`,
    `Run ID：${run.run_id}`,
    `运行根目录：${run.run_root}`,
    '旧 PANGEA Graph、Planning、Worker action、Review、Closure、Reporting、bind、validate 和 settle 均不存在。',
    '生命周期只以运行根目录中的 `内部索引/运行状态.json` 为准。',
    '',
    '现在读取运行请求并执行。',
  ].join('\n')
  await launchStep(onEvent, 'prompt_submit', async () => {
    apiValue(await api.sessions.prompt(rpc({
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: prompt }],
    })))
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

export { dataRootFor }
