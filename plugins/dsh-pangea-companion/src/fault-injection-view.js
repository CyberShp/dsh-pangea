export const INJECTION_STATUS_LABELS = {
  preparing: '准备源码', generating: '生成打桩修改', ready: '修改已生成', pushing: '正在推送',
  pushed: '个人分支已推送', failed: '生成失败', cancelled: '已停止', interrupted: '操作已中断',
}
const readable = value => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2)

export function createFaultInjectionPanel(React) {
  const h = React.createElement
  const busy = task => ['preparing', 'generating', 'pushing'].includes(task?.status)
  return function FaultInjectionPanel({ runId, dataRoot, cwd, cases = [] }) {
    const [open, setOpen] = React.useState(false)
    const [tasks, setTasks] = React.useState([])
    const [taskId, setTaskId] = React.useState('')
    const [settings, setSettings] = React.useState(null)
    const [providers, setProviders] = React.useState([])
    const [error, setError] = React.useState('')
    const [working, setWorking] = React.useState(false)
    const [build, setBuild] = React.useState({ url: '', package_id: '', package_sha256: '', notes: '' })
    const [verification, setVerification] = React.useState({ case_key: '', result: 'not_run', hits: '', notes: '' })
    const selectedKeys = cases.map(item => item.projection_id || item.test_case_id).filter(Boolean)
    const task = tasks.find(item => item.id === taskId)
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
    const remember = value => {
      setTasks(previous => [value, ...previous.filter(item => item.id !== value.id)])
      setTaskId(value.id)
    }
    React.useEffect(() => {
      if (!open) return
      let live = true
      request().then(value => {
        if (!live) return
        setTasks(value.tasks ?? []); setProviders(value.providers ?? [])
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
      setBuild({ url: '', package_id: '', package_sha256: '', notes: '', ...task?.build })
      setVerification({ case_key: task?.case_keys?.[0] || '', result: 'not_run', hits: '', notes: '' })
    }, [taskId])
    const act = async (action, extra = {}) => {
      setWorking(true); setError('')
      try { const value = await request({ action, task_id: taskId, ...extra }); remember(value.task) }
      catch (reason) { setError(reason.message) }
      finally { setWorking(false) }
    }
    const field = (label, value, change, options = {}) => h('label', { style: { display: 'grid', gap: 5, marginBottom: 10 } }, label,
      h(options.multiline ? 'textarea' : 'input', { 'aria-label': label, value: readable(value), onChange: event => change(event.target.value),
        disabled: working, ...(options.multiline ? { rows: 3 } : { type: 'text' }), style: { width: '100%', boxSizing: 'border-box' } }))
    const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }
    const renderPoints = points => Array.isArray(points) ? points.map((point, index) => h('article', { key: point.id || index, style: { padding: '12px 0', borderTop: '1px solid #e2e6ee' } },
      h('strong', null, `${readable(point.id)} · ${readable(point.repo_id)}:${readable(point.path)}`),
      h('dl', { className: 'pangea-reading-fields' }, ...[['symbol', '代码位置'], ['action', '注入动作'], ['trigger', '触发条件'], ['times', '触发次数'], ['enable', '启用方式'], ['disable', '关闭方式'], ['observe', '命中检查'], ['cleanup', '恢复操作'], ['depends_on', '依赖桩点'], ['exclusive_with', '互斥桩点']].flatMap(([key, label]) => point[key] == null || (Array.isArray(point[key]) && !point[key].length) ? [] : [h('dt', { key: `${key}-label` }, label), h('dd', { key, style: { whiteSpace: 'pre-wrap' } }, Array.isArray(point[key]) ? point[key].map(readable).join('、') : readable(point[key]))])))) : null
    const candidates = cases.filter(item => item.instrumentation || item.source_record?.body?.instrumentation)
    return h('section', { className: 'b05-card pangea-injection-panel', 'data-testid': 'fault-injection-panel' },
      h('div', { className: 'b05-head-actions', style: { justifyContent: 'space-between' } },
        h('div', null, h('strong', null, '打桩与个人分支'), h('p', { className: 'b05-subtle' }, selectedKeys.length ? `已选择 ${selectedKeys.length} 条用例，可一起生成打桩修改。` : '选择用例生成打桩修改，或查看已有打桩任务。')),
        h('button', { type: 'button', className: 'btn', 'aria-expanded': open, onClick: () => setOpen(value => !value) }, open ? '收起打桩' : '打开打桩工作区')),
      open ? h('div', null,
        error ? h('p', { role: 'alert' }, error) : null,
        candidates.length ? h('details', null, h('summary', null, '分析中记录的桩点'), candidates.map(item => h('div', { key: item.projection_id || item.test_case_id },
          h('strong', null, readable(item.title)), renderPoints((item.instrumentation || item.source_record.body.instrumentation)?.points)))) : null,
        settings ? h('details', { open: !task }, h('summary', null, '生成新的打桩修改'),
          h('div', { style: { marginTop: 14 } },
            h('div', { style: grid },
              h('label', null, '执行器', h('select', { 'aria-label': '打桩执行器', value: settings.provider_id, disabled: working, onChange: event => setSettings({ ...settings, provider_id: event.target.value }) },
                h('option', { value: '' }, '选择执行器'), providers.map(provider => h('option', { key: provider.id, value: provider.id }, provider.label)))),
              field('打桩模型', settings.agent_model, value => setSettings({ ...settings, agent_model: value })),
              field('个人分支前缀', settings.branch_prefix, value => setSettings({ ...settings, branch_prefix: value }))),
            (settings.repositories ?? []).map((repo, index) => h('fieldset', { key: repo.repo_id, style: { margin: '10px 0', padding: 14, border: '1px solid #d8dee9', borderRadius: 8 } },
              h('legend', null, h('label', null, h('input', { type: 'checkbox', checked: repo.enabled !== false, 'aria-label': `本次包含 ${repo.repo_id}`, disabled: working,
                onChange: event => setSettings({ ...settings, repositories: settings.repositories.map((item, at) => at === index ? { ...item, enabled: event.target.checked } : item) }) }), ' ', readable(repo.repo_id))), h('div', { style: grid },
                ...[['source_path', 'Git 仓库目录'], ['base_ref', '源码基线（提交或本地分支）'], ['remote', '推送远端']].map(([key, label]) => field(`${repo.repo_id} · ${label}`, repo[key], value => setSettings({ ...settings, repositories: settings.repositories.map((item, at) => at === index ? { ...item, [key]: value } : item) })))))),
            field('补充说明', settings.instructions, value => setSettings({ ...settings, instructions: value }), { multiline: true }),
            h('button', { type: 'button', className: 'btn primary', disabled: working || !selectedKeys.length || !settings.repositories.some(repo => repo.enabled !== false),
              onClick: () => act('generate', { ...settings, repositories: settings.repositories.filter(repo => repo.enabled !== false), case_keys: selectedKeys }) }, working ? '正在提交…' : `生成打桩修改（${selectedKeys.length} 条用例）`)))
          : h('p', null, '正在读取打桩设置…'),
        tasks.length ? h('div', { style: { marginTop: 18 } }, h('label', null, '已有打桩任务 ', h('select', { 'aria-label': '已有打桩任务', value: taskId, onChange: event => setTaskId(event.target.value) },
          h('option', { value: '' }, '选择任务查看'), tasks.map(item => h('option', { key: item.id, value: item.id }, `${item.created_at.slice(0, 16).replace('T', ' ')} · ${item.case_keys.length} 条 · ${INJECTION_STATUS_LABELS[item.status] || item.status}`))))) : null,
        task ? h('div', { style: { marginTop: 16 } },
          h('p', { role: 'status' }, h('strong', null, INJECTION_STATUS_LABELS[task.status] || task.status)),
          task.error ? h('p', { role: 'alert', style: { whiteSpace: 'pre-wrap' } }, task.error) : null,
          busy(task) ? h('button', { type: 'button', className: 'btn', disabled: working, onClick: () => act('cancel') }, '停止本次操作') : null,
          h('p', null, '个人分支：', h('code', null, task.branch)),
          task.result?.summary ? h('p', { style: { whiteSpace: 'pre-wrap' } }, readable(task.result.summary)) : null,
          renderPoints(task.result?.points),
          Array.isArray(task.result?.profiles) ? h('div', null, h('strong', null, '逐用例执行说明'), task.result.profiles.map((profile, index) => h('div', { key: profile.case_key || index },
            h('p', null, readable(task.cases.find(item => item.case_key === profile.case_key)?.title || profile.case_key)),
            h('ol', null, (Array.isArray(profile.steps) ? profile.steps : [profile.steps]).map((step, at) => h('li', { key: at }, readable(step))))))) : null,
          task.result?.limitations?.length ? h('p', { style: { whiteSpace: 'pre-wrap' } }, '生成说明：', readable(task.result.limitations)) : null,
          task.repositories.map(repo => h('details', { key: repo.repo_id, style: { marginTop: 12 } }, h('summary', null, `${repo.repo_id} · ${repo.commit ? repo.pushed ? '已推送' : '已提交' : '未修改'}`),
            h('p', null, '基线：', h('code', null, repo.base_commit)), repo.commit ? h('p', null, '修改提交：', h('code', null, repo.commit)) : null,
            repo.diff ? h('pre', { style: { maxHeight: 400, overflow: 'auto', padding: 12, background: '#f5f7fa' } }, repo.diff) : null)),
          ['ready', 'interrupted'].includes(task.status) && task.generation_complete ? h('button', { type: 'button', className: 'btn primary', style: { marginTop: 14 }, disabled: working, onClick: () => act('push') }, working ? '正在推送…' : '推送个人分支') : null,
          task.repositories.some(repo => repo.commit) ? h('details', { style: { marginTop: 18 }, open: task.status === 'pushed' }, h('summary', null, '构建包与验证记录'),
            h('p', { className: 'b05-subtle' }, '在已有流水线选择上面的个人分支或修改提交出包；烧包测试后，在这里记录结果。'),
            h('div', { style: grid }, field('构建链接', build.url, value => setBuild({ ...build, url: value })), field('个人包名称或版本', build.package_id, value => setBuild({ ...build, package_id: value })), field('包 SHA256（可选）', build.package_sha256, value => setBuild({ ...build, package_sha256: value }))),
            h('div', { style: grid }, h('label', null, '验证用例', h('select', { 'aria-label': '验证用例', value: verification.case_key, onChange: event => setVerification({ ...verification, case_key: event.target.value }) }, task.cases.map(item => h('option', { key: item.case_key, value: item.case_key }, readable(item.title))))),
              h('label', null, '实际结果', h('select', { 'aria-label': '实际结果', value: verification.result, onChange: event => setVerification({ ...verification, result: event.target.value }) }, [['not_run', '未执行'], ['passed', '通过'], ['failed', '失败'], ['not_triggered', '目标故障未触发']].map(([value, label]) => h('option', { key: value, value }, label)))),
              field('桩点实际命中', verification.hits, value => setVerification({ ...verification, hits: value }))),
            field('验证现象与记录', verification.notes, value => setVerification({ ...verification, notes: value }), { multiline: true }),
            h('button', { type: 'button', className: 'btn', disabled: working || busy(task), onClick: () => act('verify', { build, verification }) }, '保存构建与验证记录'),
            task.verification.length ? h('ul', null, task.verification.map((value, index) => h('li', { key: index }, `${value.at} · ${readable(task.cases.find(item => item.case_key === value.case_key)?.title || value.case_key)} · ${({ passed: '通过', failed: '失败', not_triggered: '目标故障未触发', not_run: '未执行' })[value.result]} · ${value.hits} · ${value.notes}`,
              h('p', { className: 'b05-subtle' }, `验证包：${value.build?.package_id || '未填写'}；提交：${(value.build?.commits || []).map(repo => `${repo.repo_id} ${repo.commit.slice(0, 12)}`).join('、')}`),
              value.build?.url ? h('a', { href: value.build.url, target: '_blank', rel: 'noreferrer' }, '查看本次构建') : null))) : null) : null) : null) : null)
  }
}
