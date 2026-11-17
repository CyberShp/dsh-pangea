import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import {
  buildVerificationShellScript,
  classifyInjectionCandidate,
  duplicateCaseKeySet,
  parseVerificationLog,
} from '../src/fault-injection-candidates.js'
import { summarizeRunVerifications } from '../src/fault-injection-summary.js'
import { caseReviewRouteHandler } from '../src/index.js'

test('classifyInjectionCandidate unlocks unique untagged cases and ranks explicit/recommended/on_demand tiers', () => {
  const cases = [
    { projection_id: 'unit/explicit', title: '预设打桩', execution_readiness: 'needs_instrumentation' },
    { projection_id: 'unit/rule', title: '握手重连', missing_execution_conditions: '需要准备链路故障注入环境' },
    { projection_id: 'unit/errno', title: '缓冲分配', preconditions: ['构造 ENOMEM 分配失败分支'] },
    { projection_id: 'unit/plain', title: '常规配置查询校验', case_type: 'functional' },
    { projection_id: 'unit/dup', title: '重复一' },
    { projection_id: 'unit/dup', title: '重复二' },
    { title: '无编号用例' },
  ]
  const duplicates = duplicateCaseKeySet(cases)
  assert.deepEqual([...duplicates], ['unit/dup'])

  const cExplicit = classifyInjectionCandidate(cases[0], duplicates)
  assert.equal(cExplicit.selectable, true)
  assert.equal(cExplicit.tier, 'explicit')

  const cRule = classifyInjectionCandidate(cases[1], duplicates)
  assert.equal(cRule.selectable, true)
  assert.equal(cRule.tier, 'recommended')
  assert.match(cRule.reason, /故障注入/)

  const cErrno = classifyInjectionCandidate(cases[2], duplicates)
  assert.equal(cErrno.selectable, true)
  assert.equal(cErrno.tier, 'recommended')

  const cPlain = classifyInjectionCandidate(cases[3], duplicates)
  assert.equal(cPlain.selectable, true)
  assert.equal(cPlain.tier, 'on_demand')

  assert.equal(classifyInjectionCandidate(cases[4], duplicates).selectable, false)
  assert.equal(classifyInjectionCandidate(cases[6], duplicates).selectable, false)
})

