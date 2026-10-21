import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { writeArchitectureRun } from './architecture-source-first-fixture.mjs'
import { summarizeRun } from '../src/reader.js'
import { normalizeFlow } from '../src/flow-normalize.js'
import { validateCallGraph } from '../src/call-graph.js'
import { normalizeSequence, layoutSequence, renderSequenceTree } from '../src/sequence-diagram.js'
import { layoutFlow, layoutCallGraph } from '../src/flow-graph/layout.js'
import { renderFlowTree, renderCallGraphTree, toSvgString } from '../src/flow-graph/render.js'

const authored = JSON.parse(await readFile(new URL('./fixtures/native-flow.json', import.meta.url), 'utf8'))

async function fixture(t, body) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-flow-diagrams-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const f = await writeArchitectureRun(root)
  if (body) {
    const result = JSON.parse(await readFile(f.resultPath, 'utf8'))
    result.records.find(row => row.record_id === 'flow').body = body
    await writeFile(f.resultPath, JSON.stringify(result))
  }
  return f
}

test('one accepted Agent flow delivers three native diagrams without a derived job or evidence loss', async t => {
  const f = await fixture(t, authored)
  const before = await readFile(f.resultPath, 'utf8')
  const summary = await summarizeRun(f.task.data_root, f.task.run_id, { includeDetails: true })
  const flow = summary.details.business_flows.find(row => row.flow_id === f.flowId)
  assert.deepEqual(flow.sequence, authored.sequence)
  assert.deepEqual(flow.call_graph, authored.call_graph)
  assert.deepEqual(flow.nodes[0].source_evidence, authored.nodes[0].source_evidence)
  assert.equal(flow.call_graph.status, 'partial')
  assert.deepEqual(flow.source_record.body, authored)
  const sequence = normalizeSequence(flow.sequence)
  const calls = validateCallGraph(flow.call_graph)
  assert.notEqual(sequence.status, 'invalid')
  assert.equal(calls.status, 'ok')
  for (const svg of [
    toSvgString(renderFlowTree(layoutFlow(flow))),
    toSvgString(renderSequenceTree(layoutSequence(sequence.graph))),
    toSvgString(renderCallGraphTree(layoutCallGraph(calls.graph))),
  ]) {
    assert.match(svg, /<svg\b/)
    assert.doesNotMatch(svg, /(?:NaN|Infinity|<script\b)/)
  }
  assert.equal(await readFile(f.resultPath, 'utf8'), before)
  await assert.rejects(access(path.join(f.run, '派生视图')), { code: 'ENOENT' })
})

test('legacy flow stays readable without inventing sequence messages or function calls', async t => {
  const f = await fixture(t)
  const summary = await summarizeRun(f.task.data_root, f.task.run_id, { includeDetails: true })
  const flow = summary.details.business_flows.find(row => row.flow_id === f.flowId)
  assert.equal(flow.sequence, undefined)
  assert.equal(flow.call_graph, undefined)
  assert.equal(flow.nodes.length, 4)
  await assert.rejects(access(path.join(f.run, '派生视图')), { code: 'ENOENT' })
})

test('unusable optional diagram data does not erase valid flow or the authored evidence', async t => {
  const raw = { ...authored, sequence: { ...authored.sequence, messages: [{ id: 'unknown', from: 'missing', to: 'receiver', label: '待核对的原始记录' }] },
    call_graph: { ...authored.call_graph, calls: [{ from: 'missing', to: 'check', args: [], returns: '' }] } }
  const f = await fixture(t, raw)
  const summary = await summarizeRun(f.task.data_root, f.task.run_id, { includeDetails: true })
  const flow = summary.details.business_flows.find(row => row.flow_id === f.flowId)
  assert.equal(flow.nodes.length, authored.nodes.length)
  assert.deepEqual(flow.sequence, raw.sequence)
  assert.deepEqual(flow.call_graph, raw.call_graph)
  assert.ok(normalizeSequence(flow.sequence).errors.length)
  assert.ok(validateCallGraph(flow.call_graph).errors.length)
  assert.deepEqual(normalizeFlow(raw).source_evidence, raw.source_evidence)
  assert.equal(summary.lifecycle_status, 'complete')
})

test('all seven main/sub flows retain their own sequence and function facts through projection', async t => {
  const f = await fixture(t, authored)
  const result = JSON.parse(await readFile(f.resultPath, 'utf8'))
  result.records = Array.from({ length: 7 }, (_, index) => ({
    record_id: `flow-${index}`, kind: 'flow', evidence: ['repo:receive.c:10-50'],
    body: { ...structuredClone(authored), flow_id: `flow-${index}`, role: index === 0 ? 'main' : 'sub',
      title: `流程 ${index + 1}` },
  }))
  await writeFile(f.resultPath, JSON.stringify(result))
  const before = await readFile(f.resultPath, 'utf8')
  const summary = await summarizeRun(f.task.data_root, f.task.run_id, { includeDetails: true })
  const flows = summary.details.business_flows
  assert.equal(flows.length, 7)
  for (const record of result.records) {
    const flow = flows.find(row => row.source_record?.record_id === record.record_id)
    assert.ok(flow, record.record_id)
    assert.deepEqual(flow.sequence, record.body.sequence)
    assert.deepEqual(flow.call_graph, record.body.call_graph)
    const sequence = layoutSequence(flow.sequence)
    assert.equal(sequence.messages.length, record.body.sequence.messages.length)
    assert.equal(sequence.fragments.length, 1)
    assert.equal(validateCallGraph(flow.call_graph).graph.calls.length, 2)
  }
  assert.equal(await readFile(f.resultPath, 'utf8'), before)
  assert.equal(summary.lifecycle_status, 'complete')
})
