# Security Model

ZeroChat's synchronization security goal is that remote synchronization services can store and transfer data, but cannot read user data.

## End-to-End Encryption

Before synchronization, the client builds `sync-vault.v1` containing:

- Chats
- Generated image attachments
- User settings
- Provider configuration
- AI API keys

The client encrypts this vault locally with the user-configured data encryption password. GitHub Gist and legacy snapshot sync produce `zerochat.encryptedSnapshot` vaults; Cloudflare incremental sync produces `zerochat.encryptedObject` manifests, message chunks, Skill chunks, and image attachment chunks. GitHub Gist, Cloudflare Worker, KV, R2, and static hosting services receive ciphertext only.

Native Windows legacy-snapshot sync rejects non-canonical local and remote envelopes before publication or state callbacks. Validation covers the exact v1 object shape, fixed AES/PBKDF2 suite and iteration count, positive JSON-safe timestamps, canonical base64, 16-byte salt, 12-byte IV, timestamp-bound AAD, and a payload larger than the GCM authentication tag.

The same Windows boundary consumes response bodies for HTTP connection hygiene but never forwards Worker-provided error text into application notices. Only the numeric status and a bounded client-owned category such as credentials, conflict, size, rate limit, timeout, or service availability reaches the user.

Windows native Cloudflare sync constructs its HTTP transport with automatic redirects disabled before attaching the bearer access key. Redirect responses are drained and rejected, so a Worker or intermediary cannot move the credential-bearing request to a host that did not pass endpoint validation.

The same transport uses one 60-second deadline across response headers, content-stream acquisition, and every bounded stream read. A timeout cancels the active WinRT HTTP operation and unwinds the process-wide sync lease, preventing an unavailable or malicious endpoint from holding all later sync and clear operations indefinitely.

The same 60-second total sync boundary applies across Web and native clients. Web keeps one timeout signal alive through bounded body-stream completion; Android caps Ktor request, connect, and socket time; Apple caps both request inactivity and the entire URLSession resource transfer; Linux caps reqwest connect and total request time; Windows retains its single headers-to-body deadline. A remote service cannot keep synchronization ownership indefinitely by accepting a connection without completing it or by sending an endless trickle response.

All native credential-bearing transports reject automatic redirects before attaching secrets. Android disables Ktor redirects for production AI and sync clients; Apple routes AI, Gist, and Cloudflare tasks through a URLSession task delegate that declines redirects; Linux configures both reqwest clients with `Policy::none()`; Windows uses credential-bound WinRT HTTP filters. Native callers must configure the final trusted endpoint instead of relying on 30x forwarding.

All sync transports enforce body-size boundaries before parsing or publishing data. Legacy snapshots are capped at 900,000 bytes, incremental encrypted objects and aggregate Gist responses at 5,000,000 bytes, and incremental heads plus client error bodies at 16,384 bytes. Web, Android, Apple, Linux, and Windows check declared lengths and count streamed bytes; a chunked or lengthless response is cancelled or closed immediately when it crosses its budget. JSON is decoded only after bounded UTF-8 completion, and snapshot/object/head uploads are byte-checked before any credential-bearing request starts. The Worker/OpenAPI contract carries the same snapshot/object/head/error limits and rejects oversized incremental-head writes before JSON parsing or publication.

## Algorithm Selection

- AES-256-GCM provides authenticated encryption, confidentiality, and integrity.
- PBKDF2-HMAC-SHA-256 derives a 256-bit AES key from the user data encryption password.
- 600,000 iterations is the fixed value for the current protocol; clients reject unusually low or excessively high iteration values.
- A 16-byte salt is randomly generated for every encryption operation.
- A 12-byte IV is randomly generated for every encryption operation to prevent GCM IV reuse.
- A 128-bit tag rejects modified ciphertext.
- AAD binds object type and `updatedAt`; clients and the Worker reject objects with mismatched AAD.

## Local At-Rest Encryption

