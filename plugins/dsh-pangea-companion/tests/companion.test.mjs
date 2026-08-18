import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { apply, companionSnapshot } from '../src/index.js'
import { discoverPangeaDataRoot } from '../src/reader.js'

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function evidence(chunkId, location, observation) { return { chunk_id: chunkId, location, observation } }

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-companion-'))
  const dataRoot = path.join(root, 'pangea-data')
  const runDirectory = path.join(dataRoot, 'runs', 'run-01')
  await mkdir(runDirectory, { recursive: true })
  await writeJson(path.join(runDirectory, 'progress.json'), {
    schema_version: '1.0', run_id: 'run-01', contract_digest: 'a'.repeat(64), phase: 'WAITING_REVIEW',
    analysis_units: ['u1', 'u2'], completed_analysis_units: ['u1', 'u2'], completed_rework_units: ['u1'],
    quality_status: null, errors: [], error_history: [],
  })
  await writeJson(path.join(runDirectory, 'agent-results', 'analysis', 'u1.json'), {
    unit_id: 'u1', attempt: 0,
    risks: [{ risk_id: 'R-old', title: 'old', evidence: [evidence('old', 'old.c:1', 'old')] }],
    test_cases: [{ test_case_id: 'TC-old', title: 'old', linked_risk_ids: ['R-old'] }],
    evidence: [evidence('old', 'old.c:1', 'old')], business_flows: [],
  })
  const sharedEvidence = evidence('e-shared', 'auth.c:10-20', '认证失败后状态未清理')
  await writeJson(path.join(runDirectory, 'agent-results', 'rework', 'u1.json'), {
    unit_id: 'u1', attempt: 1,
    risks: [{
      risk_id: 'R-001', title: '认证状态残留', dfx: ['功能与状态'], severity: 'High', confidence: 'high',
      trigger: '认证中断', system_result: '状态未清理', external_observation: '重连失败', exclusion_condition: '完整断电后不适用',
      upstream_semantics: { reachability: '可达', caller_constraints: '无', documented_behavior: '应清理', existing_tests: '无', conclusion: 'risk_remains' },
      translation_status: 'Blackbox-ready', status: 'accepted', evidence: [sharedEvidence],
    }],
    test_cases: [{
      test_case_id: 'TC-001', title: '认证中断后重连', case_type: '异常恢复', linked_risk_ids: ['R-001'],
      preconditions: ['已建立连接'], steps: ['中断认证', '重新连接'], expected_results: ['连接成功'], observability: ['抓包'], cleanup: ['断开连接'], status: 'draft',
    }],
    evidence: [sharedEvidence],
    business_flows: [{ title: '认证流程', description: '认证', steps: ['connect'], evidence: [sharedEvidence] }],
  })
  const secondEvidence = evidence('e2', 'tcp.c:30-40', '超时路径返回错误')
  await writeJson(path.join(runDirectory, 'agent-results', 'analysis', 'u2.json'), {
    unit_id: 'u2', attempt: 0,
    risks: [{ risk_id: 'R-002', title: '超时恢复', severity: 'Medium', evidence: [secondEvidence] }],
    test_cases: [{ test_case_id: 'TC-002', title: '超时恢复', linked_risk_ids: ['R-002'] }],
    evidence: [secondEvidence], business_flows: [],
  })
  await writeJson(path.join(runDirectory, 'agent-results', 'review.json'), {
    status: 'REWORK', reviewer_id: 'reviewer-1', summary: '需要补充一处证据',
    issues: [{ issue_id: 'I-001', unit_id: 'u2', reason: '证据不足', required_change: '补充调用方约束' }],
  })
  return { root, dataRoot }
}

test('discovers pangea-data from workspace root', async () => {
  const { root, dataRoot } = await fixture()
  try { assert.equal(await discoverPangeaDataRoot({ cwd: root }), dataRoot) }
  finally { await rm(root, { recursive: true, force: true }) }
})

test('returns current-run details and cross-links without double-counting replaced rework results', async () => {
  const { root } = await fixture()
  try {
    const snapshot = await companionSnapshot({ cwd: root })
    const run = snapshot.current
    assert.equal(run.run_id, 'run-01')
    assert.deepEqual(run.analysis, { total: 2, completed: 2, reworked: 1 })
    assert.deepEqual(run.details.risks.map(item => item.risk_id), ['R-001', 'R-002'])
    assert.deepEqual(run.details.test_cases.map(item => item.test_case_id), ['TC-001', 'TC-002'])
    assert.deepEqual(run.details.risks[0].linked_test_case_ids, ['TC-001'])
    assert.equal(run.details.evidence.length, 2)
    assert.deepEqual(run.details.evidence[0].risk_ids, ['R-001'])
    assert.equal(run.details.review_issues[0].required_change, '补充调用方约束')
    assert.ok(!run.details.risks.some(item => item.risk_id === 'R-old'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('recent run summaries stay compact while current run carries details', async () => {
  const { root } = await fixture()
  try {
    const snapshot = await companionSnapshot({ cwd: root })
    assert.ok(snapshot.current.details)
    assert.equal(snapshot.runs[0].details, undefined)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('registers one read-only status tool and one state route with Chinese tool copy', () => {
  const tools = []
  const routes = []
  const effects = []
  apply({ tools: { register(tool) { tools.push(tool) } }, webServer: { register(route) { routes.push(route); return () => {} } }, effect(callback) { effects.push(callback) } })
  assert.deepEqual(tools.map(tool => tool.name), ['pangea_status'])
  assert.match(tools[0].description, /只读/)
  assert.equal(routes.length, 1)
  assert.equal(routes[0].path, '/api/pangea-companion/state')
  assert.equal(effects.length, 1)
})
