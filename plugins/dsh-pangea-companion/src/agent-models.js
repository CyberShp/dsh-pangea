import { randomUUID } from 'node:crypto'
import { LaunchLogStore, diagnosticText } from './launch-log.js'
import { acpProviderOption, runtimeService } from './workbench-api.js'
import { workspaceRoot } from './pangea-api.js'

// Receipts belong to the actual runtime service and workspace. A refreshed or
// failed probe invalidates earlier choices; a late response cannot replace the
// newest probe's catalogue. Already-created tasks retain their concrete model.
const catalogs = new WeakMap()
// Cordis wraps a Service in a new traceable Proxy on each ctx access. Its
// documented original symbol exposes the stable service identity.
const original = value => value?.[Symbol.for('cordis.original')] ?? value
function catalogEntry(runtime, providerId, cwd) {
  const service = runtimeService(runtime, 'subagents')
  if (!service) throw new Error('外部 Agent 运行时不可用，请重新启动 Desktop')
  const owner = original(service)
  let entries = catalogs.get(owner)
  if (!entries) { entries = new Map(); catalogs.set(owner, entries) }
  const key = JSON.stringify([workspaceRoot(cwd), providerId])
  return { entries, key }
}

export function requireExternalAnalysisProvider(providerId) {
  if (typeof providerId !== 'string' || !providerId.trim()) {
    throw new Error('内部 API 分析支持已移除。请使用 NGA、CodeAgent 或 OpenCode 新建分析；历史任务和结果仍保留。')
  }
  const option = acpProviderOption(providerId)
  if (!option) throw new Error(`未知的 ACP 执行 Agent：${providerId}`)
  if (!option.available) throw new Error(option.resolution_error || `${option.label} 启动命令不可用`)
  return option
}

export function resolveAgentModel(catalog, requestedModel) {
  const ids = new Set((Array.isArray(catalog?.models) ? catalog.models : [])
    .map(item => typeof item?.id === 'string' ? item.id.trim() : '').filter(Boolean))
  if (ids.size === 0) throw new Error('外部 Agent 未返回可用模型，请重新读取模型列表后再创建分析')
  const selected = typeof requestedModel === 'string' ? requestedModel.trim() : ''
  const model = selected || (typeof catalog.current_model === 'string' ? catalog.current_model.trim() : '')
  if (!model || !ids.has(model)) {
    throw new Error(selected ? '所选模型已不在当前 Agent 的可用模型列表中，请重新读取并选择模型' : 'Agent 默认模型尚未确认或已不可用，请从已读取的列表中选择具体模型')
  }
  return model
}

export async function requireAgentModel(runtime, { providerId, cwd, model, catalogId, requireReceipt = false }) {
  requireExternalAnalysisProvider(providerId)
  const provider = runtimeService(runtime, 'subagents')?.getProvider?.(providerId)
  if (!provider) throw new Error(`ACP Provider 未注册：${providerId}`)
  const { entries, key } = catalogEntry(runtime, providerId, cwd)
  let entry = entries.get(key)
  if (requireReceipt) {
    if (!catalogId || entry?.status !== 'ready' || entry.provider !== original(provider) || entry.catalog.catalog_id !== catalogId) {
      throw new Error('模型列表尚未就绪或已被重新读取，请返回执行设置刷新模型列表后重试')
    }
  } else if (entry?.status === 'loading' && entry.provider === original(provider)) {
    await entry.completion
    entry = entries.get(key)
  } else if (entry?.status !== 'ready' || entry.provider !== original(provider)) {
    // Direct host callers and historical tasks must prove readiness too. This
    // discovery still happens before any Run or planning action is created.
    await discoverAgentModels(runtime, { providerId, cwd })
    entry = entries.get(key)
  }
  if (entry?.status !== 'ready') throw new Error('模型列表读取状态已变化，请刷新模型列表后重试')
  return resolveAgentModel(entry.catalog, model)
}

// Query the registered runtime in the same workspace used for analysis. No prompt,
// task, Run, manual catalog or internal API credentials are involved.
export async function discoverAgentModels(runtime, { providerId, cwd, signal, timeoutMs = 40000 }) {
  if (!acpProviderOption(providerId)) throw new Error(`未知的执行 Agent：${providerId}`)
  const provider = runtimeService(runtime, 'subagents')?.getProvider?.(providerId)
  if (!provider?.discoverModels) throw new Error('当前 Agent 运行时不支持读取模型列表，请更新 Desktop')
  const { entries, key } = catalogEntry(runtime, providerId, cwd)
  let complete
  const completion = new Promise(resolve => { complete = resolve })
  const entry = { status: 'loading', catalog: null, provider: original(provider), completion }
  entries.set(key, entry)
  const logs = new LaunchLogStore()
  const diagnosticId = `models-${providerId}-${randomUUID()}`
  const logPath = logs.filePath(diagnosticId)
  let latest = { stage: 'provider_start' }
  let writes = Promise.resolve()
  const observe = value => {
    latest = value
    writes = writes.then(() => logs.append(diagnosticId, { stage: value.stage, status: 'info', provider: providerId,
      cwd, duration_ms: value.durationMs, pid: value.processId, process_exited: value.processExited,
      exit_code: value.exitCode, agent_version: value.agentVersion })).catch(() => {})
  }
  observe(latest)
  const controller = new AbortController()
  const cancel = () => controller.abort(signal.reason)
  if (signal?.aborted) cancel()
  else signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('读取模型列表超时')), timeoutMs)
  try {
    const catalog = await provider.discoverModels({ cwd: workspaceRoot(cwd), signal: controller.signal, onDiagnostic: observe })
    if (controller.signal.aborted) throw controller.signal.reason
    const result = { ...catalog, provider_id: providerId, catalog_id: randomUUID(), diagnostic_log_path: logPath }
    // Empty lists remain displayable, but never authorize creation or startup.
    if (entries.get(key) === entry) { entry.status = 'ready'; entry.catalog = structuredClone(result) }
    return result
  } catch (error) {
    if (entries.get(key) === entry) entry.status = 'error'
    const reason = controller.signal.aborted ? controller.signal.reason : error
    const details = error.diagnostics ?? latest
    const summary = diagnosticText(error.stderrSummary ?? '')
    await writes
    await logs.append(diagnosticId, { stage: error.launchStage ?? details.stage, status: 'error', provider: providerId,
      cwd, error: reason.message, duration_ms: details.durationMs, process_exited: details.processExited,
      exit_code: details.exitCode, stderr_summary: summary }).catch(() => {})
    throw Object.assign(new Error(`${reason.message}；阶段：${error.launchStage ?? details.stage}；诊断日志：${logPath}${summary ? `；stderr：${summary}` : ''}`),
      { diagnostics: { ...details, stderrSummary: summary }, diagnosticLogPath: logPath })
  } finally {
    complete()
    await writes
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}
