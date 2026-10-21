import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
const hookSource = source.slice(source.indexOf('    const GRAPH_CANVAS_STYLE ='), source.indexOf('    function warningList('))

function viewport(graphWidth = 1000, graphHeight = 800, savedViewport) {
  const hooks = [], pending = [], observers = [], listeners = new Map(), captures = new Set(), fullscreenListeners = new Map()
  let index = 0, view, graphKey = 'first'
  const document = {
    fullscreenElement: null,
    addEventListener(name, fn) { fullscreenListeners.set(name, fn) },
    removeEventListener(name, fn) { assert.equal(fullscreenListeners.get(name), fn); fullscreenListeners.delete(name) },
    async exitFullscreen() { this.fullscreenElement = null; fullscreenListeners.get('fullscreenchange')?.() },
  }
  const section = { async requestFullscreen() { document.fullscreenElement = this; fullscreenListeners.get('fullscreenchange')?.() } }
  const canvas = {
    closest: () => section,
    clientWidth: 600, clientHeight: 400, clientLeft: 1, clientTop: 1,
    getBoundingClientRect: () => ({ left: 20, top: 30 }),
    addEventListener(name, fn, options) { listeners.set(name, { fn, options }) },
    removeEventListener(name, fn) { assert.equal(listeners.get(name).fn, fn); listeners.delete(name) },
    setPointerCapture(id) { captures.add(id) },
    hasPointerCapture(id) { return captures.has(id) },
    releasePointerCapture(id) { captures.delete(id) },
  }
  const React = {
    useRef(value) { const slot = index++; return hooks[slot] ??= { current: value } },
    useState(initial) {
      const slot = index++
      if (!(slot in hooks)) hooks[slot] = initial
      return [hooks[slot], value => { hooks[slot] = typeof value === 'function' ? value(hooks[slot]) : value }]
    },
    useEffect(effect, dependencies) {
      const slot = index++, previous = hooks[slot]
      if (previous && dependencies.every((value, i) => value === previous.dependencies[i])) return
      pending.push(() => { previous?.cleanup?.(); hooks[slot] = { dependencies, cleanup: effect() } })
    },
  }
  const context = vm.createContext({ React, document,
    h: (tag, props, ...children) => ({ tag, props, children }),
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this) }
      observe(target) { assert.equal(target, canvas); this.active = true }
      disconnect() { this.active = false }
    },
  })
  vm.runInContext(`${hookSource}\nglobalThis.useGraphZoom = useGraphZoom`, context)
  const render = () => { index = 0; view = context.useGraphZoom('测试图', graphWidth, graphHeight, graphKey, savedViewport); view.panProps.ref.current = canvas; return view }
  const flush = () => { render(); pending.splice(0).forEach(effect => effect()); return render() }
  flush()
  return {
    canvas, captures, listeners, section, document, fullscreenListeners,
    get view() { return render() },
    camera() {
      const tree = render().sized({ tag: 'svg', attrs: { width: graphWidth, height: graphHeight }, children: [] })
      const [x, y, scale] = tree.children[0].attrs.transform.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g).map(Number)
      return { x, y, scale, tree }
    },
    event(extra = {}) { return { currentTarget: canvas, button: 0, pointerId: 7, clientX: 100, clientY: 100, detail: 1,
      prevented: false, stopped: false, preventDefault() { this.prevented = true }, stopPropagation() { this.stopped = true }, ...extra } },
    wheel(extra = {}) { const event = this.event({ deltaY: -100, deltaMode: 0, ...extra }); listeners.get('wheel').fn(event); return event },
    click(label) { const button = render().controls.children.find(child => child?.props['aria-label'] === label); assert.ok(button); return button.props.onClick() },
    resize(width, height) { canvas.clientWidth = width; canvas.clientHeight = height; observers.filter(observer => observer.active).forEach(observer => observer.callback()) },
    switchGraph(key) { graphKey = key; flush() },
    dispose() { hooks.forEach(hook => hook?.cleanup?.()); assert.ok(observers.every(observer => !observer.active)) },
  }
}

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`)

test('the graph fits one bounded viewport and responsive fitting contains all nodes', () => {
  const graph = viewport()
  const { tree, x, y, scale } = graph.camera()
  assert.equal(graph.view.panProps.style.overflow, 'hidden')
  assert.equal(graph.view.panProps.style.maxHeight, undefined)
  assert.equal(tree.attrs.width, '100%')
  assert.equal(tree.attrs.height, '100%')
  assert.equal(tree.attrs.viewBox, '0 0 600 400')
  close(scale, 0.46)
  close(x, 70)
  close(y, 16)
  graph.resize(300, 320)
  const fitted = graph.camera()
  assert.ok(fitted.x >= 16 && fitted.y >= 16)
  assert.ok(fitted.x + 1000 * fitted.scale <= 284)
  assert.ok(fitted.y + 800 * fitted.scale <= 304)
  graph.dispose()
})

test('fullscreen controls track this diagram, browser exit and failures without losing the camera', async () => {
  const graph = viewport()
  graph.click('测试图原始大小')
  const before = graph.camera()
  await graph.click('全屏阅读测试图')
  assert.equal(graph.document.fullscreenElement, graph.section)
  assert.equal(graph.view.controls.children.find(child => child?.props['aria-pressed'])?.children[0], '退出全屏')
  await graph.document.exitFullscreen()
  assert.equal(graph.view.controls.children.find(child => child?.props['aria-label'] === '全屏阅读测试图').props['aria-pressed'], false)
  close(graph.camera().scale, before.scale)

  graph.document.fullscreenElement = {}
  graph.fullscreenListeners.get('fullscreenchange')()
  assert.equal(graph.view.controls.children.find(child => child?.props['aria-label'] === '全屏阅读测试图').props['aria-pressed'], false)
  graph.section.requestFullscreen = async () => { throw new Error('permission denied') }
  await graph.click('全屏阅读测试图')
  assert.match(graph.view.controls.children.find(child => child?.props.role === 'alert').children[0], /未能开启/)
  delete graph.section.requestFullscreen
  await graph.click('全屏阅读测试图')
  assert.match(graph.view.controls.children.find(child => child?.props.role === 'alert').children[0], /不支持/)
  graph.dispose()
  assert.equal(graph.fullscreenListeners.size, 0)
})

test('fullscreen exit button reports failure and can be retried', async () => {
  const graph = viewport()
  await graph.click('全屏阅读测试图')
  const exitFullscreen = graph.document.exitFullscreen
  graph.document.exitFullscreen = async () => { throw new Error('exit rejected') }
  await graph.click('退出测试图全屏')
  assert.match(graph.view.controls.children.find(child => child?.props.role === 'alert').children[0], /未能退出/)
  graph.document.exitFullscreen = exitFullscreen
  await graph.click('退出测试图全屏')
  assert.equal(graph.document.fullscreenElement, null)
  assert.equal(graph.view.controls.children.some(child => child?.props.role === 'alert'), false)
  graph.dispose()
})

test('ordinary wheel scrolls the page while Ctrl wheel zooms around the pointer', () => {
  const graph = viewport()
  assert.equal(graph.listeners.get('wheel').options.passive, false)
  for (const ctrlKey of [false, true]) {
    const before = graph.camera()
    const event = graph.wheel({ ctrlKey, clientX: 221, clientY: 181 })
    const after = graph.camera()
    assert.equal(event.prevented, ctrlKey)
    assert.equal(event.stopped, ctrlKey)
    if (!ctrlKey) { close(after.scale, before.scale); continue }
    assert.ok(after.scale > before.scale)
    close((200 - after.x) / after.scale, (200 - before.x) / before.scale)
    close((150 - after.y) / after.scale, (150 - before.y) / before.scale)
  }
  graph.dispose()
  assert.equal(graph.listeners.size, 0)
})

test('clicking nodes remains a click, while a captured drag pans and suppresses its trailing click', () => {
  const graph = viewport()
  const down = graph.event({ target: { closest: () => ({}) } })
  graph.view.panProps.onPointerDown(down)
  graph.view.panProps.onPointerMove(graph.event({ clientX: 102 }))
  graph.view.panProps.onPointerUp(graph.event({ clientX: 102 }))
  const click = graph.event()
  graph.view.panProps.onClickCapture(click)
  assert.equal(click.stopped, false)
  assert.equal(down.prevented, false)
  assert.equal(graph.captures.size, 0)

  const before = graph.camera()
  graph.view.panProps.onPointerDown(graph.event())
  graph.view.panProps.onPointerMove(graph.event({ clientX: 120, clientY: 135 }))
  assert.equal(graph.captures.has(7), true)
  assert.equal(graph.view.panProps.style.cursor, 'grabbing')
  graph.view.panProps.onPointerMove(graph.event({ clientX: -60, clientY: 170 }))
  const after = graph.camera()
  close(after.x, before.x - 160)
  close(after.y, before.y + 70)
  close(after.scale, before.scale)
  graph.view.panProps.onPointerUp(graph.event({ clientX: -60, clientY: 170 }))
  assert.equal(graph.captures.size, 0)
  const dragClick = graph.event()
  graph.view.panProps.onClickCapture(dragClick)
  assert.equal(dragClick.stopped, true)
  assert.equal(dragClick.prevented, true)
  assert.equal(graph.view.panProps.style.cursor, 'grab')
  graph.dispose()
})

test('zoom controls, 100 percent, resize preservation and fit reset use actual SVG scale', () => {
  const graph = viewport()
  const initial = graph.camera()
  graph.click('放大测试图')
  close(graph.camera().scale, initial.scale * 1.25)
  graph.click('缩小测试图')
  close(graph.camera().scale, initial.scale)
  graph.click('测试图原始大小')
  close(graph.camera().scale, 1)
  const before = graph.camera()
  graph.resize(700, 500)
  const resized = graph.camera()
  close(resized.scale, 1)
  close((350 - resized.x) / resized.scale, (300 - before.x) / before.scale)
  close((250 - resized.y) / resized.scale, (200 - before.y) / before.scale)
  graph.click('适应测试图画布')
  close(graph.camera().scale, 468 / 800)
  graph.wheel()
  graph.switchGraph('second')
  close(graph.camera().scale, 468 / 800)
  graph.dispose()
})

test('cancelled dragging releases capture without moving on later pointer events', () => {
  const graph = viewport()
  graph.view.panProps.onPointerDown(graph.event())
  graph.view.panProps.onPointerMove(graph.event({ clientX: 150 }))
  graph.view.panProps.onPointerCancel(graph.event({ clientX: 150 }))
  const before = graph.camera()
  graph.view.panProps.onPointerMove(graph.event({ clientX: 200 }))
  close(graph.camera().x, before.x)
  assert.equal(graph.captures.size, 0)
  const keyboardClick = graph.event({ detail: 0 })
  graph.view.panProps.onClickCapture(keyboardClick)
  assert.equal(keyboardClick.stopped, false)
  graph.dispose()
})

test('flow graph zoom and pan survive unmounting independently for each flow', () => {
  const firstViewport = {}, secondViewport = {}
  const first = viewport(1000, 800, firstViewport)
  first.click('放大测试图')
  first.view.panProps.onPointerDown(first.event())
  first.view.panProps.onPointerMove(first.event({ clientX: 180, clientY: 145 }))
  first.view.panProps.onPointerUp(first.event({ clientX: 180, clientY: 145 }))
  const firstCamera = first.camera()
  first.dispose()
  const second = viewport(1000, 800, secondViewport)
  second.click('测试图原始大小')
  const secondCamera = second.camera()
  second.dispose()
  assert.notEqual(firstCamera.scale, secondCamera.scale)
  for (const [saved, expected] of [[firstViewport, firstCamera], [secondViewport, secondCamera]]) {
    const restored = viewport(1000, 800, saved)
    const camera = restored.camera()
    close(camera.scale, expected.scale)
    close(camera.x, expected.x)
    close(camera.y, expected.y)
    restored.dispose()
  }
})
