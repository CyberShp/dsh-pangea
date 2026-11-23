import { analysisExecutionState, loadAnalysisAgentModels } from './agent-model-selection.js'
import {
  ARTIFACT_KIND_LABELS, BUILD_VARIANT_LABELS, DEFAULT_INTRANET_COMMIT_REGEX, DELIVERY_MODE_LABELS,
  MULTILINE_GATE_COMMIT_TEMPLATE, SINGLELINE_GATE_COMMIT_TEMPLATE,
  buildArtifactVerifyCommands, buildVerificationShellScript, caseKeyOf, classifyInjectionCandidate,
  defaultCommitSummary, duplicateCaseKeySet, extractRemoteHookRegex, mergeReplaceFilesFromTasks,
  normalizeBuildVariant, normalizeCommitConfig, normalizeDeliveryMode,
  parseVerificationLog, resolveCommitMessage,
} from './fault-injection-candidates.js'
import { createRepositorySettings, sourceLabel } from './repository-settings-view.js'

export const INJECTION_STATUS_LABELS = {
  preparing: '准备源码', generating: '生成打桩修改', ready: '补丁就绪',
  composing: '合成补丁中', pushing: '推送个人分支中',
  pushed: '个人分支已推送', failed: '生成失败', cancelled: '已停止', interrupted: '操作已中断', unreadable: '记录不可读',
}

export const BUILD_STATUS_LABELS = {
  composing: '合成补丁中', pushing: '推送个人分支中', pushed: '个人分支已推送',
  failed: '出包失败', cancelled: '已停止', interrupted: '操作已中断', unreadable: '记录不可读',
}

const readable = value => value == null ? '' : typeof value === 'string' ? value : Array.isArray(value) ? value.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join('\n') : JSON.stringify(value, null, 2)

const PANEL_CSS = `
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
        .pangea-fi-progress { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; padding: 0; margin: 0 0 18px; list-style: none; }
        .pangea-fi-progress li { display: flex; align-items: center; gap: 9px; padding: 8px 0 12px; border-bottom: 2px solid var(--pangea-line, #e2e6ec); color: var(--pangea-muted, #5e6773); font-size: 13px; }
        .pangea-fi-progress li b { width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--pangea-line, #d5dbe3); background: #fff; display: inline-flex; align-items: center; justify-content: center; font: 600 11px Consolas, monospace; flex-shrink: 0; }
        .pangea-fi-progress li[data-done="true"] b { background: #eaf5ee; border-color: transparent; color: #20765a; }
        .pangea-fi-progress li[aria-current="step"] { color: var(--pangea-ink, #1d232a); border-bottom-color: var(--pangea-red, #b62836); font-weight: 600; }
        .pangea-fi-progress li[aria-current="step"] b { background: var(--pangea-red, #b62836); border-color: var(--pangea-red, #b62836); color: #fff; }
        .pangea-fi-filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 0 0 14px; }
        .pangea-fi-filters label { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; }
        .pangea-fi-filters label > select { margin-top: 0; width: auto; font-weight: 400; }
        .pangea-fi-table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--pangea-line, #e2e6ec); border-radius: 10px; overflow: hidden; }
        .pangea-fi-table th, .pangea-fi-table td { padding: 10px 12px; border-bottom: 1px solid var(--pangea-line, #e2e6ec); text-align: left; vertical-align: top; font-size: 13px; }
        .pangea-fi-table th { color: var(--pangea-muted, #5e6773); font-weight: 600; background: var(--pangea-subtle, #f8f9fb); }
        .pangea-fi-table td button.link-btn { min-height: 0; padding: 0; border: 0; background: transparent; color: var(--pangea-red, #b62836); font-weight: 600; text-align: left; }
        .pangea-fi-table small { display: block; margin-top: 4px; color: var(--pangea-muted, #5e6773); }
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
`

const statusTone = status => status === 'pushed' || status === 'ready' ? 'good' : ['failed', 'cancelled', 'interrupted', 'unreadable'].includes(status) ? 'danger' : 'info'

const busy = item => ['preparing', 'generating', 'composing', 'pushing'].includes(item?.status)

const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 14, alignItems: 'start' }

const itemKey = (runId, taskId) => `${runId}\0${taskId}`

async function injectionRequest(input) {
  const url = '/api/pangea-companion/fault-injection'
  const response = await fetch(input.action ? url : `${url}?${new URLSearchParams(input)}`, input.action
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : {})
  const value = await response.json()
  if (!response.ok || value.status === 'error') throw new Error(value.error || '打桩操作失败')
  return value
}

const buildCommitDraft = (sourceConfig, fallbackMessage = '') => {
  const normalized = normalizeCommitConfig(sourceConfig)
  const explicitSummary = typeof sourceConfig?.summary === 'string' && sourceConfig.summary.trim()
    ? sourceConfig.summary
    : null
  const customMessage = normalized.custom_message || (normalized.mode !== 'template' && fallbackMessage && !/^test: fault injection\b/.test(fallbackMessage) ? fallbackMessage : '')
  return { ...normalized, summary: explicitSummary, custom_message: customMessage }
}

function formatInjectionCommitNotice(repo) {
  if (!Array.isArray(repo?.injection_commits_in_head) || !repo.injection_commits_in_head.length) return ''
  const listed = repo.injection_commits_in_head
    .slice(0, 5)
    .map(item => `${String(item.commit || '').slice(0, 12)}（${item.source_type === 'build' ? `出包 ${String(item.source_id || '').slice(0, 8)}` : `旧任务 ${String(item.source_id || '').slice(0, 8)}`}）`)
    .join('、')
  return `${repo.repo_id}：当前分析目录 HEAD 含有历史打桩提交 ${listed}。宿主不会自动回退分析目录，请确认当前基线是否为预期开发代码。`
}

function repoBlockingReason(repo, { requirePersonalBranch = false } = {}) {
  if (!repo) return ''
  if (repo.source?.kind !== 'git') return `${repo.repo_id}：源码尚未关联 Git 仓库（${repo.source?.error || '普通目录'}）`
  if (requirePersonalBranch && !repo.personal_branch) return `${repo.repo_id}：尚未配置个人开发分支`
  if (repo.protected_branch_error) return `${repo.repo_id}：${repo.protected_branch_error}`
  if (repo.head_equals_personal_branch) {
    const target = repo.suggested_checkout_ref ? ` ${repo.suggested_checkout_ref}` : '开发分支或目标提交'
    const command = repo.suggested_checkout_command ? `（可执行：${repo.suggested_checkout_command}）` : ''
    return `${repo.repo_id}：分析目录当前检出的正是个人分支 ${repo.personal_branch}，请先切回${target}${command}`
  }
  return ''
}

function viewHelpers(h, { working, openPoints }) {
  const field = (label, value, change, options = {}) => h('label', { className: 'pangea-fi-field' }, h('span', null, label),
    h(options.multiline ? 'textarea' : 'input', { 'aria-label': label, value: readable(value), onChange: event => change(event.target.value),
      disabled: working, ...(options.multiline ? { rows: 3 } : { type: 'text' }), placeholder: options.placeholder }))
  const renderSteps = steps => h('ol', { className: 'pangea-fi-steps pangea-fi-scroll' }, (Array.isArray(steps) ? steps : [steps]).filter(step => step != null).map((step, at) => h('li', { key: at }, readable(step))))
  const renderPoints = points => Array.isArray(points) && points.length ? points.map((point, index) => h('details', { key: point.id || index, open: openPoints, className: 'pangea-fi-point' },
    h('summary', null, `${readable(point.id)} · ${readable(point.action) || '桩点说明'}`),
    point.repo_id || point.path ? h('p', { className: 'b05-subtle' }, [readable(point.repo_id), readable(point.path)].filter(Boolean).join(':')) : null,
    point.trigger_scope ? h('dl', { className: 'pangea-reading-fields' },
      h('dt', null, '当前输入来源'), h('dd', null, readable(point.trigger_scope.current_input)),
      h('dt', null, '排除的历史与非目标输入'), h('dd', null, (point.trigger_scope.excluded_inputs || []).map(readable).join('、'))) : null,
    h('dl', { className: 'pangea-reading-fields' }, ...[['symbol', '代码位置'], ['action', '注入动作'], ['trigger', '触发条件'], ['times', '触发次数'], ['enable', '启用方式'], ['disable', '关闭方式'], ['observe', '命中检查'], ['cleanup', '恢复操作'], ['depends_on', '依赖桩点'], ['exclusive_with', '互斥桩点']].flatMap(([key, label]) => point[key] == null || (Array.isArray(point[key]) && !point[key].length) ? [] : [h('dt', { key: `${key}-label` }, label), h('dd', { key, style: { whiteSpace: 'pre-wrap' } }, Array.isArray(point[key]) ? point[key].map(readable).join('、') : readable(point[key]))])))) : h('p', { className: 'b05-subtle' }, '该用例按需打桩，具体注入点将在源码生成阶段定位。')
  return { field, renderSteps, renderPoints }
}

