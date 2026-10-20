import assert from 'node:assert/strict'
import { realpath, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'

import { discoverAgentModels } from '../src/agent-models.js'
import { workbenchRouteHandler } from '../src/index.js'
import { createLaunchLogStore } from '../src/launch-log.js'
import { createRuntimeMonitor } from '../src/monitor.js'
import { createTaskStore } from '../src/task-store.js'

function ok(value) { return { result: { ok: true, value } } }

test('retired Claude Code architecture creation is rejected before creating a view or session', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'retired-architecture-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, '.agents/pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents/pangea/dsh.md'), '# fixture')
  const task = Object.freeze({ task_id: 'legacy-task', workspace: root, data_root: path.join(root, 'data'),
    run_id: 'legacy-run', provider: 'pangea-claude-code', target: '已保存分析' })
  const unexpected = new Proxy({}, { get(_target, key) { assert.fail(`must not access runtime ${String(key)}`) } })
  const request = Readable.from([Buffer.from(JSON.stringify({ action: 'architecture-create', task_id: task.task_id,
    profile: 'function_variables', type: 'function' }))])
  request.method = 'POST'
  request.url = `/api/pangea-companion/workbench?${new URLSearchParams({ cwd: root })}`
  request.headers = { 'sec-fetch-site': 'same-origin' }
  const response = {}
  await workbenchRouteHandler(request, { writeHead(code) { response.code = code }, end(body) { response.body = JSON.parse(body) } },
    unexpected, { get: async () => task }, new Set(), unexpected, unexpected, unexpected,
    async () => assert.fail('must not run the backend or create a view'))
  assert.equal(response.code, 400)
  assert.match(response.body.error, /Claude Code 支持已移除/)
  assert.equal(task.provider, 'pangea-claude-code')
})

test('home GET returns fresh workspace summaries without CLI, model RPCs, reconciliation or task details', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-route-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, '.agents/pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents/pangea/dsh.md'), '# fixture')
  let sequence = 0
  const store = createTaskStore({ storePath: path.join(root, 'tasks.json'), idFactory: () => `home-${++sequence}` })
  const input = { repository: 'repo-one', target: '首页摘要', source_scope: ['src'] }
  await store.create({ workspace: root, dataRoot: path.join(root, 'pangea-data'), input })
  await store.create({ workspace: path.join(root, 'other'), dataRoot: path.join(root, 'other/pangea-data'), input })
  let listCalls = 0
  let persistence = { status: 'degraded', pending: true, error: { code: 'EPERM', message: 'monitor save blocked' } }
  const monitor = { getPersistenceStatus() { return persistence } }
  const unexpected = new Proxy({}, { get(_target, key) { throw new Error(`home must not access ${String(key)}`) } })
  const tasks = { async list(options) { listCalls += 1; return store.list(options) } }
  async function request(origin = 'same-origin') {
    const req = Readable.from([])
    req.method = 'GET'
    req.url = `/api/pangea-companion/workbench?${new URLSearchParams({ cwd: root, view: 'home', run_id: 'unrelated', session_id: 'unrelated' })}`
    req.headers = { 'sec-fetch-site': origin }
    const response = {}
    await workbenchRouteHandler(req, {
      writeHead(code) { response.code = code }, end(body) { response.body = JSON.parse(body) },
    }, unexpected, tasks, unexpected, unexpected, unexpected, monitor, async () => { throw new Error('home must not start Python') })
    return response
  }
  const first = await request()
  assert.equal(first.code, 200, JSON.stringify(first.body))
  assert.equal(first.body.view, 'home')
  assert.equal(first.body.tasks.total, 1)
  assert.equal(first.body.tasks.items[0].workspace, root)
  assert.equal(first.body.compatibility.checked, false)
  assert.equal(first.body.compatibility.compatible, null)
  assert.equal(first.body.model_routing, undefined)
  assert.equal(first.body.launch_log, undefined)
  assert.equal(first.body.run, null)
  assert.deepEqual(first.body.monitor_persistence, persistence)
  await store.create({ workspace: root, dataRoot: path.join(root, 'pangea-data'), input: { ...input, target: '新增任务' } })
  persistence = { status: 'healthy', pending: false, error: null }
  const refreshed = await request()
  assert.deepEqual(refreshed.body.monitor_persistence, persistence)
  assert.equal(refreshed.body.tasks.total, 2, 'a subsequent read must observe new tasks, without a stale response cache')
  assert.equal(listCalls, 2)
  assert.equal((await request('cross-site')).code, 403)
  assert.equal(listCalls, 2)
})

