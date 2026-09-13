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
    const TYPES = [
      ['', '全部'], ['requirement', '需求'], ['design', '设计'],
      ['historical_defect', '历史缺陷'], ['reference', '参考资料'], ['coverage', 'Coverage'],
      ['test_case_example', '用例示例'],
    ]
      const STATUS = {
      imported: '待规范化', extracting: '提取中', awaiting_review: '待人工审核',
      available: '可用于分析', no_items: '未提取到可用内容', rejected: '已拒绝',
      failed: '失败', archived: '已归档',
    }
    const STATUS_FILTERS = [
      ['', '全部状态'], ['imported', '待规范化'], ['awaiting_review', '待人工审核'],
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
        height: '100%', overflow: 'auto', color: 'var(--dsw-alias-label-primary, inherit)',
        fontFamily: '"Huawei Sans", "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei UI", sans-serif',
        fontSize: 14, WebkitFontSmoothing: 'antialiased',
      },
      header: { position: 'sticky', top: 0, zIndex: 3, padding: 14, background: 'var(--dsw-alias-bg-layer-1, #111)', borderBottom: '1px solid var(--dsw-alias-border-l2, #444)' },
      content: { padding: '14px 14px 24px' },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
      wrap: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
      title: { fontSize: 18, fontWeight: 700 }, itemTitle: { fontSize: 13, fontWeight: 680 },
      meta: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 12, lineHeight: 1.5, marginTop: 5, overflowWrap: 'anywhere' },
      card: { border: '1px solid var(--dsw-alias-border-l2, #444)', borderRadius: 9, padding: 11, marginBottom: 9, background: 'var(--dsw-alias-bg-layer-1, transparent)' },
      notice: { borderColor: 'var(--dsw-alias-state-business-secondary, #4d9ad6)' },
      error: { borderColor: 'var(--dsw-alias-state-error-secondary, #e66767)', color: 'var(--dsw-alias-state-error-primary, #e66767)' },
      button: { border: '1px solid var(--dsw-alias-border-l2, #555)', background: 'var(--dsw-alias-bg-layer-2, transparent)', color: 'inherit', borderRadius: 7, padding: '7px 10px', cursor: 'pointer', fontSize: 13 },
      primary: { background: 'var(--dsw-alias-state-business-primary, #4d9ad6)', color: '#fff', fontWeight: 700 },
      active: { background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.18))', fontWeight: 700 },
      input: { boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2, #555)', borderRadius: 6, background: 'var(--dsw-alias-bg-layer-2, #222)', color: 'inherit', padding: '7px 9px', fontSize: 13, fontFamily: 'inherit' },
      grow: { flex: '1 1 180px', minWidth: 0 },
      chip: { borderRadius: 999, padding: '3px 7px', background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.15))', fontSize: 11 },
      pre: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 360, overflow: 'auto', fontSize: 12, lineHeight: 1.5 },
      resultGrid: { display: 'grid', gap: 7 },
      resultItem: { borderLeft: '2px solid var(--dsw-alias-state-business-primary, #4d9ad6)', paddingLeft: 8 },
      methodologyGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 9, marginTop: 10 },
      methodologyCard: { border: '1px solid var(--dsw-alias-border-l2, #444)', borderRadius: 9, padding: 12, background: 'var(--dsw-alias-bg-layer-1, transparent)' },
      sourceList: { margin: '7px 0 0', paddingLeft: 17, fontSize: 12, lineHeight: 1.55 },
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

    function renderStructuredResult(result) {
      const items = structuredItems(result)
      if (items.length === 0) {
        return h('pre', { style: styles.pre }, JSON.stringify(result, null, 2))
      }
      return h('div', { style: styles.resultGrid }, items.map((item, index) => {
        const title = item?.title ?? item?.name ?? item?.item_id ?? item?.id ?? `结构化条目 ${index + 1}`
        const summary = item?.summary ?? item?.description ?? item?.mechanism ?? item?.observation ?? ''
        const source = item?.source_location ?? item?.location ?? item?.source ?? ''
        return h('div', { key: `${title}:${index}`, style: styles.resultItem },
          h('div', { style: styles.itemTitle }, String(title)),
          summary ? h('div', { style: styles.meta }, String(summary)) : null,
          source ? h('div', { style: styles.meta }, `来源：${String(source)}`) : null)
      }))
    }

    function AssetPanel({ ctx, scope, visible }) {
      const cwd = resolveWorkspaceCwd(scope, ctx.sessions)
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [busy, setBusy] = React.useState(false)
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
      const [importPreview, setImportPreview] = React.useState(null)
      const [importStrategy, setImportStrategy] = React.useState('')
      const [importConflictId, setImportConflictId] = React.useState('')
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
      const selectedAssetIds = Object.keys(selectedAssets)

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
          if (!signal?.aborted) setState(value)
        } catch (value) {
          if (value?.name !== 'AbortError') setError(value instanceof Error ? value.message : String(value))
        } finally { if (!signal?.aborted) setLoading(false) }
      }, [cwd, page, pageSize, type, status, kind, query])

      React.useEffect(() => {
        if (visible === false || !cwd) return undefined
        const controller = new AbortController()
        void load(controller.signal)
        return () => controller.abort()
      }, [visible, cwd, load])

      const active = Boolean(
        state?.assets?.some(asset => asset.status === 'extracting' || asset.extraction_job?.status === 'running')
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
          const value = await requestAction({ cwd, action, payload, page, pageSize, type, status, kind, query })
          setState(value)
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
            setNotice(action === 'import' ? '资产已导入。'
              : action === 'extract' ? '资产已完成规范化。'
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
          payload.file_name = importFile.name
          payload.file_data = await fileAsBase64(importFile)
        } else {
          payload.path = importPath.trim()
        }
        return payload
      }

      async function previewImport() {
        if (busy || (!importFile && !importPath.trim())) return
        setBusy(true); setError(''); setNotice('')
        try {
          const value = await requestAction({ cwd, action: 'preview_import', payload: await importSourcePayload(), kind })
          setImportPreview(value.preview)
          setImportStrategy(value.preview.conflicts?.length ? '' : 'create_new')
          setImportConflictId('')
        } catch (value) {
          setError(value instanceof Error ? value.message : String(value))
        } finally {
          setBusy(false)
        }
      }

      async function submitImport() {
        if (busy || !importPreview || importPreview.duplicate || !importStrategy) return
        const saved = await act('import', {
          ...await importSourcePayload(),
          confirmed_sha256: importPreview.source_sha256,
          strategy: importStrategy,
          ...(importStrategy === 'new_revision' ? { conflict_asset_id: importConflictId } : {}),
        })
        if (!saved) return
        setImportPath('')
        setImportFile(null)
        setImportTitle('')
        setImportPreview(null)
        setImportStrategy('')
        setImportConflictId('')
        setImportOpen(false)
      }

      function resetImportPreview() {
        setImportPreview(null); setImportStrategy(''); setImportConflictId('')
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
        setActiveAsset(details[assetId]?.asset ?? assets.find(item => item.asset_id === assetId) ?? { asset_id: assetId, title: '正在加载资产…' })
        setEditingAssetId('')
        if (details[assetId] && !refresh) return
        try {
          const value = await requestAssetDetail({ cwd, assetId })
          setDetails(current => ({ ...current, [assetId]: value }))
          setActiveAsset(current => current?.asset_id === assetId ? value.asset : current)
        } catch (value) { setError(value instanceof Error ? value.message : String(value)) }
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
      function navigate(value) {
        setSection(value); setActiveAsset(null); setImportOpen(false); setEditingAssetId('')
        setPage(1); setQuery(''); setQueryDraft(''); setType(''); setKind('')
        setStatus(value === 'review' ? 'awaiting_review' : value === 'archived' ? 'archived' : '')
        setError(''); setNotice('')
      }
      return h('div', { style: styles.root, role: 'region', 'aria-label': 'PANGEA 资产管理' },
        h('div', { style: styles.header },
          h('div', { style: styles.row }, h('div', { style: styles.title }, '资产管理'),
            h('div', { style: styles.wrap },
              h('button', { type: 'button', disabled: busy || loading, style: styles.button, onClick: () => { if (activeAsset) void toggle(activeAsset.asset_id, true); else void load() } }, loading ? '刷新中…' : '刷新'),
              h('button', { type: 'button', disabled: busy, style: { ...styles.button, ...styles.primary }, onClick: () => { setActiveAsset(null); setImportOpen(true) } }, '导入资产'))),
          h('nav', { 'aria-label': '资产管理导航', style: { ...styles.wrap, marginTop: 12 } },
            [['library', '资产库'], ['review', '待审核'], ['methodologies', '方法论'], ['archived', '已删除 / 已归档']].map(([value, label]) =>
              h('button', { key: value, type: 'button', disabled: busy, 'aria-current': section === value && !importOpen ? 'page' : undefined,
                style: { ...styles.button, ...(section === value && !importOpen ? styles.active : {}) }, onClick: () => navigate(value) }, label)))),
        h('div', { style: styles.content },
          activeAsset || importOpen ? h('button', { type: 'button', disabled: busy, style: { ...styles.button, marginBottom: 12 }, onClick: () => { setActiveAsset(null); setImportOpen(false); setEditingAssetId('') } }, '返回列表') : null,
          showLibrary && !activeAsset ? h('div', { style: { ...styles.meta, marginBottom: 12 } },
            `共 ${summary.total ?? 0} 个资产 · 可用 ${summary.available ?? 0} · 待审核 ${summary.review ?? 0} · 失败 ${summary.failed ?? 0}`) : null,
          importOpen ? h('div', { style: styles.card },
            h('div', { style: styles.itemTitle }, '导入新资产'),
            h('div', { style: styles.meta }, state?.features?.revisions === false ? '选择文件和类型，核对文件后导入新资产。' : '选择文件和类型，预览后导入。遇到已有内容时可选择复用，或将同名文件更新为新修订。'),
            h('div', { style: { ...styles.wrap, marginTop: 8 } },
              h('input', { type: 'file', 'aria-label': '选择资产文件', style: { ...styles.input, ...styles.grow }, onChange: event => { setImportFile(event.target.files?.[0] ?? null); setImportPath(''); resetImportPreview() } }),
              h('select', { 'aria-label': '资产类型', style: styles.input, value: importType, onChange: event => { setImportType(event.target.value); resetImportPreview() } }, TYPES.filter(([value]) => value && (!state?.asset_types?.length || state.asset_types.includes(value))).map(([value, label]) => h('option', { key: value, value }, label))),
              h('input', { 'aria-label': '资产标题', placeholder: '标题（可选）', style: { ...styles.input, ...styles.grow }, value: importTitle, onChange: event => { setImportTitle(event.target.value); resetImportPreview() } })),
            h('div', { style: { ...styles.wrap, marginTop: 7 } },
              importFile ? h('span', { style: styles.chip }, `已选择：${importFile.name}`) : null,
              h('button', { type: 'button', disabled: busy || (!importFile && !importPath.trim()), style: styles.button, onClick: () => { void previewImport() } }, busy ? '预览中…' : '预览导入')),
            h('details', { style: { marginTop: 10 } }, h('summary', { style: styles.meta }, '使用本机文件路径'),
              h('input', { 'aria-label': '资产文件路径', placeholder: '文件绝对路径', style: { ...styles.input, width: '100%', marginTop: 8 }, value: importPath, onChange: event => { setImportPath(event.target.value); if (event.target.value) setImportFile(null); resetImportPreview() } })),
            importPreview ? h('div', { style: { ...styles.card, marginTop: 10, marginBottom: 0 } },
              h('div', { style: styles.itemTitle }, '导入预览'),
              h('div', { style: styles.meta }, `${importPreview.source_name} · ${importPreview.source_size} bytes`),
              importPreview.duplicate ? h('div', { style: { ...styles.meta, marginTop: 8 } },
                `资产库已有相同内容：${importPreview.duplicate.title}，可直接查看和选用。`,
                h('button', { type: 'button', style: { ...styles.button, marginLeft: 8 }, onClick: () => { setImportOpen(false); setSection('library'); void toggle(importPreview.duplicate.asset_id) } }, '查看已有资产')) : null,
              !importPreview.duplicate ? h('div', { style: { ...styles.wrap, marginTop: 9 } },
                importPreview.conflicts?.length ? h('select', { 'aria-label': '导入冲突策略', style: styles.input, value: importStrategy, onChange: event => { setImportStrategy(event.target.value); if (event.target.value !== 'new_revision') setImportConflictId('') } },
                  h('option', { value: '' }, '请选择冲突处理方式'),
                  h('option', { value: 'create_new' }, '保留为独立新资产'),
                  h('option', { value: 'new_revision' }, '更新为已有资产的新修订')) : h('span', { style: styles.chip }, '新建独立资产'),
                importStrategy === 'new_revision' ? h('select', { 'aria-label': '新修订目标', style: styles.input, value: importConflictId, onChange: event => setImportConflictId(event.target.value) },
                  h('option', { value: '' }, '请选择已有资产'),
                  importPreview.conflicts.map(item => h('option', { key: item.asset_id, value: item.asset_id }, `${item.title} · ${item.asset_id}`))) : null,
                h('button', { type: 'button', disabled: busy || !importStrategy || (importStrategy === 'new_revision' && !importConflictId), style: { ...styles.button, ...styles.primary }, onClick: () => { void submitImport() } }, busy ? '导入中…' : '确认导入')) : null) : null) : null,
          notice ? h('div', { style: styles.card }, notice) : null,
          error ? h('div', { style: { ...styles.card, ...styles.error }, role: 'alert' }, error) : null,
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
              h('div', { style: styles.meta }, '候选由已批准历史缺陷和规范化文本生成。只有用户启用的方法论才会进入后续新 Run；内容更新后状态会自动回到待启用。')),
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
            })) : h('div', { style: { ...styles.meta, marginTop: 10 } }, '暂无候选。请先在资产库选择已批准历史缺陷，再启动语义生成会话。')) : null,
          showLibrary && !activeAsset ? h('div', { style: { ...styles.wrap, marginBottom: 10 } },
            h('select', { 'aria-label': '筛选资产类型', style: styles.input, value: type, onChange: event => { setPage(1); setKind(''); setType(event.target.value) } }, TYPES.filter(([value]) => !value || !state?.asset_types?.length || state.asset_types.includes(value)).map(([value, label]) => h('option', { key: value || 'all', value }, value ? label : '全部类型'))),
            section === 'library' ? h('select', { 'aria-label': '资产状态', style: styles.input, value: status, onChange: event => { setPage(1); setStatus(event.target.value) } }, STATUS_FILTERS.map(([value, label]) => h('option', { key: value || 'all-status', value }, label))) : null,
            h('form', { style: { ...styles.wrap, ...styles.grow }, onSubmit: event => { event.preventDefault(); setPage(1); setQuery(queryDraft.trim()) } },
              h('input', { 'aria-label': '搜索资产', placeholder: '搜索标题、ID 或路径', style: { ...styles.input, ...styles.grow }, value: queryDraft, onChange: event => setQueryDraft(event.target.value) }),
              h('button', { type: 'submit', style: styles.button }, '搜索'))) : null,
          showLibrary ? (displayAssets.length ? displayAssets.map(asset => {
            const detail = details[asset.asset_id]
            const isExpanded = activeAsset?.asset_id === asset.asset_id
            return h('div', { key: asset.asset_id, style: styles.card },
              h('div', { style: styles.row },
                h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 } },
                  asset.status === 'available' ? h('input', { type: 'checkbox', checked: selectedAssetIds.includes(asset.asset_id), 'aria-label': `选择资产 ${asset.title}`, onChange: () => toggleSelectedAsset(asset.asset_id) }) : null,
                  h('div', null, h('div', { style: styles.itemTitle }, asset.title), h('div', { style: styles.meta }, `${asset.source_name ?? asset.source_path} · ${(asset.repository_ids ?? []).join('、') || '未限定仓库'}`))),
                h('div', { style: { ...styles.wrap, justifyContent: 'flex-end' } },
                  h('span', { style: styles.chip }, TYPES.find(([value]) => value === asset.asset_type)?.[1] ?? asset.asset_type),
                  h('span', { style: styles.chip }, STATUS[asset.status] ?? asset.status),
                  !isExpanded ? h('button', { type: 'button', style: styles.button, onClick: () => { void toggle(asset.asset_id) } }, asset.status === 'awaiting_review' ? '查看并审核' : '查看详情') : null)),
              h('div', { style: styles.meta }, `修订 ${asset.revision ?? 1} · ${asset.asset_type === 'coverage' ? `覆盖记录 ${asset.structured_item_count ?? 0}` : '文档文本与附件'} · 更新于 ${assetTime(asset.updated_at)}（UTC+8）`),
              isExpanded ? h('div', { style: { ...styles.wrap, marginTop: 8 } },
                ['imported', 'available', 'no_items', 'rejected', 'failed'].includes(asset.status)
                  ? h('button', { type: 'button', disabled: busy, style: styles.button, onClick: () => { void act('extract', { asset_id: asset.asset_id }) } }, asset.status === 'imported' ? '解析原文件' : '重新解析原文件') : null,
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
                h('div', { style: styles.meta }, asset.asset_type === 'coverage' ? '重新解析更新覆盖记录和字段映射；新分析直接使用解析结果。' : '重新解析提取正文、表格和附件；实际理解与引用在分析任务中完成。已有任务继续使用冻结版本。'),
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
                detail?.result ? renderStructuredResult(detail.result) : detail?.normalized_preview
                  ? h('pre', { style: styles.pre }, detail.normalized_preview)
                  : h('div', { style: styles.meta }, '正在加载资产详情…')) : null)
          }) : h('div', { style: styles.card }, loading ? '正在加载资产…' : section === 'review' ? '没有待审核资产。' : section === 'archived' ? '没有已归档资产。' : '当前筛选没有资产，可调整条件或导入文件。')) : null,
          showLibrary && !activeAsset ? h('div', { style: { ...styles.card, ...styles.row } },
            h('div', { style: styles.meta }, `第 ${pagination.page} / ${pagination.total_pages} 页 · 共 ${pagination.total} 个资产`),
            h('div', { style: styles.wrap },
              h('select', { style: styles.input, value: pagination.page_size, onChange: event => { setPage(1); setPageSize(Number(event.target.value)) } }, [20, 50, 100].map(value => h('option', { key: value, value }, value))),
              h('button', { type: 'button', disabled: pagination.page <= 1, style: styles.button, onClick: () => setPage(pagination.page - 1) }, '上一页'),
              h('button', { type: 'button', disabled: pagination.page >= pagination.total_pages, style: styles.button, onClick: () => setPage(pagination.page + 1) }, '下一页'))) : null))
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
