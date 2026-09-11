# Offline replay replacement lease fence

**Goal:** Close the microtask-level time-of-check/time-of-use window between offline replay replacement checks and their next side effect.
**Why planning is required:** The change protects production data replacement and replay persistence ordering across asynchronous lifecycle owners.
**Acceptance:** A replacement scheduled in the microtask after a no-lease check must prevent replay terminal/Provider side effects; an owned lease must still durable-requeue the local claim; unrelated external claims remain untouched.

### Outcome 1: Reproduce the stale false result
- Work: Add a deterministic Store behavior test that queues a replacement from a two-level microtask after the replay check observes no lease, while token/stream work is deferred.
- Risks/open questions: Keep the test local and use existing mocked persistence/runtime; do not alter release evidence or external state.
- Verify: `D:\Node.js\pnpm.CMD exec vitest run src/app/__tests__/store.test.ts -t "microtask|lease" --pool=threads --maxWorkers=1`

### Outcome 2: Make the no-lease path non-yielding
- Work: Return a synchronous false from the replay lease probe and await only the durable requeue path when a lease is already owned; preserve fail-closed behavior on requeue failure.
- Verify: `D:\Node.js\pnpm.CMD exec vitest run src/app/__tests__/store.test.ts -t "microtask|offline replay|claimed offline replay" --pool=threads --maxWorkers=1`

### Outcome 3: Revalidate current contracts
- Work: Confirm the current store contract still binds the helper and behavior tests without changing provenance or external blocker state.
- Verify: `D:\Node.js\pnpm.CMD exec vitest run src/app/__tests__/store.test.ts --pool=threads --maxWorkers=1`; `D:\Node.js\pnpm.CMD exec vitest run scripts/__tests__/current-web-sync-contract.test.mjs --pool=threads --maxWorkers=1`; `D:\Node.js\pnpm.CMD exec tsc --noEmit`
