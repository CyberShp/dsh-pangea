import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildRunInsights } from '../src/run-insights.js'
import { summarizeRun } from '../src/reader.js'

const record = (id, kind, body, extra = {}) => ({ record_id: id, kind, body, created_revision: 1, ...extra })
function action(id, stage, records, options = {}) {
  const revision = options.revision ?? 2
  return { action_id: id, stage, unit_id: options.unit_id ?? 'u1', revision, records,
    status: 'accepted', saved_revision: revision, last_saved_at_ms: 1000, ...options }
}
function run(actions = [], extra = {}) {
  return {
    run_id: 'run1', workflow_version: 'source-first-v1', lifecycle_status: 'running', stage: 'analyzing', target: '认证模块',
    workflow: { steps: [{ step: '02', stage: 'planning', title: '规划', status: 'completed' },
      { step: '03', stage: 'analyzing', title: '业务分析', status: 'running' },
      { step: '04', stage: 'reviewing', title: '复核', status: 'pending' },
      { step: '05', stage: 'closing', title: '修正', status: 'pending' }],
      units: [{ unit_id: 'u1', title: '认证协商', owned_regions: ['region:auth'] }, { unit_id: 'u2', title: '连接恢复' }],
      actions: actions.map(({ records, ...value }) => value) },
    source_first_records: actions.map(({ action_id, stage, unit_id, revision, records }) => ({ action_id, stage, unit_id, revision, records })),
    execution_view: { actions: actions.map(({ records, ...value }) => value), preserved: [], unresolved: [] },
    ...extra,
  }
}

test('selected stage shows saved substantive outputs, superseded records are removed and raw bodies preserved', () => {
  const data = run([
    action('plan', 'unit_planning', [record('p1', 'unit_plan', { unit_id: 'u1', title: '认证协商', purpose: '验证所有明确支持的配置路径' })]),
    action('analysis', 'unit_analysis', [record('old', 'flow', { title: '旧流程' }),
      record('new', 'flow', { title: '认证流程' }, { supersedes: ['old'], created_revision: 2 }),
      record('case', 'test_case', { title: '合法配置建链', variants: [{ input: 'A', expected: '成功' }, { input: 'B', expected: '成功' }] }),
      record('done', 'completion', { complete: true })], { status: 'dispatched' }),
    action('review', 'comparison_review', [record('finding', 'finding', { summary: 'review only' })]),
  ])
  const before = JSON.stringify(data)
  const result = buildRunInsights(data, '03')
  assert.equal(result.stage, 'analyzing')
  assert.equal(result.outputs.total_records, 2)
  assert.deepEqual(result.outputs.counts.map(item => [item.kind, item.count, item.draft]), [['flow', 1, 1], ['test_case', 1, 1]])
  assert.equal(result.scope.units[0].purpose, '验证所有明确支持的配置路径')
  assert.equal(result.current_work[0].title, '认证协商')
  assert.equal(result.outputs.latest.find(row => row.kind === 'test_case').record.body.variants.length, 2)
  assert.equal(JSON.stringify(data), before)
  assert.ok(!JSON.stringify(result).includes('旧流程'))
})

test('exact revision navigation does not resolve same local record ID in another action or a later revision', () => {
  const data = run([action('analysis', 'unit_analysis', [record('r1', 'flow', { title: '流程' })])])
  data.details = { business_flows: [
    { flow_id: 'wrong-action', source_record: { action_id: 'other', record_id: 'r1', revision: 2 } },
    { flow_id: 'wrong-version', source_record: { action_id: 'analysis', record_id: 'r1', revision: 3 } },
    { flow_id: 'correct', source_record: { action_id: 'analysis', record_id: 'r1', revision: 2 } },
  ] }
  const row = buildRunInsights(data, 'analyzing').outputs.latest[0]
  assert.deepEqual(row.navigation, { type: 'flow', id: 'correct' })
  assert.deepEqual(row.ref, { action_id: 'analysis', record_id: 'r1', revision: 2, unit_id: 'u1', stage: 'unit_analysis' })
  data.details.business_flows.push({ flow_id: 'duplicate', source_record: { action_id: 'analysis', record_id: 'r1', revision: 2 } })
  assert.equal(buildRunInsights(data, 'analyzing').outputs.latest[0].navigation, null)
})

