# Provider preset readable width

**Goal:** Keep the current Provider preset select readable and fully native at the smallest supported Settings viewport.
**Why planning is required:** This changes production TSX and a browser-level release gate in a cross-platform UI surface.
**Acceptance:** At the compact Provider Settings viewport, the selected preset label has enough rendered width, the row has no horizontal overflow, focus-visible remains inside the scroll container, the select remains keyboard-focusable and dispatches change, and all existing Web QA evidence stays green.

### Outcome 1: Capture the current regression
- Work: Add a real DOM measurement to the existing Provider preset browser contract. It must fail on the current compressed select when the selected option label cannot fit with native padding and the disclosure affordance.
- Verify: `node scripts/visual-audit.mjs --summary`

### Outcome 2: Fix intrinsic sizing at the production boundary
- Work: Give the Provider preset select a non-shrinking readable basis that can wrap with the Add Provider action, without using clipping overflow or changing the native control.
- Verify: `node scripts/visual-audit.mjs --summary`, `pnpm run qa:web-current`

### Outcome 3: Recheck the affected release surface
- Work: Review the final TSX/CSS diff and confirm no experimental selector or temporary geometry diagnostic remains.
- Verify: `pnpm run check:unit`, `pnpm run check:ui`, `pnpm run check:bundle`, `git diff --check`
