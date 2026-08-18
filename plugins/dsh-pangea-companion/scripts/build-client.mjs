import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
await mkdir(path.join(root, 'lib'), { recursive: true })
await copyFile(path.join(root, 'src', 'client.js'), path.join(root, 'lib', 'client.js'))
