// Interactive UI acceptance data. This module never launches a model or worker.
import { transformFixture as drawerFixture, responseFor as drawerResponse } from './drawers-timeline.mjs'
import { behaviorCoverageProjection } from '../../src/behavior-coverage.js'

export const reviewScenes = [
  ['running', '运行中'], ['complete', '已完成'], ['failed', '失败恢复'],
  ['partial', '部分结果'], ['dense', '大量数据'], ['empty', '空状态'],
]
let createdInput = null
export function resetFixture() { createdInput = null }
export function transformFixture(value, context) {
  value = drawerFixture(value, context)
  const { run, task } = value
  const now = Date.now()
  run.started_at = new Date(now - 16 * 60000).toISOString()
  if (run.terminal) run.ended_at = new Date(now - 60000).toISOString()
  run.state_read.updated_at = new Date(now - 30000).toISOString()
  task.updated_at = run.state_read.updated_at
  if (createdInput) { task.title = createdInput.title || createdInput.target || '新建分析 · 界面示例'; task.target = run.target = task.title; task.source_scope = run.source_scope = createdInput.source_scope || ['tls'] }
  if (context.scene === 'dense') {
    run.workflow.units = Array.from({ length: 12 }, (_, index) => ({ unit_id: index === 0 ? 'unit-tls' : index === 1 ? 'unit-cleanup' : `unit-${index}`, title: `连接生命周期 ${index + 1} · 握手、资源释放与异常恢复`, status: index % 4 ? 'accepted' : 'dispatched' }))
    run.details.behavior_coverage = behaviorCoverageProjection(run.workflow.units.map((unit, index) => ({ unit_id: unit.unit_id, projection_id: `ledger-${index}`, body: {
      format_version: 'behavior-coverage-v1', scope: unit.title,
      items: Array.from({ length: 18 }, (_, row) => ({ item_id: `behavior-${index}-${row}`, status: ['designed', 'missing', 'uncertain'][row % 3], operation: `验证场景 ${row + 1}：连接中断后的资源释放和恢复入口`, conditions: ['输入已通过校验', '测试环境具备故障注入手段'], expected_behavior: '错误可观察，资源被释放，后续连接能够恢复', case_refs: index < 2 ? [{ case_id: index ? 'TC-002' : 'TC-001' }] : [] })),
    } })), run.details.test_cases)
  }
  return value
}

export async function responseFor({ url, req, run, task, scene, dataRoot }) {
  const empty = scene === 'empty'
  const body = async () => { let text = ''; for await (const chunk of req) text += chunk; return JSON.parse(text || '{}') }
  if (url.pathname === '/api/pangea-companion/repositories') {
    if (req.method === 'POST') {
      const input = await body()
      if (['preview-scope', 'preview-test-tools'].includes(input.action)) return { status: 'ok', preview_state: 'complete', preview_id: 'workflow-ui-scope', scope_revision: 'workflow-ui-revision', normalized_scope: input.source_scope || ['tls'], matched_file_count: 3, files: ['handshake.c', 'connection.c', 'cleanup.c'].map(name => ({ relative_path: `tls/${name}` })), has_more: false, next_cursor: 3 }
      return { status: 'error', error: '此入口用于界面验收，源码导入请使用独立桌面实例。' }
    }
    if (url.searchParams.get('view') === 'tree') {
      const folder = url.searchParams.get('path') || '.'
      return { status: 'ok', repository: 'storage', path: folder, entries: folder === '.' ? [{ name: 'tls', path: 'tls', kind: 'directory', selectable: true }, { name: 'transport', path: 'transport', kind: 'directory', selectable: true }] : ['handshake.c', 'connection.c', 'cleanup.c'].map(name => ({ name, path: `${folder}/${name}`, kind: 'file', selectable: false })), cursor: 0, has_more: false }
    }
    return { status: 'ok', initialized: true, onboarding_required: false, repositories: [{ repository_id: 'storage', name: 'storage', source_path: '/示例源码/storage', file_count: 42, status: 'ready' }] }
  }
  if (url.pathname === '/api/pangea-companion/state') return { status: 'ok', data_root: dataRoot, current: empty ? null : run, runs: empty ? [] : [run], executor_runs: [], monitor: { sessions: [], runs: [] } }
  if (url.pathname !== '/api/pangea-companion/workbench') return undefined
  if (req.method === 'POST') {
    const input = await body()
    if (input.action === 'task-create') { createdInput = input.input; return { status: 'ok', task: { ...task, title: createdInput.title || createdInput.target || '新建分析 · 界面示例' } } }
    return { status: 'error', error: '此场景只验证界面，运行控制请使用独立桌面实例。' }
  }
  const session = drawerResponse({ url, run })
  if (session) return session
  if (url.searchParams.get('view') === 'agent-sessions') return undefined
  return { status: 'ok', data_root: dataRoot, view: url.searchParams.get('view'), compatibility: { compatible: true },
    capabilities: { repositories: ['storage'], workflow_versions: ['source-first-v1'], source_first: { version: 'source-first-v1', contract_fields: ['analysis_profile', 'analysis_settings', 'asset_revisions', 'expected_scope_revision'], analysis_options_by_profile: { 'behavior-test-v2': { scenarios: ['module-analysis', 'risk-analysis', 'branch-analysis', 'coverage-analysis'], modes: ['depth', 'speed'] } } } },
    tasks: { items: empty ? [] : [task], total: empty ? 0 : 1 }, runs: { items: empty ? [] : [run], total: empty ? 0 : 1 }, run: empty ? null : run,
    acp_providers: [{ id: 'pangea-codeagent', label: 'CodeAgent · 界面示例', registered: true }],
  }
}
