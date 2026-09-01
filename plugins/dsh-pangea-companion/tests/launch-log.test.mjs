import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { LaunchLogStore } from '../src/launch-log.js'

test('persists task launch diagnostics independently from the task store', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-launch-log-'))
  try {
    const store = new LaunchLogStore({ root })
    const file = await store.append('task-001', { stage: 'session_create', status: 'ok', session_id: 'session-1' })
    await store.append('task-001', { stage: 'prompt_submit', status: 'error', error: new Error('prompt failed') })
    const value = await store.read('task-001')
    assert.equal(value.path, file)
    assert.equal(value.events.length, 2)
    assert.equal(value.events[0].stage, 'session_create')
    assert.equal(value.events[0].session_id, 'session-1')
    assert.equal(value.events[1].status, 'error')
    assert.equal(value.events[1].error, 'prompt failed')
    assert.match(await readFile(file, 'utf8'), /prompt failed/)
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
