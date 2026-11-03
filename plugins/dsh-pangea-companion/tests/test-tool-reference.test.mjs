import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { previewTestTools, confirmTestTools } from '../src/repositories/scope.js'
import { createSourceScopePicker } from '../src/source-scope-picker.js'
import { createTestToolPicker } from '../src/test-tool-picker.js'

test('tool references are bounded, paginated and confirmed separately from tested source', async t => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'test-tools-'))
  t.after(() => rm(dataRoot, { recursive: true, force: true }))
  await mkdir(path.join(dataRoot, 'repositories/tools/scripts'), { recursive: true })
  await writeFile(path.join(dataRoot, 'repositories/tools/scripts/check.py'), '# reference')
  const input = { dataRoot, cwd: dataRoot, test_tool_sources: [{ repo_id: 'tools', paths: ['scripts'] }] }
  let revision = 'r1', calls = 0
  const runner = async ({ args }) => {
    calls++; assert.equal(args[0], 'test-tool-scope-preview')
    assert.deepEqual(JSON.parse(args.at(-1)), input.test_tool_sources)
    return { preview_state: 'complete', scope_revision: revision, normalized_sources: input.test_tool_sources, matched_file_count: 2, files: ['a.py', 'b.py'].map(relative_path => ({ repo_id: 'tools', relative_path, role: 'reference' })) }
  }
  const first = await previewTestTools({ ...input, limit: 1 }, runner)
  assert.equal(first.files.length, 1); assert.equal(first.matched_file_count, 2)
  await previewTestTools({ ...input, preview_id: first.preview_id, cursor: 1 }, runner)
  assert.equal(calls, 1)
  const receipt = { ...input, test_tool_preview_id: first.preview_id, expected_test_tool_revision: first.scope_revision }
  assert.equal((await confirmTestTools(receipt, runner)).scope_revision, 'r1')
  revision = 'r2'; await assert.rejects(confirmTestTools(receipt, runner), { statusCode: 409 })
  await assert.rejects(previewTestTools({ ...input, test_tool_sources: [{ repo_id: 'tools', paths: ['../../'] }] }, runner), { statusCode: 403 })
  await assert.rejects(confirmTestTools(input, runner), { statusCode: 409 })
})

function harness() {
  const values = []; let index = 0
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState(initial) { const id = index++; if (!(id in values)) values[id] = initial; return [values[id], value => { values[id] = value }] }, useRef(initial) { const id = index++; if (!(id in values)) values[id] = { current: initial }; return values[id] }, useEffect() {} }
  return { React, render: (Component, props) => { index = 0; return Component(props) } }
}
function nodes(tree) { return !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...tree.children.flatMap(nodes)] }
function text(tree) { return typeof tree === 'string' ? tree : Array.isArray(tree) ? tree.map(text).join('') : tree?.children?.map(text).join('') || '' }
test('empty tool section leaves inputs unchanged and clearly separates role', () => {
  const { React, render } = harness(); let changed = false
  const tree = render(createTestToolPicker(React, () => null), { sources: [], repositories: ['tested', 'tools'], onChange() { changed = true } })
  assert.match(text(tree), /未选择工具代码/); assert.match(text(tree), /不会把工具本身作为被测对象/)
  assert.equal(changed, false)
})
test('directory picker cancel and unchanged confirmation do not alter selection', async () => {
  const { React, render } = harness(); const Component = createSourceScopePicker(React); let changes = 0
  const props = { cwd: '/fixture', repository: 'tools', value: 'scripts', selectionOnly: true, onChange() { changes++ } }
  const previous = globalThis.fetch; globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 'ok', entries: [], path: '.' }) })
  try {
    let tree = render(Component, props)
    nodes(tree).find(n => n.type === 'button' && text(n) === '选择下级目录').props.onClick(); await Promise.resolve()
    tree = render(Component, props); nodes(tree).find(n => n.type === 'button' && text(n) === '取消').props.onClick()
    tree = render(Component, props); assert.equal(nodes(tree).some(n => n.props.role === 'dialog'), false)
    nodes(tree).find(n => n.type === 'button' && text(n) === '选择下级目录').props.onClick(); await Promise.resolve()
    tree = render(Component, props); nodes(tree).find(n => n.type === 'button' && text(n) === '完成选择').props.onClick()
    assert.equal(changes, 0)
  } finally { globalThis.fetch = previous }
})

