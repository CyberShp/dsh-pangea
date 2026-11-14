import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, lstat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { writeTaskStoreFile } from './task-store.js'
import { caseIdentity } from './case-review-projection.js'
import { caseContentHash } from './case-review-store.js'

const execute = promisify(execFile)
const activeStates = new Set(['preparing', 'generating', 'pushing'])
const hash = value => createHash('sha256').update(value).digest('hex')
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
const serviceError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })
const inside = (root, file) => { const r = path.relative(root, file); return r && r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r) }
const cleanError = error => String(error?.stderr || error?.message || error).replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/g, '$1***@').slice(-6000)

export async function injectionGit(cwd, args, signal) {
  try {
    const result = await execute('git', ['-c', 'core.hooksPath=', ...args], {
      cwd, signal, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_LFS_SKIP_SMUDGE: '1' },
    })
    return result.stdout.trimEnd()
  } catch (error) {
    if (error.code === 'ENOENT') throw serviceError('生成和推送打桩代码需要 Git，请安装 Git 或将其加入 PATH；普通分析不受影响')
    if (signal?.aborted) throw signal.reason ?? error
    throw serviceError(cleanError(error), 422)
  }
}

// The agent supplies the behavior and exact replacement. The host only checks
// file boundaries and matching bytes; it never decides whether a fault is useful.
export async function applyInjectionEdits(repositoryRoot, edits) {
  const root = await realpath(repositoryRoot)
  const staged = new Map()
  for (const edit of edits) {
    const name = edit?.path
    if (typeof name !== 'string' || !name || /[\\\x00-\x1f:]/.test(name) || path.posix.isAbsolute(name)
      || name.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw serviceError('修改文件路径必须在所选仓库内')
    const file = path.resolve(root, name)
    if (!inside(root, file)) throw serviceError('修改文件路径越出所选仓库')
    let parent = path.dirname(file)
    while (parent !== root) {
      try { if (!(await lstat(parent)).isDirectory() || !inside(root, await realpath(parent))) throw serviceError(`目录越界或不是普通目录：${name}`); break }
      catch (error) { if (error.code !== 'ENOENT') throw error; parent = path.dirname(parent) }
    }
    if (!staged.has(name)) {
      try {
        if (!(await lstat(file)).isFile() || !inside(root, await realpath(file))) throw serviceError(`仅支持仓库内普通文件：${name}`)
        const bytes = await readFile(file)
        if (bytes.includes(0) || !Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)) throw serviceError(`文件不是 UTF-8 文本：${name}`)
        staged.set(name, bytes.toString('utf8'))
      } catch (error) { if (error.code !== 'ENOENT') throw error; staged.set(name, null) }
    }
    const current = staged.get(name)
    if (edit.before === null) {
      if (current !== null || typeof edit.after !== 'string') throw serviceError(`新文件已存在或内容无效：${name}`)
      staged.set(name, edit.after)
    } else {
      if (typeof current !== 'string' || typeof edit.before !== 'string' || !edit.before || typeof edit.after !== 'string') throw serviceError(`替换缺少原文或新内容：${name}`)
      // Normalize only matching line endings, preserving the file's own style.
      const eol = current.includes('\r\n') ? '\r\n' : '\n'
      const before = edit.before.replace(/\r?\n/g, eol), after = edit.after.replace(/\r?\n/g, eol)
      const at = current.indexOf(before)
      if (at < 0 || current.indexOf(before, at + 1) >= 0) throw serviceError(`原文未唯一匹配：${name}；请重新生成此修改`)
      staged.set(name, current.slice(0, at) + after + current.slice(at + before.length))
    }
  }
  // Validate every replacement before touching any file in this repository.
  for (const [name, content] of staged) { const file = path.join(root, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content, 'utf8') }
  return [...staged.keys()]
}

