import { writeFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { FaultInjectionService, injectionGit, applyInjectionEdits, injectionPrompt } from '../src/fault-injection.js'

const exec = promisify(execFile)
const original = '#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\nint main(void) { puts("ok"); return 0; }\n'
const instrumented = `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
  const char *faults = getenv("PANGEA_FI");
  if (faults && strchr(faults, 'A')) {
    puts("hit:A queue_failed");
    if (strchr(faults, 'C')) puts("hit:C cleanup_failed");
    return 0;
  }
  if (faults && strchr(faults, 'B')) { puts("hit:B io_failed"); return 0; }
  puts("ok"); return 0;
}
`
async function fixture(t, { multi = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-injection-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dataRoot = path.join(root, 'data'); await mkdir(dataRoot)
  const repositories = []
  for (const repo_id of multi ? ['target', 'helper'] : ['target']) {
    const source = path.join(root, repo_id), remote = path.join(root, `${repo_id}.git`)
    await mkdir(source)
    await injectionGit(source, ['init', '-b', 'main'])
    await injectionGit(source, ['config', 'user.name', 'Fixture'])
    await injectionGit(source, ['config', 'user.email', 'fixture@example.test'])
    await writeFile(path.join(source, 'main.c'), original)
    await injectionGit(source, ['add', 'main.c'])
    await injectionGit(source, ['commit', '-m', 'baseline'])
    const commit = await injectionGit(source, ['rev-parse', 'HEAD'])
    await injectionGit(root, ['init', '--bare', remote])
    await injectionGit(source, ['remote', 'add', 'origin', remote])
    await injectionGit(source, ['push', 'origin', 'main'])
    await mkdir(path.join(dataRoot, '.pangea', 'repository-settings'), { recursive: true })
    await writeFile(path.join(dataRoot, '.pangea', 'repository-settings', `${repo_id}.json`), JSON.stringify({ git_path: source, personal_branch: 'main', remote: 'origin' }))
    repositories.push({ repo_id, source_path: source, source_root: source, remote_path: remote, git: { commit }, base_ref: commit })
  }
  const cases = ['A', 'B', 'C'].map(letter => ({ projection_id: `unit/CASE-${letter}`, test_case_id: `unit/CASE-${letter}`, title: `场景 ${letter}`, execution_readiness: 'needs_instrumentation' }))
  const run = { run_id: 'run-fi', repositories: repositories.map(repo => repo.repo_id), source_snapshot: { repositories }, details: { test_cases: cases } }
  const input = { case_keys: cases.map(item => item.test_case_id), repositories, provider_id: 'pangea-opencode', agent_model: 'fixture', branch_prefix: 'tester/fault' }
  return { root, dataRoot, repositories, run, input }
}
function generated(record) {
  return { summary: '按用例控制故障', points: [{ id: 'A', trigger_scope: { current_input: 'fixture operation argument', excluded_inputs: ['previous operations'] }, repo_id: 'target', path: 'main.c', trigger: '队列创建', times: 1, action: '申请失败', enable: 'PANGEA_FI=A', disable: '清空 PANGEA_FI', observe: 'hit:A' }],
    profiles: record.case_keys.map(case_key => ({ case_key, point_ids: ['A'], safety: { setup: [':'], negative_steps: [':'], negative_point_ids: ['A'], cleanup: [':'], cleanup_verify: [':'] }, steps: ['开启目标桩', '执行业务', '检查命中并撤销'] })),
    edits: record.repositories.map(repo => ({ repo_id: repo.repo_id, path: 'main.c', before: original, after: instrumented })), limitations: [] }
}
async function wait(service) { await Promise.all([...service.active.values()].map(operation => operation.done)) }

test('real Git + compiled C: generate, inspect, push exact commit, reopen and record verification', async t => {
  const f = await fixture(t)
  const service = new FaultInjectionService({ generate: async ({ record, prompt }) => {
    assert.match(prompt, /保留原有错误处理/); return generated(record)
  } })
  const task = await service.start({ ...f, cwd: f.root })
  await wait(service)
  const ready = await service.read(f.dataRoot, f.run.run_id, task.id)
  assert.equal(ready.status, 'ready', ready.error)
  assert.equal(await readFile(path.join(f.repositories[0].source_path, 'main.c'), 'utf8'), original)
  const repo = ready.repositories[0], binary = path.join(f.root, process.platform === 'win32' ? 'sample.exe' : 'sample')
  let compiler = true
  try { await exec('cc', ['--version']) } catch (error) { if (error.code !== 'ENOENT') throw error; compiler = false }
  await t.test('compiled fixture checks A/B blocking, dependent faults and recovery', { skip: !compiler && 'C compiler is not installed; Git round trip still runs' }, async () => {
    await exec('cc', [path.join(repo.path, 'main.c'), '-o', binary])
    // C text-mode stdout uses CRLF on Windows; compare the same ordered output on every OS.
    const run = async faults => (await exec(binary, [], { env: { ...process.env, PANGEA_FI: faults } })).stdout.replace(/\r\n/g, '\n').trim()
    assert.equal(await run(''), 'ok')
    assert.equal(await run('A'), 'hit:A queue_failed')
    assert.equal(await run('B'), 'hit:B io_failed')
    assert.equal(await run('AB'), 'hit:A queue_failed') // A prevents reaching B.
    assert.equal(await run('AC'), 'hit:A queue_failed\nhit:C cleanup_failed') // C needs A.
    assert.equal(await run(''), 'ok')
  })
  assert.equal(repo.commit, null)
  assert.equal(await injectionGit(repo.path, ['branch', '--show-current']), '')
  const pushed = await service.push(f.dataRoot, f.run.run_id, task.id)
  assert.equal(pushed.status, 'pushed', pushed.error)
  const wantedCommit = pushed.repositories[0].commit
  assert.equal(await injectionGit(f.repositories[0].source_path, ['rev-parse', 'HEAD']), wantedCommit)
  assert.equal(await injectionGit(f.repositories[0].remote_path, ['rev-parse', `refs/heads/${repo.branch}`]), wantedCommit)
  const reopened = new FaultInjectionService()
  assert.equal((await reopened.list(f.dataRoot, f.run.run_id))[0].status, 'pushed')
  const recorded = await reopened.recordVerification(f.dataRoot, f.run.run_id, task.id, { build: { package_id: 'personal-001', url: 'https://ci.example.test/1' }, verification: { case_key: f.input.case_keys[0], result: 'passed', hits: 'A=1', notes: '恢复正常' } })
  assert.equal(recorded.verification[0].build.commits[0].commit, wantedCommit)
  assert.equal(recorded.verification[0].result, 'passed')
  assert.equal(f.run.details.test_cases[0].execution_readiness, 'needs_instrumentation')
})

test('two tasks share one personal branch but never writable checkouts', async t => {
  const f = await fixture(t), service = new FaultInjectionService({ generate: async ({ record }) => generated(record) })
  const tasks = await Promise.all([service.start(f), service.start(f)])
  await wait(service)
  const [a, b] = await Promise.all(tasks.map(task => service.read(f.dataRoot, f.run.run_id, task.id)))
  assert.equal(a.status, 'ready', a.error); assert.equal(b.status, 'ready', b.error)
  assert.equal(a.branch, b.branch); assert.notEqual(a.repositories[0].path, b.repositories[0].path)
  assert.equal(a.repositories[0].base_commit, b.repositories[0].base_commit)
  assert.equal(await injectionGit(f.repositories[0].source_path, ['status', '--porcelain']), '')
})

test('multi-repository partial push is recorded and retry pushes only the unfinished repository', async t => {
  const f = await fixture(t, { multi: true }); let fail = true; const calls = []
  const service = new FaultInjectionService({ generate: async ({ record }) => generated(record), git: async (cwd, args, signal) => {
    if (args[0] === 'push' && args[1] === 'origin') { calls.push(path.basename(cwd)); if (path.basename(cwd) === 'helper' && fail) throw new Error('simulated remote unavailable') }
    return injectionGit(cwd, args, signal)
  } })
  const task = await service.start(f); await wait(service)
  const partial = await service.push(f.dataRoot, f.run.run_id, task.id)
  assert.equal(partial.status, 'ready'); assert.equal(partial.repositories[0].pushed, true); assert.equal(partial.repositories[1].pushed, false)
  fail = false
  assert.equal((await service.push(f.dataRoot, f.run.run_id, task.id)).status, 'pushed')
  assert.deepEqual(calls, ['target', 'helper', 'helper'])
})

test('unmatched edits fail only the injection task; original case and source stay available', async t => {
  const f = await fixture(t), service = new FaultInjectionService({ generate: async ({ record }) => ({ ...generated(record), edits: [{ repo_id: 'target', path: 'main.c', before: 'not present', after: 'oops' }] }) })
  const task = await service.start(f); await wait(service)
  const failed = await service.read(f.dataRoot, f.run.run_id, task.id)
  assert.equal(failed.status, 'failed'); assert.match(failed.error, /未唯一匹配/)
  assert.equal(await readFile(path.join(f.repositories[0].source_path, 'main.c'), 'utf8'), original)
  assert.equal(f.run.details.test_cases.length, 3)
})

test('generation cancellation terminates the task and keeps the captured inputs', async t => {
  const f = await fixture(t); let began
  const started = new Promise(resolve => { began = resolve })
  const service = new FaultInjectionService({ generate: async ({ signal }) => new Promise((resolve, reject) => {
    began(); signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }) })
  const task = await service.start(f); await started
  const cancelled = await service.cancel(f.dataRoot, f.run.run_id, task.id)
  assert.equal(cancelled.status, 'cancelled'); assert.equal(service.busy(), false); assert.equal(cancelled.case_keys.length, 3)
})

test('edits preserve CRLF, create support files and reject traversal/symlink writes before applying', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-edits-')); t.after(() => rm(root, { recursive: true, force: true }))
  const repo = path.join(root, 'repo'); await mkdir(repo)
  await writeFile(path.join(repo, 'a.c'), 'one\r\ntwo\r\n')
  await applyInjectionEdits(repo, [{ path: 'a.c', before: 'one\ntwo', after: 'one\nthree' }, { path: 'support/fi.h', before: null, after: '/* support */' }])
  assert.equal(await readFile(path.join(repo, 'a.c'), 'utf8'), 'one\r\nthree\r\n')
  assert.equal(await readFile(path.join(repo, 'support/fi.h'), 'utf8'), '/* support */')
  await assert.rejects(applyInjectionEdits(repo, [{ path: '../outside', before: null, after: 'oops' }]), /仓库/)
  await assert.rejects(applyInjectionEdits(repo, [{ path: '.git/config', before: null, after: 'oops' }]), /仓库/)
  await symlink(root, path.join(repo, 'linked'), 'junction')
  await assert.rejects(applyInjectionEdits(repo, [{ path: 'linked/outside', before: null, after: 'oops' }]), /越界|普通目录/)
})

test('invalid case selection is rejected before creating a generation task', async t => {
  const f = await fixture(t), service = new FaultInjectionService()
  await assert.rejects(service.start({ ...f, input: { ...f.input, case_keys: ['missing'] } }), /用例不存在/)
  assert.equal((await service.list(f.dataRoot, f.run.run_id)).length, 0)
})

test('missing execution profiles retain the authored output without committing a partial result', async t => {
  const f = await fixture(t), service = new FaultInjectionService({ generate: async ({ record }) => ({ ...generated(record), profiles: [] }) })
  const task = await service.start(f); await wait(service)
  const failed = await service.read(f.dataRoot, f.run.run_id, task.id)
  assert.equal(failed.status, 'failed'); assert.match(failed.error, /执行说明/)
  const raw = JSON.parse(await readFile(path.join(await service.directory(f.dataRoot, f.run.run_id, task.id), 'generation', 'authored-result.json'), 'utf8'))
  assert.equal(raw.edits.length, 1); assert.equal(failed.repositories[0].commit, null)
})

test('an interrupted generation cannot publish only its already committed subset', async t => {
  const f = await fixture(t), service = new FaultInjectionService({ generate: async ({ record }) => generated(record) })
  const task = await service.start(f); await wait(service)
  const record = await service.read(f.dataRoot, f.run.run_id, task.id)
  record.status = 'generating'; record.generation_complete = false
  await service.save(await service.directory(f.dataRoot, f.run.run_id, task.id), record)
  assert.equal((await service.read(f.dataRoot, f.run.run_id, task.id)).status, 'interrupted')
  await assert.rejects(service.push(f.dataRoot, f.run.run_id, task.id), /完整生成/)
})

test('background push returns while blocked, can stop and resume the same commit', async t => {
  const f = await fixture(t); let block = true, started
  const began = new Promise(resolve => { started = resolve })
  const service = new FaultInjectionService({ generate: async ({ record }) => generated(record), git: async (cwd, args, signal) => {
    if (args[0] === 'push' && block) { started(); await new Promise((resolve, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true }) }) }
    return injectionGit(cwd, args, signal)
  } })
  const task = await service.start(f); await wait(service)
  const accepted = await service.push(f.dataRoot, f.run.run_id, task.id, { background: true })
  assert.equal(accepted.status, 'pushing'); await began
  const stopped = await service.cancel(f.dataRoot, f.run.run_id, task.id)
  assert.equal(stopped.status, 'ready'); assert.match(stopped.error, /已停止/)
  block = false
  const resumed = await service.push(f.dataRoot, f.run.run_id, task.id)
  assert.equal(resumed.status, 'pushed'); assert.equal(resumed.repositories[0].commit, stopped.repositories[0].commit)
})

