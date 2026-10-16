import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { appendFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { AgentSessionStore, createAgentSessionRecorder } from '../src/agent-sessions.js'
import { workbenchRouteHandler } from '../src/index.js'
import { createSourceFirstAcpRun } from '../src/source-first-acp.js'

async function fixture(t, runId = 'r1') {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-sessions-'))
  await mkdir(path.join(dataRoot, 'runs', runId), { recursive: true })
  t.after(() => rm(dataRoot, { recursive: true, force: true }))
  return { dataRoot, runId, store: new AgentSessionStore({ dataRoot, runId }) }
}
const meta = { provider: 'pangea-codeagent', model: 'test/model', agent_session_id: 'subagent-1', remote_session_id: 'remote-1',
  role: 'planning', stage: 'unit_planning', action_id: 'planning', execution_id: 'exec1' }

async function transcriptFixture(t, count, content = '') {
  const f = await fixture(t), session = await f.store.append(meta, { type: 'prompt' })
  const file = path.join(f.dataRoot, 'runs', f.runId, 'agent-sessions', `${session.session_id}.jsonl`)
  let offset = 0
  const events = [], starts = [], lines = []
  for (let index = 0; index < count; index++) {
    const event = { type: 'session_update', run_id: f.runId, session_id: session.session_id,
      seq: offset + 1, at: '2026-10-15T12:00:00.000Z', index, content }
    const line = `${JSON.stringify(event)}\n`
    starts.push(offset); events.push(event); lines.push(line); offset += Buffer.byteLength(line)
  }
  await writeFile(file, lines.join(''))
  await writeFile(file.replace(/jsonl$/, 'json'), JSON.stringify({ ...session, event_count: count }))
  return { ...f, file, session, events, starts, size: offset }
}

test('latest and older pages cover a long transcript once while a separate forward cursor follows new events', async t => {
  const f = await transcriptFixture(t, 327), id = f.session.session_id
  const latest = await f.store.read(id, { cursor: 'latest' })
  assert.deepEqual(latest.events, f.events.slice(-100))
  assert.equal(latest.next_cursor, f.size)
  assert.equal(latest.history_cursor, f.starts[227])
  assert.equal(latest.has_history, true)
  assert.equal(latest.has_more, false)
  // Append between history requests. History remains anchored to its byte
  // boundary, and the live high-water cursor remains independent.
  await f.store.append(meta, { type: 'session_update', index: 327 })
  const earlier = await f.store.read(id, { cursor: `before:${latest.history_cursor}` })
  assert.deepEqual(earlier.events, f.events.slice(127, 227))
  assert.equal(earlier.next_cursor, latest.history_cursor)
  assert.equal(earlier.has_more, true)
  assert.equal(earlier.has_history, true)
  const older = await f.store.read(id, { cursor: `before:${earlier.history_cursor}` })
  const oldest = await f.store.read(id, { cursor: `before:${older.history_cursor}` })
  assert.equal(oldest.history_cursor, 0)
  assert.equal(oldest.has_history, false)
  const all = [...oldest.events, ...older.events, ...earlier.events, ...latest.events]
  assert.deepEqual(all, f.events)
  assert.equal(new Set(all.map(event => event.seq)).size, 327)
  const live = await f.store.read(id, { cursor: latest.next_cursor })
  assert.deepEqual(live.events.map(event => event.index), [327])
  assert.equal(live.history_cursor, latest.next_cursor)
  assert.equal(live.has_more, false)
  assert.deepEqual((await f.store.read(id, { cursor: live.next_cursor })).events, [])
})

test('tail readers retain the complete high-water cursor until a partial final event finishes', async t => {
  const f = await transcriptFixture(t, 125), id = f.session.session_id
  const pending = { type: 'session_update', run_id: f.runId, session_id: id, seq: f.size + 1, content: '尚未完成的正文' }
  const line = `${JSON.stringify(pending)}\n`, split = Buffer.byteLength(line) - 2
  const bytes = Buffer.from(line)
  await appendFile(f.file, bytes.subarray(0, split))
  const latest = await f.store.read(id, { cursor: 'latest' })
  assert.deepEqual(latest.events, f.events.slice(-100))
  assert.equal(latest.next_cursor, f.size)
  assert.equal(latest.has_more, true)
  const pendingPage = await f.store.read(id, { cursor: latest.next_cursor })
  assert.deepEqual(pendingPage.events, [])
  assert.equal(pendingPage.next_cursor, f.size)
  assert.equal(pendingPage.has_more, true)
  await appendFile(f.file, bytes.subarray(split))
  const completed = await f.store.read(id, { cursor: pendingPage.next_cursor })
  assert.deepEqual(completed.events, [pending])
  assert.equal(completed.has_more, false)
  assert.deepEqual((await f.store.read(id, { cursor: completed.next_cursor })).events, [])
  assert.deepEqual((await f.store.read(id, { cursor: 'latest', limit: 1 })).events, [pending])
})

test('a transcript containing only a partial first event retains cursor zero until completion', async t => {
  const f = await transcriptFixture(t, 1), id = f.session.session_id
  const bytes = await readFile(f.file)
  await writeFile(f.file, bytes.subarray(0, bytes.length - 1))
  const partial = await f.store.read(id, { cursor: 'latest' })
  assert.deepEqual(partial.events, [])
  assert.equal(partial.next_cursor, 0)
  assert.equal(partial.history_cursor, 0)
  assert.equal(partial.has_history, false)
  assert.equal(partial.has_more, true)
  await appendFile(f.file, '\n')
  assert.deepEqual((await f.store.read(id, { cursor: partial.next_cursor })).events, f.events)
})

test('tail byte limits align multibyte records and successive older pages never drop a large record', async t => {
  const f = await transcriptFixture(t, 15, '测'.repeat(70000)), id = f.session.session_id
  let page = await f.store.read(id, { cursor: 'latest', limit: 200 })
  assert.ok(page.events.length > 0 && page.events.length < 15)
  let all = [...page.events]
  do {
    assert.ok(page.next_cursor - page.history_cursor <= 1024 * 1024)
    assert.deepEqual(page.events.map(event => event.content), page.events.map(() => '测'.repeat(70000)))
    if (!page.has_history) break
    const oldStart = page.history_cursor
    page = await f.store.read(id, { cursor: `before:${oldStart}`, limit: 200 })
    assert.ok(page.history_cursor < oldStart)
    assert.equal(page.next_cursor, oldStart)
    all = [...page.events, ...all]
  } while (page.has_history)
  assert.deepEqual(all, f.events)
})

test('empty tails, before zero, numeric strings, and invalid older cursors retain explicit boundary semantics', async t => {
  const f = await transcriptFixture(t, 3), id = f.session.session_id
  const oldest = await f.store.read(id, { cursor: 'before:0' })
  assert.deepEqual(oldest.events, [])
  assert.equal(oldest.next_cursor, 0)
  assert.equal(oldest.history_cursor, 0)
  assert.equal(oldest.has_history, false)
  assert.equal(oldest.has_more, true)
  const forward = await f.store.read(id, { cursor: String(f.starts[1]), limit: 1 })
  assert.deepEqual(forward.events, [f.events[1]])
  assert.equal(forward.next_cursor, f.starts[2])
  for (const cursor of ['before:', 'before:-1', 'before:1.5', 'before:latest', 'before:9007199254740992', 'unknown']) {
    await assert.rejects(f.store.read(id, { cursor }), /分页/)
  }
  await assert.rejects(f.store.read(id, { cursor: 'before:2' }), /边界/)
  await assert.rejects(f.store.read(id, { cursor: `before:${f.size + 1}` }), /范围/)
  const empty = await transcriptFixture(t, 0)
  const emptyPage = await empty.store.read(empty.session.session_id, { cursor: 'latest' })
  assert.deepEqual(emptyPage.events, [])
  assert.equal(emptyPage.next_cursor, 0)
  assert.equal(emptyPage.history_cursor, 0)
  assert.equal(emptyPage.has_history, false)
  assert.equal(emptyPage.has_more, false)
})

test('tail reads expose damaged records and never skip an oversized incomplete tail', async t => {
  const f = await transcriptFixture(t, 2), id = f.session.session_id
  await appendFile(f.file, 'broken json\n')
  const corrupted = await f.store.read(id, { cursor: 'latest', limit: 1 })
  assert.equal(corrupted.events[0].type, 'recording_error')
  assert.equal(corrupted.history_cursor, f.size)
  assert.equal(corrupted.has_history, true)
  assert.match(corrupted.recording_error, /损坏/)
  await appendFile(f.file, 'x'.repeat(2 * 1024 * 1024))
  const oversized = await f.store.read(id, { cursor: 'latest' })
  assert.deepEqual(oversized.events, [])
  assert.equal(oversized.next_cursor, 0)
  assert.equal(oversized.has_more, true)
  assert.match(oversized.recording_error, /超过读取上限/)
})

test('session listing sorts by valid latest activity with creation fallback and deterministic unknown ties', async t => {
  const f = await fixture(t)
  const specifications = [
    { remote_session_id: 'old-created-active', created_at: '2025-01-01T00:00:00Z', updated_at: '2026-10-15T10:00:00Z' },
    { remote_session_id: 'new-created-inactive', created_at: '2026-10-15T09:00:00Z', updated_at: 'invalid' },
    { remote_session_id: 'same-activity', created_at: '2026-10-15T08:00:00Z', updated_at: '2026-10-15T10:00:00Z' },
    { remote_session_id: 'unknown-a', created_at: null, updated_at: 'invalid' },
    { remote_session_id: 'unknown-b', created_at: 'invalid', updated_at: null },
  ]
  const sessions = []
  for (const spec of specifications) {
    const session = { ...await f.store.append({ ...meta, remote_session_id: spec.remote_session_id }, { type: 'prompt' }), ...spec }
    sessions.push(session)
    await writeFile(path.join(f.dataRoot, 'runs', f.runId, 'agent-sessions', `${session.session_id}.json`), JSON.stringify(session))
  }
  const items = (await f.store.list()).items
  const sortIds = values => values.map(value => value.session_id).sort()
  assert.deepEqual(items.map(item => item.session_id), [...sortIds([sessions[0], sessions[2]]), sessions[1].session_id, ...sortIds(sessions.slice(3))])
})

test('session identity survives restart/continuation and separates reused local IDs and providers', async t => {
  const f = await fixture(t)
  await f.store.append(meta, { type: 'prompt', prompt: [{ type: 'text', text: 'read contract' }] })
  const resumed = new AgentSessionStore(f)
  await resumed.append({ ...meta, role: 'review', action_id: 'comparison', execution_id: 'exec2' }, { type: 'session_update',
    update: { sessionUpdate: 'tool_call', toolCallId: 'tool-1', status: 'pending', rawInput: { command: 'python -m cli result-read' } } })
  await resumed.append({ ...meta, remote_session_id: 'remote-2' }, { type: 'session_bound' })
  await resumed.append({ ...meta, provider: 'pangea-nga' }, { type: 'session_bound' })
  const list = await resumed.list()
  assert.equal(list.total, 3)
  const first = list.items.find(item => item.provider === meta.provider && item.remote_session_id === meta.remote_session_id)
  assert.deepEqual(first.action_ids, ['planning', 'comparison'])
  assert.equal(first.event_count, 2)
  assert.equal(first.last_tool_status, 'pending')
  const page1 = await resumed.read(first.session_id, { limit: 1 })
  assert.equal(page1.events[0].action_id, 'planning')
  assert.equal(page1.has_more, true)
  const page2 = await resumed.read(first.session_id, { cursor: page1.next_cursor, limit: 1 })
  assert.equal(page2.events[0].execution_id, 'exec2')
  assert.equal(page2.events[0].update.rawInput.command, 'python -m cli result-read')
  assert.equal(page2.has_more, false)
  assert.ok(page2.events[0].seq > page1.events[0].seq)
  await resumed.append(meta, { type: 'turn_end', response_received: false })
  const tail = await resumed.read(first.session_id, { cursor: page2.next_cursor })
  assert.equal(tail.events.length, 1)
  assert.equal(tail.session.status, 'unconfirmed')
})

test('queued records freeze action binding, preserve tool output, and explicitly bound/redact payloads', async t => {
  const { store } = await fixture(t)
  const context = { ...meta }, value = { type: 'session_update', update: { sessionUpdate: 'tool_call_update', toolCallId: 't',
    rawInput: { api_key: 'private1', command: 'curl https://internal/service api_key=private2 --password="private3"' },
    rawOutput: '预期输出', content: Array.from({ length: 501 }, () => ({ text: 'item' })) } }
  const recording = store.append(context, value)
  context.action_id = 'later'; value.update.rawOutput = 'mutated'
  const session = await recording
  const result = await store.read(session.session_id)
  assert.equal(result.events[0].action_id, 'planning')
  assert.equal(result.events[0].update.rawOutput, '预期输出')
  assert.match(result.events[0].update.rawInput.command, /https:\/\/internal\/service/)
  assert.doesNotMatch(JSON.stringify(result), /private[123]/)
  assert.equal(result.events[0].truncated, true)
  await store.append(meta, { type: 'session_update', update: { rawOutput: '长'.repeat(300000) } })
  const bounded = await store.read(session.session_id)
  assert.equal(bounded.events.at(-1).truncated, true)
  assert.ok(Buffer.byteLength(JSON.stringify(bounded.events.at(-1))) < 256 * 1024)
})

test('old bindings and unsupported drivers show metadata only, without inventing history', async t => {
  const f = await fixture(t)
  await writeFile(path.join(f.dataRoot, 'runs', f.runId, 'acp-workers.json'), JSON.stringify({ runId: f.runId,
    workers: { 'subagent-1': { providerId: meta.provider, remoteSessionId: meta.remote_session_id, blocked: true } } }))
  await writeFile(path.join(f.dataRoot, 'runs', f.runId, 'progress.json'), JSON.stringify({ run_id: f.runId,
    actions: { planning: { task_id: 'subagent-1', stage: 'unit_planning', role: 'planning' } } }))
  const legacy = await f.store.list()
  assert.equal(legacy.total, 1)
  assert.equal(legacy.items[0].history_status, 'metadata_only')
  assert.deepEqual((await f.store.read(legacy.items[0].session_id)).events, [])
  const latestLegacy = await f.store.read(legacy.items[0].session_id, { cursor: 'latest' })
  assert.equal(latestLegacy.next_cursor, 0)
  assert.equal(latestLegacy.history_cursor, 0)
  assert.equal(latestLegacy.has_history, false)
  assert.deepEqual(latestLegacy.events, [])
  await f.store.append(meta, { type: 'host_event', stage: 'source_first_worker_bound' })
  const unsupported = await f.store.list()
  assert.equal(unsupported.total, 1)
  assert.equal(unsupported.items[0].transcript_available, false)
  assert.equal((await f.store.read(unsupported.items[0].session_id)).events.length, 1)
  await f.store.append(meta, { type: 'session_bound' })
  assert.equal((await f.store.list()).items[0].history_status, 'recorded')
})

test('read rejects foreign sessions, traversal, symlink aliases, and invalid byte cursors', async t => {
  const f = await fixture(t), first = await f.store.append(meta, { type: 'prompt', prompt: [] })
  assert.throws(() => new AgentSessionStore({ dataRoot: f.dataRoot, runId: '../r1' }), /无效/)
  await assert.rejects(f.store.read('../r1'), /无效/)
  await assert.rejects(f.store.read(first.session_id, { cursor: 2 }), /边界/)
  await assert.rejects(f.store.read(first.session_id, { limit: 201 }), /分页/)
  await mkdir(path.join(f.dataRoot, 'runs', 'r2'))
  const foreign = new AgentSessionStore({ dataRoot: f.dataRoot, runId: 'r2' })
  await assert.rejects(foreign.read(first.session_id), /不属于/)
  await symlink(path.join(f.dataRoot, 'runs', 'r1'), path.join(f.dataRoot, 'runs', 'alias'), 'dir')
  await assert.rejects(new AgentSessionStore({ dataRoot: f.dataRoot, runId: 'alias' }).list(), /越出/)
  const external = path.join(f.dataRoot, 'external.json'); await writeFile(external, '{"secret":"hidden"}')
  await rm(path.join(f.dataRoot, 'runs', 'r1', 'agent-sessions', `${first.session_id}.jsonl`))
  await symlink(external, path.join(f.dataRoot, 'runs', 'r1', 'agent-sessions', `${first.session_id}.jsonl`))
  await assert.rejects(f.store.read(first.session_id), /越出/)
})

test('corrupt log records stay visible and recorder write failures never reject the caller', async t => {
  const f = await fixture(t), first = await f.store.append(meta, { type: 'prompt', prompt: [] })
  await appendFile(path.join(f.dataRoot, 'runs', 'r1', 'agent-sessions', `${first.session_id}.jsonl`), 'broken json\n')
  const page = await f.store.read(first.session_id)
  assert.equal(page.events.at(-1).type, 'recording_error')
  assert.ok(page.events.at(-1).seq)
  assert.match(page.recording_error, /损坏/)
  const recorder = createAgentSessionRecorder({ ...f, runId: 'missing' })
  assert.equal(await recorder.record(meta, { type: 'prompt' }), null)
})

test('session/load replays hydrate missing history but never duplicate existing transcripts', async t => {
  const f = await fixture(t)
  await f.store.append(meta, { type: 'host_event', stage: 'source_first_worker_bound' })
  await f.store.append(meta, { type: 'session_bound', model: 'actual/model' })
  const replayMeta = { ...meta, action_id: null, execution_id: null }
  const replay = text => ({ type: 'session_update', replay: true, request_id: null,
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } })
  await f.store.append(replayMeta, replay('old first'))
  await f.store.append(replayMeta, replay('old second'))
  await f.store.append(meta, { type: 'session_bound', resumed: true })
  await f.store.append(replayMeta, replay('old first'))
  await f.store.append(replayMeta, replay('old second'))
  await f.store.append(meta, { type: 'session_bound', resumed: true })
  const [session] = (await f.store.list()).items
  const events = (await f.store.read(session.session_id)).events
  assert.equal(events.filter(event => event.replay).length, 2)
  assert.equal(events.find(event => event.replay).action_id, undefined)
  assert.equal(events.find(event => event.replay).execution_id, undefined)
  assert.equal(session.model, 'actual/model')
  assert.equal(session.history_replay_skipped, true)
  assert.match(session.history_message, /不保证/)
})

