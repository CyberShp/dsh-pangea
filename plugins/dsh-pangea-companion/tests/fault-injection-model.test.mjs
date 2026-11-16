import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { FaultInjectionService } from '../src/fault-injection.js'
import { analysisExecutionState, loadAnalysisAgentModels } from '../src/agent-model-selection.js'

test('model receipt validation precedes task persistence and normalizes defaults', async t => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'fi-model-'))
  t.after(() => rm(dataRoot, { recursive: true, force: true }))
  let saved = 0, options
  const service = new FaultInjectionService({ validateModel: async value => {
    options = value
    if (value.requireReceipt && value.catalogId !== 'receipt') throw new Error('刷新模型后重试')
    if (value.model && value.model !== 'selected') throw new Error('模型不在目录，请刷新模型后重试')
    return value.model || 'default-model'
  } })
  service.defaults = async () => ({ provider_id: 'provider', agent_model: 'old', repositories: [{ repo_id: 'repo', personal_branch: 'main' }] })
  service.prepareAndGenerate = async () => {}
  const save = service.save.bind(service)
  service.save = (...args) => { saved++; return save(...args) }
  const run = { run_id: 'run', details: { test_cases: [{ projection_id: 'case', title: 'case' }] } }
  for (const input of [{}, { agent_catalog_id: 'wrong' }, { agent_catalog_id: 'receipt', agent_model: 'invalid' }]) {
    await assert.rejects(service.start({ dataRoot, run, input: { case_keys: ['case'], ...input } }), /刷新模型/)
    assert.equal(saved, 0)
    assert.equal(service.busy(), false)
  }
  const record = await service.start({ dataRoot, run, input: { case_keys: ['case'], agent_model: '', agent_catalog_id: 'receipt' } })
  assert.equal(record.agent_model, 'default-model'); assert.equal(options.requireReceipt, true)
  await service.dispose()
})
test('historical retry performs fresh non-receipt validation without changing the model', async () => {
  const service = new FaultInjectionService()
  service.read = async () => ({ status: 'failed', source_repositories: [{ repo_id: 'repo' }], cases: [], case_keys: ['case'], provider_id: 'old-provider', agent_model: 'old-model' })
  service.start = async (request, policy) => { assert.equal(request.input.agent_model, 'old-model'); assert.equal(request.input.provider_id, 'old-provider'); assert.equal(policy.requireReceipt, false); return 'retried' }
  assert.equal(await service.retry('/data', 'run', 'task', '/workspace'), 'retried')
})
test('model discovery ignores a late previous-provider response and rejects empty catalogs', async () => {
  const states = []; let finish
  const stop = loadAnalysisAgentModels({ providerId: 'old', cwd: '/workspace', onState: state => states.push(state), fetcher: () => new Promise(resolve => { finish = resolve }) })
  stop()
  finish({ ok: true, json: async () => ({ provider_id: 'old', catalog_id: 'old', current_model: 'old', models: [{ id: 'old' }] }) })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(states.length, 1)
  for (const state of [{ status: 'error', error: '刷新模型' }, { status: 'ready', catalog: { provider_id: 'new', catalog_id: 'receipt', models: [] } }]) {
    assert.equal(analysisExecutionState({ provider_id: 'new' }, [{ id: 'new', registered: true }], { cwd: '/workspace', provider_id: 'new', ...state }, '/workspace').ready, false)
  }
})