test('home checks exact runtime ownership without draining jobs or claiming lost executions are still running', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-runtime-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, '.agents/pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents/pangea/dsh.md'), '# fixture')
  const dataRoot = path.join(root, 'pangea-data')
  for (const runId of ['complete', 'unfinished']) {
    const folder = path.join(dataRoot, 'runs', runId)
    await mkdir(folder, { recursive: true })
    await writeFile(path.join(folder, 'progress.json'), JSON.stringify({
      run_id: runId, workflow_version: 'source-first-v1', lifecycle_status: runId === 'complete' ? 'complete' : 'running',
    }))
    if (runId === 'complete') {
      for (const filename of ['report.md', 'report.html', 'report-complete.json']) await writeFile(path.join(folder, filename), '{}')
    }
  }
  const items = ['lost', 'mismatch', 'live', 'done', 'unfinished', 'native-lost'].map(id => ({
    task_id: id, workspace: root, data_root: dataRoot, run_id: id === 'unfinished' ? 'unfinished' : 'complete',
    workflow_version: 'source-first-v1', status: 'running', execution_status: 'running',
    provider: id === 'native-lost' ? null : 'external', job_id: id === 'native-lost' ? null : id,
    job_started_at: 123, owner_session_id: 'owner', conversations: [],
  }))
  const runtime = {
    agents: { get() { return undefined } },
    jobs: {
      get(id) { return id === 'lost' ? null : { id, startedAt: id === 'mismatch' ? 456 : 123, status: ['done', 'unfinished'].includes(id) ? 'completed' : 'running' } },
      read() { throw new Error('home must not consume job output') },
    },
  }
  const req = Readable.from([])
  req.method = 'GET'
  req.url = `/api/pangea-companion/workbench?${new URLSearchParams({ cwd: root, view: 'home' })}`
  req.headers = { 'sec-fetch-site': 'same-origin' }
  let response
  await workbenchRouteHandler(req, { writeHead(code) { assert.equal(code, 200) }, end(body) { response = JSON.parse(body) } },
    {}, { async list() { return items } }, new Set(), {}, runtime, {}, async () => { throw new Error('home must not start Python') })
  const byId = new Map(response.tasks.items.map(task => [task.task_id, task]))
  for (const id of ['lost', 'mismatch', 'native-lost']) {
    assert.equal(byId.get(id).status, 'needs_attention', id)
    assert.equal(byId.get(id).execution_status, 'interrupted', id)
    assert.ok(byId.get(id).needs_user_reason, id)
  }
  assert.equal(byId.get('live').status, 'running')
  assert.equal(byId.get('done').status, 'completed')
  assert.equal(byId.get('unfinished').status, 'needs_attention')
  assert.ok(items.every(task => task.status === 'running'), 'home projection must not mutate stored task states')
})

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
    '--product', 'PANGEA', '--version', ' V600R013C00 ', '--scope', 'nvme tcp', '--source', 'summary', '--b-version', 'B001'])
  assert.equal((await request({ ...query, module: '' })).code, 400)
  assert.equal((await request(query, 'cross-site')).code, 403)
  assert.equal(calls.length, 1)
  const scoped = await request({ product: query.product, c_version: query.c_version,
    scope: 'nvmf_tcp/transxxx/tls/handshake', recursive: false, source: 'auto', b_version: 'B001' })
  assert.equal(scoped.code, 200)
  assert.equal(scoped.body.acquisition.status, 'no_data')
  assert.deepEqual(calls[1].args, ['assets', 'query-coverage', '--data-root', path.join(root, 'custom-data'),
    '--product', 'PANGEA', '--version', ' V600R013C00 ', '--scope', 'nvmf_tcp/transxxx/tls/handshake',
    '--no-recursive', '--source', 'auto', '--b-version', 'B001'])
  assert.equal(calls.length, 2)
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
  const catalogProvider = { async discoverModels() { return { current_model: 'native/selected', models: [{ id: 'native/selected' }] } } }
  const runtime = {
    agents: { get(id) { return id === owner.id ? owner : undefined } },
    subagents: {
      getProvider(id) { return id === 'pangea-nga' ? catalogProvider : undefined },
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


async function analysisRequest(root, body, { tasks = {}, runtime = {}, runner = async () => { throw new Error('must not create a Run') } } = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))])
  req.method = 'POST'
  req.url = `/api/pangea-companion/workbench?${new URLSearchParams({ cwd: root })}`
  req.headers = { 'sec-fetch-site': 'same-origin' }
  const response = {}
  await workbenchRouteHandler(req, { writeHead(code) { response.code = code }, end(body) { response.body = JSON.parse(body) } },
    {}, tasks, new Set(), { async append() {} }, runtime, {}, runner)
  return response
}

