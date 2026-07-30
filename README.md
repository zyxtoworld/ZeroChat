# ZeroChat

ZeroChat is a lightweight, privacy-first AI chat client. The Web/PWA is the
reference daily-use surface today, and the native Windows, Android, iOS, macOS,
and Linux clients are kept on the same encrypted sync format as their platform
runtime QA completes.

Users bring their own remote AI provider account or third-party relay. ZeroChat stores chats and settings locally first, can sync them with end-to-end encryption, and can use a self-owned Cloudflare Worker when the browser needs help with AI CORS or safer API key handling.

## Project Status

| Platform | Language | Stack | Directory |
| --- | --- | --- | --- |
| Web/PWA | TypeScript | React API + Preact compat renderer + Vite | `src/` |
| Windows | C++ | WinUI 3 / C++/WinRT | `apps/windows/` |
| Android | Kotlin | Jetpack Compose | `apps/android/` |
| iOS/macOS | Swift | SwiftUI | `apps/apple/` |
| Linux | Rust | GTK4 / libadwaita | `apps/linux/` |
| Sync backend | JavaScript | Cloudflare Worker + Durable Object + KV/R2 | `cloudflare/` |

The Web/PWA client is currently the most complete runnable implementation.
Native platform directories now include native UI parity screens for chat,
provider/model setup, image modes, synchronization, and data controls, plus
platform-specific secure storage and networking layers. Treat native source
parity as a prerequisite, not release proof: every native platform still needs
the target runtime and visual QA named later in this README before release
claims. All clients must remain compatible with the protocol files in `shared/`.

## Choose Your Path

| Goal | Start here | You do not need yet |
| --- | --- | --- |
| Use ZeroChat on this computer | Run the Web/PWA locally or install a native app. | Web deployment, Cloudflare Worker, GitHub Gist, or `dist/`. |
| Sync the same data across devices | Configure GitHub Gist or Cloudflare in Settings > Sync, then set the data encryption password in Settings > Data. | Web hosting. Sync works separately from Cloudflare Pages or GitHub Pages. |
| Open ZeroChat from a browser URL | Deploy the static Web/PWA with Cloudflare Pages or GitHub Pages. | Sync Worker/KV/R2 at first; add them only when you want cloud sync or the Worker AI proxy. |

If you are unsure, start locally. Add sync only when you need another device,
and deploy the Web/PWA only when you want a hosted browser URL.

## Run the Web/PWA Locally

Local development requires Node.js 22.19 or newer within the Node 22 release
line and pnpm 11.13.1. The same Node major and pnpm version are used by every
GitHub Actions workflow.

```bash
pnpm install
pnpm run dev
```

Build:

```bash
pnpm run build
```

`pnpm run build` creates `dist/`, the static Web/PWA files used by Cloudflare
Pages, GitHub Pages, or any static host. Users who only want encrypted sync do
not need to touch `dist/` or deploy the Web app.

## Easiest Web Deployment

Deploy only if you want to use ZeroChat from a hosted browser URL. If you are
running the app locally or using a native app and only want cross-device sync,
skip Web deployment and configure GitHub Gist or Cloudflare in Settings > Sync.

The shortest Web deployment paths are:

- Cloudflare Pages dashboard: connect this GitHub repository, set build command
  to `pnpm run build`, and set build output directory to `dist`.
- Cloudflare Wrangler: run `pnpm install` and `pnpm run deploy:cf`. Wrangler
  will prompt for login and project creation the first time. To test the local
  build without uploading, run `pnpm run deploy:cf -- --dry-run`.
- GitHub Pages: set repository Settings > Pages > Source to GitHub Actions, then
  run the included Deploy Web workflow or push to `main`/`master`.

Beginner deployment guides are available in all interface languages; see
[docs/README.md](docs/README.md).

## Basic Usage

The first run asks only for the pieces needed to start chatting:

1. Choose an AI provider. If you use a third-party relay, choose `Custom relay (OpenAI compatible)` unless the relay documentation clearly says it uses Responses or Anthropic.
2. Enter the provider API key. Website login sessions are not enough; remote APIs normally require an API key.
3. Open Settings > Models and fetch the model list, or type model names manually and press Space after each one.
4. Select a configured model in the chat header and send a message.
5. If you only want to look around, skip provider setup. ZeroChat will keep data encrypted on this device until you configure a provider.

All full interface dictionaries, including Chinese, are lazy-loaded outside the main Web app bundle. On startup, ZeroChat shows a tiny built-in loading shell while it scans the operating system language preference list and preloads the first supported language; the shell itself also picks that language before the React-compatible app runtime loads. After local data is opened, the saved language preference is preloaded before the main interface is shown, so returning users do not see a brief system-language flash. If a locale chunk fails during a network hiccup, the next language switch retries it instead of getting stuck.

The Web/PWA service worker keeps the app usable offline and prunes stale same-origin runtime assets while preserving the current shell, so repeated hosted updates do not keep growing the browser cache forever.

