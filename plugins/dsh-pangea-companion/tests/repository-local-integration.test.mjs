import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRun, runPangea } from '../src/pangea-api.js'
import { createSourceFirstAcpRun } from '../src/source-first-acp.js'
import { sourceFirstTools } from '../src/index.js'
import { companionSnapshot } from '../src/reader.js'
import { readSavedSupplementalSources, readEvidenceSnippet } from '../src/source.js'
import { buildOfflineReport } from '../src/offline-report.js'

for (const transport of ['dsh-bound-tools', 'acp-cli']) test(`repository-local investigation through ${transport} and real Graph`, {
  skip: !process.env.PANGEA_INTEGRATION_RUNTIME && 'Requires staged Python runtime', timeout: 60000,
}, async t => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'repository-local-integration-'))
  const previous = process.env.PYTHONPATH
  process.env.PYTHONPATH = [path.join(process.env.PANGEA_INTEGRATION_RUNTIME, 'src'), previous].filter(Boolean).join(path.delimiter)
  const controller = new AbortController()
  let run
  t.after(async () => {
    controller.abort(); await run?.dispose()
    if (previous === undefined) delete process.env.PYTHONPATH; else process.env.PYTHONPATH = previous
    await rm(cwd, { recursive: true, force: true })
  })
  await cp(path.join(process.env.PANGEA_INTEGRATION_RUNTIME, '.agents'), path.join(cwd, '.agents'), { recursive: true })
  for (const [file, content] of [['total/D/entry.c', 'int entry(void) { return helper(); }\n'], ['total/A/helper.c', 'int helper(void) { return 42; }\n'], ['other/hidden.c', 'int hidden(void) { return -1; }\n']]) {
    const target = path.join(cwd, 'pangea-data/repositories', file)
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content)
  }
  const created = await createRun(cwd, { repository: 'total', target: 'entry dependency', source_scope: ['D'], mode: 'depth', source_investigation_policy: 'repository-local-v1' })
  const registered = new Map()
  sourceFirstTools({ tools: { register(tool) { registered.set(tool.name, tool); return () => {} } } })
  let count = 0, investigations = 0
  run = createSourceFirstAcpRun({ providerId: 'pangea-codeagent', parent: {}, cwd, dataRoot: created.data_root, runId: created.run_id,
    signal: controller.signal, runner: runPangea,
    subagents: { start: async (_provider, request) => {
      const id = `local-policy-worker-${++count}`
      await mkdir(request.scratchDirectory, { recursive: true })
      return { id, result: Promise.resolve({ stopReason: 'completed' }), dispose: async () => {}, continuePrompt: async prompt => {
        const text = prompt[0].text
        assert.match(text, /repository-local-v1/)
        const binding = JSON.parse(text.split('\n').find(line => line.startsWith('每次 CLI')).split('：').slice(1).join('：'))
        const call = (command, args = []) => runPangea({ cwd, args: [command, ...binding, ...args] })
        const fields = Object.fromEntries(Array.from({ length: binding.length / 2 }, (_, i) => [binding[i * 2].slice(2).replaceAll('-', '_'), binding[i * 2 + 1]]))
        const opened = await call('task-open')
        assert.equal(opened.task.source_investigation_policy, 'repository-local-v1')
        if (opened.task.task_type === 'source_first_analysis') {
          investigations++
          const tool = (name, args) => registered.get(name).execute({ ...fields, ...args }, { agent: { session: { header: { cwd } } } })
          const read = (repo, file) => transport === 'dsh-bound-tools' ? tool('pangea_source_read', { repo_id: repo, path: file }) : call('source-read', ['--repo-id', repo, '--path', file, '--view', 'text'])
          const index = transport === 'dsh-bound-tools' ? await tool('pangea_source_index', { repo_id: 'total', path: '.' }) : await call('source-index', ['--repo-id', 'total', '--path', '.'])
          assert.match(JSON.stringify(index), /A/)
          const search = transport === 'dsh-bound-tools' ? await tool('pangea_source_search', { repo_id: 'total', path: 'A', query: 'helper', page_size: 1 }) : await call('source-search', ['--repo-id', 'total', '--path', 'A', '--query', 'helper', '--page-size', '1'])
          assert.match(JSON.stringify(search), /helper/)
          assert.match(JSON.stringify(await read('total', 'A/helper.c')), /return 42/)
          await assert.rejects(read('other', 'hidden.c'))
          await assert.rejects(read('total', '../other/hidden.c'))
        }
        const current = await call('result-read')
        let saved
        if (opened.task.task_type === 'source_first_plan') {
          const file = path.join(request.scratchDirectory, 'plan.json')
          await writeFile(file, JSON.stringify([{ title: 'Entry', purpose: 'Trace entry dependency', owned_files: [{ repo_id: 'total', path: 'D/entry.c' }] }]))
          saved = await call('plan-write-batch', ['--expected-revision', String(current.revision), '--units-file', file, '--request-id', `${id}-plan`])
        } else {
          const file = path.join(request.scratchDirectory, 'records.json')
          await writeFile(file, JSON.stringify([{ kind: 'note', body: 'Deterministic transport fixture, not model quality validation.', evidence: ['total:A/helper.c:1'] }]))
          saved = await call('result-write', ['--expected-revision', String(current.revision), '--records-file', file])
        }
        await call('work-finish', ['--revision', String(saved.revision)])
        return { stopReason: 'completed' }
      } }
    } } })
  assert.equal((await run.result).stopReason, 'completed')
  assert.equal(investigations, 1)
  const snapshot = (await companionSnapshot({ dataRoot: created.data_root, runId: created.run_id })).current
  assert.equal(snapshot.source_snapshot.file_count, 1)
  assert.equal(snapshot.source_snapshot.supplemental_file_count, 1)
  assert.equal(snapshot.workflow.units.length, 1)
  const runRoot = path.join(created.data_root, 'runs', created.run_id)
  await rm(path.join(created.data_root, 'repositories'), { recursive: true })
  const saved = await readSavedSupplementalSources(runRoot)
  assert.equal(saved[0].path, 'A/helper.c')
  const preview = await readEvidenceSnippet({ location: 'total:A/helper.c:1', snapshotRoot: path.join(runRoot, 'inputs/source'), repositoryId: 'total', snapshotLayout: 'source-first' })
  assert.match(JSON.stringify(preview), /return 42/)
  const report = buildOfflineReport(snapshot, { supplementalSources: saved })
  assert.match(new Map(report.entries).get('sources/source-1.txt'), /return 42/)
  const initialManifest = JSON.parse(await readFile(path.join(runRoot, 'inputs/source-manifest.json'), 'utf8'))
  assert.doesNotMatch(JSON.stringify(initialManifest), /A\/helper.c/)
})
