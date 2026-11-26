import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_SIBLING_ROOT = path.resolve(THIS_DIR, '..', '..', '..', '..', 'pangea-verify')

let cachedModule = null
let cachedRoot = ''

export function resolvePangeaVerifyRoot({ moduleRoot = '' } = {}) {
  const candidates = [
    moduleRoot,
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

export function environmentToVerifyTopology(environment, resolvedHosts = {}) {
  if (!environment || typeof environment !== 'object') return null
  const nodes = {}
  if (environment.host) {
    const h = resolvedHosts.host || {}
    nodes.host = {
      id: 'host',
      role: 'host',
      ssh: {
        ip: h.host || environment.host.ip || '',
        port: h.port ?? environment.host.port ?? 22,
        username: h.user || environment.host.username || '',
        auth_kind: environment.host.auth_kind === 'key' ? 'key' : 'password',
        ...(h.auth?.password ? { password: h.auth.password } : {}),
        ...(h.auth?.keyPath ? { key_path: h.auth.keyPath } : {}),
        ...(h.auth?.passphrase ? { passphrase: h.auth.passphrase } : {}),
        ...(environment.host.default_workdir ? { default_workdir: environment.host.default_workdir } : {}),
      },
      protected: {
        mgmt_ips: [h.host || environment.host.ip || ''].filter(Boolean),
        mgmt_nics: [],
        boot_disks: [],
      },
      test_resources: {
        data_nics: [],
        data_ips: [],
        block_devices: [],
        processes: [],
        paths: ['/dev/shm'],
        allow_reboot: false,
      },
      vars: {},
    }
  }
  if (environment.array) {
    const a = resolvedHosts.array || {}
    nodes.array = {
      id: 'array',
      role: 'controller',
      ssh: {
        ip: a.host || environment.array.ip || '',
        port: a.port ?? environment.array.port ?? 22,
        username: a.user || environment.array.username || '',
        auth_kind: environment.array.auth_kind === 'key' ? 'key' : 'password',
        ...(a.auth?.password ? { password: a.auth.password } : {}),
        ...(a.auth?.keyPath ? { key_path: a.auth.keyPath } : {}),
        ...(a.auth?.passphrase ? { passphrase: a.auth.passphrase } : {}),
        ...(environment.array.default_process ? { default_process: environment.array.default_process } : {}),
        ...(Array.isArray(environment.array.default_log_paths) ? { default_log_paths: environment.array.default_log_paths } : {}),
      },
      protected: {
        mgmt_ips: [a.host || environment.array.ip || ''].filter(Boolean),
        mgmt_nics: [],
        boot_disks: [],
      },
      test_resources: {
        data_nics: [],
        data_ips: [],
        block_devices: [],
        processes: environment.array.default_process ? [environment.array.default_process] : [],
        paths: ['/dev/shm'],
        allow_reboot: false,
      },
      vars: {},
    }
  }
  return {
    schema_version: 1,
    id: environment.id || 'env-bridged',
    name: environment.name || 'Bridged Environment',
    nodes,
    vars: {},
  }
}

export async function buildKnowledgeContextForLiveVerification({
  packDir = '',
  targets = [],
  environment = null,
  moduleRoot = '',
} = {}) {
  const effectivePackDir = String(packDir || process.env.PANGEA_VERIFY_KNOWLEDGE_PACK || '').trim()
  if (!effectivePackDir) return { packDir: '', context: null, warning: '' }
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
  packDir = '',
  sessionId = '',
  feedback = [],
  moduleRoot = '',
} = {}) {
  const effectivePackDir = String(packDir || process.env.PANGEA_VERIFY_KNOWLEDGE_PACK || '').trim()
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

export async function getPangeaVerifyBridgeStatus({ packDir = '', moduleRoot = '' } = {}) {
  const effectivePackDir = String(packDir || process.env.PANGEA_VERIFY_KNOWLEDGE_PACK || '').trim()
  const loaded = await loadPangeaVerify({ moduleRoot })
  const available = Boolean(loaded?.mod)
  const cliEntry = loaded?.root && !loaded.root.startsWith('package:')
    ? path.join(loaded.root, 'bin', 'cli.mjs')
    : 'pangea-verify'
  let verifiedCardCount = null
  if (available && effectivePackDir && loaded.mod.KnowledgePack) {
    try {
      const catalog = await new loaded.mod.KnowledgePack(effectivePackDir).readCatalog({ includeDrafts: false })
      verifiedCardCount = Array.isArray(catalog?.cards) ? catalog.cards.length : 0
    } catch {
      verifiedCardCount = null
    }
  }
  return {
    available,
    engine_root: loaded?.root || '',
    default_knowledge_pack_dir: effectivePackDir,
    verified_card_count: verifiedCardCount,
    mcp_command_hint: available
      ? `node "${cliEntry.replaceAll('\\', '/')}" mcp --pack "<knowledge-pack路径>" --data-root "<运行时目录>"`
      : '',
  }
}