test('buildVerificationShellScript and parseVerificationLog support structured markers and raw observe hits', () => {
  const task = {
    id: 'fi-task-12345678',
    name: 'TLS 打桩验证',
    branch: 'dev/tls-fi',
    case_keys: ['unit/A', 'unit/B'],
    cases: [
      { case_key: 'unit/A', title: '握手超时恢复' },
      { case_key: 'unit/B', title: '证书校验回退' },
    ],
    repositories: [{ repo_id: 'storage', commit: '8a4e91c0b23d4f1190bc3a12' }],
    result: {
      points: [
        { id: 'FI_TIMEOUT', repo_id: 'storage', path: 'tls/hs.c', enable: 'export FI_TIMEOUT=1', disable: 'unset FI_TIMEOUT', observe: '[FI_HIT:TIMEOUT]' },
        { id: 'FI_CERT', repo_id: 'storage', path: 'tls/cert.c', observe: 'hit:FI_CERT' },
      ],
      profiles: [
        { case_key: 'unit/A', point_ids: ['FI_TIMEOUT'], steps: ['export FI_TIMEOUT=1', './run_tls_test --case A'] },
        { case_key: 'unit/B', point_ids: ['FI_CERT'], steps: ['./run_tls_test --case B'] },
      ],
    },
  }

  const script = buildVerificationShellScript(task)
  assert.match(script, /^#!\/usr\/bin\/env bash/)
  assert.match(script, /BASH_VERSINFO\[0\]:-0[\s\S]*export -n LC_ALL LC_CTYPE[\s\S]*LC_CTYPE=C[\s\S]*set -euo pipefail/)
  assert.match(script, /\[PANGEA_CASE_BEGIN\] case=unit\/A points=FI_TIMEOUT/)
  assert.match(script, /\[PANGEA_VERIFY\] case=unit\/A result=passed hits=FI_TIMEOUT=1/)

  const fromStructured = parseVerificationLog([
    '[PANGEA_CASE_BEGIN] case=unit/A points=FI_TIMEOUT',
    '[PANGEA_VERIFY] case=unit/A result=passed hits=FI_TIMEOUT=3',
    '[PANGEA_CASE_BEGIN] case=unit/B points=FI_CERT',
  ].join('\n'), task)
  assert.equal(fromStructured.matchedCount, 2)
  assert.deepEqual(
    fromStructured.entries.map(({ case_key, result, hits }) => ({ case_key, result, hits })),
    [
      { case_key: 'unit/A', result: 'passed', hits: 'FI_TIMEOUT=3' },
      { case_key: 'unit/B', result: 'not_triggered', hits: 'FI_CERT=0' },
    ],
  )

  const fromRawSyslog = parseVerificationLog([
    '2026-11-17T00:10:01Z kernel: [FI_HIT:TIMEOUT] injected ETIMEDOUT',
    '2026-11-17T00:10:02Z kernel: [FI_HIT:TIMEOUT] retry path entered',
    '2026-11-17T00:10:03Z test-runner: AssertionError: socket leaked',
  ].join('\n'), task)
  assert.equal(fromRawSyslog.matchedCount, 1)
  assert.equal(fromRawSyslog.entries[0].case_key, 'unit/A')
  assert.equal(fromRawSyslog.entries[0].result, 'failed')
  assert.equal(fromRawSyslog.entries[0].hits, 'FI_TIMEOUT=2')
})

test('summarizeRunVerifications projects read-only overlay onto case-reviews without altering Run hash or bytes', async t => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'fi-summary-'))
  t.after(() => rm(dataRoot, { recursive: true, force: true }))

  const run = {
    run_id: 'run-fi-1',
    details: {
      test_cases: [
        { test_case_id: 'unit/case-a', title: 'Case A' },
        { test_case_id: 'unit/case-b', title: 'Case B' },
      ],
    },
  }
  const originalFile = path.join(dataRoot, 'original-run.json')
  const originalText = JSON.stringify(run)
  await writeFile(originalFile, originalText)

  const deps = {
    resolveRoot: async () => dataRoot,
    readRun: async () => JSON.parse(await readFile(originalFile, 'utf8')),
  }
  async function callReviews(body) {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : [])
    req.method = body ? 'POST' : 'GET'
    req.url = '/api/pangea-companion/case-reviews?run_id=run-fi-1'
    req.headers = { 'sec-fetch-site': 'same-origin' }
    const res = {}
    await caseReviewRouteHandler(req, {
      writeHead(code) { res.code = code },
      end(payload) { res.body = JSON.parse(Buffer.from(payload).toString('utf8')) },
    }, deps)
    return res
  }

  const before = await callReviews()
  assert.equal(before.code, 200)
  assert.equal(before.body.injection_counts.instrumented, 0)

  const taskDir = path.join(dataRoot, '.pangea', 'fault-injection', 'run-fi-1', 'task-01')
  await mkdir(taskDir, { recursive: true })
  await writeFile(path.join(taskDir, 'task.json'), JSON.stringify({
    id: 'task-01',
    run_id: 'run-fi-1',
    name: '首批打桩',
    status: 'pushed',
    branch: 'dev/fi',
    created_at: '2026-11-17T00:00:00Z',
    updated_at: '2026-11-17T00:05:00Z',
    case_keys: ['unit/case-a', 'unit/case-b'],
    verification: [
      { case_key: 'unit/case-a', result: 'passed', hits: 'P1=1', at: '2026-11-17T00:06:00Z' },
    ],
  }))

  const summary = await summarizeRunVerifications(dataRoot, 'run-fi-1')
  assert.deepEqual(summary.injection_counts, {
    instrumented: 2,
    verified: 1,
    passed: 1,
    failed: 0,
    not_triggered: 0,
  })
  assert.equal(summary.injection_by_case['unit/case-a'].result, 'passed')
  assert.equal(summary.injection_by_case['unit/case-b'].task_status, 'pushed')
  assert.equal(summary.injection_by_case['unit/case-b'].verified, false)

  const after = await callReviews()
  assert.equal(after.code, 200)
  assert.equal(after.body.case_set_revision, before.body.case_set_revision)
  assert.equal(after.body.cases[0].content_hash, before.body.cases[0].content_hash)
  assert.equal(after.body.injection_by_case['unit/case-a'].result, 'passed')

  const posted = await callReviews({
    run_id: 'run-fi-1',
    expected_revision: 0,
    case_key: 'unit/case-a',
    expected_content_hash: before.body.cases[0].content_hash,
    decision: 'adopted',
  })
  assert.equal(posted.code, 200)
  assert.equal(posted.body.injection_counts.passed, 1)
  assert.equal(await readFile(originalFile, 'utf8'), originalText)
})