export function injectionPrompt({ record, inputPath, outputPath }) {
  return [
    '你正在执行独立的 PANGEA 用例打桩代码生成任务。不要创建分析 Run，也不要调用 Graph bind/settle/work-finish。',
    `先读取任务输入 JSON：${inputPath}。其中 cases 是已选用例，repositories 是本次独立源码副本及固定提交。`,
    '只在这些仓库内调查需要的实现、构建配置和既有故障注入/调测入口。输入里的 instrumentation 是候选方案，须结合本次提交源码定位。',
    '核对所选用例引用的 analysis_source 冻结片段与本次源码副本；同一 commit 也可能存在分析时未提交的修改。只比较相关位置，差异对注入方案的影响写入 summary，不重做全仓分析。',
    '不要修改或推送源码仓库，不运行构建或安装命令。唯一交付是下述 JSON 文件；宿主负责精确写入、提交和推送。',
    '先完成调用路径与副作用判断，再生成实际可编译的修改。故障注入制造原因，保留原有错误处理和恢复逻辑，不直接篡改预期结果。',
    '同包多个桩默认关闭，具有独立启停方式。限定目标对象/调用阶段/次数，记录实际命中。优先复用真实已有调测入口；没有时实现符合项目语言与构建方式的最小控制入口，并把必要源文件/构建接入一起纳入 edits。',
    '分别给出各用例的启停步骤：前置失败阻断后续桩时分轮执行；故障处理需要组合桩时写明触发顺序。关闭桩后说明需重建的业务状态。不要凭空列互斥关系，也不要做全仓两两组合审查。',
    '分析基线与本次基线不同则重新定位，并在 summary 交代影响。不能落地的部分写入 limitations，不能编造命令或宣称已编译/实测。',
    'JSON 结构：{summary:string, points:[{id,case_keys:[string],repo_id,path,symbol,action,trigger,times,enable,disable,observe,cleanup,depends_on:[id],exclusive_with:[id]}], profiles:[{case_key,point_ids:[id],steps:[string]}], edits:[{repo_id,path,before:string|null,after:string}], limitations:[string]}。',
    'case_key 必须逐字使用输入的 case_key。points/profiles 是业务说明；edits 才是实际修改。before 为当前文件中唯一出现的原文，after 为替换内容；新增文件 before=null。path 为仓库相对路径。不要包含 .git 文件，不删除文件。',
    '每条选中用例都应有对应 profile；多个用例可复用一个 point。给出能直接执行的启用、关闭及命中检查方法，不把待实现的开关写成已有命令。',
    `把完整 JSON 写入 ${outputPath}，写完结束。任务 ID：${record.id}。`,
  ].join('\n')
}

export function checkInjectionResult(value, record) {
  if (!value || !Array.isArray(value.edits) || !value.edits.length) throw serviceError('Agent 未提供实际代码修改；本轮未形成修改，可重新生成')
  if (!Array.isArray(value.points) || !value.points.length || !Array.isArray(value.profiles)) throw serviceError('生成结果缺少桩点或逐用例执行说明')
  const repoIds = new Set(record.repositories.map(repo => repo.repo_id)), pointIds = new Set()
  for (const point of value.points) {
    if (!point || typeof point.id !== 'string' || !point.id || pointIds.has(point.id) || !repoIds.has(point.repo_id)) throw serviceError('生成结果包含重复桩点编号或未选择的仓库')
    pointIds.add(point.id)
  }
  for (const key of record.case_keys) {
    const profiles = value.profiles.filter(profile => profile?.case_key === key)
    if (profiles.length !== 1 || !Array.isArray(profiles[0].steps) || !profiles[0].steps.length
      || profiles[0].steps.some(step => typeof step !== 'string' || !step.trim())
      || !Array.isArray(profiles[0].point_ids) || !profiles[0].point_ids.length
      || profiles[0].point_ids.some(point => !pointIds.has(point))) throw serviceError(`用例 ${key} 缺少可读取的桩点引用或执行说明`)
  }
  if (value.edits.some(edit => !edit || !repoIds.has(edit.repo_id))) throw serviceError('代码修改引用了未选择的仓库')
  return value
}

