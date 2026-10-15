// Transport liveness only. No interpretation of model text or analysis quality.
export const ACP_PROGRESS_DEFAULTS = Object.freeze({
  readyWarnMs: 60000, readyIdleMs: 180000, warnMs: 180000,
  idleMs: 600000, cancelMs: 30000, pollMs: 1000,
})

export class AcpStalled extends Error {
  constructor(message, confirmed = false, outcome) {
    super(message)
    this.name = 'AcpStalled'
    this.confirmed = confirmed
    // A real prompt response proves only that the prompt ended. Tool execution
    // must be confirmed separately before a continuation is safe.
    this.outcome = outcome
  }
}

export function hasUnconfirmedAcpTools(diagnostics = {}) {
  return diagnostics.activeToolCount > 0 || (diagnostics.activeToolCount === undefined && ['pending', 'in_progress'].includes(diagnostics.lastToolStatus))
}

export async function waitForAcpTurn({ worker, turn, signal, ready = false, policy = {}, emit = async () => {} }) {
  const limits = { ...ACP_PROGRESS_DEFAULTS, ...policy }
  for (const value of Object.values(limits)) if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid ACP progress timeout')
  const started = performance.now()
  let lastActivity = started, fingerprint, warned = false, settled = false, interval, abort
  const observed = Promise.resolve(turn).then(value => { settled = true; return value }, error => { settled = true; throw error })
  const stalled = new Promise((_, reject) => {
    interval = setInterval(() => {
      const d = worker.readDiagnostics?.() ?? {}
      const next = JSON.stringify([d.lastActivityAt, d.messageChunks, d.toolCalls, d.lastToolStatus, d.lastToolFinishedAt])
      if (fingerprint !== undefined && fingerprint !== next) { lastActivity = performance.now(); warned = false }
      fingerprint = next
      const idle = performance.now() - lastActivity
      if (!warned && idle >= (ready ? limits.readyWarnMs : limits.warnMs)) {
        warned = true
        void emit({ stage: 'source_first_waiting', status: 'info', duration_ms: Math.round(performance.now() - started), idle_duration_ms: Math.round(idle),
          message: `${ready ? '等待 Agent 就绪' : '等待执行器响应'}，已 ${Math.floor(idle / 1000)} 秒无新事件`,
          last_tool_id: d.lastToolId, last_tool_status: d.lastToolStatus, active_tool_count: d.activeToolCount,
          model: d.model ?? null, model_request_timing: 'unavailable', first_token_ms: null })
      }
      if (idle >= (ready ? limits.readyIdleMs : limits.idleMs)) reject(new AcpStalled('执行器长时间无新事件'))
    }, limits.pollMs)
  })
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(signal.reason ?? new Error('执行已取消'))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
  try {
    try { return await Promise.race([observed, stalled, cancelled]) }
    catch (error) {
      if (!(error instanceof AcpStalled)) throw error
      // Give a prompt response already queued in this turn priority over recovery.
      await Promise.resolve()
      if (settled) return await observed
      await emit({ stage: 'source_first_cancel_requested', status: 'info', message: '长时间无响应，正在确认原请求结束；尚未重复发送' })
      if (typeof worker.cancelTurn !== 'function') throw new AcpStalled('执行器不支持确认取消，已暂停；未重复发送')
      let timer
      try {
        const cancellation = Promise.resolve().then(() => worker.cancelTurn())
        const acknowledgement = await Promise.race([
          cancellation,
          new Promise(resolve => { timer = setTimeout(() => resolve(null), limits.cancelMs) }),
          cancelled,
        ])
        if (!acknowledgement?.confirmed) throw new AcpStalled('原请求取消未确认，已暂停；未重复发送')
        await emit({ stage: 'source_first_cancel_confirmed', status: 'ok', message: '原 ACP 回合已结束' })
        if (acknowledgement.outcome?.stopReason === 'completed') return acknowledgement.outcome
        const d = worker.readDiagnostics?.() ?? {}
        if (hasUnconfirmedAcpTools(d)) {
          throw new AcpStalled('原回合已结束，但工具执行状态未确认；已暂停，未重复工具操作', false, acknowledgement.outcome)
        }
        throw new AcpStalled('原回合已确认取消，可以续接原会话', true)
      } catch (error) {
        if (signal.aborted || error instanceof AcpStalled) throw error
        throw new AcpStalled(`取消确认失败，未重复发送：${error.message}`)
      } finally { clearTimeout(timer) }
    }
  } finally {
    clearInterval(interval)
    signal.removeEventListener('abort', abort)
  }
}
