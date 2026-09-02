import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { companionSnapshot } from '../src/reader.js'

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
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
