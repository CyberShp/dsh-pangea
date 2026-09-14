import { randomUUID } from 'node:crypto'
import { LaunchLogStore, diagnosticText } from './launch-log.js'
import { acpProviderOption, runtimeService } from './workbench-api.js'
import { workspaceRoot } from './pangea-api.js'

// Query the registered runtime in the same workspace used for analysis. No prompt,
// task, Run, manual catalog or internal API credentials are involved.
export async function discoverAgentModels(runtime, { providerId, cwd, signal, timeoutMs = 20000 }) {
  if (!acpProviderOption(providerId)) throw new Error(`未知的执行 Agent：${providerId}`)
  const provider = runtimeService(runtime, 'subagents')?.getProvider?.(providerId)
  if (!provider?.discoverModels) throw new Error('当前 Agent 运行时不支持读取模型列表，请更新 Desktop')
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
    return { provider_id: providerId, ...catalog, diagnostic_log_path: logPath }
  } catch (error) {
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
    await writes
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}
