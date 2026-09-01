// PANGEA Run detail enhancement. Keep the existing companion page as the source of truth
// and add workflow/worker facts directly inside its native "运行细节" view.
window.__ModuleLoader__.load({
  id: 'dsh-pangea-run-ui',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const inject = ['pangea']
    const API_PATH = '/api/pangea-run-ui/outputs'
    const STYLE_ID = 'dsh-pangea-run-ui-native-style'
    const OVERVIEW_ID = 'pangea-run-native-workflow-overview'
    const UNIT_DIAGNOSTIC_CLASS = 'pangea-run-unit-diagnostic'
    const creationThrottle = new Map()

    let runContext = null
    let output = null
    let controller = null
    let timer = null
    let syncQueued = false

    const STAGE_LABELS = {
      preparing: '准备',
      planning: '规划',
      analyzing: '分析',
      reviewing: '独立复核',
      closing: '定向补齐',
      reporting: '生成报告',
      complete: '完成',
    }

    const ACTION_STATUS = {
      pending: '待派发',
      dispatched: '运行中',
      settled: '待校验',
      accepted: '已完成',
      failed: '失败',
      attention_required: '需要处理',
    }

    const RESULT_STATUS = {
      skeleton: '仍为骨架',
      written: '已写入',
      accepted: '已校验',
      missing: '结果文件缺失',
      invalid_json: '结果 JSON 不可读',
      unknown: '未知',
    }

    function installStyles() {
      if (document.getElementById(STYLE_ID)) return () => {}
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = `
        @keyframes pangeaNativeStagePulse {
          0% { box-shadow:0 0 0 0 rgba(47,122,203,.34); }
          65% { box-shadow:0 0 0 7px rgba(47,122,203,0); }
          100% { box-shadow:0 0 0 0 rgba(47,122,203,0); }
        }
        body[data-pangea-product-shell] [data-pangea-assistant-icon],
        body[data-pangea-product-shell] [data-pangea-assistant-progress],
        body[data-pangea-product-shell] [data-pangea-assistant-card] > :last-child { display:none!important; }
        body[data-pangea-product-shell] [data-pangea-assistant-card] {
          height:auto!important; min-height:0!important; display:block!important;
          padding:10px 0 4px!important; border:0!important; border-radius:0!important;
          background:transparent!important; box-shadow:none!important;
        }
        body[data-pangea-product-shell] [data-pangea-assistant-actions] {
          display:grid!important; grid-template-columns:minmax(0,1fr) auto; gap:8px!important; align-items:center;
        }
        body[data-pangea-product-shell] [data-pangea-assistant-actions]::after {
          content:'独立会话 · 不影响正在运行的分析'; grid-column:1/-1;
          color:#7a828d; font-size:11px; line-height:16px;
        }

        #${OVERVIEW_ID} {
          box-sizing:border-box; margin:0 0 12px; padding:13px 14px;
          border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22));
          border-radius:9px; background:var(--dsw-alias-bg-layer-1, #fff); color:inherit;
          font-family:inherit;
        }
        #${OVERVIEW_ID} .pangea-native-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:11px; }
        #${OVERVIEW_ID} .pangea-native-title { font-size:14px; font-weight:700; }
        #${OVERVIEW_ID} .pangea-native-current { font-size:12px; font-weight:650; color:#2f7acb; }
        #${OVERVIEW_ID} .pangea-native-current.is-warning { color:#d97706; }
        #${OVERVIEW_ID} .pangea-native-current.is-failed { color:#c7000b; }
        #${OVERVIEW_ID} .pangea-native-rail { display:flex; align-items:center; min-width:max-content; padding:5px 2px 3px; }
        #${OVERVIEW_ID} .pangea-native-scroll { overflow-x:auto; }
        #${OVERVIEW_ID} .pangea-native-stage { display:flex; align-items:center; gap:7px; min-width:82px; font-size:12px; color:#7a818b; white-space:nowrap; }
        #${OVERVIEW_ID} .pangea-native-stage.is-active { color:#17191d; font-weight:700; }
        #${OVERVIEW_ID} .pangea-native-dot { width:11px; height:11px; flex:0 0 auto; border:2px solid #c7ccd3; border-radius:50%; background:#fff; box-sizing:border-box; }
        #${OVERVIEW_ID} .is-done .pangea-native-dot { border-color:#2da44e; background:#2da44e; }
        #${OVERVIEW_ID} .is-active .pangea-native-dot { border-color:#2f7acb; background:#2f7acb; animation:pangeaNativeStagePulse 1.55s ease-out infinite; }
        #${OVERVIEW_ID} .is-warning .pangea-native-dot { border-color:#d97706; background:#d97706; }
        #${OVERVIEW_ID} .is-failed .pangea-native-dot { border-color:#c7000b; background:#c7000b; }
        #${OVERVIEW_ID} .is-stopped .pangea-native-dot { border-color:#8a929d; background:#8a929d; }
        #${OVERVIEW_ID} .pangea-native-line { width:30px; height:1px; margin:0 5px; flex:0 0 auto; background:#d9dde3; }
        #${OVERVIEW_ID} .pangea-native-line.is-done { background:#8fcaa0; }

        .${UNIT_DIAGNOSTIC_CLASS} { margin:10px 0 2px; padding:10px 11px; border-radius:7px; background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.07)); }
        .${UNIT_DIAGNOSTIC_CLASS} .pangea-unit-runtime-head { display:flex; align-items:center; justify-content:space-between; gap:10px; }
        .${UNIT_DIAGNOSTIC_CLASS} .pangea-unit-runtime-title { font-size:12px; font-weight:700; }
        .${UNIT_DIAGNOSTIC_CLASS} .pangea-unit-runtime-state { font-size:12px; font-weight:650; color:#2f7acb; }
        .${UNIT_DIAGNOSTIC_CLASS} .pangea-unit-runtime-state.is-warning { color:#d97706; }
        .${UNIT_DIAGNOSTIC_CLASS} .pangea-unit-runtime-state.is-failed { color:#c7000b; }
        .${UNIT_DIAGNOSTIC_CLASS} .pangea-unit-runtime-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px 12px; margin-top:8px; font-size:12px; line-height:1.5; }
        .${UNIT_DIAGNOSTIC_CLASS} .pangea-unit-runtime-muted { color:#6f7782; }
        .${UNIT_DIAGNOSTIC_CLASS} .pangea-unit-runtime-activities { margin-top:8px; padding-top:7px; border-top:1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.12)); }
        .${UNIT_DIAGNOSTIC_CLASS} .pangea-unit-runtime-activity { margin-top:3px; color:#69717c; font-size:11px; line-height:1.45; overflow-wrap:anywhere; }
        .${UNIT_DIAGNOSTIC_CLASS} details { margin-top:8px; }
        .${UNIT_DIAGNOSTIC_CLASS} summary { cursor:pointer; font-size:12px; color:#59616c; }
        .${UNIT_DIAGNOSTIC_CLASS} pre { max-height:320px; overflow:auto; margin:7px 0 0; padding:9px; border-radius:6px; background:#f6f7f9; font-size:11px; line-height:1.45; white-space:pre-wrap; overflow-wrap:anywhere; }
      `
      document.head.appendChild(style)
      return () => style.remove()
    }

    function activeConversation(context) {
      const conversations = Array.isArray(context?.conversations) ? context.conversations : []
      return conversations.find(item => item.conversation_id === context?.activeConversationId) ?? null
    }

    function ensureAssistantConversation(context) {
      if (!context?.taskId) return
      const conversations = Array.isArray(context.conversations) ? context.conversations : []
      const active = activeConversation(context)
      if (active && active.kind !== 'analysis') return
      const assistant = [...conversations].reverse().find(item => item.kind !== 'analysis')
      if (assistant?.conversation_id) {
        context.onSelectConversation?.(assistant.conversation_id)
        return
      }
      const lastCreate = creationThrottle.get(context.taskId) ?? 0
      if (Date.now() - lastCreate < 5000) return
      creationThrottle.set(context.taskId, Date.now())
      context.onCreateConversation?.()
    }

    function protectAssistantSelect(context) {
      const analysisIds = new Set((context?.conversations ?? []).filter(item => item.kind === 'analysis').map(item => item.conversation_id))
      for (const select of document.querySelectorAll('[data-pangea-assistant-select]')) {
        select.setAttribute('aria-label', '切换 AI 助手会话')
        for (const option of select.options ?? []) {
          const blocked = analysisIds.has(option.value)
          option.disabled = blocked
          option.hidden = blocked
        }
      }
    }

    async function requestOutputs(runId, signal) {
      const response = await fetch(`${API_PATH}?${new URLSearchParams({ run_id: runId })}`, { cache: 'no-store', signal })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    function stageNames(value) {
      return ['准备', '规划', '分析', '独立复核', ...(value?.has_rework ? ['定向补齐', '再复核'] : []), '生成报告', '完成']
    }

    function stageIndex(value) {
      const stage = String(value?.progress?.stage ?? '').toLowerCase()
      const rework = value?.has_rework === true
      const map = {
        preparing: 0,
        planning: 1,
        analyzing: 2,
        reviewing: rework ? 5 : 3,
        closing: 4,
        reporting: rework ? 6 : 4,
        complete: rework ? 7 : 5,
      }
      return Number.isInteger(map[stage]) ? map[stage] : -1
    }

    function currentStageRole(value) {
      return { planning: 'planning', analyzing: 'analysis', reviewing: 'review', closing: 'closure', reporting: 'reporting' }[String(value?.progress?.stage ?? '').toLowerCase()] ?? null
    }

    function currentTone(value) {
      const lifecycle = String(value?.progress?.lifecycle_status ?? '').toLowerCase()
      if (lifecycle === 'failed') return 'failed'
      if (lifecycle === 'stopped') return 'stopped'
      if (value?.progress?.attention_required === true || lifecycle === 'attention_required' || lifecycle === 'incomplete') return 'warning'
      const role = currentStageRole(value)
      const actions = (value?.progress?.actions ?? []).filter(item => item?.role === role)
      if (actions.some(item => String(item?.status ?? '').toLowerCase() === 'failed')) return 'failed'
      if (actions.some(item => String(item?.status ?? '').toLowerCase() === 'attention_required')) return 'warning'
      return 'active'
    }

    function stageTone(value, index, active) {
      const lifecycle = String(value?.progress?.lifecycle_status ?? '').toLowerCase()
      const complete = String(value?.progress?.stage ?? '').toLowerCase() === 'complete' || lifecycle === 'completed'
      if (complete || index < active) return 'done'
      if (index !== active) return 'pending'
      return currentTone(value)
    }

    function make(tag, className, text) {
      const node = document.createElement(tag)
      if (className) node.className = className
      if (text !== undefined && text !== null) node.textContent = String(text)
      return node
    }

    function leafByText(predicate) {
      for (const node of document.querySelectorAll('[data-pangea-page="analysis"] div, [data-pangea-page="analysis"] span')) {
        if (node.childElementCount !== 0) continue
        const text = node.textContent?.trim() ?? ''
        if (predicate(text)) return node
      }
      return null
    }

    function actionLifecycleCard() {
      const heading = leafByText(text => text === 'Action 生命周期')
      if (!heading) return null
      const row = heading.parentElement
      const card = row?.parentElement
      return card?.parentElement ? card : null
    }

    function unitSectionHeading() {
      return leafByText(text => /^分析单元（\d+）$/.test(text))
    }

    function renderOverview(value) {
      const card = make('section')
      card.id = OVERVIEW_ID
      const head = make('div', 'pangea-native-head')
      head.appendChild(make('div', 'pangea-native-title', '完整流程'))
      const stageKey = String(value?.progress?.stage ?? '').toLowerCase()
      const current = make('div', `pangea-native-current is-${currentTone(value)}`, `当前阶段：${STAGE_LABELS[stageKey] ?? stageKey ?? '未知'}`)
      head.appendChild(current)
      card.appendChild(head)

      const scroll = make('div', 'pangea-native-scroll')
      const rail = make('div', 'pangea-native-rail')
      const active = stageIndex(value)
      stageNames(value).forEach((name, index) => {
        if (index > 0) rail.appendChild(make('span', `pangea-native-line${index <= active ? ' is-done' : ''}`))
        const stage = make('span', `pangea-native-stage is-${stageTone(value, index, active)}`)
        stage.appendChild(make('span', 'pangea-native-dot'))
        stage.appendChild(make('span', '', name))
        rail.appendChild(stage)
      })
      scroll.appendChild(rail)
      card.appendChild(scroll)
      return card
    }

    function diagnosticTone(diagnostic) {
      const status = String(diagnostic?.status ?? '').toLowerCase()
      if (status === 'failed') return 'failed'
      if (status === 'attention_required' || (diagnostic?.settled && diagnostic?.result_state === 'skeleton')) return 'warning'
      return 'active'
    }

    function activityLabel(event) {
      if (event?.type === 'tool') {
        const target = event.target ? ` · ${event.target}` : ''
        return `${event.ok === false ? '失败 · ' : ''}${event.tool ?? 'tool'}${target}`
      }
      if (event?.type === 'validation') return `校验 · ${event.status ?? '未知'}${event.error ? ` · ${event.error}` : ''}`
      if (event?.type === 'settled') return `Worker 结束${event.reason ? ` · ${event.reason}` : ''}`
      if (event?.type === 'started') return 'Worker 开始/续接'
      return event?.type ?? 'activity'
    }

    function appendAgentOutput(box, record) {
      if (!record) return
      const details = make('details')
      details.appendChild(make('summary', '', '查看 Agent 结构化输出'))
      if (record.summary) details.appendChild(make('div', 'pangea-unit-runtime-activity', `摘要：${record.summary}`))
      const counts = record.counts ?? {}
      details.appendChild(make('div', 'pangea-unit-runtime-activity', `业务流程 ${counts.business_flows ?? 0} · 证据 ${counts.evidence ?? 0} · 风险 ${counts.risks ?? 0} · 用例 ${counts.test_cases ?? 0}`))
      const pre = make('pre')
      pre.textContent = JSON.stringify(record.raw ?? {}, null, 2)
      details.appendChild(pre)
      box.appendChild(details)
    }

    function buildUnitDiagnostic(unitId, value) {
      const diagnostics = Array.isArray(value?.diagnostics) ? value.diagnostics : []
      const diagnostic = [...diagnostics].reverse().find(item => item?.unit_id === unitId && ['analysis', 'closure', 'rework'].includes(item?.role))
      const record = [...(value?.rework ?? []), ...(value?.analysis ?? [])].reverse().find(item => item?.unit_id === unitId)
      if (!diagnostic && !record) return null

      const box = make('div', UNIT_DIAGNOSTIC_CLASS)
      const head = make('div', 'pangea-unit-runtime-head')
      head.appendChild(make('div', 'pangea-unit-runtime-title', 'Worker 执行轨迹'))
      const stateText = diagnostic ? ACTION_STATUS[diagnostic.status] ?? diagnostic.status ?? '未知' : '已有结果'
      head.appendChild(make('div', `pangea-unit-runtime-state is-${diagnosticTone(diagnostic)}`, stateText))
      box.appendChild(head)

      if (diagnostic) {
        const grid = make('div', 'pangea-unit-runtime-grid')
        const traceText = diagnostic.trace_observed ? (diagnostic.task_read ? '已观察到' : '未观察到') : '无历史轨迹'
        const toolText = diagnostic.trace_observed ? `${diagnostic.tool_count ?? 0}${diagnostic.failed_tool_count ? `（失败 ${diagnostic.failed_tool_count}）` : ''}` : '—'
        const resultText = RESULT_STATUS[diagnostic.result_state] ?? diagnostic.result_state ?? '未知'
        const settledText = diagnostic.settled ? `是${diagnostic.settled_reason ? ` · ${diagnostic.settled_reason}` : ''}` : '否'
        for (const [label, text] of [['读取 task', traceText], ['工具调用', toolText], ['result_path', resultText], ['Worker 已结束', settledText]]) {
          const item = make('div')
          item.appendChild(make('span', 'pangea-unit-runtime-muted', `${label}：`))
          item.appendChild(make('span', '', text))
          grid.appendChild(item)
        }
        box.appendChild(grid)
        if ((diagnostic.incomplete_attempts ?? 0) > 0 || (diagnostic.validation_failures ?? 0) > 0 || diagnostic.validation_status) {
          box.appendChild(make('div', 'pangea-unit-runtime-activity', `校验：${diagnostic.validation_status ?? '待处理'} · 空提交 ${diagnostic.incomplete_attempts ?? 0} 次 · 结构校验失败 ${diagnostic.validation_failures ?? 0} 次`))
        }
        if (diagnostic.recent_activity?.length) {
          const activities = make('div', 'pangea-unit-runtime-activities')
          activities.appendChild(make('div', 'pangea-unit-runtime-title', '最近活动'))
          for (const event of diagnostic.recent_activity.slice(-5)) activities.appendChild(make('div', 'pangea-unit-runtime-activity', activityLabel(event)))
          box.appendChild(activities)
        }
      }
      appendAgentOutput(box, record)
      return box
    }

    function decorateUnits(value) {
      const heading = unitSectionHeading()
      const parent = heading?.parentElement
      if (!heading || !parent) return
      let node = heading.nextElementSibling
      while (node) {
        if (node.tagName !== 'DETAILS') break
        const summary = node.querySelector(':scope > summary')
        const unitId = (summary?.textContent?.trim().match(/^(U\d+)\b/) ?? [])[1]
        node.querySelector(`:scope > .${UNIT_DIAGNOSTIC_CLASS}`)?.remove()
        if (unitId) {
          const diagnostic = buildUnitDiagnostic(unitId, value)
          if (diagnostic) node.appendChild(diagnostic)
        }
        node = node.nextElementSibling
      }
    }

    function syncDom() {
      syncQueued = false
      protectAssistantSelect(runContext)
      if (!output || output.run_id !== runContext?.runId) {
        document.getElementById(OVERVIEW_ID)?.remove()
        return
      }
      const card = actionLifecycleCard()
      if (card?.parentElement) {
        const old = document.getElementById(OVERVIEW_ID)
        const next = renderOverview(output)
        if (old) old.replaceWith(next)
        else card.parentElement.insertBefore(next, card)
      }
      decorateUnits(output)
    }

    function scheduleSync() {
      if (syncQueued) return
      syncQueued = true
      requestAnimationFrame(syncDom)
    }

    async function refresh() {
      const runId = runContext?.runId
      if (!runId) {
        controller?.abort()
        controller = null
        output = null
        scheduleSync()
        return
      }
      controller?.abort()
      const current = new AbortController()
      controller = current
      try {
        const next = await requestOutputs(runId, current.signal)
        if (controller !== current || runContext?.runId !== runId) return
        output = next
        scheduleSync()
      } catch (error) {
        if (error?.name !== 'AbortError' && runContext?.runId === runId) {
          output = null
          scheduleSync()
        }
      }
    }

    function restartPolling() {
      if (timer) clearInterval(timer)
      timer = null
      void refresh()
      if (runContext?.runId) timer = setInterval(() => { void refresh() }, 5000)
    }

    function apply(ctx) {
      const disposeStyle = installStyles()
      const onRunContext = event => {
        const previous = runContext?.runId
        runContext = event?.detail ?? null
        ensureAssistantConversation(runContext)
        if (previous !== runContext?.runId) {
          output = null
          restartPolling()
        }
        scheduleSync()
      }
      window.addEventListener('pangea:run-context', onRunContext)
      const observer = new MutationObserver(scheduleSync)
      observer.observe(document.documentElement, { childList: true, subtree: true })
      ctx.effect?.(() => () => {
        observer.disconnect()
        window.removeEventListener('pangea:run-context', onRunContext)
        controller?.abort()
        if (timer) clearInterval(timer)
        document.getElementById(OVERVIEW_ID)?.remove()
        for (const node of document.querySelectorAll(`.${UNIT_DIAGNOSTIC_CLASS}`)) node.remove()
        disposeStyle()
      }, 'dsh-pangea-run-ui-native')
    }

    exports.inject = inject
    exports.stageNames = stageNames
    exports.stageIndex = stageIndex
    exports.apply = apply
    return module.exports
  },
})
