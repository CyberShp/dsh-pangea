import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const STEP_TITLES = [
  '范围和任务契约',
  '输入材料消费和运行计划',
  '广度盘点和模块地图',
  '开发给测试讲代码',
  '多源场景增殖和风险解释',
  'SFMEA 和黑盒翻译',
  '测试场景、流程和用例设计',
  '独立审查',
  '正式交付',
]

async function pathKind(filePath) {
  try {
    const details = await stat(filePath)
    if (details.isFile()) return 'file'
    if (details.isDirectory()) return 'directory'
    return 'other'
  } catch (error) {
    if (error?.code === 'ENOENT') return 'missing'
    throw error
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function markdownFiles(root) {
  if (await pathKind(root) !== 'directory') return []
  const output = []
  const visit = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(candidate)
      else if (entry.isFile() && entry.name.endsWith('.md')) output.push(candidate)
    }
  }
  await visit(root)
  return output.sort()
}

async function findPangeaDataFrom(startPath) {
  let cursor = path.resolve(startPath)
  if (await pathKind(cursor) === 'file') cursor = path.dirname(cursor)
  for (let depth = 0; depth < 8; depth += 1) {
    const direct = path.basename(cursor) === 'pangea-data' ? cursor : path.join(cursor, 'pangea-data')
    if (await pathKind(path.join(direct, 'runs')) === 'directory') return direct
    const parent = path.dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  return undefined
}

export async function discoverPangeaDataRoot({ cwd, dataRoot } = {}) {
  if (dataRoot !== undefined) {
    if (typeof dataRoot !== 'string' || dataRoot.trim() === '') throw new TypeError('data_root must be a non-empty string')
    if (!path.isAbsolute(dataRoot)) throw new Error('data_root must be an absolute path')
    const resolved = path.resolve(dataRoot)
    if (await pathKind(path.join(resolved, 'runs')) !== 'directory') throw new Error(`PANGEA data_root does not contain runs/: ${resolved}`)
    return resolved
  }
  if (typeof cwd !== 'string' || cwd.trim() === '') throw new Error('Cannot discover PANGEA data root without a workspace cwd or explicit data_root')
  const discovered = await findPangeaDataFrom(cwd)
  if (!discovered) throw new Error(`No pangea-data/runs directory found from workspace: ${cwd}`)
  return discovered
}

function lifecycle(metadata, state) {
  if (metadata?.status === 'stopped') return { lifecycle_status: 'stopped', phase: 'STOPPED', terminal: true }
  if (!state) return { lifecycle_status: 'preparing', phase: 'PREPARING', terminal: false }
  if (state.status === 'complete') return { lifecycle_status: 'complete', phase: 'COMPLETE', terminal: true }
  if (state.status === 'validation_failed') return { lifecycle_status: 'attention_required', phase: 'INCOMPLETE', terminal: true }
  return { lifecycle_status: 'running', phase: `STEP_${state.current_step || 'BOOTSTRAP'}`, terminal: false }
}

async function stepRows(state, liveDocuments, formalOutputs, skillRoot) {
  const completed = new Set(state?.completed_steps ?? [])
  const current = state?.current_step ?? null
  let ownership = new Map()
  try {
    const manifest = await readJson(path.join(skillRoot, 'workflow-manifest.json'))
    for (const step of manifest.steps ?? []) {
      for (const artifact of step.required ?? []) {
        const name = path.basename(artifact)
        ownership.set(name, String(step.id ?? '').padStart(2, '0'))
      }
    }
  } catch { /* older runs may not contain a manifest */ }
  return STEP_TITLES.map((title, index) => {
    const step = String(index + 1).padStart(2, '0')
    const status = completed.has(step) ? 'completed' : current === step ? 'running' : 'pending'
    const artifacts = step === '09'
      ? formalOutputs
      : liveDocuments.filter(file => ownership.size > 0
        ? ownership.get(path.basename(file)) === step
        : path.basename(file).startsWith(step + '-'))
    return { step, title, status, artifacts }
  })
}

export async function summarizeRun(dataRoot, runId, { includeDetails = false } = {}) {
  const metadataPath = path.join(dataRoot, '.pangea', 'skill-runs', runId, 'metadata.json')
  if (await pathKind(metadataPath) !== 'file') throw new Error(`Codetalks Skill run does not exist: ${runId}`)
  const metadata = await readJson(metadataPath)
  const runDirectory = metadata.run_root
  const statePath = path.join(runDirectory, '内部索引', '运行状态.json')
  const state = await pathKind(statePath) === 'file' ? await readJson(statePath) : null
  const liveDocuments = await markdownFiles(path.join(runDirectory, '活文档'))
  const formalOutputs = await markdownFiles(path.join(runDirectory, '正式输出'))
  const reportMd = path.join(runDirectory, '正式输出', '完整分析报告.md')
  const reportAvailable = await pathKind(reportMd) === 'file'
  const life = lifecycle(metadata, state)
  const completed = state?.completed_steps?.length ?? 0
  const workflow = {
    steps: await stepRows(state, liveDocuments, formalOutputs, metadata.skill_root),
    completed_steps: state?.completed_steps ?? [],
    current_step: state?.current_step ?? null,
    core_rules_ack: state?.core_rules_ack ?? {},
    judge: state?.judge ?? { required: true, status: 'pending' },
    actions: [],
    units: [],
    quality_checks: [],
    unresolved: [],
    error_history: [],
  }
  const summary = {
    run_id: runId,
    ...life,
    target: metadata.request?.target ?? runId,
    repository: metadata.request?.repository ?? null,
    verdict: state?.verdict ?? null,
    quality_status: state?.verdict ?? null,
    attention_required: life.lifecycle_status === 'attention_required',
    analysis: {
      total: 9,
      completed,
      reworked: 0,
      running: life.terminal ? 0 : 1,
      pending: Math.max(0, 9 - completed - (state?.current_step ? 1 : 0)),
      submitted: completed,
      max_parallel: 1,
    },
    counts: { risks: null, test_cases: null, evidence: liveDocuments.length, business_flows: null, review_issues: null },
    errors: state?.status === 'validation_failed' ? [{ code: 'SKILL_VALIDATION_FAILED', message: 'run_guard 最终校验未通过' }] : [],
    error_history: [],
    review: {
      status: (state?.completed_steps ?? []).includes('08') ? 'COMPLETE' : 'PENDING',
      summary: state?.judge?.status ?? 'pending',
      issues: [],
      counts: { effective: 0 },
    },
    data_source: 'codetalks-markdown',
    reader_health: { status: 'ok', trusted: true, data_source: 'codetalks-markdown', issues: [], count_checks: {} },
    reader_warnings: [],
    artifacts: {
      run_directory: runDirectory,
      request: metadata.request_path,
      state: await pathKind(statePath) === 'file' ? statePath : null,
      live_documents: liveDocuments,
      formal_outputs: formalOutputs,
      report_md: reportAvailable ? reportMd : null,
      report_html: null,
    },
    report_available: reportAvailable && life.lifecycle_status === 'complete',
    modified_at: (await stat(runDirectory)).mtimeMs,
  }
  if (includeDetails) {
    summary.details = { risks: [], test_cases: [], evidence: [], business_flows: [], review_issues: [] }
    summary.workflow = workflow
  }
  return summary
}

export async function listRuns(dataRoot, { limit = 20 } = {}) {
  const root = path.join(dataRoot, '.pangea', 'skill-runs')
  if (await pathKind(root) !== 'directory') return []
  const values = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try { values.push(await summarizeRun(dataRoot, entry.name)) } catch { /* one damaged run must not hide others */ }
  }
  values.sort((a, b) => b.modified_at - a.modified_at)
  return values.slice(0, limit)
}

export function chooseCurrentRun(runs) {
  return runs.find(run => !run.terminal) ?? runs[0] ?? null
}

export async function listExecutorRuns() {
  return []
}

export async function companionSnapshot({ cwd, dataRoot, runId, limit = 20 } = {}) {
  const resolvedDataRoot = await discoverPangeaDataRoot({ cwd, dataRoot })
  const runs = await listRuns(resolvedDataRoot, { limit })
  const selected = runId !== undefined ? runs.find(run => run.run_id === runId) : chooseCurrentRun(runs)
  const current = selected ? await summarizeRun(resolvedDataRoot, selected.run_id, { includeDetails: true }) : null
  return { status: 'ok', data_root: resolvedDataRoot, current, runs, executor_runs: [] }
}
