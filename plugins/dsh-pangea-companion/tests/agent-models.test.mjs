import assert from 'node:assert/strict'
import test, { before, after } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { discoverAgentModels } from '../src/agent-models.js'
import { acpSettingsRouteHandler } from '../src/index.js'

let cwd
before(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), 'agent-catalog-'))
  await mkdir(path.join(cwd, '.agents/pangea'), { recursive: true })
  await writeFile(path.join(cwd, '.agents/pangea/dsh.md'), '# PANGEA')
})
after(async () => { await rm(cwd, { recursive: true, force: true }) })

test('discovers through the registered provider in the analysis workspace', async () => {
  const calls = []
  const runtime = { subagents: { getProvider(id) {
    calls.push(id)
    return { async discoverModels(request) {
      calls.push(request.cwd)
      return { current_model: 'native', models: [{ id: 'native', label: 'Native' }] }
    } }
  } } }
  const result = await discoverAgentModels(runtime, { providerId: 'pangea-nga', cwd })
  assert.deepEqual(calls, ['pangea-nga', cwd])
  assert.equal(result.provider_id, 'pangea-nga')
  assert.deepEqual(result.models, [{ id: 'native', label: 'Native' }])
})

test('timeout cancels the provider probe and reports the cause after cleanup', async () => {
  let disposed = false
  const runtime = { subagents: { getProvider: () => ({ discoverModels: ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { disposed = true; reject(signal.reason) }, { once: true })
  }) }) } }
  await assert.rejects(discoverAgentModels(runtime, { providerId: 'pangea-codeagent', cwd, timeoutMs: 5 }), /读取模型列表超时/)
  assert.equal(disposed, true)
})

test('unsupported runtimes return an actionable error rather than a manual model catalog', async () => {
  await assert.rejects(discoverAgentModels({ subagents: { getProvider: () => ({}) } }, { providerId: 'pangea-opencode' }), /更新 Desktop/)
})

test('the models HTTP action discovers models without reading or saving runtime configuration', async () => {
  const req = Readable.from([Buffer.from(JSON.stringify({ action: 'models', provider_id: 'pangea-nga', cwd }))])
  req.method = 'POST'
  req.headers = { 'sec-fetch-site': 'same-origin' }
  const res = new EventEmitter()
  let status, body
  res.writeHead = value => { status = value }
  res.end = value => { body = JSON.parse(value); res.writableEnded = true }
  await acpSettingsRouteHandler(req, res, { read() { assert.fail('should not read a manual catalog') }, save() { assert.fail('should not save') } }, {
    subagents: { getProvider: () => ({ async discoverModels(request) {
      assert.equal(request.cwd, cwd)
      return { current_model: 'native', models: [{ id: 'native', label: 'Native' }] }
    } }) },
  })
  assert.equal(status, 200)
  assert.equal(body.provider_id, 'pangea-nga')
  assert.deepEqual(body.models, [{ id: 'native', label: 'Native' }])
  assert.equal(res.listenerCount('close'), 0)
})
