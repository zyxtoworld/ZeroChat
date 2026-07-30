# Native Applications

ZeroChat keeps native clients separated by platform:

- `windows/`: C++ / WinUI 3
- `android/`: Kotlin / Jetpack Compose
- `apple/`: Swift / SwiftUI for iOS, iPadOS, and macOS
- `linux/`: Rust / GTK4/libadwaita

All clients must remain compatible with `../shared/snapshot.schema.json`, `../shared/sync-vault.schema.json`, `../shared/encryption.md`, and `../shared/ai-provider-contract.md`.
Before opening a platform IDE or running platform build commands, run
`pnpm run check:native-prereqs -- --platform=<platform>` from the repository
root so missing SDKs, project files, and packaging tools are caught early.
Before a native client is called release-ready, complete the runtime and visual
checks in [`../docs/NATIVE_QA_CHECKLIST.md`](../docs/NATIVE_QA_CHECKLIST.md) on
the target SDK, simulator, emulator, or device. Android has a one-command local
emulator pass via `pnpm run qa:android`; platform-specific final release still
requires the manual checks named in the checklist. Apple and Linux target hosts
now have equivalent launch-smoke entry points via `pnpm run qa:apple` and
`pnpm run qa:linux`; those commands generate runtime screenshot/metadata
artifacts. The Apple command also builds the shared Xcode scheme for
`generic/platform=iOS Simulator`, but still does not replace the per-platform
visual, sync, file-picker, secret-store, and destructive-action checks. After
exporting an iOS IPA on an Apple target host, run
`pnpm run check:apple-ipa-size -- --ipa=.manual-qa/<file>.ipa` and require
`apple-ios-ipa` in `scripts/runtime-smoke-artifact-check.mjs` to validate the
PRD package-size budget with repo-relative, publish-safe evidence before
release claims. After building or copying a macOS `ZeroChat.app` under
`.manual-qa/`, run
`pnpm run check:apple-macos-app-size -- --app=.manual-qa/<file>.app` and require
`apple-macos-app` in the same runtime artifact gate to validate the PRD `< 15MB`
`.app` budget without exposing local absolute paths. After building or copying
the Linux release binary under `.manual-qa/`, run
`pnpm run check:linux-release-size -- --binary=.manual-qa/<file>` and require
`linux-release-binary` to validate the PRD `< 10MB` ELF binary budget without
claiming Linux GTK runtime QA.

Native clients may use platform-specific databases, secure credential stores, and user-interface conventions. During synchronization, they must upload only end-to-end encrypted data: GitHub Gist and legacy snapshot sync use `zerochat.encryptedSnapshot` vaults, while Cloudflare incremental sync uses `zerochat.encryptedObject` manifest, message-chunk, Skill-chunk, and image-attachment-chunk objects. Plaintext snapshots, manifests, message chunks, Skill chunks, and attachment chunks must not be uploaded to remote storage.

Snapshot-mode native sync clients must check `/sync/head` before writing `/snapshot`. If Cloudflare incremental data already exists, they must refuse the snapshot write instead of creating a split remote state; users can clear cloud data or use an incremental-sync native build.

Incremental native sync clients must read and write the same `/sync/head` and `/sync/object/{key}` protocol as the Web/PWA, including manifest objects, message chunks, Skill content chunks, stale-object cleanup, and gzip object read compatibility.

First sync conflicts must also be handled consistently. A new empty device may pull cloud data immediately. A device that already has local chats, providers, settings, or Skills must ask before replacing local data with cloud data, uploading this device over the cloud copy, or merging both sides. The merge option happens in the decrypted app-data layer, then uploads the merged encrypted snapshot or incremental object set; sync callers pass both `hasCompletedSync` and `hasLocalUserContent` into the platform sync client so a freshly installed phone is not mistaken for a local/cloud conflict.

The shared data model already includes image-generation attachment fields: `ProviderConfig.imageModel` and `ChatMessage.attachments`. Native chat interfaces must render these image attachments and reuse the `/images/generations` request contract defined in `shared/ai-provider-contract.md` for image generation.

