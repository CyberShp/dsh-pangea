import assert from 'node:assert/strict'
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { AgentSessionStore } from '../src/agent-sessions.js'

async function client(reactOverrides = {}, globals = {}) {
  let exported
  const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }), Fragment: 'fragment',
    useRef: value => ({ current: value }), useEffect() {}, useState: value => [value, () => {}], ...reactOverrides }
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    URLSearchParams, AbortController, setTimeout, clearTimeout, fetch() { throw new Error('unexpected fetch') }, ...globals,
    window: { __ModuleLoader__: { load: spec => { exported = spec.factory(() => React) } } },
  })
  return exported
}
const text = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(text).join('') : value?.children ? text(value.children) : ''
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value?.children ? [value, ...value.children.flatMap(nodes)] : []
const flush = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const session = session_id => ({ session_id, provider: 'pangea-codeagent', role: 'work', history_status: 'recorded' })
const page = (id, events = [], extra = {}) => ({ run_id: 'run-a', session: session(id), events, next_cursor: 0, has_more: false, ...extra })

// These fixtures deliberately include late responses and protocol disagreements:
// transcript inspection must remain useful when the worker is wedged.
test('agent session request is read-only and binds workspace, data root, Run and opaque cursor exactly', async () => {
  const { requestWorkbench } = await client()
  await requestWorkbench({ cwd: 'C:\\分析', dataRoot: 'D:\\data', runId: 'run-a', sessionId: 'session/a', view: 'agent-session', cursor: 19482, limit: 100, fetcher: async (url, init) => {
    const query = new URL(url, 'https://test').searchParams
    assert.equal(query.get('view'), 'agent-session')
    assert.equal(query.get('cwd'), 'C:\\分析')
    assert.equal(query.get('data_root'), 'D:\\data')
    assert.equal(query.get('run_id'), 'run-a')
    assert.equal(query.get('session_id'), 'session/a')
    assert.equal(query.get('cursor'), '19482')
    assert.equal(query.get('limit'), '100')
    assert.equal(init.method, undefined)
    assert.equal(init.body, undefined)
    return { ok: true, json: async () => ({ status: 'ok' }) }
  } })
})

