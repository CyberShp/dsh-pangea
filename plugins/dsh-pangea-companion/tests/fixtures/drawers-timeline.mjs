// Synthetic UI verification only. No provider or model execution.
import { buildExecutionTimeline } from '../../src/execution-timeline.js'
import { behaviorCoverageProjection } from '../../src/behavior-coverage.js'
export const sessionId = 'a'.repeat(64)
const baseTime = Date.now() - 600000
export function transformFixture(value, { scene }) {
  const { run } = value, item = run.details.test_cases[0]
  item.summary = Array.from({ length: 20 }, (_, index) => `依据段落 ${index + 1}：验证异常恢复和冻结输入，仅表示测试设计意图。`).join('\n\n')
  item.source_evidence = [
    { location: 'storage:tls/handshake.c:1', quote: 'distinct quote A' },
    { location: 'storage:tls/handshake.c:1', quote: 'distinct quote B' },
    { location: 'storage:tls/handshake.c:2', quote: 'third explicit source' },
  ]
  item.coverage_refs = ['coverage-1']
  run.details.coverage_gaps = [{ coverage_id: 'coverage-1', location: 'storage:tls/handshake.c:2', hits: 0, description: 'Frozen coverage source' }]
  run.workflow.units.push(...Array.from({ length: 4 }, (_, index) => ({ unit_id: `extra-${index}`, title: `额外分析单元 ${index + 1}`, status: 'accepted' })))
  run.details.behavior_coverage = behaviorCoverageProjection(run.workflow.units.slice(0, 5).map((unit, index) => ({ unit_id: unit.unit_id, projection_id: `ledger-${index}`, body: {
    format_version: 'behavior-coverage-v1', scope: `分析单元业务 ${index + 1}`, items: [{ item_id: `behavior-${index}`, status: index % 2 ? 'missing' : 'designed', operation: '建立连接并验证异常恢复', conditions: ['已具备连接输入'], expected_behavior: '连接状态可观察', case_refs: [{ case_id: index % 2 ? 'TC-002' : 'TC-001' }] }],
  } })), run.details.test_cases)
  if (scene === 'zero') run.case_quality_summary = { business_blackbox: 0, developer_assisted: 0, ready_blackbox: 0, ready_graybox: 0, ready_cases: 0, total_cases: run.details.test_cases.length, ready_ratio: 0, blackbox_target: false }
  else delete run.case_quality_summary
  const events = [
    { seq: 1, type: 'host_event', stage: 'source_first_execution', execution_event: 'started', execution_id: 'paused-1', action_id: 'action-pause', at_ms: baseTime },
    { seq: 2, type: 'host_event', stage: 'source_first_execution', execution_event: 'paused', execution_id: 'paused-1', action_id: 'action-pause', at_ms: baseTime + 120000 },
    { seq: 3, type: 'turn_end', execution_id: 'unknown-1', action_id: 'action-unknown', at_ms: baseTime + 180000 },
    { seq: 4, type: 'host_event', stage: 'source_first_execution', execution_event: 'started', execution_id: 'live-1', action_id: 'action-live', at_ms: baseTime + 300000 },
  ]
  run.execution_timeline = buildExecutionTimeline({ now: Date.now(), progress: { lifecycle_status: 'running', actions: { 'action-live': { execution_id: 'live-1', execution_started_at_ms: baseTime + 300000, status: 'dispatched' } } }, sessions: [{ session_id: sessionId, status: 'running', role: 'TLS original agent' }], histories: [{ session_id: sessionId, complete: true, events }] })
  return value
}
export function responseFor({ url, run }) {
  if (url.pathname !== '/api/pangea-companion/workbench') return undefined
  if (url.searchParams.get('view') !== 'agent-session') return undefined
  return { status: 'ok', run_id: run.run_id, session: { session_id: sessionId, unit_id: 'unit-tls', status: 'running', history_status: 'recorded' }, events: [
    { seq: 1, type: 'session_update', execution_id: 'live-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'LIVE EXECUTION ONLY' } } },
    { seq: 2, type: 'session_update', execution_id: 'paused-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'PAUSED EXECUTION ONLY' } } },
  ], has_more: false, next_cursor: 2 }
}
