import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { scanAssets } from '../src/catalog.js'
import { loadBundledSkills } from '../src/bundled-skills.js'
import { AssetExtractionRuntime, loadConfirmedIssues, saveHistoricalIssueReview } from '../src/extraction.js'

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-model-extraction-'))
  const dataRoot = path.join(root, 'pangea-data')
  await mkdir(path.join(dataRoot, 'inbox'), { recursive: true })
  const sourcePath = path.join(dataRoot, 'inbox', 'historical-incident.md')
  await writeFile(sourcePath, [
    '# Historical incident',
    '',
    'During reconnect, cleanup timed out and state leaked to a peer instance.',
    '',
    'Root cause: a shared callback remained registered.',
    '',
    'Resolution: unregister the callback before reconnect. Verification: repeat reconnect ten times.',
  ].join('\n'), 'utf8')
  const snapshot = await scanAssets({ dataRoot })
  return { root, dataRoot, sourcePath, asset: snapshot.assets[0] }
}

function fakeApi() {
  const prompts = []
  const titles = []
  let next = 1
  return {
    prompts,
    titles,
    sessions: {
      async create() { return { result: { ok: true, value: { sessionId: `session-${next++}` } } } },
      async rename(value) { titles.push(value.payload); return { result: { ok: true, value: {} } } },
      async prompt(value) { prompts.push(value.payload); return { result: { ok: true, value: { accepted: true } } } },
    },
  }
}

function issue(excerpt, location = 'inbox/historical-incident.md#line=3') {
  return {
    title: 'Reconnect cleanup leaked state',
    symptom: 'State leaked to a peer instance.',
    trigger_conditions: ['Reconnect while cleanup is running'],
    impact: ['Peer instance receives stale state'],
    root_causes: ['Shared callback remained registered'],
    resolutions: ['Unregister callback before reconnect'],
    verification: ['Repeat reconnect ten times'],
    limitations: [],
    missing_fields: [],
    confidence: 'high',
    evidence: [{ location, excerpt }],
  }
}

test('bundled extraction skills are explicit-only and carry their submission contracts', async () => {
  const skills = await loadBundledSkills()
  assert.deepEqual(skills.map(skill => skill.name), [
    'pangea-extract-historical-issues', 'pangea-derive-methodology-candidates',
  ])
  assert.ok(skills.every(skill => skill.invocation.modelInvocable === false && skill.invocation.userInvocable === true))
  assert.match(skills[0].content, /pangea_asset_issue_submit/)
  assert.match(skills[0].content, /Do not inspect other inbox assets, PANGEA Runs/)
  assert.match(skills[1].content, /only the confirmed-issues JSON path/)
})

