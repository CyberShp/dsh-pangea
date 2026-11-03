import assert from 'node:assert/strict'
import test from 'node:test'
import { caseEvidenceProjection, caseCoverageBasisProjection, caseFeasibilityProjection, caseFeasibilitySummary } from '../src/case-evidence.js'
import { sourceFirstProjection } from '../src/source-first-projection.js'
import { uiWorkbenchFixture } from './fixtures/ui-workbench.mjs'

test('all explicit evidence survives projection without guessing related risk or flow evidence', () => {
  const item = { unit_id: 'u1', evidence: [
    { evidence_id: 'e1', repo_id: 'r', path: 'a.c', line_start: 2, line_end: 9 },
    { evidence_id: 'e2', location: 'r:a.c:2-9', quote: 'different evidence' },
  ], source_evidence: ['r:b.c:10', 'r:b.c:10'], source_record: {
    evidence: [{ location: 'r:c.c#L8-L11' }], body: JSON.stringify({ source_evidence: ['r:d.c:4'] }) },
    linked_risk_ids: ['risk1'], linked_flow_ids: ['flow1'] }
  const before = JSON.stringify(item)
  const view = caseEvidenceProjection(item, [{ risk_id: 'risk1', location: 'r:unrelated.c:1' }])
  assert.deepEqual(view.items.map(row => row.location), ['r:a.c:2-9', 'r:a.c:2-9', 'r:b.c:10', 'r:c.c#L8-L11', 'r:d.c:4'])
  assert.equal(view.items[0].evidence_id, 'e1')
  assert.equal(view.items[0].line_end, 9)
  assert.equal(view.items[2].origins.length, 2)
  assert.deepEqual(view.unresolved, [])
  assert.equal(JSON.stringify(item), before)
})

test('evidence IDs resolve only uniquely in the explicit unit; malformed and missing references stay visible', () => {
  const evidence = [{ unit_id: 'a', evidence_id: 'E1', location: 'repo:a.c:4' }, { unit_id: 'b', evidence_id: 'E1', location: 'repo:b.c:8' }]
  const view = caseEvidenceProjection({ unit_id: 'a', evidence: ['E1', { evidence_id: 'E1', unit_id: 'b' }, 'missing', null,
    { path: 'a.c', line_start: 0 }, { path: 'a.c', line_start: 9, line_end: 4 }, { path: 'a.c', line_end: 5 }] }, evidence)
  assert.deepEqual(view.items.map(row => row.location), ['repo:a.c:4', 'repo:b.c:8'])
  assert.equal(view.unresolved.length, 5)
  assert.equal(caseEvidenceProjection({ evidence: ['E1'] }, evidence).items.length, 0)
  assert.match(caseEvidenceProjection({ unit_id: 'a', evidence: ['E1'] }, [...evidence, evidence[0]]).unresolved[0].issue, /不唯一/)
  assert.equal(caseEvidenceProjection({ evidence: [{ path: 'a.c' }] }).items[0].location, 'a.c')
})

test('source-backed and existing UI fixtures expose only literal case evidence', () => {
  const body = { case_id: 'TC1', source_evidence: ['r:a.c:3-8'], execution_readiness: 'unknown' }
  const view = sourceFirstProjection([{ action_id: 'a', stage: 'unit_analysis', task: { unit_id: 'u' }, records: [{ record_id: 'tc', kind: 'test_case', body, evidence: [{ repo_id: 'r', path: 'b.c', line_start: 12 }] }] }])
  const sources = caseEvidenceProjection(view.test_cases[0]).items
  assert.deepEqual(new Set(sources.map(row => row.location)), new Set(['r:a.c:3-8', 'r:b.c:12']))
  assert.equal(caseFeasibilityProjection(view.test_cases[0]).status, 'unknown')
  assert.equal(caseEvidenceProjection(uiWorkbenchFixture('/tmp/ui').run.details.test_cases[0]).items[0].location, 'storage:tls/handshake.c:1')
})

