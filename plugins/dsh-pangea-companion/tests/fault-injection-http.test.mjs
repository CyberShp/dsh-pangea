import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { FaultInjectionService, injectionGit } from '../src/fault-injection.js'
import { faultInjectionRouteHandler } from '../src/index.js'

// Real HTTP, filesystem and Git. Only the analysis projection and model are fixtures.
test('fault injection HTTP acceptance', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fi-http-'))
  const dataRoot = path.join(root, 'data'), source = path.join(dataRoot, 'repositories', 'target'), remote = path.join(root, 'remote.git')
  await mkdir(source, { recursive: true })
  await injectionGit(source, ['init', '-b', 'main'])
  await injectionGit(source, ['config', 'user.name', 'HTTP fixture'])
  await injectionGit(source, ['config', 'user.email', 'fixture@example.test'])
  const original = 'int operation(void) { return 0; }\n'
  await writeFile(path.join(source, 'target.c'), original)
  await injectionGit(source, ['add', 'target.c'])
  await injectionGit(source, ['commit', '-m', 'baseline'])
  const base = await injectionGit(source, ['rev-parse', 'HEAD'])
  await injectionGit(source, ['branch', 'personal'])
  await injectionGit(root, ['init', '--bare', remote])
  await injectionGit(source, ['remote', 'add', 'origin', remote])
  await injectionGit(source, ['push', 'origin', 'main', 'personal'])
  await mkdir(path.join(dataRoot, '.pangea', 'repository-settings'), { recursive: true })
  await writeFile(path.join(dataRoot, '.pangea', 'repository-settings', 'target.json'), JSON.stringify({ personal_branch: 'personal', remote: 'origin' }))
  const run = { run_id: 'http-run', source_snapshot: { repositories: [{ repo_id: 'target', git: { commit: base } }] }, details: { test_cases: [{ projection_id: 'unit/A', title: '资源申请失败' }] } }
  await mkdir(path.join(dataRoot, 'runs', run.run_id), { recursive: true })
  await writeFile(path.join(dataRoot, 'runs', run.run_id, 'progress.json'), JSON.stringify({ model_settings: { provider: 'fixture' }, model_id: 'fixture-model' }))
  const generator = async ({ record, signal }) => {
    if (record.instructions === 'hold') await new Promise((resolve, reject) => {
      if (signal.aborted) reject(signal.reason)
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    if (record.instructions === 'fail') throw new Error('fixture generation failed')
    const current = await readFile(path.join(record.repositories[0].path, 'target.c'), 'utf8')
    return { points: [{ id: 'A', trigger_scope: { current_input: 'fixture operation argument', excluded_inputs: ['previous operations'] }, repo_id: 'target', path: 'target.c' }], profiles: [{ case_key: 'unit/A', point_ids: ['A'], safety: { setup: [':'], negative_steps: [':'], negative_point_ids: ['A'], cleanup: [':'], cleanup_verify: [':'] }, steps: ['测试夹具'] }], edits: [{ repo_id: 'target', path: 'target.c', before: current, after: current.replace('return 0;', 'return -1;') + `/* ${record.id} */\n` }] }
  }
  let service = new FaultInjectionService({ generate: generator }), failReadRun = false
  const server = createServer((req, res) => void faultInjectionRouteHandler(req, res, service, {}, { resolveRoot: async () => dataRoot, readRun: async () => { if (failReadRun) throw new Error('Run unreadable'); return run } }))
  t.after(async () => { await service.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/api/pangea-companion/fault-injection`
  const isGlobalInput = input => input.view === 'all' || input.view === 'build-context' || Boolean(input.build_id && !input.run_id) || ['build', 'build-cancel', 'build-configure'].includes(input.action)
  const request = async (input = {}, method = 'GET', site = 'same-origin') => {
    const payload = isGlobalInput(input) ? input : { run_id: run.run_id, ...input }
    const response = await fetch(method === 'GET' ? `${url}?${new URLSearchParams(payload)}` : url, {
      method, headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': site }, ...(method === 'GET' ? {} : { body: JSON.stringify(payload) }),
    })
    return { status: response.status, body: await response.json() }
  }
  const post = input => request(input, 'POST')
  const buildPost = (extra = {}) => post({
    action: 'build',
    commit_config: { issue: 'DTS2026111111059', author: 'h00600350', reviewer: 'h00600350' },
    ...extra,
  })
  const generate = (instructions = '') => post({ action: 'generate', case_keys: ['unit/A'], instructions })
  const terminal = async id => {
    // Real Windows Git/process I/O is not a 2.5-second performance contract.
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      const r = await request({ task_id: id }); assert.equal(r.status, 200)
      if (!['preparing', 'generating', 'pushing'].includes(r.body.task.status)) return r.body.task
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.fail('HTTP task did not reach terminal state')
  }
  const terminalBuild = async id => {
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      const r = await request({ build_id: id }); assert.equal(r.status, 200)
      if (!['composing', 'pushing'].includes(r.body.build.status)) return r.body.build
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.fail('HTTP build did not reach terminal state')
  }
  let task, build
  await t.test('GET defaults, build-context, and empty global history', async () => {
    const all = await request({ view: 'all' }); assert.equal(all.status, 200)
    assert.deepEqual(all.body.tasks, []); assert.deepEqual(all.body.builds, [])
    const ctx = await request({ view: 'build-context' }); assert.equal(ctx.status, 200)
    assert.deepEqual(ctx.body.default_items, []); assert.equal(ctx.body.repositories[0].personal_branch, 'personal')
    assert.equal(ctx.body.commit_config.mode, 'template')
    const r = await request(); assert.equal(r.status, 200)
    assert.equal(r.body.defaults.repositories[0].personal_branch, 'personal')
    assert.equal(r.body.defaults.commit_config.mode, 'template')
  })
  await t.test('POST generate exposes ready only after cleanup, with exact diff and no commit; legacy push action returns 400', async () => {
    const finished = Promise.withResolvers(), release = Promise.withResolvers()
    const originalPrepare = service.prepareAndGenerate
    service.prepareAndGenerate = async (...args) => {
      await originalPrepare.apply(service, args)
      finished.resolve()
      await release.promise
    }
    try {
      const r = await generate(); assert.equal(r.status, 202)
      const operation = service.active.get(service.key(dataRoot, run.run_id, r.body.task.id))
      await Promise.race([finished.promise, operation.done.then(() => assert.fail('generation ended before the cleanup barrier'))])
      assert.equal((await request({ task_id: r.body.task.id })).body.task.status, 'generating')
      assert.equal((await buildPost({ items: [{ run_id: run.run_id, task_id: r.body.task.id }] })).status, 400)
      assert.equal((await post({ action: 'push', task_id: r.body.task.id })).status, 400)
      release.resolve()
      task = await terminal(r.body.task.id); assert.equal(task.status, 'ready', task.error)
      assert.match(task.repositories[0].diff, /return -1/)
      assert.equal(await readFile(path.join(source, 'target.c'), 'utf8'), original)
      assert.equal((await post({ action: 'build', items: [{ run_id: run.run_id, task_id: task.id }] })).status, 400)
    } finally {
      release.resolve()
      service.prepareAndGenerate = originalPrepare
    }
  })
  await t.test('POST build exposes pushing during branchExclusive, rejects concurrent retry with 409, completes to pushed, and repeat build_id is idempotent', async () => {
    const entered = Promise.withResolvers(), release = Promise.withResolvers()
    const originalBranchExclusive = service.branchExclusive
    service.branchExclusive = async (...args) => {
      entered.resolve()
      await release.promise
      return originalBranchExclusive.apply(service, args)
    }
    try {
      const r = await buildPost({ items: [{ run_id: run.run_id, task_id: task.id }] })
      assert.equal(r.status, 200)
      const buildId = r.body.build.id
      const operation = service.active.get(service.buildKey(dataRoot, buildId))
      await Promise.race([entered.promise, operation.done.then(() => assert.fail('build ended before branchExclusive barrier'))])
      const inFlight = await request({ build_id: buildId })
      assert.equal(inFlight.status, 200)
      assert.ok(['composing', 'pushing'].includes(inFlight.body.build.status))
      assert.equal((await buildPost({ build_id: buildId })).status, 409)
      release.resolve()
      build = await terminalBuild(buildId); assert.equal(build.status, 'pushed', build.error)
      const repeated = await buildPost({ build_id: build.id })
      assert.equal(repeated.status, 200); assert.equal(repeated.body.build.status, 'pushed')
      assert.equal(await injectionGit(remote, ['rev-parse', `refs/heads/${build.repositories[0].remote_branch}`]), build.repositories[0].commit)
      assert.equal(await injectionGit(source, ['rev-parse', 'HEAD']), base)
      const ctx = await request({ view: 'build-context' })
      assert.deepEqual(ctx.body.default_items, [{ run_id: run.run_id, task_id: task.id }])
    } finally {
      release.resolve()
      service.branchExclusive = originalBranchExclusive
    }
  })
  await t.test('POST verify auto-links pushed build_id and commit snapshot across service restart', async () => {
    const r = await post({ action: 'verify', task_id: task.id, build: { package_id: 'fixture-package', url: 'https://example.test/build/1' }, verification: { case_key: 'unit/A', result: 'not_triggered', hits: 'fixture:A=0' } })
    assert.equal(r.status, 200)
    await service.dispose(); service = new FaultInjectionService({ generate: generator })
    const saved = (await request({ task_id: task.id })).body.task
    assert.equal(saved.verification[0].result, 'not_triggered')
    assert.equal(saved.verification[0].build.build_id, build.id)
    assert.equal(saved.verification[0].build.commits[0].commit, build.repositories[0].commit)
    const allBefore = await request({ view: 'all' })
    assert.equal(allBefore.body.tasks.length, 1)
    assert.equal(allBefore.body.builds.length, 1)
    assert.equal(allBefore.body.tasks[0].latest_pushed_build.build_id, build.id)
    await mkdir(path.join(dataRoot, '.pangea', 'fault-injection', 'deleted-run', 'broken'), { recursive: true })
    await writeFile(path.join(dataRoot, '.pangea', 'fault-injection', 'deleted-run', 'broken', 'task.json'), 'corrupt')
    failReadRun = true
    try {
      const listed = await request({ view: 'all' }); assert.equal(listed.status, 200)
      assert.equal(listed.body.tasks.find(item => item.id === task.id).verified_count, 1)
      assert.equal(listed.body.tasks.find(item => item.id === 'broken').status, 'unreadable')
      assert.equal((await request({ task_id: task.id })).status, 200)
    } finally {
      failReadRun = false
      await rm(path.join(dataRoot, '.pangea', 'fault-injection', 'deleted-run'), { recursive: true, force: true })
    }
  })
  await t.test('pipeline URL configuration persists on builds and tasks separately from build verification artifacts', async () => {
    assert.equal((await post({ action: 'build-configure', build_id: build.id, pipeline_url: 'javascript:alert(1)' })).status, 400)
    const bCfg = await post({ action: 'build-configure', build_id: build.id, pipeline_url: 'https://ci.example.test/pipeline?a=1' })
    assert.equal(bCfg.status, 200)
    assert.equal((await post({ action: 'configure', task_id: task.id, pipeline_url: 'javascript:alert(1)' })).status, 400)
    const r = await post({ action: 'configure', task_id: task.id, pipeline_url: 'https://ci.example.test/pipeline?a=1' })
    assert.equal(r.status, 200)
    await service.dispose(); service = new FaultInjectionService({ generate: generator })
    const savedBuild = (await request({ build_id: build.id })).body.build
    assert.equal(savedBuild.pipeline_url, 'https://ci.example.test/pipeline?a=1')
    const saved = (await request({ task_id: task.id })).body.task
    assert.equal(saved.pipeline_url, 'https://ci.example.test/pipeline?a=1')
    assert.equal(saved.build.url, 'https://example.test/build/1')
    assert.equal((await request()).body.defaults.pipeline_url, saved.pipeline_url)
  })
  await t.test('concurrent HTTP generations share baseline commit and use distinct checkouts', async () => {
    const starts = await Promise.all([generate(), generate()]); starts.forEach(r => assert.equal(r.status, 202))
    const [a, b] = await Promise.all(starts.map(r => terminal(r.body.task.id)))
    assert.equal(a.status, 'ready'); assert.equal(b.status, 'ready')
    assert.equal(a.branch, b.branch); assert.notEqual(a.repositories[0].path, b.repositories[0].path)
    assert.equal(a.repositories[0].base_commit, b.repositories[0].base_commit)
  })
  await t.test('POST cancel stops a held generation and POST build-cancel stops a held synthesis build', async () => {
    const start = await generate('hold'), id = start.body.task.id
    assert.equal((await buildPost({ items: [{ run_id: run.run_id, task_id: id }] })).status, 400)
    const r = await post({ action: 'cancel', task_id: id })
    assert.equal(r.status, 200); assert.equal(r.body.task.status, 'cancelled')

    const entered = Promise.withResolvers(), release = Promise.withResolvers()
    const originalBranchExclusive = service.branchExclusive
    service.branchExclusive = async (record, callback, signal, rootArg) => {
      entered.resolve()
      await new Promise((resolve, reject) => {
        if (signal?.aborted) reject(signal.reason)
        else {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
          release.promise.then(resolve)
        }
      })
      return originalBranchExclusive.call(service, record, callback, signal, rootArg)
    }
    try {
      const startedBuild = await buildPost({ items: [{ run_id: run.run_id, task_id: task.id }] })
      assert.equal(startedBuild.status, 200)
      await entered.promise
      const cancelled = await post({ action: 'build-cancel', build_id: startedBuild.body.build.id })
      assert.equal(cancelled.status, 200)
      assert.equal(cancelled.body.build.status, 'cancelled')
    } finally {
      release.resolve()
      service.branchExclusive = originalBranchExclusive
    }
  })
  await t.test('generation failure is visible through GET and cannot be included in build', async () => {
    const r = await generate('fail'), failed = await terminal(r.body.task.id)
    assert.equal(failed.status, 'failed'); assert.match(failed.error, /fixture generation failed/)
    assert.equal((await post({ action: 'build', items: [{ run_id: run.run_id, task_id: failed.id }] })).status, 400)
  })
  await t.test('invalid selections/actions/records/methods/origins return explicit HTTP errors', async () => {
    assert.equal((await post({ action: 'generate', case_keys: ['missing'] })).status, 400)
    assert.equal((await post({ action: 'unknown' })).status, 400)
    assert.equal((await request({ task_id: 'missing' })).status, 404)
    assert.equal((await request({ build_id: 'missing' })).status, 404)
    assert.equal((await request({}, 'DELETE')).status, 405)
    assert.equal((await request({}, 'GET', 'cross-site')).status, 403)
    assert.equal((await post({ action: 'verify', task_id: task.id, verification: { case_key: 'missing', result: 'passed' } })).status, 400)
  })
})
