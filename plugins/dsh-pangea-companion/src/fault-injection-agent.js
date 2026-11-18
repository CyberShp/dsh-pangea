import { readFile, stat } from 'node:fs/promises'
import { hasUnconfirmedAcpTools } from './acp-progress.js'
import { createDshSession, runtimeService } from './workbench-api.js'
import { requireAgentModel } from './agent-models.js'
import { workspaceRoot } from './pangea-api.js'

export const INJECTION_BUDGET_DEFAULTS = Object.freeze({
  softToolCalls: 18,
  softDurationMs: 8 * 60 * 1000,
  wrapUpDurationMs: 4 * 60 * 1000,
  hardDurationMs: 14 * 60 * 1000,
  cancelGraceMs: 15000,
  idleWaitMs: 5000,
  pollMs: 250,
})

async function executionDiagnostic(worker, outcome) {
  if (outcome?.diagnostic) return outcome.diagnostic
  try { return (await worker.readDiagnostics?.())?.errorSummary || '' } catch { return '' }
}

async function nonEmptyFile(filePath) {
  try { return (await stat(filePath)).size > 0 } catch { return false }
}

export function injectionWrapUpPrompt(outputPath, record) {
  const posixOutput = String(outputPath).replaceAll('\\', '/')
  return [
    '已达到探索步数/耗时预算上限：立即停止目录浏览、grep、构建脚本考古和额外文件读取。',
    `现在直接基于已读取的源码与任务输入构造并写入 ${posixOutput}（任务 ID：${record.id}）。`,
    'edits[].before 只截取能唯一匹配的 1~5 行最短原文；未核实的构建或环境细节如实写入 limitations，不要空转重试。写完立即结束回合。',
  ].join('\n')
}

