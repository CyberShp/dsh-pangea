import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TaskStore } from '../src/task-store.js'
import { deriveAnalysisInput } from '../src/workbench-api.js'
import { CaseReviewStore, caseContentHash } from '../src/case-review-store.js'
import { AcpSettingsStore, ACP_RUNTIME_CONFIG_ENV } from '../src/acp-settings.js'
import { createSourceFirstAcpRun, stopSourceFirstAcpRun, sourceFirstAcpUpdateBusy } from '../src/source-first-acp.js'

test('#34 corrupt task index is preserved and refuses overwrite when creating a new task', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-audit34-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const storePath = path.join(root, 'tasks.json')
  const corruptContent = '{"version":2,"tasks":{"task-old":{"repository":"demo","target":"keep me"}}'
  await writeFile(storePath, corruptContent, 'utf8')

  const store = new TaskStore({ storePath })
  await store.ready
  assert.ok(store.loadError)
  assert.equal(store.loadError.code, 'TASK_STORE_CORRUPTED')

  await assert.rejects(
    () => store.create({ workspace: root, dataRoot: root, input: { repository: 'demo', target: 'new task' } }),
    /任务索引文件损坏/,
  )
  // Original corrupt file must remain untouched for recovery
  assert.equal(await readFile(storePath, 'utf8'), corruptContent)
})

test('#36 stopSourceFirstAcpRun does not succeed or clear upgrade busy gate while a timed-out pending start is still draining', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-audit36-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dataRoot = path.join(root, 'data')
  const runId = 'run-audit36'
  await mkdir(path.join(dataRoot, 'runs', runId), { recursive: true })

  let resolveStart
  let disposedCount = 0
  const subagents = {
    start: () => new Promise(resolve => {
      resolveStart = () => resolve({
        id: 'worker-late-1',
        remoteSessionId: 'remote-late-1',
        dispose: async () => { disposedCount += 1 },
        readOutput: () => '',
        readDiagnostics: () => ({}),
      })
    }),
  }
  const runner = async ({ args }) => {
    const op = args[0] === 'adapter' ? args[1] : args[0]
    if (op === 'next') {
      return {
        run_id: runId,
        lifecycle_status: 'running',
        actions: [{
          action: 'dispatch_agent',
          action_id: 'act-1',
          stage: 'unit_planning',
          role: 'planner',
          scratch_directory: path.join(root, 'scratch'),
          result_path: path.join(root, 'result.json'),
        }],
      }
    }
    if (op === 'claim') {
      return {
        run_id: runId,
        action_id: 'act-1',
        task_id: 'task-1',
        scratch_directory: path.join(root, 'scratch'),
        result_path: path.join(root, 'result.json'),
      }
    }
    if (op === 'task-open') {
      return {
        run_id: runId,
        action_id: 'act-1',
        task_id: 'task-1',
        task: {
          run_id: runId,
          task_id: 'task-1',
          action_id: 'act-1',
          stage: 'unit_planning',
          scratch_directory: path.join(root, 'scratch'),
          result_path: path.join(root, 'result.json'),
        },
        write_contract: { revision: 0, capabilities: [] },
      }
    }
    return { status: 'ok' }
  }

  const coordinator = createSourceFirstAcpRun({
    subagents,
    parent: { id: 'owner-1' },
    providerId: 'pangea-opencode',
    agentModel: 'fixture',
    cwd: root,
    dataRoot,
    runId,
    runner,
    signal: new AbortController().signal,
    progressPolicy: { readyIdleMs: 40, readyWarnMs: 20 },
  })
  let coordError = null
  coordinator.result.catch(err => { coordError = err })

  // Wait for startWorker to time out (40ms) while subagents.start is still unresolved
  await new Promise(r => setTimeout(r, 120))
  assert.ok(resolveStart, `subagents.start must have been invoked (coordError=${coordError?.message || 'none'})`)
  assert.equal(sourceFirstAcpUpdateBusy(), true, 'upgrade busy gate must stay busy while pending start is unresolved')

  // Calling stop with short pendingStartTimeoutMs must reject instead of falsely reporting stopped
  await assert.rejects(
    () => stopSourceFirstAcpRun({ dataRoot, runId, pendingStartTimeoutMs: 50 }),
    /仍有 \d+ 个启动中的 ACP Agent 正在收尾清理/,
  )
  assert.equal(sourceFirstAcpUpdateBusy(), true, 'upgrade busy gate must remain busy after stop times out on pending start')

  // Once the late start resolves and disposes, cleanup completes and busy gate clears
  resolveStart()
  await new Promise(r => setTimeout(r, 80))
  assert.equal(disposedCount, 1)
  assert.equal(sourceFirstAcpUpdateBusy(), false)
})

