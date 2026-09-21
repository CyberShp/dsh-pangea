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
      ['historical_defect', '历史缺陷'], ['reference', '参考资料'], ['coverage', 'Coverage'],
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
        height: '100%', overflow: 'auto', color: 'var(--dsw-alias-label-primary, #17191d)', background: 'var(--dsw-alias-bg-base, #f5f6f8)',
        fontFamily: '"Huawei Sans", "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei UI", sans-serif',
        fontSize: 16, WebkitFontSmoothing: 'antialiased',
      },
      header: { position: 'sticky', top: 0, zIndex: 3, padding: '20px 28px 16px', background: 'var(--dsw-alias-bg-layer-1, #fff)', borderBottom: '1px solid var(--dsw-alias-border-l2, #dce1e7)' },
      content: { padding: '24px 28px 32px' },
      row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
      wrap: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
      title: { fontSize: 24, fontWeight: 700, margin: 0, lineHeight: 1.4 }, itemTitle: { fontSize: 18, fontWeight: 680, overflowWrap: 'anywhere', lineHeight: 1.5 },
      meta: { color: 'var(--dsw-alias-label-secondary, #596273)', fontSize: 16, lineHeight: 1.5, marginTop: 5, overflowWrap: 'anywhere' },
      card: { border: '1px solid var(--dsw-alias-border-l2, #dce1e7)', borderRadius: 12, padding: 20, marginBottom: 14, background: 'var(--dsw-alias-bg-layer-1, #fff)' },
      notice: { borderColor: 'var(--dsw-alias-state-business-secondary, #e05b65)' },
      error: { borderColor: 'var(--dsw-alias-state-error-secondary, #e66767)', color: 'var(--dsw-alias-state-error-primary, #e66767)' },
      button: { border: '1px solid var(--dsw-alias-border-l2, #dce1e7)', background: 'var(--dsw-alias-bg-layer-1, #fff)', color: 'inherit', borderRadius: 8, padding: '10px 16px', minHeight: 44, cursor: 'pointer', fontSize: 16, fontFamily: 'inherit', lineHeight: 1.4 },
      primary: { background: 'var(--dsw-alias-state-business-primary, #c7000b)', borderColor: 'var(--dsw-alias-state-business-primary, #c7000b)', color: '#fff', fontWeight: 700 },
      active: { background: 'var(--dsw-alias-state-business-tertiary, #fff0f1)', borderColor: 'var(--dsw-alias-state-business-secondary, #e05b65)', color: 'var(--dsw-alias-state-business-primary, #c7000b)', fontWeight: 700 },
      input: { boxSizing: 'border-box', maxWidth: '100%', minHeight: 44, border: '1px solid var(--dsw-alias-border-l2, #dce1e7)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-1, #fff)', color: 'inherit', padding: '10px 12px', fontSize: 16, fontFamily: 'inherit' },
      field: { display: 'grid', gap: 6, minWidth: 0 },
      label: { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-secondary, #596273)' },
      grow: { flex: '1 1 180px', minWidth: 0 },
      chip: { borderRadius: 6, padding: '4px 8px', background: 'var(--dsw-alias-bg-layer-3, #f1f3f6)', fontSize: 14, lineHeight: 1.5, overflowWrap: 'anywhere' },
      pre: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 360, overflow: 'auto', fontSize: 16, lineHeight: 1.5 },
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
      const [details, setDetails] = React.useState({})
      const [reviewDrafts, setReviewDrafts] = React.useState({})
      const [importPath, setImportPath] = React.useState('')
      const [importFile, setImportFile] = React.useState(null)
      const [importOpen, setImportOpen] = React.useState(false)
      const [importType, setImportType] = React.useState('requirement')
      const [importTitle, setImportTitle] = React.useState('')
      const [selectedAssets, setSelectedAssets] = React.useState({})
      const [editingAssetId, setEditingAssetId] = React.useState('')
      const [editTitle, setEditTitle] = React.useState('')
      const [editType, setEditType] = React.useState('')
      const [editRepositories, setEditRepositories] = React.useState('')
      const [editModules, setEditModules] = React.useState('')
      const [editLanguages, setEditLanguages] = React.useState('')
      const [expandedMethodology, setExpandedMethodology] = React.useState('')
      const [methodologyDetails, setMethodologyDetails] = React.useState({})
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
            : (body.models ?? []).filter(item => item.credential_configured).map(item => ({ value: JSON.stringify({ provider: item.provider, model: item.model }), label: `${item.provider} / ${item.model}` }))
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

      const load = React.useCallback(async signal => {
        if (!cwd) return
        setLoading(true)
        try {
          setError('')
          const value = await requestState({ cwd, page, pageSize, type, status, kind, query, signal })
          if (!signal?.aborted) { setState(value); if (activeAsset && detailPending.current !== activeAsset.asset_id) { const fresh = await requestAssetDetail({ cwd, assetId: activeAsset.asset_id, signal }); if (!signal?.aborted) { setDetails(current => ({ ...current, [activeAsset.asset_id]: fresh })); setActiveAsset(fresh.asset) } } }
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
        if (importPending.current || busy || (!importFile && !importPath.trim())) return
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

      function startEdit(asset) {
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
      const showLibrary = section !== 'methodologies' && !importOpen
      const displayAssets = activeAsset ? [activeAsset] : assets
      const hasAppliedFilters = Boolean(type || kind || query || (section === 'library' && status))
      const hasFilters = hasAppliedFilters || Boolean(queryDraft)
      const waitingForAssets = loading || (!state && !error)
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
      const showAssistant = importOpen || Boolean(activeAsset)
      const processingSettings = h('div', null,
        h('p', { style: styles.meta }, '用于下一次处理；切换配置不会影响已有结果。'),
        h('label', { style: { display: 'block', marginTop: 20 } }, 'Agent',
          h('select', { 'aria-label': '资产解析执行器', style: { ...styles.input, width: '100%', marginTop: 8 }, value: executor, disabled: busy, onChange: event => { setExecutor(event.target.value); setSelectedModel('') } },
            h('option', { value: '' }, '内置 API'), executorOptions.map(item => h('option', { key: item.id, value: item.id, disabled: !item.registered || item.available === false }, item.label)))),
        h('label', { style: { display: 'block', marginTop: 16 } }, '模型',
          h('select', { 'aria-label': '资产解析模型', style: { ...styles.input, width: '100%', marginTop: 8 }, value: selectedModel, disabled: busy || modelLoading, onChange: event => setSelectedModel(event.target.value) },
            h('option', { value: '' }, modelLoading ? '读取模型中…' : executor && !modelOptions.length ? '执行器默认模型' : '选择模型'), modelOptions.map(item => h('option', { key: item.value, value: item.value }, item.label)))),
        modelError ? h('p', { role: 'alert', style: styles.error }, modelError) : null,
        !modelLoading && !modelError && !executor && !modelOptions.length ? h('p', { style: styles.meta }, '当前没有已配置的 API 模型。可选择可用 Agent，或前往设置配置模型。') : null)
      const assistant = showAssistant ? h('aside', { className: 'pangea-asset-assistant', 'aria-label': '资产 AI 助手' },
        h('h2', { style: { ...styles.itemTitle, margin: 0 } }, importOpen ? '处理设置' : '处理记录'),
        coverageOnly ? h('p', { style: styles.meta }, '覆盖率文件由本机直接解析，无需选择 Agent 或模型。')
          : importOpen ? processingSettings : h('details', { style: { marginTop: 16 } }, h('summary', null, '重新处理设置'), processingSettings),
        !importOpen ? h('h3', { style: { ...styles.meta, marginTop: 24 } }, assistantAsset?.title) : null,
        job ? h(React.Fragment, null,
          h('p', { style: { fontWeight: 650 } }, jobLabel[job.status] ?? '等待处理'),
          h('p', { style: styles.meta }, `${job.provider_id ? executorOptions.find(item => item.id === job.provider_id)?.label ?? job.provider_id : modelLabel ? '内置 API' : '文件解析'}${modelLabel ? ` · ${modelLabel}` : ''}`),
          renderJob(job),
          job.status === 'needs_attention' ? h('button', { type: 'button', style: styles.button, disabled: busy, onClick: () => { void act('extract', { asset_id: assistantAsset.asset_id, provider_id: job.provider_id, ...(job.provider_id ? { agent_model: job.model } : { model_route: job.model }) }) } }, '原会话继续修正') : null,
          ['failed', 'interrupted', 'needs_attention'].includes(job.status) ? h('button', { type: 'button', style: { ...styles.button, ...styles.primary }, disabled: busy, onClick: () => { void act('extract', { asset_id: assistantAsset.asset_id, restart: true }) } }, '重新处理资产') : null,
          (job.history ?? []).map((past, index) => h('details', { key: index, style: { marginTop: 20 } }, h('summary', { style: styles.itemTitle }, `历史处理 · ${assetTime(past.started_at)}`), renderJob(past))))
          : h('p', { style: { ...styles.meta, marginTop: 20 } }, importOpen ? '导入后进入资产详情，查看处理状态与提取内容。' : '处理结果保存在左侧详情中。')) : null
      return h('div', { className: 'pangea-asset-root', style: styles.root, role: 'region', 'aria-label': 'PANGEA 资产管理' },
        h('style', null, `
          .pangea-asset-root{container-type:inline-size;container-name:pangea-assets}
          .pangea-asset-root *{box-sizing:border-box}
          .pangea-asset-layout{display:grid;grid-template-columns:minmax(0,1fr);min-height:100%}
          .pangea-asset-layout.has-assistant{grid-template-columns:minmax(0,1fr) minmax(280px,320px)}
          .pangea-asset-content{max-width:1360px;margin:0 auto}
          .pangea-asset-assistant{padding:24px;border-left:1px solid var(--dsw-alias-border-l2,#dce1e7);position:sticky;top:0;align-self:start;max-height:100vh;overflow:auto;background:var(--dsw-alias-bg-layer-1,#fff)}
          .pangea-asset-tabs{display:flex;gap:24px;overflow-x:auto;margin-top:16px}
          .pangea-asset-tabs button{border:0;border-bottom:3px solid transparent;border-radius:0;background:transparent;padding:12px 0;white-space:nowrap}
          .pangea-asset-tabs button[aria-current=page]{border-bottom-color:#c7000b;color:#a6000a;font-weight:700}
          .pangea-asset-form-grid{display:grid;grid-template-columns:minmax(150px,1fr) minmax(0,2fr);gap:20px;margin-top:24px}
          .pangea-asset-file{padding:22px;border:1px dashed #bac4d1;border-radius:10px;background:#fafbfc;margin-top:20px}
          .pangea-asset-file input{width:100%;border:0;background:transparent;padding:8px 0}
          .pangea-asset-file input::file-selector-button{padding:10px 16px;border:1px solid #dce1e7;border-radius:8px;background:white;font:inherit;margin-right:14px;cursor:pointer}
          .pangea-asset-table{width:100%;border-collapse:collapse;font-size:14px;line-height:1.6}
          .pangea-asset-table th,.pangea-asset-table td{text-align:left;padding:14px 12px;border-bottom:1px solid #e5e9ef;overflow-wrap:anywhere}
          .pangea-asset-table th{background:#f7f8fa;color:#596273;font-weight:600;white-space:nowrap}
          .pangea-asset-table td:nth-child(2){min-width:180px}
          .pangea-asset-root :is(button,input,select,summary):focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#c7000b);outline-offset:3px}
          .pangea-asset-root button:disabled{opacity:.5;cursor:not-allowed}
          .pangea-asset-root button:not(:disabled):hover{filter:brightness(.96)}
          .pangea-asset-root input[type=checkbox]{width:18px;height:18px;margin:4px 0;flex-shrink:0;accent-color:var(--dsw-alias-state-business-primary,#c7000b)}
          .pangea-asset-root summary{cursor:pointer}
          @container pangea-assets (max-width:960px){.pangea-asset-layout.has-assistant{grid-template-columns:minmax(0,1fr)}.pangea-asset-assistant{position:static;border-left:0;border-top:1px solid var(--dsw-alias-border-l2,#dce1e7);max-height:none}}
          @container pangea-assets (max-width:600px){.pangea-asset-root .pangea-asset-header,.pangea-asset-root .pangea-asset-content,.pangea-asset-assistant{padding:16px!important}.pangea-asset-root .pangea-asset-fields,.pangea-asset-form-grid{grid-template-columns:minmax(0,1fr)!important;gap:12px!important}.pangea-asset-fields dd{margin-bottom:12px!important}.pangea-asset-tabs{gap:18px}}
        `),
        h('div', { className: `pangea-asset-layout${showAssistant ? ' has-assistant' : ''}` }, h('main', { style: { minWidth: 0 } },
        h('div', { className: 'pangea-asset-header', style: styles.header },
          h('div', { style: styles.row }, h('div', null, h('h1', { style: styles.title }, '资产管理'), h('div', { style: styles.meta }, '导入资料、审核内容，用于后续分析。')),
            h('div', { style: styles.wrap },
              h('button', { type: 'button', disabled: busy || loading || detailLoading, style: styles.button, onClick: () => { if (activeAsset) void toggle(activeAsset.asset_id, true); else void load() } }, loading || detailLoading ? '刷新中…' : '刷新'),
              !importOpen ? h('button', { type: 'button', disabled: busy, style: { ...styles.button, ...styles.primary }, onClick: () => { setActiveAsset(null); setImportOpen(true); setNotice(''); setError('') } }, '导入资产') : null)),
          h('nav', { className: 'pangea-asset-tabs', 'aria-label': '资产管理导航' },
            [['library', '资产库'], ['review', '待审核'], ['methodologies', '方法论'], ['archived', '已删除 / 已归档']].map(([value, label]) =>
              h('button', { key: value, type: 'button', disabled: busy, 'aria-current': section === value && !importOpen ? 'page' : undefined,
                style: { font: 'inherit', cursor: 'pointer', minHeight: 44 }, onClick: () => navigate(value) }, label)))),
        h('div', { className: 'pangea-asset-content', style: styles.content },
          activeAsset || importOpen ? h('button', { type: 'button', disabled: busy, style: { ...styles.button, marginBottom: 12 }, onClick: () => { setActiveAsset(null); setImportOpen(false); setEditingAssetId(''); setError(''); setNotice('') } }, '返回列表') : null,
          showLibrary && !activeAsset && state ? h('div', { style: { ...styles.wrap, marginBottom: 16 }, 'aria-label': '当前结果概览' },
            h('span', { style: styles.label }, '当前结果'),
            [['资产', summary.total ?? pagination.total], ['可用', summary.available ?? 0], ['待审核', summary.review ?? 0], ['失败', summary.failed ?? 0]].map(([label, count]) =>
              h('span', { key: label, style: styles.chip }, `${label} ${count}`))) : null,
          importOpen ? h('section', { style: styles.card, 'aria-label': '导入新资产', 'aria-busy': busy },
            h('h2', { style: { ...styles.itemTitle, margin: 0 } }, '导入新资产'),
            h('p', { style: styles.meta }, '选择资料 → 提取内容 → 审核并用于分析'),
            h('div', { className: 'pangea-asset-form-grid' },
              h('label', { style: styles.field }, h('span', { style: styles.label }, '1. 资产类型'),
                h('select', { 'aria-label': '资产类型', disabled: busy, style: styles.input, value: importType, onChange: event => setImportType(event.target.value) }, TYPES.filter(([value]) => value && (!state?.asset_types?.length || state.asset_types.includes(value))).map(([value, label]) => h('option', { key: value, value }, label)))),
              h('label', { style: styles.field }, h('span', { style: styles.label }, '资产标题（可选）'),
                h('input', { 'aria-label': '资产标题', disabled: busy, placeholder: '留空时使用文件名', style: styles.input, value: importTitle, onChange: event => setImportTitle(event.target.value) }))),
            h('div', { className: 'pangea-asset-file' },
              h('label', { style: styles.field }, h('span', { style: styles.label }, '2. 选择文件'),
                h('input', { type: 'file', 'aria-label': '选择资产文件', disabled: busy, accept: coverageOnly ? '.xlsx,.json' : '.md,.txt,.pdf,.docx,.xlsx', onChange: event => { setImportFile(event.target.files?.[0] ?? null); setImportPath('') } })),
              h('p', { style: { ...styles.meta, fontSize: 14 } }, coverageOnly ? '支持 XLSX、覆盖率 combined JSON；上传上限 24 MiB。' : '支持 Markdown、TXT、PDF、Word、Excel；上传上限 24 MiB。'),
              importFile ? h('div', { role: 'status', style: styles.chip }, `已选择：${importFile.name} · ${(importFile.size / 1024).toFixed(1)} KB`) : null,
              h('details', { style: { marginTop: 12 } }, h('summary', { style: styles.meta }, '使用本机文件路径'),
                h('input', { 'aria-label': '资产文件路径', disabled: busy, placeholder: '文件绝对路径', style: { ...styles.input, width: '100%', marginTop: 8 }, value: importPath, onChange: event => { setImportPath(event.target.value); if (event.target.value) setImportFile(null) } }))),
            h('div', { style: { ...styles.row, paddingTop: 24, marginTop: 24, borderTop: '1px solid #e5e9ef' } },
              h('p', { style: { ...styles.meta, flex: '1 1 260px', margin: 0 } }, coverageOnly ? '直接解析覆盖率，完成后查看记录。' : importType === 'historical_defect' ? '提取完成后进入待审核，通过后可用于分析。' : '使用处理设置中的 Agent 与模型提取资料。'),
              h('button', { type: 'button', disabled: busy || (!importFile && !importPath.trim()), style: { ...styles.button, ...styles.primary }, onClick: () => { void submitImport() } }, busy ? '正在导入…' : '导入并处理'))) : null,
          notice ? h('div', { style: { ...styles.card, ...styles.notice }, role: 'status' }, notice) : null,
          error ? h('div', { style: { ...styles.card, ...styles.error }, role: 'alert' },
            h('div', null, error), h('button', { type: 'button', disabled: busy || loading, style: { ...styles.button, marginTop: 12 }, onClick: () => { void load() } }, '刷新数据')) : null,
          !importOpen && selectedAssetIds.length ? h('div', { style: { ...styles.card, ...styles.notice, ...styles.row } },
            h('div', null,
              h('div', { style: styles.itemTitle }, `已选择 ${selectedAssetIds.length} 个可用资产`),
              h('div', { style: styles.meta }, selectedHistoricalIds.length
                ? `其中 ${selectedHistoricalIds.length} 个已批准历史缺陷可交给语义 Agent 生成方法论候选。`
                : '新建分析时会作为结构化输入提交。')),
            h('div', { style: styles.wrap },
              selectedHistoricalIds.length ? h('button', { type: 'button', disabled: busy, style: styles.button, onClick: () => { void act('generate_methodology', { asset_ids: selectedHistoricalIds }) } }, '用 Skill 生成方法论候选') : null,
              h('button', { type: 'button', disabled: busy, style: styles.button, onClick: () => setSelectedAssets({}) }, '清空选择'),
              h('button', { type: 'button', style: { ...styles.button, ...styles.primary }, onClick: createRunFromSelection }, '用于新分析'))) : null,
          section === 'methodologies' && !importOpen ? h('section', { style: { ...styles.card, ...styles.notice } },
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
          showLibrary && !activeAsset ? h('section', { style: { ...styles.card, padding: 16 }, 'aria-label': '筛选资产' },
            h('div', { style: { ...styles.wrap, alignItems: 'flex-end' } },
              h('label', { style: styles.field }, h('span', { style: styles.label }, '资产类型'),
                h('select', { 'aria-label': '筛选资产类型', style: styles.input, value: type, onChange: event => { setPage(1); setKind(''); setType(event.target.value) } }, TYPES.filter(([value]) => !value || !state?.asset_types?.length || state.asset_types.includes(value)).map(([value, label]) => h('option', { key: value || 'all', value }, value ? label : '全部类型')))),
              section === 'library' ? h('label', { style: styles.field }, h('span', { style: styles.label }, '处理状态'),
                h('select', { 'aria-label': '资产状态', style: styles.input, value: status, onChange: event => { setPage(1); setStatus(event.target.value) } }, STATUS_FILTERS.map(([value, label]) => h('option', { key: value || 'all-status', value }, label)))) : null,
              h('form', { role: 'search', 'aria-label': '资产关键词搜索', style: { ...styles.wrap, ...styles.grow, alignItems: 'flex-end' }, onSubmit: event => { event.preventDefault(); setPage(1); setQuery(queryDraft.trim()) } },
                h('label', { style: { ...styles.field, ...styles.grow } }, h('span', { style: styles.label }, '关键词'),
                  h('input', { type: 'search', 'aria-label': '搜索资产', placeholder: '标题、ID 或文件路径', style: styles.input, value: queryDraft, onChange: event => setQueryDraft(event.target.value) })),
                h('button', { type: 'submit', style: styles.button }, '搜索')),
              hasFilters ? h('button', { type: 'button', style: styles.button, onClick: clearFilters }, '清除筛选') : null),
            h('div', { style: { ...styles.meta, marginTop: 12 }, role: 'status', 'aria-live': 'polite' },
              waitingForAssets ? '正在加载资产…' : error && !state ? '资产列表暂不可用' : `找到 ${pagination.total} 个资产${query ? ` · 搜索“${query}”` : ''}`)) : null,
          showLibrary ? h('section', { 'aria-label': '资产列表', 'aria-busy': waitingForAssets || detailLoading }, displayAssets.length ? displayAssets.map(asset => {
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
                asset.status !== 'archived' && state?.features?.metadata !== false ? h('button', { type: 'button', disabled: busy, style: styles.button, onClick: () => startEdit(asset) }, '编辑信息') : null,
                asset.status !== 'archived' ? h('button', { type: 'button', disabled: busy, style: styles.button, onClick: () => { void act('archive', { asset_id: asset.asset_id }) } }, state?.features?.restore === false ? '归档' : '删除（可恢复）')
                  : h('button', { type: 'button', disabled: busy || state?.features?.restore === false, title: state?.features?.restore === false ? '当前分析引擎尚未提供恢复操作' : undefined, style: { ...styles.button, ...styles.primary }, onClick: () => { void act('restore', { asset_id: asset.asset_id }) } }, '恢复')) : null,
              editingAssetId === asset.asset_id ? h('div', { style: { ...styles.card, marginTop: 9, marginBottom: 0 } },
                h('div', { style: styles.itemTitle }, '编辑资产信息'),
                h('div', { style: { ...styles.wrap, marginTop: 8 } },
                  h('select', { 'aria-label': '编辑资产分类', style: styles.input, value: editType, onChange: event => setEditType(event.target.value) }, TYPES.filter(([value]) => value && (!state?.asset_types?.length || state.asset_types.includes(value))).map(([value, label]) => h('option', { key: value, value }, label))),
                  h('input', { 'aria-label': '编辑资产标题', style: { ...styles.input, ...styles.grow }, value: editTitle, onChange: event => setEditTitle(event.target.value) }),
                  h('input', { 'aria-label': '关联仓库', placeholder: '仓库 ID，逗号分隔', style: { ...styles.input, ...styles.grow }, value: editRepositories, onChange: event => setEditRepositories(event.target.value) }),
                  h('input', { 'aria-label': '模块标签', placeholder: '模块标签，逗号分隔', style: { ...styles.input, ...styles.grow }, value: editModules, onChange: event => setEditModules(event.target.value) }),
                  h('input', { 'aria-label': '语言标签', placeholder: '语言标签，逗号分隔', style: { ...styles.input, ...styles.grow }, value: editLanguages, onChange: event => setEditLanguages(event.target.value) })),
                h('div', { style: { ...styles.wrap, marginTop: 8 } },
                  h('button', { type: 'button', disabled: busy || !editTitle.trim(), style: { ...styles.button, ...styles.primary }, onClick: () => { void saveEdit(asset.asset_id) } }, '保存'),
                  h('button', { type: 'button', style: styles.button, onClick: () => setEditingAssetId('') }, '取消'))) : null,
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
          }) : h('div', { style: { ...styles.card, padding: '36px 24px', textAlign: 'center' } },
            h('div', { style: styles.itemTitle }, waitingForAssets ? '正在加载资产…' : error ? '资产暂不可用' : hasAppliedFilters ? '没有符合条件的资产' : section === 'review' ? '没有待审核资产' : section === 'archived' ? '没有已归档资产' : '开始建立你的资产库'),
            !waitingForAssets && !error ? h(React.Fragment, null,
              h('p', { style: styles.meta }, hasAppliedFilters ? '试试其他关键词，或清除筛选查看全部结果。' : section === 'review' ? '提取完成的资料会出现在这里，审核通过后即可用于分析。' : section === 'archived' ? '已删除或归档的资产会显示在这里。' : '导入需求、设计或历史缺陷，提取后即可用于新分析。'),
              hasAppliedFilters ? h('button', { type: 'button', style: styles.button, onClick: clearFilters }, '查看全部结果')
                : section === 'library' ? h('button', { type: 'button', style: { ...styles.button, ...styles.primary }, onClick: () => setImportOpen(true) }, '导入第一个资产') : null) : null)) : null,
          showLibrary && !activeAsset && pagination.total > 0 ? h('nav', { 'aria-label': '资产分页', style: { ...styles.row, marginTop: 20 } },
            h('div', { style: styles.meta }, `第 ${pagination.page} / ${pagination.total_pages} 页 · 共 ${pagination.total} 个资产`),
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
