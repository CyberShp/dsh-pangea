import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(root, 'src', 'client.js')
const outputPath = path.join(root, 'lib', 'client.js')

function replaceExactlyOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle)
  if (first < 0) throw new Error(`dsh-pangea-companion build: missing ${label} anchor`)
  if (source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`dsh-pangea-companion build: ambiguous ${label} anchor`)
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length)
}

function replacePatternExactlyOnce(source, pattern, replacement, label) {
  const matches = [...source.matchAll(pattern)]
  if (matches.length !== 1) {
    throw new Error(`dsh-pangea-companion build: expected 1 ${label} anchor, found ${matches.length}`)
  }
  return source.replace(pattern, replacement)
}

let source = await readFile(sourcePath, 'utf8')

source = replaceExactlyOnce(
  source,
  "                appCard('environment', '环境配置', 'AI 对话式测试环境操作', () => openProductPage('execution', '环境与执行')))),",
  "                appCard('assets', '测试资产', '需求、历史缺陷、覆盖率与方法论资产', () => openProductPage('assets', '测试资产')))),",
  'workbench test application',
)

source = replacePatternExactlyOnce(
  source,
  /(id: 'execution', title: \(\) => '环境配置', icon, order: 20,\r?\n\s*)available: \(_ctx, scope\) => Boolean\(scope\?\.cwd\),/g,
  '$1available: () => false,',
  'hidden execution page availability',
)

await mkdir(path.join(root, 'lib'), { recursive: true })
await writeFile(outputPath, source, 'utf8')
