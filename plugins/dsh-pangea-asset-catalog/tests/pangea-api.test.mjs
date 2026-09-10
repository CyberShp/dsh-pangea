import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { AssetActionRuntime, dataRootFor, runPangea } from '../src/pangea-api.js'
import { apply } from '../src/index.js'

test('real Windows Python preserves Chinese asset titles and error messages', { skip: !process.env.PANGEA_TEST_PYTHON }, async () => {
  const root = await workspace()
  const previousPython = process.env.PANGEA_PYTHON
  const previousUtf8 = process.env.PYTHONUTF8
  process.env.PANGEA_PYTHON = process.env.PANGEA_TEST_PYTHON
  process.env.PYTHONUTF8 = '0'
  try {
    const source = path.join(root, '中文资料.md')
    await writeFile(source, '# 资产内容\n边界检查\n', 'utf8')
    const args = ['assets', 'import', '--data-root', path.join(root, 'data'), '--path', source, '--type', 'reference', '--title', '中文标题验收']
    await runPangea({ cwd: root, args })
    const listed = await runPangea({ cwd: root, args: ['assets', 'list', '--data-root', path.join(root, 'data')] })
    assert.equal(listed.items[0].title, '中文标题验收')
    await assert.rejects(runPangea({ cwd: root, args }), /重复资产/)
    const broken = path.join(root, 'broken.xlsx')
    await writeFile(broken, 'not a workbook')
    await assert.rejects(runPangea({ cwd: root, args: ['assets', 'import', '--data-root', path.join(root, 'data'), '--path', broken, '--type', 'coverage'] }))
    const failed = await runPangea({ cwd: root, args: ['assets', 'list', '--data-root', path.join(root, 'data'), '--status', 'failed'] })
    let route, response
    await apply({ on: () => () => {}, tools: { register: () => () => {} }, apiProxy: {}, webServer: { register(value) { route = value; return () => {} } } })
    await route.handler({ method: 'GET', headers: { 'sec-fetch-site': 'same-origin' }, url: `/api/pangea-asset-catalog/state?${new URLSearchParams({ cwd: root, data_root: path.join(root, 'data'), asset_id: failed.items[0].asset_id })}` }, { writeHead() {}, end(body) { response = JSON.parse(body) } })
    assert.equal(response.failure_record?.asset_id, failed.items[0].asset_id)
    assert.match(response.failure_record.last_error, /zip/i)
  } finally {
    if (previousPython === undefined) delete process.env.PANGEA_PYTHON; else process.env.PANGEA_PYTHON = previousPython
    if (previousUtf8 === undefined) delete process.env.PYTHONUTF8; else process.env.PYTHONUTF8 = previousUtf8
    await rm(root, { recursive: true, force: true })
  }
})

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
