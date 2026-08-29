// Browser half of the PANGEA sidebar adapter. Feature plugins register native
// Better Sidebar tabs through ctx.pangea; there is no wrapper PANGEA tab.
window.__ModuleLoader__.load({
  id: 'dsh-pangea',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const inject = ['betterSidebar']
    const PAGE_PREFIX = 'dsh-pangea:'
    const PRODUCT_STYLE_ID = 'dsh-pangea-product-shell'
    const LEGACY_TAB_TYPES = new Set([
      'dsh-pangea-companion:pangea',
      'dsh-pangea-asset-catalog:assets',
    ])
    const BUILTIN_POLICY = {
      git: { hidden: true },
      terminal: { hidden: false, order: 40 },
      editor: { order: 40 },
      subagent: { order: 50 },
      browser: { order: 60 },
    }

    function installModuleSystemBridge(requireModule) {
      const current = globalThis.__DSH_MODULES__
      if (!current || current.__dshPangeaBridge === true) {
        globalThis.__DSH_MODULES__ = {
          __dshPangeaBridge: true,
          import: async specifier => requireModule(specifier),
        }
      }
      return globalThis.__DSH_MODULES__
    }

    installModuleSystemBridge(require)

    function installProductStyles() {
      if (typeof document === 'undefined') return () => {}
      if (document.getElementById(PRODUCT_STYLE_ID)) return () => {}
      const style = document.createElement('style')
      style.id = PRODUCT_STYLE_ID
      style.dataset.plugin = 'dsh-pangea'
      style.textContent = `
        :root { --pangea-ai-width: clamp(340px, 27vw, 452px); }

        [data-pangea-shell] {
          width: 100%; height: 100%; min-width: 0; min-height: 0;
          display: grid; grid-template-columns: 244px minmax(0, 1fr);
          color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base);
          font-family: "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        [data-pangea-product-nav] {
          box-sizing: border-box; min-width: 0; min-height: 0; display: flex; flex-direction: column;
          padding: 18px 14px 16px; border-right: 1px solid var(--dsw-alias-border-l2);
          background: color-mix(in srgb, var(--dsw-specific-sidebar-fill, #f7f8fa) 92%, white 8%);
        }
        [data-pangea-brand] { display: flex; align-items: center; gap: 9px; height: 42px; padding: 0 10px 18px; }
        [data-pangea-brand-mark] { width: 27px; height: 27px; color: #cf0a2c; flex: none; }
        [data-pangea-brand-name] { font-size: 14px; font-weight: 800; letter-spacing: .025em; }
        [data-pangea-product-name] { margin: 2px 10px 20px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.45; }
        [data-pangea-nav-list], [data-pangea-tool-list] { display: grid; gap: 7px; }
        [data-pangea-nav-button], [data-pangea-tool-button] {
          box-sizing: border-box; width: 100%; min-height: 43px; display: grid;
          grid-template-columns: 25px minmax(0, 1fr); align-items: center; gap: 10px;
          padding: 0 13px; border: 1px solid transparent; border-radius: 9px;
          color: var(--dsw-alias-label-secondary); background: transparent;
          text-align: left; font: inherit; font-size: 13px; cursor: pointer;
        }
        [data-pangea-nav-button]:hover, [data-pangea-tool-button]:hover {
          color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover);
        }
        [data-pangea-nav-button][data-active="true"] {
          color: #fff; background: #cf0a2c; box-shadow: 0 7px 18px color-mix(in srgb, #cf0a2c 22%, transparent);
        }
        [data-pangea-nav-icon] { width: 22px; height: 22px; display: grid; place-items: center; }
        [data-pangea-nav-divider] { height: 1px; margin: 17px 7px 12px; background: var(--dsw-alias-border-l1); }
        [data-pangea-tool-list] { margin-top: auto; }
        [data-pangea-page] { min-width: 0; min-height: 0; display: flex; overflow: hidden; background: var(--dsw-alias-bg-base); }
        [data-pangea-page] > * { flex: 1; min-width: 0; min-height: 0; }

        @media (min-width: 1180px) {
          body[data-pangea-product-shell] #root {
            width: 100% !important; margin-right: 0 !important;
          }
          body[data-pangea-product-shell] #root .pI_x6G_frame {
            grid-template-columns: 0 minmax(0, 1fr) var(--pangea-ai-width) !important;
          }
          body[data-pangea-product-shell] #root .pI_x6G_sidebarCol { display: none !important; }
          body[data-pangea-product-shell] #root [data-pane="details"] {
            grid-column: 2; grid-row: 1; border: 0 !important;
          }
          body[data-pangea-product-shell] #root [data-pane="conversation"] {
            grid-column: 3; grid-row: 1; min-width: 0; margin: 0 !important;
            border-left: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1);
          }
          body[data-pangea-product-shell] #root [data-pane="conversation"]::before {
            content: "AI 助手"; box-sizing: border-box; height: 58px; flex: none;
            display: flex; align-items: center; padding: 0 22px;
            border-bottom: 1px solid var(--dsw-alias-border-l2);
            color: var(--dsw-alias-label-primary); font-size: 16px; font-weight: 760;
          }
          body[data-pangea-product-shell] #root [data-pane="conversation"] > * { min-height: 0; flex: 1; }
          body[data-pangea-product-shell] #root .pI_x6G_handle { display: none !important; }
          body[data-pangea-product-shell] [data-dsh-panel-host] .nArs4W_panel {
            left: 0 !important; right: var(--pangea-ai-width) !important; width: auto !important;
            border-left: 0 !important; border-right: 1px solid var(--dsw-alias-border-l2);
            padding-top: 0 !important; transform: none !important;
          }
          body[data-pangea-product-shell] [data-dsh-panel-host] .nArs4W_panelResize,
          body[data-pangea-product-shell] [data-dsh-panel-host] .nArs4W_tabBar,
          body[data-pangea-product-shell] [data-dsh-panel-host] .nArs4W_toggleCluster {
            display: none !important;
          }
          body[data-pangea-product-shell] [data-dsh-panel-host] .nArs4W_panelBody { height: 100%; }
        }

        @media (max-width: 1179px) {
          [data-pangea-shell] { grid-template-columns: 74px minmax(0, 1fr); }
          [data-pangea-product-nav] { padding-inline: 9px; }
          [data-pangea-brand] { justify-content: center; padding-inline: 0; }
          [data-pangea-brand-name], [data-pangea-product-name], [data-pangea-nav-label] { display: none; }
          [data-pangea-nav-button], [data-pangea-tool-button] { grid-template-columns: 1fr; padding: 0; place-items: center; }
        }
      `
      document.head.appendChild(style)
      return () => style.remove()
    }

    function HuaweiMark() {
      return h('svg', { 'data-pangea-brand-mark': true, viewBox: '0 0 32 32', fill: 'currentColor', 'aria-hidden': true },
        h('path', { d: 'M15.2 14.2C11.8 10.3 10.5 6 11.7 1.4c3.1 1.9 4.9 6.4 3.5 12.8Z' }),
        h('path', { d: 'M16.8 14.2c3.4-3.9 4.7-8.2 3.5-12.8-3.1 1.9-4.9 6.4-3.5 12.8Z' }),
        h('path', { d: 'M13.7 15.2C9 13.1 6 9.7 5.5 5c3.7.7 7 4.2 8.2 10.2Z' }),
        h('path', { d: 'M18.3 15.2C23 13.1 26 9.7 26.5 5c-3.7.7-7 4.2-8.2 10.2Z' }),
        h('path', { d: 'M12.8 17C7.7 16.7 3.7 14.5 1.5 10.4c3.8-.7 8.1 1.7 11.3 6.6Z' }),
        h('path', { d: 'M19.2 17c5.1-.3 9.1-2.5 11.3-6.6-3.8-.7-8.1 1.7-11.3 6.6Z' }),
        h('path', { d: 'M13.1 19C8.5 20.6 4 20 0 17.4c3.1-2.1 7.9-1.4 13.1 1.6Z' }),
        h('path', { d: 'M18.9 19c4.6 1.6 9.1 1 13.1-1.6-3.1-2.1-7.9-1.4-13.1 1.6Z' }),
        h('path', { d: 'M5.1 22h21.8c-1.9 5.1-5.8 8.1-10.9 8.1S7 27.1 5.1 22Z' }))
    }

    function utilityIcon(kind) {
      const shapes = kind === 'terminal'
        ? [h('path', { key: 'a', d: 'm5 7 4 4-4 4' }), h('path', { key: 'b', d: 'M11 16h7' })]
        : kind === 'browser'
          ? [h('circle', { key: 'a', cx: 12, cy: 12, r: 8 }), h('path', { key: 'b', d: 'M4 12h16M12 4c2.2 2.3 3.2 5 3.2 8s-1 5.7-3.2 8c-2.2-2.3-3.2-5-3.2-8S9.8 6.3 12 4Z' })]
          : [h('path', { key: 'a', d: 'M5 3.5h9l5 5V20H5Z' }), h('path', { key: 'b', d: 'M14 3.5V9h5' })]
      return h('span', { 'data-pangea-nav-icon': true }, h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, shapes))
    }

    function ProductShell({ service, betterSidebar, page, scope, children }) {
      const snapshot = React.useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot)
      React.useEffect(() => {
        document.body.setAttribute('data-pangea-product-shell', page.id)
        return () => {
          if (document.body.getAttribute('data-pangea-product-shell') === page.id) document.body.removeAttribute('data-pangea-product-shell')
        }
      }, [page.id])
      const openUtility = (type, title) => betterSidebar.openTab({ type, title }, scope)
      return h('div', { 'data-pangea-shell': true },
        h('aside', { 'data-pangea-product-nav': true, 'aria-label': 'PANGEA 产品导航' },
          h('div', { 'data-pangea-brand': true }, h(HuaweiMark), h('span', { 'data-pangea-brand-name': true }, 'HUAWEI')),
          h('div', { 'data-pangea-product-name': true }, 'PANGEA 测试工作台'),
          h('nav', { 'data-pangea-nav-list': true }, snapshot.pages.map(item => h('button', {
            key: item.id, type: 'button', 'data-pangea-nav-button': true, 'data-active': item.id === page.id ? 'true' : 'false',
            onClick: () => service.openPage(scope, item.id),
          }, h('span', { 'data-pangea-nav-icon': true }, typeof item.icon === 'function' ? item.icon(18) : item.icon),
          h('span', { 'data-pangea-nav-label': true }, typeof item.title === 'function' ? item.title() : item.title)))),
          h('div', { 'data-pangea-nav-divider': true }),
          h('div', { 'data-pangea-tool-list': true },
            h('button', { type: 'button', 'data-pangea-tool-button': true, onClick: () => openUtility('editor', '文件') }, utilityIcon('file'), h('span', { 'data-pangea-nav-label': true }, '文件')),
            h('button', { type: 'button', 'data-pangea-tool-button': true, onClick: () => openUtility('terminal', '终端') }, utilityIcon('terminal'), h('span', { 'data-pangea-nav-label': true }, '终端')),
            h('button', { type: 'button', 'data-pangea-tool-button': true, onClick: () => openUtility('browser', '浏览器') }, utilityIcon('browser'), h('span', { 'data-pangea-nav-label': true }, '浏览器')))),
        h('main', { 'data-pangea-page': page.id }, children))
    }

    function allTabs(tree) {
      if (!tree) return []
      if (Array.isArray(tree.tabs)) return tree.tabs
      return Array.isArray(tree.children) ? tree.children.flatMap(allTabs) : []
    }

    function nativePageId(pageId) {
      return `${PAGE_PREFIX}${pageId}`
    }

    function applyBuiltinPolicy(betterSidebar) {
      for (const [id, patch] of Object.entries(BUILTIN_POLICY)) {
        const descriptor = betterSidebar.getTab(id)
        if (descriptor) Object.assign(descriptor, patch)
      }
    }

    function closeDisallowedTabs(betterSidebar, registeredNativeIds = new Set()) {
      const snapshot = betterSidebar.getSnapshot?.()
      const state = snapshot?.state
      const sessionId = snapshot?.sessionId
      if (!state || !sessionId) return
      const tabs = [...allTabs(state.splits), ...allTabs(state.bottomSplits)]
      for (const tab of tabs) {
        if (typeof tab?.type !== 'string') continue
        const isSourceControl = tab.type === 'git' || tab.type === 'diff'
        const isLegacy = LEGACY_TAB_TYPES.has(tab.type)
        const isRemovedPangeaPage = tab.type.startsWith(PAGE_PREFIX)
          && tab.type !== 'dsh-pangea:workbench'
          && !registeredNativeIds.has(tab.type)
        if (isSourceControl || isLegacy || isRemovedPangeaPage) {
          betterSidebar.closeTab(tab.id, { sessionId })
        }
      }
    }

    function installSidebarPolicy(betterSidebar, registeredNativeIds) {
      const reconcile = () => {
        applyBuiltinPolicy(betterSidebar)
        closeDisallowedTabs(betterSidebar, registeredNativeIds)
      }
      reconcile()
      const disposeRegistry = betterSidebar.subscribe(reconcile)
      const disposeState = betterSidebar.subscribeState?.(reconcile) ?? (() => {})
      return () => {
        disposeState()
        disposeRegistry()
      }
    }

    function createPangeaService(betterSidebar) {
      const pages = new Map()
      const nativeDisposers = new Map()
      const listeners = new Set()
      const runDraftListeners = new Set()
      const registeredNativeIds = new Set()
      let sequence = 0
      let revision = 0
      let defaultPageId
      let snapshot = Object.freeze({ revision, pages: Object.freeze([]) })
      let runDraft = Object.freeze({ revision: 0, requestId: 0, assetIds: Object.freeze([]) })
      const initializedDefaultSessions = new Set()
      let publicService

      function ensureDefaultPage() {
        const sessionId = betterSidebar.getSnapshot?.()?.sessionId
        if (!sessionId || !defaultPageId || initializedDefaultSessions.has(sessionId)) return
        initializedDefaultSessions.add(sessionId)
        openPage({ sessionId }, defaultPageId)
      }

      function rebuild() {
        revision += 1
        const ordered = [...pages.values()].sort((left, right) =>
          (left.order ?? 100) - (right.order ?? 100)
          || left.sequence - right.sequence
          || left.id.localeCompare(right.id))
        snapshot = Object.freeze({ revision, pages: Object.freeze(ordered) })
        for (const listener of [...listeners]) listener()
      }

      function closePageInCurrentSession(nativeId) {
        const current = betterSidebar.getSnapshot?.()
        const state = current?.state
        const sessionId = current?.sessionId
        if (!state || !sessionId) return
        for (const tab of [...allTabs(state.splits), ...allTabs(state.bottomSplits)]) {
          if (tab.type === nativeId) betterSidebar.closeTab(tab.id, { sessionId })
        }
      }

      function registerPage(descriptor) {
        if (!descriptor || typeof descriptor.id !== 'string' || descriptor.id.trim() === '') {
          throw new TypeError('PANGEA page id must be a non-empty string')
        }
        if ((typeof descriptor.title !== 'string' && typeof descriptor.title !== 'function') || typeof descriptor.component !== 'function') {
          throw new TypeError(`PANGEA page "${descriptor.id}" requires title and component`)
        }
        const id = descriptor.id.trim()
        if (pages.has(id)) throw new Error(`PANGEA page id already registered: ${id}`)
        if (descriptor.default === true && defaultPageId && defaultPageId !== id) {
          throw new Error(`PANGEA default page already registered: ${defaultPageId}`)
        }
        const nativeId = nativePageId(id)
        const page = Object.freeze({ ...descriptor, id, nativeId, sequence: sequence++ })
        pages.set(id, page)
        registeredNativeIds.add(nativeId)
        const disposeNative = betterSidebar.registerTab({
          id: nativeId,
          title: descriptor.title,
          icon: descriptor.icon,
          order: descriptor.order,
          single: true,
          available: descriptor.available,
          badge: descriptor.badge,
          component: props => h(ProductShell, {
            service: publicService, betterSidebar, page, scope: props.scope,
          }, h(descriptor.component, props)),
        })
        nativeDisposers.set(id, disposeNative)
        if (descriptor.default === true) {
          defaultPageId = id
          ensureDefaultPage()
        }
        applyBuiltinPolicy(betterSidebar)
        rebuild()
        let disposed = false
        return () => {
          if (disposed) return
          disposed = true
          if (pages.get(id) !== page) return
          closePageInCurrentSession(nativeId)
          nativeDisposers.get(id)?.()
          nativeDisposers.delete(id)
          registeredNativeIds.delete(nativeId)
          pages.delete(id)
          if (defaultPageId === id) defaultPageId = undefined
          rebuild()
        }
      }

      function subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }

      function getSnapshot() { return snapshot }
      function getPages() { return snapshot.pages }

      function getRunDraft() { return runDraft }

      function updateRunDraft(patch = {}) {
        const assetIds = Array.isArray(patch.assetIds)
          ? [...new Set(patch.assetIds.map(value => typeof value === 'string' ? value.trim() : '').filter(Boolean))]
          : [...runDraft.assetIds]
        runDraft = Object.freeze({
          ...runDraft,
          ...patch,
          revision: runDraft.revision + 1,
          assetIds: Object.freeze(assetIds),
        })
        for (const listener of [...runDraftListeners]) listener()
        return runDraft
      }

      function subscribeRunDraft(listener) {
        runDraftListeners.add(listener)
        return () => runDraftListeners.delete(listener)
      }

      function openPage(scope, pageId) {
        const page = pages.get(pageId)
        if (!page) return false
        betterSidebar.openTab({ type: page.nativeId }, scope)
        return true
      }

      function openFile(scope, path, title) {
        if (!scope?.sessionId || typeof path !== 'string' || path.trim() === '') return false
        betterSidebar.openFile(scope, path, title)
        return true
      }

      function requestRunCreation(scope, patch = {}) {
        updateRunDraft({ ...patch, requestId: runDraft.requestId + 1 })
        return openPage(scope, 'analysis')
      }

      const disposePolicy = installSidebarPolicy(betterSidebar, registeredNativeIds)
      const disposeDefaultState = betterSidebar.subscribeState?.(ensureDefaultPage) ?? (() => {})

      publicService = Object.freeze({
        registerPage,
        openPage,
        openFile,
        getPages,
        subscribe,
        getRunDraft,
        updateRunDraft,
        subscribeRunDraft,
        requestRunCreation,
        getSnapshot,
        disposePolicy: () => {
          disposeDefaultState()
          disposePolicy()
        },
      })
      return publicService
    }

    function apply(ctx) {
      const betterSidebar = ctx.betterSidebar
      if (!betterSidebar) return
      ctx.effect(installProductStyles, 'dsh-pangea: product shell styles')
      const service = createPangeaService(betterSidebar)
      ctx.provide('pangea', service)
      ctx.effect(() => service.disposePolicy, 'dsh-pangea: sidebar policy')
    }

    exports.inject = inject
    exports.nativePageId = nativePageId
    exports.installModuleSystemBridge = installModuleSystemBridge
    exports.applyBuiltinPolicy = applyBuiltinPolicy
    exports.closeDisallowedTabs = closeDisallowedTabs
    exports.createPangeaService = createPangeaService
    exports.apply = apply
    return module.exports
  },
})
