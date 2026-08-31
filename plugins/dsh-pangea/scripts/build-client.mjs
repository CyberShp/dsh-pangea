import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(path.join(root, 'src', 'client.js'), 'utf8')
const modelAdapter = await readFile(path.join(root, 'src', 'product-model-adapter.js'), 'utf8')
await mkdir(path.join(root, 'lib'), { recursive: true })
await writeFile(path.join(root, 'lib', 'client.js'), `${source.trimEnd()}\n\n${modelAdapter.trim()}\n`, 'utf8')
