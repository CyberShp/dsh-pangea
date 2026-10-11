// Explicit integration gate, excluded from fast *.test.mjs checks.
// PANGEA_TEST_APP_ROOT must contain the Desktop-pinned DSH dependencies with its
// checked-in ACP/subprocess patches. PANGEA_PYTHON must have pangea-agent installed.
// No NGA or model credentials are used. All terminated processes are our fixtures.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRun, runPangea } from '../src/pangea-api.js'
import { inspectSourceFirstAcpRecovery } from '../src/source-first-acp.js'

if (!process.env.PANGEA_TEST_APP_ROOT || !process.env.PANGEA_PYTHON) throw new Error('PANGEA_TEST_APP_ROOT and PANGEA_PYTHON are required for real DSH/ACP/Graph recovery tests')
const hostFixture = fileURLToPath(new URL('./fixtures/recovery-dsh-host.mjs', import.meta.url))
const json = async filename => JSON.parse(await readFile(filename, 'utf8'))
const events = async config => {
  try { return (await readFile(config.auditPath, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)) }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
}
async function until(check, detail, timeout = 60_000) {
  const deadline = Date.now() + timeout
  do { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 30)) } while (Date.now() < deadline)
  throw new Error(`Timed out waiting for ${detail}`)
}
function startHost(config, resume = false) {
  const child = spawn(process.execPath, [hostFixture, config.configPath, ...(resume ? ['--resume'] : [])], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
  let output = '', errors = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { errors += chunk })
  const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal, output, errors })) })
  return { child, done }
}
async function setup(t, failure) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pangea-real-recovery-'))
  let setupComplete = false
  t.after(() => { if (!setupComplete) return rm(cwd, { recursive: true, force: true }) })
  await mkdir(path.join(cwd, '.agents/pangea'), { recursive: true })
  await writeFile(path.join(cwd, '.agents/pangea/dsh.md'), '# Controlled recovery fixture')
  const dataRoot = path.join(cwd, 'pangea-data')
  const repository = path.join(dataRoot, 'repositories/sample')
  await mkdir(repository, { recursive: true })
  await writeFile(path.join(repository, 'tls.c'), 'int tls_connect(int enabled) { return enabled ? 0 : -1; }\n')
  const created = await createRun(cwd, { repository: 'sample', target: 'TLS recovery fixture', source_scope: ['tls.c'], mode: 'speed', effective_context_budget: 204800 })
  const config = { cwd, dataRoot, runId: created.run_id, failure, auditPath: path.join(cwd, 'audit.jsonl'), injectedPath: path.join(cwd, 'injected'), cleanupPath: path.join(cwd, 'cleanup'), configPath: path.join(cwd, 'fixture.json') }
  await writeFile(config.configPath, JSON.stringify(config))
  const hosts = []
  const launch = resume => { const host = startHost(config, resume); hosts.push(host); return host }
  t.after(async () => {
    for (const host of hosts) if (host.child.exitCode === null && host.child.signalCode === null) host.child.kill('SIGKILL')
    await Promise.all(hosts.map(host => host.done))
    // Orphans watch a unique fixture file; never terminate historical PIDs that
    // might have been recycled for another process after the test completed.
    await writeFile(config.cleanupPath, 'stop owned fixture peers')
    await new Promise(resolve => setTimeout(resolve, 150))
    await rm(cwd, { recursive: true, force: true })
  })
  setupComplete = true
  return { config, launch }
}

