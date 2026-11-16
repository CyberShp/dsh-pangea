import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { classifyRiskGrounding, summarizeIncrementalInputs } from '../src/risk-and-incremental-insights.js'
import { caseCoverageBasisProjection, caseFeasibilityProjection, caseFeasibilitySummary } from '../src/case-evidence.js'
import { currentResultWarnings } from '../src/result-warning-projection.js'
import { sourceFirstProjection } from '../src/source-first-projection.js'
import { summarizeRun } from '../src/reader.js'

test('classifyRiskGrounding separates anchored risks, reachability hypotheses, and unanchored/mismatched records', () => {
  const anchored = classifyRiskGrounding({
    trigger: '对端在握手阶段主动断开 TCP 连接',
    evidence: [{ location: 'storage:tls/handshake.c:42-58' }],
    upstream_semantics: { reachability: '外部客户端连接可直接触发' },
  })
  assert.equal(anchored.tier, 'anchored')
  assert.equal(anchored.label, '依据齐备')

  const hypothesis = classifyRiskGrounding({
    trigger: '内部上下文指针为空',
    evidence: [{ location: 'storage:tls/handshake.c:90-95' }],
    upstream_semantics: { reachability: '待核对' },
    linked_test_case_ids: [],
  })
  assert.equal(hypothesis.tier, 'hypothesis')
  assert.equal(hypothesis.label, '可达性待核对')

  const missingEvidence = classifyRiskGrounding({
    trigger: '内存分配失败',
    evidence: [],
  })
  assert.equal(missingEvidence.tier, 'unanchored')
  assert.equal(missingEvidence.label, '缺少源码坐标')

  const mismatched = classifyRiskGrounding({
    trigger: '对端发送超长报文',
    evidence: [{ location: 'storage:tls/handshake.c:999-1020' }],
    upstream_semantics: { reachability: '公开端口可达' },
    record_warnings: [{ kind: 'source_fact_hint', field: 'body.source_evidence[0]', message: '行号越界；冻结文件共 120 行' }],
  })
  assert.equal(mismatched.tier, 'unanchored')
  assert.equal(mismatched.label, '证据失配待核')
  assert.match(mismatched.reason, /行号越界/)
})

test('sourceFirstProjection attaches active record warnings and retires superseded source_fact_hint warnings', () => {
  const binding = { data_root: '/data', run_id: 'run-1', action_id: 'act-1', task_id: 'task-1' }
  const runtimeResult = {
    format_version: 'pangea-notes-v1',
    binding,
    revision: 2,
    records: [
      { record_id: 'r-old', kind: 'risk', created_revision: 1, supersedes: [], body: { risk_id: 'R-1', title: '旧风险', trigger: 't', source_evidence: ['repo:a.c:999-1000'] } },
      { record_id: 'r-new', kind: 'risk', created_revision: 2, supersedes: ['r-old'], body: { risk_id: 'R-1', title: '修正后风险', trigger: 't', source_evidence: ['repo:a.c:10-20'] } },
      { record_id: 'r-warn', kind: 'risk', created_revision: 2, supersedes: [], body: { risk_id: 'R-2', title: '失配风险', trigger: 't', source_evidence: ['repo:a.c:800-810'] } },
    ],
    warnings: [
      { ...binding, kind: 'source_fact_hint', record_id: 'r-old', record_revision: 1, field: 'body.source_evidence[0]', message: '旧行号越界' },
      { ...binding, kind: 'evidence_quote_mismatch', record_id: 'r-warn', record_revision: 2, field: 'body.evidence_quotes[0]', message: '引文与冻结源码不一致' },
    ],
  }
  const activeWarnings = currentResultWarnings(runtimeResult)
  assert.equal(activeWarnings.length, 1)
  assert.equal(activeWarnings[0].record_id, 'r-warn')

  const projected = sourceFirstProjection([{
    action_id: 'act-1',
    task_id: 'task-1',
    stage: 'unit_analysis',
    status: 'accepted',
    revision: 2,
    task: { unit_id: 'unit-a', record_contracts: {} },
    runtime_result: runtimeResult,
    records: runtimeResult.records,
    current_warnings: activeWarnings,
  }])
  assert.equal(projected.risks.length, 2)
  const r1 = projected.risks.find(item => item.display_id === 'R-1')
  const r2 = projected.risks.find(item => item.display_id === 'R-2')
  assert.equal(r1.record_warnings, undefined)
  assert.equal(r2.record_warnings?.length, 1)
  assert.equal(classifyRiskGrounding(r2).tier, 'unanchored')
})

