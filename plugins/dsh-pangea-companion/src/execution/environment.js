import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { decryptSecret, encryptSecret, isEncryptedSecret } from './credentials.js'

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function dshHome() {
  return path.resolve(process.env.DSH_HOME || path.join(homedir(), '.dsh'))
}

export function environmentStorePath() {
  return path.join(dshHome(), 'dsh-pangea-companion', 'environments.json')
}

export function endpointAlias(id, kind) {
  return `pangea-environment/${id}/${kind}`
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanStringList(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(item => cleanText(item)).filter(Boolean))]
}

function redactEndpoint(endpoint) {
  if (!endpoint) return null
  if (endpoint.legacy_alias) {
    return { ip: '', port: 22, username: '', auth_kind: 'password', has_password: false, legacy_alias: endpoint.legacy_alias }
  }
  const authKind = endpoint.auth_kind === 'key' ? 'key' : 'password'
  return {
    ip: endpoint.ip,
    port: endpoint.port ?? 22,
    username: endpoint.username,
    auth_kind: authKind,
    has_password: Boolean(isEncryptedSecret(endpoint.password_encrypted) || endpoint.password),
    ...(authKind === 'key' ? {
      key_path: endpoint.key_path || '',
      has_passphrase: Boolean(isEncryptedSecret(endpoint.passphrase_encrypted) || endpoint.passphrase),
    } : {}),
    ...(endpoint.default_workdir ? { default_workdir: endpoint.default_workdir } : {}),
    ...(endpoint.default_process ? { default_process: endpoint.default_process } : {}),
    ...(Array.isArray(endpoint.default_log_paths) && endpoint.default_log_paths.length ? { default_log_paths: endpoint.default_log_paths } : {}),
  }
}

export function redactEnvironment(record) {
  if (!record || typeof record !== 'object') return null
  if (record.host === undefined && record.array === undefined && typeof record.host_alias === 'string' && typeof record.array_alias === 'string') {
    return {
      id: record.id,
      name: record.name,
      ...(record.notes ? { notes: record.notes } : {}),
      host_alias: record.host_alias,
      array_alias: record.array_alias,
      automation_id: record.automation_id ?? '',
      bindings: record.bindings ?? {},
    }
  }
  const host = redactEndpoint(record.host)
  const array = redactEndpoint(record.array)
  return {
    id: record.id,
    name: record.name,
    ...(record.notes ? { notes: record.notes } : {}),
    ...(record.service_topology ? { service_topology: record.service_topology } : {}),
    ...(record.stimulus_playbook ? { stimulus_playbook: record.stimulus_playbook } : {}),
    host,
    array,
    host_alias: host?.legacy_alias ?? (host ? endpointAlias(record.id, 'host') : ''),
    array_alias: array?.legacy_alias ?? (array ? endpointAlias(record.id, 'array') : ''),
    ...(record.updated_at ? { updated_at: record.updated_at } : {}),
  }
}

