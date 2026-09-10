import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRun, runPangea } from '../src/pangea-api.js'
import { sourceFirstTools } from '../src/index.js'
import { companionSnapshot } from '../src/reader.js'

const runtime = process.env.PANGEA_INTEGRATION_RUNTIME

test('semantic runtime creates, binds, plans, settles and resumes the same Run through DSH', {
  skip: !runtime && 'Set PANGEA_INTEGRATION_RUNTIME and PANGEA_PYTHON to run the real CLI integration.',
}, async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'dsh-semantic-runtime-'))
  const keys = ['PYTHONPATH', 'PANGEA_RUNTIME_ROOT', 'PANGEA_DATA_ROOT']
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  try {
    process.env.PYTHONPATH = path.join(runtime, 'src')
    process.env.PANGEA_RUNTIME_ROOT = runtime
    process.env.PANGEA_DATA_ROOT = path.join(cwd, 'pangea-data')
    await cp(path.join(runtime, '.agents'), path.join(cwd, '.agents'), { recursive: true })
    const repository = path.join(cwd, 'pangea-data', 'repositories', 'sample')
    await mkdir(repository, { recursive: true })
    await writeFile(path.join(repository, 'sample.c'), 'int add(int a, int b) { return a + b; }\n')
    const run = await createRun(cwd, {
      repository: 'sample', target: 'DSH semantic interface fixture',
      source_scope: ['sample.c'], effective_context_budget: 204800,
    })
    const tools = new Map()
    sourceFirstTools({ tools: { register(tool) { tools.set(tool.name, tool); return () => {} } } })
    const exec = { agent: { session: { header: { cwd } } } }
    const call = (name, args) => tools.get(name).execute(args, exec)
    const binding = {
      data_root: run.data_root, run_id: run.run_id,
      action_id: run.agent_actions[0].action_id, task_id: 'fixture-planner',
    }
    await call('pangea_action_bind', binding)
    const opened = await call('pangea_task_open', binding)
    assert.equal(opened.binding.task_id, binding.task_id)
    const index = await call('pangea_source_index', binding)
    assert.equal(index.files[0].path, 'sample.c')
    const saved = await call('pangea_plan_write', {
      ...binding, expected_revision: 0,
      unit: { title: 'Add', purpose: 'Interface fixture', owned_files: [{ repo_id: 'sample', path: 'sample.c' }] },
    })
    assert.equal(saved.diagnostics.ready, true)
    await call('pangea_work_finish', { ...binding, revision: saved.revision })
    const settled = await call('pangea_action_settle', binding)
    assert.equal(settled.stage, 'analyzing')
    assert.equal(settled.agent_actions[0].role, 'analysis')
    const resumed = await runPangea({ cwd, args: ['resume-run', '--data-root', run.data_root, '--run-id', run.run_id] })
    assert.equal(resumed.run_id, run.run_id)
    assert.equal(resumed.data_root, run.data_root)
    const progress = JSON.parse(await readFile(path.join(run.data_root, 'runs', run.run_id, 'progress.json'), 'utf8'))
    assert.equal(progress.effective_context_budget, 204800)
    const snapshot = await companionSnapshot({ cwd, dataRoot: run.data_root, runId: run.run_id })
    assert.equal(snapshot.current.run_id, run.run_id)
    assert.equal(snapshot.current.lifecycle_status, 'running')
    await runPangea({ cwd, args: ['runs', 'stop', '--data-root', run.data_root, '--run-id', run.run_id] })
    const stopped = await companionSnapshot({ cwd, dataRoot: run.data_root, runId: run.run_id })
    assert.equal(stopped.current.lifecycle_status, 'stopped')
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    await rm(cwd, { recursive: true, force: true })
  }
})
