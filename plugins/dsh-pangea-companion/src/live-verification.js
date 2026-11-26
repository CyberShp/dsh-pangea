import { createServer } from 'node:http'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { appendFile, chmod, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeTaskStoreFile } from './task-store.js'
import { createDshSession, runtimeService } from './workbench-api.js'
import { requireAgentModel } from './agent-models.js'
import { workspaceRoot } from './pangea-api.js'
import { endpointAlias } from './execution/environment.js'
import { checkDangerousCommand } from './execution/ssh.js'
import {
  buildKnowledgeContextForLiveVerification,
  environmentToVerifyTopology,
  loadPangeaVerify,
  readVerifySettings,
  recordLiveVerificationCardFeedback,
} from './pangea-verify-bridge.js'

const CLI_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'live-verification-cli.mjs')
const VERIFY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const ACTIVE_STATUSES = new Set(['preflight', 'running'])
const MAX_TRANSCRIPT_FIELD = 16000

export const LIVE_VERDICT_VALUES = Object.freeze(['confirmed', 'excluded', 'not_triggered', 'blocked'])

export const LIVE_VERDICT_LABELS = Object.freeze({
  confirmed: '风险实锤',
  excluded: '实测排除',
  not_triggered: '桩未命中',
  blocked: '环境阻断',
})

export const LIVE_STATUS_LABELS = Object.freeze({
  preflight: 'Stage-0 在位预检中',
  running: '真机核验执行中',
  completed: '核验完成待确认',
  confirmed: '已确认归档',
  blocked: '预检阻断',
  failed: '执行失败',
  cancelled: '已停止',
  interrupted: '已中断',
  unreadable: '记录不可读',
})

const serviceError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })
const shellSingleQuote = text => `'${String(text ?? '').replace(/'/g, "'\\''")}'`
const posixPath = value => String(value ?? '').replaceAll('\\', '/')

export function buildPidLookupCommand(processName) {
  const quoted = shellSingleQuote(String(processName ?? '').trim())
  return `pidof ${quoted} 2>/dev/null || pgrep -x ${quoted} 2>/dev/null`
}

function parsePidList(stdout) {
  return [...new Set(String(stdout || '').trim().split(/\s+/).filter(token => /^\d+$/.test(token)))]
}

function truncateOutput(text) {
  const value = String(text ?? '')
  if (value.length <= MAX_TRANSCRIPT_FIELD) return value
  return `${value.slice(0, 7500)}\n…（输出过长，中间已省略 ${value.length - 15000} 字符）…\n${value.slice(-7500)}`
}

function liveVerificationRoot(dataRoot) {
  return path.join(path.resolve(dataRoot), '.pangea', 'live-verification')
}

function taskDir(dataRoot, verifyId) {
  if (!VERIFY_ID_RE.test(verifyId || '') || verifyId === '.' || verifyId === '..') {
    throw serviceError('无效的核验任务 ID')
  }
  return path.join(liveVerificationRoot(dataRoot), verifyId)
}

function recordFile(dataRoot, verifyId) {
  return path.join(taskDir(dataRoot, verifyId), 'record.json')
}

function transcriptFile(dataRoot, verifyId) {
  return path.join(taskDir(dataRoot, verifyId), 'ssh-transcript.jsonl')
}

function safeTokenEqual(provided, expected) {
  const a = Buffer.from(String(provided ?? ''), 'utf8')
  const b = Buffer.from(String(expected ?? ''), 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function readBodyJson(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0
    const chunks = []
    req.on('data', chunk => {
      total += chunk.length
      if (total > limit) {
        reject(serviceError('请求体过大', 413))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim()
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        reject(serviceError('无效的 JSON 请求体', 400))
      }
    })
    req.on('error', reject)
  })
}

export function hasPositiveHitCount(hits) {
  const text = String(hits ?? '').trim()
  if (!text) return false
  const matches = text.match(/(?:=|:\s*|hit[s]?\s*[:=]?\s*)(\d+)/gi)
  if (matches && matches.length) {
    return matches.some(m => {
      const num = m.match(/(\d+)/)
      return num && Number(num[1]) > 0
    })
  }
  return /^\d+$/.test(text) && Number(text) > 0
}

export function validateVerificationResult(result, { targetKeys = [], validCommandIds = new Set(), requireNonZeroHits = false } = {}) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { ok: false, error: '结果 JSON 必须是对象' }
  }
  if (!Array.isArray(result.items) || result.items.length === 0) {
    return { ok: false, error: '结果 JSON 必须包含非空 items 数组' }
  }
  const expectedSet = new Set(targetKeys)
  const seen = new Set()
  const normalizedItems = []
  for (const item of result.items) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'items 元素必须是对象' }
    const targetKey = typeof item.target_key === 'string' ? item.target_key.trim() : ''
    if (!targetKey) return { ok: false, error: 'items[].target_key 不能为空' }
    if (expectedSet.size > 0 && !expectedSet.has(targetKey)) {
      return { ok: false, error: `items[].target_key「${targetKey}」不在本次核验目标列表中` }
    }
    if (seen.has(targetKey)) return { ok: false, error: `items[].target_key「${targetKey}」重复` }
    seen.add(targetKey)
    const verdict = typeof item.verdict === 'string' ? item.verdict.trim() : ''
    if (!LIVE_VERDICT_VALUES.includes(verdict)) {
      return { ok: false, error: `items[${targetKey}].verdict 无效（须为 ${LIVE_VERDICT_VALUES.join(' / ')}）` }
    }
    const hits = typeof item.hits === 'string' ? item.hits.trim() : ''
    if (requireNonZeroHits && (verdict === 'confirmed' || verdict === 'excluded') && !hasPositiveHitCount(hits)) {
      return { ok: false, error: `items[${targetKey}] 在打桩核验模式下未观测到非零桩命中（hits="${hits || '空'}"），不得判为 ${verdict}；请补充真实命中计数或改判 not_triggered` }
    }
    const evidenceIds = Array.isArray(item.evidence_command_ids)
      ? [...new Set(item.evidence_command_ids.map(v => typeof v === 'string' ? v.trim() : '').filter(Boolean))]
      : []
    if (verdict !== 'blocked' && evidenceIds.length === 0) {
      return { ok: false, error: `items[${targetKey}] 给出 ${verdict} 结论时必须提供至少一条真实 evidence_command_ids` }
    }
    for (const cmdId of evidenceIds) {
      if (!validCommandIds.has(cmdId)) {
        return { ok: false, error: `items[${targetKey}] 引用了不存在的 command_id「${cmdId}」（必须引用宿主 SSH 网关实际返回的 command_id）` }
      }
    }
    normalizedItems.push({
      target_key: targetKey,
      verdict,
      hits,
      evidence_command_ids: evidenceIds,
      observed_behavior: typeof item.observed_behavior === 'string' ? item.observed_behavior.trim() : '',
      cleanup_verified: item.cleanup_verified === true,
      notes: typeof item.notes === 'string' ? item.notes.trim() : '',
    })
  }
  for (const key of expectedSet) {
    if (!seen.has(key)) return { ok: false, error: `缺少目标「${key}」的核验结论` }
  }
  return {
    ok: true,
    value: {
      summary: typeof result.summary === 'string' ? result.summary.trim() : '',
      items: normalizedItems,
      ...(Array.isArray(result.card_feedback) && result.card_feedback.length ? { card_feedback: result.card_feedback } : {}),
    },
  }
}