test('summarizeRun projects incremental SHA256 change summary and ignores symlink escapes', async t => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'inc-reader-'))
  t.after(() => rm(dataRoot, { recursive: true, force: true }))

  const runDir = path.join(dataRoot, 'runs', 'run-inc-1')
  const incDir = path.join(runDir, 'inputs', 'incremental')
  await mkdir(incDir, { recursive: true })

  await writeFile(path.join(runDir, 'progress.json'), JSON.stringify({
    run_id: 'run-inc-1',
    workflow_version: 'source-first-v1',
    lifecycle_status: 'complete',
    stage: 'complete',
    actions: {},
  }))
  await writeFile(path.join(runDir, 'inputs', 'task-contract.json'), JSON.stringify({
    workflow_version: 'source-first-v1',
    repository: 'storage',
    target: 'TLS 增量验证',
  }))
  await writeFile(path.join(runDir, 'inputs', 'source-first-plan.json'), JSON.stringify({
    format_version: 'pangea-plan-v1',
    units: [{ unit_id: 'unit-tls', title: 'TLS' }],
    unresolved: [],
  }))
  await writeFile(path.join(incDir, 'request.json'), JSON.stringify({
    parent_run_id: 'run-parent-0',
    mode: 'changed-files',
    instruction: '核对 handshake.c 超时恢复改动',
    selected_unit_ids: ['unit-tls'],
    selected_records: [{ action_id: 'a1', record_id: 'rec1' }],
    changed_paths: ['storage:tls/handshake.c', 'storage:tls/cert.c'],
  }))
  await writeFile(path.join(incDir, 'baseline.json'), JSON.stringify({
    parent_run_id: 'run-parent-0',
    mode: 'changed-files',
    source_policy: 'current-working-tree',
    baseline_files: [
      { repo_id: 'storage', path: 'tls/handshake.c', sha256: '11111111aaaa' },
      { repo_id: 'storage', path: 'tls/cert.c', sha256: '22222222bbbb' },
    ],
  }))
  await writeFile(path.join(incDir, 'parent-plan.json'), JSON.stringify({
    units: [{ unit_id: 'unit-tls' }, { unit_id: 'unit-auth' }, { unit_id: 'unit-session' }],
  }))
  await writeFile(path.join(incDir, 'changes.json'), JSON.stringify({
    changed_files: [
      { repo_id: 'storage', path: 'tls/handshake.c', status: 'modified', before_sha256: '11111111aaaa', after_sha256: '99999999cccc' },
      { repo_id: 'storage', path: 'tls/cert.c', status: 'unchanged', before_sha256: '22222222bbbb', after_sha256: '22222222bbbb' },
    ],
    rules_changed: false,
    note: '字节变化只描述用户指定文件。',
  }))

  const summary = await summarizeRun(dataRoot, 'run-inc-1')
  assert.ok(summary.incremental_summary)
  assert.equal(summary.incremental_summary.parent_run_id, 'run-parent-0')
  assert.equal(summary.incremental_summary.parent_unit_count, 3)
  assert.deepEqual(summary.incremental_summary.selected_unit_ids, ['unit-tls'])
  assert.equal(summary.incremental_summary.rules_changed, false)
  assert.deepEqual(summary.incremental_summary.counts, { declared: 2, modified: 1, unchanged: 1, missing: 0 })
  assert.equal(summary.incremental_summary.changed_files[0].before_short, '11111111')
  assert.equal(summary.incremental_summary.changed_files[0].after_short, '99999999')

  const outsideFile = path.join(dataRoot, 'outside-secret.json')
  await writeFile(outsideFile, JSON.stringify({ rules_changed: true, changed_files: [] }))
  await rm(path.join(incDir, 'changes.json'))
  await symlink(outsideFile, path.join(incDir, 'changes.json'))
  const escapedSummary = await summarizeRun(dataRoot, 'run-inc-1')
  assert.equal(escapedSummary.incremental_summary.rules_changed, null)
  assert.equal(escapedSummary.incremental_summary.changed_files.length, 0)
  assert.equal(summarizeIncrementalInputs({}), null)
})

test('case evidence and feasibility projections use actionable Chinese guidance instead of defensive legalese', () => {
  const basis = caseCoverageBasisProjection({ purpose: 'coverage', coverage_refs: ['GAP-1'] }, [{ coverage_id: 'GAP-1' }])
  const feasibility = caseFeasibilityProjection({ execution_readiness: 'needs_instrumentation' })
  const summary = caseFeasibilitySummary({ total_cases: 10, ready_cases: 6 })
  for (const text of [basis.disclaimer, feasibility.disclaimer, summary.disclaimer]) {
    assert.doesNotMatch(text, /不代表|不能据此/)
  }
  assert.match(basis.disclaimer, /目标覆盖缺口/)
  assert.match(feasibility.disclaimer, /环境或打桩条件/)
  assert.match(summary.disclaimer, /执行准备度分布/)
})
