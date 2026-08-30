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

test('PANGEA client registers the test workbench, analysis, and execution pages', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /测试工作台/)
  assert.match(source, /真实运行指标/)
  assert.match(source, /需要处理/)
  assert.match(source, /已有报告/)
  assert.match(source, /data-pangea-product-mode/)
  assert.match(source, /ctx\?\.pangea\?\.openPage\?\.\(scope, pageId\)/)
  assert.match(source, /实际加载方法论/)
  assert.match(source, /SHA-256/)
  assert.match(source, /来源基线/)
  assert.match(source, /选择依据/)
  assert.match(source, /source_catalog_path/)
  assert.match(source, /用户方法论/)
  assert.match(source, /source_item_ids/)
  assert.match(source, /总览/)
  assert.match(source, /React\.useState\(\{ type: initialScreen \}\)/)
  assert.match(source, /repeat\(4, minmax\(72px, 1fr\)\)/)
  assert.match(source, /\['overview', '总览'\], \['risks', '待处理'\], \['cases', '测试计划'\], \['execution', '执行结果'\]/)
  assert.doesNotMatch(source, /\['workflow', '流程'\], \['risks', '风险'\]/)
  assert.doesNotMatch(source, /\['monitor', '监控'\]/)
  assert.doesNotMatch(source, /if \(screen\.type === 'monitor'\) body = renderMonitor/)
  assert.match(source, /风险/)
  assert.match(source, /用例/)
  assert.match(source, /证据/)
  assert.match(source, /复核/)
  assert.match(source, /业务流/)
  assert.match(source, /新建分析/)
  assert.match(source, /Action 生命周期/)
  assert.match(source, /后端与工作台不兼容/)
  assert.match(source, /停止 Run/)
  assert.match(source, /执行环境/)
  assert.match(source, /开始执行计划/)
  assert.match(source, /优先失败场景/)
  assert.match(source, /技术详情/)
  assert.match(source, /未归入分析单元/)
  assert.match(source, /用例尚未编号，不能选择/)
  assert.match(source, /filter\(hasText\)/)
  assert.match(source, /← 返回/)
  assert.match(source, /数据状态/)
  assert.match(source, /数据读取异常/)
  assert.match(source, /当前结构化结果不可信/)
  assert.match(source, /不能把空列表解释为/)
  assert.match(source, /AbortController/)
  assert.match(source, /const ACTIVE_POLL_INTERVAL_MS = 10_000/)
  assert.match(source, /const IDLE_POLL_INTERVAL_MS = 45_000/)
  assert.match(source, /snapshotPollInterval\(value\)/)
  assert.match(source, /同步失败，继续显示上次结果/)
  assert.match(source, /和 DSH 讨论/)
  assert.match(source, /加入当前会话/)
  assert.match(source, /打开完整文件/)
  assert.match(source, /源码片段/)
  assert.match(source, /检查这段源码/)
  assert.match(source, /选择风险证据源码/)
  assert.match(source, /选择待核对结论/)
  assert.match(source, /选择核对证据/)
  assert.match(source, /核对选中证据/)
  assert.match(source, /转成定向测试/)
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

  assert.deepEqual(Array.from(exported.inject), ['pangea'])
  const pages = []
  exported.apply({
    pangea: { registerPage(page) { pages.push(page); return () => {} } },
    effect(factory) { return factory() },
  })
  assert.equal(pages.length, 3)
  assert.deepEqual(pages.map(page => page.id), ['workbench', 'analysis', 'execution'])
  assert.deepEqual(pages.map(page => page.title()), ['工作台', 'PANGEA 分析', '环境配置'])
  assert.deepEqual(pages.map(page => page.order), [0, 10, 20])
})

