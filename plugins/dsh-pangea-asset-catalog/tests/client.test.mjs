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

async function loadClient() {
  const source = await readFile(clientPath, 'utf8')
  let exported
  const sandbox = {
    URLSearchParams, AbortController, console, setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: async () => { throw new Error('default fetch must not run') },
  }
  sandbox.window = { __ModuleLoader__: { load(spec) { exported = spec.factory(() => fakeReact()) } } }
  vm.runInNewContext(source, sandbox, { filename: clientPath })
  return { source, exported }
}

test('registers a PANGEA-owned asset management page', async () => {
  const { source, exported } = await loadClient()
  for (const text of [
    '资产管理', '导入资产', '需求', '设计', '历史缺陷', '参考资料', 'Coverage',
    '待人工审核', '审核通过', '拒绝', '已分析，无结构化条目', '打开提取会话',
    '上一页', '下一页', '已有用例只在创建 Run 时作为示例提供', '资产状态',
    '用于新分析', '结构化条目', '用户方法论', '生成方法论候选', '待启用',
    '内容更新后状态会自动回到待启用', 'enable_methodology', 'disable_methodology',
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
  assert.equal(pages[0].title(), '测试资产')
})

test('client uses server pagination status and type filters detail loading and explicit actions', async () => {
  const { exported } = await loadClient()
  const calls = []
  const fetcher = async (url, options = {}) => {
    calls.push({ url, options })
    return { ok: true, status: 200, async json() { return { status: 'ok', assets: [], pagination: {} } } }
  }
  await exported.requestState({ cwd: '/tmp/workspace', page: 2, pageSize: 50, type: 'design', status: 'available', query: 'tcp', fetcher })
  await exported.requestAssetDetail({ cwd: '/tmp/workspace', assetId: 'asset-1', fetcher })
  await exported.requestMethodologyDetail({ cwd: '/tmp/workspace', methodologyId: 'method-1', fetcher })
  await exported.requestAction({ cwd: '/tmp/workspace', action: 'extract', payload: { asset_id: 'asset-1' }, fetcher })
  const listUrl = new URL(calls[0].url, 'http://localhost')
  assert.equal(listUrl.searchParams.get('page'), '2')
  assert.equal(listUrl.searchParams.get('page_size'), '50')
  assert.equal(listUrl.searchParams.get('type'), 'design')
  assert.equal(listUrl.searchParams.get('status'), 'available')
  assert.equal(listUrl.searchParams.get('q'), 'tcp')
  assert.equal(new URL(calls[1].url, 'http://localhost').searchParams.get('asset_id'), 'asset-1')
  assert.equal(new URL(calls[2].url, 'http://localhost').searchParams.get('methodology_id'), 'method-1')
  assert.equal(calls[3].options.method, 'POST')
  assert.deepEqual(JSON.parse(calls[3].options.body), { action: 'extract', asset_id: 'asset-1' })
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
