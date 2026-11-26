import { analysisExecutionState, loadAnalysisAgentModels } from './agent-model-selection.js'

export const LIVE_VERDICT_LABELS = {
  confirmed: '风险实锤',
  excluded: '实测排除',
  not_triggered: '桩未命中',
  blocked: '环境阻断',
}

export const LIVE_STATUS_LABELS = {
  preflight: 'Stage-0 预检中',
  running: '真机核验中',
  completed: '待确认归档',
  confirmed: '已确认归档',
  blocked: '预检阻断',
  failed: '执行失败',
  cancelled: '已停止',
  interrupted: '已中断',
  unreadable: '记录不可读',
}

const ACTIVE_STATUSES = new Set(['preflight', 'running'])

const LV_CSS = `
  .pangea-lv { min-width: 0; font-size: 13px; color: var(--pangea-ink, #1d232a); padding: 18px 24px 24px; }
  .pangea-lv-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
  .pangea-lv-head h2 { margin: 0; font-size: 18px; font-weight: 650; }
  .pangea-lv-tabs { display: inline-flex; gap: 4px; background: #f1f3f6; padding: 3px; border-radius: 8px; }
  .pangea-lv-tabs button { min-height: 30px; padding: 4px 13px; border: 0; border-radius: 6px; background: transparent; font-size: 13px; cursor: pointer; color: #5e6773; }
  .pangea-lv-tabs button[aria-selected="true"] { background: #fff; color: var(--pangea-red, #b62836); font-weight: 600; box-shadow: 0 1px 2px rgba(16,24,40,.08); }
  .pangea-lv-card { padding: 14px 16px; border: 1px solid var(--pangea-line, #e2e6ec); border-radius: 10px; background: #fff; margin-bottom: 12px; }
  .pangea-lv-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 10px 14px; align-items: start; }
  .pangea-lv-row3 { display: grid; grid-template-columns: minmax(0, 1.5fr) 84px minmax(0, 1fr); gap: 8px; }
  .pangea-lv-field { display: grid; gap: 4px; margin-bottom: 8px; font-size: 12px; font-weight: 600; color: #374151; }
  .pangea-lv input:not([type=checkbox]), .pangea-lv select, .pangea-lv textarea { font: inherit; font-size: 13px; min-height: 32px; padding: 5px 9px; border: 1px solid #d5dbe3; border-radius: 6px; background: #fff; color: var(--pangea-ink, #1d232a); box-sizing: border-box; width: 100%; font-weight: 400; }
  .pangea-lv textarea { min-height: 60px; resize: vertical; }
  .pangea-lv button.lv-btn { font: inherit; font-size: 13px; min-height: 32px; padding: 4px 12px; border: 1px solid #d5dbe3; border-radius: 6px; background: #fff; color: var(--pangea-ink, #1d232a); cursor: pointer; }
  .pangea-lv button.lv-btn:hover:not(:disabled) { background: #f1f3f6; }
  .pangea-lv button.lv-btn.primary { background: var(--pangea-red, #b62836); border-color: var(--pangea-red, #b62836); color: #fff; font-weight: 600; }
  .pangea-lv button.lv-btn.danger { color: #9c2330; border-color: #f2c9cd; }
  .pangea-lv button.lv-btn:disabled { opacity: .5; cursor: default; }
  .pangea-lv-banner { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 9px 12px; margin: 8px 0; border-radius: 8px; font-size: 13px; line-height: 1.5; border: 1px solid transparent; }
  .pangea-lv-banner.danger { background: #fbefef; border-color: #f2c9cd; color: #9c2330; }
  .pangea-lv-banner.warn { background: #fbf4e6; border-color: #eedab3; color: #8c5a12; }
  .pangea-lv-banner.good { background: #eaf5ee; border-color: #c3e4cf; color: #20765a; }
  .pangea-lv-banner.info { background: #edf3f8; border-color: #cfe0ee; color: #365a7d; }
  .pangea-lv-pill { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .pangea-lv-pill.good { background: #eaf5ee; color: #20765a; }
  .pangea-lv-pill.danger { background: #fbefef; color: #9c2330; }
  .pangea-lv-pill.warn { background: #fbf4e6; color: #8c5a12; }
  .pangea-lv-pill.info { background: #edf3f8; color: #365a7d; }
  .pangea-lv-strip { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; padding: 10px 14px; border: 1px solid #e2e6ec; border-radius: 8px; background: #f8f9fb; margin-bottom: 12px; font-size: 13px; }
  .pangea-lv-strip-item { display: inline-flex; align-items: center; gap: 6px; }
  .pangea-lv-subtabs { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; border-bottom: 1px solid #e2e6ec; margin-bottom: 12px; padding-bottom: 8px; }
  .pangea-lv-scroll { max-height: 54vh; overflow-y: auto; padding-right: 4px; }
  .pangea-lv-split { display: grid; grid-template-columns: minmax(210px, 260px) minmax(0, 1fr); gap: 14px; align-items: start; }
  .pangea-lv-target-list { display: grid; gap: 6px; max-height: 52vh; overflow-y: auto; }
  .pangea-lv-target-btn { text-align: left; padding: 9px 11px; border: 1px solid #e2e6ec; border-radius: 8px; background: #fff; cursor: pointer; display: grid; gap: 4px; }
  .pangea-lv-target-btn[aria-pressed="true"] { border-color: var(--pangea-red, #b62836); background: #fbf0f2; }
  .pangea-lv-table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e6ec; border-radius: 8px; overflow: hidden; }
  .pangea-lv-table th, .pangea-lv-table td { padding: 8px 10px; border-bottom: 1px solid #e2e6ec; text-align: left; vertical-align: middle; font-size: 13px; }
  .pangea-lv-table th { color: #5e6773; font-weight: 600; background: #f8f9fb; }
  .pangea-lv-pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.5 Consolas, monospace; background: #f8f9fb; border: 1px solid #e2e6ec; border-radius: 6px; padding: 8px 10px; max-height: 180px; overflow: auto; margin: 6px 0 0; }
  .pangea-lv-link { border: 0; background: transparent; padding: 0; color: var(--pangea-red, #b62836); font-weight: 600; cursor: pointer; text-align: left; font-size: 13px; }
  .pangea-lv-cmd-chip { display: inline-flex; align-items: center; padding: 2px 7px; margin: 0 5px 4px 0; border-radius: 4px; border: 1px solid #d5dbe3; background: #f8f9fb; font: 600 11px Consolas, monospace; color: #365a7d; cursor: pointer; }
  .pangea-lv-cmd-chip:hover { border-color: var(--pangea-red, #b62836); color: var(--pangea-red, #b62836); }
  .pangea-lv-modal-backdrop { position: fixed; inset: 0; z-index: 40; background: rgba(17,24,39,.38); display: flex; justify-content: flex-end; }
  .pangea-lv-drawer { width: min(760px, 94vw); height: 100%; background: #fff; box-shadow: -8px 0 28px rgba(15,23,42,.16); display: flex; flex-direction: column; }
  .pangea-lv-drawer-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid #e2e6ec; }
  .pangea-lv-drawer-body { flex: 1; overflow-y: auto; padding: 14px 18px; }
  .pangea-lv-drawer-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px; border-top: 1px solid #e2e6ec; background: #f8f9fb; }
  @media(max-width: 860px) { .pangea-lv-split { grid-template-columns: 1fr; } .pangea-lv-row3 { grid-template-columns: 1fr; } }
`