export function createFaultInjectionPanel(React) {
  const h = React.createElement
  const RepositorySettings = createRepositorySettings(React)
  return function FaultInjectionPanel({ runId, dataRoot, cwd, cases = [], standalone = false, onBack, onCreated, initialCaseKeys = [], handoffRevision = 0 }) {
    const [open, setOpen] = React.useState(standalone)
    const [step, setStep] = React.useState(2)
    const [chosen, setChosen] = React.useState(() => Array.isArray(initialCaseKeys) ? [...initialCaseKeys] : [])
    const [handoffNote, setHandoffNote] = React.useState('')
    const [repoSetupOpen, setRepoSetupOpen] = React.useState(false)
    const [query, setQuery] = React.useState('')
    const [focused, setFocused] = React.useState('')
    const [settings, setSettings] = React.useState(null)
    const [providers, setProviders] = React.useState([])
    const repoDetailsRef = React.useRef(null)
    const [error, setError] = React.useState('')
    const [working, setWorking] = React.useState(false)
    const [modelState, setModelState] = React.useState({ status: 'idle' })
    const [modelRefresh, setModelRefresh] = React.useState(0)
    const [tierFilter, setTierFilter] = React.useState('all')
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
    const scope = JSON.stringify([runId, dataRoot, cwd])
    const request = (payload = null) => injectionRequest({ run_id: runId, ...(dataRoot ? { data_root: dataRoot } : {}), ...(cwd ? { cwd } : {}), ...payload })
    React.useEffect(() => {
      if (!open) return
      let live = true
      request().then(value => {
        if (!live) return
        setProviders(value.providers ?? [])
        const inheritedModel = value.defaults?.agent_model || ''
        setSettings(previous => previous ?? {
          ...value.defaults,
          agent_model: inheritedModel,
          agent_model_inherited: Boolean(inheritedModel),
          delivery_mode: 'product_package',
          build_variant: 'debug',
          instructions: '',
        })
        setError('')
      }).catch(reason => { if (live) setError(reason.message) })
      return () => { live = false }
    }, [open, scope])
    const generate = async payload => {
      setWorking(true); setError('')
      try { onCreated((await request({ action: 'generate', ...payload })).task) }
      catch (reason) { setError(reason.message) }
      finally { setWorking(false) }
    }
    const { field, renderPoints } = viewHelpers(h, { working, openPoints: standalone })
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
    const enabledRepos = (settings?.repositories || []).filter(repo => repo.enabled !== false)
    const blockingErrors = enabledRepos.map(repo => repoBlockingReason(repo, { requirePersonalBranch: false })).filter(Boolean)
    const headInjectionNotices = enabledRepos.map(formatInjectionCommitNotice).filter(Boolean)
    const dirtyRepos = enabledRepos.filter(repo => repo.source?.dirty)
    const needsRepoSetup = blockingErrors.length > 0
    return h('section', { className: standalone ? 'pangea-injection-panel is-standalone' : 'b05-card pangea-injection-panel', 'data-testid': 'fault-injection-panel' },
      h('style', null, PANEL_CSS),
      !standalone ? h('div', { className: 'b05-head-actions', style: { justifyContent: 'space-between', marginBottom: open ? 14 : 0 } },
        h('div', null, h('strong', null, '打桩补丁生成'), h('p', { className: 'b05-subtle', style: { margin: '4px 0 0' } }, selectedKeys.length ? `已选择 ${selectedKeys.length} 条用例，可在独立源码副本中生成打桩补丁。` : '选择用例生成打桩补丁。')),
        h('button', { type: 'button', className: 'btn', 'aria-expanded': open, onClick: () => setOpen(value => !value) }, open ? '收起打桩' : '打开打桩工作区'))
        : h('div', { className: 'b05-head-actions', style: { justifyContent: 'space-between', marginBottom: 14 } },
          h('p', { className: 'b05-subtle', style: { margin: 0 } }, selectedKeys.length ? `当前已选 ${selectedKeys.length} 条打桩用例（推荐 ${recommendedKeys.length} 条 · 可选 ${selectableKeys.length} 条）` : `当前运行共 ${cases.length} 条用例：推荐打桩 ${recommendedKeys.length} 条（预设桩点 ${explicitKeys.length} 条），其余 ${Math.max(0, selectableKeys.length - recommendedKeys.length)} 条支持按需定位桩点。`),
          h('button', { type: 'button', onClick: onBack }, '更换分析任务')),
      open ? h('div', { className: 'pangea-fi-workspace', role: 'region', 'aria-label': '新建打桩任务', tabIndex: 0 },
        standalone ? h('ol', { className: 'pangea-fi-progress', 'aria-label': '新建打桩步骤' },
          ['选择分析任务', '选择用例', '设置与生成'].map((label, index) => h('li', {
            key: label,
            'data-done': step > index + 1 ? 'true' : undefined,
            'aria-current': step === index + 1 ? 'step' : undefined,
          }, h('b', null, step > index + 1 ? '✓' : `0${index + 1}`), label))) : null,
        error ? h('div', { role: 'alert', className: 'pangea-fi-banner danger' }, h('span', null, error)) : null,
        handoffNote && standalone && step === 2 ? h('div', { role: 'status', className: 'pangea-fi-banner info' },
          h('span', null, handoffNote),
          selectedKeys.length && settings ? h('button', { type: 'button', className: 'primary', onClick: () => setStep(3) }, '直接进入设置与生成') : null) : null,
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
              h('button', { type: 'button', className: 'primary', disabled: !selectedKeys.length || !settings, onClick: () => setStep(3) }, '下一步：设置与生成')))) : null,
        (!standalone || step === 3) && settings ? h('section', { className: 'pangea-fi-create' },
          h('h3', { style: { marginTop: 0 } }, '设置与生成'),
          h('details', null, h('summary', null, `已选择 ${selectedKeys.length} 条用例`), h('p', { className: 'pangea-fi-scroll' }, selectedCases.map(item => `${item.display_id ? `${item.display_id} ` : ''}${readable(item.title)}`).join('、') || '请先选择用例')),
          blockingErrors.length ? h('div', { role: 'alert', className: 'pangea-fi-banner danger' },
            h('div', null, blockingErrors.map((msg, idx) => h('p', { key: idx, style: { margin: idx ? '4px 0 0' : 0 } }, msg))),
            h('button', { type: 'button', onClick: () => { setRepoSetupOpen(true); repoDetailsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }) } }, '定位仓库配置')) : null,
          headInjectionNotices.length ? h('div', { role: 'status', className: 'pangea-fi-banner warn', style: { display: 'block' } },
            headInjectionNotices.map((msg, idx) => h('p', { key: idx, style: { margin: idx ? '4px 0 0' : 0 } }, msg))) : null,
          dirtyRepos.length ? h('div', { role: 'status', className: 'pangea-fi-banner info' },
            h('span', null, `${dirtyRepos.map(repo => repo.repo_id).join('、')} 工作区存在未提交改动；打桩基线仅读取当前 HEAD 已提交内容，不会修改分析目录或带入未提交改动。`)) : null,
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
              field('任务名称', settings.name, value => setSettings({ ...settings, name: value }), { placeholder: '可选，便于区分多次打桩任务' }),
              h('label', { className: 'pangea-fi-field' }, h('span', null, '交付形态'),
                h('select', { 'aria-label': '交付形态', value: normalizeDeliveryMode(settings.delivery_mode), disabled: working, onChange: event => setSettings({ ...settings, delivery_mode: event.target.value }) },
                  h('option', { value: 'product_package' }, DELIVERY_MODE_LABELS.product_package),
                  h('option', { value: 'unit_test' }, DELIVERY_MODE_LABELS.unit_test))),
              normalizeDeliveryMode(settings.delivery_mode) === 'product_package'
                ? h('label', { className: 'pangea-fi-field' }, h('span', null, '目标部署变体'),
                    h('select', { 'aria-label': '目标部署变体', value: normalizeBuildVariant(settings.build_variant), disabled: working, onChange: event => setSettings({ ...settings, build_variant: event.target.value }) },
                      h('option', { value: 'debug' }, BUILD_VARIANT_LABELS.debug),
                      h('option', { value: 'hitest' }, BUILD_VARIANT_LABELS.hitest)),
                    h('span', { style: { fontSize: 12, fontWeight: 400, color: '#5e6773' } }, '两种变体共用同一份业务桩源码补丁（不依赖测试宏）；部署核验与防顶包指引随所选变体切换。'))
                : null),
            h('p', { style: { fontSize: 13 } }, h('strong', null, '当前代码基线：'), enabledRepos.map(repo => `${repo.repo_id} → ${sourceLabel(repo.source)}`).join('；')),
            h('details', { ref: repoDetailsRef, className: 'pangea-fi-technical', open: needsRepoSetup || repoSetupOpen || undefined },
              h('summary', null, '代码来源与高级设置'),
              h(RepositorySettings, { cwd, dataRoot, defaultOpen: needsRepoSetup || repoSetupOpen, repositories: settings.repositories || [], onSaved: async () => { const value = await request(); setSettings(previous => ({ ...previous, repositories: value.defaults.repositories, pipeline_url: value.defaults.pipeline_url })) } }),
              (settings.repositories ?? []).map((repo, index) => h('fieldset', { key: repo.repo_id, className: 'pangea-fi-repo-box' },
                h('legend', null, h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 } }, h('input', { type: 'checkbox', checked: repo.enabled !== false, disabled: working, 'aria-label': `本次包含 ${repo.repo_id}`, onChange: event => setSettings({ ...settings, repositories: settings.repositories.map((item, at) => at === index ? { ...item, enabled: event.target.checked } : item) }) }), readable(repo.repo_id))),
                h('p', { style: { fontSize: 12, color: '#5e6773' } }, '分析目录当前源码：', sourceLabel(repo.source)),
                repo.comparison?.changed_count ? h('p', { style: { fontSize: 12 } }, `分析快照中有 ${repo.comparison.changed_count} 个文件与当前 HEAD 不同。生成时将基于当前 HEAD 代码重新定位桩点。`) : null,
                repo.comparison?.eol_only_count ? h('p', { style: { fontSize: 12, color: '#5e6773' } }, `${repo.comparison.eol_only_count} 个文件仅 CRLF/LF 换行符不同，单独记录，不计入内容变化。`) : null,
                repo.comparison?.error ? h('p', { role: 'alert', style: { color: '#b62836', fontSize: 12 } }, repo.comparison.error) : null,
                h('p', { style: { fontSize: 12, color: '#5e6773' } }, `Git 仓库：${repo.source_path}；远端：${repo.remote}；个人分支：${repo.personal_branch || '未配置（可在合成出包前配置）'}`)))),
            h('p', { className: 'b05-subtle', style: { fontSize: 12 } }, '在独立副本中基于当前分析目录 HEAD 生成打桩补丁；生成过程不触碰分析目录与本地分支，门禁提交信息与推送统一在“合成出包”完成。'),
            field('补充说明', settings.instructions, value => setSettings({ ...settings, instructions: value }), { multiline: true, placeholder: '可选：补充触发边界、日志开关或构建宏约束…' }),
            h('footer', { className: 'pangea-fi-footer' },
              standalone ? h('button', { type: 'button', disabled: working, onClick: () => setStep(2) }, '上一步') : h('span', null),
              h('button', { type: 'button', className: 'btn primary', disabled: working || !modelSelection.ready || !selectedKeys.length || !enabledRepos.length || blockingErrors.length > 0,
                onClick: () => generate({ ...effectiveSettings, agent_model: modelSelection.model, agent_catalog_id: modelSelection.catalogId, repositories: enabledRepos, case_keys: selectedKeys }) }, working ? '正在提交…' : standalone ? '生成打桩修改' : `生成打桩修改（${selectedKeys.length} 条用例）`))))
          : !settings ? h('p', null, '正在读取打桩设置…') : null,
        ) : null)
  }
}

