# ZeroChat Shared Contract

This directory contains cross-platform protocol contracts. It does not contain user-interface code.

- `snapshot.schema.json`: data format that every client must read and write.
- `sync-vault.schema.json`: complete synchronized payload before encryption, including AI API keys.
- `encrypted-snapshot.schema.json`: encrypted envelope stored by remote snapshot backends.
- `examples/snapshot.v1.json`: representative valid plaintext snapshot example.
- `examples/sync-vault.v1.json`: minimal valid plaintext sync vault example before encryption.
- `examples/encrypted-snapshot.v1.json`: minimal valid encrypted snapshot envelope example.
- `examples/encrypted-object.v1.json`: minimal valid Cloudflare incremental encrypted object example.
- `gist-sync-v2.md`: immutable, content-addressed GitHub Gist synchronization protocol.
- `examples/gist-operation-v2-vectors.json`: canonical cross-platform Gist operation IDs and filenames.
- `sync-api.openapi.yaml`: synchronization service HTTP contract.
- `encryption.md`: end-to-end encryption specification.
- `ai-provider-contract.md`: AI provider request contract.

Each platform may use its own language and local database. During synchronization, clients must upload `encrypted-snapshot.v1`, Cloudflare incremental encrypted objects, or encrypted Gist v2 operations. Plaintext snapshots must not be uploaded to remote storage.

All clients must use the same first-sync decision policy. If the device has no previous sync and no local user content, it may adopt remote data automatically. If local user content and remote data both exist, the client must require an explicit user direction before replacing local data with cloud data, uploading this device over the cloud copy, or merging both sides. Merge is performed after decrypting both vaults, then the merged encrypted result is uploaded. Native snapshot clients expose `hasCompletedSync` and `hasLocalUserContent` inputs for this decision because the encrypted envelope alone cannot reveal whether the local snapshot is only a fresh default.

The snapshot includes user skills as chunked content plus keyword indexes. Cloudflare incremental sync may store full Skill content in separate encrypted `skill-*.json` objects while the manifest keeps only indexes and previews. Image attachment Data URLs are stored in bounded encrypted `attachment-*.json` objects while message chunks retain attachment metadata; readers must verify and consume every ordered attachment reference before publishing a reconstructed vault. Clients should preserve `content`, `contentRef`, and `contentPreview` fields even if a platform has not exposed the full Skill editing UI yet, and clients that read incremental data must materialize the full Skill text before presenting or re-uploading it.
