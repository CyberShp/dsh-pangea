import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { AssetActionRuntime, dataRootFor } from '../src/pangea-api.js'

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-asset-runtime-'))
  await mkdir(path.join(root, '.agents', 'pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents', 'pangea', 'dsh.md'), 'rules\n')
  return root
}

function ok(value) {
  return { result: { ok: true, value } }
}

test('asset extraction binds the real DSH session and settles through the adapter', async () => {
  const root = await workspace()
  const calls = []
  const prompts = []
  const runner = async input => {
    calls.push(input.args)
    if (input.args[0] === 'assets') return {
      asset: { asset_id: 'asset-1', title: '历史缺陷' },
      action: {
        action_id: 'asset:asset-1:extract', action: 'dispatch_agent', role: 'asset_extraction',
        stage: 'structured_extraction', task_path: '/tmp/task.json', task_id: null,
      },
    }
    return { status: 'ok' }
  }
  const api = {
    workspace: { async list() { return ok({ items: [{ path: root, workspaceId: 'workspace-1' }] }) } },
    sessions: {
      async create() { return ok({ sessionId: 'session-1' }) },
      async rename() { return ok({}) },
      async prompt(request) { prompts.push(request.payload); return ok({}) },
    },
  }
  try {
    const runtime = new AssetActionRuntime(api, runner)
    const started = await runtime.start({ cwd: root, assetId: 'asset-1' })
    assert.equal(started.session_id, 'session-1')
    assert.deepEqual(calls[1], [
      'adapter', 'bind', '--data-root', path.join(root, 'pangea-data'), '--asset-id', 'asset-1',
      '--action-id', 'asset:asset-1:extract', '--task-id', 'session-1',
    ])
    assert.match(prompts[0].content[0].text, /asset-extraction-worker\.md/)
    assert.match(prompts[0].content[0].text, /task_path: \/tmp\/task\.json/)

    await runtime.finish(runtime.jobs.get('session-1'))
    assert.equal(calls[2][1], 'validate')
    assert.equal(calls[3][1], 'settle')
    assert.equal(runtime.job(path.join(root, 'pangea-data'), 'asset-1').status, 'completed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('coverage extraction can complete without creating a model session', async () => {
  const root = await workspace()
  const runtime = new AssetActionRuntime({}, async () => ({
    asset: { asset_id: 'coverage-1', status: 'available' }, action: null,
  }))
  try {
    const result = await runtime.start({ cwd: root, assetId: 'coverage-1' })
    assert.equal(result.completed, true)
    assert.equal(dataRootFor(root), path.join(root, 'pangea-data'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('one contract failure returns to the same extraction session before stopping', async () => {
  const root = await workspace()
  let validationCalls = 0
  let promptCalls = 0
  const runner = async ({ args }) => {
    if (args[0] === 'assets') return {
      asset: { asset_id: 'asset-2', title: '设计' },
      action: {
        action_id: 'asset:asset-2:extract', action: 'dispatch_agent', role: 'asset_extraction',
        stage: 'structured_extraction', task_path: '/tmp/task-2.json', task_id: null,
      },
    }
    if (args[1] === 'validate' && validationCalls++ === 0) throw new Error('summary is required')
    return { status: 'ok' }
  }
  const api = {
    workspace: { async list() { return ok({ items: [{ path: root, workspaceId: 'workspace-1' }] }) } },
    sessions: {
      async create() { return ok({ sessionId: 'session-2' }) },
      async rename() { return ok({}) },
      async prompt() { promptCalls += 1; return ok({}) },
    },
  }
  try {
    const runtime = new AssetActionRuntime(api, runner)
    await runtime.start({ cwd: root, assetId: 'asset-2' })
    const job = runtime.jobs.get('session-2')
    await runtime.finish(job)
    assert.equal(job.status, 'queued')
    assert.equal(promptCalls, 2)
    await runtime.finish(job)
    assert.equal(job.status, 'completed')
    assert.equal(validationCalls, 2)
  } finally { await rm(root, { recursive: true, force: true }) }
})
