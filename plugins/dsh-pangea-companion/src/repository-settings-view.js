export function sourceLabel(source) {
  if (source?.kind === 'git') return `Git · ${source.branch || '固定提交'} · ${source.commit.slice(0, 12)}${source.tracked_changes || (source.dirty && source.tracked_changes === undefined) ? ' · 有未提交修改' : ''}${source.untracked_files ? ' · 有未跟踪文件' : ''}${source.remote ? '' : ' · 未配置远端'}`
  if (source?.kind === 'folder') return '本地文件夹 · 可直接分析 · 打桩前关联 Git 仓库'
  return source?.error || '尚未读取 Git 状态'
}

export function createRepositorySettings(React) {
  const h = React.createElement
  return function RepositorySettings({ cwd, dataRoot, repositories = [], defaultOpen = false, onSaved }) {
    const [open, setOpen] = React.useState(defaultOpen), [items, setItems] = React.useState([])
    const [selected, setSelected] = React.useState(''), [mode, setMode] = React.useState('local')
    const [form, setForm] = React.useState({}), [busy, setBusy] = React.useState(false), [message, setMessage] = React.useState('')
    const [isError, setIsError] = React.useState(false)
    const [branches, setBranches] = React.useState(null)
    const [branchError, setBranchError] = React.useState('')
    const [refresh, setRefresh] = React.useState(0)
    React.useEffect(() => { if (defaultOpen) setOpen(true) }, [defaultOpen])
    const query = new URLSearchParams({ ...(cwd ? { cwd } : {}), ...(dataRoot ? { data_root: dataRoot } : {}) })
    const request = async body => {
      const response = await fetch(`/api/pangea-companion/repositories?${query}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
      const result = await response.json(); if (!response.ok || result.status !== 'ok') throw new Error(result.error || '仓库配置读取失败')
      return result
    }
    const choose = (id, list = items) => {
      const settings = list.find(item => item.repository_id === id)?.settings || {}
      setSelected(id)
      setForm({
        pipeline_url: settings.pipeline_url || '',
        git_path: settings.git_path || '',
        base_ref: settings.base_ref || 'HEAD',
        git_url: '',
        personal_branch: settings.personal_branch || '',
        remote: settings.remote || 'origin',
        remote_branch: settings.remote_branch || settings.personal_branch || '',
        lfs_include: '',
      })
      setMode('local')
    }
    React.useEffect(() => {
      if (!open) return
      let live = true
      request().then(result => {
        if (live) {
          setItems(result.repositories)
          choose(repositories[0]?.repo_id || result.repositories[0]?.repository_id || '', result.repositories)
        }
      }).catch(error => { if (live) { setIsError(true); setMessage(error.message) } })
      return () => { live = false }
    }, [open, cwd, dataRoot])
    React.useEffect(() => {
      if (!open || !selected || mode === 'remote') return
      let live = true
      setBranches(null); setBranchError('')
      request({ action: 'repository-branches', repository_name: selected, git_path: form.git_path || undefined, remote: form.remote || 'origin', refresh: refresh > 0 })
        .then(value => { if (live) setBranches(value) }).catch(error => { if (live) setBranchError(error.message) })
      return () => { live = false }
    }, [open, selected, form.git_path, form.remote, mode, refresh])
    const select = (label, key, options) => h('label', { className: 'pangea-repo-field' }, h('span', null, label),
      h('select', { 'aria-label': label, value: form[key] || '', disabled: busy || !branches, onChange: event => setForm({ ...form, [key]: event.target.value,
        ...(key === 'remote' ? { remote_branch: '' } : key === 'personal_branch' ? { remote_branch: event.target.value } : {}) }) },
        h('option', { value: '' }, '请选择'),
        form[key] && !options.some(item => item.name === form[key]) ? h('option', { value: form[key] }, `${form[key]}（待核实）`) : null,
        options.map(item => h('option', { key: item.name, value: item.name }, item.url ? `${item.name} · ${item.url}` : item.name))))
    const createBranch = async () => {
      setBusy(true); setMessage(''); setIsError(false)
      try {
        await request({ action: 'create-tracking-branch', repository_name: selected, git_path: form.git_path || undefined, remote: form.remote,
          personal_branch: form.remote_branch, remote_branch: form.remote_branch })
        setForm(previous => ({ ...previous, personal_branch: previous.remote_branch })); setRefresh(value => value + 1)
        setMessage('已创建本地跟踪分支；请点击下方“保存仓库与构建配置”完成绑定。')
      } catch (error) { setIsError(true); setMessage(error.message) } finally { setBusy(false) }
    }
    const pickDirectory = async key => {
      try {
        const picked = await globalThis.window?.dshDesktopDirectoryPicker?.pick?.({ purpose: 'repository' })
        if (picked) setForm(previous => ({ ...previous, [key]: picked }))
      } catch (error) { setIsError(true); setMessage(error?.message || '目录选择失败') }
    }
    const field = (label, key, withPicker = false) => h('label', { className: 'pangea-repo-field' }, h('span', null, label),
      withPicker && globalThis.window?.dshDesktopDirectoryPicker?.pick
        ? h('div', { className: 'pangea-repo-input-row' },
          h('input', { 'aria-label': label, value: form[key] || '', disabled: busy, onChange: event => setForm({ ...form, [key]: event.target.value }) }),
          h('button', { type: 'button', className: 'btn', disabled: busy, onClick: () => { void pickDirectory(key) } }, '选择目录'))
        : h('input', { 'aria-label': label, value: form[key] || '', disabled: busy, onChange: event => setForm({ ...form, [key]: event.target.value }) }))
    const reimport = async () => {
      setBusy(true); setMessage(''); setIsError(false)
      try {
        const result = await request({ action: 'reimport-repository', repository_name: selected })
        const refreshed = await request(); setItems(refreshed.repositories); choose(selected, refreshed.repositories)
        setRefresh(value => value + 1); await onSaved?.(); setMessage(`已重新导入，旧目录备份：${result.repository.backup_path}`)
      } catch (error) { setIsError(true); setMessage(error.message) } finally { setBusy(false) }
    }
    const pullLfs = async () => {
      setBusy(true); setMessage(''); setIsError(false)
      try { await request({ action: 'pull-lfs', repository_name: selected, include: form.lfs_include }); setMessage('所选 LFS 内容已下载') }
      catch (error) { setIsError(true); setMessage(error.message) } finally { setBusy(false) }
    }
    const save = async () => {
      setBusy(true); setMessage(''); setIsError(false)
      try {
        const payload = { action: 'configure-repository', repository_name: selected, pipeline_url: form.pipeline_url, base_ref: form.base_ref, ...(form.personal_branch ? { personal_branch: form.personal_branch, remote: form.remote, remote_branch: form.remote_branch || form.personal_branch } : {}) }
        if (mode === 'remote') payload.git_url = form.git_url
        else if (form.git_path) payload.git_path = form.git_path
        if (mode === 'remote' && !payload.git_url) throw new Error('请输入关联仓库地址')
        await request(payload); const refreshed = await request(); setItems(refreshed.repositories); choose(selected, refreshed.repositories); await onSaved?.(); setMessage('已保存；后续打桩任务使用此配置，原分析源码保持不变。')
      } catch (error) { setIsError(true); setMessage(error.message) } finally { setBusy(false) }
    }
    const currentRepo = items.find(item => item.repository_id === selected)
    const needsGitLink = Boolean(currentRepo && currentRepo.source?.kind !== 'git' && !currentRepo.settings?.git_path)
    return h('section', { className: 'pangea-repo-settings' },
      h('style', null, `
        .pangea-repo-settings { border: 1px solid var(--pangea-line, #e2e6ec); border-radius: 8px; background: #fff; padding: 12px 14px; margin: 10px 0; }
        .pangea-repo-toggle { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; border: 0; background: transparent; padding: 2px 0; color: var(--pangea-ink, #1d232a); font: 600 13px/1.5 inherit; cursor: pointer; text-align: left; }
        .pangea-repo-toggle::after { content: "▾"; color: var(--pangea-muted, #5e6773); font-size: 12px; transition: transform .15s ease; }
        .pangea-repo-toggle[aria-expanded="true"]::after { transform: rotate(180deg); }
        .pangea-repo-body { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--pangea-line, #e2e6ec); display: grid; gap: 12px; }
        .pangea-repo-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: 12px; }
        .pangea-repo-field { display: grid; gap: 5px; font-size: 12px; font-weight: 600; color: var(--pangea-ink, #1d232a); margin: 0; }
        .pangea-repo-field input, .pangea-repo-field select { width: 100%; min-height: 36px; box-sizing: border-box; padding: 6px 10px; border: 1px solid #d5dbe3; border-radius: 6px; background: #fff; color: var(--pangea-ink, #1d232a); font: 400 13px/1.5 inherit; }
        .pangea-repo-input-row { display: flex; gap: 8px; align-items: center; }
        .pangea-repo-input-row input { flex: 1; min-width: 0; }
        .pangea-repo-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .pangea-repo-status { margin: 0; padding: 8px 12px; border-radius: 6px; background: var(--pangea-subtle, #f1f3f6); color: var(--pangea-muted, #5e6773); font-size: 12px; line-height: 1.6; }
        .pangea-repo-status.is-error { background: #fbefef; color: #b62836; }
        .pangea-repo-status.is-ok { background: #eaf5ee; color: #20765a; }
        .pangea-repo-subdetails { border-top: 1px solid var(--pangea-line, #e2e6ec); padding-top: 10px; }
        .pangea-repo-subdetails > summary { cursor: pointer; font-size: 13px; font-weight: 600; color: var(--pangea-ink, #1d232a); padding: 4px 0; }
      `),
      h('button', { type: 'button', className: 'pangea-repo-toggle', 'aria-expanded': open, onClick: () => setOpen(!open) }, '代码仓库与构建'),
      open ? h('div', { className: 'pangea-repo-body' },
        h('div', { className: 'pangea-repo-grid' },
          h('label', { className: 'pangea-repo-field' }, h('span', null, '配置仓库'),
            h('select', { 'aria-label': '配置仓库', value: selected, disabled: busy, onChange: event => choose(event.target.value) },
              items.filter(item => !repositories.length || repositories.some(repo => repo.repo_id === item.repository_id)).map(item => h('option', { key: item.repository_id, value: item.repository_id }, item.name)))),
          field('项目构建流水线 URL', 'pipeline_url')),
        h('p', { className: 'pangea-repo-status' }, sourceLabel(currentRepo?.source),
          currentRepo?.settings?.git_path ? ` · 已关联打桩仓库：${currentRepo.settings.git_path}` : ''),
        h('div', { className: 'pangea-repo-grid' },
          select('个人开发分支', 'personal_branch', branches?.local || []),
          select('推送远端', 'remote', branches?.remotes || []),
          select('远端目标分支', 'remote_branch', branches?.remote_branches || [])),
        h('div', { className: 'pangea-repo-actions' },
          h('button', { type: 'button', className: 'btn', disabled: busy || !selected, onClick: () => setRefresh(value => value + 1) }, '刷新远端分支'),
          h('button', { type: 'button', className: 'btn', disabled: busy || !form.remote_branch || !branches || branches.local.some(item => item.name === form.remote_branch), onClick: createBranch }, '创建本地跟踪分支'),
          h('span', { role: 'status', style: { fontSize: 12, color: branchError ? '#b62836' : '#5e6773' } }, branchError || (branches?.live ? '已读取推送端的远端分支' : '远端分支为本地缓存，可刷新查询服务器'))),
        h('p', { style: { margin: 0, fontSize: 12, color: '#5e6773' } }, '请使用专用打桩构建分支，勿填正在开发的特性分支；打桩推送会将该分支同步为当前基线与所选桩代码，任务不会自动新建分支。'),
        h('details', { className: 'pangea-repo-subdetails', open: needsGitLink || undefined },
          h('summary', null, '关联或更换打桩 Git 仓库'),
          h('p', { style: { margin: '6px 0 10px', fontSize: 12, color: '#5e6773' } }, '选择与分析源码对应的 Git 仓库。关联后保留原分析目录；打桩前展示源码差异。'),
          h('div', { className: 'pangea-repo-grid' },
            h('label', { className: 'pangea-repo-field' }, h('span', null, '关联方式'),
              h('select', { 'aria-label': '关联方式', value: mode, disabled: busy, onChange: event => setMode(event.target.value) }, h('option', { value: 'local' }, '已有本地 Git 仓库'), h('option', { value: 'remote' }, '克隆 Git 仓库地址'))),
            mode === 'local' ? field('关联 Git 仓库目录', 'git_path', true) : field('关联 Git 仓库地址', 'git_url'),
            field('关联分支、标签或提交', 'base_ref'))),
        h('details', { className: 'pangea-repo-subdetails' },
          h('summary', null, '修复性重新导入'),
          h('p', { style: { margin: '6px 0 10px', fontSize: 12, color: '#5e6773' } }, '从来源仓库重新克隆并验证，成功后替换分析源码；保留旧目录和仓库配置。存在未提交或本地独有提交时停止。'),
          h('button', { type: 'button', className: 'btn', disabled: busy || !selected, onClick: reimport }, '重新导入并保留旧目录')),
        h('details', { className: 'pangea-repo-subdetails' },
          h('summary', null, '按需下载 LFS 文件'),
          h('div', { style: { marginTop: 8, display: 'grid', gap: 8 } },
            field('LFS 文件范围', 'lfs_include'),
            h('div', null, h('button', { type: 'button', className: 'btn', disabled: busy || !selected || !form.lfs_include, onClick: pullLfs }, '下载所选 LFS 文件')))),
        h('div', { className: 'pangea-repo-actions', style: { paddingTop: 8, borderTop: '1px solid var(--pangea-line, #e2e6ec)', justifyContent: 'space-between' } },
          message ? h('p', { role: 'status', className: `pangea-repo-status ${isError ? 'is-error' : 'is-ok'}` }, message) : h('span', null),
          h('button', { type: 'button', className: 'btn primary', disabled: busy || !selected, onClick: save }, busy ? '正在保存仓库配置…' : '保存仓库与构建配置'))) : null)
  }
}
