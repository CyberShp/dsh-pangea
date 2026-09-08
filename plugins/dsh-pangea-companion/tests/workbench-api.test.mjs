import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { acpProviderOptions, createTaskConversation, internalModelOptions, launchAnalysisSession, normalizeRunInput, resumeAnalysisRun, stopAnalysisRun, workbenchSnapshot } from '../src/workbench-api.js'

const capabilities = { repositories: ['repo-one'], analysis_skill: { skill_id: 'codetalks-skill', version: '1.3.0' } }
const acpRuntimeConfig = {
  version: 1,
  providers: {
    'pangea-nga': { command: 'nga', args: ['acp'], models: [{ id: 'nga-model', label: 'NGA Model', efforts: ['low', 'high'] }] },
  },
}

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
  assert.deepEqual(catalog.models.map(item => `${item.provider}/${item.model}`), ['minimax-1/MiniMax-M2.7-highspeed', 'deepseek-official/deepseek-v4-flash'])
  assert.equal(catalog.models[0].credential_configured, true)
})

test('advertises NGA, CodeAgent, OpenCode, and Claude Code ACP routes', () => {
  assert.deepEqual(acpProviderOptions({}).map(item => item.id), [
    'pangea-nga', 'pangea-codeagent', 'pangea-opencode', 'pangea-claude-code',
  ])
  const configured = acpProviderOptions({ PANGEA_ACP_RUNTIME_CONFIG: JSON.stringify({
    version: 1, providers: { 'pangea-opencode': { command: 'opencode-custom', args: ['acp'], models: [] } },
  }) })
  assert.deepEqual(configured[2].command, 'opencode-custom')
  assert.deepEqual(acpProviderOptions({})[3].kind, 'claude-code')
})

test('preserves structured command and version probe status for the runtime UI', () => {
  const [provider] = acpProviderOptions({ PANGEA_ACP_RUNTIME_CONFIG: JSON.stringify({
    version: 1,
    providers: {
      'pangea-nga': {
        command: 'nga',
        args: ['acp'],
        models: [],
        available: true,
        resolved_command: 'C:\\Tools\\nga.cmd',
        launcher_kind: 'windows-batch',
        resolution_status: 'resolved',
        version_status: 'unavailable',
        version_error: '--version exited with code 2',
      },
    },
  }) })
  assert.equal(provider.resolution_status, 'resolved')
  assert.equal(provider.version_status, 'unavailable')
  assert.equal(provider.version_error, '--version exited with code 2')
  assert.equal(provider.launcher_kind, 'windows-batch')
})

