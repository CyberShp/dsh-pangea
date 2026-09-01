import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../src/client-native.js', import.meta.url), 'utf8')
const build = await readFile(new URL('../scripts/build-client.mjs', import.meta.url), 'utf8')
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

test('native client is the packaged client entry', () => {
  assert.equal(pkg.exports['./client'], './lib/client.js')
  assert.match(build, /client-native\.js/)
  assert.match(build, /lib', 'client\.js/)
})

test('assistant is isolated from the analysis conversation', () => {
  assert.match(source, /active && active\.kind !== 'analysis'/)
  assert.match(source, /filter\(item => item\.kind === 'analysis'\)/)
  assert.match(source, /option\.disabled = blocked/)
  assert.match(source, /独立会话 · 不影响正在运行的分析/)
})

test('workflow overview mounts before the native Action lifecycle card', () => {
  assert.match(source, /text === 'Action 生命周期'/)
  assert.match(source, /card\.parentElement\.insertBefore\(next, card\)/)
  assert.match(source, /完整流程/)
  assert.match(source, /当前阶段：/)
})

test('task overview exposes persistent launch diagnostics before retry', () => {
  assert.match(source, /LAUNCH_LOG_API_PATH/)
  assert.match(source, /启动诊断/)
  assert.match(source, /日志文件：/)
  assert.match(source, /taskOverviewCard/)
  assert.match(source, /card\.insertBefore\(next, retry \?\? null\)/)
  assert.match(source, /pangea_run_create: '创建 PANGEA Run'/)
})

test('current workflow stage uses a blue pulse while failures stay red', () => {
  assert.match(source, /@keyframes pangeaNativeStagePulse/)
  assert.match(source, /is-active \.pangea-native-dot \{ border-color:#2f7acb; background:#2f7acb;/)
  assert.match(source, /is-failed \.pangea-native-dot \{ border-color:#c7000b; background:#c7000b;/)
})

test('rework stages remain conditional', () => {
  assert.match(source, /value\?\.has_rework \? \['定向补齐', '再复核'\] : \[\]/)
})

test('worker diagnostics are embedded into native analysis unit details', () => {
  assert.match(source, /分析单元/)
  assert.match(source, /Worker 执行轨迹/)
  assert.match(source, /result_path/)
  assert.match(source, /查看 Agent 结构化输出/)
})

test('assistant card no longer exposes the misleading progress element', () => {
  assert.match(source, /\[data-pangea-assistant-progress\]/)
  assert.match(source, /display:none!important/)
})