test('GET session API is same-origin, requires exact run, and does not invoke execution services', async t => {
  const f = await fixture(t), item = await f.store.append(meta, { type: 'prompt', prompt: [] })
  const request = async (query, origin = 'same-origin') => {
    let code, body
    await workbenchRouteHandler({ method: 'GET', headers: { 'sec-fetch-site': origin },
      url: `/api/pangea-companion/workbench?${new URLSearchParams({ cwd: f.dataRoot, data_root: f.dataRoot, ...query })}` },
    { writeHead(value) { code = value }, end(value) { body = JSON.parse(value) } }, {}, {}, new Set(), {}, {}, {}, () => { throw Error('must not execute') })
    return { code, body }
  }
  assert.equal((await request({ view: 'agent-sessions', run_id: f.runId })).body.total, 1)
  assert.equal((await request({ view: 'agent-session', run_id: f.runId, session_id: item.session_id })).body.events.length, 1)
  const tail = await request({ view: 'agent-session', run_id: f.runId, session_id: item.session_id, cursor: 'latest' })
  assert.equal(tail.code, 200)
  assert.equal(tail.body.events.length, 1)
  assert.equal(tail.body.history_cursor, 0)
  const older = await request({ view: 'agent-session', run_id: f.runId, session_id: item.session_id, cursor: `before:${tail.body.history_cursor}` })
  assert.equal(older.code, 200)
  assert.deepEqual(older.body.events, [])
  assert.equal((await request({ view: 'agent-sessions' })).code, 400)
  assert.equal((await request({ view: 'agent-sessions', run_id: f.runId }, 'cross-site')).code, 403)
})