test('missing remote fails preparation and can be repaired before regeneration', async t => {
  const f = await fixture(t), service = new FaultInjectionService({ generate: async ({ record }) => generated(record) })
  await injectionGit(f.repositories[0].source_path, ['remote', 'remove', 'origin'])
  const task = await service.start(f); await wait(service)
  const before = await service.read(f.dataRoot, f.run.run_id, task.id)
  assert.equal(before.status, 'failed'); assert.equal(before.failure_phase, 'preparing')
  await assert.rejects(service.push(f.dataRoot, f.run.run_id, task.id), /完整生成/)
  await injectionGit(f.repositories[0].source_path, ['remote', 'add', 'origin', f.repositories[0].remote_path])
  const retry = await service.retry(f.dataRoot, f.run.run_id, task.id); await wait(service)
  const after = await service.push(f.dataRoot, f.run.run_id, retry.id)
  assert.equal(after.status, 'pushed', after.error)
})

test('retry preserves captured cases and resolved baseline in a new task', async t => {
  const f = await fixture(t); let fail = true
  const service = new FaultInjectionService({ generate: async ({ record }) => { if (fail) throw Error('model failed'); return generated(record) } })
  const first = await service.start(f); await wait(service)
  fail = false
  const retry = await service.retry(f.dataRoot, f.run.run_id, first.id, f.root); await wait(service)
  const ready = await service.read(f.dataRoot, f.run.run_id, retry.id)
  assert.equal(ready.status, 'ready'); assert.notEqual(first.id, retry.id)
  assert.deepEqual(ready.case_keys, first.case_keys)
  assert.equal(ready.repositories[0].base_commit, first.repositories[0].base_commit)
  assert.equal((await service.read(f.dataRoot, f.run.run_id, first.id)).status, 'failed')
})


