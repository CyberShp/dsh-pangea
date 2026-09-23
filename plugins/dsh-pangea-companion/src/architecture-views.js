import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, writeFile, appendFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { diagnosticText } from './launch-log.js'
import { summarizeRun } from './reader.js'
import { writeTaskStoreFile } from './task-store.js'

export const DIAGRAM_TYPES = ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']
const stamp = () => new Date().toISOString()
const readJson = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''))
const safeId = id => {
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new Error('Invalid architecture identity')
  return id
}

export async function viewRoot(task, viewId) {
  const runs = await realpath(path.join(task.data_root, 'runs'))
  const run = await realpath(path.join(runs, safeId(task.run_id)))
  if (path.relative(runs, run).startsWith('..')) throw new Error('Run outside data root')
  const root = path.join(run, '派生视图', 'archify')
  await mkdir(root, { recursive: true })
  if (path.relative(run, await realpath(root)).startsWith('..')) throw new Error('Views outside Run')
  return viewId ? path.join(root, safeId(viewId)) : root
}

export async function loadView(task, viewId) {
  const folder = await viewRoot(task, viewId)
  const resolved = await realpath(folder)
  const base = await viewRoot(task)
  if (path.dirname(resolved) !== base) throw new Error('View outside bound directory')
  const view = await readJson(path.join(resolved, 'manifest.json'))
  if (view.task_id !== task.task_id || view.run_id !== task.run_id || view.view_id !== viewId) throw new Error('Architecture binding mismatch')
  return view
}

const viewWrites = new Map()
export async function updateView(task, viewId, changes) {
  const key = `${task.data_root}/${task.run_id}/${viewId}`
  const previous = viewWrites.get(key) ?? Promise.resolve()
  const pending = previous.catch(() => {}).then(() => writeView(task, viewId, changes))
  viewWrites.set(key, pending)
  try { return await pending } finally { if (viewWrites.get(key) === pending) viewWrites.delete(key) }
}

async function writeView(task, viewId, changes) {
  const view = await loadView(task, viewId)
  const updated = { ...view, ...changes, updated_at: stamp() }
  await writeTaskStoreFile(path.join(await viewRoot(task, viewId), 'manifest.json'), JSON.stringify(updated, null, 2))
  return updated
}

export async function recordViewEvent(task, viewId, event) {
  const folder = await viewRoot(task, viewId)
  const entry = { ...event, at: stamp(), error: event.error?.message ?? event.error }
  await appendFile(path.join(folder, 'events.jsonl'), JSON.stringify(entry, (_key, value) => typeof value === 'string' ? diagnosticText(value, 262144) : value) + '\n', 'utf8')
  const view = await loadView(task, viewId)
  if (view.status === 'stopped') return view
  const error = entry.error || entry.error_summary || (entry.status === 'error' ? entry.stderr_summary : null)
  return updateView(task, viewId, { launch_stage: entry.stage, last_activity_at: entry.at,
    ...(error && view.status !== 'failed' ? { error: diagnosticText(error), failure_stage: entry.stage } : {}),
    ...(entry.terminal ? { status: 'failed' } : {}) })
}

export async function inspectView(task, viewId) {
  const folder = await viewRoot(task, viewId)
  const view = await loadView(task, viewId)
  if (['stopped', 'failed', 'ready'].includes(view.status)) return { ok: view.status === 'ready', terminal: true, error: view.error }
  try {
    const receipt = await readJson(path.join(folder, 'validation-receipt.json'))
    if (receipt.ok) await readFile(path.join(folder, 'diagram.html'))
    return receipt
  } catch { return { ok: false, error: '尚无可读取的验证通过产物' } }
}

function scopeFlow(flow, branchIds) {
  const branches = (flow.branches ?? []).filter(b => branchIds.includes(b.branch_id))
  const edgeBranches = branches.filter(b => Number.isInteger(b.edge_index))
  if (edgeBranches.length) {
    const indexes = new Set(edgeBranches.map(b => b.edge_index))
    const ids = new Set(edgeBranches.flatMap(b => [b.from_step_id, b.to_step_id]))
    const selected = { ...flow, branches, paths: [],
      nodes: (flow.nodes ?? []).filter(n => ids.has(n.id)),
      edges: (flow.edges ?? []).filter((e, i) => indexes.has(i)),
      mainline_steps: (flow.mainline_steps ?? []).filter(n => ids.has(n.step_id)) }
    if (flow.source_record) {
      const { source_record, evidence, ...body } = selected
      selected.source_record = { ...source_record, body, scoped: true }
    }
    return selected
  }
  const paths = (flow.paths ?? []).filter(p => branchIds.includes(p.path_id))
  const nodeIds = new Set(paths.flatMap(p => p.node_ids ?? []))
  const pairs = new Set(paths.flatMap(p => (p.node_ids ?? []).slice(1).map((id, i) => JSON.stringify([p.node_ids[i], id]))))
  const selected = { ...flow, branches, paths }
  if (paths.length) {
    selected.nodes = (flow.nodes ?? []).filter(n => nodeIds.has(n.id))
    selected.edges = (flow.edges ?? []).filter(e => pairs.has(JSON.stringify([e.source_step_key ?? e.from ?? e.source, e.target_step_key ?? e.to ?? e.target])))
    selected.mainline_steps = (flow.mainline_steps ?? []).filter(n => nodeIds.has(n.step_id))
  }
  // Do not leak the unfiltered flow again through its raw body or evidence rows.
  if (flow.source_record) {
    const { source_record, evidence, ...body } = selected
    selected.source_record = { ...source_record, body, scoped: true }
  }
  return selected
}

