import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { hasPositiveHitCount, validateVerificationResult, LiveVerificationService } from '../src/live-verification.js'
import { EnvironmentStore } from '../src/execution/environment.js'
import { syncEnvironmentsToTopologyStore, getPangeaVerifyBridgeStatus, resolvePangeaVerifyRoot } from '../src/pangea-verify-bridge.js'

const PANGEA_VERIFY_ROOT = resolvePangeaVerifyRoot() || path.resolve(import.meta.dirname, '../../../../pangea-verify')

test('#18 hasPositiveHitCount ignores retries/metadata keys and honors pointIds', () => {
  assert.equal(hasPositiveHitCount('hits=0; retries=1'), false)
  assert.equal(hasPositiveHitCount('A=0, retries=3, duration_ms=120'), false)
  assert.equal(hasPositiveHitCount('A=0, B=0', { pointIds: ['A', 'B'] }), false)
  assert.equal(hasPositiveHitCount('A=0, B=2, retries=1', { pointIds: ['A', 'B'] }), true)
  assert.equal(hasPositiveHitCount('other=5', { pointIds: ['A'] }), false)

  const check = validateVerificationResult(
    { items: [{ target_key: 'u1/c1', verdict: 'excluded', hits: 'hits=0; retries=1', evidence_command_ids: ['cmd-1'] }] },
    { targetKeys: ['u1/c1'], validCommandIds: new Set(['cmd-1']), requireNonZeroHits: true },
  )
  assert.equal(check.ok, true)
})

test('#16 blocked preflight record cannot be confirmed/synced as excluded/passed with zero evidence', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-audit16-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const verifyDir = path.join(root, '.pangea', 'live-verification', 'lv-blocked')
  await mkdir(verifyDir, { recursive: true })
  const record = {
    id: 'lv-blocked',
    mode: 'fault_injection',
    status: 'blocked',
    run_id: 'run-1',
    fault_injection_task_id: 'fi-1',
    preflight: { ok: false, error: 'binary marker missing' },
    targets: [{ target_key: 'unit-0001/rec-000001', case_key: 'unit-0001/rec-000001', source_run_id: 'run-1', source_fi_task_id: 'fi-1' }],
    draft_verdicts: [{ target_key: 'unit-0001/rec-000001', verdict: 'blocked', hits: '', evidence_command_ids: [] }],
  }
  await writeFile(path.join(verifyDir, 'record.json'), JSON.stringify(record, null, 2))

  const service = new LiveVerificationService({})
  let writebacks = 0
  const fakeFi = { recordVerification: async () => { writebacks += 1 } }

  await assert.rejects(
    () => service.confirm({
      dataRoot: root,
      verifyId: 'lv-blocked',
      verdicts: [{ target_key: 'unit-0001/rec-000001', verdict: 'excluded', hits: '', evidence_command_ids: [] }],
      sync_to_fault_injection: true,
      faultInjectionService: fakeFi,
    }),
    /预检已阻断/,
  )
  assert.equal(writebacks, 0)

  // Confirming as blocked preserves blocked status
  const kept = await service.confirm({
    dataRoot: root,
    verifyId: 'lv-blocked',
    verdicts: [{ target_key: 'unit-0001/rec-000001', verdict: 'blocked', hits: '', evidence_command_ids: [], notes: 'env blocked' }],
    sync_to_fault_injection: false,
  })
  assert.equal(kept.status, 'blocked')
})

test('#17 fused package with same case_key across two Runs keeps distinct identities and writes back to both tasks', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-audit17-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const verifyDir = path.join(root, '.pangea', 'live-verification', 'lv-fused')
  await mkdir(verifyDir, { recursive: true })
  const record = {
    id: 'lv-fused',
    mode: 'fault_injection',
    status: 'completed',
    run_id: 'run-1',
    fault_injection_build_id: 'build-fused',
    preflight: { ok: true, baseline: { binary_path: '/opt/app' } },
    targets: [
      { target_key: 'run-1::fi-1::unit-0001/rec-000001', case_key: 'unit-0001/rec-000001', source_run_id: 'run-1', source_fi_task_id: 'fi-1' },
      { target_key: 'run-2::fi-2::unit-0001/rec-000001', case_key: 'unit-0001/rec-000001', source_run_id: 'run-2', source_fi_task_id: 'fi-2' },
    ],
  }
  await writeFile(path.join(verifyDir, 'record.json'), JSON.stringify(record, null, 2))

  // Also check validateVerificationResult accepts both distinct composite keys
  const validated = validateVerificationResult(
    {
      items: [
        { target_key: 'run-1::fi-1::unit-0001/rec-000001', verdict: 'excluded', hits: 'A=1', evidence_command_ids: ['c1'] },
        { target_key: 'run-2::fi-2::unit-0001/rec-000001', verdict: 'confirmed', hits: 'A=2', evidence_command_ids: ['c2'] },
      ],
    },
    { targetKeys: record.targets.map(item => item.target_key), validCommandIds: new Set(['c1', 'c2']), requireNonZeroHits: true },
  )
  assert.equal(validated.ok, true)

  const calls = []
  const fakeFi = {
    recordVerification: async (_dataRoot, runId, taskId, payload) => {
      calls.push({ runId, taskId, payload })
    },
  }
  const service = new LiveVerificationService({})
  await service.confirm({
    dataRoot: root,
    verifyId: 'lv-fused',
    verdicts: validated.value.items,
    sync_to_fault_injection: true,
    faultInjectionService: fakeFi,
  })
  assert.equal(calls.length, 2)
  assert.equal(calls[0].runId, 'run-1')
  assert.equal(calls[0].taskId, 'fi-1')
  assert.equal(calls[0].payload.build_id, 'build-fused')
  assert.equal(calls[0].payload.verification.case_key, 'unit-0001/rec-000001')
  assert.equal(calls[0].payload.verification.result, 'passed')

  assert.equal(calls[1].runId, 'run-2')
  assert.equal(calls[1].taskId, 'fi-2')
  assert.equal(calls[1].payload.build_id, 'build-fused')
  assert.equal(calls[1].payload.verification.case_key, 'unit-0001/rec-000001')
  assert.equal(calls[1].payload.verification.result, 'failed')
})

