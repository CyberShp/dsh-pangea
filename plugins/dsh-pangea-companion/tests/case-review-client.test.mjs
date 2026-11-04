import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { filterTestCases } from '../src/case-review-projection.js'
import { sourceFirstProjection } from '../src/source-first-projection.js'

const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...(tree.children || []).flatMap(nodes)] : []
async function fixture(items, { reviews, filters, exportScope } = {}) {
  const current = { run_id: 'run-a', data_root: '/data', workflow_version: 'source-first-v1', terminal: true, lifecycle_status: 'complete', details: { test_cases: items } }
  const task = { task_id: 'task-a', run_id: 'run-a', title: 'TLS', data_root: '/data', status: 'completed' }
  const states = { 0: { current, data_root: '/data' }, 1: { tasks: { items: [task] } }, 4: 'run-a', 5: 'task-a', 16: { type: 'cases' }, ...(filters ? { 84: filters } : {}), ...(reviews ? { 86: { ...reviews, scope: '/workspace\u0000/data\u0000run-a' } } : {}), ...(exportScope ? { 89: exportScope } : {}) }
  let cursor = 0, client, copied = ''
  const react = { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useEffect() {}, useMemo: fn => fn(), useCallback: fn => fn, useRef: value => ({ current: value }), useState(initial) { const key = cursor++; if (!(key in states)) states[key] = initial; return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value }] } }
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), { URLSearchParams, AbortController, console, navigator: { clipboard: { async writeText(value) { copied = value } } }, window: { __ModuleLoader__: { load: spec => { client = spec.factory(name => name === 'react' ? react : {}) } } } })
  const ctx = { pangea: { registerPage() {} }, effect: fn => fn() }
  const render = () => { cursor = 0; return nodes(client.PangeaPanel({ ctx, scope: { cwd: '/workspace' }, visible: true })) }
  return { states, render, copied: () => copied }
}

test('duplicate stable IDs remain separately readable while review and selection stay disabled', async () => {
  const items = [{ test_case_id: 'duplicate', display_id: 'TC-01', title: 'First source case' }, { test_case_id: 'duplicate', display_id: 'TC-01', title: 'Second source case' }]
  const app = await fixture(items, { reviews: { cases: [], counts: {} } })
  const rows = app.render(), links = rows.filter(node => node.type === 'button' && node.children[0] === '查看 ›')
  assert.equal(links.length, 2)
  assert.ok(rows.filter(node => node.type === 'input' && node.props.type === 'checkbox').every(node => node.props.disabled))
  links[0].props.onClick(); assert.ok(app.render().some(node => node.type === 'h2' && node.children.includes('First source case')))
  app.states[16] = { type: 'cases' }; app.render().filter(node => node.type === 'button' && node.children[0] === '查看 ›')[1].props.onClick()
  const detail = app.render(); assert.ok(detail.some(node => node.type === 'h2' && node.children.includes('Second source case')))
  assert.equal(detail.find(node => node.type === 'button' && node.children.includes('采纳此用例')).props.disabled, true)
})
test('unknown execution conditions belong to the unclassified filter and display IDs never identify reviews', () => {
  const items = [{ projection_id: 'unit/a', display_id: 'TC-01', readiness: 'unknown' }, { projection_id: 'unit/b', display_id: 'TC-01', readiness: 'ready' }]
  assert.deepEqual(filterTestCases(items, { readiness: 'unclassified' }), [items[0]])
  assert.deepEqual(filterTestCases(items, { review: 'adopted' }, { 'unit/b': { review_status: 'adopted' } }), [items[1]])
})

test('selected export stays blocked while review scope is unavailable instead of falling back to all', async () => {
  const app = await fixture([{ test_case_id: 'u/a', title: 'Case A' }, { test_case_id: 'u/b', title: 'Case B' }])
  app.render().find(node => node.type === 'input' && node.props['aria-label'] === '选择 u/a').props.onChange()
  app.render().find(node => node.type === 'button' && node.children.includes('导出所选')).props.onClick()
  const nodes = app.render(), confirm = nodes.find(node => node.type === 'button' && node.children.includes('导出 1 条'))
  assert.ok(confirm); assert.equal(confirm.props.disabled, true)
  assert.equal(nodes.find(node => node.type === 'input' && node.props.value === 'selected').props.checked, true)
})

test('real malformed TC-007 restores readable fields and keeps its parsing warning and raw source when copied', async () => {
  const original = JSON.parse(await readFile(new URL('./fixtures/nvme-auth-rec-000011.json', import.meta.url), 'utf8'))
  const before = JSON.stringify(original)
  const projected = sourceFirstProjection([{ stage: 'unit_analysis', status: 'accepted', task: { unit_id: 'unit-0001' }, records: [original] }]).test_cases
  const item = projected[0]
  assert.equal(item.display_id, 'TC-007')
  assert.equal(item.record_parse.status, 'recovered')
  const app = await fixture(projected)
  const list = app.render()
  assert.ok(list.some(node => node.type === 'button' && node.children.includes(item.title)))
  assert.ok(list.some(node => node.type === 'small' && node.children.includes('原文格式异常 · 已恢复读取')))
  assert.ok(!list.some(node => node.type === 'button' && node.children.includes('用例记录（标题待核对）')))
  list.find(node => node.type === 'button' && node.children.includes('查看 ›')).props.onClick()
  const detail = app.render()
  assert.ok(detail.some(node => node.type === 'h2' && node.children.includes(item.title)))
  assert.ok(detail.some(node => node.props['aria-label'] === '原始用例记录格式说明'))
  for (const step of item.step_pairs) {
    assert.ok(detail.some(node => node.type === 'td' && node.children.includes(step.action)))
    assert.ok(detail.some(node => node.type === 'td' && node.children.includes(step.expected)))
  }
  assert.ok(detail.some(node => node.type === 'summary' && node.children.includes('查看本轮原始用例记录')))
  detail.find(node => node.type === 'button' && node.children.includes('复制用例')).props.onClick()
  await Promise.resolve()
  assert.ok(app.copied().startsWith(`TC-007 · ${item.title}`))
  assert.ok(app.copied().includes(original.body))
  assert.match(app.copied(), /记录解析：.*原始记录保持不变/)
  assert.equal(JSON.stringify(original), before)
  assert.equal(item.test_case_id, 'unit-0001/rec-000011')
  assert.equal(item.execution_status, 'not_run')
})

