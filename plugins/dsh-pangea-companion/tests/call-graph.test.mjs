import assert from 'node:assert/strict'
import test from 'node:test'
import { validateCallGraph, callsForVariable, CALL_GRAPH_FORMAT } from '../src/call-graph.js'
import { CALL_GRAPH_EXAMPLE } from './fixtures/call-graph.mjs'

const fn = id => ({ id, kind: 'function', label: id, signature: '', file: 'a.c', line: 1 })

test('example graph validates as ok and a graph without functions is invalid', () => {
  const result = validateCallGraph(JSON.stringify(CALL_GRAPH_EXAMPLE))
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.errors, [])
  assert.equal(result.graph.functions.length, 4)
  const empty = validateCallGraph({ format_version: CALL_GRAPH_FORMAT, title: 't', root: '', functions: [] })
  assert.equal(empty.status, 'invalid')
  assert.ok(empty.errors.includes('functions 中没有有效函数'))
  assert.match(validateCallGraph('{oops').errors[0], /^不是有效 JSON：/)
})

test('dangling calls, duplicate ids and bad root are partial with itemized errors', () => {
  const result = validateCallGraph({ format_version: CALL_GRAPH_FORMAT, root: 'nope', functions: [fn('a'), fn('b'), fn('a')],
    calls: [{ from: 'a', to: 'b' }, { from: 'x', to: 'b' }], variables: [{ function: 'ghost', name: 'v' }] })
  assert.equal(result.status, 'partial')
  assert.deepEqual(result.errors, [
    "functions[2].id='a' 重复",
    "calls[1].from='x' 不在 functions 中",
    "variables[0].function='ghost' 不在 functions 中",
    "root='nope' 不在 functions 中，改用 a",
  ])
  assert.equal(result.graph.root, 'a')
  assert.deepEqual(result.graph.calls.map(c => [c.from, c.to]), [['a', 'b']])

})

test('callsForVariable finds calls mentioning the variable by whole word', () => {
  const graph = validateCallGraph(CALL_GRAPH_EXAMPLE).graph
  const variable = graph.variables[0]
  assert.deepEqual([...callsForVariable(graph, 'login_handler', variable)], [0])
  assert.deepEqual([...callsForVariable(graph, 'login_handler', { name: 'use' })], [])
  assert.deepEqual([...callsForVariable(graph, 'login_handler', null)], [])
})

test('string argument mappings stay readable and unsupported evidence types make the graph partial', () => {
  const candidate = structuredClone(CALL_GRAPH_EXAMPLE)
  candidate.calls[0].args = 'req->user → user'
  let result = validateCallGraph(candidate)
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.graph.calls[0].args, ['req->user → user'])
  assert.deepEqual([...callsForVariable(result.graph, 'login_handler', { name: 'user' })], [0])
  candidate.functions[0].file = 123
  candidate.title = 123
  candidate.functions[0].line = '20'
  candidate.calls[0].line = -1
  candidate.calls[0].args = { mapping: 'user' }
  candidate.variables[0].reads = ['user', 7]
  const original = structuredClone(candidate)
  result = validateCallGraph(candidate)
  assert.equal(result.status, 'partial')
  for (const field of ['title', 'functions[0].file', 'functions[0].line', 'calls[0].line', 'calls[0].args', 'variables[0].reads[1]']) {
    assert.ok(result.errors.some(error => error.includes(field)), field)
  }
  assert.deepEqual(result.graph.variables[0].reads, ['user'])
  assert.deepEqual(candidate, original)
})

test('variable highlighting follows declared writes into arguments without matching a longer field name', () => {
  const graph = validateCallGraph({ format_version: CALL_GRAPH_FORMAT, root: 'a', functions: [fn('a'), fn('b'), fn('c')],
    calls: [
      { from: 'a', to: 'b', args: 'ctx->size → size' },
      { from: 'a', to: 'b', args: 'ctx->size_limit → limit' },
      { from: 'b', to: 'c', args: 'ctx->size → size' },
      { from: 'b', to: 'a', returns: 'ctx->size' },
    ] }).graph
  assert.deepEqual([...callsForVariable(graph, 'a', { name: 'temp', writes: 'ctx->size' })], [0, 3])
})

