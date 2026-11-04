import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { appendFile, mkdir, mkdtemp, rm, writeFile, stat, rename } from 'node:fs/promises'
import { buildExecutionTimeline } from '../src/execution-timeline.js'
import { AgentSessionStore } from '../src/agent-sessions.js'
const session = { session_id: 's', agent_session_id: 'worker', role: 'analysis' }
const e = (at, kind, execution_id = 'one') => ({ type: 'host_event', stage: 'source_first_execution', execution_event: kind,
  at_ms: at, execution_id, action_id: 'a' })
const project = (events, progress = {}, complete = true) => buildExecutionTimeline({ sessions: [session],
  histories: [{ session_id: 's', complete, events }], progress, now: 10000 })

test('each execution has its own segment and pauses remain blank', () => {
  const result = project([e(1000, 'started'), e(2000, 'paused'), e(5000, 'started', 'two'), e(6000, 'finished', 'two')])
  assert.deepEqual(result.lanes[0].segments.map(s => [s.start_at_ms, s.end_at_ms, s.duration_ms]), [[1000, 2000, 1000], [5000, 6000, 1000]])
  assert.equal(result.is_live, false)
})

test('turn end is a marker, never an execution end or process stop', () => {
  const result = project([e(1000, 'started'), { type: 'turn_end', at_ms: 2000, execution_id: 'one', protocol_stop_reason: 'end_turn' }])
  const segment = result.lanes[0].segments[0]
  assert.equal(segment.end_at_ms, null)
  assert.equal(segment.status, 'unknown')
  assert.equal(segment.process_stopped, false)
  assert.equal(result.lanes[0].events.at(-1).kind, 'turn_end')
})

test('only exact current running execution may extend to projection time', () => {
  const progress = { lifecycle_status: 'running', actions: { a: { execution_id: 'two', task_id: 'worker', status: 'dispatched', execution_started_at_ms: 5000 } } }
  const events = [e(1000, 'started'), e(5000, 'started', 'two')]
  const result = project(events, progress)
  assert.deepEqual(result.lanes[0].segments.map(s => s.status), ['unknown', 'running'])
  assert.equal(result.end_at_ms, 10000)
  assert.equal(project(events, progress, false).is_live, false)
  assert.equal(project(events, { ...progress, lifecycle_status: 'stopped' }).is_live, false)
})

test('replay and cumulative elapsed time never fabricate historical boundaries', () => {
  const result = project([{ ...e(1000, 'started'), replay: true }, e(3000, 'finished')], {
    actions: { a: { execution_id: 'one', task_id: 'worker', execution_elapsed_ms: 2500 } } })
  assert.equal(result.lanes[0].segments[0].start_at_ms, null)
  assert.equal(result.lanes[0].segments[0].duration_ms, null)
})

test('unbound old execution snapshots preserve known times without inventing sessions', () => {
  const result = buildExecutionTimeline({ progress: { actions: { a: { execution_id: 'old', status: 'settled', execution_started_at_ms: 2000,
    execution_finished_at_ms: 2500, execution_elapsed_ms: 999999 } } } })
  assert.equal(result.lanes[0].session_id, null)
  assert.equal(result.lanes[0].segments[0].duration_ms, null)
  assert.equal(result.lanes[0].segments[0].reported_finish_at_ms, 2500)
})

test('durable session projection reads from byte zero beyond transcript latest-page limits and survives restart', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-timeline-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'runs', 'r'), { recursive: true })
  const meta = { provider: 'test', agent_session_id: 'worker', remote_session_id: 'remote', action_id: 'a', execution_id: 'one' }
  const store = new AgentSessionStore({ dataRoot: root, runId: 'r' })
  const recorded = await store.append(meta, e(1000, 'started'))
  const file = path.join(root, 'runs', 'r', 'agent-sessions', `${recorded.session_id}.jsonl`)
  await appendFile(file, Array.from({ length: 250 }, (_, n) => JSON.stringify({ type: 'session_update',
    run_id: 'r', session_id: recorded.session_id, at_ms: 1500, seq: n + 100, content: 'x'.repeat(5000) }) + '\n').join(''))
  await store.append(meta, e(2000, 'paused'))
  const restarted = new AgentSessionStore({ dataRoot: root, runId: 'r' })
  const timeline = await restarted.timeline()
  assert.deepEqual(timeline.lanes[0].segments.map(s => [s.start_at_ms, s.end_at_ms]), [[1000, 2000]])
  assert.equal(timeline.lanes[0].history_status, 'recorded')
  assert.equal(timeline.lanes[0].events.length, 2)
  const bounded = await restarted.timeline({}, { maxBytes: 1000 })
  assert.equal(bounded.lanes[0].history_status, 'recorded')
  assert.equal(bounded.projection_read.bytes_read, 0)
  await appendFile(file, '{"incomplete":')
  assert.equal((await restarted.timeline()).lanes[0].history_status, 'partial')
})