test('defaults use the selected Run frozen model contract, with legacy progress fallback', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fi-defaults-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dir = path.join(root, 'runs', 'selected', 'inputs'); await mkdir(dir, { recursive: true })
  const service = new FaultInjectionService(), run = { run_id: 'selected' }
  await writeFile(path.join(dir, '..', 'progress.json'), JSON.stringify({ model_settings: { provider: 'legacy' }, model_id: 'legacy-model' }))
  assert.equal((await service.defaults(root, run)).provider_id, 'legacy')
  await writeFile(path.join(dir, 'task-contract.json'), JSON.stringify({ model_settings: { provider: 'pangea-opencode' }, model_id: 'contract-model' }))
  const defaults = await service.defaults(root, run)
  assert.equal(defaults.provider_id, 'pangea-opencode'); assert.equal(defaults.agent_model, 'contract-model')
  assert.equal((await service.defaults(root, { run_id: 'other' })).provider_id, '')
})

test('a terminal publication racing a read is not reported as interrupted', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fi-read-race-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = new FaultInjectionService(), record = { id: 'task', run_id: 'run', status: 'generating' }
  const dir = await service.directory(root, 'run', 'task'); await service.save(dir, record)
  let completed = false
  t.mock.method(service.active, 'has', () => {
    if (!completed) {
      completed = true
      // Finish after readFile delivered the old record but before liveness lookup.
      writeFileSync(path.join(dir, 'task.json'), JSON.stringify({ ...record, status: 'ready' }))
    }
    return false
  })
  assert.equal((await service.read(root, 'run', 'task')).status, 'ready')
  await service.save(dir, record)
  assert.equal((await service.read(root, 'run', 'task')).status, 'interrupted')
})

