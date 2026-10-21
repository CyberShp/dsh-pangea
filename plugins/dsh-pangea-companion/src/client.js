// Browser half of dsh-pangea-companion. It browses PANGEA results and starts
// separately stored executor runs without modifying analysis state.
window.__ModuleLoader__.load({
  id: 'dsh-pangea-companion',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    /* @inline-shared-modules */
    const { normalizeFlow: sharedNormalizeFlow } = __flowNormalize
    const { buildModuleOverview } = __moduleOverview
    const { diagramDiagnostics } = __diagramContract
    const { FLOW_KIND_COLORS, FLOW_KIND_LABELS, layoutFlow, pathMembers, pathsForNode, layoutCallGraph } = __flowLayout
    const { renderFlowTree, renderCallGraphTree, toSvgString, toInteractiveFlowSvg } = __flowRender
    const { validateCallGraph, callsForVariable } = __callGraph
    const { normalizeSequence, layoutSequence, renderSequenceTree } = __sequenceDiagram
    const { caseDesignCounts, caseSearchText, caseVariantLines, behaviorCoverageProjection, behaviorCoverageForCase, BEHAVIOR_STATUS_LABELS } = __behaviorCoverage
    const { renderReviewPresentation, reviewStatusLabel, isReviewRecord } = __reviewPresentation
    const { buildRunInsights } = __runInsights
    const { buildOverviewFindings } = __overviewFindings
    const { caseIdentity, filterTestCases, REVIEW_LABELS, CASE_TYPE_LABELS } = __caseReviewProjection
    const SourceScopePicker = __sourceScopePicker.createSourceScopePicker(React)
    function sourceFirstRecordBody(body) {
      if (body == null) return ''
      if (typeof body === 'string') return body
      try { return JSON.stringify(body, null, 2) } catch { return String(body) }
    }
    // Lucide 1.8.0, ISC; shared visual vocabulary with the approved shell.
    const runIcons = {"Sparkles":[["path",{"d":"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"}],["path",{"d":"M20 2v4"}],["path",{"d":"M22 4h-4"}],["circle",{"cx":"4","cy":"20","r":"2"}]],"ArrowLeft":[["path",{"d":"m12 19-7-7 7-7"}],["path",{"d":"M19 12H5"}]],"Square":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}]],"FileText":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M10 9H8"}],["path",{"d":"M16 13H8"}],["path",{"d":"M16 17H8"}]],"ListFilter":[["path",{"d":"M2 5h20"}],["path",{"d":"M6 12h12"}],["path",{"d":"M9 19h6"}]],"LockKeyhole":[["circle",{"cx":"12","cy":"16","r":"1"}],["rect",{"x":"3","y":"10","width":"18","height":"12","rx":"2"}],["path",{"d":"M7 10V7a5 5 0 0 1 10 0v3"}]],"ChevronRight":[["path",{"d":"m9 18 6-6-6-6"}]],"X":[["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]],"ArrowUpRight":[["path",{"d":"M7 7h10v10"}],["path",{"d":"M7 17 17 7"}]],"RefreshCw":[["path",{"d":"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"}],["path",{"d":"M21 3v5h-5"}],["path",{"d":"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"}],["path",{"d":"M8 16H3v5"}]],"CircleAlert":[["circle",{"cx":"12","cy":"12","r":"10"}],["line",{"x1":"12","x2":"12","y1":"8","y2":"12"}],["line",{"x1":"12","x2":"12.01","y1":"16","y2":"16"}]],"Info":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 16v-4"}],["path",{"d":"M12 8h.01"}]],"Play":[["path",{"d":"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"}]],"ScanSearch":[["path",{"d":"M3 7V5a2 2 0 0 1 2-2h2"}],["path",{"d":"M17 3h2a2 2 0 0 1 2 2v2"}],["path",{"d":"M21 17v2a2 2 0 0 1-2 2h-2"}],["path",{"d":"M7 21H5a2 2 0 0 1-2-2v-2"}],["circle",{"cx":"12","cy":"12","r":"3"}],["path",{"d":"m16 16-1.9-1.9"}]],"ShieldAlert":[["path",{"d":"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}],["path",{"d":"M12 8v4"}],["path",{"d":"M12 16h.01"}]],"GitBranch":[["path",{"d":"M15 6a9 9 0 0 0-9 9V3"}],["circle",{"cx":"18","cy":"6","r":"3"}],["circle",{"cx":"6","cy":"18","r":"3"}]],"ChartNoAxesCombined":[["path",{"d":"M12 16v5"}],["path",{"d":"M16 14v7"}],["path",{"d":"M20 10v11"}],["path",{"d":"m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15"}],["path",{"d":"M4 18v3"}],["path",{"d":"M8 14v7"}]],"ArrowRight":[["path",{"d":"M5 12h14"}],["path",{"d":"m12 5 7 7-7 7"}]],"ShieldCheck":[["path",{"d":"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}],["path",{"d":"m9 12 2 2 4-4"}]],"Plus":[["path",{"d":"M5 12h14"}],["path",{"d":"M12 5v14"}]],"CircleCheck":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m9 12 2 2 4-4"}]],"Library":[["path",{"d":"m16 6 4 14"}],["path",{"d":"M12 6v14"}],["path",{"d":"M8 8v12"}],["path",{"d":"M4 4v16"}]],"Search":[["path",{"d":"m21 21-4.34-4.34"}],["circle",{"cx":"11","cy":"11","r":"8"}]],"FolderOpen":[["path",{"d":"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"}]],"Cpu":[["path",{"d":"M12 20v2"}],["path",{"d":"M12 2v2"}],["path",{"d":"M17 20v2"}],["path",{"d":"M17 2v2"}],["path",{"d":"M2 12h2"}],["path",{"d":"M2 17h2"}],["path",{"d":"M2 7h2"}],["path",{"d":"M20 12h2"}],["path",{"d":"M20 17h2"}],["path",{"d":"M20 7h2"}],["path",{"d":"M7 20v2"}],["path",{"d":"M7 2v2"}],["rect",{"x":"4","y":"4","width":"16","height":"16","rx":"2"}],["rect",{"x":"8","y":"8","width":"8","height":"8","rx":"1"}]],"SquareTerminal":[["path",{"d":"m7 11 2-2-2-2"}],["path",{"d":"M11 13h4"}],["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2","ry":"2"}]],"Copy":[["rect",{"width":"14","height":"14","x":"8","y":"8","rx":"2","ry":"2"}],["path",{"d":"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"}]],"FolderGit2":[["path",{"d":"M18 19a5 5 0 0 1-5-5v8"}],["path",{"d":"M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5"}],["circle",{"cx":"13","cy":"12","r":"2"}],["circle",{"cx":"20","cy":"19","r":"2"}]],"FolderPlus":[["path",{"d":"M12 10v6"}],["path",{"d":"M9 13h6"}],["path",{"d":"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"}]],"Terminal":[["path",{"d":"M12 19h8"}],["path",{"d":"m4 17 6-6-6-6"}]],"FileUp":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M12 12v6"}],["path",{"d":"m15 15-3-3-3 3"}]],"Check":[["path",{"d":"M20 6 9 17l-5-5"}]],"Files":[["path",{"d":"M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8"}],["path",{"d":"M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z"}],["path",{"d":"M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1"}]],"Settings":[["path",{"d":"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"}],["circle",{"cx":"12","cy":"12","r":"3"}]],"LoaderCircle":[["path",{"d":"M21 12a9 9 0 1 1-6.219-8.56"}]]}
    runIcons.ScanLine = [
      ['path', { d: 'M3 7V5a2 2 0 0 1 2-2h2' }],
      ['path', { d: 'M17 3h2a2 2 0 0 1 2 2v2' }],
      ['path', { d: 'M21 17v2a2 2 0 0 1-2 2h-2' }],
      ['path', { d: 'M7 21H5a2 2 0 0 1-2-2v-2' }],
      ['path', { d: 'M7 12h10' }],
    ]
    function runIcon(name) {
      return h('svg', { className: 'lucide', width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.65, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, runIcons[name].map(([tag, props], key) => h(tag, { ...props, key })))
    }
    function workflowEvents(current, launchEvents = []) {
      const stages = { unit_planning: 'planning', source_first_plan: 'planning', unit_analysis: 'analyzing', independent_review: 'reviewing', comparison_review: 'reviewing', targeted_closure: 'closing' }
      const actions = current?.workflow?.actions ?? []
      const groups = current?.source_first_records ?? []
      const recordFor = actionId => groups.find(group => group.action_id === actionId)?.records?.at(-1)
      const result = launchEvents.map((event, index) => {
        const action = actions.find(item => item.action_id === event.action_id)
        const record = recordFor(event.action_id)
        return { key: `launch-${index}`, time: event.at, step: event.step, title: event.message || event.stage,
          detail: event.detail || event.error_summary, stage: stages[action?.stage] ?? event.phase ?? stages[event.stage],
          evidence: record?.evidence ?? [], relates_to: record?.relates_to ?? [], summary: record?.body?.summary }
      })
      for (const group of groups) {
        if (launchEvents.some(event => event.action_id === group.action_id)) continue
        const progress = current.execution_progress?.find(item => item.action_id === group.action_id)
        const record = group.records?.at(-1)
        if (!record) continue
        const body = record.body
        result.push({ key: `${group.action_id}:${record.record_id}`, time: progress?.last_saved_at_ms,
          stage: stages[group.stage], title: body?.title || RECORD_LABELS[record.kind] || '阶段记录已保存',
          detail: typeof body === 'string' ? body : body?.description || body?.summary,
          summary: body?.summary, evidence: record.evidence ?? [], relates_to: record.relates_to ?? [] })
      }
      return result
    }
    function CreateAssetPicker({ items, selectedAssets, loading, error, pagination, query, type, repositoryOnly, repository, typeLabels, onQuery, onSearch, onType, onRepository, onPage, onRefresh, onClose, onConfirm }) {
      const [pending, setPending] = React.useState(() => Object.fromEntries(selectedAssets.map(item => [item.asset_id, item])))
      const dialog = React.useRef(null)
      React.useEffect(() => {
        const trigger = document.activeElement
        dialog.current?.querySelector('button')?.focus()
        return () => { trigger?.focus?.({ preventScroll: true }) }
      }, [])
      const keyDown = event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
        if (event.key !== 'Tab') return
        const controls = Array.from(dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')).filter(node => node.getClientRects().length)
        const first = controls[0], last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
      const button = (label, onClick, variant = '', disabled = false) => h('button', { type: 'button', className: `btn ${variant}`, onClick, disabled }, label)
      const toggle = item => setPending(value => {
        const next = { ...value }
        if (next[item.asset_id]) delete next[item.asset_id]
        else next[item.asset_id] = item
        return next
      })
      return h('div', { className: 'overlay', onKeyDown: keyDown }, h('section', { className: 'modal wide create-asset-picker', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'create-assets-title', ref: dialog },
        h('div', { className: 'modal-head' }, h('div', null, h('h2', { id: 'create-assets-title', className: 'overlay-title', style: { margin: '0 0 7px' } }, '选择分析资产'), h('p', { className: 'create-copy', style: { marginBottom: 0 } }, '选择需求、设计、历史缺陷或覆盖率资料，创建时保存对应版本。')), h('button', { type: 'button', className: 'create-close', 'aria-label': '关闭', onClick: onClose }, runIcon('X'))),
        h('form', { className: 'toolbar', style: { margin: '24px 0 20px' }, onSubmit: event => { event.preventDefault(); onSearch() } }, h('div', { className: 'search' }, h('input', { 'aria-label': '搜索资产', placeholder: '搜索标题或文件名', value: query, onChange: event => onQuery(event.target.value) })), h('select', { 'aria-label': '资产类型', style: { width: 150 }, value: type, onChange: event => onType(event.target.value) }, h('option', { value: '' }, '全部类型'), Object.entries(typeLabels).map(([value, label]) => h('option', { key: value, value }, label))), h('select', { 'aria-label': '资产仓库范围', style: { width: 'auto', marginLeft: 'auto', borderColor: 'transparent', fontSize: 12 }, value: repositoryOnly ? 'repository' : 'all', onChange: event => onRepository(event.target.value === 'repository') }, h('option', { value: 'all' }, `全部仓库 · ${pagination?.total ?? items.length} 份资料`), h('option', { value: 'repository', disabled: !repository }, `仓库：${repository}`))),
        loading && h('p', { role: 'status' }, '正在读取可用资产…'), error && h('div', { role: 'alert' }, error, button('重试', onRefresh)),
        h('table', null, h('thead', null, h('tr', null, ['', '资产名称', '类型', '版本', '状态'].map((label, index) => h('th', { key: index }, label)))), h('tbody', null, items.map(item => h('tr', { key: item.asset_id },
          h('td', { style: { width: 35 } }, h('input', { type: 'checkbox', 'aria-label': `选择${item.title}`, checked: !!pending[item.asset_id], disabled: item.status !== 'available', onChange: () => toggle(item) })),
          h('td', null, h('strong', { style: { fontSize: 14 } }, item.title), h('div', { className: 'tiny muted', style: { marginTop: 6 } }, item.source_name ?? item.source_path)), h('td', null, h('span', { className: 'badge' }, typeLabels[item.asset_type] ?? item.asset_type)), h('td', { className: 'mono small' }, item.revision == null ? '待读取' : `r${item.revision}`), h('td', null, h('span', { className: `badge ${item.status === 'available' ? 'good' : 'warn'}` }, item.status === 'available' ? '可用' : item.status)))))),
        !loading && !error && !items.length && h('p', { className: 'muted' }, '没有匹配的资料，试试其他关键词或筛选条件。'),
        pagination?.total_pages > 1 && h('div', { className: 'row', style: { marginTop: 12 } }, button('上一页', () => onPage(pagination.page - 1), '', loading || pagination.page <= 1), h('span', null, `第 ${pagination.page} / ${pagination.total_pages} 页`), button('下一页', () => onPage(pagination.page + 1), '', loading || pagination.page >= pagination.total_pages)),
        h('div', { className: 'modal-footer' }, h('span', { className: 'small muted', style: { marginRight: 'auto' } }, `已选 ${Object.keys(pending).length} 份资产`), button('取消', onClose, 'ghost'), button('使用所选资产并返回', () => onConfirm(Object.values(pending)), 'primary'))))
    }

    function derivationInput(draft) {
      return {
        mode: draft.mode,
        instruction: draft.instruction.trim(),
        selected_unit_ids: [...new Set(draft.selected_unit_ids ?? [])],
        selected_records: (draft.selected_records ?? []).map(({ action_id, record_id }) => ({ action_id, record_id })),
        changed_paths: draft.mode === 'changed-files' ? [...new Set((draft.changed_paths_text ?? '').split(/\r?\n/).map(value => value.trim()).filter(Boolean))] : [],
      }
    }
    function RunDerivationDialog({ state, onChange, onClose, onSubmit, onRetry }) {
      const dialog = React.useRef(null)
      React.useEffect(() => {
        const previous = document.activeElement
        dialog.current?.querySelector('button:not(:disabled)')?.focus()
        return () => { previous?.focus?.({ preventScroll: true }) }
      }, [])
      const busy = Boolean(state.pending)
      const options = state.options
      const draft = state.draft
      const input = derivationInput(draft)
      const change = values => onChange({ ...draft, ...values })
      const key = record => JSON.stringify([record.action_id, record.record_id])
      const selected = new Set(draft.selected_records.map(key))
      const query = (draft.query ?? '').trim().toLocaleLowerCase()
      const records = (options?.records ?? []).filter(record => !query || [record.title, record.kind, record.unit_id, record.record_id].some(value => String(value ?? '').toLocaleLowerCase().includes(query)))
      const allowed = options?.can_derive === true
      const ready = allowed && !busy && (input.mode === 'changed-files' ? input.changed_paths.length > 0 : Boolean(input.instruction))
      const button = (label, onClick, primary = false, disabled = false) => h('button', { type: 'button', onClick, disabled,
        style: { ...styles.button, ...(primary ? styles.primaryButton : {}), width: 'auto', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .55 : 1 } }, label)
      const fieldStyle = { ...styles.textarea, background: '#fff', borderColor: '#dce0dd', color: '#25292e', fontFamily: 'inherit' }
      const onKeyDown = event => {
        if (event.key === 'Escape' && state.pending !== 'create') { event.preventDefault(); event.stopPropagation(); onClose() }
        if (event.key !== 'Tab') return
        const controls = Array.from(dialog.current?.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)') ?? []).filter(node => node.getClientRects().length)
        const first = controls[0], last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
      return h('div', { className: 'pangea-derivation-overlay', onKeyDown,
        style: { position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'rgba(25,31,28,.35)' } },
        h('section', { ref: dialog, role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'pangea-derivation-title',
          style: { width: 772, maxWidth: '100%', boxSizing: 'border-box', maxHeight: 'calc(100vh - 40px)', overflowY: 'auto', padding: 26, borderRadius: 12, background: '#fff', color: '#25292e', boxShadow: '0 16px 60px #0002', fontFamily: 'var(--pangea-font, "Segoe UI", "Microsoft YaHei UI", sans-serif)' } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'start' } },
            h('div', null, h('h2', { id: 'pangea-derivation-title', style: { margin: 0, fontSize: 21 } }, '基于此结果继续分析'),
              h('p', { style: { fontSize: 12, color: '#70767d', lineHeight: 1.8 } }, `来源：${state.title} · ${state.run_id}`)),
            h('button', { type: 'button', 'aria-label': '关闭增量分析', disabled: state.pending === 'create', onClick: onClose, style: styles.button }, runIcon('X'))),
          h('div', { role: 'group', 'aria-label': '继续分析方式', style: { display: 'flex', gap: 10, margin: '8px 0 18px' } },
            [['supplement', '定向补充'], ['changed-files', '按变更文件分析']].map(([mode, label]) => h('button', { key: mode, type: 'button', 'aria-pressed': draft.mode === mode, disabled: busy,
              onClick: () => change({ mode }), style: { ...styles.button, borderColor: draft.mode === mode ? '#c7000b' : '#e5e7e4', color: draft.mode === mode ? '#c7000b' : '#505956' } }, label))),
          h('p', { style: { fontSize: 14, color: '#59655e', lineHeight: 1.8, padding: 13, borderRadius: 7, background: '#f5f7f5' } }, draft.mode === 'supplement'
            ? '使用原分析保存的源码和资料，补充指定场景。新结果单独保存，并关联原分析。'
            : '读取当前工作区仓库中的指定文件，与原分析保存的版本对照，检查受影响的流程和用例。请先将新源码放入该仓库。'),
          h('label', { style: { display: 'block', fontSize: 14, margin: '18px 0 8px' } }, draft.mode === 'changed-files' ? '本次分析要求（选填）' : '本次分析要求',
            h('textarea', { 'aria-label': '本次分析要求', value: draft.instruction, disabled: busy,
              placeholder: draft.mode === 'supplement' ? '例如：只补充 TLS 断链后的资源释放与恢复场景。' : '例如：检查这次修改影响哪些异常分支，更新相关测试用例。',
              style: { ...fieldStyle, marginTop: 8 }, onChange: event => change({ instruction: event.target.value }) })),
          draft.mode === 'changed-files' ? h('label', { style: { display: 'block', fontSize: 14, margin: '16px 0' } }, '变更文件（相对源码仓库，每行一个）',
            h('textarea', { 'aria-label': '变更文件', value: draft.changed_paths_text, disabled: busy, placeholder: 'src/tcp/tls.c\nsrc/tcp/session.c',
              style: { ...fieldStyle, fontFamily: 'Consolas, monospace', marginTop: 8 }, onChange: event => change({ changed_paths_text: event.target.value }) }),
            h('small', { style: { display: 'block', color: '#70767d', marginTop: 7 } }, '可填写新增、修改或删除的文件；相关依赖由分析过程核对。')) : null,
          state.pending === 'options' ? h('p', { role: 'status' }, '正在读取原分析的单元和结果…') : null,
          state.error ? h('div', { role: 'alert', style: { ...styles.healthError, padding: 12, borderRadius: 7, margin: '12px 0' } }, state.error,
            h('div', { style: { marginTop: 8 } }, button('重新读取', onRetry, false, busy))) : null,
          state.notice ? h('p', { role: 'status', style: { fontSize: 12, color: '#906d30' } }, state.notice) : null,
          options && !allowed ? h('p', { role: 'alert' }, options.blocked_reason ?? options.reason ?? options.message ?? '当前分析暂不能用于创建增量任务。') : null,
          allowed ? h('details', { open: Boolean(draft.selected_unit_ids.length || draft.selected_records.length), style: { margin: '18px 0', border: '1px solid #e5e7e4', borderRadius: 8, padding: 14 } },
            h('summary', { style: { cursor: 'pointer', fontSize: 14 } }, `限定参考结果（可选） · 已选 ${draft.selected_unit_ids.length} 个单元、${draft.selected_records.length} 条记录`),
            h('p', { style: { color: '#70767d', fontSize: 12, lineHeight: 1.7 } }, '不勾选时，按本次要求定位原分析中的相关内容；勾选后优先围绕所选内容展开。'),
            (options.units ?? []).length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 12, margin: '14px 0' } }, options.units.map(unit => h('label', { key: unit.unit_id, style: { display: 'flex', gap: 6, fontSize: 12, alignItems: 'center' } },
              h('input', { type: 'checkbox', disabled: busy, checked: draft.selected_unit_ids.includes(unit.unit_id), 'aria-label': `选择单元 ${unit.title || unit.unit_id}`,
                onChange: event => change({ selected_unit_ids: event.target.checked ? [...draft.selected_unit_ids, unit.unit_id] : draft.selected_unit_ids.filter(id => id !== unit.unit_id) }) }), unit.title || unit.unit_id))) : null,
            h('input', { type: 'search', 'aria-label': '搜索参考记录', value: draft.query ?? '', placeholder: '搜索流程、用例或风险', disabled: busy,
              style: { ...fieldStyle, minHeight: 0, marginBottom: 10 }, onChange: event => change({ query: event.target.value }) }),
            h('div', { style: { maxHeight: 200, overflowY: 'auto' } }, records.slice(0, 60).map(record => h('label', { key: key(record), style: { display: 'flex', gap: 8, alignItems: 'start', padding: '8px 0', fontSize: 12, borderBottom: '1px solid #f0f2ef' } },
              h('input', { type: 'checkbox', disabled: busy, checked: selected.has(key(record)), 'aria-label': `选择记录 ${record.title || record.record_id}`,
                onChange: event => change({ selected_records: event.target.checked ? [...draft.selected_records, { action_id: record.action_id, record_id: record.record_id }] : draft.selected_records.filter(item => key(item) !== key(record)) }) }),
              h('span', null, record.title || record.record_id, h('small', { style: { display: 'block', marginTop: 4, color: '#70767d' } }, `${RECORD_LABELS[record.kind] || record.kind || '记录'} · ${record.unit_id || record.action_id} · ${record.record_id}`))))),
            records.length > 60 ? h('p', { style: { fontSize: 12, color: '#70767d' } }, `当前展示前 60 条，共 ${records.length} 条；输入关键词定位其他记录。`) : null,
            !records.length ? h('p', { style: { fontSize: 12, color: '#70767d' } }, '没有匹配的参考记录。') : null) : null,
          h('div', { style: { display: 'flex', gap: 10, justifyContent: 'flex-end', borderTop: '1px solid #e5e7e4', paddingTop: 18 } },
            button('取消', onClose, false, state.pending === 'create'),
            button(state.pending === 'create' ? '正在创建…' : '创建并开始分析', () => onSubmit(input), true, !ready))))
    }

    function executionObservation(current, task, stale = false) {
      const view = current?.execution_view
      if (!view || current.workflow_version !== 'source-first-v1') return null
      const presentation = deriveRunPresentation(task, current, current.reader_health)
      const runtime = current.runtime_observation ?? {}
      const stage = ({ preparing: '准备输入', planning: '规划分析单元', analyzing: '源码与业务分析', reviewing: '复核结果', closing: '定向修正', reporting: '整理报告', complete: '流程结束' })[view.stage ?? current.stage] ?? current.phase_title ?? '阶段未记录'
      const finished = current.lifecycle_status === 'complete'
      const activity = stale ? '当前状态未知，显示上次记录'
        : finished ? current.partial_delivery ? '已交付已有结果' : '本次流程已结束'
          : presentation.stopping ? '正在确认执行已停止'
            : presentation.stopped ? '运行已停止'
              : presentation.failed ? '执行已中断'
                : presentation.needsAttention ? '等待处理未完成事项'
                  : runtime.activity?.label || ({ reading_source: '正在读取源码', tool_running: '正在执行工具', generating: '正在返回内容', reviewing: '正在复核', waiting_provider: '等待 Provider 响应', starting: '正在连接执行端', idle: '等待下一步执行' })[runtime.activity?.kind] || '执行活动未记录'
      const at = value => Number.isFinite(value) && value >= 0 ? value : null
      const last = view.last_effective_progress
      const actions = Array.isArray(view.actions) ? view.actions : []
      const byId = new Map(actions.map(action => [action.action_id, action]))
      const resumed = Array.isArray(view.recovery?.resume_from) ? view.recovery.resume_from : []
      const resumeTargets = resumed.map(item => {
        const action = byId.get(item.action_id)
        const operation = ({ continue_agent: '续接原执行', dispatch_agent: '开始待执行任务', settle: '接收已完成提交', settle_action: '接收已完成提交', advance_workflow: '推进至下一阶段', finalize_report: '继续整理报告' })[item.operation] ?? '继续处理'
        return `${action?.title || action?.unit_id || '当前阶段任务'}：${operation}`
      })
      const recovery = finished ? '本次 Run 已结束，已有交付与未解决事项均保留。'
        : stale ? '待重新读取当前状态后，确认是否可以继续。'
          : presentation.canResume
            ? [runtime.recovery?.summary, resumeTargets.length ? resumeTargets.join('；') : '按已保存检查点继续当前阶段。'].filter(Boolean).join('；')
            : presentation.running ? '运行期间持续保存记录；继续入口在执行停止后开放。'
              : runtime.recovery?.blocked_reason || view.recovery?.blocked_reason || presentation.resumeBlockedReason
      return { stage, activity, stale, finished, unitCounts: view.unit_counts ?? {}, actions,
        lastProgressAt: at(last?.at_ms), lastProgressUnit: last?.unit_id ?? null,
        lastCommunicationAt: at(runtime.last_communication_at_ms),
        connection: ({ connected: '已连接', connecting: '正在连接', disconnected: '已断开', interrupted: '连接已中断', blocked: '等待确认旧执行状态', idle: '当前无活动连接', unknown: '连接状态未确认' })[runtime.connection_status] ?? '连接状态未记录',
        preserved: Array.isArray(view.preserved) ? view.preserved : [],
        unresolved: Array.isArray(view.unresolved) ? view.unresolved : [],
        recovery, resumeTargets, diagnostics: Array.isArray(view.diagnostics) ? view.diagnostics : [] }
    }

    function RunExecutionSummary({ current, task, stale = false, compact = false }) {
      const info = executionObservation(current, task, stale)
      if (!info) return null
      const muted = { color: '#70767d', fontSize: 12, lineHeight: 1.7 }
      const time = value => value == null ? '未记录' : new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
      const count = value => Number.isFinite(value) ? String(value) : '—'
      const units = !Number.isFinite(info.unitCounts.total) ? '规划单元总数尚未读取'
        : info.unitCounts.total === 0 && ['preparing', 'planning'].includes(current.execution_view.stage ?? current.stage)
          ? '尚未生成分析单元' : `${count(info.unitCounts.completed)} / ${count(info.unitCounts.total)}`
      const field = (label, value, note) => h('div', { key: label, style: { minWidth: 0 } }, h('dt', { style: muted }, label), h('dd', { style: { margin: '5px 0 0', fontSize: 14, lineHeight: 1.7, overflowWrap: 'anywhere' } }, value), note ? h('p', { style: { ...muted, margin: '4px 0 0' } }, note) : null)
      const acceptance = { accepted: '已接受', delivered: '已交付', draft: '已保存草稿', seed: '继承参考' }
      return h('section', { 'aria-label': compact ? '执行进展摘要' : '运行进展与恢复', style: { border: '1px solid #e5e7e4', borderRadius: 10, background: '#fff', padding: compact ? 18 : 22, marginBottom: 22 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 } }, h('h2', { style: { margin: 0, fontSize: 15, fontWeight: 600 } }, compact ? '执行进展' : '运行进展与恢复'), stale ? h('span', { style: muted }, '上次成功读取的记录') : null),
        h('dl', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,210px),1fr))', gap: 20, margin: 0 } },
          field('当前阶段与活动', `${info.stage} · ${info.activity}`),
          field('最近有效进展', time(info.lastProgressAt), info.lastProgressAt == null ? '尚无结果保存时间；不据此推断执行卡住。' : `${info.lastProgressUnit ? `${info.lastProgressUnit} · ` : ''}结果已保存（北京时间）`),
          field('业务单元提交', units, '按单元完成提交计数；复核结论单独展示。'),
          field('最近通信', time(info.lastCommunicationAt), `${info.connection}；通信更新不代表成果增加。`)),
        h('p', { style: { margin: '18px 0 0', fontSize: 14, lineHeight: 1.8, overflowWrap: 'anywhere' } }, h('strong', null, info.finished ? '交付状态：' : '续接位置：'), info.recovery),
        compact ? null : h(React.Fragment, null,
          h('p', { style: { ...muted, margin: '8px 0 0' } }, `${info.diagnostics.length ? '已读取' : '保留'} ${info.preserved.length} 份结果记录 · ${info.unresolved.length} 项执行待处理。已保存草稿与已接受结果分别标注。`),
          info.preserved.length || info.unresolved.length ? h('details', { style: { marginTop: 15 } },
            h('summary', { style: { cursor: 'pointer', fontSize: 14 } }, '查看保留成果与待处理任务'),
            h('div', { role: 'region', 'aria-label': '保留成果与续接位置表', tabIndex: 0, style: { overflowX: 'auto', marginTop: 12 } },
              h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' } },
                h('thead', null, h('tr', null, ['任务', '保存内容', '状态', '继续位置'].map(label => h('th', { key: label, scope: 'col', style: { padding: '8px 10px', borderBottom: '1px solid #e5e7e4', whiteSpace: 'nowrap' } }, label)))),
                h('tbody', null, info.actions.filter(action => info.preserved.some(item => item.action_id === action.action_id) || info.unresolved.some(item => item.action_id === action.action_id)).map(action => {
                  const saved = info.preserved.find(item => item.action_id === action.action_id)
                  const pending = info.unresolved.find(item => item.action_id === action.action_id)
                  return h('tr', { key: action.action_id }, [action.title || action.unit_id || ({ source_first_plan: '分析规划', independent_review: '独立复核', comparison_review: '对照复核' })[action.stage] || '阶段任务',
                    saved ? `${count(saved.record_count)} 条 · 版本 ${count(saved.revision)}` : '尚无已保存记录',
                    [saved ? acceptance[saved.acceptance] || '已保存' : null, pending ? sourceFirstRecordBody(pending.reason) || '执行待处理' : null].filter(Boolean).join(' · '),
                    info.finished ? '本次已结束' : action.resume_action === 'settle' || action.resume_action === 'settle_action' ? '接收已完成提交' : action.resume_action === 'continue_agent' ? '续接原执行' : ['settled', 'accepted'].includes(action.status) ? '保留，等待后续阶段' : action.resume_action ? '按检查点继续' : '无需继续',
                  ].map((value, index) => h('td', { key: index, style: { padding: '10px', borderBottom: '1px solid #f0f1ef', minWidth: index ? 110 : 150, maxWidth: 360, overflowWrap: 'anywhere', verticalAlign: 'top' } }, value)))
                }))))) : null,
          info.diagnostics.length ? h('p', { role: 'status', style: { ...muted, marginBottom: 0 } }, '部分进展资料不可读取：', info.diagnostics.map(item => typeof item === 'string' ? item : item.message ?? item.code ?? '读取诊断').join('；')) : null))
    }

    function taskCanStop(task) {
      return ['preparing', 'starting', 'running', 'stopping'].includes(task?.execution_status)
        || ['preparing', 'starting', 'running', 'stopping', 'needs_attention', 'failed'].includes(task?.status)
    }

    function TaskLifecycleDialog({ state, onClose, onConfirm }) {
      const dialog = React.useRef(null)
      React.useEffect(() => {
        const trigger = document.activeElement
        dialog.current?.querySelector('button')?.focus()
        return () => { if (trigger?.isConnected) trigger.focus?.({ preventScroll: true }) }
      }, [])
      const deleting = state.action === 'task-delete'
      const title = deleting ? '删除分析任务？' : '停止分析任务？'
      const keyDown = event => {
        if (event.key === 'Escape' && !state.busy) { event.preventDefault(); event.stopPropagation(); onClose() }
        if (event.key !== 'Tab') return
        const controls = [...dialog.current.querySelectorAll('button:not(:disabled)')]
        const first = controls[0], last = controls.at(-1)
        if (!first) { event.preventDefault(); return }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
      return h('div', { className: 'pangea-task-action-overlay', onKeyDown: keyDown },
        h('section', { className: 'pangea-task-action-dialog', ref: dialog, role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'pangea-task-action-title' },
          h('h2', { id: 'pangea-task-action-title' }, title),
          h('p', { style: { fontWeight: 600, overflowWrap: 'anywhere' } }, state.task.title || state.task.task_id),
          h('p', null, deleting ? '仅从分析任务列表移除；Run、报告、会话和日志仍保留。' : '停止当前分析执行，保留已保存的结果、报告、会话和日志。'),
          deleting && taskCanStop(state.task) ? h('p', null, '此任务尚未确认停止。会先停止执行，确认结束后才移除；停止失败时任务仍保留，可重试。') : null,
          state.error ? h('p', { role: 'alert', style: { color: '#a14035' } }, state.error) : null,
          h('div', { className: 'pangea-task-action-footer' },
            h('button', { type: 'button', style: styles.button, disabled: state.busy, onClick: onClose }, '取消'),
            h('button', { type: 'button', style: { ...styles.button, color: '#a14035', borderColor: '#e4b8b1' }, disabled: state.busy, onClick: onConfirm },
              state.busy ? deleting ? taskCanStop(state.task) ? '正在停止并删除…' : '正在删除…' : '正在请求停止…' : state.error ? deleting ? '重试删除' : '重试停止' : deleting ? '确认删除' : '确认停止'))))
    }

    function agentSessionContent(content) {
      if (content == null) return ''
      if (typeof content === 'string') return content
      if (Array.isArray(content)) return content.map(agentSessionContent).filter(Boolean).join('\n')
      if (content.type === 'text' || typeof content.text === 'string') return content.text ?? ''
      if (content.type === 'content') return agentSessionContent(content.content)
      if (content.type === 'resource' && content.resource) return content.resource.text ?? `[资源] ${content.resource.uri ?? '未记录地址'}`
      if (['image', 'audio'].includes(content.type)) return `[${content.type === 'image' ? '图片' : '音频'}内容：${content.mimeType ?? '未记录类型'}]`
      return sourceFirstRecordBody(content)
    }

    function mergeAgentSessionEvents(previous = [], incoming = []) {
      const events = new Map(previous.map(event => [event.seq, event]))
      for (const event of incoming) if (event && event.seq != null) events.set(event.seq, event)
      return [...events.values()].sort((a, b) => Number(a.seq) - Number(b.seq))
    }

    function agentSessionTime(value) {
      if (value == null || value === '') return null
      const time = new Date(value).getTime()
      return Number.isFinite(time) ? time : null
    }
    function agentSessionLatestFirst(a, b) {
      const left = agentSessionTime(a.last_at ?? a.at), right = agentSessionTime(b.last_at ?? b.at)
      if (left !== right) return left == null ? 1 : right == null ? -1 : right - left
      return Number(b.last_seq ?? b.seq ?? 0) - Number(a.last_seq ?? a.seq ?? 0) || String(a.key ?? '').localeCompare(String(b.key ?? ''))
    }
    function agentSessionList(items = []) {
      return [...items].sort((a, b) => {
        const left = agentSessionTime(a.updated_at) ?? agentSessionTime(a.created_at)
        const right = agentSessionTime(b.updated_at) ?? agentSessionTime(b.created_at)
        return (left === right ? 0 : left == null ? 1 : right == null ? -1 : right - left)
          || String(a.session_id).localeCompare(String(b.session_id))
      })
    }
    function agentSessionTranscript(events = []) {
      const rows = [], tools = new Map()
      const touch = (row, event) => {
        row.last_seq = event.seq
        const at = agentSessionTime(event.at), previous = agentSessionTime(row.last_at ?? row.at)
        if (at != null && (previous == null || at >= previous)) row.last_at = event.at
      }
      // Stream reconstruction follows the append sequence; only completed
      // display blocks are sorted, never chunks or a tool's update history.
      for (const event of mergeAgentSessionEvents([], events)) {
        const update = event.update ?? {}, kind = update.sessionUpdate ?? update.type
        const context = `${event.replay ? 'replay' : 'live'}:${event.execution_id ?? ''}:${event.action_id ?? ''}`
        if (event.type === 'session_update' && ['agent_message_chunk', 'agent_thought_chunk', 'user_message_chunk'].includes(kind)) {
          const text = agentSessionContent(update.content)
          if (!text) continue
          const role = kind === 'agent_thought_chunk' ? 'thought' : kind === 'user_message_chunk' ? 'user' : 'agent'
          const last = rows.at(-1)
          if (last?.type === 'text' && last.role === role && last.context === context) { last.text += text; touch(last, event) }
          else rows.push({ type: 'text', key: `text-${event.seq}`, seq: event.seq, last_seq: event.seq, at: event.at, context, role, text, replay: Boolean(event.replay) })
        } else if (event.type === 'session_update' && ['tool_call', 'tool_call_update'].includes(kind)) {
          const id = update.toolCallId ?? update.tool_call_id ?? `unknown-${event.seq}`
          const key = `${event.replay ? 'replay' : 'live'}:${event.execution_id ?? ''}:${id}`
          let tool = tools.get(key)
          if (!tool) { tool = { type: 'tool', key: `tool-${event.seq}`, seq: event.seq, at: event.at, id, title: id, status: 'unknown', replay: Boolean(event.replay), updates: [] }; tools.set(key, tool); rows.push(tool) }
          for (const field of ['title', 'status', 'rawInput', 'rawOutput', 'content', 'locations']) if (Object.hasOwn(update, field) && update[field] != null) tool[field] = update[field]
          tool.updates.push({ at: event.at, seq: event.seq, ...update })
          touch(tool, event)
        } else rows.push({ ...event, key: `event-${event.seq}` })
      }
      return rows.sort(agentSessionLatestFirst)
    }

    // One read-only reader owns each Run window. Selection tokens also reject
    // responses from servers that finish after their AbortSignal was cancelled.
    function createAgentSessionReader({ cwd, dataRoot, runId, onChange, request = requestWorkbench, pollMs = 2000, schedule = setTimeout, cancelSchedule = clearTimeout, initialSelection = {} }) {
      const scope = `${cwd}\u0000${dataRoot ?? ''}\u0000${runId}`
      let state = { scope, items: [], selectedId: '', session: null, events: [], cursor: 0, tailLoaded: false, historyCursor: 0, hasMore: false, historyLoading: false, historyError: '', historyStatus: '', listLoading: true, detailLoading: false, listError: '', detailError: '', listRecordingError: '', detailRecordingError: '', listTruncated: false, detailTruncated: false, updatedAt: '' }
      let disposed = false, selectionVersion = 0, listBusy = false, detailBusy = false, historyBusy = false, timer
      const controllers = new Set()
      const emit = patch => { if (!disposed) { state = { ...state, ...patch }; onChange(state) } }
      async function query(args) {
        const controller = new AbortController(); controllers.add(controller)
        try { return await request({ cwd, dataRoot, runId, ...args, signal: controller.signal }) }
        finally { controllers.delete(controller) }
      }
      async function loadEvents() {
        if (disposed || detailBusy || !state.selectedId) return
        const selectedId = state.selectedId, version = selectionVersion
        detailBusy = true; emit({ detailLoading: true })
        try {
          // The initial tail is independent from older pages. Keep the live
          // cursor moving forward while history is being read in parallel.
          let more = true
          while (more && !disposed && version === selectionVersion) {
            const initial = !state.tailLoaded, cursor = initial ? 'latest' : state.cursor
            const result = await query({ view: 'agent-session', sessionId: selectedId, cursor, limit: 100 })
            if (disposed || version !== selectionVersion) return
            checkPage(result, selectedId)
            const next = Number(result.next_cursor)
            if (!initial && next < cursor) throw new Error('会话分页位置倒退，已保留当前记录，请重试读取。')
            emit({ session: result.session ?? state.session, events: mergeAgentSessionEvents(state.events, result.events), cursor: next, tailLoaded: true,
              ...(initial ? { historyCursor: Number(result.history_cursor ?? 0), hasMore: Boolean(result.has_history) } : {}),
              detailRecordingError: result.recording_error ?? '', detailTruncated: Boolean(state.detailTruncated || result.truncated), historyStatus: result.history_status ?? result.session?.history_status ?? '', detailError: '', updatedAt: new Date().toLocaleTimeString() })
            more = !initial && Boolean(result.has_more) && next > cursor
          }
        } catch (error) {
          if (!disposed && version === selectionVersion && error?.name !== 'AbortError') emit({ detailError: error?.message ?? String(error) })
        } finally {
          if (!disposed && version === selectionVersion) { detailBusy = false; emit({ detailLoading: false }) }
        }
      }
      function checkPage(result, selectedId) {
        if (result.run_id && result.run_id !== runId) throw new Error('会话响应不属于当前 Run，已忽略。')
        if (result.session?.session_id && result.session.session_id !== selectedId) throw new Error('会话响应身份不匹配，已忽略。')
        if (result.next_cursor == null || !Number.isSafeInteger(Number(result.next_cursor)) || Number(result.next_cursor) < 0) throw new Error('会话分页位置缺失或无效，请重试读取。')
      }
      async function loadHistory() {
        if (disposed || historyBusy || !state.selectedId || !state.tailLoaded || !state.hasMore) return
        const selectedId = state.selectedId, version = selectionVersion, cursor = state.historyCursor
        historyBusy = true; emit({ historyLoading: true })
        try {
          const result = await query({ view: 'agent-session', sessionId: selectedId, cursor: `before:${cursor}`, limit: 100 })
          if (disposed || version !== selectionVersion) return
          checkPage(result, selectedId)
          const previous = Number(result.history_cursor)
          if (result.history_cursor == null || !Number.isSafeInteger(previous) || previous < 0 || previous >= cursor) throw new Error('更早历史的分页位置无效，已保留当前记录。')
          emit({ events: mergeAgentSessionEvents(state.events, result.events), historyCursor: previous, hasMore: Boolean(result.has_history), historyError: '',
            detailRecordingError: result.recording_error || state.detailRecordingError, detailTruncated: Boolean(state.detailTruncated || result.truncated) })
        } catch (error) {
          if (!disposed && version === selectionVersion && error?.name !== 'AbortError') emit({ historyError: error?.message ?? String(error) })
        } finally {
          if (!disposed && version === selectionVersion) { historyBusy = false; emit({ historyLoading: false }) }
        }
      }
      function select(sessionId) {
        if (disposed || sessionId === state.selectedId) return
        selectionVersion++; detailBusy = false; historyBusy = false
        emit({ selectedId: sessionId, session: state.items.find(item => item.session_id === sessionId) ?? null, events: [], cursor: 0, tailLoaded: false, historyCursor: 0, hasMore: false, historyLoading: false, historyError: '', historyStatus: '', detailError: '', detailRecordingError: '', detailTruncated: false, detailLoading: Boolean(sessionId) })
        if (sessionId) void loadEvents()
      }
      async function loadList() {
        if (disposed || listBusy) return
        listBusy = true
        try {
          const result = await query({ view: 'agent-sessions' })
          if (disposed) return
          if (result.run_id && result.run_id !== runId) throw new Error('会话列表不属于当前 Run，已忽略。')
          const items = agentSessionList(Array.isArray(result.items) ? result.items : [])
          emit({ items, listLoading: false, listError: '', listRecordingError: result.recording_error ?? '', listTruncated: Boolean(result.truncated), session: items.find(item => item.session_id === state.selectedId) ?? state.session })
          if (!state.selectedId) {
            const requested = Object.values(initialSelection).some(Boolean)
            const candidates = items.filter(item => initialSelection.initialSessionId ? item.session_id === initialSelection.initialSessionId
              : (!initialSelection.initialActionId || item.action_ids?.includes(initialSelection.initialActionId)) && (!initialSelection.initialAttemptId || item.attempt_id === initialSelection.initialAttemptId) && (!initialSelection.initialUnitId || item.unit_id === initialSelection.initialUnitId))
            if (!requested) select(items[0]?.session_id ?? '')
            else if (candidates.length === 1) select(candidates[0].session_id)
            else emit({ detailError: candidates.length ? '关联到多个尝试，请选择对应会话；未自动打开其他尝试。' : '未找到关联会话；请核对本次尝试。' })
          }
        } catch (error) {
          if (!disposed && error?.name !== 'AbortError') emit({ listLoading: false, listError: error?.message ?? String(error) })
        } finally { listBusy = false }
      }
      async function tick() {
        await Promise.allSettled([loadList(), loadEvents()])
        if (!disposed) timer = schedule(tick, pollMs)
      }
      return {
        start() { emit({}); void tick() }, select,
        refresh() { if (!disposed) { void loadList(); void loadEvents() } },
        loadMore: loadHistory,
        dispose() { disposed = true; selectionVersion++; cancelSchedule(timer); for (const controller of controllers) controller.abort(); controllers.clear() },
      }
    }

    function agentSessionRole(session) {
      const role = session?.role ?? session?.stage ?? ''
      if (/plan/i.test(role)) return 'Planning · 规划'
      if (/review|comparison/i.test(role)) return 'Review · 复核'
      if (/clos|repair/i.test(role)) return 'Work · 修正'
      if (/work|analy|worker/i.test(role)) return 'Work · 分析'
      return role || '阶段未记录'
    }
    function agentSessionStatus(value) {
      return ({ ready: '准备就绪', idle: '空闲', exited: '进程已退出', awaiting_tool: '等待工具确认', pending: '等待执行', in_progress: '执行中', running: '运行中', completed: '已完成', failed: '失败', cancelled: '已取消', aborted: '已中止', paused: '已暂停', interrupted: '已中断', ended: '已结束', unknown: '状态未知', bound: '已绑定', stopped: '已停止' })[value] ?? value ?? '未记录'
    }

    function AgentSessionTranscript({ events = [] }) {
      const rows = agentSessionTranscript(events)
      const [copyNotice, setCopyNotice] = React.useState(null)
      const time = at => agentSessionTime(at) != null ? new Date(at).toLocaleString() : '时间未记录'
      const pre = (value, props = {}) => h('pre', props, agentSessionContent(value))
      const details = (label, value, open = false) => value == null ? null : h('details', { open }, h('summary', null, label), pre(value))
      const lifecycle = (value, key) => {
        const record = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
        const count = field => Number.isInteger(record[field]) && record[field] >= 0 ? record[field] : '未记录'
        const unclosed = count('unclosed_count')
        const tools = Array.isArray(record.tools) ? record.tools.filter(tool => tool && typeof tool === 'object') : []
        const json = JSON.stringify(value ?? {}, null, 2)
        return h('section', { 'aria-label': '工具结束确认诊断' },
          h('p', null, `尚无结束确认：${unclosed}${unclosed === '未记录' ? '' : ' 条'}`),
          h('p', { className: 'agent-session-muted' }, `上报状态 · pending：${count('pending_count')} · in_progress：${count('in_progress_count')} · unknown：${count('unknown_count')}`),
          h('p', { className: 'agent-session-muted' }, '上报状态不能证明命令实际仍在执行；此处保留尚未收到结束确认的工具记录。'),
          ['received_tool_events', 'accepted_tool_events', 'unaccepted_tool_events', 'validation_error_count'].some(field => record[field] != null)
            ? h('p', { className: 'agent-session-muted' }, `工具入站：${count('received_tool_events')} · 已接收：${count('accepted_tool_events')} · 未确认接收：${count('unaccepted_tool_events')} · 校验错误：${count('validation_error_count')}`) : null,
          tools.map((tool, index) => h('div', { key: `${tool.tool_id ?? 'unknown'}-${index}`, className: 'agent-tool-update' },
            h('div', { className: 'agent-tool-state' }, h('code', null, tool.tool_id ?? '工具 ID 未记录'), h('span', null, `上报状态：${tool.status ?? '未记录'}`)),
            h('div', null, '最后更新：', h('time', { dateTime: agentSessionTime(tool.last_update_at_ms) == null ? undefined : new Date(tool.last_update_at_ms).toISOString() }, time(tool.last_update_at_ms))))),
          record.tools_truncated ? h('p', { className: 'agent-session-muted' }, '工具明细已截断；上方数量可能大于当前列出的工具数。') : null,
          h('details', null, h('summary', null, '完整工具诊断 JSON（可复制）'),
            h('button', { type: 'button', className: 'agent-button', onClick: async () => {
              try {
                if (!globalThis.navigator?.clipboard?.writeText) throw new Error('clipboard unavailable')
                await globalThis.navigator.clipboard.writeText(json)
                setCopyNotice({ key, message: '已复制完整工具诊断。' })
              } catch { setCopyNotice({ key, message: '复制失败，请手动选择下方 JSON 复制。' }) }
            } }, '复制工具诊断'),
            copyNotice?.key === key ? h('p', { className: 'agent-session-muted', role: 'status' }, copyNotice.message) : null,
            pre(json)))
      }
      return h('div', { className: 'agent-session-transcript' }, rows.map(row => {
        const head = label => h(React.Fragment, null, h('div', { className: 'agent-event-head' }, h('strong', null, label), h('time', { dateTime: row.last_at ?? row.at ?? undefined }, time(row.last_at ?? row.at))), row.replay ? h('p', { className: 'agent-session-muted' }, '恢复时执行器回放 · 原始回合时间未知；此处时间为采集时间。') : null)
        if (row.type === 'text') return h('article', { key: row.key, className: `agent-event agent-${row.role}` }, head(row.role === 'agent' ? 'Agent' : row.role === 'user' ? '用户消息' : 'Agent 思考记录'), row.role === 'thought' ? details('查看执行器返回的思考记录', row.text) : renderReadableBody(row.text))
        if (row.type === 'tool') return h('article', { key: row.key, className: 'agent-event agent-tool' },
          head(`工具 · ${row.title}`), h('div', { className: 'agent-tool-state' }, h('span', { className: 'badge', 'data-tool-status': row.status }, agentSessionStatus(row.status)), h('code', null, row.id)),
          row.status === 'failed' ? h('p', { role: 'alert', className: 'agent-session-alert' }, agentSessionContent(row.rawOutput?.error ?? row.rawOutput ?? row.content ?? '工具执行失败').slice(0, 400)) : null, details('调用输入', row.rawInput), details('执行输出', row.rawOutput), details('工具返回内容', row.content),
          row.rawOutput == null && !row.content?.length ? h('p', { className: 'agent-session-muted' }, ['pending', 'in_progress', 'unknown'].includes(row.status) ? '尚未收到工具执行结果，不能据此确认工具已经结束。' : '执行器未返回输出正文。') : null,
          h('details', null, h('summary', null, `状态与更新记录（${row.updates.length}）`), row.updates.map(update => h('div', { key: update.seq, className: 'agent-tool-update' }, h('div', null, `${time(update.at)} · ${agentSessionStatus(update.status)}`), pre(update)))))
        const toolLifecycle = row.tool_lifecycle ?? row.payload?.tool_lifecycle
        if (row.type === 'tool_lifecycle') return h('article', { key: row.key, className: 'agent-event agent-tool-lifecycle' }, head('工具结束确认诊断'), lifecycle(toolLifecycle, row.key))
        const labels = { prompt: '发送给 Agent 的指令', session_bound: '原会话已绑定', turn_end: '回合结束', error: '执行错误', recording_error: '会话记录异常', process_exit: '进程退出', permission: '权限请求与结果', host_event: '宿主状态记录', host: '宿主状态记录', acp_tool_transport: 'ACP 工具入站记录' }
        return h('article', { key: row.key, className: `agent-event agent-${row.type}` }, head(labels[row.type] ?? '会话事件'),
          ['prompt', 'turn_end'].includes(row.type) && row.action_id ? h('p', { className: 'agent-session-muted', style: { overflowWrap: 'anywhere' } }, `关联动作：${row.action_id}`) : null,
          row.type === 'prompt' ? details('查看完整指令', row.prompt ?? row.content ?? row)
            : row.type === 'turn_end' ? h(React.Fragment, null, row.response_received === false || row.protocol_stop_reason == null ? h('p', { className: 'agent-session-alert' }, '尚未收到 ACP 的回合结束确认；本地等待已结束不代表工具已完成。') : null, h('dl', null, h('dt', null, '宿主停止原因'), h('dd', null, row.stop_reason ?? '未记录'), h('dt', null, 'ACP 停止原因'), h('dd', null, row.protocol_stop_reason ?? '未记录')), details('完整结束记录', row))
              : ['host_event', 'host'].includes(row.type) ? h(React.Fragment, null, pre([row.stage, row.message, row.status].filter(Boolean).join('\n')), toolLifecycle != null ? h(React.Fragment, null, h('strong', null, '工具结束确认诊断'), lifecycle(toolLifecycle, row.key)) : null, details('完整宿主记录', row))
                : ['error', 'recording_error'].includes(row.type) ? pre(row.error ?? row.message ?? row) : details('查看事件详情', row, row.type === 'permission'))
      }))
    }

    function AgentSessionsDialog({ cwd, dataRoot, runId, onClose, request = requestWorkbench, initialSessionId, initialUnitId, initialActionId, initialAttemptId, unitTitles = {} }) {
      const scope = `${cwd}\u0000${dataRoot ?? ''}\u0000${runId}`
      const [snapshot, setSnapshot] = React.useState(null)
      const reader = React.useRef(null), dialog = React.useRef(null)
      React.useEffect(() => {
        const controller = createAgentSessionReader({ cwd, dataRoot, runId, request, onChange: setSnapshot, initialSelection: { initialSessionId, initialUnitId, initialActionId, initialAttemptId } })
        reader.current = controller; controller.start()
        return () => { controller.dispose(); if (reader.current === controller) reader.current = null }
      }, [cwd, dataRoot, runId, request])
      React.useEffect(() => {
        const previous = document.activeElement
        dialog.current?.querySelector('button')?.focus()
        return () => { if (previous?.isConnected) previous.focus() }
      }, [])
      const state = snapshot?.scope === scope ? snapshot : { items: [], events: [], listLoading: true }
      const session = state.session
      const [sessionQuery, setSessionQuery] = React.useState(''), [statusFilter, setStatusFilter] = React.useState(''), [unitFilter, setUnitFilter] = React.useState(''), [stageFilter, setStageFilter] = React.useState('')
      const visibleSessions = state.items.filter(item => (!statusFilter || item.status === statusFilter) && (!unitFilter || item.unit_id === unitFilter) && (!stageFilter || item.stage === stageFilter))
      const visibleEvents = sessionQuery.trim() ? state.events.filter(event => JSON.stringify(event).toLowerCase().includes(sessionQuery.trim().toLowerCase())) : state.events
      const keyDown = event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
        if (event.key !== 'Tab') return
        const buttons = [...(dialog.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') ?? [])]
        const first = buttons[0], last = buttons.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
      return h('div', { className: 'agent-sessions-overlay', onKeyDown: keyDown },
        h('style', null, `.agent-sessions-overlay{position:fixed;inset:0;z-index:1200;background:#13202a70;display:flex;align-items:center;justify-content:center;padding:24px}.agent-sessions-dialog{width:min(1320px,100%);height:88vh;max-height:960px;background:#fbfbf8;color:#25392f;border:1px solid #d8dfd8;border-radius:16px;box-shadow:0 28px 80px #17221d33;display:flex;flex-direction:column;overflow:hidden;text-align:left}.agent-sessions-head{display:flex;justify-content:space-between;gap:20px;padding:20px 24px;border-bottom:1px solid #dce2dc}.agent-sessions-head h2{margin:0 0 6px;font-size:21px}.agent-sessions-head p{margin:0;color:#66716a;font-size:12px;line-height:1.7;overflow-wrap:anywhere}.agent-sessions-actions{display:flex;gap:8px;align-items:flex-start;flex-shrink:0}.agent-sessions-dialog button{font:inherit;cursor:pointer}.agent-sessions-dialog button:disabled{cursor:default;opacity:.55}.agent-sessions-dialog button:focus-visible,.agent-sessions-dialog summary:focus-visible{outline:2px solid #347b61;outline-offset:2px}.agent-sessions-body{display:grid;grid-template-columns:285px minmax(0,1fr);min-height:0;flex:1}.agent-sessions-list{padding:16px 12px;overflow:auto;border-right:1px solid #dce2dc;background:#f3f5f1}.agent-sessions-list>h3{font-size:12px;color:#67736c;margin:0 10px 12px}.agent-session-option{display:flex;flex-direction:column;gap:7px;text-align:left;width:100%;border:1px solid transparent;border-radius:10px;padding:13px;background:transparent;color:inherit;margin-bottom:8px;overflow-wrap:anywhere}.agent-session-option[aria-pressed=true]{background:#fff;border-color:#87ac9a;box-shadow:0 3px 12px #23433008}.agent-session-option span,.agent-session-option small{font-size:12px;line-height:1.5}.agent-session-option small{color:#68746c}.agent-session-main{overflow:auto;min-width:0;padding:22px 24px}.agent-session-meta{padding-bottom:18px;border-bottom:1px solid #dce2dc;margin-bottom:18px}.agent-session-meta h3{margin:0 0 10px}.agent-session-meta dl,.agent-event dl{display:grid;grid-template-columns:110px minmax(0,1fr);font-size:12px;gap:7px;margin:12px 0}.agent-session-meta dt,.agent-event dt{color:#758075}.agent-session-meta dd,.agent-event dd{margin:0;overflow-wrap:anywhere}.agent-session-muted{font-size:12px;line-height:1.8;color:#6d786e}.agent-session-alert{padding:12px 14px;margin:12px 0;border:1px solid #e0c4a0;background:#fff5e7;border-radius:8px;font-size:14px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}.agent-event{border:1px solid #dce2dc;background:#fff;padding:15px 17px;border-radius:10px;margin-bottom:14px;min-width:0}.agent-event-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;line-height:1.6;margin-bottom:8px;overflow-wrap:anywhere}.agent-event-head strong{font-size:14px;min-width:0}.agent-event-head time{font-size:12px;color:#7a847c;flex-shrink:0}.agent-event pre{font:12px/1.85 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;max-width:100%;margin:9px 0}.agent-event summary{font-size:12px;cursor:pointer;margin:10px 0;color:#47765b}.agent-event details+details{border-top:1px solid #eef1ed;padding-top:1px}.agent-event.agent-error,.agent-event.agent-turn_end{border-left:3px solid #b47b46}.agent-tool-state{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px}.agent-tool-state code{overflow-wrap:anywhere}.agent-tool-update{padding:10px;background:#f5f6f3;margin-top:6px}.agent-tool-update>div{font-size:12px;color:#71806f}.agent-session-footer{padding:14px 24px;border-top:1px solid #dce2dc;font-size:12px;color:#6d786e;display:flex;gap:12px;justify-content:space-between;flex-wrap:wrap}.agent-sessions-dialog .agent-button{border:1px solid #ced8ce;background:#fff;color:#365340;padding:8px 12px;border-radius:7px;white-space:nowrap}.agent-sessions-empty{padding:32px 16px;color:#68756c;font-size:14px;line-height:1.9}@media(max-width:760px){.agent-sessions-overlay{padding:8px}.agent-sessions-dialog{height:94vh}.agent-sessions-head{padding:16px;gap:8px}.agent-sessions-actions{flex-wrap:wrap;justify-content:flex-end}.agent-sessions-body{grid-template-columns:210px minmax(0,1fr)}.agent-session-main{padding:14px}.agent-event-head{flex-direction:column;gap:3px}.agent-session-meta dl{grid-template-columns:1fr}.agent-sessions-head h2{font-size:18px}}`),
        h('section', { ref: dialog, className: 'agent-sessions-dialog', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'agent-sessions-title' },
          h('header', { className: 'agent-sessions-head' }, h('div', null, h('h2', { id: 'agent-sessions-title' }, 'Agent 会话管理'), h('p', null, '查看本次分析的原 Agent 会话 · 最新输出在前 · 只读 · 每 2 秒同步'), h('p', null, `Run：${runId}`)),
            h('div', { className: 'agent-sessions-actions' }, h('button', { type: 'button', className: 'agent-button', onClick: () => reader.current?.refresh() }, '刷新记录'), h('button', { type: 'button', className: 'agent-button', 'aria-label': '关闭 Agent 会话管理', onClick: onClose }, '关闭'))),
          h('div', { className: 'pangea-session-filters' }, h('input', { type: 'search', 'aria-label': '搜索已加载会话内容', placeholder: '搜索已加载会话内容', value: sessionQuery, onChange: event => setSessionQuery(event.target.value) }), h('span', null, `已加载 ${state.events.length} 条事件${state.hasMore ? '，仍有更早记录' : ''}`),
            h('select', { 'aria-label': '筛选会话状态', value: statusFilter, onChange: event => setStatusFilter(event.target.value) }, h('option', { value: '' }, '全部状态'), [...new Set(state.items.map(item => item.status).filter(Boolean))].map(value => h('option', { key: value, value }, agentSessionStatus(value)))),
            h('select', { 'aria-label': '筛选会话分析单元', value: unitFilter, onChange: event => setUnitFilter(event.target.value) }, h('option', { value: '' }, '全部分析单元'), [...new Set(state.items.map(item => item.unit_id).filter(Boolean))].map(value => h('option', { key: value, value }, unitTitles[value] || value))),
            h('select', { 'aria-label': '筛选会话阶段', value: stageFilter, onChange: event => setStageFilter(event.target.value) }, h('option', { value: '' }, '全部阶段'), [...new Set(state.items.map(item => item.stage).filter(Boolean))].map(value => h('option', { key: value, value }, ({ source_first_plan: '单元规划', unit_planning: '单元规划', unit_analysis: '单元分析', independent_review: '独立复核', comparison_review: '对照复核', targeted_closure: '定向修正' })[value] || value)))),
          h('div', { className: 'agent-sessions-body' },
            h('aside', { className: 'agent-sessions-list', 'aria-label': '本次 Run 的 Agent 会话' }, h('h3', null, `原 Agent 会话 · ${state.items.length}`),
              state.listError ? h('div', { className: 'agent-session-alert', role: 'alert' }, `会话列表读取失败：${state.listError}`) : null,
              state.listRecordingError ? h('div', { className: 'agent-session-alert', role: 'alert' }, `会话索引记录不完整：${agentSessionContent(state.listRecordingError)}`) : null,
              state.listTruncated ? h('div', { className: 'agent-session-alert' }, '会话列表记录已截断。') : null,
              state.listLoading ? h('p', { className: 'agent-sessions-empty', role: 'status' }, '正在读取会话列表…') : null,
              !state.listLoading && !state.items.length && !state.listError ? h('p', { className: 'agent-sessions-empty' }, '此 Run 暂无 Agent 会话记录。历史版本的会话可能只有运行日志，无法还原未记录的会话正文。') : null,
              !state.listLoading && state.items.length > 0 && !visibleSessions.length ? h('p', { role: 'status', className: 'agent-sessions-empty' }, '没有符合筛选条件的会话。') : null,
              visibleSessions.map(item => h('button', { type: 'button', key: item.session_id, className: 'agent-session-option', 'aria-pressed': item.session_id === state.selectedId, onClick: () => reader.current?.select(item.session_id) },
                h('strong', null, agentSessionRole(item)), h('span', null, unitTitles[item.unit_id] || item.unit_id || item.action_ids?.join(' · ') || item.stage || '待关联任务'),
                h('span', null, item.provider || '执行器未记录'), h('small', null, item.model || '模型未记录'), h('small', null, `${agentSessionStatus(item.status)} · ${item.event_count ?? 0} 条事件`), item.history_status === 'metadata_only' ? h('small', null, '历史会话 · 仅元数据') : null))),
            h('main', { className: 'agent-session-main', 'aria-label': 'Agent 会话内容', tabIndex: 0 },
              !session ? h(React.Fragment, null, state.detailError ? h('p', { role: 'alert', className: 'agent-session-alert' }, state.detailError) : null, h('p', { className: 'agent-sessions-empty' }, '选择左侧会话，查看指令、回复与工具执行详情。')) : h(React.Fragment, null,
                h('details', { className: 'agent-session-meta' }, h('summary', null, '会话信息'), h('h3', null, agentSessionRole(session)), h('span', { className: 'badge' }, agentSessionStatus(session.status)),
                  h('dl', null, [['执行器 / 模型', [session.provider, session.model].filter(Boolean).join(' / ') || '未记录'], ['原 Agent 会话', session.remote_session_id || session.agent_session_id || '尚未绑定'], ['本地会话', session.session_id], ['关联任务', session.action_ids?.join('、') || session.unit_id || '未记录'], ['最近工具', session.last_tool_id ? `${session.last_tool_id} · ${agentSessionStatus(session.last_tool_status)}` : '未记录']].map(([label, value]) => h(React.Fragment, { key: label }, h('dt', null, label), h('dd', null, value))))),
                (state.detailRecordingError || session.recording_error) ? h('div', { role: 'alert', className: 'agent-session-alert' }, `会话记录不完整：${agentSessionContent(state.detailRecordingError || session.recording_error)}`) : null,
                state.detailTruncated || session.truncated ? h('div', { role: 'status', className: 'agent-session-alert' }, '部分记录已截断，以下内容不代表完整会话。') : null,
                session.history_message ? h('div', { className: 'agent-session-alert', role: 'status' }, agentSessionContent(session.history_message)) : (state.historyStatus || session.history_status) === 'metadata_only' ? h('div', { className: 'agent-session-alert' }, '此历史会话仅保留身份与运行状态，没有采集指令、Agent 回复和工具输入输出；无法补回此前未记录的内容。') : null,
                state.detailError ? h('div', { role: 'alert', className: 'agent-session-alert' }, `会话内容读取失败：${state.detailError}。已读取的内容仍保留，可点击“刷新记录”重试。`) : null,
                state.historyError ? h('div', { role: 'alert', className: 'agent-session-alert' }, `更早历史读取失败：${state.historyError}。最新记录继续同步，可重试加载历史。`) : null,
                sessionQuery.trim() && !visibleEvents.length ? h('p', { role: 'status' }, '已加载记录中没有匹配内容，可加载更早记录或调整搜索。') : null,
                h(AgentSessionTranscript, { events: visibleEvents }),
                !state.events.length && !state.detailLoading && !state.detailError && (state.historyStatus || session.history_status) !== 'metadata_only' ? h('p', { className: 'agent-sessions-empty' }, '会话已关联，尚未收到可显示的事件；这不表示 Agent 已完成。') : null,
                state.detailLoading ? h('p', { role: 'status', className: 'agent-session-muted' }, '正在读取会话事件…') : null,
                state.hasMore ? h('button', { type: 'button', className: 'agent-button', disabled: state.historyLoading, onClick: () => reader.current?.loadMore() }, state.historyLoading ? '正在加载更早历史…' : '加载更早会话事件') : null))),
          h('footer', { className: 'agent-session-footer' }, h('span', null, '只读查看，不向 Agent 发送消息或重复执行工具。'), h('span', { role: 'status' }, `${state.hasMore ? '还有更早历史 · 最新记录持续同步 · ' : ''}${state.updatedAt ? `最近同步 ${state.updatedAt}` : '等待首次同步'}`))))
    }

    function renderRunInsights(insights, { openFlow, navigate, openReport, showAll }) {
      const time = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '保存时间未记录'
      const text = value => renderReadableBody(value)
      const acceptance = value => ({ accepted: '已接受', delivered: '已交付', draft: '已保存草稿' })[value] ?? '已保存'
      const section = (title, children) => h('section', { className: 'run-insight-section', style: { marginBottom: 24 } }, h('h3', { style: { margin: '0 0 12px', fontSize: 14 } }, title), children)
      const card = (key, ...children) => h('article', { key, style: { border: '1px solid var(--dsw-alias-border, #dce2dc)', borderRadius: 9, padding: '13px 15px', marginBottom: 10, overflowWrap: 'anywhere' } }, ...children)
      const recordKey = row => row.key ?? `${row.ref?.action_id ?? ''}:${row.ref?.record_id ?? ''}:${row.ref?.revision ?? ''}`
      const output = row => card(recordKey(row),
        h('div', { className: 'row between', style: { alignItems: 'flex-start', gap: 10 } }, h('strong', { style: { fontSize: 14 } }, row.title), h('span', { className: `badge ${row.acceptance === 'accepted' || row.acceptance === 'delivered' ? 'good' : ''}` }, acceptance(row.acceptance))),
        h('p', { className: 'small muted', style: { margin: '7px 0' } }, [row.label, row.ref?.unit_id, row.saved_at_ms ? `所在产物更新于 ${time(row.saved_at_ms)}` : time(null)].filter(Boolean).join(' · ')),
        row.navigation?.type === 'flow' && openFlow ? h('button', { type: 'button', className: 'link', onClick: () => openFlow(row.navigation.id) }, '查看业务流程', runIcon('ArrowUpRight')) : row.navigation?.type === 'case' && navigate ? h('button', { type: 'button', className: 'link', onClick: () => navigate({ type: 'case', id: row.navigation.id }) }, '查看测试用例', runIcon('ArrowUpRight')) : null,
        row.kind === 'review_decision' ? renderReviewPresentation(h, row.record?.body, { renderText: text })
          : h('details', { style: { marginTop: 10 } }, h('summary', { style: { cursor: 'pointer', fontSize: 12 } }, isReviewRecord(row.record, row.ref?.stage) ? '查看复核内容与依据' : '查看已保存内容'),
            isReviewRecord(row.record, row.ref?.stage) ? renderReviewPresentation(h, row.record?.body, { renderText: text }) : text(row.record?.body)))
      return h('div', { className: 'run-insights', 'aria-label': '阶段进展' },
        insights.notices.map((notice, index) => h('p', { key: index, className: 'small muted', role: 'status', style: { borderLeft: '3px solid #c3a36d', padding: '8px 12px', lineHeight: 1.7 } }, typeof notice === 'string' ? notice : notice.message)),
        insights.pending.length ? section('明确记录的待处理事项', insights.pending.map(row => card(recordKey(row), h('strong', { style: { fontSize: 14 } }, row.title), row.reason ? text(row.reason) : null,
          row.action ? h('div', null, h('strong', { className: 'small' }, '建议处理'), text(row.action)) : null,
          h('p', { className: 'small muted', style: { margin: '8px 0 0' } }, [row.source_label, row.ref?.unit_id, row.note].filter(Boolean).join(' · '))))) : null,
        section('已保存的阶段产出', h(React.Fragment, null,
          insights.outputs.counts.length ? h('div', { className: 'row', style: { flexWrap: 'wrap', gap: 8, marginBottom: 12 } }, insights.outputs.counts.map(item => h('span', { key: item.kind, className: 'badge', title: `${item.accepted} 条已接受 · ${item.delivered} 条已交付 · ${item.draft} 条草稿` }, `${item.label} ${item.count}`))) : null,
          insights.outputs.latest.length ? insights.outputs.latest.map(output) : h('p', { className: 'small muted' }, insights.availability === 'unavailable' ? '阶段产物暂不可读取。' : '当前阶段尚未读取到已保存产物。'),
          insights.outputs.total_records > insights.outputs.latest.length ? h('p', { className: 'small muted' }, `已读取 ${insights.outputs.total_records} 条记录，当前展示 ${insights.outputs.latest.length} 条产物；完整记录可在“阶段任务”的产物文件中查看。`) : null,
          openReport ? h('button', { type: 'button', className: 'link', onClick: openReport }, '查看本次交付报告', runIcon('ArrowUpRight')) : null)),
        insights.outputs.more || insights.pending_more || insights.current_work_more ? h('button', { type: 'button', className: 'btn', onClick: showAll, style: { marginBottom: 20 } }, `展开全部阶段信息${insights.pending_more ? `（还有 ${insights.pending_more} 项待处理）` : ''}`) : null,
        !insights.pending.length && ['readable', 'partial'].includes(insights.availability) ? h('p', { className: 'small muted' }, '本阶段已读取记录中没有明确列出的待处理事项。') : null,
        insights.current_work.length ? section('阶段任务进展', h('details', null, h('summary', { style: { cursor: 'pointer', fontSize: 14, marginBottom: 10 } }, `${insights.current_work.length + insights.current_work_more} 项任务 · 查看状态与最近保存时间`), insights.current_work.map(row => card(row.action_id ?? row.unit_id, h('strong', { style: { fontSize: 14 } }, row.title), row.purpose ? text(row.purpose) : null, h('p', { className: 'small muted', style: { marginBottom: 0 } }, [row.state_label, row.last_saved_at_ms ? `最近保存 ${time(row.last_saved_at_ms)}` : '尚未记录结果保存时间'].filter(Boolean).join(' · ')))))) : null,
        insights.scope.units.length ? section('本阶段分析范围', h('details', null, h('summary', { style: { cursor: 'pointer', fontSize: 14 } }, `已读取 ${insights.scope.units.length} 个分析单元 · 查看目标与范围`), insights.scope.units.map(unit => card(unit.unit_id, h('strong', { style: { fontSize: 14 } }, unit.title), unit.purpose ? text(unit.purpose) : null, unit.owned_regions?.length ? text(unit.owned_regions) : null)))) : null)
    }

    function pageHeader({ title, task, current, onBack, backLabel = '返回任务列表', ui, actions }) {
      const infoAction = task || current ? h(TaskInfoAction, { task, current }) : null
      if (ui?.PageHeader) return h(ui.PageHeader, { title, onBack, backLabel, infoAction, actions })
      return h('header', { className: 'pangea-page-header' },
        h('div', { className: 'pangea-page-heading-row' }, onBack ? h('button', { type: 'button', className: 'pangea-back-button', onClick: onBack, 'aria-label': backLabel }, '←') : null, h('h1', { title }, title)),
        h('div', { className: 'pangea-page-actions' }, infoAction, actions))
    }
    function TaskInfoAction({ task, current }) {
      const [open, setOpen] = React.useState(false)
      const panel = React.useRef(null), trigger = React.useRef(null)
      React.useEffect(() => {
        if (!open) return
        panel.current?.querySelector('button')?.focus()
        return () => { trigger.current?.focus?.({ preventScroll: true }) }
      }, [open])
      const rows = [
        ['分析目标', current?.target || task?.target], ['仓库', current?.repository || task?.repository],
        ['源码范围', (task?.source_scope || current?.source_scope || []).join('、')], ['运行编号', current?.run_id || task?.run_id],
        ['场景', current?.scenario || task?.scenario], ['工作流', current?.workflow_version || task?.workflow_version],
        ['开始时间', current?.started_at], ['结束时间', current?.ended_at], ['源码文件', current?.source_snapshot?.file_count],
        ['资料版本', (current?.input_materials || []).map(item => `${item.title || item.name || item.asset_id || '资料'}${item.revision != null ? ' r' + item.revision : ''}`).join('、')],
      ]
      return h(React.Fragment, null, h('button', { type: 'button', className: 'pangea-info-button', 'aria-label': '任务信息', ref: trigger, onClick: () => setOpen(true) }, 'ⓘ 任务信息'),
        open ? h('div', { className: 'pangea-info-overlay', onClick: event => { if (event.target === event.currentTarget) setOpen(false) } },
          h('section', { ref: panel, className: 'pangea-info-drawer', role: 'dialog', 'aria-modal': true, 'aria-label': '任务信息', onKeyDown: event => {
            if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
            if (event.key === 'Tab') { const controls = [...panel.current.querySelectorAll('button,a,input,[tabindex="0"]')]; const first = controls[0], last = controls.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() } }
          } }, h('div', { className: 'pangea-page-actions' }, h('h2', null, '任务信息'), h('button', { type: 'button', onClick: () => setOpen(false), 'aria-label': '关闭任务信息' }, '关闭')),
          h('dl', null, rows.map(([label, value]) => h(React.Fragment, { key: label }, h('dt', null, label), h('dd', null, value == null || value === '' ? '未记录' : String(value))))))) : null)
    }
    function RunWorkspace({ current, task, timeline = [], error, loading, busy, retry, navigate: onNavigate, openFile, openFlow, stop, resume, deliver, discuss, diagnostics, viewState, cwd, dataRoot, ui }) {
      const [selection, setSelection] = React.useState(viewState?.selection ?? '')
      const [tab, setTab] = React.useState(viewState?.tab === 'tasks' ? 'tasks' : 'insights')
      const view = () => ({ selection, tab, scrollY: window.scrollY })
      const navigate = target => onNavigate(target, view())
      React.useEffect(() => {
        if (viewState?.scrollY == null) return
        const frame = window.requestAnimationFrame(() => window.scrollTo(0, viewState.scrollY))
        return () => window.cancelAnimationFrame(frame)
      }, [])
      const [confirmStop, setConfirmStop] = React.useState(false)
      const [pending, setPending] = React.useState('')
      const [actionError, setActionError] = React.useState('')
      const [sessionsOpen, setSessionsOpen] = React.useState(false)
      const [insightLimit, setInsightLimit] = React.useState(3)
      const dialog = React.useRef(null)
      const stopTrigger = React.useRef(null)
      React.useEffect(() => {
        if (!confirmStop) return
        const previous = stopTrigger.current
        const workspace = dialog.current?.closest('.pangea-run-workspace')
        dialog.current?.querySelector('button')?.focus()
        return () => requestAnimationFrame(() => {
          if (previous?.isConnected && !previous.disabled && previous.getClientRects().length) previous.focus()
          else if (workspace?.isConnected) workspace.querySelector('.page-actions button:not(:disabled)')?.focus()
        })
      }, [confirmStop])
      const node = (tag, className, ...children) => h(tag, { className }, ...children)
      const badge = (label, tone = '') => node('span', `badge ${tone}`, label)
      const button = (label, onClick, tone = '', disabled = false, props = {}) => h('button', { type: 'button', className: `btn ${tone}`, onClick, disabled: disabled || Boolean(pending) || busy, ...props }, ({ 'AI 助手': 'Sparkles', '返回任务列表': 'ArrowLeft', '停止': 'Square', '确认停止': 'Square', '查看报告': 'FileText', '重试读取': 'RefreshCw', '继续分析': 'Play', '继续修正': 'Play' })[label] ? runIcon(({ 'AI 助手': 'Sparkles', '返回任务列表': 'ArrowLeft', '停止': 'Square', '确认停止': 'Square', '查看报告': 'FileText', '重试读取': 'RefreshCw', '继续分析': 'Play', '继续修正': 'Play' })[label]) : null, label)
      const heading = (label, right) => node('div', 'section-head', h('h2', null, label), right)
      const stat = (label, value) => node('div', 'stat', h('label', null, label), h('strong', null, value))
      const fields = rows => node('dl', 'key-value small', rows.map(([label, value]) => h(React.Fragment, { key: label }, h('dt', null, label), h('dd', null, value))))
      const perform = async (name, action) => {
        if (pending || busy) return
        if (name === 'stop' && stopBlockedReason) { setActionError(stopBlockedReason); return }
        setPending(name); setActionError('')
        try { await action(); if (name === 'stop') setConfirmStop(false) }
        catch (reason) { setActionError(reason instanceof Error ? reason.message : String(reason)) }
        finally { setPending('') }
      }
      const p = deriveRunPresentation(task, current, current?.reader_health)
      const observation = executionObservation(current, task, Boolean(error))
      const stopBlockedReason = error ? '当前状态读取失败，请先重试读取后再停止。' : !current?.run_id ? '当前运行身份尚未读取。' : p.stopping ? '停止请求已发出，正在等待执行端确认。' : current.terminal || p.stopped || p.failed ? '当前运行已结束，无需再次停止。' : ''
      const snapshotStatus = current?.source_snapshot?.status
      const snapshotLabel = ['manifest_verified', 'frozen', 'verified'].includes(snapshotStatus) ? '已冻结' : ['corrupt', 'invalid'].includes(snapshotStatus) ? '资料损坏，待检查' : snapshotStatus === 'legacy_unavailable' ? '历史 Run 未冻结' : '尚未验证'
      const attention = Boolean(current?.needs_user || p.needsAttention)
      const failureReason = sourceFirstRecordBody(current?.terminal_error || task?.launch_error || current?.blocking_reason || current?.workflow?.error || '未记录具体原因，请展开执行详情查看诊断。')
      const finished = current?.lifecycle_status === 'complete' || (!current?.lifecycle_status && current?.terminal && current?.phase === 'COMPLETE')
      const outcome = outcomePresentation(current)
      const reportPath = current?.report_available ? current.artifacts?.report_html ?? current.artifacts?.report_md : null
      const completionSummary = current?.partial_delivery ? '本次流程已结束，未解决事项随已有结果保留，请查看交付范围。' : reportPath ? '结果已汇总并保存，可以查看报告与完整运行记录。' : '本次流程已结束，当前没有已验证可读取的分析报告。'
      const steps = current?.workflow?.steps ?? []
      const active = steps.find(step => step.step === current?.workflow?.current_step) ?? steps.find(step => current?.stage && step.stage === current.stage)
        ?? steps.find(step => ['running', 'paused', 'stopped', 'failed'].includes(step.status)) ?? steps.at(-1)
      const selected = steps.find(step => step.step === selection) ?? active
      const stageDescription = { preparing: '冻结本次分析输入，记录源码与资产修订。', planning: '按冻结的源码范围划分分析单元。', reviewing: '复核分析结果与源码依据，记录需要修正的问题。', closing: '根据复核发现补充依据、修正结论，保留修订记录。', reporting: '汇总已保存结果与未解决事项，生成本次交付报告。', complete: '全部阶段已结束，交付物与本次运行记录已保存。' }[selected?.stage]
      const units = current?.workflow?.units ?? []
      const actions = current?.workflow?.actions ?? []
      const stages = { preparing: [], planning: ['unit_planning', 'source_first_plan'], analyzing: ['unit_analysis'], reviewing: ['independent_review', 'comparison_review'], closing: ['targeted_closure'], reporting: ['report'], complete: [] }
      const selectedActions = actions.filter(action => (stages[selected?.stage] ?? [selected?.stage]).includes(action.stage))
      const tasks = selected?.stage === 'analyzing' ? units : selectedActions
      const sessionSelection = item => {
        const candidates = selectedActions.filter(action => action.unit_id === item.unit_id && (!['failed', 'paused'].includes(item.status) || ['failed', 'paused'].includes(action.status)))
        const action = item.action_id ? item : candidates.length === 1 ? candidates[0] : null
        return { initialUnitId: item.unit_id, initialActionId: action?.action_id, initialAttemptId: item.attempt_id || action?.attempt_id || task?.attempt_id }
      }
      const status = error ? '上次记录' : p.stopping ? '正在停止' : p.failed ? '分析失败' : p.stopped ? '已停止' : attention ? '等待决定' : finished ? '已完成' : '运行中'
      const tone = error ? 'blue' : attention || p.failed ? 'warn' : finished ? 'good' : 'blue'
      const legacy = current && current.workflow_version !== 'source-first-v1'
      const stepProgress = legacy && current.workflow?.step_progress?.step === selected?.step ? current.workflow.step_progress : null
      const insights = buildRunInsights(current, selected ?? {}, { stale: Boolean(error), limit: insightLimit })
      const timingTask = p.identityMatched ? task : null
      const attempt = timingTask?.attempts?.find(item => item.attempt_id === timingTask.attempt_id)
      const startTime = current?.started_at ?? timingTask?.launch_started_at ?? attempt?.started_at
      const timestamp = value => value == null || value === '' ? NaN : new Date(value).getTime()
      const started = timestamp(startTime)
      // End timestamps are persisted on the execution attempt, not the Task.
      // Never turn a terminal or unreadable historical Run into a live clock.
      const live = !error && !current?.terminal && !finished && (p.running || p.stopping)
      const ended = [current?.ended_at, timingTask?.ended_at, ...(!live ? [attempt?.ended_at] : [])]
        .map(timestamp).find(value => Number.isFinite(value) && value >= started)
      const endTime = ended ?? (live ? Date.now() : NaN)
      const elapsed = Number.isFinite(started) && Number.isFinite(endTime) && endTime >= started ? endTime - started : null
      const duration = elapsed == null ? '未记录' : `${String(Math.floor(elapsed / 60000)).padStart(2, '0')}:${String(Math.floor(elapsed / 1000) % 60).padStart(2, '0')}`
      const time = value => value ? new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) : '未记录'
      const details = current?.details ?? {}
      const outputs = [
        ...(legacy ? [...new Set(current.artifacts?.formal_outputs ?? [])].filter(file => file !== reportPath).map(file => ({ title: artifactLabel(file), caption: '正式产物', action: () => openFile(file) })) : []),
        ...(reportPath ? [{ title: '分析报告', caption: `${current.artifacts.report_html ? 'HTML' : 'Markdown'} · 已保存`, action: () => openFile(reportPath) }] : []),
        ...[['business_flows', '业务流程', 'flows'], ['risks', '风险记录', 'risks'], ['test_cases', '测试用例', 'cases']].filter(([key]) => details[key]?.length && (legacy ? ['draft', 'final'].includes(current.publication?.state) : current?.reader_health?.collection_status?.[key] === 'readable')).map(([key, title, target]) => ({ title, caption: `${details[key].length} 条 · ${current?.publication?.state === 'final' ? '已整理' : '草稿'}`, action: () => navigate(target) })),
      ]
      const notices = error ? h('div', { className: 'notice warn', role: 'alert', style: { marginBottom: 22 } }, node('div', 'notice-main', runIcon('CircleAlert'), node('div', '', h('strong', null, current ? '同步失败，正在显示上次结果' : '无法读取当前运行'), h('p', null, current ? `最后成功读取于 ${time(current.state_read?.observed_at)}。当前执行状态暂时未知，已显示的结果仍保留。` : error))), button('重试读取', retry)) : null
      return node('section', 'pangea-ui pangea-run-workspace',
        sessionsOpen && current?.run_id ? h(AgentSessionsDialog, { key: `${cwd}:${dataRoot}:${current.run_id}`, cwd, dataRoot, runId: current.run_id, ...(typeof sessionsOpen === 'object' ? sessionsOpen : {}), unitTitles: Object.fromEntries((current.workflow?.units ?? []).map(unit => [unit.unit_id, unit.title || unit.unit_id])), onClose: () => setSessionsOpen(false) }) : null,
        pageHeader({ title: task?.title || current?.target || '运行过程', task, current, ui, onBack: () => navigate('tasks') }),
        node('div', 'page-actions run-context-actions',
          error ? button('重试读取', retry, 'primary') : null,
          !error && p.canResume ? button('继续分析', () => perform('resume', resume), 'primary') : null,
          !error && !p.canResume && outputs.length ? button('查看已生成结果', outputs[0].action, 'primary') : null,
          !error && current && !current.terminal && !finished && !p.stopped && !p.failed ? button(p.stopping ? '等待停止确认' : '停止', () => setConfirmStop(true), 'danger', p.stopping, { ref: stopTrigger }) : null,
          reportPath ? button('查看报告', () => openFile(reportPath)) : null,
          button('AI 助手', () => perform('discuss', discuss), '', !task)),
        node('nav', 'task-tabs', [['overview', '概览'], ['flows', '业务流程', 'business_flows'], ...(riskApplicable(current) ? [['risks', '风险', 'risks']] : []), ['cases', '测试用例', 'test_cases'], ['workflow', '运行过程']].map(([target, label, key]) => h('button', { key: target, type: 'button', className: target === 'workflow' ? 'active' : '', 'aria-current': target === 'workflow' ? 'page' : undefined, disabled: target === 'overview' && !task, 'aria-describedby': target === 'overview' && !task ? 'run-task-unavailable' : undefined, onClick: () => navigate(target) }, label, key && current?.counts?.[key] != null ? h('small', { title: current.reader_health?.collection_status?.[key] === 'unavailable' ? '产物暂不可读取' : undefined }, current.reader_health?.collection_status?.[key] === 'unavailable' ? '—' : current.counts[key]) : null))),
        !task && current ? h('p', { id: 'run-task-unavailable', className: 'small muted' }, '此历史 Run 未关联任务记录，任务概览不可用。仍可查看运行记录与已保存产物。') : null,
        notices,
        analysisExecutorBlockedReason(task) ? h('p', { role: 'status', className: 'small muted' }, analysisExecutorBlockedReason(task)) : null,
        current?.reader_health?.status === 'warning' ? h('div', { className: 'notice warn', role: 'alert' }, node('div', '', h('strong', null, '部分运行资料暂不可读取'), h('p', null, (current.reader_health.issues ?? []).join('；') || '请检查运行资料。不可读取的产物不计为零。')), button('重试读取', retry)) : null,
        legacy && (current.validation?.status === 'failed' || current.workflow?.unresolved?.length) ? h('div', { role: 'alert', className: 'notice warn' }, '当前运行有校验失败或未解决事项，请展开运行信息查看完整原因。') : null,
        actionError ? h('div', { role: 'alert', className: 'notice danger' }, actionError) : null,
        !current ? node('div', 'stack', !error ? h('div', { className: 'notice blue', role: 'status' }, node('div', 'notice-main', runIcon('Info'), node('div', '', h('strong', null, loading ? '正在读取当前运行' : '当前尚无运行记录'), h('p', null, '正在读取阶段状态与已保存产物。首次读取完成后显示本次运行信息。')))) : null,
          loading ? node('section', 'panel', node('div', 'skeleton large'), h('div', { className: 'skeleton', style: { width: '75%' } }), node('div', 'divider'), node('div', 'grid3', [0, 1, 2].map(i => h('div', { key: i }, h('div', { className: 'skeleton', style: { width: '60%' } }), h('div', { className: 'skeleton', style: { height: 120 } }), h('div', { className: 'skeleton', style: { width: '80%' } }))))) : null,
          node('p', 'small muted', '阶段状态尚未读取，不推断运行成功或失败。')) : h(React.Fragment, null,
          node('div', 'hero-band', node('div', '', node('div', 'row', h('h2', null, error ? `上次记录：${current.phase_title ?? ''}` : finished ? '本次分析已完成' : p.stopped ? '本次运行已停止' : attention ? `${current.phase_title ?? '当前阶段'}需要处理` : p.failed ? '本次分析失败' : units.some(unit => unit.status === 'dispatched') ? units.filter(unit => unit.status === 'dispatched').map(unit => unit.title || unit.unit_id).join('、') : observation ? observation.activity : `正在进行${current.phase_title ?? active?.title ?? '当前阶段'}`), badge(status, tone)),
            h('p', null, error ? '当前状态未知，下方是最后成功读取的运行信息。' : p.failed ? '已有结果和失败会话已保留，可查看原因后继续分析。' : current.blocking_reason ? sourceFirstRecordBody(current.blocking_reason) : finished ? completionSummary : p.stopped ? '源码快照、已接受单元和运行记录均已保留。' : '选择阶段，查看已保存的产出和待处理事项；实时对话可在 Agent 会话管理中查看。')),
            node('div', 'metrics', stat('阶段已完成', h(React.Fragment, null, current.workflow?.completed_steps?.length ?? steps.filter(step => step.status === 'completed').length, node('span', 'small muted', ` / ${steps.length}`))), stat('运行时长', duration), stat('用户介入', attention || p.failed ? '需要' : '无需'))),
          p.failed && !error ? h('p', { role: 'alert', className: 'notice danger' }, failureReason) : null,
          attention && !error ? h('div', { className: 'notice warn', style: { marginBottom: 24 } }, node('div', 'notice-main', runIcon('CircleAlert'), node('div', '', h('strong', null, '选择接下来的处理方式'), h('p', null, !task ? '此 Run 未关联任务记录，无法继续执行或交付；可查看已有结果。' : sourceFirstRecordBody(current.blocking_reason) || '查看未解决事项，继续处理或交付已有结果。'))), node('div', 'row', button('交付已有结果', () => perform('deliver', deliver), '', !task), button('继续修正', () => perform('resume', resume), '', !task?.can_resume))) : null,
          h('details', { className: 'run-execution-details' }, h('summary', null, '执行详情与 Agent 会话'), h('button', { type: 'button', className: 'btn', disabled: !current?.run_id || !cwd, onClick: () => setSessionsOpen(true) }, 'Agent 会话管理'), h(RunExecutionSummary, { current, task, stale: Boolean(error) })),
          node('div', 'run-layout', node('section', 'run-stages', heading('运行阶段', node('span', 'tiny muted', `${steps.length} 个阶段`)),
            steps.map(step => h('button', { key: step.step, type: 'button', className: `stage ${step.status === 'completed' ? 'done' : ''} ${step === selected ? 'current' : ''}`, 'aria-pressed': step === selected, onClick: () => setSelection(step.step) },
              h('b', null, step.status === 'completed' ? '✓' : step.step), h('div', null, step.title, h('p', null, error && step === active ? '上次记录' : step.status === 'pending' ? '等待前序完成' : step.status === 'running' ? p.failed && step === active ? '本次执行失败' : '当前正在执行' : step.status === 'paused' ? '等待你的决定' : step.status === 'stopped' && p.canResume ? '已停止 · 可继续' : STAGE_STATUS[step.status] ?? step.status)))), node('p', 'aside-note', '选择阶段，查看对应任务与产物。')),
            node('section', 'panel run-focus', node('div', 'pad', node('div', 'eyebrow', `STAGE ${selected?.step ?? '—'} · ${selection || tab === 'tasks' ? '所选阶段' : '当前阶段'}`), node('div', 'row between', h('h2', null, selected?.title ?? '阶段尚未读取'), badge(error ? '上次记录' : selected?.status === 'running' ? p.failed && selected === active ? '执行失败' : '分析中' : selected?.status === 'paused' ? '需要处理' : STAGE_STATUS[selected?.status] ?? status, tone)),
              stepProgress ? node('div', 'callout', h('strong', null, '当前业务进度'), h('p', null, stepProgress.total == null ? `${stepProgress.completed ?? 0} 个已完成` : `${stepProgress.completed ?? 0} / ${stepProgress.total}`), stepProgress.current ? h('p', null, `${stepProgress.current.id} · ${stepProgress.current.title}`) : null, stepProgress.updated_at ? h('p', null, stepProgress.updated_at) : null) : null,
              selected?.stage === 'analyzing' ? h(React.Fragment, null, h('p', { className: 'meta', style: { marginTop: 8 } }, '逐个分析源码单元，整理业务路径、风险与测试依据。'), node('div', 'divider'), node('div', 'row between', h('span', null, h('strong', { style: { fontSize: 23, fontWeight: 500 } }, current.analysis?.completed ?? 0, node('span', 'small muted', ` / ${current.analysis?.total ?? 0}`)), node('span', 'small muted', ' 分析单元已接受')),
                node('div', 'segment', units.map((unit, i) => h('span', { key: unit.unit_id ?? i, className: unit.status === 'accepted' ? 'good' : unit.status === 'dispatched' && p.running && !error ? 'active' : '' }))))) : stageDescription ? h('p', { className: 'meta', style: { marginTop: 8 } }, stageDescription) : null),
              node('div', 'tabs-mini', ['insights', 'tasks'].map(value => h('button', { type: 'button', key: value, className: value === tab ? 'active' : '', 'aria-pressed': value === tab, onClick: () => { setSelection(selected?.step ?? ''); setTab(value) } }, value === 'insights' ? '阶段进展' : '阶段任务'))),
              h('div', { key: `${current.run_id}:${selected?.step}:${tab}`, className: 'activity', role: 'region', tabIndex: 0, 'aria-label': `${selected?.title ?? '当前阶段'} · ${tab === 'tasks' ? '阶段任务' : '阶段进展'}` }, tab === 'tasks' ? h(React.Fragment, null, heading(selected?.stage === 'analyzing' ? '源码分析单元' : '阶段任务', badge(legacy ? `${tasks.length} 项任务` : `${tasks.filter(item => item.status === 'accepted').length} / ${tasks.length} 已接受`, legacy ? '' : 'good')),
                tasks.length ? tasks.map(item => h('div', { key: item.unit_id ?? item.action_id, className: 'list-row', style: { padding: '10px 0' } }, h('button', { type: 'button', className: 'pangea-stage-session', onClick: () => setSessionsOpen(sessionSelection(item)) }, item.title ?? item.task_id ?? item.action_id, ' ↗'), badge(({ accepted: '已接受', settled: '待接受', dispatched: p.stopped ? '已停止' : p.failed && selected === active ? '执行已中断' : '执行中', pending: '等待', failed: '失败', paused: '待处理' })[item.status] ?? item.status, item.status === 'accepted' ? 'good' : 'neutral'))) : node('p', 'muted small', '当前阶段暂无任务。'),
                selected?.artifacts?.length ? node('div', 'run-information', heading('阶段产物'), h('ul', { className: 'stage-artifact-list', 'aria-label': '阶段产物', role: 'list' }, selected.artifacts.map(file => h('li', { key: file },
                  h('button', { type: 'button', className: 'stage-artifact-link', title: file, 'aria-label': `打开${artifactLabel(file)}：${file}`, onClick: () => openFile(file) }, runIcon('FileText'),
                    node('span', 'stage-artifact-copy', node('span', 'stage-artifact-title', artifactLabel(file)), node('span', 'stage-artifact-name', file.split(/[\\/]/).pop())), node('span', 'stage-artifact-open', '打开')))))) : null)
                : renderRunInsights(insights, { openFlow: id => openFlow(id, view()), navigate, showAll: () => setInsightLimit(Number.MAX_SAFE_INTEGER), openReport: reportPath && ['reporting', 'complete'].includes(selected?.stage) ? () => openFile(reportPath) : null })),
              node('div', 'run-foot', h('span', null, h('span', { className: 'status-dot' }), error ? '正在显示上次记录' : insights.last_saved_at_ms ? `最近保存 · ${time(insights.last_saved_at_ms)}` : '尚未记录结果保存时间'), h('span', null, '产出按保存时间倒序'))),
            node('aside', 'run-aside', h('section', null, heading('已产出', node('span', 'tiny muted', `${outputs.length} 项可查看`)), outputs.map(output => h('div', { key: output.title, className: 'file-row' }, runIcon('FileText'), h('div', null, h('div', { style: { fontSize: 14 } }, output.title), node('div', 'meta', output.caption)), button('查看', output.action, 'ghost'))), !outputs.length ? node('p', 'small muted', '当前尚无可读取产物。') : null, node('p', 'aside-note', current.publication?.state === 'final' ? '报告包含结论、源码依据与测试建议。' : '分析中的内容为草稿，复核后更新。')),
              h('section', { style: { marginTop: 28 } }, heading('本次运行'), fields([['分析方式', ({ 'module-analysis': '模块分析', 'coverage-analysis': '覆盖率分析', 'risk-analysis': '风险分析', 'branch-analysis': '分支分析' })[current.scenario] ?? current.scenario ?? '未记录'], ['运行模式', ({ depth: '标准型', speed: '速度型' })[current.mode] ?? current.mode ?? '未记录'], ['源码快照', current.source_snapshot?.file_count == null ? '未读取' : `${current.source_snapshot.file_count} 个文件 · ${snapshotLabel}`], ['分析范围', current.target ?? '未记录']]), node('div', 'divider'), node('div', 'small muted', runIcon('LockKeyhole'), ['manifest_verified', 'frozen', 'verified'].includes(snapshotStatus) ? ' 基于冻结的源码快照' : ` 源码快照${snapshotLabel}`),
                node('details', 'run-information', h('summary', null, '运行信息'), fields([['运行编号', current.run_id], ['开始时间', time(startTime)], ['最近同步', time(current.state_read?.observed_at)], ['工作流', current.workflow_version], ['交付完整性', outcome.delivery], ['审查方式', outcome.review], ['语义结论', outcome.semantic]]), diagnostics), p.stopped && !p.canResume ? h('p', { className: 'aside-note', role: 'status' }, p.resumeBlockedReason) : null)))),
          confirmStop ? node('div', 'run-overlay', h('section', { className: 'modal', ref: dialog, role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'pangea-stop-title', onKeyDown: event => {
            if (event.key === 'Escape' && !pending) { event.preventDefault(); setConfirmStop(false) }
            if (event.key === 'Tab') { const items = [...dialog.current.querySelectorAll('button:not(:disabled)')]; if (!items.length) { event.preventDefault(); return }; const first = items[0], last = items.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() } }
          } }, node('div', 'modal-head', h('h2', { id: 'pangea-stop-title' }, '停止本次运行？'), h('button', { type: 'button', className: 'close', disabled: Boolean(pending), onClick: () => setConfirmStop(false), 'aria-label': '关闭' }, runIcon('X'))), h('p', null, '停止后保留源码快照、已保存草稿、已完成提交和运行记录。确认旧执行停止后，按检查点续接未完成任务。'), h('div', { className: 'callout', style: { marginTop: 20 } }, node('div', 'row between', h('strong', null, task?.title), badge(status, tone)), node('p', 'small', `${current?.run_id} · ${current?.phase_title} · ${current?.analysis?.completed ?? 0} / ${current?.analysis?.total ?? 0} 单元已接受`)), h('p', { className: 'small', style: { marginTop: 18 } }, '正式操作会等待执行端确认停止，再更新状态。'), stopBlockedReason ? h('p', { role: 'alert' }, stopBlockedReason) : null, actionError ? h('p', { role: 'alert' }, actionError) : null, node('div', 'modal-footer', button('继续运行', () => setConfirmStop(false)), button(pending === 'stop' ? '正在请求停止…' : '确认停止', () => perform('stop', stop), 'danger', Boolean(stopBlockedReason))))) : null)
    }

    const inject = ['pangea', 'sessions']
    const API_PATH = '/api/pangea-companion/state'
    const SOURCE_API_PATH = '/api/pangea-companion/source'
    const EXPORT_API_PATH = '/api/pangea-companion/export'
    const ENVIRONMENT_API_PATH = '/api/pangea-companion/environments'
    const EXECUTION_API_PATH = '/api/pangea-companion/executions'
    const WORKBENCH_API_PATH = '/api/pangea-companion/workbench'
    const REPOSITORY_API_PATH = '/api/pangea-companion/repositories'
    const ACP_SETTINGS_API_PATH = '/api/pangea-companion/acp-settings'
    const ASSET_CATALOG_API_PATH = '/api/pangea-asset-catalog/state'
    const ACTIVE_POLL_INTERVAL_MS = 2_000
    const IDLE_POLL_INTERVAL_MS = 45_000
    const WORKBENCH_ACTIVE_POLL_INTERVAL_MS = 2_000
    const WORKBENCH_BACKGROUND_POLL_INTERVAL_MS = 45_000
    const ACP_PROVIDER_STORAGE_KEY = 'pangea.acp-provider.v1'


    const STAGE_STATUS = { pending: '未开始', running: '执行中', completed: '已完成', paused: '待继续', skipped: '无需执行', failed: '失败', stopped: '已停止' }
    const CASE_READINESS = { ready: '具备执行条件（未代表实测通过）', needs_setup: '待补执行条件', unclassified: '执行条件未标注' }
    const RECORD_LABELS = { check: '检查记录', note: '分析说明', summary: '分析总结', unresolved: '待确认事项', flow: '业务流程', test_case: '测试用例', test_case_group: '用例组', risk: '风险', evidence: '源码依据', unit_plan: '单元计划', review_finding: '复核发现', review_decision: '复核结论' }
    const DIAGRAM_LABELS = { workflow: '业务流程图', architecture: '模块架构图', sequence: '时序图', lifecycle: '生命周期图', dataflow: '数据流图' }
    const DIAGRAM_STATUS = { generating: '正在生成', ready: '已生成', failed: '生成失败', stopped: '已停止', interrupted: '执行已中断' }
    function diagramName(view) {
      return view?.profile === 'function_variables' ? '函数与变量图' : DIAGRAM_LABELS[view?.type] || '图表'
    }
    function diagramVersion(view, views) {
      const versions = views.filter(item => item.run_id === view.run_id && item.flow_id === view.flow_id && item.type === view.type && (item.profile ?? 'standard') === (view.profile ?? 'standard'))
        .slice().sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
      return `v${versions.findIndex(item => item.view_id === view.view_id) + 1}`
    }
    function artifactLabel(file) {
      const name = file.split(/[\\/]/).pop()
      return ({ 'task-contract.json': '冻结任务合同', 'source-manifest.json': '冻结源码清单', 'source-index.json': '源码索引', 'source-first-plan.json': '分析范围与单元计划', 'report.md': '测试报告', 'report.html': '离线测试报告', 'report-complete.json': '报告完成记录' })[name]
        ?? (/task/i.test(file) ? '阶段任务' : /result/i.test(file) ? '阶段结果' : '运行记录')
    }
    // All text becomes React text nodes. No HTML execution or external markdown dependency.
    function renderReadableBody(value, hideSourceEvidence = false) {
      const inline = value => !/\*\*|`/.test(String(value)) ? String(value) : String(value).split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part, index) => part.startsWith('**') && part.endsWith('**') ? h('strong', { key: index }, part.slice(2, -2)) : part.startsWith('`') && part.endsWith('`') ? h('code', { key: index }, part.slice(1, -1)) : part)
      let body = value
      if (typeof body === 'string' && /^[\s]*[\[{]/.test(body)) {
        try { body = JSON.parse(body) } catch { /* preserve non-JSON prose */ }
      }
      if (Array.isArray(body)) return h('ul', { className: 'pangea-reader' }, body.map((item, i) => h('li', { key: i }, renderReadableBody(item, hideSourceEvidence))))
      if (body && typeof body === 'object') {
        const labels = { entry_points: '业务入口', paths: '业务路径', path_id: '路径编号', condition: '触发条件', node_ids: '节点顺序', case_ids: '关联用例', explanation: '路径说明', candidate_id: '条目编号', asset_id: '资产编号', asset_title: '资产名称', item_id: '原文条目编号', item_type: '资料类型', topic: '主题', inputs: '输入', outputs: '输出', constraints: '适用条件与约束', acceptance_criteria: '验收标准', modules: '适用模块', interfaces: '接口', states: '状态', main_flows: '主要场景', branch_flows: '分支场景', error_flows: '异常场景', recovery_flows: '恢复场景', symptom: '问题表现', trigger: '触发条件', root_cause: '问题原因', propagation: '影响过程', defect_mechanism: '问题机理', exclusion_conditions: '排除条件', applicable_modules: '适用模块', key_facts: '关键事实', expected_results: '预期结果', related_problems: '相关问题', source_references: '原文出处', location: '位置', path: '文件', title: '标题', content: '说明', description: '说明', summary: '总结', gap: '缺口', reason: '原因', scope: '分析范围', source_evidence: '源码依据', what_is_known: '已确认事实', missing_to_resolve: '待补条件', recommended_action: '建议', preconditions: '前置条件', steps: '操作步骤', action: '操作', expected: '预期', cleanup: '清理恢复' }
        Object.assign(labels, { evidence_quotes: '源码引文', ref: '位置', snippet: '原样引文', check_id: '检查编号', lens: '检查镜头', object: '检查对象', hypothesis: '假设', conclusion: '结论', reasoning: '依据', sites: '位置', signal_ids: '关联信号', risk_ids: '关联风险', system_result: '系统结果', external_observation: '外部观测', exclusion_condition: '排除条件' })
        return h('dl', { className: 'pangea-reader' }, Object.entries(body).filter(([key]) => !hideSourceEvidence || !['source_evidence', '源码依据'].includes(key)).map(([key, value]) => h(React.Fragment, { key }, h('dt', { style: { fontWeight: 600, marginTop: 8 } }, labels[key] ?? key), h('dd', { style: { marginLeft: 0 } }, key === 'snippet' ? h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, String(value ?? '')) : renderReadableBody(value, hideSourceEvidence)))))
      }
      const lines = String(body ?? '').split(/\r?\n/), nodes = []
      const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (/^\s*```/.test(line)) {
          const code = []
          while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i])
          nodes.push(h('pre', { key: i, style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, code.join('\n')))
        } else if (line.includes('|') && i + 1 < lines.length && cells(lines[i + 1]).every(cell => /^:?-{3,}:?$/.test(cell))) {
          const headers = cells(line), rows = []; i++
          while (i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].trim()) rows.push(cells(lines[++i]))
          nodes.push(h('div', { key: i, className: 'pangea-reader-table', tabIndex: 0, role: 'region', 'aria-label': headers.join('、'), style: { overflowX: 'auto' } }, h('table', { style: { borderCollapse: 'collapse', width: '100%' } }, h('thead', null, h('tr', null, headers.map((cell, j) => h('th', { key: j, scope: 'col', style: { textAlign: 'left', padding: 7, borderBottom: '1px solid #aaa' } }, cell)))), h('tbody', null, rows.map((row, j) => h('tr', { key: j }, row.map((cell, k) => h('td', { key: k, style: { padding: 7, verticalAlign: 'top', borderBottom: '1px solid #ddd' } }, cell))))))))
        } else if (/^#{1,6}\s/.test(line)) nodes.push(h(`h${Math.min(6, line.match(/^#+/)[0].length + 1)}`, { key: i }, inline(line.replace(/^#{1,6}\s+/, ''))))
        else if (/^\s*[-*+]\s/.test(line)) nodes.push(h('div', { key: i, style: { paddingLeft: 10, margin: '5px 0' } }, '• ', inline(line.replace(/^\s*[-*+]\s+/, ''))))
        else if (line.trim()) nodes.push(h('p', { key: i, style: { margin: '7px 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, inline(line)))
      }
      return h('div', { className: 'pangea-reader' }, nodes)
    }
    function collectionWarning(health, key) {
      return health?.count_checks?.[key]?.status === 'mismatch' || health?.collection_status?.[key] === 'unavailable'
    }
    function showRunHealth(screen, selectedTask, current, pageMode) {
      return pageMode === 'analysis' && !!selectedTask?.run_id && selectedTask.run_id === current?.run_id
        && ['overview', 'workflow', 'flows', 'risks', 'risk', 'cases', 'case', 'evidence', 'evidence-detail'].includes(screen.type)
    }

    function snapshotFingerprint(value) {
      try { return JSON.stringify(value) } catch { return null }
    }

    function latestMonitorPersistence(...values) {
      const timestamp = value => Math.max(0, ...['last_success_at_ms', 'last_failure_at_ms', 'recovered_at_ms']
        .map(key => Number.isFinite(value?.[key]) ? value[key] : 0))
      return values.filter(value => ['healthy', 'degraded'].includes(value?.status)).reduce((latest, value) => {
        if (!latest || timestamp(value) > timestamp(latest)) return value
        // Independent requests can complete out of order. A stale healthy
        // response must not hide a newer failure; equal timestamps stay cautious.
        return timestamp(value) === timestamp(latest) && value.status === 'degraded' ? value : latest
      }, null)
    }

    function normalizedPathIdentity(value) {
      if (typeof value !== 'string' || value.trim() === '') return ''
      const normalized = value.trim().replace(/\\/g, '/').replace(/\/+$/, '')
      return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized
    }

    function taskMatchesRun(task, current) {
      if (!task || !current) return !current
      if (typeof task.run_id !== 'string' || typeof current.run_id !== 'string' || task.run_id !== current.run_id) return false
      const taskRoot = normalizedPathIdentity(task.data_root)
      const currentRoot = normalizedPathIdentity(current.data_root)
      return !taskRoot || !currentRoot || taskRoot === currentRoot
    }

    function snapshotMatchesSelection(snapshot, { runId, dataRoot, task } = {}) {
      const current = snapshot?.current
      if (!current) return true
      if (runId === null) return false
      if (typeof runId === 'string' && runId !== current.run_id) return false
      if (task && !taskMatchesRun(task, current)) return false
      const expectedRoot = normalizedPathIdentity(dataRoot)
      const actualRoot = normalizedPathIdentity(snapshot?.data_root ?? current.data_root)
      return !expectedRoot || !actualRoot || expectedRoot === actualRoot
    }

    function workflowAckPresentation(workflow, stateReadStatus) {
      const required = ['path-fidelity', 'evidence-consumption', 'narrative-first']
      const completed = required.filter(id => {
        const value = workflow?.core_rules_ack?.[id]
        return value && typeof value === 'object' && typeof value.ack_at === 'string' && value.ack_at.trim() !== ''
      }).length
      const label = stateReadStatus === 'ok'
        ? `${completed} / ${required.length}`
        : stateReadStatus === 'stale' ? '最近快照（刷新失败）' : '等待状态初始化'
      return { completed, total: required.length, label }
    }

    function snapshotPollInterval(value) {
      return value?.current?.terminal === false ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS
    }

    function outcomePresentation(current) {
      const delivery = current?.delivery_integrity
      const review = current?.semantic_review
      return {
        workflow: current?.lifecycle_status === 'complete' ? '流程完成' : '流程未完成',
        delivery: ({ complete: '交付完整', incomplete: '交付不完整', unavailable: '交付不可读取' })[delivery?.status] ?? '交付尚未检查',
        review: ({ graph_review: current?.mode === 'speed' ? '速度型对照复核（未盲审）' : 'Graph 独立复核', independent_verified: '独立审查（宿主已核验执行）', independent_pending: '独立审查待完成', independent_declared: '独立审查（Agent 声明，宿主未核验）', self_review: '自审', unavailable: '审查记录不可读取' })[review?.method] ?? '审查方式未记录',
        semantic: review?.verdict === 'PASS' ? 'PASS（审查者结论）' : review?.verdict === 'UNRESOLVED' ? 'UNRESOLVED（审查者结论）' : '未给出语义结论',
      }
    }

    function configuredReviewMethod(current) {
      const value = current?.analysis_settings?.review_method
      return typeof value === 'string' && value.trim() ? value.trim() : '未记录'
    }

    function semanticReviewStatusLabel(current) {
      const review = current?.semantic_review
      if (!review || typeof review !== 'object') return '未记录'
      const verdict = ['PASS', 'UNRESOLVED'].includes(review.verdict) ? review.verdict : null
      switch (review.method) {
        case 'graph_review': return verdict ? `Graph 复核结果 · ${verdict}` : 'Graph 复核尚无结论'
        case 'independent_pending': return verdict ? `待独立核验 · 暂存结论 ${verdict}` : '待独立核验'
        case 'independent_verified': return `宿主已核验执行 · ${verdict ? `结论 ${verdict}` : '未给出结论'}`
        case 'independent_declared': return `Agent 已声明${verdict ? ` · 结论 ${verdict}` : ''} · 宿主待核验`
        case 'self_review': return verdict ? `自审结果 · ${verdict}` : '自审尚无结论'
        case 'unavailable': return '审查记录不可读取'
        case 'not_recorded': return '未记录'
        default: return '未记录'
      }
    }

    function analysisExecutorBlockedReason(task) {
      return task && !task.provider ? '内部 API 分析已停用。历史结果仍可查看，请新建分析并选择外部 Agent。' : ''
    }

    function deriveRunPresentation(task, current, health) {
      const executionTask = current && !taskMatchesRun(task, current) ? null : task
      const taskStatus = executionTask?.status ?? ''
      const executionStatus = executionTask?.execution_status ?? ''
      // The state endpoint already reconciles Run progress with its execution.
      // Do not undo that verdict with an older Task response from another poll.
      const runStatus = current?.lifecycle_status ?? (current?.terminal ? ({ COMPLETE: 'complete', FAILED: 'failed', STOPPED: 'stopped' })[current.phase] : undefined)
      const failed = runStatus ? runStatus === 'failed' : ['failed', 'interrupted'].includes(executionStatus) || taskStatus === 'failed'
      const taskNeedsAttention = taskStatus === 'needs_attention' || executionStatus === 'paused'
      const needsAttention = !failed && (runStatus
        ? runStatus === 'attention_required' || (runStatus === 'running' && current?.needs_user === true && taskNeedsAttention)
        : taskNeedsAttention)
      const stopped = runStatus ? ['stopped', 'cancelled'].includes(runStatus) : executionStatus === 'stopped' || taskStatus === 'stopped'
      const stopping = !failed && !needsAttention && !stopped && current?.terminal !== true && executionStatus === 'stopping'
      const running = !failed && !needsAttention && !stopped && !stopping && (runStatus
        ? ['preparing', 'running'].includes(runStatus)
        : executionStatus === 'starting' || executionStatus === 'running' || taskStatus === 'preparing' || taskStatus === 'running')
      const publicationState = current?.publication?.state ?? 'pending'
      const healthStatus = health?.status ?? 'pending'
      const dataStateLabel = healthStatus === 'ok' ? '数据可读取' : healthStatus === 'warning' ? '有读取诊断' : healthStatus === 'pending' ? '尚待读取验证' : HEALTH[healthStatus] ?? healthStatus
      const publicationLabel = failed && publicationState === 'pending' ? '未发布（运行失败）' : needsAttention && publicationState === 'pending' ? '尚未发布（需要处理）' : stopped && publicationState === 'pending' ? '未发布（已停止）' : stopping && publicationState === 'pending' ? '未发布（停止中）' : publicationState === 'pending' && running ? '阶段结果待发布' : publicationState
      const executionLabel = failed ? '分析失败' : needsAttention ? '需要处理' : stopped ? '已停止' : stopping ? '正在停止' : running ? '分析中' : runStatus === 'complete' || executionStatus === 'completed' ? '已完成' : '等待启动'
      const dataTone = healthStatus === 'error' ? 'error' : publicationState === 'final' && healthStatus === 'ok' ? 'ok' : publicationState === 'draft' ? 'notice' : 'neutral'
      const countsAvailability = publicationState === 'pending' ? 'unpublished' : publicationState === 'draft' ? 'draft' : publicationState === 'final' ? 'verified' : publicationState === 'partial' ? 'partial' : 'unavailable'
      const qualityLabel = outcomePresentation(current).semantic
      const executorBlockedReason = analysisExecutorBlockedReason(executionTask)
      const canResume = !executorBlockedReason && !running && !stopping && runStatus !== 'complete' && executionTask?.can_resume === true
      const resumeBlockedReason = canResume ? null : executorBlockedReason || executionTask?.resume_blocked_reason || (!executionTask?.run_id ? '没有可继续的 Run' : running ? '当前执行仍在进行' : executionStatus === 'stopping' ? '正在等待停止确认' : '当前 Run 不满足续跑条件')
      const statusKey = failed ? 'failed' : needsAttention ? 'attention' : stopped ? 'stopped' : stopping ? 'stopping' : running ? 'running' : runStatus === 'complete' || executionStatus === 'completed' ? 'complete' : 'pending'
      return { statusKey, statusLabel: executionLabel, tone: failed ? 'danger' : needsAttention ? 'warn' : statusKey === 'complete' ? 'good' : 'neutral', executionStatus, executionLabel, failed, needsAttention, stopped, stopping, running, healthStatus, dataStateLabel, publicationLabel, dataTone, qualityLabel, countsAvailability, isAnimating: running, canResume, resumeBlockedReason, identityMatched: !current || taskMatchesRun(task, current) }
    }

    function taskLaunchEvents(task, workbench) {
      if (!task || workbench?.selected_task_id !== task.task_id) return []
      return (Array.isArray(workbench.launch_log?.events) ? workbench.launch_log.events : [])
        .filter(event => (!event.task_id || event.task_id === task.task_id)
          && (!task.attempt_id || event.attempt_id === task.attempt_id)
          && (!event.run_id || !task.run_id || event.run_id === task.run_id))
    }

    function previousAttemptFailures(task) {
      return (Array.isArray(task?.attempts) ? task.attempts : [])
        .filter(attempt => attempt?.attempt_id !== task?.attempt_id
          && ['failed', 'interrupted'].includes(attempt?.execution_status)
          && typeof attempt?.terminal_error === 'string'
          && attempt.terminal_error.trim() !== '')
        .sort((left, right) => (right.ended_at ?? right.last_activity_at ?? 0) - (left.ended_at ?? left.last_activity_at ?? 0))
    }

    async function requestSnapshot({ cwd, dataRoot, runId, sessionId, signal, fetcher = fetch }) {
      const query = new URLSearchParams({ cwd })
      if (dataRoot) query.set('data_root', dataRoot)
      if (runId !== undefined) query.set('run_id', runId ?? '')
      if (sessionId) query.set('session_id', sessionId)
      const response = await fetcher(`${API_PATH}?${query.toString()}`, { cache: 'no-store', signal })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      if (!snapshotMatchesSelection(body, { runId, dataRoot })) throw new Error('状态响应与请求的 Run 身份不一致')
      return body
    }

    async function requestSourceSnippet({ cwd, dataRoot, runId, location, contextBefore, contextAfter, signal, fetcher = fetch }) {
      const query = new URLSearchParams({ cwd, data_root: dataRoot, location })
      if (runId) query.set('run_id', runId)
      if (Number.isInteger(contextBefore)) query.set('context_before', String(contextBefore))
      if (Number.isInteger(contextAfter)) query.set('context_after', String(contextAfter))
      const response = await fetcher(`${SOURCE_API_PATH}?${query.toString()}`, { cache: 'no-store', signal })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    async function requestCaseReviews({ cwd, dataRoot, runId, input, signal, fetcher = fetch }) {
      const query = new URLSearchParams({ cwd, data_root: dataRoot, run_id: runId })
      const response = await fetcher(`/api/pangea-companion/case-reviews?${query}`, { cache: 'no-store', signal,
        ...(input ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd, data_root: dataRoot, run_id: runId, ...input }) } : {}) })
      const value = await response.json()
      if (!response.ok || value.status !== 'ok') throw new Error(value.error || `HTTP ${response.status}`)
      if (value.run_id !== runId) throw new Error('评审响应与当前 Run 不一致')
      return value
    }
    async function requestRunExport({ cwd, dataRoot, runId, format = 'csv', scope, caseKeys, caseSetRevision, reviewRevision, signal, fetcher = fetch }) {
      const query = new URLSearchParams({ cwd, data_root: dataRoot, run_id: runId, format })
      const response = await fetcher(`${EXPORT_API_PATH}?${query.toString()}`, { cache: 'no-store', signal, ...(scope ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd, data_root: dataRoot, run_id: runId, format, scope, case_keys: caseKeys, case_set_revision: caseSetRevision, review_revision: reviewRevision }) } : {}) })
      if (!response.ok) {
        let message = `HTTP ${response.status}`
        try { message = (await response.json()).error ?? message } catch { /* preserve HTTP status */ }
        throw new Error(message)
      }
      return {
        blob: await response.blob(),
        filename: response.headers?.get?.('content-disposition')?.match(/filename="?([^";]+)"?/)?.[1] ?? `pangea-${runId}-test-cases.${format}`,
      }
    }

    async function requestEnvironments(fetcher = fetch) {
      const response = await fetcher(ENVIRONMENT_API_PATH, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body.environments ?? []
    }

    async function saveEnvironment(environment, fetcher = fetch) {
      const response = await fetcher(ENVIRONMENT_API_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(environment),
      })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body.environment
    }

    async function testEnvironmentConnection(endpoint, fetcher = fetch) {
      const response = await fetcher(ENVIRONMENT_API_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'test', endpoint }),
      })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body.result
    }

    async function removeEnvironment(id, fetcher = fetch) {
      const response = await fetcher(`${ENVIRONMENT_API_PATH}?${new URLSearchParams({ id })}`, { method: 'DELETE' })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body.removed === true
    }

    async function launchExecution(input, fetcher = fetch) {
      const response = await fetcher(EXECUTION_API_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
      })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    async function requestWorkbench({ cwd, dataRoot, runId, taskId, sessionId, view, cursor = 0, limit = 20, signal, fetcher = fetch }) {
      const query = new URLSearchParams({ cwd, cursor: String(cursor), limit: String(limit) })
      if (view) query.set('view', view)
      if (dataRoot) query.set('data_root', dataRoot)
      if (runId !== undefined) query.set('run_id', runId ?? '')
      if (taskId) query.set('task_id', taskId)
      if (sessionId) query.set('session_id', sessionId)
      const response = await fetcher(`${WORKBENCH_API_PATH}?${query}`, { cache: 'no-store', signal })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    async function requestWorkbenchAction({ cwd, action, payload = {}, fetcher = fetch }) {
      const response = await fetcher(`${WORKBENCH_API_PATH}?${new URLSearchParams({ cwd })}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...payload }),
      })
      const body = await response.json()
      const accepted = body.status === 'ok' || (['stop', 'task-delete'].includes(action) && body.status === 'stopping')
      if (!response.ok || !accepted) throw Object.assign(new Error(body.error ?? `HTTP ${response.status}`), { statusCode: response.status, code: body.code })
      return body
    }

    async function requestAssetCatalog({ cwd, repositoryId = '', moduleTag = '', page = 1, query = '', type = '', signal, fetcher = fetch }) {
      const response = await fetcher(`${ASSET_CATALOG_API_PATH}?${new URLSearchParams({
        cwd, page: String(page), page_size: '20', status: 'available',
        ...(query ? { q: query } : {}), ...(type ? { type } : {}),
        ...(repositoryId ? { repository_id: repositoryId } : {}),
        ...(moduleTag ? { module_tag: moduleTag } : {}),
      })}`, { cache: 'no-store', signal })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    async function requestAssetDetail({ cwd, assetId, signal, fetcher = fetch }) {
      const response = await fetcher(`${ASSET_CATALOG_API_PATH}?${new URLSearchParams({ cwd, asset_id: assetId })}`, { cache: 'no-store', signal })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok' || body.asset?.asset_id !== assetId) throw new Error(body.error ?? `资产 ${assetId} 详情不可用`)
      return body.asset
    }

    async function requestRepositoryStatus({ cwd, fetcher = fetch }) {
      const response = await fetcher(`${REPOSITORY_API_PATH}?${new URLSearchParams({ cwd })}`, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    async function requestRepositoryImport({ cwd, sourcePath, repositoryName, fetcher = fetch }) {
      const response = await fetcher(`${REPOSITORY_API_PATH}?${new URLSearchParams({ cwd })}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source_path: sourcePath, repository_name: repositoryName }),
      })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    async function requestAcpSettings(fetcher = fetch) {
      const response = await fetcher(ACP_SETTINGS_API_PATH, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    async function saveAcpSettings(config, fetcher = fetch) {
      const response = await fetcher(ACP_SETTINGS_API_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'save', config }),
      })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    async function requestAgentModels({ providerId, cwd, signal, fetcher = fetch }) {
      const response = await fetcher(ACP_SETTINGS_API_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal,
        body: JSON.stringify({ action: 'models', provider_id: providerId, cwd }),
      })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    async function testAcpSettings(fetcher = fetch) {
      const response = await fetcher(ACP_SETTINGS_API_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'test' }),
      })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body.checks ?? []
    }

    const PHASE = {
      PREPARING: '等待 PANGEA 初始化', STEP_BOOTSTRAP: '初始化历史 Skill',
      STEP_01: 'Step 01 · 范围和任务契约', STEP_02: 'Step 02 · 输入与计划', STEP_03: 'Step 03 · 广度盘点',
      STEP_04: 'Step 04 · 深度讲解', STEP_05: 'Step 05 · 场景与风险', STEP_06: 'Step 06 · SFMEA 翻译',
      STEP_07: 'Step 07 · 测试设计', STEP_08: 'Step 08 · 独立 Judge', STEP_09: 'Step 09 · 正式交付',
      COMPLETE: '已完成', INCOMPLETE: '校验未通过', STOPPED: '已停止', FAILED: '已失败', UNKNOWN: '未知',
    }
    const QUALITY = { PASS: '通过', REWORK: '需要返工', UNRESOLVED: '未解决' }
    const REVIEW = { PASS: '通过', REWORK: '需要返工', UNRESOLVED: '未解决', UNREADABLE: '结果不可读' }
    const SEVERITY = { Critical: '严重', High: '高', Medium: '中', Low: '低' }
    const RISK_SEVERITY_LEVELS = ['Critical', 'High', 'Medium', 'Low']
    const displayEvidenceLocation = location => String(location ?? '').replace(/^[^:/\\]+:(?=[^:]+:\d)/, '')
    const riskSeverityLevel = risk => RISK_SEVERITY_LEVELS.find(level => level.toLowerCase() === String(risk?.severity ?? '').toLowerCase()) ?? 'Ungraded'
    function riskSeverityCounts(risks) {
      const counts = { Critical: 0, High: 0, Medium: 0, Low: 0, Ungraded: 0 }
      for (const risk of risks ?? []) counts[riskSeverityLevel(risk)] += 1
      return counts
    }
    function filterRisks(risks, severity, queryValue) {
      const query = String(queryValue ?? '').trim().toLowerCase()
      return (risks ?? []).filter(risk => {
        if (severity === 'Ungraded' && riskSeverityLevel(risk) !== 'Ungraded') return false
        if (!['全部', 'Ungraded'].includes(severity) && riskSeverityLevel(risk) !== severity) return false
        return !query || [
          risk.display_id, risk.risk_id, risk.title, risk.narrative, risk.trigger, risk.system_result,
          risk.residual_effect, risk.apparent_normality, risk.external_observation,
          risk.blackbox_proof, ...(risk.dfx ?? []),
        ].join(' ').toLowerCase().includes(query)
      })
    }
    const CONFIDENCE = { high: '高', medium: '中', low: '低' }
    const TRANSLATION = {
      'Blackbox-ready': '黑盒可执行', 'Graybox-ready': '灰盒可执行', 'Developer-confirm': '需开发确认',
      'Test-ready': '已有测试覆盖', Unreachable: '受支持入口不可达', Uncovered: '尚未覆盖',
    }
    const isUnreachableRisk = risk => risk?.translation_status === 'Unreachable'
    const isUncoveredRisk = risk => !isUnreachableRisk(risk) && (risk?.linked_test_case_ids?.length ?? 0) === 0
    const RISK_STATUS = {
      pending: '待确认', accepted: '已采纳', confirmed: '已确认', false_positive: '误报',
      claimed_fixed: '声称已修复', verified_fixed: '已验证修复',
    }
    const HEALTH = { ok: '正常', pending: '阶段生成中', warning: '需关注', error: '异常' }
    const SOURCE = { 'final-state': '最终聚合结果', 'worker-results': 'Worker 结果兼容读取' }
    const DISCUSSION_INTENTS = {
      review: '请结合证据和关联对象做独立判断：结论是否成立，还需要哪些信息。',
      evidence: '只基于下方“选中源码片段”核对“待核对结论”：分别说明这些源码能直接支持什么、组合后仍不能证明什么。不要调用工具，不要读取或使用其他文件、其他证据、PANGEA 其他字段或整个 Run 的信息。',
      executable: '请把当前结论改写成可执行的测试语言，包含前置、操作、观察点和预期结果。',
      'targeted-executable': '请只根据“待测试结论”和下方“选中源码片段”生成一个可执行测试，分别写出前置条件、操作步骤、观察点和预期结果。触发条件与外部观察只可提取和该结论直接相关的内容；忽略其余部分，不得增加可选扩展、其他风险后果或第二个测试。源码不能支持的预期必须标记为“待确认”，不要自行补充其他证据。',
      coverage: '请检查当前对象还缺少哪些测试覆盖，只列出有明确依据的缺口。',
    }

    const panelCss = `
      .pangea-companion { scrollbar-gutter: stable; }
      .pangea-companion * { box-sizing: border-box; }
      .pangea-companion button, .pangea-companion input, .pangea-companion select, .pangea-companion textarea { font-family: inherit; }
      .pangea-companion button { transition: box-shadow .15s, border-color .15s; }
      .pangea-companion button:not(:disabled):hover { box-shadow: inset 0 0 0 1px #c7000b55; }
      .pangea-companion button:disabled { opacity: .55; cursor: not-allowed; }
      .pangea-companion :is(button,input,select,textarea,summary,[tabindex]):focus-visible { outline: 3px solid #b72237 !important; outline-offset: 3px; }
      .pangea-companion summary { cursor: pointer; line-height: 1.7; }
      .pangea-companion .pangea-content { min-width: 0; }
      .pangea-companion.b03-task-screen { background: #f7f7f5; }
      .pangea-page-heading { margin: 0; }
      .pangea-page-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; flex-shrink: 0; }
      .b03-task-breadcrumb { display: flex; align-items: center; gap: 8px; margin-bottom: 17px; color: #70767d; font-size: 12px; line-height: normal; }
      .b03-task-breadcrumb span { color: #9aa0a6; }
      .b03-task-page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
      .b03-task-page-head.without-breadcrumb { margin-top: 33px; }
      .b03-task-page-head h1 { margin: 0; color: #25292e; font-size: 27px; font-weight: 650; line-height: 1.4; letter-spacing: -.5px; }
      .b03-task-page-head p { margin: 9px 0 0; color: #70767d; font-size: 12px; line-height: 1.8; }
      .b03-task-actions { display: flex; align-items: center; gap: 8px; margin-top: 15px; }
      .b03-task-action { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 36px; padding: 7px 13px; border: 1px solid #e5e7e4; border-radius: 6px; background: #fff; color: #25292e; font-size: 12px; white-space: nowrap; }
      .b03-task-action-primary { border-color: #25292e; background: #25292e; color: #fff; }
      .b03-task-metrics { display: flex; align-items: center; gap: 32px; margin: 0 0 25px; }
      .b03-task-stat { min-width: 110px; padding-left: 25px; border-left: 1px solid #e5e7e4; }
      .b03-task-stat:first-child { padding-left: 0; border-left: 0; }
      .b03-task-stat span { display: block; color: #70767d; font-size: 12px; }
      .b03-task-stat strong { display: block; font-size: 27px; line-height: 1.5; font-weight: 500; font-variant-numeric: tabular-nums; }
      .b03-task-panel { padding: 22px; border: 1px solid #e5e7e4; border-radius: 10px; background: #fff; }
      .b03-task-controls { display: grid; grid-template-columns: minmax(0, 1fr); gap: 11px; margin-bottom: 19px; }
      .b03-task-search { width: 100%; min-height: 40px; margin: 0; padding: 9px 12px; border: 1px solid #dce0dd; border-radius: 6px; background: #fff; color: #25292e; font-size:14px; }
      .b03-task-control-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .b03-task-filters { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .b03-task-filter { box-sizing: border-box; height: 29px; flex: 0 0 auto; padding: 6px 11px; border: 1px solid #e5e7e4; border-radius: 5px; background: #fff; color: #25292e; font-size: 12px; }
      .b03-task-filter[aria-pressed="true"] { border-color: #25292e; background: #25292e; color: #fff; }
      .b03-task-sort { margin-left: auto; color: #496988; font-size: 12px; white-space: nowrap; }
      .b03-task-table-wrap { overflow-x: auto; }
      .b03-task-table { width: 100%; border-collapse: collapse; text-align: left; font-size:14px; }
      .b03-task-table th { height: 50px; padding: 0 13px; border-bottom: 1px solid #e5e7e4; background: #f3f4f2; color: #70767d; font-size: 12px; font-weight: 500; line-height: 1.8; white-space: nowrap; }
      .b03-task-table td { padding: 14px 13px; border-bottom: 1px solid #e5e7e4; color: #25292e; line-height: 1.8; vertical-align: top; }
      .b03-task-table tbody tr:last-child td { border-bottom: 0; }
      .pangea-task-row-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-width: 92px; }
      .pangea-task-row-actions button { white-space: nowrap; }
      .pangea-task-action-overlay { position: fixed; inset: 0; z-index: 120; padding: 24px; display: flex; align-items: center; justify-content: center; background: rgba(24, 28, 32, .35); }
      .pangea-task-action-dialog { box-sizing: border-box; width: min(480px, 100%); max-height: calc(100vh - 48px); overflow: auto; padding: 24px; background: #fff; border: 1px solid #e5e7e4; border-radius: 12px; box-shadow: 0 12px 40px rgba(20, 25, 30, .16); font-size: 14px; line-height: 1.7; }
      .pangea-task-action-dialog h2 { margin: 0 0 16px; font-size: 20px; }
      .pangea-task-action-footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; }
      .b03-task-first-cell { display: flex; align-items: center; gap: 12px; min-width: 220px; }
      .b03-task-first-cell .b03-task-subtitle { margin-top: 0; line-height: 1.8; }
      .b03-task-icon { display: grid; width: 37px; height: 37px; flex: 0 0 37px; place-items: center; border: 1px solid #e5e7e4; border-radius: 8px; background: #fff; color: #70767d; }
      .b03-task-title, .b03-task-run, .b03-task-open { display: inline-flex; align-items: center; gap: 5px; min-width: 0; padding: 0; border: 0; color: #496988; background: transparent; text-align: left; font: inherit; cursor: pointer; }
      .b03-task-title { color: #496988; font-size: 12px; font-weight: 400; }
      .b03-task-subtitle { margin-top: 4px; color: #70767d; font-size: 12px; line-height: 1.6; }
      .b03-task-run { white-space: nowrap; font-size: 12px; }
      .b03-task-run-cell { display: flex; align-items: center; gap: 10px; white-space: nowrap; }
      .b03-task-open { color: #25292e; font-size: 12px; white-space: nowrap; }
      .b03-task-open svg, .b03-task-run svg { width: 14px; height: 14px; }
      .b03-task-title { line-height: 1.7; }
      .b03-task-status { display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 4px; background: #f3f4f2; color: #70767d; font-size:12px; line-height: 1.5; white-space: nowrap; }
      .b03-task-status.good { background: #eaf5ee; color: #20765a; }
      .b03-task-status.blue { background: #edf3f8; color: #496988; }
      .b03-task-status.warn { background: #fbf4e6; color: #926316; }
      .b03-task-meta { color: #70767d; font-size: 12px; font-variant-numeric: tabular-nums; }
      .b03-task-footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding-top: 18px; color: #70767d; font-size: 12px; }
      .b03-unlinked-runs { margin-top: 20px; padding-top: 17px; border-top: 1px solid #e5e7e4; }
      .b03-unlinked-runs > summary { color: #70767d; font-size: 12px; line-height: normal; cursor: pointer; }
      .b03-unlinked-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 14px 0; border-bottom: 1px solid #e5e7e4; }
      .b03-task-panel.first-use { display: flex; min-height: 531px; flex-direction: column; justify-content: space-between; padding: 22px; }
      .b03-task-first-use-content { display: flex; flex-direction: column; align-items: center; padding: 67px 0 20px; text-align: center; }
      .b03-task-empty-icon { display: grid; width: 52px; height: 52px; place-items: center; margin-bottom: 22px; border: 1px solid #e5e7e4; border-radius: 13px; color: #70767d; }
      .b03-task-empty-icon svg { width: 22px; height: 22px; }
      .b03-task-first-use-content h2, .b03-task-filter-empty-content h2 { margin: 0; color: #25292e; font-size: 20px; font-weight: 600; line-height: 1.5; }
      .b03-task-first-use-content p, .b03-task-filter-empty-content p { max-width: 500px; margin: 10px 0 24px; color: #496988; font-size:14px; line-height: 1.8; }
      .b03-task-first-use-steps { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 20px; padding: 18px 82px 24px; border-top: 1px solid #e5e7e4; }
      .b03-task-first-use-steps span { display: block; margin-bottom: 7px; color: #496988; font-size:12px; }
      .b03-task-first-use-steps strong { display: block; margin-bottom: 7px; font-size: 14px; font-weight: 600; }
      .b03-task-first-use-steps p { margin: 0; color: #496988; font-size: 12px; line-height: 1.8; }
      .b03-task-panel.filtered-empty { min-height: 472px; padding: 22px; }
      .b03-task-filter-empty-content { display: flex; flex-direction: column; align-items: center; margin-top: 83px; text-align: center; }
      .b03-task-filter-empty-content p { max-width: 650px; margin-bottom: 24px; }
      .b03-task-filter-empty-content button { min-height: 36px; padding: 7px 13px; border: 1px solid #e5e7e4; border-radius: 6px; background: #fff; color: #25292e; font-size: 12px; }
      .b03-task-filter-chip { display: inline-flex; align-items: center; gap: 5px; height: 29px; padding: 6px 11px; border: 1px solid #e5e7e4; border-radius: 5px; background: #fff; color: #25292e; font-size: 12px; }
      .b03-task-filter-chip[aria-pressed="true"] { border-color: #25292e; background: #25292e; color: #fff; }
      .b03-task-filter-empty-icon { display: grid; width: 52px; height: 52px; place-items: center; margin-bottom: 22px; border: 1px solid #e5e7e4; border-radius: 13px; color: #70767d; }
      .b03-task-filter-empty-icon svg { width: 22px; height: 22px; }
      .pangea-companion:has(.b03-run-record-screen) > div:has(> .pangea-panel-header) { display: none !important; }
      .pangea-companion:has(.b03-run-record-screen) > .pangea-content { padding: 25px 31px 27px !important; max-width: none !important; margin: 0 !important; }
      .b03-run-record-screen { min-height: 100%; background: #f7f7f5; color: #25292e; font-family:var(--pangea-font,"Segoe UI","Microsoft YaHei UI",sans-serif); font-synthesis: none; text-rendering: auto; -webkit-font-smoothing: auto; }
      .b03-run-record-layout { display: grid; gap: 18px; min-width: 0; }
      .b03-run-record-breadcrumb { display: flex; align-items: center; gap: 8px; margin-bottom: 17px; color: #70767d; font-size: 12px; line-height: normal; }
      .b03-run-record-breadcrumb button { padding: 0; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; }
      .b03-run-record-breadcrumb [aria-current="page"] { color: #4f5964; }
      .b03-run-record-page-head { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
      .b03-run-record-page-head h1 { margin: 0; color: #25292e; font-size: 27px; font-weight: 650; line-height: 1.4; letter-spacing: -.5px; }
      .b03-run-record-page-head p { margin: 9px 0 0; color: #70767d; font-size: 12px; line-height: 1.8; }
      .b03-run-record-action { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 36px; padding: 7px 13px; border: 1px solid #e5e7e4; border-radius: 6px; background: #fff; color: #25292e; font-size: 12px; white-space: nowrap; }
      .b03-run-record-action svg { width: 15px; height: 15px; }
      .b03-run-record-notice { display: flex; align-items: flex-start; gap: 10px; padding: 15px 17px; border-radius: 7px; background: #edf3f8; color: #496988; }
      .b03-run-record-notice > svg { width: 17px; height: 17px; flex: 0 0 auto; margin-top: 1px; }
      .b03-run-record-notice strong { font-size:14px; line-height: 1.7; }
      .b03-run-record-notice p { margin: 4px 0 0; font-size: 12px; line-height: 1.8; }
      .b03-run-record-card { min-width: 0; padding: 22px; border: 1px solid #e5e7e4; border-radius: 10px; background: #fff; }
      .b03-run-record-card h2 { margin: 0 0 17px; color: #25292e; font-size: 15px; font-weight: 600; line-height: normal; }
      .b03-run-record-metrics { display: flex; align-items: center; gap: 32px; }
      .b03-run-record-metric { min-width: 110px; padding-left: 25px; border-left: 1px solid #e5e7e4; }
      .b03-run-record-metric:first-child { padding-left: 0; border-left: 0; }
      .b03-run-record-metric span { display: block; color: #70767d; font-size: 12px; line-height: normal; }
      .b03-run-record-metric strong { color: #25292e; font-size: 27px; font-weight: 500; line-height: 1.5; letter-spacing: -.7px; font-variant-numeric: tabular-nums; }
      .b03-run-record-divider { margin: 18px 0; border-top: 1px solid #e5e7e4; }
      .b03-run-record-summary { line-height: 1.9; }
      .b03-run-record-summary-title { margin: 0 0 10px; color: #25292e; font-size: 15px; font-weight: 600; line-height: inherit; }
      .b03-run-record-summary p { margin: 0 0 15px; color: #25292e; font-size:14px; line-height: 1.8; }
      .b03-run-record-summary .b03-run-record-summary-meta { color: #70767d; }
      .b03-run-record-inputs { display: grid; grid-template-columns: 105px minmax(0,1fr); gap: 14px 17px; margin: 0; font-size:14px; line-height: 1.8; }
      .b03-run-record-inputs dt { color: #70767d; }
      .b03-run-record-inputs dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
      .b03-run-record-inputs .mono { font-family: Consolas, monospace; font-size: 12px; }
      .b03-run-record-status { color: #20765a; }
      .b03-overview-screen { color: #25292e !important; background: #f7f7f5 !important; font-family:var(--pangea-font,"Segoe UI","Microsoft YaHei UI",sans-serif); font-synthesis: none; text-rendering: auto; -webkit-font-smoothing: auto !important; }
      .b03-overview-screen button { font-family: inherit; }
      .b03-overview-hero { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding: 6px 0 23px; border-bottom: 1px solid #e5e7e4; margin: 25px 0 26px; }
      .b03-overview-breadcrumb { display: flex; align-items: center; gap: 8px; margin: 0 0 17px; color: #70767d; font-size: 12px; line-height: 18px; }
      .b03-overview-breadcrumb button { min-width: 0; max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; }
      .b03-overview-breadcrumb > span:not([aria-hidden]):not([aria-current]) { min-width: 0; max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .b03-overview-breadcrumb [aria-current="page"] { color: #4f5964; }
      .b03-overview-page-hero { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 0 0 22px; }
      .b03-overview-page-hero > div:first-child { min-width: 0; }
      .b03-overview-page-hero h1 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
      .b03-overview-run-meta { max-width: 650px; margin-top: 9px; color: #70767d; font-size: 12px; line-height: 1.8; }
      .b03-overview-page-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
      .b03-overview-nav { display: flex !important; align-items: stretch; gap: 28px !important; margin: 0 !important; overflow-x: auto; border-bottom: 1px solid #e5e7e4; }
      .b03-overview-nav button { flex: 0 0 auto; padding: 9px 0 13px !important; color: #70767d !important; font-size:14px !important; }
      .b03-overview-nav button[aria-current="page"] { color: #25292e !important; border-bottom-color: #b62836 !important; font-weight: 600 !important; }
      .b03-overview-hero h2 { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 23px; font-weight: 600; line-height: 1.5; }
      .b03-overview-status { display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 4px; font-size:12px; font-weight: 500; line-height: 1.6; white-space: nowrap; }
      .b03-overview-status-complete { background: #e9f7ef; color: #26754e; }
      .b03-overview-status-running { background: #edf4fc; color: #35699b; }
      .b03-overview-status-attention, .b03-overview-status-partial { background: #fff3df; color: #9a5b00; }
      .b03-overview-status-stopped { background: #f0f2f3; color: #667085; }
      .b03-overview-hero p { margin: 6px 0 0; color: #70767d; font-size:14px; line-height: 1.8; }
      .b03-overview-hero-action { display: inline-flex; align-items: center; flex: 0 0 auto; min-height: 36px; padding: 0 15px; border: 1px solid #25292e; border-radius: 5px; background: #25292e; color: #fff; font: inherit; font-size: 12px; cursor: pointer; }
      .b03-overview-attention { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 18px; margin: -1px 0 23px; border-radius: 8px; background: #fbf4e5; color: #8c5700; }
      .b03-overview-attention strong { display: block; font-size:14px; font-weight: 600; }
      .b03-overview-attention p { margin: 5px 0 0; color: #94620f; font-size: 12px; line-height: 1.7; }
      .b03-overview-attention button { min-height: 36px; flex: 0 0 auto; padding: 0 13px; border: 1px solid #e5e7e4; border-radius: 6px; background: #fff; color: #8c5700; font: inherit; font-size: 12px; cursor: pointer; }
      .b03-overview-layout { display: grid; grid-template-columns: minmax(0,1fr) 310px; gap: 24px; align-items: start; }
      .b03-overview-main, .b03-overview-aside { display: grid; gap: 18px; min-width: 0; }
      .b03-overview-card { min-width: 0; padding: 22px; border: 1px solid #e5e7e4; border-radius: 10px; background: #fff; }
      .b03-overview-card h3 { margin: 0 0 17px; font-size: 15px; font-weight: 600; }
      .b03-overview-card-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 17px; }
      .b03-overview-card-heading h3 { margin: 0; }
      .b03-overview-verdict { flex: 0 0 auto; padding: 3px 7px; border-radius: 4px; font-size:12px; line-height: 1.5; }
      .b03-overview-verdict-pass { background: #e9f7ef; color: #26754e; }
      .b03-overview-verdict-unresolved { background: #fff3df; color: #9a5b00; }
      .b03-overview-summary { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 22px; }
      .b03-overview-summary > div { min-width: 0; padding-left: 25px; border-left: 1px solid #e5e7e4; }
      .b03-overview-summary > div:first-child { padding-left: 0; border-left: 0; }
      .b03-overview-summary span { display: block; color: #70767d; font-size: 12px; }
      .b03-overview-summary strong { display: block; font-size: 27px; line-height: 1.5; font-weight: 500; font-variant-numeric: tabular-nums; }
      .b03-overview-summary small { display: block; color: #70767d; font-size:12px; }
      .b03-overview-copy { padding-top: 17px; margin-top: 28px; border-top: 1px solid #e5e7e4; font-size:14px; line-height: 1.8; }
      .b03-overview-summary + .b03-overview-copy { margin-top: 26px; padding-bottom: 20px; }
      .b03-overview-copy p { margin: 0 0 14px; }
      .b03-overview-copy p:last-child { margin-bottom: 0; }
      .b03-overview-findings { width: 100%; border-collapse: collapse; text-align: left; font-size:14px; }
      .b03-overview-findings th { padding: 14px 13px; color: #70767d; background: #f3f4f2; font-size: 12px; font-weight: 500; line-height: 1.8; }
      .b03-overview-findings td { padding: 14px 13px; border-bottom: 1px solid #e5e7e4; vertical-align: top; line-height: 1.8; }
      .b03-overview-findings td:nth-child(2) { max-width: 400px; }
      .b03-overview-findings td:nth-child(2) .b03-task-run { margin: 0 4px 0 0; white-space: normal; }
      .b03-overview-findings tbody tr:last-child td { border-bottom: 0; }
      .b03-overview-validation { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 4px; font-size:12px; line-height: 1.7; white-space: nowrap; }
      .b03-overview-validation-todo, .b03-overview-validation-unresolved { background: #fff3df; color: #9a5b00; }
      .b03-overview-validation-running { background: #edf4fc; color: #35699b; }
      .b03-overview-validation-done { background: #e9f7ef; color: #26754e; }
      .b03-overview-validation-waiting { background: #f0f2f3; color: #667085; }
      .b03-overview-topic { display: block; padding: 0; border: 0; background: transparent; color: #25292e; font-size:14px; font-weight: 600; line-height: 1.8; text-align: left; cursor: pointer; }
      .b03-overview-findings-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 0; margin-top: 16px; border-top: 0; color: #70767d; font-size: 12px; }
      .b03-overview-main > .b03-overview-card:nth-child(2) { padding-bottom: 22px; }
      .b03-overview-kv { display: grid; grid-template-columns: 105px minmax(0, 1fr); gap: 14px 17px; margin: 0; font-size:14px; line-height: 1.8; }
      .b03-overview-kv dt { color: #70767d; }
      .b03-overview-kv dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
      .b03-overview-aside-divider { margin: 18px 0; border-top: 1px solid #e5e7e4; }
      .b03-overview-card-heading + .b03-overview-kv + .b03-overview-aside-divider { margin-top: 18px; }
      .b03-overview-aside-note { margin: 0; padding-top: 0; color: #70767d; font-size: 12px; line-height: 1.8; }
      .b03-overview-file small { display: block; color: #70767d; font-size:12px; }
      .b03-report-breadcrumb, .b03-report-page-head, .b03-report-tabs, .b03-report-document, .b03-report-nav, .b03-report-traceability { font-family:var(--pangea-font,"Segoe UI","Microsoft YaHei UI",sans-serif); font-synthesis: none; text-rendering: auto; -webkit-font-smoothing: auto; }
      .b03-report-breadcrumb { display: flex; align-items: center; gap: 8px; margin-bottom: 17px; color: #70767d; font-size: 12px; line-height: 16px; }
      .b03-report-breadcrumb button { padding: 0; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; }
      .b03-report-breadcrumb [aria-current="page"] { color: #4f5964; }
      .b03-report-page-head { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 22px; flex-wrap: wrap; }
      .b03-report-page-head h1 { margin: 0; color: #25292e; font-size: 27px; font-weight: 650; line-height: 1.4; letter-spacing: -.5px; }
      .b03-report-page-head p { min-height: 22.59375px; margin: 9px 0 0; color: #70767d; font-size: 12px; line-height: 1.8; }
      .b03-report-page-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
      .b03-report-page-action { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 36px; padding: 7px 13px; border: 1px solid #e5e7e4; border-radius: 6px; background: #fff; color: #25292e; font-size: 12px; white-space: nowrap; }
      .b03-report-page-action.primary { border-color: #25292e; background: #25292e; color: #fff; }
      .b03-report-page-action svg { width: 15px; height: 15px; }
      .b03-report-tabs { display: flex; gap: 28px; margin: 7px 0 25px; border-bottom: 1px solid #e5e7e4; flex-wrap: wrap; }
      .b03-report-tabs button { display: inline-flex; align-items: center; border: 0; border-bottom: 2px solid transparent; padding: 9px 0 13px; background: transparent; color: #70767d; font-size:14px; white-space: nowrap; }
      .b03-report-tabs button[aria-current="page"] { color: #25292e; border-bottom-color: #b62836; font-weight: 600; }
      .b03-report-tabs small { margin-left: 5px; color: #70767d; font-size:12px; }
      .b03-report-layout { position: relative; left: 50%; display: grid; width: min(1362px, calc(100vw - 238px)); max-width: none; margin: 0; transform: translateX(-50%); grid-template-columns: minmax(0,1fr) 310px; gap: 24px; align-items: start; }
      .b03-report-document { padding: 22px; border: 1px solid #e5e7e4; border-radius: 10px; background: #fff; line-height: 1.9; }
      .b03-report-document { color: #25292e; }
      .b03-report-nav { color: #25292e; }
      .b03-report-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; margin-bottom: 20px; }
      .b03-report-document .b03-report-head .pangea-eyebrow { margin-bottom: 10px; }
      .b03-report-document .b03-report-head h2 { margin: 0; font-size: 22px; font-weight: 600; }
      .b03-report-document .b03-report-head p { margin: 8px 0 15px; color: #70767d; font-size: 12px; line-height: 1.8; }
      .b03-report-status { flex-shrink: 0; padding: 3px 8px; border-radius: 4px; background: #eaf5ee; color: #20765a; font-size:12px; line-height: 1.5; }
      .b03-report-status.partial { background: #fbf4e6; color: #926316; }
      .b03-report-partial-notice { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin: 0; padding: 15px 17px; border-radius: 7px; background: #fbf4e6; color: #926316; }
      .b03-report-notice-main { display: flex; gap: 10px; }
      .b03-report-partial-notice svg { width: 17px; height: 17px; flex-shrink: 0; }
      .b03-report-partial-notice strong { font-size:14px; line-height: 1.7; }
      .b03-report-document .b03-report-partial-notice p { margin: 4px 0 15px; font-size:14px; line-height: 1.8; }
      .b03-report-stats { margin: 25px 0; }
      .b03-report-stats strong { letter-spacing: -.7px; }
      .b03-report-divider { margin: 18px 0; border-top: 1px solid #e5e7e4; }
      .b03-report-findings { margin: 10px 0 18px; padding-left: 22px; font-size:14px; }
      .b03-report-findings li { margin-bottom: 0; }
      .b03-report-risk-link { display: inline-flex; margin-left: 8px; padding: 0; border: 0; background: transparent; color: #496988; font-size: 12px; cursor: pointer; }
      .b03-report-document h2 { margin: 0 0 8px; font-size: 23px; }
      .b03-report-document h3 { margin: 23px 0 10px; font-size: 15px; font-weight: 600; }
      .b03-report-document p { margin: 0 0 15px; font-size:14px; line-height: 1.8; }
      .b03-report-nav { display: grid; gap: 18px; }
      .b03-report-nav > .b03-overview-card h3 { line-height: 1.333333; }
      .b03-report-nav button { justify-content: flex-start; width: 100%; text-align: left; }
      .b03-report-nav .b03-report-outline-link { min-height: 0; padding: 14px 0; border: 0; border-bottom: 1px solid #e5e7e4; border-radius: 0; background: transparent; color: #25292e; font-size: 14px; line-height: normal; }
      .b03-report-nav .b03-report-outline-link:last-child { border-bottom: 0; }
      .b03-report-file { display: flex; align-items: center; gap: 10px; }
      .b03-report-file > svg { width: 22px; height: 22px; color: #70767d; }
      .b03-report-nav .b03-report-file { padding: 15px 0; }
      .b03-report-file > div { min-width: 0; }
      .b03-report-nav .b03-report-file > div { flex: 1 1 auto; }
      .b03-report-nav .b03-report-file .b03-task-open { flex: 0 0 auto; width: auto; margin-left: auto; }
      .b03-report-file .b03-task-subtitle { line-height: 1.5; white-space: nowrap; }
      .b03-report-file-icon { display: inline-flex; flex: 0 0 auto; }
      .b03-report-file-icon svg { width: 18px; height: 18px; }
      .b03-report-traceability { display: flex; align-items: flex-start; gap: 10px; padding: 16px 17px; border-radius: 7px; background: #edf3f8; color: #496988; font-size: 12px; line-height: 1.7; }
      .b03-report-traceability > svg { width: 16px; height: 16px; flex: 0 0 auto; margin-top: 2px; }
      .b03-report-traceability h3 { margin: 0; font-size:14px; font-weight: 600; }
      .b03-report-traceability p { margin: 4px 0 0; font-size: 12px; }
      .pangea-empty-state { padding: 36px 24px; text-align: center; }
      .pangea-empty-state p { color: #68707c; line-height: 1.7; margin: 8px 0 18px; }
      .pangea-task-row:hover, .pangea-home-row:hover { background: #fff7f7 !important; }
      .pangea-task-row > span, .pangea-home-row > span { min-width: 0; overflow-wrap: anywhere; }
      .pangea-reader { line-height: 1.85; overflow-wrap: anywhere; font-size: 14px; }
      .pangea-reader :is(h2,h3,h4,h5,h6) { color: inherit; line-height: 1.5; margin: 24px 0 10px; font-size: 16px; }
      .pangea-reader h2 { font-size: 20px; padding-bottom: 10px; border-bottom: 1px solid #e4e7eb; }
      .pangea-reader > :first-child { margin-top: 0; }
      .pangea-reader dd { margin-bottom: 16px; }
      .pangea-reader pre { padding: 14px 16px; background: #f3f5f8; border: 1px solid #e1e5ea; border-radius: 8px; line-height: 1.65; font-size:14px; }
      .pangea-reader-table { margin: 16px 0; border: 1px solid #dfe3e8; border-radius: 8px; }
      .pangea-reader-table table { min-width: 360px; }
      .pangea-reader-table th { background: #f3f5f8; font-weight: 650; }
      .pangea-reader-table :is(th,td) { padding: 12px 14px !important; border-bottom: 1px solid #e4e7eb !important; }
      .pangea-reader-table tbody tr:nth-child(even) { background: #fafbfc; }
      .pangea-flow-modes { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; background: #f0f2f5; border: 1px solid #e3e6eb; border-radius: 10px; }
      .pangea-flow-modes button { border: 0 !important; background: transparent !important; padding: 9px 13px !important; color: #667085 !important; box-shadow: none !important; }
      .pangea-flow-modes button[aria-pressed="true"] { background: white !important; color: #ad0b1b !important; box-shadow: 0 1px 4px #172b4d14 !important; font-weight: 650; }
      .pangea-diagram-header { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 18px 20px; }
      .pangea-diagram-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 12px 18px; border-top: 1px solid #edf0f3; border-bottom: 1px solid #edf0f3; background: #fbfcfd; }
      .pangea-diagram-status { display: inline-flex; align-items: center; flex-shrink: 0; gap: 6px; padding: 5px 10px; border-radius: 20px; background: #edf0f4; color: #667085; font-size: 12px; }
      .pangea-diagram-status::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
      .pangea-diagram-status.ready { color: #18764c; background: #eaf6ef; }
      .pangea-diagram-status.generating { color: #906400; background: #fff6da; }
      .pangea-diagram-status.failed, .pangea-diagram-status.interrupted { color: #b42318; background: #fff0ed; }
      .pangea-diagram-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; min-height: 260px; padding: 28px; background: #fafbfc; }
      .pangea-diagram-empty strong { font-size: 18px; }
      .pangea-diagram-empty p { color: #667085; line-height: 1.7; max-width: 520px; }
      .pangea-diagram-caption { padding: 10px 18px; font-size: 12px; line-height: 1.6; color: #667085; border-top: 1px solid #edf0f3; }
      .pangea-diagram-footer { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 14px 18px; border-top: 1px solid #edf0f3; }
      .pangea-diagram-compose { padding: 16px 18px; border-top: 1px solid #edf0f3; }
      .pangea-diagram-compose > summary { font-size: 14px; font-weight: 600; cursor: pointer; }
      .pangea-diagram-dialog { width: calc(100vw - 48px); max-width: none; height: calc(100vh - 48px); max-height: none; padding: 0; border: 1px solid #dfe3ea; border-radius: 14px; color: #17191d; background: white; box-shadow: 0 20px 70px #10182840; }
      .pangea-diagram-dialog::backdrop { background: #18223088; }
      .b04-flow-empty { display: grid; grid-template-columns: 244px minmax(0,1fr); gap: 22px; align-items: start; }
      .b04-flow-nav, .b04-flow-card, .b04-flow-side, .b04-version-side, .b04-version-form { background: #fff; border: 1px solid #e1e6df; border-radius: 9px; }
      .b04-flow-nav { padding: 18px; min-height: 650px; box-sizing: border-box; }
      .b04-flow-nav-label, .b04-overline { color: #919a91; font-size:12px; letter-spacing: .09em; }
      .b04-flow-screen .b04-page-hero { margin: 0 0 0; padding: 0 0 19px; border-bottom: 0; }
      .b04-flow-screen .b04-page-hero h1 { margin: 0; color: #25292e; font-size: 27px; font-weight: 650; line-height: 1.4; }
      .b04-flow-screen .b03-overview-nav { margin-bottom: 25px !important; }
      .b04-flow-nav-label { margin: 3px 0 13px; }
      .b04-flow-tabs { display: flex; gap: 6px; overflow-x: auto; padding: 4px 2px 10px; margin-bottom: 16px; border-bottom: 1px solid #e1e6df; }
      .b04-flow-tab { flex: 0 0 auto; max-width: 320px; padding: 12px 16px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: #59625d; cursor: pointer; text-align: left; }
      .b04-flow-tab strong { display: block; font-size: 14px; white-space: normal; overflow-wrap: anywhere; }
      .b04-flow-tab small { display: block; margin-top: 5px; font-size:12px; }
      .b04-flow-tab[aria-selected="true"] { border-color: #e9c7cb; background: #faf0f0; color: #922532; }
      .b04-flow-tab:focus-visible, .b04-flow-panel:focus-visible { outline: 2px solid #922532; outline-offset: 2px; }
      .b04-flow-panel { min-width: 0; min-height: 320px; max-height: calc(100vh - 340px); overflow: auto; scrollbar-gutter: stable; }
      .b04-flow-nav-foot { border-top: 1px solid #e7e9e5; padding-top: 17px; margin-top: 17px; font-size:12px; line-height: 1.75; color: #919792; }
      .b04-modebar { display: flex; justify-content: space-between; align-items: center; gap: 14px; margin-bottom: 18px; }
      .b04-modebar > div:first-child { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .b04-modebar strong { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .b04-flow-card { padding: 25px 28px; }
      .b04-flow-card h2 { font-size: 21px; letter-spacing: -.3px; margin: 6px 0 10px; line-height: 1.4; }
      .b04-flow-description { color: #717972; font-size:14px; line-height: 1.85; margin: 0 0 18px; max-width: 720px; }
      .b04-flow-badges { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .b04-flow-badges > span { border: 1px solid #e2e6df; border-radius: 20px; padding: 4px 9px; color: #73806f; font-size:12px; }
      .b04-flow-sequence { border-top: 1px solid #e8ece6; margin-top: 20px; padding-top: 23px; }
      .b04-flow-step { display: grid; grid-template-columns: 34px minmax(0,1fr) minmax(82px,112px); gap: 13px; position: relative; padding-bottom: 23px; }
      .b04-flow-step[aria-current="step"] { border-radius: 8px; background: #f8f3ed; }
      .b04-flow-step { grid-template-columns: minmax(0,1fr) minmax(82px,112px); border-bottom: 1px solid #e8ece6; margin-bottom: 16px; }
      .b04-flow-step-num { display: grid; place-items: center; width: 31px; height: 31px; border: 1px solid #dfe5df; border-radius: 50%; background: #f8faf6; color: #66705f; font: 11px Consolas,monospace; z-index: 1; }
      .b04-flow-step strong { font-size:14px; line-height: 31px; }
      .b04-flow-step p { margin: 1px 0 5px; color: #828981; font-size: 12px; line-height: 1.75; }
      .b04-flow-ref { color: #8d948e; font: 10px Consolas,monospace; text-align: right; padding-top: 9px; overflow-wrap: anywhere; }
      .b04-flow-ref .b04-link { color: inherit; font: inherit; }
      .b04-branch-choice { display: flex; align-items: center; gap: 14px; width: 100%; text-align: left; border: 1px solid #e4e7e2; border-radius: 8px; background: #fff; padding: 13px 16px; margin-top: 8px; cursor: pointer; }
      .b04-branch-choice > span:first-child { color: #a28288; font: 11px Consolas,monospace; min-width: 40px; }
      .b04-branch-choice strong { display: block; font-size: 12px; line-height: 1.5; }
      .b04-branch-choice small { display: block; color: #8b918b; margin-top: 4px; }
      .b04-branch-detail { display: grid; grid-template-columns: minmax(0,1fr) 304px; gap: 22px; align-items: start; }
      .b04-flow-definition { display: grid; grid-template-columns: 90px minmax(0,1fr); gap: 16px 20px; font-size:14px; line-height: 1.9; margin: 22px 0; }
      .b04-flow-definition dt { color: #90968e; }.b04-flow-definition dd { margin: 0; overflow-wrap: anywhere; }
      .b04-flow-side { padding: 18px; margin-bottom: 14px; }.b04-flow-side h3 { font-size:14px; margin: 0 0 12px; }.b04-flow-side p { font-size: 12px; color: #838d82; line-height: 1.8; }
      .b04-code-line[data-target="true"] { background: #faeaea; color: #a1323b; }
      .b04-link { border: 0; background: transparent; padding: 0; color: #a52d39; font-size: 12px; cursor: pointer; text-align: left; }
      .b04-diagram-types { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 17px; }
      .b04-diagram-types button { border: 1px solid #e0e5dd; border-radius: 6px; background: #fff; padding: 8px 13px; color: #717a70; font-size: 12px; cursor: pointer; }
      .b04-diagram-types button[aria-pressed="true"] { border-color: #25292e; background: #25292e; color: #fff; }
      .b04-canvas-wrap { border: 1px solid #e1e6df; border-radius: 10px; background: #fcfdfb; overflow: hidden; }
      .b04-canvas-head, .b04-canvas-foot { display: flex; justify-content: space-between; align-items: center; gap: 14px; background: #fff; }
      .b04-canvas-head { padding: 16px 20px; border-bottom: 1px solid #e7eae4; }.b04-canvas-foot { padding: 12px 20px; border-top: 1px solid #e8ece4; color: #969d92; font-size:12px; }
      .b04-canvas-head strong { font-size: 14px; }.b04-canvas-head small { display: block; color: #91988f; margin-top: 5px; font-size:12px; }
      .b04-canvas-actions, .b04-canvas-controls { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
      .b04-empty-actions { justify-content: center; flex-wrap: nowrap; }.b04-empty-actions button { width: auto; min-width: 126px; }.b04-empty-actions button:first-child { background: #27372d; border-color: #27372d; color: #fff; }
      .b04-canvas-actions button, .b04-canvas-controls button, .b04-version-form button, .b04-progress-actions button { border: 1px solid #dfe5dc; border-radius: 6px; background: #fff; padding: 8px 12px; color: #566051; font-size: 12px; cursor: pointer; }
      .b04-canvas-grid { display: grid; grid-template-columns: minmax(0,1fr) 238px; }.b04-canvas { min-width: 0; min-height: 467px; overflow: auto; background-color: #fbfcfa; background-image: radial-gradient(#dce2d8 .65px,transparent .65px); background-size: 20px 20px; }
      .b04-canvas-grid.wide { display: block; }.b04-canvas-grid.wide .b04-canvas { min-height: 467px; }
      .b04-canvas iframe { display: block; width: 100%; min-height: 467px; border: 0; background: transparent; pointer-events: none; }
      .b04-canvas-aside { border-left: 1px solid #e7ebe3; background: #fff; padding: 22px 19px; }.b04-canvas-aside h3 { font-size: 12px; margin: 0 0 16px; }.b04-canvas-aside p { color: #8c9685; font-size:12px; line-height: 1.8; }
      .b04-canvas-aside section { border-top: 1px solid #ecefe8; padding: 15px 0; font-size: 12px; }.b04-canvas-aside section:first-of-type { border: 0; padding-top: 0; }
      .b04-version-grid { display: grid; grid-template-columns: 290px minmax(0,1fr); gap: 22px; }.b04-version-side, .b04-version-form { padding: 24px; }.b04-version-item { display: block; width: 100%; text-align: left; border: 1px solid #e1e5de; border-radius: 8px; padding: 17px; margin: 12px 0; background: #fff; cursor: pointer; }.b04-version-item[aria-current="true"] { border-color: #d6a7ad; background: #fdf6f6; }
      .b04-version-form textarea { display: block; width: 100%; min-height: 113px; margin: 8px 0 20px; box-sizing: border-box; padding: 13px; border: 1px solid #dce2da; border-radius: 6px; line-height: 1.8; resize: vertical; }
      .b04-progress-shell { display: grid; grid-template-columns: minmax(0,1fr) 310px; min-height: 426px; }.b04-progress-art { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 45px; text-align: center; background: #fbfcf9; }.b04-progress-art h2 { font-size: 20px; margin: 23px 0 10px; }.b04-progress-art p { color: #858d80; font-size: 12px; line-height: 1.9; max-width: 390px; }.b04-progress-log { border-left: 1px solid #e7ebe3; background: #fff; padding: 29px 25px; }.b04-progress-log h3 { font-size:14px; margin: 0 0 24px; }
      .b04-progress-icon { display: grid; place-items: center; width: 64px; height: 64px; border-radius: 18px; background: #edf3e8; color: #7b9367; font-size: 28px; }.b04-progress-bar { width: 260px; max-width: 100%; height: 4px; margin: 25px 0 13px; border-radius: 4px; background: #e6ebdf; overflow: hidden; }.b04-progress-bar::before { content: ''; display: block; width: 34%; height: 100%; background: #a4b592; animation: b04-progress 1.5s ease-in-out infinite alternate; }@keyframes b04-progress { from { transform: translateX(-100%); } to { transform: translateX(300%); } }
      .b04-progress-row { display: grid; grid-template-columns: 17px minmax(0,1fr); gap: 10px; margin-bottom: 22px; color: #687464; font-size:12px; }.b04-progress-row strong { font-size: 12px; }.b04-progress-row p { margin: 5px 0 0; color: #93998f; line-height: 1.6; }
      .b04-flow-empty .b04-flow-nav i { display: block; width: 72%; height: 9px; border-radius: 5px; background: #edf0e9; margin: 22px 12px; }.b04-empty-content { display: flex; align-items: center; justify-content: center; flex-direction: column; min-height: 520px; text-align: center; }.b04-empty-content h2 { font-size: 20px; margin: 22px 0 10px; }.b04-empty-content p { color: #8a9284; font-size:14px; line-height: 1.9; max-width: 440px; }
      .b05-result-screen .b03-overview-page-hero { margin-bottom: 0; }.b05-result-screen .b03-overview-nav { margin-bottom: 27px !important; }
      .b05-section-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 20px; }.b05-section-head h2 { font-size: 18px; margin: 0 0 5px; }.b05-section-head p { color: #747970; font-size:14px; margin: 0; line-height: 1.7; }
      .b05-metrics { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); background: #fff; border: 1px solid #e5e7e4; border-radius: 9px; padding: 20px 23px; margin-bottom: 20px; }.b05-metric { border-right: 1px solid #e5e7e4; padding: 0 16px; }.b05-metric:first-child { padding-left: 0; }.b05-metric:last-child { border: 0; }.b05-metric small { display: block; color: #758085; font-size: 12px; }.b05-metric strong { display: block; font-size: 24px; font-weight: 500; margin: 4px 0; }.b05-metric span { font-size:12px; color: #858d8e; }
      .b05-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 20px 0 15px; }.b05-toolbar input { border: 1px solid #dfe4df; border-radius: 5px; padding: 10px 12px; width: 215px; font: inherit; font-size: 12px; background: #fff; }.b05-filters { display: flex; gap: 7px; }.b05-filters button { background: #fff; border: 1px solid #e0e4df; border-radius: 5px; padding: 6px 11px; font-size: 12px; cursor: pointer; }.b05-filters button[aria-pressed="true"] { background: #25292e; color: #fff; border-color: #25292e; }
      .b05-group-label { display: flex; justify-content: space-between; color: #798285; font-size: 12px; margin: 20px 0 10px; }.b05-risk-row { display: grid; grid-template-columns: minmax(0,1fr) 142px 160px 20px; gap: 18px; align-items: center; width: 100%; text-align: left; border: 1px solid #e5e7e4; border-radius: 9px; background: #fff; padding: 21px 24px; margin: 11px 0; cursor: pointer; }.b05-risk-row:hover { border-color: #b62836; }.b05-risk-row h3 { font-size: 16px; margin: 0 0 9px; }.b05-risk-row p { font-size:14px; line-height: 1.65; color: #747c80; margin: 0 0 10px; }.b05-risk-row small { display: block; color: #778186; font-size: 12px; line-height: 1.7; }.b05-risk-row .b05-risk-meta { display: flex; align-items: center; gap: 8px; font-size:12px; color: #7a8285; }.b05-risk-row .b05-risk-meta span { padding: 3px 7px; border-radius: 4px; background: #f8f4e9; color: #a6732b; }.b05-risk-row .b05-risk-meta span:first-child { background: #fbeded; color: #b62836; }
      .b05-detail-title { font-size: 21px; margin: 9px 0; }.b05-detail-grid { display: grid; grid-template-columns: 1fr 1fr 1.12fr; gap: 18px; margin-top: 20px; }.b05-card { background: #fff; border: 1px solid #e5e7e4; border-radius: 9px; padding: 20px; min-width: 0; }.b05-card h3 { font-size: 15px; margin: 0 0 15px; }.b05-card p { font-size:14px; line-height: 1.8; }.b05-card h4 { font-size: 12px; margin: 18px 0 6px; }.b05-step-label { font-size:12px; font-weight: 650; letter-spacing: .8px; color: #969d9e; margin-bottom: 13px; }.b05-detail-bottom { display: grid; grid-template-columns: 1fr 1fr; gap: 17px; margin-top: 18px; }
      .b05-case-table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e5e7e4; }.b05-case-table th { color: #828987; background: #fafbf8; font-size: 12px; font-weight: 500; text-align: left; padding: 12px 14px; }.b05-case-table td { border-top: 1px solid #eff0ed; padding: 12px 14px; font-size: 12px; line-height: 1.7; vertical-align: middle; }.b05-case-table a,.b05-case-table button { color: #466484; }.b05-case-table input { accent-color: #b62836; }
      .b05-head-actions { display: flex; align-items: center; gap: 9px; }.b05-head-actions button,.b05-selected-bar button { border: 1px solid #dfe4df; background: #fff; border-radius: 6px; padding: 9px 13px; font-size: 12px; color: #4b5d67; cursor: pointer; }.b05-head-actions button.primary,.b05-export-modal button.primary { background: #27372d; border-color: #27372d; color: #fff; }.b05-table-scroll { overflow-x: auto; border-radius: 8px; }.b05-case-table { min-width: 850px; }.b05-case-table td:nth-child(3) { min-width: 240px; }.b05-case-table td small { display: block; max-width: 350px; color: #929a98; margin-top: 4px; }.b05-text-link { border: 0; background: none; padding: 0; text-align: left; cursor: pointer; font: inherit; }.b05-mono { font-family: Consolas,monospace; color: #6b7580; }.b05-risk-chip,.b05-readiness { display: inline-block; padding: 4px 8px; border-radius: 4px; background: #f1f3f4; color: #6d777d; white-space: nowrap; }.b05-readiness.good { background: #edf5eb; color: #64855f; }.b05-readiness.warn { background: #fff5e6; color: #ad7a27; }.b05-selected-bar { display: flex; justify-content: space-between; align-items: center; gap: 14px; padding: 14px 18px; background: #f4f5f2; border: 1px solid #e7ebe5; border-radius: 7px; margin-top: 17px; font-size: 12px; }.b05-selected-bar small { display: block; color: #949d99; margin-top: 4px; }.b05-subtle { color: #929a99; font-size:12px; }
      .b05-modal-backdrop { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; background: #17201866; backdrop-filter: blur(2px); }.b05-export-modal { width: min(490px, 88vw); max-height: 88vh; overflow: auto; box-sizing: border-box; background: #fff; border-radius: 9px; box-shadow: 0 18px 60px #17201830; padding: 24px; }.b05-export-modal header,.b05-export-modal footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; }.b05-export-modal header small { font-size:12px; color: #8a9490; }.b05-export-modal header h2 { font-size: 20px; margin: 6px 0 0; }.b05-export-modal header button { width: 30px; height: 30px; border: 1px solid #e0e5df; border-radius: 5px; background: #fff; cursor: pointer; }.b05-export-modal p { color: #7d8583; font-size: 12px; line-height: 1.7; }.b05-export-modal h3 { font-size: 12px; margin: 23px 0 11px; }.b05-export-scope { background: #f5f7f4; padding: 16px; border-radius: 6px; font-size: 12px; }.b05-export-scope span { float: right; color: #63825d; }.b05-export-scope p { margin: 8px 0; }.b05-export-scope small { color: #8f9894; }.b05-export-choice { display: grid; grid-template-columns: 18px 46px minmax(0,1fr) auto; gap: 12px; align-items: center; border: 1px solid #e3e7e2; border-radius: 7px; padding: 13px; margin: 8px 0; cursor: pointer; }.b05-export-choice.selected { border-color: #9eb6a1; background: #fbfdfb; }.b05-export-choice strong { font-size: 12px; }.b05-export-choice small { display: block; color: #929b96; font-size:12px; margin-top: 4px; }.b05-export-choice em { font-size:12px; color: #5c8b5d; font-style: normal; }.b05-file-icon { font: bold 10px Consolas,monospace; color: #508460; }.b05-export-modal footer { border-top: 1px solid #e6eae5; margin-top: 20px; padding-top: 18px; justify-content: flex-end; }.b05-export-modal footer button { border: 1px solid #dfe5de; border-radius: 5px; padding: 9px 15px; background: #fff; cursor: pointer; }.b05-export-error { color: #b62836 !important; }
      .b05-case-layout { display: grid; grid-template-columns: minmax(0,1.75fr) minmax(275px,1fr); gap: 18px; align-items: start; }.b05-case-layout main,.b05-case-layout aside { display: grid; gap: 17px; min-width: 0; }.b05-case-layout .b05-card h3 { margin-bottom: 17px; }.b05-detail-label { color: #9a7770; font: 12px Consolas,monospace; }.b05-bullet { display: grid; grid-template-columns: 16px minmax(0,1fr); gap: 9px; align-items: start; margin: 12px 0; font-size: 12px; color: #6d7772; line-height: 1.7; }.b05-case-notice { padding: 15px 18px; border: 1px solid #f0dfba; background: #fff8e9; border-radius: 7px; color: #a37121; font-size: 12px; }.b05-case-notice p { margin: 5px 0 0; line-height: 1.7; }.b05-step-table { min-width: 520px; }.b05-step-table td:first-child { width: 50px; }.b05-step-table td:nth-child(2) { width: 46%; }.b05-case-kv { display: grid; grid-template-columns: 80px minmax(0,1fr); gap: 15px 7px; margin: 0; font-size: 12px; }.b05-case-kv dt { color: #929b98; }.b05-case-kv dd { margin: 0; line-height: 1.7; }.b05-case-kv button { display: block; margin-bottom: 4px; }.b05-raw-record { margin-top: 18px; font-size: 12px; color: #7c8881; }.b05-raw-record summary { cursor: pointer; }
      .b05-coverage-notice { border: 1px solid #dce8f1; background: #f3f8fb; border-radius: 7px; padding: 14px 18px; color: #53758b; font-size: 12px; line-height: 1.7; margin-bottom: 20px; }.b05-coverage-notice p { margin: 4px 0 0; }.b05-coverage-grid { display: grid; grid-template-columns: minmax(0,1.5fr) minmax(275px,1fr); gap: 18px; }.b05-gap-row { display: grid; grid-template-columns: 78px minmax(0,1.2fr) minmax(0,1fr) 78px; align-items: center; gap: 12px; padding: 16px 0; border-bottom: 1px solid #e9ede7; font-size:12px; }.b05-gap-row strong { display: block; font-size: 12px; }.b05-gap-row small { display: block; color: #9ba49e; margin-top: 5px; overflow-wrap: anywhere; }.b05-gap-row button { display: block; margin: 4px 0; }.b05-coverage-source { padding: 16px; border: 1px solid #e7ebe5; border-radius: 5px; margin-bottom: 17px; font-size: 12px; overflow-wrap: anywhere; }
      @container pangea-panel (max-width: 900px) { .b05-coverage-grid { grid-template-columns: minmax(0,1fr); }.b05-gap-row { grid-template-columns: 65px minmax(0,1fr) minmax(0,1fr) 70px; } }
      @container pangea-panel (max-width: 900px) { .b05-case-layout { grid-template-columns: minmax(0,1fr); }.b05-section-head { flex-wrap: wrap; } }
      .b05-source-layer { position: fixed; inset: 0; z-index: 70; display: flex; justify-content: flex-end; background: rgba(19,24,25,.2); }.b05-source-drawer { box-sizing: border-box; width: min(650px, 82vw); height: 100%; overflow: auto; background: #fff; padding: 28px; box-shadow: -12px 0 30px rgba(0,0,0,.12); }.b05-source-drawer header { display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 1px solid #e5e7e4; padding-bottom: 22px; }.b05-source-drawer header button { width: 32px; height: 32px; padding: 0; }.b05-source-drawer header small { color: #b62836; letter-spacing: .8px; font-size:12px; }.b05-source-drawer h2 { font-size: 20px; margin: 8px 0 2px; }.b05-source-meta { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid #e5e7e4; padding: 18px 0; font-size: 12px; overflow-wrap: anywhere; }.b05-source-context { background: #f5f6f4; border-radius: 6px; padding: 15px; margin: 20px 0; font-size: 12px; line-height: 1.7; }.b05-source-code { background: #f7f8f6; border: 1px solid #e4e8e2; border-radius: 6px; overflow: auto; padding: 12px 0; font: 11px/2.05 Consolas,monospace; }.b05-source-code-line { display: grid; grid-template-columns: 44px minmax(max-content,1fr); white-space: pre; }.b05-source-code-line[data-target="true"] { background: #fcebec; color: #a52b35; }.b05-source-code-line span { text-align: right; padding: 0 10px; color: #929aa0; }.b05-source-code-line code { padding: 0 10px; }.b05-source-failure { background: #fff7e8; color: #9b651a; border-radius: 6px; padding: 18px; margin: 20px 0; }.b05-source-drawer footer { display: flex; justify-content: space-between; border-top: 1px solid #e5e7e4; margin-top: 20px; padding-top: 20px; }.b05-source-drawer button { border: 1px solid #e0e4df; background: #fff; border-radius: 6px; padding: 8px 11px; cursor: pointer; }
      @container pangea-panel (max-width: 760px) { .b05-detail-grid,.b05-detail-bottom { grid-template-columns: 1fr; }.b05-risk-row { grid-template-columns: minmax(0,1fr) 110px 110px 14px; gap: 10px; }.b05-metrics { grid-template-columns: repeat(2,minmax(0,1fr)); row-gap: 16px; }.b05-metric:nth-child(2) { border: 0; } }
      .b04-source-overlay { position: fixed; inset: 0; z-index: 110; background: #17201866; }.b04-source-drawer { position: absolute; top: 0; right: 0; bottom: 0; width: min(650px, 88vw); background: #fff; box-shadow: -16px 0 50px #18201424; display: flex; flex-direction: column; }.b04-source-drawer header, .b04-source-drawer footer { padding: 20px 24px; border-bottom: 1px solid #e6ebe3; }.b04-source-drawer footer { margin-top: auto; border-top: 1px solid #e6ebe3; border-bottom: 0; }.b04-source-drawer main { padding: 22px 24px; overflow: auto; }.b04-source-drawer .b04-code { overflow: auto; border: 1px solid #e2e7e0; border-radius: 8px; background: #fafcf8; font: 12px/1.7 Consolas,monospace; }.b04-source-drawer .b04-code-line { display: grid; grid-template-columns: 48px minmax(max-content,1fr); white-space: pre; }.b04-source-drawer .b04-code-line span:first-child { color: #9da69b; text-align: right; padding-right: 12px; border-right: 1px solid #e2e7e0; }.b04-source-drawer .b04-code-line code { padding: 0 12px; }.b04-source-drawer .b04-code-line[data-target="true"] { background: #f4e9e9; }
      .pangea-diagram-dialog.b04-fullscreen[open] { display: flex; flex-direction: column; }.b04-fullscreen .b04-canvas { flex: 1; min-height: 0; }.b04-fullscreen .b04-canvas iframe { height: 100%; min-height: 0; }
      @container pangea-panel (max-width: 1060px) { .b04-branch-detail { grid-template-columns: minmax(0,1fr) 250px; }.b04-canvas-grid { grid-template-columns: minmax(0,1fr) 210px; } }
      @container pangea-panel (max-width: 760px) { .b04-flow-empty, .b04-branch-detail, .b04-version-grid, .b04-progress-shell { grid-template-columns: minmax(0,1fr); }.b04-flow-nav { min-height: 0; }.b04-canvas-grid { grid-template-columns: minmax(0,1fr); }.b04-canvas-aside { border-left: 0; border-top: 1px solid #e7ebe3; } }
      @container pangea-panel (max-width: 950px) {
        .pangea-metrics { grid-template-columns: repeat(2,minmax(0,1fr)) !important; }
        .pangea-home-columns { grid-template-columns: minmax(0,1fr) !important; min-height: 0 !important; }
        .pangea-page-hero { flex-wrap: wrap; gap: 16px !important; }
        .pangea-create-form .pangea-input-grid { grid-template-columns: minmax(0,1fr) !important; }
      }
      @container pangea-panel (max-width: 700px) {
        .pangea-content { padding: 20px 16px 32px !important; }
        .pangea-table-heading { display: none !important; }
        .b03-task-page-head { align-items: flex-start; flex-wrap: wrap; }
        .b03-report-page-head { align-items: flex-start; }
        .b03-report-page-actions { flex-wrap: wrap; }
        .b03-task-panel { padding: 16px; }
        .b03-task-controls { align-items: stretch; }
        .b03-task-control-row { flex-wrap: wrap; }
        .b03-task-search { width: 100%; }
        .b03-task-filters { max-width: 100%; overflow-x: auto; }
        .b03-task-sort { margin-left: 0; }
        .b03-task-table { min-width: 850px; }
        .b03-overview-layout, .b03-report-layout { grid-template-columns: minmax(0,1fr); }
        .b03-report-layout { position: static; left: auto; width: auto; margin: 0; transform: none; }
        .b03-overview-summary { grid-template-columns: 1fr; gap: 14px; }
        .b03-overview-summary > div { padding: 12px 0 0; border-left: 0; border-top: 1px solid #e5e7e4; }
        .b03-overview-summary > div:first-child { padding-top: 0; border-top: 0; }
        .b03-task-metrics { gap: 16px; flex-wrap: wrap; }
        .b03-task-stat { min-width: 85px; padding-left: 15px; }
        .b03-overview-hero, .b03-overview-page-hero { align-items: flex-start; flex-wrap: wrap; }
        .b03-overview-page-actions { flex-wrap: wrap; }
        .b03-overview-findings { min-width: 640px; }
        .b03-overview-card { overflow-x: auto; }
        .b03-report-document { padding: 20px; }
        .pangea-task-row, .pangea-home-row { grid-template-columns: minmax(0,1fr) auto !important; gap: 10px !important; padding: 16px !important; }
        .pangea-task-row > :first-child, .pangea-home-row > :first-child { grid-column: 1 / -1; white-space: normal !important; }
        .pangea-task-row > :nth-child(4) { grid-column: 1 / -1; }
        .pangea-home-row > :nth-child(3) { grid-column: 1 / -1; }
        .pangea-home-row > :last-child { display: none; }
        .pangea-panel-header { flex-wrap: wrap; }
        .pangea-page-heading { font-size: 26px !important; }
      }
      @container pangea-panel (max-width: 380px) {
        .pangea-metrics { grid-template-columns: minmax(0,1fr) !important; }
        .b03-task-metrics { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); }
        .b03-task-stat { padding: 0; border: 0; }
      }
        @container pangea-panel (max-width: 1150px) {
          .b03-task-table col:nth-child(2) { width: 12.8% !important; }
        }
      @media (prefers-reduced-motion: reduce) { .pangea-companion button { transition: none; } }
      .b06-home-screen { background:#f7f7f5 !important; color:#25292e !important; font-family:var(--pangea-font,"Segoe UI","Microsoft YaHei UI",sans-serif); font-synthesis:none; -webkit-font-smoothing:auto; }
      .b06-home-screen .pangea-content { box-sizing:border-box; }
      .b06-breadcrumb { display:flex; align-items:center; gap:11px; color:#7c878a; font-size:12px; margin-bottom:20px; }
      .b06-home-head { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; margin-bottom:25px; }
      .b06-home-head h1 { font-size:27px; line-height:1.25; margin:0 0 11px; color:#17202b; }
      .b06-home-head p { font-size:12px; color:#78838d; margin:0; }
      .b06-head-actions,.b06-section-head,.b06-row,.b06-between { display:flex; align-items:center; gap:10px; }.b06-head-actions { margin-top:16px; }.b06-between,.b06-section-head { justify-content:space-between; }
      .b06-button { display:inline-flex; align-items:center; justify-content:center; gap:7px; min-height:36px; padding:7px 13px; border:1px solid #dfe4e1; border-radius:5px; background:#fff; color:#29353e; font-size:12px; cursor:pointer; white-space:nowrap; }.b06-button.primary { background:#25292e; border-color:#25292e; color:#fff; }.b06-button:disabled { background:#9b9d9e; border-color:#9b9d9e; color:#fff; cursor:default; }
      .b06-banner { display:flex; align-items:center; justify-content:space-between; gap:18px; padding:16px 20px; border-radius:7px; margin-bottom:0; background:#fff5e5; color:#a56c19; font-size:12px; }.b06-banner strong { display:block; font-size:14px; margin-bottom:6px; }.b06-banner.success { background:#eaf5ec; color:#28764b; }
      .b06-metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:17px; margin-bottom:25px; }.b06-metric { display:flex; align-items:center; gap:17px; min-height:100px; box-sizing:border-box; padding:19px 22px; background:#fff; border:1px solid #dfe4e1; border-radius:9px; }.b06-icon { display:grid; place-items:center; width:42px; height:42px; flex:0 0 42px; border-radius:7px; background:#f1f3f2; color:#697882; }.b06-metric:first-child .b06-icon { color:#497ba4; }.b06-metric:nth-child(2) .b06-icon { color:#b57a23; }.b06-metric:nth-child(3) .b06-icon { color:#288b68; }.b06-metric small { display:block; color:#798590; font-size:12px; }.b06-metric strong { display:block; color:#17202b; font-size:29px; font-weight:500; line-height:1.45; }
      .b06-home-grid { display:grid; grid-template-columns:minmax(0,1.65fr) minmax(300px,1fr); gap:24px; }.b06-stack { display:flex; flex-direction:column; gap:18px; min-width:0; }.b06-panel { box-sizing:border-box; padding:22px; background:#fff; border:1px solid #dfe4e1; border-radius:9px; min-width:0; }.b06-section-head { margin-bottom:17px; }.b06-section-head h2 { font-size:15px; margin:0; }.b06-section-head small { color:#7a868f; font-size:12px; }.b06-link { border:0; background:transparent; color:#416890; font-size:12px; cursor:pointer; padding:0; }
      .b06-attention { border-left:3px solid #b72638; border-radius:0 8px 8px 0; background:#fffaf8; padding:19px 21px; }.b06-attention h3 { margin:8px 0; font-size:17px; }.b06-attention p { margin:0; color:#7d8892; font-size:12px; line-height:1.7; }.b06-attention-foot { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:17px; }.b06-meta { color:#7d8892; font-size:12px; }.b06-badge { display:inline-flex; align-items:center; border-radius:3px; padding:4px 7px; color:#a66a16; background:#fff0d7; font-size:12px; }.b06-badge.blue { color:#416b95; background:#edf3f8; }.b06-badge.green { color:#27784e; background:#e8f5ec; }
      .b06-running { display:grid; grid-template-columns:37px minmax(0,1fr) auto; align-items:center; gap:13px; min-height:73px; }.b06-running strong,.b06-report strong { display:block; font-size:14px; }.b06-running p { color:#7d8892; font-size:12px; margin:5px 0 0; }.b06-shortcuts { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:15px; }.b06-shortcut { display:flex; align-items:flex-start; gap:15px; text-align:left; cursor:pointer; }.b06-shortcut strong { display:block; font-size:14px; margin:3px 0 7px; }.b06-shortcut p { color:#7d8892; font-size:12px; margin:0; line-height:1.6; }
      .b06-report { width:100%; display:grid; grid-template-columns:37px minmax(0,1fr) 14px; align-items:center; gap:12px; background:transparent; border:0; border-bottom:1px solid #e3e6e3; text-align:left; padding:20px 0; cursor:pointer; }.b06-report:last-child { border-bottom:0; }.b06-report .b06-meta { display:block; margin-top:5px; }.b06-repo { display:flex; align-items:center; justify-content:space-between; gap:15px; background:#f2f4f2; padding:14px 17px; border-radius:7px; font-size:12px; }.b06-repo-note { color:#7d8892; font-size:12px; line-height:1.8; margin:14px 0; }.b06-divider { border-top:1px solid #e2e5e2; margin:17px 0; }.b06-muted { color:#7d8892; font-size:14px; line-height:1.9; padding:18px 8px; }.b06-skeleton { display:block; height:14px; border-radius:5px; background:#eef0ee; animation:b06-pulse 1.4s ease-in-out infinite alternate; }@keyframes b06-pulse { to { opacity:.5; } }
      .b06-onboard-head { margin-bottom:25px; }.b06-onboard-grid { width:min(1080px,100%); display:grid; grid-template-columns:minmax(0,1.55fr) minmax(280px,1fr); gap:25px; margin:0 auto; }.b06-onboard-grid .b06-panel { padding:30px; }.b06-onboard-grid h2 { font-size:23px; margin:12px 0; }.b06-onboard-lead { color:#7d8892; font-size:14px; line-height:1.9; margin:0 0 24px; }.b06-eyebrow { font-size:12px; letter-spacing:1.3px; color:#b72638; }.b06-field { display:block; margin-top:20px; font-size:12px; font-weight:600; }.b06-field input { box-sizing:border-box; width:100%; height:42px; border:1px solid #dbe0dd; border-radius:5px; padding:10px 13px; font:inherit; font-weight:400; margin-top:8px; background:#fff; }.b06-field-row { display:flex; gap:12px; }.b06-field-row input { flex:1; min-width:0; }.b06-hint { color:#7d8892; font-size:12px; line-height:1.7; margin:10px 0 0; }.b06-onboard-step { display:flex; gap:13px; padding:18px 0; border-bottom:1px solid #e3e6e3; }.b06-onboard-step b { display:grid; place-items:center; width:25px; height:25px; flex:none; border-radius:50%; background:#f2f4f2; color:#78848c; font:12px Consolas; }.b06-onboard-step.done b { background:#e8f5ec; color:#278452; }.b06-onboard-step.current b { background:#fbecee; color:#bc2b3d; }.b06-onboard-step strong { font-size:12px; }.b06-onboard-step p { color:#7d8892; font-size:12px; margin:5px 0 0; }.b06-onboard-foot { display:flex; justify-content:space-between; align-items:center; gap:15px; border-top:1px solid #e3e6e3; margin-top:24px; padding-top:20px; }.b06-copy-progress { height:5px; border-radius:5px; background:#eef0ee; overflow:hidden; margin:20px 0; }.b06-copy-progress::before { display:block; content:""; width:34%; height:100%; background:#4b6b8c; animation:b06-progress 1.7s ease-in-out infinite alternate; }@keyframes b06-progress { from { transform:translateX(-100%); } to { transform:translateX(300%); } }
      @container pangea-panel (max-width:900px) { .b06-home-grid,.b06-onboard-grid { grid-template-columns:1fr; }.b06-metrics { grid-template-columns:repeat(2,minmax(0,1fr)); } }.b06-home-screen .pangea-page-heading { font-size:27px !important; }
    `

    const styles = {
      root: { height: '100%', overflow: 'auto', containerType: 'inline-size', containerName: 'pangea-panel', boxSizing: 'border-box', color: '#17191d', background: '#f5f6f8', fontFamily: 'var(--pangea-font, "Segoe UI", "Microsoft YaHei UI", sans-serif)', fontSize: 14, WebkitFontSmoothing: 'antialiased' },
      sticky: { position: 'sticky', top: 0, zIndex: 5, padding: '17px 22px 0', background: 'var(--dsw-alias-bg-layer-1, #fff)', borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(31,35,41,.14))' },
      header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
      headerLeft: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 },
      title: { fontSize: 20, fontWeight: 600, letterSpacing: '-0.012em', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      subline: { marginTop: 5, color: 'var(--dsw-alias-label-tertiary, #7a818b)', fontSize: 12, lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      backButton: { border: 0, background: 'transparent', color: 'var(--dsw-alias-label-secondary, inherit)', padding: '4px 2px', cursor: 'pointer', fontSize: 14, whiteSpace: 'nowrap' },
      button: { border: '1px solid var(--dsw-alias-border-l2, #555)', background: 'var(--dsw-alias-bg-layer-2, transparent)', color: 'inherit', borderRadius: 6, padding: '7px 10px', cursor: 'pointer', fontSize: 14 },
      primaryButton: { width: '100%', border: '1px solid var(--pangea-red, #c7000b)', background: 'var(--pangea-red, #c7000b)', color: '#fff', borderRadius: 8, padding: '10px 16px', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
      buttonDisabled: { cursor: 'default', opacity: 0.55 },
      nav: { display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(72px, 1fr)', gap: 0, marginTop: 12, overflowX: 'auto' },
      navButton: { border: 0, borderBottom: '2px solid transparent', background: 'transparent', color: 'var(--dsw-alias-label-tertiary, inherit)', padding: '11px 4px 10px', cursor: 'pointer', fontSize: 14 },
      navActive: { color: 'var(--dsw-alias-label-primary, inherit)', fontWeight: 700, borderBottomColor: 'var(--dsw-alias-state-business-primary, #4d9ad6)' },
      content: { padding: '24px 28px 40px', maxWidth: 1320, margin: '0 auto' },
      homeContent: { padding: '32px 36px 42px', maxWidth: 1440, margin: '0 auto', background: '#f5f6f8' },
      card: { border: '1px solid var(--dsw-alias-border-l2, #dfe3e8)', background: 'var(--dsw-alias-bg-layer-1, #fff)', borderRadius: 10, padding: 18, marginBottom: 14 },
      healthOk: { borderColor: 'var(--dsw-alias-state-success-secondary, #4fb8a8)', background: 'var(--dsw-alias-state-success-tertiary, var(--dsw-alias-bg-layer-1, transparent))' },
      healthError: { borderColor: 'var(--dsw-alias-state-error-secondary, #e66767)', background: 'var(--dsw-alias-interactive-bg-hover-danger, var(--dsw-alias-bg-layer-1, transparent))' },
      healthWarning: { borderColor: 'var(--dsw-alias-state-warn-secondary, #c9974f)', background: 'var(--dsw-alias-state-warn-tertiary, var(--dsw-alias-bg-layer-1, transparent))' },
      clickableCard: { width: '100%', textAlign: 'left', color: 'inherit', cursor: 'pointer' },
      label: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 12, fontWeight: 500, letterSpacing: '0.02em' },
      value: { fontSize: 14, fontWeight: 500, lineHeight: 1.5, marginTop: 4, overflowWrap: 'anywhere' },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7, marginTop: 8 },
      metric: { border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.14))', borderRadius: 7, padding: 9, background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08))', color: 'inherit' },
      metricClickable: { cursor: 'pointer', width: '100%', textAlign: 'left' },
      metricNumber: { fontSize: 17, fontWeight: 740, lineHeight: 1.1 },
      metricName: { color: 'var(--dsw-alias-label-secondary, inherit)', fontSize: 12, marginTop: 3 },
      progressTrack: { height: 5, borderRadius: 999, overflow: 'hidden', background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.16))', marginTop: 7 },
      progressFill: { height: '100%', background: 'var(--dsw-alias-state-business-primary, #4d9ad6)' },
      sectionTitle: { fontSize: 16, fontWeight: 600, letterSpacing: '-0.005em', margin: '20px 0 9px' },
      itemTitle: { fontSize: 14, fontWeight: 600, lineHeight: 1.5 },
      itemMeta: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 12, marginTop: 5, lineHeight: 1.6 },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 7 },
      badge: { display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '3px 8px', color: 'var(--dsw-alias-label-secondary, inherit)', fontSize: 12, background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.15))', whiteSpace: 'nowrap' },
      statusRow: { display: 'flex', alignItems: 'center', gap: 6 },
      statusDot: { width: 6, height: 6, flex: '0 0 auto', borderRadius: '50%', background: 'var(--dsw-alias-state-business-primary, #4d9ad6)' },
      chips: { display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 },
      chip: { border: '1px solid var(--dsw-alias-border-l2, #555)', borderRadius: 999, padding: '5px 9px', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 },
      search: { width: '100%', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2, #cfd5dc)', background: 'var(--dsw-alias-bg-layer-1, #fff)', color: 'inherit', borderRadius: 8, padding: '10px 12px', fontSize: 14, marginBottom: 8 },
      filters: { display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 5, marginBottom: 3 },
      filter: { flex: '0 0 auto', border: '1px solid var(--dsw-alias-border-l2, #555)', borderRadius: 999, background: 'transparent', color: 'inherit', padding: '5px 10px', fontSize: 14, cursor: 'pointer' },
      filterActive: { background: '#fff0f1', color: '#aa0010', borderColor: '#e7a4aa', fontWeight: 700 },
      text: { fontSize: 14, lineHeight: 1.65, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
      list: { margin: '6px 0 0', paddingLeft: 20, fontSize: 14, lineHeight: 1.65 },
      separator: { border: 0, borderTop: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16))', margin: '10px 0' },
      empty: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 14, lineHeight: 1.6 },
      error: { whiteSpace: 'pre-wrap', fontSize: 14, color: 'var(--dsw-alias-state-error-primary, #e66767)' },
      runButton: { width: '100%', textAlign: 'left', border: 0, borderRadius: 7, padding: '7px 8px', marginBottom: 3, cursor: 'pointer', color: 'inherit', background: 'transparent' },
      runActive: { background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1))' },
      toolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 7, flexWrap: 'wrap' },
      formGrid: { display: 'grid', gap: 8, marginTop: 9 },
      textarea: { width: '100%', minHeight: 74, resize: 'vertical', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2, #555)', background: 'var(--dsw-alias-bg-layer-2, transparent)', color: 'inherit', borderRadius: 7, padding: '8px 9px', outline: 'none', fontSize: 14, lineHeight: 1.5 },
      compatibility: { borderLeft: '3px solid var(--dsw-alias-state-business-primary, #4d9ad6)' },
      stageRail: { display: 'grid', gap: 7, marginTop: 8 },
      stageItem: { display: 'grid', gridTemplateColumns: '9px minmax(0, 1fr) auto', gap: 8, alignItems: 'start', borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.13))', paddingBottom: 8 },
      stageDot: { width: 7, height: 7, marginTop: 5, borderRadius: 2, background: 'var(--dsw-alias-state-business-primary, #4d9ad6)' },
      flowStep: { borderLeft: '2px solid var(--dsw-alias-border-l2, #555)', paddingLeft: 9, marginTop: 7 },
      actionCard: { borderColor: 'var(--dsw-alias-state-business-secondary, var(--dsw-alias-border-l2, #555))', background: 'var(--dsw-alias-state-business-tertiary, var(--dsw-alias-bg-layer-1, transparent))' },
      success: { color: 'var(--dsw-alias-state-success-primary, #38a892)', fontSize: 12, lineHeight: 1.5 },
      source: { maxHeight: 200, margin: '9px 0 0', border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16))', borderRadius: 7, overflow: 'auto', background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08))', fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)', fontSize: 12, lineHeight: 1.55 },
      sourceLine: { display: 'flex', minWidth: 'max-content', whiteSpace: 'pre' },
      sourceTarget: { background: 'var(--dsw-alias-state-business-tertiary, rgba(77,154,214,.12))' },
      sourceNumber: { width: 42, flex: '0 0 42px', boxSizing: 'border-box', paddingRight: 9, textAlign: 'right', userSelect: 'none', color: 'var(--dsw-alias-label-tertiary, #888)', borderRight: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.12))' },
      sourceCode: { padding: '0 9px', color: 'var(--dsw-alias-label-primary, inherit)' },
      evidenceTabs: { display: 'flex', gap: 5, overflowX: 'auto', marginTop: 8, paddingBottom: 3 },
      evidenceTab: { flex: '0 0 auto', maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: '1px solid var(--dsw-alias-border-l2, #555)', borderRadius: 6, padding: '5px 8px', background: 'transparent', color: 'var(--dsw-alias-label-secondary, inherit)', cursor: 'pointer', fontSize: 12 },
      evidenceTabActive: { borderColor: 'var(--dsw-alias-state-business-primary, #4d9ad6)', background: 'var(--dsw-alias-state-business-tertiary, rgba(77,154,214,.12))', color: 'var(--dsw-alias-label-primary, inherit)', fontWeight: 700 },
      choiceGrid: { display: 'grid', gap: 6, marginTop: 7 },
      choiceButton: { width: '100%', textAlign: 'left', border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16))', borderRadius: 7, padding: '8px 9px', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12, lineHeight: 1.45 },
      choiceButtonActive: { borderColor: 'var(--dsw-alias-state-business-primary, #4d9ad6)', background: 'var(--dsw-alias-state-business-tertiary, rgba(77,154,214,.12))' },
      evidenceChecks: { display: 'grid', gap: 5, marginTop: 7 },
      formGrid: { display: 'grid', gap: 7, marginTop: 8 },
      textarea: { width: '100%', minHeight: 86, resize: 'vertical', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2, #555)', background: 'var(--dsw-alias-bg-layer-2, transparent)', color: 'inherit', borderRadius: 7, padding: '8px 9px', outline: 'none', fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)', fontSize: 14 },
      caseSelect: { display: 'flex', alignItems: 'flex-start', gap: 8 },
      caseDetailButton: { flex: 1, minWidth: 0, border: 0, background: 'transparent', color: 'inherit', padding: 0, textAlign: 'left', cursor: 'pointer' },
      evidenceCheck: { display: 'flex', alignItems: 'flex-start', gap: 7, border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16))', borderRadius: 7, padding: '7px 8px', cursor: 'pointer', fontSize: 12, lineHeight: 1.4 },
      evidenceCheckSelected: { borderColor: 'var(--dsw-alias-state-business-primary, #4d9ad6)', background: 'var(--dsw-alias-state-business-tertiary, rgba(77,154,214,.12))' },
      monitorHero: { border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.24))', borderRadius: 10, padding: 14, marginBottom: 12, background: 'var(--dsw-alias-bg-layer-1, transparent)' },
      monitorState: { fontSize: 20, lineHeight: 1.2, fontWeight: 780, letterSpacing: '-0.02em' },
      monitorHint: { marginTop: 6, color: 'var(--dsw-alias-label-secondary, inherit)', fontSize: 12, lineHeight: 1.55 },
      boundary: { borderTop: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16))', paddingTop: 11, marginTop: 11 },
      timeline: { position: 'relative', marginTop: 2 },
      timelineItem: { position: 'relative', padding: '0 0 13px 18px', borderLeft: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.24))', marginLeft: 4 },
      timelineDot: { position: 'absolute', left: -4, top: 4, width: 7, height: 7, borderRadius: '50%', background: 'var(--dsw-alias-state-business-primary, #4d9ad6)', boxShadow: '0 0 0 3px var(--dsw-alias-bg-base, #111)' },
      timelineTime: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 12, fontVariantNumeric: 'tabular-nums' },
      timelineTitle: { marginTop: 2, fontSize: 14, fontWeight: 600, lineHeight: 1.45 },
      timelineDetail: { marginTop: 3, color: 'var(--dsw-alias-label-secondary, inherit)', fontSize: 12, lineHeight: 1.5, overflowWrap: 'anywhere' },
      eyebrow: { color: 'var(--dsw-alias-state-business-primary, #4d9ad6)', fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' },
      decisionHero: { border: '1px solid var(--dsw-alias-border-l2, #dfe3e8)', borderLeft: '3px solid var(--pangea-red, #c7000b)', borderRadius: 10, padding: 22, marginBottom: 18, background: 'var(--dsw-alias-bg-layer-1, #fff)' },
      decisionTitle: { marginTop: 5, fontSize: 18, fontWeight: 780, lineHeight: 1.3, letterSpacing: '-0.02em' },
      decisionHint: { marginTop: 6, color: 'var(--dsw-alias-label-secondary, inherit)', fontSize: 14, lineHeight: 1.55 },
      decisionBand: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 14, marginTop: 18 },
      decisionItem: { minWidth: 0, borderTop: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.24))', paddingTop: 7 },
      decisionValue: { marginTop: 3, fontSize: 14, fontWeight: 600, lineHeight: 1.4, overflowWrap: 'anywhere' },
      group: { marginBottom: 14 },
      groupHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, padding: '0 2px 7px', borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16))' },
      groupTitle: { fontSize: 12, fontWeight: 760, lineHeight: 1.4 },
      groupMeta: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 12, lineHeight: 1.45, marginTop: 2 },
      compactCard: { border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16))', background: 'var(--dsw-alias-bg-layer-1, transparent)', borderRadius: 7, padding: 10, marginTop: 7 },
      scenarioIndex: { width: 24, flex: '0 0 24px', color: 'var(--dsw-alias-label-tertiary, #888)', fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)', fontSize: 12, paddingTop: 2 },
      technical: { border: '1px dashed var(--dsw-alias-border-l2, rgba(127,127,127,.32))', borderRadius: 8, padding: 10, marginBottom: 11, background: 'transparent' },
      homeHero: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, padding: '4px 4px 26px', marginBottom: 0 },
      homeTitle: { fontSize: 32, fontWeight: 720, lineHeight: 1.15, letterSpacing: '-0.045em', color: '#14161a' },
      homeLead: { maxWidth: 650, marginTop: 9, color: '#747b85', fontSize: 14, lineHeight: 1.55 },
      metricGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16, marginBottom: 18 },
      metricCard: { position: 'relative', minHeight: 110, display: 'grid', gridTemplateColumns: '48px minmax(0, 1fr)', alignItems: 'center', columnGap: 13, border: '1px solid #dce1e6', borderRadius: 9, padding: '17px 16px', background: '#fff', boxShadow: '0 1px 2px rgba(20,29,40,.035), 0 8px 24px rgba(20,29,40,.035)', boxSizing: 'border-box' },
      metricIcon: { width: 48, height: 48, display: 'grid', placeItems: 'center', borderRadius: 11, background: 'color-mix(in srgb, currentColor 10%, white)' },
      metricLabel: { color: '#3e444c', fontSize: 14, lineHeight: 1.3, fontWeight: 520 },
      metricValue: { marginTop: 4, fontSize: 25, fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' },
      metricAccent: { position: 'absolute', left: '50%', bottom: 0, width: 52, height: 3, borderRadius: '3px 3px 0 0', transform: 'translateX(-50%)' },
      homeSection: { border: '1px solid #dce1e6', borderRadius: 9, background: '#fff', overflow: 'hidden', boxShadow: '0 1px 2px rgba(20,29,40,.03), 0 10px 28px rgba(20,29,40,.025)' },
      homeSectionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 50, gap: 12, padding: '0 18px', borderBottom: '1px solid #e7eaee' },
      homeSectionTitle: { fontSize: 16, fontWeight: 680, letterSpacing: '-0.015em', color: '#25282d' },
      homeTableHeader: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(72px, .72fr) minmax(100px, .92fr) minmax(74px, .62fr) minmax(72px, .72fr) 18px', alignItems: 'center', gap: 12, minHeight: 42, padding: '0 18px', color: '#747b85', fontSize: 12, fontWeight: 520, borderBottom: '1px solid #e7eaee', background: '#fafbfc', boxSizing: 'border-box' },
      homeTableRow: { width: '100%', minHeight: 56, display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(72px, .72fr) minmax(100px, .92fr) minmax(74px, .62fr) minmax(72px, .72fr) 18px', alignItems: 'center', gap: 12, padding: '0 18px', color: '#25282d', textAlign: 'left', border: 0, borderBottom: '1px solid #edf0f2', background: '#fff', cursor: 'pointer', boxSizing: 'border-box' },
      homeStatus: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', justifySelf: 'start', minHeight: 26, padding: '0 8px', border: '1px solid currentColor', borderRadius: 5, background: '#fff', fontSize: 12, fontWeight: 580, whiteSpace: 'nowrap' },
      progressLine: { height: 7, borderRadius: 999, overflow: 'hidden', background: '#edf0f2' },
      appGrid: { display: 'grid', gridTemplateColumns: '1fr', gap: 12 },
      appCard: { minHeight: 102, display: 'grid', gridTemplateColumns: '54px minmax(0, 1fr) 20px', alignItems: 'center', columnGap: 16, textAlign: 'left', color: '#24272c', border: '1px solid #dfe3e8', borderRadius: 8, padding: '15px 18px', background: '#fff', cursor: 'pointer', boxSizing: 'border-box', boxShadow: '0 1px 3px rgba(20,29,40,.02)' },
      appMark: { width: 52, height: 52, display: 'grid', placeItems: 'center', borderRadius: 11, color: '#c7000b', background: '#fff0f1', border: '1px solid #ffe0e2' },
      appTitle: { fontSize: 15, fontWeight: 680, lineHeight: 1.35 },
      appCopy: { marginTop: 5, color: '#747b85', fontSize: 12, lineHeight: 1.45 },
      appArrow: { color: '#68707c', fontSize: 22, lineHeight: 1 },
      homeColumns: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.02fr) minmax(300px, .98fr)', gap: 16, marginTop: 16, minHeight: 330 },
      reportRow: { width: '100%', minHeight: 47, display: 'grid', gridTemplateColumns: '22px minmax(0,1fr) 96px 18px', alignItems: 'center', gap: 10, padding: '0 2px', color: '#24272c', border: 0, borderBottom: '1px solid #edf0f2', background: 'transparent', cursor: 'pointer', textAlign: 'left' },
      redButton: { minWidth: 118, minHeight: 42, border: '1px solid #c7000b', borderRadius: 6, padding: '0 22px', background: 'linear-gradient(135deg, #c7000b, #d90012)', color: '#fff', fontSize: 14, fontWeight: 650, boxShadow: '0 6px 14px rgba(199,0,11,.13)' },
      environmentContent: { padding: '22px 28px 32px', maxWidth: 1120, margin: '0 auto', boxSizing: 'border-box' },
      environmentSection: { border: '1px solid #dce1e6', borderRadius: 9, marginBottom: 18, background: '#fff', overflow: 'hidden', boxShadow: '0 1px 2px rgba(20,29,40,.03)' },
      environmentSectionHead: { minHeight: 51, display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px', borderBottom: '1px solid #e6e9ed' },
      environmentSectionTitle: { fontSize: 16, fontWeight: 700, color: '#25282d' },
      environmentSectionHint: { color: '#7a818c', fontSize: 12 },
      environmentSectionBody: { padding: '18px 20px 20px' },
      environmentConnections: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 18 },
      environmentConnectionCard: { border: '1px solid #dfe3e8', borderRadius: 8, padding: 18, background: '#fbfcfd' },
      environmentConnectionTitle: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, color: '#25282d', fontSize: 15, fontWeight: 700 },
      environmentConnectionIcon: { width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: 7, color: '#c7000b', background: '#fff0f1', border: '1px solid #ffe0e2' },
      environmentFieldGrid: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, .85fr)', gap: 13 },
      environmentField: { minWidth: 0 },
      environmentFieldWide: { gridColumn: '1 / -1' },
      environmentLabel: { display: 'block', marginBottom: 7, color: '#343a43', fontSize: 14, fontWeight: 620 },
      environmentInput: { width: '100%', height: 42, boxSizing: 'border-box', border: '1px solid #cfd5dc', borderRadius: 5, padding: '0 12px', outline: 'none', color: '#272b31', background: '#fff', fontSize: 14 },
      environmentConnectionFoot: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 16 },
      environmentTestState: { color: '#7a818c', fontSize: 12 },
      environmentActions: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 2 },
      environmentSecondaryButton: { minWidth: 74, height: 36, border: '1px solid #cfd4da', borderRadius: 5, padding: '0 16px', color: '#343a43', background: '#fff', cursor: 'pointer', fontSize: 14 },
      environmentPrimaryButton: { minWidth: 102, height: 36, border: '1px solid #c7000b', borderRadius: 5, padding: '0 18px', color: '#fff', background: '#c7000b', cursor: 'pointer', fontSize: 14, fontWeight: 650 },
      environmentAdvanced: { gridColumn: '1 / -1', marginTop: 1, color: '#59616c', fontSize: 12 },
      environmentList: { display: 'grid', gap: 9 },
      environmentListItem: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', gap: 14, padding: '13px 14px', border: '1px solid #e1e5e9', borderRadius: 7, background: '#fff' },
      onboardingShell: { minHeight: 'calc(100vh - 128px)', display: 'grid', placeItems: 'center', padding: '34px 28px 54px', boxSizing: 'border-box', background: 'radial-gradient(circle at 50% 5%, #fff 0, #f7f8fa 44%, #f3f5f7 100%)' },
      onboardingCard: { width: 'min(760px, 100%)', border: '1px solid #dce1e6', borderRadius: 12, padding: '38px 42px 40px', background: '#fff', boxShadow: '0 22px 60px rgba(22,31,43,.08), 0 2px 8px rgba(22,31,43,.04)', boxSizing: 'border-box' },
      onboardingEyebrow: { color: '#c7000b', fontSize: 12, fontWeight: 720, letterSpacing: '.1em' },
      onboardingTitle: { marginTop: 10, color: '#181a1f', fontSize: 30, fontWeight: 730, lineHeight: 1.2, letterSpacing: '-.035em' },
      onboardingLead: { maxWidth: 610, marginTop: 11, color: '#68717c', fontSize: 14, lineHeight: 1.7 },
      onboardingRail: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', marginTop: 30, borderTop: '1px solid #e0e4e8' },
      onboardingStep: { position: 'relative', padding: '20px 14px 18px 0', color: '#7a828d', fontSize: 12, lineHeight: 1.45 },
      onboardingStepDot: { position: 'absolute', top: -6, left: 0, width: 11, height: 11, borderRadius: '50%', background: '#c7000b', boxShadow: '0 0 0 4px #fff' },
      onboardingStepTitle: { color: '#292d33', fontSize: 14, fontWeight: 680, marginBottom: 4 },
      repositoryPicker: { marginTop: 6, border: '1px solid #dce1e6', borderRadius: 9, padding: 18, background: '#fafbfc' },
      repositoryPickerRow: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'end', gap: 14 },
      repositoryPath: { minHeight: 42, display: 'flex', alignItems: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: '1px solid #cfd5dc', borderRadius: 5, padding: '0 12px', color: '#4e5661', background: '#fff', fontSize: 14, boxSizing: 'border-box' },
      repositoryActions: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 22 },
      repositoryHint: { marginTop: 12, color: '#7a828d', fontSize: 12, lineHeight: 1.6 },
    }

    function icon(size = 16) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      }, h('circle', { cx: 12, cy: 12, r: 8 }), h('path', { d: 'M7.5 12h9M12 7.5v9' }), h('circle', { cx: 12, cy: 12, r: 2.2 }))
    }

    function dashboardIcon(kind, color) {
      const paths = {
        running: [h('circle', { key: 'c', cx: 12, cy: 12, r: 8.5 }), h('path', { key: 'p', d: 'm10 8 6 4-6 4Z' })],
        review: [h('circle', { key: 'c', cx: 12, cy: 12, r: 8.5 }), h('path', { key: 'p', d: 'M12 7v5l3 2' })],
        risk: [h('path', { key: 'p', d: 'M12 3.5 20 7v5.5c0 4.1-3.1 6.9-8 8-4.9-1.1-8-3.9-8-8V7l8-3.5Z' }), h('path', { key: 'l', d: 'M12 8v5m0 3h.01' })],
        report: [h('path', { key: 'p', d: 'M7 3.5h7l3 3V20H7Z' }), h('path', { key: 'l', d: 'M14 3.5V7h3M10 11h4m-4 3h4' })],
      }
      return h('span', { style: { ...styles.metricIcon, color }, 'aria-hidden': true },
        h('svg', { width: 29, height: 29, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }, paths[kind] ?? paths.report))
    }

    function appGlyph(kind) {
      const paths = kind === 'analysis'
        ? [h('path', { key: 'a', d: 'M4 17.5 8.4 13l3.4 3 7.2-8.5' }), h('path', { key: 'b', d: 'M5 4h14v16H5Z' }), h('circle', { key: 'c', cx: 8.4, cy: 13, r: 1.1 })]
        : [h('rect', { key: 'a', x: 3.5, y: 4, width: 12, height: 6.5, rx: 1.5 }), h('rect', { key: 'b', x: 3.5, y: 13.5, width: 9, height: 6.5, rx: 1.5 }), h('circle', { key: 'c', cx: 17.5, cy: 16.5, r: 3 }), h('path', { key: 'd', d: 'M17.5 12.2v1.3m0 6v1.3m4.3-4.3h-1.3m-6 0h-1.3' })]
      return h('svg', { width: 31, height: 31, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, paths)
    }

    function reportGlyph() {
      return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: '#737b86', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M6 3.5h8l4 4V20H6Z' }), h('path', { d: 'M14 3.5V8h4M9 12h6m-6 3h6' }))
    }

    function text(value, fallback = '—') { return typeof value === 'string' && value.trim() !== '' ? value : fallback }
    function hasText(value) { return typeof value === 'string' && value.trim() !== '' }
    function runLabel(run) { return text(run?.target, text(run?.run_id, '未命名 Run')) }
    function shortId(value) { return hasText(value) ? value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value : '—' }
    function formatTime(value) {
      const date = Number.isFinite(value) || typeof value === 'string' ? new Date(value) : null
      if (!date || Number.isNaN(date.getTime())) return '时间未知'
      return date.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      })
    }
    function formatDate(value) {
      if (value === null || value === undefined || value === '') return '—'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return '—'
      return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replaceAll('/', '-')
    }
    function durationLabel(start, end = Date.now()) {
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return ''
      const seconds = Math.max(0, Math.round((end - start) / 1000))
      if (seconds < 60) return `${seconds} 秒`
      const minutes = Math.floor(seconds / 60)
      return minutes < 60 ? `${minutes} 分 ${seconds % 60} 秒` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`
    }
    function filePathFromLocation(location) {
      if (!hasText(location)) return undefined
      const value = location.trim()
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return undefined
      return value.replace(/#L\d+(?:-L?\d+)?$/i, '').replace(/:\d+(?:-\d+)?$/, '').trim() || undefined
    }
    function evidenceIdentity(item) {
      return [item?.chunk_id ?? '', item?.location ?? '', item?.observation ?? ''].join('\u0000')
    }
    function evidenceTabLabel(item, index) {
      const location = text(item?.location, `证据 ${index + 1}`)
      const filePath = filePathFromLocation(location) ?? location
      const fileName = filePath.split(/[\\/]/).pop() || filePath
      const hashRange = /#L(\d+)(?:-L?(\d+))?$/i.exec(location)
      const colonRange = hashRange === null ? /:(\d+)(?:-(\d+))?$/.exec(location) : null
      const range = hashRange ?? colonRange
      const lineLabel = range ? `:${range[1]}${range[2] ? `–${range[2]}` : ''}` : ''
      return `${index + 1} · ${fileName}${lineLabel}`
    }
    function absoluteWorkspacePath(cwd, value) {
      if (!hasText(value)) return undefined
      if (/^(?:\/|[A-Za-z]:[\\/])/.test(value)) return value
      if (!hasText(cwd)) return value
      const separator = cwd.includes('\\') ? '\\' : '/'
      return `${cwd.replace(/[\\/]+$/, '')}${separator}${value.replace(/^[\\/]+/, '')}`
    }
    function evidenceFilePath(location, cwd, dataRoot, runDirectory) {
      const value = filePathFromLocation(location)
      if (!value) return undefined
      if (/^(?:\/|[A-Za-z]:[\\/])/.test(value)) return value
      const repositoryLocation = value.match(/^([^:/\\]+):(.+)$/)
      if (repositoryLocation && hasText(dataRoot)) {
        if (hasText(runDirectory)) {
          return absoluteWorkspacePath(runDirectory, `inputs/source/repository/${repositoryLocation[2]}`)
        }
        const repositoryRoot = absoluteWorkspacePath(dataRoot, `repositories/${repositoryLocation[1]}`)
        return absoluteWorkspacePath(repositoryRoot, repositoryLocation[2])
      }
      return absoluteWorkspacePath(cwd, value)
    }
    function appendConversationDraft(ctx, scope, value) {
      try {
        const actx = ctx?.sessions?.scope?.(scope?.sessionId)
        const conversation = ctx?.get?.('conversation')
        if (!actx || !conversation || !hasText(value)) return false
        const input = conversation.input.for(actx)
        const draft = input.state.getSnapshot().draft
        input.setDraft(hasText(draft) ? `${draft}\n\n${value}` : value)
        return true
      } catch (reason) {
        console.warn('[dsh-pangea-companion] conversation draft insert failed:', reason)
        return false
      }
    }
    function discussionLine(lines, label, value) {
      if (hasText(value)) lines.push(`${label}：${value.trim()}`)
    }
    function discussionList(lines, label, values) {
      const items = Array.isArray(values) ? values.filter(hasText) : []
      if (items.length === 0) return
      lines.push(`${label}：`)
      for (const item of items) lines.push(`- ${item.trim()}`)
    }
    function evidenceLine(item) {
      const location = text(item?.location, '未标注位置')
      return hasText(item?.observation) ? `${location} — ${item.observation.trim()}` : location
    }
    function splitRiskClaims(value) {
      if (!hasText(value)) return []
      return value.trim().split(/(?<=[。！？；;])\s*/).map(item => item.trim()).filter(hasText)
    }
    function buildDiscussionDraft({ kind, item, runId, run, risks = [], testCases = [], intent = 'review', selectedClaim, sourceSnippet, sourceSnippets = [] }) {
      const lines = [DISCUSSION_INTENTS[intent] ?? DISCUSSION_INTENTS.review, '', '[PANGEA 局部上下文]', `Run：${text(runId, '未知')}`]
      const riskById = new Map(risks.map(risk => [risk.risk_id, risk]))
      const caseById = new Map(testCases.map(testCase => [testCase.test_case_id, testCase]))
      const snippets = [...(Array.isArray(sourceSnippets) ? sourceSnippets : []), ...(sourceSnippet ? [sourceSnippet] : [])].filter(snippet => snippet?.lines?.length)
      const isolatedSourceReview = intent === 'evidence' && snippets.length > 0
      const targetedExecutable = intent === 'targeted-executable' && snippets.length > 0
      const scopedRiskDraft = isolatedSourceReview || targetedExecutable
      if (kind === 'risk') {
        lines.push(`对象：风险 ${text(item?.risk_id, '未编号')}`)
        discussionLine(lines, '标题', item?.title)
        if (scopedRiskDraft) {
          discussionLine(lines, targetedExecutable ? '待测试结论' : '待核对结论', selectedClaim ?? item?.system_result ?? item?.title)
          if (targetedExecutable) {
            discussionLine(lines, '触发条件', item?.trigger)
            discussionLine(lines, '外部观察', item?.external_observation)
          }
        } else {
          discussionLine(lines, '严重度', SEVERITY[item?.severity] ?? item?.severity)
          discussionLine(lines, '风险说明', item?.narrative)
          discussionLine(lines, '触发条件', item?.trigger)
          discussionLine(lines, '代码失效', item?.system_result)
          discussionLine(lines, '残留状态', item?.residual_effect)
          discussionLine(lines, '表面正常现象', item?.apparent_normality)
          discussionLine(lines, '对外暴露', item?.external_observation)
          discussionLine(lines, '黑盒证明', item?.blackbox_proof)
          discussionLine(lines, '排除条件', item?.exclusion_condition)
          discussionLine(lines, '上游语义结论', item?.upstream_semantics?.conclusion)
          discussionList(lines, '直接证据', (item?.evidence ?? []).map(evidenceLine))
          discussionList(lines, '关联测试用例', (item?.linked_test_case_ids ?? []).map(id => {
            const linked = caseById.get(id)
            return linked ? `${id} ${text(linked.title, '')}`.trim() : id
          }))
        }
      } else if (kind === 'case') {
        lines.push(`对象：测试用例 ${text(item?.test_case_id, '未编号')}`)
        discussionLine(lines, '标题', item?.title)
        discussionLine(lines, '类型', item?.case_type)
        discussionList(lines, '前置条件', item?.preconditions)
        discussionList(lines, '执行步骤', item?.steps)
        discussionList(lines, '预期结果', item?.expected_results)
        discussionList(lines, '观察点', item?.observability)
        discussionList(lines, '清理动作', item?.cleanup)
        if (riskApplicable(run)) discussionList(lines, '关联风险', (item?.linked_risk_ids ?? []).map(id => {
          const linked = riskById.get(id)
          return linked ? `${id} ${text(linked.title, '')}`.trim() : id
        }))
        const linkedEvidence = (item?.linked_risk_ids ?? []).flatMap(id => riskById.get(id)?.evidence ?? [])
        discussionList(lines, '直接关联证据', [...new Set(linkedEvidence.map(evidenceLine))])
      } else {
        lines.push('对象：证据')
        discussionLine(lines, '位置', item?.location)
        if (isolatedSourceReview) {
          discussionLine(lines, '待核对结论', item?.observation)
        } else {
          discussionLine(lines, 'Chunk ID', item?.chunk_id)
          discussionLine(lines, '观察结论', item?.observation)
          if (riskApplicable(run)) discussionList(lines, '关联风险', (item?.risk_ids ?? []).map(id => {
            const linked = riskById.get(id)
            return linked ? `${id} ${text(linked.title, '')}`.trim() : id
          }))
          const linkedCases = new Set((item?.risk_ids ?? []).flatMap(id => riskById.get(id)?.linked_test_case_ids ?? []))
          discussionList(lines, '关联测试用例', [...linkedCases].map(id => {
            const linked = caseById.get(id)
            return linked ? `${id} ${text(linked.title, '')}`.trim() : id
          }))
        }
      }
      if (item?.source_record && !scopedRiskDraft) {
        const record = item.source_record
        lines.push('', `分析单元：${item.unit_id}`, `原始记录：${record.record_id} · revision ${record.revision}`, `结果文件：${record.result_path}`, 'Agent 原文：', typeof record.body === 'string' ? record.body : JSON.stringify(record.body, null, 2))
      }
      for (const [index, snippet] of snippets.entries()) {
        const label = snippets.length > 1 ? `选中源码片段 ${index + 1}/${snippets.length}` : '选中源码片段'
        lines.push('', `${label}：${text(snippet.file_path, text(snippet.location, '未标注文件'))}:${snippet.visible_start}-${snippet.visible_end}`, '```')
        for (const line of snippet.lines) lines.push(`${String(line.number).padStart(5, ' ')} | ${line.text}`)
        lines.push('```')
      }
      lines.push('', isolatedSourceReview
        ? '回答限制：只讨论选中源码片段，不要补充其他证据，也不要重新概括整个 Run。'
        : targetedExecutable
          ? '回答限制：只生成这一个结论对应的单个测试，不要扩展到整条风险、可选场景或其他证据。'
          : '请不要重新概括整个 Run，直接回答上面的问题。')
      return lines.join('\n')
    }
    function field(label, value) {
      return h('div', null, h('div', { style: styles.label }, label), h('div', { style: styles.value }, value ?? '—'))
    }
    function section(title, value) {
      if (!value) return null
      return h('div', { style: styles.card }, h('div', { style: styles.itemTitle }, title), h('div', { style: { ...styles.text, marginTop: 6 } }, value))
    }
    function stringList(title, items, ordered = false) {
      if (!Array.isArray(items) || items.length === 0) return null
      const display = item => item && typeof item === 'object'
        ? `${item.action ?? JSON.stringify(item)}${item.expected_result ? ` → ${item.expected_result}` : ''}`
        : String(item)
      return h('div', { style: styles.card }, h('div', { style: styles.itemTitle }, title), h(ordered ? 'ol' : 'ul', { style: styles.list }, items.map((item, index) => h('li', { key: `${index}:${display(item)}` }, display(item)))))
    }
    function chip(label, onClick, key = label) { return h('button', { key, type: 'button', style: styles.chip, onClick }, label) }
    function navType(screen) {
      if (screen.type === 'home') return 'home'
      if (screen.type === 'tasks') return 'tasks'
      if (screen.type === 'risk') return 'risks'
      if (screen.type === 'case' || screen.type === 'coverage-cases') return 'cases'
      if (screen.type === 'evidence-detail') return 'evidence'
      if (screen.type === 'flows') return 'flows'
      if (screen.type === 'review') return 'overview'
      return screen.type
    }

    function analysisBackTarget(screenType, { pageMode = 'analysis', selectedTaskId, hasHistory = false, initialScreen = 'tasks' } = {}) {
      if (hasHistory) return 'history'
      if (pageMode === 'analysis' && selectedTaskId && !['tasks', 'create', 'overview', 'repository-import'].includes(screenType)) return 'overview'
      return initialScreen
    }

    function buildAnalysisRequest(form) {
      return {
        request_version: '2.0',
        ...(form.source_task_id ? { source_task_id: form.source_task_id } : {}),
        repository: form.repository,
        target: form.target,
        ...(form.scope_preview_id ? { scope_preview_id: form.scope_preview_id, expected_scope_revision: form.expected_scope_revision } : {}),
        source_scope: String(form.source_scope_text ?? '').split(/\r?\n/).map(value => value.trim()).filter(Boolean),
        asset_ids: Array.isArray(form.asset_ids) ? form.asset_ids : [],
        scenario: form.scenario || 'module-analysis',
        ...(form.objective ? { objective: form.objective } : {}),
        ...(form.analysis_profile ? { analysis_profile: form.analysis_profile, asset_revisions: form.asset_revisions ?? {} } : {}),
        ...(form.analysis_profile !== 'behavior-test-v2' && form.scenario === 'coverage-analysis' ? { coverage_input: form.coverage_kind === 'file'
          ? { kind: 'file', path: form.coverage_path }
          : form.coverage_kind === 'asset' ? { kind: 'asset', asset_id: form.coverage_asset_id }
          : { kind: 'query', query: { product: form.coverage_product, c_version: form.coverage_version, b_version: form.coverage_b_version || '', scope: form.coverage_module, recursive: form.coverage_recursive !== false, source: form.coverage_source || 'summary' } } } : {}),
        mode: form.mode || 'depth',
        provider_id: form.provider_id || null,
        model_route: null,
        agent_model: form.provider_id ? form.agent_model || null : null,
        ...(form.agent_catalog_id ? { agent_catalog_id: form.agent_catalog_id } : {}),
      }
    }
    function riskApplicable(run) {
      return run?.analysis_profile === 'behavior-test-v2' ? run.analysis_scene?.presentation?.risks === true : run?.scenario !== 'coverage-analysis'
    }
    function diagramIsStale(view, run) {
      if (run?.workflow_version !== 'source-first-v1') return view?.source_revision !== (run?.publication?.revision ?? null)
      const records = Object.values(run?.details ?? {}).filter(Array.isArray).flat().flatMap(row => row?.source_record ? [row.source_record] : [])
      return (view?.source_records ?? []).some(source => !records.some(record => record.action_id === source.action_id && record.record_id === source.record_id && record.revision === source.revision))
    }
    function writableConversation(task) {
      const conversations = Array.isArray(task?.conversations) ? task.conversations : []
      const writable = conversations.filter(item => item?.kind !== 'analysis' && hasText(item?.session_id))
      return writable.find(item => item.conversation_id === task?.active_conversation_id) ?? writable[0] ?? null
    }

    function emptyEnvironmentForm() {
      return {
        id: '', name: '', advanced: false,
        host_ip: '', host_username: '', host_password: '', host_port: '22',
        array_ip: '', array_username: '', array_password: '', array_port: '22',
      }
    }

    function acpSettingsDraft(providers) {
      return Object.fromEntries((providers ?? []).map(provider => [provider.id, {
        command: provider.command ?? '',
        args: (provider.args ?? []).join('\n'),
      }]))
    }

    function acpResolutionLabel(value) {
      return ({
        resolved: '已解析',
        not_found: '未找到命令',
        probe_error: '探测失败',
        'built-in': '内置 Provider',
        not_checked: '尚未检查',
      })[value] ?? value ?? '待重启检查'
    }

    function acpVersionLabel(provider) {
      if (provider.version) return provider.version
      if (provider.version_status === 'unavailable') return '命令可用，未返回版本'
      if (provider.version_status === 'not_checked') return '尚未检查'
      return '未读取'
    }

    function analysisExecutionState(form, providers, state, cwd) {
      const providerId = form.provider_id
      const provider = (providers ?? []).find(item => item.id === providerId)
      const blocked = message => ({ ready: false, model: '', catalogId: '', message })
      if (!providerId) return blocked(form.external_selection_required ? '历史分析使用内部 API，请重新选择外部 Agent 和模型。' : '请选择已加载的外部 Agent。')
      if (provider?.registered !== true) return blocked('所选外部 Agent 尚未加载，请检查 Agent 设置。')
      if (state?.cwd !== cwd || state?.provider_id !== providerId || ['idle', 'loading'].includes(state?.status) || !state?.status) return blocked('正在读取 Agent 可用模型，请等待完成后再继续。')
      if (state.status === 'error') return blocked(state.error || '模型列表读取失败，请刷新模型后重试。')
      const catalog = state.catalog
      if (state.status !== 'ready' || catalog?.provider_id !== providerId || !catalog?.catalog_id) return blocked('模型列表尚未确认，请刷新模型后重试。')
      const models = Array.isArray(catalog.models) ? catalog.models : []
      const model = form.agent_model || catalog.current_model
      if (!model) return blocked(models.length ? 'Agent 未返回有效默认模型，请明确选择一个模型。' : 'Agent 未返回可用模型，请检查 Agent 配置后刷新模型。')
      if (!models.some(item => item.id === model)) return blocked(form.agent_model ? '原选择的模型已不在当前列表中，请重新选择。' : 'Agent 默认模型不在当前可用列表中，请明确选择一个模型。')
      return { ready: true, model, catalogId: catalog.catalog_id, message: `已确认模型：${model}` }
    }

    function loadAnalysisAgentModels({ providerId, cwd, onState, fetcher = fetch }) {
      const controller = new AbortController()
      const scope = { provider_id: providerId, cwd }
      onState({ ...scope, status: 'loading' })
      requestAgentModels({ providerId, cwd, signal: controller.signal, fetcher }).then(catalog => {
        if (controller.signal.aborted) return
        if (catalog.provider_id !== providerId) throw new Error('返回的模型列表与所选 Agent 不一致，请重试。')
        onState({ ...scope, status: 'ready', catalog })
      }).catch(failure => {
        if (!controller.signal.aborted) onState({ ...scope, status: 'error', error: failure instanceof Error ? failure.message : String(failure) })
      })
      return () => controller.abort()
    }

    function AgentModelSelect({ providerId, cwd, state, value, onChange, onRefresh, disabled }) {
      const current = state?.cwd === cwd && state?.provider_id === providerId && state.status === 'ready' ? state.catalog : null
      const models = Array.isArray(current?.models) ? current.models : []
      const loading = !state || state.cwd !== cwd || state.provider_id !== providerId || ['idle', 'loading'].includes(state.status)
      const selection = analysisExecutionState({ provider_id: providerId, agent_model: value }, [{ id: providerId, registered: true }], state, cwd)
      const defaultReady = Boolean(current?.current_model && models.some(model => model.id === current.current_model))
      return h('div', null,
        h('label', null, h('div', { style: styles.label }, 'Agent 模型'),
          h('select', { 'aria-label': 'Agent 模型', style: { ...styles.search, marginTop: 5, marginBottom: 0 }, disabled: disabled || !current, value: value || '', onChange: event => onChange(event.target.value) },
            h('option', { value: '', disabled: !defaultReady }, defaultReady ? `使用 Agent 默认（${current.current_model}）` : loading ? '正在读取模型…' : '请选择可用模型'),
            value && !models.some(model => model.id === value) ? h('option', { value, disabled: true }, `${value}（${loading ? '读取中' : '当前列表不可用'}）`) : null,
            models.map(model => h('option', { key: model.id, value: model.id }, `${model.label || model.id}${!model.label || model.label === model.id ? '' : ` · ${model.id}`}`)))),
        h('div', { style: { ...styles.row, marginTop: 6 } },
          h('span', { style: state?.status === 'error' ? styles.error : styles.itemMeta, role: state?.status === 'error' ? 'alert' : 'status' }, selection.message),
          h('button', { type: 'button', style: styles.button, disabled: disabled || loading, onClick: onRefresh }, '刷新模型')))
    }

    function AcpSettingsPanel({ visible }) {
      const [snapshot, setSnapshot] = React.useState(undefined)
      const [draft, setDraft] = React.useState({})
      const [loading, setLoading] = React.useState(false)
      const [saving, setSaving] = React.useState(false)
      const [testing, setTesting] = React.useState(false)
      const [restartRequired, setRestartRequired] = React.useState(false)
      const [notice, setNotice] = React.useState(undefined)

      const loadSettings = React.useCallback(async () => {
        setLoading(true)
        try {
          const value = await requestAcpSettings()
          setSnapshot(value)
          setDraft(acpSettingsDraft(value.providers))
          setNotice(undefined)
        } catch (error) {
          setNotice({ error: true, message: error instanceof Error ? error.message : String(error) })
        } finally { setLoading(false) }
      }, [])

      React.useEffect(() => { if (visible) void loadSettings() }, [loadSettings, visible])

      const setField = (providerId, field, value) => setDraft(current => ({
        ...current, [providerId]: { ...(current[providerId] ?? {}), [field]: value },
      }))
      const save = async () => {
        setSaving(true)
        try {
          const providers = Object.fromEntries((snapshot?.providers ?? []).map(provider => {
            const value = draft[provider.id] ?? {}
            return [provider.id, {
              command: String(value.command ?? '').trim(),
              args: String(value.args ?? '').split(/\r?\n/).map(item => item.trim()).filter(Boolean),
            }]
          }))
          const saved = await saveAcpSettings({ version: 1, providers })
          await loadSettings()
          setRestartRequired(saved.restart_required === true)
          setNotice({ error: false, message: saved.restart_required
            ? '配置已保存。请重启 Harness，使新的启动命令生效。'
            : '配置已保存。' })
        } catch (error) {
          setNotice({ error: true, message: error instanceof Error ? error.message : String(error) })
        } finally { setSaving(false) }
      }
      const testRuntime = async () => {
        setTesting(true)
        try {
          const checks = await testAcpSettings()
          const failures = checks.filter(item => !item.ok)
          setNotice(failures.length === 0
            ? { error: false, message: `运行时契约检查通过：${checks.length} 个 Agent 均已注册。` }
            : { error: true, message: failures.map(item => `${item.label}：${item.reasons.join('；')}`).join('\n') })
        } catch (error) {
          setNotice({ error: true, message: error instanceof Error ? error.message : String(error) })
        } finally { setTesting(false) }
      }

      return h('div', { style: styles.root, role: 'region', 'aria-label': 'Agent Runtime 设置' },
        h('div', { style: styles.sticky }, h('div', { style: styles.header },
          h('div', null, h('div', { style: styles.title }, 'Agent Runtime'), h('div', { style: styles.subline }, '查看本机 Agent 状态。日常直接在“新建分析”选择 Agent 和模型，无需到这里配置。')),
          h('button', { type: 'button', disabled: loading, style: styles.button, onClick: () => { void loadSettings() } }, loading ? '读取中…' : '刷新'))),
        h('div', { style: styles.environmentContent },
          notice ? h('div', { style: { ...styles.card, ...(notice.error ? styles.healthError : styles.healthOk) }, role: notice.error ? 'alert' : 'status' }, notice.message) : null,
          restartRequired && typeof window.dshDesktop?.restartHarness === 'function' ? h('div', { style: styles.card },
            h('div', { style: styles.row }, h('div', { style: styles.itemMeta }, '重启后 Desktop 会重新通过 PowerShell 解析命令并注册 Provider。'),
              h('button', { type: 'button', style: styles.button, onClick: () => { void window.dshDesktop.restartHarness() } }, '立即重启 Harness'))) : null,
          (snapshot?.providers ?? []).map(provider => h('section', { key: provider.id, style: styles.card },
            h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, provider.label),
              h('span', { style: styles.badge }, provider.registered && provider.available ? '已加载' : '未就绪')),
            h('div', { style: styles.itemMeta }, `${acpResolutionLabel(provider.resolution_status)} · ${acpVersionLabel(provider)}`),
            provider.resolution_error ? h('div', { style: styles.error }, provider.resolution_error) : null)),
          h('details', { style: styles.card },
            h('summary', { style: styles.itemTitle }, '高级启动设置与诊断'),
            h('div', { style: { ...styles.itemMeta, margin: '12px 0' } }, '仅命令未找到或使用自定义安装时需要修改。模型列表会从 Agent 自动读取，无需填写。'),
          (snapshot?.providers ?? []).map(provider => {
            const value = draft[provider.id] ?? {}
            return h('section', { key: provider.id, style: styles.environmentSection },
              h('div', { style: styles.environmentSectionHead },
                h('div', { style: styles.environmentSectionTitle }, provider.label),
                h('span', { style: styles.badge }, provider.registered ? 'Provider 已注册' : 'Provider 未注册')),
              h('div', { style: styles.environmentSectionBody },
                h('div', { style: styles.grid },
                  h('div', { style: styles.metric }, h('div', { style: styles.label }, '命令解析'), h('div', { style: styles.value }, acpResolutionLabel(provider.resolution_status))),
                  h('div', { style: styles.metric }, h('div', { style: styles.label }, '版本'), h('div', { style: styles.value }, acpVersionLabel(provider))),
                  h('div', { style: styles.metric }, h('div', { style: styles.label }, '登录状态'), h('div', { style: styles.value }, provider.login_status === 'not_checked' ? '尚未检测' : provider.login_status ?? '未知')),
                  h('div', { style: styles.metric }, h('div', { style: styles.label }, '绝对路径'), h('div', { style: styles.value }, provider.resolved_command ?? '待解析'))),
                provider.resolution_error ? h('div', { style: { ...styles.error, margin: '10px 0' } }, provider.resolution_error) : null,
                provider.version_error ? h('div', { style: { ...styles.healthWarning, margin: '10px 0' } }, `版本检查：${provider.version_error}`) : null,
                h(React.Fragment, null,
                h('div', { style: styles.environmentField }, h('label', { style: styles.environmentLabel }, '启动命令'), h('input', {
                  style: styles.environmentInput, value: value.command ?? '', onChange: event => setField(provider.id, 'command', event.target.value),
                })),
                h('div', { style: { ...styles.environmentField, marginTop: 13 } }, h('label', { style: styles.environmentLabel }, '启动参数（每行一个）'), h('textarea', {
                  style: styles.textarea, value: value.args ?? '', placeholder: 'acp', onChange: event => setField(provider.id, 'args', event.target.value),
                }))))
            )
          }),
          h('div', { style: styles.environmentActions },
            h('button', { type: 'button', disabled: loading || saving || testing, style: styles.environmentSecondaryButton, onClick: () => { void testRuntime() } }, testing ? '检查中…' : '检查运行时'),
            h('button', { type: 'button', disabled: loading || saving, style: styles.environmentSecondaryButton, onClick: () => { void loadSettings() } }, '放弃修改'),
            h('button', { type: 'button', disabled: loading || saving || !snapshot, style: styles.environmentPrimaryButton, onClick: () => { void save() } }, saving ? '保存中…' : '保存配置')))))
    }

    const COVERAGE_SCOPE_LABELS = { in_scope: '范围内', out_of_scope: '范围外', unresolved: '待确认', unclassified: '未判定' }
    const idList = value => Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
    function flowContentState(flow) {
      if (typeof flow?.text === 'string' && flow.text.trim()) return '已有文字流程'
      return Array.isArray(flow?.mainline_steps) && flow.mainline_steps.length ? '已有步骤' : flow?.paths?.length ? '按路径阅读' : '流程内容待补齐'
    }

    // Native diagrams: element trees from flow-graph/render.js mapped to React SVG elements.
    function svgAttrName(name) {
      if (name === 'class') return 'className'
      if (/^(data|aria)-/.test(name) || !name.includes('-')) return name
      return name.replace(/-([a-z])/g, (_, char) => char.toUpperCase())
    }
    function svgTreeToReact(tree, key, onNode, onEdge, onMessage) {
      if (tree == null || tree === false) return null
      if (typeof tree !== 'object') return String(tree)
      const props = { key }
      for (const [name, value] of Object.entries(tree.attrs ?? {})) if (value != null && value !== false) props[svgAttrName(name)] = value
      const nodeId = tree.attrs?.['data-node-id']
      if (nodeId && onNode) {
        props.role = 'button'
        props.tabIndex = 0
        props['aria-label'] = `查看节点 ${nodeId}`
        props.onClick = () => onNode(nodeId)
        props.onKeyDown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onNode(nodeId) } }
      }
      const edgeId = tree.attrs?.['data-edge-id']
      if (tree.tag === 'g' && edgeId && onEdge) {
        props.role = 'button'
        props.tabIndex = 0
        props['aria-label'] = tree.attrs?.['aria-label'] || `查看连线 ${edgeId}`
        // Pointer crossing must not change page state or move the canvas.
        // Local hover/focus styling lives in the SVG; details require activation.
        props.onClick = event => { event?.stopPropagation?.(); onEdge.select(edgeId) }
        props.onKeyDown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation?.(); onEdge.select(edgeId) } }
      }
      const messageId = tree.attrs?.['data-message-id']
      if (tree.tag === 'g' && messageId && onMessage) {
        props.onClick = event => { event?.stopPropagation?.(); onMessage(messageId) }
        props.onKeyDown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation?.(); onMessage(messageId) } }
      }
      return h(tree.tag, props, ...(tree.children ?? []).map((child, index) => svgTreeToReact(child, index, onNode, onEdge, onMessage)))
    }
    /** Graph input for a flow: behavior-flow nodes, else legacy mainline steps in order plus bound branches. */
    function flowGraphInput(flow) {
      if (Array.isArray(flow?.nodes) && flow.nodes.length) return flow
      const steps = (Array.isArray(flow?.mainline_steps) ? flow.mainline_steps : []).filter(step => step?.step_id)
      const ids = new Set(steps.map(step => step.step_id))
      const edges = steps.slice(1).map((step, index) => ({ source_step_key: steps[index].step_id, target_step_key: step.step_id, condition: '' }))
      const seen = new Set(edges.map(edge => `${edge.source_step_key}\u0000${edge.target_step_key}`))
      for (const branch of Array.isArray(flow?.branches) ? flow.branches : []) {
        if (!ids.has(branch?.from_step_id) || !ids.has(branch?.to_step_id)) continue
        const pair = `${branch.from_step_id}\u0000${branch.to_step_id}`
        if (seen.has(pair) && !branch.condition) continue
        seen.add(pair)
        edges.push({ source_step_key: branch.from_step_id, target_step_key: branch.to_step_id, condition: branch.condition || '' })
      }
      return { ...flow, nodes: steps.map(step => ({ id: step.step_id, label: step.title || step.step_id, kind: step.node_kind ?? null,
        description: step.processing || '', source_evidence: step.source_evidence ?? [] })), edges,
        paths: (Array.isArray(flow?.paths) ? flow.paths : []).filter(path => Array.isArray(path?.node_ids)) }
    }
    /** Highlight members for a set of branch ids (projected edges or legacy branches). */
    function branchHighlight(flow, branchIds, layout) {
      if (!branchIds?.length) return null
      const wanted = new Set(branchIds)
      const nodes = new Set()
      const pairs = new Set()
      const edgeIds = new Set()
      for (const branch of Array.isArray(flow?.branches) ? flow.branches : []) {
        if (!wanted.has(branch?.branch_id)) continue
        if (branch.from_step_id) nodes.add(branch.from_step_id)
        if (branch.to_step_id) nodes.add(branch.to_step_id)
        if (branch.from_step_id && branch.to_step_id) pairs.add(`${branch.from_step_id}\u0000${branch.to_step_id}`)
        const matches = (layout?.edges ?? []).filter(edge => branch.edge_id ? edge.edge_id === branch.edge_id
          : edge.source === branch.from_step_id && edge.target === branch.to_step_id && edge.condition === (branch.condition || ''))
        if (matches.length === 1) edgeIds.add(matches[0].edge_id)
      }
      return nodes.size ? { nodes, pairs, edge_ids: edgeIds } : null
    }
    function evidenceText(value) {
      const list = Array.isArray(value) ? value : value ? [value] : []
      return list.map(item => typeof item === 'string' ? item : item?.location || [item?.file ?? item?.path, item?.line].filter(Boolean).join(':')).filter(Boolean)
    }
    function downloadBlob(blob, name) {
      if (typeof document === 'undefined' || typeof URL === 'undefined') return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    function exportSvgTree(tree, name, format, graph) {
      const markup = format === 'svg' && graph ? toInteractiveFlowSvg(graph) : toSvgString(tree)
      if (format === 'svg') return downloadBlob(new Blob([markup], { type: 'image/svg+xml' }), `${name}.svg`)
      if (typeof Image === 'undefined' || typeof document === 'undefined') return
      const image = new Image()
      image.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = (tree.attrs.width || 1) * 2
        canvas.height = (tree.attrs.height || 1) * 2
        const context = canvas.getContext('2d')
        context.scale(2, 2)
        context.drawImage(image, 0, 0)
        canvas.toBlob(blob => { if (blob) downloadBlob(blob, `${name}.png`) }, 'image/png')
      }
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
    }
    const GRAPH_CANVAS_STYLE = { overflow: 'hidden', width: '100%', height: 'clamp(320px, 55vh, 560px)', boxSizing: 'border-box', border: '1px solid #e2e7e0', borderRadius: 8, background: '#fbfcfe', touchAction: 'none', userSelect: 'none' }
    function useGraphZoom(label, graphWidth, graphHeight, graphKey, viewport) {
      const canvasRef = React.useRef(null)
      const sizeRef = React.useRef(viewport?.size ?? { width: 1, height: 1 })
      const dragRef = React.useRef(null)
      const suppressClickRef = React.useRef(false)
      const [size, setSize] = React.useState(sizeRef.current)
      const [camera, setCamera] = React.useState(viewport?.camera ?? { scale: 1, x: 0, y: 0, fit: true })
      const cameraRef = React.useRef(camera)
      cameraRef.current = camera
      const [dragging, setDragging] = React.useState(false)
      const [fullscreen, setFullscreen] = React.useState(false)
      const [fullscreenBusy, setFullscreenBusy] = React.useState(false)
      const [fullscreenError, setFullscreenError] = React.useState('')
      const fullscreenTarget = () => canvasRef.current?.closest?.('section') ?? canvasRef.current?.parentElement
      React.useEffect(() => {
        const syncFullscreen = () => {
          setFullscreen(Boolean(document.fullscreenElement && document.fullscreenElement === fullscreenTarget()))
          setFullscreenError('')
        }
        const exitOnEscape = async event => {
          if (event.key !== 'Escape' || event.defaultPrevented || event.repeat || !document.fullscreenElement || document.fullscreenElement !== fullscreenTarget()
            || event.target?.closest?.('dialog[open], [role="dialog"], [role="alertdialog"]')) return
          event.preventDefault()
          setFullscreenError('')
          try { await document.exitFullscreen() }
          catch { setFullscreenError('未能退出全屏，请重试退出全屏按钮。') }
        }
        syncFullscreen()
        document.addEventListener('fullscreenchange', syncFullscreen)
        document.addEventListener('keydown', exitOnEscape)
        return () => {
          document.removeEventListener('fullscreenchange', syncFullscreen)
          document.removeEventListener('keydown', exitOnEscape)
        }
      }, [])
      const fitScale = bounds => Math.min(1, Math.max(1, bounds.width - 32) / Math.max(1, graphWidth), Math.max(1, bounds.height - 32) / Math.max(1, graphHeight))
      const centered = (scale, fit) => ({ scale, fit, x: (sizeRef.current.width - graphWidth * scale) / 2, y: (sizeRef.current.height - graphHeight * scale) / 2 })
      const zoomAt = (value, factor, x, y) => {
        const scale = Math.max(fitScale(sizeRef.current) / 4, Math.min(4, value.scale * factor))
        return { scale, fit: false, x: x - (x - value.x) * scale / value.scale, y: y - (y - value.y) * scale / value.scale }
      }
      React.useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return undefined
        let first = true
        const measure = () => {
          const next = { width: canvas.clientWidth, height: canvas.clientHeight }
          if (!next.width || !next.height) return
          const previous = sizeRef.current
          sizeRef.current = next
          setSize(next)
          const reset = first && !viewport?.camera
          first = false
          setCamera(value => reset || value.fit ? centered(fitScale(next), true) : {
            ...value, x: value.x + (next.width - previous.width) / 2, y: value.y + (next.height - previous.height) / 2
          })
        }
        const wheel = event => {
          if (!event.ctrlKey) return
          event.preventDefault()
          event.stopPropagation()
          const rect = canvas.getBoundingClientRect()
          const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1)
          setCamera(value => zoomAt(value, Math.exp(-Math.max(-500, Math.min(500, delta)) * 0.002), event.clientX - rect.left - canvas.clientLeft, event.clientY - rect.top - canvas.clientTop))
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(canvas)
        canvas.addEventListener('wheel', wheel, { passive: false })
        return () => { observer.disconnect(); canvas.removeEventListener('wheel', wheel) }
      }, [graphWidth, graphHeight, graphKey])
      React.useEffect(() => () => {
        if (viewport) { viewport.camera = cameraRef.current; viewport.size = sizeRef.current }
      }, [viewport])
      const change = factor => setCamera(value => zoomAt(value, factor, sizeRef.current.width / 2, sizeRef.current.height / 2))
      const endDrag = event => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return
        suppressClickRef.current = drag.moved
        dragRef.current = null
        setDragging(false)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      }
      const controls = h('span', { className: 'b04-canvas-controls' },
        h('button', { type: 'button', 'aria-label': `缩小${label}`, onClick: () => change(0.8) }, '−'),
        h('span', { 'aria-label': `${label}缩放比例`, style: { minWidth: 42, textAlign: 'center' } }, `${Math.round(camera.scale * 100)}%`),
        h('button', { type: 'button', 'aria-label': `放大${label}`, onClick: () => change(1.25) }, '+'),
        h('button', { type: 'button', 'aria-label': `${label}原始大小`, onClick: () => setCamera(centered(1, false)) }, '100%'),
        h('button', { type: 'button', 'aria-label': `适应${label}画布`, onClick: () => setCamera(centered(fitScale(sizeRef.current), true)) }, '适应画布'),
        h('button', { type: 'button', 'aria-label': fullscreen ? `退出${label}全屏` : `全屏阅读${label}`, 'aria-pressed': fullscreen, disabled: fullscreenBusy, onClick: async () => {
          const element = fullscreenTarget(), exiting = Boolean(element && document.fullscreenElement === element)
          setFullscreenError('')
          if (!element || typeof (exiting ? document.exitFullscreen : element.requestFullscreen) !== 'function') {
            setFullscreenError('当前环境不支持全屏阅读。')
            return
          }
          setFullscreenBusy(true)
          try {
            if (exiting) await document.exitFullscreen()
            else await element.requestFullscreen()
            setFullscreen(document.fullscreenElement === element)
          } catch {
            setFullscreenError(exiting ? '未能退出全屏，请按 Esc 重试。' : '全屏阅读未能开启，请重试或在当前视图继续阅读。')
          } finally { setFullscreenBusy(false) }
        } }, fullscreen ? '退出全屏' : '全屏阅读'),
        fullscreenError ? h('span', { role: 'alert', className: 'pangea-fullscreen-error', style: { color: '#9c2330', flexBasis: '100%' } }, fullscreenError) : null)
      const panProps = { ref: canvasRef, className: 'pangea-graph-canvas', tabIndex: 0, style: { ...GRAPH_CANVAS_STYLE, cursor: dragging ? 'grabbing' : 'grab' }, 'aria-label': `${label}画布，Ctrl加滚轮缩放，普通滚轮滚动页面，拖拽移动`,
        onPointerDown: event => {
          if (event.button !== 0 || dragRef.current) return
          suppressClickRef.current = false
          dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, camera, moved: false }
        },
        onPointerMove: event => {
          const drag = dragRef.current
          if (!drag || drag.pointerId !== event.pointerId) return
          const dx = event.clientX - drag.x, dy = event.clientY - drag.y
          if (!drag.moved && Math.hypot(dx, dy) < 4) return
          if (!drag.moved) { drag.moved = true; event.currentTarget.setPointerCapture(event.pointerId); setDragging(true) }
          event.preventDefault()
          setCamera({ ...drag.camera, fit: false, x: drag.camera.x + dx, y: drag.camera.y + dy })
        },
        onPointerUp: endDrag, onPointerCancel: endDrag, onLostPointerCapture: endDrag,
        onPointerLeave: event => { if (!dragRef.current?.moved) endDrag(event) },
        onClickCapture: event => {
          if (suppressClickRef.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); suppressClickRef.current = false }
        } }
      const sized = tree => ({ ...tree, attrs: { ...tree.attrs, width: '100%', height: '100%', viewBox: `0 0 ${size.width} ${size.height}`, preserveAspectRatio: 'none', style: { display: 'block' } },
        children: [{ tag: 'g', attrs: { transform: `translate(${camera.x} ${camera.y}) scale(${camera.scale})` }, children: tree.children }] })
      const focus = bounds => {
        if (!bounds) return
        const size = sizeRef.current, scale = Math.min(3, (size.width - 32) / Math.max(1, bounds.width), (size.height - 32) / Math.max(1, bounds.height))
        setCamera({ x: size.width / 2 - (bounds.x + bounds.width / 2) * scale, y: size.height / 2 - (bounds.y + bounds.height / 2) * scale, scale, fit: false })
      }
      return { controls, panProps, sized, focus }
    }
    function warningList(warnings, label) {
      return warnings?.length ? h('ul', { 'aria-label': label, style: { color: '#8a5a00', fontSize: 12, margin: '6px 0', paddingLeft: 18 } },
        warnings.map((warning, index) => h('li', { key: index }, warning))) : null
    }

    function BehaviorCoverageView({ ledgers = [], onCase }) {
      const show = value => sourceFirstRecordBody(value) || '未提供'
      const lines = values => Array.isArray(values) && values.length ? values.map((value, index) => h('p', { key: index }, show(value))) : h('p', { className: 'b05-subtle' }, '未提供')
      return h('details', { className: 'b05-card', 'aria-label': '业务行为覆盖清单', 'data-view-key': 'behavior-coverage' },
        h('summary', { style: { cursor: 'pointer', fontSize: 15, fontWeight: 600 } }, '业务行为覆盖清单'),
        h('p', { className: 'b05-subtle' }, '状态来自本次分析声明；用例关联不代表已执行，也不代表实测代码覆盖率。'),
        !ledgers.length ? h('p', null, '本次记录未提供业务行为清单；已有用例与分析原文仍可查看。') : ledgers.map(ledger => h('details', { key: ledger.projection_id, 'data-view-key': `behavior-ledger:${ledger.projection_id}`, open: true },
          h('summary', null, `${ledger.unit_id || '未提供分析单元'} · ${show(ledger.scope)}`),
          h('p', null, `组合选择依据：${show(ledger.combination_strategy)}`),
          h('p', { className: 'b05-subtle' }, Object.entries(ledger.declared_counts ?? {}).map(([status, count]) => `${BEHAVIOR_STATUS_LABELS[status] || '未标注'} ${count}`).join(' · ')),
          warningList(ledger.projection_warnings, '行为清单提示'),
          Array.isArray(ledger.unresolved_dependencies) && ledger.unresolved_dependencies.length
            ? h('div', { role: 'status' }, h('strong', null, '未决依赖'), lines(ledger.unresolved_dependencies)) : null,
          h('div', { className: 'b05-table-scroll' }, h('table', { className: 'b05-case-table' },
            h('thead', null, h('tr', null, ['业务行为', '条件与约束', '预期行为', '关联用例 / 参数组合', '状态与依据'].map(label => h('th', { key: label }, label)))),
            h('tbody', null, (ledger.items ?? []).map(item => h('tr', { key: item.display_key },
              h('td', null, h('strong', null, show(item.item_id)), h('p', null, show(item.operation)),
                Array.isArray(item.source_evidence) && item.source_evidence.length ? h('details', null, h('summary', null, '来源依据'), lines(item.source_evidence)) : null),
              h('td', null, h('strong', null, '条件'), lines(item.conditions), h('strong', null, '约束'), lines(item.constraints)),
              h('td', null, show(item.expected_behavior)),
              h('td', null, item.case_links?.length ? item.case_links.map((link, index) => h('p', { key: index },
                link.target_case_id && onCase ? h('button', { type: 'button', className: 'b05-text-link', onClick: () => onCase(link) }, `${link.case_id}${link.variant_id != null ? ` / ${link.variant_id}` : ''}`)
                  : show(link.case_id ?? link.reference),
                link.issue ? h('small', { className: 'b05-subtle' }, ` · ${link.issue}`) : null)) : h('span', { className: 'b05-subtle' }, '未关联')),
              h('td', null, h('strong', null, BEHAVIOR_STATUS_LABELS[item.status] || `未标注${item.status ? `（${item.status}）` : ''}`),
                h('p', null, show(item.reason)), warningList(item.projection_warnings, '行为项提示'),
                item.projection_warnings?.length ? h('details', null, h('summary', null, '行为项原文'), h('pre', null, show(item.source_item))) : null)))))))))
    }

    function FlowComparisonView({ stability, comparison }) {
      if (!stability && !comparison) return null
      const dimensions = { source: '源码', scope: '分析范围', assets: '资料与示例', methodology: '方法论', model: '模型及已声明设置', objective: '目标与执行设置' }
      const statuses = { same: '相同', changed: '有变更', unknown: '待确认', unchanged: '结构相同', added: '新增流程', removed: '移除流程', unresolved: '对应关系待确认' }
      const comparable = { comparable: '已记录输入一致', different_inputs: '输入有变更', unknown: '输入可比性待确认' }
      return h('section', { className: 'b05-card', 'aria-label': '流程版本与差异' },
        h('h3', null, '流程版本与差异'),
        stability ? h('details', null, h('summary', null, '本次冻结输入指纹'),
          h('p', { className: 'b05-mono', style: { overflowWrap: 'anywhere' } }, stability.fingerprint || '未提供'),
          h('dl', { className: 'b05-case-kv' }, Object.entries(stability.dimension_hashes ?? {}).flatMap(([key, value]) => [h('dt', { key: `${key}-label` }, dimensions[key] || key), h('dd', { key, style: { overflowWrap: 'anywhere' } }, value)])),
          h('p', null, `模型设置记录：${({ declared: '已声明', partial: '仅部分已知', unknown: '未知' })[stability.model?.metadata_status] || '未知'}`),
          h('p', { className: 'b05-subtle' }, stability.note || '输入指纹不保证模型输出完全一致。')) : null,
        comparison ? h('div', null,
          h('p', null, `对照基线：${comparison.baseline?.run_id || '未提供'} · ${comparison.baseline?.version_id || '未提供'}`),
          h('p', { role: 'status' }, comparable[comparison.comparability?.status] || '输入可比性未记录'),
          h('p', { className: 'b05-subtle' }, comparison.comparison_scope === 'delivery'
            ? '当前显示最终交付版本的结构差异；结构对照未作语义裁决，不能据此判定变更正确。'
            : '当前显示对照复核输入版本的结构差异；正确性以复核依据为准。'),
          h('dl', { className: 'b05-case-kv' }, Object.entries(comparison.comparability?.dimensions ?? {}).flatMap(([key, value]) => [h('dt', { key: `${key}-label` }, dimensions[key] || key), h('dd', { key }, statuses[value] || value)])),
          warningList([...(comparison.warnings ?? []), ...(comparison.comparability?.notes ?? [])], '流程对照说明'),
          (comparison.flows ?? []).map((flow, index) => h('details', { key: `${flow.flow_id}:${index}` },
            h('summary', null, `${flow.flow_id || '未提供流程编号'} · ${statuses[flow.status] || flow.status || '未标注'}${flow.content_changed ? ' · 文字/依据变化待核实' : ''}`),
            ...['nodes', 'edges', 'paths'].map(key => flow[key] ? h('p', { key }, `${({ nodes: '节点', edges: '连线', paths: '路径' })[key]}：新增 ${flow[key].added?.length ?? 0}，移除 ${flow[key].removed?.length ?? 0}，变更 ${flow[key].changed?.length ?? 0}`) : null),
            flow.main_paths_changed ? h('p', null, '主路径声明有变更。') : null,
            flow.attachment_changed ? h('p', null, '主/子流程挂接有变更。') : null,
            flow.presentation_changed ? h('p', null, '展示内容有变更。') : null,
            flow.content_changed ? h('details', { open: true }, h('summary', null, '文字与依据变更（完整前后内容）'),
              h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, sourceFirstRecordBody(flow.content_changes))) : null,
            warningList(flow.warnings, '流程差异提示'),
            h('details', null, h('summary', null, '查看差异原文'), h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, sourceFirstRecordBody(flow))))))
          : h('p', { className: 'b05-subtle' }, '本次尚无可展示的流程对照结果。'))
    }

    /** Inline behavior-flow diagram rendered locally from the flow's nodes/edges/paths. */
    function FlowGraphView({ flow, highlightBranchIds = [], idPrefix = 'pf', viewport }) {
      const graph = flowGraphInput(flow)
      const identity = JSON.stringify([flow?.unit_id, flow?.flow_id, flow?.source_record?.action_id,
        flow?.source_record?.record_id, flow?.source_record?.revision, flow?.revision,
        graph.nodes, graph.edges, graph.paths, graph.layout_version, graph.main_path_ids])
      const [selection, setSelection] = React.useState({ key: '', node: '', path: '', edge: '' })
      const [expandedKey, setExpandedKey] = React.useState('')
      // A changed flow/revision never inherits a stale route or edge selection.
      const active = selection.key === identity ? selection : { node: '', path: '', edge: '' }
      const selected = active.node, pathId = active.path, expandAll = expandedKey === identity
      const layout = layoutFlow(graph, { expandAll, activePathId: pathId })
      const { controls, panProps, sized, focus } = useGraphZoom('流程图', layout.width, layout.height, flow?.flow_id, viewport)
      if (!layout.nodes.length) {
        return h('section', { className: 'pangea-flow-graph', 'aria-label': '流程图' },
          h('div', { role: 'status', className: 'pangea-diagram-caption' }, '当前流程没有可绘制节点。'), warningList(layout.warnings, '流程图提示'))
      }
      const paths = (graph.paths ?? []).filter(path => path?.path_id)
      const highlight = pathId ? pathMembers(graph, pathId) : selected ? null : branchHighlight(flow, highlightBranchIds, layout)
      const candidates = selected ? pathsForNode(graph, selected) : []
      const chooseNode = id => {
        const routes = pathsForNode(graph, id)
        const nextPath = routes.some(path => path.path_id === pathId) ? pathId : routes.length === 1 ? routes[0].path_id : ''
        setSelection({ key: identity, node: id, path: nextPath, edge: '' })
      }
      const choosePath = id => {
        const route = paths.find(path => path.path_id === id)
        setSelection({ key: identity, node: route?.node_ids?.includes(selected) ? selected : '', path: id, edge: '' })
      }
      const focusedEdgeId = active.edge
      const focusedEdge = layout.edges.find(edge => edge.edge_id === focusedEdgeId)
      const name = `${flow?.display_id || flow?.flow_id || 'flow'}`.replace(/[^\w.-]+/g, '_')
      const tree = renderFlowTree(layout, { highlight, selected, focusedEdgeId, idPrefix })
      const node = layout.nodes.find(item => item.id === selected)
      const evidence = node ? evidenceText(node.source_evidence) : []
      const selectedPath = paths.find(path => path.path_id === pathId)
      const routeLabel = path => `${path.path_id}${path.title ? ` · ${path.title}` : ''}`
      const routeIncomplete = Boolean(pathId && highlight?.warnings?.length)
      const graphWarnings = [...new Set([...layout.warnings, ...(highlight?.warnings ?? [])])]
      return h('section', { className: 'pangea-flow-graph', 'aria-label': '流程图', style: { marginTop: 12 } },
        h('div', { className: 'b04-canvas-actions', style: { flexWrap: 'wrap', margin: '8px 0' } },
          paths.length ? h('select', { 'aria-label': '高亮路径', value: pathId, onChange: event => choosePath(event.target.value) },
            h('option', { value: '' }, highlightBranchIds.length ? '所选分支' : '全部路径'),
            paths.map(path => h('option', { key: path.path_id, value: path.path_id }, routeLabel(path)))) : null,
          controls,
          h('button', { type: 'button', disabled: !pathId, onClick: () => {
            const members = new Set((graph.paths || []).find(item => item.path_id === pathId)?.node_ids || [])
            const nodes = layout.nodes.filter(item => members.has(item.id)); if (!nodes.length) return
            const x = Math.min(...nodes.map(item => item.x)), y = Math.min(...nodes.map(item => item.y))
            focus({ x, y, width: Math.max(...nodes.map(item => item.x + (item.width || item.w || 120))) - x, height: Math.max(...nodes.map(item => item.y + (item.height || item.h || 60))) - y })
          } }, '聚焦所选路径'),
          layout.collapsed.count || expandAll ? h('button', { type: 'button', onClick: () => setExpandedKey(expandAll ? '' : identity) }, expandAll ? '折叠次要节点' : '展开全部') : null,
          selected || pathId || active.edge ? h('button', { type: 'button', onClick: () => { setSelection({ key: identity, node: '', path: '', edge: '' }) } }, '清除选择') : null,
          h('button', { type: 'button', onClick: () => exportSvgTree(tree, name, 'svg', graph) }, '导出 SVG'),
          h('button', { type: 'button', onClick: () => exportSvgTree(tree, name, 'png') }, '导出 PNG')),
        graphWarnings.length ? h('details', { className: 'pangea-diagram-caption', 'aria-label': '流程图诊断' },
          h('summary', { style: { cursor: 'pointer' } }, `流程图提示 ${graphWarnings.length} 项（点击查看）`), warningList(graphWarnings, '流程图提示')) : null,
        selected ? h('div', { className: 'pangea-diagram-caption', role: 'status', 'aria-label': '节点路径选择' },
          candidates.length === 0 ? '该节点没有已声明路径；当前只显示节点，不推断完整路线。'
            : routeIncomplete ? '该路径存在结构不一致；仅高亮已核实连线，完整路线待确认。'
              : candidates.length > 1 ? `该节点属于 ${candidates.length} 条已声明路径${pathId ? '，当前高亮所选路径。' : '，请选择需要查看的一条。'}`
              : '已高亮经过该节点的唯一声明路径。',
          candidates.length > 1 ? h('div', { className: 'b04-canvas-actions', style: { flexWrap: 'wrap', marginTop: 6 } }, candidates.map(path => h('button', {
            key: path.path_id, type: 'button', 'aria-pressed': pathId === path.path_id, onClick: () => choosePath(path.path_id),
          }, routeLabel(path)))) : null) : null,
        selectedPath ? h('div', { className: 'pangea-diagram-caption', 'aria-label': '所选路径步骤' },
          h('strong', null, routeLabel(selectedPath)), h('p', null, (selectedPath.node_ids ?? []).map((id, index) =>
            `${index + 1}. ${graph.nodes?.find(item => item.id === id)?.label || id}`).join(' → '))) : null,
        h('div', { className: 'pangea-graph-body', style: { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' } },
          h('div', { ...panProps, style: { ...panProps.style, flex: '1 1 320px', minWidth: 0 } }, svgTreeToReact(sized(tree), 'svg', chooseNode, {
            select: edge => setSelection({ key: identity, node: '', path: pathId, edge }),
          })),
          node ? h('aside', { 'aria-label': '节点详情', style: { width: 240, flex: '0 0 240px', border: '1px solid #e2e7e0', borderRadius: 8, padding: 12, background: '#fff' } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8 } }, h('strong', null, node.label),
              h('button', { type: 'button', className: 'b04-link', style: { flexShrink: 0 }, 'aria-label': '关闭节点详情', onClick: () => setSelection({ key: identity, node: '', path: pathId, edge: active.edge }) }, '关闭')),
            h('small', null, `${node.id}${node.kind ? ` · ${FLOW_KIND_LABELS[node.kind] ?? node.kind}` : ''}`),
            h('p', null, node.description || '原记录未提供节点说明。'),
            evidence.length ? h('div', null, h('small', null, '源码依据'), evidence.map(location => h('p', { key: location }, h('code', null, location)))) : null) : null),
        focusedEdge ? h('div', { className: 'pangea-diagram-caption', 'aria-label': '连线详情' },
          h('strong', null, `${layout.nodes.find(item => item.id === focusedEdge.source)?.label || focusedEdge.source} → ${layout.nodes.find(item => item.id === focusedEdge.target)?.label || focusedEdge.target}`),
          h('p', null, focusedEdge.condition || '原记录未提供条件。'), h('small', null, focusedEdge.edge_id)) : null)
    }

    function diagramHtmlDocument(tree, title, data) {
      const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
      return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>body{font:14px/1.6 system-ui,sans-serif;color:#1f2937;margin:24px}main{overflow:auto;border:1px solid #dce2e8}svg{display:block}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f8fafc;padding:16px}summary{cursor:pointer}</style><h1>${escape(title)}</h1><main>${toSvgString(tree)}</main><details open><summary>分析数据与源码依据</summary><pre>${escape(JSON.stringify(data, null, 2))}</pre></details></html>`
    }
    function exportDiagramHtml(tree, name, title, data) {
      downloadBlob(new Blob([diagramHtmlDocument(tree, title, data)], { type: 'text/html;charset=utf-8' }), `${name}.html`)
    }
    function diagramRecordDetails(raw) {
      return raw == null ? null : h('details', { className: 'pangea-diagram-caption' }, h('summary', null, '查看图表分析原文'),
        h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, sourceFirstRecordBody(raw)))
    }
    function diagramNotes(notes) {
      return warningList(Array.isArray(notes) ? notes.filter(item => typeof item === 'string') : [], '图表说明与未决项')
    }
    function diagramSource(location, title, onSource) {
      return onSource ? h('button', { type: 'button', className: 'b04-link', onClick: () => onSource(location, title) }, location) : h('code', null, location)
    }

    /** Only authored interactions are rendered; opening this view never starts an Agent. */
    function SequenceGraphView({ flow, viewport, onSource }) {
      const normalized = normalizeSequence(flow?.sequence)
      const graph = normalized.graph
      const identity = JSON.stringify([flow?.flow_id, flow?.revision, flow?.source_record?.revision, flow?.sequence])
      const [selection, setSelection] = React.useState({ identity: '', id: '' })
      const selected = selection.identity === identity ? selection.id : ''
      const layout = layoutSequence(graph)
      const { controls, panProps, sized } = useGraphZoom('时序图', layout.width, layout.height, identity, viewport)
      const tree = renderSequenceTree(layout, { selectedMessage: selected, idPrefix: 'sequence' })
      const message = graph?.messages?.find(item => item.id === selected)
      const participant = id => graph?.participants?.find(item => item.id === id)?.label || id
      const unsequenced = graph?.unsequenced_messages ?? []
      const drawable = Boolean(graph?.messages?.length) && !['unknown', 'not_applicable', 'invalid'].includes(normalized.status)
      const statusText = normalized.status === 'not_applicable' ? '本次分析声明此流程不适用时序图。'
        : normalized.status === 'unknown' ? flow?.sequence ? '本次分析尚未确认时序交互，暂不绘制。' : '本次分析未提供时序交互数据。重新分析时可由 Agent 随流程一并提供。'
        : normalized.status === 'invalid' ? unsequenced.length ? '分支关系尚未明确；可读交互列在下方，暂不连成时序图。' : '本次时序交互数据无法绘制，可查看分析原文。'
        : normalized.status === 'partial' ? '时序图部分可用；未确认或无法绘制的内容见下方说明。'
        : !drawable ? '本次分析未记录可绘制的交互消息。' : ''
      return h('section', { className: 'pangea-sequence-graph', 'aria-label': '时序图', style: { padding: '8px 12px' } },
        statusText ? h('p', { role: 'status' }, statusText) : null,
        warningList(normalized.errors, '时序图结构问题'),
        diagramNotes(graph?.notes),
        drawable ? h(React.Fragment, null,
          h('div', { className: 'b04-canvas-actions', style: { margin: '8px 0', flexWrap: 'wrap' } }, controls,
            h('button', { type: 'button', onClick: () => exportSvgTree(tree, 'sequence', 'svg') }, '导出 SVG'),
            h('button', { type: 'button', onClick: () => exportSvgTree(tree, 'sequence', 'png') }, '导出 PNG'),
            h('button', { type: 'button', onClick: () => exportDiagramHtml(tree, 'sequence', graph.title || flow?.title || '时序图', flow.sequence) }, '导出 HTML')),
          h('div', { className: 'pangea-graph-body' },
            h('div', panProps, svgTreeToReact(sized(tree), 'svg', null, null, id => setSelection({ identity, id }))),
            message ? h('aside', { 'aria-label': '交互详情', className: 'pangea-diagram-caption' },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8 } },
              h('strong', null, `${participant(message.from)} → ${participant(message.to)}`),
              h('button', { type: 'button', onClick: () => setSelection({ identity, id: '' }) }, '关闭')),
            h('p', null, message.label),
            h('small', null, `${message.id} · ${{ call: '调用', return: '返回', async: '异步', self: '自身处理' }[message.kind] || message.kind}`),
            evidenceText(message.source_evidence).map(location => h('p', { key: location }, diagramSource(location, `时序交互 · ${message.label}`, onSource)))) : null)) : null,
        unsequenced.length ? h('section', { className: 'pangea-diagram-caption', 'aria-label': '分支关系待确认的交互' },
          h('strong', null, `保留的交互记录（${unsequenced.length} 条）`),
          h('p', null, '这些交互的分支归属或先后关系尚未明确。以下逐条保留原记录中的双方与内容，不表示它们依次执行。'),
          h('ul', null, unsequenced.map(item => h('li', { key: item.id },
            h('strong', null, `${participant(item.from)} → ${participant(item.to)}`), h('p', null, item.label),
            evidenceText(item.source_evidence).map(location => h('p', { key: location }, diagramSource(location, `待确认交互 · ${item.label}`, onSource))))))) : null,
        diagramRecordDetails(flow?.sequence))
    }

    function FunctionVariablesView({ flow, viewport, onSource, repositoryId }) {
      const raw = flow?.call_graph
      let authored = raw
      if (typeof raw === 'string') { try { authored = JSON.parse(raw) } catch { /* Structural warnings below retain the original record. */ } }
      const checked = validateCallGraph(authored)
      const declared = authored && typeof authored === 'object' ? authored.status : ''
      const statusText = !raw ? '本次分析未提供函数与变量关系数据。重新分析时可由 Agent 随流程一并提供。'
        : declared === 'not_applicable' ? '本次分析声明此流程不适用函数与变量图。'
        : declared === 'unknown' ? '本次分析尚未确认函数与变量关系，暂不绘制。'
        : declared === 'partial' ? '函数与变量关系部分可用；未确认的内容见下方说明。' : ''
      return h('section', { 'aria-label': '函数与变量图' },
        statusText ? h('p', { role: 'status', className: 'pangea-diagram-caption' }, statusText) : null,
        diagramNotes(checked.graph?.notes),
        raw && !['unknown', 'not_applicable'].includes(declared) ? h(CallGraphView, {
          key: JSON.stringify([flow?.flow_id, flow?.revision, flow?.source_record?.revision, raw]),
          graph: checked.graph, status: checked.status, errors: checked.errors, authoredStatus: declared,
          raw, viewport, onSource, repositoryId,
        }) : null,
        diagramRecordDetails(raw))
    }

    /** call-graph-v1 view: function nodes, merged call edges (×N) and per-function variable flow. */
    function CallGraphView({ graph, status = 'ok', errors = [], svgUrl = '', authoredStatus = '', raw, viewport, onSource, repositoryId }) {
      const identity = JSON.stringify([graph, authoredStatus])
      const [selection, setSelection] = React.useState({ identity: '', id: '', variable: '' })
      const selected = selection.identity === identity ? selection.id : ''
      const variable = selection.identity === identity ? selection.variable : ''
      const layout = layoutCallGraph(graph)
      const captions = [authoredStatus === 'partial' ? '本次分析声明：函数与变量关系部分可用' : '', ...errors, ...(graph?.notes ?? []),
        ...(graph?.variables ?? []).map(item => `${item.function} · 变量 ${item.name}：读取 ${item.reads.join(', ') || '未记录'}；计算 ${item.compute || '未记录'}；写入 ${item.writes || '未记录'}${item.line ? `；行 ${item.line}` : ''}`)].filter(Boolean)
      const height = layout.height
      const { controls, panProps, sized } = useGraphZoom('函数调用图', layout.width, height, identity, viewport)
      const notice = errors.length ? h('div', { role: 'status', 'aria-label': '调用图结构问题', className: 'pangea-diagram-caption' },
        h('strong', null, status === 'invalid' ? '调用图无法绘制。' : '调用图部分可用，部分结构需要确认。'), warningList(errors, '调用图结构问题明细')) : null
      if (!layout.nodes.length) return h('section', { 'aria-label': '函数调用图' }, notice, h('p', { role: 'status' }, '当前记录没有可绘制函数。'))
      const fn = (graph?.functions ?? []).find(item => item.id === selected)
      const variables = (graph?.variables ?? []).filter(item => item.function === selected)
      const active = variables.find(item => item.name === variable)
      const highlightCalls = active ? callsForVariable(graph, selected, active) : null
      const baseTree = renderCallGraphTree(layout, { selected, highlightCalls, idPrefix: 'cg' })
      // Keep variable semantics available in standalone SVG tooltips and metadata.
      const annotate = node => {
        if (!node || typeof node !== 'object') return node
        const id = node.attrs?.['data-node-id']
        const variables = id ? (graph?.variables ?? []).filter(item => item.function === id) : []
        return { ...node, children: (node.children ?? []).map(child => variables.length && child?.tag === 'title'
          ? { ...child, children: [...child.children, ...variables.map(item => `\n变量 ${item.name}：读取 ${item.reads.join(', ') || '未记录'}；计算 ${item.compute || '未记录'}；写入 ${item.writes || '未记录'}${item.line ? `；行 ${item.line}` : ''}`)] }
          : annotate(child)) }
      }
      const annotatedTree = annotate(baseTree)
      const tree = { ...baseTree, attrs: { ...baseTree.attrs, height, viewBox: `0 0 ${layout.width} ${height}` },
        children: [{ tag: 'metadata', children: [JSON.stringify(raw ?? { ...graph, status: authoredStatus || status, errors })] }, ...annotatedTree.children] }
      const choose = id => setSelection({ identity, id, variable: '' })
      const source = item => {
        const file = item?.file
        const line = Number(item?.line)
        if (!hasText(file) || !Number.isSafeInteger(line) || line < 1) return '未提供完整源码位置'
        const qualified = /^([^:/\\]+):(.+)$/.exec(file)
        const location = qualified && !/^[A-Za-z]:[\\/]/.test(file) ? `${file}:${line}`
          : hasText(repositoryId) && !/^(?:[\\/]|[A-Za-z]:)/.test(file) ? `${repositoryId}:${file}:${line}` : null
        return location ? diagramSource(location, `函数与变量 · ${fn?.label || item.from || ''}`, onSource) : '未确认当前 Run 源码仓库'
      }
      const cell = { padding: 4, borderBottom: '1px solid #eef1ec', verticalAlign: 'top' }
      return h('section', { className: 'pangea-call-graph', 'aria-label': '函数调用图', style: { padding: '8px 12px' } }, notice,
        h('div', { className: 'b04-canvas-actions', style: { margin: '8px 0', flexWrap: 'wrap' } }, controls,
          h('span', { style: { fontSize: 12, color: '#64748b' } }, '方框：函数 · 六边形：宏 · 虚线圆角：外部函数 · ×N：同一调用出现 N 次'),
          svgUrl ? h('a', { className: 'b04-link', href: svgUrl, download: 'call-graph.svg' }, '导出 SVG')
            : h('button', { type: 'button', onClick: () => exportSvgTree(tree, 'call-graph', 'svg') }, '导出 SVG'),
          h('button', { type: 'button', onClick: () => exportSvgTree(tree, 'call-graph', 'png') }, '导出 PNG'),
          h('button', { type: 'button', onClick: () => exportDiagramHtml(tree, 'call-graph', graph?.title || '函数与变量关系', raw ?? { ...graph, status: authoredStatus || status, errors }) }, '导出 HTML')),
        h('div', panProps, svgTreeToReact(sized(tree), 'svg', choose)),
        captions.length ? h('details', { className: 'pangea-diagram-notes' }, h('summary', null, '函数与变量说明'), captions.map((value, index) => h('p', { key: index }, value))) : null,
        fn ? h('div', { 'aria-label': '函数变量流', style: { marginTop: 12 } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8 } }, h('strong', null, fn.label),
            h('button', { type: 'button', className: 'b04-link', onClick: () => choose('') }, '关闭')),
          h('p', null, source(fn)),
          fn.signature ? h('code', { style: { display: 'block', margin: '4px 0 8px' } }, fn.signature) : null,
          variables.length ? h('table', { 'aria-label': '变量表', style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
            h('thead', null, h('tr', null, ['变量', '读取', '计算', '写入', '行号'].map(label => h('th', { key: label, style: { ...cell, textAlign: 'left' } }, label)))),
            h('tbody', null, variables.map((item, index) => h('tr', { key: `${item.name}:${index}`, style: item.name === variable ? { background: '#eef2ff' } : null },
              h('td', { style: cell }, h('button', { type: 'button', className: 'b04-link', 'aria-pressed': item.name === variable, 'aria-label': `高亮变量 ${item.name}`,
                onClick: () => setSelection({ identity, id: selected, variable: item.name === variable ? '' : item.name }) }, item.name)),
              h('td', { style: cell }, item.reads.join(', ') || '—'), h('td', { style: cell }, item.compute || '—'),
              h('td', { style: cell }, item.writes || '—'), h('td', { style: cell }, item.line ?? '—')))))
            : h('p', { style: { fontSize: 12, color: '#64748b' } }, '该函数没有记录变量流。'),
          h('div', { 'aria-label': '相关调用' }, (graph?.calls ?? []).filter(call => call.from === selected || call.to === selected).map((call, index) =>
            h('p', { key: index }, h('strong', null, `${call.from} → ${call.to}`), ` · 参数：${call.args.join(', ') || '未记录'} · 返回：${call.returns || '未记录'} · `, source(call))))) : null)
    }

    function CoverageBrowser({ cwd, task, runId, target, revision, acquisition, gaps, flows, filters, onFilter, renderLinks, onReload, onNewQuery }) {
      gaps = Array.isArray(gaps) ? gaps : []
      const [scopeStatus, setScopeStatus] = React.useState('')
      const [flowId, setFlowId] = React.useState('')
      const [position, setPosition] = React.useState({ key: '', cursor: 0 })
      const [response, setResponse] = React.useState(null)
      const [queryDraft, setQueryDraft] = React.useState(acquisition?.query_input ?? task?.coverage_input?.query ?? {})
      const [refreshing, setQueryBusy] = React.useState(false)
      const [refreshError, setRefreshError] = React.useState('')
      const [refreshVersion, setRefreshVersion] = React.useState(0)
      async function refreshQuery() {
        setQueryBusy(true); setRefreshError('')
        try {
          await requestWorkbenchAction({ cwd, action: 'coverage-refresh', payload: { task_id: task.task_id, run_id: runId, query: queryDraft } })
          setRefreshVersion(value => value + 1)
          await onReload?.()
        } catch (error) { setRefreshError(error.message) }
        finally { setQueryBusy(false) }
      }
      const filterKey = JSON.stringify([cwd, task?.task_id, runId, filters, scopeStatus, flowId])
      const cursor = position.key === filterKey ? position.cursor : 0
      const requestKey = JSON.stringify([filterKey, cursor, revision, acquisition?.status, refreshVersion])
      React.useEffect(() => {
        if (!task?.task_id || task.run_id !== runId) return undefined
        let active = true
        requestWorkbenchAction({ cwd, action: 'coverage-page', payload: { task_id: task.task_id, run_id: runId,
          cursor, limit: 50, ...filters, scope_status: scopeStatus, flow_id: flowId } })
          .then(result => {
            if (active && result.run_id === runId) setResponse({ key: requestKey, page: result.page })
          }).catch(error => { if (active) setResponse({ key: requestKey, error: error.message }) })
        return () => { active = false }
      }, [requestKey])
      const bound = task?.task_id && task.run_id === runId
      const result = response?.key === requestKey ? response : null
      const page = bound ? result?.page : acquisition
      const summary = page?.scope_summary ?? acquisition?.scope_summary
      const items = bound ? page?.items ?? [] : gaps.filter(item =>
        (!scopeStatus || (item.scope_status || 'unclassified') === scopeStatus)
        && (!flowId || idList(item.linked_flow_ids).includes(flowId))
        && ['kind', 'source', 'analysis_status', 'disposition'].every(key => !filters[key] || item[key] === filters[key])
        && (!filters.query || JSON.stringify([item.gap_id, item.file_path, item.raw]).toLowerCase().includes(filters.query.toLowerCase())))
      const options = (label, value, change, choices) => h('select', { 'aria-label': label, style: styles.search, value,
        onChange: e => change(e.target.value) }, h('option', { value: '' }, label), choices.map(([id, title]) => h('option', { key: id, value: id }, title)))
      const observed = key => [...new Set([...gaps, ...(page?.items ?? []), ...(key === 'source' ? acquisition?.sources ?? [] : [])]
        .map(g => g[key]).filter(value => typeof value === 'string' && value))].map(v => [v, v])
      const display = value => value && typeof value === 'object' ? JSON.stringify(value) : value
      return h(React.Fragment, null,
        task?.coverage_input?.kind === 'query' ? h('details', { style: styles.card }, h('summary', null, '查询对象与重新获取'),
          [['product', '产品'], ['c_version', 'C 版本'], ['module', '模块'], ['b_version', 'B 版本（可选）']].map(([key, label]) => h('label', { key }, label,
            h('input', { style: styles.search, value: queryDraft[key] || '', onChange: event => setQueryDraft(value => ({ ...value, [key]: event.target.value })) }))),
          h('div', { style: styles.itemMeta }, '产品与版本分别传给查询 Skill。修正原任务前请停止分析；已进入下游分析的任务请基于修正输入新建。'),
          h('button', { type: 'button', style: styles.button, disabled: refreshing, onClick: refreshQuery }, refreshing ? '正在重新获取…' : '修正并重新获取'),
          h('button', { type: 'button', style: styles.button, disabled: refreshing, onClick: () => onNewQuery?.(queryDraft) }, '基于修正输入新建分析'),
          refreshError ? h('div', { role: 'alert', style: styles.error }, refreshError) : null) : null,
        h('div', { style: styles.card }, field('本次分析目标', target),
          h('div', { style: styles.itemMeta }, '报告可能覆盖更多模块；范围归属由分析依据说明。关联用例只表示已设计，不表示已执行或覆盖率提升。')),
        acquisition ? h('div', { style: styles.card }, field('输入获取状态', acquisition.status), field('输入说明', acquisition.message),
          field('实际查询参数', JSON.stringify(acquisition.query_input)), field('平台匹配对象', acquisition.query_resolution ? JSON.stringify(acquisition.query_resolution) : '查询 Skill 未提供'),
          field('解析记录 / 未知 / 待定位', `${acquisition.record_count ?? '—'} / ${acquisition.unknown_count ?? 0} / ${acquisition.unlocated_count ?? 0}`),
          acquisition.tables?.length ? h('details', null, h('summary', null, '工作表与字段映射'), h('pre', { style: styles.source }, JSON.stringify(acquisition.tables, null, 2))) : null,
          stringList('缺失来源', acquisition.missing), stringList('输入限制', acquisition.warnings),
          h('table', { style: { width: '100%', textAlign: 'left' } },
            h('thead', null, h('tr', null, ['来源', '指标', '已覆盖 / 总数', '报告覆盖率'].map(label => h('th', { key: label }, label)))),
            h('tbody', null, (acquisition.sources ?? []).flatMap((source, index) => ['functions', 'lines', 'branches'].filter(kind => source[kind]).map(kind => h('tr', { key: `${index}:${kind}` },
              h('td', null, source.source), h('td', null, kind), h('td', null, `${source[kind].covered} / ${source[kind].total}`), h('td', null, typeof source[kind].rate === 'number' ? `${(source[kind].rate * 100).toFixed(2)}%` : '未提供'))))))) : null,
        summary ? h('div', { style: styles.card, 'aria-label': '覆盖缺口范围统计' },
          field('输入缺口总数', summary.total), h('div', { style: styles.grid }, Object.entries(COVERAGE_SCOPE_LABELS).map(([key, label]) => h('div', { key }, field(label, summary[key])))),
          field('范围内已关联用例的缺口', summary.designed_in_scope)) : h('div', { style: styles.itemMeta }, '范围处置尚未记录。'),
        stringList('追溯待核对', page?.traceability_warnings ?? acquisition?.traceability_warnings),
        h('input', { 'aria-label': '搜索覆盖缺口', style: styles.search, value: filters.query, placeholder: '搜索全部输入的文件、函数或缺口编号', onChange: e => onFilter('query', e.target.value) }),
        h('div', { style: styles.formGrid },
          options('全部范围', scopeStatus, setScopeStatus, Object.entries(COVERAGE_SCOPE_LABELS)),
          options('全部业务流程', flowId, setFlowId, flows.map(f => [f.flow_id, `${f.flow_id} · ${f.title || ''}`])),
          options('全部类型', filters.kind, value => onFilter('kind', value), ['function', 'line', 'branch'].map(v => [v, v])),
          options('全部来源', filters.source, value => onFilter('source', value), observed('source')),
          options('全部分析状态', filters.analysis_status, value => onFilter('analysis_status', value), observed('analysis_status')),
          options('全部补测处置', filters.disposition, value => onFilter('disposition', value), observed('disposition'))),
        result?.error ? h('div', { role: 'alert', style: styles.error }, result.error) : bound && !page ? h('div', { style: styles.itemMeta }, '读取当前页覆盖缺口…') : null,
        h('div', { style: styles.itemMeta }, bound ? `筛选 ${page?.total ?? '—'} 条 · 当前 ${items.length} 条；包含尚未发布分析的原始缺口。` : '当前显示已发布缺口，未记录不表示全部覆盖。'),
        items.map(item => h('details', { key: item.gap_id, style: styles.card },
          h('summary', null, `${item.gap_id} · ${COVERAGE_SCOPE_LABELS[item.scope_status] || '未判定'} · ${item.file_path} · ${item.kind}`),
          field('范围依据', display(item.scope_reason)), stringList('范围证据', item.scope_evidence_ids),
          field('实测状态', item.coverage_status), field('原始记录', JSON.stringify(item.raw)), field('来源', item.source),
          field('源码位置', display(item.source_location)), field('分析状态', item.analysis_status), field('补测处置', item.disposition),
          field('触发路径', display(item.trigger_path)), field('保护条件', display(item.guard_conditions)), field('外部结果', display(item.external_result)),
          field('未决项', display(item.uncertainties)), renderLinks(item))),
        bound ? h('div', { style: styles.chips },
          h('button', { type: 'button', style: styles.button, disabled: cursor === 0, onClick: () => setPosition({ key: filterKey, cursor: Math.max(0, cursor - 50) }) }, '上一页'),
          h('span', null, `第 ${Math.floor(cursor / 50) + 1} 页`),
          h('button', { type: 'button', style: styles.button, disabled: !page || page.next_cursor == null, onClick: () => setPosition({ key: filterKey, cursor: page.next_cursor }) }, '下一页')) : null)
    }

    function panelScrollElements(root) {
      const elements = new Set()
      for (let element = root; element; element = element.parentElement) elements.add(element)
      if (root?.ownerDocument?.scrollingElement) elements.add(root.ownerDocument.scrollingElement)
      return [...elements]
    }
    function capturePanelViewport(root) {
      if (!root) return null
      const position = element => ({ element, top: element.scrollTop, left: element.scrollLeft })
      return {
        scroll: panelScrollElements(root).map(position),
        details: [...root.querySelectorAll('details')].map((element, index) => ({
          key: element.getAttribute('data-view-key') || `details:${index}`, open: element.open,
        })),
        localScroll: [...root.querySelectorAll('[data-scroll-key]')].map(element => ({
          key: element.getAttribute('data-scroll-key'), top: element.scrollTop, left: element.scrollLeft,
        })),
      }
    }
    function restorePanelViewport(root, viewport) {
      if (!root || !viewport) return
      // Restore expanded content first, otherwise the shorter page clamps scrollTop.
      const details = new Map(viewport.details.map(item => [item.key, item.open]))
      ;[...root.querySelectorAll('details')].forEach((element, index) => {
        const key = element.getAttribute('data-view-key') || `details:${index}`
        if (details.has(key)) element.open = details.get(key)
      })
      const localScroll = new Map(viewport.localScroll.map(item => [item.key, item]))
      for (const element of root.querySelectorAll('[data-scroll-key]')) {
        const saved = localScroll.get(element.getAttribute('data-scroll-key'))
        if (saved) { element.scrollTop = saved.top; element.scrollLeft = saved.left }
      }
      for (const { element, top, left } of viewport.scroll) {
        if (element.isConnected !== false) { element.scrollTop = top; element.scrollLeft = left }
      }
    }

    function PangeaPanel({ ctx, scope, visible, initialScreen = 'overview', pageMode = 'analysis' }) {
      const cwd = scope?.cwd
      const [snapshot, setSnapshot] = React.useState(undefined)
      const [workbench, setWorkbench] = React.useState(undefined)
      const [error, setError] = React.useState(undefined)
      const [workbenchError, setWorkbenchError] = React.useState(undefined)
      const [selectedRun, setSelectedRun] = React.useState(undefined)
      const [selectedTaskId, setSelectedTaskId] = React.useState(pageMode === 'analysis' ? ctx?.pangea?.getSelectedTaskId?.() : undefined)
      const taskActionPendingRef = React.useRef(new Map())
      const taskActionScopeRef = React.useRef(null)
      const [taskQuery, setTaskQuery] = React.useState('')
      const [taskStatus, setTaskStatus] = React.useState('全部')
      const [loading, setLoading] = React.useState(false)
      const [workbenchLoading, setWorkbenchLoading] = React.useState(false)
      const [repositoryState, setRepositoryState] = React.useState(undefined)
      const [repositoryLoading, setRepositoryLoading] = React.useState(false)
      const [repositoryForm, setRepositoryForm] = React.useState({ sourcePath: '', repositoryName: '' })
      const [repositoryImporting, setRepositoryImporting] = React.useState(false)
      const [repositoryError, setRepositoryError] = React.useState('')
      const [runCursor, setRunCursor] = React.useState(0)
      const [screen, setScreen] = React.useState({ type: initialScreen })
      const panelRootRef = React.useRef(null)
      const pendingViewportRef = React.useRef(null)
      const needsRunSnapshot = pageMode === 'analysis'
      const panelScopeRef = React.useRef({ cwd, pageMode, screen })
      panelScopeRef.current = { cwd, pageMode, screen }
      const repositoryRequestRef = React.useRef(0)
      const repositoryImportRef = React.useRef(0)
      const [history, setHistory] = React.useState([])
      const [riskQuery, setRiskQuery] = React.useState('')
      const [riskSeverity, setRiskSeverity] = React.useState('全部')
      const [caseQuery, setCaseQuery] = React.useState('')
      const [evidenceQuery, setEvidenceQuery] = React.useState('')
      const [actionNotice, setActionNotice] = React.useState(undefined)
      const [sourcePreview, setSourcePreview] = React.useState({ key: '', status: 'idle' })
      const [riskEvidenceSelection, setRiskEvidenceSelection] = React.useState({ riskKey: '', evidenceKey: '' })
      const [riskClaimSelection, setRiskClaimSelection] = React.useState({ riskKey: '', claim: '' })
      const [riskEvidenceSetSelection, setRiskEvidenceSetSelection] = React.useState({ riskKey: '', evidenceKeys: [] })
      const [environments, setEnvironments] = React.useState([])
      const [selectedEnvironment, setSelectedEnvironment] = React.useState('')
      const [selectedCaseIds, setSelectedCaseIds] = React.useState([])
      const [launching, setLaunching] = React.useState(false)
      const [environmentForm, setEnvironmentForm] = React.useState(emptyEnvironmentForm)
      const [environmentTests, setEnvironmentTests] = React.useState({ host: { state: 'idle' }, array: { state: 'idle' } })
      const [createForm, setCreateForm] = React.useState({ repository: '', target: '', objective: '', source_scope_text: '', asset_ids: [], scenario: 'module-analysis', coverage_kind: 'query', coverage_path: '', coverage_product: '', coverage_version: '', coverage_b_version: '', coverage_module: '', mode: 'depth', provider_id: '', model_route_key: '', agent_model: '' })
      React.useEffect(() => {
        if (!cwd || screen.type !== 'create') return
        try {
          const saved = JSON.parse(window.localStorage?.getItem(`pangea-execution:${cwd}`) ?? '{}')
          if (saved.provider_id) setCreateForm(form => form.source_task_id ? form : ({ ...form, provider_id: saved.provider_id, agent_model: saved.agent_model ?? '', model_route_key: '' }))
        } catch {}
      }, [cwd, screen.type])
      React.useEffect(() => {
        if (!cwd || screen.type !== 'create' || !createForm.provider_id) return
        try { window.localStorage?.setItem(`pangea-execution:${cwd}`, JSON.stringify({ provider_id: createForm.provider_id, agent_model: createForm.agent_model })) } catch {}
      }, [cwd, screen.type, createForm.provider_id, createForm.agent_model])

      const [assetCatalog, setAssetCatalog] = React.useState(null)
      const [assetCatalogLoading, setAssetCatalogLoading] = React.useState(false)
      const [assetCatalogError, setAssetCatalogError] = React.useState('')
      const [assetSelectorOpen, setAssetSelectorOpen] = React.useState(false)
      const [creatingRun, setCreatingRun] = React.useState(false)
      const [launchDiagnosticsOpen, setLaunchDiagnosticsOpen] = React.useState(false)
      const [flowQuery, setFlowQuery] = React.useState('')
      const [runDraft, setRunDraft] = React.useState(ctx?.pangea?.getRunDraft?.() ?? { requestId: 0, assetIds: [] })
      const [assetPage, setAssetPage] = React.useState(1)
      const [assetQuery, setAssetQuery] = React.useState('')
      const [assetQueryDraft, setAssetQueryDraft] = React.useState('')
      const [assetType, setAssetType] = React.useState('')
      const [assetRepositoryOnly, setAssetRepositoryOnly] = React.useState(false)
      const [assetRefresh, setAssetRefresh] = React.useState(0)
      const [assetLabels, setAssetLabels] = React.useState({})
      const [coverageQueryBusy, setCoverageQueryBusy] = React.useState(false)
      const [coverageQueryResult, setCoverageQueryResult] = React.useState(null)
      const coverageRequestKey = JSON.stringify([createForm.repository, createForm.coverage_product, createForm.coverage_version, createForm.coverage_module, createForm.coverage_recursive, createForm.coverage_source, createForm.coverage_b_version, createForm.coverage_path])
      const coverageRequestRef = React.useRef(coverageRequestKey)
      coverageRequestRef.current = coverageRequestKey
      React.useEffect(() => {
        if (coverageQueryResult?.selection_key && coverageQueryResult.selection_key !== coverageRequestKey) {
          const staleId = coverageQueryResult.asset?.asset_id
          setCreateForm(value => ({ ...value, asset_ids: value.asset_ids.filter(id => id !== staleId) }))
          setCoverageQueryResult(null)
        }
      }, [coverageRequestKey, coverageQueryResult])
      const [flowSelection, setFlowSelection] = React.useState('')
      const [branchSelection, setBranchSelection] = React.useState('')
      const [branchFilter, setBranchFilter] = React.useState('')
      const [diagramViews, setDiagramViews] = React.useState([])
      const [diagramHistoryScope, setDiagramHistoryScope] = React.useState('')
      const diagramHistoryRequest = React.useRef(0)
      const [diagramSelection, setDiagramSelection] = React.useState('')
      const [diagramBusy, setDiagramBusy] = React.useState(false)
      const [gapQuery, setGapQuery] = React.useState('')
      const [gapKind, setGapKind] = React.useState('')
      const [gapSource, setGapSource] = React.useState('')
      const [gapStatus, setGapStatus] = React.useState('')
      const [gapDisposition, setGapDisposition] = React.useState('')
      const [flowReader, setFlowReader] = React.useState({ scope: '', view: 'reader', step: '', query: '', page: 1 })
      const [diagramError, setDiagramError] = React.useState('')
      const [conversationPending, setConversationPending] = React.useState('')
      const [assetDetailStatus, setAssetDetailStatus] = React.useState({})
      const [flowBranchDetail, setFlowBranchDetail] = React.useState('')
      const [flowSource, setFlowSource] = React.useState(null)
      const [flowBranchSource, setFlowBranchSource] = React.useState(null)
      const [sourceDrawerOpen, setSourceDrawerOpen] = React.useState(false)
      const [sourceRetry, setSourceRetry] = React.useState(0)
      const [caseExportOpen, setCaseExportOpen] = React.useState(false)
      const [caseExportFormat, setCaseExportFormat] = React.useState('xlsx')
      const [caseExportBusy, setCaseExportBusy] = React.useState(false)
      const [caseExportError, setCaseExportError] = React.useState('')
      const [homeRefreshed, setHomeRefreshed] = React.useState(false)
      const [flowHighlight, setFlowHighlight] = React.useState({ scope: '', ids: [] })
      const [flowReaders, setFlowReaders] = React.useState({})
      const flowPanelsRef = React.useRef({})
      const [derivation, setDerivation] = React.useState(null)
      const [taskActionDialog, setTaskActionDialog] = React.useState(null)
      const [taskActions, setTaskActions] = React.useState({})
      const [analysisAgentModels, setAnalysisAgentModels] = React.useState({ status: 'idle' })
      const [analysisAgentModelRefresh, setAnalysisAgentModelRefresh] = React.useState(0)
      const analysisProviderRegistered = workbench?.acp_providers?.some(item => item.id === createForm.provider_id && item.registered === true) === true
      React.useEffect(() => {
        if (!visible || screen.type !== 'create' || !cwd || !createForm.provider_id || !analysisProviderRegistered) {
          setAnalysisAgentModels({ status: 'idle' })
          return undefined
        }
        return loadAnalysisAgentModels({ providerId: createForm.provider_id, cwd, onState: setAnalysisAgentModels })
      }, [cwd, visible, screen.type, createForm.provider_id, analysisProviderRegistered, analysisAgentModelRefresh])
      React.useEffect(() => {
        if (!caseExportOpen || typeof document === 'undefined') return
        const previous = document.activeElement
        return () => { if (previous?.isConnected) previous.focus?.({ preventScroll: true }) }
      }, [caseExportOpen])
      const refreshAnalysisAgentModels = () => {
        setAnalysisAgentModels({ cwd, provider_id: createForm.provider_id, status: 'loading' })
        setAnalysisAgentModelRefresh(value => value + 1)
      }

      const derivationRequestRef = React.useRef(0)
      const derivationSubmitRef = React.useRef(false)
      const derivationScopeRef = React.useRef('')
      derivationScopeRef.current = JSON.stringify([cwd, selectedTaskId, selectedRun])
      React.useEffect(() => {
        if (!flowSource) return undefined
        const onKeyDown = event => { if (event.key === 'Escape') setFlowSource(null) }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [Boolean(flowSource)])
      const conversationActionRef = React.useRef(false)
      const requestRef = React.useRef({ sequence: 0, controller: null })
      const workbenchRequestRef = React.useRef({ sequence: 0, controller: null })
      const snapshotRef = React.useRef(undefined)
      const snapshotFingerprintRef = React.useRef('')
      const handledRunDraftRequest = React.useRef(0)
      const noticeTimerRef = React.useRef(undefined)
      const assetWorkspaceRef = React.useRef(cwd)
      const taskItems = workbench?.tasks?.items ?? []
      const selectedTask = taskItems.find(item => item.task_id === selectedTaskId)
      taskActionScopeRef.current = { cwd, pageMode, visible, selectedTaskId, screen: screen.type }
      React.useEffect(() => {
        setTaskActionDialog(null)
        setTaskActions({})
      }, [cwd, pageMode])
      React.useEffect(() => { if (!visible) setTaskActionDialog(null) }, [visible])
      React.useEffect(() => {
        ++derivationRequestRef.current
        setDerivation(null)
      }, [cwd, selectedTaskId, selectedRun])
      const noticeScopeKey = JSON.stringify([cwd, pageMode, screen.type, selectedTask?.task_id, selectedTask?.attempt_id])
      React.useEffect(() => { setActionNotice(undefined) }, [noticeScopeKey])

      const selectedDataRoot = selectedTask?.data_root
      const snapshotSelectionKey = JSON.stringify([cwd ?? '', selectedTaskId ?? '', selectedRun === undefined ? '__auto__' : selectedRun ?? '__none__', normalizedPathIdentity(selectedDataRoot)])

      React.useEffect(() => {
        if (!visible) return undefined
        document.body.setAttribute('data-pangea-product-mode', pageMode)
        return () => {
          if (document.body.getAttribute('data-pangea-product-mode') === pageMode) {
            document.body.removeAttribute('data-pangea-product-mode')
          }
        }
      }, [visible, pageMode])

      const load = React.useCallback(async ({ foreground = false } = {}) => {
        if (!cwd) {
          requestRef.current.controller?.abort()
          snapshotRef.current = undefined
          snapshotFingerprintRef.current = ''
          setSnapshot(undefined)
          setError('当前会话没有工作区路径，无法定位 pangea-data。')
          return undefined
        }
        const sequence = ++requestRef.current.sequence
        requestRef.current.controller?.abort()
        const controller = new AbortController()
        requestRef.current.controller = controller
        const showLoading = foreground || snapshotRef.current === undefined
        if (showLoading) setLoading(true)
        try {
          const body = await requestSnapshot({ cwd, dataRoot: selectedDataRoot, runId: selectedRun, sessionId: scope?.sessionId, signal: controller.signal })
          if (sequence !== requestRef.current.sequence) return undefined
          if (!snapshotMatchesSelection(body, { runId: selectedRun, dataRoot: selectedDataRoot, task: selectedTask })) throw new Error('状态响应不属于当前选择的分析任务')
          const fingerprint = snapshotFingerprint(body)
          if (fingerprint === null || fingerprint !== snapshotFingerprintRef.current) {
            snapshotRef.current = body
            snapshotFingerprintRef.current = fingerprint ?? ''
            setSnapshot(body)
          }
          setError(undefined)
          return body
        } catch (reason) {
          if (reason?.name !== 'AbortError' && sequence === requestRef.current.sequence) {
            setError(reason instanceof Error ? reason.message : String(reason))
          }
          return undefined
        } finally {
          if (showLoading && sequence === requestRef.current.sequence) setLoading(false)
        }
      }, [cwd, selectedDataRoot, selectedRun, selectedTask?.run_id, scope?.sessionId])

      const workbenchRunId = pageMode === 'home' ? undefined : selectedRun === undefined ? snapshot?.current?.run_id : selectedRun
      const workbenchTaskId = pageMode === 'analysis' ? selectedTaskId : undefined
      const workbenchSessionId = pageMode === 'analysis' ? scope?.sessionId : undefined
      const loadWorkbench = React.useCallback(async ({ background = false } = {}) => {
        if (!cwd || pageMode === 'execution') return
        const sequence = ++workbenchRequestRef.current.sequence
        workbenchRequestRef.current.controller?.abort()
        const controller = new AbortController()
        workbenchRequestRef.current.controller = controller
        if (!background) setWorkbenchLoading(true)
        try {
          const body = await requestWorkbench({
            cwd,
            view: pageMode === 'home' ? 'home' : undefined,
            runId: workbenchRunId,
            taskId: workbenchTaskId,
            sessionId: workbenchSessionId,
            cursor: runCursor,
            limit: 20,
            signal: controller.signal,
          })
          if (controller.signal.aborted || sequence !== workbenchRequestRef.current.sequence) return
          setWorkbench({ ...body, __clientSyncedAt: new Date().toISOString() })
          setWorkbenchError(undefined)
          return body
        } catch (reason) {
          if (reason?.name !== 'AbortError' && sequence === workbenchRequestRef.current.sequence) {
            setWorkbenchError(reason instanceof Error ? reason.message : String(reason))
          }
          return undefined
        } finally {
          if (sequence === workbenchRequestRef.current.sequence) setWorkbenchLoading(false)
        }
      }, [cwd, pageMode, runCursor, workbenchSessionId, workbenchRunId, workbenchTaskId])

      const latestTaskRefreshRef = React.useRef(null)
      latestTaskRefreshRef.current = { load, loadWorkbench }

      const loadEnvironments = React.useCallback(async () => {
        try {
          const values = await requestEnvironments()
          setEnvironments(values)
          setSelectedEnvironment(current => values.some(item => item.id === current) ? current : (values[0]?.id ?? ''))
        } catch (reason) {
          setActionNotice({ message: `无法读取执行环境：${reason instanceof Error ? reason.message : String(reason)}`, isError: true, scopeKey: noticeScopeKey })
        }
      }, [noticeScopeKey])

      const loadRepositories = React.useCallback(async () => {
        if (!cwd || pageMode !== 'home') return undefined
        const sequence = ++repositoryRequestRef.current
        const stillCurrent = () => sequence === repositoryRequestRef.current && panelScopeRef.current.cwd === cwd
        setRepositoryLoading(true)
        try {
          const value = await requestRepositoryStatus({ cwd })
          if (!stillCurrent()) return undefined
          setRepositoryState(value)
          setRepositoryError('')
          return value
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason)
          if (stillCurrent()) setRepositoryError(message)
          return undefined
        } finally {
          if (stillCurrent()) setRepositoryLoading(false)
        }
      }, [cwd, pageMode])

      React.useEffect(() => {
        snapshotRef.current = undefined
        snapshotFingerprintRef.current = ''
        setSnapshot(undefined)
        ++workbenchRequestRef.current.sequence
        workbenchRequestRef.current.controller?.abort()
        setWorkbench(undefined)
        setWorkbenchError(undefined)
        setWorkbenchLoading(false)
        setSelectedRun(undefined)
        setSelectedTaskId(undefined)
        setScreen({ type: initialScreen })
        setHistory([])
        setSelectedCaseIds([])
        ++repositoryRequestRef.current
        ++repositoryImportRef.current
        setRepositoryState(undefined)
        setRepositoryLoading(false)
        setRepositoryForm({ sourcePath: '', repositoryName: '' })
        setRepositoryImporting(false)
        setRepositoryError('')
      }, [cwd, initialScreen])
      React.useEffect(() => {
        requestRef.current.sequence += 1
        requestRef.current.controller?.abort()
        snapshotRef.current = undefined
        snapshotFingerprintRef.current = ''
        setSnapshot(undefined)
        setError(undefined)
      }, [snapshotSelectionKey])
      React.useEffect(() => {
        setLaunchDiagnosticsOpen(false)
      }, [selectedTaskId])
      React.useEffect(() => {
        const sync = () => {
          const taskId = ctx?.pangea?.getSelectedTaskId?.()
          if (!taskId || pageMode !== 'analysis') return
          setSelectedTaskId(taskId)
          setScreen({ type: 'overview' })
          setHistory([])
        }
        sync()
        return ctx?.pangea?.subscribeTaskSelection?.(sync)
      }, [ctx?.pangea, pageMode])
      React.useEffect(() => {
        if (pageMode !== 'analysis' || ['create', 'repository-import'].includes(screen.type) || selectedTaskId || selectedRun !== undefined || !workbench?.selected_task_id) return
        setSelectedTaskId(workbench.selected_task_id)
        const task = workbench?.tasks?.items?.find(item => item.task_id === workbench.selected_task_id)
        setSelectedRun(task?.run_id ?? undefined)
        setScreen({ type: 'overview' })
        setHistory([])
      }, [pageMode, screen.type, selectedRun, selectedTaskId, workbench?.selected_task_id, workbench?.tasks?.items])
      React.useEffect(() => {
        if (pageMode !== 'analysis' || ['tasks', 'create', 'repository-import'].includes(screen.type)) return
        const task = workbench?.tasks?.items?.find(item => item.task_id === selectedTaskId)
        if (!task) return
        const taskRun = task.run_id ?? null
        if (taskRun !== selectedRun) { setSelectedRun(taskRun); setScreen({ type: 'overview' }); setHistory([]) }
      }, [pageMode, screen.type, selectedRun, selectedTaskId, workbench?.tasks?.items])
      React.useEffect(() => () => { if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current) }, [])
      React.useEffect(() => {
        const sync = () => setRunDraft(ctx?.pangea?.getRunDraft?.() ?? { requestId: 0, assetIds: [] })
        sync()
        return ctx?.pangea?.subscribeRunDraft?.(sync)
      }, [ctx?.pangea])
      React.useEffect(() => {
        if (pageMode !== 'analysis' || !runDraft?.requestId || runDraft.requestId === handledRunDraftRequest.current) return
        handledRunDraftRequest.current = runDraft.requestId
        if (runDraft.intent === 'select-task' && runDraft.taskId) {
          ctx?.pangea?.selectTask?.(runDraft.taskId)
          setSelectedTaskId(runDraft.taskId)
          setSelectedRun(runDraft.runId ?? null)
          setScreen({ type: 'overview' })
          setHistory([])
          return
        }
        if (runDraft.intent === 'select-run' && runDraft.runId) {
          const task = workbench?.tasks?.items?.find(item => item.run_id === runDraft.runId)
          ctx?.pangea?.selectTask?.(task?.task_id)
          setSelectedTaskId(task?.task_id)
          setSelectedRun(runDraft.runId)
          setScreen({ type: task ? 'overview' : 'workflow' })
          setHistory([])
          return
        }
        setCreateForm(value => ({ ...value, asset_ids: [...new Set(runDraft.assetIds ?? [])] }))
        setScreen({ type: 'create' })
        setHistory([])
      }, [ctx?.pangea, pageMode, runDraft?.assetIds, runDraft?.intent, runDraft?.requestId, runDraft?.runId, runDraft?.taskId, workbench?.tasks?.items])
      React.useEffect(() => {
        const repositories = workbench?.capabilities?.repositories ?? []
        if (repositories.length > 0) setCreateForm(value => value.repository ? value : { ...value, repository: repositories[0] })
      }, [workbench?.capabilities])
      React.useEffect(() => {
        const options = workbench?.acp_providers ?? []
        if (options.length === 0) return
        setCreateForm(value => {
          // A saved executor choice belongs to this draft. If it was removed,
          // require an explicit replacement instead of using global history.
          if (value.provider_id || value.external_selection_required) return value
          let remembered = ''
          try { remembered = window.localStorage?.getItem(ACP_PROVIDER_STORAGE_KEY) ?? '' } catch { /* storage unavailable */ }
          const available = options.filter(item => item.registered === true)
          const selected = available.find(item => item.id === remembered)?.id ?? available[0]?.id
          return selected ? { ...value, provider_id: selected, agent_model: '', model_route_key: '' } : value
        })
      }, [cwd, workbench?.acp_providers])
      React.useEffect(() => {
        if (assetWorkspaceRef.current !== cwd) {
          setAssetCatalog(null)
          setAssetLabels({})
          setAssetDetailStatus({})
          setAssetPage(1)
          setAssetSelectorOpen(false)
          setCoverageQueryBusy(false)
          setCoverageQueryResult(null)
          setCreateForm(value => value.asset_ids.length ? { ...value, asset_ids: [] } : value)
        }
        assetWorkspaceRef.current = cwd
      }, [cwd])
      const assetRepositoryFilter = assetRepositoryOnly ? createForm.repository : ''
      React.useEffect(() => {
        if (!assetSelectorOpen || screen.type !== 'create' || !visible || !cwd) return undefined
        const controller = new AbortController()
        setAssetCatalogLoading(true)
        setAssetCatalogError('')
        setAssetCatalog(null)
        void requestAssetCatalog({ cwd, repositoryId: assetRepositoryFilter, page: assetPage,
          query: assetQuery, type: assetType, signal: controller.signal }).then(value => {
          if (controller.signal.aborted) return
          setAssetCatalog(value)
          setAssetLabels(previous => ({ ...Object.fromEntries((value.assets ?? []).map(item => [item.asset_id, item])), ...previous }))
        }).catch(reason => {
          if (!controller.signal.aborted) setAssetCatalogError(reason instanceof Error ? reason.message : String(reason))
        }).finally(() => {
          if (!controller.signal.aborted) setAssetCatalogLoading(false)
        })
        return () => controller.abort()
      }, [cwd, visible, screen.type, assetSelectorOpen, assetRepositoryFilter, assetPage, assetQuery, assetType, assetRefresh])
      const selectedAssetIdsKey = createForm.asset_ids.join('\u0000')
      React.useEffect(() => {
        if (pageMode !== 'analysis' || screen.type !== 'create' || !visible || !cwd) return undefined
        const missingAssetIds = [...new Set(createForm.asset_ids)].filter(assetId => {
          const detail = assetLabels[assetId]
          return !detail?.title
        })
        if (!missingAssetIds.length) return undefined
        const controller = new AbortController()
        setAssetDetailStatus(previous => ({ ...previous, ...Object.fromEntries(missingAssetIds.map(assetId => [assetId, 'loading'])) }))
        void Promise.allSettled(missingAssetIds.map(assetId => requestAssetDetail({ cwd, assetId, signal: controller.signal }))).then(results => {
          if (controller.signal.aborted) return
          const resolved = {}
          const status = {}
          results.forEach((result, index) => {
            const assetId = missingAssetIds[index]
            if (result.status === 'fulfilled' && result.value?.asset_id === assetId && result.value.title) {
              resolved[assetId] = result.value
              status[assetId] = 'loaded'
            } else status[assetId] = 'error'
          })
          if (Object.keys(resolved).length) setAssetLabels(previous => ({ ...previous, ...resolved }))
          setAssetDetailStatus(previous => ({ ...previous, ...status }))
        })
        return () => controller.abort()
      }, [cwd, visible, pageMode, screen.type, selectedAssetIdsKey])
      React.useEffect(() => {
        if (!visible || !needsRunSnapshot) {
          requestRef.current.controller?.abort()
          return undefined
        }
        let stopped = false
        let timer
        const clearTimer = () => {
          if (timer !== undefined) window.clearTimeout(timer)
          timer = undefined
        }
        const schedule = value => {
          clearTimer()
          const delay = document.visibilityState === 'hidden' ? IDLE_POLL_INTERVAL_MS : snapshotPollInterval(value)
          if (!stopped) timer = window.setTimeout(() => { timer = undefined; void poll() }, delay)
        }
        const poll = async () => {
          if (stopped) return
          const value = await load()
          if (!stopped) schedule(value ?? snapshotRef.current)
        }
        const onVisibilityChange = () => {
          if (stopped || document.visibilityState === 'hidden') return
          clearTimer()
          timer = window.setTimeout(() => { timer = undefined; void poll() }, 0)
        }
        document.addEventListener('visibilitychange', onVisibilityChange)
        timer = window.setTimeout(() => { timer = undefined; void poll() }, 0)
        return () => {
          stopped = true
          clearTimer()
          requestRef.current.controller?.abort()
          document.removeEventListener('visibilitychange', onVisibilityChange)
        }
      }, [load, needsRunSnapshot, visible])
      React.useEffect(() => {
        if (!visible || pageMode === 'execution') return undefined
        void loadWorkbench()
        return () => workbenchRequestRef.current.controller?.abort()
      }, [loadWorkbench, pageMode, visible])
      React.useEffect(() => { if (visible && pageMode === 'execution') void loadEnvironments() }, [visible, pageMode, loadEnvironments])
      React.useEffect(() => { if (visible && pageMode === 'home') void loadRepositories() }, [visible, pageMode, loadRepositories])

      const snapshotCurrent = snapshot?.current
      const current = snapshotCurrent && snapshotMatchesSelection(snapshot, {
        runId: selectedRun,
        dataRoot: selectedDataRoot,
        task: selectedTask,
      }) ? snapshotCurrent : null
      const monitorPersistence = pageMode === 'home' ? workbench?.monitor_persistence
        : latestMonitorPersistence(workbench?.monitor_persistence, snapshot?.monitor?.persistence)
      const monitorPersistenceDegraded = monitorPersistence?.status === 'degraded'
      const needsWorkbenchPolling = taskItems.some(task => ['preparing', 'running'].includes(task.status))
        || (pageMode === 'home' && monitorPersistenceDegraded)
      React.useEffect(() => {
        if (!visible || pageMode === 'execution' || !needsWorkbenchPolling) return undefined
        let stopped = false
        let timer
        const poll = async () => {
          if (stopped) return
          await loadWorkbench({ background: true })
          if (!stopped) {
            timer = window.setTimeout(poll, document.visibilityState === 'hidden'
              ? WORKBENCH_BACKGROUND_POLL_INTERVAL_MS : WORKBENCH_ACTIVE_POLL_INTERVAL_MS)
          }
        }
        // The foreground effect already loaded this selection. A newly observed
        // running task must not immediately abort/repeat that first request.
        timer = window.setTimeout(poll, document.visibilityState === 'hidden'
          ? WORKBENCH_BACKGROUND_POLL_INTERVAL_MS : WORKBENCH_ACTIVE_POLL_INTERVAL_MS)
        return () => { stopped = true; window.clearTimeout(timer) }
      }, [loadWorkbench, pageMode, needsWorkbenchPolling, visible])
      const monitor = snapshot?.monitor
      const monitoredSession = monitor?.session
      const monitoredRun = monitor?.run
      const health = current?.reader_health
      const details = current?.details ?? { risks: [], test_cases: [], evidence: [], business_flows: [], review_issues: [] }
      const riskEnabled = riskApplicable(current)
      const risks = details.risks ?? []
      React.useEffect(() => {
        if (current && !riskEnabled) {
          if (['risk', 'risks'].includes(screen.type)) { setScreen({ type: 'overview' }); setHistory([]) }
          if (branchFilter === 'high_risk') setBranchFilter('')
        }
      }, [current?.run_id, riskEnabled, screen.type, branchFilter])
      const testCases = details.test_cases ?? []
      const evidence = details.evidence ?? []
      const businessFlows = details.business_flows ?? []
      React.useEffect(() => {
        if (!visible || screen.type !== 'flows' || !current?.run_id || !snapshot?.data_root) return undefined
        const selected = businessFlows.find(item => item.flow_id === flowSelection) ?? businessFlows[0]
        const selectedBranch = selected?.branches?.find(item => item.branch_id === (flowBranchDetail || branchSelection || flowReader.query))
        const direct = selectedBranch?.source_evidence ?? selectedBranch?.source_location
        const location = typeof direct === 'string' ? direct : Array.isArray(direct) ? typeof direct[0] === 'string' ? direct[0] : direct[0]?.location : direct?.location
        if (!location) { setFlowBranchSource(null); return undefined }
        const key = `${current.run_id}\u0000${selected.flow_id}\u0000${selectedBranch.branch_id}\u0000${location}`
        const controller = new AbortController()
        setFlowBranchSource({ key, status: 'loading' })
        requestSourceSnippet({ cwd, dataRoot: snapshot.data_root, runId: current.run_id, location, signal: controller.signal })
          .then(value => setFlowBranchSource({ key, status: 'ready', value }))
          .catch(error => { if (error?.name !== 'AbortError') setFlowBranchSource({ key, status: 'error', error: error.message }) })
        return () => controller.abort()
      }, [visible, screen.type, current?.run_id, snapshot?.data_root, flowSelection, flowBranchDetail, branchSelection, flowReader.query])
      const workflow = current?.workflow ?? { units: [], actions: [], error_history: [], quality_checks: [], unresolved: [] }
      React.useEffect(() => {
        if (!visible) return
        const systemState = workbenchError || workbench?.compatibility?.compatible === false
          ? { state: 'error', label: '系统异常' }
          : monitorPersistenceDegraded ? { state: 'error', label: '监控保存异常' }
          : workbench?.compatibility?.compatible === true
              ? { state: 'ok', label: '系统正常' }
              : { state: 'checking', label: '系统检查中' }
        window.dispatchEvent(new CustomEvent('pangea:system-state', { detail: systemState }))
        const selectedCurrent = selectedTask?.run_id && current?.run_id === selectedTask.run_id ? current : null
        const contextTotal = selectedCurrent?.analysis?.total ?? 0
        const contextCompleted = selectedCurrent?.analysis?.completed ?? 0
        const assistantVisible = pageMode === 'analysis' && selectedTask && !['tasks', 'create'].includes(screen.type)
        const activeConversation = selectedTask?.conversations?.find(item => item.conversation_id === selectedTask.active_conversation_id)
        const activeDiagram = activeConversation?.kind === 'architecture' ? diagramViews.find(view => view.session_id === activeConversation.session_id) : null
        const discussionRisk = screen.type === 'risk' ? riskById.get(screen.id) : null
        const discussionCase = screen.type === 'case' ? caseById.get(screen.id) : null
        const discussionFocus = discussionRisk
          ? { kind: 'risk', id: discussionRisk.risk_id ?? screen.id, title: discussionRisk.title ?? discussionRisk.risk_id ?? screen.id }
          : discussionCase
            ? { kind: 'case', id: discussionCase.display_id ?? discussionCase.test_case_id ?? screen.id, title: discussionCase.title ?? discussionCase.test_case_id ?? screen.id }
            : null
        const discussionRelatedItems = discussionRisk
          ? (discussionRisk.linked_test_case_ids ?? []).map(id => testCases.find(item => item.test_case_id === id)).filter(Boolean).map(item => ({ kind: 'case', id: caseKeyByItem.get(item), label: (item.display_id ?? item.test_case_id ?? '用例') + ' · ' + (item.title ?? '未命名用例') }))
          : discussionCase
            ? (discussionCase.linked_risk_ids ?? []).map(id => risks.find(item => item.risk_id === id)).filter(Boolean).map(item => ({ kind: 'risk', id: riskKeyByItem.get(item), label: (item.risk_id ?? '风险') + ' · ' + (item.title ?? '未命名风险') }))
            : []
        const discussionSources = (discussionRisk?.evidence ?? discussionCase?.evidence ?? []).filter(item => hasText(item?.location)).map(item => ({ label: item.label ?? item.title ?? item.location, location: item.location }))
        const presentation = deriveRunPresentation(selectedTask, selectedCurrent, selectedCurrent?.reader_health)
        const launchEvents = taskLaunchEvents(selectedTask, workbench)
        const outputEvent = [...launchEvents].reverse().find(event => typeof event?.output === 'string' && event.output.trim() !== '')
        const processStatus = selectedTask?.execution_status
          ?? (selectedTask?.status === 'failed' ? 'failed' : selectedTask?.status === 'completed' ? 'completed' : selectedTask?.status)
          ?? 'preparing'
        window.dispatchEvent(new CustomEvent('pangea:run-context', { detail: assistantVisible ? {
          taskId: selectedTask.task_id,
          workspaceKey: selectedTask.workspace ?? cwd,
          runId: selectedCurrent?.run_id ?? selectedTask.run_id,
          attemptId: selectedTask.attempt_id,
          ownerSessionId: selectedTask.owner_session_id,
          jobId: selectedTask.job_id,
          taskTitle: selectedTask.title,
          title: selectedTask.title,
          repository: selectedCurrent?.repository ?? selectedTask.repository,
          target: selectedCurrent?.target ?? selectedTask.target,
          startedAt: selectedCurrent?.started_at ?? selectedTask.launch_started_at,
          sourceFileCount: selectedCurrent?.source_snapshot?.file_count ?? null,
          sourceFrozen: Boolean(selectedCurrent?.source_snapshot?.manifest_path),
          tabCounts: { flows: businessFlows.length, risks: risks.length, cases: testCases.length },
          discussionContext: {
            runId: selectedCurrent?.run_id ?? selectedTask.run_id,
            taskTitle: selectedTask.title,
            focus: discussionFocus,
            relatedItems: discussionRelatedItems,
            sources: discussionSources,
          },
          processMode: selectedTask.provider ? 'acp' : 'internal',
          phase: activeConversation?.kind === 'architecture' ? '历史图表记录' : selectedCurrent ? (selectedCurrent.phase_title ?? PHASE[String(selectedCurrent.phase ?? '').toUpperCase()] ?? PHASE[selectedCurrent.phase] ?? selectedCurrent.phase) : '正在准备',
          percent: contextTotal > 0 ? Math.min(100, Math.round((contextCompleted / contextTotal) * 100)) : 0,
          conversations: (selectedTask.conversations ?? []).map((conversation, index) => {
            const view = diagramViews.find(item => item.session_id === conversation.session_id)
            return { ...conversation,
              kind_label: conversation.kind === 'analysis' ? '分析记录' : conversation.kind === 'architecture' ? '图表' : '讨论',
              display_title: view ? `${diagramName(view)} · ${businessFlows.find(flow => flow.flow_id === view.flow_id)?.title || '模块全景'} · ${diagramVersion(view, diagramViews)}`
                : conversation.kind === 'analysis' ? '主分析过程'
                  : conversation.kind === 'architecture' ? `图表 ${index}` : conversation.title?.startsWith(selectedTask.title) ? `讨论 ${index}` : conversation.title,
            }
          }),
          activeConversationId: selectedTask.active_conversation_id,
          activeConversationSessionId: activeConversation?.session_id ?? null,
          activeConversationKind: activeConversation?.kind ?? null,
          conversationPending,
          presentation,
          processOutput: selectedTask.last_output || outputEvent?.output || '',
          renderProcessOutput: renderReadableBody,
          process: activeConversation?.kind === 'architecture' ? {
            status: activeDiagram?.available ? 'completed' : ['failed', 'stopped', 'interrupted'].includes(activeDiagram?.status) ? activeDiagram.status : 'interrupted',
            output: activeDiagram?.output ?? '', error: activeDiagram?.error ?? '', last_activity_at: activeDiagram?.last_activity_at,
          } : {
            status: processStatus,
            output: selectedTask.last_output || outputEvent?.output || '',
            attemptId: selectedTask.attempt_id,
            error: selectedTask.terminal_error || selectedTask.launch_error || outputEvent?.error || '',
            last_activity_at: launchEvents.at(-1)?.at,
            events: launchEvents.slice(-12).map(event => ({
              at: event?.at, stage: event?.stage, summary: event?.summary, source: event?.source,
              flowId: businessFlows.some(flow => flow.flow_id === event?.flow_id) ? event.flow_id : null,
              label: launchEventLabel(event),
            })),
          },
          onSelectConversation: conversationId => selectTaskConversation(conversationId),
          onCreateConversation: () => createTaskConversationForCurrent(),
          onOpenTab: type => navigate({ type }),
          onNavigateTo: (type, id) => {
            if (type === 'risk' || type === 'case') navigate({ type, id })
            else if (type === 'cases') navigate({ type: 'cases' })
            else if (type === 'flow' && businessFlows.some(flow => flow.flow_id === id)) {
              setFlowSelection(id)
              navigate({ type: 'flows' })
            }
          },
          onOpenSource: location => openSidebarFile(location, '源码依据'),
        } : null }))
      }, [current, error, health?.status, monitorPersistenceDegraded, pageMode, screen.id, screen.type, selectedTask, visible, diagramViews, conversationPending, workbench?.compatibility?.compatible, workbench?.launch_log?.events, workbenchError])
      const [caseFilters, setCaseFilters] = React.useState({ unit: '', type: '', readiness: '', review: '' })
      const [casePage, setCasePage] = React.useState(1)
      const [caseReview, setCaseReview] = React.useState(null)
      const [reviewError, setReviewError] = React.useState('')
      const [reviewSaving, setReviewSaving] = React.useState(false)
      const [caseExportScope, setCaseExportScope] = React.useState('all')
      const [caseReviewOrder, setCaseReviewOrder] = React.useState([])
      const reviewScope = `${cwd}\u0000${snapshot?.data_root ?? ''}\u0000${current?.run_id ?? ''}`
      const activeReviewScope = React.useRef(reviewScope)
      activeReviewScope.current = reviewScope
      const reviews = caseReview?.scope === reviewScope ? caseReview : null
      const reviewByKey = Object.fromEntries((reviews?.cases ?? []).filter(row => row.case_key).map(row => [row.case_key, row]))
      const unitOrder = new Map(workflow.units.map((unit, index) => [unit.unit_id, index]))
      const orderedCases = [...testCases].sort((a, b) => (unitOrder.get(a.unit_id) ?? Number.MAX_SAFE_INTEGER) - (unitOrder.get(b.unit_id) ?? Number.MAX_SAFE_INTEGER))
      const filteredCaseRows = filterTestCases(orderedCases, { ...caseFilters, query: caseQuery }, reviewByKey)
      const acceptReview = (value, scopeKey) => setCaseReview(previous => previous?.scope === scopeKey && previous.revision > value.revision ? previous : { ...value, scope: scopeKey })
      React.useEffect(() => {
        setCaseReview(null); setReviewSaving(false); setReviewError(''); setCaseFilters({ unit: '', type: '', readiness: '', review: '' }); setCasePage(1); setCaseReviewOrder([]); setSelectedCaseIds([])
      }, [reviewScope])
      React.useEffect(() => {
        if (!current?.run_id || !snapshot?.data_root) return
        const controller = new AbortController(), scopeKey = reviewScope
        void requestCaseReviews({ cwd, dataRoot: snapshot.data_root, runId: current.run_id, signal: controller.signal }).then(value => {
          if (!controller.signal.aborted && activeReviewScope.current === scopeKey) acceptReview(value, scopeKey)
        }).catch(reason => { if (reason.name !== 'AbortError' && activeReviewScope.current === scopeKey) setReviewError(reason.message) })
        return () => controller.abort()
      }, [reviewScope, current?.publication?.revision, testCases])
      React.useEffect(() => { setCasePage(1) }, [caseQuery, caseFilters.unit, caseFilters.type, caseFilters.readiness, caseFilters.review])
      async function saveReview(item, decision) {
        const key = caseIdentity(item), row = reviewByKey[key]
        if (!row || reviewSaving || !reviews) return
        const scopeKey = reviewScope
        setReviewSaving(true); setReviewError('')
        try {
          const value = await requestCaseReviews({ cwd, dataRoot: snapshot.data_root, runId: current.run_id, input: { expected_revision: reviews.revision, case_key: key, expected_content_hash: row.content_hash, decision } })
          if (activeReviewScope.current === scopeKey) acceptReview(value, scopeKey)
        } catch (reason) {
          if (activeReviewScope.current === scopeKey) {
            setReviewError(reason.message)
            try { const value = await requestCaseReviews({ cwd, dataRoot: snapshot.data_root, runId: current.run_id }); if (activeReviewScope.current === scopeKey) acceptReview(value, scopeKey) } catch {}
          }
        } finally { if (activeReviewScope.current === scopeKey) setReviewSaving(false) }
      }
      function openCaseDetail(key) { setCaseReviewOrder(filteredCaseRows.map(item => caseKeyByItem.get(item))); navigate({ type: 'case', id: key }) }
      const [scopePreview, setScopePreview] = React.useState(null)
      const createScopeKey = JSON.stringify([cwd, workbench?.data_root, createForm.repository, createForm.source_scope_text])
      const validScopePreview = scopePreview?.key === createScopeKey && scopePreview.preview_state === 'complete' ? scopePreview : null
      const methodologyDetailAvailable = workbench?.run?.run_id === current?.run_id && Array.isArray(workbench?.run?.methodologies)
      const methodologyDetailError = workbench?.run_detail?.run_id === current?.run_id && workbench?.run_detail?.status === 'error'
        ? workbench.run_detail.error : ''
      const methodologyManifests = methodologyDetailAvailable ? workbench.run.methodologies : []
      const methodologiesByUnit = new Map(methodologyManifests.map(manifest => [manifest.unit_id, Array.isArray(manifest.items) ? manifest.items : []]))
      const riskEntries = risks.map((item, index) => [hasText(item.risk_id) ? item.risk_id : `__risk__:${index}`, item])
      const identityCounts = new Map()
      for (const item of testCases) { const key = caseIdentity(item); if (key) identityCounts.set(key, (identityCounts.get(key) || 0) + 1) }
      const caseEntries = testCases.map((item, index) => [identityCounts.get(caseIdentity(item)) === 1 ? caseIdentity(item) : `__case__:${index}`, item])
      const riskById = new Map(riskEntries)
      const caseById = new Map(caseEntries)
      const riskKeyByItem = new Map(riskEntries.map(([key, item]) => [item, key]))
      const caseKeyByItem = new Map(caseEntries.map(([key, item]) => [item, key]))
      const evidenceByKey = new Map(evidence.map(item => [evidenceIdentity(item), item]))
      const unitById = new Map(workflow.units.map(unit => [unit.unit_id, unit]))
      const flowsByUnit = new Map()
      for (const flow of businessFlows) {
        const key = hasText(flow.unit_id) ? flow.unit_id : '__unassigned__'
        if (!flowsByUnit.has(key)) flowsByUnit.set(key, [])
        flowsByUnit.get(key).push(flow)
      }
      const riskScreenKey = screen.type === 'risk' ? `${current?.run_id ?? ''}\u0000${screen.id}` : ''
      const riskEvidenceOptions = screen.type === 'risk' ? (riskById.get(screen.id)?.evidence ?? []).filter(item => hasText(item?.location)) : []
      const caseEvidenceOptions = screen.type === 'case' ? (caseById.get(screen.id)?.evidence ?? []).filter(item => hasText(item?.location)) : []
      const selectedRiskEvidenceKey = riskEvidenceSelection.riskKey === riskScreenKey ? riskEvidenceSelection.evidenceKey : ''
      const previewEvidence = screen.type === 'risk'
        ? riskEvidenceOptions.find(item => evidenceIdentity(item) === selectedRiskEvidenceKey) ?? riskEvidenceOptions[0]
        : screen.type === 'case' ? caseEvidenceOptions[0]
        : screen.type === 'evidence-detail' ? evidenceByKey.get(screen.key) : undefined
      const previewKey = previewEvidence ? `${current?.run_id ?? ''}\u0000${evidenceIdentity(previewEvidence)}` : ''
      const riskClaims = screen.type === 'risk' ? splitRiskClaims(riskById.get(screen.id)?.system_result) : []
      const selectedRiskClaim = riskClaimSelection.riskKey === riskScreenKey && riskClaims.includes(riskClaimSelection.claim)
        ? riskClaimSelection.claim : riskClaims[0]
      const defaultRiskEvidenceKey = previewEvidence && screen.type === 'risk' ? evidenceIdentity(previewEvidence) : ''
      const selectedRiskEvidenceKeys = riskEvidenceSetSelection.riskKey === riskScreenKey
        ? riskEvidenceSetSelection.evidenceKeys : defaultRiskEvidenceKey ? [defaultRiskEvidenceKey] : []

      React.useEffect(() => {
        if (!visible || !cwd || !snapshot?.data_root || !previewEvidence?.location) {
          setSourcePreview({ key: '', status: 'idle' })
          return undefined
        }
        const controller = new AbortController()
        setSourcePreview({ key: previewKey, status: 'loading' })
        requestSourceSnippet({ cwd, dataRoot: snapshot.data_root, runId: current?.run_id, location: previewEvidence.location,
          contextBefore: ['risk', 'case'].includes(screen.type) ? 8 : undefined,
          contextAfter: ['risk', 'case'].includes(screen.type) ? 12 : undefined, signal: controller.signal })
          .then(value => setSourcePreview({ key: previewKey, status: 'ready', value }))
          .catch(reason => {
            if (reason?.name !== 'AbortError') setSourcePreview({ key: previewKey, status: 'error', error: reason instanceof Error ? reason.message : String(reason) })
          })
        return () => controller.abort()
      }, [visible, cwd, snapshot?.data_root, previewKey, sourceRetry, screen.type])

      const viewportScopeKey = JSON.stringify([cwd, snapshot?.data_root, selectedTaskId, current?.run_id])
      const navigate = React.useCallback((next, from = screen) => {
        const value = capturePanelViewport(panelRootRef.current)
        const saved = value ? { ...from, viewport: { scopeKey: viewportScopeKey, value } } : from
        pendingViewportRef.current = next.type === 'case' ? { screen: next, scopeKey: viewportScopeKey, value: null } : null
        setSourceDrawerOpen(false); setCaseExportOpen(false)
        setHistory(previous => [...previous, saved]); setScreen(next)
      }, [screen, viewportScopeKey])
      function selectReviewCase(id) { const next = { type: 'case', id }; pendingViewportRef.current = { screen: next, scopeKey: viewportScopeKey, value: null }; setSourceDrawerOpen(false); setScreen(next) }
      const jump = React.useCallback((type) => { pendingViewportRef.current = null; setSourceDrawerOpen(false); setCaseExportOpen(false); setScreen({ type }); setHistory([]) }, [])
      const goBack = React.useCallback(() => {
        const target = analysisBackTarget(screen.type, { pageMode, selectedTaskId, hasHistory: history.length > 0, initialScreen })
        pendingViewportRef.current = null
        if (target !== 'history') { setScreen({ type: target }); return }
        const previous = history[history.length - 1]
        if (previous.viewport) pendingViewportRef.current = { screen: previous, ...previous.viewport }
        setScreen(previous); setHistory(history.slice(0, -1))
      }, [history, initialScreen, pageMode, screen.type, selectedTaskId])
      ;(React.useLayoutEffect || React.useEffect)(() => {
        const pending = pendingViewportRef.current
        if (!pending) return
        if (pending.scopeKey !== viewportScopeKey) { pendingViewportRef.current = null; return }
        if (!visible || pending.screen !== screen || !panelRootRef.current) return
        if (['cases', 'case', 'coverage', 'coverage-cases'].includes(screen.type) && !current) return
        // Consume once: polling and subsequent renders must not pull the user back.
        pendingViewportRef.current = null
        if (pending.value) restorePanelViewport(panelRootRef.current, pending.value)
        else for (const element of panelScrollElements(panelRootRef.current)) { element.scrollTop = 0; element.scrollLeft = 0 }
      }, [screen, viewportScopeKey, Boolean(current), visible])
      function chooseRun(runId) {
        const run = workbench?.runs?.items?.find(item => item.run_id === runId) ?? snapshot?.runs?.find(item => item.run_id === runId)
        const task = workbench?.tasks?.items?.find(item => item.run_id === runId || (run?.task_id && item.task_id === run.task_id))
        // Clear a stale task selection when a historical Run has no matching
        // Task record; otherwise the next refresh can attach the new run to
        // the previously selected task and make it look like the latest Run.
        ctx?.pangea?.selectTask?.(task?.task_id)
        setSelectedTaskId(task?.task_id)
        setSelectedRun(runId)
        setScreen({ type: task ? 'overview' : 'run-record' })
        setHistory([])
      }

      function chooseTask(task, targetScreen = 'overview') {
        if (!task) return
        ctx?.pangea?.selectTask?.(task.task_id)
        setSelectedTaskId(task.task_id)
        setSelectedRun(task.run_id ?? null)
        setScreen({ type: targetScreen })
        setHistory([])
        const activeConversation = task.conversations?.find(item => item.conversation_id === task.active_conversation_id)
          ?? task.conversations?.[0]
        if (activeConversation?.session_id) {
          ctx?.pangea?.registerProductSession?.(activeConversation.session_id, 'analysis')
          ctx?.sessions?.open?.(activeConversation.session_id)
        }
        openProductPage('analysis', '分析任务', activeConversation?.session_id)
      }

      function openTaskFromWorkbench(task) {
        if (!task) return
        // Explicit navigation also handles re-opening the already-selected task
        // after its analysis page has moved to a draft or a result detail.
        ctx?.pangea?.updateRunDraft?.({ intent: 'select-task', taskId: task.task_id, runId: task.run_id ?? null,
          requestId: (ctx?.pangea?.getRunDraft?.()?.requestId ?? 0) + 1 })
        ctx?.pangea?.selectTask?.(task.task_id)
        const activeConversation = task.conversations?.find(item => item.conversation_id === task.active_conversation_id)
          ?? task.conversations?.[0]
        if (activeConversation?.session_id) {
          ctx?.pangea?.registerProductSession?.(activeConversation.session_id, 'analysis')
          ctx?.sessions?.open?.(activeConversation.session_id)
        }
        openProductPage('analysis', '分析任务', activeConversation?.session_id)
      }

      function openTaskAction(task, action, event) {
        event?.preventDefault?.()
        event?.stopPropagation?.()
        if (!task || taskActionPendingRef.current.has(JSON.stringify([cwd, task.task_id]))) return
        setTaskActionDialog({ task: { ...task }, action, cwd, busy: false, error: '' })
      }

      async function confirmTaskAction() {
        const operation = taskActionDialog
        if (!operation || operation.busy) return
        const { task, action } = operation
        const key = JSON.stringify([operation.cwd, task.task_id])
        if (taskActionPendingRef.current.has(key)) return
        const token = {}
        taskActionPendingRef.current.set(key, token)
        const inWorkspace = () => taskActionScopeRef.current?.cwd === operation.cwd && taskActionScopeRef.current?.pageMode === 'analysis'
        const updateDialog = patch => setTaskActionDialog(value => value && value.cwd === operation.cwd && value.task.task_id === task.task_id && value.action === action ? { ...value, ...patch } : value)
        updateDialog({ busy: true, error: '' })
        setTaskActions(value => ({ ...value, [task.task_id]: { action, busy: true } }))
        try {
          const result = await requestWorkbenchAction({ cwd: operation.cwd, action, payload: {
            task_id: task.task_id, run_id: task.run_id, data_root: task.data_root, attempt_id: task.attempt_id,
          } })
          if (!inWorkspace()) return
          // An older polling response must not put a deleted task back or
          // replace the authoritative stopping state returned by this action.
          workbenchRequestRef.current.controller?.abort()
          ++workbenchRequestRef.current.sequence
          setWorkbenchLoading(false)
          if (result.deleted === true) {
            setWorkbench(value => value ? { ...value,
              selected_task_id: value.selected_task_id === task.task_id ? undefined : value.selected_task_id,
              tasks: { ...value.tasks, items: (value.tasks?.items ?? []).filter(item => item.task_id !== task.task_id),
                total: Math.max(0, (value.tasks?.total ?? value.tasks?.items?.length ?? 0) - ((value.tasks?.items ?? []).some(item => item.task_id === task.task_id) ? 1 : 0)) },
            } : value)
            setTaskActionDialog(value => value?.task.task_id === task.task_id && value.cwd === operation.cwd ? null : value)
            if (taskActionScopeRef.current.selectedTaskId === task.task_id) {
              requestRef.current.controller?.abort()
              ++requestRef.current.sequence
              snapshotRef.current = undefined
              snapshotFingerprintRef.current = ''
              setSnapshot(undefined)
              setLoading(false)
              setError(undefined)
              ctx?.pangea?.selectTask?.(undefined)
              setSelectedTaskId(undefined)
              setSelectedRun(null)
              setScreen({ type: 'tasks' })
              setHistory([])
            } else await latestTaskRefreshRef.current.loadWorkbench({ background: true })
            return
          }
          if (result.task) setWorkbench(value => value ? { ...value, tasks: { ...value.tasks,
            items: (value.tasks?.items ?? []).map(item => item.task_id === task.task_id ? result.task : item) } } : value)
          const errors = [result.run_stop, result.session_cancel, result.job_stop].filter(item => item?.status === 'error').map(item => item.error).filter(Boolean)
          if (action === 'task-delete' || result.stop_confirmed !== true || errors.length) {
            const message = result.error || errors.join('；') || '已请求停止，执行端尚未确认结束。任务仍保留，请稍后重试确认。'
            updateDialog({ error: message })
            setTaskActions(value => ({ ...value, [task.task_id]: { action, busy: false, error: message } }))
          } else {
            setTaskActionDialog(value => value?.task.task_id === task.task_id && value.cwd === operation.cwd ? null : value)
            setTaskActions(value => ({ ...value, [task.task_id]: { action, busy: false } }))
          }
          const refresh = latestTaskRefreshRef.current
          await Promise.all([refresh.loadWorkbench({ background: true }), taskActionScopeRef.current.selectedTaskId === task.task_id ? refresh.load() : undefined])
        } catch (reason) {
          if (!inWorkspace()) return
          const message = `${action === 'task-delete' ? '删除' : '停止'}未完成：${reason instanceof Error ? reason.message : String(reason)}`
          updateDialog({ error: message })
          setTaskActions(value => ({ ...value, [task.task_id]: { action, busy: false, error: message } }))
          await latestTaskRefreshRef.current.loadWorkbench({ background: true })
        } finally {
          if (taskActionPendingRef.current.get(key) === token) taskActionPendingRef.current.delete(key)
          if (inWorkspace()) {
            updateDialog({ busy: false })
            setTaskActions(value => value[task.task_id] ? { ...value, [task.task_id]: { ...value[task.task_id], busy: false } } : value)
          }
        }
      }

      function taskActionButtons(task) {
        const state = taskActions[task.task_id]
        const busy = Boolean(state?.busy)
        const stopping = task.execution_status === 'stopping' || task.status === 'stopping'
        return h(React.Fragment, null,
          taskCanStop(task) ? h('button', { type: 'button', className: 'b03-task-open', disabled: busy,
            onClick: event => openTaskAction(task, 'stop', event), 'aria-label': '停止任务 ' + (task.title || task.task_id),
            title: stopping ? '执行端尚未确认结束，可再次确认停止' : undefined }, runIcon('Square'),
            busy ? '正在停止…' : state?.error && state.action === 'stop' ? '重试停止' : stopping ? '正在停止…' : '停止') : null,
          h('button', { type: 'button', className: 'b03-task-open', disabled: busy, style: { color: '#a14035' },
            onClick: event => openTaskAction(task, 'task-delete', event), 'aria-label': '删除任务 ' + (task.title || task.task_id) },
            busy && state.action === 'task-delete' ? '正在删除…' : state?.error && state.action === 'task-delete' ? '重试删除' : '删除'))
      }

      async function startTask(task, propagate = false, guardSelection) {
        if (!task || creatingRun) return
        const blocked = analysisExecutorBlockedReason(task)
        if (blocked) { showActionNotice(blocked, true); if (propagate) throw new Error(blocked); return }
        const stillSelected = () => {
          if (!guardSelection) return true
          const [workspace, taskId] = JSON.parse(derivationScopeRef.current)
          return workspace === guardSelection.cwd && taskId === guardSelection.task_id
        }
        setCreatingRun(true)
        try {
          const resume = Boolean(task.run_id)
          const launched = await requestWorkbenchAction({ cwd, action: 'task-start', payload: { task_id: task.task_id, data_root: task.data_root, resume } })
          if (!stillSelected()) return
          ctx?.pangea?.registerProductSession?.(launched.session_id, 'analysis')
          showActionNotice(resume ? '分析任务已从检查点继续。' : '分析任务已启动。')
          ctx?.sessions?.open?.(launched.session_id)
          await loadWorkbench()
        } catch (reason) {
          if (!stillSelected()) { if (propagate) throw reason; return }
          showActionNotice(`启动失败：${reason instanceof Error ? reason.message : String(reason)}`, true)
          await loadWorkbench()
          if (propagate) throw reason
        } finally {
          setCreatingRun(false)
        }
      }

      async function createTaskConversationForCurrent() {
        if (!selectedTask) throw new Error('请先选择分析任务。')
        if (conversationActionRef.current) throw new Error('正在切换会话，请稍候。')
        conversationActionRef.current = true
        setConversationPending('create')
        setCreatingRun(true)
        try {
          const number = (selectedTask.conversations ?? []).filter(item => !['analysis', 'architecture'].includes(item.kind)).length + 1
          const created = await requestWorkbenchAction({ cwd, action: 'task-conversation-create', payload: { task_id: selectedTask.task_id, title: `讨论 ${number} · ${selectedTask.repository || '当前任务'}` } })
          ctx?.pangea?.registerProductSession?.(created.session_id, 'analysis')
          await ctx?.sessions?.open?.(created.session_id)
          await loadWorkbench()
        } catch (reason) {
          throw new Error(`无法新建讨论：${reason instanceof Error ? reason.message : String(reason)}`)
        } finally {
          conversationActionRef.current = false
          setConversationPending('')
          setCreatingRun(false)
        }
      }

      async function selectTaskConversation(conversationId) {
        if (!selectedTask || !conversationId) throw new Error('请先选择会话。')
        const conversation = selectedTask.conversations?.find(item => item.conversation_id === conversationId)
        if (!conversation) throw new Error('会话已更新，请刷新后重试。')
        if (conversationActionRef.current) throw new Error('正在切换会话，请稍候。')
        conversationActionRef.current = true
        setConversationPending('select')
        try {
          await requestWorkbenchAction({ cwd, action: 'task-conversation-activate', payload: { task_id: selectedTask.task_id, conversation_id: conversationId } })
          ctx?.pangea?.registerProductSession?.(conversation.session_id, 'analysis')
          await ctx?.sessions?.open?.(conversation.session_id)
          const view = diagramViews.find(item => item.session_id === conversation.session_id)
          if (view && screen.type === 'flows') {
            setDiagramSelection(view.view_id)
            if (view.flow_id) setFlowSelection(view.flow_id)
            const flowId = view.flow_id || flowSelection || businessFlows[0]?.flow_id
            setFlowReader({ scope: `${current?.run_id}:${flowId}`, view: view.profile === 'function_variables' ? 'functions' : view.type === 'sequence' ? 'sequence' : 'diagram', step: '', query: '', page: 1 })
          }
          await loadWorkbench()
        } catch (reason) {
          throw new Error(`无法切换会话：${reason instanceof Error ? reason.message : String(reason)}`)
        } finally {
          conversationActionRef.current = false
          setConversationPending('')
        }
      }

      function showActionNotice(message, isError = false) {
        if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
        setActionNotice({ message, isError, scopeKey: noticeScopeKey })
        // Errors contain the actionable launch/stop reason.  Keep them on
        // screen until the next user action instead of hiding them after a
        // short toast timeout.
        noticeTimerRef.current = isError ? null : window.setTimeout(() => setActionNotice(undefined), 2600)
      }
      function launchEventLabel(event) {
        const status = event?.status === 'error' ? '失败' : event?.status === 'ok' ? '完成' : event?.status === 'start' ? '开始' : '信息'
        const stage = ({ task_stop: '停止分析任务', task_deleted: '删除分析任务', source_first_ready_wait: '等待 Agent 就绪', source_first_waiting: '等待执行器响应', source_first_cancel_requested: '正在确认取消', source_first_cancel_confirmed: '原回合已结束', source_first_recovering: '恢复原会话', source_first_tool_recovery: '旧执行已停止，核对保存结果', source_first_recovered: '恢复回合结束', source_first_late_response: '收到延迟响应', source_first_worker_paused: '单元已暂停', source_first_soft_budget: '规划耗时提醒', source_first_acp_request: 'ACP 请求窗口', source_first_host_call: '宿主 CLI 阶段', source_first_saved_result_checked: '检查已保存结果', acp_turn_finished: 'ACP 回合结束', acp_coordinator_finished: '宿主调度结束', acp_workers_retained: '保留原会话', acp_process_cleanup: 'ACP 进程清理' })[event?.stage] ?? event?.stage ?? 'unknown'
        const time = event?.at ? formatTime(event.at) : ''
        const detail = event?.error ?? event?.detail ?? event?.message ?? event?.output ?? ''
        const context = [event?.provider, event?.requested_model ? `指定：${event.requested_model}` : null, event?.model, event?.reasoning_effort, event?.job_id, event?.session_id, event?.run_id].filter(Boolean).join(' · ')
        const evidence = [
          ['远端会话', event?.remote_session_id], ['Agent 版本', event?.agent_version], ['请求编号', event?.request_id],
          ['回合', event?.turn], ['停止原因', event?.stop_reason], ['ACP 停止原因', event?.protocol_stop_reason],
          ['消息事件', event?.message_chunks], ['工具事件', event?.tool_calls], ['工具失败事件', event?.tool_failures],
          ['最近工具', event?.last_tool_id], ['工具状态', event?.last_tool_status], ['未结束工具数', event?.active_tool_count],
          ['回合耗时(ms)', event?.turn_duration_ms], ['首个事件(ms)', event?.first_event_ms],
          ['首 token(ms)', event?.stage === 'source_first_acp_request' ? event.first_token_ms ?? '未记录（ACP 内部不可见）' : null],
          ['无新事件时长(ms)', event?.idle_duration_ms], ['排队耗时(ms)', event?.queue_duration_ms], ['提醒预算(ms)', event?.budget_ms],
          ['阶段耗时(ms)', event?.duration_ms], ['冻结文件', event?.file_count], ['冻结字节', event?.total_bytes],
          ['源码复制耗时(ms)', event?.snapshot_duration_ms],
          ['Run 阶段', event?.phase], ['完成步骤', event?.completed], ['状态文件', event?.state_path],
          ['错误码', event?.error_code], ['错误摘要', event?.error_summary], ['stderr 摘要', event?.stderr_summary],
          ['最近工具名称', event?.last_tool_name], ['工具开始', event?.tool_started_at_ms ? formatTime(new Date(event.tool_started_at_ms).toISOString()) : null], ['工具结束', event?.tool_finished_at_ms ? formatTime(new Date(event.tool_finished_at_ms).toISOString()) : null], ['工具耗时(ms)', event?.tool_duration_ms],
          ['进程已退出', event?.process_exited], ['退出码', event?.exit_code], ['退出信号', event?.exit_signal],
          ['stderr 已截断', event?.stderr_truncated], ['输出已截断', event?.output_truncated],
        ].filter(([, value]) => value !== undefined && value !== null && value !== '')
          .map(([label, value]) => `${label}: ${value}`).join('\n')
        return [[time, status, stage, context, detail].filter(Boolean).join(' · '), evidence].filter(Boolean).join('\n')
      }

      async function appendToDiscussionConversation(draft) {
        if (!selectedTask || !hasText(draft)) return false
        if (conversationActionRef.current) throw new Error('正在切换会话，请稍候。')
        conversationActionRef.current = true
        try {
        let task = selectedTask
        let conversation = writableConversation(task)
        if (!conversation) {
          const created = await requestWorkbenchAction({
            cwd,
            action: 'task-conversation-create',
            payload: { task_id: task.task_id, title: `${task.title} · 讨论` },
          })
          task = created.task ?? task
          conversation = writableConversation(task) ?? { session_id: created.session_id, conversation_id: created.session_id, kind: 'assistant' }
        } else if (conversation.conversation_id !== task.active_conversation_id) {
          const activated = await requestWorkbenchAction({
            cwd,
            action: 'task-conversation-activate',
            payload: { task_id: task.task_id, conversation_id: conversation.conversation_id },
          })
          task = activated.task ?? task
        }
        ctx?.pangea?.registerProductSession?.(conversation.session_id, 'analysis')
        await ctx?.sessions?.open?.(conversation.session_id)
        const inserted = appendConversationDraft(ctx, { ...scope, sessionId: conversation.session_id }, draft)
        await loadWorkbench()
        if (inserted) window.dispatchEvent(new CustomEvent('pangea:open-assistant'))
        return inserted
        } finally {
          conversationActionRef.current = false
        }
      }
      function issueLabel(issue) {
        if (typeof issue === 'string') return issue
        if (!issue || typeof issue !== 'object') return String(issue ?? '未提供详情')
        return [issue.code, issue.step ? `Step ${issue.step}` : '', issue.message ?? issue.detail ?? issue.error].filter(Boolean).join(' · ')
      }
      function renderIssueCard(title, issues, tone = 'warning') {
        if (!Array.isArray(issues) || issues.length === 0) return null
        const cardStyle = tone === 'error' ? styles.error : styles.healthWarning
        return h('div', { style: { ...styles.card, ...cardStyle } },
          h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, title), h('span', { style: styles.badge }, `${issues.length} 条`)),
          h('div', { style: styles.resultGrid }, issues.map((issue, index) => h('div', { key: `${issue?.code ?? 'issue'}:${index}`, style: styles.resultItem }, issueLabel(issue)))))
      }
      function renderAcpRuntime() {
        if (!selectedTask?.provider) return null
        const job = workbench?.acp_job
        const status = job?.status ?? selectedTask.execution_status ?? 'unknown'
        const statusLabel = {
          starting: '正在启动', running: '运行中', stopping: '正在停止',
          completed: '已完成', failed: '失败', killed: '已停止', stopped: '已停止', interrupted: '已中断',
        }[status] ?? status
        return h('div', { style: styles.card },
          h('div', { style: styles.row },
            h('div', null, h('div', { style: styles.itemTitle }, '外部 Agent Runtime'), h('div', { style: styles.itemMeta }, selectedTask.provider)),
            h('span', { style: { ...styles.homeStatus, color: status === 'failed' || status === 'interrupted' ? 'var(--dsw-alias-state-error-primary, #e66767)' : status === 'completed' ? 'var(--dsw-alias-state-success-primary, #38a892)' : 'var(--dsw-alias-state-business-primary, #4d9ad6)' } }, statusLabel)),
          h('div', { style: { ...styles.grid, marginTop: 10 } },
            field('Job ID', selectedTask.job_id ?? '尚未创建'),
            field('PID', selectedTask.process_id ?? '等待进程创建'),
            field('Agent Session', selectedTask.agent_session_id ?? '等待 ACP 会话'),
            field('开始时间', job?.startedAt ? formatTime(job.startedAt) : selectedTask.launch_started_at ? formatTime(selectedTask.launch_started_at) : '尚未启动'),
            field('运行时长', job?.startedAt ? durationLabel(job.startedAt, job.finishedAt ?? Date.now()) : '—'),
            field('最后活动', selectedTask.last_activity_at ? formatTime(selectedTask.last_activity_at) : '等待首个事件')),
          selectedTask.last_output ? h('pre', { style: styles.source }, selectedTask.last_output) : h('div', { style: { ...styles.itemMeta, marginTop: 9 } }, 'Agent 尚未产生可显示的消息输出；运行态与 PID 仍会持续更新。'),
          selectedTask.terminal_error ? h('div', { style: { ...styles.error, marginTop: 9 }, role: 'alert' }, selectedTask.terminal_error) : null)
      }
      function renderLaunchDiagnostics(events) {
        if (!Array.isArray(events) || events.length === 0) return null
        return h('details', {
          style: styles.technical,
          open: launchDiagnosticsOpen,
          onToggle: event => setLaunchDiagnosticsOpen(event.currentTarget.open),
        },
        h('summary', { style: { cursor: 'pointer', fontSize: 12, fontWeight: 600 } }, `启动诊断 · ${events.length} 条${workbench?.launch_log?.truncated ? ' · 仅显示最近记录' : ''}`),
        h('div', { style: { ...styles.card, marginTop: 8, marginBottom: 0 } }, events.map((event, index) => h('div', {
          key: `${event.at ?? index}:${event.stage ?? 'unknown'}:${index}`,
          style: { ...styles.itemMeta, color: event.status === 'error' ? 'var(--dsw-alias-state-error-primary, #e66767)' : undefined, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
        }, launchEventLabel(event), event.diagnostic_path ? chip('完整诊断', () => openSidebarFile(event.diagnostic_path)) : null))))
      }
      function openProductPage(pageId, label, sessionId = scope?.sessionId) {
        const opened = ctx?.pangea?.openPage?.({ ...scope, sessionId }, pageId) === true
        if (!opened) showActionNotice(`${label}当前不可用，请检查对应插件是否已加载。`, true)
      }
      function openAnalysisCreate() {
        if (ctx?.pangea?.requestRunCreation?.(scope) !== true) {
          showActionNotice('分析任务当前不可用，请检查对应插件是否已加载。', true)
        }
      }
      function openAnalysisRun(run) {
        const task = taskItems.find(item => item.run_id === run?.run_id)
        if (task) {
          openTaskFromWorkbench(task)
          return
        }
        const selected = ctx?.pangea?.requestRunSelection?.(scope, run?.run_id)
        if (!selected) showActionNotice('无法打开该历史 Run，请检查对应插件是否已加载。', true)
      }
      async function discussCurrentRun() {
        if (!current) {
          showActionNotice('当前没有可加入会话的 PANGEA Run。', true)
          return
        }
        const draft = [
          '我正在 PANGEA 测试工作台查看当前运行，请基于下面的工作台上下文协助我判断下一步。',
          '',
          `Run：${current.run_id}`,
          `阶段：${current.phase_title ?? PHASE[current.phase] ?? current.phase ?? '未知'}`,
          `流程：${outcomePresentation(current).workflow}`,
          `交付完整性：${outcomePresentation(current).delivery}`,
          `审查方式：${outcomePresentation(current).review}`,
          `最终语义结论：${outcomePresentation(current).semantic}`,
          riskEnabled ? `风险：${risks.length} 条（其中 ${risks.filter(isUncoveredRisk).length} 条尚未覆盖，${risks.filter(isUnreachableRisk).length} 条从受支持入口不可达）` : '本次未开展风险分析。',
          `测试用例：${testCases.length} 条`,
          `执行记录：${snapshot?.executor_runs?.length ?? 0} 个`,
          '',
          '请先指出当前最需要处理的一件事，并说明依据。',
        ].join('\n')
        try {
          const inserted = await appendToDiscussionConversation(draft)
          showActionNotice(inserted ? '当前运行上下文已加入讨论会话，可以直接发送。' : '无法访问讨论会话输入框。', !inserted)
        } catch (reason) {
          showActionNotice(`无法打开讨论会话：${reason instanceof Error ? reason.message : String(reason)}`, true)
        }
      }
      function multilineValues(value) {
        return [...new Set(String(value ?? '').split(/\r?\n/).map(item => item.trim()).filter(Boolean))]
      }
      function toggleCreateAsset(assetId) {
        if (!assetId) return
        const selected = assetCatalog?.assets?.find(item => item.asset_id === assetId)
        if (!createForm.asset_ids.includes(assetId) && selected) setAssetLabels(value => ({ ...value, [assetId]: selected }))
        setCreateForm(value => ({
          ...value,
          asset_ids: value.asset_ids.includes(assetId)
            ? value.asset_ids.filter(item => item !== assetId)
            : [...value.asset_ids, assetId],
        }))
      }
      async function queryCoverageForAnalysis() {
        if (!cwd || coverageQueryBusy || creatingRun) return
        const query = { product: createForm.coverage_product, c_version: createForm.coverage_version,
          scope: createForm.coverage_module, recursive: createForm.coverage_recursive !== false, source: createForm.coverage_source || 'summary', b_version: createForm.coverage_b_version || '' }
        const requestKey = coverageRequestRef.current
        const previousAsset = coverageQueryResult?.asset?.asset_id
        setCreateForm(value => ({ ...value, asset_ids: value.asset_ids.filter(id => id !== previousAsset) }))
        setCoverageQueryBusy(true)
        setCoverageQueryResult(null)
        try {
          const { acquisition } = await requestWorkbenchAction({ cwd, action: 'coverage-query', payload: { query, data_root: workbench?.data_root } })
          if (assetWorkspaceRef.current !== cwd || coverageRequestRef.current !== requestKey) return
          setCoverageQueryResult({ ...acquisition, selection_key: requestKey })
          const asset = acquisition?.asset
          if (['success', 'partial'].includes(acquisition?.status) && asset?.status === 'available') {
            setAssetLabels(value => ({ ...value, [asset.asset_id]: asset }))
            setCreateForm(value => ({ ...value, asset_ids: [...new Set([...value.asset_ids, asset.asset_id])] }))
            setAssetRefresh(value => value + 1)
          }
          return acquisition
        } catch (error) {
          if (assetWorkspaceRef.current === cwd) setCoverageQueryResult({ status: 'error', message: error.message })
        } finally {
          if (assetWorkspaceRef.current === cwd) setCoverageQueryBusy(false)
        }
      }
      async function importCoverageForAnalysis() {
        if (!cwd || coverageQueryBusy || creatingRun) return
        const requestKey = coverageRequestRef.current
        const previousAsset = coverageQueryResult?.asset?.asset_id
        setCreateForm(value => ({ ...value, asset_ids: value.asset_ids.filter(id => id !== previousAsset) }))
        setCoverageQueryResult(null)
        setCoverageQueryBusy(true)
        try {
          const { acquisition } = await requestWorkbenchAction({ cwd, action: 'coverage-import', payload: { path: createForm.coverage_path, data_root: workbench?.data_root } })
          if (assetWorkspaceRef.current !== cwd || coverageRequestRef.current !== requestKey) return
          setCoverageQueryResult({ ...acquisition, selection_key: requestKey })
          if (acquisition?.asset?.status === 'available') {
            const asset = acquisition.asset
            setAssetLabels(value => ({ ...value, [asset.asset_id]: asset }))
            setCreateForm(value => ({ ...value, asset_ids: [...new Set([...value.asset_ids, asset.asset_id])] }))
            setAssetRefresh(value => value + 1)
          }
          return acquisition
        } catch (error) { if (assetWorkspaceRef.current === cwd) setCoverageQueryResult({ status: 'error', message: error.message }) }
        finally { if (assetWorkspaceRef.current === cwd) setCoverageQueryBusy(false) }
      }
      function repositoryNameFromPath(value) {
        return String(value ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
      }
      async function chooseRepositoryFolder() {
        const picker = window.dshDesktopDirectoryPicker
        if (!picker?.pick) {
          setRepositoryError('当前不是 PANGEA Desktop 原生窗口，无法打开系统文件夹选择器。')
          return
        }
        try {
          const selected = await picker.pick({ purpose: 'repository' })
          if (!selected) return
          setRepositoryForm({ sourcePath: selected, repositoryName: repositoryNameFromPath(selected) })
          setRepositoryError('')
        } catch (reason) {
          setRepositoryError(reason instanceof Error ? reason.message : String(reason))
        }
      }
      async function submitRepositoryImport() {
        if (!cwd || repositoryImporting || !repositoryForm.sourcePath || !repositoryForm.repositoryName.trim()) return
        const originScreen = screen
        const returnTo = history.at(-1) ?? { type: initialScreen }
        const sequence = ++repositoryImportRef.current
        ++repositoryRequestRef.current
        const ownsImport = () => sequence === repositoryImportRef.current && panelScopeRef.current.cwd === cwd
          && panelScopeRef.current.pageMode === pageMode
        const stillCurrent = () => ownsImport() && panelScopeRef.current.screen === originScreen
        setRepositoryImporting(true)
        setRepositoryLoading(false)
        setRepositoryError('')
        try {
          const result = await requestRepositoryImport({
            cwd,
            sourcePath: repositoryForm.sourcePath,
            repositoryName: repositoryForm.repositoryName,
          })
          if (!stillCurrent()) return
          const nextState = await requestRepositoryStatus({ cwd })
          if (!stillCurrent()) return
          ++repositoryRequestRef.current
          setRepositoryState(nextState)
          setRepositoryLoading(false)
          setRepositoryForm({ sourcePath: '', repositoryName: '' })
          if (pageMode === 'analysis' && returnTo.type === 'create') {
            setCreateForm(form => ({ ...form, repository: result.repository.name }))
          }
          setScreen(pageMode === 'home' ? { type: 'home' } : returnTo)
          setHistory(value => value.slice(0, -1))
          setRepositoryImporting(false)
          showActionNotice(`源码仓库“${result.repository.name}”已加入 PANGEA。`)
          await loadWorkbench()
        } catch (reason) {
          const raw = reason instanceof Error ? reason.message : String(reason)
          const message = raw.includes('repository already exists')
            ? '已存在同名仓库，请修改仓库名称后重试。'
            : raw.includes('outside the PANGEA data directory')
              ? '请选择 pangea-data 目录之外的源码仓库。'
              : raw
          if (stillCurrent()) setRepositoryError(message)
        } finally {
          if (ownsImport()) setRepositoryImporting(false)
        }
      }
      function openRepositoryImport() {
        setRepositoryForm({ sourcePath: '', repositoryName: '' })
        setRepositoryError('')
        navigate({ type: 'repository-import' })
      }
      async function submitNewRun() {
        if (!validScopePreview?.matched_file_count) { showActionNotice('请先预览并确认源码范围。', true); return }
        if (pageMode !== 'analysis' || !cwd || creatingRun || coverageQueryBusy || workbench?.compatibility?.compatible !== true) return
        const execution = analysisExecutionState(createForm, workbench?.acp_providers, analysisAgentModels, cwd)
        if (!execution.ready) { showActionNotice(execution.message, true); return }
        setCreatingRun(true)
        let createdTask
        try {
          const created = await requestWorkbenchAction({
            cwd,
            action: 'task-create',
            payload: {
              input: buildAnalysisRequest({ ...createForm, scope_preview_id: validScopePreview.preview_id, expected_scope_revision: validScopePreview.scope_revision, agent_model: execution.model, agent_catalog_id: execution.catalogId,
                ...(workbench?.capabilities?.source_first?.analysis_options_by_profile?.['behavior-test-v2'] ? {
                  analysis_profile: 'behavior-test-v2',
                  asset_revisions: Object.fromEntries(createForm.asset_ids.map(id => [id, (assetLabels[id] ?? assetCatalog?.assets?.find(item => item.asset_id === id))?.input_revision]).filter(([, revision]) => revision)),
                } : {}),
              }),
            },
          })
          createdTask = created.task
          ctx?.pangea?.updateRunDraft?.({ assetIds: [] })
          setCreateForm(value => ({ ...value, asset_ids: [] }))
          setCoverageQueryResult(null)
          setWorkbench(value => ({
            ...(value ?? {}),
            tasks: {
              items: [createdTask, ...(value?.tasks?.items ?? []).filter(item => item.task_id !== createdTask.task_id)],
              total: (value?.tasks?.items ?? []).filter(item => item.task_id !== createdTask.task_id).length + 1,
            },
          }))
          ctx?.pangea?.selectTask?.(createdTask.task_id)
          setSelectedTaskId(createdTask.task_id)
          setSelectedRun(createdTask.run_id ?? null)
          setScreen({ type: 'overview' })
          setHistory([])
          showActionNotice(`任务“${createdTask.title}”已创建，正在准备分析。`)
        } catch (reason) {
          if (reason.statusCode === 409 && !createdTask) { setScopePreview(null); setScreen(value => ({ ...value, createStep: 1 })) }
          showActionNotice(`创建失败：${reason instanceof Error ? reason.message : String(reason)}`, true)
        } finally {
          setCreatingRun(false)
        }
        if (createdTask) await startTask(createdTask)
      }
      function canDeriveCurrent() {
        if (!selectedTask || analysisExecutorBlockedReason(selectedTask) || !current || !taskMatchesRun(selectedTask, current) || error || workbench?.compatibility?.compatible !== true) return false
        const state = deriveRunPresentation(selectedTask, current, health)
        return current.workflow_version === 'source-first-v1' && !state.running && !state.stopping && !creatingRun
      }
      async function openDerivation(item, previous) {
        if (!canDeriveCurrent()) return
        const sequence = ++derivationRequestRef.current
        const scope = derivationScopeRef.current
        const record = item?.source_record
        const state = { task_id: selectedTask.task_id, run_id: current.run_id, title: selectedTask.title || current.target || current.run_id,
          pending: 'options', error: '', options: null, draft: previous?.draft ?? {
            mode: 'supplement', instruction: '', changed_paths_text: '', selected_unit_ids: [],
            selected_records: record?.action_id && record?.record_id ? [{ action_id: record.action_id, record_id: record.record_id }] : [], query: '',
          } }
        setDerivation(state)
        try {
          const response = await requestWorkbenchAction({ cwd, action: 'derivation-options', payload: { task_id: state.task_id, run_id: state.run_id } })
          if (response.options?.parent_run_id && response.options.parent_run_id !== state.run_id) throw new Error('来源分析已变化，请重新读取')
          if (sequence === derivationRequestRef.current && scope === derivationScopeRef.current) setDerivation(value => {
            if (!value) return value
            const records = new Set((response.options?.records ?? []).map(record => JSON.stringify([record.action_id, record.record_id])))
            const units = new Set((response.options?.units ?? []).map(unit => unit.unit_id))
            const selected_records = value.draft.selected_records.filter(record => records.has(JSON.stringify([record.action_id, record.record_id])))
            const selected_unit_ids = value.draft.selected_unit_ids.filter(id => units.has(id))
            const removed = selected_records.length !== value.draft.selected_records.length || selected_unit_ids.length !== value.draft.selected_unit_ids.length
            return { ...value, pending: '', options: response.options, draft: { ...value.draft, selected_records, selected_unit_ids },
              notice: removed ? '部分所选结果已不在当前可用记录中，已取消这些选择；请核对本次范围。' : '' }
          })
        } catch (reason) {
          if (sequence === derivationRequestRef.current && scope === derivationScopeRef.current) setDerivation(value => value && ({ ...value, pending: '', error: reason instanceof Error ? reason.message : String(reason) }))
        }
      }
      function closeDerivation() {
        if (derivationSubmitRef.current) return
        ++derivationRequestRef.current
        setDerivation(null)
      }
      async function submitDerivation(input) {
        if (!derivation || derivation.pending || derivationSubmitRef.current || !canDeriveCurrent()
          || derivation.task_id !== selectedTask.task_id || derivation.run_id !== current.run_id) return
        derivationSubmitRef.current = true
        const sequence = derivationRequestRef.current
        const scope = derivationScopeRef.current
        setDerivation(value => ({ ...value, pending: 'create', error: '' }))
        let createdTask
        try {
          const response = await requestWorkbenchAction({ cwd, action: 'task-derive', payload: { task_id: derivation.task_id, run_id: derivation.run_id, input } })
          // The server may have saved the child while the user switched tasks.
          // Keep that saved task discoverable without taking over the new view.
          if (sequence !== derivationRequestRef.current || scope !== derivationScopeRef.current) return
          createdTask = response.task
          setWorkbench(value => ({ ...(value ?? {}), tasks: { ...(value?.tasks ?? {}),
            items: [createdTask, ...(value?.tasks?.items ?? []).filter(item => item.task_id !== createdTask.task_id)],
            total: (value?.tasks?.total ?? value?.tasks?.items?.length ?? 0) + 1 } }))
          setDerivation(null)
          ctx?.pangea?.selectTask?.(createdTask.task_id)
          setSelectedTaskId(createdTask.task_id)
          setSelectedRun(createdTask.run_id ?? null)
          setScreen({ type: 'overview' })
          setHistory([])
        } catch (reason) {
          if (sequence === derivationRequestRef.current && scope === derivationScopeRef.current) setDerivation(value => value && ({ ...value, pending: '', error: reason instanceof Error ? reason.message : String(reason) }))
        } finally {
          derivationSubmitRef.current = false
        }
        if (createdTask) await startTask(createdTask, false, { cwd, task_id: createdTask.task_id })
      }
      function derivationButton(item) {
        if (current?.workflow_version !== 'source-first-v1') return null
        return h('button', { type: 'button', className: 'b03-task-action', style: { ...styles.button, display: 'inline-flex', alignItems: 'center', gap: 6 },
          disabled: !canDeriveCurrent(), title: canDeriveCurrent() ? '创建关联此结果的新分析' : analysisExecutorBlockedReason(selectedTask) || '请等待当前执行结束并成功读取结果',
          onClick: () => { void openDerivation(item) } }, runIcon('GitBranch'), item ? '补充这条结果' : '补充 / 增量分析')
      }
      function renderDerivationOrigin() {
        const origin = current?.incremental_request ?? selectedTask?.incremental_request
        if (!origin?.parent_run_id) return null
        return h('section', { className: 'b03-overview-card', style: { marginBottom: 18 }, 'aria-label': '增量分析来源' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } }, runIcon('GitBranch'),
            h('strong', null, origin.mode === 'changed-files' ? '基于源码变更的增量分析' : '基于已有结果的定向补充')),
          h('p', { style: { margin: '8px 0', fontSize: 14, lineHeight: 1.8, whiteSpace: 'pre-wrap' } }, origin.instruction),
          origin.changed_paths?.length ? h('p', { style: { fontSize: 12, color: '#70767d', overflowWrap: 'anywhere' } }, `变更文件：${origin.changed_paths.join('、')}`) : null,
          h('button', { type: 'button', className: 'b03-task-run', onClick: () => {
            const parent = taskItems.find(task => task.task_id === selectedTask.source_task_id && task.run_id === origin.parent_run_id
              && normalizedPathIdentity(task.data_root) === normalizedPathIdentity(selectedTask.data_root))
            if (parent) chooseTask(parent)
            else showActionNotice(`来源任务已不在当前工作区，原 Run 为 ${origin.parent_run_id}。本次冻结参考仍可使用。`, true)
          } }, '查看来源分析', runIcon('ArrowUpRight')),
          h('span', { style: { marginLeft: 10, fontSize: 12, color: '#70767d' } }, origin.parent_run_id),
          h('span', { style: { marginLeft: 12, fontSize: 12, color: '#70767d' } }, '本页展示本次新增或修订的结果'))
      }
      async function deliverCurrentRun(propagate = false) {
        if (!current || !selectedTask) return
        try {
          await requestWorkbenchAction({ cwd, action: 'deliver-current', payload: { task_id: selectedTask.task_id, run_id: current.run_id, data_root: selectedTask.data_root } })
          showActionNotice('已交付当前保存结果；未完成修正和未解决事项保留，质量状态为 UNRESOLVED。')
          await Promise.all([load(), loadWorkbench()])
        } catch (reason) { showActionNotice(`交付未完成：${reason instanceof Error ? reason.message : String(reason)}`, true); if (propagate) throw reason }
      }
      async function stopCurrentRun(propagate = false) {
        if (!cwd || !current || current.terminal) return
        try {
          const stopped = await requestWorkbenchAction({ cwd, action: 'stop', payload: { task_id: selectedTask?.task_id, run_id: current.run_id, data_root: snapshot?.data_root, attempt_id: selectedTask?.attempt_id } })
          const stopErrors = [stopped.run_stop, stopped.session_cancel, stopped.job_stop].filter(item => item?.status === 'error').map(item => item.error)
          if (propagate && (stopErrors.length || stopped.stop_confirmed === false)) {
            await Promise.all([load(), loadWorkbench()])
            throw new Error(stopErrors.join('；') || stopped.error || '已请求停止，执行端尚未确认结束，请稍后重试。')
          }
          if (stopped.run_stop?.status === 'error') {
            showActionNotice(`Agent 已停止，但 PANGEA 状态同步失败：${stopped.run_stop.error}`, true)
          } else if (stopped.session_cancel?.status === 'error') {
            showActionNotice(`Run 已停止；DSH 会话取消失败：${stopped.session_cancel.error}`, true)
          } else if (stopped.job_stop?.status === 'error') {
            showActionNotice(`Run 已停止；ACP Agent 停止失败：${stopped.job_stop.error}`, true)
          } else if (stopped.stop_confirmed === false || stopped.job_stop?.result === 'requested') {
            showActionNotice(`已请求停止 ${current.run_id}，等待执行端确认`, true)
          } else {
            showActionNotice(`已停止 ${current.run_id}`)
          }
          await Promise.all([load(), loadWorkbench()])
        } catch (reason) {
          showActionNotice(`停止失败：${reason instanceof Error ? reason.message : String(reason)}`, true)
          if (propagate) throw reason
        }
      }
      function toggleCase(testCaseId) {
        if (!hasText(testCaseId)) return
        setSelectedCaseIds(values => values.includes(testCaseId)
          ? values.filter(value => value !== testCaseId)
          : [...values, testCaseId])
      }
      function editEnvironment(environment) {
        setEnvironmentForm({
          id: environment.id,
          name: environment.name,
          advanced: (environment.host?.port ?? 22) !== 22 || (environment.array?.port ?? 22) !== 22,
          host_ip: environment.host?.ip ?? '',
          host_username: environment.host?.username ?? '',
          host_password: environment.host?.password ?? '',
          host_port: String(environment.host?.port ?? 22),
          array_ip: environment.array?.ip ?? '',
          array_username: environment.array?.username ?? '',
          array_password: environment.array?.password ?? '',
          array_port: String(environment.array?.port ?? 22),
        })
        setEnvironmentTests({ host: { state: 'idle' }, array: { state: 'idle' } })
        jump('environment')
      }
      function environmentEndpoint(kind) {
        const prefix = kind === 'host' ? 'host' : 'array'
        const ip = environmentForm[`${prefix}_ip`].trim()
        if (!ip) return null
        return {
          ip,
          username: environmentForm[`${prefix}_username`].trim(),
          password: environmentForm[`${prefix}_password`],
          port: Number(environmentForm[`${prefix}_port`] || 22),
        }
      }
      async function submitEnvironment() {
        try {
          const host = environmentEndpoint('host')
          const array = environmentEndpoint('array')
          if (!environmentForm.name.trim()) throw new Error('请填写环境名称')
          if (!host && !array) throw new Error('请至少配置测试主机或存储阵列')
          const saved = await saveEnvironment({ id: environmentForm.id || undefined, name: environmentForm.name.trim(), host, array })
          await loadEnvironments()
          setSelectedEnvironment(saved.id)
          setEnvironmentForm(emptyEnvironmentForm())
          setEnvironmentTests({ host: { state: 'idle' }, array: { state: 'idle' } })
          showActionNotice(`测试环境 ${saved.name} 已保存。`)
        } catch (reason) {
          showActionNotice(`保存失败：${reason instanceof Error ? reason.message : String(reason)}`, true)
        }
      }
      async function testEnvironment(kind) {
        const endpoint = environmentEndpoint(kind)
        if (!endpoint) {
          setEnvironmentTests(value => ({ ...value, [kind]: { state: 'error', message: '请先填写 IP、用户名和密码' } }))
          return
        }
        setEnvironmentTests(value => ({ ...value, [kind]: { state: 'testing' } }))
        try {
          await testEnvironmentConnection(endpoint)
          setEnvironmentTests(value => ({ ...value, [kind]: { state: 'ok', message: '连接成功' } }))
        } catch (reason) {
          setEnvironmentTests(value => ({ ...value, [kind]: { state: 'error', message: reason instanceof Error ? reason.message : String(reason) } }))
        }
      }
      async function deleteEnvironment(id) {
        try {
          await removeEnvironment(id)
          await loadEnvironments()
          showActionNotice('执行环境已删除。')
        } catch (reason) {
          showActionNotice(`删除失败：${reason instanceof Error ? reason.message : String(reason)}`, true)
        }
      }
      async function startSelectedCases() {
        if (!current || !snapshot?.data_root || selectedCaseIds.length === 0 || !selectedEnvironment) return
        setLaunching(true)
        try {
          const launched = await launchExecution({
            workspace_id: scope?.workspaceId ?? scope?.workspace?.workspaceId,
            analysis_run_id: current.run_id,
            test_case_ids: testCases.filter(item => selectedCaseIds.includes(caseIdentity(item))).map(item => item.test_case_id),
            environment_id: selectedEnvironment,
            data_root: snapshot.data_root,
          })
          showActionNotice(`已启动执行会话：${launched.session_id}`)
          ctx?.sessions?.open?.(launched.session_id)
        } catch (reason) {
          showActionNotice(`启动失败：${reason instanceof Error ? reason.message : String(reason)}`, true)
        } finally {
          setLaunching(false)
        }
      }
      async function exportCurrentCases(format = 'csv') {
        if (!current?.run_id || !snapshot?.data_root) return false
        try {
          if (caseExportScope !== 'all' && !reviews) throw new Error('评审范围尚未读取，请刷新后重新确认导出范围。')
          const result = await requestRunExport({ cwd, dataRoot: snapshot.data_root, runId: current.run_id, format, ...(reviews ? { scope: caseExportScope, caseKeys: caseExportScope === 'filtered' ? filteredCaseRows.map(caseIdentity) : selectedCaseIds, caseSetRevision: reviews.case_set_revision, reviewRevision: reviews.revision } : {}) })
          if (!result.blob?.size) throw new Error('导出服务未返回文件内容')
          const objectUrl = URL.createObjectURL(result.blob)
          const anchor = document.createElement('a')
          anchor.href = objectUrl
          anchor.download = result.filename
          anchor.style.display = 'none'
          document.body.appendChild(anchor)
          anchor.click()
          anchor.remove()
          window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
          showActionNotice(`测试用例${format === 'csv-bundle' ? '及执行依据（ZIP）' : ` ${format.toUpperCase()}`} 已导出。`)
          return true
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason)
          setCaseExportError(message)
          showActionNotice(`导出失败：${message}`, true)
          return false
        }
      }
      async function exportOfflineReport() {
        if (!current?.run_id || !snapshot?.data_root) return
        try {
          const result = await requestRunExport({ cwd, dataRoot: snapshot.data_root, runId: current.run_id, format: 'report-bundle' })
          if (!result.blob?.size) throw new Error('导出服务未返回文件内容')
          downloadBlob(result.blob, result.filename)
          showActionNotice('离线图文报告已导出。')
        } catch (error) { showActionNotice(`报告导出失败：${error.message}`, true) }
      }
      async function copySelectedCases() {
        const selected = testCases.filter(item => selectedCaseIds.includes(caseIdentity(item)))
        if (selected.length === 0) {
          showActionNotice('请先选择至少一条已编号用例。', true)
          return
        }
        const content = selected.map(item => [
          `${item.display_id ?? item.test_case_id} · ${text(item.title, '未命名用例')}`,
          `前置条件：${Array.isArray(item.preconditions) ? item.preconditions.join('；') : text(item.preconditions, '未记录')}`,
          ...(Array.isArray(item.step_pairs) && item.step_pairs.length
            ? item.step_pairs.map((step, index) => `${index + 1}. ${step.action || '未提供操作'} → ${step.expected || '未提供逐步预期'}`)
            : [`步骤：${Array.isArray(item.steps) ? item.steps.join('；') : text(item.steps, '未记录')}`]),
          `整体预期：${Array.isArray(item.expected_results) ? item.expected_results.join('；') : text(item.expected_results, '未记录')}`,
          `观察点：${Array.isArray(item.observability) ? item.observability.join('；') : text(item.observability, '未记录')}`,
          `清理：${Array.isArray(item.cleanup) ? item.cleanup.join('；') : text(item.cleanup, '未记录')}`,
          ...caseVariantLines(item),
        ].join('\n')).join('\n\n')
        try {
          if (!globalThis.navigator?.clipboard?.writeText) throw new Error('当前环境不支持剪贴板写入')
          await globalThis.navigator.clipboard.writeText(content)
          showActionNotice(`已复制 ${selected.length} 条测试用例。`)
        } catch (reason) {
          showActionNotice(`复制失败：${reason instanceof Error ? reason.message : String(reason)}`, true)
        }
      }
      function openSidebarFile(value, title) {
        const path = absoluteWorkspacePath(cwd, value)
        if (!path || !ctx?.pangea?.openFile || !scope?.sessionId) {
          showActionNotice('当前会话无法打开这个文件。', true)
          return
        }
        ctx.pangea.openFile(scope, path, title)
        showActionNotice(`已在侧栏打开 ${title ?? text(value, '文件')}`)
      }
      async function addToConversation(kind, item, intent = 'review', sourceSnippet) {
        const draft = buildDiscussionDraft({ kind, item, intent, runId: current?.run_id, run: current, risks, testCases, sourceSnippet })
        try {
          const inserted = await appendToDiscussionConversation(draft)
          showActionNotice(inserted ? '已加入讨论会话，可以直接发送。' : '无法访问讨论会话输入框。', !inserted)
        } catch (reason) {
          showActionNotice(`无法打开讨论会话：${reason instanceof Error ? reason.message : String(reason)}`, true)
        }
      }
      function toggleRiskEvidence(key) {
        const evidenceKeys = selectedRiskEvidenceKeys.includes(key)
          ? selectedRiskEvidenceKeys.filter(item => item !== key)
          : [...selectedRiskEvidenceKeys, key]
        setRiskEvidenceSetSelection({ riskKey: riskScreenKey, evidenceKeys })
        setRiskEvidenceSelection({ riskKey: riskScreenKey, evidenceKey: key })
      }
      async function addRiskSelectionToConversation(risk, intent) {
        const selectedEvidence = riskEvidenceOptions.filter(item => selectedRiskEvidenceKeys.includes(evidenceIdentity(item)))
        if (!selectedRiskClaim || selectedEvidence.length === 0) {
          showActionNotice('请先选择一条结论和至少一条证据。', true)
          return
        }
        showActionNotice(`正在读取 ${selectedEvidence.length} 条证据源码…`)
        try {
          const sourceSnippets = await Promise.all(selectedEvidence.map(item => requestSourceSnippet({
            cwd, dataRoot: snapshot?.data_root, runId: current?.run_id, location: item.location,
          })))
          const draft = buildDiscussionDraft({
            kind: 'risk', item: risk, intent, runId: current?.run_id, run: current, risks, testCases,
            selectedClaim: selectedRiskClaim, sourceSnippets,
          })
          const inserted = await appendToDiscussionConversation(draft)
          showActionNotice(inserted ? `已加入讨论会话（${selectedEvidence.length} 条证据），可以直接发送。` : '无法访问讨论会话输入框。', !inserted)
        } catch (reason) {
          showActionNotice(`无法读取选中证据：${reason instanceof Error ? reason.message : String(reason)}`, true)
        }
      }
      function renderDiscussionCard(kind, item, evidenceSnippet) {
        const secondaryActions = kind === 'risk'
          ? [chip('查找覆盖缺口', () => addToConversation(kind, item, 'coverage'))]
          : [evidenceSnippet ? chip('检查证据', () => addToConversation(kind, item, 'evidence', evidenceSnippet)) : null, chip('转成测试语言', () => addToConversation(kind, item, 'executable')), chip('查找覆盖缺口', () => addToConversation(kind, item, 'coverage'))]
        return h('div', { style: { ...styles.card, ...styles.actionCard } },
          h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, '和 DSH 讨论'), h('span', { style: styles.badge }, '局部上下文')),
          h('div', { style: styles.itemMeta }, '带上当前对象、直接证据和关联项，在独立讨论会话中继续。'),
          h('button', { type: 'button', style: { ...styles.primaryButton, marginTop: 9 }, onClick: () => { void addToConversation(kind, item, 'review') } }, '在讨论会话中继续'),
          h('div', { style: styles.chips }, secondaryActions))
      }
      function renderRiskSelectionWorkbench(risk) {
        if (riskClaims.length === 0 || riskEvidenceOptions.length === 0) return null
        const ready = Boolean(selectedRiskClaim && selectedRiskEvidenceKeys.length)
        return h('div', { style: { ...styles.card, ...styles.actionCard } },
          h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, '定向核对与测试'), h('span', { style: styles.badge }, `已选 ${selectedRiskEvidenceKeys.length} 条证据`)),
          h('div', { style: { ...styles.label, marginTop: 9 } }, '选择待核对结论'),
          h('div', { style: styles.choiceGrid, role: 'group', 'aria-label': '选择风险结论' }, riskClaims.map((claim, index) => h('button', {
            key: `${index}:${claim}`, type: 'button', 'aria-pressed': claim === selectedRiskClaim,
            style: { ...styles.choiceButton, ...(claim === selectedRiskClaim ? styles.choiceButtonActive : {}) },
            onClick: () => setRiskClaimSelection({ riskKey: riskScreenKey, claim }),
          }, `${index + 1}. ${claim}`))),
          h('div', { style: { ...styles.label, marginTop: 10 } }, '选择证据'),
          h('div', { style: styles.evidenceChecks, role: 'group', 'aria-label': '选择核对证据' }, riskEvidenceOptions.map((option, index) => {
            const key = evidenceIdentity(option)
            const checked = selectedRiskEvidenceKeys.includes(key)
            return h('label', { key, style: { ...styles.evidenceCheck, ...(checked ? styles.evidenceCheckSelected : {}) } },
              h('input', { type: 'checkbox', checked, 'aria-label': `选择证据 ${evidenceTabLabel(option, index)}`, onChange: () => toggleRiskEvidence(key) }),
              h('span', null, evidenceTabLabel(option, index)))
          })),
          h('div', { style: styles.chips },
            h('button', { type: 'button', disabled: !ready, style: { ...styles.button, ...(!ready ? styles.buttonDisabled : {}) }, onClick: () => { void addRiskSelectionToConversation(risk, 'evidence') } }, '核对选中证据'),
            h('button', { type: 'button', disabled: !ready, style: { ...styles.button, ...(!ready ? styles.buttonDisabled : {}) }, onClick: () => { void addRiskSelectionToConversation(risk, 'targeted-executable') } }, '转成定向测试')))
      }
      function renderSourcePreview(kind, item, evidenceItem, evidenceOptions = []) {
        if (!evidenceItem?.location) return null
        const preview = sourcePreview.key === previewKey ? sourcePreview : { status: 'loading' }
        const snippet = preview.status === 'ready' ? preview.value : undefined
        const sourcePath = snippet?.file_path ?? (current?.workflow_version === 'source-first-v1' ? undefined : evidenceFilePath(evidenceItem.location, cwd, snapshot?.data_root, current?.artifacts?.run_directory))
        return h('div', { style: styles.card },
          h('div', { style: styles.row },
            h('div', { style: styles.itemTitle }, '源码片段'),
            snippet ? h('span', { style: styles.badge }, `L${snippet.target_start}–${snippet.target_end}`) : null),
          evidenceOptions.length > 1 ? h('div', { style: styles.evidenceTabs, role: 'group', 'aria-label': '选择风险证据源码' }, evidenceOptions.map((option, index) => {
            const key = evidenceIdentity(option)
            const active = key === evidenceIdentity(evidenceItem)
            const label = evidenceTabLabel(option, index)
            return h('button', {
              key, type: 'button', title: option.location, 'aria-pressed': active,
              style: { ...styles.evidenceTab, ...(active ? styles.evidenceTabActive : {}) },
              onClick: () => setRiskEvidenceSelection({ riskKey: riskScreenKey, evidenceKey: key }),
            }, label)
          })) : null,
          h('div', { style: styles.itemMeta }, evidenceItem.location),
          preview.status === 'loading' ? h('div', { style: { ...styles.empty, marginTop: 8 } }, '正在读取证据源码…') : null,
          preview.status === 'error' ? h('div', { style: { ...styles.error, marginTop: 8 } }, `无法预览：${preview.error}`) : null,
          snippet ? h('div', { style: styles.source, role: 'region', 'aria-label': `源码 ${snippet.visible_start} 到 ${snippet.visible_end} 行` },
            snippet.lines.map(line => h('div', { key: line.number, style: { ...styles.sourceLine, ...(line.target ? styles.sourceTarget : {}) } },
              h('span', { style: styles.sourceNumber }, line.number), h('span', { style: styles.sourceCode }, line.text || ' ')))) : null,
          snippet?.truncated ? h('div', { style: styles.itemMeta }, '证据范围较长，当前只显示前 160 行。') : null,
          h('div', { style: styles.chips },
            sourcePath ? chip('打开完整文件', () => openSidebarFile(sourcePath)) : null,
            snippet && kind !== 'risk' ? chip('检查这段源码', () => addToConversation(kind, item, 'evidence', snippet)) : null))
      }

      function renderB05SourceDrawer(kind, item) {
        if (!sourceDrawerOpen || !previewEvidence?.location) return null
        const preview = sourcePreview.key === previewKey ? sourcePreview : { status: 'loading' }
        const snippet = preview.status === 'ready' ? preview.value : null
        const title = kind === 'risk' ? `风险 ${item?.display_id || item?.risk_id || '未编号'}` : `用例 ${item?.display_id || item?.test_case_id || '未编号'}`
        return h('div', { className: 'b05-source-layer', onClick: event => { if (event.target === event.currentTarget) setSourceDrawerOpen(false) } },
          h('aside', { className: 'b05-source-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': '源码依据', onKeyDown: event => { if (event.key === 'Escape') { event.stopPropagation(); setSourceDrawerOpen(false) } } },
            h('header', null, h('div', null, h('small', null, 'SOURCE / 冻结源码'), h('h2', null, '源码依据'), h('div', { style: styles.itemMeta }, title)),
              h('button', { type: 'button', 'aria-label': '关闭源码依据', autoFocus: true, onClick: () => setSourceDrawerOpen(false) }, '×')),
            h('div', { className: 'b05-source-meta' }, h('span', null, displayEvidenceLocation(previewEvidence.location)), h('span', { style: styles.badge }, `${taskRunLabel(current?.run_id)} 快照`)),
            preview.status === 'error' ? h(React.Fragment, null,
              h('div', { className: 'b05-source-failure', role: 'alert' }, h('strong', null, '暂时无法读取源码片段'), h('p', null, `文件位置与结论已保留，可重试读取，或关闭预览继续阅读。${preview.error ? ` ${preview.error}` : ''}`)),
              h('button', { type: 'button', onClick: () => setSourceRetry(value => value + 1) }, '重试读取')) : null,
            preview.status === 'loading' ? h('p', { role: 'status' }, '正在读取本 Run 冻结源码…') : null,
            snippet ? h(React.Fragment, null,
              h('div', { className: 'b05-source-context' }, h('strong', null, '关联位置'), h('div', null, `${title} · ${item?.title || item?.verification_goal || '当前分析记录'}`)),
              h('div', { className: 'b05-source-code', role: 'region', 'aria-label': `源码 ${snippet.visible_start} 到 ${snippet.visible_end} 行` },
                snippet.lines.map(line => h('div', { key: line.number, className: 'b05-source-code-line', 'data-target': line.target ? 'true' : undefined }, h('span', null, line.number), h('code', null, line.text || ' ')))),
              h('p', { style: styles.itemMeta }, '高亮行对应当前结论的引用位置。')) : null,
            h('footer', null, h('span', { style: styles.itemMeta }, title),
              h('div', { style: styles.row }, snippet?.file_path ? h('button', { type: 'button', onClick: () => openSidebarFile(snippet.file_path) }, '打开完整文件') : null,
                snippet && kind === 'case' ? h('button', { type: 'button', onClick: () => { void addToConversation('case', item, 'evidence', snippet) } }, '检查这段源码') : null,
                h('button', { type: 'button', onClick: () => setSourceDrawerOpen(false) }, kind === 'risk' ? '返回风险' : '返回用例')))))
      }

      const total = current?.analysis?.total ?? 0
      const completed = current?.analysis?.completed ?? 0
      const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0
      const activeNav = navType(screen)
      const screenTitle = screen.type === 'home' ? '测试工作台'
        : screen.type === 'tasks' ? '分析任务'
        : screen.type === 'overview' ? 'PANGEA 总览'
        : screen.type === 'run-record' ? '运行记录'
        : screen.type === 'report' ? '分析报告'
        : screen.type === 'create' ? '新建分析'
          : screen.type === 'workflow' ? '运行过程'
          : screen.type === 'coverage' ? '覆盖缺口'
            : screen.type === 'flows' ? '业务流程'
          : screen.type === 'risks' ? '风险'
          : screen.type === 'risk' ? (riskById.get(screen.id)?.display_id || riskById.get(screen.id)?.risk_id || '风险详情')
            : screen.type === 'cases' ? '测试用例'
              : screen.type === 'case' ? (caseById.get(screen.id)?.display_id || caseById.get(screen.id)?.test_case_id || '用例详情')
                : screen.type === 'evidence' ? '证据'
                  : screen.type === 'evidence-detail' ? '证据详情'
                    : screen.type === 'execution' ? '执行结果'
                      : screen.type === 'environment' ? (environmentForm.id ? '编辑测试环境' : '新增测试环境')
                        : screen.type === 'repository-import' ? '添加源码仓库' : 'PANGEA 总览'

      const isTaskOverview = pageMode === 'analysis' && ['overview', 'flows', 'risks', 'risk', 'cases', 'case', 'coverage-cases'].includes(screen.type)
      const navigationItems = pageMode !== 'analysis' || !selectedTask || ['tasks', 'create'].includes(screen.type) ? [] : isTaskOverview ? [
        ['overview', '概览'], ['flows', `业务流程 ${displayCount('business_flows', businessFlows.length).replace('（草稿）', '')}`],
        ...(riskEnabled ? [['risks', `风险 ${displayCount('risks', risks.length).replace('（草稿）', '')}`]] : []),
        ['cases', `${current?.scenario === 'coverage-analysis' ? '补测用例' : '测试用例'} ${displayCount('test_cases', testCases.length).replace('（草稿）', '')}`], ['workflow', '运行过程'],
      ] : [
        ['overview', '概览'], ['flows', '业务流程'], ...(riskEnabled ? [['risks', '风险']] : []), ['cases', current?.scenario === 'coverage-analysis' ? '补测用例' : '测试用例'], ['evidence', '源码依据'], ['workflow', '运行过程'],
      ]
      const navigation = navigationItems.length ? h('nav', { className: isTaskOverview ? 'b03-overview-nav' : undefined, style: styles.nav, 'aria-label': 'PANGEA 分析页面' }, navigationItems.map(([type, label]) => h('button', {
        key: type,
        type: 'button',
        className: isTaskOverview ? 'b03-overview-nav-button' : undefined,
        'aria-current': activeNav === type ? 'page' : undefined,
        style: { ...styles.navButton, ...(activeNav === type ? styles.navActive : {}) },
        onClick: () => jump(type),
      }, label))) : null

      const refreshBusy = loading || workbenchLoading
      function renderRefreshButton() {
        return h('button', {
          type: 'button',
          disabled: refreshBusy,
          'aria-busy': refreshBusy,
          style: { ...styles.button, ...(refreshBusy ? styles.buttonDisabled : {}) },
          onClick: () => { void (pageMode === 'execution' ? loadEnvironments()
            : pageMode === 'home' ? Promise.all([loadWorkbench(), loadRepositories()])
              : Promise.all([load({ foreground: true }), loadWorkbench()])) },
        }, refreshBusy ? '刷新中…' : '刷新')
      }

      const header = h('div', { style: styles.sticky }, pageHeader({ title: screenTitle, task: selectedTask, current, ui: ctx.pangea?.ui, onBack: screen.type === 'environment' ? undefined : goBack, actions: renderRefreshButton() }), navigation)

      function countCheck(key) { return health?.count_checks?.[key] }
      function displayCount(key, number) {
        const presentation = deriveRunPresentation(selectedTask, current, health)
        if (presentation.countsAvailability === 'unpublished') return '尚未发布'
        if (presentation.countsAvailability === 'unavailable') return '不可读取'
        const check = countCheck(key)
        if (check?.status === 'mismatch') return `${number} / 报告 ${check.report}`
        if (number === null || number === undefined) return '暂不可读取'
        if (presentation.countsAvailability === 'draft') return `${number}（草稿）`
        return String(number)
      }
      function metric(number, name, target, countKey) {
        const props = target ? { type: 'button', onClick: () => jump(target), style: { ...styles.metric, ...styles.metricClickable } } : { style: styles.metric }
        return h(target ? 'button' : 'div', props, h('div', { style: styles.metricNumber }, countKey ? displayCount(countKey, number) : String(number ?? 0)), h('div', { style: styles.metricName }, name))
      }
      function collectionEmpty(key, normal) {
        if (['unpublished', 'unavailable'].includes(deriveRunPresentation(selectedTask, current, health).countsAvailability)) return '结果尚不可用，暂不显示空列表结论。'
        return collectionWarning(health, key) ? '数据读取异常：不能把空列表解释为“没有数据”。' : normal
      }
      function renderResultCount(shown, total, hasFilters, reset) {
        return h('div', { style: styles.toolbar },
          h('span', { style: styles.itemMeta, role: 'status' }, `显示 ${shown} / ${total} 条`),
          hasFilters ? h('button', { type: 'button', style: styles.backButton, onClick: reset }, '清除筛选') : null)
      }
      function healthStyle(status = deriveRunPresentation(selectedTask, current, health).healthStatus) {
        if (status === 'error') return { ...styles.card, ...styles.healthError }
        if (status === 'warning') return { ...styles.card, ...styles.healthWarning }
        if (status === 'ok') return { ...styles.card, ...styles.healthOk }
        return { ...styles.card, ...styles.notice }
      }
      function renderHealthCard(compact = false) {
        if (!health) return null
        const healthStatus = health.status ?? 'pending'
        const checks = ['risks', 'test_cases', 'business_flows']
          .map(key => [key, health.count_checks?.[key]])
          .filter(([, check]) => check?.report !== null && check?.report !== undefined)
        const names = { risks: '风险', test_cases: '测试用例', business_flows: '业务流程' }
        const warning = healthStatus === 'warning' || healthStatus === 'error'
        return h('div', { style: healthStyle(healthStatus), role: warning ? 'alert' : 'status' },
          h('div', { style: styles.row },
            h('div', { style: styles.itemTitle }, compact && warning ? '数据读取异常' : '数据状态'),
            h('span', { style: styles.badge }, HEALTH[healthStatus] ?? (healthStatus === 'pending' ? '待发布' : healthStatus) ?? '未知')),
          h('div', { style: styles.itemMeta }, `数据源：${SOURCE[current?.data_source] ?? current?.data_source ?? '未知'}`),
          current?.reader_notices?.length ? h('div', { style: { ...styles.itemMeta, marginTop: 7 } }, current.reader_notices.join(' ')) : null,
          checks.length ? h('div', { style: { ...styles.itemMeta, marginTop: 5 } }, checks.map(([key, check]) => `${names[key]} ${check.structured}${check.status === 'match' ? ' = ' : ' ≠ '}报告 ${check.report}`).join(' · ')) : null,
          warning && healthStatus === 'warning' ? h('div', { style: { ...styles.error, marginTop: 7 } }, '当前 Run 存在读取诊断，请查看具体影响项。空风险列表本身不代表读取失败。') : null,
          !compact && health.issues?.length ? h('ul', { style: styles.list }, health.issues.map((item, index) => h('li', { key: `${index}:${item}` }, item))) : null)
      }

      function renderMonitor() {
        if (!current) return h('div', { style: styles.monitorHero },
          h('div', { style: styles.monitorState }, '等待 PANGEA Run'),
          h('div', { style: styles.monitorHint }, '当前工作区还没有可关联的 Run。Agent 运行状态会在 Run 出现后自动合并到这里。'))

        const historicalView = Boolean(selectedRun) || Boolean(monitoredRun?.run_id && monitoredSession?.bound_run_id && monitoredRun.run_id !== monitoredSession.bound_run_id)
        const liveForRun = monitoredRun?.session_live === true && !historicalView
        const historicalRun = historicalView || Boolean(monitoredRun && !liveForRun)
        const stateTitle = liveForRun
          ? monitoredSession?.status === 'running' ? 'Agent 运行中' : 'Agent 当前空闲'
          : historicalRun ? '历史运行摘要' : monitoredSession?.status === 'running' ? 'Agent 运行中，等待关联' : '等待运行'
        const stateHint = liveForRun
          ? `当前 DSH 会话已关联 ${current.run_id}，页面每 4 秒同步 PANGEA 产物。`
          : historicalRun
            ? monitoredRun ? monitorPersistenceDegraded ? '这份最小运行摘要与 PANGEA Run 分别记录；监控记录保存状态见上方提示。' : '原 DSH 会话可以被删除；这份最小运行摘要与 PANGEA Run 独立保留。' : '这个 Run 早于监控功能或未在当前设备记录；PANGEA 产物仍可完整浏览。'
            : '当前还没有捕获到可显示的运行事件。'
        const activeTools = liveForRun ? monitoredSession?.active_tools ?? [] : []
        const activeSubagents = liveForRun ? monitoredSession?.active_subagents ?? [] : []
        const timeline = monitoredRun?.timeline ?? []

        const stateColor = liveForRun && monitoredSession?.status === 'running'
          ? 'var(--dsw-alias-state-success-primary, #38a892)'
          : 'var(--dsw-alias-label-primary, inherit)'

        return h(React.Fragment, null,
          h('div', { style: styles.monitorHero },
            h('div', { style: styles.row },
              h('div', { style: { ...styles.monitorState, color: stateColor } }, stateTitle),
              h('span', { style: styles.badge }, liveForRun ? '当前会话' : historicalRun ? '历史 Run' : '未关联')),
            h('div', { style: styles.monitorHint }, stateHint),
            h('div', { style: styles.boundary },
              h('div', { style: styles.grid },
                field('DSH 会话', shortId(monitoredRun?.session_id ?? (historicalRun ? null : monitoredSession?.session_id))),
                field('PANGEA Run', `${runLabel(current)} · ${current.run_id}`),
                field('Agent 状态', liveForRun ? monitoredSession.status === 'running' ? '运行中' : '空闲' : monitoredRun ? '会话已结束或已删除' : '原会话未记录'),
                field('PANGEA 阶段', current.phase_title ?? PHASE[current.phase] ?? current.phase)),
              h('div', { style: { ...styles.itemMeta, marginTop: 10 } }, `状态更新：${current.state_read?.updated_at ?? formatTime(current.state_read?.mtime_ms ?? current.modified_at)}`),
              h('div', { style: styles.itemMeta }, `本次读取：${formatTime(current.state_read?.observed_at)}${error ? '（刷新失败，显示最近成功快照）' : ''}`))),

          h('div', { style: styles.sectionTitle }, '当前执行'),
          h('div', { style: styles.card },
            h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, '工具调用'), h('span', { style: styles.badge }, `${activeTools.length} 个进行中`)),
            activeTools.length ? h('div', { style: styles.boundary }, activeTools.map(item => h('div', { key: item.key, style: { marginBottom: 8 } },
              h('div', { style: styles.value }, item.title),
              h('div', { style: styles.itemMeta }, `已运行 ${durationLabel(item.time)} · ${formatTime(item.time)}`))))
              : h('div', { style: { ...styles.empty, marginTop: 8 } }, liveForRun ? '当前没有正在执行的工具。' : '历史摘要不保留实时工具状态。'),
            h('div', { style: styles.boundary },
              h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, '子 Agent / 工作流成员'), h('span', { style: styles.badge }, `${activeSubagents.length} 个活动`)),
              activeSubagents.length ? activeSubagents.map(item => h('div', { key: item.key, style: { marginTop: 8 } },
                h('div', { style: styles.value }, item.title), h('div', { style: styles.itemMeta }, item.detail)))
                : h('div', { style: { ...styles.empty, marginTop: 8 } }, '当前没有活动的子 Agent。'))),

          h('div', { style: styles.sectionTitle }, 'PANGEA 进度'),
          h('div', { style: styles.card },
            h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, current.phase_title ?? PHASE[current.phase] ?? current.phase), h('span', { style: styles.badge }, total > 0 ? `${completed}/${total}` : '正在规划')),
            h('div', { style: styles.progressTrack }, h('div', { style: { ...styles.progressFill, width: `${percent}%` } })),
            h('div', { style: styles.grid },
              field('已完成分析', total > 0 ? `${completed} / ${total}` : '正在规划'),
              field('流程状态', outcomePresentation(current).workflow),
              field('交付完整性', outcomePresentation(current).delivery),
              field('审查方式', outcomePresentation(current).review),
              field('最终语义结论', outcomePresentation(current).semantic),
              field('读取状态', HEALTH[health?.status] ?? health?.status ?? '未知')),
            current.delivery_integrity?.issues?.length ? h('div', { style: styles.boundary, role: 'status' },
              current.delivery_integrity.issues.map((item, index) => h('div', { key: index, style: styles.itemMeta },
                item.test_case_id ? `${item.test_case_id}：缺少 ${(item.missing_fields ?? []).map(key => ({ preconditions: '前置条件', steps: '操作步骤', expected_results: '预期结果', observability: '观测方式', cleanup: '清理或恢复' })[key] ?? key).join('、')}` : item.message ?? '正式用例文档缺失'))) : null),

          h('div', { style: styles.sectionTitle }, `运行时间线（${timeline.length}）`),
          timeline.length ? h('div', { style: { ...styles.card, ...styles.timeline } }, timeline.map((item, index) => {
            const dotColor = item.state === 'error' || item.state === 'failed'
              ? 'var(--dsw-alias-state-error-primary, #e66767)'
              : item.state === 'success' || item.state === 'ended'
                ? 'var(--dsw-alias-state-success-primary, #38a892)'
                : 'var(--dsw-alias-state-business-primary, #4d9ad6)'
            const kind = { agent: 'Agent', tool: '工具', subagent: '子 Agent', worker: '工作流成员', workflow: '工作流', pangea: 'PANGEA', binding: '关联' }[item.kind] ?? '事件'
            return h('div', { key: item.key ?? `${item.kind}:${item.time}:${index}`, style: { ...styles.timelineItem, ...(index === timeline.length - 1 ? { paddingBottom: 0 } : {}) } },
              h('span', { style: { ...styles.timelineDot, background: dotColor }, 'aria-hidden': true }),
              h('div', { style: styles.timelineTime }, `${kind} · ${formatTime(item.time)}${item.ended_at ? ` · ${durationLabel(item.time, item.ended_at)}` : ''}`),
              h('div', { style: styles.timelineTitle }, text(item.title, '未命名事件')),
              item.detail ? h('div', { style: styles.timelineDetail }, item.detail) : null)
          })) : h('div', { style: styles.card }, h('div', { style: styles.empty }, '暂无运行事件。Companion 只记录状态、工具名称和结果，不保存提示词或工具内容。')))
      }

      function renderCompatibility() {
        if (workbenchError) return h('div', { style: { ...styles.card, ...styles.healthError }, role: 'alert' },
          h('div', { style: styles.itemTitle }, workbench ? '同步失败，显示上次任务列表' : '暂时无法读取工作台'),
          h('div', { style: styles.error }, workbenchError),
          h('button', { type: 'button', disabled: workbenchLoading, style: { ...styles.button, marginTop: 10 }, onClick: () => { void loadWorkbench() } }, workbenchLoading ? '正在重试…' : '重试同步'))
        if (!workbench || workbench.compatibility?.compatible === true) return null
        return h('div', { style: { ...styles.card, ...styles.healthError }, role: 'alert' },
          h('div', { style: styles.itemTitle }, '当前 PANGEA 后端与工作台不兼容'),
          h('div', { style: styles.itemMeta }, '请切换到提供 source-first runs / system 稳定接口的 PANGEA 工作区。'),
          h('div', { style: { ...styles.error, marginTop: 7 } }, workbench.compatibility?.error ?? '无法读取后端能力。'))
      }

      function renderCreate() {
        const repositories = workbench?.capabilities?.repositories ?? []
        const providerOptions = workbench?.acp_providers ?? []
        const selectedProvider = providerOptions.find(item => item.id === createForm.provider_id)
        const unavailableProvider = Boolean(createForm.provider_id) && !selectedProvider
        const retiredProvider = ['pangea-claude-code', 'claude-code'].includes(createForm.provider_id)
        const selectedProviderLabel = selectedProvider?.label ?? (createForm.provider_id
          ? retiredProvider ? 'Claude Code（已移除）' : `${createForm.provider_id}（不可用）`
          : '请选择外部 Agent')
        const unavailableProviderMessage = retiredProvider
          ? 'Claude Code 支持已移除，历史任务和结果仍保留。请明确选择其他外部 Agent。'
          : '此前选择的执行器当前不可用。请明确选择其他外部 Agent。'
        const semantic = workbench?.capabilities?.source_first?.version === 'source-first-v1' || workbench?.capabilities?.workflow_versions?.includes('source-first-v1')
        const sceneOptions = workbench?.capabilities?.source_first?.analysis_options_by_profile?.['behavior-test-v2']
        const options = semantic ? sceneOptions ?? workbench.capabilities.source_first?.analysis_options ?? { scenarios: ['module-analysis'], modes: ['depth'] } : null
        const objectiveReady = !sceneOptions?.objectives || sceneOptions.objectives.includes(createForm.objective)
        const supported = (kind, value) => !options || options[kind]?.includes(value)
        const compatible = workbench?.compatibility?.compatible === true
        const execution = analysisExecutionState(createForm, providerOptions, analysisAgentModels, cwd)
        const executionReady = execution.ready
        const sourceScope = createForm.source_scope_text.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
        const selectedCoverage = createForm.asset_ids.some(id => (assetLabels[id] ?? assetCatalog?.assets?.find(item => item.asset_id === id))?.asset_type === 'coverage' && (assetLabels[id] ?? assetCatalog?.assets?.find(item => item.asset_id === id))?.status === 'available')
        const coverageReady = createForm.scenario !== 'coverage-analysis' || (sceneOptions ? selectedCoverage : (createForm.coverage_kind === 'file' ? createForm.coverage_path.trim() : createForm.coverage_kind === 'asset' ? Boolean(createForm.coverage_asset_id) : workbench?.capabilities?.coverage_query_skill?.available && createForm.coverage_product.trim() && createForm.coverage_version.trim() && createForm.coverage_module.trim()))
        const submitBlockReason = !compatible ? '等待工作台就绪后即可创建分析。'
          : !supported('scenarios', createForm.scenario) || !supported('modes', createForm.mode) ? '请选择当前环境支持的分析场景与模式。'
          : !createForm.repository ? '请先选择源码仓库。'
          : !createForm.target.trim() ? '请填写本次分析目标。'
          : !objectiveReady ? '请选择产品行为或接口契约分析目标。'
          : sourceScope.length === 0 ? '请选择源码范围；分析整个仓库请明确选择根目录。'
          : !validScopePreview?.matched_file_count ? '请预览并确认命中的源码文件。'
          : sceneOptions && createForm.asset_ids.some(id => !(assetLabels[id] ?? assetCatalog?.assets?.find(item => item.asset_id === id))?.input_revision) ? '所选资产版本尚未读取，请刷新资产后重新选择。'
          : !coverageReady ? '请先查询、导入或选择可用覆盖率资产。'
          : unavailableProvider ? unavailableProviderMessage
          : !executionReady ? execution.message
          : coverageQueryBusy ? '覆盖率正在查询，请等待查询完成。' : ''
        const canSubmit = !submitBlockReason && !creatingRun
        const assetItems = assetCatalog?.assets ?? []
        const pendingAssetDetails = createForm.asset_ids.filter(id => assetDetailStatus[id] === 'loading')
        const failedAssetDetails = createForm.asset_ids.filter(id => assetDetailStatus[id] === 'error' && !assetLabels[id]?.title)
        const retryAssetDetails = () => setAssetDetailStatus(previous => {
          const next = { ...previous }
          failedAssetDetails.forEach(id => { delete next[id] })
          return next
        })
        const selectedAssets = createForm.asset_ids.map(assetId => assetLabels[assetId] ?? assetItems.find(item => item.asset_id === assetId)
          ?? { asset_id: assetId, title: assetDetailStatus[assetId] === 'loading' ? '正在读取资产详情…' : assetDetailStatus[assetId] === 'error' ? `资产 ${assetId} 详情读取失败` : assetId, status: assetDetailStatus[assetId] === 'loading' ? '正在读取' : '读取失败' })
        const assetPagination = assetCatalog?.pagination
        const assetTypeLabels = { requirement: '需求', design: '设计', historical_defect: '历史缺陷', reference: '参考资料', coverage: '覆盖率', test_case_example: '示例用例' }
        const step = screen.createStep ?? 1
        const view = screen.createView ?? 'inputs'
        const scenes = {
          'module-analysis': ['模块分析', 'ScanSearch', '业务分支、轻量风险与可选覆盖补测。', '模块流程、关键分支、轻量风险与测试用例'],
          'risk-analysis': ['风险分析', 'ShieldAlert', '聚焦有依据的失效风险及验证用例。', '有源码依据的失效风险、触发条件与验证用例'],
          'branch-analysis': ['分支分析', 'GitBranch', '分析业务条件、配置组合、状态与操作顺序。', '业务行为清单、独立用例与参数组合及未决缺口'],
          'coverage-analysis': ['覆盖率分析', 'ChartNoAxesCombined', '依据真实覆盖数据定位缺口并设计补测。', '覆盖缺口、源码匹配依据与补充测试用例'],
        }
        const scene = scenes[createForm.scenario] ?? [createForm.scenario, 'ScanSearch', '', '']
        const targetReady = Boolean(validScopePreview?.matched_file_count > 0 && createForm.repository && createForm.target.trim() && objectiveReady && sourceScope.length && supported('scenarios', createForm.scenario) && supported('modes', createForm.mode))
        const inputsReady = coverageReady && !coverageQueryBusy && (!sceneOptions || selectedAssets.every(item => item.input_revision))
        const go = (next, nextView = 'inputs') => {
          if (creatingRun) return
          if (next > 1 && !targetReady || next > 2 && !inputsReady || next > 3 && !executionReady) { showActionNotice(submitBlockReason || '请先完成前面的设置。', true); return }
          setScreen(value => ({ ...value, createStep: next, createView: nextView }))
        }
        const update = (key, value) => setCreateForm(form => ({ ...form, [key]: value }))
        const button = (text, onClick, variant = '', iconName, disabled = false) => h('button', { type: 'button', className: `btn ${variant}`, onClick, disabled: creatingRun || disabled }, iconName && runIcon(iconName), text)
        const badge = (text, kind = '') => h('span', { className: `badge ${kind}` }, text)
        const field = (label, control, hint) => h('label', { className: 'field' }, h('span', null, label), control, hint && h('span', { className: 'hint' }, hint))
        const input = (label, key, hint, multiline = false) => field(key === 'coverage_b_version' ? h(React.Fragment, null, label, h('span', { className: 'muted small' }, ' 可选')) : label, h(multiline ? 'textarea' : 'input', { 'aria-label': label, className: multiline ? 'mono' : undefined, value: createForm[key] ?? '', placeholder: key === 'coverage_b_version' ? '需要对比的基线版本' : undefined, disabled: creatingRun, onChange: event => update(key, event.target.value) }), hint)
        const notice = (title, detail, kind = 'blue', actions) => h('div', { className: `notice ${kind}`, role: 'status' }, h('div', { className: 'notice-main' }, runIcon(kind === 'good' ? 'CircleCheck' : kind === 'warn' ? 'CircleAlert' : 'Info'), h('div', null, h('strong', null, title), h('p', null, detail))), actions)
        const panel = (content, extra = '') => h('section', { className: `panel ${extra}` }, content)
        const footer = (prev, next, text, disabled = false) => h('div', { className: 'wizard-footer' }, button(step === 1 ? '上一步' : view !== 'inputs' && step === 2 ? '返回输入资料' : '上一步', prev, 'ghost', 'ArrowLeft'), h('div', { className: 'row' }, step === 1 && h('span', { className: 'create-footer-note' }, '第 1 步，共 4 步'), step === 3 && disabled ? h(React.Fragment, null, h('span', { className: 'small', style: { color: '#aa6e33' } }, '模型就绪后可继续'), h('button', { type: 'button', className: 'create-disabled', disabled: true }, text)) : button(text, next, 'primary', step === 4 ? 'Play' : 'ArrowRight', disabled)))
        const assetCard = item => h('div', { key: item.asset_id, className: 'create-asset' }, h('div', { className: 'create-asset-icon' }, runIcon(item.asset_type === 'coverage' ? 'ChartNoAxesCombined' : 'FileText')), h('div', { className: 'create-asset-main' }, h('strong', null, item.title), h('small', null, `${assetTypeLabels[item.asset_type] ?? '资产'} · 修订 ${item.revision ?? '待读取'} · 输入版本 ${item.input_revision ?? '待读取'}${(item.repository_ids ?? []).length ? ` · ${(item.repository_ids ?? []).join('、')}` : ''}`)), badge(item.status === 'available' ? '可用' : item.status ?? '待读取', item.status === 'available' ? 'good' : 'warn'), h('button', { type: 'button', className: 'create-close', 'aria-label': `移除资产 ${item.title}`, disabled: creatingRun, onClick: () => toggleCreateAsset(item.asset_id) }, runIcon('X')))
        const openAssets = (coverageOnly = false) => { setAssetType(coverageOnly ? 'coverage' : ''); setAssetPage(1); setAssetSelectorOpen(true) }
        let context = panel(h(React.Fragment, null,
          h('div', { className: 'create-side-title' }, '本次分析'), badge(createForm.repository || '待选择仓库', 'neutral'),
          h('h3', { className: 'create-context-title' }, createForm.target || '待填写分析目标'), h('p', { className: 'create-copy' }, scene[2]),
          h('dl', { className: 'key-value' }, ['分析场景', scene[0], '分析模式', createForm.mode === 'depth' ? '标准型' : '速度型', '源码范围', validScopePreview ? `${validScopePreview.is_entire_repository ? '整个仓库' : '指定范围'} · ${validScopePreview.matched_file_count} 个源码文件` : '尚未预览命中文件', '输入资料', step > 1 ? `${selectedAssets.length} 份已选资产` : '下一步选择', '执行 Agent', step > 2 ? selectedProviderLabel : '待选择'].map((text, i) => h(i % 2 ? 'dd' : 'dt', { key: i }, text))),
          h('div', { className: 'create-scene-focus' }, h('strong', null, '本次分析重点'), h('p', null, scene[3]), badge(createForm.scenario === 'coverage-analysis' ? '覆盖率输入必需' : '覆盖率输入可选', createForm.scenario === 'coverage-analysis' ? 'warn' : 'neutral')),
          step === 1 && h(React.Fragment, null, h('div', { className: 'create-subhead' }, '分析模式'), field('', h('select', { 'aria-label': '分析模式', value: createForm.mode, onChange: event => update('mode', event.target.value) }, h('option', { value: 'depth', disabled: !supported('modes', 'depth') }, '标准型 · 独立盲审 + 对照复核'), h('option', { value: 'speed', disabled: !supported('modes', 'speed') }, '速度型 · 直接审核，跳过盲审')))),
          step === 3 && !executionReady && h('div', { style: { marginTop: 18 } }, badge('执行设置待完成', 'warn')), h('div', { className: 'divider' }), h('div', { className: 'create-check-item' }, runIcon('ShieldCheck'), h('span', null, '每次运行将保存独立的源码快照与资产版本。'))), 'create-side')
        if (step === 2 && view === 'coverage') context = panel(h(React.Fragment, null,
          h('div', { className: 'create-side-title' }, '覆盖率如何参与分析'), h('h3', { className: 'create-context-title' }, '先获取数据', h('br'), '再匹配源码'),
          h('ol', { className: 'create-plan-list' }, ['读取产品、版本与模块的覆盖记录', '形成带版本的覆盖率资产', '在运行中匹配本次冻结的源码', '识别未覆盖行为与补充用例'].map(text => h('li', { key: text }, text))), h('div', { className: 'divider' }),
          notice('路径匹配在分析时完成', '查询成功仅表示已获取数据，是否适用于本次源码将在运行中核验。'), h('p', { className: 'create-side-note' }, '覆盖率查询进行中时，创建分析暂不可用。')))
        if (step === 2 && view === 'coverage-result') context = panel(h(React.Fragment, null,
          h('div', { className: 'create-side-title' }, '本次查询'), h('dl', { className: 'key-value' }, ['产品', createForm.coverage_product, 'C 版本', createForm.coverage_version, '目录范围', createForm.coverage_module, 'B 版本', createForm.coverage_b_version || '未指定', '资产状态', coverageQueryResult?.asset?.status === 'available' ? badge('可用', 'good') : '不可用'].map((text, i) => h(i % 2 ? 'dd' : 'dt', { key: i }, text))),
          h('div', { className: 'divider' }), h('strong', { className: 'small' }, '可以继续，也可以补全输入'), h('p', { className: 'create-side-note', style: { marginTop: 10 } }, coverageQueryResult?.asset?.status === 'available' ? '已生成可用资产，允许继续创建。缺失来源会保留为分析限制，不能视为完整覆盖结果。' : '当前没有可用覆盖率资产，请重新查询或补充文件。'), h('div', { style: { marginTop: 20 } }, button('补充覆盖率文件', () => go(2, 'coverage'), '', 'FileUp'))))
        if (step === 4) context = panel(h(React.Fragment, null,
          h('div', { className: 'create-side-title' }, '你将获得'), h('h3', { className: 'create-context-title' }, '可追溯的', h('br'), '分析与测试结论'),
          ['按源码划分的分析单元', '模块流程与关键分支', scene[3], '复核结论与最终报告'].map(text => h('div', { key: text, className: 'create-check-item' }, runIcon('Check'), h('span', null, text))), h('div', { className: 'divider' }),
          h('p', { className: 'create-side-note', style: { marginTop: 0 } }, '分析开始后可以随时查看阶段产物。最终结果数量由源码与分析过程决定。'), notice(canSubmit ? '准备就绪' : '创建条件待完成', submitBlockReason || '工作台兼容、资产版本可读、模型可用。', canSubmit ? 'good' : 'warn')))
        let content
        if (step === 1) content = panel(h(React.Fragment, null,
          h('h2', { className: 'create-heading' }, '想分析什么？'), h('p', { className: 'create-copy' }, '选择源码仓库，并明确这次分析关注的行为与边界。'),
          h('div', { className: 'form-grid' }, field('源码仓库', h('div', { className: 'row', style: { flexWrap: 'nowrap' } }, h('select', { 'aria-label': '源码仓库', value: createForm.repository, onChange: event => update('repository', event.target.value) }, h('option', { value: '' }, '选择仓库'), repositories.map(repository => h('option', { key: repository, value: repository }, repository))), button('添加', openRepositoryImport, 'ghost', 'Plus')), createForm.repository ? `本地工作区 / repositories / ${createForm.repository}` : '先添加或选择源码仓库'), input('分析目标', 'target', '使用具体的模块、功能或业务行为命名')),
          sceneOptions?.objectives ? field('分析目标类型', h('select', { 'aria-label': '分析目标类型', value: createForm.objective, onChange: event => update('objective', event.target.value) }, h('option', { value: '' }, '请选择目标类型'), h('option', { value: 'product-behavior' }, '产品行为 · 产品入口、操作及外部结果'), h('option', { value: 'interface-contract' }, '接口契约 · API 输入、顺序、状态及资源责任')), '选择会随本次分析冻结。产品行为沿用可实施黑盒与灰盒70%目标；接口契约与风险场景不设该比例目标。') : null,
          h('div', { className: 'create-subhead' }, '分析场景 ', h('span', { className: 'small muted', style: { fontWeight: 400 } }, '选择本次分析的重点')),
          h('div', { className: 'choice-grid create-scenes', role: 'group', 'aria-label': '分析场景' }, Object.entries(scenes).map(([id, item]) => h('button', { key: id, type: 'button', className: `choice create-option ${createForm.scenario === id ? 'selected' : ''}`, 'aria-pressed': createForm.scenario === id, disabled: !supported('scenarios', id), 'data-scenario': id, onClick: () => update('scenario', id) }, runIcon(item[1]), h('div', null, h('strong', null, item[0]), h('p', null, item[2])), h('span', { className: 'create-scene-check' }, runIcon('CircleCheck'))))),
          h('div', { className: 'create-scope', style: { marginTop: 22 } }, input('源码冻结范围', 'source_scope_text', '相对仓库根目录，每行一个文件或目录；「.」代表整个仓库。', true)),
          h(SourceScopePicker, { cwd, dataRoot: workbench?.data_root, repository: createForm.repository, value: createForm.source_scope_text, preview: validScopePreview, onChange: value => update('source_scope_text', value), onPreview: value => setScopePreview({ ...value, key: createScopeKey }) }),
          footer(() => navigate({ type: 'tasks' }), () => go(2), '下一步 · 输入资料', !targetReady)), 'create-target-panel')
        else if (step === 2 && view === 'inputs') content = panel(h(React.Fragment, null,
          h('div', { className: 'row between' }, h('div', null, h('h2', { className: 'create-heading' }, '让分析理解更多上下文'), h('p', { className: 'create-copy', style: { marginBottom: 0 } }, '选择与目标相关的需求、设计或已有测试资料。')), button('选择资产', () => openAssets(), '', 'Plus')),
          h('div', { className: 'row between', style: { margin: '24px 0 12px' } }, h('strong', { className: 'small' }, `已选资料 ${selectedAssets.length}`), h('span', { className: 'small muted' }, '版本将在创建时绑定')),
          pendingAssetDetails.length ? notice('正在读取资产资料', `正在按资产 ID 读取 ${pendingAssetDetails.length} 份资料的名称与输入版本。`, 'blue') : null,
          failedAssetDetails.length ? notice('资产详情读取失败', '无法确认所选资料的名称与输入版本，请重试后再继续。', 'warn', button('重试读取', retryAssetDetails, '', 'RefreshCw')) : null,
          h('div', { className: 'stack', style: { gap: 10 } }, selectedAssets.length ? selectedAssets.map(assetCard) : h('p', { className: 'create-copy' }, '未选择资产，可直接分析源码。')),
          h('div', { className: 'divider' }), h('div', { className: 'row between' }, h('div', null, h('strong', { className: 'small' }, '覆盖率输入'), h('p', { className: 'create-copy', style: { margin: '7px 0 0' } }, '模块、风险与分支分析可按需添加覆盖率；覆盖率分析需要一份可用输入。')), button('添加覆盖率', () => go(2, 'coverage'), '', 'ChartNoAxesCombined')),
          h('div', { className: 'callout', style: { marginTop: 20 } }, h('div', { className: 'row' }, runIcon('Info'), h('span', { className: 'small' }, `补充资料将用于约束条件与用例设计。${scene[3]}。`))), footer(() => go(1), () => go(3), '下一步 · 执行设置', !inputsReady)))
        else if (step === 2) {
          const acquisition = coverageQueryResult
          const query = async () => { const result = await queryCoverageForAnalysis(); if (result?.asset?.status === 'available') go(2, 'coverage-result') }
          const importFile = async () => { const result = await importCoverageForAnalysis(); if (result?.asset?.status === 'available') go(2, 'coverage-result') }
          const queryReady = compatible && workbench?.capabilities?.coverage_query_skill?.available && !coverageQueryBusy && ['coverage_product', 'coverage_version', 'coverage_module'].every(key => createForm[key]?.trim())
          content = panel(h(React.Fragment, null,
            h('div', { className: 'row between' }, h('div', null, h('h2', { className: 'create-heading' }, view === 'coverage-result' && acquisition?.asset ? '已获取覆盖率数据' : '添加覆盖率输入'), h('p', { className: 'create-copy', style: { marginBottom: 0 } }, view === 'coverage-result' ? [createForm.coverage_product, createForm.coverage_version, createForm.coverage_module].filter(Boolean).join(' / ') : '查询平台数据，或直接使用文件与已有资产。')), h('div', { className: 'row' }, view === 'coverage-result' && acquisition?.status === 'partial' && badge('结果不完整', 'warn'), view !== 'coverage-result' && badge(createForm.scenario === 'coverage-analysis' ? '覆盖率输入必需' : '覆盖率输入可选', createForm.scenario === 'coverage-analysis' ? 'warn' : 'neutral'), button('管理分析资料', () => openAssets(), '', 'Library'))),
            view === 'coverage-result' && acquisition?.asset ? h(React.Fragment, null,
              h('div', { className: 'create-coverage-result-metrics' }, [['覆盖记录', acquisition.record_count ?? '未知', '条'], ['覆盖率资产', createForm.asset_ids.includes(acquisition.asset.asset_id) ? '1' : '0', '份已加入'], ['源码匹配', '待运行核验', '']].map(([label, value, unit]) => h('div', { key: label, className: 'create-result-metric' }, h('span', null, label), h('strong', { style: label === '源码匹配' ? { fontSize: 16, padding: '4px 0' } : undefined }, value, unit && h('span', null, ' '+unit))))),
              notice(acquisition.status === 'partial' ? '部分来源未返回' : '覆盖率数据已获取', acquisition.message || '记录仍需在运行中匹配本次源码，不能视为已确认覆盖缺口。', acquisition.status === 'partial' ? 'warn' : 'good', button('重新查询', query, '', 'RefreshCw', !queryReady)),
              h('p', { className: 'create-copy' }, `目录：${acquisition.scope?.requested ?? createForm.coverage_module} · 实际来源：${acquisition.selected_source ?? '旧格式未指定'} · 唯一文件：${acquisition.summary?.scope_unique_file_count ?? '未记录'}`),
              (acquisition.summary?.per_source ?? []).filter(item => item.source === acquisition.selected_source && item.branches).map((item, index) => h('p', { key: `branch-${index}`, className: 'create-copy' }, `分支：已覆盖 ${item.branches.covered} / 明确未覆盖 ${item.branches.uncovered ?? '未记录'} / 未判定 ${item.branches.indeterminate ?? '未记录'}`)),
              (acquisition.warnings ?? []).map((warning, index) => h('p', { key: index, className: 'create-copy' }, typeof warning === 'string' ? warning : JSON.stringify(warning))),
              h('div', { className: 'create-subhead' }, createForm.asset_ids.includes(acquisition.asset.asset_id) ? '已加入本次分析' : '尚未加入本次分析'),
              createForm.asset_ids.includes(acquisition.asset.asset_id) ? assetCard(acquisition.asset) : h('div', { className: 'callout row between' }, h('span', { className: 'small' }, acquisition.asset.title), button('加入本次分析', () => { setAssetLabels(labels => ({ ...labels, [acquisition.asset.asset_id]: acquisition.asset })); update('asset_ids', [...createForm.asset_ids, acquisition.asset.asset_id]) }, '', 'Plus', creatingRun || acquisition.asset.status !== 'available')),
              h('div', { className: 'create-subhead' }, '数据完整性'), h('table', null, h('thead', null, h('tr', null, ['数据来源', '获取结果', '后续处理'].map(text => h('th', { key: text }, text)))), h('tbody', null, h('tr', null, h('td', null, '覆盖记录'), h('td', null, badge(acquisition.asset.status === 'available' ? '已获取' : '不可用', acquisition.asset.status === 'available' ? 'good' : 'warn')), h('td', null, '随本次源码范围匹配')), (acquisition.missing ?? []).map((item, index) => h('tr', { key: index }, h('td', null, typeof item === 'string' ? item : JSON.stringify(item)), h('td', null, badge('未返回', 'warn')), h('td', null, '可重新查询或补充本地文件'))), h('tr', null, h('td', null, '代码路径映射'), h('td', null, badge('待核验', 'neutral')), h('td', null, '在运行中核对冻结源码')))),
              h('p', { className: 'create-copy', style: { margin: '14px 0 0' } }, `${acquisition.record_count ?? '已取得的'} 条记录不等于 ${acquisition.record_count ?? '相同数量的'} 个已确认缺口；最终结论以分析与证据核验结果为准。`)) : h(React.Fragment, null,
              h('div', { className: 'divider' }), h('div', { className: 'create-subhead', style: { marginTop: 0 } }, '从覆盖率平台查询'),
              h('div', { className: 'form-grid' }, input('产品', 'coverage_product'), input('C 版本', 'coverage_version', '精确填写版本原文，保留空格。'), input('目录范围', 'coverage_module', '完整路径，例如 nvmf_tcp/transxxx/tls/handshake；首段为模块名。'), input('B 版本', 'coverage_b_version'),
                field('包含子目录', h('input', { type: 'checkbox', 'aria-label': '包含子目录', checked: createForm.coverage_recursive !== false, onChange: event => update('coverage_recursive', event.target.checked) })),
                field('报告来源', h('select', { 'aria-label': '报告来源', value: createForm.coverage_source || 'summary', onChange: event => update('coverage_source', event.target.value) }, ...['summary', 'auto', 'llt'].map(value => h('option', { key: value, value }, value))))),
              h('div', { className: 'row between', style: { marginTop: 18 } }, h('div', { className: 'create-footer-note' }, runIcon(workbench?.capabilities?.coverage_query_skill?.available ? 'CircleCheck' : 'CircleAlert'), workbench?.capabilities?.coverage_query_skill?.available ? '查询服务已就绪' : '覆盖率查询服务尚未就绪'), button(coverageQueryBusy ? '正在查询…' : '查询并添加', query, 'primary', 'Search', !queryReady)),
              acquisition && notice(({ error: '查询失败', no_data: '未查询到数据', scope_not_found: '目录范围无覆盖率文件', partial: '查询结果不完整', success: '查询完成' })[acquisition.status] ?? acquisition.status, acquisition.message ?? '请检查输入后重试。', 'warn'),
              h('div', { className: 'create-coverage-methods' }, h('div', { className: 'callout' }, h('div', { className: 'row' }, h('strong', { className: 'small' }, runIcon('FileUp'), ' 本地覆盖率文件')), h('p', { className: 'create-copy', style: { margin: '8px 0 12px' } }, '支持 XLSX 或 combined JSON。'), h('input', { 'aria-label': '覆盖率文件完整路径', placeholder: '输入覆盖率文件完整路径', style: { fontSize: 12, height: 36 }, value: createForm.coverage_path ?? '', onChange: event => update('coverage_path', event.target.value) }), h('div', { className: 'row', style: { marginTop: 10 } }, button('选择文件', async () => { try { const selected = await window.dshDesktopDirectoryPicker.pick({ purpose: 'coverage' }); if (selected) update('coverage_path', selected) } catch (error) { showActionNotice(error.message, true) } }, 'ghost', 'FolderOpen', !window.dshDesktopDirectoryPicker?.pick || coverageQueryBusy), button('解析并添加', importFile, '', null, !createForm.coverage_path?.trim() || coverageQueryBusy))), h('div', { className: 'callout' }, h('strong', { className: 'small' }, runIcon('Library'), ' 已有覆盖率资产'), h('p', { className: 'create-copy', style: { margin: '8px 0 18px' } }, '选择已解析且状态可用的覆盖率资产。其他类型的资产不能替代覆盖率输入。'), button('选择覆盖率资产', () => openAssets(true), '', 'Plus')))),
            footer(() => go(2), () => go(3), view === 'coverage-result' ? '使用当前输入并继续' : '下一步 · 执行设置', !inputsReady)), view === 'coverage-result' ? 'create-result' : 'create-coverage-panel')
        } else if (step === 3) {
          const selectProvider = providerId => {
            setAnalysisAgentModels({ status: 'idle' })
            setCreateForm(form => ({ ...form, provider_id: providerId, agent_model: '', model_route_key: '', external_selection_required: false }))
            try { if (providerId) window.localStorage?.setItem(ACP_PROVIDER_STORAGE_KEY, providerId) } catch { /* storage unavailable */ }
          }
          content = panel(h(React.Fragment, null,
            h('h2', { className: 'create-heading' }, '选择执行分析的 Agent'), h('p', { className: 'create-copy' }, '分析与复核统一使用外部 Agent。模型读取完成并确认可用后，才能继续创建。'),
            h('div', { className: 'form-grid', style: { marginTop: 22 } }, field('外部 Agent', h('select', { 'aria-label': '外部 Agent', value: createForm.provider_id, disabled: creatingRun, onChange: event => selectProvider(event.target.value) }, !createForm.provider_id && h('option', { value: '', disabled: true }, '请选择外部 Agent'), unavailableProvider && h('option', { value: createForm.provider_id, disabled: true }, selectedProviderLabel), providerOptions.map(item => h('option', { key: item.id, value: item.id, disabled: !item.registered }, item.label)))), createForm.provider_id && selectedProvider && h(AgentModelSelect, { providerId: createForm.provider_id, cwd, state: analysisAgentModels, value: createForm.agent_model, disabled: creatingRun, onChange: value => update('agent_model', value), onRefresh: refreshAnalysisAgentModels })),
            h('div', { style: { marginTop: 22 } }, unavailableProvider ? notice(retiredProvider ? 'Claude Code 支持已移除' : '原执行器不可用', unavailableProviderMessage, 'warn') : executionReady ? notice('执行环境已就绪', execution.message, 'good', badge('可用', 'good')) : notice('执行设置尚未就绪', execution.message, 'warn', !analysisProviderRegistered && h('div', { className: 'row' }, button('打开 Agent 设置', () => window.dispatchEvent(new CustomEvent('pangea:open-model-settings', { detail: { mode: 'external' } })), '', 'Settings'), button('重新检测', () => { void loadWorkbench() }, '', 'RefreshCw')))),
            h('div', { className: 'create-subhead' }, '本次执行包含'), h('div', { className: 'grid3' }, [['单元分析', scene[2]], ...(createForm.mode === 'depth' ? [['独立盲审', '独立检查结果与源码'], ['对照复核', '核对分歧，形成交付']] : [['直接审核', '检查结果与源码']])].map(([title, copy]) => h('div', { key: title, className: 'callout' }, h('strong', { className: 'small' }, title), h('p', { className: 'create-copy', style: { margin: '8px 0 0' } }, copy)))), footer(() => go(2), () => go(4), '下一步 · 确认创建', !executionReady)))
        } else {
          const row = (label, title, detail, destination) => h('div', { className: 'create-review-row' }, h('div', { className: 'create-review-label' }, label), h('div', null, h(label === '源码范围' ? 'div' : 'strong', { className: label === '源码范围' ? 'mono small' : undefined, style: { whiteSpace: 'pre-line' } }, title), h('p', { style: { whiteSpace: 'pre-line' } }, detail)), h('button', { type: 'button', className: 'link', disabled: creatingRun, onClick: () => go(destination) }, '修改', runIcon('ArrowUpRight')))
          content = panel(h(React.Fragment, null, h('div', { className: 'row between' }, h('div', null, h('h2', { className: 'create-heading' }, '准备开始分析'), h('p', { className: 'create-copy', style: { marginBottom: 0 } }, '确认范围与输入，创建后可在运行过程中持续查看结果。')), badge(canSubmit ? '创建条件已满足' : '创建条件待完成', canSubmit ? 'good' : 'warn')), h('div', { className: 'divider' }),
            row('分析目标', createForm.target, `${createForm.repository} · ${scene[0]} · ${createForm.mode === 'depth' ? '标准型' : '速度型'}${createForm.objective ? ` · ${createForm.objective === 'product-behavior' ? '产品行为' : '接口契约'}` : ''}`, 1), row('源码范围', sourceScope.join('\n'), validScopePreview ? `${validScopePreview.is_entire_repository ? '整个仓库 · ' : ''}命中 ${validScopePreview.matched_file_count} 个源码文件` : '请先预览命中文件', 1),
            row('分析资料', `${selectedAssets.length} 份资产`, selectedAssets.map(item => `${item.title} r${item.revision ?? '待读取'}`).join('\n'), 2), row('执行设置', selectedProviderLabel, executionReady ? `${execution.model}${createForm.agent_model ? '' : '（Agent 默认，已确认）'}` : execution.message, 3),
            h('div', { className: 'callout', style: { marginTop: 18 } }, h('div', { className: 'row' }, runIcon('Files'), h('span', { className: 'small' }, '创建时冻结源码与所选资产版本，并启动本次分析。'))), submitBlockReason && h('p', { role: 'status', id: 'pangea-create-hint' }, submitBlockReason), footer(() => go(3), () => { void submitNewRun() }, creatingRun ? '正在创建任务…' : '创建并开始分析', !canSubmit)))
        }
        return h('section', { className: 'pangea-ui pangea-create-workspace', 'aria-label': '新建分析' },
          pageHeader({ title: '新建分析', ui: ctx.pangea?.ui, onBack: () => navigate({ type: 'tasks' }), backLabel: '返回分析任务' }),
          renderCompatibility(), h('div', { className: 'create-frame' }, h('nav', { className: 'wizard', 'aria-label': '创建分析步骤' }, ['分析目标', '输入资料', '执行设置', '确认创建'].map((label, index) => h('button', { key: label, type: 'button', className: `wizard-step ${step === index + 1 ? 'active' : step > index + 1 ? 'done' : ''}`, 'aria-current': step === index + 1 ? 'step' : undefined, onClick: () => go(index + 1), disabled: creatingRun || index > 0 && !targetReady || index > 1 && !inputsReady || index > 2 && !executionReady }, h('b', null, step > index + 1 ? '✓' : `0${index + 1}`), label))), h('div', { className: 'cols', style: { marginTop: 24 } }, h('div', null, content), h('aside', null, context))),
          assetSelectorOpen && h(CreateAssetPicker, { items: assetItems, selectedAssets, loading: assetCatalogLoading, error: assetCatalogError, pagination: assetPagination, query: assetQueryDraft, type: assetType, repositoryOnly: assetRepositoryOnly, repository: createForm.repository, typeLabels: assetTypeLabels,
            onQuery: value => { setAssetQueryDraft(value); setAssetPage(1); setAssetQuery(value.trim()) }, onSearch: () => { setAssetPage(1); setAssetQuery(assetQueryDraft.trim()) }, onType: value => { setAssetPage(1); setAssetType(value) }, onRepository: value => { setAssetPage(1); setAssetRepositoryOnly(value) }, onPage: setAssetPage, onRefresh: () => setAssetRefresh(value => value + 1), onClose: () => setAssetSelectorOpen(false),
            onConfirm: items => { setAssetLabels(labels => ({ ...labels, ...Object.fromEntries(items.map(item => [item.asset_id, item])) })); update('asset_ids', items.map(item => item.asset_id)); setAssetSelectorOpen(false) },
          }))
      }

      function renderCorrectionProgress(showActions = true) {
        return h(React.Fragment, null,
            current.partial_delivery ? h('div', { role: 'status', style: styles.notice }, '已结束返修并交付当前结果；部分修正未完成，未解决事项和未复核内容保留。') : null,
            current.case_readiness ? h('div', { style: styles.itemMeta }, `具备执行条件 ${current.case_readiness.ready} · 待补执行条件 ${current.case_readiness.needs_setup} · 未标注 ${current.case_readiness.unclassified}`) : null,
            current.execution_progress?.length ? h('section', { 'aria-label': '实际执行进度', style: styles.card },
              h('h3', null, '实际执行进度'),
              current.execution_progress.filter(item => item.stage === 'targeted_closure' || ['dispatched', 'paused'].includes(item.status)).map(item => {
                const elapsed = item.elapsed_ms + (item.started_at_ms && !item.finished_at_ms ? Math.max(0, Date.now() - item.started_at_ms) : 0)
                return h('div', { key: item.action_id, style: styles.card },
                  h('div', null, `${item.unit_id || item.action_id} · ${item.status === 'paused' ? '修正暂停' : item.status === 'accepted' ? '已完成本轮' : item.status}`),
                  h('div', null, `累计 ${Math.floor(elapsed / 60000)} 分钟 · worker 回合 ${item.worker_turns} · 自动续接 ${item.auto_continuations}`),
                  h('div', null, `关联 ${item.finding_count} 项复核发现 · 已新增或替换 ${item.modified_records} 条记录（不代表已解决数量）`),
                  h('div', null, item.last_saved_at_ms ? `最近保存 ${Math.max(0, Math.floor((Date.now() - item.last_saved_at_ms) / 1000))} 秒前` : '尚无保存记录'),
                  item.reason ? h('div', null, item.reason) : null)
              })) : null,
            showActions && current.stage === 'closing' && selectedTask ? h('div', { style: styles.card },
              h('div', null, '定向修正可以继续，也可以结束并交付已有结果。结束后不再自动返修，未完成项明确保留。'),
              h('button', { type: 'button', style: styles.button, onClick: () => { void deliverCurrentRun() } }, '结束修正，交付当前结果')) : null
        )
      }

      function renderExecutionMetrics() {
        const metrics = current?.run_id && workbench?.run?.run_id === current.run_id ? workbench.run.execution_metrics : null
        const stages = metrics?.stages ?? []
        const stageLabels = { structured_extraction: '资产提取', source_first_plan: '单元规划', unit_planning: '单元规划', unit_analysis: '单元分析', independent_review: '独立复核', comparison_review: '对照复核', targeted_closure: '定向修正' }
        const cellStyle = { textAlign: 'left', padding: '10px 12px', verticalAlign: 'top', borderBottom: '1px solid var(--dsw-alias-border-l1, #e5e9ef)' }
        const countCell = (item, key) => {
          if (item[key] == null) return '未记录'
          const covered = item.counter_action_counts?.[key]
          return h(React.Fragment, null, String(item[key]), covered != null && covered < item.action_count
            ? h('div', { style: styles.itemMeta }, `记录覆盖 ${covered} / ${item.action_count} 个任务`) : null)
        }
        const timeCell = item => h(React.Fragment, null,
          item.worker_elapsed_ms == null ? '未记录' : item.worker_elapsed_ms < 1000 ? `${item.worker_elapsed_ms} 毫秒` : durationLabel(0, item.worker_elapsed_ms),
          h('div', { style: styles.itemMeta }, `计时覆盖 ${item.timed_action_count ?? '未记录'} / ${item.action_count ?? '未记录'} 个任务`),
          item.unfinished_timed_action_count > 0 ? h('div', { style: styles.itemMeta }, `${item.unfinished_timed_action_count} 个任务计时未结束`) : null)
        return h('details', { key: current?.run_id, style: styles.card, 'aria-label': '耗时与往返' },
          h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, '耗时与往返'),
          h('p', { style: styles.itemMeta }, '仅汇总已记录的执行数据。并行 worker 的累计时间不等于整次运行耗时或模型推理时间，也不代表分析质量。'),
          stages.length ? h(React.Fragment, null,
            h('div', { className: 'pangea-reader-table', role: 'region', 'aria-label': '各阶段耗时与往返', tabIndex: 0, style: { overflowX: 'auto', marginTop: 12 } },
              h('table', { style: { width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 14 }, 'aria-label': '阶段执行指标' },
                h('thead', null, h('tr', null, ['阶段', '累计 worker 时间', 'worker 回合', '自动续接', '机械修复'].map(label => h('th', { key: label, scope: 'col', style: cellStyle }, label)))),
                h('tbody', null, [...stages.map(item => ({ ...item, label: stageLabels[item.stage] ?? item.stage })), { ...metrics, stage: '__total', label: '已记录合计' }].map(item =>
                  h('tr', { key: item.stage }, h('th', { scope: 'row', style: cellStyle }, item.label),
                    h('td', { style: cellStyle }, timeCell(item)),
                    ...['worker_turns', 'auto_continuations', 'repair_dispatches'].map(key => h('td', { key, style: cellStyle }, countCell(item, key)))))))),
            metrics.unfinished_timed_action_count > 0 ? h('p', { style: styles.itemMeta }, '当前未结束回合尚未计入累计时间；回合结束并保存后更新。') : null)
            : h('p', { style: styles.itemMeta }, '未记录当前 Run 的阶段执行指标。'))
      }

      function renderWorkflow() { return renderSourceFirstWorkflow() }

      function renderLegacyWorkflowInformation() {
        if (!current) return h('div', { style: styles.card }, h('div', { style: styles.empty }, '选择一个 Run 后查看流程。'))
        const publication = current.publication ?? { state: 'pending', revision: 0, step_id: null }
        const publicationLabel = { pending: '阶段结果生成中', draft: '草稿已发布', final: '正式结果已发布', broken: '正式结果不可用' }
        const presentation = deriveRunPresentation(selectedTask, current, health)
        const publicationText = publicationLabel[presentation.publicationLabel] ?? (presentation.publicationLabel === 'pending' ? publicationLabel.pending : presentation.publicationLabel)
        const stepTimings = Object.values(current.performance?.steps ?? {}).filter(item => Number.isInteger(item?.duration_ms))
        const measuredDuration = stepTimings.reduce((total, item) => total + item.duration_ms, 0)
        const formatDuration = value => value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} s`
        const stateReadStatus = error ? 'stale' : current.state_read?.status ?? 'unavailable'
        const ack = workflowAckPresentation(workflow, stateReadStatus)
        const publicationRevision = Number.isInteger(publication.revision) && publication.revision > 0 ? ` · revision ${publication.revision}` : ''
        return h(React.Fragment, null,
          h('div', { style: styles.card },
            h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, 'Codetalks Skill 完整流程'), h('span', { style: styles.badge }, `${workflow.completed_steps?.length ?? 0} / ${workflow.steps?.length ?? 0}`)),
            h('div', { style: { ...styles.grid, gridTemplateColumns: '1fr' } },
              field('核心规则 ACK', ack.label),
              field('当前步骤', workflow.current_step ? `Step ${workflow.current_step}` : current.terminal ? '已结束' : current.phase === 'REVIEW' ? '独立复核' : '等待下一阶段'),
              field('运行状态', current.phase_title ?? PHASE[current.phase] ?? current.phase),
              field('状态快照', stateReadStatus === 'ok' ? (current.state_read?.updated_at ?? formatTime(current.state_read?.mtime_ms)) : ack.label),
              field('结果发布', `${publicationText}${publicationRevision}${publication.step_id ? ` · Step ${publication.step_id}` : ''}`)),
            h('div', { style: styles.chips },
              current.artifacts?.request ? chip('打开任务请求', () => openSidebarFile(current.artifacts.request, 'Codetalks request.md')) : null,
              current.artifacts?.state ? chip('打开运行状态', () => openSidebarFile(current.artifacts.state, '运行状态.json')) : null,
              current.artifacts?.source_snapshot_manifest ? chip('打开源码快照清单', () => openSidebarFile(current.artifacts.source_snapshot_manifest, 'source manifest.json')) : null)),
          renderExecutionMetrics(),
          h('div', { style: { ...styles.card, ...styles.notice } },
            h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, '性能观测'), h('span', { style: styles.badge }, '仅用于比较')),
            h('div', { style: { ...styles.grid, gridTemplateColumns: '1fr' } },
              field('已测步骤', `${stepTimings.length} / ${workflow.steps?.length ?? 0}`),
              field('已记录耗时', stepTimings.length ? formatDuration(measuredDuration) : '等待步骤完成'),
              field('进度更新', current.performance?.progress_updates ?? 0),
              field('产物增量', stepTimings.length ? `${stepTimings.reduce((total, item) => total + (item.artifact_bytes_delta ?? 0), 0)} bytes` : '等待步骤完成')),
            h('div', { style: { ...styles.itemMeta, marginTop: 7 } }, '这些指标用于识别重复写作、上下文压缩和步骤热点，不直接代表分析质量，也不预设并行方案。')),
          renderIssueCard('未解决事项', workflow.unresolved),
          current.validation?.status === 'failed' ? h('div', { style: { ...styles.card, ...styles.error } },
            h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, '校验失败详情'), h('span', { style: styles.badge }, `${current.validation.error_count ?? current.validation.errors?.length ?? 0} 条`)),
            h('div', { style: styles.resultGrid }, (current.validation.errors ?? []).map((item, index) => h('div', { key: `${item.code}:${index}`, style: styles.resultItem },
              h('div', { style: styles.itemTitle }, `${item.code ?? 'validation_error'}${item.step ? ` · Step ${item.step}` : ''}`),
              h('div', { style: styles.text }, item.message ?? String(item)))))) : null,
          renderIssueCard('错误历史', workflow.error_history, 'error'))
      }

      function linkedItems(item) {
        return h('div', { style: styles.chips },
          idList(item.linked_flow_ids).map(id => chip(businessFlows.find(f => f.flow_id === id)?.display_id ?? id, () => { setFlowSelection(id); setFlowReader({ scope: `${current?.run_id}:${id}`, view: 'reader', step: '', query: '', page: 1 }); setBranchFilter(''); navigate({ type: 'flows' }) })),
          idList(item.linked_branch_ids).map(id => { const owner = businessFlows.find(f => (f.branches ?? []).some(b => b.branch_id === id)); return owner ? chip(id, () => { setFlowSelection(owner.flow_id); setFlowReader({ scope: `${current?.run_id}:${owner.flow_id}`, view: 'reader', step: '', query: id, page: 1 }); setBranchFilter(''); navigate({ type: 'flows' }) }) : h('span', { key: id, style: styles.badge }, `${id} · 路径待核对`) }),
          idList(item.linked_gap_ids).map(id => h('span', { key: id, style: styles.badge }, id)),
          riskEnabled && (item.linked_risk_ids ?? []).map(id => chip(riskById.get(id)?.display_id ?? id, () => navigate({ type: 'risk', id }))),
          (item.linked_test_case_ids ?? []).map(id => chip(caseById.get(id)?.display_id ?? id, () => navigate({ type: 'case', id }))),
          (item.evidence_ids ?? []).map(id => {
            const entry = evidence.find(value => value.evidence_id === id)
            return entry ? chip(id, () => navigate({ type: 'evidence-detail', key: evidenceIdentity(entry) })) : h('span', { key: id, style: styles.badge }, `${id} · 引用待确认`)
          }))
      }

      async function loadHistoricalDiagrams() {
        if (!selectedTask) return
        const requestId = ++diagramHistoryRequest.current
        setDiagramBusy(true); setDiagramError('')
        try {
          const result = await requestWorkbenchAction({ cwd, action: 'architecture-list', payload: { task_id: selectedTask.task_id } })
          if (requestId !== diagramHistoryRequest.current) return
          setDiagramViews(result.views ?? [])
          setDiagramHistoryScope(`${cwd}:${selectedTask.task_id}`)
        } catch (error) { if (requestId === diagramHistoryRequest.current) setDiagramError(`历史图表读取失败：${error.message}`) }
        finally { if (requestId === diagramHistoryRequest.current) setDiagramBusy(false) }
      }

      function matchingDiagrams(flow) {
        return diagramViews.filter(view => view.run_id === current?.run_id && view.task_id === selectedTask?.task_id
          && ((view.logical_flow_id && view.logical_flow_id === flow?.logical_flow_id && view.flow_unit_id === flow?.unit_id)
            || view.flow_id === flow?.flow_id || (!view.flow_id && (view.profile ?? 'standard') === 'standard')))
      }

      async function chooseDiagram(view, { activateConversation = false } = {}) {
        if (!view) return
        setDiagramSelection(view.view_id)
        setDiagramError('')
        if (!activateConversation || !view.session_id || view.session_id === selectedTask?.active_conversation_id) return
        if (conversationActionRef.current) { setDiagramError('会话正在切换，请稍后点击“查看历史图表会话”。'); return }
        conversationActionRef.current = true
        setConversationPending('select')
        try {
          await requestWorkbenchAction({ cwd, action: 'task-conversation-activate', payload: { task_id: selectedTask.task_id, conversation_id: view.session_id } })
          ctx?.pangea?.registerProductSession?.(view.session_id, 'analysis')
          await ctx?.sessions?.open?.(view.session_id)
          await loadWorkbench()
        } catch (error) { setDiagramError(`历史图表已选中，但会话切换失败：${error.message}`) }
        finally { conversationActionRef.current = false; setConversationPending('') }
      }

      function changeFlowView(reader, view) {
        setFlowReader({ ...reader, view })
        setDiagramError('')
      }

      function renderHistoricalDiagrams(flow) {
        const views = matchingDiagrams(flow)
        const selected = views.find(view => view.view_id === diagramSelection) ?? views[0]
        const preview = Boolean(selected?.preview_available ?? selected?.available)
        const loaded = diagramHistoryScope === `${cwd}:${selectedTask?.task_id}`
        const artifactUrl = (format, download = false) => '/api/pangea-companion/architecture-artifact?' + new URLSearchParams({
          cwd: cwd || '', task_id: selectedTask.task_id, view_id: selected.view_id, format,
          variant: selected.preview_kind || 'verified', ...(download ? { download: '1' } : {}),
        })
        return h('details', { 'aria-label': '历史图表（只读）', style: { marginTop: 18 },
          onToggle: event => { if (event.currentTarget.open && !loaded && !diagramBusy) return loadHistoricalDiagrams() } },
          h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, '历史图表（只读）'),
          h('p', { className: 'b05-subtle' }, '保留以前的图表、候选与诊断记录。当前图表直接读取本次分析结果。'),
          h('button', { type: 'button', disabled: diagramBusy, onClick: loadHistoricalDiagrams }, diagramBusy ? '正在读取历史图表…' : '刷新历史图表'),
          diagramError ? h('p', { role: 'alert' }, diagramError) : null,
          loaded && !views.length ? h('p', null, '当前流程没有历史图表。') : null,
          views.length ? h('nav', { 'aria-label': '历史图表版本' }, views.map(view => h('button', { key: view.view_id, type: 'button',
            'aria-pressed': view.view_id === selected?.view_id, onClick: () => chooseDiagram(view) }, `${diagramName(view)} / ${diagramVersion(view, views)}`))) : null,
          selected ? h('section', { 'aria-label': '历史图表记录' },
            h('p', { role: 'status' }, `历史记录 · ${DIAGRAM_STATUS[selected.status] || selected.status || '未记录状态'}`),
            selected.candidate_unverified ? h('p', null, '最新候选未验证；预览保留上次已保存版本。') : null,
            selected.preview_kind === 'draft' ? h('p', null, '草稿：存在未解决的布局问题。') : null,
            selected.preview_is_previous ? h('p', null, '当前预览为上次可查看版本。') : null,
            preview ? h('div', { className: 'b04-canvas-actions' },
              h('a', { href: artifactUrl('svg', true), download: `${selected.view_id}.svg` }, '下载历史 SVG'),
              h('a', { href: artifactUrl('html', true), download: `${selected.view_id}.html` }, '下载历史 HTML')) : null,
            preview && selected.renderer === 'call-graph' ? h(CallGraphView, { key: selected.view_id, graph: selected.call_graph,
              status: selected.call_graph_status || 'ok', errors: selected.call_graph_errors ?? [], svgUrl: artifactUrl('svg', true) })
              : preview ? h('iframe', { title: `${diagramName(selected)}历史预览`, src: artifactUrl('html'), sandbox: 'allow-scripts allow-downloads', style: { width: '100%', height: 467, border: '1px solid #e2e7e0' } }) : h('p', null, '此历史记录没有可预览图。'),
            selected.error || selected.validation_error ? h('p', { role: 'status' }, selected.validation_error || selected.error) : null,
            selected.candidate_summary ? renderReadableBody(selected.candidate_summary) : null,
            selected.session_id ? h('button', { type: 'button', disabled: Boolean(conversationPending), onClick: () => chooseDiagram(selected, { activateConversation: true }) }, '查看历史图表会话') : null,
            h('details', null, h('summary', null, '历史诊断与原文'),
              selected.diagnostic_path ? chip('打开历史日志', () => openSidebarFile(selected.diagnostic_path)) : null,
              selected.render_diagnostic_path ? chip('打开渲染历史', () => openSidebarFile(selected.render_diagnostic_path)) : null,
              renderReadableBody(selected.validation_diagnostics ?? selected.output ?? selected.generation_events ?? []))) : null)
      }

      function renderRecordBody(item, compact = false) {
        const record = item?.source_record
        if (!record) return null
        return h('details', { style: styles.card, open: !compact && (record.kind === 'risk' || typeof record.body === 'string') },
          h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, compact ? (item.title || '分析摘要') : '分析原文'),
          h('div', { style: styles.itemMeta }, `${item.unit_id} · ${record.record_id} · revision ${record.revision ?? '—'} · ${record.status === 'accepted' ? '已接受' : '分析中'}`),
          renderReadableBody(record.body, record.kind === 'flow'),
          record.result_path ? chip('打开原始记录', () => openSidebarFile(record.result_path, item.title)) : null)
      }

      function renderRecordEvidence(item) {
        return item.evidence?.length ? h('div', { style: styles.card },
          h('div', { style: styles.itemTitle }, '源码依据'),
          h('div', { style: styles.chips }, item.evidence.map(e => chip(text(e.location, '证据详情'), () => navigate({ type: 'evidence-detail', key: evidenceIdentity(e) }))))) : null
      }

      function renderSourceFirstRecords(groups = current?.source_first_records ?? []) {
        const records = (Array.isArray(groups) ? groups : []).flatMap(group => (Array.isArray(group?.records) ? group.records : []).filter(record => record && typeof record === 'object').map(record => ({ ...record, stage: group.stage, action_id: group.action_id, task_id: group.task_id, revision: group.revision })))
        const recordNodes = records.map((record, index) => h('details', {
          key: `${record.action_id}:${record.record_id ?? index}:${index}`,
          open: record.kind === 'review_decision',
          style: { ...styles.card, margin: '8px 0 0', background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.06))' },
        },
        h('summary', { style: { cursor: 'pointer' } }, `${RECORD_LABELS[record.kind] ?? '分析记录'} · ${text(record.record_id, `record-${index + 1}`)} · 结果文件修订 ${record.revision ?? '—'}`),
        h('div', { style: { ...styles.itemMeta, marginTop: 7 } }, `${record.action_id ?? 'unknown action'}${record.task_id ? ` · task ${record.task_id}` : ''}`),
        isReviewRecord(record, record.stage) ? renderReviewPresentation(h, record.body, { renderText: renderReadableBody }) : renderReadableBody(record.body, record.kind === 'flow'),
        Array.isArray(record.evidence) && record.evidence.length ? h('pre', { style: { ...styles.itemMeta, marginTop: 7, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, `证据：${sourceFirstRecordBody(record.evidence)}`) : null,
        Array.isArray(record.relates_to) && record.relates_to.length ? h('div', { style: { ...styles.itemMeta, marginTop: 7 } }, `关联：${record.relates_to.map(item => text(item, '')).filter(Boolean).join('、')}`) : null))
        return h('div', { style: styles.card },
          h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, 'Agent 原文记录'), h('span', { style: styles.badge }, `${records.length} 条`)),
          records.length ? h('div', { style: { marginTop: 8 } }, recordNodes)
            : h('div', { style: { ...styles.empty, marginTop: 8 } }, '当前还没有可显示的 Agent 原文；空结果不会被解释为分析完成。'))
      }

      function renderSourceFirstWorkflow() {
        return h(RunWorkspace, { key: `${selectedTask?.task_id}:${current?.run_id}`, current, task: selectedTask, cwd: scope?.cwd, dataRoot: current?.data_root ?? snapshot?.data_root,
          timeline: workflowEvents(current, taskLaunchEvents(selectedTask, workbench)),
          error, loading, busy: creatingRun, retry: () => load({ foreground: true }),
          viewState: screen.view, ui: ctx.pangea?.ui,
          navigate: (target, view) => ['flows', 'risks', 'cases'].includes(target) ? navigate({ type: target }, { type: 'workflow', view }) : jump(target), openFile: openSidebarFile, stop: () => stopCurrentRun(true),
          openFlow: (flowId, view) => { setFlowSelection(flowId); navigate({ type: 'flows' }, { type: 'workflow', view }) },
          resume: () => startTask(selectedTask, true), deliver: () => deliverCurrentRun(true),
          diagnostics: current ? current.workflow_version === 'source-first-v1' ? h(React.Fragment, null, renderCorrectionProgress(false), renderExecutionMetrics()) : renderLegacyWorkflowInformation() : null,
          discuss: async () => { await createTaskConversationForCurrent(); window.dispatchEvent(new CustomEvent('pangea:open-assistant')) } })
      }

      async function openFlowSource(location, origin) {
        if (!location || !current?.run_id || !snapshot?.data_root) return
        setFlowSource({ location, origin, status: 'loading' })
        try {
          const value = await requestSourceSnippet({ cwd, dataRoot: snapshot.data_root, runId: current.run_id, location })
          setFlowSource(previous => previous?.location === location ? { location, origin, status: 'ready', value } : previous)
        } catch (error) {
          setFlowSource(previous => previous?.location === location ? { location, origin, status: 'error', error: error.message } : previous)
        }
      }

      function renderFlowSourceDrawer() {
        if (!flowSource) return null
        const snippet = flowSource.value
        return h('div', { className: 'b04-source-overlay', onClick: () => setFlowSource(null) },
          h('section', { className: 'b04-source-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': '上下文源码预览', onClick: event => event.stopPropagation() },
            h('header', null, h('div', { style: styles.row }, h('div', null, h('strong', null, '上下文源码预览'),
              h('div', { style: styles.itemMeta }, flowSource.origin)),
              h('button', { type: 'button', style: styles.button, 'aria-label': '关闭源码预览', onClick: () => setFlowSource(null) }, '关闭'))),
            h('main', null, h('div', { style: styles.row }, h('strong', null, snippet?.file_path || flowSource.location),
              snippet ? h('span', { style: styles.badge }, `L${snippet.target_start}–${snippet.target_end}`) : null),
              h('p', { style: styles.itemMeta }, '来自当前 Run 冻结的源码输入 · 只读'),
              flowSource.status === 'loading' ? h('p', { role: 'status' }, '正在读取冻结源码…') : null,
              flowSource.status === 'error' ? h('p', { role: 'alert', style: styles.error }, `无法预览：${flowSource.error}`) : null,
              snippet ? h('div', { className: 'b04-code', role: 'region', 'aria-label': `源码 ${snippet.visible_start} 到 ${snippet.visible_end} 行` },
                snippet.lines.map(line => h('div', { key: line.number, className: 'b04-code-line', 'data-target': line.target ? 'true' : undefined },
                  h('span', null, line.number), h('code', null, line.text || ' ')))) : null),
            h('footer', null, h('span', { style: styles.itemMeta }, '关闭后返回原流程和分支。'),
              snippet?.file_path ? h('button', { type: 'button', style: styles.button, onClick: () => openSidebarFile(snippet.file_path) }, '打开完整文件') : null)))
      }

      function renderFlowVersions() {
        return current?.flow_comparison
          ? h(FlowComparisonView, { stability: current.flow_stability, comparison: current.flow_comparison })
          : null
      }

      function renderFlows() {
        const moduleOverview = buildModuleOverview({ ...current, details: { ...current?.details, business_flows: businessFlows } })
        const query = flowQuery.trim().toLowerCase()
        const flowRank = item => item?.raw_text != null ? 2 : item?.role === 'main' ? 0 : 1
        const ranked = businessFlows.map((item, order) => ({ item, order })).sort((a, b) => flowRank(a.item) - flowRank(b.item) || a.order - b.order)
        const attached = ranked.map(entry => {
          const { item } = entry
          const relation = moduleOverview.flows.find(row => row.flow === item)
          const parentFlow = moduleOverview.flows.find(row => row.key === relation?.parent_key)?.flow
          const parent = ranked.find(entry => entry.item === parentFlow)
          const steps = parent?.item.mainline_steps ?? []
          const nodeIndex = steps.findIndex(step => step.step_id === item.attach_to?.node_id)
          return { ...entry, parentOrder: parent ? ranked.indexOf(parent) : -1, nodeOrder: nodeIndex < 0 ? steps.length : nodeIndex }
        })
        const ordered = attached.sort((a, b) => flowRank(a.item) - flowRank(b.item)
          || (flowRank(a.item) === 1 ? Number(a.parentOrder < 0) - Number(b.parentOrder < 0) || a.parentOrder - b.parentOrder || a.nodeOrder - b.nodeOrder : 0)
          || a.order - b.order).map(entry => entry.item)
        const filtered = ordered.filter(item => !query || [item.display_id, item.flow_id, item.title, item.description, item.entry].join(' ').toLowerCase().includes(query))
        const roleText = item => item?.raw_text != null ? '无法解析' : item?.role === 'main' ? '主流程'
          : item?.attach_to?.flow_id ? `挂接到 ${item.attach_to.flow_id}${item.attach_to.node_id ? ` / 节点 ${item.attach_to.node_id}` : ''}` : '未挂接'
        const selectionKey = item => businessFlows.filter(other => other.flow_id === item?.flow_id).length > 1 ? JSON.stringify([item?.unit_id, item?.flow_id]) : item?.flow_id
        const flow = filtered.find(item => selectionKey(item) === flowSelection) ?? filtered[0]
        const cardScope = item => `${current?.run_id}:${selectionKey(item)}`
        const cardId = item => `pangea-flow-card-${encodeURIComponent(cardScope(item))}`
        const panelState = item => flowPanelsRef.current[cardScope(item)] ??= { scrollTop: 0, scrollLeft: 0, graph: {}, sequence: {}, functions: {} }
        const selectFlow = item => {
          if (selectionKey(item) === selectionKey(flow)) return
          const scope = cardScope(item)
          if (flow) setFlowReaders(value => ({ ...value, [cardScope(flow)]: { reader, branchFilter } }))
          setFlowSelection(selectionKey(item)); setFlowBranchDetail(''); setBranchSelection('')
          setFlowReader(flowReaders[scope]?.reader ?? { scope, view: 'reader', step: '', query: '', page: 1 })
          setBranchFilter(flowReaders[scope]?.branchFilter ?? '')
          setFlowSource(null)
        }
        const evidenceLocation = item => {
          const direct = item?.source_evidence ?? item?.source_location ?? item?.location
          if (typeof direct === 'string') return direct
          if (Array.isArray(direct)) return typeof direct[0] === 'string' ? direct[0] : direct[0]?.location
          return direct?.location || item?.evidence?.find(entry => entry.location)?.location || ''
        }
        const sourceButton = (item, label, origin) => { const location = evidenceLocation(item); return location ? h('button', {
          type: 'button', className: 'b04-link', onClick: () => openFlowSource(location, origin), title: location }, label) : null }
        const readingState = flow => {
          const scope = cardScope(flow)
          const reader = flowReader.scope === scope ? flowReader : { scope, view: 'reader', step: '', query: '', page: 1 }
          // Graph-backed records must never use a flattened mainline as execution order.
          const steps = flow?.nodes?.length ? flow.nodes.map(node => ({ step_id: node.id, title: node.label,
            processing: node.description, node_kind: node.kind, source_evidence: node.source_evidence }))
            : Array.isArray(flow?.mainline_steps) ? flow.mainline_steps : []
          const branches = Array.isArray(flow?.branches) ? flow.branches : []
          const unbound = item => !steps.some(step => step.step_id === item.from_step_id)
          const filteredBranches = branches.filter(item => (!reader.step || (reader.step === '__unbound' ? unbound(item) : item.from_step_id === reader.step))
          && (!reader.query || [item.branch_id, item.condition, item.processing, item.result].join(' ').toLowerCase().includes(reader.query.toLowerCase()))
          && (!branchFilter || (branchFilter === 'no_case' ? !item.linked_test_case_ids?.length
            : branchFilter === 'unresolved' ? item.status === 'unresolved'
              : branchFilter === 'high_risk' ? (item.linked_risk_ids ?? []).some(id => ['P0', 'P1', 'critical', 'high'].includes(riskById.get(id)?.priority || riskById.get(id)?.severity)) : item.kind === branchFilter)))
          const branchPages = Math.max(1, Math.ceil(filteredBranches.length / 20))
          const branchPage = Math.min(reader.page, branchPages)
          const visibleBranches = filteredBranches.slice((branchPage - 1) * 20, branchPage * 20)
          return { scope, reader, steps, branches, unbound, filteredBranches, branchPages, branchPage, visibleBranches }
        }
        const { scope, reader, steps, branches } = readingState(flow)
        const branch = branches.find(item => item.branch_id === flowBranchDetail || item.branch_id === branchSelection || item.branch_id === reader.query)
        const tabs = ordered.length ? h(React.Fragment, null,
          h('input', { 'aria-label': '搜索业务流程', value: flowQuery, placeholder: '搜索流程…', onChange: event => setFlowQuery(event.target.value),
            style: { ...styles.search, width: 240, maxWidth: '100%', fontSize: 12, marginBottom: 10 } }),
          h('div', { className: 'b04-flow-tabs', role: 'tablist', 'aria-label': '业务流程' },
            filtered.map((item, index) => h('button', { key: cardScope(item), type: 'button', className: 'b04-flow-tab', role: 'tab', 'data-flow-parent': item.attach_to || undefined, style: { marginLeft: item.attach_to ? 20 : 0 },
              id: `${cardId(item)}-tab`, 'aria-controls': cardId(item), 'aria-selected': selectionKey(item) === selectionKey(flow),
              tabIndex: selectionKey(item) === selectionKey(flow) ? 0 : -1, onClick: () => selectFlow(item),
              onKeyDown: event => {
                const next = event.key === 'ArrowRight' ? (index + 1) % filtered.length : event.key === 'ArrowLeft' ? (index - 1 + filtered.length) % filtered.length
                  : event.key === 'Home' ? 0 : event.key === 'End' ? filtered.length - 1 : -1
                if (next < 0) return
                event.preventDefault(); selectFlow(filtered[next])
                event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]?.focus()
              } }, h('strong', null, item.title || item.display_id || item.flow_id),
              h('small', null, `${(item.nodes ?? item.mainline_steps ?? []).length} 个节点 · ${roleText(item)}`))))) : null
        const modebar = flow ? h('div', { className: 'b04-modebar' },
          h('div', null, h('strong', null, flow.title || '业务流程'), h('span', { style: styles.badge }, flow.display_id || flow.flow_id)),
          h('div', { role: 'group', 'aria-label': '流程展示方式', className: 'pangea-flow-modes' },
            [['reader', '文字流程', '流程阅读视图'], ['diagram', '流程图', '流程图视图'], ['sequence', '时序图', '时序图视图'], ['functions', '函数与变量', '函数与变量流程图视图']].map(([view, label, aria]) => h('button', {
              key: view, type: 'button', 'aria-label': aria, 'aria-pressed': reader.view === view,
              onClick: () => { setFlowBranchDetail(''); return changeFlowView(reader, view, flow) },
            }, label)))) : null
        function renderFlowReader(flow) {
          const { scope, reader, steps, branches, unbound, filteredBranches, branchPages, branchPage, visibleBranches } = readingState(flow)
          const updateReader = next => { setFlowSelection(selectionKey(flow)); setFlowReader(next) }
          const openBranch = id => { setFlowSelection(selectionKey(flow)); setFlowBranchDetail(id); setBranchSelection(id); updateReader({ ...reader, view: 'reader' }) }
          const graphBacked = Boolean(flow.nodes?.length)
          const transitions = graphBacked ? (flow.edges ?? []).map((edge, index) => ({
            from_step_id: edge.source_step_key, to_step_id: edge.target_step_key, condition: edge.condition,
            processing: edge.description, branch_id: branches.find(branch => branch.edge_index === index)?.branch_id,
          })) : branches
          const outgoing = id => transitions.filter(edge => edge.from_step_id === id)
          const nodeLabel = id => steps.find(item => item.step_id === id)?.title || flow.nodes?.find(item => item.id === id)?.label || id || '—'
          const cell = { padding: '8px 10px', textAlign: 'left', verticalAlign: 'top', borderBottom: '1px solid #e8ece6', overflowWrap: 'anywhere' }
          return h('article', { className: 'b04-flow-card', 'aria-label': '业务流程文字阅读' },
          h('div', { className: 'b04-overline' }, `FLOW ${flow.display_id || flow.flow_id} / ${flow.unit_id || '当前单元'}`),
          h('h2', null, flow.title || '业务流程'),
          h('h3', null, '概述'), h('p', { className: 'b04-flow-description' }, flow.description || flow.entry || '按节点的入口、条件和去向阅读业务流程。'),
          h('div', { className: 'b04-flow-badges' }, h('span', null, `${steps.length} 个流程节点`), h('span', null, `${branches.length} 条分支`),
            flow.entry ? h('span', null, `入口 ${flow.entry}`) : null, flow.document_status === 'live_draft' ? h('span', null, '分析草稿') : null),
          linkedItems(flow),
          flow.projection_warnings?.length ? h('div', { role: 'status', style: styles.notice }, flow.projection_warnings.join('；')) : null,
          flow.structure_errors?.length ? h('section', { 'aria-label': '流程结构问题', style: { ...styles.notice, background: '#fff8e1' } },
            h('strong', null, `结构问题 ${flow.structure_errors.length} 项（已跳过无法绘制的部分）`),
            h('ul', { style: { margin: '6px 0 0', paddingLeft: 18 } }, flow.structure_errors.map((error, index) => h('li', { key: index }, error)))) : null,
          flow.raw_text != null ? h('section', { 'aria-label': '流程原文' }, h('h3', null, '流程原文'),
            h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: '12px/1.6 Consolas,monospace', background: '#fafcf8', border: '1px solid #e2e7e0', borderRadius: 8, padding: 12 } }, flow.raw_text || '（空）')) : null,
          h('h3', null, '节点与流转'),
          h('p', { style: styles.itemMeta }, '节点按记录顺序陈列，不代表执行先后；执行关系以入口、条件和去向为准。'),
          steps.length ? h('div', { className: 'b04-flow-sequence' }, steps.map((item, index) => h('div', { key: item.step_id || index, id: `${cardId(flow)}-step-${encodeURIComponent(item.step_id)}`, className: 'b04-flow-step', 'aria-current': reader.step === item.step_id ? 'step' : undefined },
            h('div', null, h('strong', null, item.title || item.step_id || `步骤 ${index + 1}`),
              h('p', null, item.processing || item.external_action || item.state_change || item.external_observation || '原记录未提供步骤说明。'),
              h('small', null, `节点 ${item.step_id}${item.node_kind ? ` · ${FLOW_KIND_LABELS[item.node_kind] || item.node_kind}` : ''}`),
              h('p', null, `入口：${transitions.filter(edge => edge.to_step_id === item.step_id).map(edge => `${nodeLabel(edge.from_step_id)}${edge.condition ? `（${edge.condition}）` : ''}`).join('；') || (item.node_kind === 'entry' ? '流程入口' : '未记录入口连线')}`),
              outgoing(item.step_id).length ? h('ul', { 'aria-label': `节点 ${item.step_id} 的去向` }, outgoing(item.step_id).map((edge, edgeIndex) => h('li', { key: edgeIndex },
                h('span', null, `${edge.condition || (outgoing(item.step_id).length > 1 || ['decision', 'condition'].includes(item.node_kind) ? '分支条件未明确' : '后续')} → ${edge.to_step_id ? nodeLabel(edge.to_step_id) : edge.terminal_result || '去向未记录'}`),
                edge.processing ? h('p', null, edge.processing) : null,
                edge.branch_id ? h('button', { type: 'button', className: 'b04-link', 'aria-label': `打开分支 ${edge.branch_id}`, onClick: () => openBranch(edge.branch_id) }, '查看详情') : null)))
                : h('p', null, item.node_kind === 'exit' ? '结束当前流程。' : '未记录后续连线，不推断下一步。')),
            h('div', { className: 'b04-flow-ref' }, sourceButton(item, evidenceLocation(item)?.split(/[\\/]/).at(-1) || '查看源码', `业务流程 · ${flow.title || flow.display_id} · ${item.step_id}`))))) :
            h('section', { className: 'b04-flow-sequence', 'aria-label': '主干步骤说明' },
              h('p', null, flow.paths?.length ? '原文提供业务路径，但尚无可解析节点，暂不能据此绘制流程图。' : '尚无可解析的主干步骤，分析可能仍在发布中。'),
              flow.text ? renderReadableBody(flow.text, true) : null),
          h('section', { 'aria-label': '分支与异常' }, h('h3', null, '分支与异常'),
            h('section', { className: 'pangea-branch-controls', 'aria-label': '分支筛选与分页' },
            h('div', { className: 'b04-canvas-actions', style: { margin: '14px 0' } },
              h('button', { type: 'button', 'aria-label': '查看全部分支', onClick: () => updateReader({ ...reader, step: '', page: 1 }) }, '全部步骤'),
              steps.map(item => h('button', { key: item.step_id, type: 'button', 'aria-label': `查看步骤 ${item.step_id} 的分支`,
                onClick: () => updateReader({ ...reader, step: item.step_id, page: 1 }) }, item.title || item.step_id)),
              branches.some(unbound) ? h('button', { type: 'button', 'aria-label': '查看未挂接分支',
                onClick: () => updateReader({ ...reader, step: '__unbound', page: 1 }) }, '未挂接分支') : null),
            h('div', { className: 'b04-canvas-actions', style: { margin: '14px 0' } },
              h('input', { 'aria-label': '搜索分支', value: reader.query, placeholder: '搜索条件、处理或回接…', style: { ...styles.search, width: 240, margin: 0 },
                onChange: event => updateReader({ ...reader, query: event.target.value, page: 1 }) }),
              h('select', { 'aria-label': '筛选分支', value: branchFilter, style: { ...styles.search, width: 150, margin: 0 },
                onChange: event => { setBranchFilter(event.target.value); updateReader({ ...reader, page: 1 }) } },
                [['', '全部分支'], ...(riskEnabled ? [['high_risk', '关联高风险']] : []), ['normal', '正常'], ['exception', '异常'], ['timeout', '超时'], ['retry', '重试'], ['recovery', '恢复'], ['concurrency', '并发'], ['unresolved', '待确认'], ['no_case', '未关联用例']]
                  .map(([value, label]) => h('option', { key: value, value }, label)))),
            h('div', { className: 'b04-canvas-actions', style: { marginTop: 10 } }, h('span', { style: styles.itemMeta }, `第 ${branchPage} / ${branchPages} 页 · 共 ${filteredBranches.length} 条`),
              h('button', { type: 'button', 'aria-label': '绘制本页分支', disabled: !visibleBranches.length, onClick: async () => {
                setFlowHighlight({ scope, ids: visibleBranches.map(item => item.branch_id) })
                updateReader({ ...reader, view: 'diagram' })
              } }, '绘制本页分支'),
              h('button', { type: 'button', 'aria-label': '上一页分支', disabled: branchPage === 1, onClick: () => updateReader({ ...reader, page: branchPage - 1 }) }, '上一页'),
              h('button', { type: 'button', 'aria-label': '下一页分支', disabled: branchPage === branchPages, onClick: () => updateReader({ ...reader, page: branchPage + 1 }) }, '下一页'))),
          visibleBranches.length ? h('table', { 'aria-label': '分支列表', style: { width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 14 } },
              h('thead', null, h('tr', null, ['从', '条件', '处理', '去向'].map(label => h('th', { key: label, style: cell }, label)))),
              h('tbody', null, visibleBranches.map(item => h('tr', { key: item.branch_id },
                h('td', { style: cell }, nodeLabel(item.from_step_id)),
                h('td', { style: cell }, h('button', { type: 'button', className: 'b04-link', 'aria-label': `查看分支 ${item.branch_id}`, onClick: () => openBranch(item.branch_id) }, `${item.branch_id} · ${item.condition || '条件待确认'}`)),
                h('td', { style: cell }, item.processing || item.result || '原记录未提供说明', linkedItems(item)),
                h('td', { style: cell }, item.to_step_id ? nodeLabel(item.to_step_id) : item.terminal_result || '未记录')))))
              : h('p', { style: styles.itemMeta }, branches.length ? '没有符合当前筛选的分支。' : '原记录未提供分支与异常。'),
          h('details', { className: 'pangea-flow-original' }, h('summary', null, '查看分析原文'), renderRecordBody(flow))),
          h('section', { 'aria-label': '业务路径阅读' }, h('h3', null, '路径'),
            flow.entry_points ? renderReadableBody(flow.entry_points, true) : null,
            flow.paths?.length ? flow.paths.map((path, index) => h('div', { key: path.path_id || index },
              h('h4', null, `${path.path_id || `P-${index + 1}`}${path.title ? ` · ${path.title}` : ''}`),
              Array.isArray(path.node_ids) && path.node_ids.length && (!graphBacked || path.node_ids.every((id, i, ids) => steps.some(step => step.step_id === id) && (!i || transitions.some(edge => edge.from_step_id === ids[i - 1] && edge.to_step_id === id)))) ? h(React.Fragment, null,
                h('p', null, `${path.condition ? `${path.condition} → ` : ''}${path.node_ids.map(nodeLabel).join(' → ')}`),
                path.explanation ? h('p', null, path.explanation) : null) : graphBacked ? h('p', { role: 'status' }, '路径与节点连线不一致或缺少节点，暂不展示执行顺序。') : renderReadableBody(path, true), linkedItems(path)))
              : h('p', { style: styles.itemMeta }, '原记录未提供独立路径。')),
          h('section', { 'aria-label': '流程图示' }, h('h3', null, '图示'),
            h(FlowGraphView, { key: cardScope(flow), flow, viewport: panelState(flow).graph, idPrefix: `pf-${ordered.indexOf(flow)}`, highlightBranchIds: flowHighlight.scope === scope ? flowHighlight.ids : [] })),
          h('details', { 'aria-label': '流程源码依据', style: { marginTop: 20 } }, h('summary', { style: { cursor: 'pointer' } }, '源码依据'),
            evidenceText(flow.source_evidence ?? flow.evidence).map((location, index) => h('p', { key: index }, h('button', { type: 'button', className: 'b04-link', onClick: () => openFlowSource(location, `业务流程 · ${flow.title || flow.display_id}`) }, location))),
            !evidenceText(flow.source_evidence ?? flow.evidence).length ? h('p', { style: styles.itemMeta }, '原记录未提供流程级源码依据，可查看各步骤引用。') : null))
        }
        const definition = (label, value) => [h('dt', { key: `${label}:label` }, label), h('dd', { key: `${label}:value` }, value || '原记录未提供说明')]
        const branchBody = branch ? h('div', { className: 'b04-branch-detail' },
          h('article', { className: 'b04-flow-card', 'aria-label': '分支详情' },
            h('div', { style: styles.row }, h('span', { className: 'b04-overline' }, `${flow.display_id || flow.flow_id} / BRANCH ${branch.branch_id}`),
              h('span', { style: styles.badge }, branch.kind || branch.status || '条件分支')),
            h('h2', null, branch.title || branch.condition || '条件分支'),
            h('p', { className: 'b04-flow-description' }, '从条件进入、内部处理到回接步骤，阅读这条执行路径。'),
            h('dl', { className: 'b04-flow-definition' },
              ...definition('进入条件', branch.condition), ...definition('内部处理', branch.processing),
              ...definition('回接步骤', branch.to_step_id ? h(React.Fragment, null,
                `${branch.to_step_id} · ${steps.find(item => item.step_id === branch.to_step_id)?.title || '目标步骤'} `,
                h('button', { type: 'button', className: 'b04-link', onClick: () => { setFlowBranchDetail(''); setBranchSelection(''); setFlowReader({ ...reader, view: 'reader', step: branch.to_step_id }); if (typeof document !== 'undefined') window.setTimeout(() => document.getElementById(`${cardId(flow)}-step-${encodeURIComponent(branch.to_step_id)}`)?.scrollIntoView({ block: 'center' }), 0) } }, '定位步骤')) : branch.terminal_result || '未记录'),
              ...definition('外部表现', branch.external_observation || branch.result)),
            h('div', { style: { borderTop: '1px solid #e8ece6', paddingTop: 16 } },
              h('span', { style: styles.itemMeta }, `源码依据 · ${evidenceLocation(branch) || evidenceLocation(flow) || '当前冻结输入'}`),
              sourceButton(branch, '查看源码', `业务流程 · ${flow.title || flow.display_id} · ${branch.branch_id}`)
                || sourceButton(flow, '查看源码', `业务流程 · ${flow.title || flow.display_id} · ${branch.branch_id}`)),
            flowBranchSource?.key?.includes(`\u0000${branch.branch_id}\u0000`) && flowBranchSource.status === 'ready' ? h('div', {
              className: 'b04-code', role: 'region', 'aria-label': `分支 ${branch.branch_id} 源码`, style: { maxHeight: 200, overflow: 'auto', marginTop: 12, border: '1px solid #e2e7e0', borderRadius: 8, background: '#fafcf8', font: '12px/1.7 Consolas,monospace' } },
              flowBranchSource.value.lines.filter(line => line.number >= flowBranchSource.value.target_start && line.number <= flowBranchSource.value.target_end)
                .map(line => h('div', { key: line.number, className: 'b04-code-line', 'data-target': line.target ? 'true' : undefined,
                  style: { display: 'grid', gridTemplateColumns: '48px minmax(max-content,1fr)', whiteSpace: 'pre' } },
                  h('span', { style: { textAlign: 'right', paddingRight: 12, color: '#9da69b', borderRight: '1px solid #e2e7e0' } }, line.number),
                  h('code', { style: { padding: '0 12px' } }, line.text || ' ')))) : null,
            null),
          h('aside', null,
            h('section', { className: 'b04-flow-side' }, h('h3', null, '关联风险'),
              (branch.linked_risk_ids ?? []).length ? branch.linked_risk_ids.map(id => { const item = riskById.get(id); return h('div', { key: id },
                h('strong', null, item?.title || item?.summary || item?.display_id || id),
                h('p', null, item?.verification_status === 'verified' ? '已验证' : item?.verification_status === 'rejected' ? '已排除' : '尚无验证结论'),
                item?.description || item?.reason ? h('p', null, item.description || item.reason) : null,
                h('button', { type: 'button', className: 'b04-link', onClick: () => navigate({ type: 'risk', id }) }, `查看 ${item?.display_id || id} 风险详情 ↗`)) }) : h('p', null, '当前分支未关联风险记录。')),
            h('section', { className: 'b04-flow-side' }, h('h3', null, '关联测试用例'),
              (branch.linked_test_case_ids ?? []).length ? branch.linked_test_case_ids.map(id => { const item = caseById.get(id); return h('div', { key: id },
                h('strong', null, `${item?.display_id || id} · ${item?.title || '测试用例'}`),
                item?.precondition || item?.expected ? h('p', null, item.precondition || item.expected) : null,
                h('p', null, `${CASE_READINESS[item?.readiness || item?.execution_readiness || item?.status] || '执行条件未标注'} · ${item?.execution_status === 'not_run' ? '未执行' : item?.execution_status === 'passed' ? '执行通过' : item?.execution_status === 'failed' ? '执行失败' : '执行状态未提供'}`),
                h('button', { type: 'button', className: 'b04-link', onClick: () => navigate({ type: 'case', id }) }, '查看用例与预期 ↗')) }) : h('p', null, '当前分支未关联测试用例。')),
            h('section', { className: 'b04-flow-side' }, h('h3', null, '在图中理解'), h('p', null, '查看当前分支与主干步骤的连接关系。'),
              h('button', { type: 'button', style: styles.button, onClick: () => changeFlowView(reader, 'diagram', flow) }, '查看业务流程图')))) : null
        const pending = !flow && !query && (current?.publication?.status === 'pending' || current?.status === 'running' || current?.analysis?.status === 'running')
        const empty = h('div', { className: 'b04-flow-empty' },
          h('aside', { className: 'b04-flow-nav' }, h('div', { className: 'b04-flow-nav-label' }, '业务流程'), h('i'), h('i', { style: { width: '55%' } }), h('i', { style: { width: '66%' } }),
            h('div', { className: 'b04-flow-nav-foot' }, '流程发布后，将在这里出现。支持阅读文字、分支和图表。')),
          h('section', { className: 'b04-flow-card b04-empty-content' }, h('div', { className: 'b04-progress-icon' }, '◇'),
            h('h2', null, pending ? '业务流程正在形成' : query ? '没有匹配的业务流程' : '当前没有可阅读的业务流程'),
            h('p', null, pending ? '当前分析尚未发布可阅读的业务流程。你可以先查看运行进展，或检查本次冻结的输入资料。' : query ? '请调整搜索条件。' : collectionEmpty('business_flows', '此 Run 暂无业务流程。')),
            pending ? h('div', { className: 'b04-flow-badges' }, h('span', null, '分析进行中'), h('span', null, `${current?.analysis?.completed ?? 0} / ${current?.analysis?.total ?? 0} 个分析单元已完成`)) : null,
            h('div', { className: 'b04-canvas-actions b04-empty-actions', style: { marginTop: 20 } },
              h('button', { type: 'button', onClick: () => navigate({ type: 'workflow' }) }, '查看运行过程'),
              current?.artifacts?.source_snapshot_manifest ? h('button', { type: 'button', style: styles.button,
                onClick: () => openSidebarFile(current.artifacts.source_snapshot_manifest) }, '检查冻结输入') : null)))
        const overviewPanel = h('details', { className: 'b04-module-overview', open: true }, h('summary', null, '模块总览 · 当前 Run'),
          h('p', { style: styles.itemMeta }, moduleOverview.note),
          moduleOverview.units.map((unit, index) => h('section', { key: `${unit.unit_id}:${index}`, style: { marginBottom: 12 } },
            h('strong', null, unit.title || unit.unit_id || '单元归属未提供'),
            unit.flows.length ? h('ul', null, unit.flows.map(row => h('li', { key: row.key },
              h('button', { type: 'button', className: 'b04-link', onClick: () => { setFlowQuery(''); selectFlow(row.flow) } }, row.flow.title || row.flow.flow_id),
              ` · ${row.category} · ${row.relationship}`,
              h('div', { style: styles.itemMeta }, `入口：${row.entries.map(node => node.label || node.id).join('、') || row.flow.entry || '未声明'}；主干路径：${row.main_paths.map(path => path.path_id).join('、') || '未声明'}；调用入口：${row.call_root || '未声明'}；显式调用关系：${row.calls.length}`),
              row.calls.length ? h('details', null, h('summary', null, '显式调用关系'), h('pre', { style: { whiteSpace: 'pre-wrap' } }, JSON.stringify(row.calls, null, 2))) : null,
              diagramDiagnostics(row.flow.source_record?.body ?? row.flow).length ? h('details', null, h('summary', null, '图形合同诊断'), h('pre', { style: { whiteSpace: 'pre-wrap' } }, JSON.stringify(diagramDiagnostics(row.flow.source_record?.body ?? row.flow), null, 2))) : null,
              sourceButton(row.flow, '查看流程证据 ↗', row.flow.title || row.flow.flow_id)))) : h('p', { style: styles.itemMeta }, '当前没有已发布流程；入口和关系未知。'))))
        return h(React.Fragment, null, overviewPanel, renderFlowVersions(), tabs, flow ? h(React.Fragment, null, modebar,
          h('section', { key: cardScope(flow), id: cardId(flow), role: 'tabpanel', tabIndex: 0, 'aria-labelledby': `${cardId(flow)}-tab`,
            className: 'b04-flow-panel', 'data-flow-id': flow.flow_id,
            ref: element => { if (element) { element.scrollTop = panelState(flow).scrollTop; element.scrollLeft = panelState(flow).scrollLeft } },
            onScroll: event => { const state = panelState(flow); state.scrollTop = event.currentTarget.scrollTop; state.scrollLeft = event.currentTarget.scrollLeft } },
            reader.view === 'reader' && !branch ? renderFlowReader(flow)
            : ['diagram', 'sequence', 'functions'].includes(reader.view) ? h('div', null,
              reader.view === 'sequence' ? h(SequenceGraphView, { key: cardScope(flow), flow, viewport: panelState(flow).sequence, onSource: openFlowSource })
              : reader.view === 'functions' ? h(FunctionVariablesView, { key: cardScope(flow), flow, viewport: panelState(flow).functions, onSource: openFlowSource, repositoryId: current?.repository })
              : h(FlowGraphView, { key: cardScope(flow), flow, viewport: panelState(flow).graph, highlightBranchIds: flowHighlight.scope === scope ? flowHighlight.ids : [] }),
              renderHistoricalDiagrams(flow)) : branchBody)) : empty,
          renderFlowSourceDrawer())
      }

      function renderCoverage() {
        const acquisition = workbench?.run?.run_id === current?.run_id ? workbench.run.coverage : null
        const setters = { query: setGapQuery, kind: setGapKind, source: setGapSource, analysis_status: setGapStatus, disposition: setGapDisposition }
        return h(CoverageBrowser, { key: current?.run_id, cwd, task: selectedTask, runId: current?.run_id,
          target: current?.target, revision: current?.publication?.revision, acquisition,
          gaps: details.coverage_gaps ?? [], flows: businessFlows,
          filters: { query: gapQuery, kind: gapKind, source: gapSource, analysis_status: gapStatus, disposition: gapDisposition },
          onReload: loadWorkbench,
          onNewQuery: query => {
            setCreateForm(value => ({ ...value, source_task_id: selectedTask.task_id, repository: selectedTask.repository, target: selectedTask.target,
              source_scope_text: selectedTask.source_scope.join('\n'), asset_ids: selectedTask.asset_ids,
              scenario: 'coverage-analysis', mode: selectedTask.mode, provider_id: selectedTask.provider || '',
              agent_model: selectedTask.provider ? selectedTask.agent_model || '' : '', model_route_key: '', external_selection_required: !selectedTask.provider,
              coverage_kind: 'query', coverage_product: query.product || '', coverage_version: query.c_version || '',
              coverage_module: query.scope || query.module || '', coverage_recursive: query.recursive !== false, coverage_source: query.source || 'summary', coverage_b_version: query.b_version || '' }))
            setScreen({ type: 'create' })
          },
          onFilter: (key, value) => setters[key](value), renderLinks: linkedItems })
      }

      function renderRepositoryImport(firstUse = false) {
        const folderReady = Boolean(repositoryForm.sourcePath)
        const copyReady = folderReady && Boolean(repositoryForm.repositoryName.trim())
        if (!firstUse) {
          const name = repositoryForm.repositoryName.trim()
          const dataRoot = repositoryState?.data_root ?? workbench?.data_root ?? 'pangea-data'
          const target = `${repositoryNameFromPath(dataRoot)} / repositories / ${name || '待命名'}`
          const button = (label, action, variant = '', iconName, disabled = false) => h('button', { type: 'button', className: `btn ${variant}`, disabled: repositoryImporting || disabled, onClick: action }, iconName && runIcon(iconName), label)
          const path = value => h('div', { className: 'create-import-path mono', title: value === target ? `${dataRoot}/repositories/${name}` : value, style: { overflowWrap: 'anywhere' } }, value)
          const phase = (number, title, copy, kind) => h('div', { className: `create-import-phase ${kind}` }, h('span', null, number), h('div', null, h('strong', null, title), h('p', null, copy)))
          return h('section', { className: 'pangea-ui pangea-create-workspace', 'aria-label': '添加源码仓库' },
            pageHeader({ title: '添加源码仓库', ui: ctx.pangea?.ui, onBack: goBack, backLabel: pageMode === 'home' ? '返回工作台' : history.at(-1)?.type === 'create' ? '返回新建分析' : '返回分析任务' }),
            h('div', { className: 'create-import-shell' }, h('div', { className: 'cols' },
              h('section', { className: 'panel' },
                h('div', { className: 'create-import-hero' }, h('div', { className: 'create-import-symbol', style: repositoryImporting ? { color: '#497ba4', background: '#f2f6fb', borderColor: '#dce7f0' } : undefined }, runIcon(repositoryImporting ? 'Copy' : 'FolderGit2')), h('div', null, h('div', { className: 'create-focus-label', style: repositoryImporting ? { color: '#497ba4' } : undefined }, repositoryImporting ? 'IMPORT IN PROGRESS' : 'SOURCE REPOSITORY'), h('h2', { className: 'create-heading', style: { margin: '7px 0 0' } }, repositoryImporting ? `正在复制 ${name}` : '把源码加入 PANGEA'))),
                h('p', { className: 'create-copy' }, repositoryImporting ? '正在准备独立的分析副本。请保持窗口打开，完成后仓库会自动出现在列表中。' : '选择源码目录，复制到 PANGEA 工作区后，即可开始分析。'),
                repositoryImporting && h(React.Fragment, null, h('div', { className: 'create-progress', role: 'progressbar', 'aria-label': '正在复制，进度未确定' }, h('span')), h('div', { className: 'row between small muted' }, h('span', null, '正在复制源码与 .git 历史'), h('span', null, '处理中')), h('div', { className: 'divider' })),
                h('div', { className: repositoryImporting ? 'create-subhead' : 'create-form-label' }, h('span', null, repositoryImporting ? '来源' : '源码仓库目录'), !repositoryImporting && button('选择文件夹', chooseRepositoryFolder, 'ghost', 'FolderOpen')),
                path(repositoryForm.sourcePath || '尚未选择文件夹'),
                !repositoryImporting && h('label', { className: 'field', style: { marginTop: 23 } }, h('span', null, '仓库名称'), h('input', { 'aria-label': '仓库名称', value: repositoryForm.repositoryName, onChange: event => setRepositoryForm(value => ({ ...value, repositoryName: event.target.value })) }), h('span', { className: 'hint' }, '自动根据目录命名，可在导入前修改。')),
                h('div', { className: 'create-subhead' }, repositoryImporting ? '目标仓库' : '目标位置'), path(target),
                repositoryImporting ? h('div', { className: 'callout', style: { marginTop: 24 } }, h('div', { className: 'row' }, runIcon('Info'), h('span', { className: 'small' }, '复制结束前，仓库尚不可用于新建分析。'))) : h('div', { className: 'notice blue', style: { marginTop: 22 } }, h('div', { className: 'notice-main' }, runIcon('Info'), h('div', null, h('strong', null, '完整保存源码与 Git 历史'), h('p', null, '复制到临时目录，成功后一次性加入仓库列表。原目录保持不变，同名仓库不会被覆盖。')))),
                repositoryError && h('p', { role: 'alert', style: { color: 'var(--red)', marginTop: 15 } }, repositoryError),
                h('div', { className: 'wizard-footer' }, repositoryImporting ? h('span', { className: 'create-footer-note' }, runIcon('ShieldCheck'), '原始源码保持不变') : button('取消', goBack, 'ghost'), repositoryImporting ? h('button', { className: 'create-disabled', disabled: true }, '正在添加仓库…') : button('添加仓库', submitRepositoryImport, 'primary', 'FolderPlus', !copyReady))),
              h('aside', null, h('section', { className: 'panel' }, h('div', { className: 'create-side-title' }, repositoryImporting ? '导入状态' : '导入方式'),
                phase(repositoryImporting ? runIcon('Check') : '1', repositoryImporting ? '数据目录已就绪' : '准备数据目录', repositoryImporting ? 'PANGEA 本地工作区可用' : 'PANGEA 工作区已就绪', ''), phase(repositoryImporting ? runIcon('Check') : '2', repositoryImporting ? '源码目录已选择' : '选择源码仓库', repositoryImporting ? name : '选择本机目录，设置仓库名称', repositoryImporting ? '' : 'active'), phase(repositoryImporting ? runIcon('LoaderCircle') : '3', repositoryImporting ? '正在完整复制' : '完整复制', repositoryImporting ? '暂存完成后一次性加入仓库列表' : '复制成功后，仓库可用于分析', repositoryImporting ? 'active' : 'pending'), repositoryImporting && h(React.Fragment, null, h('div', { className: 'divider' }), h('p', { className: 'create-side-note', style: { marginTop: 0 } }, '完成后，你可以选择这个仓库并创建第一项分析。')))))))
        }
        const step = (number, title, copy, kind) => h('div', { className: `b06-onboard-step ${kind}` }, h('b', null, kind === 'done' ? '✓' : number), h('div', null, h('strong', null, title), h('p', null, copy)))
        return h('div', { className: 'b06-onboard' },
          h('nav', { className: 'b06-breadcrumb', 'aria-label': '当前位置' }, h('span', null, '工作空间'), h('span', null, '›'), h('span', null, '工作台'), h('span', null, '›'), h('span', null, repositoryImporting ? '正在复制仓库' : repositoryError ? '仓库导入失败' : folderReady ? '仓库已选择' : '选择源码仓库')),
          h('header', { className: 'b06-home-head b06-onboard-head' }, h('div', null, h('h1', null, '欢迎使用 PANGEA'), h('p', null, '准备本地测试工作区，开始第一次分析。'))),
          h('div', { className: 'b06-onboard-grid' },
            h('section', { className: 'b06-panel', 'aria-labelledby': 'pangea-repository-title' },
              h('div', { className: 'b06-eyebrow' }, 'WELCOME / PANGEA'), h('h2', { id: 'pangea-repository-title' }, '从一个源码仓库开始'),
              h('p', { className: 'b06-onboard-lead' }, '本地数据空间已经准备就绪。加入源码后，分析任务、测试资产和报告会在同一工作区中集中管理。'),
              h('div', { className: 'b06-repo' }, h('div', { className: 'b06-row' }, runIcon('FolderGit2'), h('strong', null, '本地数据空间')), h('span', { className: 'b06-badge green' }, '已就绪')),
              h('div', { className: 'b06-divider' }),
              h('label', { className: 'b06-field' }, '源码仓库目录', h('span', { className: 'b06-field-row' }, h('input', { readOnly: true, 'aria-label': '源码仓库目录', value: repositoryForm.sourcePath, placeholder: '选择已有源码目录' }), h('button', { type: 'button', className: 'b06-button', disabled: repositoryImporting, onClick: () => { void chooseRepositoryFolder() } }, runIcon('FolderOpen'), '选择文件夹'))),
              h('label', { className: 'b06-field' }, '仓库名称', h('input', { 'aria-label': '仓库名称', value: repositoryForm.repositoryName, disabled: repositoryImporting, placeholder: '选择目录后自动填写', onChange: event => setRepositoryForm(value => ({ ...value, repositoryName: event.target.value })) })),
              h('p', { className: 'b06-hint' }, '可修改显示名称，已有同名仓库不会被覆盖。'),
              repositoryImporting ? h(React.Fragment, null, h('div', { className: 'b06-copy-progress', role: 'progressbar', 'aria-label': '正在复制，进度未确定' }), h('div', { className: 'b06-banner', role: 'status', style: { background: '#edf3f8', color: '#416b95' } }, h('div', null, h('strong', null, '正在加入源码仓库'), '正在完整复制源码与 Git 历史，请保持窗口打开。')))
                : repositoryError ? h('div', { className: 'b06-banner', role: 'alert', style: { marginTop: 20 } }, h('div', null, h('strong', null, '源码仓库复制未完成'), repositoryError))
                  : h('p', { className: 'b06-hint', style: { marginTop: 17 } }, '导入会复制完整源码与 .git 历史，原目录保持不变。'),
              h('div', { className: 'b06-onboard-foot' }, h('span', { className: 'b06-meta' }, repositoryImporting ? '复制完成后进入工作台' : '首次使用 · 工作区初始化'), h('button', { type: 'button', className: 'b06-button primary', disabled: !copyReady || repositoryImporting, 'aria-busy': repositoryImporting, onClick: () => { void submitRepositoryImport() } }, repositoryImporting ? '正在复制…' : repositoryError ? '重试加入' : '完成初始化'))),
            h('aside', { className: 'b06-panel' }, h('h2', null, '准备你的测试工作区'),
              step('01', '数据空间已就绪', '保存任务、冻结输入与交付结果。', 'done'),
              step('02', '选择源码仓库', '从本地已有目录加入源码。', folderReady ? 'done' : 'current'),
              step('03', '完整复制源码', '成功后进入工作台，开始分析。', repositoryImporting ? 'current' : ''),
              h('div', { className: 'b06-divider' }), h('p', { className: 'b06-hint' }, '分析始终基于创建时冻结的源码与资产版本，结论可以追溯到对应输入。'))))
      }

      function renderHome() {
        if (repositoryState?.onboarding_required) return renderRepositoryImport(true)
        const loadingHome = !workbench && !workbenchError
        const failedHome = !workbench && Boolean(workbenchError)
        const staleHome = Boolean(workbench && workbenchError)
        const incompatibleHome = workbench?.compatibility?.compatible === false
        const available = Boolean(workbench) && !failedHome && !incompatibleHome
        const tasks = available ? taskItems : []
        const runs = available ? workbench?.runs?.items ?? [] : []
        const running = tasks.filter(task => ['preparing', 'starting', 'running', 'stopping'].includes(task.execution_status) || ['preparing', 'running'].includes(task.status))
        const attention = tasks.filter(task => ['needs_attention', 'failed'].includes(task.status))
        const completed = tasks.filter(task => task.status === 'completed')
        const reportRuns = runs.filter(run => run.report_available === true)
        const reports = reportRuns.slice(0, 2)
        const emptyTasks = available && tasks.length === 0
        const repository = workbench?.capabilities?.repositories?.[0] ?? workbench?.repositories?.items?.[0]?.repository_id
          ?? repositoryState?.repositories?.[0]?.name
        const refresh = () => {
          setHomeRefreshed(false)
          void loadRepositories()
          void loadWorkbench().then(result => { if (result) setHomeRefreshed(true) })
        }
        const button = (label, action, primary = false, disabled = false, iconName, busy = false) => h('button', { type: 'button', className: `b06-button${primary ? ' primary' : ''}`, disabled, 'aria-busy': busy, onClick: action }, iconName && runIcon(iconName), label)
        const section = (title, extra, body) => h('section', { className: 'b06-panel' }, h('div', { className: 'b06-section-head' }, h('h2', null, title), extra), body)
        const muted = value => h('div', { className: 'b06-muted', role: 'status' }, value)
        const skeleton = height => h('span', { className: 'b06-skeleton', style: { height } })
        const metric = (iconName, label, value) => h('section', { className: 'b06-metric' }, h('span', { className: 'b06-icon' }, runIcon(iconName)), h('div', null, h('small', null, label), h('strong', null, available ? value : '—')))
        const notice = failedHome ? ['工作台暂时无法同步', '任务与报告尚未读取成功，请重试连接。', '重新同步']
          : incompatibleHome ? ['当前工作区需要更新', '当前接口版本不支持分析工作台。更新 PANGEA 工作区后重新检测。', '重新检测']
            : staleHome ? ['同步中断，保留上次结果', `最后同步于${workbench.__clientSyncedAt ? taskUpdatedLabel(workbench.__clientSyncedAt) : '上次成功读取时'} · 当前执行状态待重新确认。`, '重新同步'] : null
        const reportTitle = run => tasks.find(task => task.run_id === run.run_id)?.title ?? runLabel(run)
        return h('div', { className: 'b06-home' },
          pageHeader({ title: '测试工作台', ui: ctx.pangea?.ui, actions: h('div', { className: 'b06-head-actions' }, button(workbenchLoading ? '刷新中…' : '刷新', refresh, false, workbenchLoading, 'RefreshCw', workbenchLoading), button('添加仓库', openRepositoryImport, false, false, 'FolderPlus'), button('新建分析', openAnalysisCreate, true, !available || staleHome, 'Plus')) }),
          notice && h('div', { className: 'b06-banner', role: 'alert' }, h('div', null, h('strong', null, notice[0]), h('span', null, notice[1])), button(notice[2], refresh)),
          !notice && homeRefreshed && h('div', { className: 'b06-banner success', role: 'status' }, h('div', null, h('strong', null, '工作台已同步'), h('span', null, '任务状态与报告列表已更新。'))),
          h('div', { className: 'b06-metrics', 'aria-label': '任务指标' }, metric('Cpu', '进行中', running.length), metric('CircleAlert', '需要处理', attention.length), metric('CircleCheck', '已完成', completed.length), metric('FileText', '已有报告', reportRuns.length)),
          h('div', { className: 'b06-home-grid' },
            h('div', { className: 'b06-stack' },
              section('需要处理', h('button', { className: 'b06-link', type: 'button', onClick: () => openProductPage('analysis', '分析任务') }, '全部任务 ↗'),
                loadingHome ? h(React.Fragment, null, skeleton(13), h('div', { className: 'b06-skeleton', style: { height: 135, marginTop: 15 } }))
                  : !available ? muted('待办暂不可用，连接恢复后会显示任务状态。')
                    : !attention.length ? muted(h(React.Fragment, null, h('strong', null, '当前没有待处理事项'), h('p', null, emptyTasks ? '从一个明确的源码范围开始，创建第一个分析任务。' : '继续查看分析任务，或阅读已经生成的报告。')))
                      : attention.slice(0, 1).map(task => h('article', { key: task.task_id, className: 'b06-attention' },
                        h('div', { className: 'b06-row' }, h('span', { className: 'b06-badge' }, task.status === 'failed' ? '运行失败' : '等待决定'), h('span', { className: 'b06-meta' }, taskRunLabel(task.run_id))),
                        h('h3', null, task.title), h('p', null, task.status === 'failed' ? '本次分析未正常完成，请查看失败记录和可继续操作。' : text(task.needs_user_reason, '分析需要处理，请查看当前 Run 的处理方式。')),
                        h('div', { className: 'b06-attention-foot' }, h('span', { className: 'b06-meta' }, `${task.repository || '当前仓库'} / ${task.target || '分析目标'} · ${taskUpdatedLabel(task.updated_at)}`), button('查看处理方式', () => openTaskFromWorkbench(task), true))))),
              section('进行中的分析', available && running.length ? h('span', { className: 'b06-badge blue' }, `${running.length} 个运行中`) : null,
                loadingHome ? skeleton(85) : !available ? muted('运行状态尚未读取，不推断任务是否已完成。') : !running.length ? muted(emptyTasks ? '创建分析后，可在这里接续运行。' : '当前没有进行中的分析。')
                  : running.slice(0, 2).map(task => h('div', { key: task.task_id, className: 'b06-running' }, h('span', { className: 'b06-icon' }, runIcon('ScanLine')),
                    h('div', null, h('strong', null, task.title), h('p', null, `${task.scenario === 'module-analysis' ? '源码区域分析' : '分析中'} · ${task.repository || '当前仓库'} / ${task.target || '分析目标'}`)), button('查看进度', () => openTaskFromWorkbench(task))))),
              h('div', { className: 'b06-shortcuts' }, [['ScanLine', '分析任务', '查看所有任务，接续分析与测试设计。', 'analysis'], ['Library', '测试资产', '管理资料、审核条目和可复用的方法论。', 'assets']].map(([glyph, title, copy, page]) =>
                h('button', { key: page, type: 'button', className: 'b06-panel b06-shortcut', onClick: () => openProductPage(page, title) }, h('span', { className: 'b06-icon' }, runIcon(glyph)), h('span', null, h('strong', null, title), h('p', null, copy)))))),
            h('aside', { className: 'b06-stack' },
              section('最近报告', h('small', null, available ? `${reportRuns.length} 份已载入` : '等待同步'),
                loadingHome ? skeleton(158) : !available ? muted('报告列表暂不可用。') : !reports.length ? muted(emptyTasks ? '分析生成报告后，可从这里继续阅读。' : '分析尚未生成报告，已保存结果可在任务中查看。')
                  : reports.map(run => h('button', { key: run.run_id, type: 'button', className: 'b06-report', onClick: () => openAnalysisRun(run) }, h('span', { className: 'b06-icon', style: { width: 36, height: 36, flexBasis: 36 } }, reportGlyph()), h('span', null, h('strong', null, reportTitle(run)), h('span', { className: 'b06-meta' }, `${taskRunLabel(run.run_id)} · ${taskUpdatedLabel(run.completed_at ?? run.updated_at)}`)), '›'))),
              section('源码仓库', null, h(React.Fragment, null,
                repositoryError ? h('div', { role: 'alert' }, h('p', null, `源码仓库状态读取失败：${repositoryError}`), button('重试检查仓库', () => { void loadRepositories() }, false, repositoryLoading))
                  : repository ? h('div', { className: 'b06-repo' }, h('div', { className: 'b06-row' }, runIcon('FolderGit2'), h('strong', null, repository)), h('span', { className: 'b06-badge green' }, '已就绪'))
                    : repositoryState === undefined ? muted('正在检查源码仓库…') : muted('当前没有可用的源码仓库。'),
                h('p', { className: 'b06-repo-note' }, '分析时冻结选定源码，资产与报告保存在当前工作区。'), h('div', { className: 'b06-divider' }), h('button', { type: 'button', className: 'b06-link', onClick: openRepositoryImport }, '添加源码仓库 ↗'))))))
      }

      function taskStatusLabel(status) {
        return {
          preparing: '正在准备',
          starting: '正在启动',
          running: '分析中',
          stopping: '正在停止',
          needs_attention: '需要处理',
          completed: '已完成',
          stopped: '已停止',
          failed: '失败',
        }[status] ?? status ?? '待定'
      }

      function taskStatusColor(status) {
        if (status === 'failed' || status === 'needs_attention') return '#c7000b'
        if (status === 'stopped') return '#6b7280'
        if (status === 'preparing') return '#d97706'
        if (status === 'starting' || status === 'stopping') return '#6b7280'
        if (status === 'running') return '#2f7acb'
        return '#2da44e'
      }

      function taskRunLabel(runId) {
        const number = String(runId ?? '').match(/(\d+)$/)?.[1]
        return number ? `RUN ${number}` : `RUN ${text(runId, '未记录')}`
      }

      function taskUpdatedLabel(value) {
        const date = new Date(value)
        if (Number.isNaN(date.getTime())) return '—'
        const now = new Date()
        const dateParts = date => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric',
        }).formatToParts(date).map(part => [part.type, Number(part.value)]))
        const dayNumber = ({ year, month, day }) => Date.UTC(year, month - 1, day) / 86_400_000
        const currentDay = dateParts(now), updatedDay = dateParts(date)
        const dayDelta = dayNumber(currentDay) - dayNumber(updatedDay)
        const clock = new Intl.DateTimeFormat('zh-CN', {
          timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false,
        }).format(date)
        if (dayDelta === 0) return `今天 ${clock}`
        if (dayDelta === 1) return `昨天 ${clock}`
        return `${updatedDay.month} 月 ${updatedDay.day} 日`
      }

      function taskScenarioLabel(task, run) {
        const scenario = run?.scenario ?? task?.scenario
        const mode = run?.mode ?? task?.mode
        const scenarioLabel = ({ 'module-analysis': '模块分析', 'coverage-analysis': '覆盖率分析', 'risk-analysis': '风险分析', 'branch-analysis': '分支分析' })[scenario] ?? text(scenario, '分析场景未记录')
        const modeLabel = ({ depth: '标准型', standard: '标准型', speed: '速度型', fast: '速度型' })[mode] ?? text(mode, '模式未记录')
        return task?.status === 'needs_attention' ? `${modeLabel} · 等待修正决策` : `${scenarioLabel} · ${modeLabel}`
      }

      function taskStatusTone(status) {
        if (status === 'needs_attention') return 'warn'
        if (status === 'running' || status === 'starting') return 'blue'
        if (status === 'completed') return 'good'
        return ''
      }

      function renderTasks() {
        const query = taskQuery.trim().toLowerCase()
        const allRuns = workbench?.runs?.items ?? snapshot?.runs ?? []
        const linkedRunFor = task => task.run_id ? allRuns.find(run => run.run_id === task.run_id) : null
        const sortedTasks = [...taskItems].sort((left, right) => {
          const leftTime = Date.parse(left.updated_at ?? linkedRunFor(left)?.updated_at ?? '') || 0
          const rightTime = Date.parse(right.updated_at ?? linkedRunFor(right)?.updated_at ?? '') || 0
          return rightTime - leftTime
        })
        const filtered = sortedTasks.filter(task => {
          if (taskStatus !== '全部' && !(taskStatus === 'needs_attention' ? ['needs_attention', 'failed'].includes(task.status) : task.status === taskStatus) && !(taskStatus === 'running' && ['starting', 'running', 'stopping'].includes(task.execution_status))) return false
          return !query || [task.title, task.target, task.repository, task.task_id, task.run_id].filter(Boolean).join(' ').toLowerCase().includes(query)
        })
        const statusFilters = [
          ['全部', '全部'], ['running', '运行中'], ['needs_attention', '需要处理'],
          ['completed', '已完成'], ['stopped', '已停止'],
        ]
        const hasFilters = Boolean(query || taskStatus !== '全部')
        const resetFilters = () => { setTaskQuery(''); setTaskStatus('全部') }
        const runningCount = taskItems.filter(task => ['starting', 'running', 'stopping'].includes(task.execution_status) || task.status === 'running').length
        const attentionCount = taskItems.filter(task => ['needs_attention', 'failed'].includes(task.status)).length
        const completedCount = taskItems.filter(task => task.status === 'completed').length
        const firstUse = Boolean(workbench && !workbenchError && taskItems.length === 0)
        const filteredEmpty = Boolean(workbench && !workbenchError && taskItems.length > 0 && filtered.length === 0)
        const taskTotal = workbench?.tasks?.total ?? taskItems.length
        const repositoryLabel = text(taskItems[0]?.repository, text(workbench?.repositories?.items?.[0]?.repository_id, '当前仓库'))
        const knownRunIds = new Set(taskItems.map(task => task.run_id).filter(Boolean))
        const unlinkedRuns = allRuns.filter(run => !run.task_id && !knownRunIds.has(run.run_id))
        const rows = filtered.map(task => {
          const status = task.execution_status === 'stopping' ? 'stopping' : task.status
          const linkedRun = linkedRunFor(task)
          const repository = text(task.repository, text(linkedRun?.repository, '未记录仓库'))
          const target = text(task.target, text(linkedRun?.target, '未记录分析目标'))
          return h('tr', { key: task.task_id, className: 'pangea-task-row' },
            h('td', null,
              h('div', { className: 'b03-task-first-cell' },
                h('span', { className: 'b03-task-icon', 'aria-hidden': true }, runIcon(status === 'needs_attention' ? 'CircleAlert' : 'ScanLine')),
                h('div', { style: { minWidth: 0 } },
                  h('button', { type: 'button', className: 'b03-task-title', onClick: () => chooseTask(task), 'aria-label': '打开任务 ' + task.title }, task.title || task.task_id, runIcon('ArrowUpRight')),
                  h('div', { className: 'b03-task-subtitle' }, taskScenarioLabel(task, linkedRun))))),
            h('td', { className: 'b03-task-repository' }, `${repository} / ${target}`),
            h('td', null, h('span', { className: `b03-task-status ${taskStatusTone(status)}` }, status === 'running' ? '运行中' : taskStatusLabel(status))),
            h('td', null, linkedRun
              ? h('div', { className: 'b03-task-run-cell' },
                h('span', { className: 'b03-task-meta mono' }, taskRunLabel(task.run_id)),
                h('button', { type: 'button', className: 'b03-task-run', onClick: () => chooseRun(task.run_id), 'aria-label': '打开 ' + taskRunLabel(task.run_id) + ' 运行过程' }, '运行过程', runIcon('ArrowUpRight')))
              : h('span', { className: 'b03-task-meta' }, '未关联运行')),
            h('td', { className: 'b03-task-meta' }, taskUpdatedLabel(task.updated_at ?? linkedRun?.updated_at)),
            h('td', null, h('div', { className: 'pangea-task-row-actions' },
              h('button', { type: 'button', className: 'b03-task-open', onClick: () => chooseTask(task), 'aria-label': '打开任务 ' + task.title }, runIcon('ArrowRight'), '打开'),
              taskActionButtons(task))))
        })
        const unlinkedRunRows = unlinkedRuns.map(run => h('div', { key: run.run_id, className: 'b03-unlinked-row' },
          h('div', { style: { minWidth: 0 } },
            h('div', { className: 'b03-task-title' }, runLabel(run)),
            h('div', { className: 'b03-task-subtitle' }, taskRunLabel(run.run_id) + ' · ' + (run.repository ?? run.workspace ?? '未记录仓库') + ' / ' + (run.target ?? run.analysis_target ?? '未记录分析目标') + ' · ' + taskUpdatedLabel(run.updated_at))),
          h('button', { type: 'button', className: 'b03-task-open', onClick: () => chooseRun(run.run_id) }, '查看运行', runIcon('ArrowRight'))))
        const taskContent = workbenchError
          ? h('div', { className: 'pangea-empty-state', role: 'alert' }, '任务列表暂不可用，请重试同步。')
          : !workbench
          ? h('div', { className: 'pangea-empty-state', role: workbenchError ? 'alert' : 'status' }, workbenchError ? '任务列表暂不可用，请重试同步。' : '正在读取分析任务…')
          : taskItems.length && filtered.length
            ? h('div', { className: 'b03-task-table-wrap' }, h('table', { className: 'b03-task-table', 'aria-label': '分析任务' },
              h('colgroup', null, [33, 12.4, 10, 17.6, 10, 17].map((width, index) => h('col', { key: index, style: { width: `${width}%` } }))),
              h('thead', null, h('tr', null,
                h('th', { scope: 'col' }, '分析任务'),
                h('th', { scope: 'col' }, '仓库 / 范围'),
                h('th', { scope: 'col' }, '状态'),
                h('th', { scope: 'col' }, 'Run / 运行过程'),
                h('th', { scope: 'col' }, '更新时间'),
                h('th', { scope: 'col' }, '操作'))),
              h('tbody', null, rows)))
            : taskItems.length
              ? h('div', { className: 'b03-task-filter-empty-content', role: 'status' },
                h('span', { className: 'b03-task-filter-empty-icon', 'aria-hidden': true }, runIcon('FolderOpen')),
                h('h2', null, '没有找到匹配的任务'),
                h('p', null, `未找到${query ? `包含「${taskQuery.trim()}」` : ''}${taskStatus !== '全部' ? `${query ? '且' : ''}${statusFilters.find(([value]) => value === taskStatus)?.[1] ?? '所选状态'}` : ''}的任务。已有任务仍保留在列表中。`),
                h('button', { type: 'button', onClick: resetFilters }, runIcon('X'), '清除筛选'))
              : h('div', { className: 'b03-task-first-use' },
                h('div', { className: 'b03-task-first-use-content', role: 'status' },
                  h('span', { className: 'b03-task-empty-icon', 'aria-hidden': true }, runIcon('FolderOpen')),
                  h('h2', null, '创建你的第一个分析任务'),
                  h('p', null, '选择源码范围，带入参考资料，让 PANGEA 梳理业务流程、源码依据与测试建议。'),
                  h('button', { type: 'button', disabled: workbench?.compatibility?.compatible !== true, className: 'b03-task-action b03-task-action-primary', onClick: () => jump('create') }, runIcon('Plus'), '新建分析')),
                h('div', { className: 'b03-task-first-use-steps', 'aria-label': '分析任务的三个步骤' },
                  [['01', '确定目标', '明确要分析的模块与源码范围。'], ['02', '补充资料', '按需加入需求、设计和历史缺陷。'], ['03', '查看结果', '在运行过程中查看阶段与产物。']].map(([number, title, detail]) => h('div', { key: number },
                    h('span', null, number), h('strong', null, title), h('p', null, detail)))))
        const unlinkedSection = !firstUse && !filteredEmpty && unlinkedRuns.length
          ? h('details', { className: 'b03-unlinked-runs' }, h('summary', null, '未关联任务的运行 · ' + unlinkedRuns.length), h('div', null, unlinkedRunRows))
          : null
        const standardActions = h('div', { className: 'b03-task-actions' },
          h('button', { type: 'button', className: 'b03-task-action', onClick: openRepositoryImport }, runIcon('FolderPlus'), '添加仓库'),
          h('button', { type: 'button', disabled: workbench?.compatibility?.compatible !== true, className: 'b03-task-action b03-task-action-primary', onClick: () => jump('create') }, runIcon('Plus'), '新建分析'))
        const simpleAction = h('div', { className: 'b03-task-actions' },
          h('button', { type: 'button', disabled: workbench?.compatibility?.compatible !== true, className: 'b03-task-action b03-task-action-primary', onClick: () => jump('create') }, runIcon('Plus'), '新建分析'))
        const taskActions = firstUse || filteredEmpty ? simpleAction : standardActions
        const taskSubtitle = firstUse
          ? '从一个明确的分析目标开始。'
          : filteredEmpty
            ? `${repositoryLabel} · ${taskTotal} 个分析任务`
            : '所有分析目标与运行记录，都从这里接续。'
        const taskPageHeader = pageHeader({ title: '分析任务', ui: ctx.pangea?.ui, actions: taskActions })
        const filterEmptyControls = filteredEmpty ? h('div', { className: 'b03-task-controls' },
          h('input', { id: 'pangea-task-search', className: 'b03-task-search', type: 'search', value: taskQuery, 'aria-label': '搜索分析任务', placeholder: '搜索分析目标或仓库…', onChange: event => setTaskQuery(event.target.value) }),
          h('div', { className: 'b03-task-control-row' },
            h('button', { type: 'button', className: 'b03-task-filter-chip', 'aria-label': '需要处理', 'aria-pressed': taskStatus === 'needs_attention', onClick: () => setTaskStatus(taskStatus === 'needs_attention' ? '全部' : 'needs_attention') },
              '需要处理', taskStatus === 'needs_attention' ? h('span', { 'aria-hidden': true }, '×') : null))) : null
        const standardControls = !firstUse && !filteredEmpty && (taskItems.length || workbenchError || !workbench)
          ? h('div', { className: 'b03-task-controls' },
            h('input', { id: 'pangea-task-search', className: 'b03-task-search', type: 'search', value: taskQuery, 'aria-label': '搜索分析任务', placeholder: '搜索分析目标或仓库…', onChange: event => setTaskQuery(event.target.value) }),
            h('div', { className: 'b03-task-control-row' },
              h('div', { className: 'b03-task-filters', role: 'group', 'aria-label': '按任务状态筛选' }, statusFilters.map(([value, label]) => h('button', {
                key: value, type: 'button', className: 'b03-task-filter', 'aria-pressed': taskStatus === value, onClick: () => setTaskStatus(value),
              }, label === '全部' ? `${label} ${taskItems.length}` : label))),
              h('span', { className: 'b03-task-sort' }, '按最近更新排序'))) : null
        return h(React.Fragment, null,
          renderCompatibility(),
          taskPageHeader,
          workbench && !workbenchError && !firstUse && !filteredEmpty ? h('div', { className: 'b03-task-metrics', 'aria-label': '任务概况' },
            [['全部任务', taskItems.length], ['运行中', runningCount], ['需要处理', attentionCount], ['已完成', completedCount]].map(([label, value]) => h('div', { key: label, className: 'b03-task-stat' }, h('span', null, label), h('strong', null, String(value)))),
          ) : null,
          h('section', { className: `b03-task-panel${firstUse ? ' first-use' : filteredEmpty ? ' filtered-empty' : ''}`, 'aria-label': '分析任务列表', 'aria-busy': workbenchLoading },
            filterEmptyControls ?? standardControls,
            taskContent,
            taskItems.length && !filteredEmpty ? h('div', { className: 'b03-task-footer', role: 'status' },
              h('span', null, `共 ${filtered.length} 个任务`), h('span', null, '1 / 1 页')) : null,
            unlinkedSection))
      }
      function runRecordTime(value) {
        if (Number.isFinite(value)) return value
        const parsed = Date.parse(value)
        return Number.isFinite(parsed) ? parsed : undefined
      }

      function reportAvailableFor(run) {
        const hasArtifact = Boolean(run?.artifacts?.report_html || run?.artifacts?.report_md)
        if (!hasArtifact || run.report_available === false) return false
        if (run.partial_delivery === true) return true
        return run.report_available === true || (run.lifecycle_status === 'complete'
          && run.publication?.state === 'final' && run.delivery_integrity?.status === 'complete')
      }

      function renderRunRecord() {
        const runItems = workbench?.runs?.items ?? snapshot?.runs ?? []
        const run = runItems.find(item => item.run_id === selectedRun) ?? snapshot?.current
        const runTitle = text(run?.title, text(run?.display_title, text(run?.analysis_title, text(current?.title, text(run?.target, text(current?.target, selectedRun ?? '运行记录'))))))
        const runId = current?.run_id ?? selectedRun ?? run?.run_id
        const repository = current?.repository ?? run?.repository
        const technicalTarget = current?.target ?? run?.analysis_target ?? run?.target
        const timeLabel = value => {
          const date = new Date(value)
          if (Number.isNaN(date.getTime())) return ''
          const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
          }).formatToParts(date).map(part => [part.type, part.value]))
          return `${parts.month} 月 ${parts.day} 日 ${parts.hour}:${parts.minute}`
        }
        const createdAt = current?.created_at ?? current?.started_at ?? run?.started_at
        const endedAt = current?.ended_at ?? run?.ended_at ?? run?.updated_at
        const started = runRecordTime(current?.started_at ?? run?.started_at)
        const ended = runRecordTime(current?.ended_at ?? run?.ended_at)
        const elapsedSeconds = Number.isFinite(started) && Number.isFinite(ended) && ended >= started ? Math.round((ended - started) / 1000) : null
        const runDuration = elapsedSeconds === null ? '未记录' : `${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(elapsedSeconds % 60).padStart(2, '0')}`
        const details = current?.details ?? {}
        const summaryRecord = [...(Array.isArray(current?.notes) ? current.notes : []), ...(Array.isArray(details.notes) ? details.notes : [])]
          .find(note => note.kind === 'summary')
        const summaryBody = summaryRecord?.body?.summary ?? summaryRecord?.source_record?.body?.summary ?? summaryRecord?.body
        const runSummary = typeof current?.summary === 'string' && current.summary.trim()
          ? current.summary
          : typeof summaryBody === 'string' && summaryBody.trim() ? summaryBody : ''
        const flows = details.business_flows ?? []
        const testCases = details.test_cases ?? []
        const inputFiles = (current?.input_materials ?? []).map(material => material.title ?? material.asset_id).filter(Boolean)
        const scenario = current?.analysis_settings?.scenario ?? run?.scenario ?? current?.scenario
        const mode = current?.analysis_settings?.mode ?? run?.mode ?? current?.mode
        const scenarioLabel = ({ 'module-analysis': '模块分析', 'coverage-analysis': '覆盖率分析', 'risk-analysis': '风险分析', 'branch-analysis': '分支分析' })[scenario] ?? text(scenario, '分析场景未记录')
        const modeLabel = ({ standard: '标准型', depth: '标准型', fast: '速度型', speed: '速度型' })[mode] ?? text(mode, '模式未记录')
        const statusLabel = current?.lifecycle_status === 'complete' ? '已完成'
          : current?.lifecycle_status === 'running' ? '运行中'
            : current?.lifecycle_status === 'stopped' ? '已停止'
              : current?.lifecycle_status === 'failed' ? '失败' : '状态未记录'
        const readOnlyMessage = run?.task_id
          ? '此运行记录关联的分析任务当前不可用。可以阅读冻结输入和交付摘要；任务控制操作不可用。'
          : '可阅读保留的运行记录、冻结输入与交付摘要。'
        const titleMeta = [repository && technicalTarget ? `${repository} / ${technicalTarget}` : repository ?? technicalTarget,
          runId ? `RUN ${String(runId).match(/(\d+)$/)?.[1] ?? runId}` : null, timeLabel(endedAt)].filter(Boolean).join(' · ')
        const statusBody = error || (loading ? '正在读取冻结的运行记录…' : '尚未读取当前运行记录。')
        const statusRegion = h('div', { className: 'b03-run-record-card', role: error ? 'alert' : 'status' }, statusBody)
        if (!selectedRun) return h('div', { className: 'b03-run-record-screen', role: 'region', 'aria-label': '运行记录 · 只读' }, statusRegion)
        return h('div', { className: 'b03-run-record-screen', role: 'region', 'aria-label': '运行记录 · 只读', 'data-run-id': runId ?? selectedRun,
          'data-task-id': run?.task_id ?? current?.task_id ?? '', 'aria-readonly': 'true' },
          renderCompatibility(),
          pageHeader({ title: runTitle, current, ui: ctx.pangea?.ui, onBack: () => jump('tasks') }),
          h('div', { className: 'b03-run-record-layout' },
            h('div', { className: 'b03-run-record-notice', role: 'note' }, runIcon('Info'),
              h('div', null, h('strong', null, run?.task_id ? '关联任务暂不可用' : '此运行未关联分析任务'), h('p', null, readOnlyMessage))),
            current ? h(React.Fragment, null,
              h('section', { className: 'b03-run-record-card', 'aria-label': '运行结果' },
                h('h2', null, '运行结果'),
                h('div', { className: 'b03-run-record-metrics' },
                  h('div', { className: 'b03-run-record-metric' }, h('span', null, '业务流程'), h('strong', null, displayCount('business_flows', flows.length))),
                  h('div', { className: 'b03-run-record-metric' }, h('span', null, '测试用例'), h('strong', null, displayCount('test_cases', testCases.length))),
                  h('div', { className: 'b03-run-record-metric' }, h('span', null, '运行时长'), h('strong', null, runDuration))),
                h('div', { className: 'b03-run-record-divider' }),
                h('div', { className: 'b03-run-record-summary' },
                  h('h3', { className: 'b03-run-record-summary-title' }, runTitle),
                  runSummary ? h('p', null, runSummary) : null,
                  h('p', { className: 'b03-run-record-summary-meta' }, [runId ? `RUN ${String(runId).match(/(\d+)$/)?.[1] ?? runId}` : null,
                    statusLabel, scenarioLabel, modeLabel].filter(Boolean).join(' · ')))),
              h('section', { className: 'b03-run-record-card', 'aria-label': '冻结输入' },
                h('h2', null, '冻结输入'),
                h('dl', { className: 'b03-run-record-inputs' },
                  h('dt', null, '源码范围'), h('dd', { className: 'mono' }, inputFiles.length ? inputFiles.join(' · ') : '未记录'),
                  h('dt', null, '创建时间'), h('dd', null, timeLabel(createdAt) || '未记录'))))
              : statusRegion))
      }

      function renderOverview() {
        if (screen.type === 'run-record' && !selectedTask) return renderRunRecord()
        if (!selectedTask && !workbenchError && (!workbench || workbenchLoading)) return h('div', { style: styles.card, role: 'status' }, '正在读取分析任务…')
        if (!selectedTask) return h(React.Fragment, null, renderCompatibility(), h('div', { style: styles.card },
          h('div', { style: styles.empty }, workbenchError ? '任务列表读取失败，请返回任务列表重试。' : '请先从任务列表选择一个分析任务。'),
          h('button', { type: 'button', style: { ...styles.primaryButton, marginTop: 10 }, onClick: () => jump('tasks') }, '返回任务列表')))
        const overviewBreadcrumb = null
        const overviewPageHero = pageHeader({ title: selectedTask.title || current?.target || '分析详情', task: selectedTask, current, ui: ctx.pangea?.ui, onBack: () => jump('tasks'), actions: h('div', { className: 'pangea-page-actions' }, derivationButton(), taskActionButtons(selectedTask)) })
        if (!current) {
          const launchEvents = taskLaunchEvents(selectedTask, workbench)
          const launchFailure = [...launchEvents].reverse().find(event => event.status === 'error')
          const presentation = deriveRunPresentation(selectedTask, null, null)
          const mayRetryLaunch = !analysisExecutorBlockedReason(selectedTask) && (!selectedTask.run_id || presentation.canResume)
          return h(React.Fragment, null, renderCompatibility(),
            overviewBreadcrumb, overviewPageHero, navigation,
            analysisExecutorBlockedReason(selectedTask) ? h('p', { role: 'status', className: 'b03-task-subtitle' }, analysisExecutorBlockedReason(selectedTask)) : null,
            h('div', { className: 'b03-overview-hero' },
              h('div', null, h('h2', null, presentation.executionLabel),
                h('p', null, selectedTask.status === 'failed' ? selectedTask.launch_error ?? '分析启动失败。' : '任务已保存，正在准备分析会话和 PANGEA Run。')),
              h('span', { style: styles.badge }, taskStatusLabel(selectedTask.status))),
            launchFailure ? h('div', { style: { ...styles.card, ...styles.healthError }, role: 'alert' },
              h('strong', null, '启动错误 · ' + (launchFailure.stage ?? '未知阶段')),
              h('p', null, launchFailure.error ?? launchFailure.message ?? selectedTask.launch_error ?? '未提供错误详情')) : null,
            renderLaunchDiagnostics(launchEvents),
            mayRetryLaunch ? h('button', { type: 'button', disabled: creatingRun, style: { ...styles.primaryButton, width: 'auto' }, onClick: () => { void startTask(selectedTask) } }, creatingRun ? '正在启动…' : selectedTask.run_id ? '继续分析' : '重试启动') : null,
            selectedTask.run_id && !presentation.canResume ? h('p', { className: 'b03-task-subtitle' }, '暂不能继续：' + presentation.resumeBlockedReason) : null)
        }
        const presentation = deriveRunPresentation(selectedTask, current, health)
        const executorRuns = snapshot?.executor_runs ?? []
        const observation = executionObservation(current, selectedTask, Boolean(error))
        const statusTitle = error ? '当前状态暂时无法确认'
          : presentation.running ? observation ? `${observation.stage} · ${observation.activity}` : current.phase_title ? `正在进行${current.phase_title}` : '分析正在运行'
          : presentation.stopping ? '正在等待停止确认'
            : presentation.needsAttention ? '修正结果等待你的决定'
              : presentation.failed ? '分析未完成'
          : presentation.stopped ? '本次运行已停止'
                  : current.partial_delivery ? '部分结果已交付'
                    : '分析结果已就绪'
        const statusHint = error ? '正在显示上次成功读取的结果；重新读取后再确认执行状态和续接位置。'
          : current.partial_delivery
          ? '已有结果已交付；未解决事项与未完成修正仍保留在报告中。'
          : presentation.running ? `${current.analysis?.total ?? '多个'} 个分析单元中，${current.analysis?.completed ?? 0} 个已接受。新的结果正在陆续保存。`
            : presentation.needsAttention ? (() => {
              const correctionActions = Array.isArray(current.workflow?.actions)
                ? current.workflow.actions.filter(action => action.stage === 'targeted_closure' && action.correction_id)
                : []
              const resolvedCorrections = correctionActions.filter(action => action.status === 'accepted' || action.status === 'resolved').length
              const unresolvedCorrections = current.workflow?.unresolved?.length
              return correctionActions.length && Number.isFinite(unresolvedCorrections)
                ? `当前执行预算已用完。${resolvedCorrections} 项修正已完成，还有 ${unresolvedCorrections} 项待处理。`
                : unresolvedCorrections
                  ? `当前执行预算已用完。还有 ${unresolvedCorrections} 项修正待处理。`
                  : '运行状态需要处理，请查看运行过程中的具体错误。'
            })()
              : presentation.stopped ? `${current.analysis?.completed ?? 0} / ${current.analysis?.total ?? '—'} 个分析单元已接受，源码快照与检查点已保存，可从运行过程继续。`
                : presentation.failed ? '本次执行未正常结束。已有结果和错误记录仍可查看。'
                : '已完成源码分析、独立复核与定向修正，结果可查看与交付。'
        const progressAction = presentation.needsAttention || presentation.failed || presentation.stopping || presentation.stopped || presentation.running
        const progressActionLabel = presentation.needsAttention ? '处理待办' : presentation.failed ? '查看失败原因' : presentation.stopping ? '查看停止进度' : presentation.stopped ? '前往继续分析' : '查看运行过程'
        const semanticVerdict = outcomePresentation(current).semantic
        const verdictBadge = current.terminal && semanticVerdict === 'PASS（审查者结论）' ? '审查 PASS'
          : current.terminal && semanticVerdict === 'UNRESOLVED（审查者结论）' ? '审查未解决'
            : null
        const previousFailures = previousAttemptFailures(selectedTask)
        const findingRows = buildOverviewFindings({ current, risks: riskEnabled ? risks : [], notes: current.details?.notes ?? current.notes ?? [] }).slice(0, 3).map(finding => h('tr', { key: finding.id },
          h('td', null, h('button', { type: 'button', className: 'b03-overview-topic', onClick: () => finding.kind === 'risk' ? navigate({ type: 'risk', id: finding.sourceRefs[0] }) : jump(finding.kind === 'workflow' ? 'workflow' : 'report') }, finding.title)),
          h('td', null, finding.summary || '查看来源记录'),
          h('td', null, finding.caseRefs.length ? h('button', { type: 'button', className: 'b03-task-run', onClick: () => jump('cases') }, `${finding.caseRefs.length} 条关联用例`) : '—'),
          h('td', null, finding.validationState)))
        const unresolved = current.workflow?.unresolved ?? []
        const unresolvedItems = unresolved.map((item, index) => ({ id: item?.id ?? item?.code ?? String(index + 1), text: typeof item === 'string' ? item : item?.message ?? item?.title ?? JSON.stringify(item) }))
        const summaryCount = (key, count) => {
          const value = displayCount(key, count)
          return value === `${count}（草稿）` ? String(count) : value
        }
        const summaryCounts = [
          ['业务流程', summaryCount('business_flows', businessFlows.length), presentation.countsAvailability === 'draft' ? '草稿 · 持续更新' : '主要路径已整理'],
          ['风险记录', riskEnabled ? summaryCount('risks', risks.length) : '不适用', riskEnabled ? (presentation.countsAvailability === 'draft' ? '待复核' : '附源码依据') : ''],
          ['测试用例', presentation.running ? '生成中' : presentation.stopped ? '待继续' : summaryCount('test_cases', testCases.length), presentation.running || presentation.stopped ? '分析完成后整理' : '含边界与异常'],
        ]
        const returnedSummary = executorRuns.length ? executorRuns.length + ' 条执行记录' : '0 条执行结果已回传'
        const findingsFooter = presentation.running
          ? `已接受 ${current.analysis?.completed ?? 0} / ${current.analysis?.total ?? '—'} 个源码单元，结论持续更新。`
          : presentation.stopped
            ? `已接受 ${current.analysis?.completed ?? 0} / ${current.analysis?.total ?? '—'} 个源码单元，检查点已保存。`
            : `${testCases.length} 条用例已设计 · ${returnedSummary}`
        const summaryNote = current.notes?.find(note => note.kind === 'summary')?.body?.summary
        const summaryText = text(current.summary, text(current.analysis_summary, text(summaryNote, statusHint)))
        return h(React.Fragment, null,
          renderCompatibility(),
          overviewBreadcrumb, overviewPageHero, navigation,
            analysisExecutorBlockedReason(selectedTask) ? h('p', { role: 'status', className: 'b03-task-subtitle' }, analysisExecutorBlockedReason(selectedTask)) : null,
          renderDerivationOrigin(),
          h('div', { className: 'b03-overview-hero' },
            h('div', null, h('h2', null, statusTitle,
              h('span', { className: `b03-overview-status b03-overview-status-${error ? 'unknown' : current.partial_delivery ? 'partial' : presentation.statusKey}` },
                error ? '上次记录' : current.partial_delivery ? '部分交付' : presentation.statusLabel)),
              h('p', null, statusHint)),
            h('button', { type: 'button', className: 'b03-overview-hero-action', onClick: () => progressAction ? jump('workflow') : testCases.length ? jump('cases') : reportAvailableFor(current) ? jump('report') : jump('workflow') },
              runIcon(progressAction ? 'ArrowRight' : reportAvailableFor(current) ? 'FileText' : 'ScanLine'),
              progressAction ? progressActionLabel : testCases.length ? '评审测试用例' : reportAvailableFor(current) ? '查看分析报告' : '查看运行过程')),
          presentation.failed ? h('p', { role: 'alert', className: 'notice danger' }, sourceFirstRecordBody(current.terminal_error || selectedTask.launch_error || current.blocking_reason || '未记录具体原因，请查看运行过程中的执行诊断。')) : null,
          reportAvailableFor(current) ? h('button', { type: 'button', className: 'b03-task-action', onClick: () => jump('report') }, '查看分析报告') : null,
          presentation.needsAttention && unresolvedItems.length ? h('section', { className: 'b03-overview-attention', role: 'alert' },
            h('div', null, h('strong', null, unresolvedItems[0].text), h('p', null, '可继续定向修正，或保留未解决项并交付已有结果。')),
            h('button', { type: 'button', onClick: () => jump('workflow') }, '查看处理方式')) : null,
          ['warning', 'error'].includes(health?.status) ? renderHealthCard(false) : null,
          h('details', { className: 'run-execution-details' }, h('summary', null, '执行状态详情'), h(RunExecutionSummary, { current, task: selectedTask, stale: Boolean(error), compact: true })),
          h('div', { className: 'b03-overview-layout' },
            h('div', { className: 'b03-overview-main' },
              h('section', { className: 'b03-overview-card' },
                h('h3', null, '分析发现与验证缺口'),
                h('p', { className: 'b03-task-subtitle' }, '按检查主题查看结论、设计用例和仍需验证的内容。'),
                findingRows.length ? h('div', { style: { overflowX: 'auto' } }, h('table', { className: 'b03-overview-findings' },
                  h('thead', null, h('tr', null, h('th', null, '检查主题'), h('th', null, '分析依据与待办'), h('th', null, '关联用例'), h('th', null, '验证状态'))),
                  h('tbody', null, findingRows))) : h('div', { className: 'b03-task-subtitle' }, collectionEmpty(testCases.length ? 'test_cases' : 'risks', '当前 Run 没有可展示的发现记录。')),
                h('div', { className: 'b03-overview-copy b03-overview-findings-footer' }, findingsFooter,
                  h('button', { type: 'button', className: 'b03-task-run', onClick: () => jump('cases') }, '查看用例与预期验证'))),
              h('section', { className: 'b03-overview-card' },
                h('h3', null, '结果摘要'),
                h('div', { className: 'b03-overview-summary' }, summaryCounts.map(([label, value, hint]) => h('div', { key: label },
                  h('span', null, label), h('strong', null, String(value)), hint ? h('small', null, hint) : null))),
              h('div', { className: 'b03-overview-copy' },
                h('p', null, summaryText),
                summaryNote && summaryNote !== summaryText ? h('p', { className: 'b03-task-subtitle' }, summaryNote) : null)),
              current.partial_delivery ? h('section', { className: 'b03-overview-card', role: 'status' },
                h('h3', null, current.partial_delivery ? '部分交付 · 未解决项保留' : '待处理事项'),
                unresolvedItems.length ? h('ul', null, unresolvedItems.map(item => h('li', { key: item.id }, h('strong', null, item.id + ' · '), item.text))) : h('p', null, '此报告标记为部分交付。尚未解决的内容以真实报告文件为准。')) : null,
              previousFailures.length ? h('details', { className: 'b03-overview-card' },
                h('summary', null, '上一次尝试失败'),
                h('p', { className: 'b03-task-subtitle' }, '当前已开始新的分析尝试；下面保留的是历史失败记录。'),
                h('div', { role: 'alert' }, previousFailures[0].terminal_error ?? '未记录上一次尝试的错误详情'),
                previousFailures[0].ended_at ? h('div', { className: 'b03-task-meta' }, '结束时间：' + formatDate(previousFailures[0].ended_at)) : null) : null,
              ),
            h('aside', { className: 'b03-overview-aside' },
              h('section', { className: 'b03-overview-card' },
                h('h3', null, '分析范围'),
                h('dl', { className: 'b03-overview-kv' },
                  h('dt', null, '源码仓库'), h('dd', null, current.repository ?? selectedTask.repository ?? '未记录'),
                  h('dt', null, '主要范围'), h('dd', null, selectedTask.source_scope?.length
                    ? selectedTask.source_scope.map(path => h('div', { key: path, className: 'b03-overview-file' }, path))
                    : current.target ?? '未记录'),
                  h('dt', null, '冻结文件'), h('dd', null, current.source_snapshot?.file_count == null ? '未记录' : `${current.source_snapshot.file_count} 个源码文件`),
                  h('dt', null, '分析单元'), h('dd', null, current.analysis?.total == null && workflow.units?.length == null ? '未记录' : `${current.analysis?.total ?? workflow.units.length} 个`)),
                h('div', { className: 'b03-overview-aside-divider' }),
                h('p', { className: 'b03-overview-aside-note' }, '具体引用位置随流程、风险和用例一起查看。')),
              h('section', { className: 'b03-overview-card' },
                h('div', { className: 'b03-overview-card-heading' },
                  h('h3', null, '本次执行'),
                  verdictBadge ? h('span', { className: `b03-overview-verdict ${verdictBadge === '审查 PASS' ? 'b03-overview-verdict-pass' : 'b03-overview-verdict-unresolved'}`, title: semanticVerdict, 'aria-label': `质量结论：${semanticVerdict}` }, verdictBadge) : null),
                h('dl', { className: 'b03-overview-kv' },
                  h('dt', null, '场景'), h('dd', null, ({ 'module-analysis': '模块分析', 'coverage-analysis': '覆盖率分析', 'risk-analysis': '风险分析', 'branch-analysis': '分支分析' })[current.scenario] ?? current.scenario ?? '未记录'),
                  h('dt', null, '模式'), h('dd', null, ({ depth: '标准型', speed: '速度型' })[current.mode] ?? current.mode ?? '未记录'),
                  h('dt', null, '复核方式'), h('dd', null, configuredReviewMethod(current)),
                  h('dt', null, '复核状态'), h('dd', null, semanticReviewStatusLabel(current)),
                  h('dt', null, '运行时长'), h('dd', { className: 'b03-task-meta' }, durationLabel(runRecordTime(current.started_at), runRecordTime(current.ended_at)) || (presentation.running ? '进行中' : '未记录'))),
                h('div', { className: 'b03-overview-aside-divider' }),
                h('button', { type: 'button', className: 'b03-task-run', onClick: () => jump('workflow') }, '查看本次运行过程', runIcon('ArrowUpRight')),
                presentation.canResume ? h('button', { type: 'button', disabled: creatingRun || Boolean(error), className: 'b03-task-open', onClick: () => { void startTask(selectedTask) } }, creatingRun ? '正在继续…' : '继续分析') : null))))
      }

      function renderReport() {
        if (!current || !reportAvailableFor(current)) return h('div', { style: styles.card, role: 'alert' },
          h('div', { style: styles.itemTitle }, '当前 Run 没有可读取的正式报告。'),
          h('button', { type: 'button', style: styles.button, onClick: () => jump(selectedTask ? 'overview' : 'tasks') }, selectedTask ? '返回任务概览' : '返回任务列表'))
        const partial = Boolean(current.partial_delivery)
        const executionRuns = snapshot?.executor_runs ?? []
        const notes = (details.notes ?? []).filter(item => ['summary', 'note'].includes(item.source_record?.kind ?? item.kind))
        const summaryNote = notes.find(item => (item.source_record?.kind ?? item.kind) === 'summary')
        const summaryBody = summaryNote?.body?.summary ?? summaryNote?.source_record?.body?.summary ?? summaryNote?.source_record?.body
        const summaryText = text(current.summary, text(current.analysis_summary, text(summaryBody, '本次分析结果适用于冻结的源码和输入资料。')))
        const reportTitle = (selectedTask?.title ?? current.target ?? 'PANGEA 分析') + '报告'
        const outline = [
          ['b03-report-scope', '01 分析范围'],
          ['b03-report-findings', '02 主要发现'],
          ['b03-report-validation', '03 测试建议'],
          ['b03-report-limits', '04 复核与限制'],
        ]
        const scrollTo = id => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        const unresolvedItems = (workflow.unresolved ?? []).map((item, index) => ({ id: item?.id ?? item?.code ?? String(index + 1), text: typeof item === 'string' ? item : item?.message ?? item?.title ?? JSON.stringify(item) }))
        const reportRunNumber = text(current.run_id).replace(/^run-/i, '')
        const startedDate = new Date(current.started_at)
        const dateKey = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
        const reportStart = Number.isNaN(startedDate.getTime()) ? '开始时间未记录'
          : `${dateKey(startedDate) === dateKey(new Date()) ? '今天' : dateKey(startedDate)} ${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(startedDate)} 开始`
        const reportScope = [current.repository ?? selectedTask?.repository, current.target ?? selectedTask?.target].filter(Boolean).join(' / ')
        const findingNotes = notes.filter(item => (item.source_record?.kind ?? item.kind) === 'note')
        const findingNoteText = item => {
          const body = item.body ?? item.source_record?.body
          return typeof body === 'string' ? body : text(body?.summary, text(body?.text, text(body?.content, '')))
        }
        const reportFindings = [
          ...risks.map((risk, index) => ({ key: riskKeyByItem.get(risk) ?? index, body: risk.narrative || risk.trigger || risk.residual_effect })),
          ...findingNotes.map((item, index) => ({ key: item.source_record?.record_id ?? item.record_id ?? `note-${index}`, body: findingNoteText(item) })),
        ].filter(item => hasText(item.body))
        const inputCount = current.input_materials?.length ?? 0
        const inputCountLabel = inputCount === 2 ? '两个' : inputCount === 1 ? '一个' : `${inputCount} 个`
        const reportArtifact = current.artifacts?.report_html ?? current.artifacts?.report_md
        const reportArtifactTitle = current.artifacts?.report_html ? 'PANGEA report.html' : 'PANGEA report.md'
        const reportNavigation = [
          ['overview', '概览'],
          ['flows', '业务流程', 'business_flows'],
          ...(riskEnabled ? [['risks', '风险', 'risks']] : []),
          ['cases', current.scenario === 'coverage-analysis' ? '补测用例' : '测试用例', 'test_cases'],
          ['workflow', '运行过程'],
        ]
        return h(React.Fragment, null,
          renderCompatibility(),
          pageHeader({ title: selectedTask?.title || current?.target || '分析报告', task: selectedTask, current, ui: ctx.pangea?.ui, onBack: () => jump(selectedTask ? 'overview' : 'tasks'), actions: h('button', { type: 'button', className: 'b03-report-page-action', disabled: !reportArtifact, onClick: () => reportArtifact && openSidebarFile(reportArtifact, reportArtifactTitle) }, '打开已有报告') }),
          h('nav', { className: 'b03-report-tabs', 'aria-label': 'PANGEA 分析页面' }, reportNavigation.map(([target, label, key]) => h('button', {
            key: target, type: 'button', 'aria-current': target === 'overview' ? 'page' : undefined,
            onClick: () => jump(target),
          }, label, key ? h('small', null, displayCount(key, ({ business_flows: businessFlows, risks, test_cases: testCases })[key]?.length ?? 0)) : null))),
          renderFlowVersions(),
          h('div', { className: 'b03-report-layout' },
            h('article', { className: 'b03-report-document' },
              h('div', { className: 'b03-report-head' },
                h('div', null,
                  h('div', { className: 'pangea-eyebrow', style: { color: '#b62836', letterSpacing: '1.4px', fontSize: 12, fontWeight: 600 } }, 'PANGEA · ANALYSIS REPORT'),
                  h('h2', null, reportTitle),
                  h('p', null, [reportScope, 'RUN ' + reportRunNumber, partial ? '部分交付' : '已完成'].filter(Boolean).join(' · '))),
                h('span', { className: `b03-report-status${partial ? ' partial' : ''}`, role: 'status' }, partial ? '部分交付' : '已保存')),
              partial ? h('div', { className: 'b03-report-partial-notice', role: 'status' },
                h('div', { className: 'b03-report-notice-main' }, runIcon('CircleAlert'),
                  h('div', null,
                    h('strong', null, unresolvedItems.length ? `${unresolvedItems.length} 项修正未完成` : '部分交付'),
                    h('p', null, unresolvedItems.length
                      ? `${unresolvedItems.map(item => item.text).join('；')}；下方结果按当前已保存版本交付。`
                      : '报告保留未解决事项与未完成修正；下方结果按当前已保存版本交付。')))) : null,
              h('div', { className: 'b03-overview-summary b03-report-stats' },
                h('div', null, h('span', null, '业务流程'), h('strong', null, displayCount('business_flows', businessFlows.length))),
                h('div', null, h('span', null, '风险记录'), h('strong', null, riskEnabled ? displayCount('risks', risks.length) : '不适用')),
                h('div', null, h('span', null, '测试用例'), h('strong', null, displayCount('test_cases', testCases.length)))),
              h('div', { className: 'b03-report-divider' }),
              h('section', { id: outline[0][0] }, h('h3', null, '01 / 分析范围'),
                h('p', null, summaryText + `输入为本次冻结的${inputCountLabel}源码文件。`)),
              h('section', { id: outline[1][0] }, h('h3', null, '02 / 主要发现'),
                reportFindings.length ? h('ol', { className: 'b03-report-findings' }, reportFindings.slice(0, 5).map(item => h('li', { key: item.key }, item.body)))
                  : h('p', null, riskEnabled ? collectionEmpty('risks', '本次分析没有形成风险记录。') : '本次未启用风险分析。')),
              h('section', { id: outline[2][0] }, h('h3', null, '03 / 测试建议'),
                h('p', null, testCases.length + ' 条设计用例覆盖主要路径、边界与异常。设计用例不代表已执行，也不代表实测覆盖率已提升。'),
                executionRuns.length ? h('p', null, executionRuns.length + ' 条测试执行记录已回传。') : null),
              h('section', { id: outline[3][0] }, h('h3', null, '04 / 复核与限制'),
                h('p', null, `${partial ? `保留 ${unresolvedItems.length} 项未解决修正${unresolvedItems.length ? `（${unresolvedItems.map(item => item.id).join('、')}）` : ''}，并列出对应证据缺口。` : '本次报告保留质量结论与复核信息。'} 质量结论：${outcomePresentation(current).semantic}。`))),
            h('aside', { className: 'b03-report-nav' },
              h('section', { className: 'b03-overview-card' }, h('h3', null, '报告目录'),
                outline.map(([id, label], index) => h('button', { key: id, type: 'button', className: 'b03-report-outline-link', style: { ...styles.backButton, minHeight: 0, padding: '14px 0', border: 0, borderBottom: index < outline.length - 1 ? '1px solid #e5e7e4' : 0, borderRadius: 0, background: 'transparent', color: '#25292e', fontSize: 14 }, onClick: () => scrollTo(id) }, label))),
              h('section', { className: 'b03-overview-card' }, h('h3', null, '交付文件'),
                h('button', { type: 'button', className: 'b03-task-run', onClick: () => { void exportOfflineReport() } }, '导出离线图文报告（ZIP）'),
                current.artifacts?.report_html ? h('div', { className: 'b03-unlinked-row b03-report-file' }, reportGlyph(), h('div', null, h('strong', { className: 'small' }, 'report.html'), h('div', { className: 'b03-task-subtitle' }, partial ? '当前交付版' : '完整阅读版')), h('button', { type: 'button', className: 'b03-task-open', onClick: () => openSidebarFile(current.artifacts.report_html, 'PANGEA report.html') }, '打开')) : null,
                current.artifacts?.report_md ? h('div', { className: 'b03-unlinked-row b03-report-file' }, reportGlyph(), h('div', null, h('strong', { className: 'small' }, 'report.md'), h('div', { className: 'b03-task-subtitle' }, 'Markdown 原文')), h('button', { type: 'button', className: 'b03-task-open', onClick: () => openSidebarFile(current.artifacts.report_md, 'PANGEA report.md') }, '打开')) : null,
                h('div', { className: 'b03-report-divider' }),
                h('button', { type: 'button', className: 'b03-task-run', onClick: () => jump('cases') }, '查看测试用例与预期验证')),
              h('section', { className: 'b03-report-traceability', role: 'note' }, runIcon('Info'),
                h('div', null, h('h3', null, '可追溯的结果'),
                  h('p', null, '源码依据、任务记录和冻结输入均可从原任务中查看。'))))))
      }
      function renderRisks() {
        const filtered = filterRisks(risks, riskSeverity, riskQuery)
        const counts = riskSeverityCounts(risks)
        const linkedCases = new Set(risks.flatMap(risk => risk.linked_test_case_ids ?? []))
        const groups = new Map()
        for (const risk of filtered) {
          const key = hasText(risk.unit_id) ? risk.unit_id : '__unassigned__'
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key).push(risk)
        }
        const metric = (label, value, note) => h('div', { className: 'b05-metric' }, h('small', null, label), h('strong', null, value), h('span', null, note))
        const isComplete = current?.lifecycle_status === 'complete' || current?.status === 'completed'
        const riskReadError = collectionWarning(health, 'risks')
        const ledger = current?.analysis_scene?.presentation?.check_ledger === true ? h('section', { className: 'b05-card' },
          h('h3', null, '检查账本'), h('p', null, '实际检查对象及作者结论；待确认项和排除理由见完整报告。'),
          h('div', { style: { overflowX: 'auto' } }, h('table', { className: 'pangea-reader-table' },
            h('thead', null, h('tr', null, ['单元', '镜头', '对象', '结论', '位置'].map(label => h('th', { key: label }, label)))),
            h('tbody', null, (details.checks ?? []).map(check => h('tr', { key: check.projection_id },
              [check.unit_id, check.lens, check.object, check.conclusion, (Array.isArray(check.sites) ? check.sites : []).join('、')].map((value, i) => h('td', { key: i }, text(value, '未提供'))))))))) : null
        if (!risks.length && !riskQuery && riskSeverity === '全部') return h(React.Fragment, null,
          ledger,
          h('div', { className: 'b05-section-head' }, h('div', null, h('h2', null, '独立风险记录'), h('p', null, riskReadError ? '当前风险资料读取异常，需要恢复读取后确认结果。' : isComplete ? '当前 Run 已结束，查看本轮实际形成的分析结论。' : '分析进行中，独立风险记录尚未发布。')), h('span', { style: styles.badge }, riskReadError ? '暂不可读取' : '0 条记录')),
          h('div', { className: 'b05-card', style: { textAlign: 'center', padding: '42px 28px 30px' } },
            h('div', { className: 'b04-progress-icon', style: { margin: '0 auto 20px' } }, runIcon('ScanSearch')),
            h('h2', { style: { fontSize: 21 } }, riskReadError ? '风险记录暂不可读取' : isComplete ? '本轮未形成独立风险记录' : '风险记录仍在形成'),
            h('p', { style: { maxWidth: 590, margin: '12px auto 22px', color: '#7c8585' } }, collectionEmpty('risks', isComplete
              ? '这并不代表未检查范围安全。检查范围、排除理由与剩余不确定性，需结合分析单元总结和源码依据理解。'
              : '当前记录尚未发布，不能据此判断没有风险。')),
            h('div', { className: 'b04-canvas-actions b04-empty-actions' },
              h('button', { type: 'button', onClick: () => jump('overview') }, '查看分析总结'),
              h('button', { type: 'button', onClick: () => jump('flows') }, '查看业务流程')),
            h('div', { className: 'b05-metrics', style: { textAlign: 'left', gridTemplateColumns: 'repeat(3,1fr)', margin: '35px 0 0' } },
              metric('本次源码范围', `${current?.source_snapshot?.file_count ?? selectedTask?.source_scope?.length ?? 0} 个文件`, '当前 Run 冻结输入'),
              metric('已分析单元', current?.analysis?.completed ?? 0, '逐项结论见单元总结'),
              metric('业务流程', businessFlows.length, '可继续查看路径与测试目标'))),
          h('div', { className: 'b05-detail-bottom' },
            h('section', { className: 'b05-card' }, h('h3', null, '接下来可以查看'),
              h('button', { type: 'button', className: 'b03-task-action', onClick: () => jump('flows') }, '业务流程与路径'),
              h('button', { type: 'button', className: 'b03-task-action', onClick: () => jump('cases') }, '测试用例')),
            h('section', { className: 'b05-card' }, h('h3', null, '如何阅读这个结果'), h('p', null, '风险记录为空描述的是分析产物，不是整体安全保证。'), h('p', null, '调用方、构建条件和运行环境可能超出当前输入范围。'))))
        return h(React.Fragment, null,
          ledger,
          h('div', { className: 'b05-section-head' }, h('div', null, h('h2', null, '需要关注的实现风险'), h('p', null, '从触发条件到代码依据，再到验证路径。')), h('span', { style: styles.badge }, `${risks.length} 条独立风险记录`)),
          h('div', { className: 'b05-metrics' }, metric('高风险', counts.High, '优先验证触发条件'), metric('中风险', counts.Medium, '核对业务影响'),
            metric('关联测试用例', linkedCases.size, `对应 ${risks.length} 条风险`), metric('有直接源码依据', `${risks.filter(risk => risk.evidence?.length).length} / ${risks.length}`, '位置可追溯')),
          h('div', { className: 'b05-toolbar' },
            h('input', { 'aria-label': '搜索风险', placeholder: '搜索风险、触发条件、源码位置…', value: riskQuery, onChange: event => setRiskQuery(event.target.value) }),
            h('div', { className: 'b05-filters', role: 'group', 'aria-label': '按风险等级筛选' },
              ['全部', ...RISK_SEVERITY_LEVELS, ...(counts.Ungraded ? ['Ungraded'] : [])].map(level => h('button', { key: level, type: 'button', 'aria-pressed': riskSeverity === level, onClick: () => setRiskSeverity(level) },
                level === '全部' ? `全部 ${risks.length}` : level === 'Ungraded' ? `未分级 ${counts.Ungraded}` : `${SEVERITY[level]} ${counts[level]}`)))),
          filtered.length ? [...groups.entries()].map(([unitId, items]) => {
            const unit = unitById.get(unitId)
            const flows = flowsByUnit.get(unitId) ?? []
            return h('section', { key: unitId },
              h('div', { className: 'b05-group-label' }, h('span', null, unit ? `${unit.unit_id} · ${text(unit.title, '未命名单元')}` : '未归入分析单元'),
                h('span', null, flows.length ? `业务流程 · ${flows.map(flow => flow.title || flow.flow_id).join('、')}` : '暂无直接关联流程')),
              items.map(risk => h('button', { key: riskKeyByItem.get(risk), type: 'button', className: 'b05-risk-row', onClick: () => navigate({ type: 'risk', id: riskKeyByItem.get(risk) }) },
                h('div', null, h('h3', null, h('small', { style: { display: 'inline', marginRight: 8 } }, risk.display_id || risk.risk_id || '未编号'), text(risk.title, '未命名风险')),
                  h('p', null, text(risk.trigger, '触发条件尚未记录。')),
                  h('div', { className: 'b05-risk-meta' }, h('span', null, SEVERITY[riskSeverityLevel(risk)] ? `${SEVERITY[riskSeverityLevel(risk)]}风险` : '未分级'),
                    h('span', null, risk.translation_status ? TRANSLATION[risk.translation_status] ?? risk.translation_status : '验证状态未提供'),
                    h('small', null, risk.evidence?.[0]?.location ? displayEvidenceLocation(risk.evidence[0].location) : '源码位置未提供'))),
                h('div', null, h('strong', null, `${risk.linked_test_case_ids?.length ?? 0} 条关联用例`), h('small', null, (risk.linked_test_case_ids ?? []).map(id => caseById.get(id)?.display_id || id).join(' / ') || '暂无')),
                h('div', null, h('strong', null, `${risk.evidence?.length ?? 0} 条源码依据`), h('small', null, risk.evidence?.[0]?.observation || '查看来源位置')),
                h('span', { 'aria-hidden': true }, '↗'))))
          }) : h('div', { className: 'b05-card', role: collectionWarning(health, 'risks') ? 'alert' : 'status' }, collectionEmpty('risks', '没有符合条件的风险。')),
          h('p', { className: 'result-footer-note' }, `分析记录基于本次 ${current?.source_snapshot?.file_count ?? selectedTask?.source_scope?.length ?? 0} 个冻结源码文件。风险处置与结论以完整分析原文为准。`))
      }

      function renderRiskDetail() {
        const risk = riskById.get(screen.id)
        if (!risk) return h('div', { className: 'b05-card', role: 'alert' }, '当前 Run 中找不到这条风险，可能是 Run 已刷新或切换。')
        const semantics = risk.upstream_semantics
        const preview = sourcePreview.key === previewKey ? sourcePreview : { status: 'loading' }
        const snippet = preview.status === 'ready' ? preview.value : null
        const label = risk.display_id || risk.risk_id || '未编号风险'
        const linked = (risk.linked_test_case_ids ?? []).map(id => [id, caseById.get(id)])
        return h(React.Fragment, null,
          h('div', { className: 'b05-section-head' },
            h('div', null,
              h('div', { className: 'b05-risk-meta' }, label, ' · ', SEVERITY[riskSeverityLevel(risk)] ? `${SEVERITY[riskSeverityLevel(risk)]}风险` : '未分级', ' · ',
                risk.translation_status ? TRANSLATION[risk.translation_status] ?? risk.translation_status : '尚无验证结论'),
              h('h2', { className: 'b05-detail-title' }, text(risk.title, '未命名风险')),
              h('p', null, `${risk.unit_id || '未归入单元'} · ${risk.entry || risk.source_record?.record_id || '分析记录'}`)),
            h('div', { style: { fontSize: 12, color: '#7c8585', lineHeight: 1.8 } },
              h('div', null, `等级来源 · ${risk.severity_source === 'sfmea' ? 'SFMEA' : risk.severity_source === 'workbench_projection' ? '工作台投影' : '分析记录'}`),
              h('div', null, `置信度 · ${CONFIDENCE[risk.confidence] ?? risk.confidence ?? '未提供'}`),
              h('button', { type: 'button', className: 'b03-task-action', style: { marginTop: 9 }, onClick: () => { void addToConversation('risk', risk, 'review', snippet || undefined) } }, '与 AI 讨论'))),
          h('div', { className: 'b05-detail-grid' },
            h('section', { className: 'b05-card' }, h('div', { className: 'b05-step-label' }, '01 / CONCLUSION'), h('h3', null, '结论与影响'),
              h('p', null, text(risk.narrative, '风险说明未提供，请核对分析原文。')),
              h('h4', null, '可能影响'), h('p', null, text(risk.impact || risk.residual_effect, '具体影响未提供。')),
              h('h4', null, '预期行为'), h('p', null, text(risk.expectation, '预期行为尚未记录。')),
              hasText(risk.blackbox_proof) ? h('div', null, h('h4', null, '黑盒证明'), h('p', null, risk.blackbox_proof)) : null,
              h('div', { className: 'b05-source-context' }, '当前是待核对的分析风险；实际暴露程度需结合调用方与运行环境确认。')),
            h('section', { className: 'b05-card' }, h('div', { className: 'b05-step-label' }, '02 / TRIGGER'), h('h3', null, '触发条件'),
              h('div', { className: 'b05-source-context' }, text(risk.trigger, '触发条件未提供。')),
              hasText(risk.system_result) ? h('div', { className: 'b05-source-context' }, risk.system_result) : null,
              hasText(risk.external_observation) ? h('div', null, h('h4', null, '外部观测'), h('p', null, risk.external_observation)) : null,
              h('h4', null, '排除条件'), h('p', null, text(risk.exclusion_condition, '尚未给出足以排除该风险的证据。')),
              (risk.linked_flow_ids ?? []).length ? h('button', { type: 'button', className: 'b04-link', onClick: () => jump('flows') }, '查看相关业务路径 ↗') : null),
            h('section', { className: 'b05-card' }, h('div', { className: 'b05-step-label' }, '03 / EVIDENCE'), h('h3', null, '直接源码依据'),
              riskEvidenceOptions.length > 1 ? h('div', { className: 'b05-filters', role: 'group', 'aria-label': '选择风险证据源码' }, riskEvidenceOptions.map((evidenceItem, index) => h('button', {
                key: evidenceIdentity(evidenceItem), type: 'button', 'aria-pressed': evidenceIdentity(evidenceItem) === evidenceIdentity(previewEvidence),
                onClick: () => setRiskEvidenceSelection({ riskKey: riskScreenKey, evidenceKey: evidenceIdentity(evidenceItem) }) }, `证据 ${index + 1}`))) : null,
              h('p', null, previewEvidence?.location ? displayEvidenceLocation(previewEvidence.location) : '当前风险没有可读取的源码位置。'),
              hasText(previewEvidence?.quote) ? h('pre', { className: 'b05-source-code', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, previewEvidence.quote) : null,
              snippet ? h('div', { className: 'b05-source-code', style: { maxHeight: 225 } }, snippet.lines.map(line => h('div', {
                key: line.number, className: 'b05-source-code-line', 'data-target': line.target ? 'true' : undefined }, h('span', null, line.number), h('code', null, line.text || ' ')))) : null,
              preview.status === 'error' ? h('p', { role: 'alert' }, `源码暂不可读：${preview.error}`) : null,
              h('p', null, previewEvidence?.observation || '这里只描述当前冻结源码片段，不推断未读取的调用关系。'),
              previewEvidence?.location ? h('button', { type: 'button', className: 'b04-link', onClick: () => setSourceDrawerOpen(true) }, '查看源码上下文 ↗') : null)),
          h('div', { className: 'b05-detail-bottom' },
            h('section', { className: 'b05-card' }, h('h3', null, `关联测试用例 · ${linked.length}`),
              linked.length ? linked.map(([id, testCase]) => h('button', { key: id, type: 'button', className: 'b03-task-action', style: { display: 'block', width: '100%', textAlign: 'left', marginTop: 10 }, onClick: () => navigate({ type: 'case', id }) },
                `${testCase?.display_id || id} · ${testCase?.title || '测试用例'}`)) : h('p', null, '暂无关联测试用例。')),
            h('section', { className: 'b05-card' }, h('h3', null, '上游语义核对'),
              h('p', null, `入口可达性 · ${semantics?.reachability || '待核对'}`),
              h('p', null, `调用方限制 · ${semantics?.caller_constraints || '未提供'}`),
              h('p', null, `规格/文档行为 · ${semantics?.documented_behavior || '未提供'}`),
              h('p', null, `已有测试 · ${semantics?.existing_tests || '未提供'}`))),
          renderRecordBody(risk, true),
          renderB05SourceDrawer('risk', risk))
      }

      function renderCases() {
        const query = caseQuery.trim().toLowerCase()
        const filtered = filteredCaseRows
        const pages = Math.max(1, Math.ceil(filtered.length / 50)), page = Math.min(casePage, pages)
        const pageItems = filtered.slice((page - 1) * 50, page * 50)
        const designCounts = caseDesignCounts(testCases)
        const behaviorLedgers = current?.details?.behavior_coverage ?? behaviorCoverageProjection(current?.details?.notes ?? current?.notes, testCases)
        const selectableIds = filtered.map(caseIdentity).filter(key => key && testCases.filter(item => caseIdentity(item) === key).length === 1)
        const selectedVisible = selectableIds.filter(id => selectedCaseIds.includes(id))
        const allSelected = selectableIds.length > 0 && selectedVisible.length === selectableIds.length
        const linkedCases = testCases.filter(item => (item.linked_risk_ids?.length ?? 0) > 0).length
        const readiness = current?.case_readiness ?? { ready: testCases.filter(item => item.readiness === 'ready').length, needs_setup: testCases.filter(item => item.readiness === 'needs_setup').length, unclassified: testCases.filter(item => !['ready', 'needs_setup'].includes(item.readiness)).length }
        const quality = current?.case_quality_summary
        const unitCount = new Set(testCases.map(item => item.unit_id).filter(hasText)).size
        const coverageAvailable = current?.scenario === 'coverage-analysis' || current?.coverage_match || current?.coverage_summary?.valid_gaps != null
        const metric = (label, value, note) => h('div', { className: 'b05-metric' }, h('small', null, label), h('strong', null, value), h('span', null, note))
        const readinessLabel = item => item.readiness === 'ready' ? '具备执行条件' : item.readiness === 'needs_setup' ? '待补执行条件' : '执行条件未标注'
        const formatRisk = item => (item.linked_risk_ids ?? []).map(id => riskById.get(id)?.display_id || id)
        return h(React.Fragment, null,
          h('div', { className: 'b05-section-head' }, h('div', null, h('h2', null, '测试用例'), h('p', null, `${designCounts.cases} 条${designCounts.has_legacy_groups ? '用例记录（含旧用例组）' : '独立验证目标'} · ${designCounts.variants} 项已设计参数组合，保留前置条件、操作与预期结果。`)),
            h('div', { className: 'b05-head-actions' }, coverageAvailable ? h('button', { type: 'button', className: 'b03-task-action', onClick: () => navigate({ type: 'coverage-cases' }) }, '覆盖补测视图') : null,
              h('button', { type: 'button', className: 'b03-task-action primary', disabled: !current?.run_id, onClick: () => { setCaseExportFormat('xlsx'); setCaseExportError(''); setCaseExportScope(reviews?.counts?.adopted ? 'adopted' : 'all'); setCaseExportOpen(true) } }, reviews?.counts?.adopted ? `导出已采纳 ${reviews.counts.adopted} 条` : '导出用例'))),
          h('div', { className: 'b05-metrics' },
            metric('全部测试用例', testCases.length, `分布在 ${unitCount} 个分析单元`), metric('具备执行条件', readiness.ready ?? '未知', '条件来自用例分析记录'),
            metric('待补执行条件', readiness.needs_setup ?? '未知', '需核对执行准备条件'), riskEnabled ? metric('关联风险的用例', linkedCases, '按用例去重计数') : metric('已设计参数组合', designCounts.variants, '按变体记录计数，不计入独立用例数')),
          quality ? h('details', { className: 'b05-card', 'aria-label': '黑盒与灰盒可实施性' }, h('summary', null, '黑盒与灰盒可实施性'),
            h('p', null, `业务黑盒 ${quality.business_blackbox} 条（具备执行条件 ${quality.ready_blackbox} 条） · 业务灰盒 ${quality.developer_assisted} 条（具备执行条件 ${quality.ready_graybox} 条）`),
            h('p', null, quality.has_legacy_groups ? '包含旧用例组，独立用例比例待复核。' : quality.ready_ratio == null ? '无可统计用例。' : `可实施黑盒与灰盒：${quality.ready_cases}/${quality.total_cases}（${(quality.ready_ratio * 100).toFixed(1)}%）。`),
            h('p', null, quality.blackbox_target === false ? quality.blackbox_target_reason === 'risk-scene' ? '风险场景不设黑盒比例目标。' : '用户冻结目标为接口契约分析，不设产品黑盒与灰盒70%比例目标。' : '可实施黑盒与灰盒交付目标 ≥70%。'),
            h('p', { className: 'b05-subtle' }, '全部正式、辅助及未分类用例均计入分母。比例按作者声明汇总，具备执行条件不代表实测通过。')) : null,
          behaviorLedgers.length || current?.scenario === 'branch-analysis' ? h(BehaviorCoverageView, { ledgers: behaviorLedgers,
            onCase: link => navigate({ type: 'case', id: link.target_case_id, ...(link.variant_id != null ? { variant_id: link.variant_id } : {}) }) }) : null,
          reviewError ? h('p', { role: 'alert', className: 'pangea-review-error' }, `评审记录：${reviewError}`) : null,
          h('div', { className: 'pangea-case-filters', 'aria-label': '测试用例筛选' },
            ...[
              ['unit', '分析单元', [...new Set(testCases.map(item => item.unit_id).filter(Boolean))].map(id => [id, unitById.get(id)?.title || id])],
              ['type', '用例类型', [...new Set(testCases.map(item => item.case_type || item.test_level || 'unclassified'))].map(value => [value, CASE_TYPE_LABELS[value] || value])],
              ['readiness', '执行条件', [['ready', '具备执行条件'], ['needs_setup', '待补执行条件'], ['unclassified', '执行条件未标注']]],
              ['review', '评审状态', Object.entries(REVIEW_LABELS)],
            ].map(([key, label, options]) => h('label', { key }, label, h('select', { 'aria-label': label, value: caseFilters[key], onChange: event => setCaseFilters(value => ({ ...value, [key]: event.target.value })) }, h('option', { value: '' }, `全部${label}`), options.map(([value, name]) => h('option', { key: value, value }, name))))),
            h('button', { type: 'button', onClick: () => { setCaseQuery(''); setCaseFilters({ unit: '', type: '', readiness: '', review: '' }) } }, '清除筛选')),
          h('div', { className: 'b05-toolbar' }, h('input', { value: caseQuery, 'aria-label': '搜索测试用例', placeholder: '搜索用例、业务路径、参数输入或预期…', onChange: event => setCaseQuery(event.target.value) }),
            h('span', { className: 'b05-subtle' }, `显示 ${filtered.length} 条 · 按分析单元排序`)),
          h('div', { className: 'b05-table-scroll', 'data-scroll-key': 'test-case-table' }, h('table', { className: 'b05-case-table' },
            h('thead', null, h('tr', null,
              h('th', null, h('input', { type: 'checkbox', 'aria-label': '选择当前列表', checked: allSelected, disabled: selectableIds.length === 0, onChange: () => setSelectedCaseIds(previous => allSelected ? previous.filter(id => !selectableIds.includes(id)) : [...new Set([...previous, ...selectableIds])]) })),
              ...['编号', '验证目标', '类型', '关联风险', '执行条件', ''].map(label => h('th', { key: label }, label)))),
            h('tbody', null, pageItems.map((item, index) => { const key = caseKeyByItem.get(item); const selectable = Boolean(caseIdentity(item)) && testCases.filter(other => caseIdentity(other) === caseIdentity(item)).length === 1; const linked = formatRisk(item); return h('tr', { key: `${key}:${index}` },
              h('td', null, h('input', { type: 'checkbox', checked: selectable && selectedCaseIds.includes(caseIdentity(item)), disabled: !selectable, 'aria-label': selectable ? `选择 ${item.display_id || item.test_case_id}` : '用例尚未编号，不能选择', onChange: () => toggleCase(caseIdentity(item)) })),
              h('td', { className: 'b05-mono' }, item.display_id || item.test_case_id || '待编号'),
              h('td', null, h('button', { type: 'button', className: 'b05-text-link', onClick: () => openCaseDetail(key) }, text(item.title, '未命名用例')),
                h('small', null, text(item.verification_goal, '验证目标未记录')),
                item.variants?.length ? h('details', { className: 'b05-variant-preview', 'data-view-key': `case-variants:${key}` }, h('summary', null, `${item.variants.length} 项参数组合`),
                  item.variants.map((variant, index) => h('p', { key: index }, `${variant.variant_id ? `${variant.variant_id} · ` : ''}${variant.input || '输入未提供'} → ${variant.expected || '预期未提供'}`))) : null),
              h('td', null, CASE_TYPE_LABELS[item.case_type] || text(item.case_type, '未标注')),
              h('td', null, linked.length ? linked.map(id => h('span', { key: id, className: 'b05-risk-chip' }, id)) : '—'),
              h('td', null, h('span', { className: `b05-readiness ${item.readiness === 'ready' ? 'good' : 'warn'}` }, readinessLabel(item))),
              h('td', null, h('button', { type: 'button', className: 'b05-text-link', onClick: () => openCaseDetail(key) }, '查看 ›')))
            })))),
          filtered.length === 0 ? h('div', { className: 'b05-card', role: collectionWarning(health, 'test_cases') ? 'alert' : 'status' }, collectionEmpty('test_cases', '没有符合条件的测试用例。')) : null,
          h('div', { className: 'pangea-case-paging' }, h('button', { type: 'button', disabled: page <= 1, onClick: () => setCasePage(page - 1) }, '上一页'), h('span', null, `第 ${page} / ${pages} 页 · 共 ${filtered.length} 条`), h('button', { type: 'button', disabled: page >= pages, onClick: () => setCasePage(page + 1) }, '下一页')),
          selectedCaseIds.length ? h('div', { className: 'b05-selected-bar' }, h('div', null, `已选择 ${selectedCaseIds.length} 条用例`, h('small', null, `含 ${selectedCaseIds.filter(id => !selectableIds.includes(id)).length} 条筛选外选择；可复制或导出` )),
            h('div', { className: 'b05-head-actions' }, h('button', { type: 'button', onClick: () => setSelectedCaseIds([]) }, '清空选择'),
              h('button', { type: 'button', disabled: selectedCaseIds.length === 0, onClick: () => { void copySelectedCases() } }, '复制选中用例'), h('button', { type: 'button', onClick: () => { setCaseExportScope(reviews?.counts?.adopted ? 'adopted' : 'all'); setCaseExportOpen(true); setCaseExportScope('selected') } }, '导出所选')) ) : null,
          h('p', { className: 'b05-subtle' }, '执行条件反映用例准备情况；实际验证结果需由测试执行记录确认。'),
          renderCaseExportDialog())
      }

      function renderCaseExportDialog() {
        if (!caseExportOpen) return null
        const close = () => { if (!caseExportBusy) setCaseExportOpen(false) }
        const counts = { all: testCases.length, filtered: filteredCaseRows.length, selected: selectedCaseIds.length, adopted: reviews?.counts?.adopted ?? 0 }
        return h('div', { className: 'b05-modal-backdrop', onClick: event => { if (event.target === event.currentTarget) close() } },
          h('section', { role: 'dialog', 'aria-modal': 'true', 'aria-label': '导出测试用例', className: 'b05-export-modal', onKeyDown: event => { if (event.key === 'Escape') close(); if (event.key === 'Tab') { const controls = [...event.currentTarget.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')]; if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() } else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() } } } },
            h('header', null, h('h2', null, '导出测试用例'), h('button', { type: 'button', onClick: close, autoFocus: true, 'aria-label': '关闭导出窗口' }, '关闭')),
            h('fieldset', null, h('legend', null, '导出范围'), [['all', '全部用例'], ['filtered', '当前筛选结果'], ['selected', '已勾选'], ['adopted', '已采纳']].map(([value, label]) => h('label', { key: value, className: 'pangea-export-scope-option' }, h('input', { type: 'radio', name: 'case-export-scope', value, checked: caseExportScope === value, disabled: caseExportBusy || value !== 'all' && !reviews, onChange: () => setCaseExportScope(value) }), `${label} · ${counts[value]} 条`))),
            h('label', null, '文件格式', h('select', { 'aria-label': '文件格式', value: caseExportFormat, onChange: event => setCaseExportFormat(event.target.value) }, h('option', { value: 'xlsx' }, 'Excel 工作簿及执行依据'), h('option', { value: 'csv-bundle' }, 'CSV及执行依据（ZIP）'))),
            h('p', { className: 'b05-subtle' }, '八列：用例ID、标题、类型、前置条件、操作步骤、预期结果、观察点、清理动作（环境恢复）。'),
            caseExportError ? h('p', { role: 'alert' }, caseExportError) : null,
            h('footer', null, h('button', { type: 'button', disabled: caseExportBusy, onClick: close }, '取消'), h('button', { type: 'button', className: 'primary', disabled: caseExportBusy || !counts[caseExportScope] || caseExportScope !== 'all' && !reviews, onClick: async () => { setCaseExportBusy(true); setCaseExportError(''); const success = await exportCurrentCases(caseExportFormat); setCaseExportBusy(false); if (success) close() } }, caseExportBusy ? '正在导出…' : `导出 ${counts[caseExportScope]} 条`))))
      }

      function renderCoverageCases() {
        const summary = current?.coverage_summary
        const match = current?.coverage_match
        const gaps = Array.isArray(details.coverage_gaps) ? details.coverage_gaps : []
        const value = number => number == null ? '未知' : number
        const metric = (label, number, note) => h('div', { className: 'b05-metric' }, h('small', null, label), h('strong', null, value(number)), h('span', null, note))
        const caseLinks = ids => ids.map(id => { const item = caseById.get(id); return h('button', { key: id, type: 'button', className: 'b05-text-link', onClick: () => navigate({ type: 'case', id }) }, `${item?.display_id || id} · ${item?.title || '查看用例'} · ${{ coverage: '新增补测', branch: '复用分支用例', risk: '复用风险用例' }[item?.purpose] || '关联用例'}`) })
        return h(React.Fragment, null,
          h('div', { className: 'b05-section-head' }, h('div', null, h('h2', null, '关联覆盖缺口的测试用例'), h('p', null, '核对缺口来源、源码匹配与测试目标之间的关系。')),
            h('span', { className: 'b05-readiness' }, '覆盖补测场景')),
          h('div', { className: 'b05-coverage-notice' }, h('strong', null, '源码位置匹配，不等于已完成实测覆盖'),
            h('p', null, '匹配仅表示输入与源码位置对应；用例关联、覆盖结果和数据版本适用性需要分别核实。')),
          h('div', { className: 'b05-metrics' }, metric('有效缺口', summary?.valid_gaps, '已定位到本次源码'),
            metric('关联有效缺口的用例', summary?.linked_cases, '按用例计数，含复用用例'), metric('其中新增补测用例', summary?.linked_coverage_cases, '关联用例中的新增补测'),
            metric('已关联有效缺口', summary?.linked_valid_gaps, '按缺口去重计数')),
          h('div', { className: 'b05-coverage-grid' },
            h('section', { className: 'b05-card' }, h('div', { className: 'b05-section-head' }, h('h3', null, '测试目标与缺口来源'), h('span', { className: 'b05-subtle' }, `${value(summary?.linked_cases)} 条关联用例`)),
              gaps.length ? gaps.map(gap => { const id = gap.coverage_id || gap.gap_id; const linked = testCases.filter(item => (Array.isArray(item.coverage_refs) ? item.coverage_refs : [item.coverage_refs]).some(ref => (typeof ref === 'string' ? ref : ref?.coverage_id) === id)); const matched = (match?.matched_preview ?? []).some(row => row.coverage_id === id); return h('div', { key: id, className: 'b05-gap-row' },
                h('div', null, h('strong', null, id), h('small', null, matched ? '已匹配' : gap.file_path ? '源码已定位' : '匹配待核实')),
                h('div', null, h('strong', null, gap.title || gap.description || gap.kind || '覆盖缺口'), h('small', null, gap.file_path ? `${gap.file_path}${gap.line ? ` · L${gap.line}` : ''}` : text(gap.location, '源码位置未记录'))),
                h('div', null, linked.length ? caseLinks(linked.map(item => item.test_case_id).filter(hasText)) : h('span', { className: 'b05-subtle' }, '暂无关联用例')),
                h('span', { className: 'b05-subtle' }, linked.length ? linked.every(item => item.readiness === 'ready') ? '具备条件' : '待核对执行条件' : '待关联')) }) : h('p', { className: 'b05-subtle' }, summary?.valid_gaps == null ? '有效缺口输入不可读取，不能推定为零。' : '当前无有效缺口记录。'),
              (match?.unmatched_preview ?? []).map((row, index) => h('div', { key: index, className: 'b05-gap-row' },
                h('div', null, h('strong', null, row.coverage_id || row.ref_id || `引用 ${index + 1}`), h('small', null, '未匹配')),
                h('div', null, h('strong', null, row.title || row.description || row.file_path || '覆盖输入引用'), h('small', null, row.reason || row.location || '不在当前源码匹配范围内')),
                h('span', { className: 'b05-subtle' }, '尚未形成有效关联'))),
              h('p', { className: 'b05-subtle' }, `全部新增补测用例：${value(summary?.coverage_cases)}；待核实引用：${value(summary?.unverified_refs)}。当前共 ${testCases.length} 条用例，未匹配引用不计入有效缺口。`)),
            h('section', { className: 'b05-card' }, h('h3', null, '覆盖数据与匹配诊断'),
              (match?.sources ?? []).map((source, index) => h('div', { key: index, className: 'b05-coverage-source' }, h('strong', null, source.name || source.path || source.file_path || `输入来源 ${index + 1}`))),
              h('dl', { className: 'b05-case-kv' },
                h('dt', null, '源码已匹配'), h('dd', null, value(match?.matched)),
                h('dt', null, '未匹配'), h('dd', null, value(match?.unmatched)),
                h('dt', null, '匹配歧义'), h('dd', null, value(match?.ambiguous)),
                h('dt', null, '数据版本'), h('dd', null, '需与本次源码版本核对'),
                h('dt', null, '完整诊断'), h('dd', null, match?.diagnostic_path ? h('button', { type: 'button', className: 'b05-text-link', onClick: () => openSidebarFile(match.diagnostic_path) }, '打开匹配诊断记录 ↗') : '当前 Run 未提供诊断文件')),
              match?.note ? h('p', { className: 'b05-coverage-notice' }, match.note) : null,
              match?.ambiguous_preview?.length ? h('div', { className: 'b05-coverage-notice' }, h('strong', null, `歧义记录 ${match.ambiguous_preview.length} 条`),
                match.ambiguous_preview.map((row, index) => h('p', { key: index }, row.reason || row.location || JSON.stringify(row)))) : null)),
          renderCaseExportDialog())
      }

      function renderExecutionResults() {
        const executorRuns = snapshot?.executor_runs ?? []
        const completedRuns = executorRuns.filter(run => ['PASS', 'passed', 'complete', 'completed', 'success'].includes(run.result_status ?? run.phase)).length
        const unresolvedRuns = executorRuns.filter(run => (run.unresolved?.length ?? 0) > 0 || ['FAILED', 'failed', 'error', 'UNRESOLVED'].includes(run.result_status ?? run.phase)).length
        return h(React.Fragment, null,
          h('div', { style: styles.decisionHero },
            h('div', { style: styles.eyebrow }, '执行结果'),
            h('div', { style: styles.decisionTitle }, executorRuns.length ? `${executorRuns.length} 次执行留有记录` : '还没有执行测试计划'),
            h('div', { style: styles.decisionHint }, '这里关联测试计划、实验环境和实际结果；环境配置是执行条件，不是产品主结果。'),
            h('div', { style: styles.decisionBand },
              h('div', { style: styles.decisionItem }, h('div', { style: styles.label }, '执行记录'), h('div', { style: styles.decisionValue }, executorRuns.length)),
              h('div', { style: styles.decisionItem }, h('div', { style: styles.label }, '完成'), h('div', { style: styles.decisionValue }, completedRuns)),
              h('div', { style: styles.decisionItem }, h('div', { style: styles.label }, '需处理'), h('div', { style: styles.decisionValue }, unresolvedRuns)))),
          h('div', { style: styles.card },
            h('div', { style: styles.itemTitle }, `测试执行记录（${executorRuns.length}）`),
            executorRuns.length ? h('div', { style: { marginTop: 8 } }, executorRuns.map(run => {
              const environmentName = run.environment_name ?? environments.find(item => item.id === run.environment_id)?.name ?? '执行环境已删除'
              return h('div', { key: run.executor_run_id, style: { ...styles.card, marginBottom: 7 } },
                h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, run.executor_run_id), h('span', { style: styles.badge }, run.result_status ?? run.phase)),
                h('div', { style: styles.itemMeta }, `${run.selected_test_case_ids.length} 条用例 · ${environmentName}`),
                run.unresolved?.length ? h('div', { style: { ...styles.error, marginTop: 6 } }, run.unresolved.join('；')) : null,
                h('div', { style: styles.chips }, run.artifacts?.plan ? chip('查看执行计划', () => openSidebarFile(run.artifacts.plan, 'PANGEA executable plan')) : null, run.artifacts?.result ? chip('查看执行结果', () => openSidebarFile(run.artifacts.result, 'PANGEA execution result')) : null))
            })) : h('div', { style: { ...styles.empty, marginTop: 8 } }, '当前分析还没有执行记录。')))
      }

      function renderEnvironmentPage() {
        const updateField = fieldName => event => setEnvironmentForm(value => ({ ...value, [fieldName]: event.target.value }))
        const environmentField = (label, fieldName, options = {}) => h('label', { style: { ...styles.environmentField, ...(options.wide ? styles.environmentFieldWide : {}) } },
          h('span', { style: styles.environmentLabel }, label),
          h('input', {
            type: options.type ?? 'text', value: environmentForm[fieldName], placeholder: options.placeholder,
            style: styles.environmentInput, onChange: updateField(fieldName), autoComplete: 'off',
          }))
        const connectionIcon = kind => h('span', { style: styles.environmentConnectionIcon }, kind === 'host'
          ? h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 }, h('rect', { x: 4, y: 3, width: 16, height: 18, rx: 2 }), h('path', { d: 'M8 8h8M8 12h8M8 16h4' }))
          : h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 }, h('path', { d: 'M4 6h16v5H4zM4 13h16v5H4z' }), h('circle', { cx: 17, cy: 8.5, r: .7 }), h('circle', { cx: 17, cy: 15.5, r: .7 })))
        const testLabel = kind => {
          const value = environmentTests[kind]
          if (value.state === 'testing') return '正在检查连接…'
          if (value.state === 'ok') return '连接成功'
          if (value.state === 'error') return value.message || '连接失败'
          return '尚未检查连接'
        }
        const connectionCard = (kind, title, ipLabel) => {
          const prefix = kind === 'host' ? 'host' : 'array'
          const test = environmentTests[kind]
          return h('div', { style: styles.environmentConnectionCard },
            h('div', { style: styles.environmentConnectionTitle }, connectionIcon(kind), title),
            h('div', { style: styles.environmentFieldGrid },
              environmentField(ipLabel, `${prefix}_ip`, { wide: true, placeholder: kind === 'host' ? '例如 192.168.10.21' : '例如 192.168.10.80' }),
              environmentField('用户名', `${prefix}_username`, { placeholder: kind === 'host' ? 'root' : 'admin' }),
              environmentField('密码', `${prefix}_password`, { type: 'password', placeholder: '输入登录密码' }),
              environmentForm.advanced ? environmentField('SSH 端口', `${prefix}_port`, { wide: true, placeholder: '22' }) : null),
            h('div', { style: styles.environmentConnectionFoot },
              h('span', { style: { ...styles.environmentTestState, color: test.state === 'ok' ? '#25884b' : test.state === 'error' ? '#c7000b' : '#7a818c' } }, testLabel(kind)),
              h('button', { type: 'button', disabled: test.state === 'testing', style: styles.environmentSecondaryButton, onClick: () => { void testEnvironment(kind) } }, test.state === 'testing' ? '检查中…' : '测试连接')))
        }
        return h('div', { style: styles.environmentContent },
          h('section', { style: styles.environmentSection },
            h('div', { style: styles.environmentSectionHead }, h('div', { style: styles.environmentSectionTitle }, '基本信息'), h('div', { style: styles.environmentSectionHint }, '用于在测试任务中识别环境')),
            h('div', { style: styles.environmentSectionBody }, environmentField('环境名称', 'name', { placeholder: '例如：昆仑实验室 · NVMe-oF 联调环境' }))),
          h('section', { style: styles.environmentSection },
            h('div', { style: styles.environmentSectionHead }, h('div', { style: styles.environmentSectionTitle }, '连接信息'), h('div', { style: styles.environmentSectionHint }, '主机或阵列至少配置一个')),
            h('div', { style: styles.environmentSectionBody },
              h('div', { style: styles.environmentConnections }, connectionCard('host', '测试主机', '主机 IP'), connectionCard('array', '存储阵列', '阵列管理 IP')),
              h('label', { style: { ...styles.environmentAdvanced, display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 } },
                h('input', { type: 'checkbox', checked: environmentForm.advanced, onChange: event => setEnvironmentForm(value => ({ ...value, advanced: event.target.checked })) }),
                '高级设置：自定义 SSH 端口（默认 22）'))),
          h('div', { style: styles.environmentActions },
            h('button', { type: 'button', style: styles.environmentSecondaryButton, onClick: () => { setEnvironmentForm(emptyEnvironmentForm()); setEnvironmentTests({ host: { state: 'idle' }, array: { state: 'idle' } }) } }, '取消'),
            h('button', { type: 'button', style: styles.environmentPrimaryButton, onClick: () => { void submitEnvironment() } }, environmentForm.id ? '保存修改' : '保存环境')),
          environments.length ? h('section', { style: { ...styles.environmentSection, marginTop: 24 } },
            h('div', { style: styles.environmentSectionHead }, h('div', { style: styles.environmentSectionTitle }, '已配置环境'), h('div', { style: styles.environmentSectionHint }, `${environments.length} 个`)),
            h('div', { style: { ...styles.environmentSectionBody, ...styles.environmentList } }, environments.map(environment => h('div', { key: environment.id, style: styles.environmentListItem },
              h('div', null,
                h('div', { style: styles.itemTitle }, environment.name),
                h('div', { style: styles.itemMeta }, [environment.host?.ip ? `主机 ${environment.host.ip}` : '', environment.array?.ip ? `阵列 ${environment.array.ip}` : ''].filter(Boolean).join(' · ') || '旧环境配置，编辑后补充连接信息')),
              h('div', { style: { display: 'flex', gap: 8 } },
                h('button', { type: 'button', style: styles.environmentSecondaryButton, onClick: () => editEnvironment(environment) }, '编辑'),
                h('button', { type: 'button', style: { ...styles.environmentSecondaryButton, color: '#c7000b' }, onClick: () => { void deleteEnvironment(environment.id) } }, '删除')))))) : null)
      }

      function renderCaseDetail() {
        const item = caseById.get(screen.id)
        if (!item) return h('div', { className: 'b05-card', role: 'alert' }, '当前 Run 中找不到这条测试用例，可能是 Run 已刷新或切换。')
        const readiness = item.readiness === 'ready' ? '具备执行条件' : item.readiness === 'needs_setup' ? '待补执行条件' : '执行条件未标注'
        const pairs = Array.isArray(item.step_pairs) && item.step_pairs.length ? item.step_pairs
          : (Array.isArray(item.steps) ? item.steps : []).map((action, index) => ({ action, expected: item.expected_results?.[index] }))
        const unit = unitById.get(item.unit_id)
        const flowIds = idList(item.linked_flow_ids)
        const linkedRisks = idList(item.linked_risk_ids)
        const behaviorItems = behaviorCoverageForCase(current?.details?.behavior_coverage ?? behaviorCoverageProjection(current?.details?.notes ?? current?.notes, testCases), item)
        const values = (values, empty) => Array.isArray(values) && values.length ? values.map((value, index) => h('div', { key: index, className: 'b05-bullet' }, '✓', h('span', null, text(value, empty)))) : h('p', { className: 'b05-subtle' }, empty)
        const copyCase = () => { void copySingleCase(item) }
        const order = (caseReviewOrder.length ? caseReviewOrder : filteredCaseRows.map(value => caseKeyByItem.get(value))).filter(key => caseById.has(key))
        const position = order.indexOf(screen.id), savedReview = reviewByKey[caseIdentity(item)]
        const controls = h('div', { className: 'pangea-case-review-actions' },
          h('button', { type: 'button', disabled: position <= 0, onClick: () => selectReviewCase(order[position - 1]) }, '上一条'),
          h('span', null, position < 0 ? '当前用例已不在筛选范围' : `${position + 1} / ${order.length}`),
          h('button', { type: 'button', disabled: position < 0 || position >= order.length - 1, onClick: () => selectReviewCase(order[position + 1]) }, '下一条'),
          h('span', { className: 'pangea-status' }, REVIEW_LABELS[savedReview?.review_status ?? 'unreviewed']),
          h('button', { type: 'button', disabled: reviewSaving || !savedReview, onClick: () => { void saveReview(item, 'excluded') } }, '暂不采纳'),
          h('button', { type: 'button', disabled: reviewSaving || !savedReview, onClick: () => { void saveReview(item, 'adopted') } }, reviewSaving ? '保存中…' : '采纳此用例'),
          savedReview?.decision ? h('button', { type: 'button', disabled: reviewSaving, onClick: () => { void saveReview(item, 'unreviewed') } }, '撤销决定') : null)
        const detailContent = h(React.Fragment, null, controls,
          reviewError ? h('p', { role: 'alert' }, reviewError) : null,
          reviews && !savedReview ? h('p', { role: 'status' }, '该用例缺少唯一身份，可阅读或随全部导出，暂不能保存评审。') : null,
          !filteredCaseRows.includes(item) ? h('p', { role: 'status' }, '当前用例已不符合筛选条件，仍保留本次阅读；上一条与下一条沿用进入详情时的顺序。') : null,

          h('div', { className: 'b05-section-head' }, h('div', null,
            h('div', { className: 'b05-detail-label' }, item.display_id || item.test_case_id || '待编号', ' · ', CASE_TYPE_LABELS[item.case_type] || text(item.case_type, '类型未标注'), ' · ', hasText(item.priority) ? `优先级 ${item.priority}` : '优先级未标注', ' · ', readiness),
            h('h2', { className: 'b05-detail-title' }, text(item.title, '未命名用例')),
            h('p', null, `独立验证目标：${text(item.verification_goal, '当前记录未单独声明，请核对用例原文。')}`)),
            h('div', { className: 'b05-head-actions' }, h('button', { type: 'button', onClick: copyCase }, '复制用例'),
              h('button', { type: 'button', onClick: () => addToConversation('case', item, 'executable') }, '与 AI 讨论'))),
          h('div', { className: 'b05-case-layout' },
            h('main', null,
              h('div', { className: 'b05-case-notice', role: 'status' }, h('strong', null, readiness),
                h('p', null, sourceFirstRecordBody(item.readiness_reason) || (item.missing_execution_conditions ?? []).join('；') || '当前记录未提供执行条件依据。')),
              h('section', { className: 'b05-card' }, h('h3', null, '前置条件'), values(item.preconditions, '原文未记录前置条件。')),
              h('section', { className: 'b05-card' }, h('h3', null, '操作步骤与逐步预期'), pairs.length
                ? h('div', { className: 'b05-table-scroll' }, h('table', { className: 'b05-case-table b05-step-table' },
                  h('thead', null, h('tr', null, ['序号', '操作步骤', '预期结果'].map(label => h('th', { key: label }, label)))),
                  h('tbody', null, pairs.map((step, index) => h('tr', { key: index }, h('td', { className: 'b05-mono' }, String(index + 1).padStart(2, '0')),
                    h('td', null, text(step.action, '未提供操作')), h('td', null, text(step.expected, '未提供逐步预期，请核对整体预期及原文')))))))
                : h('p', null, '原文未提供可识别的操作步骤，请核对分析原文。'),
                item.expected_results?.length ? h('p', { className: 'b05-subtle' }, `整体预期：${item.expected_results.join('；')}`) : null),
              h('section', { className: 'b05-card' }, h('h3', null, '清理动作'), values(item.cleanup, '未记录清理动作。')),
              item.entry ? h('section', { className: 'b05-card' }, h('h3', null, '测试入口'), h('p', null, sourceFirstRecordBody(item.entry))) : null,
              item.unit_notes?.length ? h('section', { className: 'b05-card' }, h('h3', null, '本分析单元说明'), item.unit_notes.map(note => h('details', { key: note.projection_id }, h('summary', null, note.title), h('p', null, sourceFirstRecordBody(note.source_record?.body))))) : null,
              item.variants?.length ? h('section', { className: 'b05-card' }, h('h3', null, `参数变体 · ${item.variants.length} 项`),
                h('p', { className: 'b05-subtle' }, '以下为已设计参数组合，不单独计为独立用例，也不代表各组合已实测通过。'),
                item.variants.map((variant, index) => h('p', { key: index, 'data-variant-id': variant.variant_id,
                  'aria-current': screen.variant_id != null && screen.variant_id === variant.variant_id ? 'true' : undefined,
                  style: screen.variant_id != null && screen.variant_id === variant.variant_id ? { borderLeft: '3px solid #3157d5', paddingLeft: 10, background: '#eef3ff' } : undefined },
                  `${variant.variant_id ? `${variant.variant_id} · ` : ''}${variant.input || '输入未提供'} → ${variant.expected || '预期未提供'}`))) : null,
              behaviorItems.length ? h('section', { className: 'b05-card' }, h('h3', null, '关联业务行为'), behaviorItems.map((behavior, index) => h('p', { key: index }, `${behavior.item_id || '未编号'} · ${behavior.operation || '未提供业务操作'} · ${BEHAVIOR_STATUS_LABELS[behavior.status] || '未标注'}`))) : null),
            h('aside', null,
              h('section', { className: 'b05-card' }, h('h3', null, '关联上下文'), h('dl', { className: 'b05-case-kv' },
                h('dt', null, '分析单元'), h('dd', null, unit ? `${unit.unit_id} · ${unit.title || '未命名'}` : text(item.unit_id, '未记录')),
                h('dt', null, '业务路径'), h('dd', null, flowIds.length ? linkedItems({ linked_flow_ids: flowIds }) : '未关联'),
                h('dt', null, '关联风险'), h('dd', null, linkedRisks.length ? linkedRisks.map(id => h('button', { key: id, type: 'button', className: 'b05-text-link', onClick: () => navigate({ type: 'risk', id }) }, `${riskById.get(id)?.display_id || id} · ${riskById.get(id)?.title || '风险记录'}`)) : '未关联'),
                h('dt', null, '源码位置'), h('dd', null, previewEvidence?.location ? h('button', { type: 'button', className: 'b05-text-link', onClick: () => setSourceDrawerOpen(true) }, displayEvidenceLocation(previewEvidence.location)) : '当前记录未提供源码引用'))),
              h('section', { className: 'b05-card' }, h('h3', null, '观察点'), values(item.observability, '未记录观察点。'),
                h('p', { className: 'b05-subtle' }, '本页是测试用例说明，尚未产生实测通过或失败结论。')),
              h('section', { className: 'b05-card' }, h('h3', null, '分析原文'), h('p', null, '参数、步骤与结论均保留原文追溯入口。'),
                h('button', { type: 'button', className: 'b05-text-link', onClick: () => jump('report') }, '查看完整用例记录 ↗')))),
          item.source_record ? h('details', { className: 'b05-raw-record' }, h('summary', null, '查看本轮原始用例记录'), renderRecordBody(item, true)) : null,
          renderB05SourceDrawer('case', item))
        return h('div', { className: 'pangea-case-review-shell' }, h('aside', { className: 'pangea-case-review-list', 'aria-label': '当前筛选用例' }, h('h3', null, `当前筛选 · ${order.length} 条`), order.slice(Math.max(0, Math.floor(Math.max(position, 0) / 50) * 50), Math.max(0, Math.floor(Math.max(position, 0) / 50) * 50) + 50).map(key => h('button', { key, type: 'button', 'aria-current': key === screen.id ? 'true' : undefined, onClick: () => selectReviewCase(key) }, caseById.get(key)?.display_id || key, h('span', null, caseById.get(key)?.title)))), h('div', { className: 'pangea-case-review-detail' }, detailContent))
      }

      async function copySingleCase(item) {
        const pairs = Array.isArray(item.step_pairs) && item.step_pairs.length ? item.step_pairs.map((step, index) => `${index + 1}. ${step.action || '未提供操作'} → ${step.expected || '未提供逐步预期'}`) : (Array.isArray(item.steps) ? item.steps : []).map((step, index) => `${index + 1}. ${step}`)
        const content = [`${item.display_id || item.test_case_id || '待编号'} · ${text(item.title, '未命名用例')}`, `验证目标：${text(item.verification_goal, '未记录')}`, `前置条件：${(item.preconditions ?? []).join('；') || '未记录'}`, ...pairs, `整体预期：${(item.expected_results ?? []).join('；') || '未记录'}`, `观察点：${(item.observability ?? []).join('；') || '未记录'}`, `清理：${(item.cleanup ?? []).join('；') || '未记录'}`, ...caseVariantLines(item)].join('\n')
        try { await globalThis.navigator.clipboard.writeText(content); showActionNotice('已复制完整测试用例。') }
        catch (reason) { showActionNotice(`复制失败：${reason instanceof Error ? reason.message : String(reason)}`, true) }
      }

      function renderEvidence() {
        const query = evidenceQuery.trim().toLowerCase()
        const filtered = evidence.filter(item => !query || [item.display_id, item.chunk_id, item.location, item.observation, ...(item.risk_ids ?? []).flatMap(id => [id, riskById.get(id)?.display_id])].join(' ').toLowerCase().includes(query))
        return h(React.Fragment, null,
          h('input', { style: styles.search, value: evidenceQuery, 'aria-label': '搜索证据', placeholder: riskEnabled ? '搜索文件位置、观察结论、关联风险…' : '搜索文件位置、观察结论…', onChange: event => setEvidenceQuery(event.target.value) }),
          renderResultCount(filtered.length, evidence.length, evidenceQuery, () => setEvidenceQuery('')),
          h('div', { style: { marginTop: 7 } }, filtered.length ? filtered.map((item, index) => { const key = [item.chunk_id, item.location, item.observation].join('\u0000'); return h('button', { key: `${key}:${index}`, type: 'button', style: { ...styles.card, ...styles.clickableCard }, onClick: () => navigate({ type: 'evidence-detail', key }) }, h('div', { style: styles.itemTitle }, text(item.location, '未标注位置')), h('div', { style: styles.itemMeta }, text(item.observation, '无观察结论')), item.risk_ids?.length ? h('div', { style: styles.chips }, item.risk_ids.slice(0, 4).map(id => h('span', { key: id, style: styles.badge }, riskById.get(id)?.display_id ?? id))) : null) }) : h('div', { style: styles.card }, h('div', { style: styles.empty }, '没有符合条件的证据。'))))
      }

      function renderEvidenceDetail() {
        const item = evidenceByKey.get(screen.key)
        if (!item) return h('div', { style: styles.card }, h('div', { style: styles.empty }, '当前 Run 中找不到这条证据，可能是 Run 已刷新或切换。'))
        return h(React.Fragment, null,
          h('div', { style: styles.card }, field('源码/资料位置', text(item.location, '未标注')), h('div', { style: { marginTop: 9 } }, field('Chunk ID', text(item.chunk_id, '未标注')))),
          renderRecordBody(item),
          renderDiscussionCard('evidence', item, sourcePreview.key === previewKey && sourcePreview.status === 'ready' ? sourcePreview.value : undefined),
          renderSourcePreview('evidence', item, item),
          section('观察结论', item.observation),
          riskEnabled && h('div', { style: styles.card }, h('div', { style: styles.itemTitle }, `关联风险（${item.risk_ids?.length ?? 0}）`), item.risk_ids?.length ? h('div', { style: styles.chips }, item.risk_ids.map(id => chip(riskById.get(id)?.display_id ?? id, () => navigate({ type: 'risk', id })))) : h('div', { style: { ...styles.empty, marginTop: 6 } }, '这条证据没有直接绑定风险。')))
      }

      function renderReview() {
        if (current?.workflow_version === 'source-first-v1') return renderSourceFirstRecords((current.source_first_records ?? []).filter(item => ['independent_review', 'comparison_review'].includes(item.stage)))
        const review = current?.review
        if (review == null) return h('div', { style: styles.card }, h('div', { style: styles.empty }, '当前 Run 还没有复核结果。'))
        return h(React.Fragment, null,
          h('div', { style: styles.card }, h('div', { style: styles.itemTitle }, '复核结论'),
            renderReviewPresentation(h, review, { renderText: renderReadableBody })),
          details.review_issues != null ? h('div', { style: styles.card }, h('div', { style: styles.itemTitle }, '有效复核问题'),
            renderReviewPresentation(h, details.review_issues, { renderText: renderReadableBody })) : null)
      }

      let body
      if (screen.type === 'home') body = renderHome()
      else if (screen.type === 'tasks') body = renderTasks()
      else if (screen.type === 'repository-import') body = renderRepositoryImport(false)
      else if (['overview', 'run-record'].includes(screen.type)) body = renderOverview()
      else if (screen.type === 'report') body = renderReport()
      else if (screen.type === 'create') body = renderCreate()
      else if (screen.type === 'workflow') body = renderWorkflow()
      else if (screen.type === 'risks') body = renderRisks()
      else if (screen.type === 'risk') body = renderRiskDetail()
      else if (screen.type === 'cases') body = renderCases()
      else if (screen.type === 'case') body = renderCaseDetail()
      else if (screen.type === 'coverage-cases') body = renderCoverageCases()
      else if (screen.type === 'execution') body = renderExecutionResults()
      else if (screen.type === 'environment') body = renderEnvironmentPage()
      else if (screen.type === 'flows') body = renderFlows()
      else if (screen.type === 'coverage') body = renderCases()
      else if (screen.type === 'evidence') body = renderEvidence()
      else if (screen.type === 'evidence-detail') body = renderEvidenceDetail()
      else body = renderOverview()

      const requiresSnapshot = !['home', 'tasks', 'create', 'environment', 'repository-import'].includes(screen.type)
      const healthAlert = screen.type !== 'overview' && showRunHealth(screen, selectedTask, current, pageMode) && health?.status === 'warning' ? renderHealthCard(true) : null
      const errorNotice = requiresSnapshot && error ? h('div', { style: { ...styles.card, ...styles.healthError }, role: 'alert' },
        h('div', { style: styles.itemTitle }, snapshot ? '同步失败，继续显示上次结果' : '无法读取 PANGEA 数据'),
        h('div', { style: { ...styles.error, marginTop: 6 } }, error),
        h('button', { type: 'button', style: { ...styles.button, marginTop: 8 }, onClick: () => { void load({ foreground: true }) } }, '重试')) : null
      const initialLoading = requiresSnapshot && loading && snapshot === undefined
      const contentBody = initialLoading
        ? h('div', { style: styles.card, role: 'status' }, h('div', { style: styles.empty }, '正在读取当前 Run…'))
        : requiresSnapshot && snapshot === undefined && error && workbench?.compatibility?.compatible !== false ? null : h(React.Fragment, null, healthAlert, body)
      const actionFeedback = actionNotice?.scopeKey === noticeScopeKey ? h('div', { style: { ...styles.card, ...(actionNotice.isError ? styles.healthError : styles.healthOk) }, role: actionNotice.isError ? 'alert' : 'status' }, h('div', { style: actionNotice.isError ? styles.error : styles.success }, actionNotice.message)) : null
      const monitorPersistenceNotice = pageMode !== 'execution' && monitorPersistenceDegraded
        ? h('div', { style: { ...styles.card, ...styles.healthWarning }, role: 'alert', 'aria-label': '监控记录保存异常' },
          h('div', { style: styles.itemTitle }, '运行观察记录暂未保存'),
          h('p', { style: { ...styles.text, margin: '6px 0 0' } }, '监控记录暂时无法写入磁盘，部分运行观察历史可能在重启后丢失。分析结果和测试用例的状态仍以各自产物为准。'),
          monitorPersistence.error?.message ? h('details', { style: { ...styles.itemMeta, marginTop: 8 } },
            h('summary', { style: { cursor: 'pointer' } }, '保存错误详情'),
            h('div', { style: { marginTop: 6, overflowWrap: 'anywhere' } }, [monitorPersistence.error.code, monitorPersistence.error.message].filter(Boolean).join('：'))) : null)
        : null
      const flowScreen = screen.type === 'flows' && pageMode === 'analysis' && selectedTask
      const resultScreen = ['risks', 'risk', 'cases', 'case', 'coverage-cases'].includes(screen.type) && pageMode === 'analysis' && selectedTask
      const rootClassName = `pangea-companion${screen.type === 'home' ? ' b06-home-screen' : ''}${screen.type === 'tasks' ? ' b03-task-screen' : ''}${screen.type === 'overview' || flowScreen || resultScreen ? ' b03-overview-screen' : ''}${flowScreen ? ' b04-flow-screen' : ''}${resultScreen ? ' b05-result-screen' : ''}`
      const rootStyle = screen.type === 'home' || screen.type === 'tasks' || flowScreen || resultScreen ? { ...styles.root, height: 'auto', minHeight: '100%', overflow: 'visible', background: '#f7f7f5', color: '#25292e', fontFamily: 'var(--pangea-font, "Segoe UI", "Microsoft YaHei UI", sans-serif)', fontSynthesis: 'none', WebkitFontSmoothing: 'auto', textRendering: 'auto' } : styles.root
      const flowTargetLabel = text(selectedTask?.title, text(selectedTask?.target, '分析任务')).replace(/\s*分析\s*$/, '')
      const resultScopeLabel = [selectedTask?.repository || current?.repository || '当前仓库',
        selectedTask?.source_scope?.join('、')].filter(Boolean).join(' / ')
      const resultTarget = current?.target || selectedTask?.target
      const resultTargetDetails = resultTarget ? h('details', { style: { marginTop: 8, fontSize: 12, color: '#68736a' } },
        h('summary', { style: { cursor: 'pointer' } }, '分析目标'),
        h('p', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxWidth: 800 } }, resultTarget)) : null
      const flowGraphType = flowScreen && ['sequence', 'functions'].includes(flowReader?.view)
      const flowHeader = flowScreen ? h(React.Fragment, null,
        pageHeader({ title: selectedTask.title || current?.target || '分析详情', task: selectedTask, current, ui: ctx.pangea?.ui, onBack: flowBranchDetail ? () => { setFlowBranchDetail(''); setBranchSelection('') } : () => jump('tasks'), actions: h('button', { type: 'button', className: 'b03-task-action', onClick: () => jump('report') }, '查看分析原文') }), navigation) : null
      const resultHeader = resultScreen ? h(React.Fragment, null,
        pageHeader({ title: selectedTask.title || current?.target || '分析详情', task: selectedTask, current, ui: ctx.pangea?.ui, onBack: ['risk', 'case', 'coverage-cases'].includes(screen.type) ? goBack : () => jump('tasks'), backLabel: screen.type === 'case' ? '返回用例' : screen.type === 'risk' ? '返回风险' : '返回任务列表', actions: derivationButton(screen.type === 'case' ? caseById.get(screen.id) : screen.type === 'risk' ? riskById.get(screen.id) : undefined) }), navigation) : null
      if (screen.type === 'workflow') return h('div', { ref: panelRootRef, className: 'pangea-companion', style: styles.root }, monitorPersistenceNotice, renderSourceFirstWorkflow())
      return h('div', { ref: panelRootRef, className: rootClassName, style: rootStyle, role: 'region', 'aria-label': pageMode === 'home' ? 'PANGEA 测试工作台' : pageMode === 'analysis' ? 'PANGEA 分析' : 'PANGEA 执行环境' },
        h('style', null, panelCss),
        taskActionDialog ? h(TaskLifecycleDialog, { state: taskActionDialog,
          onClose: () => { if (!taskActionDialog.busy) setTaskActionDialog(null) }, onConfirm: () => { void confirmTaskAction() } }) : null,
        derivation ? h(RunDerivationDialog, { state: derivation, onChange: draft => setDerivation(value => value && ({ ...value, draft })),
          onClose: closeDerivation, onSubmit: input => { void submitDerivation(input) }, onRetry: () => { void openDerivation(null, derivation) } }) : null,
        ['home', 'tasks', 'create', 'repository-import', 'report'].includes(screen.type) || (screen.type === 'overview' && selectedTask) || flowScreen || resultScreen ? null : header,
        h('div', { className: 'pangea-content', style: screen.type === 'home' ? { padding: '24px 31px 30px', maxWidth: 'none', margin: 0 }
            : screen.type === 'tasks' ? { padding: '25px 31px 27px', maxWidth: 'none', margin: 0 }
              : (screen.type === 'overview' && selectedTask) || flowScreen || resultScreen ? { padding: '24px 31px 27px', maxWidth: 'none', margin: 0 }
              : screen.type === 'report' ? { padding: '25px 31px 27px', maxWidth: 'none', margin: 0 }
                : ['environment', 'repository-import', 'create'].includes(screen.type) ? { padding: 0 } : styles.content }, monitorPersistenceNotice, flowHeader, resultHeader, actionFeedback, errorNotice, contentBody))
    }

    function apply(ctx) {
      const pangea = ctx.pangea
      if (!pangea) return
      ctx.effect(() => pangea.registerPage({
        id: 'workbench', title: () => '工作台', icon, order: 0, default: true,
        available: (_ctx, scope) => Boolean(scope?.cwd),
        component: props => h(PangeaPanel, { ...props, ctx, initialScreen: 'home', pageMode: 'home' }),
      }), 'dsh-pangea-companion: workbench page')
      ctx.effect(() => pangea.registerPage({
        id: 'analysis', title: () => 'PANGEA 分析', icon, order: 10,
        available: (_ctx, scope) => Boolean(scope?.cwd),
        component: props => h(PangeaPanel, { ...props, ctx, initialScreen: 'tasks', pageMode: 'analysis' }),
      }), 'dsh-pangea-companion: analysis page')
      ctx.effect(() => pangea.registerPage({
        id: 'execution', title: () => '环境配置', icon, order: 20,
        available: () => false,
        component: props => h(PangeaPanel, { ...props, ctx, initialScreen: 'environment', pageMode: 'execution' }),
      }), 'dsh-pangea-companion: execution page')
      ctx.effect(() => pangea.registerPage({
        id: 'agent-runtime', title: () => 'Agent Runtime', icon, order: 30,
        available: () => false,
        component: props => h(AcpSettingsPanel, props),
      }), 'dsh-pangea-companion: Agent Runtime settings page')
    }

    exports.CreateAssetPicker = CreateAssetPicker
    exports.TaskLifecycleDialog = TaskLifecycleDialog
    exports.taskCanStop = taskCanStop
    exports.RunDerivationDialog = RunDerivationDialog
    exports.derivationInput = derivationInput
    exports.AgentSessionsDialog = AgentSessionsDialog
    exports.AgentSessionTranscript = AgentSessionTranscript
    exports.createAgentSessionReader = createAgentSessionReader
    exports.agentSessionTranscript = agentSessionTranscript
    exports.agentSessionContent = agentSessionContent
    exports.mergeAgentSessionEvents = mergeAgentSessionEvents
    exports.RunWorkspace = RunWorkspace
    exports.PangeaPanel = PangeaPanel
    exports.TaskInfoAction = TaskInfoAction
    exports.RunExecutionSummary = RunExecutionSummary
    exports.executionObservation = executionObservation
    exports.inject = inject
    exports.requestSnapshot = requestSnapshot
    exports.requestSourceSnippet = requestSourceSnippet
    exports.requestRunExport = requestRunExport
    exports.requestCaseReviews = requestCaseReviews
    exports.requestAssetCatalog = requestAssetCatalog
    exports.requestAssetDetail = requestAssetDetail
    exports.requestEnvironments = requestEnvironments
    exports.saveEnvironment = saveEnvironment
    exports.removeEnvironment = removeEnvironment
    exports.launchExecution = launchExecution
    exports.requestWorkbench = requestWorkbench
    exports.requestWorkbenchAction = requestWorkbenchAction
    exports.requestRepositoryStatus = requestRepositoryStatus
    exports.requestRepositoryImport = requestRepositoryImport
    exports.requestAcpSettings = requestAcpSettings
    exports.requestAgentModels = requestAgentModels
    exports.analysisExecutorBlockedReason = analysisExecutorBlockedReason
    exports.analysisExecutionState = analysisExecutionState
    exports.loadAnalysisAgentModels = loadAnalysisAgentModels
    exports.AgentModelSelect = AgentModelSelect
    exports.saveAcpSettings = saveAcpSettings
    exports.testAcpSettings = testAcpSettings
    exports.filePathFromLocation = filePathFromLocation
    exports.evidenceIdentity = evidenceIdentity
    exports.evidenceTabLabel = evidenceTabLabel
    exports.runLabel = runLabel
    exports.taskMatchesRun = taskMatchesRun
    exports.snapshotMatchesSelection = snapshotMatchesSelection
    exports.workflowAckPresentation = workflowAckPresentation
    exports.deriveRunPresentation = deriveRunPresentation
    exports.outcomePresentation = outcomePresentation
    exports.configuredReviewMethod = configuredReviewMethod
    exports.semanticReviewStatusLabel = semanticReviewStatusLabel
    exports.previousAttemptFailures = previousAttemptFailures
    exports.absoluteWorkspacePath = absoluteWorkspacePath
    exports.evidenceFilePath = evidenceFilePath
    exports.appendConversationDraft = appendConversationDraft
    exports.writableConversation = writableConversation
    exports.splitRiskClaims = splitRiskClaims
    exports.buildDiscussionDraft = buildDiscussionDraft
    exports.riskSeverityCounts = riskSeverityCounts
    exports.filterRisks = filterRisks
    exports.analysisBackTarget = analysisBackTarget
    exports.riskApplicable = riskApplicable
    exports.diagramIsStale = diagramIsStale
    exports.buildAnalysisRequest = buildAnalysisRequest
    exports.CoverageBrowser = CoverageBrowser
    exports.FlowGraphView = FlowGraphView
    exports.BehaviorCoverageView = BehaviorCoverageView
    exports.FlowComparisonView = FlowComparisonView
    exports.CallGraphView = CallGraphView
    exports.SequenceGraphView = SequenceGraphView
    exports.FunctionVariablesView = FunctionVariablesView
    exports.diagramHtmlDocument = diagramHtmlDocument
    exports.flowGraphInput = flowGraphInput
    exports.svgTreeToReact = svgTreeToReact
    exports.flowContentState = flowContentState
    exports.renderReadableBody = renderReadableBody
    exports.collectionWarning = collectionWarning
    exports.showRunHealth = showRunHealth
    exports.artifactLabel = artifactLabel
    exports.apply = apply
    return module.exports
  },
})