test('explicit alternate fields stay drawable with compatibility warnings and unchanged source', () => {
  const candidate = { format_version: CALL_GRAPH_FORMAT, status: 'partial', root: 'recv',
    functions: [
      { id: 'recv', type: 'function', name: '接收请求' },
      { id: 'handle', type: 'external', name: '处理请求' },
    ],
    calls: [
      { caller: 'recv', callee: 'handle', args: ['req → request'], returns: 'rc' },
      { source: 'handle', target: 'recv' },
    ],
    variables: [{ function_id: 'recv', name: 'rc', reads: ['req'], compute: 'handle(req)', writes: 'rc' }],
    notes: '外部实现尚未核对',
  }
  const original = structuredClone(candidate)
  const result = validateCallGraph(candidate)
  assert.equal(result.status, 'partial')
  assert.deepEqual(result.graph.functions.map(row => [row.kind, row.label]), [['function', '接收请求'], ['external', '处理请求']])
  assert.deepEqual(result.graph.calls.map(row => [row.from, row.to]), [['recv', 'handle'], ['handle', 'recv']])
  assert.equal(result.graph.variables[0].function, 'recv')
  assert.deepEqual(result.graph.notes, ['外部实现尚未核对'])
  for (const field of ['functions[0].kind', 'functions[0].label', 'calls[0].from', 'calls[0].to', 'calls[1].from', 'calls[1].to', 'variables[0].function', 'notes']) {
    assert.ok(result.errors.some(error => error.includes(field) && error.includes('原记录保留')), field)
  }
  assert.deepEqual(candidate, original)
})

test('missing and conflicting references cannot become invented calls or variable ownership', () => {
  const result = validateCallGraph({ format_version: CALL_GRAPH_FORMAT, root: 'a',
    functions: [{ ...fn('a'), label: 'same' }, { ...fn('b'), label: 'same' }],
    calls: [
      {},
      { caller: 'same', callee: 'b' },
      { from: 'a', caller: 'b', to: 'b' },
      { caller: 'a', source: 'b', callee: 'b' },
      { caller: { id: 'a' }, callee: 'b' },
      { from: 'a', caller: 'a', to: 'b', callee: 'b' },
    ],
    variables: [
      { name: 'missing' },
      { function: 'a', function_id: 'b', name: 'conflict' },
      { function_id: 'same', name: 'ambiguous-label' },
      { function_id: 'a', name: 'valid' },
    ],
  })
  assert.equal(result.status, 'partial')
  assert.deepEqual(result.graph.calls.map(row => [row.from, row.to]), [['a', 'b'], ['a', 'b']])
  assert.deepEqual(result.graph.variables.map(row => [row.function, row.name]), [['a', 'conflict'], ['a', 'valid']])
  for (const field of ['calls[2].from', 'calls[3].from', 'variables[1].function']) {
    assert.ok(result.errors.some(error => error.includes(field) && error.includes('冲突')), field)
  }
  assert.ok(result.errors.includes("calls[0].from='' 不在 functions 中"))
  assert.ok(result.errors.includes("calls[1].from='same' 不在 functions 中"))
  assert.ok(result.errors.includes('calls[4].caller 必须是字符串'))
})

test('missing function kind remains explicitly partial and malformed notes remain diagnostic', () => {
  const result = validateCallGraph({ format_version: CALL_GRAPH_FORMAT, root: 'a',
    functions: [{ id: 'a' }], notes: { reason: 'unknown' } })
  assert.equal(result.status, 'partial')
  assert.match(result.errors.join('\n'), /kind='' 不是 function\|macro\|external/)
  assert.ok(result.errors.includes('notes 必须是字符串数组'))
  assert.deepEqual(result.graph.notes, [])
})
