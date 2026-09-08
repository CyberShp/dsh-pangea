import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createView, listViews, updateView, viewArtifact } from '../src/architecture-views.js'
import { normalizeRunInput, launchArchitectureSession } from '../src/workbench-api.js'
import { createRun } from '../src/pangea-api.js'
import { TaskStore } from '../src/task-store.js'

const capabilities = { repositories: ['repo'], analysis_skill: { skill_id: 'codetalks-skill', version: '1.4.0' } }
test('coverage request preserves exact query version and optional scope end to end', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'coverage-input-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, '.agents/pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents/pangea/dsh.md'), '# synthetic')
  const input = normalizeRunInput({ repository: 'repo', target: 'synthetic', scenario: 'coverage-analysis', source_scope: [],
    coverage_input: { kind: 'query', query: { product: 'P', c_version: ' VERSION A ', module: 'M' } } }, capabilities)
  assert.deepEqual(input.source_scope, [])
  let captured
  await createRun(root, input, async ({ args }) => {
    if (args[0] === 'system') return capabilities
    captured = JSON.parse(await readFile(args.at(-1), 'utf8'))
    return { run_id: 'run' }
  })
  assert.equal(captured.coverage_input.query.c_version, ' VERSION A ')
  assert.deepEqual(captured.source_scope, [])
})

test('external diagram execution inherits selected model and never inspects main Run', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-session-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, '.agents/pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents/pangea/dsh.md'), '# synthetic')
  const ok = value => ({ result: { ok: true, value } })
  let agentOptions, hooks, session, bound
  const parent = { id: 'diagram-session' }
  const api = { sessions: {
    create: async () => ok({ sessionId: parent.id }), rename: async () => ok({}),
    selectModel: async () => { throw new Error('external route must not select internal model') },
  } }
  const runtime = { agents: { get: id => id === parent.id ? parent : null },
    subagents: { getProvider: () => ({}), start: async (_provider, input) => {
      agentOptions = input.agentOptions
      return { id: 'external-session', result: Promise.resolve({ stopReason: 'completed', output: [] }), dispose() {} }
    } },
    jobs: { start: options => { hooks = options.run(); return 'diagram-job' }, get: () => ({ startedAt: 42 }), wait: async () => ({ status: 'completed' }) },
  }
  const result = await launchArchitectureSession(api, { cwd: root, task: { target: 'synthetic', provider: 'pangea-opencode', agent_model: 'selected-model' }, prompt: 'Draw synthetic workflow',
    onSession: id => { session = id }, onJob: value => { bound = value } }, runtime)
  assert.equal(result.session_id, session)
  assert.equal(bound.jobId, 'diagram-job')
  assert.equal((await hooks.done).status, 'completed')
  assert.deepEqual(agentOptions, { model: 'selected-model' })
})

test('view creation and failure keep main artifacts and previous good view unchanged', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'archify-view-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const run = path.join(root, 'runs', 'run')
  await mkdir(path.join(run, '内部索引'), { recursive: true })
  const original = JSON.stringify({ run_id: 'run', publication: { revision: 3 }, business_flows: [{ flow_id: 'FLOW-1', title: 'synthetic' }], risks: [], test_cases: [], evidence: [] })
  await writeFile(path.join(run, '内部索引/工作台投影.json'), original)
  await writeFile(path.join(run, '内部索引/运行状态.json'), 'unchanged')
  const skill = path.join(root, 'archify')
  await mkdir(path.join(skill, 'bin'), { recursive: true })
  await writeFile(path.join(skill, 'SKILL.md'), '# Synthetic fixture')
  await writeFile(path.join(skill, 'bin/archify.mjs'), '')
  const task = { task_id: 'task', run_id: 'run', data_root: root, target: 'synthetic' }
  const env = { PANGEA_ARCHIFY_ROOT: skill }
  const first = await createView(task, { flow_id: 'FLOW-1' }, env)
  const firstDir = path.join(run, '派生视图/archify', first.view.view_id)
  await writeFile(path.join(firstDir, 'candidate.json'), '{}')
  await writeFile(path.join(firstDir, 'diagram.html'), '<html>synthetic</html>')
  await writeFile(path.join(firstDir, 'validation-receipt.json'), '{"ok":true}')
  const second = await createView(task, { previous_view_id: first.view.view_id }, env)
  await updateView(task, second.view.view_id, { status: 'failed', error: 'synthetic failure' })
  const views = await listViews(task)
  assert.equal(views.find(v => v.view_id === first.view.view_id).status, 'ready')
  assert.equal(views.find(v => v.view_id === second.view.view_id).status, 'failed')
  assert.equal((await viewArtifact(task, first.view.view_id, 'html')).toString(), '<html>synthetic</html>')
  assert.equal(await readFile(path.join(run, '内部索引/工作台投影.json'), 'utf8'), original)
  assert.equal(await readFile(path.join(run, '内部索引/运行状态.json'), 'utf8'), 'unchanged')
  await assert.rejects(viewArtifact(task, '../run', 'html'))
  await assert.rejects(viewArtifact({ ...task, task_id: 'other' }, first.view.view_id, 'html'), /binding/)
})
