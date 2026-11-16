// Real React DOM, repository route and Git; no external model or Desktop runtime.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { repositoryRouteHandler } from '../src/index.js'
import { sourceGit, readRepositorySettings } from '../src/repositories/git-source.js'
import { importRepository } from '../src/repositories/import.js'
import { createRepositorySettings } from '../src/repository-settings-view.js'
const { Window } = await import(process.env.HAPPY_DOM_MODULE || 'happy-dom')
const window = new Window({ url: 'http://localhost/' })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Event']) Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true, writable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'), { createRoot } = await import('react-dom/client'), { act } = React
const root = await mkdtemp(path.join(os.tmpdir(), 'repo-settings-dom-')), dataRoot = path.join(root, 'data'), plain = path.join(root, 'plain'), git = path.join(root, 'git')
await mkdir(path.join(root, '.agents', 'pangea'), { recursive: true }); await writeFile(path.join(root, '.agents', 'pangea', 'dsh.md'), 'fixture')
await mkdir(plain); await mkdir(git); await writeFile(path.join(plain, 'x.c'), 'source')
await sourceGit(git, ['init', '-b', 'main']); await sourceGit(git, ['config', 'user.name', 'Test']); await sourceGit(git, ['config', 'user.email', 'test@example.test'])
await writeFile(path.join(git, 'x.c'), 'source'); await sourceGit(git, ['add', '.']); await sourceGit(git, ['commit', '-m', 'base'])
await sourceGit(root, ['clone', '--bare', git, path.join(root, 'remote.git')])
await sourceGit(git, ['remote', 'add', 'origin', path.join(root, 'remote.git')])
await importRepository({ dataRoot, sourcePath: plain, repositoryId: 'plain' })
globalThis.fetch = async (url, options = {}) => {
  const req = Readable.from(options.body ? [options.body] : []); req.url = url; req.method = options.method || 'GET'; req.headers = { 'sec-fetch-site': 'same-origin' }
  let status, response
  await repositoryRouteHandler(req, { writeHead(code) { status = code }, end(value) { response = value } })
  return new Response(response, { status })
}
const container = document.createElement('div'); document.body.append(container)
const renderer = createRoot(container), Panel = createRepositorySettings(React); let saved = 0
const click = async text => { const button = [...container.querySelectorAll('button')].find(node => node.textContent === text); assert.ok(button, text); assert.equal(button.disabled, false); await act(async () => button.click()) }
const until = async test => { for (let i = 0; i < 100; i++) { if (test()) return; await act(async () => new Promise(resolve => setTimeout(resolve, 30))) } assert.ok(test(), container.textContent) }
const change = async (label, value) => { const input = container.querySelector(`[aria-label="${label}"]`); assert.ok(input); await act(async () => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set.call(input, value); input.dispatchEvent(new window.Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) }) }
try {
  await act(async () => renderer.render(React.createElement(Panel, { cwd: root, dataRoot, onSaved: () => { saved++ } })))
  await click('代码仓库与构建'); await until(() => container.textContent.includes('本地文件夹'))
  await change('项目构建流水线 URL', 'https://ci.example.test/project')
  await change('关联 Git 仓库目录', git)
  await change('关联分支、标签或提交', 'main')
  await until(() => !container.querySelector('[aria-label="个人开发分支"]').disabled)
  await change('个人开发分支', 'main')
  await change('推送远端', 'origin')
  await click('保存仓库与构建配置'); await until(() => saved === 1)
  assert.match(container.textContent, /已关联打桩仓库/)
  const config = await readRepositorySettings(dataRoot, 'plain')
  assert.equal(config.pipeline_url, 'https://ci.example.test/project'); assert.equal(await realpath(config.git_path), await realpath(git))
  assert.equal(config.personal_branch, 'main'); assert.equal(config.remote, 'origin')
  assert.equal(config.base_ref, await sourceGit(git, ['rev-parse', 'HEAD']))
  await click('代码仓库与构建'); await click('代码仓库与构建')
  await until(() => container.querySelector('[aria-label="项目构建流水线 URL"]').value === 'https://ci.example.test/project')
  assert.equal(container.querySelector('[aria-label="个人开发分支"]').value, 'main')
  console.log('PASS: repository settings React DOM → real route → Git association → saved pipeline → reopen')
} finally { await act(async () => renderer.unmount()); await window.happyDOM.abort(); await rm(root, { recursive: true, force: true }) }
