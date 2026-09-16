import assert from 'node:assert/strict'
import { realpath, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'

import { workbenchRouteHandler } from '../src/index.js'
import { createLaunchLogStore } from '../src/launch-log.js'
import { createRuntimeMonitor } from '../src/monitor.js'
import { createTaskStore } from '../src/task-store.js'

function ok(value) { return { result: { ok: true, value } } }

test('new-analysis coverage query uses literal arguments and returns acquisition state without starting a Run', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'query-route-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, '.agents/pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents/pangea/dsh.md'), '# fixture')
  const calls = []
  async function request(query, origin = 'same-origin') {
    const req = Readable.from([Buffer.from(JSON.stringify({ action: 'coverage-query', query, data_root: 'custom-data' }))])
    req.method = 'POST'
    req.url = `/api/pangea-companion/workbench?${new URLSearchParams({ cwd: root })}`
    req.headers = { 'sec-fetch-site': origin }
    const response = {}
    await workbenchRouteHandler(req, { writeHead(code) { response.code = code }, end(body) { response.body = JSON.parse(body) } },
      {}, {}, new Set(), {}, {}, {}, async options => { calls.push(options); return { status: 'no_data', asset: null, message: '无数据' } })
    return response
  }
  const query = { product: 'PANGEA', c_version: ' V600R013C00 ', module: 'nvme tcp', b_version: 'B001' }
  const result = await request(query)
  assert.equal(result.code, 200)
  assert.equal(result.body.acquisition.status, 'no_data')
  assert.equal(result.body.acquisition.asset, null)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args, ['assets', 'query-coverage', '--data-root', path.join(root, 'custom-data'),
    '--product', 'PANGEA', '--version', ' V600R013C00 ', '--module', 'nvme tcp', '--b-version', 'B001'])
  assert.equal((await request({ ...query, module: '' })).code, 400)
  assert.equal((await request(query, 'cross-site')).code, 403)
  assert.equal(calls.length, 1)
})

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-workbench-route-')))
  await mkdir(path.join(root, '.agents', 'pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents', 'pangea', 'dsh.md'), '# DSH\n', 'utf8')
  const dataRoot = path.join(root, 'pangea-data')
  const tasks = createTaskStore({ storePath: path.join(root, 'tasks.json'), idFactory: () => 'task-06', attemptIdFactory: () => 'attempt-06' })
  const monitor = createRuntimeMonitor({ storePath: path.join(root, 'monitor.json') })
  const launchLogs = createLaunchLogStore({ root: path.join(root, 'launch-logs') })
  const launchLocks = new Set()
  const task = await tasks.create({
    workspace: root, dataRoot,
    input: { repository: 'repo-one', target: 'ACP route regression', source_scope: ['src/session.c'], provider_id: 'pangea-nga', agent_model: 'native/selected' },
  })
  const owner = { id: 'session-06' }
  let jobHooks
  let providerStarts = 0
  const runtime = {
    agents: { get(id) { return id === owner.id ? owner : undefined } },
    subagents: {
      getProvider(id) { return id === 'pangea-nga' ? {} : undefined },
      async start(_provider, request) {
        assert.deepEqual(request.agentOptions, { model: 'native/selected' })
        providerStarts += 1
        return { id: 'agent-session-06', result: Promise.resolve({ stopReason: 'completed', output: [] }), async dispose() {} }
      },
    },
    jobs: {
      start(spec) { jobHooks = spec.run(); return 'job-06' },
      get() { return { startedAt: 1234, status: 'running' } },
    },
  }
  const api = {
    workspace: { async list() { return ok({ items: [{ workspaceId: 'workspace-1', path: root }] }) } },
    sessions: { async create() { return ok({ sessionId: owner.id }) }, async rename() { return ok({}) } },
  }
  const runner = async ({ args }) => {
    if (args[0] === 'system') return { repositories: ['repo-one'], analysis_skill: { skill_id: 'codetalks-skill', version: '1.4.9' } }
    if (args[1] === 'get') return { run_id: 'run-06', lifecycle_status: 'complete', report_available: true }
    assert.deepEqual(args.slice(0, 2), ['runs', 'create'])
    return { run_id: 'run-06', request_path: path.join(dataRoot, 'runs', 'run-06', 'request.md'), run_root: path.join(dataRoot, 'runs', 'run-06') }
  }
  return {
    root, dataRoot, tasks, task, monitor, launchLogs, launchLocks, api,
    get providerStarts() { return providerStarts },
    async start() {
      const req = Readable.from([Buffer.from(JSON.stringify({ action: 'task-start', task_id: task.task_id }))])
      req.method = 'POST'
      req.url = `/api/pangea-companion/workbench?${new URLSearchParams({ cwd: root })}`
      req.headers = { 'sec-fetch-site': 'same-origin' }
      const response = {}
      const res = { writeHead(status) { response.status = status }, end(body) { response.body = JSON.parse(body) } }
      await workbenchRouteHandler(req, res, api, tasks, launchLocks, launchLogs, runtime, monitor, runner)
      if (jobHooks) await jobHooks.done
      return response
    },
    async close() {
      if (jobHooks) await jobHooks.done
      await monitor.flush()
      await rm(root, { recursive: true, force: true })
    },
  }
}

