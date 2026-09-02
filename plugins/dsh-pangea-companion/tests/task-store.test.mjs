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
        model_route: { provider: 'minimax-1', model: 'MiniMax-M2.7-highspeed' },
      },
    })
    assert.equal(task.task_id, 'task-001')
    assert.equal(task.status, 'preparing')
    assert.equal(task.run_id, null)
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
