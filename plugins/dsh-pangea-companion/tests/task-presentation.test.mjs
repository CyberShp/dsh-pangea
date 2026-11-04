import assert from 'node:assert/strict'
import test from 'node:test'
import { taskDisplayName, taskRequestText } from '../src/task-presentation.js'

const prompt = '为完整源码范围生成业务行为用例，覆盖正常主线、业务与模式分支、异常处理与错误传播、失败后再次操作、清理恢复和必要辅助分支。\n根据冻结源码确定真实入口与预期。'

test('saved NVMe, sessionctl and MQ structures yield stable module names without changing requests', () => {
  const samples = [
    [{ title: prompt, target: prompt, repository: 'spdk-full', source_scope: ['lib/nvme/nvme_auth.c'], scenario: 'module-analysis' },
      { analysis_profile: 'behavior-test-v1' }, 'nvme_auth 行为分析'],
    [{ title: prompt, target: prompt, repository: 'sessionctl-acceptance', source_scope: ['.'], scenario: 'module-analysis' },
      { analysis_profile: 'behavior-test-v1' }, 'sessionctl-acceptance 行为分析'],
    [undefined, { target: prompt, repository: 'semantic-queue', analysis_profile: 'behavior-test-v2',
      source_snapshot: { requested_scope: ['mq.c', 'mq.h'] }, analysis_scene: { id: 'module-analysis', objective: 'interface-contract' } }, 'mq 接口契约分析'],
  ]
  for (const [task, current, expected] of samples) {
    const before = JSON.stringify({ task, current })
    assert.equal(taskDisplayName(task, current), expected)
    assert.equal(taskRequestText(task, current), prompt)
    assert.equal(JSON.stringify({ task, current }), before)
  }
})

test('clear short authored titles take precedence over scope and analysis metadata', () => {
  const current = { title: '当前运行标题', repository: 'other', analysis_profile: 'behavior-test-v2' }
  for (const title of ['TLS 握手分析', 'CPU v2.1 边界回归', '缓存一致性检查', '请求队列分析', '以太网连接分析', '生成器状态分析', 'A'.repeat(40)]) {
    assert.equal(taskDisplayName({ title, source_scope: ['src/check.c'] }, current), title)
  }
  assert.equal(taskDisplayName({ title: prompt }, current), '当前运行标题')
})

test('unknown analysis codes never become prose labels or override known metadata', () => {
  assert.equal(taskDisplayName({ source_scope: ['auth.c'], objective: 'future-objective', scenario: 'future-scenario' }), 'auth')
  assert.equal(taskDisplayName({ source_scope: ['auth.c'], objective: 'constructor', analysis_profile: 'behavior-test-v9', scenario: 'risk-analysis' }), 'auth 行为分析')
  assert.equal(taskDisplayName({ source_scope: ['auth.c'], analysis_profile: 'behavior-test-v2', objective: 'interface-contract', scenario: 'branch-analysis' }), 'auth 接口契约分析')
  assert.equal(taskDisplayName({ source_scope: ['auth.c'], objective: 'product-behavior' }), 'auth 行为分析')
})

test('known objectives and scenarios use explicit analysis labels', () => {
  for (const [scenario, label] of [['module-analysis', '模块分析'], ['coverage-analysis', '覆盖率分析'], ['risk-analysis', '风险分析'], ['branch-analysis', '分支分析']]) {
    assert.equal(taskDisplayName({ repository: 'demo', source_scope: ['**'], scenario }), `demo ${label}`)
  }
  assert.equal(taskDisplayName({ repository: 'demo', source_scope: ['*'], objective: 'branch', scenario: 'module-analysis' }), 'demo 分支分析')
  assert.equal(taskDisplayName(null, { repository: 'demo', source_snapshot: { requested_scope: ['api.c'] }, analysis_settings: { objective: 'interface-contract' } }), 'api 接口契约分析')
})

test('file stems, directory groups and repository-wide ranges work for unrelated names and paths', () => {
  const samples = [
    [['drivers/crypto/aes_encrypt.cc'], 'aes_encrypt'],
    [['./net/stream.cpp', 'net/stream.h', 'net/stream.cpp'], 'stream'],
    [['C:\\work\\protocol\\read.c', 'C:\\work\\protocol\\write.c'], 'protocol'],
    [['src/cache/read.c', 'src/cache/write.c'], 'cache'],
    [['src/cache'], 'cache'],
    [['src/cache/*.c'], 'cache'],
    [['src/stream.c', 'include/stream.h'], 'stream'],
    [['src/a.c', 'lib/b.c'], 'different-repository'],
    [['a.c', 'b.c'], 'different-repository'],
    [['.', 'src/a.c'], 'different-repository'],
    [['**/*'], 'different-repository'],
  ]
  for (const [source_scope, object] of samples) {
    assert.equal(taskDisplayName({ repository: 'different-repository', source_scope, objective: 'interface-contract' }), `${object} 接口契约分析`)
  }
})

