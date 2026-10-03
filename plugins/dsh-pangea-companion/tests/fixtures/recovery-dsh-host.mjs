// Runs the actual Cordis Jobs registry and Desktop's patched ACP provider in a
// disposable process so integration tests can crash the host without mocks.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { appendFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createSourceFirstAcpRun, inspectSourceFirstAcpRecovery } from '../../src/source-first-acp.js'
import { runPangea } from '../../src/pangea-api.js'

const configPath = process.argv[2]
const config = JSON.parse(await readFile(configPath, 'utf8'))
const fromApp = relative => import(pathToFileURL(path.join(process.env.PANGEA_TEST_APP_ROOT, 'node_modules', relative)).href)
const [{ Context }, { LocalSubprocessRuntime }, { LocalJobRegistry }, acp] = await Promise.all([
  fromApp('@deepseek-ai/cordis/lib/index.js'), fromApp('@deepseek-ai/dsh-subprocess-local/lib/index.js'),
  fromApp('@deepseek-ai/dsh-jobs-local/lib/index.js'), fromApp('@deepseek-ai/dsh-subagent-acp/lib/index.js'),
])
const audit = event => appendFile(config.auditPath, `${JSON.stringify({ ...event, pid: process.pid, at: Date.now() })}\n`)
const binding = { dataRoot: config.dataRoot, runId: config.runId }
if (process.argv.includes('--resume')) {
  const inspection = await inspectSourceFirstAcpRecovery(binding)
  await audit({ event: 'recovery_inspection', ...inspection })
  if (!inspection.can_resume) { process.stdout.write(JSON.stringify(inspection)); process.exit(3) }
  await runPangea({ cwd: config.cwd, args: ['runs', 'resume', '--data-root', config.dataRoot, '--run-id', config.runId, '--host-quiescent'] })
}

const context = new Context()
const owner = { id: randomUUID(), ctx: context, session: { header: { cwd: config.cwd } } }
context.provide('agents', { get: id => id === owner.id ? owner : undefined })
const subprocess = new LocalSubprocessRuntime(context)
const providers = new Map()
acp.apply({ subprocess, logger: { warn() {}, error() {} }, subagents: { registerProvider(provider) { providers.set(provider.name, provider) } } }, acp.Config({
  providerName: 'pangea-recovery-fixture', command: process.execPath,
  args: [fileURLToPath(new URL('./recovery-acp-peer.mjs', import.meta.url))], cwd: config.cwd,
  env: { PANGEA_TEST_APP_ROOT: process.env.PANGEA_TEST_APP_ROOT, PANGEA_RECOVERY_FIXTURE_CONFIG: configPath,
    PANGEA_PYTHON: process.env.PANGEA_PYTHON, PYTHONPATH: process.env.PYTHONPATH ?? '' },
  disposeEofGraceMs: 100, disposeGraceMs: 100,
}))
const subagents = { start: (name, request) => providers.get(name).start(request) }
const jobs = new LocalJobRegistry(context, { maxConcurrentJobsPerOwner: 10 })
const detach = jobs.attachController('recovery-integration')
const controller = new AbortController()
let run
const options = { ...binding, cwd: config.cwd, providerId: 'pangea-recovery-fixture', parent: owner,
  subagents, signal: controller.signal, runner: runPangea, attemptId: owner.id,
  onEvent: event => audit({ event: 'host_event', ...event }) }
try {
  const jobId = jobs.start({ owner, kind: 'subagent', label: 'Owned recovery fixture', run: () => {
    run = createSourceFirstAcpRun(options)
    assert.throws(() => createSourceFirstAcpRun(options), /当前 Run 已由宿主执行/)
    return { cancel: reason => controller.abort(reason), readOutput: () => run.readOutput(), done: run.result.then(result => ({
      status: result.attentionRequired ? 'failed' : 'completed', output: result.output,
      ...(result.attentionRequired ? { detail: JSON.stringify(result) } : {}),
    }), error => ({ status: 'failed', detail: error.stack ?? String(error) })) }
  } })
  await audit({ event: 'host_started', jobId, ownerSessionId: owner.id })
  const snapshot = await jobs.wait(jobId, 180_000, owner)
  await audit({ event: 'job_settled', snapshot })
  process.stdout.write(`${JSON.stringify(snapshot)}\n`)
  if (snapshot.status !== 'completed') process.exitCode = 1
} finally {
  controller.abort()
  await run?.dispose()
  await jobs.disposeAll()
  detach()
  await context.fiber.dispose()
}
