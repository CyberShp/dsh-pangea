import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createRun, normalizeSourceScope, workspaceRoot } from '../src/pangea-api.js'

test('accepts a copied Windows repository address as source scope', () => {
  assert.deepEqual(
    normalizeSourceScope(['D:\\sources\\repo-one\\src\\session.c', 'src\\retry.c'], 'repo-one'),
    ['src/session.c', 'src/retry.c'],
  )
  assert.throws(
    () => normalizeSourceScope(['D:\\sources\\another-repo\\src\\session.c'], 'repo-one'),
    /不属于已选仓库“repo-one”/,
  )
})

test('accepts quoted file URIs and UNC paths copied from Windows Explorer', () => {
  assert.deepEqual(
    normalizeSourceScope(['"file:///D:/sources/repo-one/src/session.c"', '\\\\server\\share\\repo-one\\src\\retry.c'], 'repo-one'),
    ['src/session.c', 'src/retry.c'],
  )
})

test('creates a frozen source-first contract and removes it after Run creation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-run-api-'))
  const marker = path.join(root, '.agents', 'pangea')
  const nested = path.join(root, 'nested')
  let pending
  try {
    await mkdir(marker, { recursive: true })
    await mkdir(nested, { recursive: true })
    await writeFile(path.join(marker, 'dsh.md'), 'rules\n', 'utf8')
    let observed
    const calls = []
    const result = await createRun(nested, {
      repository: 'repo-one', target: 'session and retry', source_scope: ['src/session.c'],
      asset_ids: ['asset-1'],
      focus: ['recovery'], test_case_examples: ['TC-1'],
    }, async call => {
      calls.push(call)
      if (call.args[0] === 'system') {
        return { workflow_versions: ['source-first-v1'], source_first: { version: 'source-first-v1', contract_fields: ['analysis_settings', 'runtime_provenance'] } }
      }
      pending = call.args.at(-1)
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
    assert.equal(observed.contract.mode, undefined)
    assert.deepEqual(observed.contract.analysis_settings, { scenario: 'module-analysis', mode: 'depth' })
    assert.equal(observed.contract.workflow_version, 'source-first-v1')
    assert.equal(observed.contract.data_root, path.join(root, 'pangea-data'))
    assert.deepEqual(observed.contract.asset_ids, ['asset-1'])
    assert.deepEqual(observed.contract.focus, ['recovery'])
    assert.deepEqual(observed.contract.test_case_examples, ['TC-1'])
    assert.equal(existsSync(pending), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('refuses to create a Run against a backend without source-first-v1', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-skill-api-'))
  try {
    await mkdir(path.join(root, '.agents', 'pangea'), { recursive: true })
    await writeFile(path.join(root, '.agents', 'pangea', 'dsh.md'), 'rules\n', 'utf8')
    await assert.rejects(
      () => createRun(root, { repository: 'repo-one', target: 'session', source_scope: ['src/session.c'] }, async () => ({ repositories: ['repo-one'] })),
      /codetalks-skill|source-first-v1/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('preserves focus and test example fields in the source-first contract', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-legacy-input-'))
  try {
    await mkdir(path.join(root, '.agents', 'pangea'), { recursive: true })
    await writeFile(path.join(root, '.agents', 'pangea', 'dsh.md'), 'rules\n', 'utf8')
    let pending
    let contract
    await createRun(root, {
      repository: 'repo-one', target: 'source-first', source_scope: [], focus: ['manual'], test_case_examples: ['TC-1'],
    }, async call => {
      if (call.args[0] === 'system') return { workflow_versions: ['source-first-v1'] }
      pending = call.args.at(-1)
      contract = JSON.parse(await readFile(pending, 'utf8'))
      return { run_id: 'run-02' }
    })
    assert.deepEqual(contract.focus, ['manual'])
    assert.deepEqual(contract.test_case_examples, ['TC-1'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('concurrent source-first creations keep separate request files and identities', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-concurrent-create-'))
  try {
    await mkdir(path.join(root, '.agents/pangea'), { recursive: true })
    await writeFile(path.join(root, '.agents/pangea/dsh.md'), 'rules')
    const paths = [], targets = []
    let release
    const barrier = new Promise(resolve => { release = resolve })
    const runner = async call => {
      if (call.args[0] === 'system') return { workflow_versions: ['source-first-v1'] }
      const file = call.args.at(-1)
      paths.push(file)
      if (paths.length === 2) release()
      await barrier
      const contract = JSON.parse(await readFile(file, 'utf8'))
      targets.push(contract.target)
      return { run_id: contract.target }
    }
    const results = await Promise.all(['first', 'second'].map(target => createRun(root, { repository: 'sample', target, source_scope: ['sample.c'] }, runner)))
    assert.deepEqual(results.map(r => r.run_id), ['first', 'second'])
    assert.deepEqual(targets.sort(), ['first', 'second'])
    assert.notEqual(paths[0], paths[1])
    assert.ok(paths.every(file => !existsSync(file)))
  } finally { await rm(root, { recursive: true, force: true }) }
})
