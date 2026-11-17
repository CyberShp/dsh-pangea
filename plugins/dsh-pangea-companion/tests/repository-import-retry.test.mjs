import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { importRepository, repositoryStatus } from '../src/repositories/import.js'
import { sourceGit } from '../src/repositories/git-source.js'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-import-retry-'))
  const source = path.join(root, 'source'), remote = path.join(root, 'remote.git')
  const dataRoot = path.join(root, 'data'), config = path.join(root, 'gitconfig')
  const modeFile = path.join(root, 'filter-mode'), script = path.join(root, 'filter.cjs')
  const previous = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM }
  process.env.GIT_CONFIG_GLOBAL = config
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(root, { recursive: true, force: true })
  })
  await writeFile(config, '')
  await mkdir(source)
  await sourceGit(source, ['init', '-b', 'main'])
  await sourceGit(source, ['config', 'user.name', 'Import fixture'])
  await sourceGit(source, ['config', 'user.email', 'fixture@example.test'])
  await sourceGit(source, ['config', 'core.autocrlf', 'false'])
  await writeFile(path.join(source, '.gitattributes'), 'target.c filter=import-fixture\n')
  await writeFile(path.join(source, 'target.c'), 'int original;\n')
  await sourceGit(source, ['add', '.'])
  await sourceGit(source, ['commit', '-m', 'source'])
  await sourceGit(source, ['branch', 'other'])
  await sourceGit(root, ['clone', '--bare', '--', source, remote])
  const commit = await sourceGit(source, ['rev-parse', 'HEAD'])
  await writeFile(script, `const fs = require('node:fs');
const bytes = fs.readFileSync(0);
const mode = fs.readFileSync(${JSON.stringify(modeFile)}, 'utf8');
if (process.argv[2] === 'smudge' && mode === 'fail') { process.stderr.write('fixture checkout failure'); process.exit(17); }
process.stdout.write(process.argv[2] === 'smudge' && mode === 'dirty' ? Buffer.from('int transformed;\\n') : bytes);
`)
  // Write the fixture-owned file explicitly: on Windows sourceGit redirects
  // GIT_CONFIG_GLOBAL to a disposable longpaths overlay for each invocation.
  const command = `"${process.execPath.replaceAll('\\', '/')}" "${script.replaceAll('\\', '/')}"`
  await sourceGit(root, ['config', '--file', config, `url.${remote.replaceAll('\\', '/')}.insteadOf`, 'https://import-fixture.test/repo.git'])
  await sourceGit(root, ['config', '--file', config, 'filter.import-fixture.smudge', `${command} smudge`])
  await sourceGit(root, ['config', '--file', config, 'filter.import-fixture.clean', `${command} clean`])
  await sourceGit(root, ['config', '--file', config, 'filter.import-fixture.required', 'true'])
  const input = { dataRoot, repositoryId: 'project', gitUrl: 'https://import-fixture.test/repo.git', baseRef: 'main' }
  // Verify the rewrite without contacting the synthetic HTTPS hostname.
  assert.equal(await sourceGit(root, ['ls-remote', '--get-url', input.gitUrl]), remote.replaceAll('\\', '/'))
  assert.equal(await sourceGit(root, ['config', '--get', 'filter.import-fixture.smudge']), `${command} smudge`)
  const setMode = value => writeFile(modeFile, value)
  const pending = async () => {
    const paths = (await readdir(path.join(dataRoot, 'repositories'))).filter(name => name.startsWith('.pangea-import-'))
    return paths.map(name => path.join(dataRoot, 'repositories', name))
  }
  const journals = async () => {
    const directory = path.join(dataRoot, '.pangea', 'repository-imports')
    return Promise.all((await readdir(directory)).filter(name => name.endsWith('.json')).map(async name => ({
      path: path.join(directory, name), data: JSON.parse(await readFile(path.join(directory, name), 'utf8')),
    })))
  }
  await setMode('pass')
  return { root, source, remote, dataRoot, config, input, commit, setMode, pending, journals }
}

test('checkout failure retains downloaded history and repaired checkout retries offline without cloning again', async t => {
  const f = await fixture(t)
  await f.setMode('fail')
  await assert.rejects(importRepository(f.input), error => {
    assert.match(error.message, /fixture checkout failure/)
    assert.match(error.message, /已保留下载的仓库/)
    assert.equal(error.gitDiagnostic.subcommand, 'checkout')
    assert.notEqual(error.gitDiagnostic.exit_code, 0)
    return true
  })
  const [staging] = await f.pending()
  assert.ok(staging)
  assert.equal(await sourceGit(staging, ['rev-parse', 'HEAD']), f.commit)
  const [{ data }] = await f.journals()
  assert.equal(data.status, 'failed')
  assert.equal(data.phase, 'checkout-and-verify')
  assert.equal(data.clone_complete, true)
  assert.equal(data.git.subcommand, 'checkout')
  assert.equal(data.git.lfs_skip_smudge, '1')
  assert.deepEqual((await repositoryStatus(f.dataRoot)).repositories, [])
  assert.equal((await repositoryStatus(f.dataRoot)).onboarding_required, true)
  await f.setMode('pass')
  await rename(f.remote, `${f.remote}.offline`)
  // A failed checkout can leave an empty index plus untracked partial files.
  // Repair is explicit here; the importer must not overwrite unknown edits.
  await sourceGit(staging, ['restore', '--source=HEAD', '--staged', '--worktree', ':/'])
  const imported = await importRepository(f.input)
  assert.equal(imported.source.commit, f.commit)
  assert.equal(imported.source.dirty, false)
  assert.equal(await readFile(path.join(f.dataRoot, 'repositories', 'project', 'target.c'), 'utf8'), 'int original;\n')
  assert.deepEqual(await f.pending(), [])
  assert.equal((await f.journals())[0].data.status, 'completed')
  assert.deepEqual((await repositoryStatus(f.dataRoot)).repositories.map(repo => repo.name), ['project'])
})

