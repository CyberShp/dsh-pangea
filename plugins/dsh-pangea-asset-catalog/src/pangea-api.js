import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { acpProviderOption, internalModelOptions, requireInternalModel } from '../../dsh-pangea-companion/src/workbench-api.js'

function workspaceRoot(cwd) {
  if (typeof cwd !== 'string' || cwd.trim() === '') throw new Error('workspace cwd is required')
  let cursor = path.resolve(cwd)
  while (true) {
    if (existsSync(path.join(cursor, '.agents', 'pangea', 'dsh.md'))) return cursor
    const parent = path.dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  throw new Error(`PANGEA workspace not found from: ${cwd}`)
}

function pythonExecutable(root) {
  if (typeof process.env.PANGEA_PYTHON === 'string' && process.env.PANGEA_PYTHON.trim() !== '') {
    return process.env.PANGEA_PYTHON
  }
  const candidates = process.platform === 'win32'
    ? [path.join(root, '.venv', 'Scripts', 'python.exe'), 'python']
    : [path.join(root, '.venv', 'bin', 'python'), 'python3']
  return candidates.find(candidate => !path.isAbsolute(candidate) || existsSync(candidate))
}

function parseEnvelope(stdout) {
  const lines = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const value = JSON.parse(lines[index])
      if (value?.api_version === '1.0' && typeof value.ok === 'boolean') return value
    } catch {
      // Only the CLI JSON envelope is accepted.
    }
  }
  throw new Error('PANGEA CLI did not return a JSON envelope')
}

export function runPangea({ cwd, args }) {
  const root = workspaceRoot(cwd)
  const executable = pythonExecutable(root)
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-m', 'pangea_agent.cli.main', ...args], {
      cwd: root,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONPATH: [path.join(root, 'src'), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('close', code => {
      try {
        const envelope = parseEnvelope(stdout)
        if (code !== 0 || envelope.ok !== true) {
          reject(new Error(envelope.error?.message ?? stderr.trim() ?? `PANGEA CLI exited with ${code}`))
          return
        }
        resolve(envelope.result)
      } catch (error) {
        reject(new Error(/页面文件太小|paging file is too small|WinError 1455/i.test(stderr) ? `Windows 提交内存不足，Python 尚未启动；请检查已提交内存、页面文件及残留进程。\n${stderr.trim()}` : stderr.trim() || error.message))
      }
    })
  })
}

export function dataRootFor(cwd, explicit) {
  if (typeof explicit === 'string' && explicit.trim() !== '') return path.resolve(explicit)
  return path.join(workspaceRoot(cwd), 'pangea-data')
}

function rpc(payload) { return { rpcId: `pangea-asset-${Date.now()}-${Math.random()}`, payload } }
function apiValue(response) {
  if (!response?.result?.ok) throw Object.assign(new Error(response?.result?.error?.message ?? 'DSH API request failed'), { code: response?.result?.error?.code })
  return response.result.value
}

