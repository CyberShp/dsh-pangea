import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { sourceGit, verifyImportedCheckout } from '../src/repositories/git-source.js'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-checkout-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await sourceGit(root, ['init', '-b', 'main'])
  await sourceGit(root, ['config', 'user.name', 'Checkout Test'])
  await sourceGit(root, ['config', 'user.email', 'checkout@example.test'])
  await sourceGit(root, ['config', 'core.autocrlf', 'false'])
  await writeFile(path.join(root, 'source.c'), 'int operation(void) { return 0; }\n')
  await writeFile(path.join(root, 'missing.c'), 'int other(void) { return 1; }\n')
  await sourceGit(root, ['add', '.'])
  await sourceGit(root, ['commit', '-m', 'fixture'])
  return root
}

test('checkout verification accepts clean worktrees including configured CRLF conversion', async t => {
  const root = await fixture(t)
  await verifyImportedCheckout(root)
  await sourceGit(root, ['config', 'core.autocrlf', 'true'])
  await rm(path.join(root, 'source.c'))
  await sourceGit(root, ['checkout', '--', 'source.c'])
  assert.match(await readFile(path.join(root, 'source.c'), 'utf8'), /\r\n$/)
  await verifyImportedCheckout(root)
})

test('fresh successful checkout reports non-normalized historical blobs instead of blaming LFS', async t => {
  const root = await fixture(t)
  await writeFile(path.join(root, 'historical.c'), 'first\r\nsecond\r\n')
  await sourceGit(root, ['add', 'historical.c'])
  await sourceGit(root, ['commit', '-m', 'historical CRLF blob'])
  await writeFile(path.join(root, '.gitattributes'), '*.c text eol=lf\n')
  await sourceGit(root, ['add', '.gitattributes'])
  await sourceGit(root, ['commit', '-m', 'normalization policy without rewriting old blobs'])
  const cloned = path.join(root, 'clone')
  await sourceGit(root, ['clone', '--no-checkout', '--', root, cloned])
  await sourceGit(cloned, ['checkout', 'main'])
  await assert.rejects(verifyImportedCheckout(cloned), error => {
    assert.equal(error.code, 'GIT_CHECKOUT_INCOMPLETE')
    assert.equal(error.checkoutDiagnostic.head_tree, error.checkoutDiagnostic.index_tree)
    assert.deepEqual(error.checkoutDiagnostic.status_entries, [{ status: ' M', path: 'historical.c' }])
    assert.match(error.message, /historical\.c/)
    assert.doesNotMatch(error.message, /LFS|504/)
    return true
  })
})

