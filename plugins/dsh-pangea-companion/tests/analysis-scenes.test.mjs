import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { analysisOptions, riskApplicable, SCENE_PROFILE } from '../src/analysis-scenes.js'
import { summarizeRun, readInputMaterials } from '../src/reader.js'
import { buildTestCaseCsv, buildTestCaseXlsx } from '../src/export.js'
import { createView } from '../src/architecture-views.js'
import { writeArchitectureRun } from './architecture-source-first-fixture.mjs'

const json = async (file, value) => writeFile(file, JSON.stringify(value))
async function fixture(t, scene) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'analysis-scenes-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, '.agents/pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents/pangea/dsh.md'), '# fixture')
  const f = await writeArchitectureRun(root)
  await json(path.join(f.run, 'inputs/task-contract.json'), { workflow_version: 'source-first-v1', analysis_profile: SCENE_PROFILE, target: 'TLS', repository: 'repo', analysis_settings: { scenario: scene, mode: 'speed' } })
  await json(path.join(f.run, 'inputs/analysis-scene.json'), { id: scene, label: scene, profile: SCENE_PROFILE, format_version: 'analysis-scene-v1', presentation: { risks: ['module-analysis', 'risk-analysis'].includes(scene) } })
  await json(path.join(f.run, 'inputs/coverage-match-summary.json'), { sources: [{ asset_id: 'cov', input_revision: 'original', status: 'partial' }], matched: [], unmatched: [{ path: 'unknown.c' }], ambiguous: [] })
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

test('all scenes read text-only flow; branch/coverage export no formal risk column', async t => {
  for (const scene of ['module-analysis', 'risk-analysis', 'branch-analysis', 'coverage-analysis']) {
    const f = await fixture(t, scene)
    const run = await summarizeRun(f.root, f.task.run_id, { includeDetails: true })
    const flow = run.details.business_flows.find(flow => flow.flow_id === f.flowId)
    assert.equal(flow.logical_flow_id, 'tls-main')
    assert.equal(flow.text, '请求→检查就绪→成功或拒绝')
    assert.deepEqual(flow.nodes, [])
    assert.ok(!flow.projection_warnings?.some(w => /节点/.test(w)))
    assert.equal(run.coverage_match.unmatched, 1)
    assert.equal(run.coverage_match.sources[0].input_revision, 'original')
    const materials = await readInputMaterials(f.run)
    assert.equal(materials[0].title, '冻结覆盖数据')
    assert.equal(materials[0].input_revision, 'original')
    assert.match(materials[0].consumption_state, /尚无唯一消费记录/)
    const csv = buildTestCaseCsv(run)
    assert.equal(csv.includes('关联风险'), riskApplicable(run))
    assert.match(csv, /流程\/路径引用/)
    assert.match(csv, /分析场景/)
    const xlsx = buildTestCaseXlsx(run)
    assert.equal(xlsx.includes(Buffer.from('关联风险')), riskApplicable(run))
  }
})

test('manual text-flow diagram captures exact records; explicit regeneration keeps old snapshot', async t => {
  const f = await fixture(t, 'branch-analysis')
  const archify = path.join(f.root, 'archify')
  await mkdir(path.join(archify, 'bin'), { recursive: true })
  await writeFile(path.join(archify, 'SKILL.md'), '# fixture')
  await writeFile(path.join(archify, 'bin/archify.mjs'), '')
  const env = { PANGEA_ARCHIFY_ROOT: archify }
  const first = await createView(f.task, { flow_id: f.flowId, profile: 'function_variables' }, env)
  const contextPath = path.join(f.run, '派生视图/archify', first.view.view_id, 'context.json')
  const originalContext = await readFile(contextPath, 'utf8')
  assert.ok(originalContext.includes('请求→检查就绪'))
  assert.equal(first.view.logical_flow_id, 'tls-main')
  assert.equal(first.view.flow_unit_id, 'tls')
  const old = f.result.records.find(r => r.record_id === 'flow')
  f.result.records.push({ ...old, record_id: 'flow-fixed', supersedes: ['flow'], body: { ...old.body, text: '修正后的流程' } })
  f.result.revision = 4
  await json(f.resultPath, f.result)
  const progress = JSON.parse(await readFile(path.join(f.run, 'progress.json'), 'utf8'))
  progress.accepted_revisions[f.actionId] = 4
  await json(path.join(f.run, 'progress.json'), progress)
  const next = await createView(f.task, { flow_id: 'tls/flow-fixed', profile: 'function_variables', previous_view_id: first.view.view_id }, env)
  assert.equal(next.view.logical_flow_id, 'tls-main')
  assert.equal(next.view.source_records.find(r => r.record_id === 'flow-fixed').revision, 4)
  assert.equal(await readFile(contextPath, 'utf8'), originalContext)
})

test('v2 Run request carries exact scene and selected asset revision through capability negotiation', async t => {
  const { createRun } = await import('../src/pangea-api.js')
  const f = await fixture(t, 'coverage-analysis')
  let contract
  await createRun(f.root, { repository: 'repo', target: 'TLS', source_scope: ['.'], analysis_profile: SCENE_PROFILE, scenario: 'coverage-analysis', mode: 'speed', asset_ids: ['cov'], asset_revisions: { cov: 'selected-revision' } }, async ({ args }) => {
    if (args[0] === 'system') return { workflow_versions: ['source-first-v1'], source_first: { contract_fields: ['analysis_profile', 'analysis_settings', 'asset_revisions'], analysis_options_by_profile: { [SCENE_PROFILE]: { scenarios: ['coverage-analysis'], modes: ['speed'] } } } }
    contract = JSON.parse(await readFile(args.at(-1), 'utf8'))
    return { run_id: 'created' }
  })
  assert.equal(contract.analysis_profile, SCENE_PROFILE)
  assert.deepEqual(contract.analysis_settings, { scenario: 'coverage-analysis', mode: 'speed' })
  assert.deepEqual(contract.asset_revisions, { cov: 'selected-revision' })
  assert.deepEqual(contract.source_scope, ['.'])
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