export function createFaultInjectionTaskDetail(React) {
  const h = React.createElement
  return function FaultInjectionTaskDetail({ runId, taskId, dataRoot, cwd, onSwitch, onOpenBuild }) {
    const [task, setTask] = React.useState(null)
    const [profileKey, setProfileKey] = React.useState('')
    const drafts = React.useRef({})
    const [notice, setNotice] = React.useState('')
    const [error, setError] = React.useState('')
    const [working, setWorking] = React.useState(false)
    const [build, setBuild] = React.useState({ url: '', package_id: '', package_sha256: '', notes: '' })
    const [verification, setVerification] = React.useState({ case_key: '', result: 'not_run', hits: '', notes: '' })
    const [logText, setLogText] = React.useState('')
    const scope = JSON.stringify([runId, taskId, dataRoot, cwd])
    const request = payload => injectionRequest({ run_id: runId, ...(dataRoot ? { data_root: dataRoot } : {}), ...(cwd ? { cwd } : {}), task_id: taskId, ...payload })
    React.useEffect(() => {
      let live = true
      request().then(value => { if (live) setTask(value.task) }).catch(reason => { if (live) setError(reason.message) })
      return () => { live = false }
    }, [scope])
    const running = busy(task)
    React.useEffect(() => {
      if (!running) return
      let live = true, pending = false
      const timer = setInterval(async () => {
        if (pending) return
        pending = true
        try { const value = await request(); if (live) setTask(value.task) }
        catch (reason) { if (live) setError(reason.message) }
        finally { pending = false }
      }, 1000)
      return () => { live = false; clearInterval(timer) }
    }, [scope, running])
    React.useEffect(() => {
      if (!task) return
      setBuild({ url: '', package_id: '', package_sha256: '', notes: '', ...task.build })
      setVerification({ result: 'not_run', hits: '', notes: '', ...task.verification?.filter(item => item.case_key === task.case_keys?.[0]).at(-1), case_key: task.case_keys?.[0] || '' })
    }, [task?.id])
    const act = async (action, extra = {}) => {
      setWorking(true); setError(''); setNotice('')
      try {
        const value = await request({ action, ...extra })
        if (value.task.id !== taskId) { onSwitch(value.task); return }
        setTask(value.task)
        if (['configure', 'verify'].includes(action)) setNotice('已保存')
      } catch (reason) { setError(reason.message) }
      finally { setWorking(false) }
    }
    const { field, renderSteps, renderPoints } = viewHelpers(h, { working, openPoints: true })
    const banners = [
      error ? h('div', { key: 'error', role: 'alert', className: 'pangea-fi-banner danger' }, h('span', null, error)) : null,
      notice ? h('div', { key: 'notice', role: 'status', className: 'pangea-fi-banner good' }, h('span', null, notice)) : null,
    ]
    if (!task) return h('section', { className: 'pangea-injection-panel is-standalone', 'data-testid': 'fault-injection-task' }, h('style', null, PANEL_CSS),
      ...banners, error ? null : h('p', { role: 'status' }, '正在读取打桩任务…'))
    const profiles = Array.isArray(task.result?.profiles) ? task.result.profiles : []
    const profile = profiles.find(item => item.case_key === profileKey) || profiles[0]
    const latestResults = new Map((task.verification || []).map(item => [item.case_key, item.result]))
    const passedCount = [...latestResults.values()].filter(result => result === 'passed').length
    const branchText = task.latest_build?.branch || task.branch || ''
    const includable = Boolean(task.result_saved && task.generation_complete !== false && ['ready', 'pushed'].includes(task.status))
    const canVerify = Boolean(task.latest_pushed_build?.commits?.length) || (task.repositories || []).some(repo => repo.commit)
    const activeCommits = task.latest_pushed_build?.commits?.length
      ? task.latest_pushed_build.commits
      : (task.repositories || []).filter(repo => repo.commit).map(repo => ({ repo_id: repo.repo_id, commit: repo.commit }))
    return h('section', { className: 'pangea-injection-panel is-standalone', 'data-testid': 'fault-injection-task' }, h('style', null, PANEL_CSS),
      ...banners,
      h('div', { className: 'pangea-fi-task-card' },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' } },
          h('div', null,
            h('h3', { style: { margin: 0 } }, `正在查看：${task.name || task.cases?.[0]?.title || '打桩任务'}`),
            h('p', { className: 'b05-subtle', style: { margin: '6px 0 0', fontSize: 13 } },
              `${task.case_keys.length} 条用例 · ${task.result?.points?.length || 0} 个桩点 · 最新记录 ${passedCount}/${task.case_keys.length} 通过`,
              branchText ? h(React.Fragment, null, ' · 个人分支 ', h('code', null, branchText)) : null)),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { role: 'status', className: `pangea-fi-status-pill ${statusTone(task.status)}` }, task.status === 'failed' && task.failure_phase === 'preparing' ? '准备源码失败' : INJECTION_STATUS_LABELS[task.status] || task.status),
            busy(task) ? h('button', { type: 'button', className: 'btn', disabled: working, onClick: () => act('cancel') }, '停止本次操作') : null)),
        task.error ? h('div', { role: 'alert', className: 'pangea-fi-banner danger', style: { display: 'block' } },
          h('p', { style: { margin: 0, fontWeight: 600 } }, task.failure_phase === 'preparing' ? '准备源码失败，尚未开始生成打桩修改。' : '本次操作未完成。'),
          h('details', { open: Boolean(task.generation_complete) || undefined }, h('summary', null, '查看错误详情'), h('pre', { style: { whiteSpace: 'pre-wrap', margin: '6px 0 0' } }, task.error))) : null,
        Array.isArray(task.notices) && task.notices.length ? h('div', { role: 'status', className: 'pangea-fi-banner warn', style: { display: 'block' } }, task.notices.map((text, index) => h('p', { key: index, style: { margin: index ? '6px 0 0' : 0 } }, text))) : null,
        task.reused_from ? h('p', { className: 'b05-subtle', style: { fontSize: 12 } }, '本任务直接复用了已留存的生成结果，未调用模型。') : null,
        task.telemetry ? h('p', { className: 'b05-subtle', style: { fontSize: 12, margin: '6px 0 0' } }, `执行账本：模型轮次 ${task.telemetry.turns ?? 0} · 工具调用 ${task.telemetry.tool_calls ?? 0} 次 · 上下文压缩 ${task.telemetry.compactions ?? 0} 次${task.telemetry.budget_wrapup_triggered ? ' · 已触发探索预算收口' : ''}`) : null,
        ['failed', 'cancelled', 'interrupted'].includes(task.status) && !task.generation_complete ? h('div', { style: { marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 } },
          task.result_saved ? h('button', { type: 'button', className: 'primary', disabled: working, onClick: () => act('revalidate') }, '原地重新验收（不调用模型）') : null,
          task.result_saved ? h('button', { type: 'button', style: { marginLeft: 0 }, disabled: working, onClick: () => act('reuse-result') }, '直接复用已留存的生成结果（不调用模型）') : null,
          task.result_saved ? h('button', { type: 'button', style: { marginLeft: 0 }, disabled: working, onClick: () => act('retry-with-reference') }, '参考上次结果重新生成') : null,
          h('button', { type: 'button', className: task.result_saved ? '' : 'primary', style: { marginLeft: 0 }, disabled: working, onClick: () => act('retry') }, '沿用本任务配置重新生成')) : null,
        includable ? h('section', { className: 'pangea-fi-repo-box', style: { marginTop: 14 } },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' } },
            h('div', null,
              h('strong', null, '补丁就绪，可加入合成出包'),
              h('p', { className: 'b05-subtle', style: { margin: '4px 0 0', fontSize: 12 } },
                task.latest_build
                  ? `最近出包状态：${BUILD_STATUS_LABELS[task.latest_build.status] || task.latest_build.status}${task.latest_build.commits?.length ? `（${task.latest_build.commits.map(c => `${c.repo_id} ${String(c.commit || '').slice(0, 12)}`).join('、')}）` : ''}`
                  : '本任务只保存打桩补丁与执行说明，可与其他打桩任务一起按当前分析目录 HEAD 合成并推送到个人分支。')),
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
              onOpenBuild ? h('button', { type: 'button', className: 'btn primary', disabled: working, onClick: () => onOpenBuild({ run_id: task.run_id, task_id: task.id }) }, '加入出包 / 推送个人分支') : null,
              task.result_saved ? h('button', { type: 'button', style: { marginLeft: 0 }, disabled: working, onClick: () => act('retry-with-reference') }, '参考上次结果重新生成') : null,
              h('button', { type: 'button', style: { marginLeft: 0 }, disabled: working, onClick: () => act('retry') }, '沿用本任务配置重新生成')))) : null,
        task.result ? (() => {
          const delivery = task.result?.delivery || null
          const verifyInfo = buildArtifactVerifyCommands(task, task.build_variant)
          const replaceFiles = verifyInfo.replace_files
          const copyText = async (text, okMsg) => {
            try { await navigator.clipboard.writeText(text); setNotice(okMsg) }
            catch { setError('复制失败，请手动选中复制') }
          }
          return h('section', { className: 'pangea-fi-repo-box', style: { marginTop: 14, borderColor: '#cfe0ee', background: '#fbfdff' }, 'data-testid': 'fault-injection-replace-files' },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 } },
              h('div', null,
                h('strong', null, '应单独替换的文件与部署核验'),
                h('p', { className: 'b05-subtle', style: { margin: '4px 0 0', fontSize: 12 } },
                  `交付形态：${DELIVERY_MODE_LABELS[normalizeDeliveryMode(task.delivery_mode ?? delivery?.mode)]} · 当前变体：${verifyInfo.variant_label}`)),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 } },
                  '目标部署变体',
                  h('select', {
                    'aria-label': '切换目标部署变体',
                    value: verifyInfo.variant,
                    disabled: working || busy(task),
                    style: { minHeight: 30, padding: '3px 8px', fontSize: 12 },
                    onChange: event => act('set-variant', { build_variant: event.target.value }),
                  },
                  h('option', { value: 'debug' }, BUILD_VARIANT_LABELS.debug),
                  h('option', { value: 'hitest' }, BUILD_VARIANT_LABELS.hitest))),
                replaceFiles.length ? h('button', {
                  type: 'button',
                  style: { minHeight: 30, padding: '3px 10px', fontSize: 12, marginLeft: 0 },
                  onClick: () => copyText(replaceFiles.map(item => item.artifact).join('\n'), '已复制应替换文件清单'),
                }, '复制文件清单') : null)),
            h('div', { role: 'status', className: 'pangea-fi-banner info', style: { margin: '8px 0' } }, h('span', null, verifyInfo.variant_hint)),
            delivery?.build_requirement ? h('p', { style: { fontSize: 13, margin: '8px 0' } }, h('strong', null, '构建前提：'), delivery.build_requirement) : null,
            replaceFiles.length
              ? h('table', { className: 'pangea-fi-table', 'aria-label': '应单独替换的文件清单', style: { marginTop: 8 } },
                  h('thead', null, h('tr', null, ...['应替换文件 / 产物', '类型', '对应修改源码', '构建依据', '替换后动作'].map(label => h('th', { key: label }, label)))),
                  h('tbody', null, replaceFiles.map((item, idx) => h('tr', { key: `${item.artifact}:${idx}` },
                    h('td', null,
                      h('code', { style: { fontWeight: 600 } }, item.artifact),
                      h('div', { style: { marginTop: 4 } }, h('button', {
                        type: 'button',
                        style: { minHeight: 24, padding: '2px 8px', fontSize: 11 },
                        onClick: () => copyText(item.artifact, `已复制 ${item.artifact}`),
                      }, '复制'))),
                    h('td', null, ARTIFACT_KIND_LABELS[item.kind] || item.kind),
                    h('td', null, item.source_files.map((src, sIdx) => h('div', { key: sIdx }, h('code', null, src)))),
                    h('td', null, item.build_evidence || '—'),
                    h('td', null, item.post_replace_action || '—')))))
              : h('p', { className: 'b05-subtle', style: { fontSize: 12 } }, '此历史任务未包含结构化替换文件清单，请参考下方“待合成补丁差异”或重新生成。'),
            verifyInfo.markers.length ? h('div', { style: { marginTop: 10 } },
              h('p', { style: { fontSize: 12, margin: '0 0 6px' } },
                h('strong', null, '桩特征标识（已核对存在于补丁源码）：'),
                verifyInfo.markers.map((marker, idx) => h('code', { key: idx, style: { marginRight: 8 } }, marker))),
              h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
                h('button', { type: 'button', style: { minHeight: 30, padding: '3px 10px', fontSize: 12 }, onClick: () => copyText(verifyInfo.pre_replace_cmd, '已复制替换前验库命令') }, '复制：替换前验库命令（防 F1 未编入）'),
                verifyInfo.safe_relink_cmd ? h('button', { type: 'button', style: { minHeight: 30, padding: '3px 10px', fontSize: 12, marginLeft: 0 }, onClick: () => copyText(verifyInfo.safe_relink_cmd, '已复制 PANGEA 安全重链代理命令') }, '复制：PANGEA 安全重链代理命令（自动绕过 F3/F4）') : null,
                h('button', { type: 'button', style: { minHeight: 30, padding: '3px 10px', fontSize: 12, marginLeft: 0 }, onClick: () => copyText(verifyInfo.post_deploy_cmd, '已复制部署后验二进制命令') }, '复制：重链部署后验最终产物命令（防 F4 顶包）'))) : null)
        })() : null,
        !includable && !busy(task) && task.schema_version === 1 ? h('div', { role: 'status', className: 'pangea-fi-banner warn' }, '此历史任务缺少可复用的结构化修改记录，请按当前最新代码重新生成。') : null,
        canVerify ? h('details', { key: `verification:${task.id}`, style: { marginTop: 12 } },
          h('summary', null, '构建包与验证记录'),
          h('p', { className: 'b05-subtle', style: { fontSize: 12 } },
            '当前关联提交：',
            activeCommits.map(item => `${item.repo_id} ${String(item.commit || '').slice(0, 12)}`).join('、'),
            '。烧包测试后，在这里记录验证结果。'),
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
            h('p', { className: 'b05-subtle', style: { fontSize: 12 } }, `验证包：${value.build?.package_id || '未填写'}；提交：${(value.build?.commits || []).map(repo => `${repo.repo_id} ${String(repo.commit || '').slice(0, 12)}`).join('、')}`),
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
          profile?.safety ? h('div', { 'aria-label': '安全执行流程' },
            ...[['setup', '准备与原状态快照'], ['negative_steps', '历史与非目标输入验证'], ['steps', '故障命中与恢复'], ['cleanup', '退出清理'], ['cleanup_verify', '独立恢复检查']].map(([key, label]) =>
              h('details', { key }, h('summary', null, label), renderSteps(key === 'steps' ? profile.steps : profile.safety[key]))))
            : renderSteps(profile?.steps)) : null,
        task.result?.limitations?.length ? h('details', null, h('summary', null, `生成限制（${task.result.limitations.length}）`),
          Array.isArray(task.result.limitations)
            ? h('ul', { className: 'pangea-fi-steps pangea-fi-scroll' }, task.result.limitations.map((item, at) => h('li', { key: at }, readable(item))))
            : h('p', { className: 'pangea-fi-scroll', style: { whiteSpace: 'pre-wrap' } }, readable(task.result.limitations))) : null,
        (task.repositories || []).map(repo => h('details', { key: repo.repo_id, open: Boolean(repo.diff), style: { marginTop: 12 } },
          h('summary', null, `${repo.repo_id}${repo.base_branch ? ` · 基线分支 ${repo.base_branch}` : ''} · ${repo.diff ? '待合成补丁差异' : '未修改'}`),
          h('p', { style: { fontSize: 12, color: '#5e6773' } },
            '生成基线：', h('code', null, repo.base_commit),
            repo.analysis_commit && repo.analysis_commit !== repo.base_commit ? h(React.Fragment, null, ' · 分析快照：', h('code', null, repo.analysis_commit)) : null,
            repo.commit ? h(React.Fragment, null, ' · 历史单任务提交：', h('code', null, repo.commit)) : null),
          repo.diff ? h('pre', { style: { maxHeight: 400, overflow: 'auto', padding: 12, borderRadius: 8, border: '1px solid #e2e6ec', background: '#f8f9fb', font: '12px/1.6 Consolas, monospace' } }, repo.diff) : null)),
      ))
  }
}

