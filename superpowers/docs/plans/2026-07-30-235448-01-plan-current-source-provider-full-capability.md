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

## 2026-08-02 current-source rerun amendment

- Chat model: use `gpt-5-5`, the newest catalog candidate currently proven to return the exact marker. Do not retry `gpt-5-6-pro` in this bounded run because the immediately preceding browser and direct diagnostics both recorded four successful-but-empty HTTP 200 streams for that model.
- All other cost bounds, model overrides, stop conditions, promotion rules, cleanup requirements, and sensitive-output constraints remain unchanged.

## Result

- Pre-execution gates passed. The latest current-source live drill completed in 63,692 ms and always ran local cleanup.
- Models and `gpt-5-6-pro` chat returned HTTP 200. `gpt-image-2` generation, edit, and inpaint returned HTTP 200.
- Audio speech, audio transcription, moderation, and realtime returned HTTP 404 `route-missing`; embeddings returned HTTP 404 `model-missing`. The strict full-capability validator rejected the report as required.
- The canonical full-current report and preserved attempt are identical at 20,713 bytes / SHA-256 `9091AC40059EBBA1D17DBD078A71BE1C825902DA8EE866AE96B9A341C0750AA3`, bound to 103 files / 1,662,080 bytes / source SHA-256 `F4B61A47B97B2C48629B69ECBE9B3E19705162A5319331E1915EDCA8CF7D0C20`.
- The independent current-source browser-origin attempt passed through an anonymous temporary Worker. That child evidence does not promote the five failed API capabilities.
- Release blockers select the current credential-confirmed full-capability attempt with `failed-live-provider-capabilities`; no failed diagnostic was promoted to release evidence.
- Full `verify:release` exercised all 52 checks and failed only the expected `windows-trusted-msix-release-pass-missing` runtime step. Current evidence, completion audit, repository health, documentation, security, cleanup, and sensitive scans remain separate required gates.
