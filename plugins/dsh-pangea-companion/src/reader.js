import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
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

const SOURCE_FIRST_STAGES = [
  ['preparing', '准备冻结输入'],
  ['planning', 'Planning 单元划分'],
  ['analyzing', '源码区域分析'],
  ['reviewing', '盲审与同会话对照'],
  ['closing', '定向 closure'],
  ['reporting', '报告组装'],
  ['complete', '已完成'],
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

async function readWorkbenchProjection(runDirectory, runId) {
  const projectionPath = path.join(runDirectory, '内部索引', '工作台投影.json')
  if (await pathKind(projectionPath) !== 'file') {
    return { status: 'legacy_unavailable', path: projectionPath, value: null, issues: ['缺少工作台结构化投影'] }
  }
  try {
    const value = await readJson(projectionPath)
    const issues = []
    if (!value || typeof value !== 'object' || Array.isArray(value)) issues.push('工作台投影必须是 JSON 对象')
    if (value?.schema_version !== '1.0') issues.push('工作台投影 schema_version 不受支持')
    if (value?.run_id !== runId) issues.push('工作台投影 run_id 与当前 Run 不一致')
    for (const key of ['business_flows', 'risks', 'test_cases', 'evidence', 'review_issues']) {
      if (!Array.isArray(value?.[key])) issues.push(`工作台投影缺少数组：${key}`)
    }
    return { status: issues.length ? 'invalid' : 'verified', path: projectionPath, value, issues }
  } catch (error) {
    return { status: 'invalid', path: projectionPath, value: null, issues: [error instanceof Error ? error.message : String(error)] }
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

async function verifySourceSnapshot(runDirectory, runId, recordedSnapshot) {
  const manifestPath = path.join(runDirectory, 'inputs', 'source', 'manifest.json')
  if (await pathKind(manifestPath) !== 'file') return { status: 'legacy_unavailable', issues: [] }
  try {
    const manifest = await readJson(manifestPath)
    const issues = []
    if (manifest.run_id !== runId) issues.push('源码快照 run_id 与当前 Run 不一致')
    const files = manifest.files
    if (!Array.isArray(files) || files.length === 0) issues.push('源码快照清单没有文件')
    if (manifest.file_count !== files?.length) issues.push('源码快照 file_count 与清单不一致')
    if (typeof manifest.snapshot_digest !== 'string') {
      issues.push('源码快照缺少 snapshot_digest')
    } else if (manifest.snapshot_digest !== `sha256:${createHash('sha256').update(canonicalJson(files ?? [])).digest('hex')}`) {
      issues.push('源码快照清单 digest 不匹配')
    }
    for (const item of files ?? []) {
      if (!item?.path || typeof item.sha256 !== 'string') { issues.push('源码快照清单包含非法文件项'); continue }
      const relative = path.normalize(item.path)
      if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) issues.push(`源码快照路径越界：${item.path}`)
    }
    if (recordedSnapshot?.snapshot_digest && recordedSnapshot.snapshot_digest !== manifest.snapshot_digest) issues.push('源码快照清单与 Run 元数据不一致')
    if (Number.isInteger(recordedSnapshot?.file_count) && recordedSnapshot.file_count !== manifest.file_count) issues.push('源码快照文件数与 Run 元数据不一致')
    return { status: issues.length ? 'corrupt' : 'manifest_verified', issues, manifest }
  } catch (error) {
    return { status: 'corrupt', issues: [error instanceof Error ? error.message : String(error)] }
  }
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
    return realpath(resolved)
  }
  if (typeof cwd !== 'string' || cwd.trim() === '') throw new Error('Cannot discover PANGEA data root without a workspace cwd or explicit data_root')
  const discovered = await findPangeaDataFrom(cwd)
  if (!discovered) throw new Error(`No pangea-data/runs directory found from workspace: ${cwd}`)
  return realpath(discovered)
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

function inside(root, candidate) {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
}

function sourceFirstLifecycle(progress) {
  const lifecycleStatus = ['running', 'complete', 'stopped', 'failed'].includes(progress?.lifecycle_status)
    ? progress.lifecycle_status
    : 'running'
  const stage = typeof progress?.stage === 'string' && progress.stage.trim() !== ''
    ? progress.stage
    : 'preparing'
  const phase = lifecycleStatus === 'complete' ? 'COMPLETE'
    : lifecycleStatus === 'stopped' ? 'STOPPED'
      : lifecycleStatus === 'failed' ? 'FAILED'
        : stage.toUpperCase()
  return { lifecycle_status: lifecycleStatus, phase, terminal: lifecycleStatus !== 'running', stage }
}

function sourceFirstStepRows(progress, runDirectory, artifacts) {
  const life = sourceFirstLifecycle(progress)
  const currentIndex = Math.max(0, SOURCE_FIRST_STAGES.findIndex(([stage]) => stage === life.stage))
  const actionArtifacts = new Map()
  for (const item of artifacts) {
    const actionStage = item.stage ?? item.task?.review_stage ?? item.task?.task_type
    const stage = actionStage === 'unit_analysis' ? 'analyzing'
      : ['independent_review', 'comparison_review'].includes(actionStage) ? 'reviewing'
        : actionStage === 'targeted_closure' ? 'closing'
          : actionStage === 'unit_planning' || actionStage === 'source_first_plan' ? 'planning'
            : actionStage
    if (!stage) continue
    if (!actionArtifacts.has(stage)) actionArtifacts.set(stage, [])
    for (const file of [item.task_path, item.result_path]) {
      if (typeof file === 'string' && inside(runDirectory, file) && !actionArtifacts.get(stage).includes(file)) {
        actionArtifacts.get(stage).push(file)
      }
    }
  }
  const stageArtifactNames = {
    preparing: [path.join(runDirectory, 'inputs', 'task-contract.json')],
    planning: [
      path.join(runDirectory, 'inputs', 'source-manifest.json'),
      path.join(runDirectory, 'inputs', 'source-index.json'),
      path.join(runDirectory, 'inputs', 'source-first-plan.json'),
    ],
    reporting: [path.join(runDirectory, 'report.md'), path.join(runDirectory, 'report.html'), path.join(runDirectory, 'report-complete.json')],
    complete: [path.join(runDirectory, 'report.md'), path.join(runDirectory, 'report.html'), path.join(runDirectory, 'report-complete.json')],
  }
  return SOURCE_FIRST_STAGES.map(([stage, title], index) => {
    const status = life.lifecycle_status === 'complete'
      ? 'completed'
      : index < currentIndex
        ? 'completed'
        : index === currentIndex
          ? life.lifecycle_status === 'running' ? 'running' : life.lifecycle_status
          : 'pending'
    const stageArtifacts = [
      ...(stageArtifactNames[stage] ?? []),
      ...(actionArtifacts.get(stage) ?? []),
    ]
    return {
      step: String(index + 1).padStart(2, '0'),
      stage,
      title,
      status,
      artifacts: stageArtifacts.filter((file, position) => stageArtifacts.indexOf(file) === position),
    }
  })
}

async function sourceFirstActionArtifacts(runDirectory, progress) {
  const artifacts = []
  const issues = []
  for (const [actionId, action] of Object.entries(progress?.actions ?? {})) {
    if (!action || typeof action !== 'object') continue
    const recordedTaskPath = typeof action.task_path === 'string' ? path.resolve(action.task_path) : null
    const taskPath = recordedTaskPath && await pathKind(recordedTaskPath) === 'file' ? await realpath(recordedTaskPath) : recordedTaskPath
    if (!taskPath || !inside(runDirectory, taskPath) || await pathKind(taskPath) !== 'file') {
      issues.push(`source-first action task 不可读取：${actionId}`)
      continue
    }
    let task
    try { task = await readJson(taskPath) } catch (error) {
      issues.push(`source-first task JSON 不可读取：${actionId}：${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    const recordedResultPath = typeof task?.result_path === 'string' ? path.resolve(task.result_path) : null
    const resultPath = recordedResultPath && await pathKind(recordedResultPath) === 'file' ? await realpath(recordedResultPath) : recordedResultPath
    let result = null
    if (!resultPath || !inside(runDirectory, resultPath)) {
      issues.push(`source-first result_path 越出 Run：${actionId}`)
    } else if (await pathKind(resultPath) === 'file') {
      try { result = await readJson(resultPath) } catch (error) {
        issues.push(`source-first result JSON 不可读取：${actionId}：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const records = Array.isArray(result?.records) ? result.records : []
    artifacts.push({
      action_id: actionId,
      ...action,
      task,
      task_path: taskPath,
      result_path: resultPath,
      revision: Number.isInteger(result?.revision) ? result.revision : null,
      completion: result?.completion ?? null,
      records,
    })
  }
  return { artifacts, issues }
}

async function sourceFirstSnapshot(runDirectory, progress, contract, actionArtifacts) {
  const manifestPath = path.join(runDirectory, 'inputs', 'source-manifest.json')
  const indexPath = path.join(runDirectory, 'inputs', 'source-index.json')
  const issues = []
  let manifest = null
  let index = null
  if (await pathKind(manifestPath) !== 'file') issues.push('缺少冻结 source manifest')
  else {
    try { manifest = await readJson(manifestPath) } catch (error) { issues.push(`source manifest 不可读取：${error instanceof Error ? error.message : String(error)}`) }
  }
  if (await pathKind(indexPath) !== 'file') issues.push('缺少冻结 source index')
  else {
    try { index = await readJson(indexPath) } catch (error) { issues.push(`source index 不可读取：${error instanceof Error ? error.message : String(error)}`) }
  }
  if (manifest && manifest.workflow_version && manifest.workflow_version !== 'source-first-v1') {
    issues.push('source manifest workflow_version 与 source-first 不一致')
  }
  if (index && index.format_version !== 'pangea-source-index-v1') issues.push('source index format_version 不受支持')
  if (manifest?.source_index_path) {
    const recordedIndexPath = path.resolve(manifest.source_index_path)
    const canonicalRecordedIndexPath = await pathKind(recordedIndexPath) === 'file' ? await realpath(recordedIndexPath) : recordedIndexPath
    const canonicalIndexPath = await realpath(indexPath)
    if (canonicalRecordedIndexPath !== canonicalIndexPath) issues.push('source manifest 没有指向当前 Run 的 source index')
  }
  const fileCount = Number.isInteger(index?.file_count)
    ? index.file_count
    : Array.isArray(index?.files) ? index.files.length : null
  return {
    status: issues.length ? 'corrupt' : manifest && index ? 'manifest_verified' : 'legacy_unavailable',
    snapshot_digest: null,
    file_count: fileCount,
    issues,
    manifest_path: manifestPath,
    index_path: indexPath,
    repositories: Array.isArray(manifest?.repositories) ? manifest.repositories : [],
    requested_scope: Array.isArray(manifest?.requested_scope) ? manifest.requested_scope : [],
  }
}

export async function sourceFirstReportAvailable(runDirectory, lifecycleStatus) {
  return lifecycleStatus === 'complete'
    && await pathKind(path.join(runDirectory, 'report.md')) === 'file'
    && await pathKind(path.join(runDirectory, 'report.html')) === 'file'
    && await pathKind(path.join(runDirectory, 'report-complete.json')) === 'file'
}

async function summarizeSourceFirstRun(dataRoot, runId, { includeDetails = false } = {}) {
  const runDirectory = path.join(dataRoot, 'runs', runId)
  const progressPath = path.join(runDirectory, 'progress.json')
  const progress = await readJson(progressPath)
  const contractPath = path.join(runDirectory, 'inputs', 'task-contract.json')
  let contract = null
  if (await pathKind(contractPath) === 'file') {
    try { contract = await readJson(contractPath) } catch { contract = null }
  }
  const actionView = await sourceFirstActionArtifacts(runDirectory, progress)
  const life = sourceFirstLifecycle(progress)
  const sourceSnapshot = await sourceFirstSnapshot(runDirectory, progress, contract, actionView.artifacts)
  const analysisActions = actionView.artifacts.filter(item => item.role === 'analysis')
  const acceptedAnalysis = analysisActions.filter(item => item.status === 'accepted')
  const reportMd = path.join(runDirectory, 'report.md')
  const reportHtml = path.join(runDirectory, 'report.html')
  const reportComplete = path.join(runDirectory, 'report-complete.json')
  const reportAvailable = await sourceFirstReportAvailable(runDirectory, life.lifecycle_status)
  const records = actionView.artifacts.map(item => ({
    action_id: item.action_id,
    action: item.action,
    role: item.role,
    stage: item.stage,
    task_id: item.task_id ?? null,
    unit_id: item.task?.unit_id ?? null,
    revision: item.revision,
    completion: item.completion,
    records: item.records,
  }))
  const workflow = {
    steps: sourceFirstStepRows(progress, runDirectory, actionView.artifacts),
    completed_steps: sourceFirstStepRows(progress, runDirectory, actionView.artifacts).filter(item => item.status === 'completed').map(item => item.step),
    current_step: life.stage,
    core_rules_ack: {},
    judge: { required: true, status: progress.stage === 'reviewing' || progress.stage === 'complete' ? 'running' : 'pending' },
    actions: actionView.artifacts.map(item => ({
      action_id: item.action_id,
      action: item.action,
      role: item.role,
      stage: item.stage,
      task_path: item.task_path,
      task_id: item.task_id ?? null,
      status: item.status,
      error: item.error ?? null,
      revision: item.revision,
      completion: item.completion,
      first_finish_revision: progress.first_finish_revisions?.[item.action_id] ?? null,
      accepted_revision: progress.accepted_revisions?.[item.action_id] ?? null,
    })),
    units: analysisActions.map(item => ({
      unit_id: item.task?.unit_id ?? item.action_id,
      title: item.task?.title ?? item.task?.unit_id ?? item.action_id,
      status: item.status,
      owned_regions: item.task?.owned_regions ?? [],
      context_regions: item.task?.context_regions ?? [],
    })),
    quality_checks: [],
    unresolved: [...(Array.isArray(progress.degradations) ? progress.degradations : []), ...(progress.blocking_reason ? [progress.blocking_reason] : [])],
    error_history: [...(Array.isArray(progress.errors) ? progress.errors : []), ...actionView.issues],
    step_progress: null,
  }
  const summary = {
    run_id: runId,
    workflow_version: progress.workflow_version ?? 'source-first-v1',
    ...life,
    target: contract?.target ?? runId,
    repository: contract?.repository ?? null,
    repositories: contract?.repositories ?? sourceSnapshot.repositories.map(item => item.repo_id).filter(Boolean),
    verdict: progress.quality_status ?? null,
    quality_status: progress.quality_status ?? null,
    needs_user: progress.needs_user === true,
    blocking_reason: progress.blocking_reason ?? null,
    first_finish_revisions: progress.first_finish_revisions ?? {},
    accepted_revisions: progress.accepted_revisions ?? {},
    attention_required: progress.needs_user === true || life.lifecycle_status === 'failed',
    analysis: {
      total: analysisActions.length,
      completed: acceptedAnalysis.length,
      reworked: 0,
      running: analysisActions.filter(item => ['dispatched', 'settled'].includes(item.status)).length,
      pending: analysisActions.filter(item => item.status === 'pending').length,
      submitted: analysisActions.filter(item => ['settled', 'accepted'].includes(item.status)).length,
      max_parallel: 8,
    },
    counts: { risks: null, test_cases: null, evidence: null, business_flows: null, review_issues: null },
    errors: Array.isArray(progress.errors) ? progress.errors : [],
    error_history: actionView.issues,
    review: {
      status: progress.stage === 'complete' || (progress.stage === 'reporting' && progress.quality_status) ? 'COMPLETE' : 'PENDING',
      summary: progress.quality_status ?? 'pending',
      issues: [],
      counts: { effective: null },
      independent: records.find(item => item.stage === 'independent_review') ?? null,
      comparison: records.find(item => item.stage === 'comparison_review') ?? null,
    },
    data_source: 'source-first-notes',
    reader_health: {
      status: sourceSnapshot.status === 'corrupt' || actionView.issues.length ? 'warning' : 'ok',
      trusted: sourceSnapshot.status !== 'corrupt' && actionView.issues.length === 0,
      data_source: 'source-first-notes',
      issues: [...sourceSnapshot.issues, ...actionView.issues],
      count_checks: {},
    },
    reader_warnings: [...sourceSnapshot.issues, ...actionView.issues],
    artifacts: {
      run_directory: runDirectory,
      request: await pathKind(contractPath) === 'file' ? contractPath : null,
      state: progressPath,
      live_documents: [],
      formal_outputs: [],
      report_md: await pathKind(reportMd) === 'file' ? reportMd : null,
      report_html: await pathKind(reportHtml) === 'file' ? reportHtml : null,
      report_complete: await pathKind(reportComplete) === 'file' ? reportComplete : null,
      source_snapshot_manifest: await pathKind(sourceSnapshot.manifest_path) === 'file' ? sourceSnapshot.manifest_path : null,
      source_index: await pathKind(sourceSnapshot.index_path) === 'file' ? sourceSnapshot.index_path : null,
    },
    source_snapshot: sourceSnapshot,
    validation: { status: 'not_checked', error_count: 0, errors: [] },
    report_available: reportAvailable,
    modified_at: (await stat(runDirectory)).mtimeMs,
    source_first_records: records,
  }
  if (includeDetails) {
    summary.details = {
      risks: [],
      test_cases: [],
      evidence: [],
      business_flows: [],
      review_issues: [],
      source_first_records: records,
    }
    summary.workflow = workflow
  }
  return summary
}

export async function summarizeRun(dataRoot, runId, { includeDetails = false } = {}) {
  const sourceFirstRunDirectory = path.join(dataRoot, 'runs', runId)
  const sourceFirstProgressPath = path.join(sourceFirstRunDirectory, 'progress.json')
  if (await pathKind(sourceFirstProgressPath) === 'file') {
    const progress = await readJson(sourceFirstProgressPath)
    if (progress?.workflow_version === 'source-first-v1') {
      return summarizeSourceFirstRun(dataRoot, runId, { includeDetails })
    }
  }
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
  const projection = await readWorkbenchProjection(runDirectory, runId)
  const recordedSourceSnapshot = metadata.source_snapshot ?? { status: 'legacy_unavailable', snapshot_digest: null, file_count: null }
  const sourceSnapshot = { ...recordedSourceSnapshot, ...(await verifySourceSnapshot(runDirectory, runId, recordedSourceSnapshot)) }
  const validation = state?.validation ?? { status: 'not_checked', error_count: 0, errors: [] }
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
    step_progress: state?.step_progress ?? null,
  }
  if (projection.status !== 'verified') {
    workflow.unresolved = projection.issues.map(message => ({ code: 'PROJECTION_UNAVAILABLE', message }))
  }
  const projectionValue = projection.value ?? {}
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
    counts: {
      risks: projection.status === 'verified' ? projectionValue.risks.length : null,
      test_cases: projection.status === 'verified' ? projectionValue.test_cases.length : null,
      evidence: projection.status === 'verified' ? projectionValue.evidence.length : liveDocuments.length,
      business_flows: projection.status === 'verified' ? projectionValue.business_flows.length : null,
      review_issues: projection.status === 'verified' ? projectionValue.review_issues.length : null,
    },
    errors: validation.status === 'failed' ? validation.errors : [],
    error_history: [],
    review: {
      status: (state?.completed_steps ?? []).includes('08') ? 'COMPLETE' : 'PENDING',
      summary: state?.judge?.status ?? 'pending',
      issues: [],
      counts: { effective: 0 },
    },
    data_source: projection.status === 'verified' ? 'codetalks-workbench-projection' : 'codetalks-markdown',
    reader_health: {
      status: projection.status === 'verified' && sourceSnapshot.status !== 'corrupt' ? 'ok' : 'warning',
      trusted: projection.status === 'verified' && sourceSnapshot.status !== 'corrupt',
      data_source: projection.status === 'verified' ? 'codetalks-workbench-projection' : 'codetalks-markdown',
      issues: [...projection.issues, ...(sourceSnapshot.status === 'corrupt' ? ['源码快照完整性校验失败'] : [])],
      count_checks: {},
    },
    reader_warnings: projection.issues,
    artifacts: {
      run_directory: runDirectory,
      request: metadata.request_path,
      state: await pathKind(statePath) === 'file' ? statePath : null,
      live_documents: liveDocuments,
      formal_outputs: formalOutputs,
      report_md: reportAvailable ? reportMd : null,
      report_html: null,
      source_snapshot_manifest: await pathKind(path.join(runDirectory, 'inputs', 'source', 'manifest.json')) === 'file'
        ? path.join(runDirectory, 'inputs', 'source', 'manifest.json') : null,
    },
    source_snapshot: sourceSnapshot,
    validation,
    report_available: reportAvailable && life.lifecycle_status === 'complete',
    modified_at: (await stat(runDirectory)).mtimeMs,
  }
  if (includeDetails) {
    summary.details = projection.status === 'verified'
      ? {
          risks: projectionValue.risks,
          test_cases: projectionValue.test_cases,
          evidence: projectionValue.evidence,
          business_flows: projectionValue.business_flows,
          review_issues: projectionValue.review_issues,
        }
      : { risks: [], test_cases: [], evidence: [], business_flows: [], review_issues: [] }
    summary.workflow = workflow
  }
  return summary
}

export async function listRuns(dataRoot, { limit = 20 } = {}) {
  const roots = [path.join(dataRoot, 'runs'), path.join(dataRoot, '.pangea', 'skill-runs')]
  const runIds = new Set()
  for (const root of roots) {
    if (await pathKind(root) !== 'directory') continue
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isDirectory()) runIds.add(entry.name)
    }
  }
  const values = []
  for (const runId of runIds) {
    try { values.push(await summarizeRun(dataRoot, runId)) } catch { /* one damaged run must not hide others */ }
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
  // A requested historical Run must not fall back to the newest Run merely
  // because it is older than the first page. Read that exact id directly and
  // leave the result empty if it no longer exists.
  let selected = runId !== undefined ? runs.find(run => run.run_id === runId) : chooseCurrentRun(runs)
  if (runId !== undefined && !selected && typeof runId === 'string' && runId.trim() !== '') {
    try { selected = await summarizeRun(resolvedDataRoot, runId, { includeDetails: false }) } catch { selected = null }
  }
  const current = selected ? await summarizeRun(resolvedDataRoot, selected.run_id, { includeDetails: true }) : null
  return { status: 'ok', data_root: resolvedDataRoot, current, runs, executor_runs: [] }
}
