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

async function assistantHeaderHarness(context) {
  const hooks = []
  let cursor = 0
  const react = {
    createElement(type, props, ...children) { return { type, props: props ?? {}, children: children.flat(Infinity).filter(value => value !== null) } },
    useState(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = initial
      return [hooks[index], value => { hooks[index] = value }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = { current: initial }
      return hooks[index]
    },
  }
  const { exported } = await loadClient(react)
  const walk = node => typeof node === 'object' && node !== null ? [node, ...node.children.flatMap(walk)] : []
  const text = node => typeof node === 'object' && node !== null ? node.children.map(text).join('') : String(node ?? '')
  return {
    render(next = context) {
      context = next
      cursor = 0
      const tree = exported.AssistantHeader({ context })
      const nodes = walk(tree)
      return {
        tree, text: text(tree),
        select: nodes.find(node => node.type === 'select'),
        create: nodes.find(node => node.type === 'button'),
        feedback: nodes.find(node => 'data-pangea-assistant-feedback' in node.props),
        options: nodes.filter(node => node.type === 'option').map(text),
      }
    },
  }
}

test('assistant identifies the task and conversation purpose with distinct diagram names', async () => {
  const context = {
    taskId: 'cpu', taskTitle: 'CPU 使用率统计', title: '架构视图 · cpuload', phase: '图表可查看', percent: 100,
    activeConversationId: 'functions', activeConversationKind: 'architecture',
    conversations: [
      { conversation_id: 'analysis', kind: 'analysis', display_title: '主分析过程', title: '旧名称' },
      { conversation_id: 'module', kind: 'architecture', display_title: '模块架构图 · v1', title: '相同旧名称' },
      { conversation_id: 'functions', kind: 'architecture', display_title: '函数与变量图 · v1', title: '相同旧名称' },
      { conversation_id: 'discussion', kind: 'assistant', kind_label: '讨论', display_title: '讨论 1' },
    ],
  }
  const harness = await assistantHeaderHarness(context)
  const view = harness.render()
  assert.match(view.text, /当前任务CPU 使用率统计/)
  assert.match(view.text, /当前会话/)
  assert.equal(view.select.props.value, 'functions')
  assert.deepEqual(view.options, ['分析记录 · 主分析过程', '图表 · 模块架构图 · v1', '图表 · 函数与变量图 · v1', '讨论 · 讨论 1'])
  assert.doesNotMatch(view.text, /100%|相同旧名称/)
  assert.match(view.text, /新建讨论/)
  const discussion = harness.render({ ...context, activeConversationId: 'discussion', activeConversationKind: 'assistant' })
  assert.doesNotMatch(discussion.text, /图表可查看|100%/)
  assert.match(discussion.text, /讨论会话，可以继续提问/)
})

test('assistant prevents duplicate creation and shows an inline error before retry', async () => {
  let reject, resolve, calls = 0
  const context = {
    taskId: 'cpu', activeConversationId: 'analysis', activeConversationKind: 'analysis',
    conversations: [{ conversation_id: 'analysis', kind: 'analysis', title: '主分析过程' }],
    onCreateConversation() { calls++; return new Promise((accept, fail) => { resolve = accept; reject = fail }) },
  }
  const harness = await assistantHeaderHarness(context)
  const initial = harness.render()
  const request = initial.create.props.onClick()
  await initial.create.props.onClick()
  let view = harness.render()
  assert.equal(calls, 1)
  assert.equal(view.create.props.disabled, true)
  assert.equal(view.select.props.disabled, true)
  assert.match(view.text, /正在创建讨论会话/)
  reject(new Error('网络连接失败'))
  await request
  view = harness.render()
  assert.equal(view.create.props.disabled, false)
  assert.equal(view.feedback.props.role, 'alert')
  assert.match(view.text, /新建讨论失败：网络连接失败/)
  const retry = view.create.props.onClick()
  assert.equal(calls, 2)
  assert.doesNotMatch(harness.render().text, /网络连接失败/)
  resolve()
  await retry
  assert.equal(harness.render().create.props.disabled, false)
})

test('assistant keeps selection authoritative while switching and scopes feedback to its task', async () => {
  let reject, calls = 0
  const context = {
    taskId: 'cpu', activeConversationId: 'analysis', activeConversationKind: 'analysis',
    conversations: [{ conversation_id: 'analysis', kind: 'analysis', title: '主分析过程' }, { conversation_id: 'discussion', kind: 'assistant', title: '讨论 1' }],
    onSelectConversation(id) { calls++; assert.equal(id, 'discussion'); return new Promise((_resolve, fail) => { reject = fail }) },
  }
  const harness = await assistantHeaderHarness(context)
  const initial = harness.render()
  await initial.select.props.onChange({ target: { value: 'analysis' } })
  assert.equal(calls, 0)
  const request = initial.select.props.onChange({ target: { value: 'discussion' } })
  await initial.select.props.onChange({ target: { value: 'discussion' } })
  let view = harness.render()
  assert.equal(calls, 1)
  assert.equal(view.select.props.value, 'analysis')
  assert.equal(view.create.props.disabled, true)
  assert.match(view.text, /正在切换会话/)
  reject(new Error('会话不存在'))
  await request
  view = harness.render()
  assert.equal(view.select.props.value, 'analysis')
  assert.match(view.text, /切换会话失败：会话不存在/)
  const otherTask = harness.render({ ...context, taskId: 'memory' })
  assert.doesNotMatch(otherTask.text, /会话不存在/)
  assert.equal(otherTask.select.props.disabled, false)
})

test('assistant reflects conversation operations started from the diagram panel', async () => {
  let calls = 0
  const context = {
    taskId: 'cpu', activeConversationId: 'diagram', activeConversationKind: 'architecture',
    conversations: [{ conversation_id: 'diagram', kind: 'architecture', title: '函数与变量图' }],
    onCreateConversation() { calls++ },
    onSelectConversation() { calls++ },
  }
  const harness = await assistantHeaderHarness(context)
  for (const type of ['select', 'create']) {
    const view = harness.render({ ...context, conversationPending: type })
    assert.equal(view.create.props.disabled, true)
    assert.equal(view.select.props.disabled, true)
    assert.match(view.text, type === 'create' ? /正在创建讨论会话/ : /正在切换会话/)
    await view.create.props.onClick()
    await view.select.props.onChange({ target: { value: 'another' } })
  }
  assert.equal(calls, 0)
  const ready = harness.render({ ...context, conversationPending: '' })
  assert.equal(ready.create.props.disabled, false)
  assert.equal(ready.select.props.disabled, false)
  await ready.create.props.onClick()
  assert.equal(calls, 1)
})

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

test('names compact navigation, follows the visible page, and toggles tools without losing the page', async () => {
  const react = {
    createElement(type, props, ...children) { return { type, props: { ...props, children: children.flat() } } },
    cloneElement(node, props) { return { ...node, props: { ...node.props, ...props } } },
    useState(initial) { return [initial, () => {}] },
    useRef(initial) { return { current: initial } },
    useCallback(fn) { return fn }, useMemo(fn) { return fn() },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
    useEffect() {}, useLayoutEffect() {},
  }
  const { exported } = await loadClient(react)
  const sidebar = fakeSidebar()
  const service = exported.createPangeaService(sidebar)
  for (const id of ['analysis', 'assets', 'settings']) {
    service.registerPage({ id, title: id, component: () => null })
  }
  const scope = { sessionId: 'session-1', cwd: '/tmp/project' }
  const nodes = tree => tree && typeof tree === 'object'
    ? [tree, ...(tree.props?.children ?? []).flatMap(nodes)] : []

  for (const utility of [undefined, 'editor', 'browser', 'terminal']) {
    const tab = { id: 'analysis-tab', type: 'dsh-pangea:analysis', meta: { pangeaUtility: utility } }
    sidebar.setState({ splits: { tabs: [tab], active: tab.id }, bottomSplits: { tabs: [] } })
    const shell = sidebar.getTab(tab.type).component({ scope, tab, visible: true })
    const rendered = shell.type(shell.props)
    const elements = nodes(rendered)
    const navButtons = elements.filter(node => node.props?.['data-pangea-nav-button'] || node.props?.['data-pangea-tool-button'])
    assert.equal(navButtons.length, 6)
    for (const button of navButtons) {
      assert.ok(button.props['aria-label'], 'icon-only navigation keeps its accessible name')
      assert.equal(button.props.title, button.props['aria-label'])
    }
    const analysis = navButtons.find(node => node.props['aria-label'] === 'PANGEA 分析')
    const covered = utility === 'editor' || utility === 'browser'
    assert.equal(analysis.props['aria-current'], covered ? undefined : 'page')
    const content = elements.find(node => node.props?.['data-pangea-product-content'])
    assert.ok(content.props.children[0], 'the page stays mounted while using a tool')
    assert.equal(content.props.style.display, covered ? 'none' : undefined, 'terminal retains the visible page above its dock')
    const main = elements.find(node => node.type === 'main')
    assert.equal(main.props['data-pangea-terminal-open'], utility === 'terminal' ? true : undefined)
    assert.equal(main.props.children.filter(node => node?.props?.['data-pangea-product-content']).length, 1)
    if (utility === 'terminal') assert.ok(main.props.children.some(node => node?.props?.['data-pangea-terminal-dock']), 'terminal shares the main grid with the page')
    const fileButton = navButtons.find(node => node.props['aria-label'] === '文件')
    assert.equal(fileButton.props['aria-pressed'], utility === 'editor')
    fileButton.props.onClick()
    assert.equal(sidebar.updated.at(-1).patch.meta.pangeaUtility, utility === 'editor' ? null : 'editor')
    if (utility) {
      const close = elements.find(node => node.props?.['data-pangea-utility-close'])
      assert.match(close.props['aria-label'], /^关闭/)
      close.props.onClick()
      assert.equal(sidebar.updated.at(-1).patch.meta.pangeaUtility, null)
    }
    const header = rendered.props.children.find(node => node.type?.name === 'ProductHeader')
    const workspace = nodes(header.type(header.props)).find(node => node.props?.['data-pangea-project'])
    assert.equal(workspace.type, 'div', 'current workspace does not promise an unavailable switcher')
    assert.equal(workspace.props['aria-label'], '当前项目：project')
    assert.equal(workspace.props.title, scope.cwd)
  }
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

test('hides the readonly composer and restores it for a matching discussion session', async () => {
  const { exported, source } = await loadClient()
  assert.match(source, /\[data-composer-seat\]\[data-pangea-analysis-readonly="true"\]\s*\{\s*display: none !important;/)
  assert.match(source, /展开“修改或生成新版本”，填写要求后选择“生成修改版”/)
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

test('discussion to diagram switch keeps the active assistant visible after old shell cleanup', async () => {
  let rendering
  const bodyAttributes = new Map()
  const react = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) { return { type, props: { ...props, children: children.length === 1 ? children[0] : children }, children } },
    cloneElement(node, props) { return { ...node, props: { ...node.props, ...props } } },
    useState(initial) { return [rendering.stateIndex++ === 1 ? rendering.context : initial, () => {}] },
    useRef(initial) { return { current: initial } },
    useCallback(fn) { return fn }, useMemo(fn) { return fn() },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
    useEffect(fn) { rendering.effects.push(fn) }, useLayoutEffect() {},
  }
  const { exported } = await loadClient(react, {
    document: { body: {
      setAttribute(name, value) { bodyAttributes.set(name, value) },
      getAttribute(name) { return bodyAttributes.get(name) },
      removeAttribute(name) { bodyAttributes.delete(name) },
    } },
    window: { addEventListener() {}, removeEventListener() {} },
  })
  const sidebar = fakeSidebar()
  const sessions = { list: { subscribe() {}, getSnapshot() { return { current: 'discussion' } } } }
  const service = exported.createPangeaService(sidebar, sessions)
  service.selectTask('cpu')
  service.registerPage({ id: 'analysis', title: '分析', component: () => null })
  const baseContext = { taskId: 'cpu', workspaceKey: '/workspace', processMode: 'acp',
    conversations: [
      { conversation_id: 'discussion', session_id: 'discussion', kind: 'assistant' },
      { conversation_id: 'functions', session_id: 'functions', kind: 'architecture' },
    ] }
  const mount = (conversationId, visible) => {
    rendering = { stateIndex: 0, effects: [], context: { ...baseContext,
      activeConversationId: conversationId, activeConversationSessionId: conversationId,
      activeConversationKind: conversationId === 'functions' ? 'architecture' : 'assistant' } }
    const shell = sidebar.getTab('dsh-pangea:analysis').component({ scope: { cwd: '/workspace' }, visible })
    const rendered = shell.type(shell.props)
    const portal = rendered.children.find(node => node?.type?.name === 'AssistantPortals')
    const cleanups = rendering.effects.map(effect => effect()).filter(value => typeof value === 'function')
    return { portal, cleanup: () => cleanups.forEach(cleanup => cleanup()) }
  }
  const discussion = mount('discussion', true)
  assert.equal(bodyAttributes.get('data-pangea-task-assistant'), 'cpu')
  const diagram = mount('functions', true)
  assert.equal(diagram.portal.props.enabled, true)
  assert.equal(diagram.portal.props.context.activeConversationKind, 'architecture')
  // Session switches temporarily retain both ProductShell instances for this task.
  discussion.cleanup()
  const hiddenDiscussion = mount('discussion', false)
  assert.equal(hiddenDiscussion.portal.props.enabled, false)
  assert.equal(bodyAttributes.get('data-pangea-product-shell'), 'analysis')
  assert.equal(bodyAttributes.get('data-pangea-task-assistant'), 'cpu')
  hiddenDiscussion.cleanup()
  assert.equal(bodyAttributes.get('data-pangea-task-assistant'), 'cpu')
  diagram.cleanup()
  assert.equal(bodyAttributes.has('data-pangea-task-assistant'), false)
  assert.equal(bodyAttributes.has('data-pangea-product-shell'), false)
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
