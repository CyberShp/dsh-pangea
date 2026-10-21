import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import test from 'node:test'
import { validateScope, scopeTree, previewScope, confirmScope } from '../src/repositories/scope.js'

test('scope tree validates boundaries and preview pages keep full counts; stale selections cannot start', async t => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'scope-preview-')); t.after(() => rm(dataRoot, { recursive: true, force: true }))
  await mkdir(path.join(dataRoot, 'repositories/repo/tls'), { recursive: true }); await writeFile(path.join(dataRoot, 'repositories/repo/tls/握手.c'), 'int a;')
  const input = { dataRoot, cwd: dataRoot, repository: 'repo', source_scope: ['tls', 'tls/握手.c'] }
  assert.deepEqual((await validateScope(input)).normalized_scope, ['tls', 'tls/握手.c'])
  assert.equal((await scopeTree({ ...input, path: 'tls' })).entries[0].path, 'tls/握手.c')
  await assert.rejects(validateScope({ ...input, source_scope: ['../../'] }), { statusCode: 403 })
  let revision = 'files-v1', calls = 0
  const runner = async () => { calls++; return { preview_state: 'complete', normalized_scope: input.source_scope, scope_revision: revision, rules_revision: 'on-demand', matched_file_count: 3, files: ['a.c', 'b.c', 'c.c'].map(relative_path => ({ relative_path })) } }
  const first = await previewScope({ ...input, limit: 2 }, runner)
  assert.equal(first.matched_file_count, 3); assert.equal(first.files.length, 2)
  const second = await previewScope({ ...input, preview_id: first.preview_id, cursor: 2, limit: 2 }, runner)
  assert.equal(second.files.length, 1); assert.equal(second.matched_file_count, 3); assert.equal(calls, 1)
  revision = 'files-v2'
  await assert.rejects(confirmScope({ ...input, scope_preview_id: first.preview_id, expected_scope_revision: first.scope_revision }, runner), { statusCode: 409 })
  await assert.rejects(previewScope({ ...input, source_scope: ['tls/握手.c'], preview_id: first.preview_id }, runner), { statusCode: 409 })
})