test('new-analysis HTTP admission rejects internal APIs and pending catalogues before creating a task, then freezes a proven default', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'analysis-admission-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, '.agents/pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents/pangea/dsh.md'), '# fixture')
  let creates = 0, createdInput
  const tasks = { async create(value) { creates++; createdInput = value.input; return { task_id: 'created', ...value.input } } }
  const provider = { async discoverModels() { return { current_model: 'model-one', models: [{ id: 'model-one' }] } } }
  const runtime = { subagents: { getProvider: () => provider } }
  for (const scenario of ['risk-analysis', 'branch-analysis', 'coverage-analysis', 'module-analysis']) {
    const result = await analysisRequest(root, { action: 'task-create', input: { scenario, model_route: { provider: 'api', model: 'configured' } } }, { tasks, runtime })
    assert.equal(result.code, 400)
    assert.match(result.body.error, /内部 API 分析支持已移除/)
  }
  const input = { repository: 'repo', target: 'test', provider_id: 'pangea-nga', agent_model: '' }
  assert.equal((await analysisRequest(root, { action: 'task-create', input }, { tasks, runtime })).code, 400)
  assert.equal(creates, 0)
  const catalog = await discoverAgentModels(runtime, { providerId: 'pangea-nga', cwd: root })
  const accepted = await analysisRequest(root, { action: 'task-create', input: { ...input, agent_catalog_id: catalog.catalog_id } }, { tasks, runtime })
  assert.equal(accepted.code, 200, accepted.body.error)
  assert.equal(creates, 1)
  assert.equal(createdInput.agent_model, 'model-one')
  assert.equal(createdInput.model_route, null)
  await discoverAgentModels(runtime, { providerId: 'pangea-nga', cwd: root })
  const stale = await analysisRequest(root, { action: 'task-create', input: { ...input, agent_catalog_id: catalog.catalog_id } }, { tasks, runtime })
  assert.equal(stale.code, 400)
  assert.match(stale.body.error, /已被重新读取/)
  assert.equal(creates, 1)
})

test('task-start refuses changed or empty providers and historical unfixed defaults without modifying task identity', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'analysis-frozen-model-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, '.agents/pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents/pangea/dsh.md'), '# fixture')
  const task = Object.freeze({ task_id: 'old-task', workspace: root, run_id: 'old-run', provider: 'pangea-nga',
    agent_model: null, attempt_id: 'old-attempt', execution_status: 'stopped', acp_binding: 'saved-binding' })
  const tasks = { async get() { return task }, async prepareProviderLaunch() { assert.fail('must not mutate the stored task') } }
  for (const provider_id of ['', null, 'pangea-codeagent']) {
    const result = await analysisRequest(root, { action: 'task-start', task_id: task.task_id, provider_id, resume: true }, { tasks })
    assert.equal(result.code, 400)
    assert.match(result.body.error, /执行 Agent 已冻结/)
  }
  const result = await analysisRequest(root, { action: 'task-start', task_id: task.task_id, resume: true }, { tasks })
  assert.equal(result.code, 400)
  assert.match(result.body.error, /历史任务未固定模型/)
  assert.equal(task.agent_model, null)
  assert.equal(task.attempt_id, 'old-attempt')
  assert.equal(task.acp_binding, 'saved-binding')
})


