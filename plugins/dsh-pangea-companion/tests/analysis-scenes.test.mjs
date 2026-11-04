import { writeSourceRepository } from './fixtures/source-repository.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { analysisOptions, SCENE_PROFILE } from '../src/analysis-scenes.js'
import { summarizeRun, readInputMaterials, sourceFirstStepRows } from '../src/reader.js'
import { buildTestCaseCsv, buildTestCaseXlsx } from '../src/export.js'
import { writeArchitectureRun } from './architecture-source-first-fixture.mjs'

const json = async (file, value) => writeFile(file, JSON.stringify(value))
async function fixture(t, scene) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'analysis-scenes-'))
  await writeSourceRepository(root, 'repo')
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, '.agents/pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents/pangea/dsh.md'), '# fixture')
  const f = await writeArchitectureRun(root)
  await json(path.join(f.run, 'inputs/task-contract.json'), { workflow_version: 'source-first-v1', analysis_profile: SCENE_PROFILE, target: 'TLS', repository: 'repo', analysis_settings: { scenario: scene, mode: 'speed' } })
  await json(path.join(f.run, 'inputs/analysis-scene.json'), { id: scene, label: scene, profile: SCENE_PROFILE, format_version: 'analysis-scene-v1', presentation: { risks: ['module-analysis', 'risk-analysis'].includes(scene) } })
  await json(path.join(f.run, 'inputs/coverage-match-summary.json'), { sources: [{ asset_id: 'cov', input_revision: 'original', status: 'partial' }], matched: [{ coverage_id: 'cov:GAP-1', file_path: 'tls.c', matches: [{ repo_id: 'repo', path: 'tls.c', line: 1 }] }], unmatched: [{ coverage_id: 'cov:REF-2', path: 'unknown.c' }], ambiguous: [] })
  await json(path.join(f.run, 'inputs/asset-snapshots.json'), [{ asset_id: 'cov', input_revision: 'original', metadata: { title: '冻结覆盖数据', asset_type: 'coverage' }, result: {} }])
  const result = JSON.parse(await readFile(f.resultPath, 'utf8'))
  result.records.find(r => r.record_id === 'flow').body = { format_version: 'module-flow-text-v1', flow_id: 'tls-main', title: '连接流程', text: '请求→检查就绪→成功或拒绝', source_evidence: ['repo:tls.c:1'] }
  await json(f.resultPath, result)
  return { ...f, result, root }
}

test('capability negotiation keeps old module-only options separate from v2', () => {
  const legacy = { scenarios: ['module-analysis'], coverage_input: false }
  const v2 = { scenarios: ['module-analysis', 'risk-analysis', 'branch-analysis', 'coverage-analysis'] }
  const caps = { source_first: { analysis_options: legacy, analysis_options_by_profile: { [SCENE_PROFILE]: v2 } } }
  assert.equal(analysisOptions(caps), legacy)
  assert.equal(analysisOptions(caps, SCENE_PROFILE), v2)
  assert.throws(() => analysisOptions({ analysis_options: legacy }, SCENE_PROFILE))
})

