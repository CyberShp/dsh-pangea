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
    const ACP_SETTINGS_API_PATH = '/api/pangea-companion/acp-settings'
    const TYPES = [
      ['', '全部'], ['requirement', '需求'], ['design', '设计'],
      ['historical_defect', '历史缺陷'], ['reference', '参考资料'], ['coverage', '覆盖率'],
      ['test_case_example', '示例用例'],
    ]
    const STATUS = {
      imported: '等待处理', extracting: '提取中', awaiting_review: '待人工审核',
      available: '可用于分析', no_items: '未提取到可用内容', rejected: '已拒绝',
      failed: '失败', archived: '已归档',
    }
    const STATUS_FILTERS = [
      ['', '全部状态'], ['imported', '等待处理'], ['extracting', '提取中'], ['awaiting_review', '待人工审核'],
      ['available', '可用于分析'], ['no_items', '无结构化条目'], ['rejected', '已拒绝'],
      ['failed', '失败'], ['archived', '已删除 / 已归档'],
    ]
    const METHODOLOGY_STATUS = { candidate: '待启用', enabled: '已启用', disabled: '已停用' }
    const assetTime = value => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '未记录'
    function emptyIcon(kind = 'inbox') {
      return h('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', focusable: false },
        kind === 'search'
          ? h(React.Fragment, null, h('circle', { cx: 11, cy: 11, r: 8 }), h('path', { d: 'm21 21-4.35-4.35' }))
          : h(React.Fragment, null, h('path', { d: 'M22 12h-6l-2 3h-4l-2-3H2' }), h('path', { d: 'm5.45 5.11-3.4 6.8v6.07A2.02 2.02 0 0 0 4.07 20h15.86A2.02 2.02 0 0 0 22 17.98v-6.07l-3.45-6.8A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z' })))
    }
    function plusIcon() {
      return h('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', focusable: false, 'aria-hidden': true }, h('path', { d: 'M12 5v14M5 12h14' }))
    }
    function assetFileIcon(assetType) {
      return h('svg', { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.65, strokeLinecap: 'round', strokeLinejoin: 'round', focusable: false },
        h('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }), h('path', { d: 'M14 2v6h6' }),
        assetType === 'coverage' ? h(React.Fragment, null, h('path', { d: 'M8 13h2M14 13h2M8 17h2M14 17h2' })) : h(React.Fragment, null, h('path', { d: 'M8 13h8M8 17h8' })))
    }

    function listSearch({ cwd, page = 1, pageSize = 20, type = '', status = '', kind = '', query = '', repositoryId = '', moduleTag = '', assetId }) {
      return new URLSearchParams({
        cwd, page: String(page), page_size: String(pageSize),
        ...(type ? { type } : {}), ...(status ? { status } : {}),
        ...(kind ? { kind } : {}),
        ...(repositoryId ? { repository_id: repositoryId } : {}),
        ...(moduleTag ? { module_tag: moduleTag } : {}),
        ...(query ? { q: query } : {}), ...(assetId ? { asset_id: assetId } : {}),
      }).toString()
    }

    async function requestState({ cwd, page = 1, pageSize = 20, type = '', status = '', kind = '', query = '', repositoryId = '', moduleTag = '', signal, fetcher = fetch }) {
      const response = await fetcher(`${API_PATH}?${listSearch({ cwd, page, pageSize, type, status, kind, query, repositoryId, moduleTag })}`, { cache: 'no-store', signal })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    async function requestAssetDetail({ cwd, assetId, signal, fetcher = fetch }) {
      const response = await fetcher(`${API_PATH}?${listSearch({ cwd, assetId })}`, { cache: 'no-store', signal })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    async function requestMethodologyDetail({ cwd, methodologyId, signal, fetcher = fetch }) {
      const response = await fetcher(`${API_PATH}?${listSearch({ cwd })}&methodology_id=${encodeURIComponent(methodologyId)}`, { cache: 'no-store', signal })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    async function requestAction({ cwd, action, payload = {}, page = 1, pageSize = 20, type = '', status = '', kind = '', query = '', fetcher = fetch }) {
      const response = await fetcher(`${API_PATH}?${listSearch({ cwd, page, pageSize, type, status, kind, query })}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...payload }),
      })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    async function openAnalysisSession(sessions, sessionId, timeoutMs = 5000) {
      if (!sessionId) throw new Error('没有可打开的提取会话。')
      const available = () => Boolean(sessions.list.getSnapshot().byId?.[sessionId])
      if (!available()) {
        await new Promise((resolve, reject) => {
          let unsubscribe = () => {}
          const timer = setTimeout(() => { unsubscribe(); reject(new Error('提取会话尚未同步，请稍后重试。')) }, timeoutMs)
          const check = () => {
            if (!available()) return
            clearTimeout(timer); unsubscribe(); resolve()
          }
          unsubscribe = sessions.list.subscribe(check)
          check()
        })
      }
      sessions.open(sessionId)
    }

    function resolveWorkspaceCwd(scope, sessions) {
      if (typeof scope?.cwd === 'string' && scope.cwd.trim() !== '') return scope.cwd
      const snapshot = sessions?.list?.getSnapshot?.()
      let sessionId = scope?.sessionId ?? snapshot?.current
      const visited = new Set()
      while (sessionId && !visited.has(sessionId)) {
        visited.add(sessionId)
        const session = snapshot?.byId?.[sessionId]
        if (typeof session?.cwd === 'string' && session.cwd.trim() !== '') return session.cwd
        sessionId = session?.parentId
      }
      return ''
    }

    const styles = {
      root: {
        height: '100%', overflow: 'auto', color: 'var(--dsw-alias-label-primary, #22252b)', background: 'var(--dsw-alias-bg-base, #f7f7f5)',
        fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif', scrollbarWidth: 'none',
        fontSize: 14,
      },
      header: { position: 'sticky', top: 0, zIndex: 3, padding: '25px 31px 0', background: 'var(--dsw-alias-bg-base, #f7f7f5)', borderBottom: '1px solid #e5e7e4' },
      content: { padding: '24px 30px 32px 31px' },
      row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
      wrap: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
      title: { fontSize: 27, fontWeight: 650, letterSpacing: '-.5px', margin: 0, lineHeight: 1.4 }, itemTitle: { fontSize: 16, fontWeight: 680, overflowWrap: 'anywhere', lineHeight: 1.5 },
      meta: { color: 'var(--dsw-alias-label-secondary, #69717d)', fontSize: 13, lineHeight: 1.5, marginTop: 5, overflowWrap: 'anywhere' },
      card: { border: '1px solid var(--dsw-alias-border-l2, #e0e2df)', borderRadius: 10, padding: 20, marginBottom: 14, background: 'var(--dsw-alias-bg-layer-1, #fff)' },
      notice: { borderColor: 'var(--dsw-alias-state-business-secondary, #e05b65)' },
      error: { borderColor: 'var(--dsw-alias-state-error-secondary, #e66767)', color: 'var(--dsw-alias-state-error-primary, #e66767)' },
      button: { border: '1px solid var(--dsw-alias-border-l2, #dfe1df)', background: 'var(--dsw-alias-bg-layer-1, #fff)', color: 'inherit', borderRadius: 6, padding: '7px 13px', minHeight: 36, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', lineHeight: 1.4 },
      primary: { background: '#25282d', borderColor: '#25282d', color: '#fff', fontWeight: 650 },
      active: { background: 'var(--dsw-alias-state-business-tertiary, #fff0f1)', borderColor: 'var(--dsw-alias-state-business-secondary, #e05b65)', color: 'var(--dsw-alias-state-business-primary, #c7000b)', fontWeight: 700 },
      input: { boxSizing: 'border-box', maxWidth: '100%', minHeight: 38, border: '1px solid var(--dsw-alias-border-l2, #dfe1df)', borderRadius: 7, background: 'var(--dsw-alias-bg-layer-1, #fff)', color: 'inherit', padding: '8px 12px', fontSize: 13, fontFamily: 'inherit' },
      field: { display: 'grid', gap: 6, minWidth: 0 },
      label: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-secondary, #69717d)' },
      grow: { flex: '1 1 180px', minWidth: 0 },
      chip: { borderRadius: 5, padding: '4px 8px', background: 'var(--dsw-alias-bg-layer-3, #f1f3f4)', fontSize: 12, lineHeight: 1.5, overflowWrap: 'anywhere' },
      pre: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 360, overflow: 'auto', fontSize: 13, lineHeight: 1.55 },
      resultGrid: { display: 'grid', gap: 7 },
      resultItem: { borderLeft: '2px solid var(--dsw-alias-state-business-primary, #c7000b)', paddingLeft: 12 },
      methodologyGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 12, marginTop: 16 },
      methodologyCard: { border: '1px solid var(--dsw-alias-border-l2, #444)', borderRadius: 9, padding: 12, background: 'var(--dsw-alias-bg-layer-1, transparent)' },
      sourceList: { margin: '7px 0 0', paddingLeft: 17, fontSize: 16, lineHeight: 1.55 },
      summaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 10 },
      summaryValue: { fontSize: 22, fontWeight: 750, marginTop: 5 },
    }

    function structuredItems(result) {
      if (!result || typeof result !== 'object') return []
      for (const key of ['items', 'records', 'requirements', 'designs', 'defects', 'references', 'coverage']) {
        if (Array.isArray(result[key])) return result[key]
      }
      return []
    }

    const fieldLabels = { inputs: '输入', outputs: '输出', constraints: '适用条件与约束', acceptance_criteria: '验收标准', modules: '适用模块', interfaces: '接口', states: '状态', main_flows: '主要场景', branch_flows: '分支场景', error_flows: '异常场景', recovery_flows: '恢复场景', symptom: '问题表现', trigger: '触发条件', root_cause: '问题原因', propagation: '影响过程', defect_mechanism: '问题机理', exclusion_conditions: '排除条件', applicable_modules: '适用模块', key_facts: '关键事实', preconditions: '适用条件', steps: '操作步骤', expected_results: '预期结果', related_problems: '相关问题', source_references: '原文出处' }
    function readable(value) {
      if (Array.isArray(value)) return value.map(readable).join('\n')
      if (value && typeof value === 'object') return value.path && value.location ? `${value.path} · ${value.location}` : JSON.stringify(value, null, 2)
      return String(value ?? '')
    }
    function renderStructuredResult(result) {
      const items = structuredItems(result)
      if (items.length && items.every(item => item.coverage_type)) return h('section', { 'aria-label': '提取内容' },
        h('div', { style: styles.row }, h('h2', { style: styles.itemTitle }, '覆盖率记录'), h('span', { style: styles.chip }, `${items.length} 条`)),
        h('p', { style: styles.meta }, '查看函数、代码行与分支的执行次数。'),
        h('div', { style: { overflowX: 'auto' } }, h('table', { className: 'pangea-asset-table', 'aria-label': '覆盖率记录' },
          h('thead', null, h('tr', null, ['类型', '源码位置', '函数 / 分支', '执行次数'].map(label => h('th', { key: label, scope: 'col' }, label)))),
          h('tbody', null, items.map((item, index) => h('tr', { key: index },
            h('td', null, ({ function: '函数', line: '代码行', branch: '分支' })[item.coverage_type] ?? item.coverage_type),
            h('td', null, `${item.path || item.file_path || '未提供路径'}${item.line ? `:${item.line}` : ''}`),
            h('td', null, item.function || item.condition || (item.branch != null ? `块 ${item.block ?? '—'} · 分支 ${item.branch}` : '—')),
            h('td', null, item.true_count != null || item.false_count != null ? `真 ${item.true_count ?? '—'} / 假 ${item.false_count ?? '—'}` : item.count ?? '—')))))),
        result.warnings?.length ? h('p', { style: styles.meta }, readable(result.warnings)) : null,
        h('details', { style: { marginTop: 20 } }, h('summary', { style: styles.meta }, '完整提取记录'), h('pre', { style: styles.pre }, JSON.stringify(result, null, 2))))
      return h('section', { 'aria-label': '提取内容' },
        h('h2', { style: styles.title }, '提取内容'),
        result.summary ? h('p', { style: { lineHeight: 1.7 } }, result.summary) : null,
        items.map((item, index) => h('details', { key: item.item_id ?? index, style: styles.card, open: items.length === 1 },
          h('summary', { style: { ...styles.itemTitle, cursor: 'pointer' } }, item.title ?? item.topic ?? item.name ?? `条目 ${index + 1}`),
          h('dl', { className: 'pangea-asset-fields', style: { display: 'grid', gridTemplateColumns: 'minmax(100px, 140px) minmax(0, 1fr)', gap: '16px 20px', lineHeight: 1.7 } },
            Object.entries(fieldLabels).filter(([key]) => readable(item[key]).trim()).map(([key, label]) => h(React.Fragment, { key },
              h('dt', { style: { fontWeight: 650 } }, label), h('dd', { style: { margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, readable(item[key]))))),
          !['constraints', 'trigger', 'preconditions', 'applicable_modules', 'modules'].some(key => readable(item[key]).trim()) ? h('p', { style: styles.meta }, '适用条件：原文未明确，待确认。') : null)),
        result.warnings?.length ? h('section', { style: styles.card }, h('h3', null, '待确认事项'), h('div', { style: { whiteSpace: 'pre-wrap', lineHeight: 1.7 } }, readable(result.warnings))) : null,
        h('details', null, h('summary', { style: styles.meta }, '完整提取记录'), h('pre', { style: styles.pre }, JSON.stringify(result, null, 2))))
    }

    function AssetPanel({ ctx, scope, visible }) {
      const cwd = resolveWorkspaceCwd(scope, ctx.sessions)
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const importPending = React.useRef(false)
      const detailPending = React.useRef('')
      const [detailLoading, setDetailLoading] = React.useState(false)
      const [page, setPage] = React.useState(1)
      const [pageSize, setPageSize] = React.useState(20)
      const [type, setType] = React.useState('')
      const [status, setStatus] = React.useState('')
      const [kind, setKind] = React.useState('')
      const [query, setQuery] = React.useState('')
      const [queryDraft, setQueryDraft] = React.useState('')
      const [activeAsset, setActiveAsset] = React.useState(null)
      const [detailTab, setDetailTab] = React.useState('content')
      const [details, setDetails] = React.useState({})
      const [reviewDrafts, setReviewDrafts] = React.useState({})
      const [importPath, setImportPath] = React.useState('')
      const [importFile, setImportFile] = React.useState(null)
      const importFileInput = React.useRef(null)
      const [importOpen, setImportOpen] = React.useState(false)
      const [importType, setImportType] = React.useState('design')
      const [importTitle, setImportTitle] = React.useState('')
      const [selectedAssets, setSelectedAssets] = React.useState({})
      const [editingAssetId, setEditingAssetId] = React.useState('')
      const editDialogRef = React.useRef(null)
      const editReturnFocus = React.useRef(null)
      const [editTitle, setEditTitle] = React.useState('')
      const [editType, setEditType] = React.useState('')
      const [editRepositories, setEditRepositories] = React.useState('')
      const [editModules, setEditModules] = React.useState('')
      const [editLanguages, setEditLanguages] = React.useState('')
      const [expandedMethodology, setExpandedMethodology] = React.useState('')
      const [methodologyDetails, setMethodologyDetails] = React.useState({})
      const [methodologySources, setMethodologySources] = React.useState({})
      const [section, setSection] = React.useState('library')
      const [loading, setLoading] = React.useState(false)
      let savedExecution = {}
      try { savedExecution = JSON.parse(window.localStorage?.getItem(`pangea-execution:${cwd}`) ?? '{}') } catch {}
      const [executor, setExecutor] = React.useState(savedExecution.provider_id ?? '')
      const [executorOptions, setExecutorOptions] = React.useState([])
      const [modelOptions, setModelOptions] = React.useState([])
      const [selectedModel, setSelectedModel] = React.useState(savedExecution.provider_id ? savedExecution.agent_model ?? '' : savedExecution.model_route ? JSON.stringify(savedExecution.model_route) : '')
      const [modelLoading, setModelLoading] = React.useState(false)
      const [modelError, setModelError] = React.useState('')
      const selectedAssetIds = Object.keys(selectedAssets)

      React.useEffect(() => {
        if (!cwd || !selectedModel) return
        const choice = { provider_id: executor, ...(executor ? { agent_model: selectedModel } : { model_route: JSON.parse(selectedModel) }) }
        window.localStorage?.setItem(`pangea-execution:${cwd}`, JSON.stringify(choice))
      }, [cwd, executor, selectedModel])

      React.useEffect(() => {
        if (!cwd || visible === false) return undefined
        const controller = new AbortController()
        void fetch(ACP_SETTINGS_API_PATH, { signal: controller.signal }).then(async response => {
          const body = await response.json()
          if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? '执行器列表读取失败')
          setExecutorOptions(body.providers ?? [])
        }).catch(error => { if (!controller.signal.aborted) setModelError(error.message) })
        return () => controller.abort()
      }, [cwd, visible])

      React.useEffect(() => {
        if (!cwd || visible === false) return undefined
        const controller = new AbortController()
        setModelLoading(true); setModelOptions([]); setModelError('')
        const url = executor ? ACP_SETTINGS_API_PATH : `${API_PATH}?cwd=${encodeURIComponent(cwd)}&execution_options=1`
        void fetch(url, { signal: controller.signal, ...(executor ? { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'models', provider_id: executor, cwd }) } : {}) }).then(async response => {
          const body = await response.json()
          if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? '模型列表读取失败')
          const options = executor ? (body.models ?? []).map(item => ({ value: item.id, label: item.label ?? item.id }))
            : (body.models ?? []).filter(item => item.credential_configured).map(item => ({ value: JSON.stringify({ provider: item.provider, model: item.model }), label: item.label || `${item.provider} / ${item.model}` }))
          setModelOptions(options)
          setSelectedModel(current => options.some(item => item.value === current) ? current : options.length === 1 ? options[0].value : '')
        }).catch(error => { if (!controller.signal.aborted) setModelError(error.message) })
          .finally(() => { if (!controller.signal.aborted) setModelLoading(false) })
        return () => controller.abort()
      }, [cwd, visible, executor])

      React.useEffect(() => {
        if (visible === false) return undefined
        document.body.setAttribute('data-pangea-product-mode', 'assets')
        return () => {
          if (document.body.getAttribute('data-pangea-product-mode') === 'assets') document.body.removeAttribute('data-pangea-product-mode')
        }
      }, [visible])

      React.useEffect(() => {
        if (!editingAssetId) return undefined
        const dialog = editDialogRef.current
        const focusable = () => Array.from(dialog?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])') ?? [])
        focusable()[0]?.focus()
        const onKeyDown = event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            setEditingAssetId('')
            editReturnFocus.current?.focus?.()
            return
          }
          if (event.key !== 'Tab') return
          const targets = focusable()
          if (!targets.length) { event.preventDefault(); return }
          const first = targets[0], last = targets[targets.length - 1]
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
      }, [editingAssetId])

      const load = React.useCallback(async signal => {
        if (!cwd) return
        setLoading(true)
        try {
          const value = await requestState({ cwd, page, pageSize, type, status, kind, query, signal })
          if (!signal?.aborted) { setError(''); setState(value); if (activeAsset && detailPending.current !== activeAsset.asset_id) { const fresh = await requestAssetDetail({ cwd, assetId: activeAsset.asset_id, signal }); if (!signal?.aborted) { setDetails(current => ({ ...current, [activeAsset.asset_id]: fresh })); setActiveAsset(fresh.asset) } } }
        } catch (value) {
          if (value?.name !== 'AbortError') setError(value instanceof Error ? value.message : String(value))
        } finally { if (!signal?.aborted) setLoading(false) }
      }, [cwd, page, pageSize, type, status, kind, query, activeAsset?.asset_id])

      React.useEffect(() => {
        if (visible === false || !cwd) return undefined
        const controller = new AbortController()
        void load(controller.signal)
        return () => controller.abort()
      }, [visible, cwd, load])

      const active = Boolean(
        state?.assets?.some(asset => ['preparing', 'queued', 'running', 'repairing', 'finalizing'].includes(asset.extraction_job?.status))
        || ['queued', 'running', 'finalizing'].includes(state?.methodologies?.generation_job?.status)
      )
      React.useEffect(() => {
        if (!active || visible === false) return undefined
        const timer = setInterval(() => { void load() }, 1500)
        return () => clearInterval(timer)
      }, [active, visible, load])

      const sourceIds = section === 'methodologies'
        ? (state?.methodologies?.generation_job?.source_asset_ids ?? methodologyDetails[expandedMethodology]?.source_asset_ids ?? state?.methodologies?.items?.find(item => item.methodology_id === expandedMethodology)?.source_asset_ids ?? [])
        : []
      React.useEffect(() => {
        if (!cwd || !sourceIds.length) return undefined
        const controller = new AbortController()
        for (const assetId of sourceIds) {
          if (methodologySources[assetId]) continue
          void requestAssetDetail({ cwd, assetId, signal: controller.signal })
            .then(value => { if (!controller.signal.aborted) setMethodologySources(current => ({ ...current, [assetId]: value })) })
            .catch(value => { if (value?.name !== 'AbortError') setError(value instanceof Error ? value.message : String(value)) })
        }
        return () => controller.abort()
      }, [cwd, sourceIds.join('|')])

      async function act(action, payload = {}) {
        setBusy(true); setError(''); setNotice('')
        try {
          if (action === 'extract' || action === 'import') {
            const asset = (state?.assets ?? []).find(item => item.asset_id === payload.asset_id)
            if ((asset?.asset_type ?? payload.asset_type) !== 'coverage' && payload.provider_id === undefined) {
              if (modelLoading || modelError) throw new Error(modelError || '正在读取可用模型，请稍候')
              if (!selectedModel && (!executor || modelOptions.length)) throw new Error('请在 AI 助手中选择模型')
              payload = { ...payload, provider_id: executor,
                ...(executor ? { agent_model: selectedModel || undefined } : { model_route: JSON.parse(selectedModel) }) }
            }
          }
          const value = await requestAction({ cwd, action, payload, page, pageSize, type, status, kind, query })
          setState(value)
          if (value.imported_asset_id) { const detail = await requestAssetDetail({ cwd, assetId: value.imported_asset_id }); setDetails(current => ({ ...current, [value.imported_asset_id]: detail })); setActiveAsset(detail.asset) }
          if (action === 'archive' && payload.asset_id) setSelectedAssets(values => {
            const next = { ...values }; delete next[payload.asset_id]; return next
          })
          if (payload.asset_id) setDetails(current => {
            const next = { ...current }; delete next[payload.asset_id]; return next
          })
          if (action === 'archive' || action === 'restore') { setActiveAsset(null); setEditingAssetId('') }
          if (!['archive', 'restore'].includes(action) && payload.asset_id && activeAsset?.asset_id === payload.asset_id) {
            try {
              const detail = await requestAssetDetail({ cwd, assetId: payload.asset_id })
              setDetails(current => ({ ...current, [payload.asset_id]: detail }))
              setActiveAsset(detail.asset)
              setSelectedAssets(current => {
                if (!current[payload.asset_id]) return current
                const next = { ...current }
                if (detail.asset.status === 'available') next[payload.asset_id] = detail.asset
                else delete next[payload.asset_id]
                return next
              })
            } catch (error) { setError(`操作已保存，但详情刷新失败：${error instanceof Error ? error.message : String(error)}`) }
          }
          if (action === 'generate_methodology' && value.methodologies?.generation_job?.session_id) {
            setSection('methodologies')
            setNotice('方法论候选会话已启动。候选提交后会进入待启用状态。')
            await openAnalysisSession(ctx.sessions, value.methodologies.generation_job.session_id)
          } else {
            setNotice(action === 'import' ? '文件已导入，可在详情中查看处理记录和提取内容。'
              : action === 'extract' ? '提取请求已处理，请查看资产状态；结构化提取完成后即可审核或选用。'
                : action === 'review' || action === 'review_items' ? '审核结果已保存。'
                  : action === 'enable_methodology' ? '方法论已启用，后续新 Run 可以冻结引用。'
                    : action === 'disable_methodology' ? '方法论已停用，后续新 Run 不再引用。'
                      : action === 'restore' ? '资产已恢复。'
                        : action === 'update_metadata' ? '资产信息已更新；修改分类后请重新解析原文件。'
                          : state?.features?.restore === false ? '资产已归档。' : '资产已移出资产库，可在“已删除 / 已归档”中恢复。')
          }
          return true
        } catch (value) { setError(value instanceof Error ? value.message : String(value)); return false }
        finally { setBusy(false) }
      }

      function fileAsBase64(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onerror = () => reject(reader.error ?? new Error('无法读取所选文件'))
          reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
          reader.readAsDataURL(file)
        })
      }

      async function importSourcePayload() {
        const payload = { asset_type: importType, title: importTitle.trim() }
        if (importFile) {
          if (importFile.size === 0) throw new Error('所选文件为空，请选择有内容的文件。')
          if (importFile.size > 24 * 1024 * 1024) throw new Error('导入文件超过 24 MiB 限制，请选择较小的文件。')
          payload.file_name = importFile.name
          payload.file_data = await fileAsBase64(importFile)
        } else {
          payload.path = importPath.trim()
        }
        return payload
      }

      async function submitImport() {
        if (importPending.current || busy || (!importFile && !importPath.trim()) || importFileIssue || !importEnvironmentReady) return
        importPending.current = true
        setBusy(true); setError(''); setNotice('')
        try {
          const saved = await act('import', await importSourcePayload())
          if (!saved) return
          setSection('library'); setPage(1); setType(''); setStatus(''); setKind(''); setQuery(''); setQueryDraft('')
          setImportPath(''); setImportFile(null); setImportTitle(''); setImportOpen(false)
        } catch (value) { setError(value instanceof Error ? value.message : String(value)) }
        finally { importPending.current = false; setBusy(false) }
      }

      function startEdit(asset, event) {
        editReturnFocus.current = event?.currentTarget ?? (typeof document !== 'undefined' ? document.activeElement : null)
        setEditingAssetId(asset.asset_id)
        setEditTitle(asset.title)
        setEditType(asset.asset_type)
        setEditRepositories((asset.repository_ids ?? []).join(', '))
        setEditModules((asset.module_tags ?? []).join(', '))
        setEditLanguages((asset.language_tags ?? []).join(', '))
      }

      function valuesFromText(value) {
        return value.split(',').map(item => item.trim()).filter(Boolean)
      }

      async function saveEdit(assetId) {
        const saved = await act('update_metadata', {
          asset_id: assetId,
          title: editTitle.trim(),
          asset_type: editType,
          repository_ids: valuesFromText(editRepositories),
          module_tags: valuesFromText(editModules),
          language_tags: valuesFromText(editLanguages),
        })
        if (saved) setEditingAssetId('')
      }

      function downloadFailureRecord(detail) {
        if (!detail?.failure_record) return
        const blob = new Blob([`${JSON.stringify(detail.failure_record, null, 2)}\n`], { type: 'application/json' })
        const href = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = href
        anchor.download = `${detail.failure_record.asset_id}-failure.json`
        anchor.click()
        URL.revokeObjectURL(href)
      }

      function toggleSelectedAsset(assetId) {
        setSelectedAssets(values => {
          const next = { ...values }
          if (next[assetId]) delete next[assetId]
          else next[assetId] = assets.find(item => item.asset_id === assetId) ?? activeAsset
          return next
        })
      }

      function createRunFromSelection() {
        if (!ctx.pangea?.requestRunCreation || selectedAssetIds.length === 0) return
        ctx.pangea.requestRunCreation(scope, { assetIds: selectedAssetIds })
        setNotice(`已把 ${selectedAssetIds.length} 个资产加入新分析。`)
      }

      async function toggle(assetId, refresh = false) {
        if (detailPending.current === assetId) return
        setError('')
        setActiveAsset(details[assetId]?.asset ?? assets.find(item => item.asset_id === assetId) ?? { asset_id: assetId, title: '正在加载资产…' })
        if (!refresh) setDetailTab('content')
        setEditingAssetId('')
        if (details[assetId] && !refresh) return
        detailPending.current = assetId
        setDetailLoading(true)
        try {
          const value = await requestAssetDetail({ cwd, assetId })
          setDetails(current => ({ ...current, [assetId]: value }))
          setActiveAsset(current => current?.asset_id === assetId ? value.asset : current)
        } catch (value) { setError(value instanceof Error ? value.message : String(value)) }
        finally { if (detailPending.current === assetId) { detailPending.current = ''; setDetailLoading(false) } }
      }

      function reviewItemsFor(assetId, detail) {
        const sourceItems = Array.isArray(detail?.result?.items) ? detail.result.items : []
        const saved = new Map((detail?.review?.items ?? []).map(item => [item.item_id, item]))
        const drafts = reviewDrafts[assetId] ?? {}
        return sourceItems.map(item => {
          const current = drafts[item.item_id] ?? saved.get(item.item_id) ?? { decision: 'pending', note: '' }
          return { ...item, decision: current.decision ?? 'pending', note: current.note ?? '' }
        })
      }

      function updateReviewDraft(assetId, itemId, field, value) {
        setReviewDrafts(current => ({
          ...current,
          [assetId]: {
            ...(current[assetId] ?? {}),
            [itemId]: { ...(details[assetId]?.review?.items ?? []).find(item => item.item_id === itemId), ...(current[assetId]?.[itemId] ?? {}), [field]: value },
          },
        }))
      }

      async function saveReviewItems(assetId, detail) {
        const items = reviewItemsFor(assetId, detail)
        const saved = await act('review_items', {
          asset_id: assetId,
          revision: detail.asset.revision,
          result_sha256: detail.review.result_sha256,
          decisions: items.map(item => ({ item_id: item.item_id, decision: item.decision, note: item.note })),
        })
        if (saved) setReviewDrafts(current => { const next = { ...current }; delete next[assetId]; return next })
      }

      async function toggleMethodology(methodologyId) {
        if (expandedMethodology === methodologyId) { setExpandedMethodology(''); return }
        setExpandedMethodology(methodologyId)
        if (methodologyDetails[methodologyId]) return
        try {
          const value = await requestMethodologyDetail({ cwd, methodologyId })
          setMethodologyDetails(current => ({ ...current, [methodologyId]: value.methodology }))
        } catch (value) { setError(value instanceof Error ? value.message : String(value)) }
      }

      const pagination = state?.pagination ?? { page, page_size: pageSize, total: 0, total_pages: 1 }
      const assets = state?.assets ?? []
      const summary = state?.summary ?? {}
      const methodologies = state?.methodologies?.items ?? []
      const selectedHistoricalIds = selectedAssetIds.filter(assetId => {
        const asset = selectedAssets[assetId]
        return asset?.asset_type === 'historical_defect' && asset?.status === 'available'
      })
      const b08Mode = section !== 'library' && !importOpen
      const showLibrary = section === 'library' && !importOpen
      const displayAssets = activeAsset ? [activeAsset] : assets
      const hasAppliedFilters = Boolean(type || kind || query || (section === 'library' && status))
      const searchEmptyState = showLibrary && !activeAsset && !loading && !error && hasAppliedFilters && pagination.total === 0
      const searchFilterLabel = [
        type ? TYPES.find(([value]) => value === type)?.[1] : '',
        status ? STATUS_FILTERS.find(([value]) => value === status)?.[1] : '',
      ].filter(Boolean).join(' / ')
      const hasFilters = hasAppliedFilters || Boolean(queryDraft)
      const waitingForAssets = (loading && !error) || (!state && !error)
      const emptyCatalogError = Boolean(error && showLibrary && !activeAsset && !displayAssets.length)
      function clearFilters() {
        setPage(1); setType(''); setKind(''); setQuery(''); setQueryDraft('')
        setStatus(section === 'review' ? 'awaiting_review' : section === 'archived' ? 'archived' : '')
      }
      function navigate(value) {
        setSection(value); setActiveAsset(null); setImportOpen(false); setEditingAssetId('')
        setPage(1); setQuery(''); setQueryDraft(''); setType(''); setKind('')
        setStatus(value === 'review' ? 'awaiting_review' : value === 'archived' ? 'archived' : '')
        setError(''); setNotice('')
      }
      const assistantAsset = importOpen ? null : activeAsset ?? state?.assets?.find(item => item.extraction_job)
      const job = assistantAsset?.extraction_job
      const jobLabel = { preparing: '准备中', queued: '等待处理', running: '正在提取', finalizing: '保存结果', repairing: '修正类型', needs_attention: '需要处理', completed: '已完成', failed: '处理失败', interrupted: '处理已中断' }
      const modelLabel = job?.model ? typeof job.model === 'string' ? job.model : `${job.model.provider} / ${job.model.model}` : ''
      const renderJob = value => h(React.Fragment, null,
        value.error ? h('p', { role: 'alert', style: styles.error }, value.error) : null,
        h('ol', { style: { paddingLeft: 24, lineHeight: 1.8 } }, (value.events ?? []).map((event, index) => h('li', { key: index }, event.label))),
        value.output ? h('pre', { style: { ...styles.pre, maxHeight: '48vh', fontFamily: 'inherit', lineHeight: 1.75 } }, value.output) : h('p', { style: styles.meta }, value.status === 'completed' ? '处理结果已保存，可在资产详情中查看。' : '等待 Agent 输出处理记录…'))
      const coverageOnly = (importOpen ? importType : activeAsset?.asset_type) === 'coverage'
      const importTypes = TYPES.filter(([value]) => value && (!state?.asset_types?.length || state.asset_types.includes(value)))
      const generalImportTypes = importTypes.filter(([value]) => value !== 'coverage')
      const defaultGeneralType = generalImportTypes.find(([value]) => value === 'design')?.[0] ?? generalImportTypes[0]?.[0] ?? ''
      const importFileIssue = importFile?.size === 0 ? '所选文件为空，请选择有内容的文件。'
        : importFile?.size > 24 * 1024 * 1024 ? `当前文件为 ${(importFile.size / (1024 * 1024)).toFixed(1)} MiB；请选择不超过 24 MiB 的文件。` : ''
      const importEnvironmentReady = coverageOnly || (!modelLoading && !modelError
        && (!executor || executorOptions.some(item => item.id === executor && item.registered && item.available !== false))
        && (executor ? !modelOptions.length || Boolean(selectedModel) : Boolean(selectedModel)))
      function openImport() {
        setActiveAsset(null); setImportOpen(true); setNotice(''); setError('')
        setImportType(current => importTypes.some(([value]) => value === current) ? current : defaultGeneralType || importTypes[0]?.[0] || '')
      }
      function closeImport() {
        setActiveAsset(null); setImportOpen(false); setEditingAssetId(''); setError(''); setNotice('')
      }
      const designedDetail = activeAsset && ['design', 'requirement', 'reference', 'test_case_example', 'coverage'].includes(activeAsset.asset_type)
      const detailHeaderActions = designedDetail && activeAsset.asset_type === 'design' && activeAsset.status === 'available' && !activeAsset.result_stale && (!activeAsset.extraction_job || activeAsset.extraction_job.status === 'completed')
      const showAssistant = importOpen || Boolean(activeAsset && !designedDetail && !b08Mode)
      const processingSettings = h('div', null,
        h('p', { style: styles.meta }, importOpen ? '用于这次提取。原始材料与处理结果分别保留。' : '用于下一次处理；切换配置不会影响已有结果。'),
        h('label', { style: { display: 'block', marginTop: importOpen ? 10 : 20 } }, 'Agent',
          h('select', { 'aria-label': '资产解析执行器', style: { ...styles.input, width: '100%', marginTop: 8 }, value: executor, disabled: busy, onChange: event => { setExecutor(event.target.value); setSelectedModel('') } },
            h('option', { value: '' }, '内置 API'), executorOptions.map(item => h('option', { key: item.id, value: item.id, disabled: !item.registered || item.available === false }, item.label)))),
        h('label', { style: { display: 'block', marginTop: importOpen ? 4 : 16 } }, '模型',
          h('select', { 'aria-label': '资产解析模型', style: { ...styles.input, width: '100%', marginTop: 8 }, value: selectedModel, disabled: busy || modelLoading, onChange: event => setSelectedModel(event.target.value) },
            h('option', { value: '' }, modelLoading ? '读取模型中…' : executor && !modelOptions.length ? '执行器默认模型' : !modelOptions.length ? '尚未配置可用模型' : '选择模型'), modelOptions.map(item => h('option', { key: item.value, value: item.value }, item.label)))),
        modelError ? h('p', { role: 'alert', style: styles.error }, modelError) : null,
        !importOpen && !modelLoading && !modelError && !executor && !modelOptions.length ? h('p', { style: styles.meta }, '当前没有已配置的 API 模型。可选择可用 Agent，或前往设置配置模型。') : null,
        importOpen ? h('div', { className: `pangea-asset-readiness${importEnvironmentReady ? ' is-ready' : ' is-blocked'}`, role: modelError ? 'alert' : 'status' },
          h('div', { className: 'pangea-asset-readiness-title' }, h('svg', { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.65, 'aria-hidden': true }, h('circle', { cx: 12, cy: 12, r: 9 }), importEnvironmentReady ? h('path', { d: 'm8 12 2.5 2.5L16 9' }) : h('path', { d: 'M12 7v6m0 4h.01' })),
            h('strong', null, importEnvironmentReady ? '处理环境已就绪' : modelLoading ? '正在检查处理环境' : modelError ? '无法读取处理环境' : '尚未配置可用模型')),
          h('p', null, importEnvironmentReady ? '提取完成后可在详情中核对结果。' : modelLoading ? '正在读取可用模型，请稍候。' : modelError ? modelError : '请配置内置模型，或选择已加载的外部 Agent。'),
          !importEnvironmentReady && !modelLoading ? h('button', { type: 'button', className: 'pangea-asset-open-settings', onClick: () => window.dispatchEvent(new CustomEvent('pangea:open-model-settings', { detail: { mode: 'internal' } })) }, '打开设置') : null) : null,
        importOpen ? h('p', { style: { ...styles.meta, fontSize: 11, marginTop: 16 } }, '设置变化用于后续处理，不影响已有结果。') : null)
      const assistant = showAssistant ? h('aside', { className: 'pangea-asset-assistant', 'aria-label': '资产 AI 助手' },
        h('h2', { style: { ...styles.itemTitle, margin: 0 } }, importOpen ? coverageOnly ? '覆盖率资料' : '处理设置' : '处理记录'),
        coverageOnly && importOpen ? h('div', { className: 'pangea-asset-coverage-info' },
          h('span', { className: 'pangea-asset-coverage-icon', 'aria-hidden': true }, assetFileIcon('coverage')),
          h('h3', null, '保留执行记录', h('br'), '再核对源码范围'),
          h('p', null, '文件由本机直接解析。导入后，可浏览函数、代码行或分支记录。'),
          h('hr'),
          h('p', null, '是否适用于某次分析，需核对文件路径、版本与源码匹配。'))
        : coverageOnly ? h('p', { style: styles.meta }, '覆盖率文件由本机直接解析，无需选择 Agent 或模型。')
          : importOpen ? processingSettings : h('details', { style: { marginTop: 16 } }, h('summary', null, '重新处理设置'), processingSettings),
        !importOpen ? h('h3', { style: { ...styles.meta, marginTop: 24 } }, assistantAsset?.title) : null,
        job ? h(React.Fragment, null,
          h('p', { style: { fontWeight: 650 } }, jobLabel[job.status] ?? '等待处理'),
          h('p', { style: styles.meta }, `${job.provider_id ? executorOptions.find(item => item.id === job.provider_id)?.label ?? job.provider_id : modelLabel ? '内置 API' : '文件解析'}${modelLabel ? ` · ${modelLabel}` : ''}`),
          renderJob(job),
          job.status === 'needs_attention' ? h('button', { type: 'button', style: styles.button, disabled: busy, onClick: () => { void act('extract', { asset_id: assistantAsset.asset_id, provider_id: job.provider_id, ...(job.provider_id ? { agent_model: job.model } : { model_route: job.model }) }) } }, '原会话继续修正') : null,
          ['failed', 'interrupted', 'needs_attention'].includes(job.status) ? h('button', { type: 'button', style: { ...styles.button, ...styles.primary }, disabled: busy, onClick: () => { void act('extract', { asset_id: assistantAsset.asset_id, restart: true }) } }, '重新处理资产') : null,
          (job.history ?? []).map((past, index) => h('details', { key: index, style: { marginTop: 20 } }, h('summary', { style: styles.itemTitle }, `历史处理 · ${assetTime(past.started_at)}`), renderJob(past))))
          : !importOpen ? h('p', { style: { ...styles.meta, marginTop: 20 } }, '处理结果保存在左侧详情中。') : null) : null
      function detailPairs(rows) {
        return h('dl', { className: 'pangea-asset-detail-kv' }, rows.map(([label, value]) => h(React.Fragment, { key: label }, h('dt', null, label), h('dd', null, value ?? '未提供'))))
      }
      function detailLog(record) {
        const events = record?.events ?? []
        return events.length ? h('ol', { className: 'pangea-asset-detail-log' }, events.map((event, index) => h('li', { key: index },
          event.at || event.timestamp ? h('time', null, assetTime(event.at ?? event.timestamp)) : null,
          event.label ?? event.message ?? '处理事件'))) : h('p', { style: styles.meta }, '尚无处理事件。')
      }
      function detailItems(result) {
        const items = structuredItems(result)
        return items.map((item, index) => h('details', { key: item.item_id ?? index, className: 'pangea-asset-detail-item', open: index === 0 },
          h('summary', null, `${item.item_id ?? `条目 ${index + 1}`} · ${item.title ?? item.topic ?? item.name ?? '未命名内容'}`),
          detailPairs(Object.entries(fieldLabels).filter(([key]) => readable(item[key]).trim() && key !== 'source_references').map(([key, label]) => [label, readable(item[key])])),
          item.source_references ? h('div', { className: 'pangea-asset-detail-source-note' }, `原文出处 · ${readable(item.source_references)}`) : null))
      }
      function detailCoverageTable(result) {
        return h('div', { className: 'pangea-asset-detail-table-wrap' }, h('table', { className: 'pangea-asset-table', 'aria-label': '覆盖率记录' },
          h('thead', null, h('tr', null, ['类型', '源码位置', '函数 / 分支', '执行次数'].map(label => h('th', { key: label, scope: 'col' }, label)))),
          h('tbody', null, structuredItems(result).map((item, index) => h('tr', { key: index },
            h('td', null, ({ function: '函数', line: '代码行', branch: '分支' })[item.coverage_type] ?? item.coverage_type),
            h('td', null, `${item.path || item.file_path || '未提供路径'}${item.line != null ? `:${item.line}` : ''}`),
            h('td', null, item.function || item.condition || (item.branch != null ? `块 ${item.block ?? '—'} · 分支 ${item.branch}` : '未提供')),
            h('td', null, item.true_count != null || item.false_count != null ? `真 ${item.true_count ?? '未提供'} / 假 ${item.false_count ?? '未提供'}` : item.count ?? '未提供'))))))
      }
      function normalizedSource(text) {
        const lines = String(text).split(/\r?\n/)
        const blocks = []
        let paragraph = []
        const flush = () => { if (paragraph.length) { blocks.push(h('p', { key: blocks.length }, paragraph.join('\n'))); paragraph = [] } }
        for (const line of lines) {
          const value = line.trim()
          if (!value) { flush(); continue }
          const heading = value.match(/^#{1,6}\s+(.+)$/)
          const numbered = value.match(/^(?:\d+\.)*\d+\.?\s+.+$/)
          if (heading || numbered) { flush(); blocks.push(h(heading ? 'h3' : 'h4', { key: blocks.length }, heading ? heading[1] : value)) }
          else paragraph.push(line)
        }
        flush()
        return h('article', { className: 'pangea-asset-normalized-source' }, blocks)
      }
      function detailEditDialog(asset) {
        if (editingAssetId !== asset.asset_id) return null
        return h('div', { className: 'pangea-asset-modal-scrim' }, h('section', { ref: editDialogRef, className: 'pangea-asset-edit-dialog pangea-asset-designed-edit', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'pangea-asset-edit-title' },
          h('div', { style: styles.row }, h('div', null, h('div', { style: styles.meta }, asset.title), h('h2', { id: 'pangea-asset-edit-title', style: { ...styles.itemTitle, margin: 0 } }, '编辑资产信息')),
            h('button', { type: 'button', 'aria-label': '关闭', style: styles.button, onClick: () => { setEditingAssetId(''); editReturnFocus.current?.focus?.() } }, '×')),
          h('label', { style: { ...styles.field, marginTop: 19 } }, h('span', { style: styles.label }, '资产标题'), h('input', { 'aria-label': '编辑资产标题', style: { ...styles.input, width: '100%' }, value: editTitle, onChange: event => setEditTitle(event.target.value) })),
          h('div', { className: 'pangea-asset-edit-fields' },
            h('label', { style: styles.field }, h('span', { style: styles.label }, '资料分类'), h('select', { 'aria-label': '编辑资产分类', style: styles.input, value: editType, onChange: event => setEditType(event.target.value) }, TYPES.filter(([value]) => value && (!state?.asset_types?.length || state.asset_types.includes(value))).map(([value, label]) => h('option', { key: value, value }, label)))),
            [['关联仓库', editRepositories, setEditRepositories], ['模块标签', editModules, setEditModules], ['语言标签', editLanguages, setEditLanguages]].map(([label, value, setter]) => h('label', { key: label, style: styles.field }, h('span', { style: styles.label }, label), h('input', { 'aria-label': label, style: styles.input, value, onChange: event => setter(event.target.value) }), label === '关联仓库' ? h('span', { className: 'pangea-asset-edit-hint' }, '多个仓库以逗号分隔') : null))),
          h('p', { className: 'pangea-asset-edit-warning' }, '更改资料分类后，需要重新处理原文件，使提取内容与新分类一致。'),
          h('div', { className: 'pangea-asset-edit-actions' }, h('button', { type: 'button', style: styles.button, onClick: () => { setEditingAssetId(''); editReturnFocus.current?.focus?.() } }, '取消'),
            h('button', { type: 'button', disabled: busy || !editTitle.trim(), style: { ...styles.button, ...styles.primary }, onClick: () => { void saveEdit(asset.asset_id) } }, '保存信息'))))
      }
      function detailView(asset, detail) {
        const assetJob = asset.extraction_job
        const stale = Boolean(asset.result_stale)
        const processing = ['preparing', 'queued', 'running', 'repairing', 'finalizing'].includes(assetJob?.status) || asset.status === 'extracting'
        const attention = assetJob?.status === 'needs_attention'
        const failed = asset.status === 'failed' || ['failed', 'interrupted'].includes(assetJob?.status)
        const noItems = asset.status === 'no_items'
        const processState = processing || attention || failed || noItems
        const items = structuredItems(detail?.result)
        const filename = asset.source_name || asset.source_path?.split(/[\\/]/).pop() || '未提供文件名'
        const assetTypeLabel = TYPES.find(([value]) => value === asset.asset_type)?.[1] ?? asset.asset_type
        const usable = asset.status === 'available' && !stale && Boolean(detail?.asset?.input_revision)
        const assetId = asset.asset_id
        const restart = () => { void act('extract', { asset_id: assetId, restart: true }) }
        const side = (title, content) => h('section', { className: 'pangea-asset-detail-panel' }, h('h3', null, title), content)
        const sourceAndRevision = side('原始材料与修订', detailPairs([['文件', filename], ['当前修订', `r${asset.revision ?? 1}`], ['关联仓库', (asset.repository_ids ?? []).join('、') || '未设置'], ['模块', (asset.module_tags ?? []).join('、') || '未设置']]))
        const processingSide = h('aside', { className: 'pangea-asset-detail-side' },
          side('本次资料', detailPairs([['文件', filename], ['资料分类', assetTypeLabel], ['当前修订', `r${asset.revision ?? 1}`], ['原始材料', asset.source_path ? '已保存' : '未提供']])),
          failed ? side('失败记录', h(React.Fragment, null,
            h('p', { style: styles.meta }, asset.last_error ?? assetJob?.error ?? '本次处理未完成。'),
            h('hr', { style: { border: 0, borderTop: '1px solid #e5e7e4', margin: '17px 0' } }),
            h('p', { style: styles.meta }, `最近尝试 · ${assetTime(assetJob?.started_at)}`),
            items.length ? h('details', { style: { marginTop: 16 } }, h('summary', null, `前次成果 · ${items.length} 条，只读`), detailItems(detail.result)) : null))
            : side('如何使用处理结果', h(React.Fragment, null,
              h('p', { style: styles.meta }, noItems ? '当前分类未提取出可用内容。核对原文与资料分类后可重新处理。' : '提取成功后，可在详情中核对内容。历史缺陷经审核后才能进入新分析。'),
              noItems && state?.features?.metadata !== false ? h('button', { type: 'button', style: styles.button, onClick: event => startEdit(asset, event) }, '编辑资料分类') : null)))
        const title = failed ? '处理未完成，原材料已保留' : attention ? '提取结果需要修正' : noItems ? '这份材料未提取出可用内容' : '正在提取资料中的可用内容'
        const processCopy = failed ? '本次提取未能完整保存结果。可以查看失败记录，调整处理设置后重新尝试。' : attention ? '提取内容与资料分类尚未一致。可在原会话继续修正，或发起新的处理。' : noItems ? '核对原文与资料分类后，可以调整信息并重新处理；原始材料仍然保留。' : '原始材料已经保存。正在整理可用内容并保留出处。'
        const processMain = h('div', null,
          h('section', { className: 'pangea-asset-process-hero' },
            h('div', { style: styles.row },
              h('span', { className: 'pangea-asset-process-symbol', 'aria-hidden': true }, assetFileIcon(failed ? 'failed' : attention ? 'design' : noItems ? 'requirement' : asset.asset_type)),
              h('span', { className: 'pangea-asset-detail-badges' }, h('span', { className: failed ? 'is-error' : attention || noItems ? 'is-warn' : '' }, noItems ? '无可用内容' : jobLabel[assetJob?.status] ?? STATUS[asset.status] ?? asset.status))),
            h('h2', null, title), h('p', null, processCopy),
            h('div', { className: 'pangea-asset-process-steps' },
              h('div', { className: 'done' }, '01 · 读取材料', h('small', null, asset.source_path ? '文件已保存' : '等待文件')),
              h('div', { className: noItems ? 'done' : 'active' }, '02 · 提取内容', h('small', null, failed ? '本次未完成' : attention ? '等待修正' : noItems ? '已完成检查' : jobLabel[assetJob?.status] ?? '当前进行中')),
              h('div', null, '03 · 保存与核对', h('small', null, noItems ? '0 条可用内容' : '等待提取完成'))),
            h('div', { style: styles.wrap },
              attention ? h('button', { type: 'button', disabled: busy, style: { ...styles.button, ...styles.primary }, onClick: () => { void act('extract', { asset_id: assetId, provider_id: assetJob.provider_id, ...(assetJob.provider_id ? { agent_model: assetJob.model } : { model_route: assetJob.model }) }) } }, '原会话继续修正') : null,
              failed || attention || noItems ? h('button', { type: 'button', disabled: busy, style: failed ? { ...styles.button, ...styles.primary } : styles.button, onClick: restart }, '重新处理资产') : h('button', { type: 'button', disabled: detailLoading, style: styles.button, onClick: () => { void toggle(assetId, true) } }, '刷新状态'),
              failed && detail?.failure_record ? h('button', { type: 'button', style: styles.button, onClick: () => downloadFailureRecord(detail) }, '下载失败记录') : null)),
          failed && items.length ? h('div', { className: 'pangea-asset-detail-callout is-blue', style: { marginTop: 18 } }, h('div', null, h('strong', null, '已有结果可继续查阅'), h('p', null, `上一次保存的 ${items.length} 条内容仍保留；本次失败记录与新的尝试分别显示。`))) : null,
          noItems ? h('section', { className: 'pangea-asset-detail-panel', style: { marginTop: 18 } }, h('h3', null, '处理结论与原文'), h('p', null, '当前分类未提取出可用条目。这不代表原始材料没有参考价值。'), detail?.normalized_preview ? h('details', { open: true }, h('summary', null, '原文件内容'), h('div', { className: 'pangea-asset-detail-source-note' }, detail.normalized_preview)) : null)
            : failed ? null : h('section', { className: 'pangea-asset-detail-panel', style: { marginTop: 18, minHeight: 270 } }, h('h3', null, '当前处理记录'), detailLog(assetJob)))
        const historyView = h('div', { className: 'pangea-asset-detail-grid' }, side('处理记录', h(React.Fragment, null,
          h('div', { style: styles.row }, h('strong', null, `最近处理 · ${jobLabel[assetJob?.status] ?? '暂无记录'}`)), detailLog(assetJob),
          (assetJob?.history ?? []).map((record, index) => h('details', { key: index, open: index === 0, style: { marginTop: 24, borderTop: '1px solid #e5e7e4', paddingTop: 18 } },
            h('summary', null, `${assetTime(record.started_at)} · 历史处理`),
            h('div', { className: 'pangea-asset-history-record' },
              h('div', { style: styles.row }, h('strong', null, ['failed', 'interrupted'].includes(record.status) ? '处理未完成' : jobLabel[record.status] ?? record.status),
                h('span', { className: 'pangea-asset-detail-badges' }, h('span', { className: ['failed', 'interrupted'].includes(record.status) ? 'is-warn' : '' }, record.error || jobLabel[record.status] || record.status))),
              h('p', null, ['failed', 'interrupted'].includes(record.status) ? '本次处理记录已保留，完成前未保存新的提取结果。' : '本次处理记录已保留，可与当前结果核对。')))))),
          h('aside', { className: 'pangea-asset-detail-side' }, side('记录与修订', h(React.Fragment, null, h('p', { style: styles.meta }, '这里展示每次提取的处理记录。当前可用内容以最新结果为准。'), h('button', { type: 'button', style: styles.button, onClick: () => setDetailTab('content') }, '查看当前提取内容')))))
        if (!processState && !stale && detailTab === 'content' && ['requirement', 'reference', 'test_case_example'].includes(asset.asset_type)) {
          const sourceNote = item => item.source_references ? h('div', { className: 'pangea-asset-detail-source-note' }, `原文出处 · ${readable(item.source_references)}`) : null
          const facts = item => Array.isArray(item.key_facts) ? item.key_facts.map(readable).join('；') : readable(item.key_facts ?? item.summary ?? '')
          const requirement = item => h(React.Fragment, null, detailPairs([['输入', readable(item.inputs) || '待确认'], ['输出', readable(item.outputs) || '待确认'], ['约束', readable(item.constraints) || '待确认'], ['验收条件', readable(item.acceptance_criteria) || '待确认']]), sourceNote(item))
          const example = item => {
            const steps = Array.isArray(item.steps) ? item.steps : item.steps ? [item.steps] : []
            const results = Array.isArray(item.expected_results) ? item.expected_results : item.expected_results ? [item.expected_results] : []
            return h(React.Fragment, null,
              detailPairs([['前置条件', readable(item.preconditions) || '待确认'], ['关联问题', readable(item.related_problems) || '未提供']]),
              h('div', { className: 'pangea-b07-example-table' }, h('table', null, h('thead', null, h('tr', null, ['步骤', '操作', '预期结果'].map(label => h('th', { key: label }, label)))), h('tbody', null, Array.from({ length: Math.max(steps.length, results.length) }, (_, index) => h('tr', { key: index }, h('td', null, String(index + 1).padStart(2, '0')), h('td', null, readable(steps[index]) || '待确认'), h('td', null, readable(results[index]) || '待确认')))))), sourceNote(item))
          }
          const content = asset.asset_type === 'reference'
            ? h('section', { className: 'pangea-asset-detail-panel pangea-b07-reference' }, h('h3', null, '提取的关键事实'), items.map(item => h('div', { key: item.item_id, className: 'pangea-b07-fact' }, h('h4', null, `${item.item_id ?? '条目'} · ${item.title ?? '未命名事实'}`), h('p', null, facts(item) || '原文未提供关键事实。'), sourceNote(item))))
            : h(React.Fragment, null, items.map((item, index) => index === 0
              ? h('section', { key: item.item_id ?? index, className: 'pangea-asset-detail-panel pangea-b07-structured' }, h('div', { className: 'pangea-b07-structured-title' }, h('h3', null, `${item.item_id ?? '条目'} · ${item.title ?? '未命名内容'}`), asset.asset_type === 'test_case_example' ? h('span', { className: 'pangea-b08-badge' }, '示例用例') : null), asset.asset_type === 'requirement' ? requirement(item) : example(item))
              : h('details', { key: item.item_id ?? index, className: 'pangea-b07-structured-collapsed' }, h('summary', null, `${item.item_id ?? `条目 ${index + 1}`} · ${item.title ?? '未命名内容'}`), asset.asset_type === 'requirement' ? requirement(item) : example(item))),
              asset.asset_type === 'test_case_example' ? h('div', { className: 'pangea-asset-detail-callout is-blue pangea-b07-example-note' }, h('div', null, h('strong', null, '保留示例中的测试表达'), h('p', null, '这些条目来自导入的用例资料，可为新分析提供步骤与预期结果参考。'))) : null)
          return h('section', { className: 'pangea-asset-detail', 'aria-label': '资产详情' },
            h('div', { className: 'pangea-asset-detail-top' }, h('div', null, h('div', { className: 'pangea-asset-detail-badges' }, h('span', null, assetTypeLabel), h('span', { className: 'is-good' }, '可用于分析'), `修订 r${asset.revision ?? 1}`), h('h2', null, asset.title), h('div', { style: styles.meta }, `${filename} · ${(asset.repository_ids ?? []).join('、') || '未限定仓库'} / ${(asset.module_tags ?? []).join('、') || '未限定模块'} · ${items.length} 条提取内容`)),
              usable ? h('button', { type: 'button', style: styles.button, onClick: () => ctx.pangea?.requestRunCreation?.(scope, { assetIds: [assetId] }) }, '用于新分析') : null),
            h('div', { className: 'pangea-asset-detail-grid' }, h('div', { className: 'pangea-b07-structured-stack' }, content),
              h('aside', { className: 'pangea-asset-detail-side' }, side('原始材料与来源', h(React.Fragment, null, h('strong', null, filename), h('p', { style: styles.meta }, `当前修订 r${asset.revision ?? 1}`), h('details', { open: true, className: 'pangea-b07-source-preview' }, h('summary', null, '原文件内容'), detail?.normalized_preview ? normalizedSource(detail.normalized_preview) : h('p', null, '当前修订没有可显示的规范化原文。')), h('hr'), detailPairs([['关联仓库', (asset.repository_ids ?? []).join('、') || '未设置'], ['模块', (asset.module_tags ?? []).join('、') || '未设置'], ['语言', (asset.language_tags ?? []).join('、') || '未设置']]))))), detailEditDialog(asset))
        }
        return h('section', { className: 'pangea-asset-detail', 'aria-label': '资产详情' },
          !processState ? h('div', { className: 'pangea-asset-detail-top' }, h('div', null,
            h('div', { className: 'pangea-asset-detail-badges' }, h('span', null, assetTypeLabel), h('span', { className: stale ? 'is-warn' : asset.status === 'available' ? 'is-good' : '' }, stale ? '需要重新处理' : STATUS[asset.status] ?? asset.status), `修订 r${asset.revision ?? 1}`),
            h('h2', null, asset.title), h('div', { style: styles.meta }, `${filename} · ${(asset.repository_ids ?? []).join('、') || '未限定仓库'} / ${(asset.module_tags ?? []).join('、') || '未限定模块'} · ${assetTime(asset.updated_at)} 更新`)),
            usable ? h('button', { type: 'button', style: styles.button, onClick: () => ctx.pangea?.requestRunCreation?.(scope, { assetIds: [assetId] }) }, '用于新分析') : null) : null,
          stale ? h('div', { className: 'pangea-asset-detail-callout' }, h('div', null, h('strong', null, '提取内容需要更新'), h('p', null, '资料分类已变化。原提取内容保留供查阅，重新处理后才能作为新的分析输入。')),
            h('button', { type: 'button', disabled: busy, style: { ...styles.button, ...styles.primary }, onClick: restart }, '重新处理')) : null,
          detailTab === 'history' ? historyView : processState ? h('div', { className: 'pangea-asset-detail-grid' }, processMain, processingSide) : h('div', { className: 'pangea-asset-detail-grid' },
            h('div', { className: 'pangea-asset-detail-panel' },
              !stale && asset.asset_type !== 'coverage' ? h('nav', { className: 'pangea-asset-detail-subtabs', 'aria-label': '资产详情视图' }, [['content', `提取内容 · ${items.length}`], ['source', '原始材料'], ['version', '文件与修订']].map(([value, label]) => h('button', { key: value, type: 'button', 'aria-current': detailTab === value ? 'page' : undefined, onClick: () => setDetailTab(value) }, label))) : null,
              detailTab === 'source' ? h(React.Fragment, null,
                  h('div', { style: styles.row }, h('span', { style: styles.meta }, filename), h('span', { className: 'pangea-asset-detail-badges' }, h('span', null, '已规范化文本'))),
                  detail?.normalized_preview ? h(React.Fragment, null, normalizedSource(detail.normalized_preview), h('div', { className: 'pangea-asset-detail-source-note' }, `原始材料的规范化内容，与当前修订 r${asset.revision ?? 1} 的提取结果对应。`)) : h('p', { role: 'status' }, '当前修订没有可显示的规范化原文。'))
                : detailTab === 'version' ? h(React.Fragment, null, h('h3', null, '当前材料与内容版本'), detailPairs([['资产编号', assetId], ['当前修订', `r${asset.revision ?? 1} · 分析输入版本 ${detail?.asset?.input_revision ?? '未提供'}`], ['原始文件', filename], ['资料位置', asset.source_path], ['关联仓库', (asset.repository_ids ?? []).join('、') || '未设置'], ['模块标签', (asset.module_tags ?? []).join('、') || '未设置'], ['语言标签', (asset.language_tags ?? []).join('、') || '未设置'], ['最后更新', assetTime(asset.updated_at)]]), h('div', { className: 'pangea-asset-detail-callout is-blue', style: { marginTop: 24 } }, h('div', null, h('strong', null, '在创建分析时绑定版本'), h('p', null, '新分析冻结当前资产输入版本。已有 Run 按各自冻结输入查看。'))))
                  : asset.asset_type === 'coverage' ? h(React.Fragment, null, h('div', { style: styles.row }, h('h3', null, '覆盖率记录'), h('span', { style: styles.meta }, '导入文件中的执行次数')), detailCoverageTable(detail?.result ?? {}), h('div', { className: 'pangea-asset-detail-callout is-blue', style: { marginTop: 18 } }, h('div', null, h('strong', null, '数值来自所导入的覆盖率资料'), h('p', null, '0 次执行保留为有效记录；与特定 Run 的版本是否适配，需要在分析时核对。'))))
                    : h(React.Fragment, null, stale ? h('div', { className: 'pangea-asset-stale-content-heading' }, h('h3', null, '上一次提取内容'), h('span', { className: 'pangea-asset-detail-badges' }, h('span', null, '旧成果 · 只读'))) : h('div', { style: styles.meta, marginBottom: 18 }, `${items.length} 条${assetTypeLabel}内容 · 每项保留原文出处`), !items.length && detail?.result?.summary ? h('p', null, detail.result.summary) : null, detail?.result ? detailItems(detail.result) : h('p', { role: 'status' }, detailLoading ? '正在加载资产详情…' : '尚无提取内容。'))),
            h('aside', { className: 'pangea-asset-detail-side' }, detailTab === 'source' ? side('从原文到分析输入', h(React.Fragment, null,
                h('ol', { className: 'pangea-asset-detail-log' }, [['原始材料', filename], ['当前资产修订', `r${asset.revision ?? 1} · ${assetTime(asset.updated_at)}`], ['提取结果', `${items.length} 条${assetTypeLabel}内容`]].map(([label, value]) => h('li', { key: label }, h('time', null, label), value))),
                h('button', { type: 'button', style: { ...styles.button, marginTop: 18 }, onClick: () => setDetailTab('content') }, '返回提取内容')))
              : detailTab === 'version' ? side('材料与提取结果', h(React.Fragment, null,
                  h('div', { style: { display: 'grid', placeItems: 'center', width: 34, height: 38, margin: '13px 0 17px', border: '1px solid #dce6d3', borderRadius: 7, color: '#82966e' } }, assetFileIcon(asset.asset_type)),
                  h('h3', { style: { marginBottom: 10 } }, '一个可追溯的来源'),
                  h('p', { style: { ...styles.meta, lineHeight: 1.8 } }, '资产保存原始材料、资料信息与提取结果。沿着原文出处，可以回到当前修订的资料。'),
                  h('hr', { style: { border: 0, borderTop: '1px solid #e5e7e4', margin: '17px 0' } }),
                  h('button', { type: 'button', style: styles.button, onClick: () => setDetailTab('source') }, '查看原始材料')))
                : stale ? side('当前资料信息', detailPairs([['资料分类', assetTypeLabel], ['内容状态', '等待重新处理'], ['上次结果', `${items.length} 条内容`]]))
                  : asset.asset_type === 'coverage' ? h(React.Fragment, null, sourceAndRevision, side('处理完成', h(React.Fragment, null, detailLog(assetJob), detail?.normalization ? h('details', null, h('summary', null, '解析信息与字段映射'), h('pre', { style: styles.pre }, JSON.stringify(detail.normalization, null, 2))) : null)))
                    : h(React.Fragment, null, side('处理记录', h(React.Fragment, null, h('strong', null, jobLabel[assetJob?.status] ?? '暂无处理记录'), detailLog(assetJob), h('button', { type: 'button', style: styles.button, onClick: () => setDetailTab('history') }, '查看处理历史'), h('details', { style: { marginTop: 16 } }, h('summary', null, '重新处理设置'), processingSettings), h('button', { type: 'button', disabled: busy, style: { ...styles.button, marginTop: 12 }, onClick: restart }, '重新处理'))), side('资产关联', detailPairs([['仓库', (asset.repository_ids ?? []).join('、') || '未设置'], ['模块', (asset.module_tags ?? []).join('、') || '未设置'], ['语言', (asset.language_tags ?? []).join('、') || '未设置'], ['当前修订', `r${asset.revision ?? 1}`]]))))),
          detailEditDialog(asset))
      }
      function b08View() {
        const badge = (label, tone = '') => h('span', { className: `pangea-b08-badge ${tone}` }, label)
        const intro = (title, copy, trailing) => h('div', { className: 'pangea-b08-intro' }, h('div', null, h('h2', null, title), h('p', null, copy)), trailing)
        const empty = (title, copy, label, action) => h('div', { className: 'pangea-b08-empty' }, h('span', { className: 'pangea-asset-empty-icon', 'aria-hidden': true }, emptyIcon()), h('h2', null, title), h('p', null, copy), h('button', { type: 'button', className: 'pangea-b08-primary', onClick: action }, label))
        const asset = activeAsset
        const detail = asset ? details[asset.asset_id] : null
        if (section === 'review') {
          const reviewAssets = assets.filter(item => item.asset_type === 'historical_defect' && item.status === 'awaiting_review')
          if (!asset) return reviewAssets.length ? h(React.Fragment, null,
            intro('核对历史缺陷，再用于分析', '保留原文与提取依据，让通过审核的内容成为可用资产。', badge(`${pagination.total} 份资料待审核`, 'warn')),
            reviewAssets.map(item => h('article', { key: item.asset_id, className: 'pangea-b08-review-row' },
              h('div', { className: 'pangea-b08-row-top' }, h('span', { className: 'pangea-asset-filemark', 'aria-hidden': true }, assetFileIcon(item.asset_type)),
                h('div', { className: 'pangea-b08-row-title' }, h('h3', null, item.title), h('p', null, `${item.source_name || '未提供文件名'} · ${(item.repository_ids ?? []).join('、') || '未限定仓库'} / ${(item.module_tags ?? []).join('、') || '未限定模块'} · 修订 r${item.revision ?? 1}`)),
                h('button', { type: 'button', className: 'pangea-b08-primary', onClick: () => { void toggle(item.asset_id) } }, '查看并审核')),
              h('div', { className: 'pangea-b08-stats' }, [['提取条目', item.structured_item_count ?? 0, '等待人工确认'], ['原始材料', item.source_path ? '1 份' : '未提供', item.source_path ? '文件已保存' : '未记录文件'], ['当前用途', '待审核', '暂不作为新分析输入']].map(([label, value, hint]) => h('div', { key: label }, h('span', null, label), h('strong', null, value), h('small', null, hint)))))))
            : empty('当前没有待审核资产', '历史缺陷提取完成后会进入这里。已审核通过的资料可在资产库中选用。', '浏览资产库', () => navigate('library'))
          const reviewed = reviewItemsFor(asset.asset_id, detail)
          const approved = asset.status === 'available' && !asset.result_stale
          const rejected = asset.status === 'rejected'
          const pending = asset.status === 'awaiting_review'
          return h(React.Fragment, null,
            h('div', { className: 'pangea-b08-detail-top' }, h('div', null,
              h('div', { className: 'pangea-b08-badges' }, badge('历史缺陷'), badge(approved ? '可用于分析' : rejected ? '已拒绝' : '待人工审核', approved ? 'good' : pending ? 'warn' : ''), h('span', null, `r${asset.revision ?? 1}`)),
              h('h2', null, asset.title), h('p', null, `${asset.source_name || '未提供文件名'} · ${structuredItems(detail?.result).length} 条提取内容 · 已保留原文出处`)),
              approved ? h('div', { style: styles.wrap },
                h('button', { type: 'button', style: styles.button, disabled: !detail?.asset?.input_revision || !ctx.pangea?.requestRunCreation, onClick: () => ctx.pangea.requestRunCreation(scope, { assetIds: [asset.asset_id] }) }, '用于新分析'),
                h('button', { type: 'button', className: 'pangea-b08-primary', disabled: busy, onClick: () => { void act('generate_methodology', { asset_ids: [asset.asset_id] }) } }, '生成方法论候选'))
                : rejected ? h('button', { type: 'button', disabled: busy, style: styles.button, onClick: () => { void act('extract', { asset_id: asset.asset_id, restart: true }) } }, '重新处理') : null),
            rejected ? h('div', { className: 'pangea-asset-detail-callout' }, h('div', null, h('strong', null, '本次提取内容已拒绝'), h('p', null, '内容仍可查阅；核对原文件或调整分类后，可以重新处理。'))) : null,
            approved ? h('div', { className: 'pangea-asset-detail-callout is-blue' }, h('div', null, h('strong', null, '审核结果已保存'), h('p', null, '接受的内容可用于新分析，也可继续整理为方法论检查项。'))) : null,
            h('div', { className: 'pangea-asset-detail-grid' }, h('div', null,
              reviewed.map(item => h('section', { key: item.item_id, className: 'pangea-b08-review-item' },
                h('div', { className: 'pangea-b08-row-top' }, h('h3', null, `${item.item_id} · ${item.title ?? '未命名缺陷'}`), badge(item.decision === 'accepted' ? '已接受' : item.decision === 'rejected' ? '已拒绝' : '待定', item.decision === 'accepted' ? 'good' : item.decision === 'pending' ? 'warn' : '')),
                detailPairs([['问题表现', item.symptom ?? '未提供'], ['问题机理', item.defect_mechanism ?? '未提供']]),
                item.source_references ? h('div', { className: 'pangea-asset-detail-source-note' }, `原文出处 · ${readable(item.source_references)}`) : null,
                pending && state?.features?.item_review !== false ? h('div', { className: 'pangea-b08-review-fields' },
                  h('label', null, '审核结论', h('select', { 'aria-label': `审核状态 ${item.item_id}`, value: item.decision, onChange: event => updateReviewDraft(asset.asset_id, item.item_id, 'decision', event.target.value) }, [['pending', '待定'], ['accepted', '接受'], ['rejected', '拒绝']].map(([value, label]) => h('option', { key: value, value }, label)))),
                  h('label', null, '审核备注 · 可选', h('input', { 'aria-label': `审核备注 ${item.item_id}`, value: item.note ?? '', placeholder: '接受、拒绝或保留疑问的原因', onChange: event => updateReviewDraft(asset.asset_id, item.item_id, 'note', event.target.value) }))) : null)),
              pending && state?.features?.item_review !== false ? h('div', { className: 'pangea-b08-review-foot' }, h('span', null, `待审核 ${reviewed.filter(item => item.decision === 'pending').length} · 已接受 ${reviewed.filter(item => item.decision === 'accepted').length} · 已拒绝 ${reviewed.filter(item => item.decision === 'rejected').length}`), h('button', { type: 'button', disabled: busy || !detail?.review, style: styles.button, onClick: () => { void saveReviewItems(asset.asset_id, detail) } }, '保存逐条审核')) : null),
              h('aside', { className: 'pangea-asset-detail-side' },
                h('section', { className: 'pangea-asset-detail-panel' }, h('h3', null, '审核依据'), h('strong', null, asset.source_name || '原始材料'), detail?.normalized_preview ? h('p', { className: 'pangea-b08-source-preview' }, detail.normalized_preview) : h('p', null, '未提供原文预览。'), h('details', null, h('summary', null, '展开原文件内容'), detail?.normalized_preview ? normalizedSource(detail.normalized_preview) : null)),
                pending ? h('section', { className: 'pangea-asset-detail-panel' }, h('h3', null, '整份资料审核'), h('p', null, '整份提取结果已核对时，可直接通过或拒绝本次内容。'), h('div', { style: styles.wrap }, h('button', { type: 'button', disabled: busy, className: 'pangea-b08-primary', onClick: () => { void act('review', { asset_id: asset.asset_id, decision: 'approve' }) } }, '审核通过'), h('button', { type: 'button', disabled: busy, style: styles.button, onClick: () => { void act('review', { asset_id: asset.asset_id, decision: 'reject' }) } }, '拒绝')))
                  : h('section', { className: 'pangea-asset-detail-panel' }, h('h3', null, '资料状态'), detailPairs([['已核对修订', `r${asset.revision ?? 1}`], ['审核结果', approved ? '已通过' : '已拒绝'], ['新分析选用', approved && detail?.asset?.input_revision ? '可以选用' : '暂不可选用']])))))
        }
        if (section === 'archived') {
          const archivedAssets = assets.filter(item => item.status === 'archived')
          if (!asset) return h(React.Fragment, null,
            intro('保留材料，整理当前资产库', '归档资料仍可查阅，恢复后按原有处理状态重新进入资产库。', badge(`${pagination.total} 个已归档`)),
            h('div', { className: 'pangea-b08-archive-toolbar' }, h('form', { onSubmit: event => { event.preventDefault(); setPage(1); setQuery(queryDraft.trim()) } }, h('input', { type: 'search', 'aria-label': '搜索已归档资产', placeholder: '搜索归档资料…', value: queryDraft, onChange: event => setQueryDraft(event.target.value) })), h('span', null, '按最近更新时间排列')),
            archivedAssets.length ? h('div', { className: 'pangea-b08-archive-table' }, h('table', { 'aria-label': '已归档资产' }, h('thead', null, h('tr', null, ['资产与原始材料', '类型', '归档前状态', '当前修订', ''].map(label => h('th', { key: label }, label)))), h('tbody', null, archivedAssets.map(item => h('tr', { key: item.asset_id }, h('td', null, h('span', { className: 'pangea-asset-filemark', 'aria-hidden': true }, assetFileIcon(item.asset_type)), h('span', null, h('button', { type: 'button', onClick: () => { void toggle(item.asset_id) } }, item.title), h('small', null, `${item.source_name || '未提供文件名'} · ${(item.repository_ids ?? []).join('、') || '未限定仓库'}`))), h('td', null, TYPES.find(([value]) => value === item.asset_type)?.[1] ?? item.asset_type), h('td', null, STATUS[item.previous_status] ?? item.previous_status ?? '未提供'), h('td', null, `r${item.revision ?? 1}`), h('td', null, h('button', { type: 'button', style: styles.button, onClick: () => { void toggle(item.asset_id) } }, '查看与恢复'))))))) : h('p', { role: 'status' }, query ? '没有符合条件的归档资料。' : '没有已归档资产。'),
            h('p', { className: 'pangea-b08-note' }, '原始材料、已保存内容与引用关系随资产保留。'))
          return h(React.Fragment, null,
            h('div', { className: 'pangea-b08-detail-top' }, h('div', null, h('div', { className: 'pangea-b08-badges' }, badge(TYPES.find(([value]) => value === asset.asset_type)?.[1] ?? asset.asset_type), badge('已归档'), h('span', null, `r${asset.revision ?? 1}`)), h('h2', null, asset.title), h('p', null, `${asset.source_name || '未提供文件名'} · ${(asset.repository_ids ?? []).join('、') || '未限定仓库'}`))),
            h('div', { className: 'pangea-asset-detail-callout is-blue' }, h('div', null, h('strong', null, '这份资料已归档'), h('p', null, '恢复后会重新出现在资产库，可按原有状态继续使用。')), h('button', { type: 'button', disabled: busy || state?.features?.restore === false, title: state?.features?.restore === false ? '当前分析引擎尚未提供恢复操作' : undefined, className: 'pangea-b08-primary', onClick: () => { void act('restore', { asset_id: asset.asset_id }) } }, '恢复资产')),
            state?.features?.restore === false ? h('p', { role: 'status' }, '当前分析引擎尚未提供恢复操作。') : null,
            h('div', { className: 'pangea-asset-detail-grid' }, h('div', { className: 'pangea-asset-detail-panel' }, h('div', { className: 'pangea-b08-row-top' }, h('h3', null, '归档前保存的内容'), badge(`${structuredItems(detail?.result).length} 条内容`)), detail?.result ? detailItems(detail.result) : h('p', null, '尚无保存的内容。')),
              h('aside', { className: 'pangea-asset-detail-side' }, h('section', { className: 'pangea-asset-detail-panel' }, h('h3', null, '保留的资料关系'), detailPairs([['原始材料', asset.source_name || '未提供'], ['当前修订', `r${asset.revision ?? 1}`], ['归档前状态', STATUS[asset.previous_status] ?? asset.previous_status ?? '未提供'], ['关联仓库', (asset.repository_ids ?? []).join('、') || '未设置'], ['模块', (asset.module_tags ?? []).join('、') || '未设置']])))))
        }
        const generation = state?.methodologies?.generation_job
        const method = methodologies.find(item => item.methodology_id === expandedMethodology)
        const methodDetail = method ? { ...method, ...(methodologyDetails[method.methodology_id] ?? {}), status: method.status } : null
        const sourceSummary = ids => (ids ?? []).map(id => {
          const source = methodologySources[id]
          return source?.asset ? `${source.asset.title}${source.asset.source_name ? ` · ${source.asset.source_name}` : ''}` : id
        }).join('、') || '未提供来源资产'
        const sourceItems = ids => (ids ?? []).map((id, index) => {
          const item = Object.values(methodologySources).flatMap(source => structuredItems(source.result)).find(entry => entry.item_id === id)
          return [id, item?.title ? `${item.title}${item.symptom ? ` · ${item.symptom}` : ''}` : id]
        })
        const chooseDefect = () => { navigate('library'); setType('historical_defect'); setStatus('available') }
        if (generation && ['queued', 'running', 'finalizing'].includes(generation.status)) return h('div', { className: 'pangea-asset-detail-grid' },
          h('section', { className: 'pangea-asset-process-hero' }, h('div', { className: 'pangea-b08-process-top' }, h('span', { className: 'pangea-asset-process-symbol' }, '✧'), badge(jobLabel[generation.status] ?? generation.status, 'blue')), h('h2', null, '把已确认的历史问题整理为检查项'), h('p', null, '正在核对适用条件、检查内容与来源条目。完成后会形成方法论候选，供你确认并启用。'), h('div', { className: 'pangea-asset-process-steps' }, h('div', { className: 'done' }, '01 · 已审核输入', h('small', null, `${(generation.source_item_ids ?? []).length || (generation.source_asset_ids ?? []).length} 个来源条目`)), h('div', { className: 'active' }, '02 · 整理检查内容', h('small', null, '当前进行中')), h('div', null, '03 · 确认启用', h('small', null, '等待内容完成'))), h('div', { style: styles.wrap }, generation.session_id ? h('button', { type: 'button', style: styles.button, onClick: () => { void openAnalysisSession(ctx.sessions, generation.session_id) } }, '打开处理会话') : null, h('button', { type: 'button', disabled: loading, style: styles.button, onClick: () => { void load() } }, '刷新状态'))),
          h('aside', { className: 'pangea-asset-detail-side' }, h('section', { className: 'pangea-asset-detail-panel' }, h('h3', null, '本次来源'), h('p', null, sourceSummary(generation.source_asset_ids)), detailPairs([...sourceItems(generation.source_item_ids), ['审核状态', '已通过'], ['处理状态', jobLabel[generation.status] ?? generation.status]])), h('section', { className: 'pangea-asset-detail-panel' }, h('h3', null, '已有方法论'), h('p', null, '生成过程独立记录，已启用的内容继续用于后续分析。'))))
        if (method) return h(React.Fragment, null,
          h('div', { className: 'pangea-b08-detail-top' }, h('div', null, h('div', { className: 'pangea-b08-badges' }, badge('用户方法论'), badge(METHODOLOGY_STATUS[method.status] ?? method.status, method.status === 'enabled' ? 'good' : method.status === 'candidate' ? 'warn' : '')), h('h2', null, method.title), h('p', null, `${(methodDetail.checks ?? []).length} 项检查 · ${(methodDetail.source_item_ids ?? []).length} 个来源条目`)), h('button', { type: 'button', disabled: busy, className: method.status === 'enabled' ? '' : 'pangea-b08-primary', style: method.status === 'enabled' ? styles.button : undefined, onClick: () => { void act(method.status === 'enabled' ? 'disable_methodology' : 'enable_methodology', { methodology_id: method.methodology_id }) } }, method.status === 'enabled' ? '停用方法论' : '启用方法论')),
          h('div', { className: `pangea-asset-detail-callout ${method.status === 'candidate' ? 'is-warn' : 'is-blue'}` }, h('div', null, h('strong', null, method.status === 'enabled' ? '已用于后续新分析' : method.status === 'disabled' ? '已停止用于后续新分析' : '先核对检查内容，再确认启用'), h('p', null, method.status === 'enabled' ? '适用条件匹配时，这组检查项会作为新的分析输入。已有 Run 保留其冻结版本。' : method.status === 'disabled' ? '内容与来源仍可查看。需要继续使用时，可重新启用。' : '确认适用条件与来源记录后，将这组检查项加入后续分析。'))),
          h('div', { className: 'pangea-asset-detail-grid' }, h('section', { className: 'pangea-asset-detail-panel' }, h('h3', null, '适用条件'), (methodDetail.applicable_when ?? []).length ? h('ul', null, methodDetail.applicable_when.map((item, index) => h('li', { key: index }, item))) : h('p', null, '未提供适用条件。'), h('hr'), h('h3', null, '检查项'), h('ol', { className: 'pangea-b08-checklist' }, (methodDetail.checks ?? []).map((item, index) => h('li', { key: index }, h('strong', null, String(index + 1).padStart(2, '0')), h('span', null, typeof item === 'string' ? item : h(React.Fragment, null, item.title ? h('strong', { className: 'pangea-b08-check-title' }, item.title) : null, h('span', null, item.description ?? item.text ?? item.content ?? '未提供检查说明'))))))),
            h('aside', { className: 'pangea-asset-detail-side' }, h('section', { className: 'pangea-asset-detail-panel' }, h('h3', null, '来源与依据'), h('p', null, sourceSummary(methodDetail.source_asset_ids)), h('p', { className: 'pangea-b08-source-status' }, '已审核来源'), detailPairs(sourceItems(methodDetail.source_item_ids))), h('section', { className: 'pangea-asset-detail-panel' }, h('h3', null, '版本如何使用'), h('p', null, '启用状态影响后续分析。内容变化后需要重新确认，已有 Run 继续展示其当时冻结的版本。')))))
        if (!methodologies.length) return h(React.Fragment, null, empty('从历史问题中积累检查经验', '选择已审核通过的历史缺陷，整理适用条件与检查项，再确认启用。', '选择历史缺陷', chooseDefect), h('div', { className: 'pangea-b08-empty-steps' }, [['清晰的适用条件', '说明在哪类代码与场景中使用。'], ['可核对的检查项', '将历史经验转成具体检查内容。'], ['保留来源关系', '每组检查项可回到原始缺陷记录。']].map(([heading, text]) => h('section', { key: heading, className: 'pangea-asset-detail-panel' }, h('h3', null, heading), h('p', null, text)))))
        return h(React.Fragment, null,
          intro('把已确认的问题，变成下一次检查', '从已审核的历史缺陷整理检查项，确认启用后用于新的分析。', h('button', { type: 'button', style: styles.button, onClick: chooseDefect }, '选择历史缺陷')),
          h('div', { className: 'pangea-b08-method-grid' }, methodologies.map(item => h('article', { key: item.methodology_id, className: 'pangea-b08-method-card' }, h('div', { className: 'pangea-b08-row-top' }, h('span', { className: 'pangea-asset-filemark' }, '☷'), badge(METHODOLOGY_STATUS[item.status] ?? item.status, item.status === 'enabled' ? 'good' : item.status === 'candidate' ? 'warn' : '')), h('h3', null, item.title), h('p', null, item.summary ?? item.description ?? '核对适用条件、检查项与来源。'), h('hr'), h('p', null, `${(item.source_item_ids ?? []).length} 个来源条目 · ${(item.checks ?? []).length} 项检查`), h('div', { style: styles.wrap }, h('button', { type: 'button', style: styles.button, onClick: () => { void toggleMethodology(item.methodology_id) } }, '查看详情'), h('button', { type: 'button', disabled: busy, className: item.status === 'candidate' ? 'pangea-b08-primary' : '', style: item.status === 'candidate' ? undefined : styles.button, onClick: () => { void act(item.status === 'enabled' ? 'disable_methodology' : 'enable_methodology', { methodology_id: item.methodology_id }) } }, item.status === 'enabled' ? '停用' : '启用'))))),
          h('div', { className: 'pangea-asset-detail-callout is-blue' }, h('div', null, h('strong', null, '内容与启用状态分别确认'), h('p', null, '方法论内容更新后会回到待启用状态；已有分析保留其冻结版本。'))))
      }
      return h('div', { className: 'pangea-asset-root', style: styles.root, role: 'region', 'aria-label': 'PANGEA 资产管理' },
        h('style', null, `
          .pangea-asset-root{container-type:inline-size;container-name:pangea-assets}
          .pangea-asset-root *{box-sizing:border-box}
          .pangea-asset-layout{display:grid;grid-template-columns:minmax(0,1fr);min-height:100%}
          .pangea-asset-layout.has-assistant{grid-template-columns:minmax(0,1fr) 310px;column-gap:24px}
          .pangea-asset-layout.is-importing{margin-right:31px}
          .pangea-asset-layout.is-importing .pangea-asset-header{width:calc(100% + 334px)}
          .pangea-asset-layout.is-importing .pangea-asset-content{padding-right:0!important}
          .pangea-asset-layout.is-importing .pangea-asset-assistant{position:static;align-self:start;max-height:none;margin-top:217px;padding:22px;border:1px solid #e5e7e4;border-radius:10px;background:#fff}
          .pangea-asset-content{width:100%}
          .pangea-asset-assistant{padding:24px;border-left:1px solid var(--dsw-alias-border-l2,#dce1e7);position:sticky;top:0;align-self:start;max-height:100vh;overflow:auto;background:var(--dsw-alias-bg-layer-1,#fff)}
          .pangea-asset-detail{margin-right:1px}
          .pangea-asset-detail-top{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px}
          .pangea-asset-detail-top h2{font-size:23px;line-height:1.4;margin:13px 0 4px;color:#24282d}
          .pangea-asset-detail-grid{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:24px;align-items:start}
          .pangea-asset-detail-panel{min-width:0;padding:25px 26px;border:1px solid #e1e5df;border-radius:10px;background:#fff}
          .pangea-asset-detail-side{display:grid;gap:18px}
          .pangea-asset-detail-side>.pangea-asset-detail-panel{padding:23px}
          .pangea-asset-detail-panel h3{font-size:16px;margin:0 0 19px}
          .pangea-asset-detail-badges{display:flex;align-items:center;gap:8px;font-size:12px;color:#69717d}
          .pangea-asset-detail-badges span{padding:5px 8px;border-radius:4px;background:#f1f3f1}
          .pangea-asset-detail-badges .is-good{color:#23724b;background:#e9f4ee}
          .pangea-asset-detail-badges .is-warn{color:#a46510;background:#fcf3e3}
          .pangea-asset-detail-badges .is-error{color:#a33b3b;background:#faebeb}
          .pangea-asset-detail-subtabs{display:flex;gap:24px;border-bottom:1px solid #e3e6e1;margin-bottom:27px}
          .pangea-asset-detail-subtabs button{border:0;background:none;padding:3px 0 13px;color:#67717c;font:inherit;font-size:13px;cursor:pointer}
          .pangea-asset-detail-subtabs button[aria-current=page]{border-bottom:2px solid #c7152a;color:#25292e;font-weight:650}
          .pangea-asset-detail-kv{display:grid;grid-template-columns:125px minmax(0,1fr);gap:17px 18px;margin:0;font-size:13px;line-height:1.7}
          .pangea-asset-detail-kv dt{color:#71808d}.pangea-asset-detail-kv dd{margin:0;overflow-wrap:anywhere}
          .pangea-asset-detail-item{border:1px solid #e1e5df;border-radius:8px;margin-top:12px;padding:18px 19px;background:#fff}
          .pangea-asset-detail-item summary{cursor:pointer;font-size:13px;font-weight:650}
          .pangea-asset-detail-item .pangea-asset-detail-kv{margin-top:21px;grid-template-columns:90px minmax(0,1fr)}
          .pangea-asset-detail-source-note{margin-top:18px;padding:14px 16px;border-left:2px solid #bed1b0;background:#f7f8f5;color:#637384;font-size:12px;overflow-wrap:anywhere}
          .pangea-asset-normalized-source{font-size:13px;line-height:1.9;white-space:pre-wrap;overflow-wrap:anywhere}
          .pangea-asset-normalized-source h3{font-size:17px;margin:28px 0 17px}
          .pangea-asset-normalized-source h4{font-size:14px;margin:27px 0 12px}
          .pangea-asset-normalized-source p{margin:0 0 19px}
          .pangea-asset-detail-callout{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:17px 18px;margin:0 0 18px;border-radius:6px;background:#fcf3e4;color:#9f620e;font-size:13px}
          .pangea-asset-detail-callout.is-blue{background:#edf4f9;color:#486d92}
          .pangea-asset-detail-callout strong{display:block;margin-bottom:5px}
          .pangea-asset-detail-callout p{margin:0;line-height:1.7}
          .pangea-asset-detail-log{display:grid;gap:19px;margin:0;padding:0 0 0 25px;border-left:1px solid #d8dfd3;list-style:none}
          .pangea-asset-detail-log li{position:relative;font-size:12px;line-height:1.7}
          .pangea-asset-detail-log li:before{content:'';position:absolute;left:-29px;top:5px;width:6px;height:6px;border-radius:50%;background:#829a78}
          .pangea-asset-detail-log time{display:block;color:#8e999c;font-size:10px}
          .pangea-asset-process-hero{padding:30px;border:1px solid #e1e5df;border-radius:10px;background:#fff}
          .pangea-asset-process-hero{min-height:330px}
          .pangea-asset-process-symbol{display:grid;place-items:center;width:50px;height:50px;border:1px solid #dce6d3;border-radius:11px;background:#f7faf4;color:#82966e}
          .pangea-asset-process-symbol svg{width:22px;height:22px}
          .pangea-asset-process-hero h2{font-size:21px;margin:25px 0 7px}
          .pangea-asset-process-hero p{font-size:13px;line-height:1.7;color:#667383}
          .pangea-asset-process-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:31px 0 20px}
          .pangea-asset-process-steps div{border-top:2px solid #e2e6e0;padding-top:11px;font-size:12px;color:#6b747e}
          .pangea-asset-process-steps div.done{border-color:#4f8b6b;color:#36775a}.pangea-asset-process-steps div.active{border-color:#c7152a;color:#c7152a}
          .pangea-asset-process-steps small{display:block;margin-top:5px;color:#7a858d}
          .pangea-asset-detail-table-wrap{overflow-x:auto}
          .pangea-asset-detail-table-wrap .pangea-asset-table{min-width:0;width:100%;table-layout:fixed;font-size:12px}
          .pangea-asset-detail-table-wrap .pangea-asset-table :is(th,td){padding:13px 10px;min-width:0;overflow-wrap:anywhere;white-space:normal}
          .pangea-asset-detail-table-wrap .pangea-asset-table :is(th,td):nth-child(1){width:14%}
          .pangea-asset-detail-table-wrap .pangea-asset-table :is(th,td):nth-child(2){width:28%}
          .pangea-asset-detail-table-wrap .pangea-asset-table :is(th,td):nth-child(3){width:32%}
          .pangea-asset-detail-table-wrap .pangea-asset-table :is(th,td):nth-child(4){width:26%}
          .pangea-asset-modal-scrim:has(.pangea-asset-designed-edit){align-items:flex-start;padding-top:72px;backdrop-filter:blur(2px)}
          .pangea-asset-designed-edit{padding:28px}
          .pangea-asset-designed-edit .pangea-asset-edit-fields{margin-top:20px;gap:22px}
          .pangea-asset-edit-hint{font-size:12px;line-height:1.7;color:#70767d;font-weight:400}
          .pangea-asset-stale-content-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px}
          .pangea-asset-stale-content-heading h3{margin:0}
          .pangea-asset-history-record{margin-top:14px;padding:16px;border-radius:7px;background:#f2f3f1;font-size:12px}
          .pangea-asset-history-record .pangea-asset-detail-badges{margin-left:auto}
          .pangea-asset-history-record p{margin:11px 0 0;color:#70767d;line-height:1.8}
          .pangea-b08-intro,.pangea-b08-detail-top,.pangea-b08-row-top{display:flex;align-items:center;justify-content:space-between;gap:18px}
          .pangea-b08-intro{margin:1px 0 23px}.pangea-b08-intro h2,.pangea-b08-detail-top h2{font-size:20px;margin:0}.pangea-b08-intro p,.pangea-b08-detail-top p{font-size:12px;color:#70767d;margin:9px 0 0}
          .pangea-b08-badges{display:flex;align-items:center;gap:8px;margin-bottom:13px;color:#70767d;font-size:12px}.pangea-b08-badge{display:inline-flex;padding:5px 8px;border-radius:4px;background:#f1f3f1;font-size:11px;color:#69717d}.pangea-b08-badge.warn{background:#fcf3e3;color:#a46510}.pangea-b08-badge.good{background:#e9f4ee;color:#23724b}.pangea-b08-badge.blue{background:#edf3f8;color:#496988}
          .pangea-b08-primary{background:#25292e!important;border:1px solid #25292e!important;border-radius:6px;color:#fff!important;padding:9px 13px;font-size:12px;min-height:36px;cursor:pointer}.pangea-b08-primary:disabled{opacity:.5;cursor:not-allowed}
          .pangea-b08-review-row,.pangea-b08-review-item,.pangea-b08-method-card{background:#fff;border:1px solid #e2e4e2;border-radius:9px;padding:22px}.pangea-b08-review-row{margin-bottom:18px}.pangea-b08-row-title{flex:1}.pangea-b08-row-title h3,.pangea-b08-review-item h3,.pangea-b08-method-card h3{font-size:15px;margin:0}.pangea-b08-row-title p{color:#70767d;font-size:12px;margin:7px 0 0}
          .pangea-b08-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;border-top:1px solid #e5e7e4;margin-top:20px;padding-top:18px}.pangea-b08-stats>div{padding-left:24px;border-left:1px solid #e5e7e4}.pangea-b08-stats>div:first-child{padding-left:0;border:0}.pangea-b08-stats span,.pangea-b08-stats small{display:block;color:#70767d;font-size:11px}.pangea-b08-stats strong{display:block;font-size:23px;font-weight:500;margin:5px 0}
          .pangea-b08-detail-top{margin:0 0 24px}.pangea-b08-review-item{margin-bottom:16px}.pangea-b08-review-item .pangea-asset-detail-kv{margin-top:19px}.pangea-b08-review-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;margin-top:20px}.pangea-b08-review-fields label{display:grid;gap:8px;font-size:12px;font-weight:600}.pangea-b08-review-fields :is(input,select){min-height:39px;width:100%;padding:8px 12px;border:1px solid #dfe1df;border-radius:6px;background:#fff;font-size:13px}.pangea-b08-review-foot{display:flex;align-items:center;justify-content:space-between;color:#70767d;font-size:12px;margin:20px 0}.pangea-b08-source-preview{font-size:12px;color:#70767d;line-height:1.8;white-space:pre-wrap;max-height:150px;overflow:auto}
          .pangea-b08-empty{display:flex;min-height:410px;align-items:center;justify-content:center;flex-direction:column;text-align:center;border:1px solid #e2e4e2;border-radius:9px;background:#fff;padding:32px}.pangea-b08-empty h2{font-size:20px;margin:0}.pangea-b08-empty p{font-size:12px;color:#70767d;line-height:1.8;margin:14px 0 20px}.pangea-b08-empty-steps,.pangea-b08-method-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin-top:24px}
          .pangea-b08-archive-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:15px;color:#70767d;font-size:12px}.pangea-b08-archive-toolbar form{flex:1}.pangea-b08-archive-toolbar input{width:100%;height:40px;padding:8px 12px;border:1px solid #dfe1df;border-radius:6px}.pangea-b08-archive-table{overflow-x:auto;border:1px solid #e2e4e2;border-radius:8px;background:#fff}.pangea-b08-archive-table table{width:100%;border-collapse:collapse;font-size:12px}.pangea-b08-archive-table th{text-align:left;background:#f2f3f1;color:#70767d;font-weight:400;padding:14px}.pangea-b08-archive-table td{padding:16px 14px;border-top:1px solid #e5e7e4}.pangea-b08-archive-table td:first-child{width:40%}.pangea-b08-archive-table td button:not([style]){border:0;background:transparent;color:#496988;text-align:left;padding:0}.pangea-b08-archive-table td small{display:block;color:#70767d;margin-top:8px}.pangea-b08-note{font-size:11px;color:#70767d;margin-top:19px}
          .pangea-b08-method-card{min-height:275px}.pangea-b08-method-card h3{margin:22px 0 12px}.pangea-b08-method-card p{font-size:12px;color:#70767d;line-height:1.7}.pangea-b08-method-card hr,.pangea-asset-detail-panel hr{border:0;border-top:1px solid #e5e7e4;margin:20px 0}.pangea-b08-checklist{list-style:none;padding:0}.pangea-b08-checklist li{display:flex;gap:20px;padding:18px 0;border-top:1px solid #e5e7e4;font-size:13px}.pangea-b08-checklist strong{color:#b62836}
          .pangea-b08-archive-table td:first-child{display:flex;align-items:center;gap:12px}.pangea-b08-archive-table td:first-child>span:last-child{min-width:0}
          .pangea-b08-checklist li>span{display:grid;gap:6px}.pangea-b08-checklist .pangea-b08-check-title{color:#30353b;font-size:13px}.pangea-b08-checklist li>span>span{color:#68727b;line-height:1.6}.pangea-b08-source-status{color:#23724b!important;font-size:11px!important;margin:10px 0!important}.pangea-b08-process-top{display:flex;align-items:flex-start;justify-content:space-between}
          .pangea-b07-structured-stack{display:grid;gap:20px;align-content:start}.pangea-b07-structured h3,.pangea-b07-reference h3{margin:0 0 22px}.pangea-b07-structured-title{display:flex;align-items:center;justify-content:space-between}.pangea-b07-structured .pangea-asset-detail-kv{margin:0 0 20px}.pangea-b07-structured-collapsed{border:1px solid #e1e4df;border-radius:7px;background:#fff;padding:17px 20px;font-size:12px}.pangea-b07-structured-collapsed summary{font-weight:650;cursor:pointer}.pangea-b07-structured-collapsed[open] .pangea-asset-detail-kv{margin:22px 0}.pangea-b07-reference{padding:29px 26px}.pangea-b07-fact{margin-top:22px}.pangea-b07-fact h4{margin:0 0 10px;font-size:13px}.pangea-b07-fact p{font-size:12px;line-height:1.8}.pangea-b07-fact .pangea-asset-detail-source-note{margin-top:20px}.pangea-b07-example-table{overflow-x:auto;margin:20px 0}.pangea-b07-example-table table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px;min-width:580px}.pangea-b07-example-table th{text-align:left;background:#f2f3f1;font-weight:400;color:#70767d}.pangea-b07-example-table :is(th,td){padding:15px 13px;border-bottom:1px solid #e5e7e4;vertical-align:top}.pangea-b07-example-table :is(th,td):first-child{width:90px}.pangea-b07-example-table :is(th,td):nth-child(2){width:34%}.pangea-b07-source-preview{margin:20px 0;font-size:12px}.pangea-b07-source-preview summary{cursor:pointer}.pangea-b07-source-preview .pangea-asset-normalized-source{margin-top:12px}.pangea-b07-example-note{margin:0}
          @container pangea-assets (max-width:850px){.pangea-b08-method-grid,.pangea-b08-empty-steps{grid-template-columns:1fr}.pangea-b08-review-fields{grid-template-columns:1fr}.pangea-b08-intro,.pangea-b08-detail-top{align-items:flex-start;flex-direction:column}}
          .pangea-asset-edit-warning{padding:18px;margin:20px 0 0;border:1px solid #f0d7a9;border-radius:7px;background:#fcf4e5;color:#9c641b;font-size:12px;line-height:1.7}
          @container pangea-assets (max-width:1050px){.pangea-asset-detail-grid{grid-template-columns:minmax(0,1fr)}.pangea-asset-detail-side{grid-template-columns:repeat(2,minmax(0,1fr))}}
          .pangea-asset-breadcrumb{display:flex;align-items:center;gap:9px;color:#70767d;font-size:12px;margin-bottom:17px}
          .pangea-asset-breadcrumb span:last-child{color:#323841}
          .pangea-asset-header-actions{align-self:center;padding-bottom:0}
          .pangea-asset-tabs{display:flex;gap:30px;overflow-x:auto;margin-top:22px}
          .pangea-asset-tabs button{border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;padding:10px 0;white-space:nowrap;color:#788087;font-size:13px}
          .pangea-asset-tabs button[aria-current=page]{border-bottom-color:#b62836;color:#25292e;font-weight:650}
          .pangea-asset-header-subtitle{color:#70767d!important;font-size:12px!important;line-height:1.8!important;margin-top:9px!important}
          .pangea-asset-form-grid{display:grid;grid-template-columns:minmax(150px,1fr) minmax(0,2fr);gap:20px;margin-top:24px}
          .pangea-asset-file{padding:22px;border:1px dashed #bac4d1;border-radius:10px;background:#fafbfc;margin-top:20px}
          .pangea-asset-file input{width:100%;border:0;background:transparent;padding:8px 0}
          .pangea-asset-file input::file-selector-button{padding:10px 16px;border:1px solid #dce1e7;border-radius:8px;background:white;font:inherit;margin-right:14px;cursor:pointer}
          .pangea-asset-import-card{padding:24px!important}
          .pangea-asset-import-intro{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
          .pangea-asset-import-intro p{margin:5px 0 0}
          .pangea-asset-import-badge{flex:0 0 auto;border-radius:4px;padding:3px 8px;background:#f3f4f2;color:#70767d;font-size:11px;line-height:1.5}
          .pangea-asset-import-modes{display:flex;gap:8px;margin:25px 0 26px;padding-bottom:0;border-bottom:0}
          .pangea-asset-import-modes button{display:inline-flex;align-items:center;gap:7px;min-height:34px;border:1px solid #dfe3dc;border-radius:6px;background:#fff;padding:6px 12px;color:#555f58;font:inherit;font-size:12px;cursor:pointer}
          .pangea-asset-import-modes button[aria-pressed=true]{border-color:#25292e;color:#fff;background:#25292e}
          .pangea-asset-import-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}
          .pangea-asset-import-fields label>span{display:flex;align-items:center;gap:6px}
          .pangea-asset-import-fields label>span small{color:#8b9295;font-size:11px;font-weight:400}
          .pangea-asset-dropzone{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:226px;margin:26px 0 16px;padding:24px;border:1px dashed #cdd3c8;border-radius:10px;background:#fafbf8;text-align:center;transition:background .15s,border-color .15s}
          .pangea-asset-dropzone.is-dragging{border-color:#82966e;background:#f3f7ee}
          .pangea-asset-dropzone h3{margin:12px 0 5px;font-size:15px;font-weight:600}
          .pangea-asset-dropzone p{margin:0 0 15px;color:#828a89;font-size:12px;line-height:1.7}
          .pangea-asset-dropzone-icon{color:#788a6d}
          .pangea-asset-file-selected{display:flex;align-items:center;gap:13px;min-height:94px;margin:21px 0 16px;padding:15px 18px;border:1px solid #dde3d6;border-radius:9px;background:#fbfcf8}
          .pangea-asset-import-card.has-file .pangea-asset-file-selected{margin:25px 0 23px}
          .pangea-asset-file-selected>div{min-width:0;flex:1}
          .pangea-asset-file-selected strong{display:block;overflow-wrap:anywhere;font-size:13px}
          .pangea-asset-file-selected p{margin:4px 0 0;color:#808b81;font-size:12px}
          .pangea-asset-file-mark{display:grid;place-items:center;width:36px;height:40px;flex:0 0 36px;border:1px solid #e2e6de;border-radius:6px;background:#f8faf5;color:#7f8c7b}
          .pangea-asset-local-path{margin:16px 0 0}
          .pangea-asset-local-path summary{color:#69717d;font-size:12px}
          .pangea-asset-callout{margin-top:21px;padding:16px;border-radius:7px;background:#f3f4f2;color:#25292e;font-size:12px;line-height:1.8}
          .pangea-asset-import-card.has-file .pangea-asset-callout{margin-top:23px}
          .pangea-asset-callout.is-coverage{background:#edf3f8;color:#496988;min-height:77px}
          .pangea-asset-callout.is-coverage p{margin:2px 0 0 26px}
          .pangea-asset-callout.is-error{background:#fbefef;color:#b62836}
          .pangea-asset-callout.is-error p{margin:5px 0 0 26px}
          .pangea-asset-import-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:22px;padding-top:18px;border-top:1px solid #e5e9e2}
          .pangea-asset-import-card.has-file .pangea-asset-import-footer{margin-top:24px}
          .pangea-asset-layout.is-importing .pangea-asset-return,.pangea-asset-import-footer .pangea-asset-cancel{border-color:transparent!important;background:transparent!important}
          .pangea-asset-readiness{margin-top:20px;padding:13px 14px;border:1px solid #eadfc6;border-radius:7px;background:#fbf8ef;color:#806c40}
          .pangea-asset-readiness.is-blocked{position:relative;min-height:165px;padding-right:120px}
          .pangea-asset-readiness.is-ready{border-color:transparent;background:#eaf5ee;color:#20765a}
          .pangea-asset-readiness-title{display:flex;align-items:center;gap:9px}
          .pangea-asset-readiness strong{font-size:13px}
          .pangea-asset-readiness p{margin:5px 0 0 26px;font-size:11px;line-height:1.7}
          .pangea-asset-open-settings{position:absolute;right:15px;top:14px;border:1px solid #e6d9be;border-radius:5px;background:#fff;padding:5px 10px;color:#926316;font:inherit;font-size:11px;cursor:pointer}
          .pangea-asset-coverage-info{font-size:12px;color:#70767d;line-height:1.9}
          .pangea-asset-coverage-icon{display:grid;place-items:center;width:50px;height:50px;margin:17px 0 21px;border:1px solid #dce6d3;border-radius:12px;background:#f8faf5;color:#82966e}
          .pangea-asset-coverage-info h3{margin:0 0 13px;color:#25292e;font-size:18px;line-height:1.4}
          .pangea-asset-coverage-info p{margin:0}
          .pangea-asset-coverage-info hr{border:0;border-top:1px solid #e5e7e4;margin:17px 0}
          .pangea-asset-table{width:100%;border-collapse:collapse;font-size:14px;line-height:1.6}
          .pangea-asset-table th,.pangea-asset-table td{text-align:left;padding:14px 12px;border-bottom:1px solid #e5e9ef;overflow-wrap:anywhere}
          .pangea-asset-table th{background:#f7f8fa;color:#596273;font-weight:600;white-space:nowrap}
          .pangea-asset-table td:nth-child(2){min-width:180px}
          .pangea-asset-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid #e2e4e2;border-radius:10px;background:#fff;margin-bottom:20px}
          .pangea-asset-metric{position:relative;padding:20px 23px;min-width:0}
          .pangea-asset-metric+.pangea-asset-metric::before{content:'';position:absolute;left:0;top:20px;bottom:20px;border-left:1px solid #e2e4e2}
          .pangea-asset-metric-label{font-size:12px;color:#69717d}
          .pangea-asset-metric-value{font-size:27px;font-weight:500;line-height:1.5;letter-spacing:-.7px;margin:0}
          .pangea-asset-metric-value+.pangea-asset-metric-label{font-size:11px;line-height:1.8;margin-top:2px}
          .pangea-asset-filters{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:19px;margin-bottom:14px}
          .pangea-asset-search-summary{display:flex;align-items:center;gap:16px;margin-bottom:14px;min-height:40px}
          .pangea-asset-search-summary-form{flex:1 1 auto;min-width:0}
          .pangea-asset-search-summary-form input{width:100%;height:40px;min-height:40px}
          .pangea-asset-search-summary-chip{flex:0 0 auto;border:0;background:transparent;padding:8px 0;color:#71809a;font:inherit;font-size:11px;line-height:1.4;white-space:nowrap;cursor:pointer}
          .pangea-asset-filter-search{width:100%;min-width:0}
          .pangea-asset-filter-search form{width:100%;align-items:center!important}
          .pangea-asset-filter-search input{width:100%;height:40px;min-height:40px;transform:translateY(-1px)}
          .pangea-asset-filter-options{position:relative;width:197px;display:flex;align-items:center;gap:8px;flex:0 0 auto}
          .pangea-asset-status-chips{width:203px;min-height:72px;display:flex;align-content:flex-start;align-items:center;justify-content:flex-start;column-gap:8px;row-gap:10px;flex-wrap:wrap}
          .pangea-asset-status-chip,.pangea-asset-more-filters>summary{height:30px;display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;border:1px solid #e5e7e4;border-radius:5px;background:#fff;padding:0 11px;color:#25292e;font:inherit;font-size:12px;line-height:1.7;cursor:pointer}
          .pangea-asset-status-chip[aria-pressed="true"]{background:#25292e;border-color:#25292e;color:#fff}
          .pangea-asset-more-filters{position:absolute;right:0;top:40px;flex:0 0 auto}
          .pangea-asset-more-filters>summary{position:relative;width:32px;padding:0;list-style:none;opacity:0;transition:opacity .12s}
          .pangea-asset-more-filters:hover>summary,.pangea-asset-more-filters:focus-within>summary,.pangea-asset-more-filters[open]>summary,.pangea-asset-more-filters>summary[aria-label*="已应用筛选"]{opacity:1}
          .pangea-asset-more-filters>summary::-webkit-details-marker{display:none}
          .pangea-asset-filter-popover{position:absolute;z-index:8;top:calc(100% + 8px);right:0;width:min(280px,calc(100vw - 48px));padding:14px;border:1px solid #e1e4e2;border-radius:9px;background:#fff;box-shadow:0 12px 32px #18212a24}
          .pangea-asset-filter-popover label{display:block;margin-bottom:12px}
          .pangea-asset-filter-popover select{width:100%;height:36px}
          .pangea-asset-filter-popover>button{width:100%}
          .pangea-asset-list{width:100%;border:1px solid #e5e7e4;border-radius:9px;overflow:hidden;background:#fff}
          .pangea-asset-list table{width:100%;border-collapse:collapse;text-align:left;font-size:13px}
          .pangea-asset-list-head{background:#f3f4f2;color:#70767d}
          .pangea-asset-list-head th{padding:11px 14px;font-size:12px;font-weight:500;line-height:1.8;border-bottom:1px solid #e5e7e4}
          .pangea-asset-list-row td{padding:12px 14px;vertical-align:middle;font-size:12px;line-height:1.8;border-bottom:1px solid #e5e7e4}
          .pangea-asset-list input[type=checkbox]{width:15px;height:15px;margin:0;flex-shrink:0}
          .pangea-asset-list-row:last-child td{border-bottom:0}
          .pangea-asset-list-row:hover{background:#fbfcfb}
          .pangea-asset-file-cell{display:flex;align-items:center;gap:12px;min-width:0}
          .pangea-asset-filemark{width:34px;height:38px;flex:0 0 34px;display:grid;place-items:center;border:1px solid #e2e6de;border-radius:6px;background:#f8faf5;color:#7f8c7b;font-size:9px;font-weight:650}
          .pangea-asset-filemeta{min-width:0}
          .pangea-asset-filetitle{display:inline-flex;align-items:center;gap:5px;max-width:100%;padding:0;border:0;background:transparent;color:#496988;text-align:left;font:inherit;font-size:12px;line-height:1.7;cursor:pointer;overflow-wrap:anywhere}
          .pangea-asset-filetitle svg{width:17px;height:17px;flex:0 0 17px;stroke-width:1.65}
          .pangea-asset-filetitle:hover{text-decoration:underline}
          .pangea-asset-filepath{color:#70767d;font-size:11px;line-height:1.8;margin-top:4px;overflow-wrap:anywhere}
          .pangea-asset-row-badge{justify-self:start;border-radius:4px;padding:3px 8px;background:#f3f4f2;color:#70767d;font-size:11px;line-height:1.5;white-space:normal}
          .pangea-asset-row-badge.is-available{background:#eaf5ee;color:#20765a}
          .pangea-asset-row-badge.is-pending{background:#fbf4e6;color:#926316}
          .pangea-asset-row-badge.is-processing{background:#edf3f8;color:#496988}
          .pangea-asset-row-badge.is-error{background:#fbefef;color:#b62836}
          .pangea-asset-row-revision{color:#25292e}
          .pangea-asset-revision-code{font-family:Consolas,monospace;font-variant-numeric:tabular-nums}
          .pangea-asset-row-count{color:#70767d;font-size:11px;line-height:1.8;margin-top:4px}
          .pangea-asset-row-action{white-space:nowrap}
          .pangea-asset-row-action button{display:inline-flex;align-items:center;gap:7px;min-height:29px;border:1px solid transparent;background:transparent;color:#25292e;padding:4px 9px;font:inherit;line-height:1.8;cursor:pointer}
          .pangea-asset-row-action button svg{width:17px;height:17px;flex:0 0 17px}
          .pangea-asset-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
          .pangea-asset-selection{position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 18px;margin-top:16px;border-radius:8px;background:#25292e;color:#fff}
          .pangea-asset-selection-title{font-size:13px;line-height:1.5}
          .pangea-asset-selection.is-empty{background:#fff;color:#4b5562;border:1px solid #e2e4e2;box-shadow:none}
          .pangea-asset-selection .pangea-asset-meta{color:inherit}
          .pangea-asset-selection:not(.is-empty) .pangea-asset-meta{display:none}
          .pangea-asset-modal-scrim{position:fixed;inset:0;z-index:20;display:grid;place-items:center;padding:24px;background:#17202c66}
          .pangea-asset-edit-dialog{width:min(100%,680px);max-height:min(86vh,760px);overflow:auto;border:1px solid #dfe2df;border-radius:12px;background:#fff;padding:24px;box-shadow:0 20px 64px #11182733}
          .pangea-asset-edit-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:22px}
          .pangea-asset-edit-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:24px;padding-top:16px;border-top:1px solid #e5e8e5}
          .pangea-asset-root :is(button,input,select,summary):focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#c7000b);outline-offset:3px}
          .pangea-asset-root button:disabled{opacity:.5;cursor:not-allowed}
          .pangea-asset-root button:not(:disabled):hover{filter:brightness(.96)}
          .pangea-asset-root input[type=checkbox]{width:18px;height:18px;margin:4px 0;flex-shrink:0;accent-color:var(--pangea-red,#b62836)}
          .pangea-asset-root .pangea-asset-list input[type=checkbox]{width:15px;height:15px;margin:0}
          .pangea-asset-root summary{cursor:pointer}
          @container pangea-assets (max-width:960px){.pangea-asset-layout.has-assistant{grid-template-columns:minmax(0,1fr)}.pangea-asset-layout.is-importing{margin-right:0}.pangea-asset-layout.is-importing .pangea-asset-header{width:100%}.pangea-asset-layout.is-importing .pangea-asset-content{padding-right:30px!important}.pangea-asset-assistant{position:static;border-left:0;border-top:1px solid var(--dsw-alias-border-l2,#dce1e7);max-height:none}.pangea-asset-layout.is-importing .pangea-asset-assistant{margin-top:0}}
          @container pangea-assets (max-width:760px){.pangea-asset-list-head th:first-child,.pangea-asset-list-row td:first-child{width:44px}.pangea-asset-list-head th:nth-child(3),.pangea-asset-list-row td:nth-child(3){width:88px}.pangea-asset-list-head th:nth-child(n+4),.pangea-asset-list-row td:nth-child(n+4){display:none}}
          .pangea-asset-empty{min-height:410px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;border:1px solid #e2e4e2;border-radius:10px;background:#fff;padding:32px}
          .pangea-asset-empty.is-compact{min-height:410px}
          .pangea-asset-empty.is-first-use{position:relative;justify-content:flex-start;width:calc(100% + 1px);padding-top:67px}
          .pangea-asset-empty.is-first-use .pangea-asset-empty-steps{position:absolute;top:calc(100% + 24px);left:-1px;right:-1px;width:auto;margin:0}
          .pangea-asset-empty-icon{width:52px;height:52px;display:grid;place-items:center;margin-bottom:20px;border:1px solid #e1e4e1;border-radius:14px;color:#747e89}
          .pangea-asset-empty-copy{max-width:440px;margin:9px auto 0;color:#70767d;font-size:13px;line-height:1.7}
          .pangea-asset-empty.is-first-use .pangea-asset-empty-title{font-size:20px!important;font-weight:600!important;line-height:normal!important}
          .pangea-asset-empty.is-first-use .pangea-asset-empty-copy{max-width:450px;margin:12px auto 21px;line-height:1.9}
          .pangea-asset-empty-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin-top:24px}
          .pangea-asset-empty-step{border:1px solid #e2e4e2;border-radius:10px;background:#fff;padding:22px;text-align:left}
          .pangea-asset-empty-step strong{display:block;font-size:15px;font-weight:600}
          .pangea-asset-empty-step span{display:block;margin-top:17px;color:#6b7582;font-size:12px;line-height:1.8}
          .pangea-asset-loading-state{display:block}
          .pangea-asset-loading-note{display:flex;align-items:flex-start;gap:10px;padding:15px 17px;margin-bottom:22px;border-radius:7px;background:#edf3f8;color:#496988}
          .pangea-asset-loading-note svg{margin-top:2px;flex:0 0 16px}
          .pangea-asset-loading-note strong{font-size:13px;line-height:1.7}
          .pangea-asset-loading-note p{font-size:12px;margin:4px 0 0;line-height:1.8}
          .pangea-asset-skeletons{display:grid;gap:0;border:1px solid #e2e4e2;border-radius:10px;background:#fff;padding:22px}
          .pangea-asset-skeleton-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 0;border-bottom:1px solid #e5e7e4}
          .pangea-asset-skeleton-row:last-child{border-bottom:0}
          .pangea-asset-skeleton-main{width:62%;min-width:0}
          .pangea-asset-skeleton-line{width:80%;height:13px;margin-bottom:15px;border-radius:5px;background:#eeefec}
          .pangea-asset-skeleton-line.is-short{width:45%;height:8px;margin:0}
          .pangea-asset-skeleton-line.is-tag{width:70px;height:20px;flex:0 0 70px;margin:0}
          @container pangea-assets (max-width:600px){.pangea-asset-root .pangea-asset-header,.pangea-asset-root .pangea-asset-content,.pangea-asset-assistant{padding:16px!important}.pangea-asset-root .pangea-asset-fields,.pangea-asset-form-grid,.pangea-asset-import-fields{grid-template-columns:minmax(0,1fr)!important;gap:12px!important}.pangea-asset-fields dd{margin-bottom:12px!important}.pangea-asset-tabs{gap:18px}.pangea-asset-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.pangea-asset-metric:nth-child(3){border-left:0;border-top:1px solid #e2e4e2}.pangea-asset-metric:nth-child(4){border-top:1px solid #e2e4e2}.pangea-asset-list-head,.pangea-asset-list-row{grid-template-columns:28px minmax(140px,1fr) minmax(72px,.5fr)}.pangea-asset-list-head>:nth-child(n+4),.pangea-asset-list-row>:nth-child(n+4){display:none}.pangea-asset-filters{align-items:stretch;flex-direction:column}.pangea-asset-empty-steps{grid-template-columns:minmax(0,1fr)}.pangea-asset-import-intro{align-items:flex-start}.pangea-asset-import-modes{flex-wrap:wrap}.pangea-asset-import-footer{align-items:stretch}.pangea-asset-import-footer button{flex:1}}
        `),
          h('div', { className: `pangea-asset-layout${showAssistant ? ' has-assistant' : ''}${importOpen ? ' is-importing' : ''}` }, h('main', { style: { minWidth: 0 } },
        h('div', { className: 'pangea-asset-header', style: styles.header },
          h('div', { className: 'pangea-asset-breadcrumb', 'aria-label': '当前位置' }, h('span', null, '工作空间'), h('span', { 'aria-hidden': true }, '›'), h('span', null, '测试资产'), h('span', { 'aria-hidden': true }, '›'), h('span', null, section === 'methodologies' ? '方法论' : importOpen ? coverageOnly ? '覆盖率文件' : importFileIssue ? '文件校验失败' : !importEnvironmentReady && importFile ? '模型未就绪' : importFile ? '文件与处理设置' : '选择原始材料' : activeAsset ? '资产详情' : waitingForAssets ? '首次读取' : error ? '读取失败' : hasAppliedFilters && !assets.length ? '筛选无结果' : !assets.length ? '首次使用' : '材料与处理状态')),
            h('div', { style: styles.row }, h('div', null, h('h1', { style: styles.title }, '测试资产'), h('div', { className: 'pangea-asset-header-subtitle', style: styles.meta }, '让原始材料、提取内容与后续分析保持清晰关联。')),
              h('div', { className: 'pangea-asset-header-actions', style: styles.wrap },
                importOpen ? h('button', { type: 'button', className: 'pangea-asset-return', disabled: busy, style: { ...styles.button, display: 'inline-flex', alignItems: 'center', gap: 7 }, onClick: closeImport }, h('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'm14 18-6-6 6-6M8 12h13' })), '返回资产库')
                : activeAsset ? h('div', { style: styles.wrap },
                    h('button', { type: 'button', disabled: busy, style: styles.button, onClick: () => { setActiveAsset(null); setEditingAssetId(''); setError(''); setNotice('') } }, '返回资产库'),
                    designedDetail && (error || detailLoading) ? h('button', { type: 'button', disabled: detailLoading, style: styles.button, onClick: () => { void toggle(activeAsset.asset_id, true) } }, detailLoading ? '刷新中…' : '刷新') : null,
                    detailHeaderActions && detailTab !== 'source' && detailTab !== 'history' && state?.features?.metadata !== false ? h('button', { type: 'button', disabled: busy, style: styles.button, onClick: event => startEdit(activeAsset, event) }, '编辑信息') : null,
                    detailHeaderActions && detailTab === 'content' ? h('button', { type: 'button', disabled: busy, style: styles.button, onClick: () => { void act('archive', { asset_id: activeAsset.asset_id }) } }, '归档') : null)
                : waitingForAssets ? h('span', { role: 'status', style: styles.meta }, '刷新中') : null,
              !importOpen && !activeAsset && !waitingForAssets && !loading ? h('button', { type: 'button', disabled: busy, style: { ...styles.button, ...styles.primary, display: 'inline-flex', alignItems: 'center', gap: 7, fontWeight: 400, lineHeight: 'normal' }, onClick: openImport }, plusIcon(), '导入资产') : null)),
          h('nav', { className: 'pangea-asset-tabs', 'aria-label': '资产管理导航' },
            [['library', '资产库'], ['review', '待审核'], ['methodologies', '方法论'], ['archived', '已归档']].map(([value, label]) =>
              h('button', { key: value, type: 'button', disabled: busy, 'aria-current': section === value ? 'page' : undefined,
                style: { fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', minHeight: 43, padding: '10px 0 14px' }, onClick: () => navigate(value) }, label)))),
        h('div', { className: 'pangea-asset-content', style: styles.content },
          b08Mode ? b08View() : null,
          activeAsset && !importOpen && !designedDetail && !b08Mode ? h('button', { type: 'button', disabled: busy, style: { ...styles.button, marginBottom: 12 }, onClick: () => { setActiveAsset(null); setImportOpen(false); setEditingAssetId(''); setError(''); setNotice('') } }, '返回列表') : null,
          designedDetail && !importOpen && !b08Mode ? detailView(activeAsset, details[activeAsset.asset_id]) : null,
          showLibrary && !activeAsset && state && assets.length ? h('div', { className: 'pangea-asset-metrics', 'aria-label': '资产统计' },
            [['全部资料', summary.total ?? pagination.total, '材料与提取内容'], ['可用于分析', summary.available ?? 0, '已完成处理'], ['待人工审核', summary.review ?? 0, '历史缺陷资料'], ['需要处理', summary.failed ?? 0, '可查看失败记录']].map(([label, count, hint]) =>
              h('div', { key: label, className: 'pangea-asset-metric' }, h('div', { className: 'pangea-asset-metric-label' }, label), h('div', { className: 'pangea-asset-metric-value' }, count), h('div', { className: 'pangea-asset-metric-label' }, hint)))) : null,
          importOpen ? h('section', { className: `pangea-asset-import-card${importFile ? ' has-file' : ''}`, style: styles.card, 'aria-label': '导入新资产', 'aria-busy': busy },
            h('div', { className: 'pangea-asset-import-intro' },
              h('div', null, h('h2', { style: { ...styles.itemTitle, margin: 0 } }, '导入新的分析材料'), h('p', { style: styles.meta }, '选择资料 → 提取内容 → 核对后用于分析')),
              h('span', { className: 'pangea-asset-import-badge' }, coverageOnly ? '覆盖率输入' : '原始材料')),
            h('div', { className: 'pangea-asset-import-modes', role: 'group', 'aria-label': '导入资料类别' },
              h('button', { type: 'button', disabled: busy || !generalImportTypes.length, 'aria-pressed': !coverageOnly, onClick: () => { setImportFile(null); setImportPath(''); setError(''); setImportType(defaultGeneralType) } }, assetFileIcon('design'), '一般资料'),
              h('button', { type: 'button', disabled: busy || !importTypes.some(([value]) => value === 'coverage'), 'aria-pressed': coverageOnly, onClick: () => { setImportFile(null); setImportPath(''); setError(''); setImportType('coverage') } }, assetFileIcon('coverage'), '覆盖率文件')),
            h('div', { className: 'pangea-asset-import-fields' },
              h('label', { style: styles.field }, h('span', { style: styles.label }, '资料类型'),
                h('select', { 'aria-label': '资产类型', disabled: busy, style: { ...styles.input, width: '100%' }, value: importType, onChange: event => { if ((event.target.value === 'coverage') !== coverageOnly) { setImportFile(null); setImportPath('') } setImportType(event.target.value) } },
                  (coverageOnly ? importTypes.filter(([value]) => value === 'coverage') : generalImportTypes).map(([value, label]) => h('option', { key: value, value }, label)))),
              h('label', { style: styles.field }, h('span', { style: styles.label }, '资产标题', h('small', null, '可选')),
                h('input', { 'aria-label': '资产标题', disabled: busy, placeholder: '留空时使用文件名', style: styles.input, value: importTitle, onChange: event => setImportTitle(event.target.value) }))),
            importFile ? h('div', { className: 'pangea-asset-file-selected', role: 'status' },
              h('span', { className: 'pangea-asset-file-mark' }, assetFileIcon(importType)),
              h('div', null, h('strong', null, importFile.name), h('p', null, `${importFile.size >= 1024 * 1024 ? `${(importFile.size / (1024 * 1024)).toFixed(1)} MiB` : `${(importFile.size / 1024).toFixed(1)} KB`}${importFileIssue ? ' · 超出文件限制' : ''}`)),
              h('button', { type: 'button', disabled: busy, style: styles.button, onClick: () => importFileInput.current?.click() }, '重新选择'))
              : h('div', { className: 'pangea-asset-dropzone', onDragOver: event => event.preventDefault(), onDrop: event => { event.preventDefault(); const file = event.dataTransfer?.files?.[0]; if (file) { setImportFile(file); setImportPath(''); setError('') } } },
                h('svg', { className: 'pangea-asset-dropzone-icon', width: 28, height: 28, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'M12 16V4m0 0L7 9m5-5 5 5M4 16v4h16v-4' })),
                h('h3', null, '选择要加入资产库的文件'),
                h('p', null, coverageOnly ? 'Excel 工作簿或覆盖率 combined JSON' : 'Markdown、TXT、PDF、Word、Excel', h('br'), '单文件最大 24 MiB'),
                h('button', { type: 'button', disabled: busy, style: styles.button, onClick: () => importFileInput.current?.click() }, '选择文件')),
            h('input', { ref: importFileInput, className: 'pangea-asset-sr-only', type: 'file', 'aria-label': '选择资产文件', disabled: busy, accept: coverageOnly ? '.xlsx,.json' : '.md,.txt,.pdf,.docx,.xlsx', onChange: event => { setImportFile(event.target.files?.[0] ?? null); setImportPath(''); setError('') } }),
            h('details', { className: 'pangea-asset-local-path', open: Boolean(importPath || importFile) }, h('summary', null, '使用本机文件路径'),
              h('input', { 'aria-label': '资产文件路径', disabled: busy, placeholder: '文件完整路径', style: { ...styles.input, width: '100%', minHeight: importFile ? 40 : 38, marginTop: importFile ? 13 : 10 }, value: importPath, onChange: event => { setImportPath(event.target.value); setError(''); if (event.target.value) setImportFile(null) } })),
            importFileIssue || error ? h('div', { className: 'pangea-asset-callout is-error', role: 'alert' },
              h('strong', null, importFileIssue ? importFile.size === 0 ? '文件内容为空' : '文件超过上传限制' : '导入失败'),
              h('p', null, importFileIssue || error))
              : h('div', { className: `pangea-asset-callout${coverageOnly ? ' is-coverage' : ''}` }, coverageOnly
                ? h(React.Fragment, null, h('strong', null, 'ⓘ  本机解析覆盖记录'), h('p', null, '支持 XLSX 与覆盖率 combined JSON。解析完成后查看源码位置与执行次数。'))
                : importType === 'historical_defect' ? '历史缺陷提取后需人工审核，通过后才可用于分析。' : '需求、设计、参考资料与用例示例会形成可核对的内容条目。历史缺陷提取后需人工审核。'),
            h('div', { className: 'pangea-asset-import-footer' },
              h('button', { type: 'button', className: 'pangea-asset-cancel', disabled: busy, style: styles.button, onClick: closeImport }, '取消'),
              h('button', { type: 'button', disabled: busy || (!importFile && !importPath.trim()) || Boolean(importFileIssue) || !importEnvironmentReady, style: { ...styles.button, ...styles.primary }, onClick: () => { void submitImport() } }, busy ? '正在导入…' : '导入并处理'))) : null,
          notice ? h('div', { style: { ...styles.card, ...styles.notice }, role: 'status' }, notice) : null,
          error && !importOpen && !emptyCatalogError && (state || activeAsset) ? h('div', { style: { ...styles.card, ...styles.error }, role: 'alert' },
            h('div', null, error), h('button', { type: 'button', disabled: busy || loading, style: { ...styles.button, marginTop: 12 }, onClick: () => { void load() } }, '刷新数据')) : null,
          section === 'methodologies' && !importOpen && !b08Mode ? h('section', { style: { ...styles.card, ...styles.notice } },
            h('div', { style: styles.row },
              h('div', null,
                h('div', { style: styles.title }, '用户方法论'),
              h('div', { style: styles.meta }, '从已审核的历史缺陷中整理可复用的测试检查项。启用后用于新分析；内容更新后状态会自动回到待启用。')),
              h('span', { style: styles.chip }, `${methodologies.length} 个`)),
            state?.methodologies?.generation_job ? h('div', { style: { ...styles.meta, marginTop: 8 } },
              `语义会话：${state.methodologies.generation_job.status}`,
              state.methodologies.generation_job.session_id ? h('button', { type: 'button', style: { ...styles.button, marginLeft: 8 }, onClick: () => { void openAnalysisSession(ctx.sessions, state.methodologies.generation_job.session_id) } }, '打开会话') : null) : null,
            methodologies.length ? h('div', { style: styles.methodologyGrid }, methodologies.map(methodology => {
              const detail = methodologyDetails[methodology.methodology_id] ?? methodology
              const expanded = expandedMethodology === methodology.methodology_id
              return h('article', { key: methodology.methodology_id, style: styles.methodologyCard },
                h('div', { style: styles.row },
                  h('div', { style: { minWidth: 0 } },
                    h('div', { style: styles.itemTitle }, methodology.title),
                    h('div', { style: styles.meta }, methodology.methodology_id)),
                  h('span', { style: { ...styles.chip, color: methodology.status === 'candidate' ? '#cf0a2c' : undefined } }, METHODOLOGY_STATUS[methodology.status] ?? methodology.status)),
                methodology.status === 'candidate' ? h('div', { style: styles.meta }, '需要用户确认启用；如果这是内容更新产生的状态，旧 Run 的冻结版本不受影响。') : null,
                h('div', { style: { ...styles.wrap, marginTop: 9 } },
                  methodology.status !== 'enabled' ? h('button', { type: 'button', disabled: busy, style: { ...styles.button, ...styles.primary }, onClick: () => { void act('enable_methodology', { methodology_id: methodology.methodology_id }) } }, '启用') : null,
                  methodology.status !== 'disabled' ? h('button', { type: 'button', disabled: busy, style: styles.button, onClick: () => { void act('disable_methodology', { methodology_id: methodology.methodology_id }) } }, '停用') : null,
                  h('button', { type: 'button', style: styles.button, onClick: () => { void toggleMethodology(methodology.methodology_id) } }, expanded ? '收起详情' : '查看详情')),
                expanded ? h('div', { style: { marginTop: 10, paddingTop: 9, borderTop: '1px solid var(--dsw-alias-border-l2, #444)' } },
                  h('div', { style: styles.itemTitle }, '适用条件'), h('ul', { style: styles.sourceList }, (detail.applicable_when ?? []).map(item => h('li', { key: item }, item))),
                  h('div', { style: styles.itemTitle }, '检查项'), h('ol', { style: styles.sourceList }, (detail.checks ?? []).map(item => h('li', { key: item }, item))),
                  h('div', { style: styles.itemTitle }, '来源条目'), h('ul', { style: styles.sourceList }, (detail.source_item_ids ?? []).map(item => h('li', { key: item }, item)))) : null)
            })) : h('div', { style: { marginTop: 20 } }, h('p', { style: styles.meta }, '还没有方法论。选择已审核的历史缺陷，生成第一组检查项。'),
              h('button', { type: 'button', style: styles.button, onClick: () => { navigate('library'); setType('historical_defect'); setStatus('available') } }, '选择历史缺陷'))) : null,
          showLibrary && !activeAsset && searchEmptyState ? h('section', { className: 'pangea-asset-search-summary', 'aria-label': '筛选资产' },
            h('form', { className: 'pangea-asset-search-summary-form', onSubmit: event => { event.preventDefault(); setPage(1); setQuery(queryDraft.trim()) } },
              h('input', { type: 'search', 'aria-label': '搜索测试资产', placeholder: '搜索标题、编号或文件路径…', style: styles.input, value: queryDraft, onChange: event => setQueryDraft(event.target.value) })),
            searchFilterLabel ? h('button', { type: 'button', className: 'pangea-asset-search-summary-chip', 'aria-label': '清除类型和状态筛选', onClick: () => { setPage(1); setType(''); setKind(''); setStatus('') } }, searchFilterLabel) : null)
            : showLibrary && !activeAsset && (pagination.total > 0 || hasAppliedFilters) ? h('section', { className: 'pangea-asset-filters', 'aria-label': '筛选资产' },
            h('form', { role: 'search', 'aria-label': '资产关键词搜索', className: 'pangea-asset-filter-search', onSubmit: event => { event.preventDefault(); setPage(1); setQuery(queryDraft.trim()) } },
              h('input', { type: 'search', 'aria-label': '搜索资产', placeholder: '搜索标题、编号或文件路径…', style: { ...styles.input, border: '1px solid #e0e3df', borderRadius: 6, background: '#fff', color: '#25292e', padding: '10px 13px' }, value: queryDraft, onChange: event => setQueryDraft(event.target.value) })),
            h('div', { className: 'pangea-asset-filter-options' },
              section === 'library' ? h('div', { className: 'pangea-asset-status-chips', role: 'group', 'aria-label': '资产状态筛选' },
                [['', '全部状态'], ['available', '可用'], ['awaiting_review', '待审核'], ['failed', '失败']].map(([value, label]) => h('button', {
                  key: value || 'all-status', type: 'button', className: 'pangea-asset-status-chip', 'aria-pressed': status === value,
                  onClick: () => { setPage(1); setStatus(value) },
                }, label))) : null,
              h('details', { className: 'pangea-asset-more-filters' },
                h('summary', { 'aria-label': type || status && !['available', 'awaiting_review', 'failed'].includes(status) ? '更多筛选，已应用筛选' : '更多筛选', title: '更多筛选' },
                  h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', 'aria-hidden': true }, h('path', { d: 'M4 6h16M7 12h10M10 18h4' }))),
                h('div', { className: 'pangea-asset-filter-popover' },
                  h('label', { style: styles.field }, h('span', { style: styles.label }, '资产类型'),
                    h('select', { 'aria-label': '筛选资产类型', style: styles.input, value: type, onChange: event => { setPage(1); setKind(''); setType(event.target.value) } }, TYPES.filter(([value]) => !value || !state?.asset_types?.length || state.asset_types.includes(value)).map(([value, label]) => h('option', { key: value || 'all', value }, value ? label : '全部类型')))),
                  section === 'library' ? h('label', { style: styles.field }, h('span', { style: styles.label }, '更多状态'),
                    h('select', { 'aria-label': '资产状态', style: styles.input, value: status, onChange: event => { setPage(1); setStatus(event.target.value) } }, STATUS_FILTERS.map(([value, label]) => h('option', { key: value || 'all-status', value }, label)))) : null,
                  hasFilters ? h('button', { type: 'button', style: styles.button, onClick: clearFilters }, '清除筛选') : null)))) : null,
          showLibrary && !activeAsset && displayAssets.length ? h('section', { 'aria-label': '资产列表', 'aria-busy': loading || waitingForAssets },
            h('div', { className: 'pangea-asset-list' },
              h('table', { role: 'table', 'aria-label': '测试资产列表' },
                h('thead', { className: 'pangea-asset-list-head' },
                  h('tr', { role: 'row' },
                    h('th', { role: 'columnheader', scope: 'col', 'aria-label': '选择' }), h('th', { role: 'columnheader', scope: 'col' }, '资产与原始材料'), h('th', { role: 'columnheader', scope: 'col' }, '类型'), h('th', { role: 'columnheader', scope: 'col' }, '处理状态'), h('th', { role: 'columnheader', scope: 'col' }, '修订 / 提取结果'), h('th', { role: 'columnheader', scope: 'col', 'aria-label': '操作' }))),
                h('tbody', null, displayAssets.map(asset => {
                const statusClass = ['failed', 'interrupted', 'needs_attention'].includes(asset.extraction_job?.status) || asset.status === 'failed' ? 'is-error'
                  : asset.status === 'available' ? 'is-available' : asset.status === 'extracting' ? 'is-processing' : asset.status === 'awaiting_review' ? 'is-pending' : ''
                  const statusLabel = asset.status === 'awaiting_review' ? '待审核'
                    : asset.status === 'extracting' ? '正在提取'
                      : asset.status === 'no_items' ? '无可用内容'
                        : asset.status !== 'archived' && ['failed', 'interrupted', 'needs_attention'].includes(asset.extraction_job?.status)
                          ? jobLabel[asset.extraction_job.status] : STATUS[asset.status] ?? asset.status
                  const fileName = asset.source_name || asset.source_path?.split(/[\\/]/).pop() || '未提供文件名'
                  const itemCount = Number(asset.structured_item_count ?? 0)
                  const revisionSummary = asset.status === 'awaiting_review' ? `${itemCount} 条待审核`
                    : asset.status === 'extracting' ? '内容生成中'
                      : asset.status === 'failed' ? `保留原有 ${itemCount} 条`
                        : `${itemCount} 条${asset.asset_type === 'coverage' ? '记录' : '内容'}`
                  const actionLabel = asset.status === 'awaiting_review' ? '查看并审核' : '查看详情'
                return h('tr', { key: asset.asset_id, className: 'pangea-asset-list-row', role: 'row' },
                  h('td', { role: 'cell' }, asset.status === 'available' ? h('input', { type: 'checkbox', checked: selectedAssetIds.includes(asset.asset_id), 'aria-label': `选择资产 ${asset.title}`, onChange: () => toggleSelectedAsset(asset.asset_id) }) : null),
                  h('td', { role: 'cell' }, h('div', { className: 'pangea-asset-file-cell' },
                    h('span', { className: 'pangea-asset-filemark', 'aria-hidden': true }, assetFileIcon(asset.asset_type)),
                    h('div', { className: 'pangea-asset-filemeta' },
                      h('button', { type: 'button', className: 'pangea-asset-filetitle', title: asset.title, 'aria-label': asset.title, onClick: () => { void toggle(asset.asset_id) } }, asset.title,
                        h('svg', { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.65, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'M7 17 17 7' }), h('path', { d: 'M7 7h10v10' }))),
                      h('div', { className: 'pangea-asset-filepath', title: asset.source_path }, `${fileName} · ${(asset.repository_ids ?? []).join('、') || '未限定仓库'}`)))),
                  h('td', { role: 'cell' }, h('span', { className: 'pangea-asset-row-badge' }, TYPES.find(([value]) => value === asset.asset_type)?.[1] ?? asset.asset_type)),
                  h('td', { role: 'cell' }, h('span', { className: `pangea-asset-row-badge ${statusClass}` }, statusLabel)),
                  h('td', { role: 'cell', className: 'pangea-asset-row-revision' }, h('span', { className: 'pangea-asset-revision-code' }, `r${asset.revision ?? 1}`), h('div', { className: 'pangea-asset-row-count' }, revisionSummary)),
                  h('td', { role: 'cell', className: 'pangea-asset-row-action' }, h('button', { type: 'button', 'aria-label': actionLabel, onClick: () => { void toggle(asset.asset_id) } },
                    h('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'm9 18 6-6-6-6' })),
                    '查看', h('span', { className: 'pangea-asset-sr-only' }, actionLabel === '查看并审核' ? '并审核' : '详情')))
                )}))))) : null,
          showLibrary && (!designedDetail && activeAsset || !displayAssets.length) ? h('section', { 'aria-label': '资产列表', 'aria-busy': loading || waitingForAssets || detailLoading }, displayAssets.length ? displayAssets.map(asset => {
            const detail = details[asset.asset_id]
            const isExpanded = activeAsset?.asset_id === asset.asset_id
            return h('div', { key: asset.asset_id, style: styles.card },
              h('div', { style: styles.row },
                h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 } },
                  asset.status === 'available' ? h('input', { type: 'checkbox', checked: selectedAssetIds.includes(asset.asset_id), 'aria-label': `选择资产 ${asset.title}`, onChange: () => toggleSelectedAsset(asset.asset_id) }) : null,
                  h('div', { style: { minWidth: 0 } }, h('div', { style: styles.itemTitle }, asset.title), h('div', { title: asset.source_path, style: styles.meta }, `${asset.source_name || asset.source_path?.split(/[\\/]/).pop() || '未提供文件名'} · ${(asset.repository_ids ?? []).join('、') || '未限定仓库'}`))),
                h('div', { style: { ...styles.wrap, justifyContent: 'flex-end' } },
                  h('span', { style: styles.chip }, TYPES.find(([value]) => value === asset.asset_type)?.[1] ?? asset.asset_type),
                  h('span', { style: { ...styles.chip, ...(['failed', 'interrupted', 'needs_attention'].includes(asset.extraction_job?.status) || asset.status === 'failed' ? { background: '#fff0f1', color: '#a6000a' } : asset.status === 'available' ? { background: '#edf8f2', color: '#176548' } : ['extracting', 'awaiting_review'].includes(asset.status) ? { background: '#fff7e6', color: '#875400' } : {}) } }, asset.status !== 'archived' && ['failed', 'interrupted', 'needs_attention'].includes(asset.extraction_job?.status) ? jobLabel[asset.extraction_job.status] : STATUS[asset.status] ?? asset.status),
                  !isExpanded ? h('button', { type: 'button', style: styles.button, onClick: () => { void toggle(asset.asset_id) } }, asset.status === 'awaiting_review' ? '查看并审核' : '查看详情') : null)),
              h('div', { style: styles.meta }, `修订 ${asset.revision ?? 1} · ${asset.asset_type === 'coverage' ? `覆盖记录 ${asset.structured_item_count ?? 0}` : `提取条目 ${asset.structured_item_count ?? 0}`} · 更新于 ${assetTime(asset.updated_at)}（UTC+8）`),
              isExpanded ? h('div', { style: { ...styles.wrap, marginTop: 8 } },
                (['imported', 'available', 'no_items', 'rejected', 'failed'].includes(asset.status) || ['failed', 'interrupted', 'needs_attention'].includes(asset.extraction_job?.status))
                  ? h('button', { type: 'button', disabled: busy, style: styles.button, onClick: () => { void act('extract', { asset_id: asset.asset_id, restart: true }) } }, '重新处理') : null,
                asset.status === 'awaiting_review' ? h(React.Fragment, null,
                  h('button', { type: 'button', disabled: busy, style: { ...styles.button, ...styles.primary }, onClick: () => { void act('review', { asset_id: asset.asset_id, decision: 'approve' }) } }, '审核通过'),
                  h('button', { type: 'button', disabled: busy, style: styles.button, onClick: () => { void act('review', { asset_id: asset.asset_id, decision: 'reject' }) } }, '拒绝')) : null,
                asset.asset_type === 'historical_defect' && asset.status === 'available' ? h('button', { type: 'button', disabled: busy, style: { ...styles.button, ...styles.primary }, onClick: () => { void act('generate_methodology', { asset_ids: [asset.asset_id] }) } }, '开启语义生成会话') : null,
                asset.status !== 'archived' && state?.features?.metadata !== false ? h('button', { type: 'button', disabled: busy, style: styles.button, onClick: event => startEdit(asset, event) }, '编辑信息') : null,
                asset.status !== 'archived' ? h('button', { type: 'button', disabled: busy, style: styles.button, onClick: () => { void act('archive', { asset_id: asset.asset_id }) } }, state?.features?.restore === false ? '归档' : '删除（可恢复）')
                  : h('button', { type: 'button', disabled: busy || state?.features?.restore === false, title: state?.features?.restore === false ? '当前分析引擎尚未提供恢复操作' : undefined, style: { ...styles.button, ...styles.primary }, onClick: () => { void act('restore', { asset_id: asset.asset_id }) } }, '恢复')) : null,
              editingAssetId === asset.asset_id ? h('div', { className: 'pangea-asset-modal-scrim' },
                h('section', { ref: editDialogRef, className: 'pangea-asset-edit-dialog', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'pangea-asset-edit-title' },
                h('div', { style: styles.row }, h('h2', { id: 'pangea-asset-edit-title', style: { ...styles.itemTitle, margin: 0 } }, '编辑资产信息'), h('span', { style: styles.chip }, `修订 r${asset.revision ?? 1}`)),
                h('div', { className: 'pangea-asset-edit-fields' },
                  h('label', { style: styles.field }, h('span', { style: styles.label }, '资产分类'),
                  h('select', { 'aria-label': '编辑资产分类', style: styles.input, value: editType, onChange: event => setEditType(event.target.value) }, TYPES.filter(([value]) => value && (!state?.asset_types?.length || state.asset_types.includes(value))).map(([value, label]) => h('option', { key: value, value }, label))),
                  ),
                  h('label', { style: styles.field }, h('span', { style: styles.label }, '资产标题'),
                  h('input', { 'aria-label': '编辑资产标题', style: { ...styles.input, ...styles.grow }, value: editTitle, onChange: event => setEditTitle(event.target.value) }),
                  ),
                  h('label', { style: styles.field }, h('span', { style: styles.label }, '关联仓库'),
                  h('input', { 'aria-label': '关联仓库', placeholder: '仓库 ID，逗号分隔', style: { ...styles.input, ...styles.grow }, value: editRepositories, onChange: event => setEditRepositories(event.target.value) }),
                  ),
                  h('label', { style: styles.field }, h('span', { style: styles.label }, '模块标签'),
                  h('input', { 'aria-label': '模块标签', placeholder: '模块标签，逗号分隔', style: { ...styles.input, ...styles.grow }, value: editModules, onChange: event => setEditModules(event.target.value) }),
                  ),
                  h('label', { style: styles.field }, h('span', { style: styles.label }, '语言标签'),
                  h('input', { 'aria-label': '语言标签', placeholder: '语言标签，逗号分隔', style: { ...styles.input, ...styles.grow }, value: editLanguages, onChange: event => setEditLanguages(event.target.value) })),
                h('div', { className: 'pangea-asset-edit-actions' },
                  h('button', { type: 'button', disabled: busy || !editTitle.trim(), style: { ...styles.button, ...styles.primary }, onClick: () => { void saveEdit(asset.asset_id) } }, '保存'),
                  h('button', { type: 'button', style: styles.button, onClick: () => setEditingAssetId('') }, '取消'))))) : null,
              isExpanded ? h('div', { style: { marginTop: 9, borderTop: '1px solid var(--dsw-alias-border-l2, #444)', paddingTop: 9 } },
                h('details', { style: { margin: '12px 0 20px' } }, h('summary', { style: styles.meta }, '文件与版本信息'),
                  h('dl', { className: 'pangea-asset-fields', style: { display: 'grid', gridTemplateColumns: '110px minmax(0,1fr)', gap: 12, fontSize: 14 } },
                    [['资产编号', asset.asset_id], ['文件路径', asset.source_path], ['模块标签', (asset.module_tags ?? []).join('、') || '未设置'], ['语言标签', (asset.language_tags ?? []).join('、') || '未设置']].map(([label, value]) => h(React.Fragment, { key: label }, h('dt', null, label), h('dd', { style: { margin: 0, overflowWrap: 'anywhere' } }, value))))),
                asset.status === 'no_items' ? h('div', { style: styles.meta }, '未提取到可用内容，请检查文件正文或解析提示。') : null,
                asset.last_error ? h('div', { style: styles.error }, `最近解析失败：${asset.last_error}；已有解析结果保留。`) : null,
                asset.result_stale ? h('div', { style: styles.meta }, '原结构化成果已保留；解析内容发生变化，旧成果不作为新任务输入。') : null,
                detail?.normalization ? h('details', null, h('summary', null, '解析信息与字段映射'), h('pre', { style: styles.pre }, JSON.stringify(detail.normalization, null, 2))) : null,
                asset.warnings?.length ? h('div', { style: styles.meta }, `提示：${asset.warnings.join('；')}`) : null,
                detail?.failure_record ? h('div', { style: { ...styles.error, marginTop: 8 } },
                  h('div', null, detail.failure_record.last_error ?? '资产处理失败'),
                  h('button', { type: 'button', style: { ...styles.button, marginTop: 7 }, onClick: () => downloadFailureRecord(detail) }, '下载失败记录')) : null,
                state?.features?.item_review !== false && detail?.asset?.asset_type === 'historical_defect' && !asset.result_stale && detail?.result?.items?.length ? h('div', { style: { ...styles.card, marginTop: 10, marginBottom: 10 } },
                  h('div', { style: styles.row },
                    h('div', { style: styles.itemTitle }, '逐条审核历史缺陷'),
                    detail.review ? h('span', { style: styles.chip }, `待审核 ${detail.review.counts?.pending ?? 0} · 已接受 ${detail.review.counts?.accepted ?? 0} · 已拒绝 ${detail.review.counts?.rejected ?? 0}`) : null),
                  reviewItemsFor(asset.asset_id, detail).map(item => h('div', { key: item.item_id, style: { ...styles.resultItem, marginTop: 9 } },
                    h('div', { style: styles.row },
                      h('div', { style: styles.itemTitle }, `${item.item_id} · ${item.title ?? '未命名缺陷'}`),
                      h('select', { 'aria-label': `审核状态 ${item.item_id}`, style: styles.input, value: item.decision, onChange: event => updateReviewDraft(asset.asset_id, item.item_id, 'decision', event.target.value) },
                        h('option', { value: 'pending' }, '待定'), h('option', { value: 'accepted' }, '接受'), h('option', { value: 'rejected' }, '拒绝'))),
                    item.symptom ? h('div', { style: styles.meta }, `现象：${item.symptom}`) : null,
                    item.defect_mechanism ? h('div', { style: styles.meta }, `机制：${item.defect_mechanism}`) : null,
                    h('input', { 'aria-label': `审核备注 ${item.item_id}`, placeholder: '审核备注（可选）', style: { ...styles.input, ...styles.grow, marginTop: 6 }, value: item.note ?? '', onChange: event => updateReviewDraft(asset.asset_id, item.item_id, 'note', event.target.value) }))),
                  h('button', { type: 'button', disabled: busy || !detail.review, style: { ...styles.button, ...styles.primary, marginTop: 10 }, onClick: () => { void saveReviewItems(asset.asset_id, detail) } }, '保存逐条审核')) : null,
                detail?.result ? renderStructuredResult(detail.result) : h('p', { role: 'status', style: styles.meta }, !detail ? error ? '资产详情暂不可用，请刷新重试。' : '正在加载资产详情…' : '提取内容将在处理完成后显示。'),
                detail?.normalized_preview ? h('details', { style: { marginTop: 24 } }, h('summary', { style: styles.itemTitle }, '原文件内容'), h('pre', { style: styles.pre }, detail.normalized_preview)) : null) : null)
          }) : waitingForAssets ? h('div', { className: 'pangea-asset-loading-state' },
            h('div', { className: 'pangea-asset-loading-note', role: 'status' },
              h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: 'M12 11v5M12 8h.01' })),
              h('div', null, h('strong', null, '正在读取测试资产'), h('p', null, '正在获取当前工作空间的资料与处理状态。'))),
            h('div', { className: 'pangea-asset-skeletons', 'aria-hidden': true }, Array.from({ length: 5 }, (_, index) => h('div', { key: index, className: 'pangea-asset-skeleton-row' },
              h('div', { className: 'pangea-asset-skeleton-main' }, h('div', { className: 'pangea-asset-skeleton-line' }), h('div', { className: 'pangea-asset-skeleton-line is-short' })),
              h('div', { className: 'pangea-asset-skeleton-line is-tag' })))))
            : h('div', { className: `pangea-asset-empty${hasAppliedFilters || section !== 'library' ? ' is-compact' : ''}${!error && !assets.length && !hasAppliedFilters && section === 'library' ? ' is-first-use' : ''}`, role: error ? 'alert' : undefined },
              error ? h(React.Fragment, null,
                h('div', { className: 'pangea-asset-empty-icon', 'aria-hidden': true }, emptyIcon()),
                h('div', { style: styles.itemTitle }, '暂时无法读取资产库'),
                h('p', { className: 'pangea-asset-empty-copy' }, '当前工作空间的资产数据未能返回。现有文件与记录仍然保留。'),
                h('button', { type: 'button', disabled: loading, style: { ...styles.button, ...styles.primary, marginTop: 18 }, onClick: () => { void load() } }, loading ? '正在重新读取…' : '重新读取'))
              : hasAppliedFilters ? h(React.Fragment, null,
                h('div', { className: 'pangea-asset-empty-icon', 'aria-hidden': true }, emptyIcon('search')),
                h('div', { style: styles.itemTitle }, '没有符合条件的资产'),
                h('p', { className: 'pangea-asset-empty-copy' }, '调整关键词或筛选条件，继续浏览已有资料。'),
                h('button', { type: 'button', style: { ...styles.button, marginTop: 18 }, onClick: clearFilters }, '查看全部结果'))
              : section === 'library' ? h(React.Fragment, null,
                h('div', { className: 'pangea-asset-empty-icon', 'aria-hidden': true }, emptyIcon()),
                h('div', { className: 'pangea-asset-empty-title', style: styles.itemTitle }, '建立可复用的分析资料库'),
                h('p', { className: 'pangea-asset-empty-copy' }, '加入需求、设计、历史缺陷或覆盖率文件。核对后的内容可以直接带入新分析。'),
                h('button', { type: 'button', style: { ...styles.button, ...styles.primary, marginTop: 0, display: 'inline-flex', alignItems: 'center', gap: 7, fontWeight: 400, lineHeight: 'normal' }, onClick: openImport }, plusIcon(), '导入第一个资产'))
                : h(React.Fragment, null,
                  h('div', { className: 'pangea-asset-empty-icon', 'aria-hidden': true }, emptyIcon()),
                  h('div', { style: styles.itemTitle }, section === 'review' ? '没有待审核资产' : section === 'archived' ? '没有已归档资产' : '正在加载资产…'),
                  h('p', { className: 'pangea-asset-empty-copy' }, section === 'review' ? '提取完成的资料会出现在这里，审核通过后即可用于分析。' : '已删除或归档的资产会显示在这里。')),
            !waitingForAssets && !error && !hasAppliedFilters && section === 'library' ? h('div', { className: 'pangea-asset-empty-steps' },
              [['01 · 导入原始材料', '保留资料原文与资料类型。'], ['02 · 提取并核对内容', '历史缺陷审核后进入可用状态。'], ['03 · 用于新的分析', '创建分析时冻结所选资产版本。']].map(([heading, hint]) => h('div', { key: heading, className: 'pangea-asset-empty-step' }, h('strong', null, heading), h('span', null, hint)))) : null)) : null,
          !importOpen && !activeAsset && section === 'library' && (selectedAssetIds.length > 0 || (!hasAppliedFilters && Number(summary.total ?? pagination.total) > 0)) ? h('div', { className: `pangea-asset-selection${selectedAssetIds.length ? '' : ' is-empty'}` },
            h('div', null,
              h('div', { className: 'pangea-asset-selection-title' }, selectedAssetIds.length ? h(React.Fragment, null, '已选择 ', h('strong', null, selectedAssetIds.length), ' 个可用资产') : '尚未选择资产'),
              h('div', { className: 'pangea-asset-meta', style: styles.meta }, selectedHistoricalIds.length
                ? `其中 ${selectedHistoricalIds.length} 个已批准历史缺陷可交给语义 Agent 生成方法论候选。`
                : selectedAssetIds.length ? '新建分析时会作为结构化输入提交。' : '选择可用资料后，可将其带入新分析。')),
            h('div', { style: styles.wrap },
              selectedHistoricalIds.length ? h('button', { type: 'button', disabled: busy, style: styles.button, onClick: () => { void act('generate_methodology', { asset_ids: selectedHistoricalIds }) } }, '用 Skill 生成方法论候选') : null,
              h('button', { type: 'button', disabled: busy || selectedAssetIds.length === 0, style: { ...styles.button, background: 'transparent', borderColor: '#ffffff40', color: '#fff' }, onClick: () => setSelectedAssets({}) }, '清空选择'),
              h('button', { type: 'button', disabled: busy || selectedAssetIds.length === 0, style: { ...styles.button, ...styles.primary, background: '#fff', borderColor: '#fff', color: '#25292e' }, onClick: createRunFromSelection },
                h('svg', { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.65, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'M7 17 17 7' }), h('path', { d: 'M7 7h10v10' })),
                '用于新分析'))) : null,
          showLibrary && !activeAsset && pagination.total > 0 ? h('nav', { 'aria-label': '资产分页', style: { ...styles.row, marginTop: 17 } },
            h('div', { style: styles.meta }, `共 ${pagination.total} 个资产 · 第 ${pagination.page} / ${pagination.total_pages} 页`),
            h('div', { style: styles.wrap },
              h('select', { 'aria-label': '每页资产数量', disabled: loading, style: styles.input, value: pagination.page_size, onChange: event => { setPage(1); setPageSize(Number(event.target.value)) } }, [20, 50, 100].map(value => h('option', { key: value, value }, `每页 ${value} 个`))),
              h('button', { type: 'button', disabled: loading || pagination.page <= 1, style: styles.button, onClick: () => setPage(pagination.page - 1) }, '上一页'),
              h('button', { type: 'button', disabled: loading || pagination.page >= pagination.total_pages, style: styles.button, onClick: () => setPage(pagination.page + 1) }, '下一页'))) : null)), assistant))
    }

    const icon = h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 }, h('path', { d: 'M4 5.5h6l2 2H20v11H4z' }), h('path', { d: 'M8 12h8M8 15h6' }))

    function apply(ctx) {
      if (!ctx.pangea) return
      ctx.effect(() => ctx.pangea.registerPage({
        id: 'assets', title: () => '资产管理', icon, order: 30,
        available: (_ctx, scope) => Boolean(scope?.cwd),
        component: props => h(AssetPanel, { ...props, ctx }),
      }), 'dsh-pangea-asset-catalog: asset page')
    }

    exports.inject = inject
    exports.requestState = requestState
    exports.requestAssetDetail = requestAssetDetail
    exports.requestMethodologyDetail = requestMethodologyDetail
    exports.requestAction = requestAction
    exports.openAnalysisSession = openAnalysisSession
    exports.resolveWorkspaceCwd = resolveWorkspaceCwd
    exports.apply = apply
    return module.exports
  },
})
