import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createRun, runAdapter, workspaceRoot } from '../src/pangea-api.js'

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
    const calls = []
    const result = await createRun(nested, {
      repository: 'repo-one', target: 'session and retry', source_scope: ['src/session.c'], focus: ['failure'],
      asset_ids: ['asset-not-in-current-contract'], test_case_examples: ['TC-not-in-current-contract'],
    }, async call => {
      calls.push(call)
      if (call.args[0] === 'system') {
        return { analysis_skill: { skill_id: 'codetalks-skill', version: '1.0.0' } }
      }
      observed = { call, contract: JSON.parse(await readFile(pending, 'utf8')) }
      return { run_id: 'run-01', data_root: path.join(root, 'pangea-data'), actions: [] }
    })
    assert.equal(workspaceRoot(nested), root)
    assert.equal(result.run_id, 'run-01')
    assert.deepEqual(observed.call.args, ['runs', 'create', '--contract', pending])
    assert.deepEqual(calls[0].args.slice(0, 2), ['system', 'capabilities'])
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

test('refuses to create a Run against a backend without codetalks-skill 1.0.0', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-skill-api-'))
  try {
    await mkdir(path.join(root, '.agents', 'pangea'), { recursive: true })
    await writeFile(path.join(root, '.agents', 'pangea', 'dsh.md'), 'rules\n', 'utf8')
    await assert.rejects(
      () => createRun(root, { repository: 'repo-one', target: 'session', source_scope: ['src/session.c'] }, async () => ({ repositories: ['repo-one'] })),
      /codetalks-skill 1\.0\.0/,
    )
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
