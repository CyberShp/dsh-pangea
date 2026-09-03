import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { AcpSettingsStore } from '../src/acp-settings.js'

test('persists a validated external Agent model and effort catalog atomically', async () => {
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
          models: [{ id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', efforts: ['medium', 'high'] }],
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

test('rejects malformed model catalogs before changing the settings file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-acp-settings-invalid-'))
  try {
    const store = new AcpSettingsStore({ filePath: path.join(root, 'acp-runtime-v1.json') })
    await assert.rejects(() => store.save({
      version: 1,
      providers: { 'pangea-nga': { command: 'nga', args: ['acp'], models: [{ id: '', efforts: [] }] } },
    }), /模型缺少 id/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
