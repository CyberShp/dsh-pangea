import test from 'node:test'
import assert from 'node:assert/strict'
import { createAnalysisReview, supportsHostReview } from '../src/analysis-review.js'

test('five-stage review does not take over nine-stage scenarios or speed mode', () => {
  for (const scenario of ['module-analysis', 'coverage-analysis']) assert.equal(supportsHostReview({ scenario, mode: 'depth' }), true)
  for (const scenario of ['issue-regression', 'root-cause', 'special-risk', 'custom']) assert.equal(supportsHostReview({ scenario, mode: 'depth' }), false)
  assert.equal(supportsHostReview({ scenario: 'coverage-analysis', mode: 'speed' }), false)
})

const binding = { task_id: 'task-1', run_id: 'run-1', data_root: '/data', run_root: '/data/runs/run-1', request_path: '/request.md', attempt_id: 'attempt-1' }
const complete = { completed_steps: ['01', '02', '03', '04', '05'], lifecycle_status: 'complete', report_available: true }
const draft = { completed_steps: ['01', '02', '03'] }

function fixture(actions) {
  const records = [], prompts = []
  let decision, starts = 0, disposed = 0
  function answer(prompt) {
    prompts.push(prompt)
    const id = /review_request_id: ([\w-]+)/.exec(prompt)[1]
    decision = { review_request_id: id, run_id: binding.run_id, review_action: actions.shift(), semantic_verdict: 'UNRESOLVED', summary: 'source evidence pending' }
    return { stopReason: 'completed', output: [] }
  }
  const review = createAnalysisReview({ binding,
    async startReviewer(prompt) { starts++; return { id: 'reviewer-real', remoteSessionId: 'remote-reviewer', result: Promise.resolve(answer(prompt)), continuePrompt: async p => answer(p[0].text), dispose: async () => { disposed++ } } },
    record: async value => records.push(value), readDecision: async () => decision,
  })
  return { review, records, prompts, starts: () => starts, disposed: () => disposed, setDecision: value => { decision = value } }
}

test('dispatches one real reviewer, returns targeted repair to producer and reuses reviewer through formal delivery', async () => {
  const f = fixture(['revise', 'accept', 'accept'])
  const producer = { id: 'producer-real' }, signal = new AbortController().signal
  assert.equal(await f.review.afterProducerTurn(producer, { completed_steps: ['01'] }, signal), null)
  assert.match((await f.review.afterProducerTurn(producer, draft, signal)).prompt, /定向修订/)
  assert.match((await f.review.afterProducerTurn(producer, draft, signal)).prompt, /正式交付/)
  assert.equal((await f.review.afterProducerTurn(producer, complete, signal)).complete, true)
  assert.equal(f.starts(), 1)
  assert.equal(f.records.at(-1).reviewer_session_id, 'reviewer-real')
  assert.equal(f.records.at(-1).producer_session_id, 'producer-real')
  assert.equal(f.records.at(-1).verdict, 'UNRESOLVED')
  await f.review.dispose()
  assert.equal(f.disposed(), 1)
})

test('rejects another producer instead of silently repairing with a replacement', async () => {
  const f = fixture(['revise'])
  await f.review.afterProducerTurn({ id: 'producer-real' }, draft, new AbortController().signal)
  await assert.rejects(f.review.afterProducerTurn({ id: 'replacement' }, draft, new AbortController().signal), /Producer/)
})

test('does not accept a forged or stale decision without the current reviewer request binding', async () => {
  // The reader observes an unrelated prior Run declaration, not this reviewer response.
  const review = createAnalysisReview({ binding, startReviewer: async () => ({ id: 'real', result: Promise.resolve({ stopReason: 'completed' }) }), record: async () => {}, readDecision: async () => ({ run_id: 'other', review_request_id: 'fake', review_action: 'accept', semantic_verdict: 'PASS' }) })
  await assert.rejects(review.afterProducerTurn({ id: 'producer' }, complete, new AbortController().signal), /绑定/)
})

test('cancellation cannot be reported as verified completion', async () => {
  const f = fixture(['accept']), controller = new AbortController()
  controller.abort()
  await assert.rejects(f.review.afterProducerTurn({ id: 'producer' }, complete, controller.signal), /取消/)
  assert.equal(f.starts(), 0)
})

for (const cancelAt of ['read', 'record']) test(`cancellation during ${cancelAt} cannot leave verified completion`, async () => {
  const controller = new AbortController(), records = []
  let requestId
  const review = createAnalysisReview({ binding,
    startReviewer: async prompt => { requestId = /review_request_id: ([\w-]+)/.exec(prompt)[1]; return { id: 'reviewer', result: Promise.resolve({ stopReason: 'completed' }) } },
    readDecision: async () => { if (cancelAt === 'read') controller.abort(); return { run_id: binding.run_id, review_request_id: requestId, review_action: 'accept', semantic_verdict: 'PASS' } },
    record: async value => { records.push(value); if (cancelAt === 'record' && value.status === 'complete') controller.abort() },
  })
  await assert.rejects(review.afterProducerTurn({ id: 'producer' }, complete, controller.signal), /取消/)
  assert.notEqual(records.at(-1).status, 'complete')
})

