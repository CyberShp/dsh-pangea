import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientPath = path.resolve(here, '..', 'lib', 'client.js')

async function loadClient() {
  const source = await readFile(clientPath, 'utf8')
  let exported
  const modules = new Map([['react', { name: 'react' }]])
  const requireModule = specifier => modules.get(specifier) ?? { name: specifier }
  const sandbox = { console, window: { __ModuleLoader__: { load(spec) { exported = spec.factory(requireModule) } } } }
  vm.runInNewContext(source, sandbox, { filename: clientPath })
  return { exported, source, sandbox, requireModule }
}

function fakeSidebar() {
  const tabs = new Map([
    ['editor', { id: 'editor', order: 10 }],
    ['git', { id: 'git', order: 20 }],
    ['subagent', { id: 'subagent', order: 30 }],
    ['terminal', { id: 'terminal', order: 40 }],
    ['browser', { id: 'browser', order: 50 }],
  ])
  const opened = []
  const closed = []
  const activated = []
  const updated = []
  const registryListeners = new Set()
  const stateListeners = new Set()
  let state = { splits: { tabs: [] }, bottomSplits: { tabs: [] } }
  let sessionId = 'session-1'
  const notifyState = () => { for (const listener of stateListeners) listener() }
  const activate = (tree, id) => Array.isArray(tree?.tabs) && tree.tabs.some(tab => tab.id === id)
    ? { ...tree, active: id }
    : tree
  return {
    tabs, opened, closed, activated, updated,
    setState(value) { state = value; notifyState() },
    setSession(value) { sessionId = value; notifyState() },
    getTab(id) { return tabs.get(id) },
    registerTab(tab) {
      if (tabs.has(tab.id)) throw new Error(`duplicate ${tab.id}`)
      tabs.set(tab.id, tab)
      for (const listener of registryListeners) listener()
      return () => { tabs.delete(tab.id); for (const listener of registryListeners) listener() }
    },
    openTab(seed, scope) { opened.push({ seed, scope }) },
    updateTab(id, patch) { updated.push({ id, patch }) },
    activateTab(id, scope) {
      activated.push({ id, scope })
      state = { ...state, splits: activate(state.splits, id), bottomSplits: activate(state.bottomSplits, id) }
      notifyState()
    },
    openFile(scope, filePath, title) { opened.push({ scope, filePath, title }) },
    closeTab(id, scope) {
      closed.push({ id, scope })
      const remove = tree => Array.isArray(tree?.tabs)
        ? { ...tree, tabs: tree.tabs.filter(tab => tab.id !== id) }
        : tree
      state = { ...state, splits: remove(state.splits), bottomSplits: remove(state.bottomSplits) }
    },
    getSnapshot() { return { sessionId, state } },
    subscribe(listener) { registryListeners.add(listener); return () => registryListeners.delete(listener) },
    subscribeState(listener) { stateListeners.add(listener); return () => stateListeners.delete(listener) },
  }
}

test('publishes ctx.pangea without registering a wrapper tab', async () => {
  const { exported, source } = await loadClient()
  assert.deepEqual(Array.from(exported.inject), ['betterSidebar', 'workspaces', 'sessions'])
  assert.doesNotMatch(source, /PangeaWorkbench/)
  const sidebar = fakeSidebar()
  let provided
  exported.apply({
    betterSidebar: sidebar,
    provide(name, service) { provided = { name, service } },
    effect(factory) { return factory() },
  })
  assert.equal(provided.name, 'pangea')
  assert.equal(sidebar.tabs.has('dsh-pangea:workbench'), false)
  assert.match(source, /'agent-runtime': \{ label: 'Agent Runtime'/)
})

test('bridges the DSH module loader for Better Sidebar lazy terminal chunks', async () => {
  const { exported, sandbox, requireModule } = await loadClient()
  const bridge = exported.installModuleSystemBridge(requireModule)
  assert.equal(await bridge.import('react'), requireModule('react'))
  assert.equal(sandbox.__DSH_MODULES__, bridge)
})

test('registers and opens the Desktop-owned PANGEA workspace on first launch', async () => {
  const { exported } = await loadClient()
  const calls = []
  const opened = []
  let ready = false
  const productSessions = []
  const result = await exported.bootstrapProductWorkspace({
    workspaces: {
      async create(input) {
        calls.push(['create', input])
        return { workspaceId: 'workspace-pangea', sessionIds: ['session-restored'] }
      },
      async connectWorkspace(workspaceId) {
        calls.push(['connect', workspaceId])
        return 'session-pangea'
      },
    },
    sessions: { open(sessionId) { opened.push(sessionId) } },
  }, {
    async productWorkspace() { return 'C:\\Users\\tester\\AppData\\Roaming\\pangea-desktop\\launch-root' },
    async productWorkspaceReady() { ready = true },
  }, undefined, sessionId => { productSessions.push(sessionId) })

  assert.equal(result, true)
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['create', { path: 'C:\\Users\\tester\\AppData\\Roaming\\pangea-desktop\\launch-root' }],
    ['connect', 'workspace-pangea'],
  ])
  assert.deepEqual(opened, ['session-pangea'])
  assert.deepEqual(productSessions, ['session-restored', 'session-pangea'])
  assert.equal(ready, true)
})

