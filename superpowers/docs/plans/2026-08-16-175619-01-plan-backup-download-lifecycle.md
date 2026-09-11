# Encrypted Backup Download Lifecycle Audit

**Goal:** Prove that the production backup export caller does not leave a temporary anchor or plaintext Blob URL reachable across success and failure paths.
**Why planning is required:** The path handles encrypted backup bytes and local Blob URL/DOM resources; cleanup failures must not leak data or corrupt the user-visible result.
**Acceptance:** A focused red test demonstrates any real cleanup gap before production changes; after the smallest fix, the focused download contract and the Store export caller remain green, with preserve/provenance/bundle state untouched.

### Outcome 1: Establish the real lifecycle boundary
- Work: Trace `exportBackup()` through `downloadJsonFile()` and enumerate create, append, click, anchor removal, timer, and revoke failure paths.
- Risks/open questions: Browser download success may require the URL to remain valid briefly after click; do not revoke early unless the behavior test proves it is safe.
- Verify: `pnpm exec vitest run src/services/__tests__/downloadJsonFile.test.ts`

### Outcome 2: Close only a reproducible cleanup defect
- Work: Add the narrowest behavior test for a missing cleanup guarantee, then patch only the owning helper if the current implementation fails.
- Risks/open questions: Keep raw backup contents out of diagnostics and do not change export success/error semantics when best-effort cleanup fails.
- Verify: `pnpm exec vitest run src/services/__tests__/downloadJsonFile.test.ts src/app/__tests__/store.test.ts -t "export|download"`

### Outcome 3: Verify the touched boundary
- Work: Re-run the focused helper/caller tests, TypeScript, ESLint, and diff checks; inspect the final diff and preserve/release boundaries.
- Risks/open questions: Full WebView, bundle, provenance, and release evidence remain out of scope and must not be presented as refreshed.
- Verify: `pnpm exec tsc --noEmit`; `pnpm exec eslint src/services/downloadJsonFile.ts src/services/__tests__/downloadJsonFile.test.ts src/app/store.ts`; `git diff --check`
