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
        :root {
          --pangea-ai-width: clamp(380px, 27vw, 452px);
          --pangea-topbar-height: 66px;
          --pangea-red: #c7000b;
          --pangea-ink: #17191d;
          --pangea-muted: #68707c;
          --pangea-line: #dfe3e8;
        }

        [data-pangea-shell] {
          width: 100%; height: 100%; min-width: 0; min-height: 0;
          display: grid; grid-template-columns: 244px minmax(0, 1fr);
          color: var(--dsw-alias-label-primary); background: #fff;
          font-family: "Huawei Sans", "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei UI", sans-serif;
          font-synthesis: none;
          -webkit-font-smoothing: antialiased;
          text-rendering: optimizeLegibility;
        }
        [data-pangea-topbar] {
          position: fixed; z-index: 40; inset: 0 0 auto 0; box-sizing: border-box;
          width: 100vw;
          height: var(--pangea-topbar-height); display: flex; align-items: center;
          padding: 0 28px 0 30px; border-bottom: 1px solid #d9dde3;
          color: var(--pangea-ink); background: rgba(255,255,255,.98);
          box-shadow: 0 1px 0 rgba(20,24,32,.02); -webkit-app-region: drag;
        }
        [data-pangea-topbar] button, [data-pangea-topbar] [role="button"] { -webkit-app-region: no-drag; }
        [data-pangea-topbar-brand] { width: 136px; height: 34px; display: flex; align-items: center; flex: none; }
        [data-pangea-logo] { width: 124px; height: auto; display: block; object-fit: contain; object-position: left center; }
        [data-pangea-logo-dark] { display: none; filter: brightness(0) invert(1); }
        body[data-ds-dark-theme] [data-pangea-logo-light] { display: none; }
        body[data-ds-dark-theme] [data-pangea-logo-dark] { display: block; }
        [data-pangea-topbar-title] {
          height: 30px; display: flex; align-items: center; margin-left: 28px; padding-left: 28px;
          border-left: 1px solid #e0e3e7; font-size: 21px; line-height: 1; font-weight: 720;
          letter-spacing: -.025em; white-space: nowrap;
        }
        [data-pangea-project] {
          min-width: 188px; max-width: 260px; height: 40px; display: grid;
          grid-template-columns: minmax(0,1fr) 18px; align-items: center; gap: 14px;
          margin-left: 38px; padding: 0 14px; border: 1px solid #d7dbe1; border-radius: 5px;
          color: #34383f; background: #fff; font: inherit; font-size: 14px; text-align: left;
          box-shadow: 0 1px 2px rgba(18,24,32,.03); cursor: default;
        }
        [data-pangea-project] span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        [data-pangea-topbar-spacer] { flex: 1; min-width: 24px; }
        [data-pangea-system-state] {
          display: inline-flex; align-items: center; gap: 10px; height: 36px; padding: 0 10px;
          color: #25292f; font-size: 14px; font-weight: 570; white-space: nowrap;
        }
        [data-pangea-system-dot] {
          width: 18px; height: 18px; display: grid; place-items: center; border-radius: 50%;
          color: #fff; background: #2da44e; font-size: 11px; font-weight: 800;
        }
        [data-pangea-system-state][data-state="warning"] [data-pangea-system-dot] { background: #e58a00; }
        [data-pangea-system-state][data-state="error"] [data-pangea-system-dot] { background: var(--pangea-red); }
        [data-pangea-system-state][data-state="checking"] [data-pangea-system-dot] { color: transparent; background: #a8afb9; }
        [data-pangea-assistant-head] { display: none; }
        [data-pangea-product-nav] {
          box-sizing: border-box; min-width: 0; min-height: 0; display: flex; flex-direction: column;
          padding: 22px 14px 18px; border-right: 1px solid #dfe3e8;
          background: #f7f8fa;
        }
        [data-pangea-nav-list], [data-pangea-tool-list] { display: grid; gap: 7px; }
        [data-pangea-nav-button], [data-pangea-tool-button] {
          box-sizing: border-box; width: 100%; min-height: 52px; display: grid;
          grid-template-columns: 29px minmax(0, 1fr); align-items: center; gap: 12px;
          padding: 0 15px; border: 1px solid transparent; border-radius: 7px;
          color: #424953; background: transparent;
          text-align: left; font: inherit; font-size: 15px; font-weight: 520; cursor: pointer;
          transition: color .15s ease, background .15s ease, box-shadow .15s ease, transform .15s ease;
        }
        [data-pangea-nav-button]:hover, [data-pangea-tool-button]:hover {
          color: #17191d; background: #eef0f3;
        }
        [data-pangea-nav-button][data-active="true"] {
          color: #fff; background: linear-gradient(135deg, #c7000b 0%, #df0011 100%);
          box-shadow: 0 10px 22px rgba(199,0,11,.22);
        }
        [data-pangea-nav-icon] { width: 25px; height: 25px; display: grid; place-items: center; }
        [data-pangea-nav-divider] { height: 1px; margin: 18px 7px 12px; background: #e5e7eb; }
        [data-pangea-tool-list] { margin-top: auto; }
        [data-pangea-page] { min-width: 0; min-height: 0; display: flex; overflow: hidden; background: #fff; }
        [data-pangea-page] > * { flex: 1; min-width: 0; min-height: 0; }

        @media (min-width: 1180px) {
          body[data-pangea-product-shell] #root {
            width: 100% !important; margin-right: 0 !important;
          }
          body[data-pangea-product-shell] #root .pI_x6G_frame {
            box-sizing: border-box; padding-top: var(--pangea-topbar-height);
            grid-template-columns: 0 minmax(0, 1fr) var(--pangea-ai-width) !important;
          }
          body[data-pangea-product-shell] #root .pI_x6G_sidebarCol { display: none !important; }
          body[data-pangea-product-shell] #root [data-pane="details"] {
            grid-column: 2; grid-row: 1; border: 0 !important;
          }
          body[data-pangea-product-shell] #root [data-pane="conversation"] {
            grid-column: 3; grid-row: 1; min-width: 0; margin: 0 !important;
            box-sizing: border-box; padding-top: 166px;
            border-left: 1px solid #dfe3e8; background: #fbfcfd;
          }
          body[data-pangea-product-shell] #root [data-pane="conversation"] > * { min-height: 0; flex: 1; }
          body[data-pangea-product-shell] #root [data-pane="conversation"] .pXSMma_stack { display: none !important; }
          body[data-pangea-product-shell] #root [data-pane="conversation"] .wSkVaW_root[data-phase="hero"] .wSkVaW_scrollBody {
            justify-content: flex-end !important;
          }
          body[data-pangea-product-shell] #root [data-pane="conversation"] .wSkVaW_heroGlow { display: none !important; }
          body[data-pangea-product-shell] #root .pI_x6G_handle { display: none !important; }
          body[data-pangea-product-shell] [data-dsh-panel-host] .nArs4W_panel {
            left: 0 !important; right: var(--pangea-ai-width) !important; width: auto !important;
            border-left: 0 !important; border-right: 1px solid var(--dsw-alias-border-l2);
            padding-top: var(--pangea-topbar-height) !important; transform: none !important;
            visibility: visible !important; pointer-events: auto !important;
          }
          body[data-pangea-product-shell] [data-dsh-panel-host] .nArs4W_panelResize,
          body[data-pangea-product-shell] [data-dsh-panel-host] .nArs4W_tabBar,
          body[data-pangea-product-shell] [data-dsh-panel-host] .nArs4W_toggleCluster {
            display: none !important;
          }
          body[data-pangea-product-shell] [data-dsh-panel-host] .nArs4W_panelBody { height: 100%; }
          [data-pangea-assistant-head] {
            display: block; position: fixed; z-index: 35; top: var(--pangea-topbar-height);
            left: calc(100vw - var(--pangea-ai-width)); right: auto;
            box-sizing: border-box; width: var(--pangea-ai-width); height: 166px;
            padding: 0 24px 16px; border-left: 1px solid #dfe3e8; border-bottom: 1px solid #e5e8ec;
            color: var(--pangea-ink); background: rgba(251,252,253,.98);
          }
          [data-pangea-assistant-title] {
            height: 58px; display: flex; align-items: center; justify-content: space-between;
            font-size: 17px; font-weight: 720; letter-spacing: -.01em;
          }
          [data-pangea-assistant-card] {
            height: 90px; display: grid; grid-template-columns: 48px minmax(0,1fr) 20px;
            align-items: center; gap: 14px; padding: 0 14px; border: 1px solid #d9dde3;
            border-radius: 9px; background: #fff; box-shadow: 0 2px 8px rgba(25,31,40,.035);
          }
          [data-pangea-assistant-icon] {
            width: 46px; height: 46px; display: grid; place-items: center; border-radius: 9px;
            color: var(--pangea-red); background: #fff0f1; border: 1px solid #ffd5d8;
          }
          [data-pangea-assistant-name] { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 700; }
          [data-pangea-assistant-meta] { margin-top: 5px; color: #757c87; font-size: 12px; line-height: 1.35; }
          [data-pangea-assistant-progress] { margin-top: 5px; color: #68707c; font-size: 11px; }
        }

        @media (max-width: 1179px) {
          [data-pangea-shell] { grid-template-columns: 74px minmax(0, 1fr); }
          [data-pangea-product-nav] { padding-inline: 9px; }
          [data-pangea-nav-label] { display: none; }
          [data-pangea-nav-button], [data-pangea-tool-button] { grid-template-columns: 1fr; padding: 0; place-items: center; }
          [data-pangea-topbar-title] { margin-left: 18px; padding-left: 18px; font-size: 18px; }
          [data-pangea-project] { display: none; }
        }

        body.dsh-desktop-windows-titlebar-layout [data-pangea-topbar] {
          padding-right: calc(var(--dsh-desktop-windows-caption-width, 140px) + 56px);
        }
        body[data-ds-dark-theme] [data-pangea-topbar],
        body[data-ds-dark-theme] [data-pangea-assistant-head],
        body[data-ds-dark-theme] [data-pangea-assistant-card],
        body[data-ds-dark-theme] [data-pangea-page] { background: #17181b; color: #f5f6f7; }
        body[data-ds-dark-theme] [data-pangea-product-nav] { background: #1c1e22; border-color: #30343a; }
      `
      document.head.appendChild(style)
      return () => style.remove()
    }

    function HuaweiLogo() {
      return h(React.Fragment, null,
        h('img', { 'data-pangea-logo': true, 'data-pangea-logo-light': true, src: '/dsh-desktop-logo-light.png', alt: 'HUAWEI' }),
        h('img', { 'data-pangea-logo': true, 'data-pangea-logo-dark': true, src: '/dsh-desktop-logo-dark.png', alt: 'HUAWEI' }))
    }

    function lineIcon(paths, size = 24, strokeWidth = 1.8) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      }, paths)
    }

    function productIcon(kind, size = 24) {
      const paths = kind === 'workbench'
        ? [h('path', { key: 'a', d: 'M3.5 10.5 12 3.8l8.5 6.7V20H15v-5.8H9V20H3.5Z' })]
        : kind === 'analysis'
          ? [h('path', { key: 'a', d: 'M4 19V5' }), h('path', { key: 'b', d: 'M4 19h16' }), h('path', { key: 'c', d: 'm7 15 4-5 3 3 5-7' })]
          : kind === 'execution'
            ? [h('path', { key: 'a', d: 'M8.2 3.8h7.6l4.2 6.6-4.2 6.8H8.2L4 10.4Z' }), h('circle', { key: 'b', cx: 12, cy: 10.5, r: 2.6 }), h('path', { key: 'c', d: 'M9.5 20h5' })]
            : kind === 'assets'
              ? [h('path', { key: 'a', d: 'm12 3 8 4-8 4-8-4Z' }), h('path', { key: 'b', d: 'm4 12 8 4 8-4' }), h('path', { key: 'c', d: 'm4 17 8 4 8-4' })]
              : kind === 'terminal'
                ? [h('path', { key: 'a', d: 'm5 7 4 4-4 4' }), h('path', { key: 'b', d: 'M11 16h7' })]
                : kind === 'browser'
                  ? [h('circle', { key: 'a', cx: 12, cy: 12, r: 8 }), h('path', { key: 'b', d: 'M4 12h16M12 4c2.2 2.3 3.2 5 3.2 8s-1 5.7-3.2 8c-2.2-2.3-3.2-5-3.2-8S9.8 6.3 12 4Z' })]
                  : [h('path', { key: 'a', d: 'M5 3.5h9l5 5V20H5Z' }), h('path', { key: 'b', d: 'M14 3.5V9h5' })]
      return lineIcon(paths, size)
    }

    function utilityIcon(kind) {
      return h('span', { 'data-pangea-nav-icon': true }, productIcon(kind, 21))
    }

    function workspaceLabel(scope) {
      const cwd = typeof scope?.cwd === 'string' ? scope.cwd.replace(/[\\/]+$/, '') : ''
      const name = cwd.split(/[\\/]/).pop()
      return name || '当前测试项目'
    }

    function assistantGlyph() {
      return lineIcon([
        h('path', { key: 'a', d: 'M4 16.5 8.5 12l3.2 2.8L19.5 6' }),
        h('path', { key: 'b', d: 'M5 4h14v16H5Z' }),
        h('circle', { key: 'c', cx: 8.5, cy: 12, r: 1 }),
      ], 28, 1.8)
    }

    function ProductHeader({ scope, systemState }) {
      return h('header', { 'data-pangea-topbar': true },
        h('div', { 'data-pangea-topbar-brand': true }, h(HuaweiLogo)),
        h('div', { 'data-pangea-topbar-title': true }, 'PANGEA 测试工作台'),
        h('button', { type: 'button', 'data-pangea-project': true, title: scope?.cwd ?? '' },
          h('span', null, workspaceLabel(scope)),
          lineIcon([h('path', { key: 'a', d: 'm7 9 5 5 5-5' })], 18, 1.7)),
        h('span', { 'data-pangea-topbar-spacer': true }),
        h('div', { 'data-pangea-system-state': true, 'data-state': systemState.state, role: 'status' },
          h('span', { 'data-pangea-system-dot': true }, systemState.state === 'ok' ? '✓' : '!'),
          h('span', null, systemState.label)))
    }

    function AssistantHeader({ context }) {
      const percent = Number.isFinite(context?.percent) ? Math.max(0, Math.min(100, context.percent)) : undefined
      return h('aside', { 'data-pangea-assistant-head': true, 'aria-label': 'AI 助手当前任务' },
        h('div', { 'data-pangea-assistant-title': true }, h('span', null, 'AI 助手')),
        h('div', { 'data-pangea-assistant-card': true },
          h('span', { 'data-pangea-assistant-icon': true }, assistantGlyph()),
          h('span', { style: { minWidth: 0 } },
            h('span', { 'data-pangea-assistant-name': true, style: { display: 'block' }, title: context?.runId }, context?.title ?? '选择一个 PANGEA Run'),
            h('span', { 'data-pangea-assistant-meta': true, style: { display: 'block' } }, context?.phase ? `阶段：${context.phase}` : '对话将使用当前工作区上下文'),
            h('span', { 'data-pangea-assistant-progress': true, style: { display: 'block' } }, percent === undefined ? '等待任务上下文' : `进度：${percent}%`)),
          lineIcon([h('path', { key: 'a', d: 'm8 10 4 4 4-4' })], 18, 1.7)))
    }

    function ProductShell({ service, betterSidebar, page, scope, children }) {
      const snapshot = React.useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot)
      const [systemState, setSystemState] = React.useState({ state: 'checking', label: '系统检查中' })
      const [assistantContext, setAssistantContext] = React.useState(null)
      React.useEffect(() => {
        document.body.setAttribute('data-pangea-product-shell', page.id)
        return () => {
          if (document.body.getAttribute('data-pangea-product-shell') === page.id) document.body.removeAttribute('data-pangea-product-shell')
        }
      }, [page.id])
      React.useEffect(() => {
        const onSystemState = event => setSystemState(event.detail ?? { state: 'checking', label: '系统检查中' })
        const onRunContext = event => setAssistantContext(event.detail ?? null)
        window.addEventListener('pangea:system-state', onSystemState)
        window.addEventListener('pangea:run-context', onRunContext)
        return () => {
          window.removeEventListener('pangea:system-state', onSystemState)
          window.removeEventListener('pangea:run-context', onRunContext)
        }
      }, [])
      const openUtility = (type, title) => betterSidebar.openTab({ type, title }, scope)
      const pageMeta = {
        workbench: { label: '工作台', icon: 'workbench' },
        analysis: { label: 'PANGEA 分析', icon: 'analysis' },
        execution: { label: '环境配置', icon: 'execution' },
        assets: { label: '测试资产', icon: 'assets' },
      }
      return h('div', { 'data-pangea-shell': true },
        h(ProductHeader, { scope, systemState }),
        h(AssistantHeader, { context: assistantContext }),
        h('aside', { 'data-pangea-product-nav': true, 'aria-label': 'PANGEA 产品导航' },
          h('nav', { 'data-pangea-nav-list': true }, snapshot.pages.map(item => h('button', {
            key: item.id, type: 'button', 'data-pangea-nav-button': true, 'data-active': item.id === page.id ? 'true' : 'false',
            onClick: () => service.openPage(scope, item.id),
          }, h('span', { 'data-pangea-nav-icon': true }, productIcon(pageMeta[item.id]?.icon ?? item.id, 23)),
          h('span', { 'data-pangea-nav-label': true }, pageMeta[item.id]?.label ?? (typeof item.title === 'function' ? item.title() : item.title))))),
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
