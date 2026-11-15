import { createRepositorySettings, sourceLabel } from './repository-settings-view.js'
export const INJECTION_STATUS_LABELS = {
  preparing: '准备源码', generating: '生成打桩修改', ready: '修改已生成', pushing: '正在推送',
  pushed: '个人分支已推送', failed: '生成失败', cancelled: '已停止', interrupted: '操作已中断',
}
const readable = value => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2)

export function createFaultInjectionPanel(React) {
  const h = React.createElement
  const RepositorySettings = createRepositorySettings(React)
  const busy = task => ['preparing', 'generating', 'pushing'].includes(task?.status)
  return function FaultInjectionPanel({ runId, dataRoot, cwd, onOpenPipeline, cases = [] }) {
    const [open, setOpen] = React.useState(false)
    const [profileKey, setProfileKey] = React.useState('')
    const [tasks, setTasks] = React.useState([])
    const [taskId, setTaskId] = React.useState('')
    const [settings, setSettings] = React.useState(null)
    const [providers, setProviders] = React.useState([])
    const [pipelineUrl, setPipelineUrl] = React.useState('')
    const drafts = React.useRef({})
    const [notice, setNotice] = React.useState('')
    const [error, setError] = React.useState('')
    const [working, setWorking] = React.useState(false)
    const [build, setBuild] = React.useState({ url: '', package_id: '', package_sha256: '', notes: '' })
    const [verification, setVerification] = React.useState({ case_key: '', result: 'not_run', hits: '', notes: '' })
    const selectedKeys = cases.map(item => item.projection_id || item.test_case_id).filter(Boolean)
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
        setTasks(value.tasks ?? []);
        if (!taskId) { try { const last = localStorage.getItem(`pangea-fi:${scope}`); if (value.tasks?.some(item => item.id === last)) setTaskId(last) } catch {} }
        setProviders(value.providers ?? [])
        setSettings(previous => previous ?? { ...value.defaults, branch_prefix: 'pangea-fi', instructions: '' })
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
      try { const value = await request({ action, task_id: taskId, ...extra }); remember(value.task); if (['configure', 'verify'].includes(action)) setNotice('已保存'); if (action === 'configure') setSettings(previous => ({ ...previous, pipeline_url: value.pipeline_url })) }
      catch (reason) { setError(reason.message) }
      finally { setWorking(false) }
    }
    const field = (label, value, change, options = {}) => h('label', { style: { display: 'grid', gap: 5, marginBottom: 10 } }, label,
      h(options.multiline ? 'textarea' : 'input', { 'aria-label': label, value: readable(value), onChange: event => change(event.target.value),
        disabled: working, ...(options.multiline ? { rows: 3 } : { type: 'text' }), style: { width: '100%', boxSizing: 'border-box' } }))
    const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 14 }
    const renderPoints = points => Array.isArray(points) ? points.map((point, index) => h('details', { key: point.id || index, className: 'pangea-fi-point' },
      h('summary', null, `${readable(point.id)} · ${readable(point.action) || '桩点说明'}`),
      h('p', { className: 'b05-subtle' }, `${readable(point.repo_id)}:${readable(point.path)}`),
      h('dl', { className: 'pangea-reading-fields' }, ...[['symbol', '代码位置'], ['action', '注入动作'], ['trigger', '触发条件'], ['times', '触发次数'], ['enable', '启用方式'], ['disable', '关闭方式'], ['observe', '命中检查'], ['cleanup', '恢复操作'], ['depends_on', '依赖桩点'], ['exclusive_with', '互斥桩点']].flatMap(([key, label]) => point[key] == null || (Array.isArray(point[key]) && !point[key].length) ? [] : [h('dt', { key: `${key}-label` }, label), h('dd', { key, style: { whiteSpace: 'pre-wrap' } }, Array.isArray(point[key]) ? point[key].map(readable).join('、') : readable(point[key]))])))) : null
    const candidates = cases.filter(item => item.instrumentation || item.source_record?.body?.instrumentation)
    return h('section', { className: 'b05-card pangea-injection-panel', 'data-testid': 'fault-injection-panel' },
      h('style', null, `
        .pangea-injection-panel { min-width:0; font-size:12px; }
        .pangea-injection-panel .pangea-fi-workspace { max-height:70vh; overflow:auto; overscroll-behavior:contain; scrollbar-gutter:stable; padding-right:8px; }
        .pangea-injection-panel .pangea-fi-workspace > * { min-width:0; }
        .pangea-injection-panel details { border-top:1px solid #e7ebe5; margin-top:6px; }
        .pangea-injection-panel .pangea-fi-workspace > section.b05-card { padding:0; border:0; margin:8px 0; }
        .pangea-injection-panel .pangea-fi-build { padding:10px 12px; }
        .pangea-injection-panel button + button { margin-left:8px; }
        .pangea-injection-panel summary { cursor:pointer; padding:7px 0; font-weight:500; }
        .pangea-injection-panel p { margin:8px 0; overflow-wrap:anywhere; }
        .pangea-injection-panel h3 { font-size:14px; margin:8px 0; }
        .pangea-injection-panel .pangea-fi-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
        .pangea-injection-panel input:not([type=checkbox]), .pangea-injection-panel select, .pangea-injection-panel textarea { font:inherit; min-width:0; max-width:100%; padding:7px 9px; border:1px solid #dfe5dc; border-radius:6px; background:#fff; color:inherit; }
        .pangea-injection-panel label > select { display:block; width:100%; margin-top:5px; }
        .pangea-injection-panel button { font:inherit; padding:7px 11px; border:1px solid #dfe5dc; border-radius:6px; background:#fff; color:#566051; cursor:pointer; }
        .pangea-injection-panel button.primary { background:#27372d; border-color:#27372d; color:#fff; }
        .pangea-injection-panel button:disabled { opacity:.5; cursor:default; }
        .pangea-injection-panel .pangea-fi-scroll { max-height:340px; overflow:auto; overflow-wrap:anywhere; }
        .pangea-injection-panel .pangea-fi-steps { white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.65; padding-left:24px; }
        .pangea-injection-panel .pangea-fi-steps li { padding:6px 0; }
        .pangea-injection-panel .pangea-fi-records { list-style:none; padding:0; }
        .pangea-injection-panel .pangea-fi-records > li { padding:10px 0; border-top:1px solid #e7ebe5; }
        .pangea-injection-panel .pangea-fi-records pre { white-space:pre-wrap; font:inherit; }
        .pangea-injection-panel .pangea-reading-fields dd { overflow-wrap:anywhere; }
        @media(max-width:640px) { .pangea-injection-panel .b05-head-actions { flex-wrap:wrap; } .pangea-injection-panel .pangea-fi-workspace { max-height:75vh; } }
      `),
      h('div', { className: 'b05-head-actions', style: { justifyContent: 'space-between' } },
        h('div', null, h('strong', null, '打桩与个人分支'), h('p', { className: 'b05-subtle' }, selectedKeys.length ? `已选择 ${selectedKeys.length} 条用例，可一起生成打桩修改。` : '选择用例生成打桩修改，或查看已有打桩任务。')),
        h('button', { type: 'button', className: 'btn', 'aria-expanded': open, onClick: () => setOpen(value => !value) }, open ? '收起打桩' : '打开打桩工作区')),
      open ? h('div', { className: 'pangea-fi-workspace', role: 'region', 'aria-label': '打桩任务详情', tabIndex: 0 },
        error ? h('p', { role: 'alert' }, error) : null,
        notice ? h('p', { role: 'status' }, notice) : null,
        h(RepositorySettings, { cwd, dataRoot, repositories: settings?.repositories || [], onSaved: async () => { const value = await request(); setSettings(previous => ({ ...previous, ...value.defaults, baseline_acknowledged: false })) } }),
        candidates.length ? h('details', null, h('summary', null, '分析中记录的桩点'), candidates.map(item => h('div', { key: item.projection_id || item.test_case_id },
          h('strong', null, readable(item.title)), renderPoints((item.instrumentation || item.source_record.body.instrumentation)?.points)))) : null,
        settings ? h('details', { open: !task }, h('summary', null, task ? '为当前选择创建新任务' : '生成新的打桩修改'),
          h('details', null, h('summary', null, `已选择 ${selectedKeys.length} 条用例`), h('p', { className: 'pangea-fi-scroll' }, cases.map(item => readable(item.title)).join('、') || '请先在用例列表选择用例')),
          h('div', { style: { marginTop: 14 } },
            h('div', { style: grid },
              h('label', null, '执行器', h('select', { 'aria-label': '打桩执行器', value: settings.provider_id, disabled: working, onChange: event => setSettings({ ...settings, provider_id: event.target.value }) },
                h('option', { value: '' }, '选择执行器'), providers.map(provider => h('option', { key: provider.id, value: provider.id }, provider.label)))),
              field('打桩模型', settings.agent_model, value => setSettings({ ...settings, agent_model: value })),
              field('任务名称', settings.name, value => setSettings({ ...settings, name: value })),
              field('个人分支前缀', settings.branch_prefix, value => setSettings({ ...settings, branch_prefix: value }))),
            (settings.repositories ?? []).map((repo, index) => h('fieldset', { key: repo.repo_id, style: { margin: '10px 0', padding: 14, border: '1px solid #d8dee9', borderRadius: 8 } },
              h('p', null, sourceLabel(repo.source)),
              repo.comparison?.changed_count ? h('p', { role: 'status' }, `分析快照与所选提交有 ${repo.comparison.changed_count} 个文件不同：${repo.comparison.files.join('、')}`) : null,
              repo.comparison?.error ? h('p', { role: 'alert' }, repo.comparison.error) : null,
              repo.source?.kind === 'git' && !repo.comparison?.available && !repo.comparison?.error ? h('p', null, '本次分析未提供可比较的源码快照，当前仅展示 Git 状态。') : null,
              h('legend', null, h('label', null, h('input', { type: 'checkbox', checked: repo.enabled !== false, 'aria-label': `本次包含 ${repo.repo_id}`, disabled: working,
                onChange: event => setSettings({ ...settings, repositories: settings.repositories.map((item, at) => at === index ? { ...item, enabled: event.target.checked } : item) }) }), ' ', readable(repo.repo_id))), h('div', { style: grid },
                ...[['source_path', 'Git 仓库目录'], ['base_ref', '源码基线（提交或本地分支）'], ['remote', '推送远端']].map(([key, label]) => field(`${repo.repo_id} · ${label}`, repo[key], value => setSettings({ ...settings, baseline_acknowledged: false, repositories: settings.repositories.map((item, at) => at === index ? { ...item, [key]: value } : item) })))))),
            h('button', { type: 'button', disabled: working, onClick: async () => { setWorking(true); setError(''); try { const value = await request({ action: 'preview-baseline', repositories: settings.repositories }); setSettings(previous => ({ ...previous, repositories: value.repositories, baseline_acknowledged: false })); setNotice('基线已核对，请查看各仓库的快照差异') } catch (reason) { setError(reason.message) } finally { setWorking(false) } } }, '核对打桩基线'),
            h('label', null, h('input', { type: 'checkbox', 'aria-label': '使用所选 Git 提交作为打桩基线', checked: Boolean(settings.baseline_acknowledged), onChange: event => setSettings({ ...settings, baseline_acknowledged: event.target.checked }) }), ' 使用所选 Git 提交作为打桩基线；未提交修改不带入个人分支'),
            field('构建流水线 URL', settings.pipeline_url, value => setSettings({ ...settings, pipeline_url: value })),
            settings.repositories.some(repo => repo.enabled !== false && repo.source?.kind !== 'git') ? h('p', { role: 'status' }, '所选源码尚未就绪：请在“代码仓库与构建”关联 Git 仓库，或填写有效目录后点击“核对打桩基线”。普通分析不受影响。') : null,
            field('补充说明', settings.instructions, value => setSettings({ ...settings, instructions: value }), { multiline: true }),
            h('button', { type: 'button', className: 'btn primary', disabled: working || !selectedKeys.length || !settings.repositories.some(repo => repo.enabled !== false) || settings.repositories.some(repo => repo.enabled !== false && repo.source?.kind !== 'git'),
              onClick: () => act('generate', { ...settings, repositories: settings.repositories.filter(repo => repo.enabled !== false), case_keys: selectedKeys }) }, working ? '正在提交…' : `生成打桩修改（${selectedKeys.length} 条用例）`)))
          : h('p', null, '正在读取打桩设置…'),
        tasks.length ? h('div', { style: { marginTop: 18 } }, h('label', null, '已有打桩任务 ', h('select', { 'aria-label': '已有打桩任务', value: taskId, onChange: event => selectTask(event.target.value) },
          h('option', { value: '' }, '选择任务查看'), tasks.map(item => h('option', { key: item.id, value: item.id }, `${item.name || item.cases?.[0]?.title || '打桩任务'} · ${new Date(item.created_at).toLocaleString()} · ${item.case_keys.length} 条 · ${INJECTION_STATUS_LABELS[item.status] || item.status}`))))) : null,
        task ? h('div', { style: { marginTop: 16 } },
          h('p', { role: 'status' }, h('strong', null, INJECTION_STATUS_LABELS[task.status] || task.status)),
          task.error ? h('p', { role: 'alert', style: { whiteSpace: 'pre-wrap' } }, task.error) : null,
          busy(task) ? h('button', { type: 'button', className: 'btn', disabled: working, onClick: () => act('cancel') }, '停止本次操作') : null,
          h('h3', null, `正在查看：${task.name || task.cases?.[0]?.title || '打桩任务'}`),
          task.status === 'pushing' && task.current_repository ? h('p', null, `正在推送：${task.current_repository}`) : null,
          ['failed', 'cancelled', 'interrupted'].includes(task.status) && !task.generation_complete ? h('button', { type: 'button', disabled: working, onClick: () => act('retry') }, '沿用本任务配置重新生成') : null,
          h('p', { className: 'b05-subtle' }, `${task.case_keys.length} 条用例 · ${task.result?.points?.length || 0} 个桩点 · 最新记录 ${passedCount}/${task.case_keys.length} 通过`),
          h('p', null, '个人分支：', h('code', null, task.branch)),
          ['ready', 'interrupted'].includes(task.status) && task.generation_complete ? h('button', { type: 'button', className: 'btn primary', style: { marginTop: 14 }, disabled: working, onClick: () => act('push') }, working ? '正在推送…' : '推送个人分支') : null,
          task.status === 'pushed' ? h('section', { className: 'b05-card pangea-fi-build', style: { marginTop: 10 } },
            h('h3', null, '构建个人包'),
            h('details', { open: !task.pipeline_url }, h('summary', null, '流水线设置'), field('本任务流水线 URL', pipelineUrl, setPipelineUrl),
              h('button', { type: 'button', disabled: working, onClick: () => act('configure', { pipeline_url: pipelineUrl }) }, '保存流水线地址')),
            h('button', { type: 'button', className: 'btn primary', disabled: working || !task.pipeline_url || pipelineUrl.trim() !== task.pipeline_url,
              onClick: async () => { try { if (!onOpenPipeline) throw new Error('当前会话的 DSH 浏览器不可用'); await onOpenPipeline(task.pipeline_url) } catch (reason) { setError(reason.message) } } }, '在 DSH 浏览器打开构建流水线'),
            h('button', { type: 'button', onClick: async () => { try { await navigator.clipboard.writeText(task.branch) } catch { setError('复制失败，请复制上方个人分支名称') } } }, '复制个人分支'),
            h('p', { className: 'b05-subtle' }, '使用上方个人分支出包，在验证记录中关联构建结果。')) : null,
          task.repositories.some(repo => repo.commit) ? h('details', { key: `verification:${task.id}`, style: { marginTop: 12 } }, h('summary', null, '构建包与验证记录'),
            h('p', { className: 'b05-subtle' }, '在已有流水线选择上面的个人分支或修改提交出包；烧包测试后，在这里记录结果。'),
            h('div', { style: grid }, field('构建链接', build.url, value => setBuild({ ...build, url: value })), field('个人包名称或版本', build.package_id, value => setBuild({ ...build, package_id: value })), field('包 SHA256（可选）', build.package_sha256, value => setBuild({ ...build, package_sha256: value }))),
            h('div', { style: grid }, h('label', null, '验证用例', h('select', { 'aria-label': '验证用例', value: verification.case_key, onChange: event => {
                drafts.current[`${taskId}:${verification.case_key}`] = verification
                const key = event.target.value
                setVerification(drafts.current[`${taskId}:${key}`] ?? { result: 'not_run', hits: '', notes: '', ...task.verification.filter(item => item.case_key === key).at(-1), case_key: key })
              } }, task.cases.map(item => h('option', { key: item.case_key, value: item.case_key }, readable(item.title))))),
              h('label', null, '实际结果', h('select', { 'aria-label': '实际结果', value: verification.result, onChange: event => setVerification({ ...verification, result: event.target.value }) }, [['not_run', '未执行'], ['passed', '通过'], ['failed', '失败'], ['not_triggered', '目标故障未触发']].map(([value, label]) => h('option', { key: value, value }, label)))),
              field('桩点实际命中', verification.hits, value => setVerification({ ...verification, hits: value }))),
            field('验证现象与记录', verification.notes, value => setVerification({ ...verification, notes: value }), { multiline: true }),
            h('button', { type: 'button', className: 'btn', disabled: working || busy(task), onClick: () => act('verify', { build, verification }) }, '保存构建与验证记录'),
            task.verification.length ? h('ul', { className: 'pangea-fi-records pangea-fi-scroll', 'aria-label': '验证历史' }, [...task.verification].reverse().map((value, index) => h('li', { key: index }, `${value.at} · ${readable(task.cases.find(item => item.case_key === value.case_key)?.title || value.case_key)} · ${({ passed: '通过', failed: '失败', not_triggered: '目标故障未触发', not_run: '未执行' })[value.result]} · ${value.hits}`,
              value.notes ? h('details', null, h('summary', null, '查看验证记录'), h('pre', null, value.notes)) : null,
              h('p', { className: 'b05-subtle' }, `验证包：${value.build?.package_id || '未填写'}；提交：${(value.build?.commits || []).map(repo => `${repo.repo_id} ${repo.commit.slice(0, 12)}`).join('、')}`),
              value.build?.url ? h('a', { href: value.build.url, target: '_blank', rel: 'noreferrer' }, '查看本次构建') : null))) : null) : null,
          task.result?.summary ? h('details', null, h('summary', null, '修改摘要与用例'), h('div', { className: 'pangea-fi-scroll' }, h('p', { style: { whiteSpace: 'pre-wrap' } }, readable(task.result.summary)), h('p', null, task.cases.map(item => readable(item.title)).join('、')))) : null,
          task.result?.points?.length ? h('details', null, h('summary', null, `桩点说明（${task.result.points.length}）`), h('div', { className: 'pangea-fi-scroll' }, renderPoints(task.result.points))) : null,
          profiles.length ? h('details', { key: `profiles:${task.id}` }, h('summary', null, `逐用例执行说明（${profiles.length}）`),
            h('label', null, '选择执行说明', h('select', { 'aria-label': '选择执行说明', value: profile?.case_key || '', onChange: event => setProfileKey(event.target.value) },
              profiles.map(item => h('option', { key: item.case_key, value: item.case_key }, readable(task.cases.find(value => value.case_key === item.case_key)?.title || item.case_key))))),
            h('ol', { className: 'pangea-fi-steps pangea-fi-scroll' }, (Array.isArray(profile?.steps) ? profile.steps : [profile?.steps]).map((step, at) => h('li', { key: at }, readable(step))))) : null,
          task.result?.limitations?.length ? h('details', null, h('summary', null, `生成限制（${task.result.limitations.length}）`), h('p', { className: 'pangea-fi-scroll', style: { whiteSpace: 'pre-wrap' } }, readable(task.result.limitations))) : null,
          task.repositories.map(repo => h('details', { key: repo.repo_id, style: { marginTop: 12 } }, h('summary', null, `${repo.repo_id} · ${repo.commit ? repo.pushed ? '已推送' : '已提交' : '未修改'}`),
            h('p', null, '基线：', h('code', null, repo.base_commit)), repo.commit ? h('p', null, '修改提交：', h('code', null, repo.commit)) : null,
            repo.diff ? h('pre', { style: { maxHeight: 400, overflow: 'auto', padding: 12, background: '#f5f7fa' } }, repo.diff) : null))
          ) : null) : null)
  }
}
