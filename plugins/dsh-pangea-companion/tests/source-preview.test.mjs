import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
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
    assert.equal(resolveEvidenceFile({ snapshotRoot: root, repositoryId: 'one', location: 'one:same.c:2' }).filePath, path.join(root, 'repository', 'same.c'))
    assert.throws(() => resolveEvidenceFile({ snapshotRoot: root, snapshotLayout: 'source-first', repositoryId: 'two', location: 'one:same.c:2' }), /does not match/)
    assert.throws(() => resolveEvidenceFile({ snapshotRoot: root, snapshotLayout: 'source-first', repositoryId: 'two', location: 'two:../one/same.c:2' }), /escapes/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
