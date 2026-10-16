import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const sameDeps = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
function content(node) {
  if (Array.isArray(node)) return node.map(content).join(' ')
  if (node?.type === 'style') return ''
  return node?.children ? content(node.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''
}
function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants)
  return node?.children ? [node, ...node.children.flatMap(descendants)] : []
}

const firstCase = {
  test_case_id: 'TC-1', display_id: 'TC-1', title: '连接超时后恢复', readiness: 'ready',
  variants: [{ variant_id: 'slow', input: '延迟响应', expected: '重试后恢复' }],
}
const ledger = {
  projection_id: 'ledger-1', unit_id: 'unit-1', scope: '连接恢复',
  items: [{ display_key: 'B-1', item_id: 'B-1', operation: '超时重试', status: 'covered', case_links: [{ target_case_id: 'TC-1', case_id: 'TC-1' }] }],
}
const currentRun = (runId = 'run-1') => ({
  run_id: runId, data_root: '/workspace/pangea-data', workflow_version: 'source-first-v1',
  terminal: true, lifecycle_status: 'complete', scenario: 'branch-analysis',
  details: { test_cases: [firstCase, { test_case_id: 'TC-2', title: '关闭连接' }], behavior_coverage: [ledger] },
})

// Loaded snapshots isolate navigation from HTTP polling. State, refs, callbacks
// and layout effects are persistent; refs attach before the real layout effect.
// DOM scrolling/expansion is deliberately observable outside the React state.
async function harness() {
  const states = {
    0: { status: 'ok', data_root: '/workspace/pangea-data', current: currentRun(), runs: [] },
    1: { status: 'ok', compatibility: { compatible: true }, capabilities: { repositories: ['repo'] },
      tasks: { items: [{ task_id: 'task-1', run_id: 'run-1', data_root: '/workspace/pangea-data', title: '连接分析' }] }, runs: { items: [] } },
    4: 'run-1', 5: 'task-1', 16: { type: 'cases' },
  }
  const refs = [], effects = [], callbacks = [], pages = [], frames = new Map(), domByKey = new Map()
  let stateIndex, refIndex, effectIndex, callbackIndex, pending, tree, exported, frameId = 0, lastScreen, dirty
  let scope = { cwd: '/workspace' }, visible = true
  const documentElement = { scrollTop: 0, scrollLeft: 0, isConnected: true, parentElement: null }
  const outer = { scrollTop: 0, scrollLeft: 0, isConnected: true, parentElement: documentElement }
  const root = { scrollTop: 0, scrollLeft: 0, isConnected: true, parentElement: outer }
  let mounted = []
  const queryAll = selector => mounted.filter(node => {
    if (selector === 'details') return node.tagName === 'DETAILS'
    if (selector === '[data-scroll-key]') return node.getAttribute('data-scroll-key') != null
    if (selector === '[data-view-key]') return node.getAttribute('data-view-key') != null
    const attribute = selector.match(/^\[([^=]+)="(.*)"\]$/)
    return attribute && node.getAttribute(attribute[1]) === attribute[2]
  })
  root.querySelectorAll = queryAll
  root.querySelector = selector => queryAll(selector)[0] ?? null
  root.contains = element => element === root || mounted.includes(element)
  const document = { scrollingElement: documentElement, documentElement, body: documentElement }
  root.ownerDocument = outer.ownerDocument = documentElement.ownerDocument = document
  const react = {
    Fragment: Symbol('Fragment'), createElement(type, props, ...children) { return { type, props: props ?? {}, children } },
    useState(initial) {
      const key = stateIndex++
      if (!(key in states)) states[key] = typeof initial === 'function' ? initial() : initial
      return [states[key], update => {
        const value = typeof update === 'function' ? update(states[key]) : update
        if (!Object.is(value, states[key])) { states[key] = value; dirty = true }
      }]
    },
    useRef(initial) { return refs[refIndex++] ??= { current: initial } },
    useCallback(fn, deps) {
      const key = callbackIndex++
      if (!sameDeps(callbacks[key]?.deps, deps)) callbacks[key] = { fn, deps }
      return callbacks[key].fn
    },
    useEffect() {},
    useLayoutEffect(fn, deps) {
      const key = effectIndex++, previous = effects[key]
      if (!sameDeps(previous?.deps, deps)) pending.push(() => {
        previous?.cleanup?.(); effects[key] = { deps, cleanup: fn() }
      })
    },
  }
  const window = {
    get scrollX() { return documentElement.scrollLeft }, get scrollY() { return documentElement.scrollTop },
    scrollTo(left, top) { documentElement.scrollLeft = left; documentElement.scrollTop = top },
    requestAnimationFrame(fn) { const id = ++frameId; frames.set(id, fn); return id }, cancelAnimationFrame(id) { frames.delete(id) },
    __ModuleLoader__: { load(spec) { exported = spec.factory(name => name === 'react' ? react : {}) } },
  }
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), { window, document, URLSearchParams, AbortController, console })
  const ctx = { pangea: { registerPage(page) { pages.push(page) } }, effect(fn) { return fn() } }
  exported.apply(ctx)

  function expand(node) {
    if (Array.isArray(node)) return node.map(expand)
    if (node?.type === exported.BehaviorCoverageView) return expand(node.type(node.props))
    return node?.children ? { ...node, children: node.children.map(expand) } : node
  }
  function mount() {
    if (states[16].type !== lastScreen) {
      for (const node of mounted) node.isConnected = false
      domByKey.clear()
      lastScreen = states[16].type
    }
    mounted = []
    for (const [index, node] of descendants(tree).entries()) {
      if (typeof node.type !== 'string') continue
      const key = node.props['data-view-key'] ?? node.props['data-scroll-key'] ?? `${node.type}:${index}`
      let dom = domByKey.get(key)
      if (!dom) {
        dom = { tagName: node.type.toUpperCase(), open: Boolean(node.props.open), scrollTop: 0, scrollLeft: 0, isConnected: true,
          parentElement: root, ownerDocument: document, getAttribute(name) { return this.props[name] ?? null } }
        domByKey.set(key, dom)
      }
      dom.props = node.props
      mounted.push(dom)
      if (node.props.ref) {
        const target = node === tree ? root : dom
        if (typeof node.props.ref === 'function') node.props.ref(target)
        else node.props.ref.current = target
      }
    }
  }
  function render() {
    let iterations = 0
    do {
      assert.ok(++iterations < 15, 'navigation layout effects must settle')
      dirty = false; stateIndex = refIndex = effectIndex = callbackIndex = 0; pending = []
      const panel = pages.find(page => page.id === 'analysis').component({ scope, visible })
      tree = expand(panel.type(panel.props))
      mount()
      for (const run of pending) run()
      const queued = [...frames.values()]; frames.clear()
      for (const frame of queued) frame()
    } while (dirty)
    return tree
  }
  function find(predicate, description) {
    const node = descendants(tree).find(predicate)
    assert.ok(node, `missing ${description}`)
    return node
  }
  function click(label) {
    const node = find(node => node.type === 'button' && content(node).trim() === label, `button ${label}`)
    node.props.onClick(); render()
  }
  function input(label) { return find(node => node.type === 'input' && node.props['aria-label'] === label, `input ${label}`) }
  render()
  return {
    outer, root, documentElement, click, input, render,
    text: () => content(tree), nodes: () => descendants(tree), dom: () => mounted,
    coverage: () => mounted.find(node => node.tagName === 'DETAILS' && node.props['aria-label'] === '业务行为覆盖清单'),
    variants: () => mounted.find(node => node.props.className === 'b05-variant-preview'),
    table: () => mounted.find(node => node.props['data-scroll-key']),
    search(value) { input('搜索测试用例').props.onChange({ target: { value } }); render() },
    select(id) { input(`选择 ${id}`).props.onChange(); render() },
    changeRun(runId) {
      states[4] = runId
      states[0] = { ...states[0], current: currentRun(runId) }
      states[1] = { ...states[1], tasks: { items: states[1].tasks.items.map(item => ({ ...item, run_id: runId })) } }
      render()
    },
    refreshSnapshot() { states[0] = { ...states[0], current: { ...states[0].current } }; render() },
    changeWorkspace(cwd) { scope = { cwd }; render() },
    show(value) { visible = value; render() },
    cleanup() { for (const effect of effects) effect?.cleanup?.(); frames.clear() },
  }
}

