import test from 'node:test'
import assert from 'node:assert/strict'
import { createDiagramRun } from '../src/diagram-acp.js'
const completed = { stopReason: 'completed' }
for (const mode of ['ok', 'repair', 'limit', 'budget', 'unconfirmed']) test(`diagram ${mode} preserves one worker and bounded execution`, async () => {
  let starts = 0, turns = 0, inspections = 0
  const events = [], signal = new AbortController().signal
  const pending = new Promise(() => {})
  const worker = { id: 'same-worker', result: ['budget', 'unconfirmed'].includes(mode) ? pending : Promise.resolve(completed),
    continuePrompt: async () => { turns++; return completed }, dispose: async () => {},
    cancelTurn: async () => ({ confirmed: false }), readDiagnostics: () => ({}) }
  const run = await createDiagramRun({ signal, subagents: { start: async () => { starts++; return worker } },
    budgetMs: mode === 'budget' ? 25 : 2000, onEvent: e => events.push(e),
    progressPolicy: { warnMs: 5, idleMs: 50, cancelMs: 10, pollMs: 2 },
    inspect: async () => ({ ok: mode === 'ok' || mode === 'repair' && ++inspections === 2, error: 'candidate invalid' }) })
  const result = await run.result
  assert.equal(starts, 1)
  assert.equal(turns, mode === 'repair' ? 1 : mode === 'limit' ? 2 : 0)
  assert.equal(result.stopReason, ['ok', 'repair'].includes(mode) ? 'completed' : 'error')
  if (mode === 'budget') assert.match(result.diagnostic, /执行预算/)
  await run.dispose()
})
