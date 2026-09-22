// Transport liveness only. No interpretation of model text or analysis quality.
export const ACP_PROGRESS_DEFAULTS = Object.freeze({
  readyWarnMs: 60000, readyIdleMs: 180000, warnMs: 180000,
  idleMs: 600000, cancelMs: 30000, pollMs: 1000,
})

export class AcpStalled extends Error {
  constructor(message, confirmed = false) {
    super(message)
    this.name = 'AcpStalled'
    this.confirmed = confirmed
  }
}

export async function waitForAcpTurn({ worker, turn, signal, ready = false, policy = {}, emit = async () => {} }) {
  const limits = { ...ACP_PROGRESS_DEFAULTS, ...policy }
  for (const value of Object.values(limits)) if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid ACP progress timeout')
  const started = Date.now()
  let lastActivity = started, fingerprint, warned = false, settled = false, interval, abort
  const observed = Promise.resolve(turn).then(value => { settled = true; return value }, error => { settled = true; throw error })
  const stalled = new Promise((_, reject) => {
    interval = setInterval(() => {
      const d = worker.readDiagnostics?.() ?? {}
      const next = JSON.stringify([d.lastActivityAt, d.messageChunks, d.toolCalls, d.lastToolStatus, d.lastToolFinishedAt])
      if (fingerprint !== undefined && fingerprint !== next) { lastActivity = Date.now(); warned = false }
      fingerprint = next
      const idle = Date.now() - lastActivity
      if (!warned && idle >= (ready ? limits.readyWarnMs : limits.warnMs)) {
        warned = true
        void emit({ stage: 'source_first_waiting', status: 'info', duration_ms: idle,
          message: `${ready ? '等待 Agent 就绪' : '等待执行器响应'}，已 ${Math.floor(idle / 1000)} 秒无新事件`,
          last_tool_name: d.lastToolName, last_tool_status: d.lastToolStatus })
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
        if (d.activeToolCount > 0 || (d.activeToolCount === undefined && ['pending', 'in_progress'].includes(d.lastToolStatus))) {
          throw new AcpStalled('原回合已结束，但工具执行状态未确认；已暂停，未重复工具操作')
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
