import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Readable } from 'node:stream'
import { listViews, loadView, viewArtifact } from '../src/architecture-views.js'
import { workbenchRouteHandler, architectureArtifactRoute } from '../src/index.js'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-archive-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, '.agents/pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents/pangea/dsh.md'), '# archive fixture')
  const task = { task_id: 'task', run_id: 'run', workspace: root, data_root: root }
  const run = path.join(root, 'runs', task.run_id)
  await mkdir(run, { recursive: true })
  await writeFile(path.join(run, 'progress.json'), '{"lifecycle_status":"complete"}')
  const archive = path.join(run, '派生视图', 'archify')
  async function view(id, extra = {}, files = {}) {
    const folder = path.join(archive, id)
    await mkdir(folder, { recursive: true })
    await writeFile(path.join(folder, 'manifest.json'), JSON.stringify({
      task_id: task.task_id, run_id: task.run_id, view_id: id, type: 'sequence', status: 'generating',
      created_at: '2026-10-20T00:00:00.000Z', ...extra,
    }))
    for (const [name, value] of Object.entries(files)) await writeFile(path.join(folder, name), value)
    return folder
  }
  return { root, task, run, archive, view }
}

const digest = value => createHash('sha256').update(value).digest('hex')
const unexpected = new Proxy({}, { get(_object, property) { assert.fail(`archive must not access runtime service ${String(property)}`) } })

async function action(task, action, payload = {}) {
  const req = Readable.from([JSON.stringify({ action, task_id: task.task_id, ...payload })])
  Object.assign(req, { method: 'POST', url: '/api/pangea-companion/workbench?' + new URLSearchParams({ cwd: task.workspace }),
    headers: { 'sec-fetch-site': 'same-origin' } })
  const result = {}
  await workbenchRouteHandler(req, { writeHead(code) { result.code = code }, end(body) { result.body = JSON.parse(body) } },
    unexpected, { get: async () => task }, new Set(), unexpected, unexpected, unexpected, async () => assert.fail('no backend invocation'))
  return result
}

test('listing a Run without historic diagrams is read-only and does not create an archive', async t => {
  const f = await fixture(t)
  assert.deepEqual(await listViews(f.task), [])
  assert.deepEqual(await readdir(f.run), ['progress.json'])
  const listed = await action(f.task, 'architecture-list')
  assert.equal(listed.code, 200)
  assert.deepEqual(listed.body.views, [])
  assert.equal(listed.body.read_only, true)
})

test('historic ready, draft, failed and interrupted views remain readable without Jobs or writes', async t => {
  const f = await fixture(t)
  const ready = await f.view('ready', {}, {
    'candidate.json': '{}', 'validation-receipt.json': JSON.stringify({ ok: true, candidate_sha256: digest('{}') }),
    'diagram.html': '<html><svg><text>原有时序图</text></svg></html>', 'diagram.svg': '<svg><text>原有时序图</text></svg>',
  })
  const draft = await f.view('draft', { status: 'failed', error: '旧布局未通过' }, {
    'validation-receipt.json': JSON.stringify({ ok: false, draft: { output: 'draft.html' }, error: '旧布局未通过' }),
    'draft.html': '<html>旧草稿</html>',
  })
  const pending = await f.view('pending', { job_id: 'old-job', execution_status: 'running' })
  const before = await Promise.all([ready, draft, pending].map(folder => readFile(path.join(folder, 'manifest.json'), 'utf8')))
  const result = await action(f.task, 'architecture-list')
  assert.equal(result.code, 200)
  assert.ok(result.body.views.every(view => view.read_only && view.archived && view.execution_status === 'archived'))
  assert.equal(result.body.views.find(view => view.view_id === 'ready').available, true)
  assert.equal(result.body.views.find(view => view.view_id === 'draft').preview_kind, 'draft')
  assert.equal(result.body.views.find(view => view.view_id === 'pending').status, 'interrupted')
  assert.match((await viewArtifact(f.task, 'ready', 'svg')).toString(), /原有时序图/)
  assert.equal((await viewArtifact(f.task, 'draft', 'html', 'draft')).toString(), '<html>旧草稿</html>')
  assert.deepEqual(await Promise.all([ready, draft, pending].map(folder => readFile(path.join(folder, 'manifest.json'), 'utf8'))), before)
  assert.equal(await readFile(path.join(f.run, 'progress.json'), 'utf8'), '{"lifecycle_status":"complete"}')
})

test('changed call graph draft does not hide its preserved previous validated graph', async t => {
  const f = await fixture(t)
  const graph = { format_version: 'call-graph-v1', title: '旧函数图', functions: [{ id: 'f' }], calls: [], variables: [] }
  await f.view('calls', { renderer: 'call-graph', profile: 'function_variables' }, {
    'candidate.json': 'invalid later draft',
    'graph.json': JSON.stringify(graph), 'graph.svg': '<svg><text>f</text></svg>',
    'validation-receipt.json': JSON.stringify({ ok: true, status: 'partial', candidate_sha256: digest('old candidate'), errors: ['旧待确认'] }),
  })
  const [view] = await listViews(f.task)
  assert.equal(view.available, false)
  assert.equal(view.preview_available, true)
  assert.equal(view.preview_is_previous, true)
  assert.deepEqual(JSON.parse((await viewArtifact(f.task, 'calls', 'json')).toString()), graph)
  assert.match((await viewArtifact(f.task, 'calls', 'svg')).toString(), /<text>f/)
})

test('retired create, validate and stop actions never start sessions, workers or renderers', async t => {
  const f = await fixture(t)
  for (const name of ['architecture-create', 'architecture-validate', 'architecture-stop']) {
    const result = await action(f.task, name, { type: 'sequence', profile: 'function_variables', view_id: 'old' })
    assert.equal(result.code, 400)
    assert.match(result.body.error, /独立生图已移除/)
  }
  assert.deepEqual(await readdir(f.run), ['progress.json'])
})

test('archive retains task, path and same-origin boundaries', async t => {
  const f = await fixture(t)
  const folder = await f.view('safe', {}, { 'validation-receipt.json': '{"ok":true}', 'diagram.html': 'safe' })
  await assert.rejects(loadView({ ...f.task, task_id: 'other' }, 'safe'), /binding mismatch/)
  await assert.rejects(viewArtifact(f.task, '../outside', 'html'), /identity/)
  await assert.rejects(viewArtifact(f.task, 'safe', 'js'), /Unsupported/)
  const req = { method: 'GET', url: '/api/pangea-companion/architecture-artifact', headers: { 'sec-fetch-site': 'cross-site' } }
  let code
  await architectureArtifactRoute(req, { writeHead(value) { code = value }, end() {} }, { get() { assert.fail('cross-origin must not read task') } })
  assert.equal(code, 403)
  const outside = path.join(f.root, 'outside.html')
  await writeFile(outside, 'outside secret')
  await rm(path.join(folder, 'diagram.html'))
  try { await symlink(outside, path.join(folder, 'diagram.html')) } catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) { t.diagnostic('symlink boundary requires local symlink capability'); return }
    throw error
  }
  await assert.rejects(viewArtifact(f.task, 'safe', 'html'), /outside view directory/)
})
