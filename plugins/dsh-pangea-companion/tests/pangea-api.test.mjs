import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createRun, normalizeAdapterResult, runAdapter, workspaceRoot } from '../src/pangea-api.js'

test('creates one managed pending contract and removes it after Run creation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-run-api-'))
  const marker = path.join(root, '.agents', 'pangea')
  const nested = path.join(root, 'nested')
  const pending = path.join(root, 'pangea-data', '.pangea', 'pending-task-contract.json')
  try {
    await mkdir(marker, { recursive: true })
    await mkdir(nested, { recursive: true })
    await writeFile(path.join(marker, 'dsh.md'), 'rules\n', 'utf8')
    let observed
    const result = await createRun(nested, {
      repository: 'repo-one', target: 'session and retry', source_scope: ['src/session.c'], focus: ['failure'],
      asset_ids: ['asset-not-in-current-contract'], test_case_examples: ['TC-not-in-current-contract'],
    }, async call => {
      observed = { call, contract: JSON.parse(await readFile(pending, 'utf8')) }
      return { run_id: 'run-01', data_root: path.join(root, 'pangea-data'), actions: [] }
    })
    assert.equal(workspaceRoot(nested), root)
    assert.equal(result.run_id, 'run-01')
    assert.deepEqual(observed.call.args, ['runs', 'create', '--contract', pending])
    assert.equal(observed.contract.repository, 'repo-one')
    assert.equal(observed.contract.target, 'session and retry')
    assert.deepEqual(observed.contract.source_scope, ['src/session.c'])
    assert.equal(observed.contract.run_id, undefined)
    assert.equal(observed.contract.asset_ids, undefined)
    assert.equal(observed.contract.test_case_examples, undefined)
    assert.equal(existsSync(pending), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('maps action tools to exact adapter arguments', async () => {
  let call
  const result = await runAdapter('/workspace', 'bind', {
    data_root: '/workspace/pangea-data', run_id: 'run-01', action_id: 'action-01', task_id: 'child-01',
  }, async value => { call = value; return { status: 'dispatched' } })
  assert.equal(result.status, 'dispatched')
  assert.deepEqual(call.args, [
    'adapter', 'bind', '--data-root', '/workspace/pangea-data', '--run-id', 'run-01',
    '--action-id', 'action-01', '--task-id', 'child-01',
  ])
})

test('normalizes a recoverable repair action into the workflow action envelope', () => {
  const repairAction = {
    action_id: 'analysis-U01', action: 'continue_agent', role: 'analysis', stage: 'unit_analysis',
    task_path: 'pangea-data/runs/run-01/tasks/U01.json', task_id: 'child-01', status: 'pending',
  }
  const result = normalizeAdapterResult({
    status: 'incomplete', recoverable: true, attention_required: false, repair_action: repairAction,
  })
  assert.deepEqual(result.action, repairAction)
})

test('does not auto-queue another repair after attention is required', () => {
  const repairAction = { action_id: 'analysis-U01', action: 'continue_agent' }
  const result = normalizeAdapterResult({
    status: 'incomplete', recoverable: true, attention_required: true, repair_action: repairAction,
  })
  assert.equal(result.action, undefined)
  assert.deepEqual(result.repair_action, repairAction)
})
