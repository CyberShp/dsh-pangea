import assert from 'node:assert/strict'
import test from 'node:test'
import { registerDialog, createDialogLifecycle } from '../src/result-drawers.js'

// Small DOM contract harness: focus triggers document focusin, inert suppresses
// focus, and keyboard listeners receive events from outside the dialog too.
function documentFixture() {
  const listeners = new Map()
  const doc = {
    addEventListener(type, listener) { const set = listeners.get(type) || new Set(); set.add(listener); listeners.set(type, set) },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener) },
    dispatch(type, event) { for (const listener of [...(listeners.get(type) ?? [])]) listener(event) },
    listenerCount() { return [...listeners.values()].reduce((count, set) => count + set.size, 0) },
  }
  function node(name, parent, { disabled = false } = {}) {
    const value = { name, ownerDocument: doc, parent, children: [], isConnected: true, inert: false, disabled,
      closest() { for (let current = this; current; current = current.parent) if (current.inert) return current; return null },
      contains(other) { for (let current = other; current; current = current.parent) if (current === this) return true; return false },
      getClientRects() { return this.isConnected && !this.closest() ? [{}] : [] },
      querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll()]).filter(child => !child.disabled) },
      focus(options) { if (!this.getClientRects().length) return; this.lastFocusOptions = options; doc.activeElement = this; doc.dispatch('focusin', { target: this }) },
    }
    parent?.children.push(value)
    return value
  }
  doc.body = node('body'); doc.body.style = { overflow: 'auto' }; doc.activeElement = doc.body
  const key = (name, shiftKey = false) => {
    const event = { key: name, shiftKey, prevented: false, stopped: false, preventDefault() { this.prevented = true }, stopPropagation() { this.stopped = true } }
    doc.dispatch('keydown', event); return event
  }
  return { doc, node, key }
}

test('nested dialog restores its trigger and Escape then closes the parent', () => {
  const { doc, node, key } = documentFixture()
  const trigger = node('open basis', doc.body), basis = node('basis', doc.body)
  const basisClose = node('basis close', basis), sourceTrigger = node('open source', basis)
  trigger.focus()
  let closeBasis, closeSource
  closeBasis = registerDialog({ element: basis, onClose: () => closeBasis() })
  assert.equal(doc.activeElement, basisClose)
  sourceTrigger.focus()
  // Applying inert may blur the trigger before the child's passive effect.
  basis.inert = true; doc.activeElement = doc.body
  const source = node('source', doc.body), sourceClose = node('source close', source)
  closeSource = registerDialog({ element: source, onClose: () => { basis.inert = false; closeSource(); source.isConnected = false } })
  assert.equal(doc.activeElement, sourceClose)
  assert.equal(doc.body.style.overflow, 'hidden')
  const first = key('Escape')
  assert.equal(first.prevented, true)
  assert.equal(doc.activeElement, sourceTrigger)
  assert.deepEqual(sourceTrigger.lastFocusOptions, { preventScroll: true })
  assert.equal(doc.body.style.overflow, 'hidden')
  key('Escape')
  assert.equal(doc.activeElement, trigger)
  assert.equal(doc.body.style.overflow, 'auto')
  assert.equal(doc.listenerCount(), 0)
})

test('Tab is trapped in the top dialog and skips disabled controls', () => {
  const { doc, node, key } = documentFixture()
  const outside = node('outside', doc.body), dialog = node('dialog', doc.body)
  const first = node('first', dialog), disabled = node('disabled', dialog, { disabled: true }), last = node('last', dialog)
  outside.focus()
  const close = registerDialog({ element: dialog })
  assert.equal(doc.activeElement, first)
  key('Tab', true)
  assert.equal(doc.activeElement, last)
  key('Tab')
  assert.equal(doc.activeElement, first)
  outside.focus()
  assert.equal(doc.activeElement, first)
  disabled.focus()
  // Native browsers do not focus disabled elements; the query still excludes it.
  last.focus(); key('Tab')
  assert.equal(doc.activeElement, first)
  close()
})

test('outside focus does not strand Escape and a removed trigger falls back to the parent', () => {
  const { doc, node, key } = documentFixture()
  const parent = node('parent', doc.body), parentClose = node('parent close', parent), trigger = node('trigger', parent)
  const closeParent = registerDialog({ element: parent })
  trigger.focus()
  const child = node('child', doc.body); node('child close', child)
  let closeChild
  closeChild = registerDialog({ element: child, onClose: () => closeChild() })
  trigger.isConnected = false
  doc.activeElement = doc.body
  key('Escape')
  assert.equal(doc.activeElement, parentClose)
  closeParent(); closeParent()
  assert.equal(doc.listenerCount(), 0)
})

