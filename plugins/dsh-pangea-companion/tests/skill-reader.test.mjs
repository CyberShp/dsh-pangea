import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { companionSnapshot } from '../src/reader.js'

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

test('reads Codetalks state and maps Step 01–09 Markdown lifecycle', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codetalks-reader-'))
  const dataRoot = path.join(root, 'pangea-data')
  const runRoot = path.join(dataRoot, 'runs', 'skill-run-1')
  const metadataRoot = path.join(dataRoot, '.pangea', 'skill-runs', 'skill-run-1')
  try {
    await writeJson(path.join(metadataRoot, 'metadata.json'), {
      run_id: 'skill-run-1', status: 'active', run_root: runRoot,
      request_path: path.join(metadataRoot, 'request.md'), request: { repository: 'repo', target: 'auth' },
    })
    await writeJson(path.join(runRoot, '内部索引', '运行状态.json'), {
      status: 'running', current_step: '04', completed_steps: ['01', '02', '03'],
      core_rules_ack: { markdown_first: true, jit_steps: true, independent_judge: true },
      judge: { required: true, status: 'pending' },
    })
    const live = path.join(runRoot, '活文档', '03-模块地图.md')
    await mkdir(path.dirname(live), { recursive: true })
    await writeFile(live, '# 模块地图\n', 'utf8')
    const snapshot = await companionSnapshot({ dataRoot, runId: 'skill-run-1' })
    assert.equal(snapshot.current.phase, 'STEP_04')
    assert.equal(snapshot.current.terminal, false)
    assert.equal(snapshot.current.analysis.completed, 3)
    assert.equal(snapshot.current.workflow.steps.length, 9)
    assert.equal(snapshot.current.workflow.steps[2].status, 'completed')
    assert.deepEqual(snapshot.current.workflow.steps[2].artifacts, [live])
    assert.equal(snapshot.current.workflow.steps[3].status, 'running')
    assert.equal(snapshot.current.workflow.actions.length, 0)
    assert.equal(snapshot.current.workflow.units.length, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('marks only a validated complete Skill state as terminal complete', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codetalks-complete-'))
  const dataRoot = path.join(root, 'pangea-data')
  const runRoot = path.join(dataRoot, 'runs', 'skill-run-2')
  const metadataRoot = path.join(dataRoot, '.pangea', 'skill-runs', 'skill-run-2')
  try {
    await writeJson(path.join(metadataRoot, 'metadata.json'), {
      run_id: 'skill-run-2', status: 'active', run_root: runRoot,
      request_path: path.join(metadataRoot, 'request.md'), request: { repository: 'repo', target: 'auth' },
    })
    await writeJson(path.join(runRoot, '内部索引', '运行状态.json'), {
      status: 'complete', current_step: '09', completed_steps: ['01', '02', '03', '04', '05', '06', '07', '08', '09'],
      verdict: 'PASS', judge: { required: true, status: 'complete' },
    })
    const report = path.join(runRoot, '正式输出', '完整分析报告.md')
    await mkdir(path.dirname(report), { recursive: true })
    await writeFile(report, '# 完整分析报告\n', 'utf8')
    const current = (await companionSnapshot({ dataRoot, runId: 'skill-run-2' })).current
    assert.equal(current.phase, 'COMPLETE')
    assert.equal(current.terminal, true)
    assert.equal(current.report_available, true)
    assert.equal(current.artifacts.report_md, report)
    assert.equal(current.workflow.steps[8].status, 'completed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('opens an explicitly selected historical Run outside the first page', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codetalks-history-selection-'))
  const dataRoot = path.join(root, 'pangea-data')
  try {
    const create = async (runId, target) => {
      const runRoot = path.join(dataRoot, 'runs', runId)
      const metadataRoot = path.join(dataRoot, '.pangea', 'skill-runs', runId)
      await writeJson(path.join(metadataRoot, 'metadata.json'), {
        run_id: runId, status: 'active', run_root: runRoot,
        request_path: path.join(metadataRoot, 'request.md'), request: { repository: 'repo', target },
      })
      await writeJson(path.join(runRoot, '内部索引', '运行状态.json'), {
        status: 'complete', current_step: '09', completed_steps: ['01', '02', '03', '04', '05', '06', '07', '08', '09'],
      })
    }
    await create('historical-run', '历史失败任务')
    await create('latest-run', '当前最新任务')
    const oldTime = new Date(Date.now() - 60_000)
    await utimes(path.join(dataRoot, 'runs', 'historical-run'), oldTime, oldTime)
    const snapshot = await companionSnapshot({ dataRoot, runId: 'historical-run', limit: 1 })
    assert.equal(snapshot.runs.length, 1)
    assert.equal(snapshot.runs[0].run_id, 'latest-run')
    assert.equal(snapshot.current.run_id, 'historical-run')
    assert.equal(snapshot.current.target, '历史失败任务')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('reads snapshot metadata without rehashing every frozen source file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codetalks-snapshot-metadata-'))
  const dataRoot = path.join(root, 'pangea-data')
  const runId = 'large-source-run'
  const runRoot = path.join(dataRoot, 'runs', runId)
  const metadataRoot = path.join(dataRoot, '.pangea', 'skill-runs', runId)
  const files = [{ path: 'src/large.c', size: 1024, sha256: 'a'.repeat(64) }]
  const snapshotDigest = `sha256:${createHash('sha256').update(canonicalJson(files)).digest('hex')}`
  const sourceSnapshot = { run_id: runId, repo_id: 'repo', files, file_count: 1, snapshot_digest: snapshotDigest }
  try {
    await writeJson(path.join(metadataRoot, 'metadata.json'), {
      run_id: runId, status: 'active', run_root: runRoot, source_snapshot: sourceSnapshot,
      request_path: path.join(metadataRoot, 'request.md'), request: { repository: 'repo', target: 'large source' },
    })
    await writeJson(path.join(runRoot, 'inputs', 'source', 'manifest.json'), sourceSnapshot)
    const current = (await companionSnapshot({ dataRoot, runId })).current
    assert.equal(current.source_snapshot.status, 'manifest_verified')
    assert.equal(current.source_snapshot.file_count, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('reads source-first progress, frozen inputs, revisions, and raw Agent records without inventing semantic counts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'source-first-reader-'))
  const dataRoot = path.join(root, 'pangea-data')
  const runId = 'source-first-run'
  const runRoot = path.join(dataRoot, 'runs', runId)
  const taskPath = path.join(runRoot, 'agent-tasks', 'source-first', 'analysis-unit-1.json')
  const resultPath = path.join(runRoot, 'agent-results', 'source-first', 'analysis-unit-1.json')
  const manifestPath = path.join(runRoot, 'inputs', 'source-manifest.json')
  const indexPath = path.join(runRoot, 'inputs', 'source-index.json')
  try {
    await writeJson(path.join(runRoot, 'inputs', 'task-contract.json'), {
      workflow_version: 'source-first-v1', repository: 'repo', target: 'frozen target', source_scope: ['src/main.c'],
    })
    await writeJson(manifestPath, {
      workflow_version: 'source-first-v1', requested_scope: ['src/main.c'], source_index_path: indexPath,
      repositories: [{ repo_id: 'repo', source_root: path.join(runRoot, 'inputs', 'source', 'repo') }],
    })
    await writeJson(indexPath, {
      format_version: 'pangea-source-index-v1', file_count: 1,
      files: [{ repo_id: 'repo', path: 'src/main.c', line_count: 3, regions: [] }],
    })
    await writeJson(taskPath, {
      workflow_version: 'source-first-v1', action_id: `${runId}:analysis:unit-1`, run_id: runId,
      task_type: 'source_first_analysis', unit_id: 'unit-1', title: 'Unit one', result_path: resultPath,
    })
    await writeJson(resultPath, {
      format_version: 'pangea-notes-v1',
      binding: { data_root: dataRoot, run_id: runId, action_id: `${runId}:analysis:unit-1`, task_id: 'task-analysis-1' },
      revision: 3,
      records: [{ record_id: 'note-1', kind: 'note', body: { original: 'Agent prose' }, evidence: ['repo:src/main.c:1-3'], relates_to: ['test-1'], created_revision: 3 }],
      completion: { complete: true, note: 'done', declared_revision: 3 }, warnings: [], receipts: {},
    })
    await writeJson(path.join(runRoot, 'progress.json'), {
      schema_version: '3.1', run_id: runId, workflow_version: 'source-first-v1', lifecycle_status: 'complete', stage: 'complete', quality_status: 'PASS',
      actions: { [`${runId}:analysis:unit-1`]: { action_id: `${runId}:analysis:unit-1`, action: 'dispatch_agent', role: 'analysis', stage: 'unit_analysis', task_path: taskPath, task_id: 'task-analysis-1', status: 'accepted' } },
      first_finish_revisions: { [`${runId}:analysis:unit-1`]: 3 }, accepted_revisions: { [`${runId}:analysis:unit-1`]: 3 },
      analysis_units: [], completed_analysis_units: [], completed_closure_units: [], degradations: [], errors: [], needs_user: false,
    })
    await writeFile(path.join(runRoot, 'report.md'), '# source-first\n', 'utf8')
    await writeFile(path.join(runRoot, 'report.html'), '<h1>source-first</h1>\n', 'utf8')
    await writeJson(path.join(runRoot, 'report-complete.json'), { files: ['report.md', 'report.html'] })
    const current = (await companionSnapshot({ dataRoot, runId })).current
    assert.equal(current.workflow_version, 'source-first-v1')
    assert.equal(current.phase, 'COMPLETE')
    assert.equal(current.quality_status, 'PASS')
    assert.equal(current.source_snapshot.status, 'manifest_verified')
    assert.equal(current.source_snapshot.file_count, 1)
    assert.equal(current.report_available, true)
    assert.equal(current.counts.risks, null)
    assert.equal(current.counts.test_cases, null)
    assert.equal(current.source_first_records[0].records[0].body.original, 'Agent prose')
    assert.deepEqual(current.source_first_records[0].records[0].evidence, ['repo:src/main.c:1-3'])
    assert.equal(current.source_first_records[0].revision, 3)
    assert.equal(current.first_finish_revisions[`${runId}:analysis:unit-1`], 3)
    assert.equal(current.accepted_revisions[`${runId}:analysis:unit-1`], 3)
    assert.equal(current.workflow.actions[0].first_finish_revision, 3)
    assert.equal(current.workflow.actions[0].accepted_revision, 3)
    await rm(path.join(runRoot, 'report-complete.json'))
    assert.equal((await companionSnapshot({ dataRoot, runId })).current.report_available, false)
    const stopped = await readFile(path.join(runRoot, 'progress.json'), 'utf8').then(JSON.parse)
    stopped.lifecycle_status = 'stopped'
    stopped.stage = 'analyzing'
    await writeJson(path.join(runRoot, 'progress.json'), stopped)
    const stoppedCurrent = (await companionSnapshot({ dataRoot, runId })).current
    assert.equal(stoppedCurrent.workflow.steps.find(item => item.stage === 'analyzing').status, 'stopped')
    assert.equal(stoppedCurrent.workflow.steps.find(item => item.stage === 'reviewing').status, 'pending')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('canonicalizes a symlinked data root before enforcing source-first result boundaries', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'source-first-reader-symlink-'))
  const workspace = path.join(root, 'workspace')
  const dataRoot = path.join(root, 'real-data')
  const linkedDataRoot = path.join(workspace, 'pangea-data')
  const runId = 'source-first-symlink-run'
  const runRoot = path.join(dataRoot, 'runs', runId)
  const taskPath = path.join(runRoot, 'agent-tasks', 'source-first', 'analysis-unit-1.json')
  const resultPath = path.join(runRoot, 'agent-results', 'source-first', 'analysis-unit-1.json')
  const manifestPath = path.join(runRoot, 'inputs', 'source-manifest.json')
  const indexPath = path.join(runRoot, 'inputs', 'source-index.json')
  try {
    await writeJson(path.join(runRoot, 'inputs', 'task-contract.json'), {
      workflow_version: 'source-first-v1', repository: 'repo', target: 'symlink target', source_scope: ['src/main.c'],
    })
    await writeJson(manifestPath, {
      workflow_version: 'source-first-v1', requested_scope: ['src/main.c'], source_index_path: indexPath,
      repositories: [{ repo_id: 'repo', source_root: path.join(runRoot, 'inputs', 'source', 'repo') }],
    })
    await writeJson(indexPath, {
      format_version: 'pangea-source-index-v1', file_count: 1,
      files: [{ repo_id: 'repo', path: 'src/main.c', line_count: 1, regions: [] }],
    })
    await writeJson(taskPath, {
      workflow_version: 'source-first-v1', action_id: `${runId}:analysis:unit-1`, run_id: runId,
      task_type: 'source_first_analysis', unit_id: 'unit-1', title: 'Unit one', result_path: resultPath,
    })
    await writeJson(resultPath, {
      format_version: 'pangea-notes-v1', binding: { data_root: dataRoot, run_id: runId, action_id: `${runId}:analysis:unit-1`, task_id: 'task-1' },
      revision: 0, records: [], completion: null, warnings: [], receipts: {},
    })
    await writeJson(path.join(runRoot, 'progress.json'), {
      schema_version: '3.1', run_id: runId, workflow_version: 'source-first-v1', lifecycle_status: 'running', stage: 'analyzing', quality_status: null,
      actions: { [`${runId}:analysis:unit-1`]: { action_id: `${runId}:analysis:unit-1`, action: 'dispatch_agent', role: 'analysis', stage: 'unit_analysis', task_path: taskPath, task_id: 'task-1', status: 'dispatched' } },
      first_finish_revisions: {}, accepted_revisions: {}, analysis_units: [], completed_analysis_units: [], completed_closure_units: [], degradations: [], errors: [], needs_user: false,
    })
    await mkdir(workspace, { recursive: true })
    await symlink(dataRoot, linkedDataRoot)
    const snapshot = await companionSnapshot({ cwd: workspace, runId })
    assert.equal(snapshot.data_root, await realpath(dataRoot))
    assert.equal(snapshot.current.reader_health.trusted, true)
    assert.deepEqual(snapshot.current.reader_warnings, [])
  } finally { await rm(root, { recursive: true, force: true }) }
})