test('coverage matches are only planned, and preserve ambiguous, missing and malformed declarations', () => {
  const gaps = [{ coverage_id: 'g1', count: 0 }, { coverage_id: 'g2', count: 10 }, { coverage_id: 'g2', count: 0 }]
  const view = caseCoverageBasisProjection({ coverage_refs: ['g1', { coverage_id: 'g2' }, 'missing', 7] }, gaps)
  assert.deepEqual(view.references.map(row => row.status), ['matched', 'ambiguous', 'unresolved', 'invalid'])
  assert.ok(view.references.every(row => row.association === 'planned'))
  assert.equal(view.references[1].matches.length, 2)
  assert.equal(caseCoverageBasisProjection({ coverage_refs: ['g1'] }).references[0].status, 'unavailable')
  assert.equal(caseCoverageBasisProjection({ coverage_refs: 'g1' }, gaps).references[0].status, 'invalid')
  assert.deepEqual(caseCoverageBasisProjection({}).references, [])
  assert.equal(caseCoverageBasisProjection({ coverage_refs: [{ coverage_id: 'g1' }] }, []).references[0].status, 'unresolved')
})

test('feasibility preserves unknown and authored reasons, never inferring readiness from steps or execution', () => {
  assert.equal(caseFeasibilityProjection({ steps: ['do this'], execution_status: 'executed' }).status, 'unknown')
  assert.equal(caseFeasibilityProjection({ readiness: 'ready' }).status, 'ready')
  assert.equal(caseFeasibilityProjection({ execution_readiness: 'unknown', readiness: 'needs_setup' }).status, 'unknown')
  assert.equal(caseFeasibilityProjection({ execution_readiness: 'needs_instrumentation' }).status, 'needs_setup')
  assert.equal(caseFeasibilityProjection({ execution_readiness: 'future' }).declared_status, 'future')
  const reason = { missing: 'host command' }
  assert.equal(caseFeasibilityProjection({ readiness_reason: reason }).reason, reason)
})

test('summary preserves explicit zero and false, and never fabricates missing historical metrics', () => {
  const unknown = caseFeasibilitySummary(null)
  for (const field of ['ready_cases', 'total_cases', 'ready_ratio', 'has_legacy_groups', 'blackbox_target']) assert.equal(unknown[field], null)
  assert.equal(unknown.status, 'unknown')
  const summary = caseFeasibilitySummary({ ready_cases: 0, total_cases: 7, ready_ratio: 0, blackbox_target: false, has_legacy_groups: false })
  assert.equal(summary.ready_cases, 0)
  assert.equal(summary.ready_ratio, 0)
  assert.equal(summary.blackbox_target, false)
  assert.equal(summary.ready_blackbox, null)
  assert.equal(caseFeasibilitySummary({ has_legacy_groups: true, ready_ratio: 1 }).ready_ratio, null)
  for (const bad of ['0', -1, NaN, Infinity, 1.5]) assert.equal(caseFeasibilitySummary({ total_cases: bad }).total_cases, null)
})

test('standalone evidence follows explicit record links in either direction, never risk links or another unit', () => {
  const item = { unit_id: 'u', projection_id: 'u/c', source_record: { record_id: 'c', relates_to: ['e1', 'risk'] } }
  const catalog = [
    { unit_id: 'u', location: 'r:a.c:1', source_record: { kind: 'evidence', record_id: 'e1' } },
    { unit_id: 'u', location: 'r:b.c:2', source_record: { kind: 'evidence', record_id: 'e2', relates_to: ['c'] } },
    { unit_id: 'other', location: 'r:wrong.c:3', source_record: { kind: 'evidence', record_id: 'e1', relates_to: ['c'] } },
    { unit_id: 'u', location: 'r:risk.c:4', source_record: { kind: 'risk', record_id: 'risk', relates_to: ['c'] } },
  ]
  assert.deepEqual(caseEvidenceProjection(item, catalog).items.map(row => row.location), ['r:a.c:1', 'r:b.c:2'])
})

test('prose, remote URLs and invalid line ranges never become preview source paths', () => {
  const invalid = ['see docs.', 'not a path.c', 'https://example.com/a.c:1', 'r:a.c:0', 'r:a.c:9-3', 'r:a.c#L0', 'r:a.c:9007199254740992']
  const view = caseEvidenceProjection({ source_evidence: [...invalid, 'r:a.c:2-4', 'r:a.c#L2-L4', 'README.md', { location: 'see docs.' }] })
  assert.equal(view.items.length, 3)
  assert.equal(view.unresolved.length, invalid.length + 1)
})

test('unique explicit planned coverage rows provide source locations without using ambiguous or absent mappings', () => {
  const item = { coverage_refs: ['g1', 'g2', 'missing'] }
  const gaps = [{ coverage_id: 'g1', matches: [{ repo_id: 'r', path: 'a.c', line: 7 }] },
    { coverage_id: 'g2', location: 'r:b.c:1' }, { coverage_id: 'g2', location: 'r:c.c:3' }]
  const view = caseEvidenceProjection(item, [], gaps)
  assert.deepEqual(view.items.map(row => row.location), ['r:a.c:7'])
  assert.equal(view.items[0].origins[0].field, 'coverage_refs:g1')
  assert.equal(caseEvidenceProjection({ coverage_refs: 'g1' }, [], gaps).items.length, 0)
})

