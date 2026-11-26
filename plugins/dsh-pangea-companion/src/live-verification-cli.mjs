#!/usr/bin/env node
import { readFile } from 'node:fs/promises'

function parseArgs(argv) {
  const [command, ...rest] = argv
  const flags = {}
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`)
    const key = token.slice(2)
    const value = rest[i + 1]
    if (value === undefined) throw new Error(`missing value for --${key}`)
    flags[key] = value
    i += 1
  }
  return { command, flags }
}

async function callGateway(endpoint, body, configPath) {
  let baseUrl = process.env.PANGEA_VERIFY_GATEWAY_URL
  let token = process.env.PANGEA_VERIFY_GATEWAY_TOKEN
  if (configPath) {
    const cfg = JSON.parse(await readFile(configPath, 'utf8'))
    baseUrl = cfg.url || baseUrl
    token = cfg.token || token
  }
  if (!baseUrl || !token) throw new Error('missing gateway url or token (pass --config or set PANGEA_VERIFY_GATEWAY_URL/PANGEA_VERIFY_GATEWAY_TOKEN)')
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let data
  try { data = JSON.parse(text) } catch { data = { error: text } }
  if (!response.ok) {
    const err = new Error(data?.error || `gateway HTTP ${response.status}`)
    err.payload = data
    throw err
  }
  return data
}

async function readCommand(flags) {
  if (flags['cmd-file']) return (await readFile(flags['cmd-file'], 'utf8')).replace(/\r?\n$/, '')
  return flags.cmd
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2))
  if (!command) throw new Error('usage: live-verification-cli.mjs <exec|bg-start|bg-read|bg-stop|interactive|register-cleanup> ...')
  let result
  const cfg = flags.config
  if (command === 'status') {
    result = await callGateway('/status', {}, cfg)
  } else if (command === 'exec') {
    result = await callGateway('/exec', {
      target: flags.target,
      command: await readCommand(flags),
      ...(flags['timeout-ms'] ? { timeout_ms: Number(flags['timeout-ms']) } : {}),
    }, cfg)
  } else if (command === 'bg-start') {
    result = await callGateway('/bg-start', { target: flags.target, command: await readCommand(flags) }, cfg)
  } else if (command === 'bg-read') {
    result = await callGateway('/bg-read', {
      job_id: flags['job-id'],
      ...(flags['wait-ms'] ? { wait_ms: Number(flags['wait-ms']) } : {}),
    }, cfg)
  } else if (command === 'bg-stop') {
    result = await callGateway('/bg-stop', { job_id: flags['job-id'] }, cfg)
  } else if (command === 'interactive') {
    const exchanges = JSON.parse(await readFile(flags['exchanges-file'], 'utf8'))
    result = await callGateway('/interactive', { target: flags.target, exchanges }, cfg)
  } else if (command === 'http') {
    const jsonPayload = flags['json-file']
      ? JSON.parse(await readFile(flags['json-file'], 'utf8'))
      : (flags.json ? JSON.parse(flags.json) : undefined)
    result = await callGateway('/http', {
      target: flags.target,
      method: flags.method || 'GET',
      path: flags.path || '/',
      ...(jsonPayload !== undefined ? { json: jsonPayload } : {}),
      ...(flags.body !== undefined ? { body: flags.body } : {}),
      ...(flags['timeout-ms'] ? { timeout_ms: Number(flags['timeout-ms']) } : {}),
    }, cfg)
  } else if (command === 'register-cleanup') {
    if (flags.kind === 'http') {
      const jsonPayload = flags['json-file']
        ? JSON.parse(await readFile(flags['json-file'], 'utf8'))
        : (flags.json ? JSON.parse(flags.json) : undefined)
      result = await callGateway('/register-cleanup', {
        kind: 'http',
        target: flags.target,
        method: flags.method || 'DELETE',
        path: flags.path,
        ...(jsonPayload !== undefined ? { json: jsonPayload } : {}),
        description: flags.desc || '',
      }, cfg)
    } else {
      result = await callGateway('/register-cleanup', {
        target: flags.target,
        command: await readCommand(flags),
        description: flags.desc || '',
      }, cfg)
    }
  } else if (command === 'run-cleanups') {
    result = await callGateway('/run-cleanups', {}, cfg)
  } else {
    throw new Error(`unknown command: ${command}`)
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), ...(error?.payload ? { details: error.payload } : {}) })}\n`)
  process.exit(1)
})
