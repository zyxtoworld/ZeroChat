# Skill context owner audit

**Goal:** Prove whether a Skill mutation can change the context used by an already admitted text generation, and if so make the smallest owner-safe correction.
**Why planning is required:** This crosses production generation, AppData mutation, encrypted Skill content reads, and Provider input; stale context can affect user-visible and remote side effects.
**Acceptance:** A focused behavior test either demonstrates the old path sends stale Skill context and the fixed path rejects/restarts it, or documents a reproducible no-red result without changing production. Existing replacement, attachment, Skill editor, and release/provenance boundaries remain unchanged.

### Outcome 1: Establish the caller contract
- Work: Trace `store.ts` generation admission through `requestMessagesWithSkills` and the Skill content loader; identify the exact owner identity and mutation boundary.
- Risks/open questions: Whether ordinary Skill edits are allowed during an admitted generation and whether cancellation/requeue is the product contract.
- Verify: focused source inspection and existing generation/Skill tests.

### Outcome 2: Capture one public-boundary regression
- Work: Add one deferred Skill-load test only if a mutation produces an observable stale Provider input or an unsafe late write; otherwise keep the audit read-only.
- Risks/open questions: Do not duplicate existing data-replacement or Skill editor owner tests.
- Verify: `pnpm exec vitest run src/app/__tests__/store.test.ts` with the narrow test filter.

### Outcome 3: Minimal correction and regression checks
- Work: If Outcome 2 is red, change the smallest owner/fence point and retain the existing replacement semantics.
- Risks/open questions: No release manifest/provenance changes and no external Provider or visible-window validation.
- Verify: focused tests, TypeScript, focused ESLint, production build, and production reachability.
