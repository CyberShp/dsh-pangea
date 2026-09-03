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

test('creates a frozen 2.0 Skill request and removes it after Run creation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-run-api-'))
  const marker = path.join(root, '.agents', 'pangea')
  const nested = path.join(root, 'nested')
  const pending = path.join(root, 'pangea-data', '.pangea', 'pending-skill-request.json')
  try {
    await mkdir(marker, { recursive: true })
    await mkdir(nested, { recursive: true })
    await writeFile(path.join(marker, 'dsh.md'), 'rules\n', 'utf8')
    let observed
    const calls = []
    const result = await createRun(nested, {
      repository: 'repo-one', target: 'session and retry', source_scope: ['src/session.c'],
      asset_ids: ['asset-1'],
    }, async call => {
      calls.push(call)
      if (call.args[0] === 'system') {
        return { analysis_skill: { skill_id: 'codetalks-skill', version: '1.3.0' } }
      }
      observed = { call, contract: JSON.parse(await readFile(pending, 'utf8')) }
      return { run_id: 'run-01', data_root: path.join(root, 'pangea-data'), actions: [] }
    })
    assert.equal(workspaceRoot(nested), root)
    assert.equal(result.run_id, 'run-01')
    assert.deepEqual(observed.call.args, ['runs', 'create', '--request', pending])
    assert.deepEqual(calls[0].args.slice(0, 2), ['system', 'capabilities'])
    assert.equal(observed.contract.repository, 'repo-one')
    assert.equal(observed.contract.target, 'session and retry')
    assert.deepEqual(observed.contract.source_scope, ['src/session.c'])
    assert.equal(observed.contract.run_id, undefined)
    assert.equal(observed.contract.mode, undefined)
    assert.equal(observed.contract.request_version, '2.0')
    assert.equal(observed.contract.data_root, path.join(root, 'pangea-data'))
    assert.deepEqual(observed.contract.asset_ids, ['asset-1'])
    assert.equal(observed.contract.focus, undefined)
    assert.equal(observed.contract.test_case_examples, undefined)
    assert.equal(existsSync(pending), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('refuses to create a Run against a backend without codetalks-skill 1.3.0', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-skill-api-'))
  try {
    await mkdir(path.join(root, '.agents', 'pangea'), { recursive: true })
    await writeFile(path.join(root, '.agents', 'pangea', 'dsh.md'), 'rules\n', 'utf8')
    await assert.rejects(
      () => createRun(root, { repository: 'repo-one', target: 'session', source_scope: ['src/session.c'] }, async () => ({ repositories: ['repo-one'] })),
      /codetalks-skill 1\.3\.0/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects legacy focus and test example fields before writing a request', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-legacy-input-'))
  try {
    await mkdir(path.join(root, '.agents', 'pangea'), { recursive: true })
    await writeFile(path.join(root, '.agents', 'pangea', 'dsh.md'), 'rules\n', 'utf8')
    await assert.rejects(
      () => createRun(root, {
        repository: 'repo-one', target: 'legacy', source_scope: [], focus: ['manual'],
      }, async () => ({ analysis_skill: { skill_id: 'codetalks-skill', version: '1.3.0' } })),
      /新建分析不支持字段|focus/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