test('real ACP protocol preserves read/edit/execute kinds across interleaved updates and resets each turn', { timeout: 30_000 }, async t => {
  const { config } = await setup(t, 'transport-probe')
  const fromApp = relative => import(pathToFileURL(path.join(process.env.PANGEA_TEST_APP_ROOT, 'node_modules', relative)).href)
  const [{ Context }, { LocalSubprocessRuntime }, acp] = await Promise.all([
    fromApp('@deepseek-ai/cordis/lib/index.js'), fromApp('@deepseek-ai/dsh-subprocess-local/lib/index.js'), fromApp('@deepseek-ai/dsh-subagent-acp/lib/index.js'),
  ])
  const context = new Context()
  let provider, run
  const observed = []
  acp.apply({ subprocess: new LocalSubprocessRuntime(context), logger: { warn() {}, error() {} }, subagents: { registerProvider(value) { provider = value } } }, acp.Config({
    providerName: 'recovery-kind-probe', command: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/recovery-acp-peer.mjs', import.meta.url))], cwd: config.cwd,
    env: { PANGEA_TEST_APP_ROOT: process.env.PANGEA_TEST_APP_ROOT, PANGEA_RECOVERY_FIXTURE_CONFIG: config.configPath },
    disposeEofGraceMs: 100, disposeGraceMs: 100,
  }))
  try {
    run = await provider.start({ prompt: [{ type: 'text', text: 'PROBE_TOOL_KINDS' }], scratchDirectory: path.join(config.cwd, 'scratch'),
      parent: { session: { header: { cwd: config.cwd } } }, signal: new AbortController().signal,
      onDiagnostic: event => { if (event.stage === 'tool_event') observed.push([event.lastToolId, event.lastToolKind, event.lastToolStatus]) },
    })
    assert.equal((await run.result).stopReason, 'completed')
    assert.deepEqual(observed, [
      ['read-1', 'read', 'in_progress'], ['edit-1', 'edit', 'in_progress'], ['execute-1', 'execute', 'in_progress'],
      ['read-1', 'read', 'completed'], ['execute-1', 'execute', 'completed'], ['edit-1', 'edit', 'completed'],
    ])
    assert.equal((await run.continuePrompt([{ type: 'text', text: 'NO_TOOLS' }])).stopReason, 'completed')
    assert.equal(run.readDiagnostics().lastToolKind, null)
  } finally { await run?.dispose(); await context.fiber.dispose() }
})
async function assertCompletedWithoutDuplicateWork(config, actionId) {
  const history = await events(config)
  const saved = history.filter(event => event.event === 'result_saved' && event.actionId === actionId)
  const finished = history.filter(event => event.event === 'work_finished' && event.actionId === actionId)
  assert.equal(saved.length, 1, 'the recovered action must retain its saved revision instead of repeating result-write')
  assert.equal(finished.length, 1, 'one saved revision has one completion declaration')
  assert.equal(history.filter(event => event.event === 'host_event' && event.stage === 'source_first_action_settled' && event.action_id === actionId).length, 1)
  const state = await runPangea({ cwd: config.cwd, args: ['runs', 'get', '--data-root', config.dataRoot, '--run-id', config.runId] })
  assert.equal(state.lifecycle_status, 'complete')
  const bindings = await json(path.join(config.dataRoot, 'runs', config.runId, 'acp-workers.json'))
  assert.equal(Object.keys(bindings.workers).length, 3)
  assert.equal(history.filter(event => event.event === 'new_session').length, 3, 'planning/analysis/review each retain one logical ACP session')
  assert.equal(history.filter(event => event.event === 'job_settled' && event.snapshot.status === 'completed').length, 1)
  return history
}

test('real ACP disconnect after work-finish settles the saved revision without a second analysis prompt', { timeout: 180_000 }, async t => {
  const { config, launch } = await setup(t, 'peer-after-finish')
  const result = await launch(false).done
  assert.equal(result.code, 0, `${result.errors}\n${result.output}`)
  const checkpoint = (await events(config)).find(event => event.event === 'checkpoint')
  assert.ok(checkpoint)
  const history = await assertCompletedWithoutDuplicateWork(config, checkpoint.actionId)
  assert.equal(history.filter(event => event.event === 'action_prompt' && event.actionId === checkpoint.actionId).length, 1)
  assert.equal(history.filter(event => event.event === 'load_session').length, 0)
})

test('real host restart blocks a live orphan, then restores its exact ACP session and saved result once', { timeout: 180_000 }, async t => {
  const { config, launch } = await setup(t, 'host-after-save')
  const original = launch(false)
  let originalOutcome
  original.done.then(value => { originalOutcome = value })
  const checkpoint = await until(async () => {
    if (originalOutcome) throw new Error(`Host exited before checkpoint: ${originalOutcome.errors}\n${originalOutcome.output}`)
    return (await events(config)).find(event => event.event === 'checkpoint')
  }, 'saved analysis checkpoint')
  original.child.kill('SIGKILL')
  assert.equal((await original.done).signal, 'SIGKILL')
  const recovery = { dataRoot: config.dataRoot, runId: config.runId }
  const blocked = await inspectSourceFirstAcpRecovery(recovery)
  assert.equal(blocked.can_resume, false)
  const rejected = await launch(true).done
  assert.equal(rejected.code, 3, `${rejected.errors}\n${rejected.output}`)
  assert.equal((await events(config)).filter(event => event.event === 'new_session').length, 2)
  // The exact child PID came from this run's controlled peer, never a persisted
  // production binding or an arbitrary system process.
  process.kill(checkpoint.pid, 'SIGKILL')
  await until(async () => (await inspectSourceFirstAcpRecovery(recovery)).can_resume, 'owned worker exit and safe recovery')
  const resumed = await launch(true).done
  assert.equal(resumed.code, 0, `${resumed.errors}\n${resumed.output}`)
  const history = await assertCompletedWithoutDuplicateWork(config, checkpoint.actionId)
  const restored = history.filter(event => event.event === 'load_session')
  assert.equal(restored.length, 1)
  assert.equal(restored[0].sessionId, checkpoint.sessionId)
  const prompts = history.filter(event => event.event === 'action_prompt' && event.actionId === checkpoint.actionId)
  assert.equal(prompts.length, 2)
  assert.ok(prompts.every(event => event.sessionId === checkpoint.sessionId))
})
