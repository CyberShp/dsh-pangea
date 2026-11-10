import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { readSupplementalSourceManifest, readSavedSupplementalSources } from '../src/source.js'
import { buildOfflineReport } from '../src/offline-report.js'
import { workerPrompt, workerContinuationPrompt } from '../src/source-first-acp.js'

test('ACP initial and resumed workers keep explicit repository-local policy, legacy stays bounded', () => {
  for (const make of [workerPrompt, workerContinuationPrompt]) {
    const args = { action: { action_id: 'r:a', stage: 'unit_analysis', role: 'analysis' }, opened: { task: { source_investigation_policy: 'repository-local-v1' } }, cwd: '/work', dataRoot: '/data', runId: 'r', taskId: 't' }
    assert.match(make(args), /不访问未选仓库、仓外目录/)
    assert.match(make(args), /不自动增加分析单元、全文件或全仓覆盖义务/)
    assert.match(make(args), /scan_complete/)
    assert.match(make({ ...args, opened: { task: {} } }), /旧任务仍沿用原冻结范围/)
  }
})

test('saved supplemental source survives original removal, exports inert text and validates integrity', async t => {
  const run = await mkdtemp(path.join(tmpdir(), 'supplemental-'))
  t.after(() => rm(run, { recursive: true, force: true }))
  const content = '<script>alert(1)</script>\nint dependency() { return 7; }\n'
  await mkdir(path.join(run, 'inputs/source/repo/A'), { recursive: true })
  await writeFile(path.join(run, 'inputs/source/repo/A/helper.c'), content)
  const item = { repo_id: 'repo', path: 'A/helper.c', bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex'), action_id: 'r:a' }
  const manifest = path.join(run, 'inputs/source-supplemental.json')
  await writeFile(manifest, JSON.stringify({ format_version: 'pangea-source-supplemental-v1', files: [item] }))
  const sources = await readSavedSupplementalSources(run)
  assert.equal(sources[0].content, content)
  const report = buildOfflineReport({ run_id: 'r', source_snapshot: { supplemental_files: [item] } }, { supplementalSources: sources })
  const entries = new Map(report.entries)
  assert.equal(entries.get('sources/source-1.txt'), content)
  assert.match(entries.get('sources/source-1.html'), /id="L2"/)
  assert.doesNotMatch(entries.get('sources/source-1.html'), /<script>/)
  assert.match(report.html, /sources\/source-1.html/)
  await writeFile(path.join(run, 'inputs/source/repo/A/helper.c'), 'corrupt')
  await assert.rejects(readSavedSupplementalSources(run), /校验失败/)
  await writeFile(manifest, JSON.stringify({ format_version: 'pangea-source-supplemental-v1', files: [{ ...item, path: '../other/file' }] }))
  await assert.rejects(readSupplementalSourceManifest(run), /越界/)
})

test('saved supplemental source rejects repository symlink escape and absent manifest stays empty', async t => {
  const run = await mkdtemp(path.join(tmpdir(), 'supplemental-boundary-'))
  t.after(() => rm(run, { recursive: true, force: true }))
  assert.deepEqual(await readSavedSupplementalSources(run), [])
  await mkdir(path.join(run, 'inputs/source'), { recursive: true })
  await mkdir(path.join(run, 'outside'))
  await writeFile(path.join(run, 'outside/file.c'), 'x')
  await symlink(path.join(run, 'outside'), path.join(run, 'inputs/source/repo'))
  await writeFile(path.join(run, 'inputs/source-supplemental.json'), JSON.stringify({ format_version: 'pangea-source-supplemental-v1', files: [{ repo_id: 'repo', path: 'file.c', bytes: 1, sha256: createHash('sha256').update('x').digest('hex') }] }))
  await assert.rejects(readSavedSupplementalSources(run), /越出仓库/)
})

test('repository-local creation requires engine capability and derived runs retain original boundary', async () => {
  const { normalizeRunInput, deriveAnalysisInput } = await import('../src/workbench-api.js')
  const capabilities = { repositories: ['repo'], workflow_versions: ['source-first-v1'], source_first: { version: 'source-first-v1', contract_fields: ['source_investigation_policy'] } }
  const input = { repository: 'repo', target: 'trace call', source_scope: ['D'], source_investigation_policy: 'repository-local-v1' }
  assert.equal(normalizeRunInput(input, capabilities).source_investigation_policy, 'repository-local-v1')
  assert.throws(() => normalizeRunInput(input, { ...capabilities, source_first: { version: 'source-first-v1' } }), /不支持仓内追查/)
  assert.equal(normalizeRunInput({ ...input, source_investigation_policy: null }, capabilities).source_investigation_policy, null)
  const incremental = { mode: 'supplement', instruction: 'trace dependency', selected_unit_ids: ['unit'], selected_records: [], changed_paths: [] }
  const options = { can_derive: true, parent_run_id: 'r', units: [{ unit_id: 'unit' }], records: [] }
  for (const policy of [undefined, 'repository-local-v1']) {
    assert.equal(deriveAnalysisInput({ ...input, run_id: 'r', source_investigation_policy: policy }, incremental, options).source_investigation_policy, policy ?? null)
  }
})

test('task persistence does not silently opt legacy work into repository-local access', async t => {
  const { createTaskStore } = await import('../src/task-store.js')
  const root = await mkdtemp(path.join(tmpdir(), 'scope-task-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const storePath = path.join(root, 'tasks.json')
  const store = createTaskStore({ storePath })
  for (const policy of [undefined, 'repository-local-v1']) {
    const created = await store.create({ workspace: root, input: { repository: 'repo', target: 'trace', source_scope: ['D'], source_investigation_policy: policy } })
    assert.equal(created.source_investigation_policy, policy ?? null)
    const reopened = createTaskStore({ storePath })
    assert.equal((await reopened.get(created.task_id)).source_investigation_policy, policy ?? null)
  }
})
