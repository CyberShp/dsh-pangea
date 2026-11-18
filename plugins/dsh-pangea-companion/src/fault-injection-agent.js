import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { hasUnconfirmedAcpTools } from './acp-progress.js'
import { createDshSession, runtimeService } from './workbench-api.js'
import { requireAgentModel } from './agent-models.js'
import { workspaceRoot } from './pangea-api.js'

export const INJECTION_BUDGET_DEFAULTS = Object.freeze({
  softToolCalls: 18,
  softDurationMs: 10 * 60 * 1000,
  wrapUpDurationMs: 6 * 60 * 1000,
  progressLeaseMs: 3 * 60 * 1000,
  hardDurationMs: 25 * 60 * 1000,
  cancelGraceMs: 15000,
  idleWaitMs: 5000,
  pollMs: 250,
})

const AUTHORING_TOOL_KIND = /^(?:edit|write|patch|create|apply_patch|delete|move)$/i
const IGNORED_SCRATCH_FILES = new Set(['input.json', 'reference-result.json', 'authored-result.json'])

async function executionDiagnostic(worker, outcome) {
  if (outcome?.diagnostic) return outcome.diagnostic
  try { return (await worker.readDiagnostics?.())?.errorSummary || '' } catch { return '' }
}

async function nonEmptyFile(filePath) {
  try { return (await stat(filePath)).size > 0 } catch { return false }
}

