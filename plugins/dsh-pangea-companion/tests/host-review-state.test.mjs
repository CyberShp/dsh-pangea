import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createTaskStore } from '../src/task-store.js'
import { applyTaskExecutionState } from '../src/index.js'

test('host binding is durable and cannot be attached to another attempt or Producer', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pangea-review-'))
  try {
    const storePath = path.join(dir, 'tasks.json'), store = createTaskStore({ storePath })
    const task = await store.create({ workspace: dir, dataRoot: dir, input: { target: 'x', repository: 'r', mode: 'depth' } })
    const prepared = await store.prepareProviderLaunch(task.task_id, 'pangea-opencode')
    await store.bindRun(task.task_id, 'run-1')
    await store.bindAgentRuntime(task.task_id, { attemptId: prepared.attempt_id, agentSessionId: 'producer' })
    const review = { task_id: task.task_id, run_id: 'run-1', data_root: dir, attempt_id: prepared.attempt_id, producer_session_id: 'producer', reviewer_session_id: 'reviewer', status: 'reviewing' }
    await store.recordReview(task.task_id, review)
    const reloaded = await createTaskStore({ storePath }).get(task.task_id)
    assert.equal(reloaded.host_review.reviewer_session_id, 'reviewer')
    await assert.rejects(store.recordReview(task.task_id, { ...review, attempt_id: 'other' }), /绑定/)
    await assert.rejects(store.recordReview(task.task_id, { ...review, producer_session_id: 'other' }), /绑定/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('model READY and PASS remain pending until the host reviewer actually finishes', () => {
  const snapshot = { current: { run_id: 'r', data_root: '/data', lifecycle_status: 'complete', phase_title: '已完成', terminal: true, semantic_review: { method: 'independent_declared', verdict: 'PASS' } } }
  const task = { task_id: 't', run_id: 'r', data_root: '/data', attempt_id: 'a', execution_status: 'running', host_review: { task_id: 't', run_id: 'r', data_root: '/data', attempt_id: 'a', status: 'reviewing' } }
  const pending = applyTaskExecutionState(snapshot, task).current
  assert.equal(pending.lifecycle_status, 'running')
  assert.equal(pending.semantic_review.method, 'independent_pending')
  assert.equal(pending.semantic_review.verdict, null)
  assert.equal(pending.phase_title, '独立复核中')
  const verifying = applyTaskExecutionState(snapshot, { ...task, host_review: { ...task.host_review, status: 'verifying' } }).current
  assert.equal(verifying.phase_title, '执行校验中')
  const finished = applyTaskExecutionState(snapshot, { ...task, host_review: { ...task.host_review, status: 'complete', producer_session_id: 'p', reviewer_session_id: 'v', reviewer_turn_completed_at: 123, verdict: 'UNRESOLVED' } }).current
  assert.equal(finished.semantic_review.method, 'independent_verified')
  assert.equal(finished.semantic_review.verdict, 'UNRESOLVED')
  assert.equal(snapshot.current.semantic_review.method, 'independent_declared')
})

for (const status of ['stopped', 'failed']) test(`review title reflects terminal ${status} execution`, () => {
  const current = { run_id: 'r', data_root: '/data', phase_title: '独立复核中', lifecycle_status: 'running' }
  const task = { task_id: 't', run_id: 'r', data_root: '/data', attempt_id: 'a', status, execution_status: status,
    host_review: { task_id: 't', run_id: 'r', attempt_id: 'a', status: 'cancelled' } }
  const result = applyTaskExecutionState({ current }, task).current
  assert.equal(result.phase_title, status === 'stopped' ? '已停止' : '执行失败')
  assert.equal(result.lifecycle_status, status)
})
