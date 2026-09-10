import assert from 'node:assert/strict'
import test from 'node:test'
import { parseTestCases } from '../src/reader.js'

test('heading-based case steps retain inline field words and subsequent branches', () => {
  const markdown = `## TC-02 条件检查
### 用例定位
- **测试类型**：异常路径
- **优先级**：P1
### 前置条件
创建独立会话
### 操作步骤
**分支 A**：
1. 建立连接
2. 验证返回 BUSY
**分支 B**：
1. 调用入口 前置：连接标记为零
2. 设置无效参数 预期：返回 INVALID
**分支 C**：
1. 创建独立会话并保持未认证
2. 调用入口并检查 AUTH_REQUIRED
### 预期结果和 Oracle
- 返回与对应分支一致
### 观测方式
读取返回值
### 清理和复原
释放会话
`;
  const [item] = parseTestCases(markdown)
  assert.equal(item.steps.length, 9)
  assert.match(item.steps.at(-1), /AUTH_REQUIRED/)
  assert.ok(item.steps.some(step => step.includes('预期：返回 INVALID')))
  assert.deepEqual(item.preconditions, ['创建独立会话'])
  assert.equal(item.case_type, '异常路径')
  assert.equal(item.priority, 'P1')
})

test('compact inline cases retain their existing field boundaries', () => {
  const [item] = parseTestCases('### TC-01 简洁用例\n- 前置：未连接。 步骤：连接。 预期：成功。 观测：状态。 清理：断开。')
  assert.deepEqual(item.steps, ['连接。'])
  assert.deepEqual(item.expected_results, ['成功。'])
})

test('the observed Oracle heading preserves its explicit expected results', () => {
  const [item] = parseTestCases('## TC-01 拒绝\n### 预期结果 Oracle\n- 返回 BUSY\n### 观测方式\n- 读取返回值')
  assert.deepEqual(item.expected_results, ['返回 BUSY'])
})
