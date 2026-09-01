import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')

test('assistant is isolated from the analysis conversation', () => {
  assert.match(source, /active && active\.kind !== 'analysis'/)
  assert.match(source, /filter\(item => item\.kind === 'analysis'\)/)
  assert.match(source, /option\.disabled = isAnalysis/)
  assert.match(source, /独立会话 · 不影响正在运行的分析/)
})

test('rework stages are rendered only after rework exists', () => {
  assert.match(source, /output\?\.has_rework \? \['定向补齐', '再复核'\] : \[\]/)
  assert.match(source, /当前未触发定向补齐，因此不展示返工相关阶段/)
})

test('assistant card no longer exposes the misleading progress element', () => {
  assert.match(source, /\[data-pangea-assistant-progress\]/)
  assert.match(source, /display:none!important/)
})
