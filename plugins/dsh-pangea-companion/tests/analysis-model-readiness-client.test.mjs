import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

function scopePreviewFixture(states, cwd = '/workspace') {
  const form = states[33]
  if (!form?.source_scope_text?.trim()) return null
  return { key: JSON.stringify([cwd, states[1]?.data_root, form.repository, form.source_scope_text]), preview_state: 'complete', matched_file_count: 1, preview_id: 'verified-scope-fixture', scope_revision: 'scope-fixture-v1', files: [{ relative_path: 'request.c' }] }
}

const clientSource = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const tick = () => new Promise(resolve => setImmediate(resolve))
const providers = [{ id: 'pangea-nga', label: 'NGA', registered: true }, { id: 'pangea-codeagent', label: 'CodeAgent', registered: true }]
const catalog = (provider_id = 'pangea-nga', current_model = 'native', models = [{ id: 'native', label: 'Native' }]) => ({ status: 'ok', provider_id, catalog_id: `receipt-${provider_id}`, current_model, models })
const readyState = (value = catalog(), cwd = '/workspace') => ({ cwd, provider_id: value.provider_id, status: 'ready', catalog: value })
const baseReact = { createElement(type, props, ...children) { return { type, props: props ?? {}, children } }, Fragment: Symbol('Fragment'), useState(initial) { return [initial, () => {}] }, useCallback(fn) { return fn }, useEffect() {}, useRef(initial) { return { current: initial } } }
function load(react = baseReact, fetcher = () => { throw new Error('unexpected fetch') }, windowProperties = {}) {
  let client
  const sandbox = { URLSearchParams, AbortController, console, fetch: fetcher, setInterval, clearInterval, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail } } }
  sandbox.window = { dispatchEvent() {}, setInterval, clearInterval, setTimeout: (...args) => setTimeout(...args).unref(), clearTimeout, ...windowProperties,
    __ModuleLoader__: { load(spec) { client = spec.factory(name => name === 'react' ? react : {}) } } }
  vm.runInNewContext(clientSource, sandbox)
  return client
}
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes)
  if (node?.type?.name === 'AgentModelSelect') return nodes(node.type(node.props))
  return node?.children ? [node, ...node.children.flatMap(nodes)] : []
}
function harness({ providerId = 'pangea-nga', state, storage, selectionEffects = false } = {}) {
  const states = { 1: { compatibility: { compatible: true }, capabilities: { repositories: ['repo'] }, acp_providers: providers }, 16: { type: 'create', createStep: 3 },
    33: { repository: 'repo', target: 'TLS', source_scope_text: '.', asset_ids: [], scenario: 'module-analysis', mode: 'depth', provider_id: providerId, agent_model: '' }, ...(state ? { 82: state } : {}) }
  let index = 0, effectDeps, cleanup, pendingEffect
  const calls = []
  const react = { ...baseReact, useState(initial) { const key = index++; if (key === 91 && initial === null) initial = scopePreviewFixture(states); if (!(key in states)) states[key] = initial; return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value }] },
    useEffect(fn, deps) {
      if (selectionEffects && (String(fn).includes('const saved = JSON.parse(window.localStorage') || String(fn).includes('const options = workbench?.acp_providers'))) { fn(); return }
      if (!String(fn).includes('return loadAnalysisAgentModels')) return
      if (effectDeps && deps.every((value, i) => value === effectDeps[i])) return
      cleanup?.(); effectDeps = deps; pendingEffect = () => { cleanup = fn() }
    } }
  const client = load(react, (url, options) => new Promise((resolve, reject) => calls.push({ body: JSON.parse(options.body), signal: options.signal, resolve, reject })), { localStorage: storage })
  const pages = [], ctx = { pangea: { registerPage(page) { pages.push(page) } }, effect(fn) { return fn() } }; client.apply(ctx)
  let cwd = '/workspace'
  return { client, states, calls, setCwd(value) { cwd = value }, cleanup() { cleanup?.() },
    render() { index = 0; const panel = pages.find(page => page.id === 'analysis').component({ ctx, scope: { cwd }, visible: true }); const rendered = nodes(panel.type(panel.props)); const effect = pendingEffect; pendingEffect = undefined; effect?.(); return rendered },
    async reply(call, value) { call.resolve({ ok: true, json: async () => value }); await tick() } }
}
const button = (tree, label) => tree.find(node => node.type === 'button' && node.children.includes(label))

