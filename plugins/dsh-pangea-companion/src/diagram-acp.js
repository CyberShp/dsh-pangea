import { waitForAcpTurn, AcpStalled } from './acp-progress.js'

// Diagram generation has its own bounded lifetime; it never advances the analysis Graph.
export async function createDiagramRun({ subagents, provider, parent, prompt, agentModel, signal, onEvent = async () => {},
  inspect, budgetMs = 1200000, progressPolicy, cancelMs = 30000 }) {
  const controller = new AbortController()
  const combined = AbortSignal.any([signal, controller.signal])
  const started = Date.now()
  const budgetError = new Error('图表生成达到执行预算，已停止本次执行；候选图和诊断已保留')
  let timer, worker, settled = false, recovery = 0
  const budget = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(budgetError); reject(budgetError) }, budgetMs) })
  budget.catch(() => {})
  const emit = value => Promise.resolve(onEvent({ duration_ms: Date.now() - started, ...value })).catch(() => {})
  const start = Promise.resolve().then(() => subagents.start(provider, { parent, signal: combined, onDiagnostic: value => {
    if (value.stage === 'tool_event') void emit({ stage: 'diagram_tool_event', last_tool_name: value.lastToolName,
      last_tool_status: value.lastToolStatus, tool_duration_ms: value.lastToolDurationMs })
  }, prompt: [{ type: 'text', text: prompt }],
    ...(agentModel ? { agentOptions: { model: agentModel } } : {}) }))
  try { worker = await Promise.race([start, budget]) }
  catch (error) {
    clearTimeout(timer)
    Promise.resolve(start).then(w => w.dispose?.()).catch(() => {})
    await emit({ stage: 'diagram_start_failed', status: 'error', error: error.message, terminal: true })
    throw error
  }
  const execute = async () => {
    let turn = worker.result
    for (let attempt = 0; attempt < 3; attempt++) {
      combined.throwIfAborted()
      let result
      try {
        result = await waitForAcpTurn({ worker, turn, signal: combined, policy: progressPolicy, emit })
      } catch (error) {
        if (!(error instanceof AcpStalled) || !error.confirmed || recovery++) throw error
        await emit({ stage: 'diagram_recovering', message: '已确认原请求结束，续接原画图会话一次' })
        combined.throwIfAborted()
        turn = worker.continuePrompt([{ type: 'text', text: '继续当前图表，先检查已保存 candidate.json 和 validation-receipt.json，保留有效内容。若已有验证通过产物直接结束，不重做源码分析。' }])
        result = await waitForAcpTurn({ worker, turn, signal: combined, policy: progressPolicy, emit })
      }
      const diagnostics = worker.readDiagnostics?.() ?? {}
      await emit({ stage: 'diagram_turn_finished', status: result.stopReason === 'completed' ? 'info' : 'error',
        stop_reason: result.stopReason, error_summary: diagnostics.errorSummary, stderr_summary: diagnostics.stderrSummary,
        last_tool_name: diagnostics.lastToolName, last_tool_status: diagnostics.lastToolStatus })
      if (result.stopReason !== 'completed') throw new Error(result.diagnostic || diagnostics.errorSummary || `图表回合未正常结束：${result.stopReason}`)
      if (!inspect) return result
      const receipt = await inspect({ signal: combined, attempt: attempt + 1 })
      if (receipt?.ok) return result
      if (attempt === 2 || receipt?.attempts_exhausted || receipt?.terminal) throw new Error(receipt?.error || '三轮生成结束，仍无验证通过产物；已保留候选图')
      combined.throwIfAborted()
      await emit({ stage: 'diagram_repair', message: `图表尚未交付，继续原会话修正，第 ${attempt + 1} 次` })
      turn = worker.continuePrompt([{ type: 'text', text: '当前候选未通过宿主校验。读取 validation-receipt.json 的具体诊断，仅修正 candidate.json，然后结束本回合。宿主将冻结并验证本回合最终字节；不要自行调用渲染命令，不扩大分析，不修改主 Run。' }])
    }
  }
  const result = Promise.race([execute(), budget]).catch(async error => {
    controller.abort(error)
    await emit({ stage: 'diagram_failed', status: 'error', error: error.message, terminal: true,
      error_summary: worker.readDiagnostics?.().errorSummary, stderr_summary: worker.readDiagnostics?.().stderrSummary })
    return { stopReason: 'error', diagnostic: error.message }
  }).finally(() => { settled = true; clearTimeout(timer) })
  return { id: worker.id, remoteSessionId: worker.remoteSessionId, processId: worker.processId, launch: worker.launch,
    result, readOutput: () => worker.readOutput?.() ?? '', readDiagnostics: () => worker.readDiagnostics?.() ?? {},
    async dispose() {
      if (!settled) controller.abort(new Error('停止图表生成'))
      let timeout
      try { await Promise.race([Promise.resolve(worker.dispose?.()), new Promise(resolve => { timeout = setTimeout(resolve, cancelMs) })]) }
      finally { clearTimeout(timeout); clearTimeout(timer) }
    } }
}
