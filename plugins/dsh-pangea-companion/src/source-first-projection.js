// Project explicit Agent records into the workbench's existing collections.
// Record bodies remain available verbatim; this layer makes no semantic judgments.
const list = value => Array.isArray(value) ? value : value == null ? [] : [value]
const plain = value => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2)
const strings = value => list(value).map(plain)
function mapping(body) {
  if (body && typeof body === 'object' && !Array.isArray(body)) return body
  try { const parsed = JSON.parse(body); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {} } catch { return {} }
}
function activeRecords(records) {
  const known = new Set(), retired = new Set()
  for (const record of records) {
    for (const id of list(record.supersedes)) if (known.has(id)) retired.add(id)
    known.add(record.record_id)
  }
  return records.filter(record => !retired.has(record.record_id))
}

export function sourceFirstProjection(artifacts) {
  const result = { risks: [], test_cases: [], evidence: [], business_flows: [], review_issues: [], notes: [] }
  const closureUnits = new Set(artifacts.filter(a => a.stage === 'targeted_closure' && a.status === 'accepted').map(a => a.task?.unit_id))
  const delivery = artifacts.filter(a => (a.stage === 'targeted_closure' && a.status === 'accepted') || (a.stage === 'unit_analysis' && !closureUnits.has(a.task?.unit_id)))
  const rows = delivery.flatMap(action => activeRecords(action.records ?? []).map(record => {
    const body = mapping(record.body)
    const unit = action.task?.unit_id ?? action.action_id
    const originalId = body.risk_id ?? body.case_id ?? body.test_case_id ?? body.flow_id ?? body.coverage_id ?? record.record_id
    return {
      ...body, unit_id: unit, display_id: plain(originalId),
      projection_id: `${unit}/${record.record_id}`,
      title: plain(body.title) || plain(record.body).split('\n')[0].slice(0, 120) || record.record_id,
      source_record: { ...record, action_id: action.action_id, task_id: action.task_id, revision: action.revision, status: action.status, result_path: action.result_path },
    }
  }))
  const aliases = new Map()
  for (const row of rows) {
    for (const id of new Set([row.display_id, row.source_record.record_id])) {
      const key = JSON.stringify([row.unit_id, id])
      aliases.set(key, aliases.has(key) ? null : row)
    }
  }
  const resolve = (row, refs, keys, kind) => [...new Set(list(refs).flatMap(ref => {
    const id = typeof ref === 'string' ? ref : keys.map(key => ref?.[key]).find(Boolean)
    const unit = typeof ref === 'object' ? ref?.unit_id ?? row.unit_id : row.unit_id
    const target = aliases.get(JSON.stringify([unit, id]))
    return target && kind.includes(target.source_record.kind) ? [target.projection_id] : []
  }))]
  for (const row of rows) {
    const kind = row.source_record.kind
    if (kind === 'risk') {
      result.risks.push({ ...row, risk_id: row.projection_id, severity: plain(row.severity) || undefined,
        dfx: strings(row.dfx), trigger: plain(row.trigger), system_result: plain(row.system_result ?? row.behavior),
        external_observation: plain(row.external_observation ?? row.user_impact), exclusion_condition: plain(row.exclusion_condition),
        linked_test_case_ids: resolve(row, [...list(row.linked_test_case_ids), ...list(row.related_case_ids), ...list(row.source_record.relates_to)], ['case_id', 'test_case_id'], ['test_case', 'test_case_group']), evidence: [],
      })
    } else if (['test_case', 'test_case_group'].includes(kind)) {
      result.test_cases.push({ ...row, test_case_id: row.projection_id,
        case_type: plain(row.case_type ?? row.test_level), status: plain(row.status ?? row.execution_status) || '未标注',
        preconditions: strings(row.preconditions), steps: list(row.steps).map(step => typeof step === 'object' && step ? `${plain(step.action ?? step)}${step.expected ?? step.expected_result ? ` → ${plain(step.expected ?? step.expected_result)}` : ''}` : plain(step)),
        expected_results: strings(row.expected_results), observability: strings(row.observability ?? row.external_observations), cleanup: strings(row.cleanup),
        linked_risk_ids: resolve(row, [...list(row.linked_risk_ids), ...list(row.risk_refs), ...list(row.source_record.relates_to)], ['risk_id'], ['risk']), evidence: [],
      })
    } else if (kind === 'flow') {
      result.business_flows.push({ ...row, flow_id: row.projection_id, description: plain(row.description), entry: plain(row.entry), steps: strings(row.steps), evidence: [],
        paths: list(row.paths).map(p => ({ ...p, linked_test_case_ids: resolve(row, p.case_ids, ['case_id'], ['test_case', 'test_case_group']) })),
      })
    } else if (!['evidence', 'blackbox_translation'].includes(kind)) result.notes.push(row)
  }
  // Reverse only explicit associations, within the referenced unit.
  for (const risk of result.risks) for (const testCase of result.test_cases) {
    if (risk.linked_test_case_ids.includes(testCase.test_case_id) || testCase.linked_risk_ids.includes(risk.risk_id)) {
      risk.linked_test_case_ids = [...new Set([...risk.linked_test_case_ids, testCase.test_case_id])]
      testCase.linked_risk_ids = [...new Set([...testCase.linked_risk_ids, risk.risk_id])]
    }
  }
  for (const row of rows) {
    const owner = [...result.risks, ...result.test_cases, ...result.business_flows].find(item => item.projection_id === row.projection_id)
    const refs = [...list(row.source_record.evidence), ...list(row.evidence), ...list(row.source_evidence)]
    if (['evidence', 'blackbox_translation'].includes(row.source_record.kind)) refs.unshift({ location: row.location, observation: row.observation ?? plain(row.source_record.body) })
    const seen = new Set()
    for (const ref of refs) {
      const location = typeof ref === 'string' ? ref : plain(ref?.location) || (ref?.repo_id && ref?.path ? `${ref.repo_id}:${ref.path}${ref.line_start ? `:${ref.line_start}${ref.line_end ? `-${ref.line_end}` : ''}` : ''}` : '')
      const observation = typeof ref === 'object' && ref ? plain(ref.observation ?? ref.note) : ''
      const signature = JSON.stringify([location, observation])
      if (seen.has(signature)) continue
      seen.add(signature)
      const item = { ...row, chunk_id: `${row.projection_id}/evidence-${seen.size}`, location, observation: observation || row.title,
        risk_ids: owner?.risk_id ? [owner.risk_id] : owner?.linked_risk_ids ?? resolve(row, row.risk_ids ?? row.risk_refs, ['risk_id'], ['risk']),
      }
      result.evidence.push(item)
      if (owner) owner.evidence.push(item)
    }
  }
  return result
}
