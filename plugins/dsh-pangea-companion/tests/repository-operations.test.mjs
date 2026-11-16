import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { repositoryOperation, repositoryOperationsBusy, stopRepositoryOperations } from '../src/repositories/operations.js'
test('repository mutation lock rejects overlap and update cancellation drains it', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'repo-lock-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let entered
  const ready = new Promise(resolve => { entered = resolve })
  const operation = repositoryOperation(root, 'repo', signal => new Promise((resolve, reject) => { entered(); signal.addEventListener('abort', () => reject(signal.reason), { once: true }) }))
  const rejected = assert.rejects(operation, /停止/)
  await ready
  assert.equal(repositoryOperationsBusy(), true)
  await assert.rejects(repositoryOperation(root, 'repo', () => {}), /正在导入或修改/)
  await stopRepositoryOperations(); await rejected
  assert.equal(repositoryOperationsBusy(), false)
  assert.equal(await repositoryOperation(root, 'repo', () => 'reusable'), 'reusable')
})