export function buildVerificationPrompt({ record, inputPath, outputPath, cliPath, configPath, maxGatewayCalls = 30, hasKnowledgePack = false }) {
  const cli = `node "${posixPath(cliPath)}"`
  const cfgFlag = `--config "${posixPath(configPath)}"`
  return [
    '你正在执行 PANGEA「真机风险动态核验」任务。所有远端真机 SSH 操作必须且只能通过宿主受控网关 CLI 执行，严禁尝试直接 ssh 或读取凭据文件。',
    `任务输入 JSON：${posixPath(inputPath)}（含待核验风险/用例完整步骤与双判据、打桩 points/profiles、环境业务拓扑与激励工具手册、冻结测试工具参考路径及 Stage-0 基线）。`,
    ...(hasKnowledgePack ? [
      '已挂载只读 Knowledge Pack（见 input.json.knowledge_catalog）：优先复用其中已转正（verified/human_attested）原子能力卡与白盒 code_cli_hints；严禁修改知识包文件，如遇卡片命令在当前固件版本失配，请在最终结果 JSON 的可选字段 card_feedback:[{card_id,command_id,error_summary}] 中记账。',
    ] : []),
    `最终结果 JSON 写入路径：${posixPath(outputPath)}。`,
    '',
    '可用宿主受控 SSH 网关命令（单次任务总调用上限 ' + maxGatewayCalls + ' 次；每次执行都会返回唯一 command_id 供证据引用）：',
    `- 非交互命令（含引号、$变量、管道或复杂脚本时优先写入 scratch 文件并用 --cmd-file 避免本地 shell 二次解析）：`,
    `  ${cli} exec ${cfgFlag} --target host|array --cmd "<命令>" [--timeout-ms 60000]`,
    `  ${cli} exec ${cfgFlag} --target host|array --cmd-file "<scratch内命令文件>" [--timeout-ms 60000]`,
    `- 后台长驻命令（如 Host 持续打流 / Array 尾随日志，亦支持 --cmd-file）：`,
    `  ${cli} bg-start ${cfgFlag} --target host|array --cmd "<命令>"`,
    `  ${cli} bg-read ${cfgFlag} --job-id "<job_id>" [--wait-ms 2000]`,
    `  ${cli} bg-stop ${cfgFlag} --job-id "<job_id>"`,
    `- 交互式 PTY（如 Array 侧 diagnose_usr -> attach -> 子命令，exchanges-file 为 JSON 数组 [{send, expect, timeout_seconds}]）：`,
    `  ${cli} interactive ${cfgFlag} --target array --exchanges-file "<scratch内json文件>"`,
    `- 登记异常兜底清理命令（在开启任何桩开关或创建控制文件前先登记，确保异常中断也能恢复真机）：`,
    `  ${cli} register-cleanup ${cfgFlag} --target host|array --cmd "<撤桩/清理命令>" --desc "<说明>"`,
    '',
    '四级命令寻址优先级（严禁凭空猜测私有命令）：',
    '1. 控桩与查命中：严格按 input.json 的 points[].enable / disable / observe 与 profiles[].safety 操作（如 diagnose_usr -> attach 或 /dev/shm 单次控制文件）。',
    '2. 业务激励命令来源（按优先级依次读取）：① input.json.instructions → ② environment.service_topology 与 environment.stimulus_playbook（业务口 IP / 已建测试 LUN / Host 现有发包 CLI）→ ③ profiles[].steps 与 targets[].tool_notes → ④ 只读读取本地冻结的 tool_reference_files 或源码 CLI 注册表确认参数。',
    '3. Phase 1 只读探活（建议 <= 8 次调用，零副作用）：先确认激励工具存在（which/--help）、现有业务对象（LUN/会话/端口）就绪、日志可读；若缺少专用发包器或需要破坏性新建存储池/网口才能测，立即停机输出 verdict="blocked" 并写明缺什么，严禁硬闯或瞎凑无关命令。',
    '4. Phase 2–4 挂桩激励与判定：① 先 register-cleanup 登记撤桩命令 → ② 开桩并下发业务激励 → ③ 核验 Array 实际命中日志（observe）与系统后果（对照 targets[].external_observation 与 exclusion_condition）→ ④ 主动撤桩并核验真机恢复。',
    '',
    '刚性刹车纪律与四态枚举：',
    '- 宿主网关内置防误操作安全带（拦截整机 reboot/poweroff/mkfs/写块设备/sysrq/断管理口/杀 sshd 等明显破坏性命令，并非安全沙箱）；每个目标必须引用真实 command_id，禁止伪造。',
    '- 零命中铁律：打桩模式下，只要未观测到非零桩命中（hits=0 或无命中），哪怕业务命令 exit 0，也严禁判为 confirmed 或 excluded（宿主校验会拒收），必须按实情判为 not_triggered。',
    '- "confirmed"：桩实际命中（hits > 0）且复现了预期风险现象/异常后果（崩溃、PID 重生、ASAN、泄漏增长或脏状态）；',
    '- "excluded"：桩实际命中（hits > 0）、业务路径已覆盖，但真机完整容错/排空未发生所述风险且符合排除条件；',
    '- "not_triggered"：执行完成但目标桩点未命中，无法定性；',
    '- "blocked"：环境、权限、前置对象或激励工具缺失导致无法完成核验。',
    '',
    `输出 JSON 格式写入 ${posixPath(outputPath)}：`,
    '{"summary":"总体核验摘要","items":[{"target_key":"<输入中的target_key>","verdict":"confirmed|excluded|not_triggered|blocked","hits":"如 INJ-001=1","evidence_command_ids":["cmd-0001"],"observed_behavior":"实际观察到的现象与关键日志","cleanup_verified":true,"notes":"补充说明或排查建议"}]}',
    '写完结果文件并确认 JSON 合法后立即结束回合。',
  ].join('\n')
}

export function createLiveVerificationRunner(runtime, {
  resolveModel = requireAgentModel,
  createSession = createDshSession,
  hardDurationMs = 20 * 60 * 1000,
} = {}) {
  return async ({ record, cwd, scratchDirectory, outputPath, prompt, signal, validateOutput, onStarted }) => {
    const root = workspaceRoot(cwd)
    const model = await resolveModel(runtime, { providerId: record.provider_id, model: record.agent_model, cwd: root })
    signal.throwIfAborted()
    const sessionId = await createSession(runtimeService(runtime, 'apiProxy'), root, `PANGEA 真机核验 · ${record.id.slice(0, 8)}`)
    const parent = runtimeService(runtime, 'agents')?.get?.(sessionId)
    if (!parent) throw new Error('真机核验会话尚未就绪')
    const subagents = runtimeService(runtime, 'subagents')
    let worker
    let hardTimer
    try {
      worker = await subagents.start(record.provider_id, {
        parent,
        signal,
        label: `真机核验 · ${record.id.slice(0, 8)}`,
        scratchDirectory,
        pangeaCliWorker: true,
        agentOptions: { model },
        prompt: [{ type: 'text', text: prompt }],
      })
      await onStarted?.({
        owner_session_id: sessionId,
        agent_session_id: String(worker.id),
        remote_session_id: worker.remoteSessionId ?? null,
      })
      const deadline = new Promise((_, reject) => {
        hardTimer = setTimeout(() => reject(new Error(`真机核验超过总时长上限（${Math.round(hardDurationMs / 1000)}s），已终止`)), hardDurationMs)
      })
      deadline.catch(() => {})
      await Promise.race([Promise.resolve(worker.result), deadline])
      signal.throwIfAborted()
      let rawText
      try { rawText = await readFile(outputPath, 'utf8') } catch { rawText = '' }
      let parsed = null
      try { parsed = rawText ? JSON.parse(rawText) : null } catch { parsed = null }
      let checked = validateOutput(parsed)
      if (!checked.ok && typeof worker.continuePrompt === 'function') {
        const repairPrompt = [
          `宿主对 ${posixPath(outputPath)} 的确定性证据校验未通过：${checked.error}`,
          '请保留已完成的真实核验事实，仅修正上述字段错误（确保 evidence_command_ids 均来自宿主网关实际返回的 command_id）并覆写结果文件后立即结束。',
        ].join('\n')
        await Promise.race([Promise.resolve(worker.continuePrompt([{ type: 'text', text: repairPrompt }])), deadline])
        signal.throwIfAborted()
        try { parsed = JSON.parse(await readFile(outputPath, 'utf8')) } catch { parsed = null }
        checked = validateOutput(parsed)
      }
      if (!checked.ok) throw new Error(`核验结果校验失败：${checked.error}`)
      return checked.value
    } finally {
      clearTimeout(hardTimer)
      try { await worker?.dispose?.() } catch {}
    }
  }
}

