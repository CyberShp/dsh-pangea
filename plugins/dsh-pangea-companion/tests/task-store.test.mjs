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
