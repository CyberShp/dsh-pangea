# Injection generation safety contract v2

New injection tasks persist `generation_contract_version: 2`. Their generated result must include:

- `points[].trigger_scope.current_input`: the current operation's source and matching expression.
- `points[].trigger_scope.excluded_inputs`: historical or unrelated inputs that must not trigger or consume the fault budget.
- `profiles[].safety.setup`: commands that snapshot prior state and register resources owned by this verification.
- `negative_steps` and `negative_point_ids`: executable negative checks covering every referenced point, using a fresh, unconsumed budget before the positive scenario.
- `cleanup`: idempotent commands that restore prior control state and remove only verification-owned resources, including after partial setup.
- `cleanup_verify`: independent commands that verify restoration and resource cleanup.

The host checks the required structure before applying edits. It does not prove that model-generated code or commands have the claimed semantics. Runtime negative/positive/recovery verification is still required.

The exported Bash script installs cleanup before setup, executes setup → negative checks → existing steps, and runs cleanup plus an independent cleanup check on exit. Each profile has its own shell. INT/TERM to the main script forwards termination to the profile shell and waits for cleanup. Cleanup failures cannot turn an original failure into success; a cleanup-only failure exits 125. The case-end marker is emitted after cleanup verification. Commands must be bounded and must not replace the shell, override the host traps, or leave unowned background processes.

Log import treats nonzero case-end or cleanup status as failure, even if the log also contains a passed marker. V2 tasks require both case-end and cleanup completion evidence before a hit can be classified as passed. These are execution markers, not cryptographic proof; the actual logs and state checks remain the evidence.

Old saved tasks without safety metadata retain their original export. Creating a new task by reusing an old result does not bypass the v2 validation: incomplete legacy results must be regenerated. Existing authored results remain available for diagnosis.

Uncatchable termination (SIGKILL, host crash or power loss) is outside the trap guarantee. A project's restoration commands must document any additional environment or lifecycle limits. The v2 structure alone does not establish Windows or multi-process acceptance.

Generated verification must inventory persistent resources, not just close client connections. It must preregister owned IDs before requests, revoke its own authentication sessions/tokens, and verify that they are no longer effective. Sensitive recovery state must not be logged. Missing or damaged backups are errors, not evidence that the original resource was absent. Database row decoding must match the driver's configured row factory, and control flags/counts must reject truthy malformed values.

The shell runtime tests use system Bash 3.2 on macOS and a detected Bash elsewhere. POSIX signal tests explicitly skip Windows; they do not provide Windows process-termination evidence.

A zero-byte original file is a valid snapshot, including an empty base64 value. Presence must be checked by explicit fields, not truthiness. Allocation ownership must be persisted before login and credentials immediately after receipt, before identity probes or assertions; cleanup must also handle an unknown allocation result using the same unique ownership marker.

Restoration must strictly decode and validate backups before overwriting current state. Missing backups and invalid encoding must fail both cleanup and verification, rather than skip the check or silently decode to empty bytes. Resource restoration needs independent exception boundaries so a control-file failure does not prevent revoking owned sessions or cleaning business data.