export class AssetActionRuntime {
  constructor(api, runner = runPangea, runtime = {}) {
    this.api = api
    this.runner = runner
    this.jobs = new Map()
    this.sessions = new Map()
    this.runtime = runtime
  }
  async executionOptions() {
    return internalModelOptions(this.api)
  }
  historyPath(dataRoot, assetId) {
    return path.join(path.resolve(dataRoot), '.pangea', 'asset-jobs', `${createHash('sha256').update(assetId).digest('hex')}.json`)
  }
  saved(dataRoot, assetId) {
    const file = this.historyPath(dataRoot, assetId)
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, 'utf8'))
  }
  persist(job) {
    const file = this.historyPath(job.dataRoot, job.assetId)
    mkdirSync(path.dirname(file), { recursive: true })
    const value = { status: job.status, started_at: job.startedAt, completed_at: job.completedAt,
      session_id: job.ownerSessionId ?? job.sessionId, worker_id: job.sessionId,
      provider_id: job.providerId, model: job.model, output: job.output ?? '', error: job.error,
      events: job.events ?? [], history: job.history ?? [] }
    const temporary = `${file}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify(value), 'utf8')
    renameSync(temporary, file)
    return value
  }
  capture(job) {
    const output = job.worker?.readOutput?.()
    if (output) { job.output = `${job.output ?? ''}${output}`; this.persist(job) }
  }
  watch(job) {
    job.timer = setInterval(() => { try { this.capture(job) } catch (error) { job.error = `运行记录保存失败：${error.message}` } }, 1000)
    job.timer.unref?.()
  }
  record(job, label) {
    job.events ??= []
    job.events.push({ at: new Date().toISOString(), label })
    return this.persist(job)
  }
  handleSessionEvent(session, event) {
    const job = this.sessions.get(session?.id)
    if (!job || ['completed', 'failed'].includes(job.status)) return
    if (event.type === 'assistant/message') {
      const content = event.data?.message?.content
      const text = typeof content === 'string' ? content : (content ?? []).filter(item => item.type === 'text').map(item => item.text).join('\n')
      if (text) { job.output = `${job.output ?? ''}${text}\n`; this.persist(job) }
    } else if (event.type === 'tool/call') this.record(job, `正在使用工具：${event.data.name}`)
  }
  job(dataRoot, assetId) {
    const job = this.jobs.get(`${path.resolve(dataRoot)}\n${assetId}`)
    if (!job) {
      const saved = this.saved(dataRoot, assetId)
      if (!saved) return null
      if (['preparing', 'queued', 'running', 'finalizing'].includes(saved.status)) return { ...saved, status: 'interrupted', error: '应用已重启，处理过程已保存。可以重新处理此资产。', session_available: false }
      return { ...saved, session_available: false }
    }
    this.capture(job)
    return { ...this.persist(job), session_available: Boolean(job.sessionId) }
  }

  async adapter(job, operation) {
    const args = ['adapter', operation, '--data-root', job.dataRoot, '--asset-id', job.assetId,
      '--action-id', job.action.action_id]
    if (operation === 'bind') args.push('--task-id', job.sessionId)
    return this.runner({ cwd: job.cwd, args })
  }
  async start({ cwd, dataRoot, assetId, providerId = '', model, agentModel, restart = false }) {
    const resolvedDataRoot = dataRootFor(cwd, dataRoot)
    const key = `${path.resolve(resolvedDataRoot)}\n${assetId}`
    const active = this.jobs.get(key)
    if (active && ['preparing', 'queued', 'running', 'finalizing'].includes(active.status)) {
      return { completed: false, reused: true, session_id: active.ownerSessionId ?? active.sessionId }
    }
    const previous = this.job(resolvedDataRoot, assetId)
    const job = { history: previous ? [...(previous.history ?? []), { ...previous, history: undefined }] : [], events: [], cwd, dataRoot: resolvedDataRoot, assetId, status: 'preparing', startedAt: new Date().toISOString(),
      worker: active?.worker, ownerSessionId: active?.ownerSessionId, providerId, model: providerId ? agentModel : model }
    this.jobs.set(key, job)
    try {
      this.record(job, '正在准备资产内容')
      if (restart) await active?.worker?.dispose?.()
      const prepared = await this.runner({ cwd, args: ['assets', 'extract', '--data-root', resolvedDataRoot, '--asset-id', assetId, ...(restart ? ['--restart'] : [])] })
      if (!prepared.action) {
        if (!['available', 'awaiting_review', 'no_items'].includes(prepared.asset?.status)) throw new Error('资产未完成提取且没有返回提取任务')
        job.status = 'completed'
        job.completedAt = new Date().toISOString()
        this.record(job, '资产处理完成')
        return { completed: true, asset: prepared.asset }
      }
      job.action = prepared.action
      job.sessionId = prepared.action.task_id || null
      if (!job.sessionId) { job.worker = null; job.ownerSessionId = null }
      if (job.sessionId) {
        // A restart resumes the asset's persisted identity, never a guessed latest session.
        try {
          const settled = await this.adapter(job, 'settle')
          job.status = 'completed'
          job.completedAt = new Date().toISOString()
          this.record(job, '已接收保存的提取结果')
          return { completed: true, asset: settled.asset }
        } catch (error) { job.repairReason = error.message }
      }
      if (providerId) {
        if (!acpProviderOption(providerId) || !this.runtime.subagents?.getProvider?.(providerId)) throw new Error('所选执行器不可用，请在资产解析设置中选择可用执行器')
        if (job.sessionId && (!job.worker || String(job.worker.id) !== job.sessionId)) throw new Error(`原资产会话不能由所选执行器续接：${job.sessionId}。请保持原执行器，不能替换已绑定会话。`)
        if (job.worker && (active.providerId !== providerId || active.model !== agentModel)) throw new Error('资产续接必须保持原执行器与模型')
      } else {
        // Explicitly configure the actual extraction session, never rely on
        // Desktop's intentionally empty agent-default-model route.
        job.model = await requireInternalModel(this.api, model)
        if (job.worker) throw new Error('资产已绑定外部执行器，请保持原执行器续接')
      }
      if (!job.sessionId) {
        const root = workspaceRoot(cwd)
        let payload = { cwd: root }
        if (this.api.workspace?.list) {
          const workspace = apiValue(await this.api.workspace.list(rpc({}))).items.find(item => path.resolve(item.path) === root)
          if (!workspace) throw new Error(`current DSH workspace is not registered: ${root}`)
          payload = { workspaceId: workspace.workspaceId }
        }
        job.ownerSessionId = apiValue(await this.api.sessions.create(rpc(payload))).sessionId
        apiValue(await this.api.sessions.rename(rpc({ sessionId: job.ownerSessionId, title: `资产提取 · ${prepared.asset.title ?? assetId}` })))
        if (!providerId) { job.sessionId = job.ownerSessionId; await this.adapter(job, 'bind') }
      }
      const prompt = [
        providerId ? '你是资产提取 worker，直接读取下面的 task JSON，按其 result_schema_path 提取 extracted_text_path 和 attachments 中的原文；不调用插件工具、不创建 Run、不派发子 Agent。保留原文出处，不臆造需求或缺陷。'
          : `读取 ${path.join(workspaceRoot(cwd), '.agents', 'pangea', 'asset-extraction-worker.md')} 并执行。`,
        `task_path: ${job.action.task_path}`,
        '用中文简要说明正在读取的资料、提取进度和处理结果。只读取此 task 的输入，在 task 指定 result_path 写完整提取 JSON。宿主负责提交，不要另建 action 或运行分析。',
        ...(job.repairReason ? [`修正同一结果后完成：${job.repairReason}`] : []),
      ].join('\n')
      if (providerId) {
        job.status = 'queued'
        this.record(job, '已选择外部 Agent，正在启动')
        job.done = this.runExternal(job, prompt, agentModel)
        return { completed: false, session_id: job.ownerSessionId, action: job.action }
      }
      apiValue(await this.api.sessions.selectModel(rpc({ sessionId: job.sessionId, provider: job.model.provider,
        model: job.model.model, ...(job.model.reasoning_effort ? { reasoningEffort: job.model.reasoning_effort } : {}) })))
      this.sessions.set(job.sessionId, job)
      this.record(job, '已绑定所选 API 模型')
      job.status = 'queued'
      apiValue(await this.api.sessions.prompt(rpc({ sessionId: job.sessionId, mode: 'queue', content: [{ type: 'text', text: prompt }] })))
      this.record(job, '任务已提交，等待模型处理')
      return { completed: false, session_id: job.sessionId, action: job.action }
    } catch (error) {
      job.status = 'failed'; job.error = error.code === 'session-not-found'
        ? `原资产解析会话不存在：${job.sessionId}。已有结果已保留；可点击“重新处理资产”创建新的提取尝试。` : error.message
      job.completedAt = new Date().toISOString()
      this.record(job, '资产处理未完成')
      throw new Error(job.error)
    }
  }
  async runExternal(job, prompt, agentModel) {
    try {
      job.status = 'running'
      if (!job.worker) {
        const parent = this.runtime.agents?.get?.(job.ownerSessionId)
        if (!parent) throw new Error('资产提取的宿主会话不可用')
        job.worker = await this.runtime.subagents.start(job.providerId, { parent, label: `资产提取 · ${job.assetId}`,
          prompt: [{ type: 'text', text: '等待宿主绑定资产任务，不读取文件或调用工具，只回复就绪并结束本轮。' }],
          ...(agentModel ? { agentOptions: { model: agentModel } } : {}) })
        if (!job.worker?.id || typeof job.worker.continuePrompt !== 'function') throw new Error('所选执行器不支持资产任务原会话续接')
        job.sessionId = String(job.worker.id)
        this.watch(job)
        this.record(job, 'Agent 已启动，正在读取资料')
        await this.adapter(job, 'bind')
        const ready = await job.worker.result
        if (ready.stopReason !== 'completed') throw new Error(`资产会话初始化失败：${ready.stopReason} ${ready.diagnostic ?? ''}`)
      }
      const result = await job.worker.continuePrompt([{ type: 'text', text: prompt }])
      if (result.stopReason !== 'completed') throw new Error(`资产提取未完成：${result.stopReason} ${result.diagnostic ?? ''}`)
      await this.finish(job)
      if (job.status === 'completed') await job.worker.dispose?.()
    } catch (error) {
      job.status = 'failed'; job.error = error.message; job.completedAt = new Date().toISOString()
      try { await job.worker?.dispose?.() } catch (cleanup) { job.error += `；进程清理失败：${cleanup.message}` }
    } finally { this.capture(job); clearInterval(job.timer); this.record(job, job.status === 'completed' ? '资产处理完成' : '资产处理未完成') }
  }
  async finish(job) {
    if (!job || ['completed', 'failed', 'finalizing'].includes(job.status)) return
    job.status = 'finalizing'
    try { await this.adapter(job, 'settle'); job.status = 'completed' }
    catch (error) { job.status = 'failed'; job.error = error.message }
    job.completedAt = new Date().toISOString()
    this.capture(job); clearInterval(job.timer); this.record(job, job.status === 'completed' ? '提取结果已保存' : '提取结果需要处理')
  }
  handleAgentStatus(agent, status) {
    const job = this.sessions.get(agent?.session?.id)
    if (!job || ['completed', 'failed', 'finalizing'].includes(job.status)) return
    if (status === 'running') { job.status = 'running'; this.record(job, '模型正在处理资产') }
    if (status === 'idle' && job.status === 'running') void this.finish(job)
  }
  handleAgentError(agent, error) {
    const job = this.sessions.get(agent?.session?.id)
    if (!job || job.status === 'completed') return
    job.status = 'failed'; job.error = error?.message ?? String(error); job.completedAt = new Date().toISOString()
    this.record(job, '模型运行失败')
  }
}

export { workspaceRoot }
