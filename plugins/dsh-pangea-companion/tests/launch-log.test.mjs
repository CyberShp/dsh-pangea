import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { LaunchLogStore } from '../src/launch-log.js'

test('persists bounded tool lifecycle evidence without command bodies or validation values', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-tool-lifecycle-'))
  try {
    const store = new LaunchLogStore({ root })
    const file = await store.append('task', { stage: 'source_first_worker_paused', tool_lifecycle: {
      schema_version: 1, captured_at_ms: 400, request_id: 'request', remote_session_id: 'remote', unclosed_count: 51, pending_count: 51,
      in_progress_count: 0, unknown_count: 0, received_tool_events: 52, accepted_tool_events: 51, unaccepted_tool_events: 1,
      validation_error_count: 12, evidence_evicted_count: 3, observer_error_count: 1,
      tools: Array.from({ length: 51 }, (_, index) => ({ tool_id: `tool-${index}`, status: 'pending', kind: 'execute',
        input_observed: true, input_nonempty: false, output_observed: false, seen_in_progress: false,
        first_seen_at_ms: 100, last_update_at_ms: 200, last_received_at_ms: 200, received_update_count: 1, accepted_update_count: 1, evidence_missing: false,
        request_id: 'request', remote_session_id: 'remote', rawInput: { command: 'private command' }, title: 'private title' })),
      validation_errors: Array.from({ length: 12 }, (_, index) => ({ tool_id: `tool-${index}`, request_id: 'request',
        remote_session_id: 'remote', code: 'invalid_type', at_ms: 300, path: ['update', 'content', 'token=fixture-secret'],
        message: 'private validation message', received: 'private value' })),
      rawOutput: 'private output', prompt: 'private prompt',
    } })
    const event = (await store.read('task')).events[0], evidence = event.tool_lifecycle
    assert.equal(evidence.unclosed_count, 51)
    assert.equal(evidence.captured_at_ms, 400)
    assert.equal(evidence.tools.length, 50)
    assert.equal(evidence.tools_truncated, true)
    assert.equal(evidence.tools[0].input_nonempty, false)
    assert.equal(evidence.tools[0].accepted_update_count, 1)
    assert.equal(evidence.tools[0].last_received_at_ms, 200)
    assert.equal(evidence.tools[0].evidence_missing, false)
    assert.equal(evidence.unaccepted_tool_events, 1)
    assert.equal(evidence.evidence_evicted_count, 3)
    assert.equal(evidence.observer_error_count, 1)
    assert.equal(evidence.validation_errors.length, 10)
    assert.equal(evidence.validation_errors[0].tool_id, 'tool-2')
    assert.deepEqual(evidence.validation_errors[0].path, ['update', 'content', '[credential]'])
    assert.equal(evidence.validation_errors_truncated, true)
    assert.doesNotMatch(await readFile(file, 'utf8'), /private|fixture-secret|rawInput|rawOutput/)
    await store.append('task', { stage: 'source_first_worker_paused', tool_lifecycle: {
      tools: [], validation_errors: [], tools_truncated: true, validation_errors_truncated: true,
    } })
    const empty = (await store.read('task')).events[1].tool_lifecycle
    assert.equal(empty.validation_errors_truncated, true)
    assert.equal(empty.pending_count, undefined, 'missing provider fields must not become fabricated zeros')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('persists native file permission paths and decisions with existing redaction and text limits', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-permission-log-'))
  try {
    const store = new LaunchLogStore({ root })
    const file = await store.append('task-permission', { stage: 'source_first_file_permission', action_id: 'run:analysis:unit-1',
      kind: 'edit', paths: ["C:\\scratch\\单位's.json"], decision: 'allow_once' })
    await store.append('task-permission', { stage: 'source_first_file_permission', action_id: 'run:closure:unit-1',
      kind: 'move', paths: ['C:\\other-worker\\unit.json', 'C:\\scratch\\token=fixture-secret'], decision: 'reject',
      env: { TOKEN: 'fixture-secret' } })
    await store.append('task-permission', { stage: 'source_first_file_permission', kind: 'edit', decision: 'reject',
      paths: ['x'.repeat(9000), 'omitted-after-text-budget'] })
    const disk = await readFile(file, 'utf8')
    const events = disk.trim().split('\n').map(line => JSON.parse(line))
    assert.equal(events[0].action_id, 'run:analysis:unit-1')
    assert.equal(events[0].kind, 'edit')
    assert.equal(events[0].decision, 'allow_once')
    assert.deepEqual(events[0].paths, ["C:\\scratch\\单位's.json"])
    assert.equal(events[1].action_id, 'run:closure:unit-1')
    assert.equal(events[1].kind, 'move')
    assert.equal(events[1].decision, 'reject')
    assert.deepEqual(events[1].paths, ['C:\\other-worker\\unit.json', 'C:\\scratch\\[credential]'])
    assert.equal(events[1].env, undefined)
    assert.doesNotMatch(disk, /fixture-secret/)
    assert.deepEqual(events[2].paths, ['x'.repeat(8192)])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('retains host reviewer binding and routing history without model prompts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-review-log-'))
  try {
    const store = new LaunchLogStore({ root })
    await store.append('task', { stage: 'reviewer_state', status: 'ok', review_status: 'revising',
      review_request_id: 'request', producer_session_id: 'producer', reviewer_session_id: 'reviewer', semantic_verdict: 'UNRESOLVED', prompt: 'private input' })
    const event = (await store.read('task')).events[0]
    assert.equal(event.review_status, 'revising')
    assert.equal(event.review_request_id, 'request')
    assert.equal(event.producer_session_id, 'producer')
    assert.equal(event.reviewer_session_id, 'reviewer')
    assert.equal(event.semantic_verdict, 'UNRESOLVED')
    assert.equal(event.prompt, undefined)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('reads a bounded tail of large logs and skips partial records', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-log-tail-'))
  try {
    const store = new LaunchLogStore({ root })
    await writeFile(store.filePath('large'), 'x'.repeat(1024 * 1024) + '\n')
    await store.append('large', { stage: 'acp_turn_finished', status: 'error', error_code: '-32001' })
    const result = await store.read('large')
    assert.equal(result.events.length, 1)
    assert.equal(result.events[0].error_code, '-32001')
    assert.equal(result.truncated, true)
    assert.ok(result.bytes_read <= 256 * 1024)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('persists task launch diagnostics independently from the task store', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-launch-log-'))
  try {
    const store = new LaunchLogStore({ root })
    const file = await store.append('task-001', { stage: 'session_create', status: 'ok', session_id: 'session-1' })
    await store.append('task-001', { stage: 'prompt_submit', status: 'error', error: new Error('prompt failed') })
    await store.append('task-001', {
      stage: 'acp_process_spawn', status: 'error', configured_command: 'opencode',
      resolved_command: 'C:\\Users\\测试 User\\opencode.cmd', launcher_kind: 'windows-batch',
      launcher_command: 'C:\\Windows\\System32\\cmd.exe', launch_stage: 'spawn_process',
      error_code: 'EINVAL', errno: -4071, syscall: 'spawn', cwd: 'C:\\work tree',
      args: ['--api-key', 'secret'], env: { API_KEY: 'secret' },
    })
    const value = await store.read('task-001')
    assert.equal(value.path, file)
    assert.equal(value.events.length, 3)
    assert.equal(value.events[0].stage, 'session_create')
    assert.equal(value.events[0].session_id, 'session-1')
    assert.match(value.events[0].at, /\+08:00$/)
    assert.equal(new Date(value.events[0].at).getTime() <= Date.now(), true)
    assert.equal(value.events[1].status, 'error')
    assert.equal(value.events[1].error, 'prompt failed')
    assert.deepEqual(value.events[2], {
      task_id: 'task-001', schema_version: 1, at: value.events[2].at,
      stage: 'acp_process_spawn', status: 'error', configured_command: 'opencode',
      resolved_command: 'C:\\Users\\测试 User\\opencode.cmd', launcher_kind: 'windows-batch',
      launcher_command: 'C:\\Windows\\System32\\cmd.exe', launch_stage: 'spawn_process',
      error_code: 'EINVAL', syscall: 'spawn', cwd: 'C:\\work tree', errno: -4071,
    })
    assert.match(await readFile(file, 'utf8'), /prompt failed/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('keeps launch duration and source copy metrics', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-launch-metrics-'))
  try {
    const store = new LaunchLogStore({ root })
    await store.append('task-metrics', {
      stage: 'skill_run_create', status: 'ok', duration_ms: 31,
      file_count: 7, total_bytes: 8192, snapshot_duration_ms: 29, prompt_chars: 100, prompt_bytes: 260,
      prompt_kind: 'continuation',
    })
    const event = (await store.read('task-metrics')).events[0]
    assert.equal(event.duration_ms, 31)
    assert.equal(event.file_count, 7)
    assert.equal(event.total_bytes, 8192)
    assert.equal(event.snapshot_duration_ms, 29)
    assert.equal(event.prompt_chars, 100)
    assert.equal(event.prompt_bytes, 260)
    assert.equal(event.prompt_kind, 'continuation')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('returns an empty diagnostic stream before a log file exists', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-launch-log-empty-'))
  try {
    const store = new LaunchLogStore({ root })
    const value = await store.read('task-002')
    assert.deepEqual(value.events, [])
    assert.match(value.path, /task-002\.jsonl$/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
