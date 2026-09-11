# Current-source live Provider capability evidence

**Goal:** Run the user-authorized disposable Provider capability drill against the supplied relay and determine whether the current source can produce valid release evidence.
**Why planning is required:** The drill performs external API requests and may incur bounded Provider cost; it must not persist credentials or publish sensitive diagnostics.
**Acceptance:** The drill completes or records a sanitized, current-source diagnostic; no credential, full URL, request body, token, or passphrase is written to repository files or user-facing output; the report is validated by the repository's focused checks.

### Outcome 1: Preflight
- Work: Use the supplied relay only through process-local environment variables and the repository's explicit confirmation gates. Inspect the current source fingerprint and existing report policy before sending requests.
- Risks/open questions: The relay may not expose every OpenAI-compatible capability route; stop at the script's bounded failure policy and do not invent capability evidence.
- Verify: `pnpm run check:live-provider-smoke`

### Outcome 2: Capability drill
- Work: Exercise the repository's live-provider drill for model discovery, chat, image, audio, embeddings, moderation, and realtime using the strongest available safe model candidates selected by the script.
- Risks/open questions: External calls may be rejected or route-missing. Keep all inputs process-local and rely on the script's sanitized report writer.
- Verify: `pnpm run drill:live-provider`

### Outcome 3: Evidence validation
- Work: Validate the current report, refresh the blocker summary if needed, and compare the report source fingerprint with the current worktree.
- Risks/open questions: A passed historical attempt does not count when its source fingerprint is stale.
- Verify: `pnpm run check:live-provider-report` and `pnpm run check:live-provider-full-capability`
