# Provider capability-results visual proof

**Goal:** Add real-browser visual and accessibility evidence for Provider capability failures that distinguish model availability from missing routes.
**Root cause:** Component tests retain per-capability results, but the 118-frame browser visual audit captures only the static Provider form. The first real 320x640 capture then exposed the production-layout defect behind that evidence gap: the full-capability aggregate is duplicated far above and below the capability list while failed checks remain mixed behind unrelated checks, so a compact user cannot see the aggregate and actionable failures together.
**Acceptance:** A local visual-smoke-only event injects sanitized synthetic embeddings `model-missing` and moderation `route-missing` results into the selected Provider without network traffic or secrets. Capability-related aggregate status is concise, owned by the capability panel, rendered once, and followed by failed checks before unaffected checks. Desktop and 320x640 screenshots show the aggregate and both statuses with no clipping, overlap, or horizontal overflow. Browser assertions prove two failed result chips, endpoint/model copy, visible result ownership, and `aria-describedby` linkage. The event can clear its state, non-local fixture behavior is unchanged, screenshot count becomes 120, and full Web/release evidence remains valid except the existing trusted-MSIX host blocker.

### Outcome 1: Test-first state fixture
- Work: Add a focused controller test for deterministic Provider selection, failed capability results, aggregate notice, Provider tab opening, and clear behavior.
- Stop conditions: The fixture needs credentials, writes AppData, mutates Provider configuration, or can activate outside the guarded visual-smoke controller.

### Outcome 2: Browser scenario and layout assertions
- Work: Register one local event, expose it through the existing lazy visual controller, append the scenario after the existing 118 captures so historical screenshot numbering remains stable, move capability aggregate ownership into the capability panel, prioritize failed checks, scroll to the aggregate, assert actual DOM/ARIA state, and capture desktop plus 320px compact screenshots before clearing.
- Visual stop conditions: Any result text/button overlap, hidden status, horizontal overflow, detached tooltip description, or inability to restore the static state.

### Outcome 3: Evidence and count contracts
- Work: Raise active visual count contracts from 118 to 120, run focused tests, TypeScript/ESLint/build, full visual audit and artifact validation, manually inspect the new images, then refresh Web/current evidence and documentation guards.
- Verify: focused Vitest; `check:types`; focused ESLint; `build`; `qa:web-current`; `check:completion-audit`; `check:repo`; `check:docs`; `check:local-cleanup`.
