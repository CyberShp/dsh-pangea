import { acpProviderOption, runtimeService } from './workbench-api.js'
import { workspaceRoot } from './pangea-api.js'

// Query the registered runtime in the same workspace used for analysis. No prompt,
// task, Run, manual catalog or internal API credentials are involved.
export async function discoverAgentModels(runtime, { providerId, cwd, signal, timeoutMs = 20000 }) {
  if (!acpProviderOption(providerId)) throw new Error(`未知的执行 Agent：${providerId}`)
  const provider = runtimeService(runtime, 'subagents')?.getProvider?.(providerId)
  if (!provider?.discoverModels) throw new Error('当前 Agent 运行时不支持读取模型列表，请更新 Desktop')
  const controller = new AbortController()
  const cancel = () => controller.abort(signal.reason)
  if (signal?.aborted) cancel()
  else signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('读取模型列表超时，请检查 Agent 登录状态后重试')), timeoutMs)
  try {
    const catalog = await provider.discoverModels({ cwd: workspaceRoot(cwd), signal: controller.signal })
    if (controller.signal.aborted) throw controller.signal.reason
    return { provider_id: providerId, ...catalog }
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}
