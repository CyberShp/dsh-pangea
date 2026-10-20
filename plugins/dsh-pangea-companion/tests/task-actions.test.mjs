import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { workbenchRouteHandler } from '../src/index.js'
import { createTaskStore } from '../src/task-store.js'

const ok = value => ({ result: { ok: true, value } })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

async function recordQuiescentWorkers(f, task) {
  const folder = path.join(f.dataRoot, 'runs', task.run_id)
  await mkdir(folder, { recursive: true })
  await writeFile(path.join(folder, 'acp-workers.json'), JSON.stringify({
    runId: task.run_id, owner: { active: false }, workers: { worker: { quiescent: true } },
  }))
}

async function fixture(t, input = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'pangea-task-actions-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, '.agents/pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents/pangea/dsh.md'), '# test workspace')
  const dataRoot = path.join(root, 'pangea-data')
  let sequence = 0
  const storePath = path.join(root, 'tasks.json')
  const tasks = createTaskStore({ storePath, idFactory: () => `task-${++sequence}` })
  const task = await tasks.create({ workspace: root, dataRoot, input: { repository: 'repo-one', target: 'task action', source_scope: ['src'], ...input } })
  const calls = []
  const events = []
  const owner = { id: 'analysis-owner', status: 'idle', whenIdle: async () => {} }
  const f = { root, dataRoot, storePath, tasks, task, owner, calls, events, launchLocks: new Set(),
    launchLogs: { async append(_id, event) { events.push(event) } },
    monitor: { async bindExecution() {} },
    runtime: { agents: { get: id => id === owner.id ? owner : null } },
    api: { sessions: { async cancel({ payload }) { calls.push(['cancel', payload.sessionId]); return ok({}) } } },
    runner: async ({ args }) => { calls.push(args); return { run_id: args.at(-1), lifecycle_status: 'stopped' } },
  }
  f.request = async (body, cwd = root) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))])
    req.method = 'POST'
    req.url = `/api/pangea-companion/workbench?${new URLSearchParams({ cwd })}`
    req.headers = { 'sec-fetch-site': 'same-origin' }
    const response = {}
    await workbenchRouteHandler(req, { writeHead(code) { response.code = code }, end(body) { response.body = JSON.parse(body) } },
      f.api, f.tasks, f.launchLocks, f.launchLogs, f.runtime, f.monitor, options => f.runner(options))
    return response
  }
  f.bind = async ({ provider = 'pangea-nga', workflow = 'legacy-v1', jobStatus = 'running' } = {}) => {
    if (provider) await tasks.prepareProviderLaunch(task.task_id, provider)
    else await tasks.prepareLaunch(task.task_id, { provider: 'local', model: 'model' })
    await tasks.bindRun(task.task_id, 'run-one', workflow)
    await tasks.addConversation(task.task_id, { sessionId: owner.id, kind: 'analysis', title: 'analysis' })
    const current = await tasks.get(task.task_id)
    await tasks.bindOwnerSession(task.task_id, { ownerSessionId: owner.id, attemptId: current.attempt_id, hostProcessId: process.pid })
    if (provider) {
      f.job = { id: 'job-one', kind: 'subagent', startedAt: 1234, status: jobStatus }
      f.runtime.jobs = {
        get: () => f.job,
        async kill(id, jobOwner) { calls.push(['kill', id, jobOwner.id]); f.job.status = 'killed'; return 'killed' },
      }
      await tasks.bindJob(task.task_id, { jobId: f.job.id, ownerSessionId: owner.id, provider, jobStartedAt: f.job.startedAt, attemptId: current.attempt_id })
      await tasks.bindAgentRuntime(task.task_id, { attemptId: current.attempt_id, agentSessionId: 'fixture-agent', processId: 2147483647 })
    }
    return tasks.get(task.task_id)
  }
  return f
}

