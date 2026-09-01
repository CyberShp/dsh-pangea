// PANGEA run presentation fixes: isolated assistant sessions, conditional rework stages,
// and a read-only view of persisted Agent outputs.
window.__ModuleLoader__.load({
  id: 'dsh-pangea-run-ui',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const inject = ['pangea']
    const API_PATH = '/api/pangea-run-ui/outputs'
    const STYLE_ID = 'dsh-pangea-run-ui-style'
    const contextListeners = new Set()
    const creationThrottle = new Map()
    const reworkSeen = new Set()
    let lastRunContext = null

    function installStyles() {
      if (document.getElementById(STYLE_ID)) return () => {}
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.dataset.plugin = 'dsh-pangea-run-ui'
      style.textContent = `
        body[data-pangea-product-shell] [data-pangea-assistant-card] {
          height:auto!important; min-height:0!important; display:block!important;
          padding:10px 0 4px!important; border:0!important; border-radius:0!important;
          background:transparent!important; box-shadow:none!important;
        }
        body[data-pangea-product-shell] [data-pangea-assistant-icon],
        body[data-pangea-product-shell] [data-pangea-assistant-progress],
        body[data-pangea-product-shell] [data-pangea-assistant-card] > :last-child { display:none!important; }
        body[data-pangea-product-shell] [data-pangea-assistant-name] { font-size:14px!important; font-weight:680!important; }
        body[data-pangea-product-shell] [data-pangea-assistant-meta] { margin-top:4px; font-size:12px!important; color:#7a828d!important; }
        body[data-pangea-product-shell] [data-pangea-assistant-actions] { display:grid!important; grid-template-columns:minmax(0,1fr) auto; gap:8px!important; align-items:center; }
        body[data-pangea-product-shell] [data-pangea-assistant-actions]::after {
          content:'独立会话 · 不影响正在运行的分析'; grid-column:1 / -1;
          color:#7a828d; font-size:11px; line-height:16px; padding-top:1px;
        }
        body[data-pangea-product-shell] [data-pangea-assistant-select] { min-width:0!important; width:100%!important; }
      `
      document.head.appendChild(style)
      return () => style.remove()
    }

    function notifyContext() {
      for (const listener of contextListeners) listener(lastRunContext)
    }

    function activeConversation(context) {
      const conversations = Array.isArray(context?.conversations) ? context.conversations : []
      return conversations.find(item => item.conversation_id === context?.activeConversationId) ?? null
    }

    function ensureAssistantConversation(context) {
      if (!context?.taskId) return
      const conversations = Array.isArray(context.conversations) ? context.conversations : []
      const active = activeConversation(context)
      if (active && active.kind !== 'analysis') return
      const assistant = [...conversations].reverse().find(item => item.kind !== 'analysis')
      if (assistant?.conversation_id) {
        context.onSelectConversation?.(assistant.conversation_id)
        return
      }
      const lastCreate = creationThrottle.get(context.taskId) ?? 0
      if (Date.now() - lastCreate < 5000) return
      creationThrottle.set(context.taskId, Date.now())
      context.onCreateConversation?.()
    }

    function assistantSelectSafety(context) {
      const analysisIds = new Set((context?.conversations ?? []).filter(item => item.kind === 'analysis').map(item => item.conversation_id))
      for (const select of document.querySelectorAll('[data-pangea-assistant-select]')) {
        select.setAttribute('aria-label', '切换 AI 助手会话')
        for (const option of select.options ?? []) {
          const isAnalysis = analysisIds.has(option.value)
          option.disabled = isAnalysis
          option.hidden = isAnalysis
        }
      }
    }

    function domShowsRework(context) {
      if (context?.phase && /定向补齐|返工|再复核/.test(context.phase)) return true
      for (const element of document.querySelectorAll('div,span')) {
        if (element.textContent?.trim() !== '定向补齐单元') continue
        const parent = element.parentElement
        if (parent && /[1-9]\d*/.test(parent.textContent ?? '')) return true
      }
      return false
    }

    function conditionalStageRows(context) {
      if (!context?.taskId) return
      if (domShowsRework(context)) reworkSeen.add(context.taskId)
      const visible = reworkSeen.has(context.taskId)
      const labels = new Set(['定向补齐', '返工', '返工复核', '再复核'])
      for (const element of document.querySelectorAll('div,span')) {
        const label = element.textContent?.trim()
        if (!labels.has(label)) continue
        let row = element
        for (let depth = 0; depth < 5 && row?.parentElement; depth += 1, row = row.parentElement) {
          const columns = row.style?.gridTemplateColumns ?? ''
          if (row.style?.display === 'grid' && /9px|minmax/.test(columns)) break
        }
        if (row) row.style.display = visible ? '' : 'none'
      }
    }

    function syncDom(context) {
      assistantSelectSafety(context)
      conditionalStageRows(context)
    }

    function useRunContext() {
      const [context, setContext] = React.useState(lastRunContext)
      React.useEffect(() => {
        contextListeners.add(setContext)
        return () => contextListeners.delete(setContext)
      }, [])
      return context
    }

    async function requestOutputs({ cwd, runId, signal }) {
      const query = new URLSearchParams({ cwd, run_id: runId })
      const response = await fetch(`${API_PATH}?${query}`, { cache: 'no-store', signal })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    function stageNames(output) {
      return ['准备', '规划', '分析', '独立复核', ...(output?.has_rework ? ['定向补齐', '再复核'] : []), '生成报告', '完成']
    }

    function stageIndex(output) {
      const stage = output?.progress?.stage
      const hasRework = output?.has_rework === true
      const map = {
        preparing: 0,
        planning: 1,
        analyzing: 2,
        reviewing: hasRework ? 5 : 3,
        closing: 4,
        reporting: hasRework ? 6 : 4,
        complete: hasRework ? 7 : 5,
      }
      return Number.isInteger(map[stage]) ? map[stage] : -1
    }

    const ui = {
      root: { height: '100%', overflow: 'auto', boxSizing: 'border-box', padding: '24px 28px 40px', background: '#f5f6f8', color: '#17191d' },
      head: { display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 18 },
      title: { fontSize: 24, lineHeight: 1.2, fontWeight: 720, letterSpacing: '-.03em' },
      sub: { marginTop: 6, color: '#747b85', fontSize: 13, lineHeight: 1.55 },
      card: { border: '1px solid #dce1e6', borderRadius: 9, background: '#fff', padding: 16, marginBottom: 14, boxShadow: '0 1px 2px rgba(20,29,40,.03)' },
      stages: { display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto', padding: '6px 0 2px' },
      stage: { minWidth: 92, display: 'grid', gridTemplateColumns: '18px minmax(62px,1fr)', alignItems: 'center', gap: 7, color: '#747b85', fontSize: 12 },
      dot: { width: 10, height: 10, borderRadius: '50%', border: '2px solid #c7ccd3', background: '#fff', boxSizing: 'border-box' },
      doneDot: { borderColor: '#2da44e', background: '#2da44e' },
      activeDot: { borderColor: '#c7000b', background: '#c7000b', boxShadow: '0 0 0 3px #fff0f1' },
      line: { width: 34, height: 1, background: '#d9dde3', flex: '0 0 auto' },
      section: { fontSize: 16, fontWeight: 680, margin: '22px 0 10px' },
      record: { borderTop: '1px solid #edf0f2', padding: '13px 0' },
      recordHead: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' },
      recordTitle: { fontSize: 14, fontWeight: 680 },
      meta: { color: '#7a818b', fontSize: 12 },
      summary: { marginTop: 7, whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 13 },
      chips: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 },
      chip: { padding: '3px 7px', borderRadius: 999, background: '#f0f2f4', color: '#505761', fontSize: 11 },
      pre: { maxHeight: 420, overflow: 'auto', padding: 12, borderRadius: 7, background: '#f6f7f9', fontSize: 11, lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
      empty: { color: '#7a818b', fontSize: 13, lineHeight: 1.6 },
      error: { color: '#c7000b', fontSize: 13, whiteSpace: 'pre-wrap' },
    }

    function StageRail({ output }) {
      const stages = stageNames(output)
      const active = stageIndex(output)
      return h('div', { style: ui.stages }, stages.flatMap((name, index) => [
        index > 0 ? h('span', { key: `line-${name}`, style: ui.line }) : null,
        h('span', { key: name, style: ui.stage },
          h('span', { style: { ...ui.dot, ...(index < active ? ui.doneDot : index === active ? ui.activeDot : {}) } }),
          h('span', { style: index === active ? { color: '#17191d', fontWeight: 680 } : undefined }, name)),
      ]).filter(Boolean))
    }

    function CountChips({ record }) {
      const labels = [
        ['业务流程', record.counts?.business_flows], ['证据', record.counts?.evidence], ['风险', record.counts?.risks],
        ['用例', record.counts?.test_cases], ['错误', record.counts?.errors],
      ]
      return h('div', { style: ui.chips }, labels.map(([label, value]) => h('span', { key: label, style: ui.chip }, `${label} ${value ?? 0}`)))
    }

    function RecordCard({ record, fallbackTitle }) {
      const title = record.unit_id ? `${record.unit_id} · Attempt ${record.attempt}` : fallbackTitle
      return h('div', { style: ui.record },
        h('div', { style: ui.recordHead },
          h('div', { style: ui.recordTitle }, title),
          h('div', { style: ui.meta }, [record.worker_id, record.file].filter(Boolean).join(' · '))),
        record.summary ? h('div', { style: ui.summary }, record.summary) : null,
        record.analyzed_scope?.length ? h('div', { style: ui.meta }, `分析范围：${record.analyzed_scope.join('、')}`) : null,
        record.analyzed_context_scope?.length ? h('div', { style: ui.meta }, `上下文范围：${record.analyzed_context_scope.join('、')}`) : null,
        h(CountChips, { record }),
        h('details', { style: { marginTop: 9 } },
          h('summary', { style: { cursor: 'pointer', fontSize: 12, color: '#4f5966' } }, '查看完整结构化输出'),
          h('pre', { style: ui.pre }, JSON.stringify(record.raw ?? {}, null, 2))))
    }

    function RecordSection({ title, records, empty }) {
      return h(React.Fragment, null,
        h('div', { style: ui.section }, title),
        h('div', { style: ui.card }, records?.length
          ? records.map((record, index) => h(RecordCard, { key: `${record.kind}-${record.file}-${index}`, record, fallbackTitle: title }))
          : h('div', { style: ui.empty }, empty)))
    }

    function AgentOutputPage({ scope }) {
      const context = useRunContext()
      const runId = context?.runId
      const cwd = scope?.cwd
      const [output, setOutput] = React.useState(null)
      const [error, setError] = React.useState('')

      React.useEffect(() => {
        if (!runId || !cwd) {
          setOutput(null)
          setError('')
          return undefined
        }
        let disposed = false
        let controller = null
        const load = async () => {
          controller?.abort()
          controller = new AbortController()
          try {
            const value = await requestOutputs({ cwd, runId, signal: controller.signal })
            if (!disposed) { setOutput(value); setError('') }
          } catch (reason) {
            if (!disposed && reason?.name !== 'AbortError') setError(reason instanceof Error ? reason.message : String(reason))
          }
        }
        void load()
        const timer = window.setInterval(load, 5000)
        return () => { disposed = true; controller?.abort(); window.clearInterval(timer) }
      }, [cwd, runId])

      if (!runId) return h('div', { style: ui.root }, h('div', { style: ui.title }, 'Agent 输出'), h('div', { style: ui.sub }, '先在“PANGEA 分析”中选择一个 Run。'))
      return h('div', { style: ui.root },
        h('div', { style: ui.head }, h('div', null,
          h('div', { style: ui.title }, 'Agent 输出'),
          h('div', { style: ui.sub }, `${context?.title ?? runId} · ${runId}`))),
        error ? h('div', { style: { ...ui.card, ...ui.error } }, error) : null,
        output ? h(React.Fragment, null,
          h('div', { style: ui.card },
            h('div', { style: { fontSize: 13, fontWeight: 680, marginBottom: 8 } }, '完整流程'),
            h(StageRail, { output }),
            h('div', { style: { ...ui.sub, marginTop: 10 } }, output.has_rework
              ? '独立复核已触发定向补齐；补齐与再复核作为条件分支展示。'
              : '当前未触发定向补齐，因此不展示返工相关阶段。')),
          output.plan ? h(RecordSection, { title: '规划 Agent', records: [output.plan], empty: '暂无规划输出。' }) : null,
          h(RecordSection, { title: '分析 Worker', records: output.analysis, empty: '暂无已持久化的分析 Worker 输出。' }),
          output.has_rework ? h(RecordSection, { title: '定向补齐', records: output.rework, empty: '已触发定向补齐，等待 Worker 写入结果。' }) : null,
          h(RecordSection, { title: 'Reviewer', records: output.reviews, empty: '暂无已持久化的 Reviewer 输出。' }))
          : h('div', { style: ui.card }, h('div', { style: ui.empty }, '正在读取 Agent 输出…')))
    }

    function icon() {
      return h('svg', { viewBox: '0 0 24 24', width: 22, height: 22, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 },
        h('path', { d: 'M5 4.5h14v15H5z' }), h('path', { d: 'M8 8h8M8 12h8M8 16h5' }))
    }

    function apply(ctx) {
      if (!ctx.pangea) return
      const disposeStyle = installStyles()
      const onRunContext = event => {
        const context = event.detail
        if (!context) return
        lastRunContext = context
        ensureAssistantConversation(context)
        window.requestAnimationFrame(() => syncDom(context))
        notifyContext()
      }
      window.addEventListener('pangea:run-context', onRunContext)
      const observer = new MutationObserver(() => lastRunContext && syncDom(lastRunContext))
      observer.observe(document.documentElement, { subtree: true, childList: true })
      const disposePage = ctx.pangea.registerPage({
        id: 'agent-output', title: () => 'Agent 输出', icon, order: 15,
        available: (_ctx, scope) => Boolean(scope?.cwd),
        component: AgentOutputPage,
      })
      ctx.effect?.(() => () => {
        disposePage?.()
        observer.disconnect()
        window.removeEventListener('pangea:run-context', onRunContext)
        disposeStyle()
      }, 'dsh-pangea-run-ui')
    }

    exports.inject = inject
    exports.stageNames = stageNames
    exports.apply = apply
    return module.exports
  },
})
