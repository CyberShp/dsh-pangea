import test from 'node:test'

// Keep the packaged integration visible to the ordinary *.test.mjs suite.
// A configured app root is strict: import or dependency errors must fail.
if (process.env.PANGEA_TEST_APP_ROOT) {
  await import('./cordis-launch.integration.mjs')
} else {
  test('real Cordis packaged launch integration', {
    skip: 'Set PANGEA_TEST_APP_ROOT to a prepared Desktop app root; npm run test:cordis requires it.',
  }, () => {})
}