test('wrong identity and damaged records are surfaced without publishing their events', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-timeline-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'runs', 'r'), { recursive: true })
  const store = new AgentSessionStore({ dataRoot: root, runId: 'r' })
  const recorded = await store.append({ provider: 'test', agent_session_id: 'worker' }, { type: 'session_bound', at_ms: 1000 })
  const file = path.join(root, 'runs', 'r', 'agent-sessions', `${recorded.session_id}.jsonl`)
  await appendFile(file, JSON.stringify({ ...e(2000, 'started'), run_id: 'different', session_id: recorded.session_id }) + '\nnot json\n')
  const result = await store.timeline()
  assert.equal(result.lanes[0].segments.length, 0)
  assert.equal(result.lanes[0].history_status, 'partial')
  assert.ok(result.notices.some(n => n.includes('损坏')))
})

test('a resumed task with multiple remote sessions does not paint latest execution on every session', () => {
  const sessions = [{ ...session, session_id: 'old' }, { ...session, session_id: 'new' }]
  const progress = { lifecycle_status: 'running', actions: { a: { task_id: 'worker', execution_id: 'current', status: 'dispatched', execution_started_at_ms: 5000 } } }
  const result = buildExecutionTimeline({ sessions, progress, histories: [
    { session_id: 'old', complete: true, events: [e(1000, 'started', 'previous'), e(2000, 'finished', 'previous')] },
    { session_id: 'new', complete: true, events: [e(5000, 'started', 'current')] },
  ] })
  assert.deepEqual(result.lanes[0].segments.map(s => s.execution_id), ['previous'])
  assert.deepEqual(result.lanes[1].segments.map(s => s.execution_id), ['current'])
  const ambiguous = buildExecutionTimeline({ sessions, progress })
  assert.deepEqual(ambiguous.lanes.slice(0, 2).map(l => l.segments.length), [0, 0])
  assert.equal(ambiguous.lanes[2].session_id, null)
})

test('accepted execution boundary wins over later worker cleanup notifications', () => {
  const result = project([e(1000, 'started'), { ...e(1100, 'started'), stage: 'source_first_worker_started' },
    e(2000, 'paused'), { ...e(4000, 'paused'), stage: 'source_first_worker_paused' }])
  assert.equal(result.lanes[0].segments[0].end_at_ms, 2000)
  assert.equal(result.lanes[0].events.length, 2)
})

test('incremental polls skip unchanged logs, read appended bytes only, and reset replaced or truncated files', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'timeline-incremental-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'runs', 'r'), { recursive: true })
  const store = new AgentSessionStore({ dataRoot: root, runId: 'r' })
  const meta = { provider: 'test', agent_session_id: 'worker', execution_id: 'one' }
  const recorded = await store.append(meta, e(1000, 'started'))
  const file = path.join(root, 'runs', 'r', 'agent-sessions', `${recorded.session_id}.jsonl`)
  const initial = await store.timeline()
  assert.equal(initial.projection_read.bytes_read - initial.projection_read.validation_bytes, (await stat(file)).size)
  assert.equal((await new AgentSessionStore({ dataRoot: root, runId: 'r' }).timeline()).projection_read.bytes_read, 0)
  const before = (await stat(file)).size
  await store.append(meta, e(2000, 'paused'))
  const appended = await store.timeline()
  assert.equal(appended.projection_read.bytes_read - appended.projection_read.validation_bytes, (await stat(file)).size - before)
  assert.equal(appended.lanes[0].segments[0].end_at_ms, 2000)
  const event = JSON.stringify({ ...e(3000, 'started', 'replacement'), run_id: 'r', session_id: recorded.session_id })
  await writeFile(file, event + '\n')
  const reset = await store.timeline()
  assert.deepEqual(reset.lanes[0].segments.map(s => s.execution_id), ['replacement'])
  assert.equal(reset.projection_read.bytes_read - reset.projection_read.validation_bytes, (await stat(file)).size)
  await writeFile(file + '.replacement', event.replace('replacement', 'new-inode--') + '\n')
  await rename(file + '.replacement', file)
  assert.deepEqual((await store.timeline()).lanes[0].segments.map(s => s.execution_id), ['new-inode--'])
})

