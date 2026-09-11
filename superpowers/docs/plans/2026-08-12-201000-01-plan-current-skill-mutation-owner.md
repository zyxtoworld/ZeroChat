# Current Skill mutation ownership

**Goal:** Give every production Skill mutation one synchronous Store-owned admission gate that survives Settings tab changes and blocks duplicate durable work.
**Why planning is required:** Skill create/import/edit/delete operations allocate encrypted content refs and publish AppData; duplicate or overlapping admission can duplicate rows, waste chunks, and let a stale UI action race another mutation.
**Acceptance:** Add/import/edit/delete claim one owner synchronously; duplicate or conflicting mutation calls settle without entering lazy parsing or persistence; pending survives component remount, blocks Settings close, and disables every mutating Skill control; success and failure release the owner; read-only list navigation remains available.

### Outcome 1: Reproduce duplicate Skill admission
- Work: Call the real Store add action twice in one tick and prove current code creates two rows; require one service/persistence call, `[true, false]` outcomes, shared pending state, and blocked Settings close while the first operation is held.
- Verify: `D:\Node.js\pnpm.CMD exec vitest run src/app/__tests__/store.test.ts -t "Skill mutation owner|duplicate Skill" --pool=threads --maxWorkers=1`

### Outcome 2: Move ownership into the Store
- Work: Add a synchronous owner around create/import/edit/delete, reject update/toggle entry while owned, release identity-safely after the lifecycle queue settles, and expose one pending bit to the production Settings view.
- Risks/open questions: Data replacement remains the outer lifecycle authority; no old controller or second queue may be restored.
- Verify: `D:\Node.js\pnpm.CMD exec vitest run src/app/__tests__/store.test.ts -t "Skill" --pool=threads --maxWorkers=1`

### Outcome 3: Make pending behavior visible and guarded
- Work: Disable Skill mutation controls, keep draft content stable/readable, expose busy status, prevent global Settings close while owned, and bind executable tests in current app-shell/sync contracts without changing protected checker provenance.
- Verify: `D:\Node.js\pnpm.CMD exec vitest run src/app/__tests__/settings-view.test.ts src/app/__tests__/components-render.test.tsx scripts/__tests__/current-web-sync-contract.test.mjs scripts/__tests__/current-web-app-shell-contract.test.mjs --pool=threads --maxWorkers=1`

### Outcome 4: Revalidate the production artifact
- Work: Run full Store, TypeScript, lint, build, production reachability, bundle, repository health, and one headless browser smoke only if the runtime behavior changed after the previous smoke.
- Verify: `D:\Node.js\pnpm.CMD run build`; `D:\Node.js\pnpm.CMD run check:repo`