export class LiveVerificationService {
  constructor({ environments, ssh, runWorker = null, validateModel = null, maxGatewayCalls = null } = {}) {
    this.environments = environments
    this.ssh = ssh
    this.runWorker = runWorker
    this.validateModel = validateModel
    this.maxGatewayCalls = Number.isInteger(maxGatewayCalls) && maxGatewayCalls > 0 ? maxGatewayCalls : null
    this.active = new Map()
    this.lockedIps = new Map()
  }

  busy() {
    return this.active.size > 0
  }

  getLocks() {
    return Object.fromEntries([...this.lockedIps.entries()].map(([ip, info]) => [ip, { ...info }]))
  }

  getEnvironmentLock(envId) {
    if (!envId) return null
    for (const info of this.lockedIps.values()) {
      if (info.environment_id === envId) return { ...info }
    }
    return null
  }

  acquireLocks(environment, verifyId) {
    const keys = [...new Set([
      environment?.host?.ip,
      environment?.array?.ip,
      environment?.host?.legacy_alias ? `alias:${environment.host.legacy_alias}` : '',
      environment?.array?.legacy_alias ? `alias:${environment.array.legacy_alias}` : '',
      !environment?.host?.ip && !environment?.array?.ip && !environment?.host?.legacy_alias && !environment?.array?.legacy_alias && environment?.id ? `env:${environment.id}` : '',
    ].filter(Boolean))]
    for (const key of keys) {
      const holder = this.lockedIps.get(key)
      if (holder && holder.verify_id !== verifyId) {
        throw serviceError(`目标环境 ${key} 正被核验任务「${holder.verify_id}」占用，请等待其完成或停止后再启动`, 409)
      }
    }
    const info = { verify_id: verifyId, environment_id: environment.id, environment_name: environment.name, started_at: new Date().toISOString() }
    for (const key of keys) this.lockedIps.set(key, info)
    return keys
  }

  releaseLocks(ips, verifyId) {
    for (const ip of ips || []) {
      if (this.lockedIps.get(ip)?.verify_id === verifyId) this.lockedIps.delete(ip)
    }
  }

