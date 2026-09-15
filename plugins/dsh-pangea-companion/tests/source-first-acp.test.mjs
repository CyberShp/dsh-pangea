import assert from 'node:assert/strict'
import test from 'node:test'
import { createSourceFirstAcpRun } from '../src/source-first-acp.js'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createRun, runPangea } from '../src/pangea-api.js'
import { companionSnapshot } from '../src/reader.js'

test('ACP output polling emits only new worker text, with no idle session labels', async () => {
  let pendingOutput = '', finished = false
  let releaseTurn, enteredTurn
  const turn = new Promise(resolve => { releaseTurn = resolve })
  const started = new Promise(resolve => { enteredTurn = resolve })
  const controller = new AbortController()
  const run = createSourceFirstAcpRun({ providerId: 'pangea-codeagent', parent: {}, cwd: '/work', dataRoot: '/data',
    runId: 'output-polling', signal: controller.signal,
    runner: async ({ args }) => {
      if (args[0] === 'task-open') return { task: {} }
      if (args[1] === 'next') return { run_id: 'output-polling', lifecycle_status: finished ? 'complete' : 'running',
        actions: finished ? [] : [{ action_id: 'output-polling:planning', role: 'planning', stage: 'unit_planning', action: 'dispatch_agent' }] }
      if (args[1] === 'settle') finished = true
      return {}
    },
    subagents: { start: async () => ({ id: '236a6dd4-37db-4aff-8a0f-273b45a7e00e', result: Promise.resolve({ stopReason: 'completed' }),
      continuePrompt: async () => { enteredTurn(); await turn; return { stopReason: 'completed' } },
      readOutput: () => { const output = pendingOutput; pendingOutput = ''; return output }, dispose: async () => {},
    }) },
  })
  try {
    await started
    for (let i = 0; i < 20; i++) assert.equal(run.readOutput(), '')
    pendingOutput = '就绪'
    assert.equal(run.readOutput(), '[236a6dd4-37db-4aff-8a0f-273b45a7e00e]\n就绪\n')
    for (let i = 0; i < 20; i++) assert.equal(run.readOutput(), '')
    // Identical text emitted in a later turn is real output, not a duplicate.
    pendingOutput = '就绪'
    assert.match(run.readOutput(), /就绪/)
    pendingOutput = '正在读取源码'
    assert.match(run.readOutput(), /正在读取源码/)
    assert.equal(run.readOutput(), '')
    releaseTurn()
    assert.equal((await run.result).stopReason, 'completed')
    assert.equal(run.readOutput(), '')
  } finally {
    releaseTurn()
    controller.abort()
    await run.result.catch(() => {})
    await run.dispose()
  }
})

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

