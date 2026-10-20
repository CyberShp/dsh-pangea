import assert from 'node:assert/strict'
import test, { before, after } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { discoverAgentModels, requireAgentModel, resolveAgentModel } from '../src/agent-models.js'
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

test('retired Claude Code model discovery fails before querying the runtime', async () => {
  await assert.rejects(discoverAgentModels({ subagents: { getProvider() { assert.fail('must not load retired provider') } } },
    { providerId: 'pangea-claude-code', cwd }), /Claude Code 支持已移除/)
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


test('default model must be explicitly advertised; a nonempty list alone cannot authorize an unresolved default', () => {
  assert.equal(resolveAgentModel({ current_model: 'native', models: [{ id: 'native' }] }, ''), 'native')
  assert.equal(resolveAgentModel({ models: [{ id: 'chosen' }] }, 'chosen'), 'chosen')
  assert.throws(() => resolveAgentModel({ current_model: 'native', models: [] }, ''), /未返回可用模型/)
  assert.throws(() => resolveAgentModel({ current_model: 'removed', models: [{ id: 'native' }] }, ''), /默认模型尚未确认或已不可用/)
  assert.throws(() => resolveAgentModel({ models: [{ id: 'native' }] }, ''), /默认模型尚未确认/)
  assert.throws(() => resolveAgentModel({ models: [{ id: 'native' }] }, 'removed'), /已不在当前 Agent/)
})

test('creation requires the current catalogue receipt bound to the runtime, workspace and provider', async () => {
  const provider = { async discoverModels() { return { current_model: 'native', models: [{ id: 'native' }] } } }
  const runtime = { subagents: { getProvider: () => provider } }
  const request = { providerId: 'pangea-nga', cwd, model: '', requireReceipt: true }
  await assert.rejects(requireAgentModel(runtime, request), /模型列表尚未就绪/)
  const catalog = await discoverAgentModels(runtime, request)
  assert.equal(await requireAgentModel(runtime, { ...request, catalogId: catalog.catalog_id }), 'native')
  await mkdir(path.join(cwd, 'other/.agents/pangea'), { recursive: true })
  await writeFile(path.join(cwd, 'other/.agents/pangea/dsh.md'), '# another workspace')
  for (const altered of [{ catalogId: 'fake' }, { providerId: 'pangea-codeagent' }, { cwd: path.join(cwd, 'other') }]) {
    await assert.rejects(requireAgentModel(runtime, { ...request, catalogId: catalog.catalog_id, ...altered }), /模型列表尚未就绪/)
  }
  await assert.rejects(requireAgentModel({ subagents: { getProvider: () => provider } }, { ...request, catalogId: catalog.catalog_id }), /模型列表尚未就绪/)
})

test('new probes invalidate earlier receipts immediately and late completions cannot replace the latest catalogue', async () => {
  const pending = []
  const provider = { discoverModels: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) }
  const runtime = { subagents: { getProvider: () => provider } }
  const request = { providerId: 'pangea-nga', cwd }
  const first = discoverAgentModels(runtime, request)
  pending.shift().resolve({ current_model: 'first', models: [{ id: 'first' }] })
  const firstCatalog = await first
  const late = discoverAgentModels(runtime, request)
  const latePending = pending.shift()
  await assert.rejects(requireAgentModel(runtime, { ...request, requireReceipt: true, catalogId: firstCatalog.catalog_id }), /模型列表尚未就绪/)
  const latest = discoverAgentModels(runtime, request)
  pending.shift().resolve({ current_model: 'latest', models: [{ id: 'latest' }] })
  const latestCatalog = await latest
  latePending.resolve({ current_model: 'late', models: [{ id: 'late' }] })
  const lateCatalog = await late
  await assert.rejects(requireAgentModel(runtime, { ...request, requireReceipt: true, catalogId: lateCatalog.catalog_id }), /模型列表尚未就绪/)
  assert.equal(await requireAgentModel(runtime, { ...request, requireReceipt: true, catalogId: latestCatalog.catalog_id }), 'latest')
  const failure = discoverAgentModels(runtime, request)
  pending.shift().reject(new Error('probe failed'))
  await assert.rejects(failure, /probe failed/)
  await assert.rejects(requireAgentModel(runtime, { ...request, requireReceipt: true, catalogId: latestCatalog.catalog_id }), /模型列表尚未就绪/)
})

test('replacing a registered runtime provider invalidates its previous model receipt', async () => {
  let provider = { async discoverModels() { return { current_model: 'native', models: [{ id: 'native' }] } } }
  const runtime = { subagents: { getProvider: () => provider } }
  const request = { providerId: 'pangea-nga', cwd }
  const catalog = await discoverAgentModels(runtime, request)
  provider = { ...provider }
  await assert.rejects(requireAgentModel(runtime, { ...request, requireReceipt: true, catalogId: catalog.catalog_id }), /模型列表尚未就绪/)
})