  async readRecord(dataRoot, verifyId) {
    const file = recordFile(dataRoot, verifyId)
    const activeKey = `${path.resolve(dataRoot)}\0${verifyId}`
    const wasActive = this.active.has(activeKey)
    let record
    try {
      record = JSON.parse(await readFile(file, 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') throw serviceError(`未找到核验任务：${verifyId}`, 404)
      return { id: verifyId, status: 'unreadable', error: error.message }
    }
    if (ACTIVE_STATUSES.has(record.status) && !this.active.has(activeKey)) {
      if (wasActive) {
        try { return JSON.parse(await readFile(file, 'utf8')) } catch {}
      }
      record = { ...record, status: 'interrupted', error: record.error || '宿主进程重启，原核验任务已中断' }
      try { await writeTaskStoreFile(file, `${JSON.stringify(record, null, 2)}\n`) } catch {}
    }
    return record
  }

  async readTranscript(dataRoot, verifyId) {
    try {
      const text = await readFile(transcriptFile(dataRoot, verifyId), 'utf8')
      return text.split(/\r?\n/).filter(Boolean).map(line => {
        try { return JSON.parse(line) } catch { return null }
      }).filter(Boolean)
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
  }

  async list(dataRoot) {
    const root = liveVerificationRoot(dataRoot)
    let entries
    try { entries = await readdir(root, { withFileTypes: true }) } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
    const tasks = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !VERIFY_ID_RE.test(entry.name)) continue
      tasks.push(await this.readRecord(dataRoot, entry.name))
    }
    return tasks.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  }

  async get(dataRoot, verifyId) {
    const task = await this.readRecord(dataRoot, verifyId)
    const transcript = await this.readTranscript(dataRoot, verifyId)
    return { task, transcript }
  }

  async saveRecord(dataRoot, record) {
    record.updated_at = new Date().toISOString()
    await writeTaskStoreFile(recordFile(dataRoot, record.id), `${JSON.stringify(record, null, 2)}\n`)
    return record
  }

  async start(input = {}) {
    const {
      dataRoot, cwd, name = '', mode = 'fault_injection', environment_id: envId,
      provider_id: providerId = '', agent_model: agentModel = '',
      run_id: runId = '', fault_injection_task_id: fiTaskId = '', fault_injection_build_id: fiBuildId = '',
      targets = [], marker_strings: markerStrings = [], points = [], profiles = [], replace_files: replaceFiles = [],
      analysis_context: analysisContext = null, tool_reference_files: toolReferenceFiles = [],
      reference_warnings: referenceWarnings = [],
      target_process: targetProcess = '', target_pid: targetPid = '', target_binary: targetBinary = '',
      knowledge_pack_dir: knowledgePackDir = '',
      instructions = '', max_gateway_calls: maxGatewayCallsInput = null,
    } = input
    if (!dataRoot) throw serviceError('data_root 不能为空')
    if (!envId) throw serviceError('请选择目标真机环境')
    const environment = await this.environments?.get(envId)
    if (!environment) throw serviceError(`未找到目标环境：${envId}`, 404)
    if (!Array.isArray(targets) || targets.length === 0) throw serviceError('请至少选择一个待核验的风险或用例')
    const normalizedTargets = targets.map(item => {
      const normalized = {
        target_key: String(item.target_key || item.case_key || item.risk_id || item.key || '').trim(),
        ...(item.display_id ? { display_id: String(item.display_id).trim() } : {}),
        title: String(item.title || item.target_key || '').trim(),
        kind: item.kind === 'risk' ? 'risk' : 'case',
        severity: item.severity || '',
        trigger: item.trigger || '',
        ...(Array.isArray(item.interleaving_or_path) && item.interleaving_or_path.length ? { interleaving_or_path: item.interleaving_or_path } : {}),
        ...(item.system_result ? { system_result: item.system_result } : {}),
        ...(item.runtime_uncertainty ? { runtime_uncertainty: item.runtime_uncertainty } : {}),
        external_observation: item.external_observation || '',
        ...(item.exclusion_condition ? { exclusion_condition: item.exclusion_condition } : {}),
        ...(item.entry ? { entry: item.entry } : {}),
        ...(item.preconditions ? { preconditions: item.preconditions } : {}),
        ...(item.steps ? { steps: item.steps } : {}),
        ...(item.expected_results ? { expected_results: item.expected_results } : {}),
        ...(item.observability ? { observability: item.observability } : {}),
        ...(item.cleanup ? { cleanup: item.cleanup } : {}),
        ...(Array.isArray(item.source_evidence) && item.source_evidence.length ? { source_evidence: item.source_evidence } : {}),
        ...(Array.isArray(item.tool_notes) && item.tool_notes.length ? { tool_notes: item.tool_notes } : {}),
        ...(item.source_fi_task_id ? { source_fi_task_id: item.source_fi_task_id } : {}),
        ...(item.source_run_id ? { source_run_id: item.source_run_id } : {}),
      }
      if (!normalized.target_key) return normalized
      normalized.content_hash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 16)
      return normalized
    }).filter(item => item.target_key)
    if (!normalizedTargets.length) throw serviceError('核验目标缺少有效的 target_key')
    if (!this.runWorker) throw serviceError('当前运行时未配置核验执行器', 503)
    let resolvedModel = agentModel
    if (this.validateModel) {
      const validated = await this.validateModel({ providerId, model: agentModel, cwd })
      if (typeof validated === 'string' && validated.trim()) resolvedModel = validated.trim()
    }

    const verifyId = `lv-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${randomUUID().slice(0, 6)}`
    const lockedIps = this.acquireLocks(environment, verifyId)
    let scratchDirectory
    let record
    const resolvedHosts = {}
    try {
      if (typeof this.ssh?.resolve === 'function') {
        if (environment.host) {
          resolvedHosts.host = await this.ssh.resolve(environment.host_alias || endpointAlias(environment.id, 'host'))
        }
        if (environment.array) {
          resolvedHosts.array = await this.ssh.resolve(environment.array_alias || endpointAlias(environment.id, 'array'))
        }
      }
      const dir = taskDir(dataRoot, verifyId)
      scratchDirectory = path.join(dir, 'scratch')
      await mkdir(scratchDirectory, { recursive: true })

      const effectiveProcess = String(targetProcess || environment.array?.default_process || '').trim()
      const markers = [...new Set((Array.isArray(markerStrings) ? markerStrings : []).map(v => String(v ?? '').trim()).filter(Boolean))]
      const dynamicBudget = Math.min(120, Math.max(30, 14 + normalizedTargets.length * 8))
      const effectiveMaxCalls = Number.isInteger(maxGatewayCallsInput) && maxGatewayCallsInput > 0
        ? maxGatewayCallsInput
        : (this.maxGatewayCalls ?? dynamicBudget)
      const verifySettings = await readVerifySettings(dataRoot)
      const effectiveKnowledgePackDir = String(knowledgePackDir || verifySettings.knowledge_pack_dir || '').trim()
      record = {
        schema_version: 1,
        id: verifyId,
        name: String(name || '').trim() || `真机核验 · ${environment.name}`,
        mode: mode === 'direct_risk' ? 'direct_risk' : 'fault_injection',
        status: 'preflight',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        run_id: runId || null,
        fault_injection_task_id: fiTaskId || null,
        fault_injection_build_id: fiBuildId || null,
        environment: {
          id: environment.id,
          name: environment.name,
          host_ip: environment.host?.ip || '',
          array_ip: environment.array?.ip || '',
        },
        provider_id: providerId,
        agent_model: resolvedModel,
        target_process: effectiveProcess,
        target_pid: String(targetPid || '').trim(),
        target_binary: String(targetBinary || '').trim(),
        knowledge_pack_dir: effectiveKnowledgePackDir,
        marker_strings: markers,
        targets: normalizedTargets,
        instructions: String(instructions || '').trim(),
        max_gateway_calls: effectiveMaxCalls,
        gateway_calls_used: 0,
        preflight: null,
        worker_session: null,
        registered_cleanups: [],
        reference_warnings: Array.isArray(referenceWarnings) ? referenceWarnings.map(String).filter(Boolean) : [],
        recorded_card_feedback: [],
        draft_verdicts: [],
        confirmed_verdicts: [],
        confirmed_at: null,
        summary: '',
        cleanup: null,
        sync_warnings: [],
        synced_fi_verdicts: {},
        error: '',
      }
      await this.saveRecord(dataRoot, record)
    } catch (error) {
      this.releaseLocks(lockedIps, verifyId)
      throw error
    }

    const controller = new AbortController()
    const key = `${path.resolve(dataRoot)}\0${verifyId}`
    const runPromise = this.executeTask({
      dataRoot, cwd, record, environment, resolvedHosts, lockedIps, scratchDirectory, points, profiles, replaceFiles,
      analysisContext, toolReferenceFiles, maxGatewayCalls: record.max_gateway_calls, signal: controller.signal,
    }).finally(() => {
      this.releaseLocks(lockedIps, verifyId)
      this.active.delete(key)
    })
    this.active.set(key, { controller, done: runPromise, verifyId })
    return record
  }

