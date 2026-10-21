import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { normalizeRunInput } from '../src/workbench-api.js'
import { createRun } from '../src/pangea-api.js'

const capabilities = { repositories: ['repo'], analysis_skill: { skill_id: 'codetalks-skill', version: '1.4.9' } }
test('coverage request preserves exact query version and optional scope end to end', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'coverage-input-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, '.agents/pangea'), { recursive: true })
  await writeFile(path.join(root, '.agents/pangea/dsh.md'), '# synthetic')
  const input = normalizeRunInput({ repository: 'repo', target: 'synthetic', scenario: 'coverage-analysis', source_scope: [],
    coverage_input: { kind: 'query', query: { product: 'P', c_version: ' VERSION A ', module: 'M' } } }, capabilities)
  assert.deepEqual(input.source_scope, [])
  let captured
  await createRun(root, input, async ({ args }) => {
    if (args[0] === 'system') return capabilities
    captured = JSON.parse(await readFile(args.at(-1), 'utf8'))
    return { run_id: 'run' }
  })
  assert.equal(captured.coverage_input.query.c_version, ' VERSION A ')
  assert.deepEqual(captured.source_scope, [])
})
