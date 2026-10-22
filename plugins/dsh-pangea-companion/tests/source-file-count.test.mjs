import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { frozenSourceFileCount, summarizeRun } from '../src/reader.js'
import { writeArchitectureRun } from './architecture-source-first-fixture.mjs'

// Captured from the 52-file frozen dperf Run; only machine-specific paths removed.
const currentManifest = JSON.parse(await readFile(new URL('./fixtures/source-manifest-dperf-52.json', import.meta.url), 'utf8'))
const legacyManifest = { index_path: 'index.sqlite', file_count: 128, chunk_count: 640,
  scope_expansion: { requested_scope: ['lib/nvmf/auth.c'], groups: [], context_files: [], added_files: [] },
  repository_versions: [{ repo_id: 'spdk', git: { is_git: true, commit: 'example' } }] }

test('frozen source catalogue counts code/context identities per repository', () => {
  assert.equal(currentManifest.source_scope.filter(p => p.endsWith('.c')).length, 15)
  assert.equal(currentManifest.source_scope.filter(p => p.endsWith('.h')).length, 37)
  assert.equal(frozenSourceFileCount(currentManifest), 52)
  assert.equal(frozenSourceFileCount({ scope_expansion: { groups: [
    { repo_id: 'a', code_paths: ['same.c', 'same.c'], context_paths: ['same.c', 'context.h'] },
    { repo_id: 'b', code_paths: ['same.c'], context_paths: ['same.c'] },
  ] } }), 3)
  assert.equal(frozenSourceFileCount({ scope_expansion: { groups: [{ repo_id: 'a', code_paths: [], context_paths: [] }] } }), 0)
  assert.equal(frozenSourceFileCount({ files: [{ repo_id: 'a', path: 'x.c' }, { repo_id: 'b', path: 'x.c' }] }), 2)
  for (const manifest of [null, undefined, {}, { requested_scope: ['src'] }, { file_count: -1 }, { scope_expansion: { groups: [{ repo_id: 'a', code_paths: ['x.c', null] }] } }]) {
    assert.equal(frozenSourceFileCount(manifest), null)
  }
})

test('reader uses frozen manifest counts, including legacy counts, and missing is unknown despite an index', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-source-count-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const f = await writeArchitectureRun(root)
  assert.equal((await summarizeRun(root, path.basename(f.run))).source_snapshot.file_count, 1, 'early source-first manifest references frozen index catalogue')
  const manifestPath = path.join(f.run, 'inputs/source-manifest.json')
  for (const [manifest, count] of [[currentManifest, 52], [legacyManifest, 128], [{ file_count: 0 }, 0]]) {
    await writeFile(manifestPath, JSON.stringify(manifest))
    assert.equal((await summarizeRun(root, path.basename(f.run))).source_snapshot.file_count, count)
  }
  await unlink(manifestPath)
  assert.equal((await summarizeRun(root, path.basename(f.run))).source_snapshot.file_count, null)
})
