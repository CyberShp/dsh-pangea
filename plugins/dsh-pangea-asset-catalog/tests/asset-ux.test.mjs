import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const tick = () => new Promise(resolve => setImmediate(resolve))
const available = { asset_id: 'shared', title: '共享设计', asset_type: 'design', status: 'available', repository_ids: [], source_name: '设计.md', updated_at: '2026-09-08T00:00:00Z' }
const pending = { ...available, asset_id: 'pending', title: '待审缺陷', asset_type: 'historical_defect', status: 'awaiting_review' }
const catalog = { status: 'ok', assets: [available, pending], summary: { total: 2, available: 1, review: 1 },
  pagination: { page: 1, page_size: 20, total: 2, total_pages: 1 }, methodologies: { items: [{ methodology_id: 'method', title: '恢复检查', status: 'enabled' }] } }

async function mount(initialCatalog = catalog, { FileReader, fetcher } = {}) {
  const slots = [], calls = [], fail = new Set()
  let cursor = 0, exported, tree
  const react = {
    createElement(type, props, ...children) { return { type, props: props ?? {}, children } },
    Fragment: Symbol('Fragment'),
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = i === 0 ? initialCatalog : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i] },
    useEffect() {}, useCallback(fn) { return fn },
  }
  const sandbox = { URLSearchParams, AbortController, console, setTimeout, clearTimeout, FileReader,
    fetch: async (url, options = {}) => {
      const payload = options.body ? JSON.parse(options.body) : null
      calls.push({ url, payload })
      if (fetcher) return fetcher(url, options)
      const error = payload && fail.has(payload.action)
      const id = new URL(url, 'http://localhost').searchParams.get('asset_id')
      const value = payload?.action === 'preview_import' ? { status: 'ok', preview: { source_name: '新设计.md', source_sha256: 'fixture', source_size: 10, conflicts: [] } }
        : id ? { status: 'ok', asset: id === 'pending' ? pending : available, result: { items: [{ item_id: 'I-1', title: '缺陷' }] },
          review: { result_sha256: 'fixture', items: [{ item_id: 'I-1', decision: 'accepted', note: '原备注' }] } }
          : catalog
      return { ok: !error, async json() { return error ? { status: 'error', error: '模拟保存失败' } : value } }
    } }
  sandbox.window = { __ModuleLoader__: { load(spec) { exported = spec.factory(() => react) } } }
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), sandbox)
  const pages = [], drafts = []
  const ctx = { pangea: { registerPage(value) { pages.push(value) }, requestRunCreation(_scope, draft) { drafts.push(draft) } }, effect(fn) { return fn() } }
  exported.apply(ctx)
  const panel = pages[0].component({ scope: { cwd: '/workspace' }, visible: true })
  function render() { cursor = 0; tree = panel.type(panel.props) }
  function nodes() {
    const result = []
    function visit(value) { if (Array.isArray(value)) value.forEach(visit); else if (value?.children) { result.push(value); value.children.forEach(visit) } }
    visit(tree); return result
  }
  const text = node => (node?.children ?? []).flat(Infinity).map(value => typeof value === 'string' ? value : text(value)).join('')
  function button(label) { const value = nodes().find(node => node.type === 'button' && text(node) === label); assert.ok(value, `missing button ${label}`); return value }
  function field(label) { const value = nodes().find(node => node.props['aria-label'] === label); assert.ok(value, `missing field ${label}`); return value }
  async function click(label) { button(label).props.onClick(); await tick(); render() }
  function change(label, value) { field(label).props.onChange({ target: { value } }); render() }
  render()
  return { render, nodes, text: () => text(tree), click, change, field, button, calls, fail, drafts }
}

test('asset navigation separates catalog, methodology, import and one asset detail', async () => {
  const ui = await mount()
  assert.ok(ui.text().includes('共享设计'))
  assert.ok(!ui.text().includes('恢复检查'))
  assert.ok(!ui.text().includes('重新规范化'))
  await ui.click('方法论')
  assert.ok(ui.text().includes('恢复检查'))
  assert.ok(!ui.text().includes('共享设计'))
  await ui.click('资产库')
  await ui.click('查看详情')
  assert.ok(ui.text().includes('共享设计'))
  assert.ok(!ui.text().includes('待审缺陷'))
  assert.ok(ui.text().includes('2026/9/8 08:00'))
  await ui.click('返回列表')
  await ui.click('导入资产')
  assert.ok(!ui.text().includes('共享设计'))
  assert.ok(!ui.text().includes('恢复检查'))
  assert.ok(ui.field('选择资产文件'))
})

