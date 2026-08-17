// Generated into lib/client.js by scripts/build-client.mjs.
// The browser half is a standard DSH lazy-CJS client plugin.

window.__ModuleLoader__.load({
  id: 'dsh-mass-effect-theme',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const THEME_ID = 'normandy-command'
    const STORAGE_KEY = 'dsh-mass-effect-theme:preference'
    const WALLPAPER = __WALLPAPER_DATA_URL__
    const BACKDROP_ID = 'dsh-normandy-command-backdrop'
    const BADGE_ID = 'dsh-normandy-command-badge'
    const HUD_ID = 'dsh-normandy-command-hud'
    const STYLE_ID = 'dsh-normandy-command-style'
    const ACTIVE_ATTRIBUTE = 'data-normandy-command'
    const BUILTIN_THEMES = new Set(['system', 'light', 'dark'])

    // Cover DSH's full semantic token surface so native controls never fall
    // back to the host light palette while this dark skin is active.
    const theme = {
      id: THEME_ID,
      colorScheme: 'dark',
      tokens: {
        '--dsw-alias-bg-base': 'rgba(2, 7, 17, 0.34)',
        '--dsw-alias-bg-layer-1': '#081422',
        '--dsw-alias-bg-layer-2': '#0b1b2c',
        '--dsw-alias-bg-layer-3': '#10243a',
        '--dsw-alias-bg-mask-1': 'rgba(0, 4, 12, 0.58)',
        '--dsw-alias-bg-mask-2': 'rgba(0, 4, 12, 0.28)',
        '--dsw-alias-bg-mask-3': 'rgba(0, 4, 12, 0.72)',
        '--dsw-alias-bg-mask-photo': 'rgba(0, 3, 10, 0.9)',
        '--dsw-alias-bg-mask-drop': 'rgba(4, 13, 25, 0.78)',
        '--dsw-alias-bg-module-platform': '#0c1d2f',
        '--dsw-alias-bg-multi-select': '#122b42',
        '--dsw-alias-bg-overlay': '#17344d',
        '--dsw-alias-bg-skeleton': 'rgba(142, 201, 224, 0.1)',
        '--dsw-alias-border-inverted2': 'rgba(219, 240, 248, 0.1)',
        '--dsw-alias-border-inverted': 'rgba(219, 240, 248, 0.08)',
        '--dsw-alias-border-l1': 'rgba(110, 181, 211, 0.16)',
        '--dsw-alias-border-l2-darkmode-thin': 'rgba(110, 181, 211, 0.18)',
        '--dsw-alias-border-l2': 'rgba(110, 181, 211, 0.28)',
        '--dsw-alias-border-l3': 'rgba(120, 201, 232, 0.42)',
        '--dsw-alias-border-l4': 'rgba(139, 216, 244, 0.58)',
        '--dsw-alias-brand-primary-invert': '#f7fbfd',
        '--dsw-alias-brand-primary-new-colorprimary-new-color': '#56bfe8',
        '--dsw-alias-brand-primary': '#d63b46',
        '--dsw-alias-brand-text': '#edf7fb',
        '--dsw-alias-button-contrast-fill': '#dceef5',
        '--dsw-alias-button-elevated-fill': '#10243a',
        '--dsw-alias-button-floating-fill': '#112a41',
        '--dsw-alias-button-floating-hover': '#183b56',
        '--dsw-alias-button-ghost-active-border': 'rgba(86, 191, 232, 0.52)',
        '--dsw-alias-button-ghost-active-fill': 'rgba(47, 135, 174, 0.28)',
        '--dsw-alias-button-ghost-active-hover': 'rgba(56, 153, 193, 0.36)',
        '--dsw-alias-button-info-fill': '#287da5',
        '--dsw-alias-button-info-hover': '#3296c2',
        '--dsw-alias-button-primary-dimmed': '#4a222d',
        '--dsw-alias-button-primary-fill': '#d63b46',
        '--dsw-alias-button-primary-hover': '#ed4b56',
        '--dsw-alias-button-tool-bar-fill-invisible': 'rgba(15, 38, 57, 0.48)',
        '--dsw-alias-button-tool-bar-fill': 'rgba(26, 65, 91, 0.72)',
        '--dsw-alias-button-tool-bar-hover': 'rgba(38, 91, 122, 0.82)',
        '--dsw-alias-interactive-bg-active': 'rgba(86, 191, 232, 0.22)',
        '--dsw-alias-interactive-bg-hover-accent': 'rgba(86, 191, 232, 0.18)',
        '--dsw-alias-interactive-bg-hover-danger': 'rgba(237, 75, 86, 0.18)',
        '--dsw-alias-interactive-bg-hover-solid': '#132d44',
        '--dsw-alias-interactive-bg-hover': 'rgba(86, 191, 232, 0.1)',
        '--dsw-alias-label-caption': '#5f7f91',
        '--dsw-alias-label-dimmed': '#405a69',
        '--dsw-alias-label-primary-bluish': '#dff3fb',
        '--dsw-alias-label-primary-dimmed': '#b3ccd8',
        '--dsw-alias-label-primary-foreground': '#ffffff',
        '--dsw-alias-label-primary-inverted': '#07111f',
        '--dsw-alias-label-primary': '#e6f2f8',
        '--dsw-alias-label-secondary': '#a7c3d2',
        '--dsw-alias-label-tertiary': '#7899aa',
        '--dsw-alias-markdown-citation': '#173750',
        '--dsw-alias-markdown-code-block-banner': '#0d2033',
        '--dsw-alias-markdown-code-block': '#06101c',
        '--dsw-alias-markdown-code-segment-selected': '#173750',
        '--dsw-alias-markdown-code-segment-unselected': '#0a1929',
        '--dsw-alias-markdown-inline-code': '#17344d',
        '--dsw-alias-markdown-placeholder': '#0c1d2f',
        '--dsw-alias-markdown-tag': '#122b42',
        '--dsw-alias-scrollbar-bg-l1': '#16354c',
        '--dsw-alias-scrollbar-bg-l2': '#1d4560',
        '--dsw-alias-scrollbar-hover-l1': '#286482',
        '--dsw-alias-scrollbar-hover-l2': '#337797',
        '--dsw-alias-state-business-primary': '#56bfe8',
        '--dsw-alias-state-business-tertiary': '#12354d',
        '--dsw-alias-state-error-primary': '#ff6670',
        '--dsw-alias-state-error-secondary': '#ed4b56',
        '--dsw-alias-state-success-primary': '#54d4c5',
        '--dsw-alias-state-success-secondary': '#42bcae',
        '--dsw-alias-state-success-tertiary': '#123d3c',
        '--dsw-alias-state-warn-label': '#f0b45c',
        '--dsw-alias-state-warn-primary': '#e4a44c',
        '--dsw-alias-state-warn-secondary': '#c98936',
        '--dsw-alias-state-warn-tertiary': '#49351e',
        '--dsw-alias-toast-bg': '#18344a',
        '--dsw-alias-tooltip-bg': '#173148',
        '--dsw-specific-bubble-highlight': '#173e59',
        '--dsw-specific-bubble': '#0d2438',
        '--dsw-specific-input-major': '#08192a',
        '--dsw-specific-login-input': '#071523',
        '--dsw-specific-menu': '#10243a',
        '--dsw-specific-selector': '#122b42',
        '--dsw-specific-sidebar-fill': 'rgba(3, 12, 24, 0.82)',
        '--dsw-specific-sidebar-nav-item-active-accent': '#174c68',
        '--dsw-specific-sidebar-nav-item-active': '#14344a',
        '--dsw-specific-sidebar-nav-item-hover': '#0f293c',
        '--dsw-specific-tip': '#0d263b'
      }
    }

    const readPreference = () => {
      const value = window.localStorage?.getItem(STORAGE_KEY)
      return value === THEME_ID || BUILTIN_THEMES.has(value) ? value : THEME_ID
    }

    const writePreference = (value) => window.localStorage?.setItem(STORAGE_KEY, value)
    const removeElement = (id) => document.getElementById(id)?.remove()

    const ensureVisualLayer = () => {
      removeElement(BACKDROP_ID)
      removeElement(BADGE_ID)
      removeElement(HUD_ID)
      removeElement(STYLE_ID)

      const backdrop = document.createElement('div')
      backdrop.id = BACKDROP_ID
      backdrop.setAttribute('aria-hidden', 'true')
      backdrop.style.cssText = [
        'position:fixed', 'inset:-8px', 'z-index:0', 'pointer-events:none',
        'will-change:transform', 'transform:scale(1.015) translate3d(0,0,0)',
        'transition:transform 500ms cubic-bezier(.2,.75,.25,1)',
        'background-size:cover', 'background-position:center center', 'background-repeat:no-repeat',
        'background-image:linear-gradient(90deg,rgba(1,5,12,.18),rgba(1,6,14,.3) 48%,rgba(1,5,12,.16)),url("' + WALLPAPER + '")'
      ].join(';')
      document.body.prepend(backdrop)

      const badge = document.createElement('div')
      badge.id = BADGE_ID
      badge.setAttribute('aria-hidden', 'true')
      badge.innerHTML = '<span class="n7-mark"><b>N</b><i>7</i></span><span class="n7-copy">NORMANDY<br>COMMAND</span>'
      document.body.append(badge)

      const hud = document.createElement('div')
      hud.id = HUD_ID
      hud.setAttribute('aria-hidden', 'true')
      hud.innerHTML = '<span class="command-pip"></span><span class="command-name">NORMANDY SR-2<small>COMMAND LINK</small></span><em></em>'
      document.body.append(hud)

      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = `
        html[${ACTIVE_ATTRIBUTE}='active'] { color-scheme: dark; background: #020711; }
        body[${ACTIVE_ATTRIBUTE}='active'] { background-color: transparent !important; letter-spacing: .005em; isolation: isolate; }
        body[${ACTIVE_ATTRIBUTE}='active'] > *:not(#${BACKDROP_ID}):not(#${BADGE_ID}):not(#${HUD_ID}) { position: relative; z-index: 1; }
        body[${ACTIVE_ATTRIBUTE}='active']::before {
          content: ''; position: fixed; inset: 0; z-index: 2; pointer-events: none;
          border-top: 1px solid rgba(214, 59, 70, .48); box-shadow: inset 0 0 140px rgba(0, 7, 18, .72);
        }
        #${BADGE_ID} {
          position: fixed; right: 24px; bottom: 18px; z-index: 3; display: flex; align-items: center; gap: 10px;
          pointer-events: none; opacity: .7; color: #ccecff; filter: drop-shadow(0 0 9px rgba(53, 174, 224, .2));
          font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        #${BADGE_ID} .n7-mark {
          display: inline-flex; align-items: baseline; height: 27px; padding-right: 7px; border-right: 5px solid #d63b46;
          font-size: 24px; font-weight: 800; line-height: 27px; letter-spacing: -.08em; transform: skew(-8deg);
        }
        #${BADGE_ID} .n7-mark b, #${BADGE_ID} .n7-mark i { font-style: normal; }
        #${BADGE_ID} .n7-mark i { color: #d63b46; }
        #${BADGE_ID} .n7-copy { color: #7899aa; font-size: 8px; line-height: 1.18; letter-spacing: .22em; }
        #${HUD_ID} {
          position: fixed; top: 13px; right: 150px; z-index: 3; box-sizing: border-box; display: grid;
          grid-template-columns: 6px 1fr auto; align-items: center; gap: 9px; width: 222px; height: 34px; padding: 4px 10px;
          pointer-events: none; border: 1px solid rgba(89, 181, 224, .22); border-left: 2px solid #d63b46;
          border-radius: 3px 10px 3px 3px; background: linear-gradient(90deg, rgba(6, 20, 35, .93), rgba(9, 29, 49, .78));
          box-shadow: inset 0 1px 0 rgba(151, 224, 255, .08), 0 8px 26px rgba(0, 5, 14, .24);
          font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        #${HUD_ID} .command-pip { width: 5px; height: 5px; border-radius: 50%; background: #7899aa; box-shadow: 0 0 0 3px rgba(120,153,170,.1); }
        #${HUD_ID} .command-name { color: #dff3fb; font-size: 9px; font-weight: 650; line-height: 1.05; letter-spacing: .13em; }
        #${HUD_ID} .command-name small { display: block; margin-top: 3px; color: #7899aa; font-size: 7px; font-weight: 500; letter-spacing: .22em; }
        #${HUD_ID} em { color: #7899aa; font-size: 7px; font-style: normal; letter-spacing: .16em; }
        #${HUD_ID} em::after { content: 'STANDBY'; }
        body[${ACTIVE_ATTRIBUTE}='active']:has([data-state='running']) #${HUD_ID} .command-pip {
          background: #54d4c5; box-shadow: 0 0 0 3px rgba(84,212,197,.12), 0 0 10px rgba(84,212,197,.28);
          animation: normandy-link-pulse 1.8s ease-in-out infinite;
        }
        body[${ACTIVE_ATTRIBUTE}='active']:has([data-state='running']) #${HUD_ID} em { color: #54d4c5; }
        body[${ACTIVE_ATTRIBUTE}='active']:has([data-state='running']) #${HUD_ID} em::after { content: 'ACTIVE'; }
        @keyframes normandy-link-pulse { 50% { opacity: .5; } }
        body[${ACTIVE_ATTRIBUTE}='active'] [role='treeitem'][aria-selected='true'] {
          border-radius: 4px 8px 4px 4px !important; background: linear-gradient(90deg, rgba(25,89,119,.46), rgba(15,46,67,.5)) !important;
          box-shadow: inset 2px 0 0 #56bfe8, inset 0 1px 0 rgba(147,223,255,.08) !important;
        }
        body[${ACTIVE_ATTRIBUTE}='active'] [data-composer-card] {
          border-color: rgba(91,192,230,.4) !important; border-left: 2px solid rgba(214,59,70,.86) !important;
          border-radius: 5px 18px 5px 12px !important; background: linear-gradient(135deg, rgba(5,17,31,.98), rgba(8,27,46,.96)) !important;
          box-shadow: inset 0 1px 0 rgba(170,231,255,.08), 0 12px 32px rgba(0,4,12,.38) !important;
        }
        body[${ACTIVE_ATTRIBUTE}='active'] [data-composer-card]::before {
          content: 'COMMAND INPUT  //  EDI LINK'; position: absolute; top: 6px; right: 18px; pointer-events: none;
          color: rgba(105,166,193,.62); font-size: 7px; line-height: 1; letter-spacing: .18em;
        }
        body[${ACTIVE_ATTRIBUTE}='active'] [data-tool][data-state] {
          position: relative; border-left: 2px solid rgba(86,191,232,.48); border-radius: 3px 9px 3px 3px;
          background: linear-gradient(90deg, rgba(12,42,62,.46), rgba(6,19,34,.16) 78%);
        }
        body[${ACTIVE_ATTRIBUTE}='active'] [data-tool][data-state='running'] {
          border-left-color: #54d4c5; background: linear-gradient(90deg, rgba(29,103,110,.32), rgba(7,28,42,.16) 78%);
        }
        body[${ACTIVE_ATTRIBUTE}='active'] [data-tool][data-state='error'] {
          border-left-color: #ff6670; background: linear-gradient(90deg, rgba(113,31,43,.3), rgba(38,10,18,.1) 78%);
        }
        body[${ACTIVE_ATTRIBUTE}='active'] select, body[${ACTIVE_ATTRIBUTE}='active'] [role='combobox'] {
          color: var(--dsw-alias-label-primary) !important; border-color: var(--dsw-alias-border-l2) !important;
          background-color: var(--dsw-specific-selector) !important;
        }
        body[${ACTIVE_ATTRIBUTE}='active'] option { color: #e6f2f8; background: #10243a; }
        body[${ACTIVE_ATTRIBUTE}='active'] button, body[${ACTIVE_ATTRIBUTE}='active'] [role='button'],
        body[${ACTIVE_ATTRIBUTE}='active'] input, body[${ACTIVE_ATTRIBUTE}='active'] textarea, body[${ACTIVE_ATTRIBUTE}='active'] select {
          transition: border-color 140ms ease, background-color 140ms ease, box-shadow 140ms ease, color 140ms ease;
        }
        body[${ACTIVE_ATTRIBUTE}='active'] :focus-visible { outline: 2px solid rgba(86,191,232,.72) !important; outline-offset: 2px; }
        body[${ACTIVE_ATTRIBUTE}='active'] :disabled, body[${ACTIVE_ATTRIBUTE}='active'] [aria-disabled='true'] { opacity: .48; }
        @media (max-width: 760px) {
          #${BACKDROP_ID} { background-position: 58% center !important; transform: scale(1.02) !important; }
          #${BADGE_ID}, #${HUD_ID} { display: none; }
          body[${ACTIVE_ATTRIBUTE}='active']::before { box-shadow: inset 0 0 80px rgba(0,8,20,.7); }
          body[${ACTIVE_ATTRIBUTE}='active'] [data-composer-card]::before { display: none; }
        }
        @media (min-width: 761px) and (max-width: 1040px) { #${HUD_ID} { display: none; } }
        @media (prefers-reduced-motion: reduce) {
          #${BACKDROP_ID}, body[${ACTIVE_ATTRIBUTE}='active'] button, body[${ACTIVE_ATTRIBUTE}='active'] [role='button'],
          body[${ACTIVE_ATTRIBUTE}='active'] input, body[${ACTIVE_ATTRIBUTE}='active'] textarea, body[${ACTIVE_ATTRIBUTE}='active'] select { transition: none !important; }
          #${HUD_ID} .command-pip { animation: none !important; }
        }
      `
      document.head.append(style)

      let frame = 0
      let nextX = 0
      let nextY = 0
      const finePointer = window.matchMedia?.('(pointer: fine)').matches !== false
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
      const renderParallax = () => {
        frame = 0
        backdrop.style.transform = `scale(1.015) translate3d(${nextX.toFixed(2)}px, ${nextY.toFixed(2)}px, 0)`
      }
      const onPointerMove = (event) => {
        nextX = ((event.clientX / window.innerWidth) - 0.5) * -8
        nextY = ((event.clientY / window.innerHeight) - 0.5) * -8
        if (!frame) frame = window.requestAnimationFrame(renderParallax)
      }
      const resetParallax = () => {
        nextX = 0
        nextY = 0
        if (!frame) frame = window.requestAnimationFrame(renderParallax)
      }
      if (finePointer && !reducedMotion) {
        window.addEventListener('pointermove', onPointerMove, { passive: true })
        window.addEventListener('blur', resetParallax)
      }

      return () => {
        if (finePointer && !reducedMotion) {
          window.removeEventListener('pointermove', onPointerMove)
          window.removeEventListener('blur', resetParallax)
        }
        if (frame) window.cancelAnimationFrame(frame)
        backdrop.remove()
        badge.remove()
        hud.remove()
        style.remove()
      }
    }

    const sectionStyles = {
      wrap: { padding: '4px 0 16px' },
      intro: { margin: '0 0 18px', color: 'var(--dsw-alias-label-secondary)', fontSize: 13, lineHeight: 1.65 },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 },
      card: {
        boxSizing: 'border-box', minHeight: 112, padding: '16px 17px', textAlign: 'left', cursor: 'pointer',
        color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 10,
        background: 'var(--dsw-alias-bg-layer-2)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.025)'
      },
      selected: {
        borderColor: '#56bfe8', background: 'linear-gradient(145deg, #102c42, #0b1d2e)',
        boxShadow: 'inset 3px 0 0 #d63b46, inset 0 1px 0 rgba(144,218,247,.08)'
      },
      label: { display: 'block', marginBottom: 7, fontSize: 14, fontWeight: 600 },
      copy: { display: 'block', color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: 1.55 },
      status: { display: 'inline-block', marginTop: 10, color: '#75ceef', fontSize: 10, letterSpacing: '.08em' }
    }

    const inject = ['slots', 'theme']

    function apply(ctx) {
      const unregisterTheme = ctx.theme.register(theme)
      let removeVisualLayer = null

      const syncVisualState = (preference) => {
        const active = preference === THEME_ID
        if (active && !removeVisualLayer) {
          document.documentElement.setAttribute(ACTIVE_ATTRIBUTE, 'active')
          document.body.setAttribute(ACTIVE_ATTRIBUTE, 'active')
          removeVisualLayer = ensureVisualLayer()
        } else if (!active && removeVisualLayer) {
          removeVisualLayer()
          removeVisualLayer = null
          document.documentElement.removeAttribute(ACTIVE_ATTRIBUTE)
          document.body.removeAttribute(ACTIVE_ATTRIBUTE)
        }
      }

      function NormandySettingsSection() {
        const [active, setActive] = React.useState(() => ctx.theme.getTheme().preference === THEME_ID)
        React.useEffect(() => {
          const off = ctx.on('theme/change', (snapshot) => setActive(snapshot.preference === THEME_ID))
          return typeof off === 'function' ? off : undefined
        }, [])

        const choose = (preference) => {
          writePreference(preference)
          ctx.theme.setTheme(preference)
          setActive(preference === THEME_ID)
        }

        return React.createElement('div', { style: sectionStyles.wrap },
          React.createElement('p', { style: sectionStyles.intro }, '诺曼底外观独立于 DSH 的浅色、深色与跟随系统。切回 DSH 默认后，背景、HUD 和战术装饰都会一并退出。'),
          React.createElement('div', { style: sectionStyles.grid },
            React.createElement('button', {
              type: 'button', 'aria-pressed': active, onClick: () => choose(THEME_ID),
              style: { ...sectionStyles.card, ...(active ? sectionStyles.selected : {}) }
            },
              React.createElement('span', { style: sectionStyles.label }, 'Normandy Command'),
              React.createElement('span', { style: sectionStyles.copy }, '舰桥背景、深海军蓝界面、N7 红色强调与轻微背景视差。'),
              active ? React.createElement('span', { style: sectionStyles.status }, '● CURRENT THEME') : null
            ),
            React.createElement('button', {
              type: 'button', 'aria-pressed': !active, onClick: () => choose('system'),
              style: { ...sectionStyles.card, ...(!active ? sectionStyles.selected : {}) }
            },
              React.createElement('span', { style: sectionStyles.label }, 'DSH 默认外观'),
              React.createElement('span', { style: sectionStyles.copy }, '恢复官方外观，并继续使用通用设置里的浅色、深色或跟随系统。'),
              !active ? React.createElement('span', { style: sectionStyles.status }, '● DSH APPEARANCE') : null
            )
          )
        )
      }

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'normandy-command', order: 15, label: 'Normandy / 诺曼底'
      }, NormandySettingsSection))

      const initialPreference = readPreference()
      ctx.theme.setTheme(initialPreference)
      syncVisualState(initialPreference)

      ctx.on('theme/change', (snapshot) => {
        const preference = snapshot.preference
        writePreference(preference === THEME_ID || BUILTIN_THEMES.has(preference) ? preference : 'system')
        syncVisualState(preference)
      })

      ctx.effect(() => () => {
        removeVisualLayer?.()
        removeVisualLayer = null
        document.documentElement.removeAttribute(ACTIVE_ATTRIBUTE)
        document.body.removeAttribute(ACTIVE_ATTRIBUTE)
        if (ctx.theme.getTheme().preference === THEME_ID) ctx.theme.setTheme('system')
        unregisterTheme()
      }, 'dsh-mass-effect-theme: register Normandy command theme')
    }

    exports.THEME_ID = THEME_ID
    exports.STORAGE_KEY = STORAGE_KEY
    exports.theme = theme
    exports.inject = inject
    exports.apply = apply
    return module.exports
  }
})
