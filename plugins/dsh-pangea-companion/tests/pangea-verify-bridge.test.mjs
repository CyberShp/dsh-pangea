import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ssh2 from 'ssh2'
import { EnvironmentStore } from '../src/execution/environment.js'
import { PangeaSshRuntime } from '../src/execution/ssh.js'
import { LiveVerificationService } from '../src/live-verification.js'
import { liveVerificationRouteHandler } from '../src/index.js'
import {
  getPangeaVerifyBridgeStatus,
  loadPangeaVerify,
} from '../src/pangea-verify-bridge.js'

const { Server: SshServer } = ssh2

async function startMockSsh() {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  })
  const server = new SshServer({ hostKeys: [privateKey] }, client => {
    client.on('error', () => {})
    client.on('authentication', ctx => ctx.accept())
    client.on('ready', () => {
      client.on('session', accept => {
        const session = accept()
        session.on('exec', (acceptExec, _reject, info) => {
          const stream = acceptExec()
          if (info.command.includes('PANGEA_PREFLIGHT_OK')) stream.write('PANGEA_PREFLIGHT_OK\n')
          else stream.write(`ok:${info.command}\n`)
          stream.exit(0)
          stream.end()
        })
      })
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    port: server.address().port,
    close: () => new Promise(resolve => server.close(() => resolve())),
  }
}

test('Companion thin bridge injects read-only pangea-verify Knowledge Pack into LiveVerificationService and records Gate-4 feedback', async () => {
  const loaded = await loadPangeaVerify()
  assert.ok(loaded?.mod, 'expected sibling pangea-verify engine to be discoverable')

  const tempDir = await mkdtemp(path.join(tmpdir(), 'companion-pv-bridge-'))
  const sshSrv = await startMockSsh()
  try {
    const packDir = path.join(tempDir, 'intranet-kp')
    const dataRoot = path.join(tempDir, 'pangea-data')
    const pack = new loaded.mod.KnowledgePack(packDir)

    // Seed 1 formal attested card + 1 isolated draft card + 1 white-box CLI map
    await pack.saveDraft({
      id: 'raid.state.check',
      title: 'RAID 状态只读检查',
      domain: 'raid',
      intent: '检查阵列当前重构与降级状态',
      source_modules: ['src/raid'],
      required_roles: ['controller'],
      side_effect: 'readonly',
      execute: 'raid_cli show status',
      verify_effect: 'grep -q state',
    })
    await pack.attestCard({
      cardId: 'raid.state.check',
      attestedBy: 'qa-lead',
      reason: '只读查询命令已在实验室手册核对',
    })

    await pack.saveDraft({
      id: 'raid.unverified.draft',
      title: '未验证草稿命令',
      domain: 'raid',
      intent: '尚未实测的草稿命令不应进入无人值守跑批',
      source_modules: ['src/raid'],
      required_roles: ['controller'],
      side_effect: 'readonly',
      execute: 'raid_cli experimental',
      verify_effect: 'echo ok',
    })

    await loaded.mod.saveCodeMap(packDir, 'storage-core', {
      schema_version: 1,
      modules: {
        'src/raid': [{ kind: 'c_cli_macro', command: 'raid show rebuild', file: 'src/raid/cli.c', line: 12 }],
      },
    })

    // Verify bridge status endpoint reports engine availability & MCP command hint
    const bridgeStatus = await getPangeaVerifyBridgeStatus({ packDir })
    assert.equal(bridgeStatus.available, true)
    assert.equal(bridgeStatus.verified_card_count, 1)
    assert.match(bridgeStatus.mcp_command_hint, /\bmcp\b/)

    const envStore = new EnvironmentStore(path.join(tempDir, 'environments.json'), { platform: 'linux' })
    const env = await envStore.save({
      name: 'Lab Array',
      array: { ip: '127.0.0.1', port: sshSrv.port, username: 'root', auth_kind: 'password', password: 'pw' },
    })
    const sshRuntime = new PangeaSshRuntime(envStore)

    let capturedInput = null
    let capturedPrompt = ''
    const service = new LiveVerificationService({
      environments: envStore,
      ssh: sshRuntime,
      runWorker: async ({ inputPath, prompt, gatewayUrl, gatewayToken }) => {
        capturedInput = JSON.parse(await readFile(inputPath, 'utf8'))
        capturedPrompt = prompt
        const execResp = await fetch(`${gatewayUrl}/exec`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gatewayToken}` },
          body: JSON.stringify({ target: 'array', command: 'raid_cli show status' }),
        })
        const execData = await execResp.json()
        return {
          summary: '已通过知识包复用卡片完成核验',
          items: [{
            target_key: 'RISK-RAID-01',
            verdict: 'excluded',
            hits: '',
            evidence_command_ids: [execData.command_id],
            observed_behavior: '状态正常',
            cleanup_verified: true,
          }],
          card_feedback: [{
            card_id: 'raid.state.check',
            command_id: execData.command_id,
            error_summary: 'V7 firmware renamed output key state -> health_state',
            firmware_hint: 'V7.1',
          }],
        }
      },
    })

    // Check GET route includes verify_engine metadata
    let routePayload = null
    const mockReq = { method: 'GET', url: '/api/pangea-companion/live-verification', headers: { host: 'localhost', origin: 'http://localhost' } }
    const mockRes = {
      statusCode: 0,
      headers: {},
      writeHead(code, headers) { this.statusCode = code; this.headers = headers },
      end(body) { routePayload = JSON.parse(body) },
    }
    await liveVerificationRouteHandler(mockReq, mockRes, service, null, null, { resolveRoot: async () => dataRoot })
    assert.equal(mockRes.statusCode, 200)
    assert.equal(routePayload.verify_engine.available, true)

    const attestedBefore = await readFile(pack.cardPath('attested', 'raid.state.check'), 'utf8')
    const started = await service.start({
      dataRoot,
      mode: 'direct_risk',
      environment_id: env.id,
      knowledge_pack_dir: packDir,
      targets: [{
        target_key: 'RISK-RAID-01',
        title: 'RAID 状态切换风险',
        kind: 'risk',
        source_evidence: ['repo:src/raid/rebuild.c:88'],
      }],
    })

    // Wait for background run completion
    const active = [...service.active.values()][0]
    if (active) await active.done
    const finalRecord = await service.readRecord(dataRoot, started.id)

    assert.equal(finalRecord.status, 'completed')
    assert.equal(finalRecord.knowledge_pack_dir, packDir)
    assert.equal(capturedInput.knowledge_catalog.cards.length, 1)
    assert.equal(capturedInput.knowledge_catalog.cards[0].id, 'raid.state.check')
    assert.equal(capturedInput.knowledge_catalog.code_cli_hints.length, 1)
    assert.equal(capturedInput.knowledge_catalog.code_cli_hints[0].command, 'raid show rebuild')
    assert.match(capturedPrompt, /Knowledge Pack/)

    // Gate 4: feedback logged without modifying formal card
    assert.equal(finalRecord.recorded_card_feedback.length, 1)
    const attestedAfter = await readFile(pack.cardPath('attested', 'raid.state.check'), 'utf8')
    assert.equal(attestedAfter, attestedBefore)
    const fb = await pack.readFeedback('raid.state.check')
    assert.equal(fb.length, 1)
    assert.match(fb[0].error_summary, /health_state/)
  } finally {
    await sshSrv.close()
    await rm(tempDir, { recursive: true, force: true })
  }
})
