// Inspect protocol error envelopes only, never tool output or model/source text.
export function contextLimitError(value) {
  if (typeof value === 'string') return /input too long|exceed max input length|payload too large/i.test(value)
  return value?.name === 'ContextOverflowError' || value?.code === 'ContextOverflowError'
    || contextLimitError(typeof value?.message === 'string' ? value.message : '')
}

export function createAcpRequestErrors() {
  const windows = new Map()
  return {
    begin(taskId, remoteSessionId, requestId) {
      const window = { remoteSessionId, requestId, driverRequestId: null, error: null, accepting: true }
      windows.set(String(taskId), window)
      return window
    },
    observe(taskId, value) {
      const window = windows.get(String(taskId))
      if (!window?.accepting || value.replay === true || !value.request_id) return
      if (value.agent_session_id != null && String(value.agent_session_id) !== String(taskId)) return
      if (window.remoteSessionId && value.remote_session_id !== window.remoteSessionId) return
      // Bind at the driver's prompt boundary, not from arbitrary late updates.
      // The callback itself is retained across reused worker turns.
      if (value.type === 'prompt') {
        window.driverRequestId ??= value.request_id
        return
      }
      if (value.request_id !== window.driverRequestId) return
      const envelope = value.type === 'session_update' ? value.update : value
      if (!['error', 'session.error'].includes(envelope?.type ?? envelope?.sessionUpdate)) return
      const error = envelope.error ?? envelope.properties?.error
      if (!error || !contextLimitError(error)) return
      const message = typeof error === 'string' ? error : error.message ?? error.data?.message ?? 'ContextOverflowError'
      window.error ??= { name: 'ContextOverflowError', message: String(message).slice(0, 8192) }
    },
    contextError(taskId) { return windows.get(String(taskId))?.error },
    end(window) { window.accepting = false },
  }
}
