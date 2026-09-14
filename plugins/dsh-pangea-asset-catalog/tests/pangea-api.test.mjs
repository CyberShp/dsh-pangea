import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { AssetActionRuntime, dataRootFor, runPangea } from '../src/pangea-api.js'
import { apply } from '../src/index.js'

test('real Windows Python preserves Chinese asset titles and error messages', { skip: !process.env.PANGEA_TEST_PYTHON }, async () => {
  const root = await workspace()
  const previousPython = process.env.PANGEA_PYTHON
  const previousUtf8 = process.env.PYTHONUTF8
  process.env.PANGEA_PYTHON = process.env.PANGEA_TEST_PYTHON
  process.env.PYTHONUTF8 = '0'
  try {
    const source = path.join(root, '中文资料.md')
    await writeFile(source, '# 资产内容\n边界检查\n', 'utf8')
    const args = ['assets', 'import', '--data-root', path.join(root, 'data'), '--path', source, '--type', 'reference', '--title', '中文标题验收']
    await runPangea({ cwd: root, args })
    const listed = await runPangea({ cwd: root, args: ['assets', 'list', '--data-root', path.join(root, 'data')] })
    assert.equal(listed.items[0].title, '中文标题验收')
    await assert.rejects(runPangea({ cwd: root, args }), /重复资产/)
    const broken = path.join(root, 'broken.xlsx')
    await writeFile(broken, 'not a workbook')
    await assert.rejects(runPangea({ cwd: root, args: ['assets', 'import', '--data-root', path.join(root, 'data'), '--path', broken, '--type', 'coverage'] }))
    const failed = await runPangea({ cwd: root, args: ['assets', 'list', '--data-root', path.join(root, 'data'), '--status', 'failed'] })
    let route, response
    await apply({ on: () => () => {}, tools: { register: () => () => {} }, apiProxy: {}, webServer: { register(value) { route = value; return () => {} } } })
    await route.handler({ method: 'GET', headers: { 'sec-fetch-site': 'same-origin' }, url: `/api/pangea-asset-catalog/state?${new URLSearchParams({ cwd: root, data_root: path.join(root, 'data'), asset_id: failed.items[0].asset_id })}` }, { writeHead() {}, end(body) { response = JSON.parse(body) } })
    assert.equal(response.failure_record?.asset_id, failed.items[0].asset_id)
    assert.match(response.failure_record.last_error, /zip/i)
  } finally {
    if (previousPython === undefined) delete process.env.PANGEA_PYTHON; else process.env.PANGEA_PYTHON = previousPython
    if (previousUtf8 === undefined) delete process.env.PYTHONUTF8; else process.env.PYTHONUTF8 = previousUtf8
    await rm(root, { recursive: true, force: true })
  }
})

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-asset-runtime-'))
  await mkdir(path.join(root, '.agents', 'pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents', 'pangea', 'dsh.md'), 'rules\n')
  return root
}

