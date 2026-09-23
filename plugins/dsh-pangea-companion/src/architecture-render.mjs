// The host validates exactly one frozen candidate after each Worker turn.
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { readFile, writeFile, open, unlink, appendFile, rename } from 'node:fs/promises'
import { execFile } from 'node:child_process'

export async function renderCandidate(folder, archify, { signal, manual = false, node = process.execPath } = {}) {
  const lockPath = path.join(folder, 'render.lock')
  const lock = await open(lockPath, 'wx')
  try {
    const manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'))
    const statePath = path.join(folder, 'render-attempts.json')
    let attempts = 0
    try { attempts = JSON.parse(await readFile(statePath, 'utf8')).attempts } catch (error) { if (error.code !== 'ENOENT') throw error }
    const maxAttempts = manifest.max_render_attempts ?? 3
    const deadline = manual || !manifest.budget_ms ? Date.now() + 120000 : Date.parse(manifest.created_at) + manifest.budget_ms
    if (!manual && ['stopped', 'failed'].includes(manifest.status)) throw new Error('This diagram is stopped or failed')
    if (!manual && attempts >= maxAttempts) return { ok: false, attempts_exhausted: true, error: '三个候选已验证，未启动额外模型修复' }
    if (!Number.isFinite(deadline) || deadline <= Date.now()) return { ok: false, attempts_exhausted: true, error: '图表生成执行预算已耗尽' }
    signal?.throwIfAborted()
    const candidate = await readFile(path.join(folder, 'candidate.json'))
    let previous
    try { previous = JSON.parse(await readFile(path.join(folder, 'validation-receipt.json'), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    const digest = createHash('sha256').update(candidate).digest('hex')
    const snapshot = path.join(folder, manual ? `candidate-manual-${Date.now()}.json` : `candidate-${attempts + 1}.json`)
    await writeFile(snapshot, candidate, { flag: 'wx' })
    if (!manual) await writeFile(statePath, JSON.stringify({ attempts: ++attempts }))
    const started = Date.now()
    const output = snapshot.replace(/\.json$/, '.html')
    const invoke = args => new Promise(resolve => {
      const remaining = deadline - Date.now()
      if (remaining <= 0 || signal?.aborted) return resolve({ ok: false, error: '图表生成执行预算已耗尽或已停止' })
      execFile(node, [path.join(archify, 'bin/archify.mjs'), ...args], {
        encoding: 'utf8', timeout: Math.max(1, Math.min(120000, remaining)), signal, windowsHide: true,
        maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
      }, (error, stdout, stderr) => {
        let receipt
        try { receipt = JSON.parse(stdout) } catch { receipt = { ok: false, error: error?.message || stderr || 'Archify did not return JSON' } }
        if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) receipt = { ok: false, error: 'Archify returned an invalid receipt' }
        if (error) receipt.ok = false
        resolve({ ...receipt, exit_code: error?.code ?? 0, stdout, stderr })
      })
    })
    const validation = await invoke(['validate', manifest.type, snapshot, '--quality', 'showcase', '--json'])
    const delivered = validation.ok || manifest.type === 'workflow'
      ? await invoke(['deliver', manifest.type, snapshot, output, '--quality', 'showcase', '--json',
        ...(manifest.type === 'workflow' ? ['--draft-output', path.join(folder, 'draft.html')] : [])]) : validation
    const receipt = { ...delivered, validation, candidate_sha256: digest, candidate_snapshot: snapshot,
      attempt: attempts, manual, duration_ms: Date.now() - started }
    receipt.ok = Boolean(validation.ok && delivered.ok && !signal?.aborted && Date.now() <= deadline)
    const snapshotDigest = createHash('sha256').update(await readFile(snapshot)).digest('hex')
    if (snapshotDigest !== digest || delivered.specification?.sha256 && delivered.specification.sha256 !== digest) {
      receipt.ok = false
      delete receipt.draft
      receipt.error = '候选快照字节发生变化，产物身份不匹配'
    }
    if (receipt.ok) {
      try {
        await rename(output, path.join(folder, 'diagram.html'))
        receipt.output = path.join(folder, 'diagram.html')
        await exportSvg(folder, 'diagram')
      } catch (error) { receipt.ok = false; receipt.error = error.message }
    } else if (receipt.draft) await exportSvg(folder, 'draft')
    if (!receipt.ok && (previous?.ok || previous?.previous_verified)) {
      receipt.previous_verified = previous.ok ? {
        specification: previous.specification, artifact: previous.artifact, candidate_sha256: previous.candidate_sha256,
        candidate_snapshot: previous.candidate_snapshot, output: previous.output,
      } : previous.previous_verified
    }
    if (!receipt.ok && !receipt.draft && (previous?.draft || previous?.previous_draft)) {
      receipt.previous_draft = previous.draft ? { ...previous.draft,
        candidate_sha256: previous.candidate_sha256, candidate_snapshot: previous.candidate_snapshot, diagnostics: previous.diagnostics,
      } : previous.previous_draft
    }
    receipt.attempts_exhausted = !manual && !receipt.ok && attempts >= maxAttempts
    if (!receipt.ok && !receipt.error) receipt.error = validation.error || delivered.error || '图表尚未通过严格校验'
    await appendFile(path.join(folder, 'render-history.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...receipt }) + '\n')
    await writeFile(path.join(folder, 'validation-receipt.json'), JSON.stringify(receipt, null, 2))
    return receipt
  } finally { await lock.close(); await unlink(lockPath) }
}

async function exportSvg(folder, name) {
  const html = await readFile(path.join(folder, `${name}.html`), 'utf8')
  const svg = html.match(/<svg\b[^>]*>[\s\S]*?<\/svg>/i)?.[0]
  if (!svg) return
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1]).join('\n')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const standalone = svg.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"').replace(/(<svg[^>]*>)/, `$1<style>${styles}</style>`)
  await writeFile(path.join(folder, `${name}.svg`), standalone)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [folder, archify] = process.argv.slice(2)
  if (!folder || !archify) throw new Error('Usage: architecture-render.mjs <view-directory> <archify-root>')
  const receipt = await renderCandidate(folder, archify)
  process.stdout.write(JSON.stringify(receipt))
  process.exitCode = receipt.ok ? 0 : 1
}