The Web/PWA generates a local AES-GCM key with Web Crypto and stores it as a non-exportable `CryptoKey` in IndexedDB. Chats, settings, and local secret records are encrypted before being written to browser storage. Legacy plaintext `localStorage` secrets are migrated into encrypted records and removed during read.

Backup imports and cloud-sync readback never trust snapshot-provided Skill `contentRef` values as local IndexedDB keys. External inline Skill content is rewritten under newly allocated `skill-chunk:external:*` keys; ref-only external chunks are not dereferenced against local storage. Local inline Skill edits are written under per-batch `skill-chunk:local:*` keys before AppData metadata publication, so a failed metadata commit cannot overwrite the content still referenced by the previous snapshot. This prevents an encrypted but damaged or malicious snapshot, or an interrupted local edit, from overwriting AppData or unrelated local Skill records through a forged or reused document key.

The data encryption password is stored only in `sessionStorage`. It survives refreshes in the same tab session but must be re-entered after the tab is closed. This prevents the recovery password from being retained long term in browser configuration. The reset sync password action only clears this remembered local value; it does not recover, decrypt, or modify old cloud ciphertext.

## XSS and Remote Address Boundary

A browser client cannot fully defend against same-origin XSS, because malicious script running in the same origin can call the application's own decryption paths. ZeroChat therefore avoids `dangerouslySetInnerHTML`, and Web, native clients, and the Worker reject unsafe HTTP, localhost, private network, LAN, documentation, benchmarking, multicast, reserved, and credentialed AI endpoints.

The Web/PWA production shell ships `public/_headers` for hosts that support
static response headers. Its Content Security Policy keeps script execution on
`'self'`, rejects script attributes, blocks frames/plugins/forms, and restricts
network connections to same-origin plus secure remote `https:` and `wss:`
endpoints. That allows user-owned HTTPS AI providers and Workers while keeping
HTTP, localhost, private-network, LAN, and special-use endpoints outside the
browser CSP boundary. GitHub Pages does not apply custom headers, so Cloudflare Pages,
Netlify, or another header-capable host is preferred when strict browser CSP is
required.

When `clientRequestMode` is enabled for an AI provider, the app sends requests directly to the provider `baseUrl` and ignores Worker proxy settings for that provider. This is useful for native apps and CORS-friendly providers, but Web users should disable it when they need a Worker to avoid CORS or keep the provider API key out of browser-origin requests.

The Windows native AI transport disables automatic HTTP redirects before attaching either a provider API key or a Worker proxy access key. A 30x response is consumed and rejected with a bounded local message, so credentials cannot cross to a redirect target that bypassed the configured endpoint validation.

ZeroChat does not include local AI provider presets. All presets are remote APIs, and user-defined relays must also use remote HTTPS endpoints.

Image generation, image editing, and inpainting prompts are sent to the selected remote AI provider. Image editing and inpainting also upload the user-selected source image; inpainting additionally uploads a locally generated transparent mask. Generated results are stored as chat message attachments and enter local at-rest encryption and end-to-end encrypted synchronization. Remote synchronization services see only ciphertext, but the AI provider receives the image request content.

## AI Key Exposure

When the browser calls an AI API directly, the API key must temporarily exist in browser memory and network requests. This is a normal boundary for a pure frontend application, but same-origin XSS, browser extensions, or a shared device may expose it.

The safer Web/PWA mode is to use a user-owned Cloudflare Worker proxy with provider API keys stored as a Cloudflare Secret named `PROVIDER_KEYS`. In this mode:

- The browser sends only the Cloudflare access key derived from the data encryption password and does not send the raw password. The access key is configured in the Worker as `ZEROCHAT_ACCESS_KEY` and cannot decrypt the encrypted vault.
- The Worker reads provider API keys only from the `PROVIDER_KEYS` JSON exact-host mapping and injects the matching key into the upstream request. It never derives environment-variable names from an upstream host, so punctuation-normalization collisions cannot route a key to another domain.
- The Worker has a built-in allowlist for official/preconfigured provider hosts. Custom relay hosts can be learned automatically after a valid proxy request, and the Web/PWA can replace the learned custom host list through `/proxy/hosts` after provider edits, deletes, imports, or sync changes. Fixed deployments can use `ALLOWED_HOSTS` instead. Browser origins can be learned automatically after a valid route token request; stricter deployments can disable this with `AUTO_ALLOWED_ORIGINS=false` and set `ALLOWED_ORIGINS` plus `REQUIRE_ALLOWED_ORIGINS=true`.
- A centralized public ZeroChat server should not host all user keys. The security boundary should remain in the user's own Worker.

