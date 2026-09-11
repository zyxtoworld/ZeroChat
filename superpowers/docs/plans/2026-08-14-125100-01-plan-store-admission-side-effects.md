# Store mutation admission and late-write audit

**Goal:** Verify that every reachable Store mutation either admits before side effects or remains valid across asynchronous persistence and replacement ownership changes.
**Why planning is required:** This is a high-risk concurrency audit across public actions, durable AppData writes, and replacement leases; an incorrect fix can cancel user work or resurrect stale state.
**Acceptance:** A real caller-specific counterexample is reproduced before any production edit; any fix uses the existing Store ownership/admission mechanism; rejected actions have no observable side effect; accepted actions cannot write stale data after replacement; unrelated release/provenance evidence remains untouched.

### Outcome 1: Enumerate uncovered public mutation lanes
- Work: Map Store actions and their first side effect, replacement gate, conversation/generation gate, and durable commit path. Classify read-only or intentionally canceling actions separately.
- Verify: `rg -n "runConversationMutation|rejectDataReplacementAction|dataReplacementQueued|updateData|commit|persist|stopSpeech|stopAudio|runAssistantStream|runImageGeneration" src/app/store.ts`

### Outcome 2: Reproduce one real asynchronous boundary
- Work: Add one focused behavior test only for a confirmed missing admission or late-write contract, using a deferred public dependency and observable state/provider/persistence effects.
- Risks/open questions: Do not restore deleted controllers, add a parallel queue, or alter external release/provenance artifacts.
- Verify: `D:\Node.js\pnpm.CMD exec vitest run src/app/__tests__/store.test.ts -t "<focused contract>" --pool=threads --maxWorkers=1`

### Outcome 3: Apply and validate the smallest root fix
- Work: Reuse the existing owner/generation helper and preserve FIFO semantics; keep normal accepted actions and intentional cancel actions unchanged.
- Verify: `D:\Node.js\pnpm.CMD exec vitest run src/app/__tests__/store.test.ts --reporter=dot`; `D:\Node.js\pnpm.CMD exec tsc --noEmit -p tsconfig.json`; `D:\Node.js\pnpm.CMD run build`

### Outcome 4: Contain startup Skill materialization failures
- Work: Keep the startup materialization source/persisted pair until AppData publication is known to be durable; queue unpublished refs on failure, contain cleanup failure, preserve the pending retry, and make the first failed init settle with `status=error`.
- Verify: Startup failure and retry behavior tests in `src/app/__tests__/store.test.ts`; Store suite; TypeScript; ESLint.

### Outcome 5: Abort partial IndexedDB Skill writes
- Work: Abort `batchPutDocuments` and legacy plaintext Skill migration transactions when a synchronous or request-level write failure occurs, preserving the primary operation error and preventing partial encrypted refs from becoming visible or orphaned.
- Verify: Focused partial-write red/green tests and `src/storage/__tests__/db.test.ts` (23 tests); TypeScript; ESLint; production build.

### Outcome 6: Verify page lifecycle flush and continue async-boundary audit
- Work: Prove the installed `pagehide` listener flushes a debounced AppData change before the timer; record no production change when the behavior is already correct. Continue with a new production-reachable detached lifecycle boundary only after a deterministic counterexample exists.
- Verify: Store pagehide behavior test, bundle gate, production reachability, local cleanup, and the next focused boundary test.
