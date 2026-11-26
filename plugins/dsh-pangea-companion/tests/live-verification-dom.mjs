// Real React DOM, environment & live-verification routes, and local ssh2.Server.
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import ssh2 from 'ssh2'
import { EnvironmentStore } from '../src/execution/environment.js'
import { PangeaSshRuntime } from '../src/execution/ssh.js'
import { requireAgentModel } from '../src/agent-models.js'
import { LiveVerificationService } from '../src/live-verification.js'
import { acpSettingsRouteHandler, environmentRouteHandler, liveVerificationRouteHandler } from '../src/index.js'
import { createLiveVerificationWorkspace } from '../src/live-verification-view.js'

const { Server } = ssh2
const { Window } = await import(process.env.HAPPY_DOM_MODULE || 'happy-dom')
const window = new Window({ url: 'http://localhost/' })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Event']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true, writable: true })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = React

const root = await mkdtemp(path.join(os.tmpdir(), 'live-verify-dom-'))
const dataRoot = path.join(root, 'pangea-data')
await mkdir(dataRoot, { recursive: true })
await mkdir(path.join(root, '.agents', 'pangea'), { recursive: true })
await writeFile(path.join(root, '.agents', 'pangea', 'dsh.md'), '# test workspace\n')

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const sshServer = new Server({ hostKeys: [privateKey.export({ type: 'pkcs1', format: 'pem' })] }, client => {
  client.on('authentication', ctx => {
    if (ctx.method === 'password' && ctx.username === 'admin' && ctx.password === 'dom-secret') ctx.accept()
    else ctx.reject()
  })
  client.on('ready', () => client.on('session', acceptSession => {
    const session = acceptSession()
    session.on('exec', (acceptExec, _reject, info) => {
      const stream = acceptExec()
      if (info.command.includes('PANGEA_PREFLIGHT_OK')) stream.write('PANGEA_PREFLIGHT_OK\n')
      else if (info.command.includes('pidof')) stream.write('5150\n')
      else stream.write('ok\n')
      stream.exit(0)
      stream.end()
    })
  }))
})
await new Promise((resolve, reject) => { sshServer.once('error', reject); sshServer.listen(0, '127.0.0.1', resolve) })
const sshPort = sshServer.address().port

let failModelProbe = false
const runtime = {
  subagents: {
    getProvider: id => {
      if (id === 'pangea-nga') {
        return {
          discoverModels: async () => {
            if (failModelProbe) throw new Error('模拟探活失败')
            return {
              current_model: 'nga/default',
              models: [{ id: 'nga/default', label: 'NGA Default' }, { id: 'nga/fast', label: 'NGA Fast' }],
            }
          },
        }
      }
      if (id === 'pangea-codeagent') {
        return {
          discoverModels: async () => ({
            current_model: 'ca/default',
            models: [{ id: 'ca/default', label: 'CA Default' }],
          }),
        }
      }
      return undefined
    },
  },
}

const envFile = path.join(root, 'environments.json')
const envStore = new EnvironmentStore(envFile)
const ssh = new PangeaSshRuntime(envStore)
let startedRecord = null
const service = new LiveVerificationService({
  environments: envStore,
  ssh,
  validateModel: options => requireAgentModel(runtime, options),
  runWorker: async ({ record }) => {
    startedRecord = record
    return {
      summary: 'DOM 端到端真机核验完成',
      items: [{
        target_key: 'R-CONC-001',
        verdict: 'confirmed',
        hits: 'INJ-001=1',
        evidence_command_ids: ['cmd-0001'],
        observed_behavior: '阵列真机复现并发异常',
        cleanup_verified: true,
        notes: 'DOM 验证通过',
      }],
    }
  },
})

globalThis.fetch = async (url, options = {}) => {
  const urlStr = String(url)
  if (urlStr.startsWith('/api/pangea-companion/fault-injection')) {
    return new Response(JSON.stringify({ status: 'ok', tasks: [], builds: [] }), { status: 200 })
  }
  const req = Readable.from(options.body ? [options.body] : [])
  req.url = urlStr
  req.method = options.method || 'GET'
  req.headers = { 'sec-fetch-site': 'same-origin' }
  let status = 200
  let body = ''
  const res = {
    writableEnded: false,
    on() {},
    removeListener() {},
    writeHead(code) { status = code },
    end(value) { this.writableEnded = true; body = value },
  }
  if (urlStr.startsWith('/api/pangea-companion/acp-settings')) {
    await acpSettingsRouteHandler(req, res, { read: async () => ({ version: 1, providers: {} }), save: async v => v }, runtime)
  } else if (urlStr.startsWith('/api/pangea-companion/environments')) {
    await environmentRouteHandler(req, res, envStore, ssh, service)
  } else if (urlStr.startsWith('/api/pangea-companion/live-verification')) {
    await liveVerificationRouteHandler(req, res, service, null, runtime, { resolveRoot: async () => dataRoot })
  } else {
    status = 404; body = JSON.stringify({ error: `unexpected url: ${urlStr}` })
  }
  return new Response(body, { status })
}

const container = document.createElement('div')
document.body.append(container)
const renderer = createRoot(container)
const Workspace = createLiveVerificationWorkspace(React)

