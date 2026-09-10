// Agent calls this explicit view-bound entrypoint after writing candidate.json.
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const [folder, archify] = process.argv.slice(2)
if (!folder || !archify) throw new Error('Usage: architecture-render.mjs <view-directory> <archify-root>')
const manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'))
if (manifest.status === 'stopped') throw new Error('This diagram was stopped; create a new revision')
const result = spawnSync(process.execPath, [path.join(archify, 'bin/archify.mjs'), 'deliver', manifest.type,
  path.join(folder, 'candidate.json'), path.join(folder, 'diagram.html'), '--quality', 'showcase', '--json'],
{ encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' } })
let receipt
try { receipt = JSON.parse(result.stdout) } catch { receipt = { ok: false, error: result.error?.message || result.stderr || 'Archify did not return JSON' } }
if (result.status !== 0) receipt.ok = false
await writeFile(path.join(folder, 'validation-receipt.json'), JSON.stringify(receipt, null, 2))
if (receipt.ok) {
  const html = await readFile(path.join(folder, 'diagram.html'), 'utf8')
  const svg = html.match(/<svg\b[^>]*>[\s\S]*?<\/svg>/i)?.[0]
  if (svg) {
    const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1]).join('\n')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    const standalone = svg.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"').replace(/(<svg[^>]*>)/, `$1<style>${styles}</style>`)
    await writeFile(path.join(folder, 'diagram.svg'), standalone)
  }
}
process.stdout.write(JSON.stringify(receipt))
process.exitCode = receipt.ok ? 0 : 1
