# Windows Storage Clear Recovery

**Goal:** Prevent a failed temporary-snapshot cleanup from resurrecting cleared AppData on the next startup.
**Why planning is required:** This changes a destructive native persistence boundary and must preserve fail-closed recovery semantics.
**Acceptance:** Temporary snapshot cleanup is attempted before primary snapshot deletion; a temporary-delete failure cannot leave only a promotable temporary snapshot; focused contract tests fail against the old order and pass after the minimal reorder.

### Outcome 1: Bind the destructive order to a focused contract
- Work: Extend `apps/windows/tests/storage-service-recovery-contract.test.mjs` with a production-source-bound `ClearAsync` order assertion covering temporary lookup/delete before primary lookup/delete.
- Risks/open questions: Native Windows runtime and compiler are unavailable in this environment, so runtime deletion failure behavior remains unexecuted.
- Verify: `node --test apps/windows/tests/storage-service-recovery-contract.test.mjs`

### Outcome 2: Reorder clear without changing its public API
- Work: In `apps/windows/ZeroChat/StorageService.cpp`, delete the temporary snapshot first and the primary snapshot second, preserving the existing operation gate and exception propagation.
- Risks/open questions: A primary-delete failure after successful temporary deletion leaves the primary snapshot for safe retry; this is fail-closed and does not fabricate a successful clear.
- Verify: `node --test apps/windows/tests/storage-service-recovery-contract.test.mjs`; `git diff --check -- apps/windows/ZeroChat/StorageService.cpp apps/windows/tests/storage-service-recovery-contract.test.mjs`

### Outcome 3: Verify scope and evidence boundary
- Work: Inspect the final two-file diff and report focused contract results separately from unavailable native compile/runtime, with preserve/bundle/release evidence unchanged.
- Verify: `git diff -- apps/windows/ZeroChat/StorageService.cpp apps/windows/tests/storage-service-recovery-contract.test.mjs`