test('source-first adapters do not duplicate distinct authored evidence IDs and quotes', () => {
  const records = [{ record_id: 'c', kind: 'test_case', body: { title: 'case', source_evidence: ['see docs.'] }, evidence: [
    { evidence_id: 'E1', location: 'r:a.c:2', observation: 'same', quote: 'first quote' },
    { evidence_id: 'E2', location: 'r:a.c:2', observation: 'same', quote: 'second quote' },
  ] }]
  const view = sourceFirstProjection([{ stage: 'unit_analysis', task: { unit_id: 'u' }, records }])
  const projected = caseEvidenceProjection(view.test_cases[0], view.evidence)
  assert.equal(projected.items.length, 2)
  assert.deepEqual(projected.items.map(item => item.evidence_id), ['E1', 'E2'])
  assert.deepEqual(projected.items.map(item => item.quote), ['first quote', 'second quote'])
  assert.ok(projected.unresolved.some(item => item.reference === 'see docs.'))
  // The same location on a genuinely separate record is still a distinct source.
  const separate = { ...view.evidence[0], projection_id: 'u/other', chunk_id: 'u/other/evidence-1',
    source_record: { kind: 'evidence', record_id: 'other', relates_to: ['c'] } }
  assert.equal(caseEvidenceProjection(view.test_cases[0], [...view.evidence, separate]).items.length, 3)
})

test('adapter fallback observations collapse only with their own originals, not genuine new observations', () => {
  const records = [{ record_id: 'c', kind: 'test_case', body: { title: 'Authored case', source_evidence: ['r:a.c:2'] } }]
  const view = sourceFirstProjection([{ stage: 'unit_analysis', task: { unit_id: 'u' }, records }])
  assert.equal(caseEvidenceProjection(view.test_cases[0]).items.length, 1)
  view.test_cases[0].evidence[0].observation = 'New observation retained'
  assert.equal(caseEvidenceProjection(view.test_cases[0]).items.length, 2)
})

test('structured paths preserve spaces without interpreting prose locations as paths', () => {
  const ref = { repo_id: 'r', path: 'dir with space/a.c', line_start: 2, line_end: 4 }
  const view = caseEvidenceProjection({ evidence: [ref, { ...ref, line_start: 0 }], source_evidence: ['see docs.', 'dir with space/a.c:2'] })
  assert.equal(view.items.length, 1)
  assert.equal(view.items[0].location, 'r:dir with space/a.c:2-4')
  assert.equal(view.items[0].path, ref.path)
  assert.equal(view.unresolved.length, 3)
})

test('adapter retains added quote or authored evidence ID absent from the exact original', () => {
  const project = () => sourceFirstProjection([{ stage: 'unit_analysis', task: { unit_id: 'u' }, records: [
    { record_id: 'c', kind: 'test_case', body: { title: 'Authored case', source_evidence: ['r:a.c:2'] } },
  ] }]).test_cases[0]
  const withQuote = project()
  withQuote.evidence[0].quote = 'Distinct explicitly retained quote'
  const quotes = caseEvidenceProjection(withQuote).items
  assert.equal(quotes.length, 2)
  assert.ok(quotes.some(item => item.quote === 'Distinct explicitly retained quote'))
  const withId = project()
  withId.evidence[0].evidence_id = 'AUTHORED-EXTRA'
  const ids = caseEvidenceProjection(withId).items
  assert.equal(ids.length, 2)
  assert.ok(ids.some(item => item.evidence_id === 'AUTHORED-EXTRA'))
})

test('adapter with matching authored ID and quote still collapses into its original', () => {
  const authored = { location: 'r:a.c:2', evidence_id: 'E1', quote: 'same quote' }
  const item = sourceFirstProjection([{ stage: 'unit_analysis', task: { unit_id: 'u' }, records: [
    { record_id: 'c', kind: 'test_case', body: { title: 'Authored case', source_evidence: [authored] } },
  ] }]).test_cases[0]
  Object.assign(item.evidence[0], { evidence_id: authored.evidence_id, quote: authored.quote })
  assert.equal(caseEvidenceProjection(item).items.length, 1)
  item.evidence[0].evidence_id = 'E2'
  assert.equal(caseEvidenceProjection(item).items.length, 2)
})
