import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createTaskConversation, internalModelOptions, launchAnalysisSession, normalizeRunInput, stopAnalysisRun, workbenchSnapshot } from '../src/workbench-api.js'

const capabilities = { repositories: ['repo-one'], analysis_skill: { skill_id: 'codetalks-skill', version: '1.0.0' } }

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-workbench-'))
  await mkdir(path.join(root, '.agents', 'pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents', 'pangea', 'dsh.md'), '# DSH\n', 'utf8')
  return root
}

function ok(value) { return { result: { ok: true, value } } }

function internalModelApi(events = []) {
  return {
    llm: {
      async providers() { return ok({ providers: [
        { provider: 'minimax-1', displayName: 'MiniMax', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'minimax-1'], active: true, declared: true },
        { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [], active: true, declared: true },
      ] }) },
      async models() { return ok({ groups: [
        { id: 'minimax-1', name: 'MiniMax', models: [{ id: 'MiniMax-M2.7-highspeed', name: 'M2.7 highspeed' }] },
        { id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash', name: 'V4 Flash' }] },
      ], failures: [] }) },
    },
    settings: { async describe() { return ok({ namespaces: [{ ns: 'llm-pi-ai', value: { providers: { 'minimax-1': { apiKeyEnv: 'MINIMAX_1_API_KEY' } } } }] }) } },
    credentials: { async describe() { return ok({ credentials: { MINIMAX_1_API_KEY: { configured: true, writable: true } } }) } },
    workspace: { async list() { throw new Error('workspace.list not configured') } },
    sessions: {
      async selectModel(value) { events.push(['select-model', value.payload]); return ok({ selected: value.payload }) },
    },
  }
}

test('offers only configured internal provider routes', async () => {
  const catalog = await internalModelOptions(internalModelApi())
  assert.deepEqual(catalog.models.map(item => `${item.provider}/${item.model}`), ['minimax-1/MiniMax-M2.7-highspeed'])
  assert.equal(catalog.models[0].credential_configured, true)
})

