# Drawers and timeline Chromium verification

This runner uses the Desktop's existing Electron dependency and mounts the shipped React client through `preview-ui.mjs`. It uses an isolated temporary Electron user-data directory and deterministic fixtures. It invokes no model, analysis worker, or user task.

From the Desktop build root on Windows (after staging/building the plugins):

```powershell
$profile = Join-Path $env:RUNNER_TEMP ('pangea-drawers-electron-' + [guid]::NewGuid().ToString('N'))
try {
  & node_modules/electron/dist/electron.exe .pangea-build/plugins/dsh-pangea-companion/scripts/verify-drawers-electron.cjs --desktop $PWD --agent .pangea-build/runtime/pangea-runtime --node node_modules/node/bin/node.exe --profile $profile --output .pangea-build/drawers-timeline-ui | Out-Host
  $uiExitCode = $LASTEXITCODE
  if ($uiExitCode -ne 0) { throw "Drawers/timeline UI verification failed: $uiExitCode" }
} finally {
  if (Test-Path -LiteralPath $profile) {
    Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction Stop
  }
}
```

`--node` is optional; otherwise the current Electron executable runs the fixture server in its supported `ELECTRON_RUN_AS_NODE` mode. Relative paths are resolved against the caller's working directory, not the plugin folder. The fixture server listens only on `127.0.0.1`, using a random port. The agent path need not contain `AGENTS.md` or a Python environment for these UI-only checks.

The Electron window is shown so native keyboard Escape/focus can be tested. A usable graphical Windows session is required. No Playwright dependency or download is used. Default preview behavior is unchanged unless `--fixture-module` is explicitly supplied.

## Results

The output directory contains `verification.json` and PNG screenshots on success. On failure it contains `failure.txt` with the failing step, stack, server diagnostics and DOM text, plus `failure.png` when the renderer is available. Exit status is nonzero on assertion, startup, renderer, or cleanup failure. Closing the last Electron window cannot trigger an early status-zero exit; the runner waits for cleanup before returning its final status.

Checks cover concise task headings and the separate full-request task-info drawer, task-info keyboard focus, compact case lists with collapsed filters, bottom drawer position, full explicit source associations including different quotes at one location, preserved parent scrolling, nested Escape/focus, case-switch reset, recorded live/paused/unknown timeline, original-session execution filtering, focus after resetting that filter, Escape back to the timeline, and 900/1280/1920 content widths. The case workspace must stay compact for both missing and explicit-zero historical classification summaries; it must not render the removed global behavior board or feasibility entry.

The runner explicitly opens a task from the task list before checking its pages. The case-switch check deliberately invokes the existing navigation handler while the drawer is open to test reset. The basis drawer expands the original note before testing scroll restoration; long content is otherwise collapsed on initial display. Source selection uses the actual evidence projection rather than fixed fixture option indices. Renderer checks use Electron's DOM execution API; Escape uses native Chromium keyboard input.

A successful run proves these synthetic component interactions, not a live-provider analysis or actual business test execution. Run the separate authorized end-to-end analysis task for that evidence. On the development cloud used to author this script, Chromium process creation is restricted and the Electron binary is unavailable; only syntax, fixture contract tests and actual fixture API health were executed there.

Cleanup captures only the preview child’s reported temporary dataRoot, validates its location/name, waits for that exact child to exit (bounded 5-second stop and 2-second force-stop), and then removes the preview root. An unresponsive process prevents root deletion and fails the run. Renderer errors are collected before navigation and listeners are reinstalled for each scene without resetting cumulative errors.

On Windows, `--profile` is required and must be an absolute path with a `pangea-drawers-electron-` prefix followed by letters/digits/hyphens. The directory must not exist; the runner creates it exclusively and writes `.pangea-ui-verification-profile`. Profile removal is explicitly deferred to the caller after Electron exits because its default session can keep file handles open. The workflow finally block must treat deletion errors as failures. `verification.json` identifies this required post-exit cleanup; it is not a claim that the profile was already removed. Non-Windows runs without `--profile` retain runner-owned temporary-profile cleanup.
