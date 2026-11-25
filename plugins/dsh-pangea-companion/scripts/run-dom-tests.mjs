import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const suites = [
  'tests/fault-injection-model-dom.mjs',
  'tests/fault-injection-dom.mjs',
  'tests/fault-injection-workspace-dom.mjs',
  'tests/repository-settings-dom.mjs',
  'tests/live-verification-dom.mjs',
]

let hasHappyDom = false
try {
  await import('happy-dom')
  await import('react')
  await import('react-dom/client')
  hasHappyDom = true
} catch {
  hasHappyDom = false
}

if (!hasHappyDom) {
  if (process.env.CI || process.env.PANGEA_REQUIRE_DOM_TESTS === '1') {
    console.error('DOM tests require happy-dom, react, and react-dom in CI.')
    process.exit(1)
  }
  console.warn('Skipping DOM tests: happy-dom/react runtime not resolved in standalone environment.')
  process.exit(0)
}

for (const suite of suites) {
  const result = spawnSync(process.execPath, [path.join(root, suite)], {
    cwd: root,
    stdio: 'inherit',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
  console.log(`✔ ${suite}`)
}
