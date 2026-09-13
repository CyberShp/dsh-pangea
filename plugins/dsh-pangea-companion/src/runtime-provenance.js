import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const sha = value => createHash('sha256').update(value).digest('hex')
function fileHashes(root, directories) {
  const hashes = {}
  const visit = directory => {
    let entries
    try { entries = readdirSync(path.join(root, directory), { withFileTypes: true }) } catch { return }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(relative)
      else if (entry.isFile()) hashes[relative.split(path.sep).join('/')] = sha(readFileSync(path.join(root, relative)))
    }
  }
  directories.forEach(visit)
  return hashes
}
const pluginRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)))
function pluginIdentity() {
  let commit = null, dirty = null
  try {
    const root = path.resolve(pluginRoot, '../..')
    const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (realpathSync(git(['rev-parse', '--show-toplevel'])) === root) {
      commit = git(['rev-parse', 'HEAD'])
      dirty = Boolean(git(['status', '--porcelain', '--untracked-files=no']))
    }
  } catch { /* Packaged plugins carry file hashes even without a Git checkout. */ }
  return { commit, dirty, version: JSON.parse(readFileSync(path.join(pluginRoot, 'package.json'))).version,
    files_sha256: fileHashes(pluginRoot, ['src', 'lib']) }
}
// Capture plugin identity when this process loads it; later disk edits are not a reload.
const dsh = pluginIdentity()
export function runProvenance(workspace) {
  let desktop = null
  try { desktop = JSON.parse(process.env.PANGEA_DESKTOP_PROVENANCE || 'null') } catch { /* Older Desktop. */ }
  return { schema_version: 1, recorded_at: new Date().toISOString(), desktop, dsh,
    workspace_rules_sha256: fileHashes(workspace, ['.agents/pangea', '.opencode/agents', '.opencode/plugins', '.opencode/commands', '.opencode/skills']) }
}
