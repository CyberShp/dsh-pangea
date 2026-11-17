import { mkdtemp, writeFile, rm, lstat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const quote = value => JSON.stringify(value.replaceAll('\\', '/'))

// Repository hooks must never run during host Git operations. An empty
// `core.hooksPath=` is not safe for that: Git LFS resolves an empty hooksPath
// relative to the worktree (git-lfs config.HookDir) and its smudge/filter-process
// commands then write post-checkout, post-commit, post-merge and pre-push into the
// repository root, leaving four untracked files after every checkout.
// Point hooksPath at a regular file instead: Git cannot find any hook below it and
// LFS cannot create a hook directory there (LFS ignores that install failure).
let disabledHooks = null
export async function disabledHooksPath({ tempRoot = os.tmpdir() } = {}) {
  const cached = disabledHooks
  if (cached?.tempRoot === tempRoot) {
    try { if ((await lstat(cached.file)).isFile()) return cached.file } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const directory = await mkdtemp(path.join(tempRoot, 'pangea-no-hooks-'))
  const file = path.join(directory, 'hooks-disabled').replaceAll('\\', '/')
  await writeFile(file, 'Git hooks are disabled for PANGEA host operations.\n', { mode: 0o444 })
  disabledHooks = { tempRoot, file }
  return file
}

// POSIX single-quote a value for command strings that Git runs through `sh -c`.
export const shellQuote = value => `'${String(value).replaceAll("'", `'\\''`)}'`

// Git for Windows may cache longpaths before command/local configuration is
// applied. Supply it at process startup without writing any user configuration.
// Include the original files (rather than copying their values) to retain proxy,
// credentials, relative includes, includeIf and multivalue configuration semantics.
export async function withGitLongPaths(callback, {
  env = process.env, signal, platform = process.platform, tempRoot = os.tmpdir(), cwd = process.cwd(),
} = {}) {
  const inherited = { ...env }
  if (platform !== 'win32') return callback(inherited)
  signal?.throwIfAborted()
  let files
  if (inherited.GIT_CONFIG_GLOBAL !== undefined) {
    files = inherited.GIT_CONFIG_GLOBAL ? [path.resolve(cwd, inherited.GIT_CONFIG_GLOBAL)] : []
  } else {
    // Match Git's XDG-then-user read order. Git expands ~ using its own Windows
    // HOME resolution; no HOME mutation or minimum `git var` version is needed.
    files = [inherited.XDG_CONFIG_HOME
      ? path.resolve(cwd, inherited.XDG_CONFIG_HOME, 'git', 'config')
      : '~/.config/git/config', '~/.gitconfig']
  }
  const directory = await mkdtemp(path.join(tempRoot, 'pangea-git-'))
  try {
    const config = path.join(directory, 'config')
    // Set the early default before includes as well as after them. The existing
    // command-level override still wins over repository-local longpaths=false.
    const enable = '[core]\n longpaths = true\n'
    await writeFile(config, enable + files.map(file => `[include]\n path = ${quote(file)}\n`).join('') + enable, { mode: 0o600 })
    signal?.throwIfAborted()
    return await callback({ ...inherited, GIT_CONFIG_GLOBAL: config })
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}