test('fails closed before creating a session when the internal credential is missing and records the failing stage', async () => {
  const root = await workspace()
  let created = false
  const launchEvents = []
  try {
    const api = internalModelApi()
    api.credentials.describe = async () => ok({ credentials: { MINIMAX_1_API_KEY: { configured: false, writable: true } } })
    api.workspace.list = async () => ok({ items: [{ workspaceId: 'workspace-1', path: root }] })
    api.sessions.create = async () => { created = true; return ok({ sessionId: 'unexpected' }) }
    await assert.rejects(
      launchAnalysisSession(api, {
        cwd: root,
        input: { repository: 'repo-one', target: 'session', source_scope: ['src/session.c'] },
        model: { provider: 'minimax-1', model: 'MiniMax-M2.7-highspeed' },
      }, async () => capabilities, undefined, event => { launchEvents.push(event) }),
      /尚未配置凭证/,
    )
    assert.equal(created, false)
    assert.equal(launchEvents.some(event => event.stage === 'model_validate' && event.status === 'error'), true)
    assert.equal(launchEvents.some(event => event.stage === 'session_create'), false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('normalizes Run input and rejects unregistered repositories', () => {
  const input = normalizeRunInput({
    repository: 'repo-one', target: 'session', source_scope: ['src/session.c', 'src/session.c', ''],
    focus: ['recovery'], asset_ids: ['asset-1'], test_case_examples: ['TC-1'],
  }, capabilities)
  assert.deepEqual(input.source_scope, ['src/session.c'])
  assert.throws(() => normalizeRunInput({ repository: 'other', target: 'x', source_scope: ['x.c'] }, capabilities), /not registered/)
  assert.throws(() => normalizeRunInput({ repository: 'repo-one', target: 'x', source_scope: ['x.c'] }, { repositories: ['repo-one'] }), /codetalks-skill 1\.0\.0/)
})

test('returns paginated Run metadata and reports incompatible backends explicitly', async () => {
  const root = await workspace()
  try {
    const calls = []
    const snapshot = await workbenchSnapshot({ cwd: root, cursor: 10, limit: 5, runner: async input => {
      calls.push(input)
      return input.args[0] === 'system' ? { repositories: ['repo-one'] } : { items: [{ run_id: 'run-1' }], next_cursor: 15, total: 21 }
    } })
    assert.equal(snapshot.compatibility.compatible, true)
    assert.equal(snapshot.runs.total, 21)
    assert.deepEqual(calls[1].args.slice(-4), ['--cursor', '10', '--limit', '5'])

    const incompatible = await workbenchSnapshot({ cwd: root, runner: async () => { throw new Error('unsupported command') } })
    assert.equal(incompatible.compatibility.compatible, false)
    assert.match(incompatible.compatibility.error, /unsupported command/)
    assert.deepEqual(incompatible.runs.items, [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('returns the selected Run methodologies from the public runs get API unchanged', async () => {
  const root = await workspace()
  try {
    const methodologies = [{
      unit_id: 'U00',
      items: [{
        methodology_id: 'storage_nvme', title: 'NVMe 核心专项分析', path: '/runtime/storage_nvme.md',
        content_sha256: 'a'.repeat(64), selection_kind: 'specialized', selection_reason: '源码范围命中 NVMe 信号',
        source_baseline: 'NVMe Base 2.4', source_catalog_path: '/runtime/SOURCES.md',
      }],
    }]
    const calls = []
    const snapshot = await workbenchSnapshot({ cwd: root, runId: 'run-nvme', runner: async input => {
      calls.push(input.args)
      if (input.args[0] === 'system') return { repositories: ['repo-one'] }
      if (input.args[1] === 'list') return { items: [{ run_id: 'run-nvme' }], next_cursor: null, total: 1 }
      return { run_id: 'run-nvme', methodologies }
    } })
    assert.deepEqual(calls[2].slice(0, 2), ['runs', 'get'])
    assert.deepEqual(calls[2].slice(-2), ['--run-id', 'run-nvme'])
    assert.deepEqual(snapshot.run.methodologies, methodologies)
    assert.deepEqual(snapshot.run_detail, { run_id: 'run-nvme', status: 'ok', error: null })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('keeps the workbench available when one public runs get detail cannot be read', async () => {
  const root = await workspace()
  try {
    const snapshot = await workbenchSnapshot({ cwd: root, runId: 'run-bad', runner: async input => {
      if (input.args[0] === 'system') return { repositories: ['repo-one'] }
      if (input.args[1] === 'list') return { items: [{ run_id: 'run-bad' }], next_cursor: null, total: 1 }
      throw new Error('methodologies unavailable')
    } })
    assert.equal(snapshot.compatibility.compatible, true)
    assert.equal(snapshot.run, null)
    assert.deepEqual(snapshot.run_detail, { run_id: 'run-bad', status: 'error', error: 'methodologies unavailable' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('launches a dedicated DSH session that owns the complete Run lifecycle and reports startup stages', async () => {
  const root = await workspace()
  try {
    const events = []
    const launchEvents = []
    const api = {
      ...internalModelApi(events),
      workspace: { async list() { return ok({ items: [{ workspaceId: 'workspace-1', path: root }] }) } },
      sessions: {
        ...internalModelApi(events).sessions,
        async create(value) { assert.equal(value.payload.workspaceId, 'workspace-1'); events.push('create'); return ok({ sessionId: 'session-1' }) },
        async rename(value) { assert.match(value.payload.title, /session/); return ok({}) },
        async prompt(value) { events.push(['prompt', value.payload]); return ok({}) },
      },
    }
    const result = await launchAnalysisSession(api, {
      cwd: root,
      input: { repository: 'repo-one', target: 'session', source_scope: ['src/session.c'], asset_ids: ['asset-1'] },
      model: { provider: 'minimax-1', model: 'MiniMax-M2.7-highspeed' },
    }, async () => capabilities, async session => {
      events.push(['persist', session])
    }, async event => { launchEvents.push(event) })
    assert.equal(result.session_id, 'session-1')
    assert.equal(events[1][0], 'select-model')
    assert.deepEqual(events[1][1], { sessionId: 'session-1', provider: 'minimax-1', model: 'MiniMax-M2.7-highspeed' })
    assert.equal(events[2][0], 'persist')
    assert.equal(events[2][1].session_id, 'session-1')
    assert.equal(events[3][0], 'prompt')
    assert.match(events[3][1].content[0].text, /pangea_run_create/)
    assert.match(events[3][1].content[0].text, /"asset_ids": \[/)
    assert.match(events[3][1].content[0].text, /完整 action 流程/)
    assert.match(events[3][1].content[0].text, /codetalks-skill 1\.0\.0/)
    for (const stage of ['capabilities_check', 'model_validate', 'session_create', 'model_select', 'session_record', 'prompt_submit', 'waiting_for_run']) {
      assert.equal(launchEvents.some(event => event.stage === stage), true, `missing launch stage ${stage}`)
    }
    assert.equal(launchEvents.find(event => event.stage === 'session_create' && event.status === 'ok')?.session_id, 'session-1')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('creates an additional DSH conversation without starting another Run', async () => {
  const root = await workspace()
  try {
    const calls = []
    const api = {
      workspace: { async list() { return ok({ items: [{ workspaceId: 'workspace-1', path: root }] }) } },
      sessions: {
        async create(value) { calls.push(['create', value.payload]); return ok({ sessionId: 'session-2' }) },
        async rename(value) { calls.push(['rename', value.payload]); return ok({}) },
      },
    }
    const result = await createTaskConversation(api, { cwd: root, title: '任务会话 2' })
    assert.equal(result.session_id, 'session-2')
    assert.deepEqual(calls[0], ['create', { workspaceId: 'workspace-1' }])
    assert.equal(calls[1][1].title, '任务会话 2')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('stops one explicit Run through the public runs API', async () => {
  const root = await workspace()
  try {
    let call
    const result = await stopAnalysisRun({ cwd: root, runId: 'run-17', runner: async value => { call = value; return { run_id: 'run-17', lifecycle_status: 'stopped' } } })
    assert.deepEqual(call.args.slice(0, 2), ['runs', 'stop'])
    assert.deepEqual(call.args.slice(-2), ['--run-id', 'run-17'])
    assert.equal(result.run.lifecycle_status, 'stopped')
  } finally { await rm(root, { recursive: true, force: true }) }
})
