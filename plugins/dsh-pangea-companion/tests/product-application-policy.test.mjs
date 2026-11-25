import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientPath = path.resolve(here, '..', 'lib', 'client.js')

test('workbench exposes analysis, test assets, and live verification while agent-runtime stays internal', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /\['ScanLine', '分析任务', [^\]]+, 'analysis'\]/)
  assert.match(source, /\['Library', '测试资产', [^\]]+, 'assets'\]/)
  assert.doesNotMatch(source, /\[[^\]]*'环境配置'[^\]]*'execution'\]/)
  assert.match(source, /id: 'execution', title: \(\) => '真机核验'/)
  assert.match(source, /available: \(\) => false/)
})
