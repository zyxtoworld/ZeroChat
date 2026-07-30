# ZeroChat for Apple Platforms

Stack: Swift + SwiftUI.

Supported targets:

- iOS
- iPadOS
- macOS

Rationale:

- Swift and SwiftUI are the primary Apple platform language and UI framework.
- SwiftUI supports adaptive iPhone, iPad, and macOS layouts, dark mode, dynamic type, and multi-window workflows.
- Keychain, URLSession, and SwiftData provide native platform capabilities for secrets, networking, and local persistence.

## Project Setup

The repository includes `Package.swift` for the shared `ZeroChatCore` Swift
package plus a SwiftPM `ZeroChatAppleApp` executable target that compiles the
SwiftUI sources under `App/` on macOS. On a Mac with Xcode and the Swift
toolchain installed, first run the local preflight from the repository root:

```bash
pnpm run check:native-prereqs -- --platform=apple
```

For the repeatable macOS runtime-smoke pass from the repository root, prefer:

```bash
pnpm run qa:apple
```

It writes `.manual-qa/native-prereq-apple.json`, compiles the SwiftPM
`ZeroChatAppleApp` product, builds the checked-in Xcode shared `ZeroChat`
scheme for macOS into `.manual-qa/apple-derived-data`, also builds the same
scheme for `generic/platform=iOS Simulator` into
`.manual-qa/apple-ios-simulator-derived-data`, launches the built macOS app,
captures `.manual-qa/apple-runtime-smoke.png`, writes
`.manual-qa/apple-runtime-smoke.json`, and validates both the preflight and
runtime smoke artifacts. This command must run on macOS with Xcode/Swift
available; it still does not replace iOS/iPad simulator visual review,
physical-device, archive, signing, notarization, sync, file-picker, Keychain,
or destructive action QA.

Then validate the package and SwiftUI source compile path:

```bash
cd apps/apple
swift build --product ZeroChatAppleApp
```

This SwiftPM executable is a package-level compile check for the checked-in
SwiftUI app source. The repository also includes
`ZeroChat.xcodeproj`, a shared `ZeroChat` scheme, and a multiplatform app
target with these production identifiers:

```text
Product Name: ZeroChat
Organization Identifier: app.zerochat
Bundle Identifier: app.zerochat.client
Interface: SwiftUI
Language: Swift
```

Open `ZeroChat.xcodeproj` in Xcode, or run the shared scheme from this folder:

```bash
xcodebuild -project ZeroChat.xcodeproj -scheme ZeroChat -destination 'platform=macOS' -derivedDataPath ../../.manual-qa/apple-derived-data CODE_SIGNING_ALLOWED=NO build
xcodebuild -project ZeroChat.xcodeproj -scheme ZeroChat -destination 'generic/platform=iOS Simulator' -derivedDataPath ../../.manual-qa/apple-ios-simulator-derived-data CODE_SIGNING_ALLOWED=NO build
```

From the repository root, launch the built macOS app and capture the repeatable
runtime smoke screenshot:

```bash
bash scripts/apple-runtime-smoke.sh .manual-qa/apple-derived-data/Build/Products/Debug/ZeroChat.app
```

Review `.manual-qa/apple-runtime-smoke.png` by eye. The smoke only proves the
macOS app bundle opens and paints a nonblank window; it does not replace the
iOS simulator, iPad simulator, physical-device, signing, archive, or notarized
macOS QA passes.

For focused macOS app-bundle package-size evidence, keep the checked `.app`
under `.manual-qa/` and run:

```bash
pnpm run check:apple-macos-app-size -- --app=.manual-qa/<file>.app
node scripts/runtime-smoke-artifact-check.mjs --require-runtime-artifact=apple-macos-app
```

The size check writes `.manual-qa/apple-macos-app-size.json`, records the
bundle manifest, `Contents/Info.plist`, and `Contents/MacOS/ZeroChat` with
repo-relative paths, marks the report `safeToPublish`, and enforces the PRD
`< 15MB` macOS `.app` budget. It is package-size evidence only, not a signing,
notarization, sync, Keychain, file-picker, or destructive-action pass.

