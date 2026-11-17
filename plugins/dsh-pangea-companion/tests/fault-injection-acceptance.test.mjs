import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, lstat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { FaultInjectionService, injectionGit, workspaceChanges, dedupeRepeatedValues, compactGenerationInput } from '../src/fault-injection.js'
import { protectedBranchReason } from '../src/repositories/branch-policy.js'
import { disabledHooksPath } from '../src/repositories/git-environment.js'

const exec = promisify(execFile)
const original = 'int init_check(void) { return 0; }\n'
const instrumented = 'int init_check(void) {\n  if (pangea_fault_hit("INIT_HANG")) return -1;\n  return 0;\n}\n'
const LFS_HOOKS = ['post-checkout', 'post-commit', 'post-merge', 'pre-push']

async function fixture(t, { branch = 'main', lfs = false } = {}) {
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
  await injectionGit(root, ['init', '--bare', remote])
  await injectionGit(source, ['remote', 'add', 'origin', remote])
  await injectionGit(source, ['push', 'origin', branch])
  await mkdir(path.join(dataRoot, '.pangea', 'repository-settings'), { recursive: true })
  await writeFile(path.join(dataRoot, '.pangea', 'repository-settings', 'target.json'), JSON.stringify({ git_path: source, personal_branch: branch, remote: 'origin' }))
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
const generated = record => ({ summary: '初始化第 9 步挂起', points: [{ id: 'INIT_HANG', repo_id: 'target', path: 'init.c', action: '阻塞初始化', trigger: '控制文件存在', times: 1 }],
  profiles: record.case_keys.map(case_key => ({ case_key, point_ids: ['INIT_HANG'], steps: ['touch /tmp/pangea_init_hang', 'reload', 'check timeout log'] })),
  edits: [{ repo_id: 'target', path: 'init.c', before: original, after: instrumented }], limitations: [] })
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
  const task = await service.start({ ...f, cwd: f.root }); await wait(service)
  const ready = await service.read(f.dataRoot, f.run.run_id, task.id)
  assert.equal(ready.status, 'ready', ready.error)
  const checkout = ready.repositories[0].path
  assert.deepEqual(ready.repositories[0].workspace_baseline, [])
  assert.deepEqual((await readdir(checkout)).filter(name => LFS_HOOKS.includes(name)), [])
  assert.deepEqual(ready.notices, [])
  const pushed = await service.push(f.dataRoot, f.run.run_id, task.id)
  assert.equal(pushed.status, 'pushed', pushed.error)
  assert.deepEqual((await readdir(f.source)).filter(name => LFS_HOOKS.includes(name)), [], 'local updateInstead push must not drop hooks into the user worktree')
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
  const task = await service.start(f); await wait(service)
  const ready = await service.read(f.dataRoot, f.run.run_id, task.id)
  assert.equal(ready.status, 'ready', ready.error)
  assert.deepEqual(ready.repositories[0].workspace_baseline.map(entry => entry.path).sort(), LFS_HOOKS)
  assert.deepEqual(ready.notices, [])
  assert.deepEqual(ready.repositories[0].files, ['init.c'])
  assert.doesNotMatch(ready.repositories[0].diff, /post-checkout|pre-push/)
  const pushed = await service.push(f.dataRoot, f.run.run_id, task.id)
  assert.equal(pushed.status, 'pushed', pushed.error)
  assert.deepEqual(await injectionGit(f.remote, ['ls-tree', '--name-only', 'refs/heads/main']).then(out => out.split('\n').sort()), ['init.c'])
})

test('generator writes into its source copy: changes are recorded, discarded and only registered edits are committed', async t => {
  const f = await fixture(t)
  const service = new FaultInjectionService({ generate: async ({ record }) => {
    const checkout = record.repositories[0].path
    await writeFile(path.join(checkout, 'init.c'), '/* scratch edit */\n' + original)
    await writeFile(path.join(checkout, 'draft.py'), 'print(1)\n')
    return generated(record)
  } })
  const task = await service.start(f); await wait(service)
  const ready = await service.read(f.dataRoot, f.run.run_id, task.id)
  assert.equal(ready.status, 'ready', ready.error)
  assert.equal(ready.notices.length, 1); assert.match(ready.notices[0], /已丢弃/); assert.match(ready.notices[0], /draft\.py/)
  assert.deepEqual(ready.repositories[0].workspace_changes.map(item => `${item.change}:${item.path}`).sort(), ['added:draft.py', 'changed:init.c'])
  assert.doesNotMatch(ready.repositories[0].diff, /scratch edit|draft\.py/)
  assert.deepEqual(await untracked(ready.repositories[0].path), ['M  init.c'])
  const pushed = await service.push(f.dataRoot, f.run.run_id, task.id)
  assert.equal(pushed.status, 'pushed', pushed.error)
  assert.equal(await injectionGit(f.remote, ['show', 'refs/heads/main:init.c']), instrumented.trimEnd())
})

