import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readEvidenceSnippet, resolveEvidenceFile } from '../src/source.js'

test('source-first preview selects the named frozen repository and preserves legacy layout', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-source-preview-'))
  try {
    for (const repo of ['one', 'two', 'repository']) {
      await mkdir(path.join(root, repo))
      await writeFile(path.join(root, repo, 'same.c'), `// ${repo}\nint value;\n`)
    }
    const snippet = await readEvidenceSnippet({ snapshotRoot: root, snapshotLayout: 'source-first', repositoryId: 'two', location: 'two:same.c:2' })
    assert.equal(snippet.file_path, path.join(root, 'two', 'same.c'))
    assert.equal(snippet.lines[0].text, '// two')
    assert.equal(snippet.target_start, 2)
    await assert.rejects(readEvidenceSnippet({ snapshotRoot: root, snapshotLayout: 'source-first', repositoryId: 'two', location: 'two:same.c:9999' }), /exceeds file length/)
    assert.equal(resolveEvidenceFile({ snapshotRoot: root, repositoryId: 'one', location: 'one:same.c:2' }).filePath, path.join(root, 'repository', 'same.c'))
    assert.throws(() => resolveEvidenceFile({ snapshotRoot: root, snapshotLayout: 'source-first', repositoryId: 'two', location: 'one:same.c:2' }), /does not match/)
    assert.throws(() => resolveEvidenceFile({ snapshotRoot: root, snapshotLayout: 'source-first', repositoryId: 'two', location: 'two:../one/same.c:2' }), /escapes/)
    for (const location of ['same.c:2', 'two:same.c', path.join(root, 'two', 'same.c') + ':2']) {
      assert.throws(() => resolveEvidenceFile({ snapshotRoot: root, snapshotLayout: 'source-first', repositoryId: 'two', location }), /repo_id:path:line/)
    }
    assert.throws(() => resolveEvidenceFile({ snapshotRoot: root, snapshotLayout: 'source-first', location: 'two:same.c:2' }), /当前 Run/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('frozen source preview rejects a junction escaping the Run snapshot', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-source-junction-'))
  try {
    const snapshot = path.join(root, 'snapshot'), outside = path.join(root, 'outside')
    await mkdir(path.join(snapshot, 'repo'), { recursive: true })
    await mkdir(outside)
    await writeFile(path.join(outside, 'sample.c'), 'outside snapshot')
    await symlink(outside, path.join(snapshot, 'repo', 'escape'), 'junction')
    await assert.rejects(readEvidenceSnippet({ snapshotRoot: snapshot, snapshotLayout: 'source-first', repositoryId: 'repo', location: 'repo:escape/sample.c:1' }), /escapes/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('expanded context reads only the frozen Run copy and retains the cited line', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-source-context-'))
  try {
    const frozen = path.join(root, 'frozen')
    const workspace = path.join(root, 'workspace')
    await mkdir(path.join(frozen, 'repo'), { recursive: true })
    await mkdir(workspace)
    await writeFile(path.join(frozen, 'repo', 'sample.c'), Array.from({ length: 30 }, (_, index) => `frozen-${index + 1}`).join('\n'))
    await writeFile(path.join(workspace, 'sample.c'), 'workspace-edited')
    const snippet = await readEvidenceSnippet({ cwd: workspace, snapshotRoot: frozen, snapshotLayout: 'source-first', repositoryId: 'repo',
      location: 'repo:sample.c:16-17', contextBefore: 8, contextAfter: 12 })
    assert.deepEqual([snippet.visible_start, snippet.visible_end], [8, 29])
    assert.equal(snippet.lines[0].text, 'frozen-8')
    assert.equal(snippet.lines.find(line => line.number === 16).target, true)
    assert.ok(snippet.lines.every(line => !line.text.includes('workspace-edited')))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('long frozen paths support evidence preview and supplemental integrity without exposing namespace prefixes', async () => {
  const { createHash } = await import('node:crypto')
  const { readSavedSupplementalSources } = await import('../src/source.js')
  const run = await mkdtemp(path.join(os.tmpdir(), 'pangea-long-source-'))
  try {
    const root = path.join(run, 'inputs', 'source')
    const relative = ['src', 'network_' + 'a'.repeat(65), 'transport_' + 'b'.repeat(65), '目录 with space_' + 'c'.repeat(65), 'main.cpp'].join('/')
    const file = path.join(root, 'repo', relative)
    assert.ok(file.length > 260)
    const content = '// frozen\nint marker(void) { return 7; }\n'
    await mkdir(path.toNamespacedPath(path.dirname(file)), { recursive: true })
    await writeFile(path.toNamespacedPath(file), content)
    const options = { snapshotRoot: root, snapshotLayout: 'source-first', repositoryId: 'repo', location: `repo:${relative}:2` }
    const snippet = await readEvidenceSnippet(options)
    assert.equal(snippet.file_path, file)
    assert.equal(snippet.lines.find(line => line.number === 2).text, 'int marker(void) { return 7; }')
    const item = { repo_id: 'repo', path: relative, bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') }
    await writeFile(path.join(run, 'inputs', 'source-supplemental.json'), JSON.stringify({ format_version: 'pangea-source-supplemental-v1', files: [item] }))
    assert.equal((await readSavedSupplementalSources(run))[0].content, content)
    await writeFile(path.toNamespacedPath(file), 'corrupt')
    await assert.rejects(readSavedSupplementalSources(run), /校验失败/)
    // Resolve long paths before enforcing the same symlink/junction boundary.
    const outside = path.join(run, 'outside')
    await mkdir(outside)
    await writeFile(path.join(outside, 'escape.c'), 'outside')
    await symlink(outside, path.toNamespacedPath(path.join(path.dirname(file), 'escape')), 'junction')
    await assert.rejects(readEvidenceSnippet({ ...options, location: `repo:${relative.replace('main.cpp', 'escape/escape.c')}:1` }), /escapes/)
  } finally { await rm(path.toNamespacedPath(run), { recursive: true, force: true }) }
})
