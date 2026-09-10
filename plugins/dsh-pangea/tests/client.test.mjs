import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientPath = path.resolve(here, '..', 'lib', 'client.js')

async function loadClient(react = { name: 'react' }, extraSandbox = {}) {
  const source = await readFile(clientPath, 'utf8')
  let exported
  const modules = new Map([['react', react], ['react-dom', { createPortal: (child, host) => ({ child, host }) }]])
  const requireModule = specifier => modules.get(specifier) ?? { name: specifier }
  const { document, ...extras } = extraSandbox
  const sandbox = { console, ...extras, window: { ...extras.window, __ModuleLoader__: { load(spec) { exported = spec.factory(requireModule) } } } }
  vm.runInNewContext(source, sandbox, { filename: clientPath })
  if (document) sandbox.document = document
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
  assert.equal(sidebar.tabs.has('dsh-pangea:settings'), true)
  assert.match(source, /'agent-runtime': \{ label: 'Agent Runtime'/)
})

test('owns a visible product settings page with Desktop update controls', async () => {
  const { exported, source } = await loadClient()
  assert.match(source, /data-pangea-settings-page/)
  assert.match(source, /版本与升级/)
  assert.match(source, /导入升级包/)
  assert.match(source, /安装并重启/)
  assert.match(source, /bridge\.getUpdateStatus\(\)/)
  assert.match(source, /bridge\.importUpdatePackage\(\)/)
  assert.match(source, /bridge\.installUpdate\(\)/)
  assert.match(source, /onClick: \(\) => service\.openPage\(scope, 'settings'\)/)

  const sidebar = fakeSidebar()
  let service
  exported.apply({
    betterSidebar: sidebar,
    provide(_name, value) { service = value },
    effect(factory) { return factory() },
  })
  assert.equal(service.openPage({ sessionId: 'session-1' }, 'settings'), true)
  assert.equal(sidebar.opened.at(-1).seed.type, 'dsh-pangea:settings')
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

test('new analysis sessions restore their requested page on the first sidebar snapshot', async () => {
  const { exported } = await loadClient()
  const sidebar = fakeSidebar()
  const service = exported.createPangeaService(sidebar)
  service.registerPage({ id: 'home', title: '工作台', default: true, component: () => null })
  service.registerPage({ id: 'analysis', title: '分析', component: () => null })
  service.registerProductSession('new-analysis', 'analysis')
  sidebar.opened.length = 0
  sidebar.setSession('new-analysis')
  assert.equal(sidebar.opened.length, 1)
  assert.equal(sidebar.opened[0].seed.type, 'dsh-pangea:analysis')
  assert.equal(sidebar.opened[0].scope.sessionId, 'new-analysis')
})

test('opening a page in another session never activates a tab belonging to the current session', async () => {
  const { exported } = await loadClient()
  const sidebar = fakeSidebar()
  const service = exported.createPangeaService(sidebar)
  service.registerPage({ id: 'analysis', title: '分析', component: () => null })
  sidebar.setState({ splits: { active: 'analysis:old', tabs: [{ id: 'analysis:old', type: 'dsh-pangea:analysis' }] }, bottomSplits: { tabs: [] } })
  service.openPage({ sessionId: 'new-analysis' }, 'analysis')
  assert.equal(sidebar.activated.length, 0)
  assert.equal(sidebar.opened[0].scope.sessionId, 'new-analysis')
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

test('deep-links a report to the selected Run without a task index entry', async () => {
  const { exported } = await loadClient()
  const sidebar = fakeSidebar()
  const service = exported.createPangeaService(sidebar)
  service.registerPage({ id: 'analysis', title: '分析', component: () => null })
  const scope = { sessionId: 'session-1', cwd: '/tmp/project' }

  assert.equal(service.requestRunSelection(scope, 'analysis-260905-01'), true)
  const draft = service.getRunDraft()
  assert.equal(draft.revision, 1)
  assert.equal(draft.requestId, 1)
  assert.equal(draft.intent, 'select-run')
  assert.equal(draft.runId, 'analysis-260905-01')
  assert.deepEqual(Array.from(draft.assetIds), [])
  assert.equal(sidebar.opened[0].seed.type, 'dsh-pangea:analysis')
})

test('keeps the product page mounted while a file or browser utility is open', async () => {
  const { source } = await loadClient()
  assert.match(source, /data-pangea-product-content/)
  assert.match(source, /display: utility \? 'none' : undefined/)
})

test('routes ACP process output to the right assistant panel', async () => {
  const { exported, source } = await loadClient()
  assert.match(source, /data-pangea-assistant-process/)
  assert.match(source, /AssistantProcess/)
  assert.match(source, /process\.output\.slice\(-12000\)/)
  assert.match(source, /AssistantPortals/)
  assert.match(source, /data-pane="conversation"/)
  assert.match(source, /data-conversation-scroll/)
  assert.match(source, /ReactDOM\.createPortal/)
  assert.doesNotMatch(source, /\[data-pangea-assistant-process\][\s\S]*position: fixed/)
  assert.match(source, /activeConversationKind === 'analysis'/)
  assert.match(source, /context\?\.processMode === 'acp'/)
  assert.match(source, /data-pangea-assistant-narrow-toggle/)
  assert.match(source, /@media \(max-width: 1179px\)[\s\S]*data-pangea-task-assistant-open/s)
  assert.match(source, /data-pangea-task-assistant\]:not\(\[data-pangea-task-assistant-open\]\)[\s\S]*\[data-pane="conversation"\][\s\S]*display: none !important/s)
  assert.match(source, /data-pangea-task-assistant\]:not\(\[data-pangea-task-assistant-open\]\)[\s\S]*\[data-pane="details"\][\s\S]*display: block !important/s)
  assert.match(source, /@media \(max-width: 1179px\)[\s\S]*\[data-dsh-panel-host\] \.nArs4W_panel \{[\s\S]*visibility: visible !important;[\s\S]*transform: none !important;/s)
  assert.match(source, /data-pangea-task-assistant-open\] \[data-pangea-shell\] \{ background: transparent; pointer-events: none; \}/)
  assert.match(source, /data-pangea-task-assistant-open\] \[data-pangea-topbar\] \{ pointer-events: auto; \}/)
  assert.match(source, /data-pangea-task-assistant-open\] \[data-pangea-product-nav\],[\s\S]*data-pangea-task-assistant-open\] \[data-pangea-page\] \{ display: none !important; \}/s)
  assert.match(source, /\[data-conversation-scroll\]\[data-pangea-analysis-process="true"\] > \[data-slot="conversation\.session"\][\s\S]*display: none !important/s)
  assert.match(source, /\[data-conversation-scroll\]\[data-pangea-analysis-process="true"\] > \[data-pangea-assistant-portal="process"\][\s\S]*flex: 1 1 0/s)
  assert.match(source, /\[data-conversation-scroll\]\[data-pangea-analysis-process="true"\] > \[data-composer-seat\][\s\S]*position: sticky[\s\S]*bottom: 0/s)
  assert.match(source, /\[data-pangea-assistant-process\][\s\S]*height: 100%[\s\S]*max-height: none/s)
  assert.equal(exported.shouldShowAssistantProcess({ taskId: 'task-1', activeConversationKind: 'analysis' }), true)
  assert.equal(exported.shouldShowAssistantProcess({ taskId: 'task-1', ownerSessionId: 'owner-1', activeConversationSessionId: 'owner-1' }), true)
  assert.equal(exported.shouldShowAssistantProcess({ taskId: 'task-1', activeConversationKind: 'discussion' }), false)

  const card = {
    inert: false,
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value) },
    removeAttribute(name) { this.attributes.delete(name) },
  }
  const composer = {
    dataset: {},
    querySelectorAll(selector) { return selector === '[data-composer-card]' ? [card] : [] },
  }
  exported.setComposerReadonly(composer, true)
  assert.equal(composer.dataset.pangeaAnalysisReadonly, 'true')
  assert.equal(card.inert, true)
  assert.equal(card.attributes.get('aria-disabled'), 'true')
  exported.setComposerReadonly(composer, false)
  assert.equal('pangeaAnalysisReadonly' in composer.dataset, false)
  assert.equal(card.inert, false)
  assert.equal(card.attributes.has('aria-disabled'), false)
})