test('initial publication is already owned while another request reads it', async t => {
  const f = await fixture(t)
  const service = new FaultInjectionService({ generate: async ({ record }) => generated(record) })
  let published, release
  const visible = new Promise(resolve => { published = resolve })
  const held = new Promise(resolve => { release = resolve })
  const save = service.save.bind(service)
  t.mock.method(service, 'save', async (directory, record) => {
    await save(directory, record)
    if (record.status === 'preparing' && !record.repositories.length) { published(record.id); await held }
  })
  const start = service.start({ ...f, cwd: f.root })
  const taskId = await visible
  try { assert.equal((await service.read(f.dataRoot, f.run.run_id, taskId)).status, 'preparing') }
  finally { release(); await start; await wait(service) }
})


test('source preparation failure records its phase and never starts the generator', async t => {
  const f = await fixture(t)
  let generatedCount = 0
  const service = new FaultInjectionService({ generate: async () => { generatedCount++ }, git: async (cwd, args, signal) => {
    if (args[0] === 'checkout') throw new Error('error: unable to create file nested/header.h: Filename too long')
    return injectionGit(cwd, args, signal)
  } })
  const task = await service.start(f); await wait(service)
  const failed = await service.read(f.dataRoot, f.run.run_id, task.id)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.failure_phase, 'preparing')
  assert.match(failed.error, /Filename too long/)
  assert.equal(generatedCount, 0)
  assert.equal(await injectionGit(f.repositories[0].source_path, ['status', '--porcelain']), '')
})

