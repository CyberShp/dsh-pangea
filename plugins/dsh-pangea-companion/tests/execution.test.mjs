import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import ssh2 from 'ssh2'

import { EnvironmentStore } from '../src/execution/environment.js'
import { PangeaSshRuntime, checkDangerousCommand } from '../src/execution/ssh.js'

const { Server } = ssh2

test('environment store encrypts passwords at rest, redacts public reads, preserves password on edit, and migrates v2', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-environments-'))
  try {
    const file = path.join(root, 'environments.json')
    const store = new EnvironmentStore(file)
    const saved = await store.save({
      id: 'lab-a',
      name: '实验室 A',
      host: { ip: '10.0.0.10', port: 22, username: 'tester', password: 'super-secret-password' },
      array: { ip: '10.0.0.20', port: 22, username: 'admin', password: 'array-secret-password', default_process: 'storage_daemon' },
    })
    assert.equal(saved.host.has_password, true)
    assert.equal(saved.host.password, undefined)
    assert.equal(saved.host.password_encrypted, undefined)
    assert.equal(saved.array.default_process, 'storage_daemon')

    const onDisk = await readFile(file, 'utf8')
    assert.doesNotMatch(onDisk, /super-secret-password/)
    assert.doesNotMatch(onDisk, /array-secret-password/)

    const resolved = await store.getResolved('lab-a')
    assert.equal(resolved.host.password, 'super-secret-password')
    assert.equal(resolved.array.password, 'array-secret-password')

    // Editing name without re-sending password preserves encrypted secret
    const updated = await store.save({
      id: 'lab-a',
      name: '实验室 A-更新',
      host: { ip: '10.0.0.10', port: 22, username: 'tester' },
      array: { ip: '10.0.0.20', port: 22, username: 'admin', default_process: 'storage_daemon' },
    })
    assert.equal(updated.name, '实验室 A-更新')
    assert.equal((await store.getResolved('lab-a')).host.password, 'super-secret-password')

    // Legacy v2 plaintext file auto-migrates to v3 encrypted on read
    const v2File = path.join(root, 'legacy-v2.json')
    await writeFile(v2File, JSON.stringify({
      version: 2,
      environments: [{
        id: 'legacy-1',
        name: '旧环境',
        host: { ip: '10.0.0.30', port: 22, username: 'u', password: 'plain-v2-password' },
        array: null,
      }],
    }), 'utf8')
    const legacyStore = new EnvironmentStore(v2File)
    const migratedList = await legacyStore.list()
    assert.equal(migratedList[0].host.has_password, true)
    assert.equal(migratedList[0].host.password, undefined)
    assert.doesNotMatch(await readFile(v2File, 'utf8'), /plain-v2-password/)
    assert.equal((await legacyStore.getResolved('legacy-1')).host.password, 'plain-v2-password')

    assert.equal(await store.remove('lab-a'), true)
    assert.equal((await store.list()).length, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('dangerous command guard blocks destructive system commands while allowing L1/L2 fault injection actions', () => {
  for (const dangerous of [
    'reboot',
    'sudo poweroff',
    'echo ok && shutdown -r now',
    'mkfs.ext4 /dev/sdb',
    'dd if=/dev/zero of=/dev/sda bs=1M count=1',
    'rm -rf /',
    'rm -rf /etc',
    'sysupgrade firmware.bin',
  ]) {
    assert.equal(checkDangerousCommand(dangerous).blocked, true, `expected blocked: ${dangerous}`)
  }
  for (const allowed of [
    'echo 1 > /dev/shm/pangea_stub_01',
    'rm -f /dev/shm/pangea_stub_01',
    'dd if=/dev/zero of=/dev/nvme0n1 bs=1M count=1',
    'ip link set ens2f0 down',
    'kill -TERM 4242',
    'diagnose_usr',
    'grep -aFq -- "PANGEA_MARKER" /proc/4242/exe',
  ]) {
    assert.equal(checkDangerousCommand(allowed).blocked, false, `expected allowed: ${allowed}`)
  }
})

test('password SSH executes commands, controls a background job, and keeps one interactive PTY', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-ssh-'))
  const previousDshHome = process.env.DSH_HOME
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const server = new Server({ hostKeys: [privateKey.export({ type: 'pkcs1', format: 'pem' })] }, client => {
    client.on('authentication', context => {
      if (context.method === 'password' && context.username === 'tester' && context.password === 'secret') context.accept()
      else context.reject()
    })
    client.on('ready', () => client.on('session', acceptSession => {
      const session = acceptSession()
      session.on('pty', acceptPty => acceptPty())
      session.on('exec', (acceptExec, _reject, info) => {
        const stream = acceptExec()
        if (info.command === 'echo ready') {
          stream.write('ready\n')
          stream.exit(0)
          stream.end()
          return
        }
        stream.write('started\n')
        stream.on('signal', () => {
          stream.exit(130)
          stream.end()
        })
      })
      session.on('shell', acceptShell => {
        const stream = acceptShell()
        let input = ''
        stream.on('data', chunk => {
          input += chunk.toString('utf8')
          while (input.includes('\n')) {
            const index = input.indexOf('\n')
            const line = input.slice(0, index).replace(/\r$/, '')
            input = input.slice(index + 1)
            if (line === 'diagnose_usr') stream.write('diag> ')
            else if (line === 'attach xx') stream.write('attach> ')
            else if (line === 'dtoe chiperr') stream.write('chiperr ok\n')
          }
        })
      })
    }))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.equal(typeof address, 'object')
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, 'dsh-ssh.json'), `${JSON.stringify({ version: 1, hosts: [{
    alias: 'lab-host', host: '127.0.0.1', port: address.port, user: 'tester',
    auth: { kind: 'password', password: 'secret' }, proxyJump: [], tags: [], createdAt: 1, updatedAt: 1,
  }] })}\n`, 'utf8')
  process.env.DSH_HOME = root
  const runtime = new PangeaSshRuntime()
  try {
    const executed = await runtime.exec('lab-host', 'echo ready', 5000)
    assert.equal(executed.success, true)
    assert.equal(executed.exit_code, 0)
    assert.match(executed.stdout, /ready/)

    const blocked = await runtime.exec('lab-host', 'reboot', 5000, { guard: true })
    assert.equal(blocked.success, false)
    assert.equal(blocked.blocked, true)

    const started = await runtime.start('lab-host', 'long-running-io', { ownerId: 'owner-1' })
    assert.equal(started.running, true)
    assert.equal(typeof started.job_id, 'string')
    await runtime.disposeOwner('owner-1')
    const afterDispose = await runtime.read(started.job_id)
    assert.equal(afterDispose.running, false)
    assert.equal(afterDispose.stopped, true)

    const interactive = await runtime.interactive('lab-host', [
      { send: 'diagnose_usr', expect: 'diag>', timeout_seconds: 2 },
      { send: 'attach xx', expect: 'attach>', timeout_seconds: 2 },
      { send: 'dtoe chiperr', expect: 'chiperr ok', timeout_seconds: 2 },
    ])
    assert.equal(interactive.success, true)
    assert.match(interactive.stdout, /diag>/)
    assert.match(interactive.stdout, /chiperr ok/)
  } finally {
    await runtime.dispose()
    await new Promise(resolve => server.close(resolve))
    if (previousDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousDshHome
    await rm(root, { recursive: true, force: true })
  }
})
