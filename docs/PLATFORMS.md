# Platform Implementation Details

ZeroChat shares one data protocol, encryption protocol, and AI provider request
contract across platforms. Android, Apple, and Linux use native UI stacks.
Windows currently uses a lightweight WinUI 3 host with WebView2 for the visible
PWA UI so UI, i18n, Skill management, sync dialogs, and responsive layout stay
identical to the most-tested Web/PWA surface while native Windows services and
MSIX packaging are completed.

## Current Feature Parity Target

The Web/PWA is still the most polished user interface, but native clients now expose the same main workflow surface and share the same baseline contract:

| Web feature | Native core requirement |
| --- | --- |
| Remote chat through OpenAI-compatible, OpenAI Responses, and Anthropic APIs | All native AI clients keep the same provider kinds and endpoint mapping. |
| User-managed third-party relay and Worker proxy | Native clients send the derived access key, normalized upstream Base URL, fixed provider kind, and action name; mutable provider ids and localized display names stay local. |
| Client-side direct request mode | All clients honor `ProviderConfig.clientRequestMode` by ignoring provider and auto sync Worker proxies for AI calls. |
| Fetch models from the configured provider | Native AI clients expose model-list methods and parse `data[]`, `models[]`, `result[]`, or array-root responses. |
| Capability-specific model defaults in the same provider model list | Native data models include `model`, `imageModel`, `audioSpeechModel`, `audioTranscriptionModel`, `embeddingModel`, `moderationModel`, `realtimeModel`, `models`, and `capabilities`. |
| Image generation | Native AI clients implement `/images/generations` with one `b64_json` result by default; Web/Worker also support the shared Responses `image_generation` fallback described in `shared/ai-provider-contract.md`. |
| Image editing and inpainting | Native AI clients implement `/images/edits` multipart uploads with optional mask files; Web/Worker can fall back to Responses image editing only for unmasked source-image edits. |
| User Skills | Native data models preserve `skills` and `skillSettings` during sync. Android/Apple Skill management surfaces exist in source, Windows uses the shared PWA Skill UI through WebView2, and Linux now has source-wired GTK Skill settings, paste add, file import, edit, toggle, and delete controls. Linux still needs target GTK runtime and visual QA before release claims. |
| Clear remote sync data | Native sync clients keep core `DELETE /sync/clear` support and legacy fallbacks; do not call the native runtime path release-verified until platform QA confirms clear plus post-clear readback with disposable data. |
| Privacy and remote URL safety | Native clients reject credentialed, HTTP, localhost, private network, LAN, documentation, benchmarking, multicast, and reserved Base URLs for AI providers. |

Native UI parity should be added on top of these core methods. Windows is the
current exception: it intentionally uses WebView2 to avoid shipping a divergent
or partially wired desktop UI while the native Windows bridge and packaging work
continues.
The release gate for claiming native parity is the runtime and visual checklist
in [NATIVE_QA_CHECKLIST.md](NATIVE_QA_CHECKLIST.md), completed on real target
SDKs, simulators, emulators, or devices.

## Native UI Baseline

Each native app should keep these screens available without requiring the Web/PWA:

- Chat list, new chat, delete chat, merged provider/model picker, user messages right aligned, AI messages left aligned, OS date/time formatting, user edit-and-resend, AI regenerate, and delete message.
- Chat composer with chat/image mode switching. Image mode includes text-to-image, image edit, and inpainting controls, plus a generated-image download/open action where the platform supports it.
- Settings categories locked to the same six concepts as the Web/PWA: Appearance, AI providers, Models, Skills, Sync, and Data.
- Appearance settings for theme, system-aware language selection, and compact display.
- AI provider settings for enabled state, name, Base URL, optional Worker/proxy URL, API key behavior, and API key.
- Model settings for provider model-list fetching, manual entry, reordering, deleting, default chat model, and image model.
- Sync settings for Local/Gist/Cloudflare selection, plain-language tradeoffs, Gist ID/file, Worker URL, GitHub Token, and Cloudflare access derived from the data encryption password. Android, Apple, and Linux now read and write the shared Cloudflare incremental manifest/message-chunk/Skill-chunk protocol, with legacy snapshot fallback only for older Workers. Their first-sync protection treats user-added local providers as real local content, and provider-key saves bump provider/snapshot timestamps so encrypted secret changes are queued for sync instead of waiting for an unrelated edit. Android, Apple, and Linux now also include native encrypted Gist upload/restore through the same Sync settings flow; tokens stay in platform secret stores, manual/automatic sync follows the selected mode, and clear-cloud remains scoped to the configured Gist file. Source parity does not equal release proof: native Gist target runtime QA, Apple/Linux target sync/visual QA, and disposable live cloud-sync release drills are still required before release claims. Windows uses the shared PWA sync UI through WebView2.
- Data settings for data encryption password, explicit save/reset sync password controls, encrypted backup import/export, reset local data, and clear cloud data. Android, Apple, and Linux source now use trusted native file pickers plus destructive restore confirmation for encrypted backups; each still needs target runtime and visual QA before release-complete native backup claims. Windows uses the shared PWA backup UI through WebView2.
- Skill settings are complete and visually tested in the Web/PWA today. Android
  and Apple include native Skill management surfaces in source, Windows exposes
  the same tested PWA Skill UI through WebView2, and Linux source now wires
  GTK Skill settings, paste add, file import, edit, toggle, and delete to the
  shared snapshot store. Linux still needs real GTK runtime QA before it is
  marketed as release-complete.
- Default provider preset names are UI labels, not durable user copy. Web/PWA,
  Android, and Apple relocalize known default relay names when the language
  changes, while preserving names the user has deliberately edited.

Android and Apple currently wire more of the interaction flow directly to their
native state stores. Windows has a buildable WinUI/WebView2 shell around the
shared PWA surface plus native networking/storage core in source. Linux has the
full native screen surface plus shared networking/storage core, with the highest
impact chat, image, provider/model, Skill, sync, and data controls now wired in
source; target GTK runtime QA remains the release blocker.

## Windows

- Language: C++
- UI: WinUI 3 / C++/WinRT host with WebView2 shared PWA surface
- Networking: Windows.Web.Http
- Local data: LocalFolder JSON initially; SQLite recommended for production
- Secrets: Windows Credential Locker
- Packaging: MSIX

Windows source files and the checked-in `.sln`/`.vcxproj` are present. Debug and
Release builds open the shared PWA UI through WebView2 from the copied `dist`
bundle. The repository also includes an MSIX manifest, package visual assets,
and a `makeappx`-based local packaging script that can optionally sign with a
provided PFX for QA. Local trusted-certificate install/update/uninstall QA now
passes with the guarded disposable-certificate flow. The remaining Windows
product work is deciding which native Credential Locker, LocalFolder, and HTTP
services should replace browser storage/networking behind the WebView bridge.

Implementation priority:

1. WebView bridge decisions for Credential Locker, LocalFolder persistence, file pickers, and native HTTP
2. System tray, shortcuts, notifications, and Windows-specific window controls
3. Optional native replacement screens only after they can match the shared PWA UI and pass visual QA

## Android

- Language: Kotlin
- UI: Jetpack Compose
- Networking: Ktor Client
- Local data: FilesDir JSON snapshot initially; Room/DataStore recommended for production
- Secrets: Android Keystore + EncryptedSharedPreferences
- Sync encryption: Android now has a shared-protocol PBKDF2-HMAC-SHA-256 +
  AES-256-GCM vault/object encoder/decoder and a Cloudflare incremental
  auto-sync coordinator that uploads encrypted manifests, message chunks, and
  Skill chunks after local saves when Cloudflare mode, Worker URL, and data
  password are configured. User-added providers are included in first-sync
  local-content detection, and saving provider keys updates provider metadata
  before queuing encrypted sync. It falls back to the legacy encrypted snapshot path
  only when the Worker does not expose incremental endpoints. `pnpm run qa:android` now builds the APK,
  auto-starts a local AVD when needed, and runs the UI plus encrypted snapshot
  sync smokes. Android still needs live disposable Worker E2E,
  foreground/reconnect/physical-device QA, and disposable live Worker/Gist
  parity before Android sync can be called release-complete.
- Packaging: APK/AAB