test('source-first records the actual worker protocol and keeps late tools on the original execution', async t => {
  const f = await fixture(t), controller = new AbortController()
  let phase = 0, callback, turns = 0
  const actions = [
    { action_id: 'blind', action: 'dispatch_agent', stage: 'blind_review', role: 'review' },
    { action_id: 'comparison', action: 'continue_agent', stage: 'comparison_review', role: 'review', task_id: 'subagent-1' },
  ]
  const run = createSourceFirstAcpRun({ ...f, cwd: f.dataRoot, providerId: meta.provider, agentModel: meta.model,
    parent: { id: 'owner' }, signal: controller.signal, attemptId: 'attempt',
    runner: async ({ args }) => {
      if (args[1] === 'next') return { run_id: f.runId, lifecycle_status: phase === 2 ? 'complete' : 'running', actions: phase < 2 ? [actions[phase]] : [] }
      if (args[1] === 'settle') phase++
      if (args[0] === 'task-open') return { task: {} }
      return {}
    }, subagents: { start: async (_provider, request) => {
      callback = event => request.onSessionEvent({ ...event, agent_session_id: meta.agent_session_id, remote_session_id: meta.remote_session_id })
      callback({ type: 'session_bound' })
      return { id: meta.agent_session_id, remoteSessionId: meta.remote_session_id, result: Promise.resolve({ stopReason: 'completed' }),
        readDiagnostics: () => ({ activeToolCount: 0 }), dispose: async () => {},
        continuePrompt: async prompt => {
          turns++; callback({ type: 'prompt', request_id: `driver-${turns}`, prompt })
          if (turns === 2) callback({ type: 'session_update', request_id: 'driver-1', update: { sessionUpdate: 'tool_call_update', toolCallId: 'late', status: 'completed', rawOutput: 'old tool finished' } })
          callback({ type: 'turn_end', request_id: `driver-${turns}`, response_received: true, protocol_stop_reason: 'end_turn' })
          return { stopReason: 'completed' }
        } }
    } } })
  try {
    await run.result
    const listing = await f.store.list(), page = await f.store.read(listing.items[0].session_id)
    assert.equal(listing.total, 1)
    const prompts = page.events.filter(event => event.type === 'prompt')
    assert.deepEqual(prompts.map(event => event.action_id), ['blind', 'comparison'])
    assert.notEqual(prompts[0].execution_id, prompts[1].execution_id)
    const late = page.events.find(event => event.update?.toolCallId === 'late')
    assert.equal(late.action_id, 'blind')
    assert.equal(late.execution_id, prompts[0].execution_id)
    assert.equal(late.host_request_id, prompts[0].host_request_id)
    assert.equal(late.driver_request_id, 'driver-1')
  } finally { controller.abort(); await run.dispose() }
})