test('reserves the assistant body for analysis output while keeping the composer docked', async () => {
  const { exported } = await loadClient()
  const scroll = { dataset: {} }
  const card = {
    inert: false,
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value) },
    removeAttribute(name) { this.attributes.delete(name) },
  }
  const composer = {
    dataset: {},
    querySelectorAll(selector) { return selector === '[data-composer-card]' ? [card] : [] },
  }

  exported.setAnalysisProcessLayout(scroll, composer, true)
  assert.equal(scroll.dataset.pangeaAnalysisProcess, 'true')
  assert.equal(composer.dataset.pangeaAnalysisReadonly, 'true')
  assert.equal(card.inert, true)

  exported.setAnalysisProcessLayout(scroll, composer, false)
  assert.equal('pangeaAnalysisProcess' in scroll.dataset, false)
  assert.equal('pangeaAnalysisReadonly' in composer.dataset, false)
  assert.equal(card.inert, false)

  exported.setAnalysisProcessLayout(scroll, composer, false, true, true)
  assert.equal('pangeaAnalysisProcess' in scroll.dataset, false)
  assert.equal(composer.dataset.pangeaAnalysisReadonly, 'true')
  assert.equal(card.inert, true)
})

test('uses only the selected conversation and current attempt as the assistant session', async () => {
  const { exported } = await loadClient()
  const context = {
    taskId: 'task-06', attemptId: 'attempt-06', ownerSessionId: 'session-06',
    activeConversationId: 'analysis-06', activeConversationSessionId: 'session-06',
    conversations: [{ conversation_id: 'analysis-06', session_id: 'session-06', kind: 'analysis' }],
  }
  assert.equal(exported.assistantSessionId(context), 'session-06')
  assert.equal(exported.assistantSessionId({ ...context, activeConversationId: 'analysis-05' }), null)
  assert.equal(exported.assistantSessionId({ ...context, activeConversationSessionId: 'session-05' }), null)
  assert.equal(exported.assistantSessionId({ ...context, ownerSessionId: null }), null)
  assert.equal(exported.assistantSessionId({ ...context, ownerSessionId: 'session-retry' }), null)
  assert.equal(exported.assistantSessionId({ ...context, ownerSessionId: null, conversations: [
    { conversation_id: 'analysis-06', session_id: 'session-06', kind: 'assistant' },
  ] }), 'session-06')
  assert.equal(exported.shouldShowAssistantProcess({ taskId: 'failed-before-session', process: { error: 'snapshot denied' } }), true)
})