test('a result that depends on the generator\'s own source edits is rejected, but stays reusable', async t => {
  const f = await fixture(t)
  const service = new FaultInjectionService({ generate: async ({ record }) => {
    const checkout = record.repositories[0].path, edited = '/* local */\n' + original
    await writeFile(path.join(checkout, 'init.c'), edited)
    return { ...generated(record), edits: [{ repo_id: 'target', path: 'init.c', before: edited, after: instrumented }] }
  } })
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
  const first = await service.start(f); await wait(service)
  const failed = await service.read(f.dataRoot, f.run.run_id, first.id)
  assert.equal(failed.status, 'failed'); assert.equal(failed.result_saved, true); assert.equal(calls, 1)
  const reused = await service.retry(f.dataRoot, f.run.run_id, first.id, f.root, { mode: 'reuse' }); await wait(service)
  const ready = await service.read(f.dataRoot, f.run.run_id, reused.id)
  assert.equal(ready.status, 'ready', ready.error)
  assert.equal(calls, 1, 'reuse must not start the generator')
  assert.equal(ready.reused_from.task_id, first.id)
  assert.match(ready.repositories[0].diff, /INIT_HANG/)
  // Pushed, branch reverted by the developer, then stubbed again from the same result.
  const pushed = await service.push(f.dataRoot, f.run.run_id, reused.id)
  assert.equal(pushed.status, 'pushed', pushed.error)
  await injectionGit(f.source, ['revert', '--no-edit', 'HEAD'])
  await injectionGit(f.source, ['push', 'origin', 'main'])
  const again = await service.retry(f.dataRoot, f.run.run_id, reused.id, f.root, { mode: 'reuse' }); await wait(service)
  const restubbed = await service.read(f.dataRoot, f.run.run_id, again.id)
  assert.equal(restubbed.status, 'ready', restubbed.error); assert.equal(calls, 1)
  // Without the revert the saved before-text no longer matches: explain the next step.
  const stale = await service.retry(f.dataRoot, f.run.run_id, reused.id, f.root, { mode: 'reuse' })
  await service.push(f.dataRoot, f.run.run_id, again.id)
  await wait(service)
  const staleRead = await service.read(f.dataRoot, f.run.run_id, stale.id)
  assert.ok(['ready', 'failed'].includes(staleRead.status))
})

test('stale reuse explains that only relocation is needed; reference regeneration receives the saved result', async t => {
  const f = await fixture(t); const prompts = []
  const service = new FaultInjectionService({ generate: async ({ record, prompt, scratchDirectory }) => {
    prompts.push({ prompt, scratchDirectory }); return generated(record)
  } })
  const first = await service.start(f); await wait(service)
  await service.push(f.dataRoot, f.run.run_id, first.id)
  const stale = await service.retry(f.dataRoot, f.run.run_id, first.id, f.root, { mode: 'reuse' }); await wait(service)
  const failed = await service.read(f.dataRoot, f.run.run_id, stale.id)
  assert.equal(failed.status, 'failed'); assert.match(failed.error, /复用的结果与当前源码不一致.*参考上次结果重新生成/s)
  const referenced = await service.retry(f.dataRoot, f.run.run_id, stale.id, f.root, { mode: 'reference' }); await wait(service)
  const last = prompts.at(-1)
  assert.match(last.prompt, /参考结果：.*reference-result\.json/)
  assert.match(last.prompt, /上一次未完成的原因：复用的结果与当前源码不一致/)
  assert.deepEqual(JSON.parse(await readFile(path.join(last.scratchDirectory, 'reference-result.json'), 'utf8')).edits, generated({ case_keys: f.input.case_keys }).edits)
  assert.equal((await service.read(f.dataRoot, f.run.run_id, referenced.id)).reference_from.task_id, stale.id)
  await assert.rejects(service.retry(f.dataRoot, f.run.run_id, first.id, f.root, { mode: 'bogus' }), /未知重试方式/)
})

test('tasks written before result_saved existed expose their saved result for reuse', async t => {
  const f = await fixture(t)
  const service = new FaultInjectionService({ generate: async ({ record }) => generated(record) })
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
  const f = await fixture(t, { branch: 'develop_v3' })
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