async function normalizeEndpointForStorage(value, field, { existing = null, keyDir, platform } = {}) {
  if (value === undefined || value === null || value === '') return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} 必须是对象`)
  const legacyAlias = cleanText(value.legacy_alias)
  if (legacyAlias) return { legacy_alias: legacyAlias }

  const ip = cleanText(value.ip)
  if (!ip) return null
  const username = cleanText(value.username)
  const port = value.port === undefined || value.port === '' ? 22 : Number(value.port)
  if (!username) throw new Error(`${field}.username 不能为空`)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${field}.port 必须在 1 到 65535 之间`)

  const authKind = value.auth_kind === 'key' ? 'key' : 'password'
  const extra = {
    ...(field === 'host' && cleanText(value.default_workdir) ? { default_workdir: cleanText(value.default_workdir) } : {}),
    ...(field === 'array' && cleanText(value.default_process) ? { default_process: cleanText(value.default_process) } : {}),
    ...(field === 'array' && cleanStringList(value.default_log_paths).length ? { default_log_paths: cleanStringList(value.default_log_paths) } : {}),
  }

  if (authKind === 'key') {
    const keyPath = cleanText(value.key_path)
    if (!keyPath) throw new Error(`${field}.key_path 不能为空`)
    let passphraseEncrypted = null
    if (isEncryptedSecret(value.passphrase_encrypted)) {
      passphraseEncrypted = value.passphrase_encrypted
    } else if (typeof value.passphrase === 'string' && value.passphrase.length > 0) {
      passphraseEncrypted = await encryptSecret(value.passphrase, { keyDir, platform })
    } else if (value.keep_passphrase !== false && existing?.auth_kind === 'key' && existing?.key_path === keyPath && isEncryptedSecret(existing?.passphrase_encrypted)) {
      passphraseEncrypted = existing.passphrase_encrypted
    }
    return {
      ip, port, username, auth_kind: 'key', key_path: keyPath,
      ...(passphraseEncrypted ? { passphrase_encrypted: passphraseEncrypted } : {}),
      ...extra,
    }
  }

  let passwordEncrypted = null
  if (isEncryptedSecret(value.password_encrypted)) {
    passwordEncrypted = value.password_encrypted
  } else if (typeof value.password === 'string' && value.password.length > 0) {
    passwordEncrypted = await encryptSecret(value.password, { keyDir, platform })
  } else if (value.keep_password !== false && existing && existing.ip === ip && existing.username === username && isEncryptedSecret(existing.password_encrypted)) {
    passwordEncrypted = existing.password_encrypted
  }
  if (!passwordEncrypted) throw new Error(`${field}.password 不能为空`)
  return { ip, port, username, auth_kind: 'password', password_encrypted: passwordEncrypted, ...extra }
}

async function normalizeRecordForStorage(profile, { existing = null, keyDir, platform } = {}) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('environment 必须是对象')
  const id = cleanText(profile.id)
  const name = cleanText(profile.name)
  if (!id) throw new Error('id 不能为空')
  if (!name) throw new Error('环境名称不能为空')
  if (!ID.test(id)) throw new Error('id 只能包含字母、数字、点、连字符或下划线')
  const notes = cleanText(profile.notes)
  const serviceTopology = cleanText(profile.service_topology)
  const stimulusPlaybook = cleanText(profile.stimulus_playbook)

  const legacy = profile.host === undefined && profile.array === undefined
    && typeof profile.host_alias === 'string' && typeof profile.array_alias === 'string'
    && typeof profile.automation_id === 'string'
  if (legacy) {
    const bindings = profile.bindings ?? {}
    if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) throw new Error('bindings 必须是对象')
    if (Object.values(bindings).some(value => typeof value !== 'string')) throw new Error('binding 值必须是字符串')
    return {
      id, name, ...(notes ? { notes } : {}),
      host_alias: profile.host_alias.trim(),
      array_alias: profile.array_alias.trim(),
      automation_id: profile.automation_id.trim(),
      bindings: Object.fromEntries(Object.entries(bindings).map(([key, value]) => [key.trim(), value])),
    }
  }

  const legacyHost = cleanText(profile.host_alias) ? { legacy_alias: cleanText(profile.host_alias) } : null
  const legacyArray = cleanText(profile.array_alias) ? { legacy_alias: cleanText(profile.array_alias) } : null
  const host = await normalizeEndpointForStorage(profile.host ?? legacyHost, 'host', { existing: existing?.host, keyDir, platform })
  const array = await normalizeEndpointForStorage(profile.array ?? legacyArray, 'array', { existing: existing?.array, keyDir, platform })
  if (!host && !array) throw new Error('请至少配置测试主机或存储阵列连接')

  return {
    id,
    name,
    ...(notes ? { notes } : {}),
    ...(serviceTopology ? { service_topology: serviceTopology } : {}),
    ...(stimulusPlaybook ? { stimulus_playbook: stimulusPlaybook } : {}),
    host,
    array,
    host_alias: host?.legacy_alias ?? (host ? endpointAlias(id, 'host') : ''),
    array_alias: array?.legacy_alias ?? (array ? endpointAlias(id, 'array') : ''),
    updated_at: profile.updated_at || new Date().toISOString(),
  }
}

