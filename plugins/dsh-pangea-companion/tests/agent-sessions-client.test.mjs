import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function client(reactOverrides = {}) {
  let exported
  const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }), Fragment: 'fragment',
    useRef: value => ({ current: value }), useEffect() {}, useState: value => [value, () => {}], ...reactOverrides }
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    URLSearchParams, AbortController, setTimeout, clearTimeout, fetch() { throw new Error('unexpected fetch') },
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
  assert.equal(rows[1].text, '第一行\n第二行')
  assert.equal(rows[2].rawInput.path, 'src/test.c')
  assert.equal(rows[2].rawOutput.error, '工具失败')
  assert.equal(rows[2].status, 'failed')
  assert.deepEqual(Array.from(rows[2].updates, update => update.status), ['pending', 'in_progress', 'failed'])
  assert.equal(rows[3].status, 'pending')
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

test('reader uses returned byte cursor, gates live append until backlog read, and surfaces recording warnings', async () => {
  const { createAgentSessionReader } = await client()
  let state, tick, details = 0
  const cursors = []
  const reader = createAgentSessionReader({ cwd: '/a', runId: 'run-a', onChange: value => { state = value }, schedule: value => { tick = value; return 1 }, cancelSchedule() {}, request: async args => {
    if (args.view === 'agent-sessions') return { run_id: 'run-a', items: [session('a')], recording_error: '索引不完整', truncated: true }
    cursors.push(args.cursor); details++
    if (details === 1) return page('a', [{ seq: 1, type: 'host_event', message: '1' }], { next_cursor: 7009, has_more: true, recording_error: '内容已截断', truncated: true })
    return page('a', [{ seq: 2, type: 'host_event', message: '2' }], { next_cursor: 8005, has_more: false })
  } })
  reader.start(); await flush()
  assert.equal(state.cursor, 7009)
  assert.equal(state.listRecordingError, '索引不完整')
  assert.equal(state.detailRecordingError, '内容已截断')
  assert.equal(state.detailTruncated, true)
  await tick(); await flush()
  assert.equal(details, 1, 'poll must not silently advance past a backlog')
  await reader.loadMore(); await flush()
  assert.deepEqual(cursors, [0, 7009])
  assert.deepEqual(Array.from(state.events, event => event.message), ['1', '2'])
  await tick(); await flush()
  assert.deepEqual(cursors, [0, 7009, 8005])
  assert.equal(state.events.length, 2, 'repeated pages do not duplicate events')
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
  assert.equal(rows[0].text, '历史回复')
  assert.equal(rows[1].text, '新回复')
  assert.equal(rows[2].status, 'completed')
  assert.equal(rows[3].status, 'pending')
  assert.match(text(AgentSessionTranscript({ events })), /恢复时执行器回放 · 原始回合时间未知/)
})


test('history completeness warning and recorded action IDs are visible without opening raw event details', async () => {
  const history = '当前仅有部分会话记录，恢复回放已跳过，不保证此前历史完整。'
  const snapshot = { scope: ['/fixture', '/fixture/data', 'run-a'].join('\u0000'), items: [session('a')], events: [], session: { ...session('a'), history_message: history, history_status: 'metadata_only' } }
  const { AgentSessionsDialog, AgentSessionTranscript } = await client({ useState: () => [snapshot, () => {}] })
  const dialog = AgentSessionsDialog({ cwd: '/fixture', dataRoot: '/fixture/data', runId: 'run-a', onClose() {} })
  assert.ok(text(dialog).includes(history))
  assert.equal(text(dialog).includes('此历史会话仅保留身份与运行状态'), false, 'server explanation replaces duplicate metadata-only copy')
  const rendered = AgentSessionTranscript({ events: [
    { seq: 1, type: 'prompt', action_id: 'review-independent-a', prompt: [{ type: 'text', text: '复核指令' }] },
    { seq: 2, type: 'turn_end', action_id: 'review-comparison-b', stop_reason: 'completed', protocol_stop_reason: 'end_turn', response_received: true },
    { seq: 3, type: 'prompt', prompt: [{ type: 'text', text: '旧指令' }] },
  ] })
  const labels = nodes(rendered).filter(node => node.type === 'p' && text(node).startsWith('关联动作：')).map(text)
  assert.deepEqual(labels, ['关联动作：review-independent-a', '关联动作：review-comparison-b'])
})
