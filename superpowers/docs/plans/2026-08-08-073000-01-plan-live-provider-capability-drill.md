# Live Provider Capability Drill

**Goal:** Use the user-authorized disposable Provider inputs to verify the current ZeroChat client against the configured chat, image, audio, low-cost capability, and realtime routes without exposing credentials or promoting diagnostic output as release evidence.

**Why planning is required:** This drill sends external requests and may consume Provider quota or incur cost; it must stop on unsafe input, missing explicit capability confirmation, or evidence-sanitization failure.

**Acceptance:** The process-local run uses no repository-stored credentials, writes only the existing sanitized live-provider report paths, records each requested capability and failure kind without secrets/URLs/payloads, and is promoted to release evidence only if every required capability passes its existing artifact gate. Any external route/model failure remains an explicit blocker.

### Outcome 1: Validate the process-local execution contract
- Work: Validate the configured API root, key presence, model identifiers, explicit chat/image/audio/low-cost/realtime confirmations, bounded timeouts, and report paths without sending a request.
- Risks/open questions: The upstream relay may expose only a subset of OpenAI-compatible routes or models; no workaround may fabricate missing capability support.
- Verify: `node scripts/live-provider-smoke.mjs --validate-inputs-only`

### Outcome 2: Run the authorized capability drill
- Work: Run the existing live-provider smoke with the explicit confirmation values, preserving process-local credentials and using its sanitized report writer. Stop if the script refuses an input or reports a redaction/safety failure.
- Risks/open questions: Image, audio, and realtime requests may consume quota; the drill remains bounded by the script timeouts and is not retried outside its existing policy.
- Verify: `pnpm run drill:live-provider`, then inspect only sanitized status/capability summaries and run the ordinary/full-capability artifact checks.

### Outcome 3: Close or record the evidence state
- Work: If all required capabilities pass, refresh the current release blocker summary and evidence handoff. Otherwise keep the report diagnostic-only and record the exact sanitized blocker classification.
- Risks/open questions: Browser-origin UI proof still requires a browser-allowed proxy path and is independent of direct Provider API evidence.
- Verify: `pnpm run check:live-provider-report`, `pnpm run check:live-provider-full-capability`, and `pnpm run report:release-diagnostics` when the report state changes.
