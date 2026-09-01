// PANGEA run presentation fixes: safe assistant sessions and in-place Run detail enhancement.
window.__ModuleLoader__.load({
  id: 'dsh-pangea-run-ui',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const inject = ['pangea']
    const API_PATH = '/api/pangea-run-ui/outputs'
    const STYLE_ID = 'dsh-pangea-run-ui-style'
    const ENHANCEMENT_ID = 'pangea-run-detail-enhancement'
    const creationThrottle = new Map()
    let lastRunContext = null
    let lastOutput = null
    let outputRunId = null
    let outputController = null
    let outputTimer = null
    let syncPending = false
    let renderedSignature = ''

    function installStyles() {
      if (document.getElementById(STYLE_ID)) return () => {}
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.dataset.plugin = 'dsh-pangea-run-ui'
      style.textContent = `
        @keyframes pangeaStagePulse {
          0% { box-shadow: 0 0 0 0 rgba(47,122,203,.34); }
          65% { box-shadow: 0 0 0 7px rgba(47,122,203,0); }
          100% { box-shadow: 0 0 0 0 rgba(47,122,203,0); }
        }
        body[data-pangea-product-shell] [data-pangea-assistant-card] {
          height:auto!important; min-height:0!important; display:block!important;
          padding:10px 0 4px!important; border:0!important; border-radius:0!important;
          background:transparent!important; box-shadow:none!important;
        }
        body[data-pangea-product-shell] [data-pangea-assistant-icon],
        body[data-pangea-product-shell] [data-pangea-assistant-progress],
        body[data-pangea-product-shell] [data-pangea-assistant-card] > :last-child { display:none!important; }
        body[data-pangea-product-shell] [data-pangea-assistant-name] { font-size:14px!important; font-weight:680!important; }
        body[data-pangea-product-shell] [data-pangea-assistant-meta] { margin-top:4px; font-size:12px!important; color:#7a828d!important; }
        body[data-pangea-product-shell] [data-pangea-assistant-actions] { display:grid!important; grid-template-columns:minmax(0,1fr) auto; gap:8px!important; align-items:center; }
        body[data-pangea-product-shell] [data-pangea-assistant-actions]::after {
          content:'独立会话 · 不影响正在运行的分析'; grid-column:1 / -1;
          color:#7a828d; font-size:11px; line-height:16px; padding-top:1px;
        }
        body[data-pangea-product-shell] [data-pangea-assistant-select] { min-width:0!important; width:100%!important; }

        #${ENHANCEMENT_ID} { margin:16px 0 4px; color:inherit; font-family:inherit; }
        #${ENHANCEMENT_ID} .pangea-run-ui-title { font-size:14px; font-weight:700; margin:0 0 9px; }
        #${ENHANCEMENT_ID} .pangea-run-ui-card {
          border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22));
          background:var(--dsw-alias-bg-layer-1, transparent); border-radius:9px; padding:13px; margin-bottom:14px;
        }
        #${ENHANCEMENT_ID} .pangea-stage-rail { display:flex; align-items:center; overflow-x:auto; padding:4px 2px 3px; }
        #${ENHANCEMENT_ID} .pangea-stage { min-width:92px; display:flex; align-items:center; gap:8px; color:#747b85; font-size:12px; white-space:nowrap; }
        #${ENHANCEMENT_ID} .pangea-stage-dot { width:11px; height:11px; border-radius:50%; border:2px solid #c7ccd3; background:#fff; box-sizing:border-box; flex:0 0 auto; }
        #${ENHANCEMENT_ID} .pangea-stage.is-done .pangea-stage-dot { border-color:#2da44e; background:#2da44e; }
        #${ENHANCEMENT_ID} .pangea-stage.is-active { color:var(--dsw-alias-label-primary, #17191d); font-weight:700; }
        #${ENHANCEMENT_ID} .pangea-stage.is-active .pangea-stage-dot { border-color:#2f7acb; background:#2f7acb; animation:pangeaStagePulse 1.55s ease-out infinite; }
        #${ENHANCEMENT_ID} .pangea-stage.is-warning .pangea-stage-dot { border-color:#d97706; background:#d97706; animation:none; }
        #${ENHANCEMENT_ID} .pangea-stage.is-failed .pangea-stage-dot { border-color:#c7000b; background:#c7000b; animation:none; }
        #${ENHANCEMENT_ID} .pangea-stage.is-stopped .pangea-stage-dot { border-color:#8a929d; background:#8a929d; animation:none; }
        #${ENHANCEMENT_ID} .pangea-stage-line { width:34px; height:1px; background:#d9dde3; flex:0 0 auto; margin:0 5px; }
        #${ENHANCEMENT_ID} .pangea-stage-line.is-done { background:#8fcaa0; }
        #${ENHANCEMENT_ID} .pangea-agent-group { margin-top:14px; }
        #${ENHANCEMENT_ID} .pangea-agent-group-title { font-size:13px; font-weight:700; margin-bottom:7px; }
        #${ENHANCEMENT_ID} .pangea-agent-record { border-top:1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.14)); padding:11px 0; }
        #${ENHANCEMENT_ID} .pangea-agent-record:first-child { border-top:0; padding-top:1px; }
        #${ENHANCEMENT_ID} .pangea-agent-head { display:flex; justify-content:space-between; align-items:baseline; gap:12px; }
        #${ENHANCEMENT_ID} .pangea-agent-name { font-size:13px; font-weight:680; }
        #${ENHANCEMENT_ID} .pangea-agent-meta { color:#7a818b; font-size:11px; }
        #${ENHANCEMENT_ID} .pangea-agent-summary { margin-top:6px; white-space:pre-wrap; font-size:13px; line-height:1.58; }
        #${ENHANCEMENT_ID} .pangea-agent-scope { margin-top:5px; color:#69717c; font-size:11px; line-height:1.5; overflow-wrap:anywhere; }
        #${ENHANCEMENT_ID} .pangea-agent-chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:7px; }
        #${ENHANCEMENT_ID} .pangea-agent-chip { padding:3px 7px; border-radius:999px; background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08)); font-size:11px; }
        #${ENHANCEMENT_ID} details { margin-top:8px; }
        #${ENHANCEMENT_ID} summary { cursor:pointer; color:#59616c; font-size:12px; }
        #${ENHANCEMENT_ID} pre { max-height:380px; overflow:auto; padding:11px; border-radius:7px; background:var(--dsw-alias-bg-layer-2, #f6f7f9); font-size:11px; line-height:1.5; white-space:pre-wrap; overflow-wrap:anywhere; }
        #${ENHANCEMENT_ID} .pangea-agent-empty { color:#7a818b; font-size:12px; line-height:1.55; }
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

    function assistantSelectSafety(context) {
      const analysisIds = new Set((context?.conversations ?? []).filter(item => item.kind === 'analysis').map(item => item.conversation_id))
      for (const select of document.querySelectorAll('[data-pangea-assistant-select]')) {
        select.setAttribute('aria-label', '切换 AI 助手会话')
        for (const option of select.options ?? []) {
          const isAnalysis = analysisIds.has(option.value)
          option.disabled = isAnalysis
          option.hidden = isAnalysis
        }
      }
    }

    async function requestOutputs({ runId, signal }) {
      const query = new URLSearchParams({ run_id: runId })
      const response = await fetch(`${API_PATH}?${query}`, { cache: 'no-store', signal })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    function stageNames(output) {
      return ['准备', '规划', '分析', '独立复核', ...(output?.has_rework ? ['定向补齐', '再复核'] : []), '生成报告', '完成']
    }

    function stageIndex(output) {
      const stage = String(output?.progress?.stage ?? '').toLowerCase()
      const hasRework = output?.has_rework === true
      const map = {
        preparing: 0,
        planning: 1,
        analyzing: 2,
        reviewing: hasRework ? 5 : 3,
        closing: 4,
        reporting: hasRework ? 6 : 4,
        complete: hasRework ? 7 : 5,
      }
      return Number.isInteger(map[stage]) ? map[stage] : -1
    }

    function currentStageRole(output) {
      return {
        planning: 'planning',
        analyzing: 'analysis',
        reviewing: 'review',
        closing: 'closure',
        reporting: 'reporting',
      }[String(output?.progress?.stage ?? '').toLowerCase()] ?? null
    }

    function currentStageActionTone(output) {
      const role = currentStageRole(output)
      if (!role) return null
      const actions = Array.isArray(output?.progress?.actions) ? output.progress.actions.filter(action => action?.role === role) : []
      if (actions.some(action => {
        const status = String(action?.status ?? '').toLowerCase()
        return status === 'failed' || (action?.error && !['accepted', 'settled'].includes(status))
      })) return 'failed'
      if (actions.some(action => String(action?.status ?? '').toLowerCase() === 'attention_required')) return 'warning'
      return null
    }

    function stageTone(output, index, active) {
      const lifecycle = String(output?.progress?.lifecycle_status ?? '').toLowerCase()
      const complete = String(output?.progress?.stage ?? '').toLowerCase() === 'complete' || lifecycle === 'completed'
      if (complete) return 'done'
      if (index < active) return 'done'
      if (index !== active) return 'pending'
      const actionTone = currentStageActionTone(output)
      if (actionTone) return actionTone
      if (lifecycle === 'failed') return 'failed'
      if (lifecycle === 'stopped') return 'stopped'
      if (output?.progress?.attention_required === true || lifecycle === 'attention_required' || lifecycle === 'incomplete') return 'warning'
      return 'active'
    }

    function make(tag, className, text) {
      const element = document.createElement(tag)
      if (className) element.className = className
      if (text !== undefined && text !== null) element.textContent = String(text)
      return element
    }

    function renderStageRail(output) {
      const card = make('div', 'pangea-run-ui-card')
      card.appendChild(make('div', 'pangea-run-ui-title', '完整流程'))
      const rail = make('div', 'pangea-stage-rail')
      const stages = stageNames(output)
      const active = stageIndex(output)
      stages.forEach((name, index) => {
        if (index > 0) {
          const line = make('span', `pangea-stage-line${index <= active ? ' is-done' : ''}`)
          rail.appendChild(line)
        }
        const tone = stageTone(output, index, active)
        const stage = make('span', `pangea-stage is-${tone}`)
        stage.appendChild(make('span', 'pangea-stage-dot'))
        stage.appendChild(make('span', '', name))
        rail.appendChild(stage)
      })
      card.appendChild(rail)
      return card
    }

    function recordTitle(record, fallback) {
      if (record?.unit_id) return `${record.unit_id} · Attempt ${record.attempt ?? 0}`
      return fallback
    }

    function appendRecord(parent, record, fallbackTitle) {
      const row = make('div', 'pangea-agent-record')
      const head = make('div', 'pangea-agent-head')
      head.appendChild(make('div', 'pangea-agent-name', recordTitle(record, fallbackTitle)))
      head.appendChild(make('div', 'pangea-agent-meta', [record?.worker_id, record?.file].filter(Boolean).join(' · ')))
      row.appendChild(head)
      if (record?.summary) row.appendChild(make('div', 'pangea-agent-summary', record.summary))
      if (record?.analyzed_scope?.length) row.appendChild(make('div', 'pangea-agent-scope', `分析范围：${record.analyzed_scope.join('、')}`))
      if (record?.analyzed_context_scope?.length) row.appendChild(make('div', 'pangea-agent-scope', `上下文范围：${record.analyzed_context_scope.join('、')}`))
      const counts = record?.counts ?? {}
      const chips = make('div', 'pangea-agent-chips')
      for (const [label, value] of [['业务流程', counts.business_flows], ['证据', counts.evidence], ['风险', counts.risks], ['用例', counts.test_cases], ['错误', counts.errors]]) {
        chips.appendChild(make('span', 'pangea-agent-chip', `${label} ${value ?? 0}`))
      }
      row.appendChild(chips)
      const details = make('details')
      details.appendChild(make('summary', '', '查看完整结构化输出'))
      const pre = make('pre')
      pre.textContent = JSON.stringify(record?.raw ?? {}, null, 2)
      details.appendChild(pre)
      row.appendChild(details)
      parent.appendChild(row)
    }

    function appendGroup(parent, title, records, emptyText) {
      const group = make('div', 'pangea-agent-group')
      group.appendChild(make('div', 'pangea-agent-group-title', title))
      if (records?.length) {
        for (const record of records) appendRecord(group, record, title)
      } else {
        group.appendChild(make('div', 'pangea-agent-empty', emptyText))
      }
      parent.appendChild(group)
    }

    function renderAgentAnalysis(output) {
      const card = make('div', 'pangea-run-ui-card')
      card.appendChild(make('div', 'pangea-run-ui-title', 'Agent 分析'))
      const stage = String(output?.progress?.stage ?? '').toLowerCase()
      if (output?.plan) appendGroup(card, '规划 Agent', [output.plan], '')
      else if (stage === 'planning') appendGroup(card, '规划 Agent', [], '正在规划，持久化结果生成后会显示在这里。')

      const analysisEmpty = stage === 'analyzing'
        ? '分析 Worker 正在运行，已写入的结果会逐步显示在这里。'
        : '暂无分析 Worker 输出。'
      appendGroup(card, '分析 Worker', output?.analysis ?? [], analysisEmpty)

      if (output?.reviews?.length || stage === 'reviewing') {
        appendGroup(card, output?.has_rework ? '复核' : '独立复核', output?.reviews ?? [], stage === 'reviewing' ? '复核正在进行。' : '暂无复核输出。')
      }
      if (output?.has_rework) appendGroup(card, '定向补齐', output?.rework ?? [], stage === 'closing' ? '正在定向补齐。' : '暂无补齐输出。')
      return card
    }

    function timelineHeading() {
      for (const element of document.querySelectorAll('div')) {
        const value = element.textContent?.trim() ?? ''
        if (element.childElementCount === 0 && /^运行时间线（\d+）$/.test(value)) return element
      }
      return null
    }

    function removeEnhancement() {
      document.getElementById(ENHANCEMENT_ID)?.remove()
      renderedSignature = ''
    }

    function renderRunDetailEnhancement(output) {
      const heading = timelineHeading()
      if (!heading || !output || output.run_id !== lastRunContext?.runId) {
        if (!heading) removeEnhancement()
        return
      }
      const existing = document.getElementById(ENHANCEMENT_ID)
      const signature = JSON.stringify([output.run_id, output.progress, output.has_rework, output.plan, output.analysis, output.rework, output.reviews])
      if (existing && renderedSignature === signature && existing.parentElement === heading.parentElement) return
      const container = existing ?? make('section')
      container.id = ENHANCEMENT_ID
      container.replaceChildren(renderStageRail(output), renderAgentAnalysis(output))
      renderedSignature = signature
      if (!existing) heading.parentElement?.insertBefore(container, heading)
    }

    function conditionalExistingUi(output) {
      if (!output) return
      const visible = output.has_rework === true
      const labels = new Set(['定向补齐', '返工', '返工复核', '再复核', '定向补齐单元'])
      for (const element of document.querySelectorAll('div,span')) {
        if (!labels.has(element.textContent?.trim())) continue
        if (element.closest(`#${ENHANCEMENT_ID}`)) continue
        let row = element.parentElement
        if (!row) continue
        for (let depth = 0; depth < 4 && row.parentElement; depth += 1) {
          if (row.style?.display === 'grid' || row.tagName === 'LI') break
          row = row.parentElement
        }
        row.style.display = visible ? '' : 'none'
      }
    }

    function syncDom() {
      syncPending = false
      assistantSelectSafety(lastRunContext)
      if (lastOutput?.run_id === lastRunContext?.runId) {
        conditionalExistingUi(lastOutput)
        renderRunDetailEnhancement(lastOutput)
      } else {
        removeEnhancement()
      }
    }

    function scheduleSync() {
      if (syncPending) return
      syncPending = true
      window.requestAnimationFrame(syncDom)
    }

    async function refreshOutput() {
      const runId = lastRunContext?.runId
      if (!runId) {
        outputController?.abort()
        outputController = null
        outputRunId = null
        lastOutput = null
        removeEnhancement()
        return
      }
      outputController?.abort()
      const controller = new AbortController()
      outputController = controller
      try {
        const output = await requestOutputs({ runId, signal: controller.signal })
        if (controller !== outputController || runId !== lastRunContext?.runId) return
        outputRunId = runId
        lastOutput = output
        scheduleSync()
      } catch (error) {
        if (error?.name !== 'AbortError' && runId === lastRunContext?.runId) {
          outputRunId = runId
          lastOutput = null
          scheduleSync()
        }
      }
    }

    function restartOutputPolling() {
      if (outputTimer) window.clearInterval(outputTimer)
      outputTimer = null
      void refreshOutput()
      if (lastRunContext?.runId) outputTimer = window.setInterval(() => { void refreshOutput() }, 5000)
    }

    function apply(ctx) {
      const disposeStyle = installStyles()
      const onRunContext = event => {
        const previousRunId = lastRunContext?.runId
        lastRunContext = event?.detail ?? null
        ensureAssistantConversation(lastRunContext)
        if (previousRunId !== lastRunContext?.runId) {
          lastOutput = null
          outputRunId = null
          restartOutputPolling()
        }
        scheduleSync()
      }
      window.addEventListener('pangea:run-context', onRunContext)
      const observer = new MutationObserver(scheduleSync)
      observer.observe(document.documentElement, { subtree: true, childList: true })
      ctx.effect?.(() => () => {
        observer.disconnect()
        window.removeEventListener('pangea:run-context', onRunContext)
        outputController?.abort()
        if (outputTimer) window.clearInterval(outputTimer)
        removeEnhancement()
        disposeStyle()
      }, 'dsh-pangea-run-ui')
    }

    exports.inject = inject
    exports.stageNames = stageNames
    exports.stageIndex = stageIndex
    exports.apply = apply
    return module.exports
  },
})