Skills can be imported from `.md`, `.txt`, or `.json` in Settings > Skills. ZeroChat indexes them once, stores large files as encrypted chunks with batched local reads/writes, batches multi-file imports and startup migration writes together, then lazy-loads only pinned skills and relevant snippets when sending a message, so large skill libraries do not enter the startup path or every chat request.

For images, switch the composer to Image mode. It supports text-to-image, image editing, and inpainting. Image-capable models, such as `gpt-image-2`, are selected from the same model list in Settings > Models. Generated images can be downloaded. While an image request is running, the source image, task mode, and mask controls are locked so the visible draft cannot be confused with the submitted request.

For multiple devices, choose GitHub Gist or Cloudflare in Settings > Sync, then set the data encryption password in Settings > Data. A new device can restore chats, settings, provider configuration, and synced AI API keys after entering the same sync settings and the same data encryption password. Changing an already-synced password is treated as high risk and requires explicit confirmation; resetting the password only clears the value remembered on the current device and does not recover old cloud data.

Local AppData writes are serialized and coalesced: rapid edits save the newest snapshot instead of launching overlapping encrypted IndexedDB writes, while explicit blur/commit actions, page hide, and mobile/browser backgrounding flush through the same queue immediately.

Localized synchronization and deployment documents are listed in `docs/README.md`.

| Language | Sync Setup Guide |
| --- | --- |
| English | [docs/SYNC_SETUP.md](docs/SYNC_SETUP.md) |
| 中文 | [docs/SYNC_SETUP.zh-CN.md](docs/SYNC_SETUP.zh-CN.md) |
| Español | [docs/SYNC_SETUP.es-ES.md](docs/SYNC_SETUP.es-ES.md) |
| हिन्दी | [docs/SYNC_SETUP.hi-IN.md](docs/SYNC_SETUP.hi-IN.md) |
| العربية | [docs/SYNC_SETUP.ar-SA.md](docs/SYNC_SETUP.ar-SA.md) |
| Português | [docs/SYNC_SETUP.pt-BR.md](docs/SYNC_SETUP.pt-BR.md) |
| Русский | [docs/SYNC_SETUP.ru-RU.md](docs/SYNC_SETUP.ru-RU.md) |
| 日本語 | [docs/SYNC_SETUP.ja-JP.md](docs/SYNC_SETUP.ja-JP.md) |
| 한국어 | [docs/SYNC_SETUP.ko-KR.md](docs/SYNC_SETUP.ko-KR.md) |
| Français | [docs/SYNC_SETUP.fr-FR.md](docs/SYNC_SETUP.fr-FR.md) |

Remote API calls cannot use a normal website login session. OpenAI, Anthropic, Gemini, OpenRouter, and similar official APIs require an API key or equivalent API credential. Custom relay providers require the API key issued by that relay.

## AI Providers

ZeroChat includes remote providers only. It does not include local Ollama, LM Studio, or other local model service presets. Current presets include OpenAI, Anthropic, Google Gemini, DeepSeek, xAI, OpenRouter, Mistral, Groq, Together, Fireworks, Cerebras, NVIDIA NIM, DeepInfra, Novita, SiliconFlow, ModelScope, Alibaba Bailian, Moonshot, Zhipu GLM, Baidu Qianfan, Tencent Hunyuan, MiniMax, Volcano Ark, Azure OpenAI, and Cloudflare AI Gateway templates.

Third-party relay providers can be added without waiting for an application update. The safest default is `Custom relay (OpenAI compatible)`. Select `Custom relay (OpenAI Responses)` only when the relay documentation explicitly supports the OpenAI Responses API. Select `Custom relay (Anthropic / Claude)` only when the relay documentation explicitly supports the Anthropic Messages API. After adding a provider, enter its HTTPS Base URL and API key, then maintain the model list in Settings > Models.

The provider settings page records the remote capabilities and API surfaces supported by each provider, including text chat, vision, tool calls, image generation/editing, audio, realtime, embeddings, moderation, and model listing. OpenAI presets keep text chat on the Responses API and record GPT Image 2 image capabilities separately; image and audio capabilities are not mixed into ordinary text chat requests.

Model lists can be fetched from the provider or maintained manually. Manual entries are converted into draggable tags after pressing space. The chat page only allows model selection from configured provider model lists. ZeroChat classifies model names such as `gpt-image-*`, `dall-e-*`, `imagen`, and `flux` as image models, and prefers newer image models when multiple options are available.

Provider connection options are written for non-experts:

- `Connection protocol`: shown as read-only after the provider is added. To use another API shape, add the matching custom relay type instead of changing an existing provider.
- `Request provider directly`: the app calls the provider without a Worker. This is simplest, but the Web client may hit browser CORS limits and the API key is sent from the current page.
- `Worker/proxy URL`: use your own Worker when browser direct access fails or when you want the Worker to hold the provider key.
- `Check connection`: reads the model list to verify Base URL, API key, CORS/Worker routing, and model-list access. It does not send chat content.

Security boundaries:

- Web, native clients, and the Worker reject HTTP, localhost, private network, LAN, documentation, benchmarking, multicast, reserved, and credentialed remote AI Base URLs.
- Local debugging addresses are for development only and are not built-in provider presets.
- OpenAI Responses requests set `store: false`.
- If browser direct access fails because of CORS or network policy, users can configure their own Cloudflare Worker as an AI proxy. If terminal tools, native clients, or curl can connect but the Web/PWA cannot fetch models or send messages, the likely cause is an upstream browser CORS restriction rather than an API key error.
- The safer browser mode is to store provider API keys in the user's own Worker or relay. The browser sends only the Cloudflare access key derived from the data encryption password; the Worker injects the provider API key from its own environment variables.

## Synchronization and Encryption

ZeroChat synchronizes an end-to-end encrypted vault. Remote storage only receives ciphertext.

Synchronized data includes:

- Chats
- Generated image prompts and image attachments
- Provider name, type, Base URL, proxy URL, model list, default model, capabilities, and enabled state
- User skills, chunk indexes, and skill matching settings
- AI API keys
- Theme, language, current conversation, and other settings
- Sync method, Gist ID, Gist file name, and Worker URL

Data not synchronized:

- GitHub Token
- Platform system credentials

Cloudflare access is derived locally from the data encryption password with `SHA-256("zerochat-access:v1:" + password)` and base64url encoding. Configure that derived value as the Worker `ZEROCHAT_ACCESS_KEY`. It is not the raw password and cannot decrypt chats. If the data encryption password changes, copy the new derived value to the Worker and let ZeroChat resync. ZeroChat will ask before rotating an existing sync password and will not silently overwrite cloud data it cannot decrypt.

Encryption scheme:

- AES-256-GCM
- PBKDF2-HMAC-SHA-256
- 600,000 iterations
- Fresh 16-byte salt and 12-byte IV for each encryption operation
- AAD binds object type and `updatedAt`

The Web/PWA also encrypts local storage. Chats, settings, and local secret records are encrypted with Web Crypto AES-GCM before writing to IndexedDB. The data encryption password is kept only in the current browser session and must be entered again after the tab is closed.

## Immediate Synchronization

Every completed chat-window change is synchronized:

- A user message queues an upload immediately.
- A normal AI completion, user stop, or API error queues another upload for the final state.
- Image generation completion, stop, or error follows the same rule.
- Editing and resending a user message truncates later messages and synchronizes the new version.
- AI messages cannot be edited; they can only be regenerated or deleted.
- Deleting messages, deleting conversations, deleting providers, importing over local data, and resetting local data require a risk confirmation. If the user chooses not to show the warning again, that preference is synchronized inside the encrypted vault.
- Changing an existing sync password and resetting the remembered sync password also require confirmation. These password warnings cannot be skipped because old cloud data and encrypted backups still require the old password.

More generally, every local user action that changes app data advances the
snapshot `updatedAt` value. When sync is enabled and configured, ZeroChat uses
that timestamp to queue a cloud upload; if sync credentials are missing, the
change stays saved locally and the app shows the sync configuration problem.

First sync follows the same rule on every platform: an empty new device adopts
the cloud copy automatically, but if the device already has local chats,
providers, settings, or Skills and the cloud also has data, ZeroChat asks the
user to choose between using the cloud copy, uploading this device, or merging
both sides. Merge keeps different chats, providers, Skills, and provider keys
from both sides; if the same item exists on both sides, the newer item wins.
ZeroChat never silently guesses that direction.

Cloudflare synchronization prefers incremental objects:

- A Durable Object stores the current sync generation, incremental head, and legacy snapshot under one strongly consistent coordinator. Existing KV head/snapshot data is imported once during migration.
- KV stores Worker-managed origin/host metadata and remains the migration source for older encrypted sync records.
- R2 stores encrypted manifests, encrypted message chunks, and encrypted Skill chunks.
- Each chunk contains up to 60 messages. This is a storage granularity, not a synchronization threshold. A single new message still uploads the latest partial chunk immediately.
- Skill files are indexed in the manifest but their full content is stored as separate encrypted chunks, so large user-uploaded Skills do not bloat startup metadata.
- Unchanged chunks are reused. Old manifests and unreferenced message or Skill chunks are cleaned after the new head is written successfully, including Skill edits and deletes.

If R2 is not bound, the Worker falls back to a single encrypted snapshot mode through the same Durable Object coordinator. That mode is suitable for early validation and small datasets. Generated images are commonly around 1 MB each, so R2 incremental objects are strongly recommended for image workflows and long-term history.

## Detailed Sync Configuration

See `docs/README.md` for the complete documentation set. The documentation directory provides synchronization setup guides in the 10 interface languages supported by the application. It covers:

- Local, GitHub Gist, and Cloudflare usage scenarios, advantages, and limits.
- GitHub Gist token, Gist ID, file name, second-device restore, and troubleshooting.
- Cloudflare Worker, `zerochat_kv`, `zerochat_r2`, derived `ZEROCHAT_ACCESS_KEY`, automatic browser origin learning, automatic custom relay host learning/replacement, and optional manual host allowlists.
- Worker-based AI CORS resolution and safer provider key storage through Cloudflare secrets.
- Encrypted backups, data encryption passwords, and token differences.

