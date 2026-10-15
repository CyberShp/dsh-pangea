import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const tick = () => new Promise(resolve => setImmediate(resolve))
const clone = value => JSON.parse(JSON.stringify(value))
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes)
  return node?.children ? [node, ...node.children.flatMap(nodes)] : []
}
function deferred() {
  let resolve
  return { promise: new Promise(done => { resolve = done }), resolve: value => resolve(value) }
}

// Keep each mounted product page's real component state, refs and navigation
// subscriptions separate. Network polling is driven explicitly by the fixture.
async function harness({ onboarding = false, tasks = [], selectedId, onImport, createAvailable = true } = {}) {
  const banks = new Map(), pages = [], opened = [], requests = []
  let active, exported, cwd = '/workspace', draft = { requestId: 0, assetIds: [] }, selected = selectedId
  const taskListeners = new Set(), draftListeners = new Set()
  let repositories = onboarding ? [] : ['repo']
  const workbench = () => ({ status: 'ok', compatibility: { compatible: true }, tasks: { items: clone(tasks) }, runs: { items: [] },
    capabilities: { repositories: [...repositories] }, acp_providers: [] })
  const repositoryStatus = () => ({ status: 'ok', data_root: `${cwd}/pangea-data`, onboarding_required: repositories.length === 0,
    repositories: repositories.map(name => ({ name })) })
  function bank(id) {
    if (!banks.has(id)) banks.set(id, { states: { 1: workbench(), 10: repositoryStatus() }, refs: [], effects: [], dirty: false })
    return banks.get(id)
  }
  const react = {
    Fragment: Symbol('Fragment'), createElement(type, props, ...children) { return { type, props: props ?? {}, children } },
    useState(initial) {
      const owner = active, key = owner.stateIndex++
      if (!(key in owner.states)) owner.states[key] = typeof initial === 'function' ? initial() : initial
      return [owner.states[key], update => {
        const value = typeof update === 'function' ? update(owner.states[key]) : update
        if (!Object.is(value, owner.states[key])) { owner.states[key] = value; owner.dirty = true }
      }]
    },
    useRef(initial) { const key = active.refIndex++; return active.refs[key] ??= { current: initial } },
    useCallback(callback) { return callback },
    useEffect(effect, deps) {
      const owner = active, key = owner.effectIndex++
      if (!/getSelectedTaskId|workbench\?\.selected_task_id|const taskRun|subscribeRunDraft|handledRunDraftRequest/.test(String(effect))) return
      const previous = owner.effects[key]
      if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) {
        owner.pending.push(() => {
          previous?.cleanup?.()
          owner.effects[key] = { deps: [...deps], cleanup: effect() }
        })
      }
    },
  }
  const fetcher = async (url, options = {}) => {
    const path = new URL(url, 'https://fixture').pathname
    const body = options.body ? JSON.parse(options.body) : undefined
    requests.push({ path, cwd: new URL(url, 'https://fixture').searchParams.get('cwd'), body })
    let result
    if (path.endsWith('/repositories') && options.method === 'POST') {
      result = await (onImport?.(body) ?? { status: 'ok', repository: { name: body.repository_name } })
      if (result.status === 'ok') repositories.push(result.repository.name)
    } else if (path.endsWith('/repositories')) result = repositoryStatus()
    else if (path.endsWith('/workbench')) result = workbench()
    else throw new Error(`Unexpected request: ${url}`)
    return { ok: result.status === 'ok', status: result.status === 'ok' ? 200 : 400, json: async () => result }
  }
  const sandbox = { URLSearchParams, AbortController, console, fetch: fetcher, setInterval, clearInterval,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail } } }
  sandbox.window = { dispatchEvent() {}, setInterval, clearInterval, setTimeout: (...args) => setTimeout(...args).unref(), clearTimeout,
    dshDesktopDirectoryPicker: { async pick() { return '/source/imported' } },
    __ModuleLoader__: { load(spec) { exported = spec.factory(name => name === 'react' ? react : {}) } } }
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), sandbox)
  const pangea = {
    registerPage(page) { pages.push(page) },
    openPage(scope, id) { opened.push({ id, scope }); return true },
    getSelectedTaskId() { return selected },
    selectTask(id) { if (selected === id) return; selected = id; for (const notify of taskListeners) notify() },
    subscribeTaskSelection(listener) { taskListeners.add(listener); return () => taskListeners.delete(listener) },
    getRunDraft() { return draft },
    updateRunDraft(patch) { draft = { ...draft, ...patch }; for (const notify of draftListeners) notify() },
    subscribeRunDraft(listener) { draftListeners.add(listener); return () => draftListeners.delete(listener) },
    requestRunCreation(scope) {
      if (!createAvailable) return false
      pangea.updateRunDraft({ intent: 'create', runId: null, requestId: draft.requestId + 1 })
      return pangea.openPage(scope, 'analysis')
    },
  }
  const ctx = { pangea, effect(fn) { return fn() } }
  exported.apply(ctx)
  function render(id) {
    const owner = bank(id)
    let tree, attempts = 0
    do {
      assert.ok(++attempts < 15, 'navigation effects must settle')
      active = owner; owner.dirty = false; owner.stateIndex = 0; owner.refIndex = 0; owner.effectIndex = 0; owner.pending = []
      const element = pages.find(page => page.id === (id === 'home' ? 'workbench' : id)).component({ ctx, scope: { cwd }, visible: true })
      tree = element.type(element.props)
      for (const effect of owner.pending) effect()
    } while (owner.dirty)
    return nodes(tree)
  }
  function click(id, label) {
    const button = render(id).find(node => node.type === 'button' && node.children.includes(label))
    assert.ok(button, `missing ${id} button: ${label}`)
    assert.equal(Boolean(button.props.disabled), false, `${label} disabled`)
    return button.props.onClick()
  }
  async function importRepository(id, firstUse = false) {
    await click(id, '选择文件夹'); await tick()
    const returned = click(id, firstUse ? '完成初始化' : '添加仓库')
    await returned; await tick()
  }
  return { bank, render, click, importRepository, requests, opened, pangea,
    refresh(id, values) { bank(id).states[1] = { ...workbench(), ...values }; return render(id) },
    setWorkspace(value) { cwd = value },
  }
}
const task = { task_id: 'task-1', run_id: 'run-1', title: 'TLS 握手分析', target: 'TLS', repository: 'repo', status: 'running', execution_status: 'running' }

