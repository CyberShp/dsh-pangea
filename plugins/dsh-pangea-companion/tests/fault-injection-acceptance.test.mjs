import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, lstat, chmod } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { Readable } from 'node:stream'
import { FaultInjectionService, injectionGit, workspaceChanges, dedupeRepeatedValues, compactGenerationInput, checkInjectionResult, checkCmakeSyntax, collectConsistencyNotices } from '../src/fault-injection.js'
import { createInjectionGenerator } from '../src/fault-injection-agent.js'
import {
  DEFAULT_INTRANET_COMMIT_REGEX, MULTILINE_GATE_COMMIT_TEMPLATE, SINGLELINE_GATE_COMMIT_TEMPLATE,
  buildArtifactVerifyCommands, buildVerificationShellScript, extractRemoteHookRegex, mergeReplaceFilesFromTasks, normalizeCommitConfig,
  resolveCommitMessage, validateRawCommitMessage,
} from '../src/fault-injection-candidates.js'
import { faultInjectionRouteHandler } from '../src/index.js'
import { protectedBranchReason } from '../src/repositories/branch-policy.js'
import { disabledHooksPath } from '../src/repositories/git-environment.js'

const exec = promisify(execFile)
const original = 'int init_check(void) { return 0; }\n'
const instrumented = 'int init_check(void) {\n  if (pangea_fault_hit("INIT_HANG")) return -1;\n  return 0;\n}\n'
const LFS_HOOKS = ['post-checkout', 'post-commit', 'post-merge', 'pre-push']