test('asset extraction requires a selected internal model and forwards its route', async () => {
  const ui = await mount()
  await ui.click('查看详情')
  await ui.click('重新处理')
  assert.ok(ui.text().includes('选择模型'))
  assert.ok(!ui.calls.some(call => call.payload?.action === 'extract'))
  ui.change('资产解析模型', JSON.stringify({ provider: 'configured', model: 'my-model' }))
  await ui.click('重新处理')
  const sent = ui.calls.find(call => call.payload?.action === 'extract').payload
  assert.deepEqual(sent.model_route, { provider: 'configured', model: 'my-model' })
})

test('asset extraction forwards the selected external executor and model', async () => {
  const ui = await mount()
  await ui.click('查看详情')
  ui.change('资产解析执行器', 'pangea-codeagent')
  ui.change('资产解析模型', 'native/model')
  await ui.click('重新处理')
  const sent = ui.calls.find(call => call.payload?.action === 'extract').payload
  assert.equal(sent.provider_id, 'pangea-codeagent')
  assert.equal(sent.agent_model, 'native/model')
  assert.equal(sent.model_route, undefined)
})

test('failed import and metadata save retain the editable form', async () => {
  const ui = await mount()
  await ui.click('导入资产')
  ui.change('资产文件路径', '/fixtures/new-design.md')
  ui.change('资产标题', '我的设计')
  ui.change('资产解析模型', JSON.stringify({ provider: 'configured', model: 'my-model' }))
  ui.fail.add('import')
  await ui.click('导入并处理')
  assert.equal(ui.field('资产文件路径').props.value, '/fixtures/new-design.md')
  assert.equal(ui.field('资产标题').props.value, '我的设计')
  assert.ok(ui.text().includes('模拟保存失败'))
  assert.ok(ui.button('导入并处理'))
  await ui.click('返回列表')
  assert.ok(!ui.text().includes('模拟保存失败'), 'import errors must not remain on the asset list')
  await ui.click('查看详情')
  await ui.click('编辑信息')
  ui.change('编辑资产标题', '已编辑标题')
  ui.fail.add('update_metadata')
  await ui.click('保存')
  assert.equal(ui.field('编辑资产标题').props.value, '已编辑标题')
})

test('review note edits preserve the saved decision and a failed save keeps the draft', async () => {
  const ui = await mount()
  await ui.click('查看并审核')
  ui.change('审核备注 I-1', '补充证据')
  assert.equal(ui.field('审核状态 I-1').props.value, 'accepted')
  ui.fail.add('review_items')
  await ui.click('保存逐条审核')
  assert.equal(ui.field('审核备注 I-1').props.value, '补充证据')
  const sent = ui.calls.find(call => call.payload?.action === 'review_items').payload
  assert.deepEqual(sent.decisions, [{ item_id: 'I-1', decision: 'accepted', note: '补充证据' }])
})


test('asset detail exposes recoverable deletion and persists category edits', async () => {
  const ui = await mount()
  await ui.click('查看详情')
  assert.ok(ui.button('删除（可恢复）'))
  await ui.click('编辑信息')
  ui.change('编辑资产分类', 'historical_defect')
  await ui.click('保存')
  assert.equal(ui.calls.find(call => call.payload?.action === 'update_metadata').payload.asset_type, 'historical_defect')
  await ui.click('删除（可恢复）')
  assert.ok(ui.calls.some(call => call.payload?.action === 'archive'))
  assert.ok(!ui.text().includes('返回列表'))
})

test('approved historical defect starts semantic generation directly from its detail', async () => {
  const prior = pending.status
  pending.status = 'available'
  try {
    const ui = await mount()
    // Open the historical defect's own detail, without selecting checkboxes.
    const buttons = ui.nodes().filter(node => node.type === 'button' && node.children.includes('查看详情'))
    buttons[1].props.onClick()
    await tick(); ui.render()
    await ui.click('开启语义生成会话')
    assert.deepEqual(ui.calls.find(call => call.payload?.action === 'generate_methodology').payload.asset_ids, ['pending'])
  } finally { pending.status = prior }
})