test('delivery uses accepted or explicitly delivered closure, but unfinished closure does not replace analysis', () => {
  const data = run([
    action('analysis', 'unit_analysis', [record('old', 'test_case', { title: '原用例' })]),
    action('closure', 'targeted_closure', [record('old', 'test_case', { title: '原用例' }),
      record('new', 'test_case', { title: '修订用例' }, { supersedes: ['old'], created_revision: 3 })],
    { status: 'paused', revision: 3, saved_revision: 3 }),
  ])
  assert.equal(buildRunInsights(data, 'complete').outputs.latest[0].title, '原用例')
  const closure = buildRunInsights(data, 'closing')
  assert.equal(closure.outputs.latest[0].title, '修订用例')
  assert.equal(closure.outputs.counts[0].draft, 1)
  for (const rows of [data.workflow.actions, data.execution_view.actions]) rows.find(item => item.action_id === 'closure').delivery_revision = 3
  data.partial_delivery = true
  const delivered = buildRunInsights(data, 'complete')
  assert.equal(delivered.outputs.total_records, 1)
  assert.equal(delivered.outputs.latest[0].title, '修订用例')
  assert.equal(delivered.outputs.counts[0].delivered, 1)
  assert.ok(delivered.notices.some(item => item.code === 'partial_delivery'))
  assert.ok(buildRunInsights(data, 'analyzing').notices.some(item => item.code === 'stage_history'))
})

test('copied closure seed is not new saved work and missing or mismatched results are not zero success', () => {
  const data = run([
    action('seed', 'targeted_closure', [record('copied', 'test_case', { title: '底稿' })], { status: 'dispatched' }),
    action('missing', 'targeted_closure', null, { revision: null, saved_revision: null, unit_id: 'u2', status: 'paused' }),
  ])
  data.execution_view.preserved = [{ action_id: 'seed', acceptance: 'seed' }]
  const result = buildRunInsights(data, 'closing')
  assert.equal(result.availability, 'unavailable')
  assert.equal(result.outputs.total_records, null)
  assert.equal(result.last_saved_at_ms, null)
  assert.ok(result.notices.some(item => item.code === 'pending_binding'))
  const mismatched = run([action('a', 'unit_analysis', [record('r', 'flow', { title: 'unauthorized revision' })], { accepted_revision: 1 })])
  assert.equal(buildRunInsights(mismatched, 'analyzing').availability, 'unavailable')
  assert.equal(buildRunInsights(mismatched, 'analyzing').outputs.latest.length, 0)
})

test('review pending items come only from explicit correction selection or unresolved kind, never prose keywords', () => {
  const data = run([action('review', 'comparison_review', [
    record('retired', 'finding', { summary: '旧问题' }),
    record('selected', 'finding', { summary: '补齐模式 B', body: '完整原文', recommended_action: '增加 B 的业务用例' }, { supersedes: ['retired'] }),
    record('not-selected', 'finding', { summary: '未选中的候选' }),
    record('note', 'note', 'FAILED unresolved 必须修复 —— 这只是说明原文'),
    record('u', 'unresolved', { title: '外部设施待确认', reason: '缺少报文注入设施', recommended_action: '核实设备能力', status: 'RESOLVED in prose' }),
    record('decision', 'review_decision', { disposition: 'finding', correction_record_ids: ['selected'] }),
  ])])
  const result = buildRunInsights(data, 'reviewing')
  assert.deepEqual(result.pending.map(item => item.ref.record_id), ['selected', 'u'])
  assert.equal(result.pending[0].title, '补齐模式 B')
  assert.equal(result.pending[0].action, '增加 B 的业务用例')
  assert.equal(result.pending[1].reason, '缺少报文注入设施')
  data.source_first_records[0].records.push(record('pass', 'review_decision', { disposition: 'pass' }, { supersedes: ['decision'] }))
  assert.deepEqual(buildRunInsights(data, 'reviewing').pending.map(item => item.ref.record_id), ['u'])
})

test('stale and stopped snapshots stay explicitly historical; old timestamps never mean stalled', () => {
  const data = run([action('a', 'unit_analysis', [record('r', 'flow', { title: '流程' })], { status: 'dispatched', last_saved_at_ms: 1 })], { lifecycle_status: 'stopped' })
  const stale = buildRunInsights(data, 'analyzing', { stale: true })
  assert.equal(stale.current_work[0].state, 'last_observed')
  assert.equal(stale.last_saved_at_ms, 1)
  assert.ok(stale.notices.some(item => item.code === 'stale'))
  assert.ok(stale.notices.some(item => item.code === 'stopped'))
  assert.ok(!JSON.stringify(stale).includes('卡住'))
  assert.equal(buildRunInsights(data, 'analyzing').current_work[0].state, 'stopped')
})