function flowContext(projection, flow, branchIds) {
  const branchCaseIds = new Set([...(flow.branches ?? []), ...(flow.paths ?? [])].flatMap(b => b.linked_test_case_ids ?? []))
  const cases = (projection.test_cases ?? []).filter(c => branchCaseIds.has(c.test_case_id)
    || (!branchIds && (c.flow_id === flow.flow_id || c.linked_flow_ids?.includes(flow.flow_id))))
  const riskIds = new Set([...(flow.branches ?? []).flatMap(b => b.linked_risk_ids ?? []), ...cases.flatMap(c => c.linked_risk_ids ?? [])])
  const risks = (projection.risks ?? []).filter(r => riskIds.has(r.risk_id) || (!branchIds && r.flow_id === flow.flow_id))
  const owners = new Set([flow.projection_id, ...cases.map(c => c.projection_id), ...risks.map(r => r.projection_id)].filter(Boolean))
  const evidence = [...(flow.evidence ?? []), ...(projection.evidence ?? []).filter(e => owners.has(e.projection_id) || e.risk_ids?.some(id => riskIds.has(id)))]
    .map(e => ({ chunk_id: e.chunk_id, location: e.location, observation: e.observation }))
  return { business_flows: [{ ...flow, evidence }], risks, test_cases: cases, evidence, notes: [] }
}

