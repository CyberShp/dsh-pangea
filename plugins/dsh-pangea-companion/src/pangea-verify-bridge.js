import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registerProtectedKnowledgePackRoot } from './report-policy.js'

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_VENDOR_ROOT = path.resolve(THIS_DIR, '..', 'vendor', 'pangea-verify')
const DEFAULT_SIBLING_ROOT = path.resolve(THIS_DIR, '..', '..', '..', '..', 'pangea-verify')

let cachedModule = null
let cachedRoot = ''

const posixPath = value => String(value ?? '').replaceAll('\\', '/')

export function defaultKnowledgePackDir(dataRoot) {
  if (!dataRoot) return ''
  return path.join(path.resolve(dataRoot), 'knowledge-pack')
}

export function verifySettingsPath(dataRoot) {
  return path.join(path.resolve(dataRoot), '.pangea', 'verify-settings.json')
}

export function verifyTopologyStorePath(dataRoot) {
  return path.join(path.resolve(dataRoot), '.pangea', 'verify-topologies.json')
}

export function resolvePangeaVerifyRoot({ moduleRoot = '' } = {}) {
  const candidates = [
    moduleRoot,
    PLUGIN_VENDOR_ROOT,
    process.env.PANGEA_VERIFY_ROOT || '',
    DEFAULT_SIBLING_ROOT,
  ].map(v => String(v || '').trim()).filter(Boolean)

  for (const dir of candidates) {
    const abs = path.resolve(dir)
    if (existsSync(path.join(abs, 'src', 'index.js'))) {
      return abs
    }
  }
  return ''
}

export async function loadPangeaVerify({ moduleRoot = '' } = {}) {
  const root = resolvePangeaVerifyRoot({ moduleRoot })
  if (root) {
    if (cachedModule && cachedRoot === root) return { root, mod: cachedModule }
    const entryUrl = pathToFileURL(path.join(root, 'src', 'index.js')).href
    const mod = await import(entryUrl)
    cachedRoot = root
    cachedModule = mod
    return { root, mod }
  }
  try {
    const mod = await import('pangea-verify')
    return { root: 'package:pangea-verify', mod }
  } catch {
    return null
  }
}