test('dirty and linked original does not require acknowledgement or copy uncommitted content', async t => {
  const f = await fixture(t)
  await writeFile(path.join(f.repositories[0].source_path, 'local-only.txt'), 'original workspace draft')
  f.input.repositories[0].linked = true
  let captured
  const service = new FaultInjectionService({ generate: async ({ record, prompt }) => {
    captured = record
    assert.match(prompt, /分析基线与本次基线不同则重新定位/)
    return generated(record)
  } })
  const task = await service.start(f); await wait(service)
  const ready = await service.read(f.dataRoot, f.run.run_id, task.id)
  assert.equal(ready.status, 'ready', ready.error)
  assert.equal(captured.source_repositories[0].working_tree_dirty, true)
  await assert.rejects(readFile(path.join(ready.repositories[0].path, 'local-only.txt')), { code: 'ENOENT' })
  assert.equal(await readFile(path.join(f.repositories[0].source_path, 'local-only.txt'), 'utf8'), 'original workspace draft')
})

async function configureA(f) {
  const source = f.repositories[0].source_path
  await injectionGit(source, ['checkout', '-b', 'A'])
  await injectionGit(source, ['push', 'origin', 'A'])
  await writeFile(path.join(f.dataRoot, '.pangea', 'repository-settings', 'target.json'), JSON.stringify({ git_path: source, personal_branch: 'A', remote: 'origin' }))
  return source
}
async function appending(record) {
  const value = generated(record)
  value.edits = await Promise.all(record.repositories.map(async repo => {
    const before = await readFile(path.join(repo.path, 'main.c'), 'utf8')
    return { repo_id: repo.repo_id, path: 'main.c', before, after: `${before}\n/* task ${record.id}: independent fault */\n` }
  }))
  return value
}
async function localCommit(source, name = 'user.txt') {
  await writeFile(path.join(source, name), `developer ${Math.random()}\n`)
  await injectionGit(source, ['add', '--', name]); await injectionGit(source, ['commit', '-m', 'developer change'])
  return injectionGit(source, ['rev-parse', 'HEAD'])
}

test('consecutive tasks only advance configured A, ignore injected branch overrides, and preserve earlier stubs', async t => {
  const f = await fixture(t), source = await configureA(f)
  f.input.branch_prefix = 'A_unwanted'; f.input.repositories[0].personal_branch = 'main'
  f.input.repositories[0].base_ref = 'missing'; f.input.repositories[0].source_path = '/must-not-be-used'
  const service = new FaultInjectionService({ generate: async ({ record }) => appending(record) })
  const initialRefs = await injectionGit(source, ['for-each-ref', '--format=%(refname)', 'refs/heads/'])
  const initialRemote = await injectionGit(f.repositories[0].remote_path, ['for-each-ref', '--format=%(refname)', 'refs/heads/'])
  let prior = await injectionGit(source, ['rev-parse', 'A'])
  const ids = []
  for (let i = 0; i < 2; i++) {
    const task = await service.start(f); await wait(service)
    const ready = await service.read(f.dataRoot, f.run.run_id, task.id)
    assert.equal(ready.status, 'ready', ready.error); assert.equal(ready.branch, 'A')
    assert.equal(ready.repositories[0].base_commit, prior); assert.equal(ready.repositories[0].commit, null)
    assert.equal(await injectionGit(source, ['rev-parse', 'A']), prior)
    assert.equal(await injectionGit(ready.repositories[0].path, ['branch', '--show-current']), '')
    const pushed = await service.push(f.dataRoot, f.run.run_id, task.id)
    assert.equal(pushed.status, 'pushed', pushed.error)
    prior = pushed.repositories[0].commit; ids.push(task.id)
    assert.equal(await injectionGit(source, ['rev-parse', 'A']), prior)
    assert.equal(await injectionGit(f.repositories[0].remote_path, ['rev-parse', 'A']), prior)
  }
  const content = await readFile(path.join(source, 'main.c'), 'utf8')
  ids.forEach(id => assert.ok(content.includes(id)))
  assert.equal(await injectionGit(source, ['for-each-ref', '--format=%(refname)', 'refs/heads/']), initialRefs)
  assert.equal(await injectionGit(f.repositories[0].remote_path, ['for-each-ref', '--format=%(refname)', 'refs/heads/']), initialRemote)
})

