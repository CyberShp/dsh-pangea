import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { createTaskStore } from '../src/task-store.js'
import { launchAnalysisSession } from '../src/workbench-api.js'

const appRoot = process.env.PANGEA_TEST_APP_ROOT
if (!appRoot) throw new Error('PANGEA_TEST_APP_ROOT must point to a built PANGEA Desktop app root')

async function importFromAppRoot(relativePath) {
  return import(pathToFileURL(path.join(appRoot, 'node_modules', ...relativePath.split('/'))).href)
}

function ok(value) { return { result: { ok: true, value } } }

test('uses real Cordis and Jobs to persist one exact ACP attempt through settlement', async () => {
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
  const tasks = createTaskStore({
    storePath: path.join(root, 'tasks-v1.json'),
    now: (() => {
      let value = 1_800_000_000_000
      return () => value++
    })(),
    idFactory: () => 'task-integration',
    attemptIdFactory: () => 'attempt-integration',
  })
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
    const runner = async call => {
      if (call.args[0] === 'system') {
        return { repositories: ['repo-one'], analysis_skill: { skill_id: 'codetalks-skill', version: '1.3.0' } }
      }
      if (call.args[0] === 'runs' && call.args[1] === 'get') {
        return {
          run_id: 'run-integration', lifecycle_status: 'complete', phase: 'COMPLETE',
          report_available: true, analysis: { completed: 9 },
        }
      }
      return { run_id: 'run-integration', request_path: path.join(root, 'request.md'), run_root: path.join(root, 'run') }
    }
    const created = await tasks.create({
      workspace: root,
      dataRoot: path.join(root, 'data'),
      input: { repository: 'repo-one', target: '真实 Cordis', provider_id: 'pangea-opencode' },
    })
    const prepared = await tasks.prepareProviderLaunch(created.task_id, 'pangea-opencode')
    const settledTask = new Promise((resolve, reject) => {
      jobs.onJobDone(async (snapshot, settledOwner) => {
        try {
          const task = await tasks.settleJob({
            jobId: snapshot.id,
            attemptId: prepared.attempt_id,
            ownerSessionId: settledOwner?.id,
            jobStartedAt: snapshot.startedAt,
          }, snapshot)
          resolve(task)
        } catch (error) {
          reject(error)
        }
      })
    })
    const result = await launchAnalysisSession(api, {
      cwd: root,
      input: { repository: 'repo-one', target: '真实 Cordis', source_scope: [], provider_id: 'pangea-opencode' },
    }, runner, async session => tasks.addConversation(created.task_id, {
      sessionId: session.session_id,
      title: '真实 Cordis · 分析',
      kind: 'analysis',
    }), async () => {}, runtime, process.env, {
      onRunReady: run => tasks.bindRun(created.task_id, run.run_id),
      onOwnerReady: ({ ownerSessionId }) => tasks.bindOwnerSession(created.task_id, {
        ownerSessionId,
        attemptId: prepared.attempt_id,
      }),
      async onJobCreated(info) {
        job = info
        await tasks.bindJob(created.task_id, {
          ...info,
          provider: 'pangea-opencode',
          attemptId: prepared.attempt_id,
        })
        order.push('job-bound')
      },
      onAgentStarted: ({ agent_session_id: agentSessionId }) => tasks.bindAgentRuntime(created.task_id, {
        agentSessionId,
        attemptId: prepared.attempt_id,
      }),
    })
    assert.equal(result.job_id, 'subagent-1')
    assert.deepEqual(order.slice(0, 2), ['job-bound', 'agent-started'])
    assert.equal(job.ownerSessionId, owner.id)
    assert.equal(Number.isFinite(job.jobStartedAt), true)
    const settled = await jobs.wait(result.job_id, 1000, owner)
    assert.equal(settled.status, 'completed')
    const persisted = await settledTask
    assert.equal(persisted.run_id, 'run-integration')
    assert.equal(persisted.owner_session_id, owner.id)
    assert.equal(persisted.job_id, result.job_id)
    assert.equal(persisted.job_started_at, settled.startedAt)
    assert.equal(persisted.agent_session_id, 'agent-session')
    assert.equal(persisted.execution_status, 'completed')
    assert.equal(persisted.attempts[0].attempt_id, prepared.attempt_id)
    assert.equal(persisted.attempts[0].execution_status, 'completed')
    assert.equal(disposed, true)
    assert.throws(() => runtime.runtime_instance_id, /without inject/)
  } finally {
    await jobs.disposeAll()
    detachController()
    await rm(root, { recursive: true, force: true })
  }
})