## Dangerous Operation Confirmation

Deleting messages, deleting conversations, deleting providers, importing over local data, and resetting local data use a shared confirmation dialog. Delete operations state that, if synchronization is configured, the corresponding encrypted remote records will also be removed.

If the user confirms an operation and chooses not to show the warning again, the preference is stored in `preferences.dismissedDangerWarnings` and synchronized inside the end-to-end encrypted vault.

Changing an existing sync password and resetting the remembered sync password use non-skippable high-risk confirmations. Rotation warns that cloud data and backups encrypted with the old password cannot be opened with the new password, and Cloudflare users must update the Worker `ZEROCHAT_ACCESS_KEY`. After a reset, entering a new password does not silently overwrite cloud data that cannot be decrypted.

## Data Not Synchronized

The following values do not enter the vault:

- GitHub Token
- Platform system credentials

Cloudflare access is derived on the client from the data encryption password with `SHA-256("zerochat-access:v1:" + password)`, base64url encoded without padding. If the user changes the data encryption password, they must update `ZEROCHAT_ACCESS_KEY` in the Worker and let ZeroChat resync/re-encrypt the cloud data after confirming the high-risk prompt.

These values are required before a new device can retrieve remote ciphertext, so they can only remain in local secure storage.

## Platform Secret Storage

- Web/PWA: encrypted IndexedDB records and a non-exportable Web Crypto local key; sync password stored only for the session.
- Windows: Windows Credential Locker.
- Android: Android Keystore + EncryptedSharedPreferences.
- iOS/macOS: Keychain.
- Linux: Secret Service.

## Worker Security Boundary

- `/snapshot` accepts only `zerochat.encryptedSnapshot` and rejects plaintext snapshots.
- `/snapshot` rejects older `updatedAt` values that attempt to overwrite newer stored data.
- `/sync/head` stores only the incremental manifest pointer and rejects older heads that attempt to overwrite newer heads.
- `/sync/object/<key>` accepts only `zerochat.encryptedObject` manifest, message-chunk, or Skill-chunk keys and validates KDF, AAD, salt, IV, and payload.
- `/proxy` requires the Cloudflare access key.
- `/proxy` rejects localhost, private network, LAN, and credentialed upstream addresses.
- The proxy host allowlist permits built-in official/preconfigured AI API domains plus custom relay hosts learned after a valid access key request or explicitly added through `ALLOWED_HOSTS`. `/proxy/hosts` requires the access key and replaces only the learned custom relay host list; it does not change built-in hosts or manual `ALLOWED_HOSTS`. Set `AUTO_ALLOWED_HOSTS=false` to disable custom host learning and replacement, and `ALLOW_DEFAULT_PROVIDER_HOSTS=false` if a deployment must use only the custom list.
- By default, the Worker can remember a small number of browser origins after they make a request with the valid access key. When `ALLOWED_ORIGINS` is configured with `REQUIRE_ALLOWED_ORIGINS=true`, browser cross-origin requests are allowed only from listed ZeroChat page origins.
- AI proxy requests without a browser-provided key or Worker-hosted key are rejected by default. They are forwarded to keyless upstream relays only when `ALLOW_KEYLESS_UPSTREAMS=true` is explicitly configured.
- `/proxy` does not log request headers, API keys, prompts, or image content. Deployment operators should avoid manually printing these values in platform logs.

## Recovery Password Requirements

The data encryption password has no mandatory length restriction, so users may choose their own recovery phrase. A long random password generated by a password manager is still recommended.

If the recovery password is lost, remote ciphertext cannot be decrypted. This is the expected result of end-to-end encryption.
