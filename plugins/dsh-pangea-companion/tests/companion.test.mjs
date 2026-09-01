import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { apply, companionSnapshot, createRuntimeMonitor, sessionFailure } from '../src/index.js'
import { discoverPangeaDataRoot, summarizeRun } from '../src/reader.js'
import { parseEvidenceLocation, readEvidenceSnippet, resolveEvidenceFile } from '../src/source.js'

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function evidence(chunkId, location, observation) { return { chunk_id: chunkId, location, observation } }

test('reads the structured terminal model failure from session history', () => {
  assert.deepEqual(sessionFailure({ events: [{ event: {
    type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'MISSING_CREDENTIAL', message: 'credential not configured' } } },
  } }] }), { code: 'MISSING_CREDENTIAL', message: 'credential not configured' })
})

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-companion-'))
  const dataRoot = path.join(root, 'pangea-data')
  const runDirectory = path.join(dataRoot, 'runs', 'run-01')
  await mkdir(runDirectory, { recursive: true })
  await writeJson(path.join(runDirectory, 'progress.json'), {
    schema_version: '1.0', run_id: 'run-01', contract_digest: 'a'.repeat(64), phase: 'WAITING_REVIEW',
    analysis_units: ['u1', 'u2'], completed_analysis_units: ['u1', 'u2'], completed_rework_units: ['u1'],
    quality_status: null, errors: [], error_history: [],
  })
  await writeJson(path.join(runDirectory, 'agent-results', 'analysis', 'u1.json'), {
    unit_id: 'u1', attempt: 0,
    risks: [{ risk_id: 'R-old', title: 'old', evidence: [evidence('old', 'old.c:1', 'old')] }],
    test_cases: [{ test_case_id: 'TC-old', title: 'old', linked_risk_ids: ['R-old'] }],
    evidence: [evidence('old', 'old.c:1', 'old')], business_flows: [],
  })
  const sharedEvidence = evidence('e-shared', 'auth.c:10-20', '认证失败后状态未清理')
  await writeJson(path.join(runDirectory, 'agent-results', 'rework', 'u1.json'), {
    unit_id: 'u1', attempt: 1,
    risks: [{
      risk_id: 'R-001', title: '认证状态残留', dfx: ['功能与状态'], severity: 'High', confidence: 'high',
      trigger: '认证中断', system_result: '状态未清理', external_observation: '重连失败', exclusion_condition: '完整断电后不适用',
      upstream_semantics: { reachability: '可达', caller_constraints: '无', documented_behavior: '应清理', existing_tests: '无', conclusion: 'risk_remains' },
      translation_status: 'Blackbox-ready', status: 'accepted', evidence: [sharedEvidence],
    }],
    test_cases: [{
      test_case_id: 'TC-001', title: '认证中断后重连', case_type: '异常恢复', linked_risk_ids: ['R-001'],
      preconditions: ['已建立连接'], steps: ['中断认证', '重新连接'], expected_results: ['连接成功'], observability: ['抓包'], cleanup: ['断开连接'], status: 'draft',
    }],
    evidence: [sharedEvidence],
    business_flows: [{ title: '认证流程', description: '认证', steps: ['connect'], evidence: [sharedEvidence] }],
  })
  const secondEvidence = evidence('e2', 'tcp.c:30-40', '超时路径返回错误')
  await writeJson(path.join(runDirectory, 'agent-results', 'analysis', 'u2.json'), {
    unit_id: 'u2', attempt: 0,
    risks: [{ risk_id: 'R-002', title: '超时恢复', severity: 'Medium', evidence: [secondEvidence] }],
    test_cases: [{ test_case_id: 'TC-002', title: '超时恢复', linked_risk_ids: ['R-002'] }],
    evidence: [secondEvidence], business_flows: [],
  })
  await writeJson(path.join(runDirectory, 'agent-results', 'review.json'), {
    status: 'REWORK', reviewer_id: 'reviewer-1', summary: '需要补充一处证据',
    issues: [{ issue_id: 'I-001', unit_id: 'u2', reason: '证据不足', required_change: '补充调用方约束' }],
  })
  return { root, dataRoot }
}

