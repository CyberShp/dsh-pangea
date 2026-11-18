# 2026-11-18 macOS acceptance fixes

The Companion recovery projection now matches the locked Agent: historical review/closure roles or retired stages advance the workflow rather than resuming a worker. Ordinary analysis continuation and terminal/partial-report handling remain covered.

Asset import business behavior is unchanged. The source-first Agent declares preview/revisions unavailable and allocates an independent ID and source copy on every import. The real-Python tests now verify Chinese text/errors, independent repeated imports, and malformed coverage failure during extraction with persistent host job diagnostics. README distinguishes this contract from legacy engine capabilities.

Validated on macOS arm64, Node 25.9.0, Python 3.12.12, with Agent b8eda305f7adabbaf5d082984422c6c703a5ae10 and Desktop d7dc48d plus the acceptance fixes:

- Companion npm test: 1131 passed, 23 existing skips; mandatory HappyDOM: all four suites passed.
- Asset Catalog npm test: 122 passed, zero skips.
- Main plugin npm test: 45 passed.
- Cordis: 12 passed; Desktop ACP injection delivery: 6 passed.
- Rebuilt Companion client has no tracked output drift.
- Real Git hooks, C compilation, fault injection, and both longpaths configuration variants ran on macOS. Models are deterministic fixtures.

Windows PS 5.1 parsing, directory-lock rollback/relaunch, TEMP DLL monitoring, native Windows long paths, and win-unpacked execution were not validated by this run. These results are not release acceptance.
