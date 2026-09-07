import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { MethodologyCandidateRuntime } from '../src/methodology-runtime.js'
import { apply } from '../src/index.js'

function ok(value) { return { result: { ok: true, value } } }

test('asset plugin connects methodology status and error events to its runtime', async () => {
  const handlers = new Map(), calls = []
  const originalStatus = MethodologyCandidateRuntime.prototype.handleAgentStatus
  const originalError = MethodologyCandidateRuntime.prototype.handleAgentError
  MethodologyCandidateRuntime.prototype.handleAgentStatus = function (...args) { calls.push(['status', ...args]) }
  MethodologyCandidateRuntime.prototype.handleAgentError = function (...args) { calls.push(['error', ...args]) }
  try {
    await apply({ apiProxy: {}, tools: { register: () => () => {} }, webServer: { register: () => () => {} }, on(name, handler) { handlers.set(name, handler); return () => handlers.delete(name) } })
    assert.ok(handlers.has('agent/status'), 'methodology generation must observe completion')
    assert.ok(handlers.has('agent/error'), 'methodology generation must observe failure')
    const agent = { session: { id: 'session-1' } }, error = new Error('MISSING_CREDENTIAL')
    handlers.get('agent/status')({ agent, status: 'running' })
    handlers.get('agent/error')({ agent, error })
    assert.deepEqual(calls, [['status', agent, 'running'], ['error', agent, error]])
  } finally {
    MethodologyCandidateRuntime.prototype.handleAgentStatus = originalStatus
    MethodologyCandidateRuntime.prototype.handleAgentError = originalError
  }
})

test('failed methodology generation leaves queued/running and cannot finalize on idle', async () => {
  let finalized = false
  const runtime = new MethodologyCandidateRuntime({}, async () => { finalized = true })
  const job = { status: 'queued' }
  runtime.jobs.set('session-1', job)
  const agent = { session: { id: 'session-1' } }
  runtime.handleAgentStatus(agent, 'running')
  assert.equal(job.status, 'running')
  runtime.handleAgentError(agent, new Error('MISSING_CREDENTIAL'))
  runtime.handleAgentStatus(agent, 'idle')
  assert.equal(job.status, 'failed')
  assert.match(job.error, /MISSING_CREDENTIAL/)
  assert.equal(finalized, false)
})

test('job view retains a live failure instead of replacing it with the pending disk task', async () => {
  const dataRoot = path.resolve('methodology-status-test')
  const runtime = new MethodologyCandidateRuntime({}, async () => ({ items: [{ status: 'pending', task_path: 'task.json' }] }))
  runtime.latest.set(dataRoot, { status: 'failed', sessionId: 'failed-session', assetIds: ['asset-1'], task: { task_path: 'task.json' }, error: 'MISSING_CREDENTIAL' })
  const job = await runtime.job(dataRoot, dataRoot)
  assert.equal(job.status, 'failed')
  assert.equal(job.error, 'MISSING_CREDENTIAL')
})

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
        task_id: 'methodology-1', status: derivationStatus,
        created_at: '2026-08-30T00:00:00+08:00', completed_at: null,
        source_asset_ids: ['asset-1'], task_path: taskPath,
      }] }
    }
    if (args[0] === 'methodologies' && args[1] === 'derive') {
      derivationStatus = 'pending'
      return { execution: 'direct-skill', task: { task_id: 'methodology-1', task_path: taskPath } }
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
    assert.match(prompts[0].content[0].text, /methodology-1[\\/]task\.json/)
    assert.match(prompts[0].content[0].text, /不要创建 action、绑定器或 settle/)
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
