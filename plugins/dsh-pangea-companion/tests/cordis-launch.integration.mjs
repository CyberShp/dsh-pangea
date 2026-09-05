import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { launchAnalysisSession } from '../src/workbench-api.js'

const appRoot = process.env.PANGEA_TEST_APP_ROOT
if (!appRoot) throw new Error('PANGEA_TEST_APP_ROOT must point to a built PANGEA Desktop app root')

async function importFromAppRoot(relativePath) {
  return import(pathToFileURL(path.join(appRoot, 'node_modules', ...relativePath.split('/'))).href)
}

function ok(value) { return { result: { ok: true, value } } }

test('uses real Cordis Context and LocalJobRegistry to bind before ACP start', async () => {
  const { Context } = await importFromAppRoot('@deepseek-ai/cordis/lib/index.js')
  const { LocalJobRegistry } = await importFromAppRoot('@deepseek-ai/dsh-jobs-local/lib/index.js')
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-cordis-launch-'))
  const context = new Context()
  const order = []
  let job
  let disposed = false
  const owner = { id: 'owner-session', ctx: context }
  const agents = { get(id) { return id === owner.id ? owner : undefined } }
  const subagents = {
    getProvider(id) { return id === 'pangea-opencode' ? {} : undefined },
    async start() {
      order.push('agent-started')
      return {
        id: 'agent-session',
        result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'done' }] }),
        dispose: async () => { disposed = true },
      }
    },
  }
  context.provide('agents', agents)
  context.provide('subagents', subagents)
  const jobs = new LocalJobRegistry(context, { maxConcurrentJobsPerOwner: 10 })
  const detachController = jobs.attachController('integration-test')
  let runtime
  try {
    await context.inject(['agents', 'subagents', 'jobs'], ctx => { runtime = ctx })
    await mkdir(path.join(root, '.agents', 'pangea'), { recursive: true })
    await writeFile(path.join(root, '.agents', 'pangea', 'dsh.md'), '# DSH\n', 'utf8')
    const api = {
      workspace: { async list() { return ok({ items: [{ workspaceId: 'workspace-1', path: root }] }) } },
      sessions: {
        async create() { return ok({ sessionId: owner.id }) },
        async rename() { return ok({}) },
      },
    }
    const runner = async call => call.args[0] === 'system'
      ? { repositories: ['repo-one'], analysis_skill: { skill_id: 'codetalks-skill', version: '1.3.0' } }
      : { run_id: 'run-integration', request_path: path.join(root, 'request.md'), run_root: path.join(root, 'run') }
    const result = await launchAnalysisSession(api, {
      cwd: root,
      input: { repository: 'repo-one', target: '真实 Cordis', source_scope: [], provider_id: 'pangea-opencode' },
    }, runner, async () => {}, async () => {}, runtime, process.env, {
      onJobCreated(info) {
        job = info
        order.push('job-bound')
      },
    })
    assert.equal(result.job_id, 'subagent-1')
    assert.deepEqual(order.slice(0, 2), ['job-bound', 'agent-started'])
    assert.equal(job.ownerSessionId, owner.id)
    assert.equal(Number.isFinite(job.jobStartedAt), true)
    const settled = await jobs.wait(result.job_id, 1000, owner)
    assert.equal(settled.status, 'completed')
    assert.equal(disposed, true)
    assert.throws(() => runtime.runtime_instance_id, /without inject/)
  } finally {
    await jobs.disposeAll()
    detachController()
    await rm(root, { recursive: true, force: true })
  }
})
