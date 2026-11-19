import { writeFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { FaultInjectionService, injectionGit, applyInjectionEdits } from '../src/fault-injection.js'
import { MULTILINE_GATE_COMMIT_TEMPLATE, DEFAULT_INTRANET_COMMIT_REGEX } from '../src/fault-injection-candidates.js'

const exec = promisify(execFile)
const original = [
  '#include <stdio.h>',
  '#include <stdlib.h>',
  '#include <string.h>',
  'int step_alpha(const char *faults) {',
  '  return 0;',
  '}',
  'int step_beta(const char *faults) {',
  '  return 0;',
  '}',
  'int main(void) {',
  '  const char *faults = getenv("PANGEA_FI");',
  '  if (step_alpha(faults) != 0) return 0;',
  '  if (step_beta(faults) != 0) return 0;',
  '  puts("ok");',
  '  return 0;',
  '}',
  '',
].join('\n')

const instrumented = [
  '#include <stdio.h>',
  '#include <stdlib.h>',
  '#include <string.h>',
  'int step_alpha(const char *faults) {',
  '  if (faults && strchr(faults, \'A\')) {',
  '    puts("hit:A queue_failed");',
  '    if (strchr(faults, \'C\')) puts("hit:C cleanup_failed");',
  '    return -1;',
  '  }',
  '  return 0;',
  '}',
  'int step_beta(const char *faults) {',
  '  if (faults && strchr(faults, \'B\')) { puts("hit:B io_failed"); return -1; }',
  '  return 0;',
  '}',
  'int main(void) {',
  '  const char *faults = getenv("PANGEA_FI");',
  '  if (step_alpha(faults) != 0) return 0;',
  '  if (step_beta(faults) != 0) return 0;',
  '  puts("ok");',
  '  return 0;',
  '}',
  '',
].join('\n')

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
    await injectionGit(source, ['branch', 'personal'])
    await injectionGit(root, ['init', '--bare', remote])
    await injectionGit(source, ['remote', 'add', 'origin', remote])
    await injectionGit(source, ['push', 'origin', 'main', 'personal'])
    await mkdir(path.join(dataRoot, '.pangea', 'repository-settings'), { recursive: true })
    await writeFile(path.join(dataRoot, '.pangea', 'repository-settings', `${repo_id}.json`), JSON.stringify({ git_path: source, personal_branch: 'personal', remote: 'origin' }))
    repositories.push({ repo_id, source_path: source, source_root: source, remote_path: remote, git: { commit }, base_ref: commit })
  }
  await mkdir(path.join(dataRoot, '.pangea', 'fault-injection'), { recursive: true })
  await writeFile(path.join(dataRoot, '.pangea', 'fault-injection', 'commit-defaults.json'), JSON.stringify({ mode: 'default', explicit_default_mode: true }))
  const cases = ['A', 'B', 'C'].map(letter => ({ projection_id: `unit/CASE-${letter}`, test_case_id: `unit/CASE-${letter}`, title: `场景 ${letter}`, execution_readiness: 'needs_instrumentation' }))
  const run = { run_id: 'run-fi', repositories: repositories.map(repo => repo.repo_id), source_snapshot: { repositories }, details: { test_cases: cases } }
  const input = { case_keys: cases.map(item => item.test_case_id), repositories, provider_id: 'pangea-opencode', agent_model: 'fixture' }
  return { root, dataRoot, repositories, run, input }
}

function makeResult(record, edits, pointId = 'A') {
  return {
    summary: '按用例控制故障',
    points: [{ id: pointId, trigger_scope: { current_input: 'fixture operation argument', excluded_inputs: ['previous operations'] }, repo_id: 'target', path: 'main.c', trigger: '队列创建', times: 1, action: '申请失败', enable: `PANGEA_FI=${pointId}`, disable: '清空 PANGEA_FI', observe: `hit:${pointId}` }],
    profiles: record.case_keys.map(case_key => ({ case_key, point_ids: [pointId], safety: { setup: [':'], negative_steps: [':'], negative_point_ids: [pointId], cleanup: [':'], cleanup_verify: [':'] }, steps: ['开启目标桩', '执行业务', '检查命中并撤销'] })),
    edits,
    limitations: [],
  }
}

function generated(record) {
  return makeResult(record, record.repositories.map(repo => ({ repo_id: repo.repo_id, path: 'main.c', before: original, after: instrumented })))
}

async function wait(service) { await Promise.all([...service.active.values()].map(operation => operation.done)) }