test('workbench API lists runs and starts or stops through explicit actions', async () => {
  const source = await readFile(clientPath, 'utf8')
  let exported
  const sandbox = { URLSearchParams, console }
  sandbox.window = { __ModuleLoader__: { load(spec) { exported = spec.factory(name => name === 'react' ? fakeReact() : {}) } } }
  vm.runInNewContext(source, sandbox, { filename: clientPath })
  const calls = []
  const fetcher = async (url, options = {}) => {
    calls.push({ url, options })
    return { ok: true, status: 200, async json() { return { status: 'ok' } } }
  }

  await exported.requestWorkbench({ cwd: '/tmp/workspace', cursor: 20, limit: 10, fetcher })
  await exported.requestWorkbenchAction({ cwd: '/tmp/workspace', action: 'stop', payload: { run_id: 'run-1' }, fetcher })

  const listUrl = new URL(calls[0].url, 'http://localhost')
  assert.equal(listUrl.searchParams.get('cursor'), '20')
  assert.equal(listUrl.searchParams.get('limit'), '10')
  assert.equal(calls[1].options.method, 'POST')
  assert.deepEqual(JSON.parse(calls[1].options.body), { action: 'stop', run_id: 'run-1' })
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
      external_observation: '日志出现旧会话', exclusion_condition: '正常退出不触发',
      upstream_semantics: { conclusion: 'risk_remains' },
      evidence: [
        { location: 'src/auth.c:88-91', observation: '失败路径未清理' },
        { location: 'src/session.c:12-30', observation: '另一条证据' },
      ],
      linked_test_case_ids: ['TC-023'],
    },
    testCases: [{ test_case_id: 'TC-023', title: '认证中断后重连' }],
    sourceSnippet: {
      file_path: '/tmp/src/auth.c', location: 'src/auth.c:88-91', visible_start: 87, visible_end: 89,
      lines: [{ number: 87, text: 'before' }, { number: 88, text: 'if (failed) return;' }, { number: 89, text: 'after' }],
    },
  })
  assert.match(draft, /只基于下方“选中源码片段”/)
  assert.match(draft, /不要调用工具/)
  assert.match(draft, /Run：run-17/)
  assert.match(draft, /对象：风险 R-017/)
  assert.match(draft, /待核对结论：旧状态被复用/)
  assert.match(draft, /选中源码片段：\/tmp\/src\/auth\.c:87-89/)
  assert.match(draft, /88 \| if \(failed\) return;/)
  assert.doesNotMatch(draft, /src\/session\.c:12-30|另一条证据/)
  assert.doesNotMatch(draft, /直接证据|关联测试用例|TC-023/)
  assert.doesNotMatch(draft, /重连|日志出现旧会话|正常退出不触发|risk_remains/)
  assert.doesNotMatch(draft, /final-state\.json|progress\.json/)

  assert.deepEqual(Array.from(exported.splitRiskClaims('注销超时；连接保持活动。新连接失败')), ['注销超时；', '连接保持活动。', '新连接失败'])
  assert.deepEqual(Array.from(exported.splitRiskClaims('NOP 因 !full_feature 直接返回；连接保持活动。')), ['NOP 因 !full_feature 直接返回；', '连接保持活动。'])

  const multiEvidenceDraft = exported.buildDiscussionDraft({
    kind: 'risk', runId: 'run-17', intent: 'evidence', selectedClaim: '连接保持活动。',
    item: {
      risk_id: 'R-017', title: '认证状态残留', system_result: '注销超时；连接保持活动。新连接失败',
      trigger: '重连', external_observation: '日志出现旧会话',
      evidence: [{ location: 'a.c:1-2' }, { location: 'b.c:3-4' }, { location: 'c.c:5-6' }],
    },
    sourceSnippets: [
      { file_path: '/tmp/a.c', visible_start: 1, visible_end: 2, lines: [{ number: 1, text: 'a();' }] },
      { file_path: '/tmp/b.c', visible_start: 3, visible_end: 4, lines: [{ number: 3, text: 'b();' }] },
    ],
  })
  assert.match(multiEvidenceDraft, /待核对结论：连接保持活动。/)
  assert.match(multiEvidenceDraft, /选中源码片段 1\/2：\/tmp\/a\.c:1-2/)
  assert.match(multiEvidenceDraft, /选中源码片段 2\/2：\/tmp\/b\.c:3-4/)
  assert.doesNotMatch(multiEvidenceDraft, /重连|日志出现旧会话|c\.c/)

  const targetedTestDraft = exported.buildDiscussionDraft({
    kind: 'risk', runId: 'run-17', intent: 'targeted-executable', selectedClaim: '连接保持活动。',
    item: {
      risk_id: 'R-017', title: '认证状态残留', system_result: '注销超时；连接保持活动。新连接失败',
      trigger: '登录后中断', external_observation: '连接列表持续可见',
      evidence: [{ location: 'a.c:1-2' }, { location: 'b.c:3-4' }],
    },
    sourceSnippets: [{ file_path: '/tmp/b.c', visible_start: 3, visible_end: 4, lines: [{ number: 3, text: 'b();' }] }],
  })
  assert.match(targetedTestDraft, /待测试结论：连接保持活动。/)
  assert.match(targetedTestDraft, /触发条件：登录后中断/)
  assert.match(targetedTestDraft, /外部观察：连接列表持续可见/)
  assert.match(targetedTestDraft, /选中源码片段：\/tmp\/b\.c:3-4/)
  assert.match(targetedTestDraft, /只生成这一个结论对应的单个测试/)
  assert.match(targetedTestDraft, /不得增加可选扩展、其他风险后果或第二个测试/)
  assert.doesNotMatch(targetedTestDraft, /注销超时|新连接失败|a\.c/)

  const reviewDraft = exported.buildDiscussionDraft({
    kind: 'risk', runId: 'run-17', intent: 'review',
    item: {
      risk_id: 'R-017', title: '认证状态残留', system_result: '旧状态被复用',
      evidence: [{ location: 'src/auth.c:88-91', observation: '失败路径未清理' }],
      linked_test_case_ids: ['TC-023'],
    },
    testCases: [{ test_case_id: 'TC-023', title: '认证中断后重连' }],
  })
  assert.match(reviewDraft, /直接证据：/)
  assert.match(reviewDraft, /src\/auth\.c:88-91 — 失败路径未清理/)
  assert.match(reviewDraft, /TC-023 认证中断后重连/)

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
  assert.equal(exported.evidenceIdentity({ chunk_id: 'e-1', location: 'src/auth.c:88-91', observation: '状态未清理' }), 'e-1\u0000src/auth.c:88-91\u0000状态未清理')
  assert.equal(exported.evidenceTabLabel({ location: 'spdk-full:lib/iscsi/conn.c:121-240' }, 0), '1 · conn.c:121–240')
  assert.equal(exported.evidenceTabLabel({ location: 'docs/spec.md#L12-L16' }, 1), '2 · spec.md:12–16')
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
    sessionId: 'session 17',
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
  assert.match(calls[0].url, /session_id=session\+17/)
  assert.equal(calls[0].options.cache, 'no-store')
  assert.equal(calls[0].options.signal, signal)

  await assert.rejects(() => exported.requestSnapshot({
    cwd: '/tmp/pangea',
    async fetcher() { return { ok: false, status: 404, async json() { return { status: 'error', error: 'not-found' } } } },
  }), /not-found/)
})
