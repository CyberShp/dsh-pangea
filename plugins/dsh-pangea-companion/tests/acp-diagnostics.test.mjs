import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { launchAnalysisSession } from '../src/workbench-api.js'
import { createLaunchLogStore } from '../src/launch-log.js'

test('logs remote identity and completed turns and supplies Python for initialization', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-acp-diagnostics-'))
  try {
    await mkdir(path.join(root, '.agents', 'pangea'), { recursive: true })
    await writeFile(path.join(root, '.agents', 'pangea', 'dsh.md'), '# fixture')
    let hooks, firstPrompt
    const events = []
    const owner = { id: 'owner' }
    const runtime = {
      agents: { get: () => owner },
      subagents: {
        getProvider: () => ({ async discoverModels() {
          return { current_model: 'provider/model', models: [{ id: 'provider/model', label: 'Diagnostic model' }] }
        } }),
        async start(_id, request) {
          assert.equal(request.agentOptions.model, 'provider/model')
          firstPrompt = request.prompt[0].text
          return {
            id: 'local-id', remoteSessionId: 'remote-id', processId: 123,
            readDiagnostics: () => ({ model: 'provider/model', messageChunks: 1, toolCalls: 2, toolFailures: 1, errorCode: '-32001', errorSummary: 'tool failed' }),
            result: Promise.resolve({ stopReason: 'error', protocolStopReason: null, output: [] }),
            async dispose() {},
          }
        },
      },
      jobs: { start(spec) { hooks = spec.run(); return 'job' }, get: () => ({ startedAt: 123 }) },
    }
    const ok = value => ({ result: { ok: true, value } })
    const api = {
      workspace: { list: async () => ok({ items: [{ workspaceId: 'workspace', path: root }] }) },
      sessions: { create: async () => ok({ sessionId: owner.id }), rename: async () => ok({}) },
    }
    const runner = async ({ args }) => args[0] === 'system'
      ? { repositories: ['repo'], analysis_skill: { skill_id: 'codetalks-skill', version: '1.4.9' } }
      : { run_id: 'run', request_path: path.join(root, 'request.md'), run_root: path.join(root, 'run') }
    await launchAnalysisSession(api, { cwd: root, input: { repository: 'repo', target: 'diagnosis', source_scope: [], provider_id: 'pangea-nga' } },
      runner, async () => {}, event => events.push(event), runtime, { PANGEA_PYTHON: 'C:\\Python Path\\python.exe' })
    await hooks.done
    assert.match(firstPrompt, /C:\\Python Path\\python\.exe/)
    assert.match(firstPrompt, /宿主.*阻塞/)
    const created = events.find(event => event.stage === 'acp_session_created')
    assert.equal(created.agent_session_id, 'local-id')
    assert.equal(created.remote_session_id, 'remote-id')
    assert.equal(created.model, 'provider/model')
    const turn = events.find(event => event.stage === 'acp_turn_finished')
    assert.equal(turn.turn, 1)
    assert.equal(turn.stop_reason, 'error')
    assert.equal(turn.tool_calls, 2)
    assert.equal(turn.tool_failures, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('bounds and redacts persisted diagnostic text while retaining structured fields', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-acp-log-'))
  try {
    const logs = createLaunchLogStore({ root })
    await logs.append('task', {
      stage: 'acp_turn_finished', remote_session_id: 'remote', model: 'provider/model',
      turn: 3, message_chunks: 0, tool_calls: 2, tool_failures: 1, stop_reason: 'error', protocol_stop_reason: 'refusal',
      error: new Error('Authorization: Bearer private-bearer\napi_key="private-key" https://user:private-password@example.test/path?token=private-query ' + 'x'.repeat(20000)),
      stderr_summary: 'access_token=private-token',
    })
    const [event] = (await logs.read('task')).events
    assert.equal(event.remote_session_id, 'remote')
    assert.equal(event.turn, 3)
    assert.equal(event.tool_failures, 1)
    assert.equal(event.protocol_stop_reason, 'refusal')
    assert.ok(event.error.length <= 8192)
    assert.doesNotMatch(JSON.stringify(event), /private-(bearer|key|password|query|token)/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('persists protocol timing identities and explicit unknown model metrics', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-acp-timing-log-'))
  try {
    const logs = createLaunchLogStore({ root })
    await logs.append('task', { stage: 'source_first_acp_request', status: 'ok', run_id: 'run', attempt_id: 'attempt',
      action_id: 'planning', agent_session_id: 'worker', execution_id: 'execution', request_id: 'request',
      request_kind: 'session_prompt', model_source: 'acp_session_config', model: null, requested_model: 'requested/model',
      first_event_ms: null, first_token_ms: null, model_request_timing: 'unavailable', duration_ms: 12,
      started_at_ms: 100, finished_at_ms: 112, budget_ms: 10, idle_duration_ms: 8, queue_duration_ms: 1,
      prompt: 'private prompt', toolOutput: 'private source' })
    const [event] = (await logs.read('task')).events
    assert.equal(event.request_id, 'request'); assert.equal(event.request_kind, 'session_prompt')
    assert.equal(event.model, null); assert.equal(event.first_event_ms, null); assert.equal(event.first_token_ms, null)
    assert.equal(event.model_source, 'acp_session_config'); assert.equal(event.model_request_timing, 'unavailable')
    assert.equal(event.started_at_ms, 100); assert.equal(event.finished_at_ms, 112); assert.equal(event.duration_ms, 12)
    assert.equal(event.budget_ms, 10); assert.equal(event.idle_duration_ms, 8); assert.equal(event.queue_duration_ms, 1)
    assert.doesNotMatch(JSON.stringify(event), /private prompt|private source/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