test('automatic transport recovery keeps capturing the exact remote session and actual model', async t => {
  const f = await fixture(t), controller = new AbortController()
  let starts = 0, turns = 0, settled = false
  const run = createSourceFirstAcpRun({ ...f, cwd: f.dataRoot, providerId: meta.provider, agentModel: 'requested/model',
    parent: { id: 'owner' }, signal: controller.signal, attemptId: 'attempt',
    runner: async ({ args }) => {
      if (args[1] === 'next') return { run_id: f.runId, lifecycle_status: settled ? 'complete' : 'running',
        actions: settled ? [] : [{ action_id: 'work', action: 'dispatch_agent', stage: 'unit_analysis', role: 'analysis' }] }
      if (args[1] === 'settle') settled = true
      if (args[0] === 'task-open') return { task: {} }
      if (args[0] === 'result-read') return { revision: 0, completion_complete: false }
      return {}
    }, subagents: { start: async (_provider, request) => {
      starts++
      assert.equal(typeof request.onSessionEvent, 'function')
      if (starts === 2) assert.deepEqual(request.resume, { taskId: meta.agent_session_id, remoteSessionId: meta.remote_session_id })
      const emit = event => request.onSessionEvent({ ...event, agent_session_id: meta.agent_session_id, remote_session_id: meta.remote_session_id })
      emit({ type: 'session_bound', resumed: starts === 2, model: 'actual/model' })
      return { id: meta.agent_session_id, remoteSessionId: meta.remote_session_id, result: Promise.resolve({ stopReason: 'completed' }),
        readDiagnostics: () => ({ activeToolCount: 0, canLoadSession: true }), dispose: async () => {},
        continuePrompt: async prompt => {
          turns++; emit({ type: 'prompt', request_id: `request-${turns}`, prompt })
          emit({ type: 'session_update', request_id: `request-${turns}`, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `turn-${turns}` } } })
          return { stopReason: turns === 1 ? 'error' : 'completed' }
        } }
    } } })
  try {
    await run.result
    assert.equal(starts, 2)
    const [session] = (await f.store.list()).items
    const events = (await f.store.read(session.session_id)).events
    assert.equal(events.filter(event => event.type === 'prompt').length, 2)
    assert.equal(events.filter(event => event.update?.content?.text === 'turn-2').length, 1)
    assert.equal(session.model, 'actual/model')
    assert.equal(session.requested_model, 'requested/model')
  } finally { controller.abort(); await run.dispose() }
})
