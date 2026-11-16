import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { sourceGit, inspectSource, compareSnapshot, readRepositorySettings } from '../src/repositories/git-source.js'
import { importRepository, repositoryStatus } from '../src/repositories/import.js'
import { repositoryRouteHandler } from '../src/index.js'
import { FaultInjectionService, injectionGit } from '../src/fault-injection.js'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-git-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'source'), dataRoot = path.join(root, 'data'), remote = path.join(root, 'remote.git')
  await mkdir(source); await mkdir(dataRoot)
  await mkdir(path.join(root, '.agents', 'pangea'), { recursive: true }); await writeFile(path.join(root, '.agents', 'pangea', 'dsh.md'), 'fixture')
  await sourceGit(source, ['init', '-b', 'main'])
  await sourceGit(source, ['config', 'user.name', 'Test']); await sourceGit(source, ['config', 'user.email', 'test@example.test'])
  await writeFile(path.join(source, 'target.c'), 'int operation(void) { return 0; }\n')
  await sourceGit(source, ['add', '.']); await sourceGit(source, ['commit', '-m', 'base'])
  const commit = await sourceGit(source, ['rev-parse', 'HEAD'])
  await sourceGit(root, ['clone', '--bare', source, remote]); await sourceGit(source, ['remote', 'add', 'origin', remote])
  const request = async body => {
    const req = Readable.from(body ? [JSON.stringify(body)] : [])
    req.method = body ? 'POST' : 'GET'; req.url = '/api/pangea-companion/repositories?' + new URLSearchParams({ data_root: dataRoot, cwd: root }); req.headers = { 'sec-fetch-site': 'same-origin' }
    let code, result
    await repositoryRouteHandler(req, { writeHead(value) { code = value }, end(value) { result = JSON.parse(value) } })
    return { code, ...result }
  }
  return { root, source, dataRoot, remote, commit, request }
}
test('plain directories import and remain analysable without Git installed', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'plain-source-')); t.after(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'plain'); await mkdir(source); await writeFile(path.join(source, 'x.c'), 'plain')
  const oldPath = process.env.PATH; process.env.PATH = path.join(root, 'no-executables')
  try {
    const result = await importRepository({ dataRoot: path.join(root, 'data'), sourcePath: source, repositoryId: 'plain' })
    assert.equal(result.source.kind, 'folder')
    assert.equal((await repositoryStatus(path.join(root, 'data'))).repositories[0].source.kind, 'folder')
  } finally { process.env.PATH = oldPath }
})
test('Git import preserves branch and dirty files while reporting source identity', async t => {
  const f = await fixture(t)
  await writeFile(path.join(f.source, 'target.c'), 'dirty source')
  const response = await f.request({ source_path: f.source, repository_name: 'target', pipeline_url: 'https://ci.example.test/build' })
  assert.equal(response.code, 200); assert.equal(response.repository.source.kind, 'git'); assert.equal(response.repository.source.dirty, true)
  assert.equal(await sourceGit(f.source, ['branch', '--show-current']), 'main')
  assert.equal(await readFile(path.join(f.source, 'target.c'), 'utf8'), 'dirty source')
  const status = await f.request(); assert.equal(status.repositories[0].settings.pipeline_url, 'https://ci.example.test/build')
  assert.equal(status.repositories[0].source.commit, f.commit)
})
test('Git URL clone selects branch/tag and failed clone does not create a project', async t => {
  const f = await fixture(t)
  await sourceGit(f.source, ['tag', 'analysis-v1']); await sourceGit(f.source, ['push', 'origin', 'analysis-v1'])
  const config = path.join(f.root, 'gitconfig')
  await writeFile(config, `[url "${f.remote.replace(/\\/g, '/')}"]\n  insteadOf = https://fixture.test/repo.git\n`)
  const previous = process.env.GIT_CONFIG_GLOBAL; process.env.GIT_CONFIG_GLOBAL = config
  try {
    const result = await f.request({ git_url: 'https://fixture.test/repo.git', base_ref: 'analysis-v1', repository_name: 'clone' })
    assert.equal(result.code, 200, result.error); assert.equal(result.repository.source.commit, f.commit)
    assert.equal(await sourceGit(f.source, ['branch', '--show-current']), 'main')
    const linked = await f.request({ action: 'configure-repository', repository_name: 'clone', git_url: 'https://fixture.test/repo.git', base_ref: 'analysis-v1' })
    assert.equal(linked.code, 200, linked.error); assert.equal(linked.settings.base_ref, f.commit)
    assert.notEqual(linked.settings.git_path, path.join(f.dataRoot, 'repositories', 'clone'))
    const failure = await f.request({ git_url: 'https://fixture.test/repo.git', base_ref: 'does-not-exist', repository_name: 'failed' })
    assert.equal(failure.code, 400)
    assert.deepEqual((await f.request()).repositories.map(repo => repo.name), ['clone'])
  } finally { if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = previous }
})
test('linked worktree becomes a standalone copy including uncommitted edits', async t => {
  const f = await fixture(t), worktree = path.join(f.root, 'worktree')
  await sourceGit(f.source, ['worktree', 'add', '-b', 'work', worktree])
  await writeFile(path.join(worktree, 'target.c'), 'worktree edits')
  const result = await importRepository({ dataRoot: f.dataRoot, sourcePath: worktree, repositoryId: 'work' })
  const destination = path.join(f.dataRoot, 'repositories', 'work')
  assert.ok((await lstat(path.join(destination, '.git'))).isDirectory())
  assert.equal(result.source.commit, f.commit); assert.equal(result.source.dirty, true)
  assert.equal(await sourceGit(worktree, ['branch', '--show-current']), 'work')
  assert.equal(await readFile(path.join(destination, 'target.c'), 'utf8'), 'worktree edits')
})
test('plain project → link Git → compare analysis snapshot → relocate on target without acknowledgement → generate and push', async t => {
  const f = await fixture(t), plain = path.join(f.root, 'plain'); await mkdir(plain)
  await writeFile(path.join(plain, 'target.c'), 'analysis-only change\n')
  assert.equal((await f.request({ source_path: plain, repository_name: 'target' })).code, 200)
  const configured = await f.request({ action: 'configure-repository', repository_name: 'target', git_path: f.source, base_ref: 'main', personal_branch: 'main', pipeline_url: 'https://ci.example.test/pipeline' })
  assert.equal(configured.code, 200, configured.error)
  const snapshot = path.join(f.dataRoot, 'runs', 'run', 'inputs', 'source', 'target'); await mkdir(snapshot, { recursive: true })
  await writeFile(path.join(snapshot, 'target.c'), 'analysis-only change\n')
  assert.equal((await compareSnapshot(f.source, f.commit, snapshot)).changed_count, 1)
  const run = { run_id: 'run', repositories: ['target'], details: { test_cases: [{ projection_id: 'case/A', title: '失败恢复' }] } }
  const service = new FaultInjectionService({ generate: async ({ record }) => ({ summary: 'test fixture', points: [{ id: 'p', repo_id: 'target' }], profiles: [{ case_key: record.case_keys[0], point_ids: ['p'], steps: ['触发故障'] }], edits: [{ repo_id: 'target', path: 'target.c', before: 'return 0;', after: 'return -1;' }] }) })
  t.after(() => service.dispose())
  const defaults = await service.defaults(f.dataRoot, run)
  assert.equal(defaults.pipeline_url, 'https://ci.example.test/pipeline'); assert.equal(defaults.repositories[0].comparison.changed_count, 1)
  const preview = await service.previewBaseline(f.dataRoot, run, { repositories: defaults.repositories })
  assert.equal(preview[0].comparison.files[0], 'target.c'); assert.equal(preview[0].base_ref, f.commit)
  const input = { case_keys: ['case/A'], provider_id: 'fixture', agent_model: 'fixture' }
  const next = await service.start({ dataRoot: f.dataRoot, run, input }); await Promise.all([...service.active.values()].map(op => op.done))
  const ready = await service.read(f.dataRoot, 'run', next.id)
  assert.equal(ready.status, 'ready', ready.error)
  assert.equal(ready.source_repositories[0].comparison.changed_count, 1)
  const pushed = await service.push(f.dataRoot, 'run', next.id)
  assert.equal(pushed.status, 'pushed', pushed.error)
  assert.equal(await sourceGit(f.remote, ['rev-parse', `refs/heads/${pushed.branch}`]), pushed.repositories[0].commit)
  assert.equal(await readFile(path.join(f.dataRoot, 'repositories', 'target', 'target.c'), 'utf8'), 'analysis-only change\n')
  assert.equal(await sourceGit(f.source, ['rev-parse', 'HEAD']), pushed.repositories[0].commit)
  assert.equal((await readRepositorySettings(f.dataRoot, 'target')).base_ref, f.commit)
  assert.equal((await f.request({ action: 'configure-repository', repository_name: 'target', pipeline_url: 'https://ci.example.test/new' })).code, 200)
  assert.equal((await service.defaults(f.dataRoot, run)).pipeline_url, 'https://ci.example.test/new')
  assert.equal((await service.read(f.dataRoot, 'run', next.id)).pipeline_url, 'https://ci.example.test/pipeline')
})