test('source-first read model exposes coverage case counts and declared readiness without changing Run status', async t => {
  const f = await fixture(t, 'coverage-analysis')
  const cases = [
    { purpose: 'branch', test_level: 'business_blackbox', execution_readiness: 'ready', readiness_reason: 'CLI entry exists', coverage_refs: ['C1', 'C2'] },
    { purpose: 'coverage', test_level: 'developer_assisted', execution_readiness: 'unknown', coverage_refs: [{ coverage_id: 'C1' }] },
    { purpose: 'risk', test_level: 'whitebox_support', execution_readiness: 'ready', coverage_refs: ['unverified'] },
  ]
  f.result.records = cases.map((body, index) => ({ record_id: `c${index}`, kind: 'test_case', body: { format_version: 'behavior-test-case-v1', ...body } }))
  await json(f.resultPath, f.result)
  await json(path.join(f.run, 'inputs/coverage-gaps.json'), [{ coverage_id: 'C1' }, { coverage_id: 'C2' }])
  const before = await readFile(f.resultPath, 'utf8')
  const run = await summarizeRun(f.root, f.task.run_id, { includeDetails: true })
  assert.deepEqual(run.coverage_summary, { valid_gaps: 2, coverage_cases: 1, linked_cases: 2, linked_coverage_cases: 1, linked_valid_gaps: 2, unverified_refs: 1 })
  assert.deepEqual(run.case_quality_summary, { blackbox_target: true, blackbox_target_reason: 'product-behavior', total_cases: 3, business_blackbox: 1, developer_assisted: 1, ready_blackbox: 1, ready_graybox: 0, ready_cases: 1, has_legacy_groups: false, ready_ratio: 1 / 3 })
  assert.deepEqual(run.details.coverage_gaps, [{ coverage_id: 'C1' }, { coverage_id: 'C2' }])
  assert.equal(run.details.test_cases[0].readiness_reason, 'CLI entry exists')
  assert.equal(run.lifecycle_status, 'complete')
  assert.equal(await readFile(f.resultPath, 'utf8'), before)
})

test('case details preserve unavailable versus empty frozen coverage inputs', async t => {
  const f = await fixture(t, 'coverage-analysis')
  let run = await summarizeRun(f.root, f.task.run_id, { includeDetails: true })
  assert.equal(run.details.coverage_gaps, null)
  await json(path.join(f.run, 'inputs/coverage-gaps.json'), [])
  run = await summarizeRun(f.root, f.task.run_id, { includeDetails: true })
  assert.deepEqual(run.details.coverage_gaps, [])
  await json(path.join(f.run, 'inputs/coverage-gaps.json'), { invalid: true })
  run = await summarizeRun(f.root, f.task.run_id, { includeDetails: true })
  assert.equal(run.details.coverage_gaps, null)
})

test('review stage label follows the frozen speed/depth contract', async t => {
  const f = await fixture(t, 'coverage-analysis')
  const progressPath = path.join(f.run, 'progress.json')
  const progress = JSON.parse(await readFile(progressPath, 'utf8'))
  await json(progressPath, { ...progress, stage: 'reviewing', lifecycle_status: 'running' })
  const speed = await summarizeRun(f.root, f.task.run_id, { includeDetails: true })
  assert.equal(speed.phase_title, '首轮结果对照复核（速度型）')
  assert.equal(speed.workflow.steps.find(step => step.stage === 'reviewing').title, speed.phase_title)
  const contractPath = path.join(f.run, 'inputs/task-contract.json')
  const contract = JSON.parse(await readFile(contractPath, 'utf8'))
  await json(contractPath, { ...contract, analysis_settings: { ...contract.analysis_settings, mode: 'depth' } })
  const depth = await summarizeRun(f.root, f.task.run_id, { includeDetails: true })
  assert.equal(depth.phase_title, '盲审与同会话对照')
  assert.equal(depth.workflow.steps.find(step => step.stage === 'reviewing').title, depth.phase_title)
})

test('all scenes read text-only flow and export the same eight user-facing columns', async t => {
  for (const scene of ['module-analysis', 'risk-analysis', 'branch-analysis', 'coverage-analysis']) {
    const f = await fixture(t, scene)
    const run = await summarizeRun(f.root, f.task.run_id, { includeDetails: true })
    const flow = run.details.business_flows.find(flow => flow.flow_id === f.flowId)
    assert.equal(flow.logical_flow_id, 'tls-main')
    assert.equal(flow.text, '请求→检查就绪→成功或拒绝')
    assert.deepEqual(flow.nodes, [])
    assert.ok(!flow.projection_warnings?.some(w => /节点/.test(w)))
    assert.equal(run.coverage_match.unmatched, 1)
    assert.equal(run.coverage_match.matched, 1)
    assert.equal(run.coverage_match.matched_preview[0].coverage_id, 'cov:GAP-1')
    assert.equal(run.coverage_match.sources[0].input_revision, 'original')
    const materials = await readInputMaterials(f.run)
    assert.equal(materials[0].title, '冻结覆盖数据')
    assert.equal(materials[0].input_revision, 'original')
    assert.match(materials[0].consumption_state, /尚无唯一消费记录/)
    const csv = buildTestCaseCsv(run)
    assert.equal(csv.split('\r\n')[0], '\uFEFF用例ID,标题,类型,前置条件,操作步骤,预期结果,观察点,清理动作（环境恢复）')
    assert.doesNotMatch(csv, /关联风险|流程\/路径引用|分析场景|Coverage引用|源码依据/)
    const xlsx = buildTestCaseXlsx(run)
    for (const label of ['关联风险', '流程/路径引用', '分析场景', 'Coverage引用', '源码依据']) assert.ok(!xlsx.includes(Buffer.from(label)), `${scene}: ${label} must not be exported`)
  }
})