const until = async predicate => {
  for (let i = 0; i < 120; i += 1) {
    if (predicate()) return
    await act(async () => new Promise(resolve => setTimeout(resolve, 30)))
  }
  assert.ok(predicate(), `timeout waiting for DOM condition:\n${container.textContent}`)
}
const clickButton = async label => {
  const btn = [...container.querySelectorAll('button')].find(node => node.textContent?.includes(label))
  assert.ok(btn, `button not found: ${label}`)
  assert.equal(btn.disabled, false, `button disabled: ${label}`)
  await act(async () => btn.click())
}
const setInputByLabel = async (labelText, value, index = 0) => {
  const labels = [...container.querySelectorAll('label')].filter(l => (l.querySelector('span')?.textContent ?? l.textContent ?? '').includes(labelText))
  const label = labels[index]
  assert.ok(label, `label not found: ${labelText} [${index}]`)
  const control = label.querySelector('input, select, textarea')
  assert.ok(control, `control not found in label: ${labelText}`)
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), 'value').set.call(control, value)
    control.dispatchEvent(new window.Event(control.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
}

try {
  // Mount without defaultProviderId (matches real Desktop execution page where workbench is not loaded)
  await act(async () => renderer.render(React.createElement(Workspace, {
    cwd: root,
    dataRoot,
  })))

  // 1. Switch to Environment Management tab, open drawer, and create encrypted direct SSH environment
  await clickButton('环境管理')
  await clickButton('新增直连环境')
  await until(() => container.textContent.includes('存储阵列（Array'))
  await setInputByLabel('环境名称', '实验室真机 01')
  // Array card is first in the drawer (index 0)
  await setInputByLabel('直连 IP', '127.0.0.1', 0)
  await setInputByLabel('SSH 端口', String(sshPort), 0)
  await setInputByLabel('用户名', 'admin', 0)
  await setInputByLabel('SSH 密码', 'dom-secret', 0)
  await setInputByLabel('默认目标守护进程名', 'storage_daemon')
  await clickButton('加密保存环境')
  await until(() => container.textContent.includes('实验室真机 01') && container.textContent.includes('空闲'))
  assert.doesNotMatch(await readFile(envFile, 'utf8'), /dom-secret/, 'disk must not store plaintext password')

  // 2. Switch to Tasks tab, open create view, verify real ACP providers & model dropdown + error/refresh recovery
  await clickButton('核验任务')
  await clickButton('新建真机核验')
  await until(() => container.textContent.includes('已确认模型：nga/default'))
  const providerSelect = container.querySelector('[aria-label="核验执行 Agent"]')
  assert.equal(providerSelect.value, 'pangea-nga')
  const openCodeOpt = [...providerSelect.options].find(o => o.value === 'pangea-opencode')
  assert.equal(openCodeOpt?.disabled, true, 'unregistered ACP provider should be disabled')
  const modelSelect = container.querySelector('[aria-label="执行模型"]')
  assert.equal(modelSelect.disabled, false)
  assert.ok([...modelSelect.options].some(o => o.value === 'nga/fast'), 'model dropdown should list discovered models')

  // Verify probe error surfaces alert and disables submit, then refresh recovers
  failModelProbe = true
  await clickButton('刷新模型')
  await until(() => container.textContent.includes('模拟探活失败'))
  assert.equal([...container.querySelectorAll('button')].find(b => b.textContent?.includes('启动真机核验')).disabled, true)
  failModelProbe = false
  await clickButton('刷新模型')
  await until(() => container.textContent.includes('已确认模型：nga/default'))

  // Select a non-default model explicitly and launch against real ssh2.Server + real requireAgentModel
  await setInputByLabel('执行模型', 'nga/fast')
  await until(() => container.textContent.includes('已确认模型：nga/fast'))
  await setInputByLabel('核验来源模式', 'direct_risk')
  await until(() => container.textContent.includes('待核验风险编号'))
  await setInputByLabel('待核验风险编号', 'R-CONC-001')
  await setInputByLabel('风险标题', '并发回调 UAF')
  const savedEnvs = await envStore.list()
  await setInputByLabel('目标真机环境', savedEnvs[0].id)
  await clickButton('启动真机核验')

  // 3. Wait for detail view to complete Stage-0 + worker + cleanup, verify cmd chip jump, then confirm archive
  await until(() => container.textContent.includes('待确认归档') && container.textContent.includes('风险实锤'))
  assert.equal(startedRecord?.provider_id, 'pangea-nga')
  assert.equal(startedRecord?.agent_model, 'nga/fast')
  assert.match(container.textContent, /Stage-0 在位预检：通过/)
  assert.match(container.textContent, /宿主兜底清理与进程对账：正常/)
  await clickButton('cmd-0001')
  await until(() => container.textContent.includes('PANGEA_PREFLIGHT_OK'))
  await clickButton('核验结论（1）')
  await clickButton('确认归档')
  await until(() => container.textContent.includes('已确认归档'))
  console.log('PASS: LiveVerificationWorkspace React DOM → real ACP provider/model discovery → encrypted env → real ssh2 preflight/worker/cleanup → confirm archive')
} finally {
  await act(async () => renderer.unmount())
  await service.dispose()
  await ssh.dispose()
  await new Promise(resolve => sshServer.close(resolve))
  window.happyDOM.abort()
  await rm(root, { recursive: true, force: true })
}
