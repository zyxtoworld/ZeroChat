# Cross-platform chat response content blocks

**Goal:** Preserve assistant text when an OpenAI-compatible chat response represents message.content as text blocks instead of a single string.
**Root cause:** The Web, Android, Apple, and Windows response readers only accept a scalar string in choices[].message.content; a valid multimodal-compatible response with text blocks is therefore treated as empty, while Linux handles the shape only in a separate top-level content path.
**Why planning is required:** This is a cross-platform public protocol boundary. A parser mismatch changes user-visible chat behavior and can silently discard provider output, so source-only edits without parity and regression evidence are insufficient.
**Acceptance:** Web, Android, Apple, Linux, and Windows extract text blocks from choices[].message.content and retain existing scalar, Responses, Anthropic, empty-response, streaming, and error semantics. The parser ignores non-text blocks, preserves text order, never exposes provider credentials or raw response payloads in reports, and does not change request bodies or retry/cost behavior.

### Outcome 1: Regression evidence
- Work: Add focused Web and native source/contract tests for an otherwise successful OpenAI-compatible response whose first choice contains ordered text blocks. Keep a scalar response and an empty/non-text response covered.
- Red condition: The current Web and native readers return no assistant text for the block-array fixture.
- Verify: D:\Node.js\pnpm.CMD exec vitest run src/services/__tests__/chat.test.ts src/services/__tests__/providerResponses.test.ts and the platform contract/unit commands available on the current host.

### Outcome 2: Minimal parser parity fix
- Work: Add one small text-block extraction helper at each platform's existing response boundary; use it for non-streaming JSON fallbacks and native SSE readers that can receive a complete JSON response. Preserve existing output ordering and trim/empty handling.
- Boundary: Do not broaden arbitrary response parsing, alter request formats, add provider-specific model guesses, or change retry policy.
- Verify: Focused Web tests, Android JVM tests, Linux Rust tests/contracts, Apple source/unit contracts where available, Windows source contracts, TypeScript/Rust formatting and native parity.

### Outcome 3: Fresh evidence and continued audit
- Work: Refresh source fingerprints and release diagnostics after the source mutation, then run repository health, completion, documentation, local cleanup, and the strongest available release checks. Keep external blockers explicit: Apple/Linux target hosts, trusted MSIX, hosted native CI, and relay capabilities remain unclosed unless real evidence exists.
- Verify: D:\Node.js\pnpm.CMD run check:native-parity, D:\Node.js\pnpm.CMD run check:repo, D:\Node.js\pnpm.CMD run check:completion-audit, D:\Node.js\pnpm.CMD run check:docs, D:\Node.js\pnpm.CMD run check:local-cleanup, followed by the relevant release evidence refresh.
