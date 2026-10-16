import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import {
  isReviewRecord, renderReviewPresentation, reviewPresentation, reviewStatusLabel,
} from '../src/review-presentation.js'
import { inlineModule } from '../scripts/build-client.mjs'

const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter(item => item != null) })
const nodes = tree => tree && typeof tree === 'object' ? [tree, ...(tree.children ?? []).flatMap(nodes)] : []
const texts = tree => typeof tree === 'string' || typeof tree === 'number' ? [String(tree)] : (tree?.children ?? []).flatMap(texts)
const field = (projection, name) => projection.tree.fields.find(item => item.key === name)

test('known decision metadata is localized and ordered while body remains untouched', () => {
  const body = { version_set_id: 'vs-001', correction_record_ids: ['rec-000007'], summary: '需要补齐一个预期。',
    reasoning: '源码返回值已有依据。', disposition: 'finding', open_issues: ['远端契约待确认'] }
  const original = JSON.stringify(body)
  const result = reviewPresentation(body)
  assert.equal(result.tree.fields[0].key, 'disposition')
  assert.equal(field(result, 'disposition').value.text, '需定向修正')
  assert.equal(field(result, 'version_set_id').label, '本次对照版本')
  assert.equal(field(result, 'version_set_id').value.text, 'vs-001')
  assert.equal(field(result, 'correction_record_ids').label, '需修正的记录')
  assert.equal(JSON.stringify(body), original)
  assert.deepEqual(JSON.parse(result.raw), body)
})

test('legacy JSON strings and fenced JSON are structured without changing saved raw text', () => {
  for (const raw of [' {"disposition":"PASS","summary":"old English prose"} ', '```json\n{"disposition":"unresolved"}\n```']) {
    const result = reviewPresentation(raw)
    assert.equal(result.tree.type, 'object')
    assert.equal(result.raw, raw)
  }
  assert.equal(reviewPresentation('{"disposition":"PASS"}').tree.fields[0].value.text, '通过')
})

test('English semantic prose and identifiers are never guessed or translated', () => {
  const body = { disposition: 'pass', summary: 'pass', conclusion: 'The callback contract is not available.',
    case_id: 'pass', source_evidence: ['repo:PASS.c:19'], evidence_quotes: [{ snippet: 'return PASS;', ref: 'r:c.c:1' }] }
  const result = reviewPresentation(body)
  assert.equal(field(result, 'summary').value.text, 'pass')
  assert.equal(field(result, 'conclusion').value.text, body.conclusion)
  assert.equal(field(result, 'case_id').value.text, 'pass')
  assert.ok(texts(renderReviewPresentation(h, body)).includes('return PASS;'))
})

test('evidence and identifier subtrees remain literal even when they contain enum-shaped fields', () => {
  const source = [{ status: 'pass', nested: { disposition: 'unresolved', summary: 'Source summary' } }]
  const snippet = { status: 'pass', verdict: 'finding' }
  const ref = { status: 'unresolved', path: 'repo:src/check.c:4' }
  const body = { source_evidence: source, evidence_quotes: [{ snippet, ref }],
    correction_record_ids: [{ status: 'pass', record_id: 'rec-1' }],
    basis: { status: 'pass', disposition: 'unresolved' } }
  const result = reviewPresentation(body)
  assert.equal(field(result, 'source_evidence').value.type, 'scalar')
  assert.equal(field(result, 'source_evidence').value.preserve, true)
  assert.equal(field(result, 'source_evidence').value.text, JSON.stringify(source, null, 2))
  const visible = texts(renderReviewPresentation(h, body))
  for (const literal of [source, snippet, ref, body.correction_record_ids]) assert.ok(visible.includes(JSON.stringify(literal, null, 2)))
  assert.ok(visible.includes('通过'))
  assert.ok(visible.includes('待确认'))
  assert.deepEqual(JSON.parse(result.raw), body)
})

test('unknown fields, enum values and prototype-named keys remain original text', () => {
  const body = JSON.parse('{"disposition":"PASS_WITH_CAVEATS","constructor":"x","__proto__":"y","future_rule":{"status":"awaiting-owner"}}')
  const result = reviewPresentation(body)
  assert.equal(field(result, 'constructor').label, 'constructor')
  assert.equal(field(result, '__proto__').label, '__proto__')
  assert.equal(field(result, 'disposition').value.text, 'PASS_WITH_CAVEATS')
  assert.equal(reviewStatusLabel('toString'), 'toString')
  assert.ok(texts(renderReviewPresentation(h, body)).includes('awaiting-owner'))
})

test('mixed arrays and translated-label collisions retain every original field', () => {
  const body = { unresolved: ['first', 0, false, null, { unit_id: 'unit-2', reason: '第二项' }],
    unresolved_items: ['third'], custom: [] }
  const result = reviewPresentation(body)
  assert.equal(result.tree.fields.length, 3)
  assert.equal(field(result, 'unresolved').label, field(result, 'unresolved_items').label)
  const visible = texts(renderReviewPresentation(h, body))
  for (const expected of ['first', '0', 'false', 'null', 'unit-2', '第二项', 'third', '空列表（原记录）']) assert.ok(visible.includes(expected), expected)
  assert.ok(!visible.includes('通过'))
  assert.ok(!visible.includes('没有问题'))
})

