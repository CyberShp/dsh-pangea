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
    await writeFile(path.join(repository, 'sample.c'), 'int add(int a, int b) { return a + b; }\n' + Array.from({ length: 100 }, (_, i) => `// frozen line ${i} ${'x'.repeat(60)}\n`).join(''))
    const run = await createRun(cwd, {
      repository: 'sample', target: 'DSH semantic interface fixture',
      source_scope: ['sample.c'], effective_context_budget: 204800,
    })
    const contractPath = path.join(run.data_root, 'runs', run.run_id, 'inputs', 'task-contract.json')
    const frozen = JSON.parse(await readFile(contractPath, 'utf8'))
    assert.deepEqual(frozen.analysis_settings, { scenario: 'module-analysis', mode: 'depth' })
    assert.match(frozen.runtime_provenance.agent.files_sha256['src/pangea_agent/models/contract.py'], /^[a-f0-9]{64}$/)
    assert.match(frozen.runtime_provenance.dsh.files_sha256['src/pangea-api.js'], /^[a-f0-9]{64}$/)
    assert.ok(frozen.runtime_provenance.workspace_rules_sha256['.agents/pangea/dsh.md'])
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
    const analysisBinding = { ...binding, action_id: settled.agent_actions[0].action_id, task_id: 'fixture-analysis' }
    await call('pangea_action_bind', analysisBinding)
    const prepared = await call('pangea_task_open', { ...analysisBinding, prepare_source: true })
    assert.equal(prepared.prepared_source.source_delivery_complete, true)
    assert.match(prepared.prepared_source.pages[0].source.text, /return a \+ b/)
    const page = await call('pangea_source_read', { ...analysisBinding, repo_id: 'sample', path: 'sample.c' })
    assert.equal(page.request_complete, true)
    assert.match(page.text, /return a \+ b/)
    let paged = await call('pangea_source_read', { ...analysisBinding, repo_id: 'sample', path: 'sample.c', max_chars: 1400 })
    assert.ok(paged.next_read)
    let delivered = paged.text
    while (paged.next_read) {
      paged = await call('pangea_source_read', { ...analysisBinding, ...paged.next_read, max_chars: 1400 })
      delivered += '\n' + paged.text
    }
    assert.equal(paged.request_complete, true)
    assert.equal(delivered.split('\n').length, 101)
    assert.match(delivered, /frozen line 99/)
    const note = await call('pangea_result_write', { ...analysisBinding, expected_revision: 0,
      records: [{ kind: 'note', body: '输入 1 和 2，结果 4。', evidence: ['sample:sample.c:1'] }] })
    const edits = [{ path: [], old: '结果 4', new: '结果 3' }]
    const corrected = await call('pangea_result_supersede', { ...analysisBinding, expected_revision: note.revision,
      target_record_ids: ['rec-000001'], edits, request_id: 'correction-1' })
    const after = await call('pangea_result_read', analysisBinding)
    assert.ok(JSON.stringify(after).includes('结果 3'))
    assert.ok(JSON.stringify(after).includes('结果 4'))
    const retry = await call('pangea_result_supersede', { ...analysisBinding, expected_revision: note.revision,
      target_record_ids: ['rec-000001'], edits, request_id: 'correction-1' })
    assert.equal(retry.revision, corrected.revision)
    await assert.rejects(() => call('pangea_result_supersede', { ...analysisBinding, expected_revision: corrected.revision,
      target_record_ids: ['rec-000002'], edits }), /唯一匹配/)
    assert.equal((await call('pangea_result_read', analysisBinding)).revision, corrected.revision)
    await call('pangea_work_finish', { ...analysisBinding, revision: corrected.revision })
    const reviewed = await call('pangea_action_settle', analysisBinding)
    assert.equal(reviewed.agent_actions[0].role, 'review')
    const reviewBinding = { ...binding, action_id: reviewed.agent_actions[0].action_id, task_id: 'fixture-reviewer' }
    await call('pangea_action_bind', reviewBinding)
    const reviewTask = await call('pangea_task_open', { ...reviewBinding, prepare_source: true })
    assert.equal(reviewTask.prepared_source.source_delivery_complete, true)
    assert.match(JSON.stringify(reviewTask.prepared_source.pages), /return a \+ b/)
    const reviewNote = await call('pangea_result_write', { ...reviewBinding, expected_revision: 0, records: [{ kind: 'note', body: '已核对加法源码。' }] })
    await call('pangea_work_finish', { ...reviewBinding, revision: reviewNote.revision })
    const comparison = await call('pangea_action_settle', reviewBinding)
    const comparisonBinding = { ...reviewBinding, action_id: comparison.agent_actions[0].action_id }
    await call('pangea_action_bind', comparisonBinding)
    const comparisonTask = await call('pangea_task_open', comparisonBinding)
    const decision = await call('pangea_review_decide', { ...comparisonBinding, expected_revision: 0, decision: { version_set_id: comparisonTask.task.version_set_id, disposition: 'pass', summary: 'fixture review complete' } })
    await call('pangea_work_finish', { ...comparisonBinding, revision: decision.revision })
    const complete = await call('pangea_action_settle', comparisonBinding)
    assert.equal(complete.lifecycle_status, 'complete')
    const resumed = await runPangea({ cwd, args: ['resume-run', '--data-root', run.data_root, '--run-id', run.run_id] })
    assert.deepEqual(JSON.parse(await readFile(contractPath, 'utf8')), frozen)
    assert.equal(resumed.run_id, run.run_id)
    assert.equal(resumed.data_root, run.data_root)
    const progress = JSON.parse(await readFile(path.join(run.data_root, 'runs', run.run_id, 'progress.json'), 'utf8'))
    assert.equal(progress.effective_context_budget, 204800)
    const snapshot = await companionSnapshot({ cwd, dataRoot: run.data_root, runId: run.run_id })
    assert.equal(snapshot.current.run_id, run.run_id)
    assert.equal(snapshot.current.lifecycle_status, 'complete')
    await assert.rejects(() => runPangea({ cwd, args: ['runs', 'stop', '--data-root', run.data_root, '--run-id', run.run_id] }), /已经完成/)
    const stopped = await companionSnapshot({ cwd, dataRoot: run.data_root, runId: run.run_id })
    assert.equal(stopped.current.lifecycle_status, 'complete')
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    await rm(cwd, { recursive: true, force: true })
  }
})
