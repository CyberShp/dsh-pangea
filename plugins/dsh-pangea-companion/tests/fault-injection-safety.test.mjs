import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { buildVerificationShellScript, parseVerificationLog } from '../src/fault-injection-candidates.js'
import { checkInjectionResult } from '../src/fault-injection.js'

const bash = process.platform === 'darwin' ? '/bin/bash' : 'bash'
const bashUnavailable = spawnSync(bash, ['--version']).status !== 0 && 'Bash is unavailable; exported shell runtime is not tested'
const shellOptions = { skip: bashUnavailable }

function task() {
  return { generation_contract_version: 2, repositories: [{ repo_id: 'r' }], case_keys: ['case'], result: {
    points: [{ id: 'p', repo_id: 'r', trigger_scope: { current_input: 'request.message', excluded_inputs: ['conversation.history'] } }],
    profiles: [{ case_key: 'case', point_ids: ['p'], safety: {
      setup: ['saved=0', 'cp control snapshot', 'saved=1', 'printf armed > control'],
      negative_steps: ['test "$(cat control)" = armed'], negative_point_ids: ['p'],
      cleanup: ['if [ "${saved:-0}" = 1 ]; then cp snapshot control; fi'],
      cleanup_verify: ['cmp snapshot control'],
    }, steps: ['echo hit:p'] }],
    edits: [{ repo_id: 'r', path: 'app.py', before: 'old', after: 'new' }],
  } }
}
function sandbox(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'pangea-safety-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  writeFileSync(join(cwd, 'control'), Buffer.from([0, 1, 10, 255]))
  return cwd
}
for (const [name, stage, command, status] of [
  ['success', 'steps', 'echo hit:p', 0],
  ['business failure', 'steps', 'exit 37', 37],
  ['negative regression failure', 'negative_steps', 'exit 41', 41],
  ['partial setup failure', 'setup', 'exit 42', 42],
  ['cleanup failure', 'cleanup', 'exit 43', 125],
  ['restore verification failure', 'cleanup_verify', 'exit 44', 125],
]) {
  test(`exported bash preserves status and checks cleanup: ${name}`, shellOptions, t => {
    const cwd = sandbox(t), input = task(), profile = input.result.profiles[0]
    if (stage === 'steps') profile.steps = [command]
    else profile.safety[stage].push(command)
    const script = buildVerificationShellScript(input)
    const result = spawnSync(bash, ['-c', script], { cwd, encoding: 'utf8' })
    assert.equal(result.status, status, result.stdout + result.stderr)
    assert.deepEqual(readFileSync(join(cwd, 'control')), Buffer.from([0, 1, 10, 255]))
    assert.match(result.stdout, new RegExp(`PANGEA_CASE_END.*status=${status}`))
    if (status) assert.doesNotMatch(result.stdout, /PANGEA_CASE_END.*status=0/)
    assert.match(result.stdout, /PANGEA_CLEANUP/)
    if (status) assert.ok(parseVerificationLog(result.stdout, input).entries.every(item => item.result !== 'passed'))
  })
}
test('original failure wins over cleanup failure', shellOptions, t => {
  const cwd = sandbox(t), input = task(), p = input.result.profiles[0]
  p.steps = ['exit 37']; p.safety.cleanup.push('exit 43')
  const r = spawnSync(bash, ['-c', buildVerificationShellScript(input)], { cwd, encoding: 'utf8' })
  assert.equal(r.status, 37); assert.match(r.stdout, /cleanup=43 verify=0/)
})
for (const signalName of ['SIGTERM', 'SIGINT']) test(`${signalName} runs cleanup and remains a failed case`, { skip: process.platform === 'win32' ? 'POSIX process-group signals are not Windows signal validation' : bashUnavailable }, async t => {
  const cwd = sandbox(t), input = task()
  input.result.profiles[0].steps = ['echo ready > ready', 'while :; do sleep 0.1; done']
  const script = join(cwd, 'verify.sh'); writeFileSync(script, buildVerificationShellScript(input))
  const child = spawn(bash, [script], { cwd, detached: true })
  let output = ''; child.stdout.on('data', chunk => output += chunk)
  const done = once(child, 'close')
  t.after(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} })
  for (let n = 0; n < 100 && !existsSync(join(cwd, 'ready')); n++) await new Promise(r => setTimeout(r, 20))
  assert.ok(existsSync(join(cwd, 'ready')))
  process.kill(child.pid, signalName)
  const [status, signal] = await done
  assert.ok(status === (signalName === 'SIGTERM' ? 143 : 130) || (status === null && signal === signalName), output)
  assert.deepEqual(readFileSync(join(cwd, 'control')), Buffer.from([0, 1, 10, 255]))
  assert.match(output, /PANGEA_CASE_END.*status=143/)
})
test('v2 gates missing trigger scope, negative coverage and cleanup before applying edits', () => {
  const good = task(); assert.doesNotThrow(() => checkInjectionResult(good.result, good))
  for (const mutate of [
    v => delete v.points[0].trigger_scope,
    v => v.points[0].trigger_scope.excluded_inputs = [],
    v => v.profiles[0].safety.negative_point_ids = [],
    v => delete v.profiles[0].safety.cleanup,
    v => v.profiles[0].safety.cleanup_verify = ['# prose only'],
  ]) {
    const input = task(); mutate(input.result)
    assert.throws(() => checkInjectionResult(input.result, input), /重新生成/)
  }
})
test('legacy tasks still export without invented cleanup', () => {
  const input = task(); delete input.generation_contract_version; delete input.result.profiles[0].safety
  const script = buildVerificationShellScript(input)
  assert.doesNotMatch(script, /__pangea_finish|PANGEA_CLEANUP/)
  assert.match(script, /PANGEA_CASE_END.*status=0/)
  input.generation_contract_version = 2
  assert.throws(() => buildVerificationShellScript(input), /重新生成/)
})

test('truncated v2 logs and cleanup failure override explicit passed records', () => {
  const input = task()
  for (const tail of ['', '[PANGEA_CLEANUP] case=case cleanup=1 verify=0\n[PANGEA_CASE_END] case=case status=0']) {
    const result = parseVerificationLog('[PANGEA_CASE_BEGIN] case=case points=p\nhit:p\n[PANGEA_VERIFY] case=case result=passed\n' + tail, input)
    assert.equal(result.entries[0].result, 'failed')
  }
})

test('cleanup removes only this run control when initially absent and continues to next profile', shellOptions, t => {
  const cwd = sandbox(t), input = task()
  input.result.profiles[0].safety = {
    setup: ['test ! -e owned', 'printf armed > owned'],
    negative_steps: ['test -e owned'], negative_point_ids: ['p'],
    cleanup: ['rm -f owned'], cleanup_verify: ['test ! -e owned', 'test -f control'],
  }
  input.result.profiles.push({ ...input.result.profiles[0], case_key: 'next' })
  const r = spawnSync(bash, ['-c', buildVerificationShellScript(input)], { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /PANGEA_CASE_END.*case=next status=0/)
  assert.equal(existsSync(join(cwd, 'owned')), false)
  assert.deepEqual(readFileSync(join(cwd, 'control')), Buffer.from([0, 1, 10, 255]))
})

test('raw hit alone cannot bypass v2 cleanup completion', () => {
  assert.equal(parseVerificationLog('hit:p', task()).entries[0].result, 'failed')
})
