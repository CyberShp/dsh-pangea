import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const adapterPath = path.resolve(here, '..', 'src', 'product-model-adapter.js')
const buildPath = path.resolve(here, '..', 'scripts', 'build-client.mjs')

test('owns model settings entry inside the PANGEA product shell', async () => {
  const source = await readFile(adapterPath, 'utf8')
  assert.match(source, /data-pangea-tool-list/)
  assert.match(source, /data-pangea-native-model-settings/)
  assert.match(source, /自定义 \/ 内部模型提供方/)
  assert.match(source, /pangea:open-model-settings/)
  assert.match(source, /pangea:model-onboarding-state/)
  assert.match(source, /pangea:query-model-onboarding/)
})

test('build appends the product model adapter to the shipped client', async () => {
  const source = await readFile(buildPath, 'utf8')
  assert.match(source, /product-model-adapter\.js/)
  assert.match(source, /writeFile\(path\.join\(root, 'lib', 'client\.js'\)/)
})
