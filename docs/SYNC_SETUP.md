# ZeroChat Sync Deployment and Configuration

This document describes ZeroChat data synchronization, encrypted backups, and Cloudflare AI proxy deployment. For general application usage, refer to `README.md`; use this document when configuring multi-device synchronization.

Localized versions are listed in [docs/README.md](README.md).

## Choose a Mode

| Mode | Best for | Advantages | Limits |
| --- | --- | --- | --- |
| Local | Single-device use or evaluation | No account or server is required; browser storage is encrypted before writing to IndexedDB; no sync provider receives user data | No cross-device history; does not resolve browser AI CORS; recovery depends on manually exported encrypted backups |
| GitHub Gist | Lightweight multi-device text synchronization | No server deployment is required; ZeroChat creates a secret Gist and uploads only end-to-end encrypted data | The GitHub Token remains local and must be entered on each device; not recommended for large image data or extensive history; does not resolve AI CORS |
| Cloudflare Worker | Long-term use, image data, and stable browser AI calls | A Durable Object conditionally commits the sync generation/head/snapshot; R2 stores encrypted incremental objects; KV stores migration and proxy metadata; the same Worker can proxy AI requests and store provider keys in Worker secrets | Requires a Worker deployment; keep the data password and derived Worker access key secure |

Recommended selection:
- Use Local for evaluation or single-device usage.
- Use GitHub Gist for lightweight text synchronization across devices.
- Use Cloudflare Worker + Durable Object + KV + R2 for long-term usage, image generation, and browser-based AI calls.

## Passwords and Tokens

| Name | Where to enter it | Synced? | Purpose |
| --- | --- | --- | --- |
| Data encryption password | Settings > Data | Not stored in the cloud as plaintext; not kept long-term locally | Encrypts sync vaults and encrypted backups. Every new device needs the same password to decrypt remote data |
| GitHub Token | Settings > Sync > GitHub Gist | No | Allows the current device to read and write the configured Gist |
| Cloudflare access key `ZEROCHAT_ACCESS_KEY` | Worker environment or secret | Not stored in the cloud vault | Derived by ZeroChat from the data encryption password. It authorizes Worker sync and Worker AI proxy routes without exposing the raw password |
| AI API Key | Settings > AI Providers | Yes by default inside the encrypted vault; not needed in the browser if hosted by the Worker | Calls OpenAI, Anthropic, custom relays, and other remote AI providers |

Gist, KV, and R2 only store ciphertext. The remote service can store and transfer your data, but it cannot decrypt chats, settings, or synced provider keys. If you lose the data encryption password, the remote ciphertext cannot be recovered.

ZeroChat derives the Cloudflare access key with `SHA-256("zerochat-access:v1:" + password)`, base64url encoded without padding. The derived access key is not the raw password and cannot decrypt data. If the data encryption password changes, copy the new derived access key into the Worker as `ZEROCHAT_ACCESS_KEY`, then let ZeroChat resync/re-encrypt the cloud data.

## GitHub Gist Sync

### 1. Create a GitHub Token

1. Open GitHub Personal access tokens.
2. Prefer a fine-grained token.
3. Name it `ZeroChat Sync`.
4. Choose an expiration you can manage, such as 90 days, 180 days, or 1 year.
5. Grant only `Gists` read/write permission. Repository permission is not needed.
6. Copy the token immediately. GitHub shows the full token only once.

If you can only create a classic token, enable the `gist` scope and avoid extra scopes such as `repo`.

### 2. Configure the First Device

1. Open ZeroChat.
2. Go to Settings > Data and enter your data encryption password.
3. Go to Settings > Sync.
4. Select `GitHub Gist`.
5. Enter the GitHub Token.
6. Leave `Gist ID` empty the first time. ZeroChat will create a secret Gist.
7. Keep the default file name `zerochat-sync.json` unless you have a reason to change it.
8. Send a message or change one setting, then wait for the sync status to complete.
9. Copy the generated `Gist ID` from Settings > Sync.

