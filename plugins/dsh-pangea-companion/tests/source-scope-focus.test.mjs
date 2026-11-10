import assert from 'node:assert/strict'
import test from 'node:test'
import { createSourceScopePicker } from '../src/source-scope-picker.js'

const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...tree.children.flatMap(nodes)]
const text = tree => typeof tree === 'string' ? tree : Array.isArray(tree) ? tree.map(text).join('') : tree?.children?.map(text).join('') || ''
const tick = () => new Promise(resolve => setImmediate(resolve))
function focusHarness() {
  const hooks = [], effects = [], elements = new Map()
  let index = 0, pending = []
  const doc = { body: {}, activeElement: null }
  doc.activeElement = doc.body
  const element = () => ({ ownerDocument: doc, isConnected: true, disabled: false,
    getClientRects() { return this.isConnected ? [{}] : [] },
    focus(options) { if (!this.isConnected || this.disabled) return; this.options = options; doc.activeElement = this },
  })
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) { const key = index++; if (!(key in hooks)) hooks[key] = initial; return [hooks[key], value => { hooks[key] = value }] },
    useRef(initial) { const key = index++; return hooks[key] ??= { current: initial } },
    useEffect(callback, dependencies) {
      const key = index++, previous = effects[key]
      if (!previous || !dependencies || dependencies.some((value, i) => !Object.is(value, previous.dependencies?.[i]))) pending.push(() => { previous?.cleanup?.(); effects[key] = { dependencies, cleanup: callback() } })
    },
  }
  const Picker = createSourceScopePicker(React)
  return { doc, element,
    render(props) {
      index = 0; pending = []
      const tree = Picker(props), rendered = nodes(tree), activeRefs = new Set()
      for (const node of rendered) if (node.props.ref) {
        const ref = node.props.ref; activeRefs.add(ref)
        let value = elements.get(ref)
        if (!value) { value = element(); elements.set(ref, value) }
        value.isConnected = true; value.disabled = node.props.disabled === true; ref.current = value
        // Model the browser's relevant behavior: disabling a focused button
        // blurs it, whereas aria-disabled preserves keyboard focus.
        if (value.disabled && doc.activeElement === value) doc.activeElement = doc.body
      }
      for (const [ref, value] of elements) if (!activeRefs.has(ref)) { value.isConnected = false; ref.current = null }
      for (const run of pending) run()
      return rendered
    },
    unmount() { for (const effect of effects) effect?.cleanup?.() },
  }
}
function previewControl(rendered) { return rendered.find(node => node.type === 'button' && ['预览起始文件', '正在读取范围…'].includes(text(node))) }
const result = (overrides = {}) => ({ status: 'ok', preview_id: 'scope-preview', matched_file_count: 1, files: [{ relative_path: 'src/main.c' }], next_cursor: 50, has_more: false, ...overrides })

for (const outcome of ['success', 'failure']) test(`scope preview preserves button focus on ${outcome} and ignores duplicate activation`, async t => {
  const h = focusHarness(), oldDocument = globalThis.document, oldFetch = globalThis.fetch
  globalThis.document = h.doc
  let complete, requests = 0, preview
  globalThis.fetch = () => { requests++; return new Promise(resolve => { complete = resolve }) }
  t.after(() => { h.unmount(); globalThis.document = oldDocument; globalThis.fetch = oldFetch })
  const props = () => ({ cwd: '/fixture', repository: 'repo', value: 'src', preview, onPreview(value) { preview = value } })
  let rendered = h.render(props()), control = previewControl(rendered), origin = control.props.ref.current
  origin.focus(); control.props.onClick(); control.props.onClick()
  rendered = h.render(props()); control = previewControl(rendered)
  assert.equal(requests, 1)
  assert.equal(control.props.disabled, false)
  assert.equal(control.props['aria-disabled'], true)
  assert.equal(control.props['aria-busy'], true)
  assert.equal(h.doc.activeElement, origin)
  control.props.onClick()
  assert.equal(requests, 1)
  complete({ ok: outcome === 'success', status: 500, json: async () => outcome === 'success' ? result() : { status: 'error', error: 'preview unavailable' } })
  await tick(); rendered = h.render(props())
  assert.equal(previewControl(rendered).props['aria-busy'], false)
  assert.equal(h.doc.activeElement, origin)
  if (outcome === 'failure') assert.match(text(rendered), /范围预览失败：preview unavailable/)
  else assert.equal(preview?.preview_id, 'scope-preview')
})

test('preview completion does not steal focus when the user moves to another field', async t => {
  const h = focusHarness(), oldDocument = globalThis.document, oldFetch = globalThis.fetch
  globalThis.document = h.doc
  let complete, preview
  globalThis.fetch = () => new Promise(resolve => { complete = resolve })
  t.after(() => { h.unmount(); globalThis.document = oldDocument; globalThis.fetch = oldFetch })
  const props = () => ({ cwd: '/fixture', repository: 'repo', value: 'src', preview, onPreview(value) { preview = value } })
  let rendered = h.render(props()), control = previewControl(rendered)
  control.props.ref.current.focus(); control.props.onClick(); h.render(props())
  const anotherField = h.element(); anotherField.focus()
  complete({ ok: true, json: async () => result() }); await tick(); rendered = h.render(props())
  assert.equal(h.doc.activeElement, anotherField)
  assert.ok(preview)
})

test('a pagination control disabled by the last page returns focus to the stable preview entry', async t => {
  const h = focusHarness(), oldDocument = globalThis.document, oldFetch = globalThis.fetch
  globalThis.document = h.doc
  let complete, preview = result({ matched_file_count: 60, has_more: true })
  globalThis.fetch = () => new Promise(resolve => { complete = resolve })
  t.after(() => { h.unmount(); globalThis.document = oldDocument; globalThis.fetch = oldFetch })
  const props = () => ({ cwd: '/fixture', repository: 'repo', value: 'src', preview, onPreview(value) { preview = value } })
  const rendered = h.render(props()), next = rendered.find(node => node.type === 'button' && text(node) === '下一页')
  const origin = h.element(); origin.focus(); next.props.onClick(); h.render(props())
  complete({ ok: true, json: async () => result({ matched_file_count: 60, next_cursor: 100, has_more: false }) })
  await tick()
  origin.disabled = true; h.doc.activeElement = h.doc.body
  const done = h.render(props())
  assert.equal(h.doc.activeElement, previewControl(done).props.ref.current)
  assert.deepEqual(h.doc.activeElement.options, { preventScroll: true })
})
