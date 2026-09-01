import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { buildWorkerDiagnostics, readRunOutputs } from '../src/index.js'

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value), 'utf8')
}

test('closure is conditional and locked Agent output paths are preserved', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pangea-run-ui-'))
  const run = path.join(cwd, 'pangea-data', 'runs', 'run-1')
  await writeJson(path.join(run, 'progress.json'), {
    stage: 'reviewing', lifecycle_status: 'running', analysis_units: ['U01'], completed_analysis_units: ['U01'], completed_closure_units: [],
  })
  await writeJson(path.join(run, 'agent-results', 'planning.json'), { summary: 'planning summary' })
  await writeJson(path.join(run, 'agent-results', 'analysis', 'U01.json'), {
    unit_id: 'U01', attempt: 0, worker_id: 'worker-a', summary: 'analysis summary', analyzed_scope: ['a.c'], risks: [{ risk_id: 'R1' }], test_cases: [], evidence: [], business_flows: [], errors: [],
  })
  await writeJson(path.join(run, 'agent-results', 'review.json'), { reviewer_id: 'reviewer-a', summary: 'pass candidate' })

  const before = await readRunOutputs({ cwd, runId: 'run-1' })
  assert.equal(before.has_rework, false)
  assert.equal(before.plan.raw.summary, 'planning summary')
  assert.equal(before.analysis[0].worker_id, 'worker-a')
  assert.equal(before.analysis[0].raw.summary, 'analysis summary')

  await writeJson(path.join(run, 'agent-results', 'closure', 'U01.json'), {
    unit_id: 'U01', attempt: 1, worker_id: 'worker-b', summary: 'targeted rework', risks: [], test_cases: [], evidence: [], business_flows: [], errors: [],
  })
  const after = await readRunOutputs({ cwd, runId: 'run-1' })
  assert.equal(after.has_rework, true)
  assert.equal(after.rework[0].kind, 'closure')
  assert.equal(after.rework[0].attempt, 1)
})

test('closure diagnostics distinguish the copied baseline from Worker changes', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pangea-run-ui-closure-'))
  const run = path.join(cwd, 'pangea-data', 'runs', 'run-closure')
  const taskPath = path.join(run, 'agent-tasks', 'closure', 'U01.json')
  const originalPath = path.join(run, 'validated-results', 'run-closure__analysis__U01.json')
  const resultPath = path.join(run, 'agent-results', 'closure', 'U01.json')
  const original = { unit_id: 'U01', summary: 'first pass', evidence: [] }
  await writeJson(originalPath, original)
  await writeJson(resultPath, original)
  await writeJson(taskPath, { task_type: 'closure', unit: { unit_id: 'U01' }, original_result_path: originalPath, result_path: resultPath })
  const progress = {
    actions: { c1: { action_id: 'c1', role: 'closure', stage: 'targeted_closure', status: 'dispatched', task_id: 'child-1', task_path: taskPath } },
  }

  const waiting = await buildWorkerDiagnostics({ cwd, progress, runDirectory: run, traceRecords: [] })
  assert.equal(waiting[0].result_state, 'baseline')

  await writeJson(resultPath, { ...original, summary: 'targeted closure' })
  const written = await buildWorkerDiagnostics({ cwd, progress, runDirectory: run, traceRecords: [] })
  assert.equal(written[0].result_state, 'written')
})

test('run action status is exposed so UI failure color matches run details', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pangea-run-ui-action-'))
  const run = path.join(cwd, 'pangea-data', 'runs', 'run-action')
  await writeJson(path.join(run, 'progress.json'), {
    stage: 'planning',
    lifecycle_status: 'running',
    actions: {
      planning: {
        action_id: 'planning-1', role: 'planning', stage: 'unit_planning', status: 'failed', task_id: 'task-1',
        error: { code: 'PLANNING_FAILED', message: 'planning failed' },
      },
    },
  })
  const output = await readRunOutputs({ cwd, runId: 'run-action' })
  assert.equal(output.progress.stage, 'planning')
  assert.equal(output.progress.actions[0].role, 'planning')
  assert.equal(output.progress.actions[0].stage, 'unit_planning')
  assert.equal(output.progress.actions[0].status, 'failed')
  assert.equal(output.progress.actions[0].error.code, 'PLANNING_FAILED')
})

