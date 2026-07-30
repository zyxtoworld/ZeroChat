# Native image request cost boundary

**Goal:** Make every Android, Apple, and Linux image action preserve the same single-attempt cost and side-effect boundary already enforced by Web and Windows.
**Why planning is required:** Image generation, edit, and inpaint POSTs may charge money or mutate provider state. Automatic retries and broad model fallback can duplicate a request after the provider accepted it but the client lost the response.
**Acceptance:** Chat generation keeps its existing bounded transient retry policy. Image generation, edit, and inpaint never auto-retry at the UI/request-runner layer. Direct image endpoints may switch to the Responses route only after an explicit route/service HTTP status. Responses image candidates advance only after HTTP 400 or 422 model-scoped rejection; transport, timeout, cancellation, authentication, quota, rate-limit, server, response-read, parse, and image-materialization failures stop immediately. Tests use local mocks or static source contracts only and make no live provider requests.

### Outcome 1: Lock the non-idempotent request contract in tests
- Work: Replace Android and Linux tests that require transient image retries with single-attempt assertions, and add Android, Apple, and Linux source or unit coverage for status-bounded Responses candidate fallback.
- Verify: `pnpm run check:android-unit`; `pnpm run check:native-parity`; platform-focused local tests where the current host supports them.

### Outcome 2: Remove user-level native image auto-retry
- Work: Remove the Android retry wrapper, Apple image retry loop, and Linux image Retry event path while preserving cancellation and the existing chat retry behavior.
- Verify: Android JVM tests, Linux pure/unit tests or static contracts, Apple Swift tests on a target host, and repository source guards.

### Outcome 3: Bound internal route and model fallback by typed status
- Work: Reuse Android's typed provider HTTP exception and introduce the smallest equivalent status-preserving boundary required by Apple and Linux. Keep direct route fallback status-based and allow Responses model fallback only for 400/422.
- Risks/open questions: Apple target compilation is unavailable on this Windows host, and Linux GTK target compilation remains host-blocked. Static contracts and host-independent tests do not replace target-host build/runtime evidence.
- Verify: `pnpm run check:android-unit`; `pnpm run check:linux-fmt`; `pnpm run check:native-parity`; `pnpm run check:repo`; `pnpm run check:completion-audit`.

### Outcome 4: Record and guard the cross-platform product boundary
- Work: Update requirements and QA audit entries, replace stale native-parity assertions that require image auto-retry, and add repository/completion markers that fail if the single-attempt policy regresses.
- Verify: `pnpm run check:docs`; `pnpm run check:repo`; `pnpm run check:completion-audit`; final diff review against this acceptance contract.