for (const [mode, closure] of [['depth', false], ['speed', false], ['speed', true]]) test(`host ACP controller completes a real Python Graph in ${mode} mode using bound CLI writes${closure ? ' with closure' : ''}`, {
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
    const created = await createRun(cwd, { repository: 'sample', target: 'TLS connect', source_scope: ['tls.c'], mode, effective_context_budget: 204800 })
    let count = 0
    const stages = []
    let unitId
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
            const snapshot = await companionSnapshot({ dataRoot: created.data_root, runId: created.run_id })
            assert.equal(snapshot.current.reader_health.trusted, true, JSON.stringify(snapshot.current.reader_warnings))
            if (task.task_type === 'source_first_analysis') unitId = task.unit_id
            if (task.task_type === 'source_first_closure') {
              const seed = JSON.parse(await readFile(task.result_path, 'utf8'))
              assert.equal(seed.binding.task_id, id)
              assert.equal(seed.binding.action_id, task.action_id)
              assert.ok(seed.records.length > 0)
              assert.equal(seed.completion, null)
              assert.equal(id, stages.find(stage => stage[0] === 'source_first_analysis')[2])
            }
            const current = await call('result-read')
            let saved
            if (task.task_type === 'source_first_plan') {
              saved = await call('plan-write', ['--expected-revision', String(current.revision), '--unit', JSON.stringify({ title: 'TLS 连接', purpose: '验证连接结果', owned_files: [{ repo_id: 'sample', path: 'tls.c' }] })])
            } else if (task.review_stage === 'comparison_review') {
              const compared = await call('comparison-read', ['--version-set-id', task.version_set_id])
              assert.ok(JSON.stringify(compared).includes('analysis'))
              assert.equal(JSON.stringify(compared).includes('independent_review'), mode === 'depth')
              let revision = current.revision
              if (closure) {
                const finding = await call('comparison-finding-write', ['--expected-revision', String(revision), '--unit-ids', JSON.stringify([unitId]), '--finding', JSON.stringify({ summary: '清理说明', body: '补充连接失败后的清理说明' })])
                revision = finding.revision
              }
              saved = await call('review-decide', ['--expected-revision', String(revision), '--decision', JSON.stringify({ version_set_id: task.version_set_id, disposition: closure ? 'finding' : 'pass', ...(closure ? { closure_units: [unitId] } : {}), summary: '协议回归 fixture 完成，不代表模型质量验证' })])
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
    assert.equal(stages.length, (mode === 'depth' ? 4 : 3) + Number(closure))
    if (mode === 'depth') assert.equal(stages[2][2], stages[3][2])
    else assert.equal(stages.some(stage => stage[1] === 'independent_review'), false)
    const state = await runPangea({ cwd, args: ['runs', 'get', '--data-root', created.data_root, '--run-id', created.run_id] })
    assert.equal(state.lifecycle_status, 'complete')
  } finally {
    controller.abort(); await run?.dispose()
    if (previous === undefined) delete process.env.PYTHONPATH; else process.env.PYTHONPATH = previous
    await rm(cwd, { recursive: true, force: true })
  }
})

test('a crashed transport is disposed and explicit continuation restores persisted identities', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pangea-acp-resume-'))
  let taskId, complete = false, starts = 0, disposals = 0
  const controller = new AbortController()
  let run
  const options = { providerId: 'pangea-codeagent', agentModel: 'model', parent: {}, cwd: root, dataRoot: root, runId: 'resume', signal: controller.signal,
    runner: async ({ args }) => {
      if (args[0] === 'task-open') return { task: {} }
      if (args[1] === 'next') return { run_id: 'resume', lifecycle_status: complete ? 'complete' : 'running', actions: complete ? [] : [
        { action_id: 'resume:planning', role: 'planning', stage: 'unit_planning', action: taskId ? 'continue_agent' : 'dispatch_agent', task_id: taskId }] }
      if (args[1] === 'bind') { taskId = args.at(-1); return {} }
      if (args[1] === 'settle') complete = true
      return {}
    }, subagents: { start: async (_provider, request) => {
      starts++
      if (starts === 2) assert.deepEqual(request.resume, { taskId: 'original', remoteSessionId: 'remote-original' })
      else assert.equal(request.resume, undefined)
      return { id: 'original', remoteSessionId: 'remote-original', result: Promise.resolve({ stopReason: 'completed' }),
        continuePrompt: async () => { if (starts === 1) throw new Error('ACP connection closed'); return { stopReason: 'completed' } },
        dispose: async () => { disposals++ } }
    } } }
  try {
    run = createSourceFirstAcpRun(options)
    await assert.rejects(run.result, /ACP connection closed/)
    assert.equal(disposals, 1)
    run = createSourceFirstAcpRun(options)
    assert.equal((await run.result).stopReason, 'completed')
    assert.equal(taskId, 'original')
    assert.equal(starts, 2)
  } finally { controller.abort(); await run?.dispose(); await rm(root, { recursive: true, force: true }) }
})


