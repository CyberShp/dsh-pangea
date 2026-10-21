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