test('worker diagnostics distinguish running skeleton from settled written results', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pangea-run-ui-trace-'))
  const run = path.join(cwd, 'pangea-data', 'runs', 'run-trace')
  const taskPath = path.join(run, 'tasks', 'analysis-U01.json')
  const resultPath = path.join(run, 'agent-results', 'analysis', 'U01.json')
  const skeletonPath = path.join(run, 'contracts', 'analysis-result-skeleton.json')
  const skeleton = { summary: '', business_flows: [], evidence: [], risks: [], test_cases: [], errors: [] }
  await writeJson(skeletonPath, skeleton)
  await writeJson(resultPath, skeleton)
  await writeJson(taskPath, {
    task_type: 'analysis', unit: { unit_id: 'U01' }, result_path: resultPath, result_skeleton_path: skeletonPath,
  })
  await writeJson(path.join(run, 'progress.json'), {
    stage: 'analyzing', lifecycle_status: 'running', analysis_units: [{ unit_id: 'U01' }],
    actions: {
      a1: { action_id: 'a1', action: 'dispatch_agent', role: 'analysis', stage: 'analysis', status: 'dispatched', task_id: 'child-1', task_path: taskPath },
    },
  })
  await mkdir(path.join(run, 'runtime'), { recursive: true })
  await writeFile(path.join(run, 'runtime', 'worker-trace.jsonl'), [
    JSON.stringify({ at: 1, type: 'started', action_id: 'a1', child_id: 'child-1', unit_id: 'U01' }),
    JSON.stringify({ at: 2, type: 'tool', action_id: 'a1', child_id: 'child-1', unit_id: 'U01', tool: 'read', target: taskPath, result_state: 'skeleton' }),
    JSON.stringify({ at: 3, type: 'tool', action_id: 'a1', child_id: 'child-1', unit_id: 'U01', tool: 'read', target: 'src/a.c', result_state: 'skeleton' }),
  ].join('\n') + '\n', 'utf8')

  const running = await readRunOutputs({ cwd, runId: 'run-trace' })
  const runtime = running.analysis[0].runtime
  assert.equal(runtime.status, 'dispatched')
  assert.equal(runtime.result_state, 'skeleton')
  assert.equal(runtime.task_read, true)
  assert.equal(runtime.tool_count, 2)
  assert.match(running.analysis[0].summary, /分析中/)
  assert.match(running.analysis[0].summary, /result_path 仍为骨架/)

  await writeJson(resultPath, { ...skeleton, summary: 'real result', evidence: [{ path: 'src/a.c' }] })
  await writeJson(path.join(run, 'progress.json'), {
    stage: 'analyzing', lifecycle_status: 'running', analysis_units: [{ unit_id: 'U01' }],
    actions: {
      a1: { action_id: 'a1', action: 'dispatch_agent', role: 'analysis', stage: 'analysis', status: 'settled', task_id: 'child-1', task_path: taskPath },
    },
  })
  await writeFile(path.join(run, 'runtime', 'worker-trace.jsonl'), JSON.stringify({ at: 4, type: 'settled', action_id: 'a1', child_id: 'child-1', unit_id: 'U01', reason: 'stop' }) + '\n', { flag: 'a' })

  const settled = await readRunOutputs({ cwd, runId: 'run-trace' })
  assert.equal(settled.analysis[0].runtime.status, 'settled')
  assert.equal(settled.analysis[0].runtime.result_state, 'written')
  assert.equal(settled.analysis[0].runtime.settled, true)
  assert.equal(settled.analysis[0].runtime.settled_reason, 'stop')
  assert.match(settled.analysis[0].summary, /待校验/)
  assert.match(settled.analysis[0].summary, /result_path 已写入/)
})

test('accepted worker result is reported as completed and validated', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pangea-run-ui-accepted-'))
  const run = path.join(cwd, 'pangea-data', 'runs', 'run-accepted')
  const taskPath = path.join(run, 'tasks', 'analysis-U01.json')
  const resultPath = path.join(run, 'agent-results', 'analysis', 'U01.json')
  const skeletonPath = path.join(run, 'contracts', 'skeleton.json')
  await writeJson(skeletonPath, { summary: '', evidence: [] })
  await writeJson(resultPath, { summary: 'done', evidence: [{ path: 'a.c' }] })
  await writeJson(taskPath, { unit: { unit_id: 'U01' }, result_path: resultPath, result_skeleton_path: skeletonPath })
  const progress = {
    actions: { a1: { action_id: 'a1', role: 'analysis', stage: 'analysis', status: 'accepted', task_id: 'child-1', task_path: taskPath } },
  }
  const diagnostics = await buildWorkerDiagnostics({ cwd, progress, runDirectory: run, traceRecords: [] })
  assert.equal(diagnostics[0].status, 'accepted')
  assert.equal(diagnostics[0].result_state, 'accepted')
  assert.equal(diagnostics[0].validation_status, 'valid')
})

test('desktop environment data root can be used without browser cwd', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-run-ui-env-'))
  const dataRoot = path.join(root, 'pangea-data')
  const run = path.join(dataRoot, 'runs', 'run-env')
  await writeJson(path.join(run, 'progress.json'), { stage: 'planning', lifecycle_status: 'running' })
  const previous = process.env.PANGEA_DATA_ROOT
  process.env.PANGEA_DATA_ROOT = dataRoot
  try {
    const output = await readRunOutputs({ runId: 'run-env' })
    assert.equal(output.run_id, 'run-env')
    assert.equal(output.progress.stage, 'planning')
  } finally {
    if (previous === undefined) delete process.env.PANGEA_DATA_ROOT
    else process.env.PANGEA_DATA_ROOT = previous
  }
})

test('run id traversal is rejected', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pangea-run-ui-'))
  await mkdir(path.join(cwd, 'pangea-data', 'runs'), { recursive: true })
  await assert.rejects(() => readRunOutputs({ cwd, runId: '../bad' }), /invalid run_id/)
})
