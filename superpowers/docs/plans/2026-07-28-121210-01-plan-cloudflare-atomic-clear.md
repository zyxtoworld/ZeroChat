# Cloudflare atomic clear hardening

**Goal:** Prevent cloud-data cleanup from deleting a head published concurrently by another client.
**Why planning is required:** This changes a destructive remote-data path whose current compatibility fallback can delete successful concurrent writes.
**Acceptance:** The client performs destructive Cloudflare cleanup only through the atomic `/sync/clear` Worker endpoint; unsupported endpoints fail before any head, object, or snapshot mutation; the supported endpoint still rotates the sync generation and clears all managed data. Verification uses local test doubles only and must not contact a live endpoint or consume credentials.

### Outcome 1: Fail closed on an outdated Worker
- Work: Remove the non-atomic compatibility fallback from `src/services/syncCloudflareClear.ts`. A `404`, `405`, or `501` response from `/sync/clear` must surface the existing Worker-upgrade error and must not issue follow-up reads or deletes.
- Risks/open questions: None. Backward compatibility is intentionally rejected because it cannot preserve concurrent writes.
- Verify: `pnpm exec vitest run src/services/__tests__/syncCloudflare.test.ts`

### Outcome 2: Guard the destructive contract
- Work: Add a regression test that makes `/sync/clear` unsupported and proves the request trace contains only the bulk-clear attempt while the existing supported clear, generation-rotation, and malformed-response tests remain green.
- Verify: `pnpm run check:shared-schema && pnpm run check:security`