test('analysis GET returns external providers without querying internal model APIs', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'analysis-external-catalog-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, '.agents/pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents/pangea/dsh.md'), '# fixture')
  let internalReads = 0
  const api = new Proxy({}, { get(_target, key) { internalReads++; throw new Error(`analysis must not read internal API ${String(key)}`) } })
  const tasks = { async reconcileRuns() {}, async list() { return [] } }
  const provider = {}
  const runtime = { subagents: { getProvider: id => id === 'pangea-nga' ? provider : undefined } }
  const request = Readable.from([])
  request.method = 'GET'
  request.url = `/api/pangea-companion/workbench?${new URLSearchParams({ cwd: root })}`
  request.headers = { 'sec-fetch-site': 'same-origin' }
  const response = {}
  await workbenchRouteHandler(request, { writeHead(code) { response.code = code }, end(body) { response.body = JSON.parse(body) } },
    api, tasks, new Set(), {}, runtime, {}, async ({ args }) => {
      if (args[0] === 'system') return { repositories: ['repo-one'] }
      assert.deepEqual(args.slice(0, 2), ['runs', 'list'])
      return { items: [], total: 0 }
    })
  assert.equal(response.code, 200, response.body.error)
  assert.equal(internalReads, 0, 'even failed internal API reads must not be attempted')
  assert.equal(response.body.model_routing, undefined)
  assert.deepEqual(response.body.acp_providers.map(({ id, registered }) => ({ id, registered })), [
    { id: 'pangea-nga', registered: true },
    { id: 'pangea-codeagent', registered: false },
    { id: 'pangea-opencode', registered: false },
  ])
})


test('sequence creation passes normal admission while other Archify types remain experimental', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sequence-admission-'))
  const savedFlag = process.env.PANGEA_ARCHIFY_EXPERIMENTAL, savedRoot = process.env.PANGEA_ARCHIFY_ROOT
  delete process.env.PANGEA_ARCHIFY_EXPERIMENTAL
  delete process.env.PANGEA_ARCHIFY_ROOT
  t.after(async () => {
    if (savedFlag === undefined) delete process.env.PANGEA_ARCHIFY_EXPERIMENTAL; else process.env.PANGEA_ARCHIFY_EXPERIMENTAL = savedFlag
    if (savedRoot === undefined) delete process.env.PANGEA_ARCHIFY_ROOT; else process.env.PANGEA_ARCHIFY_ROOT = savedRoot
    await rm(root, { recursive: true, force: true })
  })
  await mkdir(path.join(root, '.agents/pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents/pangea/dsh.md'), '# fixture')
  const task = { task_id: 'task', workspace: root, data_root: root, run_id: 'run', provider: 'pangea-nga' }
  for (const type of ['sequence', 'workflow', 'architecture']) {
    const req = Readable.from([Buffer.from(JSON.stringify({ action: 'architecture-create', task_id: 'task', flow_id: 'F1', type }))])
    req.method = 'POST'; req.url = `/api/pangea-companion/workbench?${new URLSearchParams({ cwd: root })}`; req.headers = { 'sec-fetch-site': 'same-origin' }
    const response = {}
    await workbenchRouteHandler(req, { writeHead(code) { response.code = code }, end(body) { response.body = JSON.parse(body) } }, {}, { get: async () => task }, new Set(), {}, {}, {}, async () => assert.fail('must not run analysis'))
    assert.equal(response.code, 400)
    assert.match(response.body.error, type === 'sequence' ? /Archify runtime unavailable/ : /精美导出（实验）未开启/)
  }
})
