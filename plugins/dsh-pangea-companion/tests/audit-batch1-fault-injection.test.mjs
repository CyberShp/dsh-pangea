import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { FaultInjectionService, injectionGit } from '../src/fault-injection.js'
import { parseVerificationLog } from '../src/fault-injection-candidates.js'

const original = [
  '#include <stdio.h>',
  'int work(void) { return 0; }',
  '',
].join('\n')

const instrumented = [
  '#include <stdio.h>',
  'int work(void) { puts("hit:A PANGEA_FI"); return -1; }',
  '',
].join('\n')

async function makeFixture(t, { repos = ['target'], pipelines = {} } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-batch1-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dataRoot = path.join(root, 'data')
  await mkdir(dataRoot, { recursive: true })
  await mkdir(path.join(dataRoot, '.pangea', 'repository-settings'), { recursive: true })
  await mkdir(path.join(dataRoot, '.pangea', 'fault-injection'), { recursive: true })
  await writeFile(path.join(dataRoot, '.pangea', 'fault-injection', 'commit-defaults.json'), JSON.stringify({ mode: 'default', explicit_default_mode: true }))

  const repositories = []
  for (const repo_id of repos) {
    const source = path.join(root, repo_id)
    const remote = path.join(root, `${repo_id}.git`)
    await mkdir(source, { recursive: true })
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
    await writeFile(
      path.join(dataRoot, '.pangea', 'repository-settings', `${repo_id}.json`),
      JSON.stringify({
        git_path: source,
        personal_branch: 'personal',
        remote: 'origin',
        ...(pipelines[repo_id] ? { pipeline_url: pipelines[repo_id] } : {}),
      }),
    )
    repositories.push({ repo_id, source_path: source, source_root: source, remote_path: remote, git: { commit }, base_ref: commit })
  }

  const cases = [{ projection_id: 'unit-0001/rec-000001', test_case_id: 'unit-0001/rec-000001', title: '场景 A', execution_readiness: 'needs_instrumentation' }]
  const run = { run_id: 'run-b1', repositories: repos, source_snapshot: { repositories }, details: { test_cases: cases } }
  const input = { case_keys: ['unit-0001/rec-000001'], repositories, provider_id: 'pangea-opencode', agent_model: 'fixture' }
  return { root, dataRoot, repositories, run, input }
}

async function createReadyTask(service, fix, repoSubset = null) {
  const repos = repoSubset ? fix.repositories.filter(r => repoSubset.includes(r.repo_id)) : fix.repositories
  const run = { ...fix.run, repositories: repos.map(r => r.repo_id), source_snapshot: { repositories: repos } }
  const input = { ...fix.input, repositories: repos }
  const started = await service.start({ dataRoot: fix.dataRoot, run, input, cwd: fix.root })
  await Promise.all([...service.active.values()].map(op => op.done))
  return await service.read(fix.dataRoot, run.run_id, started.id)
}

function makeGenerator() {
  return async ({ record }) => ({
    summary: 'batch1 fixture',
    delivery: {
      mode: 'product_package',
      build_requirement: 'default',
      replace_files: [{ artifact: 'libtarget.a', kind: 'static_lib', source_files: ['main.c'], build_evidence: 'CMakeLists.txt:1', post_replace_action: 'relink' }],
      marker_strings: ['PANGEA_FI'],
      artifact_verify: ['grep -aFq "PANGEA_FI" libtarget.a'],
    },
    points: [{ id: 'A', trigger_scope: { current_input: 'a', excluded_inputs: ['b'] }, repo_id: record.repositories[0].repo_id, path: 'main.c', trigger: 't', times: 1, action: 'fail', enable: 'PANGEA_FI=A', disable: 'unset', observe: 'hit:A' }],
    profiles: record.case_keys.map(case_key => ({ case_key, point_ids: ['A'], safety: { setup: [':'], negative_steps: [':'], negative_point_ids: ['A'], cleanup: [':'], cleanup_verify: [':'] }, steps: ['run'] })),
    edits: record.repositories.map(repo => ({ repo_id: repo.repo_id, path: 'main.c', before: original, after: instrumented })),
    limitations: [],
  })
}

