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

test('registers one asset catalog tab and keeps the boundary visible', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /资产目录/)
  assert.match(source, /生成目录文件/)
  assert.match(source, /不修改 PANGEA、Run、原始资产或任何分析决策/)
  assert.match(source, /方法论候选/)
  assert.match(source, /自动化能力/)

  let exported
  const sandbox = { URLSearchParams, AbortController, console, fetch: async () => { throw new Error('fetch must not run') } }
  sandbox.window = {
    __ModuleLoader__: {
      load(spec) {
        exported = spec.factory(name => {
          if (name === 'react') return fakeReact()
          throw new Error(`unexpected require: ${name}`)
        })
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
  assert.equal(tabs[0].id, 'dsh-pangea-asset-catalog:assets')
  assert.equal(tabs[0].title(), '资产目录')
  assert.equal(tabs[0].single, true)
})

test('client requests preview and explicit generation separately', async () => {
  const source = await readFile(clientPath, 'utf8')
  let exported
  const sandbox = { URLSearchParams, AbortController, console, fetch: async () => { throw new Error('default fetch must not run') } }
  sandbox.window = { __ModuleLoader__: { load(spec) { exported = spec.factory(() => fakeReact()) } } }
  vm.runInNewContext(source, sandbox, { filename: clientPath })

  const calls = []
  const fetcher = async (url, options = {}) => {
    calls.push({ url, options })
    return { ok: true, status: 200, async json() { return { status: 'ok', assets: [], counts: {} } } }
  }
  await exported.requestState({ cwd: '/tmp/workspace', fetcher })
  await exported.requestAction({ cwd: '/tmp/workspace', action: 'generate', fetcher })
  assert.equal(calls[0].options.method, undefined)
  assert.equal(calls[1].options.method, 'POST')
  assert.deepEqual(JSON.parse(calls[1].options.body), { action: 'generate' })
})
