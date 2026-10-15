import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createRuntimeMonitor, runIdentityKey } from '../src/monitor.js'

const execFileAsync = promisify(execFile)

function captureLogger() {
  const entries = []
  return { entries, warn: message => entries.push(['warn', message]), info: message => entries.push(['info', message]) }
}

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function contextWith(...agents) {
  return {
    agents: { roots: () => agents },
    on() { return () => {} },
  }
}

function agent(id, cwd, createdAt) {
  return { id, session: { header: { cwd, createdAt } } }
}

test('binds execution by data root, Run, Task, and attempt without allowing a session rewrite', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-monitor-identity-'))
  let now = 1000
  try {
    const monitor = createRuntimeMonitor({ storePath: path.join(root, 'monitor-v1.json'), now: () => ++now })
    const session05 = agent('session-05', '/workspace', 500)
    const session06 = agent('session-06', '/workspace', 600)
    const dispose = monitor.start(contextWith(session05, session06))
    await monitor.bindExecution('session-06', {
      run_id: 'run-06', phase: 'STEP_BOOTSTRAP', analysis: { completed: 0, total: 9 },
    }, {
      dataRoot: '/workspace/pangea-data', taskId: 'task-06', attemptId: 'attempt-06',
    })

    await assert.rejects(() => monitor.bindExecution('session-05', {
      run_id: 'run-06', phase: 'FAILED', analysis: { completed: 0, total: 9 },
    }, {
      dataRoot: '/workspace/pangea-data', taskId: 'task-06', attemptId: 'attempt-06',
    }), /already bound to another session/)

    const snapshot = await monitor.snapshot({ dataRoot: '/workspace/pangea-data', runId: 'run-06' })
    assert.equal(snapshot.run.session_id, 'session-06')
    assert.equal(snapshot.run.session_created_at, 600)
    assert.equal(snapshot.run.task_id, 'task-06')
    assert.equal(snapshot.run.attempt_id, 'attempt-06')
    await dispose()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('refreshes explicit Run observations for step, ACK, and state timestamps while isolating data roots', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-monitor-observe-'))
  let now = 2000
  try {
    const monitor = createRuntimeMonitor({ storePath: path.join(root, 'monitor-v1.json'), now: () => ++now })
    await monitor.observeRunSnapshot('/workspace-a/pangea-data', {
      run_id: 'same-run', phase: 'STEP_02', analysis: { completed: 1, total: 9 },
      workflow: { core_rules_ack: { 'path-fidelity': { ack_at: '2026-09-07T03:22:02Z' } } },
      state_read: { updated_at: '2026-09-07T03:22:02Z' },
    })
    const first = await monitor.snapshot({ dataRoot: '/workspace-a/pangea-data', runId: 'same-run' })
    await monitor.observeRunSnapshot('/workspace-a/pangea-data', {
      run_id: 'same-run', phase: 'STEP_03', analysis: { completed: 2, total: 9 },
      workflow: { core_rules_ack: {
        'path-fidelity': { ack_at: '2026-09-07T03:22:02Z' },
        'evidence-consumption': { ack_at: '2026-09-07T03:22:03Z' },
        'narrative-first': { ack_at: '2026-09-07T03:22:03Z' },
      } },
      state_read: { updated_at: '2026-09-07T03:38:18Z' },
    })
    await monitor.observeRunSnapshot('/workspace-b/pangea-data', {
      run_id: 'same-run', phase: 'FAILED', analysis: { completed: 0, total: 9 },
      state_read: { updated_at: '2026-09-07T03:20:00Z' },
    })

    const active = await monitor.snapshot({ dataRoot: '/workspace-a/pangea-data', runId: 'same-run' })
    const other = await monitor.snapshot({ dataRoot: '/workspace-b/pangea-data', runId: 'same-run' })
    assert.equal(active.run.pangea_phase, 'STEP_03')
    assert.equal(active.run.pangea_progress.completed, 2)
    assert.equal(active.run.pangea_progress.core_rules_ack, 3)
    assert.equal(active.run.state_updated_at, '2026-09-07T03:38:18Z')
    assert.ok(active.run.observed_at > first.run.observed_at)
    assert.ok(active.run.progress_changed_at > first.run.progress_changed_at)
    assert.equal(other.run.pangea_phase, 'FAILED')
    await monitor.flush()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('does not trust a v1 monitor association that lacks data root and attempt identity', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-monitor-migrate-'))
  const storePath = path.join(root, 'monitor-v1.json')
  try {
    await mkdir(path.dirname(storePath), { recursive: true })
    await writeFile(storePath, JSON.stringify({ version: 1, runs: {
      'run-06': { session_id: 'session-05', session_created_at: 500, pangea_phase: 'FAILED' },
    } }), 'utf8')
    const monitor = createRuntimeMonitor({ storePath })
    const snapshot = await monitor.snapshot({ dataRoot: '/workspace/pangea-data', runId: 'run-06' })
    assert.equal(snapshot.run, null)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('tracks real record save times separately from polling, transport activity, and elapsed clocks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-monitor-effective-'))
  const storePath = path.join(root, 'monitor-v1.json')
  let now = 10000
  try {
    const monitor = createRuntimeMonitor({ storePath, now: () => ++now })
    const owner = agent('owner', root, 1)
    const dispose = monitor.start(contextWith(owner))
    const execution = {
      format_version: 'pangea-execution-view-v1', stage: 'analyzing', lifecycle_status: 'running',
      unit_counts: { total: 1, completed: 0, active: 1 },
      last_effective_progress: { kind: 'records_saved', at_ms: 2000, action_id: 'a', unit_id: 'u', revision: 1, record_count: 1 },
      actions: [{ action_id: 'a', status: 'dispatched', saved_revision: 1, saved_record_count: 1, last_saved_at_ms: 2000,
        completion_declared: false, accepted_revision: null, delivery_revision: null, current_turn_elapsed_ms: 200 }],
    }
    const summary = { run_id: 'run', phase: 'ANALYZING', analysis: { completed: 0, total: 1 }, execution_view: execution }
    await monitor.bindExecution('owner', summary, { dataRoot: root, taskId: 'task', attemptId: 'attempt' })
    const first = (await monitor.snapshot({ dataRoot: root, runId: 'run' })).run
    execution.actions[0].current_turn_elapsed_ms = 900
    await monitor.observeRunSnapshot(root, summary)
    monitor.disposeAgent(owner)
    const observed = (await monitor.snapshot({ dataRoot: root, runId: 'run' })).run
    assert.ok(observed.observed_at > first.observed_at)
    assert.ok(observed.execution_last_activity_at > first.execution_last_activity_at)
    assert.equal(observed.progress_changed_at, first.progress_changed_at)
    assert.equal(observed.last_effective_progress_at_ms, 2000)
    execution.actions[0].saved_revision = 2
    execution.actions[0].saved_record_count = 2
    execution.actions[0].last_saved_at_ms = 3000
    execution.last_effective_progress = { ...execution.last_effective_progress, at_ms: 3000, revision: 2, record_count: 2 }
    await monitor.observeRunSnapshot(root, summary)
    const saved = (await monitor.snapshot({ dataRoot: root, runId: 'run' })).run
    assert.ok(saved.progress_changed_at > observed.progress_changed_at)
    assert.equal(saved.last_effective_progress_at_ms, 3000)
    assert.equal(saved.last_effective_progress.revision, 2)
    execution.actions[0].completion_declared = true
    await monitor.observeRunSnapshot(root, summary)
    const submitted = (await monitor.snapshot({ dataRoot: root, runId: 'run' })).run
    assert.ok(submitted.progress_changed_at > saved.progress_changed_at)
    assert.equal(submitted.last_effective_progress_at_ms, 3000)
    await dispose()
    const restarted = createRuntimeMonitor({ storePath })
    const restored = (await restarted.snapshot({ dataRoot: root, runId: 'run' })).run
    assert.equal(restored.last_effective_progress_at_ms, 3000)
    assert.equal(restored.last_effective_progress.action_id, 'a')
    assert.equal(restored.session_live, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('retries transient Windows rename locks without deleting the previous monitor file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-monitor-windows-lock-'))
  const storePath = path.join(root, 'monitor-v1.json')
  const previous = JSON.stringify({ version: 2, runs: {} })
  const sources = []
  const delays = []
  const logger = captureLogger()
  let attempts = 0
  try {
    await writeFile(storePath, previous, 'utf8')
    const monitor = createRuntimeMonitor({
      storePath, logger,
      writeOptions: {
        platform: 'win32', retryDelays: [1, 2, 3], wait: async delay => delays.push(delay),
        operations: {
          mkdir, writeFile, rm,
          async rename(source, target) {
            sources.push(source)
            if (attempts < 3) {
              assert.equal(await readFile(target, 'utf8'), previous)
              throw Object.assign(new Error('Windows sharing lock'), { code: ['EPERM', 'EBUSY', 'EACCES'][attempts++] })
            }
            attempts += 1
            return rename(source, target)
          },
        },
      },
    })
    await monitor.observeRunSnapshot(root, { run_id: 'run', phase: 'PLANNING' })
    assert.equal(monitor.getPersistenceStatus().pending, true)
    const status = await monitor.flush()
    assert.equal(attempts, 4)
    assert.deepEqual(delays, [1, 2, 3])
    assert.equal(new Set(sources).size, 1)
    assert.notEqual(sources[0], `${storePath}.tmp`)
    assert.match(sources[0], /monitor-v1\.json\.[^.]+\.[0-9a-f-]+\.tmp$/)
    assert.equal(status.status, 'healthy')
    assert.equal(status.pending, false)
    assert.equal(logger.entries.length, 0)
    assert.deepEqual(await readdir(root), ['monitor-v1.json'])
    assert.equal(JSON.parse(await readFile(storePath, 'utf8')).runs[runIdentityKey(root, 'run')].pangea_phase, 'PLANNING')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('reports exhausted writes, preserves disk history, and flushes the latest memory state after recovery', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-monitor-persist-recovery-'))
  const storePath = path.join(root, 'monitor-v1.json')
  const previous = JSON.stringify({ version: 2, runs: {} })
  const logger = captureLogger()
  let fail = true
  let attempts = 0
  try {
    await writeFile(storePath, previous, 'utf8')
    const monitor = createRuntimeMonitor({ storePath, logger, writeOptions: {
      platform: 'win32', retryDelays: [0], wait: async () => {},
      operations: { mkdir, writeFile, rm, async rename(source, target) {
        attempts += 1
        if (fail) throw Object.assign(new Error('Windows sharing lock'), { code: 'EPERM' })
        return rename(source, target)
      } },
    } })
    await monitor.observeRunSnapshot(root, { run_id: 'run', phase: 'PLANNING' })
    const failed = await monitor.flush()
    assert.equal(attempts, 2)
    assert.equal(failed.status, 'degraded')
    assert.equal(failed.pending, true)
    assert.equal(failed.error.code, 'EPERM')
    assert.match(failed.error.message, /运行观察缓存保存失败.*stage=rename.*attempts=2/)
    assert.equal(failed.last_success_at_ms, null)
    assert.equal(await readFile(storePath, 'utf8'), previous)
    assert.deepEqual(await readdir(root), ['monitor-v1.json'])
    failed.error.code = 'tampered'
    assert.equal(monitor.getPersistenceStatus().error.code, 'EPERM')
    const failureAgain = await monitor.flush()
    assert.equal(failureAgain.consecutive_failures, 2)
    assert.equal(logger.entries.filter(([level]) => level === 'warn').length, 1)
    await monitor.observeRunSnapshot(root, { run_id: 'run', phase: 'ANALYZING' })
    fail = false
    const recovered = await monitor.flush()
    assert.equal(recovered.status, 'healthy')
    assert.equal(recovered.pending, false)
    assert.equal(recovered.error, null)
    assert.equal(recovered.consecutive_failures, 0)
    assert.ok(recovered.recovered_at_ms >= failed.last_failure_at_ms)
    assert.equal(logger.entries.filter(([level]) => level === 'info').length, 1)
    assert.equal(JSON.parse(await readFile(storePath, 'utf8')).runs[runIdentityKey(root, 'run')].pangea_phase, 'ANALYZING')
    assert.deepEqual((await monitor.snapshot()).persistence, recovered)
  } finally { await rm(root, { recursive: true, force: true }) }
})

for (const failFirst of [false, true]) {
  test(`serializes concurrent flushes and saves updates received during an in-flight ${failFirst ? 'failed' : 'successful'} save`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-monitor-in-flight-'))
    const storePath = path.join(root, 'monitor-v1.json')
    const started = deferred()
    const release = deferred()
    const sources = []
    let active = 0
    let maxActive = 0
    try {
      const monitor = createRuntimeMonitor({ storePath, logger: captureLogger(), writeOptions: {
        platform: 'win32', retryDelays: [],
        operations: { mkdir, writeFile, rm, async rename(source, target) {
          sources.push(source)
          active += 1
          maxActive = Math.max(maxActive, active)
          try {
            if (sources.length === 1) {
              started.resolve()
              await release.promise
              if (failFirst) throw Object.assign(new Error('busy'), { code: 'EPERM' })
            }
            return await rename(source, target)
          } finally { active -= 1 }
        } },
      } })
      await monitor.observeRunSnapshot(root, { run_id: 'run', phase: 'PLANNING' })
      const first = monitor.flush()
      await started.promise
      await monitor.observeRunSnapshot(root, { run_id: 'run', phase: 'ANALYZING' })
      const second = monitor.flush()
      const third = monitor.flush()
      release.resolve()
      await Promise.all([first, second, third])
      assert.equal(maxActive, 1)
      assert.equal(sources.length, 2)
      assert.equal(new Set(sources).size, 2)
      assert.equal(monitor.getPersistenceStatus().pending, false)
      assert.equal(monitor.getPersistenceStatus().status, 'healthy')
      assert.equal(JSON.parse(await readFile(storePath, 'utf8')).runs[runIdentityKey(root, 'run')].pangea_phase, 'ANALYZING')
      assert.deepEqual(await readdir(root), ['monitor-v1.json'])
    } finally {
      release.resolve()
      await rm(root, { recursive: true, force: true })
    }
  })
}

test('coalesces dozens of timer requests behind a blocked save and stops retrying without new observations', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-monitor-coalesced-'))
  const storePath = path.join(root, 'monitor-v1.json')
  const started = deferred()
  const release = deferred()
  let locked = true
  let attempts = 0
  let monitor
  try {
    monitor = createRuntimeMonitor({ storePath, saveDelayMs: 0, logger: captureLogger(), writeOptions: {
      platform: 'win32', retryDelays: [],
      operations: { mkdir, writeFile, rm, async rename(source, target) {
        attempts += 1
        if (attempts === 1) {
          started.resolve()
          await release.promise
        }
        if (locked) throw Object.assign(new Error('sharing lock'), { code: 'EPERM' })
        return rename(source, target)
      } },
    } })
    await monitor.observeRunSnapshot(root, { run_id: 'run', phase: 'PLANNING' })
    await started.promise
    for (let index = 0; index < 40; index += 1) {
      await monitor.observeRunSnapshot(root, { run_id: 'run', phase: `STEP_${index}` })
      // Let every debounce timer fire while the first save remains blocked.
      await new Promise(resolve => setTimeout(resolve, 2))
    }
    assert.equal(attempts, 1)
    const first = monitor.saveQueue
    release.resolve()
    await first
    await monitor.saveQueue
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(attempts, 2, 'only the in-flight attempt and one latest-state attempt may run')
    assert.equal(monitor.getPersistenceStatus().status, 'degraded')
    assert.equal(monitor.getPersistenceStatus().pending, true)
    locked = false
    await monitor.observeRunSnapshot(root, { run_id: 'run', phase: 'COMPLETED' })
    await monitor.flush()
    assert.equal(attempts, 3)
    assert.equal(monitor.getPersistenceStatus().pending, false)
    assert.equal(JSON.parse(await readFile(storePath, 'utf8')).runs[runIdentityKey(root, 'run')].pangea_phase, 'COMPLETED')
  } finally {
    release.resolve()
    if (monitor) await monitor.saveQueue
    await rm(root, { recursive: true, force: true })
  }
})

test('flush resolves after an attempt covering its revision even if later observations remain blocked', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-monitor-flush-bound-'))
  const gates = [deferred(), deferred(), deferred()]
  const started = [deferred(), deferred(), deferred()]
  let attempts = 0
  let monitor
  let timeout
  try {
    monitor = createRuntimeMonitor({ storePath: path.join(root, 'monitor-v1.json'), saveDelayMs: 0, logger: captureLogger(), writeOptions: {
      platform: 'win32', retryDelays: [],
      operations: { mkdir, writeFile, rm, async rename() {
        const index = attempts++
        started[index]?.resolve()
        await gates[index]?.promise
        throw Object.assign(new Error('sharing lock'), { code: 'EPERM' })
      } },
    } })
    await monitor.observeRunSnapshot(root, { run_id: 'run', phase: 'STEP_1' })
    await started[0].promise
    await monitor.observeRunSnapshot(root, { run_id: 'run', phase: 'STEP_2' })
    const flushed = monitor.flush()
    gates[0].resolve()
    await started[1].promise
    await monitor.observeRunSnapshot(root, { run_id: 'run', phase: 'STEP_3' })
    await new Promise(resolve => setTimeout(resolve, 5))
    gates[1].resolve()
    await started[2].promise
    const result = await Promise.race([
      flushed,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('flush waited for an observation received after its call')), 500) }),
    ])
    assert.equal(result.status, 'degraded')
    assert.equal(result.pending, true)
    assert.equal(attempts, 3)
  } finally {
    clearTimeout(timeout)
    for (const gate of gates) gate.resolve()
    if (monitor) await monitor.saveQueue
    await rm(root, { recursive: true, force: true })
  }
})