test('stop accepts a preparing task before it has any Run and deletion survives reload without removing data', async t => {
  const f = await fixture(t)
  const stop = await f.request({ action: 'stop', task_id: f.task.task_id })
  assert.equal(stop.code, 200)
  assert.equal(stop.body.stop_confirmed, true)
  assert.equal(stop.body.task.execution_status, 'stopped')
  assert.deepEqual(f.calls, [])
  await mkdir(path.join(f.dataRoot, 'runs/retained'), { recursive: true })
  const report = path.join(f.dataRoot, 'runs/retained/report.md')
  await writeFile(report, 'keep report')
  const removed = await f.request({ action: 'task-delete', task_id: f.task.task_id })
  assert.equal(removed.body.deleted, true)
  assert.deepEqual(removed.body.preserved, ['runs', 'reports', 'conversations', 'logs'])
  assert.equal((await f.tasks.list()).length, 0)
  const reloaded = createTaskStore({ storePath: f.storePath })
  assert.equal((await reloaded.list()).length, 0)
  assert.equal((await reloaded.list({ includeDeleted: true })).length, 1)
  assert.equal(await readFile(report, 'utf8'), 'keep report')
  assert.equal((await f.request({ action: 'task-delete', task_id: f.task.task_id })).body.deleted, true)
  assert.equal((await f.request({ action: 'task-start', task_id: f.task.task_id })).code, 400)
})

test('stop/delete reject mismatched workspace, Run, data root and attempt before touching an execution', async t => {
  const f = await fixture(t)
  const task = await f.bind()
  await mkdir(path.join(f.root, 'other-workspace/.agents/pangea'), { recursive: true })
  await writeFile(path.join(f.root, 'other-workspace/.agents/pangea/dsh.md'), '# other workspace')
  for (const action of ['stop', 'task-delete']) {
    for (const extra of [{ run_id: 'other-run' }, { data_root: path.join(f.root, 'other-data') }, { attempt_id: 'old-attempt' }]) {
      assert.equal((await f.request({ action, task_id: task.task_id, ...extra })).code, 400)
    }
    assert.equal((await f.request({ action, task_id: task.task_id, run_id: task.run_id }, path.join(f.root, 'other-workspace'))).code, 400)
  }
  assert.deepEqual(f.calls, [])
  assert.equal((await f.tasks.get(task.task_id)).execution_status, 'running')
})

test('legacy Run-only stop resolves an exact task or leaves unknown execution explicitly unconfirmed', async t => {
  const f = await fixture(t)
  const task = await f.bind()
  const bound = await f.request({ action: 'stop', run_id: task.run_id, data_root: f.dataRoot })
  assert.equal(bound.body.task.task_id, task.task_id)
  assert.equal(bound.body.stop_confirmed, true)
  const standalone = await f.request({ action: 'stop', run_id: 'historical-run', data_root: f.dataRoot })
  assert.equal(standalone.code, 200)
  assert.equal(standalone.body.run.lifecycle_status, 'stopped')
  assert.equal(standalone.body.task, null)
  assert.equal(standalone.body.stop_confirmed, false)
  assert.match(standalone.body.error, /没有关联任务/)
  assert.equal((await f.tasks.list({ includeDeleted: true })).length, 1)
  assert.equal((await f.request({ action: 'task-delete', run_id: 'historical-run' })).code, 400)
})

test('running ACP deletion closes Run writes and cancels only the bound Job before hiding the task', async t => {
  const f = await fixture(t)
  const task = await f.bind()
  const result = await f.request({ action: 'task-delete', task_id: task.task_id, run_id: task.run_id, attempt_id: task.attempt_id })
  assert.equal(result.body.deleted, true, JSON.stringify(result.body))
  assert.equal(result.body.stop_confirmed, true)
  assert.deepEqual(f.calls.map(call => call[0]), ['runs', 'kill'])
  assert.deepEqual(f.calls[0].slice(0, 2), ['runs', 'stop'])
  assert.deepEqual(f.calls[1], ['kill', 'job-one', 'analysis-owner'])
  assert.equal((await f.tasks.get(task.task_id)).conversations[0].session_id, f.owner.id)
})

test('kill acknowledgement is not stop confirmation and a failed stop remains visible and retryable', async t => {
  const f = await fixture(t)
  const task = await f.bind()
  let killCalls = 0
  f.runtime.jobs.kill = async () => { killCalls += 1; return 'requested' }
  let result = await f.request({ action: 'task-delete', task_id: task.task_id })
  assert.equal(result.body.deleted, false)
  assert.equal(result.body.stop_confirmed, false)
  assert.equal(result.body.task.execution_status, 'stopping')
  assert.match(result.body.error, /Job 尚未确认结束/)
  assert.equal((await f.tasks.list()).length, 1)
  f.job.status = 'killed'
  result = await f.request({ action: 'task-delete', task_id: task.task_id })
  assert.equal(result.body.deleted, true)
  assert.equal(killCalls, 1)
})

