import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { filterTestCases } from '../src/case-review-projection.js'

const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...(tree.children || []).flatMap(nodes)] : []
async function fixture(items, { reviews, filters, exportScope } = {}) {
  const current = { run_id: 'run-a', data_root: '/data', workflow_version: 'source-first-v1', terminal: true, lifecycle_status: 'complete', details: { test_cases: items } }
  const task = { task_id: 'task-a', run_id: 'run-a', title: 'TLS', data_root: '/data', status: 'completed' }
  const states = { 0: { current, data_root: '/data' }, 1: { tasks: { items: [task] } }, 4: 'run-a', 5: 'task-a', 16: { type: 'cases' }, ...(filters ? { 84: filters } : {}), ...(reviews ? { 86: { ...reviews, scope: '/workspace\u0000/data\u0000run-a' } } : {}), ...(exportScope ? { 89: exportScope } : {}) }
  let cursor = 0, client
  const react = { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useEffect() {}, useMemo: fn => fn(), useCallback: fn => fn, useRef: value => ({ current: value }), useState(initial) { const key = cursor++; if (!(key in states)) states[key] = initial; return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value }] } }
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), { URLSearchParams, AbortController, console, window: { __ModuleLoader__: { load: spec => { client = spec.factory(name => name === 'react' ? react : {}) } } } })
  const ctx = { pangea: { registerPage() {} }, effect: fn => fn() }
  const render = () => { cursor = 0; return nodes(client.PangeaPanel({ ctx, scope: { cwd: '/workspace' }, visible: true })) }
  return { states, render }
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