After exporting an iOS IPA from Xcode, copy or export it under `.manual-qa/`,
then validate the PRD package-size budget from the repository root:

```bash
pnpm run check:apple-ipa-size -- --ipa=.manual-qa/<file>.ipa
node scripts/runtime-smoke-artifact-check.mjs --require-runtime-artifact=apple-ios-ipa
```

The size check writes `.manual-qa/apple-ios-ipa-size.json`, records IPA
byte/SHA-256 evidence with a repo-relative path, marks the report
`safeToPublish`, verifies `Payload/*.app/Info.plist`, and enforces the PRD
`< 12MB` IPA budget. It does not replace signing, TestFlight/App Store,
simulator/device, Keychain, sync, or destructive-action QA.

Then run the iOS simulator, iPad simulator, and macOS target before calling
Apple QA complete. If `swift` or `xcodebuild` is missing, the Apple runtime and
visual QA is blocked rather than release-ready.

## Requirements

- `ZeroChatCore` must remain compatible with the shared snapshot, vault, encrypted object, and AI provider contract files under `shared/`.
- Provider types must support `openai-compatible`, `openai-responses`, and `anthropic`.
- API keys are stored in Keychain and synchronized only inside the end-to-end encrypted vault.
- AI Base URLs must be remote HTTPS URLs. HTTP, localhost, private network, and LAN addresses are rejected.
- AI, Cloudflare, and Gist URLSession tasks must use the credential-bound redirect-rejecting wrapper before attaching API keys or sync credentials; configure the final trusted endpoint directly.
- The sync URLSession wrapper must cap both request inactivity and the full resource transfer at 60 seconds so headers and streamed bodies cannot hold synchronization indefinitely.
- Cloudflare and Gist responses must use the wrapper's bounded `URLSession.AsyncBytes` reader, reject oversized declared lengths, cancel the task on streamed overflow, and byte-check snapshot/object/head uploads before send.
- The native AI client must support provider model-list retrieval, Worker proxy action headers, image generation, image editing, and inpainting through the shared provider contract.
- Cloudflare sync must support `DELETE /sync/clear` for clearing remote ZeroChat sync data without deleting local data.
- GitHub Token remains on the current device. Cloudflare access is derived from the data encryption password, so users do not manage a separate Worker access token in the app.

`Sources/ZeroChatCore/AiProtocol.swift` owns the shared native AI provider
protocol boundary for Apple: remote HTTPS endpoint safety, private/LAN host
rejection, Cloudflare Worker proxy action headers, chat context trimming,
OpenAI Chat/Responses and Anthropic request shaping, model-list parsing,
streaming delta parsing, generated-image response parsing, and image-edit
multipart assembly. `Sources/ZeroChatCore/AiClient.swift` keeps the public async
chat, streaming, model-list, image generation, and image-edit entry points plus
HTTP status/error handling.

## UI Scope

The SwiftUI app includes the native parity baseline: adaptive conversation list, merged provider/model menu, system `.searchable` conversation search, TipKit first-use guidance on the empty-chat setup action for iOS 17+/macOS 14+, Haptic Touch message previews through native context-menu previews, user-message edit and resend, AI regenerate/delete controls, text-to-image/edit/inpaint controls with native file import, generated-image download staging, hardware shortcuts for new chat/search/settings/send/stop/close, Touch Bar Send/Stop controls on supported Macs, native macOS Commands for New chat/New window/Search/Stop/Settings, automatic macOS window tabbing for the system window-merge workflow, window-local macOS conversation selection on top of the shared encrypted snapshot store, NSUserActivity Handoff for continuing the current conversation across Apple devices, CoreSpotlight conversation-title indexing for system search, pull-to-refresh Gist/Cloudflare sync on the conversation list and transcript, localized Notification Center sync-complete notifications with auto-sync throttling, a macOS main window that opens at a practical desktop size and enforces the PRD 900x600 minimum, an independent macOS Settings window with native `TabView` pagination, a macOS `MenuBarExtra` with the branded template menu-bar icon and Show main window/New chat/Quit actions, a macOS Sonoma+ Desktop Widget that opens localized Quick Ask through `zerochat://quick-ask`, six settings categories, Keychain-backed secrets, provider/model editing, model fetching/manual entry/reordering, Skill import/add/edit/delete settings, sync mode explanations, data encryption password save/reset controls with high-risk change warnings, encrypted backup import/export, reset local data, Gist/Cloudflare clear-remote-data source paths, and Gist plus Cloudflare incremental auto-sync source paths with legacy Cloudflare snapshot fallback that still need simulator/device release QA.

