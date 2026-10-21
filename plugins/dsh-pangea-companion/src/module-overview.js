// Read-only projection of facts already published by this Run. No semantic
// stitching: local ids resolve only inside their unit; qualified ids must be exact.
export function buildModuleOverview(run) {
  const flows = run?.details?.business_flows ?? []
  const rows = flows.map((flow, index) => ({ key: JSON.stringify([flow.unit_id ?? '', flow.flow_id ?? '', index]), flow, index }))
  const units = (run?.workflow?.units ?? []).map(unit => ({ ...unit, flows: [] }))
  const unitMap = new Map(units.map(unit => [unit.unit_id, unit]))
  for (const row of rows) {
    const raw = row.flow.source_record?.body
    const attach = raw?.attach_to ?? row.flow.attach_to
    const target = attach?.flow_id
    let candidates = []
    if (target) {
      const matches = other => [other.flow.flow_id, other.flow.logical_flow_id, other.flow.display_id, other.flow.source_record?.body?.flow_id].includes(target)
      const explicit = rows.filter(other => other !== row && matches(other))
      candidates = attach.unit_id != null
        ? explicit.filter(other => other.flow.unit_id === attach.unit_id)
        : explicit.filter(other => other.flow.unit_id === row.flow.unit_id)
      // attach_to is an explicit id reference, including ids without slashes.
      // Cross-unit resolution requires a unique exact id, never a label match.
      if (attach.unit_id == null && !candidates.length) candidates = explicit
    }
    row.parent_key = candidates.length === 1 ? candidates[0].key : null
    row.relationship = !target ? '未声明挂接' : candidates.length !== 1 ? `挂接目标${candidates.length ? '不唯一' : '缺失'}：${target}` : `挂接到 ${candidates[0].flow.title || target}${attach.node_id ? ` / ${attach.node_id}` : ''}`
    if (row.parent_key && attach.node_id) {
      const parent = candidates[0].flow
      const ids = (parent.nodes ?? parent.mainline_steps ?? []).map(node => node.id ?? node.step_id)
      if (!ids.includes(attach.node_id)) row.relationship += '（节点引用缺失）'
    }
    row.entries = (row.flow.nodes ?? []).filter(node => node.kind === 'entry')
    row.main_paths = (row.flow.paths ?? []).filter(path => Array.isArray(row.flow.main_path_ids) && row.flow.main_path_ids.includes(path.path_id))
    row.main_path_ids = row.flow.main_path_ids ?? null
    row.calls = Array.isArray(row.flow.call_graph?.calls) ? row.flow.call_graph.calls : []
    row.call_root = row.flow.call_graph?.root ?? null
    row.category = row.flow.role === 'main' ? '主干' : row.parent_key ? '子流程' : '未挂接项'
    if (!unitMap.has(row.flow.unit_id)) {
      const unit = { unit_id: row.flow.unit_id ?? '', title: row.flow.unit_id || '单元归属未提供', flows: [], unlisted: true }
      unitMap.set(row.flow.unit_id, unit); units.push(unit)
    }
    unitMap.get(row.flow.unit_id).flows.push(row)
  }
  return { units, flows: rows, note: '仅汇总当前 Run 的冻结单元与已发布关系；未声明的跨单元关系和业务完整性保持未知。' }
}
