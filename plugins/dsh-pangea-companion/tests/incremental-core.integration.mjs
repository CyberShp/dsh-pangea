// Explicit cross-repository integration: set PANGEA_PYTHON to an interpreter
// with pangea-agent installed (or add its src directory to PYTHONPATH).
// This uses the real CLI and freezes real source snapshots; the model/session
// transport is isolated and does not call a model provider.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'

import { workbenchRouteHandler } from '../src/index.js'
import { createRun, runPangea } from '../src/pangea-api.js'
import { createTaskStore } from '../src/task-store.js'
import { createLaunchLogStore } from '../src/launch-log.js'
import { createRuntimeMonitor } from '../src/monitor.js'

const ok = value => ({ result: { ok: true, value } })
const json = async file => JSON.parse(await readFile(file, 'utf8'))
async function fingerprint(root, relative = '') {
  const files = {}
  for (const item of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = path.join(relative, item.name)
    if (item.isDirectory()) Object.assign(files, await fingerprint(root, name))
    else files[name] = createHash('sha256').update(await readFile(path.join(root, name))).digest('hex')
  }
  return files
}

test('task-derive and task-start freeze child Runs through the real core without changing parent files', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-incremental-core-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, '.agents/pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents/pangea/dsh.md'), '# Integration workspace')
  const dataRoot = path.join(root, 'pangea-data')
  const repository = path.join(dataRoot, 'repositories/demo')
  await mkdir(repository, { recursive: true })
  const before = 'int tls_release(int connected) { return connected ? 1 : 0; }\n'
  const after = 'int tls_release(int connected) { return connected ? 2 : -1; }\n'
  await writeFile(path.join(repository, 'tls.c'), before)

  const modelRoute = { provider: 'isolated', model: 'fixture-model' }
  const input = { repository: 'demo', target: 'TLS release', source_scope: ['tls.c'],
    analysis_profile: 'behavior-test-v2', scenario: 'module-analysis', mode: 'depth', model_route: modelRoute }
  const parentRun = await createRun(root, { ...input, data_root: dataRoot })
  await runPangea({ cwd: root, args: ['runs', 'stop', '--data-root', dataRoot, '--run-id', parentRun.run_id] })
  const parentRoot = path.join(dataRoot, 'runs', parentRun.run_id)
  const parentFiles = await fingerprint(parentRoot)
  const tasks = createTaskStore({ storePath: path.join(root, 'tasks.json') })
  const parent = await tasks.create({ workspace: root, dataRoot, input })
  await tasks.bindRun(parent.task_id, parentRun.run_id, 'source-first-v1')
  await tasks.addConversation(parent.task_id, { sessionId: 'parent-session', kind: 'analysis' })
  const parentTask = await tasks.get(parent.task_id)
  const launchLogs = createLaunchLogStore({ root: path.join(root, 'launch-logs') })
  const monitor = createRuntimeMonitor({ storePath: path.join(root, 'monitor.json') })
  const sessions = [], prompts = []
  const api = {
    workspace: { list: async () => ok({ items: [{ workspaceId: 'isolated-workspace', path: root }] }) },
    llm: {
      providers: async () => ok({ providers: [{ provider: 'isolated', displayName: 'Fixture', active: true }] }),
      models: async () => ok({ groups: [{ id: 'isolated', models: [{ id: 'fixture-model', name: 'Fixture' }] }] }),
    },
    settings: { describe: async () => ok({ namespaces: [] }) },
    sessions: {
      create: async () => { const sessionId = `child-session-${sessions.length + 1}`; sessions.push(sessionId); return ok({ sessionId }) },
      rename: async () => ok({}), selectModel: async () => ok({}),
      prompt: async request => { prompts.push(request.payload); return ok({}) },
    },
  }
  async function request(body) {
    const req = Readable.from([Buffer.from(JSON.stringify(body))])
    req.method = 'POST'; req.headers = { 'sec-fetch-site': 'same-origin' }
    req.url = `/api/pangea-companion/workbench?${new URLSearchParams({ cwd: root })}`
    const response = {}
    await workbenchRouteHandler(req, { writeHead(code) { response.code = code }, end(body) { response.body = JSON.parse(body) } },
      api, tasks, new Set(), launchLogs, {}, monitor)
    assert.equal(response.code, 200, JSON.stringify(response.body))
    return response.body
  }
  const options = (await request({ action: 'derivation-options', task_id: parent.task_id, run_id: parentRun.run_id })).options
  assert.equal(options.can_derive, true, options.blocked_reason)
  await writeFile(path.join(repository, 'tls.c'), after)

  const childRuns = []
  for (const mode of ['supplement', 'changed-files']) {
    const task = (await request({ action: 'task-derive', task_id: parent.task_id, run_id: parentRun.run_id,
      input: { mode, instruction: '仅补充连接关闭后的资源释放行为', selected_unit_ids: [], selected_records: [],
        changed_paths: mode === 'changed-files' ? ['tls.c'] : [] } })).task
    const started = await request({ action: 'task-start', task_id: task.task_id })
    const child = await tasks.get(task.task_id)
    assert.notEqual(child.run_id, parentRun.run_id)
    assert.ok(child.run_id)
    assert.equal(child.source_task_id, parent.task_id)
    assert.equal(child.conversations.length, 1)
    assert.notEqual(child.conversations[0].session_id, 'parent-session')
    assert.equal(child.owner_session_id, child.conversations[0].session_id)
    assert.equal(started.run.run_id, child.run_id)
    const childRoot = path.join(dataRoot, 'runs', child.run_id)
    const contract = await json(path.join(childRoot, 'inputs/task-contract.json'))
    assert.equal(contract.incremental_request.parent_run_id, parentRun.run_id)
    assert.equal(contract.incremental_request.mode, mode)
    const manifest = await json(path.join(childRoot, 'inputs/source-manifest.json'))
    assert.equal(await readFile(path.join(manifest.repositories[0].source_root, 'tls.c'), 'utf8'), mode === 'supplement' ? before : after)
    const plan = await json(path.join(childRoot, 'inputs/source-first-plan.json'))
    assert.deepEqual(plan.units, [])
    assert.deepEqual(await fingerprint(parentRoot), parentFiles)
    assert.deepEqual(await tasks.get(parent.task_id), parentTask)
    childRuns.push(child.run_id)
  }
  assert.notEqual(childRuns[0], childRuns[1])
  assert.equal(new Set(sessions).size, 2)
  assert.equal(prompts.length, 2)
  assert.ok(prompts.every(prompt => !prompt.content[0].text.includes('parent-session')))
  await monitor.flush()
})