Implementation priority:

1. One-handed chat interface
2. Input-method handling and long-text editing
3. Provider, model selector, API key, and sync configuration
4. Image generation, image editing, and inpainting controls
5. Foreground/reconnect sync QA, Gist parity, and disposable deployed Cloudflare cleanup parity

## iOS/macOS

- Language: Swift
- UI: SwiftUI
- Networking: URLSession
- Local data: Application Support JSON initially; SwiftData or SQLite recommended for production
- Secrets: Keychain
- Sync encryption: shared PBKDF2-HMAC-SHA-256 + AES-256-GCM vault/object protocol; Cloudflare incremental auto-sync is source-wired with manifest/message/Skill object read-write, gzip object read compatibility, stale object cleanup, a debounce, Keychain-backed provider secrets, provider-key change timestamping plus queued encrypted sync, first-sync conflict protection that counts user-added providers as local content, and a wrong-password guard that decrypts existing cloud data before upload. Simulator/device sync and visual QA are still required before Apple sync can be marketed as release-complete.
- Target runtime launch smoke: run `pnpm run qa:apple` on macOS with Xcode/Swift
  to produce `.manual-qa/apple-runtime-smoke.png` and `.json`; this is only the
  launch/screenshot artifact gate and does not replace simulator/device sync,
  Keychain, file-picker, signing, archive, or notarization QA.
- Packaging: Xcode Archive

Implementation priority:

1. Adaptive iPhone, iPad, and macOS layouts
2. Keychain secret storage
3. Provider/model management and image generation/editing UI
4. Multi-window behavior and share extensions
5. Full compatibility with the Web/PWA snapshot, vault, and AI provider contract

## Linux

- Language: Rust
- UI: GTK4/libadwaita
- Networking: reqwest
- Local data: JSON initially; SQLite recommended for production
- Secrets: Secret Service
- Sync encryption: shared PBKDF2-HMAC-SHA-256 + AES-256-GCM vault/object protocol; Cloudflare incremental auto-sync is source-wired with manifest/message/Skill object read-write, gzip object read compatibility, stale object cleanup, a debounce, derived access key, provider secrets inside the encrypted vault, provider-key change timestamping plus queued encrypted sync, first-sync conflict protection that counts user-added providers as local content, and a wrong-password guard that decrypts existing cloud data before upload. Linux still needs target runtime QA for Secret Service, file pickers, and Cloudflare sync before release claims.
- Target runtime launch smoke: run `pnpm run qa:linux` on Linux/WSL with GTK4,
  libadwaita, Secret Service tooling, Xvfb, xdotool, ImageMagick, and `dbus-x11`
  to produce `.manual-qa/linux-runtime-smoke.png` and `.json`; this is only the
  launch/screenshot artifact gate and does not replace interactive desktop,
  Secret Service, file-picker, sync, Flatpak, or AppImage QA.
- Appearance state: the GTK language, theme, and compact-display controls now
  read from and save to the shared `snapshot.v1.json` store before rebuilding
  the visible shell. Target Linux runtime QA is still required.
- Chat state: the GTK chat page now reads the active conversation from
  `snapshot.v1.json`; sends create/update the active conversation, append a
  pending assistant turn, inject only pinned/relevant Skill snippets within the
  context budget, call the native `AiClient` on a background thread, and save the
  completed response through the shared `conversations` path. Persisted message
  rows include a local delete action that removes only the selected message and
  queues the normal save/sync path. User edit-and-resend opens a native edit
  dialog, rewrites the selected user message, drops stale later replies, appends
  the local assistant handoff, and queues the same save/sync path. AI regenerate
  requires an earlier user prompt, replaces the selected assistant row with the
  local handoff, trims stale later turns, and queues the same save/sync path.
  Target Linux runtime QA is still required.
- Image state: the GTK composer now switches between chat and image mode with
  live toggles. Text-to-image requests call the native `AiClient.generate_image`
  path; edit and inpaint use native file picking for source/mask images and call
  `AiClient.edit_image`. Source, mask, and generated image attachments are saved
  into the shared conversation snapshot, and generated image rows expose
  download/open actions. Target Linux runtime QA is still required for file
  picker behavior, provider responses, and desktop opener integration.