test('existing outgoing commits require exact-head acknowledgement before creating a new commit', async t => {
  const f = await fixture(t), source = await configureA(f)
  const head = await localCommit(source)
  const service = new FaultInjectionService({ generate: async ({ record }) => appending(record) })
  const task = await service.start(f); await wait(service)
  const blocked = await service.push(f.dataRoot, f.run.run_id, task.id)
  assert.equal(blocked.status, 'ready'); assert.match(blocked.error, /1 个已有未推送提交/)
  assert.equal(blocked.repositories[0].commit, null)
  const wrong = await service.push(f.dataRoot, f.run.run_id, task.id, { acknowledged_heads: { target: 'not-the-head' } })
  assert.equal(wrong.repositories[0].commit, null)
  const pushed = await service.push(f.dataRoot, f.run.run_id, task.id, { acknowledged_heads: { target: head } })
  assert.equal(pushed.status, 'pushed', pushed.error)
  assert.equal(await injectionGit(source, ['merge-base', head, pushed.repositories[0].commit]), head)
})

test('branch changes after generation reject stale changes; regeneration uses the new branch head', async t => {
  const f = await fixture(t), source = await configureA(f)
  const service = new FaultInjectionService({ generate: async ({ record }) => appending(record) })
  const task = await service.start(f); await wait(service)
  const head = await localCommit(source)
  const blocked = await service.push(f.dataRoot, f.run.run_id, task.id)
  assert.match(blocked.error, /个人分支已有新提交/); assert.equal(blocked.repositories[0].commit, null)
  const retry = await service.retry(f.dataRoot, f.run.run_id, task.id); await wait(service)
  assert.equal((await service.read(f.dataRoot, f.run.run_id, retry.id)).repositories[0].base_commit, head)
})

test('remote fast-forward is used for generation; later remote changes cannot be overwritten', async t => {
  const f = await fixture(t), source = await configureA(f), other = path.join(f.root, 'other')
  await injectionGit(f.root, ['clone', '--branch', 'A', f.repositories[0].remote_path, other])
  await injectionGit(other, ['config', 'user.name', 'Other']); await injectionGit(other, ['config', 'user.email', 'other@test'])
  const remoteHead = await localCommit(other)
  await injectionGit(other, ['push', 'origin', 'A'])
  const service = new FaultInjectionService({ generate: async ({ record }) => appending(record) })
  const task = await service.start(f); await wait(service)
  const ready = await service.read(f.dataRoot, f.run.run_id, task.id)
  assert.equal(ready.repositories[0].base_commit, remoteHead)
  assert.equal(ready.repositories[0].outgoing_count, 0)
  const pushed = await service.push(f.dataRoot, f.run.run_id, task.id)
  assert.equal(pushed.status, 'pushed', pushed.error)
  const next = await service.start(f); await wait(service)
  await injectionGit(other, ['pull', '--ff-only', 'origin', 'A'])
  const later = await localCommit(other, 'later.txt'); await injectionGit(other, ['push', 'origin', 'A'])
  const blocked = await service.push(f.dataRoot, f.run.run_id, next.id)
  assert.match(blocked.error, /远端分支已更新/)
  assert.equal(await injectionGit(f.repositories[0].remote_path, ['rev-parse', 'A']), later)
  assert.equal(await injectionGit(source, ['rev-parse', 'A']), pushed.repositories[0].commit)
})

