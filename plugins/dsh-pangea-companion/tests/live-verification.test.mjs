import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import ssh2 from 'ssh2'

import { EnvironmentStore } from '../src/execution/environment.js'
import { PangeaSshRuntime, checkDangerousCommand } from '../src/execution/ssh.js'
import { FaultInjectionService } from '../src/fault-injection.js'
import { LiveVerificationService, buildPidLookupCommand, validateVerificationResult } from '../src/live-verification.js'
import { requireAgentModel } from '../src/agent-models.js'
import { environmentRouteHandler, liveVerificationRouteHandler } from '../src/index.js'

const { Server } = ssh2
const execFileAsync = promisify(execFile)

async function startMockSshServer({ username = 'tester', password = 'secret', onExec, onShell }) {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const server = new Server({ hostKeys: [privateKey.export({ type: 'pkcs1', format: 'pem' })] }, client => {
    client.on('authentication', ctx => {
      if (ctx.method === 'password' && ctx.username === username && ctx.password === password) ctx.accept()
      else ctx.reject()
    })
    client.on('ready', () => client.on('session', acceptSession => {
      const session = acceptSession()
      session.on('pty', acceptPty => acceptPty())
      session.on('exec', (acceptExec, _reject, info) => {
        const stream = acceptExec()
        onExec(info.command, stream)
      })
      session.on('shell', acceptShell => {
        const stream = acceptShell()
        if (onShell) onShell(stream)
      })
    }))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return { server, port: server.address().port }
}

async function waitTerminal(service, dataRoot, verifyId, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { task } = await service.get(dataRoot, verifyId)
    if (!['preflight', 'running'].includes(task.status)) return task
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  assert.fail(`live verification ${verifyId} did not reach terminal state`)
}

test('Stage-0 marker gate blocks wrong package without invoking ACP worker', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-lv-stage0-'))
  const dataRoot = path.join(root, 'pangea-data')
  await mkdir(dataRoot, { recursive: true })
  const arraySsh = await startMockSshServer({
    onExec: (cmd, stream) => {
      if (cmd.includes('PANGEA_PREFLIGHT_OK')) { stream.write('PANGEA_PREFLIGHT_OK\n'); stream.exit(0); stream.end(); return }
      if (cmd.includes('pidof')) { stream.write('4242\n'); stream.exit(0); stream.end(); return }
      if (cmd.includes('grep -aFq')) { stream.exit(1); stream.end(); return }
      stream.exit(0); stream.end()
    },
  })
  const envStore = new EnvironmentStore(path.join(root, 'environments.json'))
  const ssh = new PangeaSshRuntime(envStore)
  let workerCalled = false
  const service = new LiveVerificationService({
    environments: envStore,
    ssh,
    runWorker: async () => { workerCalled = true; return { summary: '', items: [] } },
  })
  t.after(async () => {
    await service.dispose()
    await ssh.dispose()
    await new Promise(resolve => arraySsh.server.close(resolve))
    await rm(root, { recursive: true, force: true })
  })

  const env = await envStore.save({
    id: 'env-wrong-pkg',
    name: '阵列测试环境',
    array: { ip: '127.0.0.1', port: arraySsh.port, username: 'tester', password: 'secret', default_process: 'storage_daemon' },
  })
  const started = await service.start({
    dataRoot,
    cwd: root,
    mode: 'fault_injection',
    environment_id: env.id,
    provider_id: 'nga',
    agent_model: 'test-model',
    marker_strings: ['PANGEA_INJ_RACE_01'],
    targets: [{ target_key: 'R-CONC-001', title: '并发 UAF', kind: 'risk' }],
  })
  const done = await waitTerminal(service, dataRoot, started.id)
  assert.equal(done.status, 'blocked')
  assert.equal(workerCalled, false, 'ACP worker must NOT be invoked when Stage-0 marker gate fails')
  assert.equal(done.preflight.ok, false)
  assert.deepEqual(done.preflight.missing_markers, ['PANGEA_INJ_RACE_01'])
  assert.equal(done.draft_verdicts[0].verdict, 'blocked')
})

test('End-to-end dual-endpoint SSH verification via loopback CLI gateway, dangerous guard, cleanup, confirm, and IP lock', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-lv-e2e-'))
  const dataRoot = path.join(root, 'pangea-data')
  const frozenRunFile = path.join(dataRoot, 'runs', 'run-01', 'progress.json')
  await mkdir(path.dirname(frozenRunFile), { recursive: true })
  await writeFile(frozenRunFile, '{"frozen":true}\n', 'utf8')

  const arrayExecLog = []
  const hostExecLog = []
  const arraySsh = await startMockSshServer({
    onExec: (cmd, stream) => {
      arrayExecLog.push(cmd)
      if (cmd.includes('PANGEA_PREFLIGHT_OK')) { stream.write('PANGEA_PREFLIGHT_OK\n'); stream.exit(0); stream.end(); return }
      if (cmd.includes('pidof')) { stream.write('4242\n'); stream.exit(0); stream.end(); return }
      if (cmd.includes('grep -aFq') && cmd.includes('PANGEA_INJ_RACE_01')) { stream.exit(0); stream.end(); return }
      if (cmd.includes('rm -f /dev/shm/pangea_race_01')) { stream.write('cleaned\n'); stream.exit(0); stream.end(); return }
      stream.write(`array-ok:${cmd}\n`); stream.exit(0); stream.end()
    },
    onShell: stream => {
      let buf = ''
      stream.on('data', chunk => {
        buf += chunk.toString('utf8')
        while (buf.includes('\n')) {
          const i = buf.indexOf('\n')
          const line = buf.slice(0, i).replace(/\r$/, '')
          buf = buf.slice(i + 1)
          if (line === 'diagnose_usr') stream.write('diag> ')
          else if (line === 'attach mod') stream.write('attach> ')
          else if (line === 'stub enable INJ-001') stream.write('INJ-001=1 hit\n')
        }
      })
    },
  })
  const hostSsh = await startMockSshServer({
    onExec: (cmd, stream) => {
      hostExecLog.push(cmd)
      if (cmd.includes('PANGEA_PREFLIGHT_OK')) { stream.write('PANGEA_PREFLIGHT_OK\n'); stream.exit(0); stream.end(); return }
      stream.write('io-trigger-completed\n'); stream.exit(0); stream.end()
    },
  })

  const envStore = new EnvironmentStore(path.join(root, 'environments.json'))
  const ssh = new PangeaSshRuntime(envStore)
  const holdRelease = Promise.withResolvers()
  let workerStarted = Promise.withResolvers()
  const service = new LiveVerificationService({
    environments: envStore,
    ssh,
    runWorker: async ({ cliPath, gatewayConfigPath, scratchDirectory }) => {
      workerStarted.resolve()
      await holdRelease.promise
      const runCli = async args => {
        const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args, '--config', gatewayConfigPath])
        return JSON.parse(stdout)
      }
      // 1. Register cleanup command first
      await runCli(['register-cleanup', '--target', 'array', '--cmd', 'rm -f /dev/shm/pangea_race_01', '--desc', '清理单次桩控制文件'])
      // 2. Try a dangerous command -> must be rejected by gateway with 403
      await assert.rejects(
        () => runCli(['exec', '--target', 'array', '--cmd', 'reboot']),
        err => /禁止整机重启/.test(err.stderr || err.message),
      )
      // 3. Interactive diagnose PTY on array
      const exFile = path.join(scratchDirectory, 'diag.json')
      await writeFile(exFile, JSON.stringify([
        { send: 'diagnose_usr', expect: 'diag>', timeout_seconds: 3 },
        { send: 'attach mod', expect: 'attach>', timeout_seconds: 3 },
        { send: 'stub enable INJ-001', expect: 'INJ-001=1 hit', timeout_seconds: 3 },
      ]), 'utf8')
      const diagRes = await runCli(['interactive', '--target', 'array', '--exchanges-file', exFile])
      // 4. Trigger stimulus from host
      const hostRes = await runCli(['exec', '--target', 'host', '--cmd', 'run_io_stimulus'])
      return {
        summary: '真机双端核验完成，R-CONC-001 已实锤',
        items: [{
          target_key: 'R-CONC-001',
          verdict: 'confirmed',
          hits: 'INJ-001=1',
          evidence_command_ids: [diagRes.command_id, hostRes.command_id],
          observed_behavior: 'Array diagnose 命中 INJ-001=1 且 Host 触发异常响应',
          cleanup_verified: true,
          notes: '已通过 register-cleanup 兜底清理',
        }],
      }
    },
  })

  t.after(async () => {
    holdRelease.resolve()
    await service.dispose()
    await ssh.dispose()
    await new Promise(resolve => arraySsh.server.close(resolve))
    await new Promise(resolve => hostSsh.server.close(resolve))
    await rm(root, { recursive: true, force: true })
  })

  const env = await envStore.save({
    id: 'env-dual',
    name: '双端联调环境',
    host: { ip: '127.0.0.1', port: hostSsh.port, username: 'tester', password: 'secret' },
    array: { ip: '127.0.0.1', port: arraySsh.port, username: 'tester', password: 'secret', default_process: 'storage_daemon' },
  })

  const started = await service.start({
    dataRoot,
    cwd: root,
    mode: 'fault_injection',
    run_id: 'run-01',
    environment_id: env.id,
    provider_id: 'nga',
    agent_model: 'test-model',
    marker_strings: ['PANGEA_INJ_RACE_01'],
    targets: [{ target_key: 'R-CONC-001', title: '并发 UAF', kind: 'risk' }],
  })

  await workerStarted.promise
  // Concurrent start against same target IP must fail with 409
  await assert.rejects(
    () => service.start({
      dataRoot,
      cwd: root,
      mode: 'direct_risk',
      environment_id: env.id,
      provider_id: 'nga',
      agent_model: 'test-model',
      targets: [{ target_key: 'R-CONC-002', title: '另一风险', kind: 'risk' }],
    }),
    err => err.statusCode === 409 && /占用/.test(err.message),
  )

  holdRelease.resolve()
  const done = await waitTerminal(service, dataRoot, started.id)
  assert.equal(done.status, 'completed', done.error)
  assert.equal(done.preflight.ok, true)
  assert.equal(done.draft_verdicts[0].verdict, 'confirmed')
  assert.equal(done.cleanup.status, 'ok')
  assert.equal(done.cleanup.post_check.process_alive, true)
  assert.ok(arrayExecLog.some(cmd => cmd.includes('rm -f /dev/shm/pangea_race_01')), 'registered cleanup must execute in host finally')
  assert.ok(hostExecLog.includes('run_io_stimulus'))

  const { transcript } = await service.get(dataRoot, started.id)
  assert.ok(transcript.some(entry => entry.blocked === true && entry.command === 'reboot'), 'blocked dangerous command must be recorded in transcript')

  // Confirm verdict
  const confirmed = await service.confirm({
    dataRoot,
    verifyId: started.id,
    verdicts: done.draft_verdicts,
  })
  assert.equal(confirmed.status, 'confirmed')
  assert.equal(confirmed.confirmed_verdicts[0].verdict, 'confirmed')
  // Frozen analysis run remains untouched
  assert.equal(await readFile(frozenRunFile, 'utf8'), '{"frozen":true}\n')
  // IP lock is released
  assert.deepEqual(service.getLocks(), {})
})

