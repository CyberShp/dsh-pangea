import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createRuntimeMonitor } from '../src/monitor.js'

function contextWith(...agents) {
  return {
    agents: { roots: () => agents },
    on() { return () => {} },
  }
}

function agent(id, cwd, createdAt) {
  return { id, session: { header: { cwd, createdAt } } }
}

test('binds execution by data root, Run, Task, and attempt without allowing a session rewrite', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-monitor-identity-'))
  let now = 1000
  try {
    const monitor = createRuntimeMonitor({ storePath: path.join(root, 'monitor-v1.json'), now: () => ++now })
    const session05 = agent('session-05', '/workspace', 500)
    const session06 = agent('session-06', '/workspace', 600)
    const dispose = monitor.start(contextWith(session05, session06))
    await monitor.bindExecution('session-06', {
      run_id: 'run-06', phase: 'STEP_BOOTSTRAP', analysis: { completed: 0, total: 9 },
    }, {
      dataRoot: '/workspace/pangea-data', taskId: 'task-06', attemptId: 'attempt-06',
    })

    await assert.rejects(() => monitor.bindExecution('session-05', {
      run_id: 'run-06', phase: 'FAILED', analysis: { completed: 0, total: 9 },
    }, {
      dataRoot: '/workspace/pangea-data', taskId: 'task-06', attemptId: 'attempt-06',
    }), /already bound to another session/)

    const snapshot = await monitor.snapshot({ dataRoot: '/workspace/pangea-data', runId: 'run-06' })
    assert.equal(snapshot.run.session_id, 'session-06')
    assert.equal(snapshot.run.session_created_at, 600)
    assert.equal(snapshot.run.task_id, 'task-06')
    assert.equal(snapshot.run.attempt_id, 'attempt-06')
    await dispose()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('refreshes explicit Run observations for step, ACK, and state timestamps while isolating data roots', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-monitor-observe-'))
  let now = 2000
  try {
    const monitor = createRuntimeMonitor({ storePath: path.join(root, 'monitor-v1.json'), now: () => ++now })
    await monitor.observeRunSnapshot('/workspace-a/pangea-data', {
      run_id: 'same-run', phase: 'STEP_02', analysis: { completed: 1, total: 9 },
      workflow: { core_rules_ack: { 'path-fidelity': { ack_at: '2026-09-07T03:22:02Z' } } },
      state_read: { updated_at: '2026-09-07T03:22:02Z' },
    })
    const first = await monitor.snapshot({ dataRoot: '/workspace-a/pangea-data', runId: 'same-run' })
    await monitor.observeRunSnapshot('/workspace-a/pangea-data', {
      run_id: 'same-run', phase: 'STEP_03', analysis: { completed: 2, total: 9 },
      workflow: { core_rules_ack: {
        'path-fidelity': { ack_at: '2026-09-07T03:22:02Z' },
        'evidence-consumption': { ack_at: '2026-09-07T03:22:03Z' },
        'narrative-first': { ack_at: '2026-09-07T03:22:03Z' },
      } },
      state_read: { updated_at: '2026-09-07T03:38:18Z' },
    })
    await monitor.observeRunSnapshot('/workspace-b/pangea-data', {
      run_id: 'same-run', phase: 'FAILED', analysis: { completed: 0, total: 9 },
      state_read: { updated_at: '2026-09-07T03:20:00Z' },
    })

    const active = await monitor.snapshot({ dataRoot: '/workspace-a/pangea-data', runId: 'same-run' })
    const other = await monitor.snapshot({ dataRoot: '/workspace-b/pangea-data', runId: 'same-run' })
    assert.equal(active.run.pangea_phase, 'STEP_03')
    assert.equal(active.run.pangea_progress.completed, 2)
    assert.equal(active.run.pangea_progress.core_rules_ack, 3)
    assert.equal(active.run.state_updated_at, '2026-09-07T03:38:18Z')
    assert.ok(active.run.observed_at > first.run.observed_at)
    assert.ok(active.run.progress_changed_at > first.run.progress_changed_at)
    assert.equal(other.run.pangea_phase, 'FAILED')
    await monitor.flush()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('does not trust a v1 monitor association that lacks data root and attempt identity', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-monitor-migrate-'))
  const storePath = path.join(root, 'monitor-v1.json')
  try {
    await mkdir(path.dirname(storePath), { recursive: true })
    await writeFile(storePath, JSON.stringify({ version: 1, runs: {
      'run-06': { session_id: 'session-05', session_created_at: 500, pangea_phase: 'FAILED' },
    } }), 'utf8')
    const monitor = createRuntimeMonitor({ storePath })
    const snapshot = await monitor.snapshot({ dataRoot: '/workspace/pangea-data', runId: 'run-06' })
    assert.equal(snapshot.run, null)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('tracks real record save times separately from polling, transport activity, and elapsed clocks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-monitor-effective-'))
  const storePath = path.join(root, 'monitor-v1.json')
  let now = 10000
  try {
    const monitor = createRuntimeMonitor({ storePath, now: () => ++now })
    const owner = agent('owner', root, 1)
    const dispose = monitor.start(contextWith(owner))
    const execution = {
      format_version: 'pangea-execution-view-v1', stage: 'analyzing', lifecycle_status: 'running',
      unit_counts: { total: 1, completed: 0, active: 1 },
      last_effective_progress: { kind: 'records_saved', at_ms: 2000, action_id: 'a', unit_id: 'u', revision: 1, record_count: 1 },
      actions: [{ action_id: 'a', status: 'dispatched', saved_revision: 1, saved_record_count: 1, last_saved_at_ms: 2000,
        completion_declared: false, accepted_revision: null, delivery_revision: null, current_turn_elapsed_ms: 200 }],
    }
    const summary = { run_id: 'run', phase: 'ANALYZING', analysis: { completed: 0, total: 1 }, execution_view: execution }
    await monitor.bindExecution('owner', summary, { dataRoot: root, taskId: 'task', attemptId: 'attempt' })
    const first = (await monitor.snapshot({ dataRoot: root, runId: 'run' })).run
    execution.actions[0].current_turn_elapsed_ms = 900
    await monitor.observeRunSnapshot(root, summary)
    monitor.disposeAgent(owner)
    const observed = (await monitor.snapshot({ dataRoot: root, runId: 'run' })).run
    assert.ok(observed.observed_at > first.observed_at)
    assert.ok(observed.execution_last_activity_at > first.execution_last_activity_at)
    assert.equal(observed.progress_changed_at, first.progress_changed_at)
    assert.equal(observed.last_effective_progress_at_ms, 2000)
    execution.actions[0].saved_revision = 2
    execution.actions[0].saved_record_count = 2
    execution.actions[0].last_saved_at_ms = 3000
    execution.last_effective_progress = { ...execution.last_effective_progress, at_ms: 3000, revision: 2, record_count: 2 }
    await monitor.observeRunSnapshot(root, summary)
    const saved = (await monitor.snapshot({ dataRoot: root, runId: 'run' })).run
    assert.ok(saved.progress_changed_at > observed.progress_changed_at)
    assert.equal(saved.last_effective_progress_at_ms, 3000)
    assert.equal(saved.last_effective_progress.revision, 2)
    execution.actions[0].completion_declared = true
    await monitor.observeRunSnapshot(root, summary)
    const submitted = (await monitor.snapshot({ dataRoot: root, runId: 'run' })).run
    assert.ok(submitted.progress_changed_at > saved.progress_changed_at)
    assert.equal(submitted.last_effective_progress_at_ms, 3000)
    await dispose()
    const restarted = createRuntimeMonitor({ storePath })
    const restored = (await restarted.snapshot({ dataRoot: root, runId: 'run' })).run
    assert.equal(restored.last_effective_progress_at_ms, 3000)
    assert.equal(restored.last_effective_progress.action_id, 'a')
    assert.equal(restored.session_live, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
