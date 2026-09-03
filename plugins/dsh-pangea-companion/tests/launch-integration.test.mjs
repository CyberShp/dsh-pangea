import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { settleAcpTask } from '../src/index.js'

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
