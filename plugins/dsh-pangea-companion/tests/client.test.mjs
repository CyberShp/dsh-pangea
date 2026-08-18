import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientPath = path.resolve(here, '..', 'lib', 'client.js')

function fakeReact() {
  return {
    createElement(type, props, ...children) { return { type, props: props ?? {}, children } },
    Fragment: Symbol('Fragment'),
    useState(initial) { return [initial, () => {}] },
    useCallback(fn) { return fn },
    useEffect() {},
    useRef(initial) { return { current: initial } },
  }
}

test('better-sidebar client registers one PANGEA single tab and exposes Chinese health/navigation affordances', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /总览/)
  assert.match(source, /风险/)
  assert.match(source, /用例/)
  assert.match(source, /证据/)
  assert.match(source, /复核/)
  assert.match(source, /← 返回/)
  assert.match(source, /数据状态/)
  assert.match(source, /数据读取异常/)
  assert.match(source, /当前结构化结果不可信/)
  assert.match(source, /不能把空列表解释为/)
  assert.match(source, /AbortController/)
  assert.match(source, /setTimeout\(\(\) => \{ void poll\(\) \}, 4000\)/)
  assert.match(source, /同步失败，继续显示上次结果/)
  assert.match(source, /和 DSH 讨论/)
  assert.match(source, /加入当前会话/)
  assert.match(source, /打开完整文件/)
  assert.match(source, /源码片段/)
  assert.match(source, /连同源码加入会话/)
  assert.match(source, /打开 HTML 报告/)
  assert.doesNotMatch(source, /Current Run|Recent Runs|Refreshing/)

  let exported
  const sandbox = { URLSearchParams, console, fetch: async () => { throw new Error('fetch must not run during registration') }, setInterval, clearInterval }
  sandbox.window = {
    setInterval, clearInterval,
    __ModuleLoader__: {
      load(spec) {
        const require = name => {
          if (name === 'react') return fakeReact()
          throw new Error(`unexpected client require: ${name}`)
        }
        exported = spec.factory(require)
      },
    },
  }
  vm.runInNewContext(source, sandbox, { filename: clientPath })

  assert.deepEqual(Array.from(exported.inject), ['betterSidebar'])
  const tabs = []
  exported.apply({
    betterSidebar: { registerTab(tab) { tabs.push(tab); return () => {} } },
    effect(factory) { return factory() },
  })
  assert.equal(tabs.length, 1)
  assert.equal(tabs[0].id, 'dsh-pangea-companion:pangea')
  assert.equal(tabs[0].single, true)
  assert.equal(tabs[0].title(), 'PANGEA')
})

test('client builds focused discussion drafts, appends them to the active DSH composer, and resolves evidence paths', async () => {
  const source = await readFile(clientPath, 'utf8')
  let exported
  const sandbox = { URLSearchParams, console, fetch: async () => { throw new Error('default fetch must not run') }, setTimeout, clearTimeout }
  sandbox.window = {
    setTimeout,
    clearTimeout,
    __ModuleLoader__: {
      load(spec) {
        exported = spec.factory(name => {
          if (name === 'react') return fakeReact()
          throw new Error(`unexpected client require: ${name}`)
        })
      },
    },
  }
  vm.runInNewContext(source, sandbox, { filename: clientPath })

  const draft = exported.buildDiscussionDraft({
    kind: 'risk',
    runId: 'run-17',
    intent: 'evidence',
    item: {
      risk_id: 'R-017', title: '认证状态残留', severity: 'High', trigger: '重连', system_result: '旧状态被复用',
      evidence: [{ location: 'src/auth.c:88-91', observation: '失败路径未清理' }], linked_test_case_ids: ['TC-023'],
    },
    testCases: [{ test_case_id: 'TC-023', title: '认证中断后重连' }],
    sourceSnippet: {
      file_path: '/tmp/src/auth.c', location: 'src/auth.c:88-91', visible_start: 87, visible_end: 89,
      lines: [{ number: 87, text: 'before' }, { number: 88, text: 'if (failed) return;' }, { number: 89, text: 'after' }],
    },
  })
  assert.match(draft, /证据是否充分/)
  assert.match(draft, /Run：run-17/)
  assert.match(draft, /对象：风险 R-017/)
  assert.match(draft, /src\/auth\.c:88-91/)
  assert.match(draft, /TC-023 认证中断后重连/)
  assert.match(draft, /源码片段：\/tmp\/src\/auth\.c:87-89/)
  assert.match(draft, /88 \| if \(failed\) return;/)
  assert.doesNotMatch(draft, /final-state\.json|progress\.json/)

  let currentDraft = '我原来的问题'
  const input = { state: { getSnapshot: () => ({ draft: currentDraft }) }, setDraft(value) { currentDraft = value } }
  const actx = { id: 'session-context' }
  const ctx = {
    sessions: { scope: id => id === 'session-1' ? actx : undefined },
    get: name => name === 'conversation' ? { input: { for: value => value === actx ? input : undefined } } : undefined,
  }
  assert.equal(exported.appendConversationDraft(ctx, { sessionId: 'session-1' }, draft), true)
  assert.match(currentDraft, /^我原来的问题\n\n/)
  assert.match(currentDraft, /对象：风险 R-017/)
  assert.equal(exported.appendConversationDraft(ctx, { sessionId: 'missing' }, draft), false)

  assert.equal(exported.filePathFromLocation('src/auth.c:88-91'), 'src/auth.c')
  assert.equal(exported.filePathFromLocation('docs/spec.md#L12-L16'), 'docs/spec.md')
  assert.equal(exported.filePathFromLocation('https://example.com/spec#L12'), undefined)
  assert.equal(exported.absoluteWorkspacePath('/Volumes/Media/pangea-agent', 'src/auth.c'), '/Volumes/Media/pangea-agent/src/auth.c')
  assert.equal(exported.absoluteWorkspacePath('/Volumes/Media/pangea-agent', '/tmp/report.html'), '/tmp/report.html')
  assert.equal(exported.evidenceFilePath('spdk-full:lib/iscsi/conn.c:121-240', '/Volumes/Media/pangea-agent', '/Volumes/Media/pangea-agent/pangea-data'), '/Volumes/Media/pangea-agent/pangea-data/repositories/spdk-full/lib/iscsi/conn.c')
  assert.equal(exported.evidenceFilePath('src/auth.c:88-91', '/Volumes/Media/pangea-agent', '/Volumes/Media/pangea-agent/pangea-data'), '/Volumes/Media/pangea-agent/src/auth.c')
})

