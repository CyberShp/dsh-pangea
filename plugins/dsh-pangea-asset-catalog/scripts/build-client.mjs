import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
await mkdir(path.join(root, 'lib'), { recursive: true })
let source = await readFile(path.join(root, 'src', 'client.js'), 'utf8')
const placeholder = '/* ASSET_CONTENT_RENDERER */'
if (source.split(placeholder).length !== 2) throw new Error('Expected one ASSET_CONTENT_RENDERER placeholder')
const renderer = await readFile(path.join(root, 'src', 'content-renderer.js'), 'utf8')
source = source.replace(placeholder, () => renderer.replace(/^export /gm, ''))
await writeFile(path.join(root, 'lib', 'client.js'), source, 'utf8')