test('real engine preview and freeze preserve separate reference role without running tools', { skip: !process.env.PANGEA_TEST_PYTHON || !process.env.PANGEA_AGENT_ROOT }, async t => {
  const { execFile } = await import('node:child_process'), { promisify } = await import('node:util'), { readFile } = await import('node:fs/promises')
  const execute = promisify(execFile)
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'tool-reference-engine-'))
  t.after(() => rm(dataRoot, { recursive: true, force: true }))
  await mkdir(path.join(dataRoot, 'repositories/product/src'), { recursive: true })
  await mkdir(path.join(dataRoot, 'repositories/tools/scripts'), { recursive: true })
  await writeFile(path.join(dataRoot, 'repositories/product/src/api.c'), 'int api(void){return 0;}')
  await writeFile(path.join(dataRoot, 'repositories/tools/scripts/check.py'), 'raise RuntimeError("MUST NOT EXECUTE")\n')
  // Force the reference index over task-open's inline budget.
  for (let i = 0; i < 60; i++) await writeFile(path.join(dataRoot, `repositories/tools/scripts/z-${i}.py`), '# frozen reference only')
  const runner = async ({ args }) => {
    const { stdout } = await execute(process.env.PANGEA_TEST_PYTHON, ['-m', 'pangea_agent.cli.main', ...args], { cwd: process.env.PANGEA_AGENT_ROOT, maxBuffer: 8 * 1024 * 1024 })
    const value = JSON.parse(stdout); assert.equal(value.ok, true); return value.result
  }
  const input = { cwd: dataRoot, dataRoot, test_tool_sources: [{ repo_id: 'tools', paths: ['scripts'] }] }
  const preview = await previewTestTools(input, runner)
  assert.equal(preview.files[0].role, 'reference'); assert.equal(preview.files[0].relative_path, 'scripts/check.py')
  const checked = await confirmTestTools({ ...input, test_tool_preview_id: preview.preview_id, expected_test_tool_revision: preview.scope_revision }, runner)
  const contract = path.join(dataRoot, 'contract.json')
  await writeFile(contract, JSON.stringify({ data_root: dataRoot, run_id: 'reference-smoke', repository: 'product', target: 'API fixture', source_scope: ['src'], workflow_version: 'source-first-v1', analysis_profile: 'behavior-test-v2', analysis_settings: { scenario: 'module-analysis', mode: 'speed' }, test_tool_sources: checked.normalized_sources, expected_test_tool_revision: checked.scope_revision }))
  const created = await runner({ args: ['runs', 'create', '--contract', contract] })
  let action = created.agent_actions[0]
  const planningTask = JSON.parse(await readFile(action.task_path, 'utf8'))
  const planningBinding = ['--data-root', dataRoot, '--run-id', created.run_id, '--action-id', action.action_id, '--task-id', 'fixture-planner']
  await runner({ args: ['adapter', 'bind', ...planningBinding] })
  const unitFile = path.join(dataRoot, 'unit.json')
  await writeFile(unitFile, JSON.stringify({ title: 'Product', purpose: 'Product API fixture', owned_files: planningTask.owned_scope_paths }))
  const plan = await runner({ args: ['plan-write', ...planningBinding, '--expected-revision', '0', '--unit-file', unitFile] })
  await runner({ args: ['work-finish', ...planningBinding, '--revision', String(plan.revision)] })
  await runner({ args: ['adapter', 'settle', '--data-root', dataRoot, '--run-id', created.run_id, '--action-id', action.action_id] })
  const progress = JSON.parse(await readFile(path.join(dataRoot, 'runs/reference-smoke/progress.json'), 'utf8'))
  action = Object.values(progress.actions).find(value => value.role === 'analysis')
  assert.ok(action, 'existing analysis worker receives the reference index')
  const binding = ['--data-root', dataRoot, '--run-id', created.run_id, '--action-id', action.action_id, '--task-id', 'fixture-worker']
  await runner({ args: ['adapter', 'bind', ...binding] })
  const opened = await runner({ args: ['task-open', ...binding] })
  assert.equal(opened.task.test_tool_reference_paths, undefined)
  const deferred = opened.task.deferred_fields.test_tool_reference_paths
  assert.equal(deferred.input_id, 'task:test_tool_reference_paths'); assert.equal(deferred.count, 61)
  let cursor, content = '', pages = 0
  do {
    const page = await runner({ args: ['input-read', ...binding, '--input-id', deferred.input_id, '--max-chars', '2000', ...(cursor ? ['--cursor', cursor] : [])] })
    content += page.text; cursor = page.next_cursor; pages++
  } while (cursor)
  const references = JSON.parse(content)
  assert.equal(references.length, 61); assert.ok(pages > 1)
  assert.ok(references.some(file => file.repo_id === 'tools' && file.path === 'scripts/check.py'))
  const source = await runner({ args: ['source-read', ...binding, '--repo-id', 'tools', '--path', 'scripts/check.py'] })
  assert.match(JSON.stringify(source), /MUST NOT EXECUTE/)

  const manifest = JSON.parse(await readFile(path.join(dataRoot, 'runs/reference-smoke/inputs/source-manifest.json'), 'utf8'))
  assert.ok(manifest.scope_expansion.groups.every(group => !group.code_paths.includes('scripts/check.py')))
  assert.ok(manifest.scope_expansion.groups.some(group => group.repo_id === 'tools' && group.context_paths.includes('scripts/check.py')))
  // Like source previews, the receipt confirms the expanded file set; bytes freeze at creation.
  await writeFile(path.join(dataRoot, 'repositories/tools/scripts/new.py'), '# new reference')
  await assert.rejects(confirmTestTools({ ...input, test_tool_preview_id: preview.preview_id, expected_test_tool_revision: preview.scope_revision }, runner), { statusCode: 409 })
})