test('unreadable sibling leaves exact lower-bound counts and missing data never becomes an empty completed result', () => {
  const data = run([
    action('good', 'unit_analysis', [record('r', 'flow', { title: '可读流程' })]),
    action('bad', 'unit_analysis', [], { revision: null, saved_revision: null, unit_id: 'u2' }),
  ])
  const result = buildRunInsights(data, 'analyzing')
  assert.equal(result.availability, 'partial')
  assert.equal(result.outputs.total_records, 1)
  assert.equal(result.outputs.complete, false)
  assert.deepEqual(result.notices.find(item => item.code === 'unreadable').action_ids, ['bad'])
  delete data.source_first_records
  assert.equal(buildRunInsights(data, 'analyzing').availability, 'unavailable')
  assert.equal(buildRunInsights(run(), 'reviewing').availability, 'not_started')
  assert.equal(buildRunInsights({ workflow_version: 'legacy-v1' }, '03').availability, 'unsupported')
})

test('limit only affects visible rows, counts and explicit execution blockers are stage scoped', () => {
  const data = run([action('a', 'unit_analysis', Array.from({ length: 9 }, (_, index) => record(`r${index}`, 'test_case', { title: `用例${index}` })), { status: 'paused' })])
  data.execution_view.unresolved = [{ action_id: 'a', unit_id: 'u1', status: 'paused', reason: '宿主要求恢复原任务' },
    { action_id: 'review', status: 'paused', reason: '其他阶段' }]
  const result = buildRunInsights(data, 'analyzing')
  assert.equal(result.outputs.total_records, 9)
  assert.equal(result.outputs.latest.length, 6)
  assert.equal(result.outputs.more, 3)
  assert.equal(result.pending.length, 1)
  assert.equal(result.pending[0].reason, '宿主要求恢复原任务')
  assert.equal(buildRunInsights(data, 'analyzing', { limit: 99 }).outputs.latest.length, 9)
  assert.equal(result.outputs.latest[0].title, '用例8')
})

test('unknown record kinds cannot inherit object properties as display labels', () => {
  const result = buildRunInsights(run([action('a', 'unit_analysis', [record('r', 'constructor', { content: '原文' })])]), 'analyzing')
  assert.equal(result.outputs.latest[0].label, '其他记录')
  assert.equal(result.outputs.latest[0].record.body.content, '原文')
})

test('legacy closure_units selects only explicitly related findings and an explicit empty ID selection wins', () => {
  const data = run([action('review', 'comparison_review', [
    record('f1', 'finding', { summary: '单元一意见' }, { relates_to: ['u1'] }),
    record('f2', 'finding', { summary: '单元二意见' }, { relates_to: ['u2'] }),
    record('f3', 'finding', { summary: '正文提到 u1 但没有关联' }),
    record('d', 'review_decision', { disposition: 'finding', closure_units: ['u1'] }),
  ])])
  assert.deepEqual(buildRunInsights(data, 'reviewing').pending.map(row => row.ref.record_id), ['f1'])
  data.source_first_records[0].records.at(-1).body.correction_record_ids = []
  assert.deepEqual(buildRunInsights(data, 'reviewing').pending, [])
  data.source_first_records[0].records.push(record('u', 'review_decision', { disposition: 'unresolved', reason: '缺少确认条件' }, { supersedes: ['d'] }))
  assert.equal(buildRunInsights(data, 'reviewing').pending[0].declared_status, 'unresolved')
})

function reviewAndClosure(dispositions, options = {}) {
  return run([
    action('review', 'comparison_review', [
      record('f', 'finding', { summary: '补足配置组合用例' }, { relates_to: options.relates_to ?? ['u1'] }),
      record('d', 'review_decision', { disposition: 'finding', correction_record_ids: ['f'] }),
    ]),
    action('closure', 'targeted_closure', [record('case', 'test_case', { title: '补充的配置用例' }),
      record('summary', 'summary', { finding_dispositions: dispositions })], { revision: 3, saved_revision: 3, ...options.closure }),
  ], { stage: 'complete', lifecycle_status: 'complete' })
}

test('explicit accepted or rejected closure dispositions replace stale pending hints while the original disposition remains visible', () => {
  for (const disposition of ['accepted', 'rejected']) {
    const entry = { finding_record_id: 'f', disposition, reason: '原始处置理由；并未声称执行用例', updated_record_ids: ['case'] }
    const data = reviewAndClosure([entry])
    for (const stage of ['reviewing', 'reporting', 'complete']) assert.deepEqual(buildRunInsights(data, stage).pending, [])
    const result = buildRunInsights(data, 'complete', { limit: 99 })
    assert.equal(result.outputs.total_records, 4)
    assert.deepEqual(result.outputs.latest.find(row => row.kind === 'summary').record.body.finding_dispositions, [entry])
    assert.equal(result.outputs.latest.find(row => row.kind === 'finding').record.record_id, 'f')
    assert.ok(!Object.hasOwn(result.outputs, 'resolved'))
  }
})

