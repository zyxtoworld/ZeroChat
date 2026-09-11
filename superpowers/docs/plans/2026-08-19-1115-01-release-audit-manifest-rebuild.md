# Release Audit Manifest Rebuild

**Goal:** Rebuild the single current release-audit migration manifest from the verified preserve snapshots and make the three local audit gates agree with the final checker sources.
**Why planning is required:** This changes migration provenance inputs and a release gate; false provenance or a stale catalog can make a high-impact audit pass incorrectly.
**Acceptance:** The official generator accepts the explicit preserve declaration, consumes every current AST delta exactly once, and the migration, repository-health, and completion-audit gates report the same current hashes and real preserve diff statistics. No preserve snapshot, external evidence, or second checkpoint format is changed.

### Outcome 1: Reconcile the independent catalog
- Work: Remove only catalog occurrences that are absent from the verified current AST delta; preserve all historical entries that are still consumed and keep category/reason as independent audit input.
- Risks/open questions: An unconsumed entry must fail closed rather than be reclassified or guessed.
- Verify: `node --check scripts/release-audit-migration-catalog.mjs`

### Outcome 2: Generate the current manifest
- Work: Run the repository generator with the explicit external preserve-source declaration, validating preserve SHA256, AST identity, and real `git diff --no-index` numstat before writing the sole manifest.
- Risks/open questions: The protected Temp snapshots are read-only inputs; no HEAD or current-file reconstruction may substitute for them.
- Verify: `pnpm run generate:release-audit-migration`

### Outcome 3: Run the local audit gates
- Work: Verify the generated manifest and current checker sources through the formal migration provenance, repository-health, and completion-audit entry points.
- Risks/open questions: External release, signing, hosted CI, and live-provider evidence remain separate blockers and must not be fabricated by this local rebuild.
- Verify: `pnpm run check:release-audit-migration`; `pnpm run check:repo`; `pnpm run check:completion-audit`

### Outcome 4: Inspect final state and owned cleanup
- Work: Review the relevant diff, syntax/check whitespace, and confirm no task-owned temporary worker process or marker remains.
- Risks/open questions: Do not delete unrelated user Temp data or terminate unrelated processes.
- Verify: `git diff --check` and an exact owned-process/marker scan.
