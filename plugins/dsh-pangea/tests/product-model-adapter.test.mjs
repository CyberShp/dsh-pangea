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

test('keeps onboarding dismissal through loading until a model becomes usable', async () => {
  const source = await readFile(adapterPath, 'utf8')
  const windowListeners = new Map()
  const bodyChildren = []
  const shell = {}

  function element(tagName) {
    const listeners = new Map()
    const node = {
      tagName,
      attrs: {},
      children: [],
      style: {},
      parent: null,
      textContent: '',
      setAttribute(name, value) { this.attrs[name] = value },
      append(...children) {
        for (const child of children) { child.parent = this; this.children.push(child) }
      },
      appendChild(child) { child.parent = this; this.children.push(child); return child },
      addEventListener(name, callback) { listeners.set(name, callback) },
      remove() {
        if (!this.parent) return
        const index = this.parent.children.indexOf(this)
        if (index >= 0) this.parent.children.splice(index, 1)
        this.parent = null
      },
      click() { listeners.get('click')?.({ target: this }) },
    }
    return node
  }

  const document = {
    documentElement: {},
    head: { appendChild() {} },
    body: {
      children: bodyChildren,
      appendChild(node) { node.parent = this; bodyChildren.push(node); return node },
    },
    getElementById() { return null },
    createElement: element,
    createElementNS: element,
    querySelector(selector) {
      if (selector === '[data-pangea-shell]') return shell
      if (selector === '[data-pangea-model-onboarding]') return bodyChildren.find(node => node.attrs['data-pangea-model-onboarding'] === 'true') ?? null
      return null
    },
    querySelectorAll() { return [] },
  }
  class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail }
  }
  class MutationObserver { observe() {} }
  const window = {
    addEventListener(name, callback) { windowListeners.set(name, callback) },
    dispatchEvent(event) { windowListeners.get(event.type)?.(event); return true },
  }

  runInNewContext(source, { window, document, CustomEvent, MutationObserver })
  const publish = detail => windowListeners.get('pangea:model-onboarding-state')({ detail })
  const onboarding = () => document.querySelector('[data-pangea-model-onboarding]')
  const findNode = (node, predicate) => predicate(node) ? node : node.children.map(child => findNode(child, predicate)).find(Boolean)

  publish({ required: true, modelAvailable: false, status: 'ready' })
  const firstPrompt = onboarding()
  assert.ok(firstPrompt)
  const later = findNode(firstPrompt, node => node.textContent === '稍后配置')
  assert.ok(later)
  later.click()
  assert.equal(onboarding(), null)

  publish({ required: false, modelAvailable: false, status: 'loading' })
  publish({ required: true, modelAvailable: false, status: 'ready' })
  assert.equal(onboarding(), null)

  publish({ required: false, modelAvailable: true, status: 'ready' })
  publish({ required: true, modelAvailable: false, status: 'ready' })
  assert.ok(onboarding())
})