async function pushManualCommit(root, remotePath, filename, content, message) {
  const work = await mkdtemp(path.join(root, 'manual-'))
  await injectionGit(work, ['clone', '-b', 'personal', remotePath, '.'])
  await injectionGit(work, ['config', 'user.name', 'Manual'])
  await injectionGit(work, ['config', 'user.email', 'manual@example.test'])
  await writeFile(path.join(work, filename), content)
  await injectionGit(work, ['add', filename])
  await injectionGit(work, ['commit', '-m', message])
  await injectionGit(work, ['push', 'origin', 'personal'])
  const head = await injectionGit(work, ['rev-parse', 'HEAD'])
  await rm(work, { recursive: true, force: true })
  return head
}

test('#8 confirming diverged overwrite for target does not authorize overwriting helper or a newly advanced HEAD', async t => {
  const fix = await makeFixture(t, { repos: ['target', 'helper'] })
  const service = new FaultInjectionService({ generate: makeGenerator() })
  const task = await createReadyTask(service, fix)

  const targetManualHead = await pushManualCommit(fix.root, fix.repositories[0].remote_path, 'manual-target.txt', 't1\n', 'manual on target')
  const helperManualHead = await pushManualCommit(fix.root, fix.repositories[1].remote_path, 'manual-helper.txt', 'h1\n', 'manual on helper')

  const first = await service.build(fix.dataRoot, {
    items: [{ run_id: task.run_id, task_id: task.id }],
  })
  assert.equal(first.status, 'failed')
  assert.equal(first.error_code, 'REMOTE_BRANCH_DIVERGED')
  assert.equal(first.remote_diverged_repo, 'target')
  assert.equal(first.remote_diverged_head, targetManualHead)

  // Step 1: Confirm only target -> helper must still be blocked and untouched
  const second = await service.build(fix.dataRoot, {
    build_id: first.id,
    confirmed_remote_diverged: { target: targetManualHead },
  })
  assert.equal(second.status, 'failed')
  assert.equal(second.error_code, 'REMOTE_BRANCH_DIVERGED')
  assert.equal(second.remote_diverged_repo, 'helper')
  assert.equal(second.remote_diverged_head, helperManualHead)
  assert.equal(await injectionGit(fix.repositories[1].remote_path, ['rev-parse', 'refs/heads/personal']), helperManualHead)
  const helperTree = await injectionGit(fix.repositories[1].remote_path, ['ls-tree', '-r', '--name-only', 'refs/heads/personal'])
  assert.match(helperTree, /manual-helper\.txt/)

  // Step 2: Advance helper after dialog -> old confirmation must NOT authorize overwriting the new HEAD
  const helperManualHead2 = await pushManualCommit(fix.root, fix.repositories[1].remote_path, 'manual-helper-2.txt', 'h2\n', 'manual 2 on helper')
  const staleConfirm = await service.build(fix.dataRoot, {
    build_id: first.id,
    confirmed_remote_diverged: { helper: helperManualHead },
  })
  assert.equal(staleConfirm.status, 'failed')
  assert.equal(staleConfirm.error_code, 'REMOTE_BRANCH_DIVERGED')
  assert.equal(staleConfirm.remote_diverged_repo, 'helper')
  assert.equal(staleConfirm.remote_diverged_head, helperManualHead2)
  assert.equal(await injectionGit(fix.repositories[1].remote_path, ['rev-parse', 'refs/heads/personal']), helperManualHead2)

  // Step 3: Confirm current helper HEAD -> both repos push cleanly
  const pushed = await service.build(fix.dataRoot, {
    build_id: first.id,
    confirmed_remote_diverged: { helper: helperManualHead2 },
  })
  assert.equal(pushed.status, 'pushed')
})

