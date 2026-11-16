export async function requestAgentModels({ providerId, cwd, signal, fetcher = fetch }) {
  const response = await fetcher('/api/pangea-companion/acp-settings', {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal,
    body: JSON.stringify({ action: 'models', provider_id: providerId, cwd }),
  })
  const body = await response.json()
  if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
  return body
}

export function analysisExecutionState(form, providers, state, cwd) {
  const providerId = form.provider_id
  const provider = (providers ?? []).find(item => item.id === providerId)
  const blocked = message => ({ ready: false, model: '', catalogId: '', message })
  if (!providerId) return blocked(form.external_selection_required ? '历史分析使用内部 API，请重新选择外部 Agent 和模型。' : '请选择已加载的外部 Agent。')
  if (provider?.registered !== true) return blocked('所选外部 Agent 尚未加载，请检查 Agent 设置。')
  if (state?.cwd !== cwd || state?.provider_id !== providerId || ['idle', 'loading'].includes(state?.status) || !state?.status) return blocked('正在读取 Agent 可用模型，请等待完成后再继续。')
  if (state.status === 'error') return blocked(state.error || '模型列表读取失败，请刷新模型后重试。')
  const catalog = state.catalog
  if (state.status !== 'ready' || catalog?.provider_id !== providerId || !catalog?.catalog_id) return blocked('模型列表尚未确认，请刷新模型后重试。')
  const models = Array.isArray(catalog.models) ? catalog.models : []
  const model = form.agent_model || catalog.current_model
  if (!model) return blocked(models.length ? 'Agent 未返回有效默认模型，请明确选择一个模型。' : 'Agent 未返回可用模型，请检查 Agent 配置后刷新模型。')
  if (!models.some(item => item.id === model)) return blocked(form.agent_model ? '原选择的模型已不在当前列表中，请重新选择。' : 'Agent 默认模型不在当前可用列表中，请明确选择一个模型。')
  return { ready: true, model, catalogId: catalog.catalog_id, message: `已确认模型：${model}` }
}

export function loadAnalysisAgentModels({ providerId, cwd, onState, fetcher = fetch }) {
  const controller = new AbortController()
  const scope = { provider_id: providerId, cwd }
  onState({ ...scope, status: 'loading' })
  requestAgentModels({ providerId, cwd, signal: controller.signal, fetcher }).then(catalog => {
    if (controller.signal.aborted) return
    if (catalog.provider_id !== providerId) throw new Error('返回的模型列表与所选 Agent 不一致，请重试。')
    onState({ ...scope, status: 'ready', catalog })
  }).catch(failure => {
    if (!controller.signal.aborted) onState({ ...scope, status: 'error', error: failure instanceof Error ? failure.message : String(failure) })
  })
  return () => controller.abort()
}

