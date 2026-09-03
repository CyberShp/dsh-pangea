import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { validateAcpRuntimeConfig } from './workbench-api.js'

export const ACP_RUNTIME_CONFIG_ENV = 'PANGEA_ACP_RUNTIME_CONFIG'

function settingsPath() {
  const root = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim()
    ? path.resolve(process.env.DSH_HOME)
    : path.join(homedir(), '.dsh')
  return path.join(root, 'dsh-pangea-companion', 'acp-runtime-v1.json')
}

export class AcpSettingsStore {
  constructor({ filePath = settingsPath() } = {}) {
    this.filePath = path.resolve(filePath)
  }

  async read() {
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8'))
      return validateAcpRuntimeConfig(value)
    } catch (error) {
      if (error?.code === 'ENOENT') return { version: 1, providers: {} }
      throw error
    }
  }

  loadIntoEnvironment() {
    const inherited = process.env[ACP_RUNTIME_CONFIG_ENV]
    if (typeof inherited === 'string' && inherited.trim()) {
      return validateAcpRuntimeConfig(JSON.parse(inherited))
    }
    try {
      const value = validateAcpRuntimeConfig(JSON.parse(readFileSync(this.filePath, 'utf8')))
      process.env[ACP_RUNTIME_CONFIG_ENV] = JSON.stringify(value)
      return value
    } catch (error) {
      if (error?.code === 'ENOENT') return { version: 1, providers: {} }
      throw error
    }
  }

  async save(value) {
    const validated = validateAcpRuntimeConfig(value)
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.tmp`
    await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, 'utf8')
    await rename(temporary, this.filePath)
    process.env[ACP_RUNTIME_CONFIG_ENV] = JSON.stringify(validated)
    return validated
  }
}

export function createAcpSettingsStore(options) {
  return new AcpSettingsStore(options)
}