export async function createView(task, { type = 'workflow', flow_id = null, previous_view_id = null, branch_ids, profile } = {}, env = process.env) {
  if (!DIAGRAM_TYPES.includes(type)) throw new Error('Unsupported diagram type')
  const archify = env.PANGEA_ARCHIFY_ROOT
  if (!archify) throw new Error('Archify runtime unavailable')
  await readFile(path.join(archify, 'SKILL.md'))
  await readFile(path.join(archify, 'bin/archify.mjs'))
  const root = await viewRoot(task)
  const run = path.resolve(root, '../..')
  // Select by the Run contract, never by whether a stale legacy projection exists.
  let progress
  try { progress = await readJson(path.join(run, 'progress.json')) } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`架构视图无法读取当前 Run 状态：${error.message}`)
  }
  const sourceFirst = progress?.workflow_version === 'source-first-v1'
  const summary = sourceFirst ? await summarizeRun(task.data_root, task.run_id, { includeDetails: true }) : null
  const projection = summary?.details ?? await readJson(path.join(run, '内部索引/工作台投影.json'))
  const previous = previous_view_id ? await loadView(task, previous_view_id) : null
  flow_id ??= previous?.flow_id ?? null
  const flow = flow_id ? projection.business_flows?.find(item => item.flow_id === flow_id) : null
  if (flow_id && !flow) throw new Error('该流程已更新或尚未产出，请刷新后重新选择。')
  const viewProfile = profile ?? previous?.profile ?? 'standard'
  if (!['standard', 'function_variables'].includes(viewProfile)) throw new Error('Unsupported diagram profile')
  if (viewProfile === 'function_variables' && (!flow || type !== 'workflow')) throw new Error('Function diagram requires a flow and workflow type')
  if (previous && (previous.profile ?? 'standard') !== viewProfile) throw new Error('Diagram profile mismatch')
  if (previous && viewProfile === 'function_variables' && previous.flow_id !== flow_id
    && !(previous.logical_flow_id && previous.logical_flow_id === flow?.logical_flow_id && previous.flow_unit_id === flow?.unit_id)) throw new Error('Function diagram flow mismatch')
  const branchIds = branch_ids ?? previous?.branch_ids ?? null
  if (branchIds !== null && (!flow || !Array.isArray(branchIds) || !branchIds.length || new Set(branchIds).size !== branchIds.length
    || branchIds.some(id => !(flow.branches ?? []).some(branch => branch.branch_id === id) && !(flow.paths ?? []).some(p => p.path_id === id)))) throw new Error('Invalid architecture branch scope')
  const scopedFlow = branchIds ? scopeFlow(flow, branchIds) : flow
  const context = flow ? flowContext(projection, scopedFlow, branchIds) : Object.fromEntries(
    ['business_flows', 'risks', 'test_cases', 'evidence', 'notes'].map(key => [key, projection[key] ?? []]))
  if (sourceFirst && !['business_flows', 'evidence', 'notes'].some(key => context[key]?.length)) {
    const issues = summary.reader_health?.issues ?? []
    throw new Error(issues.length ? `当前架构内容不可读取：${issues.join('；')}` : '当前尚无足够的架构分析内容，请在分析产出后重试。')
  }
  context.target = summary?.target ?? task.target
  context.workflow_version = summary?.workflow_version ?? 'codetalks-skill'
  context.publication = summary?.publication ?? projection.publication ?? null
  context.partial_delivery = summary?.partial_delivery ?? false
  context.source_snapshot = summary?.source_snapshot ?? { manifest_path: path.join(run, 'inputs/source/manifest.json') }
  context.reader_warnings = summary?.reader_warnings ?? []
  const sourceRecords = [...new Map(['business_flows', 'risks', 'test_cases', 'evidence', 'notes'].flatMap(key => context[key] ?? [])
    .filter(row => row.source_record).map(row => {
      const record = row.source_record
      return [`${record.action_id}/${record.record_id}`, { action_id: record.action_id, record_id: record.record_id, revision: record.revision }]
    })).values()]
  const viewId = randomUUID()
  const folder = path.join(root, viewId)
  await mkdir(folder)
  await writeFile(path.join(folder, 'context.json'), JSON.stringify(context, null, 2))
  if (previous) {
    const candidate = await readFile(path.join(await viewRoot(task, previous.view_id), 'candidate.json'))
    await writeFile(path.join(folder, 'candidate.json'), candidate)
  } else if (type === 'workflow') {
    await writeFile(path.join(folder, 'candidate.json'), JSON.stringify({
      schema_version: 2, diagram_type: 'workflow',
      meta: { title: flow?.title || task.target || '业务流程', locale: 'zh-CN', quality_profile: 'showcase' },
      lanes: [], nodes: [], edges: [],
    }, null, 2))
  }
  const view = { view_id: viewId, task_id: task.task_id, run_id: task.run_id, flow_id, type, profile: viewProfile, branch_ids: branchIds,
    logical_flow_id: flow?.logical_flow_id ?? null, flow_unit_id: flow?.unit_id ?? null,
    source_revision: context.publication?.revision ?? null, workflow_version: context.workflow_version,
    publication: context.publication, source_records: sourceRecords, status: 'generating',
    previous_view_id, session_id: null, job_id: null, created_at: stamp(), updated_at: stamp(),
    budget_ms: viewProfile === 'function_variables' ? 1800000 : 1200000, max_render_attempts: 3 }
  await writeFile(path.join(folder, 'manifest.json'), JSON.stringify(view, null, 2))
  const renderer = fileURLToPath(new URL('./architecture-render.mjs', import.meta.url))
  const quote = value => `'${value.replaceAll("'", process.platform === 'win32' ? "''" : "'\"'\"'")}'`
  const renderCommand = `${process.platform === 'win32' ? '& ' : ''}${[env.PANGEA_NODE || process.execPath, renderer, folder, archify].map(quote).join(' ')}`
  return { view, prompt: [
    `为 ${task.target} 创建 ${type} 架构视图。${previous ? '这是关联的新画图会话；candidate.json 是旧图，必须按本次 context.json 核对更新。' : ''}`,
    ...(viewProfile === 'function_variables' ? [
      '绘制当前业务流程的函数与变量流程图，使用 workflow schema。以真实函数为节点，label 保留准确函数名，sublabel/tag 写简短说明；完整签名、入参、返回值、关键局部或共享变量、冻结源码相对路径与行号放入对应 cards，明确关联函数名，不把长段说明塞入单行节点。',
      '有向连线表达真实调用关系，标明调用方向、分支条件、实参到形参的传递、返回值接收和关键变量的赋值或状态变化；循环、递归和回调须忠实表达。按 schema 支持的 label、描述或详情字段组织信息，保持主图可读。',
      '从已发布业务流程定位冻结源码，只读取该流程相关函数。逐一核对函数定义、调用点与变量读写；不得将业务步骤直接冒充函数，不得推测运行时具体值。无法确认的动态调用、外部实现、入参、返回值或变量变化明确标注“待确认”及原因。',
      '图中展示已核对范围与缺失信息；若源码不可读或没有可核对的函数，报告原因，不生成虚构图。此图为源码静态关系，不能声称运行时轨迹已验证。',
    ] : []),
    ...(branchIds ? [`本图是局部分支图，仅包含 ${branchIds.join('、')}。主干仅作定位和回接上下文；图题须注明“局部分支”，不得把本图表述为完整流程。`] : []),
    `先读取 ${path.join(archify, 'SKILL.md')}，按需读对应 schema/example；PANGEA 集成约定优先：不运行更新检查，不访问外网，不要求公开仓库，不读取秘密配置。`,
    ...(type === 'workflow' ? [
      previous ? '保留旧 candidate.json 的 schema_version；核对语义后按诊断修改。' : 'candidate.json 已提供 schema_version: 2 的空模板；补全真实 lanes、nodes、edges，不复制示例事实。',
      'schema v2 的 col 是逻辑列，由编译器计算列距、路由和画布范围。首次排版省略 meta.viewBox、yOffset、via、channelX、channelY、labelAt、fromSide、toSide，使用自动路由；仅按具体诊断添加必要几何约束。',
      '使用 semanticChecks 时，从源码核对起点与所有终止分支并完整声明 allowedTerminals；不能仅为通过校验而删除分支、调用或语义标签。',
    ] : []),
    `当前分析上下文：${path.join(folder, 'context.json')}。源码位置按其中 source_snapshot 的 repositories、manifest_path 和 index_path 读取，不猜测旧源码目录。`,
    '保留流程 nodes、edges、paths 的分支与回接关系；原始记录是分析依据，测试步骤不能直接当作组件依赖。仅核对当前对象及必要依赖，不扩大成全仓分析。',
    '遵循上下文 publication 与 partial_delivery 标识；未最终交付的图标注“当前分析视图”。无证据的关系不补画，reader_warnings 涉及的内容不得表述为已验证。',
    '只核对本图相关实现；语义疑点在会话报告，不能改主 Run 的报告、投影、风险、用例、状态。',
    `唯一写入目录：${folder}。编写 candidate.json；不要修改 manifest.json。`,
    `完成后原样执行以下 ${process.platform === 'win32' ? 'PowerShell' : 'shell'} 命令，Node 可执行文件、参数及输出目录已绑定：\n\`\`\`${process.platform === 'win32' ? 'powershell' : 'sh'}\n${renderCommand}\n\`\`\``,
    `本次生成总预算 ${view.budget_ms / 60000} 分钟，最多调用渲染命令 ${view.max_render_attempts} 次；预算或次数耗尽后保留候选图并报告准确原因，不换会话规避限制。`,
    '该命令运行 Archify deliver 并保存收据。失败只修 candidate.json，再执行同一命令；两轮诊断无改善时如实报告。渲染验证不证明源码结论正确。',
    '产物生成后在会话简要说明，不启动主分析流程。',
  ].join('\n') }
}