test('partial line waits unchanged and resumes once complete without retaining transcript content', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'timeline-partial-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'runs', 'r'), { recursive: true })
  const store = new AgentSessionStore({ dataRoot: root, runId: 'r' })
  const recorded = await store.append({ provider: 'test', agent_session_id: 'worker', execution_id: 'one' }, e(1000, 'started'))
  const file = path.join(root, 'runs', 'r', 'agent-sessions', `${recorded.session_id}.jsonl`)
  await store.timeline()
  const line = JSON.stringify({ ...e(2000, 'finished'), run_id: 'r', session_id: recorded.session_id }) + '\n'
  await appendFile(file, line.slice(0, 30))
  assert.equal((await store.timeline()).lanes[0].history_status, 'partial')
  assert.equal((await store.timeline()).projection_read.bytes_read, 0)
  await appendFile(file, line.slice(30))
  const complete = await store.timeline()
  assert.equal(complete.lanes[0].history_status, 'recorded')
  assert.equal(complete.lanes[0].segments[0].end_at_ms, 2000)
  assert.equal(complete.lanes[0].events.length, 2)
})

test('shared read budget continues cold history over polls instead of truncating history or rereading it', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'timeline-budget-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'runs', 'r'), { recursive: true })
  const store = new AgentSessionStore({ dataRoot: root, runId: 'r' })
  for (let n = 0; n < 3; n++) await store.append({ provider: 'test', agent_session_id: `worker-${n}`, execution_id: `e${n}` }, e(1000, 'started', `e${n}`))
  const first = await store.timeline({}, { maxBytes: 500 })
  assert.ok(first.projection_read.bytes_read <= 500)
  assert.ok(first.lanes.some(lane => lane.history_status === 'partial'))
  for (let n = 0; n < 5; n++) await store.timeline({}, { maxBytes: 500 })
  const complete = await store.timeline()
  assert.ok(complete.lanes.every(lane => lane.history_status === 'recorded'))
  assert.equal((await store.timeline()).projection_read.bytes_read, 0)
})

test('stop-request and resume snapshot timestamps are not execution-stop confirmation', () => {
  const progress = { lifecycle_status: 'stopped', actions: { a: { task_id: 'worker', execution_id: 'one', status: 'paused',
    error: '用户停止 Run', execution_started_at_ms: 1000, execution_finished_at_ms: 2000 } } }
  assert.equal(project([e(1000, 'started')], progress).lanes[0].segments[0].end_at_ms, null)
  assert.equal(buildExecutionTimeline({ progress }).lanes[0].segments[0].end_at_ms, null)
  assert.equal(project([e(1000, 'started'), e(2500, 'paused')], progress).lanes[0].segments[0].end_at_ms, 2500)
})

test('wire marker limits apply per lane and across the run without dropping execution boundaries', () => {
  const sessions = Array.from({ length: 15 }, (_, n) => ({ session_id: `s${n}`, agent_session_id: `w${n}` }))
  const histories = sessions.map((session, n) => ({ session_id: session.session_id, complete: true, events: [
    e(1000, 'started', `e${n}`),
    ...Array.from({ length: 300 }, (_, i) => ({ type: 'prompt', at_ms: 1100 + i, execution_id: `e${n}` })),
    { type: 'turn_end', at_ms: 1500, execution_id: `e${n}` },
    e(2000, 'finished', `e${n}`), { type: 'process_exit', at_ms: 2100, execution_id: `e${n}` },
  ] }))
  const result = buildExecutionTimeline({ sessions, histories })
  assert.ok(result.lanes.every(lane => lane.events.length <= 200))
  assert.equal(result.lanes.reduce((count, lane) => count + lane.events.length, 0), 2000)
  for (const lane of result.lanes) {
    assert.equal(lane.segments[0].start_at_ms, 1000)
    assert.equal(lane.segments[0].end_at_ms, 2000)
    assert.ok(lane.omitted_events > 0)
    assert.ok(lane.events.some(event => event.kind === 'process_exit'))
    assert.ok(lane.events.some(event => event.kind === 'turn_end'))
  }
})

