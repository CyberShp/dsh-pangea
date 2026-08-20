import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { apply } from '../src/index.js'

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

test('state read does not bind an automatically selected historical run to a new DSH session', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-passive-'))
  const runDirectory = path.join(root, 'pangea-data', 'runs', 'old-run')
  const routes = []
  const sessionId = `new-session-${Date.now()}`
  const agent = {
    id: sessionId,
    session: { header: { id: sessionId, cwd: root, createdAt: Date.now() } },
  }

  try {
    await writeJson(path.join(runDirectory, 'progress.json'), {
      run_id: 'old-run',
      phase: 'WAITING_ANALYSIS',
      analysis_units: [],
      completed_analysis_units: [],
      completed_rework_units: [],
      errors: [],
      error_history: [],
    })

    apply({
      agents: { roots() { return [agent] } },
      on() { return () => {} },
      tools: { register() {} },
      webServer: { register(route) { routes.push(route); return () => {} } },
      effect() {},
    })

    const route = routes.find(item => item.path === '/api/pangea-companion/state')
    let bodyText = ''
    await route.handler({
      method: 'GET',
      url: `/api/pangea-companion/state?cwd=${encodeURIComponent(root)}&session_id=${encodeURIComponent(sessionId)}`,
      headers: { 'sec-fetch-site': 'same-origin' },
    }, {
      writeHead() {},
      end(value) { bodyText = value },
    })

    const body = JSON.parse(bodyText)
    assert.equal(body.current.run_id, 'old-run')
    assert.equal(body.monitor.session.bound_run_id, null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
