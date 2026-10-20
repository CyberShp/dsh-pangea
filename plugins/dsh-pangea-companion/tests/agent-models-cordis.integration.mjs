import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { discoverAgentModels, requireAgentModel } from '../src/agent-models.js'

const appRoot = process.env.PANGEA_TEST_APP_ROOT
if (!appRoot) throw new Error('PANGEA_TEST_APP_ROOT must point to a built PANGEA Desktop app root')
const { Context, Service } = await import(pathToFileURL(path.join(appRoot, 'node_modules/@deepseek-ai/cordis/lib/index.js')).href)

test('model receipts survive real Cordis traceable Service proxies and remain workspace-bound', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pangea-cordis-models-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  await mkdir(path.join(cwd, '.agents/pangea'), { recursive: true })
  await writeFile(path.join(cwd, '.agents/pangea/dsh.md'), '# fixture')
  let probes = 0
  class Subagents extends Service {
    constructor(ctx) {
      super(ctx, 'subagents')
      this.provider = { async discoverModels() { probes++; return { current_model: 'native', models: [{ id: 'native' }] } } }
    }
    getProvider() { return this.provider }
  }
  const context = new Context()
  const service = new Subagents(context)
  assert.notEqual(context.subagents, context.subagents, 'the framework recreates the service Proxy on every access')
  assert.equal(context.subagents[Symbol.for('cordis.original')], service)
  const request = { providerId: 'pangea-nga', cwd }
  const catalog = await discoverAgentModels(context, request)
  assert.equal(await requireAgentModel(context, { ...request, catalogId: catalog.catalog_id, requireReceipt: true }), 'native')
  assert.equal(await requireAgentModel(context, { ...request, model: 'native' }), 'native')
  assert.equal(probes, 1, 'launch should reuse the discovered catalogue instead of probing through another proxy')
  const otherContext = new Context()
  new Subagents(otherContext)
  await assert.rejects(requireAgentModel(otherContext, { ...request, catalogId: catalog.catalog_id, requireReceipt: true }), /模型列表尚未就绪/)
})
