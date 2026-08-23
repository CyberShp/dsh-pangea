// Browser half of the PANGEA workbench. Feature plugins register pages on
// ctx.pangea; this shell is the only PANGEA tab registered with Better Sidebar.
window.__ModuleLoader__.load({
  id: 'dsh-pangea',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const inject = ['betterSidebar']
    const TAB_ID = 'dsh-pangea:workbench'
    const STORAGE_PREFIX = 'dsh-pangea:active-page:'

    function pageTitle(page) {
      return typeof page.title === 'function' ? page.title() : page.title
    }

    function createPangeaService(betterSidebar, storage = globalThis.localStorage) {
      const pages = new Map()
      const listeners = new Set()
      const activeBySession = new Map()
      let sequence = 0
      let revision = 0
      let snapshot = Object.freeze({ revision, pages: Object.freeze([]) })

      function rebuild() {
        revision += 1
        const ordered = [...pages.values()].sort((left, right) =>
          (left.order ?? 100) - (right.order ?? 100)
          || left.sequence - right.sequence
          || left.id.localeCompare(right.id))
        snapshot = Object.freeze({ revision, pages: Object.freeze(ordered) })
        for (const listener of [...listeners]) listener()
      }

      function registerPage(descriptor) {
        if (!descriptor || typeof descriptor.id !== 'string' || descriptor.id.trim() === '') {
          throw new TypeError('PANGEA page id must be a non-empty string')
        }
        if ((typeof descriptor.title !== 'string' && typeof descriptor.title !== 'function') || typeof descriptor.component !== 'function') {
          throw new TypeError(`PANGEA page "${descriptor.id}" requires title and component`)
        }
        if (pages.has(descriptor.id)) throw new Error(`PANGEA page id already registered: ${descriptor.id}`)
        const page = Object.freeze({ ...descriptor, id: descriptor.id.trim(), sequence: sequence++ })
        pages.set(page.id, page)
        rebuild()
        let disposed = false
        return () => {
          if (disposed) return
          disposed = true
          if (pages.get(page.id) === page) {
            pages.delete(page.id)
            for (const [sessionId, pageId] of activeBySession) {
              if (pageId === page.id) activeBySession.delete(sessionId)
            }
            rebuild()
          }
        }
      }

      function subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }

      function getSnapshot() {
        return snapshot
      }

      function getPages() {
        return snapshot.pages
      }

      function isAvailable(page, ctx, scope) {
        try { return page.available ? page.available(ctx, scope) !== false : true }
        catch (error) {
          console.error(`[dsh-pangea] page availability failed: ${page.id}`, error)
          return false
        }
      }

      function storedPage(sessionId) {
        if (!sessionId || !storage?.getItem) return undefined
        try { return storage.getItem(`${STORAGE_PREFIX}${sessionId}`) ?? undefined }
        catch { return undefined }
      }

      function rememberPage(sessionId, pageId) {
        if (!sessionId) return
        activeBySession.set(sessionId, pageId)
        if (!storage?.setItem) return
        try { storage.setItem(`${STORAGE_PREFIX}${sessionId}`, pageId) } catch {}
      }

      function getActivePage(ctx, scope, candidates = getPages().filter(page => isAvailable(page, ctx, scope))) {
        if (!candidates.length) return undefined
        const sessionId = scope?.sessionId
        const preferred = activeBySession.get(sessionId) ?? storedPage(sessionId)
        const active = candidates.find(page => page.id === preferred) ?? candidates[0]
        if (sessionId && active.id !== preferred) rememberPage(sessionId, active.id)
        return active
      }

      function openPage(scope, pageId) {
        const page = pages.get(pageId)
        if (!page) return false
        rememberPage(scope?.sessionId, pageId)
        rebuild()
        betterSidebar.openTab({ type: TAB_ID }, scope)
        return true
      }

      function openFile(scope, path, title) {
        if (!scope?.sessionId || typeof path !== 'string' || path.trim() === '') return false
        betterSidebar.openFile(scope, path, title)
        return true
      }

      return Object.freeze({
        registerPage,
        openPage,
        openFile,
        getPages,
        subscribe,
        getSnapshot,
        getActivePage,
        isAvailable,
      })
    }

    const styles = {
      root: { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', color: 'var(--dsw-alias-label-primary, inherit)', background: 'var(--dsw-alias-bg-base, transparent)' },
      nav: { flex: '0 0 auto', display: 'flex', alignItems: 'stretch', gap: 2, padding: '8px 9px 0', overflowX: 'auto', borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.24))', background: 'var(--dsw-alias-bg-layer-1, #111)' },
      navButton: { flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 5, border: 0, borderBottom: '2px solid transparent', background: 'transparent', color: 'var(--dsw-alias-label-tertiary, #888)', padding: '8px 9px 7px', cursor: 'pointer', fontSize: 11 },
      navActive: { color: 'var(--dsw-alias-label-primary, inherit)', borderBottomColor: 'var(--dsw-alias-state-business-primary, #4d9ad6)', fontWeight: 720 },
      badge: { minWidth: 15, borderRadius: 999, padding: '1px 5px', background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.18))', fontSize: 9, textAlign: 'center' },
      body: { flex: '1 1 auto', minHeight: 0, overflow: 'hidden' },
      empty: { margin: 14, padding: 14, border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.24))', borderRadius: 9, color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 11, lineHeight: 1.6 },
      error: { margin: 14, padding: 14, border: '1px solid var(--dsw-alias-state-error-primary, #e66767)', borderRadius: 9, color: 'var(--dsw-alias-state-error-primary, #e66767)', fontSize: 11, lineHeight: 1.6 },
    }

    class PageBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: undefined }
      }
      static getDerivedStateFromError(error) { return { error } }
      componentDidCatch(error, info) { console.error(`[dsh-pangea] page crashed: ${this.props.pageId}`, error, info) }
      render() {
        if (this.state.error) return h('div', { style: styles.error, role: 'alert' }, `页面“${this.props.title}”加载失败。其他 PANGEA 页面仍可继续使用。`)
        return this.props.children
      }
    }

    function PangeaWorkbench(props) {
      const { ctx, scope, pangea: service } = props
      const snapshot = React.useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot)
      const available = snapshot.pages.filter(page => service.isAvailable(page, ctx, scope))
      const active = service.getActivePage(ctx, scope, available)
      if (!available.length) {
        return h('div', { style: styles.root, role: 'region', 'aria-label': 'PANGEA 工作台' },
          h('div', { style: styles.empty }, '尚未安装可用的 PANGEA 功能插件。请安装 Companion 或 Asset Catalog 后刷新 DSH。'))
      }
      const nav = h('nav', { style: styles.nav, 'aria-label': 'PANGEA 功能' }, available.map(page => {
        let badge
        try { badge = page.badge?.(ctx, scope) } catch (error) { console.error(`[dsh-pangea] page badge failed: ${page.id}`, error) }
        return h('button', {
          key: page.id,
          type: 'button',
          style: { ...styles.navButton, ...(active?.id === page.id ? styles.navActive : {}) },
          'aria-current': active?.id === page.id ? 'page' : undefined,
          onClick: () => service.openPage(scope, page.id),
        }, page.icon ?? null, h('span', null, pageTitle(page)), badge !== undefined && badge !== null ? h('span', { style: styles.badge }, badge) : null)
      }))
      const content = active
        ? h(PageBoundary, { key: active.id, pageId: active.id, title: pageTitle(active) }, h(active.component, props))
        : h('div', { style: styles.empty }, '当前没有可显示的 PANGEA 页面。')
      return h('div', { style: styles.root, role: 'region', 'aria-label': 'PANGEA 工作台' }, nav, h('div', { style: styles.body }, content))
    }

    const icon = h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 },
      h('circle', { cx: 12, cy: 12, r: 8 }), h('path', { d: 'm14.8 9.2-1.6 4-4 1.6 1.6-4z' }))

    function apply(ctx) {
      const betterSidebar = ctx.betterSidebar
      if (!betterSidebar) return
      const service = createPangeaService(betterSidebar)
      ctx.provide('pangea', service)
      ctx.effect(() => betterSidebar.registerTab({
        id: TAB_ID,
        title: () => 'PANGEA',
        icon,
        order: 55,
        single: true,
        component: props => h(PangeaWorkbench, { ...props, pangea: service }),
      }), 'dsh-pangea: workbench tab')
    }

    exports.inject = inject
    exports.createPangeaService = createPangeaService
    exports.apply = apply
    return module.exports
  },
})
