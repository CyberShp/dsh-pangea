import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { applyTaskExecutionState, deriveTaskResumeEligibility, reconcileAcpJobs, settleAcpTask } from '../src/index.js'

const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8')

test('task launch diagnostics are wired through direct Skill startup', () => {
  assert.match(source, /createLaunchLogStore/)
  assert.match(source, /LAUNCH_LOG_API_PATH/)
  assert.match(source, /stage: 'launch_requested'/)
  assert.match(source, /launchAnalysisSession/)
  assert.match(source, /stage: 'session_launch_complete'/)
  assert.match(source, /stage: 'launch_timeout'/)
  assert.match(source, /!\['preparing', 'running'\]\.includes\(task\.status\)/)
  assert.match(source, /launchLogRouteHandler/)
})

test('terminal tasks can resume the existing Run from its checkpoint', () => {
  assert.match(source, /const resume = body\.resume === true/)
  assert.match(source, /if \(task\.run_id && !resume\)/)
  assert.match(source, /resumeRunId: resume \? task\.run_id : null/)
  assert.match(source, /resumeEligibility\.can_resume/)
})

test('derives resume eligibility from the persisted execution identity and real Job terminal state', () => {
  const runtime = { jobs: { get() { return { id: 'job-1', startedAt: 100, status: 'failed' } } }, agents: { get() { return { id: 'owner-1' } } } }
  assert.deepEqual(deriveTaskResumeEligibility(runtime, {
    run_id: 'run-1', provider: 'pangea-opencode', status: 'failed', execution_status: 'failed',
    job_id: 'job-1', job_started_at: 100, owner_session_id: 'owner-1',
  }), { can_resume: true, resume_blocked_reason: null })
  assert.deepEqual(deriveTaskResumeEligibility(runtime, {
    run_id: 'run-1', provider: 'pangea-opencode', status: 'failed', execution_status: 'interrupted',
    job_id: 'job-1', job_started_at: 100, owner_session_id: 'owner-1',
  }), { can_resume: false, resume_blocked_reason: '旧执行停止尚未确认' })
  assert.equal(deriveTaskResumeEligibility(runtime, {
    run_id: 'run-1', provider: 'pangea-opencode', status: 'failed', execution_status: 'failed',
    job_id: 'job-1', job_started_at: 99, owner_session_id: 'owner-1',
  }).can_resume, false)

  assert.deepEqual(deriveTaskResumeEligibility({ jobs: { get() { return undefined } } }, {
    run_id: 'run-1', provider: 'pangea-opencode', status: 'failed', execution_status: 'failed',
    attempt_id: 'attempt-1', job_id: 'job-1', job_started_at: 100, owner_session_id: 'owner-1',
    attempts: [{
      attempt_id: 'attempt-1', job_id: 'job-1', job_started_at: 100, owner_session_id: 'owner-1',
      execution_status: 'failed', ended_at: 200,
    }],
  }), { can_resume: true, resume_blocked_reason: null })
})

test('does not read output from a reused Job id with a different startedAt', async () => {
  let interrupted
  let recorded = false
  const task = {
    task_id: 'task-1', execution_status: 'running', job_id: 'subagent-1', job_started_at: 100,
    owner_session_id: 'owner-1', attempts: [],
  }
  const runtime = {
    agents: { get() { return { id: 'owner-1' } } },
    jobs: {
      get() { return { id: 'subagent-1', kind: 'subagent', startedAt: 200, status: 'running' } },
      read() { throw new Error('must not read reused Job') },
    },
  }
  const tasks = {
    async recordJobActivity() { recorded = true },
    async markInterrupted(_taskId, message) { interrupted = message },
  }
  await reconcileAcpJobs(runtime, tasks, [task], { async append() {} })
  assert.equal(recorded, false)
  assert.match(interrupted, /身份不匹配/)
})

test('persists the Run identity as soon as creation succeeds', () => {
  assert.match(source, /onRunReady: run => tasks\.bindRun\(task\.task_id, run\.run_id\)/)
})