test('search shows the submitted query and clearing filters preserves the current section', async () => {
  const ui = await mount()
  ui.change('筛选资产类型', 'design')
  ui.change('资产状态', 'extracting')
  ui.change('搜索资产', '  重试设计  ')
  ui.field('资产关键词搜索').props.onSubmit({ preventDefault() {} })
  ui.render()
  assert.ok(ui.text().includes('搜索“重试设计”'))
  await ui.click('刷新')
  let params = new URL(ui.calls.at(-1).url, 'http://localhost').searchParams
  assert.equal(params.get('q'), '重试设计')
  assert.equal(params.get('status'), 'extracting')
  await ui.click('清除筛选')
  assert.equal(ui.field('筛选资产类型').props.value, '')
  assert.equal(ui.field('资产状态').props.value, '')
  assert.equal(ui.field('搜索资产').props.value, '')
  assert.ok(!ui.text().includes('搜索“重试设计”'))
  for (const [section, status] of [['待审核', 'awaiting_review'], ['已删除 / 已归档', 'archived']]) {
    await ui.click(section)
    ui.change('筛选资产类型', 'design')
    ui.change('搜索资产', '草稿')
    await ui.click('清除筛选')
    await ui.click('刷新')
    params = new URL(ui.calls.at(-1).url, 'http://localhost').searchParams
    assert.equal(params.get('status'), status)
    assert.equal(params.get('type'), null)
    assert.equal(params.get('q'), null)
    assert.equal(params.get('page'), '1')
  }
})

test('empty catalog offers import while a filtered empty result offers reset', async () => {
  const ui = await mount({ ...catalog, assets: [], summary: {}, pagination: { page: 1, page_size: 20, total: 0, total_pages: 1 } })
  assert.ok(ui.text().includes('开始建立你的资产库'))
  assert.ok(!ui.nodes().some(node => node.props['aria-label'] === '资产分页'))
  ui.change('筛选资产类型', 'design')
  assert.ok(ui.text().includes('没有符合条件的资产'))
  await ui.click('查看全部结果')
  assert.equal(ui.field('筛选资产类型').props.value, '')
  await ui.click('导入第一个资产')
  assert.ok(ui.field('选择资产文件'))
})

test('initial loading does not claim the catalog is empty and pagination is labeled', async () => {
  const loading = await mount(null)
  assert.equal(loading.field('资产列表').props['aria-busy'], true)
  assert.ok(loading.text().includes('正在加载资产…'))
  assert.ok(!loading.text().includes('开始建立你的资产库'))
  const loaded = await mount()
  assert.equal(loaded.field('资产列表').props['aria-busy'], false)
  assert.equal(loaded.field('每页资产数量').props.value, 20)
  assert.equal(loaded.button('上一页').props.disabled, true)
  assert.equal(loaded.button('下一页').props.disabled, true)
})

test('file reading locks import and navigation before rerender and submits only once', async () => {
  const readers = []
  const ui = await mount(catalog, { FileReader: class {
    constructor() { readers.push(this) }
    readAsDataURL() {}
  } })
  await ui.click('导入资产')
  ui.change('资产类型', 'coverage')
  ui.field('选择资产文件').props.onChange({ target: { files: [{ name: 'coverage.json', size: 10 }] } })
  ui.render()
  const submit = ui.button('导入并处理').props.onClick
  submit(); submit(); ui.render()
  assert.equal(readers.length, 1, 'a synchronous second click must not start another read')
  assert.equal(ui.button('正在导入…').props.disabled, true)
  assert.equal(ui.button('返回列表').props.disabled, true)
  assert.equal(ui.calls.length, 0)
  readers[0].result = 'data:application/json;base64,e30='
  readers[0].onload()
  await tick(); ui.render()
  const requests = ui.calls.filter(call => call.payload?.action === 'import')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].payload.file_data, 'e30=')
  assert.equal(requests[0].payload.asset_type, 'coverage')
  assert.ok(!ui.nodes().some(node => node.props['aria-label'] === '选择资产文件'))
})

