# Offline queue stable identity and durability

**Goal:** Make every offline replay target the exact persisted prompt without losing newer draft edits or creating orphaned queued turns.
**Why planning is required:** The fix changes the shared cross-platform snapshot contract and controls whether a persisted user message is later sent to an external Provider.
**Acceptance:** Every newly queued Web turn persists a stable prompt message ID; replay never guesses an older prompt; existing queued data without an ID remains readable but is never auto-sent; Web and all native validators accept only a non-empty optional ID; durable-save completion cannot clear a newer draft; deleting either member of a queued pair removes the pair. No test may contact a live Provider or remote sync service.

### Outcome 1: Preserve draft ownership through offline persistence
- Work: Carry the submission draft revision into `queueOfflineTextMessage` and clear only while that revision still owns the composer. A failed durable commit rolls back only the newly created message IDs and keeps the draft.
- Verify: `pnpm exec vitest run src/services/__tests__/chatGenerationOfflineQueue.test.ts src/services/__tests__/chatGenerationTextSubmit.test.ts`

### Outcome 2: Keep queued turns structurally complete
- Work: Persist `promptMessageId` on every new queued assistant, resolve only that user message, and make message deletion remove a queued prompt/assistant pair atomically. Orphans and legacy entries without an ID must be skipped without blocking later valid work.
- Verify: `pnpm exec vitest run src/services/__tests__/offlineQueue.test.ts src/services/__tests__/chatGenerationMessageActions.test.ts`

### Outcome 3: Align the shared snapshot contract
- Work: Add optional non-empty `promptMessageId` support to the shared JSON schema, Web remote-vault parser, and Android, Apple, Linux, and Windows models/strict validators/serializers. Keep `providerId` and `model` required. Add positive and malformed-field fixtures.
- Risks/open questions: Target Apple and Linux toolchains are unavailable on this Windows host; their source and static/native-parity gates are required, while target-runtime evidence remains open.
- Verify: `pnpm run check:shared-schema && pnpm run check:native-parity && pnpm run check:windows-native-contracts`