export async function readVerifySettings(dataRoot) {
  const fallbackDir = String(process.env.PANGEA_VERIFY_KNOWLEDGE_PACK || '').trim() || defaultKnowledgePackDir(dataRoot)
  if (!dataRoot) {
    if (fallbackDir) registerProtectedKnowledgePackRoot(fallbackDir)
    return { knowledge_pack_dir: fallbackDir, custom: Boolean(process.env.PANGEA_VERIFY_KNOWLEDGE_PACK) }
  }
  let stored = null
  try {
    stored = JSON.parse(await readFile(verifySettingsPath(dataRoot), 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') stored = null
  }
  const configured = typeof stored?.knowledge_pack_dir === 'string' && stored.knowledge_pack_dir.trim()
    ? path.resolve(stored.knowledge_pack_dir.trim())
    : ''
  const effective = configured || fallbackDir
  if (effective) registerProtectedKnowledgePackRoot(effective)
  return {
    knowledge_pack_dir: effective,
    custom: Boolean(configured),
    ...(stored?.updated_at ? { updated_at: stored.updated_at } : {}),
  }
}

export async function saveVerifySettings(dataRoot, patch = {}) {
  if (!dataRoot) throw new Error('data_root 不能为空')
  const rawDir = typeof patch.knowledge_pack_dir === 'string' ? patch.knowledge_pack_dir.trim() : ''
  const resolvedDir = rawDir ? path.resolve(rawDir) : defaultKnowledgePackDir(dataRoot)
  await mkdir(resolvedDir, { recursive: true })
  registerProtectedKnowledgePackRoot(resolvedDir)

  const file = verifySettingsPath(dataRoot)
  await mkdir(path.dirname(file), { recursive: true })
  const payload = {
    schema_version: 1,
    knowledge_pack_dir: rawDir ? resolvedDir : '',
    updated_at: new Date().toISOString(),
  }
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
  return {
    knowledge_pack_dir: resolvedDir,
    custom: Boolean(rawDir),
    updated_at: payload.updated_at,
  }
}

export function environmentToVerifyTopology(environment, resolvedHosts = {}) {
  if (!environment || typeof environment !== 'object') return null
  const nodes = {}
  if (environment.host) {
    const h = resolvedHosts.host || {}
    const ep = environment.host
    const rawProt = ep.protected && typeof ep.protected === 'object' ? ep.protected : {}
    const rawTest = ep.test_resources && typeof ep.test_resources === 'object' ? ep.test_resources : {}
    nodes.host = {
      id: 'host',
      role: 'host',
      ssh: {
        ip: h.host || ep.ip || '',
        port: h.port ?? ep.port ?? 22,
        username: h.user || ep.username || '',
        auth_kind: ep.auth_kind === 'key' ? 'key' : 'password',
        ...(h.auth?.password ? { password: h.auth.password } : {}),
        ...(h.auth?.keyPath ? { key_path: h.auth.keyPath } : {}),
        ...(h.auth?.passphrase ? { passphrase: h.auth.passphrase } : {}),
        ...(ep.default_workdir ? { default_workdir: ep.default_workdir } : {}),
      },
      protected: {
        mgmt_ips: [...new Set([...(rawProt.mgmt_ips || []), h.host || ep.ip || ''].filter(Boolean))],
        mgmt_nics: [...(rawProt.mgmt_nics || [])],
        boot_disks: [...(rawProt.boot_disks || [])],
      },
      test_resources: {
        data_nics: [...(rawTest.data_nics || [])],
        data_ips: [...(rawTest.data_ips || [])],
        block_devices: [...(rawTest.block_devices || [])],
        processes: [...(rawTest.processes || [])],
        paths: [...new Set(['/dev/shm', ...(rawTest.paths || [])])],
        allow_reboot: rawTest.allow_reboot === true,
      },
      vars: {},
    }
  }
  if (environment.array) {
    const a = resolvedHosts.array || {}
    const ep = environment.array
    const rawProt = ep.protected && typeof ep.protected === 'object' ? ep.protected : {}
    const rawTest = ep.test_resources && typeof ep.test_resources === 'object' ? ep.test_resources : {}
    nodes.array = {
      id: 'array',
      role: 'controller',
      ssh: {
        ip: a.host || ep.ip || '',
        port: a.port ?? ep.port ?? 22,
        username: a.user || ep.username || '',
        auth_kind: ep.auth_kind === 'key' ? 'key' : 'password',
        ...(a.auth?.password ? { password: a.auth.password } : {}),
        ...(a.auth?.keyPath ? { key_path: a.auth.keyPath } : {}),
        ...(a.auth?.passphrase ? { passphrase: a.auth.passphrase } : {}),
        ...(ep.default_process ? { default_process: ep.default_process } : {}),
        ...(Array.isArray(ep.default_log_paths) ? { default_log_paths: ep.default_log_paths } : {}),
      },
      protected: {
        mgmt_ips: [...new Set([...(rawProt.mgmt_ips || []), a.host || ep.ip || ''].filter(Boolean))],
        mgmt_nics: [...(rawProt.mgmt_nics || [])],
        boot_disks: [...(rawProt.boot_disks || [])],
      },
      test_resources: {
        data_nics: [...(rawTest.data_nics || [])],
        data_ips: [...(rawTest.data_ips || [])],
        block_devices: [...(rawTest.block_devices || [])],
        processes: [...new Set([...(ep.default_process ? [ep.default_process] : []), ...(rawTest.processes || [])])],
        paths: [...new Set(['/dev/shm', ...(rawTest.paths || [])])],
        allow_reboot: rawTest.allow_reboot === true,
      },
      vars: {},
    }
  }
  return {
    schema_version: 1,
    id: environment.id || 'env-bridged',
    name: environment.name || 'Bridged Environment',
    nodes,
    vars: { _pangea_env_managed: '1' },
  }
}

export async function syncEnvironmentsToTopologyStore(environmentsStore, targetStorePath, { moduleRoot = '' } = {}) {
  const loaded = await loadPangeaVerify({ moduleRoot })
  if (!loaded?.mod?.TopologyStore || !environmentsStore) return { synced: 0, pruned: 0, store_path: targetStorePath }
  const targetStore = new loaded.mod.TopologyStore(targetStorePath)
  const listed = await environmentsStore.list()
  const activeIds = new Set()
  let synced = 0
  for (const item of listed || []) {
    const resolved = await environmentsStore.getResolved?.(item.id)
    if (!resolved) continue
    const resolvedHosts = {}
    if (resolved.host?.ip) {
      resolvedHosts.host = {
        host: resolved.host.ip,
        port: resolved.host.port ?? 22,
        user: resolved.host.username,
        auth: resolved.host.auth_kind === 'key'
          ? { kind: 'key', keyPath: resolved.host.key_path, ...(resolved.host.passphrase ? { passphrase: resolved.host.passphrase } : {}) }
          : { kind: 'password', password: resolved.host.password },
      }
    }
    if (resolved.array?.ip) {
      resolvedHosts.array = {
        host: resolved.array.ip,
        port: resolved.array.port ?? 22,
        user: resolved.array.username,
        auth: resolved.array.auth_kind === 'key'
          ? { kind: 'key', keyPath: resolved.array.key_path, ...(resolved.array.passphrase ? { passphrase: resolved.array.passphrase } : {}) }
          : { kind: 'password', password: resolved.array.password },
      }
    }
    const topo = environmentToVerifyTopology(resolved, resolvedHosts)
    if (!topo || Object.keys(topo.nodes || {}).length === 0) continue
    try {
      await targetStore.save(topo)
      activeIds.add(topo.id)
      synced += 1
    } catch {}
  }
  let pruned = 0
  try {
    const existingTopos = await targetStore.list()
    for (const existing of existingTopos || []) {
      const isManaged = existing?.vars?._pangea_env_managed === '1'
      if (isManaged && !activeIds.has(existing.id)) {
        await targetStore.remove(existing.id)
        pruned += 1
      }
    }
  } catch {}
  return { synced, pruned, store_path: targetStore.file }
}

export async function buildKnowledgeContextForLiveVerification({
  dataRoot = '',
  packDir = '',
  targets = [],
  environment = null,
  moduleRoot = '',
} = {}) {
  let effectivePackDir = String(packDir || '').trim()
  if (!effectivePackDir && dataRoot) {
    const settings = await readVerifySettings(dataRoot)
    effectivePackDir = settings.knowledge_pack_dir
  } else if (!effectivePackDir) {
    effectivePackDir = String(process.env.PANGEA_VERIFY_KNOWLEDGE_PACK || '').trim()
  }
  if (!effectivePackDir) return { packDir: '', context: null, warning: '' }
  registerProtectedKnowledgePackRoot(effectivePackDir)

  const loaded = await loadPangeaVerify({ moduleRoot })
  if (!loaded?.mod?.buildBatchKnowledgeContext) {
    return {
      packDir: effectivePackDir,
      context: null,
      warning: '未检测到独立 pangea-verify 引擎模块，本次核验已跳过 Knowledge Pack 只读检索',
    }
  }
  try {
    const topology = environmentToVerifyTopology(environment)
    const context = await loaded.mod.buildBatchKnowledgeContext({
      packDir: effectivePackDir,
      targets,
      topology,
    })
    return { packDir: effectivePackDir, context, warning: '' }
  } catch (error) {
    return {
      packDir: effectivePackDir,
      context: null,
      warning: `读取 Knowledge Pack（${effectivePackDir}）失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export async function recordLiveVerificationCardFeedback({
  dataRoot = '',
  packDir = '',
  sessionId = '',
  feedback = [],
  moduleRoot = '',
} = {}) {
  let effectivePackDir = String(packDir || '').trim()
  if (!effectivePackDir && dataRoot) {
    effectivePackDir = (await readVerifySettings(dataRoot)).knowledge_pack_dir
  }
  if (!effectivePackDir || !Array.isArray(feedback) || feedback.length === 0) return []
  const loaded = await loadPangeaVerify({ moduleRoot })
  if (!loaded?.mod?.KnowledgePack) return []
  const pack = new loaded.mod.KnowledgePack(effectivePackDir)
  const recorded = []
  for (const item of feedback) {
    if (!item?.card_id || !item?.error_summary) continue
    try {
      const entry = await pack.recordFeedback({
        cardId: String(item.card_id),
        sessionId: String(sessionId || ''),
        commandId: String(item.command_id || ''),
        errorSummary: String(item.error_summary),
        firmwareHint: String(item.firmware_hint || ''),
      })
      recorded.push(entry)
    } catch {}
  }
  return recorded
}

export function buildTrainerBootstrapPrompt({ cliPath, skillPath, packDir, storePath, dataRoot, environments = [] }) {
  const envSummary = environments.length
    ? environments.map(e => `- ${e.id}（${e.name}）：${[e.host?.ip ? `host=${e.host.ip}` : '', e.array?.ip ? `array=${e.array.ip}` : ''].filter(Boolean).join(', ')}`).join('\n')
    : '（当前尚未配置直连环境，你可以直接让用户提供自动化 Topo 文件与遗留 Python 代码路径，编写 topo-adapter 导入）'

  return [
    '你现在进入「PANGEA 真机测试专家驯化会话」。请先阅读双态专家作业流文档并严格遵守其中全部防呆铁律：',
    `- 专家 Skill 文档：${posixPath(skillPath)}`,
    `- 内置受控引擎 CLI：node "${posixPath(cliPath)}"`,
    `- 当前受保护 Knowledge Pack 目录：${posixPath(packDir)}（严禁使用通用 write/edit/bash 直接写此目录，所有写入必须走 kp-draft / kp-promote / kp-attest / kp-save-adapter / index-cli）`,
    `- 加密拓扑库路径：${posixPath(storePath)}`,
    `- 会话证据落盘目录：${posixPath(dataRoot)}`,
    '',
    '已自动同步的实验室环境列表：',
    envSummary,
    '',
    '请先简短问候测试工程师，汇报当前知识包概况（调用 `kp-catalog` 与 `kp-lint`），并询问本轮要做什么：',
    '1. 接入新的自动化 Topo 文件（配确定性 topo-adapter）；',
    '2. 静态蒸馏遗留 Python 自动化代码 / 命令合集并上真机试跑盖戳沉淀能力卡；',
    '3. 巡检处理跑批记录的固件版本失配反馈（mismatch_count > 0）。',
  ].join('\n')
}

export async function getPangeaVerifyBridgeStatus({ dataRoot = '', packDir = '', moduleRoot = '' } = {}) {
  const settings = dataRoot ? await readVerifySettings(dataRoot) : { knowledge_pack_dir: String(packDir || process.env.PANGEA_VERIFY_KNOWLEDGE_PACK || '').trim(), custom: false }
  const effectivePackDir = String(packDir || settings.knowledge_pack_dir || '').trim()
  if (effectivePackDir) registerProtectedKnowledgePackRoot(effectivePackDir)

  const loaded = await loadPangeaVerify({ moduleRoot })
  const available = Boolean(loaded?.mod)
  const cliPath = loaded?.root && !loaded.root.startsWith('package:')
    ? path.join(loaded.root, 'bin', 'cli.mjs')
    : 'pangea-verify'
  const skillPath = loaded?.root && !loaded.root.startsWith('package:')
    ? path.join(loaded.root, 'skills', 'live-test-expert', 'SKILL.md')
    : ''

  let verifiedCount = 0
  let attestedCount = 0
  let draftCount = 0
  let mismatchCount = 0
  let lintOk = true
  let lintErrors = []
  let catalogCorrupted = false
  let statusError = ''

  if (available && effectivePackDir && loaded.mod.KnowledgePack) {
    try {
      const catalogPath = path.join(effectivePackDir, 'catalog.json')
      let catalogExists = false
      try {
        const rawCatalog = await readFile(catalogPath, 'utf8')
        catalogExists = true
        const parsed = JSON.parse(rawCatalog)
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cards)) {
          throw new Error('catalog.json 缺少合法的 cards 数组')
        }
      } catch (catalogErr) {
        if (catalogErr?.code !== 'ENOENT') {
          catalogCorrupted = true
          lintOk = false
          statusError = `知识包索引 catalog.json 损坏：${catalogErr instanceof Error ? catalogErr.message : String(catalogErr)}`
          lintErrors = [statusError]
        }
      }
      if (!catalogCorrupted) {
        const pack = new loaded.mod.KnowledgePack(effectivePackDir)
        const catalog = await pack.readCatalog({ includeDrafts: true })
        const cards = Array.isArray(catalog?.cards) ? catalog.cards : []
        verifiedCount = cards.filter(c => c.status === 'verified').length
        attestedCount = cards.filter(c => c.status === 'human_attested').length
        draftCount = cards.filter(c => c.status === 'draft').length
        mismatchCount = cards.reduce((sum, c) => sum + (Number(c.mismatch_count) || 0), 0)
        if (typeof pack.lint === 'function') {
          const lint = await pack.lint()
          lintOk = Boolean(lint.ok)
          lintErrors = Array.isArray(lint.errors) ? lint.errors.slice(0, 10) : []
        }
      } else if (catalogExists) {
        verifiedCount = 0
      }
    } catch (err) {
      catalogCorrupted = true
      lintOk = false
      statusError = `知识包状态检查失败（catalog.json）：${err instanceof Error ? err.message : String(err)}`
      lintErrors = [statusError]
    }
  }

  return {
    available,
    engine_root: loaded?.root || '',
    cli_path: cliPath,
    skill_path: skillPath,
    pack_dir: effectivePackDir,
    default_knowledge_pack_dir: effectivePackDir,
    custom_pack_dir: Boolean(settings.custom),
    verified_card_count: available && effectivePackDir && !catalogCorrupted ? (verifiedCount + attestedCount) : null,
    verified_count: verifiedCount,
    attested_count: attestedCount,
    draft_count: draftCount,
    mismatch_count: mismatchCount,
    lint_ok: lintOk,
    lint_errors: lintErrors,
    catalog_corrupted: catalogCorrupted,
    ...(statusError ? { error: statusError } : {}),
    mcp_command_hint: available
      ? `node "${posixPath(cliPath)}" mcp --pack "${posixPath(effectivePackDir || '<knowledge-pack路径>')}" --data-root "${posixPath(dataRoot || '<运行时目录>')}"`
      : '',
  }
}
