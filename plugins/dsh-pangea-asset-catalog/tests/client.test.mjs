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
  }
}

async function loadClient(react = fakeReact(), globals = {}) {
  const source = await readFile(clientPath, 'utf8')
  let exported
  const sandbox = {
    URLSearchParams, AbortController, console, setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: async () => { throw new Error('default fetch must not run') },
    ...globals,
  }
  sandbox.window = { __ModuleLoader__: { load(spec) { exported = spec.factory(() => react) } } }
  vm.runInNewContext(source, sandbox, { filename: clientPath })
  return { source, exported }
}

test('registers a PANGEA-owned asset management page', async () => {
  const { source, exported } = await loadClient()
  for (const text of [
    '资产管理', '导入资产', '需求', '设计', '历史缺陷', '参考资料', 'Coverage',
    '待人工审核', '审核通过', '拒绝', '已分析，无结构化条目', '资产已完成规范化',
    '上一页', '下一页', '用例示例', '资产状态',
    '用于新分析', '结构化条目', '用户方法论', '生成方法论候选', '待启用',
    '内容更新后状态会自动回到待启用', 'enable_methodology', 'disable_methodology',
    'Semantic 语义资产', 'Evidence 证据资产', '预览导入', '导入冲突策略',
    '编辑资产信息', '下载失败记录', '恢复', '废弃',
  ]) assert.match(source, new RegExp(text))
  assert.doesNotMatch(source, /生成目录文件|自动化文件|修正后确认/)

  const pages = []
  exported.apply({
    pangea: { registerPage(page) { pages.push(page); return () => {} } },
    effect(factory) { return factory() },
  })
  assert.deepEqual(Array.from(exported.inject), ['pangea', 'sessions'])
  assert.equal(pages.length, 1)
  assert.equal(pages[0].id, 'assets')
  assert.equal(pages[0].title(), '资产管理')
})

test('uses the same product typography scale as PANGEA analysis pages', async () => {
  const { source } = await loadClient()
  assert.match(source, /"Huawei Sans", "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei UI"/)
  assert.match(source, /fontSize: 14/)
  assert.match(source, /button: \{[\s\S]*fontSize: 13/)
  assert.match(source, /meta: \{[\s\S]*fontSize: 12/)
  assert.doesNotMatch(source, /fontSize: 9/)
  assert.doesNotMatch(source, /fontSize: 10/)
})

test('client uses server pagination status and type filters detail loading and explicit actions', async () => {
  const { exported } = await loadClient()
  const calls = []
  const fetcher = async (url, options = {}) => {
    calls.push({ url, options })
    return { ok: true, status: 200, async json() { return { status: 'ok', assets: [], pagination: {} } } }
  }
  await exported.requestState({ cwd: '/tmp/workspace', page: 2, pageSize: 50, type: 'design', status: 'available', kind: 'semantic', query: 'tcp', fetcher })
  await exported.requestState({ cwd: '/tmp/workspace', repositoryId: 'repo-one', moduleTag: 'dhcp', fetcher })
  await exported.requestAssetDetail({ cwd: '/tmp/workspace', assetId: 'asset-1', fetcher })
  await exported.requestMethodologyDetail({ cwd: '/tmp/workspace', methodologyId: 'method-1', fetcher })
  await exported.requestAction({ cwd: '/tmp/workspace', action: 'extract', payload: { asset_id: 'asset-1' }, fetcher })
  const listUrl = new URL(calls[0].url, 'http://localhost')
  assert.equal(listUrl.searchParams.get('page'), '2')
  assert.equal(listUrl.searchParams.get('page_size'), '50')
  assert.equal(listUrl.searchParams.get('type'), 'design')
  assert.equal(listUrl.searchParams.get('status'), 'available')
  assert.equal(listUrl.searchParams.get('kind'), 'semantic')
  assert.equal(listUrl.searchParams.get('q'), 'tcp')
  const scopedUrl = new URL(calls[1].url, 'http://localhost')
  assert.equal(scopedUrl.searchParams.get('repository_id'), 'repo-one')
  assert.equal(scopedUrl.searchParams.get('module_tag'), 'dhcp')
  assert.equal(new URL(calls[2].url, 'http://localhost').searchParams.get('asset_id'), 'asset-1')
  assert.equal(new URL(calls[3].url, 'http://localhost').searchParams.get('methodology_id'), 'method-1')
  assert.equal(calls[4].options.method, 'POST')
  assert.deepEqual(JSON.parse(calls[4].options.body), { action: 'extract', asset_id: 'asset-1' })
})

test('opens a real extraction session once DSH lists it', async () => {
  const { exported } = await loadClient()
  const opened = []
  const sessions = {
    list: {
      getSnapshot() { return { byId: { 'session-1': {} } } },
      subscribe() { throw new Error('session is already visible') },
    },
    open(id) { opened.push(id) },
  }
  await exported.openAnalysisSession(sessions, 'session-1')
  assert.deepEqual(opened, ['session-1'])
})

test('keeps polling during methodology finalization and stops at either terminal result', async () => {
  for (const terminal of ['completed', 'failed']) {
    let state = { assets: [], methodologies: { items: [], generation_job: { status: 'finalizing' } } }
    let responseState = state, stateIndex = 0, requests = 0
    const effects = [], timers = new Map()
    const react = { ...fakeReact(),
      useState(initial) { const index = stateIndex++; return [index === 0 ? state : initial, value => { if (index === 0) state = value }] },
      useEffect(effect) { effects.push(effect) },
    }
    const { exported } = await loadClient(react, {
      document: { body: { setAttribute() {}, getAttribute() {}, removeAttribute() {} } },
      setInterval(callback) { const id = Symbol('timer'); timers.set(id, callback); return id },
      clearInterval(id) { timers.delete(id) },
      async fetch() { requests++; return { ok: true, async json() { return { status: 'ok', ...responseState } } } },
    })
    const pages = []
    const ctx = { pangea: { registerPage(page) { pages.push(page) } }, effect(effect) { return effect() } }
    exported.apply(ctx)
    let cleanups = []
    function render(visible = true) {
      cleanups.forEach(cleanup => cleanup?.())
      stateIndex = 0; effects.length = 0
      const page = pages[0].component({ scope: { cwd: '/workspace' }, visible })
      page.type(page.props)
      cleanups = effects.map(effect => effect())
    }
    render()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(timers.size, 1, 'finalizing must keep the refresh timer')
    responseState = { ...state, methodologies: { items: [], generation_job: { status: terminal } } }
    const before = requests
    for (const tick of timers.values()) tick()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(requests, before + 1)
    assert.equal(state.methodologies.generation_job.status, terminal)
    render()
    assert.equal(timers.size, 0, `${terminal} must stop polling`)
    await new Promise(resolve => setImmediate(resolve))
    state = { ...state, methodologies: { items: [], generation_job: { status: 'finalizing' } } }
    render(false)
    assert.equal(timers.size, 0, 'hidden pages must not poll')
    cleanups.forEach(cleanup => cleanup?.())
  }
})
