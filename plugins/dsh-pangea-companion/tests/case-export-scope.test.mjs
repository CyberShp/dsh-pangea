import assert from 'node:assert/strict'
import test from 'node:test'
import { inflateRawSync } from 'node:zlib'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { CaseReviewStore } from '../src/case-review-store.js'
import { exportRouteHandler } from '../src/index.js'
const headers = ['用例ID', '标题', '类型', '前置条件', '操作步骤', '预期结果', '观察点', '清理动作（环境恢复）']

function csvRows(csv) {
  const rows = [], row = []
  let value = '', quoted = false
  const input = csv.replace(/^\uFEFF/, '')
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { value += '"'; i++ }
      else quoted = !quoted
    } else if (char === ',' && !quoted) { row.push(value); value = '' }
    else if ((char === '\r' || char === '\n') && !quoted) {
      if (char === '\r' && input[i + 1] === '\n') i++
      row.push(value); rows.push([...row]); row.length = 0; value = ''
    } else value += char
  }
  if (value || row.length) { row.push(value); rows.push(row) }
  assert.equal(quoted, false, 'CSV must not end inside a quoted field')
  return rows
}

function xlsxSheet(xlsx) {
  const data = Buffer.from(xlsx)
  assert.equal(data.subarray(0, 2).toString(), 'PK')
  for (let offset = 0; offset + 30 <= data.length && data.readUInt32LE(offset) === 0x04034b50;) {
    const method = data.readUInt16LE(offset + 8), size = data.readUInt32LE(offset + 18)
    const nameLength = data.readUInt16LE(offset + 26), extraLength = data.readUInt16LE(offset + 28)
    const name = data.subarray(offset + 30, offset + 30 + nameLength).toString()
    const start = offset + 30 + nameLength + extraLength
    if (name === 'xl/worksheets/sheet1.xml') {
      const bytes = data.subarray(start, start + size)
      return (method === 8 ? inflateRawSync(bytes) : bytes).toString()
    }
    offset = start + size
  }
  assert.fail('XLSX package has no test-case worksheet')
}

const unescapeXml = value => value.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name])
function xlsxRows(xlsx) {
  return [...xlsxSheet(xlsx).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(([, row]) =>
    [...row.matchAll(/<c\b[^>]*\/>|<c\b[^>]*>([\s\S]*?)<\/c>/g)].map(([, cell = '']) =>
      unescapeXml([...cell.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(([, text]) => text).join(''))))
}


test('all four HTTP export scopes produce identical eight-column CSV/XLSX row sets', async t => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'export-scopes-')); t.after(() => rm(dataRoot, { recursive: true, force: true }))
  const items = ['alpha', 'beta', 'gamma'].map((name, index) => ({ projection_id: `unit/c${index}`, test_case_id: `internal-${index}`, display_id: 'TC-duplicate', title: `${name},"quoted"\n第二行`, steps: [{ action: `step-${name}`, expected: `result-${name}` }] }))
  const store = new CaseReviewStore({ dataRoot, runId: 'run-a' }), initial = await store.project(items)
  const review = await store.update(items, { expected_revision: 0, case_key: 'unit/c1', expected_content_hash: initial.cases[1].content_hash, decision: 'adopted' })
  let current = items
  async function call(input, method = 'POST') {
    const req = Readable.from(method === 'POST' ? [Buffer.from(JSON.stringify({ run_id: 'run-a', ...input }))] : []); req.method = method; req.url = `/export?run_id=run-a&format=${input.format}`; req.headers = { 'sec-fetch-site': 'same-origin' }
    const res = {}; await exportRouteHandler(req, { writeHead(status) { res.status = status }, end(body) { res.bytes = Buffer.from(body) } }, { resolveRoot: async () => dataRoot, readRun: async () => ({ run_id: 'run-a', details: { test_cases: current } }) }); return res
  }
  for (const [scope, keys, indices] of [['all', undefined, [0, 1, 2]], ['filtered', ['unit/c0', 'unit/c2'], [0, 2]], ['selected', ['unit/c2'], [2]], ['adopted', undefined, [1]]]) {
    const outputs = []
    for (const format of ['csv', 'xlsx']) {
      const result = await call({ format, scope, case_keys: keys, case_set_revision: review.case_set_revision, review_revision: review.revision })
      assert.equal(result.status, 200, `${scope}/${format}: ${result.bytes}`)
      const rows = format === 'csv' ? csvRows(result.bytes.toString()) : xlsxRows(result.bytes)
      assert.deepEqual(rows[0], headers); assert.ok(rows.every(row => row.length === 8)); assert.deepEqual(rows.slice(1).map(row => row[1]), indices.map(index => items[index].title)); outputs.push(rows)
    }
    assert.deepEqual(outputs[0], outputs[1])
  }
  assert.equal((await call({ format: 'csv' }, 'GET')).status, 200, 'legacy GET still exports all')
  for (const scope of ['selected', 'filtered']) assert.equal((await call({ format: 'csv', scope, case_keys: [], case_set_revision: review.case_set_revision })).status, 422)
  current = items.map((item, index) => index === 1 ? { ...item, steps: [{ action: 'revised', expected: 'recheck' }] } : item)
  const changed = await store.project(current); assert.equal(changed.counts.needs_recheck, 1)
  assert.equal((await call({ format: 'csv', scope: 'adopted', case_set_revision: changed.case_set_revision, review_revision: changed.revision })).status, 422, 'stale adopted decisions cannot silently export newer cases')
})