test('Run stop failures never fabricate a stopped Run and block deletion while still cancelling the exact Job', async t => {
  const f = await fixture(t)
  const task = await f.bind()
  f.runner = async () => { throw new Error('Run write fence unavailable') }
  const result = await f.request({ action: 'task-delete', task_id: task.task_id })
  assert.equal(result.body.deleted, false)
  assert.equal(result.body.run, null)
  assert.equal(result.body.run_stop.status, 'error')
  assert.match(result.body.error, /write fence unavailable/)
  assert.equal(f.job.status, 'killed')
  assert.equal((await f.tasks.list()).length, 1)
})

test('a failed source-first task with a pending worker cannot be deleted just because its outer Job ended', async t => {
  const f = await fixture(t)
  const task = await f.bind({ workflow: 'source-first-v1', jobStatus: 'failed' })
  await f.tasks.markLaunchFailed(task.task_id, '工具执行状态未确认', 'ACP_AGENT_FAILED')
  const folder = path.join(f.dataRoot, 'runs', task.run_id)
  await mkdir(folder, { recursive: true })
  const bindings = { runId: task.run_id, owner: { active: false }, workers: { worker: { quiescent: false, process_id: process.pid } } }
  await writeFile(path.join(folder, 'acp-workers.json'), JSON.stringify(bindings))
  const first = await f.request({ action: 'task-delete', task_id: task.task_id })
  assert.equal(first.body.deleted, false)
  assert.match(first.body.error, /原 ACP 请求或工具仍可能运行/)
  assert.equal((await f.tasks.list()).length, 1)
  bindings.workers.worker.quiescent = true
  await writeFile(path.join(folder, 'acp-workers.json'), JSON.stringify(bindings))
  const second = await f.request({ action: 'task-delete', task_id: task.task_id })
  assert.equal(second.body.deleted, true)
})

test('native cancellation must become idle before deletion, and failed cancellation can be retried', async t => {
  const f = await fixture(t)
  const task = await f.bind({ provider: null })
  f.owner.status = 'running'
  f.api.sessions.cancel = async () => { f.calls.push(['cancel']); throw new Error('session cancel unavailable') }
  let result = await f.request({ action: 'task-delete', task_id: task.task_id })
  assert.equal(result.body.deleted, false)
  assert.match(result.body.error, /session cancel unavailable/)
  assert.deepEqual(f.calls.map(call => call[0]), ['runs', 'cancel'], 'Run write admission closes before cancelling the session')
  f.api.sessions.cancel = async () => { f.owner.status = 'idle'; return ok({}) }
  result = await f.request({ action: 'task-delete', task_id: task.task_id })
  assert.equal(result.body.deleted, true, JSON.stringify(result.body))
})

test('deleting a previously confirmed stopped task does not cancel a historical session that no longer exists', async t => {
  const f = await fixture(t)
  const task = await f.bind({ provider: null })
  assert.equal((await f.request({ action: 'stop', task_id: task.task_id })).body.stop_confirmed, true)
  f.runtime.agents.get = () => null
  f.api.sessions.cancel = async () => { throw new Error('historical session no longer exists') }
  const result = await f.request({ action: 'task-delete', task_id: task.task_id })
  assert.equal(result.body.deleted, true, JSON.stringify(result.body))
})