test('business behavior coverage starts collapsed and keeps its ledger content available', async () => {
  const h = await harness()
  try {
    assert.ok(h.coverage(), 'coverage must use a native disclosure')
    assert.equal(h.coverage().open, false)
    assert.ok(h.nodes().some(node => node.type === 'summary' && content(node).includes('业务行为覆盖清单')))
    assert.match(h.text(), /超时重试/)
  } finally { h.cleanup() }
})

for (const entry of ['连接超时后恢复', '查看 ›', 'TC-1']) {
  test(`case entry ${entry} restores list scroll, disclosures and selection on back`, async () => {
    const h = await harness()
    try {
      h.search('连接超时'); h.select('TC-1')
      h.coverage().open = true; h.variants().open = true
      assert.ok(h.table(), 'case table must expose its scroll surface')
      h.table().scrollLeft = 135
      h.outer.scrollTop = 1275; h.outer.scrollLeft = 23
      h.documentElement.scrollTop = 240; h.documentElement.scrollLeft = 9
      h.click(entry)
      assert.ok(h.nodes().some(node => node.props.className === 'b05-detail-title' && content(node) === '连接超时后恢复'))
      assert.equal(h.outer.scrollTop, 0, 'detail opens at the top of the host scroll surface')
      h.outer.scrollTop = 420; h.documentElement.scrollTop = 80
      h.click('返回用例')
      assert.equal(h.outer.scrollTop, 1275)
      assert.equal(h.outer.scrollLeft, 23)
      assert.equal(h.documentElement.scrollTop, 240)
      assert.equal(h.documentElement.scrollLeft, 9)
      assert.equal(h.table().scrollLeft, 135)
      assert.equal(h.coverage().open, true)
      assert.equal(h.variants().open, true)
      assert.equal(h.input('搜索测试用例').props.value, '连接超时')
      assert.equal(h.input('选择 TC-1').props.checked, true)
      // Subsequent renders must not pin the reader back to the saved position.
      h.outer.scrollTop = 1310; h.refreshSnapshot()
      assert.equal(h.outer.scrollTop, 1310)
    } finally { h.cleanup() }
  })
}

for (const change of ['run', 'workspace']) {
  test(`a different ${change} does not restore the previous list viewport`, async () => {
    const h = await harness()
    try {
      h.outer.scrollTop = 1780; h.coverage().open = true
      h.click('连接超时后恢复')
      if (change === 'run') h.changeRun('run-2')
      else h.changeWorkspace('/another-workspace')
      h.outer.scrollTop = 55
      h.click('返回用例')
      assert.notEqual(h.outer.scrollTop, 1780)
      assert.equal(h.coverage().open, false)
    } finally { h.cleanup() }
  })
}
