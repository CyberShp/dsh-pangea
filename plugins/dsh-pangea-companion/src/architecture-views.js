import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, writeFile, appendFile } from 'node:fs/promises'
import { diagnosticText } from './launch-log.js'
import { summarizeRun } from './reader.js'
import { writeTaskStoreFile } from './task-store.js'
import { renderCandidate } from './architecture-render.mjs'

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
  if (typeof changes === 'function') changes = changes(view)
  if (!changes) return view
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

const activeRenders = new Map()
export function cancelViewRender(task, viewId) {
  activeRenders.get(`${task.data_root}/${task.run_id}/${viewId}`)?.abort(new Error('停止图表验证'))
}
export async function validateView(task, viewId, options = {}, env = process.env) {
  const view = await loadView(task, viewId)
  if (!options.manual && ['stopped', 'failed'].includes(view.status)) return { ok: false, terminal: true, error: view.error || '图表已停止' }
  const key = `${task.data_root}/${task.run_id}/${viewId}`
  if (activeRenders.has(key)) throw new Error('当前候选正在验证')
  const controller = new AbortController()
  activeRenders.set(key, controller)
  try {
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
    const receipt = await renderCandidate(await viewRoot(task, viewId), env.PANGEA_ARCHIFY_ROOT, { ...options, signal, node: env.PANGEA_NODE || process.execPath })
    if (signal.aborted || (await loadView(task, viewId)).status === 'stopped' && !options.manual) return { ...receipt, ok: false, terminal: true }
    await updateView(task, viewId, current => signal.aborted || current.status === 'stopped' && !options.manual ? null :
      { ...(receipt.ok ? { status: 'ready' } : options.manual ? { status: 'failed' } : {}), error: receipt.ok ? null : receipt.error })
    return receipt
  } finally { activeRenders.delete(key) }
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
  context.coverage_match = summary?.coverage_match ?? null
  const sourceRecords = [...new Map(['business_flows', 'risks', 'test_cases', 'evidence', 'notes'].flatMap(key => context[key] ?? [])
    .filter(row => row.source_record).map(row => {
      const record = row.source_record
      return [`${record.action_id}/${record.record_id}`, { action_id: record.action_id, record_id: record.record_id, revision: record.revision }]
    })).values()]
  if (viewProfile === 'function_variables') {
    context.flow_locator = { flow_id: scopedFlow.flow_id, title: scopedFlow.title, unit_id: scopedFlow.unit_id,
      source_evidence: scopedFlow.source_evidence ?? [] }
    for (const key of ['business_flows', 'risks', 'test_cases', 'evidence', 'notes']) delete context[key]
  }
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
  return { view, prompt: [
    `为 ${task.target} 创建 ${type} 架构视图。${previous ? '这是关联的新画图会话；candidate.json 是旧图，必须按本次 context.json 核对更新。' : ''}`,
    ...(viewProfile === 'function_variables' ? [
      '绘制 flow_locator 指向源码范围的函数调用与变量图，使用 workflow schema。主图只含真实函数和单独标记的宏节点；外部被调用函数可作为外部节点。label 保留准确符号名，sublabel/tag 写简短说明。完整签名、入参、返回值、变量与冻结源码行号放入对应 cards。',
      '主图每条有向边只表达一个已核对的真实调用点；在 cards 写明相对路径与行号、实参到形参映射及返回值接收。函数内部判断、计算、赋值、重置和返回按执行顺序写在该函数 cards 中；未知外部调用者写入 cards。',
      '从已发布业务流程定位冻结源码，只读取该流程相关函数。逐一核对函数定义、调用点与变量读写；不得将业务步骤直接冒充函数，不得推测运行时具体值。无法确认的动态调用、外部实现、入参、返回值或变量变化明确标注“待确认”及原因。',
      '图中展示已核对范围与缺失信息；若源码不可读或没有可核对的函数，报告原因，不生成虚构图。此图为源码静态关系，不能声称运行时轨迹已验证。',
      '业务流程只用于定位源码，不能作为函数调用边的证据。每条调用边核对冻结源码中的调用点；没有调用点的函数独立展示，并在 cards 写明调用者或调度顺序待确认。宏标为宏，函数内判断/赋值标为内部步骤，不能冒充函数调用；不为连通布局补造调用边。',
      '逐函数在 cards 按执行顺序写出实际类型、入参、返回值接收、关键变量读取→中间计算→赋值/重置，包括整数截断、缩放、条件更新和宏对实参的写入。判断的不同结果须可区分；用户说明使用中文，代码符号保留原文。',
    ] : []),
    ...(branchIds ? [`本图是局部分支图，仅包含 ${branchIds.join('、')}。主干仅作定位和回接上下文；图题须注明“局部分支”，不得把本图表述为完整流程。`] : []),
    `先读取 ${path.join(archify, 'SKILL.md')}，按需读对应 schema/example；PANGEA 集成约定优先：不运行更新检查，不访问外网，不要求公开仓库，不读取秘密配置。`,
    ...(type === 'workflow' ? [
      `仅作结构示例，必须用本次源码事实替换：${JSON.stringify(viewProfile === 'function_variables' ? {
        schema_version: 2, diagram_type: 'workflow', meta: { title: '函数与变量关系', locale: 'zh-CN', quality_profile: 'showcase' },
        lanes: [{ id: 'functions', label: '函数' }, { id: 'macro', label: '宏' }],
        nodes: [{ id: 'caller', lane: 'functions', col: 0, type: 'backend', label: 'caller' }, { id: 'callee', lane: 'functions', col: 1, type: 'external', label: 'callee' }, { id: 'macro', lane: 'macro', col: 0, type: 'backend', label: 'MACRO', tag: '宏' }],
        edges: [{ id: 'call', from: 'caller', to: 'callee', label: '实际调用' }],
        cards: [{ title: 'caller 的源码证据', items: ['准确签名、调用位置与表达式、参数和返回值映射', '内部计算与变量读写按实际顺序展开'] }, { title: 'MACRO', items: ['宏的实参读写；未发现调用点，独立展示'] }],
      } : {
        schema_version: 2, diagram_type: 'workflow', meta: { title: '条件分支与汇合', locale: 'zh-CN', quality_profile: 'showcase' },
        lanes: [{ id: 'main', label: '主路径' }, { id: 'other', label: '另一分支' }],
        nodes: [{ id: 'check', lane: 'main', col: 0, type: 'decision', label: '条件判断' }, { id: 'yes', lane: 'main', col: 1, type: 'backend', label: '条件成立处理' }, { id: 'no', lane: 'other', col: 1, type: 'backend', label: '条件不成立处理' }, { id: 'join', lane: 'main', col: 2, type: 'backend', label: '更新状态' }, { id: 'return', lane: 'main', col: 3, type: 'backend', label: '返回' }],
        edges: [{ id: 'yes', from: 'check', to: 'yes', label: '是' }, { id: 'no', from: 'check', to: 'no', label: '否' }, { id: 'yj', from: 'yes', to: 'join' }, { id: 'nj', from: 'no', to: 'join' }, { id: 'jr', from: 'join', to: 'return' }],
      })}`,
      previous ? '保留旧 candidate.json 的 schema_version；核对语义后按诊断修改。' : 'candidate.json 已提供 schema_version: 2 的空模板；补全真实 lanes、nodes、edges，不复制示例事实。',
      'schema v2 的 col 是逻辑列，由编译器计算列距、路由和画布范围。首次排版省略 meta.viewBox、yOffset、via、channelX、channelY、labelAt、fromSide、toSide，使用自动路由；仅按具体诊断添加必要几何约束。',
      '每个节点占据独立的 lane + col 位置。同列的不同分支使用不同 lane；同 lane 的连续步骤使用不同 col。node-overlap 诊断必须改变冲突节点的位置，缩短标签或改 width 无法解决同一位置重叠。返回节点置于实际状态重置之后。',
      '使用 semanticChecks 时，从源码核对起点与所有终止分支并完整声明 allowedTerminals；不能仅为通过校验而删除分支、调用或语义标签。',
    ] : []),
    `当前分析上下文：${path.join(folder, 'context.json')}。源码位置按其中 source_snapshot 的 repositories、manifest_path 和 index_path 读取，不猜测旧源码目录。`,
    viewProfile === 'function_variables'
      ? '函数图先在 cards 列出逐条调用证据：caller、callee、冻结文件行号和调用表达式，然后仅将这些调用绘入 edges；无调用证据的函数或宏独立展示，edges 允许为空。不要用假设的外部循环连接它们。函数内部计算只放对应 cards，不用自环表示返回或赋值。绘图前逐条核对准确签名。已发布流程与源码冲突时在 cards 说明差异，不改主 Run。'
      : '依据冻结源码核对业务流程 nodes、edges、paths 的条件、处理结果与回接；关键判断的真假路径分别连向实际处理/结果，再汇合。普通执行顺序不标为条件分支。分别定义的函数和宏不代表它们按顺序调用；注释中的运行周期不证明外部调度连线。没有调用点或循环体证据时，各入口独立展示，调用者与调度写入 cards 的待确认说明。原文省略或存在疑点时保留准确范围和待确认说明，不为通过布局校验改变语义。用户说明使用中文，代码符号保留原文。',
    '原始记录是分析依据，测试步骤不能直接当作组件依赖。仅核对当前对象及必要依赖，不扩大成全仓分析。',
    '遵循上下文 publication 与 partial_delivery 标识；未最终交付的图标注“当前分析视图”。无证据的关系不补画，reader_warnings 涉及的内容不得表述为已验证。',
    'coverage_match 中的来源限制同样适用于图表说明；合成或版本未核实的数据不能标成实测未覆盖，变量边界的静态推导也不等于执行证据。',
    'context.json 已按当前流程裁剪；其中没有某函数或用例，不能推断整个 Run 没有相关用例，更不能据此断言该函数无测试覆盖。图表说明只描述当前图和实际提供的覆盖记录。',
    '只核对本图相关实现；语义疑点在会话报告，不能改主 Run 的报告、投影、风险、用例、状态。',
    `唯一写入目录：${folder}。编写 candidate.json；不要修改 manifest.json。`,
    '本回合只编写一个 candidate.json 并结束；不要调用 Archify validate/deliver 或 architecture-render。宿主会冻结本回合最终字节并执行严格校验和交付；失败诊断由宿主续接本会话。',
    `本次生成总预算 ${view.budget_ms / 60000} 分钟，共 ${view.max_render_attempts} 个候选（初稿和两次修复）；校验与交付计入总时间，交付不额外占候选次数。第三个候选仍由宿主验证，不换会话规避限制。`,
    '默认省略 phases、groups、mainPath、semanticChecks、固定宽度和手工路由；仅在表达真实语义所必需时添加。渲染验证不证明源码结论正确。',
    viewProfile === 'function_variables'
      ? '提交渲染前逐项自查并在 cards 保留证据：nodes 只有函数、宏、外部被调用函数；edges 逐条对应源码中的调用表达式（不是函数内控制流）；无调用关系的节点保持独立。Archify 的通用主路径建议不适用于独立函数，不添加 mainPath 来串联它们。长签名、内部计算和变量变化只放 cards，节点只用短符号与简短说明。'
      : '提交渲染前逐边核对源码依据，并核对 mainPath 中每一对相邻节点确有对应 edge；先完成状态更新，再返回。没有外部调度源码时不构造入口间的生命周期或周期循环。',
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
      const candidate = await readFile(path.join(root, entry.name, 'candidate.json')).catch(() => null)
      const digest = candidate && createHash('sha256').update(candidate).digest('hex')
      const validatedDigest = receipt?.candidate_sha256 ?? receipt?.specification?.sha256
      const candidate_unverified = Boolean(candidate && (!validatedDigest || digest !== validatedDigest))
      const available = Boolean(receipt?.ok && html && !candidate_unverified)
      const draft = Boolean((receipt?.draft || receipt?.previous_draft) && await readFile(path.join(root, entry.name, 'draft.html')).then(() => true, () => false))
      const preview_kind = receipt?.ok && html ? 'verified' : receipt?.draft && draft ? 'draft' : receipt?.previous_verified && html ? 'verified' : draft ? 'draft' : null
      const preview_is_previous = Boolean(preview_kind && (candidate_unverified || (preview_kind === 'verified' ? !receipt?.ok : !receipt?.draft)))
      let candidate_summary = null
      try {
        const spec = JSON.parse(candidate.toString('utf8'))
        candidate_summary = { nodes: (spec.nodes ?? []).map(n => ({ id: n.id, label: n.label })),
          edges: (spec.edges ?? []).map(e => ({ from: e.from, to: e.to, label: e.label })) }
      } catch { /* Invalid candidates retain compiler diagnostics. */ }
      // A rejected candidate can be repaired by the live Job. Its lifecycle,
      // reconciled by architecture-list, determines whether generation failed.
      items.push({ ...view, generation_events: events, diagnostic_path: path.join(root, entry.name, 'events.jsonl'), render_diagnostic_path: path.join(root, entry.name, 'render-history.jsonl'), render_exit_code: receipt?.exit_code, render_duration_ms: receipt?.duration_ms, candidate_unverified, candidate_summary, preview_is_previous, preview_kind, preview_diagnostics: preview_kind === 'draft' && !receipt?.draft ? receipt?.previous_draft?.diagnostics ?? [] : receipt?.diagnostics ?? [], preview_available: Boolean(preview_kind), status: view.status === 'stopped' ? 'stopped' : available ? 'ready' : view.status, available,
        error: available ? null : view.error,
        validation_error: receipt?.ok === false ? receipt.error || '图表尚未通过校验' : null,
        validation_diagnostics: receipt?.ok === false ? receipt.diagnostics ?? [] : [] })
    } catch { /* Keep unreadable view isolated from main analysis. */ }
  }
  return items.sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export async function viewArtifact(task, viewId, format, variant = 'verified') {
  await loadView(task, viewId)
  if (!['html', 'svg'].includes(format)) throw new Error('Unsupported diagram format')
  const root = await viewRoot(task, viewId)
  if (!['verified', 'draft'].includes(variant)) throw new Error('Unsupported diagram variant')
  const receipt = await readJson(path.join(root, 'validation-receipt.json'))
  if (variant === 'draft' && !receipt.draft && !receipt.previous_draft || variant === 'verified' && !receipt.ok && !receipt.previous_verified) throw new Error('当前收据不包含此产物')
  const file = await realpath(path.join(root, `${variant === 'draft' ? 'draft' : 'diagram'}.${format}`))
  if (path.dirname(file) !== root) throw new Error('Artifact outside view directory')
  return readFile(file)
}
