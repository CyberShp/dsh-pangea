import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { createFaultInjectionPanel } from '../src/fault-injection-view.js'
const window = new Window({ url: 'http://localhost/' })
for (const key of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Event', 'MouseEvent']) Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'), { createRoot } = await import('react-dom/client'), { act } = React
const calls = []
let catalogMode = 'ready'
globalThis.fetch = async (url, options = {}) => {
  const body = options.body ? JSON.parse(options.body) : null
  calls.push(body)
  if (body?.action === 'models') {
    if (catalogMode === 'error') return Response.json({ status: 'error', error: '刷新模型：连接失败' }, { status: 400 })
    return Response.json({ status: 'ok', provider_id: body.provider_id, catalog_id: `receipt-${body.provider_id}`, current_model: `${body.provider_id}/default`, models: catalogMode === 'empty' ? [] : [{ id: `${body.provider_id}/default` }, { id: `${body.provider_id}/other` }] })
  }
  if (body?.action === 'generate') return Response.json({ status: 'ok', task: { id: 'task', status: 'ready', repositories: [], case_keys: ['case'], cases: [], verification: [] } })
  return Response.json({ status: 'ok', tasks: [], providers: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], defaults: { provider_id: 'a', agent_model: 'old-analysis-model', repositories: [{ repo_id: 'repo', personal_branch: 'main', source: { kind: 'git', commit: 'a'.repeat(40) } }] } })
}
const container = document.createElement('div'); document.body.append(container)
const root = createRoot(container), Panel = createFaultInjectionPanel(React)
const findButton = text => [...container.querySelectorAll('button')].find(item => item.textContent.startsWith(text))
const click = async text => { const button = findButton(text); assert.ok(button, text); assert.equal(button.disabled, false); await act(async () => button.click()) }
const change = async (label, value) => { const select = container.querySelector(`[aria-label="${label}"]`); await act(async () => { select.value = value; select.dispatchEvent(new window.Event('change', { bubbles: true })) }) }
try {
  await act(async () => root.render(React.createElement(Panel, { runId: 'run', cwd: '/workspace', cases: [{ projection_id: 'case', title: 'case' }] })))
  await click('打开打桩工作区')
  assert.equal(container.querySelector('[aria-label="打桩模型"]').tagName, 'SELECT')
  assert.equal(findButton('生成打桩修改').disabled, false)
  await change('打桩模型', 'a/other')
  await change('打桩执行器', 'b')
  assert.equal(container.querySelector('[aria-label="打桩模型"]').value, '')
  assert.ok(calls.some(body => body?.action === 'models' && body.provider_id === 'b'))
  catalogMode = 'error'; await click('刷新模型')
  assert.equal(findButton('生成打桩修改').disabled, true); assert.match(container.textContent, /连接失败/)
  catalogMode = 'empty'; await click('刷新模型')
  assert.equal(findButton('生成打桩修改').disabled, true)
  catalogMode = 'ready'; await click('刷新模型'); await click('生成打桩修改')
  const sent = calls.find(body => body?.action === 'generate')
  assert.equal(sent.agent_catalog_id, 'receipt-b'); assert.equal(sent.agent_model, 'b/default')
  console.log('PASS: model dropdown, provider reset, blocked error/empty catalog and receipt payload in React DOM')
} finally { await act(async () => root.unmount()); window.happyDOM.abort() }
