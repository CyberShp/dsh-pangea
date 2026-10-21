import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Readable } from 'node:stream'
import { buildModuleOverview } from '../src/module-overview.js'
import { buildOfflineReport } from '../src/offline-report.js'
import { buildTestCaseCsvBundle, buildTestCaseXlsx } from '../src/export.js'
import { exportRouteHandler } from '../src/index.js'
import { CaseReviewStore } from '../src/case-review-store.js'

const authored = JSON.parse(await readFile(new URL('./fixtures/native-flow.json', import.meta.url), 'utf8'))
const entries = bytes => {
  const data = Buffer.from(bytes), files = new Map()
  for (let offset = 0; offset + 30 <= data.length && data.readUInt32LE(offset) === 0x04034b50;) {
    const size = data.readUInt32LE(offset + 18), length = data.readUInt16LE(offset + 26), extra = data.readUInt16LE(offset + 28)
    const name = data.subarray(offset + 30, offset + 30 + length).toString(), start = offset + 30 + length + extra
    files.set(name, data.subarray(start, start + size).toString()); offset = start + size
  }
  return files
}
const flow = (unit, id, props = {}) => ({ ...structuredClone(authored), unit_id: unit, flow_id: `${unit}/${id}`, display_id: id, ...props })

test('overview resolves only explicit unambiguous relationships and keeps frozen units with no publication', () => {
  const a = flow('a', 'main'), b = flow('b', 'main')
  const run = { workflow: { units: [{ unit_id: 'a' }, { unit_id: 'b' }, { unit_id: 'empty' }] }, details: { business_flows: [a, b,
    flow('a', 'sub', { role: 'sub', attach_to: { flow_id: 'main', node_id: 'check' } }),
    flow('c', 'unbound', { role: 'sub', attach_to: { flow_id: 'main' } }),
    flow('c', 'explicit', { role: 'sub', attach_to: { flow_id: 'b/main' } })] } }
  const before = JSON.stringify(run), view = buildModuleOverview(run)
  assert.equal(view.units.find(unit => unit.unit_id === 'empty').flows.length, 0)
  assert.equal(view.flows[2].parent_key, view.flows[0].key)
  assert.equal(view.flows[3].parent_key, null)
  assert.match(view.flows[3].relationship, /不唯一/)
  assert.equal(view.flows[4].parent_key, view.flows[1].key)
  assert.equal(JSON.stringify(run), before)
  const duplicates = buildModuleOverview({ details: { business_flows: [a, { ...a }, flow('a', 's', { role: 'sub', attach_to: { flow_id: 'main' } })] } })
  assert.equal(duplicates.flows[2].parent_key, null)
  assert.match(duplicates.flows[2].relationship, /不唯一/)
  const bareExplicit = buildModuleOverview({ details: { business_flows: [a, flow('c', 's', { role: 'sub', attach_to: { flow_id: 'main' } })] } })
  assert.equal(bareExplicit.flows[1].parent_key, bareExplicit.flows[0].key, 'explicit unique id does not require a slash')
  assert.deepEqual(view.flows[0].main_paths, [], 'an arbitrary declared path is not a declared main path')
  const declared = buildModuleOverview({ details: { business_flows: [{ ...a, main_path_ids: ['normal'] }] } })
  assert.deepEqual(declared.flows[0].main_paths.map(path => path.path_id), ['normal'])
})

test('offline report renders all three diagrams from exact facts and retains malformed messages, diagnostics and original text', () => {
  const bad = flow('b', 'bad'); bad.sequence.messages.push({ id: 'lost', from: 'missing', to: 'receiver', label: '完整保留消息' })
  const run = { run_id: 'run', publication: { state: 'final', revision: 4 }, workflow: { actions: [{ action_id: 'a', accepted_revision: 3, revision: 4 }] }, details: { business_flows: [flow('a', 'same'), bad, { unit_id: 'c', flow_id: 'same', title: '</pre><script>alert(1)</script>' }] } }
  const before = JSON.stringify(run), report = buildOfflineReport(run, { originalText: '# 原文字报告\n<script>bad</script>' })
  const files = entries(report.bytes)
  assert.equal(JSON.stringify(run), before)
  assert.deepEqual(JSON.parse(files.get('facts.json')), run)
  assert.equal(files.get('report.md'), '# 原文字报告\n<script>bad</script>')
  assert.equal(report.manifest.publication.revision, 4)
  assert.equal(report.manifest.published_versions[0].accepted_revision, 3)
  assert.ok(report.diagnostics.some(item => item.diagram === 'sequence'))
  assert.match(report.html, /完整保留消息/)
  assert.doesNotMatch(report.html, /<script\b|<iframe\b|<link\b|<svg\b/)
  assert.match(report.html, /&lt;script&gt;alert/)
  for (const kind of ['flow', 'sequence', 'call']) assert.match(files.get(`diagrams/flow-1-${kind}.svg`), /<svg\b/)
  assert.match(report.html, /Content-Security-Policy/)
})

