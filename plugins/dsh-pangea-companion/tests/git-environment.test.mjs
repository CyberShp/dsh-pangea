import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { withGitLongPaths } from '../src/repositories/git-environment.js'

const exec = promisify(execFile)
test('per-process Windows configuration preserves user settings, includes and concurrent isolation', async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'git-env-test-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const folder = path.join(root, 'profile with spaces'), repo = path.join(root, 'repo')
  await mkdir(folder); await mkdir(repo)
  const original = path.join(folder, 'config')
  const child = path.join(folder, 'included')
  const conditional = path.join(folder, 'conditional')
  const content = '[core]\n longpaths = false\n[include]\n path = included\n[user]\n name = Original User\n'
    + `[includeIf "gitdir:${repo.replaceAll('\\', '/')}/"]\n path = conditional\n`
  await writeFile(original, content)
  await writeFile(child, '[http]\n proxy = http://proxy.example.test:8080\n[credential]\n helper = fixture-first\n helper = fixture-second\n')
  await writeFile(conditional, '[fixture]\n conditional = retained\n')
  const env = { ...process.env, GIT_CONFIG_GLOBAL: original, GIT_CONFIG_NOSYSTEM: '1' }
  const beforeEnv = { ...env }, processGlobal = process.env.GIT_CONFIG_GLOBAL
  const git = async (args, environment = env) => (await exec('git', ['-C', repo, ...args], { env: environment, windowsHide: true })).stdout.trimEnd()
  await git(['init'])
  await git(['config', '--local', 'core.longpaths', 'false'])
  const paths = await Promise.all(Array.from({ length: 3 }, () => withGitLongPaths(async isolated => {
    assert.notEqual(isolated.GIT_CONFIG_GLOBAL, original)
    assert.equal(await git(['config', '--global', '--includes', '--get', 'core.longpaths'], isolated), 'true')
    assert.equal(await git(['config', '--get', 'http.proxy'], isolated), 'http://proxy.example.test:8080')
    assert.equal(await git(['config', '--get-all', 'credential.helper'], isolated), 'fixture-first\nfixture-second')
    assert.equal(await git(['config', '--get', 'user.name'], isolated), 'Original User')
    assert.equal(await git(['config', '--get', 'fixture.conditional'], isolated), 'retained')
    assert.equal(await git(['config', '--local', '--get', 'core.longpaths'], isolated), 'false')
    return isolated.GIT_CONFIG_GLOBAL
  }, { env, platform: 'win32', tempRoot: root })))
  assert.equal(new Set(paths).size, 3)
  for (const file of paths) await assert.rejects(readFile(file), { code: 'ENOENT' })
  assert.equal(await readFile(original, 'utf8'), content)
  assert.equal(await git(['config', '--global', '--get', 'core.longpaths']), 'false')
  assert.deepEqual(env, beforeEnv)
  assert.equal(process.env.GIT_CONFIG_GLOBAL, processGlobal)
})

test('Windows configuration is cleaned after failure and cancellation, without changing parent environment', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'git-env-cleanup-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const config = path.join(root, 'original')
  await writeFile(config, '[core]\n longpaths = false\n')
  const options = { env: { ...process.env, GIT_CONFIG_GLOBAL: config }, platform: 'win32', tempRoot: root }
  await assert.rejects(withGitLongPaths(async () => { throw new Error('fixture failure') }, options), /fixture failure/)
  const controller = new AbortController()
  await assert.rejects(withGitLongPaths(async () => {
    controller.abort(new Error('fixture cancellation'))
    controller.signal.throwIfAborted()
  }, { ...options, signal: controller.signal }), /fixture cancellation/)
  await assert.rejects(withGitLongPaths(() => assert.fail('aborted callback must not run'), { ...options, signal: controller.signal }), /fixture cancellation/)
  assert.deepEqual(await readdir(root), ['original'])
  assert.equal(await readFile(config, 'utf8'), '[core]\n longpaths = false\n')
})

test('non-Windows Git keeps its existing configuration and allocates no files', async () => {
  const env = { GIT_CONFIG_GLOBAL: 'original' }
  await withGitLongPaths(async inherited => {
    assert.deepEqual(inherited, env)
    inherited.GIT_CONFIG_GLOBAL = 'callback-only'
  }, { env, platform: 'linux', tempRoot: '/missing/not-used' })
  assert.equal(env.GIT_CONFIG_GLOBAL, 'original')
})