test('same-file uncommitted changes block submission without overwriting them', async t => {
  const f = await fixture(t), source = await configureA(f)
  const service = new FaultInjectionService({ generate: async ({ record }) => appending(record) })
  const task = await service.start(f); await wait(service)
  await writeFile(path.join(source, 'main.c'), 'developer unsaved work\n')
  const blocked = await service.push(f.dataRoot, f.run.run_id, task.id)
  assert.match(blocked.error, /存在未提交内容/); assert.equal(blocked.repositories[0].commit, null)
  assert.equal(await readFile(path.join(source, 'main.c'), 'utf8'), 'developer unsaved work\n')
})

test('parallel submissions to A serialize and reject the second stale task', async t => {
  const f = await fixture(t); await configureA(f)
  const service = new FaultInjectionService({ generate: async ({ record }) => appending(record) })
  const [a, b] = await Promise.all([service.start(f), service.start(f)]); await wait(service)
  const results = await Promise.all([service.push(f.dataRoot, f.run.run_id, a.id), service.push(f.dataRoot, f.run.run_id, b.id)])
  assert.deepEqual(results.map(r => r.status).sort(), ['pushed', 'ready'])
  assert.match(results.find(r => r.status === 'ready').error, /个人分支已有新提交/)
})

test('missing fixed configuration and missing existing branch cannot create task branches', async t => {
  const f = await fixture(t)
  const file = path.join(f.dataRoot, '.pangea', 'repository-settings', 'target.json')
  const service = new FaultInjectionService({ generate: async ({ record }) => appending(record) })
  await writeFile(file, JSON.stringify({ git_path: f.repositories[0].source_path }))
  await assert.rejects(service.start(f), /项目配置选择个人开发分支/)
  await writeFile(file, JSON.stringify({ git_path: f.repositories[0].source_path, personal_branch: 'does-not-exist' }))
  const task = await service.start(f); await wait(service)
  assert.equal((await service.read(f.dataRoot, f.run.run_id, task.id)).status, 'failed')
  assert.equal(await injectionGit(f.repositories[0].source_path, ['branch', '--list', 'does-not-exist']), '')
})

test('workspace branch switch during submission cannot write to another branch', async t => {
  const f = await fixture(t), source = await configureA(f)
  const before = await injectionGit(source, ['rev-parse', 'A'])
  await injectionGit(source, ['branch', 'B', before])
  let switched = false
  const service = new FaultInjectionService({ generate: async ({ record }) => appending(record), git: async (cwd, args, signal) => {
    if (args[0] === 'push' && args[1].startsWith('--receive-pack=') && !switched) {
      switched = true; await injectionGit(source, ['checkout', 'B'])
    }
    return injectionGit(cwd, args, signal)
  } })
  const task = await service.start(f); await wait(service)
  const result = await service.push(f.dataRoot, f.run.run_id, task.id)
  assert.equal(result.status, 'pushed', result.error)
  assert.equal(await injectionGit(source, ['branch', '--show-current']), 'B')
  assert.equal(await injectionGit(source, ['rev-parse', 'B']), before)
  assert.equal(await readFile(path.join(source, 'main.c'), 'utf8'), original)
  assert.equal(await injectionGit(source, ['rev-parse', 'A']), result.repositories[0].commit)
})

test('retry recovers an exact task commit when command completion was interrupted', async t => {
  const f = await fixture(t); await configureA(f)
  let interrupt = true, commits = 0
  const service = new FaultInjectionService({ generate: async ({ record }) => appending(record), git: async (cwd, args, signal) => {
    const result = await injectionGit(cwd, args, signal)
    if (args.includes('commit')) { commits++; if (interrupt) { interrupt = false; throw new Error('completion interrupted after commit') } }
    return result
  } })
  const task = await service.start(f); await wait(service)
  const stopped = await service.push(f.dataRoot, f.run.run_id, task.id)
  assert.equal(stopped.status, 'ready'); assert.equal(stopped.repositories[0].commit, null)
  const recovered = await service.push(f.dataRoot, f.run.run_id, task.id)
  assert.equal(recovered.status, 'pushed', recovered.error)
  assert.equal(commits, 1)
})

test('queued submission can be cancelled without waiting for the branch owner', async t => {
  const f = await fixture(t); await configureA(f)
  let release, began
  const held = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { began = resolve })
  const service = new FaultInjectionService({ generate: async ({ record }) => appending(record), git: async (cwd, args, signal) => {
    if (args[0] === 'push' && args[1] === 'origin') { began(); await held }
    return injectionGit(cwd, args, signal)
  } })
  const a = await service.start(f), b = await service.start(f); await wait(service)
  await service.push(f.dataRoot, f.run.run_id, a.id, { background: true }); await started
  await service.push(f.dataRoot, f.run.run_id, b.id, { background: true })
  let timer
  try {
    const cancelled = await Promise.race([service.cancel(f.dataRoot, f.run.run_id, b.id), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('queued cancel blocked behind owner')), 1500) })])
    assert.equal(cancelled.status, 'ready')
    assert.equal((await service.read(f.dataRoot, f.run.run_id, a.id)).status, 'pushing')
  } finally { clearTimeout(timer); release(); await wait(service) }
})

