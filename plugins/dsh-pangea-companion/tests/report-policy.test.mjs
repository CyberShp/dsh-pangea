import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import {
  apply,
  isPangeaWorkspace,
  reportDeliveryForWorkspace,
} from '../src/report-policy.js'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pangea-companion-policy-'))
  const markerDir = join(root, '.agents', 'pangea')
  const nested = join(root, 'pangea-data', 'repositories', 'demo')
  mkdirSync(markerDir, { recursive: true })
  mkdirSync(nested, { recursive: true })
  writeFileSync(join(markerDir, 'dsh.md'), 'PANGEA DSH adapter\n')
  return { root, nested }
}

test('uses quiet delivery only inside a PANGEA workspace', () => {
  const { root, nested } = fixture()
  const unrelated = mkdtempSync(join(tmpdir(), 'dsh-unrelated-'))
  try {
    assert.equal(isPangeaWorkspace(root), true)
    assert.equal(isPangeaWorkspace(nested), true)
    assert.equal(reportDeliveryForWorkspace(nested), 'quiet')
    assert.equal(reportDeliveryForWorkspace(unrelated), 'next-step')
    assert.equal(reportDeliveryForWorkspace(undefined), 'next-step')
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(unrelated, { recursive: true, force: true })
  }
})

test('report tool resolves delivery from the reporting agent workspace', async () => {
  const { root } = fixture()
  const unrelated = mkdtempSync(join(tmpdir(), 'dsh-unrelated-'))
  const deliveries = []
  let setup
  let reportTool
  const ctx = {
    subagents: {
      registerContinuableSetup(value) { setup = value },
      async reportFrom(_agent, _content, options) {
        deliveries.push(options.delivery)
        return `message-${deliveries.length}`
      },
    },
  }
  const childCtx = {
    systemPrompt: { section() { return () => {} } },
    tools: {
      register(value) {
        reportTool = value
        return () => {}
      },
    },
  }
  try {
    apply(ctx)
    setup(childCtx)
    const signal = new AbortController().signal
    await reportTool.execute({ output: 'pangea result' }, {
      agent: { session: { header: { cwd: root } } },
      signal,
    })
    await reportTool.execute({ output: 'ordinary result' }, {
      agent: { session: { header: { cwd: unrelated } } },
      signal,
    })
    assert.deepEqual(deliveries, ['quiet', 'next-step'])
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(unrelated, { recursive: true, force: true })
  }
})
