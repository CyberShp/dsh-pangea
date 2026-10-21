export function createProductUi(React) {
  const h = React.createElement
  function PageHeader({ title, onBack, backLabel = '返回', infoAction, actions }) {
    return h('header', { className: 'pangea-page-header' },
      h('div', { className: 'pangea-page-heading-row' },
        onBack ? h('button', { type: 'button', className: 'pangea-back-button', onClick: onBack, 'aria-label': backLabel, title: backLabel }, '←') : null,
        h('h1', { title }, title)),
      h('div', { className: 'pangea-page-actions' }, infoAction, actions))
  }
  function PageTabs({ items, active, onChange, label = '页面导航' }) {
    return h('nav', { className: 'pangea-page-tabs', 'aria-label': label }, items.map(item => h('button', {
      key: item.id, type: 'button', 'aria-current': active === item.id ? 'page' : undefined,
      disabled: item.disabled, onClick: () => onChange(item.id),
    }, item.label, item.count != null ? h('span', null, item.count) : null)))
  }
  function StatusBadge({ label, tone = 'neutral' }) {
    return h('span', { className: `pangea-status pangea-status-${tone}` }, label)
  }
  function EmptyState({ title, description, action, error = false }) {
    return h('section', { className: 'pangea-empty-state', role: error ? 'alert' : 'status' },
      h('h2', null, title), description ? h('p', null, description) : null, action)
  }
  return Object.freeze({ PageHeader, PageTabs, StatusBadge, EmptyState })
}