test('different local/remote branches support consecutive pushes without switching the user worktree', async t => {
  const f = await fixture(t), repo = f.repositories[0]
  await injectionGit(repo.source_path, ['branch', 'personal-local'])
  await writeFile(path.join(f.dataRoot, '.pangea', 'repository-settings', 'target.json'), JSON.stringify({ git_path: repo.source_path, personal_branch: 'personal-local', remote: 'origin', remote_branch: 'main' }))
  const service = new FaultInjectionService({ generate: async ({ record }) => {
    const current = await readFile(path.join(record.repositories[0].path, 'main.c'), 'utf8')
    const result = generated(record)
    result.edits = [{ repo_id: 'target', path: 'main.c', before: current, after: current + `/* task ${record.id} */\n` }]
    return result
  } })
  t.after(() => service.dispose())
  for (let i = 0; i < 2; i++) {
    const task = await service.start({ ...f, cwd: f.root }); await wait(service)
    const pushed = await service.push(f.dataRoot, f.run.run_id, task.id)
    assert.equal(pushed.status, 'pushed', pushed.error)
    assert.equal(await injectionGit(repo.remote_path, ['rev-parse', 'main']), pushed.repositories[0].commit)
    assert.equal(await injectionGit(repo.source_path, ['rev-parse', 'personal-local']), pushed.repositories[0].commit)
    assert.equal(await injectionGit(repo.source_path, ['branch', '--show-current']), 'main')
    assert.equal(await readFile(path.join(repo.source_path, 'main.c'), 'utf8'), original)
  }
})
test('push accepted before transport failure is reconciled even after remote advances', async t => {
  const f = await fixture(t), repo = f.repositories[0]
  let remotePushes = 0
  const service = new FaultInjectionService({ generate: async ({ record }) => generated(record), git: async (cwd, args, signal) => {
    const output = await injectionGit(cwd, args, signal)
    if (args[0] === 'push' && args[1] === 'origin') { remotePushes++; throw new Error('connection lost after acceptance') }
    return output
  } })
  t.after(() => service.dispose())
  const task = await service.start({ ...f }); await wait(service)
  const uncertain = await service.push(f.dataRoot, f.run.run_id, task.id)
  assert.match(uncertain.error, /推送结果待确认/)
  await writeFile(path.join(repo.source_path, 'other.txt'), 'other user change')
  await injectionGit(repo.source_path, ['add', 'other.txt']); await injectionGit(repo.source_path, ['commit', '-m', 'later change'])
  await injectionGit(repo.source_path, ['push', 'origin', 'main'])
  const confirmed = await service.push(f.dataRoot, f.run.run_id, task.id)
  assert.equal(confirmed.status, 'pushed', confirmed.error)
  assert.equal(remotePushes, 1)
})

test('new task rejects missing safety contract before touching checkout and retains authored evidence', async t => {
  const f = await fixture(t)
  const sourceBefore = await readFile(path.join(f.repositories[0].source_path, 'main.c'))
  let checkoutBefore
  const service = new FaultInjectionService({ generate: async ({ record }) => {
    checkoutBefore = await readFile(path.join(record.repositories[0].path, 'main.c'))
    assert.equal(record.generation_contract_version, 2)
    const result = generated(record)
    delete result.profiles[0].safety.cleanup
    return result
  } })
  const started = await service.start({ ...f, cwd: f.root })
  await wait(service)
  const failed = await service.read(f.dataRoot, f.run.run_id, started.id)
  assert.equal(failed.status, 'failed')
  assert.match(failed.error, /退出清理/)
  assert.deepEqual(await readFile(path.join(failed.repositories[0].path, 'main.c')), checkoutBefore)
  assert.deepEqual(await readFile(path.join(f.repositories[0].source_path, 'main.c')), sourceBefore)
  const saved = await service.resolveSavedResultFile(await service.directory(f.dataRoot, f.run.run_id, started.id))
  assert.ok(saved)
  assert.ok(JSON.parse(await readFile(saved, 'utf8')).edits.length)
})