The checked-in SwiftPM and Xcode app target keep the PRD deployment floor at
iOS 16 and macOS 14. Empty-state UI avoids newer-only convenience views so the
source path remains compatible with that floor until Apple runtime QA proves the
full simulator/device matrix.

The Xcode project also includes a `ZeroChatShareExtension` iOS/iPadOS app
extension. It registers as a native share-services extension, accepts text and
URLs, writes the shared payload into the `group.app.zerochat.client` App Group,
opens the containing app through `zerochat://share`, and the main app imports
that payload into the composer as a draft without auto-sending.

The Xcode project includes a `ZeroChatQuickAskWidgetExtension` WidgetKit target
for iOS 17+/macOS 14+. The widget uses a compact localized Quick Ask surface,
adapts its spacing and typography for small and medium families, mirrors Arabic
layout direction, exposes localized VoiceOver label and hint text, opens
`zerochat://quick-ask`, and the main app handles that route by creating a fresh
conversation and focusing the composer without sending a message.

When Cloudflare sync is configured, provider calls can reuse the sync Worker as the proxy if a provider-specific proxy URL is blank. The Apple client derives the Cloudflare access key from the data encryption password, matching the Web/PWA Worker configuration.

The Apple Gist and Cloudflare sync source paths now use the same encrypted
snapshot vault contract as Web/PWA and Android. Local saves are debounced,
provider keys are included in the encrypted vault, existing remote ciphertext is
decrypted before upload so a wrong data password cannot silently overwrite
cloud data, and an empty first device can restore cloud data automatically.
`Sources/ZeroChatCore/CredentialBoundURLSession.swift` owns credential-bound
redirect rejection, the 60-second request/resource timeout, and the shared declared/streamed sync body budgets; JSON is
decoded only after its bounded async-byte stream completes.
`Sources/ZeroChatCore/SyncGist.swift` owns GitHub Gist transport details:
GitHub token/file validation, selected-file reads, private Gist creation,
encrypted vault serialization, selected-file patching, and clear-cloud null
patches. `Sources/ZeroChatCore/SyncClient.swift` keeps the public
`syncGistVault` / `clearGist` strategy entry points while delegating GitHub
HTTP transport to that focused file.
`Sources/ZeroChatCore/SyncCloudflare.swift` owns Cloudflare Worker transport:
Worker endpoint and access-token validation, legacy snapshot envelope/vault
reads and writes, incremental head/object reads, object writes and rollback
deletes, legacy snapshot cleanup, and `/sync/clear` fallback cleanup.
`Sources/ZeroChatCore/SyncIncremental.swift` owns the incremental sync engine:
manifest decryption and validation, manifest-to-vault materialization,
message chunk and Skill content chunk reads, incremental upload assembly,
encrypted object reuse, Skill content redaction, rollback payload tracking, and
stale object cleanup after successful uploads.
`Sources/ZeroChatCore/SyncMerge.swift` owns remote-vault acceptance and the
first-sync merge policy: local sync controls, local preferences, local provider
secrets, newest remote/local records, Skill settings, and restore status.
`Sources/ZeroChatCore/SyncClient.swift` keeps the public
`syncCloudflareVault` / `clearCloudflare` entry points, first-sync strategy
branching, legacy snapshot fallback, and local/remote/merge selection while
delegating Worker HTTP transport to `SyncCloudflare.swift`, incremental
manifest/chunk work to `SyncIncremental.swift`, and first-sync merge policy to
`SyncMerge.swift`.
`App/AppleCloudSyncStatusStrip.swift` owns the visible sidebar cloud-sync
status strip, local-mode Start cloud sync CTA, manual Gist/Cloudflare sync action,
blocked-sync explanation, and direct Settings > Sync entry.

