# Android backup error boundary

**Goal:** Keep unknown backup import/export failures out of user-visible notices while preserving the existing localized format-error path.
**Why planning is required:** This is a security-sensitive, user-visible production error boundary.
**Acceptance:** A real backup failure projection test rejects path/URL/key-shaped exception text, import/export use localized fixed failure notices, Android focused tests and lint pass, and no release/provenance artifact is changed.

### Outcome 1: Establish the failing boundary
- Work: Cover the current DataSettingsBackup failure projection with a sentinel containing Windows/Unix paths, a URL, and a key-shaped value. Assert the resulting notice is localized and contains none of the sentinel fragments.
- Risks/open questions: Keep `InvalidSyncVaultFormatException` on its existing dedicated localized message; do not broaden this change to unrelated NativeI18n callers.
- Verify: `D:\Node.js\pnpm.CMD exec node scripts/android-debug-build.mjs testDebugUnitTest --tests app.zerochat.ui.settings.DataSettingsBackupTest`

### Outcome 2: Close the backup projection
- Work: Replace unknown import/export exception rendering with the existing locale-specific backup failure prefixes. Keep validation and task ownership behavior unchanged.
- Risks/open questions: No raw exception is logged or placed in a notice by this path.
- Verify: The focused Android test and source inspection of `DataSettingsBackup.kt`.

### Outcome 3: Regression verification
- Work: Run the focused backup test, the existing Android unit suite, Android lint, and diff checks. Leave external release blockers and provenance fail-closed.
- Verify: `D:\Node.js\pnpm.CMD run check:android-unit`; `D:\Node.js\pnpm.CMD run check:android-lint`; `git diff --check`.
