import assert from 'node:assert/strict'
import test from 'node:test'
import { createSourceFirstAcpRun } from '../src/source-first-acp.js'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createRun, runPangea } from '../src/pangea-api.js'

for (const providerId of ['pangea-codeagent', 'pangea-nga', 'pangea-claude-code']) {
  test(`${providerId} executes planning, analysis, blind/comparison and closure in exact original sessions`, async () => {
    const steps = [
      ['planning', 'planning'], ['analysis', 'unit_analysis'], ['review', 'independent_review'],
      ['review', 'comparison_review', 'worker-3'], ['closure', 'targeted_closure', 'worker-2'],
    ]
    let index = 0, created = 0
    const bindings = [], prompts = [], disposed = []
    const action = () => ({ action_id: `run:${index}`, role: steps[index][0], stage: steps[index][1],
      action: steps[index][2] ? 'continue_agent' : 'dispatch_agent', task_id: steps[index][2], task_path: `/run/task-${index}.json` })
    const runner = async ({ args }) => {
      if (args[0] === 'task-open') return { task: { action_id: `run:${index}`, inputs: [] } }
      if (args[1] === 'next') return { run_id: providerId, lifecycle_status: index === steps.length ? 'complete' : 'running', actions: index === steps.length ? [] : [action()] }
      if (args[1] === 'bind') { bindings.push([args[args.indexOf('--action-id') + 1], args.at(-1)]); return {} }
      assert.equal(args[1], 'settle'); index++; return {}
    }
    const run = createSourceFirstAcpRun({ providerId, agentModel: 'selected/model', parent: {}, cwd: '/work', dataRoot: '/data', runId: providerId,
      signal: new AbortController().signal, runner,
      subagents: { start: async (provider, request) => {
        assert.equal(provider, providerId); assert.equal(request.agentOptions.model, 'selected/model')
        const id = `worker-${++created}`
        return { id, result: Promise.resolve({ stopReason: 'completed' }),
          continuePrompt: async value => { prompts.push([id, value[0].text]); return { stopReason: 'completed' } }, dispose: async () => disposed.push(id) }
      } } })
    assert.equal((await run.result).stopReason, 'completed')
    assert.equal(created, 3)
    assert.deepEqual(prompts.map(p => p[0]), ['worker-1', 'worker-2', 'worker-3', 'worker-3', 'worker-2'])
    for (const [, prompt] of prompts) {
      assert.doesNotMatch(prompt, /\.opencode|\.agents\/pangea|pangea_action_dispatch/)
      assert.match(prompt, /source-first-cli-worker\.md/)
    }
    assert.ok(bindings.some(([actionId, taskId]) => actionId === 'run:4' && taskId === 'worker-2'))
    await run.dispose(); assert.equal(disposed.length, 3)
  })
}

test('malformed output returns to the same worker and attention does not fabricate completion', async () => {
  let attempts = 0, creations = 0, prompts = 0
  const controller = new AbortController()
  const run = createSourceFirstAcpRun({ providerId: 'pangea-codeagent', parent: {}, cwd: '/work', dataRoot: '/data', runId: 'repair-test', signal: controller.signal,
    runner: async ({ args }) => {
      if (args[0] === 'task-open') return { task: {} }
      if (args[1] === 'next') return { run_id: 'repair-test', lifecycle_status: 'running', actions: [{ action_id: 'repair:planning', role: 'planning', stage: 'planning', task_path: '/task.json',
        action: attempts ? 'continue_agent' : 'dispatch_agent', ...(attempts ? { task_id: 'original', pending_repair: { error: 'bad JSON' } } : {}) }] }
      if (args[1] === 'settle') return { attention_required: ++attempts === 2, validation: { status: 'invalid', recoverable: true } }
      return {}
    },
    subagents: { start: async () => { creations++; return { id: 'original', result: Promise.resolve({ stopReason: 'completed' }),
      continuePrompt: async value => { if (prompts++) assert.match(value[0].text, /bad JSON/); return { stopReason: 'completed' } }, dispose: async () => {} } } } })
  const result = await run.result
  assert.equal(creations, 1); assert.equal(prompts, 2)
  assert.match(result.output[0].text, /attention_required/)
  controller.abort(); await run.dispose()
})