- Conversation navigation: the GTK sidebar now creates empty local
  conversations, selecting a row updates `preferences.activeConversationId`,
  and the header provider/model dropdown is built from the snapshot provider
  records instead of static presets. Selecting a provider/model writes it to
  the active conversation, creating an empty local conversation first if needed.
  Conversation deletion uses a native confirmation dialog and still needs target
  runtime QA before release claims.
- Provider settings state: the GTK provider settings page now saves provider
  name, Base URL, optional proxy URL, direct-request mode, and enabled state to
  `snapshot.v1.json`. Users can add an OpenAI-compatible custom provider and
  delete providers while keeping at least one fallback provider; conversations
  that referenced a deleted provider are moved to the fallback. Provider keys
  now save through Linux Secret Service via `secret-tool` when it is available,
  fall back to session memory when it is not, and only travel inside the
  encrypted vault when sync is configured. The connection check now reads only
  the provider model list through `AiClient` on a background thread. Final
  Linux runtime QA still needs a desktop session with an unlocked Secret
  Service.
- Model settings state: manual model lists, the default chat model, and the
  image model now save to the same provider records. Provider model fetching now
  uses the same native `AiClient` model-list path, stores the returned list, and
  keeps GTK responsive while the request is running. Target Linux runtime QA is
  still required before release claims.
- Skill settings state: GTK now persists global auto-match, context budget, and
  max automatic Skill count. Users can paste a Skill, import a local text/Markdown
  or JSON file, edit existing Skill names/content, toggle enabled/fixed/auto,
  and delete a Skill through `snapshot.v1.json`. Target Linux runtime and visual
  QA are still required because this Windows host cannot launch the GTK app.
- Sync settings state: mode selection, Gist ID/file, and Cloudflare Worker URL
  now save to the same snapshot store. Local GTK saves now enqueue the Linux
  cloud auto-sync coordinator after the local JSON write, and
  `SnapshotStore` serializes foreground and background writes. Data password
  save/reset now uses the same Secret Service-backed Linux secret store with a
  session-memory fallback, derives the Cloudflare access key, and never writes
  the password to `snapshot.v1.json`. GitHub Token now saves through Secret
  Service with session-memory fallback, remains local to the device, and is not
  written to `snapshot.v1.json`. The GTK Gist description now says Gist syncs
  encrypted Linux data too, while still steering image-heavy or very large
  histories toward Cloudflare and requiring target runtime proof before release
  claims.
- Data settings state: Reset local data now uses a GTK warning confirmation and
  clears the local snapshot plus provider/data-password secret material before
  returning to the default local state. Cloudflare clear-cloud now validates
  Cloudflare mode, Worker URL, and the saved data password, then shows a destructive GTK
  confirmation and runs the remote clear on a background thread without saving
  local data afterward. Encrypted backup import/export uses GTK file choosers,
  the shared vault protocol, and a destructive restore confirmation. These Data
  screen paths still need real Linux runtime/readback QA before release claims.
- Packaging: Flatpak/AppImage. The source tree now includes the
  `app.zerochat.client` desktop entry, AppStream metainfo, GNOME 50 Flatpak
  manifest, AppImage AppDir/linuxdeploy/appimagetool packaging script, hicolor
  scalable/symbolic SVG icons, and the GTK window binds the same icon name;
  target Linux install/runtime QA is still required before claiming desktop
  integration complete.

Implementation priority:

1. Low-memory resident behavior
2. Wayland and X11 compatibility
3. Provider/model management and image generation/editing UI
4. GNOME and KDE desktop integration
5. Flatpak/AppImage target-host packaging QA against the checked-in manifest

## Web/PWA

- Language: TypeScript
- UI: React API on Preact compat
- Local data: Encrypted IndexedDB records
- Secrets: Non-exportable Web Crypto AES-GCM local key; data encryption password stored only for the browser session
- Sync encryption: Web Crypto API PBKDF2 + AES-GCM
- Deployment: Cloudflare Pages or any static hosting service

The Web/PWA is currently the most complete implementation and the lowest-cost self-hosted option. Native clients must not diverge from the shared protocol.