test('stops the local Run before attempting DSH session cancellation', () => {
  const stop = source.indexOf("const stopped = await stopAnalysisRun({ cwd, dataRoot: actionDataRoot, runId: body.run_id })")
  const cancel = source.indexOf('api.sessions.cancel', stop)
  assert.notEqual(stop, -1)
  assert.ok(cancel > stop)
  assert.doesNotMatch(source.slice(stop, cancel), /requireWorkspaceTask/)
  assert.match(source.slice(stop), /sessionCancel = \{\s*status: 'error'/)
})

test('treats exit 0 without validated final artifacts as an ACP failure', async () => {
  const events = []
  let outcome
  const task = {
    task_id: 'task-1', workspace: '/workspace', data_root: '/workspace/pangea-data', run_id: 'run-1',
    provider: 'pangea-opencode', model_route: { model: 'gpt-5.2-codex', reasoning_effort: 'high' },
  }
  const tasks = {
    async getByJob(id) { return id === 'job-1' ? task : null },
    async recordJobActivity() {},
    async settleJob(_id, value) { outcome = value; return value },
  }
  const launchLogs = { async append(_taskId, event) { events.push(event) } }
  const runtime = { jobs: { read() { return { text: 'agent exited normally' } } } }
  await settleAcpTask(runtime, tasks, launchLogs, { id: 'job-1', kind: 'subagent', status: 'completed' }, undefined, async () => ({
    run_id: 'run-1', lifecycle_status: 'running', report_available: false, phase: 'STEP_06',
  }))
  assert.equal(outcome.status, 'failed')
  assert.match(outcome.detail, /未形成通过验证的正式交付/)
  assert.equal(events[0].exit_status, 'failed')
  assert.equal(events[0].output, 'agent exited normally')
})

test('settles an ACP Job with its owner identity', async () => {
  let lookup
  let activity
  let settled
  const task = {
    task_id: 'task-identity', workspace: '/workspace', data_root: '/workspace/pangea-data', run_id: 'run-identity',
    provider: 'pangea-opencode', model_route: null, attempt_id: 'attempt-new', owner_session_id: 'owner-new',
    attempts: [{ attempt_id: 'attempt-old', job_id: 'job-identity', job_started_at: 100, owner_session_id: 'owner-1' }],
  }
  const tasks = {
    async getByJob(id, ref) { lookup = { id, ref }; return task },
    async recordJobActivity(ref, output) { activity = { ref, output } },
    async settleJob(ref, value) { settled = { ref, value }; return value },
  }
  const runtime = new Proxy({ jobs: { read() { return { text: 'agent output' } } } }, {
    get(target, property, receiver) {
      if (property === 'runtime_instance_id' || property === 'instance_id') throw new Error(`cannot get property "${String(property)}" without inject`)
      return Reflect.get(target, property, receiver)
    },
  })
  const owner = { id: 'owner-1' }
  await settleAcpTask(runtime, tasks, { async append() {} }, {
    id: 'job-identity', kind: 'subagent', status: 'failed', detail: 'failed', startedAt: 100,
  }, owner)
  assert.deepEqual(lookup, {
    id: 'job-identity',
    ref: { ownerSessionId: 'owner-1', jobStartedAt: 100 },
  })
  assert.deepEqual(activity, {
    ref: { jobId: 'job-identity', attemptId: 'attempt-old', ownerSessionId: 'owner-1', jobStartedAt: 100 },
    output: 'agent output',
  })
  assert.deepEqual(settled.ref, {
    jobId: 'job-identity', attemptId: 'attempt-old', ownerSessionId: 'owner-1', jobStartedAt: 100,
  })
})

test('does not describe an expected pending projection as an untrusted result', async () => {
  const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8')
  assert.match(source, /if \(health\?\.status === 'warning'\)/)
  assert.doesNotMatch(source, /if \(health\?\.trusted === false\)/)
})

test('projects a terminal ACP failure over a stale running Run', () => {
  const snapshot = {
    current: {
      run_id: 'run-1', lifecycle_status: 'running', phase: 'STEP_06', terminal: false,
      attention_required: false, errors: [],
    },
    runs: { items: [{ run_id: 'run-1', lifecycle_status: 'running' }] },
  }
  const result = applyTaskExecutionState(snapshot, {
    task_id: 'task-1', status: 'failed', execution_status: 'failed', provider: 'pangea-opencode',
    terminal_error: 'child does not support requested model',
  })
  assert.equal(result.current.lifecycle_status, 'failed')
  assert.equal(result.current.phase, 'FAILED')
  assert.equal(result.current.terminal, true)
  assert.equal(result.current.attention_required, true)
  assert.deepEqual(result.current.errors, [{ code: 'ACP_AGENT_FAILED', message: 'child does not support requested model' }])
  assert.equal(snapshot.current.lifecycle_status, 'running')
})