test('a background EPERM does not terminate a default Node host and a later observation recovers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-monitor-default-node-'))
  const monitorModule = new URL('../src/monitor.js', import.meta.url).href
  try {
    // Default Node rejection handling previously terminated Harness after the
    // 250 ms timer, even though observeRunSnapshot itself had already resolved.
    const script = `
      import assert from 'node:assert/strict';
      import { mkdir, writeFile, rename, rm, readFile } from 'node:fs/promises';
      import path from 'node:path';
      import { createRuntimeMonitor, runIdentityKey } from ${JSON.stringify(monitorModule)};
      const root = process.argv[1];
      const storePath = path.join(root, 'monitor-v1.json');
      const previous = JSON.stringify({version:2,runs:{}});
      await writeFile(storePath, previous);
      let locked = true;
      let renames = 0;
      const monitor = createRuntimeMonitor({storePath, saveDelayMs:5, logger:{warn(){},info(){}}, writeOptions:{
        platform:'win32', retryDelays:[], operations:{mkdir,writeFile,rm,async rename(source,target){
          renames += 1;
          if(locked) throw Object.assign(new Error('EPERM injected'),{code:'EPERM'});
          return rename(source,target);
        }}
      }});
      await monitor.observeRunSnapshot(root,{run_id:'run',phase:'PLANNING'});
      const deadline = Date.now()+2000;
      while(monitor.getPersistenceStatus().status!=='degraded' && Date.now()<deadline) await new Promise(r=>setTimeout(r,10));
      assert.equal(monitor.getPersistenceStatus().status,'degraded');
      assert.equal(await readFile(storePath,'utf8'),previous);
      const afterFailure = renames;
      await new Promise(r=>setTimeout(r,30));
      assert.equal(renames,afterFailure,'no unbounded retry loop');
      locked=false;
      await monitor.observeRunSnapshot(root,{run_id:'run',phase:'COMPLETED'});
      const recoveryDeadline = Date.now()+2000;
      while(monitor.getPersistenceStatus().pending && Date.now()<recoveryDeadline) await new Promise(r=>setTimeout(r,10));
      assert.equal(monitor.getPersistenceStatus().status,'healthy');
      assert.equal(monitor.getPersistenceStatus().pending,false);
      assert.equal(JSON.parse(await readFile(storePath,'utf8')).runs[runIdentityKey(root,'run')].pangea_phase,'COMPLETED');
      console.log('background failure survived; latest state recovered');
    `
    const env = { ...process.env }
    delete env.NODE_OPTIONS
    const { stdout, stderr } = await execFileAsync(process.execPath, ['--input-type=module', '--eval', script, root], { env, timeout: 5000 })
    assert.match(stdout, /background failure survived; latest state recovered/)
    assert.equal(stderr, '')
  } finally { await rm(root, { recursive: true, force: true }) }
})
