import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export const DIAGRAM_TYPES = ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']
const stamp = () => new Date().toISOString()
const readJson = async file => JSON.parse(await readFile(file, 'utf8'))
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

export async function updateView(task, viewId, changes) {
  const view = await loadView(task, viewId)
  const updated = { ...view, ...changes, updated_at: stamp() }
  await writeFile(path.join(await viewRoot(task, viewId), 'manifest.json'), JSON.stringify(updated, null, 2))
  return updated
}

export async function createView(task, { type = 'workflow', flow_id = null, previous_view_id = null } = {}, env = process.env) {
  if (!DIAGRAM_TYPES.includes(type)) throw new Error('Unsupported diagram type')
  const archify = env.PANGEA_ARCHIFY_ROOT
  if (!archify) throw new Error('Archify runtime unavailable')
  await readFile(path.join(archify, 'SKILL.md'))
  await readFile(path.join(archify, 'bin/archify.mjs'))
  const root = await viewRoot(task)
  const run = path.resolve(root, '../..')
  const projection = await readJson(path.join(run, '内部索引/工作台投影.json'))
  const flow = flow_id ? projection.business_flows?.find(item => item.flow_id === flow_id) : null
  if (flow_id && !flow) throw new Error('Selected flow is not in the published projection')
  const previous = previous_view_id ? await loadView(task, previous_view_id) : null
  const viewId = randomUUID()
  const folder = path.join(root, viewId)
  await mkdir(folder)
  const context = flow ? {
    business_flows: [flow],
    risks: (projection.risks ?? []).filter(r => r.flow_id === flow_id || (flow.branches ?? []).some(b => b.linked_risk_ids?.includes(r.risk_id))),
    test_cases: (projection.test_cases ?? []).filter(c => c.flow_id === flow_id || (flow.branches ?? []).some(b => b.linked_test_case_ids?.includes(c.test_case_id))),
    evidence: projection.evidence ?? [],
  } : projection
  await writeFile(path.join(folder, 'context.json'), JSON.stringify(context, null, 2))
  if (previous) {
    const candidate = await readFile(path.join(await viewRoot(task, previous.view_id), 'candidate.json'))
    await writeFile(path.join(folder, 'candidate.json'), candidate)
  }
  const view = { view_id: viewId, task_id: task.task_id, run_id: task.run_id, flow_id, type,
    source_revision: projection.publication?.revision ?? null, status: 'generating',
    previous_view_id, session_id: null, job_id: null, created_at: stamp(), updated_at: stamp() }
  await writeFile(path.join(folder, 'manifest.json'), JSON.stringify(view, null, 2))
  const renderer = fileURLToPath(new URL('./architecture-render.mjs', import.meta.url))
  return { view, prompt: [
    `为 ${task.target} 创建 ${type} 架构视图。${previous ? '这是关联的新画图会话，从 candidate.json 继续修改。' : ''}`,
    `先读取 ${path.join(archify, 'SKILL.md')}，按需读对应 schema/example；PANGEA 集成约定优先：不运行更新检查，不访问外网，不要求公开仓库，不读取秘密配置。`,
    `已发布上下文：${path.join(folder, 'context.json')}。冻结源码：${path.join(run, 'inputs/source/repository')}。`,
    '只核对本图相关实现；语义疑点在会话报告，不能改主 Run 的报告、投影、风险、用例、状态。',
    `唯一写入目录：${folder}。编写 candidate.json；不要修改 manifest.json。`,
    `完成后使用参数数组调用 Node：${env.PANGEA_NODE || process.execPath}，参数 ${JSON.stringify([renderer, folder, archify])}。PowerShell 路径须字面引用。`,
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
      const html = await readFile(path.join(root, entry.name, 'diagram.html')).then(() => true, () => false)
      items.push({ ...view, status: view.status === 'stopped' ? 'stopped' : receipt?.ok && html ? 'ready' : receipt && !receipt.ok ? 'failed' : view.status, available: Boolean(receipt?.ok && html) })
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
