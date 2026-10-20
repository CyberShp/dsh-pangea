import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { AcpSettingsStore } from '../src/acp-settings.js'

test('persists external Agent command settings atomically', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-acp-settings-'))
  const filePath = path.join(root, 'acp-runtime-v1.json')
  const previous = process.env.PANGEA_ACP_RUNTIME_CONFIG
  try {
    const store = new AcpSettingsStore({ filePath })
    const config = {
      version: 1,
      providers: {
        'pangea-opencode': {
          command: 'C:\\Tools\\opencode.exe', args: ['acp'],
        },
      },
    }
    assert.deepEqual(await store.read(), { version: 1, providers: {} })
    assert.deepEqual(await store.save(config), config)
    assert.deepEqual(await store.read(), config)
    assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), config)
    assert.deepEqual(JSON.parse(process.env.PANGEA_ACP_RUNTIME_CONFIG), config)
  } finally {
    if (previous === undefined) delete process.env.PANGEA_ACP_RUNTIME_CONFIG
    else process.env.PANGEA_ACP_RUNTIME_CONFIG = previous
    await rm(root, { recursive: true, force: true })
  }
})

test('tolerates a legacy model catalog without making it part of provider validation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-acp-settings-invalid-'))
  try {
    const store = new AcpSettingsStore({ filePath: path.join(root, 'acp-runtime-v1.json') })
    const legacy = {
      version: 1,
      providers: { 'pangea-nga': { command: 'nga', args: ['acp'], models: [{ id: '', efforts: [] }] } },
    }
    const upgraded = structuredClone(legacy)
    upgraded.providers['pangea-nga'].args.push('--skip-safe-check')
    assert.deepEqual(await store.save(legacy), upgraded)
    assert.deepEqual(await store.read(), upgraded)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('legacy stored and inherited NGA/CodeAgent commands gain one trust flag without changing other executors or saved history', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-acp-upgrade-'))
  const previous = process.env.PANGEA_ACP_RUNTIME_CONFIG
  try {
    const filePath = path.join(root, 'acp-runtime-v1.json')
    const store = new AcpSettingsStore({ filePath })
    const legacy = { version: 1, providers: {
      'pangea-nga': { command: 'C:\\Tools\\nga.cmd', args: ['acp', '--profile', 'local'] },
      'pangea-codeagent': { command: 'codeagent', args: ['--skip-safe-check', 'acp', '--skip-safe-check', '--', '--skip-safe-check', ' workspace \n'] },
      'pangea-opencode': { command: 'opencode', args: ['acp', '--', 'workspace'] },
      'pangea-claude-code': { command: 'claude', args: [], legacy_note: 'preserved' },
    } }
    await writeFile(filePath, JSON.stringify(legacy))
    const check = config => {
      assert.deepEqual(config.providers['pangea-nga'].args, ['acp', '--profile', 'local', '--skip-safe-check'])
      assert.deepEqual(config.providers['pangea-codeagent'].args, ['acp', '--skip-safe-check', '--', '--skip-safe-check', ' workspace \n'])
      assert.deepEqual(config.providers['pangea-opencode'], legacy.providers['pangea-opencode'])
      assert.deepEqual(config.providers['pangea-claude-code'], legacy.providers['pangea-claude-code'])
    }
    check(await store.read())
    assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), legacy, 'reading must not rewrite the source file')
    delete process.env.PANGEA_ACP_RUNTIME_CONFIG
    check(store.loadIntoEnvironment())
    check(JSON.parse(process.env.PANGEA_ACP_RUNTIME_CONFIG))
    process.env.PANGEA_ACP_RUNTIME_CONFIG = JSON.stringify(legacy)
    check(store.loadIntoEnvironment())
    check(JSON.parse(process.env.PANGEA_ACP_RUNTIME_CONFIG))
    const saved = await store.save(legacy)
    check(saved)
    check(await store.save(saved))
    check(JSON.parse(await readFile(filePath, 'utf8')))
  } finally {
    if (previous === undefined) delete process.env.PANGEA_ACP_RUNTIME_CONFIG
    else process.env.PANGEA_ACP_RUNTIME_CONFIG = previous
    await rm(root, { recursive: true, force: true })
  }
})
