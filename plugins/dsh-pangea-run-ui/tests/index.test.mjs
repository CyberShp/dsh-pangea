import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { readRunOutputs } from '../src/index.js'

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value), 'utf8')
}

test('rework is conditional and raw worker outputs are preserved', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pangea-run-ui-'))
  const run = path.join(cwd, 'pangea-data', 'runs', 'run-1')
  await writeJson(path.join(run, 'progress.json'), {
    stage: 'reviewing', lifecycle_status: 'running', analysis_units: ['U01'], completed_analysis_units: ['U01'], completed_rework_units: [],
  })
  await writeJson(path.join(run, 'agent-results', 'analysis', 'U01.json'), {
    unit_id: 'U01', attempt: 0, worker_id: 'worker-a', summary: 'analysis summary', analyzed_scope: ['a.c'], risks: [{ risk_id: 'R1' }], test_cases: [], evidence: [], business_flows: [], errors: [],
  })
  await writeJson(path.join(run, 'agent-results', 'review.json'), { reviewer_id: 'reviewer-a', summary: 'pass candidate' })

  const before = await readRunOutputs({ cwd, runId: 'run-1' })
  assert.equal(before.has_rework, false)
  assert.equal(before.analysis[0].worker_id, 'worker-a')
  assert.equal(before.analysis[0].raw.summary, 'analysis summary')

  await writeJson(path.join(run, 'agent-results', 'rework', 'U01.json'), {
    unit_id: 'U01', attempt: 1, worker_id: 'worker-b', summary: 'targeted rework', risks: [], test_cases: [], evidence: [], business_flows: [], errors: [],
  })
  const after = await readRunOutputs({ cwd, runId: 'run-1' })
  assert.equal(after.has_rework, true)
  assert.equal(after.rework[0].attempt, 1)
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