test('returns a malformed decision to the same reviewer to repair the same file', async () => {
  let requestId, repaired = 0
  const review = createAnalysisReview({ binding,
    startReviewer: async prompt => { requestId = /review_request_id: ([\w-]+)/.exec(prompt)[1]; return { id: 'reviewer',
      result: Promise.resolve({ stopReason: 'completed' }), async continuePrompt(p) { repaired++; assert.match(p[0].text, /独立审查状态.json/); assert.match(p[0].text, /绑定/); return { stopReason: 'completed' } } } },
    readDecision: async () => ({ run_id: binding.run_id, review_request_id: repaired ? requestId : 'stale', review_action: 'accept', semantic_verdict: 'PASS' }), record: async () => {},
  })
  assert.equal((await review.afterProducerTurn({ id: 'producer' }, complete, new AbortController().signal)).complete, true)
  assert.equal(repaired, 1)
})

test('a reviewer repairs its invented declared identity against the actual host session', async () => {
  let requestId, repaired = false
  const review = createAnalysisReview({ binding,
    startReviewer: async prompt => { requestId = /review_request_id: ([\w-]+)/.exec(prompt)[1]; return { id: 'real-reviewer', result: Promise.resolve({ stopReason: 'completed' }),
      async continuePrompt(p) { assert.match(p[0].text, /real-reviewer/); repaired = true; return { stopReason: 'completed' } } } },
    readDecision: async () => ({ run_id: binding.run_id, review_request_id: requestId, reviewer_session_id: repaired ? 'real-reviewer' : 'invented', review_action: 'accept', semantic_verdict: 'PASS' }), record: async () => {},
  })
  assert.equal((await review.afterProducerTurn({ id: 'producer' }, complete, new AbortController().signal)).complete, true)
  assert.equal(repaired, true)
})

test('executes reviewer probes before decision, retains failures as evidence, and reuses both sessions', async () => {
  const order = [], records = []
  let requestId, decision, turns = 0
  const reviewer = { id: 'reviewer-real',
    async continuePrompt(content) {
      turns++
      order.push('review-evidence')
      assert.match(content[0].text, /receipt\.json/)
      decision = { run_id: binding.run_id, review_request_id: requestId, review_action: 'accept', semantic_verdict: 'UNRESOLVED', summary: 'some cases require revision' }
      return { stopReason: 'completed' }
    },
  }
  const review = createAnalysisReview({ binding,
    async startReviewer(prompt) {
      order.push('prepare-probes')
      requestId = /review_request_id: ([\w-]+)/.exec(prompt)[1]
      assert.match(prompt, /执行校验计划/)
      return { ...reviewer, result: Promise.resolve({ stopReason: 'completed' }) }
    },
    async verifyCases({ reviewRequestId, formal }) {
      order.push('execute')
      assert.equal(reviewRequestId, requestId)
      assert.equal(formal, true)
      return { status: 'recorded', receipt_path: '/receipt.json', cases: [{case_id:'TC-1',status:'executed',exit_code:1},{case_id:'TC-2',status:'timed_out'}] }
    },
    record: async value => records.push(value), readDecision: async () => decision,
  })
  const result = await review.afterProducerTurn({ id: 'producer-real' }, complete, new AbortController().signal)
  assert.equal(result.complete, true)
  assert.deepEqual(order, ['prepare-probes', 'execute', 'review-evidence'])
  assert.equal(turns, 1)
  assert.equal(records.at(-1).verdict, 'UNRESOLVED')
  assert.equal(records.at(-1).execution_verification.cases[0].exit_code, 1)
})

test('reviewer repairs its own probe and requests re-execution without a Producer turn', async () => {
  let requestId, executions=0, starts=0, decision
  const reply=async prompt=>{
    if(prompt.includes('本轮先准备执行证据')) requestId=/review_request_id: ([\w-]+)/.exec(prompt)[1]
    else decision={run_id:binding.run_id,review_request_id:requestId,review_action:executions===1?'verify':'accept',semantic_verdict:'PASS'}
    return {stopReason:'completed'}
  }
  const review=createAnalysisReview({binding,record:async()=>{},readDecision:async()=>decision,
    startReviewer:async prompt=>{starts++;return {id:'reviewer',result:reply(prompt),continuePrompt:p=>reply(p[0].text)}},
    verifyCases:async()=>{executions++;return {status:'recorded',receipt_path:`receipt-${executions}.json`,cases:[]}},
  })
  assert.equal((await review.afterProducerTurn({id:'producer'},complete,new AbortController().signal)).complete,true)
  assert.equal(starts,1)
  assert.equal(executions,2)
})
