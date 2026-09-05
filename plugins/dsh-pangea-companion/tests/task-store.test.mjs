import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createTaskStore } from '../src/task-store.js'

test('persists a Task before any DSH session or Run exists', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-tasks-'))
  const storePath = path.join(root, 'tasks-v1.json')
  try {
    const store = createTaskStore({ storePath, now: () => 1000, idFactory: () => 'task-001' })
    const task = await store.create({
      workspace: '/workspace', dataRoot: '/workspace/pangea-data',
      input: {
        repository: 'repo-one', target: '认证恢复', source_scope: ['src/auth.c'],
        scenario: 'root-cause', mode: 'speed',
        model_route: { provider: 'minimax-1', model: 'MiniMax-M2.7-highspeed' },
      },
    })
    assert.equal(task.task_id, 'task-001')
    assert.equal(task.status, 'preparing')
    assert.equal(task.run_id, null)
    assert.equal(task.scenario, 'root-cause')
    assert.equal(task.mode, 'speed')
    assert.deepEqual(task.conversations, [])
    assert.deepEqual(task.model_route, {
      provider: 'minimax-1', model: 'MiniMax-M2.7-highspeed', route_class: 'configured-internal',
    })
    const stored = JSON.parse(await readFile(storePath, 'utf8'))
    assert.equal(stored.tasks['task-001'].target, '认证恢复')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('binds multiple conversations to one Task and later associates its Run', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-task-conversations-'))
  const storePath = path.join(root, 'tasks-v1.json')
  let now = 1000
  try {
    const store = createTaskStore({ storePath, now: () => ++now, idFactory: () => 'task-002' })
    await store.create({ workspace: '/workspace', input: { repository: 'repo-one', target: '会话恢复' } })
    await store.addConversation('task-002', { sessionId: 'session-analysis', title: '分析会话', kind: 'analysis' })
    const task = await store.addConversation('task-002', { sessionId: 'session-review', title: '证据讨论' })
    assert.deepEqual(task.conversations.map(item => item.session_id), ['session-analysis', 'session-review'])
    assert.equal(task.active_conversation_id, 'session-review')
    const bound = await store.bindRunBySession('session-analysis', { run_id: 'run-17', lifecycle_status: 'running' })
    assert.equal(bound.run_id, 'run-17')
    assert.equal(bound.status, 'running')
    await store.reconcileRuns([{ run_id: 'run-17', lifecycle_status: 'complete', quality_status: 'PASS' }])
    assert.equal((await store.get('task-002')).status, 'completed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('keeps launch failures visible for retry', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-task-failure-'))
  try {
    const store = createTaskStore({ storePath: path.join(root, 'tasks-v1.json'), idFactory: () => 'task-003' })
    await store.create({ workspace: '/workspace', input: { repository: 'repo-one', target: '失败任务' } })
    const failed = await store.markLaunchFailed('task-003', '模型服务不可用')
    assert.equal(failed.status, 'failed')
    assert.equal(failed.launch_error, '模型服务不可用')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('marks an attention-required Run as incomplete instead of running', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-task-attention-'))
  try {
    const store = createTaskStore({ storePath: path.join(root, 'tasks-v1.json'), idFactory: () => 'task-004' })
    await store.create({ workspace: '/workspace', input: { repository: 'repo-one', target: 'Worker 失败' } })
    await store.addConversation('task-004', { sessionId: 'session-attention', title: '分析会话', kind: 'analysis' })
    const task = await store.bindRunBySession('session-attention', {
      run_id: 'run-attention', lifecycle_status: 'attention_required', phase: 'PLANNING',
    })
    assert.equal(task.status, 'needs_attention')
    assert.equal(task.launch_error_code, 'RUN_ATTENTION_REQUIRED')
    assert.match(task.launch_error, /未正常完成/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('looks up a Task by Run and preserves stopped as its own lifecycle state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-task-stopped-'))
  try {
    const store = createTaskStore({ storePath: path.join(root, 'tasks-v1.json'), idFactory: () => 'task-005' })
    await store.create({ workspace: '/workspace', input: { repository: 'repo-one', target: '停止分析' } })
    await store.addConversation('task-005', { sessionId: 'session-stop', title: '分析会话', kind: 'analysis' })
    await store.bindRunBySession('session-stop', { run_id: 'run-stop', lifecycle_status: 'running' })
    assert.equal((await store.getByRun('run-stop')).task_id, 'task-005')
    await store.reconcileRuns([{ run_id: 'run-stop', lifecycle_status: 'stopped', phase: 'STOPPED' }])
    assert.equal((await store.get('task-005')).status, 'stopped')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('scopes duplicate Run ids by data root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-task-run-scope-'))
  let id = 0
  try {
    const store = createTaskStore({ storePath: path.join(root, 'tasks-v1.json'), idFactory: () => `task-scope-${++id}` })
    for (const dataRoot of ['/workspace-a/pangea-data', '/workspace-b/pangea-data']) {
      const task = await store.create({ workspace: path.dirname(dataRoot), dataRoot, input: { repository: 'repo-one', target: dataRoot } })
      await store.addConversation(task.task_id, { sessionId: `session-${id}`, title: '分析会话', kind: 'analysis' })
      await store.bindRunBySession(`session-${id}`, { run_id: 'same-run', lifecycle_status: 'running' })
    }
    assert.equal((await store.getByRun('same-run', { dataRoot: '/workspace-b/pangea-data' })).workspace, '/workspace-b')
    await store.reconcileRuns([{ run_id: 'same-run', lifecycle_status: 'stopped' }], { dataRoot: '/workspace-b/pangea-data' })
    assert.equal((await store.list({ workspace: '/workspace-a' }))[0].status, 'running')
    assert.equal((await store.list({ workspace: '/workspace-b' }))[0].status, 'stopped')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('keeps an observed session failure visible while its Run metadata still says running', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-task-session-failure-'))
  try {
    const store = createTaskStore({ storePath: path.join(root, 'tasks-v1.json'), idFactory: () => 'task-session-failure' })
    await store.create({ workspace: '/workspace', dataRoot: '/workspace/pangea-data', input: { repository: 'repo-one', target: 'API 失败' } })
    await store.addConversation('task-session-failure', { sessionId: 'session-failure', title: '分析会话', kind: 'analysis' })
    await store.bindRunBySession('session-failure', { run_id: 'run-failure', lifecycle_status: 'running' })
    await store.markLaunchFailed('task-session-failure', '模型 API 不可用', 'MODEL_REQUEST_FAILED')
    await store.reconcileRuns([{ run_id: 'run-failure', lifecycle_status: 'running' }], { dataRoot: '/workspace/pangea-data' })
    const task = await store.get('task-session-failure')
    assert.equal(task.status, 'failed')
    assert.equal(task.launch_error, '模型 API 不可用')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('rebinds an explicitly stopped task after a portable workspace move', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-task-rebind-'))
  try {
    const store = createTaskStore({ storePath: path.join(root, 'tasks-v1.json'), idFactory: () => 'task-rebind' })
    await store.create({ workspace: '/old/install/repo', dataRoot: '/old/install/repo/pangea-data', input: { repository: 'repo-one', target: '移动后停止' } })
    await store.addConversation('task-rebind', { sessionId: 'session-rebind', title: '分析会话', kind: 'analysis' })
    await store.bindRunBySession('session-rebind', { run_id: 'run-rebind', lifecycle_status: 'running' })
    const rebound = await store.rebindWorkspace('task-rebind', '/new/install/repo')
    assert.equal(rebound.workspace, '/new/install/repo')
    assert.equal((await store.list({ workspace: '/new/install/repo' }))[0].run_id, 'run-rebind')
    assert.equal((await store.list({ workspace: '/old/install/repo' })).length, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('keeps an external ACP provider authoritative without freezing its model', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-task-acp-'))
  let now = 2000
  try {
    const store = createTaskStore({ storePath: path.join(root, 'tasks-v1.json'), now: () => ++now, idFactory: () => 'task-acp' })
    const legacyRoute = { provider: 'pangea-nga', model: 'nga-model', reasoning_effort: 'high', route_class: 'external-acp' }
    await store.create({
      workspace: '/workspace', dataRoot: '/workspace/pangea-data',
      input: { repository: 'repo-one', target: '外部分析', provider_id: 'pangea-nga', model_route: legacyRoute },
    })
    assert.deepEqual((await store.get('task-acp')).model_route, legacyRoute)
    await store.prepareProviderLaunch('task-acp', 'pangea-nga')
    await store.addConversation('task-acp', { sessionId: 'owner-1', title: '分析', kind: 'analysis' })
    await store.bindRunBySession('owner-1', { run_id: 'run-acp', lifecycle_status: 'running' })
    const running = await store.bindJob('task-acp', { jobId: 'job-1', provider: 'pangea-nga', ownerSessionId: 'owner-1' })
    assert.equal(running.model_route, null)
    assert.equal((await store.getByJob('job-1')).task_id, 'task-acp')
    await store.bindAgentRuntime('task-acp', { agentSessionId: 'acp-session-1', processId: 4242 })
    await store.recordJobActivity('job-1', '正在分析 Lua 状态机')
    const active = await store.get('task-acp')
    assert.equal(active.agent_session_id, 'acp-session-1')
    assert.equal(active.attempts[0].agent_session_id, 'acp-session-1')
    assert.equal(active.process_id, 4242)
    assert.equal(active.last_output, '正在分析 Lua 状态机')

    await store.reconcileRuns([{ run_id: 'run-acp', lifecycle_status: 'complete' }], { dataRoot: '/workspace/pangea-data' })
    assert.equal((await store.get('task-acp')).status, 'running')

    const settled = await store.settleJob('job-1', { status: 'completed' })
    assert.equal(settled.status, 'completed')
    assert.equal(settled.execution_status, 'completed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('allocates a durable attempt before a Job exists and records Job start time', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-task-attempt-start-'))
  let now = 5000
  try {
    const store = createTaskStore({
      storePath: path.join(root, 'tasks-v1.json'),
      now: () => ++now,
      idFactory: () => 'task-attempt-start',
      attemptIdFactory: () => 'attempt-start',
    })
    await store.create({ workspace: '/workspace', input: { repository: 'repo-one', target: '启动身份' } })
    const prepared = await store.prepareProviderLaunch('task-attempt-start', 'pangea-opencode')
    assert.equal(prepared.attempt_id, 'attempt-start')
    assert.equal(prepared.attempts[0].execution_status, 'starting')
    assert.equal(prepared.job_id, null)
    const ownerBound = await store.bindOwnerSession('task-attempt-start', { ownerSessionId: 'owner-1' })
    assert.equal(ownerBound.owner_session_id, 'owner-1')
    assert.equal(ownerBound.attempts[0].owner_session_id, 'owner-1')
    const bound = await store.bindJob('task-attempt-start', {
      jobId: 'subagent-1', provider: 'pangea-opencode', ownerSessionId: 'owner-1', jobStartedAt: 5010,
    })
    assert.equal(bound.attempt_id, 'attempt-start')
    assert.equal(bound.job_started_at, 5010)
    assert.equal(bound.attempts[0].job_started_at, 5010)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('binds a created Run before its DSH session exists so launch failures can resume it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-task-run-created-'))
  try {
    const store = createTaskStore({ storePath: path.join(root, 'tasks-v1.json'), idFactory: () => 'task-created-run' })
    await store.create({ workspace: '/workspace', input: { repository: 'repo-one', target: '会话创建失败' } })
    const bound = await store.bindRun('task-created-run', 'run-created-before-session')
    assert.equal(bound.run_id, 'run-created-before-session')
    assert.equal(bound.status, 'preparing')
    const failed = await store.markLaunchFailed('task-created-run', '会话创建失败')
    assert.equal(failed.run_id, 'run-created-before-session')
    assert.equal(failed.status, 'failed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('does not resurrect a stopped ACP attempt from a stale running Run snapshot', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-task-stale-stop-'))
  try {
    const store = createTaskStore({ storePath: path.join(root, 'tasks-v1.json'), idFactory: () => 'task-stale-stop' })
    await store.create({ workspace: '/workspace', input: { repository: 'repo-one', target: '停止竞态' } })
    await store.addConversation('task-stale-stop', { sessionId: 'session-stop', title: '分析会话', kind: 'analysis' })
    await store.bindRunBySession('session-stop', { run_id: 'run-stale-stop', lifecycle_status: 'running' })
    await store.markStopped('task-stale-stop')
    await store.reconcileRuns([{ run_id: 'run-stale-stop', lifecycle_status: 'running' }])
    const task = await store.get('task-stale-stop')
    assert.equal(task.status, 'stopped')
    assert.equal(task.execution_status, 'stopped')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('isolates identical Job ids by owner and settles the matching attempt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-task-attempts-'))
  let id = 0
  try {
    const store = createTaskStore({
      storePath: path.join(root, 'tasks-v1.json'),
      idFactory: () => `task-attempt-${++id}`,
    })
    const first = await store.create({ workspace: '/workspace', input: { repository: 'repo-one', target: '第一条' } })
    const second = await store.create({ workspace: '/workspace', input: { repository: 'repo-one', target: '第二条' } })
    await store.bindJob(first.task_id, {
      jobId: 'subagent-1', provider: 'pangea-opencode', ownerSessionId: 'owner-a',
      runtimeInstanceId: 'runtime-a', attemptId: 'attempt-a',
    })
    await store.bindJob(second.task_id, {
      jobId: 'subagent-1', provider: 'pangea-opencode', ownerSessionId: 'owner-b',
      runtimeInstanceId: 'runtime-b', attemptId: 'attempt-b',
    })

    assert.equal((await store.getByJob('subagent-1', { ownerSessionId: 'owner-a' })).task_id, first.task_id)
    assert.equal((await store.getByJob('subagent-1', { ownerSessionId: 'owner-b' })).task_id, second.task_id)
    await store.recordJobActivity({ jobId: 'subagent-1', ownerSessionId: 'owner-b' }, '第二条输出')
    await store.settleJob({ jobId: 'subagent-1', ownerSessionId: 'owner-b' }, { status: 'failed', detail: '只失败第二条' })

    const firstAfter = await store.get(first.task_id)
    const secondAfter = await store.get(second.task_id)
    assert.equal(firstAfter.status, 'running')
    assert.equal(firstAfter.last_output, null)
    assert.equal(secondAfter.status, 'failed')
    assert.equal(secondAfter.last_output, '第二条输出')
    assert.equal(secondAfter.attempts[0].attempt_id, 'attempt-b')
    assert.equal(secondAfter.attempts[0].execution_status, 'failed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('ignores late output from an older attempt at the task level', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-task-late-attempt-'))
  try {
    const store = createTaskStore({ storePath: path.join(root, 'tasks-v1.json'), idFactory: () => 'task-late-attempt' })
    await store.create({ workspace: '/workspace', input: { repository: 'repo-one', target: '迟到输出' } })
    await store.bindJob('task-late-attempt', {
      jobId: 'job-old', provider: 'pangea-opencode', ownerSessionId: 'owner',
      attemptId: 'attempt-old',
    })
    const next = await store.prepareProviderLaunch('task-late-attempt', 'pangea-opencode')
    await store.bindJob('task-late-attempt', {
      jobId: 'job-new', provider: 'pangea-opencode', ownerSessionId: 'owner',
      attemptId: next.attempt_id,
    })
    await store.recordJobActivity({ jobId: 'job-old', ownerSessionId: 'owner', attemptId: 'attempt-old' }, '旧输出')
    const task = await store.get('task-late-attempt')
    assert.equal(task.attempt_id, next.attempt_id)
    assert.equal(task.last_output, null)
    assert.equal(task.attempts.find(item => item.attempt_id === 'attempt-old').last_output, '旧输出')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('keeps the first terminal settlement for an attempt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-task-terminal-idempotent-'))
  try {
    const store = createTaskStore({ storePath: path.join(root, 'tasks-v1.json'), idFactory: () => 'task-terminal-idempotent' })
    await store.create({ workspace: '/workspace', input: { repository: 'repo-one', target: '终态幂等' } })
    await store.bindJob('task-terminal-idempotent', { jobId: 'job-1', provider: 'pangea-opencode', ownerSessionId: 'owner', attemptId: 'attempt-1' })
    const completed = await store.settleJob({ jobId: 'job-1', ownerSessionId: 'owner', attemptId: 'attempt-1' }, { status: 'completed' })
    const lateFailure = await store.settleJob({ jobId: 'job-1', ownerSessionId: 'owner', attemptId: 'attempt-1' }, { status: 'failed', detail: '迟到失败' })
    assert.equal(completed.status, 'completed')
    assert.equal(lateFailure.status, 'completed')
    assert.equal(lateFailure.attempts[0].execution_status, 'completed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('keeps a requested stop pending until the Job reports a terminal state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-task-stopping-'))
  try {
    const store = createTaskStore({ storePath: path.join(root, 'tasks-v1.json'), idFactory: () => 'task-stopping' })
    await store.create({ workspace: '/workspace', input: { repository: 'repo-one', target: '停止确认' } })
    await store.prepareProviderLaunch('task-stopping', 'pangea-opencode')
    const stopping = await store.markStopping('task-stopping')
    assert.equal(stopping.execution_status, 'stopping')
    const bound = await store.bindJob('task-stopping', {
      jobId: 'job-stopping', provider: 'pangea-opencode', ownerSessionId: 'owner', attemptId: stopping.attempt_id, jobStartedAt: 100,
    })
    assert.equal(bound.execution_status, 'stopping')
    assert.equal(bound.status, 'preparing')
    assert.equal((await store.get('task-stopping')).attempts[0].execution_status, 'stopping')
    const stopped = await store.settleJob({ jobId: 'job-stopping', ownerSessionId: 'owner', attemptId: stopping.attempt_id }, { status: 'killed' })
    assert.equal(stopped.execution_status, 'stopped')
    assert.equal(stopped.status, 'stopped')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('does not promote a late Job binding from an older attempt to the current task', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-task-late-bind-'))
  try {
    let attempt = 0
    const store = createTaskStore({
      storePath: path.join(root, 'tasks-v1.json'), idFactory: () => 'task-late-bind', attemptIdFactory: () => `attempt-${++attempt}`,
    })
    await store.create({ workspace: '/workspace', input: { repository: 'repo-one', target: '迟到绑定' } })
    const first = await store.prepareProviderLaunch('task-late-bind', 'pangea-opencode')
    const second = await store.prepareProviderLaunch('task-late-bind', 'pangea-opencode')
    const bound = await store.bindJob('task-late-bind', {
      jobId: 'job-old', provider: 'pangea-opencode', ownerSessionId: 'owner-old', attemptId: first.attempt_id,
    })
    assert.equal(bound.attempt_id, second.attempt_id)
    assert.equal(bound.job_id, null)
    assert.equal(bound.attempts.find(item => item.attempt_id === first.attempt_id).job_id, 'job-old')
  } finally { await rm(root, { recursive: true, force: true }) }
})
