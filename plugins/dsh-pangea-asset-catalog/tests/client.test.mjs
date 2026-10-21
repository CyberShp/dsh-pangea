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
    useRef(initial) { return { current: initial } },
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
    '资产管理', '导入资产', '需求', '设计', '历史缺陷', '参考资料', '覆盖率',
    '待人工审核', '审核通过', '拒绝', '未提取到可用内容', '提取请求已处理',
    '上一页', '下一页', '示例用例', '资产状态',
    '用于新分析', '提取内容', '用户方法论', '生成方法论候选', '待启用',
    '内容更新后状态会自动回到待启用', 'enable_methodology', 'disable_methodology',
    '资产管理导航', '返回列表', '导入并处理', '资产 AI 助手',
    '编辑资产信息', '下载失败记录', '恢复', '归档', '适用条件',
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

test('uses the approved asset prototype typography scale', async () => {
  const { source } = await loadClient()
  assert.match(source, /fontFamily: 'var\(--pangea-font, /)
  assert.match(source, /title: \{ fontSize: 26, fontWeight: 600/)
  assert.match(source, /button: \{[\s\S]*fontSize: 14/)
  assert.match(source, /meta: \{[\s\S]*fontSize: 14/)
  assert.match(source, /padding: '25px 31px 0'/)
  assert.match(source, /\.pangea-asset-header-subtitle\{color:#70767d!important;font-size:12px!important;line-height:1\.8!important;margin-top:9px!important\}/)
  assert.match(source, /\.pangea-asset-tabs button\[aria-current=page\][^{]*\{[^}]*color:#25292e/)
  assert.match(source, /fontSize: 14, cursor: 'pointer', minHeight: 43, padding: '10px 0 14px'/)
  assert.match(source, /fontWeight: 400, lineHeight: 'normal'/)
  assert.match(source, /pangea-asset-empty\.is-first-use \.pangea-asset-empty-title\{font-size:20px/)
  assert.match(source, /pangea-asset-empty-step\{[^}]*text-align:left/)
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

function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants)
  return node && typeof node === 'object' ? [node, ...(node.children ?? []).flatMap(descendants)] : []
}
function nodeText(node) {
  if (Array.isArray(node)) return node.map(nodeText).join('')
  return node && typeof node === 'object' ? nodeText(node.children ?? []) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''
}
function deferred() {
  let resolve
  return { promise: new Promise(done => { resolve = done }), resolve: value => resolve(value) }
}

async function assetHarness({ assets = [], onDetail, onJobs, onAction, features = { restore: true } } = {}) {
  const hooks = [], pendingEffects = [], timers = new Map(), requests = [], reads = []
  let cursor = 0, dirty = true, tree, cwd = '/workspace'
  const same = (a, b) => a?.length === b?.length && a.every((value, index) => Object.is(value, b[index]))
  const react = {
    ...fakeReact(),
    useState(initial) {
      const index = cursor++
      hooks[index] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [hooks[index].value, update => {
        const value = typeof update === 'function' ? update(hooks[index].value) : update
        if (!Object.is(value, hooks[index].value)) { hooks[index].value = value; dirty = true }
      }]
    },
    useRef(initial) { const index = cursor++; return hooks[index] ??= { current: initial } },
    useCallback(callback, deps) {
      const index = cursor++
      if (!same(hooks[index]?.deps, deps)) hooks[index] = { callback, deps }
      return hooks[index].callback
    },
    useEffect(effect, deps) {
      const index = cursor++
      if (same(hooks[index]?.deps, deps)) return
      const previous = hooks[index]
      hooks[index] = { deps }
      pendingEffects.push(() => { previous?.cleanup?.(); hooks[index].cleanup = effect() })
    },
  }
  const response = value => ({ ok: value.status === 'ok', status: value.status === 'ok' ? 200 : 400, json: async () => value })
  const state = () => ({ status: 'ok', assets: structuredClone(assets), summary: { total: assets.length },
    pagination: { page: 1, page_size: 20, total: assets.length, total_pages: 1 }, methodologies: { items: [] }, features, asset_types: ['design', 'requirement', 'historical_defect', 'coverage'] })
  const { exported } = await loadClient(react, {
    document: { body: { setAttribute() {}, getAttribute() {}, removeAttribute() {} } },
    FileReader: class {
      readAsDataURL(file) { reads.push(file.name); this.result = `data:application/octet-stream;base64,${Buffer.from(file.name).toString('base64')}`; queueMicrotask(() => this.onload()) }
    },
    setInterval(callback) { const id = Symbol('poll'); timers.set(id, callback); return id },
    clearInterval(id) { timers.delete(id) },
    async fetch(input, options = {}) {
      const url = new URL(input, 'https://fixture'), body = options.body ? JSON.parse(options.body) : undefined
      requests.push({ url, body })
      if (url.pathname.includes('acp-settings')) return response({ status: 'ok', providers: [] })
      if (url.searchParams.has('execution_options')) return response({ status: 'ok', models: [{ provider: 'fixture', model: 'fast', credential_configured: true }] })
      if (body) return response(await (onAction?.(body) ?? state()))
      if (url.searchParams.has('jobs_only')) return response({ status: 'ok', jobs: await (onJobs?.(url.searchParams.getAll('asset_id')) ?? Object.fromEntries(assets.map(asset => [asset.asset_id, structuredClone(asset.extraction_job)]))) })
      if (url.searchParams.has('asset_id')) {
        const id = url.searchParams.get('asset_id')
        return response(await (onDetail?.(id) ?? { status: 'ok', asset: structuredClone(assets.find(asset => asset.asset_id === id)), result: { items: [] } }))
      }
      return response(state())
    },
  })
  const pages = []
  const ctx = { pangea: { registerPage(page) { pages.push(page) } }, effect(effect) { return effect() } }
  exported.apply(ctx)
  function render() {
    dirty = false; cursor = 0
    const page = pages[0].component({ scope: { cwd }, visible: true })
    tree = page.type(page.props)
    pendingEffects.splice(0).forEach(effect => effect())
  }
  async function settle() {
    for (let index = 0; index < 25; index++) {
      if (dirty) render()
      await new Promise(resolve => setImmediate(resolve))
      if (!dirty) return
    }
    throw new Error('Asset page did not settle')
  }
  await settle()
  return {
    requests, reads, assets, state,
    get tree() { return tree },
    find(predicate) { return descendants(tree).find(predicate) },
    text() { return nodeText(tree) },
    click(label) {
      const button = descendants(tree).find(node => node.type === 'button' && (node.props['aria-label'] === label || nodeText(node) === label))
      assert.ok(button, `button exists: ${label}`)
      assert.ok(!button.props.disabled, `button enabled: ${label}`)
      button.props.onClick({ currentTarget: {} })
    },
    settle,
    tick() { for (const callback of [...timers.values()]) callback() },
    setCwd(value) { cwd = value; dirty = true },
    cleanup() { hooks.forEach(hook => hook.cleanup?.()) },
  }
}

const processingAsset = (id, type = 'design') => ({ asset_id: id, title: `资料 ${id}`, asset_type: type, status: 'extracting', revision: 1,
  source_name: `${id}.md`, source_path: `/fixture/${id}.md`, extraction_job: { status: 'running', started_at: new Date().toISOString(), phase_label: '正在读取材料', output: `仅属于${id}的记录` } })

test('late detail refresh cannot reopen an asset after returning to the library', async () => {
  const asset = processingAsset('A'), delayed = deferred()
  let hold = false
  const app = await assetHarness({ assets: [asset], onDetail: () => hold ? delayed.promise : { status: 'ok', asset, result: { items: [] } } })
  try {
    app.click('资料 A'); await app.settle()
    hold = true
    app.click('刷新状态'); await app.settle()
    app.click('返回资产库'); await app.settle()
    delayed.resolve({ status: 'ok', asset, result: { items: [] } }); await app.settle()
    assert.equal(app.find(node => node.props?.['aria-label'] === '资产详情'), undefined)
    assert.doesNotMatch(app.text(), /仅属于A的记录/)
  } finally { app.cleanup() }
})

test('parallel asset logs remain selected by asset id through late details and reordered polling', async () => {
  const a = processingAsset('A'), b = processingAsset('B'), delayed = deferred()
  let holdA = true
  const app = await assetHarness({ assets: [a, b], onDetail: id => id === 'A' && holdA ? delayed.promise : { status: 'ok', asset: id === 'A' ? a : b, result: { items: [] } },
    onJobs: () => ({ B: { ...b.extraction_job, output: '仅属于B的最新记录' }, A: { ...a.extraction_job, output: '仅属于A的最新记录' } }) })
  try {
    app.click('资料 A'); await app.settle()
    app.click('返回资产库'); await app.settle()
    app.click('资料 B'); await app.settle()
    holdA = false
    delayed.resolve({ status: 'ok', asset: a, result: { items: [] } }); await app.settle()
    const fullReads = app.requests.filter(call => !call.url.searchParams.has('jobs_only')).length
    app.tick(); await app.settle()
    assert.match(app.text(), /仅属于B的最新记录/)
    assert.doesNotMatch(app.text(), /仅属于A的/)
    assert.equal(app.requests.filter(call => !call.url.searchParams.has('jobs_only')).length, fullReads, 'running polling must not reread Python-backed list/detail')
    app.click('返回资产库'); await app.settle()
    app.tick(); await app.settle()
    assert.doesNotMatch(app.text(), /仅属于[AB]的/)
  } finally { app.cleanup() }
})

test('compact stop response preserves the asset list and exposes a recoverable delete operation', async () => {
  const asset = processingAsset('A'), actions = []
  const app = await assetHarness({ assets: [asset], onAction: body => {
    actions.push(body.action)
    if (body.action === 'stop') { asset.extraction_job = { ...asset.extraction_job, status: 'stopped', completed_at: new Date().toISOString() }; return { status: 'ok', job: asset.extraction_job } }
    asset.status = 'archived'
    return { status: 'ok', assets: [], pagination: { total: 0, page: 1, page_size: 20, total_pages: 1 } }
  } })
  try {
    app.click('停止提取 资料 A'); await app.settle()
    assert.ok(app.find(node => node.props?.['aria-label'] === '资料 A'))
    assert.match(app.text(), /已停止/)
    assert.equal(app.find(node => node.props?.['aria-label'] === '停止提取 资料 A'), undefined)
    app.click('删除资产 资料 A'); await app.settle()
    assert.deepEqual(actions, ['stop', 'archive'])
    assert.match(app.text(), /可在“已删除 \/ 已归档”中恢复/)
  } finally { app.cleanup() }
})

test('batch import reads and submits each file once, keeps per-file failures, and stays on the library', async () => {
  const first = deferred(), posted = []
  const app = await assetHarness({ onAction: async body => {
    posted.push(body)
    if (body.file_name === 'one.md') return first.promise
    if (body.file_name === 'bad.md') return { status: 'error', error: '文件内容无法解析' }
    return { status: 'ok', imported_asset_id: 'asset-three' }
  } })
  try {
    app.click('导入第一个资产'); await app.settle()
    const input = app.find(node => node.props?.['aria-label'] === '选择资产文件')
    assert.equal(input.props.multiple, true)
    input.props.onChange({ target: { files: ['one.md', 'bad.md', 'three.md'].map(name => ({ name, size: 100 })) } }); await app.settle()
    app.click('导入并处理 3 个文件'); await app.settle()
    assert.deepEqual(app.reads, ['one.md'], 'later files must not be base64 encoded while the first upload is pending')
    assert.equal(posted.length, 1)
    first.resolve({ status: 'ok', imported_asset_id: 'asset-one' }); await app.settle()
    assert.deepEqual(posted.map(body => body.file_name), ['one.md', 'bad.md', 'three.md'])
    assert.ok(posted.every(body => body.batch === true && body.title === ''))
    assert.match(app.text(), /已提交 2 \/ 3 个文件/)
    assert.match(app.text(), /bad.md · 导入失败：文件内容无法解析/)
    assert.equal(app.find(node => node.props?.['aria-label'] === '资产详情'), undefined)
    assert.equal(app.requests.filter(call => call.url.searchParams.has('asset_id')).length, 0, 'batch import must not open each imported asset')
  } finally { app.cleanup() }
})

test('a delayed running poll cannot revive a stopped job and stop failures can be retried', async () => {
  const asset = processingAsset('A'), delayed = deferred()
  asset.extraction_job = { ...asset.extraction_job, status: 'stopping', error: '停止确认失败，请重试' }
  const app = await assetHarness({ assets: [asset], onJobs: () => delayed.promise, onAction: () => {
    asset.extraction_job = { ...asset.extraction_job, status: 'stopped', error: undefined }
    return { status: 'ok', stopped: true, job: asset.extraction_job }
  } })
  try {
    app.tick(); await app.settle()
    app.click('重试停止'); await app.settle()
    delayed.resolve({ A: { status: 'running', output: '过期运行记录', started_at: new Date().toISOString() } }); await app.settle()
    assert.match(app.text(), /已停止/)
    assert.equal(app.find(node => node.props?.['aria-label'] === '停止提取 资料 A'), undefined)
    assert.doesNotMatch(app.text(), /过期运行记录/)
  } finally { app.cleanup() }
})

test('a stop request that races completion reports completion instead of interruption', async () => {
  const asset = processingAsset('A')
  const app = await assetHarness({ assets: [asset], onAction: () => {
    asset.status = 'available'; asset.extraction_job = { ...asset.extraction_job, status: 'completed' }
    return { status: 'ok', stopped: false, completed: true, job: asset.extraction_job }
  } })
  try {
    app.click('停止提取 资料 A'); await app.settle()
    assert.match(app.text(), /提取已完成，结果已保存/)
    assert.doesNotMatch(app.text(), /提取已停止，原始材料/)
  } finally { app.cleanup() }
})

test('archive actions do not promise recovery when the runtime does not support restore', async () => {
  const app = await assetHarness({ assets: [processingAsset('A')], features: { restore: false } })
  try {
    const listAction = app.find(node => node.props?.['aria-label'] === '归档资产 资料 A')
    assert.equal(nodeText(listAction), '归档')
    assert.doesNotMatch(listAction.props.title, /可恢复/)
    app.click('资料 A'); await app.settle()
    const detailAction = app.find(node => node.type === 'button' && nodeText(node) === '归档')
    assert.ok(detailAction)
    assert.doesNotMatch(detailAction.props.title, /可恢复/)
    assert.equal(app.find(node => node.type === 'button' && nodeText(node) === '删除（可恢复）'), undefined)
  } finally { app.cleanup() }
})

test('switching workspace stops submitting remaining batch files and ignores the old receipt', async () => {
  const first = deferred(), posted = []
  const app = await assetHarness({ onAction: body => { posted.push(body.file_name); return first.promise } })
  try {
    app.click('导入第一个资产'); await app.settle()
    app.find(node => node.props?.['aria-label'] === '选择资产文件').props.onChange({ target: { files: ['old-one.md', 'old-two.md'].map(name => ({ name, size: 100 })) } }); await app.settle()
    app.click('导入并处理 2 个文件'); await app.settle()
    app.setCwd('/different-workspace'); await app.settle()
    first.resolve({ status: 'ok', imported_asset_id: 'old-one' }); await app.settle()
    assert.deepEqual(posted, ['old-one.md'])
    assert.equal(app.find(node => node.props?.['aria-label'] === '批量导入进度'), undefined)
    assert.equal(app.find(node => node.props?.['aria-label'] === '导入新资产'), undefined)
    assert.doesNotMatch(app.text(), /old-one|old-two|已提交 1/)
  } finally { app.cleanup() }
})
