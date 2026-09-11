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

## 2026-08-03 navigation-race amendment

- Current-source rerun stopped after temporary Worker readiness because Chrome
  committed the remote navigation while the harness immediately evaluated the
  old execution context. No Provider request or browser network trace was sent,
  the failed report remained diagnostic-only, and cleanup passed.
- Before another external rerun, add a bounded shared CDP wait for the new main
  frame's load completion, cover the wait-before-evaluate boundary with a focused
  regression test, and keep the existing app-shell readiness check after it.
- Rerun only after the focused CDP, live-provider UI network, temporary Worker,
  security, and local-cleanup gates pass. Promote only a fresh current-source
  browser-origin report whose screenshot and sanitized network trace validate.

### Amendment result

- The regression passed with the adjacent CDP and Worker suites (3 files / 50
  tests), the complete live-provider safety matrix, focused ESLint, Worker security,
  and local cleanup.
- The anonymous temporary Worker rerun passed at `2026-08-03T04:59:20.723Z`.
  Current and attempt reports are identical at 9,542 bytes / SHA-256
  `1233D87C6AE9F444841A856D2E3710E2AB5A57911BFCFD5C478CA26A71F3A64E`,
  and all report, screenshot, source-fingerprint, network-redaction, cleanup, and
  sensitive-material gates passed.
- Release diagnostics now list six blockers without the browser-origin UI item.
  Provider full capability and the external native/sync/CI blockers remain open.

## 2026-08-03 anonymous redeploy origin amendment

- A current-source rerun reached the deployed app and the no-Origin Worker probe,
  but browser-shaped GET and host-management OPTIONS requests both returned the
  Worker's fixed `Origin not allowed` 403 for all bounded readiness attempts.
- The Worker currently applies its cross-origin allowlist to a request whose
  `Origin` exactly equals the request URL origin. That forces the anonymous drill
  to discover its generated `workers.dev` URL and redeploy only to configure its
  own origin, creating an unnecessary deployment-version propagation boundary.
- Treat exact same-origin requests as allowed independently of the cross-origin
  allowlist, retain strict rejection for every other unlisted origin, and deploy
  the temporary Worker once with automatic origin enrollment disabled. Verify
  this boundary in the Worker security check before refreshing external evidence.