Summary:

- GitHub Gist is suitable for lightweight text synchronization and does not solve AI provider CORS.
- Cloudflare Worker + Durable Object + KV + R2 is the recommended long-term option for large chat history, images, and incremental synchronization.
- For browser AI CORS, use a self-owned Cloudflare Worker proxy. The Web/PWA automatically reuses the configured Cloudflare sync Worker as the AI proxy when a provider has no separate proxy URL. Official provider hosts are allowed by default. Custom relay hosts can be learned automatically after a valid access key request, and the Web/PWA calls `/proxy/hosts` to replace the learned custom host list when providers are edited, disabled, deleted, imported, or changed by sync. For long-term browser use, prefer storing AI API keys as Worker secrets.
- The data encryption password is configured in Settings > Data. GitHub Token must be entered separately on each device. Cloudflare uses the derived access key shown by ZeroChat; if the data encryption password changes, update `ZEROCHAT_ACCESS_KEY` in the Worker and let ZeroChat resync.

## Native Clients

Native clients share the same data and provider contracts while using the
practical UI layer for each platform:

- Windows: C++/WinUI 3 host with WebView2 shared PWA UI, native Windows service code in source, MSIX recommended.
- Android: Kotlin/Jetpack Compose, Android Keystore + EncryptedSharedPreferences, local `snapshot.v1.json`, APK/AAB recommended.
- iOS/macOS: Swift/SwiftUI, Keychain, Application Support `snapshot.v1.json`, Xcode Archive recommended.
- Linux: Rust/GTK4/libadwaita, Secret Service recommended, XDG `snapshot.v1.json`, Flatpak/AppImage recommended.

Native UI scope now matches the core Web feature map at the screen level: conversation list, merged provider/model picker, user-message edit and resend, AI regenerate/delete controls, text-to-image/edit/inpaint controls, six settings categories including Skills, model fetching/manual entry/reordering, sync mode explanations, data encryption password, encrypted backup import/export, local reset, and clear-cloud entry points that stay scoped by platform runtime QA. Native clients preserve synced Skill data in the shared schema. Android, Apple, and Linux source now read and write encrypted GitHub Gist vaults and the shared Cloudflare incremental manifest/message-chunk/Skill-chunk protocol, with the encrypted Cloudflare snapshot path kept only for older Workers. Windows uses the visually tested shared PWA UI through WebView2, and Linux now source-wires GTK chat sends, user edit-and-resend, AI regenerate, message delete, session data-password save/reset, encrypted backup import/export, reset local data, Skill settings, paste add, file import, edit, toggle, and delete to the shared snapshot store. Native runtime builds and visual QA are still required before claiming release-complete native Skill, sync, and backup UX. Web remains the fully runtime-verified reference for Cloudflare incremental R2 sync, while Android, Apple, and Linux now carry source-level encrypted Gist parity pending their platform runtime sync passes.

Native clients also expose the same language modes as the Web client. They follow the operating system by default and use lightweight runtime dictionaries for key navigation, appearance, and composer text so language switching does not add heavy startup work.

Native builds require the matching platform SDKs. Android includes a checked-in Gradle Wrapper but still needs Android Studio/JDK 17 and SDK Platform 36. Apple includes a checked-in Xcode app target and shared scheme but still needs Xcode/Swift tooling plus simulator/device visual QA. Windows now includes a checked-in WinUI solution/project and needs Visual Studio with WinUI 3/WebView2 support. Linux needs a real Linux host or WSL distro with Rust, `pkg-config`, GTK4, and libadwaita development packages; Windows/macOS `cargo` is not enough for Linux runtime QA. Run `pnpm run check:native-prereqs -- --platform=current` on a platform build machine before native QA, or pass `android`, `apple`, `windows`, `linux`, or `all` explicitly.
Treat source parity and CI compile checks as prerequisites, not release proof:
each native platform still needs its own runtime launch, visual pass, sync pass,
and destructive-action pass on that platform before it is called release-ready.
On target hosts, the repeatable runtime-smoke entry points are:

```bash
pnpm run qa:apple
pnpm run qa:linux
```

