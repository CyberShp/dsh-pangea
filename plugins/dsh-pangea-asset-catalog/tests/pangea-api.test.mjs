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

test('asset extraction runs the deterministic PANGEA command without a DSH session', async () => {
  const root = await workspace()
  const calls = []
  const runner = async input => {
    calls.push(input.args)
    return { asset: { asset_id: 'asset-1', title: '历史缺陷', status: 'available' } }
  }
  try {
    const dataRoot = path.join(root, 'pangea-data')
    const runtime = new AssetActionRuntime({}, runner)
    const started = await runtime.start({ cwd: root, dataRoot, assetId: 'asset-1' })
    assert.equal(started.completed, true)
    assert.deepEqual(started.asset, { asset_id: 'asset-1', title: '历史缺陷', status: 'available' })
    assert.deepEqual(calls, [[
      'assets', 'extract', '--data-root', dataRoot, '--asset-id', 'asset-1',
    ]])
    assert.equal(runtime.job(dataRoot, 'asset-1').status, 'completed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('coverage extraction can complete without creating a model session', async () => {
  const root = await workspace()
  const runtime = new AssetActionRuntime({}, async () => ({
    asset: { asset_id: 'coverage-1', status: 'available' },
  }))
  try {
    const result = await runtime.start({ cwd: root, assetId: 'coverage-1' })
    assert.equal(result.completed, true)
    assert.equal(dataRootFor(root), path.join(root, 'pangea-data'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('an extraction failure is explicit and is never retried or settled', async () => {
  const root = await workspace()
  let calls = 0
  const runner = async () => {
    calls += 1
    throw new Error('normalized text is required')
  }
  try {
    const dataRoot = path.join(root, 'pangea-data')
    const runtime = new AssetActionRuntime({}, runner)
    await assert.rejects(
      runtime.start({ cwd: root, dataRoot, assetId: 'asset-2' }),
      /normalized text is required/,
    )
    assert.equal(calls, 1)
    const job = runtime.job(dataRoot, 'asset-2')
    assert.equal(job.status, 'failed')
    assert.match(job.error, /normalized text/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
