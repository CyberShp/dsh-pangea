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
    ]
    const STATUS = {
      imported: '待提取', extracting: '提取中', awaiting_review: '待人工审核',
      available: '可用于分析', no_items: '已分析，无结构化条目', rejected: '已拒绝',
      failed: '失败', archived: '已归档',
    }

    function listSearch({ cwd, page = 1, pageSize = 20, type = '', status = '', query = '', assetId }) {
      return new URLSearchParams({
        cwd, page: String(page), page_size: String(pageSize),
        ...(type ? { type } : {}), ...(status ? { status } : {}),
        ...(query ? { q: query } : {}), ...(assetId ? { asset_id: assetId } : {}),
      }).toString()
    }

    async function requestState({ cwd, page = 1, pageSize = 20, type = '', status = '', query = '', signal, fetcher = fetch }) {
      const response = await fetcher(`${API_PATH}?${listSearch({ cwd, page, pageSize, type, status, query })}`, { cache: 'no-store', signal })
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

    async function requestAction({ cwd, action, payload = {}, page = 1, pageSize = 20, type = '', status = '', query = '', fetcher = fetch }) {
      const response = await fetcher(`${API_PATH}?${listSearch({ cwd, page, pageSize, type, status, query })}`, {
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

    const styles = {
      root: { height: '100%', overflow: 'auto', color: 'var(--dsw-alias-label-primary, inherit)' },
      header: { position: 'sticky', top: 0, zIndex: 3, padding: 14, background: 'var(--dsw-alias-bg-layer-1, #111)', borderBottom: '1px solid var(--dsw-alias-border-l2, #444)' },
      content: { padding: '14px 14px 24px' },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
      wrap: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
      title: { fontSize: 16, fontWeight: 760 }, itemTitle: { fontSize: 12, fontWeight: 720 },
      meta: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 10, lineHeight: 1.5, marginTop: 5, overflowWrap: 'anywhere' },
      card: { border: '1px solid var(--dsw-alias-border-l2, #444)', borderRadius: 9, padding: 11, marginBottom: 9, background: 'var(--dsw-alias-bg-layer-1, transparent)' },
      notice: { borderColor: 'var(--dsw-alias-state-business-secondary, #4d9ad6)' },
      error: { borderColor: 'var(--dsw-alias-state-error-secondary, #e66767)', color: 'var(--dsw-alias-state-error-primary, #e66767)' },
      button: { border: '1px solid var(--dsw-alias-border-l2, #555)', background: 'var(--dsw-alias-bg-layer-2, transparent)', color: 'inherit', borderRadius: 7, padding: '6px 9px', cursor: 'pointer', fontSize: 10 },
      primary: { background: 'var(--dsw-alias-state-business-primary, #4d9ad6)', color: '#fff', fontWeight: 700 },
      active: { background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.18))', fontWeight: 700 },
      input: { boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2, #555)', borderRadius: 6, background: 'var(--dsw-alias-bg-layer-2, #222)', color: 'inherit', padding: '6px 7px', fontSize: 10 },
      grow: { flex: '1 1 180px', minWidth: 0 },
      chip: { borderRadius: 999, padding: '2px 6px', background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.15))', fontSize: 9 },
      pre: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 360, overflow: 'auto', fontSize: 10, lineHeight: 1.5 },
    }

    function AssetPanel({ ctx, scope, visible }) {
      const cwd = scope?.cwd ?? ''
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [page, setPage] = React.useState(1)
      const [pageSize, setPageSize] = React.useState(20)
      const [type, setType] = React.useState('')
      const [query, setQuery] = React.useState('')
      const [queryDraft, setQueryDraft] = React.useState('')
      const [expanded, setExpanded] = React.useState({})
      const [details, setDetails] = React.useState({})
      const [importPath, setImportPath] = React.useState('')
      const [importType, setImportType] = React.useState('requirement')
      const [importTitle, setImportTitle] = React.useState('')

      const load = React.useCallback(async signal => {
        if (!cwd) return
        try {
          setError('')
          setState(await requestState({ cwd, page, pageSize, type, query, signal }))
        } catch (value) {
          if (value?.name !== 'AbortError') setError(value instanceof Error ? value.message : String(value))
        }
      }, [cwd, page, pageSize, type, query])

      React.useEffect(() => {
        if (visible === false || !cwd) return undefined
        const controller = new AbortController()
        void load(controller.signal)
        return () => controller.abort()
      }, [visible, cwd, load])

      const active = Boolean(state?.assets?.some(asset => asset.status === 'extracting' || ['queued', 'running', 'finalizing'].includes(asset.extraction_job?.status)))
      React.useEffect(() => {
        if (!active || visible === false) return undefined
        const timer = setInterval(() => { void load() }, 1500)
        return () => clearInterval(timer)
      }, [active, visible, load])

      async function act(action, payload = {}) {
        setBusy(true); setError(''); setNotice('')
        try {
          const value = await requestAction({ cwd, action, payload, page, pageSize, type, query })
          setState(value)
          setNotice(action === 'import' ? '资产已导入。' : action === 'extract' ? '结构化提取已启动。' : action === 'review' ? '审核结果已保存。' : '资产已归档。')
        } catch (value) { setError(value instanceof Error ? value.message : String(value)) }
        finally { setBusy(false) }
      }

      async function toggle(assetId) {
        if (expanded[assetId]) { setExpanded(current => ({ ...current, [assetId]: false })); return }
        setExpanded(current => ({ ...current, [assetId]: true }))
        if (details[assetId]) return
        try {
          const value = await requestAssetDetail({ cwd, assetId })
          setDetails(current => ({ ...current, [assetId]: value }))
        } catch (value) { setError(value instanceof Error ? value.message : String(value)) }
      }

      const pagination = state?.pagination ?? { page, page_size: pageSize, total: 0, total_pages: 1 }
      const assets = state?.assets ?? []
      return h('div', { style: styles.root, role: 'region', 'aria-label': 'PANGEA 资产管理' },
        h('div', { style: styles.header }, h('div', { style: styles.title }, '资产管理'), h('div', { style: styles.meta }, cwd)),
        h('div', { style: styles.content },
          h('div', { style: { ...styles.card, ...styles.notice } },
            h('div', { style: styles.itemTitle }, '导入资产'),
            h('div', { style: styles.meta }, '需求、设计、历史缺陷和参考资料会先结构化；Coverage 由 Python 直接解析。少量已有用例只在创建 Run 时作为示例提供，不进入资产库。'),
            h('div', { style: { ...styles.wrap, marginTop: 8 } },
              h('input', { 'aria-label': '资产文件路径', placeholder: '文件绝对路径', style: { ...styles.input, ...styles.grow }, value: importPath, onChange: event => setImportPath(event.target.value) }),
              h('select', { style: styles.input, value: importType, onChange: event => setImportType(event.target.value) }, TYPES.filter(([value]) => value).map(([value, label]) => h('option', { key: value, value }, label))),
              h('input', { 'aria-label': '资产标题', placeholder: '标题（可选）', style: { ...styles.input, ...styles.grow }, value: importTitle, onChange: event => setImportTitle(event.target.value) }),
              h('button', { type: 'button', disabled: busy || !importPath.trim(), style: { ...styles.button, ...styles.primary }, onClick: () => { void act('import', { path: importPath.trim(), asset_type: importType, title: importTitle.trim() }) } }, '导入'))),
          notice ? h('div', { style: styles.card }, notice) : null,
          error ? h('div', { style: { ...styles.card, ...styles.error }, role: 'alert' }, error) : null,
          h('div', { style: { ...styles.wrap, marginBottom: 10 } },
            TYPES.map(([value, label]) => h('button', { key: value || 'all', type: 'button', style: { ...styles.button, ...(type === value ? styles.active : {}) }, onClick: () => { setPage(1); setType(value) } }, label)),
            h('form', { style: { ...styles.wrap, ...styles.grow }, onSubmit: event => { event.preventDefault(); setPage(1); setQuery(queryDraft.trim()) } },
              h('input', { 'aria-label': '搜索资产', placeholder: '搜索标题、ID 或路径', style: { ...styles.input, ...styles.grow }, value: queryDraft, onChange: event => setQueryDraft(event.target.value) }),
              h('button', { type: 'submit', style: styles.button }, '搜索'))),
          assets.length ? assets.map(asset => {
            const detail = details[asset.asset_id]
            const isExpanded = Boolean(expanded[asset.asset_id])
            const job = asset.extraction_job
            return h('div', { key: asset.asset_id, style: styles.card },
              h('div', { style: styles.row },
                h('div', null, h('div', { style: styles.itemTitle }, asset.title), h('div', { style: styles.meta }, `${asset.asset_id} · ${asset.source_path}`)),
                h('div', { style: { ...styles.wrap, justifyContent: 'flex-end' } },
                  h('span', { style: styles.chip }, TYPES.find(([value]) => value === asset.asset_type)?.[1] ?? asset.asset_type),
                  h('span', { style: styles.chip }, STATUS[asset.status] ?? asset.status),
                  h('button', { type: 'button', style: styles.button, onClick: () => { void toggle(asset.asset_id) } }, isExpanded ? '收起详情' : '展开详情'))),
              h('div', { style: styles.meta }, `结构化条目 ${asset.structured_item_count} · 更新于 ${asset.updated_at}`),
              h('div', { style: { ...styles.wrap, marginTop: 8 } },
                ['imported', 'available', 'no_items', 'rejected'].includes(asset.status) && asset.asset_type !== 'coverage'
                  ? h('button', { type: 'button', disabled: busy, style: styles.button, onClick: () => { void act('extract', { asset_id: asset.asset_id }) } }, asset.status === 'imported' ? '开始提取' : '重新提取') : null,
                asset.status === 'imported' && asset.asset_type === 'coverage'
                  ? h('button', { type: 'button', disabled: busy, style: styles.button, onClick: () => { void act('extract', { asset_id: asset.asset_id }) } }, '解析 Coverage') : null,
                job?.session_id ? h('button', { type: 'button', style: styles.button, onClick: () => { void openAnalysisSession(ctx.sessions, job.session_id) } }, '打开提取会话') : null,
                asset.status === 'awaiting_review' ? h(React.Fragment, null,
                  h('button', { type: 'button', disabled: busy, style: { ...styles.button, ...styles.primary }, onClick: () => { void act('review', { asset_id: asset.asset_id, decision: 'approve' }) } }, '审核通过'),
                  h('button', { type: 'button', disabled: busy, style: styles.button, onClick: () => { void act('review', { asset_id: asset.asset_id, decision: 'reject' }) } }, '拒绝')) : null,
                asset.status !== 'archived' ? h('button', { type: 'button', disabled: busy, style: styles.button, onClick: () => { void act('archive', { asset_id: asset.asset_id }) } }, '归档') : null),
              isExpanded ? h('div', { style: { marginTop: 9, borderTop: '1px solid var(--dsw-alias-border-l2, #444)', paddingTop: 9 } },
                asset.status === 'no_items' ? h('div', { style: styles.meta }, '已完成分析，没有可结构化条目。') : null,
                asset.warnings?.length ? h('div', { style: styles.meta }, `提示：${asset.warnings.join('；')}`) : null,
                detail?.result ? h('pre', { style: styles.pre }, JSON.stringify(detail.result, null, 2)) : h('div', { style: styles.meta }, '正在加载结构化结果…')) : null)
          }) : h('div', { style: styles.card }, '当前筛选没有资产。'),
          h('div', { style: { ...styles.card, ...styles.row } },
            h('div', { style: styles.meta }, `第 ${pagination.page} / ${pagination.total_pages} 页 · 共 ${pagination.total} 个资产`),
            h('div', { style: styles.wrap },
              h('select', { style: styles.input, value: pagination.page_size, onChange: event => { setPage(1); setPageSize(Number(event.target.value)) } }, [20, 50, 100].map(value => h('option', { key: value, value }, value))),
              h('button', { type: 'button', disabled: pagination.page <= 1, style: styles.button, onClick: () => setPage(pagination.page - 1) }, '上一页'),
              h('button', { type: 'button', disabled: pagination.page >= pagination.total_pages, style: styles.button, onClick: () => setPage(pagination.page + 1) }, '下一页')))))
    }

    const icon = h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 }, h('path', { d: 'M4 5.5h6l2 2H20v11H4z' }), h('path', { d: 'M8 12h8M8 15h6' }))

    function apply(ctx) {
      if (!ctx.pangea) return
      ctx.effect(() => ctx.pangea.registerPage({
        id: 'assets', title: () => '资产', icon, order: 30,
        available: (_ctx, scope) => Boolean(scope?.cwd),
        component: props => h(AssetPanel, { ...props, ctx }),
      }), 'dsh-pangea-asset-catalog: asset page')
    }

    exports.inject = inject
    exports.requestState = requestState
    exports.requestAssetDetail = requestAssetDetail
    exports.requestAction = requestAction
    exports.openAnalysisSession = openAnalysisSession
    exports.apply = apply
    return module.exports
  },
})
