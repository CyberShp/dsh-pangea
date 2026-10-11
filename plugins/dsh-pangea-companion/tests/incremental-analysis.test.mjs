import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'

import { workbenchRouteHandler } from '../src/index.js'
import { createTaskStore } from '../src/task-store.js'
import { createLaunchLogStore } from '../src/launch-log.js'
import { normalizeIncrementalRequest } from '../src/incremental-request.js'
import { normalizeRunInput } from '../src/workbench-api.js'
import { createRun } from '../src/pangea-api.js'

const capabilities = { workflow_versions: ['source-first-v1'], source_first: {
  version: 'source-first-v1', contract_fields: ['analysis_settings', 'incremental_request'],
} }
const supplement = { mode: 'supplement', instruction: '只补充断链后的资源释放场景',
  selected_unit_ids: ['unit-tls'], selected_records: [{ action_id: 'worker-a', record_id: 'rec-1' }], changed_paths: [] }

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-incremental-host-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, '.agents/pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents/pangea/dsh.md'), '# isolated workspace')
  const dataRoot = path.join(root, 'pangea-data')
  const storePath = path.join(root, 'tasks.json')
  const tasks = createTaskStore({ storePath })
  const launchLogs = createLaunchLogStore({ root: path.join(root, 'launch-logs') })
  const parent = await tasks.create({ workspace: root, dataRoot, input: {
    repository: 'repo', target: 'TLS 建链', source_scope: ['src/tls.c'], context_scope: ['include/tls.h'],
    focus: ['release'], asset_ids: ['asset-a'], test_case_examples: ['case-a'], provider_id: 'pangea-nga', agent_model: 'native/model',
  } })
  await tasks.bindRun(parent.task_id, 'parent-run', 'source-first-v1')
  await tasks.addConversation(parent.task_id, { sessionId: 'parent-session', kind: 'analysis' })
  const options = { parent_run_id: 'parent-run', can_derive: true, blocked_reason: null,
    units: [{ unit_id: 'unit-tls', title: 'TLS 建链' }],
    records: [{ action_id: 'worker-a', record_id: 'rec-1', unit_id: 'unit-tls', kind: 'branch', title: 'TLS 释放' }] }
  const calls = []
  const runner = async ({ args }) => { calls.push(args); assert.equal(args[1], 'derivation-options'); return options }
  async function request(body, cwd = root) {
    const req = Readable.from([Buffer.from(JSON.stringify(body))])
    req.method = 'POST'
    req.url = `/api/pangea-companion/workbench?${new URLSearchParams({ cwd })}`
    req.headers = { 'sec-fetch-site': 'same-origin' }
    const response = {}
    await workbenchRouteHandler(req, {
      writeHead(code) { response.code = code }, end(body) { response.body = JSON.parse(body) },
    }, {}, tasks, new Set(), launchLogs, {}, {}, runner)
    return response
  }
  return { root, dataRoot, storePath, tasks, parent: await tasks.get(parent.task_id), options, calls, request }
}

test('derivation creates an independent persisted task and carries its exact selection through the CLI contract', async t => {
  const f = await fixture(t)
  const original = await f.tasks.get(f.parent.task_id)
  const response = await f.request({ action: 'task-derive', task_id: f.parent.task_id, run_id: 'parent-run',
    input: { ...supplement, repository: 'injected', provider_id: 'pangea-opencode', parent_run_id: 'injected' } })
  assert.equal(response.code, 200, JSON.stringify(response.body))
  const child = response.body.task
  assert.notEqual(child.task_id, original.task_id)
  assert.equal(child.source_task_id, original.task_id)
  assert.equal(child.target, 'TLS 建链 · 定向补充')
  assert.equal(child.repository, original.repository)
  assert.equal(child.provider, original.provider)
  assert.equal(child.agent_model, original.agent_model)
  assert.deepEqual(child.source_scope, original.source_scope)
  assert.deepEqual(child.context_scope, original.context_scope)
  assert.deepEqual(child.asset_ids, original.asset_ids)
  assert.equal(child.run_id, null)
  assert.equal(child.job_id, null)
  assert.deepEqual(child.conversations, [])
  assert.deepEqual(child.attempts, [])
  assert.deepEqual(await f.tasks.get(original.task_id), original)
  const reloaded = await createTaskStore({ storePath: f.storePath }).get(child.task_id)
  assert.deepEqual(reloaded.incremental_request, { ...supplement, parent_run_id: 'parent-run' })

  const input = normalizeRunInput({ ...reloaded, provider_id: reloaded.provider }, capabilities)
  let contract
  const result = await createRun(f.root, { ...input, data_root: f.dataRoot }, async ({ args }) => {
    if (args[0] === 'system') return capabilities
    assert.deepEqual(args.slice(0, 3), ['runs', 'create', '--contract'])
    contract = JSON.parse(await readFile(args.at(-1), 'utf8'))
    return { run_id: 'child-run', lineage: { parent_run_id: 'parent-run' } }
  })
  assert.equal(result.run_id, 'child-run')
  assert.deepEqual(contract.incremental_request, reloaded.incremental_request)
  assert.equal(contract.target, child.target)
  assert.equal(contract.run_id, undefined)
  assert.equal(contract.source_task_id, undefined)
  assert.deepEqual(await f.tasks.get(original.task_id), original)
})

