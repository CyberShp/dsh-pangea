import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function client() {
  let exported
  const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useRef: value => ({ current: value }), useEffect() {} }
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    URLSearchParams,
    window: { __ModuleLoader__: { load: spec => { exported = spec.factory(() => React) } } },
  })
  return exported
}
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value?.children ? [value, ...value.children.flatMap(nodes)] : []
const text = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(text).join('') : value?.children ? text(value.children) : ''

test('task stop remains available before Run creation and for unresolved execution, but not confirmed terminal tasks', async () => {
  const { taskCanStop } = await client()
  for (const status of ['preparing', 'starting', 'running', 'stopping', 'needs_attention', 'failed']) assert.equal(taskCanStop({ status }), true, status)
  for (const status of ['completed', 'stopped']) assert.equal(taskCanStop({ status }), false, status)
  assert.equal(taskCanStop({ status: 'completed', execution_status: 'stopping' }), true)
})

test('stopping lifecycle response remains structured while preserving exact task and attempt binding', async () => {
  const { requestWorkbenchAction } = await client()
  const payload = { task_id: 'task-a', attempt_id: 'attempt-a', run_id: 'run-a', data_root: 'C:\\分析\\data' }
  for (const action of ['stop', 'task-delete']) {
    const result = await requestWorkbenchAction({ cwd: 'C:\\分析', action, payload, fetcher: async (url, init) => {
      assert.equal(new URL(url, 'https://fixture').searchParams.get('cwd'), 'C:\\分析')
      assert.deepEqual(JSON.parse(init.body), { action, ...payload })
      return { ok: true, status: 202, json: async () => ({ status: 'stopping', deleted: false, stop_confirmed: false, task: { task_id: 'task-a' } }) }
    } })
    assert.equal(result.deleted, false)
    assert.equal(result.stop_confirmed, false)
    assert.equal(result.task.task_id, 'task-a')
  }
  await assert.rejects(requestWorkbenchAction({ cwd: '/fixture', action: 'task-start', fetcher: async () => ({ ok: true, status: 200, json: async () => ({ status: 'stopping', error: 'not a valid start' }) }) }), /not a valid start/)
  await assert.rejects(requestWorkbenchAction({ cwd: '/fixture', action: 'task-delete', fetcher: async () => ({ ok: false, status: 409, json: async () => ({ status: 'error', error: 'attempt changed' }) }) }), /attempt changed/)
})

test('delete confirmation explains retained data and unresolved stops, preserves retry, and blocks duplicate submission', async () => {
  const { TaskLifecycleDialog } = await client()
  let submits = 0
  const state = { action: 'task-delete', task: { task_id: 'task-a', title: 'A 任务', status: 'running' }, busy: false, error: '工具仍在运行' }
  const rendered = TaskLifecycleDialog({ state, onClose() {}, onConfirm() { submits++ } })
  assert.match(text(rendered), /仅从分析任务列表移除；Run、报告、会话和日志仍保留/)
  assert.match(text(rendered), /确认结束后才移除/)
  assert.equal(nodes(rendered).find(item => item.props.role === 'alert').children[0], '工具仍在运行')
  nodes(rendered).find(item => item.type === 'button' && text(item) === '重试删除').props.onClick()
  assert.equal(submits, 1)
  const pending = TaskLifecycleDialog({ state: { ...state, busy: true }, onClose() {}, onConfirm() {} })
  assert.ok(nodes(pending).filter(item => item.type === 'button').every(item => item.props.disabled))
  assert.match(text(pending), /正在停止并删除/)
})