`qa:apple` must run on macOS with Xcode and Swift installed. It writes
`.manual-qa/native-prereq-apple.json`, builds the SwiftPM product and Xcode
shared macOS scheme, builds the same scheme for `generic/platform=iOS Simulator`,
captures `.manual-qa/apple-runtime-smoke.png`, then validates the Apple runtime
artifact. After exporting an iOS IPA, copy or export it under `.manual-qa/`,
run `pnpm run check:apple-ipa-size -- --ipa=.manual-qa/<file>.ipa`, and require
`apple-ios-ipa` in the runtime artifact gate to validate the PRD `< 12MB` IPA
budget with repo-relative, publish-safe evidence. After building or copying a
macOS `ZeroChat.app` under `.manual-qa/`, run
`pnpm run check:apple-macos-app-size -- --app=.manual-qa/<file>.app`; it writes
`.manual-qa/apple-macos-app-size.json`, and reviewers can require
`apple-macos-app` in the runtime artifact gate to validate the PRD `< 15MB`
`.app` budget with repo-relative, publish-safe evidence. `qa:linux` must run on Linux or WSL with
Rust, `pkg-config`, GTK4, libadwaita, Secret Service tooling, Xvfb, xdotool,
ImageMagick, and `dbus-x11`; it writes `.manual-qa/native-prereq-linux.json`,
builds the locked release binary, captures `.manual-qa/linux-runtime-smoke.png`,
then validates the Linux runtime artifact. After building or copying the Linux
release binary under `.manual-qa/`, run
`pnpm run check:linux-release-size -- --binary=.manual-qa/<file>`; it writes
`.manual-qa/linux-release-size.json`, and reviewers can require
`linux-release-binary` in the runtime artifact gate to validate the PRD `< 10MB`
ELF binary budget with repo-relative, publish-safe evidence. These commands still prove only a
nonblank app-window launch; finish the platform visual, sync, file-picker,
secret-store, and destructive-action checklist before release claims.
Then complete the runtime and visual checklist in
[docs/NATIVE_QA_CHECKLIST.md](docs/NATIVE_QA_CHECKLIST.md) before calling that
native platform release-ready.

Additional documents:

- `docs/PLATFORMS.md`
- `docs/NATIVE_QA_CHECKLIST.md`
- `docs/RELEASE_CHECKLIST.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `shared/ai-provider-contract.md`
- `shared/encryption.md`

## Verification

```bash
pnpm run verify
```

This runs the Web build, linting, repository health checks, Worker security
checks, deployment readiness checks, bundle size checks, documentation links,
completion-audit guards, UI accessibility/polish guards, Windows WebView/MSIX
readiness checks, Vitest unit tests, a no-regression coverage budget across all
Web source files, and stricter coverage thresholds for core services,
Provider requests, automatic sync, sync runtime control, Cloudflare/Gist sync,
and high-risk storage modules,
axe-core browser accessibility checks, Lighthouse performance checks with
explicit PRD FCP/TTI thresholds, Skill
performance checks, Cloud sync E2E through the real Worker code with in-memory
KV/R2, Gist sync E2E through a mocked GitHub API, live-drill safety checks, Web
i18n completeness checks, native i18n coverage checks, and native feature
parity checks.
Individual checks are also available:

```bash
pnpm run build
pnpm run lint
pnpm run check:security
pnpm run check:deploy
pnpm run check:bundle
pnpm run check:copy
pnpm run check:docs
pnpm run check:completion-audit
pnpm run check:ui
pnpm run check:axe
pnpm run check:lighthouse
pnpm run check:runtime-artifacts
pnpm run check:browser-smoke
pnpm run check:pwa-offline
pnpm run check:windows-shell
pnpm run check:windows-msix
pnpm run check:unit
pnpm run check:coverage
pnpm run check:skills
pnpm run check:cloud-sync
pnpm run check:gist-sync
pnpm run check:live-sync-drill
pnpm run check:live-sync-release-pass
pnpm run check:live-provider-smoke
pnpm run check:live-provider-full-capability
pnpm run check:linux-fmt
pnpm run check:i18n
pnpm run check:native-i18n
pnpm run check:native-parity
pnpm run check:native-prereqs -- --platform=current
pnpm run check:repo
pnpm run audit:visual
```

For a current-page Web/PWA evidence refresh, run:

```bash
pnpm run qa:web-current
```

When no app is already reachable at the default local target, this command
auto-starts a temporary Vite preview on `http://127.0.0.1:5173/`, runs the
current-page visual/browser evidence, writes the full JSON report under
`.manual-qa/`, prints a short terminal summary, and stops that preview before
exiting. Add `--json` when you want the full report printed to stdout. If you
already have a local app open and want to validate that exact URL instead, run:

```bash
pnpm run qa:web-current -- --url http://127.0.0.1:5173/
```

This preserves a separate current-page visual report under `.manual-qa/`, runs
the browser interaction smoke against the same URL, and records
`.manual-qa/web-current-icon-sync-dom.json` proving the visible app icon and
local cloud-sync entry are still present. The report also stores a Web source
digest, so `pnpm run check:runtime-artifacts` will ask you to rerun current-page
QA after Web source changes.