test('runs one-asset extraction, rejects ungrounded evidence, and preserves source files', async () => {
  const value = await fixture()
  const before = await readFile(value.sourcePath, 'utf8')
  const api = fakeApi()
  const runtime = new AssetExtractionRuntime(api)
  const launched = await runtime.startHistoricalIssues({ dataRoot: value.dataRoot, assetId: value.asset.asset_id })
  assert.equal(launched.session_id, 'session-1')
  assert.match(api.prompts[0].content[0].text, /^\/pangea-extract-historical-issues\n/)
  assert.match(api.prompts[0].content[0].text, new RegExp(value.asset.asset_id))
  const exec = { agent: { session: { id: launched.session_id } } }
  await assert.rejects(
    runtime.submitHistoricalIssues({ asset_id: value.asset.asset_id, issues: [issue('invented', 'inbox/other.md#line=1')] }, exec),
    /not a source marker from this asset/,
  )
  await assert.rejects(
    runtime.submitHistoricalIssues({ asset_id: value.asset.asset_id, issues: [issue('invented')] }, exec),
    /not an exact substring.*preserve Markdown characters/,
  )
  const result = await runtime.submitHistoricalIssues({
    asset_id: value.asset.asset_id,
    issues: [issue('During reconnect, cleanup timed out and state leaked to a peer instance.', 'inbox/historical-incident.md#line=5')],
  }, exec)
  assert.equal(result.issue_count, 1)
  const output = JSON.parse(await readFile(result.output_path, 'utf8'))
  assert.equal(output.extraction_status, 'completed')
  assert.equal(output.issues[0].status, 'draft')
  assert.equal(output.issues[0].issue_id, `${value.asset.asset_id}-r1-issue-001`)
  assert.equal(output.issues[0].evidence[0].location, 'inbox/historical-incident.md#line=3')
  assert.equal(await readFile(value.sourcePath, 'utf8'), before)
  const normalized = await readFile(launched.normalized_path, 'utf8')
  assert.match(normalized, /<!-- source: inbox\/historical-incident\.md#line=3 -->/)
})

test('stores reviews separately and derives methodology only from confirmed issues', async () => {
  const value = await fixture()
  const api = fakeApi()
  const runtime = new AssetExtractionRuntime(api)
  const launched = await runtime.startHistoricalIssues({ dataRoot: value.dataRoot, assetId: value.asset.asset_id })
  const extraction = await runtime.submitHistoricalIssues({
    asset_id: value.asset.asset_id,
    issues: [issue('During reconnect, cleanup timed out and state leaked to a peer instance.')],
  }, { agent: { session: { id: launched.session_id } } })
  const extracted = JSON.parse(await readFile(extraction.output_path, 'utf8'))
  const extractedIssue = extracted.issues[0]
  await saveHistoricalIssueReview({
    dataRoot: value.dataRoot, assetId: value.asset.asset_id, issueId: extractedIssue.issue_id,
    decision: 'confirmed', correctedIssue: { ...extractedIssue, title: 'Confirmed reconnect cleanup leak' },
  })
  const confirmed = await loadConfirmedIssues(value.dataRoot)
  assert.equal(confirmed.length, 1)
  assert.equal(confirmed[0].title, 'Confirmed reconnect cleanup leak')

  const methodJob = await runtime.startMethodology({ dataRoot: value.dataRoot })
  assert.equal(methodJob.session_id, 'session-2')
  assert.match(api.prompts[1].content[0].text, /^\/pangea-derive-methodology-candidates\n/)
  assert.match(api.prompts[1].content[0].text, /confirmed_issue_count: 1/)
  const candidate = {
    title: 'Verify callback cleanup before reconnect',
    applicable_when: ['Reconnect can overlap cleanup'],
    checks: ['Confirm callback unregister completes before reconnect'],
    expected_signals: ['No stale state reaches peer instances'],
    failure_signals: ['Peer receives state from the previous session'],
    exceptions: [],
    source_issue_ids: [extractedIssue.issue_id],
    evidence: extractedIssue.evidence,
  }
  const method = await runtime.submitMethodology({ candidates: [candidate] }, { agent: { session: { id: methodJob.session_id } } })
  const methodology = JSON.parse(await readFile(method.output_path, 'utf8'))
  assert.equal(methodology.source, 'confirmed_historical_issues')
  assert.deepEqual(methodology.confirmed_issue_ids, [extractedIssue.issue_id])
  assert.equal(methodology.candidates[0].status, 'draft')
  assert.equal(methodology.candidates[0].non_binding, true)
})

test('marks a model job failed when its DSH turn ends without a validated submission', async () => {
  const value = await fixture()
  const runtime = new AssetExtractionRuntime(fakeApi())
  const launched = await runtime.startHistoricalIssues({ dataRoot: value.dataRoot, assetId: value.asset.asset_id })
  const agent = { session: { id: launched.session_id } }
  runtime.handleAgentStatus(agent, 'running')
  runtime.handleAgentStatus(agent, 'idle')
  const state = await runtime.decorateState(await scanAssets({ dataRoot: value.dataRoot }))
  assert.equal(state.assets[0].historical_extraction.job.status, 'failed')
  assert.match(state.assets[0].historical_extraction.job.error, /without submitting/)
})