test('#9 changing source remote origin after failed build pushes retry to new remote B instead of old remote A', async t => {
  const fix = await makeFixture(t, { repos: ['target'] })
  const remoteA = fix.repositories[0].remote_path
  const remoteB = path.join(fix.root, 'target-b.git')
  await injectionGit(fix.root, ['init', '--bare', remoteB])
  await injectionGit(fix.repositories[0].source_path, ['push', remoteB, 'main', 'personal'])
  const initialA = await injectionGit(remoteA, ['rev-parse', 'refs/heads/personal'])
  const initialB = await injectionGit(remoteB, ['rev-parse', 'refs/heads/personal'])

  let failFirstPush = true
  const service = new FaultInjectionService({
    generate: makeGenerator(),
    git: async (cwd, args, signal) => {
      if (failFirstPush && args[0] === 'push') {
        failFirstPush = false
        throw new Error('simulated transport failure')
      }
      return injectionGit(cwd, args, signal)
    },
  })
  const task = await createReadyTask(service, fix)
  const failed = await service.build(fix.dataRoot, {
    items: [{ run_id: task.run_id, task_id: task.id }],
  })
  assert.equal(failed.status, 'failed')

  // Switch source repo origin from A to B before retrying
  await injectionGit(fix.repositories[0].source_path, ['remote', 'set-url', 'origin', remoteB])
  const retried = await service.build(fix.dataRoot, {
    build_id: failed.id,
  })
  assert.equal(retried.status, 'pushed')
  assert.equal(await injectionGit(remoteA, ['rev-parse', 'refs/heads/personal']), initialA, 'old remote A must remain unchanged')
  assert.notEqual(await injectionGit(remoteB, ['rev-parse', 'refs/heads/personal']), initialB, 'new remote B must receive the push')
})

test('#10 unreadable diverged git history stops push instead of overwriting manual commits', async t => {
  const fix = await makeFixture(t, { repos: ['target'] })
  const remote = fix.repositories[0].remote_path
  const manualHead = await pushManualCommit(fix.root, remote, 'manual.txt', 'keep me\n', 'manual commit')

  const service = new FaultInjectionService({
    generate: makeGenerator(),
    git: async (cwd, args, signal) => {
      if (args[0] === 'log' && args.some(a => a.includes('..'))) {
        throw new Error('stdout maxBuffer length exceeded')
      }
      return injectionGit(cwd, args, signal)
    },
  })
  const task = await createReadyTask(service, fix)
  const build = await service.build(fix.dataRoot, {
    items: [{ run_id: task.run_id, task_id: task.id }],
  })
  assert.equal(build.status, 'failed')
  assert.equal(build.error_code, 'REMOTE_HISTORY_UNREADABLE')
  assert.equal(await injectionGit(remote, ['rev-parse', 'refs/heads/personal']), manualHead)
  const tree = await injectionGit(remote, ['ls-tree', '-r', '--name-only', 'refs/heads/personal'])
  assert.match(tree, /manual\.txt/)
})

test('#11/#13 verification pins exact build_id across multiple builds and rejects contradictory result/verdict', async t => {
  const fix = await makeFixture(t, { repos: ['target'] })
  const service = new FaultInjectionService({ generate: makeGenerator() })
  const task = await createReadyTask(service, fix)

  const buildA = await service.build(fix.dataRoot, {
    items: [{ run_id: task.run_id, task_id: task.id }],
    commit_message: 'test: fault injection build A',
  })
  assert.equal(buildA.status, 'pushed')
  const buildB = await service.build(fix.dataRoot, {
    items: [{ run_id: task.run_id, task_id: task.id }],
    commit_message: 'test: fault injection build B',
  })
  assert.equal(buildB.status, 'pushed')
  assert.notEqual(buildA.id, buildB.id)

  // Ambiguous verification without build_id must be rejected when A and B both exist
  await assert.rejects(
    () => service.recordVerification(fix.dataRoot, task.run_id, task.id, {
      build: { package_id: 'pkg-A', package_sha256: 'sha-A' },
      verification: { case_key: 'unit-0001/rec-000001', result: 'passed', hits: 'A=1' },
    }),
    /请显式指定本次验证对应的构建 build_id/,
  )

  // #13 Contradictory passed + confirmed must be rejected
  await assert.rejects(
    () => service.recordVerification(fix.dataRoot, task.run_id, task.id, {
      build_id: buildA.id,
      build: { package_id: 'pkg-A', package_sha256: 'sha-A' },
      verification: { case_key: 'unit-0001/rec-000001', result: 'passed', execution_status: 'completed', risk_verdict: 'confirmed', hits: 'A=1' },
    }),
    /验证结果与风险结论组合无效/,
  )

  // Pinning build A must record build A's id and commit even after B was pushed
  const recordedA = await service.recordVerification(fix.dataRoot, task.run_id, task.id, {
    build_id: buildA.id,
    build: { package_id: 'pkg-A', package_sha256: 'sha-A' },
    verification: { case_key: 'unit-0001/rec-000001', result: 'passed', hits: 'A=1' },
  })
  const entryA = recordedA.verification.at(-1)
  assert.equal(entryA.build.build_id, buildA.id)
  assert.equal(entryA.build.package_id, 'pkg-A')
  assert.equal(entryA.build.commits[0].commit, buildA.repositories[0].commit)
  assert.equal(entryA.risk_verdict, 'excluded')

  // Recording build B must not inherit pkg-A
  const recordedB = await service.recordVerification(fix.dataRoot, task.run_id, task.id, {
    build_id: buildB.id,
    build: { package_id: 'pkg-B', package_sha256: 'sha-B' },
    verification: { case_key: 'unit-0001/rec-000001', result: 'failed', hits: 'A=1' },
  })
  const entryB = recordedB.verification.at(-1)
  assert.equal(entryB.build.build_id, buildB.id)
  assert.equal(entryB.build.package_id, 'pkg-B')
  assert.equal(entryB.build.commits[0].commit, buildB.repositories[0].commit)
  assert.equal(entryB.risk_verdict, 'confirmed')
})

