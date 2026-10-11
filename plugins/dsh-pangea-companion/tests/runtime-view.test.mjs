import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { sourceFirstExecutionView, sourceFirstUnitRows } from '../src/runtime-view.js'
import { summarizeRun } from '../src/reader.js'

function note(recordId, extra = {}) {
  return { record_id: recordId, kind: 'note', body: '原文保留', created_revision: 1, ...extra }
}

function action(actionId, unitId, { role = 'analysis', status = 'dispatched', records = [], savedAt = null, revision = records.length, completion = null, ...fields } = {}) {
  return {
    action_id: actionId, role, status, stage: role === 'closure' ? 'targeted_closure' : 'unit_analysis',
    task_id: `worker-${unitId}`, ...fields,
    task: { unit_id: unitId, title: `Unit ${unitId}` },
    runtime_result: { binding: { task_id: `worker-${unitId}` }, revision, records, completion, last_record_write_at_ms: savedAt },
  }
}

function view(artifacts, { plan = { units: [{ unit_id: 'one' }, { unit_id: 'two' }, { unit_id: 'three' }] }, now = 5000, ...progress } = {}) {
  return sourceFirstExecutionView({
    progress: { lifecycle_status: 'running', stage: 'closing', actions: Object.fromEntries(artifacts.map(item => [item.action_id, item])), ...progress },
    plan, artifacts, now,
  })
}

test('counts the frozen plan once per unit and preserves accepted results while closure is paused', () => {
  const artifacts = [
    action('analysis-one', 'one', { status: 'accepted', records: [note('old')], savedAt: 1000 }),
    action('analysis-two', 'two', { status: 'settled' }),
    action('closure-one', 'one', { role: 'closure', status: 'paused', records: [note('old'), note('new', { supersedes: ['old'] })],
      savedAt: 2000, revision: 2, execution_started_at_ms: 2500, execution_finished_at_ms: 4000,
      execution_elapsed_ms: 1500, execution_budget_ms: 1500, error: '执行预算已用尽' }),
  ]
  const projected = view(artifacts, { accepted_revisions: { 'analysis-one': 1 } })
  assert.deepEqual(projected.unit_counts, { total: 3, completed: 1, pending: 1, active: 0, paused: 1, failed: 0 })
  assert.deepEqual(projected.last_effective_progress, { kind: 'records_saved', at_ms: 2000, action_id: 'closure-one', unit_id: 'one', revision: 2, record_count: 1 })
  assert.equal(projected.actions[2].saved_record_count, 1)
  assert.equal(projected.actions[2].elapsed_ms, 1500)
  assert.equal(projected.actions[2].current_turn_elapsed_ms, 1500)
  assert.equal(projected.actions[2].budget_ms, 1500)
  assert.equal(projected.actions[2].resume_action, 'continue_agent')
  assert.deepEqual(projected.preserved.map(item => item.acceptance), ['accepted', 'draft'])
  assert.equal(projected.unresolved[0].reason, '执行预算已用尽')
  assert.equal(projected.recovery.requires_host_quiescence, true)
  const rows = sourceFirstUnitRows({ units: [{ unit_id: 'one' }, { unit_id: 'one' }, { unit_id: 'two' }] }, projected)
  assert.deepEqual(rows.map(row => row.status), ['paused', 'settled'])
})

test('saved work, completion declaration, accepted revision, and delivery revision remain distinct', () => {
  const saved = action('one', 'one', { records: [note('one')], revision: 2, savedAt: 1000,
    completion: { complete: true, declared_revision: 1 } })
  const submitted = action('two', 'two', { records: [note('two')], revision: 3, savedAt: 1200,
    completion: { complete: true, declared_revision: 3 } })
  const delivered = action('three', 'three', { role: 'closure', status: 'paused', records: [note('three')], revision: 4, savedAt: 1500, delivery_revision: 4 })
  const projected = view([saved, submitted, delivered])
  assert.equal(projected.actions[0].completion_declared, false)
  assert.equal(projected.actions[0].resume_action, 'continue_agent')
  assert.equal(projected.actions[1].completion_declared, true)
  assert.equal(projected.actions[1].resume_action, 'settle_action')
  assert.equal(projected.actions[1].accepted_revision, null)
  assert.equal(projected.actions[2].delivery_revision, 4)
  assert.equal(projected.preserved[2].acceptance, 'delivered')
  assert.equal(projected.recovery.requires_host_quiescence, true)
})