export function createFaultInjectionHome(React) {
  const h = React.createElement
  return function FaultInjectionHome({ dataRoot, cwd, reload = 0, analysisLabel, onOpen, onCreate, onOpenBuild }) {
    const [tasks, setTasks] = React.useState(null)
    const [error, setError] = React.useState('')
    const [filters, setFilters] = React.useState({ status: '', run_id: '', repo_id: '', order: 'desc' })
    React.useEffect(() => {
      let live = true
      setError('')
      injectionRequest({ view: 'all', ...(dataRoot ? { data_root: dataRoot } : {}), ...(cwd ? { cwd } : {}) })
        .then(value => { if (live) setTasks(value.tasks) })
        .catch(reason => { if (live) setError(reason.message) })
      return () => { live = false }
    }, [dataRoot, cwd, reload])
    const statusLabel = task => task.status === 'failed' && task.failure_phase === 'preparing' ? '准备源码失败' : INJECTION_STATUS_LABELS[task.status] || task.status
    const buildLabel = task => {
      if (task.status === 'unreadable') return ''
      if (task.latest_build) {
        if (task.latest_build.pushed) {
          const shortSha = String(task.latest_build.commits?.[0]?.commit || '').slice(0, 8)
          return shortSha ? `已推送 ${shortSha}` : '已推送'
        }
        return BUILD_STATUS_LABELS[task.latest_build.status] || task.latest_build.status
      }
      if (task.status === 'pushed') return '历史推送'
      return '未出包'
    }
    const all = tasks || []
    const includableCount = all.filter(task => task.includable).length
    const options = values => [...new Set(values)].sort()
    const shown = all
      .filter(task => (!filters.status || task.status === filters.status) && (!filters.run_id || task.run_id === filters.run_id) && (!filters.repo_id || task.repo_ids?.includes(filters.repo_id)))
      .sort((a, b) => (filters.order === 'asc' ? 1 : -1) * String(a.created_at || '').localeCompare(String(b.created_at || '')))
    const filter = (label, key, values) => h('label', null, label, h('select', { 'aria-label': label, value: filters[key], onChange: event => setFilters({ ...filters, [key]: event.target.value }) }, ...values))
    return h('section', { className: 'pangea-injection-panel is-standalone', 'data-testid': 'fault-injection-home' }, h('style', null, PANEL_CSS),
      h('div', { className: 'b05-head-actions', style: { justifyContent: 'space-between', marginBottom: 14 } },
        h('h3', { style: { margin: 0 } }, `打桩任务（${all.length}）`),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          onOpenBuild ? h('button', { type: 'button', onClick: () => onOpenBuild() }, includableCount ? `合成出包（${includableCount} 个可用）` : '合成出包') : null,
          h('button', { type: 'button', className: 'primary', onClick: onCreate }, '新建打桩任务'))),
      h('div', { className: 'pangea-fi-filters' },
        filter('按状态筛选', 'status', [h('option', { key: '', value: '' }, '全部状态'), ...options(all.map(task => task.status)).map(value => h('option', { key: value, value }, INJECTION_STATUS_LABELS[value] || value))]),
        filter('按分析任务筛选', 'run_id', [h('option', { key: '', value: '' }, '全部分析任务'), ...options(all.map(task => task.run_id)).map(value => h('option', { key: value, value }, analysisLabel(value)))]),
        filter('按仓库筛选', 'repo_id', [h('option', { key: '', value: '' }, '全部仓库'), ...options(all.flatMap(task => task.repo_ids || [])).map(value => h('option', { key: value, value }, value))]),
        filter('排序', 'order', [h('option', { key: 'desc', value: 'desc' }, '最新在前'), h('option', { key: 'asc', value: 'asc' }, '最早在前')])),
      error ? h('div', { role: 'alert', className: 'pangea-fi-banner danger' }, h('span', null, error)) : null,
      !tasks && !error ? h('p', { role: 'status' }, '正在读取打桩任务…') : null,
      tasks && !all.length ? h('p', { role: 'status' }, '暂无打桩任务。点击“新建打桩任务”从分析结果选择用例。') : null,
      all.length ? h('table', { className: 'pangea-fi-table', 'aria-label': '打桩任务列表' },
        h('thead', null, h('tr', null, ...['名称', '分析任务', '用例', '桩点', '状态', '最近出包', '验证', '创建时间'].map(label => h('th', { key: label }, label)))),
        h('tbody', null, shown.map(task => h('tr', { key: `${task.run_id}/${task.id}` },
          h('td', null, task.status === 'unreadable'
            ? h(React.Fragment, null, task.id, h('small', { role: 'alert' }, task.error))
            : h('button', { type: 'button', className: 'link-btn', onClick: () => onOpen(task) }, task.name || '打桩任务')),
          h('td', null, analysisLabel(task.run_id)),
          h('td', null, task.case_count ?? ''),
          h('td', null, task.point_count ?? ''),
          h('td', null, h('span', { className: `pangea-fi-status-pill ${statusTone(task.status)}` }, statusLabel(task))),
          h('td', null, buildLabel(task)),
          h('td', null, task.status === 'unreadable' ? '' : task.verified_count ? `${task.passed_count}/${task.case_count} 通过` : '未记录'),
          h('td', null, task.created_at ? new Date(task.created_at).toLocaleString() : ''))))) : null)
  }
}