// A separate user-requested code-generation session. It never binds, settles or
// changes the source-first analysis action that produced the selected cases.
export function createInjectionGenerator(runtime, {
  resolveModel = requireAgentModel,
  createSession = createDshSession,
  budget: defaultBudget = {},
} = {}) {
  return async ({ record, cwd, scratchDirectory, outputPath, prompt, signal, onStarted, onTelemetry, budget: callBudget = {} }) => {
    const limits = { ...INJECTION_BUDGET_DEFAULTS, ...defaultBudget, ...callBudget }
    const root = workspaceRoot(cwd)
    const model = await resolveModel(runtime, { providerId: record.provider_id, model: record.agent_model, cwd: root })
    signal.throwIfAborted()
    const sessionId = await createSession(runtimeService(runtime, 'apiProxy'), root, `PANGEA 打桩 · ${record.id.slice(0, 8)}`)
    const parent = runtimeService(runtime, 'agents')?.get?.(sessionId)
    if (!parent) throw new Error('打桩会话尚未就绪')
    const startedMs = Date.now()
    const seenToolIds = new Set()
    let lastContextUsed = null
    const telemetry = {
      started_at: new Date(startedMs).toISOString(),
      finished_at: null,
      duration_ms: 0,
      turns: 0,
      tool_calls: 0,
      tool_failures: 0,
      tool_kinds: {},
      compactions: 0,
      max_context_tokens: null,
      context_window_tokens: null,
      budget_wrapup_triggered: false,
      budget_wrapup_reason: null,
      stop_reason: null,
    }
    const syncDiagnostics = d => {
      if (!d || typeof d !== 'object') return
      if (Number.isInteger(d.toolCalls) && d.toolCalls > telemetry.tool_calls) telemetry.tool_calls = d.toolCalls
      if (Number.isInteger(d.toolFailures) && d.toolFailures > telemetry.tool_failures) telemetry.tool_failures = d.toolFailures
      if (d.contextUsage && Number.isFinite(d.contextUsage.used)) {
        const used = d.contextUsage.used
        if (lastContextUsed !== null && lastContextUsed - used > 10000) telemetry.compactions += 1
        lastContextUsed = used
        telemetry.max_context_tokens = Math.max(telemetry.max_context_tokens ?? 0, used)
        if (Number.isFinite(d.contextUsage.size)) telemetry.context_window_tokens = d.contextUsage.size
      }
    }
    let sawTurnStart = false
    const onSessionEvent = event => {
      if (event?.type === 'turn_start') { sawTurnStart = true; telemetry.turns += 1 }
      if (event?.type !== 'session_update') return
      const update = event.update
      if (!update || event.replay) return
      if (update.sessionUpdate === 'tool_call') {
        const id = update.toolCallId || `tool-${seenToolIds.size + 1}`
        if (!seenToolIds.has(id)) {
          seenToolIds.add(id)
          telemetry.tool_calls = Math.max(telemetry.tool_calls, seenToolIds.size)
          const kind = typeof update.kind === 'string' && update.kind ? update.kind.slice(0, 32) : 'unknown'
          telemetry.tool_kinds[kind] = (telemetry.tool_kinds[kind] ?? 0) + 1
        }
      }
      if ((update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') && update.status === 'failed') {
        telemetry.tool_failures += 1
      }
      if (update.sessionUpdate === 'usage_update' && Number.isFinite(update.used)) {
        if (lastContextUsed !== null && lastContextUsed - update.used > 10000) telemetry.compactions += 1
        lastContextUsed = update.used
        telemetry.max_context_tokens = Math.max(telemetry.max_context_tokens ?? 0, update.used)
        if (Number.isFinite(update.size)) telemetry.context_window_tokens = update.size
      }
    }
    async function hasActiveTools() {
      try { return hasUnconfirmedAcpTools((await worker?.readDiagnostics?.()) ?? {}) } catch { return false }
    }
    let worker, pollTimer, hardTimer, wrapUpRequested = null
    try {
      worker = await runtimeService(runtime, 'subagents').start(record.provider_id, {
        parent, signal, label: `用例打桩 · ${record.id.slice(0, 8)}`, scratchDirectory,
        pangeaCliWorker: true, agentOptions: { model }, prompt: [{ type: 'text', text: prompt }],
        onSessionEvent, onDiagnostic: syncDiagnostics,
      })
      await onStarted({ owner_session_id: sessionId, agent_session_id: String(worker.id), remote_session_id: worker.remoteSessionId })
      let hardExpired = false
      const hardDeadline = new Promise((_, reject) => {
        hardTimer = setTimeout(() => {
          hardExpired = true
          reject(new Error(`打桩生成超过总时长上限（${Math.round(limits.hardDurationMs / 1000)}s），已终止；任务 ID：${record.id}`))
        }, limits.hardDurationMs)
      })
      hardDeadline.catch(() => {})
      let budgetInterruptResolve
      const budgetInterrupt = new Promise(resolve => { budgetInterruptResolve = resolve })
      pollTimer = setInterval(async () => {
        try {
          if (wrapUpRequested || signal.aborted || hardExpired) return
          const overTools = telemetry.tool_calls >= limits.softToolCalls
          const overTime = Date.now() - startedMs >= limits.softDurationMs
          if (!overTools && !overTime) return
          if (await nonEmptyFile(outputPath)) return
          wrapUpRequested = overTools ? 'tool_budget' : 'time_budget'
          budgetInterruptResolve(wrapUpRequested)
        } catch {}
      }, limits.pollMs)
      const firstRace = await Promise.race([
        Promise.resolve(worker.result).then(outcome => ({ kind: 'done', outcome })),
        budgetInterrupt.then(reason => ({ kind: 'wrapup', reason })),
        hardDeadline,
      ])
      clearInterval(pollTimer); pollTimer = null
      let outcome
      if (firstRace.kind === 'done') {
        outcome = firstRace.outcome
      } else {
        telemetry.budget_wrapup_triggered = true
        telemetry.budget_wrapup_reason = firstRace.reason
        try { await onTelemetry?.({ ...telemetry, duration_ms: Date.now() - startedMs, turns: sawTurnStart ? telemetry.turns : 1, tool_kinds: { ...telemetry.tool_kinds } }) } catch {}
        if (typeof worker.cancelTurn === 'function' && typeof worker.continuePrompt === 'function') {
          let graceTimer
          const cancelled = await Promise.race([
            Promise.resolve().then(() => worker.cancelTurn()),
            new Promise(resolve => { graceTimer = setTimeout(() => resolve(null), limits.cancelGraceMs) }),
          ]).finally(() => clearTimeout(graceTimer))
          signal.throwIfAborted()
          if (await nonEmptyFile(outputPath)) {
            outcome = { stopReason: 'completed' }
          } else if (cancelled?.confirmed) {
            const idleDeadline = Date.now() + limits.idleWaitMs
            while (Date.now() < idleDeadline && await hasActiveTools()) {
              await new Promise(resolve => setTimeout(resolve, 50))
            }
            if (!(await hasActiveTools())) {
              let wrapTimer
              outcome = await Promise.race([
                worker.continuePrompt([{ type: 'text', text: injectionWrapUpPrompt(outputPath, record) }]),
                new Promise((_, reject) => {
                  wrapTimer = setTimeout(() => reject(new Error(`探索预算收口超时（${Math.round(limits.wrapUpDurationMs / 1000)}s），未写出结果文件`)), limits.wrapUpDurationMs)
                }),
                hardDeadline,
              ]).finally(() => clearTimeout(wrapTimer))
            } else {
              throw new Error(`达到探索预算（${firstRace.reason}）后工具未及时静止，已停止以防上下文失控；任务 ID：${record.id}`)
            }
          } else {
            throw new Error(`达到探索预算（${firstRace.reason}）且原回合未能确认取消，已停止；任务 ID：${record.id}`)
          }
        } else {
          outcome = await Promise.race([worker.result, hardDeadline])
        }
      }
      telemetry.stop_reason = outcome?.stopReason ?? null
      signal.throwIfAborted()
      if (outcome.stopReason !== 'completed') throw new Error(await executionDiagnostic(worker, outcome) || `打桩生成结束：${outcome.stopReason}`)
      try { return JSON.parse(await readFile(outputPath, 'utf8')) }
      catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes(error.code)) {
          const diagnostic = await executionDiagnostic(worker, outcome)
          throw new Error(`打桩执行器已结束，但未交付结果文件。请查看执行器会话后重新生成。任务 ID：${record.id}；执行器会话：${worker.remoteSessionId || worker.id || '未提供'}${diagnostic ? `；${diagnostic}` : ''}`)
        }
        throw new Error(`打桩生成结果不可读取：${error.message}`)
      }
    } finally {
      clearInterval(pollTimer)
      clearTimeout(hardTimer)
      if (!sawTurnStart && worker) telemetry.turns = telemetry.budget_wrapup_triggered ? 2 : 1
      telemetry.finished_at = new Date().toISOString()
      telemetry.duration_ms = Date.now() - startedMs
      try { await onTelemetry?.({ ...telemetry, tool_kinds: { ...telemetry.tool_kinds } }) } catch {}
      await worker?.dispose?.()
    }
  }
}