Release wording must keep source parity and runtime proof separate. The Apple
sync path is implemented in source, but simulator/device release QA still needs
to prove upload, restore, merge, clear-cloud, and post-clear readback on macOS
and iOS before the native app is marketed as release-complete. Until that target
runtime proof exists, Web/PWA remains the runtime-verified cloud-sync path for
Apple release claims from this Windows workspace.

User Skill data is part of the shared snapshot contract. Apple now has a SwiftUI Skill editor/import surface in source, but it still needs simulator/device runtime QA before it should be marketed as release-complete.

`App/SettingsTab.swift` owns the shared six-category Settings tab model used by
the Settings view, macOS Settings window, app commands, and chat shortcuts.
`App/SettingsSupport.swift` owns danger text assembly, first-sync conflict
detection, encrypted-backup file document/export naming, and native clipboard
copy support.
`App/AppleChatViewModel.swift` owns the observable chat app state and side
effects: snapshot load/save, Keychain-backed secrets, encrypted backup
entry points, manual and automatic cloud sync, chat streaming,
image generation/edit/inpaint dispatch, and private sync/image side effects.
`App/AppleBackupState.swift` owns encrypted backup state helpers: vault
assembly, provider-key collection, encrypted backup decode/version validation,
import timestamping, provider-key replacement, and provider-key restore after
sync.
`App/AppleConversationModelState.swift` owns the ViewModel extension for active
conversation resolution, Provider/model selection, configured chat/image model
lists, conversation creation/deletion, message deletion, and conversation
replacement so the observable state host stays focused on private IO and
side-effect orchestration.
`App/AppleDefaultSnapshotState.swift` owns the ViewModel extension for first-run
snapshot construction, including localized custom OpenAI relay copy, the shared
Provider preset catalog, empty conversations/Skills, default sync config, and
timestamping.
`App/AppleCloudSyncStatusState.swift` owns the ViewModel extension for visible
cloud-sync readiness and status summaries, using non-secret Keychain presence
flags from the state host rather than reading sync passphrases or access keys
directly.
`App/AppleSpotlightIndexState.swift` owns the ViewModel extension for
CoreSpotlight conversation-title index refreshes after snapshot load, commit,
and sync merge.
`App/AppleProviderRequestState.swift` owns the ViewModel extension for Provider
request shaping, Cloudflare Worker proxy fallback, client-key requirement
checks, and provider-key-missing decisions without exposing Keychain internals.
`App/AppleChatReadinessState.swift` owns the ViewModel extension for visible
chat readiness state: send-button labels, empty-state title/body/setup CTA,
image-composer guidance, and submit gating. The actual image upload payloads
stay private inside the observable state host.
`App/AppleChatInputState.swift` owns the ViewModel extension for shared-text
intake from the Share Extension, composer draft insertion, user-message edit
state, and edit cancellation.
`App/AppleConversationSidebar.swift` owns the visible conversation sidebar:
brand heading, New Chat action, `AppleCloudSyncStatusStrip`, localized
conversation search/no-results state, sidebar selection, destructive
conversation delete affordance, and pull-to-refresh sync.
`App/AppleChatConversationPane.swift` owns the visible chat conversation
workspace: header placement, notices, empty-state setup guidance, transcript
refresh, message bubble actions, composer, iOS Settings sheet, and image file
importers.
`App/ChatHeaderView.swift` owns the visible chat header, Provider/Model menu,
chat/image mode model routing, and Settings button so `ChatView.swift` stays
focused on app-level chat layout and state orchestration.
`App/AppNoticeView.swift` owns the shared app/settings notice model and SwiftUI
notice banner styling used by chat, Settings, and focused Settings panels.
`App/ApplePlatformServices.swift` owns Apple platform integrations used by the
chat shell: Handoff activities, Spotlight indexing, Share Extension intake,
Quick Ask deep links, and Notification Center sync completion.
`App/AppleChatTypes.swift` owns shared chat composer/image task enums, typed
image request preflight payloads, sync queue bookkeeping, and app/import error
types used by the Apple chat shell.
`App/AppleWindowActivationReporter.swift` owns the macOS key-window activation
bridge that keeps command-menu conversation/focus actions targeted to the
active ZeroChat window.
`App/AppleChatHelpers.swift` owns shared Apple chat/app helper functions and
extensions: Provider display names, theme/layout direction mapping,
conversation search normalization, snapshot/conversation/date helpers,
timestamps, and image MIME inference.
`App/AppleModelCatalogHelpers.swift` owns Apple chat/image model catalog
filtering, configured-model de-duplication, and Anthropic image-model exclusion
so `ChatView.swift` only exposes thin ViewModel wrappers for UI call sites.
`App/AppleChatReadinessHelpers.swift` owns Apple chat readiness copy and gating:
provider/model title fallback, send-button labels, first-use empty-state copy
and setup actions, image composer blockers, and submit eligibility.
`App/AppleImageRequestPreflight.swift` owns the send-time image request preflight
for generate/edit/inpaint, turning missing Provider/model/key/prompt/source/mask
states into localized notices before chat history is mutated.
`App/AppleChatRequestPreflight.swift` owns the send-time chat request preflight,
including streaming-state blocking, Provider/model/key/input validation, and
edited-or-new user message assembly before the assistant streaming placeholder
is inserted.
`App/AppleChatMessageStateHelpers.swift` owns chat/image message-state assembly:
streaming assistant placeholders, pending chat/image conversation mutations,
streaming assistant updates, partial-output lookup, assistant completion
replacement, target-only message deletion, generated-image attachment metadata,
failed-image message cleanup, and assistant regenerate draft selection.
`App/AppleConversationStateHelpers.swift` owns conversation-list mutation:
conversation upsert/creation placement, active-conversation selection repair,
and target-only conversation deletion so deleting a background conversation does
not unexpectedly move the active chat.
`App/AppleProviderModelSelectionHelpers.swift` owns Provider/Model selection
state changes: chat model selection, image-model persistence on the Provider,
same-provider chat-model preservation in image mode, and single-commit
conversation creation/upsert.
`App/AppleSyncStateHelpers.swift` owns sync state decisions shared by the chat
shell and Settings: manual-sync blockers, localized cloud-sync summaries,
stale auto-sync result detection, sync-result merging, completed-sync status
recognition, and first-sync local-content detection.
`App/AppearanceSettingsView.swift` owns theme selection, shared language-mode
selection, preference binding, and compact-display controls so
`SettingsView.swift` stays focused on Settings shell routing.
`App/ProviderSettingsView.swift` owns the Provider settings list, localized
custom Provider creation, enabled-first localized sorting, and routing to the
focused Provider editor.
`App/ModelSettingsView.swift` owns provider picking, live model fetching,
manual model entry, model reorder/delete controls, and default chat/image model
selection so `SettingsView.swift` does not own the PRD model-settings workflow.
`App/SyncSettingsView.swift` owns Local/Gist/Cloudflare mode selection, manual
Sync now, Gist fields, Cloudflare Worker/access-key reveal and copy controls,
localized persisted sync status, and first-sync conflict choices.
`App/SkillHelpers.swift` owns native Skill construction, content chunking,
keyword extraction, metadata text, and content hashing so `SettingsView.swift`
can stay focused on the PRD Settings UI and document picker flows.
`App/SkillSettingsView.swift` owns native Skill settings, import, add,
progressive rendering, saved-Skill editor composition, save, and delete
actions.
`App/SkillEditor.swift` owns the saved-Skill editor row, including metadata,
enabled/fixed/auto-match toggles, save, and delete controls.
`App/DataSettingsView.swift` owns sync-password save/change/reset,
encrypted-backup import/export, local reset, clear-cloud data, and destructive
confirmations.
`App/ProviderEditor.swift` owns AI-service editing, provider-key entry,
connectivity checks, delete-provider fallback repair, secret clearing, and
custom Provider construction.

Encrypted backup import/export now uses SwiftUI document import/export, the shared encrypted vault format, and a destructive overwrite confirmation. Import replaces the local snapshot and provider keys, then follows the normal save and auto-sync path when Gist or Cloudflare sync is configured.

Production recommendations:

- Local data: SwiftData or SQLite.
- Secrets: Keychain.
- Networking: URLSession streaming.
- Packaging: Xcode Archive; use TestFlight/App Store for iOS and notarized DMG/PKG distribution for macOS.
