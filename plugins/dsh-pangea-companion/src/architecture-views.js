// Read-only access to historical diagram artifacts. New diagrams are Agent-authored
// fields on flow records and rendered locally; this module never starts a worker,
// validates candidates, runs a renderer, creates directories, or changes a Run.
import path from 'node:path'
import { createHash } from 'node:crypto'
import { readFile as fsReadFile, readdir, realpath } from 'node:fs/promises'

export const CALL_GRAPH_RENDERER = 'call-graph'
const isCallGraph = view => view?.renderer === CALL_GRAPH_RENDERER
// Historical files are data, not trusted paths: do not follow file symlinks
// outside their already bound view directory.
async function readFile(file, encoding) {
  const parent = await realpath(path.dirname(file))
  const resolved = await realpath(file)
  if (path.dirname(resolved) !== parent) throw new Error('Artifact outside view directory')
  return fsReadFile(resolved, encoding)
}
const readJson = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''))
const safeId = id => {
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new Error('Invalid architecture identity')
  return id
}

export async function viewRoot(task, viewId) {
  const runs = await realpath(path.join(task.data_root, 'runs'))
  const run = await realpath(path.join(runs, safeId(task.run_id)))
  if (path.dirname(run) !== runs) throw new Error('Run outside data root')
  // Keep the old storage path so existing generated HTML/SVG remain readable.
  const root = await realpath(path.join(run, '派生视图', 'archify'))
  if (path.relative(run, root).startsWith('..') || path.isAbsolute(path.relative(run, root))) throw new Error('Views outside Run')
  return viewId ? path.join(root, safeId(viewId)) : root
}

export async function loadView(task, viewId) {
  const resolved = await realpath(await viewRoot(task, viewId))
  const base = await viewRoot(task)
  if (path.dirname(resolved) !== base) throw new Error('View outside bound directory')
  const manifest = await realpath(path.join(resolved, 'manifest.json'))
  if (path.dirname(manifest) !== resolved) throw new Error('Manifest outside view directory')
  const view = await readJson(manifest)
  if (view.task_id !== task.task_id || view.run_id !== task.run_id || view.view_id !== viewId) throw new Error('Architecture binding mismatch')
  return view
}

function archiveState(view) {
  const pending = ['generating', 'starting', 'running', 'stopping'].includes(view.status)
  return { ...view, archived: true, read_only: true, execution_status: 'archived',
    status: pending ? 'interrupted' : view.status,
    error: pending ? view.error || '历史画图任务已归档；新图随分析记录提供，已有产物保留。' : view.error }
}

export async function listViews(task) {
  if (!task?.run_id) return []
  let root, entries
  try {
    root = await viewRoot(task)
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) { if (error.code === 'ENOENT') return []; throw error }
  const items = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    try {
      const view = await loadView(task, entry.name)
      let receipt
      try { receipt = await readJson(path.join(root, entry.name, 'validation-receipt.json')) } catch { /* pending */ }
      const events = await readFile(path.join(root, entry.name, 'events.jsonl'), 'utf8').then(value => value.trim().split('\n').slice(-50).flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } }), () => [])
      if (isCallGraph(view)) {
        items.push(await listCallGraphView(root, entry.name, view, receipt, events))
        continue
      }
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
      items.push({ ...view, generation_events: events, diagnostic_path: path.join(root, entry.name, 'events.jsonl'), render_diagnostic_path: path.join(root, entry.name, 'render-history.jsonl'), render_exit_code: receipt?.exit_code, render_duration_ms: receipt?.duration_ms, candidate_unverified, candidate_summary, preview_is_previous, preview_kind, preview_diagnostics: preview_kind === 'draft' && !receipt?.draft ? receipt?.previous_draft?.diagnostics ?? [] : receipt?.diagnostics ?? [], preview_available: Boolean(preview_kind), status: view.status === 'stopped' ? 'stopped' : available ? 'ready' : view.status, available,
        error: available ? null : view.error,
        validation_error: receipt?.ok === false ? receipt.error || '图表尚未通过校验' : null,
        validation_diagnostics: receipt?.ok === false ? receipt.diagnostics ?? [] : [] })
    } catch { /* Keep unreadable view isolated from main analysis. */ }
  }
  return items.map(archiveState).sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
}

async function listCallGraphView(root, viewId, view, receipt, events) {
  let call_graph = null
  try { call_graph = await readJson(path.join(root, viewId, 'graph.json')) } catch { /* not yet validated */ }
  const candidate = await readFile(path.join(root, viewId, 'candidate.json')).catch(() => null)
  const candidate_unverified = !candidate || !receipt?.candidate_sha256 || createHash('sha256').update(candidate).digest('hex') !== receipt.candidate_sha256
  const preview_available = Boolean(receipt?.ok && call_graph)
  const available = preview_available && !candidate_unverified
  return { ...view, generation_events: events, diagnostic_path: path.join(root, viewId, 'events.jsonl'),
    call_graph, call_graph_status: preview_available ? receipt.status : null, call_graph_errors: receipt?.errors ?? [],
    candidate_unverified, candidate_summary: null, preview_is_previous: preview_available && candidate_unverified, preview_kind: preview_available ? 'verified' : null,
    preview_diagnostics: [], preview_available,
    status: view.status === 'stopped' ? 'stopped' : available ? 'ready' : view.status, available,
    error: available ? null : view.error,
    validation_error: receipt?.ok === false ? receipt.error || '调用图尚未通过结构校验' : null,
    validation_diagnostics: receipt?.ok === false ? receipt.errors ?? [] : [] }
}

const CALL_GRAPH_ARTIFACTS = { json: 'graph.json', svg: 'graph.svg' }

export async function viewArtifact(task, viewId, format, variant = 'verified') {
  const view = await loadView(task, viewId)
  if (isCallGraph(view)) {
    if (!CALL_GRAPH_ARTIFACTS[format] || variant !== 'verified') throw new Error('Unsupported diagram format')
    const root = await realpath(await viewRoot(task, viewId))
    const receipt = await readJson(path.join(root, 'validation-receipt.json'))
    if (!receipt.ok) throw new Error('当前收据不包含此产物')
    // Serve the previously validated graph; listing labels changed candidates as
    // previous previews. Retired jobs cannot revalidate a later draft.
    const file = await realpath(path.join(root, CALL_GRAPH_ARTIFACTS[format]))
    if (path.dirname(file) !== root) throw new Error('Artifact outside view directory')
    return readFile(file)
  }
  if (!['html', 'svg'].includes(format)) throw new Error('Unsupported diagram format')
  const root = await realpath(await viewRoot(task, viewId))
  if (!['verified', 'draft'].includes(variant)) throw new Error('Unsupported diagram variant')
  const receipt = await readJson(path.join(root, 'validation-receipt.json'))
  if (variant === 'draft' && !receipt.draft && !receipt.previous_draft || variant === 'verified' && !receipt.ok && !receipt.previous_verified) throw new Error('当前收据不包含此产物')
  const file = await realpath(path.join(root, `${variant === 'draft' ? 'draft' : 'diagram'}.${format}`))
  if (path.dirname(file) !== root) throw new Error('Artifact outside view directory')
  return readFile(file)
}