test('oversized line crossing the shared byte budget cannot stall scans or hide later execution boundaries', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'timeline-oversized-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'runs', 'r'), { recursive: true })
  const store = new AgentSessionStore({ dataRoot: root, runId: 'r' })
  const meta = { provider: 'test', agent_session_id: 'worker', execution_id: 'one' }
  const recorded = await store.append(meta, e(1000, 'started'))
  const file = path.join(root, 'runs', 'r', 'agent-sessions', `${recorded.session_id}.jsonl`)
  await appendFile(file, JSON.stringify({ type: 'session_update', content: 'x'.repeat(3 * 1024 * 1024), run_id: 'r', session_id: recorded.session_id }) + '\n')
  await store.append(meta, e(2000, 'finished'))
  const first = await store.timeline()
  assert.equal(first.projection_read.bytes_read, 2 * 1024 * 1024)
  assert.equal(first.lanes[0].segments[0].end_at_ms, null)
  const second = await store.timeline()
  assert.ok(second.projection_read.bytes_read <= 2 * 1024 * 1024)
  assert.equal(second.lanes[0].segments[0].end_at_ms, 2000)
  assert.equal(second.lanes[0].history_status, 'partial') // oversized record was omitted explicitly
  assert.equal((await store.timeline()).projection_read.bytes_read, 0)
})

test('same inode rewrite with larger size invalidates cached timing boundaries', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'timeline-regrow-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'runs', 'r'), { recursive: true })
  const store = new AgentSessionStore({ dataRoot: root, runId: 'r' })
  const recorded = await store.append({ provider: 'test', agent_session_id: 'worker', execution_id: 'old' }, e(1000, 'started', 'old'))
  const file = path.join(root, 'runs', 'r', 'agent-sessions', `${recorded.session_id}.jsonl`)
  await store.timeline()
  const line = JSON.stringify({ ...e(5000, 'started', 'new'), run_id: 'r', session_id: recorded.session_id, extra: 'x'.repeat(1000) }) + '\n'
  const inode = (await stat(file)).ino
  await writeFile(file, line)
  assert.equal((await stat(file)).ino, inode)
  const result = await store.timeline()
  assert.deepEqual(result.lanes[0].segments.map(segment => segment.execution_id), ['new'])
  assert.equal((await store.timeline()).projection_read.bytes_read, 0)
})

test('all snapshot finishes stay unconfirmed because resume reconciliation can synthesize them', () => {
  const result = buildExecutionTimeline({ progress: { lifecycle_status: 'stopped', actions: {
    earlier: { execution_id: 'earlier', status: 'settled', execution_started_at_ms: 1000, execution_finished_at_ms: 2000 },
    stopped: { execution_id: 'stopped', status: 'paused', error: '用户停止 Run', execution_started_at_ms: 3000, execution_finished_at_ms: 4000 },
  } } })
  assert.deepEqual(result.lanes[0].segments.map(segment => segment.end_at_ms), [null, null])
  assert.deepEqual(result.lanes[0].segments.map(segment => segment.reported_finish_at_ms), [2000, 4000])
})

test('legacy worker notifications remain markers, never acceptance-confirmed boundaries', () => {
  const result = project([{ ...e(1000, 'started'), stage: 'source_first_worker_started' },
    { ...e(2000, 'paused'), stage: 'source_first_worker_paused' }])
  assert.equal(result.lanes[0].events.length, 2)
  assert.equal(result.lanes[0].segments[0].start_at_ms, null)
  assert.equal(result.lanes[0].segments[0].end_at_ms, null)
})
