import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { acpProviderOption, acpProviderOptions, createTaskConversation, homeSnapshot, internalModelOptions, launchAnalysisSession, normalizeRunInput, requireInternalModel, resumeAnalysisRun, stopAnalysisRun, workbenchSnapshot } from '../src/workbench-api.js'

const catalogProvider = { async discoverModels() { return { current_model: 'native/default', models: [{ id: 'native/default' }, { id: 'native/selected' }] } } }

const capabilities = { repositories: ['repo-one'], analysis_skill: { skill_id: 'codetalks-skill', version: '1.4.9' } }

for (const cleanupFails of [false, true]) test(`managed depth job preserves sessions and reports cleanup failure=${cleanupFails}`, async () => {
  const root = await workspace()
  try {
    const runRoot = path.join(root, 'run'), decisionFile = path.join(runRoot, '内部索引', '独立审查状态.json')
    await mkdir(path.dirname(decisionFile), { recursive: true })
    let hooks, producerTurns = 0, reviewerTurns = 0, starts = 0, disposed = 0
    const records = [], owner = { id: 'owner' }
    const answerReview = async prompt => {
      if (prompt.includes('本轮先准备执行证据')) return { stopReason: 'completed', output: [] }
      reviewerTurns++
      const requestId = /review_request_id: ([\w-]+)/.exec(prompt)[1]
      await writeFile(decisionFile, JSON.stringify({ run_id: 'run', review_request_id: requestId,
        review_action: reviewerTurns === 1 ? 'revise' : 'accept', semantic_verdict: 'PASS', summary: 'reviewed' }))
      return { stopReason: 'completed', output: [] }
    }
    const runtime = { agents: { get: () => owner },
      jobs: { start(spec) { hooks = spec.run(); return 'job' }, get: () => ({ startedAt: 10 }) },
      subagents: { getProvider: () => catalogProvider, async start(provider, request) {
        starts++
        if (starts === 1) {
          assert.match(request.prompt[0].text, /完成阶段 03 后/)
          return { id: 'producer', result: Promise.resolve({ stopReason: 'completed' }),
            async continuePrompt(p) { producerTurns++; assert.match(p[0].text, producerTurns === 1 ? /定向修订/ : /正式交付/); return { stopReason: 'completed' } },
            async dispose() { disposed++ } }
        }
        return { id: 'reviewer', result: answerReview(request.prompt[0].text), continuePrompt: p => answerReview(p[0].text), async dispose() { disposed++; if (cleanupFails) throw new Error('review cleanup failed') } }
      } },
    }
    const api = { workspace: { list: async () => ok({ items: [{ workspaceId: 'w', path: root }] }) }, sessions: { create: async () => ok({ sessionId: 'owner' }), rename: async () => ok({}) } }
    const runner = async ({ args, signal }) => args[0] === 'system' ? capabilities : args[1] === 'verify-cases'
      ? (assert.ok(signal), { status: 'recorded', receipt_path: 'receipt.json', cases: [{ case_id: 'TC-1', status: 'executed', exit_code: 1 }] }) : args[1] === 'get'
      ? { run_id: 'run', completed_steps: producerTurns >= 2 ? ['01','02','03','04','05'] : ['01','02','03'], lifecycle_status: producerTurns >= 2 ? 'complete' : 'running', report_available: producerTurns >= 2 }
      : { run_id: 'run', run_root: runRoot, request_path: path.join(root, 'request.md') }
    await launchAnalysisSession(api, { cwd: root, input: { repository: 'repo-one', target: 'depth', mode: 'depth', provider_id: 'pangea-opencode' } }, runner,
      async () => {}, async () => {}, runtime, process.env, { reviewBinding: { task_id: 'task', attempt_id: 'attempt' }, onReviewState: async value => records.push(value) })
    if (cleanupFails) await assert.rejects(hooks.done, /任务进程清理未完成/); else assert.equal((await hooks.done).status, 'completed')
    assert.equal(starts, 2)
    assert.equal(producerTurns, 2)
    assert.equal(reviewerTurns, 3)
    assert.equal(disposed, 2)
    assert.equal(records.at(-1).status, 'complete')
  } finally { await rm(root, { recursive: true, force: true }) }
})
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

