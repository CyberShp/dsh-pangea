import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { normalizeFlowBaseline, normalizeModelSettings, readFlowMetadata } from '../src/flow-baseline.js'
import { createTaskStore } from '../src/task-store.js'
import { createRun } from '../src/pangea-api.js'
import { normalizeRunInput, workbenchSnapshot } from '../src/workbench-api.js'

const capabilities = { workflow_versions: ['source-first-v1'], source_first: {
  version: 'source-first-v1', contract_fields: ['analysis_settings', 'analysis_profile', 'asset_revisions', 'flow_baseline', 'model_settings'],
  analysis_options_by_profile: { 'behavior-test-v2': { scenarios: ['branch-analysis'], modes: ['depth'], coverage_input: false } },
} }
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-flow-baseline-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, '.agents/pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents/pangea/dsh.md'), '# test workspace')
  const dataRoot = path.join(root, 'pangea-data'), runDirectory = path.join(dataRoot, 'runs/reviewed-run')
  await mkdir(path.join(runDirectory, 'inputs'), { recursive: true })
  await mkdir(path.join(runDirectory, 'outputs'), { recursive: true })
  return { root, dataRoot, runDirectory }
}

test('explicit baseline survives task persistence and CLI contract without leaking unrelated fields', async t => {
  const f = await fixture(t), storePath = path.join(f.root, 'tasks.json')
  const ref = { run_id: 'reviewed-run', version_id: 'flow-version' }
  const task = await createTaskStore({ storePath }).create({ workspace: f.root, dataRoot: f.dataRoot,
    input: { repository: 'repo', target: '模块', source_scope: ['src'], analysis_profile: 'behavior-test-v2', scenario: 'branch-analysis', flow_baseline: { ...ref, token: 'secret' } } })
  const reloaded = await createTaskStore({ storePath }).get(task.task_id)
  assert.deepEqual(reloaded.flow_baseline, ref)
  const input = normalizeRunInput(reloaded, capabilities)
  let contract
  await createRun(f.root, { ...input, data_root: f.dataRoot, model_settings: { provider: 'selected', seed: 0, api_key: 'secret' } }, async ({ args }) => {
    if (args[0] === 'system') return capabilities
    contract = JSON.parse(await readFile(args.at(-1), 'utf8'))
    return { run_id: 'new-run' }
  })
  assert.deepEqual(contract.flow_baseline, ref)
  assert.deepEqual(contract.model_settings, { provider: 'selected', seed: 0 })
  assert.equal(contract.run_id, undefined)
  assert.throws(() => normalizeRunInput(reloaded, { ...capabilities, source_first: { version: 'source-first-v1' } }), /不支持流程基线/)
  assert.throws(() => normalizeRunInput({ ...reloaded, analysis_profile: null }, capabilities), /场景版本/)
})

test('baseline identity rejects paths and missing version; model metadata never invents defaults', () => {
  assert.equal(normalizeFlowBaseline(null), null)
  for (const run_id of ['..', '../run', 'x\\run', 'x\0y']) assert.throws(() => normalizeFlowBaseline({ run_id, version_id: 'v' }))
  assert.throws(() => normalizeFlowBaseline({ run_id: 'run' }))
  assert.deepEqual(normalizeModelSettings({ provider: ' p ', token: 'secret' }), { provider: 'p' })
  assert.equal(normalizeModelSettings({ api_key: 'secret', temperature: NaN }), null)
})

test('historical flow metadata remains readable without offering new-analysis baseline options', async t => {
  const f = await fixture(t)
  const run = { run_id: 'reviewed-run', workflow_version: 'source-first-v1', lifecycle_status: 'complete', quality_status: 'PASS' }
  assert.deepEqual(await readFlowMetadata(f.runDirectory, run.run_id, run), { warnings: [] })
  const fingerprint = { format_version: 'flow-stability-v1', run_id: run.run_id, fingerprint: 'abc' }
  const baseline = { format_version: 'flow-baseline-v1', run_id: run.run_id, version_id: 'flow-version',
    eligible: true, review_status: 'PASS', flow_count: 1, input_fingerprint: fingerprint, target: '模块', repository: 'repo' }
  await writeFile(path.join(f.runDirectory, 'inputs/flow-stability.json'), JSON.stringify(fingerprint))
  await writeFile(path.join(f.runDirectory, 'outputs/flow-baseline.json'), JSON.stringify(baseline))
  assert.equal((await readFlowMetadata(f.runDirectory, run.run_id, run)).flow_baseline.version_id, baseline.version_id)
  for (const state of [{ lifecycle_status: 'running' }, { quality_status: 'UNRESOLVED' }, { partial_delivery: true }]) {
    assert.equal((await readFlowMetadata(f.runDirectory, run.run_id, { ...run, ...state })).flow_baseline, undefined)
  }
  const snapshot = await workbenchSnapshot({ cwd: f.root, dataRoot: f.dataRoot, runId: run.run_id,
    runner: async ({ args }) => args[0] === 'system' ? capabilities : args[1] === 'list' ? { items: [run], total: 1 } : run })
  assert.equal(Object.hasOwn(snapshot, 'flow_baseline_options'), false)
  assert.equal(snapshot.run.flow_baseline.version_id, baseline.version_id)
  assert.equal(snapshot.run.flow_stability.fingerprint, fingerprint.fingerprint)
  const reviewComparison = { format_version: 'flow-comparison-v1', comparison_scope: 'first_round', candidate: { run_id: run.run_id } }
  const deliveryComparison = { ...reviewComparison, comparison_scope: 'delivery', reviewed: false }
  await writeFile(path.join(f.runDirectory, 'inputs/flow-comparison.json'), JSON.stringify(reviewComparison))
  await writeFile(path.join(f.runDirectory, 'outputs/flow-delivery-comparison.json'), JSON.stringify(deliveryComparison))
  const final = await readFlowMetadata(f.runDirectory, run.run_id, run)
  assert.deepEqual(final.flow_comparison, deliveryComparison)
  assert.deepEqual(final.flow_review_comparison, reviewComparison)
  await rm(path.join(f.runDirectory, 'outputs/flow-delivery-comparison.json'))
  await writeFile(path.join(f.runDirectory, 'inputs/flow-comparison.json'), '{')
  const corrupt = await readFlowMetadata(f.runDirectory, run.run_id, run)
  assert.equal(corrupt.flow_baseline.version_id, baseline.version_id)
  assert.match(corrupt.warnings.join('\n'), /flow-comparison/)
  await writeFile(path.join(f.runDirectory, 'outputs/flow-baseline.json'), JSON.stringify({ ...baseline, run_id: 'other-run' }))
  assert.equal((await readFlowMetadata(f.runDirectory, run.run_id, run)).flow_baseline, undefined)
})

test('optional metadata never follows a symlink outside its explicit Run', async t => {
  const f = await fixture(t), outside = path.join(f.root, 'outside.json')
  await writeFile(outside, JSON.stringify({ format_version: 'flow-stability-v1', run_id: 'reviewed-run' }))
  await symlink(outside, path.join(f.runDirectory, 'inputs/flow-stability.json'))
  const result = await readFlowMetadata(f.runDirectory, 'reviewed-run')
  assert.equal(result.flow_stability, undefined)
  assert.match(result.warnings.join('\n'), /边界/)
})