async function finalizedFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-final-state-'))
  const dataRoot = path.join(root, 'pangea-data')
  const runDirectory = path.join(dataRoot, 'runs', 'run-final')
  await mkdir(runDirectory, { recursive: true })
  await writeJson(path.join(runDirectory, 'progress.json'), {
    schema_version: '1.0', run_id: 'run-final', contract_digest: 'b'.repeat(64), phase: 'INCOMPLETE',
    analysis_units: ['u-final'], completed_analysis_units: [], completed_rework_units: [],
    quality_status: 'UNRESOLVED', errors: [], error_history: [],
  })
  const finalEvidence = evidence('e-final', 'final.c:50-80', '最终聚合证据')
  await writeJson(path.join(runDirectory, 'final-state.json'), {
    run_id: 'run-final', phase: 'INCOMPLETE', run_status: 'INCOMPLETE',
    analysis_units: [{ unit_id: 'u-final', title: '最终单元' }],
    risks: [{ risk_id: 'R-FINAL', title: '报告中的风险', severity: 'High', evidence: [finalEvidence] }],
    test_cases: [{ test_case_id: 'TC-FINAL', title: '报告中的用例', linked_risk_ids: ['R-FINAL'] }],
    business_flows: [{ title: '最终流程', steps: ['step'], evidence: [finalEvidence] }],
    quality_report: { status: 'UNRESOLVED', checks: [], unresolved: [{ kind: 'example' }] },
    errors: [],
  })
  await writeFile(path.join(runDirectory, 'report.md'), '# 已生成报告\n\n形成 1 条业务流程、1 个风险、1 个测试用例。\n', 'utf8')
  return { root, dataRoot, runDirectory }
}

async function inconsistentFinalizedFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-inconsistent-'))
  const dataRoot = path.join(root, 'pangea-data')
  const runDirectory = path.join(dataRoot, 'runs', 'run-bad')
  await mkdir(runDirectory, { recursive: true })
  await writeJson(path.join(runDirectory, 'progress.json'), {
    schema_version: '1.0', run_id: 'run-bad', contract_digest: 'c'.repeat(64), phase: 'INCOMPLETE',
    analysis_units: ['u-bad'], completed_analysis_units: [], completed_rework_units: [],
    quality_status: 'UNRESOLVED', errors: [], error_history: [],
  })
  await writeJson(path.join(runDirectory, 'final-state.json'), {
    run_id: 'run-bad', phase: 'INCOMPLETE', run_status: 'INCOMPLETE', analysis_units: [{ unit_id: 'u-bad' }],
    risks: [], test_cases: [], business_flows: [], quality_report: { status: 'UNRESOLVED', checks: [], unresolved: [] }, errors: [],
  })
  await writeFile(path.join(runDirectory, 'report.md'), '# 历史报告\n\n形成 1 条业务流程、2 个风险、3 个测试用例。\n', 'utf8')
  return { root }
}

async function legacyReportFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-legacy-'))
  const dataRoot = path.join(root, 'pangea-data')
  const runDirectory = path.join(dataRoot, 'runs', 'run-legacy')
  await mkdir(runDirectory, { recursive: true })
  await writeJson(path.join(runDirectory, 'progress.json'), {
    schema_version: '1.0', run_id: 'run-legacy', contract_digest: 'd'.repeat(64), phase: 'INCOMPLETE',
    analysis_units: ['u1'], completed_analysis_units: ['u1'], completed_rework_units: [],
    quality_status: 'UNRESOLVED', errors: [], error_history: [],
  })
  const legacyEvidence = evidence('legacy-e', 'legacy.c:1-9', '旧 Run 证据')
  await writeJson(path.join(runDirectory, 'agent-results', 'analysis', 'u1.json'), {
    unit_id: 'u1', attempt: 0,
    risks: [{ risk_id: 'R-LEGACY', title: '旧风险', evidence: [legacyEvidence] }],
    test_cases: [{ test_case_id: 'TC-LEGACY', title: '旧用例', linked_risk_ids: ['R-LEGACY'] }],
    evidence: [legacyEvidence], business_flows: [{ title: '旧流程', steps: ['step'], evidence: [legacyEvidence] }],
  })
  await writeFile(path.join(runDirectory, 'report.md'), '# 旧版报告\n\n形成 1 条业务流程、1 个风险、1 个测试用例。\n', 'utf8')
  return { root }
}