test('legacy multi-unit finding needs dispositions only for units selected by its frozen decision', () => {
  const data = reviewAndClosure([{ finding_record_id: 'f', disposition: 'accepted', reason: '仅 u1 被选中补充' }], { relates_to: ['u1', 'u2'] })
  data.source_first_records.find(item => item.action_id === 'review').records.at(-1).body = { disposition: 'finding', closure_units: ['u1'] }
  assert.deepEqual(buildRunInsights(data, 'complete').pending, [])
  data.source_first_records.find(item => item.action_id === 'review').records.at(-1).body.closure_units.push('u2')
  assert.equal(buildRunInsights(data, 'complete').pending[0].ref.record_id, 'f')
})

test('unknown, unresolved, draft, conflicting, wrong-unit or ambiguous action dispositions cannot hide selected findings', () => {
  const entry = { finding_record_id: 'f', disposition: 'accepted', reason: '原始理由' }
  for (const data of [
    reviewAndClosure([{ ...entry, disposition: 'unresolved' }]),
    reviewAndClosure([{ ...entry, disposition: 'corrected' }]),
    reviewAndClosure([entry, { ...entry, disposition: 'rejected' }]),
    reviewAndClosure([entry], { closure: { status: 'paused' } }),
    reviewAndClosure([entry], { closure: { unit_id: 'u2' } }),
    reviewAndClosure([entry], { relates_to: ['u1', 'u2'] }),
  ]) assert.equal(buildRunInsights(data, 'complete').pending[0].ref.record_id, 'f')
  const ambiguous = reviewAndClosure([entry])
  const duplicate = action('another-review', 'comparison_review', [record('f', 'finding', { summary: '同 ID 的另一复核意见' }, { relates_to: ['u1'] })])
  ambiguous.workflow.actions.push(duplicate)
  ambiguous.source_first_records.push(duplicate)
  assert.equal(buildRunInsights(ambiguous, 'complete').pending[0].ref.action_id, 'review')
  ambiguous.source_first_records.find(item => item.action_id === 'closure').records.at(-1).body.finding_dispositions[0].finding_action_id = 'review'
  assert.deepEqual(buildRunInsights(ambiguous, 'complete').pending, [])
  const multiUnit = reviewAndClosure([entry], { relates_to: ['u1', 'u2'] })
  const secondClosure = action('closure-u2', 'targeted_closure', [record('summary-u2', 'summary', { finding_dispositions: [entry] })], { unit_id: 'u2' })
  multiUnit.workflow.actions.push(secondClosure)
  multiUnit.source_first_records.push(secondClosure)
  assert.deepEqual(buildRunInsights(multiUnit, 'complete').pending, [])
})

test('all active record kinds remain inspectable and observed units do not imply a known frozen plan', () => {
  const data = run([action('analysis', 'unit_analysis', [record('case', 'test_case', { title: '用例' }),
    record('summary', 'summary', '完整分析总结'), record('custom', 'custom', { explanation: '完整结构化原文' })])])
  data.execution_view.unit_counts = { total: null }
  const result = buildRunInsights(data, 'analyzing', { limit: 99 })
  assert.equal(result.scope.unit_count, null)
  assert.equal(result.scope.units[0].title, '认证协商')
  assert.deepEqual(result.outputs.latest.map(row => row.ref.record_id), ['custom', 'summary', 'case'])
})

test('review prose stays complete in the body while fallback titles remain short literal excerpts', () => {
  const summary = `${'Long review text '.repeat(12)}\nSecond line must remain in the full record.`
  const data = run([action('review', 'comparison_review', [record('f', 'finding', { summary }),
    record('d', 'review_decision', { disposition: 'finding', summary, correction_record_ids: ['f'] })])])
  const result = buildRunInsights(data, 'reviewing')
  const finding = result.outputs.latest.find(row => row.kind === 'finding')
  const decision = result.outputs.latest.find(row => row.kind === 'review_decision')
  assert.equal(finding.title, `${summary.slice(0, 100)}…`)
  assert.equal(decision.title, '复核结论 · d')
  assert.equal(finding.record.body.summary, summary)
  assert.equal(decision.record.body.summary, summary)
})