for (const workflow of ['legacy-v1', 'source-first-v1']) {
  test(`a confirmed stopped ${workflow} task remains deletable after restart loses its Job`, async t => {
    const f = await fixture(t)
    const task = await f.bind({ workflow })
    if (workflow === 'source-first-v1') await recordQuiescentWorkers(f, task)
    assert.equal((await f.request({ action: 'stop', task_id: task.task_id })).body.stop_confirmed, true)
    f.calls.length = 0
    f.tasks = createTaskStore({ storePath: f.storePath })
    assert.ok(Number.isFinite((await f.tasks.get(task.task_id)).stop_confirmed_at))
    f.runtime.agents.get = () => null
    f.runtime.jobs.get = id => { throw new Error(`unknown job ${id}`) }
    f.api.sessions.cancel = async () => { throw new Error('historical session must not be cancelled') }

    const result = await f.request({ action: 'task-delete', task_id: task.task_id })

    assert.equal(result.code, 200)
    assert.equal(result.body.deleted, true, JSON.stringify(result.body))
    assert.equal(result.body.stop_confirmed, true)
    assert.deepEqual(f.calls, [], 'a confirmed stop must not send another Run stop or cancel a missing Job')
    assert.equal((await f.tasks.list()).length, 0)
    assert.equal((await createTaskStore({ storePath: f.storePath }).list()).length, 0)
  })

  test(`a persisted terminal ${workflow} task with a missing Job is deletable after execution evidence is checked`, async t => {
    const f = await fixture(t)
    const task = await f.bind({ workflow })
    await f.tasks.settleJob(task.job_id, { ...f.job, status: 'killed' })
    if (workflow === 'source-first-v1') await recordQuiescentWorkers(f, task)
    f.tasks = createTaskStore({ storePath: f.storePath })
    const persisted = await f.tasks.get(task.task_id)
    assert.equal(persisted.execution_status, 'stopped')
    assert.equal(persisted.stop_confirmed_at, null, 'a terminal Job event is not a confirmed task stop')
    f.runtime.jobs.get = id => { throw new Error(`unknown job ${id}`) }

    const result = await f.request({ action: 'task-delete', task_id: task.task_id })

    assert.equal(result.code, 200)
    assert.equal(result.body.deleted, true, JSON.stringify(result.body))
    assert.equal(result.body.stop_confirmed, true)
    assert.deepEqual(f.calls.map(call => call[0]), ['runs'], 'close Run writes without trying to kill a missing Job')
    assert.equal((await f.tasks.list()).length, 0)
  })
}

for (const previouslyConfirmed of [false, true]) {
  test(`a stopped task (${previouslyConfirmed ? 'previously confirmed' : 'terminal event only'}) with a matching live Job stays visible until that Job actually ends`, async t => {
    const f = await fixture(t)
    const task = await f.bind()
    if (previouslyConfirmed) await f.tasks.markStopped(task.task_id)
    else await f.tasks.settleJob(task.job_id, { ...f.job, status: 'killed' })
    f.tasks = createTaskStore({ storePath: f.storePath })
    assert.equal((await f.tasks.get(task.task_id)).execution_status, 'stopped')
    assert.equal(f.job.status, 'running')
    f.runtime.jobs.kill = async (id, owner) => { f.calls.push(['kill', id, owner.id]); return 'requested' }

    const first = await f.request({ action: 'task-delete', task_id: task.task_id })

    assert.equal(first.body.deleted, false)
    assert.equal(first.body.stop_confirmed, false)
    assert.match(first.body.error, /Job 尚未确认结束/)
    assert.equal((await f.tasks.list()).length, 1)
    assert.equal((await f.tasks.get(task.task_id)).stop_confirmed_at, null)
    assert.deepEqual(f.calls.map(call => call[0]), previouslyConfirmed ? ['kill'] : ['runs', 'kill'])
    assert.deepEqual(f.calls.at(-1), ['kill', task.job_id, f.owner.id])

    f.job.status = 'killed'
    const second = await f.request({ action: 'task-delete', task_id: task.task_id })
    assert.equal(second.body.deleted, true, JSON.stringify(second.body))
    assert.equal(f.calls.filter(call => call[0] === 'kill').length, 1)
  })
}

for (const workflow of ['legacy-v1', 'source-first-v1']) {
  test(`a missing historical ${workflow} Job does not prove that its persisted process or worker has exited`, async t => {
    const f = await fixture(t)
    const task = await f.bind({ workflow })
    await f.tasks.settleJob(task.job_id, { ...f.job, status: 'killed' })
    await f.tasks.bindAgentRuntime(task.task_id, { attemptId: task.attempt_id, agentSessionId: 'retained-agent', processId: process.pid })
    if (workflow === 'source-first-v1') {
      const folder = path.join(f.dataRoot, 'runs', task.run_id)
      await mkdir(folder, { recursive: true })
      await writeFile(path.join(folder, 'acp-workers.json'), JSON.stringify({
        runId: task.run_id, owner: { active: false }, workers: { worker: { quiescent: false, process_id: process.pid } },
      }))
    }
    f.runtime.jobs.get = id => { throw new Error(`unknown job ${id}`) }

    const result = await f.request({ action: 'task-delete', task_id: task.task_id })

    assert.equal(result.body.deleted, false)
    assert.equal(result.body.stop_confirmed, false)
    assert.match(result.body.error, /进程.*尚未确认/)
    assert.equal((await f.tasks.list()).length, 1)
    assert.equal(f.calls.some(call => call[0] === 'kill'), false)
  })
}

