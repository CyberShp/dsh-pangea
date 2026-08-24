import assert from 'node:assert/strict'
import test from 'node:test'

import { parseSkill } from '../src/bundled-skills.js'

const skill = `---
name: example-skill
description: Example bundled skill
---

# Example

Body content.
`

test('parseSkill accepts LF frontmatter', () => {
  const parsed = parseSkill(skill, '/tmp/example/SKILL.md')
  assert.equal(parsed.name, 'example-skill')
  assert.equal(parsed.description, 'Example bundled skill')
  assert.match(parsed.content, /^# Example/)
})

test('parseSkill accepts CRLF frontmatter used by Windows checkouts', () => {
  const parsed = parseSkill(skill.replace(/\n/g, '\r\n'), 'C:\\tmp\\example\\SKILL.md')
  assert.equal(parsed.name, 'example-skill')
  assert.equal(parsed.description, 'Example bundled skill')
  assert.match(parsed.content, /^# Example/)
})