test('transcript merges text chunks and tool updates without dropping transition evidence or cross-execution tools', async () => {
  const { agentSessionTranscript, mergeAgentSessionEvents } = await client()
  const events = [
    { seq: 1, type: 'prompt', prompt: [{ type: 'text', text: '分析\n调用链' }] },
    { seq: 2, execution_id: 'e1', type: 'session_update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '第一行\n' } } },
    { seq: 3, execution_id: 'e1', type: 'session_update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '第二行' } } },
    { seq: 4, execution_id: 'e1', type: 'session_update', update: { sessionUpdate: 'tool_call', toolCallId: 'tool-a', title: '读源码', status: 'pending', rawInput: { path: 'src/test.c' } } },
    { seq: 5, execution_id: 'e1', type: 'session_update', update: { sessionUpdate: 'tool_call_update', toolCallId: 'tool-a', status: 'in_progress' } },
    { seq: 6, execution_id: 'e1', type: 'session_update', update: { sessionUpdate: 'tool_call_update', toolCallId: 'tool-a', status: 'failed', rawOutput: { error: '工具失败' } } },
    { seq: 7, execution_id: 'e2', type: 'session_update', update: { sessionUpdate: 'tool_call', toolCallId: 'tool-a', title: '第二回合', status: 'pending' } },
  ]
  const rows = agentSessionTranscript(mergeAgentSessionEvents(events.slice(0, 5), events.slice(4)))
  assert.equal(rows.length, 4)
  assert.equal(rows[2].text, '第一行\n第二行')
  assert.equal(rows[1].rawInput.path, 'src/test.c')
  assert.equal(rows[1].rawOutput.error, '工具失败')
  assert.equal(rows[1].status, 'failed')
  assert.deepEqual(Array.from(rows[1].updates, update => update.status), ['pending', 'in_progress', 'failed'])
  assert.equal(rows[0].status, 'pending')
  assert.equal(events[3].update.status, 'pending', 'folding must not mutate source events')
})

test('transcript shows prompt, pending tool input, both stop reasons, recording faults, and unconfirmed cancellation', async () => {
  const { AgentSessionTranscript } = await client()
  const rendered = AgentSessionTranscript({ events: [
    { seq: 1, type: 'prompt', prompt: [{ type: 'text', text: '请定位\n调用链' }] },
    { seq: 2, type: 'session_update', update: { sessionUpdate: 'tool_call', toolCallId: 'chatcmpl-tool-9', title: '读取函数', status: 'pending', rawInput: { command: 'rg test' } } },
    { seq: 3, type: 'turn_end', stop_reason: 'completed', protocol_stop_reason: 'cancelled', response_received: true },
    { seq: 4, type: 'turn_end', stop_reason: 'cancel_requested', protocol_stop_reason: null, response_received: false },
    { seq: 5, type: 'recording_error', message: '日志行损坏' },
  ] })
  const body = text(rendered)
  for (const expected of ['请定位\n调用链', '调用输入', 'rg test', '尚未收到工具执行结果', 'completed', 'cancelled', '尚未收到 ACP 的回合结束确认', '日志行损坏']) assert.ok(body.includes(expected), expected)
  assert.ok(nodes(rendered).some(node => node.type === 'pre'))
  assert.equal(nodes(rendered).some(node => ['textarea', 'input'].includes(node.type)), false)
})

test('tool lifecycle diagnostics preserve unclosed IDs and copy evidence without folding transport metadata into tool state', async () => {
  let copied, copyNotice
  const { AgentSessionTranscript, agentSessionTranscript } = await client({ useState: value => [value, next => { copyNotice = next }] }, {
    navigator: { clipboard: { writeText: async value => { copied = value } } },
  })
  const ids = ['chatcmpl-tool-a873a78f7e539d5e', 'chatcmpl-tool-9e4b74cbae3ac799']
  const toolLifecycle = {
    schema_version: 1, request_id: 'driver-request', remote_session_id: 'remote-session',
    unclosed_count: 2, pending_count: 2, in_progress_count: 0, unknown_count: 0,
    received_tool_events: 3, accepted_tool_events: 2, unaccepted_tool_events: 1, validation_error_count: 0,
    tools: ids.map((tool_id, index) => ({ tool_id, status: 'pending', kind: 'execute',
      last_update_at_ms: Date.parse(index ? '2026-10-20T07:21:37.610Z' : '2026-10-20T07:21:28.073Z'),
      seen_in_progress: false, input_observed: true, input_nonempty: false, output_observed: false,
      received_update_count: 1, accepted_update_count: 1 })),
    tools_truncated: false, future_evidence_field: { retained: true },
  }
  const events = [
    ...ids.map((toolCallId, index) => ({ seq: index + 1, at: new Date(toolLifecycle.tools[index].last_update_at_ms).toISOString(), type: 'session_update', update: { sessionUpdate: 'tool_call', toolCallId, status: 'pending', rawInput: {} } })),
    { seq: 3, at: '2026-10-20T07:32:18.000Z', type: 'acp_tool_transport', tool_id: ids[0], status: 'completed', accepted: false },
    { seq: 4, at: '2026-10-20T07:32:19.530Z', type: 'tool_lifecycle', tool_lifecycle: toolLifecycle },
  ]
  const rows = agentSessionTranscript(events)
  assert.deepEqual(Array.from(rows, row => row.type), ['tool_lifecycle', 'acp_tool_transport', 'tool', 'tool'])
  assert.deepEqual(Array.from(rows.filter(row => row.type === 'tool'), row => [row.status, row.updates.length]), [['pending', 1], ['pending', 1]])
  const rendered = AgentSessionTranscript({ events })
  const body = text(rendered)
  for (const expected of ['工具结束确认诊断', '尚无结束确认：2 条', 'pending：2', 'in_progress：0', 'unknown：0', '未确认接收：1', '上报状态不能证明命令实际仍在执行', 'ACP 工具入站记录', ...ids]) assert.ok(body.includes(expected), expected)
  const times = nodes(rendered).filter(node => node.type === 'time').map(node => node.props.dateTime)
  for (const tool of toolLifecycle.tools) assert.ok(times.includes(new Date(tool.last_update_at_ms).toISOString()))
  const transport = nodes(rendered).find(node => node.type === 'article' && node.props.className === 'agent-event agent-acp_tool_transport')
  assert.equal(nodes(transport).find(node => node.type === 'details').props.open, false)
  const diagnosticDetails = nodes(rendered).find(node => node.type === 'details' && text(node.children[0]) === '完整工具诊断 JSON（可复制）')
  assert.notEqual(diagnosticDetails.props.open, true)
  await nodes(diagnosticDetails).find(node => node.type === 'button').props.onClick()
  assert.deepEqual(JSON.parse(copied), toolLifecycle, 'copy includes all evidence fields, not only the visible summary')
  assert.equal(copyNotice.message, '已复制完整工具诊断。')
})

test('host pause diagnostics accept partial records without inventing zero counts or completion', async () => {
  let copyNotice
  const { AgentSessionTranscript } = await client({ useState: value => [value, next => { copyNotice = next }] })
  const rendered = AgentSessionTranscript({ events: [
    { seq: 1, type: 'host_event', message: '原回合已返回，工具记录尚无结束确认', tool_lifecycle: {
      tools: [null, { tool_id: 'pending-without-time', status: 'pending' }], tools_truncated: true,
    } },
    { seq: 2, type: 'tool_lifecycle', payload: { tool_lifecycle: { tools: 'unavailable' } } },
    { seq: 3, type: 'tool_lifecycle' },
  ] })
  const body = text(rendered)
  for (const expected of ['原回合已返回，工具记录尚无结束确认', '工具结束确认诊断', '尚无结束确认：未记录', 'pending：未记录', 'in_progress：未记录', 'pending-without-time', '上报状态：pending', '时间未记录', '工具明细已截断', '完整宿主记录']) assert.ok(body.includes(expected), expected)
  assert.equal(body.includes('Invalid Date'), false)
  assert.equal(body.includes('尚无结束确认：0'), false)
  await nodes(rendered).find(node => node.type === 'button').props.onClick()
  assert.equal(copyNotice.message, '复制失败，请手动选择下方 JSON 复制。')
})

test('reader rejects late selections and late disposed Run responses while retaining last useful data on errors', async () => {
  const { createAgentSessionReader } = await client()
  const a = deferred(), b = deferred(), changes = [], requests = []
  let detailFailure = false
  const reader = createAgentSessionReader({ cwd: '/a', dataRoot: '/a/data', runId: 'run-a', onChange: value => changes.push(value), schedule: () => 1, cancelSchedule() {}, request: async args => {
    requests.push(args)
    if (args.view === 'agent-sessions') return { run_id: 'run-a', items: [session('a'), session('b')] }
    if (detailFailure) throw new Error('临时读取失败')
    return args.sessionId === 'a' ? a.promise : b.promise
  } })
  reader.start(); await flush()
  reader.select('b'); await flush()
  b.resolve(page('b', [{ seq: 1, type: 'host_event', message: 'B 会话' }], { next_cursor: 8080 }))
  await flush()
  a.resolve(page('a', [{ seq: 1, type: 'host_event', message: '过期 A 会话' }], { next_cursor: 4040 }))
  await flush()
  assert.equal(changes.at(-1).selectedId, 'b')
  assert.equal(changes.at(-1).session.session_id, 'b')
  assert.equal(changes.at(-1).events[0].message, 'B 会话')
  assert.equal(changes.at(-1).cursor, 8080)
  detailFailure = true
  reader.refresh(); await flush()
  assert.match(changes.at(-1).detailError, /临时读取失败/)
  assert.equal(changes.at(-1).events[0].message, 'B 会话')
  assert.ok(requests.every(args => args.cwd === '/a' && args.dataRoot === '/a/data' && args.runId === 'run-a'))
  reader.dispose()
  const count = changes.length
  reader.refresh(); reader.select('a'); await reader.loadMore(); await flush()
  assert.equal(changes.length, count)

  const lateList = deferred(), disposedChanges = []
  const disposedReader = createAgentSessionReader({ cwd: '/a', runId: 'old-run', onChange: value => disposedChanges.push(value), request: async args => {
    assert.equal(args.signal.aborted, false)
    return lateList.promise
  }, schedule: () => 1, cancelSchedule() {} })
  disposedReader.start(); disposedReader.dispose()
  lateList.resolve({ run_id: 'old-run', items: [session('old')] }); await flush()
  assert.equal(disposedChanges.length, 1)
})

test('reader starts at the tail and polls live events while independently loading older byte pages', async () => {
  const { createAgentSessionReader } = await client()
  let state, tick, details = 0
  const history = deferred()
  const cursors = []
  const reader = createAgentSessionReader({ cwd: '/a', runId: 'run-a', onChange: value => { state = value }, schedule: value => { tick = value; return 1 }, cancelSchedule() {}, request: async args => {
    if (args.view === 'agent-sessions') return { run_id: 'run-a', items: [session('a')], recording_error: '索引不完整', truncated: true }
    cursors.push(args.cursor)
    if (String(args.cursor).startsWith('before:')) return history.promise
    details++
    if (details === 1) return page('a', [{ seq: 201, type: 'host_event', message: '最新尾页' }], { next_cursor: 7009, history_cursor: 6001, has_history: true, recording_error: '内容已截断', truncated: true })
    return page('a', [{ seq: 202, type: 'host_event', message: '实时更新' }], { next_cursor: 8005, has_more: false })
  } })
  reader.start(); await flush()
  assert.equal(state.cursor, 7009)
  assert.equal(state.listRecordingError, '索引不完整')
  assert.equal(state.detailRecordingError, '内容已截断')
  assert.equal(state.detailTruncated, true)
  const pendingHistory = reader.loadMore(); await flush()
  await tick(); await flush()
  assert.equal(details, 2, 'history loading must not block current output')
  assert.equal(state.cursor, 8005)
  history.resolve(page('a', [{ seq: 101, type: 'host_event', message: '更早历史' }], { next_cursor: 6001, history_cursor: 0, has_history: false }))
  await pendingHistory
  assert.equal(state.cursor, 8005, 'an older response never rewinds the live cursor')
  assert.deepEqual(cursors, ['latest', 'before:6001', 7009])
  assert.deepEqual(Array.from(state.events, event => event.message), ['更早历史', '最新尾页', '实时更新'])
  assert.equal(state.hasMore, false)
  await tick(); await flush()
  assert.deepEqual(cursors, ['latest', 'before:6001', 7009, 8005])
  assert.equal(state.events.length, 3, 'repeated pages do not duplicate events')
  reader.dispose()
})

test('reader rejects mismatched Run or session without accepting the cursor or foreign content', async () => {
  const { createAgentSessionReader } = await client()
  for (const response of [page('a', [{ seq: 1 }], { run_id: 'other-run' }), page('other-session', [{ seq: 1 }])]) {
    let state
    const reader = createAgentSessionReader({ cwd: '/a', runId: 'run-a', onChange: value => { state = value }, schedule: () => 1, cancelSchedule() {}, request: async args => args.view === 'agent-sessions' ? { run_id: 'run-a', items: [session('a')] } : response })
    reader.start(); await flush()
    assert.match(state.detailError, /不属于|不匹配/)
    assert.equal(state.events.length, 0)
    assert.equal(state.cursor, 0)
    reader.dispose()
  }
})

test('historical session replay is labelled and never merged with new live chunks or tool execution', async () => {
  const { agentSessionTranscript, AgentSessionTranscript } = await client()
  const events = [
    { seq: 1, type: 'session_update', replay: true, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '历史回复' } } },
    { seq: 2, type: 'session_update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '新回复' } } },
    { seq: 3, type: 'session_update', replay: true, update: { sessionUpdate: 'tool_call', toolCallId: 'same-id', status: 'completed' } },
    { seq: 4, type: 'session_update', update: { sessionUpdate: 'tool_call', toolCallId: 'same-id', status: 'pending' } },
  ]
  const rows = agentSessionTranscript(events)
  assert.equal(rows.length, 4)
  assert.equal(rows[3].text, '历史回复')
  assert.equal(rows[2].text, '新回复')
  assert.equal(rows[1].status, 'completed')
  assert.equal(rows[0].status, 'pending')
  assert.match(text(AgentSessionTranscript({ events })), /恢复时执行器回放 · 原始回合时间未知/)
})


test('history completeness warning and recorded action IDs are visible without opening raw event details', async () => {
  const history = '当前仅有部分会话记录，恢复回放已跳过，不保证此前历史完整。'
  const snapshot = { scope: ['/fixture', '/fixture/data', 'run-a'].join('\u0000'), items: [session('a')], events: [], session: { ...session('a'), history_message: history, history_status: 'metadata_only' } }
  const { AgentSessionsDialog, AgentSessionTranscript } = await client({ useState: initial => [initial === null ? snapshot : initial, () => {}] })
  const dialog = AgentSessionsDialog({ cwd: '/fixture', dataRoot: '/fixture/data', runId: 'run-a', onClose() {} })
  assert.ok(text(dialog).includes(history))
  assert.equal(text(dialog).includes('此历史会话仅保留身份与运行状态'), false, 'server explanation replaces duplicate metadata-only copy')
  const rendered = AgentSessionTranscript({ events: [
    { seq: 1, type: 'prompt', action_id: 'review-independent-a', prompt: [{ type: 'text', text: '复核指令' }] },
    { seq: 2, type: 'turn_end', action_id: 'review-comparison-b', stop_reason: 'completed', protocol_stop_reason: 'end_turn', response_received: true },
    { seq: 3, type: 'prompt', prompt: [{ type: 'text', text: '旧指令' }] },
  ] })
  const labels = nodes(rendered).filter(node => node.type === 'p' && text(node).startsWith('关联动作：')).map(text)
  assert.deepEqual(labels, ['关联动作：review-comparison-b', '关联动作：review-independent-a'])
})

test('assembled blocks use latest valid update time, while streamed content and tool transitions stay in seq order', async () => {
  const { agentSessionTranscript, AgentSessionTranscript } = await client()
  const at = second => `2026-10-16T12:00:${String(second).padStart(2, '0')}Z`
  const chunk = (seq, time, text) => ({ seq, at: time, type: 'session_update', update: { sessionUpdate: 'agent_message_chunk', content: { text } } })
  const events = [
    { seq: 1, at: at(1), type: 'prompt', prompt: '开始' },
    { seq: 2, at: at(2), type: 'session_update', execution_id: 'e', update: { sessionUpdate: 'tool_call', toolCallId: 't', status: 'pending', rawInput: 'input' } },
    chunk(3, at(3), '首段\n'), chunk(4, at(4), '后段'),
    { seq: 5, at: at(6), type: 'session_update', execution_id: 'e', update: { sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'completed', rawOutput: 'late result' } },
    { seq: 6, at: at(5), type: 'turn_end' },
    { seq: 7, at: 'invalid', type: 'host_event', message: '无时间1' },
    { seq: 8, type: 'host_event', message: '无时间2' },
  ]
  const rows = agentSessionTranscript([...events].reverse())
  assert.deepEqual(Array.from(rows, row => row.key), ['tool-2', 'event-6', 'text-3', 'event-1', 'event-8', 'event-7'])
  assert.equal(rows[0].last_at, at(6))
  assert.equal(rows[0].rawOutput, 'late result')
  assert.deepEqual(Array.from(rows[0].updates, row => row.seq), [2, 5])
  assert.equal(rows[2].text, '首段\n后段')
  assert.equal(rows[2].last_at, at(4))
  const rendered = AgentSessionTranscript({ events })
  assert.equal(nodes(rendered).find(node => node.type === 'time').props.dateTime, at(6))
  assert.doesNotMatch(text(rendered), /Invalid Date/)
  assert.equal(events[1].update.status, 'pending')
  const tied = agentSessionTranscript([{ seq: 1, type: 'host_event', at: at(1) }, { seq: 2, type: 'host_event', at: at(1) }])
  assert.deepEqual(Array.from(tied, row => row.seq), [2, 1])
})

test('session list uses latest activity and polling never steals the selected session', async () => {
  const { createAgentSessionReader } = await client()
  let state, tick, items = [
    { ...session('old'), created_at: '2026-01-01', updated_at: '2026-10-16T12:00:01Z' },
    { ...session('new'), created_at: '2026-10-01', updated_at: '2026-10-16T12:00:02Z' },
    { ...session('unknown'), updated_at: 'not-a-date' },
  ]
  const reader = createAgentSessionReader({ cwd: '/a', runId: 'run-a', onChange: value => { state = value }, schedule: value => { tick = value; return 1 }, cancelSchedule() {}, request: async args => {
    return args.view === 'agent-sessions' ? { run_id: 'run-a', items } : page(args.sessionId)
  } })
  reader.start(); await flush()
  assert.deepEqual(Array.from(state.items, item => item.session_id), ['new', 'old', 'unknown'])
  assert.equal(state.selectedId, 'new')
  reader.select('old'); await flush()
  items = [{ ...items[1], updated_at: '2026-10-16T12:00:03Z' }]
  await tick(); await flush()
  assert.equal(state.selectedId, 'old', 'a reordered or incomplete list must not replace an explicit selection')
  reader.dispose()
})

test('live backlog drains forward and rejects regressing cursors without duplicates or history cursor changes', async () => {
  const { createAgentSessionReader } = await client()
  let state, tick, reads = 0
  const cursors = []
  const reader = createAgentSessionReader({ cwd: '/a', runId: 'run-a', onChange: value => { state = value }, schedule: value => { tick = value; return 1 }, cancelSchedule() {}, request: async args => {
    if (args.view === 'agent-sessions') return { run_id: 'run-a', items: [session('a')] }
    cursors.push(args.cursor)
    const pages = [
      page('a', [{ seq: 100 }], { next_cursor: 1000, history_cursor: 900, has_history: true }),
      page('a', [{ seq: 101 }], { next_cursor: 2000, has_more: true }),
      page('a', [{ seq: 102 }], { next_cursor: 3000 }),
      page('a', [{ seq: 99 }], { next_cursor: 2000 }),
    ]
    return pages[reads++]
  } })
  reader.start(); await flush(); await tick(); await flush()
  assert.deepEqual(cursors, ['latest', 1000, 2000])
  assert.equal(state.cursor, 3000)
  assert.equal(state.historyCursor, 900)
  await tick(); await flush()
  assert.equal(state.cursor, 3000)
  assert.match(state.detailError, /倒退/)
  assert.deepEqual(Array.from(state.events, event => event.seq), [100, 101, 102])
  reader.dispose()
})

test('real Store and reader show the latest block first beyond 100 records without losing late tool updates while loading history', async t => {
  const { createAgentSessionReader, agentSessionTranscript } = await client()
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'session-reader-tail-'))
  t.after(() => rm(dataRoot, { force: true, recursive: true }))
  await mkdir(path.join(dataRoot, 'runs', 'run-a'), { recursive: true })
  const store = new AgentSessionStore({ dataRoot, runId: 'run-a' })
  const meta = { provider: 'fixture', remote_session_id: 'session', execution_id: 'execution' }
  const at = index => new Date(Date.UTC(2026, 9, 16, 12, 0, index)).toISOString()
  await store.append(meta, { at: at(0), type: 'session_update', update: { sessionUpdate: 'tool_call', toolCallId: 't', title: '早期工具', status: 'pending', rawInput: '原始输入' } })
  for (let index = 1; index <= 205; index++) await store.append(meta, { at: at(index), type: 'host_event', message: String(index) })
  await store.append(meta, { at: at(206), type: 'session_update', update: { sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'completed', rawOutput: '晚到结果' } })
  let state, tick
  const ready = deferred()
  const reader = createAgentSessionReader({ cwd: dataRoot, dataRoot, runId: 'run-a', onChange: value => { state = value; if (value.tailLoaded) ready.resolve() },
    schedule: value => { tick = value; return 1 }, cancelSchedule() {}, request: args => args.view === 'agent-sessions' ? store.list() : store.read(args.sessionId, args) })
  t.after(() => reader.dispose())
  reader.start(); await ready.promise
  assert.equal(state.events.length, 100)
  assert.equal(agentSessionTranscript(state.events)[0].rawOutput, '晚到结果')
  assert.equal(state.hasMore, true)
  const firstCursor = state.cursor
  await store.append(meta, { at: at(207), type: 'host_event', message: '仍在实时同步' })
  await Promise.all([reader.loadMore(), tick()])
  const liveCursor = state.cursor
  assert.ok(liveCursor > firstCursor)
  while (state.hasMore) await reader.loadMore()
  assert.equal(state.cursor, liveCursor)
  assert.equal(state.events.length, 208)
  assert.equal(new Set(state.events.map(event => event.seq)).size, 208)
  const rows = agentSessionTranscript(state.events)
  assert.equal(rows[0].message, '仍在实时同步')
  assert.equal(rows[1].title, '早期工具')
  assert.equal(rows[1].rawInput, '原始输入')
  assert.equal(rows[1].rawOutput, '晚到结果')
  assert.deepEqual(Array.from(rows[1].updates, update => update.status), ['pending', 'completed'])
})

