# Sync access-key copy ownership

**Goal:** Ensure Cloudflare access-key copy derives from the durable passphrase owner that precedes the copy action and cannot publish stale feedback after a later owner change.
**Why planning is required:** The boundary derives a secret and crosses asynchronous durable-storage and clipboard APIs.
**Acceptance:** A copy invoked after a queued passphrase write waits for that write and copies only the newly committed key; a failed write copies nothing; unrelated lifecycle work does not block copy; a later passphrase mutation invalidates an in-flight copy without allowing its old finalizer to clear a new owner; duplicate copies coalesce; raw failures remain contained.

### Outcome 1: Reproduce pre-owner ordering
- Work: Add deterministic Store tests for deferred successful and failed passphrase persistence, unrelated durable work, and old/new copy owner settlement.
- Verify: `D:\Node.js\pnpm.CMD exec vitest run src/app/__tests__/store.test.ts -t "orders access-key copy after an already queued passphrase write" --pool=threads --maxWorkers=1`

### Outcome 2: Serialize derivation without holding clipboard I/O
- Work: Wait only for the latest passphrase mutation that preceded the copy, preserve its success/failure result, and reject stale work before the clipboard call and feedback. Keep derivation and clipboard I/O outside the durable lane.
- Risks/open questions: Do not expose passphrases, access keys, paths, or raw clipboard errors in diagnostics.
- Verify: `D:\Node.js\pnpm.CMD exec vitest run src/app/__tests__/store.test.ts -t "Cloudflare access-key|stale derived access key" --pool=threads --maxWorkers=1`

### Outcome 3: Revalidate production contracts
- Work: Bind the behavior test to the current Web sync contract and run the affected Store, TypeScript, build, and repository gates.
- Verify: `D:\Node.js\pnpm.CMD exec vitest run scripts/__tests__/current-web-sync-contract.test.mjs src/app/__tests__/store.test.ts --pool=threads --maxWorkers=1`; `D:\Node.js\pnpm.CMD exec tsc -b`; `D:\Node.js\pnpm.CMD run build`; `D:\Node.js\pnpm.CMD run check:repo`
