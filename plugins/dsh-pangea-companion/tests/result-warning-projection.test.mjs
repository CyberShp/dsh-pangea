import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { currentResultWarnings, currentWarningDegradations } from '../src/result-warning-projection.js'
import { summarizeRun } from '../src/reader.js'
import { buildOverviewFindings } from '../src/overview-findings.js'
import { writeArchitectureRun } from './architecture-source-first-fixture.mjs'

function result(actionId = 'action-a') {
  const binding = { run_id: 'run', action_id: actionId, task_id: `worker-${actionId}`, data_root: '/data' }
  const diagram = (recordId, revision, changes = {}) => ({ ...binding, kind: 'diagram_format_diagnostic',
    record_id: recordId, record_revision: revision, message: 'diagram', ...changes })
  return { binding, revision: 3, records: [
    { record_id: 'one', kind: 'flow', created_revision: 1 },
    { record_id: 'two', kind: 'flow', created_revision: 2, supersedes: ['one'] },
  ], warnings: [
    { kind: 'flow_path_hint', record_id: 'one', message: 'retired exact warning' },
    { kind: 'flow_path_hint', record_id: 'two', message: 'current warning' },
    { kind: 'flow_path_hint', message: 'unbound old warning' },
    { kind: 'custom_warning', record_id: 'one', message: 'unknown owner semantics' },
    { kind: 'flow_path_hint', action_id: 'foreign', record_id: 'one', message: 'foreign warning' },
    diagram('one', 1), diagram('two', 1), diagram('two', 2, { action_id: 'foreign' }), diagram('two', 2),
  ] }
}
const artifact = value => ({ action_id: value.binding.action_id, task_id: value.binding.task_id,
  binding_status: 'bound', runtime_result: value })
const degradation = (actionId, message, extra = {}) => ({ action_id: actionId, kind: 'agent_result_warning', message, ...extra })

test('current warnings retire proven legacy record hints while preserving originals and strict diagram identities', () => {
  const value = result(), before = structuredClone(value)
  assert.deepEqual(currentResultWarnings(value), [value.warnings[1], value.warnings[2], value.warnings[3], value.warnings[4], value.warnings[8]])
  assert.deepEqual(value, before)
})

test('legacy degradation matching stays exact and action-local; current same text and unbound hints remain', () => {
  const a = result(), b = result('action-b')
  b.records = [b.records[0]]
  b.warnings = [b.warnings[0]]
  const pending = [degradation('action-a', 'retired exact warning'), degradation('action-b', 'retired exact warning'),
    degradation('action-a', 'current warning'), degradation('action-a', 'unbound old warning'),
    degradation('action-a', 'retired exact warning!'), degradation('missing-action', 'retired exact warning'),
    degradation('action-a', 'retired exact warning', { source_warning: { action_id: 'foreign', record_id: 'one' } })]
  const before = structuredClone(pending)
  assert.deepEqual(currentWarningDegradations(pending, [artifact(a), artifact(b)]), pending.slice(1))
  a.warnings.push({ kind: 'flow_path_hint', record_id: 'two', message: pending[0].message })
  assert.deepEqual(currentWarningDegradations(pending, [artifact(a), artifact(b)]), pending)
  a.warnings.pop()
  a.warnings.push({ kind: 'flow_path_hint', message: pending[0].message })
  assert.deepEqual(currentWarningDegradations(pending, [artifact(a), artifact(b)]), pending)
  assert.deepEqual(pending, before)
  assert.deepEqual(currentWarningDegradations(pending, [{ ...artifact(a), binding_status: 'pending' }]), pending)
})

test('reader and overview omit a retired flattened path hint but retain history and cross-action current hints', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'current-warning-reader-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fixture = await writeArchitectureRun(root)
  const progressPath = path.join(fixture.run, 'progress.json')
  const progress = JSON.parse(await readFile(progressPath, 'utf8'))
  const original = JSON.parse(await readFile(fixture.resultPath, 'utf8'))
  original.warnings = [
    { kind: 'flow_path_hint', record_id: 'old', message: 'obsolete fin-close-normal warning' },
    { kind: 'flow_path_hint', record_id: 'flow', message: 'active flow warning' },
    { kind: 'flow_path_hint', message: 'unbound warning' },
  ]
  const otherAction = `${fixture.task.run_id}:analysis:other`
  const otherResultPath = path.join(fixture.run, 'agent-results', 'other.json')
  const otherTaskPath = path.join(fixture.run, 'agent-tasks', 'other.json')
  const other = { ...original, binding: { ...original.binding, action_id: otherAction, task_id: 'other-worker' },
    records: [{ record_id: 'old', kind: 'note', body: 'current in a different action' }], warnings: [original.warnings[0]] }
  await writeFile(fixture.resultPath, JSON.stringify(original))
  await writeFile(otherResultPath, JSON.stringify(other))
  await writeFile(otherTaskPath, JSON.stringify({ unit_id: 'other', result_path: otherResultPath }))
  progress.actions[otherAction] = { ...progress.actions[fixture.actionId], task_path: otherTaskPath, task_id: 'other-worker' }
  progress.accepted_revisions[otherAction] = 3
  progress.degradations = [degradation(fixture.actionId, original.warnings[0].message),
    degradation(fixture.actionId, original.warnings[1].message), degradation(fixture.actionId, original.warnings[2].message),
    degradation(otherAction, original.warnings[0].message)]
  await writeFile(progressPath, JSON.stringify(progress))
  const originalResultBytes = await readFile(fixture.resultPath), originalProgressBytes = await readFile(progressPath)
  const view = await summarizeRun(root, fixture.task.run_id, { includeDetails: true })
  assert.deepEqual(view.workflow.unresolved, progress.degradations.slice(1))
  assert.deepEqual(view.workflow.diagnostic_history, progress.degradations)
  assert.deepEqual(view.source_first_records.find(action => action.action_id === fixture.actionId).current_warnings, original.warnings.slice(1))
  assert.deepEqual(buildOverviewFindings({ current: view }).map(row => row.title), progress.degradations.slice(1).map(item => item.message))
  assert.deepEqual(await readFile(fixture.resultPath), originalResultBytes)
  assert.deepEqual(await readFile(progressPath), originalProgressBytes)
})
