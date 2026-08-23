import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILL_NAMES = [
  'pangea-extract-historical-issues',
  'pangea-derive-methodology-candidates',
]

function parseSkill(markdown, skillPath) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) throw new Error(`invalid bundled skill frontmatter: ${skillPath}`)
  const fields = Object.fromEntries(match[1].split('\n').map(line => {
    const separator = line.indexOf(':')
    if (separator < 1) throw new Error(`invalid bundled skill metadata: ${skillPath}`)
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()]
  }))
  if (!fields.name || !fields.description || !match[2].trim()) throw new Error(`incomplete bundled skill: ${skillPath}`)
  return {
    name: fields.name,
    description: fields.description,
    content: match[2].trim(),
    source: 'bundled',
    provider: 'dsh-pangea-asset-catalog',
    path: skillPath,
    resourceBase: { kind: 'directory', path: path.dirname(skillPath) },
    invocation: { modelInvocable: false, userInvocable: true },
  }
}

export async function loadBundledSkills() {
  const sourceRoot = path.dirname(fileURLToPath(import.meta.url))
  return Promise.all(SKILL_NAMES.map(async name => {
    const skillPath = path.resolve(sourceRoot, '..', 'skills', name, 'SKILL.md')
    const skill = parseSkill(await readFile(skillPath, 'utf8'), skillPath)
    if (skill.name !== name) throw new Error(`bundled skill name mismatch: expected ${name}, received ${skill.name}`)
    return skill
  }))
}

export { SKILL_NAMES }
