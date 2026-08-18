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

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-companion-'))
  const dataRoot = path.join(root, 'pangea-data')
  const runDirectory = path.join(dataRoot, 'runs', 'run-01')
  await mkdir(runDirectory, { recursive: true })
  await writeJson(path.join(runDirectory, 'progress.json'), {
    schema_version: '1.0',
    run_id: 'run-01',
    contract_digest: 'a'.repeat(64),
    phase: 'WAITING_REVIEW',
    analysis_units: ['u1', 'u2'],
    completed_analysis_units: ['u1', 'u2'],
    completed_rework_units: ['u1'],
    quality_status: null,
    errors: [],
    error_history: [],
  })
  await writeJson(path.join(runDirectory, 'agent-results', 'analysis', 'u1.json'), {
    unit_id: 'u1', attempt: 0,
    risks: [{ id: 'old' }, { id: 'old-2' }],
    test_cases: [{ id: 'old' }], evidence: [{ id: 'e1' }], business_flows: [],
  })
  await writeJson(path.join(runDirectory, 'agent-results', 'rework', 'u1.json'), {
    unit_id: 'u1', attempt: 1,
    risks: [{ id: 'new' }],
    test_cases: [{ id: 't1' }, { id: 't2' }], evidence: [{ id: 'e1' }, { id: 'e2' }], business_flows: [{ id: 'f1' }],
  })
  await writeJson(path.join(runDirectory, 'agent-results', 'analysis', 'u2.json'), {
    unit_id: 'u2', attempt: 0,
    risks: [{ id: 'r2' }],
    test_cases: [{ id: 't3' }], evidence: [{ id: 'e3' }], business_flows: [{ id: 'f2' }],
  })
  await writeJson(path.join(runDirectory, 'agent-results', 'review.json'), {
    status: 'REWORK', reviewer_id: 'reviewer-1', summary: 'one issue',
    issues: [{ issue_id: 'i1' }],
  })
  return { root, dataRoot, runDirectory }
}

test('discovers pangea-data from workspace root', async () => {
  const { root, dataRoot } = await fixture()
  try {
    assert.equal(await discoverPangeaDataRoot({ cwd: root }), dataRoot)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('summarizes current run without double-counting replaced rework results', async () => {
  const { root } = await fixture()
  try {
    const snapshot = await companionSnapshot({ cwd: root })
    assert.equal(snapshot.current.run_id, 'run-01')
    assert.equal(snapshot.current.phase, 'WAITING_REVIEW')
    assert.deepEqual(snapshot.current.analysis, { total: 2, completed: 2, reworked: 1 })
    assert.deepEqual(snapshot.current.counts, {
      risks: 2,
      test_cases: 3,
      evidence: 3,
      business_flows: 2,
      review_issues: 1,
    })
    assert.equal(snapshot.current.quality_status, null)
    assert.equal(snapshot.current.review.status, 'REWORK')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('registers one read-only status tool and one state route', () => {
  const tools = []
  const routes = []
  const effects = []
  apply({
    tools: { register(tool) { tools.push(tool) } },
    webServer: { register(route) { routes.push(route); return () => {} } },
    effect(callback) { effects.push(callback) },
  })
  assert.deepEqual(tools.map(tool => tool.name), ['pangea_status'])
  assert.match(tools[0].description, /read-only/i)
  assert.equal(routes.length, 1)
  assert.equal(routes[0].path, '/api/pangea-companion/state')
  assert.equal(effects.length, 1)
})
