import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function dshHome() {
  return path.resolve(process.env.DSH_HOME || path.join(homedir(), '.dsh'))
}

export function environmentStorePath() {
  return path.join(dshHome(), 'dsh-pangea-companion', 'environments.json')
}

function normalize(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('environment must be an object')
  for (const field of ['id', 'name', 'host_alias', 'array_alias', 'automation_id']) {
    if (typeof profile[field] !== 'string' || profile[field].trim() === '') throw new Error(`${field} is required`)
  }
  const id = profile.id.trim()
  if (!ID.test(id)) throw new Error('id must use letters, digits, dots, hyphens or underscores')
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

export class EnvironmentStore {
  constructor(file = environmentStorePath()) {
    this.file = path.resolve(file)
  }

  async list() {
    try {
      const payload = JSON.parse(await readFile(this.file, 'utf8'))
      if (payload?.version !== 1 || !Array.isArray(payload.environments)) throw new Error('environment store format is invalid')
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
    const value = normalize(profile)
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
    await writeFile(temporary, `${JSON.stringify({ version: 1, environments }, null, 2)}\n`, 'utf8')
    await rename(temporary, this.file)
  }
}

export { normalize as normalizeEnvironment }
