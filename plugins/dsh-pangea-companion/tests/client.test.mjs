import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientPath = path.resolve(here, '..', 'lib', 'client.js')

function fakeReact() {
  return {
    createElement(type, props, ...children) { return { type, props: props ?? {}, children } },
    Fragment: Symbol('Fragment'),
    useState(initial) { return [initial, () => {}] },
    useCallback(fn) { return fn },
    useEffect() {},
  }
}

test('better-sidebar client registers one PANGEA single tab', async () => {
  const source = await readFile(clientPath, 'utf8')
  let exported
  const sandbox = {
    URLSearchParams,
    console,
    fetch: async () => { throw new Error('fetch must not run during registration') },
    setInterval,
    clearInterval,
  }
  sandbox.window = {
    setInterval,
    clearInterval,
    __ModuleLoader__: {
      load(spec) {
        const require = (name) => {
          if (name === 'react') return fakeReact()
          throw new Error(`unexpected client require: ${name}`)
        }
        exported = spec.factory(require)
      },
    },
  }
  vm.runInNewContext(source, sandbox, { filename: clientPath })

  assert.deepEqual(Array.from(exported.inject), ['betterSidebar'])
  const tabs = []
  const effects = []
  exported.apply({
    betterSidebar: {
      registerTab(tab) {
        tabs.push(tab)
        return () => {}
      },
    },
    effect(factory, label) {
      effects.push(label)
      return factory()
    },
  })

  assert.equal(tabs.length, 1)
  assert.equal(tabs[0].id, 'dsh-pangea-companion:pangea')
  assert.equal(tabs[0].single, true)
  assert.equal(tabs[0].title(), 'PANGEA')
  assert.match(effects[0], /better-sidebar PANGEA tab/)
})