test('malformed, empty and legacy Markdown bodies preserve original content', () => {
  for (const raw of ['{"disposition":', '# Review\n\n- first\n- second', '', null, 0, false]) {
    const result = reviewPresentation(raw)
    assert.equal(result.tree.type, 'scalar')
    const visible = texts(renderReviewPresentation(h, raw))
    assert.ok(visible.includes(raw == null ? 'null' : String(raw)))
  }
})

test('renderer supplies separate semantic sections, nested lists and accessible raw content', () => {
  const body = { disposition: 'unresolved', summary: '第一段\n\n第二段', basis: ['入口已读', '回调契约未提供'],
    corrections: [{ record_id: 'rec-1', required_change: '补逐步预期' }] }
  const calls = []
  const tree = renderReviewPresentation(h, body, { renderText: text => { calls.push(text); return h('p', null, text) } })
  assert.equal(nodes(tree).filter(item => item.type === 'section' && item.props['data-review-field']).length, 6)
  assert.ok(nodes(tree).some(item => item.type === 'ol'))
  assert.ok(texts(tree).includes('查看原始复核记录'))
  assert.ok(calls.includes('第一段\n\n第二段'))
  assert.ok(texts(tree).includes('rec-1'))
  assert.ok(!nodes(tree).some(item => item.props.dangerouslySetInnerHTML))
})

test('HTML-like text is never executed and long prose is not truncated', () => {
  const content = '<img src=x onerror=alert(1)>' + '长'.repeat(12000)
  const tree = renderReviewPresentation(h, { summary: content })
  assert.ok(texts(tree).includes(content))
  assert.ok(!nodes(tree).some(item => item.type === 'img' || item.type === 'script'))
})

test('record classification is explicit and does not parse prose for review keywords', () => {
  assert.equal(isReviewRecord({ kind: 'review_decision' }), true)
  assert.equal(isReviewRecord({ kind: 'note' }, 'comparison_review'), true)
  assert.equal(isReviewRecord({ kind: 'summary' }, 'independent_review'), true)
  assert.equal(isReviewRecord({ kind: 'note', body: 'review_decision pass' }, 'unit_analysis'), false)
  assert.equal(isReviewRecord(null), false)
  assert.equal(reviewStatusLabel('refuted'), '已反证')
  assert.equal(reviewStatusLabel('disagree'), '不同意')
})

test('shared module can be inlined without runtime imports or dependencies', async () => {
  const code = await readFile(new URL('../src/review-presentation.js', import.meta.url), 'utf8')
  const context = { output: null }
  vm.runInNewContext(inlineModule('__reviewPresentation', code, []) + '\noutput = __reviewPresentation.reviewStatusLabel("finding")', context)
  assert.equal(context.output, '需定向修正')
})

test('actual source-first review reader uses structured view and keeps raw access', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  const start = source.indexOf('function renderSourceFirstRecords(')
  const end = source.indexOf('\n      function renderSourceFirstWorkflow(', start)
  assert.ok(start > 0 && end > start)
  const context = { h, current: {}, styles: {}, RECORD_LABELS: { review_decision: '复核结论', note: '分析说明' },
    text: (value, fallback) => value ?? fallback, sourceFirstRecordBody: JSON.stringify, isReviewRecord,
    renderReviewPresentation, renderReadableBody: value => h('p', null, value), output: null,
    groups: [{ stage: 'comparison_review', action_id: 'review-1', revision: 2, records: [
      { kind: 'review_decision', record_id: 'rec-1', body: { disposition: 'finding', correction_record_ids: ['rec-2'], summary: '修正预期' } },
    ] }] }
  vm.runInNewContext(`output = (${source.slice(start, end)})(groups)`, context)
  const visible = texts(context.output)
  for (const expected of ['复核裁决', '需定向修正', '需修正的记录', '查看原始复核记录']) assert.ok(visible.includes(expected), expected)
  assert.ok(nodes(context.output).some(item => item.type === 'details' && item.props.open === true))
})

test('actual legacy review view tolerates mixed shapes and exposes all unknown data', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  const start = source.indexOf('function renderReview() {')
  const end = source.indexOf('\n      let body', start)
  const review = { status: 'uncertain', comparison: { decisions: 'legacy non-array content' },
    summary: { basis: ['中文', 'English kept'] }, vendor_extension: { expected: '保留未知字段' } }
  const context = { h, React: { Fragment: 'fragment' }, styles: {}, current: { review },
    details: { review_issues: [{ issue_id: 'issue-1', reason: { scope: '旧记录结构' } }] },
    renderReviewPresentation, renderReadableBody: value => h('p', null, value), output: null }
  vm.runInNewContext(`output = (${source.slice(start, end)})()`, context)
  const visible = texts(context.output)
  for (const text of ['待确认', 'legacy non-array content', 'English kept', '保留未知字段', '旧记录结构']) assert.ok(visible.includes(text), text)
  assert.ok(visible.includes(JSON.stringify(review, null, 2)))
})
