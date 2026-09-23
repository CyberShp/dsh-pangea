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

export function normalizeFlow(body) {
  const warnings = []
  const alias = (row, key, alternate, where) => {
    if (row[key] != null && row[alternate] != null && row[key] !== row[alternate]) warnings.push(`${where}: ${key} 与 ${alternate} 不一致，按 ${key} 展示；原文保留`)
    return row[key] ?? row[alternate]
  }
  const nodes = list(body.nodes).flatMap((node, index) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) { warnings.push(`nodes[${index}] 不是节点对象`); return [] }
    const id = alias(node, 'id', 'node_id', `nodes[${index}]`)
    const label = alias(node, 'label', 'name', `nodes[${index}]`)
    if (typeof id !== 'string' || !id.trim() || typeof label !== 'string' || !label.trim()) {
      warnings.push(`nodes[${index}] 缺少字符串 id/node_id 或 label/name，未绘制；请查看原文`); return []
    }
    return [{ ...node, id, label, description: alias(node, 'description', '说明', `nodes[${index}]`), source_evidence: node.source_evidence ?? node['源码依据'] }]
  })
  const ids = new Set(nodes.map(n => n.id))
  const duplicate = ids.size !== nodes.length
  if (duplicate) warnings.push('节点 ID 重复，无法可靠定位连线；请修正当前流程原记录')
  const edges = list(body.edges).flatMap((edge, index) => {
    if (!edge || typeof edge !== 'object' || Array.isArray(edge)) { warnings.push(`edges[${index}] 不是连线对象`); return [] }
    const source = alias(edge, 'source_step_key', 'source', `edges[${index}]`)
    const target = alias(edge, 'target_step_key', 'target', `edges[${index}]`)
    if (!ids.has(source) || !ids.has(target) || duplicate) { warnings.push(`edges[${index}] 端点无法对应唯一节点，未绘制；原文保留`); return [] }
    return [{ ...edge, source_step_key: source, target_step_key: target }]
  })
  for (const [index, path] of list(body.paths).entries()) {
    if (list(path?.node_ids).some(id => !ids.has(id))) warnings.push(`paths[${index}] 引用了缺失节点；原文路径保留`)
  }
  if (!nodes.length && !(body.format_version === 'module-flow-text-v1' && typeof body.text === 'string' && body.text.trim())) warnings.push('没有可解析的节点，请查看原文；这不代表分析已完成')
  return { ...body, title: alias(body, 'title', '标题', 'flow'), description: alias(body, 'description', '说明', 'flow'),
    nodes: duplicate ? [] : nodes, edges, projection_warnings: warnings }
}

export function coverageSummary(cases, gaps) {
  const known = Array.isArray(gaps) ? new Set(gaps.map(row => row?.coverage_id).filter(id => typeof id === 'string' && id)) : null
  const refs = new Set(cases.flatMap(row => list(row.coverage_refs).map(ref => typeof ref === 'string' ? ref : ref?.coverage_id)).filter(id => typeof id === 'string' && id))
  return { valid_gaps: known ? known.size : null, coverage_cases: cases.filter(row => row.purpose === 'coverage').length,
    linked_valid_gaps: known ? [...refs].filter(id => known.has(id)).length : null,
    unverified_refs: known ? [...refs].filter(id => !known.has(id)).length : refs.size }
}