test('registers each feature page as one native sidebar tab', async () => {
  const { exported } = await loadClient()
  const sidebar = fakeSidebar()
  const service = exported.createPangeaService(sidebar)
  const component = () => null
  const disposeExecution = service.registerPage({ id: 'execution', title: '执行', order: 20, component })
  service.registerPage({ id: 'analysis', title: '分析', order: 10, component })
  service.registerPage({ id: 'assets', title: '资产', order: 30, component })
  assert.deepEqual(Array.from(service.getPages(), page => page.id), ['analysis', 'execution', 'assets'])
  assert.equal(sidebar.tabs.get('dsh-pangea:analysis').single, true)
  assert.equal(sidebar.tabs.get('dsh-pangea:execution').title, '执行')
  assert.throws(() => service.registerPage({ id: 'analysis', title: 'Again', component }), /already registered/)
  disposeExecution()
  assert.equal(sidebar.tabs.has('dsh-pangea:execution'), false)
})

test('omits unavailable pages from the product navigation', async () => {
  const { exported } = await loadClient()
  const scope = { sessionId: 'session-1', cwd: '/tmp/project' }
  assert.equal(exported.pageIsAvailable({ id: 'analysis', available: (_ctx, value) => Boolean(value?.cwd) }, scope), true)
  assert.equal(exported.pageIsAvailable({ id: 'execution', available: () => false }, scope), false)
  assert.equal(exported.pageIsAvailable({ id: 'assets' }, scope), true)
})

test('opens the product workbench once when a session becomes active', async () => {
  const { exported } = await loadClient()
  const sidebar = fakeSidebar()
  const service = exported.createPangeaService(sidebar)
  service.registerPage({ id: 'workbench', title: '工作台', order: 0, default: true, component: () => null })
  assert.equal(sidebar.opened.length, 1)
  assert.equal(sidebar.opened[0].seed.type, 'dsh-pangea:workbench')
  assert.equal(sidebar.opened[0].scope.sessionId, 'session-1')
  service.registerPage({ id: 'analysis', title: '分析', order: 10, component: () => null })
  assert.equal(sidebar.opened.length, 1)
})

test('shows PANGEA pages first, removes source control, and keeps terminal visible', async () => {
  const { exported } = await loadClient()
  const sidebar = fakeSidebar()
  const service = exported.createPangeaService(sidebar)
  const component = () => null
  service.registerPage({ id: 'analysis', title: '分析', order: 10, component })
  service.registerPage({ id: 'execution', title: '执行', order: 20, component })
  service.registerPage({ id: 'assets', title: '资产', order: 30, component })
  assert.equal(sidebar.tabs.get('git').hidden, true)
  assert.equal(sidebar.tabs.get('terminal').hidden, false)
  assert.equal(sidebar.tabs.get('terminal').order, 40)
  assert.equal(sidebar.tabs.get('terminal').available, undefined)
  assert.equal(sidebar.tabs.get('editor').order, 40)
  assert.equal(sidebar.tabs.get('subagent').order, 50)
  assert.equal(sidebar.tabs.get('browser').order, 60)
})

test('cleans Git, diff, and removed feature tabs while retaining the workbench', async () => {
  const { exported } = await loadClient()
  const sidebar = fakeSidebar()
  sidebar.setState({
    splits: { tabs: [
      { id: 'git', type: 'git' },
      { id: 'diff:1', type: 'diff' },
      { id: 'old-shell', type: 'dsh-pangea:workbench' },
      { id: 'removed', type: 'dsh-pangea:removed' },
    ] },
    bottomSplits: { tabs: [{ id: 'terminal:1', type: 'terminal' }] },
  })
  const service = exported.createPangeaService(sidebar)
  service.registerPage({ id: 'analysis', title: '分析', component: () => null })
  assert.deepEqual(sidebar.closed.map(item => item.id), ['git', 'diff:1', 'removed'])
})

