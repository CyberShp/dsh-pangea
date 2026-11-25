import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const DPAPI_SCHEME = 'dpapi-v1'
const AES_SCHEME = 'aes-256-gcm-v1'
const KEY_FILENAME = '.env-secret.key'

export function isEncryptedSecret(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (value.scheme === DPAPI_SCHEME) return typeof value.ciphertext === 'string' && value.ciphertext.length > 0
  if (value.scheme === AES_SCHEME) {
    return typeof value.ciphertext === 'string' && value.ciphertext.length > 0
      && typeof value.iv === 'string' && value.iv.length > 0
      && typeof value.tag === 'string' && value.tag.length > 0
  }
  return false
}

function runPowerShellStdin(script, stdinText, { trim = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, maxBuffer: 1024 * 1024, timeout: 15_000 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`DPAPI 操作失败: ${(stderr || error.message || '').trim()}`))
        else {
          const text = String(stdout ?? '')
          resolve(trim ? text.trim() : text)
        }
      },
    )
    child.stdin.end(stdinText, 'utf8')
  })
}

async function dpapiProtect(plaintext) {
  const script = [
    '[Console]::InputEncoding = [Text.Encoding]::UTF8',
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Security',
    '$raw = [Console]::In.ReadToEnd()',
    '$bytes = [Text.Encoding]::UTF8.GetBytes($raw)',
    '$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Console]::Out.Write([Convert]::ToBase64String($protected))',
  ].join('; ')
  const ciphertext = await runPowerShellStdin(script, plaintext, { trim: true })
  if (!ciphertext) throw new Error('DPAPI 加密未返回密文')
  return { scheme: DPAPI_SCHEME, ciphertext }
}

async function dpapiUnprotect(ciphertext) {
  const script = [
    '[Console]::InputEncoding = [Text.Encoding]::UTF8',
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Security',
    '$b64 = [Console]::In.ReadToEnd().Trim()',
    '$bytes = [Convert]::FromBase64String($b64)',
    '$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))',
  ].join('; ')
  return await runPowerShellStdin(script, ciphertext, { trim: false })
}

async function loadOrCreateLocalKey(keyDir) {
  const dir = path.resolve(keyDir)
  const keyFile = path.join(dir, KEY_FILENAME)
  try {
    const hex = (await readFile(keyFile, 'utf8')).trim()
    const key = Buffer.from(hex, 'hex')
    if (key.length === 32) return key
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await mkdir(dir, { recursive: true })
  const key = randomBytes(32)
  await writeFile(keyFile, `${key.toString('hex')}\n`, { encoding: 'utf8', mode: 0o600 })
  try { await chmod(keyFile, 0o600) } catch {}
  return key
}

async function aesEncrypt(plaintext, keyDir) {
  const key = await loadOrCreateLocalKey(keyDir)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    scheme: AES_SCHEME,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  }
}

async function aesDecrypt(payload, keyDir) {
  const key = await loadOrCreateLocalKey(keyDir)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'))
  const plain = Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()])
  return plain.toString('utf8')
}

export async function encryptSecret(plaintext, { keyDir, platform = process.platform } = {}) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) throw new Error('待加密凭据不能为空')
  if (platform === 'win32') return await dpapiProtect(plaintext)
  if (!keyDir) throw new Error('keyDir is required for local AES-GCM encryption')
  return await aesEncrypt(plaintext, keyDir)
}

export async function decryptSecret(payload, { keyDir, platform = process.platform } = {}) {
  if (!isEncryptedSecret(payload)) throw new Error('无效的加密凭据格式')
  if (payload.scheme === DPAPI_SCHEME) {
    if (platform !== 'win32') throw new Error('DPAPI 密文仅支持在 Windows 当前用户环境下解密')
    return await dpapiUnprotect(payload.ciphertext)
  }
  if (payload.scheme === AES_SCHEME) {
    if (!keyDir) throw new Error('keyDir is required for local AES-GCM decryption')
    return await aesDecrypt(payload, keyDir)
  }
  throw new Error(`不支持的凭据加密方案: ${payload.scheme}`)
}