test('removing a parent before its child keeps the child modal and preserves scroll lock', () => {
  const { doc, node } = documentFixture()
  const trigger = node('trigger', doc.body), parent = node('parent', doc.body), parentButton = node('parent button', parent)
  trigger.focus()
  const closeParent = registerDialog({ element: parent })
  const child = node('child', doc.body), childButton = node('child button', child)
  const closeChild = registerDialog({ element: child })
  closeParent(); parent.isConnected = false; parentButton.isConnected = false
  assert.equal(doc.activeElement, childButton)
  assert.equal(doc.body.style.overflow, 'hidden')
  closeChild()
  assert.equal(doc.body.style.overflow, 'auto')
  assert.equal(doc.listenerCount(), 0)
})


function hookHarness() {
  const refs = [], effects = [], queued = []
  let refIndex = 0, effectIndex = 0
  const React = {
    useRef(value) { const index = refIndex++; return refs[index] ||= { current: value } },
    useEffect(callback, dependencies) {
      const index = effectIndex++, previous = effects[index]
      const changed = !previous || !dependencies || dependencies.some((value, i) => value !== previous.dependencies?.[i])
      if (changed) queued.push(() => { previous?.cleanup?.(); effects[index] = { dependencies, cleanup: callback() } })
    },
  }
  const useDialog = createDialogLifecycle(React)
  return {
    render(props) { refIndex = 0; effectIndex = 0; useDialog(props) },
    flush() { for (const effect of queued.splice(0)) effect() },
    unmount() { for (const effect of effects) effect?.cleanup?.() },
  }
}

test('dialog hook releases focus listeners and scroll lock when its rendered ref disappears', () => {
  const { doc, node } = documentFixture(), harness = hookHarness()
  const trigger = node('trigger', doc.body), element = node('dialog', doc.body)
  node('close', element)
  const root = { current: element }
  trigger.focus()
  harness.render({ root, open: true }); harness.flush()
  assert.equal(doc.body.style.overflow, 'hidden')
  root.current = null; element.isConnected = false
  // Open has not changed, but the render condition no longer includes a dialog.
  harness.render({ root, open: true }); harness.flush()
  assert.equal(doc.body.style.overflow, 'auto')
  assert.equal(doc.listenerCount(), 0)
  assert.equal(doc.activeElement, trigger)
  harness.unmount()
})

test('dialog hook attaches a later mounted ref and polling does not reset focus', () => {
  const { doc, node, key } = documentFixture(), harness = hookHarness()
  const trigger = node('trigger', doc.body), root = { current: null }
  trigger.focus()
  harness.render({ root, open: true }); harness.flush()
  assert.equal(doc.listenerCount(), 0)
  const element = node('dialog', doc.body), first = node('first', element), last = node('last', element)
  root.current = element
  let closed = ''
  harness.render({ root, open: true, onClose: () => { closed = 'old' } }); harness.flush()
  assert.equal(doc.activeElement, first)
  last.focus()
  harness.render({ root, open: true, onClose: () => { closed = 'latest' } }); harness.flush()
  assert.equal(doc.activeElement, last)
  assert.equal(doc.listenerCount(), 2)
  key('Escape')
  assert.equal(closed, 'latest')
  harness.unmount()
  assert.equal(doc.activeElement, trigger)
  assert.equal(doc.body.style.overflow, 'auto')
  assert.equal(doc.listenerCount(), 0)
})

test('a removed focused control is restored on commit only by the top dialog', () => {
  const { doc, node } = documentFixture(), parent = hookHarness(), child = hookHarness()
  const trigger = node('trigger', doc.body), parentElement = node('parent', doc.body)
  node('parent close', parentElement)
  const childTrigger = node('open session', parentElement), parentRoot = { current: parentElement }
  trigger.focus()
  parent.render({ root: parentRoot }); parent.flush()
  childTrigger.focus()
  const childElement = node('session', doc.body), childClose = node('session close', childElement)
  const wholeSession = node('show whole session', childElement), childRoot = { current: childElement }
  child.render({ root: childRoot }); child.flush()
  wholeSession.focus()
  wholeSession.isConnected = false
  doc.activeElement = doc.body
  parent.render({ root: parentRoot }); parent.flush()
  assert.equal(doc.activeElement, doc.body, 'a parent render cannot steal its child dialog focus')
  child.render({ root: childRoot }); child.flush()
  assert.equal(doc.activeElement, childClose)
  assert.deepEqual(childClose.lastFocusOptions, { preventScroll: true })
  parent.render({ root: parentRoot }); parent.flush()
  assert.equal(doc.activeElement, childClose)
  child.unmount()
  assert.equal(doc.activeElement, childTrigger)
  parent.unmount()
  assert.equal(doc.activeElement, trigger)
  assert.equal(doc.listenerCount(), 0)
})
