import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(root, 'src', 'client.js')
const outputPath = path.join(root, 'lib', 'client.js')

// Shared ESM modules inlined into the browser bundle at the marker below.
// Each module becomes an IIFE so local names never collide with client.js.
const MARKER = '/* @inline-shared-modules */'
const SHARED = [
  ['__sourceScopePicker', 'src/source-scope-picker.js'],
  ['__overviewFindings', 'src/overview-findings.js'],
  ['__caseReviewProjection', 'src/case-review-projection.js'],
  ['__reviewPresentation', 'src/review-presentation.js'],
  ['__runInsights', 'src/run-insights.js'],
  ['__behaviorCoverage', 'src/behavior-coverage.js'],
  ['__flowNormalize', 'src/flow-normalize.js'],
  ['__flowLayout', 'src/flow-graph/layout.js'],
  ['__flowRender', 'src/flow-graph/render.js'],
  ['__callGraph', 'src/call-graph.js'],
  ['__sequenceDiagram', 'src/sequence-diagram.js'],
]

export function inlineModule(name, code, modules) {
  const exported = []
  let body = code.replace(/\r\n/g, '\n')
  body = body.replace(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)'\s*;?$/gm, (_, names, from) => {
    const target = modules.find(([, file]) => path.basename(file) === path.basename(from))
    if (!target) throw new Error(`${name}: cannot inline import from ${from}`)
    return `const {${names}} = ${target[0]}`
  })
  body = body.replace(/^export\s+\{([^}]*)\}\s*;?$/gm, (_, names) => {
    exported.push(...names.split(',').map(item => item.trim()).filter(Boolean))
    return ''
  })
  body = body.replace(/^export\s+(?:async\s+)?(function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm, (match, kind, id) => {
    exported.push(id)
    return match.replace(/^export\s+/, '')
  })
  if (/^\s*(import|export)\s/m.test(body)) throw new Error(`${name}: unsupported import/export syntax`)
  const unique = [...new Set(exported)]
  return `const ${name} = (() => {\n${body}\nreturn { ${unique.join(', ')} }\n})()\n`
}

export async function buildClient() {
  const source = await readFile(sourcePath, 'utf8')
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const marker = source.indexOf(MARKER)
  if (marker < 0) throw new Error(`src/client.js is missing ${MARKER}`)
  const blocks = []
  for (const [name, file] of SHARED) blocks.push(inlineModule(name, await readFile(path.join(root, file), 'utf8'), SHARED))
  const lineStart = source.lastIndexOf('\n', marker) + 1
  const indent = source.slice(lineStart, marker)
  const inlined = blocks.join('\n').split('\n').map(line => line ? indent + line : line).join(eol).trimStart()
  const output = source.slice(0, marker) + inlined + source.slice(marker + MARKER.length)
  await mkdir(path.join(root, 'lib'), { recursive: true })
  await writeFile(outputPath, output, 'utf8')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildClient()
