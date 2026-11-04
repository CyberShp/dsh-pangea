import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const adapterPath = path.resolve(here, '..', 'src', 'product-model-adapter.js')
const buildPath = path.resolve(here, '..', 'scripts', 'build-client.mjs')

test('owns internal model settings entry inside the PANGEA product shell', async () => {
  const source = await readFile(adapterPath, 'utf8')
  assert.match(source, /data-pangea-tool-list/)
  assert.match(source, /data-pangea-native-model-settings/)
  assert.match(source, /打开模型与 API 设置/)
  assert.match(source, /pangea:open-model-settings/)
  assert.match(source, /pangea:model-onboarding-state/)
  assert.match(source, /pangea:query-model-onboarding/)
  assert.doesNotMatch(source, /选择模型提供方/)
  assert.match(source, /mode: 'internal'/)
})

test('hides the placeholder system-check status from product chrome', async () => {
  const source = await readFile(adapterPath, 'utf8')
  assert.match(source, /data-pangea-system-state/)
  assert.match(source, /display:none!important/)
})

test('build appends the product model adapter to the shipped client', async () => {
  const source = await readFile(buildPath, 'utf8')
  assert.match(source, /product-model-adapter\.js/)
  assert.match(source, /writeFile\(path\.join\(root, 'lib', 'client\.js'\)/)
})

async function mountAdapter({ dialogOpen = false } = {}) {
  const source = await readFile(adapterPath, 'utf8')
  const windowListeners = new Map(), bodyChildren = []
  let mutation
  function element(tagName) {
    const listeners = new Map()
    const node = {
      tagName, attrs: {}, children: [], style: {}, parent: null, textContent: '',
      get isConnected() { return Boolean(this.parent) },
      setAttribute(name, value) { this.attrs[name] = value },
      getAttribute(name) { return this.attrs[name] ?? null },
      append(...children) { for (const child of children) { child.parent = this; this.children.push(child) } },
      appendChild(child) { this.append(child); return child },
      addEventListener(name, callback) { listeners.set(name, callback) },
      remove() { const index = this.parent?.children.indexOf(this); if (index >= 0) this.parent.children.splice(index, 1); this.parent = null },
      click() { listeners.get('click')?.({ target: this }) },
      keydown(event) { listeners.get('keydown')?.(event) },
      focus() { document.activeElement = this },
      querySelector(selector) { return selector === 'button' ? findNode(this, child => child.tagName === 'button') : null },
      closest(selector) {
        if (selector === '[data-pangea-model-onboarding]') return this.attrs['data-pangea-model-onboarding'] ? this : this.parent?.closest?.(selector)
        return null
      },
      getClientRects() { return [{}] },
    }
    return node
  }
  const findNode = (node, predicate) => predicate(node) ? node : node.children.map(child => findNode(child, predicate)).find(Boolean)
  const shell = {}, externalDialog = element('section')
  externalDialog.setAttribute('role', 'dialog'); externalDialog.setAttribute('aria-modal', 'true')
  const document = {
    documentElement: {}, head: { appendChild() {} }, activeElement: null,
    body: { children: bodyChildren, appendChild(node) { node.parent = this; bodyChildren.push(node); return node } },
    getElementById() { return null }, createElement: element, createElementNS: element,
    querySelector(selector) {
      if (selector === '[data-pangea-shell]') return shell
      if (selector === '[data-pangea-model-onboarding]') return bodyChildren.find(node => node.attrs['data-pangea-model-onboarding'] === 'true') ?? null
      return null
    },
    querySelectorAll(selector) { return selector.includes('[role="dialog"]') ? bodyChildren.map(node => node.attrs.role === 'dialog' ? node : findNode(node, child => child.attrs.role === 'dialog')).filter(Boolean) : [] },
  }
  if (dialogOpen) document.body.appendChild(externalDialog)
  class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail } }
  class MutationObserver { constructor(callback) { mutation = callback } observe() {} }
  const window = { addEventListener(name, callback) { windowListeners.set(name, callback) }, dispatchEvent(event) { windowListeners.get(event.type)?.(event); return true } }
  runInNewContext(source, { window, document, CustomEvent, MutationObserver })
  return { document, element, externalDialog, reconcile: () => mutation(), publish: detail => windowListeners.get('pangea:model-onboarding-state')({ detail }), onboarding: () => document.querySelector('[data-pangea-model-onboarding]'), findNode }
}

test('keeps onboarding dismissal through loading until a model becomes usable', async () => {
  const { publish, onboarding, findNode } = await mountAdapter()
  publish({ required: true, modelAvailable: false, status: 'ready' })
  assert.ok(onboarding())
  findNode(onboarding(), node => node.textContent === '稍后配置').click()
  assert.equal(onboarding(), null)
  publish({ required: false, modelAvailable: false, status: 'loading' })
  publish({ required: true, modelAvailable: false, status: 'ready' })
  assert.equal(onboarding(), null)
  publish({ required: false, modelAvailable: true, status: 'ready' })
  publish({ required: true, modelAvailable: false, status: 'ready' })
  assert.ok(onboarding())
})

test('defers first model setup while another modal is open and resumes after it closes', async () => {
  const { publish, onboarding, externalDialog, reconcile, document } = await mountAdapter({ dialogOpen: true })
  publish({ required: true, modelAvailable: false, status: 'ready' })
  assert.equal(onboarding(), null)
  externalDialog.remove(); reconcile()
  assert.ok(onboarding())
  document.body.appendChild(externalDialog); externalDialog.focus(); reconcile()
  assert.equal(onboarding(), null)
  assert.equal(document.activeElement, externalDialog, 'deferred onboarding must not steal focus from the other dialog')
  externalDialog.remove(); reconcile()
  assert.ok(onboarding())
})

test('model setup supports keyboard dismissal and restores the previous focus', async () => {
  const { publish, onboarding, document, element, findNode } = await mountAdapter()
  const trigger = element('button'); document.body.appendChild(trigger); trigger.focus()
  publish({ required: true, modelAvailable: false, status: 'ready' })
  const card = findNode(onboarding(), node => node.attrs.role === 'dialog')
  const action = findNode(card, node => node.textContent === '打开模型与 API 设置')
  const later = findNode(card, node => node.textContent === '稍后配置')
  assert.equal(document.activeElement, action)
  let prevented = 0
  card.keydown({ key: 'Tab', shiftKey: true, preventDefault() { prevented++ } })
  assert.equal(document.activeElement, later)
  card.keydown({ key: 'Tab', shiftKey: false, preventDefault() { prevented++ } })
  assert.equal(document.activeElement, action)
  card.keydown({ key: 'Escape', preventDefault() { prevented++ } })
  assert.equal(onboarding(), null)
  assert.equal(document.activeElement, trigger)
  assert.equal(prevented, 3)
})
