import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
const { validatePreviewRoot, stopOwnedChild, createVerificationExit, rendererErrorListeners } = createRequire(import.meta.url)('../scripts/drawers-verification-support.cjs')
test('cleanup accepts only startup-owned preview names directly within the temp directory', () => {
  const root = path.resolve('temporary-fixtures')
  assert.equal(validatePreviewRoot(path.join(root, 'pangea-ui-preview-abc123'), root), path.join(root, 'pangea-ui-preview-abc123'))
  for (const value of [root, path.join(root, 'unrelated'), path.join(root, 'sub', 'pangea-ui-preview-abc123'), '../pangea-ui-preview-abc123']) assert.throws(() => validatePreviewRoot(value, root))
})
const child = kill => { const value = new EventEmitter(); Object.assign(value, { pid: 123, exitCode: null, signalCode: null }); value.kill = signal => kill(value, signal); return value }
test('owned process cleanup waits for exit before resolving', async () => {
  let exited = false
  const process = child((value, signal) => { assert.equal(signal, 'SIGTERM'); setTimeout(() => { exited = true; value.exitCode = 0; value.emit('exit', 0) }, 5) })
  await stopOwnedChild(process, { timeout: 100 }); assert.equal(exited, true); assert.equal(process.listenerCount('exit'), 0)
})
test('cleanup escalates only its owned process and bounds an unresponsive child', async () => {
  const signals = []
  const process = child((value, signal) => { signals.push(signal); if (signal === 'SIGKILL') { value.signalCode = signal; value.emit('exit', null, signal) } })
  await stopOwnedChild(process, { timeout: 2, forceTimeout: 2 }); assert.deepEqual(signals, ['SIGTERM', 'SIGKILL'])
  await assert.rejects(stopOwnedChild(child(() => {}), { timeout: 2, forceTimeout: 2 }), /did not exit/)
  await stopOwnedChild({ pid: undefined })
})
test('renderer listeners survive reinstall and errors accumulate across scene documents', () => {
  const cumulative = []
  const document = () => { const handlers = {}; const window = { addEventListener: (type, callback) => { (handlers[type] ??= []).push(callback) } }; return { window, handlers, context: vm.createContext({ window }) } }
  const first = document(); vm.runInContext(rendererErrorListeners, first.context); vm.runInContext(rendererErrorListeners, first.context)
  assert.equal(first.handlers.error.length, 1)
  first.handlers.error[0]({ message: 'scene complete error' }); cumulative.push(...first.window.__verificationErrors.splice(0))
  const second = document(); vm.runInContext(rendererErrorListeners, second.context); second.handlers.unhandledrejection[0]({ reason: 'scene zero rejection' }); cumulative.push(...second.window.__verificationErrors.splice(0))
  assert.deepEqual(cumulative, ['scene complete error', 'scene zero rejection'])
})

test('Windows requires caller-owned fresh profile; existing or generic directories are rejected', async () => {
  const { prepareIsolatedProfile } = createRequire(import.meta.url)('../scripts/drawers-verification-support.cjs')
  const { mkdtemp, readFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const root = await mkdtemp(path.join(tmpdir(), 'profile-test-'))
  try {
    assert.throws(() => prepareIsolatedProfile(undefined, 'win32'), /requires --profile/)
    assert.throws(() => prepareIsolatedProfile(path.join(root, 'generic'), 'win32'), /absolute, new/)
    const requested = path.join(root, 'pangea-drawers-electron-test')
    const result = prepareIsolatedProfile(requested, 'win32')
    assert.equal(result.directory, requested); assert.equal(result.callerCleanup, true)
    assert.equal(await readFile(path.join(requested, '.pangea-ui-verification-profile'), 'utf8'), 'isolated-drawers-verification\n')
    assert.throws(() => prepareIsolatedProfile(requested, 'win32'), /EEXIST/)
  } finally { await rm(root, { recursive: true, force: true }) }
})


test('closing the last verification window preserves failure status until async cleanup finishes', async () => {
  const app = new EventEmitter(), exits = []
  app.exit = code => exits.push(code)
  const exit = createVerificationExit(app)
  let releaseCleanup
  const cleanupPending = new Promise(resolve => { releaseCleanup = resolve })
  const result = exit(1, async () => {
    // Model Electron's implicit status-0 quit when no window-all-closed listener exists.
    if (!app.emit('window-all-closed')) app.exit(0)
    await cleanupPending
  })
  assert.deepEqual(exits, [])
  releaseCleanup(); await result
  assert.deepEqual(exits, [1])
  await exit(0, async () => { throw new Error('must not run cleanup twice') })
  assert.deepEqual(exits, [1])
})

test('successful verification exits zero only after cleanup and cleanup failure exits one', async () => {
  const goodApp = new EventEmitter(), order = []
  goodApp.exit = code => order.push(['exit', code])
  await createVerificationExit(goodApp)(0, async () => { order.push(['cleanup']); await Promise.resolve() })
  assert.deepEqual(order, [['cleanup'], ['exit', 0]])
  const badApp = new EventEmitter(), failures = [], exits = []
  badApp.exit = code => exits.push(code)
  const error = new Error('locked profile')
  await createVerificationExit(badApp, value => failures.push(value))(0, async () => { throw error })
  assert.deepEqual(exits, [1]); assert.deepEqual(failures, [error])
})
