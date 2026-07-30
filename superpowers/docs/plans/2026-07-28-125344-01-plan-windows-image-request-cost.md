# Windows image request cost boundary

**Goal:** Prevent one Windows native image action from multiplying non-idempotent Provider POSTs through message-parsed retries and unbounded Responses-model fallback.
**Why planning is required:** Image generation/edit requests may incur cost and mutate remote Provider state. Retry/fallback behavior is an external side effect contract, not a cosmetic refactor.
**Acceptance:** Each direct image endpoint or Responses model candidate is attempted once. HTTP status is preserved as a numeric value across the request helper boundary. Direct endpoint fallback retains its explicit route/service status policy; Responses candidates advance only for HTTP 400/422 model-scoped failures. Network, auth, quota, rate-limit, server, timeout, cancellation, and unknown failures stop without trying another model. No live Provider request is used for verification.

### Outcome 1: Lock the C++ request trace before implementation
- Work: Add a Windows Node contract test requiring the single-attempt helper, numeric failure status, bounded Responses fallback, and absence of the image retry helper/message parser.
- Verify: The new test fails against the current implementation because `SendAndReadWithGenerationRetryAsync`, `GenerationAutoRetryDelay`, and message-derived fallback remain present.

### Outcome 2: Make image HTTP failures typed and single-attempt
- Work: Replace the retry loop with one bounded send/read helper that writes the HTTP failure status to an out parameter before throwing the sanitized `hresult_error`. Preserve timeout, response-size, redirect, and credential boundaries.
- Verify: Windows AI Node contract tests and Release/x64 native build.

### Outcome 3: Bound route and model fallback separately
- Work: Use numeric status for direct `/images/*` to Responses route fallback. In Responses model loops, continue only for 400/422 and immediately rethrow every other failure.
- Verify: Repository/completion guards, docs, and Windows shell contract checks. This source/build evidence does not replace trusted MSIX runtime QA.