test('closure seeds and missing old timing do not invent effective progress', () => {
  const seed = action('closure', 'one', { role: 'closure', status: 'pending', records: [note('seed')], revision: 3 })
  seed.task.base_revision = 3
  seed.runtime_result.binding.task_id = 'pending'
  // Older seeds could carry their source result's timestamp; it is not a new write.
  seed.runtime_result.last_record_write_at_ms = 9000
  const projected = view([seed])
  assert.equal(projected.last_effective_progress, null)
  assert.equal(projected.actions[0].last_saved_at_ms, null)
  assert.equal(projected.actions[0].elapsed_ms, null)
  assert.equal(projected.actions[0].current_turn_elapsed_ms, null)
  assert.equal(projected.preserved[0].acceptance, 'seed')
  assert.equal(view([action('zero', 'one', { savedAt: 0 })]).last_effective_progress, null)
  const oldCorrection = action('old-closure', 'one', { role: 'closure', records: [note('fixed')], revision: 4 })
  oldCorrection.task.base_revision = 3
  oldCorrection.task.execution_budget_ms = 900000
  const old = view([oldCorrection])
  assert.equal(old.preserved[0].acceptance, 'draft')
  assert.equal(old.last_effective_progress, null)
  assert.equal(old.actions[0].budget_ms, 900000)
})

test('missing plan stays unknown and partial reporting resumes only report assembly', () => {
  const artifacts = [action('closure', 'one', { role: 'closure', status: 'paused', records: [note('saved')], savedAt: 2000 })]
  const unknown = view(artifacts, { plan: null })
  assert.equal(unknown.unit_counts.total, null)
  assert.equal(unknown.actions.length, 1)
  const partial = view(artifacts, { partial_delivery: true, stage: 'reporting', lifecycle_status: 'stopped' })
  assert.equal(partial.actions[0].resume_action, 'none')
  assert.equal(partial.recovery.requires_host_quiescence, false)
  assert.deepEqual(partial.recovery.resume_from, [{ action_id: null, task_id: null, operation: 'finalize_report' }])
  const complete = view(artifacts, { partial_delivery: true, stage: 'complete', lifecycle_status: 'complete' })
  assert.equal(complete.recovery.can_resume, false)
  assert.deepEqual(complete.recovery.resume_from, [])
})

test('a malformed result envelope cannot claim progress or hide other saved actions', () => {
  const valid = action('valid', 'one', { records: [note('good')], savedAt: 1000 })
  for (const records of [undefined, null, {}, [null], ['not-a-record-object']]) {
    const broken = action('broken', 'two', { savedAt: 9999, revision: 2 })
    broken.runtime_result.records = records
    const projected = view([valid, broken])
    assert.equal(projected.last_effective_progress.action_id, 'valid')
    assert.equal(projected.actions[1].saved_record_count, null)
    assert.equal(projected.actions[1].last_saved_at_ms, null)
    assert.deepEqual(projected.preserved.map(item => item.action_id), ['valid'])
    assert.equal(projected.diagnostics[0].action_id, 'broken')
  }
})

test('older readable notes do not require per-record revision metadata', () => {
  const legacy = action('legacy', 'one', { records: [{ record_id: 'note', kind: 'note', body: 'Existing saved analysis' }], savedAt: 1000 })
  const projected = view([legacy])
  assert.equal(projected.actions[0].saved_record_count, 1)
  assert.equal(projected.last_effective_progress.action_id, 'legacy')
  assert.equal(projected.diagnostics.length, 0)
})

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value), 'utf8')
}

