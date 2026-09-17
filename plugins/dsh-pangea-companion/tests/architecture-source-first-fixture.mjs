import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Synthetic existing Run; deliberately no 内部索引 or Archify-specific input.
export async function writeArchitectureRun(dataRoot) {
  const runId = 'tls-260917-01', unit = 'tls', actionId = `${runId}:analysis:${unit}`
  const run = path.join(dataRoot, 'runs', runId)
  const taskPath = path.join(run, 'agent-tasks', 'analysis.json')
  const resultPath = path.join(run, 'agent-results', 'analysis.json')
  const json = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value, null, 2)) }
  const nodes = ['A', 'B', 'C', 'D'].map(id => ({ id, label: id, description: `Stage ${id}` }))
  const flow = { title: 'TLS session', nodes, edges: [{ source_step_key: 'A', target_step_key: 'B' }, { source_step_key: 'B', target_step_key: 'D' }, { source_step_key: 'A', target_step_key: 'C' }, { source_step_key: 'C', target_step_key: 'D' }],
    paths: [{ path_id: 'normal', node_ids: ['A', 'B', 'D'], case_ids: ['c1'] }, { path_id: 'reject', node_ids: ['A', 'C', 'D'], case_ids: ['c2'] }] }
  const records = [
    { record_id: 'old', kind: 'flow', body: { title: 'Retired flow' } },
    { record_id: 'flow', kind: 'flow', body: flow, supersedes: ['old'], evidence: ['repo:tls.c:1'] },
    { record_id: 'c1', kind: 'test_case', body: { title: 'Connect', flow_refs: ['flow'] } },
    { record_id: 'c2', kind: 'test_case', body: { title: 'Reject', flow_refs: ['flow'] } },
    { record_id: 'other', kind: 'flow', body: { title: 'Unrelated flow', nodes: [{ id: 'X', label: 'Unrelated' }] }, evidence: ['repo:other.c:1'] },
  ]
  await json(path.join(run, 'inputs', 'task-contract.json'), { workflow_version: 'source-first-v1', target: 'TLS', repository: 'repo' })
  await json(path.join(run, 'inputs', 'source-manifest.json'), { workflow_version: 'source-first-v1', repositories: [{ repo_id: 'repo', source_root: path.join(run, 'inputs', 'repo') }], requested_scope: ['tls.c'] })
  await json(path.join(run, 'inputs', 'source-index.json'), { format_version: 'pangea-source-index-v1', files: [{ repo_id: 'repo', path: 'tls.c' }], file_count: 1 })
  await mkdir(path.join(run, 'inputs', 'repo'), { recursive: true })
  await writeFile(path.join(run, 'inputs', 'repo', 'tls.c'), 'int tls_open(void) { return 0; }\n')
  await json(taskPath, { unit_id: unit, result_path: resultPath, task_type: 'source_first_analysis' })
  await json(resultPath, { format_version: 'pangea-notes-v1', binding: { run_id: runId, action_id: actionId, task_id: 'worker' }, revision: 3, records })
  await json(path.join(run, 'progress.json'), { run_id: runId, workflow_version: 'source-first-v1', lifecycle_status: 'complete', stage: 'complete',
    actions: { [actionId]: { stage: 'unit_analysis', role: 'analysis', task_path: taskPath, task_id: 'worker', status: 'accepted' } }, accepted_revisions: { [actionId]: 3 } })
  await writeFile(path.join(run, 'report.md'), '# Existing TLS analysis\n')
  await writeFile(path.join(run, 'report.html'), '<h1>Existing TLS analysis</h1>')
  await json(path.join(run, 'report-complete.json'), { files: ['report.md', 'report.html'] })
  return { task: { task_id: 'architecture-upgrade', run_id: runId, data_root: dataRoot, target: 'TLS' }, run, resultPath, actionId, flowId: `${unit}/flow` }
}
