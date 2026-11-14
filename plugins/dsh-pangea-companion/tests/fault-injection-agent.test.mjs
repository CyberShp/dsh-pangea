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
