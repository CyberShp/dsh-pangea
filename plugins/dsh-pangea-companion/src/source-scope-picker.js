export function createSourceScopePicker(React) {
  const h = React.createElement
  return function SourceScopePicker({ cwd, dataRoot, repository, value, preview, onChange, onPreview, renderIcon = () => null }) {
    const [open, setOpen] = React.useState(false), [tree, setTree] = React.useState(null)
    const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('')
    const root = React.useRef(null), trigger = React.useRef(null), sequence = React.useRef(0)
    const scope = String(value || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean)
    React.useEffect(() => { sequence.current += 1; setTree(null); setError(''); setBusy(false) }, [cwd, dataRoot, repository])
    React.useEffect(() => { sequence.current += 1; setError(''); setBusy(false) }, [value])
    React.useEffect(() => { if (!open) return; root.current?.querySelector('button')?.focus(); return () => trigger.current?.focus?.() }, [open])
    async function request(input, treeQuery = false) {
      const token = ++sequence.current
      if (!treeQuery && !input.preview_id) onPreview(null)
      setBusy(true); setError('')
      try {
        const query = new URLSearchParams({ cwd, ...(dataRoot ? { data_root: dataRoot } : {}), ...(treeQuery ? { view: 'tree', repository, ...input } : {}) })
        const response = await fetch(`/api/pangea-companion/repositories?${query}`, { cache: 'no-store', ...(treeQuery ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'preview-scope', cwd, data_root: dataRoot, repository, source_scope: scope, ...input }) }) })
        const result = await response.json()
        if (!response.ok || result.status !== 'ok') throw new Error(result.error || `HTTP ${response.status}`)
        if (sequence.current !== token) return
        if (treeQuery) setTree(result)
        else onPreview(result)
      } catch (reason) { if (sequence.current === token) setError(reason.message) }
      finally { if (sequence.current === token) setBusy(false) }
    }
    const toggle = path => onChange(scope.includes(path) ? scope.filter(item => item !== path).join('\n') : [...scope.filter(item => item !== '.'), path].join('\n'))
    return h('section', { className: 'pangea-scope-picker', 'aria-label': '源码范围选择与预览' },
      h('div', { className: 'pangea-page-actions pangea-scope-toolbar' },
        h('button', { type: 'button', className: 'btn', ref: trigger, disabled: !repository || busy, onClick: () => { setOpen(true); void request({ path: '.' }, true) } }, renderIcon('FolderOpen'), '选择目录或文件'),
        h('button', { type: 'button', className: 'btn ghost', disabled: !repository || busy, onClick: () => onChange('.') }, renderIcon('FolderGit2'), '选择整个仓库'),
        h('button', { type: 'button', className: 'btn', 'aria-busy': busy, disabled: !repository || !scope.length || busy, onClick: () => { void request({}) } }, renderIcon(busy ? 'LoaderCircle' : 'Search'), busy ? '正在读取范围…' : '预览命中文件')),
      error ? h('p', { role: 'alert', className: 'notice danger pangea-scope-feedback' }, `范围预览失败：${error}`) : null,
      preview ? h('div', { className: 'pangea-scope-preview', role: 'status' },
        h('div', { className: 'pangea-scope-preview-summary' }, renderIcon('Files'), h('strong', null, `${preview.is_entire_repository ? '整个仓库' : '指定范围'} · 命中 ${preview.matched_file_count} 个源码文件`)),
        preview.matched_file_count === 0 ? h('p', { className: 'notice warn pangea-scope-feedback' }, '没有匹配源码，请调整范围后重试。') : null,
        h('details', null, h('summary', null, '查看命中文件清单'), h('ul', { className: 'pangea-scope-path-list' }, preview.files.map(item => h('li', { key: item.relative_path }, h('code', null, item.relative_path)))),
          h('div', { className: 'pangea-page-actions pangea-scope-pagination' }, h('button', { type: 'button', className: 'btn', disabled: busy || Number(preview.next_cursor) <= 50, onClick: () => { void request({ preview_id: preview.preview_id, cursor: Math.max(0, Number(preview.next_cursor) - 100) }) } }, '上一页'),
            h('span', null, `共 ${preview.matched_file_count} 个文件`), h('button', { type: 'button', className: 'btn', disabled: busy || !preview.has_more, onClick: () => { void request({ preview_id: preview.preview_id, cursor: preview.next_cursor }) } }, '下一页'))))
        : h('p', { className: 'b05-subtle' }, '选择范围后预览实际命中文件；范围变化后需要重新预览。'),
      open ? h('div', { className: 'pangea-info-overlay' }, h('section', { className: 'pangea-ui pangea-info-drawer pangea-scope-drawer', ref: root, role: 'dialog', 'aria-modal': true, 'aria-label': '选择源码范围', onKeyDown: event => {
        if (event.key === 'Escape') setOpen(false)
        if (event.key === 'Tab') { const controls = [...root.current.querySelectorAll('button:not(:disabled),input:not(:disabled)')]; if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() } else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() } }
      } }, h('div', { className: 'pangea-page-actions pangea-scope-drawer-head' }, h('h2', null, '选择源码范围'), h('button', { type: 'button', className: 'btn primary', onClick: () => setOpen(false) }, '完成选择')),
      h('div', { className: 'pangea-scope-path-bar' }, h('code', { 'aria-label': '当前目录' }, tree?.path || '.'), h('button', { type: 'button', className: 'btn ghost', disabled: busy || !tree || tree.path === '.', onClick: () => { void request({ path: tree.path.split('/').slice(0, -1).join('/') || '.' }, true) } }, renderIcon('ArrowLeft'), '上一级')),
      h('ul', { className: 'pangea-scope-tree' }, (tree?.entries || []).map(item => h('li', { key: item.path, className: 'pangea-scope-tree-row' }, h('label', { className: 'pangea-scope-tree-name' }, h('input', { type: 'checkbox', checked: scope.includes(item.path), disabled: !item.selectable, onChange: () => toggle(item.path) }), renderIcon(item.kind === 'directory' ? 'FolderOpen' : 'FileText'), h('span', null, item.name)), item.kind === 'directory' ? h('button', { type: 'button', className: 'btn ghost', disabled: busy || !item.selectable, onClick: () => { void request({ path: item.path }, true) } }, '打开') : null))),
      busy ? h('p', { className: 'pangea-scope-feedback small muted', role: 'status' }, '正在读取目录…') : tree && !tree.entries?.length ? h('p', { className: 'pangea-scope-feedback small muted', role: 'status' }, '当前目录没有可显示的目录项。') : null,
      tree ? h('div', { className: 'pangea-page-actions pangea-scope-pagination' }, h('button', { type: 'button', className: 'btn', disabled: busy || !tree.cursor, onClick: () => { void request({ path: tree.path, cursor: Math.max(0, tree.cursor - 100) }, true) } }, '上一页目录项'),
        tree.has_more ? h('button', { type: 'button', className: 'btn', disabled: busy, onClick: () => { void request({ path: tree.path, cursor: tree.next_cursor }, true) } }, '下一页目录项') : null) : null,
      error ? h('p', { role: 'alert', className: 'notice danger pangea-scope-feedback' }, error) : null)) : null)
  }
}
