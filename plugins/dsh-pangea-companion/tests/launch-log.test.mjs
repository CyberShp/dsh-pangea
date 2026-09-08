import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { LaunchLogStore } from '../src/launch-log.js'

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
      file_count: 7, total_bytes: 8192, snapshot_duration_ms: 29,
    })
    const event = (await store.read('task-metrics')).events[0]
    assert.equal(event.duration_ms, 31)
    assert.equal(event.file_count, 7)
    assert.equal(event.total_bytes, 8192)
    assert.equal(event.snapshot_duration_ms, 29)
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