test('client source request encodes the evidence location and returns a line-aware snippet', async () => {
  const source = await readFile(clientPath, 'utf8')
  let exported
  const sandbox = { URLSearchParams, console, fetch: async () => { throw new Error('default fetch must not run') }, setTimeout, clearTimeout }
  sandbox.window = {
    setTimeout,
    clearTimeout,
    __ModuleLoader__: {
      load(spec) {
        exported = spec.factory(name => {
          if (name === 'react') return fakeReact()
          throw new Error(`unexpected client require: ${name}`)
        })
      },
    },
  }
  vm.runInNewContext(source, sandbox, { filename: clientPath })

  const calls = []
  const result = await exported.requestSourceSnippet({
    cwd: '/Volumes/Media/pangea-agent',
    dataRoot: '/Volumes/Media/pangea-agent/pangea-data',
    location: 'spdk-full:lib/iscsi/conn.c:121-124',
    async fetcher(url, options) {
      calls.push({ url, options })
      return { ok: true, status: 200, async json() { return { status: 'ok', target_start: 121, target_end: 124, lines: [] } } }
    },
  })
  assert.equal(result.target_start, 121)
  assert.match(calls[0].url, /^\/api\/pangea-companion\/source\?/)
  assert.match(calls[0].url, /location=spdk-full%3Alib%2Fiscsi%2Fconn\.c%3A121-124/)
  assert.equal(calls[0].options.cache, 'no-store')
})

test('client state request encodes workspace and run, passes cancellation, and returns only ok snapshots', async () => {
  const source = await readFile(clientPath, 'utf8')
  let exported
  const sandbox = { URLSearchParams, console, fetch: async () => { throw new Error('default fetch must not run') }, setTimeout, clearTimeout }
  sandbox.window = {
    setTimeout,
    clearTimeout,
    __ModuleLoader__: {
      load(spec) {
        exported = spec.factory(name => {
          if (name === 'react') return fakeReact()
          throw new Error(`unexpected client require: ${name}`)
        })
      },
    },
  }
  vm.runInNewContext(source, sandbox, { filename: clientPath })

  const calls = []
  const signal = { marker: 'cancel-signal' }
  const result = await exported.requestSnapshot({
    cwd: '/Volumes/Media/pangea agent',
    runId: 'run 01',
    signal,
    async fetcher(url, options) {
      calls.push({ url, options })
      return { ok: true, status: 200, async json() { return { status: 'ok', current: { run_id: 'run 01' } } } }
    },
  })

  assert.equal(result.current.run_id, 'run 01')
  assert.match(calls[0].url, /^\/api\/pangea-companion\/state\?/)
  assert.match(calls[0].url, /cwd=%2FVolumes%2FMedia%2Fpangea\+agent/)
  assert.match(calls[0].url, /run_id=run\+01/)
  assert.equal(calls[0].options.cache, 'no-store')
  assert.equal(calls[0].options.signal, signal)

  await assert.rejects(() => exported.requestSnapshot({
    cwd: '/tmp/pangea',
    async fetcher() { return { ok: false, status: 404, async json() { return { status: 'error', error: 'not-found' } } } },
  }), /not-found/)
})