test('a FileReader error is visible and preserves the selected file and import draft', async () => {
  const ui = await mount(catalog, { FileReader: class {
    readAsDataURL() {
      this.error = new Error('读取所选文件失败')
      queueMicrotask(() => this.onerror())
    }
  } })
  await ui.click('导入资产')
  ui.change('资产标题', '待导入资料')
  ui.field('选择资产文件').props.onChange({ target: { files: [{ name: 'design.md', size: 12 }] } })
  ui.render()
  await ui.click('导入并处理')
  assert.ok(ui.text().includes('读取所选文件失败'))
  assert.ok(ui.text().includes('design.md'))
  assert.equal(ui.field('资产标题').props.value, '待导入资料')
  assert.equal(ui.button('导入并处理').props.disabled, false)
  assert.equal(ui.calls.length, 0)
})

test('empty and oversized uploads are rejected before reading or calling the API', async () => {
  for (const [size, message] of [[0, '所选文件为空'], [24 * 1024 * 1024 + 1, '超过 24 MiB 限制']]) {
    let reads = 0
    const ui = await mount(catalog, { FileReader: class { readAsDataURL() { reads++ } } })
    await ui.click('导入资产')
    ui.field('选择资产文件').props.onChange({ target: { files: [{ name: 'invalid.md', size }] } })
    ui.render()
    await ui.click('导入并处理')
    assert.ok(ui.text().includes(message))
    assert.equal(reads, 0)
    assert.equal(ui.calls.length, 0)
    assert.equal(ui.button('导入并处理').props.disabled, false)
  }
})

test('successful import opens its detail in the library and clears earlier section filters', async () => {
  const imported = { ...available, asset_id: 'fresh', title: '新覆盖率', asset_type: 'coverage' }
  for (const origin of ['方法论', '已删除 / 已归档']) {
    const ui = await mount(catalog, { async fetcher(url, options) {
      const body = options.body ? { ...catalog, assets: [imported], imported_asset_id: imported.asset_id }
        : new URL(url, 'http://localhost').searchParams.has('asset_id') ? { status: 'ok', asset: imported, result: { summary: '导入完成的详细内容', items: [] } }
          : catalog
      return { ok: true, async json() { return body } }
    } })
    await ui.click(origin)
    if (origin !== '方法论') {
      ui.change('筛选资产类型', 'design')
      ui.change('搜索资产', '原有筛选')
      ui.field('资产关键词搜索').props.onSubmit({ preventDefault() {} }); ui.render()
    }
    await ui.click('导入资产')
    ui.change('资产类型', 'coverage')
    ui.change('资产文件路径', '/fixtures/coverage.json')
    await ui.click('导入并处理')
    assert.equal(ui.button('资产库').props['aria-current'], 'page')
    assert.ok(ui.field('资产列表'))
    assert.ok(ui.text().includes('导入完成的详细内容'))
    assert.ok(!ui.text().includes('恢复检查'))
    await ui.click('返回列表')
    assert.equal(ui.field('筛选资产类型').props.value, '')
    assert.equal(ui.field('资产状态').props.value, '')
    assert.equal(ui.field('搜索资产').props.value, '')
  }
})

test('detail refresh clears stale errors, shows loading and deduplicates repeated clicks', async () => {
  let detailRequests = 0, finishRefresh
  const ui = await mount(catalog, { async fetcher(url) {
    if (!new URL(url, 'http://localhost').searchParams.has('asset_id')) return { ok: true, async json() { return catalog } }
    detailRequests++
    if (detailRequests === 1) return { ok: false, async json() { return { status: 'error', error: '详情读取失败' } } }
    return new Promise(resolve => { finishRefresh = () => resolve({ ok: true, async json() { return { status: 'ok', asset: available, result: { summary: '详情已恢复', items: [] } } } }) })
  } })
  await ui.click('查看详情')
  assert.ok(ui.text().includes('详情读取失败'))
  const refresh = ui.button('刷新').props.onClick
  refresh(); refresh(); ui.render()
  assert.equal(detailRequests, 2)
  assert.ok(!ui.text().includes('详情读取失败'))
  assert.equal(ui.button('刷新中…').props.disabled, true)
  finishRefresh()
  await tick(); ui.render()
  assert.ok(ui.text().includes('详情已恢复'))
  assert.ok(!ui.nodes().some(node => node.props.role === 'alert'))
  assert.equal(ui.button('刷新').props.disabled, false)
})