// §7 #1: HEAD baseline + source_path worktree, status, refs/heads/*, and HEAD remain untouched after build
test('real Git + compiled C: generate from HEAD without touching personal branch, synthesize build, and record verification', async t => {
  const f = await fixture(t)
  const source = f.repositories[0].source_path
  const remote = f.repositories[0].remote_path
  // Advance remote personal branch ahead of main to prove generation uses analysis dir HEAD, NOT personal branch.
  const otherClone = path.join(f.root, 'other-personal')
  await injectionGit(f.root, ['clone', '--branch', 'personal', remote, otherClone])
  await injectionGit(otherClone, ['config', 'user.name', 'Other'])
  await injectionGit(otherClone, ['config', 'user.email', 'other@example.test'])
  await writeFile(path.join(otherClone, 'personal-only.txt'), 'old personal commit\n')
  await injectionGit(otherClone, ['add', 'personal-only.txt'])
  await injectionGit(otherClone, ['commit', '-m', 'prior personal branch work'])
  await injectionGit(otherClone, ['push', 'origin', 'personal'])
  const priorRemotePersonal = await injectionGit(remote, ['rev-parse', 'refs/heads/personal'])

  const beforeRefs = await injectionGit(source, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/'])
  const beforeHead = await injectionGit(source, ['rev-parse', 'HEAD'])

  const gitCalls = []
  const service = new FaultInjectionService({
    git: async (cwd, args, signal) => { gitCalls.push({ cwd, args }); return injectionGit(cwd, args, signal) },
    generate: async ({ record, prompt }) => {
      assert.match(prompt, /保留原有错误处理/)
      return generated(record)
    },
  })
  t.after(() => service.dispose())

  const task = await service.start({ ...f, cwd: f.root })
  await wait(service)
  const ready = await service.read(f.dataRoot, f.run.run_id, task.id)
  assert.equal(ready.schema_version, 3)
  assert.equal(ready.status, 'ready', ready.error)
  assert.equal(ready.repositories[0].base_commit, beforeHead)
  assert.equal(ready.repositories[0].base_branch, 'main')
  // Generation never fetched remote personal branch
  assert.equal(gitCalls.some(call => call.args[0] === 'fetch'), false)
  assert.equal(await readFile(path.join(source, 'main.c'), 'utf8'), original)

  const repo = ready.repositories[0], binary = path.join(f.root, process.platform === 'win32' ? 'sample.exe' : 'sample')
  let compiler = true
  try { await exec('cc', ['--version']) } catch (error) { if (error.code !== 'ENOENT') throw error; compiler = false }
  await t.test('compiled fixture checks A/B blocking, dependent faults and recovery', { skip: !compiler && 'C compiler is not installed; Git round trip still runs' }, async () => {
    await exec('cc', [path.join(repo.path, 'main.c'), '-o', binary])
    const runBin = async faults => (await exec(binary, [], { env: { ...process.env, PANGEA_FI: faults } })).stdout.replace(/\r\n/g, '\n').trim()
    assert.equal(await runBin(''), 'ok')
    assert.equal(await runBin('A'), 'hit:A queue_failed')
    assert.equal(await runBin('B'), 'hit:B io_failed')
    assert.equal(await runBin('AB'), 'hit:A queue_failed')
    assert.equal(await runBin('AC'), 'hit:A queue_failed\nhit:C cleanup_failed')
    assert.equal(await runBin(''), 'ok')
  })

  assert.equal(await injectionGit(repo.path, ['branch', '--show-current']), '')
  const built = await service.build(f.dataRoot, { items: [{ run_id: f.run.run_id, task_id: task.id }] })
  assert.equal(built.status, 'pushed', built.error)
  const wantedCommit = built.repositories[0].commit
  assert.equal(await injectionGit(remote, ['rev-parse', 'refs/heads/personal']), wantedCommit)
  assert.equal(await injectionGit(remote, ['merge-base', priorRemotePersonal, wantedCommit]), priorRemotePersonal)
  // Remote personal tree equals exact clean HEAD + patch (does NOT carry personal-only.txt from prior personal branch!)
  await assert.rejects(injectionGit(remote, ['cat-file', '-e', `${wantedCommit}:personal-only.txt`]))

  // Analysis directory worktree, status, refs/heads/*, and HEAD are 100% untouched!
  assert.equal(await readFile(path.join(source, 'main.c'), 'utf8'), original)
  assert.equal(await injectionGit(source, ['status', '--porcelain']), '')
  assert.equal(await injectionGit(source, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/']), beforeRefs)
  assert.equal(await injectionGit(source, ['rev-parse', 'HEAD']), beforeHead)

  const reopened = new FaultInjectionService()
  t.after(() => reopened.dispose())
  const reread = await reopened.read(f.dataRoot, f.run.run_id, task.id)
  assert.equal(reread.status, 'ready')
  assert.equal(reread.latest_pushed_build.build_id, built.id)
  const recorded = await reopened.recordVerification(f.dataRoot, f.run.run_id, task.id, {
    build: { package_id: 'personal-001', url: 'https://ci.example.test/1' },
    verification: { case_key: f.input.case_keys[0], result: 'passed', hits: 'A=1', notes: '恢复正常' },
  })
  assert.equal(recorded.verification[0].build.build_id, built.id)
  assert.equal(recorded.verification[0].build.commits[0].commit, wantedCommit)
  assert.equal(recorded.verification[0].result, 'passed')
  assert.equal(f.run.details.test_cases[0].execution_readiness, 'needs_instrumentation')
})

// §7 #2 & #4: Cross-Run multi-task composition + dropping a task removes its changes without git revert
test('cross-Run synthesis composes multiple tasks into one merge commit, and deselecting a task drops its patch cleanly', async t => {
  const f = await fixture(t)
  const source = f.repositories[0].source_path
  const remote = f.repositories[0].remote_path
  // Advance main by 1 developer commit so main != remote personal -> commit-tree has 2 parents [remote_head, base_commit]
  await writeFile(path.join(source, 'dev.h'), '#define DEV_REV 2\n')
  await injectionGit(source, ['add', 'dev.h'])
  await injectionGit(source, ['commit', '-m', 'developer feature'])
  const devHead = await injectionGit(source, ['rev-parse', 'HEAD'])
  const remoteBase = await injectionGit(remote, ['rev-parse', 'refs/heads/personal'])

  const run2 = {
    run_id: 'run-fi-2',
    repositories: ['target'],
    source_snapshot: f.run.source_snapshot,
    details: { test_cases: [{ projection_id: 'unit/CASE-B2', test_case_id: 'unit/CASE-B2', title: '跨 Run 场景 B', execution_readiness: 'needs_instrumentation' }] },
  }

  const service = new FaultInjectionService({
    generate: async ({ record }) => {
      if (record.run_id === 'run-fi') {
        return makeResult(record, [{
          repo_id: 'target',
          path: 'main.c',
          before: 'int step_alpha(const char *faults) {\n  return 0;\n}',
          after: 'int step_alpha(const char *faults) {\n  if (faults && strchr(faults, \'A\')) { puts("hit:A"); return -1; }\n  return 0;\n}',
        }], 'A')
      }
      return makeResult(record, [{
        repo_id: 'target',
        path: 'main.c',
        before: 'int step_beta(const char *faults) {\n  return 0;\n}',
        after: 'int step_beta(const char *faults) {\n  if (faults && strchr(faults, \'B\')) { puts("hit:B"); return -1; }\n  return 0;\n}',
      }], 'B')
    },
  })
  t.after(() => service.dispose())

  const taskA = await service.start({ ...f, input: { ...f.input, case_keys: ['unit/CASE-A'], name: '任务A' } })
  await wait(service)
  const taskB = await service.start({ dataRoot: f.dataRoot, run: run2, input: { case_keys: ['unit/CASE-B2'], repositories: f.repositories, provider_id: 'pangea-opencode', agent_model: 'fixture', name: '任务B' } })
  await wait(service)

  const buildAB = await service.build(f.dataRoot, {
    items: [
      { run_id: run2.run_id, task_id: taskB.id },
      { run_id: f.run.run_id, task_id: taskA.id },
    ],
  })
  assert.equal(buildAB.status, 'pushed', buildAB.error)
  // Ordered deterministically by created_at ascending
  assert.deepEqual(buildAB.items.map(i => i.task_id), [taskA.id, taskB.id])
  const commitAB = buildAB.repositories[0].commit
  const parentsAB = (await injectionGit(remote, ['rev-list', '--parents', '-n', '1', commitAB])).trim().split(' ').slice(1)
  assert.deepEqual(parentsAB, [remoteBase, devHead])

  const composedMainC = await injectionGit(remote, ['show', `${commitAB}:main.c`])
  assert.match(composedMainC, /hit:A/)
  assert.match(composedMainC, /hit:B/)

  // Default selection in buildContext now remembers [taskA, taskB]
  const ctxAfterAB = await service.buildContext(f.dataRoot)
  assert.deepEqual(ctxAfterAB.default_items.map(i => i.task_id), [taskA.id, taskB.id])

  // §7 #4: Next build selects ONLY taskA -> taskB's patch disappears automatically, fast-forwarding from commitAB!
  const buildOnlyA = await service.build(f.dataRoot, {
    items: [{ run_id: f.run.run_id, task_id: taskA.id }],
  })
  assert.equal(buildOnlyA.status, 'pushed', buildOnlyA.error)
  const commitOnlyA = buildOnlyA.repositories[0].commit
  assert.equal(await injectionGit(remote, ['merge-base', commitAB, commitOnlyA]), commitAB)
  const mainCOnlyA = await injectionGit(remote, ['show', `${commitOnlyA}:main.c`])
  assert.match(mainCOnlyA, /hit:A/)
  assert.doesNotMatch(mainCOnlyA, /hit:B/)
})

// §7 #3: User pulls/advances HEAD -> unchanged anchor succeeds, changed-line anchor mismatches -> 0 commits, 0 pushes
test('advancing analysis HEAD fails overall build without committing or pushing when one selected task anchor changed', async t => {
  const f = await fixture(t)
  const source = f.repositories[0].source_path
  const remote = f.repositories[0].remote_path
  const initialRemoteHead = await injectionGit(remote, ['rev-parse', 'refs/heads/personal'])
  let commitTreeCalls = 0, pushCalls = 0

  const service = new FaultInjectionService({
    git: async (cwd, args, signal) => {
      if (args.includes('commit-tree')) commitTreeCalls++
      if (args[0] === 'push') pushCalls++
      return injectionGit(cwd, args, signal)
    },
    generate: async ({ record }) => {
      const targetFn = record.name === 'A' ? 'step_alpha' : 'step_beta'
      return makeResult(record, [{
        repo_id: 'target',
        path: 'main.c',
        before: `int ${targetFn}(const char *faults) {\n  return 0;\n}`,
        after: `int ${targetFn}(const char *faults) {\n  return -1;\n}`,
      }], record.name)
    },
  })
  t.after(() => service.dispose())

  const taskA = await service.start({ ...f, input: { ...f.input, case_keys: ['unit/CASE-A'], name: 'A' } }); await wait(service)
  const taskB = await service.start({ ...f, input: { ...f.input, case_keys: ['unit/CASE-B'], name: 'B' } }); await wait(service)

  // Developer modifies step_beta on main while leaving step_alpha unchanged
  const updated = original.replace('int step_beta(const char *faults) {\n  return 0;\n}', 'int step_beta(const char *faults) {\n  return faults ? 0 : 0;\n}')
  await writeFile(path.join(source, 'main.c'), updated)
  await injectionGit(source, ['add', 'main.c'])
  await injectionGit(source, ['commit', '-m', 'upstream modifies step_beta'])

  const failedBuild = await service.build(f.dataRoot, {
    items: [
      { run_id: f.run.run_id, task_id: taskA.id },
      { run_id: f.run.run_id, task_id: taskB.id },
    ],
  })
  assert.equal(failedBuild.status, 'failed')
  assert.equal(failedBuild.repositories[0].applied.length, 1)
  assert.equal(failedBuild.repositories[0].applied[0].task_id, taskA.id)
  assert.equal(failedBuild.repositories[0].failures.length, 1)
  assert.equal(failedBuild.repositories[0].failures[0].task_id, taskB.id)
  assert.equal(commitTreeCalls, 0)
  assert.equal(pushCalls, 0)
  assert.equal(await injectionGit(remote, ['rev-parse', 'refs/heads/personal']), initialRemoteHead)
})

// §7 #5: Overlapping edits between two tasks report conflict naming the earlier task on the same file
test('two tasks modifying overlapping lines fail build with overlap attribution and zero commits/pushes', async t => {
  const f = await fixture(t)
  const remote = f.repositories[0].remote_path
  const initialRemoteHead = await injectionGit(remote, ['rev-parse', 'refs/heads/personal'])

  const service = new FaultInjectionService({
    generate: async ({ record }) => makeResult(record, [{
      repo_id: 'target',
      path: 'main.c',
      before: 'int step_alpha(const char *faults) {\n  return 0;\n}',
      after: `int step_alpha(const char *faults) {\n  /* ${record.name} */\n  return -1;\n}`,
    }], 'A'),
  })
  t.after(() => service.dispose())

  const first = await service.start({ ...f, input: { ...f.input, case_keys: ['unit/CASE-A'], name: '桩任务一' } }); await wait(service)
  const second = await service.start({ ...f, input: { ...f.input, case_keys: ['unit/CASE-B'], name: '桩任务二' } }); await wait(service)

  const failed = await service.build(f.dataRoot, {
    items: [
      { run_id: f.run.run_id, task_id: first.id },
      { run_id: f.run.run_id, task_id: second.id },
    ],
  })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.repositories[0].failures.length, 1)
  assert.equal(failed.repositories[0].failures[0].task_id, second.id)
  assert.match(failed.repositories[0].failures[0].error, /与已应用的打桩任务修改同一文件冲突.*桩任务一/)
  assert.equal(failed.repositories[0].commit, null)
  assert.equal(await injectionGit(remote, ['rev-parse', 'refs/heads/personal']), initialRemoteHead)
})

// §7 #6: Non-fast-forward on remote personal branch is rejected without --force, and retry re-synthesizes on new remote head
test('concurrent remote personal branch update fails fast-forward push without force, and retry re-synthesizes cleanly', async t => {
  const f = await fixture(t)
  const remote = f.repositories[0].remote_path
  const other = path.join(f.root, 'concurrent-pusher')
  await injectionGit(f.root, ['clone', '--branch', 'personal', remote, other])
  await injectionGit(other, ['config', 'user.name', 'Colleague'])
  await injectionGit(other, ['config', 'user.email', 'colleague@example.test'])

  let raceOnce = true
  const pushArgsSeen = []
  const service = new FaultInjectionService({
    git: async (cwd, args, signal) => {
      if (args[0] === 'push' && args[1] === 'origin') {
        pushArgsSeen.push(args)
        assert.equal(args.some(arg => arg.includes('force') || arg.startsWith('+')), false)
        if (raceOnce) {
          raceOnce = false
          await writeFile(path.join(other, 'colleague.txt'), 'concurrent push\n')
          await injectionGit(other, ['add', 'colleague.txt'])
          await injectionGit(other, ['commit', '-m', 'concurrent personal push'])
          await injectionGit(other, ['push', 'origin', 'personal'])
        }
      }
      return injectionGit(cwd, args, signal)
    },
    generate: async ({ record }) => generated(record),
  })
  t.after(() => service.dispose())

  const task = await service.start(f); await wait(service)
  const firstAttempt = await service.build(f.dataRoot, { items: [{ run_id: f.run.run_id, task_id: task.id }] })
  assert.equal(firstAttempt.status, 'failed')
  assert.equal(firstAttempt.repositories[0].push_result, 'rejected')
  assert.match(firstAttempt.error, /重新合成提交/)
  const colleagueHead = await injectionGit(remote, ['rev-parse', 'refs/heads/personal'])

  const retried = await service.build(f.dataRoot, { build_id: firstAttempt.id })
  assert.equal(retried.status, 'pushed', retried.error)
  assert.notEqual(retried.repositories[0].commit, firstAttempt.repositories[0].commit)
  assert.equal(await injectionGit(remote, ['merge-base', colleagueHead, retried.repositories[0].commit]), colleagueHead)
  assert.equal(pushArgsSeen.length, 2)
})

// §7 #7: Push accepted before transport failure is reconciled even after remote advances
test('push accepted before transport failure is reconciled via ancestry on build retry even after remote advances', async t => {
  const f = await fixture(t), repo = f.repositories[0]
  const other = path.join(f.root, 'later-pusher')
  await injectionGit(f.root, ['clone', '--branch', 'personal', repo.remote_path, other])
  await injectionGit(other, ['config', 'user.name', 'Later'])
  await injectionGit(other, ['config', 'user.email', 'later@example.test'])

  let remotePushes = 0
  const service = new FaultInjectionService({
    generate: async ({ record }) => generated(record),
    git: async (cwd, args, signal) => {
      const output = await injectionGit(cwd, args, signal)
      if (args[0] === 'push' && args[1] === 'origin') {
        remotePushes++
        throw new Error('connection lost after acceptance')
      }
      return output
    },
  })
  t.after(() => service.dispose())

  const task = await service.start(f); await wait(service)
  const uncertain = await service.build(f.dataRoot, { items: [{ run_id: f.run.run_id, task_id: task.id }] })
  assert.equal(uncertain.status, 'failed')
  assert.match(uncertain.error, /推送结果待确认/)

  await injectionGit(other, ['pull', '--ff-only', 'origin', 'personal'])
  await writeFile(path.join(other, 'later.txt'), 'later commit\n')
  await injectionGit(other, ['add', 'later.txt'])
  await injectionGit(other, ['commit', '-m', 'advance personal after accepted push'])
  await injectionGit(other, ['push', 'origin', 'personal'])

  const confirmed = await service.build(f.dataRoot, { build_id: uncertain.id })
  assert.equal(confirmed.status, 'pushed', confirmed.error)
  assert.equal(confirmed.repositories[0].push_result, 'confirmed')
  assert.equal(remotePushes, 1)
})

// §7 #8: Analysis directory checked out on personal_branch blocks both generation and build; protected & missing remote branch rejected
test('checking out personal_branch in analysis directory blocks generation and build; protected and missing remote branches are rejected', async t => {
  const f = await fixture(t)
  const source = f.repositories[0].source_path
  const settingsFile = path.join(f.dataRoot, '.pangea', 'repository-settings', 'target.json')
  const service = new FaultInjectionService({ generate: async ({ record }) => generated(record) })
  t.after(() => service.dispose())

  // Generate one ready task while on main
  const readyTask = await service.start(f); await wait(service)
  assert.equal((await service.read(f.dataRoot, f.run.run_id, readyTask.id)).status, 'ready')

  // Switch analysis directory to personal -> blocks both start() and build()
  await injectionGit(source, ['checkout', 'personal'])
  await assert.rejects(service.start(f), /分析目录当前检出的正是个人分支 personal/)
  await assert.rejects(service.build(f.dataRoot, { items: [{ run_id: f.run.run_id, task_id: readyTask.id }] }), /分析目录当前检出的正是个人分支 personal/)

  // Switch back to main; test protected branch rejection
  await injectionGit(source, ['checkout', 'main'])
  await writeFile(settingsFile, JSON.stringify({ git_path: source, personal_branch: 'develop_release', remote: 'origin' }))
  await assert.rejects(service.start(f), /正式出包分支/)
  await assert.rejects(service.build(f.dataRoot, { items: [{ run_id: f.run.run_id, task_id: readyTask.id }] }), /正式出包分支/)

  // Missing remote branch fails build without creating remote branch
  await writeFile(settingsFile, JSON.stringify({ git_path: source, personal_branch: 'nonexistent-remote-branch', remote: 'origin' }))
  const missingBranchBuild = await service.build(f.dataRoot, { items: [{ run_id: f.run.run_id, task_id: readyTask.id }] })
  assert.equal(missingBranchBuild.status, 'failed')
  assert.match(missingBranchBuild.error, /不存在个人分支 nonexistent-remote-branch/)
  assert.equal(await injectionGit(f.repositories[0].remote_path, ['branch', '--list', 'nonexistent-remote-branch']), '')
})

// §7 #9: Commit gate template & regex pre-check rejects before commit-tree, then succeeds when corrected
test('commit message regex pre-check blocks invalid message before creating any commit and succeeds once fixed', async t => {
  const f = await fixture(t)
  let commitTreeCalls = 0
  const service = new FaultInjectionService({
    git: async (cwd, args, signal) => {
      if (args.includes('commit-tree')) commitTreeCalls++
      return injectionGit(cwd, args, signal)
    },
    generate: async ({ record }) => generated(record),
  })
  t.after(() => service.dispose())

  const task = await service.start(f); await wait(service)
  await assert.rejects(
    service.build(f.dataRoot, {
      items: [{ run_id: f.run.run_id, task_id: task.id }],
      commit_config: {
        mode: 'template',
        template: MULTILINE_GATE_COMMIT_TEMPLATE,
        pattern: DEFAULT_INTRANET_COMMIT_REGEX,
        issue: 'INVALID-ISSUE',
        author: 'u001',
        reviewer: 'u002',
        summary: '合成打桩测试',
      },
    }),
    /不符合门禁规则/,
  )
  assert.equal(commitTreeCalls, 0)

  const ok = await service.build(f.dataRoot, {
    items: [{ run_id: f.run.run_id, task_id: task.id }],
    commit_config: {
      mode: 'template',
      template: MULTILINE_GATE_COMMIT_TEMPLATE,
      pattern: DEFAULT_INTRANET_COMMIT_REGEX,
      issue: 'AR20261119000001',
      author: 'u001',
      reviewer: 'u002',
      summary: '合成打桩测试',
    },
  })
  assert.equal(ok.status, 'pushed', ok.error)
  assert.equal(commitTreeCalls, 1)
  assert.match(await injectionGit(f.repositories[0].remote_path, ['log', '-1', '--format=%B', 'refs/heads/personal']), /AR20261119000001/)
})

// §7 #10: Multi-repository partial push is recorded and retry pushes only the unfinished repository
test('multi-repository partial push is recorded and build retry pushes only the unfinished repository', async t => {
  const f = await fixture(t, { multi: true }); let fail = true; const calls = []
  const service = new FaultInjectionService({
    generate: async ({ record }) => generated(record),
    git: async (cwd, args, signal) => {
      if (args[0] === 'push' && args[1] === 'origin') {
        calls.push(path.basename(cwd))
        if (path.basename(cwd) === 'helper' && fail) throw new Error('simulated remote unavailable')
      }
      return injectionGit(cwd, args, signal)
    },
  })
  t.after(() => service.dispose())
  const task = await service.start(f); await wait(service)
  const partial = await service.build(f.dataRoot, { items: [{ run_id: f.run.run_id, task_id: task.id }] })
  assert.equal(partial.status, 'failed')
  assert.equal(partial.repositories[0].pushed, true)
  assert.equal(partial.repositories[1].pushed, false)
  fail = false
  const completed = await service.build(f.dataRoot, { build_id: partial.id })
  assert.equal(completed.status, 'pushed', completed.error)
  assert.deepEqual(calls, ['target', 'helper', 'helper'])
})

// §7 #11: Tampered result.json (both on-disk tamper and selection SHA mismatch) is rejected before commit/push
test('tampered result.json is rejected by SHA-256 verification before creating any commit', async t => {
  const f = await fixture(t)
  let commitTreeCalls = 0
  const service = new FaultInjectionService({
    git: async (cwd, args, signal) => {
      if (args.includes('commit-tree')) commitTreeCalls++
      return injectionGit(cwd, args, signal)
    },
    generate: async ({ record }) => generated(record),
  })
  t.after(() => service.dispose())

  const task = await service.start(f); await wait(service)
  const ready = await service.read(f.dataRoot, f.run.run_id, task.id)

  // Case 1: caller's selected result_sha256 differs from disk
  await assert.rejects(
    service.build(f.dataRoot, { items: [{ run_id: f.run.run_id, task_id: ready.id, result_sha256: '0'.repeat(64) }] }),
    /SHA-256 不符/,
  )
  assert.equal(commitTreeCalls, 0)

  // Case 2: result.json on disk is tampered after ready
  const savedFile = await service.resolveSavedResultFile(await service.directory(f.dataRoot, f.run.run_id, ready.id))
  const tampered = JSON.parse(await readFile(savedFile, 'utf8'))
  tampered.edits[0].after += '\n/* tampered */\n'
  await writeFile(savedFile, JSON.stringify(tampered, null, 2))

  await assert.rejects(
    service.build(f.dataRoot, { items: [{ run_id: f.run.run_id, task_id: ready.id }] }),
    /SHA-256 不符/,
  )
  assert.equal(commitTreeCalls, 0)
})

// §7 #12 + §3 historical injection commit notice: Legacy schema_version 2 compatibility & ancestor injection warning
test('legacy schema_version 2 tasks remain readable and includable in build, service.push is removed, and injection commits in HEAD emit non-blocking warnings', async t => {
  const f = await fixture(t)
  const source = f.repositories[0].source_path
  const remote = f.repositories[0].remote_path
  const service = new FaultInjectionService({ generate: async ({ record }) => generated(record) })
  t.after(() => service.dispose())

  assert.equal(service.push, undefined)

  const legacyId = 'legacy-v2-task'
  const legacyDir = await service.directory(f.dataRoot, f.run.run_id, legacyId)
  await mkdir(path.join(legacyDir, 'generation'), { recursive: true })
  const legacyPayload = generated({ case_keys: ['unit/CASE-A'], repositories: [{ repo_id: 'target' }] })
  await writeFile(path.join(legacyDir, 'generation', 'result.json'), JSON.stringify(legacyPayload, null, 2))
  await writeFile(path.join(legacyDir, 'task.json'), JSON.stringify({
    schema_version: 2,
    generation_contract_version: 2,
    id: legacyId,
    run_id: f.run.run_id,
    name: '历史 v2 打桩任务',
    status: 'pushed',
    branch: 'personal',
    created_at: '2026-11-10T00:00:00.000Z',
    updated_at: '2026-11-10T00:05:00.000Z',
    case_keys: ['unit/CASE-A'],
    cases: [f.run.details.test_cases[0]],
    repositories: [{ repo_id: 'target', base_commit: f.repositories[0].git.commit, branch: 'personal', commit: null, pushed: true }],
    source_repositories: [{ repo_id: 'target', source_path: source }],
    result: { summary: legacyPayload.summary, points: legacyPayload.points, profiles: legacyPayload.profiles, limitations: [] },
    generation_complete: true,
    verification: [],
    build: {},
  }, null, 2))

  const readLegacy = await service.read(f.dataRoot, f.run.run_id, legacyId)
  assert.equal(readLegacy.schema_version, 2)
  assert.equal(readLegacy.result_saved, true)
  const listedAll = await service.listAll(f.dataRoot)
  assert.equal(listedAll.find(item => item.id === legacyId)?.includable, true)

  const built = await service.build(f.dataRoot, { items: [{ run_id: f.run.run_id, task_id: legacyId }] })
  assert.equal(built.status, 'pushed', built.error)

  // Simulate user accidentally merging/pulling the pushed build commit into their analysis directory HEAD (on main)
  await injectionGit(source, ['fetch', 'origin', 'refs/heads/personal'])
  await injectionGit(source, ['merge', '--ff-only', 'FETCH_HEAD'])
  const ctx = await service.buildContext(f.dataRoot)
  assert.equal(ctx.repositories[0].injection_commits_in_head.length, 1)
  assert.equal(ctx.repositories[0].injection_commits_in_head[0].commit, built.repositories[0].commit)
})

test('two tasks share one personal branch setting and never share writable checkouts', async t => {
  const f = await fixture(t), service = new FaultInjectionService({ generate: async ({ record }) => generated(record) })
  t.after(() => service.dispose())
  const tasks = await Promise.all([service.start(f), service.start(f)])
  await wait(service)
  const [a, b] = await Promise.all(tasks.map(task => service.read(f.dataRoot, f.run.run_id, task.id)))
  assert.equal(a.status, 'ready', a.error); assert.equal(b.status, 'ready', b.error)
  assert.equal(a.branch, b.branch); assert.notEqual(a.repositories[0].path, b.repositories[0].path)
  assert.equal(a.repositories[0].base_commit, b.repositories[0].base_commit)
  assert.equal(await injectionGit(f.repositories[0].source_path, ['status', '--porcelain']), '')
})

test('unmatched edits fail only the injection task; original case and source stay available', async t => {
  const f = await fixture(t), service = new FaultInjectionService({ generate: async ({ record }) => ({ ...generated(record), edits: [{ repo_id: 'target', path: 'main.c', before: 'not present', after: 'oops' }] }) })
  t.after(() => service.dispose())
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
  t.after(() => service.dispose())
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
  t.after(() => service.dispose())
  const task = await service.start(f); await wait(service)
  const failed = await service.read(f.dataRoot, f.run.run_id, task.id)
  assert.equal(failed.status, 'failed'); assert.match(failed.error, /执行说明/)
  const raw = JSON.parse(await readFile(path.join(await service.directory(f.dataRoot, f.run.run_id, task.id), 'generation', 'authored-result.json'), 'utf8'))
  assert.equal(raw.edits.length, 1)
})

test('an interrupted generation cannot be included in a build', async t => {
  const f = await fixture(t), service = new FaultInjectionService({ generate: async ({ record }) => generated(record) })
  t.after(() => service.dispose())
  const task = await service.start(f); await wait(service)
  const record = await service.read(f.dataRoot, f.run.run_id, task.id)
  record.status = 'generating'; record.generation_complete = false
  await service.save(await service.directory(f.dataRoot, f.run.run_id, task.id), record)
  assert.equal((await service.read(f.dataRoot, f.run.run_id, task.id)).status, 'interrupted')
  await assert.rejects(service.build(f.dataRoot, { items: [{ run_id: f.run.run_id, task_id: task.id }] }), /完整生成/)
})

test('background build returns while blocked, can stop via cancelBuild, and resumes the exact synthesized commit', async t => {
  const f = await fixture(t); let block = true, started
  const began = new Promise(resolve => { started = resolve })
  const service = new FaultInjectionService({
    generate: async ({ record }) => generated(record),
    git: async (cwd, args, signal) => {
      if (args[0] === 'push' && block) {
        started()
        await new Promise((resolve, reject) => {
          if (signal.aborted) reject(signal.reason)
          else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      }
      return injectionGit(cwd, args, signal)
    },
  })
  t.after(() => service.dispose())
  const task = await service.start(f); await wait(service)
  const accepted = await service.build(f.dataRoot, { items: [{ run_id: f.run.run_id, task_id: task.id }], background: true })
  assert.ok(['composing', 'pushing'].includes(accepted.status))
  await began
  const stopped = await service.cancelBuild(f.dataRoot, accepted.id)
  assert.equal(stopped.status, 'cancelled'); assert.match(stopped.error, /已停止/)
  block = false
  const resumed = await service.build(f.dataRoot, { build_id: accepted.id })
  assert.equal(resumed.status, 'pushed', resumed.error)
  assert.equal(resumed.repositories[0].commit, stopped.repositories[0].commit)
})

test('queued build can be cancelled without waiting for the branch owner', async t => {
  const f = await fixture(t)
  let release, began
  const held = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { began = resolve })
  const service = new FaultInjectionService({
    generate: async ({ record }) => generated(record),
    git: async (cwd, args, signal) => {
      if (args[0] === 'push' && args[1] === 'origin') { began(); await held }
      return injectionGit(cwd, args, signal)
    },
  })
  t.after(() => service.dispose())
  const a = await service.start(f), b = await service.start(f); await wait(service)
  const buildA = await service.build(f.dataRoot, { items: [{ run_id: f.run.run_id, task_id: a.id }], background: true })
  await started
  const buildB = await service.build(f.dataRoot, { items: [{ run_id: f.run.run_id, task_id: b.id }], background: true })
  let timer
  try {
    const cancelled = await Promise.race([
      service.cancelBuild(f.dataRoot, buildB.id),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('queued cancelBuild blocked behind owner')), 1500) }),
    ])
    assert.equal(cancelled.status, 'cancelled')
    assert.equal((await service.readBuild(f.dataRoot, buildA.id)).status, 'pushing')
  } finally { clearTimeout(timer); release(); await wait(service) }
})