test('keeps legacy ACP model catalogs out of the provider launch contract', () => {
  const env = { PANGEA_ACP_RUNTIME_CONFIG: JSON.stringify(acpRuntimeConfig) }
  const provider = acpProviderOptions(env).find(item => item.id === 'pangea-nga')
  assert.equal(Object.hasOwn(provider, 'models'), false)
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

test('normalizes Run input and rejects legacy fields and unregistered repositories', () => {
  const input = normalizeRunInput({
    repository: 'repo-one', target: 'session', source_scope: ['src/session.c', 'src/session.c', ''],
    asset_ids: ['asset-1'],
  }, capabilities)
  assert.deepEqual(input.source_scope, ['src/session.c'])
  assert.equal(input.request_version, '2.0')
  assert.deepEqual(input.asset_ids, ['asset-1'])
  assert.equal(input.scenario, 'module-analysis')
  assert.equal(input.mode, 'depth')
  const speed = normalizeRunInput({ repository: 'repo-one', target: 'root cause', source_scope: ['src/session.c'], scenario: 'root-cause', mode: 'speed' }, capabilities)
  assert.equal(speed.scenario, 'root-cause')
  assert.equal(speed.mode, 'speed')
  assert.throws(() => normalizeRunInput({ repository: 'repo-one', target: 'x', source_scope: [], focus: ['recovery'] }, capabilities), /不支持字段.*focus/)
  assert.throws(() => normalizeRunInput({ repository: 'repo-one', target: 'x', source_scope: [], test_case_examples: ['TC-1'] }, capabilities), /不支持字段.*test_case_examples/)
  assert.throws(() => normalizeRunInput({ repository: 'repo-one', target: 'x', source_scope: ['x.c'], mode: 'preview' }, capabilities), /分析模式/)
  assert.throws(() => normalizeRunInput({ repository: 'other', target: 'x', source_scope: ['x.c'] }, capabilities), /not registered/)
  assert.throws(() => normalizeRunInput({ repository: 'repo-one', target: 'x', source_scope: ['x.c'] }, { repositories: ['repo-one'] }), /codetalks-skill 1\.3\.0/)
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

test('creates a Skill Run before launching its dedicated DSH session', async () => {
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
    const runner = async call => {
      if (call.args[0] === 'system') return capabilities
      assert.deepEqual(call.args.slice(0, 2), ['runs', 'create'])
      return {
        run_id: 'skill-run-1', request_path: '/runtime/request.md', run_root: '/runtime/run',
        source_snapshot: { file_count: 7, total_bytes: 8192, snapshot_duration_ms: 23 },
      }
    }
    const result = await launchAnalysisSession(api, {
      cwd: root,
      input: { repository: 'repo-one', target: 'session', source_scope: ['src/session.c'], asset_ids: ['asset-1'] },
      model: { provider: 'minimax-1', model: 'MiniMax-M2.7-highspeed' },
    }, runner, async session => {
      events.push(['persist', session])
    }, async event => { launchEvents.push(event) })
    assert.equal(result.session_id, 'session-1')
    assert.equal(events[1][0], 'select-model')
    assert.deepEqual(events[1][1], { sessionId: 'session-1', provider: 'minimax-1', model: 'MiniMax-M2.7-highspeed' })
    assert.equal(events[2][0], 'persist')
    assert.equal(events[2][1].session_id, 'session-1')
    assert.equal(events[3][0], 'prompt')
    assert.match(events[3][1].content[0].text, /\/runtime\/request\.md/)
    assert.match(events[3][1].content[0].text, /skill-run-1/)
    assert.match(events[3][1].content[0].text, /Step 01–09/)
    assert.doesNotMatch(events[3][1].content[0].text, /pangea_run_create/)
    assert.equal(result.run.run_id, 'skill-run-1')
    for (const stage of ['capabilities_check', 'model_validate', 'skill_run_create', 'session_create', 'model_select', 'session_record', 'prompt_submit', 'skill_started']) {
      assert.equal(launchEvents.some(event => event.stage === stage), true, `missing launch stage ${stage}`)
    }
    assert.equal(launchEvents.find(event => event.stage === 'session_create' && event.status === 'ok')?.session_id, 'session-1')
    const created = launchEvents.find(event => event.stage === 'skill_run_create' && event.status === 'ok')
    assert.equal(Number.isInteger(created?.duration_ms), true)
    assert.equal(created?.file_count, 7)
    assert.equal(created?.total_bytes, 8192)
    assert.equal(created?.snapshot_duration_ms, 23)
    for (const stage of ['capabilities_check', 'model_validate', 'skill_run_create', 'session_create', 'model_select', 'session_record', 'prompt_submit']) {
      assert.equal(Number.isInteger(launchEvents.find(event => event.stage === stage && event.status === 'ok')?.duration_ms), true)
    }
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

test('resumes an existing Run without creating a second Run', async () => {
  const root = await workspace()
  try {
    const events = []
    const api = {
      ...internalModelApi(events),
      workspace: { async list() { return ok({ items: [{ workspaceId: 'workspace-1', path: root }] }) } },
      sessions: {
        ...internalModelApi(events).sessions,
        async create() { return ok({ sessionId: 'session-resume' }) },
        async rename() { return ok({}) },
        async prompt(value) { events.push(['prompt', value.payload]); return ok({}) },
      },
    }
    const launchEvents = []
    const runner = async call => {
      if (call.args[0] === 'system') return capabilities
      assert.deepEqual(call.args.slice(0, 2), ['runs', 'resume'])
      assert.deepEqual(call.args.slice(-2), ['--run-id', 'skill-run-1'])
      return { run_id: 'skill-run-1', request_path: '/runtime/request.md', run_root: '/runtime/run', current_step: '04' }
    }
    const result = await launchAnalysisSession(api, {
      cwd: root,
      input: { repository: 'repo-one', target: 'session', source_scope: ['src/session.c'] },
      model: { provider: 'minimax-1', model: 'MiniMax-M2.7-highspeed' },
      resumeRunId: 'skill-run-1',
    }, runner, async () => {}, async event => launchEvents.push(event))
    assert.equal(result.run.run_id, 'skill-run-1')
    assert.equal(events.at(-1)[0], 'prompt')
    assert.match(events.at(-1)[1].content[0].text, /run_guard\.py init --resume/)
    assert.equal(launchEvents.some(event => event.stage === 'skill_run_resume' && event.status === 'ok'), true)
    assert.equal(launchEvents.some(event => event.stage === 'skill_run_create'), false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('resumes one explicit Run through the public runs API', async () => {
  const root = await workspace()
  try {
    let call
    const result = await resumeAnalysisRun({ cwd: root, dataRoot: 'pangea-data', runId: 'run-17', runner: async value => { call = value; return { run_id: 'run-17', lifecycle_status: 'running' } } })
    assert.deepEqual(call.args.slice(0, 2), ['runs', 'resume'])
    assert.deepEqual(call.args.slice(-2), ['--run-id', 'run-17'])
    assert.equal(result.run.lifecycle_status, 'running')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('starts an ACP provider with the Agent native session configuration', async () => {
  const root = await workspace()
  try {
    let promptCalled = false
    let providerStarted = false
    let providerRequest
    const api = {
      workspace: { async list() { return ok({ items: [{ workspaceId: 'workspace-1', path: root }] }) } },
      sessions: {
        async create() { return ok({ sessionId: 'owner-session' }) },
        async rename() { return ok({}) },
        async prompt() { promptCalled = true; return ok({}) },
      },
    }
    const owner = { id: 'owner-session' }
    const runtime = {
      agents: { get(id) { return id === owner.id ? owner : undefined } },
      subagents: {
        getProvider(id) { return id === 'pangea-nga' ? {} : undefined },
        async start(providerId, request) {
          providerStarted = true
          assert.equal(providerId, 'pangea-nga')
          providerRequest = request
          return { result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'done' }] }), dispose: async () => {} }
        },
      },
      jobs: {
        start(spec) { const hooks = spec.run(); void hooks.done; return 'subagent-1' },
        get() { return { startedAt: 1234, status: 'running' } },
      },
    }
    const runner = async call => call.args[0] === 'system'
      ? capabilities
      : { run_id: 'skill-run-acp', request_path: '/runtime/request.md', run_root: '/runtime/run' }
    const result = await launchAnalysisSession(api, {
      cwd: root,
      input: { repository: 'repo-one', target: 'ACP', source_scope: [], provider_id: 'pangea-nga', scenario: 'root-cause', mode: 'speed' },
    }, runner, async () => {}, async () => {}, runtime, { PANGEA_ACP_RUNTIME_CONFIG: JSON.stringify(acpRuntimeConfig) })
    assert.equal(result.job_id, 'subagent-1')
    assert.equal(result.provider, 'pangea-nga')
    assert.equal(providerStarted, true)
    assert.equal(Object.hasOwn(providerRequest, 'agentOptions'), false)
    assert.match(providerRequest.prompt[0].text, /速度型 root-cause 分析/)
    assert.equal(result.model, null)
    assert.equal(promptCalled, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('records the local Job identity before releasing the ACP provider start', async () => {
  const root = await workspace()
  try {
    const order = []
    let jobHooks
    let created
    const api = {
      workspace: { async list() { return ok({ items: [{ workspaceId: 'workspace-1', path: root }] }) } },
      sessions: {
        async create() { return ok({ sessionId: 'owner-session' }) },
        async rename() { return ok({}) },
      },
    }
    const owner = { id: 'owner-session' }
    const runtime = {
      agents: { get(id) { return id === owner.id ? owner : undefined } },
      subagents: {
        getProvider(id) { return id === 'pangea-nga' ? {} : undefined },
        async start() {
          order.push('provider-start')
          return { id: 'agent-session', result: Promise.resolve({ stopReason: 'completed', output: [] }), dispose: async () => {} }
        },
      },
      jobs: {
        start(spec) { jobHooks = spec.run(); return 'subagent-1' },
        get() { return { startedAt: 1234, status: 'running' } },
      },
    }
    const runner = async call => call.args[0] === 'system'
      ? capabilities
      : { run_id: 'skill-run-acp', request_path: '/runtime/request.md', run_root: '/runtime/run' }
    const result = await launchAnalysisSession(api, {
      cwd: root,
      input: { repository: 'repo-one', target: 'ACP barrier', source_scope: [], provider_id: 'pangea-nga' },
    }, runner, async () => {}, async () => {}, runtime, process.env, {
      onJobCreated(info) {
        created = info
        order.push('job-created')
      },
    })
    assert.equal(result.job_id, 'subagent-1')
    assert.deepEqual(created, { jobId: 'subagent-1', ownerSessionId: 'owner-session', jobStartedAt: 1234 })
    assert.deepEqual(order.slice(0, 2), ['job-created', 'provider-start'])
    await jobHooks.done
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('continues an incomplete Codetalks Run in the same ACP session before disposing it', async () => {
  const root = await workspace()
  try {
    let jobHooks
    let continued = 0
    let disposed = 0
    let runChecks = 0
    const api = {
      workspace: { async list() { return ok({ items: [{ workspaceId: 'workspace-1', path: root }] }) } },
      sessions: {
        async create() { return ok({ sessionId: 'owner-session' }) },
        async rename() { return ok({}) },
      },
    }
    const owner = { id: 'owner-session' }
    const runtime = {
      agents: { get(id) { return id === owner.id ? owner : undefined } },
      subagents: {
        getProvider() { return {} },
        async start() {
          return {
            id: 'agent-session',
            result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'Step 05 response ended' }] }),
            async continuePrompt(prompt) {
              continued += 1
              assert.match(prompt[0].text, /运行状态\.json/)
              assert.match(prompt[0].text, /已完成步骤：4\/9/)
              return { stopReason: 'completed', output: [{ type: 'text', text: 'Step 09 complete' }] }
            },
            async dispose() { disposed += 1 },
          }
        },
      },
      jobs: {
        start(spec) { jobHooks = spec.run(); return 'subagent-1' },
        get() { return { startedAt: 1234, status: 'running' } },
      },
    }
    const runner = async call => {
      if (call.args[0] === 'system') return capabilities
      if (call.args[0] === 'runs' && call.args[1] === 'get') {
        runChecks += 1
        return runChecks === 1
          ? { run_id: 'skill-run-acp', lifecycle_status: 'running', phase: 'STEP_05', report_available: false, completed_steps: ['01', '02', '03', '04'] }
          : { run_id: 'skill-run-acp', lifecycle_status: 'complete', phase: 'COMPLETE', report_available: true, completed_steps: ['01', '02', '03', '04', '05', '06', '07', '08', '09'] }
      }
      return { run_id: 'skill-run-acp', request_path: '/runtime/request.md', run_root: '/runtime/run' }
    }
    await launchAnalysisSession(api, {
      cwd: root,
      input: { repository: 'repo-one', target: 'ACP continuation', source_scope: [], provider_id: 'pangea-nga' },
    }, runner, async () => {}, async () => {}, runtime)

    const result = await jobHooks.done
    assert.equal(result.status, 'completed')
    assert.equal(continued, 1)
    assert.equal(runChecks, 2)
    assert.equal(disposed, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('stops automatic ACP continuation after two turns without Run progress', async () => {
  const root = await workspace()
  try {
    let jobHooks
    let continued = 0
    const owner = { id: 'owner-session' }
    const runtime = {
      agents: { get() { return owner } },
      subagents: {
        getProvider() { return {} },
        async start() {
          return {
            id: 'agent-session',
            result: Promise.resolve({ stopReason: 'completed', output: [] }),
            async continuePrompt() { continued += 1; return { stopReason: 'completed', output: [] } },
            async dispose() {},
          }
        },
      },
      jobs: { start(spec) { jobHooks = spec.run(); return 'subagent-1' }, get() { return { startedAt: 1234, status: 'running' } } },
    }
    const api = {
      workspace: { async list() { return ok({ items: [{ workspaceId: 'workspace-1', path: root }] }) } },
      sessions: { async create() { return ok({ sessionId: owner.id }) }, async rename() { return ok({}) } },
    }
    const runner = async call => call.args[0] === 'system'
      ? capabilities
      : call.args[0] === 'runs' && call.args[1] === 'get'
        ? { lifecycle_status: 'running', phase: 'STEP_05', report_available: false, analysis: { completed: 4 } }
        : { run_id: 'skill-run-acp', request_path: '/runtime/request.md', run_root: '/runtime/run' }
    await launchAnalysisSession(api, {
      cwd: root, input: { repository: 'repo-one', target: 'ACP no progress', source_scope: [], provider_id: 'pangea-nga' },
    }, runner, async () => {}, async () => {}, runtime)
    const result = await jobHooks.done
    assert.equal(result.status, 'failed')
    assert.deepEqual(JSON.parse(result.detail), {
      code: 'PANGEA_CONTINUATION_STALLED',
      message: 'ACP 连续续接未推进当前 Run（STEP_05）',
    })
    assert.equal(continued, 2)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('does not submit another ACP turn after cancellation during continuation', async () => {
  const root = await workspace()
  try {
    let jobHooks
    let releaseTurn
    let markTurnStarted
    const turnStarted = new Promise(resolve => { markTurnStarted = resolve })
    const turnRelease = new Promise(resolve => { releaseTurn = resolve })
    let continued = 0
    let disposed = 0
    const owner = { id: 'owner-session' }
    const runtime = {
      agents: { get() { return owner } },
      subagents: {
        getProvider() { return {} },
        async start() {
          return {
            id: 'agent-session', result: Promise.resolve({ stopReason: 'completed', output: [] }),
            async continuePrompt() { continued += 1; markTurnStarted(); await turnRelease; return { stopReason: 'completed', output: [] } },
            async dispose() { disposed += 1 },
          }
        },
      },
      jobs: { start(spec) { jobHooks = spec.run(); return 'subagent-1' }, get() { return { startedAt: 1234, status: 'running' } } },
    }
    const api = {
      workspace: { async list() { return ok({ items: [{ workspaceId: 'workspace-1', path: root }] }) } },
      sessions: { async create() { return ok({ sessionId: owner.id }) }, async rename() { return ok({}) } },
    }
    const runner = async call => call.args[0] === 'system'
      ? capabilities
      : call.args[0] === 'runs' && call.args[1] === 'get'
        ? { lifecycle_status: 'running', phase: 'STEP_05', report_available: false, analysis: { completed: 4 } }
        : { run_id: 'skill-run-acp', request_path: '/runtime/request.md', run_root: '/runtime/run' }
    await launchAnalysisSession(api, {
      cwd: root, input: { repository: 'repo-one', target: 'ACP cancellation', source_scope: [], provider_id: 'pangea-nga' },
    }, runner, async () => {}, async () => {}, runtime)
    await turnStarted
    jobHooks.cancel('test cancellation')
    releaseTurn()
    assert.deepEqual(await jobHooks.done, { status: 'killed' })
    assert.equal(continued, 1)
    assert.equal(disposed, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('blocks ACP start when the durable lifecycle says the attempt is stopping', async () => {
  const root = await workspace()
  try {
    let providerStarted = false
    let jobHooks
    const api = {
      workspace: { async list() { return ok({ items: [{ workspaceId: 'workspace-1', path: root }] }) } },
      sessions: {
        async create() { return ok({ sessionId: 'owner-session' }) },
        async rename() { return ok({}) },
      },
    }
    const owner = { id: 'owner-session' }
    const runtime = {
      agents: { get(id) { return id === owner.id ? owner : undefined } },
      subagents: {
        getProvider(id) { return id === 'pangea-nga' ? {} : undefined },
        async start() {
          providerStarted = true
          return { id: 'agent-session', result: Promise.resolve({ stopReason: 'completed', output: [] }), dispose: async () => {} }
        },
      },
      jobs: {
        start(spec) { jobHooks = spec.run(); void jobHooks.done; return 'subagent-1' },
        get() { return { startedAt: 1234, status: 'running' } },
      },
    }
    const runner = async call => call.args[0] === 'system'
      ? capabilities
      : { run_id: 'skill-run-stopping', request_path: '/runtime/request.md', run_root: '/runtime/run' }
    await assert.rejects(
      launchAnalysisSession(api, {
        cwd: root,
        input: { repository: 'repo-one', target: 'ACP stopping', source_scope: [], provider_id: 'pangea-nga' },
      }, runner, async () => {}, async () => {}, runtime, process.env, {
        onJobCreated() {
          const error = new Error('PANGEA 分析已请求停止')
          error.code = 'PANGEA_STOP_REQUESTED'
          throw error
        },
      }),
      /PANGEA 分析已请求停止/,
    )
    assert.deepEqual(await jobHooks.done, { status: 'killed' })
    assert.equal(providerStarted, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('disposes a started ACP session when durable runtime binding fails', async () => {
  const root = await workspace()
  try {
    let jobHooks
    let disposed = false
    const api = {
      workspace: { async list() { return ok({ items: [{ workspaceId: 'workspace-1', path: root }] }) } },
      sessions: {
        async create() { return ok({ sessionId: 'owner-session' }) },
        async rename() { return ok({}) },
      },
    }
    const owner = { id: 'owner-session' }
    const runtime = {
      agents: { get(id) { return id === owner.id ? owner : undefined } },
      subagents: {
        getProvider(id) { return id === 'pangea-nga' ? {} : undefined },
        async start() {
          return { id: 'agent-session', result: Promise.resolve({ stopReason: 'completed', output: [] }), dispose: async () => { disposed = true } }
        },
      },
      jobs: {
        start(spec) { jobHooks = spec.run(); return 'subagent-1' },
        get() { return { startedAt: 1234, status: 'running' } },
      },
    }
    const runner = async call => call.args[0] === 'system'
      ? capabilities
      : { run_id: 'skill-run-acp', request_path: '/runtime/request.md', run_root: '/runtime/run' }
    const result = await launchAnalysisSession(api, {
      cwd: root,
      input: { repository: 'repo-one', target: 'ACP callback failure', source_scope: [], provider_id: 'pangea-nga' },
    }, runner, async () => {}, async () => {}, runtime, process.env, {
      onAgentStarted: async () => { throw new Error('task binding failed') },
    })
    assert.equal(result.job_id, 'subagent-1')
    const settled = await jobHooks.done
    assert.deepEqual(settled, { status: 'failed', detail: 'task binding failed' })
    assert.equal(disposed, true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('reports an ACP provider start failure as failed instead of user cancellation', async () => {
  const root = await workspace()
  try {
    let jobHooks
    const launchEvents = []
    const owner = { id: 'owner-session' }
    const runtime = {
      agents: { get(id) { return id === owner.id ? owner : undefined } },
      subagents: {
        getProvider() { return {} },
        async start() {
          const error = new Error('spawn EINVAL')
          Object.assign(error, {
            code: 'EINVAL', errno: -4071, syscall: 'spawn', launchStage: 'spawn_process',
            configuredCommand: 'nga', resolvedCommand: 'C:\\Users\\测试 User\\nga.cmd',
            launcherKind: 'windows-batch', launcherCommand: 'C:\\Windows\\System32\\cmd.exe', cwd: root,
          })
          throw error
        },
      },
      jobs: {
        start(spec) { jobHooks = spec.run(); return 'subagent-1' },
        get() { return { startedAt: 1234, status: 'running' } },
      },
    }
    const api = {
      workspace: { async list() { return ok({ items: [{ workspaceId: 'workspace-1', path: root }] }) } },
      sessions: {
        async create() { return ok({ sessionId: owner.id }) },
        async rename() { return ok({}) },
      },
    }
    const runner = async call => call.args[0] === 'system'
      ? capabilities
      : { run_id: 'skill-run-acp', request_path: '/runtime/request.md', run_root: '/runtime/run' }
    await launchAnalysisSession(api, {
      cwd: root,
      input: { repository: 'repo-one', target: 'ACP provider failure', source_scope: [], provider_id: 'pangea-nga' },
    }, runner, async () => {}, event => { launchEvents.push(event) }, runtime)
    assert.deepEqual(await jobHooks.done, { status: 'failed', detail: 'spawn EINVAL' })
    assert.deepEqual(
      launchEvents.find(event => event.stage === 'acp_process_spawn' && event.status === 'error'),
      {
        stage: 'acp_process_spawn', status: 'error', provider: 'pangea-nga',
        error: launchEvents.find(event => event.stage === 'acp_process_spawn' && event.status === 'error').error,
        launch_stage: 'spawn_process', configured_command: 'nga',
        resolved_command: 'C:\\Users\\测试 User\\nga.cmd', launcher_kind: 'windows-batch',
        launcher_command: 'C:\\Windows\\System32\\cmd.exe', cwd: root,
        error_code: 'EINVAL', syscall: 'spawn', errno: -4071,
      },
    )
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('does not release ACP when the real Job snapshot identity is unavailable', async () => {
  const root = await workspace()
  try {
    let providerStarted = false
    let jobHooks
    const owner = { id: 'owner-session' }
    const runtime = {
      agents: { get(id) { return id === owner.id ? owner : undefined } },
      subagents: {
        getProvider() { return {} },
        async start() { providerStarted = true; throw new Error('must not start') },
      },
      jobs: {
        start(spec) { jobHooks = spec.run(); return 'subagent-1' },
        get() { return null },
      },
    }
    const api = {
      workspace: { async list() { return ok({ items: [{ workspaceId: 'workspace-1', path: root }] }) } },
      sessions: {
        async create() { return ok({ sessionId: owner.id }) },
        async rename() { return ok({}) },
      },
    }
    const runner = async call => call.args[0] === 'system'
      ? capabilities
      : { run_id: 'skill-run-acp', request_path: '/runtime/request.md', run_root: '/runtime/run' }
    await assert.rejects(launchAnalysisSession(api, {
      cwd: root,
      input: { repository: 'repo-one', target: 'Missing Job identity', source_scope: [], provider_id: 'pangea-nga' },
    }, runner, async () => {}, async () => {}, runtime), /Job snapshot.*startedAt/)
    assert.deepEqual(await jobHooks.done, { status: 'failed', detail: 'ACP Job snapshot 缺少 startedAt：subagent-1' })
    assert.equal(providerStarted, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('does not silently fall back to the internal model when an ACP runtime is missing', async () => {
  const root = await workspace()
  try {
    await assert.rejects(
      launchAnalysisSession({ sessions: {} }, {
        cwd: root,
        input: { repository: 'repo-one', target: 'ACP missing', source_scope: [], provider_id: 'pangea-opencode' },
      }, async call => call.args[0] === 'system' ? capabilities : { run_id: 'unused' }),
      /外部执行 Agent 需要 DSH ACP runtime：pangea-opencode/,
    )
  } finally { await rm(root, { recursive: true, force: true }) }
})
