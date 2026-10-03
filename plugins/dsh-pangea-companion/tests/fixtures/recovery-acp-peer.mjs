// Deterministic ACP protocol peer. It executes the real PANGEA CLI; its fixed
// records exercise persistence/transport only, never model quality.
import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { access, appendFile, open, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { runPangea } from '../../src/pangea-api.js'

const config = JSON.parse(await readFile(process.env.PANGEA_RECOVERY_FIXTURE_CONFIG, 'utf8'))
const acp = await import(pathToFileURL(path.join(process.env.PANGEA_TEST_APP_ROOT, 'node_modules/@agentclientprotocol/sdk/dist/acp.js')).href)
const sessionPath = path.join(process.env.PANGEA_WORKER_SCRATCH, 'fixture-session.json')
const audit = event => appendFile(config.auditPath, `${JSON.stringify({ ...event, pid: process.pid, at: Date.now() })}\n`)
await audit({ event: 'peer_started' })
process.once('exit', code => appendFileSync(config.auditPath, `${JSON.stringify({ event: 'peer_exited', pid: process.pid, code })}\n`))
let retainedOrphan = false
const cleanupTimer = setInterval(() => {
  access(config.cleanupPath).then(() => process.exit(0), () => {})
}, 100)
process.stdin.once('end', () => { if (!retainedOrphan) clearInterval(cleanupTimer) })

class RecoveryPeer {
  constructor(connection) { this.connection = connection; this.session = null }
  async initialize() { await audit({ event: 'initialize' }); return { protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: { loadSession: true } } }
  async authenticate() { return {} }
  async newSession({ cwd }) {
    this.session = { sessionId: randomUUID(), cwd }
    await writeFile(sessionPath, JSON.stringify(this.session))
    await audit({ event: 'new_session', sessionId: this.session.sessionId })
    return { sessionId: this.session.sessionId }
  }
  async loadSession({ sessionId, cwd }) {
    this.session = JSON.parse(await readFile(sessionPath, 'utf8'))
    if (this.session.sessionId !== sessionId || this.session.cwd !== cwd) throw new Error('Recovery changed the persisted ACP identity or cwd')
    await audit({ event: 'load_session', sessionId })
    return { sessionId }
  }
  async cancel() {} // Cancellation without a response must not be mistaken for quiescence.
  async prompt({ sessionId, prompt }) {
    if (sessionId !== this.session?.sessionId) throw new Error('Unknown session')
    const text = prompt.map(item => item.type === 'text' ? item.text : '').join('')
    if (text === 'PROBE_TOOL_KINDS') {
      for (const [toolCallId, kind] of [['read-1', 'read'], ['edit-1', 'edit'], ['execute-1', 'execute']]) {
        await this.connection.sessionUpdate({ sessionId, update: { sessionUpdate: 'tool_call', toolCallId, title: toolCallId, kind, status: 'in_progress' } })
      }
      for (const toolCallId of ['read-1', 'execute-1', 'edit-1']) {
        await this.connection.sessionUpdate({ sessionId, update: { sessionUpdate: 'tool_call_update', toolCallId, status: 'completed' } })
      }
      return { stopReason: 'end_turn' }
    }
    const bindingLine = text.split('\n').find(line => line.startsWith('每次 CLI'))
    if (bindingLine) {
      this.session.binding = JSON.parse(bindingLine.slice(bindingLine.indexOf('：') + 1))
      await writeFile(sessionPath, JSON.stringify(this.session))
    }
    if (!this.session.binding) return { stopReason: 'end_turn' }
    const binding = this.session.binding
    const actionId = binding[binding.indexOf('--action-id') + 1]
    await audit({ event: 'action_prompt', actionId, sessionId })
    const call = async (command, args = []) => {
      const toolCallId = randomUUID()
      await this.connection.sessionUpdate({ sessionId, update: { sessionUpdate: 'tool_call', toolCallId, title: command, kind: 'execute', status: 'in_progress' } })
      const result = await runPangea({ cwd: config.cwd, args: [command, ...binding, ...args] })
      await this.connection.sessionUpdate({ sessionId, update: { sessionUpdate: 'tool_call_update', toolCallId, status: 'completed' } })
      return result
    }
    const { task } = await call('task-open')
    const current = await call('result-read')
    let revision = current.revision
    if (revision === 0) {
      let saved
      if (task.task_type === 'source_first_plan') {
        saved = await call('plan-write', ['--expected-revision', '0', '--unit', JSON.stringify({ title: 'TLS 连接', purpose: '固定恢复 fixture', owned_files: [{ repo_id: 'sample', path: 'tls.c' }] })])
      } else if (task.review_stage === 'comparison_review') {
        saved = await call('review-decide', ['--expected-revision', '0', '--decision', JSON.stringify({ version_set_id: task.version_set_id, disposition: 'pass', summary: '固定协议 fixture，不代表模型质量验证' })])
      } else {
        saved = await call('result-write', ['--expected-revision', '0', '--records', JSON.stringify([{ kind: 'note', body: '固定恢复 fixture：连接启用返回成功。', evidence: ['sample:tls.c:1'] }])])
      }
      revision = saved.revision
      await audit({ event: 'result_saved', actionId, taskType: task.task_type, sessionId, revision })
    }
    if (task.task_type === 'source_first_analysis' && config.failure === 'host-after-save') {
      let first = false
      try { const marker = await open(config.injectedPath, 'wx'); await marker.close(); first = true } catch (error) { if (error.code !== 'EEXIST') throw error }
      if (first) {
        await audit({ event: 'checkpoint', actionId, sessionId, revision, failure: config.failure })
        // Remain alive even after the test crashes our host. The test terminates
        // this exact owned fixture PID, proving that a live orphan blocks resume.
        retainedOrphan = true
        await new Promise(() => {})
      }
    }
    if (!current.completion_complete) {
      await call('work-finish', ['--revision', String(revision)])
      await audit({ event: 'work_finished', actionId, taskType: task.task_type, sessionId, revision })
    }
    if (task.task_type === 'source_first_analysis' && config.failure === 'peer-after-finish') {
      let first = false
      try { const marker = await open(config.injectedPath, 'wx'); await marker.close(); first = true } catch (error) { if (error.code !== 'EEXIST') throw error }
      if (first) {
        await audit({ event: 'checkpoint', actionId, sessionId, revision, failure: config.failure })
        process.exit(42)
      }
    }
    await this.connection.sessionUpdate({ sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: actionId } } })
    return { stopReason: 'end_turn' }
  }
}

const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin))
new acp.AgentSideConnection(connection => new RecoveryPeer(connection), stream)