test('task entry opens its exact failed attempt and ambiguous unit entries do not pick a newer success', async () => {
  const { createAgentSessionReader } = await client()
  const items = [{ ...session('failed-attempt'), unit_id: 'unit-a', attempt_id: 'try-1', action_ids: ['action-failed'], status: 'failed', updated_at: '2026-10-21T01:00:00Z' }, { ...session('newer-success'), unit_id: 'unit-a', attempt_id: 'try-2', action_ids: ['action-newer'], status: 'completed', updated_at: '2026-10-21T02:00:00Z' }]
  for (const [initialSelection, selected] of [[{ initialUnitId: 'unit-a', initialAttemptId: 'try-1', initialActionId: 'action-failed' }, 'failed-attempt'], [{ initialUnitId: 'unit-a' }, null]]) {
    let state; const opened = []
    const reader = createAgentSessionReader({ cwd: '/fixture', runId: 'run-a', initialSelection, schedule: () => 1, cancelSchedule() {}, onChange: value => { state = value }, request: async args => {
      if (args.view === 'agent-sessions') return { run_id: 'run-a', items }
      opened.push(args.sessionId); return page(args.sessionId, [])
    } })
    reader.start(); await flush(); await flush()
    if (selected) { assert.equal(state.selectedId, selected); assert.deepEqual(opened, [selected]) }
    else { assert.equal(opened.length, 0); assert.match(state.detailError, /关联到多个尝试/) }
    reader.dispose()
  }
})