test('forwards page and file opens through Better Sidebar', async () => {
  const { exported } = await loadClient()
  const sidebar = fakeSidebar()
  const service = exported.createPangeaService(sidebar)
  service.registerPage({ id: 'assets', title: '资产', component: () => null })
  const scope = { sessionId: 'session-1', cwd: '/tmp/project' }
  assert.equal(service.openPage(scope, 'assets'), true)
  assert.equal(service.openPage(scope, 'missing'), false)
  assert.equal(service.openFile(scope, '/tmp/report.md', 'Report'), true)
  assert.equal(sidebar.opened[0].seed.type, 'dsh-pangea:assets')
  assert.equal(sidebar.opened[0].scope, scope)
  assert.equal(sidebar.opened[1].filePath, '/tmp/report.md')
})

test('activates an existing PANGEA page instead of reopening it', async () => {
  const { exported } = await loadClient()
  const sidebar = fakeSidebar()
  const service = exported.createPangeaService(sidebar)
  service.registerPage({ id: 'assets', title: '资产', component: () => null })
  sidebar.setState({
    splits: { active: 'editor:1', tabs: [{ id: 'assets:1', type: 'dsh-pangea:assets' }, { id: 'editor:1', type: 'editor' }] },
    bottomSplits: { tabs: [] },
  })
  assert.equal(service.openPage({ sessionId: 'session-1' }, 'assets'), true)
  assert.deepEqual(sidebar.activated.map(item => item.id), ['assets:1'])
  assert.equal(sidebar.opened.length, 0)
})

test('restores the last PANGEA page only for registered Desktop product sessions', async () => {
  const { exported } = await loadClient()
  const sidebar = fakeSidebar()
  const service = exported.createPangeaService(sidebar)
  service.registerPage({ id: 'workbench', title: '工作台', default: true, component: () => null })
  service.registerPage({ id: 'analysis', title: '分析', component: () => null })
  sidebar.setState({
    splits: { active: 'analysis:1', tabs: [{ id: 'analysis:1', type: 'dsh-pangea:analysis' }, { id: 'editor:1', type: 'editor' }] },
    bottomSplits: { tabs: [] },
  })
  service.registerProductSession('session-1')
  sidebar.setState({
    splits: { active: 'editor:1', tabs: [{ id: 'analysis:1', type: 'dsh-pangea:analysis' }, { id: 'editor:1', type: 'editor' }] },
    bottomSplits: { tabs: [] },
  })
  assert.equal(sidebar.activated.at(-1).id, 'analysis:1')

  sidebar.setSession('ordinary-session')
  const activationCount = sidebar.activated.length
  sidebar.setState({
    splits: { active: 'editor:1', tabs: [{ id: 'analysis:1', type: 'dsh-pangea:analysis' }, { id: 'editor:1', type: 'editor' }] },
    bottomSplits: { tabs: [] },
  })
  assert.equal(sidebar.activated.length, activationCount)
})

test('shares a deduplicated asset selection with the analysis page', async () => {
  const { exported } = await loadClient()
  const sidebar = fakeSidebar()
  const service = exported.createPangeaService(sidebar)
  service.registerPage({ id: 'analysis', title: '分析', component: () => null })
  const changes = []
  const dispose = service.subscribeRunDraft(() => changes.push(service.getRunDraft()))
  const scope = { sessionId: 'session-1', cwd: '/tmp/project' }

  assert.equal(service.requestRunCreation(scope, { assetIds: ['asset-2', 'asset-1', 'asset-2', ''] }), true)
  assert.deepEqual(Array.from(service.getRunDraft().assetIds), ['asset-2', 'asset-1'])
  assert.equal(service.getRunDraft().requestId, 1)
  assert.equal(changes.length, 1)
  assert.equal(sidebar.opened[0].seed.type, 'dsh-pangea:analysis')

  dispose()
})

test('shares a selected Task between the workbench and analysis page', async () => {
  const { exported } = await loadClient()
  const service = exported.createPangeaService(fakeSidebar())
  const changes = []
  const dispose = service.subscribeTaskSelection(() => changes.push(service.getSelectedTaskId()))

  assert.equal(service.selectTask(' task-17 '), 'task-17')
  assert.equal(service.getSelectedTaskId(), 'task-17')
  assert.deepEqual(changes, ['task-17'])
  assert.equal(service.selectTask('task-17'), 'task-17')
  assert.deepEqual(changes, ['task-17'])

  dispose()
})
