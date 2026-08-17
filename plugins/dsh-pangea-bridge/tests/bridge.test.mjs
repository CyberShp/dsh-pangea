import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { apply, runPangeaModuleAnalysis } from '../src/index.js'

test('registers the low-level and end-to-end PANGEA tools', () => {
  const registered = []
  apply({ tools: { register(tool) { registered.push(tool) } } })
  assert.deepEqual(registered.map(tool => tool.name), ['pangea_run', 'pangea_analyze'])
  assert.deepEqual(registered[0].parameters.required, ['pangea_root', 'contract_path'])
  assert.deepEqual(
    registered[1].parameters.required,
    ['data_root', 'repository', 'target', 'source_scope'],
  )
})

test('rejects a relative pangea_root before starting a process', async () => {
  await assert.rejects(
    runPangeaModuleAnalysis({ pangea_root: 'relative', contract_path: 'contract.json' }),
    /pangea_root must be an absolute path/,
  )
})

const pangeaRoot = process.env.PANGEA_ROOT
const pangeaPython = process.env.PANGEA_PYTHON

test('creates then resumes one real isolated PANGEA run', {
  skip: !(pangeaRoot && pangeaPython),
  timeout: 120_000,
}, async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-pangea-bridge-'))
  try {
    const repositoryRoot = path.join(fixtureRoot, 'repositories', 'tiny')
    await mkdir(path.join(repositoryRoot, 'src'), { recursive: true })
    await mkdir(path.join(fixtureRoot, 'inbox'), { recursive: true })
    await mkdir(path.join(fixtureRoot, 'coverage'), { recursive: true })
    await writeFile(
      path.join(repositoryRoot, 'src', 'sample.c'),
      'static int helper(int value) { return value < 0 ? -1 : value + 1; }\nint sample_api(int value) { return helper(value); }\n',
      'utf8',
    )
    const contractPath = path.join(fixtureRoot, 'contract.json')
    await writeFile(contractPath, `${JSON.stringify({
      run_id: 'bridge-smoke-01',
      data_root: fixtureRoot,
      mode: 'module_analysis',
      repository: 'tiny',
      target: 'sample-api',
      source_scope: ['src/sample.c'],
      focus: ['negative input and return value'],
    }, null, 2)}\n`, 'utf8')

    const input = {
      pangea_root: pangeaRoot,
      contract_path: contractPath,
      python_executable: pangeaPython,
    }
    const created = await runPangeaModuleAnalysis(input)
    assert.equal(created.run_id, 'bridge-smoke-01')
    assert.equal(created.phase, 'WAITING_ANALYSIS')
    assert.equal(created.resumed, false)
    assert.ok(created.task_paths.length > 0)

    const resumed = await runPangeaModuleAnalysis(input)
    assert.equal(resumed.run_id, created.run_id)
    assert.equal(resumed.phase, created.phase)
    assert.equal(resumed.resumed, true)
    assert.deepEqual(resumed.task_paths, created.task_paths)
  }
  finally {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})
