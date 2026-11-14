import { readFile } from 'node:fs/promises'
import { createDshSession, runtimeService } from './workbench-api.js'
import { requireAgentModel } from './agent-models.js'
import { workspaceRoot } from './pangea-api.js'

// A separate user-requested code-generation session. It never binds, settles or
// changes the source-first analysis action that produced the selected cases.
export function createInjectionGenerator(runtime, { resolveModel = requireAgentModel, createSession = createDshSession } = {}) {
  return async ({ record, cwd, scratchDirectory, outputPath, prompt, signal, onStarted }) => {
    const root = workspaceRoot(cwd)
    const model = await resolveModel(runtime, { providerId: record.provider_id, model: record.agent_model, cwd: root })
    signal.throwIfAborted()
    const sessionId = await createSession(runtimeService(runtime, 'apiProxy'), root, `PANGEA 打桩 · ${record.id.slice(0, 8)}`)
    const parent = runtimeService(runtime, 'agents')?.get?.(sessionId)
    if (!parent) throw new Error('打桩会话尚未就绪')
    let worker
    try {
      worker = await runtimeService(runtime, 'subagents').start(record.provider_id, {
        parent, signal, label: `用例打桩 · ${record.id.slice(0, 8)}`, scratchDirectory,
        pangeaCliWorker: true, agentOptions: { model }, prompt: [{ type: 'text', text: prompt }],
      })
      await onStarted({ owner_session_id: sessionId, agent_session_id: String(worker.id), remote_session_id: worker.remoteSessionId })
      const outcome = await worker.result
      signal.throwIfAborted()
      if (outcome.stopReason !== 'completed') throw new Error(outcome.diagnostic || `打桩生成结束：${outcome.stopReason}`)
      try { return JSON.parse(await readFile(outputPath, 'utf8')) }
      catch (error) { throw new Error(`打桩生成结果不可读取：${error.message}`) }
    } finally { await worker?.dispose?.() }
  }
}