test('Git checkout passes the LFS skip environment to its filter without downloading', async t => {
  const root = await fixture(t)
  const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}\nsize 1234\n`
  await writeFile(path.join(root, '.gitattributes'), 'large.dat filter=pangea-lfs-probe -text\n')
  await writeFile(path.join(root, 'large.dat'), pointer)
  await sourceGit(root, ['add', '.gitattributes', 'large.dat'])
  await sourceGit(root, ['commit', '-m', 'pointer fixture'])
  const script = path.join(root, 'smudge.cjs'), marker = path.join(root, 'smudge-env.json')
  await writeFile(script, `const fs = require('node:fs');\nconst skip = process.env.GIT_LFS_SKIP_SMUDGE;\nfs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ skip }));\nif (skip !== '1') { process.stderr.write('download would have been attempted'); process.exit(17); }\nprocess.stdout.write(fs.readFileSync(0));\n`)
  const cloned = path.join(root, 'clone')
  await sourceGit(root, ['clone', '--no-checkout', '--', root, cloned])
  const filterCommand = `${JSON.stringify(process.execPath.replaceAll('\\', '/'))} ${JSON.stringify(script.replaceAll('\\', '/'))}`
  await sourceGit(cloned, ['config', 'filter.pangea-lfs-probe.smudge', filterCommand])
  await sourceGit(cloned, ['config', 'filter.pangea-lfs-probe.clean', filterCommand])
  await sourceGit(cloned, ['config', 'filter.pangea-lfs-probe.required', 'true'])
  await sourceGit(cloned, ['checkout', 'main'])
  assert.deepEqual(JSON.parse(await readFile(marker, 'utf8')), { skip: '1' })
  assert.equal(await readFile(path.join(cloned, 'large.dat'), 'utf8'), pointer)
  await verifyImportedCheckout(cloned)
})

test('checkout failure identifies modified, missing and untracked files without changing their content', async t => {
  const root = await fixture(t)
  await writeFile(path.join(root, 'source.c'), 'modified source\n')
  await rm(path.join(root, 'missing.c'))
  const extra = 'untracked 中文 file.txt'
  await writeFile(path.join(root, extra), 'keep me')
  await assert.rejects(verifyImportedCheckout(root), error => {
    assert.equal(error.code, 'GIT_CHECKOUT_INCOMPLETE')
    assert.equal(error.checkoutDiagnostic.head_tree, error.checkoutDiagnostic.index_tree)
    assert.deepEqual(error.checkoutDiagnostic.status_entries, [
      { status: ' D', path: 'missing.c' },
      { status: ' M', path: 'source.c' },
      { status: '??', path: extra },
    ])
    assert.match(error.message, /缺失\/删除.*missing\.c/)
    assert.match(error.message, /修改.*source\.c/)
    assert.match(error.message, /未跟踪.*untracked 中文 file/)
    assert.doesNotMatch(error.message, /请重新导入/)
    return true
  })
  assert.equal(await readFile(path.join(root, 'source.c'), 'utf8'), 'modified source\n')
  assert.equal(await readFile(path.join(root, extra), 'utf8'), 'keep me')
})

test('index mismatch still collects status instead of short-circuiting the diagnosis', async t => {
  const root = await fixture(t)
  await sourceGit(root, ['read-tree', '--empty'])
  await assert.rejects(verifyImportedCheckout(root), error => {
    assert.equal(error.code, 'GIT_CHECKOUT_INCOMPLETE')
    assert.notEqual(error.checkoutDiagnostic.head_tree, error.checkoutDiagnostic.index_tree)
    assert.equal(error.checkoutDiagnostic.status_entry_count, 4)
    assert.match(error.message, /索引与 HEAD 不一致/)
    return true
  })
  assert.equal(await sourceGit(root, ['ls-files']), '')
  assert.match(await readFile(path.join(root, 'source.c'), 'utf8'), /operation/)
})

test('NUL status parsing preserves rename destinations and original paths containing whitespace', async t => {
  const root = await fixture(t)
  const renamed = process.platform === 'win32' ? 'renamed 中文 file.c' : 'renamed\n中文\tfile.c'
  await sourceGit(root, ['mv', 'source.c', renamed])
  await assert.rejects(verifyImportedCheckout(root), error => {
    assert.equal(error.checkoutDiagnostic.status_entry_count, 1)
    assert.deepEqual(error.checkoutDiagnostic.status_entries, [{ status: 'R ', path: renamed, original_path: 'source.c' }])
    assert.match(error.message, /重命名/)
    if (process.platform !== 'win32') {
      assert.match(error.message, /\\n中文\\tfile/)
      assert.ok(!error.message.includes('\n'))
    }
    return true
  })
})

test('failed Git verification retains the primary command error and safe process diagnostics', async t => {
  const root = await fixture(t)
  await writeFile(path.join(root, '.git', 'index.lock'), 'test-owned lock')
  await assert.rejects(verifyImportedCheckout(root), error => {
    assert.match(error.message, /index\.lock/)
    assert.notEqual(error.code, 'GIT_CHECKOUT_INCOMPLETE')
    assert.equal(error.gitDiagnostic.subcommand, 'write-tree')
    assert.equal(typeof error.gitDiagnostic.exit_code, 'number')
    assert.ok(error.gitDiagnostic.exit_code !== 0)
    assert.equal(error.gitDiagnostic.lfs_skip_smudge, '1')
    assert.ok(error.gitDiagnostic.elapsed_ms >= 0)
    assert.deepEqual(Object.keys(error.gitDiagnostic).sort(), ['elapsed_ms', 'exit_code', 'lfs_skip_smudge', 'signal', 'subcommand'])
    assert.ok(error.checkoutDiagnostic.head_tree)
    assert.equal(error.checkoutDiagnostic.index_tree, null)
    return true
  })
})

test('large status diagnostics retain a count and bounded path samples', async t => {
  const root = await fixture(t)
  await Promise.all(Array.from({ length: 105 }, (_, i) => writeFile(path.join(root, `untracked-${i}.txt`), 'fixture')))
  await assert.rejects(verifyImportedCheckout(root), error => {
    assert.equal(error.checkoutDiagnostic.status_entry_count, 105)
    assert.equal(error.checkoutDiagnostic.status_entries.length, 100)
    assert.equal(error.checkoutDiagnostic.status_entries_truncated, true)
    assert.match(error.message, /其余见诊断记录/)
    return true
  })
})
