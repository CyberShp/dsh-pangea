import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function dshHome() {
  return path.resolve(process.env.DSH_HOME || path.join(homedir(), '.dsh'))
}

export function environmentStorePath() {
  return path.join(dshHome(), 'dsh-pangea-companion', 'environments.json')
}

function endpointAlias(id, kind) {
  return `pangea-environment/${id}/${kind}`
}

function normalizeEndpoint(value, field) {
  if (value === undefined || value === null || value === '') return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`)
  const legacyAlias = typeof value.legacy_alias === 'string' ? value.legacy_alias.trim() : ''
  if (legacyAlias) return { ip: '', username: '', password: '', port: 22, legacy_alias: legacyAlias }
  const ip = typeof value.ip === 'string' ? value.ip.trim() : ''
  const username = typeof value.username === 'string' ? value.username.trim() : ''
  const password = typeof value.password === 'string' ? value.password : ''
  const port = value.port === undefined || value.port === '' ? 22 : Number(value.port)
  if (!ip) return null
  if (!username) throw new Error(`${field}.username is required`)
  if (!password) throw new Error(`${field}.password is required`)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${field}.port must be between 1 and 65535`)
  return { ip, username, password, port }
}

function normalize(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('environment must be an object')
  if (typeof profile.id !== 'string' || profile.id.trim() === '') throw new Error('id is required')
  if (typeof profile.name !== 'string' || profile.name.trim() === '') throw new Error('name is required')
  const id = profile.id.trim()
  if (!ID.test(id)) throw new Error('id must use letters, digits, dots, hyphens or underscores')
  const legacy = profile.host === undefined && profile.array === undefined
    && typeof profile.host_alias === 'string' && typeof profile.array_alias === 'string'
    && typeof profile.automation_id === 'string'
  if (legacy) {
    const bindings = profile.bindings ?? {}
    if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) throw new Error('bindings must be an object')
    if (Object.values(bindings).some(value => typeof value !== 'string')) throw new Error('binding values must be strings')
    return {
      id,
      name: profile.name.trim(),
      host_alias: profile.host_alias.trim(),
      array_alias: profile.array_alias.trim(),
      automation_id: profile.automation_id.trim(),
      bindings: Object.fromEntries(Object.entries(bindings).map(([key, value]) => [key.trim(), value])),
    }
  }
  const legacyHost = typeof profile.host_alias === 'string' && profile.host_alias.trim()
    ? { legacy_alias: profile.host_alias.trim() } : null
  const legacyArray = typeof profile.array_alias === 'string' && profile.array_alias.trim()
    ? { legacy_alias: profile.array_alias.trim() } : null
  const host = normalizeEndpoint(profile.host ?? legacyHost, 'host')
  const array = normalizeEndpoint(profile.array ?? legacyArray, 'array')
  if (!host && !array) throw new Error('host or array connection is required')
  return {
    id,
    name: profile.name.trim(),
    host,
    array,
    host_alias: host?.legacy_alias ?? (host ? endpointAlias(id, 'host') : ''),
    array_alias: array?.legacy_alias ?? (array ? endpointAlias(id, 'array') : ''),
  }
}

export class EnvironmentStore {
  constructor(file = environmentStorePath()) {
    this.file = path.resolve(file)
  }

  async list() {
    try {
      const payload = JSON.parse(await readFile(this.file, 'utf8'))
      if (![1, 2].includes(payload?.version) || !Array.isArray(payload.environments)) throw new Error('environment store format is invalid')
      return payload.environments.map(normalize)
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
  }

  async get(id) {
    return (await this.list()).find(item => item.id === id)
  }

  async save(profile) {
    const value = normalize({ ...profile, id: typeof profile?.id === 'string' && profile.id.trim() ? profile.id : `env-${randomUUID()}` })
    const environments = await this.list()
    const index = environments.findIndex(item => item.id === value.id)
    if (index === -1) environments.push(value)
    else environments[index] = value
    await this.write(environments)
    return value
  }

  async remove(id) {
    const environments = await this.list()
    const next = environments.filter(item => item.id !== id)
    if (next.length === environments.length) return false
    await this.write(next)
    return true
  }

  async write(environments) {
    await mkdir(path.dirname(this.file), { recursive: true })
    const temporary = `${this.file}.tmp`
    await writeFile(temporary, `${JSON.stringify({ version: 2, environments }, null, 2)}\n`, 'utf8')
    await rename(temporary, this.file)
  }
}

export { endpointAlias, normalize as normalizeEnvironment }