test('a Job belonging to another session remains a failure even for a confirmed stop', async t => {
  const f = await fixture(t)
  const task = await f.bind()
  await f.tasks.markStopped(task.task_id)
  f.runtime.jobs.get = id => { throw new Error(`job ${id} belongs to another session`) }

  const result = await f.request({ action: 'task-delete', task_id: task.task_id })

  assert.equal(result.body.deleted, false)
  assert.equal(result.body.stop_confirmed, false)
  assert.match(result.body.error, /job job-one belongs to another session/)
  assert.equal((await f.tasks.list()).length, 1)
  assert.deepEqual(f.calls, [])
})

test('stop during Run creation fences the late Run and prevents session creation or worker launch', async t => {
  const f = await fixture(t, { provider_id: 'pangea-nga', agent_model: 'native/selected' })
  const entered = deferred()
  const release = deferred()
  let sessionCreates = 0
  let providerStarts = 0
  f.api.workspace = { async list() { return ok({ items: [{ workspaceId: 'fixture-workspace', path: f.root }] }) } }
  f.api.sessions.create = async () => { sessionCreates += 1; return ok({ sessionId: f.owner.id }) }
  const provider = { async discoverModels() {
    return { current_model: 'native/selected', models: [{ id: 'native/selected', label: 'Selected' }] }
  } }
  f.runtime.subagents = { getProvider: () => provider, async start() { providerStarts += 1; throw new Error('must not start') } }
  f.runner = async ({ args }) => {
    f.calls.push(args)
    if (args[0] === 'system') return { repositories: ['repo-one'], analysis_skill: { skill_id: 'codetalks-skill', version: '1.4.9' } }
    if (args[1] === 'create') { entered.resolve(); await release.promise; return { run_id: 'late-run', run_root: path.join(f.dataRoot, 'runs/late-run'), request_path: '/fixture/request.md' } }
    if (args[1] === 'stop') return { run_id: 'late-run', lifecycle_status: 'stopped' }
    throw new Error(`unexpected ${args}`)
  }
  const start = f.request({ action: 'task-start', task_id: f.task.task_id })
  await entered.promise
  const stop = await f.request({ action: 'stop', task_id: f.task.task_id })
  assert.equal(stop.body.stop_confirmed, false)
  assert.equal(stop.body.task.run_id, null)
  release.resolve()
  const started = await start
  assert.equal(started.code, 400)
  assert.match(started.body.error, /已请求停止/)
  const task = await f.tasks.get(f.task.task_id)
  assert.equal(task.run_id, 'late-run')
  assert.equal(task.execution_status, 'stopped')
  assert.equal(sessionCreates, 0)
  assert.equal(providerStarts, 0)
  assert.equal(f.calls.filter(call => call[1] === 'stop').length, 1)
  assert.equal((await f.request({ action: 'task-delete', task_id: f.task.task_id })).body.deleted, true)
})

test('soft delete rolls back its visibility when durable publication fails', async t => {
  const f = await fixture(t)
  await f.tasks.markStopped(f.task.task_id)
  const original = f.tasks.writeStore
  f.tasks.writeStore = async () => { throw new Error('EPERM task store locked') }
  await assert.rejects(f.tasks.softDelete(f.task.task_id), /EPERM/)
  assert.equal((await f.tasks.list()).length, 1)
  f.tasks.writeStore = original
  await f.tasks.softDelete(f.task.task_id)
  assert.equal((await f.tasks.list()).length, 0)
})

