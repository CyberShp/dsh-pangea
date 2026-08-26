// Browser half of dsh-pangea-companion. It browses PANGEA results and starts
// separately stored executor runs without modifying analysis state.
window.__ModuleLoader__.load({
  id: 'dsh-pangea-companion',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const inject = ['pangea']
    const API_PATH = '/api/pangea-companion/state'
    const SOURCE_API_PATH = '/api/pangea-companion/source'
    const ENVIRONMENT_API_PATH = '/api/pangea-companion/environments'
    const EXECUTION_API_PATH = '/api/pangea-companion/executions'
    const WORKBENCH_API_PATH = '/api/pangea-companion/workbench'

    async function requestSnapshot({ cwd, runId, sessionId, signal, fetcher = fetch }) {
      const query = new URLSearchParams({ cwd })
      if (runId) query.set('run_id', runId)
      if (sessionId) query.set('session_id', sessionId)
      const response = await fetcher(`${API_PATH}?${query.toString()}`, { cache: 'no-store', signal })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    async function requestSourceSnippet({ cwd, dataRoot, location, signal, fetcher = fetch }) {
      const query = new URLSearchParams({ cwd, data_root: dataRoot, location })
      const response = await fetcher(`${SOURCE_API_PATH}?${query.toString()}`, { cache: 'no-store', signal })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    async function requestEnvironments(fetcher = fetch) {
      const response = await fetcher(ENVIRONMENT_API_PATH, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body.environments ?? []
    }

    async function saveEnvironment(environment, fetcher = fetch) {
      const response = await fetcher(ENVIRONMENT_API_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(environment),
      })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body.environment
    }

    async function removeEnvironment(id, fetcher = fetch) {
      const response = await fetcher(`${ENVIRONMENT_API_PATH}?${new URLSearchParams({ id })}`, { method: 'DELETE' })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body.removed === true
    }

    async function launchExecution(input, fetcher = fetch) {
      const response = await fetcher(EXECUTION_API_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
      })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    async function requestWorkbench({ cwd, cursor = 0, limit = 20, signal, fetcher = fetch }) {
      const query = new URLSearchParams({ cwd, cursor: String(cursor), limit: String(limit) })
      const response = await fetcher(`${WORKBENCH_API_PATH}?${query}`, { cache: 'no-store', signal })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    async function requestWorkbenchAction({ cwd, action, payload = {}, fetcher = fetch }) {
      const response = await fetcher(`${WORKBENCH_API_PATH}?${new URLSearchParams({ cwd })}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...payload }),
      })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    const PHASE = {
      PREPARING: '准备中', PLANNING: '规划分析单元', ANALYZING: '并行分析中', REVIEWING: '独立复核中',
      CLOSING: '定向补齐中', REPORTING: '生成报告中', COMPLETE: '已完成', INCOMPLETE: '未完整结束',
      STOPPED: '已停止', FAILED: '已失败', UNKNOWN: '未知',
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
    const HEALTH = { ok: '正常', warning: '需关注', error: '异常' }
    const SOURCE = { 'final-state': '最终聚合结果', 'worker-results': 'Worker 结果兼容读取' }
    const DISCUSSION_INTENTS = {
      review: '请结合证据和关联对象做独立判断：结论是否成立，还需要哪些信息。',
      evidence: '只基于下方“选中源码片段”核对“待核对结论”：分别说明这些源码能直接支持什么、组合后仍不能证明什么。不要调用工具，不要读取或使用其他文件、其他证据、PANGEA 其他字段或整个 Run 的信息。',
      executable: '请把当前结论改写成可执行的测试语言，包含前置、操作、观察点和预期结果。',
      'targeted-executable': '请只根据“待测试结论”和下方“选中源码片段”生成一个可执行测试，分别写出前置条件、操作步骤、观察点和预期结果。触发条件与外部观察只可提取和该结论直接相关的内容；忽略其余部分，不得增加可选扩展、其他风险后果或第二个测试。源码不能支持的预期必须标记为“待确认”，不要自行补充其他证据。',
      coverage: '请检查当前对象还缺少哪些测试覆盖，只列出有明确依据的缺口。',
    }

    const styles = {
      root: { height: '100%', overflow: 'auto', boxSizing: 'border-box', color: 'var(--dsw-alias-label-primary, inherit)', background: 'var(--dsw-alias-bg-base, transparent)' },
      sticky: { position: 'sticky', top: 0, zIndex: 5, padding: '15px 14px 0', background: 'var(--dsw-alias-bg-layer-1, #111)', borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.24))' },
      header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
      headerLeft: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 },
      title: { fontSize: 16, fontWeight: 760, letterSpacing: '-0.01em', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      subline: { marginTop: 4, color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 10, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      backButton: { border: 0, background: 'transparent', color: 'var(--dsw-alias-label-secondary, inherit)', padding: '4px 2px', cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' },
      button: { border: '1px solid var(--dsw-alias-border-l2, #555)', background: 'var(--dsw-alias-bg-layer-2, transparent)', color: 'inherit', borderRadius: 6, padding: '5px 8px', cursor: 'pointer', fontSize: 10 },
      primaryButton: { width: '100%', border: '1px solid var(--dsw-alias-state-business-primary, #4d9ad6)', background: 'var(--dsw-alias-state-business-primary, #4d9ad6)', color: 'var(--dsw-alias-label-on-primary, #fff)', borderRadius: 7, padding: '7px 9px', cursor: 'pointer', fontSize: 11, fontWeight: 700 },
      buttonDisabled: { cursor: 'default', opacity: 0.55 },
      nav: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(58px, 1fr))', gap: 0, marginTop: 12, overflowX: 'auto' },
      navButton: { border: 0, borderBottom: '2px solid transparent', background: 'transparent', color: 'var(--dsw-alias-label-tertiary, inherit)', padding: '9px 2px 8px', cursor: 'pointer', fontSize: 10 },
      navActive: { color: 'var(--dsw-alias-label-primary, inherit)', fontWeight: 700, borderBottomColor: 'var(--dsw-alias-state-business-primary, #4d9ad6)' },
      content: { padding: '14px 14px 22px' },
      card: { border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22))', background: 'var(--dsw-alias-bg-layer-1, transparent)', borderRadius: 9, padding: 12, marginBottom: 11 },
      healthOk: { borderColor: 'var(--dsw-alias-state-success-secondary, #4fb8a8)', background: 'var(--dsw-alias-state-success-tertiary, var(--dsw-alias-bg-layer-1, transparent))' },
      healthError: { borderColor: 'var(--dsw-alias-state-error-secondary, #e66767)', background: 'var(--dsw-alias-interactive-bg-hover-danger, var(--dsw-alias-bg-layer-1, transparent))' },
      healthWarning: { borderColor: 'var(--dsw-alias-state-warn-secondary, #c9974f)', background: 'var(--dsw-alias-state-warn-tertiary, var(--dsw-alias-bg-layer-1, transparent))' },
      clickableCard: { width: '100%', textAlign: 'left', color: 'inherit', cursor: 'pointer' },
      label: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 9, fontWeight: 650, letterSpacing: '0.055em' },
      value: { fontSize: 13, fontWeight: 680, lineHeight: 1.45, marginTop: 4, overflowWrap: 'anywhere' },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7, marginTop: 8 },
      metric: { border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.14))', borderRadius: 7, padding: 9, background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08))', color: 'inherit' },
      metricClickable: { cursor: 'pointer', width: '100%', textAlign: 'left' },
      metricNumber: { fontSize: 17, fontWeight: 740, lineHeight: 1.1 },
      metricName: { color: 'var(--dsw-alias-label-secondary, inherit)', fontSize: 10, marginTop: 3 },
      progressTrack: { height: 5, borderRadius: 999, overflow: 'hidden', background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.16))', marginTop: 7 },
      progressFill: { height: '100%', background: 'var(--dsw-alias-state-business-primary, #4d9ad6)' },
      sectionTitle: { fontSize: 13, fontWeight: 760, letterSpacing: '-0.005em', margin: '18px 0 8px' },
      itemTitle: { fontSize: 12, fontWeight: 720, lineHeight: 1.45 },
      itemMeta: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 10, marginTop: 5, lineHeight: 1.55 },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 7 },
      badge: { display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '2px 6px', color: 'var(--dsw-alias-label-secondary, inherit)', fontSize: 9, background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.15))', whiteSpace: 'nowrap' },
      statusRow: { display: 'flex', alignItems: 'center', gap: 6 },
      statusDot: { width: 6, height: 6, flex: '0 0 auto', borderRadius: '50%', background: 'var(--dsw-alias-state-business-primary, #4d9ad6)' },
      chips: { display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 },
      chip: { border: '1px solid var(--dsw-alias-border-l2, #555)', borderRadius: 999, padding: '3px 7px', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 10 },
      search: { width: '100%', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2, #555)', background: 'var(--dsw-alias-bg-layer-2, transparent)', color: 'inherit', borderRadius: 7, padding: '7px 8px', outline: 'none', fontSize: 11, marginBottom: 7 },
      filters: { display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 5, marginBottom: 3 },
      filter: { flex: '0 0 auto', border: '1px solid var(--dsw-alias-border-l2, #555)', borderRadius: 999, background: 'transparent', color: 'inherit', padding: '4px 8px', fontSize: 10, cursor: 'pointer' },
      filterActive: { background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.15))', fontWeight: 700 },
      text: { fontSize: 11, lineHeight: 1.65, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
      list: { margin: '6px 0 0', paddingLeft: 18, fontSize: 11, lineHeight: 1.65 },
      separator: { border: 0, borderTop: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16))', margin: '10px 0' },
      empty: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 11, lineHeight: 1.6 },
      error: { whiteSpace: 'pre-wrap', fontSize: 11, color: 'var(--dsw-alias-state-error-primary, #e66767)' },
      runButton: { width: '100%', textAlign: 'left', border: 0, borderRadius: 7, padding: '7px 8px', marginBottom: 3, cursor: 'pointer', color: 'inherit', background: 'transparent' },
      runActive: { background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1))' },
      toolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 7, flexWrap: 'wrap' },
      formGrid: { display: 'grid', gap: 8, marginTop: 9 },
      textarea: { width: '100%', minHeight: 74, resize: 'vertical', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2, #555)', background: 'var(--dsw-alias-bg-layer-2, transparent)', color: 'inherit', borderRadius: 7, padding: '8px 9px', outline: 'none', fontSize: 11, lineHeight: 1.5 },
      compatibility: { borderLeft: '3px solid var(--dsw-alias-state-business-primary, #4d9ad6)' },
      stageRail: { display: 'grid', gap: 7, marginTop: 8 },
      stageItem: { display: 'grid', gridTemplateColumns: '9px minmax(0, 1fr) auto', gap: 8, alignItems: 'start', borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.13))', paddingBottom: 8 },
      stageDot: { width: 7, height: 7, marginTop: 5, borderRadius: 2, background: 'var(--dsw-alias-state-business-primary, #4d9ad6)' },
      flowStep: { borderLeft: '2px solid var(--dsw-alias-border-l2, #555)', paddingLeft: 9, marginTop: 7 },
      actionCard: { borderColor: 'var(--dsw-alias-state-business-secondary, var(--dsw-alias-border-l2, #555))', background: 'var(--dsw-alias-state-business-tertiary, var(--dsw-alias-bg-layer-1, transparent))' },
      success: { color: 'var(--dsw-alias-state-success-primary, #38a892)', fontSize: 10, lineHeight: 1.5 },
      source: { maxHeight: 200, margin: '9px 0 0', border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16))', borderRadius: 7, overflow: 'auto', background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08))', fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)', fontSize: 10, lineHeight: 1.55 },
      sourceLine: { display: 'flex', minWidth: 'max-content', whiteSpace: 'pre' },
      sourceTarget: { background: 'var(--dsw-alias-state-business-tertiary, rgba(77,154,214,.12))' },
      sourceNumber: { width: 42, flex: '0 0 42px', boxSizing: 'border-box', paddingRight: 9, textAlign: 'right', userSelect: 'none', color: 'var(--dsw-alias-label-tertiary, #888)', borderRight: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.12))' },
      sourceCode: { padding: '0 9px', color: 'var(--dsw-alias-label-primary, inherit)' },
      evidenceTabs: { display: 'flex', gap: 5, overflowX: 'auto', marginTop: 8, paddingBottom: 3 },
      evidenceTab: { flex: '0 0 auto', maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: '1px solid var(--dsw-alias-border-l2, #555)', borderRadius: 6, padding: '4px 7px', background: 'transparent', color: 'var(--dsw-alias-label-secondary, inherit)', cursor: 'pointer', fontSize: 9 },
      evidenceTabActive: { borderColor: 'var(--dsw-alias-state-business-primary, #4d9ad6)', background: 'var(--dsw-alias-state-business-tertiary, rgba(77,154,214,.12))', color: 'var(--dsw-alias-label-primary, inherit)', fontWeight: 700 },
      choiceGrid: { display: 'grid', gap: 6, marginTop: 7 },
      choiceButton: { width: '100%', textAlign: 'left', border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16))', borderRadius: 7, padding: '7px 8px', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 10, lineHeight: 1.45 },
      choiceButtonActive: { borderColor: 'var(--dsw-alias-state-business-primary, #4d9ad6)', background: 'var(--dsw-alias-state-business-tertiary, rgba(77,154,214,.12))' },
      evidenceChecks: { display: 'grid', gap: 5, marginTop: 7 },
      formGrid: { display: 'grid', gap: 7, marginTop: 8 },
      textarea: { width: '100%', minHeight: 86, resize: 'vertical', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2, #555)', background: 'var(--dsw-alias-bg-layer-2, transparent)', color: 'inherit', borderRadius: 7, padding: '7px 8px', outline: 'none', fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)', fontSize: 10 },
      caseSelect: { display: 'flex', alignItems: 'flex-start', gap: 8 },
      caseDetailButton: { flex: 1, minWidth: 0, border: 0, background: 'transparent', color: 'inherit', padding: 0, textAlign: 'left', cursor: 'pointer' },
      evidenceCheck: { display: 'flex', alignItems: 'flex-start', gap: 7, border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16))', borderRadius: 7, padding: '6px 7px', cursor: 'pointer', fontSize: 10, lineHeight: 1.4 },
      evidenceCheckSelected: { borderColor: 'var(--dsw-alias-state-business-primary, #4d9ad6)', background: 'var(--dsw-alias-state-business-tertiary, rgba(77,154,214,.12))' },
      monitorHero: { border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.24))', borderRadius: 10, padding: 14, marginBottom: 12, background: 'var(--dsw-alias-bg-layer-1, transparent)' },
      monitorState: { fontSize: 20, lineHeight: 1.2, fontWeight: 780, letterSpacing: '-0.02em' },
      monitorHint: { marginTop: 6, color: 'var(--dsw-alias-label-secondary, inherit)', fontSize: 10, lineHeight: 1.55 },
      boundary: { borderTop: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16))', paddingTop: 11, marginTop: 11 },
      timeline: { position: 'relative', marginTop: 2 },
      timelineItem: { position: 'relative', padding: '0 0 13px 18px', borderLeft: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.24))', marginLeft: 4 },
      timelineDot: { position: 'absolute', left: -4, top: 4, width: 7, height: 7, borderRadius: '50%', background: 'var(--dsw-alias-state-business-primary, #4d9ad6)', boxShadow: '0 0 0 3px var(--dsw-alias-bg-base, #111)' },
      timelineTime: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 9, fontVariantNumeric: 'tabular-nums' },
      timelineTitle: { marginTop: 2, fontSize: 11, fontWeight: 690, lineHeight: 1.45 },
      timelineDetail: { marginTop: 3, color: 'var(--dsw-alias-label-secondary, inherit)', fontSize: 10, lineHeight: 1.5, overflowWrap: 'anywhere' },
    }

    function icon(size = 16) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      }, h('circle', { cx: 12, cy: 12, r: 8 }), h('path', { d: 'M7.5 12h9M12 7.5v9' }), h('circle', { cx: 12, cy: 12, r: 2.2 }))
    }

    function text(value, fallback = '—') { return typeof value === 'string' && value.trim() !== '' ? value : fallback }
    function hasText(value) { return typeof value === 'string' && value.trim() !== '' }
    function shortId(value) { return hasText(value) ? value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value : '—' }
    function formatTime(value) {
      if (!Number.isFinite(value)) return '时间未知'
      return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    }
    function durationLabel(start, end = Date.now()) {
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return ''
      const seconds = Math.max(0, Math.round((end - start) / 1000))
      if (seconds < 60) return `${seconds} 秒`
      const minutes = Math.floor(seconds / 60)
      return minutes < 60 ? `${minutes} 分 ${seconds % 60} 秒` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`
    }
    function filePathFromLocation(location) {
      if (!hasText(location)) return undefined
      const value = location.trim()
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return undefined
      return value.replace(/#L\d+(?:-L?\d+)?$/i, '').replace(/:\d+(?:-\d+)?$/, '').trim() || undefined
    }
    function evidenceIdentity(item) {
      return [item?.chunk_id ?? '', item?.location ?? '', item?.observation ?? ''].join('\u0000')
    }
    function evidenceTabLabel(item, index) {
      const location = text(item?.location, `证据 ${index + 1}`)
      const filePath = filePathFromLocation(location) ?? location
      const fileName = filePath.split(/[\\/]/).pop() || filePath
      const hashRange = /#L(\d+)(?:-L?(\d+))?$/i.exec(location)
      const colonRange = hashRange === null ? /:(\d+)(?:-(\d+))?$/.exec(location) : null
      const range = hashRange ?? colonRange
      const lineLabel = range ? `:${range[1]}${range[2] ? `–${range[2]}` : ''}` : ''
      return `${index + 1} · ${fileName}${lineLabel}`
    }
    function absoluteWorkspacePath(cwd, value) {
      if (!hasText(value)) return undefined
      if (/^(?:\/|[A-Za-z]:[\\/])/.test(value)) return value
      if (!hasText(cwd)) return value
      const separator = cwd.includes('\\') ? '\\' : '/'
      return `${cwd.replace(/[\\/]+$/, '')}${separator}${value.replace(/^[\\/]+/, '')}`
    }
    function evidenceFilePath(location, cwd, dataRoot) {
      const value = filePathFromLocation(location)
      if (!value) return undefined
      if (/^(?:\/|[A-Za-z]:[\\/])/.test(value)) return value
      const repositoryLocation = value.match(/^([^:/\\]+):(.+)$/)
      if (repositoryLocation && hasText(dataRoot)) {
        const repositoryRoot = absoluteWorkspacePath(dataRoot, `repositories/${repositoryLocation[1]}`)
        return absoluteWorkspacePath(repositoryRoot, repositoryLocation[2])
      }
      return absoluteWorkspacePath(cwd, value)
    }
    function appendConversationDraft(ctx, scope, value) {
      try {
        const actx = ctx?.sessions?.scope?.(scope?.sessionId)
        const conversation = ctx?.get?.('conversation')
        if (!actx || !conversation || !hasText(value)) return false
        const input = conversation.input.for(actx)
        const draft = input.state.getSnapshot().draft
        input.setDraft(hasText(draft) ? `${draft}\n\n${value}` : value)
        return true
      } catch (reason) {
        console.warn('[dsh-pangea-companion] conversation draft insert failed:', reason)
        return false
      }
    }
    function discussionLine(lines, label, value) {
      if (hasText(value)) lines.push(`${label}：${value.trim()}`)
    }
    function discussionList(lines, label, values) {
      const items = Array.isArray(values) ? values.filter(hasText) : []
      if (items.length === 0) return
      lines.push(`${label}：`)
      for (const item of items) lines.push(`- ${item.trim()}`)
    }
    function evidenceLine(item) {
      const location = text(item?.location, '未标注位置')
      return hasText(item?.observation) ? `${location} — ${item.observation.trim()}` : location
    }
    function splitRiskClaims(value) {
      if (!hasText(value)) return []
      return value.trim().split(/(?<=[。！？；;])\s*/).map(item => item.trim()).filter(hasText)
    }
    function buildDiscussionDraft({ kind, item, runId, risks = [], testCases = [], intent = 'review', selectedClaim, sourceSnippet, sourceSnippets = [] }) {
      const lines = [DISCUSSION_INTENTS[intent] ?? DISCUSSION_INTENTS.review, '', '[PANGEA 局部上下文]', `Run：${text(runId, '未知')}`]
      const riskById = new Map(risks.map(risk => [risk.risk_id, risk]))
      const caseById = new Map(testCases.map(testCase => [testCase.test_case_id, testCase]))
      const snippets = [...(Array.isArray(sourceSnippets) ? sourceSnippets : []), ...(sourceSnippet ? [sourceSnippet] : [])].filter(snippet => snippet?.lines?.length)
      const isolatedSourceReview = intent === 'evidence' && snippets.length > 0
      const targetedExecutable = intent === 'targeted-executable' && snippets.length > 0
      const scopedRiskDraft = isolatedSourceReview || targetedExecutable
      if (kind === 'risk') {
        lines.push(`对象：风险 ${text(item?.risk_id, '未编号')}`)
        discussionLine(lines, '标题', item?.title)
        if (scopedRiskDraft) {
          discussionLine(lines, targetedExecutable ? '待测试结论' : '待核对结论', selectedClaim ?? item?.system_result ?? item?.title)
          if (targetedExecutable) {
            discussionLine(lines, '触发条件', item?.trigger)
            discussionLine(lines, '外部观察', item?.external_observation)
          }
        } else {
          discussionLine(lines, '严重度', SEVERITY[item?.severity] ?? item?.severity)
          discussionLine(lines, '触发条件', item?.trigger)
          discussionLine(lines, '系统结果', item?.system_result)
          discussionLine(lines, '外部观察', item?.external_observation)
          discussionLine(lines, '排除条件', item?.exclusion_condition)
          discussionLine(lines, '上游语义结论', item?.upstream_semantics?.conclusion)
          discussionList(lines, '直接证据', (item?.evidence ?? []).map(evidenceLine))
          discussionList(lines, '关联测试用例', (item?.linked_test_case_ids ?? []).map(id => {
            const linked = caseById.get(id)
            return linked ? `${id} ${text(linked.title, '')}`.trim() : id
          }))
        }
      } else if (kind === 'case') {
        lines.push(`对象：测试用例 ${text(item?.test_case_id, '未编号')}`)
        discussionLine(lines, '标题', item?.title)
        discussionLine(lines, '类型', item?.case_type)
        discussionList(lines, '前置条件', item?.preconditions)
        discussionList(lines, '执行步骤', item?.steps)
        discussionList(lines, '预期结果', item?.expected_results)
        discussionList(lines, '观察点', item?.observability)
        discussionList(lines, '清理动作', item?.cleanup)
        discussionList(lines, '关联风险', (item?.linked_risk_ids ?? []).map(id => {
          const linked = riskById.get(id)
          return linked ? `${id} ${text(linked.title, '')}`.trim() : id
        }))
        const linkedEvidence = (item?.linked_risk_ids ?? []).flatMap(id => riskById.get(id)?.evidence ?? [])
        discussionList(lines, '直接关联证据', [...new Set(linkedEvidence.map(evidenceLine))])
      } else {
        lines.push('对象：证据')
        discussionLine(lines, '位置', item?.location)
        if (isolatedSourceReview) {
          discussionLine(lines, '待核对结论', item?.observation)
        } else {
          discussionLine(lines, 'Chunk ID', item?.chunk_id)
          discussionLine(lines, '观察结论', item?.observation)
          discussionList(lines, '关联风险', (item?.risk_ids ?? []).map(id => {
            const linked = riskById.get(id)
            return linked ? `${id} ${text(linked.title, '')}`.trim() : id
          }))
          const linkedCases = new Set((item?.risk_ids ?? []).flatMap(id => riskById.get(id)?.linked_test_case_ids ?? []))
          discussionList(lines, '关联测试用例', [...linkedCases].map(id => {
            const linked = caseById.get(id)
            return linked ? `${id} ${text(linked.title, '')}`.trim() : id
          }))
        }
      }
      for (const [index, snippet] of snippets.entries()) {
        const label = snippets.length > 1 ? `选中源码片段 ${index + 1}/${snippets.length}` : '选中源码片段'
        lines.push('', `${label}：${text(snippet.file_path, text(snippet.location, '未标注文件'))}:${snippet.visible_start}-${snippet.visible_end}`, '```')
        for (const line of snippet.lines) lines.push(`${String(line.number).padStart(5, ' ')} | ${line.text}`)
        lines.push('```')
      }
      lines.push('', isolatedSourceReview
        ? '回答限制：只讨论选中源码片段，不要补充其他证据，也不要重新概括整个 Run。'
        : targetedExecutable
          ? '回答限制：只生成这一个结论对应的单个测试，不要扩展到整条风险、可选场景或其他证据。'
          : '请不要重新概括整个 Run，直接回答上面的问题。')
      return lines.join('\n')
    }
    function field(label, value) {
      return h('div', null, h('div', { style: styles.label }, label), h('div', { style: styles.value }, value ?? '—'))
    }
    function section(title, value) {
      if (!value) return null
      return h('div', { style: styles.card }, h('div', { style: styles.itemTitle }, title), h('div', { style: { ...styles.text, marginTop: 6 } }, value))
    }
    function stringList(title, items, ordered = false) {
      if (!Array.isArray(items) || items.length === 0) return null
      const display = item => item && typeof item === 'object'
        ? `${item.action ?? JSON.stringify(item)}${item.expected_result ? ` → ${item.expected_result}` : ''}`
        : String(item)
      return h('div', { style: styles.card }, h('div', { style: styles.itemTitle }, title), h(ordered ? 'ol' : 'ul', { style: styles.list }, items.map((item, index) => h('li', { key: `${index}:${display(item)}` }, display(item)))))
    }
    function chip(label, onClick) { return h('button', { type: 'button', style: styles.chip, onClick }, label) }
    function navType(screen) {
      if (screen.type === 'risk') return 'risks'
      if (screen.type === 'case') return 'cases'
      if (screen.type === 'evidence-detail') return 'evidence'
      return screen.type
    }

    function PangeaPanel({ ctx, scope, visible, initialScreen = 'overview', pageMode = 'analysis' }) {
      const cwd = scope?.cwd
      const [snapshot, setSnapshot] = React.useState(undefined)
      const [workbench, setWorkbench] = React.useState(undefined)
      const [error, setError] = React.useState(undefined)
      const [workbenchError, setWorkbenchError] = React.useState(undefined)
      const [selectedRun, setSelectedRun] = React.useState(undefined)
      const [loading, setLoading] = React.useState(false)
      const [workbenchLoading, setWorkbenchLoading] = React.useState(false)
      const [runCursor, setRunCursor] = React.useState(0)
      const [screen, setScreen] = React.useState({ type: initialScreen })
      const [history, setHistory] = React.useState([])
      const [riskQuery, setRiskQuery] = React.useState('')
      const [riskSeverity, setRiskSeverity] = React.useState('全部')
      const [caseQuery, setCaseQuery] = React.useState('')
      const [evidenceQuery, setEvidenceQuery] = React.useState('')
      const [actionNotice, setActionNotice] = React.useState(undefined)
      const [sourcePreview, setSourcePreview] = React.useState({ key: '', status: 'idle' })
      const [riskEvidenceSelection, setRiskEvidenceSelection] = React.useState({ riskKey: '', evidenceKey: '' })
      const [riskClaimSelection, setRiskClaimSelection] = React.useState({ riskKey: '', claim: '' })
      const [riskEvidenceSetSelection, setRiskEvidenceSetSelection] = React.useState({ riskKey: '', evidenceKeys: [] })
      const [environments, setEnvironments] = React.useState([])
      const [selectedEnvironment, setSelectedEnvironment] = React.useState('')
      const [selectedCaseIds, setSelectedCaseIds] = React.useState([])
      const [launching, setLaunching] = React.useState(false)
      const [environmentForm, setEnvironmentForm] = React.useState({ id: '', name: '', host_alias: '', array_alias: '', automation_id: '', bindings: '{}' })
      const [createForm, setCreateForm] = React.useState({ repository: '', target: '', source_scope: '', focus: '', asset_ids: '', test_case_examples: '' })
      const [creatingRun, setCreatingRun] = React.useState(false)
      const [pendingStopRun, setPendingStopRun] = React.useState('')
      const [flowQuery, setFlowQuery] = React.useState('')
      const [runDraft, setRunDraft] = React.useState(ctx?.pangea?.getRunDraft?.() ?? { requestId: 0, assetIds: [] })
      const requestRef = React.useRef({ sequence: 0, controller: null })
      const workbenchRequestRef = React.useRef({ sequence: 0, controller: null })
      const handledRunDraftRequest = React.useRef(0)
      const noticeTimerRef = React.useRef(undefined)

      const load = React.useCallback(async () => {
        if (!cwd) {
          requestRef.current.controller?.abort()
          setSnapshot(undefined)
          setError('当前会话没有工作区路径，无法定位 pangea-data。')
          return
        }
        const sequence = ++requestRef.current.sequence
        requestRef.current.controller?.abort()
        const controller = new AbortController()
        requestRef.current.controller = controller
        setLoading(true)
        try {
          const body = await requestSnapshot({ cwd, runId: selectedRun, sessionId: scope?.sessionId, signal: controller.signal })
          if (sequence !== requestRef.current.sequence) return
          setSnapshot(body)
          setError(undefined)
        } catch (reason) {
          if (reason?.name !== 'AbortError' && sequence === requestRef.current.sequence) {
            setError(reason instanceof Error ? reason.message : String(reason))
          }
        } finally {
          if (sequence === requestRef.current.sequence) setLoading(false)
        }
      }, [cwd, selectedRun, scope?.sessionId])

      const loadWorkbench = React.useCallback(async () => {
        if (!cwd || pageMode === 'execution') return
        const sequence = ++workbenchRequestRef.current.sequence
        workbenchRequestRef.current.controller?.abort()
        const controller = new AbortController()
        workbenchRequestRef.current.controller = controller
        setWorkbenchLoading(true)
        try {
          const body = await requestWorkbench({ cwd, cursor: runCursor, limit: 20, signal: controller.signal })
          if (sequence !== workbenchRequestRef.current.sequence) return
          setWorkbench(body)
          setWorkbenchError(undefined)
        } catch (reason) {
          if (reason?.name !== 'AbortError' && sequence === workbenchRequestRef.current.sequence) {
            setWorkbenchError(reason instanceof Error ? reason.message : String(reason))
          }
        } finally {
          if (sequence === workbenchRequestRef.current.sequence) setWorkbenchLoading(false)
        }
      }, [cwd, pageMode, runCursor])

      const loadEnvironments = React.useCallback(async () => {
        try {
          const values = await requestEnvironments()
          setEnvironments(values)
          setSelectedEnvironment(current => values.some(item => item.id === current) ? current : (values[0]?.id ?? ''))
        } catch (reason) {
          setActionNotice({ message: `无法读取执行环境：${reason instanceof Error ? reason.message : String(reason)}`, isError: true })
        }
      }, [])

      React.useEffect(() => { setSelectedRun(undefined); setScreen({ type: initialScreen }); setHistory([]); setSelectedCaseIds([]) }, [cwd, initialScreen])
      React.useEffect(() => () => { if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current) }, [])
      React.useEffect(() => {
        const sync = () => setRunDraft(ctx?.pangea?.getRunDraft?.() ?? { requestId: 0, assetIds: [] })
        sync()
        return ctx?.pangea?.subscribeRunDraft?.(sync)
      }, [ctx?.pangea])
      React.useEffect(() => {
        if (!runDraft?.requestId || runDraft.requestId === handledRunDraftRequest.current) return
        handledRunDraftRequest.current = runDraft.requestId
        setCreateForm(value => ({ ...value, asset_ids: (runDraft.assetIds ?? []).join('\n') }))
        setScreen({ type: 'create' })
        setHistory([])
      }, [runDraft?.requestId])
      React.useEffect(() => {
        const repositories = workbench?.capabilities?.repositories ?? []
        if (repositories.length > 0) setCreateForm(value => value.repository ? value : { ...value, repository: repositories[0] })
      }, [workbench?.capabilities])
      React.useEffect(() => {
        if (!visible) {
          requestRef.current.controller?.abort()
          return undefined
        }
        let stopped = false
        let timer
        const poll = async () => {
          await load()
          if (!stopped) timer = window.setTimeout(() => { void poll() }, 4000)
        }
        void poll()
        return () => {
          stopped = true
          if (timer) window.clearTimeout(timer)
          requestRef.current.controller?.abort()
        }
      }, [load, visible])
      React.useEffect(() => {
        if (!visible || pageMode === 'execution') return undefined
        void loadWorkbench()
        return () => workbenchRequestRef.current.controller?.abort()
      }, [loadWorkbench, pageMode, visible])
      React.useEffect(() => { if (visible) void loadEnvironments() }, [visible, loadEnvironments])

      const current = snapshot?.current
      const monitor = snapshot?.monitor
      const monitoredSession = monitor?.session
      const monitoredRun = monitor?.run
      const health = current?.reader_health
      const details = current?.details ?? { risks: [], test_cases: [], evidence: [], business_flows: [], review_issues: [] }
      const risks = details.risks ?? []
      const testCases = details.test_cases ?? []
      const evidence = details.evidence ?? []
      const businessFlows = details.business_flows ?? []
      const workflow = current?.workflow ?? { units: [], actions: [], error_history: [], quality_checks: [], unresolved: [] }
      const riskById = new Map(risks.map(item => [item.risk_id, item]))
      const caseById = new Map(testCases.map(item => [item.test_case_id, item]))
      const evidenceByKey = new Map(evidence.map(item => [evidenceIdentity(item), item]))
      const riskScreenKey = screen.type === 'risk' ? `${current?.run_id ?? ''}\u0000${screen.id}` : ''
      const riskEvidenceOptions = screen.type === 'risk' ? (riskById.get(screen.id)?.evidence ?? []).filter(item => hasText(item?.location)) : []
      const selectedRiskEvidenceKey = riskEvidenceSelection.riskKey === riskScreenKey ? riskEvidenceSelection.evidenceKey : ''
      const previewEvidence = screen.type === 'risk'
        ? riskEvidenceOptions.find(item => evidenceIdentity(item) === selectedRiskEvidenceKey) ?? riskEvidenceOptions[0]
        : screen.type === 'evidence-detail' ? evidenceByKey.get(screen.key) : undefined
      const previewKey = previewEvidence ? `${current?.run_id ?? ''}\u0000${evidenceIdentity(previewEvidence)}` : ''
      const riskClaims = screen.type === 'risk' ? splitRiskClaims(riskById.get(screen.id)?.system_result) : []
      const selectedRiskClaim = riskClaimSelection.riskKey === riskScreenKey && riskClaims.includes(riskClaimSelection.claim)
        ? riskClaimSelection.claim : riskClaims[0]
      const defaultRiskEvidenceKey = previewEvidence && screen.type === 'risk' ? evidenceIdentity(previewEvidence) : ''
      const selectedRiskEvidenceKeys = riskEvidenceSetSelection.riskKey === riskScreenKey
        ? riskEvidenceSetSelection.evidenceKeys : defaultRiskEvidenceKey ? [defaultRiskEvidenceKey] : []

      React.useEffect(() => {
        if (!visible || !cwd || !snapshot?.data_root || !previewEvidence?.location) {
          setSourcePreview({ key: '', status: 'idle' })
          return undefined
        }
        const controller = new AbortController()
        setSourcePreview({ key: previewKey, status: 'loading' })
        requestSourceSnippet({ cwd, dataRoot: snapshot.data_root, location: previewEvidence.location, signal: controller.signal })
          .then(value => setSourcePreview({ key: previewKey, status: 'ready', value }))
          .catch(reason => {
            if (reason?.name !== 'AbortError') setSourcePreview({ key: previewKey, status: 'error', error: reason instanceof Error ? reason.message : String(reason) })
          })
        return () => controller.abort()
      }, [visible, cwd, snapshot?.data_root, previewKey])

      const navigate = React.useCallback((next) => { setHistory(previous => [...previous, screen]); setScreen(next) }, [screen])
      const jump = React.useCallback((type) => { setScreen({ type }); setHistory([]) }, [])
      const goBack = React.useCallback(() => {
        if (history.length === 0) { setScreen({ type: initialScreen }); return }
        setScreen(history[history.length - 1]); setHistory(history.slice(0, -1))
      }, [history, initialScreen])
      const chooseRun = React.useCallback((runId) => { setSelectedRun(runId); setScreen({ type: initialScreen }); setHistory([]) }, [initialScreen])

      function showActionNotice(message, isError = false) {
        if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
        setActionNotice({ message, isError })
        noticeTimerRef.current = window.setTimeout(() => setActionNotice(undefined), 2600)
      }
      function multilineValues(value) {
        return [...new Set(String(value ?? '').split(/\r?\n/).map(item => item.trim()).filter(Boolean))]
      }
      async function submitNewRun() {
        if (!cwd || creatingRun || workbench?.compatibility?.compatible !== true) return
        setCreatingRun(true)
        try {
          const launched = await requestWorkbenchAction({
            cwd,
            action: 'create',
            payload: {
              input: {
                repository: createForm.repository,
                target: createForm.target,
                source_scope: multilineValues(createForm.source_scope),
                focus: multilineValues(createForm.focus),
                asset_ids: multilineValues(createForm.asset_ids),
                test_case_examples: multilineValues(createForm.test_case_examples),
              },
            },
          })
          ctx?.pangea?.updateRunDraft?.({ assetIds: [] })
          setScreen({ type: 'overview' })
          setHistory([])
          showActionNotice(`已创建分析会话：${launched.session_id}`)
          ctx?.sessions?.open?.(launched.session_id)
          await loadWorkbench()
        } catch (reason) {
          showActionNotice(`创建失败：${reason instanceof Error ? reason.message : String(reason)}`, true)
        } finally {
          setCreatingRun(false)
        }
      }
      async function stopCurrentRun() {
        if (!cwd || !current || current.terminal) return
        try {
          await requestWorkbenchAction({ cwd, action: 'stop', payload: { run_id: current.run_id, data_root: snapshot?.data_root } })
          setPendingStopRun('')
          showActionNotice(`已停止 ${current.run_id}`)
          await Promise.all([load(), loadWorkbench()])
        } catch (reason) {
          showActionNotice(`停止失败：${reason instanceof Error ? reason.message : String(reason)}`, true)
        }
      }
      function toggleCase(testCaseId) {
        setSelectedCaseIds(values => values.includes(testCaseId)
          ? values.filter(value => value !== testCaseId)
          : [...values, testCaseId])
      }
      function editEnvironment(environment) {
        setEnvironmentForm({
          id: environment.id,
          name: environment.name,
          host_alias: environment.host_alias,
          array_alias: environment.array_alias,
          automation_id: environment.automation_id,
          bindings: JSON.stringify(environment.bindings ?? {}, null, 2),
        })
        jump('execution')
      }
      async function submitEnvironment() {
        try {
          const bindings = JSON.parse(environmentForm.bindings || '{}')
          const saved = await saveEnvironment({ ...environmentForm, bindings })
          await loadEnvironments()
          setSelectedEnvironment(saved.id)
          setEnvironmentForm({ id: '', name: '', host_alias: '', array_alias: '', automation_id: '', bindings: '{}' })
          showActionNotice(`执行环境 ${saved.name} 已保存。`)
        } catch (reason) {
          showActionNotice(`保存失败：${reason instanceof Error ? reason.message : String(reason)}`, true)
        }
      }
      async function deleteEnvironment(id) {
        try {
          await removeEnvironment(id)
          await loadEnvironments()
          showActionNotice('执行环境已删除。')
        } catch (reason) {
          showActionNotice(`删除失败：${reason instanceof Error ? reason.message : String(reason)}`, true)
        }
      }
      async function startSelectedCases() {
        if (!current || !snapshot?.data_root || selectedCaseIds.length === 0 || !selectedEnvironment) return
        setLaunching(true)
        try {
          const launched = await launchExecution({
            workspace_id: scope?.workspaceId ?? scope?.workspace?.workspaceId,
            analysis_run_id: current.run_id,
            test_case_ids: selectedCaseIds,
            environment_id: selectedEnvironment,
            data_root: snapshot.data_root,
          })
          showActionNotice(`已启动执行会话：${launched.session_id}`)
          ctx?.sessions?.open?.(launched.session_id)
        } catch (reason) {
          showActionNotice(`启动失败：${reason instanceof Error ? reason.message : String(reason)}`, true)
        } finally {
          setLaunching(false)
        }
      }
      function openSidebarFile(value, title) {
        const path = absoluteWorkspacePath(cwd, value)
        if (!path || !ctx?.pangea?.openFile || !scope?.sessionId) {
          showActionNotice('当前会话无法打开这个文件。', true)
          return
        }
        ctx.pangea.openFile(scope, path, title)
        showActionNotice(`已在侧栏打开 ${title ?? text(value, '文件')}`)
      }
      function addToConversation(kind, item, intent = 'review', sourceSnippet) {
        const draft = buildDiscussionDraft({ kind, item, intent, runId: current?.run_id, risks, testCases, sourceSnippet })
        const inserted = appendConversationDraft(ctx, scope, draft)
        showActionNotice(inserted ? '已加入当前 DSH 会话输入框。' : '无法访问当前 DSH 会话输入框。', !inserted)
      }
      function toggleRiskEvidence(key) {
        const evidenceKeys = selectedRiskEvidenceKeys.includes(key)
          ? selectedRiskEvidenceKeys.filter(item => item !== key)
          : [...selectedRiskEvidenceKeys, key]
        setRiskEvidenceSetSelection({ riskKey: riskScreenKey, evidenceKeys })
        setRiskEvidenceSelection({ riskKey: riskScreenKey, evidenceKey: key })
      }
      async function addRiskSelectionToConversation(risk, intent) {
        const selectedEvidence = riskEvidenceOptions.filter(item => selectedRiskEvidenceKeys.includes(evidenceIdentity(item)))
        if (!selectedRiskClaim || selectedEvidence.length === 0) {
          showActionNotice('请先选择一条结论和至少一条证据。', true)
          return
        }
        showActionNotice(`正在读取 ${selectedEvidence.length} 条证据源码…`)
        try {
          const sourceSnippets = await Promise.all(selectedEvidence.map(item => requestSourceSnippet({
            cwd, dataRoot: snapshot?.data_root, location: item.location,
          })))
          const draft = buildDiscussionDraft({
            kind: 'risk', item: risk, intent, runId: current?.run_id, risks, testCases,
            selectedClaim: selectedRiskClaim, sourceSnippets,
          })
          const inserted = appendConversationDraft(ctx, scope, draft)
          showActionNotice(inserted ? `已加入当前 DSH 会话输入框（${selectedEvidence.length} 条证据）。` : '无法访问当前 DSH 会话输入框。', !inserted)
        } catch (reason) {
          showActionNotice(`无法读取选中证据：${reason instanceof Error ? reason.message : String(reason)}`, true)
        }
      }
      function renderDiscussionCard(kind, item, evidenceSnippet) {
        const secondaryActions = kind === 'risk'
          ? [chip('查找覆盖缺口', () => addToConversation(kind, item, 'coverage'))]
          : [evidenceSnippet ? chip('检查证据', () => addToConversation(kind, item, 'evidence', evidenceSnippet)) : null, chip('转成测试语言', () => addToConversation(kind, item, 'executable')), chip('查找覆盖缺口', () => addToConversation(kind, item, 'coverage'))]
        return h('div', { style: { ...styles.card, ...styles.actionCard } },
          h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, '和 DSH 讨论'), h('span', { style: styles.badge }, '局部上下文')),
          h('div', { style: styles.itemMeta }, '只加入当前对象、直接证据和关联项，不会修改 PANGEA Run。'),
          h('button', { type: 'button', style: { ...styles.primaryButton, marginTop: 9 }, onClick: () => addToConversation(kind, item, 'review') }, '加入当前会话'),
          h('div', { style: styles.chips }, secondaryActions))
      }
      function renderRiskSelectionWorkbench(risk) {
        if (riskClaims.length === 0 || riskEvidenceOptions.length === 0) return null
        const ready = Boolean(selectedRiskClaim && selectedRiskEvidenceKeys.length)
        return h('div', { style: { ...styles.card, ...styles.actionCard } },
          h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, '定向核对与测试'), h('span', { style: styles.badge }, `已选 ${selectedRiskEvidenceKeys.length} 条证据`)),
          h('div', { style: { ...styles.label, marginTop: 9 } }, '选择待核对结论'),
          h('div', { style: styles.choiceGrid, role: 'group', 'aria-label': '选择风险结论' }, riskClaims.map((claim, index) => h('button', {
            key: `${index}:${claim}`, type: 'button', 'aria-pressed': claim === selectedRiskClaim,
            style: { ...styles.choiceButton, ...(claim === selectedRiskClaim ? styles.choiceButtonActive : {}) },
            onClick: () => setRiskClaimSelection({ riskKey: riskScreenKey, claim }),
          }, `${index + 1}. ${claim}`))),
          h('div', { style: { ...styles.label, marginTop: 10 } }, '选择证据'),
          h('div', { style: styles.evidenceChecks, role: 'group', 'aria-label': '选择核对证据' }, riskEvidenceOptions.map((option, index) => {
            const key = evidenceIdentity(option)
            const checked = selectedRiskEvidenceKeys.includes(key)
            return h('label', { key, style: { ...styles.evidenceCheck, ...(checked ? styles.evidenceCheckSelected : {}) } },
              h('input', { type: 'checkbox', checked, 'aria-label': `选择证据 ${evidenceTabLabel(option, index)}`, onChange: () => toggleRiskEvidence(key) }),
              h('span', null, evidenceTabLabel(option, index)))
          })),
          h('div', { style: styles.chips },
            h('button', { type: 'button', disabled: !ready, style: { ...styles.button, ...(!ready ? styles.buttonDisabled : {}) }, onClick: () => { void addRiskSelectionToConversation(risk, 'evidence') } }, '核对选中证据'),
            h('button', { type: 'button', disabled: !ready, style: { ...styles.button, ...(!ready ? styles.buttonDisabled : {}) }, onClick: () => { void addRiskSelectionToConversation(risk, 'targeted-executable') } }, '转成定向测试')))
      }
      function renderSourcePreview(kind, item, evidenceItem, evidenceOptions = []) {
        if (!evidenceItem?.location) return null
        const sourcePath = evidenceFilePath(evidenceItem.location, cwd, snapshot?.data_root)
        const preview = sourcePreview.key === previewKey ? sourcePreview : { status: 'loading' }
        const snippet = preview.status === 'ready' ? preview.value : undefined
        return h('div', { style: styles.card },
          h('div', { style: styles.row },
            h('div', { style: styles.itemTitle }, '源码片段'),
            snippet ? h('span', { style: styles.badge }, `L${snippet.target_start}–${snippet.target_end}`) : null),
          evidenceOptions.length > 1 ? h('div', { style: styles.evidenceTabs, role: 'group', 'aria-label': '选择风险证据源码' }, evidenceOptions.map((option, index) => {
            const key = evidenceIdentity(option)
            const active = key === evidenceIdentity(evidenceItem)
            const label = evidenceTabLabel(option, index)
            return h('button', {
              key, type: 'button', title: option.location, 'aria-pressed': active,
              style: { ...styles.evidenceTab, ...(active ? styles.evidenceTabActive : {}) },
              onClick: () => setRiskEvidenceSelection({ riskKey: riskScreenKey, evidenceKey: key }),
            }, label)
          })) : null,
          h('div', { style: styles.itemMeta }, evidenceItem.location),
          preview.status === 'loading' ? h('div', { style: { ...styles.empty, marginTop: 8 } }, '正在读取证据源码…') : null,
          preview.status === 'error' ? h('div', { style: { ...styles.error, marginTop: 8 } }, `无法预览：${preview.error}`) : null,
          snippet ? h('div', { style: styles.source, role: 'region', 'aria-label': `源码 ${snippet.visible_start} 到 ${snippet.visible_end} 行` },
            snippet.lines.map(line => h('div', { key: line.number, style: { ...styles.sourceLine, ...(line.target ? styles.sourceTarget : {}) } },
              h('span', { style: styles.sourceNumber }, line.number), h('span', { style: styles.sourceCode }, line.text || ' ')))) : null,
          snippet?.truncated ? h('div', { style: styles.itemMeta }, '证据范围较长，当前只显示前 160 行。') : null,
          h('div', { style: styles.chips },
            sourcePath ? chip('打开完整文件', () => openSidebarFile(sourcePath)) : null,
            snippet && kind !== 'risk' ? chip('检查这段源码', () => addToConversation(kind, item, 'evidence', snippet)) : null))
      }

      const total = current?.analysis?.total ?? 0
      const completed = current?.analysis?.completed ?? 0
      const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0
      const activeNav = navType(screen)
      const screenTitle = screen.type === 'overview' ? 'PANGEA 总览'
        : screen.type === 'create' ? '新建分析'
          : screen.type === 'workflow' ? '运行流程'
            : screen.type === 'flows' ? '业务流程'
          : screen.type === 'risks' ? '风险'
          : screen.type === 'risk' ? (riskById.get(screen.id)?.risk_id || '风险详情')
            : screen.type === 'cases' ? '测试用例'
              : screen.type === 'case' ? (caseById.get(screen.id)?.test_case_id || '用例详情')
                : screen.type === 'evidence' ? '证据'
                  : screen.type === 'evidence-detail' ? '证据详情'
                    : screen.type === 'execution' ? '执行环境' : '复核'

      const navigationItems = pageMode === 'execution' ? [] : [
        ['overview', '总览'], ['workflow', '流程'], ['risks', '风险'], ['cases', '用例'], ['flows', '业务流'], ['evidence', '证据'], ['review', '复核'],
      ]
      const navigation = navigationItems.length ? h('nav', { style: styles.nav, 'aria-label': 'PANGEA 分析页面' }, navigationItems.map(([type, label]) => h('button', {
        key: type,
        type: 'button',
        'aria-current': activeNav === type ? 'page' : undefined,
        style: { ...styles.navButton, ...(activeNav === type ? styles.navActive : {}) },
        onClick: () => jump(type),
      }, label))) : null

      const header = h('div', { style: styles.sticky },
        h('div', { style: styles.header },
          h('div', { style: styles.headerLeft },
            !['overview', 'workflow', 'risks', 'cases', 'flows', 'execution', 'evidence', 'review'].includes(screen.type) ? h('button', { type: 'button', style: styles.backButton, onClick: goBack }, '← 返回') : null,
            h('div', { style: { minWidth: 0 } },
              h('div', { style: styles.statusRow }, h('span', { style: styles.statusDot, 'aria-hidden': true }), h('div', { style: styles.title }, screenTitle)),
              h('div', { style: styles.subline }, current ? `${current.run_id} · ${PHASE[current.phase] ?? current.phase}` : 'PANGEA 伴生工作台'))),
          h('div', { style: styles.chips },
            pageMode !== 'execution' && screen.type !== 'create' ? h('button', { type: 'button', disabled: workbench?.compatibility?.compatible !== true, style: { ...styles.button, ...(workbench?.compatibility?.compatible !== true ? styles.buttonDisabled : {}) }, onClick: () => jump('create') }, '新建分析') : null,
            h('button', {
              type: 'button',
              disabled: loading || workbenchLoading,
              'aria-busy': loading || workbenchLoading,
              style: { ...styles.button, ...(loading || workbenchLoading ? styles.buttonDisabled : {}) },
              onClick: () => { void Promise.all([load(), loadWorkbench()]) },
            }, loading || workbenchLoading ? '同步中…' : '刷新'))),
        navigation)

      function countCheck(key) { return health?.count_checks?.[key] }
      function displayCount(key, number) {
        const check = countCheck(key)
        return check?.status === 'mismatch' ? `${number} / 报告 ${check.report}` : String(number ?? 0)
      }
      function metric(number, name, target, countKey) {
        const props = target ? { type: 'button', onClick: () => jump(target), style: { ...styles.metric, ...styles.metricClickable } } : { style: styles.metric }
        return h(target ? 'button' : 'div', props, h('div', { style: styles.metricNumber }, countKey ? displayCount(countKey, number) : String(number ?? 0)), h('div', { style: styles.metricName }, name))
      }
      function collectionEmpty(key, normal) {
        return countCheck(key)?.status === 'mismatch' ? '数据读取异常：当前列表与报告计数不一致，不能把空列表解释为“没有数据”。' : normal
      }
      function healthStyle() {
        if (health?.status === 'error') return { ...styles.card, ...styles.healthError }
        if (health?.status === 'warning') return { ...styles.card, ...styles.healthWarning }
        return { ...styles.card, ...styles.healthOk }
      }
      function renderHealthCard(compact = false) {
        if (!health) return null
        const checks = ['risks', 'test_cases', 'business_flows']
          .map(key => [key, health.count_checks?.[key]])
          .filter(([, check]) => check?.report !== null && check?.report !== undefined)
        const names = { risks: '风险', test_cases: '测试用例', business_flows: '业务流程' }
        return h('div', { style: healthStyle(), role: health.trusted === false ? 'alert' : 'status' },
          h('div', { style: styles.row },
            h('div', { style: styles.itemTitle }, compact && health.trusted === false ? '数据读取异常' : '数据状态'),
            h('span', { style: styles.badge }, HEALTH[health.status] ?? health.status ?? '未知')),
          h('div', { style: styles.itemMeta }, `数据源：${SOURCE[current?.data_source] ?? current?.data_source ?? '未知'}`),
          checks.length ? h('div', { style: { ...styles.itemMeta, marginTop: 5 } }, checks.map(([key, check]) => `${names[key]} ${check.structured}${check.status === 'match' ? ' = ' : ' ≠ '}报告 ${check.report}`).join(' · ')) : null,
          health.trusted === false ? h('div', { style: { ...styles.error, marginTop: 7 } }, '当前结构化结果不可信。尤其当风险/用例显示 0 时，不能解释为“没有风险/用例”。') : null,
          !compact && health.issues?.length ? h('ul', { style: styles.list }, health.issues.map((item, index) => h('li', { key: `${index}:${item}` }, item))) : null)
      }

      function renderMonitor() {
        if (!current) return h('div', { style: styles.monitorHero },
          h('div', { style: styles.monitorState }, '等待 PANGEA Run'),
          h('div', { style: styles.monitorHint }, '当前工作区还没有可关联的 Run。Agent 运行状态会在 Run 出现后自动合并到这里。'))

        const historicalView = Boolean(selectedRun) || Boolean(monitoredRun?.run_id && monitoredSession?.bound_run_id && monitoredRun.run_id !== monitoredSession.bound_run_id)
        const liveForRun = monitoredRun?.session_live === true && !historicalView
        const historicalRun = historicalView || Boolean(monitoredRun && !liveForRun)
        const stateTitle = liveForRun
          ? monitoredSession?.status === 'running' ? 'Agent 运行中' : 'Agent 当前空闲'
          : historicalRun ? '历史运行摘要' : monitoredSession?.status === 'running' ? 'Agent 运行中，等待关联' : '等待运行'
        const stateHint = liveForRun
          ? `当前 DSH 会话已关联 ${current.run_id}，页面每 4 秒同步 PANGEA 产物。`
          : historicalRun
            ? monitoredRun ? '原 DSH 会话可以被删除；这份最小运行摘要与 PANGEA Run 独立保留。' : '这个 Run 早于监控功能或未在当前设备记录；PANGEA 产物仍可完整浏览。'
            : '当前还没有捕获到可显示的运行事件。'
        const activeTools = liveForRun ? monitoredSession?.active_tools ?? [] : []
        const activeSubagents = liveForRun ? monitoredSession?.active_subagents ?? [] : []
        const timeline = monitoredRun?.timeline ?? []

        const stateColor = liveForRun && monitoredSession?.status === 'running'
          ? 'var(--dsw-alias-state-success-primary, #38a892)'
          : 'var(--dsw-alias-label-primary, inherit)'

        return h(React.Fragment, null,
          h('div', { style: styles.monitorHero },
            h('div', { style: styles.row },
              h('div', { style: { ...styles.monitorState, color: stateColor } }, stateTitle),
              h('span', { style: styles.badge }, liveForRun ? '当前会话' : historicalRun ? '历史 Run' : '未关联')),
            h('div', { style: styles.monitorHint }, stateHint),
            h('div', { style: styles.boundary },
              h('div', { style: styles.grid },
                field('DSH 会话', shortId(monitoredRun?.session_id ?? (historicalRun ? null : monitoredSession?.session_id))),
                field('PANGEA Run', current.run_id),
                field('Agent 状态', liveForRun ? monitoredSession.status === 'running' ? '运行中' : '空闲' : monitoredRun ? '会话已结束或已删除' : '原会话未记录'),
                field('PANGEA 阶段', PHASE[current.phase] ?? current.phase)),
              h('div', { style: { ...styles.itemMeta, marginTop: 10 } }, `最近活动：${formatTime(liveForRun ? monitoredSession?.last_activity : monitoredRun?.last_seen ?? current.modified_at)}`))),

          h('div', { style: styles.sectionTitle }, '当前执行'),
          h('div', { style: styles.card },
            h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, '工具调用'), h('span', { style: styles.badge }, `${activeTools.length} 个进行中`)),
            activeTools.length ? h('div', { style: styles.boundary }, activeTools.map(item => h('div', { key: item.key, style: { marginBottom: 8 } },
              h('div', { style: styles.value }, item.title),
              h('div', { style: styles.itemMeta }, `已运行 ${durationLabel(item.time)} · ${formatTime(item.time)}`))))
              : h('div', { style: { ...styles.empty, marginTop: 8 } }, liveForRun ? '当前没有正在执行的工具。' : '历史摘要不保留实时工具状态。'),
            h('div', { style: styles.boundary },
              h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, '子 Agent / 工作流成员'), h('span', { style: styles.badge }, `${activeSubagents.length} 个活动`)),
              activeSubagents.length ? activeSubagents.map(item => h('div', { key: item.key, style: { marginTop: 8 } },
                h('div', { style: styles.value }, item.title), h('div', { style: styles.itemMeta }, item.detail)))
                : h('div', { style: { ...styles.empty, marginTop: 8 } }, '当前没有活动的子 Agent。'))),

          h('div', { style: styles.sectionTitle }, 'PANGEA 进度'),
          h('div', { style: styles.card },
            h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, PHASE[current.phase] ?? current.phase), h('span', { style: styles.badge }, `${completed}/${total}`)),
            h('div', { style: styles.progressTrack }, h('div', { style: { ...styles.progressFill, width: `${percent}%` } })),
            h('div', { style: styles.grid },
              field('已完成分析', `${completed} / ${total}`),
              field('定向补齐单元', current.analysis?.reworked ?? 0),
              field('质量状态', QUALITY[current.quality_status] ?? current.quality_status ?? '待定'),
              field('读取状态', HEALTH[health?.status] ?? health?.status ?? '未知'))),

          h('div', { style: styles.sectionTitle }, `运行时间线（${timeline.length}）`),
          timeline.length ? h('div', { style: { ...styles.card, ...styles.timeline } }, timeline.map((item, index) => {
            const dotColor = item.state === 'error' || item.state === 'failed'
              ? 'var(--dsw-alias-state-error-primary, #e66767)'
              : item.state === 'success' || item.state === 'ended'
                ? 'var(--dsw-alias-state-success-primary, #38a892)'
                : 'var(--dsw-alias-state-business-primary, #4d9ad6)'
            const kind = { agent: 'Agent', tool: '工具', subagent: '子 Agent', worker: '工作流成员', workflow: '工作流', pangea: 'PANGEA', binding: '关联' }[item.kind] ?? '事件'
            return h('div', { key: item.key ?? `${item.kind}:${item.time}:${index}`, style: { ...styles.timelineItem, ...(index === timeline.length - 1 ? { paddingBottom: 0 } : {}) } },
              h('span', { style: { ...styles.timelineDot, background: dotColor }, 'aria-hidden': true }),
              h('div', { style: styles.timelineTime }, `${kind} · ${formatTime(item.time)}${item.ended_at ? ` · ${durationLabel(item.time, item.ended_at)}` : ''}`),
              h('div', { style: styles.timelineTitle }, text(item.title, '未命名事件')),
              item.detail ? h('div', { style: styles.timelineDetail }, item.detail) : null)
          })) : h('div', { style: styles.card }, h('div', { style: styles.empty }, '暂无运行事件。Companion 只记录状态、工具名称和结果，不保存提示词或工具内容。')))
      }

      function renderCompatibility() {
        if (workbenchError) return h('div', { style: { ...styles.card, ...styles.healthError }, role: 'alert' },
          h('div', { style: styles.itemTitle }, '工作台接口读取失败'), h('div', { style: styles.error }, workbenchError))
        if (!workbench || workbench.compatibility?.compatible === true) return null
        return h('div', { style: { ...styles.card, ...styles.healthError }, role: 'alert' },
          h('div', { style: styles.itemTitle }, '当前 PANGEA 后端与工作台不兼容'),
          h('div', { style: styles.itemMeta }, '请切换到提供 assets / runs / system / adapter 稳定接口的 PANGEA 工作区。'),
          h('div', { style: { ...styles.error, marginTop: 7 } }, workbench.compatibility?.error ?? '无法读取后端能力。'))
      }

      function renderCreate() {
        const repositories = workbench?.capabilities?.repositories ?? []
        const compatible = workbench?.compatibility?.compatible === true
        const canSubmit = compatible && createForm.repository && createForm.target.trim() && multilineValues(createForm.source_scope).length > 0 && !creatingRun
        const formField = (label, key, placeholder) => h('label', null,
          h('div', { style: styles.label }, label),
          h('input', { style: { ...styles.search, marginTop: 5, marginBottom: 0 }, value: createForm[key], placeholder, onChange: event => setCreateForm(value => ({ ...value, [key]: event.target.value })) }))
        const formArea = (label, key, placeholder) => h('label', null,
          h('div', { style: styles.label }, label),
          h('textarea', { style: styles.textarea, value: createForm[key], placeholder, onChange: event => setCreateForm(value => ({ ...value, [key]: event.target.value })) }))
        return h(React.Fragment, null,
          renderCompatibility(),
          h('div', { style: { ...styles.card, ...styles.compatibility } },
            h('div', { style: styles.itemTitle }, '分析输入'),
            h('div', { style: styles.itemMeta }, '每行一个源码路径。提交后会创建独立 DSH 会话，由 Agent 按 PANGEA action 契约完成分析。'),
            h('div', { style: styles.formGrid },
              h('label', null, h('div', { style: styles.label }, '仓库'), h('select', { style: { ...styles.search, marginTop: 5, marginBottom: 0 }, value: createForm.repository, onChange: event => setCreateForm(value => ({ ...value, repository: event.target.value })) },
                h('option', { value: '' }, repositories.length ? '选择仓库' : '没有可用仓库'), repositories.map(repository => h('option', { key: repository, value: repository }, repository)))),
              formField('分析目标', 'target', '例如：DHCHAP 认证与恢复路径'),
              formArea('源码范围（必填）', 'source_scope', 'lib/nvmf/auth.c\nlib/nvme/nvme_auth.c'),
              formArea('分析重点', 'focus', '错误路径\n恢复行为\n外部可观测结果'),
              formArea('结构化资产 ID', 'asset_ids', '可从“资产”页勾选后带入'),
              formArea('少量用例示例文件', 'test_case_examples', 'tests/auth_cases.yaml')),
            h('button', { type: 'button', disabled: !canSubmit, style: { ...styles.primaryButton, marginTop: 10, ...(!canSubmit ? styles.buttonDisabled : {}) }, onClick: () => { void submitNewRun() } }, creatingRun ? '正在创建分析会话…' : '创建并开始分析')))
      }

      function renderWorkflow() {
        if (!current) return h('div', { style: styles.card }, h('div', { style: styles.empty }, '选择一个 Run 后查看流程。'))
        const roleLabel = { planning: '规划', analysis: '分析', review: '复核', closure: '定向补齐', reporting: '报告' }
        const statusLabel = { pending: '等待', dispatched: '运行中', settled: '待校验', accepted: '已接收', failed: '失败' }
        return h(React.Fragment, null,
          h('div', { style: styles.card },
            h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, 'Action 生命周期'), h('span', { style: styles.badge }, `${workflow.actions.length} 个 action`)),
            h('div', { style: styles.stageRail }, workflow.actions.length ? workflow.actions.map(action => h('div', { key: action.action_id, style: styles.stageItem },
              h('span', { style: { ...styles.stageDot, background: action.status === 'failed' ? 'var(--dsw-alias-state-error-primary, #e66767)' : action.status === 'accepted' ? 'var(--dsw-alias-state-success-primary, #38a892)' : undefined } }),
              h('div', null, h('div', { style: styles.itemTitle }, `${roleLabel[action.role] ?? action.role} · ${action.stage}`), h('div', { style: styles.itemMeta }, `${action.action_id}${action.task_id ? ` · DSH ${action.task_id}` : ''}`), action.error ? h('div', { style: styles.error }, String(action.error)) : null),
              h('span', { style: styles.badge }, statusLabel[action.status] ?? action.status))) : h('div', { style: styles.empty }, '尚未生成 action。'))),
          h('div', { style: styles.sectionTitle }, `分析单元（${workflow.units.length}）`),
          workflow.units.length ? workflow.units.map(unit => h('details', { key: unit.unit_id, style: styles.card },
            h('summary', { style: { cursor: 'pointer' } }, `${unit.unit_id} · ${unit.title ?? '未命名单元'} · ${unit.status}`),
            h('div', { style: styles.itemMeta }, `源码：${(unit.source_scope ?? []).join('、') || '—'}`),
            h('div', { style: styles.itemMeta }, `上下文：${(unit.context_scope ?? []).join('、') || '—'}`),
            unit.rationale ? h('div', { style: { ...styles.text, marginTop: 8 } }, unit.rationale) : null,
            unit.summary ? h('div', { style: { ...styles.flowStep, ...styles.text } }, unit.summary) : null)) : h('div', { style: styles.card }, h('div', { style: styles.empty }, '规划尚未产生分析单元。')),
          workflow.quality_checks?.length ? stringList('质量门禁', workflow.quality_checks) : null,
          workflow.unresolved?.length ? h('div', { style: { ...styles.card, ...styles.healthWarning } }, h('div', { style: styles.itemTitle }, '未解决事项'), h('pre', { style: styles.text }, JSON.stringify(workflow.unresolved, null, 2))) : null,
          workflow.error_history?.length ? h('div', { style: { ...styles.card, ...styles.healthWarning } }, h('div', { style: styles.itemTitle }, '错误历史'), h('pre', { style: styles.text }, JSON.stringify(workflow.error_history, null, 2))) : null)
      }

      function renderFlows() {
        const query = flowQuery.trim().toLowerCase()
        const filtered = businessFlows.filter(flow => !query || [flow.flow_id, flow.title, flow.description, flow.entry, ...(flow.steps ?? [])].join(' ').toLowerCase().includes(query))
        return h(React.Fragment, null,
          h('input', { style: styles.search, value: flowQuery, 'aria-label': '搜索业务流程', placeholder: '搜索流程名称、入口或步骤…', onChange: event => setFlowQuery(event.target.value) }),
          h('div', { style: styles.itemMeta }, `显示 ${filtered.length} / ${businessFlows.length} 条`),
          filtered.length ? filtered.map(flow => h('details', { key: flow.flow_id ?? flow.title, style: styles.card },
            h('summary', { style: { cursor: 'pointer' } }, `${flow.flow_id ?? 'FLOW'} · ${flow.title ?? '未命名流程'}`),
            flow.description ? h('div', { style: { ...styles.text, marginTop: 8 } }, flow.description) : null,
            flow.entry ? h('div', { style: styles.itemMeta }, `入口：${flow.entry}`) : null,
            stringList('步骤', flow.steps, true),
            Array.isArray(flow.evidence) && flow.evidence.length ? h('div', { style: styles.chips }, flow.evidence.map((item, index) => chip(text(item.location, `证据 ${index + 1}`), () => navigate({ type: 'evidence-detail', key: evidenceIdentity(item) })))) : null,
            flow.mermaid ? h('pre', { style: { ...styles.source, marginTop: 9 } }, flow.mermaid) : null)) : h('div', { style: styles.card }, h('div', { style: styles.empty }, collectionEmpty('business_flows', '当前 Run 没有业务流程。'))))
      }

      function renderOverview() {
        const runItems = workbench?.runs?.items ?? snapshot?.runs ?? []
        if (!current) return h(React.Fragment, null, renderCompatibility(), h('div', { style: styles.card },
          h('div', { style: styles.empty }, '当前还没有可读取的 Run。'),
          workbench?.compatibility?.compatible === true ? h('button', { type: 'button', style: { ...styles.primaryButton, marginTop: 9 }, onClick: () => jump('create') }, '创建第一个分析') : null))
        return h(React.Fragment, null,
          renderCompatibility(),
          renderHealthCard(false),
          h('div', { style: styles.card },
            field('当前任务', current.run_id),
            h('div', { style: { marginTop: 9 } }, field('阶段', PHASE[current.phase] ?? current.phase)),
            h('div', { style: { marginTop: 9 } },
              h('div', { style: styles.row }, h('span', { style: styles.label }, '分析进度'), h('span', { style: styles.label }, `${completed}/${total}`)),
              h('div', { style: styles.progressTrack }, h('div', { style: { ...styles.progressFill, width: `${percent}%` } }))),
            h('div', { style: styles.grid }, field('质量状态', QUALITY[current.quality_status] ?? current.quality_status ?? '待定'), field('复核状态', REVIEW[current.review?.status] ?? current.review?.status ?? '待定'))),
          current.artifacts?.report_html || current.artifacts?.report_md ? h('div', { style: styles.card },
            h('div', { style: styles.itemTitle }, '最终报告'),
            h('div', { style: styles.itemMeta }, '在 Better Sidebar 中直接预览，不会修改报告文件。'),
            h('div', { style: styles.chips },
              current.artifacts.report_html ? chip('打开 HTML 报告', () => openSidebarFile(current.artifacts.report_html, 'PANGEA report.html')) : null,
              current.artifacts.report_md ? chip('打开 Markdown 报告', () => openSidebarFile(current.artifacts.report_md, 'PANGEA report.md')) : null)) : null,
          h('div', { style: styles.grid }, metric(risks.length, '风险', 'risks', 'risks'), metric(testCases.length, '测试用例', 'cases', 'test_cases'), metric(evidence.length, '证据', 'evidence'), metric(details.review_issues?.length ?? 0, '复核问题', 'review')),
          h('div', { style: styles.grid }, metric(details.business_flows?.length ?? current.counts?.business_flows ?? 0, '业务流程', 'flows', 'business_flows'), metric(current.analysis?.reworked ?? 0, '定向补齐单元', 'workflow')),
          !current.terminal ? h('div', { style: { ...styles.card, ...styles.healthWarning } },
            h('div', { style: styles.row }, h('div', null, h('div', { style: styles.itemTitle }, '运行控制'), h('div', { style: styles.itemMeta }, '停止后保留已有产物和运行记录。')),
              pendingStopRun === current.run_id
                ? h('div', { style: styles.chips }, chip('取消', () => setPendingStopRun('')), h('button', { type: 'button', style: { ...styles.button, color: 'var(--dsw-alias-state-error-primary, #e66767)' }, onClick: () => { void stopCurrentRun() } }, '确认停止'))
                : h('button', { type: 'button', style: styles.button, onClick: () => setPendingStopRun(current.run_id) }, '停止 Run'))) : null,
          current.errors?.length ? h(React.Fragment, null, h('div', { style: styles.sectionTitle }, '当前错误'), h('div', { style: { ...styles.card, ...styles.error } }, JSON.stringify(current.errors, null, 2))) : null,
          runItems.length ? h(React.Fragment, null,
            h('div', { style: styles.sectionTitle }, `任务记录（${workbench?.runs?.total ?? runItems.length}）`),
            h('div', { style: styles.card }, runItems.map(run => {
              const active = current.run_id === run.run_id
              return h('button', { type: 'button', key: run.run_id, style: { ...styles.runButton, ...(active ? styles.runActive : {}) }, onClick: () => chooseRun(run.run_id) }, h('div', { style: styles.row }, h('span', { style: { ...styles.itemTitle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: run.run_id }, run.run_id), h('span', { style: styles.badge }, QUALITY[run.quality_status] ?? PHASE[run.phase] ?? run.quality_status ?? run.phase)))
            })),
            h('div', { style: styles.toolbar },
              h('button', { type: 'button', disabled: runCursor <= 0, style: { ...styles.button, ...(runCursor <= 0 ? styles.buttonDisabled : {}) }, onClick: () => setRunCursor(Math.max(0, runCursor - 20)) }, '上一页'),
              h('span', { style: styles.itemMeta }, `${runCursor + 1}–${runCursor + runItems.length}`),
              h('button', { type: 'button', disabled: workbench?.runs?.next_cursor == null, style: { ...styles.button, ...(workbench?.runs?.next_cursor == null ? styles.buttonDisabled : {}) }, onClick: () => setRunCursor(workbench.runs.next_cursor) }, '下一页'))) : null)
      }

      function renderRisks() {
        const query = riskQuery.trim().toLowerCase()
        const filtered = risks.filter(risk => {
          if (riskSeverity !== '全部' && risk.severity !== riskSeverity) return false
          return !query || [risk.risk_id, risk.title, risk.trigger, risk.system_result, ...(risk.dfx ?? [])].join(' ').toLowerCase().includes(query)
        })
        return h(React.Fragment, null,
          h('input', { style: styles.search, value: riskQuery, 'aria-label': '搜索风险', placeholder: '搜索风险编号、标题、触发条件…', onChange: event => setRiskQuery(event.target.value) }),
          h('div', { style: styles.filters }, ['全部', 'Critical', 'High', 'Medium', 'Low'].map(level => h('button', { key: level, type: 'button', style: { ...styles.filter, ...(riskSeverity === level ? styles.filterActive : {}) }, onClick: () => setRiskSeverity(level) }, level === '全部' ? '全部' : SEVERITY[level] ?? level))),
          h('div', { style: styles.itemMeta }, `显示 ${filtered.length} / ${risks.length} 条`),
          h('div', { style: { marginTop: 7 } }, filtered.length ? filtered.map(risk => h('button', { key: `${risk.unit_id}:${risk.risk_id}`, type: 'button', style: { ...styles.card, ...styles.clickableCard }, onClick: () => navigate({ type: 'risk', id: risk.risk_id }) },
            h('div', { style: styles.row }, h('div', { style: { ...styles.itemTitle, minWidth: 0 } }, `${risk.risk_id || '未编号'} · ${text(risk.title, '未命名风险')}`), h('span', { style: styles.badge }, SEVERITY[risk.severity] ?? risk.severity ?? '—')),
            h('div', { style: styles.itemMeta }, `${TRANSLATION[risk.translation_status] ?? risk.translation_status ?? '未标注'} · 置信度 ${CONFIDENCE[risk.confidence] ?? risk.confidence ?? '—'} · ${risk.linked_test_case_ids?.length ?? 0} 条关联用例`))) : h('div', { style: health?.trusted === false ? { ...styles.card, ...styles.healthError } : styles.card }, h('div', { style: health?.trusted === false ? styles.error : styles.empty }, collectionEmpty('risks', '没有符合条件的风险。')))))
      }

      function renderRiskDetail() {
        const risk = riskById.get(screen.id)
        if (!risk) return h('div', { style: styles.card }, h('div', { style: styles.empty }, '当前 Run 中找不到这条风险，可能是 Run 已刷新或切换。'))
        const semantics = risk.upstream_semantics
        return h(React.Fragment, null,
          h('div', { style: styles.card },
            h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, text(risk.title, '未命名风险')), h('span', { style: styles.badge }, SEVERITY[risk.severity] ?? risk.severity ?? '—')),
            h('div', { style: styles.chips }, h('span', { style: styles.badge }, `置信度 ${CONFIDENCE[risk.confidence] ?? risk.confidence ?? '—'}`), h('span', { style: styles.badge }, TRANSLATION[risk.translation_status] ?? risk.translation_status ?? '未标注'), h('span', { style: styles.badge }, RISK_STATUS[risk.status] ?? risk.status ?? '未标注')),
            Array.isArray(risk.dfx) && risk.dfx.length ? h('div', { style: { ...styles.itemMeta, marginTop: 8 } }, `DFX：${risk.dfx.join('、')}`) : null),
          renderDiscussionCard('risk', risk, sourcePreview.key === previewKey && sourcePreview.status === 'ready' ? sourcePreview.value : undefined),
          renderRiskSelectionWorkbench(risk),
          renderSourcePreview('risk', risk, previewEvidence, riskEvidenceOptions),
          section('触发条件', risk.trigger), section('系统结果', risk.system_result), section('外部可观察现象', risk.external_observation), section('排除条件', risk.exclusion_condition),
          semantics ? h('div', { style: styles.card }, h('div', { style: styles.itemTitle }, '上游语义核对'), h('hr', { style: styles.separator }),
            h('div', { style: styles.label }, '入口可达性'), h('div', { style: styles.text }, semantics.reachability),
            h('div', { style: { ...styles.label, marginTop: 7 } }, '调用方限制'), h('div', { style: styles.text }, semantics.caller_constraints),
            h('div', { style: { ...styles.label, marginTop: 7 } }, '规格/文档行为'), h('div', { style: styles.text }, semantics.documented_behavior),
            h('div', { style: { ...styles.label, marginTop: 7 } }, '已有测试'), h('div', { style: styles.text }, semantics.existing_tests),
            h('div', { style: { ...styles.label, marginTop: 7 } }, '结论'), h('div', { style: styles.text }, semantics.conclusion)) : null,
          h('div', { style: styles.card }, h('div', { style: styles.itemTitle }, `证据（${risk.evidence?.length ?? 0}）`), risk.evidence?.length ? h('div', { style: styles.chips }, risk.evidence.map((item, index) => { const key = [item.chunk_id ?? '', item.location ?? '', item.observation ?? ''].join('\u0000'); return chip(text(item.location, `证据 ${index + 1}`), () => navigate({ type: 'evidence-detail', key })) })) : h('div', { style: { ...styles.empty, marginTop: 6 } }, '没有证据。')),
          h('div', { style: styles.card }, h('div', { style: styles.itemTitle }, `关联测试用例（${risk.linked_test_case_ids?.length ?? 0}）`), risk.linked_test_case_ids?.length ? h('div', { style: styles.chips }, risk.linked_test_case_ids.map(id => chip(id, () => navigate({ type: 'case', id })))) : h('div', { style: { ...styles.empty, marginTop: 6 } }, '暂无关联测试用例。')))
      }

      function renderCases() {
        const query = caseQuery.trim().toLowerCase()
        const filtered = testCases.filter(item => !query || [item.test_case_id, item.title, item.case_type, ...(item.linked_risk_ids ?? [])].join(' ').toLowerCase().includes(query))
        const canLaunch = selectedCaseIds.length > 0 && selectedEnvironment && !launching && health?.trusted !== false
        return h(React.Fragment, null,
          h('div', { style: { ...styles.card, ...styles.actionCard } },
            h('div', { style: styles.itemTitle }, '执行选中的黑盒用例'),
            h('div', { style: styles.itemMeta }, '点击一次后创建独立 Executor Run；计划完整时自动进入主机与阵列执行。'),
            h('select', { style: { ...styles.search, marginTop: 8 }, value: selectedEnvironment, onChange: event => setSelectedEnvironment(event.target.value) },
              h('option', { value: '' }, environments.length ? '选择执行环境' : '请先在“执行”页配置环境'),
              environments.map(environment => h('option', { key: environment.id, value: environment.id }, `${environment.name} · ${environment.host_alias} + ${environment.array_alias}`))),
            h('div', { style: styles.row },
              h('div', { style: styles.itemMeta }, `已选 ${selectedCaseIds.length} 条`),
              h('div', { style: styles.chips },
                chip('选择当前列表', () => setSelectedCaseIds([...new Set([...selectedCaseIds, ...filtered.map(item => item.test_case_id)])])),
                chip('清空', () => setSelectedCaseIds([])))),
            h('button', { type: 'button', disabled: !canLaunch, style: { ...styles.primaryButton, marginTop: 9, ...(!canLaunch ? styles.buttonDisabled : {}) }, onClick: () => { void startSelectedCases() } }, launching ? '正在创建执行会话…' : '一键执行')),
          h('input', { style: styles.search, value: caseQuery, 'aria-label': '搜索测试用例', placeholder: '搜索用例编号、标题、类型、关联风险…', onChange: event => setCaseQuery(event.target.value) }),
          h('div', { style: styles.itemMeta }, `显示 ${filtered.length} / ${testCases.length} 条`),
          h('div', { style: { marginTop: 7 } }, filtered.length ? filtered.map(item => h('div', { key: `${item.unit_id}:${item.test_case_id}`, style: styles.card },
            h('div', { style: styles.caseSelect },
              h('input', { type: 'checkbox', checked: selectedCaseIds.includes(item.test_case_id), 'aria-label': `选择 ${item.test_case_id}`, onChange: () => toggleCase(item.test_case_id) }),
              h('button', { type: 'button', style: styles.caseDetailButton, onClick: () => navigate({ type: 'case', id: item.test_case_id }) },
                h('div', { style: styles.itemTitle }, `${item.test_case_id || '未编号'} · ${text(item.title, '未命名用例')}`),
                h('div', { style: styles.itemMeta }, `${text(item.case_type, '未标注类型')} · ${item.linked_risk_ids?.length ?? 0} 条关联风险 · ${text(item.status, 'draft')}`))))) : h('div', { style: health?.trusted === false ? { ...styles.card, ...styles.healthError } : styles.card }, h('div', { style: health?.trusted === false ? styles.error : styles.empty }, collectionEmpty('test_cases', '没有符合条件的测试用例。')))))
      }

      function renderExecution() {
        const executorRuns = snapshot?.executor_runs ?? []
        const formInput = (fieldName, placeholder) => h('input', {
          style: { ...styles.search, marginBottom: 0 }, value: environmentForm[fieldName], placeholder,
          onChange: event => setEnvironmentForm(value => ({ ...value, [fieldName]: event.target.value })),
        })
        return h(React.Fragment, null,
          h('div', { style: styles.card },
            h('div', { style: styles.itemTitle }, `当前分析的执行记录（${executorRuns.length}）`),
            executorRuns.length ? h('div', { style: { marginTop: 8 } }, executorRuns.map(run => h('div', { key: run.executor_run_id, style: { ...styles.card, marginBottom: 7 } },
              h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, run.executor_run_id), h('span', { style: styles.badge }, run.result_status ?? run.phase)),
              h('div', { style: styles.itemMeta }, `${run.selected_test_case_ids.length} 条用例 · ${run.environment_id} · ${run.automation_id}`),
              run.unresolved?.length ? h('div', { style: { ...styles.error, marginTop: 6 } }, run.unresolved.join('；')) : null,
              h('div', { style: styles.chips }, run.artifacts?.plan ? chip('查看执行计划', () => openSidebarFile(run.artifacts.plan, 'PANGEA executable plan')) : null, run.artifacts?.result ? chip('查看执行结果', () => openSidebarFile(run.artifacts.result, 'PANGEA execution result')) : null)))) : h('div', { style: { ...styles.empty, marginTop: 8 } }, '当前分析还没有执行记录。')),
          h('div', { style: styles.card },
            h('div', { style: styles.itemTitle }, '执行环境'),
            h('div', { style: styles.itemMeta }, 'SSH 密码和主机连接仍在 dsh-ssh 中维护；这里仅保存主机/阵列 alias、自动化仓库和设备绑定。'),
            environments.length ? h('div', { style: { marginTop: 8 } }, environments.map(environment => h('div', { key: environment.id, style: { ...styles.card, marginBottom: 7 } },
              h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, environment.name), h('span', { style: styles.badge }, environment.id)),
              h('div', { style: styles.itemMeta }, `主机 ${environment.host_alias} · 阵列 ${environment.array_alias} · 自动化 ${environment.automation_id}`),
              h('div', { style: styles.chips }, chip('编辑', () => editEnvironment(environment)), chip('删除', () => { void deleteEnvironment(environment.id) }))))) : h('div', { style: { ...styles.empty, marginTop: 8 } }, '还没有执行环境。')),
          h('div', { style: styles.card },
            h('div', { style: styles.itemTitle }, environmentForm.id ? '编辑环境' : '新增环境'),
            h('div', { style: styles.formGrid },
              formInput('id', '环境 ID，例如 lab-a'),
              formInput('name', '环境名称'),
              formInput('host_alias', 'dsh-ssh 主机 alias'),
              formInput('array_alias', 'dsh-ssh 阵列 alias'),
              formInput('automation_id', 'pangea-data/test-automation 下的目录名'),
              h('textarea', { style: styles.textarea, value: environmentForm.bindings, 'aria-label': '设备绑定 JSON', placeholder: '{"portal":"10.0.0.2","iqn":"...","attach_target":"xx"}', onChange: event => setEnvironmentForm(value => ({ ...value, bindings: event.target.value })) }),
              h('button', { type: 'button', style: styles.primaryButton, onClick: () => { void submitEnvironment() } }, '保存执行环境'))))
      }

      function renderCaseDetail() {
        const item = caseById.get(screen.id)
        if (!item) return h('div', { style: styles.card }, h('div', { style: styles.empty }, '当前 Run 中找不到这条测试用例，可能是 Run 已刷新或切换。'))
        return h(React.Fragment, null,
          h('div', { style: styles.card }, h('div', { style: styles.itemTitle }, text(item.title, '未命名用例')), h('div', { style: styles.chips }, h('span', { style: styles.badge }, text(item.case_type, '未标注类型')), h('span', { style: styles.badge }, text(item.status, 'draft')))),
          renderDiscussionCard('case', item),
          h('div', { style: styles.card }, h('div', { style: styles.itemTitle }, `关联风险（${item.linked_risk_ids?.length ?? 0}）`), item.linked_risk_ids?.length ? h('div', { style: styles.chips }, item.linked_risk_ids.map(id => chip(id, () => navigate({ type: 'risk', id })))) : h('div', { style: { ...styles.empty, marginTop: 6 } }, '暂无关联风险。')),
          stringList('前置条件', item.preconditions), stringList('执行步骤', item.steps, true), stringList('预期结果', item.expected_results, true), stringList('观察点', item.observability), stringList('清理动作', item.cleanup))
      }

      function renderEvidence() {
        const query = evidenceQuery.trim().toLowerCase()
        const filtered = evidence.filter(item => !query || [item.chunk_id, item.location, item.observation, ...(item.risk_ids ?? [])].join(' ').toLowerCase().includes(query))
        return h(React.Fragment, null,
          h('input', { style: styles.search, value: evidenceQuery, 'aria-label': '搜索证据', placeholder: '搜索文件位置、观察结论、关联风险…', onChange: event => setEvidenceQuery(event.target.value) }),
          h('div', { style: styles.itemMeta }, `显示 ${filtered.length} / ${evidence.length} 条`),
          h('div', { style: { marginTop: 7 } }, filtered.length ? filtered.map((item, index) => { const key = [item.chunk_id, item.location, item.observation].join('\u0000'); return h('button', { key: `${key}:${index}`, type: 'button', style: { ...styles.card, ...styles.clickableCard }, onClick: () => navigate({ type: 'evidence-detail', key }) }, h('div', { style: styles.itemTitle }, text(item.location, '未标注位置')), h('div', { style: styles.itemMeta }, text(item.observation, '无观察结论')), item.risk_ids?.length ? h('div', { style: styles.chips }, item.risk_ids.slice(0, 4).map(id => h('span', { key: id, style: styles.badge }, id))) : null) }) : h('div', { style: styles.card }, h('div', { style: styles.empty }, '没有符合条件的证据。'))))
      }

      function renderEvidenceDetail() {
        const item = evidenceByKey.get(screen.key)
        if (!item) return h('div', { style: styles.card }, h('div', { style: styles.empty }, '当前 Run 中找不到这条证据，可能是 Run 已刷新或切换。'))
        return h(React.Fragment, null,
          h('div', { style: styles.card }, field('源码/资料位置', text(item.location, '未标注')), h('div', { style: { marginTop: 9 } }, field('Chunk ID', text(item.chunk_id, '未标注')))),
          renderDiscussionCard('evidence', item, sourcePreview.key === previewKey && sourcePreview.status === 'ready' ? sourcePreview.value : undefined),
          renderSourcePreview('evidence', item, item),
          section('观察结论', item.observation),
          h('div', { style: styles.card }, h('div', { style: styles.itemTitle }, `关联风险（${item.risk_ids?.length ?? 0}）`), item.risk_ids?.length ? h('div', { style: styles.chips }, item.risk_ids.map(id => chip(id, () => navigate({ type: 'risk', id })))) : h('div', { style: { ...styles.empty, marginTop: 6 } }, '这条证据没有直接绑定风险。')))
      }

      function renderReview() {
        const review = current?.review
        if (!review) return h('div', { style: styles.card }, h('div', { style: styles.empty }, '当前 Run 还没有复核结果。'))
        const comparisonDecisions = review.comparison?.decisions ?? []
        const comparisonDetails = review.comparison ? h('details', { style: styles.card, open: true },
          h('summary', { style: { cursor: 'pointer', fontWeight: 700 } }, '对照复核'),
          review.comparison.summary ? h('div', { style: { ...styles.text, marginTop: 8 } }, review.comparison.summary) : null,
          comparisonDecisions.length ? h('div', { style: styles.stageRail }, comparisonDecisions.map(decision => h('div', { key: decision.finding_key, style: styles.stageItem },
            h('span', { style: { ...styles.stageDot, background: decision.disposition === 'dismissed' ? 'var(--dsw-alias-label-tertiary, #888)' : 'var(--dsw-alias-state-warn-primary, #c9974f)' } }),
            h('div', null,
              h('div', { style: styles.itemTitle }, decision.finding_key),
              decision.conclusion ? h('div', { style: styles.itemMeta }, decision.conclusion) : null),
            h('span', { style: styles.badge }, decision.disposition === 'dismissed' ? '已驳回' : decision.disposition)))) : null) : null
        return h(React.Fragment, null,
          h('div', { style: styles.card },
            field('最终复核状态', REVIEW[review.status] ?? QUALITY[review.status] ?? review.status ?? '待定'),
            h('div', { style: styles.grid },
              field('独立发现', review.counts?.independent ?? 0),
              field('对照驳回', review.counts?.dismissed ?? 0),
              field('对照确认', review.counts?.confirmed ?? 0),
              field('最终有效', review.counts?.effective ?? details.review_issues?.length ?? 0)),
            review.summary ? h('div', { style: { ...styles.text, marginTop: 9 } }, review.summary) : null),
          review.independent ? h('details', { style: styles.card }, h('summary', { style: { cursor: 'pointer', fontWeight: 700 } }, '独立复核'), review.independent.summary ? h('div', { style: { ...styles.text, marginTop: 8 } }, review.independent.summary) : null, h('div', { style: styles.itemMeta }, `${review.independent.findings?.length ?? 0} 条原始发现`)) : null,
          comparisonDetails,
          h('div', { style: styles.sectionTitle }, `最终有效复核问题（${details.review_issues?.length ?? 0}）`),
          details.review_issues?.length ? details.review_issues.map(issue => h('div', { key: issue.issue_id ?? JSON.stringify(issue), style: styles.card }, h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, issue.issue_id ?? '未编号问题'), issue.unit_id ? h('span', { style: styles.badge }, issue.unit_id) : null), issue.reason ? h(React.Fragment, null, h('div', { style: { ...styles.label, marginTop: 8 } }, '原因'), h('div', { style: styles.text }, issue.reason)) : null, issue.required_change ? h(React.Fragment, null, h('div', { style: { ...styles.label, marginTop: 8 } }, '要求修改'), h('div', { style: styles.text }, issue.required_change)) : null)) : h('div', { style: styles.card }, h('div', { style: styles.empty }, '没有待处理的复核问题。')))
      }

      let body
      if (screen.type === 'overview') body = renderOverview()
      else if (screen.type === 'create') body = renderCreate()
      else if (screen.type === 'workflow') body = renderWorkflow()
      else if (screen.type === 'risks') body = renderRisks()
      else if (screen.type === 'risk') body = renderRiskDetail()
      else if (screen.type === 'cases') body = renderCases()
      else if (screen.type === 'case') body = renderCaseDetail()
      else if (screen.type === 'execution') body = renderExecution()
      else if (screen.type === 'flows') body = renderFlows()
      else if (screen.type === 'evidence') body = renderEvidence()
      else if (screen.type === 'evidence-detail') body = renderEvidenceDetail()
      else body = renderReview()

      const healthAlert = !['overview'].includes(screen.type) && health?.trusted === false ? renderHealthCard(true) : null
      const errorNotice = error ? h('div', { style: { ...styles.card, ...styles.healthError }, role: 'alert' },
        h('div', { style: styles.itemTitle }, snapshot ? '同步失败，继续显示上次结果' : '无法读取 PANGEA 数据'),
        h('div', { style: { ...styles.error, marginTop: 6 } }, error),
        h('button', { type: 'button', style: { ...styles.button, marginTop: 8 }, onClick: () => { void load() } }, '重试')) : null
      const requiresSnapshot = !['create', 'execution'].includes(screen.type)
      const initialLoading = requiresSnapshot && loading && snapshot === undefined
      const contentBody = initialLoading
        ? h('div', { style: styles.card, role: 'status' }, h('div', { style: styles.empty }, '正在读取当前 Run…'))
        : requiresSnapshot && snapshot === undefined && error && workbench?.compatibility?.compatible !== false ? null : h(React.Fragment, null, healthAlert, body)
      const actionFeedback = actionNotice ? h('div', { style: { ...styles.card, ...(actionNotice.isError ? styles.healthError : styles.healthOk) }, role: actionNotice.isError ? 'alert' : 'status' }, h('div', { style: actionNotice.isError ? styles.error : styles.success }, actionNotice.message)) : null
      return h('div', { style: styles.root, role: 'region', 'aria-label': 'PANGEA 伴生工作台' }, header, h('div', { style: styles.content }, actionFeedback, errorNotice, contentBody))
    }

    function apply(ctx) {
      const pangea = ctx.pangea
      if (!pangea) return
      ctx.effect(() => pangea.registerPage({
        id: 'analysis', title: () => '分析', icon, order: 10,
        available: (_ctx, scope) => Boolean(scope?.cwd),
        component: props => h(PangeaPanel, { ...props, ctx, initialScreen: 'overview', pageMode: 'analysis' }),
      }), 'dsh-pangea-companion: analysis page')
      ctx.effect(() => pangea.registerPage({
        id: 'execution', title: () => '执行', icon, order: 20,
        available: (_ctx, scope) => Boolean(scope?.cwd),
        component: props => h(PangeaPanel, { ...props, ctx, initialScreen: 'execution', pageMode: 'execution' }),
      }), 'dsh-pangea-companion: execution page')
    }

    exports.inject = inject
    exports.requestSnapshot = requestSnapshot
    exports.requestSourceSnippet = requestSourceSnippet
    exports.requestEnvironments = requestEnvironments
    exports.saveEnvironment = saveEnvironment
    exports.removeEnvironment = removeEnvironment
    exports.launchExecution = launchExecution
    exports.requestWorkbench = requestWorkbench
    exports.requestWorkbenchAction = requestWorkbenchAction
    exports.filePathFromLocation = filePathFromLocation
    exports.evidenceIdentity = evidenceIdentity
    exports.evidenceTabLabel = evidenceTabLabel
    exports.absoluteWorkspacePath = absoluteWorkspacePath
    exports.evidenceFilePath = evidenceFilePath
    exports.appendConversationDraft = appendConversationDraft
    exports.splitRiskClaims = splitRiskClaims
    exports.buildDiscussionDraft = buildDiscussionDraft
    exports.apply = apply
    return module.exports
  },
})
