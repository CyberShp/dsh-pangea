import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildDiagnosticBundle } from '../src/diagnostic-bundle.js'
import { CaseReviewStore, caseContentHash } from '../src/case-review-store.js'
import { injectionPrompt } from '../src/fault-injection.js'
import { summarizeRunVerifications } from '../src/fault-injection-summary.js'

test('WP3.4: buildDiagnosticBundle produces sanitized ZIP with manifest, progress, and fault-injection summary', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-diag-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const runId = 'run-diag-1'
  await mkdir(path.join(root, 'runs', runId), { recursive: true })
  await writeFile(path.join(root, 'runs', runId, 'progress.json'), JSON.stringify({
    schema_version: '3.1',
    run_id: runId,
    lifecycle_status: 'complete',
    stage: 'complete',
    actions: {
      'act-1': {
        action_id: 'act-1', role: 'analysis', stage: 'unit_analysis', status: 'accepted',
        error: 'failed reading /home/alice/secret/repo from https://ci_user:ci_pass@git.local/repo with Bearer sk-secret-token',
      },
    },
    degradations: [],
    errors: ['def shepard_canary():', {env: {SECRET_VALUE: 'environment-canary'}}],
  }))
  await assert.rejects(() => buildDiagnosticBundle({ dataRoot: root, runId: '..' }), /run_id 无效/)
  const bundle = await buildDiagnosticBundle({
    dataRoot: root,
    runId,
    summary: { run_id: runId, status: 'complete', scenario: 'branch-analysis', counts: { test_cases: 3 } },
    version: '0.11.1',
  })
  assert.equal(bundle.filename, `pangea-diagnostic-${runId}.zip`)
  assert.equal(bundle.contentType, 'application/zip')
  const text = bundle.buffer.toString('utf8')
  assert.match(text, /manifest\.json/)
  assert.match(text, /progress\.json/)
  assert.match(text, /fault-injection-summary\.json/)
  assert.match(text, /"has_error": true/)
  assert.match(text, /"errors_count": 2/)
  assert.doesNotMatch(text, /alice|sk-secret-token|ci_user|ci_pass|shepard_canary|environment-canary/)
})

test('WP3.3: CaseReviewStore.inheritFromParent copies unchanged parent decisions without overwriting child decisions', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-review-inherit-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const c1 = { projection_id: 'u1/C1', test_case_id: 'u1/C1', title: 'unchanged case', steps: ['a'] }
  const c2Old = { projection_id: 'u1/C2', test_case_id: 'u1/C2', title: 'changed case old', steps: ['b'] }
  const c2New = { projection_id: 'u1/C2', test_case_id: 'u1/C2', title: 'changed case new', steps: ['b2'] }
  const c3 = { projection_id: 'u1/C3', test_case_id: 'u1/C3', title: 'child already reviewed', steps: ['c'] }

  const parentStore = new CaseReviewStore({ dataRoot: root, runId: 'run-parent' })
  await parentStore.update([c1, c2Old, c3], { case_key: 'u1/C1', decision: 'adopted', expected_revision: 0, expected_content_hash: caseContentHash(c1) })
  await parentStore.update([c1, c2Old, c3], { case_key: 'u1/C2', decision: 'excluded', expected_revision: 1, expected_content_hash: caseContentHash(c2Old) })
  await parentStore.update([c1, c2Old, c3], { case_key: 'u1/C3', decision: 'excluded', expected_revision: 2, expected_content_hash: caseContentHash(c3) })

  const childStore = new CaseReviewStore({ dataRoot: root, runId: 'run-child' })
  await childStore.update([c1, c2New, c3], { case_key: 'u1/C3', decision: 'adopted', expected_revision: 0, expected_content_hash: caseContentHash(c3) })

  const result = await childStore.inheritFromParent([c1, c2New, c3], 'run-parent')
  assert.equal(result.inherited_count, 1)
  const byKey = Object.fromEntries(result.cases.map(r => [r.case_key, r.review_status]))
  assert.equal(byKey['u1/C1'], 'adopted')
  assert.equal(byKey['u1/C2'], 'unreviewed')
  assert.equal(byKey['u1/C3'], 'adopted')
})

test('WP3.1 & WP3.2: summarizeRunVerifications preserves notes/build_package_id and injectionPrompt includes Python/Shell guidance', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-fi-sum-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const runId = 'run-fi-sum'
  await mkdir(path.join(root, '.pangea', 'fault-injection', runId, 'fi-1'), { recursive: true })
  await writeFile(path.join(root, '.pangea', 'fault-injection', runId, 'fi-1', 'task.json'), JSON.stringify({
    id: 'fi-1',
    run_id: runId,
    name: '打桩任务1',
    status: 'ready',
    branch: 'fi-branch',
    case_keys: ['u1/C1'],
    verification: [{
      case_key: 'u1/C1',
      result: 'passed',
      hits: 'P1=1',
      notes: '在测试床实测通过',
      build: { package_id: 'pkg-42', url: 'https://ci.local/42' },
      at: '2026-11-23T08:00:00Z',
    }],
  }))
  const summary = await summarizeRunVerifications(root, runId)
  assert.equal(summary.injection_by_case['u1/C1'].notes, '在测试床实测通过')
  assert.equal(summary.injection_by_case['u1/C1'].build_package_id, 'pkg-42')
  assert.equal(summary.injection_by_case['u1/C1'].build_url, 'https://ci.local/42')

  const prompt = injectionPrompt({
    record: { id: 'fi-1', generation_contract_version: 3, delivery_mode: 'product_package' },
    inputPath: '/tmp/in.json',
    outputPath: '/tmp/out.json',
  })
  assert.match(prompt, /Python（\.py）或 Shell（\.sh\/\.bash）/)
  assert.match(prompt, /py_compile/)
})