test('processing settings appear only for import or detail and coverage hides model controls', async () => {
  const ui = await mount()
  const hasLabel = label => ui.nodes().some(node => node.props['aria-label'] === label)
  assert.equal(hasLabel('资产 AI 助手'), false)
  await ui.click('方法论')
  assert.equal(hasLabel('资产 AI 助手'), false)
  await ui.click('导入资产')
  assert.equal(hasLabel('资产 AI 助手'), true)
  assert.ok(ui.text().includes('处理设置'))
  assert.equal(hasLabel('资产解析执行器'), true)
  assert.equal(hasLabel('资产解析模型'), true)
  ui.change('资产类型', 'coverage')
  assert.equal(hasLabel('资产解析执行器'), false)
  assert.equal(hasLabel('资产解析模型'), false)
  assert.ok(ui.text().includes('无需选择 Agent 或模型'))
  await ui.click('资产库')
  assert.equal(hasLabel('资产 AI 助手'), false)
  await ui.click('查看详情')
  assert.equal(hasLabel('资产 AI 助手'), true)
  assert.equal(hasLabel('资产解析执行器'), true)
  assert.equal(hasLabel('资产解析模型'), true)
  const settings = ui.nodes().find(node => node.type === 'details' && node.children.some(child => child?.type === 'summary' && child.children.includes('重新处理设置')))
  assert.ok(settings, 'detail keeps reprocessing settings under an expandable section')
  assert.ok(!settings.props.open, 'reprocessing settings start collapsed')
})

test('coverage detail presents source paths and zero execution counts in a readable table', async () => {
  const coverage = { ...available, asset_id: 'coverage', title: '覆盖率结果', asset_type: 'coverage' }
  const result = { records: [
    { coverage_type: 'function', path: '/repo/src/parser.py', line: 7, function: 'parse_input', count: 0 },
    { coverage_type: 'line', file_path: '/repo/src/parser.py', line: 8, count: 0 },
    { coverage_type: 'branch', path: '/repo/src/parser.py', line: 9, block: 0, branch: 0, true_count: 0, false_count: 0 },
  ] }
  const ui = await mount({ ...catalog, assets: [coverage] }, { async fetcher() {
    return { ok: true, async json() { return { status: 'ok', asset: coverage, result } } }
  } })
  await ui.click('查看详情')
  assert.equal(ui.field('覆盖率记录').type, 'table')
  assert.ok(ui.nodes().filter(node => node.type === 'th').every(node => node.props.scope === 'col'))
  const rows = ui.nodes().filter(node => node.type === 'tr').slice(1).map(row => row.children.flat(Infinity).map(cell => cell.children.join('')))
  assert.deepEqual(rows, [
    ['函数', '/repo/src/parser.py:7', 'parse_input', '0'],
    ['代码行', '/repo/src/parser.py:8', '—', '0'],
    ['分支', '/repo/src/parser.py:9', '块 0 · 分支 0', '真 0 / 假 0'],
  ])
  assert.ok(!ui.nodes().some(node => ['资产解析执行器', '资产解析模型'].includes(node.props['aria-label'])))
})

test('empty methodologies guide users to available historical defects in the library', async () => {
  const ui = await mount({ ...catalog, methodologies: { items: [] } })
  await ui.click('方法论')
  assert.ok(ui.button('选择历史缺陷'))
  await ui.click('选择历史缺陷')
  assert.equal(ui.button('资产库').props['aria-current'], 'page')
  assert.equal(ui.field('筛选资产类型').props.value, 'historical_defect')
  assert.equal(ui.field('资产状态').props.value, 'available')
  assert.equal(ui.field('搜索资产').props.value, '')
  assert.ok(ui.field('资产列表'))
  await ui.click('刷新')
  const params = new URL(ui.calls.at(-1).url, 'http://localhost').searchParams
  assert.equal(params.get('type'), 'historical_defect')
  assert.equal(params.get('status'), 'available')
  assert.equal(params.get('page'), '1')
})