test('task-start route binds its own Run, task, attempt, and owner session into the monitor', async () => {
  const value = await fixture()
  try {
    await value.monitor.bindExecution('session-05', { run_id: 'run-05', phase: 'FAILED' }, {
      dataRoot: value.dataRoot, taskId: 'task-05', attemptId: 'attempt-05',
    })
    const response = await value.start()
    assert.equal(response.status, 200, JSON.stringify(response.body))
    assert.equal(value.providerStarts, 1)
    const task = await value.tasks.get(value.task.task_id)
    assert.equal(task.run_id, 'run-06')
    assert.equal(task.attempt_id, 'attempt-06')
    assert.equal(task.owner_session_id, 'session-06')
    const snapshot = await value.monitor.snapshot({ dataRoot: value.dataRoot, runId: 'run-06' })
    assert.equal(snapshot.run?.run_id, task.run_id)
    assert.equal(snapshot.run?.data_root, process.platform === 'win32' ? value.dataRoot.toLowerCase() : value.dataRoot)
    assert.equal(snapshot.run?.task_id, task.task_id)
    assert.equal(snapshot.run?.attempt_id, task.attempt_id)
    assert.equal(snapshot.run?.session_id, task.owner_session_id)
    const previous = await value.monitor.snapshot({ dataRoot: value.dataRoot, runId: 'run-05' })
    assert.equal(previous.run.session_id, 'session-05')
    assert.equal(previous.run.pangea_phase, 'FAILED')
    const log = await value.launchLogs.read(task.task_id)
    assert.equal(log.events.some(event => event.stage === 'monitor_bind' && event.status === 'error'), false)
    assert.equal(log.events.some(event => event.stage === 'session_launch_complete' && event.status === 'ok'), true)
    assert.equal(value.launchLocks.size, 0)
  } finally { await value.close() }
})

test('task-start route retains the original session creation failure on its prepared attempt', async () => {
  const value = await fixture()
  const error = Object.assign(new Error('owner session creation unavailable'), { code: 'SESSION_CREATE_FAILED' })
  try {
    value.api.sessions.create = async () => { throw error }
    const response = await value.start()
    assert.equal(response.status, 400)
    assert.equal(response.body.error, error.message)
    assert.equal(value.providerStarts, 0)
    const task = await value.tasks.get(value.task.task_id)
    assert.equal(task.run_id, 'run-06')
    assert.equal(task.status, 'failed')
    assert.equal(task.execution_status, 'failed')
    assert.equal(task.launch_error, error.message)
    assert.equal(task.launch_error_code, error.code)
    assert.equal(task.attempt_id, 'attempt-06')
    assert.equal(task.attempts.length, 1)
    assert.equal(task.attempts[0].execution_status, 'failed')
    assert.equal(task.attempts[0].terminal_error, error.message)
    assert.equal(Number.isFinite(task.attempts[0].ended_at), true)
    const log = await value.launchLogs.read(task.task_id)
    const failed = log.events.find(event => event.stage === 'launch_failed')
    assert.equal(failed?.attempt_id, task.attempt_id)
    assert.equal(failed?.error, error.message)
    assert.equal(failed?.error_code, error.code)
    assert.equal(value.launchLocks.size, 0)
  } finally { await value.close() }
})

