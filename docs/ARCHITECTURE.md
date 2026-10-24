# ZeroChat Native-First Architecture

ZeroChat uses platform-native user interfaces with a shared data protocol.

## Platform Stack

| Platform | Language | UI / System Framework | Local Data | Secret Storage |
| --- | --- | --- | --- | --- |
| Web/PWA | TypeScript | React API on Preact compat | Encrypted IndexedDB records | Non-exportable Web Crypto key |
| Windows | C++ | WinUI 3 / C++/WinRT | SQLite or LocalFolder JSON | Windows Credential Locker |
| Android | Kotlin | Jetpack Compose | Room | Android Keystore + EncryptedSharedPreferences |
| iOS | Swift | SwiftUI | SwiftData or SQLite | Keychain |
| macOS | Swift | SwiftUI / AppKit interop | SwiftData or SQLite | Keychain |
| Linux | Rust | GTK4 / libadwaita | SQLite | Secret Service |

## Why ZeroChat Does Not Use One Web Container for Every Platform

The Web/PWA client remains available because browsers and Cloudflare Pages provide broad reach with low hosting cost. Desktop and mobile clients do not use Tauri or Capacitor as the primary direction:

- Windows uses WinUI 3 for native notifications, windows, credentials, and installation behavior.
- Android uses Kotlin and Compose for list performance, input-method behavior, background constraints, and system sharing.
- iOS and macOS use SwiftUI with Keychain, files, windows, and platform multi-device conventions.
- Linux uses Rust and GTK4 for fast startup, low memory overhead, and desktop-environment integration.

## Shared Boundary

ZeroChat shares protocol files rather than UI code:

- `shared/snapshot.schema.json`
- `shared/sync-vault.schema.json`
- `shared/encrypted-snapshot.schema.json`
- `shared/encrypted-object.schema.json`
- `shared/encryption.md`
- `shared/sync-api.openapi.yaml`
- `shared/ai-provider-contract.md`
- `cloudflare/sync-worker.js`

Each client may use its own local database. Gist synchronization and Cloudflare fallback mode use a complete `sync-vault.v1` encrypted as `encrypted-snapshot.v1`. The recommended Cloudflare mode uses incremental synchronization: one Durable Object owns the current sync generation, head, and fallback snapshot with conditional commits; KV remains a one-time migration source and stores Worker proxy metadata; R2 stores encrypted manifests, encrypted message chunks, and encrypted Skill chunks. Remote services must never store plaintext snapshots, manifests, or chunks.

User skills are part of the shared snapshot contract. Clients store pre-chunked skill content plus lightweight keyword indexes, then inject only pinned skills and relevant snippets within a context budget at send time. The Web/PWA loads the skill matcher as a separate chunk, keeping first startup focused on chat.

## Privacy and Security

Synchronization uses end-to-end encryption:

1. The user sets a data encryption password inside ZeroChat.
2. The client derives an AES-256-GCM key with PBKDF2-HMAC-SHA-256.
3. Chats, skills, provider settings, general settings, and AI API keys are placed into a vault.
4. The vault is encrypted locally before upload.
5. Gist, Cloudflare Worker, KV, and server storage receive ciphertext only.

GitHub Token does not enter the vault because a new device needs it to retrieve GitHub-hosted ciphertext. Cloudflare access is derived locally from the data encryption password and configured in the Worker as `ZEROCHAT_ACCESS_KEY`; the raw password is never sent to the Worker. Web/PWA local data is also encrypted with a non-exportable browser AES-GCM key before being written to IndexedDB, reducing exposure when a browser profile or IndexedDB files are read directly.

## Synchronization Conflict Strategy

The first release uses a conservative strategy suitable for personal usage:

1. Local and remote data both carry `updatedAt`.
2. Synchronization reads remote data first.
3. If this device has never synced and has no local user content, remote data is adopted automatically.
4. If this device has never synced and both local and cloud data exist, the client must ask for an explicit direction: use cloud data, upload this device, or merge both sides. It must not silently choose by timestamp.
5. After the first sync direction is resolved, newer remote data is adopted and newer local data is uploaded.
6. First-sync merge keeps different conversations, providers, Skills, and provider keys from both sides. If the same item ID exists on both sides, the newer item wins; provider model and capability lists are unioned. Extra local providers beyond the shipped defaults count as local user content, even before a message exists.
7. Cloudflare incremental sync uploads only new or changed message and Skill chunks, then reuses unchanged remote chunks. The current implementation stores up to 60 messages per message chunk, but the latest partial chunk is uploaded immediately. The value 60 is a storage granularity, not a synchronization threshold. Deleted or replaced Skill chunks are removed from R2 after the new head is written successfully.
8. The Worker rejects older snapshots or older heads that attempt to overwrite newer remote data.
9. AI API keys enter only the encrypted vault or encrypted manifest, never plaintext remote data. Saving, changing, or clearing a provider key updates that provider's `updatedAt`, bumps the local snapshot, and queues encrypted sync when remote sync is configured.

The Web/PWA queues synchronization immediately after a user sends a message. It queues another upload when the AI response completes, is stopped, or fails. Editing, deleting, or regenerating completed messages also uploads the new manifest and chunks immediately. General setting changes use a short debounce. Other devices perform read-only pulls when returning to the foreground, recovering network connectivity, or remaining active; they write remote data only when local unsynced changes are detected.

Native clients that still use snapshot-mode Cloudflare sync check `/sync/head` before writing `/snapshot`. If an incremental head already exists, they refuse the snapshot write instead of creating a second remote truth; users can clear cloud data or use a native build that implements Cloudflare incremental sync.

Snapshot-mode native sync clients receive `hasCompletedSync` and `hasLocalUserContent` from the decrypted local snapshot before encryption. That keeps first-sync behavior identical to Web/PWA: a fresh empty iPhone, Android phone, desktop, or Linux client can pull cloud data immediately, while a device with real local content, including user-added providers, must ask before either side is replaced or merged. For merge, the app layer merges decrypted local and remote app data first, then passes the merged encrypted snapshot to the sync transport for upload.

If future versions need multi-user collaboration or frequent offline editing across several devices, conversation data can be upgraded to message-level merge logic. The current version prioritizes personal synchronization speed, storage efficiency, and recoverability.

## AI Request Strategy

All clients include only remote AI provider presets. Native clients prefer direct official provider APIs or user-configured third-party remote relays. Web clients use `proxyUrl` only when CORS or network policy requires a user-owned Cloudflare Worker. When the Web/PWA uses a Worker proxy, it can reuse the Cloudflare sync Worker and keep the Worker learned custom relay host list aligned with provider edits, deletes, imports, and sync changes through `/proxy/hosts`. Clients and the Worker reject HTTP, localhost, private network, LAN, and credentialed AI Base URLs.

Before sending chat context, clients use model-scoped capability metadata. The Web/PWA enriches provider model lists from `models.dev` and stores the source and verification timestamp; native clients preserve the same metadata in the shared snapshot and apply it to input-budget calculation. Provider APIs remain authoritative when they expose limits, while `models.dev` is a fallback catalog and never grants a capability that the configured provider does not expose.

The Web/PWA uses a Codex-style compaction checkpoint when the estimated input exceeds the model budget: official OpenAI Responses models use `/responses/compact` and retain opaque compaction items; other providers receive a provider-shaped summary request, with a deterministic local summary and bounded recent-turn fallback if that request fails. The checkpoint is hidden from visible history, persisted atomically with the conversation, and replayed only when its message boundary still exists. Visible messages remain complete for local history, sync, and export.
