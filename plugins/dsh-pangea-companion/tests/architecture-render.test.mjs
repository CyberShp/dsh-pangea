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
  const html = '<html><style>/* PERMISSION & CONDITIONS; <font> */ .node > text { fill: red; }</style><svg viewBox="0 0 20 20"><text>中文</text></svg></html>'
  await writeFile(path.join(archify, 'bin/archify.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[5], ${JSON.stringify(html)}); console.log('{"ok":true}');`)
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../src/architecture-render.mjs', import.meta.url)), view, archify], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(await readFile(path.join(view, 'diagram.html'), 'utf8'), html)
  const svg = await readFile(path.join(view, 'diagram.svg'), 'utf8')
  assert.match(svg, /xmlns="http:\/\/www.w3.org\/2000\/svg"/)
  assert.match(svg, /PERMISSION &amp; CONDITIONS; &lt;font&gt;/)
  assert.match(svg, /\.node &gt; text/)
  assert.match(svg, /<text>中文<\/text>/)
})
