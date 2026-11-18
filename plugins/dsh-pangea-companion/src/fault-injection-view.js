import { analysisExecutionState, loadAnalysisAgentModels } from './agent-model-selection.js'
import { buildVerificationShellScript, caseKeyOf, classifyInjectionCandidate, duplicateCaseKeySet, parseVerificationLog } from './fault-injection-candidates.js'
import { createRepositorySettings, sourceLabel } from './repository-settings-view.js'
export const INJECTION_STATUS_LABELS = {
  preparing: '准备源码', generating: '生成打桩修改', ready: '修改已生成', pushing: '提交与推送中',
  pushed: '个人分支已推送', failed: '生成失败', cancelled: '已停止', interrupted: '操作已中断',
}
const readable = value => value == null ? '' : typeof value === 'string' ? value : Array.isArray(value) ? value.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join('\n') : JSON.stringify(value, null, 2)

export function createFaultInjectionPanel(React) {
  const h = React.createElement
  const RepositorySettings = createRepositorySettings(React)
  const busy = task => ['preparing', 'generating', 'pushing'].includes(task?.status)
  return function FaultInjectionPanel({ runId, dataRoot, cwd, onOpenPipeline, cases = [], standalone = false, onBack, initialCaseKeys = [], handoffRevision = 0 }) {
    const [open, setOpen] = React.useState(standalone)
    const [profileKey, setProfileKey] = React.useState('')
    const [tasks, setTasks] = React.useState([])
    const [taskId, setTaskId] = React.useState('')
    const [acknowledged, setAcknowledged] = React.useState({})
    const [step, setStep] = React.useState(2)
    const [chosen, setChosen] = React.useState(() => Array.isArray(initialCaseKeys) ? [...initialCaseKeys] : [])
    const [handoffNote, setHandoffNote] = React.useState('')
    const [repoSetupOpen, setRepoSetupOpen] = React.useState(false)
    const [query, setQuery] = React.useState('')
    const [focused, setFocused] = React.useState('')
    const [settings, setSettings] = React.useState(null)
    const [providers, setProviders] = React.useState([])
    const [pipelineUrl, setPipelineUrl] = React.useState('')
    const drafts = React.useRef({})
    const repoDetailsRef = React.useRef(null)
    const [notice, setNotice] = React.useState('')
    const [error, setError] = React.useState('')
    const [working, setWorking] = React.useState(false)
    const [build, setBuild] = React.useState({ url: '', package_id: '', package_sha256: '', notes: '' })
    const [verification, setVerification] = React.useState({ case_key: '', result: 'not_run', hits: '', notes: '' })
    const [modelState, setModelState] = React.useState({ status: 'idle' })
    const [modelRefresh, setModelRefresh] = React.useState(0)
    const [tierFilter, setTierFilter] = React.useState('all')
    const [logText, setLogText] = React.useState('')
    const keyOf = caseKeyOf
    const duplicateKeys = duplicateCaseKeySet(cases)
    const candidateOf = item => classifyInjectionCandidate(item, duplicateKeys)
    const selectableKeys = cases.filter(item => candidateOf(item).selectable).map(keyOf)
    const recommendedKeys = cases.filter(item => ['explicit', 'recommended'].includes(candidateOf(item).tier)).map(keyOf)
    const explicitKeys = cases.filter(item => candidateOf(item).tier === 'explicit').map(keyOf)
    React.useEffect(() => {
      if (!handoffRevision || !Array.isArray(initialCaseKeys) || !initialCaseKeys.length) return
      const valid = initialCaseKeys.filter(key => cases.some(item => keyOf(item) === key && candidateOf(item).selectable))
      const requested = initialCaseKeys.length
      setChosen(valid)
      setTierFilter('all')
      if (valid[0]) setFocused(valid[0])
      setStep(2)
      setHandoffNote(valid.length
        ? `已带入 ${valid.length} 条用例${valid.length < requested ? `（其余 ${requested - valid.length} 条缺少唯一身份）` : ''}；未预设桩点的用例将在生成阶段结合源码自动定位。`
        : '所选用例缺少唯一编号，请在下方列表中选择可用用例。')
    }, [handoffRevision, runId, cases.length])
    React.useEffect(() => {
      if (!open || !settings?.provider_id) return
      return loadAnalysisAgentModels({ providerId: settings.provider_id, cwd, onState: setModelState })
    }, [open, settings?.provider_id, cwd, modelRefresh])
    const modelCatalog = modelState.provider_id === settings?.provider_id && modelState.cwd === cwd && modelState.status === 'ready' ? modelState.catalog : null
    const effectiveSettings = settings && settings.agent_model_inherited && modelCatalog && Array.isArray(modelCatalog.models) && !modelCatalog.models.some(item => item.id === settings.agent_model)
      ? { ...settings, agent_model: '', agent_model_inherited: false }
      : settings
    const modelSelection = analysisExecutionState(effectiveSettings || {}, providers.map(item => ({ ...item, registered: true })), modelState, cwd)
    const selectedKeys = standalone ? chosen.filter(key => selectableKeys.includes(key)) : cases.map(keyOf).filter(Boolean)
    const selectedCases = cases.filter(item => selectedKeys.includes(keyOf(item)))
    const focusedCase = cases.find(item => keyOf(item) === focused) || selectedCases[0] || cases[0]
    const task = tasks.find(item => item.id === taskId)
    const profiles = Array.isArray(task?.result?.profiles) ? task.result.profiles : []
    const profile = profiles.find(item => item.case_key === profileKey) || profiles[0]
    const latestResults = new Map((task?.verification || []).map(item => [item.case_key, item.result]))
    const passedCount = [...latestResults.values()].filter(result => result === 'passed').length
    const activeTaskIds = tasks.filter(busy).map(item => item.id).join(',')
    const scope = JSON.stringify([runId, dataRoot, cwd])
    const request = async (payload = null) => {
      const input = { run_id: runId, ...(dataRoot ? { data_root: dataRoot } : {}), ...(cwd ? { cwd } : {}), ...payload }
      const url = '/api/pangea-companion/fault-injection'
      const response = await fetch(payload?.action ? url : `${url}?${new URLSearchParams(input)}`, payload?.action
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : {})
      const value = await response.json()
      if (!response.ok || value.status === 'error') throw new Error(value.error || '打桩操作失败')
      return value
    }
    const selectTask = value => {
      if (taskId) drafts.current[taskId] = { pipelineUrl, build, verification }
      setTaskId(value)
      setAcknowledged({})
      if (standalone && value) setStep(4)
      setProfileKey('')
      try { localStorage.setItem(`pangea-fi:${scope}`, value) } catch {}
    }
    const remember = value => {
      setTasks(previous => [value, ...previous.filter(item => item.id !== value.id)])
      selectTask(value.id)
    }
    React.useEffect(() => {
      if (!open) return
      let live = true
      request().then(value => {
        if (!live) return
        setTasks(value.tasks ?? [])
        if (!taskId && !(initialCaseKeys?.length > 0)) {
          try {
            const last = localStorage.getItem(`pangea-fi:${scope}`)
            if (value.tasks?.some(item => item.id === last)) { setTaskId(last); if (standalone) setStep(4) }
          } catch {}
        }
        setProviders(value.providers ?? [])
        const inheritedModel = value.defaults?.agent_model || ''
        setSettings(previous => previous ?? { ...value.defaults, agent_model: inheritedModel, agent_model_inherited: Boolean(inheritedModel), instructions: '' })
        setError('')
      }).catch(reason => { if (live) setError(reason.message) })
      return () => { live = false }
    }, [open, scope])
    React.useEffect(() => {
      if (!open || !activeTaskIds) return
      let live = true, pending = false
      const timer = setInterval(async () => {
        if (pending) return
        pending = true
        try {
          const values = await Promise.all(activeTaskIds.split(',').map(task_id => request({ task_id })))
          if (live) setTasks(previous => previous.map(item => values.find(value => value.task.id === item.id)?.task || item))
        } catch (reason) { if (live) setError(reason.message) }
        finally { pending = false }
      }, 2000)
      return () => { live = false; clearInterval(timer) }
    }, [open, scope, activeTaskIds])
    React.useEffect(() => {
      const draft = drafts.current[taskId]
      setPipelineUrl(draft?.pipelineUrl ?? task?.pipeline_url ?? '')
      setBuild(draft?.build ?? { url: '', package_id: '', package_sha256: '', notes: '', ...task?.build })
      setVerification(draft?.verification ?? { result: 'not_run', hits: '', notes: '', ...task?.verification?.filter(item => item.case_key === task?.case_keys?.[0]).at(-1), case_key: task?.case_keys?.[0] || '' })
    }, [taskId])
    const act = async (action, extra = {}) => {
      setWorking(true); setError(''); setNotice('')
      try {
        const value = await request({ action, task_id: taskId, ...extra })
        remember(value.task)
        if (action === 'generate') setStep(4)
        if (['configure', 'verify'].includes(action)) setNotice('已保存')
        if (action === 'configure') setSettings(previous => ({ ...previous, pipeline_url: value.pipeline_url }))
      } catch (reason) { setError(reason.message) }
      finally { setWorking(false) }
    }
    const field = (label, value, change, options = {}) => h('label', { className: 'pangea-fi-field' }, h('span', null, label),
      h(options.multiline ? 'textarea' : 'input', { 'aria-label': label, value: readable(value), onChange: event => change(event.target.value),
        disabled: working, ...(options.multiline ? { rows: 3 } : { type: 'text' }), placeholder: options.placeholder }))
    const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 14, alignItems: 'start' }
    const renderPoints = points => Array.isArray(points) && points.length ? points.map((point, index) => h('details', { key: point.id || index, open: standalone, className: 'pangea-fi-point' },
      h('summary', null, `${readable(point.id)} · ${readable(point.action) || '桩点说明'}`),
      point.repo_id || point.path ? h('p', { className: 'b05-subtle' }, [readable(point.repo_id), readable(point.path)].filter(Boolean).join(':')) : null,
      h('dl', { className: 'pangea-reading-fields' }, ...[['symbol', '代码位置'], ['action', '注入动作'], ['trigger', '触发条件'], ['times', '触发次数'], ['enable', '启用方式'], ['disable', '关闭方式'], ['observe', '命中检查'], ['cleanup', '恢复操作'], ['depends_on', '依赖桩点'], ['exclusive_with', '互斥桩点']].flatMap(([key, label]) => point[key] == null || (Array.isArray(point[key]) && !point[key].length) ? [] : [h('dt', { key: `${key}-label` }, label), h('dd', { key, style: { whiteSpace: 'pre-wrap' } }, Array.isArray(point[key]) ? point[key].map(readable).join('、') : readable(point[key]))])))) : h('p', { className: 'b05-subtle' }, '该用例按需打桩，具体注入点将在源码生成阶段定位。')
    const renderCaseSummaryFields = item => {
      const rows = [
        ['用例编号', item.display_id || item.test_case_id || '未标注'],
        ['验证目标', item.verification_goal || item.summary],
        ['用例类型', item.case_type || item.test_level],
        ['观察点', Array.isArray(item.observability) ? item.observability.join('；') : item.observability],
        ['清理动作', Array.isArray(item.cleanup) ? item.cleanup.join('；') : item.cleanup],
      ].filter(([, value]) => value != null && String(value).trim() !== '')
      return h('dl', { className: 'pangea-reading-fields', style: { marginTop: 8 } },
        ...rows.flatMap(([label, value]) => [h('dt', { key: `${label}-dt` }, label), h('dd', { key: `${label}-dd` }, readable(value))]))
    }
    const missingBranch = Boolean(settings?.repositories?.some(repo => repo.enabled !== false && !repo.personal_branch))
    const missingGit = Boolean(settings?.repositories?.some(repo => repo.enabled !== false && repo.source?.kind !== 'git'))
    const needsRepoSetup = missingBranch || missingGit
    const pipelineDirty = Boolean(task && pipelineUrl.trim() !== (task.pipeline_url || ''))
    const statusTone = status => status === 'pushed' || status === 'ready' ? 'good' : ['failed', 'cancelled', 'interrupted'].includes(status) ? 'danger' : 'info'
    return h('section', { className: standalone ? 'pangea-injection-panel is-standalone' : 'b05-card pangea-injection-panel', 'data-testid': 'fault-injection-panel' },
      h('style', null, `
        .pangea-injection-panel { min-width: 0; font-size: 14px; color: var(--pangea-ink, #1d232a); }
        .pangea-injection-panel.is-standalone { background: transparent; border: 0; padding: 0; box-shadow: none; }
        .pangea-injection-panel .pangea-fi-workspace { overflow: visible; overscroll-behavior: contain; scrollbar-gutter: stable; }
        .pangea-injection-panel .pangea-fi-workspace:focus-visible { outline: 2px solid var(--pangea-red, #b62836); outline-offset: 4px; border-radius: 8px; }
        .pangea-injection-panel .pangea-fi-workspace > * { min-width: 0; }
        .pangea-injection-panel details { border-top: 1px solid var(--pangea-line, #e2e6ec); margin-top: 8px; padding-top: 4px; }
        .pangea-injection-panel .pangea-fi-build { padding: 16px 18px; border: 1px solid var(--pangea-line, #e2e6ec); border-radius: 10px; background: #fff; }
        .pangea-injection-panel button + button { margin-left: 8px; }
        .pangea-injection-panel summary { cursor: pointer; padding: 8px 0; font-weight: 600; color: var(--pangea-ink, #1d232a); }
        .pangea-injection-panel p { margin: 8px 0; overflow-wrap: anywhere; line-height: 1.65; }
        .pangea-injection-panel h3 { font-size: 16px; font-weight: 650; margin: 10px 0; color: var(--pangea-ink, #1d232a); }
        .pangea-injection-panel h4 { font-size: 13px; font-weight: 600; margin: 14px 0 6px; color: var(--pangea-muted, #5e6773); }
        .pangea-injection-panel .pangea-fi-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 12px 14px; border: 1px solid var(--pangea-line, #e2e6ec); border-radius: 8px; background: #fff; }
        .pangea-injection-panel .pangea-fi-toolbar input[type=search] { flex: 1; min-width: 200px; max-width: 360px; }
        .pangea-injection-panel .pangea-fi-toolbar button + button { margin-left: 0; }
        .pangea-injection-panel input:not([type=checkbox]), .pangea-injection-panel select, .pangea-injection-panel textarea { font: inherit; font-size: 13px; min-height: 36px; min-width: 0; max-width: 100%; padding: 7px 11px; border: 1px solid #d5dbe3; border-radius: 6px; background: #fff; color: var(--pangea-ink, #1d232a); box-sizing: border-box; }
        .pangea-injection-panel textarea { min-height: 76px; resize: vertical; }
        .pangea-injection-panel input[type=checkbox] { width: 16px; height: 16px; accent-color: var(--pangea-red, #b62836); flex-shrink: 0; cursor: pointer; }
        .pangea-injection-panel .pangea-fi-field { display: grid; gap: 6px; align-content: start; margin-bottom: 12px; font-size: 13px; font-weight: 600; }
        .pangea-injection-panel label > select { display: block; width: 100%; margin-top: 6px; }
        .pangea-injection-panel .pangea-fi-field > select { margin-top: 0; }
        .pangea-injection-panel button { font: inherit; font-size: 13px; min-height: 36px; padding: 6px 13px; border: 1px solid #d5dbe3; border-radius: 6px; background: #fff; color: var(--pangea-ink, #1d232a); cursor: pointer; transition: background .15s ease, border-color .15s ease; }
        .pangea-injection-panel button:hover:not(:disabled) { background: var(--pangea-subtle, #f1f3f6); }
        .pangea-injection-panel button.primary { background: var(--pangea-red, #b62836) !important; border-color: var(--pangea-red, #b62836) !important; color: #fff !important; font-weight: 600; }
        .pangea-injection-panel button.primary:hover:not(:disabled) { background: var(--pangea-red-hover, #981f2b) !important; border-color: var(--pangea-red-hover, #981f2b) !important; }
        .pangea-injection-panel button:disabled { opacity: .5; cursor: default; }
        .pangea-injection-panel .pangea-fi-banner { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 12px 15px; margin: 12px 0; border-radius: 8px; font-size: 13px; line-height: 1.6; border: 1px solid transparent; }
        .pangea-injection-panel .pangea-fi-banner.danger { background: #fbefef; border-color: #f2c9cd; color: #9c2330; }
        .pangea-injection-panel .pangea-fi-banner.warn { background: #fbf4e6; border-color: #eedab3; color: #8c5a12; }
        .pangea-injection-panel .pangea-fi-banner.good { background: #eaf5ee; border-color: #c3e4cf; color: #20765a; }
        .pangea-injection-panel .pangea-fi-banner.info { background: #edf3f8; border-color: #cfe0ee; color: #365a7d; }
        .pangea-injection-panel .pangea-fi-scroll { max-height: 340px; overflow: auto; overflow-wrap: anywhere; }
        .pangea-injection-panel .pangea-fi-steps { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.65; padding-left: 22px; }
        .pangea-injection-panel .pangea-fi-steps li { padding: 5px 0; }
        .pangea-injection-panel .pangea-fi-records { list-style: none; padding: 0; margin: 12px 0 0; }
        .pangea-injection-panel .pangea-fi-records > li { padding: 12px 0; border-top: 1px solid var(--pangea-line, #e2e6ec); }
        .pangea-injection-panel .pangea-fi-records pre { white-space: pre-wrap; font: inherit; background: var(--pangea-subtle, #f1f3f6); padding: 8px 10px; border-radius: 6px; }
        .pangea-injection-panel .pangea-reading-fields dd { overflow-wrap: anywhere; }
        .pangea-fi-progress { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; padding: 0; margin: 0 0 18px; list-style: none; }
        .pangea-fi-progress li { display: flex; align-items: center; gap: 9px; padding: 8px 0 12px; border-bottom: 2px solid var(--pangea-line, #e2e6ec); color: var(--pangea-muted, #5e6773); font-size: 13px; }
        .pangea-fi-progress li b { width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--pangea-line, #d5dbe3); background: #fff; display: inline-flex; align-items: center; justify-content: center; font: 600 11px Consolas, monospace; flex-shrink: 0; }
        .pangea-fi-progress li[data-done="true"] b { background: #eaf5ee; border-color: transparent; color: #20765a; }
        .pangea-fi-progress li[aria-current="step"] { color: var(--pangea-ink, #1d232a); border-bottom-color: var(--pangea-red, #b62836); font-weight: 600; }
        .pangea-fi-progress li[aria-current="step"] b { background: var(--pangea-red, #b62836); border-color: var(--pangea-red, #b62836); color: #fff; }
        .pangea-fi-switcher { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 10px 14px; margin: 0 0 16px; border: 1px solid var(--pangea-line, #e2e6ec); border-radius: 8px; background: #fff; }
        .pangea-fi-switcher label { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 240px; font-size: 13px; font-weight: 600; }
        .pangea-fi-switcher label > select { margin-top: 0; flex: 1; max-width: 520px; font-weight: 400; }
        .pangea-fi-picker { display: grid; grid-template-columns: minmax(260px, 1fr) minmax(0, 1.85fr); gap: 20px; margin: 16px 0; align-items: start; }
        .pangea-fi-case-list { max-height: 62vh; overflow: auto; border: 1px solid var(--pangea-line, #e2e6ec); border-radius: 10px; padding: 8px; background: #fff; }
        .pangea-fi-case-row { display: flex; align-items: flex-start; gap: 8px; padding: 4px; border-bottom: 1px solid #f1f3f6; }
        .pangea-fi-case-row:last-child { border-bottom: 0; }
        .pangea-fi-case-row input[type=checkbox] { margin-top: 12px; }
        .pangea-fi-case-row button { flex: 1; text-align: left; border: 0; border-radius: 7px; padding: 10px 12px; min-height: 0; background: transparent; }
        .pangea-fi-case-row button[aria-pressed=true] { background: var(--pangea-red-soft, #fbf0f2); box-shadow: inset 3px 0 var(--pangea-red, #b62836); }
        .pangea-fi-case-id { display: inline-block; margin-right: 7px; font: 600 11px/1.4 Consolas, monospace; color: var(--pangea-muted, #5e6773); background: var(--pangea-subtle, #f1f3f6); padding: 1px 6px; border-radius: 4px; }
        .pangea-fi-case-row small { display: block; margin-top: 5px; color: var(--pangea-muted, #5e6773); font-size: 12px; }
        .pangea-fi-case-detail { min-width: 0; padding: 20px 22px; border: 1px solid var(--pangea-line, #e2e6ec); border-radius: 10px; background: #fff; }
        .pangea-fi-case-detail pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 13px/1.7 inherit; margin: 0; padding: 10px 12px; border-radius: 6px; background: var(--pangea-subtle, #f1f3f6); }
        .pangea-fi-footer { position: sticky; bottom: 0; z-index: 3; display: flex; justify-content: space-between; align-items: center; gap: 12px; background: rgba(255,255,255,.96); backdrop-filter: blur(4px); padding: 14px 18px; margin-top: 18px; border: 1px solid var(--pangea-line, #e2e6ec); border-radius: 10px; }
        .pangea-fi-create, .pangea-fi-task-card { padding: 20px 22px; border: 1px solid var(--pangea-line, #e2e6ec); border-radius: 10px; background: #fff; }
        .pangea-fi-technical { margin: 16px 0; padding: 12px 14px; border: 1px solid var(--pangea-line, #e2e6ec) !important; border-radius: 8px; background: var(--pangea-subtle, #f8f9fb); }
        .pangea-fi-repo-box { border: 1px solid var(--pangea-line, #e2e6ec); border-radius: 8px; padding: 10px 14px; margin: 10px 0; background: #fff; }
        .pangea-fi-status-pill { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; }
        .pangea-fi-status-pill.good { background: #eaf5ee; color: #20765a; }
        .pangea-fi-status-pill.danger { background: #fbefef; color: #9c2330; }
        .pangea-fi-status-pill.info { background: #edf3f8; color: #365a7d; }
        .pangea-fi-tier { display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 999px; font-size: 11px; font-weight: 600; vertical-align: middle; }
        .pangea-fi-tier.explicit { background: #fbf0f2; color: #b62836; }
        .pangea-fi-tier.recommended { background: #fbf4e6; color: #8c5a12; }
        .pangea-fi-tier.on_demand { background: #eef1f5; color: #5e6773; font-weight: 500; }
        .pangea-fi-tier.ineligible { background: #f3f4f6; color: #9ca3af; font-weight: 500; }
        .pangea-fi-filter-pills { display: inline-flex; gap: 4px; background: #f1f3f6; padding: 3px; border-radius: 7px; }
        .pangea-fi-filter-pills button { min-height: 28px; padding: 3px 10px; border: 0; border-radius: 5px; background: transparent; font-size: 12px; }
        .pangea-fi-filter-pills button[aria-pressed="true"] { background: #fff; color: var(--pangea-red, #b62836); font-weight: 600; box-shadow: 0 1px 2px rgba(16,24,40,.08); }
        @media(max-width: 820px) { .pangea-fi-picker { grid-template-columns: 1fr; } .pangea-fi-progress { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      `),
      !standalone ? h('div', { className: 'b05-head-actions', style: { justifyContent: 'space-between', marginBottom: open ? 14 : 0 } },
        h('div', null, h('strong', null, '打桩与个人分支'), h('p', { className: 'b05-subtle', style: { margin: '4px 0 0' } }, selectedKeys.length ? `已选择 ${selectedKeys.length} 条用例，可一起生成打桩修改。` : '选择用例生成打桩修改，或查看已有打桩任务。')),
        h('button', { type: 'button', className: 'btn', 'aria-expanded': open, onClick: () => setOpen(value => !value) }, open ? '收起打桩' : '打开打桩工作区'))
        : h('div', { className: 'b05-head-actions', style: { justifyContent: 'space-between', marginBottom: 14 } },
          h('p', { className: 'b05-subtle', style: { margin: 0 } }, selectedKeys.length ? `当前已选 ${selectedKeys.length} 条打桩用例（推荐 ${recommendedKeys.length} 条 · 可选 ${selectableKeys.length} 条）` : `当前运行共 ${cases.length} 条用例：推荐打桩 ${recommendedKeys.length} 条（预设桩点 ${explicitKeys.length} 条），其余 ${ Math.max(0, selectableKeys.length - recommendedKeys.length) } 条支持按需定位桩点。`),
          h('div', null,
            step === 4 ? h('button', { type: 'button', onClick: () => { setTaskId(''); setStep(2) } }, '新建打桩任务') : null,
            h('button', { type: 'button', onClick: onBack }, '更换分析任务'))),
      open ? h('div', { className: 'pangea-fi-workspace', role: 'region', 'aria-label': '打桩任务详情', tabIndex: 0 },
        tasks.length ? h('div', { className: 'pangea-fi-switcher' },
          h('label', null, '已有打桩任务', h('select', { 'aria-label': '已有打桩任务', value: taskId, onChange: event => selectTask(event.target.value) },
            h('option', { value: '' }, '选择任务查看'),
            tasks.map(item => h('option', { key: item.id, value: item.id }, `${item.name || item.cases?.[0]?.title || '打桩任务'} · ${new Date(item.created_at).toLocaleString()} · ${item.case_keys.length} 条 · ${INJECTION_STATUS_LABELS[item.status] || item.status}`)))),
          standalone && taskId && step === 4 ? h('span', { className: `pangea-fi-status-pill ${statusTone(task?.status)}` }, INJECTION_STATUS_LABELS[task?.status] || task?.status) : null) : null,
        standalone ? h('ol', { className: 'pangea-fi-progress', 'aria-label': '新建打桩步骤' },
          ['选择分析任务', '选择用例', '设置与提交', '结果与推送'].map((label, index) => h('li', {
            key: label,
            'data-done': step > index + 1 ? 'true' : undefined,
            'aria-current': step === index + 1 ? 'step' : undefined,
          }, h('b', null, step > index + 1 ? '✓' : `0${index + 1}`), label))) : null,
        error ? h('div', { role: 'alert', className: 'pangea-fi-banner danger' }, h('span', null, error)) : null,
        notice ? h('div', { role: 'status', className: 'pangea-fi-banner good' }, h('span', null, notice)) : null,
        handoffNote && standalone && step === 2 ? h('div', { role: 'status', className: 'pangea-fi-banner info' },
          h('span', null, handoffNote),
          selectedKeys.length && settings ? h('button', { type: 'button', className: 'primary', onClick: () => setStep(3) }, '直接进入设置与提交') : null) : null,
        standalone && step === 2 ? h('section', null,
          h('div', { className: 'pangea-fi-toolbar' },
            h('input', { type: 'search', 'aria-label': '搜索打桩用例', placeholder: '搜索用例编号或名称…', value: query, onChange: event => setQuery(event.target.value) }),
            h('div', { className: 'pangea-fi-filter-pills', role: 'group', 'aria-label': '按打桩建议筛选' },
              [['all', `全部 ${cases.length}`], ['recommended', `推荐打桩 ${recommendedKeys.length}`], ['explicit', `预设桩点 ${explicitKeys.length}`]].map(([id, label]) => h('button', {
                key: id, type: 'button', 'aria-pressed': tierFilter === id, onClick: () => setTierFilter(id),
              }, label))),
            recommendedKeys.length ? h('button', { type: 'button', disabled: recommendedKeys.every(k => selectedKeys.includes(k)), onClick: () => setChosen(prev => [...new Set([...prev, ...recommendedKeys])]) }, `全选推荐（${recommendedKeys.length}）`) : null,
            selectableKeys.length && selectableKeys.length !== recommendedKeys.length ? h('button', { type: 'button', disabled: selectedKeys.length === selectableKeys.length, onClick: () => setChosen(selectableKeys) }, `全选可选（${selectableKeys.length}）`) : null,
            selectedKeys.length ? h('button', { type: 'button', onClick: () => setChosen([]) }, '清空选择') : null,
            h('span', { role: 'status', style: { marginLeft: 'auto', fontSize: 13, color: '#5e6773', fontWeight: 600 } }, `已选择 ${selectedKeys.length} 条`)),
          h('div', { className: 'pangea-fi-picker' },
            h('div', { className: 'pangea-fi-case-list' }, cases.filter(item => {
              const cand = candidateOf(item)
              if (tierFilter === 'recommended' && !['explicit', 'recommended'].includes(cand.tier)) return false
              if (tierFilter === 'explicit' && cand.tier !== 'explicit') return false
              return `${item.display_id || ''} ${readable(item.title)}`.toLowerCase().includes(query.toLowerCase())
            }).map((item, index) => {
              const cand = candidateOf(item)
              return h('div', { key: `${keyOf(item)}:${index}`, className: 'pangea-fi-case-row' },
                h('input', { type: 'checkbox', 'aria-label': `选择打桩用例 ${readable(item.title)}`, checked: selectedKeys.includes(keyOf(item)), disabled: !cand.selectable, onChange: event => setChosen(previous => event.target.checked ? [...new Set([...previous, keyOf(item)])] : previous.filter(key => key !== keyOf(item))) }),
                h('button', { type: 'button', 'aria-pressed': focusedCase === item, onClick: () => setFocused(keyOf(item)) },
                  item.display_id || item.test_case_id ? h('span', { className: 'pangea-fi-case-id' }, item.display_id || item.test_case_id) : null,
                  readable(item.title),
                  h('span', { className: `pangea-fi-tier ${cand.tier}` }, cand.label),
                  h('small', null, cand.reason)))
            })),
            h('article', { className: 'pangea-fi-case-detail', 'aria-label': '打桩用例详情' }, focusedCase ? h(React.Fragment, null,
              h('h3', { style: { marginTop: 0 } },
                focusedCase.display_id ? h('span', { className: 'pangea-fi-case-id' }, focusedCase.display_id) : null,
                readable(focusedCase.title)),
              ...[['preconditions', '前置条件', focusedCase.preconditions],
                ['steps', '操作步骤', Array.isArray(focusedCase.steps) && focusedCase.steps.length ? focusedCase.steps : Array.isArray(focusedCase.step_pairs) ? focusedCase.step_pairs.map((s, i) => s?.action ? `${i + 1}. ${s.action}` : '').filter(Boolean) : focusedCase.steps],
                ['expected_results', '预期结果', Array.isArray(focusedCase.expected_results) && focusedCase.expected_results.length ? focusedCase.expected_results : Array.isArray(focusedCase.step_pairs) ? focusedCase.step_pairs.map((s, i) => s?.expected ? `${i + 1}. ${s.expected}` : '').filter(Boolean) : focusedCase.expected_results]].map(([key, label, val]) => h('section', { key }, h('h4', null, label), h('pre', null, readable(val) || '未提供'))),
              h('h4', null, '打桩信息'), renderPoints((focusedCase.instrumentation || focusedCase.source_record?.body?.instrumentation)?.points),
              h('details', null, h('summary', null, '完整用例信息'), renderCaseSummaryFields(focusedCase))) : h('p', null, '当前分析任务暂无用例'))),
          h('footer', { className: 'pangea-fi-footer' },
            h('button', { type: 'button', onClick: onBack }, '上一步'),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
              !selectedKeys.length ? h('span', { style: { fontSize: 12, color: '#5e6773' } }, '请先勾选至少 1 条用例') : null,
              h('button', { type: 'button', className: 'primary', disabled: !selectedKeys.length || !settings, onClick: () => setStep(3) }, '下一步：设置与提交')))) : null,
        (!standalone || step === 3) && settings ? h('section', { className: 'pangea-fi-create' },
          h('h3', { style: { marginTop: 0 } }, '设置与提交'),
          h('details', null, h('summary', null, `已选择 ${selectedKeys.length} 条用例`), h('p', { className: 'pangea-fi-scroll' }, selectedCases.map(item => `${item.display_id ? `${item.display_id} ` : ''}${readable(item.title)}`).join('、') || '请先选择用例')),
          needsRepoSetup ? h('div', { role: 'status', className: 'pangea-fi-banner warn' },
            h('span', null, missingGit
              ? '所选源码尚未关联 Git 仓库：请在下方“代码仓库与构建”中关联本地或远端 Git 仓库并选择个人开发分支。普通分析不受影响。'
              : '请先在下方“代码仓库与构建”中选择已有的个人开发分支后再生成打桩修改。'),
            h('button', { type: 'button', onClick: () => { setRepoSetupOpen(true); repoDetailsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }) } }, '定位仓库配置')) : null,
          h('div', { style: { marginTop: 14 } },
            h('div', { style: grid },
              h('label', { className: 'pangea-fi-field' }, h('span', null, '执行器'), h('select', { 'aria-label': '打桩执行器', value: settings.provider_id, disabled: working, onChange: event => setSettings({ ...settings, provider_id: event.target.value, agent_model: '', agent_model_inherited: false }) },
                h('option', { value: '' }, '选择执行器'), providers.map(provider => h('option', { key: provider.id, value: provider.id }, provider.label)))),
              h('div', { className: 'pangea-fi-field' },
                h('label', { style: { display: 'grid', gap: 6 } }, h('span', null, '打桩模型'), h('select', { 'aria-label': '打桩模型', value: effectiveSettings?.agent_model || '', disabled: working || !modelCatalog,
                  onChange: event => setSettings({ ...settings, agent_model: event.target.value, agent_model_inherited: false }) },
                  h('option', { value: '' }, modelCatalog?.current_model ? `使用 Agent 默认（${modelCatalog.current_model}）` : '请选择可用模型'),
                  (modelCatalog?.models || []).map(model => h('option', { key: model.id, value: model.id }, model.label && model.label !== model.id ? `${model.label} · ${model.id}` : model.id)))),
                h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' } },
                  h('span', { role: modelState.status === 'error' ? 'alert' : 'status', style: { fontSize: 12, fontWeight: 400, color: modelState.status === 'error' ? '#b62836' : '#5e6773' } }, modelSelection.message),
                  h('button', { type: 'button', style: { minHeight: 30, padding: '3px 10px', fontSize: 12 }, disabled: working || !settings.provider_id || modelState.status === 'loading', onClick: () => setModelRefresh(value => value + 1) }, '刷新模型'))),
              field('任务名称', settings.name, value => setSettings({ ...settings, name: value }), { placeholder: '可选，便于区分多次打桩任务' })),
            h('p', { style: { fontSize: 13 } }, h('strong', null, '目标个人分支：'), (settings.repositories || []).filter(repo => repo.enabled !== false).map(repo => `${repo.repo_id} → ${repo.personal_branch || '尚未配置'}`).join('；')),
            h('details', { ref: repoDetailsRef, className: 'pangea-fi-technical', open: needsRepoSetup || repoSetupOpen || undefined },
              h('summary', null, '代码来源与高级设置'),
              h(RepositorySettings, { cwd, dataRoot, defaultOpen: needsRepoSetup || repoSetupOpen, repositories: settings.repositories || [], onSaved: async () => { const value = await request(); setSettings(previous => ({ ...previous, repositories: value.defaults.repositories, pipeline_url: value.defaults.pipeline_url })) } }),
              (settings.repositories ?? []).map((repo, index) => h('fieldset', { key: repo.repo_id, className: 'pangea-fi-repo-box' },
                h('legend', null, h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 } }, h('input', { type: 'checkbox', checked: repo.enabled !== false, disabled: working, 'aria-label': `本次包含 ${repo.repo_id}`, onChange: event => setSettings({ ...settings, repositories: settings.repositories.map((item, at) => at === index ? { ...item, enabled: event.target.checked } : item) }) }), readable(repo.repo_id))),
                h('p', { style: { fontSize: 12, color: '#5e6773' } }, '当前源码：', sourceLabel(repo.source)),
                repo.comparison?.changed_count ? h('p', { style: { fontSize: 12 } }, `分析快照中有 ${repo.comparison.changed_count} 个文件与目标提交不同。这是源码版本比较，不是本次打桩修改文件数；生成时将基于目标代码重新定位桩点。`) : null,
                repo.comparison?.eol_only_count ? h('p', { style: { fontSize: 12, color: '#5e6773' } }, `${repo.comparison.eol_only_count} 个文件仅 CRLF/LF 换行符不同，单独记录，不计入内容变化。`) : null,
                repo.comparison?.error ? h('p', { role: 'alert', style: { color: '#b62836', fontSize: 12 } }, repo.comparison.error) : null,
                h('p', { style: { fontSize: 12, color: '#5e6773' } }, `Git 仓库：${repo.source_path}；远端：${repo.remote}；个人分支：${repo.personal_branch || '未配置'}`)))),
            h('p', { className: 'b05-subtle', style: { fontSize: 12 } }, '先在独立副本中生成差异，查看后再提交并推送到项目个人分支；不会创建任务分支，不带入未提交内容。'),
            field('构建流水线 URL', settings.pipeline_url, value => setSettings({ ...settings, pipeline_url: value }), { placeholder: '例如 https://ci.example.internal/pipeline/...' }),
            field('补充说明', settings.instructions, value => setSettings({ ...settings, instructions: value }), { multiline: true, placeholder: '可选：补充触发边界、日志开关或构建宏约束…' }),
            h('footer', { className: 'pangea-fi-footer' },
              standalone ? h('button', { type: 'button', disabled: working, onClick: () => setStep(2) }, '上一步') : h('span', null),
              h('button', { type: 'button', className: 'btn primary', disabled: working || !modelSelection.ready || !selectedKeys.length || !settings.repositories.some(repo => repo.enabled !== false) || settings.repositories.some(repo => repo.enabled !== false && (repo.source?.kind !== 'git' || !repo.personal_branch)),
                onClick: () => act('generate', { ...effectiveSettings, agent_model: modelSelection.model, agent_catalog_id: modelSelection.catalogId, repositories: settings.repositories.filter(repo => repo.enabled !== false), case_keys: selectedKeys }) }, working ? '正在提交…' : standalone ? '生成打桩修改' : `生成打桩修改（${selectedKeys.length} 条用例）`))))
          : !settings ? h('p', null, '正在读取打桩设置…') : null,
        task && (!standalone || step === 4) ? h('div', { className: 'pangea-fi-task-card', style: { marginTop: 16 } },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' } },
            h('div', null,
              h('h3', { style: { margin: 0 } }, `正在查看：${task.name || task.cases?.[0]?.title || '打桩任务'}`),
              h('p', { className: 'b05-subtle', style: { margin: '6px 0 0', fontSize: 13 } }, `${task.case_keys.length} 条用例 · ${task.result?.points?.length || 0} 个桩点 · 最新记录 ${passedCount}/${task.case_keys.length} 通过 · 个人分支 `, h('code', null, task.branch))),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h('span', { role: 'status', className: `pangea-fi-status-pill ${statusTone(task.status)}` }, task.status === 'failed' && task.failure_phase === 'preparing' ? '准备源码失败' : INJECTION_STATUS_LABELS[task.status] || task.status),
              busy(task) ? h('button', { type: 'button', className: 'btn', disabled: working, onClick: () => act('cancel') }, '停止本次操作') : null)),
          task.error ? h('div', { role: 'alert', className: 'pangea-fi-banner danger', style: { display: 'block' } },
            h('p', { style: { margin: 0, fontWeight: 600 } }, task.failure_phase === 'preparing' ? '准备源码失败，尚未开始生成打桩修改。' : '本次操作未完成。'),
            h('details', null, h('summary', null, '查看错误详情'), h('pre', { style: { whiteSpace: 'pre-wrap', margin: '6px 0 0' } }, task.error))) : null,
          Array.isArray(task.notices) && task.notices.length ? h('div', { role: 'status', className: 'pangea-fi-banner warn', style: { display: 'block' } }, task.notices.map((text, index) => h('p', { key: index, style: { margin: index ? '6px 0 0' : 0 } }, text))) : null,
          task.reused_from ? h('p', { className: 'b05-subtle', style: { fontSize: 12 } }, '本任务直接复用了已留存的生成结果，未调用模型。') : null,
          task.telemetry ? h('p', { className: 'b05-subtle', style: { fontSize: 12, margin: '6px 0 0' } }, `执行账本：模型轮次 ${task.telemetry.turns ?? 0} · 工具调用 ${task.telemetry.tool_calls ?? 0} 次 · 上下文压缩 ${task.telemetry.compactions ?? 0} 次${task.telemetry.budget_wrapup_triggered ? ' · 已触发探索预算收口' : ''}`) : null,
          task.status === 'pushing' && task.current_repository ? h('p', { className: 'pangea-fi-banner info' }, `正在推送：${task.current_repository}`) : null,
          ['failed', 'cancelled', 'interrupted'].includes(task.status) && !task.generation_complete ? h('div', { style: { marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 } },
            task.result_saved ? h('button', { type: 'button', className: 'primary', disabled: working, onClick: () => act('revalidate') }, '原地重新验收（不调用模型）') : null,
            task.result_saved ? h('button', { type: 'button', style: { marginLeft: 0 }, disabled: working, onClick: () => act('reuse-result') }, '直接复用已留存的生成结果（不调用模型）') : null,
            task.result_saved ? h('button', { type: 'button', style: { marginLeft: 0 }, disabled: working, onClick: () => act('retry-with-reference') }, '参考上次结果重新生成') : null,
            h('button', { type: 'button', className: task.result_saved ? '' : 'primary', style: { marginLeft: 0 }, disabled: working, onClick: () => act('retry') }, '沿用本任务配置重新生成')) : null,
          task.schema_version !== 2 ? h('div', { role: 'status', className: 'pangea-fi-banner warn' }, '此历史任务使用旧任务分支。请先配置项目个人分支，再按最新分支重新生成；旧分支不会被推送。') : null,
          task.repositories.filter(repo => repo.outgoing_count > 0 && !repo.commit).map(repo => h('label', { key: repo.repo_id, className: 'pangea-fi-banner warn', style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 10, cursor: 'pointer' } },
            h('input', { type: 'checkbox', 'aria-label': `确认推送已有提交 ${repo.repo_id}`, checked: acknowledged[repo.repo_id] === repo.base_commit,
              onChange: event => setAcknowledged(previous => ({ ...previous, [repo.repo_id]: event.target.checked ? repo.base_commit : '' })) }),
            `${repo.repo_id} 的 ${repo.branch} 上有 ${repo.outgoing_count} 个已有未推送提交；勾选确认后本次会一并推送。`)),
          ['ready', 'interrupted'].includes(task.status) && task.generation_complete ? h('div', { style: { marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 } },
            h('button', { type: 'button', className: 'btn primary', disabled: working || task.schema_version !== 2 || task.repositories.some(repo => repo.outgoing_count > 0 && !repo.commit && acknowledged[repo.repo_id] !== repo.base_commit),
              onClick: () => act('push', { acknowledged_heads: acknowledged }) }, working ? '正在提交…' : task.repositories.some(repo => repo.commit && !repo.pushed) ? `重试提交与推送到 ${task.branch}` : `提交并推送到 ${task.branch}`),
            h('button', { type: 'button', style: { marginLeft: 0 }, disabled: working, onClick: () => act('retry') }, '按最新分支重新生成')) : null,
          task.status === 'pushed' ? h('section', { className: 'pangea-fi-build', style: { marginTop: 14 } },
            h('h3', { style: { marginTop: 0 } }, '构建个人包'),
            h('details', { open: !task.pipeline_url || pipelineDirty || undefined },
              h('summary', null, '流水线设置'),
              field('本任务流水线 URL', pipelineUrl, setPipelineUrl),
              h('button', { type: 'button', className: pipelineDirty ? 'primary' : '', disabled: working, onClick: () => act('configure', { pipeline_url: pipelineUrl }) }, '保存流水线地址')),
            pipelineDirty ? h('p', { role: 'status', style: { fontSize: 12, color: '#8c5a12', margin: '10px 0 6px' } }, '流水线地址已更改，请先点击“保存流水线地址”后再打开流水线。') : null,
            h('div', { style: { marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 } },
              h('button', { type: 'button', className: 'btn primary', disabled: working || !task.pipeline_url || pipelineDirty,
                onClick: async () => { try { if (!onOpenPipeline) throw new Error('当前会话的 DSH 浏览器不可用'); await onOpenPipeline(task.pipeline_url) } catch (reason) { setError(reason.message) } } }, '在 DSH 浏览器打开构建流水线'),
              h('button', { type: 'button', style: { marginLeft: 0 }, onClick: async () => { try { await navigator.clipboard.writeText(task.branch); setNotice(`已复制个人分支：${task.branch}`) } catch { setError('复制失败，请复制上方个人分支名称') } } }, '复制个人分支')),
            h('p', { className: 'b05-subtle', style: { fontSize: 12 } }, '使用上方个人分支出包，在验证记录中关联构建结果。'),
            task.result_saved ? h('div', { style: { marginTop: 10 } },
              h('button', { type: 'button', disabled: working, onClick: () => act('reuse-result') }, '再次出桩（复用本次结果，不调用模型）'),
              h('p', { className: 'b05-subtle', style: { fontSize: 12 } }, '个人分支回退后需要重新打上同样的桩时使用：在当前分支最新代码上直接应用本次留存的修改；代码位置变化时会提示改用“参考上次结果重新生成”。')) : null) : null,
          task.repositories.some(repo => repo.commit) ? h('details', { key: `verification:${task.id}`, style: { marginTop: 12 } },
            h('summary', null, '构建包与验证记录'),
            h('p', { className: 'b05-subtle', style: { fontSize: 12 } }, '在已有流水线选择上面的个人分支或修改提交出包；烧包测试后，在这里记录结果。'),
            h('div', { style: grid }, field('构建链接', build.url, value => setBuild({ ...build, url: value })), field('个人包名称或版本', build.package_id, value => setBuild({ ...build, package_id: value })), field('包 SHA256（可选）', build.package_sha256, value => setBuild({ ...build, package_sha256: value }))),
            h('details', { style: { margin: '4px 0 12px' } },
              h('summary', null, '从执行日志自动填充'),
              h('div', { style: { display: 'grid', gap: 8, paddingTop: 6 } },
                h('input', { type: 'file', 'aria-label': '选择执行日志文件', accept: '.log,.txt,text/plain', disabled: working, onChange: async event => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  try { setLogText(await file.text()) } catch (reason) { setError(reason?.message || '读取日志文件失败') }
                } }),
                h('textarea', { 'aria-label': '执行日志内容', rows: 3, disabled: working, value: logText, placeholder: '粘贴串口或脚本输出日志（自动识别 [PANGEA_VERIFY] 或桩点命中特征）…', onChange: event => setLogText(event.target.value) }),
                h('div', null, h('button', { type: 'button', disabled: working || !logText.trim(), onClick: () => {
                  const parsed = parseVerificationLog(logText, task)
                  if (!parsed.entries.length) {
                    setError('日志中未识别到匹配的桩点命中或 [PANGEA_VERIFY] 记录，请核对日志或手动填写')
                    return
                  }
                  setError('')
                  if (verification.case_key) drafts.current[`${taskId}:${verification.case_key}`] = verification
                  for (const entry of parsed.entries) drafts.current[`${taskId}:${entry.case_key}`] = entry
                  const target = parsed.entries.find(item => item.case_key === verification.case_key) || parsed.entries[0]
                  setVerification(target)
                  setNotice(`已从日志自动填充 ${parsed.matchedCount} 条用例结果，请核对后点击“保存构建与验证记录”`)
                } }, '解析日志填充')))),
            h('div', { style: grid },
              h('label', { className: 'pangea-fi-field' }, h('span', null, '验证用例'), h('select', { 'aria-label': '验证用例', value: verification.case_key, onChange: event => {
                drafts.current[`${taskId}:${verification.case_key}`] = verification
                const key = event.target.value
                setVerification(drafts.current[`${taskId}:${key}`] ?? { result: 'not_run', hits: '', notes: '', ...task.verification.filter(item => item.case_key === key).at(-1), case_key: key })
              } }, task.cases.map(item => h('option', { key: item.case_key, value: item.case_key }, readable(item.title))))),
              h('label', { className: 'pangea-fi-field' }, h('span', null, '实际结果'), h('select', { 'aria-label': '实际结果', value: verification.result, onChange: event => setVerification({ ...verification, result: event.target.value }) }, [['not_run', '未执行'], ['passed', '通过'], ['failed', '失败'], ['not_triggered', '目标故障未触发']].map(([value, label]) => h('option', { key: value, value }, label)))),
              field('桩点实际命中', verification.hits, value => setVerification({ ...verification, hits: value }))),
            field('验证现象与记录', verification.notes, value => setVerification({ ...verification, notes: value }), { multiline: true }),
            h('button', { type: 'button', className: 'btn primary', disabled: working || busy(task), onClick: () => act('verify', { build, verification }) }, '保存构建与验证记录'),
            task.verification.length ? h('ul', { className: 'pangea-fi-records pangea-fi-scroll', 'aria-label': '验证历史' }, [...task.verification].reverse().map((value, index) => h('li', { key: index }, `${value.at} · ${readable(task.cases.find(item => item.case_key === value.case_key)?.title || value.case_key)} · ${({ passed: '通过', failed: '失败', not_triggered: '目标故障未触发', not_run: '未执行' })[value.result]} · ${value.hits}`,
              value.notes ? h('details', null, h('summary', null, '查看验证记录'), h('pre', null, value.notes)) : null,
              h('p', { className: 'b05-subtle', style: { fontSize: 12 } }, `验证包：${value.build?.package_id || '未填写'}；提交：${(value.build?.commits || []).map(repo => `${repo.repo_id} ${repo.commit.slice(0, 12)}`).join('、')}`),
              value.build?.url ? h('a', { href: value.build.url, target: '_blank', rel: 'noreferrer' }, '查看本次构建') : null))) : null) : null,
          task.result?.summary ? h('details', null, h('summary', null, '修改摘要与用例'), h('div', { className: 'pangea-fi-scroll' }, h('p', { style: { whiteSpace: 'pre-wrap' } }, readable(task.result.summary)), h('p', { style: { fontSize: 12, color: '#5e6773' } }, task.cases.map(item => readable(item.title)).join('、')))) : null,
          task.result?.points?.length ? h('details', null, h('summary', null, `桩点说明（${task.result.points.length}）`), h('div', { className: 'pangea-fi-scroll' }, renderPoints(task.result.points))) : null,
          profiles.length ? h('details', { key: `profiles:${task.id}` }, h('summary', null, `逐用例执行说明（${profiles.length}）`),
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, margin: '6px 0 12px' } },
              h('button', { type: 'button', onClick: () => {
                try {
                  const content = buildVerificationShellScript(task)
                  const blob = new Blob([content], { type: 'text/x-shellscript;charset=utf-8' })
                  const href = URL.createObjectURL(blob)
                  const link = document.createElement('a')
                  link.href = href
                  link.download = `pangea-verify-${String(task.id || 'task').slice(0, 8)}.sh`
                  link.click()
                  setTimeout(() => URL.revokeObjectURL(href), 0)
                  setNotice('已生成可执行验证脚本')
                } catch (reason) { setError(reason?.message || '生成验证脚本失败') }
              } }, '下载验证脚本'),
              h('button', { type: 'button', style: { marginLeft: 0 }, onClick: async () => {
                try { await navigator.clipboard.writeText(buildVerificationShellScript(task)); setNotice('已复制验证脚本') }
                catch { setError('复制失败，请使用“下载验证脚本”') }
              } }, '复制验证脚本')),
            h('label', { className: 'pangea-fi-field' }, h('span', null, '选择执行说明'), h('select', { 'aria-label': '选择执行说明', value: profile?.case_key || '', onChange: event => setProfileKey(event.target.value) },
              profiles.map(item => h('option', { key: item.case_key, value: item.case_key }, readable(task.cases.find(value => value.case_key === item.case_key)?.title || item.case_key))))),
            h('ol', { className: 'pangea-fi-steps pangea-fi-scroll' }, (Array.isArray(profile?.steps) ? profile.steps : [profile?.steps]).map((itemStep, at) => h('li', { key: at }, readable(itemStep))))) : null,
          task.result?.limitations?.length ? h('details', null, h('summary', null, `生成限制（${task.result.limitations.length}）`),
            Array.isArray(task.result.limitations)
              ? h('ul', { className: 'pangea-fi-steps pangea-fi-scroll' }, task.result.limitations.map((item, at) => h('li', { key: at }, readable(item))))
              : h('p', { className: 'pangea-fi-scroll', style: { whiteSpace: 'pre-wrap' } }, readable(task.result.limitations))) : null,
          task.repositories.map(repo => h('details', { key: repo.repo_id, open: Boolean(repo.diff && !repo.pushed), style: { marginTop: 12 } },
            h('summary', null, `${repo.repo_id} · ${repo.branch} · ${repo.commit ? repo.pushed ? '已推送' : '已提交' : repo.diff ? '待提交差异' : '未修改'}`),
            h('p', { style: { fontSize: 12, color: '#5e6773' } }, '基线：', h('code', null, repo.base_commit), repo.commit ? h(React.Fragment, null, ' · 修改提交：', h('code', null, repo.commit)) : null),
            repo.diff ? h('pre', { style: { maxHeight: 400, overflow: 'auto', padding: 12, borderRadius: 8, border: '1px solid #e2e6ec', background: '#f8f9fb', font: '12px/1.6 Consolas, monospace' } }, repo.diff) : null))
          ) : null) : null)
  }
}