export function recordTitle(record, body = mapping(record.body)) {
  if (record.kind === 'flow' && typeof body.title !== 'string' && typeof body['标题'] === 'string') return body['标题']
  if (typeof body.title === 'string' && body.title.trim()) return body.title.trim()
  const first = typeof record.body === 'string' && !Object.keys(body).length ? record.body.trim().split('\n')[0].trim() : ''
  if (first && !/^[\s{}\[\],:|`#*-]+$/.test(first)) return first.replace(/^#{1,6}\s+/, '').slice(0, 120)
  return `${({ unresolved: '待确认事项', summary: '分析总结', note: '分析说明', risk: '风险记录', test_case: '测试用例' })[record.kind] ?? '分析记录'} · ${record.record_id}`
}

export function sourceFirstProjection(artifacts) {
  const result = { risks: [], test_cases: [], evidence: [], business_flows: [], review_issues: [], notes: [] }
  const closureUnits = new Set(artifacts.filter(a => a.stage === 'targeted_closure' && (a.status === 'accepted' || a.delivery_revision != null)).map(a => a.task?.unit_id))
  const delivery = artifacts.filter(a => (a.stage === 'targeted_closure' && (a.status === 'accepted' || a.delivery_revision != null)) || (a.stage === 'unit_analysis' && !closureUnits.has(a.task?.unit_id)))
  const rows = delivery.flatMap(action => activeRecords(action.records ?? []).map(record => {
    const raw = mapping(record.body)
    const body = record.kind === 'flow' ? normalizeFlow(raw) : raw
    const unit = action.task?.unit_id ?? action.action_id
    const originalId = body.risk_id ?? body.case_id ?? body.test_case_id ?? body.flow_id ?? body.coverage_id ?? record.record_id
    return {
      ...body, unit_id: unit, display_id: plain(originalId),
      projection_id: `${unit}/${record.record_id}`,
      title: recordTitle(record, body),
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
    const id = typeof ref === 'string' ? ref : [...keys, 'record_id'].map(key => ref?.[key]).find(Boolean)
    const unit = typeof ref === 'object' ? ref?.unit_id ?? row.unit_id : row.unit_id
    const target = aliases.get(JSON.stringify([unit, id])) ?? (typeof id === 'string' && id.includes('/') ? rows.find(candidate => candidate.projection_id === id) : null)
    return target && kind.includes(target.source_record.kind) ? [target.projection_id] : []
  }))]
  for (const row of rows) {
    const kind = row.source_record.kind
    if (kind === 'risk') {
      result.risks.push({ ...row, risk_id: row.projection_id, severity: plain(row.severity) || undefined,
        narrative: plain(row.narrative ?? row.description), impact: plain(row.impact), expectation: plain(row.expectation ?? row.correct_expectation), current_behavior: plain(row.current_behavior),
        dfx: strings(row.dfx), trigger: plain(row.trigger), system_result: plain(row.system_result ?? row.behavior),
        external_observation: plain(row.external_observation ?? row.user_impact), exclusion_condition: plain(row.exclusion_condition),
        linked_test_case_ids: resolve(row, [...list(row.linked_test_case_ids), ...list(row.related_case_ids), ...list(row.case_ids), ...list(row.source_record.relates_to)], ['case_id', 'test_case_id'], ['test_case', 'test_case_group']), evidence: [],
      })
    } else if (['test_case', 'test_case_group'].includes(kind)) {
      const pairedSteps = list(row.steps ?? row.test_steps).map(step =>
        step && typeof step === 'object'
          ? { action: plain(step.action ?? step.step), expected: plain(step.expected ?? step.expected_result) }
          : { action: plain(step), expected: '' })
      result.test_cases.push({ ...row, test_case_id: row.projection_id,
        case_type: plain(row.case_type ?? row.test_level),
        readiness: row.execution_readiness === 'ready' ? 'ready' : ['needs_instrumentation', 'unknown'].includes(row.execution_readiness) ? 'needs_setup' : 'unclassified',
        missing_execution_conditions: row.execution_readiness === 'ready' ? [] : strings(row.readiness_reason),
        linked_flow_ids: resolve(row, row.flow_refs, ['flow_id'], ['flow']), status: plain(row.status ?? row.execution_status) || '未标注',
        preconditions: strings(row.preconditions ?? row.precondition), step_pairs: pairedSteps,
        steps: pairedSteps.map(step => `${step.action || '未提供操作'}${step.expected ? ` → ${step.expected}` : ''}`),
        variants: list(row.variants).map(value => value && typeof value === 'object' ? { ...value, input: plain(value.input), expected: plain(value.expected) } : { input: plain(value), expected: '' }),
        expected_results: strings(row.expected_results), observability: strings(row.observability ?? row.external_observations), cleanup: strings(row.cleanup),
        linked_risk_ids: resolve(row, [...list(row.linked_risk_ids), ...list(row.risk_refs), ...list(row.source_record.relates_to)], ['risk_id'], ['risk']), evidence: [],
      })
    } else if (kind === 'flow') {
      result.business_flows.push({ ...row, logical_flow_id: row.flow_id ?? row.display_id, text: plain(row.text), flow_id: row.projection_id,
        mainline_steps: list(row.nodes).map(node => ({ step_id: node.id, title: plain(node.label), processing: plain(node.description), node_kind: node.kind, source_evidence: node.source_evidence })),
        branches: list(row.edges).map((edge, index) => {
          const paths = list(row.paths).filter(p => list(p.node_ids).some((id, i, ids) => id === edge.source_step_key && ids[i + 1] === edge.target_step_key))
          // A path is not a decision edge. Never attach its condition to its entry node.
          return { branch_id: `${row.projection_id}:edge-${index + 1}`, edge_index: index,
            from_step_id: edge.source_step_key, to_step_id: edge.target_step_key,
            condition: plain(edge.condition), processing: plain(edge.description ?? edge.explanation),
            path_ids: paths.map(p => p.path_id),
            linked_test_case_ids: resolve(row, edge.case_ids, ['case_id'], ['test_case', 'test_case_group']) }
        }), description: plain(row.description), entry: plain(row.entry ?? row.trigger), steps: strings(row.steps), evidence: [],
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
  for (const testCase of result.test_cases) {
    testCase.unit_notes = result.notes.filter(note => note.unit_id === testCase.unit_id && note.source_record.kind === 'note')
    for (const flow of result.business_flows) {
      if (flow.paths.some(path => path.linked_test_case_ids.includes(testCase.test_case_id))) {
        testCase.linked_flow_ids = [...new Set([...testCase.linked_flow_ids, flow.flow_id])]
      }
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
        risk_ids: owner?.risk_id ? [owner.risk_id] : owner?.linked_risk_ids ?? resolve(row, [...list(row.risk_ids), ...list(row.risk_refs), ...list(row.source_record.relates_to)], ['risk_id'], ['risk']),
      }
      result.evidence.push(item)
      if (owner) owner.evidence.push(item)
      else for (const risk of result.risks) if (item.risk_ids.includes(risk.risk_id)) risk.evidence.push(item)
    }
  }
  return result
}
