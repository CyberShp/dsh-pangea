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
    const inject = ['pangea', 'sessions']
    const API_PATH = '/api/pangea-companion/state'
    const SOURCE_API_PATH = '/api/pangea-companion/source'
    const EXPORT_API_PATH = '/api/pangea-companion/export'
    const ENVIRONMENT_API_PATH = '/api/pangea-companion/environments'
    const EXECUTION_API_PATH = '/api/pangea-companion/executions'
    const WORKBENCH_API_PATH = '/api/pangea-companion/workbench'
    const REPOSITORY_API_PATH = '/api/pangea-companion/repositories'
    const ACP_SETTINGS_API_PATH = '/api/pangea-companion/acp-settings'
    const ASSET_CATALOG_API_PATH = '/api/pangea-asset-catalog/state'
    const ACTIVE_POLL_INTERVAL_MS = 2_000
    const IDLE_POLL_INTERVAL_MS = 45_000
    const WORKBENCH_ACTIVE_POLL_INTERVAL_MS = 2_000
    const WORKBENCH_BACKGROUND_POLL_INTERVAL_MS = 45_000
    const ACP_PROVIDER_STORAGE_KEY = 'pangea.acp-provider.v1'
    const MODEL_ROUTE_STORAGE_KEY = 'pangea.model-route.v1'

    function modelSelectionKey(value) {
      return value?.provider && value?.model
        ? JSON.stringify([value.provider, value.model, value.reasoning_effort ?? ''])
        : ''
    }

    function modelRouteFromKey(value) {
      try {
        const [provider, model, reasoningEffort] = JSON.parse(value)
        if (typeof provider !== 'string' || !provider || typeof model !== 'string' || !model) return null
        return { provider, model, ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}) }
      } catch { return null }
    }

    function snapshotFingerprint(value) {
      try { return JSON.stringify(value) } catch { return null }
    }

    function normalizedPathIdentity(value) {
      if (typeof value !== 'string' || value.trim() === '') return ''
      const normalized = value.trim().replace(/\\/g, '/').replace(/\/+$/, '')
      return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized
    }

    function taskMatchesRun(task, current) {
      if (!task || !current) return !current
      if (typeof task.run_id !== 'string' || typeof current.run_id !== 'string' || task.run_id !== current.run_id) return false
      const taskRoot = normalizedPathIdentity(task.data_root)
      const currentRoot = normalizedPathIdentity(current.data_root)
      return !taskRoot || !currentRoot || taskRoot === currentRoot
    }

    function snapshotMatchesSelection(snapshot, { runId, dataRoot, task } = {}) {
      const current = snapshot?.current
      if (!current) return true
      if (runId === null) return false
      if (typeof runId === 'string' && runId !== current.run_id) return false
      if (task && !taskMatchesRun(task, current)) return false
      const expectedRoot = normalizedPathIdentity(dataRoot)
      const actualRoot = normalizedPathIdentity(snapshot?.data_root ?? current.data_root)
      return !expectedRoot || !actualRoot || expectedRoot === actualRoot
    }

    function workflowAckPresentation(workflow, stateReadStatus) {
      const required = ['path-fidelity', 'evidence-consumption', 'narrative-first']
      const completed = required.filter(id => {
        const value = workflow?.core_rules_ack?.[id]
        return value && typeof value === 'object' && typeof value.ack_at === 'string' && value.ack_at.trim() !== ''
      }).length
      const label = stateReadStatus === 'ok'
        ? `${completed} / ${required.length}`
        : stateReadStatus === 'stale' ? '最近快照（刷新失败）' : '等待状态初始化'
      return { completed, total: required.length, label }
    }

    function snapshotPollInterval(value) {
      return value?.current?.terminal === false ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS
    }

    function outcomePresentation(current) {
      const delivery = current?.delivery_integrity
      const review = current?.semantic_review
      return {
        workflow: current?.lifecycle_status === 'complete' ? '流程完成' : '流程未完成',
        delivery: ({ complete: '交付完整', incomplete: '交付不完整', unavailable: '交付不可读取' })[delivery?.status] ?? '交付尚未检查',
        review: ({ independent_verified: '独立审查（宿主已核验执行）', independent_pending: '独立审查待完成', independent_declared: '独立审查（Agent 声明，宿主未核验）', self_review: '自审', unavailable: '审查记录不可读取' })[review?.method] ?? '审查方式未记录',
        semantic: review?.verdict === 'PASS' ? 'PASS（审查者结论）' : review?.verdict === 'UNRESOLVED' ? 'UNRESOLVED（审查者结论）' : '未给出语义结论',
      }
    }

    function deriveRunPresentation(task, current, health) {
      const executionTask = current && !taskMatchesRun(task, current) ? null : task
      const taskStatus = executionTask?.status ?? ''
      const executionStatus = executionTask?.execution_status ?? ''
      // The state endpoint already reconciles Run progress with its execution.
      // Do not undo that verdict with an older Task response from another poll.
      const runStatus = current?.lifecycle_status
      const failed = runStatus ? runStatus === 'failed' : ['failed', 'interrupted'].includes(executionStatus) || taskStatus === 'failed'
      const needsAttention = !failed && (runStatus ? runStatus === 'attention_required' : taskStatus === 'needs_attention')
      const stopped = runStatus ? ['stopped', 'cancelled'].includes(runStatus) : executionStatus === 'stopped' || taskStatus === 'stopped'
      const stopping = !failed && !needsAttention && !stopped && current?.terminal !== true && executionStatus === 'stopping'
      const running = !failed && !needsAttention && !stopped && !stopping && (runStatus
        ? ['preparing', 'running'].includes(runStatus)
        : executionStatus === 'starting' || executionStatus === 'running' || taskStatus === 'preparing' || taskStatus === 'running')
      const publicationState = current?.publication?.state ?? 'pending'
      const healthStatus = health?.status ?? 'pending'
      const reliabilityLabel = failed ? '分析失败' : needsAttention ? '需要处理' : stopped ? '已停止' : stopping ? '等待停止确认' : healthStatus === 'warning' ? '不可用于决策' : healthStatus === 'pending' ? (running ? '阶段结果待发布' : '待验证') : HEALTH[healthStatus] ?? healthStatus
      const publicationLabel = failed && publicationState === 'pending' ? '未发布（运行失败）' : needsAttention && publicationState === 'pending' ? '尚未发布（需要处理）' : stopped && publicationState === 'pending' ? '未发布（已停止）' : stopping && publicationState === 'pending' ? '未发布（停止中）' : publicationState === 'pending' && running ? '阶段结果待发布' : publicationState
      const executionLabel = failed ? '分析失败' : needsAttention ? '需要处理' : stopped ? '已停止' : stopping ? '正在停止' : running ? '分析中' : runStatus === 'complete' || executionStatus === 'completed' ? '已完成' : '等待启动'
      const dataTone = healthStatus === 'error' ? 'error' : publicationState === 'final' && healthStatus === 'ok' ? 'ok' : publicationState === 'draft' ? 'notice' : 'neutral'
      const countsAvailability = publicationState === 'pending' ? 'unpublished' : publicationState === 'draft' ? 'draft' : publicationState === 'final' ? 'verified' : 'unavailable'
      const qualityLabel = outcomePresentation(current).semantic
      const canResume = !running && !stopping && runStatus !== 'complete' && executionTask?.can_resume === true
      const resumeBlockedReason = canResume ? null : executionTask?.resume_blocked_reason ?? (!executionTask?.run_id ? '没有可继续的 Run' : running ? '当前执行仍在进行' : executionStatus === 'stopping' ? '正在等待停止确认' : '当前 Run 不满足续跑条件')
      return { executionStatus, executionLabel, failed, needsAttention, stopped, stopping, running, healthStatus, reliabilityLabel, publicationLabel, dataTone, qualityLabel, countsAvailability, isAnimating: running, canResume, resumeBlockedReason, identityMatched: !current || taskMatchesRun(task, current) }
    }

    function taskLaunchEvents(task, workbench) {
      if (!task || workbench?.selected_task_id !== task.task_id) return []
      return (Array.isArray(workbench.launch_log?.events) ? workbench.launch_log.events : [])
        .filter(event => (!event.task_id || event.task_id === task.task_id)
          && (!task.attempt_id || event.attempt_id === task.attempt_id))
    }

    function previousAttemptFailures(task) {
      return (Array.isArray(task?.attempts) ? task.attempts : [])
        .filter(attempt => attempt?.attempt_id !== task?.attempt_id
          && ['failed', 'interrupted'].includes(attempt?.execution_status)
          && typeof attempt?.terminal_error === 'string'
          && attempt.terminal_error.trim() !== '')
        .sort((left, right) => (right.ended_at ?? right.last_activity_at ?? 0) - (left.ended_at ?? left.last_activity_at ?? 0))
    }

    async function requestSnapshot({ cwd, dataRoot, runId, sessionId, signal, fetcher = fetch }) {
      const query = new URLSearchParams({ cwd })
      if (dataRoot) query.set('data_root', dataRoot)
      if (runId !== undefined) query.set('run_id', runId ?? '')
      if (sessionId) query.set('session_id', sessionId)
      const response = await fetcher(`${API_PATH}?${query.toString()}`, { cache: 'no-store', signal })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      if (!snapshotMatchesSelection(body, { runId, dataRoot })) throw new Error('状态响应与请求的 Run 身份不一致')
      return body
    }

    async function requestSourceSnippet({ cwd, dataRoot, runId, location, signal, fetcher = fetch }) {
      const query = new URLSearchParams({ cwd, data_root: dataRoot, location })
      if (runId) query.set('run_id', runId)
      const response = await fetcher(`${SOURCE_API_PATH}?${query.toString()}`, { cache: 'no-store', signal })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    async function requestRunExport({ cwd, dataRoot, runId, format = 'csv', signal, fetcher = fetch }) {
      const query = new URLSearchParams({ cwd, data_root: dataRoot, run_id: runId, format })
      const response = await fetcher(`${EXPORT_API_PATH}?${query.toString()}`, { cache: 'no-store', signal })
      if (!response.ok) {
        let message = `HTTP ${response.status}`
        try { message = (await response.json()).error ?? message } catch { /* preserve HTTP status */ }
        throw new Error(message)
      }
      return {
        blob: await response.blob(),
        filename: response.headers?.get?.('content-disposition')?.match(/filename="?([^";]+)"?/)?.[1] ?? `pangea-${runId}-test-cases.${format}`,
      }
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

    async function testEnvironmentConnection(endpoint, fetcher = fetch) {
      const response = await fetcher(ENVIRONMENT_API_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'test', endpoint }),
      })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body.result
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

    async function requestWorkbench({ cwd, runId, taskId, sessionId, cursor = 0, limit = 20, signal, fetcher = fetch }) {
      const query = new URLSearchParams({ cwd, cursor: String(cursor), limit: String(limit) })
      if (runId !== undefined) query.set('run_id', runId ?? '')
      if (taskId) query.set('task_id', taskId)
      if (sessionId) query.set('session_id', sessionId)
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

    async function requestAssetCatalog({ cwd, repositoryId = '', moduleTag = '', page = 1, query = '', type = '', signal, fetcher = fetch }) {
      const response = await fetcher(`${ASSET_CATALOG_API_PATH}?${new URLSearchParams({
        cwd, page: String(page), page_size: '20', status: 'available',
        ...(query ? { q: query } : {}), ...(type ? { type } : {}),
        ...(repositoryId ? { repository_id: repositoryId } : {}),
        ...(moduleTag ? { module_tag: moduleTag } : {}),
      })}`, { cache: 'no-store', signal })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    async function requestRepositoryStatus({ cwd, fetcher = fetch }) {
      const response = await fetcher(`${REPOSITORY_API_PATH}?${new URLSearchParams({ cwd })}`, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    async function requestRepositoryImport({ cwd, sourcePath, repositoryName, fetcher = fetch }) {
      const response = await fetcher(`${REPOSITORY_API_PATH}?${new URLSearchParams({ cwd })}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source_path: sourcePath, repository_name: repositoryName }),
      })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    async function requestAcpSettings(fetcher = fetch) {
      const response = await fetcher(ACP_SETTINGS_API_PATH, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    async function saveAcpSettings(config, fetcher = fetch) {
      const response = await fetcher(ACP_SETTINGS_API_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'save', config }),
      })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    async function requestAgentModels({ providerId, cwd, signal, fetcher = fetch }) {
      const response = await fetcher(ACP_SETTINGS_API_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal,
        body: JSON.stringify({ action: 'models', provider_id: providerId, cwd }),
      })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    async function testAcpSettings(fetcher = fetch) {
      const response = await fetcher(ACP_SETTINGS_API_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'test' }),
      })
      const body = await response.json()
      if (!response.ok || body.status !== 'ok') throw new Error(body.error ?? `HTTP ${response.status}`)
      return body.checks ?? []
    }

    const PHASE = {
      PREPARING: '等待 Skill 初始化', STEP_BOOTSTRAP: '初始化 Skill',
      STEP_01: 'Step 01 · 范围和任务契约', STEP_02: 'Step 02 · 输入与计划', STEP_03: 'Step 03 · 广度盘点',
      STEP_04: 'Step 04 · 深度讲解', STEP_05: 'Step 05 · 场景与风险', STEP_06: 'Step 06 · SFMEA 翻译',
      STEP_07: 'Step 07 · 测试设计', STEP_08: 'Step 08 · 独立 Judge', STEP_09: 'Step 09 · 正式交付',
      COMPLETE: '已完成', INCOMPLETE: '校验未通过', STOPPED: '已停止', FAILED: '已失败', UNKNOWN: '未知',
    }
    const QUALITY = { PASS: '通过', REWORK: '需要返工', UNRESOLVED: '未解决' }
    const REVIEW = { PASS: '通过', REWORK: '需要返工', UNRESOLVED: '未解决', UNREADABLE: '结果不可读' }
    const SEVERITY = { Critical: '严重', High: '高', Medium: '中', Low: '低' }
    const RISK_SEVERITY_LEVELS = ['Critical', 'High', 'Medium', 'Low']
    function riskSeverityCounts(risks) {
      const counts = { Critical: 0, High: 0, Medium: 0, Low: 0, Ungraded: 0 }
      for (const risk of risks ?? []) {
        if (RISK_SEVERITY_LEVELS.includes(risk?.severity)) counts[risk.severity] += 1
        else counts.Ungraded += 1
      }
      return counts
    }
    function filterRisks(risks, severity, queryValue) {
      const query = String(queryValue ?? '').trim().toLowerCase()
      return (risks ?? []).filter(risk => {
        if (severity === 'Ungraded' && RISK_SEVERITY_LEVELS.includes(risk?.severity)) return false
        if (!['全部', 'Ungraded'].includes(severity) && risk.severity !== severity) return false
        return !query || [
          risk.risk_id, risk.title, risk.narrative, risk.trigger, risk.system_result,
          risk.residual_effect, risk.apparent_normality, risk.external_observation,
          risk.blackbox_proof, ...(risk.dfx ?? []),
        ].join(' ').toLowerCase().includes(query)
      })
    }
    const CONFIDENCE = { high: '高', medium: '中', low: '低' }
    const TRANSLATION = {
      'Blackbox-ready': '黑盒可执行', 'Graybox-ready': '灰盒可执行', 'Developer-confirm': '需开发确认',
      'Test-ready': '已有测试覆盖', Unreachable: '受支持入口不可达', Uncovered: '尚未覆盖',
    }
    const isUnreachableRisk = risk => risk?.translation_status === 'Unreachable'
    const isUncoveredRisk = risk => !isUnreachableRisk(risk) && (risk?.linked_test_case_ids?.length ?? 0) === 0
    const RISK_STATUS = {
      pending: '待确认', accepted: '已采纳', confirmed: '已确认', false_positive: '误报',
      claimed_fixed: '声称已修复', verified_fixed: '已验证修复',
    }
    const HEALTH = { ok: '正常', pending: '阶段生成中', warning: '需关注', error: '异常' }
    const SOURCE = { 'final-state': '最终聚合结果', 'worker-results': 'Worker 结果兼容读取' }
    const DISCUSSION_INTENTS = {
      review: '请结合证据和关联对象做独立判断：结论是否成立，还需要哪些信息。',
      evidence: '只基于下方“选中源码片段”核对“待核对结论”：分别说明这些源码能直接支持什么、组合后仍不能证明什么。不要调用工具，不要读取或使用其他文件、其他证据、PANGEA 其他字段或整个 Run 的信息。',
      executable: '请把当前结论改写成可执行的测试语言，包含前置、操作、观察点和预期结果。',
      'targeted-executable': '请只根据“待测试结论”和下方“选中源码片段”生成一个可执行测试，分别写出前置条件、操作步骤、观察点和预期结果。触发条件与外部观察只可提取和该结论直接相关的内容；忽略其余部分，不得增加可选扩展、其他风险后果或第二个测试。源码不能支持的预期必须标记为“待确认”，不要自行补充其他证据。',
      coverage: '请检查当前对象还缺少哪些测试覆盖，只列出有明确依据的缺口。',
    }

    const styles = {
      root: { height: '100%', overflow: 'auto', boxSizing: 'border-box', color: '#17191d', background: '#f5f6f8', fontFamily: '"Huawei Sans", "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei UI", sans-serif', fontSize: 14, WebkitFontSmoothing: 'antialiased' },
      sticky: { position: 'sticky', top: 0, zIndex: 5, padding: '17px 22px 0', background: 'var(--dsw-alias-bg-layer-1, #fff)', borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(31,35,41,.14))' },
      header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
      headerLeft: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 },
      title: { fontSize: 20, fontWeight: 600, letterSpacing: '-0.012em', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      subline: { marginTop: 5, color: 'var(--dsw-alias-label-tertiary, #7a818b)', fontSize: 12, lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      backButton: { border: 0, background: 'transparent', color: 'var(--dsw-alias-label-secondary, inherit)', padding: '4px 2px', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' },
      button: { border: '1px solid var(--dsw-alias-border-l2, #555)', background: 'var(--dsw-alias-bg-layer-2, transparent)', color: 'inherit', borderRadius: 6, padding: '7px 10px', cursor: 'pointer', fontSize: 13 },
      primaryButton: { width: '100%', border: '1px solid var(--dsw-alias-state-business-primary, #4d9ad6)', background: 'var(--dsw-alias-state-business-primary, #4d9ad6)', color: 'var(--dsw-alias-label-on-primary, #fff)', borderRadius: 7, padding: '9px 12px', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
      buttonDisabled: { cursor: 'default', opacity: 0.55 },
      nav: { display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(72px, 1fr)', gap: 0, marginTop: 12, overflowX: 'auto' },
      navButton: { border: 0, borderBottom: '2px solid transparent', background: 'transparent', color: 'var(--dsw-alias-label-tertiary, inherit)', padding: '11px 4px 10px', cursor: 'pointer', fontSize: 13 },
      navActive: { color: 'var(--dsw-alias-label-primary, inherit)', fontWeight: 700, borderBottomColor: 'var(--dsw-alias-state-business-primary, #4d9ad6)' },
      content: { padding: '20px 22px 30px' },
      homeContent: { padding: '32px 36px 42px', background: '#f5f6f8' },
      card: { border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22))', background: 'var(--dsw-alias-bg-layer-1, transparent)', borderRadius: 9, padding: 12, marginBottom: 11 },
      healthOk: { borderColor: 'var(--dsw-alias-state-success-secondary, #4fb8a8)', background: 'var(--dsw-alias-state-success-tertiary, var(--dsw-alias-bg-layer-1, transparent))' },
      healthError: { borderColor: 'var(--dsw-alias-state-error-secondary, #e66767)', background: 'var(--dsw-alias-interactive-bg-hover-danger, var(--dsw-alias-bg-layer-1, transparent))' },
      healthWarning: { borderColor: 'var(--dsw-alias-state-warn-secondary, #c9974f)', background: 'var(--dsw-alias-state-warn-tertiary, var(--dsw-alias-bg-layer-1, transparent))' },
      clickableCard: { width: '100%', textAlign: 'left', color: 'inherit', cursor: 'pointer' },
      label: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 12, fontWeight: 500, letterSpacing: '0.02em' },
      value: { fontSize: 14, fontWeight: 500, lineHeight: 1.5, marginTop: 4, overflowWrap: 'anywhere' },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7, marginTop: 8 },
      metric: { border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.14))', borderRadius: 7, padding: 9, background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08))', color: 'inherit' },
      metricClickable: { cursor: 'pointer', width: '100%', textAlign: 'left' },
      metricNumber: { fontSize: 17, fontWeight: 740, lineHeight: 1.1 },
      metricName: { color: 'var(--dsw-alias-label-secondary, inherit)', fontSize: 12, marginTop: 3 },
      progressTrack: { height: 5, borderRadius: 999, overflow: 'hidden', background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.16))', marginTop: 7 },
      progressFill: { height: '100%', background: 'var(--dsw-alias-state-business-primary, #4d9ad6)' },
      sectionTitle: { fontSize: 16, fontWeight: 600, letterSpacing: '-0.005em', margin: '20px 0 9px' },
      itemTitle: { fontSize: 14, fontWeight: 600, lineHeight: 1.5 },
      itemMeta: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 12, marginTop: 5, lineHeight: 1.6 },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 7 },
      badge: { display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '3px 8px', color: 'var(--dsw-alias-label-secondary, inherit)', fontSize: 12, background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.15))', whiteSpace: 'nowrap' },
      statusRow: { display: 'flex', alignItems: 'center', gap: 6 },
      statusDot: { width: 6, height: 6, flex: '0 0 auto', borderRadius: '50%', background: 'var(--dsw-alias-state-business-primary, #4d9ad6)' },
      chips: { display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 },
      chip: { border: '1px solid var(--dsw-alias-border-l2, #555)', borderRadius: 999, padding: '5px 9px', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 },
      search: { width: '100%', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2, #555)', background: 'var(--dsw-alias-bg-layer-2, transparent)', color: 'inherit', borderRadius: 7, padding: '9px 10px', outline: 'none', fontSize: 14, marginBottom: 8 },
      filters: { display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 5, marginBottom: 3 },
      filter: { flex: '0 0 auto', border: '1px solid var(--dsw-alias-border-l2, #555)', borderRadius: 999, background: 'transparent', color: 'inherit', padding: '5px 10px', fontSize: 13, cursor: 'pointer' },
      filterActive: { background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.15))', fontWeight: 700 },
      text: { fontSize: 14, lineHeight: 1.65, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
      list: { margin: '6px 0 0', paddingLeft: 20, fontSize: 14, lineHeight: 1.65 },
      separator: { border: 0, borderTop: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16))', margin: '10px 0' },
      empty: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 13, lineHeight: 1.6 },
      error: { whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--dsw-alias-state-error-primary, #e66767)' },
      runButton: { width: '100%', textAlign: 'left', border: 0, borderRadius: 7, padding: '7px 8px', marginBottom: 3, cursor: 'pointer', color: 'inherit', background: 'transparent' },
      runActive: { background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1))' },
      toolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 7, flexWrap: 'wrap' },
      formGrid: { display: 'grid', gap: 8, marginTop: 9 },
      textarea: { width: '100%', minHeight: 74, resize: 'vertical', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2, #555)', background: 'var(--dsw-alias-bg-layer-2, transparent)', color: 'inherit', borderRadius: 7, padding: '8px 9px', outline: 'none', fontSize: 13, lineHeight: 1.5 },
      compatibility: { borderLeft: '3px solid var(--dsw-alias-state-business-primary, #4d9ad6)' },
      stageRail: { display: 'grid', gap: 7, marginTop: 8 },
      stageItem: { display: 'grid', gridTemplateColumns: '9px minmax(0, 1fr) auto', gap: 8, alignItems: 'start', borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.13))', paddingBottom: 8 },
      stageDot: { width: 7, height: 7, marginTop: 5, borderRadius: 2, background: 'var(--dsw-alias-state-business-primary, #4d9ad6)' },
      flowStep: { borderLeft: '2px solid var(--dsw-alias-border-l2, #555)', paddingLeft: 9, marginTop: 7 },
      actionCard: { borderColor: 'var(--dsw-alias-state-business-secondary, var(--dsw-alias-border-l2, #555))', background: 'var(--dsw-alias-state-business-tertiary, var(--dsw-alias-bg-layer-1, transparent))' },
      success: { color: 'var(--dsw-alias-state-success-primary, #38a892)', fontSize: 12, lineHeight: 1.5 },
      source: { maxHeight: 200, margin: '9px 0 0', border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16))', borderRadius: 7, overflow: 'auto', background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08))', fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)', fontSize: 12, lineHeight: 1.55 },
      sourceLine: { display: 'flex', minWidth: 'max-content', whiteSpace: 'pre' },
      sourceTarget: { background: 'var(--dsw-alias-state-business-tertiary, rgba(77,154,214,.12))' },
      sourceNumber: { width: 42, flex: '0 0 42px', boxSizing: 'border-box', paddingRight: 9, textAlign: 'right', userSelect: 'none', color: 'var(--dsw-alias-label-tertiary, #888)', borderRight: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.12))' },
      sourceCode: { padding: '0 9px', color: 'var(--dsw-alias-label-primary, inherit)' },
      evidenceTabs: { display: 'flex', gap: 5, overflowX: 'auto', marginTop: 8, paddingBottom: 3 },
      evidenceTab: { flex: '0 0 auto', maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: '1px solid var(--dsw-alias-border-l2, #555)', borderRadius: 6, padding: '5px 8px', background: 'transparent', color: 'var(--dsw-alias-label-secondary, inherit)', cursor: 'pointer', fontSize: 12 },
      evidenceTabActive: { borderColor: 'var(--dsw-alias-state-business-primary, #4d9ad6)', background: 'var(--dsw-alias-state-business-tertiary, rgba(77,154,214,.12))', color: 'var(--dsw-alias-label-primary, inherit)', fontWeight: 700 },
      choiceGrid: { display: 'grid', gap: 6, marginTop: 7 },
      choiceButton: { width: '100%', textAlign: 'left', border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16))', borderRadius: 7, padding: '8px 9px', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12, lineHeight: 1.45 },
      choiceButtonActive: { borderColor: 'var(--dsw-alias-state-business-primary, #4d9ad6)', background: 'var(--dsw-alias-state-business-tertiary, rgba(77,154,214,.12))' },
      evidenceChecks: { display: 'grid', gap: 5, marginTop: 7 },
      formGrid: { display: 'grid', gap: 7, marginTop: 8 },
      textarea: { width: '100%', minHeight: 86, resize: 'vertical', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2, #555)', background: 'var(--dsw-alias-bg-layer-2, transparent)', color: 'inherit', borderRadius: 7, padding: '8px 9px', outline: 'none', fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)', fontSize: 13 },
      caseSelect: { display: 'flex', alignItems: 'flex-start', gap: 8 },
      caseDetailButton: { flex: 1, minWidth: 0, border: 0, background: 'transparent', color: 'inherit', padding: 0, textAlign: 'left', cursor: 'pointer' },
      evidenceCheck: { display: 'flex', alignItems: 'flex-start', gap: 7, border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16))', borderRadius: 7, padding: '7px 8px', cursor: 'pointer', fontSize: 12, lineHeight: 1.4 },
      evidenceCheckSelected: { borderColor: 'var(--dsw-alias-state-business-primary, #4d9ad6)', background: 'var(--dsw-alias-state-business-tertiary, rgba(77,154,214,.12))' },
      monitorHero: { border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.24))', borderRadius: 10, padding: 14, marginBottom: 12, background: 'var(--dsw-alias-bg-layer-1, transparent)' },
      monitorState: { fontSize: 20, lineHeight: 1.2, fontWeight: 780, letterSpacing: '-0.02em' },
      monitorHint: { marginTop: 6, color: 'var(--dsw-alias-label-secondary, inherit)', fontSize: 12, lineHeight: 1.55 },
      boundary: { borderTop: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16))', paddingTop: 11, marginTop: 11 },
      timeline: { position: 'relative', marginTop: 2 },
      timelineItem: { position: 'relative', padding: '0 0 13px 18px', borderLeft: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.24))', marginLeft: 4 },
      timelineDot: { position: 'absolute', left: -4, top: 4, width: 7, height: 7, borderRadius: '50%', background: 'var(--dsw-alias-state-business-primary, #4d9ad6)', boxShadow: '0 0 0 3px var(--dsw-alias-bg-base, #111)' },
      timelineTime: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 12, fontVariantNumeric: 'tabular-nums' },
      timelineTitle: { marginTop: 2, fontSize: 13, fontWeight: 600, lineHeight: 1.45 },
      timelineDetail: { marginTop: 3, color: 'var(--dsw-alias-label-secondary, inherit)', fontSize: 12, lineHeight: 1.5, overflowWrap: 'anywhere' },
      eyebrow: { color: 'var(--dsw-alias-state-business-primary, #4d9ad6)', fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' },
      decisionHero: { border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.24))', borderLeft: '3px solid var(--dsw-alias-state-business-primary, #4d9ad6)', borderRadius: 8, padding: 13, marginBottom: 11, background: 'linear-gradient(135deg, var(--dsw-alias-bg-layer-1, #171717), var(--dsw-alias-bg-layer-2, #202020))' },
      decisionTitle: { marginTop: 5, fontSize: 18, fontWeight: 780, lineHeight: 1.3, letterSpacing: '-0.02em' },
      decisionHint: { marginTop: 6, color: 'var(--dsw-alias-label-secondary, inherit)', fontSize: 13, lineHeight: 1.55 },
      decisionBand: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6, marginTop: 11 },
      decisionItem: { minWidth: 0, borderTop: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.24))', paddingTop: 7 },
      decisionValue: { marginTop: 3, fontSize: 14, fontWeight: 600, lineHeight: 1.4, overflowWrap: 'anywhere' },
      group: { marginBottom: 14 },
      groupHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, padding: '0 2px 7px', borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16))' },
      groupTitle: { fontSize: 12, fontWeight: 760, lineHeight: 1.4 },
      groupMeta: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 12, lineHeight: 1.45, marginTop: 2 },
      compactCard: { border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16))', background: 'var(--dsw-alias-bg-layer-1, transparent)', borderRadius: 7, padding: 10, marginTop: 7 },
      scenarioIndex: { width: 24, flex: '0 0 24px', color: 'var(--dsw-alias-label-tertiary, #888)', fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)', fontSize: 12, paddingTop: 2 },
      technical: { border: '1px dashed var(--dsw-alias-border-l2, rgba(127,127,127,.32))', borderRadius: 8, padding: 10, marginBottom: 11, background: 'transparent' },
      homeHero: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, padding: '4px 4px 26px', marginBottom: 0 },
      homeTitle: { fontSize: 32, fontWeight: 720, lineHeight: 1.15, letterSpacing: '-0.045em', color: '#14161a' },
      homeLead: { maxWidth: 650, marginTop: 9, color: '#747b85', fontSize: 13, lineHeight: 1.55 },
      metricGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16, marginBottom: 18 },
      metricCard: { position: 'relative', minHeight: 110, display: 'grid', gridTemplateColumns: '48px minmax(0, 1fr)', alignItems: 'center', columnGap: 13, border: '1px solid #dce1e6', borderRadius: 9, padding: '17px 16px', background: '#fff', boxShadow: '0 1px 2px rgba(20,29,40,.035), 0 8px 24px rgba(20,29,40,.035)', boxSizing: 'border-box' },
      metricIcon: { width: 48, height: 48, display: 'grid', placeItems: 'center', borderRadius: 11, background: 'color-mix(in srgb, currentColor 10%, white)' },
      metricLabel: { color: '#3e444c', fontSize: 14, lineHeight: 1.3, fontWeight: 520 },
      metricValue: { marginTop: 4, fontSize: 25, fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' },
      metricAccent: { position: 'absolute', left: '50%', bottom: 0, width: 52, height: 3, borderRadius: '3px 3px 0 0', transform: 'translateX(-50%)' },
      homeSection: { border: '1px solid #dce1e6', borderRadius: 9, background: '#fff', overflow: 'hidden', boxShadow: '0 1px 2px rgba(20,29,40,.03), 0 10px 28px rgba(20,29,40,.025)' },
      homeSectionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 50, gap: 12, padding: '0 18px', borderBottom: '1px solid #e7eaee' },
      homeSectionTitle: { fontSize: 16, fontWeight: 680, letterSpacing: '-0.015em', color: '#25282d' },
      homeTableHeader: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(72px, .72fr) minmax(100px, .92fr) minmax(74px, .62fr) minmax(72px, .72fr) 18px', alignItems: 'center', gap: 12, minHeight: 42, padding: '0 18px', color: '#747b85', fontSize: 12, fontWeight: 520, borderBottom: '1px solid #e7eaee', background: '#fafbfc', boxSizing: 'border-box' },
      homeTableRow: { width: '100%', minHeight: 56, display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(72px, .72fr) minmax(100px, .92fr) minmax(74px, .62fr) minmax(72px, .72fr) 18px', alignItems: 'center', gap: 12, padding: '0 18px', color: '#25282d', textAlign: 'left', border: 0, borderBottom: '1px solid #edf0f2', background: '#fff', cursor: 'pointer', boxSizing: 'border-box' },
      homeStatus: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', justifySelf: 'start', minHeight: 26, padding: '0 8px', border: '1px solid currentColor', borderRadius: 5, background: '#fff', fontSize: 12, fontWeight: 580, whiteSpace: 'nowrap' },
      progressLine: { height: 7, borderRadius: 999, overflow: 'hidden', background: '#edf0f2' },
      appGrid: { display: 'grid', gridTemplateColumns: '1fr', gap: 12 },
      appCard: { minHeight: 102, display: 'grid', gridTemplateColumns: '54px minmax(0, 1fr) 20px', alignItems: 'center', columnGap: 16, textAlign: 'left', color: '#24272c', border: '1px solid #dfe3e8', borderRadius: 8, padding: '15px 18px', background: '#fff', cursor: 'pointer', boxSizing: 'border-box', boxShadow: '0 1px 3px rgba(20,29,40,.02)' },
      appMark: { width: 52, height: 52, display: 'grid', placeItems: 'center', borderRadius: 11, color: '#c7000b', background: '#fff0f1', border: '1px solid #ffe0e2' },
      appTitle: { fontSize: 15, fontWeight: 680, lineHeight: 1.35 },
      appCopy: { marginTop: 5, color: '#747b85', fontSize: 12, lineHeight: 1.45 },
      appArrow: { color: '#68707c', fontSize: 22, lineHeight: 1 },
      homeColumns: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.02fr) minmax(300px, .98fr)', gap: 16, marginTop: 16, minHeight: 330 },
      reportRow: { width: '100%', minHeight: 47, display: 'grid', gridTemplateColumns: '22px minmax(0,1fr) 96px 18px', alignItems: 'center', gap: 10, padding: '0 2px', color: '#24272c', border: 0, borderBottom: '1px solid #edf0f2', background: 'transparent', cursor: 'pointer', textAlign: 'left' },
      redButton: { minWidth: 118, minHeight: 42, border: '1px solid #c7000b', borderRadius: 6, padding: '0 22px', background: 'linear-gradient(135deg, #c7000b, #d90012)', color: '#fff', fontSize: 14, fontWeight: 650, boxShadow: '0 6px 14px rgba(199,0,11,.13)' },
      environmentContent: { padding: '22px 28px 32px', maxWidth: 1120, margin: '0 auto', boxSizing: 'border-box' },
      environmentSection: { border: '1px solid #dce1e6', borderRadius: 9, marginBottom: 18, background: '#fff', overflow: 'hidden', boxShadow: '0 1px 2px rgba(20,29,40,.03)' },
      environmentSectionHead: { minHeight: 51, display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px', borderBottom: '1px solid #e6e9ed' },
      environmentSectionTitle: { fontSize: 16, fontWeight: 700, color: '#25282d' },
      environmentSectionHint: { color: '#7a818c', fontSize: 12 },
      environmentSectionBody: { padding: '18px 20px 20px' },
      environmentConnections: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 18 },
      environmentConnectionCard: { border: '1px solid #dfe3e8', borderRadius: 8, padding: 18, background: '#fbfcfd' },
      environmentConnectionTitle: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, color: '#25282d', fontSize: 15, fontWeight: 700 },
      environmentConnectionIcon: { width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: 7, color: '#c7000b', background: '#fff0f1', border: '1px solid #ffe0e2' },
      environmentFieldGrid: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, .85fr)', gap: 13 },
      environmentField: { minWidth: 0 },
      environmentFieldWide: { gridColumn: '1 / -1' },
      environmentLabel: { display: 'block', marginBottom: 7, color: '#343a43', fontSize: 13, fontWeight: 620 },
      environmentInput: { width: '100%', height: 42, boxSizing: 'border-box', border: '1px solid #cfd5dc', borderRadius: 5, padding: '0 12px', outline: 'none', color: '#272b31', background: '#fff', fontSize: 14 },
      environmentConnectionFoot: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 16 },
      environmentTestState: { color: '#7a818c', fontSize: 12 },
      environmentActions: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 2 },
      environmentSecondaryButton: { minWidth: 74, height: 36, border: '1px solid #cfd4da', borderRadius: 5, padding: '0 16px', color: '#343a43', background: '#fff', cursor: 'pointer', fontSize: 13 },
      environmentPrimaryButton: { minWidth: 102, height: 36, border: '1px solid #c7000b', borderRadius: 5, padding: '0 18px', color: '#fff', background: '#c7000b', cursor: 'pointer', fontSize: 13, fontWeight: 650 },
      environmentAdvanced: { gridColumn: '1 / -1', marginTop: 1, color: '#59616c', fontSize: 12 },
      environmentList: { display: 'grid', gap: 9 },
      environmentListItem: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', gap: 14, padding: '13px 14px', border: '1px solid #e1e5e9', borderRadius: 7, background: '#fff' },
      onboardingShell: { minHeight: 'calc(100vh - 128px)', display: 'grid', placeItems: 'center', padding: '34px 28px 54px', boxSizing: 'border-box', background: 'radial-gradient(circle at 50% 5%, #fff 0, #f7f8fa 44%, #f3f5f7 100%)' },
      onboardingCard: { width: 'min(760px, 100%)', border: '1px solid #dce1e6', borderRadius: 12, padding: '38px 42px 40px', background: '#fff', boxShadow: '0 22px 60px rgba(22,31,43,.08), 0 2px 8px rgba(22,31,43,.04)', boxSizing: 'border-box' },
      onboardingEyebrow: { color: '#c7000b', fontSize: 12, fontWeight: 720, letterSpacing: '.1em' },
      onboardingTitle: { marginTop: 10, color: '#181a1f', fontSize: 30, fontWeight: 730, lineHeight: 1.2, letterSpacing: '-.035em' },
      onboardingLead: { maxWidth: 610, marginTop: 11, color: '#68717c', fontSize: 14, lineHeight: 1.7 },
      onboardingRail: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', marginTop: 30, borderTop: '1px solid #e0e4e8' },
      onboardingStep: { position: 'relative', padding: '20px 14px 18px 0', color: '#7a828d', fontSize: 12, lineHeight: 1.45 },
      onboardingStepDot: { position: 'absolute', top: -6, left: 0, width: 11, height: 11, borderRadius: '50%', background: '#c7000b', boxShadow: '0 0 0 4px #fff' },
      onboardingStepTitle: { color: '#292d33', fontSize: 14, fontWeight: 680, marginBottom: 4 },
      repositoryPicker: { marginTop: 6, border: '1px solid #dce1e6', borderRadius: 9, padding: 18, background: '#fafbfc' },
      repositoryPickerRow: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'end', gap: 14 },
      repositoryPath: { minHeight: 42, display: 'flex', alignItems: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: '1px solid #cfd5dc', borderRadius: 5, padding: '0 12px', color: '#4e5661', background: '#fff', fontSize: 13, boxSizing: 'border-box' },
      repositoryActions: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 22 },
      repositoryHint: { marginTop: 12, color: '#7a828d', fontSize: 12, lineHeight: 1.6 },
    }

    function icon(size = 16) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      }, h('circle', { cx: 12, cy: 12, r: 8 }), h('path', { d: 'M7.5 12h9M12 7.5v9' }), h('circle', { cx: 12, cy: 12, r: 2.2 }))
    }

    function dashboardIcon(kind, color) {
      const paths = {
        running: [h('circle', { key: 'c', cx: 12, cy: 12, r: 8.5 }), h('path', { key: 'p', d: 'm10 8 6 4-6 4Z' })],
        review: [h('circle', { key: 'c', cx: 12, cy: 12, r: 8.5 }), h('path', { key: 'p', d: 'M12 7v5l3 2' })],
        risk: [h('path', { key: 'p', d: 'M12 3.5 20 7v5.5c0 4.1-3.1 6.9-8 8-4.9-1.1-8-3.9-8-8V7l8-3.5Z' }), h('path', { key: 'l', d: 'M12 8v5m0 3h.01' })],
        report: [h('path', { key: 'p', d: 'M7 3.5h7l3 3V20H7Z' }), h('path', { key: 'l', d: 'M14 3.5V7h3M10 11h4m-4 3h4' })],
      }
      return h('span', { style: { ...styles.metricIcon, color }, 'aria-hidden': true },
        h('svg', { width: 29, height: 29, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }, paths[kind] ?? paths.report))
    }

    function appGlyph(kind) {
      const paths = kind === 'analysis'
        ? [h('path', { key: 'a', d: 'M4 17.5 8.4 13l3.4 3 7.2-8.5' }), h('path', { key: 'b', d: 'M5 4h14v16H5Z' }), h('circle', { key: 'c', cx: 8.4, cy: 13, r: 1.1 })]
        : [h('rect', { key: 'a', x: 3.5, y: 4, width: 12, height: 6.5, rx: 1.5 }), h('rect', { key: 'b', x: 3.5, y: 13.5, width: 9, height: 6.5, rx: 1.5 }), h('circle', { key: 'c', cx: 17.5, cy: 16.5, r: 3 }), h('path', { key: 'd', d: 'M17.5 12.2v1.3m0 6v1.3m4.3-4.3h-1.3m-6 0h-1.3' })]
      return h('svg', { width: 31, height: 31, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, paths)
    }

    function reportGlyph() {
      return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: '#737b86', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M6 3.5h8l4 4V20H6Z' }), h('path', { d: 'M14 3.5V8h4M9 12h6m-6 3h6' }))
    }

    function text(value, fallback = '—') { return typeof value === 'string' && value.trim() !== '' ? value : fallback }
    function hasText(value) { return typeof value === 'string' && value.trim() !== '' }
    function runLabel(run) { return text(run?.target, text(run?.run_id, '未命名 Run')) }
    function shortId(value) { return hasText(value) ? value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value : '—' }
    function formatTime(value) {
      const date = Number.isFinite(value) || typeof value === 'string' ? new Date(value) : null
      if (!date || Number.isNaN(date.getTime())) return '时间未知'
      return date.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      })
    }
    function formatDate(value) {
      if (value === null || value === undefined || value === '') return '—'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return '—'
      return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replaceAll('/', '-')
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
    function evidenceFilePath(location, cwd, dataRoot, runDirectory) {
      const value = filePathFromLocation(location)
      if (!value) return undefined
      if (/^(?:\/|[A-Za-z]:[\\/])/.test(value)) return value
      const repositoryLocation = value.match(/^([^:/\\]+):(.+)$/)
      if (repositoryLocation && hasText(dataRoot)) {
        if (hasText(runDirectory)) {
          return absoluteWorkspacePath(runDirectory, `inputs/source/repository/${repositoryLocation[2]}`)
        }
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
          discussionLine(lines, '风险说明', item?.narrative)
          discussionLine(lines, '触发条件', item?.trigger)
          discussionLine(lines, '代码失效', item?.system_result)
          discussionLine(lines, '残留状态', item?.residual_effect)
          discussionLine(lines, '表面正常现象', item?.apparent_normality)
          discussionLine(lines, '对外暴露', item?.external_observation)
          discussionLine(lines, '黑盒证明', item?.blackbox_proof)
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
      if (screen.type === 'home') return 'home'
      if (screen.type === 'tasks') return 'tasks'
      if (screen.type === 'risk') return 'risks'
      if (screen.type === 'case') return 'cases'
      if (screen.type === 'evidence-detail') return 'evidence'
      if (screen.type === 'flows') return 'flows'
      if (screen.type === 'review') return 'review'
      return screen.type
    }

    function analysisBackTarget(screenType, { pageMode = 'analysis', selectedTaskId, hasHistory = false, initialScreen = 'tasks' } = {}) {
      if (hasHistory) return 'history'
      if (pageMode === 'analysis' && selectedTaskId && !['tasks', 'create', 'overview'].includes(screenType)) return 'overview'
      return initialScreen
    }

    function buildAnalysisRequest(form) {
      return {
        request_version: '2.0',
        ...(form.source_task_id ? { source_task_id: form.source_task_id } : {}),
        repository: form.repository,
        target: form.target,
        source_scope: String(form.source_scope_text ?? '').split(/[\n,]/).map(value => value.trim()).filter(Boolean),
        asset_ids: Array.isArray(form.asset_ids) ? form.asset_ids : [],
        scenario: form.scenario || 'module-analysis',
        ...(form.scenario === 'coverage-analysis' ? { coverage_input: form.coverage_kind === 'file'
          ? { kind: 'file', path: form.coverage_path }
          : form.coverage_kind === 'asset' ? { kind: 'asset', asset_id: form.coverage_asset_id }
          : { kind: 'query', query: { product: form.coverage_product, c_version: form.coverage_version, b_version: form.coverage_b_version || '', module: form.coverage_module } } } : {}),
        mode: form.mode || 'depth',
        provider_id: form.provider_id || null,
        model_route: form.provider_id ? null : modelRouteFromKey(form.model_route_key),
        agent_model: form.provider_id ? form.agent_model || null : null,
      }
    }
    function writableConversation(task) {
      const conversations = Array.isArray(task?.conversations) ? task.conversations : []
      const writable = conversations.filter(item => item?.kind !== 'analysis' && hasText(item?.session_id))
      return writable.find(item => item.conversation_id === task?.active_conversation_id) ?? writable[0] ?? null
    }

    function emptyEnvironmentForm() {
      return {
        id: '', name: '', advanced: false,
        host_ip: '', host_username: '', host_password: '', host_port: '22',
        array_ip: '', array_username: '', array_password: '', array_port: '22',
      }
    }

    function acpSettingsDraft(providers) {
      return Object.fromEntries((providers ?? []).map(provider => [provider.id, {
        command: provider.command ?? '',
        args: (provider.args ?? []).join('\n'),
      }]))
    }

    function acpResolutionLabel(value) {
      return ({
        resolved: '已解析',
        not_found: '未找到命令',
        probe_error: '探测失败',
        'built-in': '内置 Provider',
        not_checked: '尚未检查',
      })[value] ?? value ?? '待重启检查'
    }

    function acpVersionLabel(provider) {
      if (provider.version) return provider.version
      if (provider.version_status === 'unavailable') return '命令可用，未返回版本'
      if (provider.version_status === 'not_checked') return '尚未检查'
      return '未读取'
    }

    function AgentModelSelect({ providerId, cwd, visible, value, onChange }) {
      const [catalog, setCatalog] = React.useState(null)
      const [error, setError] = React.useState('')
      const [loading, setLoading] = React.useState(true)
      const [refresh, setRefresh] = React.useState(0)
      React.useEffect(() => {
        if (!visible) return undefined
        const controller = new AbortController()
        setLoading(true)
        setError('')
        setCatalog(null)
        requestAgentModels({ providerId, cwd, signal: controller.signal }).then(result => {
          if (!controller.signal.aborted) setCatalog(result)
        }).catch(failure => {
          if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure))
        }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
        return () => controller.abort()
      }, [providerId, cwd, visible, refresh])
      const current = catalog?.provider_id === providerId ? catalog : null
      const models = current?.models ?? []
      return h('div', null,
        h('label', null, h('div', { style: styles.label }, 'Agent 模型'),
          h('select', { 'aria-label': 'Agent 模型', style: { ...styles.search, marginTop: 5, marginBottom: 0 }, value: value || '', onChange: event => onChange(event.target.value) },
            h('option', { value: '' }, `使用 Agent 默认${current?.current_model ? `（${current.current_model}）` : ''}`),
            value && !models.some(model => model.id === value) ? h('option', { value, disabled: true }, `${value}（${loading ? '读取中' : '当前列表不可用'}）`) : null,
            models.map(model => h('option', { key: model.id, value: model.id }, `${model.label}${model.label === model.id ? '' : ` · ${model.id}`}`)))),
        h('div', { style: { ...styles.row, marginTop: 6 } },
          h('span', { style: error ? styles.error : styles.itemMeta, role: error ? 'alert' : 'status' },
            loading ? '正在读取 Agent 可用模型…' : error || (models.length ? '模型由 Agent 提供，本次选择用于启动和续跑。' : 'Agent 未提供可选模型，将使用其默认配置。')),
          h('button', { type: 'button', style: styles.button, disabled: loading, onClick: () => setRefresh(count => count + 1) }, '刷新模型')))
    }

    function AcpSettingsPanel({ visible }) {
      const [snapshot, setSnapshot] = React.useState(undefined)
      const [draft, setDraft] = React.useState({})
      const [loading, setLoading] = React.useState(false)
      const [saving, setSaving] = React.useState(false)
      const [testing, setTesting] = React.useState(false)
      const [restartRequired, setRestartRequired] = React.useState(false)
      const [notice, setNotice] = React.useState(undefined)

      const loadSettings = React.useCallback(async () => {
        setLoading(true)
        try {
          const value = await requestAcpSettings()
          setSnapshot(value)
          setDraft(acpSettingsDraft(value.providers))
          setNotice(undefined)
        } catch (error) {
          setNotice({ error: true, message: error instanceof Error ? error.message : String(error) })
        } finally { setLoading(false) }
      }, [])

      React.useEffect(() => { if (visible) void loadSettings() }, [loadSettings, visible])

      const setField = (providerId, field, value) => setDraft(current => ({
        ...current, [providerId]: { ...(current[providerId] ?? {}), [field]: value },
      }))
      const save = async () => {
        setSaving(true)
        try {
          const providers = Object.fromEntries((snapshot?.providers ?? []).map(provider => {
            const value = draft[provider.id] ?? {}
            return [provider.id, {
              command: String(value.command ?? '').trim(),
              args: String(value.args ?? '').split(/\r?\n/).map(item => item.trim()).filter(Boolean),
            }]
          }))
          const saved = await saveAcpSettings({ version: 1, providers })
          await loadSettings()
          setRestartRequired(saved.restart_required === true)
          setNotice({ error: false, message: saved.restart_required
            ? '配置已保存。请重启 Harness，使新的启动命令生效。'
            : '配置已保存。' })
        } catch (error) {
          setNotice({ error: true, message: error instanceof Error ? error.message : String(error) })
        } finally { setSaving(false) }
      }
      const testRuntime = async () => {
        setTesting(true)
        try {
          const checks = await testAcpSettings()
          const failures = checks.filter(item => !item.ok)
          setNotice(failures.length === 0
            ? { error: false, message: `运行时契约检查通过：${checks.length} 个 Agent 均已注册。` }
            : { error: true, message: failures.map(item => `${item.label}：${item.reasons.join('；')}`).join('\n') })
        } catch (error) {
          setNotice({ error: true, message: error instanceof Error ? error.message : String(error) })
        } finally { setTesting(false) }
      }

      return h('div', { style: styles.root, role: 'region', 'aria-label': 'Agent Runtime 设置' },
        h('div', { style: styles.sticky }, h('div', { style: styles.header },
          h('div', null, h('div', { style: styles.title }, 'Agent Runtime'), h('div', { style: styles.subline }, '查看本机 Agent 状态。日常直接在“新建分析”选择 Agent 和模型，无需到这里配置。')),
          h('button', { type: 'button', disabled: loading, style: styles.button, onClick: () => { void loadSettings() } }, loading ? '读取中…' : '刷新'))),
        h('div', { style: styles.environmentContent },
          notice ? h('div', { style: { ...styles.card, ...(notice.error ? styles.healthError : styles.healthOk) }, role: notice.error ? 'alert' : 'status' }, notice.message) : null,
          restartRequired && typeof window.dshDesktop?.restartHarness === 'function' ? h('div', { style: styles.card },
            h('div', { style: styles.row }, h('div', { style: styles.itemMeta }, '重启后 Desktop 会重新通过 PowerShell 解析命令并注册 Provider。'),
              h('button', { type: 'button', style: styles.button, onClick: () => { void window.dshDesktop.restartHarness() } }, '立即重启 Harness'))) : null,
          (snapshot?.providers ?? []).map(provider => h('section', { key: provider.id, style: styles.card },
            h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, provider.label),
              h('span', { style: styles.badge }, provider.registered && provider.available ? '已加载' : '未就绪')),
            h('div', { style: styles.itemMeta }, `${acpResolutionLabel(provider.resolution_status)} · ${acpVersionLabel(provider)}`),
            provider.resolution_error ? h('div', { style: styles.error }, provider.resolution_error) : null)),
          h('details', { style: styles.card },
            h('summary', { style: styles.itemTitle }, '高级启动设置与诊断'),
            h('div', { style: { ...styles.itemMeta, margin: '12px 0' } }, '仅命令未找到或使用自定义安装时需要修改。模型列表会从 Agent 自动读取，无需填写。'),
          (snapshot?.providers ?? []).map(provider => {
            const value = draft[provider.id] ?? {}
            return h('section', { key: provider.id, style: styles.environmentSection },
              h('div', { style: styles.environmentSectionHead },
                h('div', { style: styles.environmentSectionTitle }, provider.label),
                h('span', { style: styles.badge }, provider.registered ? 'Provider 已注册' : 'Provider 未注册')),
              h('div', { style: styles.environmentSectionBody },
                h('div', { style: styles.grid },
                  h('div', { style: styles.metric }, h('div', { style: styles.label }, '命令解析'), h('div', { style: styles.value }, acpResolutionLabel(provider.resolution_status))),
                  h('div', { style: styles.metric }, h('div', { style: styles.label }, '版本'), h('div', { style: styles.value }, acpVersionLabel(provider))),
                  h('div', { style: styles.metric }, h('div', { style: styles.label }, '登录状态'), h('div', { style: styles.value }, provider.login_status === 'not_checked' ? '尚未检测' : provider.login_status ?? '未知')),
                  h('div', { style: styles.metric }, h('div', { style: styles.label }, '绝对路径'), h('div', { style: styles.value }, provider.resolved_command ?? '待解析'))),
                provider.resolution_error ? h('div', { style: { ...styles.error, margin: '10px 0' } }, provider.resolution_error) : null,
                provider.version_error ? h('div', { style: { ...styles.healthWarning, margin: '10px 0' } }, `版本检查：${provider.version_error}`) : null,
                provider.kind !== 'claude-code' ? h(React.Fragment, null,
                h('div', { style: styles.environmentField }, h('label', { style: styles.environmentLabel }, '启动命令'), h('input', {
                  style: styles.environmentInput, value: value.command ?? '', onChange: event => setField(provider.id, 'command', event.target.value),
                })),
                h('div', { style: { ...styles.environmentField, marginTop: 13 } }, h('label', { style: styles.environmentLabel }, '启动参数（每行一个）'), h('textarea', {
                  style: styles.textarea, value: value.args ?? '', placeholder: 'acp', onChange: event => setField(provider.id, 'args', event.target.value),
                }))) : null)
            )
          }),
          h('div', { style: styles.environmentActions },
            h('button', { type: 'button', disabled: loading || saving || testing, style: styles.environmentSecondaryButton, onClick: () => { void testRuntime() } }, testing ? '检查中…' : '检查运行时'),
            h('button', { type: 'button', disabled: loading || saving, style: styles.environmentSecondaryButton, onClick: () => { void loadSettings() } }, '放弃修改'),
            h('button', { type: 'button', disabled: loading || saving || !snapshot, style: styles.environmentPrimaryButton, onClick: () => { void save() } }, saving ? '保存中…' : '保存配置')))))
    }

    const COVERAGE_SCOPE_LABELS = { in_scope: '范围内', out_of_scope: '范围外', unresolved: '待确认', unclassified: '未判定' }
    const idList = value => Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
    function flowContentState(flow) {
      return Array.isArray(flow?.mainline_steps) && flow.mainline_steps.length ? '已有步骤' : '流程内容待补齐'
    }

    function CoverageBrowser({ cwd, task, runId, target, revision, acquisition, gaps, flows, filters, onFilter, renderLinks, onReload, onNewQuery }) {
      gaps = Array.isArray(gaps) ? gaps : []
      const [scopeStatus, setScopeStatus] = React.useState('')
      const [flowId, setFlowId] = React.useState('')
      const [position, setPosition] = React.useState({ key: '', cursor: 0 })
      const [response, setResponse] = React.useState(null)
      const [queryDraft, setQueryDraft] = React.useState(acquisition?.query_input ?? task?.coverage_input?.query ?? {})
      const [refreshing, setQueryBusy] = React.useState(false)
      const [refreshError, setRefreshError] = React.useState('')
      const [refreshVersion, setRefreshVersion] = React.useState(0)
      async function refreshQuery() {
        setQueryBusy(true); setRefreshError('')
        try {
          await requestWorkbenchAction({ cwd, action: 'coverage-refresh', payload: { task_id: task.task_id, run_id: runId, query: queryDraft } })
          setRefreshVersion(value => value + 1)
          await onReload?.()
        } catch (error) { setRefreshError(error.message) }
        finally { setQueryBusy(false) }
      }
      const filterKey = JSON.stringify([cwd, task?.task_id, runId, filters, scopeStatus, flowId])
      const cursor = position.key === filterKey ? position.cursor : 0
      const requestKey = JSON.stringify([filterKey, cursor, revision, acquisition?.status, refreshVersion])
      React.useEffect(() => {
        if (!task?.task_id || task.run_id !== runId) return undefined
        let active = true
        requestWorkbenchAction({ cwd, action: 'coverage-page', payload: { task_id: task.task_id, run_id: runId,
          cursor, limit: 50, ...filters, scope_status: scopeStatus, flow_id: flowId } })
          .then(result => {
            if (active && result.run_id === runId) setResponse({ key: requestKey, page: result.page })
          }).catch(error => { if (active) setResponse({ key: requestKey, error: error.message }) })
        return () => { active = false }
      }, [requestKey])
      const bound = task?.task_id && task.run_id === runId
      const result = response?.key === requestKey ? response : null
      const page = bound ? result?.page : acquisition
      const summary = page?.scope_summary ?? acquisition?.scope_summary
      const items = bound ? page?.items ?? [] : gaps.filter(item =>
        (!scopeStatus || (item.scope_status || 'unclassified') === scopeStatus)
        && (!flowId || idList(item.linked_flow_ids).includes(flowId))
        && ['kind', 'source', 'analysis_status', 'disposition'].every(key => !filters[key] || item[key] === filters[key])
        && (!filters.query || JSON.stringify([item.gap_id, item.file_path, item.raw]).toLowerCase().includes(filters.query.toLowerCase())))
      const options = (label, value, change, choices) => h('select', { 'aria-label': label, style: styles.search, value,
        onChange: e => change(e.target.value) }, h('option', { value: '' }, label), choices.map(([id, title]) => h('option', { key: id, value: id }, title)))
      const observed = key => [...new Set([...gaps, ...(page?.items ?? []), ...(key === 'source' ? acquisition?.sources ?? [] : [])]
        .map(g => g[key]).filter(value => typeof value === 'string' && value))].map(v => [v, v])
      const display = value => value && typeof value === 'object' ? JSON.stringify(value) : value
      return h(React.Fragment, null,
        task?.coverage_input?.kind === 'query' ? h('details', { style: styles.card }, h('summary', null, '查询对象与重新获取'),
          [['product', '产品'], ['c_version', 'C 版本'], ['module', '模块'], ['b_version', 'B 版本（可选）']].map(([key, label]) => h('label', { key }, label,
            h('input', { style: styles.search, value: queryDraft[key] || '', onChange: event => setQueryDraft(value => ({ ...value, [key]: event.target.value })) }))),
          h('div', { style: styles.itemMeta }, '产品与版本分别传给查询 Skill。修正原任务前请停止分析；已进入下游分析的任务请基于修正输入新建。'),
          h('button', { type: 'button', style: styles.button, disabled: refreshing, onClick: refreshQuery }, refreshing ? '正在重新获取…' : '修正并重新获取'),
          h('button', { type: 'button', style: styles.button, disabled: refreshing, onClick: () => onNewQuery?.(queryDraft) }, '基于修正输入新建分析'),
          refreshError ? h('div', { role: 'alert', style: styles.error }, refreshError) : null) : null,
        h('div', { style: styles.card }, field('本次分析目标', target),
          h('div', { style: styles.itemMeta }, '报告可能覆盖更多模块；范围归属由分析依据说明。关联用例只表示已设计，不表示已执行或覆盖率提升。')),
        acquisition ? h('div', { style: styles.card }, field('输入获取状态', acquisition.status), field('输入说明', acquisition.message),
          field('实际查询参数', JSON.stringify(acquisition.query_input)), field('平台匹配对象', acquisition.query_resolution ? JSON.stringify(acquisition.query_resolution) : '查询 Skill 未提供'),
          field('解析记录 / 未知 / 待定位', `${acquisition.record_count ?? '—'} / ${acquisition.unknown_count ?? 0} / ${acquisition.unlocated_count ?? 0}`),
          acquisition.tables?.length ? h('details', null, h('summary', null, '工作表与字段映射'), h('pre', { style: styles.source }, JSON.stringify(acquisition.tables, null, 2))) : null,
          stringList('缺失来源', acquisition.missing), stringList('输入限制', acquisition.warnings),
          h('table', { style: { width: '100%', textAlign: 'left' } },
            h('thead', null, h('tr', null, ['来源', '指标', '已覆盖 / 总数', '报告覆盖率'].map(label => h('th', { key: label }, label)))),
            h('tbody', null, (acquisition.sources ?? []).flatMap((source, index) => ['functions', 'lines', 'branches'].filter(kind => source[kind]).map(kind => h('tr', { key: `${index}:${kind}` },
              h('td', null, source.source), h('td', null, kind), h('td', null, `${source[kind].covered} / ${source[kind].total}`), h('td', null, typeof source[kind].rate === 'number' ? `${(source[kind].rate * 100).toFixed(2)}%` : '未提供'))))))) : null,
        summary ? h('div', { style: styles.card, 'aria-label': '覆盖缺口范围统计' },
          field('输入缺口总数', summary.total), h('div', { style: styles.grid }, Object.entries(COVERAGE_SCOPE_LABELS).map(([key, label]) => h('div', { key }, field(label, summary[key])))),
          field('范围内已关联用例的缺口', summary.designed_in_scope)) : h('div', { style: styles.itemMeta }, '范围处置尚未记录。'),
        stringList('追溯待核对', page?.traceability_warnings ?? acquisition?.traceability_warnings),
        h('input', { 'aria-label': '搜索覆盖缺口', style: styles.search, value: filters.query, placeholder: '搜索全部输入的文件、函数或缺口编号', onChange: e => onFilter('query', e.target.value) }),
        h('div', { style: styles.formGrid },
          options('全部范围', scopeStatus, setScopeStatus, Object.entries(COVERAGE_SCOPE_LABELS)),
          options('全部业务流程', flowId, setFlowId, flows.map(f => [f.flow_id, `${f.flow_id} · ${f.title || ''}`])),
          options('全部类型', filters.kind, value => onFilter('kind', value), ['function', 'line', 'branch'].map(v => [v, v])),
          options('全部来源', filters.source, value => onFilter('source', value), observed('source')),
          options('全部分析状态', filters.analysis_status, value => onFilter('analysis_status', value), observed('analysis_status')),
          options('全部补测处置', filters.disposition, value => onFilter('disposition', value), observed('disposition'))),
        result?.error ? h('div', { role: 'alert', style: styles.error }, result.error) : bound && !page ? h('div', { style: styles.itemMeta }, '读取当前页覆盖缺口…') : null,
        h('div', { style: styles.itemMeta }, bound ? `筛选 ${page?.total ?? '—'} 条 · 当前 ${items.length} 条；包含尚未发布分析的原始缺口。` : '当前显示已发布缺口，未记录不表示全部覆盖。'),
        items.map(item => h('details', { key: item.gap_id, style: styles.card },
          h('summary', null, `${item.gap_id} · ${COVERAGE_SCOPE_LABELS[item.scope_status] || '未判定'} · ${item.file_path} · ${item.kind}`),
          field('范围依据', display(item.scope_reason)), stringList('范围证据', item.scope_evidence_ids),
          field('实测状态', item.coverage_status), field('原始记录', JSON.stringify(item.raw)), field('来源', item.source),
          field('源码位置', display(item.source_location)), field('分析状态', item.analysis_status), field('补测处置', item.disposition),
          field('触发路径', display(item.trigger_path)), field('保护条件', display(item.guard_conditions)), field('外部结果', display(item.external_result)),
          field('未决项', display(item.uncertainties)), renderLinks(item))),
        bound ? h('div', { style: styles.chips },
          h('button', { type: 'button', style: styles.button, disabled: cursor === 0, onClick: () => setPosition({ key: filterKey, cursor: Math.max(0, cursor - 50) }) }, '上一页'),
          h('span', null, `第 ${Math.floor(cursor / 50) + 1} 页`),
          h('button', { type: 'button', style: styles.button, disabled: !page || page.next_cursor == null, onClick: () => setPosition({ key: filterKey, cursor: page.next_cursor }) }, '下一页')) : null)
    }

    function PangeaPanel({ ctx, scope, visible, initialScreen = 'overview', pageMode = 'analysis' }) {
      const cwd = scope?.cwd
      const [snapshot, setSnapshot] = React.useState(undefined)
      const [workbench, setWorkbench] = React.useState(undefined)
      const [error, setError] = React.useState(undefined)
      const [workbenchError, setWorkbenchError] = React.useState(undefined)
      const [selectedRun, setSelectedRun] = React.useState(undefined)
      const [selectedTaskId, setSelectedTaskId] = React.useState(ctx?.pangea?.getSelectedTaskId?.())
      const [taskQuery, setTaskQuery] = React.useState('')
      const [taskStatus, setTaskStatus] = React.useState('全部')
      const [loading, setLoading] = React.useState(false)
      const [workbenchLoading, setWorkbenchLoading] = React.useState(false)
      const [repositoryState, setRepositoryState] = React.useState(undefined)
      const [repositoryLoading, setRepositoryLoading] = React.useState(false)
      const [repositoryForm, setRepositoryForm] = React.useState({ sourcePath: '', repositoryName: '' })
      const [repositoryImporting, setRepositoryImporting] = React.useState(false)
      const [repositoryError, setRepositoryError] = React.useState('')
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
      const [environmentForm, setEnvironmentForm] = React.useState(emptyEnvironmentForm)
      const [environmentTests, setEnvironmentTests] = React.useState({ host: { state: 'idle' }, array: { state: 'idle' } })
      const [createForm, setCreateForm] = React.useState({ repository: '', target: '', source_scope_text: '.', asset_ids: [], scenario: 'module-analysis', coverage_kind: 'query', coverage_path: '', coverage_product: '', coverage_version: '', coverage_b_version: '', coverage_module: '', mode: 'depth', provider_id: '', model_route_key: '', agent_model: '' })
      const [assetCatalog, setAssetCatalog] = React.useState(null)
      const [assetCatalogLoading, setAssetCatalogLoading] = React.useState(false)
      const [assetCatalogError, setAssetCatalogError] = React.useState('')
      const [assetSelectorOpen, setAssetSelectorOpen] = React.useState(false)
      const [creatingRun, setCreatingRun] = React.useState(false)
      const [pendingStopRun, setPendingStopRun] = React.useState('')
      const [launchDiagnosticsOpen, setLaunchDiagnosticsOpen] = React.useState(false)
      const [flowQuery, setFlowQuery] = React.useState('')
      const [runDraft, setRunDraft] = React.useState(ctx?.pangea?.getRunDraft?.() ?? { requestId: 0, assetIds: [] })
      const [assetPage, setAssetPage] = React.useState(1)
      const [assetQuery, setAssetQuery] = React.useState('')
      const [assetQueryDraft, setAssetQueryDraft] = React.useState('')
      const [assetType, setAssetType] = React.useState('')
      const [assetRepositoryOnly, setAssetRepositoryOnly] = React.useState(false)
      const [assetRefresh, setAssetRefresh] = React.useState(0)
      const [assetLabels, setAssetLabels] = React.useState({})
      const [flowSelection, setFlowSelection] = React.useState('')
      const [branchSelection, setBranchSelection] = React.useState('')
      const [branchFilter, setBranchFilter] = React.useState('')
      const [diagramType, setDiagramType] = React.useState('workflow')
      const [diagramViews, setDiagramViews] = React.useState([])
      React.useEffect(() => {
        if (!visible || !selectedTaskId) return
        let disposed = false
        let timer
        const poll = async () => {
          try {
            const result = await requestWorkbenchAction({ cwd, action: 'architecture-list', payload: { task_id: selectedTaskId } })
            if (!disposed) setDiagramViews(result.views ?? [])
          } catch { /* Explicit refresh displays errors; a failed poll keeps the last snapshot. */ }
          if (!disposed) timer = window.setTimeout(poll, 3000)
        }
        setDiagramViews([])
        void poll()
        return () => { disposed = true; window.clearTimeout(timer) }
      }, [cwd, selectedTaskId, visible])
      const [diagramSelection, setDiagramSelection] = React.useState('')
      const [diagramBusy, setDiagramBusy] = React.useState(false)
      const [diagramInstruction, setDiagramInstruction] = React.useState('')
      const [gapQuery, setGapQuery] = React.useState('')
      const [gapKind, setGapKind] = React.useState('')
      const [gapSource, setGapSource] = React.useState('')
      const [gapStatus, setGapStatus] = React.useState('')
      const [gapDisposition, setGapDisposition] = React.useState('')
      const [flowReader, setFlowReader] = React.useState({ scope: '', view: 'reader', step: '', query: '', page: 1 })
      const requestRef = React.useRef({ sequence: 0, controller: null })
      const workbenchRequestRef = React.useRef({ sequence: 0, controller: null })
      const snapshotRef = React.useRef(undefined)
      const snapshotFingerprintRef = React.useRef('')
      const handledRunDraftRequest = React.useRef(0)
      const noticeTimerRef = React.useRef(undefined)
      const assetWorkspaceRef = React.useRef(cwd)
      const taskItems = workbench?.tasks?.items ?? []
      const selectedTask = taskItems.find(item => item.task_id === selectedTaskId)
      const selectedDataRoot = selectedTask?.data_root
      const snapshotSelectionKey = JSON.stringify([cwd ?? '', selectedTaskId ?? '', selectedRun === undefined ? '__auto__' : selectedRun ?? '__none__', normalizedPathIdentity(selectedDataRoot)])

      React.useEffect(() => {
        if (!visible) return undefined
        document.body.setAttribute('data-pangea-product-mode', pageMode)
        return () => {
          if (document.body.getAttribute('data-pangea-product-mode') === pageMode) {
            document.body.removeAttribute('data-pangea-product-mode')
          }
        }
      }, [visible, pageMode])

      const load = React.useCallback(async ({ foreground = false } = {}) => {
        if (!cwd) {
          requestRef.current.controller?.abort()
          snapshotRef.current = undefined
          snapshotFingerprintRef.current = ''
          setSnapshot(undefined)
          setError('当前会话没有工作区路径，无法定位 pangea-data。')
          return undefined
        }
        const sequence = ++requestRef.current.sequence
        requestRef.current.controller?.abort()
        const controller = new AbortController()
        requestRef.current.controller = controller
        const showLoading = foreground || snapshotRef.current === undefined
        if (showLoading) setLoading(true)
        try {
          const body = await requestSnapshot({ cwd, dataRoot: selectedDataRoot, runId: selectedRun, sessionId: scope?.sessionId, signal: controller.signal })
          if (sequence !== requestRef.current.sequence) return undefined
          if (!snapshotMatchesSelection(body, { runId: selectedRun, dataRoot: selectedDataRoot, task: selectedTask })) throw new Error('状态响应不属于当前选择的分析任务')
          const fingerprint = snapshotFingerprint(body)
          if (fingerprint === null || fingerprint !== snapshotFingerprintRef.current) {
            snapshotRef.current = body
            snapshotFingerprintRef.current = fingerprint ?? ''
            setSnapshot(body)
          }
          setError(undefined)
          return body
        } catch (reason) {
          if (reason?.name !== 'AbortError' && sequence === requestRef.current.sequence) {
            setError(reason instanceof Error ? reason.message : String(reason))
          }
          return undefined
        } finally {
          if (showLoading && sequence === requestRef.current.sequence) setLoading(false)
        }
      }, [cwd, selectedDataRoot, selectedRun, selectedTask?.run_id, scope?.sessionId])

      const loadWorkbench = React.useCallback(async ({ background = false } = {}) => {
        if (!cwd || pageMode === 'execution') return
        const sequence = ++workbenchRequestRef.current.sequence
        workbenchRequestRef.current.controller?.abort()
        const controller = new AbortController()
        workbenchRequestRef.current.controller = controller
        if (!background) setWorkbenchLoading(true)
        try {
          const body = await requestWorkbench({
            cwd,
            runId: selectedRun === undefined ? snapshot?.current?.run_id : selectedRun,
            taskId: selectedTaskId,
            sessionId: scope?.sessionId,
            cursor: runCursor,
            limit: 20,
            signal: controller.signal,
          })
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
      }, [cwd, pageMode, runCursor, scope?.sessionId, selectedRun, selectedTaskId, snapshot?.current?.run_id])

      const loadEnvironments = React.useCallback(async () => {
        try {
          const values = await requestEnvironments()
          setEnvironments(values)
          setSelectedEnvironment(current => values.some(item => item.id === current) ? current : (values[0]?.id ?? ''))
        } catch (reason) {
          setActionNotice({ message: `无法读取执行环境：${reason instanceof Error ? reason.message : String(reason)}`, isError: true })
        }
      }, [])

      const loadRepositories = React.useCallback(async () => {
        if (!cwd || pageMode !== 'home') return undefined
        setRepositoryLoading(true)
        try {
          const value = await requestRepositoryStatus({ cwd })
          setRepositoryState(value)
          setRepositoryError('')
          return value
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason)
          setRepositoryError(message)
          return undefined
        } finally {
          setRepositoryLoading(false)
        }
      }, [cwd, pageMode])

      React.useEffect(() => {
        snapshotRef.current = undefined
        snapshotFingerprintRef.current = ''
        setSnapshot(undefined)
        setSelectedRun(undefined)
        setSelectedTaskId(undefined)
        setScreen({ type: initialScreen })
        setHistory([])
        setSelectedCaseIds([])
      }, [cwd, initialScreen])
      React.useEffect(() => {
        requestRef.current.sequence += 1
        requestRef.current.controller?.abort()
        snapshotRef.current = undefined
        snapshotFingerprintRef.current = ''
        setSnapshot(undefined)
        setError(undefined)
      }, [snapshotSelectionKey])
      React.useEffect(() => {
        setLaunchDiagnosticsOpen(false)
      }, [selectedTaskId])
      React.useEffect(() => {
        const sync = () => {
          const taskId = ctx?.pangea?.getSelectedTaskId?.()
          if (!taskId || pageMode !== 'analysis') return
          setSelectedTaskId(taskId)
          setScreen({ type: 'overview' })
          setHistory([])
        }
        sync()
        return ctx?.pangea?.subscribeTaskSelection?.(sync)
      }, [ctx?.pangea, pageMode])
      React.useEffect(() => {
        if (pageMode !== 'analysis' || selectedTaskId || selectedRun !== undefined || !workbench?.selected_task_id) return
        setSelectedTaskId(workbench.selected_task_id)
        const task = workbench?.tasks?.items?.find(item => item.task_id === workbench.selected_task_id)
        setSelectedRun(task?.run_id ?? undefined)
        setScreen({ type: 'overview' })
        setHistory([])
      }, [pageMode, selectedRun, selectedTaskId, workbench?.selected_task_id, workbench?.tasks?.items])
      React.useEffect(() => {
        const task = workbench?.tasks?.items?.find(item => item.task_id === selectedTaskId)
        if (!task) return
        const taskRun = task.run_id ?? null
        if (taskRun !== selectedRun) setSelectedRun(taskRun)
      }, [selectedRun, selectedTaskId, workbench?.tasks?.items])
      React.useEffect(() => () => { if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current) }, [])
      React.useEffect(() => {
        const sync = () => setRunDraft(ctx?.pangea?.getRunDraft?.() ?? { requestId: 0, assetIds: [] })
        sync()
        return ctx?.pangea?.subscribeRunDraft?.(sync)
      }, [ctx?.pangea])
      React.useEffect(() => {
        if (pageMode !== 'analysis' || !runDraft?.requestId || runDraft.requestId === handledRunDraftRequest.current) return
        handledRunDraftRequest.current = runDraft.requestId
        if (runDraft.intent === 'select-run' && runDraft.runId) {
          const task = workbench?.tasks?.items?.find(item => item.run_id === runDraft.runId)
          ctx?.pangea?.selectTask?.(task?.task_id)
          setSelectedTaskId(task?.task_id)
          setSelectedRun(runDraft.runId)
          setScreen({ type: 'overview' })
          setHistory([])
          return
        }
        setCreateForm(value => ({ ...value, asset_ids: [...new Set(runDraft.assetIds ?? [])] }))
        setScreen({ type: 'create' })
        setHistory([])
      }, [ctx?.pangea, pageMode, runDraft?.assetIds, runDraft?.intent, runDraft?.requestId, runDraft?.runId, workbench?.tasks?.items])
      React.useEffect(() => {
        const repositories = workbench?.capabilities?.repositories ?? []
        if (repositories.length > 0) setCreateForm(value => value.repository ? value : { ...value, repository: repositories[0] })
      }, [workbench?.capabilities])
      React.useEffect(() => {
        const options = workbench?.acp_providers ?? []
        if (options.length === 0) return
        setCreateForm(value => {
          if (options.some(item => item.id === value.provider_id)) return value
          let remembered = ''
          try { remembered = window.localStorage?.getItem(ACP_PROVIDER_STORAGE_KEY) ?? '' } catch { /* storage unavailable */ }
          const selected = options.some(item => item.id === remembered) ? remembered : options.length === 1 ? options[0].id : ''
          return selected ? { ...value, provider_id: selected } : value
        })
      }, [workbench?.acp_providers])
      React.useEffect(() => {
        const options = (workbench?.model_routing?.models ?? []).filter(item => item.credential_configured === true)
        if (options.length === 0) return
        setCreateForm(value => {
          const current = modelRouteFromKey(value.model_route_key)
          if (current && options.some(item => item.provider === current.provider && item.model === current.model)) return value
          let remembered = ''
          try { remembered = window.localStorage?.getItem(MODEL_ROUTE_STORAGE_KEY) ?? '' } catch { /* storage unavailable */ }
          const rememberedRoute = modelRouteFromKey(remembered)
          const rememberedAvailable = rememberedRoute && options.some(item => item.provider === rememberedRoute.provider && item.model === rememberedRoute.model)
          const selected = rememberedAvailable ? remembered : options.length === 1 ? modelSelectionKey(options[0]) : ''
          return selected ? { ...value, model_route_key: selected } : value
        })
      }, [workbench?.model_routing?.models])
      React.useEffect(() => {
        if (assetWorkspaceRef.current !== cwd) {
          setAssetCatalog(null)
          setAssetLabels({})
          setAssetPage(1)
          setAssetSelectorOpen(false)
          setCreateForm(value => value.asset_ids.length ? { ...value, asset_ids: [] } : value)
        }
        assetWorkspaceRef.current = cwd
      }, [cwd])
      const assetRepositoryFilter = assetRepositoryOnly ? createForm.repository : ''
      React.useEffect(() => {
        if (!assetSelectorOpen || screen.type !== 'create' || !visible || !cwd) return undefined
        const controller = new AbortController()
        setAssetCatalogLoading(true)
        setAssetCatalogError('')
        setAssetCatalog(null)
        void requestAssetCatalog({ cwd, repositoryId: assetRepositoryFilter, page: assetPage,
          query: assetQuery, type: assetType, signal: controller.signal }).then(value => {
          if (controller.signal.aborted) return
          setAssetCatalog(value)
          setAssetLabels(previous => ({ ...previous, ...Object.fromEntries((value.assets ?? []).map(item => [item.asset_id, item])) }))
        }).catch(reason => {
          if (!controller.signal.aborted) setAssetCatalogError(reason instanceof Error ? reason.message : String(reason))
        }).finally(() => {
          if (!controller.signal.aborted) setAssetCatalogLoading(false)
        })
        return () => controller.abort()
      }, [cwd, visible, screen.type, assetSelectorOpen, assetRepositoryFilter, assetPage, assetQuery, assetType, assetRefresh])
      React.useEffect(() => {
        if (!visible || pageMode === 'execution') {
          requestRef.current.controller?.abort()
          return undefined
        }
        let stopped = false
        let timer
        const clearTimer = () => {
          if (timer !== undefined) window.clearTimeout(timer)
          timer = undefined
        }
        const schedule = value => {
          clearTimer()
          const delay = document.visibilityState === 'hidden' ? IDLE_POLL_INTERVAL_MS : snapshotPollInterval(value)
          if (!stopped) timer = window.setTimeout(() => { timer = undefined; void poll() }, delay)
        }
        const poll = async () => {
          if (stopped) return
          const value = await load()
          if (!stopped) schedule(value ?? snapshotRef.current)
        }
        const onVisibilityChange = () => {
          if (stopped || document.visibilityState === 'hidden') return
          clearTimer()
          timer = window.setTimeout(() => { timer = undefined; void poll() }, 0)
        }
        document.addEventListener('visibilitychange', onVisibilityChange)
        timer = window.setTimeout(() => { timer = undefined; void poll() }, 0)
        return () => {
          stopped = true
          clearTimer()
          requestRef.current.controller?.abort()
          document.removeEventListener('visibilitychange', onVisibilityChange)
        }
      }, [load, pageMode, visible])
      React.useEffect(() => {
        if (!visible || pageMode === 'execution') return undefined
        void loadWorkbench()
        return () => workbenchRequestRef.current.controller?.abort()
      }, [loadWorkbench, pageMode, visible])
      React.useEffect(() => { if (visible && pageMode === 'execution') void loadEnvironments() }, [visible, pageMode, loadEnvironments])
      React.useEffect(() => { if (visible && pageMode === 'home') void loadRepositories() }, [visible, pageMode, loadRepositories])

      const snapshotCurrent = snapshot?.current
      const current = snapshotCurrent && snapshotMatchesSelection(snapshot, {
        runId: selectedRun,
        dataRoot: selectedDataRoot,
        task: selectedTask,
      }) ? snapshotCurrent : null
      React.useEffect(() => {
        if (!visible || pageMode === 'execution' || !taskItems.some(task => ['preparing', 'running'].includes(task.status))) return undefined
        let stopped = false
        let timer
        const poll = async () => {
          if (stopped) return
          await loadWorkbench({ background: true })
          if (!stopped) {
            timer = window.setTimeout(poll, document.visibilityState === 'hidden'
              ? WORKBENCH_BACKGROUND_POLL_INTERVAL_MS : WORKBENCH_ACTIVE_POLL_INTERVAL_MS)
          }
        }
        timer = window.setTimeout(poll, 0)
        return () => { stopped = true; window.clearTimeout(timer) }
      }, [loadWorkbench, pageMode, taskItems.some(task => ['preparing', 'running'].includes(task.status)), visible])
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
      React.useEffect(() => {
        if (!visible) return
        const systemState = workbenchError || error || workbench?.compatibility?.compatible === false
          ? { state: 'error', label: '系统异常' }
          : health?.status === 'warning'
            ? { state: 'warning', label: '需要关注' }
            : workbench?.compatibility?.compatible === true
              ? { state: 'ok', label: '系统正常' }
              : { state: 'checking', label: '系统检查中' }
        window.dispatchEvent(new CustomEvent('pangea:system-state', { detail: systemState }))
        const selectedCurrent = selectedTask?.run_id && current?.run_id === selectedTask.run_id ? current : null
        const contextTotal = selectedCurrent?.analysis?.total ?? 0
        const contextCompleted = selectedCurrent?.analysis?.completed ?? 0
        const assistantVisible = pageMode === 'analysis' && selectedTask && !['tasks', 'create'].includes(screen.type)
        const activeConversation = selectedTask?.conversations?.find(item => item.conversation_id === selectedTask.active_conversation_id)
        const activeDiagram = activeConversation?.kind === 'architecture' ? diagramViews.find(view => view.session_id === activeConversation.session_id) : null
        const presentation = deriveRunPresentation(selectedTask, selectedCurrent, selectedCurrent?.reader_health)
        const launchEvents = taskLaunchEvents(selectedTask, workbench)
        const outputEvent = [...launchEvents].reverse().find(event => typeof event?.output === 'string' && event.output.trim() !== '')
        const processStatus = selectedTask?.execution_status
          ?? (selectedTask?.status === 'failed' ? 'failed' : selectedTask?.status === 'completed' ? 'completed' : selectedTask?.status)
          ?? 'preparing'
        window.dispatchEvent(new CustomEvent('pangea:run-context', { detail: assistantVisible ? {
          taskId: selectedTask.task_id,
          workspaceKey: selectedTask.workspace ?? cwd,
          runId: selectedCurrent?.run_id ?? selectedTask.run_id,
          attemptId: selectedTask.attempt_id,
          ownerSessionId: selectedTask.owner_session_id,
          jobId: selectedTask.job_id,
          title: activeConversation?.kind === 'architecture' ? `架构视图 · ${selectedTask.target}` : selectedTask.title,
          processMode: selectedTask.provider ? 'acp' : 'internal',
          phase: activeConversation?.kind === 'architecture' ? activeDiagram?.available ? '图表可查看' : activeDiagram?.error ? '需要处理' : '生成图表' : selectedCurrent ? (selectedCurrent.phase_title ?? PHASE[String(selectedCurrent.phase ?? '').toUpperCase()] ?? PHASE[selectedCurrent.phase] ?? selectedCurrent.phase) : '正在准备',
          percent: contextTotal > 0 ? Math.min(100, Math.round((contextCompleted / contextTotal) * 100)) : 0,
          conversations: selectedTask.conversations ?? [],
          activeConversationId: selectedTask.active_conversation_id,
          activeConversationSessionId: activeConversation?.session_id ?? null,
          activeConversationKind: activeConversation?.kind ?? null,
          presentation,
          processOutput: selectedTask.last_output || outputEvent?.output || '',
          process: activeConversation?.kind === 'architecture' ? {
            status: activeDiagram?.available ? 'completed' : ['failed', 'stopped', 'interrupted'].includes(activeDiagram?.status) ? activeDiagram.status : activeDiagram?.execution_status ?? activeDiagram?.status ?? 'starting',
            output: activeDiagram?.output ?? '', error: activeDiagram?.error ?? '', last_activity_at: activeDiagram?.last_activity_at,
          } : {
            status: processStatus,
            output: selectedTask.last_output || outputEvent?.output || '',
            attemptId: selectedTask.attempt_id,
            error: selectedTask.terminal_error || selectedTask.launch_error || outputEvent?.error || '',
            events: launchEvents.slice(-12).map(event => ({
              at: event?.at, stage: event?.stage,
              label: launchEventLabel(event),
            })),
          },
          onSelectConversation: conversationId => { void selectTaskConversation(conversationId) },
          onCreateConversation: () => { void createTaskConversationForCurrent() },
        } : null }))
      }, [current, error, health?.status, pageMode, screen.type, selectedTask, visible, diagramViews, workbench?.compatibility?.compatible, workbench?.launch_log?.events, workbenchError])
      const methodologyDetailAvailable = workbench?.run?.run_id === current?.run_id && Array.isArray(workbench?.run?.methodologies)
      const methodologyDetailError = workbench?.run_detail?.run_id === current?.run_id && workbench?.run_detail?.status === 'error'
        ? workbench.run_detail.error : ''
      const methodologyManifests = methodologyDetailAvailable ? workbench.run.methodologies : []
      const methodologiesByUnit = new Map(methodologyManifests.map(manifest => [manifest.unit_id, Array.isArray(manifest.items) ? manifest.items : []]))
      const riskEntries = risks.map((item, index) => [hasText(item.risk_id) ? item.risk_id : `__risk__:${index}`, item])
      const caseEntries = testCases.map((item, index) => [hasText(item.test_case_id) ? item.test_case_id : `__case__:${index}`, item])
      const riskById = new Map(riskEntries)
      const caseById = new Map(caseEntries)
      const riskKeyByItem = new Map(riskEntries.map(([key, item]) => [item, key]))
      const caseKeyByItem = new Map(caseEntries.map(([key, item]) => [item, key]))
      const evidenceByKey = new Map(evidence.map(item => [evidenceIdentity(item), item]))
      const unitById = new Map(workflow.units.map(unit => [unit.unit_id, unit]))
      const flowsByUnit = new Map()
      for (const flow of businessFlows) {
        const key = hasText(flow.unit_id) ? flow.unit_id : '__unassigned__'
        if (!flowsByUnit.has(key)) flowsByUnit.set(key, [])
        flowsByUnit.get(key).push(flow)
      }
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
        requestSourceSnippet({ cwd, dataRoot: snapshot.data_root, runId: current?.run_id, location: previewEvidence.location, signal: controller.signal })
          .then(value => setSourcePreview({ key: previewKey, status: 'ready', value }))
          .catch(reason => {
            if (reason?.name !== 'AbortError') setSourcePreview({ key: previewKey, status: 'error', error: reason instanceof Error ? reason.message : String(reason) })
          })
        return () => controller.abort()
      }, [visible, cwd, snapshot?.data_root, previewKey])

      const navigate = React.useCallback((next) => { setHistory(previous => [...previous, screen]); setScreen(next) }, [screen])
      const jump = React.useCallback((type) => { setScreen({ type }); setHistory([]) }, [])
      const goBack = React.useCallback(() => {
        const target = analysisBackTarget(screen.type, { pageMode, selectedTaskId, hasHistory: history.length > 0, initialScreen })
        if (target !== 'history') { setScreen({ type: target }); return }
        setScreen(history[history.length - 1]); setHistory(history.slice(0, -1))
      }, [history, initialScreen, pageMode, screen.type, selectedTaskId])
      function chooseRun(runId) {
        const task = workbench?.tasks?.items?.find(item => item.run_id === runId)
        // Clear a stale task selection when a historical Run has no matching
        // Task record; otherwise the next refresh can attach the new run to
        // the previously selected task and make it look like the latest Run.
        ctx?.pangea?.selectTask?.(task?.task_id)
        setSelectedTaskId(task?.task_id)
        setSelectedRun(runId)
        setScreen({ type: initialScreen })
        setHistory([])
      }

      function chooseTask(task, targetScreen = 'overview') {
        if (!task) return
        ctx?.pangea?.selectTask?.(task.task_id)
        setSelectedTaskId(task.task_id)
        setSelectedRun(task.run_id ?? null)
        setScreen({ type: targetScreen })
        setHistory([])
        const activeConversation = task.conversations?.find(item => item.conversation_id === task.active_conversation_id)
          ?? task.conversations?.[0]
        if (activeConversation?.session_id) {
          ctx?.pangea?.registerProductSession?.(activeConversation.session_id, 'analysis')
          ctx?.sessions?.open?.(activeConversation.session_id)
        }
        openProductPage('analysis', '分析任务', activeConversation?.session_id)
      }

      function openTaskFromWorkbench(task) {
        if (!task) return
        ctx?.pangea?.selectTask?.(task.task_id)
        setSelectedTaskId(task.task_id)
        setSelectedRun(task.run_id ?? null)
        const activeConversation = task.conversations?.find(item => item.conversation_id === task.active_conversation_id)
          ?? task.conversations?.[0]
        if (activeConversation?.session_id) {
          ctx?.pangea?.registerProductSession?.(activeConversation.session_id, 'analysis')
          ctx?.sessions?.open?.(activeConversation.session_id)
        }
        openProductPage('analysis', '分析任务', activeConversation?.session_id)
      }

      async function startTask(task) {
        if (!task || creatingRun) return
        setCreatingRun(true)
        try {
          const resume = Boolean(task.run_id)
          const launched = await requestWorkbenchAction({ cwd, action: 'task-start', payload: { task_id: task.task_id, data_root: task.data_root, resume } })
          ctx?.pangea?.registerProductSession?.(launched.session_id, 'analysis')
          showActionNotice(resume ? '分析任务已从检查点继续。' : '分析任务已启动。')
          ctx?.sessions?.open?.(launched.session_id)
          await loadWorkbench()
        } catch (reason) {
          showActionNotice(`启动失败：${reason instanceof Error ? reason.message : String(reason)}`, true)
          await loadWorkbench()
        } finally {
          setCreatingRun(false)
        }
      }

      async function createTaskConversationForCurrent() {
        if (!selectedTask || creatingRun) return
        setCreatingRun(true)
        try {
          const created = await requestWorkbenchAction({ cwd, action: 'task-conversation-create', payload: { task_id: selectedTask.task_id } })
          ctx?.pangea?.registerProductSession?.(created.session_id, 'analysis')
          ctx?.sessions?.open?.(created.session_id)
          await loadWorkbench()
        } catch (reason) {
          showActionNotice(`无法新建会话：${reason instanceof Error ? reason.message : String(reason)}`, true)
        } finally {
          setCreatingRun(false)
        }
      }

      async function selectTaskConversation(conversationId) {
        if (!selectedTask || !conversationId) return
        const conversation = selectedTask.conversations?.find(item => item.conversation_id === conversationId)
        if (!conversation) return
        try {
          await requestWorkbenchAction({ cwd, action: 'task-conversation-activate', payload: { task_id: selectedTask.task_id, conversation_id: conversationId } })
          ctx?.pangea?.registerProductSession?.(conversation.session_id, 'analysis')
          ctx?.sessions?.open?.(conversation.session_id)
          await loadWorkbench()
        } catch (reason) {
          showActionNotice(`无法切换会话：${reason instanceof Error ? reason.message : String(reason)}`, true)
        }
      }

      function showActionNotice(message, isError = false) {
        if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
        setActionNotice({ message, isError })
        // Errors contain the actionable launch/stop reason.  Keep them on
        // screen until the next user action instead of hiding them after a
        // short toast timeout.
        noticeTimerRef.current = isError ? null : window.setTimeout(() => setActionNotice(undefined), 2600)
      }
      function launchEventLabel(event) {
        const status = event?.status === 'error' ? '失败' : event?.status === 'ok' ? '完成' : event?.status === 'start' ? '开始' : '信息'
        const stage = event?.stage ?? 'unknown'
        const time = event?.at ? formatTime(event.at) : ''
        const detail = event?.error ?? event?.detail ?? event?.message ?? event?.output ?? ''
        const context = [event?.provider, event?.requested_model ? `指定：${event.requested_model}` : null, event?.model, event?.reasoning_effort, event?.job_id, event?.session_id, event?.run_id].filter(Boolean).join(' · ')
        const evidence = [
          ['远端会话', event?.remote_session_id], ['Agent 版本', event?.agent_version],
          ['回合', event?.turn], ['停止原因', event?.stop_reason], ['ACP 停止原因', event?.protocol_stop_reason],
          ['消息事件', event?.message_chunks], ['工具事件', event?.tool_calls], ['工具失败事件', event?.tool_failures],
          ['最近工具', event?.last_tool_id], ['工具状态', event?.last_tool_status],
          ['回合耗时(ms)', event?.turn_duration_ms], ['首个事件(ms)', event?.first_event_ms],
          ['阶段耗时(ms)', event?.duration_ms], ['冻结文件', event?.file_count], ['冻结字节', event?.total_bytes],
          ['源码复制耗时(ms)', event?.snapshot_duration_ms],
          ['Run 阶段', event?.phase], ['完成步骤', event?.completed], ['状态文件', event?.state_path],
          ['错误码', event?.error_code], ['错误摘要', event?.error_summary], ['stderr 摘要', event?.stderr_summary],
          ['进程已退出', event?.process_exited], ['退出码', event?.exit_code], ['退出信号', event?.exit_signal],
          ['stderr 已截断', event?.stderr_truncated], ['输出已截断', event?.output_truncated],
        ].filter(([, value]) => value !== undefined && value !== null && value !== '')
          .map(([label, value]) => `${label}: ${value}`).join('\n')
        return [[time, status, stage, context, detail].filter(Boolean).join(' · '), evidence].filter(Boolean).join('\n')
      }

      async function appendToDiscussionConversation(draft) {
        if (!selectedTask || !hasText(draft)) return false
        let task = selectedTask
        let conversation = writableConversation(task)
        if (!conversation) {
          const created = await requestWorkbenchAction({
            cwd,
            action: 'task-conversation-create',
            payload: { task_id: task.task_id, title: `${task.title} · 讨论` },
          })
          task = created.task ?? task
          conversation = writableConversation(task) ?? { session_id: created.session_id, conversation_id: created.session_id, kind: 'assistant' }
        } else if (conversation.conversation_id !== task.active_conversation_id) {
          const activated = await requestWorkbenchAction({
            cwd,
            action: 'task-conversation-activate',
            payload: { task_id: task.task_id, conversation_id: conversation.conversation_id },
          })
          task = activated.task ?? task
        }
        ctx?.pangea?.registerProductSession?.(conversation.session_id, 'analysis')
        ctx?.sessions?.open?.(conversation.session_id)
        const inserted = appendConversationDraft(ctx, { ...scope, sessionId: conversation.session_id }, draft)
        await loadWorkbench()
        return inserted
      }
      function issueLabel(issue) {
        if (typeof issue === 'string') return issue
        if (!issue || typeof issue !== 'object') return String(issue ?? '未提供详情')
        return [issue.code, issue.step ? `Step ${issue.step}` : '', issue.message ?? issue.detail ?? issue.error].filter(Boolean).join(' · ')
      }
      function renderIssueCard(title, issues, tone = 'warning') {
        if (!Array.isArray(issues) || issues.length === 0) return null
        const cardStyle = tone === 'error' ? styles.error : styles.healthWarning
        return h('div', { style: { ...styles.card, ...cardStyle } },
          h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, title), h('span', { style: styles.badge }, `${issues.length} 条`)),
          h('div', { style: styles.resultGrid }, issues.map((issue, index) => h('div', { key: `${issue?.code ?? 'issue'}:${index}`, style: styles.resultItem }, issueLabel(issue)))))
      }
      function renderAcpRuntime() {
        if (!selectedTask?.provider) return null
        const job = workbench?.acp_job
        const status = job?.status ?? selectedTask.execution_status ?? 'unknown'
        const statusLabel = {
          starting: '正在启动', running: '运行中', stopping: '正在停止',
          completed: '已完成', failed: '失败', killed: '已停止', stopped: '已停止', interrupted: '已中断',
        }[status] ?? status
        return h('div', { style: styles.card },
          h('div', { style: styles.row },
            h('div', null, h('div', { style: styles.itemTitle }, '外部 Agent Runtime'), h('div', { style: styles.itemMeta }, selectedTask.provider)),
            h('span', { style: { ...styles.homeStatus, color: status === 'failed' || status === 'interrupted' ? 'var(--dsw-alias-state-error-primary, #e66767)' : status === 'completed' ? 'var(--dsw-alias-state-success-primary, #38a892)' : 'var(--dsw-alias-state-business-primary, #4d9ad6)' } }, statusLabel)),
          h('div', { style: { ...styles.grid, marginTop: 10 } },
            field('Job ID', selectedTask.job_id ?? '尚未创建'),
            field('PID', selectedTask.process_id ?? '等待进程创建'),
            field('Agent Session', selectedTask.agent_session_id ?? '等待 ACP 会话'),
            field('开始时间', job?.startedAt ? formatTime(job.startedAt) : selectedTask.launch_started_at ? formatTime(selectedTask.launch_started_at) : '尚未启动'),
            field('运行时长', job?.startedAt ? durationLabel(job.startedAt, job.finishedAt ?? Date.now()) : '—'),
            field('最后活动', selectedTask.last_activity_at ? formatTime(selectedTask.last_activity_at) : '等待首个事件')),
          selectedTask.last_output ? h('pre', { style: styles.source }, selectedTask.last_output) : h('div', { style: { ...styles.itemMeta, marginTop: 9 } }, 'Agent 尚未产生可显示的消息输出；运行态与 PID 仍会持续更新。'),
          selectedTask.terminal_error ? h('div', { style: { ...styles.error, marginTop: 9 }, role: 'alert' }, selectedTask.terminal_error) : null)
      }
      function renderLaunchDiagnostics(events) {
        if (!Array.isArray(events) || events.length === 0) return null
        return h('details', {
          style: styles.technical,
          open: launchDiagnosticsOpen,
          onToggle: event => setLaunchDiagnosticsOpen(event.currentTarget.open),
        },
        h('summary', { style: { cursor: 'pointer', fontSize: 12, fontWeight: 600 } }, `启动诊断 · ${events.length} 条${workbench?.launch_log?.truncated ? ' · 仅显示最近记录' : ''}`),
        h('div', { style: { ...styles.card, marginTop: 8, marginBottom: 0 } }, events.map((event, index) => h('div', {
          key: `${event.at ?? index}:${event.stage ?? 'unknown'}:${index}`,
          style: { ...styles.itemMeta, color: event.status === 'error' ? 'var(--dsw-alias-state-error-primary, #e66767)' : undefined, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
        }, launchEventLabel(event)))))
      }
      function openProductPage(pageId, label, sessionId = scope?.sessionId) {
        const opened = ctx?.pangea?.openPage?.({ ...scope, sessionId }, pageId) === true
        if (!opened) showActionNotice(`${label}当前不可用，请检查对应插件是否已加载。`, true)
      }
      function openAnalysisCreate() {
        // The workbench already owns the analysis form state.  Move directly
        // into it instead of sending the user through the task list first.
        setScreen({ type: 'create' })
        setHistory([])
      }
      function openAnalysisRun(run) {
        const task = taskItems.find(item => item.run_id === run?.run_id)
        if (task) {
          openTaskFromWorkbench(task)
          return
        }
        const selected = ctx?.pangea?.requestRunSelection?.(scope, run?.run_id)
        if (!selected) showActionNotice('无法打开该历史 Run，请检查对应插件是否已加载。', true)
      }
      async function discussCurrentRun() {
        if (!current) {
          showActionNotice('当前没有可加入会话的 PANGEA Run。', true)
          return
        }
        const draft = [
          '我正在 PANGEA 测试工作台查看当前运行，请基于下面的工作台上下文协助我判断下一步。',
          '',
          `Run：${current.run_id}`,
          `阶段：${current.phase_title ?? PHASE[current.phase] ?? current.phase ?? '未知'}`,
          `流程：${outcomePresentation(current).workflow}`,
          `交付完整性：${outcomePresentation(current).delivery}`,
          `审查方式：${outcomePresentation(current).review}`,
          `最终语义结论：${outcomePresentation(current).semantic}`,
          `风险：${risks.length} 条（其中 ${risks.filter(isUncoveredRisk).length} 条尚未覆盖，${risks.filter(isUnreachableRisk).length} 条从受支持入口不可达）`,
          `测试用例：${testCases.length} 条`,
          `执行记录：${snapshot?.executor_runs?.length ?? 0} 个`,
          '',
          '请先指出当前最需要处理的一件事，并说明依据。',
        ].join('\n')
        try {
          const inserted = await appendToDiscussionConversation(draft)
          showActionNotice(inserted ? '当前运行上下文已加入讨论会话，可以直接发送。' : '无法访问讨论会话输入框。', !inserted)
        } catch (reason) {
          showActionNotice(`无法打开讨论会话：${reason instanceof Error ? reason.message : String(reason)}`, true)
        }
      }
      function multilineValues(value) {
        return [...new Set(String(value ?? '').split(/\r?\n/).map(item => item.trim()).filter(Boolean))]
      }
      function toggleCreateAsset(assetId) {
        if (!assetId) return
        setCreateForm(value => ({
          ...value,
          asset_ids: value.asset_ids.includes(assetId)
            ? value.asset_ids.filter(item => item !== assetId)
            : [...value.asset_ids, assetId],
        }))
      }
      function repositoryNameFromPath(value) {
        return String(value ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
      }
      async function chooseRepositoryFolder() {
        const picker = window.dshDesktopDirectoryPicker
        if (!picker?.pick) {
          setRepositoryError('当前不是 PANGEA Desktop 原生窗口，无法打开系统文件夹选择器。')
          return
        }
        try {
          const selected = await picker.pick({ purpose: 'repository' })
          if (!selected) return
          setRepositoryForm({ sourcePath: selected, repositoryName: repositoryNameFromPath(selected) })
          setRepositoryError('')
        } catch (reason) {
          setRepositoryError(reason instanceof Error ? reason.message : String(reason))
        }
      }
      async function submitRepositoryImport() {
        if (!cwd || repositoryImporting || !repositoryForm.sourcePath || !repositoryForm.repositoryName.trim()) return
        setRepositoryImporting(true)
        setRepositoryError('')
        try {
          const result = await requestRepositoryImport({
            cwd,
            sourcePath: repositoryForm.sourcePath,
            repositoryName: repositoryForm.repositoryName,
          })
          const nextState = await requestRepositoryStatus({ cwd })
          setRepositoryState(nextState)
          setRepositoryForm({ sourcePath: '', repositoryName: '' })
          setScreen({ type: 'home' })
          setHistory([])
          showActionNotice(`源码仓库“${result.repository.name}”已加入 PANGEA。`)
          await Promise.all([load(), loadWorkbench()])
        } catch (reason) {
          const raw = reason instanceof Error ? reason.message : String(reason)
          const message = raw.includes('repository already exists')
            ? '已存在同名仓库，请修改仓库名称后重试。'
            : raw.includes('outside the PANGEA data directory')
              ? '请选择 pangea-data 目录之外的源码仓库。'
              : raw
          setRepositoryError(message)
        } finally {
          setRepositoryImporting(false)
        }
      }
      function openRepositoryImport() {
        setRepositoryForm({ sourcePath: '', repositoryName: '' })
        setRepositoryError('')
        navigate({ type: 'repository-import' })
      }
      async function submitNewRun() {
        if (!cwd || creatingRun || workbench?.compatibility?.compatible !== true) return
        setCreatingRun(true)
        let createdTask
        try {
          const created = await requestWorkbenchAction({
            cwd,
            action: 'task-create',
            payload: {
              input: buildAnalysisRequest(createForm),
            },
          })
          createdTask = created.task
          ctx?.pangea?.updateRunDraft?.({ assetIds: [] })
          setCreateForm(value => ({ ...value, asset_ids: [] }))
          setWorkbench(value => ({
            ...(value ?? {}),
            tasks: {
              items: [createdTask, ...(value?.tasks?.items ?? []).filter(item => item.task_id !== createdTask.task_id)],
              total: (value?.tasks?.items ?? []).filter(item => item.task_id !== createdTask.task_id).length + 1,
            },
          }))
          ctx?.pangea?.selectTask?.(createdTask.task_id)
          setSelectedTaskId(createdTask.task_id)
          setSelectedRun(createdTask.run_id ?? null)
          setScreen({ type: 'overview' })
          setHistory([])
          showActionNotice(`任务“${createdTask.title}”已创建，正在准备分析。`)
        } catch (reason) {
          showActionNotice(`创建失败：${reason instanceof Error ? reason.message : String(reason)}`, true)
        } finally {
          setCreatingRun(false)
        }
        if (createdTask) await startTask(createdTask)
      }
      async function stopCurrentRun() {
        if (!cwd || !current || current.terminal) return
        try {
          const stopped = await requestWorkbenchAction({ cwd, action: 'stop', payload: { task_id: selectedTask?.task_id, run_id: current.run_id, data_root: snapshot?.data_root } })
          setPendingStopRun('')
          if (stopped.run_stop?.status === 'error') {
            showActionNotice(`Agent 已停止，但 PANGEA 状态同步失败：${stopped.run_stop.error}`, true)
          } else if (stopped.session_cancel?.status === 'error') {
            showActionNotice(`Run 已停止；DSH 会话取消失败：${stopped.session_cancel.error}`, true)
          } else if (stopped.job_stop?.status === 'error') {
            showActionNotice(`Run 已停止；ACP Agent 停止失败：${stopped.job_stop.error}`, true)
          } else if (stopped.job_stop?.result === 'requested') {
            showActionNotice(`已请求停止 ${current.run_id}，等待 ACP Job 确认`)
          } else {
            showActionNotice(`已停止 ${current.run_id}`)
          }
          await Promise.all([load(), loadWorkbench()])
        } catch (reason) {
          showActionNotice(`停止失败：${reason instanceof Error ? reason.message : String(reason)}`, true)
        }
      }
      function toggleCase(testCaseId) {
        if (!hasText(testCaseId)) return
        setSelectedCaseIds(values => values.includes(testCaseId)
          ? values.filter(value => value !== testCaseId)
          : [...values, testCaseId])
      }
      function editEnvironment(environment) {
        setEnvironmentForm({
          id: environment.id,
          name: environment.name,
          advanced: (environment.host?.port ?? 22) !== 22 || (environment.array?.port ?? 22) !== 22,
          host_ip: environment.host?.ip ?? '',
          host_username: environment.host?.username ?? '',
          host_password: environment.host?.password ?? '',
          host_port: String(environment.host?.port ?? 22),
          array_ip: environment.array?.ip ?? '',
          array_username: environment.array?.username ?? '',
          array_password: environment.array?.password ?? '',
          array_port: String(environment.array?.port ?? 22),
        })
        setEnvironmentTests({ host: { state: 'idle' }, array: { state: 'idle' } })
        jump('environment')
      }
      function environmentEndpoint(kind) {
        const prefix = kind === 'host' ? 'host' : 'array'
        const ip = environmentForm[`${prefix}_ip`].trim()
        if (!ip) return null
        return {
          ip,
          username: environmentForm[`${prefix}_username`].trim(),
          password: environmentForm[`${prefix}_password`],
          port: Number(environmentForm[`${prefix}_port`] || 22),
        }
      }
      async function submitEnvironment() {
        try {
          const host = environmentEndpoint('host')
          const array = environmentEndpoint('array')
          if (!environmentForm.name.trim()) throw new Error('请填写环境名称')
          if (!host && !array) throw new Error('请至少配置测试主机或存储阵列')
          const saved = await saveEnvironment({ id: environmentForm.id || undefined, name: environmentForm.name.trim(), host, array })
          await loadEnvironments()
          setSelectedEnvironment(saved.id)
          setEnvironmentForm(emptyEnvironmentForm())
          setEnvironmentTests({ host: { state: 'idle' }, array: { state: 'idle' } })
          showActionNotice(`测试环境 ${saved.name} 已保存。`)
        } catch (reason) {
          showActionNotice(`保存失败：${reason instanceof Error ? reason.message : String(reason)}`, true)
        }
      }
      async function testEnvironment(kind) {
        const endpoint = environmentEndpoint(kind)
        if (!endpoint) {
          setEnvironmentTests(value => ({ ...value, [kind]: { state: 'error', message: '请先填写 IP、用户名和密码' } }))
          return
        }
        setEnvironmentTests(value => ({ ...value, [kind]: { state: 'testing' } }))
        try {
          await testEnvironmentConnection(endpoint)
          setEnvironmentTests(value => ({ ...value, [kind]: { state: 'ok', message: '连接成功' } }))
        } catch (reason) {
          setEnvironmentTests(value => ({ ...value, [kind]: { state: 'error', message: reason instanceof Error ? reason.message : String(reason) } }))
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
      async function exportCurrentCases(format = 'csv') {
        if (!current?.run_id || !snapshot?.data_root) return
        try {
          const result = await requestRunExport({ cwd, dataRoot: snapshot.data_root, runId: current.run_id, format })
          const objectUrl = URL.createObjectURL(result.blob)
          const anchor = document.createElement('a')
          anchor.href = objectUrl
          anchor.download = result.filename
          anchor.style.display = 'none'
          document.body.appendChild(anchor)
          anchor.click()
          anchor.remove()
          window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
          showActionNotice(`测试用例 ${format.toUpperCase()} 已导出。`)
        } catch (reason) {
          showActionNotice(`导出失败：${reason instanceof Error ? reason.message : String(reason)}`, true)
        }
      }
      async function copySelectedCases() {
        const selected = testCases.filter(item => selectedCaseIds.includes(item.test_case_id))
        if (selected.length === 0) {
          showActionNotice('请先选择至少一条已编号用例。', true)
          return
        }
        const content = selected.map(item => [
          `${item.test_case_id} · ${text(item.title, '未命名用例')}`,
          `前置条件：${Array.isArray(item.preconditions) ? item.preconditions.join('；') : text(item.preconditions, '未记录')}`,
          `步骤：${Array.isArray(item.steps) ? item.steps.join('；') : text(item.steps, '未记录')}`,
          `预期：${Array.isArray(item.expected_results) ? item.expected_results.join('；') : text(item.expected_results, '未记录')}`,
        ].join('\n')).join('\n\n')
        try {
          if (!globalThis.navigator?.clipboard?.writeText) throw new Error('当前环境不支持剪贴板写入')
          await globalThis.navigator.clipboard.writeText(content)
          showActionNotice(`已复制 ${selected.length} 条测试用例。`)
        } catch (reason) {
          showActionNotice(`复制失败：${reason instanceof Error ? reason.message : String(reason)}`, true)
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
      async function addToConversation(kind, item, intent = 'review', sourceSnippet) {
        const draft = buildDiscussionDraft({ kind, item, intent, runId: current?.run_id, risks, testCases, sourceSnippet })
        try {
          const inserted = await appendToDiscussionConversation(draft)
          showActionNotice(inserted ? '已加入讨论会话，可以直接发送。' : '无法访问讨论会话输入框。', !inserted)
        } catch (reason) {
          showActionNotice(`无法打开讨论会话：${reason instanceof Error ? reason.message : String(reason)}`, true)
        }
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
            cwd, dataRoot: snapshot?.data_root, runId: current?.run_id, location: item.location,
          })))
          const draft = buildDiscussionDraft({
            kind: 'risk', item: risk, intent, runId: current?.run_id, risks, testCases,
            selectedClaim: selectedRiskClaim, sourceSnippets,
          })
          const inserted = await appendToDiscussionConversation(draft)
          showActionNotice(inserted ? `已加入讨论会话（${selectedEvidence.length} 条证据），可以直接发送。` : '无法访问讨论会话输入框。', !inserted)
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
          h('div', { style: styles.itemMeta }, '带上当前对象、直接证据和关联项，在独立讨论会话中继续。'),
          h('button', { type: 'button', style: { ...styles.primaryButton, marginTop: 9 }, onClick: () => { void addToConversation(kind, item, 'review') } }, '在讨论会话中继续'),
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
        const sourcePath = evidenceFilePath(evidenceItem.location, cwd, snapshot?.data_root, current?.artifacts?.run_directory)
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
      const screenTitle = screen.type === 'home' ? '测试工作台'
        : screen.type === 'tasks' ? '分析任务'
        : screen.type === 'overview' ? 'PANGEA 总览'
        : screen.type === 'create' ? '新建分析'
          : screen.type === 'workflow' ? '运行过程'
          : screen.type === 'coverage' ? '覆盖缺口'
            : screen.type === 'flows' ? '业务流程'
          : screen.type === 'risks' ? '风险'
          : screen.type === 'risk' ? (riskById.get(screen.id)?.risk_id || '风险详情')
            : screen.type === 'cases' ? '测试用例'
              : screen.type === 'case' ? (caseById.get(screen.id)?.test_case_id || '用例详情')
                : screen.type === 'evidence' ? '证据'
                  : screen.type === 'evidence-detail' ? '证据详情'
                    : screen.type === 'execution' ? '执行结果'
                      : screen.type === 'environment' ? (environmentForm.id ? '编辑测试环境' : '新增测试环境')
                        : screen.type === 'repository-import' ? '添加源码仓库' : '复核'

      const navigationItems = pageMode !== 'analysis' || !selectedTask || ['tasks', 'create'].includes(screen.type) ? [] : [
        ['overview', '概览'], ['flows', '业务流程'], ...(current?.scenario === 'coverage-analysis' ? [] : [['risks', '风险']]), ['cases', current?.scenario === 'coverage-analysis' ? '补测用例' : '测试用例'], ['workflow', '运行过程'], ['review', '复核'],
      ]
      const navigation = navigationItems.length ? h('nav', { style: styles.nav, 'aria-label': 'PANGEA 分析页面' }, navigationItems.map(([type, label]) => h('button', {
        key: type,
        type: 'button',
        'aria-current': activeNav === type ? 'page' : undefined,
        style: { ...styles.navButton, ...(activeNav === type ? styles.navActive : {}) },
        onClick: () => jump(type),
      }, label))) : null

      const refreshBusy = loading || workbenchLoading
      function renderRefreshButton() {
        return h('button', {
          type: 'button',
          disabled: refreshBusy,
          'aria-busy': refreshBusy,
          style: { ...styles.button, ...(refreshBusy ? styles.buttonDisabled : {}) },
          onClick: () => { void (pageMode === 'execution' ? loadEnvironments() : Promise.all([load({ foreground: true }), loadWorkbench()])) },
        }, refreshBusy ? '刷新中…' : '刷新')
      }

      const header = h('div', { style: styles.sticky },
        h('div', { style: styles.header },
          h('div', { style: styles.headerLeft },
            screen.type !== 'home' && screen.type !== 'tasks' ? h('button', { type: 'button', style: styles.backButton, onClick: () => {
              if (pageMode === 'analysis' && ['overview', 'risks', 'cases', 'review'].includes(screen.type)) jump('tasks')
              else goBack()
            } }, '← 返回') : null,
            h('div', { style: { minWidth: 0 } },
              h('div', { style: styles.statusRow }, h('span', { style: styles.statusDot, 'aria-hidden': true }), h('div', { style: styles.title }, screenTitle)),
              h('div', { style: styles.subline }, selectedTask
                ? selectedTask.title
                : 'PANGEA 测试平台'))),
          h('div', { style: styles.chips },
            pageMode === 'analysis' && screen.type !== 'create' ? h('button', { type: 'button', disabled: workbench?.compatibility?.compatible !== true, style: { ...styles.button, ...(workbench?.compatibility?.compatible !== true ? styles.buttonDisabled : {}) }, onClick: () => jump('create') }, '新建分析') : null,
            renderRefreshButton())),
        navigation)

      function countCheck(key) { return health?.count_checks?.[key] }
      function displayCount(key, number) {
        const presentation = deriveRunPresentation(selectedTask, current, health)
        if (presentation.countsAvailability === 'unpublished') return '尚未发布'
        if (presentation.countsAvailability === 'unavailable') return '不可读取'
        const check = countCheck(key)
        if (check?.status === 'mismatch') return `${number} / 报告 ${check.report}`
        if (number === null || number === undefined) return '暂不可读取'
        if (presentation.countsAvailability === 'draft') return `${number}（草稿）`
        return String(number)
      }
      function metric(number, name, target, countKey) {
        const props = target ? { type: 'button', onClick: () => jump(target), style: { ...styles.metric, ...styles.metricClickable } } : { style: styles.metric }
        return h(target ? 'button' : 'div', props, h('div', { style: styles.metricNumber }, countKey ? displayCount(countKey, number) : String(number ?? 0)), h('div', { style: styles.metricName }, name))
      }
      function collectionEmpty(key, normal) {
        if (['unpublished', 'unavailable'].includes(deriveRunPresentation(selectedTask, current, health).countsAvailability)) return '结果尚不可用，暂不显示空列表结论。'
        return countCheck(key)?.status === 'mismatch' || health?.status === 'warning' ? '数据读取异常：不能把空列表解释为“没有数据”。' : normal
      }
      function healthStyle(status = deriveRunPresentation(selectedTask, current, health).healthStatus) {
        if (status === 'error') return { ...styles.card, ...styles.healthError }
        if (status === 'warning') return { ...styles.card, ...styles.healthWarning }
        if (status === 'ok') return { ...styles.card, ...styles.healthOk }
        return { ...styles.card, ...styles.notice }
      }
      function renderHealthCard(compact = false) {
        if (!health) return null
        const healthStatus = health.status ?? 'pending'
        const checks = ['risks', 'test_cases', 'business_flows']
          .map(key => [key, health.count_checks?.[key]])
          .filter(([, check]) => check?.report !== null && check?.report !== undefined)
        const names = { risks: '风险', test_cases: '测试用例', business_flows: '业务流程' }
        const warning = healthStatus === 'warning' || healthStatus === 'error'
        return h('div', { style: healthStyle(healthStatus), role: warning ? 'alert' : 'status' },
          h('div', { style: styles.row },
            h('div', { style: styles.itemTitle }, compact && warning ? '数据读取异常' : '数据状态'),
            h('span', { style: styles.badge }, HEALTH[healthStatus] ?? (healthStatus === 'pending' ? '待发布' : healthStatus) ?? '未知')),
          h('div', { style: styles.itemMeta }, `数据源：${SOURCE[current?.data_source] ?? current?.data_source ?? '未知'}`),
          checks.length ? h('div', { style: { ...styles.itemMeta, marginTop: 5 } }, checks.map(([key, check]) => `${names[key]} ${check.structured}${check.status === 'match' ? ' = ' : ' ≠ '}报告 ${check.report}`).join(' · ')) : null,
          warning && healthStatus === 'warning' ? h('div', { style: { ...styles.error, marginTop: 7 } }, '当前结构化结果不可信。尤其当风险/用例显示 0 时，不能解释为“没有风险/用例”。') : null,
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
                field('PANGEA Run', `${runLabel(current)} · ${current.run_id}`),
                field('Agent 状态', liveForRun ? monitoredSession.status === 'running' ? '运行中' : '空闲' : monitoredRun ? '会话已结束或已删除' : '原会话未记录'),
                field('PANGEA 阶段', current.phase_title ?? PHASE[current.phase] ?? current.phase)),
              h('div', { style: { ...styles.itemMeta, marginTop: 10 } }, `状态更新：${current.state_read?.updated_at ?? formatTime(current.state_read?.mtime_ms ?? current.modified_at)}`),
              h('div', { style: styles.itemMeta }, `本次读取：${formatTime(current.state_read?.observed_at)}${error ? '（刷新失败，显示最近成功快照）' : ''}`))),

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
            h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, current.phase_title ?? PHASE[current.phase] ?? current.phase), h('span', { style: styles.badge }, `${completed}/${total}`)),
            h('div', { style: styles.progressTrack }, h('div', { style: { ...styles.progressFill, width: `${percent}%` } })),
            h('div', { style: styles.grid },
              field('已完成分析', `${completed} / ${total}`),
              field('流程状态', outcomePresentation(current).workflow),
              field('交付完整性', outcomePresentation(current).delivery),
              field('审查方式', outcomePresentation(current).review),
              field('最终语义结论', outcomePresentation(current).semantic),
              field('读取状态', HEALTH[health?.status] ?? health?.status ?? '未知')),
            current.delivery_integrity?.issues?.length ? h('div', { style: styles.boundary, role: 'status' },
              current.delivery_integrity.issues.map((item, index) => h('div', { key: index, style: styles.itemMeta },
                item.test_case_id ? `${item.test_case_id}：缺少 ${(item.missing_fields ?? []).map(key => ({ preconditions: '前置条件', steps: '操作步骤', expected_results: '预期结果', observability: '观测方式', cleanup: '清理或恢复' })[key] ?? key).join('、')}` : item.message ?? '正式用例文档缺失'))) : null),

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
          h('div', { style: styles.itemMeta }, '请切换到提供 assets / runs / system 稳定接口的 Codetalks Skill 工作区。'),
          h('div', { style: { ...styles.error, marginTop: 7 } }, workbench.compatibility?.error ?? '无法读取后端能力。'))
      }

      function renderCreate() {
        const repositories = workbench?.capabilities?.repositories ?? []
        const providerOptions = workbench?.acp_providers ?? []
        const modelRouting = workbench?.model_routing ?? { status: 'loading', models: [], failures: [] }
        const modelOptions = (modelRouting.models ?? [])
        const selectedModel = modelRouteFromKey(createForm.model_route_key)
        const selectedModelOption = selectedModel
          ? modelOptions.find(item => item.provider === selectedModel.provider && item.model === selectedModel.model)
          : null
        const selectedProvider = providerOptions.find(item => item.id === createForm.provider_id)
        const compatible = workbench?.compatibility?.compatible === true
        const executionReady = createForm.provider_id
          ? selectedProvider?.registered === true
          : selectedModelOption?.credential_configured === true
        const sourceScope = createForm.source_scope_text.split(/[\n,]/).map(value => value.trim()).filter(Boolean)
        const canSubmit = compatible && createForm.repository && createForm.target.trim() && (sourceScope.length > 0 || createForm.scenario === 'coverage-analysis') && (createForm.scenario !== 'coverage-analysis' || (createForm.coverage_kind === 'file' ? createForm.coverage_path.trim() : createForm.coverage_kind === 'asset' ? Boolean(createForm.coverage_asset_id) : workbench?.capabilities?.coverage_query_skill?.available && createForm.coverage_product.trim() && createForm.coverage_version.trim() && createForm.coverage_module.trim())) && executionReady && !creatingRun
        const assetItems = assetCatalog?.assets ?? []
        const selectedAssets = createForm.asset_ids.map(assetId => assetLabels[assetId] ?? assetItems.find(item => item.asset_id === assetId)
          ?? { asset_id: assetId, title: assetId })
        const assetPagination = assetCatalog?.pagination
        const assetTypeLabels = { requirement: '需求', design: '设计', historical_defect: '历史缺陷', reference: '参考资料', coverage: 'Coverage', test_case_example: '用例示例' }
        const formField = (label, key, placeholder) => h('label', null,
          h('div', { style: styles.label }, label),
          h('input', { style: { ...styles.search, marginTop: 5, marginBottom: 0 }, value: createForm[key], placeholder, onChange: event => setCreateForm(value => ({ ...value, [key]: event.target.value })) }))
        const internalModelFields = !createForm.provider_id ? h(React.Fragment, null,
          h('label', null,
            h('div', { style: styles.label }, '内置 API 模型'),
            h('select', {
              style: { ...styles.search, marginTop: 5, marginBottom: 0 }, value: createForm.model_route_key,
              onChange: event => {
                const key = event.target.value
                setCreateForm(value => ({ ...value, model_route_key: key }))
                try { if (key) window.localStorage?.setItem(MODEL_ROUTE_STORAGE_KEY, key) } catch { /* storage unavailable */ }
              },
            },
            h('option', { value: '' }, modelOptions.length ? '选择已配置模型' : modelRouting.status === 'error' ? '无法读取模型目录' : '没有已配置模型'),
            modelOptions.map(item => h('option', {
              key: `${item.provider}/${item.model}`, value: modelSelectionKey(item), disabled: item.credential_configured !== true,
            }, `${item.provider_name ?? item.provider} · ${item.model_name ?? item.model}${item.credential_configured === true ? '' : ' · 未配置凭证'}`)))),
          selectedModelOption?.reasoning?.efforts?.length ? h('label', null,
            h('div', { style: styles.label }, '推理级别'),
            h('select', {
              style: { ...styles.search, marginTop: 5, marginBottom: 0 }, value: selectedModel?.reasoning_effort ?? '',
              onChange: event => setCreateForm(value => ({ ...value, model_route_key: modelSelectionKey({ ...selectedModel, reasoning_effort: event.target.value }) })),
            }, h('option', { value: '' }, '默认'), selectedModelOption.reasoning.efforts.map(effort => h('option', { key: effort.id, value: effort.id }, effort.name ?? effort.id)))) : null,
        ) : null
        return h(React.Fragment, null,
          renderCompatibility(),
            h('div', { style: { ...styles.card, ...styles.compatibility } },
              h('div', { style: styles.itemTitle }, '分析输入'),
            h('div', { style: styles.itemMeta }, '选择仓库、源码范围、资产和执行 Agent。Run 创建后将只读取这里冻结的源码副本。'),
            h('div', { style: styles.formGrid },
              h('label', null, h('div', { style: styles.label }, '仓库'), h('select', { style: { ...styles.search, marginTop: 5, marginBottom: 0 }, value: createForm.repository, onChange: event => setCreateForm(value => ({ ...value, repository: event.target.value })) },
                h('option', { value: '' }, repositories.length ? '选择仓库' : '没有可用仓库'), repositories.map(repository => h('option', { key: repository, value: repository }, repository)))),
              h('label', null, h('div', { style: styles.label }, '执行方式'), h('select', {
                style: { ...styles.search, marginTop: 5, marginBottom: 0 }, value: createForm.provider_id,
                onChange: event => {
                  const providerId = event.target.value
                  setCreateForm(value => ({
                    ...value,
                    provider_id: providerId,
                    agent_model: '',
                    model_route_key: providerId ? '' : value.model_route_key,
                  }))
                  try { if (providerId) window.localStorage?.setItem(ACP_PROVIDER_STORAGE_KEY, providerId) } catch { /* storage unavailable */ }
                },
              }, h('option', { value: '' }, '内置 API Agent'), providerOptions.map(item => h('option', { key: item.id, value: item.id, disabled: item.registered !== true }, `${item.label}${item.registered === true ? '' : ' · 未加载'}`))))),
              internalModelFields,
              createForm.provider_id ? h(AgentModelSelect, { key: `${cwd}/${createForm.provider_id}`, providerId: createForm.provider_id, cwd, visible, value: createForm.agent_model, onChange: agentModel => setCreateForm(form => ({ ...form, agent_model: agentModel })) }) : null,
              formField('分析目标', 'target', '例如：DHCHAP 认证与恢复路径'),
              h('label', null, h('div', { style: styles.label }, '分析场景'), h('select', {
                style: { ...styles.search, marginTop: 5, marginBottom: 0 }, value: createForm.scenario,
                onChange: event => setCreateForm(value => ({ ...value, scenario: event.target.value, source_scope_text: event.target.value === 'coverage-analysis' && value.source_scope_text === '.' ? '' : value.source_scope_text })),
              },
              h('option', { value: 'module-analysis' }, '模块分析'),
              h('option', { value: 'coverage-analysis' }, '覆盖率分析'),
              h('option', { value: 'issue-regression' }, '问题回归'),
              h('option', { value: 'root-cause' }, '根因定位'),
              h('option', { value: 'special-risk' }, '专项风险'),
              h('option', { value: 'custom' }, '自定义'))),
              createForm.scenario === 'coverage-analysis' ? h('div', { style: { gridColumn: '1 / -1' } },
                h('select', { 'aria-label': '覆盖率输入方式', style: styles.search, value: createForm.coverage_kind, onChange: event => setCreateForm(value => ({ ...value, coverage_kind: event.target.value })) },
                  h('option', { value: 'query' }, '按产品 / 版本 / 模块查询'), h('option', { value: 'file' }, '本地覆盖率文件'), h('option', { value: 'asset' }, '已解析的覆盖率资产')),
                createForm.coverage_kind === 'asset' ? h('select', { 'aria-label': '覆盖率资产', style: styles.search, value: createForm.coverage_asset_id || '', onChange: event => setCreateForm(value => ({ ...value, coverage_asset_id: event.target.value })) },
                  h('option', { value: '' }, '选择覆盖率资产'), selectedAssets.filter(item => item.asset_type === 'coverage').map(item => h('option', { key: item.asset_id, value: item.asset_id }, item.title))) : null,
                createForm.coverage_kind === 'file' ? h(React.Fragment, null,
                  formField('覆盖率文件完整路径', 'coverage_path', '函数覆盖率表、契约表或 combined JSON'),
                  window.dshDesktopDirectoryPicker?.pick ? h('button', { type: 'button', style: styles.button, onClick: async () => {
                    try { const selected = await window.dshDesktopDirectoryPicker.pick({ purpose: 'coverage' }); if (selected) setCreateForm(value => ({ ...value, coverage_path: selected })) }
                    catch (error) { showActionNotice(error.message, true) }
                  } }, '选择覆盖率文件') : null,
                  h('div', { style: styles.itemMeta }, '支持中文函数名、代码路径、覆盖次数等表头；直接导入会自动解析，无需先进入资产管理。'))
                : createForm.coverage_kind === 'query' ? h(React.Fragment, null,
                  h('div', { style: styles.formGrid }, formField('产品', 'coverage_product', '产品名'), formField('C 版本', 'coverage_version', '精确版本，保留空格'), formField('模块', 'coverage_module', '模块名'), formField('B 版本（可选）', 'coverage_b_version', '可不填')),
                  h('div', { style: styles.itemMeta }, workbench?.capabilities?.coverage_query_skill?.available ? '本地覆盖率查询 Skill 已就绪；产品与版本分开传入，平台名称由查询 Skill 匹配。' : '请放入 <PANGEA 解压目录>/local-skills/coverage-query，然后刷新重新检测。')) : null,
                h('div', { style: styles.itemMeta }, '代码范围可留空，由 Agent 从覆盖输入定位所需源码。')) : null,
              h('label', null, h('div', { style: styles.label }, '分析模式'), h('select', {
                style: { ...styles.search, marginTop: 5, marginBottom: 0 }, value: createForm.mode,
                onChange: event => setCreateForm(value => ({ ...value, mode: event.target.value })),
              }, h('option', { value: 'depth' }, '深度型（含独立复核）'), h('option', { value: 'speed' }, '速度型（快速交付）'))),
              h('label', { style: { gridColumn: '1 / -1' } },
                h('div', { style: styles.label }, '源码冻结范围'),
                h('textarea', { 'aria-label': '源码冻结范围', style: { ...styles.textarea, marginTop: 5, minHeight: 72 }, value: createForm.source_scope_text, placeholder: '. 或填写相对仓库根目录的文件/目录，每行一个', onChange: event => setCreateForm(value => ({ ...value, source_scope_text: event.target.value })) }),
                h('div', { style: styles.itemMeta }, '使用 . 表示整个仓库；创建后原始仓库的后续修改不会影响本次 Run。')),
              h('div', { style: { gridColumn: '1 / -1' } },
                h('div', { style: styles.label }, '分析资产'),
                h('div', { style: styles.itemMeta }, '选择本次需要的需求、设计、历史缺陷或参考资料。用例示例仅作为格式与粒度参考。'),
                h('div', { style: { ...styles.chips, marginTop: 7 } }, selectedAssets.length
                  ? selectedAssets.map(item => h('button', { key: item.asset_id, type: 'button', style: styles.badge,
                    'aria-label': `移除资产 ${item.title}`, onClick: () => toggleCreateAsset(item.asset_id),
                  }, `${assetTypeLabels[item.asset_type] ?? '资产'} · ${item.title} ×`))
                  : h('span', { style: styles.itemMeta }, '未选择资产（可直接分析源码）')),
                h('button', { type: 'button', style: { ...styles.button, marginTop: 8 }, onClick: () => setAssetSelectorOpen(value => !value) }, assetSelectorOpen ? '收起资产库' : '从资产库选择'),
                assetSelectorOpen ? h('div', { style: { ...styles.card, marginTop: 8, marginBottom: 0 } },
                  h('form', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 }, onSubmit: event => { event.preventDefault(); setAssetPage(1); setAssetQuery(assetQueryDraft.trim()) } },
                    h('input', { 'aria-label': '搜索可用资产', placeholder: '搜索标题或文件名', style: styles.search, value: assetQueryDraft, onChange: event => setAssetQueryDraft(event.target.value) }),
                    h('select', { 'aria-label': '筛选资产类型', style: styles.button, value: assetType, onChange: event => { setAssetPage(1); setAssetType(event.target.value) } },
                      h('option', { value: '' }, '全部类型'), Object.entries(assetTypeLabels).map(([value, label]) => h('option', { key: value, value }, label))),
                    h('select', { 'aria-label': '资产仓库范围', style: styles.button, value: assetRepositoryOnly ? 'repository' : 'all', onChange: event => { setAssetPage(1); setAssetRepositoryOnly(event.target.value === 'repository') } },
                      h('option', { value: 'all' }, '全部可用资产'), h('option', { value: 'repository', disabled: !createForm.repository }, '仅关联当前仓库')),
                    h('button', { type: 'submit', style: styles.button }, '搜索'),
                    h('button', { type: 'button', style: styles.button, onClick: () => setAssetRefresh(value => value + 1) }, '刷新资产')),
                  assetCatalogLoading ? h('div', { style: styles.itemMeta }, '正在读取可用资产…') : null,
                  assetCatalogError ? h('div', { style: styles.error, role: 'alert' }, assetCatalogError) : null,
                  !assetCatalogLoading && !assetCatalogError && assetCatalog && assetItems.length === 0 ? h('div', { style: styles.itemMeta },
                    assetQuery || assetType || assetRepositoryOnly ? '当前筛选没有结果，可切换为全部可用资产或清除搜索条件。' : `暂无可用资产；待审核 ${assetCatalog.summary?.review ?? 0} 个。可在资产管理中导入或审核，然后返回刷新。`) : null,
                  assetItems.map(item => h('label', { key: item.asset_id, style: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.12))' } },
                    h('input', { type: 'checkbox', checked: createForm.asset_ids.includes(item.asset_id), onChange: () => toggleCreateAsset(item.asset_id) }),
                    h('span', { style: { minWidth: 0 } }, h('span', { style: styles.itemTitle }, item.title), h('span', { style: { ...styles.itemMeta, display: 'block' } }, `${assetTypeLabels[item.asset_type] ?? item.asset_type} · 修订 ${item.revision ?? 1} · ${(item.repository_ids ?? []).join('、') || '未限定仓库'} · ${item.source_name ?? item.source_path}`)))),
                  assetPagination ? h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 } },
                    h('span', { style: styles.itemMeta }, `第 ${assetPagination.page} / ${assetPagination.total_pages} 页 · 共 ${assetPagination.total} 个 · 已选 ${createForm.asset_ids.length} 个`),
                    h('button', { type: 'button', style: styles.button, disabled: assetCatalogLoading || assetPage <= 1, onClick: () => setAssetPage(value => value - 1) }, '上一页'),
                    h('button', { type: 'button', style: styles.button, disabled: assetCatalogLoading || assetPage >= assetPagination.total_pages, onClick: () => setAssetPage(value => value + 1) }, '下一页')) : null) : null),
              ),
            !createForm.provider_id && modelRouting.status === 'error' ? h('div', { style: { ...styles.error, marginTop: 8 }, role: 'alert' }, `模型目录读取失败：${modelRouting.error ?? '未知错误'}`) : null,
            modelRouting.status === 'ok' && modelOptions.length === 0 && !createForm.provider_id ? h('div', { style: { ...styles.healthWarning, marginTop: 8 }, role: 'status' }, '没有可用的内置 API 模型，请先到“设置”配置模型与 API。', h('button', { type: 'button', style: { ...styles.button, marginLeft: 8 }, onClick: () => window.dispatchEvent(new CustomEvent('pangea:open-model-settings', { detail: { mode: 'internal' } })) }, '打开模型设置')) : null,
            createForm.provider_id && selectedProvider?.registered === true ? h('div', { style: { ...styles.itemMeta, marginTop: 8 } }, `${selectedProvider.label} · ${createForm.agent_model ? `指定模型：${createForm.agent_model}` : '使用 Agent 默认模型'} · 推理配置沿用 Agent 默认。`) : null,
            createForm.provider_id && selectedProvider?.registered !== true ? h('div', { style: { ...styles.healthWarning, marginTop: 8 }, role: 'status' }, `${selectedProvider?.label ?? createForm.provider_id} 尚未在当前 Desktop 加载，请检查插件配置。`) : null,
            h('button', { type: 'button', disabled: !canSubmit, style: { ...styles.primaryButton, marginTop: 10, ...(!canSubmit ? styles.buttonDisabled : {}) }, onClick: () => { void submitNewRun() } }, creatingRun ? '正在创建任务…' : '创建分析任务'))
      }

      function renderWorkflow() {
        if (!current) return h('div', { style: styles.card }, h('div', { style: styles.empty }, '选择一个 Run 后查看流程。'))
        const steps = workflow.steps ?? []
        const statusLabel = { pending: '等待', running: '执行中', completed: '已完成', failed: '失败' }
        const publication = current.publication ?? { state: 'pending', revision: 0, step_id: null }
        const publicationLabel = { pending: '阶段结果生成中', draft: '草稿已发布', final: '正式结果已发布', broken: '正式结果不可用' }
        const presentation = deriveRunPresentation(selectedTask, current, health)
        const publicationText = publicationLabel[presentation.publicationLabel] ?? (presentation.publicationLabel === 'pending' ? publicationLabel.pending : presentation.publicationLabel)
        const stepTimings = Object.values(current.performance?.steps ?? {}).filter(item => Number.isInteger(item?.duration_ms))
        const measuredDuration = stepTimings.reduce((total, item) => total + item.duration_ms, 0)
        const formatDuration = value => value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} s`
        const statusColor = status => status === 'failed'
          ? 'var(--dsw-alias-state-error-primary, #e66767)'
          : status === 'completed'
            ? 'var(--dsw-alias-state-success-primary, #38a892)'
            : status === 'running' ? 'var(--dsw-alias-state-business-primary, #4d9ad6)' : '#c7cdd4'
        const stateReadStatus = error ? 'stale' : current.state_read?.status ?? 'unavailable'
        const ack = workflowAckPresentation(workflow, stateReadStatus)
        const publicationRevision = Number.isInteger(publication.revision) && publication.revision > 0 ? ` · revision ${publication.revision}` : ''
        return h(React.Fragment, null,
          h('div', { style: styles.card },
            h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, 'Codetalks Skill 完整流程'), h('span', { style: styles.badge }, `${workflow.completed_steps?.length ?? 0} / ${workflow.steps?.length ?? 0}`)),
            h('div', { style: styles.grid },
              field('核心规则 ACK', ack.label),
              field('当前步骤', workflow.current_step ? `Step ${workflow.current_step}` : current.terminal ? '已结束' : current.phase === 'REVIEW' ? '独立复核' : '等待下一阶段'),
              field('审查方式', outcomePresentation(current).review),
              field('交付完整性', outcomePresentation(current).delivery),
              field('语义复核结论', outcomePresentation(current).semantic),
              field('运行状态', current.phase_title ?? PHASE[current.phase] ?? current.phase),
              field('源码快照', ['frozen', 'verified', 'manifest_verified'].includes(current.source_snapshot?.status) ? `${current.source_snapshot.file_count ?? 0} 个文件，已复制到 Run` : current.source_snapshot?.status === 'legacy_unavailable' ? '历史 Run 未冻结' : '需要检查'),
              field('状态快照', stateReadStatus === 'ok' ? (current.state_read?.updated_at ?? formatTime(current.state_read?.mtime_ms)) : ack.label),
              field('结果发布', `${publicationText}${publicationRevision}${publication.step_id ? ` · Step ${publication.step_id}` : ''}`)),
            h('div', { style: styles.chips },
              current.artifacts?.request ? chip('打开任务请求', () => openSidebarFile(current.artifacts.request, 'Codetalks request.md')) : null,
              current.artifacts?.state ? chip('打开运行状态', () => openSidebarFile(current.artifacts.state, '运行状态.json')) : null,
              current.artifacts?.source_snapshot_manifest ? chip('打开源码快照清单', () => openSidebarFile(current.artifacts.source_snapshot_manifest, 'source manifest.json')) : null)),
          h('div', { style: { ...styles.card, ...styles.notice } },
            h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, '性能观测'), h('span', { style: styles.badge }, '仅用于比较')),
            h('div', { style: styles.grid },
              field('已测步骤', `${stepTimings.length} / ${workflow.steps?.length ?? 0}`),
              field('已记录耗时', stepTimings.length ? formatDuration(measuredDuration) : '等待步骤完成'),
              field('进度更新', current.performance?.progress_updates ?? 0),
              field('产物增量', stepTimings.length ? `${stepTimings.reduce((total, item) => total + (item.artifact_bytes_delta ?? 0), 0)} bytes` : '等待步骤完成')),
            h('div', { style: { ...styles.itemMeta, marginTop: 7 } }, '这些指标用于识别重复写作、上下文压缩和步骤热点，不直接代表分析质量，也不预设并行方案。')),
          workflow.step_progress?.step ? h('div', { style: { ...styles.card, ...styles.notice } },
            h('div', { style: styles.row },
              h('div', { style: styles.itemTitle }, `Step ${workflow.step_progress.step} 当前业务进度`),
              workflow.step_progress.total === null || workflow.step_progress.total === undefined
                ? h('span', { style: styles.badge }, `${workflow.step_progress.completed ?? 0} 个已完成`)
                : h('span', { style: styles.badge }, `${workflow.step_progress.completed ?? 0} / ${workflow.step_progress.total}`)),
            workflow.step_progress.current ? h('div', { style: styles.itemMeta }, `当前处理：${workflow.step_progress.current.id} · ${workflow.step_progress.current.title}`) : null,
            workflow.step_progress.updated_at ? h('div', { style: styles.itemMeta }, `最近更新：${workflow.step_progress.updated_at}`) : null) : null,
          h('div', { style: styles.sectionTitle }, `阶段流程（${workflow.steps?.length ?? 0} 阶段）`),
          h('div', { style: styles.card }, h('div', { style: styles.stageRail }, steps.map(step => h('div', { key: step.step, style: styles.stageItem },
            h('span', { style: { ...styles.stageDot, background: statusColor(step.status) } }),
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('div', { style: styles.itemTitle }, `Step ${step.step} · ${step.title}`),
              step.artifacts?.length ? h('div', { style: styles.chips }, step.artifacts.map(file => chip(file.split(/[\\/]/).pop(), () => openSidebarFile(file)))) : h('div', { style: styles.itemMeta }, '尚无 Markdown 产物')),
            h('span', { style: styles.badge }, statusLabel[step.status] ?? step.status))))),
          current.artifacts?.formal_outputs?.length ? h('div', { style: styles.card },
            h('div', { style: styles.itemTitle }, `正式输出（${current.artifacts.formal_outputs.length}）`),
            h('div', { style: styles.chips }, current.artifacts.formal_outputs.map(file => chip(file.split(/[\\/]/).pop(), () => openSidebarFile(file))))) : null,
          renderIssueCard('未解决事项', workflow.unresolved),
          current.validation?.status === 'failed' ? h('div', { style: { ...styles.card, ...styles.error } },
            h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, '校验失败详情'), h('span', { style: styles.badge }, `${current.validation.error_count ?? current.validation.errors?.length ?? 0} 条`)),
            h('div', { style: styles.resultGrid }, (current.validation.errors ?? []).map((item, index) => h('div', { key: `${item.code}:${index}`, style: styles.resultItem },
              h('div', { style: styles.itemTitle }, `${item.code ?? 'validation_error'}${item.step ? ` · Step ${item.step}` : ''}`),
              h('div', { style: styles.text }, item.message ?? String(item)))))) : null,
          renderIssueCard('错误历史', workflow.error_history, 'error'))
      }

      function linkedItems(item) {
        return h('div', { style: styles.chips },
          idList(item.linked_flow_ids).map(id => chip(id, () => { setFlowSelection(id); setFlowReader({ scope: `${current?.run_id}:${id}`, view: 'reader', step: '', query: '', page: 1 }); setBranchFilter(''); navigate({ type: 'flows' }) })),
          idList(item.linked_branch_ids).map(id => { const owner = businessFlows.find(f => (f.branches ?? []).some(b => b.branch_id === id)); return owner ? chip(id, () => { setFlowSelection(owner.flow_id); setFlowReader({ scope: `${current?.run_id}:${owner.flow_id}`, view: 'reader', step: '', query: id, page: 1 }); setBranchFilter(''); navigate({ type: 'flows' }) }) : h('span', { key: id, style: styles.badge }, `${id} · 路径待核对`) }),
          idList(item.linked_gap_ids).map(id => h('span', { key: id, style: styles.badge }, id)),
          (item.linked_risk_ids ?? []).map(id => chip(id, () => navigate({ type: 'risk', id }))),
          (item.linked_test_case_ids ?? []).map(id => chip(id, () => navigate({ type: 'case', id }))),
          (item.evidence_ids ?? []).map(id => {
            const entry = evidence.find(value => value.evidence_id === id)
            return entry ? chip(id, () => navigate({ type: 'evidence-detail', key: evidenceIdentity(entry) })) : h('span', { key: id, style: styles.badge }, `${id} · 引用待确认`)
          }))
      }

      async function diagramAction(action, extra = {}) {
        if (!selectedTask) return
        setDiagramBusy(true)
        try {
          const result = await requestWorkbenchAction({ cwd, action, payload: { task_id: selectedTask.task_id, ...extra } })
          if (result.session_id) ctx?.pangea?.registerProductSession?.(result.session_id, 'analysis')
          const listed = await requestWorkbenchAction({ cwd, action: 'architecture-list', payload: { task_id: selectedTask.task_id } })
          setDiagramViews(listed.views ?? [])
          if (result.view) setDiagramSelection(result.view.view_id)
        } catch (error) { showActionNotice(`架构视图：${error.message}`, true) }
        finally { setDiagramBusy(false) }
      }

      function renderDiagrams(flow) {
        const views = diagramViews.filter(v => v.run_id === current?.run_id && v.task_id === selectedTask?.task_id && (!v.flow_id || v.flow_id === flow?.flow_id))
        const selected = views.find(v => v.view_id === diagramSelection) ?? views[0]
        const artifactUrl = (format, download = false) => '/api/pangea-companion/architecture-artifact?' + new URLSearchParams({ cwd: cwd || '', task_id: selectedTask.task_id, view_id: selected.view_id, format, ...(download ? { download: '1' } : {}) })
        return h('div', { style: styles.card },
          h('div', { style: styles.itemTitle }, '流程图'),
          h('div', { style: styles.chips },
            h('select', { 'aria-label': '架构图类型', style: styles.button, value: diagramType, onChange: e => setDiagramType(e.target.value) }, [['workflow', '业务流程图'], ['architecture', '模块架构图'], ['sequence', '时序图'], ['lifecycle', '生命周期图'], ['dataflow', '数据流图']].map(([v, label]) => h('option', { key: v, value: v }, label))),
            h('button', { type: 'button', style: styles.button, disabled: diagramBusy || !flow, onClick: () => diagramAction('architecture-create', { type: diagramType, flow_id: flow.flow_id, instruction: '先表达主干步骤和回接关系；分支较多时按挂接步骤及类型分组，组上保留分支数量与编号。仅使用已发布关系，不要把所有分支说明塞进一个节点。' }) }, '生成流程总览'),
            h('button', { type: 'button', style: styles.button, disabled: diagramBusy || !current, onClick: () => diagramAction('architecture-create', { type: 'architecture' }) }, '生成模块架构图'),
            h('button', { type: 'button', style: styles.button, disabled: diagramBusy, onClick: () => diagramAction('architecture-list') }, '刷新架构视图')),
          views.length ? h('select', { 'aria-label': '选择架构视图', style: styles.search, value: selected?.view_id || '', onChange: e => setDiagramSelection(e.target.value) }, views.map(v => h('option', { key: v.view_id, value: v.view_id }, `${businessFlows.find(f => f.flow_id === v.flow_id)?.title || v.flow_id || '模块全景'} · ${{ workflow: '业务流程图', architecture: '模块架构图', sequence: '时序图', lifecycle: '生命周期图', dataflow: '数据流图' }[v.type] || v.type} · ${{ generating: '生成中', ready: '可查看', failed: '失败', stopped: '已停止', interrupted: '状态不可确认' }[v.status] || v.status} · ${v.view_id.slice(0, 8)}`))) : h('div', { style: styles.itemMeta }, '选择一个流程按需生成图表。多分支的条件、回接与证据可在“流程阅读”中逐步查看。'),
          selected ? h(React.Fragment, null,
            selected.branch_ids?.length ? h('div', { style: { ...styles.itemMeta, marginTop: 10 } }, `局部分支图 · 仅包含 ${selected.branch_ids.length} 条分支：${selected.branch_ids.join('、')}`) : null,
            selected.source_revision !== current?.publication?.revision ? h('div', { style: styles.itemMeta }, '此图基于其他分析版本，可按需重新生成。') : null,
            selected.error ? h('div', { style: styles.error }, selected.error) : null,
            selected.available ? h('iframe', { title: 'Archify 架构图', src: artifactUrl('html'), sandbox: 'allow-scripts allow-downloads', style: { width: '100%', height: '72vh', minHeight: 480, border: '1px solid #e5e8ec', borderRadius: 8, marginTop: 12 } }) : null,
            h('div', { style: styles.chips },
              selected.session_id ? h('button', { type: 'button', style: styles.button, onClick: async () => {
                try {
                  await requestWorkbenchAction({ cwd, action: 'task-conversation-activate', payload: { task_id: selectedTask.task_id, conversation_id: selected.session_id } })
                  ctx?.pangea?.registerProductSession?.(selected.session_id, 'analysis')
                  await loadWorkbench()
                  ctx?.sessions?.open?.(selected.session_id)
                } catch (error) { showActionNotice(`无法打开画图会话：${error.message}`, true) }
              } }, '打开画图会话') : null,
              selected.output ? h('details', null, h('summary', null, '画图过程输出'), h('pre', { style: styles.source }, selected.output)) : null,
              selected.last_activity_at ? h('div', { style: styles.itemMeta }, `最近活动：${selected.last_activity_at}`) : null,
              selected.status === 'generating' ? h('button', { type: 'button', style: styles.button, disabled: diagramBusy, onClick: () => diagramAction('architecture-stop', { view_id: selected.view_id }) }, '停止本次画图') : null,
              selected.available ? ['html', 'svg'].map(format => h('a', { key: format, style: styles.chip, href: artifactUrl(format, true), download: `diagram.${format}` }, `导出 ${format.toUpperCase()}`)) : null),
            h('input', { 'aria-label': '架构图修改要求', style: styles.search, value: diagramInstruction, placeholder: '例如：展开超时分支', onChange: e => setDiagramInstruction(e.target.value) }),
            h('button', { type: 'button', style: styles.button, disabled: diagramBusy || selected.status === 'generating', onClick: () => diagramAction('architecture-create', { type: selected.type, flow_id: selected.flow_id, previous_view_id: selected.view_id, instruction: diagramInstruction }) }, '从当前图创建修改会话')) : null)
      }

      function renderFlows() {
        const query = flowQuery.trim().toLowerCase()
        const filtered = businessFlows.filter(flow => !query || [flow.flow_id, flow.title, flow.description, flow.entry].join(' ').toLowerCase().includes(query))
        const flow = filtered.find(item => item.flow_id === flowSelection) ?? filtered[0]
        const scope = `${current?.run_id}:${flow?.flow_id}`
        const reader = flowReader.scope === scope ? flowReader : { scope, view: 'reader', step: '', query: '', page: 1 }
        const updateReader = changes => { setFlowReader({ ...reader, ...changes }); setBranchSelection('') }
        const steps = Array.isArray(flow?.mainline_steps) ? flow.mainline_steps : []
        const structured = Array.isArray(flow?.mainline_steps)
        const allBranches = Array.isArray(flow?.branches) ? flow.branches : []
        const unbound = item => !steps.some(step => step.step_id === item.from_step_id)
        const step = steps.find(item => item.step_id === reader.step)
        const kindLabels = { normal: '正常', exception: '异常', timeout: '超时', retry: '重试', recovery: '恢复', concurrency: '并发' }
        const stepTitle = id => { const item = steps.find(s => s.step_id === id); return item ? `${id} · ${item.title || '未命名步骤'}` : id || '未挂接' }
        const destination = item => item.to_step_id ? stepTitle(item.to_step_id) : item.terminal_result || '回接 / 结束待确认'
        const highRisk = item => (item.linked_risk_ids ?? []).some(id => { const risk = riskById.get(id); return ['P0', 'P1'].includes(risk?.priority) || ['critical', 'high', '严重', '高'].includes(risk?.severity) })
        const branches = allBranches.filter(item => (!reader.step || (reader.step === '__unbound' ? unbound(item) : item.from_step_id === reader.step))
          && (!reader.query.trim() || [item.branch_id, item.condition, item.processing, item.result, destination(item)].join(' ').toLowerCase().includes(reader.query.trim().toLowerCase()))
          && (!branchFilter || (branchFilter === 'high_risk' ? highRisk(item) : branchFilter === 'no_case' ? !(item.linked_test_case_ids?.length) : branchFilter === 'unresolved' ? item.status === 'unresolved' : item.kind === branchFilter)))
        const pages = Math.max(1, Math.ceil(branches.length / 12))
        const page = Math.min(reader.page, pages)
        const pageBranches = branches.slice((page - 1) * 12, page * 12)
        const branch = pageBranches.find(item => item.branch_id === branchSelection) ?? pageBranches[0]
        const selectedStyle = { background: '#fff3f3', borderColor: '#d88d92', color: '#9e0710' }
        const toolbar = { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }
        const columns = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))', gap: '0 18px' }
        const stepButton = (id, label, count, aria) => h('button', { key: id, type: 'button', 'aria-label': aria, 'aria-pressed': reader.step === id,
          style: { ...styles.runButton, display: 'flex', justifyContent: 'space-between', gap: 10, width: '100%', marginBottom: 6, ...(reader.step === id ? selectedStyle : {}) },
          onClick: () => updateReader({ step: id, page: 1 }) }, h('span', null, label), h('span', { style: styles.badge }, `${count} 分支`))
        return h(React.Fragment, null,
          (details.flow_documents ?? []).length ? h('details', { style: styles.card }, h('summary', null, '流程原文与解析状态'),
            details.flow_documents.map(document => h('div', { key: document.path },
              chip(document.title, () => openSidebarFile(`${current.artifacts.run_directory}/${document.path}`)),
              h('span', null, document.status === 'parsed' ? ' · 已读取步骤（活文档草稿）' : ' · 原文已生成，步骤暂未解析')))) : null,
          h('div', { style: { ...styles.card, marginBottom: 12 } },
            h('div', { style: toolbar },
              h('input', { style: { ...styles.search, flex: '1 1 180px', minWidth: 0, width: 'auto', margin: 0 }, value: flowQuery, 'aria-label': '搜索业务流程', placeholder: '搜索流程名称或入口…', onChange: event => setFlowQuery(event.target.value) }),
              h('select', { style: { ...styles.search, flex: '2 1 230px', minWidth: 0, maxWidth: '100%', width: 'auto', margin: 0 }, 'aria-label': '选择业务流程', value: flow?.flow_id || '', onChange: event => { setFlowSelection(event.target.value); setBranchSelection('') } }, filtered.map(item => h('option', { key: item.flow_id, value: item.flow_id }, `${item.flow_id} · ${item.title || '未命名流程'}`))),
              h('div', { role: 'group', 'aria-label': '流程展示方式', style: toolbar }, ['reader', 'diagram'].map(view => h('button', { key: view, type: 'button', 'aria-label': view === 'reader' ? '流程阅读视图' : '流程图视图', 'aria-pressed': reader.view === view, style: { ...styles.button, ...(reader.view === view ? selectedStyle : {}) }, onClick: () => { setFlowReader({ ...reader, view }); if (view === 'diagram') void diagramAction('architecture-list') } }, view === 'reader' ? '流程阅读' : '流程图')))),
            flow ? h('div', { style: { ...styles.itemMeta, marginTop: 10 } }, `${steps.length ? `${steps.length} 个主干步骤` : flowContentState(flow)} · ${allBranches.length} 条分支 · ${allBranches.filter(b => b.status === 'unresolved').length} 条待确认 · ${allBranches.filter(b => !b.linked_test_case_ids?.length).length} 条未关联用例`) : null),
          !flow ? h('div', { style: styles.empty }, query ? '没有匹配的业务流程，请调整搜索。' : collectionEmpty('business_flows', '当前 Run 没有业务流程。'))
            : reader.view === 'diagram' ? renderDiagrams(flow)
              : h(React.Fragment, null,
                h('div', { style: { marginBottom: 14 } }, h('div', { style: styles.itemTitle }, flow.title || '流程'), h('div', { style: styles.itemMeta }, flow.description || flow.entry), linkedItems(flow)),
                flow.document_status === 'live_draft' ? h('div', { role: 'status', style: styles.notice }, '当前显示活文档步骤草稿；正式发布状态以阶段投影为准。') : null,
                !steps.length ? h('div', { role: 'status', style: { ...styles.card, ...styles.notice } }, '尚无可解析的主干步骤。请查看上方流程原文；这不表示流程没有步骤，也不表示分析已完成。') : null,
                h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'start' } },
                  h('aside', { 'aria-label': '主干步骤', style: { ...styles.card, flex: '1 1 210px', minWidth: 0, maxHeight: '65vh', overflowY: 'auto' } },
                    h('div', { style: { ...styles.itemTitle, marginBottom: 12 } }, '主干步骤'),
                    stepButton('', '全部步骤', allBranches.length, '查看全部分支'),
                    steps.map((item, index) => stepButton(item.step_id, `${String(index + 1).padStart(2, '0')}  ${item.title || item.step_id}`, allBranches.filter(b => b.from_step_id === item.step_id).length, `查看步骤 ${item.step_id} 的分支`)),
                    allBranches.some(unbound) ? stepButton('__unbound', '未挂接步骤', allBranches.filter(unbound).length, '查看未挂接分支') : null,
                    !structured ? h('div', null, h('div', { style: styles.itemMeta }, '旧格式流程内容'), stringList('步骤', flow.steps, true), flow.mermaid ? h('pre', { style: styles.source }, flow.mermaid) : null) : null,
                    (flow.evidence ?? []).map((item, index) => chip(item.location ?? `证据 ${index + 1}`, () => navigate({ type: 'evidence-detail', key: evidenceIdentity(item) })))),
                  h('section', { 'aria-label': '分支阅读区', style: { flex: '3 1 460px', minWidth: 0 } },
                    step ? h('details', { key: step.step_id, style: { ...styles.card, marginBottom: 12 } }, h('summary', { style: { ...styles.itemTitle, cursor: 'pointer' } }, `${stepTitle(step.step_id)} · 步骤详情`),
                      h('div', { style: columns }, field('外部动作', step.external_action), field('内部处理', step.processing), field('状态变化', step.state_change), field('外部表现', step.external_observation)), linkedItems(step)) : null,
                    h('div', { style: styles.card },
                      h('div', { style: { ...styles.row, marginBottom: 12 } }, h('div', { style: styles.itemTitle }, reader.step === '__unbound' ? '未挂接的分支' : step ? `${step.title || step.step_id}的分支` : '全部分支'), h('span', { style: styles.badge }, `${branches.length} 条`)),
                      h('div', { style: toolbar },
                        h('input', { style: { ...styles.search, flex: '1 1 170px', width: 'auto', margin: 0 }, value: reader.query, 'aria-label': '搜索分支', placeholder: '搜索条件、处理或回接…', onChange: event => updateReader({ query: event.target.value, page: 1 }) }),
                        h('select', { style: { ...styles.search, width: 'auto', margin: 0 }, value: branchFilter, 'aria-label': '筛选分支', onChange: event => { setBranchFilter(event.target.value); updateReader({ page: 1 }) } },
                          [['', '全部分支'], ['high_risk', '关联高风险'], ...Object.entries(kindLabels), ['unresolved', '待确认'], ['no_case', '未关联用例']].map(([id, label]) => h('option', { key: id, value: id }, label)))),
                      h('div', { key: JSON.stringify([scope, reader.step, reader.query, branchFilter, page]), style: { marginTop: 12, maxHeight: '42vh', overflowY: 'auto' }, 'aria-label': '分支列表' }, pageBranches.map(item => h('button', { key: item.branch_id, type: 'button', 'aria-label': `查看分支 ${item.branch_id}`, 'aria-pressed': item === branch,
                        style: { ...styles.runButton, width: '100%', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, marginBottom: 6, ...(item === branch ? selectedStyle : {}) }, onClick: () => setBranchSelection(item.branch_id) },
                        h('div', { style: { minWidth: 0, overflowWrap: 'anywhere' } }, h('div', { style: styles.itemTitle }, `${item.branch_id} · ${item.condition || '条件待确认'}`), h('div', { style: styles.itemMeta }, `${stepTitle(item.from_step_id)} → ${destination(item)}`)),
                        h('span', { style: styles.badge }, kindLabels[item.kind] || item.kind || '分支')))),
                      !branches.length ? h('div', { style: styles.empty }, allBranches.length ? '当前步骤与筛选条件下没有分支。' : '本流程未提供分支记录。') : null,
                      h('div', { style: { ...toolbar, justifyContent: 'space-between', marginTop: 10 } }, h('span', { style: styles.itemMeta, role: 'status' }, `第 ${page} / ${pages} 页 · 共 ${branches.length} 条`), h('div', { style: toolbar },
                        h('button', { type: 'button', 'aria-label': '绘制本页分支', disabled: diagramBusy || !pageBranches.length || !selectedTask, style: styles.button, onClick: async () => {
                          setFlowReader({ ...reader, view: 'diagram' })
                          await diagramAction('architecture-create', { type: 'workflow', flow_id: flow.flow_id, branch_ids: pageBranches.map(item => item.branch_id),
                            instruction: `绘制局部分支图：${flow.title || flow.flow_id}，${step ? stepTitle(step.step_id) : reader.step === '__unbound' ? '未挂接步骤' : '全部步骤'}。本页 ${pageBranches.length} 条，筛选结果 ${branches.length} 条，第 ${page}/${pages} 页。分支编号：${pageBranches.map(item => item.branch_id).join('、')}。按来源步骤排列分支，清楚标出回接或终止。标题注明“局部分支”；未提供的关系标记待确认。` })
                        } }, '绘制本页分支'),
                        h('button', { type: 'button', 'aria-label': '上一页分支', disabled: page === 1, style: styles.button, onClick: () => updateReader({ page: page - 1 }) }, '上一页'),
                        h('button', { type: 'button', 'aria-label': '下一页分支', disabled: page === pages, style: styles.button, onClick: () => updateReader({ page: page + 1 }) }, '下一页')))),
                    branch ? h('details', { key: branch.branch_id, open: true, style: { ...styles.card, marginTop: 12 }, 'aria-label': '分支详情' },
                      h('summary', { style: { ...styles.itemTitle, cursor: 'pointer' } }, `${branch.branch_id} · 分支详情`),
                      h('div', { style: columns }, field('进入条件', branch.condition), field('处理', branch.processing), field('结果', branch.result), field('残留状态', branch.residual_state), field('外部表现', branch.external_observation), field('回接 / 结束', destination(branch)), field('分析状态', branch.status)),
                      branch.to_step_id && steps.some(item => item.step_id === branch.to_step_id) ? h('button', { type: 'button', style: styles.chip, onClick: () => updateReader({ step: branch.to_step_id, page: 1 }) }, `定位回接步骤 ${branch.to_step_id}`) : null,
                      linkedItems(branch)) : null))))
      }

      function renderCoverage() {
        const acquisition = workbench?.run?.run_id === current?.run_id ? workbench.run.coverage : null
        const setters = { query: setGapQuery, kind: setGapKind, source: setGapSource, analysis_status: setGapStatus, disposition: setGapDisposition }
        return h(CoverageBrowser, { key: current?.run_id, cwd, task: selectedTask, runId: current?.run_id,
          target: current?.target, revision: current?.publication?.revision, acquisition,
          gaps: details.coverage_gaps ?? [], flows: businessFlows,
          filters: { query: gapQuery, kind: gapKind, source: gapSource, analysis_status: gapStatus, disposition: gapDisposition },
          onReload: loadWorkbench,
          onNewQuery: query => {
            setCreateForm(value => ({ ...value, source_task_id: selectedTask.task_id, repository: selectedTask.repository, target: selectedTask.target,
              source_scope_text: selectedTask.source_scope.join('\n'), asset_ids: selectedTask.asset_ids,
              scenario: 'coverage-analysis', mode: selectedTask.mode, provider_id: selectedTask.provider || '',
              agent_model: selectedTask.agent_model || '', model_route_key: selectedTask.model_route ? modelSelectionKey(selectedTask.model_route) : '',
              coverage_kind: 'query', coverage_product: query.product || '', coverage_version: query.c_version || '',
              coverage_module: query.module || '', coverage_b_version: query.b_version || '' }))
            setScreen({ type: 'create' })
          },
          onFilter: (key, value) => setters[key](value), renderLinks: linkedItems })
      }

      function renderRepositoryImport(firstUse = false) {
        const folderReady = Boolean(repositoryForm.sourcePath)
        const copyReady = folderReady && Boolean(repositoryForm.repositoryName.trim())
        const step = (number, title, copy, active) => h('div', { style: styles.onboardingStep },
          h('span', { style: { ...styles.onboardingStepDot, background: active ? '#c7000b' : '#c7cdd4' }, 'aria-hidden': true }),
          h('div', { style: styles.onboardingStepTitle }, `${number}. ${title}`),
          h('div', null, copy))
        return h('div', { style: styles.onboardingShell },
          h('section', { style: styles.onboardingCard, 'aria-labelledby': 'pangea-repository-title' },
            h('div', { style: styles.onboardingEyebrow }, firstUse ? '首次使用' : '源码仓库'),
            h('div', { id: 'pangea-repository-title', style: styles.onboardingTitle }, firstUse ? '初始化 PANGEA 测试工作区' : '添加源码仓库'),
            h('div', { style: styles.onboardingLead }, firstUse
              ? 'PANGEA 已准备好本地数据目录。请选择一个源码仓库，Desktop 会完整复制到 pangea-data，之后的分析、资产和报告都在该工作区内完成。'
              : '选择新的源码目录并复制到 PANGEA 数据区。原目录不会被修改，已有同名仓库也不会被覆盖。'),
            h('div', { style: styles.onboardingRail, 'aria-label': '初始化进度' },
              step('01', '数据目录', 'PANGEA 数据结构已就绪', true),
              step('02', '选择仓库', folderReady ? '已选择源码目录' : '等待选择源码目录', folderReady),
              step('03', '安全复制', repositoryImporting ? '正在复制，请保持窗口打开' : copyReady ? '可以开始复制' : '等待仓库信息', repositoryImporting)),
            h('div', { style: styles.repositoryPicker },
              h('div', { style: styles.repositoryPickerRow },
                h('div', null,
                  h('label', { style: styles.environmentLabel }, '源码仓库目录'),
                  h('div', { style: styles.repositoryPath, title: repositoryForm.sourcePath || undefined }, repositoryForm.sourcePath || '尚未选择文件夹')),
                h('button', { type: 'button', disabled: repositoryImporting, style: styles.environmentSecondaryButton, onClick: () => { void chooseRepositoryFolder() } }, '选择文件夹')),
              h('div', { style: { marginTop: 16 } },
                h('label', { style: styles.environmentLabel }, '仓库名称'),
                h('input', {
                  style: styles.environmentInput,
                  value: repositoryForm.repositoryName,
                  disabled: repositoryImporting,
                  placeholder: '选择文件夹后自动填写，也可以修改',
                  onChange: event => setRepositoryForm(value => ({ ...value, repositoryName: event.target.value })),
                })),
              h('div', { style: styles.repositoryHint }, '将保留完整源码与 .git 历史。复制过程先写入临时目录，成功后一次性加入仓库列表。')),
            repositoryError ? h('div', { style: { ...styles.error, marginTop: 15 }, role: 'alert' }, repositoryError) : null,
            h('div', { style: styles.repositoryActions },
              !firstUse ? h('button', { type: 'button', disabled: repositoryImporting, style: styles.environmentSecondaryButton, onClick: goBack }, '取消') : null,
              h('button', {
                type: 'button',
                disabled: !copyReady || repositoryImporting,
                'aria-busy': repositoryImporting,
                style: { ...styles.redButton, ...(!copyReady || repositoryImporting ? styles.buttonDisabled : {}) },
                onClick: () => { void submitRepositoryImport() },
              }, repositoryImporting ? '正在复制源码仓库…' : firstUse ? '完成初始化' : '添加仓库'))))
      }

      function renderHome() {
        if (repositoryState?.onboarding_required) return renderRepositoryImport(true)
        const runItems = workbench?.runs?.items ?? snapshot?.runs ?? []
        const runningTasks = taskItems.filter(task => ['preparing', 'starting', 'running', 'stopping'].includes(task.execution_status) || ['preparing', 'running'].includes(task.status))
        const attentionTasks = taskItems.filter(task => ['needs_attention', 'failed'].includes(task.status))
        const completedTasks = taskItems.filter(task => task.status === 'completed')
        const reportRuns = runItems.filter(run => run.report_available === true)
        const workRows = attentionTasks.slice(0, 4)
        const reportRows = reportRuns.slice(0, 5)
        const metricCard = (kind, color, label, value, caption) => h('section', { style: styles.metricCard, title: caption },
          dashboardIcon(kind, color),
          h('div', null, h('div', { style: styles.metricLabel }, label), h('div', { style: { ...styles.metricValue, color } }, value)),
          h('span', { style: { ...styles.metricAccent, background: color }, 'aria-hidden': true }))
        const appCard = (kind, title, copy, onClick) => h('button', {
          type: 'button', style: styles.appCard, onClick,
        }, h('span', { style: styles.appMark, 'aria-hidden': true }, appGlyph(kind)),
        h('span', null, h('span', { style: styles.appTitle }, title), h('span', { style: { ...styles.appCopy, display: 'block' } }, copy)),
        h('span', { style: styles.appArrow, 'aria-hidden': true }, '›'))
        const runUpdatedAt = run => run.updated_at ?? run.updated_at_ms ?? run.completed_at ?? run.created_at

        return h(React.Fragment, null,
          h('section', { style: styles.homeHero },
            h('div', null,
              h('div', { style: styles.homeTitle }, '测试工作台')),
            h('div', { style: { display: 'flex', gap: 10 } },
              h('button', { type: 'button', style: { ...styles.environmentSecondaryButton, height: 42 }, onClick: openRepositoryImport }, '添加仓库'),
              h('button', { type: 'button', disabled: workbench?.compatibility?.compatible !== true, style: { ...styles.button, ...styles.redButton, ...(workbench?.compatibility?.compatible !== true ? styles.buttonDisabled : {}) }, onClick: openAnalysisCreate }, '新建分析'))),
          h('div', { style: styles.metricGrid, 'aria-label': '任务指标' },
            metricCard('running', '#2f7acb', '进行中', runningTasks.length, '正在准备或分析中的任务'),
            metricCard('review', '#cf0a2c', '需要处理', attentionTasks.length, '需要用户继续判断或重新启动的任务'),
            metricCard('risk', '#2da44e', '已完成', completedTasks.length, '已完成完整分析流程的任务'),
            metricCard('report', '#2878d0', '已有报告', reportRuns.length, '当前已载入的最终报告')),
          h('section', { style: styles.homeSection },
            h('div', { style: styles.homeSectionHeader },
              h('div', { style: styles.homeSectionTitle }, '需要处理'),
              h('button', { type: 'button', style: styles.backButton, onClick: () => openProductPage('analysis', '分析任务') }, '查看全部任务')),
            h('div', { style: styles.homeTableHeader },
              h('span', null, '任务'), h('span', null, '仓库'), h('span', null, '目标'), h('span', null, '状态'), h('span', null, '更新时间'), h('span', null)),
            workRows.length ? workRows.map(task => {
              return h('button', { key: task.task_id, type: 'button', style: styles.homeTableRow, onClick: () => openTaskFromWorkbench(task) },
                h('span', { style: { fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: task.title }, task.title),
                h('span', { style: { color: '#59616c', fontSize: 13 } }, task.repository),
                h('span', { style: { color: '#59616c', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, task.target),
                h('span', { style: { ...styles.homeStatus, color: taskStatusColor(task.execution_status === 'stopping' ? 'stopping' : task.status) } }, taskStatusLabel(task.execution_status === 'stopping' ? 'stopping' : task.status)),
                h('span', { style: { color: '#59616c', fontSize: 13, fontVariantNumeric: 'tabular-nums' } }, formatDate(task.updated_at)),
                h('span', { style: { color: '#7a818b', fontSize: 20, lineHeight: 1, letterSpacing: 1 }, 'aria-hidden': true }, '⋮'))
            }) : h('div', { style: { ...styles.empty, padding: 18 } }, '当前没有需要处理的任务。')),
          h('div', { style: styles.homeColumns },
            h('section', { style: { ...styles.homeSection, padding: 16 } },
              h('div', { style: { ...styles.homeSectionTitle, margin: '2px 2px 14px' } }, '快捷入口'),
              h('div', { style: styles.appGrid, 'aria-label': '快捷入口' },
                appCard('analysis', '分析任务', '创建、跟踪并进入 PANGEA 分析任务', () => openProductPage('analysis', '分析任务')),
                appCard('assets', '资产管理', '需求、历史缺陷、覆盖率与方法论资产', () => openProductPage('assets', '资产管理')))),
            h('section', { style: { ...styles.homeSection, padding: '16px 18px' } },
              h('div', { style: { ...styles.row, minHeight: 32, marginBottom: 4 } }, h('div', { style: styles.homeSectionTitle }, '最近报告'), h('span', { style: { color: '#7a818b', fontSize: 12 } }, `${reportRows.length} 份已载入`)),
              reportRows.length ? reportRows.map(run => h('button', { key: run.run_id, type: 'button', style: styles.reportRow, onClick: () => openAnalysisRun(run) },
                reportGlyph(),
                h('span', { style: { minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: run.run_id }, runLabel(run)),
                h('span', { style: { color: '#737b86', fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, formatDate(runUpdatedAt(run))),
                h('span', { style: styles.appArrow, 'aria-hidden': true }, '›'))) : h('div', { style: { ...styles.empty, padding: '16px 0' } }, '当前已载入列表中没有报告。'))))
      }

      function taskStatusLabel(status) {
        return {
          preparing: '正在准备',
          starting: '正在启动',
          running: '分析中',
          stopping: '正在停止',
          needs_attention: '需要处理',
          completed: '已完成',
          stopped: '已停止',
          failed: '失败',
        }[status] ?? status ?? '待定'
      }

      function taskStatusColor(status) {
        if (status === 'failed' || status === 'needs_attention') return '#c7000b'
        if (status === 'stopped') return '#6b7280'
        if (status === 'preparing') return '#d97706'
        if (status === 'starting' || status === 'stopping') return '#6b7280'
        if (status === 'running') return '#2f7acb'
        return '#2da44e'
      }

      function renderTasks() {
        const query = taskQuery.trim().toLowerCase()
        const filtered = taskItems.filter(task => {
          if (taskStatus !== '全部' && task.status !== taskStatus && !(taskStatus === 'running' && ['starting', 'running', 'stopping'].includes(task.execution_status))) return false
          return !query || [task.title, task.target, task.repository, task.task_id, task.run_id].filter(Boolean).join(' ').toLowerCase().includes(query)
        })
        const statusFilters = [
          ['全部', '全部'], ['preparing', '正在准备'], ['running', '分析中'],
          ['needs_attention', '需要处理'], ['completed', '已完成'], ['stopped', '已停止'], ['failed', '失败'],
        ]
        const columns = 'minmax(260px, 1.8fr) minmax(150px, .9fr) minmax(110px, .7fr) minmax(130px, .8fr)'
        return h(React.Fragment, null,
          renderCompatibility(),
          h('section', { style: styles.homeHero },
            h('div', null,
              h('div', { style: { ...styles.homeTitle, fontSize: 28 } }, '分析任务'),
              h('div', { style: styles.homeLead }, '创建、跟踪并进入一个明确的 PANGEA 分析任务。Run 和 DSH Session 收纳在任务详情中。')),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
              renderRefreshButton(),
              h('button', { type: 'button', style: styles.redButton, onClick: () => jump('create') }, '新建分析任务'))),
          h('input', { style: styles.search, value: taskQuery, 'aria-label': '搜索分析任务', placeholder: '搜索任务名称或仓库…', onChange: event => setTaskQuery(event.target.value) }),
          h('div', { style: styles.filters }, statusFilters.map(([value, label]) => h('button', {
            key: value, type: 'button', style: { ...styles.filter, ...(taskStatus === value ? styles.filterActive : {}) }, onClick: () => setTaskStatus(value),
          }, label))),
          h('section', { style: { ...styles.homeSection, marginTop: 8 } },
            h('div', { style: { ...styles.homeTableHeader, gridTemplateColumns: columns } },
              h('span', null, '任务名称'), h('span', null, '仓库'), h('span', null, '状态'), h('span', null, '更新时间')),
            filtered.length ? filtered.map(task => h('button', {
              key: task.task_id,
              type: 'button',
              style: { ...styles.homeTableRow, gridTemplateColumns: columns },
              onClick: () => chooseTask(task),
            },
            h('span', { style: { fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, task.title),
            h('span', { style: { color: '#59616c', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, task.repository),
            h('span', { style: { ...styles.homeStatus, color: taskStatusColor(task.execution_status === 'stopping' ? 'stopping' : task.status) } }, taskStatusLabel(task.execution_status === 'stopping' ? 'stopping' : task.status)),
            h('span', { style: { color: '#59616c', fontSize: 13, fontVariantNumeric: 'tabular-nums' } }, formatDate(task.updated_at))))
              : h('div', { style: { ...styles.empty, padding: 24 } }, query || taskStatus !== '全部' ? '没有符合条件的任务。' : '还没有分析任务。')))
      }

      function renderOverview() {
        const runItems = workbench?.runs?.items ?? snapshot?.runs ?? []
        if (!selectedTask && !workbenchError && (!workbench || workbenchLoading)) return h('div', { style: styles.card, role: 'status' }, '正在读取分析任务…')
        if (!selectedTask) return h(React.Fragment, null, renderCompatibility(), h('div', { style: styles.card },
          h('div', { style: styles.empty }, '请先从任务列表选择一个分析任务。'),
          h('button', { type: 'button', style: { ...styles.primaryButton, marginTop: 10 }, onClick: () => jump('tasks') }, '返回任务列表')))
        if (!current) {
          const launchEvents = taskLaunchEvents(selectedTask, workbench)
          const launchFailure = [...launchEvents].reverse().find(event => event.status === 'error' && event.stage !== 'launch_failed')
            ?? [...launchEvents].reverse().find(event => event.status === 'error')
          const launchPresentation = deriveRunPresentation(selectedTask, null, null)
          const mayRetryLaunch = !selectedTask.run_id || launchPresentation.canResume
          return h(React.Fragment, null, renderCompatibility(), h('div', { style: { ...styles.card, padding: 20 } },
          h('div', { style: styles.row },
            h('div', null, h('div', { style: styles.itemTitle }, selectedTask.title), h('div', { style: styles.itemMeta }, `执行 Agent：${selectedTask.provider ?? '未选择'}${selectedTask.provider ? ` · ${selectedTask.agent_model ? `指定模型：${selectedTask.agent_model}` : '使用 Agent 默认模型'}` : ''}`)),
            h('span', { style: { ...styles.homeStatus, color: taskStatusColor(selectedTask.status) } }, taskStatusLabel(selectedTask.status))),
          h('div', { style: { ...styles.text, marginTop: 14 } }, selectedTask.status === 'failed'
            ? selectedTask.launch_error ?? '分析启动失败。'
            : selectedTask.status === 'needs_attention'
              ? selectedTask.launch_error ?? '分析需要处理，请查看运行细节。'
            : '任务已经保存，正在准备分析会话和 PANGEA Run。'),
          launchFailure ? h('div', { style: { ...styles.error, marginTop: 14 }, role: 'alert' },
            h('div', { style: styles.itemTitle }, `失败阶段：${launchFailure.stage}`),
            launchFailure.error_code ? h('div', { style: styles.itemMeta }, `错误码：${launchFailure.error_code}`) : null,
            h('div', { style: { ...styles.text, marginTop: 7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, launchFailure.error ?? launchFailure.message ?? selectedTask.launch_error)) : null,
          /* ACP process output is rendered in the product shell's right assistant panel. */
          renderLaunchDiagnostics(launchEvents),
          ['failed', 'needs_attention', 'stopped'].includes(selectedTask.status) && mayRetryLaunch ? h('button', { type: 'button', disabled: creatingRun, style: { ...styles.primaryButton, width: 'auto', marginTop: 14, ...(creatingRun ? styles.buttonDisabled : {}) }, onClick: () => { void startTask(selectedTask) } }, creatingRun ? (selectedTask.run_id ? '正在继续…' : '正在重试…') : (selectedTask.run_id ? '继续分析' : '重试启动')) : null,
          selectedTask.run_id && !launchPresentation.canResume ? h('div', { style: { ...styles.itemMeta, marginTop: 14 } }, `暂不能继续：${launchPresentation.resumeBlockedReason}`) : null))
        }
        const uncoveredRisks = risks.filter(isUncoveredRisk)
        const severityRank = { Critical: 0, High: 1, Medium: 2, Low: 3 }
        const priorityScenarios = [...risks].sort((left, right) => (severityRank[left.severity] ?? 9) - (severityRank[right.severity] ?? 9)).slice(0, 3)
        const previousFailures = previousAttemptFailures(selectedTask)
        const presentation = deriveRunPresentation(selectedTask, current, health)
        const runNeedsAttention = current.attention_required || presentation.failed || presentation.needsAttention
        const nextAction = runNeedsAttention
          ? { label: '分析需要处理', hint: '当前 Run 未正常完成，请先查看下方错误，再决定是否重新启动。', target: 'workflow' }
          : presentation.stopping
          ? { label: '正在停止', hint: '已请求停止，等待 ACP Job 报告最终状态；确认前不能继续分析。', target: 'workflow' }
          : presentation.healthStatus === 'warning'
          ? { label: '先处理数据读取异常', hint: '结构化结果与报告不一致，当前数量不能用于测试决策。', target: 'workflow' }
          : !current.terminal
            ? { label: '等待分析完成', hint: `Codetalks Skill 已完成 ${completed}/${total} 个步骤，可查看完整流程。`, target: 'workflow' }
            : uncoveredRisks.length > 0
              ? { label: `处理 ${uncoveredRisks.length} 条未覆盖风险`, hint: '这些风险还没有关联可执行测试用例。', target: 'risks' }
              : testCases.length > 0
                ? { label: '查看测试用例', hint: `${testCases.length} 条用例可供查看和继续讨论。`, target: 'cases' }
                : { label: '查看分析结论', hint: '当前没有生成测试用例。', target: 'risks' }
        return h(React.Fragment, null,
          renderCompatibility(),
          h('details', { style: styles.card }, h('summary', null, `输入材料 · ${current.input_materials?.length ?? 0} 份`),
            selectedTask?.source_task_id ? field('修正输入前的任务', selectedTask.source_task_id) : null,
            (current.input_materials ?? []).map(material => h('div', { key: material.asset_id, style: styles.card },
              h('div', { style: styles.itemTitle }, material.title), field('消费状态', material.consumption_state),
              field('资产修订 / 解析版本', `${material.revision} / ${material.parser_version || '旧版'}`),
              chip('查看冻结文本', () => openSidebarFile(material.frozen_normalized_text_path)),
              (material.attachments ?? []).map(attachment => chip(attachment.location, () => openSidebarFile(attachment.attachment_path))),
              field('读取范围', JSON.stringify(material.consumption?.consumed_ranges ?? [])),
              field('关联分析条目', (material.linked_ids ?? []).join('、')),
              field('未读取范围 / 限制', JSON.stringify([material.consumption?.unread_ranges, material.consumption?.limitations, material.warnings]))))),
          h('div', { style: styles.decisionHero },
            h('div', { style: styles.eyebrow }, '下一步'),
            h('div', { style: styles.decisionTitle }, nextAction.label),
            h('div', { style: styles.decisionHint }, nextAction.hint),
            h('button', { type: 'button', style: { ...styles.button, marginTop: 9 }, onClick: () => jump(nextAction.target) }, nextAction.target === 'workflow' ? '查看运行细节' : '进入处理'),
            h('div', { style: styles.decisionBand },
              h('div', { style: styles.decisionItem }, h('div', { style: styles.label }, '分析可信度'), h('div', { style: styles.decisionValue }, presentation.reliabilityLabel)),
              h('div', { style: styles.decisionItem }, h('div', { style: styles.label }, '测试准备'), h('div', { style: styles.decisionValue }, presentation.countsAvailability === 'unpublished' ? '测试结果尚未发布' : presentation.countsAvailability === 'unavailable' ? '测试结果不可读取' : `${displayCount('test_cases', testCases.length)} 条用例 / ${uncoveredRisks.length} 条风险未覆盖`)),
              h('div', { style: styles.decisionItem }, h('div', { style: styles.label }, '分析资产'), h('div', { style: styles.decisionValue }, displayCount('evidence', evidence.length))))),
          renderHealthCard(false),
          renderLaunchDiagnostics(taskLaunchEvents(selectedTask, workbench)),
          previousFailures.length ? h('details', { style: styles.card },
            h('summary', { style: { cursor: 'pointer', fontWeight: 700 } }, '上一次尝试失败'),
            h('div', { style: { ...styles.itemMeta, marginTop: 8 } }, '当前已开始新的分析尝试；下面保留的是历史失败记录。'),
            h('div', { style: { ...styles.error, marginTop: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, previousFailures[0].terminal_error),
            previousFailures[0].ended_at ? h('div', { style: { ...styles.itemMeta, marginTop: 6 } }, `结束时间：${formatDate(previousFailures[0].ended_at)}`) : null) : null,
          h('div', { style: styles.sectionTitle }, '优先失败场景'),
          priorityScenarios.length ? h('div', { style: styles.card }, priorityScenarios.map((risk, index) => h('button', {
            key: riskKeyByItem.get(risk), type: 'button', style: { ...styles.runButton, display: 'flex', gap: 7, alignItems: 'flex-start' }, onClick: () => navigate({ type: 'risk', id: riskKeyByItem.get(risk) }),
          },
          h('span', { style: styles.scenarioIndex }, String(index + 1).padStart(2, '0')),
          h('span', { style: { flex: 1, minWidth: 0 } },
            h('span', { style: styles.row }, h('span', { style: styles.itemTitle }, text(risk.title, risk.risk_id)), h('span', { style: styles.badge }, SEVERITY[risk.severity] ?? risk.severity ?? '—')),
            h('span', { style: { ...styles.itemMeta, display: 'block' } }, text(risk.trigger, '未记录触发条件')))))) : h('div', { style: styles.card }, h('div', { style: styles.empty }, collectionEmpty('risks', '当前没有风险结论。'))),
          current.artifacts?.report_html || current.artifacts?.report_md ? h('div', { style: styles.card },
            h('div', { style: styles.itemTitle }, '最终报告'),
            h('div', { style: styles.itemMeta }, '报告是完整交付物；日常处理优先使用上面的任务入口。'),
            h('div', { style: styles.chips },
              current.artifacts.report_html ? chip('打开 HTML 报告', () => openSidebarFile(current.artifacts.report_html, 'PANGEA report.html')) : null,
              current.artifacts.report_md ? chip('打开 Markdown 报告', () => openSidebarFile(current.artifacts.report_md, 'PANGEA report.md')) : null)) : null,
          h('details', { style: styles.technical },
            h('summary', { style: { cursor: 'pointer', fontSize: 12, fontWeight: 600 } }, '技术详情'),
            h('div', { style: { ...styles.itemMeta, marginTop: 7 } }, '这里保留流程、证据和复核原始信息，不参与日常主导航。'),
            h('div', { style: styles.chips },
              chip(`Skill 流程 · ${workflow.steps?.length ?? 0}`, () => jump('workflow')),
              chip(`业务流程 · ${businessFlows.length}`, () => jump('flows')),
              chip(`证据 · ${evidence.length}`, () => jump('evidence')),
              chip(`复核问题 · ${details.review_issues?.length ?? 0}`, () => jump('review')))),
          !current.terminal && selectedTask.status !== 'stopped' ? h('div', { style: { ...styles.card, ...styles.healthWarning } },
            h('div', { style: styles.row }, h('div', null, h('div', { style: styles.itemTitle }, '运行控制'), h('div', { style: styles.itemMeta }, '停止后保留已有产物和运行记录。')),
              pendingStopRun === current.run_id
                ? h('div', { style: styles.chips }, chip('取消', () => setPendingStopRun('')), h('button', { type: 'button', style: { ...styles.button, color: 'var(--dsw-alias-state-error-primary, #e66767)' }, onClick: () => { void stopCurrentRun() } }, '确认停止'))
                : h('button', { type: 'button', style: styles.button, onClick: () => setPendingStopRun(current.run_id) }, '停止 Run'))) : null,
          current.terminal && ['failed', 'needs_attention', 'stopped'].includes(selectedTask.status) ? h('div', { style: { ...styles.card, ...styles.healthWarning } },
            h('div', { style: styles.row }, h('div', null, h('div', { style: styles.itemTitle }, '继续分析'), h('div', { style: styles.itemMeta }, '保留已有快照、产物和检查点，从当前步骤继续。')),
              presentation.canResume
                ? h('button', { type: 'button', disabled: creatingRun, style: { ...styles.primaryButton, width: 'auto', ...(creatingRun ? styles.buttonDisabled : {}) }, onClick: () => { void startTask(selectedTask) } }, creatingRun ? '正在继续…' : '继续分析')
                : h('span', { style: styles.itemMeta }, `暂不能继续：${presentation.resumeBlockedReason}`))) : null,
          runItems.length ? h('details', { style: styles.technical },
            h('summary', { style: { cursor: 'pointer', fontSize: 12, fontWeight: 600 } }, `历史 Run · ${workbench?.runs?.total ?? runItems.length}`),
            h('div', { style: { ...styles.card, marginTop: 8, marginBottom: 0 } }, runItems.map(run => {
              const active = current.run_id === run.run_id
              return h('button', { type: 'button', key: run.run_id, style: { ...styles.runButton, ...(active ? styles.runActive : {}) }, onClick: () => chooseRun(run.run_id) }, h('div', { style: styles.row }, h('span', { style: { ...styles.itemTitle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: run.run_id }, runLabel(run)), h('span', { style: styles.badge }, run.phase_title ?? PHASE[run.phase] ?? run.phase)))
            })),
            h('div', { style: styles.toolbar },
              h('button', { type: 'button', disabled: runCursor <= 0, style: { ...styles.button, ...(runCursor <= 0 ? styles.buttonDisabled : {}) }, onClick: () => setRunCursor(Math.max(0, runCursor - 20)) }, '上一页'),
              h('span', { style: styles.itemMeta }, `${runCursor + 1}–${runCursor + runItems.length}`),
              h('button', { type: 'button', disabled: workbench?.runs?.next_cursor == null, style: { ...styles.button, ...(workbench?.runs?.next_cursor == null ? styles.buttonDisabled : {}) }, onClick: () => setRunCursor(workbench.runs.next_cursor) }, '下一页'))) : null)
      }

      function renderRisks() {
        const filtered = filterRisks(risks, riskSeverity, riskQuery)
        const severityCounts = riskSeverityCounts(risks)
        const groups = new Map()
        for (const risk of filtered) {
          const key = hasText(risk.unit_id) ? risk.unit_id : '__unassigned__'
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key).push(risk)
        }
        return h(React.Fragment, null,
          h('div', { style: styles.decisionHero },
            h('div', { style: styles.eyebrow }, '风险概览'),
            h('div', { style: styles.decisionTitle }, `${risks.length} 条风险`),
            h('div', { style: styles.decisionHint }, '查看风险等级、触发条件和关联测试用例。'),
            h('div', { style: styles.decisionBand },
              h('div', { style: styles.decisionItem }, h('div', { style: styles.label }, '严重'), h('div', { style: styles.decisionValue }, severityCounts.Critical)),
              h('div', { style: styles.decisionItem }, h('div', { style: styles.label }, '高'), h('div', { style: styles.decisionValue }, severityCounts.High)),
              h('div', { style: styles.decisionItem }, h('div', { style: styles.label }, '已关联用例'), h('div', { style: styles.decisionValue }, risks.filter(item => (item.linked_test_case_ids?.length ?? 0) > 0).length)),
              h('div', { style: styles.decisionItem }, h('div', { style: styles.label }, '有直接证据'), h('div', { style: styles.decisionValue }, risks.filter(item => (item.evidence?.length ?? 0) > 0).length)))),
          h('input', { style: styles.search, value: riskQuery, 'aria-label': '搜索风险', placeholder: '搜索风险编号、标题、触发条件…', onChange: event => setRiskQuery(event.target.value) }),
          h('div', { style: styles.filters }, ['全部', ...RISK_SEVERITY_LEVELS, ...(severityCounts.Ungraded ? ['Ungraded'] : [])].map(level => h('button', { key: level, type: 'button', style: { ...styles.filter, ...(riskSeverity === level ? styles.filterActive : {}) }, onClick: () => setRiskSeverity(level) }, level === '全部' ? `全部 ${risks.length}` : level === 'Ungraded' ? `未分级 ${severityCounts.Ungraded}` : `${SEVERITY[level]} ${severityCounts[level]}`))),
          h('div', { style: styles.itemMeta }, `显示 ${filtered.length} / ${risks.length} 条`),
          h('div', { style: { marginTop: 10 } }, filtered.length ? [...groups.entries()].map(([unitId, items]) => {
            const unit = unitById.get(unitId)
            const unitFlows = flowsByUnit.get(unitId) ?? []
            return h('section', { key: unitId, style: styles.group },
              h('div', { style: styles.groupHeader },
                h('div', null,
                  h('div', { style: styles.groupTitle }, unit ? `${unit.unit_id} · ${text(unit.title, '未命名单元')}` : '未归入分析单元'),
                  h('div', { style: styles.groupMeta }, unitFlows.length ? `业务流程：${unitFlows.map(flow => text(flow.title, flow.flow_id)).join('、')}` : '当前没有可直接关联的业务流程')),
                h('span', { style: styles.badge }, `${items.length} 条风险`)),
              items.map(risk => h('button', { key: `${risk.unit_id}:${riskKeyByItem.get(risk)}`, type: 'button', style: { ...styles.compactCard, ...styles.clickableCard }, onClick: () => navigate({ type: 'risk', id: riskKeyByItem.get(risk) }) },
                h('div', { style: styles.row }, h('div', { style: { ...styles.itemTitle, minWidth: 0 } }, `${risk.risk_id || '未编号'} · ${text(risk.title, '未命名风险')}`), h('span', { style: styles.badge }, SEVERITY[risk.severity] ?? risk.severity ?? '—')),
                h('div', { style: styles.itemMeta }, text(risk.trigger, '未记录触发条件')),
                h('div', { style: styles.chips },
                  h('span', { style: styles.badge }, `${risk.linked_test_case_ids?.length ?? 0} 条关联用例`),
                  h('span', { style: styles.badge }, `${risk.evidence?.length ?? 0} 条证据`),
                  hasText(risk.status) ? h('span', { style: styles.badge }, RISK_STATUS[risk.status] ?? risk.status) : null,
                  hasText(risk.translation_status) ? h('span', { style: styles.badge }, TRANSLATION[risk.translation_status] ?? risk.translation_status) : null)))
            )
          }) : h('div', { style: health?.status === 'warning' ? { ...styles.card, ...styles.healthError } : styles.card }, h('div', { style: health?.status === 'warning' ? styles.error : styles.empty }, collectionEmpty('risks', '没有符合条件的风险。')))))
      }

      function renderRiskDetail() {
        const risk = riskById.get(screen.id)
        if (!risk) return h('div', { style: styles.card }, h('div', { style: styles.empty }, '当前 Run 中找不到这条风险，可能是 Run 已刷新或切换。'))
        const semantics = risk.upstream_semantics
        const severitySource = risk.severity_source === 'sfmea' ? 'SFMEA' : risk.severity_source === 'workbench_projection' ? '工作台投影' : null
        const causalSection = (title, value) => section(title, hasText(value)
          ? value
          : hasText(risk.source_section) ? '该项内容尚未完整读取，请核对下方原始风险章节。' : '该项尚未记录。')
        return h(React.Fragment, null,
          h('div', { style: styles.card },
            h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, text(risk.title, '未命名风险')), h('span', { style: styles.badge }, SEVERITY[risk.severity] ?? risk.severity ?? '—')),
            h('div', { style: styles.chips },
              hasText(risk.confidence) ? h('span', { style: styles.badge }, `置信度 ${CONFIDENCE[risk.confidence] ?? risk.confidence}`) : null,
              hasText(risk.translation_status) ? h('span', { style: styles.badge }, TRANSLATION[risk.translation_status] ?? risk.translation_status) : null,
              hasText(risk.status) ? h('span', { style: styles.badge }, RISK_STATUS[risk.status] ?? risk.status) : null),
            severitySource ? h('div', { style: { ...styles.itemMeta, marginTop: 8 } }, `等级来源：${severitySource}`) : null,
            Array.isArray(risk.dfx) && risk.dfx.length ? h('div', { style: { ...styles.itemMeta, marginTop: 8 } }, `DFX：${risk.dfx.join('、')}`) : null),
          causalSection('风险说明', risk.narrative),
          causalSection('触发条件', risk.trigger),
          causalSection('代码失效', risk.system_result),
          causalSection('残留状态', risk.residual_effect),
          causalSection('表面正常现象', risk.apparent_normality),
          causalSection('对外暴露', risk.external_observation),
          causalSection('黑盒证明', risk.blackbox_proof),
          hasText(risk.source_section) ? section('原始风险章节', risk.source_section) : null,
          renderDiscussionCard('risk', risk, sourcePreview.key === previewKey && sourcePreview.status === 'ready' ? sourcePreview.value : undefined),
          renderRiskSelectionWorkbench(risk),
          renderSourcePreview('risk', risk, previewEvidence, riskEvidenceOptions),
          section('排除条件', risk.exclusion_condition),
          isUnreachableRisk(risk) ? h('div', { style: styles.card },
            h('div', { style: styles.itemTitle }, '不可达处置'),
            h('div', { style: { ...styles.label, marginTop: 8 } }, '原因'),
            h('div', { style: styles.text }, text(risk.unreachable_reason, '未记录不可达原因')),
            h('div', { style: { ...styles.label, marginTop: 8 } }, '源码证据'),
            Array.isArray(risk.unreachable_evidence) && risk.unreachable_evidence.length
              ? h('div', { style: { marginTop: 5 } }, risk.unreachable_evidence.map((item, index) => h('div', { key: `${item.repo_id ?? ''}:${item.path ?? ''}:${item.line_start ?? index}`, style: styles.itemMeta }, `${text(item.repo_id, '仓库')}:${text(item.path, '未记录路径')}:${item.line_start ?? '—'} · ${text(item.observation, '未记录观察')}`)))
              : h('div', { style: { ...styles.empty, marginTop: 6 } }, '未记录不可达证据。')) : null,
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
        const filtered = testCases.filter(item => !query || [item.test_case_id, item.title, item.case_type, item.verification_goal, ...idList(item.linked_flow_ids), ...idList(item.linked_gap_ids), ...(item.linked_risk_ids ?? [])].join(' ').toLowerCase().includes(query))
        const selectableFilteredIds = filtered.map(item => item.test_case_id).filter(hasText)
        const groups = new Map()
        const linkedCases = testCases.filter(item => (item.linked_risk_ids?.length ?? 0) > 0).length
        for (const item of filtered) {
          const key = hasText(item.unit_id) ? item.unit_id : '__unassigned__'
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key).push(item)
        }
        return h(React.Fragment, null,
          h('div', { style: styles.decisionHero },
            h('div', { style: styles.eyebrow }, '测试用例'),
            h('div', { style: styles.decisionTitle }, `${testCases.length} 条测试用例`),
            h('div', { style: styles.decisionHint }, '按独立验证目标查看用例、关联路径、覆盖缺口和执行步骤。'),
            h('div', { style: styles.decisionBand },
              h('div', { style: styles.decisionItem }, h('div', { style: styles.label }, '用例总数'), h('div', { style: styles.decisionValue }, testCases.length)),
              h('div', { style: styles.decisionItem }, h('div', { style: styles.label }, '已选择'), h('div', { style: styles.decisionValue }, selectedCaseIds.length)),
              h('div', { style: styles.decisionItem }, h('div', { style: styles.label }, '关联风险的用例'), h('div', { style: styles.decisionValue }, linkedCases)),
              h('div', { style: styles.decisionItem }, h('div', { style: styles.label }, '导出格式'), h('div', { style: styles.decisionValue }, 'CSV / XLSX')))),
          h('div', { style: { ...styles.card, ...styles.actionCard } },
            h('div', { style: styles.itemTitle }, '测试用例出口'),
            h('div', { style: styles.itemMeta }, '导出完整用例，或复制当前选择的用例。'),
            h('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
              h('button', { type: 'button', disabled: !current?.run_id, style: { ...styles.button, flex: 1, ...(!current?.run_id ? styles.buttonDisabled : {}) }, onClick: () => { void exportCurrentCases('csv') } }, '导出 CSV'),
              h('button', { type: 'button', disabled: !current?.run_id, style: { ...styles.button, flex: 1, ...(!current?.run_id ? styles.buttonDisabled : {}) }, onClick: () => { void exportCurrentCases('xlsx') } }, '导出 XLSX')),
            h('div', { style: styles.row },
              h('div', { style: styles.itemMeta }, `已选 ${selectedCaseIds.length} 条`),
              h('div', { style: styles.chips },
                chip('选择当前列表', () => setSelectedCaseIds([...new Set([...selectedCaseIds, ...selectableFilteredIds])])),
                chip('复制选中用例', () => { void copySelectedCases() }),
                chip('清空', () => setSelectedCaseIds([]))))),
          h('input', { style: styles.search, value: caseQuery, 'aria-label': '搜索测试用例', placeholder: '搜索用例编号、目标、流程、缺口…', onChange: event => setCaseQuery(event.target.value) }),
          h('div', { style: styles.itemMeta }, `显示 ${filtered.length} / ${testCases.length} 条`),
          h('div', { style: { marginTop: 10 } }, filtered.length ? [...groups.entries()].map(([unitId, items]) => {
            const unit = unitById.get(unitId)
            const unitFlows = flowsByUnit.get(unitId) ?? []
            const coverageCount = Array.isArray(unit?.coverage_ids) ? unit.coverage_ids.length : 0
            return h('section', { key: unitId, style: styles.group },
              h('div', { style: styles.groupHeader },
                h('div', null,
                  h('div', { style: styles.groupTitle }, unit ? `${unit.unit_id} · ${text(unit.title, '未命名单元')}` : '未归入分析单元'),
                  h('div', { style: styles.groupMeta }, unitFlows.length ? `业务流程：${unitFlows.map(flow => text(flow.title, flow.flow_id)).join('、')}` : '当前没有可直接关联的业务流程')),
                h('span', { style: styles.badge }, coverageCount ? `${coverageCount} 个 Coverage 输入` : `${items.length} 条用例`)),
              items.map(item => {
                const selectable = hasText(item.test_case_id)
                const itemKey = caseKeyByItem.get(item)
                return h('div', { key: `${item.unit_id}:${itemKey}`, style: styles.compactCard },
                  h('div', { style: styles.caseSelect },
                  h('input', { type: 'checkbox', disabled: !selectable, checked: selectable && selectedCaseIds.includes(item.test_case_id), 'aria-label': selectable ? `选择 ${item.test_case_id}` : '用例尚未编号，不能选择', onChange: () => toggleCase(item.test_case_id) }),
                  h('button', { type: 'button', style: styles.caseDetailButton, onClick: () => navigate({ type: 'case', id: itemKey }) },
                    h('div', { style: styles.itemTitle }, `${item.test_case_id || '待编号'} · ${text(item.title, '未命名用例')}`),
                    h('div', { style: styles.itemMeta }, [text(item.case_type, '类型待补充'), `${item.linked_risk_ids?.length ?? 0} 条关联风险`, hasText(item.priority) ? `优先级 ${item.priority}` : '', hasText(item.status) ? item.status : ''].filter(Boolean).join(' · ')))))
              })
            )
          }) : h('div', { style: health?.status === 'warning' ? { ...styles.card, ...styles.healthError } : styles.card }, h('div', { style: health?.status === 'warning' ? styles.error : styles.empty }, collectionEmpty('test_cases', '没有符合条件的测试用例。')))))
      }

      function renderExecutionResults() {
        const executorRuns = snapshot?.executor_runs ?? []
        const completedRuns = executorRuns.filter(run => ['PASS', 'passed', 'complete', 'completed', 'success'].includes(run.result_status ?? run.phase)).length
        const unresolvedRuns = executorRuns.filter(run => (run.unresolved?.length ?? 0) > 0 || ['FAILED', 'failed', 'error', 'UNRESOLVED'].includes(run.result_status ?? run.phase)).length
        return h(React.Fragment, null,
          h('div', { style: styles.decisionHero },
            h('div', { style: styles.eyebrow }, '执行结果'),
            h('div', { style: styles.decisionTitle }, executorRuns.length ? `${executorRuns.length} 次执行留有记录` : '还没有执行测试计划'),
            h('div', { style: styles.decisionHint }, '这里关联测试计划、实验环境和实际结果；环境配置是执行条件，不是产品主结果。'),
            h('div', { style: styles.decisionBand },
              h('div', { style: styles.decisionItem }, h('div', { style: styles.label }, '执行记录'), h('div', { style: styles.decisionValue }, executorRuns.length)),
              h('div', { style: styles.decisionItem }, h('div', { style: styles.label }, '完成'), h('div', { style: styles.decisionValue }, completedRuns)),
              h('div', { style: styles.decisionItem }, h('div', { style: styles.label }, '需处理'), h('div', { style: styles.decisionValue }, unresolvedRuns)))),
          h('div', { style: styles.card },
            h('div', { style: styles.itemTitle }, `测试执行记录（${executorRuns.length}）`),
            executorRuns.length ? h('div', { style: { marginTop: 8 } }, executorRuns.map(run => {
              const environmentName = run.environment_name ?? environments.find(item => item.id === run.environment_id)?.name ?? '执行环境已删除'
              return h('div', { key: run.executor_run_id, style: { ...styles.card, marginBottom: 7 } },
                h('div', { style: styles.row }, h('div', { style: styles.itemTitle }, run.executor_run_id), h('span', { style: styles.badge }, run.result_status ?? run.phase)),
                h('div', { style: styles.itemMeta }, `${run.selected_test_case_ids.length} 条用例 · ${environmentName}`),
                run.unresolved?.length ? h('div', { style: { ...styles.error, marginTop: 6 } }, run.unresolved.join('；')) : null,
                h('div', { style: styles.chips }, run.artifacts?.plan ? chip('查看执行计划', () => openSidebarFile(run.artifacts.plan, 'PANGEA executable plan')) : null, run.artifacts?.result ? chip('查看执行结果', () => openSidebarFile(run.artifacts.result, 'PANGEA execution result')) : null))
            })) : h('div', { style: { ...styles.empty, marginTop: 8 } }, '当前分析还没有执行记录。')))
      }

      function renderEnvironmentPage() {
        const updateField = fieldName => event => setEnvironmentForm(value => ({ ...value, [fieldName]: event.target.value }))
        const environmentField = (label, fieldName, options = {}) => h('label', { style: { ...styles.environmentField, ...(options.wide ? styles.environmentFieldWide : {}) } },
          h('span', { style: styles.environmentLabel }, label),
          h('input', {
            type: options.type ?? 'text', value: environmentForm[fieldName], placeholder: options.placeholder,
            style: styles.environmentInput, onChange: updateField(fieldName), autoComplete: 'off',
          }))
        const connectionIcon = kind => h('span', { style: styles.environmentConnectionIcon }, kind === 'host'
          ? h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 }, h('rect', { x: 4, y: 3, width: 16, height: 18, rx: 2 }), h('path', { d: 'M8 8h8M8 12h8M8 16h4' }))
          : h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 }, h('path', { d: 'M4 6h16v5H4zM4 13h16v5H4z' }), h('circle', { cx: 17, cy: 8.5, r: .7 }), h('circle', { cx: 17, cy: 15.5, r: .7 })))
        const testLabel = kind => {
          const value = environmentTests[kind]
          if (value.state === 'testing') return '正在检查连接…'
          if (value.state === 'ok') return '连接成功'
          if (value.state === 'error') return value.message || '连接失败'
          return '尚未检查连接'
        }
        const connectionCard = (kind, title, ipLabel) => {
          const prefix = kind === 'host' ? 'host' : 'array'
          const test = environmentTests[kind]
          return h('div', { style: styles.environmentConnectionCard },
            h('div', { style: styles.environmentConnectionTitle }, connectionIcon(kind), title),
            h('div', { style: styles.environmentFieldGrid },
              environmentField(ipLabel, `${prefix}_ip`, { wide: true, placeholder: kind === 'host' ? '例如 192.168.10.21' : '例如 192.168.10.80' }),
              environmentField('用户名', `${prefix}_username`, { placeholder: kind === 'host' ? 'root' : 'admin' }),
              environmentField('密码', `${prefix}_password`, { type: 'password', placeholder: '输入登录密码' }),
              environmentForm.advanced ? environmentField('SSH 端口', `${prefix}_port`, { wide: true, placeholder: '22' }) : null),
            h('div', { style: styles.environmentConnectionFoot },
              h('span', { style: { ...styles.environmentTestState, color: test.state === 'ok' ? '#25884b' : test.state === 'error' ? '#c7000b' : '#7a818c' } }, testLabel(kind)),
              h('button', { type: 'button', disabled: test.state === 'testing', style: styles.environmentSecondaryButton, onClick: () => { void testEnvironment(kind) } }, test.state === 'testing' ? '检查中…' : '测试连接')))
        }
        return h('div', { style: styles.environmentContent },
          h('section', { style: styles.environmentSection },
            h('div', { style: styles.environmentSectionHead }, h('div', { style: styles.environmentSectionTitle }, '基本信息'), h('div', { style: styles.environmentSectionHint }, '用于在测试任务中识别环境')),
            h('div', { style: styles.environmentSectionBody }, environmentField('环境名称', 'name', { placeholder: '例如：昆仑实验室 · NVMe-oF 联调环境' }))),
          h('section', { style: styles.environmentSection },
            h('div', { style: styles.environmentSectionHead }, h('div', { style: styles.environmentSectionTitle }, '连接信息'), h('div', { style: styles.environmentSectionHint }, '主机或阵列至少配置一个')),
            h('div', { style: styles.environmentSectionBody },
              h('div', { style: styles.environmentConnections }, connectionCard('host', '测试主机', '主机 IP'), connectionCard('array', '存储阵列', '阵列管理 IP')),
              h('label', { style: { ...styles.environmentAdvanced, display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 } },
                h('input', { type: 'checkbox', checked: environmentForm.advanced, onChange: event => setEnvironmentForm(value => ({ ...value, advanced: event.target.checked })) }),
                '高级设置：自定义 SSH 端口（默认 22）'))),
          h('div', { style: styles.environmentActions },
            h('button', { type: 'button', style: styles.environmentSecondaryButton, onClick: () => { setEnvironmentForm(emptyEnvironmentForm()); setEnvironmentTests({ host: { state: 'idle' }, array: { state: 'idle' } }) } }, '取消'),
            h('button', { type: 'button', style: styles.environmentPrimaryButton, onClick: () => { void submitEnvironment() } }, environmentForm.id ? '保存修改' : '保存环境')),
          environments.length ? h('section', { style: { ...styles.environmentSection, marginTop: 24 } },
            h('div', { style: styles.environmentSectionHead }, h('div', { style: styles.environmentSectionTitle }, '已配置环境'), h('div', { style: styles.environmentSectionHint }, `${environments.length} 个`)),
            h('div', { style: { ...styles.environmentSectionBody, ...styles.environmentList } }, environments.map(environment => h('div', { key: environment.id, style: styles.environmentListItem },
              h('div', null,
                h('div', { style: styles.itemTitle }, environment.name),
                h('div', { style: styles.itemMeta }, [environment.host?.ip ? `主机 ${environment.host.ip}` : '', environment.array?.ip ? `阵列 ${environment.array.ip}` : ''].filter(Boolean).join(' · ') || '旧环境配置，编辑后补充连接信息')),
              h('div', { style: { display: 'flex', gap: 8 } },
                h('button', { type: 'button', style: styles.environmentSecondaryButton, onClick: () => editEnvironment(environment) }, '编辑'),
                h('button', { type: 'button', style: { ...styles.environmentSecondaryButton, color: '#c7000b' }, onClick: () => { void deleteEnvironment(environment.id) } }, '删除')))))) : null)
      }

      function renderCaseDetail() {
        const item = caseById.get(screen.id)
        if (!item) return h('div', { style: styles.card }, h('div', { style: styles.empty }, '当前 Run 中找不到这条测试用例，可能是 Run 已刷新或切换。'))
        return h(React.Fragment, null,
          section('独立验证目标', item.verification_goal || '当前记录未单独声明，请核对用例正文。'),
          h('div', { style: styles.card }, h('div', { style: styles.itemTitle }, '业务路径与覆盖缺口'), linkedItems(item)),
          h('div', { style: styles.card }, h('div', { style: styles.itemTitle }, text(item.title, '未命名用例')), h('div', { style: styles.chips }, hasText(item.case_type) ? h('span', { style: styles.badge }, item.case_type) : null, hasText(item.priority) ? h('span', { style: styles.badge }, `优先级 ${item.priority}`) : null, hasText(item.status) ? h('span', { style: styles.badge }, item.status) : null)),
          renderDiscussionCard('case', item),
          h('div', { style: styles.card }, h('div', { style: styles.itemTitle }, `关联风险（${item.linked_risk_ids?.length ?? 0}）`), item.linked_risk_ids?.length ? h('div', { style: styles.chips }, item.linked_risk_ids.map(id => chip(id, () => navigate({ type: 'risk', id })))) : h('div', { style: { ...styles.empty, marginTop: 6 } }, '未关联实现风险；本用例的测试目的以验证目标和路径依据为准。')),
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
      if (screen.type === 'home') body = renderHome()
      else if (screen.type === 'tasks') body = renderTasks()
      else if (screen.type === 'repository-import') body = renderRepositoryImport(false)
      else if (screen.type === 'overview') body = renderOverview()
      else if (screen.type === 'create') body = renderCreate()
      else if (screen.type === 'workflow') body = renderWorkflow()
      else if (screen.type === 'risks') body = renderRisks()
      else if (screen.type === 'risk') body = renderRiskDetail()
      else if (screen.type === 'cases') body = renderCases()
      else if (screen.type === 'case') body = renderCaseDetail()
      else if (screen.type === 'execution') body = renderExecutionResults()
      else if (screen.type === 'environment') body = renderEnvironmentPage()
      else if (screen.type === 'flows') body = renderFlows()
      else if (screen.type === 'coverage') body = renderCases()
      else if (screen.type === 'evidence') body = renderEvidence()
      else if (screen.type === 'evidence-detail') body = renderEvidenceDetail()
      else body = renderReview()

      const healthAlert = !['home', 'overview', 'environment'].includes(screen.type) && health?.status === 'warning' ? renderHealthCard(true) : null
      const errorNotice = error ? h('div', { style: { ...styles.card, ...styles.healthError }, role: 'alert' },
        h('div', { style: styles.itemTitle }, snapshot ? '同步失败，继续显示上次结果' : '无法读取 PANGEA 数据'),
        h('div', { style: { ...styles.error, marginTop: 6 } }, error),
        h('button', { type: 'button', style: { ...styles.button, marginTop: 8 }, onClick: () => { void load({ foreground: true }) } }, '重试')) : null
      const requiresSnapshot = !['home', 'tasks', 'create', 'environment', 'repository-import'].includes(screen.type)
      const initialLoading = requiresSnapshot && loading && snapshot === undefined
      const repositoryGate = pageMode === 'home' && repositoryState === undefined
        ? h('div', { style: styles.onboardingShell }, h('div', { style: { ...styles.onboardingCard, textAlign: 'center' }, role: repositoryError ? 'alert' : 'status' },
          h('div', { style: styles.onboardingEyebrow }, 'PANGEA DESKTOP'),
          h('div', { style: { ...styles.onboardingTitle, fontSize: 24 } }, repositoryError ? '无法检查工作区状态' : '正在初始化 PANGEA'),
          h('div', { style: styles.onboardingLead }, repositoryError || '正在确认本地数据目录与源码仓库，请稍候…'),
          repositoryError ? h('button', { type: 'button', disabled: repositoryLoading, style: { ...styles.redButton, marginTop: 20 }, onClick: () => { void loadRepositories() } }, repositoryLoading ? '正在重试…' : '重试') : null))
        : null
      const contentBody = repositoryGate ?? (initialLoading
        ? h('div', { style: styles.card, role: 'status' }, h('div', { style: styles.empty }, '正在读取当前 Run…'))
        : requiresSnapshot && snapshot === undefined && error && workbench?.compatibility?.compatible !== false ? null : h(React.Fragment, null, healthAlert, body))
      const actionFeedback = actionNotice ? h('div', { style: { ...styles.card, ...(actionNotice.isError ? styles.healthError : styles.healthOk) }, role: actionNotice.isError ? 'alert' : 'status' }, h('div', { style: actionNotice.isError ? styles.error : styles.success }, actionNotice.message)) : null
      return h('div', { style: styles.root, role: 'region', 'aria-label': 'PANGEA 测试工作台' },
        ['home', 'tasks'].includes(screen.type) ? null : header,
        h('div', { style: screen.type === 'home' && repositoryState?.onboarding_required ? { padding: 0 }
          : screen.type === 'home' ? styles.homeContent
            : ['environment', 'repository-import'].includes(screen.type) ? { padding: 0 } : styles.content }, actionFeedback, errorNotice, contentBody))
    }

    function apply(ctx) {
      const pangea = ctx.pangea
      if (!pangea) return
      ctx.effect(() => pangea.registerPage({
        id: 'workbench', title: () => '工作台', icon, order: 0, default: true,
        available: (_ctx, scope) => Boolean(scope?.cwd),
        component: props => h(PangeaPanel, { ...props, ctx, initialScreen: 'home', pageMode: 'home' }),
      }), 'dsh-pangea-companion: workbench page')
      ctx.effect(() => pangea.registerPage({
        id: 'analysis', title: () => 'PANGEA 分析', icon, order: 10,
        available: (_ctx, scope) => Boolean(scope?.cwd),
        component: props => h(PangeaPanel, { ...props, ctx, initialScreen: 'tasks', pageMode: 'analysis' }),
      }), 'dsh-pangea-companion: analysis page')
      ctx.effect(() => pangea.registerPage({
        id: 'execution', title: () => '环境配置', icon, order: 20,
        available: () => false,
        component: props => h(PangeaPanel, { ...props, ctx, initialScreen: 'environment', pageMode: 'execution' }),
      }), 'dsh-pangea-companion: execution page')
      ctx.effect(() => pangea.registerPage({
        id: 'agent-runtime', title: () => 'Agent Runtime', icon, order: 30,
        available: () => false,
        component: props => h(AcpSettingsPanel, props),
      }), 'dsh-pangea-companion: Agent Runtime settings page')
    }

    exports.inject = inject
    exports.requestSnapshot = requestSnapshot
    exports.requestSourceSnippet = requestSourceSnippet
    exports.requestRunExport = requestRunExport
    exports.requestAssetCatalog = requestAssetCatalog
    exports.requestEnvironments = requestEnvironments
    exports.saveEnvironment = saveEnvironment
    exports.removeEnvironment = removeEnvironment
    exports.launchExecution = launchExecution
    exports.requestWorkbench = requestWorkbench
    exports.requestWorkbenchAction = requestWorkbenchAction
    exports.requestRepositoryStatus = requestRepositoryStatus
    exports.requestRepositoryImport = requestRepositoryImport
    exports.requestAcpSettings = requestAcpSettings
    exports.requestAgentModels = requestAgentModels
    exports.saveAcpSettings = saveAcpSettings
    exports.testAcpSettings = testAcpSettings
    exports.filePathFromLocation = filePathFromLocation
    exports.evidenceIdentity = evidenceIdentity
    exports.evidenceTabLabel = evidenceTabLabel
    exports.runLabel = runLabel
    exports.taskMatchesRun = taskMatchesRun
    exports.snapshotMatchesSelection = snapshotMatchesSelection
    exports.workflowAckPresentation = workflowAckPresentation
    exports.deriveRunPresentation = deriveRunPresentation
    exports.outcomePresentation = outcomePresentation
    exports.previousAttemptFailures = previousAttemptFailures
    exports.absoluteWorkspacePath = absoluteWorkspacePath
    exports.evidenceFilePath = evidenceFilePath
    exports.appendConversationDraft = appendConversationDraft
    exports.writableConversation = writableConversation
    exports.splitRiskClaims = splitRiskClaims
    exports.buildDiscussionDraft = buildDiscussionDraft
    exports.riskSeverityCounts = riskSeverityCounts
    exports.filterRisks = filterRisks
    exports.analysisBackTarget = analysisBackTarget
    exports.buildAnalysisRequest = buildAnalysisRequest
    exports.CoverageBrowser = CoverageBrowser
    exports.flowContentState = flowContentState
    exports.apply = apply
    return module.exports
  },
})
