// Real download + file:// browser verification, no model or external service.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { writeArchitectureRun } from './architecture-source-first-fixture.mjs'
import { summarizeRun } from '../src/reader.js'
import { buildModuleOverview } from '../src/module-overview.js'
import { exportRouteHandler } from '../src/index.js'

const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-offline-browser-'))
const fixture = await writeArchitectureRun(root)
const raw = JSON.parse(await readFile(new URL('./fixtures/native-flow.json', import.meta.url), 'utf8'))
raw.main_path_ids = ['normal']
const result = JSON.parse(await readFile(fixture.resultPath, 'utf8'))
result.records = [{ record_id: 'flow', kind: 'flow', body: raw }, ...[0, 1].map(index => ({ record_id: `case${index}`, kind: 'test_case', body: { title: `case${index}`, execution_readiness: 'needs_instrumentation', readiness_reason: '准备抓包入口', test_level: 'interface_contract', purpose: '验证真实接口', source_evidence: ['repo:tls.c:1'], entry: { channel: 'network' }, expected_oracle: { field: 'length', value: 42 } } }))]
await writeFile(fixture.resultPath, JSON.stringify(result))
const twinTask = path.join(fixture.run, 'agent-tasks', 'twin.json'), twinResult = path.join(fixture.run, 'agent-results', 'twin.json')
const twinAction = `${fixture.task.run_id}:analysis:twin`
await writeFile(twinTask, JSON.stringify({ unit_id: 'twin', result_path: twinResult, task_type: 'source_first_analysis' }))
await writeFile(twinResult, JSON.stringify({ ...result, binding: { run_id: fixture.task.run_id, action_id: twinAction, task_id: 'twin-worker' } }))
const progressFile = path.join(fixture.run, 'progress.json'), progress = JSON.parse(await readFile(progressFile, 'utf8'))
progress.actions[twinAction] = { stage: 'unit_analysis', role: 'analysis', task_path: twinTask, task_id: 'twin-worker', status: 'accepted' }
progress.accepted_revisions[twinAction] = 3
await writeFile(progressFile, JSON.stringify(progress))
await writeFile(path.join(fixture.run, 'inputs', 'source-first-plan.json'), JSON.stringify({ units: [{ unit_id: 'tls' }, { unit_id: 'twin' }, { unit_id: 'pending' }] }))
await writeFile(path.join(fixture.run, 'report-complete.json'), JSON.stringify({ run_id: fixture.task.run_id, accepted_revisions: progress.accepted_revisions, files: ['report.md', 'report.html'] }))
const run = await summarizeRun(root, fixture.task.run_id, { includeDetails: true })
assert.equal(run.details.business_flows.length, 2)
assert.notEqual(run.details.business_flows[0].flow_id, run.details.business_flows[1].flow_id)
assert.equal(buildModuleOverview(run).units.find(unit => unit.unit_id === 'pending').flows.length, 0)
const server = createServer(async (req, res) => {
  if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); res.end(`<a href="/export?run_id=${fixture.task.run_id}&format=report-bundle">下载报告</a>`); return }
  await exportRouteHandler(req, res, { resolveRoot: async () => root })
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await playwright.chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1365, height: 1000 }, acceptDownloads: true })
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  const pending = page.waitForEvent('download'); await page.getByText('下载报告').click()
  const download = await pending, zipPath = path.join(root, download.suggestedFilename()); await download.saveAs(zipPath)
  const bytes = await readFile(zipPath), output = path.join(root, 'unpacked'); await mkdir(output)
  const files = []
  for (let offset = 0; offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50;) {
    const size = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28)
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString(), start = offset + 30 + nameLength + extra
    assert.ok(!name.includes('..') && !path.isAbsolute(name))
    const file = path.join(output, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes.subarray(start, start + size))
    files.push(name); offset = start + size
  }
  assert.equal(files.length, 11)
  for (const file of ['report.html', 'report.md', 'facts.json', 'manifest.json', 'diagnostics.json']) assert.ok(files.includes(file))
  const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'))
  assert.equal(manifest.consistency.snapshot_window, 'verified_before_after')
  assert.equal(manifest.consistency.original_text_version, 'accepted_revisions_match_no_original_digest')
  assert.equal(manifest.records.length, 2)
  await new Promise(resolve => server.close(resolve))
  const errors = [], network = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()) })
  await page.goto(pathToFileURL(path.join(output, 'report.html')).href)
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0))
  assert.equal(await page.locator('img').count(), 6)
  assert.deepEqual(errors, []); assert.deepEqual(network, [])
  await page.locator('figure').first().screenshot({ path: path.join(root, 'offline-flow.png') })
  const facts = JSON.parse(await readFile(path.join(output, 'facts.json'), 'utf8'))
  assert.deepEqual(facts.details.business_flows.map(flow => flow.source_record.body), [raw, raw])
  console.log(JSON.stringify({ root, zipPath, files, images_loaded: 6, external_requests: network.length, screenshot: path.join(root, 'offline-flow.png') }, null, 2))
} finally {
  await browser.close()
  if (server.listening) await new Promise(resolve => server.close(resolve))
}