export async function listViews(task) {
  if (!task?.run_id) return []
  const root = await viewRoot(task)
  const items = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    try {
      const view = await loadView(task, entry.name)
      let receipt
      try { receipt = await readJson(path.join(root, entry.name, 'validation-receipt.json')) } catch { /* pending */ }
      const events = await readFile(path.join(root, entry.name, 'events.jsonl'), 'utf8').then(value => value.trim().split('\n').slice(-50).flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } }), () => [])
      const html = await readFile(path.join(root, entry.name, 'diagram.html')).then(() => true, () => false)
      const available = Boolean(receipt?.ok && html)
      // A rejected candidate can be repaired by the live Job. Its lifecycle,
      // reconciled by architecture-list, determines whether generation failed.
      items.push({ ...view, generation_events: events, diagnostic_path: path.join(root, entry.name, 'events.jsonl'), render_diagnostic_path: path.join(root, entry.name, 'render-history.jsonl'), render_exit_code: receipt?.exit_code, render_duration_ms: receipt?.duration_ms, status: view.status === 'stopped' ? 'stopped' : available ? 'ready' : view.status, available,
        error: available ? null : view.error,
        validation_error: receipt?.ok === false ? receipt.error || '图表尚未通过校验' : null,
        validation_diagnostics: receipt?.ok === false ? receipt.diagnostics ?? [] : [] })
    } catch { /* Keep unreadable view isolated from main analysis. */ }
  }
  return items.sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export async function viewArtifact(task, viewId, format) {
  await loadView(task, viewId)
  if (!['html', 'svg'].includes(format)) throw new Error('Unsupported diagram format')
  const root = await viewRoot(task, viewId)
  const file = await realpath(path.join(root, `diagram.${format}`))
  if (path.dirname(file) !== root) throw new Error('Artifact outside view directory')
  return readFile(file)
}