export function createFaultInjectionBuild(React) {
  const h = React.createElement
  const RepositorySettings = createRepositorySettings(React)
  return function FaultInjectionBuild({ dataRoot, cwd, reload = 0, initialItems = null, analysisLabel = id => id, onOpenTask, onOpenPipeline, onBack }) {
    const [context, setContext] = React.useState(null)
    const [selectedKeys, setSelectedKeys] = React.useState([])
    const [activeBuild, setActiveBuild] = React.useState(null)
    const [commitDraft, setCommitDraft] = React.useState(() => ({ ...normalizeCommitConfig({}), summary: null }))
    const [pipelineUrl, setPipelineUrl] = React.useState('')
    const [repoSetupOpen, setRepoSetupOpen] = React.useState(false)
    const [query, setQuery] = React.useState('')
    const [working, setWorking] = React.useState(false)
    const [notice, setNotice] = React.useState('')
    const [error, setError] = React.useState('')
    const initializedSelection = React.useRef('')
    const initialSignature = JSON.stringify(initialItems || [])
    const request = payload => injectionRequest({ ...(dataRoot ? { data_root: dataRoot } : {}), ...(cwd ? { cwd } : {}), ...payload })

    const loadContext = React.useCallback(async ({ preserveSelection = false } = {}) => {
      const value = await request({ view: 'build-context' })
      setContext(value)
      const includableKeys = new Set((value.tasks || []).filter(item => item.includable).map(item => itemKey(item.run_id, item.id)))
      const selectionToken = `${dataRoot || ''}:${cwd || ''}:${initialSignature}`
      if (!preserveSelection && initializedSelection.current !== selectionToken) {
        initializedSelection.current = selectionToken
        const baseDefault = (value.default_items || []).map(item => itemKey(item.run_id, item.task_id)).filter(key => includableKeys.has(key))
        const requested = Array.isArray(initialItems)
          ? initialItems.map(item => itemKey(item.run_id, item.task_id)).filter(key => includableKeys.has(key))
          : []
        setSelectedKeys([...new Set([...baseDefault, ...requested])])
        setCommitDraft(buildCommitDraft(value.commit_config))
        setPipelineUrl(value.pipeline_url || '')
        const runningOrLatest = (value.builds || []).find(item => busy(item)) || (value.builds || [])[0] || null
        setActiveBuild(runningOrLatest)
      } else {
        setSelectedKeys(prev => prev.filter(key => includableKeys.has(key)))
        setPipelineUrl(prev => prev || value.pipeline_url || '')
      }
      return value
    }, [dataRoot, cwd, initialSignature])

    React.useEffect(() => {
      let live = true
      setError('')
      loadContext({ preserveSelection: initializedSelection.current === `${dataRoot || ''}:${cwd || ''}:${initialSignature}` })
        .catch(reason => { if (live) setError(reason.message) })
      return () => { live = false }
    }, [loadContext, reload])

    const buildRunning = busy(activeBuild)
    React.useEffect(() => {
      if (!buildRunning || !activeBuild?.id || working) return
      let live = true, pending = false
      const poll = async () => {
        if (pending || !live) return
        pending = true
        try {
          const value = await request({ build_id: activeBuild.id })
          if (!live) return
          if (!busy(value.build)) {
            try { await loadContext({ preserveSelection: true }) } catch (err) { if (live) setError(err.message) }
          }
          if (!live) return
          setActiveBuild(value.build)
        } catch (reason) {
          if (live) setError(reason.message)
        } finally {
          pending = false
        }
      }
      const fast = setTimeout(poll, 120)
      const timer = setInterval(poll, 1000)
      return () => { live = false; clearTimeout(fast); clearInterval(timer) }
    }, [buildRunning, activeBuild?.id, working, dataRoot, cwd, loadContext])

    const { field } = viewHelpers(h, { working: working || buildRunning, openPoints: false })
    if (!context) {
      return h('section', { className: 'pangea-injection-panel is-standalone', 'data-testid': 'fault-injection-build' },
        h('style', null, PANEL_CSS),
        error ? h('div', { role: 'alert', className: 'pangea-fi-banner danger' }, h('span', null, error)) : h('p', { role: 'status' }, '正在读取合成出包上下文…'))
    }

    const includableTasks = (context.tasks || []).filter(item => item.includable)
    const selectedSet = new Set(selectedKeys)
    const selectedTasks = includableTasks
      .filter(item => selectedSet.has(itemKey(item.run_id, item.id)))
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id)))
    const repoMap = new Map((context.repositories || []).map(repo => [repo.repo_id, repo]))
    const touchedRepoIds = [...new Set(selectedTasks.flatMap(task => task.repo_ids || []))].sort()
    const shownRepos = (touchedRepoIds.length ? touchedRepoIds.map(id => repoMap.get(id)).filter(Boolean) : (context.repositories || []))
    const blockingErrors = touchedRepoIds.map(id => repoBlockingReason(repoMap.get(id), { requirePersonalBranch: true })).filter(Boolean)
    const restoreTargetRepos = shownRepos.filter(repo => repo?.source?.kind === 'git' && repo.personal_branch)
    const restoreBlockingErrors = restoreTargetRepos.map(repo => repoBlockingReason(repo, { requirePersonalBranch: true })).filter(Boolean)
    const headInjectionNotices = shownRepos.map(formatInjectionCommitNotice).filter(Boolean)
    const dirtyRepos = shownRepos.filter(repo => repo.source?.dirty)
    const repoSetKey = touchedRepoIds.join('\0')
    const defaultForRepoSet = (repoSetKey && context.pushed_items_by_repo_set?.[repoSetKey]) || context.default_items || []

    const restoreCommitSubject = { id: 'restore', restore_baseline: true, items: [] }
    const commitSubject = selectedTasks.length
      ? { id: activeBuild?.id || 'pending', items: selectedTasks.map(task => ({ run_id: task.run_id, task_id: task.id, name: task.name || task.id })) }
      : restoreCommitSubject
    const effectiveCommitConfig = { ...commitDraft, summary: commitDraft.summary ?? defaultCommitSummary(commitSubject) }
    const commitCheck = (selectedTasks.length || restoreTargetRepos.length)
      ? resolveCommitMessage(effectiveCommitConfig, commitSubject, { allowDefaultSummary: commitDraft.summary === null })
      : { ok: true, message: '', error: null }
    const restoreCommitCheck = restoreTargetRepos.length
      ? resolveCommitMessage({ ...commitDraft, summary: commitDraft.summary ?? defaultCommitSummary(restoreCommitSubject) }, restoreCommitSubject, { allowDefaultSummary: commitDraft.summary === null })
      : { ok: false, message: '', error: null }
    const remoteHookRegex = extractRemoteHookRegex(activeBuild?.error)
    const targetGateRegex = remoteHookRegex || DEFAULT_INTRANET_COMMIT_REGEX
    const showRemoteGateHelper = Boolean(activeBuild && (remoteHookRegex || /【问题单号/.test(activeBuild.error || '')) && (effectiveCommitConfig.mode !== 'template' || (remoteHookRegex && effectiveCommitConfig.pattern !== remoteHookRegex)))

    const savedPipelineUrl = activeBuild?.pipeline_url ?? context.pipeline_url ?? ''
    const pipelineDirty = pipelineUrl.trim() !== savedPipelineUrl
    const hasPatchFailures = Boolean(activeBuild?.repositories?.some(repo => repo.failures?.length > 0))
    const canRetryActiveBuild = Boolean(
      activeBuild
      && ['failed', 'cancelled', 'interrupted'].includes(activeBuild.status)
      && !hasPatchFailures,
    )

    const startBuild = async ({ retryId = null, restoreBaseline = false, allowOverwriteRemoteDiverged = false } = {}) => {
      if (restoreBaseline) {
        const targets = restoreTargetRepos.map(r => `${r.repo_id}（${r.remote}/${r.remote_branch}）`).join('、')
        if (typeof window?.confirm === 'function' && !window.confirm(`确认将 ${targets} 恢复为分析目录当前干净基线（清空所有打桩改动）并推送到远端个人分支？\n该操作不会修改本地分析目录，也不使用强推。`)) {
          return
        }
      }
      setWorking(true); setError(''); setNotice('')
      let latestBuild = null
      try {
        const subject = retryId && activeBuild
          ? { id: activeBuild.id, restore_baseline: activeBuild.restore_baseline === true, items: activeBuild.items || [] }
          : restoreBaseline
            ? restoreCommitSubject
            : commitSubject
        const cfg = { ...commitDraft, summary: commitDraft.summary ?? defaultCommitSummary(subject) }
        const checked = resolveCommitMessage(cfg, subject, { allowDefaultSummary: commitDraft.summary === null })
        if (!checked.ok) throw new Error(checked.error)
        const overwriteFlag = allowOverwriteRemoteDiverged ? { allow_overwrite_remote_diverged: true } : {}
        const payload = retryId
          ? { action: 'build', build_id: retryId, commit_config: cfg, commit_message: checked.message, pipeline_url: pipelineUrl, ...overwriteFlag }
          : restoreBaseline
            ? {
                action: 'build',
                restore_baseline: true,
                repo_ids: restoreTargetRepos.map(repo => repo.repo_id),
                commit_config: cfg,
                commit_message: checked.message,
                pipeline_url: pipelineUrl,
                ...overwriteFlag,
              }
            : {
                action: 'build',
                items: selectedTasks.map(task => ({ run_id: task.run_id, task_id: task.id, result_sha256: task.result_sha256 })),
                commit_config: cfg,
                commit_message: checked.message,
                pipeline_url: pipelineUrl,
                ...overwriteFlag,
              }
        const value = await request(payload)
        latestBuild = value.build
        if (!busy(value.build)) await loadContext({ preserveSelection: true })
      } catch (reason) {
        setError(reason.message)
      } finally {
        if (latestBuild) setActiveBuild(latestBuild)
        setWorking(false)
      }
    }

    const cancelActive = async () => {
      if (!activeBuild?.id) return
      setWorking(true); setError('')
      let latestBuild = null
      try {
        const value = await request({ action: 'build-cancel', build_id: activeBuild.id })
        latestBuild = value.build
        await loadContext({ preserveSelection: true })
      } catch (reason) {
        setError(reason.message)
      } finally {
        if (latestBuild) setActiveBuild(latestBuild)
        setWorking(false)
      }
    }

    const savePipeline = async () => {
      setWorking(true); setError(''); setNotice('')
      try {
        const value = await request({ action: 'build-configure', ...(activeBuild?.id ? { build_id: activeBuild.id } : {}), pipeline_url: pipelineUrl })
        if (value.build) setActiveBuild(value.build)
        setContext(prev => prev ? { ...prev, pipeline_url: value.pipeline_url } : prev)
        setNotice('已保存流水线地址')
      } catch (reason) {
        setError(reason.message)
      } finally {
        setWorking(false)
      }
    }

    const filteredTasks = includableTasks.filter(task =>
      `${task.name || ''} ${analysisLabel(task.run_id)} ${(task.repo_ids || []).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))

    return h('section', { className: 'pangea-injection-panel is-standalone', 'data-testid': 'fault-injection-build' },
      h('style', null, PANEL_CSS),
      error ? h('div', { role: 'alert', className: 'pangea-fi-banner danger' }, h('span', null, error)) : null,
      notice ? h('div', { role: 'status', className: 'pangea-fi-banner good' }, h('span', null, notice)) : null,
      h('div', { className: 'pangea-fi-task-card' },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 } },
          h('div', null,
            h('h3', { style: { margin: 0 } }, '合成打桩补丁并推送个人分支'),
            h('p', { className: 'b05-subtle', style: { margin: '4px 0 0', fontSize: 13 } },
              '每次出包从分析目录当前 HEAD 干净合成所选打桩任务：勾上的进入个人分支，取消勾选的自动不包含；不触碰分析目录工作区，不使用强推。')),
          onBack ? h('button', { type: 'button', onClick: onBack }, '返回打桩任务列表') : null),

        h('h4', null, `1. 选择纳入本次出包的打桩任务（已选 ${selectedTasks.length} / 可用 ${includableTasks.length}）`),
        h('div', { className: 'pangea-fi-toolbar', style: { marginBottom: 12 } },
          h('input', { type: 'search', 'aria-label': '搜索可出包任务', placeholder: '搜索任务名称、分析任务或仓库…', value: query, onChange: event => setQuery(event.target.value) }),
          includableTasks.length ? h('button', { type: 'button', disabled: working || buildRunning || selectedTasks.length === includableTasks.length, onClick: () => setSelectedKeys(includableTasks.map(t => itemKey(t.run_id, t.id))) }, `全选可用（${includableTasks.length}）`) : null,
          defaultForRepoSet.length ? h('button', { type: 'button', disabled: working || buildRunning, onClick: () => setSelectedKeys(defaultForRepoSet.map(i => itemKey(i.run_id, i.task_id))) }, `恢复上次已推送勾选（${defaultForRepoSet.length}）`) : null,
          selectedTasks.length ? h('button', { type: 'button', disabled: working || buildRunning, onClick: () => setSelectedKeys([]) }, '清空勾选') : null),

        !includableTasks.length
          ? h('p', { role: 'status', className: 'b05-subtle' }, '当前没有就绪的打桩任务。请先新建打桩任务并等待补丁生成完成。')
          : h('table', { className: 'pangea-fi-table', 'aria-label': '可出包打桩任务列表' },
              h('thead', null, h('tr', null, ...['选择', '打桩任务', '分析任务', '规模', '源码基线对比', '创建时间'].map(label => h('th', { key: label }, label)))),
              h('tbody', null, filteredTasks.map(task => {
                const key = itemKey(task.run_id, task.id)
                const checked = selectedSet.has(key)
                const baselineNotes = (task.repo_ids || []).map(repoId => {
                  const headSha = repoMap.get(repoId)?.source?.commit || ''
                  const genSha = task.base_commits?.[repoId] || ''
                  const anaSha = task.analysis_commits?.[repoId] || ''
                  const parts = [`${repoId}: 生成 ${genSha ? genSha.slice(0, 8) : '未知'}`]
                  if (headSha && genSha && headSha !== genSha) parts.push(`当前 HEAD ${headSha.slice(0, 8)}`)
                  if (headSha && anaSha && headSha !== anaSha) parts.push(`分析快照 ${anaSha.slice(0, 8)} ≠ 当前 HEAD`)
                  return parts.join(' · ')
                })
                return h('tr', { key },
                  h('td', null, h('input', {
                    type: 'checkbox',
                    'aria-label': `勾选出包任务 ${task.name || task.id}`,
                    checked,
                    disabled: working || buildRunning,
                    onChange: event => setSelectedKeys(prev => event.target.checked ? [...new Set([...prev, key])] : prev.filter(item => item !== key)),
                  })),
                  h('td', null, onOpenTask
                    ? h('button', { type: 'button', className: 'link-btn', onClick: () => onOpenTask({ run_id: task.run_id, id: task.id }) }, task.name || '打桩任务')
                    : (task.name || '打桩任务')),
                  h('td', null, analysisLabel(task.run_id)),
                  h('td', null, `${task.case_count ?? 0} 用例 · ${task.point_count ?? 0} 桩点`),
                  h('td', null, baselineNotes.map((line, idx) => h('div', { key: idx, style: { fontSize: 12, color: '#5e6773' } }, line))),
                  h('td', null, task.created_at ? new Date(task.created_at).toLocaleString() : ''))
              }))),

        h('h4', null, '2. 目标仓库与基线检查'),
        blockingErrors.length ? h('div', { role: 'alert', className: 'pangea-fi-banner danger' },
          h('div', null, blockingErrors.map((msg, idx) => h('p', { key: idx, style: { margin: idx ? '4px 0 0' : 0 } }, msg))),
          h('button', { type: 'button', onClick: () => setRepoSetupOpen(true) }, '打开仓库配置')) : null,
        headInjectionNotices.length ? h('div', { role: 'status', className: 'pangea-fi-banner warn', style: { display: 'block' } },
          headInjectionNotices.map((msg, idx) => h('p', { key: idx, style: { margin: idx ? '4px 0 0' : 0 } }, msg))) : null,
        dirtyRepos.length ? h('div', { role: 'status', className: 'pangea-fi-banner info' },
          h('span', null, `${dirtyRepos.map(r => r.repo_id).join('、')} 分析目录存在未提交修改；合成基线仅读取当前 HEAD 提交，不触碰分析目录工作区。`)) : null,
        shownRepos.map(repo => h('div', { key: repo.repo_id, className: 'pangea-fi-repo-box', style: { fontSize: 13 } },
          h('strong', null, repo.repo_id),
          h('span', { style: { marginLeft: 10, color: '#5e6773' } }, `当前基线：${sourceLabel(repo.source)} · 远端 ${repo.remote} · 个人分支 `, h('code', null, repo.personal_branch || '未配置')))),
        h('details', { className: 'pangea-fi-technical', open: blockingErrors.length > 0 || repoSetupOpen || undefined },
          h('summary', null, '仓库与个人分支配置'),
          h(RepositorySettings, {
            cwd,
            dataRoot,
            defaultOpen: blockingErrors.length > 0 || repoSetupOpen,
            repositories: context.repositories || [],
            onSaved: async () => { await loadContext({ preserveSelection: true }) },
          })),

        selectedTasks.length ? (() => {
          const merged = mergeReplaceFilesFromTasks(selectedTasks)
          if (!merged.replace_files.length && !merged.marker_strings.length) return null
          const verifyInfo = buildArtifactVerifyCommands({ replace_files: merged.replace_files, marker_strings: merged.marker_strings, build_variant: selectedTasks[0]?.build_variant })
          const copyText = async (text, okMsg) => {
            try { await navigator.clipboard.writeText(text); setNotice(okMsg) }
            catch { setError('复制失败，请手动选中复制') }
          }
          return h('section', { className: 'pangea-fi-repo-box', style: { marginTop: 12, borderColor: '#cfe0ee', background: '#fbfdff' }, 'data-testid': 'fault-injection-build-replace-files' },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 8 } },
              h('strong', null, `本次出包汇总：应单独替换的文件（${merged.replace_files.length} 个产物）`),
              h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
                merged.replace_files.length ? h('button', { type: 'button', style: { minHeight: 30, padding: '3px 10px', fontSize: 12 }, onClick: () => copyText(merged.replace_files.map(item => item.artifact).join('\n'), '已复制本次出包应替换文件清单') }, '复制文件清单') : null,
                verifyInfo.pre_replace_cmd ? h('button', { type: 'button', style: { minHeight: 30, padding: '3px 10px', fontSize: 12, marginLeft: 0 }, onClick: () => copyText(verifyInfo.pre_replace_cmd, '已复制汇总验库命令') }, '复制验库命令') : null)),
            merged.replace_files.length ? h('table', { className: 'pangea-fi-table', 'aria-label': '本次出包应单独替换文件清单' },
              h('thead', null, h('tr', null, ...['应替换文件 / 产物', '类型', '来源任务', '对应修改源码', '替换后动作'].map(label => h('th', { key: label }, label)))),
              h('tbody', null, merged.replace_files.map((item, idx) => h('tr', { key: `${item.artifact}:${idx}` },
                h('td', null, h('code', { style: { fontWeight: 600 } }, item.artifact)),
                h('td', null, ARTIFACT_KIND_LABELS[item.kind] || item.kind),
                h('td', null, (item.task_names || []).join('、') || '—'),
                h('td', null, item.source_files.map((src, sIdx) => h('div', { key: sIdx }, h('code', null, src)))),
                h('td', null, item.post_replace_action || '—'))))) : null)
        })() : null,

        h('h4', null, '3. 提交门禁信息与构建流水线'),
        h('div', { className: 'pangea-fi-repo-box' },
          showRemoteGateHelper ? h('div', { role: 'status', className: 'pangea-fi-banner warn', style: { marginTop: 0 } },
            h('span', null, '检测到远端 pre-receive 提交门禁规则，可一键载入规则并在原地修正提交说明（无需重新调用模型）。'),
            h('button', { type: 'button', className: 'primary', disabled: working || buildRunning, onClick: () => setCommitDraft(previous => ({ ...previous, mode: 'template', explicit_default_mode: false, template: previous.template || MULTILINE_GATE_COMMIT_TEMPLATE, pattern: targetGateRegex })) }, '按远端门禁规则填写')) : null,
          h('label', { className: 'pangea-fi-field' }, h('span', null, '提交信息格式'),
            h('select', { 'aria-label': '提交信息格式', value: effectiveCommitConfig.mode, disabled: working || buildRunning, onChange: event => {
              const nextMode = event.target.value
              setCommitDraft(previous => ({
                ...previous,
                mode: nextMode,
                explicit_default_mode: nextMode === 'default',
                pattern: nextMode === 'template'
                  ? (previous.pattern || targetGateRegex)
                  : (previous.pattern === DEFAULT_INTRANET_COMMIT_REGEX || previous.pattern === remoteHookRegex ? '' : previous.pattern),
              }))
            } },
              h('option', { value: 'template' }, '项目门禁模板（问题单号 / 修改人 / 审核人 / 修改说明）'),
              h('option', { value: 'default' }, '默认简要格式（仅无门禁钩子仓库）'))),
          effectiveCommitConfig.mode === 'template' ? h(React.Fragment, null,
            h('div', { style: grid },
              field('问题单号', effectiveCommitConfig.issue, value => setCommitDraft(previous => ({ ...previous, issue: value })), { placeholder: '如 DTS2026111111059 / AR... / SR...（多个用分号分隔）' }),
              field('修改人', effectiveCommitConfig.author, value => setCommitDraft(previous => ({ ...previous, author: value })), { placeholder: '工号或姓名（如 h00600350）' }),
              field('审核人', effectiveCommitConfig.reviewer, value => setCommitDraft(previous => ({ ...previous, reviewer: value })), { placeholder: '检视人工号或姓名' })),
            field('修改说明', effectiveCommitConfig.summary, value => setCommitDraft(previous => ({ ...previous, summary: value })), { placeholder: '简要说明本次合成打桩内容（单行）' }),
            h('details', { style: { marginBottom: 10 } },
              h('summary', { style: { fontSize: 12 } }, '自定义模板与本地正则预检（兼容单行 / 多行 pre-receive 钩子）'),
              h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, margin: '6px 0 8px' } },
                h('button', { type: 'button', disabled: working || buildRunning, onClick: () => setCommitDraft(previous => ({ ...previous, template: MULTILINE_GATE_COMMIT_TEMPLATE })) }, '使用多行门禁模板'),
                h('button', { type: 'button', style: { marginLeft: 0 }, disabled: working || buildRunning, onClick: () => setCommitDraft(previous => ({ ...previous, template: SINGLELINE_GATE_COMMIT_TEMPLATE })) }, '使用单行门禁模板'),
                h('button', { type: 'button', style: { marginLeft: 0 }, disabled: working || buildRunning, onClick: () => setCommitDraft(previous => ({ ...previous, pattern: DEFAULT_INTRANET_COMMIT_REGEX })) }, '填入默认门禁正则'),
                effectiveCommitConfig.pattern ? h('button', { type: 'button', style: { marginLeft: 0 }, disabled: working || buildRunning, onClick: () => setCommitDraft(previous => ({ ...previous, pattern: '' })) }, '清空预检正则') : null),
              field('提交信息模板', effectiveCommitConfig.template, value => setCommitDraft(previous => ({ ...previous, template: value })), { multiline: true }),
              field('本地预检正则', effectiveCommitConfig.pattern, value => setCommitDraft(previous => ({ ...previous, pattern: value })), { placeholder: '可选：粘贴项目钩子正则进行推送前校验' })),
            h('pre', { 'aria-label': '提交信息预览', style: { whiteSpace: 'pre-wrap', margin: '6px 0', padding: '8px 10px', borderRadius: 6, background: '#f8f9fb', border: '1px solid #e2e6ec', fontSize: 12 } }, commitCheck.message || ''))
            : field('提交信息', effectiveCommitConfig.custom_message, value => setCommitDraft(previous => ({ ...previous, custom_message: value })), { placeholder: '可选：留空使用默认合成打桩提交说明' }),
          !commitCheck.ok ? h('p', { role: 'alert', style: { fontSize: 12, color: '#9c2330', margin: '6px 0 0' } }, commitCheck.error) : null,
          field('构建流水线 URL', pipelineUrl, setPipelineUrl, { placeholder: '例如 https://ci.example.internal/pipeline/...' }),
          pipelineDirty && activeBuild?.status === 'pushed' ? h('div', { style: { marginBottom: 10 } },
            h('p', { role: 'status', style: { fontSize: 12, color: '#8c5a12', margin: '0 0 6px' } }, '流水线地址已更改，请先点击“保存流水线地址”后再打开流水线。'),
            h('button', { type: 'button', className: 'primary', disabled: working, onClick: savePipeline }, '保存流水线地址')) : null,
          h('div', { style: { marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 } },
            h('button', {
              type: 'button',
              className: 'btn primary',
              disabled: working || buildRunning || !selectedTasks.length || blockingErrors.length > 0 || !commitCheck.ok,
              onClick: () => startBuild(),
            }, buildRunning ? (BUILD_STATUS_LABELS[activeBuild?.status] || '正在出包…') : `合成并推送到个人分支（${selectedTasks.length} 个任务）`),
            restoreTargetRepos.length ? h('button', {
              type: 'button',
              style: { marginLeft: 0 },
              disabled: working || buildRunning || restoreBlockingErrors.length > 0 || !restoreCommitCheck.ok,
              onClick: () => startBuild({ restoreBaseline: true }),
            }, '恢复干净基线（清空打桩）') : null,
            canRetryActiveBuild ? h('button', {
              type: 'button',
              style: { marginLeft: 0 },
              disabled: working || buildRunning || !commitCheck.ok,
              onClick: () => startBuild({ retryId: activeBuild.id }),
            }, '重试本次出包') : null,
            buildRunning ? h('button', { type: 'button', style: { marginLeft: 0 }, disabled: working, onClick: cancelActive }, '停止本次出包') : null)),

        activeBuild ? h('section', { className: 'pangea-fi-build', style: { marginTop: 16 }, 'data-testid': 'fault-injection-build-result' },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' } },
            h('div', null,
              h('h3', { style: { margin: 0 } }, activeBuild.restore_baseline ? '最近一次基线恢复结果' : '最近一次合成出包结果'),
              h('p', { className: 'b05-subtle', style: { margin: '4px 0 0', fontSize: 12 } },
                `${activeBuild.restore_baseline ? '恢复干净基线（清空打桩）' : `包含 ${(activeBuild.items || []).length} 个打桩任务`}${activeBuild.created_at ? ` · ${new Date(activeBuild.created_at).toLocaleString()}` : ''}`)),
            h('span', { role: 'status', className: `pangea-fi-status-pill ${statusTone(activeBuild.status)}` }, BUILD_STATUS_LABELS[activeBuild.status] || activeBuild.status)),
          activeBuild.status === 'pushing' && activeBuild.current_repository ? h('p', { className: 'pangea-fi-banner info' }, `正在推送仓库：${activeBuild.current_repository}`) : null,
          activeBuild.error ? h('div', { role: 'alert', className: 'pangea-fi-banner danger', style: { display: 'block' } },
            h('p', { style: { margin: 0, fontWeight: 600 } }, hasPatchFailures ? '部分打桩补丁与当前 HEAD 失配，本次未提交且未推送。' : activeBuild.remote_diverged_commits?.length ? '远端分支存在非 PANGEA 打桩提交，已拦截覆盖推送。' : '本次出包未完成。'),
            h('details', { open: true }, h('summary', null, '查看错误详情'), h('pre', { style: { whiteSpace: 'pre-wrap', margin: '6px 0 0' } }, activeBuild.error)),
            activeBuild.remote_diverged_commits?.length && canRetryActiveBuild ? h('div', { style: { marginTop: 10 } },
              h('button', { type: 'button', className: 'primary', disabled: working || buildRunning || !commitCheck.ok, onClick: () => startBuild({ retryId: activeBuild.id, allowOverwriteRemoteDiverged: true }) }, '确认覆盖远端非打桩提交并重新推送')) : null) : null,
          Array.isArray(activeBuild.notices) && activeBuild.notices.length ? h('div', { role: 'status', className: 'pangea-fi-banner warn', style: { display: 'block' } },
            activeBuild.notices.map((msg, idx) => h('p', { key: idx, style: { margin: idx ? '4px 0 0' : 0 } }, msg))) : null,
          (activeBuild.repositories || []).map(repo => h('div', { key: repo.repo_id, className: 'pangea-fi-repo-box', style: { fontSize: 13 } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 } },
              h('strong', null, `${repo.repo_id} → ${repo.remote}/${repo.remote_branch}`),
              h('span', { style: { color: repo.pushed ? '#20765a' : repo.failures?.length ? '#9c2330' : '#5e6773', fontWeight: 600 } },
                repo.pushed ? (repo.push_result === 'unchanged' ? '远端分支内容已一致（无需新提交）' : '已推送') : repo.failures?.length ? '补丁失配' : '待推送')),
            h('p', { style: { fontSize: 12, color: '#5e6773', margin: '4px 0' } },
              '合成基线：', h('code', null, repo.base_commit || '待读取'),
              repo.commit ? h(React.Fragment, null, ' · 个人分支提交：', h('code', null, repo.commit)) : null),
            repo.applied?.length ? h('p', { style: { fontSize: 12, margin: '4px 0' } },
              `已合成补丁（${repo.applied.length}）：`,
              repo.applied.map(item => `${item.name}（${(item.files || []).join(', ')}）`).join('；')) : null,
            (repo.failures || []).map((failure, idx) => h('div', { key: `${failure.task_id}:${idx}`, className: 'pangea-fi-banner danger', style: { margin: '8px 0 0' } },
              h('div', null,
                h('strong', null, `任务「${failure.name}」失配：`),
                h('span', null, failure.error)),
              onOpenTask ? h('button', { type: 'button', onClick: () => onOpenTask({ run_id: failure.run_id, id: failure.task_id }) }, '打开任务重新生成') : null)))),
          activeBuild.status === 'pushed' ? h('div', { style: { marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 } },
            h('button', {
              type: 'button',
              className: 'btn primary',
              disabled: working || !savedPipelineUrl || pipelineDirty,
              onClick: async () => {
                try {
                  if (!onOpenPipeline) throw new Error('当前会话的 DSH 浏览器不可用')
                  await onOpenPipeline(savedPipelineUrl)
                } catch (reason) {
                  setError(reason.message)
                }
              },
            }, '在 DSH 浏览器打开构建流水线'),
            h('button', {
              type: 'button',
              style: { marginLeft: 0 },
              onClick: async () => {
                const branches = [...new Set((activeBuild.repositories || []).map(r => r.personal_branch).filter(Boolean))].join('、')
                try { await navigator.clipboard.writeText(branches); setNotice(`已复制个人分支：${branches}`) }
                catch { setError('复制失败，请手动复制上方个人分支名称') }
              },
            }, '复制个人分支')) : null) : null,

        (context.builds || []).length > 1 ? h('details', { style: { marginTop: 14 } },
          h('summary', null, `历史出包记录（${context.builds.length}）`),
          h('ul', { className: 'pangea-fi-records pangea-fi-scroll' }, context.builds.map(b => h('li', { key: b.id },
            h('button', { type: 'button', className: 'link-btn', onClick: () => setActiveBuild(b) },
              `${b.created_at ? new Date(b.created_at).toLocaleString() : b.id} · ${BUILD_STATUS_LABELS[b.status] || b.status} · ${b.restore_baseline ? '恢复干净基线（清空打桩）' : ((b.items || []).map(i => i.name).join('、') || b.id)}`))))) : null),
    )
  }
}
