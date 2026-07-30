# Current-source provider full-capability evidence

**Goal:** Refresh the live-provider API capability evidence against the current ZeroChat source fingerprint.
**Root cause:** The latest credential-confirmed full-capability report predates the current provider implementation, so its five relay failures cannot support a current release decision.
**Why planning is required:** The drill sends bounded paid requests to an external provider while handling a user-authorized credential in process memory.
**Acceptance:** Provider inputs exist only in the drill child process environment and never in files, reports, command arguments, logs, or repository history. The run explicitly authorizes one minimal chat, image, audio roundtrip, embeddings, moderation, and realtime probe using validated model overrides. Any unsafe URL, model identifier, report shape, redaction, transport, or file-read condition stops execution. The ordinary report and immutable attempt validate even when capabilities fail; strict release evidence is promoted only when every requested capability passes. Environment cleanup, local-artifact cleanup, and sensitive-material scans pass before evidence is cited.

### Outcome 1: Pre-execution boundary
- Work: Reuse the previously observed catalog model for chat and image plus the script's standard capability fallbacks, run repository safety and local-cleanup prechecks, and confirm all live confirmations are explicit.
- Cost bound: At most one minimal chat, one image generation, one speech/transcription roundtrip, one embeddings request, one moderation request, and one realtime session request sequence.
- Stop conditions: Missing or ambiguous provider inputs, non-HTTPS base URL, unsafe model value, dirty drill environment, or failed safety precheck.
- Verify: `D:\Node.js\pnpm.CMD run check:live-provider-smoke && D:\Node.js\pnpm.CMD run check:security && D:\Node.js\pnpm.CMD run check:local-cleanup`

### Outcome 2: Current-source capability drill
- Work: Inject the provider key, base URL, confirmation tokens, and model overrides into one child process; run `drill:live-provider`; remove every injected variable in an unconditional cleanup block.
- Model boundary: Chat `gpt-5-6-pro`, image `gpt-image-2`, speech `gpt-4o-mini-tts`, transcription `gpt-4o-transcribe`, embeddings `text-embedding-3-large`, moderation `omni-moderation-latest`, and realtime `gpt-realtime-2`.
- Promotion rule: A failed capability remains diagnostic evidence. It must not be described as a release pass or used to close the full-capability blocker.
- Verify: `D:\Node.js\pnpm.CMD run check:live-provider-report` and `D:\Node.js\pnpm.CMD run check:live-provider-full-capability`

### Outcome 3: Evidence chain and cleanup
- Work: Inspect only explicitly safe report fields, record the current source fingerprint and capability failure taxonomy, refresh release blockers/current-evidence handoff, and preserve unrelated worktree changes.
- Verify: `D:\Node.js\pnpm.CMD run check:security && D:\Node.js\pnpm.CMD run check:completion-audit && D:\Node.js\pnpm.CMD run check:repo && D:\Node.js\pnpm.CMD run check:docs && D:\Node.js\pnpm.CMD run check:local-cleanup`
- Sensitive scan: Search the repository for the exact runtime credential and endpoint plus generic live-provider secret assignment patterns; require zero matches outside dependency/build caches.