test('unrecoverable structured cases display a parsing failure without inventing steps or a title', async () => {
  const original = { record_id: 'bad', kind: 'test_case', body: '{"title":"Incomplete","steps":[' }
  const projected = sourceFirstProjection([{ stage: 'unit_analysis', status: 'accepted', task: { unit_id: 'u' }, records: [original] }]).test_cases
  const app = await fixture(projected)
  const list = app.render()
  assert.ok(list.some(node => node.type === 'small' && node.children.includes('原始记录无法解析')))
  assert.ok(!list.some(node => node.type === 'button' && node.children.includes('Incomplete')))
  list.find(node => node.type === 'button' && node.children.includes('查看 ›')).props.onClick()
  const detail = app.render()
  assert.ok(detail.some(node => node.props['aria-label'] === '原始用例记录格式说明'))
  assert.deepEqual(projected[0].step_pairs, [])
  assert.equal(projected[0].source_record.body, original.body)
})

test('mixed selection copies each recovered or invalid source with its diagnostics and leaves normal cases unchanged', async () => {
  const recovered = JSON.parse(await readFile(new URL('./fixtures/nvme-auth-rec-000011.json', import.meta.url), 'utf8'))
  const invalid = { record_id: 'invalid', kind: 'test_case', body: '{"case_id":"TC-broken","title":"Incomplete","steps":[\r\n"原始末段 <&>"' }
  const ordinary = { record_id: 'ordinary', kind: 'test_case', body: { case_id: 'TC-008', title: '正常认证用例',
    steps: [{ action: '连接控制器', expected: '建立会话' }], external_observations: ['会话列表'], execution_status: 'not_run' } }
  const excluded = { record_id: 'excluded', kind: 'test_case', body: { case_id: 'TC-009', title: '未选中的用例' } }
  const records = [recovered, invalid, ordinary, excluded]
  const projected = sourceFirstProjection([{ stage: 'unit_analysis', status: 'accepted', task: { unit_id: 'u' }, records }]).test_cases
  const before = JSON.stringify({ records, projected })
  const normal = await fixture([projected[2]])
  normal.render().find(node => node.props['aria-label'] === '选择 TC-008').props.onChange()
  normal.render().find(node => node.type === 'button' && node.children.includes('复制选中用例')).props.onClick()
  await Promise.resolve()
  const app = await fixture(projected)
  for (const item of projected.slice(0, 3)) app.render().find(node => node.props['aria-label'] === `选择 ${item.display_id}`).props.onChange()
  app.render().find(node => node.type === 'button' && node.children.includes('复制选中用例')).props.onClick()
  await Promise.resolve()
  const copied = app.copied()
  assert.ok(copied.startsWith(`TC-007 · ${projected[0].title}\n`))
  assert.equal(copied.includes(excluded.body.title), false, 'unselected records never enter the clipboard')
  assert.equal((copied.match(/记录解析：/g) ?? []).length, 2)
  assert.equal((copied.match(/解析说明：/g) ?? []).length, 2)
  assert.equal((copied.match(/原始用例记录：/g) ?? []).length, 2)
  const starts = projected.slice(0, 3).map(item => copied.indexOf(`${item.display_id} · ${item.title}\n`))
  assert.ok(starts[0] === 0 && starts[0] < starts[1] && starts[1] < starts[2], 'copy preserves the selected case order')
  for (const index of [0, 1]) {
    const part = copied.slice(starts[index], starts[index + 1])
    assert.ok(part.includes(JSON.stringify(projected[index].record_parse, null, 2)), 'the diagnostic remains attached to its own case')
    assert.ok(part.includes(records[index].body), 'the original malformed body keeps quotes, CRLF and its final text')
    assert.equal(part.split(records[index].body).length - 1, 1)
  }
  const recoveredCopy = copied.slice(starts[0], starts[1])
  for (const step of projected[0].step_pairs) assert.ok(recoveredCopy.includes(`${step.action} → ${step.expected}`))
  assert.match(recoveredCopy, /原始记录保持不变/)
  assert.match(copied.slice(starts[1], starts[2]), /无法可靠读取结构化字段/)
  assert.equal(copied.slice(starts[2]), normal.copied(), 'ordinary case copy output is unchanged in a mixed selection')
  assert.doesNotMatch(normal.copied(), /记录解析：|解析说明：|原始用例记录：/)
  assert.equal(projected[0].status, 'not_run')
  assert.equal(projected[2].status, 'not_run')
  assert.equal(JSON.stringify({ records, projected }), before, 'copying does not change source records, projections or execution state')
})
