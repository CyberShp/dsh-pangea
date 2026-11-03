const path = require('node:path')
const os = require('node:os')
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs')
function prepareIsolatedProfile(requested, platform = process.platform) {
  if (platform === 'win32' && !requested) throw new Error('Windows UI verification requires --profile; the caller must remove it after Electron exits')
  if (requested && (!path.isAbsolute(requested) || !/^pangea-drawers-electron-[a-zA-Z0-9-]+$/.test(path.basename(requested)))) throw new Error('--profile must be an absolute, new pangea-drawers-electron-* directory')
  const directory = requested ? path.resolve(requested) : mkdtempSync(path.join(os.tmpdir(), 'pangea-drawers-electron-'))
  if (requested) mkdirSync(directory) // EEXIST is intentional: never reuse an existing profile.
  writeFileSync(path.join(directory, '.pangea-ui-verification-profile'), 'isolated-drawers-verification\n', { flag: 'wx' })
  return { directory, callerCleanup: Boolean(requested) }
}
function validatePreviewRoot(value, temporaryDirectory = os.tmpdir()) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Preview returned an invalid temporary dataRoot')
  const resolved = path.resolve(value)
  const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value
  if (normalize(path.dirname(resolved)) !== normalize(path.resolve(temporaryDirectory)) || !/^pangea-ui-preview-[a-zA-Z0-9]+$/.test(path.basename(resolved))) throw new Error('Preview dataRoot is outside its expected temporary-directory scope')
  return resolved
}
async function stopOwnedChild(child, { timeout = 5000, forceTimeout = 2000 } = {}) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
  const waitForExit = async (signal, milliseconds) => new Promise((resolve, reject) => {
    let timer
    const cleanup = () => { clearTimeout(timer); child.removeListener('exit', exited); child.removeListener('error', failed) }
    const exited = () => { cleanup(); resolve(true) }
    const failed = error => { cleanup(); reject(error) }
    child.once('exit', exited); child.once('error', failed)
    timer = setTimeout(() => { cleanup(); resolve(false) }, milliseconds)
    try { child.kill(signal) } catch (error) { failed(error) }
  })
  if (await waitForExit('SIGTERM', timeout)) return
  if (child.exitCode !== null || child.signalCode !== null) return
  if (!await waitForExit('SIGKILL', forceTimeout)) throw new Error('Owned preview process did not exit; temporary dataRoot retained to avoid deleting live files')
}
const rendererErrorListeners = `(() => {
  window.__verificationErrors ||= [];
  if (!window.__verificationErrorListenersInstalled) {
    window.__verificationErrorListenersInstalled = true;
    window.addEventListener('error', event => window.__verificationErrors.push(event.message));
    window.addEventListener('unhandledrejection', event => window.__verificationErrors.push(String(event.reason)));
  }
})()`
module.exports = { prepareIsolatedProfile, validatePreviewRoot, stopOwnedChild, rendererErrorListeners }
