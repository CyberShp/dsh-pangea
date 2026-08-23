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
    const inject = ['pangea']
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
      metrics: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 7, marginBottom: 11 },
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
      empty: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 11, lineHeight: 1.6 },
    }

    function CatalogPanel({ scope, visible }) {
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

      async function act(action, payload = {}) {
        setBusy(true); setError(''); setNotice('')
        try {
          const value = await requestAction({ cwd, action, payload })
          setState(value)
          setNotice(action === 'generate' ? `目录文件已生成：${value.output_root}` : '建议分类已保存，并重新生成目录文件。')
        } catch (value) { setError(value instanceof Error ? value.message : String(value)) }
        finally { setBusy(false) }
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
              [['资料', state.counts.materials], ['自动化', state.counts.automations], ['待处理', state.counts.diagnostics]].map(([label, value]) => h('div', { key: label, style: styles.metric }, h('div', { style: styles.number }, value), h('div', { style: styles.label }, label)))),
            h('div', { style: styles.filters }, [['all', '全部'], ...ROLES].map(([role, label]) => h('button', { key: role, type: 'button', style: { ...styles.filter, ...(filter === role ? styles.filterActive : {}) }, onClick: () => setFilter(role) }, label))),
            filtered.length ? filtered.map(asset => h('div', { key: asset.asset_id, style: styles.card },
              h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, asset.source_path), h('span', { style: styles.chip }, asset.kind)),
              h('div', { style: styles.meta }, `${asset.parse_status} · ${asset.suggestion_source === 'user_override' ? '人工修正' : '插件建议'} · 非约束性`),
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
        id: 'asset-catalog', title: () => '资产', icon, order: 30,
        available: (_ctx, scope) => Boolean(scope?.cwd),
        component: props => h(CatalogPanel, props),
      }), 'dsh-pangea-asset-catalog: asset page')
    }

    exports.inject = inject
    exports.requestState = requestState
    exports.requestAction = requestAction
    exports.apply = apply
    return module.exports
  },
})