test('real reader contract retains exact output references and explicit closure dispositions across delivery and partial reads', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-run-insights-'))
  const runId = 'run-insights', runDirectory = path.join(root, 'runs', runId)
  const writeJson = async (file, value) => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(value), 'utf8')
  }
  try {
    await writeJson(path.join(runDirectory, 'inputs/task-contract.json'), { workflow_version: 'source-first-v1', target: '认证模块' })
    await writeJson(path.join(runDirectory, 'inputs/source-manifest.json'), { workflow_version: 'source-first-v1' })
    await writeJson(path.join(runDirectory, 'inputs/source-index.json'), { format_version: 'pangea-source-index-v1', files: [] })
    await writeJson(path.join(runDirectory, 'inputs/source-first-plan.json'), { units: [{ unit_id: 'u1', title: '认证协商' }] })
    const disposition = { finding_record_id: 'f', disposition: 'accepted', reason: '已补充配置输入及预期', updated_record_ids: ['updated'] }
    const artifacts = [
      action('plan', 'unit_planning', [record('unit', 'unit_plan', { unit_id: 'u1', title: '认证协商', purpose: '覆盖明确的协商配置' })], { role: 'planner' }),
      action('analysis', 'unit_analysis', [record('original', 'test_case', { title: '原用例' })], { role: 'analysis' }),
      action('review', 'comparison_review', [record('f', 'finding', { summary: '补充配置组合' }, { relates_to: ['u1'] }),
        record('decision', 'review_decision', { disposition: 'finding', closure_units: ['u1'] })], { role: 'review' }),
      action('closure', 'targeted_closure', [record('original', 'test_case', { title: '原用例' }),
        record('updated', 'test_case', { title: '补充配置用例' }, { supersedes: ['original'], created_revision: 3 }),
        record('summary', 'summary', { finding_dispositions: [disposition] }, { created_revision: 3 })], { role: 'closure', revision: 3, saved_revision: 3 }),
    ]
    const actions = {}, accepted_revisions = {}
    for (const item of artifacts) {
      const taskPath = path.join(runDirectory, 'tasks', `${item.action_id}.json`)
      const resultPath = path.join(runDirectory, 'results', `${item.action_id}.json`)
      const taskId = `worker-${item.action_id}`
      await writeJson(taskPath, { unit_id: item.unit_id, title: '认证协商', result_path: resultPath })
      await writeJson(resultPath, { format_version: 'pangea-notes-v1',
        binding: { data_root: root, run_id: runId, action_id: item.action_id, task_id: taskId },
        revision: item.revision, records: item.records, completion: { complete: true, declared_revision: item.revision }, last_record_write_at_ms: 1000 })
      actions[item.action_id] = { action_id: item.action_id, action: 'dispatch_agent', role: item.role,
        stage: item.stage, status: 'accepted', task_id: taskId, task_path: taskPath }
      accepted_revisions[item.action_id] = item.revision
    }
    await writeJson(path.join(runDirectory, 'progress.json'), { run_id: runId, workflow_version: 'source-first-v1',
      lifecycle_status: 'complete', stage: 'complete', actions, accepted_revisions })
    const current = await summarizeRun(root, runId, { includeDetails: true })
    assert.deepEqual(current.execution_view.diagnostics, [])
    const result = buildRunInsights(current, 'complete', { limit: 99 })
    assert.equal(result.availability, 'readable')
    assert.equal(result.outputs.counts.find(row => row.kind === 'test_case').count, 1)
    assert.deepEqual(result.pending, [])
    assert.deepEqual(result.outputs.latest.find(row => row.kind === 'summary').record.body.finding_dispositions, [disposition])
    const caseRow = result.outputs.latest.find(row => row.kind === 'test_case')
    assert.deepEqual(caseRow.ref, { action_id: 'closure', record_id: 'updated', revision: 3, unit_id: 'u1', stage: 'targeted_closure' })
    assert.deepEqual(caseRow.navigation, { type: 'case', id: current.details.test_cases[0].test_case_id })
    assert.equal(result.scope.units[0].purpose, '覆盖明确的协商配置')
    await rm(path.join(runDirectory, 'results/closure.json'))
    const partial = buildRunInsights(await summarizeRun(root, runId, { includeDetails: true }), 'complete', { limit: 99 })
    assert.equal(partial.availability, 'partial')
    assert.equal(partial.pending[0].ref.record_id, 'f')
    assert.equal(partial.outputs.counts.some(row => row.kind === 'test_case'), false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