  async executeTask({ dataRoot, cwd, record, environment, resolvedHosts = {}, scratchDirectory, points, profiles, replaceFiles, analysisContext = null, toolReferenceFiles = [], maxGatewayCalls = 30, signal }) {
    const tFile = transcriptFile(dataRoot, record.id)
    const gatewayConfigPath = path.join(scratchDirectory, '.gateway.json')
    const canUseUnifiedGateway = typeof this.ssh?.createSession === 'function'
      && !environment.host?.legacy_alias
      && !environment.array?.legacy_alias
    const pvLoaded = canUseUnifiedGateway ? await loadPangeaVerify() : null
    const usePvGateway = Boolean(pvLoaded?.mod?.startGatewaySession)

    if (usePvGateway) {
      const resolvedTopology = environmentToVerifyTopology(environment, resolvedHosts)
      let pvSession = null
      let lastCleanupCount = 0
      try {
        pvSession = await pvLoaded.mod.startGatewaySession({
          sessionId: record.id,
          resolvedTopology,
          transcriptPath: tFile,
          gatewayConfigPath,
          maxCalls: maxGatewayCalls,
          initialPhase: 'probe_readonly',
          actorPhaseLabel: 'worker',
          signal,
          onStateChange: async ({ phase, callsUsed, registeredCleanups }) => {
            record.gate_phase = phase
            record.gateway_calls_used = callsUsed
            record.registered_cleanups = registeredCleanups
            if (registeredCleanups.length !== lastCleanupCount) {
              lastCleanupCount = registeredCleanups.length
              await this.saveRecord(dataRoot, record)
            }
          },
        })

        const preflight = await this.runPreflight({
          record,
          environment,
          replaceFiles,
          execLogged: (t, cmd, opts = {}) => pvSession.execInternalSsh(t, cmd, {
            timeoutMs: opts.timeoutMs ?? 60_000,
            enforceSafety: opts.guard === true,
            safetyPhase: 'preflight',
            phaseLabel: opts.phase || 'preflight',
            execSignal: signal,
          }),
        })
        record.preflight = preflight
        if (!preflight.ok) {
          record.status = 'blocked'
          record.error = preflight.error || 'Stage-0 在位预检未通过'
          record.draft_verdicts = record.targets.map(t => ({
            target_key: t.target_key,
            verdict: 'blocked',
            hits: '',
            evidence_command_ids: preflight.command_ids || [],
            observed_behavior: preflight.error || 'Stage-0 预检未通过',
            cleanup_verified: true,
            notes: preflight.guidance || '',
          }))
          await this.saveRecord(dataRoot, record)
          return
        }
        signal.throwIfAborted()

        record.status = 'running'
        record.gate_phase = pvSession.getPhase()
        await this.saveRecord(dataRoot, record)

        const kpBridge = await buildKnowledgeContextForLiveVerification({
          dataRoot,
          packDir: record.knowledge_pack_dir,
          targets: record.targets,
          environment,
        })
        if (kpBridge.warning) {
          record.reference_warnings = [...(record.reference_warnings || []), kpBridge.warning]
        }

        const inputPath = path.join(scratchDirectory, 'input.json')
        const outputPath = path.join(scratchDirectory, 'result.json')
        await writeFile(inputPath, `${JSON.stringify({
          verify_id: record.id,
          mode: record.mode,
          environment: {
            name: environment.name,
            ...(environment.service_topology ? { service_topology: environment.service_topology } : {}),
            ...(environment.stimulus_playbook ? { stimulus_playbook: environment.stimulus_playbook } : {}),
            has_host: Boolean(environment.host),
            host_ip: environment.host?.ip || '',
            host_default_workdir: environment.host?.default_workdir || '',
            has_array: Boolean(environment.array),
            array_ip: environment.array?.ip || '',
            array_default_process: environment.array?.default_process || '',
            array_default_log_paths: environment.array?.default_log_paths || [],
          },
          preflight: record.preflight,
          targets: record.targets,
          ...(analysisContext ? { analysis_context: analysisContext } : {}),
          ...(Array.isArray(toolReferenceFiles) && toolReferenceFiles.length ? { tool_reference_files: toolReferenceFiles } : {}),
          ...(kpBridge.context ? { knowledge_catalog: kpBridge.context } : {}),
          marker_strings: record.marker_strings,
          points,
          profiles,
          instructions: record.instructions,
        }, null, 2)}\n`, 'utf8')

        const prompt = buildVerificationPrompt({
          record,
          inputPath,
          outputPath,
          cliPath: CLI_PATH,
          configPath: gatewayConfigPath,
          maxGatewayCalls,
          hasKnowledgePack: Boolean(kpBridge.context),
        })
        const targetKeys = record.targets.map(t => t.target_key)
        const requireNonZeroHits = record.mode === 'fault_injection' && Array.isArray(points) && points.length > 0
        const verified = await this.runWorker({
          record,
          cwd,
          scratchDirectory,
          inputPath,
          outputPath,
          prompt,
          gatewayUrl: pvSession.gatewayUrl,
          gatewayToken: pvSession.token,
          gatewayConfigPath,
          cliPath: CLI_PATH,
          signal,
          validateOutput: candidate => validateVerificationResult(candidate, { targetKeys, validCommandIds: pvSession.validCommandIds, requireNonZeroHits }),
          onStarted: async sessionInfo => {
            record.worker_session = sessionInfo
            await this.saveRecord(dataRoot, record)
          },
        })
        const checked = validateVerificationResult(verified, { targetKeys, validCommandIds: pvSession.validCommandIds, requireNonZeroHits })
        if (!checked.ok) throw new Error(`核验结果校验失败：${checked.error}`)

        if (kpBridge.packDir && Array.isArray(checked.value.card_feedback) && checked.value.card_feedback.length) {
          record.recorded_card_feedback = await recordLiveVerificationCardFeedback({
            dataRoot,
            packDir: kpBridge.packDir,
            sessionId: record.id,
            feedback: checked.value.card_feedback,
          })
        }

        record.summary = checked.value.summary
        record.draft_verdicts = checked.value.items
        record._pending_terminal_status = 'completed'
      } catch (error) {
        if (signal.aborted) {
          record._pending_terminal_status = 'cancelled'
          record.error = '用户已停止本次真机核验'
        } else {
          record._pending_terminal_status = 'failed'
          record.error = error instanceof Error ? error.message : String(error)
        }
      } finally {
        if (pvSession) {
          if (record.preflight?.ok) {
            const cleanupReport = await pvSession.runCleanups({ onlyPending: true })
            let postCheck = null
            if (record.preflight?.baseline?.process && environment.array) {
              try {
                const pidRes = await pvSession.execInternalSsh('array', buildPidLookupCommand(record.preflight.baseline.process), {
                  timeoutMs: 15_000,
                  enforceSafety: false,
                  safetyPhase: 'post_check',
                  phaseLabel: 'post_check',
                  execSignal: null,
                })
                const afterPids = parsePidList(pidRes.stdout)
                const afterPid = afterPids[0] || ''
                const baselinePid = record.preflight.baseline.pid || ''
                postCheck = {
                  baseline_pid: baselinePid,
                  after_pid: afterPid,
                  after_pids: afterPids,
                  pid_changed: Boolean(baselinePid && afterPids.length > 0 && !afterPids.includes(baselinePid)),
                  process_alive: afterPids.length > 0,
                  command_id: pidRes.command_id,
                }
              } catch {}
            }
            record.cleanup = { ...cleanupReport, post_check: postCheck }
          }
          await pvSession.close({ runCleanups: false })
        }
        if (record._pending_terminal_status) {
          record.status = record._pending_terminal_status
          delete record._pending_terminal_status
          try { await this.saveRecord(dataRoot, record) } catch {}
        }
      }
      return
    }

    let seq = 0
    const validCommandIds = new Set()
    const registeredCleanups = []
    const sshSessions = {}
    if (typeof this.ssh?.createSession === 'function') {
      if (resolvedHosts.host) sshSessions.host = this.ssh.createSession(resolvedHosts.host)
      if (resolvedHosts.array) sshSessions.array = this.ssh.createSession(resolvedHosts.array)
    }
    const appendTranscript = async entry => {
      seq += 1
      const commandId = `cmd-${String(seq).padStart(4, '0')}`
      validCommandIds.add(commandId)
      const signed = { command_id: commandId, seq, at: new Date().toISOString(), ...entry }
      await appendFile(tFile, `${JSON.stringify(signed)}\n`, 'utf8')
      return signed
    }

    const resolveAlias = target => {
      if (target === 'host') {
        if (!environment.host) throw serviceError('当前环境未配置测试主机（Host）连接')
        return environment.host_alias || endpointAlias(environment.id, 'host')
      }
      if (target === 'array') {
        if (!environment.array) throw serviceError('当前环境未配置存储阵列（Array）连接')
        return environment.array_alias || endpointAlias(environment.id, 'array')
      }
      throw serviceError('target 必须为 host 或 array')
    }

    const execLogged = async (target, command, { timeoutMs = 60_000, guard = true, phase = 'worker', execSignal = null } = {}) => {
      const alias = resolveAlias(target)
      if (guard) {
        const check = checkDangerousCommand(command)
        if (check.blocked) {
          const signed = await appendTranscript({
            phase, target, kind: 'exec', command, blocked: true, exit_code: null,
            duration_ms: 0, stdout: '', stderr: '', error: check.reason,
          })
          return { ...signed, success: false }
        }
      }
      const res = await this.ssh.exec(alias, command, timeoutMs, {
        guard: false,
        host: resolvedHosts[target] || null,
        session: sshSessions[target] || null,
        signal: execSignal,
      })
      const signed = await appendTranscript({
        phase, target, kind: 'exec', command, blocked: false,
        exit_code: res.exit_code, timed_out: Boolean(res.timed_out),
        duration_ms: res.duration_ms ?? 0,
        stdout: truncateOutput(res.stdout),
        stderr: truncateOutput(res.stderr),
        ...(res.error ? { error: res.error } : {}),
      })
      return { ...signed, success: res.success }
    }

    let gatewayServer = null
    try {
      // Stage 0: Host Pre-flight
      const preflight = await this.runPreflight({ record, environment, replaceFiles, execLogged: (t, cmd, opts) => execLogged(t, cmd, { ...opts, execSignal: signal }) })
      record.preflight = preflight
      if (!preflight.ok) {
        record.status = 'blocked'
        record.error = preflight.error || 'Stage-0 在位预检未通过'
        record.draft_verdicts = record.targets.map(t => ({
          target_key: t.target_key,
          verdict: 'blocked',
          hits: '',
          evidence_command_ids: preflight.command_ids || [],
          observed_behavior: preflight.error || 'Stage-0 预检未通过',
          cleanup_verified: true,
          notes: preflight.guidance || '',
        }))
        await this.saveRecord(dataRoot, record)
        return
      }
      signal.throwIfAborted()

      // Transition to running and start ephemeral loopback SSH gateway
      record.status = 'running'
      await this.saveRecord(dataRoot, record)

      const token = randomBytes(32).toString('hex')
      let gatewayCalls = 0
      gatewayServer = createServer(async (req, res) => {
        const respond = (code, payload) => {
          res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(`${JSON.stringify(payload)}\n`)
        }
        try {
          if (req.method !== 'POST') return respond(405, { error: 'method-not-allowed' })
          const auth = String(req.headers.authorization || '')
          if (!auth.startsWith('Bearer ') || !safeTokenEqual(auth.slice(7), token)) {
            return respond(401, { error: 'unauthorized' })
          }
          const body = await readBodyJson(req)
          const route = new URL(req.url || '/', 'http://127.0.0.1').pathname
          if (['/exec', '/bg-start', '/interactive'].includes(route)) {
            if (gatewayCalls >= maxGatewayCalls) {
              return respond(429, { error: `已达到单次真机核验 SSH 网关调用上限（${maxGatewayCalls} 次），请停止探测并立即根据已有真实证据写入结果文件收口` })
            }
            gatewayCalls += 1
            record.gateway_calls_used = gatewayCalls
          }
          if (route === '/exec') {
            const clampedTimeout = Math.min(Math.max(Number(body.timeout_ms) || 60_000, 1000), 180_000)
            const result = await execLogged(body.target, String(body.command || ''), { timeoutMs: clampedTimeout, guard: true, phase: 'worker', execSignal: signal })
            return respond(result.blocked ? 403 : 200, result)
          }
          if (route === '/bg-start') {
            const cmd = String(body.command || '')
            const check = checkDangerousCommand(cmd)
            if (check.blocked) {
              const signed = await appendTranscript({ phase: 'worker', target: body.target, kind: 'bg-start', command: cmd, blocked: true, exit_code: null, duration_ms: 0, stdout: '', stderr: '', error: check.reason })
              return respond(403, signed)
            }
            const alias = resolveAlias(body.target)
            const job = await this.ssh.start(alias, cmd, { ownerId: record.id, guard: false, host: resolvedHosts[body.target] || null })
            const signed = await appendTranscript({ phase: 'worker', target: body.target, kind: 'bg-start', command: cmd, job_id: job.job_id, blocked: false, exit_code: job.exit_code, duration_ms: 0, stdout: truncateOutput(job.stdout), stderr: truncateOutput(job.stderr) })
            return respond(200, { ...job, command_id: signed.command_id })
          }
          if (route === '/bg-read') {
            const job = await this.ssh.read(String(body.job_id || ''), Number(body.wait_ms) || 0)
            const signed = await appendTranscript({ phase: 'worker', target: 'bg', kind: 'bg-read', job_id: job.job_id, blocked: false, exit_code: job.exit_code, duration_ms: 0, stdout: truncateOutput(job.stdout), stderr: truncateOutput(job.stderr) })
            return respond(200, { ...job, command_id: signed.command_id })
          }
          if (route === '/bg-stop') {
            const job = await this.ssh.stop(String(body.job_id || ''))
            const signed = await appendTranscript({ phase: 'worker', target: 'bg', kind: 'bg-stop', job_id: job.job_id, blocked: false, exit_code: job.exit_code, duration_ms: 0, stdout: truncateOutput(job.stdout), stderr: truncateOutput(job.stderr) })
            return respond(200, { ...job, command_id: signed.command_id })
          }
          if (route === '/interactive') {
            const exchanges = Array.isArray(body.exchanges) ? body.exchanges : []
            for (const ex of exchanges) {
              const check = checkDangerousCommand(ex?.send)
              if (check.blocked) {
                const signed = await appendTranscript({ phase: 'worker', target: body.target, kind: 'interactive', command: String(ex?.send || ''), blocked: true, exit_code: null, duration_ms: 0, stdout: '', stderr: '', error: check.reason })
                return respond(403, signed)
              }
            }
            const alias = resolveAlias(body.target)
            const resInteractive = await this.ssh.interactive(alias, exchanges, { guard: false, host: resolvedHosts[body.target] || null, session: sshSessions[body.target] || null, signal })
            const signed = await appendTranscript({
              phase: 'worker', target: body.target, kind: 'interactive',
              command: exchanges.map(e => e.send).join(' -> '),
              blocked: false, exit_code: resInteractive.exit_code,
              duration_ms: resInteractive.duration_ms ?? 0,
              stdout: truncateOutput(resInteractive.stdout),
              stderr: truncateOutput(resInteractive.stderr),
              ...(resInteractive.error ? { error: resInteractive.error } : {}),
            })
            return respond(200, { ...resInteractive, command_id: signed.command_id })
          }
          if (route === '/register-cleanup') {
            const cmd = String(body.command || '').trim()
            if (!cmd) return respond(400, { error: 'command 不能为空' })
            const check = checkDangerousCommand(cmd)
            if (check.blocked) return respond(403, { blocked: true, error: check.reason })
            resolveAlias(body.target)
            const entry = { target: body.target, command: cmd, description: String(body.description || '').trim(), registered_at: new Date().toISOString() }
            registeredCleanups.push(entry)
            record.registered_cleanups = [...registeredCleanups]
            await this.saveRecord(dataRoot, record)
            return respond(200, { ok: true, count: registeredCleanups.length })
          }
          return respond(404, { error: 'not-found' })
        } catch (error) {
          return respond(error.statusCode ?? 400, { error: error instanceof Error ? error.message : String(error) })
        }
      })
      await new Promise((resolve, reject) => {
        gatewayServer.once('error', reject)
        gatewayServer.listen(0, '127.0.0.1', resolve)
      })
      const gatewayUrl = `http://127.0.0.1:${gatewayServer.address().port}`
      await writeFile(gatewayConfigPath, `${JSON.stringify({ url: gatewayUrl, token })}\n`, { encoding: 'utf8', mode: 0o600 })
      try { await chmod(gatewayConfigPath, 0o600) } catch {}

      const kpBridge = await buildKnowledgeContextForLiveVerification({
        packDir: record.knowledge_pack_dir,
        targets: record.targets,
        environment,
      })
      if (kpBridge.warning) {
        record.reference_warnings = [...(record.reference_warnings || []), kpBridge.warning]
      }

      const inputPath = path.join(scratchDirectory, 'input.json')
      const outputPath = path.join(scratchDirectory, 'result.json')
      await writeFile(inputPath, `${JSON.stringify({
        verify_id: record.id,
        mode: record.mode,
        environment: {
          name: environment.name,
          ...(environment.service_topology ? { service_topology: environment.service_topology } : {}),
          ...(environment.stimulus_playbook ? { stimulus_playbook: environment.stimulus_playbook } : {}),
          has_host: Boolean(environment.host),
          host_ip: environment.host?.ip || '',
          host_default_workdir: environment.host?.default_workdir || '',
          has_array: Boolean(environment.array),
          array_ip: environment.array?.ip || '',
          array_default_process: environment.array?.default_process || '',
          array_default_log_paths: environment.array?.default_log_paths || [],
        },
        preflight: record.preflight,
        targets: record.targets,
        ...(analysisContext ? { analysis_context: analysisContext } : {}),
        ...(Array.isArray(toolReferenceFiles) && toolReferenceFiles.length ? { tool_reference_files: toolReferenceFiles } : {}),
        ...(kpBridge.context ? { knowledge_catalog: kpBridge.context } : {}),
        marker_strings: record.marker_strings,
        points,
        profiles,
        instructions: record.instructions,
      }, null, 2)}\n`, 'utf8')

      const prompt = buildVerificationPrompt({
        record,
        inputPath,
        outputPath,
        cliPath: CLI_PATH,
        configPath: gatewayConfigPath,
        maxGatewayCalls,
        hasKnowledgePack: Boolean(kpBridge.context),
      })
      const targetKeys = record.targets.map(t => t.target_key)
      const requireNonZeroHits = record.mode === 'fault_injection' && Array.isArray(points) && points.length > 0
      const verified = await this.runWorker({
        record,
        cwd,
        scratchDirectory,
        inputPath,
        outputPath,
        prompt,
        gatewayUrl,
        gatewayToken: token,
        gatewayConfigPath,
        cliPath: CLI_PATH,
        signal,
        validateOutput: candidate => validateVerificationResult(candidate, { targetKeys, validCommandIds, requireNonZeroHits }),
        onStarted: async sessionInfo => {
          record.worker_session = sessionInfo
          await this.saveRecord(dataRoot, record)
        },
      })
      const checked = validateVerificationResult(verified, { targetKeys, validCommandIds, requireNonZeroHits })
      if (!checked.ok) throw new Error(`核验结果校验失败：${checked.error}`)

      if (kpBridge.packDir && Array.isArray(checked.value.card_feedback) && checked.value.card_feedback.length) {
        record.recorded_card_feedback = await recordLiveVerificationCardFeedback({
          packDir: kpBridge.packDir,
          sessionId: record.id,
          feedback: checked.value.card_feedback,
        })
      }

      record.summary = checked.value.summary
      record.draft_verdicts = checked.value.items
      record._pending_terminal_status = 'completed'
    } catch (error) {
      if (signal.aborted) {
        record._pending_terminal_status = 'cancelled'
        record.error = '用户已停止本次真机核验'
      } else {
        record._pending_terminal_status = 'failed'
        record.error = error instanceof Error ? error.message : String(error)
      }
    } finally {
      try { await unlink(gatewayConfigPath) } catch {}
      if (gatewayServer) {
        try { gatewayServer.closeAllConnections?.() } catch {}
        await new Promise(resolve => gatewayServer.close(() => resolve()))
      }
      // Host finally cleanup: dispose background SSH jobs + run registered cleanup + post-check baseline
      try { await this.ssh?.disposeOwner?.(record.id) } catch {}
      if (record.preflight?.ok) {
        const cleanupReport = { status: 'ok', steps: [], post_check: null }
        for (const item of [...registeredCleanups].reverse()) {
          try {
            const res = await execLogged(item.target, item.command, { timeoutMs: 30_000, guard: true, phase: 'cleanup' })
            cleanupReport.steps.push({ target: item.target, description: item.description, command_id: res.command_id, ok: res.success, exit_code: res.exit_code })
            if (!res.success) cleanupReport.status = 'failed'
          } catch (cleanupErr) {
            cleanupReport.steps.push({ target: item.target, description: item.description, ok: false, error: cleanupErr.message })
            cleanupReport.status = 'failed'
          }
        }
        if (record.preflight?.baseline?.process && environment.array) {
          try {
            const pidRes = await execLogged('array', buildPidLookupCommand(record.preflight.baseline.process), { timeoutMs: 15_000, guard: false, phase: 'post_check' })
            const afterPids = parsePidList(pidRes.stdout)
            const afterPid = afterPids[0] || ''
            const baselinePid = record.preflight.baseline.pid || ''
            cleanupReport.post_check = {
              baseline_pid: baselinePid,
              after_pid: afterPid,
              after_pids: afterPids,
              pid_changed: Boolean(baselinePid && afterPids.length > 0 && !afterPids.includes(baselinePid)),
              process_alive: afterPids.length > 0,
              command_id: pidRes.command_id,
            }
          } catch {}
        }
        record.cleanup = cleanupReport
      }
      if (record._pending_terminal_status) {
        record.status = record._pending_terminal_status
        delete record._pending_terminal_status
        try { await this.saveRecord(dataRoot, record) } catch {}
      }
      for (const session of Object.values(sshSessions)) {
        try { session?.close?.() } catch {}
      }
    }
  }

