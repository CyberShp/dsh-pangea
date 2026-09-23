// Agent calls this explicit view-bound entrypoint after writing candidate.json.
import path from 'node:path'
import { readFile, writeFile, open, unlink, appendFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const [folder, archify] = process.argv.slice(2)
if (!folder || !archify) throw new Error('Usage: architecture-render.mjs <view-directory> <archify-root>')
const lockPath = path.join(folder, 'render.lock')
const lock = await open(lockPath, 'wx')
let receipt
try {
  const manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'))
  const statePath = path.join(folder, 'render-attempts.json')
  let attempts = 0
  try { attempts = JSON.parse(await readFile(statePath, 'utf8')).attempts } catch (error) { if (error.code !== 'ENOENT') throw error }
  const maxAttempts = manifest.max_render_attempts ?? 3
  const remaining = manifest.budget_ms ? Date.parse(manifest.created_at) + manifest.budget_ms - Date.now() : 120000
  if (['stopped', 'failed'].includes(manifest.status)) throw new Error('This diagram is stopped or failed; create a new revision')
  if (attempts >= maxAttempts) {
    receipt = { ok: false, attempts_exhausted: true, error: '已达到三次渲染上限，候选图和历史诊断已保留' }
  } else if (!Number.isFinite(remaining) || remaining <= 0) {
    receipt = { ok: false, attempts_exhausted: true, error: '图表生成执行预算已耗尽' }
  } else {
    await writeFile(statePath, JSON.stringify({ attempts: ++attempts }))
    const started = Date.now()
    const result = spawnSync(process.execPath, [path.join(archify, 'bin/archify.mjs'), 'deliver', manifest.type,
      path.join(folder, 'candidate.json'), path.join(folder, 'diagram.html'), '--quality', 'showcase', '--json'],
    { encoding: 'utf8', timeout: Math.max(1, Math.min(120000, remaining)), maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' } })
    try { receipt = JSON.parse(result.stdout) } catch { receipt = { ok: false, error: result.error?.message || result.stderr || 'Archify did not return JSON' } }
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) receipt = { ok: false, error: 'Archify returned an invalid receipt' }
    if (result.status !== 0) receipt.ok = false
    if (receipt.ok) {
      try { await readFile(path.join(folder, 'diagram.html')) } catch { receipt.ok = false; receipt.error = '渲染返回成功但缺少 diagram.html' }
    }
    Object.assign(receipt, { attempt: attempts, attempts_exhausted: !receipt.ok && attempts >= maxAttempts,
      exit_code: result.status, signal: result.signal, duration_ms: Date.now() - started })
    if (!receipt.ok && !receipt.error) receipt.error = result.error?.message || result.stderr || `Archify exited with ${result.status}`
    await appendFile(path.join(folder, 'render-history.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...receipt,
      stdout: result.stdout, stderr: result.stderr, process_error: result.error?.message }) + '\n')
  }
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
} finally {
  await lock.close()
  await unlink(lockPath)
}
process.stdout.write(JSON.stringify(receipt))
process.exitCode = receipt.ok ? 0 : 1
