# Current-source browser provider proof

**Goal:** Refresh the browser-origin live-provider release proof after the guarded UI source fingerprint changes.
**Why planning is required:** The drill deploys an external temporary Cloudflare Worker and handles a disposable provider credential in process memory.
**Acceptance:** Only an anonymous temporary Worker is used. Provider inputs remain process-local and absent from browser settings, reports, files, and command arguments. Any deployment, dual-shape readiness, provider, browser, or validation failure stops the drill. The script always logs out the temporary Wrangler account, local cleanup passes, and current-source report, screenshot, browser-network provenance, and sensitive-material scans validate before the evidence is cited.

### Outcome 1: Pre-execution safety boundary
- Work: Confirm the drill accepts only the two required process-local provider inputs, generates all Worker access material randomly, streams hidden bindings through the in-memory named-pipe path, and has unconditional Wrangler logout cleanup.
- Risks/open questions: The provider or temporary Worker may reject requests. That is recorded as diagnostic evidence and must not be promoted to a release pass.
- Verify: `pnpm run check:security`

### Outcome 2: Current-source browser-origin proof
- Work: Run the temporary Worker drill, require two consecutive browser-shaped and no-Origin models-shaped readiness signatures, retry only an exact untrusted HTML 404 from the temporary Worker ingress while preserving the final response for diagnostics, then prove browser-origin model discovery and one assistant-marker chat without browser-side provider authorization.
- Risks/open questions: The ingress retry must stay bounded and idempotent, and must never retry a response carrying trusted ZeroChat `upstream` or `transport-error` provenance. Stop on any readiness signature mismatch, trusted upstream failure, source-fingerprint mismatch, or screenshot validation failure.
- Verify: `D:\Node.js\pnpm.CMD exec vitest run scripts/__tests__/live-provider-ui-browser-network.test.mjs && pnpm run check:live-provider-ui-report && pnpm run check:live-provider-ui-screenshot`

### Outcome 3: Evidence-chain and cleanup verification
- Work: Refresh release diagnostics and current-evidence handoff, confirm the browser-origin blocker stays closed only for current-source passing evidence, and verify no temporary listeners, browser profiles, Worker credentials, or sensitive provider material remain.
- Verify: `pnpm run check:release-blockers && pnpm run check:current-evidence && pnpm run check:local-cleanup`
