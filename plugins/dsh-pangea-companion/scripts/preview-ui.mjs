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
import { readEvidenceSnippet } from '../src/source.js'
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
const assetFixture = {
  asset_id: 'typography-design', title: '连接模块设计说明', asset_type: 'design', status: 'available', source_name: '连接设计.md', revision: 1,
  repository_ids: ['storage'], module_tags: ['TLS'], language_tags: [],
  extraction_job: { status: 'completed', output: '# 提取记录\n\n1. **确认输入**：保留字段和值。\n2. 保存 `result.json`。\n\n| 检查 | 结果 |\n| --- | --- |\n| 内容 | 已保留 |', events: [{ at: '2026-10-31T00:00:00Z', label: '界面验证示例：结果已保存' }] },
}
const assetDetailFixture = { status: 'ok', asset: assetFixture,
  result: { items: [{ item_id: 'D-1', title: '输入校验与连接恢复', inputs: ['**请求**包含 `id`', '允许数值为 0'], constraints: { timeout_ms: 0, enabled: false, policy: '保留 **失败原因** 和恢复入口' }, main_flows: ['1. 读取请求\n2. 校验输入\n3. 保存结果'], source_references: [{ path: '连接设计.md', location: '第 2 节', quote: '原始引文不能丢' }] }] },
  normalized_preview: '# 连接模块设计说明\n\n这是一份 **界面排版示例**，用于核对正文、列表和表格的显示，不代表真实分析结果。\n\n## 请求处理\n1. **读取输入**并记录请求标识。\n2. 校验参数，不满足条件时返回 `false`。\n3. 保存处理结果与错误原因。\n\n### 输入字段\n| 字段 | 类型 | 说明 |\n| --- | --- | --- |\n| id | integer | 请求标识 |\n| timeout_ms | number | 允许为 0 |\n\n### 异常恢复\n- 释放本次请求占用的资源\n- 保留重新发起连接的入口\n\n> 恢复能力需要结合真实测试环境验证。\n\n```js\nif (a < b) return 0;\n```',
}
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
    if (url.pathname === '/api/pangea-companion/source') {
      if (url.searchParams.get('run_id') && url.searchParams.get('run_id') !== run.run_id) return send(res, { status: 'error', error: '源码请求不属于当前界面测试 Run。' }, 404)
      const context = name => { const value = Number(url.searchParams.get(name) ?? 3); return Number.isInteger(value) && value >= 0 ? Math.min(value, 80) : 3 }
      return send(res, await readEvidenceSnippet({ cwd: dataRoot, dataRoot, snapshotRoot: path.join(dataRoot, 'repositories'), repositoryId: 'storage', snapshotLayout: 'source-first',
        location: url.searchParams.get('location'), contextBefore: context('context_before'), contextAfter: context('context_after') }))
    }
    if (url.pathname === '/api/pangea-companion/workbench') {
      if (url.searchParams.get('view') === 'agent-sessions') return send(res, { status: 'ok', run_id: run.run_id, items: [{ session_id: 'a'.repeat(64), unit_id: 'unit-tls', action_ids: ['action-tls'], attempt_id: 'attempt-1', stage: 'unit_analysis', role: 'work', provider: 'pangea-codeagent', status: 'running', history_status: 'recorded' }] })
      if (url.searchParams.get('view') === 'agent-session') return send(res, { status: 'ok', run_id: run.run_id, session: { session_id: 'a'.repeat(64), unit_id: 'unit-tls', status: 'running', history_status: 'recorded' }, events: [{ seq: 1, type: 'session_update', at: '2026-10-21T04:10:00Z', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '## 当前进展\n已保存 **TLS 握手** 的主要路径。\n- 核对失败清理\n- 检查重新建链\n```c\nint result = 0;\n```' } } }, { seq: 2, type: 'session_update', update: { sessionUpdate: 'tool_call', toolCallId: 'read-source', title: '读取冻结源码', status: 'failed', rawInput: { path: 'tls/handshake.c' }, rawOutput: { error: '界面测试：模拟读取错误' } } }], has_more: false, next_cursor: 2 })
      return send(res, { status: 'ok', data_root: dataRoot, compatibility: { compatible: true }, capabilities: { repositories: ['storage'], workflow_versions: ['source-first-v1'], source_first: { version: 'source-first-v1', contract_fields: ['analysis_profile', 'analysis_settings', 'asset_revisions', 'expected_scope_revision'], analysis_options_by_profile: { 'behavior-test-v2': { scenarios: ['module-analysis', 'risk-analysis', 'branch-analysis', 'coverage-analysis'], modes: ['depth', 'speed'] } } } }, tasks: { items: [task], total: 1 }, runs: { items: [run], total: 1 }, run, selected_task_id: task.task_id, acp_providers: [{ id: 'pangea-codeagent', label: 'CodeAgent', registered: true }] })
    }
    if (url.pathname === '/api/pangea-companion/acp-settings' && req.method === 'POST') return send(res, { status: 'ok', provider_id: 'pangea-codeagent', catalog_id: 'ui-fixture-catalog', current_model: 'fixture-model', models: [{ id: 'fixture-model', label: '界面测试模型' }] })
    if (url.pathname === '/api/pangea-asset-catalog/state') return send(res, url.searchParams.get('asset_id') ? assetDetailFixture : { status: 'ok', initialized: true, assets: [assetFixture], methodologies: [], summary: { total: 1, available: 1, review: 0, failed: 0 }, pagination: { total: 1, page: 1, page_size: 20, total_pages: 1 }, features: {} })
    if (url.pathname.startsWith('/api/')) return send(res, { status: 'ok', assets: [], environments: [], items: [], models: [], settings: {}, capabilities: {} })
    if (url.pathname === '/shell.js') { res.writeHead(200, { 'content-type': 'application/javascript' }); return res.end((await readFile(path.join(plugin, '../dsh-pangea/lib/client.js'), 'utf8')).replace('exports.apply = apply', 'exports.SettingsPage = SettingsPage; exports.apply = apply')) }
    if (url.pathname === '/assets.js') { res.writeHead(200, { 'content-type': 'application/javascript' }); return res.end(await readFile(path.join(plugin, '../dsh-pangea-asset-catalog/lib/client.js'))) }
    if (url.pathname === '/client.js') { res.writeHead(200, { 'content-type': 'application/javascript' }); return res.end(await readFile(path.join(plugin, 'lib/client.js'))) }
    if (url.pathname === '/entry.js') { res.writeHead(200, { 'content-type': 'application/javascript' }); return res.end(bundle.outputFiles[0].contents) }
    if (url.pathname === '/ui.css') { res.writeHead(200, { 'content-type': 'text/css' }); return res.end(css) }
    if (url.pathname.startsWith('/fonts/')) { const relative = url.pathname.slice(7); if (relative.includes('..')) return send(res, {}, 400); const file = path.join(tools, '@fontsource/noto-sans-sc', relative); res.writeHead(200, { 'content-type': relative.endsWith('.css') ? 'text/css' : 'font/woff2' }); return res.end(await readFile(file)) }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">${hasFonts ? '<link rel="stylesheet" href="/fonts/400.css"><link rel="stylesheet" href="/fonts/600.css">' : ''}<link rel="stylesheet" href="/ui.css"><style>body{margin:0;--pangea-font:"Segoe UI","Microsoft YaHei UI","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif!important}*{box-sizing:border-box}button,input,select{font:inherit}#preview-top{height:53px;display:flex;align-items:center;justify-content:space-between;background:white;padding:0 24px;border-bottom:1px solid #e1e5eb;font:14px var(--pangea-font)}#preview-frame{display:grid;grid-template-columns:176px minmax(0,1fr);height:calc(100vh - 53px)}#preview-nav button{display:block;border:0;background:transparent;text-align:left;padding:10px 0;width:100%;cursor:pointer}#preview-nav{padding:32px 16px;background:#f1f2f5;font:14px/2.4 var(--pangea-font)}#app{min-width:0;overflow:auto;padding:0}.preview-assistant #preview-frame{grid-template-columns:176px minmax(0,1fr) 380px}.preview-assistant #preview-frame:after{content:"讨论助手 · 布局验证";background:#fff;padding:24px;border-left:1px solid #e1e5eb}</style></head><body data-pangea-product-shell><div id="preview-top"><strong>PANGEA Desktop</strong><span>界面测试 · 示例数据 <button onclick="document.body.classList.toggle('preview-assistant')">讨论助手</button></span></div><div id="preview-frame"><nav id="preview-nav"><button onclick="previewMount('home','home')">工作台</button><button onclick="previewMount('tasks')">分析任务</button><button onclick="previewMount('assets')">测试资产</button><button onclick="previewMount('create')">新建分析</button></nav><main id="app"></main></div><script src="/entry.js"></script></body></html>`)
  } catch (error) { send(res, { status: 'error', error: error.message }, 500) }
})
server.listen(Number(option('--port', 0)), '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, dataRoot, scene })))

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(async () => { await rm(dataRoot, { recursive: true, force: true }); process.exit(0) }))
