import { readFile, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import ssh2 from 'ssh2'

const { Client } = ssh2
const OUTPUT_LIMIT = 2 * 1024 * 1024

function dshHome() {
  return path.resolve(process.env.DSH_HOME || path.join(homedir(), '.dsh'))
}

function expandHome(value) {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(homedir(), value.slice(2))
  return value
}

function append(current, chunk) {
  const next = current + chunk.toString('utf8')
  return next.length > OUTPUT_LIMIT ? next.slice(next.length - OUTPUT_LIMIT) : next
}

async function hostByAlias(alias) {
  const file = path.join(dshHome(), 'dsh-ssh.json')
  const payload = JSON.parse(await new Promise((resolve, reject) => {
    readFile(file, 'utf8', (error, value) => error ? reject(error) : resolve(value))
  }))
  const host = payload?.hosts?.find(item => item.alias === alias)
  if (!host) throw new Error(`SSH alias not found: ${alias}`)
  if (Array.isArray(host.proxyJump) && host.proxyJump.length > 0) {
    throw new Error(`PANGEA interactive SSH does not support ProxyJump yet: ${alias}`)
  }
  return host
}

function endpointHost(endpoint) {
  return {
    host: endpoint.ip,
    port: endpoint.port ?? 22,
    user: endpoint.username,
    auth: { kind: 'password', password: endpoint.password },
  }
}

async function resolvedHost(alias, environments) {
  const match = /^pangea-environment\/([^/]+)\/(host|array)$/.exec(alias)
  if (!match) return hostByAlias(alias)
  const environment = await environments?.get(match[1])
  if (!environment) throw new Error(`environment not found: ${match[1]}`)
  const endpoint = environment[match[2]]
  if (!endpoint?.ip) throw new Error(`${match[2]} connection is not configured: ${match[1]}`)
  return endpointHost(endpoint)
}

async function connectHost(host) {
  const config = {
    host: host.host,
    port: host.port ?? 22,
    username: host.user,
    readyTimeout: 20_000,
  }
  if (host.auth?.kind === 'password') config.password = host.auth.password ?? ''
  else if (host.auth?.kind === 'key') {
    config.privateKey = readFileSync(expandHome(host.auth.keyPath))
    if (host.auth.passphrase) config.passphrase = host.auth.passphrase
  } else if (host.auth?.kind === 'agent') {
    config.agent = host.auth.agentPath || process.env.SSH_AUTH_SOCK
  } else throw new Error('SSH authentication is not configured')
  return await new Promise((resolve, reject) => {
    const client = new Client()
    const fail = error => {
      client.removeAllListeners()
      try { client.end() } catch {}
      reject(error)
    }
    client.once('ready', () => {
      client.removeListener('error', fail)
      client.on('error', () => {})
      resolve(client)
    })
    client.once('error', fail)
    client.connect(config)
  })
}

async function connect(alias, environments) {
  return connectHost(await resolvedHost(alias, environments))
}

function stripAnsi(value) {
  return value.replace(/[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '')
}

export class PangeaSshRuntime {
  constructor(environments) {
    this.environments = environments
    this.jobs = new Map()
  }

  async test(endpoint) {
    const normalized = {
      ip: typeof endpoint?.ip === 'string' ? endpoint.ip.trim() : '',
      username: typeof endpoint?.username === 'string' ? endpoint.username.trim() : '',
      password: typeof endpoint?.password === 'string' ? endpoint.password : '',
      port: endpoint?.port === undefined || endpoint.port === '' ? 22 : Number(endpoint.port),
    }
    if (!normalized.ip || !normalized.username || !normalized.password) throw new Error('IP、用户名和密码不能为空')
    if (!Number.isInteger(normalized.port) || normalized.port < 1 || normalized.port > 65535) throw new Error('SSH 端口必须在 1 到 65535 之间')
    const client = await connectHost(endpointHost(normalized))
    client.end()
    return { connected: true, ip: normalized.ip, port: normalized.port }
  }

  async exec(alias, command, timeoutMs = 60_000) {
    const started = Date.now()
    const client = await connect(alias, this.environments)
    return await new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      let settled = false
      const finish = value => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        client.end()
        resolve({ ...value, stdout, stderr, duration_ms: Date.now() - started })
      }
      const timer = setTimeout(() => finish({ success: false, exit_code: null, timed_out: true, error: 'timeout' }), timeoutMs)
      client.exec(command, (error, stream) => {
        if (error) return finish({ success: false, exit_code: null, timed_out: false, error: error.message })
        stream.on('data', chunk => { stdout = append(stdout, chunk) })
        stream.stderr.on('data', chunk => { stderr = append(stderr, chunk) })
        stream.once('close', code => finish({ success: code === 0, exit_code: code, timed_out: false }))
        stream.once('error', streamError => finish({ success: false, exit_code: null, timed_out: false, error: streamError.message }))
      })
    })
  }

  async start(alias, command) {
    const client = await connect(alias, this.environments)
    const jobId = crypto.randomUUID()
    return await new Promise((resolve, reject) => {
      client.exec(command, { pty: true }, (error, stream) => {
        if (error) {
          client.end()
          reject(error)
          return
        }
        let complete
        const done = new Promise(doneResolve => { complete = doneResolve })
        const job = { job_id: jobId, alias, client, stream, stdout: '', stderr: '', running: true, exit_code: null, error: undefined, started_at: new Date().toISOString(), done }
        stream.on('data', chunk => { job.stdout = append(job.stdout, chunk) })
        stream.stderr.on('data', chunk => { job.stderr = append(job.stderr, chunk) })
        stream.once('close', code => {
          job.running = false
          job.exit_code = code
          job.ended_at = new Date().toISOString()
          client.end()
          complete()
        })
        stream.once('error', streamError => {
          job.error = streamError.message
          job.running = false
          job.ended_at = new Date().toISOString()
          client.end()
          complete()
        })
        this.jobs.set(jobId, job)
        resolve(this.snapshot(job))
      })
    })
  }

  snapshot(job) {
    return {
      job_id: job.job_id,
      alias: job.alias,
      running: job.running,
      exit_code: job.exit_code,
      stdout: job.stdout,
      stderr: job.stderr,
      error: job.error,
      stopped: job.stopped === true,
      started_at: job.started_at,
      ended_at: job.ended_at,
    }
  }

  async read(jobId, waitMs = 0) {
    const job = this.jobs.get(jobId)
    if (!job) throw new Error(`background job not found: ${jobId}`)
    if (job.running && waitMs > 0) {
      await Promise.race([job.done, new Promise(resolve => setTimeout(resolve, waitMs))])
    }
    return this.snapshot(job)
  }

  async stop(jobId) {
    const job = this.jobs.get(jobId)
    if (!job) throw new Error(`background job not found: ${jobId}`)
      if (job.running) {
        try { job.stream.signal('INT') } catch {}
        job.stopped = true
        await Promise.race([job.done, new Promise(resolve => setTimeout(resolve, 1000))])
      if (job.running) {
        try { job.stream.close() } catch {}
        try { job.client.end() } catch {}
        job.running = false
        job.ended_at = new Date().toISOString()
      }
    }
    return this.snapshot(job)
  }

  async interactive(alias, exchanges) {
    const started = Date.now()
    const client = await connect(alias, this.environments)
    return await new Promise((resolve) => {
      let transcript = ''
      let settled = false
      let pending
      const finish = value => {
        if (settled) return
        settled = true
        if (pending?.timer) clearTimeout(pending.timer)
        try { pending?.reject(new Error('interactive session closed')) } catch {}
        client.end()
        resolve({ ...value, stdout: transcript, stderr: '', duration_ms: Date.now() - started })
      }
      client.shell({ term: 'xterm-256color', cols: 120, rows: 40 }, async (error, stream) => {
        if (error) return finish({ success: false, exit_code: null, error: error.message })
        stream.on('data', chunk => {
          transcript = append(transcript, chunk)
          if (pending && pending.pattern.test(stripAnsi(transcript.slice(pending.offset)))) {
            clearTimeout(pending.timer)
            const resolvePending = pending.resolve
            pending = undefined
            resolvePending()
          }
        })
        stream.once('error', streamError => finish({ success: false, exit_code: null, error: streamError.message }))
        stream.once('close', code => finish({ success: false, exit_code: code, error: 'interactive shell closed before all exchanges completed' }))
        try {
          for (const exchange of exchanges) {
            const pattern = new RegExp(exchange.expect, 'm')
            const offset = transcript.length
            stream.write(`${exchange.send}\n`)
            await new Promise((resolveExchange, rejectExchange) => {
              const timer = setTimeout(() => {
                pending = undefined
                rejectExchange(new Error(`interactive expect timeout: ${exchange.expect}`))
              }, (exchange.timeout_seconds ?? 30) * 1000)
              pending = { pattern, offset, timer, resolve: resolveExchange, reject: rejectExchange }
            })
          }
          try { stream.close() } catch {}
          finish({ success: true, exit_code: 0 })
        } catch (exchangeError) {
          try { stream.close() } catch {}
          finish({ success: false, exit_code: null, error: exchangeError.message })
        }
      })
    })
  }

  async dispose() {
    await Promise.all([...this.jobs.keys()].map(jobId => this.stop(jobId).catch(() => undefined)))
  }
}
