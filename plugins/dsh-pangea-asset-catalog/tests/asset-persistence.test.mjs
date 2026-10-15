import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

// Use real filesystem calls and Node's default unhandled-rejection behavior in
// a disposable child. No process-level exception handler can mask a crash.
async function childFixture(t, body) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asset-persistence-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const code = `
    import assert from 'node:assert/strict'
    import fs from 'node:fs'
    import path from 'node:path'
    import { syncBuiltinESMExports } from 'node:module'
    const root = ${JSON.stringify(root)}
    const rename = fs.renameSync
    let locked = false, failures = []
    fs.renameSync = (from, to) => {
      if (locked && to.includes(path.join('.pangea', 'asset-jobs'))) {
        const error = Object.assign(new Error('EPERM: asset history rename denied #' + (failures.length + 1)), { code: 'EPERM', syscall: 'rename', path: from, dest: to })
        failures.push(error)
        throw error
      }
      return rename(from, to)
    }
    syncBuiltinESMExports()
    const { AssetActionRuntime } = await import(${JSON.stringify(new URL('../src/pangea-api.js', import.meta.url).href)})
    const tick = () => new Promise(resolve => setImmediate(resolve))
    const ok = value => ({ result: { ok: true, value } })
    fs.mkdirSync(path.join(root, '.agents', 'pangea'), { recursive: true })
    fs.writeFileSync(path.join(root, '.agents', 'pangea', 'dsh.md'), 'isolated rules')
    const dataRoot = path.join(root, 'data')
    const calls = [], cancellations = []
    const api = {
      llm: { providers: async () => ok({ providers: [{ provider: 'configured', declared: true, active: true }] }),
        models: async () => ok({ groups: [{ id: 'configured', models: [{ id: 'model' }] }] }) },
      settings: { describe: async () => ok({ namespaces: [] }) },
      sessions: { create: async () => ok({ sessionId: 'session' }), rename: async () => ok({}),
        selectModel: async () => ok({}), prompt: async () => ok({}),
        cancel: async request => { cancellations.push(request.payload.sessionId); return ok({}) } },
    }
    const runner = async ({ args }) => {
      calls.push(args)
      if (args[0] === 'assets' && args[1] === 'extract') return {
        asset: { asset_id: 'a', title: 'isolated asset', asset_type: 'design', status: 'extracting' },
        action: { action_id: 'asset:a:extract:1', task_path: '/isolated/task.json' },
      }
      if (args[0] === 'assets' && args[1] === 'stop') return { asset: { asset_id: 'a', status: 'imported' } }
      return { asset: { asset_id: 'a', status: 'available' } }
    }
    const request = { cwd: root, dataRoot, assetId: 'a', model: { provider: 'configured', model: 'model' } }
    ${body}
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    encoding: 'utf8', timeout: 10000, env: { ...process.env, NODE_OPTIONS: '' },
  })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.equal(result.status, 0, result.stderr || result.stdout)
}

test('EPERM during background events and idle finalization cannot terminate Node or free the task', async t => {
  await childFixture(t, `
    const runtime = new AssetActionRuntime(api, runner)
    await runtime.start(request)
    const historyFile = runtime.historyPath(dataRoot, 'a')
    const lastSaved = fs.readFileSync(historyFile, 'utf8')
    locked = true
    runtime.handleAgentStatus({ session: { id: 'session' } }, 'running')
    runtime.handleSessionEvent({ id: 'session' }, { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'retained text' } } })
    runtime.handleSessionEvent({ id: 'session' }, { type: 'tool/call', data: { name: 'read' } })
    runtime.handleSessionEvent({ id: 'session' }, { type: 'tool/result', data: {} })
    runtime.handleSessionEvent({ id: 'session' }, { type: 'assistant/message', data: { message: { content: 'saved in memory' } } })
    runtime.handleAgentStatus({ session: { id: 'session' } }, 'idle')
    await tick()
    const value = runtime.job(dataRoot, 'a')
    assert.equal(value.status, 'finalizing')
    assert.match(value.output, /saved in memory/)
    assert.match(value.error, /EPERM/)
    assert.match(value.warning, /运行记录保存失败/)
    for (let attempt = 0; attempt < 10; attempt++) runtime.job(dataRoot, 'a')
    assert.equal(fs.readFileSync(historyFile, 'utf8'), lastSaved)
    assert.deepEqual(fs.readdirSync(path.dirname(historyFile)), [path.basename(historyFile)])
    assert.equal(calls.filter(args => args[1] === 'settle').length, 0)
    assert.equal((await runtime.start(request)).reused, true)
    locked = false
    await runtime.stop(request)
    assert.deepEqual(cancellations, ['session'])
    assert.equal(runtime.job(dataRoot, 'a').status, 'stopped')
    assert.equal(runtime.job(dataRoot, 'a').storage_error, null)
    assert.equal(runtime.saved(dataRoot, 'a').status, 'stopped')
  `)
})

test('initial persistence rejects with the original error and never dispatches work', async t => {
  await childFixture(t, `
    const runtime = new AssetActionRuntime(api, runner)
    locked = true
    await assert.rejects(runtime.start(request), error => error === failures[0])
    assert.equal(calls.length, 0)
    const value = runtime.job(dataRoot, 'a')
    assert.equal(value.status, 'failed')
    assert.match(value.error, /denied #1/)
    assert.ok(failures.length >= 2, 'the secondary error write was also rejected and contained')
  `)
})

test('temporary cleanup errors add diagnostics without replacing the original persistence exception or deleting the target', async t => {
  await childFixture(t, `
    const runtime = new AssetActionRuntime(api, runner)
    const job = { dataRoot, assetId: 'a', status: 'running' }
    runtime.persist(job)
    const historyFile = runtime.historyPath(dataRoot, 'a')
    const lastSaved = fs.readFileSync(historyFile, 'utf8')
    const removals = []
    fs.rmSync = file => { removals.push(file); throw Object.assign(new Error('temporary cleanup denied'), { code: 'EACCES' }) }
    syncBuiltinESMExports()
    locked = true
    assert.throws(() => runtime.persist(job), error => error === failures[0] && error.code === 'EPERM')
    assert.equal(removals.length, 1)
    assert.notEqual(removals[0], historyFile)
    assert.equal(removals[0], failures[0].path)
    assert.equal(fs.readFileSync(historyFile, 'utf8'), lastSaved)
    assert.match(runtime.snapshot(job).storage_error, /EPERM.*临时记录清理失败.*cleanup denied/)
  `)
})

test('a post-prompt save failure retains the running identity and stop still cancels before reporting its save failure', async t => {
  await childFixture(t, `
    api.sessions.prompt = async () => { locked = true; return ok({}) }
    const runtime = new AssetActionRuntime(api, runner)
    await assert.rejects(runtime.start(request), error => error === failures[0])
    const job = [...runtime.jobs.values()][0]
    assert.equal(runtime.job(dataRoot, 'a').status, 'queued')
    assert.equal((await runtime.start(request)).reused, true)
    await assert.rejects(runtime.stop(request), error => error.code === 'EPERM' && error.cause.code === 'EPERM')
    assert.deepEqual(cancellations, ['session'])
    assert.ok(calls.some(args => args[1] === 'stop'))
    assert.equal(runtime.job(dataRoot, 'a').status, 'stopping')
    assert.match(runtime.job(dataRoot, 'a').error, /停止尚未确认/)
    assert.equal((await runtime.start(request)).reused, true)
    locked = false
    await runtime.stop(request)
    assert.equal(runtime.job(dataRoot, 'a').status, 'stopped')
    clearInterval(job.timer)
  `)
})

test('external identity EPERM keeps a failed cleanup active and contains job.done and diagnostics', async t => {
  await childFixture(t, `
    let failCleanup = true, disposals = 0, diagnostic
    const worker = { id: 'external-worker', result: Promise.resolve({ stopReason: 'completed' }),
      continuePrompt: async () => assert.fail('identity publication failed before extraction'),
      dispose: async () => { disposals++; if (failCleanup) throw new Error('worker cleanup is blocked') } }
    const runtime = new AssetActionRuntime(api, runner, { agents: { get: id => ({ id }) }, subagents: {
      getProvider: () => ({}), start: async (_id, options) => { diagnostic = options.onDiagnostic; locked = true; return worker },
    } })
    await runtime.start({ ...request, providerId: 'pangea-codeagent' })
    await tick(); await tick()
    const job = [...runtime.jobs.values()][0]
    await job.done
    const value = runtime.job(dataRoot, 'a')
    assert.equal(value.status, 'stopping')
    assert.equal(value.cleanup_confirmed, false)
    assert.match(value.error, /EPERM/)
    assert.match(value.error, /worker cleanup is blocked/)
    assert.equal(calls.filter(args => args[1] === 'bind').length, 0)
    assert.equal((await runtime.start(request)).reused, true)
    diagnostic({ toolCalls: 1, lastToolStatus: 'completed' })
    locked = false; failCleanup = false
    await runtime.stop(request)
    assert.equal(disposals, 2)
    assert.equal(runtime.job(dataRoot, 'a').status, 'stopped')
    assert.equal(runtime.job(dataRoot, 'a').cleanup_confirmed, true)
  `)
})

test('authoritative settle failures remain failed and retain their error when the failure record cannot be saved', async t => {
  await childFixture(t, `
    const runtime = new AssetActionRuntime(api, async input => {
      if (input.args[1] === 'settle') { locked = true; throw new Error('authoritative result validation failed') }
      return runner(input)
    })
    await runtime.start(request)
    runtime.handleAgentStatus({ session: { id: 'session' } }, 'running')
    runtime.handleAgentStatus({ session: { id: 'session' } }, 'idle')
    await tick()
    const value = runtime.job(dataRoot, 'a')
    assert.equal(value.status, 'failed')
    assert.match(value.error, /authoritative result validation failed/)
    assert.match(value.error, /EPERM/)
    assert.match(value.warning, /运行记录保存失败/)
  `)
})

test('a completed external result retains its queue slot until worker cleanup is confirmed', async t => {
  await childFixture(t, `
    let releaseCleanup
    const cleanup = new Promise(resolve => { releaseCleanup = resolve })
    const runtime = new AssetActionRuntime(api, runner, { agents: { get: id => ({ id }) }, subagents: {
      getProvider: () => ({}), start: async () => ({ id: 'external-worker', result: Promise.resolve({ stopReason: 'completed' }),
        continuePrompt: async () => ({ stopReason: 'completed' }), dispose: () => cleanup }),
    } })
    await runtime.start({ ...request, providerId: 'pangea-codeagent' })
    await tick()
    const job = [...runtime.jobs.values()][0]
    assert.equal(runtime.job(dataRoot, 'a').status, 'stopping')
    assert.equal((await runtime.start(request)).reused, true)
    releaseCleanup()
    await job.done
    assert.equal(runtime.job(dataRoot, 'a').status, 'completed')
    assert.equal(runtime.job(dataRoot, 'a').cleanup_confirmed, true)
  `)
})