test('task assistant fences old todos until the selected task session is available', async () => {
  const oldTodos = [{ id: 'old-todo', content: 'Run 05 analysis', status: 'in_progress' }]
  const oldSession = { id: 'session-05', projectionValues: { todos: oldTodos } }
  const newSession = { id: 'session-06', projectionValues: { todos: [{ id: 'new-todo', content: 'Run 06 analysis' }] } }
  const discussionSession = { id: 'session-06-discussion', projectionValues: { todos: [] } }
  const context = {
    taskId: 'task-06', runId: 'run-06', workspaceKey: '/workspace', attemptId: 'attempt-06',
    activeConversationId: null, activeConversationSessionId: null, ownerSessionId: null, conversations: [],
    process: { status: 'failed', error: 'snapshot denied' },
  }
  for (const scenario of ['unbound', 'switching', 'analysis-ready', 'discussion-ready', 'discussion-remount', 'old-task-cache', 'other-workspace-cache']) {
    let currentSessionId = scenario === 'discussion-remount' ? discussionSession.id
      : ['analysis-ready', 'discussion-ready'].includes(scenario) ? newSession.id : oldSession.id
    const bound = ['switching', 'analysis-ready', 'discussion-ready', 'discussion-remount'].includes(scenario)
    const cached = bound ? {
      ...context, ownerSessionId: newSession.id, activeConversationId: 'conversation-06',
      activeConversationSessionId: newSession.id,
      activeConversationKind: scenario === 'discussion-ready' ? 'assistant' : 'analysis',
      conversations: [
        { conversation_id: 'conversation-06', session_id: newSession.id, kind: scenario === 'discussion-ready' ? 'assistant' : 'analysis' },
        { conversation_id: 'discussion-06', session_id: discussionSession.id, kind: 'assistant' },
      ],
    } : { ...context,
      taskId: scenario === 'old-task-cache' ? 'task-05' : context.taskId,
      workspaceKey: scenario === 'other-workspace-cache' ? '/other-workspace' : context.workspaceKey,
    }
    const effects = []
    const layouts = []
    let stateIndex = 0
    let renderingShell = true
    const react = {
      Fragment: Symbol('Fragment'),
      createElement(type, props, ...children) { return { type, props: { ...props, children: children.length === 1 ? children[0] : children }, children } },
      cloneElement(node, props) { return { ...node, props: { ...node.props, ...props } } },
      useState(initial) { return [renderingShell && stateIndex++ === 1 ? cached : initial, () => {}] },
      useRef(initial) { return { current: initial } },
      useCallback(fn) { return fn }, useMemo(fn) { return fn() },
      useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
      useEffect(fn) { effects.push(fn) }, useLayoutEffect(fn) { layouts.push(fn) },
    }
    const card = { inert: false, setAttribute() {}, removeAttribute() {} }
    const composer = { dataset: {}, querySelectorAll: () => [card] }
    const scroll = { dataset: {}, querySelector: () => composer, insertBefore() {} }
    const pane = { querySelector: () => scroll, insertBefore() {} }
    const root = { querySelector: () => pane }
    const { exported, source } = await loadClient(react, {
      document: {
        body: { setAttribute() {}, getAttribute() {}, removeAttribute() {} },
        querySelector: () => root, createElement: () => ({ dataset: {}, remove() {}, isConnected: true }),
      },
      window: { addEventListener() {}, removeEventListener() {} },
      MutationObserver: class { observe() {} disconnect() {} },
    })
    const opened = []
    const sessions = {
      list: { subscribe() { return () => {} }, getSnapshot() { return { current: currentSessionId, byId: { [oldSession.id]: oldSession, [newSession.id]: newSession, [discussionSession.id]: discussionSession } } } },
      open(id) { opened.push(id); currentSessionId = id },
    }
    const sidebar = fakeSidebar()
    const service = exported.createPangeaService(sidebar, sessions)
    service.selectTask('task-06')
    service.registerPage({ id: 'analysis', title: '分析', component: () => null })
    const shell = sidebar.getTab('dsh-pangea:analysis').component({ scope: { cwd: '/workspace' }, visible: true })
    const rendered = shell.type(shell.props)
    const portal = rendered.children.find(node => node?.type?.name === 'AssistantPortals')
    if (scenario.endsWith('cache')) {
      assert.equal(portal.props.context, null, scenario)
      effects.forEach(effect => effect())
      assert.deepEqual(opened, [])
      continue
    }
    assert.equal(portal.props.context.taskId, 'task-06')
    // Render the real portal/layout against a composer holding the old todos.
    renderingShell = false
    layouts.length = 0
    portal.type(portal.props)
    const cleanup = layouts[0]()
    assert.equal(scroll.dataset.pangeaSessionMismatch, ['unbound', 'switching', 'discussion-remount'].includes(scenario) ? 'true' : undefined, scenario)
    assert.equal(card.inert, scenario !== 'discussion-ready', scenario)
    assert.match(source, /\[data-pangea-session-mismatch="true"\] > \[data-composer-seat\] \{\s*display: none !important/)
    // A shell can remount after the user's explicit discussion switch while
    // its workspace cache still points to analysis. It must not switch back.
    effects.forEach(effect => effect())
    assert.deepEqual(opened, [], scenario)
    if (scenario === 'discussion-remount') assert.equal(currentSessionId, discussionSession.id)
    assert.equal(oldSession.projectionValues.todos, oldTodos)
    cleanup()
    assert.equal(scroll.dataset.pangeaSessionMismatch, undefined)
    assert.equal(card.inert, false)
  }
})
