import test from 'node:test'
import assert from 'node:assert/strict'
import { createAcpRequestErrors } from '../src/acp-request-errors.js'

const event = (type, extra = {}) => ({ type, agent_session_id: 'a', remote_session_id: 'remote-a', request_id: 'driver-1', ...extra })
const error = { name: 'ContextOverflowError', message: 'input too long' }

test('only a correlated protocol error can fail the active prompt', () => {
  const tracker = createAcpRequestErrors()
  const window = tracker.begin('a', 'remote-a', 'host-1')
  tracker.observe('a', event('session.error', { error }))
  assert.equal(tracker.contextError('a'), null)
  tracker.observe('a', event('prompt'))
  for (const extra of [{ replay: true }, { request_id: 'old' }, { remote_session_id: 'other' }, { agent_session_id: 'b' }, { request_id: null }]) {
    tracker.observe('a', event('session.error', { error, ...extra }))
    assert.equal(tracker.contextError('a'), null)
  }
  tracker.observe('a', event('session_update', { update: { sessionUpdate: 'tool_call_update', rawOutput: error.message } }))
  assert.equal(tracker.contextError('a'), null)
  tracker.observe('a', event('session_update', { update: { type: 'session.error', properties: { error } } }))
  assert.equal(tracker.contextError('a').name, 'ContextOverflowError')
  tracker.observe('a', event('turn_end', { stop_reason: 'completed' }))
  assert.ok(tracker.contextError('a'))
  tracker.end(window)
})

test('parallel workers, reused callbacks and subsequent prompts do not share failures', () => {
  const tracker = createAcpRequestErrors()
  const callback = value => tracker.observe('a', value)
  const first = tracker.begin('a', 'remote-a', 'host-1')
  tracker.begin('b', 'remote-b', 'host-b')
  callback(event('prompt'))
  callback(event('error', { error }))
  assert.ok(tracker.contextError('a'))
  assert.equal(tracker.contextError('b'), null)
  tracker.end(first)
  const second = tracker.begin('a', 'remote-a', 'host-2')
  callback(event('prompt', { request_id: 'driver-2' }))
  callback(event('error', { error })) // late prior request
  tracker.end(first) // late cleanup cannot close the newer window
  assert.equal(tracker.contextError('a'), null)
  callback(event('error', { request_id: 'driver-2', error }))
  assert.ok(tracker.contextError('a'))
  tracker.end(second)
  tracker.begin('a', 'remote-a', 'host-3')
  assert.equal(tracker.contextError('a'), null)
})
