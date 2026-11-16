import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const quote = value => JSON.stringify(value.replaceAll('\\', '/'))

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
