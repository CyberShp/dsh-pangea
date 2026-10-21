import { normalizeFlow } from './flow-normalize.js'
import { layoutFlow, layoutCallGraph } from './flow-graph/layout.js'
import { renderFlowTree, renderCallGraphTree, toSvgString } from './flow-graph/render.js'
import { normalizeSequence, layoutSequence, renderSequenceTree } from './sequence-diagram.js'
import { validateCallGraph } from './call-graph.js'
import { buildModuleOverview } from './module-overview.js'
import { zipStore } from './export.js'
import { diagramDiagnostics } from './diagram-contract.js'
import { createHash } from 'node:crypto'

export const OFFLINE_RENDERER_VERSION = 'pangea-native-diagrams-v1/offline-1'
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const json = value => JSON.stringify(value, null, 2)
export const reportContentHash = value => createHash('sha256').update(value).digest('hex')
export function reportSnapshotHash(run) {
  return reportContentHash(JSON.stringify({ run_id: run.run_id, publication: run.publication, lifecycle_status: run.lifecycle_status,
    report_available: run.report_available, units: run.workflow?.units, actions: run.workflow?.actions, details: run.details,
    report_md: run.artifacts?.report_md, report_complete: run.artifacts?.report_complete }))
}

// The caller passes one detached Run snapshot. All images, diagnostics and raw
// records below consume that same snapshot; no model or history scan is involved.
export function buildOfflineReport(run, { originalText = '', originalTextDiagnostic = '', consistency = { snapshot_window: 'not_verified' }, publicationManifest = null } = {}) {
  const snapshot = structuredClone(run)
  const overview = buildModuleOverview(snapshot)
  const diagnostics = []
  const entries = []
  const manifest = { run_id: snapshot.run_id, publication: snapshot.publication ?? null,
    published_versions: snapshot.workflow?.actions?.map(({ action_id, accepted_revision, revision }) => ({ action_id, accepted_revision, revision })) ?? [],
    renderer_version: OFFLINE_RENDERER_VERSION, snapshot_sha256: reportSnapshotHash(snapshot), original_text_sha256: reportContentHash(originalText),
    records: overview.flows.map(({ flow }) => ({ unit_id: flow.unit_id, flow_id: flow.flow_id, record_id: flow.source_record?.record_id ?? null,
      revision: flow.source_record?.revision ?? null, sha256: reportContentHash(json(flow.source_record?.body ?? flow)) })), consistency, publication_manifest: publicationManifest }
  if (originalTextDiagnostic) diagnostics.push({ kind: 'text_report', message: originalTextDiagnostic })
  const sections = overview.flows.map((row, index) => {
    const flow = row.flow
    diagnostics.push(...diagramDiagnostics(flow.source_record?.body ?? flow).map(item => ({ ...item, unit_id: flow.unit_id, flow_id: flow.flow_id })))
    const figures = [['flow', '流程图'], ['sequence', '时序图'], ['call', '函数调用图']].map(([kind, title]) => {
      let tree, errors = []
      try {
        if (kind === 'flow') {
          const graph = normalizeFlow(flow)
          errors = [...(graph.structure_errors ?? []), ...(graph.projection_warnings ?? [])]
          if (!graph.nodes?.length) errors.push('没有可绘制节点；原始文字与记录完整保留。')
          tree = renderFlowTree(layoutFlow(graph))
        } else if (kind === 'sequence') {
          if (flow.sequence == null) errors.push('当前记录未提供 sequence；无法绘制时序图。')
          else { const result = normalizeSequence(flow.sequence); errors = result.errors ?? []; tree = renderSequenceTree(layoutSequence(result.graph)) }
        } else {
          if (flow.call_graph == null) errors.push('当前记录未提供 call_graph；无法绘制函数调用图。')
          else { const result = validateCallGraph(flow.call_graph); errors = result.errors ?? []; tree = renderCallGraphTree(layoutCallGraph(result.graph)) }
        }
        const svg = tree ? toSvgString(tree) : ''
        errors.forEach(message => diagnostics.push({ unit_id: flow.unit_id, flow_id: flow.flow_id, diagram: kind, message }))
        const filename = `diagrams/flow-${index + 1}-${kind}.svg`
        if (svg) entries.push([filename, svg])
        // Image documents isolate repeated marker/node ids across units and
        // prevent authored data from becoming active HTML.
        return `<figure><figcaption>${title}</figcaption>${errors.length ? `<pre class="diagnostic">${escape(errors.join('\n'))}</pre>` : ''}${svg ? `<img alt="${escape(title)}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">` : '<p>图未生成；请查看下方原始记录。</p>'}</figure>`
      } catch (error) {
        diagnostics.push({ unit_id: flow.unit_id, flow_id: flow.flow_id, diagram: kind, message: error.message })
        return `<figure><figcaption>${title}</figcaption><pre class="diagnostic">绘图失败：${escape(error.message)}。原始记录完整保留。</pre></figure>`
      }
    }).join('')
    return `<section id="flow-${index + 1}"><h2>${escape(flow.unit_id)} / ${escape(flow.title || flow.flow_id)}</h2><p>${escape(row.category)} · ${escape(row.relationship)}</p>${figures}<details open><summary>完整流程事实与证据</summary><pre>${escape(json(flow))}</pre></details></section>`
  }).join('')
  const moduleSummary = overview.units.map(unit => `<li>${escape(unit.title || unit.unit_id)}${unit.flows.length ? `<ul>${unit.flows.map(row => `<li><a href="#flow-${row.index + 1}">${escape(row.flow.title || row.flow.flow_id)}</a> · ${escape(row.category)} · ${escape(row.relationship)}</li>`).join('')}</ul>` : '<p>当前没有已发布流程，入口及关系未知。</p>'}</li>`).join('')
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>PANGEA ${escape(snapshot.run_id)} 离线报告</title><style>body{font:15px/1.65 system-ui,sans-serif;color:#17212e;margin:32px auto;padding:0 24px;max-width:1200px}a{color:#175c9f}section,figure{border-top:1px solid #d5dce4;margin:28px 0;padding-top:16px}figure{margin-left:0;margin-right:0;overflow:auto}img{display:block;max-width:none}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f6f8;padding:16px}.diagnostic{color:#884b12;background:#fff4df}summary{cursor:pointer}figcaption{font-weight:700}</style></head><body><h1>PANGEA 离线图文报告</h1><pre>${escape(json(manifest))}</pre><h2>模块总览</h2><p>${escape(overview.note)}</p><ul>${moduleSummary}</ul><h2>原文字报告</h2>${originalTextDiagnostic ? `<p class="diagnostic">${escape(originalTextDiagnostic)}</p>` : ''}<pre>${escape(originalText || '当前 Run 未提供文字报告。')}</pre>${sections}<h2>绘图与读取诊断</h2><pre>${escape(json(diagnostics))}</pre><details><summary>完整冻结快照</summary><pre>${escape(json(snapshot))}</pre></details></body></html>`
  entries.unshift(['report.html', html], ['report.md', originalText], ['facts.json', json(snapshot)], ['manifest.json', json(manifest)], ['diagnostics.json', json(diagnostics)])
  return { html, diagnostics, manifest, entries, bytes: zipStore(entries) }
}