test('retry preserves captured cases and resolved baseline in a new task', async t => {
  const f = await fixture(t); let fail = true
  const service = new FaultInjectionService({ generate: async ({ record }) => { if (fail) throw Error('model failed'); return generated(record) } })
  t.after(() => service.dispose())
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
  t.after(() => service.dispose())
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
  t.after(() => service.dispose())
  const task = await service.start(f); await wait(service)
  const failed = await service.read(f.dataRoot, f.run.run_id, task.id)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.failure_phase, 'preparing')
  assert.match(failed.error, /Filename too long/)
  assert.equal(generatedCount, 0)
  assert.equal(await injectionGit(f.repositories[0].source_path, ['status', '--porcelain']), '')
})

test('dirty and linked original does not block generation or build, and uncommitted edits are preserved untouched', async t => {
  const f = await fixture(t)
  const source = f.repositories[0].source_path
  // Create both an untracked file and uncommitted tracked modification on main.c!
  await writeFile(path.join(source, 'local-only.txt'), 'original workspace draft')
  const dirtyMain = original + '// developer unsaved local edit\n'
  await writeFile(path.join(source, 'main.c'), dirtyMain)
  f.input.repositories[0].linked = true
  let captured
  const service = new FaultInjectionService({ generate: async ({ record, prompt }) => {
    captured = record
    assert.match(prompt, /分析基线与本次基线不同则重新定位/)
    return generated(record)
  } })
  t.after(() => service.dispose())
  const task = await service.start(f); await wait(service)
  const ready = await service.read(f.dataRoot, f.run.run_id, task.id)
  assert.equal(ready.status, 'ready', ready.error)
  assert.equal(captured.source_repositories[0].working_tree_dirty, true)
  await assert.rejects(readFile(path.join(ready.repositories[0].path, 'local-only.txt')), { code: 'ENOENT' })

  const built = await service.build(f.dataRoot, { items: [{ run_id: f.run.run_id, task_id: ready.id }] })
  assert.equal(built.status, 'pushed', built.error)
  assert.equal(await readFile(path.join(source, 'local-only.txt'), 'utf8'), 'original workspace draft')
  assert.equal(await readFile(path.join(source, 'main.c'), 'utf8'), dirtyMain)
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
  t.after(() => service.dispose())
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
