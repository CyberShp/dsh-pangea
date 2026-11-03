export function createTestToolPicker(React, SourceScopePicker) {
  const h = React.createElement
  return function TestToolPicker({ cwd, dataRoot, repositories, sources, preview, onChange, onPreview, renderIcon }) {
    const [repository, setRepository] = React.useState('')
    const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('')
    const sequence = React.useRef(0)
    const key = JSON.stringify([cwd, dataRoot, sources])
    React.useEffect(() => { sequence.current++; setBusy(false); setError(''); return () => { sequence.current++ } }, [key])
    const update = (repo_id, value) => {
      const paths = [...new Set(value.split(/\r?\n/).map(item => item.trim()).filter(Boolean))]
      const next = sources.flatMap(source => source.repo_id === repo_id ? paths.length ? [{ repo_id, paths }] : [] : [source])
      if (paths.length && !sources.some(source => source.repo_id === repo_id)) next.push({ repo_id, paths })
      if (JSON.stringify(next) !== JSON.stringify(sources)) onChange(next)
    }
    async function request(page = {}) {
      const token = ++sequence.current
      if (!page.preview_id) onPreview(null)
      setBusy(true); setError('')
      try {
        const response = await fetch(`/api/pangea-companion/repositories?${new URLSearchParams({ cwd, ...(dataRoot ? { data_root: dataRoot } : {}) })}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'preview-test-tools', cwd, data_root: dataRoot, test_tool_sources: sources, ...page }) })
        const value = await response.json()
        if (!response.ok || value.status !== 'ok') throw new Error(value.error || `HTTP ${response.status}`)
        if (sequence.current === token) onPreview(value)
      } catch (reason) { if (sequence.current === token) setError(reason.message) }
      finally { if (sequence.current === token) setBusy(false) }
    }
    return h('section', { className: 'create-scope', 'aria-label': '测试工具代码参考', style: { marginTop: 24 } },
      h('h3', null, '测试工具代码（可选，仅参考）'),
      h('p', { className: 'create-copy' }, '选择同仓库的工具目录，或其他已登记仓库中的下级目录。Agent 将阅读工具代码编写具体操作说明，不会把工具本身作为被测对象，也不会执行工具。无需手写工具说明。'),
      h('label', { className: 'field' }, '工具参考仓库', h('select', { 'aria-label': '工具参考仓库', value: repository, onChange: event => setRepository(event.target.value) }, h('option', { value: '' }, '选择已登记仓库'), repositories.map(id => h('option', { key: id, value: id }, id)))),
      repository && h(SourceScopePicker, { key: repository, cwd, dataRoot, repository, value: sources.find(source => source.repo_id === repository)?.paths.join('\n') || '', selectionOnly: true, onChange: value => update(repository, value), renderIcon }),
      h('ul', null, sources.map(source => h('li', { key: source.repo_id }, h('strong', null, source.repo_id), ' · 参考代码：', source.paths.join('、'), h('button', { type: 'button', className: 'btn ghost', onClick: () => onChange(sources.filter(item => item.repo_id !== source.repo_id)) }, `移除 ${source.repo_id}`)))),
      sources.length ? h('button', { type: 'button', className: 'btn', disabled: busy, onClick: () => { void request() } }, busy ? '正在预览工具参考…' : '预览最终工具参考文件') : h('p', null, '未选择工具代码；按原有方式分析。'),
      error && h('p', { role: 'alert', className: 'notice danger' }, `工具参考预览失败：${error}`),
      preview && h('div', { role: 'status' }, h('p', null, `参考代码 · ${preview.matched_file_count} 个文件；排除 ${preview.excluded_file_count || 0} 个文件`),
        !preview.matched_file_count && h('p', { className: 'notice warn' }, '没有可读取的参考文件，请调整范围。'),
        h('details', null, h('summary', null, '查看最终仓库、文件与角色'), h('ul', null, (preview.files || []).map(file => h('li', { key: `${file.repo_id}/${file.relative_path}` }, `${file.repo_id} / ${file.relative_path} · 参考（非被测对象）`))),
          h('button', { type: 'button', className: 'btn', disabled: busy || Number(preview.next_cursor) <= 50, onClick: () => { void request({ preview_id: preview.preview_id, cursor: Math.max(0, Number(preview.next_cursor) - 100) }) } }, '上一页'),
          h('button', { type: 'button', className: 'btn', disabled: busy || !preview.has_more, onClick: () => { void request({ preview_id: preview.preview_id, cursor: preview.next_cursor }) } }, '下一页')),
        preview.excluded_files?.length ? h('details', null, h('summary', null, '查看排除原因'), h('ul', null, preview.excluded_files.map((file, i) => h('li', { key: i }, `${file.repo_id} / ${file.relative_path}：${file.reason}`)))) : null))
  }
}