test('derivation rejects mismatched Run, workspace, data root, and composite record identity before persisting a child', async t => {
  const f = await fixture(t)
  const base = { action: 'task-derive', task_id: f.parent.task_id, run_id: 'parent-run', input: supplement }
  assert.equal((await f.request({ ...base, run_id: 'other-run' })).code, 400)
  assert.equal((await f.request({ ...base, data_root: 'other-data' })).code, 400)
  assert.equal((await f.request(base, `${f.root}-other`)).code, 400)
  assert.equal(f.calls.length, 0)
  assert.equal((await f.request({ ...base, input: { ...supplement, selected_records: [{ action_id: 'worker-b', record_id: 'rec-1' }] } })).code, 400)
  assert.equal((await f.request({ ...base, input: { ...supplement, selected_unit_ids: ['other-unit'] } })).code, 400)
  assert.equal((await f.request({ ...base, input: { ...supplement, instruction: '' } })).code, 400)
  assert.equal((await f.tasks.list()).length, 1)
})

test('legacy unavailable options remain readable while unsupported derivation is rejected', async t => {
  const f = await fixture(t)
  f.options.can_derive = false
  f.options.blocked_reason = '旧 Run 缺少冻结源码，无法创建定向分析'
  const options = await f.request({ action: 'derivation-options', task_id: f.parent.task_id, run_id: 'parent-run' })
  assert.equal(options.code, 200)
  assert.equal(options.body.options.can_derive, false)
  const derived = await f.request({ action: 'task-derive', task_id: f.parent.task_id, run_id: 'parent-run', input: supplement })
  assert.equal(derived.code, 400)
  assert.match(derived.body.error, /缺少冻结源码/)
  assert.equal((await f.tasks.list()).length, 1)
})

test('changed-files analysis preserves explicit file paths and rejects escaping paths or mode confusion', async t => {
  const f = await fixture(t)
  const input = { ...supplement, mode: 'changed-files', instruction: '', changed_paths: ['src\\tls.c', './src/new.c', 'src/tls.c'] }
  const response = await f.request({ action: 'task-derive', task_id: f.parent.task_id, run_id: 'parent-run', input })
  assert.equal(response.code, 200, JSON.stringify(response.body))
  const child = response.body.task
  assert.equal(child.target, 'TLS 建链 · 变更分析')
  assert.equal(child.incremental_request.instruction, '')
  assert.deepEqual(child.incremental_request.changed_paths, ['src/tls.c', 'src/new.c'])
  assert.deepEqual(child.source_scope, f.parent.source_scope)
  for (const changed_paths of [[], ['../other.c'], ['/etc/file'], ['C:\\outside.c']]) {
    assert.throws(() => normalizeIncrementalRequest({ ...input, parent_run_id: 'parent-run', changed_paths }))
  }
  assert.throws(() => normalizeIncrementalRequest({ ...input, instruction: '补充清理', mode: 'supplement', parent_run_id: 'parent-run' }), /冻结源码/)
})

test('an older engine cannot silently start incremental requests as a new full analysis', async t => {
  const f = await fixture(t)
  const incremental_request = { ...supplement, parent_run_id: 'parent-run' }
  const oldCapabilities = { workflow_versions: ['source-first-v1'], source_first: { version: 'source-first-v1' } }
  assert.throws(() => normalizeRunInput({ repository: 'repo', target: 'TLS', source_scope: ['src/tls.c'], incremental_request }, oldCapabilities), /不支持定向补充/)
  let createCalls = 0
  await assert.rejects(createRun(f.root, { repository: 'repo', target: 'TLS', incremental_request }, async ({ args }) => {
    if (args[0] === 'system') return oldCapabilities
    createCalls += 1
    return { run_id: 'unexpected' }
  }), /不支持定向补充/)
  assert.equal(createCalls, 0)
  const bypass = await f.request({ action: 'task-create', input: { repository: 'repo', target: 'bypass', incremental_request } })
  assert.equal(bypass.code, 400)
  assert.equal((await f.tasks.list()).length, 1)
})