test('snapshot separates CRLF-only differences without hiding edits, missing files, BOM or binary data', async t => {
  const f = await fixture(t), snapshot = path.join(f.root, 'snapshot-eol')
  await mkdir(snapshot)
  await sourceGit(f.source, ['config', 'core.autocrlf', 'false'])
  const originals = {
    'text.c': Buffer.from('first\nsecond\n'),
    'bom.c': Buffer.from('\ufefffirst\n'),
    'binary.dat': Buffer.from([0, 10, 65]),
    'invalid.dat': Buffer.from([255, 10, 65]),
  }
  for (const [name, bytes] of Object.entries(originals)) await writeFile(path.join(f.source, name), bytes)
  await sourceGit(f.source, ['add', '.'])
  await sourceGit(f.source, ['commit', '-m', 'line ending fixtures'])
  const ref = await sourceGit(f.source, ['rev-parse', 'HEAD'])
  const snapshots = {
    'text.c': Buffer.from('first\r\nsecond\r\n'),
    'bom.c': Buffer.from('\ufefffirst\r\n'),
    'binary.dat': Buffer.from([0, 13, 10, 65]),
    'invalid.dat': Buffer.from([255, 13, 10, 65]),
    'missing.c': Buffer.from('new\r\n'),
  }
  for (const [name, bytes] of Object.entries(snapshots)) await writeFile(path.join(snapshot, name), bytes)
  const result = await compareSnapshot(f.source, ref, snapshot)
  assert.equal(result.eol_only_count, 2)
  assert.equal(result.changed_count, 3)
  assert.deepEqual(result.eol_only_files.sort(), ['bom.c', 'text.c'])
  for (const [name, bytes] of Object.entries(snapshots)) assert.deepEqual(await readFile(path.join(snapshot, name)), bytes)
  await writeFile(path.join(snapshot, 'text.c'), 'first\r\nchanged\r\n')
  const changed = await compareSnapshot(f.source, ref, snapshot)
  assert.equal(changed.changed_count, 4)
  assert.equal(changed.eol_only_count, 1)
  await writeFile(path.join(snapshot, 'bom.c'), 'first\r\n')
  assert.equal((await compareSnapshot(f.source, ref, snapshot)).changed_count, 5)
})