function internalModelApi(events = [], overrides = {}) {
  const providers = overrides.providers ?? [
    { provider: 'minimax-1', displayName: 'MiniMax', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'minimax-1'], active: true, declared: true },
    { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [], active: true, declared: true },
  ]
  const groups = overrides.groups ?? [
    { id: 'minimax-1', name: 'MiniMax', models: [{ id: 'MiniMax-M2.7-highspeed', name: 'M2.7 highspeed' }] },
    { id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash', name: 'V4 Flash' }] },
  ]
  const namespaces = overrides.namespaces ?? [{ ns: 'llm-pi-ai', value: { providers: { 'minimax-1': { apiKeyEnv: 'MINIMAX_1_API_KEY' } } } }]
  const credentials = overrides.credentials ?? { MINIMAX_1_API_KEY: { configured: true, writable: true } }
  return {
    llm: {
      async providers() { return ok({ providers }) },
      async models() { return ok({ groups, failures: [] }) },
    },
    settings: { async describe() { return ok({ namespaces }) } },
    credentials: { async describe() { return ok({ credentials }) } },
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

test('starts independent model catalog RPCs together instead of waiting for each response', async () => {
  const started = [], pending = new Map()
  const request = (name, value) => { started.push(name); return new Promise(resolve => pending.set(name, () => resolve(ok(value)))) }
  const catalog = internalModelOptions({
    llm: { providers: () => request('providers', { providers: [] }), models: () => request('models', { groups: [], failures: [] }) },
    settings: { describe: () => request('settings', { namespaces: [] }) },
  })
  try { assert.deepEqual(started, ['providers', 'models', 'settings']) }
  finally { for (const release of pending.values()) release() }
  assert.deepEqual(await catalog, { models: [], failures: [] })
})

async function homeRunFixture(root, runId, progress, files = {}) {
  const directory = path.join(root, 'pangea-data', 'runs', runId)
  await mkdir(directory, { recursive: true })
  if (progress !== null) await writeFile(path.join(directory, 'progress.json'), typeof progress === 'string' ? progress : JSON.stringify(progress))
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(directory, name)), { recursive: true })
    await writeFile(path.join(directory, name), contents)
  }
  return directory
}

function homeTaskFixture(root, runId, overrides = {}) {
  return { task_id: `task-${runId}`, workspace: root, data_root: path.join(root, 'pangea-data'), run_id: runId,
    title: runId, status: 'running', execution_status: null, conversations: [{ conversation_id: 'conversation', session_id: 'session' }],
    active_conversation_id: 'conversation', ...overrides }
}

