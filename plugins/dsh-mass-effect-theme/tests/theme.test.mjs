import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function fakeElement(tagName) {
  return {
    tagName,
    id: '',
    innerHTML: '',
    textContent: '',
    style: {},
    attributes: {},
    removed: false,
    setAttribute(name, value) { this.attributes[name] = value },
    removeAttribute(name) { delete this.attributes[name] },
    remove() { this.removed = true },
  }
}

function createHarness(savedPreference) {
  const elements = new Map()
  const callbacks = new Map()
  const windowListeners = new Map()
  const frames = new Map()
  const storage = new Map()
  if (savedPreference) storage.set('dsh-mass-effect-theme:preference', savedPreference)

  const body = fakeElement('body')
  body.prepend = (element) => elements.set(element.id, element)
  body.append = (element) => elements.set(element.id, element)
  const documentElement = fakeElement('html')
  const head = { append: (element) => elements.set(element.id, element) }
  const document = {
    body,
    head,
    documentElement,
    createElement: fakeElement,
    getElementById(id) {
      const element = elements.get(id)
      return element?.removed ? null : element ?? null
    },
  }

  let frameId = 0
  let clientExports
  const window = {
    innerWidth: 1000,
    innerHeight: 800,
    localStorage: {
      getItem(key) { return storage.get(key) ?? null },
      setItem(key, value) { storage.set(key, value) },
    },
    matchMedia(query) {
      return { matches: query === '(pointer: fine)' }
    },
    requestAnimationFrame(callback) {
      const id = ++frameId
      frames.set(id, callback)
      return id
    },
    cancelAnimationFrame(id) { frames.delete(id) },
    addEventListener(name, callback) { windowListeners.set(name, callback) },
    removeEventListener(name) { windowListeners.delete(name) },
    __ModuleLoader__: {
      load(definition) {
        clientExports = definition.factory((id) => {
          if (id === 'react') {
            return {
              createElement: (...args) => ({ args }),
              useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
              useEffect: () => {},
            }
          }
          throw new Error(`Unexpected require: ${id}`)
        })
      },
    },
  }

  const code = fs.readFileSync(path.join(pluginRoot, 'lib', 'client.js'), 'utf8')
  vm.runInNewContext(code, { window, document, Symbol, Set })

  let activeTheme = 'system'
  let registeredTheme
  let settingsSection
  const ctx = {
    theme: {
      register(value) {
        registeredTheme = value
        return () => {}
      },
      setTheme(value) { activeTheme = value },
      getTheme() { return { preference: activeTheme } },
    },
    slots: {
      inject(name, factory) { factory() },
      register(definition, component) {
        settingsSection = { definition, component }
        return () => {}
      },
    },
    on(name, callback) {
      const list = callbacks.get(name) ?? []
      list.push(callback)
      callbacks.set(name, list)
      return () => callbacks.set(name, list.filter((item) => item !== callback))
    },
    effect(factory) { factory() },
  }

  const emitTheme = (preference) => {
    activeTheme = preference
    for (const callback of callbacks.get('theme/change') ?? []) callback({ preference })
  }

  return {
    body, clientExports, documentElement, elements, emitTheme, frames,
    get activeTheme() { return activeTheme },
    get registeredTheme() { return registeredTheme },
    get settingsSection() { return settingsSection },
    storage, windowListeners, ctx,
  }
}

test('applies a complete Normandy theme and allows native appearance switching', () => {
  const harness = createHarness()
  harness.clientExports.apply(harness.ctx)

  assert.equal(harness.clientExports.THEME_ID, 'normandy-command')
  assert.equal(Array.from(harness.clientExports.inject).join(','), 'slots,theme')
  assert.equal(harness.registeredTheme.id, 'normandy-command')
  assert.equal(harness.registeredTheme.colorScheme, 'dark')
  assert.ok(Object.keys(harness.registeredTheme.tokens).length >= 85)
  assert.equal(harness.registeredTheme.tokens['--dsw-alias-label-primary-foreground'], '#ffffff')
  assert.equal(harness.activeTheme, 'normandy-command')
  assert.equal(harness.body.attributes['data-normandy-command'], 'active')
  assert.match(harness.elements.get('dsh-normandy-command-backdrop').style.cssText, /data:image\/jpeg;base64,/)
  assert.match(harness.elements.get('dsh-normandy-command-badge').innerHTML, /NORMANDY/)
  assert.match(harness.elements.get('dsh-normandy-command-hud').innerHTML, /COMMAND LINK/)

  const themeCss = harness.elements.get('dsh-normandy-command-style').textContent
  assert.match(themeCss, /data-normandy-command/)
  assert.match(themeCss, /role='combobox'/)
  assert.match(themeCss, /COMMAND INPUT/)
  assert.match(themeCss, /prefers-reduced-motion/)
  assert.doesNotMatch(themeCss, /--dsw-alias-brand-primary:/)

  harness.emitTheme('light')
  assert.equal(harness.activeTheme, 'light')
  assert.equal(harness.body.attributes['data-normandy-command'], undefined)
  assert.equal(harness.elements.get('dsh-normandy-command-backdrop').removed, true)
  assert.equal(harness.storage.get('dsh-mass-effect-theme:preference'), 'light')

  harness.emitTheme('normandy-command')
  assert.equal(harness.body.attributes['data-normandy-command'], 'active')
  assert.equal(harness.storage.get('dsh-mass-effect-theme:preference'), 'normandy-command')
})

test('registers a Normandy settings section and keeps mouse parallax subtle', () => {
  const harness = createHarness('normandy-command')
  harness.clientExports.apply(harness.ctx)

  assert.equal(harness.settingsSection.definition.id, 'normandy-command')
  assert.equal(harness.settingsSection.definition.label, 'Normandy / 诺曼底')
  assert.equal(typeof harness.settingsSection.component, 'function')

  harness.windowListeners.get('pointermove')({ clientX: 0, clientY: 0 })
  for (const callback of harness.frames.values()) callback()
  const backdrop = harness.elements.get('dsh-normandy-command-backdrop')
  assert.match(backdrop.style.transform, /translate3d\(4\.00px, 4\.00px, 0\)/)
})

test('restores a saved built-in appearance without mounting decorations', () => {
  const harness = createHarness('dark')
  harness.clientExports.apply(harness.ctx)

  assert.equal(harness.activeTheme, 'dark')
  assert.equal(harness.elements.has('dsh-normandy-command-backdrop'), false)
  assert.equal(harness.body.attributes['data-normandy-command'], undefined)
})

test('package exposes the DSH Web client and required settings bundles', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8'))
  const patch = fs.readFileSync(path.join(pluginRoot, 'cordis.patch.yml'), 'utf8')

  assert.equal(packageJson.exports['./client'], './lib/client.js')
  assert.equal(packageJson.dsh.client.platform, 'web')
  assert.ok(packageJson.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings-general'))
  assert.match(patch, /name: dsh-mass-effect-theme/)
})
