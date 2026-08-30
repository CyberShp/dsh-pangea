import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { MethodologyCandidateRuntime } from '../src/methodology-runtime.js'

function ok(value) { return { result: { ok: true, value } } }

test('semantic candidate session imports through the PANGEA methodology API', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-methodology-'))
  const dataRoot = path.join(root, 'pangea-data')
  await mkdir(path.join(root, '.agents', 'pangea'), { recursive: true })
  await mkdir(dataRoot, { recursive: true })
  await writeFile(path.join(root, '.agents', 'pangea', 'dsh.md'), '# PANGEA\n')
  const prompts = []
  let derivationStatus = 'pending'
  const taskPath = path.join(dataRoot, 'methodologies', 'tasks', 'methodology-1', 'task.json')
  const api = {
    workspace: { async list() { return ok({ items: [{ workspaceId: 'workspace-1', path: root }] }) } },
    sessions: {
      async create(value) { assert.equal(value.payload.workspaceId, 'workspace-1'); return ok({ sessionId: 'session-1' }) },
      async rename() { return ok({}) },
      async prompt(value) { prompts.push(value.payload); return ok({}) },
    },
  }
  const runner = async ({ args }) => {
    if (args.slice(0, 3).join(' ') === 'methodologies derivations list') {
      return derivationStatus === 'none' ? { items: [] } : { items: [{
        task_id: 'methodology-1', action_id: 'methodology-1:derive', status: derivationStatus,
        created_at: '2026-08-30T00:00:00+08:00', completed_at: null,
        source_asset_ids: ['asset-1'], task_path: taskPath,
      }] }
    }
    if (args[0] === 'methodologies' && args[1] === 'derive') {
      derivationStatus = 'pending'
      return { action: {
        task_id: 'methodology-1', action_id: 'methodology-1:derive', action: 'dispatch_agent',
        role: 'methodology', stage: 'candidate_derivation', task_path: taskPath,
      } }
    }
    if (args[0] === 'methodologies' && args[1] === 'complete-derivation') {
      derivationStatus = 'completed'
      return { status: 'completed', imported: { items: [{ methodology_id: 'link-recovery', status: 'candidate' }] } }
    }
    throw new Error(`unexpected command: ${args.join(' ')}`)
  }
  try {
    const runtime = new MethodologyCandidateRuntime(api, runner)
    const launched = await runtime.start({ cwd: root, dataRoot, assetIds: ['asset-1'] })
    assert.equal(launched.session_id, 'session-1')
    assert.match(prompts[0].content[0].text, /methodology-worker\.md/)
    assert.match(prompts[0].content[0].text, /methodology-1\/task\.json/)
    const repeated = await runtime.start({ cwd: root, dataRoot, assetIds: ['asset-1'] })
    assert.equal(repeated.reused, true)
    assert.equal(prompts.length, 1)
    await runtime.finish(runtime.jobs.get('session-1'))
    assert.equal((await runtime.job(root, dataRoot)).status, 'completed')

    derivationStatus = 'ready'
    const restarted = new MethodologyCandidateRuntime(api, runner)
    const recovered = await restarted.start({ cwd: root, dataRoot, assetIds: ['asset-1'] })
    assert.equal(recovered.completed, true)
    assert.equal(derivationStatus, 'completed')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