test('initial repository import stays on workbench; new analysis opens the analysis page without replacing home', async () => {
  const h = await harness({ onboarding: true })
  await h.importRepository('home', true)
  assert.equal(h.bank('home').states[16].type, 'home')
  assert.ok(h.render('home').some(node => node.type === 'h1' && node.children.includes('测试工作台')))
  h.click('home', '新建分析')
  assert.equal(h.opened.at(-1).id, 'analysis')
  h.render('analysis')
  assert.equal(h.bank('analysis').states[16].type, 'create')
  assert.equal(h.bank('home').states[16].type, 'home')
  assert.equal(h.render('analysis')[0].props['aria-label'], 'PANGEA 分析')
  assert.equal(h.render('home')[0].props['aria-label'], 'PANGEA 测试工作台')
})

test('missing analysis page leaves workbench in place and reports navigation failure', async () => {
  const h = await harness({ createAvailable: false })
  h.click('home', '新建分析')
  assert.equal(h.bank('home').states[16].type, 'home')
  assert.ok(h.render('home').some(node => node.children.includes('分析任务当前不可用，请检查对应插件是否已加载。')))
})

test('home task navigation never binds local task/run state and same-task reentry restores analysis overview', async () => {
  const h = await harness({ tasks: [task], selectedId: task.task_id })
  h.render('analysis')
  h.pangea.requestRunCreation({ cwd: '/workspace' }); h.render('analysis')
  assert.equal(h.bank('analysis').states[16].type, 'create')
  h.click('home', '查看进度'); h.render('analysis')
  assert.equal(h.bank('analysis').states[16].type, 'overview')
  assert.equal(h.bank('analysis').states[4], task.run_id)
  assert.equal(h.bank('home').states[5], undefined)
  assert.equal(h.bank('home').states[4], undefined)
  h.refresh('home', { tasks: { items: [{ ...task, run_id: 'run-2' }] }, selected_task_id: task.task_id })
  assert.equal(h.bank('home').states[16].type, 'home')
  assert.ok(h.render('home').some(node => node.type === 'h1' && node.children.includes('测试工作台')))
})

