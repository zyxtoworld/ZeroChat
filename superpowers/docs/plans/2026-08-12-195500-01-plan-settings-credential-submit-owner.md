# Settings credential submit ownership

**Goal:** Admit at most one asynchronous credential commit per production Settings field while preserving edits made during persistence.
**Why planning is required:** Provider keys, the GitHub token, and the sync passphrase are security-sensitive durable writes whose duplicate UI admission can trigger repeated secret transactions and downstream sync work.
**Acceptance:** Each field claims a synchronous owner before its first await; same-tick Enter/click/clear reentry performs one durable save; pending controls expose a disabled command state without disabling draft editing; success, cancellation, and failure release only their own owner; the existing Settings Data owner uses the same primitive.

### Outcome 1: Reproduce duplicate credential admission
- Work: Compose the production draft commit boundary with a deferred save and assert a second same-field invocation is rejected before persistence; bind Provider key, GitHub token, and passphrase callers to the same owner API.
- Verify: `D:\Node.js\pnpm.CMD exec vitest run src/app/__tests__/settings-data-action.test.ts src/app/__tests__/settings-view.test.ts -t "credential|same-tick|commit owner" --pool=threads --maxWorkers=1`

### Outcome 2: Share one synchronous Settings action owner
- Work: Generalize the existing Settings Data owner name and use one component-local instance per credential field; keep draft inputs editable while disabling save/clear commands until settlement.
- Verify: `D:\Node.js\pnpm.CMD exec vitest run src/app/__tests__/settings-data-action.test.ts src/app/__tests__/settings-view.test.ts --pool=threads --maxWorkers=1`

### Outcome 3: Revalidate production and current contracts
- Work: Update current app-shell/sync contract markers without modifying protected aggregate checker provenance, then run Store/component suites, TypeScript, lint, production build, bundle, and repository health.
- Verify: `D:\Node.js\pnpm.CMD exec tsc --noEmit`; `D:\Node.js\pnpm.CMD run build`; `D:\Node.js\pnpm.CMD run check:bundle`; `D:\Node.js\pnpm.CMD run check:repo`
