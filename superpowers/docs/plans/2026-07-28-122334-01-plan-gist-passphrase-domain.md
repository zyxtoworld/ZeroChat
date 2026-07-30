# Gist passphrase domain isolation

**Goal:** Prevent passphrase rotation from creating a Gist that mixes files encrypted under different keys.
**Why planning is required:** Rotation mutates external encrypted storage and changes the durable `gistId` used by every later synchronization.
**Acceptance:** On an authorized passphrase rotation, the client reads the old Gist only to confirm decryption failure, creates a new private Gist containing one parentless operation encrypted with the new passphrase, returns the new `gistId`, and never PATCHes or deletes managed files in the old Gist. Existing runtime ownership checks must gate local publication of the new ID. Verification uses the in-memory GitHub boundary only; no live token or Gist is allowed.

### Outcome 1: Isolate the new encryption epoch
- Work: Replace in-place rotation in `src/services/syncGist.ts` with creation of a new Gist from current local data and secrets. Remove the old rotation-only PATCH/delete branch while retaining legacy migration behavior.
- Risks/open questions: The old encrypted Gist intentionally remains untouched because it may contain unrelated user files and old clients may still own it. Cleanup is a separate explicit user operation, not part of key rotation.
- Verify: `pnpm exec vitest run src/services/__tests__/syncGist.test.ts`

### Outcome 2: Lock the external request trace
- Work: Update the rotation regression to require a different `gistId`, one new-passphrase parentless operation, unchanged old managed files, and no `PATCH /gists/<old-id>` request.
- Verify: `pnpm exec eslint src/services/syncGist.ts src/services/__tests__/syncGist.test.ts && node node_modules/typescript/bin/tsc -b`