  async runPreflight({ record, environment, replaceFiles = [], execLogged }) {
    const commandIds = []
    const checks = []
    const endpointsToCheck = [
      ...(environment.host ? ['host'] : []),
      ...(environment.array ? ['array'] : []),
    ]
    for (const target of endpointsToCheck) {
      try {
        const res = await execLogged(target, 'echo PANGEA_PREFLIGHT_OK', { timeoutMs: 15_000, guard: false, phase: 'preflight' })
        commandIds.push(res.command_id)
        const ok = res.success && /PANGEA_PREFLIGHT_OK/.test(res.stdout || '')
        checks.push({ kind: 'ssh', target, ok, command_id: res.command_id, detail: ok ? 'SSH 连通正常' : (res.error || res.stderr || `exit ${res.exit_code}`) })
        if (!ok) {
          return {
            ok: false,
            error: `${target === 'array' ? '存储阵列' : '测试主机'} SSH 连通预检失败：${res.error || res.stderr || `exit ${res.exit_code}`}`,
            guidance: '请检查目标 IP、端口、用户名、凭据及网络直连状态。',
            checks,
            command_ids: commandIds,
            baseline: null,
          }
        }
      } catch (error) {
        return {
          ok: false,
          error: `${target === 'array' ? '存储阵列' : '测试主机'} SSH 连接异常：${error.message}`,
          guidance: '请先在「环境管理」中点击“测试连接”确认直连可达。',
          checks,
          command_ids: commandIds,
          baseline: null,
        }
      }
    }

    const baseline = { process: record.target_process || '', pid: record.target_pid || '', binary_path: record.target_binary || '' }
    let ambiguousPids = []
    if (environment.array && !baseline.pid && baseline.process) {
      const pidCmd = buildPidLookupCommand(baseline.process)
      const pidRes = await execLogged('array', pidCmd, { timeoutMs: 15_000, guard: false, phase: 'preflight' })
      commandIds.push(pidRes.command_id)
      const pids = parsePidList(pidRes.stdout)
      if (pids.length === 1) baseline.pid = pids[0]
      else if (pids.length > 1) {
        ambiguousPids = pids
        baseline.candidate_pids = pids
      }
    }

    if (record.mode === 'fault_injection' && record.marker_strings.length > 0) {
      if (!environment.array) {
        return {
          ok: false,
          error: '打桩核验模式要求配置「存储阵列（Array）」端以执行 Stage-0 二进制标记在位核验',
          guidance: '请在「环境管理」中为该环境补充存储阵列 SSH 连接信息。',
          checks,
          command_ids: commandIds,
          baseline,
        }
      }
      let verifyTarget = baseline.binary_path
      if (!verifyTarget && ambiguousPids.length > 1) {
        return {
          ok: false,
          error: `Stage-0 预检发现多个名为「${baseline.process}」的进程 PID（${ambiguousPids.join(', ')}），无法唯一确定目标二进制`,
          guidance: '请在核验表单中显式填写「目标 PID」或「部署二进制绝对路径」后重试。',
          checks,
          command_ids: commandIds,
          baseline,
        }
      }
      if (!verifyTarget && baseline.pid) verifyTarget = `/proc/${baseline.pid}/exe`
      if (!verifyTarget) {
        const absReplace = (replaceFiles || []).find(item => typeof item?.artifact === 'string' && item.artifact.startsWith('/'))
        if (absReplace) verifyTarget = absReplace.artifact
      }
      if (!verifyTarget) {
        return {
          ok: false,
          error: 'Stage-0 预检无法确定待核验的真机运行二进制（未找到运行进程 PID 且未指定二进制路径）',
          guidance: '请在核验表单中填写「目标守护进程名」「PID」或「部署二进制绝对路径」，确认带桩包已烧入并启动。',
          checks,
          command_ids: commandIds,
          baseline,
        }
      }
      baseline.binary_path = verifyTarget
      const missingMarkers = []
      for (const marker of record.marker_strings) {
        const cmd = `grep -aFq -- ${shellSingleQuote(marker)} ${shellSingleQuote(verifyTarget)}`
        const res = await execLogged('array', cmd, { timeoutMs: 20_000, guard: false, phase: 'preflight' })
        commandIds.push(res.command_id)
        if (res.exit_code !== 0 && res.exit_code !== 1) {
          const reason = (res.stderr || res.error || `grep exit ${res.exit_code}`).trim()
          checks.push({ kind: 'marker', target: 'array', marker, binary: verifyTarget, ok: false, command_id: res.command_id, detail: reason })
          return {
            ok: false,
            error: `Stage-0 验包无法读取目标二进制 ${verifyTarget}：${reason}`,
            guidance: '请检查阵列 SSH 账号读取权限（/proc/<pid>/exe 通常需要 root 或同属主权限）及目标进程是否仍在运行。',
            checks,
            command_ids: commandIds,
            baseline,
          }
        }
        const ok = res.exit_code === 0
        checks.push({ kind: 'marker', target: 'array', marker, binary: verifyTarget, ok, command_id: res.command_id })
        if (!ok) missingMarkers.push(marker)
      }
      if (missingMarkers.length > 0) {
        return {
          ok: false,
          error: `Stage-0 验包失败：真机 ${verifyTarget} 缺少 ${missingMarkers.length} 个打桩特征标记（${missingMarkers.join('、')}）`,
          guidance: '当前真机运行的并非刚出包的带桩二进制（可能未烧包生效、槽位未切或连错了节点），已拦截执行以防止假阴性结论。',
          missing_markers: missingMarkers,
          checks,
          command_ids: commandIds,
          baseline,
        }
      }
    }

    return { ok: true, checks, command_ids: commandIds, baseline }
  }

