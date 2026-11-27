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

test('#36 late-arriving worker whose first dispose fails stays retryable on subsequent stop calls and clears disk pending_starts', async t => {
  const { acpBindingsPath } = await import('../src/acp-recovery.js')
  const { inspectSourceFirstAcpRecovery } = await import('../src/source-first-acp.js')
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-audit36-retry-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dataRoot = path.join(root, 'pangea-data')
  const runId = 'run-audit36-retry'
  await mkdir(path.join(dataRoot, 'runs', runId), { recursive: true })

  let resolveStart = null
  let disposeCalls = 0
  const subagents = {
    start: () => new Promise(resolve => {
      resolveStart = () => resolve({
        id: 'late-worker-retry-1',
        remoteSessionId: 'remote-retry-1',
        result: Promise.resolve({ stopReason: 'completed' }),
        dispose: async () => {
          disposeCalls += 1
          if (disposeCalls === 1) throw new Error('transient dispose I/O failure')
        },
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
          action_id: 'act-retry-1',
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
        action_id: 'act-retry-1',
        task_id: 'task-retry-1',
        scratch_directory: path.join(root, 'scratch'),
        result_path: path.join(root, 'result.json'),
      }
    }
    if (op === 'task-open') {
      return {
        run_id: runId,
        action_id: 'act-retry-1',
        task_id: 'task-retry-1',
        task: {
          run_id: runId,
          task_id: 'task-retry-1',
          action_id: 'act-retry-1',
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
    parent: { id: 'owner-retry-1' },
    providerId: 'pangea-opencode',
    agentModel: 'fixture',
    cwd: root,
    dataRoot,
    runId,
    runner,
    signal: new AbortController().signal,
    progressPolicy: { readyIdleMs: 40, readyWarnMs: 20 },
  })
  coordinator.result.catch(() => {})

  await new Promise(r => setTimeout(r, 120))
  assert.ok(resolveStart)
  assert.equal(sourceFirstAcpUpdateBusy(), true)

  // Late handle arrives during stop #1 and its first dispose() fails:
  // stop #1 must surface the actual dispose failure (not swallow it) and keep the handle retryable
  setTimeout(() => resolveStart(), 25)
  await assert.rejects(
    () => stopSourceFirstAcpRun({ dataRoot, runId, pendingStartTimeoutMs: 300 }),
    /transient dispose I\/O failure/,
  )
  assert.equal(disposeCalls, 1)
  assert.equal(sourceFirstAcpUpdateBusy(), true)
  const bindingsPath = acpBindingsPath(dataRoot, runId)
  const bindingsBefore = JSON.parse(await readFile(bindingsPath, 'utf8'))
  assert.equal(bindingsBefore.owner.pending_starts.length, 1)
  const recoveryBefore = await inspectSourceFirstAcpRecovery({ dataRoot, runId })
  assert.equal(recoveryBefore.can_resume, false)

  // Stop #2 retries dispose() with a workbench-like onStopped callback that awaits the active stop operation:
  // must NOT self-deadlock and must resolve true cleanly
  let stop2Promise
  stop2Promise = stopSourceFirstAcpRun({
    dataRoot,
    runId,
    pendingStartTimeoutMs: 200,
    onStopped: async () => { await stop2Promise },
  })
  const stopped = await Promise.race([
    stop2Promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('self-deadlock on onStopped')), 500)),
  ])
  assert.equal(stopped, true)
  assert.equal(disposeCalls, 2)
  assert.equal(sourceFirstAcpUpdateBusy(), false)
  const bindingsAfter = JSON.parse(await readFile(bindingsPath, 'utf8'))
  assert.equal(bindingsAfter.owner.pending_starts.length, 0)
  const recoveryAfter = await inspectSourceFirstAcpRecovery({ dataRoot, runId })
  assert.equal(recoveryAfter.can_resume, true)
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

test('#38 editing or reordering linked operation notes invalidates prior adoption while preserving legacy no-notes hash', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-audit38-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = new CaseReviewStore({ dataRoot: root, runId: 'run-audit38' })

  const noteOpen = {
    projection_id: 'unit-0001/note-000001',
    unit_id: 'unit-0001',
    display_id: 'NOTE-1',
    title: '打开开关',
    source_record: { record_id: 'note-000001', body: '下发 4K 读' },
  }
  const noteClose = {
    projection_id: 'unit-0001/note-000002',
    unit_id: 'unit-0001',
    display_id: 'NOTE-2',
    title: '关闭开关',
    source_record: { record_id: 'note-000002', body: '关闭状态' },
  }
  const baseCase = {
    projection_id: 'unit-0001/rec-000001',
    title: 'IO 读路径验证',
    steps: ['下发读请求'],
    expected_result: '返回成功',
    linked_notes: [noteOpen, noteClose],
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

  // Reordering linked notes must also change caseContentHash and case_set_revision
  const reorderedCase = structuredClone(baseCase)
  reorderedCase.linked_notes = [structuredClone(noteClose), structuredClone(noteOpen)]
  assert.notEqual(caseContentHash(reorderedCase), caseContentHash(baseCase))
  const afterReorder = await store.project([reorderedCase])
  assert.notEqual(afterReorder.case_set_revision, adopted.case_set_revision)
  assert.equal(afterReorder.cases[0].review_status, 'needs_recheck')

  // Legacy upgrade compatibility: a case with no linked_notes (undefined vs []) matches pre-fix hash without linked_notes key
  const noNotesUndefined = { projection_id: 'unit-0001/rec-000002', title: '无关联说明用例', steps: ['step1'], expected_result: 'ok' }
  const noNotesEmpty = { ...noNotesUndefined, linked_notes: [] }
  assert.equal(caseContentHash(noNotesEmpty), caseContentHash(noNotesUndefined))
  const { createHash } = await import('node:crypto')
  const legacyFields = ['title', 'case_type', 'test_level', 'verification_goal', 'entry', 'preconditions', 'step_pairs', 'steps', 'expected_result', 'expected_results', 'observability', 'external_observations', 'cleanup', 'variants', 'execution_readiness', 'readiness', 'readiness_reason', 'missing_execution_conditions', 'unit_id', 'linked_risk_ids', 'linked_flow_ids', 'coverage_refs', 'evidence']
  const canonical = value => Array.isArray(value) ? value.map(canonical) : (value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : (value ?? null))
  const legacyHash784 = createHash('sha256').update(JSON.stringify(canonical({
    ...Object.fromEntries(legacyFields.map(k => [k, noNotesEmpty[k] ?? null])),
    source_record: Object.fromEntries(['record_id', 'kind', 'body', 'evidence', 'relates_to'].map(k => [k, null])),
  }))).digest('hex')
  const legacyHashE3a = createHash('sha256').update(JSON.stringify(canonical({
    ...Object.fromEntries(legacyFields.map(k => [k, noNotesEmpty[k] ?? null])),
    linked_notes: [],
    source_record: Object.fromEntries(['record_id', 'kind', 'body', 'evidence', 'relates_to'].map(k => [k, null])),
  }))).digest('hex')
  assert.equal(caseContentHash(noNotesEmpty), legacyHash784)

  // v1 upgrade check:
  // 1) v1 decision for a case WITH linked notes (e.g. e3a0828 sorted hash) MUST become needs_recheck
  // 2) v1 decisions for unchanged cases WITHOUT linked notes (from both 784ad34 and e3a0828) stay adopted
  const noNotesE3a = { projection_id: 'unit-0001/rec-000003', title: '无关联说明用例B', steps: ['step2'], expected_result: 'ok', linked_notes: [] }
  const legacyHashE3aB = createHash('sha256').update(JSON.stringify(canonical({
    ...Object.fromEntries(legacyFields.map(k => [k, noNotesE3a[k] ?? null])),
    linked_notes: [],
    source_record: Object.fromEntries(['record_id', 'kind', 'body', 'evidence', 'relates_to'].map(k => [k, null])),
  }))).digest('hex')
  const v1Store = new CaseReviewStore({ dataRoot: root, runId: 'run-audit38-v1' })
  const v1File = await v1Store.file()
  await mkdir(path.dirname(v1File), { recursive: true })
  await writeFile(v1File, JSON.stringify({
    schema_version: 1,
    content_hash_version: 1,
    run_id: 'run-audit38-v1',
    revision: 3,
    decisions: {
      [baseCase.projection_id]: { decision: 'adopted', content_hash: caseContentHash(baseCase), updated_at: '2026-11-27T00:00:00.000Z' },
      [noNotesEmpty.projection_id]: { decision: 'adopted', content_hash: legacyHash784, updated_at: '2026-11-27T00:00:00.000Z' },
      [noNotesE3a.projection_id]: { decision: 'adopted', content_hash: legacyHashE3aB, updated_at: '2026-11-27T00:00:00.000Z' },
    },
  }, null, 2))
  const upgraded = await v1Store.project([baseCase, noNotesEmpty, noNotesE3a])
  const byId = new Map(upgraded.cases.map(c => [c.case_key, c.review_status]))
  assert.equal(byId.get(baseCase.projection_id), 'needs_recheck', 'v1 multi-note adoption cannot prove delivery order and must require re-adoption')
  assert.equal(byId.get(noNotesEmpty.projection_id), 'adopted', 'v1 784ad34 no-notes adoption must remain adopted')
  assert.equal(byId.get(noNotesE3a.projection_id), 'adopted', 'v1 e3a0828 no-notes adoption must remain adopted')
  assert.ok(legacyHashE3a !== legacyHash784)
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
