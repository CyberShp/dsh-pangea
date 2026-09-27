import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let source = await readFile(path.join(root, 'src', 'client.js'), 'utf8')
const productUi = await readFile(path.join(root, 'src', 'product-ui.css'), 'utf8')
const cssPlaceholder = "/* PRODUCT_UI_CSS */ ''"
if (source.split(cssPlaceholder).length !== 2) throw new Error('Expected one PRODUCT_UI_CSS placeholder')
source = source.replace(cssPlaceholder, JSON.stringify(productUi))
const modelAdapter = await readFile(path.join(root, 'src', 'product-model-adapter.js'), 'utf8')
await mkdir(path.join(root, 'lib'), { recursive: true })
await writeFile(path.join(root, 'lib', 'client.js'), `${source.trimEnd()}\n\n${modelAdapter.trim()}\n`, 'utf8')
