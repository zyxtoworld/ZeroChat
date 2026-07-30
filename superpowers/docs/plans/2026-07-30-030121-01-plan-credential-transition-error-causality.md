# Credential transition error causality

**Goal:** Preserve the primary persistence or credential-storage failure together with every failed credential-transition compensation attempt.
**Why planning is required:** Provider and complete-secret transitions span encrypted IndexedDB journals, durable AppData, and Windows PasswordVault. Replacing the primary failure with a rollback failure hides the operation that first broke and weakens recovery diagnostics at a credential boundary.
**Acceptance:** Public transition APIs throw a localized `AggregateError` containing the primary error followed by the compensation error when rollback cannot complete, with the compensation error retained as `cause`. If the durable AppData read needed to choose completion or rollback also fails, a distinct localized unknown-state `AggregateError` preserves the write and read failures and leaves the encrypted transition journal available for startup recovery. Successful compensation still rethrows the original error unchanged, and committed transitions keep their existing best-effort journal cleanup behavior. Tests use only in-memory browser and Windows bridge doubles; no live credentials or external state are touched.

### Outcome 1: Reproduce lost failure causality
- Work: Extend the Windows bridge test harness with deterministic mutation-failure injection and add public API regressions for AppData persistence plus rollback failure, initial Locker staging plus rollback failure, and AppData persistence plus durable-state read failure.
- Verify: The focused tests fail against the current implementation because either only the compensation failure or only the primary persistence failure escapes.

### Outcome 2: Preserve primary, compensation, and resolution failures
- Work: Add small credential-transition error helpers in `src/storage/secrets.ts`; apply them to Windows staging rollback, AppData failure compensation, and failed durable-state resolution. Keep successful rollback and committed best-effort cleanup semantics unchanged. Generalize the existing localized rollback message so it accurately covers passphrase and full credential-state recovery, and add distinct close-and-reopen guidance when durable state cannot be determined.
- Verify: `D:\Node.js\pnpm.CMD exec vitest run src/storage/__tests__/secrets.test.ts`

### Outcome 3: Guard the recovery contract
- Work: Add concise requirements and QA markers plus repository/completion static guards for dual-failure causality, localized recovery guidance, public-boundary regressions, and retained transition journals.
- Verify: `D:\Node.js\node.exe node_modules/typescript/bin/tsc -b`; focused ESLint; i18n, repository, completion-audit, and documentation checks.

### Outcome 4: Refresh current-source release evidence
- Work: Run proportionate full unit/coverage and current Web/Windows release verification after the final source mutation, then refresh sanitized blocker diagnostics and perform sensitive-data and local-runtime cleanup checks.
- Risks/open questions: Apple and Linux target-runtime QA, elevated trusted-MSIX runtime evidence, disposable live-sync credentials, hosted CI, and unsupported live-provider capabilities remain external blockers and must not be reported as completed by this Web/Windows storage fix.
- Verify: Repository release commands required by `docs/REQUIREMENTS.md`, followed by `D:\Node.js\pnpm.CMD run check:local-cleanup`.