test('validateVerificationResult rejects fabricated command_ids and invalid verdicts', () => {
  const badCmd = validateVerificationResult({
    summary: 'fake',
    items: [{ target_key: 'R-1', verdict: 'confirmed', evidence_command_ids: ['cmd-9999'] }],
  }, { targetKeys: ['R-1'], validCommandIds: new Set(['cmd-0001']) })
  assert.equal(badCmd.ok, false)
  assert.match(badCmd.error, /cmd-9999/)

  const badVerdict = validateVerificationResult({
    summary: 'bad',
    items: [{ target_key: 'R-1', verdict: 'passed', evidence_command_ids: ['cmd-0001'] }],
  }, { targetKeys: ['R-1'], validCommandIds: new Set(['cmd-0001']) })
  assert.equal(badVerdict.ok, false)

  const ok = validateVerificationResult({
    summary: 'good',
    items: [{ target_key: 'R-1', verdict: 'excluded', evidence_command_ids: ['cmd-0001'], hits: 'INJ-1=1' }],
  }, { targetKeys: ['R-1'], validCommandIds: new Set(['cmd-0001']) })
  assert.equal(ok.ok, true)
})

test('HTTP routes redact environment passwords and serve live-verification list/detail', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-lv-http-'))
  const dataRoot = path.join(root, 'pangea-data')
  await mkdir(dataRoot, { recursive: true })
  const envStore = new EnvironmentStore(path.join(root, 'environments.json'))
  const ssh = new PangeaSshRuntime(envStore)
  const service = new LiveVerificationService({ environments: envStore, ssh, runWorker: async () => ({ summary: '', items: [] }) })
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/api/pangea-companion/environments')) {
      void environmentRouteHandler(req, res, envStore, ssh, service)
    } else {
      void liveVerificationRouteHandler(req, res, service, null, {}, { resolveRoot: async () => dataRoot })
    }
  })
  t.after(async () => {
    await service.dispose()
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const headers = { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }

  const saveRes = await fetch(`${base}/api/pangea-companion/environments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'HTTP 环境', array: { ip: '10.1.1.2', port: 22, username: 'admin', password: 'never-expose-me' } }),
  })
  assert.equal(saveRes.status, 200)
  const savedBody = await saveRes.json()
  assert.equal(savedBody.environment.array.has_password, true)
  assert.equal(savedBody.environment.array.password, undefined)

  const listEnvRes = await fetch(`${base}/api/pangea-companion/environments`, { headers })
  const listEnvBody = await listEnvRes.json()
  assert.equal(listEnvBody.environments.length, 1)
  assert.doesNotMatch(JSON.stringify(listEnvBody), /never-expose-me/)

  const lvListRes = await fetch(`${base}/api/pangea-companion/live-verification`, { headers })
  assert.equal(lvListRes.status, 200)
  const lvListBody = await lvListRes.json()
  assert.deepEqual(lvListBody.tasks, [])
})

test('validateVerificationResult enforces zero-hit guard in fault-injection mode', () => {
  const validIds = new Set(['cmd-0001'])
  const zeroConfirmed = validateVerificationResult({
    summary: 'claimed confirmed without hit',
    items: [{ target_key: 'R-1', verdict: 'confirmed', hits: 'INJ-001=0', evidence_command_ids: ['cmd-0001'] }],
  }, { targetKeys: ['R-1'], validCommandIds: validIds, requireNonZeroHits: true })
  assert.equal(zeroConfirmed.ok, false)
  assert.match(zeroConfirmed.error, /hits/)

  const emptyExcluded = validateVerificationResult({
    summary: 'claimed excluded without hit',
    items: [{ target_key: 'R-1', verdict: 'excluded', hits: '', evidence_command_ids: ['cmd-0001'] }],
  }, { targetKeys: ['R-1'], validCommandIds: validIds, requireNonZeroHits: true })
  assert.equal(emptyExcluded.ok, false)

  const notTriggered = validateVerificationResult({
    summary: 'honest not triggered',
    items: [{ target_key: 'R-1', verdict: 'not_triggered', hits: 'INJ-001=0', evidence_command_ids: ['cmd-0001'] }],
  }, { targetKeys: ['R-1'], validCommandIds: validIds, requireNonZeroHits: true })
  assert.equal(notTriggered.ok, true)

  const realHit = validateVerificationResult({
    summary: 'real hit',
    items: [{ target_key: 'R-1', verdict: 'confirmed', hits: 'INJ-001=2', evidence_command_ids: ['cmd-0001'] }],
  }, { targetKeys: ['R-1'], validCommandIds: validIds, requireNonZeroHits: true })
  assert.equal(realHit.ok, true)
})

test('SSH gateway enforces maxGatewayCalls (HTTP 429) while host finally cleanup still succeeds', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-lv-cap-'))
  const dataRoot = path.join(root, 'pangea-data')
  await mkdir(dataRoot, { recursive: true })
  const execLog = []
  const arraySsh = await startMockSshServer({
    onExec: (cmd, stream) => {
      execLog.push(cmd)
      if (cmd.includes('PANGEA_PREFLIGHT_OK')) { stream.write('PANGEA_PREFLIGHT_OK\n'); stream.exit(0); stream.end(); return }
      if (cmd.includes('pidof')) { stream.write('7777\n'); stream.exit(0); stream.end(); return }
      stream.write('ok\n'); stream.exit(0); stream.end()
    },
  })
  const envStore = new EnvironmentStore(path.join(root, 'environments.json'))
  const ssh = new PangeaSshRuntime(envStore)
  const service = new LiveVerificationService({
    environments: envStore,
    ssh,
    maxGatewayCalls: 2,
    runWorker: async ({ cliPath, gatewayConfigPath }) => {
      const runCli = async args => {
        const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args, '--config', gatewayConfigPath])
        return JSON.parse(stdout)
      }
      await runCli(['register-cleanup', '--target', 'array', '--cmd', 'echo CLEANUP_OK', '--desc', '兜底清理'])
      const r1 = await runCli(['exec', '--target', 'array', '--cmd', 'echo probe1'])
      const r2 = await runCli(['exec', '--target', 'array', '--cmd', 'echo probe2'])
      await assert.rejects(
        () => runCli(['exec', '--target', 'array', '--cmd', 'echo probe3']),
        err => /429|上限/.test(err.stderr || err.message),
      )
      return {
        summary: '触发调用预算上限后正常收敛',
        items: [{
          target_key: 'R-CAP-1',
          verdict: 'blocked',
          hits: '',
          evidence_command_ids: [r1.command_id, r2.command_id],
          observed_behavior: '达到预算上限停止探针',
          cleanup_verified: true,
          notes: 'budget cap test',
        }],
      }
    },
  })
  t.after(async () => {
    await service.dispose()
    await ssh.dispose()
    await new Promise(resolve => arraySsh.server.close(resolve))
    await rm(root, { recursive: true, force: true })
  })

  const env = await envStore.save({
    id: 'env-cap',
    name: '预算测试环境',
    array: { ip: '127.0.0.1', port: arraySsh.port, username: 'tester', password: 'secret', default_process: 'storage_daemon' },
  })
  const started = await service.start({
    dataRoot,
    cwd: root,
    mode: 'direct_risk',
    environment_id: env.id,
    provider_id: 'nga',
    agent_model: 'test-model',
    targets: [{ target_key: 'R-CAP-1', title: '预算测试', kind: 'risk' }],
  })
  const done = await waitTerminal(service, dataRoot, started.id)
  assert.equal(done.status, 'completed', done.error)
  assert.equal(done.cleanup.status, 'ok')
  assert.ok(execLog.includes('echo CLEANUP_OK'), 'host cleanup must still execute after worker hits gateway cap')
})

test('Full route hydration from FaultInjectionService + frozen run context + tool_reference_files + sync-back + run-candidates', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-lv-hydrate-'))
  const dataRoot = path.join(root, 'pangea-data')
  const runId = 'run-phase2'
  const fiTaskId = 'fi-task-1'
  const runDir = path.join(dataRoot, 'runs', runId)
  const actionsDir = path.join(runDir, 'actions')
  await mkdir(actionsDir, { recursive: true })
  await mkdir(path.join(runDir, 'inputs', 'source', 'repo-1', 'tools'), { recursive: true })
  await writeFile(path.join(runDir, 'inputs', 'source', 'repo-1', 'tools', 'cli_adm.c'), '// adm lun show\n', 'utf8')
  await writeFile(path.join(runDir, 'inputs', 'source-manifest.json'), JSON.stringify({
    scope_expansion: {
      groups: [{ repo_id: 'repo-1', context_paths: ['src/header.h', 'tools/cli_adm.c'] }],
      context_files: [
        { repo_id: 'repo-1', path: 'src/header.h', reason: 'source_scope_reference' },
        { repo_id: 'repo-1', path: '../../escape.txt', reason: 'test_tool_reference' },
        { repo_id: 'repo-1', path: 'tools/cli_adm.c', reason: 'test_tool_reference' },
      ],
    },
  }), 'utf8')
  await writeFile(path.join(runDir, 'inputs', 'source-first-plan.json'), JSON.stringify({
    units: [{ unit_id: 'unit-1', title: 'IO 回调单元' }],
  }), 'utf8')
  const taskPath = path.join(actionsDir, 'act-1.task.json')
  const resultPath = path.join(actionsDir, 'act-1.result.json')
  await writeFile(taskPath, JSON.stringify({ action_id: 'act-1', stage: 'unit_analysis', unit_id: 'unit-1', result_path: resultPath }), 'utf8')
  await writeFile(resultPath, JSON.stringify({
    unit_id: 'unit-1',
    revision: 1,
    binding: { run_id: runId, action_id: 'act-1', task_id: 'task-1' },
    records: [
      {
        record_id: 'rec-r1',
        kind: 'risk',
        body: {
          risk_id: 'R-LOW-01',
          title: '常规边界检查',
          severity: 'low',
          dimension: 'logic',
          verification_status: 'verified_by_code',
        },
      },
      {
        record_id: 'rec-r2',
        kind: 'risk',
        body: {
          risk_id: 'R-CONC-001',
          title: '并发回调释放后使用',
          severity: 'high',
          dimension: 'concurrency',
          verification_status: 'needs_runtime_verification',
          precondition: '多路径 IO 并发下发',
          trigger_condition: '在回调窗口内触发链路切换',
          external_observation: 'daemon 日志出现 UAF panic 或 IO 返回 EIO',
          exclusion_condition: '桩命中后引用计数正确归零且无异常日志',
          mechanism: '无锁读取 pending_ctx',
        },
      },
      {
        record_id: 'rec-c1',
        kind: 'test_case',
        body: {
          case_id: 'TC-001',
          title: '高并发链路切换稳定性',
          preconditions: '至少 2 条 NVMe-oF 路径在线',
          steps: ['主机启动 fio 写入', '阵列断开主路径'],
          expected: ['IO 无中断', '无进程重启'],
        },
      },
    ],
  }), 'utf8')
  await writeFile(path.join(runDir, 'progress.json'), JSON.stringify({
    workflow_version: 'source-first-v1',
    run_id: runId,
    status: 'completed',
    updated_at: new Date().toISOString(),
    actions: {
      'act-1': { stage: 'unit_analysis', status: 'accepted', unit_id: 'unit-1', task_id: 'task-1', task_path: taskPath },
    },
  }), 'utf8')

  const fiDir = path.join(dataRoot, '.pangea', 'fault-injection', runId, fiTaskId)
  await mkdir(fiDir, { recursive: true })
  await writeFile(path.join(fiDir, 'task.json'), JSON.stringify({
    id: fiTaskId,
    run_id: runId,
    name: '并发打桩任务',
    status: 'pushed',
    case_keys: ['unit-1/rec-r2'],
    repositories: [{ repo_id: 'repo-1', commit: 'deadbeef1234' }],
    build: { url: 'https://ci.example/build/42', package_id: 'CI-PKG-888', package_sha256: 'abc123', notes: '手动构建包', commits: [{ repo_id: 'repo-1', commit: 'deadbeef1234' }] },
    verification: [],
    result: {
      points: [{
        point_id: 'INJ-001',
        case_keys: ['unit-1/rec-r2'],
        file: 'src/io_cb.c',
        function: 'on_io_complete',
        trigger: 'touch /dev/shm/pangea_inj_001',
        marker_strings: ['PANGEA_INJ_CONC_001'],
        cleanup: 'rm -f /dev/shm/pangea_inj_001',
      }],
    },
  }, null, 2), 'utf8')

  const arraySsh = await startMockSshServer({
    onExec: (cmd, stream) => {
      if (cmd.includes('PANGEA_PREFLIGHT_OK')) { stream.write('PANGEA_PREFLIGHT_OK\n'); stream.exit(0); stream.end(); return }
      if (cmd.includes('pidof')) { stream.write('9090\n'); stream.exit(0); stream.end(); return }
      if (cmd.includes('grep -aFq') && cmd.includes('PANGEA_INJ_CONC_001')) { stream.exit(0); stream.end(); return }
      stream.write('ok\n'); stream.exit(0); stream.end()
    },
  })

  const envStore = new EnvironmentStore(path.join(root, 'environments.json'))
  const ssh = new PangeaSshRuntime(envStore)
  const fiService = new FaultInjectionService()
  let capturedInput = null
  const service = new LiveVerificationService({
    environments: envStore,
    ssh,
    faultInjectionService: fiService,
    runWorker: async ({ inputPath }) => {
      capturedInput = JSON.parse(await readFile(inputPath, 'utf8'))
      return {
        summary: '已通过完整上下文完成真机核验',
        items: [{
          target_key: 'unit-1/rec-r2',
          verdict: 'confirmed',
          hits: 'INJ-001=1',
          evidence_command_ids: ['cmd-0001'],
          observed_behavior: '复现预期异常',
          cleanup_verified: true,
          notes: 'hydrated e2e ok',
        }],
      }
    },
  })

  const server = createServer((req, res) => {
    if (req.url?.startsWith('/api/pangea-companion/environments')) {
      void environmentRouteHandler(req, res, envStore, ssh, service)
    } else {
      void liveVerificationRouteHandler(req, res, service, fiService, {}, { resolveRoot: async () => dataRoot })
    }
  })
  t.after(async () => {
    await service.dispose()
    await ssh.dispose()
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
    await new Promise(resolve => arraySsh.server.close(resolve))
    await rm(root, { recursive: true, force: true })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const headers = { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }

  // 1. Check run-candidates listing and detail sorting
  const runsRes = await fetch(`${base}/api/pangea-companion/live-verification?view=run-candidates`, { headers })
  assert.equal(runsRes.status, 200)
  const runsBody = await runsRes.json()
  assert.ok(runsBody.runs.some(r => r.run_id === runId))

  const candRes = await fetch(`${base}/api/pangea-companion/live-verification?view=run-candidates&run_id=${runId}`, { headers })
  assert.equal(candRes.status, 200)
  const candBody = await candRes.json()
  assert.equal(candBody.risks[0].target_key, 'unit-1/rec-r2', 'needs_runtime_verification risks should be sorted first')
  assert.equal(candBody.test_cases[0].target_key, 'unit-1/rec-c1')

  // 2. Save environment with service_topology and stimulus_playbook
  const envRes = await fetch(`${base}/api/pangea-companion/environments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: '带手册环境',
      service_topology: '主进程 storage_daemon，日志 /var/log/storage/',
      stimulus_playbook: '阵列诊断: adm lun show; 主机压测: fio --name=t',
      array: { ip: '127.0.0.1', port: arraySsh.port, username: 'tester', password: 'secret', default_process: 'storage_daemon' },
    }),
  })
  assert.equal(envRes.status, 200)
  const savedEnv = (await envRes.json()).environment
  assert.match(savedEnv.service_topology, /storage_daemon/)
  assert.match(savedEnv.stimulus_playbook, /adm lun show/)

  // 3. Start verification passing ONLY run_id + fault_injection_task_id (route must hydrate everything)
  const startRes = await fetch(`${base}/api/pangea-companion/live-verification`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'start',
      mode: 'fault_injection',
      run_id: runId,
      fault_injection_task_id: fiTaskId,
      environment_id: savedEnv.id,
      provider_id: 'nga',
      agent_model: 'test-model',
    }),
  })
  assert.equal(startRes.status, 202)
  const startedTask = (await startRes.json()).task
  const done = await waitTerminal(service, dataRoot, startedTask.id)
  assert.equal(done.status, 'completed', done.error)

  // Verify hydrated worker input.json
  assert.ok(capturedInput, 'worker should receive hydrated input.json')
  assert.deepEqual(capturedInput.marker_strings, ['PANGEA_INJ_CONC_001'])
  assert.equal(capturedInput.points.length, 1)
  assert.equal(capturedInput.points[0].point_id, 'INJ-001')
  assert.match(capturedInput.targets[0].external_observation, /UAF panic/)
  assert.match(capturedInput.targets[0].exclusion_condition, /引用计数/)
  assert.match(capturedInput.environment.service_topology, /storage_daemon/)
  assert.match(capturedInput.environment.stimulus_playbook, /adm lun show/)
  assert.equal(capturedInput.tool_reference_files.length, 1)
  assert.equal(capturedInput.tool_reference_files[0].relative_path, 'tools/cli_adm.c')
  assert.match(capturedInput.tool_reference_files[0].frozen_path, /tools[\\/]cli_adm\.c$/)

  // 4. Confirm with sync_to_fault_injection: true and verify real FaultInjectionService record updated
  const confirmRes = await fetch(`${base}/api/pangea-companion/live-verification`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'confirm',
      verify_id: startedTask.id,
      verdicts: done.draft_verdicts,
      sync_to_fault_injection: true,
    }),
  })
  assert.equal(confirmRes.status, 200)
  const confirmedBody = (await confirmRes.json()).task
  assert.equal(confirmedBody.status, 'confirmed')
  assert.deepEqual(confirmedBody.sync_warnings, [])

  const fiAfter = await fiService.read(dataRoot, runId, fiTaskId)
  assert.equal(fiAfter.verification.length, 1)
  assert.equal(fiAfter.verification[0].case_key, 'unit-1/rec-r2')
  assert.equal(fiAfter.verification[0].result, 'failed')
  assert.equal(fiAfter.verification[0].execution_status, 'completed')
  assert.equal(fiAfter.verification[0].risk_verdict, 'confirmed')
  assert.equal(fiAfter.verification[0].hits, 'INJ-001=1')
  assert.equal(fiAfter.build.package_id, 'CI-PKG-888', 'confirm sync must preserve user-entered CI package_id')
  assert.match(fiAfter.verification[0].notes, /\/proc\/9090\/exe/)
  assert.match(done.targets[0].content_hash, /^[0-9a-f]{16}$/)

  // Repeat confirm with unchanged verdicts must not duplicate FI verification entries
  const reconfirmRes = await fetch(`${base}/api/pangea-companion/live-verification`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'confirm',
      verify_id: startedTask.id,
      verdicts: done.draft_verdicts,
      sync_to_fault_injection: true,
    }),
  })
  assert.equal(reconfirmRes.status, 200)
  const fiAfterRepeat = await fiService.read(dataRoot, runId, fiTaskId)
  assert.equal(fiAfterRepeat.verification.length, 1, 'repeat confirm with identical verdict must be idempotent')
})

