# Static Bundle Closure and Image Admission

**Goal:** Enforce the real recursive ESM static-import closure and bring the final initial JavaScript gzip closure within the existing 96 KiB gate without weakening image-admission ownership or security behavior.
**Why planning is required:** This changes a release-size checker and the initial production dependency graph, with security-sensitive async admission already in scope.
**Acceptance:** Re-export syntax is counted recursively, dynamic imports remain excluded, the image admission owner remains behaviorally fenced, and the final build/check evidence is reported with preserve/provenance boundaries intact.

### Outcome 1: Static dependency accounting
- Work: Keep `es-module-lexer` parsing for imports and re-exports, with focused recursive fixtures and no dynamic-import inclusion.
- Verify: `node --test scripts/__tests__/bundle-static-imports.test.mjs`; inspect the current `dist` closure.

### Outcome 2: Initial bundle budget
- Work: Reduce only genuine static-closure payload, preserving provider capability, security, and runtime behavior; do not alter the 96 KiB threshold or hide static dependencies through preload filters.
- Verify: `pnpm run build`; `pnpm run check:bundle`; `pnpm exec tsc -p tsconfig.app.json --noEmit --pretty false`; targeted ESLint and `git diff --check`.

### Outcome 3: Image admission regression boundary
- Work: Preserve the existing deferred catalog-load owner checks for provider, credentials, data replacement, and conversation identity.
- Verify: focused image-admission tests and the affected Store/provider regression selectors.

### Outcome 4: Final claim audit
- Work: Review the final diff and distinguish local code/build evidence from unavailable release/provenance evidence; preserve the two external snapshot files and existing blockers.
- Verify: final status/diff inspection and the exact command exit codes.
