import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createInjectionGenerator } from '../src/fault-injection-agent.js'

test('code generation uses the selected external model, isolated scratch and saved session identity', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fi-agent-')); t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(path.join(directory, '.agents', 'pangea'), { recursive: true }); await writeFile(path.join(directory, '.agents', 'pangea', 'dsh.md'), 'fixture')
  const outputPath = path.join(directory, 'result.json'), payload = { summary: 'generated', edits: [] }
  await writeFile(outputPath, JSON.stringify(payload))
  let request, started, disposed = false
  const parent = { id: 'parent' }
  const runtime = { agents: { get: () => parent }, subagents: { start: async (provider, input) => {
    assert.equal(provider, 'configured'); request = input
    return { id: 'worker', remoteSessionId: 'remote', result: Promise.resolve({ stopReason: 'completed' }), dispose: async () => { disposed = true } }
  } } }
  const generate = createInjectionGenerator(runtime, { resolveModel: async (_, options) => options.model, createSession: async () => 'parent' })
  const result = await generate({ record: { id: 'task-1', provider_id: 'configured', agent_model: 'selected-model' }, cwd: directory, scratchDirectory: directory, outputPath,
    prompt: 'read current case and generate', signal: new AbortController().signal, onStarted: async value => { started = value } })
  assert.deepEqual(result, payload); assert.equal(request.parent, parent); assert.equal(request.agentOptions.model, 'selected-model')
  assert.equal(request.scratchDirectory, directory); assert.equal(started.agent_session_id, 'worker'); assert.equal(disposed, true)
})

test('external model errors are reported and the worker is disposed without inventing edits', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fi-agent-')); t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(path.join(directory, '.agents', 'pangea'), { recursive: true }); await writeFile(path.join(directory, '.agents', 'pangea', 'dsh.md'), 'fixture')
  let disposed = false
  const generate = createInjectionGenerator({ agents: { get: () => ({}) }, subagents: { start: async () => ({
    id: 'failed', result: Promise.resolve({ stopReason: 'error', diagnostic: 'provider test error' }), dispose: async () => { disposed = true },
  }) } }, { resolveModel: async () => 'model', createSession: async () => 'parent' })
  await assert.rejects(generate({ record: { id: 'task', provider_id: 'configured' }, cwd: directory, scratchDirectory: '/unused', outputPath: '/unused/result.json',
    prompt: 'generate', signal: new AbortController().signal, onStarted: async () => {} }), /provider test error/)
  assert.equal(disposed, true)
})

for (const [name, content, expected] of [['missing', null, /未交付.*task-missing.*remote-missing/], ['invalid JSON', '{broken', /打桩生成结果不可读取.*JSON/]]) {
  test(`completed worker with ${name} reports delivery failure and disposes`, async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'fi-delivery-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    await mkdir(path.join(directory, '.agents', 'pangea'), { recursive: true }); await writeFile(path.join(directory, '.agents', 'pangea', 'dsh.md'), 'fixture')
    const outputPath = path.join(directory, 'result.json')
    if (content !== null) await writeFile(outputPath, content)
    let disposed = false
    const generate = createInjectionGenerator({ agents: { get: () => ({}) }, subagents: { start: async () => ({
      id: 'worker', remoteSessionId: 'remote-missing', result: Promise.resolve({ stopReason: 'completed' }),
      dispose: async () => { disposed = true },
    }) } }, { resolveModel: async () => 'model', createSession: async () => 'parent' })
    await assert.rejects(generate({ record: { id: 'task-missing', provider_id: 'configured' }, cwd: directory,
      outputPath, prompt: 'generate', signal: new AbortController().signal, onStarted: async () => {} }), expected)
    assert.equal(disposed, true)
  })
}

for (const scenario of [
  { name: 'RPC rejection retained only in diagnostics', stopReason: 'error', diagnostics: { errorSummary: 'Unable to connect: ConnectionRefused' }, expected: /Unable to connect: ConnectionRefused/ },
  { name: 'primary diagnostic takes precedence', stopReason: 'error', diagnostic: 'primary failure', diagnostics: { errorSummary: 'secondary failure' }, expected: /^primary failure$/ },
  { name: 'diagnostic reader failure preserves stop reason', stopReason: 'error', readerFails: true, expected: /打桩生成结束：error/ },
  { name: 'false completion includes available cause', stopReason: 'completed', diagnostics: { errorSummary: 'ConnectionRefused' }, expected: /未交付.*ConnectionRefused/ },
  { name: 'false completion survives diagnostic reader failure', stopReason: 'completed', readerFails: true, expected: /未交付/ },
  { name: 'abort wins over provider diagnostic', stopReason: 'error', abort: true, diagnostics: { errorSummary: 'ConnectionRefused' }, expected: /fixture aborted/ },
]) {
  test(scenario.name, async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'fi-diagnostic-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    await mkdir(path.join(directory, '.agents', 'pangea'), { recursive: true })
    await writeFile(path.join(directory, '.agents', 'pangea', 'dsh.md'), 'fixture')
    let disposed = false, diagnosticReads = 0
    const controller = new AbortController()
    const generate = createInjectionGenerator({ agents: { get: () => ({}) }, subagents: { start: async () => ({
      id: 'worker', remoteSessionId: 'remote',
      result: Promise.resolve({ stopReason: scenario.stopReason, diagnostic: scenario.diagnostic }),
      readDiagnostics: async () => { diagnosticReads++; if (scenario.readerFails) throw new Error('reader failed'); return scenario.diagnostics },
      dispose: async () => { disposed = true },
    }) } }, { resolveModel: async () => 'model', createSession: async () => 'parent' })
    await assert.rejects(generate({ record: { id: 'task', provider_id: 'configured' }, cwd: directory,
      outputPath: path.join(directory, 'missing.json'), prompt: 'generate', signal: controller.signal,
      onStarted: async () => { if (scenario.abort) controller.abort(new Error('fixture aborted')) },
    }), error => { assert.match(error.message, scenario.expected); return true })
    assert.equal(disposed, true)
    if (scenario.abort || scenario.diagnostic) assert.equal(diagnosticReads, 0)
  })
}