test('home reads only lifecycle metadata and reports without Python, assets or result projections', async () => {
  const root = await workspace()
  try {
    await mkdir(path.join(root, 'pangea-data', 'repositories', 'repo'), { recursive: true })
    await mkdir(path.join(root, 'pangea-data', 'repositories', '.pangea-import-pending'), { recursive: true })
    const directory = await homeRunFixture(root, 'run-z', { workflow_version: 'source-first-v1', run_id: 'run-z', lifecycle_status: 'complete', quality_status: 'PASS' }, {
      'report.md': 'delivered', 'report.html': 'delivered', 'report-complete.json': '{}',
      'inputs/task-contract.json': '{broken and deliberately irrelevant', 'results/records.json': '{broken',
    })
    const tasks = [homeTaskFixture(root, 'run-z', { attempts: [{ last_output: 'large output' }], last_output: 'large output' })]
    const before = JSON.stringify(tasks)
    const snapshot = await homeSnapshot({ cwd: root, tasks })
    assert.deepEqual(snapshot.compatibility, { compatible: null, api_version: null, checked: false, source: 'local-metadata' })
    assert.deepEqual(snapshot.capabilities.repositories, ['repo'])
    assert.equal(snapshot.runs.items[0].report_available, true)
    assert.equal(snapshot.tasks.items[0].status, 'completed')
    assert.deepEqual(snapshot.tasks.items[0].conversations, tasks[0].conversations)
    assert.equal(Object.hasOwn(snapshot.tasks.items[0], 'attempts'), false)
    assert.equal(Object.hasOwn(snapshot.tasks.items[0], 'last_output'), false)
    assert.equal(JSON.stringify(tasks), before)
    assert.equal(await readFile(path.join(directory, 'inputs', 'task-contract.json'), 'utf8'), '{broken and deliberately irrelevant')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('home refreshes bound tasks outside the report page and preserves runtime stop and active provider precedence', async () => {
  const root = await workspace()
  try {
    for (const [runId, lifecycle] of [['run-z', 'running'], ['run-a', 'complete']]) {
      await homeRunFixture(root, runId, { workflow_version: 'source-first-v1', run_id: runId, lifecycle_status: lifecycle },
        lifecycle === 'complete' ? { 'report.md': 'delivered', 'report.html': 'delivered', 'report-complete.json': '{}' } : {})
    }
    const tasks = [homeTaskFixture(root, 'run-a'),
      homeTaskFixture(root, 'run-a', { task_id: 'active-acp', provider: 'pangea-nga', execution_status: 'running' }),
      homeTaskFixture(root, 'run-a', { task_id: 'lost-acp', provider: 'pangea-nga', execution_status: 'running', runtime_issue: '原执行身份无法确认' }),
      homeTaskFixture(root, 'run-z', { task_id: 'stopped', execution_status: 'stopped', status: 'stopped' }),
      homeTaskFixture(root, 'run-z', { task_id: 'launch-failed', status: 'failed', launch_error_code: 'LAUNCH_FAILED' }),
      homeTaskFixture(root, 'run-a', { task_id: 'different-root', data_root: path.join(root, 'other-data') }),
      homeTaskFixture(root, 'run-a', { task_id: 'different-workspace', workspace: path.dirname(root) })]
    const snapshot = await homeSnapshot({ cwd: root, tasks, limit: 1 })
    assert.deepEqual(snapshot.runs.items.map(item => item.run_id), ['run-z'])
    assert.equal(snapshot.runs.next_cursor, 1)
    assert.equal(snapshot.runs.total, 2)
    assert.deepEqual(snapshot.tasks.items.map(item => [item.task_id, item.status]), [
      ['task-run-a', 'completed'], ['active-acp', 'running'], ['lost-acp', 'needs_attention'], ['stopped', 'stopped'], ['launch-failed', 'failed'], ['different-root', 'running'],
    ])
    assert.equal(snapshot.tasks.items.length, 6)
    assert.equal(snapshot.tasks.items[2].execution_status, 'interrupted')
    assert.equal(snapshot.tasks.items[2].needs_user_reason, '原执行身份无法确认')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('home requires formal delivery after a worker completes and projects terminal states without double counting active tasks', async () => {
  const root = await workspace()
  try {
    const delivered = { 'report.md': 'delivered', 'report.html': 'delivered', 'report-complete.json': '{}' }
    for (const [runId, lifecycle, files] of [['running', 'running', {}], ['missing-report', 'complete', {}],
      ['delivered', 'complete', delivered], ['failed', 'failed', {}], ['stopped', 'stopped', {}]]) {
      await homeRunFixture(root, runId, { run_id: runId, workflow_version: 'source-first-v1', lifecycle_status: lifecycle }, files)
    }
    const tasks = [
      homeTaskFixture(root, 'running', { task_id: 'worker-ended', provider: 'pangea-nga', status: 'needs_attention', execution_status: 'completed' }),
      homeTaskFixture(root, 'missing-report', { provider: 'pangea-nga', execution_status: 'completed' }),
      homeTaskFixture(root, 'delivered', { provider: 'pangea-nga', status: 'needs_attention', execution_status: 'completed' }),
      homeTaskFixture(root, 'delivered', { task_id: 'native-ended', execution_status: 'running' }),
      homeTaskFixture(root, 'failed', { execution_status: 'running' }),
      homeTaskFixture(root, 'stopped', { execution_status: 'stopping' }),
      homeTaskFixture(root, 'delivered', { task_id: 'review-pending', execution_status: 'running', host_review: { status: 'running', reviewer_session_id: 'reviewer' } }),
    ]
    const unchanged = JSON.stringify(tasks)
    const snapshot = await homeSnapshot({ cwd: root, tasks })
    assert.deepEqual(snapshot.tasks.items.map(task => [task.task_id, task.status, task.execution_status]), [
      ['worker-ended', 'needs_attention', 'completed'], ['task-missing-report', 'needs_attention', 'completed'],
      ['task-delivered', 'completed', 'completed'], ['native-ended', 'completed', 'completed'],
      ['task-failed', 'failed', 'failed'], ['task-stopped', 'stopped', 'stopped'], ['review-pending', 'running', 'running'],
    ])
    assert.equal(JSON.stringify(tasks), unchanged)
    assert.equal(snapshot.tasks.items.filter(task => task.status === 'completed' && ['starting', 'running', 'stopping'].includes(task.execution_status)).length, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('home shows corrupt, missing and unsupported run metadata as unreadable instead of completed', async () => {
  const root = await workspace()
  try {
    await homeRunFixture(root, 'broken', '{')
    await homeRunFixture(root, 'wrong-id', { run_id: 'other', workflow_version: 'source-first-v1', lifecycle_status: 'complete' })
    await homeRunFixture(root, 'unsupported', { workflow_version: 'future-v9', lifecycle_status: 'complete' })
    await homeRunFixture(root, 'empty', {})
    const tasks = ['broken', 'wrong-id', 'unsupported', 'empty', 'missing', '../escape'].map(id => homeTaskFixture(root, id, { status: 'completed' }))
    tasks.push(homeTaskFixture(root, 'broken', { task_id: 'stopped', status: 'stopped', execution_status: 'stopped' }))
    const snapshot = await homeSnapshot({ cwd: root, tasks })
    assert.ok(snapshot.runs.items.every(run => run.lifecycle_status === 'unknown' && run.reader_error && !run.report_available))
    assert.ok(snapshot.tasks.items.slice(0, 6).every(task => task.status === 'needs_attention' && task.reader_error))
    assert.equal(snapshot.tasks.items.at(-1).status, 'stopped')
    assert.match(snapshot.tasks.items.at(-1).reader_error, /JSON/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('home keeps needs-user and unresolved quality visible and requires all report files', async () => {
  const root = await workspace()
  try {
    await homeRunFixture(root, 'needs-user', { workflow_version: 'source-first-v1', run_id: 'needs-user', lifecycle_status: 'running', needs_user: true, blocking_reason: '等待用户授权' })
    await homeRunFixture(root, 'unresolved', { workflow_version: 'source-first-v1', run_id: 'unresolved', lifecycle_status: 'complete', quality_status: 'UNRESOLVED' }, { 'report.md': 'partial', 'report-complete.json': '{}' })
    const snapshot = await homeSnapshot({ cwd: root, tasks: ['needs-user', 'unresolved'].map(id => homeTaskFixture(root, id)) })
    assert.ok(snapshot.tasks.items.every(task => task.status === 'needs_attention'))
    assert.equal(snapshot.tasks.items[0].needs_user_reason, '等待用户授权')
    assert.equal(snapshot.runs.items.find(run => run.run_id === 'unresolved').report_available, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('home reads legacy skill lifecycle and formal report without parsing document contents', async () => {
  const root = await workspace()
  try {
    const metadataDirectory = path.join(root, 'pangea-data', '.pangea', 'skill-runs', 'legacy')
    await mkdir(metadataDirectory, { recursive: true })
    await writeFile(path.join(metadataDirectory, 'metadata.json'), JSON.stringify({ run_id: 'legacy' }))
    await homeRunFixture(root, 'legacy', null, { '内部索引/运行状态.json': JSON.stringify({ status: 'complete', verdict: 'PASS' }),
      '正式输出/完整分析报告.md': 'legacy delivered', '内部索引/工作台投影.json': '{irrelevant' })
    const snapshot = await homeSnapshot({ cwd: root, tasks: [homeTaskFixture(root, 'legacy')] })
    assert.equal(snapshot.runs.items[0].workflow_version, 'legacy-v1')
    assert.equal(snapshot.runs.items[0].report_available, true)
    assert.equal(snapshot.tasks.items[0].status, 'completed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('routes a configured native OpenAI model and rejects inactive, model-less, or uncredentialed routes', async () => {
  const missingCredentialRef = 'PANGEA_TEST_MISSING_MODEL_KEY_20260927'
  const api = internalModelApi([], {
    providers: [
      { provider: 'openai', displayName: 'OpenAI', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'], active: true, declared: false },
      { provider: 'inactive-native', displayName: 'Inactive', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'inactive-native'], active: false, declared: false },
      { provider: 'model-less-native', displayName: 'No models', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'model-less-native'], active: true, declared: false },
      { provider: 'missing-key-native', displayName: 'Missing key', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'missing-key-native'], active: true, declared: false },
    ],
    groups: [
      { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-4.1-mini', name: 'GPT-4.1 mini' }] },
      { id: 'inactive-native', name: 'Inactive', models: [{ id: 'inactive-model', name: 'Inactive model' }] },
      { id: 'model-less-native', name: 'No models', models: [] },
      { id: 'missing-key-native', name: 'Missing key', models: [{ id: 'missing-key-model', name: 'Missing key model' }] },
    ],
    namespaces: [{ ns: 'llm-pi-ai', value: { providers: {
      openai: { apiKeyEnv: 'PANGEA_TEST_OPENAI_KEY_20260927' },
      'inactive-native': { apiKeyEnv: 'PANGEA_TEST_INACTIVE_KEY_20260927' },
      'model-less-native': { apiKeyEnv: 'PANGEA_TEST_MODELLESS_KEY_20260927' },
      'missing-key-native': { apiKeyEnv: missingCredentialRef },
    } } }],
    credentials: {
      PANGEA_TEST_OPENAI_KEY_20260927: { configured: true, writable: true },
      PANGEA_TEST_INACTIVE_KEY_20260927: { configured: true, writable: true },
      PANGEA_TEST_MODELLESS_KEY_20260927: { configured: true, writable: true },
      [missingCredentialRef]: { configured: false, writable: true },
    },
  })

  const catalog = await internalModelOptions(api)
  assert.deepEqual(catalog.models.map(item => `${item.provider}/${item.model}`), [
    'openai/gpt-4.1-mini',
    'missing-key-native/missing-key-model',
  ])
  assert.equal(catalog.models[0].credential_configured, true)
  assert.equal(catalog.models[1].credential_configured, false)
  assert.deepEqual(await requireInternalModel(api, { provider: 'openai', model: 'gpt-4.1-mini' }), {
    provider: 'openai', model: 'gpt-4.1-mini', route_class: 'configured-internal',
  })
  await assert.rejects(requireInternalModel(api, { provider: 'missing-key-native', model: 'missing-key-model' }), /尚未配置凭证/)
})

test('advertises supported ACP routes and ignores saved Claude Code configuration', () => {
  assert.deepEqual(acpProviderOptions({}).map(item => item.id), [
    'pangea-nga', 'pangea-codeagent', 'pangea-opencode',
  ])
  const configured = acpProviderOptions({ PANGEA_ACP_RUNTIME_CONFIG: JSON.stringify({
    version: 1, providers: {
      'pangea-opencode': { command: 'opencode-custom', args: ['acp'], models: [] },
      'pangea-claude-code': { command: 'claude', args: [] },
    },
  }) })
  assert.deepEqual(configured[2].command, 'opencode-custom')
  assert.equal(configured.some(provider => provider.id === 'pangea-claude-code'), false)
  assert.deepEqual(configured[0].args, ['acp', '--skip-safe-check'])
  assert.deepEqual(configured[1].args, ['acp', '--skip-safe-check'])
  assert.deepEqual(configured[2].args, ['acp'])
  assert.throws(() => acpProviderOption('pangea-claude-code'), /Claude Code 支持已移除.*历史任务和结果仍保留/)
})

test('rejects a retired Claude Code run before creating or resuming analysis and before creating a session', async () => {
  const root = await workspace()
  try {
    for (const resumeRunId of [undefined, 'saved-claude-run']) {
      const commands = []
      await assert.rejects(launchAnalysisSession({}, {
        cwd: root, resumeRunId, input: { repository: 'repo-one', target: '旧任务', provider_id: 'pangea-claude-code' },
      }, async ({ args }) => {
        commands.push(args)
        if (args[0] === 'system' && args[1] === 'capabilities') return capabilities
        assert.fail('retired provider must not create or resume a Run')
      }, undefined, undefined, { subagents: { getProvider() { assert.fail('must not load retired provider') } } }, {}), /Claude Code 支持已移除/)
      assert.equal(commands.length, 1)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
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

for (const scenario of ['risk-analysis', 'branch-analysis', 'coverage-analysis', 'module-analysis']) {
  for (const resumeRunId of [undefined, 'saved-run']) test(`rejects internal API ${scenario} ${resumeRunId ? 'resume' : 'creation'} before changing a Run`, async () => {
    const root = await workspace()
    try {
      await assert.rejects(launchAnalysisSession({}, {
        cwd: root, input: { repository: 'repo-one', target: 'session', source_scope: ['src/session.c'], scenario },
        model: { provider: 'minimax-1', model: 'MiniMax-M2.7-highspeed' }, resumeRunId,
      }, async ({ args }) => { assert.equal(args[0], 'system'); return capabilities }), /内部 API 分析支持已移除/)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
}

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
  assert.throws(() => normalizeRunInput({ repository: 'repo-one', target: 'x', source_scope: ['x.c'] }, { repositories: ['repo-one'] }), /codetalks-skill 1\.4\.9/)
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

for (const agentModel of [null, 'native/selected']) test(`starts an ACP provider with ${agentModel ?? 'default'} model configuration`, async () => {
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
        getProvider(id) { return id === 'pangea-nga' ? catalogProvider : undefined },
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
    const runner = async call => {
      if (call.args[0] === 'system') return capabilities
      assert.equal(JSON.stringify(call).includes('agent_model'), false)
      return { run_id: 'skill-run-acp', request_path: '/runtime/request.md', run_root: '/runtime/run' }
    }
    const result = await launchAnalysisSession(api, {
      cwd: root,
      input: { repository: 'repo-one', target: 'ACP', source_scope: [], provider_id: 'pangea-nga', scenario: 'root-cause', mode: 'speed', agent_model: agentModel },
    }, runner, async () => {}, async () => {}, runtime, { PANGEA_ACP_RUNTIME_CONFIG: JSON.stringify(acpRuntimeConfig) })
    assert.equal(result.job_id, 'subagent-1')
    assert.equal(result.provider, 'pangea-nga')
    assert.equal(providerStarted, true)
    assert.deepEqual(providerRequest.agentOptions, { model: agentModel || 'native/default' })
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
        getProvider(id) { return id === 'pangea-nga' ? catalogProvider : undefined },
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
        getProvider() { return catalogProvider },
        async start() {
          return {
            id: 'agent-session',
            result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'Step 05 response ended' }] }),
            async continuePrompt(prompt) {
              continued += 1
              assert.match(prompt[0].text, /运行状态\.json/)
              assert.match(prompt[0].text, /已完成步骤：4\/5/)
              return { stopReason: 'completed', output: [{ type: 'text', text: 'Step 05 complete' }] }
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
          ? { run_id: 'skill-run-acp', lifecycle_status: 'running', phase: 'STEP_05', report_available: false, workflow: { steps: ['01', '02', '03', '04', '05'] }, completed_steps: ['01', '02', '03', '04'] }
          : { run_id: 'skill-run-acp', lifecycle_status: 'complete', phase: 'COMPLETE', report_available: true, completed_steps: ['01', '02', '03', '04', '05'] }
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

test('continues within one long module phase while flow progress advances', async () => {
  const root = await workspace()
  try {
    let jobHooks
    let continued = 0
    let inspected = 0
    const owner = { id: 'owner-session' }
    const runtime = {
      agents: { get() { return owner } },
      subagents: {
        getProvider() { return catalogProvider },
        async start() {
          return {
            id: 'agent-session',
            result: Promise.resolve({ stopReason: 'completed', output: [] }),
            async continuePrompt(prompt) {
              continued += 1
              assert.match(prompt[0].text, /已完成步骤：2\/5/)
              return { stopReason: 'completed', output: [] }
            },
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
    const runner = async call => {
      if (call.args[0] === 'system') return capabilities
      if (call.args[0] === 'runs' && call.args[1] === 'get') {
        inspected += 1
        if (inspected === 5) return { lifecycle_status: 'complete', report_available: true }
        return {
          lifecycle_status: 'running', phase: 'STEP_03', report_available: false,
          workflow: { steps: ['01', '02', '03', '04', '05'] }, completed_steps: ['01', '02'],
          publication: { revision: 1 }, step_progress: { completed: inspected, total: 4, current: { id: `FLOW-${inspected}` } },
        }
      }
      return { run_id: 'skill-run-acp', request_path: '/runtime/request.md', run_root: '/runtime/run' }
    }
    await launchAnalysisSession(api, {
      cwd: root, input: { repository: 'repo-one', target: 'Long module phase', source_scope: [], provider_id: 'pangea-nga' },
    }, runner, async () => {}, async () => {}, runtime)
    assert.equal((await jobHooks.done).status, 'completed')
    assert.equal(continued, 4)
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
        getProvider() { return catalogProvider },
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
        getProvider() { return catalogProvider },
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
        getProvider(id) { return id === 'pangea-nga' ? catalogProvider : undefined },
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
        getProvider(id) { return id === 'pangea-nga' ? catalogProvider : undefined },
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
        getProvider() { return catalogProvider },
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
        getProvider() { return catalogProvider },
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

test('source-first selections reject unsupported settings before task creation', () => {
  const capabilities = { workflow_versions: ['source-first-v1'], source_first: { version: 'source-first-v1' }, repositories: ['repo'] }
  const input = { repository: 'repo', target: 'sample', source_scope: ['sample.c'] }
  assert.equal(normalizeRunInput(input, capabilities).mode, 'depth')
  for (const selection of [{ mode: 'speed' }, { scenario: 'coverage-analysis' }, { coverage_input: { kind: 'file', path: 'coverage.json' } }]) {
    assert.throws(() => normalizeRunInput({ ...input, ...selection }, capabilities), /不支持/)
  }
})

test('workbench reads historical Markdown reports through the legacy reader', async () => {
  const root = await workspace()
  try {
    const runId = 'legacy-report', run = path.join(root, 'runs', runId)
    await mkdir(path.join(run, '内部索引'), { recursive: true })
    await mkdir(path.join(run, '正式输出'), { recursive: true })
    await writeFile(path.join(run, '内部索引/运行状态.json'), JSON.stringify({ status: 'complete', completed_steps: ['01','02','03','04','05','06','07','08','09'], publication: { state: 'final', revision: 1, step_id: '09' } }))
    await writeFile(path.join(run, '内部索引/工作台投影.json'), JSON.stringify({ schema_version: '1.0', run_id: runId, business_flows: [], risks: [], test_cases: [], evidence: [], review_issues: [] }))
    await writeFile(path.join(run, '正式输出/完整分析报告.md'), '# Historical report')
    await mkdir(path.join(root, '.pangea/skill-runs', runId), { recursive: true })
    await writeFile(path.join(root, '.pangea/skill-runs', runId, 'metadata.json'), JSON.stringify({ run_id: runId }))
    const cliRun = { run_id: runId, lifecycle_status: 'failed', phase: 'UNKNOWN', report_available: false }
    const result = await workbenchSnapshot({ cwd: root, dataRoot: root, runId, runner: async ({ args }) => args[0] === 'system' ? capabilities : args[1] === 'list' ? { items: [cliRun], total: 1 } : cliRun })
    assert.equal(result.status, 'ok')
    assert.equal(result.compatibility.compatible, true, result.compatibility.error)
    for (const item of [result.runs.items[0], result.run]) {
      assert.equal(item.lifecycle_status, 'complete')
      assert.equal(item.report_available, true)
      assert.equal(item.reports.markdown, path.join(run, '正式输出/完整分析报告.md'))
      assert.equal(item.reports.html, null)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('one damaged historical Run does not hide other workbench Runs or capabilities', async () => {
  const root = await workspace()
  try {
    const broken = path.join(root, 'runs/broken/内部索引')
    await mkdir(broken, { recursive: true })
    await writeFile(path.join(broken, '运行状态.json'), '{invalid')
    const good = { run_id: 'good', lifecycle_status: 'complete', report_available: true }
    const bad = { run_id: 'broken', lifecycle_status: 'complete', report_available: true }
    const result = await workbenchSnapshot({ cwd: root, dataRoot: root, runId: 'broken', runner: async ({ args }) => args[0] === 'system' ? capabilities : args[1] === 'list' ? { items: [good, bad], total: 2 } : bad })
    assert.equal(result.compatibility.compatible, true)
    assert.deepEqual(result.capabilities, capabilities)
    assert.deepEqual(result.runs.items[0], good)
    assert.equal(result.runs.items[1].lifecycle_status, 'unknown')
    assert.equal(result.runs.items[1].report_available, false)
    assert.ok(result.runs.items[1].reader_error)
    assert.equal(result.run, null)
    assert.equal(result.run_detail.run_id, 'broken')
    assert.equal(result.run_detail.status, 'error')
  } finally { await rm(root, { recursive: true, force: true }) }
})
