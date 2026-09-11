# Offline queue drain liveness

**Goal:** Ensure one real reconnect drain processes every currently durable offline text turn in order without leaving work stranded at an arbitrary batch limit.
**Why planning is required:** This changes production persistence/replay control flow and must preserve single-flight, claim ownership, retry, and replacement fencing.
**Acceptance:** A single `flushOfflineQueue()` caller drains 51 valid queued turns in persisted order; concurrent callers still share one promise; replacement/delete/reset owners still prevent late replay writes; no preserve, release, bundle, or external evidence files are touched.

### Outcome 1: Reproduce the bounded-drain defect
- Work: Add one real `src/app/store.ts` caller test with 51 durable queued text turns, stable captured Provider/model metadata, and a deterministic stream stub.
- Verify: The focused test fails on the current 50-iteration implementation because exactly one queued turn remains.

### Outcome 2: Remove stranded work without weakening ownership
- Work: Change only the replay loop's termination mechanism so it continues until no queued/orphaned item remains, while retaining generation admission checks, offline checks, single-flight tracking, durable claim/terminal commits, and existing failure exits.
- Verify: The focused 51-turn test passes; existing offline replay single-flight, claim, retry, terminal-save, and replacement tests remain green.

### Outcome 3: Validate final scope
- Work: Inspect the diff and ensure only the planned production/test/plan files changed; preserve snapshot paths and release/provenance/bundle artifacts remain untouched.
- Verify: Focused Vitest offline queue set, `pnpm exec tsc --noEmit`, targeted ESLint, and `git diff --check`.