test('coverage pages use the stored task Run and root and reject unrelated requests', async () => {
  const value = await fixture()
  try {
    await value.start()
    const calls = []
    async function request(payload, cwd = value.root) {
      const req = Readable.from([Buffer.from(JSON.stringify({ action: 'coverage-page', task_id: value.task.task_id, run_id: 'run-06', ...payload }))])
      req.method = 'POST'
      req.url = `/api/pangea-companion/workbench?${new URLSearchParams({ cwd })}`
      req.headers = { 'sec-fetch-site': 'same-origin' }
      const response = {}
      const res = { writeHead(status) { response.status = status }, end(body) { response.body = JSON.parse(body) } }
      await workbenchRouteHandler(req, res, value.api, value.tasks, value.launchLocks, value.launchLogs, {}, value.monitor,
        async options => { calls.push(options); return { total: 1, items: [{ gap_id: 'GAP-000051', scope_status: 'unclassified' }], scope_summary: { total: 70 }, next_cursor: null } })
      return response
    }
    const response = await request({ data_root: '/not-the-task-root', cursor: 50, limit: 50, scope_status: 'unclassified', flow_id: 'F1', query: 'open', kind: 'function' })
    assert.equal(response.status, 200, JSON.stringify(response.body))
    assert.equal(response.body.run_id, 'run-06')
    assert.equal(response.body.page.items[0].gap_id, 'GAP-000051')
    assert.equal(calls[0].cwd, value.root)
    const args = calls[0].args
    assert.deepEqual(args.slice(0, 6), ['runs', 'coverage-page', '--data-root', value.dataRoot, '--run-id', 'run-06'])
    for (const [flag, expected] of [['--cursor', '50'], ['--scope-status', 'unclassified'], ['--flow-id', 'F1'], ['--query', 'open']]) assert.equal(args[args.indexOf(flag) + 1], expected)
    assert.notEqual((await request({ run_id: 'other-run' })).status, 200)
    assert.notEqual((await request({}, `${value.root}-other-workspace`)).status, 200)
    assert.equal(calls.length, 1)
  } finally { await value.close() }
})

test('deliver-current freezes the stored Run before delivery and rejects a different Run', async () => {
  const value = await fixture()
  const calls = []
  try {
    await value.tasks.bindRun(value.task.task_id, 'run-06', 'source-first-v1')
    const runner = async ({ args }) => {
      calls.push(args)
      return { run_id: 'run-06', workflow_version: 'source-first-v1', stage: args[1] === 'deliver-current' ? 'complete' : 'closing', lifecycle_status: args[1] === 'deliver-current' ? 'complete' : args[1] === 'stop' ? 'stopped' : 'running', quality_status: 'UNRESOLVED', partial_delivery: true }
    }
    const request = async runId => {
      const req = Readable.from([Buffer.from(JSON.stringify({ action: 'deliver-current', task_id: value.task.task_id, run_id: runId, data_root: '/wrong-root' }))])
      req.method = 'POST'; req.url = `/api/pangea-companion/workbench?${new URLSearchParams({ cwd: value.root })}`; req.headers = { 'sec-fetch-site': 'same-origin' }
      const response = {}, res = { writeHead(status) { response.status = status }, end(body) { response.body = JSON.parse(body) } }
      await workbenchRouteHandler(req, res, value.api, value.tasks, value.launchLocks, value.launchLogs, {}, value.monitor, runner)
      return response
    }
    assert.equal((await request('other-run')).status, 400)
    assert.equal(calls.length, 0)
    const response = await request('run-06')
    assert.equal(response.status, 200, JSON.stringify(response.body))
    assert.deepEqual(calls.map(args => args[1]), ['get', 'stop', 'deliver-current'])
    assert.ok(calls.every(args => args[args.indexOf('--data-root') + 1] === value.dataRoot))
    assert.equal(response.body.run.quality_status, 'UNRESOLVED')
  } finally { await value.close() }
})
