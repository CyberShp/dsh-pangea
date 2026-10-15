import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { AgentSessionStore, isAgentSessionPathInside } from '../src/agent-sessions.js'

const meta = { provider: 'pangea-codeagent', agent_session_id: 'worker-1', remote_session_id: 'remote-1' }

async function fixture(t) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-session-paths-'))
  await mkdir(path.join(dataRoot, 'runs', 'r1'), { recursive: true })
  t.after(() => rm(dataRoot, { recursive: true, force: true }))
  return { dataRoot, runId: 'r1' }
}

test('Windows path boundaries accept casing differences but reject sibling runs, drives and shares', () => {
  const root = String.raw`D:\a\Run\agent-sessions`
  for (const target of [String.raw`d:\A\run\agent-sessions`, String.raw`d:\A\RUN\agent-sessions\new.jsonl`, 'd:/A/Run/agent-sessions/new.jsonl']) {
    assert.equal(isAgentSessionPathInside(root, target, path.win32), true, target)
  }
  for (const target of [String.raw`D:\a\Run\agent-sessions-other\new.jsonl`, String.raw`D:\a\Run\agent-sessions\..\other.jsonl`, String.raw`D:\a\Run`, String.raw`E:\a\Run\agent-sessions\new.jsonl`]) {
    assert.equal(isAgentSessionPathInside(root, target, path.win32), false, target)
  }
  const uncRoot = String.raw`\\server\share\Run\agent-sessions`
  assert.equal(isAgentSessionPathInside(uncRoot, String.raw`\\SERVER\SHARE\run\agent-sessions\new.jsonl`, path.win32), true)
  assert.equal(isAgentSessionPathInside(uncRoot, String.raw`\\server\other\Run\agent-sessions\new.jsonl`, path.win32), false)
  assert.equal(isAgentSessionPathInside(uncRoot, String.raw`\\other\share\Run\agent-sessions\new.jsonl`, path.win32), false)
})

test('POSIX path boundaries remain case sensitive and reject sibling prefixes and traversal', () => {
  assert.equal(isAgentSessionPathInside('/data/Run', '/data/Run/new.jsonl', path.posix), true)
  for (const target of ['/data/run/new.jsonl', '/data/Run-other/new.jsonl', '/data/Run/../other/new.jsonl', '/data']) {
    assert.equal(isAgentSessionPathInside('/data/Run', target, path.posix), false, target)
  }
})

test('a canonical data-root alias supports empty history, first append and restart', async t => {
  const f = await fixture(t), alias = `${f.dataRoot}-alias`
  await symlink(f.dataRoot, alias, process.platform === 'win32' ? 'junction' : 'dir')
  t.after(() => rm(alias, { recursive: true, force: true }))
  const store = new AgentSessionStore({ ...f, dataRoot: alias })
  assert.equal((await store.list()).total, 0)
  const first = await store.append(meta, { type: 'prompt', prompt: 'canonical path' })
  const resumed = new AgentSessionStore(f)
  assert.equal((await resumed.read(first.session_id)).events[0].prompt, 'canonical path')
})

test('dangling transcript symlinks cannot create files outside the Run', async t => {
  const f = await fixture(t), store = new AgentSessionStore(f)
  const first = await store.append(meta, { type: 'prompt', prompt: 'first' })
  const transcript = path.join(f.dataRoot, 'runs', f.runId, 'agent-sessions', `${first.session_id}.jsonl`)
  const external = path.join(f.dataRoot, 'outside-new.jsonl')
  await rm(transcript)
  await symlink(external, transcript, 'file')
  await assert.rejects(store.append(meta, { type: 'prompt', prompt: 'must not write outside' }), /无法解析的链接|越出/)
  await assert.rejects(lstat(external), { code: 'ENOENT' })
})

test('Windows case-varied roots support missing history and append/read across restart', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t), store = new AgentSessionStore({ ...f, dataRoot: f.dataRoot.toUpperCase() })
  await writeFile(path.join(f.dataRoot, 'runs', f.runId, 'acp-workers.json'), JSON.stringify({ runId: f.runId,
    workers: { 'worker-1': { providerId: meta.provider, remoteSessionId: meta.remote_session_id } } }))
  // Neither agent-sessions nor progress.json exists yet.
  const legacy = await store.list()
  assert.equal(legacy.items[0].history_status, 'metadata_only')
  assert.equal(legacy.recording_error, null)
  const first = await store.append(meta, { type: 'prompt', prompt: 'Windows first write' })
  const resumed = new AgentSessionStore({ ...f, dataRoot: f.dataRoot.toLowerCase() })
  const page = await resumed.read(first.session_id)
  assert.equal(page.events[0].prompt, 'Windows first write')
  assert.equal(page.recording_error, null)
})