async function resolveEndpointSecret(endpoint, { keyDir, platform }) {
  if (!endpoint) return null
  if (endpoint.legacy_alias) return { legacy_alias: endpoint.legacy_alias }
  const authKind = endpoint.auth_kind === 'key' ? 'key' : 'password'
  if (authKind === 'key') {
    const passphrase = isEncryptedSecret(endpoint.passphrase_encrypted)
      ? await decryptSecret(endpoint.passphrase_encrypted, { keyDir, platform })
      : ''
    return { ...endpoint, auth_kind: 'key', ...(passphrase ? { passphrase } : {}) }
  }
  const password = isEncryptedSecret(endpoint.password_encrypted)
    ? await decryptSecret(endpoint.password_encrypted, { keyDir, platform })
    : (typeof endpoint.password === 'string' ? endpoint.password : '')
  const { password_encrypted: _drop, ...rest } = endpoint
  return { ...rest, auth_kind: 'password', password }
}

export class EnvironmentStore {
  constructor(file = environmentStorePath(), { platform = process.platform } = {}) {
    this.file = path.resolve(file)
    this.keyDir = path.dirname(this.file)
    this.platform = platform
  }

  async readRaw() {
    try {
      const payload = JSON.parse(await readFile(this.file, 'utf8'))
      if (![1, 2, 3].includes(payload?.version) || !Array.isArray(payload.environments)) {
        throw new Error('environment store format is invalid')
      }
      const needsMigration = payload.version < 3 || payload.environments.some(env =>
        (env?.host && typeof env.host.password === 'string' && env.host.password.length > 0)
        || (env?.array && typeof env.array.password === 'string' && env.array.password.length > 0))
      const normalized = []
      for (const item of payload.environments) {
        normalized.push(await normalizeRecordForStorage(item, { keyDir: this.keyDir, platform: this.platform }))
      }
      if (needsMigration) await this.write(normalized)
      return normalized
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
  }

  async list() {
    return (await this.readRaw()).map(redactEnvironment)
  }

  async get(id) {
    const item = (await this.readRaw()).find(entry => entry.id === id)
    return item ? redactEnvironment(item) : undefined
  }

  async getResolved(id) {
    const item = (await this.readRaw()).find(entry => entry.id === id)
    if (!item) return undefined
    if (item.host === undefined && item.array === undefined) return item
    return {
      ...item,
      host: await resolveEndpointSecret(item.host, { keyDir: this.keyDir, platform: this.platform }),
      array: await resolveEndpointSecret(item.array, { keyDir: this.keyDir, platform: this.platform }),
    }
  }

  async save(profile) {
    const environments = await this.readRaw()
    const id = cleanText(profile?.id) || `env-${randomUUID()}`
    const existing = environments.find(item => item.id === id) ?? null
    const value = await normalizeRecordForStorage(
      { ...profile, id, updated_at: new Date().toISOString() },
      { existing, keyDir: this.keyDir, platform: this.platform },
    )
    const index = environments.findIndex(item => item.id === value.id)
    if (index === -1) environments.push(value)
    else environments[index] = value
    await this.write(environments)
    return redactEnvironment(value)
  }

  async remove(id) {
    const environments = await this.readRaw()
    const next = environments.filter(item => item.id !== id)
    if (next.length === environments.length) return false
    await this.write(next)
    return true
  }

  async write(environments) {
    await mkdir(path.dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
    await writeFile(temporary, `${JSON.stringify({ version: 3, environments }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    try { await chmod(temporary, 0o600) } catch {}
    await rename(temporary, this.file)
  }
}

export { normalizeRecordForStorage as normalizeEnvironment }