test('validation failure preserves precise diagnostics and retained edits across retries', async t => {
  const f = await fixture(t)
  await f.setMode('dirty')
  await assert.rejects(importRepository(f.input), error => {
    assert.equal(error.code, 'GIT_CHECKOUT_INCOMPLETE')
    assert.match(error.message, /target\.c/)
    return true
  })
  const [staging] = await f.pending()
  const [{ data }] = await f.journals()
  assert.equal(data.checkout.head_tree, data.checkout.index_tree)
  assert.ok(data.checkout.status_entries.some(entry => entry.path === 'target.c' && entry.status === ' M'))
  await writeFile(path.join(staging, 'target.c'), 'user retained change\n')
  await writeFile(path.join(staging, 'notes.txt'), 'user notes\n')
  await f.setMode('pass')
  await rename(f.remote, `${f.remote}.offline`)
  await assert.rejects(importRepository(f.input), { code: 'GIT_CHECKOUT_INCOMPLETE' })
  assert.equal(await readFile(path.join(staging, 'target.c'), 'utf8'), 'user retained change\n')
  assert.equal(await readFile(path.join(staging, 'notes.txt'), 'utf8'), 'user notes\n')
  // An explicit repair by the test owner, never an automatic application action.
  await sourceGit(staging, ['restore', '--source=HEAD', '--worktree', '--', 'target.c'])
  await rm(path.join(staging, 'notes.txt'))
  assert.equal((await importRepository(f.input)).source.dirty, false)
})

test('failed clone retains error diagnostics without publishing a project', async t => {
  const f = await fixture(t)
  await rename(f.remote, `${f.remote}.offline`)
  await assert.rejects(importRepository(f.input), error => {
    assert.equal(error.gitDiagnostic.subcommand, 'clone')
    return true
  })
  assert.deepEqual(await f.pending(), [])
  const [{ data }] = await f.journals()
  assert.equal(data.phase, 'clone')
  assert.equal(data.clone_complete, false)
  assert.equal(data.git.subcommand, 'clone')
  assert.deepEqual((await repositoryStatus(f.dataRoot)).repositories, [])
  assert.equal((await repositoryStatus(f.dataRoot)).onboarding_required, true)
})

test('a different branch does not reuse the retained checkout', async t => {
  const f = await fixture(t)
  await f.setMode('dirty')
  await assert.rejects(importRepository(f.input), { code: 'GIT_CHECKOUT_INCOMPLETE' })
  const [retained] = await f.pending()
  await writeFile(path.join(retained, 'keep.txt'), 'do not reuse or remove\n')
  await f.setMode('pass')
  const imported = await importRepository({ ...f.input, baseRef: 'other' })
  assert.equal(imported.source.branch, 'other')
  assert.equal(imported.source.dirty, false)
  assert.deepEqual(await f.pending(), [retained])
  assert.equal(await readFile(path.join(retained, 'keep.txt'), 'utf8'), 'do not reuse or remove\n')
  assert.equal((await f.journals()).length, 2)
})

test('a different URL does not reuse the retained checkout', async t => {
  const f = await fixture(t)
  await f.setMode('dirty')
  await assert.rejects(importRepository(f.input), { code: 'GIT_CHECKOUT_INCOMPLETE' })
  const [retained] = await f.pending()
  await writeFile(path.join(retained, 'keep.txt'), 'do not reuse or remove\n')
  await sourceGit(f.root, ['config', '--file', f.config, '--add', `url.${f.remote.replaceAll('\\', '/')}.insteadOf`, 'https://import-fixture.test/alternative.git'])
  await f.setMode('pass')
  const imported = await importRepository({ ...f.input, gitUrl: 'https://import-fixture.test/alternative.git' })
  assert.equal(imported.source.dirty, false)
  assert.deepEqual(await f.pending(), [retained])
  assert.equal(await readFile(path.join(retained, 'keep.txt'), 'utf8'), 'do not reuse or remove\n')
})

test('missing retained ownership journal never causes cleanup of the checkout', async t => {
  const f = await fixture(t)
  await f.setMode('dirty')
  await assert.rejects(importRepository(f.input), { code: 'GIT_CHECKOUT_INCOMPLETE' })
  const [retained] = await f.pending()
  await writeFile(path.join(retained, 'keep.txt'), 'user content\n')
  await rm((await f.journals())[0].path)
  await assert.rejects(importRepository(f.input), /已保留/)
  assert.equal(await readFile(path.join(retained, 'keep.txt'), 'utf8'), 'user content\n')
})

test('damaged retained ownership journal never causes cleanup of the checkout', async t => {
  const f = await fixture(t)
  await f.setMode('dirty')
  await assert.rejects(importRepository(f.input), { code: 'GIT_CHECKOUT_INCOMPLETE' })
  const [retained] = await f.pending()
  await writeFile(path.join(retained, 'keep.txt'), 'user content\n')
  await writeFile((await f.journals())[0].path, '{invalid json')
  await assert.rejects(importRepository(f.input), /已保留/)
  assert.equal(await readFile(path.join(retained, 'keep.txt'), 'utf8'), 'user content\n')
})
