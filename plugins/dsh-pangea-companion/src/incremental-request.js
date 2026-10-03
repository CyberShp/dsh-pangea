import path from 'node:path'

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function identifiers(value, name) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => !text(item))) throw new Error(`${name} 必须是非空字符串数组`)
  return [...new Set(value.map(text))]
}

// Keep selections explicit. Only the planner decides which business paths are
// affected; the host must never infer them from filenames or record titles.
export function normalizeIncrementalRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('incremental_request 必须是对象')
  const parentRunId = text(value.parent_run_id)
  if (!parentRunId) throw new Error('定向分析必须指定来源 Run')
  if (!['supplement', 'changed-files'].includes(value.mode)) throw new Error('不支持的定向分析类型')
  const instruction = text(value.instruction)
  if (value.mode === 'supplement' && !instruction) throw new Error('请填写补充分析要求')
  const selectedUnitIds = identifiers(value.selected_unit_ids, 'selected_unit_ids')
  const selectedRecords = value.selected_records ?? []
  if (!Array.isArray(selectedRecords) || selectedRecords.some(item => !text(item?.action_id) || !text(item?.record_id))) {
    throw new Error('选择记录必须同时包含 action_id 和 record_id')
  }
  const records = [...new Map(selectedRecords.map(item => {
    const record = { action_id: text(item.action_id), record_id: text(item.record_id) }
    return [JSON.stringify(record), record]
  })).values()]
  const changedPaths = identifiers(value.changed_paths, 'changed_paths').map(item => item.replaceAll('\\', '/').replace(/^\.\//, ''))
  if (changedPaths.some(item => !item || path.posix.isAbsolute(item) || path.win32.isAbsolute(item) || item.split('/').includes('..') || item.includes('\0'))) {
    throw new Error('变更文件必须使用仓库内相对路径，不能包含上级目录')
  }
  if (value.mode === 'changed-files' && changedPaths.length === 0) throw new Error('请至少指定一个变更文件')
  if (value.mode === 'supplement' && changedPaths.length) throw new Error('定向补充使用原 Run 冻结源码；变更文件请使用变更分析')
  return {
    parent_run_id: parentRunId,
    mode: value.mode,
    instruction,
    selected_unit_ids: selectedUnitIds,
    selected_records: records,
    changed_paths: [...new Set(changedPaths)],
  }
}