test('tool preview errors stay visible and retry can establish a new confirmation', async () => {
  const { React, render } = harness(), Component = createTestToolPicker(React, () => null)
  let preview = { preview_id: 'old' }, fail = true
  const props = { cwd: '/fixture', repositories: ['tools'], sources: [{ repo_id: 'tools', paths: ['scripts'] }], onPreview(value) { preview = value } }
  const previous = globalThis.fetch
  globalThis.fetch = async () => ({ ok: !fail, json: async () => fail ? { error: '读取失败' } : { status: 'ok', preview_id: 'fresh', matched_file_count: 1 } })
  try {
    nodes(render(Component, props)).find(n => n.type === 'button' && text(n) === '预览最终工具参考文件').props.onClick()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(preview, null); assert.match(text(render(Component, props)), /工具参考预览失败：读取失败/)
    fail = false
    nodes(render(Component, props)).find(n => n.type === 'button' && text(n) === '预览最终工具参考文件').props.onClick()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(preview.preview_id, 'fresh'); assert.doesNotMatch(text(render(Component, props)), /工具参考预览失败/)
  } finally { globalThis.fetch = previous }
})

test('directory picker rejects root-shaped drafts and invalid relative paths before preview or confirmation', async () => {
  const { isSubdirectoryPath } = await import('../src/source-scope-picker.js')
  for (const value of ['', ' ', '.', './', './/.', '../src', 'src/..', '/src', '\\src', 'C:src', 'C:\\src', '\\\\host\\src', 'bad\0path']) assert.equal(isSubdirectoryPath(value), false, value)
  for (const value of ['src', './src', 'src/.', '中文 空格,目录', 'src\\nested']) assert.equal(isSubdirectoryPath(value), true, value)
  const { React, render } = harness(), Component = createSourceScopePicker(React)
  let changes = 0
  const props = { cwd: '/fixture', repository: 'repo', value: '.', onChange() { changes++ }, onPreview() {} }
  const previous = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 'ok', path: '.', entries: [] }) })
  try {
    let tree = render(Component, props)
    assert.equal(nodes(tree).find(n => n.type === 'button' && text(n) === '预览命中文件').props.disabled, true)
    nodes(tree).find(n => n.type === 'button' && text(n) === '选择下级目录').props.onClick()
    await new Promise(resolve => setImmediate(resolve))
    tree = render(Component, props)
    const finish = nodes(tree).find(n => n.type === 'button' && text(n) === '完成选择')
    assert.equal(finish.props.disabled, true)
    finish.props.onClick()
    assert.equal(changes, 0)
    assert.equal(nodes(render(Component, props)).some(n => n.props.role === 'dialog'), true)
  } finally { globalThis.fetch = previous }
})