GitHub `public: false` Gists are secret/unlisted, not listed publicly, but anyone with the URL may be able to open the Gist. ZeroChat uploads encrypted data, so the real protection still depends on your data encryption password.

### 3. Restore Another Device

1. Open the same ZeroChat app.
2. Go to Settings > Data and enter the same data encryption password.
3. Go to Settings > Sync and select `GitHub Gist`.
4. Enter the GitHub Token.
5. Enter the `Gist ID` copied from the first device.
6. Keep the same file name, normally `zerochat-sync.json`.
7. Return to chat or reopen the app. ZeroChat will pull and decrypt the remote data.

### 4. Gist Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| 401 or Unauthorized | Token is wrong, expired, or lacks permission | Generate a new token with only Gists read/write permission |
| 404 or Gist not found | Wrong Gist ID or token cannot access it | Copy the Gist ID again and confirm the token belongs to the same GitHub account |
| New device cannot decrypt data | Data encryption password differs | Use the password from the first device; forgotten passwords cannot decrypt the vault |
| Data looks empty after sync | File name mismatch | Use the same file name on all devices, default `zerochat-sync.json` |
| Large chats or images fail | Gist is a single-file API and is not suitable for large data sets | Switch to Cloudflare Worker + R2 incremental sync |
| Web/PWA still cannot call an AI provider | Gist only syncs data and is not an AI proxy | Use Cloudflare Worker `/proxy`, a native client, or an upstream that supports browser CORS |

## Cloudflare Worker Sync

Cloudflare mode has two parts:
- Data sync: `/sync/head`, `/sync/object/<key>`, and legacy `/snapshot`.
- AI proxy: `/proxy`, used for browser CORS and optional Worker-hosted provider keys.

### 1. Prepare Wrangler

From the project root:

```bash
pnpm install
pnpm dlx wrangler login
cd cloudflare
```

Copy the template:

```bash
# macOS / Linux
cp wrangler.toml.example wrangler.toml

# Windows PowerShell
Copy-Item wrangler.toml.example wrangler.toml
```

`cloudflare/wrangler.toml` is your real deployment config. It may contain tokens, so do not commit it.

### 2. Create KV, R2, and the Durable Object binding

Create KV:

```bash
pnpm dlx wrangler kv namespace create zerochat_kv
```

Put the returned namespace id into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "zerochat_kv"
id = "your KV namespace id"
```

Create the recommended R2 bucket:

```bash
pnpm dlx wrangler r2 bucket create zerochat
```

Confirm the binding:

```toml
[[r2_buckets]]
binding = "zerochat_r2"
bucket_name = "zerochat"

