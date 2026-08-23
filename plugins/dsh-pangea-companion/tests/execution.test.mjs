import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import ssh2 from 'ssh2'

import { EnvironmentStore } from '../src/execution/environment.js'
import { launchExecution } from '../src/execution/launch.js'
import { PangeaSshRuntime } from '../src/execution/ssh.js'

const { Server } = ssh2

test('environment store keeps host array automation and bindings together', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-environments-'))
  try {
    const store = new EnvironmentStore(path.join(root, 'environments.json'))
    await store.save({
      id: 'lab-a', name: '实验室 A', host_alias: 'host-a', array_alias: 'array-a',
      automation_id: 'storage-tests', bindings: { portal: '10.0.0.2', attach_target: '0x12' },
    })
    assert.deepEqual(await store.get('lab-a'), {
      id: 'lab-a', name: '实验室 A', host_alias: 'host-a', array_alias: 'array-a',
      automation_id: 'storage-tests', bindings: { portal: '10.0.0.2', attach_target: '0x12' },
    })
    await store.save({
      id: 'lab-a', name: '实验室 A-更新', host_alias: 'host-a', array_alias: 'array-a',
      automation_id: 'storage-tests', bindings: {},
    })
    assert.equal((await store.list()).length, 1)
    assert.equal((await store.get('lab-a')).name, '实验室 A-更新')
    assert.equal(await store.remove('lab-a'), true)
    assert.equal((await store.list()).length, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('one-click launch creates and prompts a real DSH execution session', async () => {
  const calls = []
  const ok = value => ({ result: { ok: true, value } })
  const api = { sessions: {
    create: async request => { calls.push(['create', request.payload]); return ok({ sessionId: 'session-executor-1' }) },
    rename: async request => { calls.push(['rename', request.payload]); return ok({}) },
    prompt: async request => { calls.push(['prompt', request.payload]); return ok({}) },
  } }
  const result = await launchExecution(api, {
    workspace_id: 'workspace-a', analysis_run_id: 'analysis-1', test_case_ids: ['TC-1', 'TC-2'],
    data_root: '/work/pangea-data', environment_id: 'lab-a',
  }, {
    id: 'lab-a', name: '实验室 A', automation_id: 'storage-tests',
  })
  assert.equal(result.session_id, 'session-executor-1')
  assert.deepEqual(calls.map(([name]) => name), ['create', 'rename', 'prompt'])
  assert.equal(calls[0][1].workspaceId, 'workspace-a')
  const prompt = calls[2][1].content[0].text
  assert.match(prompt, /analysis-1/)
  assert.match(prompt, /TC-1, TC-2/)
  assert.match(prompt, /executor-dsh\.md/)
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

    const started = await runtime.start('lab-host', 'long-running-io')
    assert.equal(started.running, true)
    assert.equal(typeof started.job_id, 'string')
    const stopped = await runtime.stop(started.job_id)
    assert.equal(stopped.running, false)
    assert.equal(stopped.stopped, true)
    assert.match(stopped.stdout, /started/)

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