const statusTone = status => status === 'confirmed' || status === 'completed' ? 'good' : ['blocked', 'failed', 'cancelled', 'interrupted', 'unreadable'].includes(status) ? 'danger' : 'info'
const verdictTone = v => v === 'confirmed' ? 'danger' : v === 'excluded' ? 'good' : v === 'not_triggered' ? 'warn' : 'info'

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    cache: 'no-store',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`)
  return payload
}

function emptyEndpoint(kind) {
  return {
    ip: '', port: '22', username: '', auth_kind: 'password', password: '', key_path: '', passphrase: '',
    ...(kind === 'host' ? { default_workdir: '' } : { default_process: '' }),
  }
}

function emptyEnvForm() {
  return { id: '', name: '', notes: '', service_topology: '', stimulus_playbook: '', host: emptyEndpoint('host'), array: emptyEndpoint('array') }
}

function envToForm(env) {
  const mapEp = (ep, kind) => ep && !ep.legacy_alias ? {
    ip: ep.ip || '', port: String(ep.port ?? 22), username: ep.username || '',
    auth_kind: ep.auth_kind === 'key' ? 'key' : 'password',
    password: '', key_path: ep.key_path || '', passphrase: '',
    has_password: Boolean(ep.has_password),
    ...(kind === 'host' ? { default_workdir: ep.default_workdir || '' } : { default_process: ep.default_process || '' }),
  } : emptyEndpoint(kind)
  return {
    id: env.id || '', name: env.name || '', notes: env.notes || '',
    service_topology: env.service_topology || '',
    stimulus_playbook: env.stimulus_playbook || '',
    host: mapEp(env.host, 'host'), array: mapEp(env.array, 'array'),
  }
}

const DEFAULT_ACP_PROVIDERS = [
  { id: 'pangea-nga', label: 'NGA' },
  { id: 'pangea-codeagent', label: 'CodeAgent' },
  { id: 'pangea-opencode', label: 'OpenCode' },
]

export function createLiveVerificationWorkspace(React) {
  const h = React.createElement

  return function LiveVerificationWorkspace({
    cwd = '',
    dataRoot = '',
    draft = null,
    onConsumeDraft = null,
    availableProviders = null,
    defaultProviderId = '',
    defaultAgentModel = '',
  }) {
    const [tab, setTab] = React.useState('tasks') // 'tasks' | 'environments'
    const [subView, setSubView] = React.useState('list') // 'list' | 'create' | 'detail'
    const [detailTab, setDetailTab] = React.useState('verdicts') // 'verdicts' | 'transcript' | 'checks'
    const [selectedVerdictIdx, setSelectedVerdictIdx] = React.useState(0)
    const [focusedCmdId, setFocusedCmdId] = React.useState('')
    const [envDrawerOpen, setEnvDrawerOpen] = React.useState(false)
    const [tasks, setTasks] = React.useState([])
    const [locks, setLocks] = React.useState({})
    const [verifyEngine, setVerifyEngine] = React.useState(null)
    const [providers, setProviders] = React.useState(() => (Array.isArray(availableProviders) && availableProviders.length ? availableProviders : []))
    const [environments, setEnvironments] = React.useState([])
    const [fiTasks, setFiTasks] = React.useState([])
    const [fiBuilds, setFiBuilds] = React.useState([])
    const [analysisRuns, setAnalysisRuns] = React.useState([])
    const [runCandidates, setRunCandidates] = React.useState({ run_id: '', risks: [], test_cases: [], loading: false })
    const [selectedDirectKeys, setSelectedDirectKeys] = React.useState([])
    const [activeTask, setActiveTask] = React.useState(null)
    const [transcript, setTranscript] = React.useState([])
    const [transcriptFilter, setTranscriptFilter] = React.useState('all')
    const [verdictDrafts, setVerdictDrafts] = React.useState([])
    const [syncToFi, setSyncToFi] = React.useState(true)
    const [envForm, setEnvForm] = React.useState(emptyEnvForm)
    const [envTests, setEnvTests] = React.useState({ host: { state: 'idle' }, array: { state: 'idle' } })
    const [createForm, setCreateForm] = React.useState({
      name: '', mode: 'fault_injection', environment_id: '', fault_injection_key: '',
      run_id: '', fault_injection_task_id: '', fault_injection_build_id: '',
      target_process: '', target_pid: '', target_binary: '', knowledge_pack_dir: '',
      direct_target_key: '', direct_target_title: '', instructions: '',
      provider_id: defaultProviderId || '', agent_model: defaultAgentModel || '',
    })
    const [modelState, setModelState] = React.useState({ status: 'idle' })
    const [modelRefresh, setModelRefresh] = React.useState(0)
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState('')
    const [notice, setNotice] = React.useState('')

    const querySuffix = React.useMemo(() => {
      const params = new URLSearchParams()
      if (cwd) params.set('cwd', cwd)
      if (dataRoot) params.set('data_root', dataRoot)
      return params.toString()
    }, [cwd, dataRoot])

    const loadAll = React.useCallback(async () => {
      try {
        const [lvRes, envRes, fiRes, runsRes] = await Promise.all([
          apiRequest(`/api/pangea-companion/live-verification${querySuffix ? `?${querySuffix}` : ''}`),
          apiRequest('/api/pangea-companion/environments'),
          apiRequest(`/api/pangea-companion/fault-injection?view=all${querySuffix ? `&${querySuffix}` : ''}`).catch(() => ({ tasks: [], builds: [] })),
          apiRequest(`/api/pangea-companion/live-verification?view=run-candidates${querySuffix ? `&${querySuffix}` : ''}`).catch(() => ({ runs: [] })),
        ])
        setTasks(Array.isArray(lvRes.tasks) ? lvRes.tasks : [])
        setLocks(lvRes.locks || envRes.locks || {})
        if (lvRes.verify_engine) {
          setVerifyEngine(lvRes.verify_engine)
          if (lvRes.verify_engine.default_knowledge_pack_dir) {
            setCreateForm(prev => prev.knowledge_pack_dir ? prev : ({ ...prev, knowledge_pack_dir: lvRes.verify_engine.default_knowledge_pack_dir }))
          }
        }
        if (Array.isArray(lvRes.providers) && lvRes.providers.length) {
          setProviders(lvRes.providers)
        } else {
          setProviders(prev => prev.length ? prev : (Array.isArray(availableProviders) && availableProviders.length ? availableProviders : DEFAULT_ACP_PROVIDERS))
        }
        setEnvironments(Array.isArray(envRes.environments) ? envRes.environments : [])
        setFiTasks((Array.isArray(fiRes.tasks) ? fiRes.tasks : []).filter(t => ['ready', 'pushed'].includes(t.status)))
        setFiBuilds((Array.isArray(fiRes.builds) ? fiRes.builds : []).filter(b => ['ready', 'pushed'].includes(b.status)))
        setAnalysisRuns(Array.isArray(runsRes.runs) ? runsRes.runs : [])
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    }, [availableProviders, querySuffix])

    const loadDetail = React.useCallback(async verifyId => {
      if (!verifyId) return
      try {
        const params = new URLSearchParams(querySuffix)
        params.set('verify_id', verifyId)
        const res = await apiRequest(`/api/pangea-companion/live-verification?${params.toString()}`)
        setActiveTask(res.task)
        setTranscript(Array.isArray(res.transcript) ? res.transcript : [])
        if (res.locks) setLocks(res.locks)
        const sourceVerdicts = res.task?.confirmed_verdicts?.length ? res.task.confirmed_verdicts : (res.task?.draft_verdicts || [])
        setVerdictDrafts(prev => (prev.length && prev[0]?._verify_id === verifyId && res.task?.status !== 'confirmed')
          ? prev
          : sourceVerdicts.map(v => ({ ...v, _verify_id: verifyId })))
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    }, [querySuffix])

    React.useEffect(() => { void loadAll() }, [loadAll])

    React.useEffect(() => {
      if (tab !== 'tasks' || subView !== 'create' || createForm.mode !== 'direct_risk' || !createForm.run_id) {
        setRunCandidates({ run_id: '', risks: [], test_cases: [], loading: false })
        setSelectedDirectKeys([])
        return undefined
      }
      let cancelled = false
      setRunCandidates(prev => ({ ...prev, run_id: createForm.run_id, loading: true }))
      setSelectedDirectKeys([])
      const params = new URLSearchParams(querySuffix)
      params.set('view', 'run-candidates')
      params.set('run_id', createForm.run_id)
      apiRequest(`/api/pangea-companion/live-verification?${params.toString()}`)
        .then(res => {
          if (cancelled) return
          setRunCandidates({
            run_id: createForm.run_id,
            risks: Array.isArray(res.risks) ? res.risks : [],
            test_cases: Array.isArray(res.test_cases) ? res.test_cases : [],
            loading: false,
          })
        })
        .catch(() => {
          if (!cancelled) setRunCandidates({ run_id: createForm.run_id, risks: [], test_cases: [], loading: false })
        })
      return () => { cancelled = true }
    }, [tab, subView, createForm.mode, createForm.run_id, querySuffix])

    const lastDraftReq = React.useRef(0)
    React.useEffect(() => {
      if (!draft || !draft.requestId || draft.requestId === lastDraftReq.current) return
      lastDraftReq.current = draft.requestId
      setTab('tasks')
      setSubView('create')
      const fiKey = draft.faultInjectionBuildId
        ? `build:${draft.faultInjectionBuildId}`
        : (draft.runId && draft.faultInjectionTaskId ? `task:${draft.runId}\0${draft.faultInjectionTaskId}` : '')
      setCreateForm(prev => ({
        ...prev,
        mode: draft.mode === 'direct_risk' ? 'direct_risk' : 'fault_injection',
        run_id: draft.runId || '',
        fault_injection_task_id: draft.faultInjectionTaskId || '',
        fault_injection_build_id: draft.faultInjectionBuildId || '',
        fault_injection_key: fiKey,
        name: draft.name || prev.name,
        direct_target_key: draft.targets?.[0]?.target_key || '',
        direct_target_title: draft.targets?.[0]?.title || '',
      }))
      onConsumeDraft?.()
    }, [draft, onConsumeDraft])

    React.useEffect(() => {
      if (tab !== 'tasks' || subView !== 'detail' || !activeTask?.id || !ACTIVE_STATUSES.has(activeTask.status)) return undefined
      const timer = setInterval(() => { void loadDetail(activeTask.id) }, 1500)
      return () => clearInterval(timer)
    }, [tab, subView, activeTask?.id, activeTask?.status, loadDetail])

    const normalizedProviders = React.useMemo(
      () => providers.map(p => ({ ...p, registered: p.registered !== false && p.available !== false })),
      [providers],
    )

    React.useEffect(() => {
      if (!normalizedProviders.length) return
      const usable = normalizedProviders.filter(p => p.registered)
      setCreateForm(prev => {
        if (prev.provider_id && usable.some(p => p.id === prev.provider_id)) return prev
        let remembered = ''
        try { remembered = window.localStorage?.getItem('pangea.acp-provider.v1') ?? '' } catch { /* storage unavailable */ }
        const preferred = [defaultProviderId, remembered, usable[0]?.id].find(id => id && usable.some(p => p.id === id)) || ''
        if (preferred === prev.provider_id) return prev
        return { ...prev, provider_id: preferred, agent_model: preferred === defaultProviderId ? (defaultAgentModel || '') : '' }
      })
    }, [normalizedProviders, defaultProviderId, defaultAgentModel])

    const providerRegistered = normalizedProviders.some(p => p.id === createForm.provider_id && p.registered)

    React.useEffect(() => {
      if (tab !== 'tasks' || subView !== 'create' || !createForm.provider_id || !providerRegistered) {
        setModelState({ status: 'idle' })
        return undefined
      }
      return loadAnalysisAgentModels({
        providerId: createForm.provider_id,
        cwd,
        onState: setModelState,
      })
    }, [tab, subView, createForm.provider_id, providerRegistered, cwd, modelRefresh])

    const modelCatalog = modelState.provider_id === createForm.provider_id && modelState.cwd === cwd && modelState.status === 'ready' ? modelState.catalog : null
    const catalogModels = Array.isArray(modelCatalog?.models) ? modelCatalog.models : []
    const effectiveAgentModel = createForm.agent_model && modelCatalog && !catalogModels.some(m => m.id === createForm.agent_model)
      ? ''
      : createForm.agent_model
    const modelSelection = analysisExecutionState(
      { provider_id: createForm.provider_id, agent_model: effectiveAgentModel },
      normalizedProviders,
      modelState,
      cwd,
    )

    const buildEndpointPayload = (ep, kind) => {
      if (!ep.ip.trim()) return null
      return {
        ip: ep.ip.trim(),
        port: Number(ep.port || 22),
        username: ep.username.trim(),
        auth_kind: ep.auth_kind,
        ...(ep.auth_kind === 'key'
          ? { key_path: ep.key_path.trim(), ...(ep.passphrase ? { passphrase: ep.passphrase } : {}) }
          : { ...(ep.password ? { password: ep.password } : {}) }),
        ...(kind === 'host' && ep.default_workdir?.trim() ? { default_workdir: ep.default_workdir.trim() } : {}),
        ...(kind === 'array' && ep.default_process?.trim() ? { default_process: ep.default_process.trim() } : {}),
      }
    }

    const openNewEnvDrawer = () => {
      setEnvForm(emptyEnvForm())
      setEnvTests({ host: { state: 'idle' }, array: { state: 'idle' } })
      setError('')
      setEnvDrawerOpen(true)
    }

    const openEditEnvDrawer = env => {
      setEnvForm(envToForm(env))
      setEnvTests({ host: { state: 'idle' }, array: { state: 'idle' } })
      setError('')
      setEnvDrawerOpen(true)
    }

    const handleSaveEnvironment = async () => {
      setBusy(true); setError(''); setNotice('')
      try {
        const host = buildEndpointPayload(envForm.host, 'host')
        const array = buildEndpointPayload(envForm.array, 'array')
        if (!envForm.name.trim()) throw new Error('请填写环境名称')
        if (!host && !array) throw new Error('请至少配置测试主机或存储阵列连接')
        await apiRequest('/api/pangea-companion/environments', {
          method: 'POST',
          body: JSON.stringify({
            id: envForm.id || undefined,
            name: envForm.name.trim(),
            notes: envForm.notes.trim(),
            service_topology: envForm.service_topology.trim(),
            stimulus_playbook: envForm.stimulus_playbook.trim(),
            host,
            array,
          }),
        })
        setEnvForm(emptyEnvForm())
        setEnvTests({ host: { state: 'idle' }, array: { state: 'idle' } })
        setEnvDrawerOpen(false)
        setNotice('直连环境已加密保存（磁盘不存储明文密码）')
        await loadAll()
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
      } finally { setBusy(false) }
    }

    const handleTestEndpoint = async (kind, savedEnvId = null) => {
      setEnvTests(prev => ({ ...prev, [kind]: { state: 'testing', message: '正在测试直连…' } }))
      try {
        const endpoint = savedEnvId ? { environment_id: savedEnvId, kind } : buildEndpointPayload(envForm[kind], kind)
        if (!endpoint) throw new Error('请先填写 IP、用户名与认证信息')
        const res = await apiRequest('/api/pangea-companion/environments', {
          method: 'POST',
          body: JSON.stringify({ action: 'test', endpoint }),
        })
        setEnvTests(prev => ({ ...prev, [kind]: { state: 'ok', message: `连接成功 (${res.result?.ip}:${res.result?.port})` } }))
        if (savedEnvId) setNotice(`${kind === 'array' ? '阵列' : '主机'}直连测试成功 (${res.result?.ip}:${res.result?.port})`)
      } catch (reason) {
        const msg = reason instanceof Error ? reason.message : String(reason)
        setEnvTests(prev => ({ ...prev, [kind]: { state: 'error', message: msg } }))
        if (savedEnvId) setError(`${kind === 'array' ? '阵列' : '主机'}连接失败：${msg}`)
      }
    }

    const handleDeleteEnvironment = async id => {
      setBusy(true); setError(''); setNotice('')
      try {
        await apiRequest(`/api/pangea-companion/environments?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
        setNotice('环境已删除')
        await loadAll()
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
      } finally { setBusy(false) }
    }

    const handleStartVerification = async () => {
      setBusy(true); setError(''); setNotice('')
      try {
        if (!createForm.environment_id) throw new Error('请选择目标真机环境')
        if (!modelSelection.ready) throw new Error(modelSelection.message || '请先确认可用的执行 Agent 与模型')
        let payload = {
          action: 'start',
          cwd,
          data_root: dataRoot || undefined,
          name: createForm.name.trim(),
          mode: createForm.mode,
          environment_id: createForm.environment_id,
          provider_id: createForm.provider_id,
          agent_model: modelSelection.model,
          target_process: createForm.target_process.trim(),
          target_pid: createForm.target_pid.trim(),
          target_binary: createForm.target_binary.trim(),
          knowledge_pack_dir: createForm.knowledge_pack_dir.trim(),
          instructions: createForm.instructions.trim(),
        }
        if (createForm.mode === 'fault_injection') {
          const rawKey = createForm.fault_injection_key || ''
          if (rawKey.startsWith('build:')) {
            const buildId = rawKey.slice('build:'.length).trim()
            if (!buildId) throw new Error('请选择一个已就绪/已推送的融合出包或打桩任务')
            payload = { ...payload, fault_injection_build_id: buildId }
          } else {
            const normalized = rawKey.startsWith('task:') ? rawKey.slice('task:'.length) : rawKey
            const [runId, taskId] = normalized.split('\0')
            if (!runId || !taskId) throw new Error('请选择一个已就绪/已推送的融合出包或打桩任务')
            payload = { ...payload, run_id: runId, fault_injection_task_id: taskId }
          }
        } else {
          const candidateMap = new Map()
          for (const item of runCandidates.risks) candidateMap.set(item.target_key, { target_key: item.target_key, title: item.title || item.target_key, kind: 'risk' })
          for (const item of runCandidates.test_cases) candidateMap.set(item.target_key, { target_key: item.target_key, title: item.title || item.target_key, kind: 'test_case' })
          const targets = selectedDirectKeys.map(k => candidateMap.get(k)).filter(Boolean)
          const manualKey = createForm.direct_target_key.trim()
          if (manualKey && !targets.some(t => t.target_key === manualKey)) {
            targets.push({ target_key: manualKey, title: createForm.direct_target_title.trim() || manualKey, kind: 'risk' })
          }
          if (!targets.length) throw new Error('请选择至少一个待核验风险/用例，或手动填写风险编号（如 R-CONC-001）')
          payload = {
            ...payload,
            run_id: createForm.run_id || undefined,
            targets,
          }
        }
        const res = await apiRequest('/api/pangea-companion/live-verification', { method: 'POST', body: JSON.stringify(payload) })
        setActiveTask(res.task)
        setTranscript([])
        setVerdictDrafts([])
        setSelectedVerdictIdx(0)
        setDetailTab('verdicts')
        setSubView('detail')
        setNotice('已启动真机核验（正在执行 Stage-0 在位预检）')
        await loadAll()
        await loadDetail(res.task.id)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
      } finally { setBusy(false) }
    }

    const handleCancelActive = async () => {
      if (!activeTask?.id) return
      setBusy(true); setError('')
      try {
        await apiRequest('/api/pangea-companion/live-verification', {
          method: 'POST',
          body: JSON.stringify({ action: 'cancel', cwd, data_root: dataRoot || undefined, verify_id: activeTask.id }),
        })
        await loadDetail(activeTask.id)
        await loadAll()
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
      } finally { setBusy(false) }
    }

    const handleConfirmVerdicts = async () => {
      if (!activeTask?.id) return
      setBusy(true); setError(''); setNotice('')
      try {
        const verdicts = verdictDrafts.map(({ _verify_id, ...rest }) => rest)
        await apiRequest('/api/pangea-companion/live-verification', {
          method: 'POST',
          body: JSON.stringify({
            action: 'confirm',
            cwd,
            data_root: dataRoot || undefined,
            verify_id: activeTask.id,
            verdicts,
            sync_to_fault_injection: Boolean(syncToFi && (activeTask.fault_injection_task_id || activeTask.fault_injection_build_id)),
          }),
        })
        setNotice('真机核验结论已确认归档')
        await loadDetail(activeTask.id)
        await loadAll()
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
      } finally { setBusy(false) }
    }

    const renderEndpointFields = (kind, title) => {
      const ep = envForm[kind]
      const setEp = patch => setEnvForm(prev => ({ ...prev, [kind]: { ...prev[kind], ...patch } }))
      const testState = envTests[kind]
      return h('div', { className: 'pangea-lv-card', style: { marginBottom: 10, padding: '12px 14px' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 } },
          h('strong', null, title),
          h('button', { type: 'button', className: 'lv-btn', disabled: busy || testState.state === 'testing', onClick: () => void handleTestEndpoint(kind) }, testState.state === 'testing' ? '测试中…' : '测试连接')),
        testState.message ? h('div', { className: `pangea-lv-banner ${testState.state === 'ok' ? 'good' : testState.state === 'error' ? 'danger' : 'info'}`, style: { margin: '0 0 8px' } }, testState.message) : null,
        h('div', { className: 'pangea-lv-row3' },
          h('label', { className: 'pangea-lv-field' }, h('span', null, '直连 IP'), h('input', { value: ep.ip, placeholder: kind === 'host' ? '10.10.20.11' : '10.10.20.21', onChange: e => setEp({ ip: e.target.value }) })),
          h('label', { className: 'pangea-lv-field' }, h('span', null, 'SSH 端口'), h('input', { value: ep.port, placeholder: '22', onChange: e => setEp({ port: e.target.value }) })),
          h('label', { className: 'pangea-lv-field' }, h('span', null, '用户名'), h('input', { value: ep.username, placeholder: 'root', onChange: e => setEp({ username: e.target.value }) }))),
        h('div', { className: 'pangea-lv-grid' },
          h('label', { className: 'pangea-lv-field' }, h('span', null, '认证方式'),
            h('select', { value: ep.auth_kind, onChange: e => setEp({ auth_kind: e.target.value }) },
              h('option', { value: 'password' }, 'SSH 密码（本地加密保存）'),
              h('option', { value: 'key' }, 'SSH 私钥文件'))),
          ep.auth_kind === 'password'
            ? h('label', { className: 'pangea-lv-field' },
                h('span', null, ep.has_password ? 'SSH 密码（留空保持原密文）' : 'SSH 密码'),
                h('input', { type: 'password', value: ep.password, placeholder: ep.has_password ? '••••••••' : '请输入密码', onChange: e => setEp({ password: e.target.value }) }))
            : h('label', { className: 'pangea-lv-field' }, h('span', null, '私钥路径'), h('input', { value: ep.key_path, placeholder: '~/.ssh/id_rsa', onChange: e => setEp({ key_path: e.target.value }) }))),
        ep.auth_kind === 'key'
          ? h('label', { className: 'pangea-lv-field' }, h('span', null, '私钥口令（可选）'), h('input', { type: 'password', value: ep.passphrase, onChange: e => setEp({ passphrase: e.target.value }) }))
          : null,
        kind === 'array'
          ? h('label', { className: 'pangea-lv-field', style: { marginBottom: 0 } }, h('span', null, '默认目标守护进程名（可选 · 用于 Stage-0 验 /proc/<pid>/exe）'), h('input', { value: ep.default_process || '', placeholder: '如 storage_daemon', onChange: e => setEp({ default_process: e.target.value }) }))
          : h('label', { className: 'pangea-lv-field', style: { marginBottom: 0 } }, h('span', null, '默认测试工作目录（可选）'), h('input', { value: ep.default_workdir || '', placeholder: '如 /root/test-work', onChange: e => setEp({ default_workdir: e.target.value }) })))
    }

    const renderEnvDrawer = () => !envDrawerOpen ? null : h('div', {
      className: 'pangea-lv-modal-backdrop',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': envForm.id ? '编辑直连环境' : '新增直连环境',
      onClick: e => { if (e.target === e.currentTarget) setEnvDrawerOpen(false) },
    },
      h('div', { className: 'pangea-lv-drawer' },
        h('div', { className: 'pangea-lv-drawer-head' },
          h('strong', { style: { fontSize: 15 } }, envForm.id ? '编辑直连环境' : '新增直连环境'),
          h('button', { type: 'button', className: 'lv-btn', onClick: () => setEnvDrawerOpen(false) }, '关闭')),
        h('div', { className: 'pangea-lv-drawer-body' },
          error ? h('div', { role: 'alert', className: 'pangea-lv-banner danger', style: { marginTop: 0 } }, error) : null,
          h('div', { className: 'pangea-lv-grid' },
            h('label', { className: 'pangea-lv-field' }, h('span', null, '环境名称'), h('input', { value: envForm.name, placeholder: '如 昆仑实验室 03 · NVMe-oF 联调', onChange: e => setEnvForm(prev => ({ ...prev, name: e.target.value })) })),
            h('label', { className: 'pangea-lv-field' }, h('span', null, '备注（可选）'), h('input', { value: envForm.notes, placeholder: '机型、版本或独占说明', onChange: e => setEnvForm(prev => ({ ...prev, notes: e.target.value })) }))),
          renderEndpointFields('array', '存储阵列（Array · 推荐必填）'),
          renderEndpointFields('host', '测试主机（Host · 可选）'),
          h('details', { style: { marginTop: 6, borderTop: '1px solid #eef0f3', paddingTop: 8 } },
            h('summary', { style: { cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#5e6773' } }, '环境级复用知识：服务拓扑与常用刺激手册（可选，自动透传给核验 Agent）'),
            h('div', { style: { marginTop: 8 } },
              h('label', { className: 'pangea-lv-field' },
                h('span', null, '服务拓扑 / 常用路径与进程（service_topology）'),
                h('textarea', { value: envForm.service_topology, placeholder: '例如：主进程 storage_daemon、日志 /var/log/storage/、调测 CLI /opt/storage/bin/adm', onChange: e => setEnvForm(prev => ({ ...prev, service_topology: e.target.value })) })),
              h('label', { className: 'pangea-lv-field', style: { marginBottom: 0 } },
                h('span', null, '常用外部刺激与调测命令手册（stimulus_playbook）'),
                h('textarea', { value: envForm.stimulus_playbook, placeholder: '例如：主机侧 fio / nvme-cli 命令模板、阵列侧管理 CLI 或状态查询命令', onChange: e => setEnvForm(prev => ({ ...prev, stimulus_playbook: e.target.value })) }))))),
        h('div', { className: 'pangea-lv-drawer-foot' },
          h('button', { type: 'button', className: 'lv-btn', onClick: () => setEnvDrawerOpen(false) }, '取消'),
          h('button', { type: 'button', className: 'lv-btn primary', disabled: busy, onClick: () => void handleSaveEnvironment() }, envForm.id ? '保存修改' : '加密保存环境'))))

    const renderEnvironmentsTab = () => h('div', { 'data-testid': 'lv-environments-tab' },
      h('div', { className: 'pangea-lv-card' },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 } },
          h('div', null,
            h('h3', { style: { margin: 0, fontSize: 15 } }, `已配置直连环境（${environments.length}）`),
            h('div', { style: { fontSize: 12, color: '#5e6773', marginTop: 2 } }, 'SSH 密码本地加密落盘，对外接口与模型会话全程脱敏；同 IP 并发自动互斥加锁。')),
          h('button', { type: 'button', className: 'lv-btn primary', onClick: openNewEnvDrawer }, '新增直连环境')),
        !environments.length
          ? h('p', { style: { color: '#5e6773', margin: '10px 0 4px' } }, '尚未配置真机环境。点击右上角“新增直连环境”添加测试主机或存储阵列。')
          : h('table', { className: 'pangea-lv-table', 'aria-label': '已配置环境列表' },
              h('thead', null, h('tr', null, ...['环境名称', '测试主机（Host）', '存储阵列（Array）', '占用锁状态', '操作'].map(t => h('th', { key: t }, t)))),
              h('tbody', null, environments.map(env => {
                const locked = (env.host?.ip && locks[env.host.ip]) || (env.array?.ip && locks[env.array.ip])
                return h('tr', { key: env.id },
                  h('td', null, h('strong', null, env.name), env.notes ? h('div', { style: { fontSize: 12, color: '#5e6773' } }, env.notes) : null),
                  h('td', null, env.host?.ip ? `${env.host.username}@${env.host.ip}:${env.host.port}` : '未配置'),
                  h('td', null, env.array?.ip ? h(React.Fragment, null, `${env.array.username}@${env.array.ip}:${env.array.port}`, env.array.default_process ? h('div', { style: { fontSize: 12, color: '#5e6773' } }, `进程: ${env.array.default_process}`) : null) : '未配置'),
                  h('td', null, locked ? h('span', { className: 'pangea-lv-pill warn' }, `占用中 (${locked.verify_id.slice(0, 14)})`) : h('span', { className: 'pangea-lv-pill good' }, '空闲')),
                  h('td', null, h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                    env.array?.ip ? h('button', { type: 'button', className: 'lv-btn', onClick: () => void handleTestEndpoint('array', env.id) }, '测阵列') : null,
                    env.host?.ip ? h('button', { type: 'button', className: 'lv-btn', onClick: () => void handleTestEndpoint('host', env.id) }, '测主机') : null,
                    h('button', { type: 'button', className: 'lv-btn', onClick: () => openEditEnvDrawer(env) }, '编辑'),
                    h('button', { type: 'button', className: 'lv-btn danger', disabled: Boolean(locked) || busy, onClick: () => void handleDeleteEnvironment(env.id) }, '删除'))))
              })))),
      renderEnvDrawer())

    const toggleDirectKey = key => {
      setSelectedDirectKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
    }

    const renderCreateView = () => {
      const selectedEnv = environments.find(e => e.id === createForm.environment_id)
      const lockedHolder = (selectedEnv?.array?.ip && locks[selectedEnv.array.ip]) || (selectedEnv?.host?.ip && locks[selectedEnv.host.ip])
      return h('div', { className: 'pangea-lv-card', 'data-testid': 'lv-create-form' },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 } },
          h('h3', { style: { margin: 0, fontSize: 15 } }, '新建真机风险核验'),
          h('button', { type: 'button', className: 'lv-btn', onClick: () => setSubView('list') }, '返回核验列表')),
        h('div', { className: 'pangea-lv-grid' },
          h('label', { className: 'pangea-lv-field' }, h('span', null, '核验来源模式'),
            h('select', { 'aria-label': '核验来源模式', value: createForm.mode, onChange: e => setCreateForm(prev => ({ ...prev, mode: e.target.value })) },
              h('option', { value: 'fault_injection' }, '关联已打桩出包 / 任务（强验真机二进制标记）'),
              h('option', { value: 'direct_risk' }, '免打桩风险（直接用现有调测/外部刺激核验）'))),
          h('label', { className: 'pangea-lv-field' }, h('span', null, '核验任务名称（可选）'),
            h('input', { value: createForm.name, placeholder: '留空自动按环境命名', onChange: e => setCreateForm(prev => ({ ...prev, name: e.target.value })) }))),
        createForm.mode === 'fault_injection'
          ? h('label', { className: 'pangea-lv-field' }, h('span', null, '选择已打桩融合出包或单任务（需已完成补丁生成）'),
              h('select', { 'aria-label': '选择已打桩任务', value: createForm.fault_injection_key, onChange: e => setCreateForm(prev => ({ ...prev, fault_injection_key: e.target.value })) },
                h('option', { value: '' }, '请选择融合出包或打桩任务…'),
                fiBuilds.length ? h('optgroup', { label: '已推送融合出包 (Build)' },
                  fiBuilds.map(b => h('option', { key: `build:${b.id}`, value: `build:${b.id}` }, `[融合包] ${b.name || b.id}（${b.task_refs?.length ?? 0} 任务 · ${b.point_count ?? 0} 桩点 · ${b.status}）`))) : null,
                fiTasks.length ? h('optgroup', { label: '已打桩单任务 (Task)' },
                  fiTasks.map(t => h('option', { key: `task:${t.run_id}\0${t.id}`, value: `task:${t.run_id}\0${t.id}` }, `${t.name || t.id}（${t.case_count ?? 0} 用例 · ${t.point_count ?? 0} 桩点 · ${t.status}）`))) : null))
          : h('div', null,
              analysisRuns.length ? h('label', { className: 'pangea-lv-field' },
                h('span', null, '关联分析任务（可选 · 自动带入风险/用例语义与工具清单）'),
                h('select', { 'aria-label': '关联分析任务', value: createForm.run_id, onChange: e => setCreateForm(prev => ({ ...prev, run_id: e.target.value })) },
                  h('option', { value: '' }, '不关联（仅手动填写目标）'),
                  analysisRuns.map(r => h('option', { key: r.run_id, value: r.run_id }, `${r.title || r.run_id} (${r.run_id})`)))) : null,
              createForm.run_id && (runCandidates.loading || runCandidates.risks.length || runCandidates.test_cases.length)
                ? h('div', { style: { marginBottom: 8, padding: '8px 10px', border: '1px solid #e2e6ec', borderRadius: 6, background: '#f8f9fb', maxHeight: 150, overflowY: 'auto' } },
                    runCandidates.loading
                      ? h('span', { style: { fontSize: 12, color: '#5e6773' } }, '正在读取该分析任务的风险与用例…')
                      : h('div', { style: { display: 'grid', gap: 5 } },
                          runCandidates.risks.map(item => h('label', { key: `r:${item.target_key}`, style: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, cursor: 'pointer' } },
                            h('input', { type: 'checkbox', checked: selectedDirectKeys.includes(item.target_key), onChange: () => toggleDirectKey(item.target_key) }),
                            h('code', null, item.target_key),
                            (item.verification_status === 'needs_runtime_verification' || item.needs_runtime_verification) ? h('span', { className: 'pangea-lv-pill warn', style: { fontSize: 11, padding: '1px 6px' } }, '待真机实锤') : null,
                            h('span', { style: { color: '#374151' } }, item.title))),
                          runCandidates.test_cases.map(item => h('label', { key: `c:${item.target_key}`, style: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, cursor: 'pointer' } },
                            h('input', { type: 'checkbox', checked: selectedDirectKeys.includes(item.target_key), onChange: () => toggleDirectKey(item.target_key) }),
                            h('code', null, item.target_key),
                            h('span', { className: 'pangea-lv-pill info', style: { fontSize: 11, padding: '1px 6px' } }, '用例'),
                            h('span', { style: { color: '#374151' } }, item.title)))))
                : null,
              h('div', { className: 'pangea-lv-grid' },
                h('label', { className: 'pangea-lv-field' }, h('span', null, '待核验风险编号'), h('input', { value: createForm.direct_target_key, placeholder: '如 R-CONC-001（勾选上方风险时可留空）', onChange: e => setCreateForm(prev => ({ ...prev, direct_target_key: e.target.value })) })),
                h('label', { className: 'pangea-lv-field' }, h('span', null, '风险标题 / 核验目标'), h('input', { value: createForm.direct_target_title, placeholder: '简要描述待复现现象', onChange: e => setCreateForm(prev => ({ ...prev, direct_target_title: e.target.value })) })))),
        h('div', { className: 'pangea-lv-grid' },
          h('label', { className: 'pangea-lv-field' }, h('span', null, '目标真机环境（SSH 直连）'),
            h('select', { 'aria-label': '目标真机环境', value: createForm.environment_id, onChange: e => setCreateForm(prev => ({ ...prev, environment_id: e.target.value })) },
              h('option', { value: '' }, environments.length ? '请选择环境…' : '暂无环境，请先去「环境管理」新增'),
              environments.map(env => h('option', { key: env.id, value: env.id }, `${env.name} (${[env.host?.ip ? `Host:${env.host.ip}` : '', env.array?.ip ? `Array:${env.array.ip}` : ''].filter(Boolean).join(' / ')})`)))),
          h('label', { className: 'pangea-lv-field' }, h('span', null, '核验执行 Agent（外部 ACP）'),
            h('select', {
              'aria-label': '核验执行 Agent',
              value: createForm.provider_id,
              disabled: busy || !normalizedProviders.length,
              onChange: e => setCreateForm(prev => ({ ...prev, provider_id: e.target.value, agent_model: '' })),
            },
              !createForm.provider_id ? h('option', { value: '', disabled: true }, normalizedProviders.length ? '请选择已加载的外部 Agent' : '正在读取外部 Agent…') : null,
              normalizedProviders.map(p => h('option', { key: p.id, value: p.id, disabled: !p.registered }, p.registered ? (p.label || p.id) : `${p.label || p.id}（未就绪）`)))),
          h('div', { className: 'pangea-lv-field' },
            h('label', { style: { display: 'grid', gap: 4 } },
              h('span', null, '执行模型'),
              h('select', {
                'aria-label': '执行模型',
                value: effectiveAgentModel || '',
                disabled: busy || !modelCatalog,
                onChange: e => setCreateForm(prev => ({ ...prev, agent_model: e.target.value })),
              },
                h('option', {
                  value: '',
                  disabled: !(modelCatalog?.current_model && catalogModels.some(m => m.id === modelCatalog.current_model)),
                }, modelCatalog?.current_model && catalogModels.some(m => m.id === modelCatalog.current_model)
                  ? `使用 Agent 默认（${modelCatalog.current_model}）`
                  : modelState.status === 'loading' ? '读取模型中…' : '请选择可用模型'),
                catalogModels.map(m => h('option', { key: m.id, value: m.id }, m.label && m.label !== m.id ? `${m.label} · ${m.id}` : m.id)))),
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 2 } },
              h('span', {
                role: modelState.status === 'error' ? 'alert' : 'status',
                style: { fontSize: 12, fontWeight: 400, color: modelState.status === 'error' ? '#9c2330' : '#5e6773' },
              }, modelSelection.message),
              h('button', {
                type: 'button',
                className: 'lv-btn',
                style: { minHeight: 26, padding: '2px 9px', fontSize: 12, flexShrink: 0 },
                disabled: busy || !createForm.provider_id || !providerRegistered || modelState.status === 'loading',
                onClick: () => setModelRefresh(value => value + 1),
              }, '刷新模型')))),
        lockedHolder ? h('div', { className: 'pangea-lv-banner warn' }, `当前所选环境正被任务 ${lockedHolder.verify_id} 占用，启动将被互斥锁拦截。`) : null,
        h('details', { style: { margin: '4px 0 10px', borderTop: '1px solid #eef0f3', paddingTop: 8 } },
          h('summary', { style: { cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#5e6773' } }, '高级选项：Knowledge Pack 知识包、Stage-0 进程/二进制覆写与现场说明（可选）'),
          h('div', { className: 'pangea-lv-grid', style: { marginTop: 8 } },
            h('label', { className: 'pangea-lv-field' }, h('span', null, '目标守护进程名'), h('input', { value: createForm.target_process, placeholder: selectedEnv?.array?.default_process || '如 storage_daemon', onChange: e => setCreateForm(prev => ({ ...prev, target_process: e.target.value })) })),
            h('label', { className: 'pangea-lv-field' }, h('span', null, '部署二进制绝对路径'), h('input', { value: createForm.target_binary, placeholder: '如 /opt/storage/bin/daemon', onChange: e => setCreateForm(prev => ({ ...prev, target_binary: e.target.value })) }))),
          h('label', { className: 'pangea-lv-field' },
            h('span', null, '内网 Knowledge Pack 知识包目录（可选 · 只读复用已转正能力卡与源码 CLI 索引）'),
            h('input', { value: createForm.knowledge_pack_dir, placeholder: '如 /path/to/intranet-knowledge-pack（留空则不挂载）', onChange: e => setCreateForm(prev => ({ ...prev, knowledge_pack_dir: e.target.value })) })),
          verifyEngine?.available
            ? h('div', { className: 'pangea-lv-banner info', style: { fontSize: 12 } },
                `pangea-verify 独立引擎已桥接${verifyEngine.verified_card_count !== null ? `（默认知识包已转正 ${verifyEngine.verified_card_count} 张能力卡）` : ''}；聊天驯化 MCP 入口：${verifyEngine.mcp_command_hint}`)
            : null,
          h('label', { className: 'pangea-lv-field' }, h('span', null, '补充现场核验说明'),
            h('textarea', { value: createForm.instructions, placeholder: '例如：目标 LUN ID、测试端口、日志路径等现场约束…', onChange: e => setCreateForm(prev => ({ ...prev, instructions: e.target.value })) }))),
        h('div', { style: { display: 'flex', gap: 8 } },
          h('button', { type: 'button', className: 'lv-btn primary', disabled: busy || Boolean(lockedHolder) || !modelSelection.ready, onClick: () => void handleStartVerification() }, '启动真机核验（先执行 Stage-0 验包）'),
          !environments.length ? h('button', { type: 'button', className: 'lv-btn', onClick: () => { setTab('environments'); openNewEnvDrawer() } }, '去新增环境') : null))
    }

    const renderDetailView = () => {
      if (!activeTask) return null
      const filteredTranscript = transcript.filter(item => transcriptFilter === 'all' ? true : transcriptFilter === 'blocked' ? item.blocked : item.target === transcriptFilter)
      const canConfirm = ['completed', 'blocked', 'confirmed'].includes(activeTask.status) && verdictDrafts.length > 0
      const activeIdx = Math.min(selectedVerdictIdx, Math.max(0, verdictDrafts.length - 1))
      const currentVerdict = verdictDrafts[activeIdx] || null
      const jumpToCmd = cmdId => {
        setFocusedCmdId(cmdId)
        setTranscriptFilter('all')
        setDetailTab('transcript')
      }

      return h('div', { 'data-testid': 'lv-detail-view' },
        // Compact header card
        h('div', { className: 'pangea-lv-card' },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
            h('div', null,
              h('h3', { style: { margin: 0, fontSize: 15 } }, activeTask.name),
              h('div', { style: { fontSize: 12, color: '#5e6773', marginTop: 3 } },
                `${activeTask.id} · ${activeTask.environment?.name || ''} · ${activeTask.mode === 'direct_risk' ? '免打桩直测' : '打桩实锤'}`)),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h('span', { className: `pangea-lv-pill ${statusTone(activeTask.status)}` }, LIVE_STATUS_LABELS[activeTask.status] || activeTask.status),
              ACTIVE_STATUSES.has(activeTask.status) ? h('button', { type: 'button', className: 'lv-btn danger', disabled: busy, onClick: () => void handleCancelActive() }, '停止并清理') : null,
              h('button', { type: 'button', className: 'lv-btn', onClick: () => void loadDetail(activeTask.id) }, '刷新'),
              h('button', { type: 'button', className: 'lv-btn', onClick: () => setSubView('list') }, '返回列表'))),
          activeTask.error ? h('div', { className: 'pangea-lv-banner danger' }, activeTask.error) : null,
          activeTask.preflight?.guidance && !activeTask.preflight.ok ? h('div', { className: 'pangea-lv-banner warn' }, activeTask.preflight.guidance) : null,
          Array.isArray(activeTask.sync_warnings) && activeTask.sync_warnings.length
            ? h('div', { className: 'pangea-lv-banner warn' }, `回写来源打桩任务告警：${activeTask.sync_warnings.join('；')}`) : null,
          Array.isArray(activeTask.reference_warnings) && activeTask.reference_warnings.length
            ? h('div', { className: 'pangea-lv-banner warn' }, `关联分析参考告警：${activeTask.reference_warnings.join('；')}`) : null,
          (!activeTask.cleanup && Array.isArray(activeTask.registered_cleanups) && activeTask.registered_cleanups.length && !ACTIVE_STATUSES.has(activeTask.status))
            ? h('div', { className: 'pangea-lv-banner danger' },
                '任务异常中断，以下已登记的撤桩/清理命令可能尚未执行，请在真机核查并手动恢复：',
                h('ul', { style: { margin: '6px 0 0', paddingLeft: 18, fontSize: 12 } },
                  activeTask.registered_cleanups.map((item, idx) => h('li', { key: idx },
                    `[${item.target}] `, h('code', null, item.command), item.description ? ` — ${item.description}` : ''))))
            : null,
          activeTask.summary ? h('div', { className: 'pangea-lv-banner info', style: { marginBottom: 0 } }, activeTask.summary) : null),

        // Single-line compact health strip (Stage-0 + Cleanup)
        h('div', { className: 'pangea-lv-strip' },
          activeTask.preflight ? h('span', { className: 'pangea-lv-strip-item' },
            h('span', { className: `pangea-lv-pill ${activeTask.preflight.ok ? 'good' : 'danger'}` }, `Stage-0 在位预检：${activeTask.preflight.ok ? '通过' : '阻断'}`),
            activeTask.preflight.baseline?.binary_path ? h('span', { style: { color: '#5e6773', fontSize: 12 } }, `${activeTask.preflight.baseline.binary_path}${activeTask.preflight.baseline.pid ? ` (PID ${activeTask.preflight.baseline.pid})` : ''}`) : null) : null,
          activeTask.cleanup ? h('span', { className: 'pangea-lv-strip-item' },
            h('span', { className: `pangea-lv-pill ${activeTask.cleanup.status === 'ok' ? 'good' : 'danger'}` }, `宿主兜底清理与进程对账：${activeTask.cleanup.status === 'ok' ? '正常' : '异常'}`),
            activeTask.cleanup.post_check ? h('span', { style: { color: '#5e6773', fontSize: 12 } }, `进程${activeTask.cleanup.post_check.process_alive ? '存活' : '未运行'} · PID ${activeTask.cleanup.post_check.baseline_pid || '?'} → ${activeTask.cleanup.post_check.after_pid || '?'}`) : null) : null,
          activeTask.max_gateway_calls ? h('span', { className: 'pangea-lv-strip-item', style: { marginLeft: 'auto', color: '#5e6773', fontSize: 12 } },
            `网关调用：${activeTask.gateway_calls_used ?? transcript.filter(t => t.phase === 'worker' && ['exec', 'bg-start', 'interactive'].includes(t.kind)).length} / ${activeTask.max_gateway_calls}`) : null),

        // Main detail card with internal tabs so page stays compact
        h('div', { className: 'pangea-lv-card', style: { marginBottom: 0 } },
          h('div', { className: 'pangea-lv-subtabs' },
            h('div', { className: 'pangea-lv-tabs', role: 'tablist' },
              h('button', { type: 'button', role: 'tab', 'aria-selected': detailTab === 'verdicts', onClick: () => setDetailTab('verdicts') }, `核验结论（${verdictDrafts.length}）`),
              h('button', { type: 'button', role: 'tab', 'aria-selected': detailTab === 'transcript', onClick: () => setDetailTab('transcript') }, `SSH 命令实录（${transcript.length}）`),
              h('button', { type: 'button', role: 'tab', 'aria-selected': detailTab === 'checks', onClick: () => setDetailTab('checks') }, '预检与清理明细')),
            detailTab === 'transcript'
              ? h('select', { style: { width: 'auto', minHeight: 30 }, value: transcriptFilter, onChange: e => setTranscriptFilter(e.target.value) },
                  h('option', { value: 'all' }, '全部命令'),
                  h('option', { value: 'array' }, '仅存储阵列 (array)'),
                  h('option', { value: 'host' }, '仅测试主机 (host)'),
                  h('option', { value: 'blocked' }, '仅高危拦截'))
              : null),

          detailTab === 'verdicts' ? (
            !canConfirm
              ? h('p', { style: { color: '#5e6773', margin: '8px 0' } }, ACTIVE_STATUSES.has(activeTask.status) ? '核验执行中，完成后将在此生成四态结论草稿…' : '暂无待确认结论。')
              : h('div', null,
                  h('div', { className: verdictDrafts.length > 1 ? 'pangea-lv-split' : '' },
                    verdictDrafts.length > 1 ? h('div', { className: 'pangea-lv-target-list' }, verdictDrafts.map((item, idx) =>
                      h('button', { key: item.target_key, type: 'button', className: 'pangea-lv-target-btn', 'aria-pressed': idx === activeIdx, onClick: () => setSelectedVerdictIdx(idx) },
                        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 } },
                          h('strong', { style: { fontSize: 13 } }, item.target_key),
                          h('span', { className: `pangea-lv-pill ${verdictTone(item.verdict)}` }, LIVE_VERDICT_LABELS[item.verdict] || item.verdict)),
                        item.hits ? h('span', { style: { fontSize: 11, color: '#5e6773' } }, item.hits) : null))) : null,
                    currentVerdict ? h('div', null,
                      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 } },
                        h('strong', { style: { fontSize: 14 } }, currentVerdict.target_key),
                        h('span', { className: `pangea-lv-pill ${verdictTone(currentVerdict.verdict)}` }, LIVE_VERDICT_LABELS[currentVerdict.verdict] || currentVerdict.verdict)),
                      h('div', { className: 'pangea-lv-grid' },
                        h('label', { className: 'pangea-lv-field' }, h('span', null, '四态核验结论'),
                          h('select', { value: currentVerdict.verdict, onChange: e => setVerdictDrafts(prev => prev.map((v, i) => i === activeIdx ? { ...v, verdict: e.target.value } : v)) },
                            Object.entries(LIVE_VERDICT_LABELS).map(([k, label]) => h('option', { key: k, value: k }, label)))),
                        h('label', { className: 'pangea-lv-field' }, h('span', null, '桩点命中计数'),
                          h('input', { value: currentVerdict.hits || '', onChange: e => setVerdictDrafts(prev => prev.map((v, i) => i === activeIdx ? { ...v, hits: e.target.value } : v)) }))),
                      currentVerdict.evidence_command_ids?.length ? h('div', { style: { marginBottom: 8, fontSize: 12, color: '#5e6773' } },
                        '引用真实回执（点击定位）：',
                        currentVerdict.evidence_command_ids.map(cid => h('button', { key: cid, type: 'button', className: 'pangea-lv-cmd-chip', onClick: () => jumpToCmd(cid) }, cid))) : null,
                      h('label', { className: 'pangea-lv-field' }, h('span', null, '实际观察现象与备注'),
                        h('textarea', { value: currentVerdict.observed_behavior || currentVerdict.notes || '', onChange: e => setVerdictDrafts(prev => prev.map((v, i) => i === activeIdx ? { ...v, observed_behavior: e.target.value } : v)) }))) : null),
                  h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 12, paddingTop: 10, borderTop: '1px solid #eef0f3' } },
                    (activeTask.fault_injection_task_id || activeTask.fault_injection_build_id) ? h('label', { style: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 13 } },
                      h('input', { type: 'checkbox', checked: syncToFi, onChange: e => setSyncToFi(e.target.checked) }),
                      '同步写入一条实测记录到来源打桩任务的验证历史') : h('span'),
                    h('button', { type: 'button', className: 'lv-btn primary', disabled: busy, onClick: () => void handleConfirmVerdicts() }, activeTask.status === 'confirmed' ? '更新归档结论' : '确认归档')))
          ) : detailTab === 'transcript' ? (
            h('div', { className: 'pangea-lv-scroll' },
              !filteredTranscript.length
                ? h('p', { style: { color: '#5e6773', margin: 0 } }, '暂无 SSH 命令记录。')
                : filteredTranscript.map(entry => h('details', { key: entry.command_id, open: focusedCmdId === entry.command_id || undefined, style: { borderBottom: '1px solid #eef0f3', padding: '7px 0' } },
                    h('summary', { style: { cursor: 'pointer', fontSize: 13 } },
                      h('code', { style: { marginRight: 8 } }, entry.command_id),
                      h('span', { className: `pangea-lv-pill ${entry.blocked ? 'danger' : entry.exit_code === 0 ? 'good' : 'warn'}`, style: { marginRight: 8 } },
                        entry.blocked ? '已拦截' : `${entry.target} · exit ${entry.exit_code ?? '—'}`),
                      entry.command || entry.kind),
                    entry.error ? h('div', { className: 'pangea-lv-banner danger' }, entry.error) : null,
                    entry.stdout ? h('pre', { className: 'pangea-lv-pre' }, entry.stdout) : null,
                    entry.stderr ? h('pre', { className: 'pangea-lv-pre', style: { color: '#9c2330' } }, entry.stderr) : null)))
          ) : (
            h('div', { className: 'pangea-lv-scroll' },
              h('h4', { style: { margin: '0 0 6px', fontSize: 13 } }, 'Stage-0 在位预检明细'),
              h('ul', { style: { margin: '0 0 12px', paddingLeft: 18, fontSize: 13 } },
                (activeTask.preflight?.checks || []).map((c, idx) => h('li', { key: idx, style: { color: c.ok ? '#20765a' : '#9c2330' } },
                  c.kind === 'marker'
                    ? `[${c.ok ? 'OK' : c.detail ? 'ERROR' : 'MISSING'}] 标记 "${c.marker}" @ ${c.binary}${c.detail ? ` — ${c.detail}` : ''} (${c.command_id})`
                    : `[${c.ok ? 'OK' : 'FAIL'}] ${c.target} SSH: ${c.detail} (${c.command_id})`))),
              h('h4', { style: { margin: '0 0 6px', fontSize: 13 } }, '宿主兜底清理与进程对账'),
              activeTask.cleanup?.post_check ? h('p', { style: { margin: '0 0 6px', fontSize: 13 } },
                `目标进程存活: ${activeTask.cleanup.post_check.process_alive ? '是' : '否'} · 初始 PID: ${activeTask.cleanup.post_check.baseline_pid || '未知'} → 当前 PID: ${activeTask.cleanup.post_check.after_pid || '未知'}`) : null,
              activeTask.cleanup?.steps?.length
                ? h('ul', { style: { margin: '0 0 10px', paddingLeft: 18, fontSize: 12 } },
                    activeTask.cleanup.steps.map((s, idx) => h('li', { key: idx }, `[${s.ok ? 'OK' : 'FAIL'}] (${s.target}) ${s.description || ''} ${s.command_id || s.error || ''}`)))
                : h('p', { style: { color: '#5e6773', margin: '0 0 10px', fontSize: 12 } }, '无已执行的清理步骤。'),
              Array.isArray(activeTask.registered_cleanups) && activeTask.registered_cleanups.length
                ? h('div', null,
                    h('h4', { style: { margin: '0 0 6px', fontSize: 13 } }, `已登记撤桩/清理命令（${activeTask.registered_cleanups.length}）`),
                    h('ul', { style: { margin: 0, paddingLeft: 18, fontSize: 12 } },
                      activeTask.registered_cleanups.map((item, idx) => h('li', { key: idx }, `[${item.target}] `, h('code', null, item.command), item.description ? ` — ${item.description}` : ''))))
                : null))))
    }

    const renderListView = () => h('div', { className: 'pangea-lv-card', 'data-testid': 'lv-task-list' },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 } },
        h('h3', { style: { margin: 0, fontSize: 15 } }, `真机核验任务（${tasks.length}）`),
        h('button', { type: 'button', className: 'lv-btn primary', onClick: () => setSubView('create') }, '新建真机核验')),
      !tasks.length
        ? h('p', { style: { color: '#5e6773', margin: 0 } }, '暂无真机核验记录。打桩推送并手动完成出包、烧包后，点击“新建真机核验”上真机实锤风险。')
        : h('table', { className: 'pangea-lv-table', 'aria-label': '真机核验任务列表' },
            h('thead', null, h('tr', null, ...['名称', '模式', '目标环境', '状态', '结论概览', '创建时间'].map(t => h('th', { key: t }, t)))),
            h('tbody', null, tasks.map(task => {
              const verdicts = task.confirmed_verdicts?.length ? task.confirmed_verdicts : (task.draft_verdicts || [])
              const summaryText = verdicts.length ? verdicts.map(v => `${v.target_key}:${LIVE_VERDICT_LABELS[v.verdict] || v.verdict}`).join(' / ') : '—'
              return h('tr', { key: task.id },
                h('td', null, h('button', { type: 'button', className: 'pangea-lv-link', onClick: () => { setActiveTask(task); setSelectedVerdictIdx(0); setDetailTab('verdicts'); setSubView('detail'); void loadDetail(task.id) } }, task.name || task.id)),
                h('td', null, task.mode === 'direct_risk' ? '免打桩直测' : '打桩实锤'),
                h('td', null, task.environment?.name || '—'),
                h('td', null, h('span', { className: `pangea-lv-pill ${statusTone(task.status)}` }, LIVE_STATUS_LABELS[task.status] || task.status)),
                h('td', null, summaryText),
                h('td', null, task.created_at ? new Date(task.created_at).toLocaleString() : ''))
            }))))

    return h('section', { className: 'pangea-lv', 'data-testid': 'live-verification-workspace' },
      h('style', null, LV_CSS),
      h('div', { className: 'pangea-lv-head' },
        h('h2', null, '真机核验'),
        h('div', { className: 'pangea-lv-tabs', role: 'tablist' },
          h('button', { type: 'button', role: 'tab', 'aria-selected': tab === 'tasks', onClick: () => setTab('tasks') }, `核验任务（${tasks.length}）`),
          h('button', { type: 'button', role: 'tab', 'aria-selected': tab === 'environments', onClick: () => setTab('environments') }, `环境管理（${environments.length}）`))),
      !envDrawerOpen && error ? h('div', { role: 'alert', className: 'pangea-lv-banner danger' }, error) : null,
      notice ? h('div', { role: 'status', className: 'pangea-lv-banner good' }, notice) : null,
      tab === 'environments'
        ? renderEnvironmentsTab()
        : subView === 'create'
          ? renderCreateView()
          : subView === 'detail'
            ? renderDetailView()
            : renderListView())
  }
}
