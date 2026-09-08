import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { companionSnapshot } from '../src/reader.js'
import { buildTestCaseCsv } from '../src/export.js'
import { assertCodetalksSkill } from '../src/pangea-api.js'

async function json(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value))
}

test('mixed five-stage and historical nine-stage Runs use their own manifests without rewriting old files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-five-stages-'))
  try {
    const runId = 'module', run = path.join(root, 'runs', runId), skill = path.join(root, '.pangea/skill-runs', runId, 'skill')
    const manifest = { workflow_id: 'module-five-stage', review_step: '04', steps: [
      { id: '01', title: '输入与范围', required: ['活文档/输入与范围.md'] },
      { id: '02', title: '模块盘点', required: ['活文档/模块盘点.md', '活文档/分析台账.md'] },
      { id: '03', title: '按流程完成分析', required: ['活文档/风险点与SFMEA.md', '活文档/黑盒测试用例.md'], requires_glob: ['活文档/流程讲解/流程-*.md'] },
      { id: '04', title: '复核与定向修订', required: ['活文档/复核记录.md'] },
      { id: '05', title: '正式交付', required: ['正式输出/黑盒测试用例.md', '正式输出/完整分析报告.md'] },
    ] }
    await json(path.join(skill, 'workflow-manifest.json'), manifest)
    await json(path.join(root, '.pangea/skill-runs', runId, 'metadata.json'), { run_id: runId, skill_root: skill, request: { scenario: 'module-analysis', mode: 'depth' } })
    const stateFile = path.join(run, '内部索引/运行状态.json')
    const state = { status: 'in_progress', current_step: '03', completed_steps: ['01', '02'],
      step_progress: { total: 2, completed: 1, current: { id: 'FLOW-2', title: '恢复' } },
      publication: { state: 'draft', step_id: '03', revision: 1 } }
    await json(stateFile, state)
    const projection = { schema_version: '1.0', run_id: runId, business_flows: [{ flow_id: 'FLOW-1', title: '请求' }],
      risks: [], test_cases: [{ test_case_id: 'TC-1', title: '边界' }], evidence: [], review_issues: [] }
    await json(path.join(run, '内部索引/工作台投影.json'), projection)
    await mkdir(path.join(run, '活文档/流程讲解'), { recursive: true })
    await writeFile(path.join(run, '活文档/流程讲解/流程-FLOW-1.md'), '# 请求\n短文也可显示。')
    const caseText = '# 用例\n## TC-1：边界\n**前置条件**：连接已建立\n**操作步骤**：\n1. 发送边界报文\n**预期结果**：协议错误响应\n**观测方式**：独立抓包\n**清理或恢复**：关闭连接\n'
    await writeFile(path.join(run, '活文档/黑盒测试用例.md'), caseText)
    const draft = (await companionSnapshot({ dataRoot: root, runId })).current
    assert.equal(draft.analysis.total, 5)
    assert.equal(draft.analysis.completed, 2)
    assert.equal(draft.analysis.pending, 2)
    assert.equal(draft.phase_title, '按流程完成分析')
    assert.equal(draft.publication.state, 'draft')
    assert.equal(draft.counts.test_cases, 1)
    assert.deepEqual(draft.details.test_cases[0].steps, ['发送边界报文'])
    assert.equal(draft.workflow.steps.length, 5)
    assert.ok(draft.workflow.steps[2].artifacts.some(file => file.endsWith('流程-FLOW-1.md')))
    assert.equal(draft.workflow.step_progress.current.id, 'FLOW-2')

    state.current_step = '04'
    state.completed_steps.push('03')
    state.publication = { state: 'draft', step_id: '04', revision: 2 }
    await json(stateFile, state)
    await json(path.join(run, '内部索引/独立审查状态.json'), { independent: false, semantic_verdict: 'UNRESOLVED' })
    const review = (await companionSnapshot({ dataRoot: root, runId })).current
    assert.equal(review.phase_title, '复核与定向修订')
    assert.equal(review.semantic_review.method, 'self_review')
    assert.equal(review.semantic_review.verdict, 'UNRESOLVED')
    assert.equal(review.publication.revision, 2)

    state.current_step = null
    state.completed_steps.push('04', '05')
    await json(stateFile, state)
    const notFinalized = (await companionSnapshot({ dataRoot: root, runId })).current
    assert.notEqual(notFinalized.lifecycle_status, 'complete')
    assert.equal(notFinalized.publication.state, 'draft')
    state.status = 'complete'
    state.publication = { state: 'final', step_id: '05', revision: 3 }
    await json(stateFile, state)
    await mkdir(path.join(run, '正式输出'), { recursive: true })
    await writeFile(path.join(run, '正式输出/黑盒测试用例.md'), caseText)
    await writeFile(path.join(run, '正式输出/完整分析报告.md'), '# 摘要\n[流程](../活文档/流程讲解/流程-FLOW-1.md)')
    const final = (await companionSnapshot({ dataRoot: root, runId })).current
    assert.equal(final.publication.step_id, '05')
    assert.equal(final.review.status, 'COMPLETE')
    assert.equal(final.delivery_integrity.status, 'complete')
    assert.equal(final.report_available, true)
    assert.match(buildTestCaseCsv(final), /发送边界报文/)

    const oldId = 'old-nine', oldRun = path.join(root, 'runs', oldId), oldSkill = path.join(root, '.pangea/skill-runs', oldId, 'skill')
    const oldManifest = { version: '1.3.0', steps: Array.from({ length: 9 }, (_, i) => ({ id: String(i + 1).padStart(2, '0'), required: [] })) }
    await json(path.join(oldSkill, 'workflow-manifest.json'), oldManifest)
    await json(path.join(root, '.pangea/skill-runs', oldId, 'metadata.json'), { run_id: oldId, skill_root: oldSkill })
    await json(path.join(oldRun, '内部索引/运行状态.json'), { status: 'in_progress', current_step: '05', completed_steps: ['01', '02', '03', '04'] })
    const oldFiles = [path.join(oldSkill, 'workflow-manifest.json'), path.join(oldRun, '内部索引/运行状态.json')]
    const before = await Promise.all(oldFiles.map(file => readFile(file, 'utf8')))
    const old = (await companionSnapshot({ dataRoot: root, runId: oldId })).current
    assert.equal(old.analysis.total, 9)
    assert.equal(old.workflow.steps[4].title, '多源场景增殖和风险解释')
    assert.equal(old.workflow.steps.at(-1).step, '09')
    assert.deepEqual(await Promise.all(oldFiles.map(file => readFile(file, 'utf8'))), before)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('new launches require the five-stage-capable backend; historical reading is separate', () => {
  assert.throws(() => assertCodetalksSkill({ analysis_skill: { skill_id: 'codetalks-skill', version: '1.3.0' } }), /1.4.0/)
  assert.equal(assertCodetalksSkill({ analysis_skill: { skill_id: 'codetalks-skill', version: '1.4.0' } }).version, '1.4.0')
})
