import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientPath = path.resolve(here, '..', 'lib', 'client.js')

test('workbench exposes analysis and test assets instead of environment configuration', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /appCard\('analysis', 'PANGEA 分析'/)
  assert.match(source, /appCard\('assets', '测试资产'/)
  assert.doesNotMatch(source, /appCard\('environment', '环境配置'/)
  assert.doesNotMatch(source, /id: 'execution', title: \(\) => '环境配置'/)
})
