// Small, local-only presentation primitives. Opening a drawer does not navigate,
// so the case reader and its scroll position stay mounted underneath.
export function createResultDrawer(React) {
  const h = React.createElement
  return function ResultDrawer({ title, label = title, subtitle, onClose, obscured = false, children }) {
    const root = React.useRef(null)
    React.useEffect(() => {
      const previous = typeof document === 'undefined' ? null : document.activeElement
      const body = typeof document === 'undefined' ? null : document.body
      const overflow = body?.style?.overflow
      if (body?.style) body.style.overflow = 'hidden'
      root.current?.querySelector?.('[data-drawer-close]')?.focus?.({ preventScroll: true })
      return () => { if (body?.style) body.style.overflow = overflow || ''; if (previous?.isConnected) previous.focus?.({ preventScroll: true }) }
    }, [])
    const onKeyDown = event => {
      if (obscured) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
      if (event.key !== 'Tab') return
      const focusable = [...(root.current?.querySelectorAll?.('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]') ?? [])]
        .filter(node => node.getClientRects?.().length !== 0)
      if (!focusable.length) { event.preventDefault(); root.current?.focus?.(); return }
      const first = focusable[0], last = focusable.at(-1), active = root.current?.ownerDocument?.activeElement
      if (event.shiftKey && (active === first || !root.current?.contains?.(active))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (active === last || !root.current?.contains?.(active))) { event.preventDefault(); first.focus() }
    }
    return h('div', { className: 'pangea-bottom-layer', 'aria-hidden': obscured ? 'true' : undefined, inert: obscured ? '' : undefined,
      onClick: event => { if (!obscured && event.target === event.currentTarget) onClose() } },
      h('section', { ref: root, className: 'pangea-bottom-drawer', role: 'dialog', 'aria-modal': obscured ? undefined : 'true', 'aria-label': label, tabIndex: -1, onKeyDown },
        h('header', null, h('div', null, h('h2', null, title), subtitle ? h('p', null, subtitle) : null),
          h('button', { type: 'button', 'data-drawer-close': true, 'aria-label': `关闭${title}`, onClick: onClose }, '关闭')),
        h('div', { className: 'pangea-bottom-content', 'data-scroll-key': `drawer:${label}` }, children)))
  }
}
