# Single Web frontend migration

**Goal:** Make `src/app/bootstrap.tsx` the only Web UI implementation, move every still-valid behavior and release contract to production-reachable code, and remove the unreachable obsolete Web implementation.
**Why planning is required:** The migration deletes roughly 22,000 lines across tracked files in a heavily modified worktree and changes which source files qualify as release evidence.
**Acceptance:** `index.html` contains exactly one local module entry and no other executable classic or inline script; a TypeScript-resolved dependency graph recursively covers static module Workers and proves that no obsolete Web path is reachable; HTML, source, JSX, CSS, and accessibility text contain no frontend-version branding while real protocol versions remain valid; repository health, completion, accessibility, browser, visual, and bundle checks inspect only production-reachable UI code; those runtime tools contain no parallel DOM branches or compatibility flavors; all retained behaviors have focused or runtime proof on the supported UI before deletion; the exact obsolete Web implementation is copied to a verified archive outside the workspace before removal; deletion stops if a behavior lacks current evidence or if unrelated user changes cannot be preserved; final build output contains one UI implementation and all local gates pass apart from explicitly audited external release blockers.

### Outcome 1: Authoritative production execution gate
- Work: Structurally enumerate all executable `index.html` scripts and require exactly one local module entry; recursively resolve static TypeScript imports and explicit module Worker/SharedWorker entries; fail closed on unknown dynamic imports, glob imports, classic Workers, or dynamic Worker URLs; separately gate the generated Service Worker; reject production reachability of the deleted Web roots and component tree; reject frontend-version narratives in visible/accessibility HTML, reachable source/JSX/CSS text, and comments without rejecting API/schema/crypto protocol versions; expose the gate through package and release checks.
- Verify: `pnpm run check:web-production-reachability && pnpm run build`

### Outcome 2: Current chat surface owns retained behavior
- Work: Move message virtualization geometry, viewport/row ResizeObserver containment, exact spacer correction, reader-position retention, New messages affordance and focus handoff, virtualized screen-reader announcements, message actions, composer/image/audio behavior, and chat accessibility contracts onto `src/app` plus production-reachable services. Remove browser-smoke branches that excuse missing current behavior.
- Risks/open questions: A retained behavior is kept only when required by the PRD or current user workflow; dead implementation details are not copied merely to satisfy string checks.
- Verify: `pnpm run check:message-virtualization && pnpm run qa:web-current && pnpm run check:ui`

### Outcome 3: Current onboarding, sidebar, settings, and overlays own retained behavior
- Work: Rebind component tests and source-level contracts for onboarding, Provider/model setup, sidebar/search/conversation actions, settings tabs, sync/data/skills, danger confirmations, focus restoration, notices, tooltips, responsive states, i18n, and reduced motion to `src/app` and production-reachable services. Fix current UX gaps before removing the corresponding historical evidence.
- Verify: `pnpm run check:unit && pnpm run check:repo && pnpm run check:completion-audit && pnpm run qa:web-current`

### Outcome 4: Release audits reject unreachable UI evidence
- Work: Replace every deleted component-tree and obsolete-root read in repository health, completion audit, UI accessibility, bundle, smoke, and documentation gates with production paths or behavior-level runtime assertions. Remove all runtime-tool branches and fallback selectors that distinguish parallel UI implementations or compatibility flavors. Add repository-wide semantic guards that reject frontend dual-track narratives while allowing real vault/schema/report/API URL versions, and fail when a release checker treats production-unreachable UI as positive evidence.
- Verify: `pnpm run check:web-production-reachability && pnpm run check:repo && pnpm run check:completion-audit && pnpm run check:ui`

### Outcome 5: Recoverable obsolete-surface deletion
- Work: Before deletion, copy the exact obsolete roots, the deleted component tree, and any obsolete-only tests/services selected for removal to the verified external migration archive, record and verify its manifest, then remove only files proven unreachable and no longer referenced by production tests or release checks. Preserve protocol/version names such as Gist v2 and SecretStore v2; do not introduce a version label for the UI.
- Risks/open questions: Stop before deletion if the archive target already exists with unrelated content, a candidate file is production-reachable, or a dirty file cannot be attributed to the obsolete surface.
- Verify: `pnpm run check:web-production-reachability && pnpm exec tsc -b && pnpm run check:unit && git diff --check`

### Outcome 6: Single-implementation release evidence
- Work: Rebuild Web, Windows WebView/MSIX payload, and available Android evidence from the single frontend; refresh release diagnostics/current-evidence handoff; visually inspect desktop/mobile contact sheets and require local cleanup. Record Apple/Linux/trusted-MSIX/hosted-CI/live-provider blockers without promoting diagnostics to passes.
- Verify: `pnpm run verify:release && pnpm run sync:current-evidence && pnpm run check:current-evidence && pnpm run check:local-cleanup`