## Native Parity Baseline

Except for the current Windows shared-PWA shell, native clients should not
become unplanned web shells. Each platform keeps the stack that best matches its
OS:

| Platform | Language | UI | Runtime goal |
| --- | --- | --- | --- |
| Windows | C++ / C++/WinRT | WinUI 3 | Small packaged app, native windowing, low idle overhead |
| Android | Kotlin | Jetpack Compose | Fast startup, proper IME handling, low battery overhead |
| iOS / iPadOS / macOS | Swift | SwiftUI | Native Keychain, adaptive Apple layouts, low memory use |
| Linux | Rust | GTK4/libadwaita | Native desktop integration, low resident memory |

The core client layer for every native platform must stay aligned with the Web/PWA feature contract:

| Feature contract | Windows | Android | Apple | Linux |
| --- | --- | --- | --- | --- |
| Remote chat APIs | C++/WinRT `AiClient` | Kotlin `AiClient` | Swift `AiClient` | Rust `AiClient` |
| Provider model list retrieval | supported in core | supported in core | supported in core | supported in core |
| Worker proxy action headers | supported in core | supported in core | supported in core | supported in core |
| Client-side direct request mode | supported in core | supported in core | supported in core | supported in core |
| Image generation | supported in core | supported in core | supported in core | supported in core |
| Image editing / inpainting API | supported in core | supported in core | supported in core | supported in core |
| Cloudflare clear remote data | core support; Web/PWA UI verified | core support; device QA required | core support; simulator/device QA required | core support; Linux runtime QA required |
| Encrypted vault/object schema | shared PWA UI; native structs in source | shared model data classes | shared model structs | shared model structs |

Native UI screens now expose the same main workflow surface as the Web/PWA:

- conversation list, new chat, delete conversation, and message-level edit/regenerate/delete controls;
- merged provider/model chooser that only uses enabled providers and configured models;
- text chat plus text-to-image, image editing, and inpainting entry points;
- six settings categories: Appearance, AI providers, Models, Skills, Sync, and Data;
- AI provider options for OpenAI Responses API, client-side direct requests, Worker proxy requests, and model-list connectivity checks;
- provider key storage in each platform's secure store and Cloudflare access derived from the data encryption password;
- model fetching, manual model entry, reordering, and text/image model selection;
- Local/Gist/Cloudflare sync mode explanations, Skill management surfaces, data encryption password save/reset controls with high-risk change warnings, local reset, and clear-cloud entry points that must remain scoped by platform runtime QA.

Android, Apple, and Linux source now include encrypted native Gist sync in the
same Sync settings flow as Cloudflare: each path keeps the GitHub token in the
platform secret store, blocks missing token/passphrase before network requests,
participates in manual and automatic sync, and supports clear-cloud for the
selected Gist file. Native Gist runtime proof and Apple/Linux target-device sync
proof still require disposable target runs before release claims. Source parity
is not a substitute for target runtime and visual QA.

User Skill upload, editing, deletion, chunk storage, and stale-cloud-object cleanup are fully implemented and visually QA'd in the Web/PWA surface. Native clients now expose Skill management surfaces in source and preserve the shared `skills`, `skillSettings`, `contentRef`, and `contentPreview` data contract during sync so cloud data is not dropped. Android has a repeatable emulator UI smoke for Skill add/edit/save/delete, while Apple and Linux still need target runtime proof. Do not advertise native Skill editing as release-complete until each target platform has its own device-level runtime QA.

Cloudflare clear-remote-data support is a shared protocol/core requirement, not by itself proof that a native build is release-complete. Keep native clear-cloud copy and docs honest until a disposable platform run proves upload, restore, clear, and post-clear readback on the target OS.

The Web/PWA remains the reference for the most polished import/export backup
workflow and for continuous browser QA. Native clients must keep improving from
this shared parity baseline. Windows is the deliberate exception for now: it
uses WebView2 so the visible desktop UI stays aligned with the most-tested PWA
surface while Windows-specific native services and packaging mature.