test('#20 renaming environment preserves unedited protected, test_resources, and default_log_paths', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-audit20-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = new EnvironmentStore(path.join(root, 'environments.json'))

  const created = await store.save({
    id: 'env-lab-1',
    name: 'Lab Original',
    array: {
      ip: '127.0.0.1',
      port: 22,
      username: 'tester',
      auth_kind: 'password',
      password: 'secret',
      default_process: 'storage_d',
      default_log_paths: ['/var/log/storage.log'],
      protected: { mgmt_ips: ['10.0.0.1'], mgmt_nics: ['eth0'], boot_disks: ['/dev/sda'] },
      test_resources: { data_nics: ['eth1'], data_ips: ['10.1.0.1'], block_devices: ['/dev/sdb'], processes: ['storage_d'], paths: ['/tmp/test'], allow_reboot: false },
    },
  })

  // Edit only name (omitting protected, test_resources, default_log_paths)
  const renamed = await store.save({
    id: created.id,
    name: 'Lab Renamed',
    array: {
      ip: '127.0.0.1',
      port: 22,
      username: 'tester',
      auth_kind: 'password',
      default_process: 'storage_d',
    },
  })
  assert.equal(renamed.name, 'Lab Renamed')
  assert.deepEqual(renamed.array.protected, { mgmt_ips: ['10.0.0.1'], mgmt_nics: ['eth0'], boot_disks: ['/dev/sda'] })
  assert.deepEqual(renamed.array.test_resources.block_devices, ['/dev/sdb'])
  assert.deepEqual(renamed.array.default_log_paths, ['/var/log/storage.log'])
})

test('#21 deleting an environment prunes its bridged topology while preserving standalone topologies', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-audit21-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const envStore = new EnvironmentStore(path.join(root, 'environments.json'))
  const topoPath = path.join(root, 'topologies.json')

  const { TopologyStore } = await import(pathToFileURL(path.join(PANGEA_VERIFY_ROOT, 'src', 'index.js')).href)
  const topoStore = new TopologyStore(topoPath)
  await topoStore.save({
    id: 'standalone-topo',
    name: 'Manual Import',
    nodes: {
      host_a: { role: 'host', ssh: { ip: '127.0.0.1', port: 22, username: 'u', auth_kind: 'password', password: 'p' } },
    },
    vars: {},
  })

  await envStore.save({
    id: 'env-temp',
    name: 'Temp Lab',
    host: { ip: '127.0.0.1', port: 22, username: 'u', auth_kind: 'password', password: 'p' },
  })
  const firstSync = await syncEnvironmentsToTopologyStore(envStore, topoPath, { moduleRoot: PANGEA_VERIFY_ROOT })
  assert.equal(firstSync.synced, 1)
  assert.equal((await topoStore.list()).length, 2)

  // Delete environment and sync again -> bridged topology removed, standalone kept
  await envStore.remove('env-temp')
  const secondSync = await syncEnvironmentsToTopologyStore(envStore, topoPath, { moduleRoot: PANGEA_VERIFY_ROOT })
  assert.equal(secondSync.synced, 0)
  assert.equal(secondSync.pruned, 1)
  const remaining = await topoStore.list()
  assert.deepEqual(remaining.map(item => item.id), ['standalone-topo'])
})

test('#22 corrupt catalog.json reports lint_ok=false and names catalog.json instead of healthy empty pack', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-audit22-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const emptyPack = path.join(root, 'empty-pack')
  await mkdir(emptyPack, { recursive: true })
  const emptyStatus = await getPangeaVerifyBridgeStatus({ packDir: emptyPack, moduleRoot: PANGEA_VERIFY_ROOT })
  assert.equal(emptyStatus.lint_ok, true)
  assert.equal(emptyStatus.catalog_corrupted, false)
  assert.equal(emptyStatus.verified_card_count, 0)

  const corruptPack = path.join(root, 'corrupt-pack')
  await mkdir(corruptPack, { recursive: true })
  await writeFile(path.join(corruptPack, 'catalog.json'), '{ "cards": [ broken json', 'utf8')
  const corruptStatus = await getPangeaVerifyBridgeStatus({ packDir: corruptPack, moduleRoot: PANGEA_VERIFY_ROOT })
  assert.equal(corruptStatus.lint_ok, false)
  assert.equal(corruptStatus.catalog_corrupted, true)
  assert.equal(corruptStatus.verified_card_count, null)
  assert.match(corruptStatus.lint_errors.join(' '), /catalog\.json/)
})
