import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const start = Date.parse('2026-09-28T03:00:00Z')
let now = start + 600_000
let client
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: 'fragment', useState: value => [value, () => {}],
  useRef: value => ({ current: value }), useEffect() {},
}
vm.runInNewContext(source, {
  Date: class extends Date { static now() { return now } },
  window: { __ModuleLoader__: { load(spec) { client = spec.factory(name => name === 'react' ? React : {}) } } },
})
function duration(current, task, error) {
  const root = client.RunWorkspace({ current: { workflow: { steps: [] }, ...current }, task, error })
  function find(node) {
    if (!node || typeof node !== 'object') return
    if (node.props?.className === 'stat' && node.children[0]?.children[0] === '运行时长') return node.children[1].children[0]
    for (const child of Array.isArray(node) ? node : node.children ?? []) {
      const result = find(child)
      if (result !== undefined) return result
    }
  }
  return find(root)
}
const task = { run_id: 'r', attempt_id: 'new', launch_started_at: start, attempts: [
  { attempt_id: 'old', ended_at: start + 30_000 },
  { attempt_id: 'new', ended_at: start + 120_000 },
] }

test('completed, failed and stopped Runs retain attempt duration across time and remounts', () => {
  for (const lifecycle_status of ['complete', 'failed', 'stopped', 'cancelled']) {
    const current = { run_id: 'r', lifecycle_status, terminal: true }
    now = start + 600_000
    assert.equal(duration(current, task), '02:00')
    now += 86_400_000
    assert.equal(duration(current, task), '02:00')
  }
  assert.equal(duration({ run_id: 'r', terminal: true, phase: 'COMPLETE' }, task), '02:00')
})

test('Run timestamps take precedence and unrelated task identity cannot supply timings', () => {
  const current = { run_id: 'r', terminal: true, lifecycle_status: 'complete', started_at: start, ended_at: start + 90_000 }
  assert.equal(duration(current, task), '01:30')
  assert.equal(duration({ ...current, ended_at: null }, { ...task, run_id: 'other' }), '未记录')
  assert.equal(duration({ ...current, ended_at: null, data_root: '/a' }, { ...task, data_root: '/b' }), '未记录')
})

test('missing or invalid terminal timestamps never fall back to wall clock', () => {
  for (const ended_at of [undefined, null, '', 'invalid', start - 1]) {
    assert.equal(duration({ run_id: 'r', lifecycle_status: 'complete', started_at: start, ended_at }), '未记录')
  }
})

test('active Runs still advance but stale ended attempts and failed reads do not drive the clock', () => {
  const current = { run_id: 'r', lifecycle_status: 'running', started_at: start }
  now = start + 180_000
  assert.equal(duration(current, task), '03:00')
  now += 60_000
  assert.equal(duration(current, task), '04:00')
  assert.equal(duration(current, { ...task, attempts: [] }, 'offline'), '未记录')
})
