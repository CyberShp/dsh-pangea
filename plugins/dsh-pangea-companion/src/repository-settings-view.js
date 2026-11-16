export function sourceLabel(source) {
  if (source?.kind === 'git') return `Git · ${source.branch || '固定提交'} · ${source.commit.slice(0, 12)}${source.dirty ? ' · 有未提交修改' : ''}${source.remote ? '' : ' · 未配置远端'}`
  if (source?.kind === 'folder') return '本地文件夹 · 可直接分析 · 打桩前关联 Git 仓库'
  return source?.error || '尚未读取 Git 状态'
}
export function createRepositorySettings(React) {
  const h = React.createElement
  return function RepositorySettings({ cwd, dataRoot, repositories = [], onSaved }) {
    const [open, setOpen] = React.useState(false), [items, setItems] = React.useState([])
    const [selected, setSelected] = React.useState(''), [mode, setMode] = React.useState('local')
    const [form, setForm] = React.useState({}), [busy, setBusy] = React.useState(false), [message, setMessage] = React.useState('')
    const query = new URLSearchParams({ ...(cwd ? { cwd } : {}), ...(dataRoot ? { data_root: dataRoot } : {}) })
    const request = async body => {
      const response = await fetch(`/api/pangea-companion/repositories?${query}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
      const result = await response.json(); if (!response.ok || result.status !== 'ok') throw new Error(result.error || '仓库配置读取失败')
      return result
    }
    const choose = (id, list = items) => {
      const settings = list.find(item => item.repository_id === id)?.settings || {}
      setSelected(id); setForm({ pipeline_url: settings.pipeline_url || '', git_path: settings.git_path || '', base_ref: settings.base_ref || 'HEAD', git_url: '', personal_branch: settings.personal_branch || '', remote: settings.remote || 'origin' }); setMode('local')
    }
    React.useEffect(() => {
      if (!open) return
      let live = true
      request().then(result => { if (live) { setItems(result.repositories); choose(repositories[0]?.repo_id || result.repositories[0]?.repository_id || '', result.repositories) } }).catch(error => { if (live) setMessage(error.message) })
      return () => { live = false }
    }, [open, cwd, dataRoot])
    const field = (label, key) => h('label', { style: { display: 'grid', gap: 5, margin: '12px 0' } }, label, h('input', { 'aria-label': label, value: form[key] || '', disabled: busy, onChange: event => setForm({ ...form, [key]: event.target.value }) }))
    const save = async () => {
      setBusy(true); setMessage('')
      try {
        const payload = { action: 'configure-repository', repository_name: selected, pipeline_url: form.pipeline_url, base_ref: form.base_ref, ...(form.personal_branch ? { personal_branch: form.personal_branch, remote: form.remote } : {}) }
        if (mode === 'remote') payload.git_url = form.git_url
        else if (form.git_path) payload.git_path = form.git_path
        if (mode === 'remote' && !payload.git_url) throw new Error('请输入关联仓库地址')
        await request(payload); const refreshed = await request(); setItems(refreshed.repositories); choose(selected, refreshed.repositories); await onSaved?.(); setMessage('已保存；后续打桩任务使用此配置，原分析源码保持不变。')
      } catch (error) { setMessage(error.message) } finally { setBusy(false) }
    }
    return h('section', { className: 'b05-card' },
      h('button', { type: 'button', 'aria-expanded': open, onClick: () => setOpen(!open) }, '代码仓库与构建'),
      open ? h('div', null,
        h('label', null, '配置仓库', h('select', { 'aria-label': '配置仓库', value: selected, disabled: busy, onChange: event => choose(event.target.value) }, items.filter(item => !repositories.length || repositories.some(repo => repo.repo_id === item.repository_id)).map(item => h('option', { key: item.repository_id, value: item.repository_id }, item.name)))),
        h('p', null, sourceLabel(items.find(item => item.repository_id === selected)?.source)),
        items.find(item => item.repository_id === selected)?.settings?.git_path ? h('p', null, `已关联打桩仓库：${items.find(item => item.repository_id === selected).settings.git_path}`) : null,
        field('个人开发分支', 'personal_branch'),
        field('推送远端', 'remote'),
        h('p', null, '打桩只提交到这个已有分支；任务不会创建新分支。'),
        field('项目构建流水线 URL', 'pipeline_url'),
        h('details', null, h('summary', null, '关联或更换打桩 Git 仓库'),
          h('p', null, '选择与分析源码对应的 Git 仓库。关联后保留原分析目录；打桩前展示源码差异。'),
          h('select', { 'aria-label': '关联方式', value: mode, disabled: busy, onChange: event => setMode(event.target.value) }, h('option', { value: 'local' }, '已有本地 Git 仓库'), h('option', { value: 'remote' }, '克隆 Git 仓库地址')),
          mode === 'local' ? field('关联 Git 仓库目录', 'git_path') : field('关联 Git 仓库地址', 'git_url'),
          field('关联分支、标签或提交', 'base_ref')),
        h('button', { type: 'button', disabled: busy || !selected, onClick: save }, busy ? '正在保存仓库配置…' : '保存仓库与构建配置'),
        message ? h('p', { role: 'status' }, message) : null) : null)
  }
}