test('missing original reviewer never spawns a replacement', async () => {
  const controller = new AbortController()
  const run = createSourceFirstAcpRun({ providerId: 'pangea-codeagent', cwd: '/work', dataRoot: '/data', runId: 'missing-reviewer', signal: controller.signal,
    runner: async () => ({ run_id: 'missing-reviewer', actions: [{ action: 'continue_agent', action_id: 'comparison', task_id: 'original-reviewer' }] }),
    subagents: { start: async () => assert.fail('must not replace reviewer') } })
  await assert.rejects(run.result, /原 worker 会话不可续接/)
  controller.abort(); await run.dispose()
})

test('host ACP controller completes a real Python Graph using bound CLI writes', {
  skip: !process.env.PANGEA_INTEGRATION_RUNTIME && 'Requires the staged Python runtime',
}, async () => {
  const runtime = process.env.PANGEA_INTEGRATION_RUNTIME
  const cwd = await mkdtemp(path.join(tmpdir(), 'pangea-acp-graph-'))
  const previous = process.env.PYTHONPATH
  process.env.PYTHONPATH = path.join(runtime, 'src')
  let run
  const controller = new AbortController()
  try {
    await cp(path.join(runtime, '.agents'), path.join(cwd, '.agents'), { recursive: true })
    const repository = path.join(cwd, 'pangea-data', 'repositories', 'sample')
    await mkdir(repository, { recursive: true })
    await writeFile(path.join(repository, 'tls.c'), 'int tls_connect(int enabled) { return enabled ? 0 : -1; }\n')
    const created = await createRun(cwd, { repository: 'sample', target: 'TLS connect', source_scope: ['tls.c'], effective_context_budget: 204800 })
    let count = 0
    const stages = []
    run = createSourceFirstAcpRun({ providerId: 'pangea-codeagent', parent: {}, cwd, dataRoot: created.data_root, runId: created.run_id,
      signal: controller.signal, runner: runPangea,
      subagents: { start: async () => {
        const id = `real-cli-worker-${++count}`
        return { id, result: Promise.resolve({ stopReason: 'completed' }), dispose: async () => {},
          continuePrompt: async prompt => {
            const binding = JSON.parse(prompt[0].text.split('\n').find(line => line.startsWith('每次 CLI')).split('：').slice(1).join('：'))
            const call = (command, args = []) => runPangea({ cwd, args: [command, ...binding, ...args] })
            const { task } = await call('task-open')
            stages.push([task.task_type, task.review_stage, id])
            const current = await call('result-read')
            let saved
            if (task.task_type === 'source_first_plan') {
              saved = await call('plan-write', ['--expected-revision', String(current.revision), '--unit', JSON.stringify({ title: 'TLS 连接', purpose: '验证连接结果', owned_files: [{ repo_id: 'sample', path: 'tls.c' }] })])
            } else if (task.review_stage === 'comparison_review') {
              saved = await call('review-decide', ['--expected-revision', String(current.revision), '--decision', JSON.stringify({ version_set_id: task.version_set_id, disposition: 'pass', summary: '协议回归 fixture 完成，不代表模型质量验证' })])
            } else {
              saved = await call('result-write', ['--expected-revision', String(current.revision), '--records', JSON.stringify([{ kind: 'note', body: '固定回归 fixture：已启用 TLS 时连接成功，未启用时返回失败。', evidence: ['sample:tls.c:1'] }])])
            }
            await call('work-finish', ['--revision', String(saved.revision)])
            return { stopReason: 'completed' }
          } }
      } } })
    const completed = await run.result
    assert.equal(completed.stopReason, 'completed')
    assert.equal(count, 3)
    assert.equal(stages.length, 4)
    assert.equal(stages[2][2], stages[3][2])
    const state = await runPangea({ cwd, args: ['runs', 'get', '--data-root', created.data_root, '--run-id', created.run_id] })
    assert.equal(state.lifecycle_status, 'complete')
  } finally {
    controller.abort(); await run?.dispose()
    if (previous === undefined) delete process.env.PYTHONPATH; else process.env.PYTHONPATH = previous
    await rm(cwd, { recursive: true, force: true })
  }
})
