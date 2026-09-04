// PANGEA product-shell adapter for DSH-owned model configuration.
// PANGEA replaces the DSH navigation, so the product owns the visible entry
// points while DSH remains the single source of truth for model state/writes.
;(() => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (globalThis.__dshPangeaProductModelAdapter === true) return
  globalThis.__dshPangeaProductModelAdapter = true

  const OPEN_EVENT = 'pangea:open-model-settings'
  const STATE_EVENT = 'pangea:model-onboarding-state'
  const QUERY_EVENT = 'pangea:query-model-onboarding'
  const SETTINGS_ATTR = 'data-pangea-native-model-settings'
  const ONBOARDING_ATTR = 'data-pangea-model-onboarding'
  const CHROME_STYLE_ID = 'dsh-pangea-product-chrome-policy'

  let modelState = { known: false, required: false, modelAvailable: false }
  let dismissed = false
  let queriedShell = null

  function installProductChromePolicy() {
    if (document.getElementById(CHROME_STYLE_ID)) return
    const style = document.createElement('style')
    style.id = CHROME_STYLE_ID
    style.textContent = '[data-pangea-system-state]{display:none!important}'
    document.head.appendChild(style)
  }

  function gearIcon() {
    const ns = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('width', '21')
    svg.setAttribute('height', '21')
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '1.8')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
    svg.setAttribute('aria-hidden', 'true')
    const circle = document.createElementNS(ns, 'circle')
    circle.setAttribute('cx', '12')
    circle.setAttribute('cy', '12')
    circle.setAttribute('r', '3')
    const path = document.createElementNS(ns, 'path')
    path.setAttribute('d', 'M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.06 3.8l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 9c.12.39.33.74.6 1 .3.3.68.5 1.1.6h.1v4h-.1a1.7 1.7 0 0 0-1.7.4Z')
    svg.append(circle, path)
    return svg
  }

  function openInternalModels() {
    dismissed = true
    syncOnboarding()
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { mode: 'internal' } }))
  }

  function createSettingsButton() {
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute(SETTINGS_ATTR, 'true')
    button.setAttribute('data-pangea-tool-button', 'true')
    button.setAttribute('aria-label', '设置')
    button.setAttribute('aria-haspopup', 'dialog')
    button.title = '设置'
    button.style.marginTop = '8px'

    const icon = document.createElement('span')
    icon.setAttribute('data-pangea-nav-icon', 'true')
    icon.appendChild(gearIcon())
    const label = document.createElement('span')
    label.setAttribute('data-pangea-nav-label', 'true')
    label.textContent = '设置'
    button.append(icon, label)
    button.addEventListener('click', openInternalModels)
    return button
  }

  function ensureSettingsButton() {
    for (const toolList of document.querySelectorAll('[data-pangea-tool-list]')) {
      if (toolList.querySelector(`[${SETTINGS_ATTR}]`)) continue
      toolList.appendChild(createSettingsButton())
    }
  }

  function removeOnboarding() {
    document.querySelector(`[${ONBOARDING_ATTR}]`)?.remove()
  }

  function createOnboarding() {
    const overlay = document.createElement('div')
    overlay.setAttribute(ONBOARDING_ATTR, 'true')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:11000;display:grid;place-items:center;padding:24px;background:rgba(20,24,32,.42)'

    const card = document.createElement('section')
    card.setAttribute('role', 'dialog')
    card.setAttribute('aria-modal', 'true')
    card.setAttribute('aria-label', '首次配置模型与 API')
    card.style.cssText = 'box-sizing:border-box;width:min(600px,calc(100vw - 48px));padding:30px;border:1px solid #dfe3e8;border-radius:12px;background:#fff;box-shadow:0 24px 70px rgba(0,0,0,.24);color:#17191d;font-family:"Huawei Sans","HarmonyOS Sans SC","PingFang SC","Microsoft YaHei UI",sans-serif'

    const title = document.createElement('h2')
    title.textContent = '配置模型与 API'
    title.style.cssText = 'margin:0;font-size:22px;line-height:30px'
    const description = document.createElement('p')
    description.textContent = 'PANGEA 使用 DSH 管理的官方或自定义模型。请先完成模型与 API 接入。'
    description.style.cssText = 'margin:10px 0 22px;color:#68707c;font-size:14px;line-height:22px'

    const action = document.createElement('button')
    action.type = 'button'
    action.textContent = '打开模型与 API 设置'
    action.style.cssText = 'width:100%;min-height:44px;border:0;border-radius:7px;padding:0 16px;background:#c7000b;color:#fff;font:inherit;font-weight:650;cursor:pointer'
    action.addEventListener('click', openInternalModels)

    const later = document.createElement('button')
    later.type = 'button'
    later.textContent = '稍后配置'
    later.style.cssText = 'margin-top:14px;border:0;background:transparent;color:#68707c;font:inherit;font-size:13px;cursor:pointer'
    later.addEventListener('click', () => {
      dismissed = true
      removeOnboarding()
    })

    card.append(title, description, action, later)
    overlay.appendChild(card)
    return overlay
  }

  function syncOnboarding() {
    const shell = document.querySelector('[data-pangea-shell]')
    if (!shell || !modelState.required || dismissed) {
      removeOnboarding()
      return
    }
    if (!document.querySelector(`[${ONBOARDING_ATTR}]`)) document.body.appendChild(createOnboarding())
  }

  function queryForVisibleShell() {
    const shell = document.querySelector('[data-pangea-shell]')
    if (!shell || shell === queriedShell) return
    queriedShell = shell
    window.dispatchEvent(new CustomEvent(QUERY_EVENT))
  }

  function reconcile() {
    installProductChromePolicy()
    queryForVisibleShell()
    syncOnboarding()
  }

  window.addEventListener(STATE_EVENT, event => {
    const detail = event.detail ?? {}
    modelState = {
      known: true,
      required: detail.required === true,
      modelAvailable: detail.modelAvailable === true,
    }
    if (!modelState.required) dismissed = false
    syncOnboarding()
  })

  const observer = new MutationObserver(reconcile)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  reconcile()
})()
