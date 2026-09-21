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
          display: grid; grid-template-rows: minmax(0, 1fr) min(42%, 365px);
        }
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
        [data-pangea-utility-spacer] { flex: 1; }
        [data-pangea-utility-close] {
          width: 31px; height: 31px; display: grid; place-items: center; border: 1px solid #d9dde3;
          border-radius: 5px; color: #555d68; background: #fff; cursor: pointer;
        }
        [data-pangea-utility-body] { min-width: 0; min-height: 0; overflow: hidden; background: #fff; }
        [data-pangea-utility-body] > * { width: 100%; height: 100%; min-width: 0; min-height: 0; }
        [data-pangea-terminal-dock] {
          box-sizing: border-box; min-width: 0; min-height: 0; overflow: hidden;
          display: grid; grid-template-rows: 46px minmax(0, 1fr);
          border-top: 3px solid var(--pangea-red); color: #e4e7eb; background: #171a1f;
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
          [data-pangea-assistant-process-status] { color: #68707c; font-size: 16px; }
          [data-pangea-assistant-process-status="failed"], [data-pangea-assistant-process-status="interrupted"] { color: var(--pangea-red); }
          [data-pangea-assistant-process-error] { flex: none; margin-top: 8px; color: var(--pangea-red); font-size: 16px; line-height: 26px; overflow-wrap: anywhere; }
          [data-pangea-assistant-process-output] { flex: 1; min-height: 48px; overflow: auto; margin: 8px 0 0; padding: 12px; border: 1px solid #e1e4e8; border-radius: 7px; color: #34383f; background: #fff; font: 15px/1.7 "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei UI", sans-serif; overflow-wrap: anywhere; }
          [data-pangea-assistant-process-output] > div > :first-child { margin-top: 0; }
          [data-pangea-assistant-process-output] pre { padding: 8px; border-radius: 5px; background: #f5f6f8; white-space: pre-wrap; }
          [data-pangea-assistant-process-events] { flex: none; max-height: 150px; overflow: auto; margin-top: 8px; color: #68707c; font-size: 16px; line-height: 26px; }
          [data-pangea-assistant-process-events] summary { cursor: pointer; color: #4d5560; }
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

        body.dsh-desktop-windows-titlebar-layout [data-pangea-topbar] {
          padding-right: calc(var(--dsh-desktop-windows-caption-width, 140px) + 16px);
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

    function ProductHeader({ scope, systemState, assistantVisible, assistantOpen, onToggleAssistant }) {
      return h('header', { 'data-pangea-topbar': true },
        h('div', { 'data-pangea-topbar-brand': true }, h(HuaweiLogo)),
        h('div', { 'data-pangea-topbar-title': true }, 'PANGEA', h('span', { 'data-pangea-topbar-subtitle': true }, '\u00a0测试工作台')),
        h('div', { 'data-pangea-project': true, title: scope?.cwd ?? '', 'aria-label': `当前项目：${workspaceLabel(scope)}` },
          h('span', null, workspaceLabel(scope))),
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
      if (status.phase === 'downloaded') {
        const packageLabel = status.packageType === 'patch' ? '增量补丁' : '完整升级包'
        const route = status.baseVersion && status.availableVersion
          ? `${status.baseVersion} → ${status.availableVersion}`
          : status.availableVersion ?? ''
        return `${packageLabel}${route ? ` ${route}` : ''} 已验证，可以安装。`
      }
      if (status.phase === 'install-error') return status.message ?? '升级未完成，当前版本已保留。'
      if (status.phase === 'error') return status.message ?? '升级包校验失败。'
      if (status.phase === 'unsupported') return status.message ?? '当前环境不支持应用内升级。'
      return '当前没有待安装的升级包。'
    }

    function SettingsPage() {
      const bridge = globalThis.dshDesktop
      const updateAvailable = typeof bridge?.getUpdateStatus === 'function'
        && typeof bridge?.importUpdatePackage === 'function'
        && typeof bridge?.installUpdate === 'function'
      const [updateStatus, setUpdateStatus] = React.useState(null)
      const [busyAction, setBusyAction] = React.useState(null)
      const [actionError, setActionError] = React.useState('')

      React.useEffect(() => {
        if (!updateAvailable) return undefined
        let active = true
        void bridge.getUpdateStatus()
          .then(status => { if (active) setUpdateStatus(status) })
          .catch(error => { if (active) setActionError(error instanceof Error ? error.message : String(error)) })
        const subscriptionId = typeof bridge.subscribeUpdateStatus === 'function'
          ? bridge.subscribeUpdateStatus(status => { if (active) setUpdateStatus(status) })
          : undefined
        return () => {
          active = false
          if (typeof subscriptionId === 'number') bridge.unsubscribeUpdateStatus?.(subscriptionId)
        }
      }, [bridge, updateAvailable])

      const openModels = () => window.dispatchEvent(new CustomEvent('pangea:open-model-settings', { detail: { mode: 'internal' } }))
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
        setActionError('')
        try {
          await bridge.installUpdate()
          const status = await bridge.getUpdateStatus()
          if (status) setUpdateStatus(status)
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        } finally {
          setBusyAction(null)
        }
      }
      const updateError = actionError
        || (['error', 'install-error', 'unsupported'].includes(updateStatus?.phase) ? updateStatus?.message : '')

      return h('section', { 'data-pangea-settings-page': true },
        h('header', { 'data-pangea-settings-head': true },
          h('h1', { 'data-pangea-settings-title': true }, '设置'),
          h('p', { 'data-pangea-settings-intro': true }, '管理 PANGEA Desktop 的模型接入、版本与本地升级。')),
        h('div', { 'data-pangea-settings-grid': true },
          h('article', { 'data-pangea-settings-card': true },
            h('div', null,
              h('h2', { 'data-pangea-settings-card-title': true }, '模型与 API'),
              h('p', { 'data-pangea-settings-card-description': true }, '配置 DSH 对话使用的模型提供方及 API 凭据。外部 Agent 的可用模型可在“新建分析”中直接选择。')),
            h('div', { 'data-pangea-settings-actions': true },
              h('button', { type: 'button', 'data-pangea-settings-action': true, onClick: openModels }, '打开模型设置'))),
          h('article', { 'data-pangea-settings-card': true },
            h('div', null,
              h('h2', { 'data-pangea-settings-card-title': true }, '版本与升级'),
              h('p', { 'data-pangea-settings-card-description': true }, updateAvailable
                ? updateStatusCopy(updateStatus)
                : '应用内升级仅在已打包的 Windows PANGEA Desktop 中可用。'),
              updateStatus?.currentVersion ? h('div', { 'data-pangea-update-meta': true },
                h('span', null, `当前版本：${updateStatus.currentVersion}`),
                updateStatus.availableVersion ? h('span', null, `目标版本：${updateStatus.availableVersion}`) : null) : null,
              updateError ? h('p', { 'data-pangea-update-error': true, role: 'alert' }, updateError) : null),
            h('div', { 'data-pangea-settings-actions': true },
              h('button', {
                type: 'button', 'data-pangea-settings-action': true,
                disabled: !updateAvailable || Boolean(busyAction), onClick: importPackage,
              }, busyAction === 'import' ? '正在读取…' : '导入升级包'),
              updateStatus?.phase === 'downloaded' ? h('button', {
                type: 'button', 'data-pangea-settings-action': 'primary',
                disabled: Boolean(busyAction), onClick: installPackage,
              }, busyAction === 'install' ? '正在重启…' : '安装并重启') : null))),
        h('p', { 'data-pangea-settings-note': true }, '支持签名完整 ZIP 和与当前版本严格匹配的增量补丁 ZIP；请选择原始压缩包，不要提前解压。'))
    }

    function chinesePhase(value) {
      return { PREPARING: '准备中', PLANNING: '规划中', ANALYZING: '分析中', REVIEWING: '检查分析结果', REVIEW: '检查分析结果', INDEPENDENT_REVIEW: '独立检查', COMPARISON_REVIEW: '对照检查', TARGETED_CLOSURE: '完善结果', COMPLETED: '已完成', COMPLETE: '已完成', FAILED: '需要处理', STOPPED: '已停止', INTERRUPTED: '已中断', PENDING: '等待开始', QUEUED: '等待处理', RUNNING: '运行中', FINALIZING: '保存结果' }[String(value ?? '').toUpperCase()] ?? value
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
      const pendingType = context?.conversationPending || (pending?.taskId === context?.taskId ? pending?.type : '')
      const busy = Boolean(pendingType)
      const error = !busy && failure?.taskId === context?.taskId ? failure.message : ''
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
      return h('aside', { 'data-pangea-assistant-head': true, 'aria-label': 'AI 助手当前任务' },
        h('div', { 'data-pangea-assistant-title': true }, h('span', null, 'AI 助手')),
        h('div', { 'data-pangea-assistant-card': true },
          h('span', { 'data-pangea-assistant-icon': true }, assistantGlyph()),
          h('span', { style: { minWidth: 0 } },
            h('span', { 'data-pangea-assistant-section-label': true }, '当前任务'),
            h('span', { 'data-pangea-assistant-name': true, style: { display: 'block' }, title: taskTitle }, taskTitle))),
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
              }, pendingType === 'create' ? '创建中…' : '新建讨论'))),
          context?.phase && kind !== 'assistant' ? h('div', { 'data-pangea-assistant-meta': true },
            `${chinesePhase(context.phase)}${kind === 'analysis' && percent !== undefined ? ` · ${percent}%` : ''}`) : null,
          h('p', { 'data-pangea-assistant-feedback': error ? 'error' : 'status', role: error ? 'alert' : 'status', 'aria-live': 'polite' }, feedback)))
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
      const output = typeof process.output === 'string' && process.output.trim() !== ''
        ? process.output.slice(-12000)
        : '等待 Agent 产生可显示的过程输出…'
      const status = process.status ?? 'preparing'
      const statusLabel = {
        preparing: '准备中', pending: '等待开始', finalizing: '保存结果', starting: '正在启动', queued: '排队中', running: context.activeConversationKind === 'architecture' ? '生成中' : '分析中', stopping: '正在停止',
        completed: '已完成', failed: '失败', killed: '已停止', stopped: '已停止', interrupted: '已中断',
      }[status] ?? chinesePhase(status)
      return h('section', { 'data-pangea-assistant-process': true, 'aria-label': '当前 Run 分析过程' },
        h('div', { 'data-pangea-assistant-process-head': true },
          h('strong', null, context.activeConversationKind === 'architecture' ? '画图过程' : '分析过程'), h('span', { 'data-pangea-assistant-process-status': status }, statusLabel)),
        process.last_activity_at ? h('div', { title: process.last_activity_at }, `最近活动：${new Date(process.last_activity_at).toLocaleTimeString('zh-CN', { hour12: false })}`) : null,
        h('div', { 'data-pangea-assistant-process-mode': true }, context.activeConversationKind === 'architecture' ? '画图过程只读；展开“修改或生成新版本”，填写要求后选择“生成修改版”。' : '分析过程只读；需要交流时请切换或新建讨论会话。'),
        process.error ? h('div', { 'data-pangea-assistant-process-error': true, role: 'alert' }, process.error) : null,
        h('div', { 'data-pangea-assistant-process-output': true }, context.renderProcessOutput ? context.renderProcessOutput(output) : output),
        Array.isArray(process.events) && process.events.length
          ? h('details', { 'data-pangea-assistant-process-events': true },
            h('summary', null, `运行记录 · ${process.events.length} 条`),
            process.events.map((event, index) => h('div', { key: `${event.at ?? index}:${event.stage ?? index}` }, event.label ?? chinesePhase(event.stage) ?? '事件')))
          : null)
    }

    function AssistantPortals({ context, enabled, currentSessionId }) {
      const [hosts, setHosts] = React.useState(null)
      const hostsRef = React.useRef(null)
      const expectedSessionId = assistantSessionId(context)
      const sessionMatches = Boolean(expectedSessionId && expectedSessionId === currentSessionId)
      const analysisActive = shouldShowAssistantProcess(context)
      const processActive = analysisActive && context?.processMode === 'acp'
      React.useLayoutEffect(() => {
        let disposed = false
        let observer
        const removeHosts = () => {
          const current = hostsRef.current
          if (current) {
            current.headerHost.remove()
            current.processHost.remove()
            setAnalysisProcessLayout(current.scroll, current.composer, false)
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
            setAnalysisProcessLayout(scroll, composer, processActive, sessionMatches, analysisActive && (context?.activeConversationKind !== 'architecture' || processActive))
            return
          }
          const headerHost = document.createElement('div')
          headerHost.dataset.pangeaAssistantPortal = 'header'
          const processHost = document.createElement('div')
          processHost.dataset.pangeaAssistantPortal = 'process'
          pane.insertBefore(headerHost, pane.firstChild)
          scroll.insertBefore(processHost, composer || null)
          setAnalysisProcessLayout(scroll, composer, processActive, sessionMatches, analysisActive && (context?.activeConversationKind !== 'architecture' || processActive))
          hostsRef.current = { headerHost, processHost, scroll, composer }
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
        ReactDOM.createPortal(processActive
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

    function ProductShell({ service, betterSidebar, sessions, page, scope, tab, visible, tabProps, children }) {
      const bodyAttributeOwner = React.useRef({}).current
      const snapshot = React.useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot)
      const selectedTaskId = React.useSyncExternalStore(service.subscribeTaskSelection, service.getSelectedTaskId, service.getSelectedTaskId)
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
      const sidebarState = sidebarSnapshot?.state
      const productVisible = visible
        || tabIsActive(sidebarState?.splits, tab?.id)
        || tabIsActive(sidebarState?.bottomSplits, tab?.id)
      React.useEffect(() => {
        if (!productVisible) return undefined
        setProductBodyAttribute('data-pangea-product-shell', page.id, bodyAttributeOwner)
        return () => setProductBodyAttribute('data-pangea-product-shell', null, bodyAttributeOwner)
      }, [page.id, productVisible])
      React.useEffect(() => {
        const showAssistant = productVisible && page.id === 'analysis' && Boolean(assistantContext?.taskId)
        setProductBodyAttribute('data-pangea-task-assistant', showAssistant ? assistantContext.taskId : null, bodyAttributeOwner)
        return () => setProductBodyAttribute('data-pangea-task-assistant', null, bodyAttributeOwner)
      }, [assistantContext?.taskId, page.id, productVisible])
      React.useEffect(() => {
        const showNarrowAssistant = assistantOpen && productVisible && page.id === 'analysis' && Boolean(assistantContext?.taskId)
        setProductBodyAttribute('data-pangea-task-assistant-open', showNarrowAssistant ? assistantContext.taskId : null, bodyAttributeOwner)
        return () => setProductBodyAttribute('data-pangea-task-assistant-open', null, bodyAttributeOwner)
      }, [assistantContext?.taskId, assistantOpen, page.id, productVisible])
      React.useEffect(() => { setAssistantOpen(false) }, [assistantContext?.taskId])
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
      const utilityLabels = { editor: '文件工作区', terminal: '环境终端', browser: '内置浏览器' }
      const renderUtility = type => {
        const descriptor = betterSidebar.getTab(type)
        if (!descriptor || !tabProps?.store) {
          return h('div', { 'data-pangea-utility-host': true },
            h('div', { 'data-pangea-utility-head': true }, h('div', { 'data-pangea-utility-title': true }, utilityLabels[type]), h('span', { 'data-pangea-utility-spacer': true }), h('button', { type: 'button', 'data-pangea-utility-close': true, 'aria-label': `关闭${utilityLabels[type]}`, onClick: closeUtility }, '×')),
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
        h(ProductHeader, {
          scope, systemState,
          assistantVisible: page.id === 'analysis' && Boolean(assistantContext?.taskId),
          assistantOpen,
          onToggleAssistant: () => setAssistantOpen(value => !value),
        }),
        h(AssistantPortals, { context: assistantContext, enabled: productVisible && page.id === 'analysis', currentSessionId: sessionList?.current }),
        h('aside', { 'data-pangea-product-nav': true, 'aria-label': 'PANGEA 产品导航' },
          h('div', { 'data-pangea-nav-heading': true, 'aria-hidden': true }, '工作空间'),
          h('nav', { 'data-pangea-nav-list': true, 'aria-label': '工作空间' }, snapshot.pages.filter(item => item.id !== 'settings' && pageIsAvailable(item, scope)).map(item => {
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
            h('button', { type: 'button', 'data-pangea-tool-button': true, 'data-pangea-native-model-settings': true, 'data-active': page.id === 'settings' && !pageCovered ? 'true' : 'false', 'aria-current': page.id === 'settings' && !pageCovered ? 'page' : undefined, 'aria-label': '设置', title: '设置', onClick: () => service.openPage(scope, 'settings') }, utilityIcon('settings'), h('span', { 'data-pangea-nav-label': true }, '设置')))),
        h('main', { 'data-pangea-page': page.id, 'data-pangea-terminal-open': utility === 'terminal' ? true : undefined },
          h('div', { 'data-pangea-product-content': true, style: { display: pageCovered ? 'none' : undefined } }, React.cloneElement(children, { visible: productVisible })),
          utility === 'editor' || utility === 'browser' ? h('div', { style: { position: 'absolute', inset: 0, zIndex: 10, display: 'flex' } }, renderUtility(utility)) : null,
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

    function createPangeaService(betterSidebar, sessions) {
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
            service: publicService, betterSidebar, sessions, page, scope: props.scope, tab: props.tab, visible: props.visible,
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
      const service = createPangeaService(betterSidebar, ctx.sessions)
      ctx.effect(() => service.registerPage({ id: 'settings', title: '设置', order: 1000, component: SettingsPage }), 'dsh-pangea: product settings page')
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
    exports.apply = apply
    return module.exports
  },
})
