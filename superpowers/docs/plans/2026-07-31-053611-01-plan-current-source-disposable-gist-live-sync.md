# Current-source disposable Gist live-sync evidence

**Goal:** Replace the stale live-sync release pass with sanitized current-source evidence from a disposable GitHub Gist.
**Why planning is required:** The drill creates, mutates, clears, and deletes external GitHub state while handling a credential in process memory.
**Acceptance:** Preflight proves the CLI account has Gist scope, the safety suite and local cleanup gate pass, and no existing Gist ID is supplied. One child process receives a freshly generated throwaway passphrase and the CLI token, creates a disposable Gist, completes upload, second-device pull, edit upload/pull, delete upload/pull, and remote clear, then verifies the managed file is absent and deletes the created Gist. On any failure, the script must attempt the same cleanup and preserve a sanitized failure report. Stop if preflight, credential retrieval, report sanitization, or cleanup assertions fail. The canonical passed report must match the current source fingerprint, contain no token, passphrase, Gist ID, URL, or diagnostic-only fields, and the refreshed blocker summary must remove only the disposable live-sync blocker.

### Outcome 1: Prove the destructive boundary before network access
- Work: Run the live-sync safety suite, security check, CLI scope check, and local cleanup gate; inspect the drill's create/clear/delete and best-effort cleanup paths.
- Risks/open questions: GitHub availability can fail after remote creation. The drill must own the new Gist ID internally and clean it in both success and failure paths.
- Verify: `D:\Node.js\pnpm.CMD run check:live-sync-drill && D:\Node.js\pnpm.CMD run check:security && D:\Node.js\pnpm.CMD run check:local-cleanup`

### Outcome 2: Produce and validate current-source release evidence
- Work: Run Gist mode once with no existing Gist ID, a random throwaway passphrase, the destructive confirmation, and an authenticated CLI token supplied only to the child environment. Sanitize all emitted output and remove credential variables before the child exits.
- Risks/open questions: Never print or persist the token, passphrase, created Gist ID, or Gist URL. A failed cleanup is a hard blocker and must not be represented as release evidence.
- Verify: `D:\Node.js\pnpm.CMD run check:live-sync-release-pass`

### Outcome 3: Reconcile aggregate evidence and hygiene
- Work: Refresh release diagnostics and the current-source Web checkpoint, confirm the blocker count changes only by the live-sync item, inspect the final reports, and scan tracked/untracked source and evidence for transient secrets or remote identifiers.
- Verify: `D:\Node.js\pnpm.CMD run verify:web-local && D:\Node.js\pnpm.CMD run check:completion-audit && D:\Node.js\pnpm.CMD run check:repo && D:\Node.js\pnpm.CMD run check:docs && D:\Node.js\pnpm.CMD run check:local-cleanup`
