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

    const PHASE = {
      PREPARING: '准备中', WAITING_ANALYSIS: '等待分析', WAITING_REVIEW: '等待复核',
      WAITING_REWORK: '等待返工', WAITING_REWORK_REVIEW: '等待返工复核',
      READY_TO_FINALIZE: '等待生成报告', COMPLETE: '已完成', INCOMPLETE: '未完整结束', UNKNOWN: '未知',
    }
    const QUALITY = { PASS: '通过', REWORK: '需要返工', UNRESOLVED: '未解决' }
    const REVIEW = { PASS: '通过', REWORK: '需要返工', UNRESOLVED: '未解决', UNREADABLE: '结果不可读' }
    const SEVERITY = { Critical: '严重', High: '高', Medium: '中', Low: '低' }
    const CONFIDENCE = { high: '高', medium: '中', low: '低' }
    const TRANSLATION = { 'Blackbox-ready': '黑盒可执行', 'Graybox-ready': '灰盒可执行', 'Developer-confirm': '需开发确认' }
    const RISK_STATUS = {
      pending: '待确认', accepted: '已采纳', confirmed: '已确认', false_positive: '误报',
      claimed_fixed: '声称已修复', verified_fixed: '已验证修复',
    }

    const styles = {
      root: { height: '100%', overflow: 'auto', boxSizing: 'border-box', color: 'var(--dsw-alias-text-primary, inherit)' },
      sticky: { position: 'sticky', top: 0, zIndex: 5, padding: '12px 12px 8px', background: 'var(--dsw-alias-bg-layer-1, #111)', borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.18))' },
      header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
      headerLeft: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 },
      title: { fontSize: 15, fontWeight: 750, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      subline: { marginTop: 3, fontSize: 10, opacity: 0.62, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      backButton: { border: 0, background: 'transparent', color: 'inherit', padding: '4px 2px', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' },
      button: { border: '1px solid var(--dsw-alias-border-l2, #555)', background: 'var(--dsw-alias-bg-layer-2, transparent)', color: 'inherit', borderRadius: 6, padding: '5px 8px', cursor: 'pointer', fontSize: 11 },
      nav: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 3, marginTop: 9 },
      navButton: { border: 0, borderRadius: 6, background: 'transparent', color: 'inherit', padding: '6px 3px', cursor: 'pointer', fontSize: 10, opacity: 0.66 },
      navActive: { opacity: 1, fontWeight: 750, background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12))' },
      content: { padding: 12 },
      card: { border: '1px solid var(--dsw-alias-border-l2, #555)', background: 'var(--dsw-alias-bg-layer-1, transparent)', borderRadius: 10, padding: 11, marginBottom: 10 },
      clickableCard: { width: '100%', textAlign: 'left', color: 'inherit', cursor: 'pointer' },
      label: { fontSize: 10, opacity: 0.62, letterSpacing: '0.02em' },
      value: { fontSize: 13, fontWeight: 650, marginTop: 3, overflowWrap: 'anywhere' },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7, marginTop: 8 },
      metric: { border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.14))', borderRadius: 8, padding: 9, background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08))', color: 'inherit' },
      metricClickable: { cursor: 'pointer', width: '100%', textAlign: 'left' },
      metricNumber: { fontSize: 18, fontWeight: 780 },
      metricName: { fontSize: 10, opacity: 0.68, marginTop: 2 },
      progressTrack: { height: 6, borderRadius: 999, overflow: 'hidden', background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.16))', marginTop: 7 },
      progressFill: { height: '100%', background: 'var(--dsw-alias-brand-primary, #4d6bfe)' },
      sectionTitle: { fontSize: 12, fontWeight: 750, margin: '15px 0 7px' },
      itemTitle: { fontSize: 12, fontWeight: 720, lineHeight: 1.4 },
      itemMeta: { fontSize: 10, opacity: 0.62, marginTop: 5, lineHeight: 1.5 },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 7 },
      badge: { display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '2px 6px', fontSize: 9, background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.15))', whiteSpace: 'nowrap' },
      chips: { display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 },
      chip: { border: '1px solid var(--dsw-alias-border-l2, #555)', borderRadius: 999, padding: '3px 7px', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 10 },
      search: { width: '100%', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2, #555)', background: 'var(--dsw-alias-bg-layer-2, transparent)', color: 'inherit', borderRadius: 7, padding: '7px 8px', outline: 'none', fontSize: 11, marginBottom: 7 },
      filters: { display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 5, marginBottom: 3 },
      filter: { flex: '0 0 auto', border: '1px solid var(--dsw-alias-border-l2, #555)', borderRadius: 999, background: 'transparent', color: 'inherit', padding: '4px 8px', fontSize: 10, cursor: 'pointer' },
      filterActive: { background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.15))', fontWeight: 700 },
      text: { fontSize: 11, lineHeight: 1.65, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
      list: { margin: '6px 0 0', paddingLeft: 18, fontSize: 11, lineHeight: 1.65 },
      separator: { border: 0, borderTop: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16))', margin: '10px 0' },
      empty: { opacity: 0.66, fontSize: 11, lineHeight: 1.6 },
      error: { whiteSpace: 'pre-wrap', fontSize: 11, color: 'var(--dsw-alias-text-danger, #e66767)' },
      runButton: { width: '100%', textAlign: 'left', border: 0, borderRadius: 7, padding: '7px 8px', marginBottom: 3, cursor: 'pointer', color: 'inherit', background: 'transparent' },
      runActive: { background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1))' },
    }

    function icon(size = 16) {
      return React.createElement('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      }, React.createElement('circle', { cx: 12, cy: 12, r: 8 }), React.createElement('path', { d: 'M7.5 12h9M12 7.5v9' }), React.createElement('circle', { cx: 12, cy: 12, r: 2.2 }))
    }

    function text(value, fallback = '—') { return typeof value === 'string' && value.trim() !== '' ? value : fallback }
    function field(label, value) {
      return React.createElement('div', null, React.createElement('div', { style: styles.label }, label), React.createElement('div', { style: styles.value }, value ?? '—'))
    }
    function section(title, value) {
      if (!value) return null
      return React.createElement('div', { style: styles.card }, React.createElement('div', { style: styles.itemTitle }, title), React.createElement('div', { style: { ...styles.text, marginTop: 6 } }, value))
    }
    function stringList(title, items, ordered = false) {
      if (!Array.isArray(items) || items.length === 0) return null
      return React.createElement('div', { style: styles.card }, React.createElement('div', { style: styles.itemTitle }, title), React.createElement(ordered ? 'ol' : 'ul', { style: styles.list }, items.map((item, index) => React.createElement('li', { key: `${index}:${item}` }, String(item)))))
    }
    function chip(label, onClick) { return React.createElement('button', { type: 'button', style: styles.chip, onClick }, label) }
    function navType(screen) {
      if (screen.type === 'risk') return 'risks'
      if (screen.type === 'case') return 'cases'
      if (screen.type === 'evidence-detail') return 'evidence'
      return screen.type
    }

    function PangeaPanel({ scope, visible }) {
      const cwd = scope?.cwd
      const [snapshot, setSnapshot] = React.useState(undefined)
      const [error, setError] = React.useState(undefined)
      const [selectedRun, setSelectedRun] = React.useState(undefined)
      const [loading, setLoading] = React.useState(false)
      const [screen, setScreen] = React.useState({ type: 'overview' })
      const [history, setHistory] = React.useState([])
      const [riskQuery, setRiskQuery] = React.useState('')
      const [riskSeverity, setRiskSeverity] = React.useState('全部')
      const [caseQuery, setCaseQuery] = React.useState('')
      const [evidenceQuery, setEvidenceQuery] = React.useState('')

      const load = React.useCallback(async () => {
        if (!cwd) { setSnapshot(undefined); setError('当前会话没有工作区路径，无法定位 pangea-data。'); return }
        setLoading(true)
        try {
          const query = new URLSearchParams({ cwd })
          if (selectedRun) query.set('run_id', selectedRun)
          const response = await fetch(`${API_PATH}?${query.toString()}`, { cache: 'no-store' })
          const body = await response.json()
          if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
          setSnapshot(body); setError(undefined)
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
        finally { setLoading(false) }
      }, [cwd, selectedRun])

      React.useEffect(() => { setSelectedRun(undefined); setScreen({ type: 'overview' }); setHistory([]) }, [cwd])
      React.useEffect(() => {
        void load()
        if (!visible) return undefined
        const timer = window.setInterval(() => { void load() }, 2500)
        return () => window.clearInterval(timer)
      }, [load, visible])

      const current = snapshot?.current
      const details = current?.details ?? { risks: [], test_cases: [], evidence: [], business_flows: [], review_issues: [] }
      const risks = details.risks ?? []
      const testCases = details.test_cases ?? []
      const evidence = details.evidence ?? []
      const riskById = new Map(risks.map(item => [item.risk_id, item]))
      const caseById = new Map(testCases.map(item => [item.test_case_id, item]))
      const evidenceByKey = new Map(evidence.map(item => [[item.chunk_id, item.location, item.observation].join('\u0000'), item]))

      const navigate = React.useCallback((next) => { setHistory(previous => [...previous, screen]); setScreen(next) }, [screen])
      const jump = React.useCallback((type) => { setScreen({ type }); setHistory([]) }, [])
      const goBack = React.useCallback(() => {
        if (history.length === 0) { setScreen({ type: 'overview' }); return }
        setScreen(history[history.length - 1]); setHistory(history.slice(0, -1))
      }, [history])
      const chooseRun = React.useCallback((runId) => { setSelectedRun(runId); setScreen({ type: 'overview' }); setHistory([]) }, [])

      const total = current?.analysis?.total ?? 0
      const completed = current?.analysis?.completed ?? 0
      const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0
      const activeNav = navType(screen)
      const screenTitle = screen.type === 'overview' ? 'PANGEA 总览'
        : screen.type === 'risks' ? '风险'
          : screen.type === 'risk' ? (riskById.get(screen.id)?.risk_id || '风险详情')
            : screen.type === 'cases' ? '测试用例'
              : screen.type === 'case' ? (caseById.get(screen.id)?.test_case_id || '用例详情')
                : screen.type === 'evidence' ? '证据'
                  : screen.type === 'evidence-detail' ? '证据详情' : '复核'

      const navigation = React.createElement('div', { style: styles.nav }, [
        ['overview', '总览'], ['risks', '风险'], ['cases', '用例'], ['evidence', '证据'], ['review', '复核'],
      ].map(([type, label]) => React.createElement('button', { key: type, type: 'button', style: { ...styles.navButton, ...(activeNav === type ? styles.navActive : {}) }, onClick: () => jump(type) }, label)))

      const header = React.createElement('div', { style: styles.sticky },
        React.createElement('div', { style: styles.header },
          React.createElement('div', { style: styles.headerLeft },
            screen.type !== 'overview' ? React.createElement('button', { type: 'button', style: styles.backButton, onClick: goBack }, '← 返回') : null,
            React.createElement('div', { style: { minWidth: 0 } },
              React.createElement('div', { style: styles.title }, screenTitle),
              React.createElement('div', { style: styles.subline }, current ? `${current.run_id} · ${PHASE[current.phase] ?? current.phase}` : '只读伴生工作台'))),
          React.createElement('button', { type: 'button', style: styles.button, onClick: () => { void load() } }, loading ? '刷新中' : '刷新')),
        navigation)

      function metric(number, name, target) {
        const props = target ? { type: 'button', onClick: () => jump(target), style: { ...styles.metric, ...styles.metricClickable } } : { style: styles.metric }
        return React.createElement(target ? 'button' : 'div', props, React.createElement('div', { style: styles.metricNumber }, String(number ?? 0)), React.createElement('div', { style: styles.metricName }, name))
      }

      function renderOverview() {
        if (!current) return React.createElement('div', { style: styles.card }, React.createElement('div', { style: styles.empty }, '当前 pangea-data 中还没有可读取的 Run。'))
        return React.createElement(React.Fragment, null,
          React.createElement('div', { style: styles.card },
            field('当前任务', current.run_id),
            React.createElement('div', { style: { marginTop: 9 } }, field('阶段', PHASE[current.phase] ?? current.phase)),
            React.createElement('div', { style: { marginTop: 9 } },
              React.createElement('div', { style: styles.row }, React.createElement('span', { style: styles.label }, '分析进度'), React.createElement('span', { style: styles.label }, `${completed}/${total}`)),
              React.createElement('div', { style: styles.progressTrack }, React.createElement('div', { style: { ...styles.progressFill, width: `${percent}%` } }))),
            React.createElement('div', { style: styles.grid }, field('质量状态', QUALITY[current.quality_status] ?? current.quality_status ?? '待定'), field('复核状态', REVIEW[current.review?.status] ?? current.review?.status ?? '待定'))),
          React.createElement('div', { style: styles.grid }, metric(risks.length, '风险', 'risks'), metric(testCases.length, '测试用例', 'cases'), metric(evidence.length, '证据', 'evidence'), metric(details.review_issues?.length ?? 0, '复核问题', 'review')),
          React.createElement('div', { style: styles.grid }, metric(details.business_flows?.length ?? current.counts?.business_flows ?? 0, '业务流程'), metric(current.analysis?.reworked ?? 0, '返工单元')),
          current.errors?.length ? React.createElement(React.Fragment, null, React.createElement('div', { style: styles.sectionTitle }, '当前错误'), React.createElement('div', { style: { ...styles.card, ...styles.error } }, JSON.stringify(current.errors, null, 2))) : null,
          snapshot?.runs?.length ? React.createElement(React.Fragment, null,
            React.createElement('div', { style: styles.sectionTitle }, '历史任务'),
            React.createElement('div', { style: styles.card }, snapshot.runs.slice(0, 8).map(run => {
              const active = current.run_id === run.run_id
              return React.createElement('button', { type: 'button', key: run.run_id, style: { ...styles.runButton, ...(active ? styles.runActive : {}) }, onClick: () => chooseRun(run.run_id) }, React.createElement('div', { style: styles.row }, React.createElement('span', { style: { ...styles.itemTitle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: run.run_id }, run.run_id), React.createElement('span', { style: styles.badge }, QUALITY[run.quality_status] ?? PHASE[run.phase] ?? run.quality_status ?? run.phase)))
            }))) : null)
      }

      function renderRisks() {
        const query = riskQuery.trim().toLowerCase()
        const filtered = risks.filter(risk => {
          if (riskSeverity !== '全部' && risk.severity !== riskSeverity) return false
          return !query || [risk.risk_id, risk.title, risk.trigger, risk.system_result, ...(risk.dfx ?? [])].join(' ').toLowerCase().includes(query)
        })
        return React.createElement(React.Fragment, null,
          React.createElement('input', { style: styles.search, value: riskQuery, placeholder: '搜索风险编号、标题、触发条件…', onChange: event => setRiskQuery(event.target.value) }),
          React.createElement('div', { style: styles.filters }, ['全部', 'Critical', 'High', 'Medium', 'Low'].map(level => React.createElement('button', { key: level, type: 'button', style: { ...styles.filter, ...(riskSeverity === level ? styles.filterActive : {}) }, onClick: () => setRiskSeverity(level) }, level === '全部' ? '全部' : SEVERITY[level] ?? level))),
          React.createElement('div', { style: styles.itemMeta }, `显示 ${filtered.length} / ${risks.length} 条`),
          React.createElement('div', { style: { marginTop: 7 } }, filtered.length ? filtered.map(risk => React.createElement('button', { key: `${risk.unit_id}:${risk.risk_id}`, type: 'button', style: { ...styles.card, ...styles.clickableCard }, onClick: () => navigate({ type: 'risk', id: risk.risk_id }) },
            React.createElement('div', { style: styles.row }, React.createElement('div', { style: { ...styles.itemTitle, minWidth: 0 } }, `${risk.risk_id || '未编号'} · ${text(risk.title, '未命名风险')}`), React.createElement('span', { style: styles.badge }, SEVERITY[risk.severity] ?? risk.severity ?? '—')),
            React.createElement('div', { style: styles.itemMeta }, `${TRANSLATION[risk.translation_status] ?? risk.translation_status ?? '未标注'} · 置信度 ${CONFIDENCE[risk.confidence] ?? risk.confidence ?? '—'} · ${risk.linked_test_case_ids?.length ?? 0} 条关联用例`))) : React.createElement('div', { style: styles.card }, React.createElement('div', { style: styles.empty }, '没有符合条件的风险。'))))
      }

      function renderRiskDetail() {
        const risk = riskById.get(screen.id)
        if (!risk) return React.createElement('div', { style: styles.card }, React.createElement('div', { style: styles.empty }, '当前 Run 中找不到这条风险，可能是 Run 已刷新或切换。'))
        const semantics = risk.upstream_semantics
        return React.createElement(React.Fragment, null,
          React.createElement('div', { style: styles.card },
            React.createElement('div', { style: styles.row }, React.createElement('div', { style: styles.itemTitle }, text(risk.title, '未命名风险')), React.createElement('span', { style: styles.badge }, SEVERITY[risk.severity] ?? risk.severity ?? '—')),
            React.createElement('div', { style: styles.chips }, React.createElement('span', { style: styles.badge }, `置信度 ${CONFIDENCE[risk.confidence] ?? risk.confidence ?? '—'}`), React.createElement('span', { style: styles.badge }, TRANSLATION[risk.translation_status] ?? risk.translation_status ?? '未标注'), React.createElement('span', { style: styles.badge }, RISK_STATUS[risk.status] ?? risk.status ?? '未标注')),
            Array.isArray(risk.dfx) && risk.dfx.length ? React.createElement('div', { style: { ...styles.itemMeta, marginTop: 8 } }, `DFX：${risk.dfx.join('、')}`) : null),
          section('触发条件', risk.trigger), section('系统结果', risk.system_result), section('外部可观察现象', risk.external_observation), section('排除条件', risk.exclusion_condition),
          semantics ? React.createElement('div', { style: styles.card }, React.createElement('div', { style: styles.itemTitle }, '上游语义核对'), React.createElement('hr', { style: styles.separator }),
            React.createElement('div', { style: styles.label }, '入口可达性'), React.createElement('div', { style: styles.text }, semantics.reachability),
            React.createElement('div', { style: { ...styles.label, marginTop: 7 } }, '调用方限制'), React.createElement('div', { style: styles.text }, semantics.caller_constraints),
            React.createElement('div', { style: { ...styles.label, marginTop: 7 } }, '规格/文档行为'), React.createElement('div', { style: styles.text }, semantics.documented_behavior),
            React.createElement('div', { style: { ...styles.label, marginTop: 7 } }, '已有测试'), React.createElement('div', { style: styles.text }, semantics.existing_tests),
            React.createElement('div', { style: { ...styles.label, marginTop: 7 } }, '结论'), React.createElement('div', { style: styles.text }, semantics.conclusion)) : null,
          React.createElement('div', { style: styles.card }, React.createElement('div', { style: styles.itemTitle }, `证据（${risk.evidence?.length ?? 0}）`), risk.evidence?.length ? React.createElement('div', { style: styles.chips }, risk.evidence.map((item, index) => { const key = [item.chunk_id ?? '', item.location ?? '', item.observation ?? ''].join('\u0000'); return chip(text(item.location, `证据 ${index + 1}`), () => navigate({ type: 'evidence-detail', key })) })) : React.createElement('div', { style: { ...styles.empty, marginTop: 6 } }, '没有证据。')),
          React.createElement('div', { style: styles.card }, React.createElement('div', { style: styles.itemTitle }, `关联测试用例（${risk.linked_test_case_ids?.length ?? 0}）`), risk.linked_test_case_ids?.length ? React.createElement('div', { style: styles.chips }, risk.linked_test_case_ids.map(id => chip(id, () => navigate({ type: 'case', id })))) : React.createElement('div', { style: { ...styles.empty, marginTop: 6 } }, '暂无关联测试用例。')))
      }

      function renderCases() {
        const query = caseQuery.trim().toLowerCase()
        const filtered = testCases.filter(item => !query || [item.test_case_id, item.title, item.case_type, ...(item.linked_risk_ids ?? [])].join(' ').toLowerCase().includes(query))
        return React.createElement(React.Fragment, null,
          React.createElement('input', { style: styles.search, value: caseQuery, placeholder: '搜索用例编号、标题、类型、关联风险…', onChange: event => setCaseQuery(event.target.value) }),
          React.createElement('div', { style: styles.itemMeta }, `显示 ${filtered.length} / ${testCases.length} 条`),
          React.createElement('div', { style: { marginTop: 7 } }, filtered.length ? filtered.map(item => React.createElement('button', { key: `${item.unit_id}:${item.test_case_id}`, type: 'button', style: { ...styles.card, ...styles.clickableCard }, onClick: () => navigate({ type: 'case', id: item.test_case_id }) }, React.createElement('div', { style: styles.itemTitle }, `${item.test_case_id || '未编号'} · ${text(item.title, '未命名用例')}`), React.createElement('div', { style: styles.itemMeta }, `${text(item.case_type, '未标注类型')} · ${item.linked_risk_ids?.length ?? 0} 条关联风险 · ${text(item.status, 'draft')}`))) : React.createElement('div', { style: styles.card }, React.createElement('div', { style: styles.empty }, '没有符合条件的测试用例。'))))
      }

      function renderCaseDetail() {
        const item = caseById.get(screen.id)
        if (!item) return React.createElement('div', { style: styles.card }, React.createElement('div', { style: styles.empty }, '当前 Run 中找不到这条测试用例，可能是 Run 已刷新或切换。'))
        return React.createElement(React.Fragment, null,
          React.createElement('div', { style: styles.card }, React.createElement('div', { style: styles.itemTitle }, text(item.title, '未命名用例')), React.createElement('div', { style: styles.chips }, React.createElement('span', { style: styles.badge }, text(item.case_type, '未标注类型')), React.createElement('span', { style: styles.badge }, text(item.status, 'draft')))),
          React.createElement('div', { style: styles.card }, React.createElement('div', { style: styles.itemTitle }, `关联风险（${item.linked_risk_ids?.length ?? 0}）`), item.linked_risk_ids?.length ? React.createElement('div', { style: styles.chips }, item.linked_risk_ids.map(id => chip(id, () => navigate({ type: 'risk', id })))) : React.createElement('div', { style: { ...styles.empty, marginTop: 6 } }, '暂无关联风险。')),
          stringList('前置条件', item.preconditions), stringList('执行步骤', item.steps, true), stringList('预期结果', item.expected_results, true), stringList('观察点', item.observability), stringList('清理动作', item.cleanup))
      }

      function renderEvidence() {
        const query = evidenceQuery.trim().toLowerCase()
        const filtered = evidence.filter(item => !query || [item.chunk_id, item.location, item.observation, ...(item.risk_ids ?? [])].join(' ').toLowerCase().includes(query))
        return React.createElement(React.Fragment, null,
          React.createElement('input', { style: styles.search, value: evidenceQuery, placeholder: '搜索文件位置、观察结论、关联风险…', onChange: event => setEvidenceQuery(event.target.value) }),
          React.createElement('div', { style: styles.itemMeta }, `显示 ${filtered.length} / ${evidence.length} 条`),
          React.createElement('div', { style: { marginTop: 7 } }, filtered.length ? filtered.map((item, index) => { const key = [item.chunk_id, item.location, item.observation].join('\u0000'); return React.createElement('button', { key: `${key}:${index}`, type: 'button', style: { ...styles.card, ...styles.clickableCard }, onClick: () => navigate({ type: 'evidence-detail', key }) }, React.createElement('div', { style: styles.itemTitle }, text(item.location, '未标注位置')), React.createElement('div', { style: styles.itemMeta }, text(item.observation, '无观察结论')), item.risk_ids?.length ? React.createElement('div', { style: styles.chips }, item.risk_ids.slice(0, 4).map(id => React.createElement('span', { key: id, style: styles.badge }, id))) : null) }) : React.createElement('div', { style: styles.card }, React.createElement('div', { style: styles.empty }, '没有符合条件的证据。'))))
      }

      function renderEvidenceDetail() {
        const item = evidenceByKey.get(screen.key)
        if (!item) return React.createElement('div', { style: styles.card }, React.createElement('div', { style: styles.empty }, '当前 Run 中找不到这条证据，可能是 Run 已刷新或切换。'))
        return React.createElement(React.Fragment, null,
          React.createElement('div', { style: styles.card }, field('源码/资料位置', text(item.location, '未标注')), React.createElement('div', { style: { marginTop: 9 } }, field('Chunk ID', text(item.chunk_id, '未标注')))),
          section('观察结论', item.observation),
          React.createElement('div', { style: styles.card }, React.createElement('div', { style: styles.itemTitle }, `关联风险（${item.risk_ids?.length ?? 0}）`), item.risk_ids?.length ? React.createElement('div', { style: styles.chips }, item.risk_ids.map(id => chip(id, () => navigate({ type: 'risk', id })))) : React.createElement('div', { style: { ...styles.empty, marginTop: 6 } }, '这条证据没有直接绑定风险。')))
      }

      function renderReview() {
        const review = current?.review
        if (!review) return React.createElement('div', { style: styles.card }, React.createElement('div', { style: styles.empty }, '当前 Run 还没有复核结果。'))
        return React.createElement(React.Fragment, null,
          React.createElement('div', { style: styles.card }, field('复核状态', REVIEW[review.status] ?? review.status ?? '待定'), React.createElement('div', { style: { marginTop: 9 } }, field('Reviewer', review.reviewer_id ?? '—')), review.summary ? React.createElement('div', { style: { ...styles.text, marginTop: 9 } }, review.summary) : null),
          React.createElement('div', { style: styles.sectionTitle }, `复核问题（${details.review_issues?.length ?? 0}）`),
          details.review_issues?.length ? details.review_issues.map(issue => React.createElement('div', { key: issue.issue_id ?? JSON.stringify(issue), style: styles.card }, React.createElement('div', { style: styles.row }, React.createElement('div', { style: styles.itemTitle }, issue.issue_id ?? '未编号问题'), issue.unit_id ? React.createElement('span', { style: styles.badge }, issue.unit_id) : null), issue.reason ? React.createElement(React.Fragment, null, React.createElement('div', { style: { ...styles.label, marginTop: 8 } }, '原因'), React.createElement('div', { style: styles.text }, issue.reason)) : null, issue.required_change ? React.createElement(React.Fragment, null, React.createElement('div', { style: { ...styles.label, marginTop: 8 } }, '要求修改'), React.createElement('div', { style: styles.text }, issue.required_change)) : null)) : React.createElement('div', { style: styles.card }, React.createElement('div', { style: styles.empty }, '没有待处理的复核问题。')))
      }

      let body
      if (screen.type === 'overview') body = renderOverview()
      else if (screen.type === 'risks') body = renderRisks()
      else if (screen.type === 'risk') body = renderRiskDetail()
      else if (screen.type === 'cases') body = renderCases()
      else if (screen.type === 'case') body = renderCaseDetail()
      else if (screen.type === 'evidence') body = renderEvidence()
      else if (screen.type === 'evidence-detail') body = renderEvidenceDetail()
      else body = renderReview()

      return React.createElement('div', { style: styles.root }, header, React.createElement('div', { style: styles.content }, error ? React.createElement('div', { style: { ...styles.card, ...styles.error } }, error) : body))
    }

    function apply(ctx) {
      const betterSidebar = ctx.betterSidebar
      if (!betterSidebar) return
      ctx.effect(() => betterSidebar.registerTab({ id: 'dsh-pangea-companion:pangea', title: () => 'PANGEA', icon, order: 55, single: true, component: (props) => React.createElement(PangeaPanel, props) }), 'dsh-pangea-companion: better-sidebar PANGEA tab')
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
