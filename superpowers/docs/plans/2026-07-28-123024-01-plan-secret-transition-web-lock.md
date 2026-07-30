# Secret/AppData transition ownership lock

**Goal:** Prevent another browser tab from recovering or rolling back a secret/AppData transition while its owning tab is still committing it.
**Why planning is required:** The transition spans encrypted secret storage and durable AppData. A false recovery can publish AppData that no longer matches the active secret snapshot.
**Acceptance:** Every browser commit holds one exclusive named Web Lock from secret staging through AppData persistence and journal completion. Provider and full-secret recovery acquire the same lock and therefore wait for an active owner. Crash recovery still proceeds after the browser releases the dead owner's lock. The existing in-realm mutation queue remains the fallback for runtimes without Web Locks, and that limitation is documented instead of being presented as cross-tab isolation. Verification uses in-memory IndexedDB and Web Lock doubles only; no live secrets are allowed.

### Outcome 1: Reproduce the active-owner race
- Work: Add an exclusive Web Lock test double and a provider transition regression that starts recovery while AppData persistence is pending.
- Verify: The regression fails against the current implementation because recovery settles early and restores the previous key.

### Outcome 2: Serialize commit and recovery across tabs
- Work: Add one named transition lock in `src/storage/secrets.ts`; make every queued secret mutation share it, hold it around stage, persist, conflict resolution, rollback/complete, and acquire it around both recovery entry points. Avoid nested in-realm queue acquisition.
- Risks/open questions: Web Locks coordinate Chromium browser profiles, including the Windows WebView browser surface when the API is exposed. A runtime without Web Locks retains only same-realm serialization; it cannot honestly guarantee cross-tab ownership without a separate durable lease protocol.
- Verify: `pnpm exec vitest run src/storage/__tests__/secrets.test.ts`

### Outcome 3: Preserve crash recovery and static contracts
- Work: Keep existing interrupted-transition tests as lock-release/crash simulations, then document and guard the new ownership contract.
- Verify: `node node_modules/typescript/bin/tsc -b`; `pnpm exec eslint src/storage/secrets.ts src/storage/__tests__/secrets.test.ts`; repository and completion audit checks after documentation updates.
