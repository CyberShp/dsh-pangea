import test from 'node:test'
import assert from 'node:assert/strict'
import { uiWorkbenchFixture } from './fixtures/ui-workbench.mjs'
import { transformFixture, responseFor, sessionId } from './fixtures/drawers-timeline.mjs'
import { caseEvidenceProjection, caseFeasibilitySummary } from '../src/case-evidence.js'
import { behaviorCoverageBoard } from '../src/behavior-coverage.js'
test('drawer browser fixture retains distinct quotes and unknown/zero metrics without executing models', () => {
  const make = scene => transformFixture(uiWorkbenchFixture('/synthetic', scene), { scene })
  const { run } = make('complete')
  const evidence = caseEvidenceProjection(run.details.test_cases[0], [], run.details.coverage_gaps)
  assert.equal(evidence.items.length, 5)
  assert.equal(evidence.items[1].quote, 'distinct quote A')
  assert.equal(evidence.items[2].quote, 'distinct quote B')
  assert.equal(caseFeasibilitySummary(run.case_quality_summary).business_blackbox, null)
  const zero = caseFeasibilitySummary(make('zero').run.case_quality_summary)
  assert.equal(zero.business_blackbox, 0); assert.equal(zero.ready_ratio, 0)
  assert.equal(behaviorCoverageBoard(run.workflow.units, run.details.behavior_coverage).length, 6)
  assert.deepEqual(run.execution_timeline.lanes[0].segments.map(s => s.status), ['paused', 'unknown', 'running'])
})
test('fixture session preserves original execution IDs for actual session-filter interaction', () => {
  const run = { run_id: 'fixture-run' }
  const response = responseFor({ url: new URL('http://localhost/api/pangea-companion/workbench?view=agent-session'), run })
  assert.equal(response.session.session_id, sessionId)
  assert.deepEqual(response.events.map(e => e.execution_id), ['live-1', 'paused-1'])
  assert.equal(responseFor({ url: new URL('http://localhost/api/pangea-companion/state'), run }), undefined)
})
