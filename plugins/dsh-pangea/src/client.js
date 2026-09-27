// Browser half of the PANGEA sidebar adapter. Feature plugins register native
// Better Sidebar tabs through ctx.pangea; there is no wrapper PANGEA tab.
window.__ModuleLoader__.load({
  id: 'dsh-pangea',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement
    const inject = ['betterSidebar', 'workspaces', 'sessions']
    const PAGE_PREFIX = 'dsh-pangea:'
    const PRODUCT_STYLE_ID = 'dsh-pangea-product-shell'
    const DEFAULT_PRODUCT_STATE = Object.freeze({
      systemState: Object.freeze({ state: 'checking', label: '系统检查中' }),
      assistantContext: null,
    })
    const productStateByWorkspace = new Map()
    const productBodyAttributeOwners = new Map()
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
          display: grid; grid-template-columns: 216px minmax(0, 1fr);
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
          grid-template-columns: minmax(0,1fr); align-items: center;
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
          padding: 18px 12px 14px; border-right: 1px solid #dfe3e8;
          overflow-y: auto; scrollbar-width: thin; background: #f7f8fa;
        }
        [data-pangea-nav-list], [data-pangea-tool-list] { display: grid; gap: 5px; flex-shrink: 0; }
        [data-pangea-nav-heading] { padding: 0 12px 7px; color: var(--pangea-muted); font-size: 11px; font-weight: 650; letter-spacing: .06em; }
        [data-pangea-nav-button], [data-pangea-tool-button] {
          box-sizing: border-box; width: 100%; min-height: 44px; display: grid;
          grid-template-columns: 25px minmax(0, 1fr); align-items: center; gap: 10px;
          padding: 0 12px; border: 1px solid transparent; border-radius: 7px;
          color: #424953; background: transparent;
          text-align: left; font: inherit; font-size: 14px; font-weight: 520; cursor: pointer;
          transition: color .15s ease, background .15s ease, box-shadow .15s ease;
        }
        [data-pangea-tool-button] { min-height: 40px; }
        [data-pangea-nav-label] { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        [data-pangea-nav-button]:hover, [data-pangea-tool-button]:hover {
          color: #17191d; background: #eef0f3;
        }
        [data-pangea-nav-button][data-active="true"] {
          color: #fff; background: linear-gradient(135deg, #c7000b 0%, #df0011 100%);
          box-shadow: 0 3px 9px rgba(199,0,11,.16); font-weight: 650;
        }
        [data-pangea-tool-button][data-active="true"] {
          color: var(--pangea-red); background: #fff0f1;
          box-shadow: inset 3px 0 var(--pangea-red); font-weight: 680;
        }
        [data-pangea-nav-icon] { width: 25px; height: 25px; display: grid; place-items: center; }
        [data-pangea-nav-divider] { height: 1px; flex-shrink: 0; margin: 18px 7px 14px; background: #e5e7eb; }
        [data-pangea-tool-list] { margin-top: auto; }
        [data-pangea-shell] :is(button,select):focus-visible,
        [data-pangea-assistant-head] :is(button,select):focus-visible {
          outline: 2px solid var(--pangea-red); outline-offset: 3px;
        }
        [data-pangea-page] { position: relative; min-width: 0; min-height: 0; display: flex; overflow: hidden; background: #f5f6f8; }
        [data-pangea-page] > * { flex: 1; min-width: 0; min-height: 0; }
        [data-pangea-page][data-pangea-terminal-open] {
          display: grid; grid-template-rows: minmax(0, 1fr) 517px;
        }
        [data-pangea-page][data-pangea-terminal-collapsed] { grid-template-rows: minmax(0, 1fr) 100px; }
        [data-pangea-settings-page] {
          box-sizing: border-box; width: 100%; height: 100%; overflow: auto;
          padding: 42px clamp(28px, 5vw, 72px) 64px; color: var(--pangea-ink); background: #f5f6f8;
        }
        [data-pangea-settings-head] { max-width: 980px; margin: 0 auto 28px; }
        [data-pangea-settings-title] { margin: 0; font-size: 30px; line-height: 40px; letter-spacing: -.025em; }
        [data-pangea-settings-intro] { margin: 8px 0 0; color: var(--pangea-muted); font-size: 14px; line-height: 22px; }
        [data-pangea-settings-grid] { max-width: 980px; margin: 0 auto; display: grid; gap: 18px; }
        [data-pangea-settings-card] {
          box-sizing: border-box; display: grid; grid-template-columns: minmax(0,1fr) auto;
          align-items: center; gap: 24px; padding: 24px 26px; border: 1px solid var(--pangea-line);
          border-radius: 10px; background: #fff; box-shadow: 0 2px 8px rgba(25,31,40,.035);
        }
        [data-pangea-settings-card-title] { margin: 0; font-size: 17px; line-height: 25px; font-weight: 700; }
        [data-pangea-settings-card-description] { max-width: 680px; margin: 7px 0 0; color: var(--pangea-muted); font-size: 13px; line-height: 21px; }
        [data-pangea-update-meta] { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 12px; color: #4d5560; font-size: 12px; line-height: 18px; }
        [data-pangea-update-error] { margin: 10px 0 0; color: var(--pangea-red); font-size: 12px; line-height: 19px; overflow-wrap: anywhere; }
        [data-pangea-settings-actions] { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
        [data-pangea-settings-action] {
          box-sizing: border-box; min-width: 126px; height: 38px; padding: 0 16px; border: 1px solid #cfd4da;
          border-radius: 6px; color: #34383f; background: #fff; font: inherit; font-size: 13px;
          font-weight: 620; white-space: nowrap; cursor: pointer;
        }
        [data-pangea-settings-action]:hover:not(:disabled) { border-color: #aeb5bd; background: #f6f7f8; }
        [data-pangea-settings-action="primary"] { border-color: var(--pangea-red); color: #fff; background: var(--pangea-red); }
        [data-pangea-settings-action="primary"]:hover:not(:disabled) { border-color: #a90009; background: #a90009; }
        [data-pangea-settings-action]:disabled { cursor: default; opacity: .52; }
        [data-pangea-settings-note] { max-width: 980px; margin: 16px auto 0; color: #7a828d; font-size: 12px; line-height: 19px; }
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
        [data-pangea-utility-host][data-utility="editor"] { grid-template-rows: 71px minmax(0, 1fr); }
        [data-pangea-utility-host][data-utility="editor"] [data-pangea-utility-head] { padding: 0 20px; }
        [data-pangea-utility-host][data-utility="editor"] [data-pangea-utility-title] {
          align-self: auto; min-width: 0; height: auto; gap: 12px; padding: 0; border: 0; border-radius: 0;
          box-shadow: none; color: #25292e; background: transparent; font-size: 14px; font-weight: 650;
        }
        [data-pangea-utility-host][data-utility="editor"] [data-pangea-utility-workspace] { color: #70767d; font-size: 12px; font-weight: 400; }
        [data-pangea-utility-spacer] { flex: 1; }
        [data-pangea-utility-close] {
          width: 31px; height: 31px; display: grid; place-items: center; border: 1px solid #d9dde3;
          border-radius: 5px; color: #555d68; background: #fff; cursor: pointer;
        }
        [data-pangea-utility-host][data-utility="editor"] [data-pangea-utility-close] { width: 42px; height: 36px; border-radius: 6px; }
        [data-pangea-utility-host][data-utility="browser"] { grid-template-rows: 71px minmax(0, 1fr); }
        [data-pangea-utility-host][data-utility="browser"] [data-pangea-utility-head] { padding: 0 20px; }
        [data-pangea-utility-host][data-utility="browser"] [data-pangea-utility-title] { align-self: auto; min-width: 0; height: auto; padding: 0; border: 0; box-shadow: none; background: transparent; font-size: 14px; }
        [data-pangea-utility-host][data-utility="browser"] [data-pangea-utility-workspace] { color: #70767d; font-size: 12px; font-weight: 400; }
        [data-pangea-utility-host][data-utility="browser"] [data-pangea-utility-close] { width: 42px; height: 36px; border-radius: 6px; }
        [data-pangea-utility-body][data-pangea-tool-unavailable] { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 0; color: #25292e; text-align: center; }
        [data-pangea-utility-body][data-pangea-tool-unavailable] > * { width: auto; height: auto; }
        [data-pangea-tool-unavailable-icon] { color: #a4b29a; line-height: 1; font-size: 30px; }
        [data-pangea-tool-unavailable] h2 { margin: 18px 0 10px; font-size: 20px; line-height: 1.5; }
        [data-pangea-tool-unavailable] p { margin: 0; color: #8b9a7e; font-size: 12px; }
        [data-pangea-tool-unavailable] button { display: inline-flex; align-items: center; gap: 8px; margin-top: 22px; padding: 9px 13px; border: 1px solid #dfe3e0; border-radius: 6px; background: #fff; color: #25292e; font-size: 12px; cursor: pointer; }
        [data-pangea-utility-body] { min-width: 0; min-height: 0; overflow: hidden; background: #fff; }
        [data-pangea-utility-body] > * { width: 100%; height: 100%; min-width: 0; min-height: 0; }
        [data-pangea-file-layout] { display: flex; flex-direction: column; min-height: 0; }
        [data-pangea-file-tabs] { flex: none; display: flex; align-items: stretch; height: 35px; border-bottom: 1px solid #e7eae3; background: #fbfcf9; }
        [data-pangea-file-tabs] button { min-width: 120px; max-width: 200px; padding: 0 14px; border: 0; border-right: 1px solid #e7eae3; background: transparent; color: #75806f; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; cursor: pointer; }
        [data-pangea-file-tabs] button[data-active="true"] { background: #fff; color: #a62b39; box-shadow: inset 0 -2px #b62836; }
        [data-pangea-file-panels] { flex: 1; min-height: 0; display: flex; }
        [data-pangea-file-pane] { flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
        [data-pangea-file-pane][data-hidden="true"] { display: none; }
        [data-pangea-file-pane] + [data-pangea-file-pane] { border-left: 1px solid #dfe3dc; }
        [data-pangea-file-pane] > * { width: 100%; height: 100%; }
        [data-pangea-file-pane] > [data-pangea-file-side-head] { height: 32px; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; padding: 0 10px; border-bottom: 1px solid #e7eae3; color: #70767d; background: #fbfcf9; font-size: 11px; }
        [data-pangea-file-side-head] button { width: 22px; height: 22px; border: 0; background: transparent; color: #70767d; cursor: pointer; }
        [data-pangea-file-pane]:has([data-pangea-file-side-head]) > :last-child { height: calc(100% - 32px); }
        [data-pangea-file-panels]:has([data-side]) [data-pangea-file-pane] [class*="editorHeader"] { height: 88px; min-height: 88px; flex-wrap: wrap; align-content: center; gap: 6px; padding: 7px 10px; }
        [data-pangea-file-panels]:has([data-side]) [data-pangea-file-pane] [class*="editorPathInput"] { flex: 0 0 100%; width: 100%; }
        [data-pangea-terminal-dock] {
          box-sizing: border-box; min-width: 0; min-height: 0; margin: 0 28px 28px 32px; overflow: hidden;
          display: grid; grid-template-rows: 70px minmax(0, 1fr);
          border: 1px solid #dfe3e0; border-radius: 10px; color: #25292e; background: #fff;
        }
        [data-pangea-terminal-dock] [data-pangea-utility-head] {
          padding: 0 20px; border-color: #dfe3e0; color: #25292e; background: #fff;
        }
        [data-pangea-terminal-dock] [data-pangea-utility-title] {
          align-self: center; min-width: 0; height: auto; padding: 0; border: 0; border-radius: 0;
          box-shadow: none; color: #25292e; background: transparent;
        }
        [data-pangea-terminal-dock] [data-pangea-utility-workspace] { color: #70767d; font-size: 12px; font-weight: 400; }
        [data-pangea-terminal-dock] [data-pangea-terminal-fold] { height: 36px; padding: 0 13px; border: 1px solid #dfe3e0; border-radius: 6px; color: #25292e; background: #fff; cursor: pointer; }
        [data-pangea-terminal-dock] [data-pangea-utility-close] {
          width: 42px; height: 36px; border-color: #dfe3e0; color: #25292e; background: #fff;
        }
        [data-pangea-terminal-dock] [data-pangea-utility-body] { background: #fff; }
        [data-pangea-terminal-dock][data-collapsed] [data-pangea-utility-body] { display: none; }
        [data-pangea-terminal-dock]:has([data-pangea-tool-unavailable]) { grid-template-rows: 70px minmax(0, 1fr); border: 1px solid #dfe3e0; border-radius: 10px; background: #fff; }
        [data-pangea-terminal-dock]:has([data-pangea-tool-unavailable]) [data-pangea-utility-head] { padding: 0 20px; border-color: #dfe3e0; background: #fff; }
        [data-pangea-terminal-dock]:has([data-pangea-tool-unavailable]) [data-pangea-utility-title] { color: #25292e; background: transparent; }
        [data-pangea-terminal-dock]:has([data-pangea-tool-unavailable]) [data-pangea-utility-close] { color: #25292e; border-color: #dfe3e0; background: #fff; }
        [data-pangea-terminal-dock]:has([data-pangea-tool-unavailable]) [data-pangea-utility-body] { background: #fff; }

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
            box-sizing: border-box; padding-top: 0;
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
          body[data-pangea-product-shell] #root [data-pane="conversation"] > [data-pangea-assistant-portal="header"] { flex: 0 0 auto; }
          body[data-pangea-product-shell] #root [data-pangea-assistant-portal="process"] { display: flex; flex: 0 0 auto; min-height: 0; }
          body[data-pangea-product-shell] #root [data-pane="conversation"] .pXSMma_stack { display: none !important; }
          body[data-pangea-product-shell] #root [data-pane="conversation"] .wSkVaW_root[data-phase="hero"] .wSkVaW_scrollBody {
            justify-content: flex-end !important;
          }
          body[data-pangea-product-shell] #root [data-pane="conversation"] .wSkVaW_heroGlow { display: none !important; }
          body[data-pangea-product-shell][data-pangea-task-assistant] [data-pane="conversation"] [data-conversation-scroll] :is(p,li,pre) {
            font-size: 16px !important; line-height: 1.75 !important;
          }
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
            display: block; position: static; z-index: auto;
            box-sizing: border-box; width: 100%; height: auto;
            padding: 0 20px 14px; border-left: 1px solid #dfe3e8; border-bottom: 1px solid #e5e8ec;
            color: var(--pangea-ink); background: rgba(251,252,253,.98);
          }
        }
          [data-pangea-assistant-title] {
            height: 48px; display: flex; align-items: center; justify-content: space-between;
            font-size: 17px; font-weight: 720; letter-spacing: -.01em;
          }
          [data-pangea-assistant-card] {
            display: grid; grid-template-columns: 36px minmax(0,1fr);
            align-items: start; gap: 10px; padding: 12px; border: 1px solid #d9dde3;
            border-radius: 9px; background: #fff; box-shadow: 0 2px 8px rgba(25,31,40,.035);
          }
          [data-pangea-assistant-context] {
            display: grid; gap: 8px; margin-top: 10px; padding: 12px;
            border: 1px solid #e1e4e8; border-radius: 8px; background: #f4f5f3;
          }
          [data-pangea-assistant-context-heading] { color: #34383f; font-size: 13px; font-weight: 650; }
          [data-pangea-assistant-context-row] { display: grid; grid-template-columns: 82px minmax(0,1fr); gap: 8px; font-size: 12px; line-height: 1.55; }
          [data-pangea-assistant-context-row] > span { color: #757c87; }
          [data-pangea-assistant-context-row] > strong { min-width: 0; color: #34383f; font-weight: 550; overflow-wrap: anywhere; }
          [data-pangea-assistant-context-links] { display: grid; gap: 4px; }
          [data-pangea-assistant-context-links] button,
          [data-pangea-assistant-analysis-record] {
            min-width: 0; padding: 4px 0; border: 0; color: #496988; background: transparent;
            text-align: left; font: inherit; font-size: 12px; line-height: 1.55; cursor: pointer; overflow-wrap: anywhere;
          }
          [data-pangea-assistant-context-links] button:hover,
          [data-pangea-assistant-analysis-record]:hover { color: #b51f2a; text-decoration: underline; }
          [data-pangea-assistant-analysis-record] { width: 100%; border-top: 1px solid #e1e4e8; padding-top: 8px; font-weight: 600; }
          [data-pangea-assistant-icon] {
            width: 36px; height: 36px; display: grid; place-items: center; border-radius: 9px;
            color: var(--pangea-red); background: #fff0f1; border: 1px solid #ffd5d8;
          }
          [data-pangea-assistant-name] { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 16px; font-weight: 700; }
          [data-pangea-assistant-meta] { margin-top: 5px; color: #757c87; font-size: 14px; line-height: 1.45; }
          [data-pangea-assistant-progress] { margin-top: 4px; color: #68707c; font-size: 13px; }
          [data-pangea-assistant-select] {
            min-width: 0; flex: 1; height: 36px; border: 1px solid #d9dde3; border-radius: 6px;
            padding: 0 8px; color: #34383f; background: #fff; font: inherit; font-size: 14px;
          }
          [data-pangea-assistant-new] {
            height: 36px; flex: none; border: 1px solid #c7000b; border-radius: 6px; padding: 0 10px;
            color: #c7000b; background: #fff; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
          }
        [data-pangea-assistant-section-label] { display: block; margin-bottom: 5px; color: #68707c; font-size: 12px; font-weight: 600; }
        [data-pangea-assistant-conversations] { margin-top: 12px; }
        [data-pangea-assistant-actions] { display: flex; align-items: center; gap: 8px; }
        [data-pangea-assistant-feedback] { margin: 7px 0 0; color: #68707c; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
        [data-pangea-assistant-feedback="error"] { color: #b51d29; }
        [data-pangea-assistant-actions] :disabled { cursor: wait; opacity: .6; }
        [data-pangea-assistant-actions] :focus-visible { outline: 2px solid #c7000b; outline-offset: 2px; }

        @media (min-width: 1180px) and (max-width: 1479px) {
          :root { --pangea-ai-width: 360px; }
          [data-pangea-shell] { grid-template-columns: 196px minmax(0, 1fr); }
          [data-pangea-topbar] { padding-left: 28px; }
          [data-pangea-topbar-title] { margin-left: 22px; padding-left: 22px; font-size: 20px; }
          [data-pangea-project] { min-width: 168px; max-width: 220px; margin-left: 28px; }
          [data-pangea-product-nav] { padding-inline: 12px; }
          [data-pangea-assistant-head] { padding-inline: 20px; }
        }

        [data-pangea-assistant-process] { display: none; }
        [data-pangea-assistant-narrow-toggle] { display: none; }
        [data-composer-seat][data-pangea-analysis-readonly="true"] {
          display: none !important;
        }
        @media (min-width: 1180px) {
          body[data-pangea-product-shell][data-pangea-task-assistant] [data-pangea-assistant-process] {
            position: static; z-index: auto; display: flex; flex-direction: column; box-sizing: border-box; width: 100%;
            height: 100%; min-height: 0; max-height: none; overflow: hidden; padding: 14px 18px 12px; border-top: 1px solid #dfe3e8;
            color: var(--pangea-ink); background: rgba(251,252,253,.98);
          }
          [data-pangea-assistant-process-head] { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex: none; font-size: 16px; }
          [data-pangea-assistant-process-run] { display: block; margin-top: 3px; color: #757c87; font-size: 11px; font-weight: 500; }
          [data-pangea-assistant-process-status] { color: #68707c; font-size: 16px; }
          [data-pangea-assistant-process-status="failed"], [data-pangea-assistant-process-status="interrupted"] { color: var(--pangea-red); }
          [data-pangea-assistant-process-error] { flex: none; margin-top: 8px; color: var(--pangea-red); font-size: 16px; line-height: 26px; overflow-wrap: anywhere; }
          [data-pangea-assistant-process-output] { flex: 1; min-height: 48px; overflow: auto; margin: 8px 0 0; padding: 12px; border: 1px solid #e1e4e8; border-radius: 7px; color: #34383f; background: #fff; font: 15px/1.7 "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei UI", sans-serif; overflow-wrap: anywhere; }
          [data-pangea-assistant-process-output] > div > :first-child { margin-top: 0; }
          [data-pangea-assistant-process-output] pre { padding: 8px; border-radius: 5px; background: #f5f6f8; white-space: pre-wrap; }
          [data-pangea-assistant-process-events] { flex: none; max-height: 150px; overflow: auto; margin-top: 8px; color: #68707c; font-size: 16px; line-height: 26px; }
          [data-pangea-assistant-process-events] summary { cursor: pointer; color: #4d5560; }
          [data-pangea-assistant-process-event] { display: grid; grid-template-columns: 56px minmax(0,1fr); gap: 8px; }
          [data-pangea-assistant-process-event] time { color: #858c95; font-size: 12px; font-variant-numeric: tabular-nums; }
        }

        @media (max-width: 1179px) {
          body[data-pangea-product-shell] #root {
            width: 100% !important; margin-right: 0 !important;
          }
          body[data-pangea-product-shell] #root .pI_x6G_frame {
            box-sizing: border-box;
          }
          body[data-pangea-product-shell] #root .pI_x6G_sidebarCol { display: none !important; }
          body[data-pangea-product-shell] [data-dsh-panel-host] .nArs4W_panel {
            left: 0 !important; right: 0 !important; width: auto !important;
            border-left: 0 !important; border-right: 1px solid var(--dsw-alias-border-l2);
            padding-top: var(--pangea-topbar-height) !important;
            visibility: visible !important; transform: none !important; pointer-events: auto !important;
          }
          body[data-pangea-product-shell] [data-dsh-panel-host] .nArs4W_panelResize,
          body[data-pangea-product-shell] [data-dsh-panel-host] .nArs4W_tabBar,
          body[data-pangea-product-shell] [data-dsh-panel-host] .nArs4W_toggleCluster {
            display: none !important;
          }
          body[data-pangea-product-shell] [data-dsh-panel-host] .nArs4W_panelBody { height: 100%; }
          [data-pangea-shell] { grid-template-columns: 74px minmax(0, 1fr); }
          [data-pangea-product-nav] { padding-inline: 9px; }
          [data-pangea-nav-label], [data-pangea-nav-heading] { display: none; }
          [data-pangea-nav-button], [data-pangea-tool-button] { grid-template-columns: 1fr; padding: 0; place-items: center; }
          [data-pangea-topbar-title] { margin-left: 18px; padding-left: 18px; font-size: 18px; }
          [data-pangea-project] { display: none; }
          [data-pangea-assistant-narrow-toggle] {
            display: inline-flex; align-items: center; height: 34px; margin-right: 10px; padding: 0 12px;
            border: 1px solid #c7000b; border-radius: 6px; color: #c7000b; background: #fff; font: inherit; cursor: pointer;
          }
          [data-pangea-settings-page] { padding: 28px 24px 40px; }
          [data-pangea-settings-card] { grid-template-columns: minmax(0,1fr); gap: 18px; padding: 22px; }
          [data-pangea-settings-actions] { justify-content: flex-start; }
          body[data-pangea-product-shell][data-pangea-task-assistant] #root .pI_x6G_frame {
            grid-template-columns: 0 minmax(0, 1fr) 0 !important;
          }
          body[data-pangea-product-shell][data-pangea-task-assistant]:not([data-pangea-task-assistant-open]) #root [data-pane="conversation"] {
            display: none !important;
          }
          body[data-pangea-product-shell][data-pangea-task-assistant]:not([data-pangea-task-assistant-open]) #root [data-pane="details"] {
            grid-column: 2; grid-row: 1; display: block !important;
          }
          body[data-pangea-product-shell][data-pangea-task-assistant-open] #root .pI_x6G_frame {
            grid-template-columns: 0 0 minmax(0, 1fr) !important;
          }
          body[data-pangea-product-shell][data-pangea-task-assistant-open] #root [data-pane="details"] { display: none !important; }
          body[data-pangea-product-shell][data-pangea-task-assistant-open] #root [data-pane="conversation"] {
            grid-column: 3; grid-row: 1; display: flex !important; min-width: 0; padding-top: var(--pangea-topbar-height);
          }
          body[data-pangea-product-shell][data-pangea-task-assistant-open] [data-dsh-panel-host] .nArs4W_panel {
            border: 0 !important; background: transparent !important; pointer-events: none !important;
          }
          body[data-pangea-product-shell][data-pangea-task-assistant-open] [data-dsh-panel-host] .nArs4W_panelBody,
          body[data-pangea-product-shell][data-pangea-task-assistant-open] [data-dsh-panel-host] .nArs4W_workbench,
          body[data-pangea-product-shell][data-pangea-task-assistant-open] [data-dsh-panel-host] .nArs4W_pane,
          body[data-pangea-product-shell][data-pangea-task-assistant-open] [data-dsh-panel-host] .nArs4W_paneContent,
          body[data-pangea-product-shell][data-pangea-task-assistant-open] [data-dsh-panel-host] .nArs4W_paneTab {
            background: transparent !important;
          }
          body[data-pangea-product-shell][data-pangea-task-assistant-open] [data-pangea-shell] { background: transparent; pointer-events: none; }
          body[data-pangea-product-shell][data-pangea-task-assistant-open] [data-pangea-topbar] { pointer-events: auto; }
          body[data-pangea-product-shell][data-pangea-task-assistant-open] [data-pangea-product-nav],
          body[data-pangea-product-shell][data-pangea-task-assistant-open] [data-pangea-page] { display: none !important; }
          body[data-pangea-product-shell][data-pangea-task-assistant-open] [data-pangea-assistant-head] {
            display: block; height: auto; padding: 12px 16px; border-bottom: 1px solid #e5e8ec;
          }
          body[data-pangea-product-shell][data-pangea-task-assistant-open] [data-pangea-assistant-process] {
            display: flex; flex-direction: column; height: 100%; min-height: 0; max-height: none; padding: 12px 16px;
          }
        }

        @media (max-width: 760px) {
          [data-pangea-topbar] { padding-inline: 14px; }
          [data-pangea-topbar-brand] { width: 88px; }
          [data-pangea-logo] { width: 84px; }
          [data-pangea-topbar-title] { margin-left: 12px; padding-left: 12px; font-size: 16px; }
          [data-pangea-topbar-subtitle] { display: none; }
          [data-pangea-topbar-spacer] { min-width: 12px; }
          [data-pangea-system-state] { min-width: 0; gap: 6px; padding: 0; font-size: 12px; }
          [data-pangea-system-state] > span:last-child { overflow: hidden; text-overflow: ellipsis; }
          [data-pangea-system-dot] { flex-shrink: 0; }
          [data-pangea-assistant-narrow-toggle] { flex-shrink: 0; padding-inline: 8px; font-size: 12px; }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-pangea-nav-button], [data-pangea-tool-button] { transition: none; }
        }

        body[data-pangea-product-shell] #root [data-conversation-scroll][data-pangea-analysis-process="true"] {
          overflow: hidden;
        }
        body[data-pangea-product-shell] #root [data-conversation-scroll][data-pangea-analysis-process="true"] > [data-slot="conversation.session"] {
          display: none !important;
        }
        body[data-pangea-product-shell] #root [data-conversation-scroll][data-pangea-session-mismatch="true"] > [data-slot="conversation.session"],
        body[data-pangea-product-shell] #root [data-conversation-scroll][data-pangea-session-mismatch="true"] > [data-composer-seat] {
          display: none !important;
        }
        body[data-pangea-product-shell] #root [data-conversation-scroll][data-pangea-analysis-process="true"] > [data-pangea-assistant-portal="process"] {
          display: flex; flex: 1 1 0; min-height: 0; overflow: hidden;
        }
        body[data-pangea-product-shell] #root [data-conversation-scroll][data-pangea-analysis-process="true"] > [data-composer-seat] {
          z-index: 7; flex: 0 0 auto; position: sticky; bottom: 0;
        }

      `
      style.textContent += '\n' + /* PRODUCT_UI_CSS */ ''
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

    // Lucide 1.8.0, ISC; paths from the approved design's icon set.
    const productNavIcons = {"workbench":[["rect",{"width":"7","height":"9","x":"3","y":"3","rx":"1"}],["rect",{"width":"7","height":"5","x":"14","y":"3","rx":"1"}],["rect",{"width":"7","height":"9","x":"14","y":"12","rx":"1"}],["rect",{"width":"7","height":"5","x":"3","y":"16","rx":"1"}]],"analysis":[["path",{"d":"M3 7V5a2 2 0 0 1 2-2h2"}],["path",{"d":"M17 3h2a2 2 0 0 1 2 2v2"}],["path",{"d":"M21 17v2a2 2 0 0 1-2 2h-2"}],["path",{"d":"M7 21H5a2 2 0 0 1-2-2v-2"}],["path",{"d":"M7 12h10"}]],"assets":[["path",{"d":"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"}],["path",{"d":"M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"}],["path",{"d":"M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"}]],"file":[["path",{"d":"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"}]],"terminal":[["path",{"d":"m7 11 2-2-2-2"}],["path",{"d":"M11 13h4"}],["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2","ry":"2"}]],"browser":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"}],["path",{"d":"M2 12h20"}]],"settings":[["path",{"d":"M14 17H5"}],["path",{"d":"M19 7h-9"}],["circle",{"cx":"17","cy":"17","r":"3"}],["circle",{"cx":"7","cy":"7","r":"3"}]],"workspace":[["path",{"d":"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"}]]}
    function productIcon(kind, size = 24) {
      if (productNavIcons[kind]) return lineIcon(productNavIcons[kind].map(([tag, props], key) => h(tag, { ...props, key })), size, 1.65)
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
              : kind === 'settings'
                ? [h('circle', { key: 'a', cx: 12, cy: 12, r: 3 }), h('path', { key: 'b', d: 'M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.06 3.8l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06-.06A1.7 1.7 0 0 0 19.4 9c.12.39.33.74.6 1 .3.3.68.5 1.1.6h.1v4h-.1a1.7 1.7 0 0 0-1.7.4Z' })]
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

    function workspaceLabel(scope, workspaceList) {
      const items = Array.isArray(workspaceList?.items) ? workspaceList.items : []
      const workspace = typeof scope?.cwd === 'string'
        ? items.find(item => item.path === scope.cwd)
        : items.find(item => item.workspaceId === workspaceList?.recentWorkspaceId)
      const title = workspace?.title?.trim()
      if (title) return title
      const cwd = typeof scope?.cwd === 'string' ? scope.cwd.replace(/[\\/]+$/, '') : ''
      const name = cwd.split(/[\\/]/).pop()
      return name || '未选择工作区'
    }

    function utilityWorkspaceLabel(scope, workspaceList) {
      return workspaceLabel(scope, workspaceList)
    }

    function assistantGlyph() {
      return lineIcon([
        h('path', { key: 'a', d: 'M4 16.5 8.5 12l3.2 2.8L19.5 6' }),
        h('path', { key: 'b', d: 'M5 4h14v16H5Z' }),
        h('circle', { key: 'c', cx: 8.5, cy: 12, r: 1 }),
      ], 28, 1.8)
    }

    function ProductHeader({ scope, workspaceList, systemState, assistantVisible, assistantOpen, onToggleAssistant }) {
      return h('header', { 'data-pangea-topbar': true },
        h('div', { 'data-pangea-topbar-brand': true }, h('b', { 'aria-hidden': true }, 'P.'), h('span', null, 'PANGEA')),
        h('div', { 'data-pangea-topbar-title': true }, h('span', { 'data-pangea-topbar-subtitle': true }, '测试工作台')),
        h('div', { 'data-pangea-project': true, title: scope?.cwd ?? '', 'aria-label': `当前项目：${workspaceLabel(scope, workspaceList)}` },
          productIcon('workspace', 14), h('span', null, workspaceLabel(scope, workspaceList))),
        globalThis.dshDesktop ? h('span', { 'data-pangea-platform': true }, 'DESKTOP') : null,
        h('span', { 'data-pangea-topbar-spacer': true }),
        assistantVisible ? h('button', {
          type: 'button', 'data-pangea-assistant-narrow-toggle': true,
          'aria-expanded': assistantOpen ? 'true' : 'false', onClick: onToggleAssistant,
        }, assistantOpen ? '返回分析' : 'AI 助手') : null,
        h('div', { 'data-pangea-system-state': true, 'data-state': systemState.state, role: 'status' },
          h('span', { 'data-pangea-system-dot': true, 'aria-hidden': true }, systemState.state === 'ok' ? '✓' : '!'),
          h('span', null, systemState.label)))
    }

    function updateStatusCopy(status) {
      if (!status) return '正在读取 Desktop 版本信息…'
      if (status.phase === 'checking') return '正在读取并校验升级包…'
      if (status.phase === 'downloading') return `正在校验升级包 ${Math.round(status.percent ?? 0)}%`
      if (status.phase === 'downloaded') return `${status.availableVersion ?? '升级包'} 已就绪`
      if (status.phase === 'install-error') return status.message ?? '升级未完成，当前版本已保留。'
      if (status.phase === 'error') return status.message ?? '升级包校验失败。'
      if (status.phase === 'unsupported') return status.message ?? '当前环境不支持应用内升级。'
      return '当前没有待安装的升级包。'
    }

    const settingsIcons = {"Cpu":[["path",{"d":"M12 20v2"}],["path",{"d":"M12 2v2"}],["path",{"d":"M17 20v2"}],["path",{"d":"M17 2v2"}],["path",{"d":"M2 12h2"}],["path",{"d":"M2 17h2"}],["path",{"d":"M2 7h2"}],["path",{"d":"M20 12h2"}],["path",{"d":"M20 17h2"}],["path",{"d":"M20 7h2"}],["path",{"d":"M7 20v2"}],["path",{"d":"M7 2v2"}],["rect",{"x":"4","y":"4","width":"16","height":"16","rx":"2"}],["rect",{"x":"8","y":"8","width":"8","height":"8","rx":"1"}]],"PackageCheck":[["path",{"d":"M12 22V12"}],["path",{"d":"m16 17 2 2 4-4"}],["path",{"d":"M21 11.127V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.729l7 4a2 2 0 0 0 2 .001l1.32-.753"}],["path",{"d":"M3.29 7 12 12l8.71-5"}],["path",{"d":"m7.5 4.27 8.997 5.148"}]],"SlidersHorizontal":[["path",{"d":"M10 5H3"}],["path",{"d":"M12 19H3"}],["path",{"d":"M14 3v4"}],["path",{"d":"M16 17v4"}],["path",{"d":"M21 12h-9"}],["path",{"d":"M21 19h-5"}],["path",{"d":"M21 5h-7"}],["path",{"d":"M8 10v4"}],["path",{"d":"M8 12H3"}]],"ArrowLeft":[["path",{"d":"m12 19-7-7 7-7"}],["path",{"d":"M19 12H5"}]],"ArrowRight":[["path",{"d":"M5 12h14"}],["path",{"d":"m12 5 7 7-7 7"}]],"ChevronRight":[["path",{"d":"m9 18 6-6-6-6"}]],"Pencil":[["path",{"d":"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}],["path",{"d":"m15 5 4 4"}]],"Plus":[["path",{"d":"M5 12h14"}],["path",{"d":"M12 5v14"}]],"Settings2":[["path",{"d":"M14 17H5"}],["path",{"d":"M19 7h-9"}],["circle",{"cx":"17","cy":"17","r":"3"}],["circle",{"cx":"7","cy":"7","r":"3"}]]}
    settingsIcons.Inbox = [["polyline",{"points":"22 12 16 12 14 15 10 15 8 12 2 12"}],["path",{"d":"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"}]]
    settingsIcons.FileArchive = [["path",{"d":"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"}],["path",{"d":"M14 2v6h6"}],["path",{"d":"M10 12h4"}],["path",{"d":"M10 16h4"}],["path",{"d":"M10 8h4"}]]
    settingsIcons.Unplug = [["path",{"d":"m4 16 3-3m7-7 3-3m-5 8 3 3m-1-8 3 3m-3 5-3 3m-4-4-3-3"}],["path",{"d":"M9 6 6 9a4 4 0 0 0 0 6l3 3a4 4 0 0 0 6 0l3-3"}]]
    settingsIcons.FolderOpen = [["path",{"d":"M6 14 7.5 11a2 2 0 0 1 1.8-1H20a2 2 0 0 1 1.9 2.5l-1.5 6A2 2 0 0 1 18.5 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9l.8 1.2A2 2 0 0 0 12 6H18a2 2 0 0 1 2 2v2"}]]
    settingsIcons.Activity = [["path",{"d":"M2 12h4l3-8 4 16 3-8h6"}]]
    settingsIcons.Upload = [["path",{"d":"M12 16V3m-4 4 4-4 4 4"}],["path",{"d":"M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"}]]
    function settingsIcon(name) {
      return React.cloneElement(lineIcon(settingsIcons[name].map(([tag, props], key) => h(tag, { ...props, key })), 17, 1.65), { className: 'lucide' })
    }

    function SettingsPage({ scope, service }) {
      const bridge = globalThis.dshDesktop
      const updateAvailable = typeof bridge?.getUpdateStatus === 'function'
        && typeof bridge?.importUpdatePackage === 'function'
        && typeof bridge?.installUpdate === 'function'
      const [updateStatus, setUpdateStatus] = React.useState(null)
      const [busyAction, setBusyAction] = React.useState(null)
      const [helperHandoff, setHelperHandoff] = React.useState(false)
      const [actionError, setActionError] = React.useState('')
      const [blockedDismissed, setBlockedDismissed] = React.useState(false)
      const [section, setSection] = React.useState('general')
      const [modelCatalog, setModelCatalog] = React.useState({ status: 'loading', connections: [] })
      const [modelCreating, setModelCreating] = React.useState(false)

      React.useEffect(() => {
        const receive = event => setModelCreating(event.detail.open && event.detail.create)
        window.addEventListener('pangea:model-settings-visibility', receive)
        return () => window.removeEventListener('pangea:model-settings-visibility', receive)
      }, [])

      React.useEffect(() => {
        const receive = event => setModelCatalog(event.detail)
        window.addEventListener('pangea:model-onboarding-state', receive)
        window.dispatchEvent(new CustomEvent('pangea:query-model-onboarding'))
        return () => window.removeEventListener('pangea:model-onboarding-state', receive)
      }, [])

      React.useEffect(() => {
        if (!updateAvailable) return undefined
        let active = true
        void bridge.getUpdateStatus()
          .then(status => { if (active) setUpdateStatus(status) })
          .catch(() => { if (active) setActionError('版本状态读取失败，请重试。') })
        const subscriptionId = typeof bridge.subscribeUpdateStatus === 'function'
          ? bridge.subscribeUpdateStatus(status => { if (active) setUpdateStatus(status) })
          : undefined
        return () => {
          active = false
          if (typeof subscriptionId === 'number') bridge.unsubscribeUpdateStatus?.(subscriptionId)
        }
      }, [bridge, updateAvailable])

      const openModels = (providerId, create = false) => window.dispatchEvent(new CustomEvent('pangea:open-model-settings', { detail: { mode: 'internal', providerId: typeof providerId === 'string' ? providerId : undefined, create } }))
      const importPackage = async () => {
        if (!updateAvailable || busyAction) return
        setBusyAction('import')
        setActionError('')
        try {
          const status = await bridge.importUpdatePackage()
          if (status) setUpdateStatus(status)
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        } finally {
          setBusyAction(null)
        }
      }
      const installPackage = async () => {
        if (!updateAvailable || busyAction || updateStatus?.phase !== 'downloaded') return
        setBusyAction('install')
        setBlockedDismissed(false)
        setHelperHandoff(false)
        setActionError('')
        try {
          const result = await bridge.installUpdate()
          if (result?.helperLaunched === true) {
            setHelperHandoff(true)
            return
          }
          const status = await bridge.getUpdateStatus()
          if (status) setUpdateStatus(status)
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        } finally {
          setBusyAction(null)
        }
      }
      const refreshUpdateStatus = async () => {
        if (!updateAvailable || busyAction) return
        setBusyAction('refresh')
        setActionError('')
        try {
          const status = await bridge.getUpdateStatus()
          if (status) setUpdateStatus(status)
        } catch {
          setActionError('版本状态读取失败，请重试。')
        } finally {
          setBusyAction(null)
        }
      }
      const updateError = actionError
        || (['error', 'install-error', 'unsupported'].includes(updateStatus?.phase) ? updateStatus?.message : '')

      const node = (tag, className, ...children) => h(tag, { className }, ...children)
      const button = (label, action, primary = false, icon = label === '返回工作台' ? 'ArrowLeft' : 'ArrowRight') => h('button', { type: 'button', className: `btn ${primary ? 'primary' : ''}`, onClick: action }, settingsIcon(icon), label)
      const badge = (label, tone = '') => node('span', `badge ${tone}`, label)
      const updateAction = (label, action, primary = false, icon = 'ArrowRight', disabled = false) => h('button', {
        type: 'button', className: `btn ${primary ? 'primary' : ''}`,
        'data-pangea-update-action': action, disabled,
        onClick: action === 'import' ? importPackage : action === 'refresh' ? refreshUpdateStatus : installPackage,
      }, settingsIcon(icon), label)
      const updateNotice = (title, message, tone = 'warn') => h('div', {
        className: `settings-update-notice ${tone}`, role: tone === 'danger' ? 'alert' : 'status',
      }, h('strong', null, title), h('p', null, message))
      const updatePackageFile = status => node('div', 'settings-update-file',
        settingsIcon('FileArchive'),
        h('div', null, h('strong', null, status?.packageName ?? '本地 ZIP 升级包'), h('p', null, status?.packageType === 'patch' ? '增量补丁 · 本地导入' : '完整升级 ZIP · 本地导入')),
        badge(status?.packageName ? '已选择' : '正在读取'))
      const updateRoute = (status, patch = status?.packageType === 'patch', tone = 'good') => node('div', 'settings-update-route',
        node('div', '', h('p', null, tone === 'danger' ? '当前安装' : '当前版本'), h('strong', null, status?.currentVersion ?? '正在读取')),
        settingsIcon(tone === 'danger' ? 'Unplug' : 'ArrowRight'),
        node('div', '', h('p', null, tone === 'danger' ? '补丁要求基线' : patch ? '目标版本 · 基线' : '目标版本'), h('strong', null, tone === 'danger' ? status?.baseVersion ?? '—' : status?.availableVersion ?? '—'), patch && tone !== 'danger' && status?.baseVersion ? h('span', { className: 'settings-update-base' }, `补丁基线 ${status.baseVersion}`) : null),
        badge(patch ? tone === 'danger' ? '不匹配' : '增量补丁' : '完整升级包', tone))
      const updatePanel = () => {
        const phase = updateStatus?.phase ?? (actionError ? 'status-error' : updateAvailable ? 'loading' : 'unsupported')
        const unpackagedEnvironment = phase === 'unsupported' && /已打包的 Windows/.test(updateStatus?.message ?? '')
        const baseMismatch = phase === 'error' && updateStatus?.packageType === 'patch' && Boolean(updateStatus.baseVersion) && updateStatus.baseVersion !== updateStatus.currentVersion
        const activeBlocked = phase === 'downloaded' && !blockedDismissed && /分析.*(?:运行|进行)/.test(updateStatus?.message ?? '')
        const phaseTitle = helperHandoff ? '正在准备重启' : activeBlocked ? '先完成正在运行的分析' : phase === 'downloaded' && busyAction === 'install' ? '正在检查安装条件' : ({
          loading: '正在读取版本状态', idle: '当前没有待安装的升级包', checking: '正在读取升级包',
          downloading: '正在校验升级包', downloaded: '升级已就绪', error: baseMismatch ? '补丁基线与当前版本不一致' : '这个升级包未通过校验',
          'install-error': '升级未完成，当前版本可继续使用', unsupported: '当前环境不支持应用内升级', 'status-error': '暂时无法读取版本状态',
        }[phase] ?? '版本状态暂不可用')
        const descriptions = {
          loading: '正在读取当前 Desktop 与本地升级包状态。',
          idle: '从本机选择完整升级包或增量补丁。',
          checking: '正在识别包类型并准备校验。',
          downloading: '检查包的完整性、签名与版本兼容性。',
          downloaded: '升级包已验证。完成当前工作后，可以安排安装并重启。',
          error: baseMismatch
            ? `请选择以 ${updateStatus.currentVersion} 为基线的补丁，或使用完整升级包。`
            : '当前版本保持不变，尚未准备任何安装操作。',
          'install-error': `目标版本 ${updateStatus?.availableVersion ?? '—'} 未能完成安装，当前可用版本已经恢复启动。`,
          unsupported: updateStatus?.message ?? 'ZIP 升级仅在已打包的 Windows Desktop 中可用。',
          'status-error': '尚未确认是否有准备完成的升级包。',
        }
        const content = []
        const busyImport = busyAction === 'import' || phase === 'checking' || phase === 'downloading'
        const busyInstall = busyAction === 'install'
        const hasError = Boolean(updateError)
        if (helperHandoff) {
          content.push(h('div', { className: 'settings-update-progress indeterminate', role: 'progressbar', 'aria-label': '正在重启', 'aria-busy': 'true' }, h('span')))
          content.push(h('p', { className: 'settings-form-note' }, 'Desktop 将退出并重新启动，请等待升级完成。'))
        } else if (activeBlocked) {
          content.push(updateNotice('分析会话正在运行', '升级包已保留。任务结束后，返回版本设置重试安装。'))
          content.push(node('div', 'callout settings-update-idle', node('div', 'row', settingsIcon('Activity'), h('span', { className: 'small' }, '你可以返回任务列表查看运行状态。'))))
        } else if (busyInstall && phase === 'downloaded') {
          content.push(h('div', { className: 'settings-update-progress', role: 'progressbar', 'aria-label': '正在检查安装条件', 'aria-busy': 'true' }, h('span', { style: { width: '34%' } })))
          content.push(h('p', { className: 'settings-form-note' }, '请保持 Desktop 打开，确认安装条件后将开始升级。'))
        } else if (phase === 'checking' || phase === 'downloading') {
          content.push(updatePackageFile(updateStatus))
          if (phase === 'downloading') {
            const percent = Math.round(Math.max(0, Math.min(100, updateStatus?.percent ?? 0)))
            content.push(h('div', { className: 'settings-update-progress', role: 'progressbar', 'aria-label': '本地升级包校验进度', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent }, h('span', { style: { width: `${percent}%` } })))
            content.push(node('div', 'settings-update-progress-label', h('span', null, '校验中'), h('strong', null, `${percent}%`)))
          } else {
            content.push(h('div', { className: 'settings-update-progress indeterminate', role: 'progressbar', 'aria-label': '正在读取本地升级包', 'aria-busy': 'true' }, h('span')))
            content.push(h('p', { className: 'settings-form-note' }, '请保持 PANGEA Desktop 打开。'))
          }
        } else if (phase === 'downloaded') {
          content.push(updateRoute(updateStatus))
          content.push(node('div', 'settings-update-check', settingsIcon('PackageCheck'), h('span', null, '签名与文件完整性校验已完成。')))
          if (updateStatus?.packageType === 'patch' && updateStatus.baseVersion) {
            const matches = updateStatus.baseVersion === updateStatus.currentVersion
            content.push(node('div', `settings-update-check ${matches ? '' : 'warning'}`, settingsIcon(matches ? 'PackageCheck' : 'ArrowRight'), h('span', null, `补丁基线 ${updateStatus.baseVersion}${matches ? ' 与当前版本一致。' : ` 与当前版本 ${updateStatus.currentVersion} 不一致，不能安装。`}`)))
          }
          if (updateStatus?.message) content.push(updateNotice('安装暂未开始', updateStatus.message))
          if (busyInstall) content.push(h('div', { className: 'settings-update-progress indeterminate', role: 'progressbar', 'aria-label': '正在准备安全重启', 'aria-busy': 'true' }, h('span')))
        } else if (phase === 'error' || phase === 'install-error' || phase === 'unsupported') {
          if (baseMismatch) content.push(updateRoute(updateStatus, true, 'danger'))
          else if (phase === 'error' && updateStatus?.packageName) content.push(updatePackageFile(updateStatus))
          const signatureFailure = phase === 'error' && /签名/.test(updateStatus?.message ?? '')
          content.push(updateNotice(phase === 'unsupported' ? '升级能力不可用' : phase === 'install-error' ? '安装助手报告升级失败' : baseMismatch ? '不能应用这份补丁' : signatureFailure ? '签名校验失败' : '升级包没有通过校验', unpackagedEnvironment ? '当前运行环境没有提供升级包导入与安装能力。' : baseMismatch ? '增量包仅适用于它声明的原始版本。当前安装尚未发生变更。' : phase === 'install-error' ? updateStatus?.message ?? '安装助手未返回失败详情。' : signatureFailure ? '请选择由 PANGEA Desktop 构建生成的签名完整包或补丁包。' : updateStatus?.message ?? updateError ?? descriptions[phase], phase === 'unsupported' ? 'info' : baseMismatch || phase === 'install-error' ? 'warn' : 'danger'))
        } else if (phase === 'status-error') {
          content.push(updateNotice('状态读取失败', '请重新读取最新版本状态。', 'warn'))
        } else if (phase === 'idle') {
          content.push(node('div', 'callout settings-update-idle', node('div', 'row', settingsIcon('FolderOpen'), h('span', { className: 'small' }, '选择原始 ZIP 文件，无需提前解压。'))))
        } else {
          content.push(node('div', 'settings-update-progress indeterminate', h('span')))
        }
        if (actionError && phase !== 'status-error' && updateStatus?.phase !== 'error' && updateStatus?.phase !== 'install-error') {
          content.push(updateNotice('操作未完成', actionError))
        } else if (hasError && phase === 'loading') {
          content.push(updateNotice('状态读取失败', updateError, 'danger'))
        }

        const actions = []
        if (helperHandoff) {
          actions.push(updateAction('正在重启…', 'install', true, 'PackageCheck', true))
        } else if (activeBlocked) {
          actions.push(button('查看分析任务', () => service.openPage(scope, 'analysis'), true))
          actions.push(h('button', { type: 'button', className: 'settings-update-return', onClick: () => setBlockedDismissed(true) }, '返回版本设置'))
        } else if (busyInstall && phase === 'downloaded') {
          actions.push(updateAction('正在检查…', 'install', true, 'PackageCheck', true))
        } else if (phase === 'status-error') {
          actions.push(updateAction(busyAction === 'refresh' ? '正在重新读取…' : '重新读取状态', 'refresh', true, 'PackageCheck', busyAction === 'refresh' || !updateAvailable))
        } else if (phase === 'downloaded') {
          const baseMatches = updateStatus?.packageType !== 'patch' || !updateStatus.baseVersion || updateStatus.baseVersion === updateStatus.currentVersion
          actions.push(updateAction(busyInstall ? '正在准备重启…' : updateStatus?.message ? '重试安装' : '安装并重启', 'install', true, 'PackageCheck', busyInstall || busyImport || !baseMatches))
          actions.push(updateAction(busyImport ? '正在读取…' : '重新导入', 'import', false, 'FileArchive', busyImport || busyInstall))
        } else if (phase === 'checking' || phase === 'downloading' || busyInstall) {
          actions.push(updateAction(phase === 'downloading' ? '正在校验…' : busyInstall ? '正在准备重启…' : '正在读取…', 'import', true, 'PackageCheck', true))
        } else if (phase !== 'unsupported') {
          actions.push(updateAction(busyImport ? (phase === 'checking' ? '正在读取…' : '正在打开…') : baseMismatch ? '选择兼容升级包' : phase === 'install-error' ? '重新导入升级包' : phase === 'error' ? '重新选择升级包' : '导入升级包', 'import', true, phase === 'error' || baseMismatch ? 'FolderOpen' : 'Upload', phase === 'loading' || !updateAvailable || busyImport || busyInstall))
          if (phase === 'install-error') actions.push(h('button', { type: 'button', className: 'settings-update-return', onClick: () => service.openPage(scope, 'workbench') }, '返回工作台'))
        } else {
          actions.push(updateAction('导入升级包', 'import', true, 'FileArchive', true))
        }

        return h(React.Fragment, null,
          node('div', 'settings-section-head', node('div', '', h('h2', null, '版本与升级'), h('p', null, '导入签名升级包，校验后选择合适的时间安装。'))),
          node('div', 'settings-main-cols',
            h('section', { className: 'panel settings-update-card', 'data-pangea-update-state': phase },
              node('div', 'settings-version-hero', node('div', 'settings-version-mark', 'P.'), node('div', '', h('h3', null, 'PANGEA Desktop'), h('p', null, '当前版本 ', h('strong', null, updateStatus?.currentVersion ?? (hasError ? '读取失败' : '正在读取')), ' · Windows'))),
              node('div', 'divider'), node('div', 'settings-fine-label', 'DESKTOP UPDATE'),
              h('h3', { className: 'settings-update-title' }, phaseTitle),
              h('p', { className: 'settings-update-description' }, helperHandoff ? '安装助手已经接管接下来的版本替换。' : activeBlocked ? '当前仍有分析会话运行，安装与重启未执行。' : busyInstall && phase === 'downloaded' ? '正在检查运行中的分析并准备已验证升级包。' : descriptions[phase] ?? updateStatusCopy(updateStatus)),
              ...content,
              node('div', 'settings-update-actions', ...actions)),
            h('aside', { className: 'panel settings-help', 'aria-label': '升级前了解' },
              h('h2', { className: 'panel-title' }, updateAvailable && phase !== 'unsupported' ? '升级前了解' : '当前环境'),
              h('p', null, updateAvailable && phase !== 'unsupported' ? '使用 PANGEA Desktop 构建生成的原始签名 ZIP。' : unpackagedEnvironment ? '应用内 ZIP 升级仅由已打包的 Windows Desktop 提供。' : updateStatus?.message ?? '应用内 ZIP 升级仅由已打包的 Windows Desktop 提供。'),
              updateAvailable && phase !== 'unsupported' ? h(React.Fragment, null,
                node('div', 'divider'), h('h3', null, '完整包'), h('p', null, '完整校验后准备替换当前版本。'),
                h('h3', null, '增量补丁'), h('p', null, '只接受与当前版本严格匹配的补丁基线。'),
                node('div', 'divider'), h('p', null, '有分析会话运行时，安装与重启会被阻止。可以先完成当前分析。')) : null)))
      }
      const connections = modelCatalog.connections ?? []
      const modelCount = connections.every(item => item.modelCount != null) ? connections.reduce((sum, item) => sum + item.modelCount, 0) : null
      const modelStatus = modelCatalog.status === 'ready' ? modelCatalog.modelAvailable ? '已配置' : '待配置' : modelCatalog.status === 'error' ? '读取失败' : '正在读取'
      const modelMetrics = node('div', 'settings-overview-metrics',
        node('div', '', node('span', '', '连接'), node('strong', '', connections.length ? connections.map(item => item.name).join('、') : modelCatalog.status === 'ready' ? '尚未配置' : '—')),
        node('div', '', node('span', '', '模型列表'), node('strong', '', modelCatalog.status !== 'ready' ? '待读取目录' : modelCount == null ? '未提供模型数量' : `${modelCount} 个模型`)))
      const card = (title, description, icon, state, metrics, note, action) => node('section', 'panel settings-overview-card',
        node('div', 'settings-overview-head', node('div', 'settings-brand-icon', settingsIcon(icon)), node('div', '', h('h3', null, title), h('p', null, description)), state),
        metrics, node('div', 'settings-overview-foot', node('span', 'settings-form-note', note), action))
      const modelCard = card('模型与 API', '配置 PANGEA 分析使用的模型接口与 API 凭据。', 'Cpu', badge(modelStatus, modelCatalog.status === 'ready' && modelCatalog.modelAvailable ? 'good' : ''), modelMetrics, '外部 Agent 的模型在新建分析时选择', button('打开模型设置', openModels, true))
      const versionCard = card('版本与升级', '导入并校验 PANGEA Desktop 签名升级包。', 'PackageCheck', badge('Windows'),
        node('div', 'settings-overview-metrics', node('div', '', node('span', '', '当前版本'), node('strong', '', updateStatus?.currentVersion ?? '待读取')), node('div', '', node('span', '', '升级状态'), node('strong', '', actionError ? '读取失败' : !updateStatus ? '正在读取' : updateStatus.phase === 'idle' ? '暂无待安装包' : updateStatusCopy(updateStatus)))),
        '支持完整包与严格匹配基线的增量补丁', button('管理版本', () => setSection('update')))
      const help = node('aside', 'panel settings-help', h('h2', { className: 'panel-title' }, '设置作用范围'), h('p', null, '模型配置用于本地模型接入。每次分析仍可单独选择已就绪的执行方式与模型。'), node('div', 'divider'), h('h3', null, '升级你的 Desktop'), h('p', null, '选择原始签名 ZIP，无需提前解压。完成校验后，再决定何时安装并重启。'))
      const modelsEmpty = modelCatalog.status === 'ready' && connections.length === 0 && !modelCatalog.modelAvailable
      const modelsHelp = node('aside', 'panel settings-help', h('h2', { className: 'panel-title' }, '接入说明'), h('p', null, 'API 密钥通过独立凭据接口保存，设置页不显示已保存密钥。'), h('p', null, '接口地址、协议与模型目录共同决定模型如何被调用。'), node('div', 'divider'), h('p', null, '推理级别跟随具体模型能力，在新建分析或模型选择时设置。'))
      const renderConnection = connection => {
        const credential = connection.credentialConfigured ? '已配置 · 单独安全保存' : connection.credentialRequired ? '尚未配置' : '使用提供方原生认证'
        return h('section', { key: connection.id, className: 'panel' },
          node('div', 'settings-model-status', node('div', 'row', node('div', 'settings-brand-icon', connection.id.slice(0, 1).toUpperCase()), node('div', '', h('h3', null, connection.name), node('p', 'mono', `${connection.id} · ${connection.custom ? '自定义接口' : '原生提供方'}`))), badge(connection.credentialConfigured ? 'API 密钥已配置' : connection.credentialRequired ? 'API 密钥未配置' : '提供方原生认证', connection.usable ? 'good' : '')),
          node('dl', 'key-value', h('dt', null, '接口地址'), node('dd', 'mono small', connection.baseURL ?? '由提供方管理'), h('dt', null, 'API 协议'), node('dd', 'mono small', connection.protocol ?? '由提供方管理'), h('dt', null, '凭据'), h('dd', null, credential)), node('div', 'divider'),
          node('div', 'section-head', h('h2', null, '可用模型'), badge(connection.modelCount ?? '未知')),
          connection.models ? node('div', 'table-wrap', h('table', null, h('thead', null, h('tr', null, ['模型', '模型 ID', '输入'].map(label => h('th', { key: label }, label)))), h('tbody', null, connection.models.map(model => h('tr', { key: model.id }, h('td', null, model.name), h('td', null, node('span', 'mono small', model.id)), h('td', null, model.input?.includes('image') ? model.input.includes('text') ? '文本与图像' : '图像' : '文本')))))) : h('p', { className: 'settings-form-note' }, '提供方未声明模型目录，可打开模型设置查看原生配置。'),
          node('div', 'settings-savebar', node('span', 'settings-form-note', '配置状态不代表网络连通性'), button('编辑模型目录', () => openModels(connection.id), false, 'Pencil')))
      }
      const modelsBody = modelCreating ? node('section', 'panel', node('div', 'empty', node('div', 'empty-icon', settingsIcon('Inbox')), h('h2', null, '准备连接模型'), h('p', null, '设置接口与可用模型后即可开始。'), node('div', 'row'))) : modelsEmpty ? node('section', 'panel', node('div', 'settings-empty', h('div', { className: 'settings-brand-icon', style: { margin: 'auto', width: 54, height: 54 } }, settingsIcon('Cpu')), h('h3', null, '添加第一个模型连接'), h('p', null, '填写接口地址、协议与模型列表。如果提供方使用 API 密钥，也可以在这里一并保存。'), modelCatalog.customAvailable ? button('连接模型接口', () => openModels(undefined, true), true, 'Plus') : button('查看提供方', () => openModels(), true, 'ArrowRight'))) : node('div', 'settings-main-cols', node('div', 'stack', connections.map(renderConnection)), modelsHelp)
      const updateCrumb = helperHandoff ? '正在重启升级' : updateStatus?.phase === 'checking' ? '读取升级包'
        : updateStatus?.phase === 'downloading' ? '校验升级包'
        : updateStatus?.phase === 'downloaded' && busyAction === 'install' ? '安装前检查'
        : updateStatus?.phase === 'downloaded' && !blockedDismissed && /分析.*(?:运行|进行)/.test(updateStatus?.message ?? '') ? '运行中阻止重启'
        : updateStatus?.phase === 'downloaded' ? updateStatus?.packageType === 'patch' ? '增量补丁已就绪' : '完整升级包已就绪'
        : updateStatus?.phase === 'error' && updateStatus?.packageType === 'patch' && updateStatus?.baseVersion && updateStatus.baseVersion !== updateStatus.currentVersion ? '增量补丁版本不匹配'
        : updateStatus?.phase === 'error' ? '升级包校验失败'
        : updateStatus?.phase === 'install-error' ? '升级未完成'
        : updateStatus?.phase === 'unsupported' ? '当前环境无法导入'
        : actionError ? '版本状态读取失败' : '版本与升级'
      const sectionTitle = { general: updateStatus?.phase === 'downloaded' ? '升级就绪通知' : '概览', models: modelCreating ? '连接模型接口' : modelsEmpty ? '首次连接模型' : '模型与 API', update: updateCrumb }[section]
      return node('section', 'pangea-ui pangea-settings-workspace',
        node('div', 'breadcrumb', '工作空间', settingsIcon('ChevronRight'), '设置', settingsIcon('ChevronRight'), sectionTitle),
        node('header', 'page-head', node('div', '', h('h1', null, '设置'), h('p', null, '管理模型接入、应用版本与本地升级。')), button('返回工作台', () => service.openPage(scope, 'workbench'))),
        node('div', 'settings-layout', h('nav', { className: 'settings-nav', 'aria-label': '设置分类' }, node('div', 'settings-nav-label', 'PANGEA DESKTOP'),
          [['general', '概览', 'SlidersHorizontal'], ['models', '模型与 API', 'Cpu'], ['update', '版本与升级', 'PackageCheck']].map(([id, title, icon]) => h('button', { key: id, type: 'button', className: section === id ? 'active' : '', 'aria-current': section === id ? 'page' : undefined, onClick: () => setSection(id) }, settingsIcon(icon), title)),
          node('div', 'divider'), node('div', 'settings-form-note', '本地模型接入', h('br'), '版本与签名升级')),
          node('div', 'settings-content', section === 'update' ? updatePanel() : h(React.Fragment, null,
            node('div', 'settings-section-head', node('div', '', h('h2', null, section === 'general' ? '为分析准备好连接与版本' : '模型与 API'), h('p', null, section === 'general' ? '在这里配置模型，查看当前版本，并导入本地升级包。' : modelCreating ? '连接一个内部模型接口。' : modelsEmpty ? '连接一个内部模型接口，开始你的第一项分析。' : '配置内部自定义模型接口与凭据。')), section === 'models' && !modelsEmpty && button('打开模型设置', () => openModels(), true, 'Settings2')),
            modelCatalog.status === 'error' && h('p', { role: 'alert' }, modelCatalog.error ?? '模型目录读取失败'),
            section === 'models' ? modelsBody : node('div', 'settings-main-cols', node('div', 'stack', modelCard, versionCard), help)))))
    }

    function chinesePhase(value) {
      return { PREPARING: '准备中', PLANNING: '规划中', ANALYZING: '分析中', REVIEWING: '检查分析结果', REVIEW: '检查分析结果', INDEPENDENT_REVIEW: '独立检查', COMPARISON_REVIEW: '对照检查', TARGETED_CLOSURE: '完善结果', COMPLETED: '已完成', COMPLETE: '已完成', FAILED: '需要处理', STOPPED: '已停止', INTERRUPTED: '已中断', PENDING: '等待开始', QUEUED: '等待处理', RUNNING: '运行中', FINALIZING: '保存结果' }[String(value ?? '').toUpperCase()] ?? value
    }

    function AssistantPageHeader({ context, onClose }) {
      const record = context?.activeConversationKind === 'analysis' || context?.activeConversationKind === 'architecture'
      const tabs = [
        ['overview', '概览'], ['flows', '业务流程'], ['risks', '风险'], ['cases', '测试用例'], ['workflow', '运行过程'],
      ]
      const tabCounts = context?.tabCounts ?? {}
      const runLabel = context?.runId ? `RUN ${String(context.runId).replace(/^run[-_ ]/i, '')}` : null
      const startedAt = context?.startedAt ? new Date(context.startedAt) : null
      const startedLabel = startedAt && !Number.isNaN(startedAt.getTime())
        ? `${startedAt.toDateString() === new Date().toDateString() ? '今天' : `${startedAt.getMonth() + 1}月${startedAt.getDate()}日`}${startedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })} 开始`
        : null
      return h('header', { 'data-pangea-assistant-page-head': true },
        h('div', { 'data-pangea-assistant-breadcrumb': true }, 'PANGEA 分析', ' › ', (context?.taskTitle || context?.title || context?.target || '当前任务').replace(/分析$/, ''), ' › ', 'AI 助手'),
        h('div', { 'data-pangea-assistant-page-title-row': true },
          h('div', null,
            h('h1', null, context?.taskTitle || context?.title || '当前分析'),
            h('p', null, [context?.repository, context?.target].filter(Boolean).join(' / '), runLabel ? ` · ${runLabel}` : '', startedLabel ? ` · ${startedLabel}` : '')),
          h('button', { type: 'button', onClick: onClose }, '← 返回任务')),
        h('nav', { 'data-pangea-assistant-task-tabs': true, 'aria-label': '任务页面' }, tabs.map(([type, label]) =>
          h('button', { key: type, type: 'button', 'aria-current': type === (record ? 'workflow' : 'overview') ? 'page' : undefined,
            onClick: () => { onClose(); context?.onOpenTab?.(type) },
          }, label, Number.isFinite(tabCounts[type]) ? h('small', null, ` ${tabCounts[type]}`) : null))))
    }

    function AssistantHeader({ context }) {
      const [pending, setPending] = React.useState(null)
      const [failure, setFailure] = React.useState(null)
      const operationRef = React.useRef(null)
      const percent = Number.isFinite(context?.percent) ? Math.max(0, Math.min(100, context.percent)) : undefined
      const conversations = Array.isArray(context?.conversations) ? context.conversations : []
      const activeConversation = conversations.find(item => item.conversation_id === context?.activeConversationId)
      const kind = activeConversation?.kind ?? context?.activeConversationKind
      const kindLabel = item => item.kind_label || ({ analysis: '分析记录', architecture: '图表', assistant: '讨论' }[item.kind] ?? '讨论')
      const discussionContext = context?.discussionContext ?? {}
      const focus = discussionContext.focus
      const relatedItems = Array.isArray(discussionContext.relatedItems) ? discussionContext.relatedItems : []
      const relatedCases = relatedItems.filter(item => item.kind === 'case')
      const relatedLinks = relatedCases.length > 1
        ? [{ kind: 'cases', id: '', label: `测试用例（${relatedCases.length}） ↗` }, ...relatedItems.filter(item => item.kind !== 'case')]
        : relatedItems
      const sources = Array.isArray(discussionContext.sources) ? discussionContext.sources : []
      const analysisConversation = conversations.find(item => item.kind === 'analysis' && item.session_id
        && (!context.ownerSessionId || item.session_id === context.ownerSessionId))
      const pendingType = context?.conversationPending || (pending?.taskId === context?.taskId ? pending?.type : '')
      const busy = Boolean(pendingType)
      const error = !busy && context?.taskId && failure?.taskId === context.taskId ? failure.message : ''
      const taskTitle = context?.taskTitle || context?.title || '选择一个分析任务'
      const runAction = async (type, conversationId) => {
        if (!context?.taskId || busy || operationRef.current?.taskId === context.taskId) return
        const callback = type === 'create' ? context.onCreateConversation : context.onSelectConversation
        if (typeof callback !== 'function' || (type === 'select' && conversationId === context.activeConversationId)) return
        const operation = { taskId: context.taskId, type, conversationId }
        operationRef.current = operation
        setPending(operation)
        setFailure(null)
        try {
          await callback(conversationId)
        } catch (reason) {
          if (operationRef.current === operation) setFailure({ taskId: operation.taskId,
            message: `${type === 'create' ? '新建讨论失败' : '切换会话失败'}：${reason?.message || String(reason)}` })
        } finally {
          if (operationRef.current === operation) {
            operationRef.current = null
            setPending(null)
          }
        }
      }
      const feedback = busy ? pendingType === 'create' ? '正在创建讨论会话…' : '正在切换会话…'
        : error || (kind === 'analysis' ? '分析记录只读；可新建讨论，继续提问。'
          : kind === 'architecture' ? '当前图表的生成记录。' : '讨论会话，可以继续提问。')
      if (kind === 'assistant') return h('aside', { 'data-pangea-assistant-head': true, 'data-conversation-kind': kind, 'aria-label': 'AI 助手当前任务' },
        h('div', { 'data-pangea-assistant-discussion-top': true },
          h('div', null,
            h('h2', null, '讨论当前分析'),
            h('p', null, `${taskTitle} · ${activeConversation?.display_title || activeConversation?.title || '新讨论'}`)),
          h('div', { 'data-pangea-assistant-session-badge': true },
            h('span', { 'aria-hidden': 'true' }, '讨论会话'),
            h('select', { 'data-pangea-assistant-select': true, 'aria-label': '切换任务会话',
              disabled: busy || !conversations.length, value: context?.activeConversationId ?? '',
              onChange: event => runAction('select', event.target.value),
            }, conversations.map(item => h('option', { key: item.conversation_id, value: item.conversation_id }, `${kindLabel(item)} · ${item.display_title || item.title}`))))),
        h('div', { 'data-pangea-assistant-discussion-callout': true },
          lineIcon([h('path', { key: 'link', d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }), h('path', { key: 'chain', d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' })], 16),
          `上下文：当前任务 / ${discussionContext.runId || context?.runId ? `RUN ${String(discussionContext.runId || context.runId).replace(/^run[-_ ]/i, '')}` : '暂无 Run'}${focus ? ` / ${focus.kind === 'risk' ? '风险' : '用例'} ${focus.id}` : ''}`),
        h('div', { 'data-pangea-assistant-right': true },
        h('section', { 'data-pangea-assistant-context': true, 'aria-label': '当前分析上下文' },
          h('h3', null, '当前上下文'),
          h('div', { 'data-pangea-assistant-context-row': true }, h('span', null, '任务'), h('strong', null, taskTitle)),
          h('div', { 'data-pangea-assistant-context-row': true }, h('span', null, '运行'), h('strong', null, discussionContext.runId ? `RUN ${String(discussionContext.runId).replace(/^run[-_ ]/i, '')}` : '尚无 Run')),
          focus ? h('div', { 'data-pangea-assistant-context-row': true }, h('span', null, '关注对象'), h('strong', null, `${focus.id} · ${focus.title}`)) : null,
          analysisConversation ? h('button', { type: 'button', 'data-pangea-assistant-analysis-record': true, disabled: busy,
            onClick: () => runAction('select', analysisConversation.conversation_id) }, '查看分析记录 ↗') : null),
        h('section', { 'data-pangea-assistant-related': true, 'aria-label': '相关内容' },
          h('h3', null, '相关内容'),
          focus ? h('button', { type: 'button', onClick: () => context.onNavigateTo?.(focus.kind, focus.id) }, focus.kind === 'risk' ? '风险详情 ↗' : '用例详情 ↗') : null,
          ...relatedLinks.map(item => h('button', { key: `${item.kind}:${item.id}`, type: 'button', onClick: () => context.onNavigateTo?.(item.kind, item.id) }, item.label)),
          ...sources.map((item, index) => h('button', { key: `${item.location}:${index}`, type: 'button', onClick: () => context.onOpenSource?.(item.location), title: item.location }, item.label)))),
        h('div', { 'data-pangea-assistant-discussion-actions': true },
          h('button', { type: 'button', 'data-pangea-assistant-new': true, disabled: busy || !context?.taskId,
            onClick: () => runAction('create') }, pendingType === 'create' ? '创建中…' : '新建讨论')),
        h('p', { 'data-pangea-assistant-discussion-status': true, role: 'status' }, feedback),
        error ? h('p', { role: 'alert', 'data-pangea-assistant-discussion-error': true }, error) : null)
      return h('aside', { 'data-pangea-assistant-head': true, 'data-conversation-kind': kind || 'analysis', 'aria-label': 'AI 助手当前任务' },
        h('div', { 'data-pangea-assistant-title': true }, h('span', null, kind === 'assistant' ? '讨论当前分析' : 'AI 助手')),
        h('div', { 'data-pangea-assistant-card': true },
          h('span', { 'data-pangea-assistant-icon': true }, assistantGlyph()),
          h('span', { style: { minWidth: 0 } },
            h('span', { 'data-pangea-assistant-section-label': true }, '当前任务'),
            h('span', { 'data-pangea-assistant-name': true, style: { display: 'block' }, title: taskTitle }, taskTitle),
            context?.target ? h('span', { 'data-pangea-assistant-meta': true }, [context.repository, context.target].filter(Boolean).join(' · ')) : null)),
        context?.taskId ? h('section', { 'data-pangea-assistant-context': true, 'aria-label': '当前分析上下文' },
          h('div', { 'data-pangea-assistant-context-heading': true }, '当前上下文'),
          h('div', { 'data-pangea-assistant-context-row': true }, h('span', null, '运行'), h('strong', null, discussionContext.runId ? `RUN ${discussionContext.runId}` : '尚无 Run')),
          focus ? h('div', { 'data-pangea-assistant-context-row': true }, h('span', null, focus.kind === 'risk' ? '关注风险' : '关注用例'), h('strong', null, `${focus.id} · ${focus.title}`)) : null,
          relatedItems.length ? h('div', null,
            h('span', { 'data-pangea-assistant-section-label': true }, '关联内容'),
            h('div', { 'data-pangea-assistant-context-links': true }, relatedItems.map(item => h('button', {
              key: `${item.kind}:${item.id}`, type: 'button', onClick: () => context.onNavigateTo?.(item.kind, item.id),
            }, item.label)))) : null,
          sources.length ? h('div', null,
            h('span', { 'data-pangea-assistant-section-label': true }, '源码依据'),
            h('div', { 'data-pangea-assistant-context-links': true }, sources.map((item, index) => h('button', {
              key: `${item.location}:${index}`, type: 'button', onClick: () => context.onOpenSource?.(item.location), title: item.location,
            }, item.label)))) : null,
          kind === 'assistant' && analysisConversation ? h('button', {
            type: 'button', 'data-pangea-assistant-analysis-record': true, disabled: busy,
            onClick: () => runAction('select', analysisConversation.conversation_id),
          }, '查看分析记录') : null) : null,
        h('div', { 'data-pangea-assistant-conversations': true, 'aria-busy': busy },
          h('div', null,
            h('span', { 'data-pangea-assistant-section-label': true }, '当前会话'),
            h('div', { 'data-pangea-assistant-actions': true },
              h('select', {
                'data-pangea-assistant-select': true,
                'aria-label': '切换任务会话',
                disabled: busy || !conversations.length,
                value: context?.activeConversationId ?? '',
                onChange: event => runAction('select', event.target.value),
              }, conversations.length
                ? conversations.map(item => h('option', { key: item.conversation_id, value: item.conversation_id }, `${kindLabel(item)} · ${item.display_title || item.title}`))
                : h('option', { value: '' }, '尚未创建会话')),
              h('button', { type: 'button', 'data-pangea-assistant-new': true,
                disabled: busy || !context?.taskId,
                onClick: () => runAction('create'),
              }, lineIcon([
                h('path', { key: 'outline', d: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8A8.5 8.5 0 0 1 12.5 20a8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3H13' }),
                h('path', { key: 'horizontal', d: 'M17 3v8' }), h('path', { key: 'vertical', d: 'M13 7h8' }),
              ], 14), pendingType === 'create' ? '创建中…' : '新建讨论'))),
          context?.phase && kind !== 'assistant' ? h('div', { 'data-pangea-assistant-meta': true },
            `${chinesePhase(context.phase)}${kind === 'analysis' && percent !== undefined ? ` · ${percent}%` : ''}`) : null,
          h('p', { 'data-pangea-assistant-feedback': error ? 'error' : 'status', role: error ? 'alert' : 'status', 'aria-live': 'polite' },
            !busy && !error && kind === 'analysis'
              ? [h('strong', { key: 'heading' }, '本次分析记录为只读'), h('span', { key: 'description' }, '这里显示执行阶段的可见记录。继续提问时，新建讨论会话并带入当前上下文。')]
              : feedback)))
    }

    function shouldShowAssistantProcess(context) {
      return Boolean(context?.taskId) && (!context.activeConversationKind && !context.activeConversationId && !context.activeConversationSessionId
        || context.activeConversationKind === 'analysis'
        || context.activeConversationKind === 'architecture'
        || (!context.activeConversationKind && context.activeConversationSessionId === context.ownerSessionId))
    }

    function assistantSessionId(context) {
      if (!context?.taskId || !context.activeConversationSessionId) return null
      const conversation = context.conversations?.find(item => item.conversation_id === context.activeConversationId)
      if (!conversation || conversation.session_id !== context.activeConversationSessionId) return null
      // A retry can still list the previous analysis conversation before its
      // new owner session has been bound. Do not reopen that old attempt.
      if (conversation.kind === 'analysis' && context.attemptId && conversation.session_id !== context.ownerSessionId) return null
      return conversation.session_id
    }

    function setComposerReadonly(composer, readonly) {
      if (!composer) return
      if (readonly) composer.dataset.pangeaAnalysisReadonly = 'true'
      else delete composer.dataset.pangeaAnalysisReadonly
      for (const card of composer.querySelectorAll('[data-composer-card]')) {
        card.inert = readonly
        if (readonly) card.setAttribute('aria-disabled', 'true')
        else card.removeAttribute('aria-disabled')
      }
    }

    function setAssistantComposerPlaceholder(composer, active) {
      if (typeof composer?.querySelector !== 'function') return
      const input = composer?.querySelector('textarea.uV2eYG_input')
      if (!input) return
      if (active && !composer.dataset.pangeaModelGuard) {
        composer.dataset.pangeaModelGuard = 'true'
        composer.addEventListener('click', event => {
          if (!document.body.hasAttribute('data-pangea-task-assistant') || !composer.querySelector('.uV2eYG_primary')?.contains(event.target)) return
          if (!composer.querySelector('button[aria-label="Select model"]')) return
          event.preventDefault()
          event.stopImmediatePropagation()
          let status = composer.querySelector('.pangea-assistant-model-hint')
          if (!status) {
            status = document.createElement('p')
            status.className = 'pangea-assistant-model-hint'
            status.setAttribute('role', 'status')
            composer.appendChild(status)
          }
          status.textContent = '请先在设置中配置默认模型，再发送讨论消息。'
        }, true)
      }
      if (active) {
        if (!input.dataset.pangeaOriginalPlaceholder) input.dataset.pangeaOriginalPlaceholder = input.placeholder
        input.placeholder = '结合当前任务继续提问...'
        if (!composer.querySelector('button[aria-label="Select model"]')) composer.querySelector('.pangea-assistant-model-hint')?.remove()
      } else if (input.dataset.pangeaOriginalPlaceholder) {
        input.placeholder = input.dataset.pangeaOriginalPlaceholder
        delete input.dataset.pangeaOriginalPlaceholder
        composer.querySelector('.pangea-assistant-model-hint')?.remove()
      }
    }

    function setAnalysisProcessLayout(scroll, composer, active, sessionMatches = true, readonly = active) {
      if (scroll) {
        if (active) scroll.dataset.pangeaAnalysisProcess = 'true'
        else delete scroll.dataset.pangeaAnalysisProcess
        if (!sessionMatches) scroll.dataset.pangeaSessionMismatch = 'true'
        else delete scroll.dataset.pangeaSessionMismatch
      }
      setComposerReadonly(composer, readonly || !sessionMatches)
    }

    function AssistantProcess({ context }) {
      if (!shouldShowAssistantProcess(context)) return null
      const process = context.process ?? {}
      const lastActivity = process.last_activity_at ? new Date(process.last_activity_at).getTime() : NaN
      const activityAge = Number.isFinite(lastActivity) ? Math.max(0, Date.now() - lastActivity) : NaN
      const activityLabel = !Number.isFinite(activityAge) ? '' : activityAge < 60000
        ? `${Math.max(1, Math.round(activityAge / 1000))} 秒前`
        : activityAge < 3600000 ? `${Math.round(activityAge / 60000)} 分钟前`
          : activityAge < 86400000 ? `${Math.round(activityAge / 3600000)} 小时前`
            : new Date(lastActivity).toLocaleString('zh-CN')
      const events = Array.isArray(process.events) ? [...process.events].reverse() : []
      const output = typeof process.output === 'string' && process.output.trim() !== ''
        ? process.output
        : '等待 Agent 产生可显示的过程输出…'
      const status = process.status ?? 'preparing'
      const statusLabel = {
        preparing: '准备中', pending: '等待开始', finalizing: '保存结果', starting: '正在启动', queued: '排队中', running: context.activeConversationKind === 'architecture' ? '生成中' : '运行中', stopping: '正在停止',
        completed: '已完成', failed: '失败', killed: '已停止', stopped: '已停止', interrupted: '已中断',
      }[status] ?? chinesePhase(status)
      return h(React.Fragment, null,
        h('section', { 'data-pangea-assistant-process': true, 'aria-label': '当前 Run 分析过程' },
        h('div', { 'data-pangea-assistant-process-head': true },
          h('span', null, h('strong', null, context.activeConversationKind === 'architecture' ? '图表生成 · 执行记录' : '源码区域分析 · 执行记录'),
            context.runId ? h('small', { 'data-pangea-assistant-process-run': true }, `RUN ${String(context.runId).replace(/^run[-_ ]/i, '')}${context?.sourceFileCount ? ` · ${context.sourceFileCount} 个文件` : ''}${context?.sourceFrozen ? ' · 冻结源码' : ''}`) : null),
          h('span', { 'data-pangea-assistant-process-status': status }, statusLabel)),
        process.error ? h('div', { 'data-pangea-assistant-process-error': true, role: 'alert' }, process.error) : null,
        events.length ? h('ol', { 'data-pangea-assistant-process-events': true }, events.map((event, index) =>
          h('li', { key: `${event.at ?? index}:${event.stage ?? index}`, 'data-pangea-assistant-process-event': true },
            h('span', { 'data-pangea-assistant-process-dot': true, 'aria-hidden': true }),
            h('div', null,
              h('strong', null, event.label ?? chinesePhase(event.stage) ?? '运行事件'),
              event.summary ? h('div', { 'data-pangea-assistant-process-summary': true }, event.summary) : null,
              event.source ? h('code', null, event.source) : null,
              event.flowId && context.onNavigateTo ? h('button', { type: 'button', 'data-pangea-assistant-process-flow': true,
                onClick: () => context.onNavigateTo('flow', event.flowId) }, '查看对应流程 ↗') : null),
            event.at ? h('time', { dateTime: String(event.at) }, new Date(event.at).toLocaleTimeString('zh-CN', { hour12: false })) : null))) : null,
        h('details', { 'data-pangea-assistant-process-raw': true, open: !events.length },
          h('summary', null, '打开原始记录'),
          h('div', { 'data-pangea-assistant-process-output': true }, context.renderProcessOutput ? context.renderProcessOutput(output) : output))),
        h('footer', { 'data-pangea-assistant-process-footer': true },
          h('span', null, activityLabel ? `最近活动 · ${activityLabel}` : ''),
          h('button', { type: 'button', onClick: () => context.onOpenTab?.('workflow') }, '← 返回运行过程')))
    }

    function AssistantDiscussionLinks({ context }) {
      const focus = context?.discussionContext?.focus
      const relatedCase = context?.discussionContext?.relatedItems?.find(item => item.kind === 'case')
      const source = context?.discussionContext?.sources?.[0]
      return h('div', { 'data-pangea-assistant-reply-links': true },
        focus?.kind === 'risk' && context.onNavigateTo ? h('button', { type: 'button', onClick: () => context.onNavigateTo('risk', focus.id) }, '查看风险依据 ↗') : null,
        relatedCase && context.onNavigateTo ? h('button', { type: 'button', onClick: () => context.onNavigateTo('case', relatedCase.id) }, '打开关联用例 ↗') : null,
        source && context.onOpenSource && !relatedCase ? h('button', { type: 'button', onClick: () => context.onOpenSource(source.location) }, '查看源码依据 ↗') : null)
    }

    function AssistantPortals({ context, enabled, currentSessionId }) {
      const [hosts, setHosts] = React.useState(null)
      const hostsRef = React.useRef(null)
      const expectedSessionId = assistantSessionId(context)
      const sessionMatches = Boolean(expectedSessionId && expectedSessionId === currentSessionId)
      const analysisActive = shouldShowAssistantProcess(context)
      const processActive = analysisActive && context?.processMode === 'acp'
      const markDiscussionReplies = scroll => {
        if (!sessionMatches || context?.activeConversationKind !== 'assistant' || typeof scroll?.querySelectorAll !== 'function') return
        for (const step of scroll.querySelectorAll('.Md3f7G_flowItem[data-chat-flow-kind="assistant-step"]')) {
          if (step.querySelector('[data-pangea-assistant-reply-header]')) continue
          const header = document.createElement('div')
          header.dataset.pangeaAssistantReplyHeader = 'true'
          const icon = document.createElement('span')
          icon.dataset.pangeaAssistantReplyIcon = 'true'
          icon.setAttribute('aria-hidden', 'true')
          icon.textContent = '✧'
          const title = document.createElement('strong')
          title.textContent = 'PANGEA 助手'
          const badge = document.createElement('span')
          badge.dataset.pangeaAssistantReplyBadge = 'true'
          badge.textContent = '助手回复'
          header.append(icon, title, badge)
          step.insertBefore(header, step.firstChild)
        }
      }
      React.useLayoutEffect(() => {
        let disposed = false
        let observer
        const removeHosts = () => {
          const current = hostsRef.current
          if (current) {
            current.headerHost.remove()
            current.processHost.remove()
            current.linksHost?.remove()
            setAnalysisProcessLayout(current.scroll, current.composer, false)
            setAssistantComposerPlaceholder(current.composer, false)
            hostsRef.current = null
          }
          if (!disposed) setHosts(null)
        }
        if (!enabled || !context?.taskId) {
          removeHosts()
          return undefined
        }
        const root = document.querySelector('#root') || document.body
        const mount = () => {
          if (disposed) return
          const pane = root.querySelector('[data-pane="conversation"]')
          const scroll = pane?.querySelector('[data-conversation-scroll]')
          if (!pane || !scroll) return
          const composer = scroll.querySelector('[data-composer-seat]')
          const current = hostsRef.current
          if (current) {
            if (current.composer !== composer) {
              setComposerReadonly(current.composer, false)
              current.composer = composer
            }
            current.scroll = scroll
            markDiscussionReplies(scroll)
            const discussionStep = sessionMatches && context.activeConversationKind === 'assistant'
              ? [...scroll.querySelectorAll('.Md3f7G_flowItem[data-chat-flow-kind="assistant-step"]')].at(-1) : null
            if (current.linksStep !== discussionStep) {
              current.linksHost?.remove()
              current.linksHost = discussionStep ? document.createElement('div') : null
              current.linksStep = discussionStep
              if (current.linksHost) discussionStep.appendChild(current.linksHost)
              setHosts({ ...current })
            }
            setAnalysisProcessLayout(scroll, composer, processActive, sessionMatches, analysisActive && (context?.activeConversationKind !== 'architecture' || processActive))
            setAssistantComposerPlaceholder(composer, sessionMatches && context.activeConversationKind === 'assistant')
            return
          }
          const headerHost = document.createElement('div')
          headerHost.dataset.pangeaAssistantPortal = 'header'
          const processHost = document.createElement('div')
          processHost.dataset.pangeaAssistantPortal = 'process'
          pane.insertBefore(headerHost, pane.firstChild)
          scroll.insertBefore(processHost, composer || null)
          markDiscussionReplies(scroll)
          setAnalysisProcessLayout(scroll, composer, processActive, sessionMatches, analysisActive && (context?.activeConversationKind !== 'architecture' || processActive))
          setAssistantComposerPlaceholder(composer, sessionMatches && context.activeConversationKind === 'assistant')
          hostsRef.current = { headerHost, processHost, scroll, composer, linksHost: null, linksStep: null }
          setHosts(hostsRef.current)
        }
        observer = new MutationObserver(() => {
          const current = hostsRef.current
          if (current && (!current.headerHost.isConnected || !current.processHost.isConnected)) removeHosts()
          mount()
        })
        observer.observe(root, { childList: true, subtree: true })
        mount()
        return () => {
          disposed = true
          observer?.disconnect()
          removeHosts()
        }
      }, [analysisActive, context?.activeConversationKind, context?.activeConversationSessionId, context?.ownerSessionId, context?.processMode, context?.taskId, enabled, processActive, sessionMatches])
      if (!hosts || !ReactDOM?.createPortal) return null
      return h(React.Fragment, null,
        ReactDOM.createPortal(h(AssistantHeader, { context }), hosts.headerHost),
        hosts.linksHost ? ReactDOM.createPortal(h(AssistantDiscussionLinks, { context }), hosts.linksHost) : null,
        ReactDOM.createPortal(processActive && sessionMatches
          ? h(AssistantProcess, { context })
          : !sessionMatches ? h('p', { role: 'status' }, '正在切换任务会话…') : null, hosts.processHost))
    }

    function setProductBodyAttribute(name, value, owner) {
      if (value !== null) {
        productBodyAttributeOwners.set(name, owner)
        document.body.setAttribute(name, value)
      } else if (productBodyAttributeOwners.get(name) === owner) {
        productBodyAttributeOwners.delete(name)
        document.body.removeAttribute(name)
      }
    }

    function ProductShell({ service, betterSidebar, sessions, workspaces, page, scope, tab, visible, tabProps, children }) {
      const bodyAttributeOwner = React.useRef({}).current
      const snapshot = React.useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot)
      const selectedTaskId = React.useSyncExternalStore(service.subscribeTaskSelection, service.getSelectedTaskId, service.getSelectedTaskId)
      const workspaceList = React.useSyncExternalStore(
        React.useCallback(listener => workspaces?.list?.subscribe(listener) ?? (() => {}), [workspaces]),
        React.useCallback(() => workspaces?.list?.getSnapshot() ?? null, [workspaces]),
      )
      const sessionList = React.useSyncExternalStore(
        React.useCallback(listener => sessions?.list?.subscribe(listener) ?? (() => {}), [sessions]),
        React.useCallback(() => sessions?.list?.getSnapshot() ?? null, [sessions]),
      )
      const sidebarSnapshot = React.useSyncExternalStore(
        betterSidebar.subscribeState,
        betterSidebar.getSnapshot,
        betterSidebar.getSnapshot,
      )
      const productStateKey = scope?.cwd ?? scope?.sessionId ?? '__default__'
      const initialProductState = productStateByWorkspace.get(productStateKey) ?? DEFAULT_PRODUCT_STATE
      const [systemState, setSystemState] = React.useState(initialProductState.systemState)
      const [cachedAssistantContext, setAssistantContext] = React.useState(initialProductState.assistantContext)
      const assistantContext = cachedAssistantContext
        && (!selectedTaskId || cachedAssistantContext.taskId === selectedTaskId)
        && (!scope?.cwd || cachedAssistantContext.workspaceKey === scope.cwd)
        ? cachedAssistantContext : null
      const [assistantOpen, setAssistantOpen] = React.useState(false)
      const [terminalCollapsed, setTerminalCollapsed] = React.useState(false)
      const [fileUtilitySelection, setFileUtilitySelection] = React.useState(null)
      const sidebarState = sidebarSnapshot?.state
      const fileUtilityTabs = sidebarState && tab?.id
        ? [...allTabs(sidebarState.splits), ...allTabs(sidebarState.bottomSplits)].filter(item =>
          item.type === 'editor' && item.meta?.pangeaUtilityParent === tab.id)
        : []
      const fileUtilityTabIds = fileUtilityTabs.map(item => item.id).join('|')
      const previousFileUtilityTabIds = React.useRef('')
      React.useEffect(() => {
        const previous = previousFileUtilityTabIds.current.split('|')
        const added = fileUtilityTabs.find(item => !previous.includes(item.id))
        if (added) setFileUtilitySelection(added.id)
        previousFileUtilityTabIds.current = fileUtilityTabIds
      }, [fileUtilityTabIds])
      const productVisible = visible
        || tabIsActive(sidebarState?.splits, tab?.id)
        || tabIsActive(sidebarState?.bottomSplits, tab?.id)
      React.useEffect(() => {
        if (!productVisible) return undefined
        setProductBodyAttribute('data-pangea-product-shell', page.id, bodyAttributeOwner)
        return () => setProductBodyAttribute('data-pangea-product-shell', null, bodyAttributeOwner)
      }, [page.id, productVisible])
      React.useEffect(() => {
        const showAssistant = assistantOpen && productVisible && page.id === 'analysis' && Boolean(assistantContext?.taskId)
        setProductBodyAttribute('data-pangea-task-assistant', showAssistant ? assistantContext.taskId : null, bodyAttributeOwner)
        return () => setProductBodyAttribute('data-pangea-task-assistant', null, bodyAttributeOwner)
      }, [assistantContext?.taskId, assistantOpen, page.id, productVisible])
      React.useEffect(() => {
        const showNarrowAssistant = assistantOpen && productVisible && page.id === 'analysis' && Boolean(assistantContext?.taskId)
        setProductBodyAttribute('data-pangea-task-assistant-open', showNarrowAssistant ? assistantContext.taskId : null, bodyAttributeOwner)
        return () => setProductBodyAttribute('data-pangea-task-assistant-open', null, bodyAttributeOwner)
      }, [assistantContext?.taskId, assistantOpen, page.id, productVisible])
      React.useEffect(() => { setAssistantOpen(false) }, [assistantContext?.taskId])
      React.useEffect(() => {
        const open = () => setAssistantOpen(true)
        window.addEventListener('pangea:open-assistant', open)
        return () => window.removeEventListener('pangea:open-assistant', open)
      }, [])
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
      const pageCovered = utility === 'editor' || utility === 'browser'
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
        settings: { label: '设置', icon: 'settings' },
      }
      const utilityLabels = { editor: '文件', terminal: '终端', browser: '浏览器' }
      const renderUtility = type => {
        const descriptor = betterSidebar.getTab(type)
        if (!descriptor || !tabProps?.store) {
          if (type === 'terminal') return h('div', { 'data-pangea-utility-host': true, 'data-utility': type, 'data-tool-unavailable': true },
            h('div', { 'data-pangea-utility-head': true }, h('div', { 'data-pangea-utility-title': true }, utilityLabels[type], h('span', { 'data-pangea-utility-workspace': true }, utilityWorkspaceLabel(scope, workspaceList))), h('span', { 'data-pangea-utility-spacer': true }), h('button', { type: 'button', 'data-pangea-utility-close': true, 'aria-label': '关闭终端', onClick: closeUtility }, '×')),
            h('div', { 'data-pangea-utility-body': true, 'data-pangea-tool-unavailable': true },
              h('span', { 'data-pangea-tool-unavailable-icon': true, 'aria-hidden': true }, lineIcon([h('path', { key: 'a', d: 'm4 16 3-3m7-7 3-3m-5 8 3 3m-1-8 3 3m-3 5-3 3m-4-4-3-3' }), h('path', { key: 'b', d: 'M9 6 6 9a4 4 0 0 0 0 6l3 3a4 4 0 0 0 6 0l3-3' })], 30, 1.6)),
              h('h2', null, '当前工具不可用'),
              h('p', null, '组件暂未加载。关闭面板后可以继续使用工作台。'),
              h('button', { type: 'button', onClick: closeUtility }, '←', '返回工作台')))
          if (type === 'browser') return h('div', { 'data-pangea-utility-host': true, 'data-utility': type, 'data-tool-unavailable': true },
            h('div', { 'data-pangea-utility-head': true }, h('div', { 'data-pangea-utility-title': true }, utilityLabels[type], h('span', { 'data-pangea-utility-workspace': true }, utilityWorkspaceLabel(scope, workspaceList))), h('span', { 'data-pangea-utility-spacer': true }), h('button', { type: 'button', 'data-pangea-utility-close': true, 'aria-label': '关闭浏览器', onClick: closeUtility }, '×')),
            h('div', { 'data-pangea-utility-body': true, 'data-pangea-tool-unavailable': true },
              h('span', { 'data-pangea-tool-unavailable-icon': true, 'aria-hidden': true }, lineIcon([h('path', { key: 'a', d: 'm4 16 3-3m7-7 3-3m-5 8 3 3m-1-8 3 3m-3 5-3 3m-4-4-3-3' }), h('path', { key: 'b', d: 'M9 6 6 9a4 4 0 0 0 0 6l3 3a4 4 0 0 0 6 0l3-3' })], 30, 1.6)),
              h('h2', null, '当前工具不可用'),
              h('p', null, '组件暂未加载。关闭面板后可以继续使用工作台。'),
              h('button', { type: 'button', onClick: closeUtility }, '←', '返回工作台')))
          return h('div', { 'data-pangea-utility-host': true, 'data-utility': type, 'data-tool-unavailable': true },
            h('div', { 'data-pangea-utility-head': true }, h('div', { 'data-pangea-utility-title': true }, utilityLabels[type], type === 'editor' ? h('span', { 'data-pangea-utility-workspace': true }, utilityWorkspaceLabel(scope, workspaceList)) : null), h('span', { 'data-pangea-utility-spacer': true }), h('button', { type: 'button', 'data-pangea-utility-close': true, 'aria-label': `关闭${utilityLabels[type]}`, onClick: closeUtility }, '×')),
            h('div', { 'data-pangea-utility-body': true, 'data-pangea-tool-unavailable': true },
              h('span', { 'data-pangea-tool-unavailable-icon': true, 'aria-hidden': true }, lineIcon([h('path', { key: 'a', d: 'm4 16 3-3m7-7 3-3m-5 8 3 3m-1-8 3 3m-3 5-3 3m-4-4-3-3' }), h('path', { key: 'b', d: 'M9 6 6 9a4 4 0 0 0 0 6l3 3a4 4 0 0 0 6 0l3-3' })], 30, 1.6)),
              h('h2', null, '当前工具不可用'),
              h('p', null, '组件暂未加载。关闭面板后可以继续使用工作台。'),
              h('button', { type: 'button', onClick: closeUtility }, '←', '返回工作台')))
        }
        const toolTab = { ...tab, type, title: utilityLabels[type] }
        const editorContent = () => {
          const normalTabs = [toolTab, ...fileUtilityTabs.filter(item => item.meta?.pangeaUtilitySide !== true)]
          const sideTabs = fileUtilityTabs.filter(item => item.meta?.pangeaUtilitySide === true)
          const selected = normalTabs.find(item => item.id === fileUtilitySelection) ?? normalTabs.at(-1)
          const editor = item => h(descriptor.component, {
            ...tabProps, expanded: sidebarState?.expanded ?? tabProps.expanded,
            onToggleDir: path => tabProps.store.reduce(state => ({
              ...state, expanded: state.expanded.includes(path)
                ? state.expanded.filter(item => item !== path) : [...state.expanded, path],
            })),
            key: item.id, store: mergedEditorStore, tab: item, visible: productVisible,
          })
          return h('div', { 'data-pangea-file-layout': true },
            normalTabs.length > 1 ? h('div', { 'data-pangea-file-tabs': true }, normalTabs.map(item => h('button', {
              key: item.id, type: 'button', 'data-active': selected.id === item.id,
              onClick: () => setFileUtilitySelection(item.id),
            }, item.path?.split(/[\\/]/).pop() ?? '文件'))) : null,
            h('div', { 'data-pangea-file-panels': true },
              ...normalTabs.map(item => h('div', { key: item.id, 'data-pangea-file-pane': item.id, 'data-hidden': selected.id !== item.id }, editor(item))),
              ...sideTabs.map(item => h('div', { key: item.id, 'data-pangea-file-pane': item.id, 'data-side': true },
                h('div', { 'data-pangea-file-side-head': true }, item.path?.split(/[\\/]/).pop() ?? '文件',
                  h('button', { type: 'button', 'aria-label': '关闭侧边文件', onClick: () => betterSidebar.closeTab(item.id, { sessionId: scope?.sessionId }) }, '×')),
                editor(item)))))
        }
        return h('div', { 'data-pangea-utility-host': true, 'data-utility': type },
          h('div', { 'data-pangea-utility-head': true },
            h('div', { 'data-pangea-utility-title': true }, utilityLabels[type], h('span', { 'data-pangea-utility-workspace': true }, utilityWorkspaceLabel(scope, workspaceList))),
            h('span', { 'data-pangea-utility-spacer': true }),
            type === 'terminal' ? h('button', { type: 'button', 'data-pangea-terminal-fold': true, 'aria-expanded': !terminalCollapsed, onClick: () => setTerminalCollapsed(value => !value) }, terminalCollapsed ? '⌃ 展开' : '⌄ 折叠') : null,
            h('button', { type: 'button', 'data-pangea-utility-close': true, 'aria-label': `关闭${utilityLabels[type]}`, onClick: closeUtility }, '×')),
          h('div', { 'data-pangea-utility-body': true }, type === 'editor'
            ? editorContent()
            : h(descriptor.component, { ...tabProps, store: tabProps.store, tab: toolTab, visible: productVisible })))
      }
      return h('div', { 'data-pangea-shell': true },
        h(ProductHeader, {
          scope, workspaceList, systemState,
          assistantVisible: assistantOpen && page.id === 'analysis' && Boolean(assistantContext?.taskId),
          assistantOpen,
          onToggleAssistant: () => setAssistantOpen(value => !value),
        }),
        h(AssistantPortals, { context: assistantContext && {
          ...assistantContext, onOpenTab: type => { setAssistantOpen(false); assistantContext.onOpenTab?.(type) },
          onNavigateTo: (type, id) => { setAssistantOpen(false); assistantContext.onNavigateTo?.(type, id) },
        }, enabled: productVisible && page.id === 'analysis', currentSessionId: sessionList?.current }),
        assistantOpen && page.id === 'analysis' && assistantContext?.taskId
          ? h(AssistantPageHeader, { context: assistantContext, onClose: () => setAssistantOpen(false) }) : null,
        h('aside', { 'data-pangea-product-nav': true, 'aria-label': 'PANGEA 产品导航' },
          h('div', { 'data-pangea-nav-heading': true, 'aria-hidden': true }, 'WORKSPACE'),
          h('nav', { 'data-pangea-nav-list': true, 'aria-label': '工作空间' }, snapshot.pages.filter(item => item.id !== 'settings' && showProductPageInNavigation(item, scope)).map(item => {
            const label = pageMeta[item.id]?.label ?? (typeof item.title === 'function' ? item.title() : item.title)
            const active = item.id === page.id && !pageCovered
            return h('button', {
              key: item.id, type: 'button', 'data-pangea-nav-button': true, 'data-active': active ? 'true' : 'false',
              'aria-label': label, title: label, 'aria-current': active ? 'page' : undefined,
              onClick: () => service.openPage(scope, item.id),
            }, h('span', { 'data-pangea-nav-icon': true }, productIcon(pageMeta[item.id]?.icon ?? item.id, 23)),
            h('span', { 'data-pangea-nav-label': true }, label))
          })),
          h('div', { 'data-pangea-nav-divider': true }),
          h('nav', { 'data-pangea-tool-list': true, 'aria-label': '工具与设置' },
            h('div', { 'data-pangea-nav-heading': true, 'aria-hidden': true }, '工具'),
            ...[
              { type: 'editor', label: '文件', icon: 'file' },
              { type: 'terminal', label: '终端', icon: 'terminal' },
              { type: 'browser', label: '浏览器', icon: 'browser' },
            ].map(item => h('button', {
              key: item.type, type: 'button', 'data-pangea-tool-button': true,
              'data-active': utility === item.type ? 'true' : 'false', 'aria-pressed': utility === item.type,
              'aria-label': item.label, title: item.label,
              onClick: () => utility === item.type ? closeUtility() : openUtility(item.type, item.label),
            }, utilityIcon(item.icon), h('span', { 'data-pangea-nav-label': true }, item.label))),
            h('button', { type: 'button', 'data-pangea-tool-button': true, 'data-pangea-native-model-settings': true, 'data-active': page.id === 'settings' && !pageCovered ? 'true' : 'false', 'aria-current': page.id === 'settings' && !pageCovered ? 'page' : undefined, 'aria-label': '设置', title: '设置', onClick: () => service.openPage(scope, 'settings') }, utilityIcon('settings'), h('span', { 'data-pangea-nav-label': true }, '设置'))),
          globalThis.dshDesktop ? h('div', { 'data-pangea-local-label': true }, h('span', { 'aria-hidden': true }), '本地工作空间') : null),
        h('main', { 'data-pangea-page': page.id, 'data-pangea-terminal-open': utility === 'terminal' ? true : undefined, 'data-pangea-terminal-collapsed': utility === 'terminal' && terminalCollapsed ? true : undefined },
          h('div', { 'data-pangea-product-content': true, style: { display: pageCovered ? 'none' : undefined } }, React.cloneElement(children, { visible: productVisible })),
          utility === 'editor' || utility === 'browser' ? h('div', { style: { position: 'absolute', inset: 0, zIndex: 10, display: 'flex' } }, renderUtility(utility)) : null,
          utility === 'terminal' ? h('div', { 'data-pangea-terminal-dock': true, 'data-collapsed': terminalCollapsed ? true : undefined }, ...renderUtility('terminal').props.children) : null))
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

    function showProductPageInNavigation(page, scope) {
      return ['workbench', 'analysis', 'assets'].includes(page?.id) || pageIsAvailable(page, scope)
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

    function createPangeaService(betterSidebar, sessions, workspaces) {
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
      let runDraft = Object.freeze({ revision: 0, requestId: 0, intent: 'create', runId: null, assetIds: Object.freeze([]) })
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

      function registerProductSession(sessionId, pageId) {
        if (typeof sessionId !== 'string' || sessionId.trim() === '') return false
        productSessions.add(sessionId)
        if (pages.has(pageId)) lastPageBySession.set(sessionId, pageId)
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
            service: publicService, betterSidebar, sessions, workspaces, page, scope: props.scope, tab: props.tab, visible: props.visible,
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
        const current = betterSidebar.getSnapshot?.()
        const state = !scope?.sessionId || current?.sessionId === scope.sessionId ? current?.state : undefined
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
        updateRunDraft({ ...patch, intent: 'create', runId: null, requestId: runDraft.requestId + 1 })
        return openPage(scope, 'analysis')
      }

      function requestRunSelection(scope, runId) {
        const value = typeof runId === 'string' ? runId.trim() : ''
        if (!value) return false
        updateRunDraft({ intent: 'select-run', runId: value, requestId: runDraft.requestId + 1 })
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
        requestRunSelection,
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
      const service = createPangeaService(betterSidebar, ctx.sessions, ctx.workspaces)
      ctx.effect(() => service.registerPage({ id: 'settings', title: '设置', order: 1000, component: props => h(SettingsPage, { ...props, service }) }), 'dsh-pangea: product settings page')
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
    exports.setComposerReadonly = setComposerReadonly
    exports.setAnalysisProcessLayout = setAnalysisProcessLayout
    exports.shouldShowAssistantProcess = shouldShowAssistantProcess
    exports.assistantSessionId = assistantSessionId
    exports.AssistantHeader = AssistantHeader
    exports.AssistantProcess = AssistantProcess
    exports.apply = apply
    return module.exports
  },
})
