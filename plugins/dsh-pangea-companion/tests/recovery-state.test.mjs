import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import test from 'node:test'
import { inspectAcpBindings, processPresence } from '../src/acp-recovery.js'
import { assessTaskResumeEligibility, applyTaskExecutionState } from '../src/index.js'
import { createTaskStore } from '../src/task-store.js'
import { runtimeObservation } from '../src/runtime-observation.js'
import { launchAnalysisSession } from '../src/workbench-api.js'
import { resumeRun } from '../src/pangea-api.js'

test('recovery proves absence conservatively without treating reused PIDs or permissions as death', () => {
  const saved = { owner: { pid: 10, instance_id: 'old-host', active: true }, workers: {
    worker: { process_id: 11, blocked: true, inflight: true, remoteSessionId: 'remote' },
  } }
  assert.equal(inspectAcpBindings(saved, { presence: () => 'absent' }).can_resume, true)
  assert.equal(inspectAcpBindings(saved, { presence: () => 'present' }).can_resume, false)
  assert.equal(inspectAcpBindings(saved, { presence: () => 'unknown' }).can_resume, false)
  assert.equal(inspectAcpBindings(saved, { presence: pid => pid === 10 ? 'absent' : 'present' }).can_resume, false)
  assert.equal(processPresence(process.pid), 'present')
  assert.equal(processPresence(null), 'unknown')
  assert.equal(inspectAcpBindings({ ...saved, owner: { active: false, pending_starts: ['unfinished'] } }, { presence: () => 'absent' }).can_resume, false)
  assert.equal(inspectAcpBindings({ workers: { old: { remoteSessionId: 'unverified' } } }).can_resume, false)
})

