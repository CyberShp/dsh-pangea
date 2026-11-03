import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

// New-run positive fixtures select a real non-root directory, not a file.
export async function writeSourceRepository(root, repository = 'repo', scope = 'src') {
  const directory = path.join(root, 'pangea-data', 'repositories', repository, scope)
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'fixture.c'), 'int fixture(void) { return 0; }\n')
}
