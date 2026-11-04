import assert from 'node:assert/strict'
import test from 'node:test'
import { caseTitlePresentation, caseRecordParseNotice } from '../src/case-review-projection.js'

test('ordinary titles retain authored text and identity exactly', () => {
  for (const title of ['TLS 握手失败后可以重试', '  保留原始空格\n与换行  ', '[TLS] 无效令牌被拒绝', '2026']) {
    const item = Object.freeze({ title, test_case_id: 'real-id', case_id: 'other-id' })
    assert.deepEqual(caseTitlePresentation(item), { title, issue: '', original: title })
    assert.equal(item.test_case_id, 'real-id')
    assert.equal(item.case_id, 'other-id')
  }
})

test('complete records expose only their own explicit nonempty title', () => {
  const record = Object.freeze({ title: '  原始标题  ', case_id: 'embedded-id', summary: '不作为标题' })
  for (const original of [record, JSON.stringify(record), '```json\n' + JSON.stringify(record) + '\n```']) {
    const item = Object.freeze({ title: original, test_case_id: 'real-id' })
    assert.deepEqual(caseTitlePresentation(item), { title: record.title, issue: '', original })
    assert.equal(caseTitlePresentation(item).original, original)
    assert.equal(item.test_case_id, 'real-id')
  }
})

test('missing, invalid or inferred titles remain an explicit unresolved record', () => {
  const inherited = Object.create({ title: '继承的标题' })
  const originals = [undefined, null, '', ' \n ', 7, false, [], inherited,
    { summary: '不得推断标题', case_id: 'TC-007' }, { title: '  ' }, { title: 7 }, { title: { title: '不得递归推断' } },
    '{}', '{"summary":"不得推断标题"}', '{"title":null}', '{"title":[]}', '[{"title":"不得选取数组记录"}]']
  for (const original of originals) {
    const item = Object.freeze({ title: original, test_case_id: 'real-id' })
    assert.deepEqual(caseTitlePresentation(item), { title: '用例记录（标题待核对）', issue: '标题格式需核对', original })
    assert.equal(item.test_case_id, 'real-id')
  }
})

test('a truncated display field alone cannot recover a case without its source record', () => {
  const original = '{"format_version": "behavior-test-case-v1", "case_id": "TC-007", "title": "Authentication failure when controller\'s chal'
  const item = Object.freeze({ title: original, test_case_id: 'unit-0001/rec-000011', projection_id: 'unit-0001/rec-000011' })
  const before = JSON.stringify(item)
  assert.deepEqual(caseTitlePresentation(item), { title: '用例记录（标题待核对）', issue: '标题格式需核对', original })
  assert.equal(JSON.stringify(item), before)
  assert.doesNotMatch(caseTitlePresentation(item).title, /Authentication|TC-007/)
})

test('record parsing notices distinguish recovered content from unreadable source data', () => {
  assert.equal(caseRecordParseNotice({ title: '正常用例' }), null)
  assert.equal(caseRecordParseNotice({ record_parse: { status: 'unknown' } }), null)
  assert.match(caseRecordParseNotice({ record_parse: { status: 'recovered' } }).summary, /已恢复读取/)
  assert.match(caseRecordParseNotice({ record_parse: { status: 'recovered' } }).detail, /原始记录保持不变/)
  assert.match(caseRecordParseNotice({ record_parse: { status: 'invalid' } }).detail, /无法可靠读取/)
})