[[durable_objects.bindings]]
name = "ZEROCHAT_SYNC_COORDINATOR"
class_name = "ZeroChatSyncCoordinator"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["ZeroChatSyncCoordinator"]
```

The Durable Object is mandatory: it serializes conditional commits and stores the current sync generation, head, and fallback snapshot. KV remains the one-time migration source for older head/snapshot records and stores Worker proxy metadata. R2 stores encrypted manifests, encrypted message chunks, encrypted Skill chunks, and bounded encrypted image-attachment chunks. A 60-message chunk is a storage unit, not a sync threshold; even one new finished message uploads the latest partial chunk immediately. Image Data URLs are removed from message chunks and split into reusable `attachment-*.json` objects so one valid local image cannot exceed the 5 MB encrypted-object limit. Without R2, the Worker falls back to the single-file `/snapshot` mode through the same coordinator, which is fine for testing but not for large histories, images, or many large Skills.

### 3. Access Key, Hosts, and Origins

In ZeroChat, go to Settings > Data and enter the data encryption password. Then go to Settings > Sync, choose Cloudflare, and copy the derived Cloudflare access key shown there into the Worker as `ZEROCHAT_ACCESS_KEY`. For safer long-term maintenance, use a Worker secret instead of committing it:

```bash
pnpm dlx wrangler secret put ZEROCHAT_ACCESS_KEY
```

Official/preconfigured AI provider hosts are allowed by default. Custom relay hosts are learned automatically after a valid `/proxy` request with the Cloudflare access key. The Web/PWA also replaces the Worker’s learned custom host list when providers are edited, disabled, deleted, imported, or changed by sync, so removed Base URLs do not stay allowed. Host names and HTTPS Base URLs are both accepted; the Worker stores the host part only. If you prefer a fixed list, add custom relays manually:

```toml
ALLOWED_HOSTS = "relay.example.com,https://another-relay.example.com/v1"
```

If a deployment must use only an explicit host list, disable the built-in provider list:

```toml
ALLOW_DEFAULT_PROVIDER_HOSTS = "false"
ALLOWED_HOSTS = "relay.example.com"
```

For a stricter deployment that never learns new custom relay hosts, also set:

```toml
AUTO_ALLOWED_HOSTS = "false"
```

For normal personal deployments, browser CORS origins do not need to be typed manually. The Worker learns a safe browser origin after that origin makes a request with the valid access key. Preflight alone is not enough to enroll a new origin.

For a locked-down deployment, turn off automatic origin learning and set exact origins:

```toml
AUTO_ALLOWED_ORIGINS = "false"
ALLOWED_ORIGINS = "https://zerochat.example.com,http://127.0.0.1:5173"
REQUIRE_ALLOWED_ORIGINS = "true"
```

Cross-origin entries must match protocol, host, and port exactly. `http://127.0.0.1:5173` and `http://localhost:5173` are different origins. An app served by the Worker can always call that same Worker origin and does not need an allowlist entry. The automatic list is limited by `MAX_AUTO_ALLOWED_ORIGINS`, defaulting to 8.

### 4. Deploy and Configure ZeroChat

The template binds `../dist` to the `ASSETS` binding. From the repository root, build the current Web/PWA bundle before deploying; keep the `[assets]` block in the copied `wrangler.toml` so the same Worker serves the ZeroChat app shell/assets as well as `/proxy` and sync routes.

Deploy from `cloudflare/`:

```bash
pnpm dlx wrangler deploy
```

In ZeroChat:
1. Settings > Data: enter the data encryption password.
2. Settings > Sync: select `Cloudflare`.
3. Worker URL: enter your Worker URL.
4. Cloudflare access key: copy the derived value shown in Settings > Sync > Cloudflare into the Worker; no extra app field is needed because ZeroChat derives it from the data encryption password.
5. Send a message and wait for sync to complete.

On other devices, enter the same Worker URL and the same data encryption password. ZeroChat derives the same Cloudflare access key automatically.

If ZeroChat reports “sync configuration error, data saved locally”, local encrypted storage still works, but other devices cannot see that change until the sync configuration is fixed.

### 5. Cloudflare Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Worker setup incomplete: ZEROCHAT_ACCESS_KEY is missing` | The Worker was deployed before the derived access key was configured, or the template placeholder was left unchanged | Copy the derived Cloudflare access key from Settings > Sync > Cloudflare and set it with `pnpm dlx wrangler secret put ZEROCHAT_ACCESS_KEY`, then redeploy if needed |
| `KV binding zerochat_kv is required` | The Worker has no KV namespace binding, or the binding name is wrong | Create the KV namespace and keep the binding name exactly `zerochat_kv` in `wrangler.toml` |
| `Durable Object binding ZEROCHAT_SYNC_COORDINATOR is required` | The strong-consistency coordinator binding or migration is missing | Copy both `[[durable_objects.bindings]]` and `[[migrations]]` from the template, then redeploy the Worker |
| `R2 binding zerochat_r2 is required` | R2 is not bound, so incremental sync is unavailable | Add the R2 bucket binding exactly as `zerochat_r2`; snapshot mode can still be used for short tests when KV is configured |
| 401 or Unauthorized | The Worker access key does not match the current data password | Copy the current derived access key from Settings > Sync > Cloudflare and update the Worker secret |

## Cloudflare AI Proxy

Browser CORS failures are separate from API key validity. A key may work in curl or a native app and still fail in Web/PWA because the upstream does not allow browser preflight requests.

