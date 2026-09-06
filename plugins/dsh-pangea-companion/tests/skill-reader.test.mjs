import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
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
    assert.equal(snapshot.current.publication.state, 'pending')
    assert.equal(snapshot.current.reader_health.status, 'pending')
    assert.deepEqual(snapshot.current.workflow.unresolved, [])
    assert.deepEqual(snapshot.current.reader_warnings, [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('exposes step timing evidence without treating it as a quality verdict', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codetalks-reader-performance-'))
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
  const root = await mkdtemp(path.join(os.tmpdir(), 'codetalks-reader-missing-final-'))
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
  const root = await mkdtemp(path.join(os.tmpdir(), 'codetalks-reader-step09-publish-'))
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
  const root = await mkdtemp(path.join(os.tmpdir(), 'codetalks-reader-resumed-step09-'))
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
  const root = await mkdtemp(path.join(os.tmpdir(), 'codetalks-reader-live-draft-'))
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

test('enriches a final workbench projection with live risk, evidence, and test case details', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codetalks-reader-final-details-'))
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

    const current = (await companionSnapshot({ dataRoot, runId })).current
    assert.equal(current.publication.state, 'final')
    assert.equal(current.reader_health.trusted, true)
    assert.equal(current.details.risks[0].severity, 'High')
    assert.equal(current.details.risks[0].trigger, '端口被占用')
    assert.equal(current.details.risks[0].system_result, '连接为空但继续执行')
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
  const root = await mkdtemp(path.join(os.tmpdir(), 'codetalks-reader-draft-publication-'))
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
  const root = await mkdtemp(path.join(os.tmpdir(), 'codetalks-reader-malformed-'))
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
  const root = await mkdtemp(path.join(os.tmpdir(), 'codetalks-reader-broken-'))
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
