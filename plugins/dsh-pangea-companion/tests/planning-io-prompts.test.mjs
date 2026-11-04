import assert from 'node:assert/strict'
import test from 'node:test'
import { workerContinuationPrompt, workerPrompt } from '../src/source-first-acp.js'

const args = {
  action: { action_id: 'run:planning', role: 'planning', stage: 'unit_planning' },
  cwd: '/workspace', dataRoot: '/data', runId: 'run', taskId: 'planner', python: '/python',
}
const opened = {
  format_version: 'pangea-task-open-v1',
  binding: { run_id: 'run', action_id: 'run:planning', task_id: 'planner' },
  task: { task_type: 'source_first_plan', planning_io_policy: 'planning-io-v1',
    deferred_fields: { test_tool_reference_paths: { input_id: 'task:test_tool_reference_paths' } } },
  write_contract: { revision: 3, capabilities: ['planning-startup-v1', 'read-batch', 'coverage-read', 'plan-write-batch'] },
  planning_startup: {
    pages: [{ input_id: 'unit_planning_rubric', text: 'frozen-rule-page', next_cursor: 'next-frozen-page' }],
    pending_inputs: [{ input_id: 'unit_planning_rubric', cursor: 'next-frozen-page' }],
    complete: false,
  },
}

test('new Planning initial prompt consumes the bounded host task-open exactly once', () => {
  const prompt = workerPrompt({ ...args, opened })
  const line = prompt.split('\n').find(value => value.startsWith('当前 task-open 回包：'))
  assert.deepEqual(JSON.parse(line.slice('当前 task-open 回包：'.length)), opened)
  assert.equal(prompt.split('frozen-rule-page').length - 1, 1)
  assert.match(prompt, /无需重复 task-open/)
  assert.doesNotMatch(prompt, /PowerShell 直接执行 task-open|先调用 task-open|先 result-read 获取 revision/)
  assert.match(prompt, /仅沿 pending_inputs/)
  assert.match(prompt, /next_request_index/)
  assert.match(prompt, /--start-index <next_request_index>/)
  assert.match(prompt, /all_succeeded=false/)
  assert.match(prompt, /--view index/)
  assert.match(prompt, /相同载荷重试使用同一 request-id/)
  assert.match(prompt, /后续新写入与 work-finish 使用 current_revision/)
  assert.match(prompt, /plan-candidates.*仅在具体边界问题需要时/)
  assert.match(prompt, /不等全部规划完成/)
  assert.doesNotMatch(prompt, /本 Run 具有测试工具参考|逐一读取当前任务列出的全部冻结 rubric/)
})

test('legacy and oversized Planning views keep explicit task-open without truncating source', () => {
  const legacy = workerPrompt({ ...args, opened: { task: {} } })
  assert.match(legacy, /PowerShell 直接执行 task-open/)
  assert.doesNotMatch(legacy, /当前 task-open 回包：|plan-write-batch|coverage-read/)
  const large = structuredClone(opened)
  large.planning_startup.pages[0].text = 'unbounded-source'.repeat(4000)
  const fallback = workerPrompt({ ...args, opened: large })
  assert.match(fallback, /PowerShell 直接执行 task-open/)
  assert.doesNotMatch(fallback, /当前 task-open 回包：|unbounded-source/)
})

test('same action continuation restores current revision rather than injecting the initial snapshot', () => {
  const prompt = workerContinuationPrompt({ ...args, opened, sameAction: true })
  assert.match(prompt, /先 result-read 获取当前 revision 和诊断/)
  assert.match(prompt, /PowerShell 直接执行 result-read/)
  assert.doesNotMatch(prompt, /当前 task-open 回包：|frozen-rule-page/)
  assert.match(prompt, /只补缺失或未读分页/)
  assert.doesNotMatch(prompt, /本 Run 具有测试工具参考/)
})

test('Analysis keeps full frozen rubric and tool-reference instructions without Planning batch guidance', () => {
  const prompt = workerPrompt({ ...args, action: { ...args.action, role: 'analysis', stage: 'unit_analysis' }, opened })
  assert.match(prompt, /逐一读取当前任务列出的全部冻结 rubric/)
  assert.match(prompt, /本 Run 具有测试工具参考/)
  assert.match(prompt, /先 result-read --view compact 获取当前 revision/)
  assert.doesNotMatch(prompt, /当前 task-open 回包：|plan-write-batch|coverage-read/)
})
