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
  await injectionGit(root, ['init', '--bare', remote])
  await injectionGit(source, ['remote', 'add', 'origin', remote])
  await injectionGit(source, ['push', 'origin', 'main'])
  await mkdir(path.join(dataRoot, '.pangea', 'repository-settings'), { recursive: true })
  await writeFile(path.join(dataRoot, '.pangea', 'repository-settings', 'target.json'), JSON.stringify({ personal_branch: 'main', remote: 'origin' }))
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
  let service = new FaultInjectionService({ generate: generator })
  const server = createServer((req, res) => void faultInjectionRouteHandler(req, res, service, {}, { resolveRoot: async () => dataRoot, readRun: async () => run }))
  t.after(async () => { await service.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/api/pangea-companion/fault-injection`
  const request = async (input = {}, method = 'GET', site = 'same-origin') => {
    const payload = { run_id: run.run_id, ...input }
    const response = await fetch(method === 'GET' ? `${url}?${new URLSearchParams(payload)}` : url, {
      method, headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': site }, ...(method === 'GET' ? {} : { body: JSON.stringify(payload) }),
    })
    return { status: response.status, body: await response.json() }
  }
  const post = input => request(input, 'POST')
  const generate = (instructions = '', extra = {}) => post({
    action: 'generate',
    case_keys: ['unit/A'],
    instructions,
    commit_config: { issue: 'DTS2026111111059', author: 'h00600350', reviewer: 'h00600350' },
    ...extra,
  })
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
  let task
  await t.test('GET defaults and empty history', async () => {
    const r = await request(); assert.equal(r.status, 200); assert.deepEqual(r.body.tasks, [])
    assert.equal(r.body.defaults.repositories[0].personal_branch, 'main')
    assert.equal(r.body.defaults.commit_config.mode, 'template')
    assert.equal((await post({ action: 'generate', case_keys: ['unit/A'], commit_config: { mode: 'template', issue: '', author: '', reviewer: '' } })).status, 400)
  })
  await t.test('POST generate exposes ready only after cleanup, with exact diff and no commit', async () => {
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
      assert.equal((await post({ action: 'push', task_id: r.body.task.id })).status, 409)
      release.resolve()
      task = await terminal(r.body.task.id); assert.equal(task.status, 'ready', task.error)
      assert.match(task.repositories[0].diff, /return -1/)
      assert.equal(await readFile(path.join(source, 'target.c'), 'utf8'), original)
    } finally {
      release.resolve()
      service.prepareAndGenerate = originalPrepare
    }
  })
  await t.test('POST push exposes completion only after cleanup, then repeat is idempotent', async () => {
    const finished = Promise.withResolvers(), release = Promise.withResolvers()
    const originalBranchExclusive = service.branchExclusive
    service.branchExclusive = async (...args) => {
      const result = await originalBranchExclusive.apply(service, args)
      finished.resolve()
      await release.promise
      return result
    }
    try {
      const r = await post({ action: 'push', task_id: task.id })
      assert.equal(r.status, 200)
      const operation = service.active.get(service.key(dataRoot, run.run_id, task.id))
      await Promise.race([finished.promise, operation.done.then(() => assert.fail('push ended before the cleanup barrier'))])
      const draining = await request({ task_id: task.id })
      assert.equal(draining.status, 200)
      assert.equal(draining.body.task.status, 'pushing')
      assert.equal((await post({ action: 'push', task_id: task.id })).status, 409)
      release.resolve()
      task = await terminal(task.id); assert.equal(task.status, 'pushed', task.error)
      const repeated = await post({ action: 'push', task_id: task.id })
      assert.equal(repeated.status, 200); assert.equal(repeated.body.task.status, 'pushed')
      assert.equal(await injectionGit(remote, ['rev-parse', `refs/heads/${task.branch}`]), task.repositories[0].commit)
    } finally {
      release.resolve()
      service.branchExclusive = originalBranchExclusive
    }
  })
  await t.test('POST verify persists package/commit snapshot across service restart', async () => {
    const r = await post({ action: 'verify', task_id: task.id, build: { package_id: 'fixture-package', url: 'https://example.test/build/1' }, verification: { case_key: 'unit/A', result: 'not_triggered', hits: 'fixture:A=0' } })
    assert.equal(r.status, 200)
    await service.dispose(); service = new FaultInjectionService({ generate: generator })
    const saved = (await request({ task_id: task.id })).body.task
    assert.equal(saved.verification[0].result, 'not_triggered')
    assert.equal(saved.verification[0].build.commits[0].commit, task.repositories[0].commit)
    assert.equal((await request()).body.tasks.length, 1)
  })
  await t.test('pipeline URL configuration persists separately from build results', async () => {
    assert.equal((await post({ action: 'configure', task_id: task.id, pipeline_url: 'javascript:alert(1)' })).status, 400)
    const r = await post({ action: 'configure', task_id: task.id, pipeline_url: 'https://ci.example.test/pipeline?a=1' })
    assert.equal(r.status, 200)
    await service.dispose(); service = new FaultInjectionService({ generate: generator })
    const saved = (await request({ task_id: task.id })).body.task
    assert.equal(saved.pipeline_url, 'https://ci.example.test/pipeline?a=1')
    assert.equal(saved.build.url, 'https://example.test/build/1')
    assert.equal((await request()).body.defaults.pipeline_url, saved.pipeline_url)
  })
  await t.test('concurrent HTTP generations use one branch and distinct checkouts', async () => {
    const starts = await Promise.all([generate(), generate()]); starts.forEach(r => assert.equal(r.status, 202))
    const [a, b] = await Promise.all(starts.map(r => terminal(r.body.task.id)))
    assert.equal(a.status, 'ready'); assert.equal(b.status, 'ready')
    assert.equal(a.branch, b.branch); assert.notEqual(a.repositories[0].path, b.repositories[0].path)
    assert.equal(a.repositories[0].base_commit, b.repositories[0].base_commit)
  })
  await t.test('POST cancel stops a held generation and premature push is rejected', async () => {
    const start = await generate('hold'), id = start.body.task.id
    assert.equal((await post({ action: 'push', task_id: id })).status, 409)
    const r = await post({ action: 'cancel', task_id: id })
    assert.equal(r.status, 200); assert.equal(r.body.task.status, 'cancelled')
  })
  await t.test('generation failure is visible through GET and cannot be pushed', async () => {
    const r = await generate('fail'), failed = await terminal(r.body.task.id)
    assert.equal(failed.status, 'failed'); assert.match(failed.error, /fixture generation failed/)
    assert.equal((await post({ action: 'push', task_id: failed.id })).status, 400)
  })
  await t.test('invalid selections/actions/records/methods/origins return explicit HTTP errors', async () => {
    assert.equal((await post({ action: 'generate', case_keys: ['missing'] })).status, 400)
    assert.equal((await post({ action: 'unknown' })).status, 400)
    assert.equal((await request({ task_id: 'missing' })).status, 404)
    assert.equal((await request({}, 'DELETE')).status, 405)
    assert.equal((await request({}, 'GET', 'cross-site')).status, 403)
    assert.equal((await post({ action: 'verify', task_id: task.id, verification: { case_key: 'missing', result: 'passed' } })).status, 400)
  })
})
