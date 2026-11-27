import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CaseReviewStore, caseContentHash, selectExportCases } from '../src/case-review-store.js'

const cases = [{ test_case_id: 'u/c1', title: '握手超时', steps: [{ action: '注入超时', expected: '释放连接' }] }, { test_case_id: 'u/c2', title: '正常建链' }]
async function fixture(t) { const root = await mkdtemp(path.join(os.tmpdir(), 'case-review-')); t.after(() => rm(root, { recursive: true, force: true })); return { root, store: new CaseReviewStore({ dataRoot: root, runId: 'run-a' }) } }
test('decisions persist independently, survive restart, allow rapid updates without global revision lock, and reject stale case content hash', async t => {
  const { root, store } = await fixture(t), first = await store.project(cases)
  const saved = await store.update(cases, { expected_revision: first.revision, case_key: 'u/c1', expected_content_hash: first.cases[0].content_hash, decision: 'adopted' })
  assert.equal(saved.counts.adopted, 1)
  const restarted = new CaseReviewStore({ dataRoot: root, runId: 'run-a' })
  assert.equal((await restarted.project(cases)).counts.adopted, 1)
  assert.equal(caseContentHash({ ...cases[0], updated_at: 'later' }), first.cases[0].content_hash)
  assert.equal((await restarted.project([{ ...cases[0], title: '用例已修订' }, cases[1]])).counts.needs_recheck, 1)
  // Rapid update with older expected_revision succeeds when case content hash still matches
  const updated = await store.update(cases, { expected_revision: 0, case_key: 'u/c1', expected_content_hash: first.cases[0].content_hash, decision: 'excluded' })
  assert.equal(updated.counts.excluded, 1)
  // Stale content hash (case itself changed) still returns 409
  await assert.rejects(store.update(cases, { expected_revision: updated.revision, case_key: 'u/c1', expected_content_hash: 'stale-hash', decision: 'adopted' }), { statusCode: 409 })
  const cleared = await restarted.update(cases, { expected_revision: updated.revision, case_key: 'u/c1', expected_content_hash: first.cases[0].content_hash, decision: 'unreviewed' })
  assert.equal(cleared.counts.unreviewed, 2)
})
test('two stores serialize concurrent writes cleanly and corrupted data is never overwritten', async t => {
  const { root, store } = await fixture(t), initial = await store.project(cases)
  const other = new CaseReviewStore({ dataRoot: root, runId: 'run-a' })
  const input1 = { expected_revision: 0, case_key: 'u/c1', expected_content_hash: initial.cases[0].content_hash, decision: 'adopted' }
  const input2 = { expected_revision: 0, case_key: 'u/c2', expected_content_hash: initial.cases[1].content_hash, decision: 'adopted' }
  const results = await Promise.allSettled([store.update(cases, input1), other.update(cases, input2)])
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 2)
  assert.equal((await store.project(cases)).counts.adopted, 2)
  const file = await store.file(); await writeFile(file, '{broken')
  await assert.rejects(store.update(cases, { ...input1, expected_revision: 1 }), { statusCode: 422 })
  assert.equal(await readFile(file, 'utf8'), '{broken')
})
test('exports honor exact selected/adopted scopes and never expand an empty or stale selection', async t => {
  const { store } = await fixture(t), initial = await store.project(cases)
  const saved = await store.update(cases, { expected_revision: 0, case_key: 'u/c1', expected_content_hash: initial.cases[0].content_hash, decision: 'adopted' })
  assert.deepEqual(await selectExportCases(cases, { scope: 'selected', case_keys: ['u/c2'], case_set_revision: initial.case_set_revision }, store), [cases[1]])
  assert.deepEqual(await selectExportCases(cases, { scope: 'adopted', case_set_revision: saved.case_set_revision, review_revision: saved.revision }, store), [cases[0]])
  await assert.rejects(selectExportCases(cases, { scope: 'selected', case_keys: [], case_set_revision: initial.case_set_revision }, store), { statusCode: 422 })
  await assert.rejects(selectExportCases(cases, { scope: 'filtered', case_keys: ['other-run/c1'], case_set_revision: initial.case_set_revision }, store), { statusCode: 422 })
  assert.deepEqual(await selectExportCases(cases, { scope: 'all', case_set_revision: 'stale' }, store), cases)
})

test('failed writes retain the original decision and hash version changes cannot inherit adoption', async t => {
  const { root, store } = await fixture(t), initial = await store.project(cases)
  const saved = await store.update(cases, { expected_revision: 0, case_key: 'u/c1', expected_content_hash: initial.cases[0].content_hash, decision: 'adopted' })
  const failed = new CaseReviewStore({ dataRoot: root, runId: 'run-a', write: async () => { throw new Error('fixture disk fault') } })
  await assert.rejects(failed.update(cases, { expected_revision: saved.revision, case_key: 'u/c1', expected_content_hash: initial.cases[0].content_hash, decision: 'excluded' }), /fixture disk fault/)
  assert.equal((await store.project(cases)).counts.adopted, 1)
  const file = await store.file(), stored = JSON.parse(await readFile(file, 'utf8')); stored.content_hash_version = 99; await writeFile(file, JSON.stringify(stored))
  assert.equal((await store.project(cases)).counts.needs_recheck, 1)
  const changed = await store.update(cases, { expected_revision: saved.revision, case_key: 'u/c2', expected_content_hash: initial.cases[1].content_hash, decision: 'adopted' })
  assert.equal(changed.counts.adopted, 1); assert.equal(changed.counts.needs_recheck, 1, 'saving another case must not revive the older hash version')
})