test('missing task scope uses the frozen scope and missing metadata keeps a clear target', () => {
  assert.equal(taskDisplayName({ source_scope: [] }, { source_snapshot: { requested_scope: ['transport/packet.rs'] }, scenario: 'risk-analysis' }), 'packet 风险分析')
  assert.equal(taskDisplayName(null, { source_scope: ['mq.c', 'mq.h'], analysis_profile: 'behavior-test-v2', analysis_scene: { objective: 'interface-contract' } }), 'mq 接口契约分析')
  assert.equal(taskDisplayName({ target: 'CPU计时边界分析', repository: 'dperf' }), 'CPU计时边界分析')
  assert.equal(taskDisplayName(null, { target: '请求队列边界' }), '请求队列边界')
  assert.equal(taskDisplayName({ title: prompt, repository: '/home/work/queue.git' }), 'queue')
  assert.equal(taskDisplayName({}, {}), '分析任务')
  assert.equal(taskDisplayName(), '分析任务')
})

test('JSON, instructions, multiple sentences and incomplete titles cannot become display names', () => {
  const candidates = [
    '{"title":"认证"}', '["认证"]', JSON.stringify('{"title":"认证"}'), '%7B%22title%22%3A%22x%22%7D',
    '```json\n{"title":"认证"}\n```', '{"title":', '请分析认证模块', '为认证生成测试用例', '以用户视角验证认证',
    '分析对象：认证', '要求所有路径通过', '根据源码分析认证', 'Generate tests for auth', 'Please verify auth',
    '分析认证。生成用例。', '认证分析\n重连检查', '认证分析；重连检查', '认证分析…', '认证分析...',
    '认证分析：', '认证分析以及', '认证分析与', '为完整 lib/nvme/', '分析', prompt,
  ]
  for (const title of candidates) {
    assert.equal(taskDisplayName({ title, target: title, repository: 'secure-client', source_scope: ['auth.c'], analysis_profile: 'behavior-test-v2' }), 'auth 行为分析', title)
    assert.equal(taskDisplayName({ title, target: title }), '分析任务', title)
  }
})

test('oversized file and repository names use whole shorter identifiers or the neutral fallback', () => {
  const long = 'long_module_name_'.repeat(8)
  assert.equal(taskDisplayName({ source_scope: [`src/auth/${long}.c`], repository: 'repo', scenario: 'branch-analysis' }), 'auth 分支分析')
  assert.equal(taskDisplayName({ source_scope: [`${long}.c`], repository: 'small-repo', scenario: 'module-analysis' }), 'small-repo 模块分析')
  assert.equal(taskDisplayName({ source_scope: [`${long}.c`], repository: long, analysis_profile: 'behavior-test-v2' }), '分析任务')
  assert.equal(taskDisplayName({ repository: long, target: prompt }), '分析任务')
  assert.equal(taskDisplayName({ source_scope: [`${'x'.repeat(38)}.c`], repository: 'repo', objective: 'interface-contract' }), 'repo 接口契约分析')
})

test('request text preserves exact original targets before rejected titles', () => {
  const request = '  原始请求第一段。\n\n第二段包含完整要求。  '
  assert.equal(taskRequestText({ target: request, title: '短标题' }, { target: '其他请求' }), request)
  assert.equal(taskRequestText({ target: '  ', title: prompt }, { target: request }), request)
  assert.equal(taskRequestText({ title: prompt }, { title: '短标题' }), prompt)
  assert.equal(taskRequestText({ title: '短标题' }, { title: prompt }), prompt)
  assert.equal(taskRequestText({ title: '短标题' }), '短标题')
  assert.equal(taskRequestText({ title: '{"request":"原始JSON"}' }), '{"request":"原始JSON"}')
  assert.equal(taskRequestText(), '')
})

test('invalid structured values cannot throw or leak a long request into a name', () => {
  for (const value of [null, false, 42, {}, ['not-a-title']]) {
    const task = { title: value, target: value, source_scope: value, repository: value, objective: value }
    const result = taskDisplayName(task, { analysis_scene: value, source_snapshot: value })
    assert.equal(typeof result, 'string')
    assert.ok(Array.from(result).length <= 40)
    assert.doesNotMatch(result, /…|\.\.\.|\[object Object\]/)
  }
})
