# ZeroChat Encryption

ZeroChat synchronization data must be encrypted on the client before being uploaded to GitHub Gist, Cloudflare Worker, KV, R2, or another remote storage backend. Remote services store ciphertext only.

## Vault

Before synchronization, the client builds `sync-vault.v1`:

```json
{
  "data": {},
  "secrets": {
    "providerKeys": {}
  }
}
```

- `data` is normal application data, defined by `snapshot.schema.json`.
- `secrets.providerKeys` contains AI provider API keys.

`GitHub Token` does not enter the vault because a new device needs it before it can retrieve the remote ciphertext. Cloudflare access uses a separate value derived from the data encryption password with `SHA-256("zerochat-access:v1:" + password)`, base64url encoded without padding. The derived access key must be configured as `ZEROCHAT_ACCESS_KEY` in the Worker; it is not the raw password and cannot decrypt the vault.

## Algorithm

- KDF: PBKDF2-HMAC-SHA-256
- Iterations: 600,000
- Salt: 16 random bytes
- Cipher: AES-256-GCM
- IV: 12 random bytes generated for every encryption operation
- Tag: 128 bit
- Snapshot AAD: `zerochat:vault:v1:<updatedAt>`
- Object AAD: `zerochat:object:v1:<objectType>:<updatedAt>`

Clients must validate:

- `kind` and `version` match the protocol.
- `iterations` is `600000`, unless a future protocol version explicitly changes it.
- Decoded `salt` is 16 bytes and decoded `iv` is 12 bytes.
- `aad` matches the object type and `updatedAt`.
- Decrypted `vault.data.updatedAt` equals the envelope `updatedAt`.

## Remote Snapshot Format

Remote snapshots are stored as `zerochat.encryptedSnapshot`:

```json
{
  "kind": "zerochat.encryptedSnapshot",
  "version": 1,
  "encryptedAt": 1760000002000,
  "updatedAt": 1760000001000,
  "crypto": {
    "cipher": "AES-256-GCM",
    "kdf": "PBKDF2-SHA256",
    "iterations": 600000,
    "salt": "...",
    "iv": "...",
    "aad": "..."
  },
  "payload": "..."
}
```

## Cloudflare Incremental Sync

Cloudflare deployments should use incremental objects instead of uploading a full snapshot for every change.

KV stores the current head:

```json
{
  "kind": "zerochat.incrementalHead",
  "version": 1,
  "manifestKey": "manifest-<uuid>.json",
  "updatedAt": 1760000001000
}
```

R2 stores four `zerochat.encryptedObject` types:

- `manifest-<uuid>.json`: encrypted manifest containing settings, provider configuration, secrets, conversation metadata, and chunk references.
- `chunk-<uuid>.json`: encrypted message chunk. The current Web/PWA stores up to 60 messages per chunk. This value is a chunk size, not a synchronization threshold; the latest partial chunk is uploaded with every completed sync.
- `skill-<uuid>.json`: encrypted user Skill content chunk. The manifest keeps Skill indexes and previews, while full uploaded Skill text stays in separately reusable encrypted objects.
- `attachment-<uuid>.json`: encrypted image attachment content chunk. Each object contains at most 1,500,000 Data URL characters; message chunks retain only attachment metadata, and the manifest carries the ordered attachment references needed to reconstruct the validated PNG/JPEG/WebP Data URL.

During synchronization, the client decrypts the remote manifest, reuses unchanged chunks by fingerprint, and uploads only new or changed chunks. Attachment content is accepted only when every referenced part is present, ordered, fingerprint-valid, and reconstructs one safe image Data URL; unconsumed references invalidate the remote vault. After the new head is written successfully, the client asks the Worker to clean old manifests and unreferenced message, Skill, or attachment chunks.

Clients that do not compress newly written incremental objects may set
`crypto.compression` to `none`; they still must be able to read `gzip` objects
written by another client. This keeps small native writes simple and fast while
preserving compatibility with Web/PWA deployments that compressed an object.

When a device connects to a sync target for the first time, clients must not silently choose a direction if both local user content and remote data exist. They must ask the user to use cloud data, upload this device, or merge both sides. Empty new devices may adopt remote data automatically. Merge is performed only after decryption and then uploaded again as ciphertext.

## User Experience Requirement

Users only need to configure a data encryption password or recovery phrase inside ZeroChat. The application is responsible for:

1. Deriving an encryption key from the password.
2. Encrypting chats, settings, provider configuration, and AI API keys.
3. Uploading ciphertext.
4. Decrypting automatically on a new device after the same password is entered.

Users are not required to install separate encryption tools.

Changing a password that has already been used for sync is a high-risk rotation, not a silent preference edit. Clients must ask for explicit confirmation, explain that old cloud data and encrypted backups still require the old password, and require Cloudflare users to update the Worker `ZEROCHAT_ACCESS_KEY`. Resetting the remembered password only clears local secret storage; it must not be described as recovering old cloud data, and a later sync with a new password must not silently overwrite ciphertext the client cannot decrypt.