test('Git wrappers enable longpaths per invocation without changing repository configuration', async t => {
  const f = await fixture(t)
  await sourceGit(f.source, ['config', '--local', 'core.longpaths', 'false'])
  // Reproduce the incident: a normal-length repository root with a deep tracked file.
  // A >260-character repository root hits a separate Git chdir/Windows spawn limit.
  const relative = path.join(...Array.from({ length: 5 }, (_, i) => `tracked-${i}-${'x'.repeat(20)}`), 'target.c')
  await mkdir(path.dirname(path.join(f.source, relative)), { recursive: true })
  await writeFile(path.join(f.source, relative), 'int deep(void) { return 0; }\n')
  await sourceGit(f.source, ['add', '.'])
  await sourceGit(f.source, ['commit', '-m', 'deep tracked file'])
  const commit = await sourceGit(f.source, ['rev-parse', 'HEAD'])
  for (const git of [sourceGit, injectionGit]) {
    assert.equal(await git(f.source, ['config', '--get', 'core.longpaths']), 'true')
    assert.equal(await git(f.source, ['config', '--local', '--get', 'core.longpaths']), 'false')
    const target = path.join(f.root, ...Array.from({ length: 3 }, (_, i) => `workspace-${i}-${'x'.repeat(20)}`))
    assert.ok(target.length < 240, `repository root must stay below MAX_PATH: ${target.length}`)
    assert.ok(path.join(target, relative).length > 280, 'tracked file must exceed MAX_PATH')
    await mkdir(path.dirname(target), { recursive: true })
    await git(f.root, ['clone', '--no-checkout', '--', f.source, target])
    await git(target, ['checkout', '--detach', commit])
    assert.equal(await git(target, ['status', '--porcelain']), '')
    assert.equal(await git(target, ['branch', '--show-current']), '')
    assert.ok((await readFile(path.join(target, relative))).length > 0)
    await rm(target, { recursive: true, force: true })
  }
})


test('current source distinguishes an untracked Agent directory from tracked source edits', async t => {
  const f = await fixture(t)
  await mkdir(path.join(f.source, '.cac'))
  await writeFile(path.join(f.source, '.cac', 'session.txt'), 'fixture')
  const untracked = await inspectSource(f.source)
  assert.equal(untracked.dirty, true)
  assert.equal(untracked.tracked_changes, false)
  assert.equal(untracked.untracked_files, true)
  const { sourceLabel } = await import('../src/repository-settings-view.js')
  assert.match(sourceLabel(untracked), /有未跟踪文件/)
  assert.doesNotMatch(sourceLabel(untracked), /有未提交修改/)
  await writeFile(path.join(f.source, 'target.c'), 'changed source')
  assert.match(sourceLabel(await inspectSource(f.source)), /有未提交修改.*有未跟踪文件/)
})