test('model readiness requires a completed matching catalog and concrete listed model, including Agent default', () => {
  const client = load(), form = { provider_id: 'pangea-nga', agent_model: '' }
  for (const state of [undefined, { status: 'loading' }, { ...readyState(), status: 'error', error: 'timeout' }, readyState(catalog(), '/other'), readyState(catalog('pangea-codeagent')), readyState(catalog('pangea-nga', null, [])), readyState(catalog('pangea-nga', 'absent')), readyState({ ...catalog(), catalog_id: null })]) {
    assert.equal(client.analysisExecutionState(form, providers, state, '/workspace').ready, false)
  }
  const accepted = client.analysisExecutionState(form, providers, readyState(), '/workspace')
  assert.equal(accepted.ready, true); assert.equal(accepted.model, 'native'); assert.equal(accepted.catalogId, 'receipt-pangea-nga')
  assert.equal(client.analysisExecutionState({ ...form, agent_model: 'removed' }, providers, readyState(), '/workspace').ready, false)
  assert.equal(client.analysisExecutionState(form, [{ ...providers[0], registered: false }], readyState(), '/workspace').ready, false)
})

test('pending discovery blocks next, wizard navigation and direct submit, then freezes the verified default across steps', async () => {
  const h = harness()
  let tree = h.render()
  assert.equal(button(tree, '下一步 · 确认创建').props.disabled, true)
  assert.equal(button(tree, '下一步 · 确认创建').props.onClick, undefined)
  const confirm = tree.find(node => node.props.className?.includes('wizard-step') && node.children.includes('确认创建'))
  assert.equal(confirm.props.disabled, true)
  confirm.props.onClick(); assert.equal(h.states[16].createStep, 3)
  h.states[16] = { type: 'create', createStep: 4 }
  tree = h.render(); assert.equal(button(tree, '创建并开始分析').props.disabled, true); button(tree, '创建并开始分析').props.onClick(); await tick()
  assert.equal(h.calls.length, 1, 'blocked submit must not create a task')
  await h.reply(h.calls[0], catalog())
  tree = h.render()
  assert.equal(h.calls.length, 1, 'confirmation page must retain the completed catalog')
  assert.match(JSON.stringify(tree), /native（Agent 默认，已确认）/)
  assert.equal(button(tree, '创建并开始分析').props.disabled, false)
  const submit = button(tree, '创建并开始分析').props.onClick
  h.states[82].status = 'loading'; submit(); await tick()
  assert.equal(h.calls.length, 1, 'submit handler independently checks current readiness')
  h.states[82].status = 'ready'; submit()
  assert.equal(h.calls[1].body.action, 'task-create')
  assert.equal(h.calls[1].body.input.agent_model, 'native')
  assert.equal(h.calls[1].body.input.agent_catalog_id, 'receipt-pangea-nga')
  assert.equal(h.calls[1].body.input.model_route, null)
  h.calls[1].resolve({ ok: false, json: async () => ({ status: 'error', error: 'fixture stopped after verified create request' }) }); await tick()
  h.cleanup()
})

