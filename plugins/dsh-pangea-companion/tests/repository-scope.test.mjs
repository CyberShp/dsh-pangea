import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import test from 'node:test'
import { validateScope, scopeTree, previewScope, confirmScope } from '../src/repositories/scope.js'

test('scope tree validates boundaries and preview pages keep full counts; stale selections cannot start', async t => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'scope-preview-')); t.after(() => rm(dataRoot, { recursive: true, force: true }))
  await mkdir(path.join(dataRoot, 'repositories/repo/tls'), { recursive: true }); await writeFile(path.join(dataRoot, 'repositories/repo/tls/握手.c'), 'int a;')
  const input = { dataRoot, cwd: dataRoot, repository: 'repo', source_scope: ['tls'] }
  assert.deepEqual((await validateScope(input)).normalized_scope, ['tls'])
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
  await assert.rejects(previewScope({ ...input, source_scope: ['tls', 'tls/握手.c'], preview_id: first.preview_id }, runner), { statusCode: 400 })
})

test('new source and tool scopes accept actual child directories only', async t => {
  const { previewTestTools } = await import('../src/repositories/scope.js')
  const { createRun } = await import('../src/pangea-api.js')
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'child-directory-'))
  t.after(() => rm(dataRoot, { recursive: true, force: true }))
  const repo = path.join(dataRoot, 'repositories/repo')
  await mkdir(path.join(repo, '中文 空格,目录'), { recursive: true })
  await writeFile(path.join(repo, '中文 空格,目录/api.c'), 'int api;')
  await symlink(repo, path.join(repo, 'root-link'), 'dir')
  await symlink(dataRoot, path.join(repo, 'outside-link'), 'dir')
  const input = { cwd: dataRoot, dataRoot, repository: 'repo', source_scope: ['中文 空格,目录'] }
  assert.deepEqual((await validateScope(input)).normalized_scope, ['中文 空格,目录'])
  const tree = await scopeTree(input)
  assert.equal(tree.entries.find(item => item.name === 'root-link').selectable, false)
  const files = await scopeTree({ ...input, path: '中文 空格,目录' })
  assert.equal(files.entries[0].selectable, false)
  for (const paths of [[], [''], ['.'], ['./'], ['.//.'], ['中文 空格,目录/..'], ['missing'], ['中文 空格,目录/api.c'], ['../repo'], [path.join(repo, '中文 空格,目录')], ['C:\\repo\\src'], ['C:src'], ['\\\\server\\share'], ['root-link'], ['outside-link'], ['中文 空格,目录', '']]) {
    await assert.rejects(validateScope({ ...input, source_scope: paths }), undefined, JSON.stringify(paths))
    await assert.rejects(previewTestTools({ ...input, test_tool_sources: [{ repo_id: 'repo', paths }] }, () => { throw Error('must not call engine') }))
  }
  await mkdir(path.join(dataRoot, '.agents/pangea'), { recursive: true })
  await writeFile(path.join(dataRoot, '.agents/pangea/dsh.md'), 'fixture')
  await assert.rejects(createRun(dataRoot, { data_root: dataRoot, repository: 'repo', target: 'fake', source_scope: ['.'] }, () => { throw Error('must not call engine') }), /非根下级目录/)
})