test('selected ghosts and legacy files can be removed, cancelled, cleared, and replaced', async () => {
  const { React, render } = harness(), Component = createSourceScopePicker(React)
  const changes = [], previews = []
  let props = { cwd: '/fixture', repository: 'repo', value: 'missing-dir\nold/file.c', onChange(value) { changes.push(value); props = { ...props, value } }, onPreview(value) { previews.push(value) } }
  const previous = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 'ok', path: '.', entries: [{ name: 'new-src', path: 'new-src', kind: 'directory', selectable: true }] }) })
  const draw = () => render(Component, props)
  const button = label => nodes(draw()).find(n => n.type === 'button' && (text(n) === label || n.props['aria-label'] === label))
  const open = async () => { button('选择下级目录').props.onClick(); await new Promise(resolve => setImmediate(resolve)) }
  try {
    await open()
    button('移除已选范围 missing-dir').props.onClick()
    button('取消').props.onClick()
    assert.deepEqual(changes, []); assert.deepEqual(previews, [])
    await open()
    assert.ok(button('移除已选范围 missing-dir'))
    button('移除已选范围 missing-dir').props.onClick()
    button('移除已选范围 old/file.c').props.onClick()
    assert.equal(button('清空选择').props.disabled, false)
    button('清空选择').props.onClick()
    assert.deepEqual(changes, ['']); assert.deepEqual(previews, [null])
    assert.equal(button('预览命中文件').props.disabled, true)
    // Direct invocation cannot turn the empty selection into a preview.
    button('预览命中文件').props.onClick()
    assert.match(text(draw()), /请选择真实存在/)
    await open()
    nodes(draw()).find(n => n.type === 'input' && n.props.type === 'checkbox').props.onChange()
    button('完成选择').props.onClick()
    assert.equal(props.value, 'new-src'); assert.equal(button('预览命中文件').props.disabled, false)
    await open()
    button('移除已选范围 new-src').props.onClick()
    button('取消').props.onClick()
    assert.equal(props.value, 'new-src')
    await open(); assert.ok(button('移除已选范围 new-src'))
  } finally { globalThis.fetch = previous }
})

function effectHarness() {
  const hooks = [], effects = []; let index = 0, pending = []
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) { const key = index++; if (!(key in hooks)) hooks[key] = initial; return [hooks[key], value => { hooks[key] = value }] },
    useRef(initial) { const key = index++; return hooks[key] ??= { current: initial } },
    useEffect(effect, deps) { const key = index++, previous = effects[key]; if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) pending.push(() => { previous?.cleanup?.(); effects[key] = { deps, cleanup: effect() } }) },
  }
  return { React, render(Component, props) { index = 0; pending = []; const tree = Component(props); for (const run of pending) run(); return tree }, unmount() { for (const effect of effects) effect?.cleanup?.() } }
}

test('late source previews cannot revive after repository changes, clearing, or picker unmount', async () => {
  const h = effectHarness(), Component = createSourceScopePicker(h.React), previews = [], pending = []
  const previous = globalThis.fetch
  globalThis.fetch = () => new Promise(resolve => pending.push(resolve))
  let props = { cwd: '/fixture', repository: 'old', value: 'old-src', onChange() {}, onPreview(value) { if (value) previews.push(value) } }
  const render = () => h.render(Component, props)
  const preview = () => nodes(render()).find(n => n.type === 'button' && text(n) === '预览命中文件').props.onClick()
  const finish = resolve => resolve({ ok: true, json: async () => ({ status: 'ok', matched_file_count: 1, files: [] }) })
  try {
    render(); preview()
    props = { ...props, repository: 'new', value: '' }; render(); render()
    finish(pending.shift()); await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(previews, [])
    props = { ...props, value: 'new-src' }; render(); preview()
    props = { ...props, value: '' }; render(); render()
    finish(pending.shift()); await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(previews, [])
    props = { ...props, value: 'new-src' }; render(); preview()
    h.unmount(); finish(pending.shift()); await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(previews, [])
  } finally { globalThis.fetch = previous }
})
