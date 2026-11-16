import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { FaultInjectionService } from '../src/fault-injection.js'
import { requireAgentModel } from '../src/agent-models.js'
import { acpSettingsRouteHandler, faultInjectionRouteHandler } from '../src/index.js'

// Real HTTP, catalogue receipts, service and persistence. Only the advertised
// models and repository preparation are fixtures.
test('model HTTP receipt authorizes creation and historical retry', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fi-model-http-'))
  const dataRoot = path.join(root, 'data')
  await mkdir(dataRoot, { recursive: true })
  await mkdir(path.join(root, '.agents/pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents/pangea/dsh.md'), '# fixture')
  const provider = { discoverModels: async () => ({ current_model: 'native', models: [{ id: 'native' }, { id: 'chosen' }] }) }
  const runtime = { subagents: { getProvider: () => provider } }
  const service = new FaultInjectionService({ validateModel: options => requireAgentModel(runtime, options) })
  service.defaults = async () => ({ provider_id: 'pangea-nga', agent_model: 'obsolete', repositories: [{ repo_id: 'repo', personal_branch: 'main' }] })
  let prepared = 0
  service.prepareAndGenerate = async ({ directory, record }) => {
    prepared++; record.status = 'failed'; record.error = 'fixture: preparation stopped'; await service.save(directory, record)
  }
  const run = { run_id: 'receipt-run', details: { test_cases: [{ projection_id: 'case', title: 'case' }] } }
  const server = createServer((req, res) => {
    if (req.url === '/models') void acpSettingsRouteHandler(req, res, {}, runtime)
    else void faultInjectionRouteHandler(req, res, service, runtime, { resolveRoot: async () => dataRoot, readRun: async () => run })
  })
  t.after(async () => { await service.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const post = async (route, input) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }, body: JSON.stringify({ cwd: root, ...input }) })
    return { status: response.status, body: await response.json() }
  }
  const discover = async () => {
    const response = await post('/models', { action: 'models', provider_id: 'pangea-nga' })
    assert.equal(response.status, 200); return response.body.catalog_id
  }
  const first = await discover(), receipt = await discover()
  const generate = input => post('/injection', { action: 'generate', run_id: run.run_id, case_keys: ['case'], agent_model: '', ...input })
  for (const input of [{}, { agent_catalog_id: 'forged' }, { agent_catalog_id: first },
    { agent_catalog_id: receipt, provider_id: 'pangea-codeagent' }, { agent_catalog_id: receipt, agent_model: 'missing' }]) {
    const response = await generate(input)
    assert.equal(response.status, 400, JSON.stringify(response.body))
    assert.match(response.body.error, /刷新|重新读取/)
    assert.equal(prepared, 0)
    assert.deepEqual(await service.list(dataRoot, run.run_id), [])
  }
  for (const [requested, normalized] of [['', 'native'], ['  chosen  ', 'chosen']]) {
    const response = await generate({ agent_catalog_id: receipt, agent_model: requested })
    assert.equal(response.status, 202, JSON.stringify(response.body))
    assert.equal(response.body.task.agent_model, normalized)
    await service.dispose()
    const saved = await service.read(dataRoot, run.run_id, response.body.task.id)
    assert.equal(saved.agent_model, normalized)
    delete saved.agent_catalog_id
    await service.save(await service.directory(dataRoot, run.run_id, saved.id), saved)
    const retried = await post('/injection', { action: 'retry', run_id: run.run_id, task_id: saved.id })
    assert.equal(retried.status, 200, JSON.stringify(retried.body))
    assert.equal(retried.body.task.agent_model, normalized)
    assert.notEqual(retried.body.task.id, saved.id)
    await service.dispose()
  }
  assert.equal(prepared, 4)
})