async function fixture(t, { branch = 'main', personalBranch = 'personal', lfs = false, withCommitDefaults = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-acceptance-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dataRoot = path.join(root, 'data'); await mkdir(dataRoot)
  const source = path.join(root, 'target'), remote = path.join(root, 'target.git')
  await mkdir(source)
  await injectionGit(source, ['init', '-b', branch])
  await injectionGit(source, ['config', 'user.name', 'Fixture'])
  await injectionGit(source, ['config', 'user.email', 'fixture@example.test'])
  await writeFile(path.join(source, 'init.c'), original)
  if (lfs) {
    await writeFile(path.join(source, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\n')
    await writeFile(path.join(source, 'firmware.bin'), 'binary payload\n')
  }
  await injectionGit(source, ['add', '.'])
  await injectionGit(source, ['commit', '-m', 'baseline'])
  const commit = await injectionGit(source, ['rev-parse', 'HEAD'])
  const pushRefs = [branch]
  if (personalBranch && personalBranch !== branch) {
    await injectionGit(source, ['branch', personalBranch])
    pushRefs.push(personalBranch)
  }
  await injectionGit(root, ['init', '--bare', remote])
  await injectionGit(source, ['remote', 'add', 'origin', remote])
  await injectionGit(source, ['push', 'origin', ...pushRefs])
  await mkdir(path.join(dataRoot, '.pangea', 'repository-settings'), { recursive: true })
  await writeFile(path.join(dataRoot, '.pangea', 'repository-settings', 'target.json'), JSON.stringify({ git_path: source, personal_branch: personalBranch, remote: 'origin' }))
  if (withCommitDefaults) {
    await mkdir(path.join(dataRoot, '.pangea', 'fault-injection'), { recursive: true })
    await writeFile(path.join(dataRoot, '.pangea', 'fault-injection', 'commit-defaults.json'), JSON.stringify({ mode: 'default', explicit_default_mode: true }))
  }
  const repositories = [{ repo_id: 'target', source_path: source, remote_path: remote, git: { commit }, base_ref: commit }]
  const body = { title: '初始化挂起时 init_check 超时置失败', steps: ['使能挂起桩', '触发加载', '调用 init_check'], expected_results: ['约 4 秒后返回失败并打印各阶段耗时'], instrumentation: { points: [{ id: 'INIT_HANG', path: 'init.c' }] } }
  const cases = [{ projection_id: 'unit/CASE-HANG', test_case_id: 'unit/CASE-HANG', ...body, execution_readiness: 'needs_instrumentation',
    // The shape that made the real task input ~54KB: the same case repeated in its
    // source record and again inside each evidence entry.
    source_record: { record_id: 'rec-1', kind: 'test_case', body, evidence: [{ evidence_id: 'ev-1', source_record: { record_id: 'rec-1', kind: 'test_case', body } }] } }]
  const run = { run_id: 'run-acceptance', repositories: ['target'], source_snapshot: { repositories }, details: { test_cases: cases } }
  const input = { case_keys: ['unit/CASE-HANG'], repositories, provider_id: 'pangea-opencode', agent_model: 'fixture' }
  return { root, dataRoot, source, remote, repositories, run, input }
}
const generated = record => ({
  summary: '初始化第 9 步挂起',
  delivery: {
    mode: record?.delivery_mode || 'product_package',
    build_requirement: '标准产品配置即可编入，运行期通过控制变量启用',
    replace_files: [{ artifact: 'libinit.a', kind: 'static_lib', source_files: ['init.c'], build_evidence: 'CMakeLists.txt:1', post_replace_action: '替换静态库后重链' }],
    marker_strings: ['INIT_HANG'],
    artifact_verify: ['grep -aFq "INIT_HANG" libinit.a'],
  },
  points: [{ id: 'INIT_HANG', trigger_scope: { current_input: 'fixture operation argument', excluded_inputs: ['previous operations'] }, repo_id: 'target', path: 'init.c', action: '阻塞初始化', trigger: '控制文件存在', times: 1 }],
  profiles: record.case_keys.map(case_key => ({ case_key, point_ids: ['INIT_HANG'], safety: { setup: [':'], negative_steps: [':'], negative_point_ids: ['INIT_HANG'], cleanup: [':'], cleanup_verify: [':'] }, steps: ['touch /tmp/pangea_init_hang', 'reload', 'check timeout log'] })),
  edits: [{ repo_id: 'target', path: 'init.c', before: original, after: instrumented }],
  limitations: [],
})
const wait = service => Promise.all([...service.active.values()].map(operation => operation.done))
const untracked = async checkout => (await injectionGit(checkout, ['status', '--porcelain', '--untracked-files=all'])).split('\n').filter(Boolean)

test('LFS repositories: checkout leaves no hook scripts in the worktree and the task is accepted', async t => {
  try { await exec('git', ['lfs', 'version']) } catch { t.skip('git-lfs is not installed'); return }
  // A typical developer machine: LFS filters configured globally (git lfs install).
  const home = await mkdtemp(path.join(os.tmpdir(), 'pangea-lfs-home-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const saved = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL }
  process.env.GIT_CONFIG_GLOBAL = path.join(home, 'gitconfig')
  t.after(() => { if (saved.GIT_CONFIG_GLOBAL === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = saved.GIT_CONFIG_GLOBAL })
  await exec('git', ['lfs', 'install', '--skip-repo'], { env: process.env })
  const f = await fixture(t, { lfs: true })
  // Reproduce the original defect: an empty hooksPath makes LFS write its hooks
  // into the worktree root during checkout.
  const legacy = path.join(f.root, 'legacy')
  await exec('git', ['-c', 'core.hooksPath=', 'clone', '-q', '--no-checkout', '--', f.source, legacy], { env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' } })
  await exec('git', ['-c', 'core.hooksPath=', '-C', legacy, 'checkout', '-q', '--detach', 'HEAD'], { env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' } })
  assert.deepEqual((await readdir(legacy)).filter(name => LFS_HOOKS.includes(name)).sort(), LFS_HOOKS)

  const service = new FaultInjectionService({ generate: async ({ record }) => generated(record) })
  t.after(() => service.dispose())
  const task = await service.start({ ...f, cwd: f.root }); await wait(service)
  const ready = await service.read(f.dataRoot, f.run.run_id, task.id)
  assert.equal(ready.status, 'ready', ready.error)
  const checkout = ready.repositories[0].path
  assert.deepEqual(ready.repositories[0].workspace_baseline, [])
  assert.deepEqual((await readdir(checkout)).filter(name => LFS_HOOKS.includes(name)), [])
  assert.deepEqual(ready.notices, [])
  const built = await service.build(f.dataRoot, { items: [{ run_id: f.run.run_id, task_id: task.id }] })
  assert.equal(built.status, 'pushed', built.error)
  assert.deepEqual((await readdir(f.source)).filter(name => LFS_HOOKS.includes(name)), [], 'build push must never drop hooks into the user worktree')
  assert.equal(await readFile(path.join(f.source, 'init.c'), 'utf8'), original)
  assert.equal((await lstat(await disabledHooksPath())).isFile(), true)
})

test('files already present right after checkout are not attributed to the generator', async t => {
  const f = await fixture(t)
  const service = new FaultInjectionService({ generate: async ({ record }) => generated(record), git: async (cwd, args, signal) => {
    const output = await injectionGit(cwd, args, signal)
    // Simulate host checkout side effects (the four LFS hooks of the real incident).
    if (args[0] === 'checkout' && args[1] === '--detach') for (const name of LFS_HOOKS) await writeFile(path.join(cwd, name), '#!/bin/sh\ngit lfs\n')
    return output
  } })
  t.after(() => service.dispose())
  const task = await service.start(f); await wait(service)
  const ready = await service.read(f.dataRoot, f.run.run_id, task.id)
  assert.equal(ready.status, 'ready', ready.error)
  assert.deepEqual(ready.repositories[0].workspace_baseline.map(entry => entry.path).sort(), LFS_HOOKS)
  assert.deepEqual(ready.notices, [])
  assert.deepEqual(ready.repositories[0].files, ['init.c'])
  assert.doesNotMatch(ready.repositories[0].diff, /post-checkout|pre-push/)
  const built = await service.build(f.dataRoot, { items: [{ run_id: f.run.run_id, task_id: task.id }] })
  assert.equal(built.status, 'pushed', built.error)
  assert.deepEqual(await injectionGit(f.remote, ['ls-tree', '--name-only', 'refs/heads/personal']).then(out => out.split('\n').sort()), ['init.c'])
})

test('generator writes into its source copy: changes are recorded, discarded and only registered edits are committed', async t => {
  const f = await fixture(t)
  const service = new FaultInjectionService({ generate: async ({ record }) => {
    const checkout = record.repositories[0].path
    await writeFile(path.join(checkout, 'init.c'), '/* scratch edit */\n' + original)
    await writeFile(path.join(checkout, 'draft.py'), 'print(1)\n')
    return generated(record)
  } })
  t.after(() => service.dispose())
  const task = await service.start(f); await wait(service)
  const ready = await service.read(f.dataRoot, f.run.run_id, task.id)
  assert.equal(ready.status, 'ready', ready.error)
  assert.equal(ready.notices.length, 1); assert.match(ready.notices[0], /已丢弃/); assert.match(ready.notices[0], /draft\.py/)
  assert.deepEqual(ready.repositories[0].workspace_changes.map(item => `${item.change}:${item.path}`).sort(), ['added:draft.py', 'changed:init.c'])
  assert.doesNotMatch(ready.repositories[0].diff, /scratch edit|draft\.py/)
  assert.deepEqual(await untracked(ready.repositories[0].path), ['M  init.c'])
  const built = await service.build(f.dataRoot, { items: [{ run_id: f.run.run_id, task_id: task.id }] })
  assert.equal(built.status, 'pushed', built.error)
  assert.equal(await injectionGit(f.remote, ['show', 'refs/heads/personal:init.c']), instrumented.trimEnd())
})

test('a result that depends on the generator\'s own source edits is rejected, but stays reusable', async t => {
  const f = await fixture(t)
  const service = new FaultInjectionService({ generate: async ({ record }) => {
    const checkout = record.repositories[0].path, edited = '/* local */\n' + original
    await writeFile(path.join(checkout, 'init.c'), edited)
    return { ...generated(record), edits: [{ repo_id: 'target', path: 'init.c', before: edited, after: instrumented }] }
  } })
  t.after(() => service.dispose())
  const task = await service.start(f); await wait(service)
  const failed = await service.read(f.dataRoot, f.run.run_id, task.id)
  assert.equal(failed.status, 'failed'); assert.match(failed.error, /未唯一匹配/)
  assert.equal(failed.result_saved, true)
  assert.equal(await readFile(path.join(f.source, 'init.c'), 'utf8'), original)
})

test('reuse applies a saved result to a fresh checkout without calling the model', async t => {
  const f = await fixture(t); let calls = 0, failAdd = true
  const service = new FaultInjectionService({ generate: async ({ record }) => { calls++; return generated(record) }, git: async (cwd, args, signal) => {
    // Fail after the result was saved, like the acceptance gate did in the incident.
    if (args[0] === 'add' && failAdd) { failAdd = false; throw Object.assign(new Error('simulated acceptance failure'), { statusCode: 422 }) }
    return injectionGit(cwd, args, signal)
  } })
  t.after(() => service.dispose())
  const first = await service.start(f); await wait(service)
  const failed = await service.read(f.dataRoot, f.run.run_id, first.id)
  assert.equal(failed.status, 'failed'); assert.equal(failed.result_saved, true); assert.equal(calls, 1)
  const reused = await service.retry(f.dataRoot, f.run.run_id, first.id, f.root, { mode: 'reuse' }); await wait(service)
  const ready = await service.read(f.dataRoot, f.run.run_id, reused.id)
  assert.equal(ready.status, 'ready', ready.error)
  assert.equal(calls, 1, 'reuse must not start the generator')
  assert.equal(ready.reused_from.task_id, first.id)
  assert.match(ready.repositories[0].diff, /INIT_HANG/)
  const built = await service.build(f.dataRoot, { items: [{ run_id: f.run.run_id, task_id: reused.id }] })
  assert.equal(built.status, 'pushed', built.error)
  // Analysis directory stayed clean on main, so reusing again still matches with 0 model calls.
  const again = await service.retry(f.dataRoot, f.run.run_id, reused.id, f.root, { mode: 'reuse' }); await wait(service)
  const restubbed = await service.read(f.dataRoot, f.run.run_id, again.id)
  assert.equal(restubbed.status, 'ready', restubbed.error); assert.equal(calls, 1)
  // Once developer modifies the target lines on main, reuse fails cleanly.
  await writeFile(path.join(f.source, 'init.c'), 'int init_check(void) { return 1; }\n')
  await injectionGit(f.source, ['add', 'init.c'])
  await injectionGit(f.source, ['commit', '-m', 'upstream refactor'])
  const stale = await service.retry(f.dataRoot, f.run.run_id, reused.id, f.root, { mode: 'reuse' })
  await wait(service)
  const staleRead = await service.read(f.dataRoot, f.run.run_id, stale.id)
  assert.equal(staleRead.status, 'failed')
})

test('stale reuse explains that only relocation is needed; reference regeneration receives the saved result', async t => {
  const f = await fixture(t); const prompts = []
  const service = new FaultInjectionService({ generate: async ({ record, prompt, scratchDirectory }) => {
    prompts.push({ prompt, scratchDirectory })
    const cur = (await readFile(path.join(record.repositories[0].path, 'init.c'), 'utf8')).replace(/\r\n/g, '\n')
    return { ...generated(record), edits: [{ repo_id: 'target', path: 'init.c', before: cur, after: instrumented }] }
  } })
  t.after(() => service.dispose())
  const first = await service.start(f); await wait(service)
  // Advance f.source so saved before-anchor no longer matches current HEAD
  await writeFile(path.join(f.source, 'init.c'), 'int init_check(void) { return 2; }\n')
  await injectionGit(f.source, ['add', 'init.c'])
  await injectionGit(f.source, ['commit', '-m', 'upstream modifies init_check'])
  const stale = await service.retry(f.dataRoot, f.run.run_id, first.id, f.root, { mode: 'reuse' }); await wait(service)
  const failed = await service.read(f.dataRoot, f.run.run_id, stale.id)
  assert.equal(failed.status, 'failed'); assert.match(failed.error, /复用的结果与当前源码不一致.*参考上次结果重新生成/s)
  const referenced = await service.retry(f.dataRoot, f.run.run_id, stale.id, f.root, { mode: 'reference' }); await wait(service)
  const last = prompts.at(-1)
  assert.match(last.prompt, /参考结果：.*reference-result\.json/)
  assert.match(last.prompt, /上一次未完成的原因：复用的结果与当前源码不一致/)
  assert.deepEqual(JSON.parse(await readFile(path.join(last.scratchDirectory, 'reference-result.json'), 'utf8')).edits, generated({ case_keys: f.input.case_keys }).edits)
  const referencedRead = await service.read(f.dataRoot, f.run.run_id, referenced.id)
  assert.equal(referencedRead.status, 'ready', referencedRead.error)
  assert.equal(referencedRead.reference_from.task_id, stale.id)
  await assert.rejects(service.retry(f.dataRoot, f.run.run_id, first.id, f.root, { mode: 'bogus' }), /未知重试方式/)
})

test('tasks written before result_saved existed expose their saved result for reuse', async t => {
  const f = await fixture(t)
  const service = new FaultInjectionService({ generate: async ({ record }) => generated(record) })
  t.after(() => service.dispose())
  const task = await service.start(f); await wait(service)
  const directory = await service.directory(f.dataRoot, f.run.run_id, task.id)
  const record = JSON.parse(await readFile(path.join(directory, 'task.json'), 'utf8'))
  delete record.result_saved; record.status = 'failed'; record.generation_complete = false
  record.error = 'Agent 直接修改了源码副本：target；本轮不混入未登记修改'
  await writeFile(path.join(directory, 'task.json'), JSON.stringify(record))
  assert.equal((await service.read(f.dataRoot, f.run.run_id, task.id)).result_saved, true)
})

test('master* and develop* are never used as injection branches', async t => {
  for (const name of ['master', 'master-2026', 'develop', 'develop_v3', 'refs/heads/develop/x', 'Develop']) assert.ok(protectedBranchReason(name), name)
  for (const name of ['main', 'zhangsan/fault', 'feature/develop', 'personal-master', '']) assert.equal(protectedBranchReason(name), '', name)
  const f = await fixture(t, { personalBranch: 'develop_v3' })
  const service = new FaultInjectionService({ generate: async () => assert.fail('must not generate') })
  await assert.rejects(service.start(f), /正式出包分支/)
  assert.equal((await service.list(f.dataRoot, f.run.run_id)).length, 0)
})

test('generation input is de-duplicated losslessly and much smaller than the task record', async t => {
  const f = await fixture(t); let inputPath
  const service = new FaultInjectionService({ generate: async ({ record, inputPath: file, prompt }) => {
    inputPath = file; assert.match(prompt, /\$same_as/); assert.match(prompt, /不必检查换行符/); assert.match(prompt, /set -euo pipefail/); assert.match(prompt, /http_code/); assert.match(prompt, /bash 3\.2/); assert.match(prompt, /\$\{VAR\}/); return generated(record)
  } })
  const task = await service.start(f); await wait(service)
  const ready = await service.read(f.dataRoot, f.run.run_id, task.id)
  const input = JSON.parse(await readFile(inputPath, 'utf8'))
  assert.ok(ready.input_stats.compact_bytes < ready.input_stats.full_bytes / 2, JSON.stringify(ready.input_stats))
  assert.equal(input.repositories[0].path, ready.repositories[0].path)
  for (const key of ['status', 'provider_id', 'agent_model', 'source_repositories', 'verification', 'pipeline_url']) assert.equal(Object.hasOwn(input, key), false, key)
  const resolve = (node, root) => {
    if (Array.isArray(node)) return node.map(item => resolve(item, root))
    if (node && typeof node === 'object') {
      if (Object.keys(node).length === 1 && typeof node.$same_as === 'string') {
        const target = node.$same_as.slice(1).match(/\.[^.[\]]+|\[\d+\]/g).reduce((value, part) => part.startsWith('[') ? value[Number(part.slice(1, -1))] : value[part.slice(1)], root)
        return resolve(target, root)
      }
      return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, resolve(value, root)]))
    }
    return node
  }
  const { content_hash, ...expectedCase } = ready.cases[0]
  assert.deepEqual(resolve(input.cases, input), [expectedCase])
  assert.match(JSON.stringify(input), /\$same_as/)
})

test('workspace comparison helpers', () => {
  const baseline = [{ status: '??', path: 'pre-push', sha256: 'a' }]
  assert.deepEqual(workspaceChanges(baseline, baseline), [])
  assert.deepEqual(workspaceChanges(baseline, [...baseline, { status: '??', path: 'x', sha256: 'b' }]), [{ path: 'x', status: '??', change: 'added' }])
  assert.deepEqual(workspaceChanges(baseline, [{ status: '??', path: 'pre-push', sha256: 'c' }]), [{ path: 'pre-push', status: '??', change: 'changed' }])
  assert.deepEqual(workspaceChanges(baseline, []), [{ path: 'pre-push', status: '??', change: 'reverted' }])
  const long = 'x'.repeat(200)
  assert.deepEqual(dedupeRepeatedValues({ a: long, b: [long, 'short', 'short'] }), { a: long, b: [{ $same_as: '$.a' }, 'short', 'short'] })
  const record = { id: 't', run_id: 'r', case_keys: [], repositories: [], cases: [], source_repositories: [] }
  assert.equal(compactGenerationInput(record, '/a').analysis_source, '/a')
})

test('C/C++ driver repo: host pre-scans harness facts, deduplicates 80+ char source_evidence, inlines input JSON, and accepts Option A gtest stub', async t => {
  const f = await fixture(t)
  const drvPath = 'root/frontend/nof/mod/module/drv_main.c'
  const drvSrc = [
    '#ifdef __XXX_ASAN__',
    '#define DRV_INIT_WAIT_LOOPS 1500',
    '#else',
    '#define DRV_INIT_WAIT_LOOPS 200',
    '#endif',
    'int drv_wait_ready(int *state) {',
    '  for (int i = 0; i < DRV_INIT_WAIT_LOOPS; ++i) {',
    '    if (*state == 1) return 0;',
    '  }',
    '  return -1;',
    '}',
    '',
  ].join('\n')
  await mkdir(path.join(f.source, path.dirname(drvPath)), { recursive: true })
  await writeFile(path.join(f.source, drvPath), drvSrc)
  await mkdir(path.join(f.source, 'test'), { recursive: true })
  await writeFile(path.join(f.source, 'test/CMakeLists.txt'), [
    'file(GLOB TEST_SRCS "*.cpp")',
    'add_executable(mod_ut ${TEST_SRCS})',
    'target_compile_definitions(mod_ut PRIVATE -DXXX_SIMU_FAULT)',
    'add_test(NAME mod_ut COMMAND mod_ut)',
  ].join('\n'))
  await writeFile(path.join(f.source, 'test/test_existing.cpp'), [
    '#include <gtest/gtest.h>',
    'extern "C" int drv_wait_ready(int *state);',
    '// drv_wait_ready(&commented_out_should_not_match);',
    'TEST_F(DrvSuite, Smoke) { int ready = 1; EXPECT_EQ(0, drv_wait_ready(&ready)); }',
    '',
  ].join('\n'))
  await injectionGit(f.source, ['add', '.'])
  await injectionGit(f.source, ['commit', '-m', 'add driver module and gtest suite'])
  await injectionGit(f.source, ['push', 'origin', 'main'])
  const head = await injectionGit(f.source, ['rev-parse', 'HEAD'])
  f.repositories[0].git.commit = head
  f.repositories[0].base_ref = head

  const evidence = [
    `target:${drvPath}:1-5`,
    `target:${drvPath}:6-11`,
  ]
  const caseBody = {
    title: '初始化挂起等待超时置失败（8 处未覆盖分支）',
    steps: ['使能挂起桩', '调用 drv_wait_ready 观察超时返回 -1'],
    expected_results: ['非 ASAN 约 4s / ASAN 约 30s 超时返回 -1'],
    source_evidence: evidence,
    linked_risk_ids: ['RISK-TIMEOUT-01'],
    linked_gap_ids: ['GAP-TIMEOUT-01'],
  }
  f.run.details = {
    test_cases: [{
      projection_id: 'unit/CASE-HANG',
      test_case_id: 'unit/CASE-HANG',
      ...caseBody,
      execution_readiness: 'needs_instrumentation',
      source_record: {
        record_id: 'rec-drv',
        kind: 'test_case',
        body: { ...caseBody, source_evidence: [...evidence] },
        evidence: [
          { evidence_id: 'ev-a', source_evidence: [...evidence] },
          { evidence_id: 'ev-b', source_evidence: [...evidence] },
        ],
      },
    }],
    risks: [{
      risk_id: 'RISK-TIMEOUT-01',
      title: '初始化挂起超时未置失败',
      dimension: 'reliability',
      reproduction: '下游队列未置就绪位时持续等待',
      system_outcome: '超过 DRV_INIT_WAIT_LOOPS 后置失败',
      observation: '返回值 -1',
      source_evidence: [...evidence],
    }],
    coverage_gaps: [{
      gap_id: 'GAP-TIMEOUT-01',
      file: drvPath,
      line_range: '6-11',
      uncovered_branches: 8,
      reason: '正常初始化无法触发超时分支',
      source_evidence: [...evidence],
    }],
  }

  let capturedPrompt = '', capturedInput = null
  const service = new FaultInjectionService({
    generate: async ({ record, inputPath, prompt }) => {
      capturedPrompt = prompt
      capturedInput = JSON.parse(await readFile(inputPath, 'utf8'))
      return {
        summary: '在 XXX_SIMU_FAULT 宏下植入挂起开关并新增 gtest 覆盖超时分支',
        delivery: {
          mode: 'unit_test',
          build_requirement: '单元测试目标 mod_ut 默认定义 XXX_SIMU_FAULT',
          replace_files: [{ artifact: 'mod_ut', kind: 'executable', source_files: [drvPath], build_evidence: 'test/CMakeLists.txt:2', post_replace_action: '重新编译运行 mod_ut' }],
          marker_strings: ['g_drv_simu_hang'],
          artifact_verify: ['grep -aFq "g_drv_simu_hang" build/test/mod_ut'],
        },
        points: [{ id: 'DRV_WAIT_HANG', trigger_scope: { current_input: 'fixture operation argument', excluded_inputs: ['previous operations'] }, repo_id: 'target', path: drvPath, action: '挂起就绪位', trigger: 'drv_simu_hang_count > 0', times: 1, observe: '[FI_HIT:DRV_WAIT_HANG]' }],
        profiles: [{ case_key: 'unit/CASE-HANG', point_ids: ['DRV_WAIT_HANG'], safety: { setup: [':'], negative_steps: [':'], negative_point_ids: ['DRV_WAIT_HANG'], cleanup: [':'], cleanup_verify: [':'] }, steps: ['cmake -B build && cmake --build build --target mod_ut', './build/test/mod_ut --gtest_filter=DrvTimeout.HangTimeout'] }],
        edits: [
          {
            repo_id: 'target',
            path: drvPath,
            before: '    if (*state == 1) return 0;',
            after: '#ifdef XXX_SIMU_FAULT\n    extern int g_drv_simu_hang;\n    if (g_drv_simu_hang > 0) continue;\n#endif\n    if (*state == 1) return 0;',
          },
          {
            repo_id: 'target',
            path: 'test/test_drv_timeout.cpp',
            before: null,
            after: '#include <gtest/gtest.h>\nint g_drv_simu_hang = 0;\nextern "C" int drv_wait_ready(int *state);\nTEST(DrvTimeout, HangTimeout) {\n  int s = 1;\n  EXPECT_EQ(0, drv_wait_ready(&s));\n  g_drv_simu_hang = 1;\n  EXPECT_EQ(-1, drv_wait_ready(&s));\n  g_drv_simu_hang = 0;\n  EXPECT_EQ(0, drv_wait_ready(&s));\n}\n',
          },
        ],
        limitations: [],
      }
    },
  })
  const task = await service.start({ ...f, input: { ...f.input, delivery_mode: 'unit_test' } }); await wait(service)
  const ready = await service.read(f.dataRoot, f.run.run_id, task.id)
  assert.equal(ready.status, 'ready', ready.error)
  assert.match(capturedPrompt, /<task_input_json>[\s\S]*<\/task_input_json>/)
  assert.match(capturedPrompt, /无需首轮再调用 read 读取/)
  assert.match(capturedPrompt, /Option A/)
  assert.equal(capturedInput.analysis_context.risks[0].risk_id, 'RISK-TIMEOUT-01')
  assert.equal(capturedInput.analysis_context.coverage_gaps[0].coverage_id, 'GAP-TIMEOUT-01')
  assert.equal(capturedInput.cases[0].source_evidence.$same_as, '$.analysis_context.risks[0].source_evidence')
  assert.equal(capturedInput.cases[0].source_record.body.$same_as !== undefined || capturedInput.cases[0].source_record.evidence[0].source_evidence.$same_as === '$.analysis_context.risks[0].source_evidence', true)
  const harness = capturedInput.repositories[0].harness
  assert.ok(harness)
  assert.ok(harness.conditional_macros.some(item => item.location === `${drvPath}:1` && item.code.includes('__XXX_ASAN__')))
  assert.ok(harness.conditional_macros.some(item => item.code.includes('DRV_INIT_WAIT_LOOPS 1500')))
  assert.deepEqual(harness.fault_macros, [{ name: 'XXX_SIMU_FAULT', defined_in: ['test/CMakeLists.txt'], module_usage_count: 0, conditional_or_test: true }])
  assert.equal(harness.cmake_rules[0].source_collection, 'file_glob')
  assert.equal(harness.cmake_rules[0].configure_depends, false)
  assert.equal(harness.test_directories.find(item => item.directory === 'test')?.framework, 'gtest')
  assert.ok(Array.isArray(harness.target_snippets) && harness.target_snippets.length >= 1)
  assert.equal(harness.target_snippets[0].path, drvPath)
  assert.match(harness.target_snippets[0].content, /1: #ifdef __XXX_ASAN__/)
  assert.match(harness.target_snippets[0].content, /drv_wait_ready/)
  assert.ok(harness.sample_test_snippet)
  assert.match(harness.sample_test_snippet.content, /1: #include <gtest\/gtest\.h>/)
  assert.match(capturedPrompt, /target_snippets/)
  assert.match(capturedPrompt, /禁止放入空字符串/)
  assert.deepEqual(ready.repositories[0].files.sort(), [drvPath, 'test/test_drv_timeout.cpp'])
})

test('checkInjectionResult guards against no-op edits and unlinked explicit_list CMake test files', () => {
  const baseRecord = {
    case_keys: ['unit/A'],
    repositories: [{
      repo_id: 'target',
      harness: {
        cmake_rules: [{ path: 'test/CMakeLists.txt', directory: 'test', source_collection: 'explicit_list', ctest_or_gtest: true }],
      },
    }],
  }
  const baseValue = {
    points: [{ id: 'P1', trigger_scope: { current_input: 'fixture operation argument', excluded_inputs: ['previous operations'] }, repo_id: 'target', path: 'src/a.c' }],
    profiles: [{ case_key: 'unit/A', point_ids: ['P1'], safety: { setup: [':'], negative_steps: [':'], negative_point_ids: ['P1'], cleanup: [':'], cleanup_verify: [':'] }, steps: ['./run_ut'] }],
    edits: [{ repo_id: 'target', path: 'test/new_test.cpp', before: null, after: 'TEST(A, B) {}\n' }],
  }
  assert.throws(() => checkInjectionResult(baseValue, baseRecord), /显式构建列表.*test\/CMakeLists\.txt/)
  assert.doesNotThrow(() => checkInjectionResult({
    ...baseValue,
    edits: [...baseValue.edits, { repo_id: 'target', path: 'test/CMakeLists.txt', before: 'add_executable(ut a.cpp)', after: 'add_executable(ut a.cpp new_test.cpp)' }],
  }, baseRecord))
  assert.throws(() => checkInjectionResult({
    ...baseValue,
    edits: [{ repo_id: 'target', path: 'src/a.c', before: 'return 0;', after: 'return 0;' }],
  }, baseRecord), /代码修改前后内容相同/)
})

test('createInjectionGenerator interrupts runaway exploration on softToolCalls, wraps up in same session, and persists telemetry', async t => {
  const f = await fixture(t)
  await mkdir(path.join(f.root, '.agents', 'pangea'), { recursive: true })
  await writeFile(path.join(f.root, '.agents', 'pangea', 'dsh.md'), 'fixture')
  let cancelCalls = 0, continuePrompts = []
  const runtime = {
    apiProxy: {},
    agents: { get: () => ({ id: 'parent-session' }) },
    subagents: {
      start: async (_providerId, req) => {
        req.onSessionEvent({ type: 'turn_start' })
        let step = 0
        const firstTurn = new Promise(resolve => {
          const timer = setInterval(() => {
            step += 1
            req.onSessionEvent({
              type: 'session_update',
              update: { sessionUpdate: 'tool_call', toolCallId: `call-${step}`, kind: step === 1 ? 'read' : 'bash', status: 'completed' },
            })
            if (step === 2) req.onSessionEvent({ type: 'session_update', update: { sessionUpdate: 'usage_update', used: 180000, size: 200000 } })
            if (step === 3) {
              req.onSessionEvent({ type: 'session_update', update: { sessionUpdate: 'usage_update', used: 15000, size: 200000 } })
              clearInterval(timer)
            }
          }, 15)
          t.after(() => clearInterval(timer))
          req.signal.addEventListener('abort', () => { clearInterval(timer); resolve({ stopReason: 'aborted' }) }, { once: true })
        })
        return {
          id: 'worker-1',
          remoteSessionId: 'remote-1',
          result: firstTurn,
          readDiagnostics: () => ({ activeTools: 0, toolCalls: step, toolFailures: 0 }),
          cancelTurn: async () => { cancelCalls += 1; return { confirmed: true } },
          continuePrompt: async promptParts => {
            req.onSessionEvent({ type: 'turn_start' })
            continuePrompts.push(promptParts[0].text)
            const payload = generated({ case_keys: f.input.case_keys })
            await writeFile(path.join(req.scratchDirectory, 'result.json'), JSON.stringify(payload))
            return { stopReason: 'completed' }
          },
          dispose: async () => {},
        }
      },
    },
  }
  const generator = createInjectionGenerator(runtime, {
    resolveModel: async () => 'fixture/fast-model',
    createSession: async () => 'parent-session',
    budget: { softToolCalls: 3, pollMs: 20 },
  })
  const service = new FaultInjectionService({ generate: generator })
  const task = await service.start({ ...f, cwd: f.root }); await wait(service)
  const ready = await service.read(f.dataRoot, f.run.run_id, task.id)
  assert.equal(ready.status, 'ready', ready.error)
  assert.equal(cancelCalls, 1)
  assert.equal(continuePrompts.length, 1)
  assert.match(continuePrompts[0], /已达到探索步数\/耗时预算上限/)
  assert.ok(ready.telemetry)
  assert.equal(ready.telemetry.budget_wrapup_triggered, true)
  assert.equal(ready.telemetry.budget_wrapup_reason, 'tool_budget')
  assert.equal(ready.telemetry.turns, 2)
  assert.equal(ready.telemetry.compactions, 1)
  assert.equal(ready.telemetry.max_context_tokens, 180000)
  assert.deepEqual(ready.telemetry.tool_kinds, { read: 1, bash: 2 })
})

test('Round 3 blank separator steps are normalized cleanly and generated bash script passes bash -n', async t => {
  const f = await fixture(t)
  const rawSteps = []
  for (let section = 1; section <= 6; section++) {
    rawSteps.push(`# section ${section}`)
    for (let idx = 1; idx <= 4; idx++) rawSteps.push(`echo "sec=${section} step=${idx}"`)
    rawSteps.push(section % 2 === 0 ? '   ' : '')
  }
  rawSteps.push('# final verification', 'echo "[FI_HIT:INIT_HANG]"', 'echo "done"')
  assert.equal(rawSteps.length, 39)

  const service = new FaultInjectionService({
    generate: async ({ outputPath }) => {
      const payload = {
        ...generated({ case_keys: f.input.case_keys }),
        profiles: [{ case_key: 'unit/CASE-HANG', point_ids: ['INIT_HANG'], safety: { setup: [':'], negative_steps: [':'], negative_point_ids: ['INIT_HANG'], cleanup: [':'], cleanup_verify: [':'] }, steps: rawSteps }],
        limitations: ['ASAN 下超时约 30s', '', '  ', '正常构建约 4s'],
      }
      await writeFile(outputPath, JSON.stringify(payload, null, 2))
      return payload
    },
  })
  const task = await service.start(f); await wait(service)
  const ready = await service.read(f.dataRoot, f.run.run_id, task.id)
  assert.equal(ready.status, 'ready', ready.error)
  assert.equal(ready.result.profiles[0].steps.length, 33)
  assert.ok(ready.result.profiles[0].steps.every(step => step.trim().length > 0))
  assert.deepEqual(ready.result.limitations, ['ASAN 下超时约 30s', '正常构建约 4s'])

  const script = buildVerificationShellScript(ready)
  const scriptPath = path.join(f.root, 'verify-round3.sh')
  await writeFile(scriptPath, script, 'utf8')
  await exec('bash', ['-n', scriptPath])

  assert.throws(() => checkInjectionResult({
    points: [{ id: 'INIT_HANG', trigger_scope: { current_input: 'fixture operation argument', excluded_inputs: ['previous operations'] }, repo_id: 'target', path: 'init.c' }],
    profiles: [{ case_key: 'unit/CASE-HANG', point_ids: ['INIT_HANG'], safety: { setup: [':'], negative_steps: [':'], negative_point_ids: ['INIT_HANG'], cleanup: [':'], cleanup_verify: [':'] }, steps: ['', '   '] }],
    edits: [{ repo_id: 'target', path: 'init.c', before: original, after: instrumented }],
  }, { case_keys: ['unit/CASE-HANG'], repositories: [{ repo_id: 'target' }] }), /缺少可读取的桩点引用或执行说明/)
})

test('HTTP revalidate recovers hotfixed generation/result.json and aborted tasks in-place with zero model calls', async t => {
  const f = await fixture(t)
  let modelCalls = 0
  const service = new FaultInjectionService({
    generate: async ({ outputPath }) => {
      modelCalls += 1
      const broken = {
        ...generated({ case_keys: f.input.case_keys }),
        edits: [{ repo_id: 'target', path: 'init.c', before: 'int missing_symbol(void) { return 99; }\n', after: instrumented }],
      }
      await writeFile(outputPath, JSON.stringify(broken, null, 2))
      return broken
    },
  })
  const created = await service.start(f); await wait(service)
  const failed = await service.read(f.dataRoot, f.run.run_id, created.id)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.result_saved, true)
  assert.equal(modelCalls, 1)

  // Hotfix generation/result.json on disk (exact user workflow when manually repairing result.json)
  const generationResultPath = path.join(f.dataRoot, '.pangea', 'fault-injection', f.run.run_id, created.id, 'generation', 'result.json')
  const fixed = generated({ case_keys: f.input.case_keys })
  await new Promise(resolve => setTimeout(resolve, 15))
  await writeFile(generationResultPath, JSON.stringify(fixed, null, 2))

  // Invoke POST /api/pangea-companion/fault-injection with action: 'revalidate'
  const body = JSON.stringify({ action: 'revalidate', run_id: f.run.run_id, task_id: created.id })
  const req = Readable.from([Buffer.from(body)])
  req.url = '/api/pangea-companion/fault-injection'
  req.method = 'POST'
  req.headers = { 'sec-fetch-site': 'same-origin' }
  let statusCode = 0, rawBody = ''
  await faultInjectionRouteHandler(
    req,
    { writeHead(code) { statusCode = code }, end(chunk) { rawBody = chunk } },
    service,
    {},
    { resolveRoot: async () => f.dataRoot, readRun: async () => f.run },
  )
  assert.equal(statusCode, 200, rawBody)
  const response = JSON.parse(rawBody)
  assert.equal(response.status, 'ok')
  assert.equal(response.task.id, created.id)
  assert.equal(modelCalls, 1)

  await wait(service)
  const ready = await service.read(f.dataRoot, f.run.run_id, created.id)
  assert.equal(ready.status, 'ready', ready.error)
  assert.match(ready.repositories[0].diff, /pangea_fault_hit\("INIT_HANG"\)/)

  const built = await service.build(f.dataRoot, { items: [{ run_id: f.run.run_id, task_id: created.id }] })
  assert.equal(built.status, 'pushed', built.error)

  // Also verify Round 4 rescue: task aborted before authored-result.json existed, with only generation/result.json on disk
  const f2 = await fixture(t)
  const abortedService = new FaultInjectionService({
    generate: async ({ outputPath }) => {
      await writeFile(outputPath, JSON.stringify(generated({ case_keys: f2.input.case_keys }), null, 2))
      throw new Error('simulated transport disconnect right after writing result.json')
    },
  })
  const abortedTask = await abortedService.start(f2); await wait(abortedService)
  const abortedRead = await abortedService.read(f2.dataRoot, f2.run.run_id, abortedTask.id)
  assert.equal(abortedRead.status, 'failed')
  assert.equal(abortedRead.result_saved, true)

  await abortedService.revalidate(f2.dataRoot, f2.run.run_id, abortedTask.id)
  await wait(abortedService)
  const rescued = await abortedService.read(f2.dataRoot, f2.run.run_id, abortedTask.id)
  assert.equal(rescued.status, 'ready', rescued.error)
})

test('real compiled C acceptance: multi-case batch shares one fault stub, compiles with cc, triggers fault hit and clean recovery', async t => {
  const f = await fixture(t)
  const cSource = [
    '#include <stdio.h>',
    '#include <stdlib.h>',
    '#include <string.h>',
    'int drv_init_step(int mode) {',
    '  if (mode < 0) return -2;',
    '  return 0;',
    '}',
    'int main(int argc, char **argv) {',
    '  int mode = argc > 1 ? atoi(argv[1]) : 0;',
    '  int rc = drv_init_step(mode);',
    '  printf("rc=%d\\n", rc);',
    '  return rc == 0 ? 0 : 1;',
    '}',
    '',
  ].join('\n')
  await writeFile(path.join(f.source, 'init.c'), cSource)
  await injectionGit(f.source, ['add', 'init.c'])
  await injectionGit(f.source, ['commit', '-m', 'c driver main'])
  await injectionGit(f.source, ['push', 'origin', 'main'])
  const head = await injectionGit(f.source, ['rev-parse', 'HEAD'])
  f.repositories[0].git.commit = head
  f.repositories[0].base_ref = head
  f.run.details = {
    test_cases: [
      { projection_id: 'unit/CASE-TIMEOUT', test_case_id: 'unit/CASE-TIMEOUT', title: '超时返回 -1', execution_readiness: 'needs_instrumentation', source_evidence: ['target:init.c:4-7'] },
      { projection_id: 'unit/CASE-RECOVER', test_case_id: 'unit/CASE-RECOVER', title: '关闭故障后恢复正常返回 0', execution_readiness: 'needs_instrumentation', source_evidence: ['target:init.c:4-7'] },
    ],
  }
  f.input = { ...f.input, case_keys: ['unit/CASE-TIMEOUT', 'unit/CASE-RECOVER'] }

  const service = new FaultInjectionService({
    generate: async () => ({
      summary: '在 drv_init_step 植入环境变量控制的单点故障桩，同时覆盖超时与恢复两条用例',
      delivery: {
        mode: 'product_package',
        build_requirement: '标准产品配置即可编入',
        replace_files: [{ artifact: 'drv_bin', kind: 'executable', source_files: ['init.c'], build_evidence: 'Makefile:1', post_replace_action: '替换可执行文件' }],
        marker_strings: ['DRV_FAULT', '[FI_HIT:DRV_TIMEOUT_STUB]'],
        artifact_verify: ['grep -aFq "DRV_FAULT" drv_bin'],
      },
      points: [{ id: 'DRV_TIMEOUT_STUB', trigger_scope: { current_input: 'fixture operation argument', excluded_inputs: ['previous operations'] }, repo_id: 'target', path: 'init.c', action: '强制返回 -1', enable: 'DRV_FAULT=1', disable: 'unset DRV_FAULT', observe: '[FI_HIT:DRV_TIMEOUT_STUB]' }],
      profiles: [
        { case_key: 'unit/CASE-TIMEOUT', point_ids: ['DRV_TIMEOUT_STUB'], safety: { setup: [':'], negative_steps: [':'], negative_point_ids: ['DRV_TIMEOUT_STUB'], cleanup: [':'], cleanup_verify: [':'] }, steps: ['cc init.c -o drv_bin', '', 'DRV_FAULT=1 ./drv_bin 0 || true'] },
        { case_key: 'unit/CASE-RECOVER', point_ids: ['DRV_TIMEOUT_STUB'], safety: { setup: [':'], negative_steps: [':'], negative_point_ids: ['DRV_TIMEOUT_STUB'], cleanup: [':'], cleanup_verify: [':'] }, steps: ['cc init.c -o drv_bin', 'unset DRV_FAULT && ./drv_bin 0'] },
      ],
      edits: [{
        repo_id: 'target',
        path: 'init.c',
        before: '  if (mode < 0) return -2;',
        after: '  const char *fault = getenv("DRV_FAULT");\n  if (fault && strcmp(fault, "1") == 0) {\n    printf("[FI_HIT:DRV_TIMEOUT_STUB]\\n");\n    return -1;\n  }\n  if (mode < 0) return -2;',
      }],
    }),
  })
  const created = await service.start(f); await wait(service)
  const ready = await service.read(f.dataRoot, f.run.run_id, created.id)
  assert.equal(ready.status, 'ready', ready.error)
  const built = await service.build(f.dataRoot, { items: [{ run_id: f.run.run_id, task_id: created.id }] })
  assert.equal(built.status, 'pushed', built.error)
  assert.equal(await readFile(path.join(f.source, 'init.c'), 'utf8'), cSource, 'analysis checkout must remain untouched')

  const patchedSourcePath = path.join(f.root, 'patched_init.c')
  await writeFile(patchedSourcePath, await injectionGit(f.remote, ['show', 'refs/heads/personal:init.c']))
  const binPath = path.join(f.root, 'drv_bin')
  await exec('cc', [patchedSourcePath, '-o', binPath])
  const faultRun = await exec(binPath, ['0'], { env: { ...process.env, DRV_FAULT: '1' } }).catch(err => err)
  assert.equal(faultRun.code, 1)
  assert.match(faultRun.stdout, /\[FI_HIT:DRV_TIMEOUT_STUB\]/)
  assert.match(faultRun.stdout, /rc=-1/)

  const cleanEnv = { ...process.env }
  delete cleanEnv.DRV_FAULT
  const recoverRun = await exec(binPath, ['0'], { env: cleanEnv })
  assert.match(recoverRun.stdout, /rc=0/)
})

test('existing_symbol_tests locates target C function calls in UT files and ignores commented-out lines', async t => {
  const f = await fixture(t)
  const drvPath = 'src/drv_wait.c'
  await mkdir(path.join(f.source, 'src'), { recursive: true })
  await writeFile(path.join(f.source, drvPath), [
    'static int helper_noop(void) { return 0; }',
    'int drv_wait_init_done(int timeout_ms) {',
    '  if (timeout_ms <= 0) return -1;',
    '  return helper_noop();',
    '}',
    '',
  ].join('\n'))
  await mkdir(path.join(f.source, 'test/ut'), { recursive: true })
  await writeFile(path.join(f.source, 'test/ut/drv_wait_ut.cpp'), [
    '#include <gtest/gtest.h>',
    'extern "C" int drv_wait_init_done(int timeout_ms);',
    '// drv_wait_init_done(999);',
    'TEST(DrvWaitUt, NormalReady) {',
    '  EXPECT_EQ(0, drv_wait_init_done(10));',
    '}',
    '',
  ].join('\n'))
  await injectionGit(f.source, ['add', '.'])
  await injectionGit(f.source, ['commit', '-m', 'add drv_wait and ut'])
  await injectionGit(f.source, ['push', 'origin', 'main'])
  const head = await injectionGit(f.source, ['rev-parse', 'HEAD'])
  f.repositories[0].git.commit = head
  f.repositories[0].base_ref = head
  f.run.details = {
    test_cases: [{
      projection_id: 'unit/CASE-HANG',
      test_case_id: 'unit/CASE-HANG',
      title: 'drv_wait_init_done 超时置失败',
      execution_readiness: 'needs_instrumentation',
      source_evidence: [`target:${drvPath}:2-5`],
    }],
  }
  let capturedInput = null, capturedPrompt = ''
  const service = new FaultInjectionService({
    generate: async ({ inputPath, prompt }) => {
      capturedPrompt = prompt
      capturedInput = JSON.parse(await readFile(inputPath, 'utf8'))
      return {
        summary: '补充超时桩',
        delivery: {
          mode: 'product_package',
          build_requirement: '标准产品配置即可编入',
          replace_files: [{ artifact: 'libdrv_wait.a', kind: 'static_lib', source_files: [drvPath], build_evidence: 'CMakeLists.txt:1', post_replace_action: '替换静态库并重链' }],
          marker_strings: ['return -1;'],
          artifact_verify: ['grep -aFq "return -1;" libdrv_wait.a'],
        },
        points: [{ id: 'WAIT_TIMEOUT', trigger_scope: { current_input: 'fixture operation argument', excluded_inputs: ['previous operations'] }, repo_id: 'target', path: drvPath, action: '返回 -1' }],
        profiles: [{ case_key: 'unit/CASE-HANG', point_ids: ['WAIT_TIMEOUT'], safety: { setup: [':'], negative_steps: [':'], negative_point_ids: ['WAIT_TIMEOUT'], cleanup: [':'], cleanup_verify: [':'] }, steps: ['echo ok'] }],
        edits: [{ repo_id: 'target', path: drvPath, before: '  return helper_noop();', after: '  return -1;' }],
      }
    },
  })
  const created = await service.start(f); await wait(service)
  const ready = await service.read(f.dataRoot, f.run.run_id, created.id)
  assert.equal(ready.status, 'ready', ready.error)
  const matches = capturedInput.repositories[0].harness?.existing_symbol_tests ?? []
  assert.ok(matches.some(item => item.symbol === 'drv_wait_init_done' && item.path === 'test/ut/drv_wait_ut.cpp' && item.line === 5), JSON.stringify(matches))
  assert.equal(matches.some(item => item.line === 3), false, 'commented-out lines must not be matched')
  assert.match(capturedPrompt, /existing_symbol_tests/)
})

test('pre-receive commit gate rejection: local pre-check, in-place build retry, dirty unrelated source file, single/multi-line templates, and zero model re-runs', async t => {
  const f = await fixture(t)
  await writeFile(path.join(f.source, 'unrelated.txt'), 'baseline note\n')
  await injectionGit(f.source, ['add', 'unrelated.txt'])
  await injectionGit(f.source, ['commit', '-m', 'add unrelated file'])
  await injectionGit(f.source, ['push', 'origin', 'main'])
  const head = await injectionGit(f.source, ['rev-parse', 'HEAD'])
  f.repositories[0].git.commit = head
  f.repositories[0].base_ref = head

  const hookPath = path.join(f.remote, 'hooks', 'pre-receive')
  // Simulate an intranet hook that runs grep -E (line-by-line, non-DOTALL) over %B with mandatory colons.
  await writeFile(hookPath, [
    '#!/bin/sh',
    'set -eu',
    'while read oldrev newrev refname; do',
    '  full=$(git log -1 --format=%B "$newrev")',
    '  case "$full" in',
    '    *【问题单号/AR/STORY/CR】：*【修改人】：*【审核人】：*【修改说明】：*) ;;',
    '    *) echo "门禁拦截：提交信息必须包含【问题单号/AR/STORY/CR】：【修改人】：【审核人】：【修改说明】：" >&2; exit 1 ;;',
    '  esac',
    '  if ! printf "%s\\n" "$full" | grep -Eq "【问题单号/AR/STORY/CR】[:：].+【修改人】[:：].+【审核人】[:：].+【修改说明】[:：].+"; then',
    '    echo "门禁拦截：当前仓库钩子按单行 grep -E 校验，请切换单行门禁模板" >&2',
    '    exit 1',
    '  fi',
    'done',
    '',
  ].join('\n'))
  await chmod(hookPath, 0o755)

  let modelCalls = 0
  const service = new FaultInjectionService({
    generate: async ({ record }) => { modelCalls += 1; return generated(record) },
  })
  const created = await service.start(f); await wait(service)
  assert.equal(modelCalls, 1)

  // 1) Default commit message ("test: fault injection <build_id>") is rejected by remote pre-receive hook.
  const firstAttempt = await service.build(f.dataRoot, { items: [{ run_id: f.run.run_id, task_id: created.id }] })
  assert.equal(firstAttempt.status, 'failed')
  assert.equal(firstAttempt.repositories[0].push_result, 'rejected')
  assert.match(firstAttempt.error, /门禁拦截：提交信息必须包含/)
  assert.doesNotMatch(firstAttempt.error, /推送结果待确认/)
  const firstCommit = firstAttempt.repositories[0].commit
  assert.ok(firstCommit)
  assert.equal(await injectionGit(f.source, ['rev-parse', 'refs/heads/main']), head, 'analysis directory main ref must stay untouched')

  // 2) Local pre-check blocks incomplete template fields or mismatched custom regex BEFORE touching Git.
  await assert.rejects(
    service.build(f.dataRoot, {
      build_id: firstAttempt.id,
      commit_config: { mode: 'template', issue: 'AR20261118000001', author: 'h00123456', reviewer: '' },
    }),
    /请填写审核人/
  )
  await assert.rejects(
    service.build(f.dataRoot, {
      build_id: firstAttempt.id,
      commit_config: { mode: 'template', issue: 'AR20261118000001', author: 'h00123456', reviewer: 'z00654321', pattern: '^\\[DTS-[0-9]+\\]' },
    }),
    /未通过本地预检正则/
  )

  // 3) Simulate user editing an unrelated file in their local working tree while fixing commit message.
  await writeFile(path.join(f.source, 'unrelated.txt'), 'local unstaged developer note\n')

  // 4) Retry build with MULTILINE_GATE_COMMIT_TEMPLATE: f.source stays untouched despite dirty unrelated.txt,
  //    then remote hook explains it requires SINGLELINE subject.
  const secondAttempt = await service.build(f.dataRoot, {
    build_id: firstAttempt.id,
    commit_config: {
      mode: 'template',
      template: MULTILINE_GATE_COMMIT_TEMPLATE,
      pattern: DEFAULT_INTRANET_COMMIT_REGEX,
      issue: 'AR20261118000001',
      author: 'h00123456',
      reviewer: 'z00654321',
    },
  })
  assert.equal(secondAttempt.status, 'failed')
  assert.match(secondAttempt.error, /单行门禁模板/)
  const secondCommit = secondAttempt.repositories[0].commit
  assert.notEqual(secondCommit, firstCommit)
  assert.equal(await injectionGit(f.source, ['rev-parse', 'refs/heads/main']), head)
  assert.equal(await readFile(path.join(f.source, 'unrelated.txt'), 'utf8'), 'local unstaged developer note\n')

  // 5) Switch to SINGLELINE_GATE_COMMIT_TEMPLATE via HTTP route handler: retries build in-place and pushes cleanly!
  const postPayload = JSON.stringify({
    action: 'build',
    build_id: firstAttempt.id,
    data_root: f.dataRoot,
    commit_config: {
      mode: 'template',
      template: SINGLELINE_GATE_COMMIT_TEMPLATE,
      pattern: DEFAULT_INTRANET_COMMIT_REGEX,
      issue: 'AR20261118000001',
      author: 'h00123456',
      reviewer: 'z00654321',
    },
  })
  const req = Readable.from([Buffer.from(postPayload)])
  req.url = '/api/pangea-companion/fault-injection'
  req.method = 'POST'
  req.headers = { 'sec-fetch-site': 'same-origin' }
  let resStatus = 0, resBody = ''
  await faultInjectionRouteHandler(
    req,
    { writeHead(code) { resStatus = code }, end(body) { resBody = body } },
    service,
    {},
    { resolveRoot: async () => f.dataRoot, readRun: async () => f.run }
  )
  assert.equal(resStatus, 200, resBody)
  await wait(service)

  const finalBuild = await service.readBuild(f.dataRoot, firstAttempt.id)
  assert.equal(finalBuild.status, 'pushed', finalBuild.error)
  assert.equal(modelCalls, 1, 'fixing commit message must never re-run the generator')
  const finalCommit = finalBuild.repositories[0].commit
  assert.notEqual(finalCommit, secondCommit)
  const expectedMsg = '【问题单号/AR/STORY/CR】：AR20261118000001 【修改人】：h00123456 【审核人】：z00654321 【修改说明】：合成打桩：初始化挂起时 init'
  assert.equal((await injectionGit(f.remote, ['log', '-1', '--format=%B', 'refs/heads/personal'])).trim(), expectedMsg)
  assert.equal(await injectionGit(f.source, ['rev-parse', 'refs/heads/main']), head)
  assert.equal(await injectionGit(f.source, ['diff', '--cached', '--name-only']), '')
  assert.equal(await readFile(path.join(f.source, 'unrelated.txt'), 'utf8'), 'local unstaged developer note\n')
  await injectionGit(f.source, ['fsck', '--full'])
  await injectionGit(f.remote, ['fsck', '--full'])

  // 6) Reusable defaults are persisted for the next build without leaking the previous build's summary.
  const nextDefaults = await service.defaults(f.dataRoot, f.run, f.root)
  assert.equal(nextDefaults.commit_config.mode, 'template')
  assert.equal(nextDefaults.commit_config.template, SINGLELINE_GATE_COMMIT_TEMPLATE)
  assert.equal(nextDefaults.commit_config.pattern, DEFAULT_INTRANET_COMMIT_REGEX)
  assert.equal(nextDefaults.commit_config.issue, 'AR20261118000001')
  assert.equal(nextDefaults.commit_config.author, 'h00123456')
  assert.equal(nextDefaults.commit_config.reviewer, 'z00654321')
  assert.equal(nextDefaults.commit_config.summary, '')
})

test('real intranet push-rule regex: outer quotes, ticket IDs, legacy colon upgrade, diagnostics, and linear-time ReDoS immunity', () => {
  const quotedServerRegex = "'^(\\s*【问题单号\\/AR\\/STORY\\/CR】[:：]\\s*((SR\\d{14}|AR\\d{14}|DTS\\d{13}|DTS\\d{8}\\w{11})[;；]*)+([^\\diISAD;；].*)*\\s+【修改人】[:：]\\s*.+\\s+【审核人】[:：]\\s*.+\\s+【修改说明】[:：]\\s*.+\\s*)+$'"
  const remoteError = `remote: GitLab: Commit message does not follow the pattern ${quotedServerRegex}\nTo https://codehub.internal/group/repo.git\n ! [remote rejected] dev -> dev (pre-receive hook declined)`
  assert.equal(extractRemoteHookRegex(remoteError), DEFAULT_INTRANET_COMMIT_REGEX)

  // Legacy colon-less templates saved in older commit-defaults.json auto-upgrade to colon templates
  const migratedMulti = normalizeCommitConfig({ mode: 'template', template: '【问题单号/AR/STORY/CR】{issue}\n【修改人】{author}\n【审核人】{reviewer}\n【修改说明】{summary}' })
  assert.equal(migratedMulti.template, MULTILINE_GATE_COMMIT_TEMPLATE)
  const migratedSingle = normalizeCommitConfig({ mode: 'template', template: '【问题单号/AR/STORY/CR】{issue} 【修改人】{author} 【审核人】{reviewer} 【修改说明】{summary}' })
  assert.equal(migratedSingle.template, SINGLELINE_GATE_COMMIT_TEMPLATE)

  // Valid SR14, AR14, DTS13, DTS8+11, multi-IDs, and multi-line summary auto-flattening
  for (const issue of [
    'AR20261118000001',
    'SR20261118000002',
    'DTS2026111800001',
    'DTS20261118AbCdEf12345',
    'AR20261118000001;DTS2026111800001 补充故障注入桩',
  ]) {
    const res = resolveCommitMessage({
      mode: 'template',
      template: MULTILINE_GATE_COMMIT_TEMPLATE,
      pattern: quotedServerRegex,
      issue,
      author: 'h00123456',
      reviewer: 'z00654321',
      summary: '第一行说明\n第二行说明自动合并为单行',
    }, { id: 'fi-1' })
    assert.equal(res.ok, true, `${issue} should pass: ${res.error}`)
    assert.doesNotMatch(res.message.split('【修改说明】：')[1], /\n/)
  }

  // Missing colon after header is pinpointed
  const missingColon = validateRawCommitMessage(
    '【问题单号/AR/STORY/CR】AR20261118000001\n【修改人】：h00123456\n【审核人】：z00654321\n【修改说明】：补充打桩',
    quotedServerRegex
  )
  assert.equal(missingColon.ok, false)
  assert.match(missingColon.error, /缺少标题或紧邻冒号/)

  // Empty field with colon ("【审核人】：\n") is caught by EMPTY_GATE_FIELD
  const emptyWithColon = validateRawCommitMessage(
    '【问题单号/AR/STORY/CR】：AR20261118000001\n【修改人】：h00123456\n【审核人】：\n【修改说明】：补充打桩',
    quotedServerRegex
  )
  assert.equal(emptyWithColon.ok, false)
  assert.match(emptyWithColon.error, /【审核人】.*未填写内容/)

  // NA, short AR, and malformed second ticket ID produce human-readable ticket format guidance
  for (const badIssue of ['NA', 'AR20261118', 'AR20261118000001;AR99', 'CR20261118000001']) {
    const res = resolveCommitMessage({
      mode: 'template',
      pattern: quotedServerRegex,
      issue: badIssue,
      author: 'h00123456',
      reviewer: 'z00654321',
      summary: '补充打桩',
    }, { id: 'fi-1' })
    assert.equal(res.ok, false, `${badIssue} must be rejected`)
    assert.match(res.error, /不符合门禁规则.*SR\+14位数字/)
  }

  // Adversarial V8 catastrophic backtracking string (~6,000 chars) completes in < 150ms via Thompson NFA
  const block = '【问题单号/AR/STORY/CR】：AR20261118000001\n【修改人】：h00123456\n【审核人】：z00654321\n【修改说明】：补充初始化等待超时故障注入桩\n'
  const adversarial = `${block.repeat(75)}TRAILING_UNCLOSED_LINE`
  const t0 = performance.now()
  const stressRes = validateRawCommitMessage(adversarial, quotedServerRegex)
  const elapsedMs = performance.now() - t0
  assert.equal(stressRes.ok, false)
  assert.ok(elapsedMs < 150, `linear regex took ${elapsedMs.toFixed(1)}ms (expected < 150ms without backtracking hang)`)

  // Pathological custom regex with lookaround + nested quantifier is interrupted by node:vm timeout guardrail
  const pathologicalLookahead = '^(?=【)(.+|.+)+X$'
  const timeoutRes = validateRawCommitMessage(`【${'A'.repeat(28)}!`, pathologicalLookahead, { timeoutMs: 30 })
  assert.equal(timeoutRes.ok, false)
  assert.match(timeoutRes.error, /超过 30ms 超时护栏/)
})

test('P0 field-test #5 regression: legacy implicit default upgrade, Chinese hook rejection without touching source_path, unconfirmed retry precheck, and 16-char summary cap', async t => {
  const f = await fixture(t, { withCommitDefaults: false })
  await mkdir(path.join(f.dataRoot, '.pangea', 'fault-injection'), { recursive: true })
  await writeFile(
    path.join(f.dataRoot, '.pangea', 'fault-injection', 'commit-defaults.json'),
    JSON.stringify({ mode: 'default', issue: '', author: '', reviewer: '', pattern: '' }, null, 2)
  )
  const baseHead = await injectionGit(f.source, ['rev-parse', 'HEAD'])

  let simulateChineseHookReject = true
  let modelCalls = 0
  const gitCalls = []
  const service = new FaultInjectionService({
    generate: async ({ record }) => {
      modelCalls += 1
      const base = generated(record)
      return {
        ...base,
        delivery: {
          ...base.delivery,
          replace_files: [{ ...base.delivery.replace_files[0], source_files: ['init.c', 'stub_guard.h'] }],
        },
        summary: '这是一个非常长的模型自动生成打桩修改摘要说明用于确认默认说明截断不会触发远端Java正则超时',
        edits: [
          { repo_id: 'target', path: 'init.c', before: original, after: instrumented },
          { repo_id: 'target', path: 'stub_guard.h', before: null, after: '#define PANGEA_STUB_GUARD 1\n' },
        ],
      }
    },
    git: async (cwd, args, signal) => {
      gitCalls.push({ cwd, args })
      if (args[0] === 'push' && args[1] === 'origin' && simulateChineseHookReject) {
        throw new Error('remote: [hooks default] Commit message does not follow rule\nTo ssh://codehub.internal/repo.git\n ! [远程拒绝] personal -> personal (pre-receive hook declined)')
      }
      return injectionGit(cwd, args, signal)
    },
  })
  t.after(() => service.dispose())

  // Legacy implicit mode="default" in commit-defaults.json auto-upgrades to mode="template"
  const ctx = await service.buildContext(f.dataRoot)
  assert.equal(ctx.commit_config.mode, 'template')
  assert.equal(ctx.commit_config.pattern, DEFAULT_INTRANET_COMMIT_REGEX)

  const task = await service.start(f)
  await wait(service)

  // 1) Explicit default-mode build hits Chinese Git locale rejection ("! [远程拒绝]"), marks push_result='rejected', and never touches f.source!
  const rejected = await service.build(f.dataRoot, {
    items: [{ run_id: f.run.run_id, task_id: task.id }],
    commit_config: { mode: 'default' },
  })
  assert.equal(rejected.status, 'failed')
  assert.equal(rejected.repositories[0].push_result, 'rejected')
  assert.doesNotMatch(rejected.error, /推送结果待确认/)
  assert.equal(await injectionGit(f.source, ['rev-parse', 'refs/heads/main']), baseHead)
  assert.equal(await injectionGit(f.source, ['rev-parse', 'refs/heads/personal']), baseHead)
  assert.equal(await readFile(path.join(f.source, 'init.c'), 'utf8'), original)
  await assert.rejects(lstat(path.join(f.source, 'stub_guard.h')), { code: 'ENOENT' })

  // 2) Simulate an interrupted/uncertain build ("push_result=unconfirmed") with legacy implicit default commit_config
  const buildDir = await service.buildDirectory(f.dataRoot, rejected.id)
  const diskBuild = JSON.parse(await readFile(path.join(buildDir, 'build.json'), 'utf8'))
  diskBuild.commit_config = { mode: 'default', issue: '', author: '', reviewer: '', pattern: '' }
  diskBuild.commit_message = `test: fault injection build ${rejected.id}`
  diskBuild.repositories[0].push_result = 'unconfirmed'
  diskBuild.error = '推送结果待确认；连接超时'
  await writeFile(path.join(buildDir, 'build.json'), JSON.stringify(diskBuild, null, 2))

  // Retrying build() without compliant template fields MUST reject locally with ZERO git fetch/push calls (breaks dead loop!)
  gitCalls.length = 0
  await assert.rejects(
    service.build(f.dataRoot, { build_id: rejected.id }),
    /请填写问题单号/
  )
  assert.equal(gitCalls.filter(call => call.args[0] === 'fetch' || call.args[0] === 'push').length, 0)

  // 3) Supplying the verified DTS template pushes cleanly with capped <=16-char single-line auto-summary!
  simulateChineseHookReject = false
  const pushed = await service.build(f.dataRoot, {
    build_id: rejected.id,
    commit_config: {
      mode: 'template',
      issue: 'DTS2026111111059',
      author: 'h00600350',
      reviewer: 'h00600350',
    },
  })
  assert.equal(pushed.status, 'pushed', pushed.error)
  assert.equal(modelCalls, 1)
  const remoteMsg = (await injectionGit(f.remote, ['log', '-1', '--format=%B', 'refs/heads/personal'])).trim()
  assert.match(remoteMsg, /^【问题单号\/AR\/STORY\/CR】：DTS2026111111059\n【修改人】：h00600350\n【审核人】：h00600350\n【修改说明】：.{1,16}$/u)
  assert.equal(await injectionGit(f.remote, ['show', 'refs/heads/personal:stub_guard.h']), '#define PANGEA_STUB_GUARD 1')
  assert.equal(await injectionGit(f.source, ['rev-parse', 'HEAD']), baseHead)
})

test('F2 CMake lexical syntax gate rejects trailing tokens outside ) and allows valid comments, quotes, and generator expressions', () => {
  const validCmake = [
    '# [=[ block comment with ) and stray tokens ]=]',
    'add_library(nvmf_tcp STATIC',
    '  src/tcp_main.c',
    '  src/tcp_stub.c # inline ) comment',
    ')',
    'target_compile_definitions(nvmf_tcp PRIVATE',
    '  $<$<BOOL:${ENABLE_UT}>:NVMF_SIMU_FAULT>',
    '  "QUOTED_WITH_PAREN_)"',
    ')',
    '',
  ].join('\n')
  assert.doesNotThrow(() => checkCmakeSyntax(validCmake, 'CMakeLists.txt'))

  // Reproduce F2: appending a token after the closing ')'
  const brokenF2 = [
    'add_library(nvmf_tcp STATIC',
    '  src/tcp_main.c',
    ') src/tcp_stub.c',
    '',
  ].join('\n')
  assert.throws(() => checkCmakeSyntax(brokenF2, 'sub/CMakeLists.txt'), /CMake 语法错误（sub\/CMakeLists\.txt:3）：闭括号外存在裸标记「src」/)

  const unclosedParen = 'add_library(nvmf_tcp STATIC\n  src/tcp_main.c\n'
  assert.throws(() => checkCmakeSyntax(unclosedParen, 'CMakeLists.txt'), /左括号未闭合/)
  assert.doesNotThrow(() => checkCmakeSyntax('\uFEFFadd_library(nvmf_tcp STATIC src/tcp_main.c)\n', 'CMakeLists.txt'))
})

test('F1/F4/F5 product_package mode: scans build_targets, blocks missing replace_files/markers, emits non-blocking F5 notice, and catches missing markers in pre-run verify script', async t => {
  const f = await fixture(t)
  await mkdir(path.join(f.source, 'src'), { recursive: true })
  await writeFile(path.join(f.source, 'CMakeLists.txt'), [
    'add_library(nvmf_tcp STATIC src/tcp.c)',
    'target_compile_definitions(nvmf_tcp PRIVATE $<$<BOOL:${BUILD_LLT}>:NVMF_SIMU_FAULT>)',
    '',
  ].join('\n'))
  await writeFile(path.join(f.source, 'src/tcp.c'), 'int tcp_send(void) { return 0; }\n')
  await injectionGit(f.source, ['add', '.'])
  await injectionGit(f.source, ['commit', '-m', 'add nvmf_tcp static lib'])
  await injectionGit(f.source, ['push', 'origin', 'main'])
  const head = await injectionGit(f.source, ['rev-parse', 'HEAD'])
  f.repositories[0].git.commit = head
  f.repositories[0].base_ref = head
  f.run.details = {
    test_cases: [{
      projection_id: 'unit/CASE-TCP',
      test_case_id: 'unit/CASE-TCP',
      title: 'TCP 发送失败注入',
      execution_readiness: 'needs_instrumentation',
      source_evidence: ['target:src/tcp.c:1-1'],
    }],
  }
  f.input = { ...f.input, case_keys: ['unit/CASE-TCP'], delivery_mode: 'product_package', build_variant: 'debug' }

  let capturedPrompt = '', capturedInput = null
  const service = new FaultInjectionService({
    generate: async ({ inputPath, prompt }) => {
      capturedPrompt = prompt
      capturedInput = JSON.parse(await readFile(inputPath, 'utf8'))
      return {
        summary: '在 tcp_send 植入默认关闭的环境变量桩（无测试宏门控），命中后消耗一次',
        delivery: {
          mode: 'product_package',
          build_requirement: '标准产品配置（正常 debug 或 hitest 精准）均可编入，无需开启全局测试宏',
          replace_files: [{
            artifact: 'libnvmf_tcp.a',
            kind: 'static_lib',
            source_files: ['src/tcp.c'],
            build_evidence: 'CMakeLists.txt:1',
            post_replace_action: '替换组件静态库后重链宿主进程',
          }],
          marker_strings: ['NVMF_TCP_INJECT_FAIL', '[FI_HIT:TCP_SEND_FAIL]'],
          artifact_verify: ['grep -aFq "NVMF_TCP_INJECT_FAIL" libnvmf_tcp.a'],
        },
        points: [{
          id: 'TCP_SEND_FAIL',
          trigger_scope: { current_input: 'tcp_send call', excluded_inputs: ['other modules'] },
          repo_id: 'target',
          path: 'src/tcp.c',
          action: '返回 -5',
          trigger: 'NVMF_TCP_INJECT_FAIL=1',
          times: 1,
          observe: '[FI_HIT:TCP_SEND_FAIL]',
        }],
        profiles: [{
          case_key: 'unit/CASE-TCP',
          point_ids: ['TCP_SEND_FAIL'],
          safety: { setup: [':'], negative_steps: [':'], negative_point_ids: ['TCP_SEND_FAIL'], cleanup: [':'], cleanup_verify: [':'] },
          steps: ['echo "[FI_HIT:TCP_SEND_FAIL]"'],
        }],
        // Deliberately read getenv() without decrementing counter to exercise non-blocking F5 notice
        edits: [{
          repo_id: 'target',
          path: 'src/tcp.c',
          before: 'int tcp_send(void) { return 0; }',
          after: '#include <stdlib.h>\n#include <stdio.h>\nint tcp_send(void) {\n  const char *v = getenv("NVMF_TCP_INJECT_FAIL");\n  if (v && atoi(v) > 0) { puts("[FI_HIT:TCP_SEND_FAIL]"); return -5; }\n  return 0;\n}',
        }],
        limitations: [],
      }
    },
  })
  t.after(() => service.dispose())
  const task = await service.start(f)
  await wait(service)
  const ready = await service.read(f.dataRoot, f.run.run_id, task.id)
  assert.equal(ready.status, 'ready', ready.error)
  assert.equal(ready.delivery_mode, 'product_package')
  assert.equal(ready.build_variant, 'debug')

  // F1: product_package prompt forbids conditional test macros and does NOT inject Option A GTest instructions
  assert.match(capturedPrompt, /严禁把业务桩代码包在产品构建默认未定义的条件\/测试编译宏/)
  assert.doesNotMatch(capturedPrompt, /按 Option A/)
  const harness = capturedInput.repositories[0].harness
  assert.ok(harness.build_targets.some(t => t.target === 'nvmf_tcp' && t.kind === 'static_lib'))
  assert.ok(harness.fault_macros.some(m => m.name === 'NVMF_SIMU_FAULT' && m.conditional_or_test === true))

  // F5: non-blocking consistency warning emitted when finite times lacks decrement logic
  assert.ok(ready.notices.some(n => n.includes('一致性提醒') && n.includes('不递减')), JSON.stringify(ready.notices))

  // F1/F4: pre-run artifact marker gate in verification shell script catches baseline/overwritten binary and passes instrumented binary
  const scriptPath = path.join(f.root, 'verify-artifact-gate.sh')
  await writeFile(scriptPath, buildVerificationShellScript(ready), 'utf8')
  const baselineBin = path.join(f.root, 'libnvmf_tcp_baseline.a')
  const patchedBin = path.join(f.root, 'libnvmf_tcp_patched.a')
  await writeFile(baselineBin, 'baseline archive without stub symbols\n')
  await writeFile(patchedBin, 'archive with NVMF_TCP_INJECT_FAIL and [FI_HIT:TCP_SEND_FAIL]\n')

  await assert.rejects(
    exec('bash', ['verify-artifact-gate.sh'], { cwd: f.root, env: { ...process.env, PANGEA_VERIFY_ARTIFACTS: 'libnvmf_tcp_baseline.a' } }),
    err => err.code === 2 && /missing stub marker "NVMF_TCP_INJECT_FAIL"/.test(err.stderr),
  )
  const okRun = await exec('bash', ['verify-artifact-gate.sh'], { cwd: f.root, env: { ...process.env, PANGEA_VERIFY_ARTIFACTS: 'libnvmf_tcp_patched.a' } })
  assert.match(okRun.stdout, /\[PANGEA_ARTIFACT_CHECK\] OK:/)

  // Aggregated replace_files merge deduplicates across multiple tasks
  const merged = mergeReplaceFilesFromTasks([
    { name: '任务1', replace_files: ready.result.delivery.replace_files, marker_strings: ready.result.delivery.marker_strings },
    { name: '任务2', replace_files: [{ artifact: 'libnvmf_tcp.a', kind: 'static_lib', source_files: ['src/tcp_rx.c'], build_evidence: 'CMakeLists.txt:1', post_replace_action: '替换组件静态库后重链宿主进程' }], marker_strings: ['EXTRA_MARKER'] },
  ])
  assert.equal(merged.replace_files.length, 1)
  assert.deepEqual(merged.replace_files[0].source_files, ['src/tcp.c', 'src/tcp_rx.c'])
  assert.deepEqual(merged.replace_files[0].task_names, ['任务1', '任务2'])
  assert.deepEqual(merged.marker_strings, ['NVMF_TCP_INJECT_FAIL', '[FI_HIT:TCP_SEND_FAIL]', 'EXTRA_MARKER'])
})

test('multi-artifact verification, duplicate basename source_files disambiguation, and validateOutput dirty-checkout reset', async t => {
  const f = await fixture(t)
  // 1) Duplicate basename across two business directories must require explicit relative paths in replace_files[].source_files
  const dupRecord = {
    generation_contract_version: 3,
    delivery_mode: 'product_package',
    case_keys: ['unit/A'],
    repositories: [{ repo_id: 'target' }],
  }
  const dupBasePayload = {
    points: [
      { id: 'P_A', trigger_scope: { current_input: 'a', excluded_inputs: ['b'] }, repo_id: 'target', path: 'mod_a/init.c' },
      { id: 'P_B', trigger_scope: { current_input: 'b', excluded_inputs: ['a'] }, repo_id: 'target', path: 'mod_b/init.c' },
    ],
    profiles: [{
      case_key: 'unit/A',
      point_ids: ['P_A', 'P_B'],
      safety: { setup: [':'], negative_steps: [':'], negative_point_ids: ['P_A', 'P_B'], cleanup: [':'], cleanup_verify: [':'] },
      steps: ['echo ok'],
    }],
    edits: [
      { repo_id: 'target', path: 'mod_a/init.c', before: 'return 0;', after: '/* MARKER_MOD_A */ return -1;' },
      { repo_id: 'target', path: 'mod_b/init.c', before: 'return 0;', after: '/* MARKER_MOD_B */ return -2;' },
    ],
  }
  assert.throws(() => checkInjectionResult({
    ...dupBasePayload,
    delivery: {
      mode: 'product_package',
      build_requirement: '标准配置',
      replace_files: [{ artifact: 'libmod_a.a', kind: 'static_lib', source_files: ['init.c'] }],
      marker_strings: ['MARKER_MOD_A', 'MARKER_MOD_B'],
    },
  }, dupRecord), /遗漏了已修改业务源码的替换产物归属/)

  const validMultiDelivery = {
    mode: 'product_package',
    build_requirement: '标准配置',
    replace_files: [
      { artifact: 'libmod_a.a', kind: 'static_lib', source_files: ['mod_a/init.c'] },
      { artifact: 'libmod_b.a', kind: 'static_lib', source_files: ['mod_b/init.c'] },
    ],
    marker_strings: ['MARKER_MOD_A', 'MARKER_MOD_B'],
  }
  assert.doesNotThrow(() => checkInjectionResult({ ...dupBasePayload, delivery: validMultiDelivery }, dupRecord))

  // 2) Multi-artifact verify commands & script enforce two-way set check on components and all-marker check on final host binary
  const artifactDir = path.join(f.root, 'multi-artifacts')
  await mkdir(artifactDir, { recursive: true })
  const libA = path.join(artifactDir, 'libmod_a.a')
  const libB = path.join(artifactDir, 'libmod_b.a')
  const libBBaseline = path.join(artifactDir, 'libmod_b_baseline.a')
  const hostOk = path.join(artifactDir, 'host_ok')
  const hostPartial = path.join(artifactDir, 'host_partial')
  await writeFile(libA, 'archive A with MARKER_MOD_A\n')
  await writeFile(libB, 'archive B with MARKER_MOD_B\n')
  await writeFile(libBBaseline, 'baseline archive B with zero markers\n')
  await writeFile(hostOk, 'linked host with MARKER_MOD_A and MARKER_MOD_B\n')
  await writeFile(hostPartial, 'linked host with only MARKER_MOD_A\n')

  const cmds = buildArtifactVerifyCommands({ build_variant: 'debug', result: { delivery: validMultiDelivery } })
  const preOk = await exec('bash', ['-c', cmds.pre_replace_cmd], { cwd: artifactDir })
  assert.match(preOk.stdout, /OK: MARKER_MOD_A/)
  assert.match(preOk.stdout, /OK: MARKER_MOD_B/)

  // Even if libmod_a.a happened to contain both markers, an uninstrumented libmod_b.a must fail NO_STUB_IN_ARTIFACT
  await writeFile(libA, 'archive A with MARKER_MOD_A and MARKER_MOD_B\n')
  await writeFile(libB, 'baseline archive B without any marker\n')
  await assert.rejects(
    exec('bash', ['-c', cmds.pre_replace_cmd], { cwd: artifactDir }),
    err => err.code === 2 && /NO_STUB_IN_ARTIFACT: libmod_b\.a/.test(err.stderr),
  )
  await writeFile(libA, 'archive A with MARKER_MOD_A\n')
  await writeFile(libB, 'archive B with MARKER_MOD_B\n')

  const multiScriptPath = path.join(artifactDir, 'verify-multi.sh')
  await writeFile(multiScriptPath, buildVerificationShellScript({
    id: 'task-multi',
    generation_contract_version: 3,
    delivery_mode: 'product_package',
    build_variant: 'debug',
    result: { ...dupBasePayload, delivery: validMultiDelivery },
  }), 'utf8')
  const scriptCompOk = await exec('bash', ['verify-multi.sh'], {
    cwd: artifactDir,
    env: { ...process.env, PANGEA_VERIFY_ARTIFACTS: 'libmod_a.a libmod_b.a', PANGEA_VERIFY_FINAL_BINARY: 'host_ok' },
  })
  assert.match(scriptCompOk.stdout, /\[PANGEA_ARTIFACT_CHECK\] OK:/)
  await assert.rejects(
    exec('bash', ['verify-multi.sh'], { cwd: artifactDir, env: { ...process.env, PANGEA_VERIFY_ARTIFACTS: 'libmod_a.a libmod_b_baseline.a' } }),
    err => err.code === 2 && /missing stub marker "MARKER_MOD_B"/.test(err.stderr),
  )
  await assert.rejects(
    exec('bash', ['verify-multi.sh'], { cwd: artifactDir, env: { ...process.env, PANGEA_VERIFY_FINAL_BINARY: 'host_partial' } }),
    err => err.code === 2 && /missing stub marker "MARKER_MOD_B"/.test(err.stderr),
  )

  // 3) validateOutput resets generator-dirtied checkout to base_commit before dryRun so clean base_commit edits pass without false repair
  let repairTurns = 0
  const dirtyService = new FaultInjectionService({
    generate: async ({ record, validateOutput, outputPath }) => {
      const checkout = record.repositories[0].path
      await writeFile(path.join(checkout, 'init.c'), '/* generator scratch mutation */\n' + original)
      const candidate = generated({ case_keys: f.input.case_keys })
      await writeFile(outputPath, JSON.stringify(candidate, null, 2))
      try {
        await validateOutput(candidate)
      } catch (err) {
        repairTurns += 1
        throw err
      }
      return candidate
    },
  })
  t.after(() => dirtyService.dispose())
  const dirtyTask = await dirtyService.start(f)
  await wait(dirtyService)
  const dirtyReady = await dirtyService.read(f.dataRoot, f.run.run_id, dirtyTask.id)
  assert.equal(dirtyReady.status, 'ready', dirtyReady.error)
  assert.equal(repairTurns, 0)
  assert.equal(dirtyReady.notices.filter(n => n.includes('改动了源码副本')).length, 1)
})

test('F3 + F4 real gcc/ld reproduction: PANGEA safe-relink defeats DSO missing from command line, swallowed ld exit codes, and prebaked hitest tail overwrite without modifying environment relink script', {
  skip: process.platform !== 'linux' && 'ELF DSO DT_NEEDED relink reproduction requires Linux gcc/ld',
}, async t => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'pangea-f3-f4-relink-'))
  t.after(() => rm(work, { recursive: true, force: true }))
  const libDir = path.join(work, 'lib64')
  const runDir = path.join(work, 'run')
  await mkdir(libDir, { recursive: true })
  await mkdir(runDir, { recursive: true })

  // 1) Platform hook runtime DSO (libhook_rt.so) providing __platform_test_hook()
  await writeFile(path.join(work, 'hook_rt.c'), 'int __platform_test_hook(void) { return 42; }\n')
  await exec('cc', ['-shared', '-fPIC', path.join(work, 'hook_rt.c'), '-o', path.join(libDir, 'libhook_rt.so')])

  // 2) Middleware DSO (libmid.so) whose DT_NEEDED points to libhook_rt.so (like the 38 DSOs in 3.3)
  await writeFile(path.join(work, 'mid.c'), 'extern int __platform_test_hook(void); int mid_call(void) { return __platform_test_hook(); }\n')
  await exec('cc', ['-shared', '-fPIC', path.join(work, 'mid.c'), `-L${libDir}`, '-lhook_rt', `-Wl,-rpath,${libDir}`, '-o', path.join(libDir, 'libmid.so')])

  // 3) Precompiled host archive (libhost_core.a) referencing mid_call() + __platform_test_hook() AND calling instrumented tcp_send()
  await writeFile(path.join(work, 'host_main.c'), [
    '#include <stdio.h>',
    'extern int __platform_test_hook(void);',
    'extern int mid_call(void);',
    'extern int tcp_send(void);',
    'int main(void) {',
    '  int h = __platform_test_hook() + (mid_call() - 42);',
    '  int rc = tcp_send();',
    '  printf("hook=%d rc=%d\\n", h, rc);',
    '  return rc == 0 ? 0 : 3;',
    '}',
    '',
  ].join('\n'))
  await exec('cc', ['-c', path.join(work, 'host_main.c'), '-o', path.join(work, 'host_main.o')])
  await exec('ar', ['rcs', path.join(work, 'libhost_core.a'), path.join(work, 'host_main.o')])

  // 4) Instrumented component static library (libnvmf_tcp.a) produced from personal branch
  await writeFile(path.join(work, 'tcp_patched.c'), [
    '#include <stdlib.h>',
    '#include <stdio.h>',
    'int tcp_send(void) {',
    '  const char *v = getenv("NVMF_TCP_FAULT_ENV");',
    '  if (v && v[0] == \'1\') { puts("[FI_HIT:TCP_STUB]"); return -5; }',
    '  return 0;',
    '}',
    '',
  ].join('\n'))
  await exec('cc', ['-c', path.join(work, 'tcp_patched.c'), '-o', path.join(work, 'tcp_patched.o')])
  const compLib = path.join(work, 'libnvmf_tcp.a')
  await exec('ar', ['rcs', compLib, path.join(work, 'tcp_patched.o')])

  // 5) Pre-baked hitest binary sitting in runDir (uninstrumented!) + broken environment relink script (F3 + swallowed rc + F4 tail cp)
  const prebakedHitest = path.join(runDir, 'host_daemon_hitest_M')
  const otherHitest = path.join(runDir, 'other_proc_hitest')
  const finalHost = path.join(runDir, 'host_daemon')
  await writeFile(prebakedHitest, '#!/usr/bin/env bash\necho "OLD_PREBAKED_HITEST_WITHOUT_STUB"\n')
  await writeFile(otherHitest, 'prebaked sidecar\n')
  await chmod(prebakedHitest, 0o755)

  const relinkScript = path.join(work, 'env_relink.sh')
  const relinkScriptContent = [
    '#!/usr/bin/env bash',
    '# Deliberately broken corporate relink script reproducing 3.3 (F3 + swallowed rc) and 3.4 (F4):',
    '# Lists -lmid (which has DT_NEEDED libhook_rt.so) and -Llib64, but omits -lhook_rt!',
    `gcc "${path.join(work, 'libhost_core.a')}" "${compLib}" -L"${libDir}" -Wl,-rpath,"${libDir}" -lmid -o "${path.join(work, 'host_daemon.new')}"`,
    'echo "link_rc=$?"',
    `if [ -f "${prebakedHitest}" ]; then`,
    `  cp -f "${prebakedHitest}" "${finalHost}"`,
    `elif [ -f "${otherHitest}" ]; then`,
    `  cp -f "${otherHitest}" "${finalHost}"`,
    'else',
    `  mv -f "${path.join(work, 'host_daemon.new')}" "${finalHost}"`,
    'fi',
    '',
  ].join('\n')
  await writeFile(relinkScript, relinkScriptContent)
  await chmod(relinkScript, 0o755)
  const originalRelinkBytes = await readFile(relinkScript, 'utf8')

  // Prove raw env_relink.sh reproduces exact F3 + F4 failure: exits 0, swallows DSO error, and overwrites finalHost with prebakedHitest!
  const rawRun = await exec('bash', [relinkScript])
  assert.match(rawRun.stdout, /link_rc=[1-9]/)
  assert.match(rawRun.stderr, /DSO missing from command line/)
  assert.match(await readFile(finalHost, 'utf8'), /OLD_PREBAKED_HITEST_WITHOUT_STUB/)

  // Now generate PANGEA verification script and run PANGEA_SAFE_RELINK WITHOUT touching env_relink.sh!
  const verifyScript = path.join(work, 'pangea-verify.sh')
  await writeFile(verifyScript, buildVerificationShellScript({
    id: 'task-f3-f4',
    generation_contract_version: 3,
    delivery_mode: 'product_package',
    build_variant: 'debug',
    cases: [{ case_key: 'unit/TCP', title: 'TCP fault' }],
    result: {
      delivery: {
        mode: 'product_package',
        build_requirement: '标准配置',
        replace_files: [{ artifact: 'libnvmf_tcp.a', kind: 'static_lib', source_files: ['src/tcp.c'] }],
        marker_strings: ['NVMF_TCP_FAULT_ENV', '[FI_HIT:TCP_STUB]'],
      },
      points: [{ id: 'P1', repo_id: 'target', path: 'src/tcp.c', observe: '[FI_HIT:TCP_STUB]' }],
      profiles: [{
        case_key: 'unit/TCP',
        point_ids: ['P1'],
        safety: { setup: [':'], negative_steps: [`"${finalHost}"`], negative_point_ids: ['P1'], cleanup: [':'], cleanup_verify: [':'] },
        steps: [`NVMF_TCP_FAULT_ENV=1 "${finalHost}" || true`],
      }],
    },
  }), 'utf8')

  const safeRun = await exec('bash', [verifyScript], {
    env: {
      ...process.env,
      PANGEA_VERIFY_ARTIFACTS: compLib,
      PANGEA_RELINK_CMD: `bash "${relinkScript}"`,
      PANGEA_VERIFY_FINAL_BINARY: finalHost,
    },
  })
  assert.match(safeRun.stdout, /\[PANGEA_SAFE_RELINK\] OK:/)
  assert.match(safeRun.stdout, /hook=42 rc=-5/)
  assert.match(safeRun.stdout, /\[FI_HIT:TCP_STUB\]/)
  // Corporate relink script untouched, and prebaked sidecar binaries restored to runDir!
  assert.equal(await readFile(relinkScript, 'utf8'), originalRelinkBytes)
  assert.match(await readFile(prebakedHitest, 'utf8'), /OLD_PREBAKED_HITEST_WITHOUT_STUB/)
  assert.equal(await readFile(otherHitest, 'utf8'), 'prebaked sidecar\n')

  // Also prove swallowed genuine linker failure is caught (when input .a is missing/corrupt even though relink script ignores $?)
  const brokenCmdScript = path.join(work, 'swallowed_fail_relink.sh')
  await writeFile(brokenCmdScript, `#!/usr/bin/env bash\ngcc /nonexistent_input.o -o "${finalHost}.bad"\necho "ignored_rc=$?"\nexit 0\n`)
  await chmod(brokenCmdScript, 0o755)
  await assert.rejects(
    exec('bash', [verifyScript], {
      env: { ...process.env, PANGEA_RELINK_ONLY: '1', PANGEA_RELINK_CMD: `bash "${brokenCmdScript}"`, PANGEA_VERIFY_FINAL_BINARY: finalHost },
    }),
    err => err.code === 2 && /\[PANGEA_SAFE_RELINK\] FAILED: relink_rc=0 linker_errors=\[.*gcc:1/.test(err.stderr),
  )
})

test('L1/L2 platform acceptance: scans sibling mod/dbg for 20-line diagnose_snippets, resolves inline points[].enable paths, compiles one-shot unlink init stub under stripped daemon env, and verifies 3-stage markers including live /proc/<pid>/exe', async t => {
  const f = await fixture(t)
  await mkdir(path.join(f.source, 'mod/src'), { recursive: true })
  await mkdir(path.join(f.source, 'mod/dbg'), { recursive: true })
  await mkdir(path.join(f.source, 'common'), { recursive: true })
  await writeFile(path.join(f.source, 'CMakeLists.txt'), 'add_library(dtoe_init STATIC mod/src/mod_init.c mod/dbg/mod_dbg.c)\n')
  const origModInit = [
    '#include <stdio.h>',
    'int mod_run_init(void) {',
    '  int step1_cost = 12;',
    '  int step2_done = 1;',
    '  if (!step2_done) {',
    '    printf("init_query_timeout\\n");',
    '    printf("stage1 cost=%dms, stage2 not finish\\n", step1_cost);',
    '    return -1;',
    '  }',
    '  printf("mod_init_ok\\n");',
    '  return 0;',
    '}',
    '',
  ].join('\n')
  const modDbg = [
    '#include <stdio.h>',
    'struct dtoe_dbg_ctx { int step; int times; };',
    'static int dtoe_inject_conn_fault(int argc, char **argv) {',
    '  (void)argc; (void)argv;',
    '  return 0;',
    '}',
    '#define DBG_CMD_REG(mod, cmd, fn) void reg_##cmd(void) { (void)(fn); }',
    'DBG_CMD_REG("dtoe", "inject_conn_fault", dtoe_inject_conn_fault)',
    '',
  ].join('\n')
  const commonPgd = [
    'int pgd_extra_entry(int mode) { return mode; }',
    '#define PGD_CMD_REG(name, fn) void pgd_reg_##name(void) { (void)(fn); }',
    'PGD_CMD_REG(extra, pgd_extra_entry)',
    '',
  ].join('\n')
  await writeFile(path.join(f.source, 'mod/src/mod_init.c'), origModInit)
  await writeFile(path.join(f.source, 'mod/dbg/mod_dbg.c'), modDbg)
  await writeFile(path.join(f.source, 'common/pgd_helper.c'), commonPgd)
  await injectionGit(f.source, ['add', '.'])
  await injectionGit(f.source, ['commit', '-m', 'add dtoe_init in mod/src and diagnose shell in sibling mod/dbg'])
  await injectionGit(f.source, ['push', 'origin', 'main', 'HEAD:refs/heads/personal'])
  const head = await injectionGit(f.source, ['rev-parse', 'HEAD'])
  f.repositories[0].git.commit = head
  f.repositories[0].base_ref = head
  f.run.details = {
    test_cases: [{
      projection_id: 'unit-0001/rec-000014',
      test_case_id: 'unit-0001/rec-000014',
      title: '初始化查询超时处置与各阶段耗时报告',
      execution_readiness: 'needs_instrumentation',
      source_evidence: ['target:mod/src/mod_init.c:2-12'],
      instrumentation: {
        points: [{
          id: 'INIT_QUERY_TIMEOUT',
          repo_id: 'target',
          path: 'mod/src/mod_init.c',
          symbol: 'mod_run_init',
          enable: '可参考 target:common/pgd_helper.c:3 注册辅助子命令或写入单次控制文件',
        }],
      },
    }],
  }
  f.input = { ...f.input, case_keys: ['unit-0001/rec-000014'], delivery_mode: 'product_package', build_variant: 'debug' }

  const armFile = path.join(f.root, 'dtoe_init_arm.once')
  const patchedModInit = [
    '#include <stdio.h>',
    '#include <unistd.h>',
    'int mod_run_init(void) {',
    '  int step1_cost = 12;',
    '  int step2_done = 1;',
    `  if (access(${JSON.stringify(armFile)}, F_OK) == 0) {`,
    `    unlink(${JSON.stringify(armFile)});`,
    '    printf("[FI_HIT:INIT_QUERY_TIMEOUT] step=2\\n");',
    '    step2_done = 0;',
    '  }',
    '  if (!step2_done) {',
    '    printf("init_query_timeout\\n");',
    '    printf("stage1 cost=%dms, stage2 not finish\\n", step1_cost);',
    '    return -1;',
    '  }',
    '  printf("mod_init_ok\\n");',
    '  return 0;',
    '}',
    '',
  ].join('\n')

  let capturedPrompt = '', capturedInput = null
  const service = new FaultInjectionService({
    generate: async ({ inputPath, prompt }) => {
      capturedPrompt = prompt
      capturedInput = JSON.parse(await readFile(inputPath, 'utf8'))
      return {
        summary: '初始化路径采用读到即 unlink 自毁的单次控制文件门控，兼容 L1 无环境变量守护拉起与同包重拉恢复',
        delivery: {
          mode: 'product_package',
          build_requirement: '常规产品大包同源构建组件静态库与宿主二进制',
          replace_files: [{
            artifact: 'libdtoe_init.a',
            kind: 'static_lib',
            source_files: ['mod/src/mod_init.c'],
            build_evidence: 'CMakeLists.txt:1',
            post_replace_action: '走大包同源链接宿主二进制（节点重启从部署包镜像恢复）',
          }],
          marker_strings: ['[FI_HIT:INIT_QUERY_TIMEOUT]'],
          artifact_verify: ['grep -aFq "[FI_HIT:INIT_QUERY_TIMEOUT]" libdtoe_init.a'],
        },
        points: [{
          id: 'INIT_QUERY_TIMEOUT',
          trigger_scope: { current_input: 'mod_run_init step=2 startup arm file', excluded_inputs: ['subsequent restarts after unlink'] },
          repo_id: 'target',
          path: 'mod/src/mod_init.c',
          symbol: 'mod_run_init',
          action: '置 step2_done=0 触发查询超时与阶段耗时报告',
          trigger: `单次控制文件 ${armFile} 存在时命中并立即 unlink`,
          times: 1,
          enable: `printf 'step=2\\n' > "${armFile}"`,
          disable: `rm -f "${armFile}"`,
          observe: '[FI_HIT:INIT_QUERY_TIMEOUT]',
        }],
        profiles: [{
          case_key: 'unit-0001/rec-000014',
          point_ids: ['INIT_QUERY_TIMEOUT'],
          safety: {
            setup: [`rm -f "${armFile}"`],
            negative_steps: [`test ! -e "${armFile}"`],
            negative_point_ids: ['INIT_QUERY_TIMEOUT'],
            cleanup: [`rm -f "${armFile}"`],
            cleanup_verify: [`test ! -e "${armFile}"`],
          },
          steps: [`printf 'step=2\\n' > "${armFile}"`],
        }],
        edits: [{
          repo_id: 'target',
          path: 'mod/src/mod_init.c',
          before: '  int step2_done = 1;',
          after: [
            '  int step2_done = 1;',
            `  if (access(${JSON.stringify(armFile)}, F_OK) == 0) {`,
            `    unlink(${JSON.stringify(armFile)});`,
            '    printf("[FI_HIT:INIT_QUERY_TIMEOUT] step=2\\n");',
            '    step2_done = 0;',
            '  }',
          ].join('\n'),
        }],
        limitations: [],
      }
    },
  })
  t.after(() => service.dispose())
  const task = await service.start(f)
  await wait(service)
  const ready = await service.read(f.dataRoot, f.run.run_id, task.id)
  assert.equal(ready.status, 'ready', ready.error)
  assert.deepEqual(ready.notices, [])

  // Verify harness automatically probed sibling mod/dbg/ AND inline points[].enable path, slicing multi-line callback signature + macro
  const harness = capturedInput.repositories[0].harness
  assert.ok(Array.isArray(harness.diagnose_hooks) && harness.diagnose_hooks.length >= 2, JSON.stringify(harness))
  assert.ok(harness.diagnose_hooks.some(h => h.location.startsWith('mod/dbg/mod_dbg.c:') && h.code.includes('DBG_CMD_REG')))
  assert.ok(harness.diagnose_hooks.some(h => h.location.startsWith('common/pgd_helper.c:') && h.code.includes('PGD_CMD_REG')))
  assert.ok(Array.isArray(harness.diagnose_snippets) && harness.diagnose_snippets.length >= 1, JSON.stringify(harness))
  const dbgSnippet = harness.diagnose_snippets.find(s => s.path === 'mod/dbg/mod_dbg.c')
  assert.ok(dbgSnippet, 'must slice multi-line snippet from sibling mod/dbg/mod_dbg.c')
  assert.match(dbgSnippet.content, /static int dtoe_inject_conn_fault\(int argc, char \*\*argv\)/)
  assert.match(dbgSnippet.content, /DBG_CMD_REG\("dtoe", "inject_conn_fault", dtoe_inject_conn_fault\)/)

  // Verify updated prompt encodes runtime diagnose_snippets vs startup one-shot unlink file, without debunked L3 controller-reset myth
  assert.match(capturedPrompt, /diagnose_snippets/)
  assert.match(capturedPrompt, /一次性自毁控制文件/)
  assert.match(capturedPrompt, /严禁写死参数导致每次进程启动必然触发故障/)
  assert.doesNotMatch(capturedPrompt, /触发整节点保护性重启/)

  // Verify non-blocking consistency notices catch L1 getenv-only and L2 hardcoded patches
  const getenvNotices = collectConsistencyNotices({
    delivery: { mode: 'product_package' },
    points: [{ id: 'P1', times: 1, trigger: 'ENV=1', enable: 'export ENV=1' }],
    edits: [{ repo_id: 'target', path: 'mod/src/mod_init.c', before: 'int x = 0;', after: 'int x = getenv("ENV") ? 1 : 0; x--;' }],
  }, { delivery_mode: 'product_package' })
  assert.ok(getenvNotices.some(n => n.includes('平台限制提醒（L1）')))

  const hardcodedNotices = collectConsistencyNotices({
    delivery: { mode: 'product_package' },
    points: [{ id: 'P2', times: 1, trigger: '触发参数写死，每次进程启动必触发', enable: '写死' }],
    edits: [{ repo_id: 'target', path: 'mod/src/mod_init.c', before: 'int step2_done = 1;', after: 'int step2_done = 0;' }],
  }, { delivery_mode: 'product_package' })
  assert.ok(hardcodedNotices.some(n => n.includes('平台限制提醒（L2）')))
  assert.ok(!hardcodedNotices.some(n => n.includes('节点保护性重启')))

  // Real C compilation + 3-stage artifact/host-binary/live-proc verification + L1 stripped-env runtime loop
  const buildOut = path.join(f.root, 'pkg-build')
  await mkdir(buildOut, { recursive: true })
  await writeFile(path.join(buildOut, 'mod_init_patched.c'), patchedModInit)
  await writeFile(path.join(buildOut, 'mod_init_unpatched.c'), origModInit)
  await writeFile(path.join(buildOut, 'daemon_main.c'), [
    '#include <unistd.h>',
    'extern int mod_run_init(void);',
    'int main(int argc, char **argv) {',
    '  if (argc > 1 && argv[1][0] == \'h\') { sleep(5); return 0; }',
    '  return mod_run_init() == 0 ? 0 : 4;',
    '}',
    '',
  ].join('\n'))
  await exec('cc', ['-c', path.join(buildOut, 'mod_init_patched.c'), '-o', path.join(buildOut, 'mod_patched.o')])
  await exec('cc', ['-c', path.join(buildOut, 'mod_init_unpatched.c'), '-o', path.join(buildOut, 'mod_unpatched.o')])
  const libPatched = path.join(buildOut, 'libdtoe_init.a')
  const hostStale = path.join(buildOut, 'host_daemon_stale')
  const hostCoLinked = path.join(buildOut, 'host_daemon')
  await exec('ar', ['rcs', libPatched, path.join(buildOut, 'mod_patched.o')])
  // Simulate previous mismatch ("库带桩、二进制不带桩") vs fixed co-linked package binary
  await exec('cc', [path.join(buildOut, 'daemon_main.c'), path.join(buildOut, 'mod_unpatched.o'), '-o', hostStale])
  await exec('cc', [path.join(buildOut, 'daemon_main.c'), libPatched, '-o', hostCoLinked])

  const verifyScriptPath = path.join(buildOut, 'pangea-verify.sh')
  await writeFile(verifyScriptPath, buildVerificationShellScript(ready), 'utf8')
  const verifyCmds = buildArtifactVerifyCommands(ready)
  assert.match(verifyCmds.variant_hint, /从部署包镜像恢复/)
  assert.doesNotMatch(verifyCmds.variant_hint, /节点保护性重启/)
  assert.match(verifyCmds.proc_exe_cmd, /\/proc\/\$pid\/exe/)

  // Gate ① passes libdtoe_init.a, Gate ② rejects stale unlinked host binary and passes co-linked host binary
  await assert.rejects(
    exec('bash', [verifyScriptPath], { cwd: buildOut, env: { ...process.env, PANGEA_VERIFY_ONLY: '1', PANGEA_VERIFY_ARTIFACTS: libPatched, PANGEA_VERIFY_FINAL_BINARY: hostStale } }),
    err => err.code === 2 && /missing stub marker "\[FI_HIT:INIT_QUERY_TIMEOUT\]"/.test(err.stderr),
  )
  const gate12Ok = await exec('bash', [verifyScriptPath], {
    cwd: buildOut,
    env: { ...process.env, PANGEA_VERIFY_ONLY: '1', PANGEA_VERIFY_ARTIFACTS: libPatched, PANGEA_VERIFY_FINAL_BINARY: hostCoLinked },
  })
  assert.match(gate12Ok.stdout, /\[PANGEA_ARTIFACT_CHECK\] OK:/)

  // Gate ③ verifies live /proc/<pid>/exe on Linux
  if (process.platform === 'linux') {
    const liveDaemon = spawn(hostCoLinked, ['hold'], { env: {}, stdio: 'ignore' })
    t.after(() => { try { liveDaemon.kill('SIGKILL') } catch {} })
    const gate3Ok = await exec('bash', [verifyScriptPath], {
      cwd: buildOut,
      env: { ...process.env, PANGEA_VERIFY_ONLY: '1', PANGEA_VERIFY_PROC_PID: String(liveDaemon.pid) },
    })
    assert.match(gate3Ok.stdout, new RegExp(`\\[PANGEA_ARTIFACT_CHECK\\] OK: /proc/${liveDaemon.pid}/exe`))
    liveDaemon.kill('SIGTERM')
  }

  // Execute full 3-stage behavioral acceptance under completely empty env (env: {}, proving L1 immunity):
  // 1) Default closed baseline
  const baseRun = await exec(hostCoLinked, [], { env: {} })
  assert.equal(baseRun.stdout.trim(), 'mod_init_ok')
  // 2) Arm one-shot file -> single daemon relaunch hits step=2 timeout, unlinks file, prints stage report
  await writeFile(armFile, 'step=2\n', 'utf8')
  await assert.rejects(
    exec(hostCoLinked, [], { env: {} }),
    err => err.code === 4
      && /\[FI_HIT:INIT_QUERY_TIMEOUT\] step=2\ninit_query_timeout\nstage1 cost=12ms, stage2 not finish/.test(err.stdout),
  )
  await assert.rejects(lstat(armFile), { code: 'ENOENT' }, 'arm file must self-delete immediately on hit')
  // 3) Next daemon relaunch automatically recovers normal initialization without rebuilding package
  const recoveredRun = await exec(hostCoLinked, [], { env: {} })
  assert.equal(recoveredRun.stdout.trim(), 'mod_init_ok')
})








