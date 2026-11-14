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
    repositories.push({ repo_id, source_path: source, source_root: source, remote_path: remote, git: { commit }, base_ref: commit })
  }
  const cases = ['A', 'B', 'C'].map(letter => ({ projection_id: `unit/CASE-${letter}`, test_case_id: `unit/CASE-${letter}`, title: `场景 ${letter}`, execution_readiness: 'needs_instrumentation' }))
  const run = { run_id: 'run-fi', repositories: repositories.map(repo => repo.repo_id), source_snapshot: { repositories }, details: { test_cases: cases } }
  const input = { case_keys: cases.map(item => item.test_case_id), repositories, provider_id: 'pangea-opencode', agent_model: 'fixture', branch_prefix: 'tester/fault' }
  return { root, dataRoot, repositories, run, input }
}
function generated(record) {
  return { summary: '按用例控制故障', points: [{ id: 'A', repo_id: 'target', path: 'main.c', trigger: '队列创建', times: 1, action: '申请失败', enable: 'PANGEA_FI=A', disable: '清空 PANGEA_FI', observe: 'hit:A' }],
    profiles: record.case_keys.map(case_key => ({ case_key, point_ids: ['A'], steps: ['开启目标桩', '执行业务', '检查命中并撤销'] })),
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
    const run = async faults => (await exec(binary, [], { env: { ...process.env, PANGEA_FI: faults } })).stdout.trim()
    assert.equal(await run(''), 'ok')
    assert.equal(await run('A'), 'hit:A queue_failed')
    assert.equal(await run('B'), 'hit:B io_failed')
    assert.equal(await run('AB'), 'hit:A queue_failed') // A prevents reaching B.
    assert.equal(await run('AC'), 'hit:A queue_failed\nhit:C cleanup_failed') // C needs A.
    assert.equal(await run(''), 'ok')
  })
  const wantedCommit = repo.commit
  // A later local commit must not change the identity of the reviewed task.
  await writeFile(path.join(repo.path, 'unrelated.txt'), 'not part of task')
  await injectionGit(repo.path, ['add', 'unrelated.txt'])
  await injectionGit(repo.path, ['commit', '-m', 'unrelated local work'])
  const pushed = await service.push(f.dataRoot, f.run.run_id, task.id)
  assert.equal(pushed.status, 'pushed', pushed.error)
  assert.equal(await injectionGit(f.repositories[0].remote_path, ['rev-parse', `refs/heads/${repo.branch}`]), wantedCommit)
  const reopened = new FaultInjectionService()
  assert.equal((await reopened.list(f.dataRoot, f.run.run_id))[0].status, 'pushed')
  const recorded = await reopened.recordVerification(f.dataRoot, f.run.run_id, task.id, { build: { package_id: 'personal-001', url: 'https://ci.example.test/1' }, verification: { case_key: f.input.case_keys[0], result: 'passed', hits: 'A=1', notes: '恢复正常' } })
  assert.equal(recorded.verification[0].build.commits[0].commit, wantedCommit)
  assert.equal(recorded.verification[0].result, 'passed')
  assert.equal(f.run.details.test_cases[0].execution_readiness, 'needs_instrumentation')
})

test('two tasks share a baseline but never writable checkouts or personal branches', async t => {
  const f = await fixture(t), service = new FaultInjectionService({ generate: async ({ record }) => generated(record) })
  const tasks = await Promise.all([service.start(f), service.start(f)])
  await wait(service)
  const [a, b] = await Promise.all(tasks.map(task => service.read(f.dataRoot, f.run.run_id, task.id)))
  assert.equal(a.status, 'ready', a.error); assert.equal(b.status, 'ready', b.error)
  assert.notEqual(a.branch, b.branch); assert.notEqual(a.repositories[0].path, b.repositories[0].path)
  assert.equal(a.repositories[0].base_commit, b.repositories[0].base_commit)
  assert.equal(await injectionGit(f.repositories[0].source_path, ['status', '--porcelain']), '')
})

test('multi-repository partial push is recorded and retry pushes only the unfinished repository', async t => {
  const f = await fixture(t, { multi: true }); let fail = true; const calls = []
  const service = new FaultInjectionService({ generate: async ({ record }) => generated(record), git: async (cwd, args, signal) => {
    if (args[0] === 'push') { calls.push(path.basename(cwd)); if (path.basename(cwd) === 'helper' && fail) throw new Error('simulated remote unavailable') }
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
