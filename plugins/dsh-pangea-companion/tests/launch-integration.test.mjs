import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8')

test('task launch diagnostics are wired through direct Skill startup', () => {
  assert.match(source, /createLaunchLogStore/)
  assert.match(source, /LAUNCH_LOG_API_PATH/)
  assert.match(source, /stage: 'launch_requested'/)
  assert.match(source, /launchAnalysisSession/)
  assert.match(source, /stage: 'session_launch_complete'/)
  assert.match(source, /stage: 'launch_timeout'/)
  assert.match(source, /launchLogRouteHandler/)
})
