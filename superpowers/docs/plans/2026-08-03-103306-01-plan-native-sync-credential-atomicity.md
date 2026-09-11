# Native sync credential atomicity

**Goal:** Make Apple and Linux sync commits crash-consistent across the local snapshot, Provider credentials, and runtime request state.
**Why planning is required:** A process exit or concurrent request can currently pair a remotely synced Provider key with the wrong Provider endpoint, which can disclose a credential to an unintended host.
**Acceptance:** Before either platform changes a synced snapshot or Provider credential, it persists a validated recovery transition whose secret payload is encrypted and contains no plaintext key. Startup and in-process recovery idempotently reach one target generation and remove the transition only after the credential and durable snapshot agree. Apple blocks new requests while applying the transition and captures request credentials before asynchronous work. Linux serializes transition commits with local writes and request binding, and request construction reads Provider configuration and credentials from one committed generation. Focused crash, concurrency, validation, contract, format, and platform tests pass; source-only Windows checks remain honest about unavailable Apple/Linux target runtime evidence.

### Outcome 1: Durable sync-commit transition protocol
- Work: Extend `apps/apple/Sources/ZeroChatCore/SnapshotStore.swift`, `apps/apple/App/AppleChatViewModel.swift`, `apps/linux/src/storage.rs`, and `apps/linux/src/local_data_transition.rs` with a `syncCommit` transition. Reuse the authenticated `SyncVault` envelope for the exact target snapshot and Provider-key map, validate source/target fingerprints and Provider IDs, and retain the journal on indeterminate failure.
- Risks/open questions: The recovery password must remain in the platform credential store, never in the journal or reports. Existing reset/import recovery semantics must remain valid.
- Verify: `D:\Node.js\pnpm.CMD exec vitest run scripts/__tests__/native-sync-credential-atomicity.test.mjs --testTimeout 15000`

### Outcome 2: In-process generation binding
- Work: Gate Apple sync acceptance and request preparation with the existing local-recovery state, capture endpoint credentials before spawning asynchronous requests, and prevent old in-flight work from reading a newly committed key. Add a Linux local-data commit guard shared by transition commits, ordinary snapshot writes, credential mutation transactions, and Provider request binding; construct Linux Provider requests from one durable snapshot/key generation.
- Risks/open questions: Linux background sync must not deadlock the snapshot file mutex or lose queued edits. Failed recovery must fail closed and remain retryable rather than exposing a mixed generation.
- Verify: `D:\Node.js\pnpm.CMD run check:apple-contracts && D:\Node.js\pnpm.CMD run check:linux-contracts && D:\Node.js\pnpm.CMD run check:linux-fmt`

### Outcome 3: Repository evidence and regression coverage
- Work: Add focused Swift/Rust/source-contract coverage for interrupted commits, invalid journals, same-generation request binding, and no-plaintext persistence. Record the fix in `docs/QA_AUDIT.md` and guard the claim in repository/completion checks without claiming unavailable target-runtime evidence.
- Risks/open questions: Apple compilation and Linux GTK runtime remain target-host evidence; current-host checks must distinguish source contracts from runtime proof.
- Verify: `D:\Node.js\pnpm.CMD run check:repo && D:\Node.js\pnpm.CMD run check:completion-audit && D:\Node.js\pnpm.CMD run check:docs && D:\Node.js\pnpm.CMD run check:local-cleanup`
