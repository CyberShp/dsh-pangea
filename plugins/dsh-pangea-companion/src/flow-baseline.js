import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'

export function normalizeFlowBaseline(value) {
  if (value == null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('流程基线必须指定 Run 和版本')
  const result = {}
  for (const key of ['run_id', 'version_id']) {
    const id = typeof value[key] === 'string' ? value[key].trim() : ''
    if (!id || id === '.' || id === '..' || /[/\\\x00-\x1f]/.test(id)) throw new Error(`流程基线 ${key} 无效`)
    result[key] = id
  }
  return result
}

// Generation metadata is descriptive, never an instruction to configure a model.
// Keep credentials and arbitrary provider configuration out of persisted contracts.
export function normalizeModelSettings(value) {
  const result = {}
  for (const key of ['provider', 'model_revision', 'system_fingerprint', 'reasoning_effort']) {
    if (typeof value?.[key] === 'string' && value[key].trim()) result[key] = value[key].trim()
  }
  for (const key of ['temperature', 'top_p']) if (Number.isFinite(value?.[key])) result[key] = value[key]
  if (Number.isSafeInteger(value?.seed)) result.seed = value.seed
  return Object.keys(result).length ? result : null
}

function contained(root, filename) {
  const relative = path.relative(root, filename)
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

function fingerprintSummary(value) {
  if (!value || typeof value !== 'object') return null
  const { source_files, ...summary } = value
  return { ...summary, source_file_count: Array.isArray(source_files) ? source_files.length : null }
}

export async function readFlowMetadata(runDirectory, runId, { lifecycle_status, quality_status, partial_delivery } = {}) {
  const warnings = []
  let root
  try { root = await realpath(runDirectory) } catch (error) {
    if (error.code === 'ENOENT') return { warnings }
    return { warnings: [`流程版本信息不可读取：${error.message}`] }
  }
  const read = async (relative, format) => {
    try {
      const filename = await realpath(path.join(root, relative))
      if (!contained(root, filename)) throw new Error('文件越过当前 Run 边界')
      const value = JSON.parse((await readFile(filename, 'utf8')).replace(/^\uFEFF/, ''))
      if (value?.format_version !== format) throw new Error('格式版本不匹配')
      return value
    } catch (error) {
      if (error.code !== 'ENOENT') warnings.push(`${relative} 不可读取：${error.message}`)
      return null
    }
  }
  const fingerprint = await read('inputs/flow-stability.json', 'flow-stability-v1')
  const comparison = await read('inputs/flow-comparison.json', 'flow-comparison-v1')
  const deliveryComparison = await read('outputs/flow-delivery-comparison.json', 'flow-comparison-v1')
  const baseline = await read('outputs/flow-baseline.json', 'flow-baseline-v1')
  const result = { warnings }
  if (fingerprint?.run_id === runId) result.flow_stability = fingerprintSummary(fingerprint)
  else if (fingerprint) warnings.push('流程输入指纹的 Run 身份不匹配')
  if (comparison?.candidate?.run_id === runId) result.flow_comparison = comparison
  else if (comparison) warnings.push('流程差异的 Run 身份不匹配')
  if (deliveryComparison?.candidate?.run_id === runId) {
    result.flow_review_comparison = result.flow_comparison ?? null
    result.flow_comparison = deliveryComparison
  } else if (deliveryComparison) warnings.push('最终交付流程差异的 Run 身份不匹配')
  if (baseline) {
    try {
      const ref = normalizeFlowBaseline(baseline)
      if (ref.run_id !== runId || baseline.input_fingerprint?.run_id !== runId) throw new Error('Run 身份不匹配')
      if (baseline.eligible === true && baseline.review_status === 'PASS' && lifecycle_status === 'complete'
          && quality_status === 'PASS' && partial_delivery !== true && baseline.flow_count > 0) {
        // The backend revalidates exact version/content when this is explicitly selected.
        result.flow_baseline = { ...ref, target: baseline.target, repository: baseline.repository,
          scenario: baseline.scenario, input_fingerprint: fingerprintSummary(baseline.input_fingerprint), flow_count: baseline.flow_count }
      }
    } catch (error) { warnings.push(`流程基线不可选：${error.message}`) }
  }
  return result
}

export function flowBaselineOptions(runs) {
  return [...new Map((runs ?? []).filter(Boolean).filter(run => run.flow_baseline)
    .map(run => [JSON.stringify([run.flow_baseline.run_id, run.flow_baseline.version_id]), run.flow_baseline])).values()]
}
