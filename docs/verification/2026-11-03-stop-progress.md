# Scoped stop progress and confirmation

## Scope

Baseline: dsh-pangea langgraph a683ecfb7d603918d0974e3c9796b2e6eaabd8f1. This change does not clear user data, delete saved results, kill processes by executable name, relax worker identity checks, or add a semantic quality gate. Desktop Windows cleanup changes are separate in commit d9036f95779a852857761245ee8923e27b161055.

## Behavior

- One stop operation is bound to task, Run and execution attempt. Repeated in-flight requests share that operation; late callbacks cannot rewrite a newer attempt.
- Persisted steps report result-write admission, Job cancellation, owned Agent/tool cleanup, owner-session cancellation, exit verification and final publication. They describe observed facts rather than elapsed-time percentages.
- A 3-second HTTP wait yields a successful pending acknowledgement, not a failure. Waiting for a Job to settle is distinct from a blocked identity/proof check. Polling continues while execution_status is stopping; observed Job completion reconciles an already-requested waiting stop.
- Job settlement alone cannot finish an explicit stop. A stopped Run only closes its write admission. Readers of task/list/Run/session/Job all retain stopping while final durable publication is pending; the state view also projects stopping rather than the underlying Run's write-fence flag.
- A restarted host's reused Job ID is never cancelled. It can be ignored only when the old host is absent, the saved worker owner matches this exact attempt, and the original Run's worker exit evidence is verified. Otherwise it remains blocked.
- On reload, an in-flight persisted stop is shown as interrupted/unconfirmed, not as a still-live operation in the new host. Explicit retry rechecks original evidence.
- UI shows completed steps, current wait, blockers and safe refresh/retry. Confirmed stop is shown only after exit evidence and durable stop publication. No percentage is synthesized.

## Verification

The companion test command runs client bundle generation, JavaScript syntax checks and the full node:test suite. Tests used an isolated DSH_HOME. The integrated todo changes also correct the analysis-objective fixture to use an explicit isolated store path.

New coverage includes:
- simultaneous stop requests and the 3-second response boundary;
- persisted in-flight state across reload;
- reused Job IDs with exact old-host/worker proof and negative controls;
- old-attempt progress and terminal Job events;
- delayed final publication across every public task lookup and state projection;
- actual Run/task-dialog event-handler response paths for completed, blocked, running and waiting;
- Run stopped versus execution stopping, and durable confirmation requirements;
- refresh cannot turn a native stop with a failed write fence into confirmed success;
- refresh completes an already-requested waiting stop after its exact Job settles without cancelling twice.

Integrated validation: `DSH_HOME=/workspace/shared/stop-ui-20261103/validation/dsh-home npm test --prefix plugins/dsh-pangea-companion` completed with 854 passed, 0 failed and 10 skipped (864 total). Independent review also exercised the real UI handler bodies, durable read barriers and native refresh bypass. One earlier combined run of the existing closure-budget timing test observed peak concurrency 2 instead of 3; it passed on isolated rerun and this integrated full run. This remains a timing-test stability note, not evidence of Windows behavior. Existing real-Python/staged-runtime tests may skip when that runtime is not configured. Linux tests do not establish Windows native process containment or packaged-app acceptance. The user's approximate original error has not been reproduced on their Windows installation.

After integrating the repository-switch recovery fix, the final full suite ran with all real-Python switches enabled (`PANGEA_PYTHON`, `PANGEA_TEST_PYTHON`, `PANGEA_AGENT_ROOT`, `PANGEA_INTEGRATION_RUNTIME`, and `PYTHONPATH` pointing at the integrated Agent tree): `node --test --test-concurrency=4 --test-timeout=600000 tests/*.test.mjs`. Result: **865 passed, 0 failed, 2 skipped**, 867 total, 378.97 seconds. The remaining skips require Windows path behavior or the separate real case-compiler cancellation setup. Four ACP controller scenarios and semantic-runtime use real Python Graph/CLI writes with simulated workers, not real provider model or Windows native process acceptance. Final generated client was rebuilt with no diff. Integrated Desktop stop suites passed 95 with one Windows-native skip; both Desktop workflow/scene verification scripts passed 7 tests each against the integrated Agent source.
