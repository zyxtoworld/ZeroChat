# Windows SecretStore cross-session serialization

**Goal:** Prevent one Windows session from deleting the credential generation committed by another session for the same user.
**Root cause:** `Local\\ZeroChat.SecretStore.v2` serializes only inside one terminal session, while PasswordVault data is user-scoped. Cleanup also trusts a caller snapshot instead of rereading the currently published revision, so an interleaving across console, RDP, or fast-user-switch sessions can leave the revision pointer referring to a deleted generation.
**Why planning is required:** This change touches user credentials, Windows kernel-object security, and crash-recovery cleanup. A source-only contract or one successful launch is insufficient evidence for the data-loss claim.
**Acceptance:** The mutex is `Global` and scoped by the current token SID; its DACL grants full access only to that user and SYSTEM; no secret value enters a name, diagnostic, or artifact; cleanup rereads and validates the current revision while holding the lock; all three public operations retain the existing in-process and cross-process lock order; source contracts, shell guards, and a Release x64 build pass with zero warnings/errors. Same-session runtime evidence is recorded honestly and is not described as a cross-session concurrency proof.

### Outcome 1: Failing ownership contracts
- Work: Replace the contract that enshrines the fixed `Local` mutex with assertions for a SID-derived `Global` name, explicit user/SYSTEM security descriptor, and cleanup ownership derived from `meta:revision` at cleanup time.
- Red condition: The focused contract must fail against the current implementation for the expected `Local` name and stale caller-owned cleanup transaction.
- Verify: `D:\Node.js\pnpm.CMD exec vitest run scripts/__tests__/windows-secret-store-atomicity.test.mjs`

### Outcome 2: Secure cross-session lock and cleanup
- Work: Resolve the current process token SID, create `Global\\ZeroChat.SecretStore.v2.<SID>` with a protected current-user/SYSTEM DACL, and keep all allocated handles and security descriptors under deterministic cleanup. Make residual cleanup reread `meta:revision` and parse its committed generation rather than accepting a transaction captured before cleanup.
- Invariants: Do not change PasswordVault resource/account formats, persisted credential values, operation ordering, or user-clear semantics. Lock creation and SID/ACL failures fail closed.
- Verify: Run the focused contract, `check:windows-shell`, `check:windows-native-contracts`, and `build:windows:release`.

### Outcome 3: Evidence and release honesty
- Work: Exercise the built Windows shell so SID/ACL creation and PasswordVault startup paths run on the current host, update guarded requirements/audit text, and rebuild current Web/Windows/MSIX evidence only after all source audits stabilize.
- Evidence boundary: Current-session runtime validates construction and ordinary lifecycle only. Cross-session console/RDP contention remains target evidence until a controlled two-session drill exists.
- Verify: Run relevant repository/document/completion guards, security scan, local cleanup, and the full release verifier after current artifacts are rebuilt.