test('Batch A regressions: pgrep self-match (L1), grep exit 2 (L5), env lock & host snapshot (L2), cleanup persistence (L3), start lock cleanup (L12)', async t => {
  // L1a: buildPidLookupCommand must not self-match a nonexistent process in a real shell
  const cmd = buildPidLookupCommand('nonexist_pangea_daemon_xyz_999')
  const shellRes = await execFileAsync('sh', ['-c', cmd]).catch(err => ({ stdout: err.stdout || '' }))
  assert.equal(String(shellRes.stdout || '').trim(), '', 'PID lookup must not match its own shell')

  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-lv-batcha-'))
  const dataRoot = path.join(root, 'pangea-data')
  await mkdir(dataRoot, { recursive: true })

  // L1b + L5: multi-PID blocks cleanly; grep exit 2 reports unreadable binary instead of missing markers
  let pidStdout = '1001 1002\n'
  let grepExit = 2
  const execLog = []
  const arraySsh = await startMockSshServer({
    onExec: (c, stream) => {
      execLog.push(c)
      if (c.includes('PANGEA_PREFLIGHT_OK')) { stream.write('PANGEA_PREFLIGHT_OK\n'); stream.exit(0); stream.end(); return }
      if (c.includes('pidof')) { stream.write(pidStdout); stream.exit(0); stream.end(); return }
      if (c.includes('grep -aFq')) {
        if (grepExit === 2) stream.stderr.write('grep: /proc/1001/exe: Permission denied\n')
        stream.exit(grepExit); stream.end(); return
      }
      stream.write('ok\n'); stream.exit(0); stream.end()
    },
  })

  const envStore = new EnvironmentStore(path.join(root, 'environments.json'))
  const ssh = new PangeaSshRuntime(envStore)
  const hold = Promise.withResolvers()
  const workerEntered = Promise.withResolvers()
  let shouldHold = false
  const service = new LiveVerificationService({
    environments: envStore,
    ssh,
    runWorker: async ({ cliPath, gatewayConfigPath }) => {
      if (shouldHold) {
        const { stdout } = await execFileAsync(process.execPath, [
          cliPath, 'register-cleanup', '--target', 'array', '--cmd', 'echo SNAPSHOT_CLEANUP_OK', '--desc', '测试持久化撤桩', '--config', gatewayConfigPath,
        ])
        assert.equal(JSON.parse(stdout).ok, true)
        workerEntered.resolve()
        await hold.promise
      }
      return {
        summary: 'ok',
        items: [{ target_key: 'R-A', verdict: 'excluded', hits: 'INJ-1=1', evidence_command_ids: ['cmd-0001'], observed_behavior: 'ok', cleanup_verified: true }],
      }
    },
  })
  const server = createServer((req, res) => {
    void environmentRouteHandler(req, res, envStore, ssh, service)
  })
  t.after(async () => {
    hold.resolve()
    await service.dispose()
    await ssh.dispose()
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
    await new Promise(resolve => arraySsh.server.close(resolve))
    await rm(root, { recursive: true, force: true })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const headers = { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }

  const env = await envStore.save({
    id: 'env-batcha',
    name: 'BatchA 环境',
    array: { ip: '127.0.0.1', port: arraySsh.port, username: 'tester', password: 'secret', default_process: 'storage_daemon' },
  })

  // L1b: multiple PIDs -> explicit ambiguity block
  const multiTask = await service.start({
    dataRoot, cwd: root, mode: 'fault_injection', environment_id: env.id,
    provider_id: 'nga', agent_model: 'm', marker_strings: ['M1'],
    targets: [{ target_key: 'R-A', title: 'multi pid', kind: 'risk' }],
  })
  const multiDone = await waitTerminal(service, dataRoot, multiTask.id)
  assert.equal(multiDone.status, 'blocked')
  assert.match(multiDone.error, /多个名为.*1001, 1002/)

  // L5: single PID + grep exit 2 -> permission/unreadable error, NOT missing_markers
  pidStdout = '1001\n'
  grepExit = 2
  const permTask = await service.start({
    dataRoot, cwd: root, mode: 'fault_injection', environment_id: env.id,
    provider_id: 'nga', agent_model: 'm', marker_strings: ['M1'],
    targets: [{ target_key: 'R-A', title: 'perm denied', kind: 'risk' }],
  })
  const permDone = await waitTerminal(service, dataRoot, permTask.id)
  assert.equal(permDone.status, 'blocked')
  assert.match(permDone.error, /无法读取目标二进制/)
  assert.match(permDone.error, /Permission denied/)
  assert.equal(permDone.preflight.missing_markers, undefined)

  // L2 + L3: while running, env edit & delete return 409, registered_cleanups is persisted immediately,
  // and even if envStore.remove() is forced underneath, finally cleanup still runs via snapshotted host
  grepExit = 0
  shouldHold = true
  const liveTask = await service.start({
    dataRoot, cwd: root, mode: 'fault_injection', environment_id: env.id,
    provider_id: 'nga', agent_model: 'm', marker_strings: ['M1'],
    targets: [{ target_key: 'R-A', title: 'live lock', kind: 'risk' }],
  })
  await workerEntered.promise

  // L3: persisted on disk before task completes
  const midRecord = await service.readRecord(dataRoot, liveTask.id)
  assert.equal(midRecord.registered_cleanups.length, 1)
  assert.equal(midRecord.registered_cleanups[0].command, 'echo SNAPSHOT_CLEANUP_OK')

  // L2a: HTTP edit and delete rejected with 409 while locked
  const editRes = await fetch(`${base}/api/pangea-companion/environments`, {
    method: 'POST', headers,
    body: JSON.stringify({ id: env.id, name: '篡改环境', array: { ip: '10.9.9.9', port: 22, username: 'x', password: 'y' } }),
  })
  assert.equal(editRes.status, 409)
  const delRes = await fetch(`${base}/api/pangea-companion/environments?id=${encodeURIComponent(env.id)}`, { method: 'DELETE', headers })
  assert.equal(delRes.status, 409)

  // L2b: even if the environment is removed directly from store, snapshotted host still runs cleanup
  await envStore.remove(env.id)
  hold.resolve()
  const liveDone = await waitTerminal(service, dataRoot, liveTask.id)
  assert.equal(liveDone.status, 'completed', liveDone.error)
  assert.equal(liveDone.cleanup.status, 'ok')
  assert.ok(execLog.includes('echo SNAPSHOT_CLEANUP_OK'), 'finally cleanup must succeed using snapshotted SSH host')

  // L12: lock must be released if start() throws after acquireLocks()
  const env2 = await envStore.save({
    id: 'env-leak-check',
    name: '锁泄漏测试',
    array: { ip: '10.8.8.8', port: 22, username: 'u', password: 'p' },
  })
  const failingService = new LiveVerificationService({
    environments: envStore,
    ssh: { resolve: async () => { throw new Error('boom-resolve') } },
    runWorker: async () => ({ summary: '', items: [] }),
  })
  await assert.rejects(() => failingService.start({
    dataRoot, cwd: root, mode: 'direct_risk', environment_id: env2.id,
    provider_id: 'nga', agent_model: 'm', targets: [{ target_key: 'R-1', title: 't', kind: 'risk' }],
  }), /boom-resolve/)
  assert.deepEqual(failingService.getLocks(), {}, 'locks must be released when start() fails before executeTask')
})

test('Batch C regressions: L10 safety-belt rules, L9 --cmd-file verbatim delivery, L7 single-connection reuse, L8 dynamic budget', async t => {
  // L10: expanded dangerous command rules
  for (const dangerous of [
    'echo c > /proc/sysrq-trigger',
    'ip link set eth0 down',
    'sudo ifdown eth0',
    'pkill -9 sshd',
    'kill -9 1',
  ]) {
    assert.equal(checkDangerousCommand(dangerous).blocked, true, `must block: ${dangerous}`)
  }
  for (const safe of ['echo ok', 'ip addr show', 'kill -USR1 4242']) {
    assert.equal(checkDangerousCommand(safe).blocked, false, `must allow: ${safe}`)
  }

  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-lv-batchc-'))
  const dataRoot = path.join(root, 'pangea-data')
  await mkdir(dataRoot, { recursive: true })

  let sshConnections = 0
  const receivedCommands = []
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const server = new Server({ hostKeys: [privateKey.export({ type: 'pkcs1', format: 'pem' })] }, client => {
    sshConnections += 1
    client.on('authentication', ctx => ctx.accept())
    client.on('ready', () => client.on('session', acceptSession => {
      const session = acceptSession()
      session.on('exec', (acceptExec, _reject, info) => {
        const stream = acceptExec()
        receivedCommands.push(info.command)
        if (info.command.includes('PANGEA_PREFLIGHT_OK')) stream.write('PANGEA_PREFLIGHT_OK\n')
        else if (info.command.includes('pidof')) stream.write('5050\n')
        else stream.write('ok\n')
        stream.exit(0)
        stream.end()
      })
    }))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port

  const envStore = new EnvironmentStore(path.join(root, 'environments.json'))
  const ssh = new PangeaSshRuntime(envStore)
  const verbatimCmd = `printf '%s\\n' "$HOME" 'a|b' | wc -l`
  const targets = [1, 2, 3, 4, 5].map(i => ({ target_key: `R-${i}`, title: `风险 ${i}`, kind: 'risk' }))
  const service = new LiveVerificationService({
    environments: envStore,
    ssh,
    runWorker: async ({ cliPath, gatewayConfigPath, scratchDirectory }) => {
      const cmdFile = path.join(scratchDirectory, 'probe.sh')
      await writeFile(cmdFile, `${verbatimCmd}\n`, 'utf8')
      const r1 = JSON.parse((await execFileAsync(process.execPath, [cliPath, 'exec', '--target', 'array', '--cmd-file', cmdFile, '--config', gatewayConfigPath])).stdout)
      const r2 = JSON.parse((await execFileAsync(process.execPath, [cliPath, 'exec', '--target', 'array', '--cmd', 'echo second', '--config', gatewayConfigPath])).stdout)
      return {
        summary: 'batch c ok',
        items: targets.map(item => ({
          target_key: item.target_key,
          verdict: 'excluded',
          hits: '',
          evidence_command_ids: [r1.command_id, r2.command_id],
          observed_behavior: 'ok',
          cleanup_verified: true,
        })),
      }
    },
  })
  t.after(async () => {
    await service.dispose()
    await ssh.dispose()
    await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  })

  const env = await envStore.save({
    id: 'env-batchc',
    name: 'BatchC 环境',
    array: { ip: '127.0.0.1', port, username: 'tester', password: 'secret', default_process: 'storage_daemon' },
  })
  const started = await service.start({
    dataRoot, cwd: root, mode: 'direct_risk', environment_id: env.id,
    provider_id: 'nga', agent_model: 'm', targets,
  })
  // L8: 5 targets -> 14 + 5*8 = 54 calls
  assert.equal(started.max_gateway_calls, 54)
  const done = await waitTerminal(service, dataRoot, started.id)
  assert.equal(done.status, 'completed', done.error)
  assert.equal(done.gateway_calls_used, 2)
  // L9: verbatim command delivered without shell expansion
  assert.ok(receivedCommands.includes(verbatimCmd), 'exec --cmd-file must deliver exact command text')
  // L7: preflight + 2 worker execs + post_check all reused ONE SSH connection
  assert.equal(sshConnections, 1, `expected 1 reused SSH connection, got ${sshConnections}`)
})

test('Batch D regressions: H2 reference_warnings, H3 display_id normalization & ambiguity 400, H4 case expected_results without risk splicing', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-lv-batchd-'))
  const dataRoot = path.join(root, 'pangea-data')
  await mkdir(dataRoot, { recursive: true })
  const arraySsh = await startMockSshServer({
    onExec: (cmd, stream) => {
      if (cmd.includes('PANGEA_PREFLIGHT_OK')) stream.write('PANGEA_PREFLIGHT_OK\n')
      else stream.write('ok\n')
      stream.exit(0); stream.end()
    },
  })
  const envStore = new EnvironmentStore(path.join(root, 'environments.json'))
  const ssh = new PangeaSshRuntime(envStore)
  let lastInput = null
  const service = new LiveVerificationService({
    environments: envStore,
    ssh,
    runWorker: async ({ inputPath }) => {
      lastInput = JSON.parse(await readFile(inputPath, 'utf8'))
      return {
        summary: 'ok',
        items: lastInput.targets.map(item => ({
          target_key: item.target_key,
          verdict: 'excluded',
          hits: '',
          evidence_command_ids: ['cmd-0001'],
          observed_behavior: 'ok',
          cleanup_verified: true,
        })),
      }
    },
  })
  const fakeRun = {
    run_id: 'run-d',
    details: {
      risks: [
        { risk_id: 'unit-1/r1', display_id: 'R-UNIQUE', title: '唯一风险', severity: 'high', trigger: '触发A', exclusion_condition: '排除A' },
        { risk_id: 'unit-1/r-dup', display_id: 'R-DUP', title: '重复风险1', severity: 'medium' },
        { risk_id: 'unit-2/r-dup', display_id: 'R-DUP', title: '重复风险2', severity: 'medium' },
      ],
      test_cases: [
        { projection_id: 'unit-1/c1', display_id: 'TC-1', title: '用例1', linked_risk_ids: ['unit-1/r1'], expected_results: ['IO 成功', '无泄漏'] },
      ],
    },
  }
  const server = createServer((req, res) => {
    void liveVerificationRouteHandler(req, res, service, null, {}, {
      resolveRoot: async () => dataRoot,
      readRun: async (_root, runId) => {
        if (runId === 'run-missing') throw new Error('run-missing not found')
        return fakeRun
      },
      readRuns: async () => [],
    })
  })
  t.after(async () => {
    await service.dispose()
    await ssh.dispose()
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
    await new Promise(resolve => arraySsh.server.close(resolve))
    await rm(root, { recursive: true, force: true })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const headers = { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }
  const env = await envStore.save({
    id: 'env-batchd',
    name: 'BatchD 环境',
    array: { ip: '127.0.0.1', port: arraySsh.port, username: 'tester', password: 'secret' },
  })

  // H3b: ambiguous display_id across units returns 400
  const dupRes = await fetch(`${base}/api/pangea-companion/live-verification`, {
    method: 'POST', headers,
    body: JSON.stringify({
      action: 'start', mode: 'direct_risk', run_id: 'run-d', environment_id: env.id,
      provider_id: 'nga', agent_model: 'm', targets: [{ target_key: 'R-DUP', kind: 'risk' }],
    }),
  })
  assert.equal(dupRes.status, 400)
  assert.match((await dupRes.json()).error, /重复/)

  // H3a + H4: unique display_id normalizes to canonical risk_id; case keeps expected_results without risk exclusion_condition spliced in
  const okRes = await fetch(`${base}/api/pangea-companion/live-verification`, {
    method: 'POST', headers,
    body: JSON.stringify({
      action: 'start', mode: 'direct_risk', run_id: 'run-d', environment_id: env.id,
      provider_id: 'nga', agent_model: 'm',
      targets: [{ target_key: 'R-UNIQUE', kind: 'risk' }, { target_key: 'TC-1', kind: 'case' }],
    }),
  })
  assert.equal(okRes.status, 202)
  const task1 = (await okRes.json()).task
  const done1 = await waitTerminal(service, dataRoot, task1.id)
  assert.equal(done1.status, 'completed', done1.error)
  assert.equal(lastInput.targets[0].target_key, 'unit-1/r1')
  assert.equal(lastInput.targets[0].display_id, 'R-UNIQUE')
  assert.equal(lastInput.targets[1].target_key, 'unit-1/c1')
  assert.deepEqual(lastInput.targets[1].expected_results, ['IO 成功', '无泄漏'])
  assert.equal(lastInput.targets[1].exclusion_condition, undefined, 'case must NOT silently splice linked risk exclusion_condition')
  assert.equal(lastInput.analysis_context.risks.length, 1)
  assert.equal(lastInput.analysis_context.risks[0].risk_id, 'unit-1/r1')

  // H2: missing run records explicit reference_warnings instead of silently dropping context
  const warnRes = await fetch(`${base}/api/pangea-companion/live-verification`, {
    method: 'POST', headers,
    body: JSON.stringify({
      action: 'start', mode: 'direct_risk', run_id: 'run-missing', environment_id: env.id,
      provider_id: 'nga', agent_model: 'm', targets: [{ target_key: 'R-1', kind: 'risk' }],
    }),
  })
  assert.equal(warnRes.status, 202)
  const task2 = (await warnRes.json()).task
  const done2 = await waitTerminal(service, dataRoot, task2.id)
  assert.equal(done2.status, 'completed', done2.error)
  assert.equal(done2.reference_warnings.length, 1)
  assert.match(done2.reference_warnings[0], /run-missing/)
})

test('Live verification GET exposes real pangea-* ACP providers and start validates via requireAgentModel', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'live-verify-acp-'))
  const dataRoot = path.join(root, 'pangea-data')
  await mkdir(dataRoot, { recursive: true })
  await mkdir(path.join(root, '.agents', 'pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents', 'pangea', 'dsh.md'), '# test workspace\n')
  const arraySsh = await startMockSshServer({
    onExec: (cmd, stream) => {
      stream.write(cmd.includes('PANGEA_PREFLIGHT_OK') ? 'PANGEA_PREFLIGHT_OK\n' : 'ok\n')
      stream.exit(0)
      stream.end()
    },
  })
  const envStore = new EnvironmentStore(path.join(root, 'environments.json'))
  const ssh = new PangeaSshRuntime(envStore)
  const runtime = {
    subagents: {
      getProvider: id => id === 'pangea-nga' ? {
        discoverModels: async () => ({
          current_model: 'nga-default',
          models: [{ id: 'nga-default', label: 'NGA Default' }, { id: 'nga-fast', label: 'NGA Fast' }],
        }),
      } : undefined,
    },
  }
  const service = new LiveVerificationService({
    environments: envStore,
    ssh,
    validateModel: options => requireAgentModel(runtime, options),
    runWorker: async () => ({
      summary: 'ok',
      items: [{ target_key: 'R-1', verdict: 'confirmed', evidence_command_ids: ['cmd-0001'], observed_behavior: 'ok', cleanup_verified: true }],
    }),
  })
  const server = createServer((req, res) => {
    void liveVerificationRouteHandler(req, res, service, null, runtime, { resolveRoot: async () => dataRoot })
  })
  t.after(async () => {
    await service.dispose()
    await ssh.dispose()
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
    await new Promise(resolve => arraySsh.server.close(resolve))
    await rm(root, { recursive: true, force: true })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const headers = { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }

  const listRes = await fetch(`${base}/api/pangea-companion/live-verification`, { headers })
  assert.equal(listRes.status, 200)
  const listBody = await listRes.json()
  assert.deepEqual(listBody.providers.map(p => ({ id: p.id, registered: p.registered })), [
    { id: 'pangea-nga', registered: true },
    { id: 'pangea-codeagent', registered: false },
    { id: 'pangea-opencode', registered: false },
  ])

  const env = await envStore.save({
    id: 'env-acp',
    name: 'ACP 校验环境',
    array: { ip: '127.0.0.1', port: arraySsh.port, username: 'tester', password: 'secret' },
  })

  // Short alias 'nga' must still be rejected by requireExternalAnalysisProvider
  const badRes = await fetch(`${base}/api/pangea-companion/live-verification`, {
    method: 'POST', headers,
    body: JSON.stringify({
      action: 'start', cwd: root, mode: 'direct_risk', environment_id: env.id,
      provider_id: 'nga', agent_model: '', targets: [{ target_key: 'R-1', kind: 'risk' }],
    }),
  })
  assert.equal(badRes.status, 400)
  assert.match((await badRes.json()).error, /未知的 ACP 执行 Agent：nga/)

  // Real provider ID 'pangea-nga' with empty agent_model resolves and persists concrete default model
  const okRes = await fetch(`${base}/api/pangea-companion/live-verification`, {
    method: 'POST', headers,
    body: JSON.stringify({
      action: 'start', cwd: root, mode: 'direct_risk', environment_id: env.id,
      provider_id: 'pangea-nga', agent_model: '', targets: [{ target_key: 'R-1', kind: 'risk' }],
    }),
  })
  assert.equal(okRes.status, 202)
  const started = (await okRes.json()).task
  assert.equal(started.provider_id, 'pangea-nga')
  assert.equal(started.agent_model, 'nga-default')
  const done = await waitTerminal(service, dataRoot, started.id)
  assert.equal(done.status, 'completed', done.error)
})