  async cancel({ dataRoot, verifyId }) {
    const key = `${path.resolve(dataRoot)}\0${verifyId}`
    const active = this.active.get(key)
    if (active) {
      active.controller.abort(new Error('用户已停止本次真机核验'))
      try { await active.done } catch {}
    }
    return await this.readRecord(dataRoot, verifyId)
  }

  async confirm({ dataRoot, verifyId, verdicts = [], sync_to_fault_injection: syncToFi = false, faultInjectionService = null }) {
    const record = await this.readRecord(dataRoot, verifyId)
    if (record.status === 'unreadable') throw serviceError('核验记录不可读', 400)
    if (ACTIVE_STATUSES.has(record.status)) throw serviceError('核验仍在运行中，完成后再确认归档', 409)
    const normalized = (Array.isArray(verdicts) ? verdicts : []).map(item => {
      const targetKey = String(item?.target_key || '').trim()
      const verdict = String(item?.verdict || '').trim()
      if (!targetKey || !LIVE_VERDICT_VALUES.includes(verdict)) {
        throw serviceError(`无效的核验结论项：${targetKey || '未知目标'}`)
      }
      return {
        target_key: targetKey,
        verdict,
        hits: String(item?.hits || '').trim(),
        evidence_command_ids: Array.isArray(item?.evidence_command_ids) ? item.evidence_command_ids.map(String) : [],
        observed_behavior: String(item?.observed_behavior || '').trim(),
        cleanup_verified: item?.cleanup_verified === true,
        notes: String(item?.notes || '').trim(),
      }
    })
    if (!normalized.length) throw serviceError('请至少提供一条确认结论')
    record.confirmed_verdicts = normalized
    record.confirmed_at = new Date().toISOString()
    record.status = 'confirmed'
    const syncWarnings = []
    const syncedMap = record.synced_fi_verdicts && typeof record.synced_fi_verdicts === 'object' ? { ...record.synced_fi_verdicts } : {}

    if (syncToFi && faultInjectionService) {
      const targetMetaByKey = new Map((record.targets || []).map(t => [t.target_key, t]))
      const binaryPath = record.preflight?.baseline?.binary_path || ''
      for (const item of normalized) {
        const meta = targetMetaByKey.get(item.target_key)
        const fiTaskId = meta?.source_fi_task_id || record.fault_injection_task_id
        const targetRunId = meta?.source_run_id || record.run_id
        if (!fiTaskId || !targetRunId) continue
        const mappedResult = item.verdict === 'not_triggered'
          ? 'not_triggered'
          : item.verdict === 'blocked'
            ? 'not_run'
            : item.verdict === 'confirmed'
              ? 'failed'
              : 'passed'
        const executionStatus = item.verdict === 'blocked' ? 'not_run' : 'completed'
        const noteText = `[真机核验 ${record.id} · ${LIVE_VERDICT_LABELS[item.verdict]}] ${item.observed_behavior || item.notes || ''}${binaryPath ? ` (二进制: ${binaryPath})` : ''}${item.evidence_command_ids.length ? ` (证据: ${item.evidence_command_ids.join(', ')})` : ''}`.trim()
        const syncKey = `${targetRunId}\0${fiTaskId}\0${item.target_key}`
        const fingerprint = JSON.stringify([mappedResult, item.verdict, item.hits, noteText])
        if (syncedMap[syncKey] === fingerprint) continue
        try {
          await faultInjectionService.recordVerification(dataRoot, targetRunId, fiTaskId, {
            verification: {
              case_key: item.target_key,
              result: mappedResult,
              execution_status: executionStatus,
              risk_verdict: item.verdict,
              hits: item.hits,
              notes: noteText,
            },
          })
          syncedMap[syncKey] = fingerprint
        } catch (syncError) {
          syncWarnings.push(`回写打桩任务 ${fiTaskId} (${item.target_key}) 失败：${syncError instanceof Error ? syncError.message : String(syncError)}`)
        }
      }
    }
    record.synced_fi_verdicts = syncedMap
    record.sync_warnings = syncWarnings
    await this.saveRecord(dataRoot, record)
    return record
  }

  async dispose() {
    const entries = [...this.active.values()]
    for (const item of entries) item.controller.abort(new Error('宿主正在关闭'))
    await Promise.allSettled(entries.map(item => item.done))
  }
}
