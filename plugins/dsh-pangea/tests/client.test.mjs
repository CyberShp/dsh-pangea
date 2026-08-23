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
    Component: class {},
    createElement(type, props, ...children) { return { type, props: props ?? {}, children } },
    useSyncExternalStore(subscribe, getSnapshot) { subscribe(() => {}); return getSnapshot() },
  }
}

async function loadClient() {
  const source = await readFile(clientPath, 'utf8')
  let exported
  const sandbox = { console, globalThis: {}, window: { __ModuleLoader__: { load(spec) { exported = spec.factory(name => {
    if (name === 'react') return fakeReact()
    throw new Error(`unexpected require: ${name}`)
  }) } } } }
  vm.runInNewContext(source, sandbox, { filename: clientPath })
  return { exported, source }
}

test('publishes one PANGEA workbench tab', async () => {
  const { exported, source } = await loadClient()
  assert.deepEqual(Array.from(exported.inject), ['betterSidebar'])
  assert.match(source, /尚未安装可用的 PANGEA 功能插件/)
  const tabs = []
  let provided
  exported.apply({
    betterSidebar: { registerTab(tab) { tabs.push(tab); return () => {} }, openTab() {}, openFile() {} },
    provide(name, service) { provided = { name, service } },
    effect(factory) { return factory() },
  })
  assert.equal(provided.name, 'pangea')
  assert.equal(tabs.length, 1)
  assert.equal(tabs[0].id, 'dsh-pangea:workbench')
  assert.equal(tabs[0].single, true)
  assert.equal(tabs[0].component({ ctx: {} }).props.pangea, provided.service)
})

test('registers pages in stable order and disposes them', async () => {
  const { exported } = await loadClient()
  const service = exported.createPangeaService({ openTab() {}, openFile() {} }, undefined)
  const component = () => null
  const disposeB = service.registerPage({ id: 'b', title: 'B', order: 20, component })
  service.registerPage({ id: 'a', title: 'A', order: 10, component })
  service.registerPage({ id: 'c', title: 'C', order: 20, component })
  assert.deepEqual(Array.from(service.getPages(), page => page.id), ['a', 'b', 'c'])
  assert.throws(() => service.registerPage({ id: 'a', title: 'Again', component }), /already registered/)
  disposeB()
  disposeB()
  assert.deepEqual(Array.from(service.getPages(), page => page.id), ['a', 'c'])
})

test('keeps active page per session and forwards page and file opens', async () => {
  const { exported } = await loadClient()
  const calls = []
  const storage = new Map()
  const service = exported.createPangeaService({
    openTab(seed, scope) { calls.push(['tab', seed, scope]) },
    openFile(scope, filePath, title) { calls.push(['file', scope, filePath, title]) },
  }, { getItem(key) { return storage.get(key) }, setItem(key, value) { storage.set(key, value) } })
  const component = () => null
  service.registerPage({ id: 'analysis', title: '分析', order: 10, component })
  service.registerPage({ id: 'assets', title: '资产', order: 30, component })
  const scope = { sessionId: 'session-1', cwd: '/tmp/project' }
  assert.equal(service.openPage(scope, 'assets'), true)
  assert.equal(service.getActivePage({}, scope).id, 'assets')
  assert.equal(service.openPage(scope, 'missing'), false)
  assert.equal(service.openFile(scope, '/tmp/report.md', 'Report'), true)
  assert.equal(calls[0][0], 'tab')
  assert.equal(calls[0][1].type, 'dsh-pangea:workbench')
  assert.equal(calls[0][2], scope)
  assert.deepEqual(calls[1], ['file', scope, '/tmp/report.md', 'Report'])
})
