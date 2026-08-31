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

let source = await readFile(sourcePath, 'utf8')

source = replaceExactlyOnce(
  source,
  "                appCard('environment', '环境配置', 'AI 对话式测试环境操作', () => openProductPage('execution', '环境与执行')))),",
  "                appCard('assets', '测试资产', '需求、历史缺陷、覆盖率与方法论资产', () => openProductPage('assets', '测试资产')))),",
  'workbench test application',
)

source = replaceExactlyOnce(
  source,
  "      ctx.effect(() => pangea.registerPage({\n        id: 'execution', title: () => '环境配置', icon, order: 20,\n        available: (_ctx, scope) => Boolean(scope?.cwd),\n        component: props => h(PangeaPanel, { ...props, ctx, initialScreen: 'environment', pageMode: 'execution' }),\n      }), 'dsh-pangea-companion: execution page')\n",
  '',
  'execution page registration',
)

await mkdir(path.join(root, 'lib'), { recursive: true })
await writeFile(outputPath, source, 'utf8')
