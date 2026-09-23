import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

test('SVG export encodes font-license and CSS text as XML while preserving HTML', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-svg-export-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const view = path.join(root, 'view')
  const archify = path.join(root, 'archify')
  await mkdir(view)
  await mkdir(path.join(archify, 'bin'), { recursive: true })
  await writeFile(path.join(view, 'manifest.json'), JSON.stringify({ type: 'architecture', status: 'generating' }))
  await writeFile(path.join(view, 'candidate.json'), '{}')
  const html = '<html><style>/* PERMISSION & CONDITIONS; <font> */ .node > text { fill: red; }</style><svg viewBox="0 0 20 20"><text>中文</text></svg></html>'
  await writeFile(path.join(archify, 'bin/archify.mjs'), `import { writeFileSync } from 'node:fs'; if (process.argv[2] === 'deliver') writeFileSync(process.argv[5], ${JSON.stringify(html)}); console.log('{"ok":true}');`)
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../src/architecture-render.mjs', import.meta.url)), view, archify], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(await readFile(path.join(view, 'diagram.html'), 'utf8'), html)
  const svg = await readFile(path.join(view, 'diagram.svg'), 'utf8')
  assert.match(svg, /xmlns="http:\/\/www.w3.org\/2000\/svg"/)
  assert.match(svg, /PERMISSION &amp; CONDITIONS; &lt;font&gt;/)
  assert.match(svg, /\.node &gt; text/)
  assert.match(svg, /<text>中文<\/text>/)
})

test('renderer preserves failures and candidate while limiting actual invocations to three', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pangea-render-fail-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const archify = path.join(root, 'archify')
  await mkdir(path.join(archify, 'bin'), { recursive: true })
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ type: 'workflow', status: 'generating', created_at: new Date().toISOString(), budget_ms: 120000, max_render_attempts: 3 }))
  await writeFile(path.join(root, 'candidate.json'), '{"preserve":true}')
  await writeFile(path.join(archify, 'bin/archify.mjs'), `console.error('specific render failure'); process.exitCode = 7`)
  for (let i = 0; i < 4; i++) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../src/architecture-render.mjs', import.meta.url)), root, archify], { encoding: 'utf8' })
    assert.equal(result.status, 1, result.stderr)
  }
  const history = (await readFile(path.join(root, 'render-history.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(history.length, 3)
  assert.equal(history[0].exit_code, 7)
  assert.match(history[0].stderr, /specific render failure/)
  assert.equal(JSON.parse(await readFile(path.join(root, 'validation-receipt.json'), 'utf8')).attempts_exhausted, true)
  assert.equal(await readFile(path.join(root, 'candidate.json'), 'utf8'), '{"preserve":true}')
})
