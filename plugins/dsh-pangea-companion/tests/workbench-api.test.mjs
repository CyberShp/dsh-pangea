import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { launchAnalysisSession, normalizeRunInput, stopAnalysisRun, workbenchSnapshot } from '../src/workbench-api.js'

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-workbench-'))
  await mkdir(path.join(root, '.agents', 'pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents', 'pangea', 'dsh.md'), '# DSH\n', 'utf8')
  return root
}

function ok(value) { return { result: { ok: true, value } } }

test('normalizes Run input and rejects unregistered repositories', () => {
  const input = normalizeRunInput({
    repository: 'repo-one', target: 'session', source_scope: ['src/session.c', 'src/session.c', ''],
    focus: ['recovery'], asset_ids: ['asset-1'], test_case_examples: ['TC-1'],
  }, { repositories: ['repo-one'] })
  assert.deepEqual(input.source_scope, ['src/session.c'])
  assert.throws(() => normalizeRunInput({ repository: 'other', target: 'x', source_scope: ['x.c'] }, { repositories: ['repo-one'] }), /not registered/)
})

test('returns paginated Run metadata and reports incompatible backends explicitly', async () => {
  const root = await workspace()
  try {
    const calls = []
    const snapshot = await workbenchSnapshot({ cwd: root, cursor: 10, limit: 5, runner: async input => {
      calls.push(input)
      return input.args[0] === 'system' ? { repositories: ['repo-one'] } : { items: [{ run_id: 'run-1' }], next_cursor: 15, total: 21 }
    } })
    assert.equal(snapshot.compatibility.compatible, true)
    assert.equal(snapshot.runs.total, 21)
    assert.deepEqual(calls[1].args.slice(-4), ['--cursor', '10', '--limit', '5'])

    const incompatible = await workbenchSnapshot({ cwd: root, runner: async () => { throw new Error('unsupported command') } })
    assert.equal(incompatible.compatibility.compatible, false)
    assert.match(incompatible.compatibility.error, /unsupported command/)
    assert.deepEqual(incompatible.runs.items, [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('returns the selected Run methodologies from the public runs get API unchanged', async () => {
  const root = await workspace()
  try {
    const methodologies = [{
      unit_id: 'U00',
      items: [{
        methodology_id: 'storage_nvme', title: 'NVMe 核心专项分析', path: '/runtime/storage_nvme.md',
        content_sha256: 'a'.repeat(64), selection_kind: 'specialized', selection_reason: '源码范围命中 NVMe 信号',
        source_baseline: 'NVMe Base 2.4', source_catalog_path: '/runtime/SOURCES.md',
      }],
    }]
    const calls = []
    const snapshot = await workbenchSnapshot({ cwd: root, runId: 'run-nvme', runner: async input => {
      calls.push(input.args)
      if (input.args[0] === 'system') return { repositories: ['repo-one'] }
      if (input.args[1] === 'list') return { items: [{ run_id: 'run-nvme' }], next_cursor: null, total: 1 }
      return { run_id: 'run-nvme', methodologies }
    } })
    assert.deepEqual(calls[2].slice(0, 2), ['runs', 'get'])
    assert.deepEqual(calls[2].slice(-2), ['--run-id', 'run-nvme'])
    assert.deepEqual(snapshot.run.methodologies, methodologies)
    assert.deepEqual(snapshot.run_detail, { run_id: 'run-nvme', status: 'ok', error: null })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('keeps the workbench available when one public runs get detail cannot be read', async () => {
  const root = await workspace()
  try {
    const snapshot = await workbenchSnapshot({ cwd: root, runId: 'run-bad', runner: async input => {
      if (input.args[0] === 'system') return { repositories: ['repo-one'] }
      if (input.args[1] === 'list') return { items: [{ run_id: 'run-bad' }], next_cursor: null, total: 1 }
      throw new Error('methodologies unavailable')
    } })
    assert.equal(snapshot.compatibility.compatible, true)
    assert.equal(snapshot.run, null)
    assert.deepEqual(snapshot.run_detail, { run_id: 'run-bad', status: 'error', error: 'methodologies unavailable' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('launches a dedicated DSH session that owns the complete Run lifecycle', async () => {
  const root = await workspace()
  try {
    const prompts = []
    const api = {
      workspace: { async list() { return ok({ items: [{ workspaceId: 'workspace-1', path: root }] }) } },
      sessions: {
        async create(value) { assert.equal(value.payload.workspaceId, 'workspace-1'); return ok({ sessionId: 'session-1' }) },
        async rename(value) { assert.match(value.payload.title, /session/); return ok({}) },
        async prompt(value) { prompts.push(value.payload); return ok({}) },
      },
    }
    const result = await launchAnalysisSession(api, {
      cwd: root,
      input: { repository: 'repo-one', target: 'session', source_scope: ['src/session.c'], asset_ids: ['asset-1'] },
    }, async () => ({ repositories: ['repo-one'] }))
    assert.equal(result.session_id, 'session-1')
    assert.match(prompts[0].content[0].text, /pangea_run_create/)
    assert.match(prompts[0].content[0].text, /"asset_ids": \[/)
    assert.match(prompts[0].content[0].text, /完整 action 流程/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('stops one explicit Run through the public runs API', async () => {
  const root = await workspace()
  try {
    let call
    const result = await stopAnalysisRun({ cwd: root, runId: 'run-17', runner: async value => { call = value; return { run_id: 'run-17', lifecycle_status: 'stopped' } } })
    assert.deepEqual(call.args.slice(0, 2), ['runs', 'stop'])
    assert.deepEqual(call.args.slice(-2), ['--run-id', 'run-17'])
    assert.equal(result.run.lifecycle_status, 'stopped')
  } finally { await rm(root, { recursive: true, force: true }) }
})
