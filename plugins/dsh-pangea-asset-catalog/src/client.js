// Browser half of dsh-pangea-asset-catalog. It only edits generated catalog
// metadata and never changes source assets or PANGEA state.
window.__ModuleLoader__.load({
  id: 'dsh-pangea-asset-catalog',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const inject = ['pangea', 'sessions']
    const API_PATH = '/api/pangea-asset-catalog/state'
    const ROLES = [
      ['input_candidate', '输入候选'],
      ['semantic_reference', '语义参考'],
      ['example_reference', '示例参考'],
      ['methodology_candidate', '方法论候选'],
      ['automation_capability', '自动化能力'],
      ['unclassified', '未分类'],
    ]
    const ROLE_LABELS = Object.fromEntries(ROLES)

    async function requestState({ cwd, signal, fetcher = fetch }) {
      const response = await fetcher(`${API_PATH}?${new URLSearchParams({ cwd }).toString()}`, { cache: 'no-store', signal })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    async function requestAction({ cwd, action, payload = {}, fetcher = fetch }) {
      const response = await fetcher(`${API_PATH}?${new URLSearchParams({ cwd }).toString()}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...payload }),
      })
      const value = await response.json()
      if (!response.ok || value.status !== 'ok') throw new Error(value.error ?? `HTTP ${response.status}`)
      return value
    }

    function analysisSessionId(value) {
      return value?.job?.session_id ?? value?.result?.model_session_id ?? ''
    }

    async function openAnalysisSession(sessions, sessionId, timeoutMs = 5000) {
      if (!sessionId) throw new Error('没有可打开的分析会话。')
      const available = () => Boolean(sessions.list.getSnapshot().byId?.[sessionId])
      if (!available()) {
        await new Promise((resolve, reject) => {
          let unsubscribe = () => {}
          const timer = setTimeout(() => {
            unsubscribe()
            reject(new Error('分析会话尚未同步到侧边栏，请稍后重试。'))
          }, timeoutMs)
          const check = () => {
            if (!available()) return
            clearTimeout(timer)
            unsubscribe()
            resolve()
          }
          unsubscribe = sessions.list.subscribe(check)
          check()
        })
      }
      sessions.open(sessionId)
    }

    const styles = {
      root: { height: '100%', overflow: 'auto', boxSizing: 'border-box', color: 'var(--dsw-alias-label-primary, inherit)', background: 'var(--dsw-alias-bg-base, transparent)' },
      header: { position: 'sticky', top: 0, zIndex: 4, padding: '14px', background: 'var(--dsw-alias-bg-layer-1, #111)', borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.24))' },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
      title: { fontSize: 16, fontWeight: 760 },
      subline: { marginTop: 4, color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 10, lineHeight: 1.45, overflowWrap: 'anywhere' },
      content: { padding: '14px 14px 24px' },
      card: { border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22))', background: 'var(--dsw-alias-bg-layer-1, transparent)', borderRadius: 9, padding: 11, marginBottom: 9 },
      notice: { borderColor: 'var(--dsw-alias-state-business-secondary, #4d9ad6)', background: 'var(--dsw-alias-state-business-tertiary, rgba(77,154,214,.1))' },
      error: { borderColor: 'var(--dsw-alias-state-error-secondary, #e66767)', color: 'var(--dsw-alias-state-error-primary, #e66767)' },
      success: { borderColor: 'var(--dsw-alias-state-success-secondary, #4fb8a8)' },
      button: { border: '1px solid var(--dsw-alias-border-l2, #555)', background: 'var(--dsw-alias-bg-layer-2, transparent)', color: 'inherit', borderRadius: 7, padding: '6px 9px', cursor: 'pointer', fontSize: 10 },
      primary: { borderColor: 'var(--dsw-alias-state-business-primary, #4d9ad6)', background: 'var(--dsw-alias-state-business-primary, #4d9ad6)', color: 'var(--dsw-alias-label-on-primary, #fff)', fontWeight: 700 },
      metrics: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 7, marginBottom: 11 },
      metric: { border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16))', borderRadius: 8, padding: 9, background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08))' },
      number: { fontSize: 18, fontWeight: 760 },
      label: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 9, marginTop: 3 },
      filters: { display: 'flex', gap: 5, overflowX: 'auto', marginBottom: 10, paddingBottom: 3 },
      filter: { flex: '0 0 auto', border: '1px solid var(--dsw-alias-border-l2, #555)', borderRadius: 999, background: 'transparent', color: 'inherit', padding: '4px 8px', fontSize: 10, cursor: 'pointer' },
      filterActive: { background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.16))', fontWeight: 700 },
      itemTitle: { fontSize: 12, fontWeight: 720, overflowWrap: 'anywhere' },
      meta: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 10, lineHeight: 1.5, marginTop: 5, overflowWrap: 'anywhere' },
      summary: { fontSize: 11, lineHeight: 1.55, marginTop: 7 },
      chips: { display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 },
      chip: { borderRadius: 999, padding: '2px 6px', background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.15))', color: 'var(--dsw-alias-label-secondary, inherit)', fontSize: 9 },
      select: { border: '1px solid var(--dsw-alias-border-l2, #555)', borderRadius: 6, background: 'var(--dsw-alias-bg-layer-2, #222)', color: 'inherit', padding: '4px 6px', fontSize: 10, maxWidth: 150 },
      input: { width: '100%', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2, #555)', borderRadius: 6, background: 'var(--dsw-alias-bg-layer-2, #222)', color: 'inherit', padding: '6px 7px', fontSize: 10, marginTop: 4 },
      textarea: { width: '100%', minHeight: 54, resize: 'vertical', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2, #555)', borderRadius: 6, background: 'var(--dsw-alias-bg-layer-2, #222)', color: 'inherit', padding: '6px 7px', fontSize: 10, marginTop: 4 },
      issue: { marginTop: 8, padding: 9, borderRadius: 7, border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16))', background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.06))' },
      empty: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 11, lineHeight: 1.6 },
    }

    function normalizationText(asset) {
      const value = asset.normalization
      if (!value) return ''
      if (value.status === 'failed' || value.status === 'too_large') return `转换失败：${value.error ?? value.error_code ?? '无法读取文档'}`
      if (value.persisted) return `已生成 Markdown：${value.markdown_path}`
      if (value.status === 'converted_with_warnings') return `可转换为 Markdown，但有诊断：${value.warnings?.join('；') ?? '部分内容可能缺失'}`
      return `可转换为 Markdown：${value.markdown_path}`
    }

    function lines(value) {
      return Array.isArray(value) ? value.join('\n') : ''
    }

    function lineValues(value) {
      return value.split(/\r?\n/).map(item => item.trim()).filter(Boolean)
    }

    function extractionText(value) {
      if (!value?.available) return ''
      if (value.job?.status === 'queued' || value.job?.status === 'running') return `DSH 模型分析中 · 会话 ${value.job.session_id}`
      if (value.job?.status === 'failed') return `提取失败：${value.job.error}`
      if (value.result) return value.result.extraction_status === 'no_issues'
        ? '模型没有发现有原文依据的历史问题。'
        : `已提取 ${value.result.issues?.length ?? 0} 条历史问题草稿 · 第 ${value.result.extraction_revision} 次提取`
      return '尚未调用 DSH 模型提取历史问题。'
    }

    function IssueReview({ asset, issue, busy, onAction }) {
      const [editing, setEditing] = React.useState(false)
      const [draft, setDraft] = React.useState(() => ({ ...issue }))
      const review = issue.review
      const decision = review?.decision
      const update = (field, value) => setDraft(current => ({ ...current, [field]: value }))
      const arrayFields = [
        ['trigger_conditions', '触发条件'], ['impact', '影响'], ['root_causes', '根因'],
        ['resolutions', '解决办法'], ['verification', '验证方式'], ['limitations', '限制与例外'],
      ]
      const corrected = {
        title: draft.title, symptom: draft.symptom,
        trigger_conditions: draft.trigger_conditions, impact: draft.impact,
        root_causes: draft.root_causes, resolutions: draft.resolutions,
        verification: draft.verification, limitations: draft.limitations,
        missing_fields: draft.missing_fields ?? [], confidence: draft.confidence,
      }
      return h('div', { style: styles.issue },
        h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, issue.title), h('span', { style: styles.chip }, decision === 'confirmed' ? '已确认' : decision === 'excluded' ? '已排除' : `草稿 · ${issue.confidence}`)),
        issue.symptom ? h('div', { style: styles.summary }, issue.symptom) : null,
        h('div', { style: styles.meta }, `来源：${issue.evidence.map(item => item.location).join('；')}`),
        editing ? h('div', { style: { marginTop: 9 } },
          h('label', { style: styles.label }, '问题名称', h('input', { style: styles.input, value: draft.title, onChange: event => update('title', event.target.value) })),
          h('label', { style: { ...styles.label, display: 'block', marginTop: 7 } }, '问题现象', h('textarea', { style: styles.textarea, value: draft.symptom, onChange: event => update('symptom', event.target.value) })),
          ...arrayFields.map(([field, label]) => h('label', { key: field, style: { ...styles.label, display: 'block', marginTop: 7 } }, `${label}（每行一项）`, h('textarea', { style: styles.textarea, value: lines(draft[field]), onChange: event => update(field, lineValues(event.target.value)) }))),
          h('label', { style: { ...styles.label, display: 'block', marginTop: 7 } }, '置信度', h('select', { style: { ...styles.select, display: 'block', marginTop: 4 }, value: draft.confidence, onChange: event => update('confidence', event.target.value) }, ['high', 'medium', 'low'].map(value => h('option', { key: value, value }, value)))),
          h('div', { style: { ...styles.row, justifyContent: 'flex-start', marginTop: 9 } },
            h('button', { type: 'button', disabled: busy, style: { ...styles.button, ...styles.primary }, onClick: () => { void onAction(asset, issue, 'confirmed', corrected); setEditing(false) } }, '保存并确认'),
            h('button', { type: 'button', disabled: busy, style: styles.button, onClick: () => setEditing(false) }, '取消')))
          : h('div', { style: { ...styles.row, justifyContent: 'flex-start', marginTop: 9 } },
            h('button', { type: 'button', disabled: busy || decision === 'confirmed', style: { ...styles.button, ...styles.primary }, onClick: () => { void onAction(asset, issue, 'confirmed') } }, decision === 'confirmed' ? '已确认' : '确认'),
            h('button', { type: 'button', disabled: busy, style: styles.button, onClick: () => setEditing(true) }, '修正后确认'),
            h('button', { type: 'button', disabled: busy || decision === 'excluded', style: styles.button, onClick: () => { void onAction(asset, issue, 'excluded') } }, decision === 'excluded' ? '已排除' : '排除')))
    }

    function CatalogPanel({ scope, visible, ctx }) {
      const cwd = scope?.cwd
      const [state, setState] = React.useState(undefined)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState('')
      const [filter, setFilter] = React.useState('all')

      const load = React.useCallback(async () => {
        if (!cwd) return
        const controller = new AbortController()
        try { setError(''); setState(await requestState({ cwd, signal: controller.signal })) }
        catch (value) { if (value?.name !== 'AbortError') setError(value instanceof Error ? value.message : String(value)) }
        return () => controller.abort()
      }, [cwd])

      React.useEffect(() => {
        if (visible === false || !cwd) return undefined
        let dispose
        void load().then(value => { dispose = value })
        return () => dispose?.()
      }, [cwd, visible, load])

      const modelBusy = Boolean(state?.assets?.some(asset => ['queued', 'running'].includes(asset.historical_extraction?.job?.status)) || ['queued', 'running'].includes(state?.methodology_generation?.job?.status))
      React.useEffect(() => {
        if (!modelBusy || visible === false) return undefined
        const timer = setInterval(() => { void load() }, 1500)
        return () => clearInterval(timer)
      }, [modelBusy, visible, load])

      async function act(action, payload = {}) {
        setBusy(true); setError(''); setNotice('')
        try {
          const value = await requestAction({ cwd, action, payload })
          setState(value)
          const messages = {
            generate: `目录文件已生成：${value.output_root}`,
            override: '建议分类已保存，并重新生成目录文件。',
            extract_historical_issues: `历史问题提取任务已创建：${value.launched?.session_id ?? ''}`,
            review_historical_issue: '人工复核结果已保存。',
            derive_methodology: `方法论候选任务已创建：${value.launched?.session_id ?? ''}`,
          }
          setNotice(messages[action] ?? '操作已完成。')
        } catch (value) { setError(value instanceof Error ? value.message : String(value)) }
        finally { setBusy(false) }
      }

      async function reviewIssue(asset, issue, decision, correctedIssue = undefined) {
        await act('review_historical_issue', {
          asset_id: asset.asset_id, issue_id: issue.issue_id, decision,
          ...(correctedIssue ? { corrected_issue: correctedIssue } : {}),
        })
      }

      async function openSession(sessionId) {
        setError('')
        try { await openAnalysisSession(ctx.sessions, sessionId) }
        catch (value) { setError(value instanceof Error ? value.message : String(value)) }
      }

      if (!cwd) return h('div', { style: styles.root }, h('div', { style: styles.content }, h('div', { style: styles.card }, h('div', { style: styles.empty }, '当前 DSH 页面没有可用工作区。'))))
      const assets = state?.assets ?? []
      const filtered = filter === 'all' ? assets : assets.filter(asset => asset.suggested_roles?.includes(filter))
      return h('div', { style: styles.root, role: 'region', 'aria-label': 'PANGEA 资产目录' },
        h('div', { style: styles.header },
          h('div', { style: styles.row }, h('div', { style: styles.title }, '资产目录'), h('button', { type: 'button', disabled: busy, style: { ...styles.button, ...styles.primary }, onClick: () => { void act('generate') } }, busy ? '处理中…' : '生成目录文件')),
          h('div', { style: styles.subline }, cwd)),
        h('div', { style: styles.content },
          h('div', { style: { ...styles.card, ...styles.notice } }, h('div', { style: styles.summary }, '本插件只分析文件并生成非约束性目录。它不修改 PANGEA、Run、原始资产或任何分析决策。'), state?.generated ? h('div', { style: styles.meta }, `已有目录：${state.generated.catalog_path} · ${state.generated.modified_at}`) : h('div', { style: styles.meta }, '尚未生成 catalog.json；当前页面显示的是实时扫描预览。')),
          notice ? h('div', { style: { ...styles.card, ...styles.success } }, h('div', { style: styles.summary }, notice)) : null,
          error ? h('div', { style: { ...styles.card, ...styles.error }, role: 'alert' }, h('div', { style: styles.summary }, error), h('button', { type: 'button', style: { ...styles.button, marginTop: 8 }, onClick: () => { void load() } }, '重试')) : null,
          state ? h(React.Fragment, null,
            h('div', { style: styles.metrics },
              [['资料', state.counts.materials], ['自动化', state.counts.automations], ['已标准化', state.counts.normalized_documents], ['待处理', state.counts.diagnostics]].map(([label, value]) => h('div', { key: label, style: styles.metric }, h('div', { style: styles.number }, value), h('div', { style: styles.label }, label)))),
            h('div', { style: styles.card },
              h('div', { style: styles.row },
                h('div', null, h('div', { style: styles.itemTitle }, '已确认历史问题 → 方法论候选'), h('div', { style: styles.meta }, `已确认 ${state.historical_issue_reviews?.confirmed ?? 0} 条 · 已排除 ${state.historical_issue_reviews?.excluded ?? 0} 条`)),
                h('div', { style: { ...styles.row, justifyContent: 'flex-end' } },
                  analysisSessionId(state.methodology_generation) ? h('button', { type: 'button', style: styles.button, onClick: () => { void openSession(analysisSessionId(state.methodology_generation)) } }, '打开分析会话') : null,
                  h('button', { type: 'button', disabled: busy || modelBusy || !state.methodology_generation?.available, style: { ...styles.button, ...styles.primary }, onClick: () => { void act('derive_methodology') } }, state.methodology_generation?.job && ['queued', 'running'].includes(state.methodology_generation.job.status) ? '生成中…' : '生成方法论候选'))),
              state.methodology_generation?.job?.status === 'failed' ? h('div', { style: { ...styles.meta, color: 'var(--dsw-alias-state-error-primary, #e66767)' } }, `生成失败：${state.methodology_generation.job.error}`) : null,
              state.methodology_generation?.result ? h('div', { style: styles.meta }, `当前 ${state.methodology_generation.result.candidates?.length ?? 0} 条候选${state.methodology_generation.stale ? ' · 已确认问题发生变化，需要重新生成' : ''} · ${state.methodology_generation.output_path}`) : null),
            h('div', { style: styles.filters }, [['all', '全部'], ...ROLES].map(([role, label]) => h('button', { key: role, type: 'button', style: { ...styles.filter, ...(filter === role ? styles.filterActive : {}) }, onClick: () => setFilter(role) }, label))),
            filtered.length ? filtered.map(asset => h('div', { key: asset.asset_id, style: styles.card },
              h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, asset.source_path), h('span', { style: styles.chip }, asset.kind)),
              h('div', { style: styles.meta }, `${asset.parse_status} · ${asset.suggestion_source === 'user_override' ? '人工修正' : '插件建议'} · 非约束性`),
              asset.normalization ? h('div', { style: styles.meta }, normalizationText(asset), asset.normalization.persisted && asset.normalization.open_path ? h('button', { type: 'button', style: { ...styles.button, marginLeft: 7, padding: '3px 6px' }, onClick: () => ctx.pangea.openFile(scope, asset.normalization.open_path, `${asset.source_path} · Markdown`) }, '打开 Markdown') : null) : null,
              asset.historical_extraction?.available ? h('div', { style: { marginTop: 8 } },
                h('div', { style: styles.row },
                  h('div', { style: styles.meta }, extractionText(asset.historical_extraction)),
                  h('div', { style: { ...styles.row, justifyContent: 'flex-end' } },
                    asset.historical_extraction.normalized_open_path ? h('button', { type: 'button', style: styles.button, onClick: () => ctx.pangea.openFile(scope, asset.historical_extraction.normalized_open_path, `${asset.source_path} · Markdown`) }, '打开 Markdown') : null,
                    analysisSessionId(asset.historical_extraction) ? h('button', { type: 'button', style: styles.button, onClick: () => { void openSession(analysisSessionId(asset.historical_extraction)) } }, '打开分析会话') : null,
                    h('button', { type: 'button', disabled: busy || ['queued', 'running'].includes(asset.historical_extraction.job?.status), style: styles.button, onClick: () => { void act('extract_historical_issues', { asset_id: asset.asset_id }) } }, asset.historical_extraction.result ? '重新提取' : '提取历史问题'))),
                asset.historical_extraction.result?.issues?.map(issue => h(IssueReview, { key: issue.issue_id, asset, issue, busy, onAction: reviewIssue }))) : null,
              asset.summary ? h('div', { style: styles.summary }, asset.summary) : null,
              h('div', { style: styles.chips }, asset.suggested_roles.map(role => h('span', { key: role, style: styles.chip }, ROLE_LABELS[role] ?? role))),
              h('div', { style: { ...styles.row, marginTop: 9 } },
                h('span', { style: styles.label }, '修正主要建议角色'),
                h('select', { style: styles.select, value: asset.suggested_roles[0] ?? 'unclassified', disabled: busy, onChange: event => { void act('override', { asset_id: asset.asset_id, suggested_roles: [event.target.value], kind: asset.kind }) } }, ROLES.map(([role, label]) => h('option', { key: role, value: role }, label))))))
              : h('div', { style: styles.card }, h('div', { style: styles.empty }, '当前筛选没有资产。')),
            state.diagnostics.length ? h('div', { style: styles.card }, h('div', { style: styles.itemTitle }, `诊断（${state.diagnostics.length}）`), state.diagnostics.map((item, index) => h('div', { key: `${item.kind}:${item.path}:${index}`, style: styles.meta }, `${item.path} · ${item.kind}${item.parse_status ? ` · ${item.parse_status}` : ''}`))) : null)
            : !error ? h('div', { style: styles.card }, h('div', { style: styles.empty }, '正在扫描资产…')) : null))
    }

    const icon = h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 },
      h('path', { d: 'M4 5.5h6l2 2H20v11H4z' }), h('path', { d: 'M8 12h8M8 15h6' }))

    function apply(ctx) {
      const pangea = ctx.pangea
      if (!pangea) return
      ctx.effect(() => pangea.registerPage({
        id: 'assets', title: () => '资产', icon, order: 30,
        available: (_ctx, scope) => Boolean(scope?.cwd),
        component: props => h(CatalogPanel, { ...props, ctx }),
      }), 'dsh-pangea-asset-catalog: asset page')
    }

    exports.inject = inject
    exports.requestState = requestState
    exports.requestAction = requestAction
    exports.analysisSessionId = analysisSessionId
    exports.openAnalysisSession = openAnalysisSession
    exports.apply = apply
    return module.exports
  },
})
