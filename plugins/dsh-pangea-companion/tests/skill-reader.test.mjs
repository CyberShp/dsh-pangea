import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { companionSnapshot } from '../src/reader.js'
import { buildTestCaseCsv } from '../src/export.js'

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

test('stage documents keep their full path when live and formal outputs share filenames', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'pangea-stage-documents-')))
  const runId = 'same-name', runRoot = path.join(root, 'runs', runId), skillRoot = path.join(root, 'skill')
  const names = ['覆盖缺口分析.md', '黑盒测试用例.md']
  try {
    await writeJson(path.join(root, '.pangea/skill-runs', runId, 'metadata.json'), { run_id: runId, skill_root: skillRoot })
    await writeJson(path.join(skillRoot, 'workflow-manifest.json'), { steps: [
      { id: '03', title: '分析', required: names.map(name => `活文档/${name}`) },
      { id: '05', title: '交付', required: names.map(name => `正式输出/${name}`) },
    ] })
    await writeJson(path.join(runRoot, '内部索引/运行状态.json'), { status: 'complete', completed_steps: ['03', '05'] })
    for (const directory of ['活文档', '正式输出', '活文档/其他']) {
      await mkdir(path.join(runRoot, directory), { recursive: true })
      for (const name of names) await writeFile(path.join(runRoot, directory, name), '# 文档\n')
    }
    const current = (await companionSnapshot({ dataRoot: root, runId })).current
    assert.deepEqual(current.workflow.steps[0].artifacts.sort(), names.map(name => path.join(runRoot, '活文档', name)).sort())
    assert.deepEqual(current.workflow.steps[1].artifacts.sort(), names.map(name => path.join(runRoot, '正式输出', name)).sort())
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('completed workflow with 26 projected cases and 22 formal details reports exact omissions without inventing content', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codetalks-delivery-')))
  const runId = 'delivery', runRoot = path.join(root, 'runs', runId)
  const ids = [...Array.from({ length: 22 }, (_, n) => `case-${n}`), 'cap-01', 'cap-02', 'wrap-01', 'cycle-01']
  const detail = id => `## TC-${id}：用例\n**前置条件**：空队列\n**操作步骤**：\n1. 入队\n**预期结果**：成功\n**观测方式**：返回码\n**清理或恢复**：销毁队列\n\n`
  try {
    await writeJson(path.join(root, '.pangea/skill-runs', runId, 'metadata.json'), { run_id: runId, request: { mode: 'depth' } })
    await writeJson(path.join(runRoot, '内部索引/运行状态.json'), { status: 'complete', verdict: 'READY', completed_steps: ['01','02','03','04','05','06','07','08','09'] })
    await writeJson(path.join(runRoot, '内部索引/工作台投影.json'), {
      schema_version: '1.0', run_id: runId, test_cases: ids.map(test_case_id => ({ test_case_id, steps: ['索引中的内容不可填补正式缺项'] })),
      risks: [], evidence: [], business_flows: [], review_issues: [],
    })
    await mkdir(path.join(runRoot, '正式输出'), { recursive: true })
    const formal = path.join(runRoot, '正式输出/黑盒测试用例.md')
    await writeFile(formal, ids.slice(0, 22).map(detail).join(''))
    const current = (await companionSnapshot({ dataRoot: root, runId })).current
    assert.equal(current.lifecycle_status, 'complete')
    assert.equal(current.delivery_integrity.status, 'incomplete')
    assert.equal(current.delivery_integrity.complete_count, 22)
    assert.deepEqual(current.delivery_integrity.issues.map(i => i.test_case_id), ids.slice(22))
    assert.equal(current.semantic_review.verdict, null)
    assert.equal(current.semantic_review.method, 'not_recorded')
    assert.deepEqual(current.details.test_cases.at(-1).steps, [])
    assert.doesNotMatch(buildTestCaseCsv(current), /索引中的内容/)
    await writeFile(formal, ids.map(detail).join(''))
    await writeJson(path.join(runRoot, '内部索引/独立审查状态.json'), { independent: false, semantic_verdict: 'UNRESOLVED', summary: '争议保留' })
    const repaired = (await companionSnapshot({ dataRoot: root, runId })).current
    assert.equal(repaired.delivery_integrity.status, 'complete')
    assert.equal(repaired.semantic_review.verdict, 'UNRESOLVED')
    assert.equal(repaired.semantic_review.method, 'self_review')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('exports multiple cases from a combined Skill draft with inline and labelled fields', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codetalks-combined-cases-')))
  const dataRoot = path.join(root, 'data'), runId = 'combined'
  const runRoot = path.join(dataRoot, 'runs', runId)
  try {
    await writeJson(path.join(dataRoot, '.pangea/skill-runs', runId, 'metadata.json'), { run_id: runId, run_root: runRoot, status: 'active' })
    await writeJson(path.join(runRoot, '内部索引/运行状态.json'), { status: 'in_progress', completed_steps: ['01','02','03','04','05','06','07'] })
    await mkdir(path.join(runRoot, '活文档/测试设计'), { recursive: true })
    await writeFile(path.join(runRoot, '活文档/18-测试追溯矩阵.md'), '| 用例 ID | 分支 | 风险 |\n| --- | --- | --- |\n| TC-001 | BR-01 | - |\n')
    await writeFile(path.join(runRoot, '活文档/测试设计/工作草稿.md'), '# 工作草稿\n\n## 用例\n\n### TC-001：偶数返回1\n- 前置：测试入口可用。 步骤：传 2。 注入：无。 预期：返回 1。 后续：无。 清理：无。\n\n### TC-002: 限幅\n- **前置条件**：区间 [0,10]。\n- **输入**：`clamp(15,0,10)`。\n- **预期**：返回 `10`。\n- **观测**：函数返回值。\n- **清理**：无。\n\n## 无关章节\n- 步骤：不得串入任何用例。\n\n## 表格用例\n| 用例 ID | 名称 | 操作步骤 | 期望结果（Oracle） | 关联风险 |\n| --- | --- | --- | --- | --- |\n| TC-003 | 符号为零 | 调用 signum(0) | 返回 0 且无异常 | R-001、R-002 |\n| TC-001 | 摘要重复 | 不覆盖详细步骤 | 不覆盖详细预期 | |\n')
    const current = (await companionSnapshot({ dataRoot, runId })).current
    assert.deepEqual(current.details.test_cases.map(item => item.test_case_id), ['TC-001','TC-002','TC-003'])
    assert.deepEqual(current.details.test_cases[0].steps, ['传 2。'])
    assert.deepEqual(current.details.test_cases[0].expected_results, ['返回 1。'])
    assert.deepEqual(current.details.test_cases[0].linked_risk_ids, [])
    assert.deepEqual(current.details.test_cases[1].steps, ['`clamp(15,0,10)`。'])
    assert.deepEqual(current.details.test_cases[1].observability, ['函数返回值。'])
    assert.deepEqual(current.details.test_cases[2].steps, ['调用 signum(0)'])
    assert.deepEqual(current.details.test_cases[2].expected_results, ['返回 0 且无异常'])
    assert.deepEqual(current.details.test_cases[2].linked_risk_ids, ['R-001','R-002'])
    const csv = buildTestCaseCsv(current)
    assert.match(csv, /传 2。/)
    assert.match(csv, /返回 `10`。/)
    assert.doesNotMatch(csv, /不得串入/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('exports final mixed-case IDs and bold labelled blocks while preserving projection IDs', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codetalks-final-labelled-cases-')))
  const dataRoot = path.join(root, 'data'), runId = 'final-labelled'
  const runRoot = path.join(dataRoot, 'runs', runId)
  try {
    await writeJson(path.join(dataRoot, '.pangea/skill-runs', runId, 'metadata.json'), { run_id: runId, run_root: runRoot, status: 'active' })
    await writeJson(path.join(runRoot, '内部索引/运行状态.json'), { status: 'complete', completed_steps: ['01','02','03','04','05','06','07','08','09'] })
    await writeJson(path.join(runRoot, '内部索引/工作台投影.json'), {
      schema_version: '1.0', run_id: runId, publication: { state: 'final', revision: 1, step_id: '09' },
      test_cases: [{ test_case_id: 'init-01', title: '初始化', type: 'negative' }, { test_case_id: 'peek-04', title: '查询边界' }],
      risks: [], evidence: [], business_flows: [], review_issues: [],
    })
    await mkdir(path.join(runRoot, '活文档/测试设计'), { recursive: true })
    await writeFile(path.join(runRoot, '活文档/测试设计/草稿.md'), '# TC-init-01 初始化\n- 步骤：旧草稿步骤\n- 预期：旧草稿结果\n')
    await writeFile(path.join(runRoot, '活文档/18-测试追溯矩阵.md'), '| 用例 ID | 风险 |\n| --- | --- |\n| init-01 | — |\n| peek-04 | R-01 |\n')
    await mkdir(path.join(runRoot, '正式输出'), { recursive: true })
    await writeFile(path.join(runRoot, '正式输出/黑盒测试用例.md'), '# 黑盒测试用例\n\n## TC-init-01：初始化\n**前置条件**：零初始化对象\n**输入**：capacity=4\n**操作步骤**：\n1. 调用 mq_init(&q, 4)\n2. 调用 mq_size(&q)\n**预期结果**：返回 MQ_OK，size=0\n\n---\n\n## TC-peek-04 ⚠：查询边界\n**操作步骤**：\n1. 调用 mq_peek(&q, 0, &out)\n**预期结果（设计）**：MQ_INVALID\n**预期结果（源码实际）**：MQ_OK\n\n## 无关章节\n1. 不得串入用例\n')
    const current = (await companionSnapshot({ dataRoot, runId })).current
    assert.deepEqual(current.details.test_cases.map(item => item.test_case_id), ['init-01', 'peek-04'])
    assert.deepEqual(current.details.test_cases[0].steps, ['调用 mq_init(&q, 4)', '调用 mq_size(&q)'])
    assert.deepEqual(current.details.test_cases[0].preconditions, ['零初始化对象'])
    assert.deepEqual(current.details.test_cases[0].expected_results, ['返回 MQ_OK，size=0'])
    assert.equal(current.details.test_cases[0].case_type, 'negative')
    assert.deepEqual(current.details.test_cases[1].linked_risk_ids, ['R-01'])
    assert.deepEqual(current.details.test_cases[1].expected_results, ['（设计）MQ_INVALID', '（源码实际）MQ_OK'])
    const csv = buildTestCaseCsv(current)
    assert.match(csv, /调用 mq_init/)
    assert.match(csv, /（设计）MQ_INVALID/)
    assert.doesNotMatch(csv, /旧草稿|不得串入/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('reads Codetalks state and maps Step 01–09 Markdown lifecycle', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codetalks-reader-')))
  const dataRoot = path.join(root, 'pangea-data')
  const runRoot = path.join(dataRoot, 'runs', 'skill-run-1')
  const metadataRoot = path.join(dataRoot, '.pangea', 'skill-runs', 'skill-run-1')
  try {
    await writeJson(path.join(metadataRoot, 'metadata.json'), {
      run_id: 'skill-run-1', status: 'active', run_root: runRoot,
      request_path: path.join(metadataRoot, 'request.md'), request: { repository: 'repo', target: 'auth' },
    })
    await writeJson(path.join(runRoot, '内部索引', '运行状态.json'), {
      status: 'running', current_step: '04', completed_steps: ['01', '02', '03'], updated_at: '2026-09-07T03:38:18Z',
      core_rules_ack: {
        'path-fidelity': { file: 'core-rules/path-fidelity.md', sha256: 'a', ack_at: '2026-09-07T03:22:02Z' },
        'evidence-consumption': { file: 'core-rules/evidence-consumption.md', sha256: 'b', ack_at: '2026-09-07T03:22:03Z' },
        'narrative-first': { file: 'core-rules/narrative-first.md', sha256: 'c', ack_at: '2026-09-07T03:22:03Z' },
      },
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
    assert.equal(Object.keys(snapshot.current.workflow.core_rules_ack).length, 3)
    assert.equal(snapshot.current.state_read.status, 'ok')
    assert.equal(snapshot.current.state_read.updated_at, '2026-09-07T03:38:18Z')
    assert.equal(snapshot.current.data_root, dataRoot)
    assert.equal(snapshot.current.workflow.actions.length, 0)
    assert.equal(snapshot.current.workflow.units.length, 0)
    assert.equal(snapshot.current.publication.state, 'pending')
    assert.equal(snapshot.current.reader_health.status, 'pending')
    assert.deepEqual(snapshot.current.workflow.unresolved, [])
    assert.deepEqual(snapshot.current.reader_warnings, [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('uses the canonical Run directory after a portable workspace move', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codetalks-reader-portable-')))
  const dataRoot = path.join(root, 'pangea-data')
  const runId = 'portable-run'
  const runRoot = path.join(dataRoot, 'runs', runId)
  const metadataRoot = path.join(dataRoot, '.pangea', 'skill-runs', runId)
  try {
    await writeJson(path.join(metadataRoot, 'metadata.json'), {
      run_id: runId, status: 'active', run_root: path.join(root, 'old-install', 'pangea-data', 'runs', runId),
      request: { repository: 'repo', target: 'portable' },
    })
    await writeJson(path.join(runRoot, '内部索引', '运行状态.json'), {
      status: 'in_progress', current_step: '03', completed_steps: ['01', '02'], updated_at: '2026-09-07T03:38:18Z',
    })
    const current = (await companionSnapshot({ dataRoot, runId })).current
    assert.equal(current.artifacts.run_directory, runRoot)
    assert.equal(current.phase, 'STEP_03')
    assert.equal(current.analysis.completed, 2)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('reports an explicitly selected unreadable Run instead of falling back to another Run', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codetalks-reader-corrupt-')))
  const dataRoot = path.join(root, 'pangea-data')
  const runId = 'corrupt-run'
  const runRoot = path.join(dataRoot, 'runs', runId)
  const metadataRoot = path.join(dataRoot, '.pangea', 'skill-runs', runId)
  try {
    await writeJson(path.join(metadataRoot, 'metadata.json'), { run_id: runId, status: 'active', run_root: runRoot })
    await mkdir(path.join(runRoot, '内部索引'), { recursive: true })
    await writeFile(path.join(runRoot, '内部索引', '运行状态.json'), '{broken', 'utf8')
    await assert.rejects(() => companionSnapshot({ dataRoot, runId }), /JSON/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('accepts a UTF-8 BOM in a state file without losing progress', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codetalks-reader-bom-')))
  const dataRoot = path.join(root, 'pangea-data')
  const runId = 'bom-run'
  const runRoot = path.join(dataRoot, 'runs', runId)
  const metadataRoot = path.join(dataRoot, '.pangea', 'skill-runs', runId)
  try {
    await writeJson(path.join(metadataRoot, 'metadata.json'), { run_id: runId, status: 'active', run_root: runRoot })
    const statePath = path.join(runRoot, '内部索引', '运行状态.json')
    await mkdir(path.dirname(statePath), { recursive: true })
    await writeFile(statePath, `\uFEFF${JSON.stringify({ status: 'in_progress', current_step: '03', completed_steps: ['01', '02'] })}`, 'utf8')
    const current = (await companionSnapshot({ dataRoot, runId })).current
    assert.equal(current.phase, 'STEP_03')
    assert.equal(current.analysis.completed, 2)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('exposes step timing evidence without treating it as a quality verdict', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codetalks-reader-performance-')))
  const dataRoot = path.join(root, 'pangea-data')
  const runId = 'performance-run'
  const runRoot = path.join(dataRoot, 'runs', runId)
  const metadataRoot = path.join(dataRoot, '.pangea', 'skill-runs', runId)
  try {
    await writeJson(path.join(metadataRoot, 'metadata.json'), {
      run_id: runId, status: 'active', run_root: runRoot,
      request_path: path.join(metadataRoot, 'request.md'), request: { repository: 'repo', target: 'performance' },
    })
    await writeJson(path.join(runRoot, '内部索引', '运行状态.json'), {
      status: 'running', current_step: '04', completed_steps: ['01', '02', '03'],
      performance: {
        version: 1, progress_updates: 7,
        steps: { '03': { duration_ms: 8123, artifact_bytes_delta: 4096, progress_updates: 3 } },
      },
    })
    const current = (await companionSnapshot({ dataRoot, runId })).current
    assert.equal(current.performance.progress_updates, 7)
    assert.equal(current.performance.steps['03'].duration_ms, 8123)
    assert.equal(current.reader_health.status, 'pending')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('marks a completed Run without its final projection as broken', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codetalks-reader-missing-final-')))
  const dataRoot = path.join(root, 'pangea-data')
  const runId = 'missing-final-projection'
  const runRoot = path.join(dataRoot, 'runs', runId)
  const metadataRoot = path.join(dataRoot, '.pangea', 'skill-runs', runId)
  try {
    await writeJson(path.join(metadataRoot, 'metadata.json'), {
      run_id: runId, status: 'active', run_root: runRoot,
      request_path: path.join(metadataRoot, 'request.md'), request: { repository: 'repo', target: 'missing projection' },
    })
    await writeJson(path.join(runRoot, '内部索引', '运行状态.json'), {
      status: 'complete', current_step: '09', completed_steps: ['01', '02', '03', '04', '05', '06', '07', '08', '09'],
      verdict: 'PASS', judge: { required: true, status: 'complete' },
    })
    await mkdir(path.join(runRoot, '正式输出'), { recursive: true })
    await writeFile(path.join(runRoot, '正式输出', '完整分析报告.md'), '# 完整分析报告\n', 'utf8')
    const current = (await companionSnapshot({ dataRoot, runId })).current
    assert.equal(current.publication.state, 'broken')
    assert.equal(current.reader_health.status, 'warning')
    assert.equal(current.workflow.unresolved[0].code, 'PROJECTION_UNAVAILABLE')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('keeps an active Step 09 publication pending while the report and projection are written', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codetalks-reader-step09-publish-')))
  const dataRoot = path.join(root, 'pangea-data')
  const runId = 'step09-publish-window'
  const runRoot = path.join(dataRoot, 'runs', runId)
  const metadataRoot = path.join(dataRoot, '.pangea', 'skill-runs', runId)
  try {
    await writeJson(path.join(metadataRoot, 'metadata.json'), {
      run_id: runId, status: 'active', run_root: runRoot,
      request_path: path.join(metadataRoot, 'request.md'), request: { repository: 'repo', target: 'publishing' },
    })
    await writeJson(path.join(runRoot, '内部索引', '运行状态.json'), {
      status: 'in_progress', current_step: '09', completed_steps: ['01', '02', '03', '04', '05', '06', '07', '08'],
      publication: { state: 'pending', revision: 0, step_id: null },
    })
    await mkdir(path.join(runRoot, '正式输出'), { recursive: true })
    await writeFile(path.join(runRoot, '正式输出', '完整分析报告.md'), '# 完整分析报告\n', 'utf8')

    const current = (await companionSnapshot({ dataRoot, runId })).current
    assert.equal(current.lifecycle_status, 'running')
    assert.equal(current.publication.state, 'pending')
    assert.equal(current.reader_health.status, 'pending')
    assert.deepEqual(current.workflow.unresolved, [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('does not carry a previous broken publication into a resumed active Step 09 attempt', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codetalks-reader-resumed-step09-')))
  const dataRoot = path.join(root, 'pangea-data')
  const runId = 'resumed-step09'
  const runRoot = path.join(dataRoot, 'runs', runId)
  const metadataRoot = path.join(dataRoot, '.pangea', 'skill-runs', runId)
  try {
    await writeJson(path.join(metadataRoot, 'metadata.json'), {
      run_id: runId, status: 'active', run_root: runRoot,
      request_path: path.join(metadataRoot, 'request.md'), request: { repository: 'repo', target: 'resumed publishing' },
    })
    await writeJson(path.join(runRoot, '内部索引', '运行状态.json'), {
      status: 'running', current_step: '09', completed_steps: ['01', '02', '03', '04', '05', '06', '07', '08'],
      publication: { state: 'broken', revision: 1, step_id: '09' },
    })
    const current = (await companionSnapshot({ dataRoot, runId })).current
    assert.equal(current.lifecycle_status, 'running')
    assert.equal(current.publication.state, 'pending')
    assert.equal(current.reader_health.status, 'pending')
    assert.deepEqual(current.workflow.unresolved, [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('reads Step 05 risks and Step 07 test cases as an unpublished Markdown draft', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codetalks-reader-live-draft-')))
  const dataRoot = path.join(root, 'pangea-data')
  const runId = 'live-draft'
  const runRoot = path.join(dataRoot, 'runs', runId)
  const metadataRoot = path.join(dataRoot, '.pangea', 'skill-runs', runId)
  try {
    await writeJson(path.join(metadataRoot, 'metadata.json'), {
      run_id: runId, status: 'active', run_root: runRoot,
      request_path: path.join(metadataRoot, 'request.md'), request: { repository: 'repo', target: 'live draft' },
    })
    await writeJson(path.join(runRoot, '内部索引', '运行状态.json'), {
      status: 'in_progress', current_step: '08', completed_steps: ['01', '02', '03', '04', '05', '06', '07'],
    })
    const liveRoot = path.join(runRoot, '活文档')
    await mkdir(path.join(liveRoot, '测试设计'), { recursive: true })
    await writeFile(path.join(liveRoot, '14-风险点清单与因果说明.md'), `# 风险点清单\n\n### RP-01：连接创建失败\n\`\`\`text\n条件：端口被占用\n→ 代码失效：连接为空但继续执行\n→ 残留：状态已经注册\n→ 看似正常：初始化返回成功\n→ 暴露：没有报文或进程退出\n→ 黑盒证明：占用端口后抓包\n\`\`\`\n`, 'utf8')
    await writeFile(path.join(liveRoot, '15-SFMEA分析.md'), `# SFMEA\n\n| 风险 | 机制 | 触发 | 用户影响 | S | O | D | RPN | 等级 | 黑盒验证方法 |\n|---|---|---|---|---|---|---|---|---|---|\n| RP-01 连接创建失败 | 连接为空 | 端口占用 | 无报文 | 4 | 2 | 2 | 16 | P1 | 抓包 |\n`, 'utf8')
    await writeFile(path.join(liveRoot, '测试设计', '用例-TC-NET-01.md'), `# TC-NET-01 端口占用时启动\n\n## 用例定位\n\n- Case ID：TC-NET-01\n- 优先级：P1\n- 测试类型：异常路径\n\n## 前置条件\n\n- 抓包已启动。\n\n## 操作步骤\n\n1. 占用服务端口。\n2. 启动被测程序。\n\n## 预期结果和 Oracle\n\n- 没有发送报文，并报告启动失败。\n\n## 清理和复原\n\n- 释放端口。\n`, 'utf8')
    await writeFile(path.join(liveRoot, '18-测试追溯矩阵.md'), `# 追溯矩阵\n\n| CASE ID | 关联场景 | 流程 | 风险 | 等级 | 覆盖点 | 优先级 |\n|---|---|---|---|---|---|---|\n| TC-NET-01 端口占用时启动 | SC-NET | FLOW-NET | RP-01 | P1 | 启动失败 | P1 |\n`, 'utf8')

    const current = (await companionSnapshot({ dataRoot, runId })).current
    assert.deepEqual(current.publication, { state: 'draft', revision: 0, step_id: '07' })
    assert.equal(current.reader_health.status, 'pending')
    assert.equal(current.reader_health.trusted, false)
    assert.equal(current.counts.risks, 1)
    assert.equal(current.counts.test_cases, 1)
    assert.equal(current.details.risks[0].risk_id, 'RP-01')
    assert.equal(current.details.risks[0].severity, 'High')
    assert.equal(current.details.risks[0].trigger, '端口被占用')
    assert.deepEqual(current.details.risks[0].linked_test_case_ids, ['TC-NET-01'])
    assert.equal(current.details.test_cases[0].test_case_id, 'TC-NET-01')
    assert.deepEqual(current.details.test_cases[0].linked_risk_ids, ['RP-01'])
    assert.deepEqual(current.details.test_cases[0].steps, ['占用服务端口。', '启动被测程序。'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('normalizes Lua projection severities and enriches R risks with the complete causal chain', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codetalks-reader-lua-risks-')))
  const dataRoot = path.join(root, 'pangea-data')
  const runId = 'lua-risk-details'
  const runRoot = path.join(dataRoot, 'runs', runId)
  const metadataRoot = path.join(dataRoot, '.pangea', 'skill-runs', runId)
  const severities = ['medium', 'high', 'high', ...Array(7).fill('medium'), 'low']
  try {
    await writeJson(path.join(metadataRoot, 'metadata.json'), {
      run_id: runId, status: 'active', run_root: runRoot,
      request_path: path.join(metadataRoot, 'request.md'), request: { repository: 'morf-rest-server', target: 'network interface collection' },
    })
    await writeJson(path.join(runRoot, '内部索引', '运行状态.json'), {
      status: 'in_progress', current_step: '08', completed_steps: ['01', '02', '03', '04', '05', '06', '07'],
      publication: { state: 'draft', revision: 3, step_id: '07' },
    })
    await writeJson(path.join(runRoot, '内部索引', '工作台投影.json'), {
      schema_version: '1.0', run_id: runId,
      publication: { state: 'draft', revision: 3, step_id: '07' },
      business_flows: [], review_issues: [], test_cases: [], evidence: [],
      risks: severities.map((severity, index) => ({
        risk_id: `R-${String(index + 1).padStart(3, '0')}`,
        title: `风险 ${index + 1}`,
        severity,
        description: index === 0 ? '父键缺失时正常集合被误判不存在' : `风险概要 ${index + 1}`,
        trigger: '', system_result: '', external_observation: '', blackbox_proof: '',
      })),
    })
    const liveRoot = path.join(runRoot, '活文档')
    await mkdir(liveRoot, { recursive: true })
    const sections = severities.map((_, index) => {
      const id = `R-${String(index + 1).padStart(3, '0')}`
      return `### ${id} — 风险 ${index + 1}\n\n- **什么条件发生**：触发 ${id}\n- **代码内部哪里失效**：失效 ${id}\n- **状态/数据留下什么**：残留 ${id}\n- **为什么看似正常**：表面正常 ${id}\n- **何时对外暴露**：暴露 ${id}\n- **黑盒如何证明**：证明 ${id}\n`
    }).join('\n')
    await writeFile(path.join(liveRoot, '14-风险点清单与因果说明.md'), `# 风险点清单\n\n${sections}\n## 三、风险-场景-源码映射汇总\n\n| 风险 | 场景 |\n|---|---|\n| R-011 | SC-011 |\n`, 'utf8')

    const current = (await companionSnapshot({ dataRoot, runId })).current
    assert.equal(current.counts.risks, 11)
    assert.deepEqual(
      Object.fromEntries(['Critical', 'High', 'Medium', 'Low'].map(level => [level, current.details.risks.filter(item => item.severity === level).length])),
      { Critical: 0, High: 2, Medium: 8, Low: 1 },
    )
    const risk = current.details.risks.find(item => item.risk_id === 'R-001')
    assert.equal(risk.narrative, '父键缺失时正常集合被误判不存在')
    assert.equal(risk.trigger, '触发 R-001')
    assert.equal(risk.system_result, '失效 R-001')
    assert.equal(risk.residual_effect, '残留 R-001')
    assert.equal(risk.apparent_normality, '表面正常 R-001')
    assert.equal(risk.external_observation, '暴露 R-001')
    assert.equal(risk.blackbox_proof, '证明 R-001')
    assert.doesNotMatch(current.details.risks.at(-1).blackbox_proof, /风险-场景-源码映射汇总/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('keeps live R risks ungraded when no explicit severity is associated with the risk id', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codetalks-reader-ungraded-risks-')))
  const dataRoot = path.join(root, 'pangea-data')
  const runId = 'ungraded-risks'
  const runRoot = path.join(dataRoot, 'runs', runId)
  const metadataRoot = path.join(dataRoot, '.pangea', 'skill-runs', runId)
  try {
    await writeJson(path.join(metadataRoot, 'metadata.json'), {
      run_id: runId, status: 'active', run_root: runRoot,
      request_path: path.join(metadataRoot, 'request.md'), request: { repository: 'repo', target: 'ungraded risks' },
    })
    await writeJson(path.join(runRoot, '内部索引', '运行状态.json'), {
      status: 'in_progress', current_step: '06', completed_steps: ['01', '02', '03', '04', '05'],
    })
    const liveRoot = path.join(runRoot, '活文档')
    await mkdir(liveRoot, { recursive: true })
    await writeFile(path.join(liveRoot, '14-风险点清单与因果说明.md'), '# 风险\n\n### R-001 — 未分级风险\n\n- **什么条件发生**：输入缺失\n- **代码内部哪里失效**：读取失败\n', 'utf8')
    await writeFile(path.join(liveRoot, '15-SFMEA分析.md'), '# SFMEA\n\n| 失效模式 | 等级 |\n|---|---|\n| FM-001 | S4 |\n', 'utf8')

    const current = (await companionSnapshot({ dataRoot, runId })).current
    assert.equal(current.counts.risks, 1)
    assert.equal(current.details.risks[0].severity, null)
    assert.equal(current.details.risks[0].severity_source, null)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('enriches a final workbench projection with live risk, evidence, and test case details', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codetalks-reader-final-details-')))
  const dataRoot = path.join(root, 'pangea-data')
  const runId = 'final-details'
  const runRoot = path.join(dataRoot, 'runs', runId)
  const metadataRoot = path.join(dataRoot, '.pangea', 'skill-runs', runId)
  try {
    await writeJson(path.join(metadataRoot, 'metadata.json'), {
      run_id: runId, status: 'active', run_root: runRoot,
      request_path: path.join(metadataRoot, 'request.md'), request: { repository: 'repo', target: 'final details' },
    })
    await writeJson(path.join(runRoot, '内部索引', '运行状态.json'), {
      status: 'complete', current_step: '09', completed_steps: ['01', '02', '03', '04', '05', '06', '07', '08', '09'],
      verdict: 'PASS', judge: { required: true, status: 'complete' },
    })
    await writeJson(path.join(runRoot, '内部索引', '工作台投影.json'), {
      schema_version: '1.0', run_id: runId,
      publication: { state: 'final', revision: 1, step_id: '09' },
      business_flows: [], review_issues: [],
      risks: [{
        risk_id: 'RP-01', title: '连接创建失败', severity: 'P1',
        narrative: '连接为空但继续执行，外部表现为没有报文。',
        source_section: '',
        evidence_ids: ['EVID-NET'], linked_test_case_ids: ['TC-NET-01'],
      }],
      test_cases: [{ test_case_id: 'TC-NET-01', title: '端口占用时启动', priority: 'P1', linked_risk_ids: ['RP-01'] }],
      evidence: [{ evidence_id: 'EVID-NET', location: 'repo:src/net.c:41-48', type: 'source_c', narrative: '失败路径保留空连接。' }],
    })
    const liveRoot = path.join(runRoot, '活文档')
    await mkdir(path.join(liveRoot, '测试设计'), { recursive: true })
    await writeFile(path.join(liveRoot, '14-风险点清单与因果说明.md'), `# 风险点清单\n\n### RP-01：连接创建失败\n\`\`\`text\n条件：端口被占用\n→ 代码失效：连接为空但继续执行\n→ 暴露：没有发送报文\n→ 黑盒证明：占用端口后抓包\n\`\`\`\n`, 'utf8')
    await writeFile(path.join(liveRoot, '15-SFMEA分析.md'), `# SFMEA\n\n| 风险 | 机制 | 触发 | 用户影响 | S | O | D | RPN | 等级 | 黑盒验证方法 |\n|---|---|---|---|---|---|---|---|---|---|\n| RP-01 连接创建失败 | 连接为空 | 端口占用 | 无报文 | 4 | 2 | 2 | 16 | P1 | 抓包 |\n`, 'utf8')
    await writeFile(path.join(liveRoot, '测试设计', '用例-TC-NET-01.md'), `# TC-NET-01 端口占用时启动\n\n## 用例定位\n\n- Case ID：TC-NET-01\n- 优先级：P1\n- 测试类型：异常路径\n\n## 前置条件\n\n- 抓包已启动。\n\n## 操作步骤\n\n1. 占用服务端口。\n2. 启动被测程序。\n\n## 预期结果和 Oracle\n\n- 没有发送报文，并报告启动失败。\n\n## 清理和复原\n\n- 释放端口。\n`, 'utf8')
    await writeFile(path.join(liveRoot, '18-测试追溯矩阵.md'), `# 追溯矩阵\n\n| CASE ID | 关联场景 | 流程 | 风险 | 等级 | 覆盖点 | 优先级 |\n|---|---|---|---|---|---|---|\n| TC-NET-01 端口占用时启动 | SC-NET | FLOW-NET | RP-01 | P1 | 启动失败 | P1 |\n`, 'utf8')
    await mkdir(path.join(runRoot, '正式输出'), { recursive: true })
    await writeFile(path.join(runRoot, '正式输出', '完整分析报告.md'), '# 完整分析报告\n', 'utf8')

    await writeFile(path.join(runRoot, '正式输出/黑盒测试用例.md'), await readFile(path.join(liveRoot, '测试设计/用例-TC-NET-01.md'), 'utf8'))
    const current = (await companionSnapshot({ dataRoot, runId })).current
    assert.equal(current.publication.state, 'final')
    assert.equal(current.reader_health.trusted, true)
    assert.equal(current.details.risks[0].severity, 'High')
    assert.equal(current.details.risks[0].trigger, '端口被占用')
    assert.equal(current.details.risks[0].system_result, '连接为空但继续执行')
    assert.match(current.details.risks[0].source_section, /端口被占用/)
    assert.equal(current.details.risks[0].evidence.length, 1)
    assert.equal(current.details.risks[0].evidence[0].chunk_id, 'EVID-NET')
    assert.equal(current.details.risks[0].evidence[0].observation, '失败路径保留空连接。')
    assert.deepEqual(current.details.risks[0].evidence[0].risk_ids, ['RP-01'])
    assert.equal(current.details.risks[0].confidence, undefined)
    assert.deepEqual(current.details.test_cases[0].linked_risk_ids, ['RP-01'])
    assert.equal(current.details.test_cases[0].case_type, '异常路径')
    assert.deepEqual(current.details.test_cases[0].preconditions, ['抓包已启动。'])
    assert.deepEqual(current.details.test_cases[0].steps, ['占用服务端口。', '启动被测程序。'])
    assert.deepEqual(current.details.test_cases[0].expected_results, ['没有发送报文，并报告启动失败。'])
    assert.equal(current.details.test_cases[0].status, undefined)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('preserves a published draft revision and step before final delivery', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codetalks-reader-draft-publication-')))
  const dataRoot = path.join(root, 'pangea-data')
  const runId = 'draft-publication'
  const runRoot = path.join(dataRoot, 'runs', runId)
  const metadataRoot = path.join(dataRoot, '.pangea', 'skill-runs', runId)
  try {
    await writeJson(path.join(metadataRoot, 'metadata.json'), {
      run_id: runId, status: 'active', run_root: runRoot,
      request_path: path.join(metadataRoot, 'request.md'), request: { repository: 'repo', target: 'draft' },
    })
    await writeJson(path.join(runRoot, '内部索引', '运行状态.json'), {
      status: 'running', current_step: '06', completed_steps: ['01', '02', '03', '04', '05'],
      publication: { state: 'draft', revision: 3, step_id: '05' },
    })
    await writeJson(path.join(runRoot, '内部索引', '工作台投影.json'), {
      schema_version: '1.0', run_id: runId,
      publication: { state: 'draft', revision: 3, step_id: '05' },
      business_flows: [], risks: [{ risk_id: 'R-1' }], test_cases: [], evidence: [], review_issues: [],
    })
    const current = (await companionSnapshot({ dataRoot, runId })).current
    assert.deepEqual(current.publication, { state: 'draft', revision: 3, step_id: '05' })
    assert.equal(current.reader_health.status, 'ok')
    assert.equal(current.counts.risks, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('reports a malformed projection during an active Run instead of hiding it as pending', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codetalks-reader-malformed-')))
  const dataRoot = path.join(root, 'pangea-data')
  const runId = 'malformed-projection'
  const runRoot = path.join(dataRoot, 'runs', runId)
  const metadataRoot = path.join(dataRoot, '.pangea', 'skill-runs', runId)
  try {
    await writeJson(path.join(metadataRoot, 'metadata.json'), {
      run_id: runId, status: 'active', run_root: runRoot,
      request_path: path.join(metadataRoot, 'request.md'), request: { repository: 'repo', target: 'malformed' },
    })
    await writeJson(path.join(runRoot, '内部索引', '运行状态.json'), {
      status: 'running', current_step: '06', completed_steps: ['01', '02', '03', '04', '05'],
    })
    await mkdir(path.join(runRoot, '内部索引'), { recursive: true })
    await writeFile(path.join(runRoot, '内部索引', '工作台投影.json'), '{invalid json', 'utf8')
    const current = (await companionSnapshot({ dataRoot, runId })).current
    assert.equal(current.publication.state, 'broken')
    assert.equal(current.reader_health.status, 'warning')
    assert.equal(current.reader_health.trusted, false)
    assert.match(current.workflow.unresolved[0].message, /解析失败/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('never marks an explicitly broken projection as trusted', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codetalks-reader-broken-')))
  const dataRoot = path.join(root, 'pangea-data')
  const runId = 'broken-projection'
  const runRoot = path.join(dataRoot, 'runs', runId)
  const metadataRoot = path.join(dataRoot, '.pangea', 'skill-runs', runId)
  try {
    await writeJson(path.join(metadataRoot, 'metadata.json'), {
      run_id: runId, status: 'active', run_root: runRoot,
      request_path: path.join(metadataRoot, 'request.md'), request: { repository: 'repo', target: 'broken' },
    })
    await writeJson(path.join(runRoot, '内部索引', '运行状态.json'), {
      status: 'running', current_step: '06', completed_steps: ['01', '02', '03', '04', '05'],
    })
    await writeJson(path.join(runRoot, '内部索引', '工作台投影.json'), {
      schema_version: '1.0', run_id: runId,
      publication: { state: 'broken', revision: 1, step_id: '05' },
      business_flows: [], risks: [], test_cases: [], evidence: [], review_issues: [],
    })
    const current = (await companionSnapshot({ dataRoot, runId })).current
    assert.equal(current.publication.state, 'broken')
    assert.equal(current.reader_health.status, 'warning')
    assert.equal(current.reader_health.trusted, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('marks only a validated complete Skill state as terminal complete', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codetalks-complete-')))
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
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codetalks-history-selection-')))
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
    await utimes(path.join(dataRoot, 'runs', 'historical-run', '内部索引', '运行状态.json'), oldTime, oldTime)
    const snapshot = await companionSnapshot({ dataRoot, runId: 'historical-run', limit: 1 })
    assert.equal(snapshot.runs.length, 1)
    assert.equal(snapshot.runs[0].run_id, 'latest-run')
    assert.equal(snapshot.current.run_id, 'historical-run')
    assert.equal(snapshot.current.target, '历史失败任务')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('reads snapshot metadata without rehashing every frozen source file', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codetalks-snapshot-metadata-')))
  const dataRoot = path.join(root, 'pangea-data')
  const runId = 'large-source-run'
  const runRoot = path.join(dataRoot, 'runs', runId)
  const metadataRoot = path.join(dataRoot, '.pangea', 'skill-runs', runId)
  const files = [{ path: 'src/large.c', size: 1024 }]
  const sourceSnapshot = { schema_version: '2.0', run_id: runId, repo_id: 'repo', files, file_count: 1, total_bytes: 1024 }
  try {
    await writeJson(path.join(metadataRoot, 'metadata.json'), {
      run_id: runId, status: 'active', run_root: runRoot, source_snapshot: sourceSnapshot,
      request_path: path.join(metadataRoot, 'request.md'), request: { repository: 'repo', target: 'large source' },
    })
    await writeJson(path.join(runRoot, 'inputs', 'source', 'manifest.json'), sourceSnapshot)
    const current = (await companionSnapshot({ dataRoot, runId })).current
    assert.equal(current.source_snapshot.status, 'frozen')
    assert.equal(current.source_snapshot.file_count, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('reads source-first progress, frozen inputs, revisions, and raw Agent records with explicit record counts', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'source-first-reader-')))
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
    assert.equal(current.counts.risks, 0)
    assert.equal(current.counts.test_cases, 0)
    assert.equal(current.source_first_records[0].records[0].body.original, 'Agent prose')
    assert.deepEqual(current.source_first_records[0].records[0].evidence, ['repo:src/main.c:1-3'])
    assert.equal(current.source_first_records[0].revision, 3)
    assert.equal(current.first_finish_revisions[`${runId}:analysis:unit-1`], 3)
    assert.equal(current.accepted_revisions[`${runId}:analysis:unit-1`], 3)
    assert.equal(current.workflow.actions[0].first_finish_revision, 3)
    assert.equal(current.workflow.actions[0].accepted_revision, 3)
    const originalResult = JSON.parse(await readFile(resultPath, 'utf8'))
    await writeJson(resultPath, { ...originalResult, binding: { ...originalResult.binding, task_id: 'another-task' } })
    const mismatched = (await companionSnapshot({ dataRoot, runId })).current
    assert.equal(mismatched.reader_health.trusted, false)
    assert.equal(mismatched.source_first_records[0].records.length, 0)
    await writeJson(resultPath, { ...originalResult, revision: 4 })
    assert.equal((await companionSnapshot({ dataRoot, runId })).current.reader_health.trusted, false)
    const progressPath = path.join(runRoot, 'progress.json')
    const finishedProgress = JSON.parse(await readFile(progressPath, 'utf8'))
    const actionId = `${runId}:analysis:unit-1`
    const waitingProgress = { ...finishedProgress, lifecycle_status: 'running', stage: 'reviewing',
      accepted_revisions: {}, actions: { [actionId]: { ...finishedProgress.actions[actionId],
        action: 'continue_agent', stage: 'comparison_review', status: 'pending' } } }
    const shell = { ...originalResult, revision: 0, records: [],
      binding: { ...originalResult.binding, task_id: 'pending' },
      completion: { complete: false, note: '', declared_revision: 0 } }
    await writeJson(progressPath, waitingProgress)
    await writeJson(resultPath, shell)
    const preparing = (await companionSnapshot({ dataRoot, runId })).current
    assert.equal(preparing.reader_health.trusted, true)
    assert.deepEqual(preparing.reader_notices, ['复核准备中，正在绑定复核任务。'])
    assert.equal(preparing.source_first_records[0].records.length, 0)
    await writeJson(resultPath, { ...shell, completion: null })
    const unsubmitted = (await companionSnapshot({ dataRoot, runId })).current
    assert.equal(unsubmitted.reader_health.trusted, true)
    assert.deepEqual(unsubmitted.reader_notices, ['复核准备中，正在绑定复核任务。'])
    // Real identity conflicts and published content cannot use the empty-shell exception.
    for (const invalid of [
      { ...shell, binding: { ...shell.binding, task_id: 'wrong-task' } },
      { ...shell, binding: { ...shell.binding, run_id: 'wrong-run' } },
      { ...shell, binding: { ...shell.binding, action_id: 'wrong-action' } },
      { ...shell, revision: 1 },
      { ...shell, records: originalResult.records },
      { ...shell, completion: { complete: true } },
      { ...shell, completion: undefined },
    ]) {
      await writeJson(resultPath, invalid)
      assert.equal((await companionSnapshot({ dataRoot, runId })).current.reader_health.trusted, false)
    }
    await writeJson(resultPath, shell)
    await writeJson(progressPath, finishedProgress)
    assert.equal((await companionSnapshot({ dataRoot, runId })).current.reader_health.trusted, false)
    await writeJson(resultPath, originalResult)
    const bound = (await companionSnapshot({ dataRoot, runId })).current
    assert.equal(bound.reader_health.trusted, true)
    assert.deepEqual(bound.reader_notices, [])
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
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'source-first-reader-symlink-')))
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