export class FaultInjectionService {
  constructor({ generate, git = injectionGit } = {}) { this.generate = generate; this.git = git; this.active = new Map(); this.queues = new Map() }
  key(dataRoot, runId, taskId) { return JSON.stringify([path.resolve(dataRoot), runId, taskId]) }
  async directory(dataRoot, runId, taskId) {
    if (!id(runId) || (taskId != null && !id(taskId))) throw serviceError('打桩任务或 Run 标识无效')
    const root = await realpath(dataRoot)
    const base = path.join(root, '.pangea', 'fault-injection', runId, ...(taskId ? [taskId] : []))
    await mkdir(base, { recursive: true })
    if (!inside(root, await realpath(base))) throw serviceError('打桩任务目录越出数据目录')
    return base
  }
  async save(directory, record) {
    record.updated_at = new Date().toISOString()
    await writeTaskStoreFile(path.join(directory, 'task.json'), JSON.stringify(record, null, 2) + '\n')
  }
  async read(dataRoot, runId, taskId) {
    const directory = await this.directory(dataRoot, runId, taskId)
    const record = JSON.parse(await readFile(path.join(directory, 'task.json'), 'utf8'))
    if (record.id !== taskId || record.run_id !== runId) throw serviceError('打桩任务身份不匹配')
    if (activeStates.has(record.status) && !this.active.has(this.key(dataRoot, runId, taskId))) return { ...record, status: 'interrupted', error: '上次操作已中断；可重新生成，已提交的修改仍保留' }
    return record
  }
  async list(dataRoot, runId) {
    const directory = await this.directory(dataRoot, runId)
    const records = []
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (!item.isDirectory() || !id(item.name)) continue
      try { records.push(await this.read(dataRoot, runId, item.name)) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    return records.sort((a, b) => b.created_at.localeCompare(a.created_at))
  }
  async defaults(dataRoot, run) {
    const progressFile = path.join(dataRoot, 'runs', run.run_id, 'progress.json')
    let progress = {}
    try { progress = JSON.parse(await readFile(progressFile, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    const repos = run.source_snapshot?.repositories?.length ? run.source_snapshot.repositories : (run.repositories ?? []).map(repo_id => ({ repo_id }))
    return { provider_id: progress.model_settings?.provider ?? '', agent_model: progress.model_id ?? '',
      repositories: repos.map(repo => ({ repo_id: repo.repo_id, source_path: path.join(dataRoot, 'repositories', repo.repo_id),
        base_ref: repo.git?.commit ?? repo.git?.head ?? 'HEAD', remote: 'origin', analysis_commit: repo.git?.commit ?? repo.git?.head ?? null })) }
  }
  async start({ dataRoot, run, input, cwd }) {
    const keys = input.case_keys
    const cases = run.details?.test_cases ?? []
    if (!Array.isArray(keys) || !keys.length || new Set(keys).size !== keys.length) throw serviceError('请选择需要打桩的用例')
    const selected = keys.map(key => {
      const matches = cases.filter(item => caseIdentity(item) === key)
      if (matches.length !== 1) throw serviceError(`用例不存在或身份重复：${key}`)
      return { ...matches[0], case_key: key, content_hash: caseContentHash(matches[0]) }
    })
    const defaults = await this.defaults(dataRoot, run)
    const repositories = input.repositories ?? defaults.repositories
    const known = new Map(defaults.repositories.map(repo => [repo.repo_id, repo]))
    if (!Array.isArray(repositories) || !repositories.length || new Set(repositories.map(repo => repo.repo_id)).size !== repositories.length
      || repositories.some(repo => !known.has(repo.repo_id))) throw serviceError('请选择当前 Run 的源码仓库')
    const selectedRepositories = repositories.map(repo => {
      if (typeof repo.repo_id !== 'string' || !repo.repo_id || /[\\/:\x00-\x1f]/.test(repo.repo_id) || ['.', '..'].includes(repo.repo_id)) throw serviceError('仓库标识无效')
      return { ...known.get(repo.repo_id), ...repo }
    })
    const prefix = String(input.branch_prefix || 'pangea-fi').trim()
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(prefix) || prefix.includes('..') || prefix.endsWith('/') || prefix.endsWith('.lock')) throw serviceError('个人分支前缀无效')
    const taskId = randomUUID(), directory = await this.directory(dataRoot, run.run_id, taskId)
    const record = { schema_version: 1, id: taskId, run_id: run.run_id, status: 'preparing', created_at: new Date().toISOString(),
      branch: `${prefix}/${taskId}`, case_keys: keys, cases: selected, repositories: [], source_repositories: selectedRepositories,
      provider_id: input.provider_id || defaults.provider_id, agent_model: input.agent_model || defaults.agent_model,
      instructions: String(input.instructions || ''), result: null, generation_complete: false, verification: [], build: {}, error: null }
    if (!record.provider_id || !record.agent_model) throw serviceError('请选择打桩执行器和模型，可复用本次分析的设置')
    await this.save(directory, record)
    const controller = new AbortController(), key = this.key(dataRoot, run.run_id, taskId)
    const operation = { controller, done: null }
    this.active.set(key, operation)
    operation.done = this.prepareAndGenerate({ dataRoot, directory, record, cwd, signal: controller.signal })
      .catch(async error => { record.status = controller.signal.aborted ? 'cancelled' : 'failed'; record.error = cleanError(error); await this.save(directory, record) })
      .finally(() => this.active.delete(key))
    return record
  }
  async prepareAndGenerate({ dataRoot, directory, record, cwd, signal }) {
    for (const source of record.source_repositories) {
      signal.throwIfAborted()
      const sourcePath = await realpath(source.source_path)
      const top = await this.git(sourcePath, ['rev-parse', '--show-toplevel'], signal)
      if (await realpath(top) !== sourcePath) throw serviceError(`请指定 Git 仓库根目录：${source.repo_id}`)
      const ref = String(source.base_ref || 'HEAD')
      if (ref.startsWith('-') || /[\x00-\x1f]/.test(ref)) throw serviceError('源码基线无效')
      const baseCommit = await this.git(sourcePath, ['rev-parse', '--verify', `${ref}^{commit}`], signal)
      const remote = String(source.remote || 'origin')
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)) throw serviceError('远端名称无效')
      let remoteUrl = null
      try { remoteUrl = await this.git(sourcePath, ['remote', 'get-url', '--push', remote], signal) } catch (error) { if (signal.aborted) throw error }
      const checkout = path.join(directory, 'repositories', source.repo_id)
      await mkdir(path.dirname(checkout), { recursive: true })
      await this.git(directory, ['clone', '--no-hardlinks', '--no-checkout', '--', sourcePath, checkout], signal)
      // Clone does not carry local user config; preserve attribution when set.
      for (const setting of ['user.name', 'user.email']) {
        try { const value = await this.git(sourcePath, ['config', '--get', setting], signal); if (value) await this.git(checkout, ['config', setting, value], signal) }
        catch (error) { if (signal.aborted) throw error }
      }
      if (remoteUrl) await this.git(checkout, ['remote', 'set-url', 'origin', remoteUrl], signal)
      else await this.git(checkout, ['remote', 'remove', 'origin'], signal)
      await this.git(checkout, ['checkout', '-b', record.branch, baseCommit], signal)
      record.repositories.push({ repo_id: source.repo_id, path: checkout, base_commit: baseCommit, analysis_commit: source.analysis_commit,
        has_remote: Boolean(remoteUrl), branch: record.branch, commit: null, pushed: false })
      await this.save(directory, record)
    }
    signal.throwIfAborted()
    const scratchDirectory = path.join(directory, 'generation')
    await mkdir(scratchDirectory, { recursive: true })
    const inputPath = path.join(scratchDirectory, 'input.json'), outputPath = path.join(scratchDirectory, 'result.json')
    await writeFile(inputPath, JSON.stringify({ ...record, analysis_source: path.join(dataRoot, 'runs', record.run_id, 'inputs', 'source') }, null, 2))
    record.status = 'generating'; await this.save(directory, record)
    if (typeof this.generate !== 'function') throw serviceError('打桩执行器未接入')
    const result = await this.generate({ record, cwd, scratchDirectory, inputPath, outputPath, signal,
      prompt: injectionPrompt({ record, inputPath, outputPath }) + `\n用户补充说明：${record.instructions || '无'}`,
      onStarted: async session => { record.agent_session = session; await this.save(directory, record) } })
    signal.throwIfAborted()
    const generated = result ?? JSON.parse(await readFile(outputPath, 'utf8'))
    // Keep the authored result available even if its transport shape is broken.
    await writeFile(path.join(scratchDirectory, 'authored-result.json'), JSON.stringify(generated, null, 2))
    checkInjectionResult(generated, record)
    record.result = { ...generated }; delete record.result.edits
    await this.save(directory, record)
    for (const repo of record.repositories) {
      signal.throwIfAborted()
      if (await this.git(repo.path, ['status', '--porcelain'], signal)) throw serviceError(`Agent 直接修改了源码副本：${repo.repo_id}；本轮不混入未登记修改`)
      const edits = generated.edits.filter(edit => edit.repo_id === repo.repo_id)
      if (!edits.length) continue
      const files = await applyInjectionEdits(repo.path, edits)
      await this.git(repo.path, ['add', '--', ...files], signal)
      repo.diff = await this.git(repo.path, ['diff', '--cached', '--no-ext-diff', '--no-textconv'], signal)
      if (!repo.diff) continue
      repo.diff_sha256 = hash(repo.diff)
      const author = []
      for (const [setting, fallback] of [['user.name', 'PANGEA'], ['user.email', 'pangea@localhost']]) {
        try { await this.git(repo.path, ['config', '--get', setting], signal) }
        catch (error) { if (signal.aborted) throw error; author.push('-c', `${setting}=${fallback}`) }
      }
      await this.git(repo.path, [...author, 'commit', '--no-gpg-sign', '-m', `test: fault injection ${record.id}`], signal)
      repo.commit = await this.git(repo.path, ['rev-parse', 'HEAD'], signal)
      repo.files = files
      await this.save(directory, record)
    }
    if (!record.repositories.some(repo => repo.commit)) throw serviceError('本次没有形成代码差异')
    record.generation_complete = true
    record.status = 'ready'; record.error = null; await this.save(directory, record)
  }
  async exclusive(dataRoot, runId, taskId, callback) {
    const key = this.key(dataRoot, runId, taskId)
    if (this.queues.has(key) || this.active.has(key)) throw serviceError('本次打桩操作正在执行', 409)
    const work = Promise.resolve().then(callback); this.queues.set(key, work)
    try { return await work } finally { this.queues.delete(key) }
  }
  async push(dataRoot, runId, taskId) {
    return this.exclusive(dataRoot, runId, taskId, async () => {
      const record = await this.read(dataRoot, runId, taskId), directory = await this.directory(dataRoot, runId, taskId)
      if (record.status === 'pushed') return record
      if (!['ready', 'interrupted'].includes(record.status) || !record.generation_complete) throw serviceError('请先完整生成本次代码修改')
      const controller = new AbortController(), key = this.key(dataRoot, runId, taskId)
      const operation = { controller, done: null }; this.active.set(key, operation)
      operation.done = (async () => {
        record.status = 'pushing'; record.error = null; await this.save(directory, record)
        try {
          for (const repo of record.repositories) {
            if (!repo.commit || repo.pushed) continue
            if (!repo.has_remote) throw serviceError(`${repo.repo_id} 未配置推送远端，请在原仓库配置远端后重新生成`)
            await this.git(repo.path, ['push', 'origin', `${repo.commit}:refs/heads/${repo.branch}`], controller.signal)
            repo.pushed = true; await this.save(directory, record)
          }
          record.status = 'pushed'
        } catch (error) { record.status = 'ready'; record.error = cleanError(error) }
        await this.save(directory, record)
        return record
      })().finally(() => this.active.delete(key))
      return operation.done
    })
  }
  async recordVerification(dataRoot, runId, taskId, input) {
    return this.exclusive(dataRoot, runId, taskId, async () => {
      const record = await this.read(dataRoot, runId, taskId)
      if (!record.repositories.some(repo => repo.commit)) throw serviceError('尚未生成可关联的修改提交')
      if (input.build) {
        const { url = '', package_id = '', package_sha256 = '', notes = '' } = input.build
        if (url && !/^https?:\/\//i.test(url)) throw serviceError('构建链接必须是 HTTP/HTTPS 地址')
        record.build = { url: String(url), package_id: String(package_id), package_sha256: String(package_sha256), notes: String(notes),
          commits: record.repositories.filter(repo => repo.commit).map(repo => ({ repo_id: repo.repo_id, commit: repo.commit })) }
      }
      if (input.verification) {
        const value = input.verification
        if (!record.case_keys.includes(value.case_key) || !['not_run', 'passed', 'failed', 'not_triggered'].includes(value.result)) throw serviceError('验证用例或结果无效')
        record.verification.push({ case_key: value.case_key, result: value.result, notes: String(value.notes || ''),
          hits: String(value.hits || ''), build: structuredClone(record.build), at: new Date().toISOString() })
      }
      await this.save(await this.directory(dataRoot, runId, taskId), record)
      return record
    })
  }
  async cancel(dataRoot, runId, taskId) {
    const operation = this.active.get(this.key(dataRoot, runId, taskId))
    if (operation) { operation.controller.abort(new Error('用户停止打桩任务')); await operation.done }
    return this.read(dataRoot, runId, taskId)
  }
  busy() { return this.active.size > 0 || this.queues.size > 0 }
  async dispose() {
    for (const operation of this.active.values()) operation.controller.abort(new Error('打桩任务已停止'))
    await Promise.allSettled([...this.active.values()].map(operation => operation.done))
    await Promise.allSettled(this.queues.values())
  }
}