test('three analysis workers overlap, refill a free slot, and settle out of order without concurrent state writes', async () => {
  const controller = new AbortController()
  let writes = 0, active = 0, peak = 0, created = 0
  const done = new Set(), started = [], releases = new Map()
  const actions = Array.from({ length: 5 }, (_, i) => ({ action_id: `parallel:${i}`, role: 'analysis', stage: 'unit_analysis', action: 'dispatch_agent' }))
  const until = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)) } assert.fail('worker did not progress') }
  const run = createSourceFirstAcpRun({ providerId: 'pangea-nga', parent: {}, cwd: '/work', dataRoot: '/data', runId: 'parallel', signal: controller.signal,
    runner: async ({ args }) => {
      writes++; assert.equal(writes, 1)
      await new Promise(resolve => setTimeout(resolve, 1))
      writes--
      if (args[0] === 'task-open') return { task: {} }
      if (args[1] === 'next') return { run_id: 'parallel', lifecycle_status: done.size === 5 ? 'complete' : 'running', actions: actions.filter(a => !done.has(a.action_id)) }
      if (args[1] === 'settle') done.add(args[args.indexOf('--action-id') + 1])
      return {}
    }, subagents: { start: async () => {
      const id = `parallel-worker-${++created}`
      return { id, result: Promise.resolve({ stopReason: 'completed' }), dispose: async () => {}, continuePrompt: async prompt => {
        const binding = JSON.parse(prompt[0].text.split('\n').find(line => line.startsWith('每次 CLI')).split('：').slice(1).join('：'))
        const action = binding[binding.indexOf('--action-id') + 1]
        started.push(action); active++; peak = Math.max(peak, active)
        await new Promise(resolve => releases.set(action, resolve)); active--
        return { stopReason: 'completed' }
      } }
    } } })
  try {
    await until(() => started.length === 3)
    assert.equal(peak, 3)
    releases.get('parallel:1')()
    await until(() => started.length === 4)
    assert.ok(done.has('parallel:1')); assert.ok(!done.has('parallel:0'))
    releases.get('parallel:3')()
    await until(() => started.length === 5)
    for (const release of releases.values()) release()
    assert.equal((await run.result).stopReason, 'completed')
    assert.equal(done.size, 5); assert.equal(peak, 3)
  } finally { controller.abort(); for (const release of releases.values()) release(); await run.result.catch(() => {}); await run.dispose() }
})


test('a failed unit stops new dispatch while other running units keep their completed results', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'parallel-failure-'))
  const controller = new AbortController()
  let created = 0
  const settled = [], disposed = []
  const releases = []
  const actions = Array.from({ length: 4 }, (_, i) => ({ action_id: `failure:${i}`, role: 'analysis', stage: 'unit_analysis', action: 'dispatch_agent' }))
  const run = createSourceFirstAcpRun({ providerId: 'pangea-nga', parent: {}, cwd: root, dataRoot: root, runId: 'failure', signal: controller.signal,
    runner: async ({ args }) => {
      if (args[0] === 'task-open') return { task: {} }
      if (args[1] === 'next') return { run_id: 'failure', actions }
      if (args[1] === 'settle') settled.push(args[args.indexOf('--action-id') + 1])
      return {}
    }, subagents: { start: async () => {
      const number = created++, id = `worker-${number}`
      return { id, remoteSessionId: `remote-${number}`, result: Promise.resolve({ stopReason: 'completed' }), dispose: async () => disposed.push(id),
        continuePrompt: async () => {
          await new Promise(resolve => { releases.push(resolve); if (releases.length === 3) for (const release of releases) release() })
          if (number === 0) throw new Error('unit transport failed')
          await new Promise(resolve => setTimeout(resolve, 10))
          return { stopReason: 'completed' }
        } }
    } } })
  try {
    await assert.rejects(run.result, /unit transport failed/)
    assert.equal(created, 3)
    assert.deepEqual(settled.sort(), ['failure:1', 'failure:2'])
    assert.equal(disposed.length, 3)
  } finally { controller.abort(); await run.dispose(); await rm(root, { recursive: true, force: true }) }
})