test('#12 CTest zero-failure log is parsed as passed/excluded while real failure and infra error stay failed', () => {
  const caseKey = 'unit-0001/rec-000001'
  const task = {
    generation_contract_version: 3,
    case_keys: [caseKey],
    result: { points: [{ id: 'A', observe: 'hit:A' }], profiles: [{ case_key: caseKey, point_ids: ['A'] }] },
  }
  const greenLog = [
    `[PANGEA_CASE_BEGIN] case=${caseKey}`,
    'hit:A',
    '100% tests passed, 0 tests failed out of 1',
    `[PANGEA_CLEANUP] case=${caseKey} cleanup=0 verify=0`,
    `[PANGEA_CASE_END] case=${caseKey} status=0`,
  ].join('\n')
  const [green] = parseVerificationLog(greenLog, task).entries
  assert.deepEqual([green.result, green.execution_status, green.risk_verdict], ['passed', 'completed', 'excluded'])

  const redLog = [
    `[PANGEA_CASE_BEGIN] case=${caseKey}`,
    'hit:A',
    '0% tests passed, 1 tests failed out of 1',
    `[PANGEA_CLEANUP] case=${caseKey} cleanup=0 verify=0`,
    `[PANGEA_CASE_END] case=${caseKey} status=0`,
  ].join('\n')
  const [red] = parseVerificationLog(redLog, task).entries
  assert.deepEqual([red.result, red.execution_status, red.risk_verdict], ['failed', 'completed', 'confirmed'])

  const infraLog = [
    `[PANGEA_CASE_BEGIN] case=${caseKey}`,
    'hit:A',
    '100% tests passed, 0 tests failed out of 1',
    `[PANGEA_CLEANUP] case=${caseKey} cleanup=1 verify=0`,
    `[PANGEA_CASE_END] case=${caseKey} status=0`,
  ].join('\n')
  const [infra] = parseVerificationLog(infraLog, task).entries
  assert.deepEqual([infra.result, infra.execution_status, infra.risk_verdict], ['failed', 'infra_error', 'unknown'])
})

test('#14 selecting only target uses target pipeline URL rather than alphabetically earlier helper pipeline', async t => {
  const fix = await makeFixture(t, {
    repos: ['helper', 'target'],
    pipelines: {
      helper: 'https://ci.example.test/helper-pipeline',
      target: 'https://ci.example.test/target-pipeline',
    },
  })
  const service = new FaultInjectionService({ generate: makeGenerator() })
  const targetTask = await createReadyTask(service, fix, ['target'])

  const build = await service.build(fix.dataRoot, {
    items: [{ run_id: targetTask.run_id, task_id: targetTask.id }],
  })
  assert.equal(build.status, 'pushed')
  assert.equal(build.pipeline_url, 'https://ci.example.test/target-pipeline')
  assert.deepEqual(build.repository_pipelines, [{ repo_id: 'target', pipeline_url: 'https://ci.example.test/target-pipeline' }])
})
