import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRun } from '../src/pangea-api.js'
import { normalizeRunInput } from '../src/workbench-api.js'
import { createTaskStore } from '../src/task-store.js'
import { caseQualitySummary } from '../src/source-first-projection.js'

const options = { scenarios: ['module-analysis', 'risk-analysis'], modes: ['speed', 'depth'], objectives: ['product-behavior', 'interface-contract'] }
const capabilities = { workflow_versions: ['source-first-v1'], repositories: ['repo'], source_first: { version: 'source-first-v1',
  contract_fields: ['analysis_profile', 'analysis_settings', 'asset_revisions'], analysis_options_by_profile: { 'behavior-test-v2': options } } }

test('explicit objective survives task persistence and exact frozen Run request', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-objective-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, '.agents/pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents/pangea/dsh.md'), '# fixture')
  const input = normalizeRunInput({ repository: 'repo', target: 'driver library lifecycle', source_scope: ['.'], focus: ['cleanup'],
    scenario: 'module-analysis', mode: 'speed', analysis_profile: 'behavior-test-v2', objective: 'product-behavior' }, capabilities)
  const store = createTaskStore(path.join(root, 'tasks.json'))
  const task = await store.create({ workspace: root, input })
  assert.equal(task.objective, 'product-behavior')
  const reopened = createTaskStore(path.join(root, 'tasks.json'))
  assert.equal((await reopened.get(task.task_id)).objective, 'product-behavior')
  let frozen
  await createRun(root, task, async request => {
    if (request.args[0] === 'system') return capabilities
    frozen = JSON.parse(await readFile(request.args.at(-1), 'utf8'))
    return { run_id: 'new-run' }
  })
  assert.deepEqual(frozen.analysis_settings, { scenario: 'module-analysis', mode: 'speed', objective: 'product-behavior' })
  assert.deepEqual(frozen.focus, ['cleanup'])
  assert.equal(frozen.target, 'driver library lifecycle')
  assert.throws(() => normalizeRunInput({ ...input, objective: 'auto' }, capabilities), /不支持所选分析目标/)
})

test('ready fraction is unchanged across frozen risk and interface target exemptions', () => {
  const cases = [
    { test_level: 'business_blackbox', execution_readiness: 'ready' },
    { test_level: 'developer_assisted', execution_readiness: 'ready' },
    { test_level: 'developer_assisted', execution_readiness: 'needs_instrumentation' },
    { test_level: 'interface_contract', execution_readiness: 'ready' },
  ].map(row => ({ format_version: 'behavior-test-case-v1', ...row }))
  const before = JSON.stringify(cases)
  for (const scene of [undefined, { id: 'module-analysis', objective: 'interface-contract', presentation: { blackbox_target: false } },
    { id: 'risk-analysis', presentation: { blackbox_target: false } }]) {
    const quality = caseQualitySummary(cases, scene)
    assert.equal(quality.ready_cases, 2)
    assert.equal(quality.ready_ratio, 0.5)
    assert.equal(quality.blackbox_target, !scene)
  }
  // Frozen presentation is authoritative even if a newer default would differ.
  assert.equal(caseQualitySummary(cases, { id: 'risk-analysis' }).blackbox_target, true)
  assert.equal(JSON.stringify(cases), before)
})