async function readValidOutputJson(filePath) {
  try {
    const st = await stat(filePath)
    if (!st.isFile() || st.size === 0) return null
    const parsed = JSON.parse(await readFile(filePath, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch { return null }
}

async function scratchFingerprint(scratchDirectory) {
  if (!scratchDirectory) return ''
  try {
    const entries = await readdir(scratchDirectory, { withFileTypes: true })
    const parts = []
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || IGNORED_SCRATCH_FILES.has(entry.name)) continue
      try {
        const st = await stat(path.join(scratchDirectory, entry.name))
        parts.push(`${entry.name}:${st.size}:${Math.trunc(st.mtimeMs)}`)
      } catch {}
    }
    return parts.join('|')
  } catch { return '' }
}

function isAuthoringToolUpdate(update, scratchDirectory, outputPath) {
  const kind = typeof update?.kind === 'string' ? update.kind.trim() : ''
  if (AUTHORING_TOOL_KIND.test(kind)) return true
  const outName = outputPath ? path.basename(outputPath) : 'result.json'
  const scratchNorm = scratchDirectory ? String(scratchDirectory).replaceAll('\\', '/') : ''
  const parts = []
  if (typeof update?.title === 'string') parts.push(update.title)
  if (typeof update?.rawInput === 'string') parts.push(update.rawInput)
  else if (update?.rawInput && typeof update.rawInput === 'object') {
    try { parts.push(JSON.stringify(update.rawInput)) } catch {}
  }
  if (Array.isArray(update?.locations)) {
    for (const loc of update.locations) if (typeof loc?.path === 'string') parts.push(loc.path)
  }
  const blob = parts.join(' ').replaceAll('\\', '/')
  if (!blob) return false
  if (outName && blob.includes(outName) && /(?:write|Set-Content|Out-File|json\.dump|write_text|open\s*\(|>)/i.test(blob)) return true
  if (scratchNorm && scratchNorm !== '/' && blob.includes(scratchNorm) && /(?:write|Set-Content|Out-File|json\.dump|write_text|open\s*\(|>|\.py\b|\.mjs\b)/i.test(blob)) return true
  return false
}

export function injectionWrapUpPrompt(outputPath, record) {
  const posixOutput = String(outputPath).replaceAll('\\', '/')
  return [
    '已达到探索步数/耗时预算上限：立即停止目录浏览、grep、构建脚本考古和额外文件读取。',
    `现在直接基于已读取的源码与任务输入构造并写入 ${posixOutput}（任务 ID：${record.id}）。`,
    'edits[].before 只截取能唯一匹配的 1~5 行最短原文；steps 数组禁止包含空字符串 ""；未核实的构建或环境细节如实写入 limitations，不要空转重试。写完立即结束回合。',
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
    const explicitSoftTools = callBudget.softToolCalls !== undefined || defaultBudget.softToolCalls !== undefined
    const baseLimits = { ...INJECTION_BUDGET_DEFAULTS, ...defaultBudget, ...callBudget }
    const extraCases = Math.min(Math.max(0, (Array.isArray(record?.case_keys) ? record.case_keys.length : 1) - 1), 6)
    const limits = {
      ...baseLimits,
      softToolCalls: explicitSoftTools ? baseLimits.softToolCalls : baseLimits.softToolCalls + extraCases * 4,
      progressLeaseMs: callBudget.progressLeaseMs ?? defaultBudget.progressLeaseMs
        ?? (callBudget.wrapUpDurationMs !== undefined || defaultBudget.wrapUpDurationMs !== undefined
          ? baseLimits.wrapUpDurationMs
          : baseLimits.progressLeaseMs),
    }
    const root = workspaceRoot(cwd)
    const model = await resolveModel(runtime, { providerId: record.provider_id, model: record.agent_model, cwd: root })
    signal.throwIfAborted()
    const sessionId = await createSession(runtimeService(runtime, 'apiProxy'), root, `PANGEA 打桩 · ${record.id.slice(0, 8)}`)
    const parent = runtimeService(runtime, 'agents')?.get?.(sessionId)
    if (!parent) throw new Error('打桩会话尚未就绪')
    const startedMs = Date.now()
    const seenToolIds = new Set()
    const authoringToolIds = new Set()
    const activeAuthoringIds = new Set()
    const activeExploreIds = new Set()
    let lastContextUsed = null
    let lastProgressMs = startedMs
    const telemetry = {
      started_at: new Date(startedMs).toISOString(),
      finished_at: null,
      duration_ms: 0,
      turns: 0,
      tool_calls: 0,
      explore_tool_calls: 0,
      authoring_tool_calls: 0,
      soft_tool_budget: limits.softToolCalls,
      tool_failures: 0,
      tool_kinds: {},
      compactions: 0,
      max_context_tokens: null,
      context_window_tokens: null,
      budget_wrapup_triggered: false,
      budget_wrapup_reason: null,
      salvaged_disk_result: false,
      stop_reason: null,
    }
    const markProgress = () => { lastProgressMs = Date.now() }
    const syncDiagnostics = d => {
      if (!d || typeof d !== 'object') return
      if (Number.isInteger(d.toolCalls) && d.toolCalls > telemetry.tool_calls) telemetry.tool_calls = d.toolCalls
      if (Number.isInteger(d.toolFailures) && d.toolFailures > telemetry.tool_failures) telemetry.tool_failures = d.toolFailures
      if (Number.isInteger(d.messageChunks) && d.messageChunks > 0) markProgress()
      if (d.contextUsage && Number.isFinite(d.contextUsage.used)) {
        const used = d.contextUsage.used
        if (lastContextUsed !== null && lastContextUsed - used > 10000) telemetry.compactions += 1
        lastContextUsed = used
        telemetry.max_context_tokens = Math.max(telemetry.max_context_tokens ?? 0, used)
        if (Number.isFinite(d.contextUsage.size)) telemetry.context_window_tokens = d.contextUsage.size
      }
    }
    let sawTurnStart = false
    const terminalToolStatus = status => ['completed', 'failed', 'cancelled'].includes(status)
    const onSessionEvent = event => {
      if (event?.type === 'turn_start') { sawTurnStart = true; telemetry.turns += 1; markProgress() }
      if (event?.type !== 'session_update') return
      const update = event.update
      if (!update || event.replay) return
      markProgress()
      if (update.sessionUpdate === 'tool_call') {
        const id = update.toolCallId || `tool-${seenToolIds.size + 1}`
        const isAuthoring = isAuthoringToolUpdate(update, scratchDirectory, outputPath)
        if (!seenToolIds.has(id)) {
          seenToolIds.add(id)
          telemetry.tool_calls = Math.max(telemetry.tool_calls, seenToolIds.size)
          const kind = typeof update.kind === 'string' && update.kind ? update.kind.slice(0, 32) : 'unknown'
          telemetry.tool_kinds[kind] = (telemetry.tool_kinds[kind] ?? 0) + 1
          if (isAuthoring) {
            authoringToolIds.add(id)
            telemetry.authoring_tool_calls += 1
          } else {
            telemetry.explore_tool_calls += 1
          }
        }
        if (terminalToolStatus(update.status)) {
          activeAuthoringIds.delete(id)
          activeExploreIds.delete(id)
        } else if (authoringToolIds.has(id) || isAuthoring) {
          activeAuthoringIds.add(id)
        } else {
          activeExploreIds.add(id)
        }
      }
      if (update.sessionUpdate === 'tool_call_update' && update.toolCallId) {
        if (terminalToolStatus(update.status)) {
          activeAuthoringIds.delete(update.toolCallId)
          activeExploreIds.delete(update.toolCallId)
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
    let worker, pollTimer, wrapWatchTimer, hardTimer, wrapUpRequested = null
    try {
      const initialScratchState = await scratchFingerprint(scratchDirectory)
      let lastScratchState = initialScratchState
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
          const currentScratch = await scratchFingerprint(scratchDirectory)
          if (currentScratch !== lastScratchState) {
            lastScratchState = currentScratch
            markProgress()
          }
          const exploreCount = seenToolIds.size > 0 ? telemetry.explore_tool_calls : telemetry.tool_calls
          const overTools = exploreCount >= limits.softToolCalls
          const overTime = Date.now() - startedMs >= limits.softDurationMs
          if (!overTools && !overTime) return
          // Never abort while the model is actively authoring files or after it has
          // already started writing artifacts into scratchDirectory / outputPath.
          if (activeAuthoringIds.size > 0 || telemetry.authoring_tool_calls > 0) return
          if (await nonEmptyFile(outputPath)) return
          if (currentScratch !== initialScratchState) return
          // On soft wall-clock expiry, if no exploration tool is running and chunks
          // are actively streaming, let the model finish writing its output.
          if (!overTools && overTime && activeExploreIds.size === 0 && Date.now() - lastProgressMs < limits.progressLeaseMs) return
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
              const wrapStartedMs = Date.now()
              markProgress()
              let wrapDeadlineMs = wrapStartedMs + limits.wrapUpDurationMs
              let lastLeaseProgressMs = lastProgressMs
              let lastDiagChunks = null
              const wrapWatch = new Promise((_, reject) => {
                wrapWatchTimer = setInterval(async () => {
                  try {
                    if (signal.aborted || hardExpired) return
                    const currentScratch = await scratchFingerprint(scratchDirectory)
                    if (currentScratch !== lastScratchState) {
                      lastScratchState = currentScratch
                      markProgress()
                    }
                    try {
                      const diag = await worker.readDiagnostics?.()
                      if (Number.isInteger(diag?.messageChunks)) {
                        if (lastDiagChunks !== null && diag.messageChunks > lastDiagChunks) markProgress()
                        lastDiagChunks = diag.messageChunks
                      }
                    } catch {}
                    if (lastProgressMs > lastLeaseProgressMs) {
                      lastLeaseProgressMs = lastProgressMs
                      wrapDeadlineMs = Math.max(wrapDeadlineMs, lastProgressMs + limits.progressLeaseMs)
                    }
                    if (Date.now() < wrapDeadlineMs) return
                    if (activeAuthoringIds.size > 0) return
                    if (await readValidOutputJson(outputPath)) return
                    clearInterval(wrapWatchTimer); wrapWatchTimer = null
                    reject(new Error(`探索预算收口超时（${Math.round((Date.now() - wrapStartedMs) / 1000)}s 内无有效写出完成），未写出结果文件`))
                    try { await worker.cancelTurn?.() } catch {}
                  } catch {}
                }, Math.max(20, Math.min(limits.pollMs, 200)))
              })
              wrapWatch.catch(() => {})
              const continueTurn = Promise.resolve().then(() => worker.continuePrompt([{ type: 'text', text: injectionWrapUpPrompt(outputPath, record) }]))
              continueTurn.catch(() => {})
              outcome = await Promise.race([
                continueTurn,
                wrapWatch,
                hardDeadline,
              ]).finally(() => { clearInterval(wrapWatchTimer); wrapWatchTimer = null })
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
      if (outcome.stopReason !== 'completed') {
        const salvaged = await readValidOutputJson(outputPath)
        if (salvaged && Array.isArray(salvaged.edits) && salvaged.edits.length > 0) {
          telemetry.salvaged_disk_result = true
          return salvaged
        }
        throw new Error(await executionDiagnostic(worker, outcome) || `打桩生成结束：${outcome.stopReason}`)
      }
      try { return JSON.parse(await readFile(outputPath, 'utf8')) }
      catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes(error.code)) {
          const diagnostic = await executionDiagnostic(worker, outcome)
          throw new Error(`打桩执行器已结束，但未交付结果文件。请查看执行器会话后重新生成。任务 ID：${record.id}；执行器会话：${worker.remoteSessionId || worker.id || '未提供'}${diagnostic ? `；${diagnostic}` : ''}`)
        }
        throw new Error(`打桩生成结果不可读取：${error.message}`)
      }
    } catch (error) {
      if (!signal.aborted) {
        const salvaged = await readValidOutputJson(outputPath)
        if (salvaged && Array.isArray(salvaged.edits) && salvaged.edits.length > 0) {
          telemetry.salvaged_disk_result = true
          return salvaged
        }
      }
      throw error
    } finally {
      clearInterval(pollTimer)
      clearInterval(wrapWatchTimer)
      clearTimeout(hardTimer)
      if (!sawTurnStart && worker) telemetry.turns = telemetry.budget_wrapup_triggered ? 2 : 1
      telemetry.finished_at = new Date().toISOString()
      telemetry.duration_ms = Date.now() - startedMs
      try { await onTelemetry?.({ ...telemetry, tool_kinds: { ...telemetry.tool_kinds } }) } catch {}
      await worker?.dispose?.()
    }
  }
}