test('reader projects checked files and planned but undispatched units without counting closure twice', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-execution-view-'))
  const runId = 'run-facts', run = path.join(root, 'runs', runId)
  try {
    await writeJson(path.join(run, 'inputs/task-contract.json'), { workflow_version: 'source-first-v1' })
    await writeJson(path.join(run, 'inputs/source-manifest.json'), { workflow_version: 'source-first-v1' })
    await writeJson(path.join(run, 'inputs/source-index.json'), { format_version: 'pangea-source-index-v1', files: [] })
    await writeJson(path.join(run, 'inputs/source-first-plan.json'), { units: [{ unit_id: 'one', title: 'Unit one' }, { unit_id: 'two', title: 'Unit two' }] })
    const artifacts = [
      action('analysis-one', 'one', { status: 'accepted', records: [note('source')], savedAt: 1000 }),
      action('closure-one', 'one', { role: 'closure', status: 'paused', records: [note('source'), note('fix')], revision: 2, savedAt: 2000, error: '执行预算已用尽' }),
    ]
    const actions = {}
    for (const item of artifacts) {
      const taskPath = path.join(run, 'tasks', `${item.action_id}.json`)
      const resultPath = path.join(run, 'results', `${item.action_id}.json`)
      const { task, runtime_result: result, ...facts } = item
      await writeJson(taskPath, { ...task, result_path: resultPath })
      await writeJson(resultPath, { ...result, format_version: 'pangea-notes-v1', binding: { ...result.binding, data_root: root, run_id: runId, action_id: item.action_id } })
      actions[item.action_id] = { ...facts, task_path: taskPath }
    }
    await writeJson(path.join(run, 'progress.json'), { run_id: runId, workflow_version: 'source-first-v1', lifecycle_status: 'running', stage: 'closing',
      actions, accepted_revisions: { 'analysis-one': 1 } })
    const summary = await summarizeRun(root, runId, { includeDetails: true })
    assert.equal(summary.analysis.total, 2)
    assert.equal(summary.analysis.completed, 0)
    assert.equal(summary.analysis.paused, 1)
    assert.equal(summary.analysis.pending, 1)
    assert.equal(summary.workflow.units.length, 2)
    assert.equal(summary.execution_view.last_effective_progress.at_ms, 2000)
    assert.deepEqual(summary.execution_view.diagnostics, [])
    // Optional cross-repository contract check using the installed real core.
    // Normal reader polling always stays in JavaScript and does not start it.
    if (process.env.PANGEA_PYTHON) {
      const script = 'import json,sys; from pathlib import Path; from pangea_agent.execution_view import execution_view; p=Path(sys.argv[1]); print(json.dumps(execution_view(p,json.loads((p/"progress.json").read_text()))))'
      const { stdout } = await promisify(execFile)(process.env.PANGEA_PYTHON, ['-c', script, run])
      assert.deepEqual(summary.execution_view, JSON.parse(stdout), 'DSH and core expose the same execution facts')
    }
    const correctionPath = path.join(run, 'results/closure-one.json')
    await writeJson(correctionPath, { ...artifacts[1].runtime_result, binding: { data_root: root, run_id: runId, action_id: 'closure-one', task_id: 'other-worker' } })
    const invalid = await summarizeRun(root, runId)
    assert.equal(invalid.execution_view.actions[1].saved_revision, null)
    assert.equal(invalid.execution_view.last_effective_progress.at_ms, 1000)
    assert.ok(invalid.execution_view.diagnostics.some(item => item.action_id === 'closure-one'))
    await writeJson(correctionPath, { format_version: 'pangea-notes-v1', revision: 0, records: [], completion: null, receipts: {},
      binding: { data_root: root, run_id: runId, action_id: 'closure-one', task_id: 'pending' } })
    actions['closure-one'].error = '用户停止 Run'
    await writeJson(path.join(run, 'progress.json'), { run_id: runId, workflow_version: 'source-first-v1', lifecycle_status: 'stopped', stage: 'closing',
      actions, accepted_revisions: { 'analysis-one': 1 } })
    const stopped = await summarizeRun(root, runId)
    assert.equal(stopped.execution_view.actions[1].saved_revision, 0)
    assert.equal(stopped.execution_view.actions[1].saved_record_count, 0)
    assert.equal(stopped.execution_view.actions[1].last_saved_at_ms, null)
    assert.deepEqual(stopped.execution_view.diagnostics, [])
    assert.deepEqual(stopped.reader_notices, [])
    await writeJson(correctionPath, { revision: 2, last_record_write_at_ms: 9999,
      binding: { data_root: root, run_id: runId, action_id: 'closure-one', task_id: 'worker-one' } })
    const corrupt = await summarizeRun(root, runId)
    assert.equal(corrupt.execution_view.actions[1].saved_record_count, null)
    assert.equal(corrupt.execution_view.last_effective_progress.at_ms, 1000)
    assert.equal(corrupt.execution_view.actions[0].saved_record_count, 1)
    assert.ok(corrupt.execution_view.diagnostics.some(item => item.action_id === 'closure-one'))
  } finally { await rm(root, { recursive: true, force: true }) }
})