test('asset extraction runs the deterministic PANGEA command without a DSH session', async () => {
  const root = await workspace()
  const calls = []
  const runner = async input => {
    calls.push(input.args)
    return { asset: { asset_id: 'asset-1', title: '历史缺陷', status: 'available' } }
  }
  try {
    const dataRoot = path.join(root, 'pangea-data')
    const runtime = new AssetActionRuntime({}, runner)
    const started = await runtime.start({ cwd: root, dataRoot, assetId: 'asset-1' })
    assert.equal(started.completed, true)
    assert.deepEqual(started.asset, { asset_id: 'asset-1', title: '历史缺陷', status: 'available' })
    assert.deepEqual(calls, [[
      'assets', 'extract', '--data-root', dataRoot, '--asset-id', 'asset-1',
    ]])
    assert.equal(runtime.job(dataRoot, 'asset-1').status, 'completed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('coverage extraction can complete without creating a model session', async () => {
  const root = await workspace()
  const runtime = new AssetActionRuntime({}, async () => ({
    asset: { asset_id: 'coverage-1', status: 'available' },
  }))
  try {
    const result = await runtime.start({ cwd: root, assetId: 'coverage-1' })
    assert.equal(result.completed, true)
    assert.equal(dataRootFor(root), path.join(root, 'pangea-data'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('an extraction failure is explicit and is never retried or settled', async () => {
  const root = await workspace()
  let calls = 0
  const runner = async () => {
    calls += 1
    throw new Error('normalized text is required')
  }
  try {
    const dataRoot = path.join(root, 'pangea-data')
    const runtime = new AssetActionRuntime({}, runner)
    await assert.rejects(
      runtime.start({ cwd: root, dataRoot, assetId: 'asset-2' }),
      /normalized text is required/,
    )
    assert.equal(calls, 1)
    const job = runtime.job(dataRoot, 'asset-2')
    assert.equal(job.status, 'failed')
    assert.match(job.error, /normalized text/)
  } finally { await rm(root, { recursive: true, force: true }) }
})


test('semantic extraction binds and settles the actual session; repeated requests do not dispatch twice', async () => {
  const root = await workspace(), calls = [], prompts = []
  const ok = value => ({ result: { ok: true, value } })
  let created = 0
  const selected = []
  const api = { llm: { providers: async () => ok({ providers: [{ provider: 'configured', declared: true, active: true }] }),
      models: async () => ok({ groups: [{ id: 'configured', models: [{ id: 'model-1' }] }] }) }, settings: { describe: async () => ok({ namespaces: [] }) },
    sessions: { create: async () => { created++; return ok({ sessionId: 'session-1' }) }, rename: async () => ok({}),
      selectModel: async input => { selected.push(input.payload); return ok({}) },
      prompt: async input => { assert.equal(selected.length, 1); prompts.push(input); return ok({}) } } }
  const runner = async ({ args }) => { calls.push(args); return args[0] === 'assets' ? { asset: { asset_id: 'a', title: '设计', status: 'extracting' }, action: { action_id: 'asset:a:extract', task_path: '/tasks/a.json', status: 'pending' } } : { asset: { status: 'available' } } }
  try {
    const runtime = new AssetActionRuntime(api, runner)
    const result = await runtime.start({ cwd: root, assetId: 'a', model: { provider: 'configured', model: 'model-1' } })
    assert.equal(result.completed, false)
    assert.equal(runtime.job(dataRootFor(root), 'a').status, 'queued')
    await runtime.start({ cwd: root, assetId: 'a' })
    assert.equal(created, 1); assert.equal(prompts.length, 1)
    assert.deepEqual(selected, [{ sessionId: 'session-1', provider: 'configured', model: 'model-1' }])
    assert.ok(calls[1].includes('session-1'))
    runtime.handleAgentStatus({ session: { id: 'unrelated' } }, 'idle')
    runtime.handleAgentStatus({ session: { id: 'session-1' } }, 'running')
    runtime.handleAgentStatus({ session: { id: 'session-1' } }, 'idle')
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(calls.at(-1)[1], 'settle')
    assert.equal(runtime.job(dataRootFor(root), 'a').status, 'completed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('restart submits the persisted extraction action without creating another session', async () => {
  const root = await workspace(), calls = []
  try {
    const runtime = new AssetActionRuntime({}, async ({ args }) => { calls.push(args); return args[0] === 'assets' ? { asset: { status: 'extracting' }, action: { action_id: 'asset:a:extract', task_path: '/a', task_id: 'original-session', status: 'dispatched' } } : { asset: { status: 'awaiting_review' } } })
    const result = await runtime.start({ cwd: root, assetId: 'a' })
    assert.equal(result.asset.status, 'awaiting_review')
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[1].slice(0, 2), ['adapter', 'settle'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('missing internal model fails before creating or prompting a blank-provider session', async () => {
  const root = await workspace()
  try {
    const runtime = new AssetActionRuntime({ sessions: { create: async () => assert.fail('must not create') } }, async () => ({
      asset: { status: 'extracting' }, action: { action_id: 'asset:a:extract', task_path: '/a' } }))
    await assert.rejects(runtime.start({ cwd: root, assetId: 'a' }), /请选择一个已配置的内部模型/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('CodeAgent asset extraction binds the external worker, waits for completion and settles', async () => {
  const root = await workspace(), calls = [], prompts = []
  const ok = value => ({ result: { ok: true, value } })
  const api = { sessions: { create: async () => ok({ sessionId: 'owner' }), rename: async () => ok({}),
    prompt: async () => assert.fail('must not prompt blank internal model') } }
  let bound = false, finished = false
  const runner = async ({ args }) => {
    calls.push(args)
    if (args[0] === 'assets') return { asset: { status: 'extracting' }, action: { action_id: 'asset:a:extract', task_path: '/a' } }
    if (args[1] === 'bind') { assert.equal(args.at(-1), 'external-worker'); bound = true; return {} }
    assert.equal(finished, true); return { asset: { status: 'awaiting_review' } }
  }
  const runtime = new AssetActionRuntime(api, runner, { agents: { get: id => ({ id }) }, subagents: {
    getProvider: () => ({}), start: async (id, request) => {
      assert.equal(id, 'pangea-codeagent'); assert.equal(request.agentOptions.model, 'selected')
      return { id: 'external-worker', result: Promise.resolve({ stopReason: 'completed' }),
        continuePrompt: async prompt => { assert.equal(bound, true); prompts.push(prompt); finished = true; return { stopReason: 'completed' } }, dispose: async () => {} }
    } } })
  try {
    const started = await runtime.start({ cwd: root, assetId: 'a', providerId: 'pangea-codeagent', agentModel: 'selected' })
    assert.equal(started.session_id, 'owner')
    await [...runtime.jobs.values()][0].done
    assert.equal(runtime.job(dataRootFor(root), 'a').status, 'completed')
    assert.doesNotMatch(prompts[0][0].text, /\.opencode|\.agents\/pangea/)
    assert.equal(calls.at(-1)[1], 'settle')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('asset process survives runtime recreation with provider, output and retry history', async () => {
  const root = await workspace(), dataRoot = dataRootFor(root)
  try {
    const runtime = new AssetActionRuntime({})
    const job = { dataRoot, assetId: 'a', status: 'running', startedAt: '2026-09-14T00:00:00Z', providerId: 'pangea-codeagent', model: 'selected-model', sessionId: 'worker', ownerSessionId: 'owner', output: '已读取需求文档\n', events: [] }
    runtime.jobs.set(`${path.resolve(dataRoot)}\na`, job)
    runtime.sessions.set('worker', job)
    runtime.handleSessionEvent({ id: 'unrelated' }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Unrelated' }] } } })
    runtime.handleSessionEvent({ id: 'worker' }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '正在提取适用条件' }] } } })
    const recovered = new AssetActionRuntime({}).job(dataRoot, 'a')
    assert.equal(recovered.status, 'interrupted')
    assert.equal(recovered.session_available, false)
    assert.equal(recovered.provider_id, 'pangea-codeagent')
    assert.match(recovered.output, /适用条件/)
    assert.doesNotMatch(recovered.output, /Unrelated/)
    const calls = []
    const next = new AssetActionRuntime({}, async ({ args }) => { calls.push(args); return { asset: { asset_id: 'a', status: 'available' } } })
    await next.start({ cwd: root, assetId: 'a', restart: true })
    assert.ok(calls[0].includes('--restart'))
    const final = new AssetActionRuntime({}).job(dataRoot, 'a')
    assert.equal(final.status, 'completed')
    assert.equal(final.history.length, 1)
    assert.match(final.history[0].output, /适用条件/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('one import starts processing with the selected executor and retains a failed import result', async () => {
  const { importAndExtract } = await import('../src/index.js')
  const calls = [], starts = []
  const asset = await importAndExtract({ cwd: '/workspace', dataRoot: '/data', sourcePath: '/input/case.md',
    body: { asset_type: 'test_case_example', title: '重连示例', provider_id: 'pangea-codeagent', agent_model: 'chosen' },
    runner: async ({ args }) => { calls.push(args); return { asset: { asset_id: 'case-1' } } },
    runtime: { async start(request) { starts.push(request); throw new Error('Provider failed after import') } } })
  assert.equal(asset.asset_id, 'case-1')
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].slice(0, 2), ['assets', 'import'])
  assert.equal(starts[0].assetId, 'case-1')
  assert.equal(starts[0].providerId, 'pangea-codeagent')
  assert.equal(starts[0].agentModel, 'chosen')
})
