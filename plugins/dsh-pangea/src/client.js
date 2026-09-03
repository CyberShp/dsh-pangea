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
    const inject = ['betterSidebar', 'workspaces', 'sessions']
    const PAGE_PREFIX = 'dsh-pangea:'
    const PRODUCT_STYLE_ID = 'dsh-pangea-product-shell'
    const DEFAULT_PRODUCT_STATE = Object.freeze({
      systemState: Object.freeze({ state: 'checking', label: '系统检查中' }),
      assistantContext: null,
    })
    const productStateByWorkspace = new Map()
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

    async function bootstrapProductWorkspace(
      ctx,
      desktopBridge = globalThis.dshDesktop,
      isActive = () => true,
      onProductSession = () => {},
    ) {
      if (
        typeof desktopBridge?.productWorkspace !== 'function'
        || typeof ctx.workspaces?.create !== 'function'
        || typeof ctx.workspaces?.connectWorkspace !== 'function'
        || typeof ctx.sessions?.open !== 'function'
      ) return false

      const path = await desktopBridge.productWorkspace()
      if (typeof path !== 'string' || path.trim() === '') return false
      const workspace = await ctx.workspaces.create({ path })
      if (!workspace?.workspaceId) throw new Error('PANGEA product workspace registration returned no id')
      for (const existingSessionId of workspace.sessionIds ?? []) onProductSession(existingSessionId)
      const sessionId = await ctx.workspaces.connectWorkspace(workspace.workspaceId)
      if (!sessionId) throw new Error('PANGEA product workspace returned no session')
      onProductSession(sessionId)
      if (isActive()) {
        ctx.sessions.open(sessionId)
        await desktopBridge.productWorkspaceReady?.()
      }
      return true
    }

    function installProductWorkspaceBootstrap(ctx, service) {
      let active = true
      void bootstrapProductWorkspace(ctx, globalThis.dshDesktop, () => active, sessionId => service.registerProductSession(sessionId))
        .catch(error => console.error('[dsh-pangea] product workspace bootstrap failed', error))
      return () => { active = false }
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

        body[data-pangea-product-shell] {
          color-scheme: light !important;
          background: #f5f6f8 !important;
          --dsw-alias-bg-base: #f5f6f8;
          --dsw-alias-bg-layer-1: #ffffff;
          --dsw-alias-bg-layer-2: #f8f9fa;
          --dsw-alias-bg-layer-3: #eef1f4;
          --dsw-alias-label-primary: #17191d;
          --dsw-alias-label-secondary: #4d5560;
          --dsw-alias-label-tertiary: #7a828d;
          --dsw-alias-label-on-primary: #ffffff;
          --dsw-alias-border-l1: rgba(23,25,29,.08);
          --dsw-alias-border-l2: #dfe3e8;
          --dsw-alias-interactive-bg-hover: #f0f2f4;
          --dsw-alias-state-business-primary: #c7000b;
          --dsw-alias-state-business-secondary: #e05b65;
          --dsw-alias-state-business-tertiary: #fff0f1;
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
        body[data-pangea-product-shell] [data-pangea-logo-light] { display: block; }
        body[data-pangea-product-shell] [data-pangea-logo-dark] { display: none; }
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
        [data-pangea-tool-button][data-active="true"] {
          color: var(--pangea-red); background: #fff0f1;
          box-shadow: inset 3px 0 var(--pangea-red); font-weight: 680;
        }
        [data-pangea-nav-icon] { width: 25px; height: 25px; display: grid; place-items: center; }
        [data-pangea-nav-divider] { height: 1px; margin: 18px 7px 12px; background: #e5e7eb; }
        [data-pangea-tool-list] { margin-top: auto; }
        [data-pangea-page] { position: relative; min-width: 0; min-height: 0; display: flex; overflow: hidden; background: #f5f6f8; }
        [data-pangea-page] > * { flex: 1; min-width: 0; min-height: 0; }
        [data-pangea-utility-host] {
          width: 100%; height: 100%; min-width: 0; min-height: 0; display: grid;
          grid-template-rows: 49px minmax(0, 1fr); overflow: hidden; background: #fff;
        }
        [data-pangea-utility-head] {
          min-width: 0; display: flex; align-items: center; gap: 10px; padding: 0 14px;
          border-bottom: 1px solid #dfe3e8; background: #fff;
        }
        [data-pangea-utility-title] {
          align-self: end; min-width: 150px; height: 35px; display: flex; align-items: center; gap: 8px;
          padding: 0 13px; border: 1px solid #d9dde3; border-bottom-color: #fff;
          border-radius: 6px 6px 0 0; box-shadow: inset 0 2px var(--pangea-red);
          color: #24282e; background: #fff; font-size: 13px; font-weight: 650;
        }
        [data-pangea-utility-spacer] { flex: 1; }
        [data-pangea-utility-close] {
          width: 31px; height: 31px; display: grid; place-items: center; border: 1px solid #d9dde3;
          border-radius: 5px; color: #555d68; background: #fff; cursor: pointer;
        }
        [data-pangea-utility-body] { min-width: 0; min-height: 0; overflow: hidden; background: #fff; }
        [data-pangea-utility-body] > * { width: 100%; height: 100%; min-width: 0; min-height: 0; }
        [data-pangea-terminal-dock] {
          position: absolute; z-index: 12; left: 0; right: 0; bottom: 0; height: min(42%, 365px);
          min-height: 270px; display: grid; grid-template-rows: 46px minmax(0, 1fr);
          border-top: 3px solid var(--pangea-red); color: #e4e7eb; background: #171a1f;
          box-shadow: 0 -12px 28px rgba(24,29,36,.22);
        }
        [data-pangea-terminal-dock] [data-pangea-utility-head] {
          border-color: #343a43; color: #e4e7eb; background: #242830;
        }
        [data-pangea-terminal-dock] [data-pangea-utility-title] {
          align-self: center; height: 33px; border: 0; border-radius: 5px 5px 0 0;
          box-shadow: none; color: #fff; background: #171a1f;
        }
        [data-pangea-terminal-dock] [data-pangea-utility-close] {
          border-color: #3d434c; color: #e4e7eb; background: #242830;
        }
        [data-pangea-terminal-dock] [data-pangea-utility-body] { background: #171a1f; }

        @media (min-width: 1180px) {
          body[data-pangea-product-shell] #root {
            width: 100% !important; margin-right: 0 !important;
          }
          body[data-pangea-product-shell] #root .pI_x6G_frame {
            box-sizing: border-box; padding-top: var(--pangea-topbar-height);
            grid-template-columns: 0 minmax(0, 1fr) 0 !important;
          }
          body[data-pangea-product-shell] #root .pI_x6G_sidebarCol { display: none !important; }
          body[data-pangea-product-shell] #root [data-pane="details"] {
            grid-column: 2; grid-row: 1; border: 0 !important;
          }
          body[data-pangea-product-shell] #root [data-pane="conversation"] {
            grid-column: 3; grid-row: 1; min-width: 0; margin: 0 !important;
            box-sizing: border-box; padding-top: 204px;
            border-left: 1px solid #dfe3e8; background: #fbfcfd;
            display: none !important;
          }
          body[data-pangea-product-shell][data-pangea-task-assistant] #root .pI_x6G_frame {
            grid-template-columns: 0 minmax(0, 1fr) var(--pangea-ai-width) !important;
          }
          body[data-pangea-product-shell][data-pangea-task-assistant] #root [data-pane="conversation"] {
            display: flex !important;
          }
          body[data-pangea-product-shell] #root [data-pane="conversation"] > * { min-height: 0; flex: 1; }
          body[data-pangea-product-shell] #root [data-pane="conversation"] .pXSMma_stack { display: none !important; }
          body[data-pangea-product-shell] #root [data-pane="conversation"] .wSkVaW_root[data-phase="hero"] .wSkVaW_scrollBody {
            justify-content: flex-end !important;
          }
          body[data-pangea-product-shell] #root [data-pane="conversation"] .wSkVaW_heroGlow { display: none !important; }
          body[data-pangea-product-shell] #root .pI_x6G_handle { display: none !important; }
          body[data-pangea-product-shell] [data-dsh-panel-host] .nArs4W_panel {
            left: 0 !important; right: 0 !important; width: auto !important;
            border-left: 0 !important; border-right: 1px solid var(--dsw-alias-border-l2);
            padding-top: var(--pangea-topbar-height) !important; transform: none !important;
            visibility: visible !important; pointer-events: auto !important;
          }
          body[data-pangea-product-shell][data-pangea-task-assistant] [data-dsh-panel-host] .nArs4W_panel {
            right: var(--pangea-ai-width) !important;
          }
          body[data-pangea-product-shell] [data-dsh-panel-host] .nArs4W_panelResize,
          body[data-pangea-product-shell] [data-dsh-panel-host] .nArs4W_tabBar,
          body[data-pangea-product-shell] [data-dsh-panel-host] .nArs4W_toggleCluster {
            display: none !important;
          }
          body[data-pangea-product-shell] [data-dsh-panel-host] .nArs4W_panelBody { height: 100%; }
          body[data-pangea-product-shell][data-pangea-task-assistant] [data-pangea-assistant-head] {
            display: block; position: fixed; z-index: 35; top: var(--pangea-topbar-height);
            left: calc(100vw - var(--pangea-ai-width)); right: auto;
            box-sizing: border-box; width: var(--pangea-ai-width); height: 204px;
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
          [data-pangea-assistant-actions] { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
          [data-pangea-assistant-select] {
            min-width: 0; flex: 1; height: 30px; border: 1px solid #d9dde3; border-radius: 5px;
            padding: 0 8px; color: #34383f; background: #fff; font: inherit; font-size: 12px;
          }
          [data-pangea-assistant-new] {
            height: 30px; border: 1px solid #c7000b; border-radius: 5px; padding: 0 10px;
            color: #c7000b; background: #fff; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
          }
        }

        @media (min-width: 1180px) and (max-width: 1479px) {
          :root { --pangea-ai-width: 360px; }
          [data-pangea-shell] { grid-template-columns: 220px minmax(0, 1fr); }
          [data-pangea-topbar] { padding-left: 28px; }
          [data-pangea-topbar-title] { margin-left: 22px; padding-left: 22px; font-size: 20px; }
          [data-pangea-project] { min-width: 168px; max-width: 220px; margin-left: 28px; }
          [data-pangea-product-nav] { padding-inline: 12px; }
          [data-pangea-assistant-head] { padding-inline: 20px; }
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
              : kind === 'agent-runtime'
                ? [h('circle', { key: 'a', cx: 12, cy: 12, r: 3 }), h('path', { key: 'b', d: 'M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.5 5.5 7 7M17 17l1.5 1.5M18.5 5.5 17 7M7 17l-1.5 1.5' })]
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
      const conversations = Array.isArray(context?.conversations) ? context.conversations : []
      return h('aside', { 'data-pangea-assistant-head': true, 'aria-label': 'AI 助手当前任务' },
        h('div', { 'data-pangea-assistant-title': true }, h('span', null, 'AI 助手')),
        h('div', { 'data-pangea-assistant-card': true },
          h('span', { 'data-pangea-assistant-icon': true }, assistantGlyph()),
          h('span', { style: { minWidth: 0 } },
            h('span', { 'data-pangea-assistant-name': true, style: { display: 'block' }, title: context?.runId }, context?.title ?? '选择一个 PANGEA Run'),
            h('span', { 'data-pangea-assistant-meta': true, style: { display: 'block' } }, context?.phase ? `阶段：${context.phase}` : '对话将使用当前工作区上下文'),
            h('span', { 'data-pangea-assistant-progress': true, style: { display: 'block' } }, percent === undefined ? '等待任务上下文' : `进度：${percent}%`)),
          lineIcon([h('path', { key: 'a', d: 'm8 10 4 4 4-4' })], 18, 1.7)),
        h('div', { 'data-pangea-assistant-actions': true },
          h('select', {
            'data-pangea-assistant-select': true,
            'aria-label': '切换任务会话',
            value: context?.activeConversationId ?? '',
            onChange: event => context?.onSelectConversation?.(event.target.value),
          }, conversations.length
            ? conversations.map(item => h('option', { key: item.conversation_id, value: item.conversation_id }, item.title))
            : h('option', { value: '' }, '尚未创建会话')),
          h('button', { type: 'button', 'data-pangea-assistant-new': true, onClick: () => context?.onCreateConversation?.() }, '新建会话')))
    }

    function ProductShell({ service, betterSidebar, page, scope, tab, visible, tabProps, children }) {
      const snapshot = React.useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot)
      const sidebarSnapshot = React.useSyncExternalStore(
        betterSidebar.subscribeState,
        betterSidebar.getSnapshot,
        betterSidebar.getSnapshot,
      )
      const productStateKey = scope?.cwd ?? scope?.sessionId ?? '__default__'
      const initialProductState = productStateByWorkspace.get(productStateKey) ?? DEFAULT_PRODUCT_STATE
      const [systemState, setSystemState] = React.useState(initialProductState.systemState)
      const [assistantContext, setAssistantContext] = React.useState(initialProductState.assistantContext)
      const sidebarState = sidebarSnapshot?.state
      const productVisible = visible
        || tabIsActive(sidebarState?.splits, tab?.id)
        || tabIsActive(sidebarState?.bottomSplits, tab?.id)
      React.useEffect(() => {
        if (!productVisible) return undefined
        document.body.setAttribute('data-pangea-product-shell', page.id)
        return () => {
          if (document.body.getAttribute('data-pangea-product-shell') === page.id) document.body.removeAttribute('data-pangea-product-shell')
        }
      }, [page.id, productVisible])
      React.useEffect(() => {
        const showAssistant = productVisible && page.id === 'analysis' && Boolean(assistantContext?.taskId)
        if (showAssistant) document.body.setAttribute('data-pangea-task-assistant', assistantContext.taskId)
        else document.body.removeAttribute('data-pangea-task-assistant')
        return () => {
          if (document.body.getAttribute('data-pangea-task-assistant') === assistantContext?.taskId) {
            document.body.removeAttribute('data-pangea-task-assistant')
          }
        }
      }, [assistantContext?.taskId, page.id, productVisible])
      React.useLayoutEffect(() => {
        if (!productVisible) return undefined
        const body = document.body
        const forceLightTheme = () => {
          if (body.hasAttribute('data-ds-dark-theme')) body.removeAttribute('data-ds-dark-theme')
          document.documentElement.style.colorScheme = 'light'
        }
        forceLightTheme()
        const observer = new MutationObserver(forceLightTheme)
        observer.observe(body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
        return () => observer.disconnect()
      }, [productVisible])
      React.useEffect(() => {
        if (!productVisible) return undefined
        const cached = productStateByWorkspace.get(productStateKey)
        if (cached) {
          setSystemState(cached.systemState)
          setAssistantContext(cached.assistantContext)
        }
        const remember = patch => {
          const next = { ...(productStateByWorkspace.get(productStateKey) ?? DEFAULT_PRODUCT_STATE), ...patch }
          productStateByWorkspace.set(productStateKey, next)
          return next
        }
        const onSystemState = event => {
          const next = event.detail ?? DEFAULT_PRODUCT_STATE.systemState
          remember({ systemState: next })
          setSystemState(next)
        }
        const onRunContext = event => {
          const next = event.detail ?? null
          remember({ assistantContext: next })
          setAssistantContext(next)
        }
        window.addEventListener('pangea:system-state', onSystemState)
        window.addEventListener('pangea:run-context', onRunContext)
        return () => {
          window.removeEventListener('pangea:system-state', onSystemState)
          window.removeEventListener('pangea:run-context', onRunContext)
        }
      }, [productStateKey, productVisible])
      const utility = ['editor', 'terminal', 'browser'].includes(tab?.meta?.pangeaUtility)
        ? tab.meta.pangeaUtility : undefined
      const mergedEditorStore = React.useMemo(() => {
        const store = tabProps?.store
        if (!store) return store
        let sourceSnapshot
        let mergedSnapshot
        return new Proxy(store, {
          get(target, property) {
            if (property === 'getSnapshot') return () => {
              const next = target.getSnapshot()
              if (next !== sourceSnapshot) {
                sourceSnapshot = next
                mergedSnapshot = { ...next, prefs: { ...next.prefs, editorExplorer: true } }
              }
              return mergedSnapshot
            }
            const value = Reflect.get(target, property, target)
            return typeof value === 'function' ? value.bind(target) : value
          },
        })
      }, [tabProps?.store])
      const openUtility = (type, title) => service.openTool(scope, type, { tabId: tab?.id, title })
      const closeUtility = () => service.closeTool(scope, tab?.id, page.id)
      const pageMeta = {
        workbench: { label: '工作台', icon: 'workbench' },
        analysis: { label: 'PANGEA 分析', icon: 'analysis' },
        execution: { label: '环境配置', icon: 'execution' },
        assets: { label: '测试资产', icon: 'assets' },
        'agent-runtime': { label: 'Agent Runtime', icon: 'agent-runtime' },
      }
      const utilityLabels = { editor: '文件工作区', terminal: '环境终端', browser: '内置浏览器' }
      const renderUtility = type => {
        const descriptor = betterSidebar.getTab(type)
        if (!descriptor || !tabProps?.store) {
          return h('div', { 'data-pangea-utility-host': true },
            h('div', { 'data-pangea-utility-head': true }, h('div', { 'data-pangea-utility-title': true }, utilityLabels[type]), h('span', { 'data-pangea-utility-spacer': true }), h('button', { type: 'button', 'data-pangea-utility-close': true, onClick: closeUtility }, '×')),
            h('div', { 'data-pangea-utility-body': true, style: { display: 'grid', placeItems: 'center', color: '#737b86' } }, '当前 DSH 工具不可用'))
        }
        const toolTab = { ...tab, type, title: utilityLabels[type] }
        return h('div', { 'data-pangea-utility-host': true, 'data-utility': type },
          h('div', { 'data-pangea-utility-head': true },
            h('div', { 'data-pangea-utility-title': true }, utilityIcon(type === 'editor' ? 'file' : type), utilityLabels[type]),
            h('span', { 'data-pangea-utility-spacer': true }),
            h('button', { type: 'button', 'data-pangea-utility-close': true, 'aria-label': `关闭${utilityLabels[type]}`, onClick: closeUtility }, '×')),
          h('div', { 'data-pangea-utility-body': true }, h(descriptor.component, {
            ...tabProps,
            store: type === 'editor' ? mergedEditorStore : tabProps.store,
            tab: toolTab,
            visible: productVisible,
          })))
      }
      return h('div', { 'data-pangea-shell': true },
        h(ProductHeader, { scope, systemState }),
        h(AssistantHeader, { context: assistantContext }),
        h('aside', { 'data-pangea-product-nav': true, 'aria-label': 'PANGEA 产品导航' },
          h('nav', { 'data-pangea-nav-list': true }, snapshot.pages.filter(item => pageIsAvailable(item, scope)).map(item => h('button', {
            key: item.id, type: 'button', 'data-pangea-nav-button': true, 'data-active': item.id === page.id ? 'true' : 'false',
            onClick: () => service.openPage(scope, item.id),
          }, h('span', { 'data-pangea-nav-icon': true }, productIcon(pageMeta[item.id]?.icon ?? item.id, 23)),
          h('span', { 'data-pangea-nav-label': true }, pageMeta[item.id]?.label ?? (typeof item.title === 'function' ? item.title() : item.title))))),
          h('div', { 'data-pangea-nav-divider': true }),
          h('div', { 'data-pangea-tool-list': true },
            h('button', { type: 'button', 'data-pangea-tool-button': true, 'data-active': utility === 'editor' ? 'true' : 'false', onClick: () => openUtility('editor', '文件') }, utilityIcon('file'), h('span', { 'data-pangea-nav-label': true }, '文件')),
            h('button', { type: 'button', 'data-pangea-tool-button': true, 'data-active': utility === 'terminal' ? 'true' : 'false', onClick: () => openUtility('terminal', '终端') }, utilityIcon('terminal'), h('span', { 'data-pangea-nav-label': true }, '终端')),
            h('button', { type: 'button', 'data-pangea-tool-button': true, 'data-active': utility === 'browser' ? 'true' : 'false', onClick: () => openUtility('browser', '浏览器') }, utilityIcon('browser'), h('span', { 'data-pangea-nav-label': true }, '浏览器')))),
        h('main', { 'data-pangea-page': page.id },
          utility === 'editor' || utility === 'browser' ? renderUtility(utility) : React.cloneElement(children, { visible: productVisible }),
          utility === 'terminal' ? h('div', { 'data-pangea-terminal-dock': true }, ...renderUtility('terminal').props.children) : null))
    }

    function allTabs(tree) {
      if (!tree) return []
      if (Array.isArray(tree.tabs)) return tree.tabs
      return Array.isArray(tree.children) ? tree.children.flatMap(allTabs) : []
    }

    function tabIsActive(tree, tabId) {
      if (!tree || !tabId) return false
      if (Array.isArray(tree.tabs)) return tree.active === tabId
      return Array.isArray(tree.children) && tree.children.some(child => tabIsActive(child, tabId))
    }

    function nativePageId(pageId) {
      return `${PAGE_PREFIX}${pageId}`
    }

    function pageIsAvailable(page, scope) {
      return typeof page?.available !== 'function' || page.available(undefined, scope) !== false
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
      const taskSelectionListeners = new Set()
      const registeredNativeIds = new Set()
      let sequence = 0
      let revision = 0
      let defaultPageId
      let snapshot = Object.freeze({ revision, pages: Object.freeze([]) })
      let runDraft = Object.freeze({ revision: 0, requestId: 0, assetIds: Object.freeze([]) })
      let selectedTaskId
      const initializedDefaultSessions = new Set()
      const productSessions = new Set()
      const lastPageBySession = new Map()
      let publicService

      function activePageId(state) {
        for (const page of pages.values()) {
          const tab = [...allTabs(state?.splits), ...allTabs(state?.bottomSplits)].find(item => item.type === page.nativeId)
          if (tab && (tabIsActive(state?.splits, tab.id) || tabIsActive(state?.bottomSplits, tab.id))) return page.id
        }
        return undefined
      }

      function ensureProductPage() {
        const current = betterSidebar.getSnapshot?.()
        const sessionId = current?.sessionId
        const state = current?.state
        if (!sessionId || !defaultPageId) return
        const activePage = activePageId(state)
        if (activePage) {
          initializedDefaultSessions.add(sessionId)
          lastPageBySession.set(sessionId, activePage)
          return
        }
        if (!initializedDefaultSessions.has(sessionId)) {
          initializedDefaultSessions.add(sessionId)
          openPage({ sessionId }, lastPageBySession.get(sessionId) ?? defaultPageId)
          return
        }
        if (!productSessions.has(sessionId)) return
        const pageId = lastPageBySession.get(sessionId) ?? defaultPageId
        const page = pages.get(pageId) ?? pages.get(defaultPageId)
        if (!page) return
        const existing = [...allTabs(state?.splits), ...allTabs(state?.bottomSplits)].find(item => item.type === page.nativeId)
        console.info('[dsh-pangea] restoring product page', { sessionId, pageId: page.id, previousActiveTab: state?.splits?.active ?? state?.bottomSplits?.active ?? null })
        if (existing) betterSidebar.activateTab?.(existing.id, { sessionId })
        else openPage({ sessionId }, page.id)
      }

      function registerProductSession(sessionId) {
        if (typeof sessionId !== 'string' || sessionId.trim() === '') return false
        productSessions.add(sessionId)
        ensureProductPage()
        return true
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
            service: publicService, betterSidebar, page, scope: props.scope, tab: props.tab, visible: props.visible,
            tabProps: props,
          }, h(descriptor.component, props)),
        })
        nativeDisposers.set(id, disposeNative)
        if (descriptor.default === true) {
          defaultPageId = id
          ensureProductPage()
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

      function selectTask(taskId) {
        const next = typeof taskId === 'string' && taskId.trim() !== '' ? taskId.trim() : undefined
        if (next === selectedTaskId) return selectedTaskId
        selectedTaskId = next
        for (const listener of [...taskSelectionListeners]) listener()
        return selectedTaskId
      }

      function getSelectedTaskId() { return selectedTaskId }

      function subscribeTaskSelection(listener) {
        taskSelectionListeners.add(listener)
        return () => taskSelectionListeners.delete(listener)
      }

      function openPage(scope, pageId) {
        const page = pages.get(pageId)
        if (!page) return false
        if (scope?.sessionId) lastPageBySession.set(scope.sessionId, page.id)
        const state = betterSidebar.getSnapshot?.()?.state
        const existing = state ? [...allTabs(state.splits), ...allTabs(state.bottomSplits)].find(item => item.type === page.nativeId) : undefined
        if (existing) betterSidebar.updateTab?.(existing.id, { title: typeof page.title === 'function' ? page.title() : page.title, path: '', meta: { ...(existing.meta && typeof existing.meta === 'object' ? existing.meta : {}), pangeaUtility: null } })
        if (existing) betterSidebar.activateTab?.(existing.id, scope)
        else betterSidebar.openTab({ type: page.nativeId }, scope)
        return true
      }

      function openTool(scope, type, seed = {}) {
        if (!['editor', 'terminal', 'browser'].includes(type) || !scope?.sessionId) return false
        const state = betterSidebar.getSnapshot?.()?.state
        const tabs = state ? [...allTabs(state.splits), ...allTabs(state.bottomSplits)] : []
        const target = tabs.find(item => item.id === seed.tabId)
          ?? tabs.find(item => item.type?.startsWith(PAGE_PREFIX) && tabIsActive(state?.splits, item.id))
          ?? tabs.find(item => item.type?.startsWith(PAGE_PREFIX))
        if (!target) return false
        betterSidebar.updateTab?.(target.id, {
          ...(typeof seed.path === 'string' ? { path: seed.path } : {}),
          title: seed.title ?? target.title,
          meta: { ...(target.meta && typeof target.meta === 'object' ? target.meta : {}), pangeaUtility: type },
        })
        betterSidebar.activateTab?.(target.id, scope)
        return true
      }

      function closeTool(scope, tabId, pageId) {
        const page = pages.get(pageId)
        const state = betterSidebar.getSnapshot?.()?.state
        const target = state ? [...allTabs(state.splits), ...allTabs(state.bottomSplits)].find(item => item.id === tabId) : undefined
        if (!target) return false
        betterSidebar.updateTab?.(target.id, {
          title: page ? (typeof page.title === 'function' ? page.title() : page.title) : target.title,
          path: '',
          meta: { ...(target.meta && typeof target.meta === 'object' ? target.meta : {}), pangeaUtility: null },
        })
        betterSidebar.activateTab?.(target.id, scope)
        return true
      }

      function openFile(scope, path, title) {
        if (!scope?.sessionId || typeof path !== 'string' || path.trim() === '') return false
        if (openTool(scope, 'editor', { path, title: title ?? path.split(/[\\/]/).pop() })) return true
        betterSidebar.openFile(scope, path, title)
        return true
      }

      function requestRunCreation(scope, patch = {}) {
        updateRunDraft({ ...patch, requestId: runDraft.requestId + 1 })
        return openPage(scope, 'analysis')
      }

      const disposePolicy = installSidebarPolicy(betterSidebar, registeredNativeIds)
      const disposeDefaultState = betterSidebar.subscribeState?.(ensureProductPage) ?? (() => {})

      publicService = Object.freeze({
        registerPage,
        openPage,
        openTool,
        closeTool,
        openFile,
        getPages,
        subscribe,
        getRunDraft,
        updateRunDraft,
        subscribeRunDraft,
        requestRunCreation,
        registerProductSession,
        selectTask,
        getSelectedTaskId,
        subscribeTaskSelection,
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
      ctx.effect(() => installProductWorkspaceBootstrap(ctx, service), 'dsh-pangea: product workspace bootstrap')
      ctx.effect(() => service.disposePolicy, 'dsh-pangea: sidebar policy')
    }

    exports.inject = inject
    exports.nativePageId = nativePageId
    exports.pageIsAvailable = pageIsAvailable
    exports.installModuleSystemBridge = installModuleSystemBridge
    exports.bootstrapProductWorkspace = bootstrapProductWorkspace
    exports.applyBuiltinPolicy = applyBuiltinPolicy
    exports.closeDisallowedTabs = closeDisallowedTabs
    exports.createPangeaService = createPangeaService
    exports.apply = apply
    return module.exports
  },
})
