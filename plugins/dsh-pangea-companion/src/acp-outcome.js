const ATTENTION_REQUIRED_CODE = 'PANGEA_CONTINUATION_STALLED'

function attentionRequiredOutcome(message) {
  return {
    status: 'failed',
    detail: JSON.stringify({ code: ATTENTION_REQUIRED_CODE, message }),
  }
}

function decodeAcpOutcomeDetail(detail) {
  if (typeof detail !== 'string' || !detail.startsWith('{')) return null
  try {
    const value = JSON.parse(detail)
    if (value?.code !== ATTENTION_REQUIRED_CODE || typeof value?.message !== 'string') return null
    return value
  } catch {
    return null
  }
}

export { ATTENTION_REQUIRED_CODE, attentionRequiredOutcome, decodeAcpOutcomeDetail }
