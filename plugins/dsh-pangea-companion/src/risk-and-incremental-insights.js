const RISK_WARNING_KINDS = new Set(['evidence_quote_mismatch', 'source_fact_hint', 'risk_contract_hint', 'risk_falsifier_hint'])
const PLACEHOLDER_REACHABILITY = /^(?:待核对|未提供|未记录|未知|待确认|unknown|tbd|pending|n\/a|-|—)$/i

export function classifyRiskGrounding(risk) {
  const warnings = (Array.isArray(risk?.record_warnings) ? risk.record_warnings : [])
    .filter(item => item && RISK_WARNING_KINDS.has(item.kind))
  const hasEvidence = Array.isArray(risk?.evidence)
    && risk.evidence.some(item => typeof item?.location === 'string' && item.location.trim() !== '')
  if (warnings.length > 0 || !hasEvidence) {
    return {
      tier: 'unanchored',
      label: warnings.length ? '证据失配待核' : '缺少源码坐标',
      tone: 'danger',
      warnings,
      reason: warnings[0]?.message || '当前记录尚未提供可定位的冻结源码位置',
    }
  }
  const reachability = String(risk?.upstream_semantics?.reachability ?? '').trim()
  const hasExplicitReachability = Boolean(reachability) && !PLACEHOLDER_REACHABILITY.test(reachability)
  const hasExclusion = Boolean(String(risk?.exclusion_condition ?? '').trim())
  const linkedCaseCount = Array.isArray(risk?.linked_test_case_ids) ? risk.linked_test_case_ids.length : 0
  const hasTrigger = Boolean(String(risk?.trigger ?? '').trim())
  if (hasTrigger && (hasExplicitReachability || hasExclusion || linkedCaseCount > 0)) {
    return {
      tier: 'anchored',
      label: '依据齐备',
      tone: 'adopted',
      warnings: [],
      reason: hasExplicitReachability
        ? `入口可达性已记录：${reachability.slice(0, 32)}`
        : linkedCaseCount > 0
          ? `源码坐标与触发条件完备，已关联 ${linkedCaseCount} 条验证用例`
          : '源码坐标、触发条件与排除边界已记录',
    }
  }
  return {
    tier: 'hypothesis',
    label: '可达性待核对',
    tone: 'warn',
    warnings: [],
    reason: !hasTrigger ? '源码位置已记录，但触发条件尚未明确' : '尚未确认调用方限制与外部入口可达性',
  }
}

export function summarizeIncrementalInputs({ request = null, baseline = null, parentPlan = null, changes = null } = {}) {
  const parentRunId = request?.parent_run_id || baseline?.parent_run_id || ''
  if (!parentRunId) return null
  const mode = request?.mode || baseline?.mode || 'supplement'
  const sourcePolicy = baseline?.source_policy || (mode === 'changed-files' ? 'current-working-tree' : 'parent-frozen')
  const rawFiles = Array.isArray(changes?.changed_files) ? changes.changed_files : []
  const changedFiles = rawFiles.map(file => ({
    repo_id: file?.repo_id || '',
    path: file?.path || '',
    status: file?.status || 'unknown',
    before_short: typeof file?.before_sha256 === 'string' ? file.before_sha256.slice(0, 8) : null,
    after_short: typeof file?.after_sha256 === 'string' ? file.after_sha256.slice(0, 8) : null,
  }))
  const selectedUnitIds = Array.isArray(request?.selected_unit_ids) ? request.selected_unit_ids.filter(Boolean) : []
  const parentUnits = Array.isArray(parentPlan?.units) ? parentPlan.units : []
  return {
    parent_run_id: parentRunId,
    mode,
    instruction: String(request?.instruction ?? ''),
    source_policy: sourcePolicy,
    rules_changed: changes ? Boolean(changes.rules_changed) : null,
    parent_unit_count: parentUnits.length ? parentUnits.length : null,
    selected_unit_ids: selectedUnitIds,
    selected_record_count: Array.isArray(request?.selected_records) ? request.selected_records.length : 0,
    baseline_file_count: Array.isArray(baseline?.baseline_files) ? baseline.baseline_files.length : null,
    changed_files: changedFiles,
    counts: {
      declared: changedFiles.length || (Array.isArray(request?.changed_paths) ? request.changed_paths.length : 0),
      modified: changedFiles.filter(f => f.status === 'modified').length,
      unchanged: changedFiles.filter(f => f.status === 'unchanged').length,
      missing: changedFiles.filter(f => ['deleted', 'baseline-missing', 'missing-both'].includes(f.status)).length,
    },
    note: typeof changes?.note === 'string' ? changes.note : '',
  }
}
