// Browser half of dsh-pangea-companion. It registers one optional tab in
// dsh-better-sidebar and never writes PANGEA state.
window.__ModuleLoader__.load({
  id: 'dsh-pangea-companion',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const inject = ['betterSidebar']
    const API_PATH = '/api/pangea-companion/state'

    const styles = {
      root: { height: '100%', overflow: 'auto', padding: 14, boxSizing: 'border-box', color: 'var(--dsw-alias-text-primary, inherit)' },
      header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 },
      title: { fontSize: 16, fontWeight: 700 },
      button: { border: '1px solid var(--dsw-alias-border-l2, #555)', background: 'var(--dsw-alias-bg-layer-2, transparent)', color: 'inherit', borderRadius: 6, padding: '5px 9px', cursor: 'pointer' },
      card: { border: '1px solid var(--dsw-alias-border-l2, #555)', background: 'var(--dsw-alias-bg-layer-1, transparent)', borderRadius: 10, padding: 12, marginBottom: 12 },
      label: { fontSize: 11, opacity: 0.62, textTransform: 'uppercase', letterSpacing: '0.05em' },
      value: { fontSize: 14, fontWeight: 650, marginTop: 3, overflowWrap: 'anywhere' },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginTop: 10 },
      metric: { borderRadius: 8, padding: 9, background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08))' },
      metricNumber: { fontSize: 18, fontWeight: 750 },
      metricName: { fontSize: 11, opacity: 0.65, marginTop: 2 },
      phase: { fontSize: 13, fontWeight: 700, marginTop: 3 },
      progressTrack: { height: 6, borderRadius: 999, overflow: 'hidden', background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.16))', marginTop: 8 },
      progressFill: { height: '100%', background: 'var(--dsw-alias-brand-primary, #4d6bfe)' },
      sectionTitle: { fontSize: 12, fontWeight: 700, margin: '16px 0 7px' },
      runButton: { width: '100%', textAlign: 'left', border: 0, borderRadius: 7, padding: '8px 9px', marginBottom: 4, cursor: 'pointer', color: 'inherit', background: 'transparent' },
      runButtonActive: { background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1))' },
      runTop: { display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' },
      runName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 650 },
      runPhase: { fontSize: 10, opacity: 0.65, whiteSpace: 'nowrap' },
      error: { whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--dsw-alias-text-danger, #e66767)' },
      empty: { opacity: 0.66, fontSize: 12, lineHeight: 1.6 },
    }

    function icon(size = 16) {
      return React.createElement('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      },
        React.createElement('circle', { cx: 12, cy: 12, r: 8 }),
        React.createElement('path', { d: 'M7.5 12h9M12 7.5v9' }),
        React.createElement('circle', { cx: 12, cy: 12, r: 2.2 }),
      )
    }

    function metric(number, name) {
      return React.createElement('div', { style: styles.metric },
        React.createElement('div', { style: styles.metricNumber }, String(number ?? 0)),
        React.createElement('div', { style: styles.metricName }, name),
      )
    }

    function field(label, value) {
      return React.createElement('div', null,
        React.createElement('div', { style: styles.label }, label),
        React.createElement('div', { style: styles.value }, value ?? '—'),
      )
    }

    function PangeaPanel({ scope, visible }) {
      const cwd = scope?.cwd
      const [snapshot, setSnapshot] = React.useState(undefined)
      const [error, setError] = React.useState(undefined)
      const [selectedRun, setSelectedRun] = React.useState(undefined)
      const [loading, setLoading] = React.useState(false)

      const load = React.useCallback(async () => {
        if (!cwd) {
          setSnapshot(undefined)
          setError('当前会话没有工作区路径，无法定位 pangea-data。')
          return
        }
        setLoading(true)
        try {
          const query = new URLSearchParams({ cwd })
          if (selectedRun) query.set('run_id', selectedRun)
          const response = await fetch(`${API_PATH}?${query.toString()}`, { cache: 'no-store' })
          const body = await response.json()
          if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
          setSnapshot(body)
          setError(undefined)
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
        } finally {
          setLoading(false)
        }
      }, [cwd, selectedRun])

      React.useEffect(() => { setSelectedRun(undefined) }, [cwd])
      React.useEffect(() => {
        void load()
        if (!visible) return undefined
        const timer = window.setInterval(() => { void load() }, 2500)
        return () => window.clearInterval(timer)
      }, [load, visible])

      const current = snapshot?.current
      const total = current?.analysis?.total ?? 0
      const completed = current?.analysis?.completed ?? 0
      const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0

      return React.createElement('div', { style: styles.root },
        React.createElement('div', { style: styles.header },
          React.createElement('div', null,
            React.createElement('div', { style: styles.title }, 'PANGEA'),
            React.createElement('div', { style: styles.label }, loading ? 'Refreshing…' : 'Companion · read only'),
          ),
          React.createElement('button', { type: 'button', style: styles.button, onClick: () => { void load() } }, '刷新'),
        ),
        error ? React.createElement('div', { style: { ...styles.card, ...styles.error } }, error) : null,
        current ? React.createElement(React.Fragment, null,
          React.createElement('div', { style: styles.card },
            field('Current Run', current.run_id),
            React.createElement('div', { style: { marginTop: 10 } },
              React.createElement('div', { style: styles.label }, 'Phase'),
              React.createElement('div', { style: styles.phase }, current.phase),
            ),
            React.createElement('div', { style: { marginTop: 10 } },
              React.createElement('div', { style: styles.runTop },
                React.createElement('span', { style: styles.label }, 'Analysis'),
                React.createElement('span', { style: styles.label }, `${completed}/${total}`),
              ),
              React.createElement('div', { style: styles.progressTrack },
                React.createElement('div', { style: { ...styles.progressFill, width: `${percent}%` } }),
              ),
            ),
            React.createElement('div', { style: styles.grid },
              field('Quality', current.quality_status ?? 'Pending'),
              field('Review', current.review?.status ?? 'Pending'),
            ),
          ),
          React.createElement('div', { style: styles.grid },
            metric(current.counts?.risks, 'Risks'),
            metric(current.counts?.test_cases, 'Test Cases'),
            metric(current.counts?.evidence, 'Evidence'),
            metric(current.counts?.review_issues, 'Review Issues'),
          ),
          current.errors?.length ? React.createElement(React.Fragment, null,
            React.createElement('div', { style: styles.sectionTitle }, 'Current Errors'),
            React.createElement('div', { style: { ...styles.card, ...styles.error } }, JSON.stringify(current.errors, null, 2)),
          ) : null,
        ) : (!error ? React.createElement('div', { style: styles.card },
          React.createElement('div', { style: styles.empty }, '当前 pangea-data 中还没有可读取的 Run。'),
        ) : null),
        snapshot?.runs?.length ? React.createElement(React.Fragment, null,
          React.createElement('div', { style: styles.sectionTitle }, 'Recent Runs'),
          React.createElement('div', { style: styles.card }, snapshot.runs.map(run => {
            const active = (selectedRun ?? current?.run_id) === run.run_id
            return React.createElement('button', {
              type: 'button', key: run.run_id,
              style: { ...styles.runButton, ...(active ? styles.runButtonActive : {}) },
              onClick: () => setSelectedRun(run.run_id),
            }, React.createElement('div', { style: styles.runTop },
              React.createElement('span', { style: styles.runName, title: run.run_id }, run.run_id),
              React.createElement('span', { style: styles.runPhase }, run.quality_status ?? run.phase),
            ))
          })),
        ) : null,
      )
    }

    function apply(ctx) {
      const betterSidebar = ctx.betterSidebar
      if (!betterSidebar) return
      ctx.effect(() => betterSidebar.registerTab({
        id: 'dsh-pangea-companion:pangea',
        title: () => 'PANGEA',
        icon,
        order: 55,
        single: true,
        component: (props) => React.createElement(PangeaPanel, props),
      }), 'dsh-pangea-companion: better-sidebar PANGEA tab')
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