test('#37 deriveAnalysisInput inherits test_tool_sources and expected_test_tool_revision for supplement', () => {
  const parent = {
    task_id: 'task-parent',
    run_id: 'run-parent',
    workflow_version: 'source-first-v1',
    repository: 'demo',
    target: '模块分析',
    scenario: 'module-analysis',
    mode: 'depth',
    analysis_profile: 'behavior-test-v2',
    source_scope: ['product/src'],
    test_tool_sources: [{ repo_id: 'demo', paths: ['ut/tools'] }],
    expected_test_tool_revision: 'rev-123',
    context_scope: [],
    asset_ids: [],
    provider: 'pangea-opencode',
    agent_model: 'fixture',
  }
  const derived = deriveAnalysisInput(
    parent,
    { mode: 'supplement', instruction: '补测异常分支', selected_unit_ids: ['unit-0001'] },
    { can_derive: true, parent_run_id: 'run-parent', units: [{ unit_id: 'unit-0001' }], records: [] },
  )
  assert.deepEqual(derived.test_tool_sources, [{ repo_id: 'demo', paths: ['ut/tools'] }])
  assert.equal(derived.expected_test_tool_revision, 'rev-123')
})

test('#38 editing linked operation notes changes caseContentHash and invalidates prior adoption', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-audit38-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = new CaseReviewStore({ dataRoot: root, runId: 'run-audit38' })

  const baseCase = {
    projection_id: 'unit-0001/rec-000001',
    title: 'IO 读路径验证',
    steps: ['下发读请求'],
    expected_result: '返回成功',
    linked_notes: [{
      projection_id: 'unit-0001/note-000001',
      unit_id: 'unit-0001',
      display_id: 'NOTE-1',
      title: '操作说明',
      source_record: { record_id: 'note-000001', body: '下发 4K 读' },
    }],
  }

  const before = await store.project([baseCase])
  await store.update([baseCase], {
    case_key: baseCase.projection_id,
    decision: 'adopted',
    expected_revision: before.revision,
    expected_content_hash: caseContentHash(baseCase),
  })
  const adopted = await store.project([baseCase])
  assert.equal(adopted.cases[0].review_status, 'adopted')

  // Mutate linked note body from 4K read to 4K write
  const editedCase = structuredClone(baseCase)
  editedCase.linked_notes[0].source_record.body = '下发 4K 写'
  assert.notEqual(caseContentHash(editedCase), caseContentHash(baseCase))
  const afterEdit = await store.project([editedCase])
  assert.notEqual(afterEdit.case_set_revision, adopted.case_set_revision)
  assert.notEqual(afterEdit.cases[0].review_status, 'adopted')
})

test('#39 concurrent AcpSettingsStore.save calls all succeed and keep disk and process.env consistent', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-audit39-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const prevEnv = process.env[ACP_RUNTIME_CONFIG_ENV]
  t.after(() => {
    if (prevEnv === undefined) delete process.env[ACP_RUNTIME_CONFIG_ENV]
    else process.env[ACP_RUNTIME_CONFIG_ENV] = prevEnv
  })

  const filePath = path.join(root, 'acp-runtime-v1.json')
  const storeA = new AcpSettingsStore({ filePath })
  const storeB = new AcpSettingsStore({ filePath })

  for (let i = 0; i < 10; i += 1) {
    const cfgA = { version: 1, providers: { 'pangea-opencode': { command: `cmd-a-${i}` } } }
    const cfgB = { version: 1, providers: { 'pangea-opencode': { command: `cmd-b-${i}` } } }
    const results = await Promise.all([storeA.save(cfgA), storeB.save(cfgB)])
    assert.equal(results.length, 2)
    const onDisk = JSON.parse(await readFile(filePath, 'utf8'))
    const inEnv = JSON.parse(process.env[ACP_RUNTIME_CONFIG_ENV])
    assert.deepEqual(inEnv, onDisk, `iteration ${i}: process.env and disk must match`)
  }
})
