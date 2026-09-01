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

test('Agent output is embedded in run details instead of a standalone page', () => {
  assert.match(source, /运行时间线/)
  assert.match(source, /Agent 分析/)
  assert.doesNotMatch(source, /registerPage\(\{[\s\S]*id: 'agent-output'/)
  assert.doesNotMatch(source, /当前未触发定向补齐/)
})

test('current workflow stage uses a blue pulse while failures stay red', () => {
  assert.match(source, /@keyframes pangeaStagePulse/)
  assert.match(source, /is-active \.pangea-stage-dot \{ border-color:#2f7acb; background:#2f7acb;/)
  assert.match(source, /is-failed \.pangea-stage-dot \{ border-color:#c7000b; background:#c7000b;/)
})

test('current stage failure is derived from PANGEA action status', () => {
  assert.match(source, /function currentStageActionTone/)
  assert.match(source, /output\.progress\.actions\.filter\(action => action\?\.role === role\)/)
  assert.match(source, /status === 'failed'/)
  assert.match(source, /if \(actionTone\) return actionTone/)
})

test('rework stages remain conditional', () => {
  assert.match(source, /output\?\.has_rework \? \['定向补齐', '再复核'\] : \[\]/)
  assert.match(source, /if \(output\?\.has_rework\) appendGroup\(card, '定向补齐'/)
})

test('asset catalog typography is normalized to the PANGEA product font', () => {
  assert.match(source, /body\[data-pangea-product-mode="assets"\]/)
  assert.match(source, /"Huawei Sans","HarmonyOS Sans SC","PingFang SC","Microsoft YaHei UI"/)
  assert.match(source, /font-size:13px!important/)
})

test('assistant card no longer exposes the misleading progress element', () => {
  assert.match(source, /\[data-pangea-assistant-progress\]/)
  assert.match(source, /display:none!important/)
})
