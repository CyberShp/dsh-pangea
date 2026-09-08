import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'

import { workbenchRouteHandler } from '../src/index.js'
import { createLaunchLogStore } from '../src/launch-log.js'
import { createRuntimeMonitor } from '../src/monitor.js'
import { createTaskStore } from '../src/task-store.js'

function ok(value) { return { result: { ok: true, value } } }

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-workbench-route-'))
  await mkdir(path.join(root, '.agents', 'pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents', 'pangea', 'dsh.md'), '# DSH\n', 'utf8')
  const dataRoot = path.join(root, 'pangea-data')
  const tasks = createTaskStore({ storePath: path.join(root, 'tasks.json'), idFactory: () => 'task-06', attemptIdFactory: () => 'attempt-06' })
  const monitor = createRuntimeMonitor({ storePath: path.join(root, 'monitor.json') })
  const launchLogs = createLaunchLogStore({ root: path.join(root, 'launch-logs') })
  const launchLocks = new Set()
  const task = await tasks.create({
    workspace: root, dataRoot,
    input: { repository: 'repo-one', target: 'ACP route regression', source_scope: ['src/session.c'], provider_id: 'pangea-nga' },
  })
  const owner = { id: 'session-06' }
  let jobHooks
  let providerStarts = 0
  const runtime = {
    agents: { get(id) { return id === owner.id ? owner : undefined } },
    subagents: {
      getProvider(id) { return id === 'pangea-nga' ? {} : undefined },
      async start() {
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
    if (args[0] === 'system') return { repositories: ['repo-one'], analysis_skill: { skill_id: 'codetalks-skill', version: '1.4.0' } }
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
