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
  const run = { run_id: 'http-run', source_snapshot: { repositories: [{ repo_id: 'target', git: { commit: base } }] }, details: { test_cases: [{ projection_id: 'unit/A', title: '资源申请失败' }] } }
  await mkdir(path.join(dataRoot, 'runs', run.run_id), { recursive: true })
  await writeFile(path.join(dataRoot, 'runs', run.run_id, 'progress.json'), JSON.stringify({ model_settings: { provider: 'fixture' }, model_id: 'fixture-model' }))
  const generator = async ({ record, signal }) => {
    if (record.instructions === 'hold') await new Promise((resolve, reject) => {
      if (signal.aborted) reject(signal.reason)
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    if (record.instructions === 'fail') throw new Error('fixture generation failed')
    return { points: [{ id: 'A', repo_id: 'target', path: 'target.c' }], profiles: [{ case_key: 'unit/A', point_ids: ['A'], steps: ['测试夹具'] }], edits: [{ repo_id: 'target', path: 'target.c', before: 'return 0;', after: 'return -1;' }] }
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
  const generate = (instructions = '') => post({ action: 'generate', case_keys: ['unit/A'], instructions })
  const terminal = async id => {
    for (let i = 0; i < 100; i++) {
      const r = await request({ task_id: id }); assert.equal(r.status, 200)
      if (!['preparing', 'generating', 'pushing'].includes(r.body.task.status)) return r.body.task
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.fail('HTTP task did not reach terminal state')
  }
  let task
  await t.test('GET defaults and empty history', async () => {
    const r = await request(); assert.equal(r.status, 200); assert.deepEqual(r.body.tasks, [])
    assert.equal(r.body.defaults.repositories[0].base_ref, base)
  })
  await t.test('POST generate → GET ready includes exact diff and commit', async () => {
    const r = await generate(); assert.equal(r.status, 202)
    task = await terminal(r.body.task.id); assert.equal(task.status, 'ready', task.error)
    assert.match(task.repositories[0].diff, /return -1/)
    assert.equal(await readFile(path.join(source, 'target.c'), 'utf8'), original)
  })
  await t.test('POST push publishes the recorded SHA and repeat is idempotent', async () => {
    for (let i = 0; i < 2; i++) {
      const r = await post({ action: 'push', task_id: task.id }); assert.equal(r.status, 200); assert.equal(r.body.task.status, 'pushed')
    }
    assert.equal(await injectionGit(remote, ['rev-parse', `refs/heads/${task.branch}`]), task.repositories[0].commit)
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
  await t.test('concurrent HTTP generations use distinct branches and checkouts', async () => {
    const starts = await Promise.all([generate(), generate()]); starts.forEach(r => assert.equal(r.status, 202))
    const [a, b] = await Promise.all(starts.map(r => terminal(r.body.task.id)))
    assert.equal(a.status, 'ready'); assert.equal(b.status, 'ready')
    assert.notEqual(a.branch, b.branch); assert.notEqual(a.repositories[0].path, b.repositories[0].path)
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
