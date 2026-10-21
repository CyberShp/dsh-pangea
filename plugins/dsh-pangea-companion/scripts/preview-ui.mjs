// Real browser rendering of shipped components against isolated deterministic fixtures.
import { createServer } from 'node:http'
import { readFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { caseReviewRouteHandler, exportRouteHandler, repositoryRouteHandler } from '../src/index.js'
import { uiWorkbenchFixture } from '../tests/fixtures/ui-workbench.mjs'

const plugin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const option = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1] }
const desktop = path.resolve(option('--desktop', path.join(plugin, '../../../pangea-desktop')))
const agent = path.resolve(option('--agent', path.join(desktop, '../pangea-agent')))
const tools = path.resolve(option('--tools', path.join(desktop, '../../visual-tools/node_modules')))
const hasFonts = await stat(path.join(tools, '@fontsource/noto-sans-sc/400.css')).then(() => true, () => false)
const require = createRequire(path.join(desktop, 'package.json'))
const { build } = require('esbuild')
const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'pangea-ui-preview-'))
await mkdir(path.join(dataRoot, 'repositories/storage/tls'), { recursive: true })
await Promise.all(Array.from({ length: 42 }, (_, index) => readFile(path.join(agent, 'AGENTS.md')).then(async () => {
  const { writeFile } = await import('node:fs/promises')
  await writeFile(path.join(dataRoot, 'repositories/storage/tls', index ? `unit-${index}.c` : 'handshake.c'), '/* UI verification fixture */\nint handshake(void) { return 0; }\n')
})))
const css = await readFile(path.join(plugin, '../dsh-pangea/src/product-ui.css'), 'utf8')
const uiSource = await readFile(path.join(plugin, '../dsh-pangea/src/ui-components.js'), 'utf8')
const bundle = await build({ stdin: { contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
${uiSource.replace(/^export /gm, '')}
const pages=[];const listeners=new Set();let draft={};let exported;const modules={};let mountVersion=0;
window.__ModuleLoader__={load(spec){const value=spec.factory(name=>name==='react'?React:{});modules[spec.id]=value;if(spec.id==='dsh-pangea-companion'){exported=value;window.pangeaClient=value}}};
const service={ui:createProductUi(React),registerPage(page){pages.push(page)},getRunDraft(){return draft},subscribeRunDraft(fn){listeners.add(fn);return()=>listeners.delete(fn)},updateRunDraft(patch){draft={...draft,...patch};listeners.forEach(fn=>fn())},subscribe(){return()=>{}},getProductState(){return{}},setProductState(){},selectTask(){},requestRunSelection(_scope,runId){this.updateRunDraft({intent:'select-run',runId,requestId:Date.now()})},requestRunCreation(){this.updateRunDraft({intent:'create',requestId:Date.now()});mount('create')},openPage(_scope,id){mount(id==='workbench'?'home':id==='environments'?'environment':id==='settings'?'settings':id==='assets'?'assets':'tasks',id==='workbench'?'home':'analysis')}};
const ctx={pangea:service,effect(fn){return fn()},sessions:{open(){}},workspaces:{}};
const root=createRoot(document.getElementById('app'));function mount(initialScreen='tasks',pageMode='analysis'){const key=++mountVersion;if(initialScreen==='assets')return root.render(React.createElement(pages.find(p=>p.id==='assets').component,{key,ctx,scope:{cwd:${JSON.stringify(agent)}},visible:true}));if(initialScreen==='settings')return root.render(React.createElement(modules['dsh-pangea'].SettingsPage,{key,service,scope:{cwd:${JSON.stringify(agent)}}}));root.render(React.createElement(exported.PangeaPanel,{key,ctx,scope:{cwd:${JSON.stringify(agent)}},visible:true,initialScreen,pageMode}))};
const load=src=>new Promise(resolve=>{const script=document.createElement('script');script.src=src;script.onload=resolve;document.body.appendChild(script)});(async()=>{await load('/shell.js');await load('/assets.js');await load('/client.js');modules['dsh-pangea-asset-catalog'].apply(ctx);exported.apply(ctx);window.previewMount=mount;mount();})();
window.addEventListener('pangea:query-model-onboarding',()=>window.dispatchEvent(new CustomEvent('pangea:model-onboarding-state',{detail:{status:'ready',connections:[],modelAvailable:false,customAvailable:true}})));
window.addEventListener('pangea:open-assistant',()=>{document.body.classList.toggle('preview-assistant');});
`, resolveDir: desktop, sourcefile: 'ui-preview.jsx', loader: 'jsx' }, bundle: true, write: false, platform: 'browser', nodePaths: [path.join(desktop, 'node_modules')], define: { 'process.env.NODE_ENV': '"development"' } })
let scene = 'running', count = 40
const fixture = () => uiWorkbenchFixture(dataRoot, scene, count)
const send = (res, value, code = 200) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)) }
const runner = async ({ args }) => {
  const python = option('--python', path.join(agent, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'))
  const { stdout } = await promisify(execFile)(python, ['-m', 'pangea_agent.cli.main', ...args], { cwd: agent, env: { ...process.env, PYTHONPATH: path.join(agent, 'src'), PYTHONUTF8: '1' }, maxBuffer: 16 * 1024 * 1024 })
  const envelope = JSON.parse(stdout); if (!envelope.ok) throw new Error(envelope.error?.message); return envelope.result
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'), { run, task } = fixture()
    if (url.pathname === '/fixture') { scene = url.searchParams.get('scene') || 'running'; count = Number(url.searchParams.get('count') || 40); return send(res, { status: 'ok', scene, count }) }
    if (url.pathname === '/api/pangea-companion/case-reviews') return await caseReviewRouteHandler(req, res, { resolveRoot: async () => dataRoot, readRun: async () => run })
    if (url.pathname === '/api/pangea-companion/export') return await exportRouteHandler(req, res, { resolveRoot: async () => dataRoot, readRun: async () => run })
    if (url.pathname === '/api/pangea-companion/repositories') {
      if (req.method === 'GET' && !url.searchParams.get('view')) return send(res, { status: 'ok', initialized: true, repositories: [{ repository_id: 'storage', name: 'storage' }] })
      return await repositoryRouteHandler(req, res, runner)
    }
    if (url.pathname === '/api/pangea-companion/state') return send(res, { status: 'ok', data_root: dataRoot, current: run, runs: [run], executor_runs: [], monitor: { sessions: [], runs: [] } })
    if (url.pathname === '/api/pangea-companion/workbench') {
      if (url.searchParams.get('view') === 'agent-sessions') return send(res, { status: 'ok', run_id: run.run_id, items: [{ session_id: 'a'.repeat(64), unit_id: 'unit-tls', action_ids: ['action-tls'], attempt_id: 'attempt-1', stage: 'unit_analysis', role: 'work', provider: 'pangea-codeagent', status: 'running', history_status: 'recorded' }] })
      if (url.searchParams.get('view') === 'agent-session') return send(res, { status: 'ok', run_id: run.run_id, session: { session_id: 'a'.repeat(64), unit_id: 'unit-tls', status: 'running', history_status: 'recorded' }, events: [{ seq: 1, type: 'session_update', at: '2026-10-21T04:10:00Z', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '## 当前进展\n已保存 **TLS 握手** 的主要路径。\n- 核对失败清理\n- 检查重新建链\n```c\nint result = 0;\n```' } } }, { seq: 2, type: 'session_update', update: { sessionUpdate: 'tool_call', toolCallId: 'read-source', title: '读取冻结源码', status: 'failed', rawInput: { path: 'tls/handshake.c' }, rawOutput: { error: '界面测试：模拟读取错误' } } }], has_more: false, next_cursor: 2 })
      return send(res, { status: 'ok', data_root: dataRoot, compatibility: { compatible: true }, capabilities: { repositories: ['storage'], workflow_versions: ['source-first-v1'], source_first: { version: 'source-first-v1', contract_fields: ['analysis_profile', 'analysis_settings', 'asset_revisions', 'expected_scope_revision'], analysis_options_by_profile: { 'behavior-test-v2': { scenarios: ['module-analysis', 'risk-analysis', 'branch-analysis', 'coverage-analysis'], modes: ['depth', 'speed'] } } } }, tasks: { items: [task], total: 1 }, runs: { items: [run], total: 1 }, run, selected_task_id: task.task_id, acp_providers: [{ id: 'pangea-codeagent', label: 'CodeAgent', registered: true }] })
    }
    if (url.pathname === '/api/pangea-companion/acp-settings' && req.method === 'POST') return send(res, { status: 'ok', provider_id: 'pangea-codeagent', catalog_id: 'ui-fixture-catalog', current_model: 'fixture-model', models: [{ id: 'fixture-model', label: '界面测试模型' }] })
    if (url.pathname === '/api/pangea-asset-catalog/state') return send(res, { status: 'ok', initialized: true, assets: [], methodologies: [], summary: { total: 0, available: 0, review: 0, failed: 0 }, pagination: { total: 0, page: 1, page_size: 20, total_pages: 1 }, features: {} })
    if (url.pathname.startsWith('/api/')) return send(res, { status: 'ok', assets: [], environments: [], items: [], models: [], settings: {}, capabilities: {} })
    if (url.pathname === '/shell.js') { res.writeHead(200, { 'content-type': 'application/javascript' }); return res.end((await readFile(path.join(plugin, '../dsh-pangea/lib/client.js'), 'utf8')).replace('exports.apply = apply', 'exports.SettingsPage = SettingsPage; exports.apply = apply')) }
    if (url.pathname === '/assets.js') { res.writeHead(200, { 'content-type': 'application/javascript' }); return res.end(await readFile(path.join(plugin, '../dsh-pangea-asset-catalog/lib/client.js'))) }
    if (url.pathname === '/client.js') { res.writeHead(200, { 'content-type': 'application/javascript' }); return res.end(await readFile(path.join(plugin, 'lib/client.js'))) }
    if (url.pathname === '/entry.js') { res.writeHead(200, { 'content-type': 'application/javascript' }); return res.end(bundle.outputFiles[0].contents) }
    if (url.pathname === '/ui.css') { res.writeHead(200, { 'content-type': 'text/css' }); return res.end(css) }
    if (url.pathname.startsWith('/fonts/')) { const relative = url.pathname.slice(7); if (relative.includes('..')) return send(res, {}, 400); const file = path.join(tools, '@fontsource/noto-sans-sc', relative); res.writeHead(200, { 'content-type': relative.endsWith('.css') ? 'text/css' : 'font/woff2' }); return res.end(await readFile(file)) }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">${hasFonts ? '<link rel="stylesheet" href="/fonts/400.css"><link rel="stylesheet" href="/fonts/600.css">' : ''}<link rel="stylesheet" href="/ui.css"><style>body{margin:0;--pangea-font:"Segoe UI","Microsoft YaHei UI","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif!important}*{box-sizing:border-box}button,input,select{font:inherit}#preview-top{height:53px;display:flex;align-items:center;justify-content:space-between;background:white;padding:0 24px;border-bottom:1px solid #e1e5eb;font:14px var(--pangea-font)}#preview-frame{display:grid;grid-template-columns:176px minmax(0,1fr);height:calc(100vh - 53px)}#preview-nav{padding:32px 16px;background:#f1f2f5;font:14px/2.4 var(--pangea-font)}#app{min-width:0;overflow:auto;padding:0}.preview-assistant #preview-frame{grid-template-columns:176px minmax(0,1fr) 380px}.preview-assistant #preview-frame:after{content:"讨论助手 · 布局验证";background:#fff;padding:24px;border-left:1px solid #e1e5eb}</style></head><body data-pangea-product-shell><div id="preview-top"><strong>PANGEA Desktop</strong><span>界面测试 · 示例数据 <button onclick="document.body.classList.toggle('preview-assistant')">讨论助手</button></span></div><div id="preview-frame"><nav id="preview-nav">工作台<br>分析任务<br>测试资产<br>执行环境</nav><main id="app"></main></div><script src="/entry.js"></script></body></html>`)
  } catch (error) { send(res, { status: 'error', error: error.message }, 500) }
})
server.listen(Number(option('--port', 0)), '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, dataRoot, scene })))

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(async () => { await rm(dataRoot, { recursive: true, force: true }); process.exit(0) }))
