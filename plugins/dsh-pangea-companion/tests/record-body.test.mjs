import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parseRecordBody } from '../src/record-body.js'

const original = JSON.parse(await readFile(new URL('./fixtures/nvme-auth-rec-000011.json', import.meta.url), 'utf8'))
const caseBody = { format_version: 'behavior-test-case-v1', case_id: 'TC-1', title: 'Literal delimiters',
  steps: [{ action: 'Run the command', expected: 'The command rejects input' }], execution_status: 'not_run' }
const broken = body => JSON.stringify(body).replace('"expected":"The command rejects input"}', '"expected":"The command rejects input"]')
const record = body => ({ kind: 'test_case', body })

test('the original NVMe record recovers all fields through its sole mismatched closing delimiter', () => {
  const before = JSON.stringify(original), result = parseRecordBody(original)
  assert.equal(result.record_parse.status, 'recovered')
  assert.equal(result.record_parse.code, 'single_closing_delimiter')
  const [issue] = result.record_parse.diagnostics
  assert.equal(result.record_parse.diagnostics.length, 1)
  assert.deepEqual({ offset: issue.offset, line: issue.line, column: issue.column, found: issue.found, expected: issue.expected, severity: issue.severity },
    { offset: 767, line: 1, column: 768, found: ']', expected: '}', severity: 'warning' })
  assert.equal(result.body.title, "Authentication failure when controller's challenge has invalid DH value length")
  assert.equal(result.body.case_id, 'TC-007')
  assert.equal(result.body.preconditions.length, 4)
  assert.equal(result.body.steps.length, 2)
  assert.equal(result.body.external_observations.length, 3)
  assert.equal(result.body.source_evidence.length, 2)
  assert.deepEqual(result.body.flow_refs, [{ flow_id: 'F-002', path_id: 'P-07' }])
  const expected = JSON.parse(original.body.slice(0, 767) + '}' + original.body.slice(768))
  assert.deepEqual(result.body, expected, 'recovery retains every authored field, not only the title')
  assert.equal(JSON.stringify(original), before)
})

test('normal objects and valid legacy JSON remain unchanged and do not gain a recovery status', () => {
  for (const body of [caseBody, JSON.stringify(caseBody), { title: 'Legacy case', custom_field: { retained: true } }]) {
    const result = parseRecordBody(record(body))
    assert.deepEqual(result.body, typeof body === 'string' ? JSON.parse(body) : body)
    assert.equal(result.record_parse, undefined)
    if (typeof body === 'object') assert.equal(result.body, body)
  }
  const prose = { kind: 'note', body: '# Saved note\n[not JSON]' }
  assert.deepEqual(parseRecordBody(prose), { body: {} })
  for (const body of ['A prose case with unmatched ]', '# Manual case\n1. Open the client.', '[TLS] 握手失败', '']) {
    assert.deepEqual(parseRecordBody(record(body)), { body: {} }, 'legacy case prose is not a broken JSON record')
  }
})

test('quoted delimiters, escaped quotes, backslashes and Unicode remain literal during recovery', () => {
  const body = { ...caseBody, title: 'Literal ] } [ { and "quotes"', extra: 'C:\\path\\file\n\u4e2d文',
    steps: [{ action: 'Print "}]" and C:\\tmp\\', expected: 'The command rejects input' }] }
  const source = broken(body), result = parseRecordBody(record(source))
  assert.equal(result.record_parse.status, 'recovered')
  assert.deepEqual(result.body, body)
  assert.equal(source[result.record_parse.diagnostics[0].offset], ']')
})

test('the inverse closing mismatch and multiline diagnostics use original character positions', () => {
  const source = JSON.stringify(caseBody, null, 2).replace('\n  ],', '\n  },')
  const offset = source.indexOf('\n  },') + 3
  const result = parseRecordBody(record(source)), [issue] = result.record_parse.diagnostics
  assert.equal(result.record_parse.status, 'recovered')
  assert.deepEqual(result.body, caseBody)
  assert.equal(issue.offset, offset)
  assert.equal(issue.line, source.slice(0, offset).split('\n').length)
  assert.equal(issue.column, 3)
  assert.equal(issue.found, '}')
  assert.equal(issue.expected, ']')
})

test('recovery rejects multiple errors, truncated documents, missing punctuation and non-object roots', () => {
  const candidates = [
    broken(caseBody).replace('"Literal delimiters"', '"Literal delimiters" "missing comma"'),
    broken(caseBody).replace('"case_id":', '"case_id" '),
    broken(caseBody).replace('"not_run"}', '"not_run"]'),
    broken(caseBody).slice(0, -1),
    broken(caseBody) + ' trailing prose',
    '[' + broken(caseBody) + ']',
    '```json\n' + broken(caseBody) + '\n```',
    JSON.stringify(broken(caseBody)),
    null,
  ]
  for (const source of candidates) {
    const result = parseRecordBody(record(source))
    assert.equal(result.record_parse.status, 'invalid', String(source))
    assert.deepEqual(result.body, {})
    assert.ok(result.record_parse.diagnostics.every(issue => issue.severity === 'error' && Number.isInteger(issue.offset) && issue.line >= 1 && issue.column >= 1))
  }
  assert.deepEqual(parseRecordBody({ kind: 'risk', body: broken(caseBody) }), { body: {} }, 'other record kinds never use case recovery')
})

test('the compatibility path requires the full case identity, format and paired step shape', () => {
  for (const update of [
    { format_version: undefined }, { format_version: 'future-case' }, { case_id: '' }, { title: [] },
    { steps: [] }, { steps: [{ action: '', expected: 'The command rejects input' }] },
    { steps: [{ action: 'call', expected: '' }] },
  ]) {
    const body = { ...caseBody, ...update }
    // Use a root mismatch when malformed steps cannot supply the test delimiter.
    const source = JSON.stringify(body).replace(/}$/, ']')
    const result = parseRecordBody(record(source))
    assert.equal(result.record_parse.status, 'invalid')
    assert.equal(result.record_parse.code, 'incomplete_case')
    assert.deepEqual(result.body, {})
  }
})

test('duplicate keys are rejected at any object depth, including Unicode-escaped aliases', () => {
  for (const source of [
    broken(caseBody).replace('"case_id":"TC-1"', '"case_id":"TC-1","case_id":"TC-2"'),
    broken(caseBody).replace('"case_id":"TC-1"', '"case_id":"TC-1","case_\\u0069d":"TC-2"'),
    broken(caseBody).replace('"action":"Run the command"', '"action":"first","action":"second"'),
  ]) {
    const result = parseRecordBody(record(source))
    assert.equal(result.record_parse.status, 'invalid')
    assert.equal(result.record_parse.code, 'duplicate_keys')
    assert.equal(source[result.record_parse.diagnostics[0].offset], '"')
    assert.deepEqual(result.body, {})
  }
  const separate = { ...caseBody, other: { title: 'Independent object' } }
  assert.equal(parseRecordBody(record(broken(separate))).record_parse.status, 'recovered')
})

test('oversized invalid bodies are diagnosed without entering compatibility scanning', () => {
  const source = broken({ ...caseBody, notes: 'x'.repeat(300_000) })
  const result = parseRecordBody(record(source))
  assert.equal(result.record_parse.status, 'invalid')
  assert.equal(result.record_parse.code, 'recovery_limit')
  assert.deepEqual(result.body, {})
})
