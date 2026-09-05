function cell(value) {
  if (Array.isArray(value)) return value.map(item => cell(item)).join('；')
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value, null, 0)
  return String(value)
}

export function csvCell(value) {
  const text = cell(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function buildTestCaseCsv(run) {
  const rows = [
    ['Run', run?.run_id],
    ['结果状态', run?.publication?.state ?? 'pending'],
    ['结果 revision', run?.publication?.revision ?? 0],
    ['目标', run?.target],
    [],
    ['用例 ID', '标题', '类型', '状态', '关联风险', '前置条件', '执行步骤', '预期结果', '观察点', '清理动作'],
  ]
  for (const item of run?.details?.test_cases ?? []) {
    rows.push([
      item.test_case_id,
      item.title,
      item.case_type,
      item.status,
      item.linked_risk_ids,
      item.preconditions,
      item.steps,
      item.expected_results,
      item.observability,
      item.cleanup,
    ])
  }
  return `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