The live drills are intentionally separate from `verify`: use
`pnpm run drill:live-provider` or `pnpm run drill:live-sync` only with
disposable credentials and the confirmation environment variables documented in
`docs/RELEASE_CHECKLIST.md`. The static safety guards are available as
`pnpm run check:live-provider-smoke` and `pnpm run check:live-sync-drill`;
they do not send provider requests or touch live sync storage. After a
successful disposable live sync drill, `pnpm run check:live-sync-release-pass`
validates that `.manual-qa/live-sync-release-drill.json` is a true
`releaseEvidence: true` report rather than skipped/blocked diagnostic evidence.
For a final local release gate that refuses to continue without that disposable
live-sync proof, run `pnpm run verify:release:live-sync`.
For provider release evidence, `pnpm run check:live-provider-full-capability`
validates `.manual-qa/live-provider-smoke-full-current.json` as a passing
full-capability report. It requires chat, image generation/edit/inpaint, audio
speech plus transcription, embeddings, moderation, and Realtime evidence; a
chat+image-only pass remains useful diagnostic evidence but does not close the
provider release blocker. The full-capability report must be generated within
72 hours of release verification.
For hosted release verification, use the manual
`Live Release Drills` GitHub Actions workflow. It reads disposable provider,
Gist, or Cloudflare values from repository Secrets and still requires the same
script-level confirmations before sending a provider request or deleting remote
sync test data. Live sync reports are uploaded even when a started drill fails,
so reviewers get sanitized stage/error evidence without repository secrets.
Provider API reports follow the same rule: a failed provider smoke can still
upload `live-provider-smoke-report` only after the generated JSON passes the
sanitized runtime-artifact validator; missing-secret preflight failures still
stop without fabricating evidence. The hosted browser UI smoke is gated on that
validated sanitized API report, not on the API smoke exit code, so optional
full-capability API route failures do not suppress independent browser-origin
diagnostics. The hosted UI path uploads `live-provider-ui-smoke-report` only
after the sanitized UI JSON report validates; the screenshot artifact is
secondary and uploads only after the report and PNG validators both pass.
For a passed UI report, top-level `browserOriginProven: true` must accompany
`browserMessageSent: true` and `markerCaptured: true`; nested
`proxyPreflight.browserOriginProven: false` only describes Node-side preflight.
When every provider capability toggle is enabled, the workflow also runs the
strict full-capability provider report gate and uploads a separately named
`live-provider-full-capability-report` artifact at
`.manual-qa/live-provider-smoke-full-current.json` only after that promoted
canonical report validates.

Before a release, run the one-command gate:

```bash
pnpm run verify:release
```

After a disposable live cloud-sync drill has produced release-pass evidence,
run the stricter final variant:

```bash
pnpm run verify:release:live-sync
```

Before claiming every native platform is release-ready, run the stricter
all-platform gate in an environment with the required SDKs/hosts:

```bash
pnpm run verify:all-platforms
```

For a final all-platform release after disposable live cloud-sync release-pass
evidence exists, run the combined strict gate:

```bash
pnpm run verify:all-platforms:live-sync
```

After Windows, Android, Apple, and Linux runtime smoke artifacts have all been
captured on their target hosts, use:

```bash
pnpm run verify:all-platforms:runtime
```

For the strictest local final gate, requiring native prerequisites, native
runtime artifacts, and disposable live cloud-sync release-pass evidence, run:

```bash
pnpm run verify:all-platforms:runtime-live-sync
```

After a real hosted native CI run has produced downloadable artifacts and
`.manual-qa/hosted-native-ci-evidence.json`, use the hosted-artifact variant:

```bash
pnpm run verify:all-platforms:runtime-live-sync-hosted
```

After that same release set also has a passing full-capability provider report,
use the strictest combined gate:

```bash
pnpm run verify:all-platforms:runtime-live-sync-hosted-provider
```

It first runs a strict preflight for every external evidence set requested by
the command: Android/Apple/Windows/Linux build prerequisites, native runtime
artifacts, disposable live-sync release-pass evidence, hosted GitHub Actions
native artifacts, and full-capability provider evidence. The generated
`.manual-qa/native-prereq-all-platforms.json` blocker report is still validated
with `--only-native-prereq-report`; the hosted and provider variants also check
their required reports before the normal release gate can run. If any requested
evidence is missing, the gate prints `Strict release preflight blockers remain`
with every failing evidence category and does not start the slower Web/release
checks. Expected preflight failures are compacted into a release-audit summary,
so reviewers see the missing evidence paths and native prerequisite table
without internal Node stack traces. The same blocked preflight also writes the
publish-safe diagnostic report `.manual-qa/strict-release-preflight.json`; check
it with `pnpm run check:strict-release-preflight` before sharing the blocker
handoff.
That focused validation proves the blocker report is well-formed; it is not
native runtime QA evidence.
When the strict all-platform release gate is expected to remain blocked on the
current machine, use `pnpm run report:strict-release-preflight` instead of
manually interpreting the expected-failure gate. The report command reruns the
same strict preflight, requires the `Strict release preflight blockers remain`
marker, validates the refreshed JSON report, and exits successfully only for a
fresh diagnostic with `releaseEvidence: false`.
To hand off the current blocked state without copying long logs, run
`pnpm run report:release-blockers`. It validates the existing native prereq,
strict preflight, live sync, hosted native CI, and live-provider diagnostic
reports, then writes `.manual-qa/release-blockers-current.json` as a sanitized
six-blocker summary. That summary is a map for the remaining work, not release
evidence. To verify the existing summary without refreshing its timestamp, run
`pnpm run check:release-blockers`.
For the safest one-command local release handoff, run
`pnpm run report:release-diagnostics`. It strips live provider, live sync, and
GitHub credential environment variables before refreshing the current diagnostic
reports, writes `.manual-qa/release-diagnostics-current.json`, and audits that
the broad runtime-artifact gate still fails only on the expected Windows trusted
MSIX host AppX cleanup blocker. A passing diagnostics report is still
`releaseEvidence: false`; it is a current blocker handoff, not release
readiness. To verify that existing summary without refreshing diagnostic report
timestamps or hashes, run `pnpm run check:release-diagnostics`.
After the JSON handoff is current, run `pnpm run report:current-evidence` to
print a sanitized Markdown summary of the exact current hashes, blocker IDs,
and next actions. Run `pnpm run sync:current-evidence` to update the generated
current-evidence blocks in `docs/REQUIREMENTS.md` / `docs/QA_AUDIT.md`, then
use `pnpm run check:current-evidence` to verify that those current hashes and
the current diagnostic timestamp are present without refreshing any source
report.

