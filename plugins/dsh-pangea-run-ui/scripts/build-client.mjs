import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(root, 'src', 'client.js')
const outputPath = path.join(root, 'lib', 'client.js')
const source = await readFile(sourcePath, 'utf8')
await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, source, 'utf8')