### Browser Keeps the Provider API Key

Use this first to verify the proxy:
1. Settings > AI Providers.
2. Base URL: real provider URL, such as `https://api.openai.com/v1` or `https://relay.example.com/v1`.
3. API Key: provider key.
4. Proxy URL: your Worker URL. If Settings > Sync already uses the same Cloudflare Worker, this field can stay empty and the Web/PWA reuses the sync Worker automatically.
5. Cloudflare access key: no provider-level token is needed; ZeroChat sends the derived access key to the Worker.
6. Save, fetch models, or send a message.

This resolves CORS for browser usage, but the provider API key still exists in browser memory and is sent to the Worker.

The AI proxy body contract depends on the action. Chat, image generation or
Responses image requests, audio speech, embeddings, moderation, and Realtime
client-secret requests use `Content-Type: application/json`. Image edits and
audio transcriptions upload files, so they must remain `multipart/form-data`;
do not set `Content-Type` manually for those upload actions, because the
browser or native runtime must provide the form-data boundary. The Worker CORS
preflight allows `Content-Type`, and `shared/sync-api.openapi.yaml` publishes
both proxy request body types.

### Worker Hosts the Provider API Key

Recommended for long-term browser use. Store provider keys as Cloudflare secrets, not in `wrangler.toml`. `PROVIDER_KEYS` is the only Worker-hosted provider-key binding and a non-empty exact-host JSON map enables that mode automatically:

```bash
pnpm dlx wrangler secret put PROVIDER_KEYS
```

Paste JSON:

```json
{
  "api.openai.com": "<provider-api-key>",
  "relay.example.com": "<provider-api-key>"
}
```

Deploy again. In ZeroChat, keep Base URL, enable “key is hosted in my Worker or relay”, and leave the provider API Key empty. Proxy URL can stay empty when Cloudflare sync already points to the same Worker; otherwise enter the Worker URL in the provider settings. Prefer the Worker root; pasted `/proxy` and `/proxy/hosts` endpoint URLs are normalized while preserving a deployment base path.

Only enable `ALLOW_KEYLESS_UPSTREAMS=true` when your upstream relay already handles authentication and explicitly requires no provider key. Normal OpenAI, Anthropic, Gemini, and most relays should not use it.

## Backup and Safety

- Encrypted export and sync use the same data encryption password.
- Importing an encrypted backup replaces local chats, providers, settings, and synced secrets; the next sync may update the cloud copy.
- Do not share GitHub Token, the derived Cloudflare access key, or AI API keys.
- Do not commit `cloudflare/wrangler.toml`, `.dev.vars`, or any file containing real keys.
- Use HTTPS provider Base URLs.
- Custom relay hosts can be learned automatically after a valid access key request. Web/PWA replaces the learned list through `/proxy/hosts` when provider settings change, so removed custom Base URLs are also removed from the Worker. Add `ALLOWED_HOSTS` only when you want a manual fixed list; set `AUTO_ALLOWED_HOSTS=false` to disable host learning/replacement, and `ALLOW_DEFAULT_PROVIDER_HOSTS=false` if you also need to disable built-in provider hosts.
- Exact same-origin Worker requests are always allowed. Learning for other browser origins is enabled by default and requires a valid route token. Use `AUTO_ALLOWED_ORIGINS=false`, `ALLOWED_ORIGINS`, and `REQUIRE_ALLOWED_ORIGINS=true` when you want a fully manual cross-origin allowlist.
- For long-term Web/PWA use, prefer Cloudflare Secret-hosted AI API keys.

Official references:
- GitHub Gist REST API: https://docs.github.com/en/rest/gists/gists
- Cloudflare Wrangler: https://developers.cloudflare.com/workers/wrangler/
- Cloudflare Workers KV commands: https://developers.cloudflare.com/workers/wrangler/commands/kv/
- Cloudflare R2 commands: https://developers.cloudflare.com/r2/reference/wrangler-commands/
- Cloudflare Worker secrets: https://developers.cloudflare.com/workers/configuration/secrets/