test('task-store EPERM still cancels the exact execution but never deletes or claims a durable stop', async t => {
  const f = await fixture(t)
  const task = await f.bind()
  f.tasks.writeStore = async () => { throw new Error('EPERM task store locked') }
  const result = await f.request({ action: 'task-delete', task_id: task.task_id })
  assert.equal(result.code, 200)
  assert.equal(result.body.deleted, false)
  assert.equal(result.body.stop_confirmed, false)
  assert.match(result.body.error, /EPERM/)
  assert.equal(f.job.status, 'killed')
  assert.equal(f.calls.some(call => call[0] === 'runs' && call[1] === 'stop'), true)
  assert.equal((await f.tasks.list()).length, 1)
})

test('a failed final stop publication stays unconfirmed in later reads until retry succeeds', async t => {
  const f = await fixture(t)
  const task = await f.bind()
  const original = f.tasks.writeStore
  let writes = 0
  f.tasks.writeStore = async (...args) => {
    if (++writes > 1) throw new Error('EPERM final stop publication locked')
    return original.apply(f.tasks, args)
  }
  const result = await f.request({ action: 'task-delete', task_id: task.task_id })
  assert.equal(result.body.deleted, false)
  assert.equal(result.body.stop_confirmed, false)
  const visible = (await f.tasks.list())[0]
  assert.equal(visible.execution_status, 'stopping')
  assert.equal(visible.stop_confirmed_at, null)
  assert.match(visible.launch_error, /EPERM/)
  f.tasks.writeStore = original
  assert.equal((await f.request({ action: 'task-delete', task_id: task.task_id })).body.deleted, true)
})

test('a terminal legacy ACP Job with a still-live process is not sufficient evidence for deletion', async t => {
  const f = await fixture(t)
  const task = await f.bind({ jobStatus: 'failed' })
  await f.tasks.bindAgentRuntime(task.task_id, { attemptId: task.attempt_id, agentSessionId: 'retained-agent', processId: process.pid })
  const result = await f.request({ action: 'task-delete', task_id: task.task_id })
  assert.equal(result.body.deleted, false)
  assert.match(result.body.error, /进程释放尚未确认/)
  assert.equal((await f.tasks.list()).length, 1)
})

test('a complete UNRESOLVED Run remains deletable after its actual terminal lifecycle is verified', async t => {
  const f = await fixture(t)
  const task = await f.bind({ jobStatus: 'completed' })
  await f.tasks.markLaunchFailed(task.task_id, 'needs attention', 'RUN_ATTENTION_REQUIRED')
  await f.tasks.reconcileRuns([{ run_id: task.run_id, lifecycle_status: 'complete', quality_status: 'UNRESOLVED' }], { dataRoot: f.dataRoot })
  assert.equal((await f.tasks.get(task.task_id)).status, 'needs_attention')
  f.runner = async ({ args }) => {
    f.calls.push(args)
    if (args[1] === 'stop') throw new Error('已经完成的 Run 不能停止')
    if (args[1] === 'get') return { run_id: task.run_id, lifecycle_status: 'complete', quality_status: 'UNRESOLVED' }
    throw new Error('unexpected CLI request')
  }
  const result = await f.request({ action: 'task-delete', task_id: task.task_id })
  assert.equal(result.body.deleted, true, JSON.stringify(result.body))
  assert.equal(result.body.run_stop.result, 'already-complete')
  assert.equal(result.body.run.quality_status, 'UNRESOLVED')
  assert.deepEqual(f.calls.map(call => call[1]), ['stop', 'get'])
})

test('concurrent delete requests wait for durable publication and both retain the task if it fails', async t => {
  const f = await fixture(t)
  await f.request({ action: 'stop', task_id: f.task.task_id })
  const entered = deferred()
  const release = deferred()
  const original = f.tasks.writeStore
  f.tasks.writeStore = async (file, content) => {
    if (JSON.parse(content).tasks[f.task.task_id].deleted_at !== null) {
      entered.resolve()
      await release.promise
      throw new Error('EPERM tombstone locked')
    }
    return original(file, content)
  }
  const first = f.request({ action: 'task-delete', task_id: f.task.task_id })
  await entered.promise
  let secondFinished = false
  const second = f.request({ action: 'task-delete', task_id: f.task.task_id }).then(result => { secondFinished = true; return result })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(secondFinished, false)
  release.resolve()
  for (const result of await Promise.all([first, second])) {
    assert.equal(result.code, 400)
    assert.match(result.body.error, /EPERM/)
    assert.notEqual(result.body.deleted, true)
  }
  assert.equal((await f.tasks.list()).length, 1)
})
