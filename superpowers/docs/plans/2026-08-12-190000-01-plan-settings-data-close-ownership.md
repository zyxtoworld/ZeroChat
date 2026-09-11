# Settings Data close ownership

**Goal:** Keep the production Settings dialog mounted while a Data action owns its shared asynchronous lifecycle, including global Escape and other Store-level close callers.
**Why planning is required:** The change crosses the Settings component, global Store navigation, focus restoration, and release audit contracts while an import, reset, or export may be mutating user data.
**Acceptance:** The action owner publishes one shared pending state before work starts; every Store close request is rejected while that state is owned; success and failure both release it; the dialog can close afterward; current app-shell checks bind the production sources and executable behavior tests.

### Outcome 1: Prove the owner-to-close lifecycle
- Work: Exercise the real Settings Data action owner with the Store setter and a deferred action, proving global close is blocked until the owner settles and becomes available after both success and failure.
- Risks/open questions: A never-settling action must remain fail-closed; no browser, external Provider, or release artifact is required.
- Verify: `D:\Node.js\pnpm.CMD exec vitest run src/app/__tests__/settings-data-action.test.ts src/app/__tests__/settings-view.test.ts src/app/__tests__/store.test.ts -t "Data action|shared pending|Settings open" --pool=threads --maxWorkers=1`

### Outcome 2: Bind the production implementation to the current shell contract
- Work: Require the Store close guard, Settings selectors, shared setter, owner invocation, and executable behavior test names in the current app-shell mutation contract.
- Verify: `D:\Node.js\pnpm.CMD exec vitest run scripts/__tests__/current-web-app-shell-contract.test.mjs --pool=threads --maxWorkers=1`

### Outcome 3: Revalidate changed production sources
- Work: Run the full affected Store/component suites, TypeScript, focused lint, production build, single-entry reachability, bundle, and repository health without running visible native windows or external services.
- Verify: `D:\Node.js\pnpm.CMD exec tsc --noEmit`; `D:\Node.js\pnpm.CMD run build`; `D:\Node.js\pnpm.CMD run check:bundle`; `D:\Node.js\pnpm.CMD run check:repo`
