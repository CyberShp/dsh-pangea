// Current warning projections only. Saved results/progress retain full history.
import { activeDiagramDiagnostics } from './diagram-contract.js'

const list = value => Array.isArray(value) ? value : []
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const RECORD_WARNING_KINDS = new Set(['flow_path_hint', 'risk_contract_hint', 'planning_contract_hint',
  'check_contract_hint', 'review_check_contract_hint', 'review_check_reference_hint',
  'evidence_quote_mismatch', 'diagram_format_diagnostic'])

export function retiredResultWarnings(result) {
  const known = new Map(), retired = new Set()
  for (const record of list(result?.records)) {
    for (const id of list(record.supersedes)) if (typeof id === 'string' && known.has(id)) retired.add(id)
    known.set(record.record_id, record)
  }
  return list(result?.warnings).filter(warning => object(warning) && RECORD_WARNING_KINDS.has(warning.kind)
    && typeof warning.record_id === 'string' && retired.has(warning.record_id)
    && ['run_id', 'action_id', 'task_id', 'data_root'].every(key => !Object.hasOwn(warning, key) || warning[key] === result.binding?.[key])
    && (!Object.hasOwn(warning, 'record_revision') || warning.record_revision === known.get(warning.record_id)?.created_revision)
    && (warning.kind !== 'diagram_format_diagnostic' || Object.hasOwn(warning, 'record_revision')
      && ['run_id', 'action_id', 'task_id'].every(key => warning[key] === result.binding?.[key])))
}

export function currentResultWarnings(result) {
  const retired = new Set(retiredResultWarnings(result)), diagrams = new Set(activeDiagramDiagnostics(result))
  return list(result?.warnings).filter(warning => warning?.kind === 'diagram_format_diagnostic'
    ? diagrams.has(warning) : !retired.has(warning))
}

// The legacy validation bridge flattened record warnings into a message plus
// action_id. Remove only exact mirrored retired messages, using that action's
// already verified result. A current identical message or unidentified warning
// keeps the degradation visible; message similarity never supplies an identity.
export function currentWarningDegradations(degradations, artifacts) {
  const results = new Map()
  for (const artifact of list(artifacts)) {
    const result = artifact?.runtime_result
    if (artifact?.binding_status !== 'bound' || !result || result.binding?.action_id !== artifact.action_id
      || result.binding?.task_id !== artifact.task_id) continue
    results.set(artifact.action_id, results.has(artifact.action_id) ? null : result)
  }
  return list(degradations).filter(item => {
    const result = object(item) ? results.get(item.action_id) : null
    if (!result || item.kind !== 'agent_result_warning' || typeof item.message !== 'string') return true
    const source = object(item.source_warning) ? item.source_warning : item
    if (['run_id', 'action_id', 'task_id', 'data_root'].some(key => Object.hasOwn(source, key) && source[key] !== result.binding?.[key])) return true
    const sameMessage = warning => warning?.message === item.message
    const retired = retiredResultWarnings(result).filter(warning => sameMessage(warning)
      && (!Object.hasOwn(source, 'record_id') || source.record_id === warning.record_id)
      && (!Object.hasOwn(source, 'record_revision') || source.record_revision === warning.record_revision))
    return !retired.length || currentResultWarnings(result).some(sameMessage)
  })
}
