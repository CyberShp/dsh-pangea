import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { apply, sourceFirstTools } from '../src/index.js'

test('new-Run tool hides retired inputs and rejects them when execute bypasses schema validation', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-tool-current-inputs-'))
  const previousHome = process.env.DSH_HOME, previousConfig = process.env.PANGEA_ACP_RUNTIME_CONFIG
  process.env.DSH_HOME = root
  delete process.env.PANGEA_ACP_RUNTIME_CONFIG
  let cleanup
  t.after(async () => {
    try { await cleanup?.() } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      if (previousConfig === undefined) delete process.env.PANGEA_ACP_RUNTIME_CONFIG
      else process.env.PANGEA_ACP_RUNTIME_CONFIG = previousConfig
      await rm(root, { recursive: true, force: true })
    }
  })
  const registered = new Map()
  apply({
    on() { return () => {} },
    tools: { register(tool) { registered.set(tool.name, tool); return () => {} } },
    webServer: { register() { return () => {} } },
    effect(effect) { cleanup = effect() },
  })
  const create = registered.get('pangea_run_create')
  assert.equal(Object.hasOwn(create.parameters.properties, 'context_scope'), false)
  assert.equal(Object.hasOwn(create.parameters.properties, 'flow_baseline'), false)
  const exec = { agent: { session: { header: { cwd: root } } } }
  const input = { repository: 'repo', target: 'test', source_scope: ['src'] }
  await assert.rejects(create.execute({ ...input, context_scope: ['include/tls.h'] }, exec), /不再支持参考源码范围/)
  await assert.rejects(create.execute({ ...input, flow_baseline: { run_id: 'saved-run', version_id: 'saved-version' } }, exec), /不再支持流程基线/)
})

test('registers source-first lifecycle, source, result, review, and finish tools with exact bindings', async () => {
  const registered = []
  const calls = []
  const ctx = {
    tools: {
      register(tool) {
        registered.push(tool)
        return () => {}
      },
    },
  }
  const execute = async (exec, command, args) => {
    calls.push({ exec, command, args })
    return { ok: true }
  }
  sourceFirstTools(ctx, execute)
  const names = registered.map(tool => tool.name)
  assert.deepEqual(names, [
    'pangea_task_open',
    'pangea_input_read',
    'pangea_action_next',
    'pangea_action_bind',
    'pangea_action_settle',
    'pangea_source_index',
    'pangea_source_read',
    'pangea_source_search',
    'pangea_result_write',
    'pangea_result_supersede',
    'pangea_result_read',
    'pangea_result_repair',
    'pangea_comparison_read',
    'pangea_plan_write',
    'pangea_work_finish',
    'pangea_review_decide',
  ])

  const binding = {
    data_root: '/tmp/pangea-data',
    run_id: 'run-01',
    action_id: 'run-01:analysis:U00',
    task_id: 'task-01',
  }
  const exec = { agent: { session: { header: { cwd: '/tmp/workspace' } } } }
  await registered.find(tool => tool.name === 'pangea_action_bind').execute(binding, exec)
  assert.deepEqual(calls.at(-1).args, [
    'bind',
    '--data-root', binding.data_root,
    '--run-id', binding.run_id,
    '--action-id', binding.action_id,
    '--task-id', binding.task_id,
  ])

  await registered.find(tool => tool.name === 'pangea_result_write').execute({
    ...binding,
    expected_revision: 2,
    records: [{ kind: 'risk', body: { text: 'raw' } }],
    request_id: 'req-1',
  }, exec)
  assert.equal(calls.at(-1).command, 'result-write')
  assert.deepEqual(calls.at(-1).args, [
    '--data-root', binding.data_root,
    '--run-id', binding.run_id,
    '--action-id', binding.action_id,
    '--task-id', binding.task_id,
    '--expected-revision', '2',
    '--records', JSON.stringify([{ kind: 'risk', body: { text: 'raw' } }]),
    '--request-id', 'req-1',
  ])

  await registered.find(tool => tool.name === 'pangea_action_settle').execute({
    data_root: binding.data_root,
    run_id: binding.run_id,
    action_id: binding.action_id,
  }, exec)
  assert.deepEqual(calls.at(-1).args, [
    'settle',
    '--data-root', binding.data_root,
    '--run-id', binding.run_id,
    '--action-id', binding.action_id,
  ])
})

test('passes prepared material unchanged and preserves full replacement evidence', async () => {
  const registered = new Map(), calls = []
  const prepared = { prepared_examples: { pages: [{ input_id: 'example_001', body: 'sample' }], pending_inputs: [{ input_id: 'example_002', cursor: null }] }, prepared_source: { original_records: [{ record_id: 'rec-1', body: 'original' }], pending_original_record_ids: ['rec-2'] } }
  sourceFirstTools({ tools: { register(tool) { registered.set(tool.name, tool); return () => {} } } }, async (_exec, command, args) => { calls.push({ command, args }); return prepared })
  const binding = { data_root: '/data', run_id: 'run', action_id: 'run:a', task_id: 'child' }
  const opened = await registered.get('pangea_task_open').execute({ ...binding, prepare_source: true }, {})
  assert.deepEqual(opened, prepared)
  await registered.get('pangea_input_read').execute({ ...binding, input_id: 'example_002' }, {})
  assert.ok(!calls.at(-1).args.includes('--cursor'))
  const replacement = { kind: 'test_case', body: { title: 'Corrected case' }, evidence: ['repo:file.c:1'], relates_to: ['risk-1'] }
  await registered.get('pangea_result_supersede').execute({ ...binding, target_record_ids: ['rec-1'], expected_revision: 3, replacement }, {})
  const args = calls.at(-1).args
  assert.deepEqual(JSON.parse(args[args.indexOf('--replacement') + 1]), replacement)
  assert.ok(!args.includes('--edits'))
})