test('v2 Run request carries exact scene and selected asset revision through capability negotiation', async t => {
  const { createRun } = await import('../src/pangea-api.js')
  const f = await fixture(t, 'coverage-analysis')
  let contract
  await createRun(f.root, { repository: 'repo', target: 'TLS', source_scope: ['src'], analysis_profile: SCENE_PROFILE, scenario: 'coverage-analysis', mode: 'speed', asset_ids: ['cov'], asset_revisions: { cov: 'selected-revision' } }, async ({ args }) => {
    if (args[0] === 'system') return { workflow_versions: ['source-first-v1'], source_first: { contract_fields: ['analysis_profile', 'analysis_settings', 'asset_revisions'], analysis_options_by_profile: { [SCENE_PROFILE]: { scenarios: ['coverage-analysis'], modes: ['speed'] } } } }
    contract = JSON.parse(await readFile(args.at(-1), 'utf8'))
    return { run_id: 'created' }
  })
  assert.equal(contract.analysis_profile, SCENE_PROFILE)
  assert.deepEqual(contract.analysis_settings, { scenario: 'coverage-analysis', mode: 'speed' })
  assert.deepEqual(contract.asset_revisions, { cov: 'selected-revision' })
  assert.deepEqual(contract.source_scope, ['src'])
  assert.ok(!('coverage_input' in contract))
})

test('coverage file import preserves partial acquisition and literal Windows path', async t => {
  const { importCoverageAsset } = await import('../src/workbench-api.js')
  const calls = []
  const source = String.raw`D:\samples\network\coverage data.json`
  const f = await fixture(t, 'coverage-analysis')
  const result = await importCoverageAsset({ cwd: f.root, source, runner: async call => {
    calls.push(call.args)
    if (call.args[1] === 'import') return { asset_id: 'cov' }
    if (call.args[1] === 'extract') return { status: 'available' }
    return { asset: { asset_id: 'cov', status: 'available', input_revision: 'fixed', structured_item_count: 0 }, result: { acquisition: { status: 'partial', missing: ['branch-data'] }, warnings: ['部分测量缺失'] } }
  } })
  assert.equal(calls[0][calls[0].indexOf('--path') + 1], source)
  assert.equal(result.status, 'partial')
  assert.equal(result.record_count, 0)
  assert.deepEqual(result.missing, ['branch-data'])
  assert.equal(result.asset.input_revision, 'fixed')
})

test('coverage query forwards exact deep scope, recursion and source with legacy module compatibility', async t => {
  const f = await fixture(t, 'coverage-analysis')
  const { queryCoverageAsset } = await import('../src/workbench-api.js')
  for (const query of [
    { scope: 'nvmf_tcp/transxxx/tls/handshake', recursive: false, source: 'auto' },
    { module: 'nvmf_tcp/transxxx/tls' },
  ]) {
    let args
    await queryCoverageAsset({ cwd: f.root, query: { product: 'P', c_version: ' V1 ', ...query }, runner: async input => { args = input.args; return {} } })
    assert.equal(args[args.indexOf('--scope') + 1], query.scope || query.module)
    assert.equal(args[args.indexOf('--version') + 1], ' V1 ')
    assert.equal(args.includes('--no-recursive'), query.recursive === false)
    assert.equal(args[args.indexOf('--source') + 1], query.source || 'summary')
    assert.ok(!args.includes('--module'))
  }
})


