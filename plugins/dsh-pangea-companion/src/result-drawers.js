// One focus/scroll owner per document. Child dialogs restore their triggering
// control without unmounting the reader or resetting the parent drawer's scroll.
const dialogDocuments = new WeakMap()
const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
const usable = node => Boolean(node?.isConnected && node.disabled !== true && typeof node.focus === 'function' && !node.closest?.('[inert], [aria-hidden="true"]') && node.getClientRects?.().length)
const focusables = element => [...(element?.querySelectorAll?.(focusableSelector) ?? [])].filter(usable)
const focus = node => { if (usable(node)) { node.focus({ preventScroll: true }); return true }; return false }
const focusInside = entry => focus(entry.lastFocus) || focus(focusables(entry.element)[0]) || focus(entry.element)
const restoreActiveDialogFocus = element => {
  const doc = element?.ownerDocument, top = dialogDocuments.get(doc)?.entries.at(-1)
  // Removing a focused control can leave focus on body without a focusin event.
  // Only the top dialog may repair that gap; parent commits must not steal it.
  if (top && top.element === element && !element.contains(doc.activeElement)) focusInside(top)
}

export function registerDialog({ element, onClose, returnFocus }) {
  const doc = element?.ownerDocument
  if (!doc) return () => {}
  let state = dialogDocuments.get(doc)
  if (!state) {
    state = { entries: [], overflow: doc.body?.style?.overflow }
    state.keydown = event => {
      const top = state.entries.at(-1)
      if (!top) return
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); top.onClose?.(); return
      }
      if (event.key !== 'Tab') return
      const nodes = focusables(top.element), active = doc.activeElement
      if (!nodes.length) { event.preventDefault(); focus(top.element); return }
      const outside = !top.element.contains(active)
      if (event.shiftKey && (outside || active === nodes[0] || active === top.element)) {
        event.preventDefault(); focus(nodes.at(-1))
      } else if (!event.shiftKey && (outside || active === nodes.at(-1) || active === top.element)) {
        event.preventDefault(); focus(nodes[0])
      }
    }
    state.focusin = event => {
      const top = state.entries.at(-1)
      if (!top) return
      if (top.element.contains(event.target)) top.lastFocus = event.target
      else focusInside(top)
    }
    doc.addEventListener('keydown', state.keydown, true)
    doc.addEventListener('focusin', state.focusin, true)
    if (doc.body?.style) doc.body.style.overflow = 'hidden'
    dialogDocuments.set(doc, state)
  }
  const parent = state.entries.at(-1)
  const previous = returnFocus || (doc.activeElement === doc.body ? parent?.lastFocus : doc.activeElement) || doc.activeElement
  const entry = { element, onClose, previous, lastFocus: null }
  state.entries.push(entry)
  focusInside(entry)
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    const index = state.entries.indexOf(entry), wasTop = index === state.entries.length - 1
    if (index >= 0) state.entries.splice(index, 1)
    const top = state.entries.at(-1)
    if (!top) {
      doc.removeEventListener('keydown', state.keydown, true)
      doc.removeEventListener('focusin', state.focusin, true)
      if (doc.body?.style) doc.body.style.overflow = state.overflow || ''
      dialogDocuments.delete(doc)
    }
    if (!wasTop) return
    // A route change may remove both dialogs. Never focus a disconnected node,
    // nor a still-obscured parent while React is completing its update.
    if (top) {
      if (!(top.element.contains(previous) && focus(previous))) focusInside(top)
    } else focus(previous)
  }
}

export function createDialogLifecycle(React) {
  return function useDialogLifecycle({ root, open = true, onClose, returnFocus }) {
    const closeRef = React.useRef(onClose)
    const registrationRef = React.useRef(null)
    closeRef.current = onClose
    // A render condition can remove the dialog element while `open` remains
    // true (for example, refreshed evidence no longer has a source location).
    // Reconcile the actual ref after every commit, without refocusing on polls.
    React.useEffect(() => {
      const element = open ? root.current : null
      const current = registrationRef.current
      if (current?.element === element) { restoreActiveDialogFocus(element); return }
      if (current) { registrationRef.current = null; current.dispose() }
      if (element) registrationRef.current = { element,
        dispose: registerDialog({ element, onClose: () => closeRef.current?.(), returnFocus: returnFocus?.current || returnFocus }) }
    })
    React.useEffect(() => () => {
      registrationRef.current?.dispose()
      registrationRef.current = null
    }, [])
  }
}

export function createResultDrawer(React) {
  const h = React.createElement
  const useDialogLifecycle = createDialogLifecycle(React)
  return function ResultDrawer({ title, label = title, subtitle, onClose, obscured = false, children }) {
    const root = React.useRef(null)
    useDialogLifecycle({ root, onClose })
    return h('div', { className: 'pangea-bottom-layer', 'aria-hidden': obscured ? 'true' : undefined, inert: obscured ? '' : undefined,
      onClick: event => { if (!obscured && event.target === event.currentTarget) onClose() } },
      h('section', { ref: root, className: 'pangea-bottom-drawer', role: 'dialog', 'aria-modal': obscured ? undefined : 'true', 'aria-label': label, tabIndex: -1 },
        h('header', null, h('div', null, h('h2', null, title), subtitle ? h('p', null, subtitle) : null),
          h('button', { type: 'button', 'data-drawer-close': true, 'aria-label': `关闭${title}`, onClick: onClose }, '关闭')),
        h('div', { className: 'pangea-bottom-content', 'data-scroll-key': `drawer:${label}` }, children)))
  }
}