async function htmlFallbackFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-html-fallback-'))
  const dataRoot = path.join(root, 'pangea-data')
  const runDirectory = path.join(dataRoot, 'runs', 'run-html')
  await mkdir(runDirectory, { recursive: true })
  await writeJson(path.join(runDirectory, 'progress.json'), {
    run_id: 'run-html', phase: 'COMPLETE', analysis_units: ['u-html'], completed_analysis_units: [],
    completed_rework_units: [], quality_status: 'PASS', errors: [], error_history: [],
  })
  const finalEvidence = evidence('e-html', 'html.c:1-5', 'HTML 报告证据')
  await writeJson(path.join(runDirectory, 'final-state.json'), {
    run_id: 'run-html', phase: 'COMPLETE', analysis_units: [{ unit_id: 'u-html' }],
    risks: [{ risk_id: 'R-HTML', evidence: [finalEvidence] }],
    test_cases: [{ test_case_id: 'TC-HTML', linked_risk_ids: ['R-HTML'] }],
    business_flows: [{ title: 'HTML 流程', evidence: [finalEvidence] }],
    quality_report: { status: 'PASS' }, errors: [],
  })
  await writeFile(path.join(runDirectory, 'report.md'), '# 报告\n\n摘要格式暂不可识别。\n', 'utf8')
  await writeFile(path.join(runDirectory, 'report.html'), '<main>形成 <strong>1 条业务流程、1 个风险、1 个测试用例</strong>。</main>', 'utf8')
  return { root, dataRoot }
}

test('discovers pangea-data from workspace root', async () => {
  const { root, dataRoot } = await fixture()
  try { assert.equal(await discoverPangeaDataRoot({ cwd: root }), dataRoot) }
  finally { await rm(root, { recursive: true, force: true }) }
})

