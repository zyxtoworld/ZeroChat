# ZeroChat Gist sync operation protocol v2

Gist sync v2 stores immutable, content-addressed operations instead of rewriting one mutable
snapshot file. The TypeScript reference implementation is `src/services/syncGistProtocol.ts`.
Every native implementation must pass `shared/examples/gist-operation-v2-vectors.json` byte for
byte before it can claim cross-platform compatibility.

## File naming

For a configured base file named `zerochat-sync.json`, an operation is stored as:

```text
zerochat-sync.json.zerochat-op-<lowercase-sha256-operation-id>.json
```

Only the exact base file and files matching that prefix plus 64 lowercase hexadecimal characters
and `.json` are managed by ZeroChat. Unrelated Gist files must never be changed.

## Operation identity

An operation ID is the lowercase SHA-256 hex digest of the UTF-8 bytes of its canonical core JSON.
The `id` field itself is not part of the core.

Canonical JSON follows RFC 8785 JSON Canonicalization Scheme semantics. In particular:

1. Recursively sort every object key by UTF-16 code unit order, matching ECMAScript/JCS.
2. Preserve array order.
3. Omit object properties whose value is absent/undefined.
4. Emit compact JSON with no insignificant whitespace.
5. Normalize `parents` by deduplicating and sorting them.
6. Normalize tombstones by deduplicating and sorting the key
   `kind + NUL + parentId-or-empty + NUL + id + NUL + fingerprint`.

Parent IDs, operation IDs, and tombstone fingerprints are exactly 64 lowercase hexadecimal
characters. Parent and tombstone sorting uses the same UTF-16 code unit order and must never use a
locale-sensitive collation API.

State core fields are `kind`, `version`, `operation`, `parents`, `tombstones`, and `vault`. Clear
core fields omit `vault` and always contain an empty `tombstones` array. `kind` is
`zerochat.gistOperation`; `version` is `2`; `operation` is `state` or `clear`.

Readers must reject unknown or missing operation-core fields. Tombstones accept exactly
`kind`, `id`, and `fingerprint`, plus `parentId` only for `message`. Unknown fields are rejected;
they cannot be ignored because they are not covered by the operation ID.

## Vault normalization

Every operation ID, equality check, cursor baseline, and tombstone fingerprint uses the same
normalized vault representation. Normalization is recursive and must apply these rules before
canonical JSON is calculated:

1. Remove `sync.gistId`, `sync.gistFile`, `sync.lastSyncAt`, and `sync.lastSyncStatus`; force
   `sync.encryptionEnabled` to `true`.
2. Remove provider `clientRequestMode` and `custom` when `false`; remove empty provider `models`
   and `capabilities` arrays.
3. Remove message `status` when it is `done`; remove an empty message `attachments` array.
4. Remove skill-chunk `content` when it is the empty string.
5. Remove `preferences.chatContextMessageLimit` when it is the default `24`; remove empty
   `dismissedDangerWarnings` and `dismissedFeatureHints` arrays.
6. Materialize missing top-level `skills` as `[]` and missing `skillSettings` as
   `{ "autoMatch": true, "contextBudget": 2400, "maxAutoSkills": 3 }`.
7. Preserve all other values and array order. A platform serializer's default-field policy must
   not change the normalized result.

## Encryption

The complete operation, including `id`, is encrypted with the existing ZeroChat encrypted-object
format. The encrypted object type is `gist-operation-v2`. The operation filename exposes only the
content hash; plaintext snapshot data and credentials never appear in Gist metadata or logs.

On read, implementations must decrypt, validate the complete shape, canonicalize the core again,
recompute its ID, and reject the file unless both the embedded ID and filename ID match.

## Merge and deletion

Each state operation contains a complete normalized sync vault, parent operation IDs, and active
tombstones. Tombstone kinds are `provider`, `provider-secret`, `conversation`, `message`, and
`skill`. Message tombstones must carry a non-empty `parentId`; every other tombstone kind must omit
`parentId`.

Readers materialize all valid operation files, find graph heads, and merge concurrent state heads
deterministically using their common materialized ancestors. If no common ancestor is available,
the merge uses an empty base. Active tombstones are applied after merging so a deletion cannot be
silently resurrected by a concurrent stale state.

Merged messages and attachments are ordered by ascending `createdAt`, then by `id` using UTF-16
code-unit order. Any other merge tie-break involving an identifier uses the same UTF-16 order and
must not use locale-sensitive comparison, Swift grapheme ordering, or Rust Unicode-scalar order.

The explicit first-sync `merge` strategy is also cross-platform behavior. It unions records by
ID; keeps the newer record when IDs collide; field-merges same-ID providers; unions provider
`models` and `capabilities`; keeps the earliest `createdAt` and latest `updatedAt`; merges provider
secrets with the local value winning; merges skill settings by taking a non-default local value
otherwise the remote value; and merges preferences by preserving non-default local theme/language,
OR-ing booleans, unioning dismissed-warning/hint sets, and selecting an active conversation that
still exists. Conversations and skills are ordered by descending `updatedAt`, then UTF-16 `id`.

A clear operation is durable. Clear deletes only managed files observed by that client in the same
PATCH and writes its own immutable clear operation. A state operation committed concurrently under
an unobserved filename must survive.

Normal state publication also compacts observed history. The PATCH writes the new full-vault state
operation and deletes every older managed operation file present in the response that produced it;
it must not delete filenames that were not observed. Missing parent IDs therefore mean pruned
history, not corruption. Because every state carries the complete normalized vault and active
tombstones, concurrent clients that both compact the same observed ancestors remain independent
heads and are merged with an empty common base. This keeps normal Gist growth bounded by active
concurrency instead of total sync count.

Deterministic IDs make retry after an ambiguous network response idempotent. Implementations must
not depend on an undocumented Gist compare-and-swap facility.

## Legacy migration

If no v2 operation files exist and the configured mutable base file contains a valid legacy vault,
the first normal sync represents it as a v2 state operation and deletes the mutable base file in the
same PATCH. After migration, no platform may write the legacy mutable format again.