test('an interrupted durable task resumes only after its bound host and worker have exited', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-task-recovery-'))
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  await once(child, 'exit')
  assert.equal(processPresence(child.pid), 'absent')
  const storePath = path.join(root, 'tasks.json')
  let tasks = createTaskStore({ storePath })
  try {
    const created = await tasks.create({ workspace: root, dataRoot: root, input: { repository: 'sample', target: '恢复', provider_id: 'pangea-nga' } })
    const prepared = await tasks.prepareProviderLaunch(created.task_id, 'pangea-nga')
    await tasks.bindRun(created.task_id, 'run', 'source-first-v1')
    await tasks.bindJob(created.task_id, { jobId: 'job', provider: 'pangea-nga', attemptId: prepared.attempt_id, ownerSessionId: 'owner', jobStartedAt: 100 })
    await tasks.markInterrupted(created.task_id, 'fixture host restart')
    tasks = createTaskStore({ storePath })
    const task = await tasks.get(created.task_id)
    const directory = path.join(root, 'runs', 'run')
    await mkdir(directory, { recursive: true })
    const saved = { runId: 'run', owner: { pid: child.pid, instance_id: 'previous-host', active: true, pending_starts: [] },
      workers: { original: { remoteSessionId: 'remote', process_id: process.pid, blocked: true, inflight: true } } }
    await writeFile(path.join(directory, 'acp-workers.json'), JSON.stringify(saved))
    const runtime = { jobs: { get: () => undefined } }
    assert.equal((await assessTaskResumeEligibility(runtime, task)).can_resume, false)
    saved.workers.original.process_id = child.pid
    await writeFile(path.join(directory, 'acp-workers.json'), JSON.stringify(saved))
    assert.equal((await assessTaskResumeEligibility(runtime, task)).can_resume, true)
    assert.equal((await assessTaskResumeEligibility({ jobs: { get: () => ({ startedAt: 100, status: 'running' }) } }, task)).can_resume, false)
    assert.equal((await tasks.get(created.task_id)).attempt_id, prepared.attempt_id, 'read-only assessment does not create or rebind a worker')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('runtime observation separates received communication from saved progress and ignores prose claims', () => {
  const task = { attempt_id: 'current', execution_status: 'running' }
  const event = (stage, at, fields = {}) => ({ stage, at: new Date(at).toISOString(), attempt_id: 'current', ...fields })
  const events = [
    event('source_first_worker_started', 1000, { action_id: 'a', unit_id: 'unit' }),
    event('source_first_tool_event', 2000, { action_id: 'a', unit_id: 'unit', tool_kind: 'read', last_tool_status: 'in_progress' }),
    event('source_first_tool_event', 3000, { action_id: 'b', tool_kind: 'edit', last_tool_status: 'in_progress' }),
    event('source_first_tool_event', 4000, { action_id: 'b', last_tool_status: 'completed' }),
    event('source_first_waiting', 8000, { message: '正在读取源码并写结果', action_id: 'a' }),
    { ...event('source_first_tool_event', 9000, { action_id: 'a', tool_kind: 'edit', last_tool_status: 'in_progress' }), attempt_id: 'old' },
  ]
  const observed = runtimeObservation(task, events, { can_resume: false })
  assert.equal(observed.activity.kind, 'reading')
  assert.equal(observed.activity.unit_id, 'unit')
  assert.equal(observed.last_communication_at_ms, 4000)
  assert.equal(observed.last_effective_progress, undefined)
  assert.equal(runtimeObservation({ ...task, execution_status: 'interrupted' }, events).activity.kind, 'disconnected')
  assert.equal(runtimeObservation(task, [event('acp_output', 2000, { output: 'reading source' })]).activity.kind, 'unknown')
  assert.equal(runtimeObservation({ ...task, execution_status: 'starting' }, []).connection_status, 'connecting')
  assert.equal(runtimeObservation(task, []).connection_status, 'unknown')
  assert.equal(observed.connection_status, 'connected')
  const sibling = runtimeObservation(task, [event('source_first_tool_event', 1000, {
    action_id: 'parallel-tools', tool_kind: 'read', last_tool_status: 'completed', active_tool_count: 1,
  })])
  assert.equal(sibling.activity.kind, 'tool_running')
})

test('a lost host does not downgrade an already verified source-first report', () => {
  const result = applyTaskExecutionState({ current: { run_id: 'run', workflow_version: 'source-first-v1', lifecycle_status: 'complete', report_available: true } },
    { task_id: 'task', run_id: 'run', attempt_id: 'attempt', status: 'failed', execution_status: 'interrupted' })
  assert.equal(result.current.lifecycle_status, 'complete')
  assert.equal(result.current.report_available, true)
  assert.equal(result.current.external_execution.status, 'interrupted')
})

test('native DSH blocks busy/unknown owners and resumes the original owner after a proven host exit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-native-recovery-'))
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  await once(child, 'exit')
  try {
    await mkdir(path.join(root, '.agents', 'pangea'), { recursive: true })
    await writeFile(path.join(root, '.agents', 'pangea', 'dsh.md'), '# fixture')
    const task = { task_id: 'native', data_root: root, run_id: 'run', workflow_version: 'source-first-v1',
      provider: null, status: 'failed', execution_status: 'failed', owner_session_id: 'original-owner', host_process_id: child.pid }
    assert.equal((await assessTaskResumeEligibility({ agents: { get: () => ({ id: 'original-owner', status: 'running' }) } }, task)).can_resume, false)
    assert.equal((await assessTaskResumeEligibility({ agents: { get: () => ({ id: 'original-owner', status: 'idle', whenIdle: () => new Promise(() => {}) }) } }, task)).can_resume, false)
    assert.equal((await assessTaskResumeEligibility({ agents: { get: () => undefined } }, { ...task, host_process_id: null })).can_resume, false)
    const eligibility = await assessTaskResumeEligibility({ agents: { get: () => undefined } }, task)
    assert.equal(eligibility.can_resume, true)
    assert.equal(eligibility.host_quiescent, true)
    const ok = value => ({ result: { ok: true, value } })
    const prompts = [], ownerBindings = [], calls = []
    const api = {
      llm: { providers: async () => ok({ providers: [{ provider: 'model-provider', active: true, declared: true, settingsNs: 'models', settingsPath: [] }] }),
        models: async () => ok({ groups: [{ id: 'model-provider', models: [{ id: 'model' }] }], failures: [] }) },
      settings: { describe: async () => ok({ namespaces: [{ ns: 'models', value: {} }] }) },
      sessions: { selectModel: async () => ok({}), create: async () => assert.fail('native continuation must not replace its owner'),
        prompt: async request => { prompts.push(request.payload); return ok({}) } },
    }
    const capabilities = { workflow_versions: ['source-first-v1'], repositories: ['sample'],
      source_first: { version: 'source-first-v1', execution_recovery: { host_quiescent_resume: true, execution_ids: true } } }
    const runner = async ({ args }) => {
      calls.push(args)
      if (args[0] === 'system') return capabilities
      assert.equal(args[1], 'resume')
      assert.ok(args.includes('--host-quiescent'))
      return { workflow_version: 'source-first-v1', run_id: 'run', data_root: root, agent_actions: [] }
    }
    const value = await launchAnalysisSession(api, { cwd: root, dataRoot: root, input: { repository: 'sample', target: 'native恢复' },
      model: { provider: 'model-provider', model: 'model' }, resumeRunId: 'run', hostQuiescent: true, resumeOwnerSessionId: 'original-owner' },
    runner, async () => {}, async () => {}, undefined, process.env, { onOwnerReady: value => ownerBindings.push(value.ownerSessionId) })
    assert.equal(value.session_id, 'original-owner')
    assert.deepEqual(ownerBindings, ['original-owner'])
    assert.equal(prompts[0].sessionId, 'original-owner')
    await assert.rejects(resumeRun(root, { dataRoot: root, runId: 'run' }, async () => ({ run_id: 'run', requires_host_quiescence: true })), /原执行尚未确认/)
    capabilities.source_first.execution_recovery = undefined
    await assert.rejects(launchAnalysisSession(api, { cwd: root, input: { repository: 'sample', target: 'native' },
      model: { provider: 'model-provider', model: 'model' }, resumeRunId: 'run' }, runner), /不支持.*安全续跑/)
    assert.equal(prompts.length, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})
