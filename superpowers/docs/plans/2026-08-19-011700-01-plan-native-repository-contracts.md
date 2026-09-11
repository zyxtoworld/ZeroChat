# Native Repository Contract Failures

**Goal:** Restore the four current native repository-health contracts through production behavior and focused tests without weakening the checker.
**Why planning is required:** This crosses Android persistence/settings, Apple/Linux startup recovery, and repository release gates; a superficial marker change could misreport durable-data safety or cancellation behavior.
**Acceptance:** Each reported failure has a confirmed production root cause, a focused old-red test, a minimal production fix, and a green focused result. After source changes, Android unit, lint, debug/release builds, APK size, and repository health are rerun; releaseEvidence remains fail-closed.

### Outcome 1: Cancellation boundaries
- Work: Trace every missing condition behind the suspend `Result` contract, especially Android rollback/body cleanup/persistence/Provider settings and the Apple/Linux analogues. Preserve `CancellationException` through the real suspend caller and retain ordinary failure reporting.
- Risks/open questions: Do not add string markers or convert cancellation into ordinary failure merely to satisfy repository health.
- Verify: focused cancellation suites, `pnpm run check:repo`, and the Android gates required after source changes.

### Outcome 2: Startup unreadable-snapshot recovery
- Work: Trace Android, Apple, and Linux startup load failure callers. Prove that unreadable snapshots remain write-protected until explicit recovery succeeds, including ordinary persistence/sync admission and recovery failure.
- Risks/open questions: Recovery must not discard user data or silently unlock writes; platform-specific durable journals must remain intact.
- Verify: focused startup/recovery tests for each platform plus `pnpm run check:repo`.

### Outcome 3: Android Model settings
- Work: Compare the current Model settings production caller with the focused helper/editor contracts. Restore only missing behavior or ownership boundaries: provider picking, fetched/manual catalog edits, defaults, ordering, deletion fallback, and missing-key admission.
- Risks/open questions: Keep the single current Settings surface and avoid static markers that do not prove caller behavior.
- Verify: Model settings focused tests, Android unit/lint/build/size gates, and `pnpm run check:repo`.

### Outcome 4: Android Provider settings
- Work: Trace progressive rendering, editor ownership, capability/status projection, key-before-network admission, fetched model authority, final-enabled-provider protection, and disabled/deleted-provider conversation fallback through the real Settings and Store callers.
- Risks/open questions: Do not broaden the UI or weaken deletion/credential transactions; keep provider identity and durable fallback semantics exact.
- Verify: Provider settings helper/UI focused tests, Android unit/lint/build/size gates, and `pnpm run check:repo`.

