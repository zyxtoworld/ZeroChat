# Current-source browser-origin Provider UI evidence

**Goal:** Re-run the browser-origin Provider UI flow against a disposable current-source Cloudflare Worker so the UI evidence is either refreshed or remains an explicit diagnostic blocker.
**Why planning is required:** This creates temporary remote Worker state and injects a user-authorized Provider credential into a process-local Wrangler secret pipe.
**Acceptance:** Only the disposable Worker is touched; the browser never receives the Provider key; the drill's cleanup path runs on success and failure; reports and screenshots are sanitized and current-source-bound; no release evidence is claimed unless the focused report and screenshot checks pass.

### Outcome 1: Safety preflight
- Work: Run the existing live-provider UI safety contracts and verify the current Web build and local cleanup state.
- Risks/open questions: Missing Wrangler authentication, deployment failure, or readiness failure is a diagnostic blocker; do not bypass it.
- Verify: `pnpm run check:live-provider-smoke`, `pnpm run check:security`, `pnpm run check:local-cleanup`

### Outcome 2: Disposable browser-origin run
- Work: Set only the process-local Provider base URL and key, then run `pnpm run drill:live-provider-ui-temporary-worker`; use the script's random passphrase, named-pipe secrets, Worker-hosted key, bounded readiness probes, and cleanup.
- Risks/open questions: Stop on any cleanup failure or unexpected remote target. Never print or persist the Provider key, Worker URL, passphrase, or request body.
- Verify: `pnpm run drill:live-provider-ui-temporary-worker`

### Outcome 3: Evidence and source freshness
- Work: Validate the focused UI report and screenshot, refresh blocker diagnostics, and require the report source fingerprint to match the current worktree.
- Risks/open questions: A historical passed attempt remains diagnostic-only when its source fingerprint is stale.
- Verify: `pnpm run check:live-provider-ui-report`, `pnpm run check:live-provider-ui-screenshot`, `pnpm run check:local-cleanup`