test('reads the current lifecycle stage and action concurrency from v3 progress', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-v3-'))
  const dataRoot = path.join(root, 'pangea-data')
  const runDirectory = path.join(dataRoot, 'runs', 'run-v3')
  try {
    await writeJson(path.join(runDirectory, 'progress.json'), {
      schema_version: '3.0', run_id: 'run-v3', lifecycle_status: 'running', stage: 'analyzing',
      analysis_units: [{ unit_id: 'U00' }, { unit_id: 'U01' }, { unit_id: 'U02' }],
      completed_analysis_units: ['U00'], completed_closure_units: [], quality_status: null,
      actions: {
        a0: { role: 'analysis', status: 'accepted' },
        a1: { role: 'analysis', status: 'dispatched' },
        a2: { role: 'analysis', status: 'pending' },
      },
      errors: [],
    })
    const summary = await summarizeRun(dataRoot, 'run-v3')
    assert.equal(summary.phase, 'ANALYZING')
    assert.deepEqual(summary.analysis, {
      total: 3, completed: 1, reworked: 0, running: 1, pending: 1, submitted: 1, max_parallel: 8,
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('projects a failed Worker action as attention-required and terminal', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-attention-'))
  const dataRoot = path.join(root, 'pangea-data')
  const runDirectory = path.join(dataRoot, 'runs', 'run-attention')
  try {
    await writeJson(path.join(runDirectory, 'progress.json'), {
      schema_version: '3.0', run_id: 'run-attention', lifecycle_status: 'running', stage: 'planning',
      analysis_units: [], completed_analysis_units: [], completed_closure_units: [], quality_status: null,
      actions: {
        planning: {
          action_id: 'run-attention:planning', role: 'planning', status: 'failed',
          error: { code: 'MISSING_CREDENTIAL', message: 'credential not configured' },
        },
      },
      errors: [],
    })
    const summary = await summarizeRun(dataRoot, 'run-attention')
    assert.equal(summary.phase, 'INCOMPLETE')
    assert.equal(summary.terminal, true)
    assert.equal(summary.attention_required, true)
    assert.equal(summary.lifecycle_status, 'attention_required')
    assert.deepEqual(summary.errors[0], {
      action_id: 'run-attention:planning', role: 'planning', code: 'MISSING_CREDENTIAL', message: 'credential not configured',
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('reads line-aware source snippets from workspace and repository evidence locations', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-source-'))
  const dataRoot = path.join(root, 'pangea-data')
  try {
    await mkdir(path.join(dataRoot, 'repositories', 'repo-one', 'src'), { recursive: true })
    await writeFile(path.join(dataRoot, 'repositories', 'repo-one', 'src', 'auth.c'), Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join('\n'), 'utf8')
    await writeFile(path.join(root, 'local.c'), 'alpha\nbeta\ngamma\n', 'utf8')

    assert.deepEqual(parseEvidenceLocation('repo-one:src/auth.c:5-7'), { source: 'repo-one:src/auth.c', startLine: 5, endLine: 7 })
    assert.deepEqual(parseEvidenceLocation('local.c#L2-L3'), { source: 'local.c', startLine: 2, endLine: 3 })
    assert.equal(resolveEvidenceFile({ cwd: root, dataRoot, location: 'repo-one:src/auth.c:5-7' }).filePath, path.join(dataRoot, 'repositories', 'repo-one', 'src', 'auth.c'))

    const snippet = await readEvidenceSnippet({ cwd: root, dataRoot, location: 'repo-one:src/auth.c:5-7' })
    assert.equal(snippet.target_start, 5)
    assert.equal(snippet.target_end, 7)
    assert.equal(snippet.visible_start, 2)
    assert.equal(snippet.visible_end, 10)
    assert.deepEqual(snippet.lines.filter(line => line.target).map(line => line.number), [5, 6, 7])
    assert.equal(snippet.lines.find(line => line.number === 6).text, 'line 6')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('returns current-run details and cross-links without double-counting replaced rework results', async () => {
  const { root } = await fixture()
  try {
    const snapshot = await companionSnapshot({ cwd: root })
    const run = snapshot.current
    assert.equal(run.run_id, 'run-01')
    assert.equal(run.data_source, 'worker-results')
    assert.equal(run.reader_health.status, 'ok')
    assert.equal(run.reader_health.trusted, true)
    assert.deepEqual(run.analysis, {
      total: 2, completed: 2, reworked: 1,
      running: 0, pending: 0, submitted: 0, max_parallel: 8,
    })
    assert.deepEqual(run.details.risks.map(item => item.risk_id), ['R-001', 'R-002'])
    assert.deepEqual(run.details.test_cases.map(item => item.test_case_id), ['TC-001', 'TC-002'])
    assert.deepEqual(run.details.risks[0].linked_test_case_ids, ['TC-001'])
    assert.equal(run.details.evidence.length, 2)
    assert.deepEqual(run.details.evidence[0].risk_ids, ['R-001'])
    assert.equal(run.details.review_issues[0].required_change, '补充调用方约束')
    assert.equal(run.workflow.units[0].status, 'reworked')
    assert.equal(run.workflow.units[1].status, 'completed')
    assert.ok(!run.details.risks.some(item => item.risk_id === 'R-old'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('uses comparison review and final state to hide dismissed independent findings', async () => {
  const { root, dataRoot } = await fixture()
  try {
    const runDirectory = path.join(dataRoot, 'runs', 'run-01')
    await writeJson(path.join(runDirectory, 'agent-results', 'review.json'), {
      status: 'REWORK', summary: '独立复核发现一个问题',
      findings: [{ finding_key: 'F-001', affected_unit_ids: ['u2'], summary: '看起来缺证据', required_change: '补证据' }],
    })
    await writeJson(path.join(runDirectory, 'agent-results', 'comparison-review.json'), {
      summary: '对照后确认属于误报',
      independent_finding_decisions: [{ finding_key: 'F-001', disposition: 'dismissed', conclusion: '现有证据已经覆盖' }],
      findings: [],
    })
    await writeJson(path.join(runDirectory, 'final-state.json'), { review_findings: [] })

    const run = (await companionSnapshot({ cwd: root, runId: 'run-01' })).current
    assert.equal(run.review.counts.independent, 1)
    assert.equal(run.review.counts.dismissed, 1)
    assert.equal(run.review.counts.effective, 0)
    assert.deepEqual(run.details.review_issues, [])
    assert.equal(run.review.comparison.decisions[0].conclusion, '现有证据已经覆盖')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('finalized report reads final-state and verifies report counts', async () => {
  const { root, runDirectory } = await finalizedFixture()
  try {
    const snapshot = await companionSnapshot({ cwd: root, runId: 'run-final' })
    const run = snapshot.current
    assert.equal(run.phase, 'INCOMPLETE')
    assert.equal(run.data_source, 'final-state')
    assert.equal(run.reader_health.status, 'ok')
    assert.equal(run.reader_health.trusted, true)
    assert.equal(run.reader_health.count_checks.risks.status, 'match')
    assert.equal(run.reader_health.count_checks.test_cases.status, 'match')
    assert.equal(run.reader_health.count_checks.business_flows.status, 'match')
    assert.deepEqual(run.analysis, {
      total: 1, completed: 1, reworked: 0,
      running: 0, pending: 0, submitted: 0, max_parallel: 8,
    })
    assert.deepEqual(run.details.risks.map(item => item.risk_id), ['R-FINAL'])
    assert.deepEqual(run.details.test_cases.map(item => item.test_case_id), ['TC-FINAL'])
    assert.deepEqual(run.details.risks[0].linked_test_case_ids, ['TC-FINAL'])
    assert.equal(run.details.evidence.length, 1)
    assert.deepEqual(run.counts, { risks: 1, test_cases: 1, evidence: 1, business_flows: 1, review_issues: 0 })
    assert.equal(run.artifacts.final_state, path.join(runDirectory, 'final-state.json'))
    assert.deepEqual(run.reader_warnings, [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('report and structured count mismatch is fail-loud and marks zero as untrusted', async () => {
  const { root } = await inconsistentFinalizedFixture()
  try {
    const run = (await companionSnapshot({ cwd: root, runId: 'run-bad' })).current
    assert.equal(run.data_source, 'final-state')
    assert.equal(run.counts.risks, 0)
    assert.equal(run.counts.test_cases, 0)
    assert.equal(run.reader_health.status, 'error')
    assert.equal(run.reader_health.trusted, false)
    assert.deepEqual(run.reader_health.count_checks.risks, { structured: 0, report: 2, status: 'mismatch' })
    assert.deepEqual(run.reader_health.count_checks.test_cases, { structured: 0, report: 3, status: 'mismatch' })
    assert.match(run.reader_health.issues.join('\n'), /风险计数不一致/)
    assert.match(run.reader_health.issues.join('\n'), /测试用例计数不一致/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('legacy report can use worker-result fallback when report counts agree', async () => {
  const { root } = await legacyReportFixture()
  try {
    const run = (await companionSnapshot({ cwd: root, runId: 'run-legacy' })).current
    assert.equal(run.data_source, 'worker-results')
    assert.equal(run.reader_health.status, 'warning')
    assert.equal(run.reader_health.trusted, true)
    assert.equal(run.reader_health.count_checks.risks.status, 'match')
    assert.equal(run.reader_health.count_checks.test_cases.status, 'match')
    assert.match(run.reader_health.issues.join('\n'), /兼容回退/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('falls back to report.html when report.md has no parseable counts', async () => {
  const { root } = await htmlFallbackFixture()
  try {
    const run = (await companionSnapshot({ cwd: root, runId: 'run-html' })).current
    assert.equal(run.reader_health.status, 'ok')
    assert.equal(run.reader_health.trusted, true)
    assert.match(run.reader_health.report_path, /report\.html$/)
    assert.equal(run.reader_health.count_checks.risks.status, 'match')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('recent run summaries stay compact while current run carries details', async () => {
  const { root } = await fixture()
  try {
    const snapshot = await companionSnapshot({ cwd: root })
    assert.ok(snapshot.current.details)
    assert.equal(snapshot.runs[0].details, undefined)
    assert.deepEqual(snapshot.runs[0].counts, { risks: null, test_cases: null, evidence: null, business_flows: null, review_issues: null })
    assert.equal(snapshot.runs[0].reader_health.report_checked, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('lists executor runs separately from the analysis run', async () => {
  const { root, dataRoot } = await fixture()
  try {
    const runDirectory = path.join(dataRoot, 'executor-runs', 'executor-01')
    await writeJson(path.join(runDirectory, 'progress.json'), {
      schema_version: '1.0', workflow_version: 1, executor_run_id: 'executor-01',
      analysis_run_id: 'run-01', phase: 'COMPLETE', selected_test_case_ids: ['TC-1'],
      automation_id: 'storage-tests', environment_id: 'lab-a', result_status: 'PASS',
      errors: [], agent_session: { stage: 'execution', status: 'completed', task_id: 'agent-1' },
    })
    await writeJson(path.join(runDirectory, 'agent-results', 'execution.json'), {
      status: 'PASS', cases: [{ test_case_id: 'TC-1', status: 'PASS' }],
    })
    const snapshot = await companionSnapshot({ cwd: root })
    assert.equal(snapshot.executor_runs.length, 1)
    assert.equal(snapshot.executor_runs[0].executor_run_id, 'executor-01')
    assert.equal(snapshot.executor_runs[0].result_status, 'PASS')
    assert.equal(snapshot.current.run_id, 'run-01')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('summary mode does not materialize worker details', async () => {
  const { root, dataRoot } = await fixture()
  try {
    const run = await summarizeRun(dataRoot, 'run-01')
    assert.equal(run.details, undefined)
    assert.equal(run.counts.risks, null)
    assert.equal(run.review, null)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('registers read status plus executor environment and SSH tools', () => {
  const tools = []
  const routes = []
  const effects = []
  apply({
    agents: { roots() { return [] } },
    on() { return () => {} },
    apiProxy: {},
    tools: { register(tool) { tools.push(tool); return () => {} } },
    webServer: { register(route) { routes.push(route); return () => {} } },
    effect(callback) { effects.push(callback) },
  })
  assert.deepEqual(tools.map(tool => tool.name), [
    'pangea_run_create', 'pangea_action_bind', 'pangea_action_validate', 'pangea_action_settle',
    'pangea_status', 'pangea_environment_get', 'pangea_ssh_exec',
    'pangea_ssh_start', 'pangea_ssh_read', 'pangea_ssh_stop', 'pangea_ssh_interactive',
  ])
  assert.match(tools[0].description, /不要读取 PANGEA CLI 源码/)
  assert.match(tools[0].description, /target 必须逐字复制/)
  assert.match(tools[0].parameters.properties.target.description, /不翻译、不重排、不自行缩写/)
  assert.equal(tools[2].isConcurrencySafe(), false)
  assert.equal(tools[3].isConcurrencySafe(), false)
  assert.deepEqual(tools[4].parameters.required, ['run_id'])
  assert.equal(tools[4].parameters.properties.run_id.minLength, 1)
  assert.deepEqual(routes.map(route => route.path), [
    '/api/pangea-companion/state', '/api/pangea-companion/source',
    '/api/pangea-companion/launch-log',
    '/api/pangea-companion/environments', '/api/pangea-companion/executions',
    '/api/pangea-companion/workbench',
    '/api/pangea-companion/repositories',
  ])
  assert.equal(effects.length, 1)
})

test('runtime monitor keeps only minimal DSH-to-PANGEA run association', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-monitor-'))
  const storePath = path.join(root, 'monitor.json')
  let clock = 1_700_000_000_000
  const listeners = new Map()
  const channel = map => ({
    on(name, callback) {
      const values = map.get(name) ?? []
      values.push(callback)
      map.set(name, values)
      return () => map.set(name, (map.get(name) ?? []).filter(value => value !== callback))
    },
  })
  const agent = {
    id: 'session-monitor-1', status: 'idle',
    session: {
      header: { id: 'session-monitor-1', cwd: '/tmp/pangea', createdAt: clock },
      events: [{ type: 'tool/call', time: clock - 100, data: { callId: 'secret-call', name: 'must_not_persist' } }],
    },
    ctx: channel(new Map()),
  }
  const ctx = { ...channel(listeners), agents: { roots: () => [agent] } }
  const emit = (map, name, ...args) => { for (const callback of map.get(name) ?? []) callback(...args) }
  const monitor = createRuntimeMonitor({ storePath, now: () => clock })
  const dispose = monitor.start(ctx)

  try {
    await monitor.bindRun(agent.id, { run_id: 'run-monitor-1', phase: 'WAITING_ANALYSIS', analysis: { completed: 0, total: 2, reworked: 0 } })
    const first = await monitor.snapshot({ sessionId: agent.id, runId: 'run-monitor-1' })
    assert.equal(first.session.bound_run_id, 'run-monitor-1')
    assert.equal(first.run.pangea_phase, 'WAITING_ANALYSIS')
    assert.deepEqual(first.run.pangea_progress, { completed: 0, total: 2, reworked: 0 })
    assert.equal('active_tools' in first.session, false)
    assert.equal('active_subagents' in first.session, false)
    assert.equal('timeline' in first.run, false)

    const firstSeen = first.run.last_seen
    clock += 500
    await monitor.bindRun(agent.id, { run_id: 'run-monitor-1', phase: 'WAITING_ANALYSIS', analysis: { completed: 0, total: 2, reworked: 0 } })
    assert.equal((await monitor.snapshot({ sessionId: agent.id, runId: 'run-monitor-1' })).run.last_seen, firstSeen)

    clock += 500
    await monitor.bindRun(agent.id, { run_id: 'run-monitor-1', phase: 'WAITING_REVIEW', analysis: { completed: 2, total: 2, reworked: 0 } })
    const progressed = await monitor.snapshot({ sessionId: agent.id, runId: 'run-monitor-1' })
    assert.equal(progressed.run.pangea_phase, 'WAITING_REVIEW')
    assert.deepEqual(progressed.run.pangea_progress, { completed: 2, total: 2, reworked: 0 })
    assert.ok(progressed.run.last_seen > firstSeen)

    clock += 1_000
    emit(listeners, 'agent/disposed', { agent })
    await new Promise(resolve => setImmediate(resolve))
    await monitor.flush()

    const raw = await readFile(storePath, 'utf8')
    assert.doesNotMatch(raw, /must_not_persist|secret-call|timeline|active_tools|active_subagents/)

    const restored = createRuntimeMonitor({ storePath, now: () => clock })
    const historical = await restored.snapshot({ runId: 'run-monitor-1' })
    assert.equal(historical.session, null)
    assert.equal(historical.run.run_id, 'run-monitor-1')
    assert.equal(historical.run.session_live, false)
    assert.equal(historical.run.pangea_phase, 'WAITING_REVIEW')
  } finally {
    await dispose()
    await rm(root, { recursive: true, force: true })
  }
})
