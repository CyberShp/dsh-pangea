import test from 'node:test'
import assert from 'node:assert/strict'

import { sourceFirstProjection } from '../src/source-first-projection.js'
import { classifyInjectionCandidate, extractRiskInjectionCandidates } from '../src/fault-injection-candidates.js'
import { listDtsPatterns, ingestDtsFile, setDtsPatternStatus } from '../src/pangea-api.js'

test('risk-method-v2 projection preserves two-tier verification, DTS matches, and promotes needs_runtime_verification into explicit injection candidates', () => {
  const projected = sourceFirstProjection([
    {
      action_id: 'run-v2:analysis:U-CONC',
      task_id: 'task-conc',
      stage: 'unit_analysis',
      status: 'accepted',
      revision: 1,
      result_path: '/tmp/conc.json',
      task: {
        unit_id: 'U-CONC',
        risk_track: 'concurrency_timing',
        record_contracts: { risk: 'behavior-risk-v3', check: 'behavior-check-v2' },
      },
      records: [
        {
          record_id: 'rec-0001',
          kind: 'risk',
          created_revision: 1,
          body: {
            format_version: 'behavior-risk-v3',
            risk_id: 'R-CONC-001',
            track: 'concurrency_timing',
            verification_status: 'needs_runtime_verification',
            severity: 'High',
            entity_ref: 'CTX-001',
            matched_dts_pattern_ids: ['DTS20260001'],
            title: '超时清理与晚到回调并发释放后使用',
            trigger: 'AUTH_PENDING 超时并同时回包',
            interleaving_or_path: ['Timer L142 free', 'Recv L88 deref'],
            system_result: 'UAF 崩溃',
            runtime_uncertainty: '外部库 disconnect 是否同步排空在途回调未知',
            external_observation: 'ASAN 报错',
            exclusion_condition: 'disconnect 同步排空回调',
            source_evidence: ['repo:src/sess.c:138-149'],
            evidence_quotes: [{ ref: 'repo:src/sess.c:138-149', snippet: 'free(sess->auth_ctx);' }],
            instrumentation: {
              points: [
                {
                  id: 'INJ-001',
                  kind: 'race_window_delay',
                  repo_id: 'repo',
                  path: 'src/sess.c',
                  symbol: 'session_TimerCb',
                  action: '释放后注入 50ms 延迟',
                  observe: 'ASAN heap-use-after-free',
                },
              ],
            },
            linked_test_case_ids: [],
          },
        },
        {
          record_id: 'rec-0002',
          kind: 'risk',
          created_revision: 1,
          body: {
            format_version: 'behavior-risk-v3',
            risk_id: 'R-ERR-002',
            track: 'error_rollback',
            verification_status: 'static_proven',
            severity: 'Medium',
            title: '错误路径漏解锁',
            trigger: 'recv 失败提前返回',
            interleaving_or_path: ['L10 lock', 'L15 return -2'],
            system_result: '死锁',
            external_observation: '后续请求永久卡死',
            exclusion_condition: '无',
            source_evidence: ['repo:src/sess.c:10-16'],
            evidence_quotes: [{ ref: 'repo:src/sess.c:10-16', snippet: 'return -2;' }],
          },
        },
      ],
    },
  ])

  assert.equal(projected.risks.length, 2)
  const runtimeRisk = projected.risks.find(r => r.display_id === 'R-CONC-001')
  assert.equal(runtimeRisk.track, 'concurrency_timing')
  assert.equal(runtimeRisk.verification_status, 'needs_runtime_verification')
  assert.deepEqual(runtimeRisk.matched_dts_pattern_ids, ['DTS20260001'])
  assert.equal(runtimeRisk.instrumentation.points.length, 1)

  const classified = classifyInjectionCandidate(runtimeRisk)
  assert.equal(classified.tier, 'explicit')
  assert.equal(classified.selectable, true)
  assert.match(classified.label, /待动态实锤/)

  const candidates = extractRiskInjectionCandidates(projected.risks)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].display_id, 'R-CONC-001')
  assert.equal(candidates[0].classification.tier, 'explicit')
})

test('pangea-api DTS pattern wrappers build expected CLI arguments', async () => {
  const calls = []
  const runner = async ({ args }) => {
    calls.push(args)
    return { ok: true, result: { items: [] } }
  }
  const pangeaCwd = '/home/antigravity/CyberShp/pangea-agent'
  await listDtsPatterns(pangeaCwd, { dataRoot: '/data', track: 'concurrency_timing', status: 'enabled' }, runner)
  await ingestDtsFile(pangeaCwd, { dataRoot: '/data', filePath: '/tmp/dts.csv', sourceKind: 'offline_file_with_git' }, runner)
  await setDtsPatternStatus(pangeaCwd, { dataRoot: '/data', patternId: 'DTS-1', status: 'disabled' }, runner)

  assert.deepEqual(calls[0], ['dts-patterns', 'list', '--data-root', '/data', '--track', 'concurrency_timing', '--status', 'enabled'])
  assert.deepEqual(calls[1], ['dts-patterns', 'ingest', '--path', '/tmp/dts.csv', '--data-root', '/data', '--source-kind', 'offline_file_with_git'])
  assert.deepEqual(calls[2], ['dts-patterns', 'set-status', '--pattern-id', 'DTS-1', '--status', 'disabled', '--data-root', '/data'])
})
