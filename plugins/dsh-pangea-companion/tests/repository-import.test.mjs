import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { importRepository, normalizeRepositoryId, repositoryStatus } from '../src/repositories/import.js'

const temporaryRoots = []

test.afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function temporaryRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'pangea-repository-import-'))
  temporaryRoots.push(root)
  return root
}

test('fresh data root requires onboarding', async () => {
  const root = await temporaryRoot()
  const status = await repositoryStatus(path.join(root, 'pangea-data'))
  assert.equal(status.onboarding_required, true)
  assert.deepEqual(status.repositories, [])
})

test('imports the complete repository and marks onboarding complete', async () => {
  const root = await temporaryRoot()
  const source = path.join(root, 'source')
  const dataRoot = path.join(root, 'workspace', 'pangea-data')
  await mkdir(path.join(source, '.git'), { recursive: true })
  await writeFile(path.join(source, '.git', 'config'), '[core]\n')
  await writeFile(path.join(source, 'README.md'), '# source\n')

  const imported = await importRepository({ dataRoot, sourcePath: source, repositoryId: '存储测试' })

  assert.deepEqual(imported, { repository_id: '存储测试', name: '存储测试' })
  assert.equal(await readFile(path.join(dataRoot, 'repositories', '存储测试', '.git', 'config'), 'utf8'), '[core]\n')
  const status = await repositoryStatus(dataRoot)
  assert.equal(status.onboarding_required, false)
  assert.deepEqual(status.repositories, [{ repository_id: '存储测试', name: '存储测试' }])
})

test('never overwrites an existing repository with the same name', async () => {
  const root = await temporaryRoot()
  const source = path.join(root, 'source')
  const dataRoot = path.join(root, 'workspace', 'pangea-data')
  await mkdir(source, { recursive: true })
  await writeFile(path.join(source, 'README.md'), 'first')
  await importRepository({ dataRoot, sourcePath: source, repositoryId: 'repo' })
  await writeFile(path.join(source, 'README.md'), 'second')

  await assert.rejects(
    importRepository({ dataRoot, sourcePath: source, repositoryId: 'repo' }),
    /repository already exists/
  )
  assert.equal(await readFile(path.join(dataRoot, 'repositories', 'repo', 'README.md'), 'utf8'), 'first')
})

test('rejects unsafe repository names', () => {
  assert.throws(() => normalizeRepositoryId('../repo'), /path separator/)
  assert.throws(() => normalizeRepositoryId('CON'), /not supported by Windows/)
  assert.equal(normalizeRepositoryId('open-iscsi'), 'open-iscsi')
})