test('repository import back and cancel return to the owning page', async () => {
  for (const mode of ['home', 'analysis']) {
    const h = await harness({ tasks: [task] })
    h.click(mode, '添加仓库')
    const back = mode === 'home' ? '返回工作台' : '返回分析任务'
    h.click(mode, back)
    assert.equal(h.bank(mode).states[16].type, mode === 'home' ? 'home' : 'tasks')
    h.click(mode, '添加仓库'); h.click(mode, '取消')
    assert.equal(h.bank(mode).states[16].type, mode === 'home' ? 'home' : 'tasks')
  }
})

test('analysis import success returns to tasks or the exact originating draft and selects the imported repository', async () => {
  const h = await harness({ tasks: [task] })
  h.click('analysis', '添加仓库'); await h.importRepository('analysis')
  assert.equal(h.bank('analysis').states[16].type, 'tasks')
  h.click('analysis', '新建分析')
  h.bank('analysis').states[16] = { type: 'create', createStep: 1, createView: 'inputs' }
  h.bank('analysis').states[33].target = '保留分析目标'
  h.click('analysis', '添加')
  await h.importRepository('analysis')
  assert.deepEqual(clone(h.bank('analysis').states[16]), { type: 'create', createStep: 1, createView: 'inputs' })
  assert.equal(h.bank('analysis').states[33].repository, 'imported')
  assert.equal(h.bank('analysis').states[33].target, '保留分析目标')
})

test('late task bootstrap and changing task Run do not take over create or repository import', async () => {
  for (const existingSelection of [false, true]) {
    const h = await harness({ tasks: [task], selectedId: existingSelection ? task.task_id : undefined })
    h.pangea.requestRunCreation({ cwd: '/workspace' }); h.render('analysis')
    h.refresh('analysis', { selected_task_id: task.task_id, tasks: { items: [{ ...task, run_id: 'run-2' }] } })
    assert.equal(h.bank('analysis').states[16].type, 'create')
    h.click('analysis', '添加')
    h.refresh('analysis', { selected_task_id: task.task_id, tasks: { items: [{ ...task, run_id: 'run-3' }] } })
    assert.equal(h.bank('analysis').states[16].type, 'repository-import')
  }
})

test('analysis overview still follows the selected task when its Run becomes available', async () => {
  const h = await harness({ tasks: [{ ...task, run_id: null }], selectedId: task.task_id })
  h.render('analysis')
  assert.equal(h.bank('analysis').states[4], null)
  h.refresh('analysis', { tasks: { items: [task] } })
  assert.equal(h.bank('analysis').states[4], task.run_id)
  assert.equal(h.bank('analysis').states[16].type, 'overview')
})

test('delayed repository import cannot redirect a different workspace or a new analysis draft', async () => {
  for (const change of ['workspace', 'screen']) {
    const pending = deferred()
    const h = await harness({ tasks: [task], onImport: () => pending.promise })
    h.click('analysis', '添加仓库'); await h.click('analysis', '选择文件夹')
    const submission = h.click('analysis', '添加仓库')
    if (change === 'workspace') h.setWorkspace('/other-workspace')
    h.pangea.requestRunCreation({ cwd: change === 'workspace' ? '/other-workspace' : '/workspace' })
    h.render('analysis')
    pending.resolve({ status: 'ok', repository: { name: 'late-repo' } })
    await submission; await tick()
    assert.equal(h.bank('analysis').states[16].type, 'create')
    assert.notEqual(h.bank('analysis').states[33].repository, 'late-repo')
    if (change === 'screen') assert.equal(h.bank('analysis').states[13], false)
    assert.equal(h.requests.filter(request => request.path.endsWith('/repositories') && !request.body).length, 0)
  }
})