test('review-free runs expose only analysis stages and do not invent a review verdict', async t => {
  const f = await fixture(t, 'branch-analysis')
  const progressPath = path.join(f.run, 'progress.json')
  const progress = JSON.parse(await readFile(progressPath, 'utf8'))
  await json(progressPath, { ...progress, review_policy: 'disabled', quality_status: 'UNRESOLVED' })
  const run = await summarizeRun(f.root, f.task.run_id, { includeDetails: true })
  assert.equal(run.review_policy, 'disabled')
  assert.deepEqual(run.semantic_review, { method: 'disabled', verdict: null })
  assert.equal(run.review, null)
  assert.equal(run.workflow.judge.required, false)
  assert.deepEqual(run.workflow.steps.map(step => step.stage), ['preparing', 'planning', 'analyzing', 'reporting', 'complete'])
  assert.equal(run.workflow.step_progress.total, 5)
  assert.equal(run.lifecycle_status, 'complete')
  // Even an old unsupported PASS without actual review records is not a review pass.
  await json(progressPath, { ...progress, quality_status: 'PASS' })
  const legacy = await summarizeRun(f.root, f.task.run_id, { includeDetails: true })
  assert.equal(legacy.semantic_review.verdict, null)
})

test('migrated legacy review and correction phases remain readable but are skipped', () => {
  const steps = sourceFirstStepRows({ stage: 'complete', lifecycle_status: 'complete', review_policy: 'disabled' }, '/run', [
    { stage: 'comparison_review', status: 'paused', review_skipped: true, task_path: '/run/review.json', result_path: '/run/review-result.json' },
    { stage: 'targeted_closure', status: 'paused', review_skipped: true, task_path: '/run/closure.json' },
  ])
  for (const stage of ['reviewing', 'closing']) {
    const row = steps.find(step => step.stage === stage)
    assert.equal(row.status, 'skipped')
    assert.match(row.title, /历史.*不再执行/)
    assert.ok(row.artifacts.length)
  }
})


test('existing accepted review output is readable before and after disabled-policy migration', async t => {
  const f = await fixture(t, 'branch-analysis')
  const progressPath = path.join(f.run, 'progress.json')
  const progress = JSON.parse(await readFile(progressPath, 'utf8'))
  const actionId = `${f.task.run_id}:review`
  const taskPath = path.join(f.run, 'agent-tasks/review.json')
  const resultPath = path.join(f.run, 'agent-results/review.json')
  await json(taskPath, { task_type: 'comparison_review', result_path: resultPath })
  await json(resultPath, { format_version: 'pangea-notes-v1', binding: { run_id: f.task.run_id, action_id: actionId, task_id: 'reviewer' }, revision: 1,
    records: [{ record_id: 'decision', kind: 'review_decision', body: { verdict: 'PASS', summary: '历史审核结论' } }] })
  progress.actions[actionId] = { stage: 'comparison_review', role: 'review', task_path: taskPath, task_id: 'reviewer', status: 'accepted' }
  progress.accepted_revisions[actionId] = 1
  progress.quality_status = 'PASS'
  await json(progressPath, progress)
  const before = await summarizeRun(f.root, f.task.run_id, { includeDetails: true })
  assert.equal(before.semantic_review.verdict, 'PASS')
  assert.equal(before.review.comparison.records[0].body.summary, '历史审核结论')
  await json(progressPath, { ...progress, review_policy: 'disabled' })
  const after = await summarizeRun(f.root, f.task.run_id, { includeDetails: true })
  assert.equal(after.semantic_review.method, 'disabled')
  assert.equal(after.semantic_review.verdict, null)
  assert.deepEqual(after.review.comparison.records, before.review.comparison.records)
})
