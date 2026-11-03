// Runs real shipped React components in Electron's Chromium against isolated fixtures.
// Invoke with the Desktop's existing Electron binary. No additional dependency/model.
const { app, BrowserWindow } = require('electron')
const { spawn } = require('node:child_process')
const { mkdir, writeFile, rm, lstat } = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { prepareIsolatedProfile, validatePreviewRoot, stopOwnedChild, rendererErrorListeners } = require('./drawers-verification-support.cjs')
const assert = require('node:assert/strict')
const option = (name, fallback) => { const at = process.argv.indexOf(name); return at < 0 ? fallback : process.argv[at + 1] }
let profile
try { profile = prepareIsolatedProfile(option('--profile')) }
catch (error) { console.error(error); app.exit(1); return }
const isolatedProfile = profile.directory
app.setPath('userData', isolatedProfile)
const plugin = path.resolve(__dirname, '..')
const desktop = path.resolve(option('--desktop', path.join(plugin, '../../../pangea-desktop')))
const agent = path.resolve(option('--agent', path.join(desktop, '../pangea-agent')))
const output = path.resolve(option('--output', path.join(desktop, '.pangea-build/drawers-timeline-ui')))
let server, window, previewRoot, rendererDocumentLoaded = false, stderr = '', step = 'startup'
const errors = [], checks = []
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function main() {
  await mkdir(output, { recursive: true })
  await app.whenReady()
  // Electron's supported run-as-Node mode avoids requiring a separate Node install.
  server = spawn(path.resolve(option('--node', process.execPath)), [path.join(plugin, 'scripts/preview-ui.mjs'), '--desktop', desktop, '--agent', agent, '--fixture-module', path.join(plugin, 'tests/fixtures/drawers-timeline.mjs')], { cwd: plugin, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  server.stderr.on('data', chunk => { stderr += chunk })
  const url = await new Promise((resolve, reject) => {
    let data = ''
    const timer = setTimeout(() => reject(new Error(`Preview startup timeout: ${stderr}`)), 30000)
    server.on('error', error => { clearTimeout(timer); reject(error) })
    server.on('exit', code => { clearTimeout(timer); reject(new Error(`Preview exited ${code}: ${stderr}`)) })
    server.stdout.on('data', chunk => { data += chunk; for (const line of data.split('\n')) { try { const result = JSON.parse(line); if (result.url) { previewRoot = validatePreviewRoot(result.dataRoot); clearTimeout(timer); resolve(result.url) } } catch (error) { if (!(error instanceof SyntaxError)) { clearTimeout(timer); reject(error) } } } })
  })
  window = new BrowserWindow({ width: 1380, height: 900, useContentSize: true, show: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } })
  window.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message) })
  window.webContents.on('render-process-gone', (_event, details) => errors.push(`Renderer exited: ${JSON.stringify(details)}`))
  const js = source => window.webContents.executeJavaScript(source, true)
  const wait = async (source, label = source) => {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) { if (await js(source)) return; await delay(50) }
    throw new Error(`Timed out waiting for ${label}`)
  }
  const click = async (text, selector = 'button') => {
    step = `click:${text}`
    const query = `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(el => el.textContent.trim() === ${JSON.stringify(text)})`
    await wait(`Boolean(${query})`, `button ${text}`)
    await js(`{const el=(${query});el.focus({preventScroll:true});el.click()}`)
    await delay(80)
  }
  const tab = text => click(text, 'nav[aria-label="PANGEA 分析页面"] button')
  const cases = async () => { await js(`Array.from(document.querySelectorAll('nav[aria-label="PANGEA 分析页面"] button')).find(el => el.textContent.startsWith('测试用例')).click()`); await wait(`!!document.querySelector('.b05-case-table')`) }
  const escape = async () => { window.focus(); window.webContents.focus(); window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await delay(100) }
  const snapshot = async name => { step = name; await writeFile(path.join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG()); checks.push(name); console.log('PASS', name) }
  const scene = async name => {
    await collectRendererErrors()
    await fetch(`${url}/fixture?scene=${name}`)
    rendererDocumentLoaded = false
    await window.loadURL(url)
    rendererDocumentLoaded = true
    await js(rendererErrorListeners)
    await wait(`!!document.querySelector('.b03-overview-status')`)
    await delay(200)
  }
  await scene('complete')
  await cases(); await click('查看可实施性 ↗')
  await wait(`!!document.querySelector('.pangea-feasibility-metrics')`)
  assert.deepEqual(await js(`Array.from(document.querySelectorAll('.pangea-feasibility-metrics strong')).map(el=>el.textContent)`), ['未知', '未知', '未知'])
  await snapshot('feasibility-unknown'); await escape()
  await js(`document.querySelector('.b05-case-table tbody tr button').click()`)
  await click('拟覆盖依据 ↗'); await wait(`!!document.querySelector('.pangea-bottom-drawer')`)
  assert.ok(await js(`document.querySelector('.pangea-bottom-drawer').getBoundingClientRect().y > 200`))
  const fixtureState = await (await fetch(`${url}/api/pangea-companion/state`)).json()
  const { caseEvidenceProjection } = await import(pathToFileURL(path.join(plugin, 'src/case-evidence.js')).href)
  const evidence = caseEvidenceProjection(fixtureState.current.details.test_cases[0], [], fixtureState.current.details.coverage_gaps).items
  const quoteA = evidence.findIndex(item => item.quote === 'distinct quote A'), quoteB = evidence.findIndex(item => item.quote === 'distinct quote B')
  assert.ok(quoteA >= 0 && quoteB >= 0 && quoteA !== quoteB)
  assert.equal(await js(`document.querySelectorAll('.pangea-case-code-links button').length`), evidence.length)
  await js(`document.querySelector('.pangea-bottom-content').scrollTop = 350`)
  const savedScroll = await js(`document.querySelector('.pangea-bottom-content').scrollTop`)
  assert.ok(savedScroll > 0)
  await js(`document.querySelectorAll('.pangea-case-code-links button')[${quoteB}].click()`)
  await wait(`!!document.querySelector('.b05-source-drawer')`)
  assert.match(await js(`document.querySelector('.b05-source-drawer').innerText`), /distinct quote B/)
  assert.equal(await js(`document.querySelectorAll('.pangea-evidence-options button').length`), evidence.length)
  await js(`document.querySelectorAll('.pangea-evidence-options button')[${quoteA}].click()`)
  await wait(`document.querySelector('.b05-source-drawer').innerText.includes('distinct quote A')`)
  await snapshot('source-same-location-distinct-quotes')
  await click('返回拟覆盖依据'); await wait(`!document.querySelector('.b05-source-drawer')`)
  assert.equal(await js(`document.querySelector('.pangea-bottom-content').scrollTop`), savedScroll)
  await snapshot('basis-return-scroll'); await escape()
  assert.equal(await js(`!!document.querySelector('.pangea-bottom-drawer')`), false)
  assert.equal(await js(`document.activeElement.textContent.trim()`), '拟覆盖依据 ↗')
  checks.push('basis-escape-focus')
  await click('拟覆盖依据 ↗')
  // Programmatic navigation explicitly exercises reset while the drawer is open.
  await click('下一条'); await wait(`!document.querySelector('.pangea-bottom-drawer')`)
  checks.push('case-switch-clears-drawers'); await cases()
  await click('业务行为覆盖看板', 'summary')
  const widths = await js(`Array.from(document.querySelectorAll('.pangea-behavior-column')).map(el=>el.getBoundingClientRect().width)`)
  assert.equal(widths.length, 6); assert.ok(widths.every(width => Math.abs(width - widths[0]) < 1))
  assert.ok(await js(`document.querySelector('.pangea-behavior-columns').scrollWidth > document.querySelector('.pangea-behavior-columns').clientWidth`))
  await js(`document.querySelector('.pangea-behavior-columns').scrollLeft = 400`)
  const boardScroll = await js(`document.querySelector('.pangea-behavior-columns').scrollLeft`)
  assert.ok(boardScroll > 0); await js(`document.querySelector('.pangea-behavior-board').scrollIntoView({block:'start'})`); await snapshot('behavior-equal-unit-columns')
  await js(`document.querySelector('.pangea-behavior-case-links button').click()`); await wait(`!!document.querySelector('.pangea-case-review-actions')`)
  await js(`document.querySelector('button[aria-label="返回用例"]').click()`)
  await wait(`document.querySelector('.pangea-behavior-columns')?.scrollLeft === ${boardScroll}`)
  checks.push('board-return-scroll')
  await scene('zero'); await cases(); await click('查看可实施性 ↗')
  await wait(`!!document.querySelector('.pangea-feasibility-metrics')`)
  assert.deepEqual(await js(`Array.from(document.querySelectorAll('.pangea-feasibility-metrics strong')).map(el=>el.textContent)`), ['0', '0', '0.0%'])
  await snapshot('feasibility-explicit-zero'); await escape()
  await tab('运行过程'); await click('执行详情与 Agent 会话', 'summary')
  await wait(`!!document.querySelector('.pangea-execution-timeline')`)
  assert.equal(await js(`document.querySelectorAll('.pangea-timeline-segment.running').length`), 1)
  assert.equal(await js(`document.querySelectorAll('.pangea-timeline-segment.paused').length`), 1)
  assert.match(await js(`document.querySelector('.pangea-timeline-unknown').innerText`), /action-unknown.*起止未知/)
  await js(`document.querySelector('.pangea-execution-timeline').scrollIntoView({block:'center'})`); await snapshot('timeline-live-paused-unknown')
  await js(`document.querySelector('.pangea-timeline-segment.running').click()`)
  await wait(`document.querySelector('.agent-session-transcript')?.innerText.includes('LIVE EXECUTION ONLY')`)
  assert.doesNotMatch(await js(`document.querySelector('.agent-session-transcript').innerText`), /PAUSED EXECUTION ONLY/)
  assert.match(await js(`document.querySelector('.agent-session-alert').innerText`), /live-1/)
  await snapshot('timeline-original-session-execution-filter')
  await click('显示整个会话'); await wait(`document.querySelector('.agent-session-transcript')?.innerText.includes('PAUSED EXECUTION ONLY')`); await escape()
  for (const width of [900, 1280, 1920]) {
    window.setContentSize(width, 900); await cases(); await delay(100)
    assert.equal(await js(`document.querySelector('#app').scrollWidth > document.querySelector('#app').clientWidth + 2`), false, `overflow at ${width}`)
    await snapshot(`responsive-${width}`)
  }
  await collectRendererErrors()
  assert.deepEqual(errors, [])
  await writeFile(path.join(output, 'verification.json'), JSON.stringify({ type: 'synthetic shipped React/Electron Chromium UI verification; no model execution', platform: process.platform, profile: { path: isolatedProfile, cleanup: profile.callerCleanup ? 'required-after-electron-exit-by-caller' : 'runner-owned' }, electron: process.versions.electron, chromium: process.versions.chrome, checks, errors }, null, 2))
  await Promise.all(['failure.txt', 'failure.png'].map(name => rm(path.join(output, name), { force: true })))
  console.log('COMPLETE', checks.length)
}
main().then(() => finish(0), async error => {
  try {
    await mkdir(output, { recursive: true })
    await collectRendererErrors()
    if (window && !window.isDestroyed()) await writeFile(path.join(output, 'failure.png'), (await window.webContents.capturePage()).toPNG())
    const body = window && !window.isDestroyed() ? await window.webContents.executeJavaScript('document.body.innerText').catch(() => '') : ''
    await writeFile(path.join(output, 'failure.txt'), `step=${step}\n${error.stack}\n${stderr}\n${body}\n${JSON.stringify(errors)}`)
  } catch (failure) { console.error('Failed to write diagnostics:', failure) }
  console.error(error); finish(1)
})
async function collectRendererErrors() {
  if (!rendererDocumentLoaded || !window || window.isDestroyed()) return
  errors.push(...await window.webContents.executeJavaScript('window.__verificationErrors?.splice(0) || []').catch(error => [`Error collection failed: ${error.message}`]))
}
async function finish(code) {
  try {
    await stopOwnedChild(server)
    if (previewRoot) {
      const info = await lstat(previewRoot).catch(error => { if (error.code === 'ENOENT') return null; throw error })
      if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error('Preview dataRoot changed type; refusing cleanup')
      await rm(previewRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  } catch (error) { console.error(`Preview cleanup failed: ${error.message}`); code = 1 }
  if (window && !window.isDestroyed()) window.destroy()
  if (profile.callerCleanup) {
    console.log(`PROFILE_CLEANUP_REQUIRED_AFTER_EXIT ${isolatedProfile}`)
  } else try { await rm(isolatedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
  catch (error) { console.error(`Temporary verification profile cleanup failed: ${error.message}`); code = 1 }
  app.exit(code)
}
