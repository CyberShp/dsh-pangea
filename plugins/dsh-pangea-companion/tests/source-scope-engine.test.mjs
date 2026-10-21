import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const python = process.env.PANGEA_TEST_PYTHON, agent = process.env.PANGEA_AGENT_ROOT
const execute = promisify(execFile)
test('real engine preview matches frozen source set, honors ignores and rejects a changed confirmation', { skip: !python || !agent }, async t => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'scope-engine-'))
  t.after(() => rm(dataRoot, { recursive: true, force: true }))
  const repository = path.join(dataRoot, 'repositories/repo'), scope = '中文 TLS,模块'
  await mkdir(path.join(repository, scope, 'build'), { recursive: true })
  await mkdir(path.join(repository, '空目录'))
  for (let i = 0; i < 62; i++) await writeFile(path.join(repository, scope, `握手-${i}.c`), `int handshake_${i}(void) { return ${i}; }\n`)
  await writeFile(path.join(repository, scope, 'build/ignored.c'), 'int ignored;')
  await writeFile(path.join(repository, scope, '说明.md'), 'context only')
  async function cli(...args) {
    const { stdout } = await execute(python, ['-m', 'pangea_agent.cli.main', ...args], { cwd: agent, env: { ...process.env, PYTHONUTF8: '1' }, maxBuffer: 8 * 1024 * 1024 })
    const value = JSON.parse(stdout); assert.equal(value.ok, true, JSON.stringify(value.error)); return value.result
  }
  const preview = scopes => cli('source-scope-preview', '--data-root', dataRoot, '--repository', 'repo', '--source-scope', JSON.stringify(scopes))
  const selected = [scope, `${scope}/握手-0.c`], result = await preview(selected)
  assert.equal(result.matched_file_count, 62)
  assert.equal(new Set(result.files.map(item => item.relative_path)).size, 62)
  assert.ok(result.files.every(item => !item.relative_path.includes('/build/')))
  assert.equal((await preview(['.'])).matched_file_count, 62)
  assert.equal((await preview(['空目录'])).matched_file_count, 0)
  for (const scopes of [[], ['不存在'], ['../'], ['']]) await assert.rejects(preview(scopes))
  const contract = path.join(dataRoot, 'contract.json')
  const input = { data_root: dataRoot, run_id: 'scope-exact', repository: 'repo', target: 'TLS fixture', source_scope: selected,
    workflow_version: 'source-first-v1', analysis_profile: 'behavior-test-v2', analysis_settings: { scenario: 'module-analysis', mode: 'speed' }, expected_scope_revision: result.scope_revision }
  await writeFile(contract, JSON.stringify(input))
  await cli('runs', 'create', '--contract', contract)
  const manifest = JSON.parse(await readFile(path.join(dataRoot, 'runs/scope-exact/inputs/source-manifest.json'), 'utf8'))
  const frozen = manifest.scope_expansion.groups.flatMap(group => group.code_paths).sort()
  assert.deepEqual(frozen, result.files.map(item => item.relative_path).sort())
  await writeFile(path.join(repository, scope, '新增.c'), 'int newer;')
  await writeFile(contract, JSON.stringify({ ...input, run_id: 'scope-changed' }))
  await assert.rejects(cli('runs', 'create', '--contract', contract), error => /SOURCE_SCOPE_CHANGED/.test(error.stdout))
  await symlink(dataRoot, path.join(repository, 'outside'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(preview(['outside']))
  // Simulate a selected source becoming unreadable after directory enumeration.
  const probe = `from unittest.mock import patch\nfrom pathlib import Path\nfrom pangea_agent.inventory.scope_preview import preview_scope\noriginal=Path.open\ndef fault(self,*args,**kwargs):\n if self.name == '握手-0.c': raise PermissionError('fixture read failure')\n return original(self,*args,**kwargs)\nwith patch.object(Path,'open',fault): preview_scope(${JSON.stringify(dataRoot)},'repo',[${JSON.stringify(scope)}])`
  await assert.rejects(execute(python, ['-c', probe], { cwd: agent, env: { ...process.env, PYTHONUTF8: '1' } }), error => /fixture read failure/.test(error.stderr))
})