test('CSV bundle and XLSX append execution evidence without changing the eight-column main table or selected identities', async t => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'offline-export-')); t.after(() => rm(dataRoot, { recursive: true, force: true }))
  const items = [0, 1, 2].map(index => ({ projection_id: `u${index}/same`, unit_id: `u${index}`, display_id: 'same', title: `case${index}`, execution_readiness: 'needs_instrumentation', readiness_reason: '需要抓包', test_level: 'interface_contract', purpose: '验证边界', source_evidence: ['repo:a.c:12'], entry: '网络入口', expected_oracle: '响应长度' }))
  const store = new CaseReviewStore({ dataRoot, runId: 'run' }), revision = await store.project(items)
  const req = Readable.from([Buffer.from(JSON.stringify({ run_id: 'run', format: 'csv-bundle', scope: 'selected', case_keys: ['u2/same', 'u0/same'], case_set_revision: revision.case_set_revision }))])
  req.method = 'POST'; req.url = '/export'; req.headers = { 'sec-fetch-site': 'same-origin' }
  let output, status
  await exportRouteHandler(req, { writeHead(value) { status = value }, end(value) { output = value } }, { resolveRoot: async () => dataRoot, readRun: async () => ({ run_id: 'run', details: { test_cases: items } }) })
  assert.equal(status, 200)
  const files = entries(output), evidence = files.get('case-evidence.csv')
  assert.equal(files.get('cases.csv').split('\r\n')[0].replace(/^\uFEFF/, '').split(',').length, 8)
  assert.deepEqual(JSON.parse(files.get('manifest.json')).case_order, ['u0/same', 'u2/same'])
  assert.ok(evidence.indexOf('u0/same') < evidence.indexOf('u2/same'))
  for (const value of ['needs_instrumentation', '需要抓包', 'interface_contract', '验证边界', 'repo:a.c:12', '网络入口', '响应长度']) assert.ok(evidence.includes(value), value)
  const sheets = entries(buildTestCaseXlsx({ details: { test_cases: items } }))
  assert.match(sheets.get('xl/workbook.xml'), /执行条件与依据/)
  assert.match(sheets.get('[Content_Types].xml'), /sheet2.xml/)
  assert.match(sheets.get('xl/_rels/workbook.xml.rels'), /sheet2.xml/)
  assert.match(sheets.get('xl/worksheets/sheet2.xml'), /响应长度/)
})

test('report bundle refuses to read report files outside the exact Run boundary while retaining facts', async t => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'report-boundary-')); t.after(() => rm(dataRoot, { recursive: true, force: true }))
  const { mkdir } = await import('node:fs/promises'); await mkdir(path.join(dataRoot, 'runs', 'run'), { recursive: true })
  const outside = path.join(dataRoot, 'secret.md'); await writeFile(outside, 'secret-content')
  const req = { method: 'GET', url: '/export?run_id=run&format=report-bundle', headers: { 'sec-fetch-site': 'same-origin' } }
  let output, status
  await exportRouteHandler(req, { writeHead(value) { status = value }, end(value) { output = value } }, { resolveRoot: async () => dataRoot, readRun: async () => ({ run_id: 'run', artifacts: { report_md: outside }, details: { business_flows: [flow('a', 'one')] } }) })
  assert.equal(status, 200)
  const files = entries(output)
  assert.equal(files.get('report.md'), '')
  assert.match(files.get('diagnostics.json'), /路径越出当前 Run/)
  assert.doesNotMatch(files.get('report.html'), /secret-content/)
})

test('report export detects a changing publication instead of mixing versions', async () => {
  const req = { method: 'GET', url: '/export?run_id=run&format=report-bundle', headers: { 'sec-fetch-site': 'same-origin' } }
  let reads = 0, status, output
  await exportRouteHandler(req, { writeHead(value) { status = value }, end(value) { output = value } }, { resolveRoot: async () => os.tmpdir(), readRun: async () => ({ run_id: 'run', publication: { revision: ++reads }, details: { business_flows: [] } }) })
  assert.equal(status, 409)
  assert.equal(JSON.parse(output).code, 'publication_changed')
})

test('appendix supports columns beyond Z and preserves nested entry/oracle values', () => {
  const item = { projection_id: 'unit/case', entry: { channel: 'socket', args: ['a', 'b'] }, oracle: { response: { expected: '<ok>' } },
    ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`oracle_extra_${index}`, { expected: `value-${index}` }])) }
  const files = entries(buildTestCaseXlsx({ details: { test_cases: [item] } }))
  const sheet = files.get('xl/worksheets/sheet2.xml')
  assert.match(sheet, /r="AA2"/)
  assert.match(sheet, /max="31"/)
  assert.match(sheet, /&quot;channel&quot;:&quot;socket&quot;/)
  assert.match(sheet, /&quot;response&quot;:\{&quot;expected&quot;:&quot;&lt;ok&gt;&quot;\}/)
  assert.doesNotMatch(sheet, /\[object Object\]/)
})
