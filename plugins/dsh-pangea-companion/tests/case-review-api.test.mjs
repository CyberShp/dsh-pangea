import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { caseReviewRouteHandler, exportRouteHandler } from '../src/index.js'

async function fixture(t) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'review-api-')); t.after(() => rm(dataRoot, { recursive: true, force: true }))
  const run = { run_id: 'run-a', details: { test_cases: [{ test_case_id: 'unit/case-a', title: 'Case A' }, { test_case_id: 'unit/case-b', title: 'Case B' }] } }
  const original = path.join(dataRoot, 'original-result.json'); await writeFile(original, JSON.stringify(run))
  const deps = { resolveRoot: async () => dataRoot, readRun: async () => JSON.parse(await readFile(original, 'utf8')) }
  async function call(handler, body, sameOrigin = true) {
    const request = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : [])
    request.method = body ? 'POST' : 'GET'; request.url = '/api/pangea-companion/case-reviews?run_id=run-a'; request.headers = { 'sec-fetch-site': sameOrigin ? 'same-origin' : 'cross-site' }
    const response = {}
    await handler(request, { writeHead(code, headers) { response.code = code; response.headers = headers }, end(value) { response.raw = Buffer.from(value); try { response.body = JSON.parse(response.raw) } catch {} } }, deps)
    return response
  }
  return { call, original, originalText: JSON.stringify(run) }
}
test('HTTP review persists an overlay, rejects conflicts and preserves original analysis bytes', async t => {
  const { call, original, originalText } = await fixture(t)
  const initial = await call(caseReviewRouteHandler)
  assert.equal(initial.code, 200)
  const input = { run_id: 'run-a', expected_revision: 0, case_key: 'unit/case-a', expected_content_hash: initial.body.cases[0].content_hash, decision: 'adopted' }
  const saved = await call(caseReviewRouteHandler, input); assert.equal(saved.code, 200); assert.equal(saved.body.counts.adopted, 1)
  assert.equal((await call(caseReviewRouteHandler)).body.counts.adopted, 1)
  assert.equal((await call(caseReviewRouteHandler, { ...input, decision: 'excluded' })).code, 409)
  assert.equal((await call(caseReviewRouteHandler, input, false)).code, 403)
  assert.equal(await readFile(original, 'utf8'), originalText)
})
test('HTTP export returns only requested rows with eight columns; empty and stale ranges never download all', async t => {
  const { call } = await fixture(t), initial = (await call(caseReviewRouteHandler)).body
  const input = { run_id: 'run-a', format: 'csv', scope: 'selected', case_keys: ['unit/case-b'], case_set_revision: initial.case_set_revision }
  const exported = await call(exportRouteHandler, input)
  assert.equal(exported.code, 200)
  const rows = exported.raw.toString().replace(/^\uFEFF/, '').trim().split('\r\n')
  assert.equal(rows.length, 2); assert.equal(rows[0].split(',').length, 8); assert.match(rows[1], /Case B/); assert.doesNotMatch(rows[1], /Case A/)
  assert.equal((await call(exportRouteHandler, { ...input, case_keys: [] })).code, 422)
  assert.equal((await call(exportRouteHandler, { ...input, case_set_revision: 'obsolete' })).code, 409)
})
