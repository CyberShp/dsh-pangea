import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { mkdir, open, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'

const context = new AsyncLocalStorage()
const active = new Map()
export const repositoryOperationSignal = () => context.getStore()?.signal
export const repositoryOperationsBusy = () => active.size > 0
export async function stopRepositoryOperations() {
  const operations = [...active.values()]
  for (const operation of operations) operation.controller.abort(new Error('仓库操作已停止'))
  await Promise.allSettled(operations.map(operation => operation.done))
}
export async function cancelRepositoryOperation(dataRoot, repoId) {
  const operation = active.get(path.resolve(dataRoot) + '\0' + repoId)
  if (operation) { operation.controller.abort(new Error('用户停止仓库操作')); await operation.done.catch(() => {}) }
  return { cancelled: Boolean(operation) }
}
// Separate from Git's index.lock: protects application transactions, not Git internals.
export async function repositoryOperation(dataRoot, repoId, callback, { wait = false, signal } = {}) {
  const key = path.resolve(dataRoot) + '\0' + repoId
  while (wait && active.has(key)) {
    signal?.throwIfAborted()
    const previous = active.get(key).done
    let cancel
    try {
      await Promise.race([previous.catch(() => {}), new Promise((_, reject) => {
        cancel = () => reject(signal.reason)
        signal?.addEventListener('abort', cancel, { once: true })
      })])
    } finally { signal?.removeEventListener('abort', cancel) }
  }
  signal?.throwIfAborted()
  if (active.has(key)) throw Object.assign(new Error('此仓库正在导入或修改，请稍后重试'), { statusCode: 409 })
  const controller = new AbortController(), operation = { controller, done: null }
  active.set(key, operation)
  const operationSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  operation.done = context.run({ signal: operationSignal }, async () => {
    const directory = path.join(dataRoot, '.pangea', 'repository-locks')
    const file = path.join(directory, createHash('sha256').update(repoId).digest('hex') + '.lock')
    await mkdir(directory, { recursive: true })
    let handle
    try { handle = await open(file, 'wx') }
    catch (error) {
      if (error.code !== 'EEXIST') throw error
      let owner
      try { owner = JSON.parse(await readFile(file, 'utf8')) } catch {}
      let dead = false
      if (Number.isInteger(owner?.pid) && owner.pid > 0) {
        try { process.kill(owner.pid, 0) } catch (reason) { dead = reason.code === 'ESRCH' }
      }
      if (!dead) throw Object.assign(new Error('另一进程正在修改此仓库，请稍后重试'), { statusCode: 409 })
      await unlink(file); handle = await open(file, 'wx')
    }
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, repo_id: repoId }))
      operationSignal.throwIfAborted()
      return await callback(operationSignal)
    } finally { await handle.close(); await unlink(file) }
  })
  try { return await operation.done } finally { active.delete(key) }
}
