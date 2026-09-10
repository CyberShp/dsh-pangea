import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const tick = () => new Promise(resolve => setImmediate(resolve))
const available = { asset_id: 'shared', title: '共享设计', asset_type: 'design', status: 'available', repository_ids: [], source_name: '设计.md', updated_at: '2026-09-08T00:00:00Z' }
const pending = { ...available, asset_id: 'pending', title: '待审缺陷', asset_type: 'historical_defect', status: 'awaiting_review' }
const catalog = { status: 'ok', assets: [available, pending], summary: { total: 2, available: 1, review: 1 },
  pagination: { page: 1, page_size: 20, total: 2, total_pages: 1 }, methodologies: { items: [{ methodology_id: 'method', title: '恢复检查', status: 'enabled' }] } }

async function mount() {
  const slots = [], calls = [], fail = new Set()
  let cursor = 0, exported, tree
  const react = {
    createElement(type, props, ...children) { return { type, props: props ?? {}, children } },
    Fragment: Symbol('Fragment'),
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = i === 0 ? catalog : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] },
    useEffect() {}, useCallback(fn) { return fn },
  }
  const sandbox = { URLSearchParams, AbortController, console, setTimeout, clearTimeout,
    fetch: async (url, options = {}) => {
      const payload = options.body ? JSON.parse(options.body) : null
      calls.push({ url, payload })
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

test('failed import and metadata save retain the editable form', async () => {
  const ui = await mount()
  await ui.click('导入资产')
  ui.change('资产文件路径', '/fixtures/new-design.md')
  ui.change('资产标题', '我的设计')
  await ui.click('预览导入')
  ui.fail.add('import')
  await ui.click('确认导入')
  assert.equal(ui.field('资产文件路径').props.value, '/fixtures/new-design.md')
  assert.equal(ui.field('资产标题').props.value, '我的设计')
  assert.ok(ui.text().includes('模拟保存失败'))
  assert.ok(ui.button('确认导入'))
  await ui.click('返回列表')
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