On Android, the shortest local emulator pass is:

```bash
pnpm run qa:android
```

It checks Android prerequisites, builds the debug APK, reuses or starts a local
AVD, waits for Android to finish booting, runs the
Settings/language UI smoke and the Cloudflare encrypted-sync smoke, captures
screenshots under `.manual-qa/`, refreshes the Android contact sheet, then
stops the emulator and adb server it started. It never selects an attached
physical device implicitly; set `ANDROID_SERIAL` or pass
`-- --allow-physical-device` to authorize one. Pass `-- --keep-emulator` to
leave the emulator open for manual tapping, or `-- --keep-adb-server` if you are
sharing an adb session with another device tool. If the screenshots already
exist and only the overview needs rebuilding, run
`pnpm run check:android-contact-sheet`. After a fresh `build:android:debug`
or release-size pass, use `pnpm run qa:android:current` to run the same emulator
QA against the current debug APK without rebuilding first; budget roughly 25-30
minutes for the full UI plus Cloudflare sync pass on slower local machines. If
UI smoke is current but Cloudflare smoke must be recovered, run
`pnpm run qa:android:refresh-cloud`; it rejects stale APK hashes and cross-device
evidence before rerunning only the sync smoke.

For the PRD Android package-size budget, build and check the unsigned release
APK separately:

```bash
pnpm run check:android-lint
pnpm run build:android:release
pnpm run check:android-release-size
```

The release build keeps R8 minification and Android resource shrinking enabled;
the size check enforces the `< 8MB` APK budget and prints byte/hash evidence for
review.

On Windows, the shortest local native package path is also pnpm-first:

```powershell
pnpm run qa:windows
```

That command runs the WebView runtime smoke, rebuilds the MSIX-ready Release
output, packages the current app, then runs the non-mutating MSIX install QA
dry run. The individual steps remain available when you need to stop between
them:

```powershell
pnpm run qa:windows-webview
pnpm run build:windows:msix
pnpm run package:windows:msix
pnpm run qa:windows-msix
```

