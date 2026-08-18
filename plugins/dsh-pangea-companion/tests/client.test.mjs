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

test('better-sidebar client registers one PANGEA single tab and exposes Chinese health/navigation affordances', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /总览/)
  assert.match(source, /风险/)
  assert.match(source, /用例/)
  assert.match(source, /证据/)
  assert.match(source, /复核/)
  assert.match(source, /← 返回/)
  assert.match(source, /数据状态/)
  assert.match(source, /数据读取异常/)
  assert.match(source, /当前结构化结果不可信/)
  assert.match(source, /不能把空列表解释为/)
  assert.doesNotMatch(source, /Current Run|Recent Runs|Refreshing/)

  let exported
  const sandbox = { URLSearchParams, console, fetch: async () => { throw new Error('fetch must not run during registration') }, setInterval, clearInterval }
  sandbox.window = {
    setInterval, clearInterval,
    __ModuleLoader__: {
      load(spec) {
        const require = name => {
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
  exported.apply({
    betterSidebar: { registerTab(tab) { tabs.push(tab); return () => {} } },
    effect(factory) { return factory() },
  })
  assert.equal(tabs.length, 1)
  assert.equal(tabs[0].id, 'dsh-pangea-companion:pangea')
  assert.equal(tabs[0].single, true)
  assert.equal(tabs[0].title(), 'PANGEA')
})