test('failed, empty and invalid-default catalogs stay blocked; explicit listed model can repair unknown default', async () => {
  const h = harness(); h.render(); h.calls[0].reject(new Error('probe failed')); await tick()
  let tree = h.render(); assert.equal(button(tree, '下一步 · 确认创建').props.disabled, true); assert.match(JSON.stringify(tree), /probe failed/)
  button(tree, '刷新模型').props.onClick(); tree = h.render()
  assert.equal(button(tree, '下一步 · 确认创建').props.disabled, true)
  await h.reply(h.calls[1], catalog('pangea-nga', null, [])); tree = h.render()
  assert.equal(button(tree, '下一步 · 确认创建').props.disabled, true)
  button(tree, '刷新模型').props.onClick(); h.render()
  await h.reply(h.calls[2], catalog('pangea-nga', 'missing')); tree = h.render()
  assert.equal(button(tree, '下一步 · 确认创建').props.disabled, true)
  tree.find(node => node.props['aria-label'] === 'Agent 模型').props.onChange({ target: { value: 'native' } })
  tree = h.render(); assert.equal(button(tree, '下一步 · 确认创建').props.disabled, false)
  button(tree, '刷新模型').props.onClick(); tree = h.render()
  assert.equal(button(tree, '下一步 · 确认创建').props.disabled, true, 'refresh clears old readiness before response')
  h.cleanup()
})

test('rapid Agent switches and workspace changes ignore late responses even when fetch ignores abort', async () => {
  const h = harness(); let tree = h.render()
  tree.find(node => node.props['aria-label'] === '外部 Agent').props.onChange({ target: { value: 'pangea-codeagent' } })
  tree = h.render(); assert.equal(h.calls[0].signal.aborted, true)
  await h.reply(h.calls[1], catalog('pangea-codeagent'))
  await h.reply(h.calls[0], catalog('pangea-nga'))
  tree = h.render(); assert.equal(h.states[82].provider_id, 'pangea-codeagent'); assert.equal(button(tree, '下一步 · 确认创建').props.disabled, false)
  button(tree, '刷新模型').props.onClick(); h.render()
  h.setCwd('/other'); tree = h.render(); assert.equal(button(tree, '下一步 · 确认创建').props.disabled, true)
  await h.reply(h.calls[2], catalog('pangea-codeagent'))
  assert.equal(h.states[82].cwd, '/other'); assert.equal(h.states[82].status, 'loading')
  await h.reply(h.calls[3], catalog('pangea-codeagent'))
  assert.equal(button(h.render(), '下一步 · 确认创建').props.disabled, false)
  h.cleanup()
})

test('new analysis removes internal API controls even with configured internal credentials, while historical analysis remains readable', () => {
  const h = harness({ providerId: '' }); h.states[1].model_routing = { status: 'ok', models: [{ provider: 'openai', model: 'internal', credential_configured: true }] }
  const tree = h.render()
  assert.equal(tree.some(node => node.props.id === 'create-builtin' || node.props['aria-label'] === '模型' || node.props['aria-label'] === '推理级别'), false)
  assert.equal(button(tree, '下一步 · 确认创建').props.disabled, true)
  assert.equal(h.client.buildAnalysisRequest({ model_route_key: 'openai/internal' }).model_route, null)
  const task = { provider: null, run_id: 'old', can_resume: true, status: 'stopped' }
  const presentation = h.client.deriveRunPresentation(task, { run_id: 'old', lifecycle_status: 'stopped', terminal: true }, null)
  assert.equal(presentation.canResume, false); assert.match(presentation.resumeBlockedReason, /内部 API 分析已停用/)
  h.cleanup()
})


test('saved internal analysis settings fall back to a registered external Agent, while a copied internal task requires an explicit choice', async () => {
  const h = harness({ providerId: '', selectionEffects: true, storage: { getItem(key) { return key.startsWith('pangea-execution:') ? JSON.stringify({ provider_id: '', model_route: { provider: 'api', model: 'internal' } }) : 'unregistered-history' }, setItem() {} } })
  h.render(); assert.equal(h.states[33].provider_id, 'pangea-nga'); assert.equal(h.states[33].agent_model, '')
  h.render(); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].body.provider_id, 'pangea-nga')
  h.states[33] = { ...h.states[33], source_task_id: 'internal-task', provider_id: '', external_selection_required: true }
  const tree = h.render(); assert.equal(h.states[33].provider_id, ''); assert.equal(button(tree, '下一步 · 确认创建').props.disabled, true)
  assert.match(JSON.stringify(tree), /历史分析使用内部 API/)
  h.cleanup()
})