The WebView QA command builds the unpackaged Release app, opens it, captures
`.manual-qa\windows-webview-runtime-smoke.png`, checks that the screenshot is
not blank, records the current `dist\` and captured `web\` SHA-256 manifests,
closes the app, then runs the shared runtime-artifact gate with
`--require-runtime-artifact=windows`. The MSIX build helper verifies the copied WebView `web\`
bundle against the current `dist\` output, and the trusted MSIX QA report also
records package byte/SHA-256 evidence so stale screenshots or packages cannot
silently stand in for the current build. The default MSIX QA helper starts as a
non-mutating dry run.

If the elevated trusted MSIX install/update path is blocked by the local
Windows AppX deployment service, the trusted helper writes
`.manual-qa\windows-msix-current-trusted-install-update-qa.failure.json` with
the AppX event summary and cleanup proof. `pnpm run check:runtime-artifacts`
uses the newest trusted-MSIX report as the current state: a newer failure keeps
the gate red, while a newer passing
`.manual-qa\windows-msix-current-trusted-install-update-qa.json` supersedes
older diagnostic failure history. The current local evidence is a
diagnostic-only host AppX failure, not a passing trusted report:
`windows-appx-deployment-deleted-package-cleanup-access-denied` blocks the
latest trusted install/update/uninstall run before ZeroChat can produce release
evidence. Use a fresh disposable Windows profile/VM or repair the external AppX
cleanup state, then rerun `pnpm run qa:windows-msix-trusted:elevated`; the
wrapper refreshes host preflight, runs trusted install/update/uninstall QA,
validates `pnpm run check:windows-msix-trusted-report`, validates
`pnpm run check:runtime-artifacts`, and finishes with
`pnpm run check:local-cleanup`.

The full local release gate above runs `verify`, the real-browser smoke test,
the PWA offline smoke, the visual audit, and a post-audit artifact validation
pass. The CI and GitHub Pages clean-checkout Web jobs run `pnpm run
verify:web-local` so they refresh Web/PWA evidence without depending on ignored
local `.manual-qa/` release diagnostics.
For a visual pass by itself, run:

```bash
pnpm run audit:visual
```

This launches the Web app in Chrome/Chromium, captures desktop, narrow-window,
mobile, compact mobile, settings, Skills, RTL, sidebar, image
generation/edit/inpaint, and model-menu screenshots into `.visual-audit/`, and
fails on browser runtime errors. Open
`.visual-audit/visual-audit-gallery.html` to review the screenshot set by eye
before release. The run also writes `visual-audit-manifest.json` with the
expected screenshot list; `pnpm run verify:release` validates that manifest, the
118 listed PNGs, the gallery, and the contact sheet immediately after the
screenshots are regenerated. The folder is ignored by git.

Pull requests and pushes to `main` or `master` run the clean-checkout
`pnpm run verify:web-local` Web/PWA gate in CI. The visual audit screenshots are
uploaded as a workflow artifact for review; the hosted Web/PWA evidence jobs
use a 35-minute timeout so browser and visual QA have room to finish without
hanging indefinitely. CI also builds the Windows Release WebView2
shell on `windows-latest`, packages the current output as an unsigned MSIX, runs
the non-mutating MSIX install-readiness helper, and builds both Android debug
and release APKs on Ubuntu with SDK 36 before running the Android release-size
gate and uploading native artifacts. A manual
`Windows Signed MSIX` workflow can sign from repository Secrets, run the same
non-installing inspection, verify the temporary PFX was removed, and upload a
signed MSIX artifact with a missing-artifact hard failure. A Linux CI job
installs GTK4/libadwaita development packages, runs a
locked `cargo check`, builds the release binary, launches the GTK app under
Xvfb, captures the app window screenshot plus metadata, and uploads those
runtime artifacts for inspection. A macOS CI job runs the Apple native
preflight, builds the SwiftPM `ZeroChatAppleApp` target, builds the checked-in
Xcode shared scheme without signing credentials, launches the macOS app, and
uploads the app-window smoke screenshot plus metadata; iOS/iPadOS simulator or
device visual QA remains a required Apple release task.
After the first real hosted native CI run succeeds, prefer the workflow-uploaded
`hosted-native-ci-evidence` artifact. The CI aggregation job downloads the
native artifacts into `.manual-qa/hosted-native-ci/`, generates
`.manual-qa/hosted-native-ci-evidence.json` with the repository slug, GitHub
Actions run URL, run id, attempt, head SHA, successful native job conclusions,
each job/artifact's matching run id and attempt, and each downloaded file's
byte/SHA-256 evidence under a real path contained by
`.manual-qa/hosted-native-ci/`, then validates it before upload.

To reproduce or inspect that report locally, download those native artifacts
into `.manual-qa/hosted-native-ci/` and rerun the same generator/checker:

```bash
gh run view <run-id> --repo <owner/name> --json attempt,conclusion,databaseId,headSha,jobs,status,url,workflowName > .manual-qa/hosted-native-ci-run.json
gh run download <run-id> --repo <owner/name> --dir .manual-qa/hosted-native-ci
pnpm run report:hosted-native-ci -- --run-metadata=.manual-qa/hosted-native-ci-run.json
pnpm run report:hosted-native-ci -- --repository=<owner/name> --run-id=<run-id> --run-attempt=<attempt> --head-sha=<head-sha> --jobs-success
```

Prefer the `--run-metadata` form; it rejects the metadata unless the workflow is
`CI`, the run is `completed`/`success`, and every expected native job completed
successfully. The checker also compares the report head SHA with the current
Git HEAD from `git rev-parse HEAD`; after any source change, rerun hosted native
CI for the current commit instead of reusing older artifacts. Use the explicit
`--repository`/`--run-id` form, or
`--job=<id>:success` for each expected native job instead of `--jobs-success`,
when copying job conclusions one by one. Then run
`node scripts/hosted-native-ci-evidence-check.mjs --require`. The normal
`pnpm run verify:release` path also runs the same checker in non-required mode,
so local work stays CI-schema-aware without pretending a hosted run has already
passed. After native runtime artifacts, disposable live sync release-pass
evidence, hosted native CI evidence, and a passing full-capability provider
report all exist, `pnpm run verify:all-platforms:runtime-live-sync-hosted-provider`
is the combined all-platform release gate that audits all required external
evidence first and refuses to continue without every evidence set.
The GitHub Pages deployment workflow also runs the clean-checkout
`pnpm run verify:web-local` gate and uploads visual screenshots before
publishing `dist`, so broken docs, UI
accessibility regressions, responsive layout regressions, missing translations,
deployment regressions, bundle growth, native parity drift, Windows
shell/package drift, Android build drift, Linux dependency drift, Apple SwiftUI
source drift, or accidental local/build artifacts are caught before release.
