# ZeroChat for Android

Stack: Kotlin + Jetpack Compose.

Rationale:

- Kotlin and Jetpack Compose are the primary Android language and UI framework.
- Compose is well suited to chat lists, input surfaces, settings screens, and dynamic themes.
- Android Keystore, EncryptedSharedPreferences, Room, and DataStore provide stable native storage options.

## Structure

```text
app/src/main/java/app/zerochat/
  MainActivity.kt
  ai/AiClient.kt
  ai/AiProtocol.kt
  data/Models.kt
  data/ProviderRegistry.kt
  data/ZeroChatRepository.kt
  security/SecretStore.kt
  sync/AndroidSyncStatusNotifier.kt
  sync/SyncClient.kt
  sync/SyncCloudflare.kt
  sync/SyncGist.kt
  sync/SyncHttpBody.kt
  sync/SyncObjectKeys.kt
  sync/SyncIncrementalUpload.kt
  sync/SyncMerge.kt
  ui/ChatScreen.kt
  ui/chat/ConversationDeleteDialog.kt
  ui/chat/ChatStateHelpers.kt
  ui/chat/ChatProviderModelHelpers.kt
  ui/chat/ChatGenerationRunner.kt
  ui/chat/ChatMessageRequestPreflight.kt
  ui/chat/ChatRequestFeedback.kt
  ui/chat/ChatManualSyncFeedback.kt
  ui/chat/ChatSetupReadiness.kt
  ui/chat/ImageMessageRequestHelpers.kt
  ui/chat/ChatTopBar.kt
  ui/chat/ChatChrome.kt
  ui/chat/ChatConversationPane.kt
  ui/chat/MessageList.kt
  ui/chat/Composer.kt
  ui/chat/ConversationBar.kt
  ui/settings/ChatSettingsSheet.kt
  ui/settings/SettingsScreen.kt
  ui/settings/AppearanceSettings.kt
  ui/settings/ProviderSettings.kt
  ui/settings/ProviderSettingsEditor.kt
  ui/settings/ProviderSettingsHelpers.kt
  ui/settings/ModelSettings.kt
  ui/settings/ModelProviderPicker.kt
  ui/settings/ModelCatalogEditor.kt
  ui/settings/ModelDefaultChoices.kt
  ui/settings/ModelSettingsHelpers.kt
  ui/settings/SkillSettings.kt
  ui/settings/SkillImportController.kt
  ui/settings/SkillImportPrompt.kt
  ui/settings/SkillGlobalControls.kt
  ui/settings/SkillListSection.kt
  ui/settings/SkillSettingsEditor.kt
  ui/settings/SkillSettingsHelpers.kt
  ui/settings/SyncSettings.kt
  ui/settings/SyncModeSection.kt
  ui/settings/SyncProviderFields.kt
  ui/settings/SyncStatusSection.kt
  ui/settings/SyncSettingsHelpers.kt
  ui/settings/DataSettings.kt
  ui/settings/DataPassphraseSection.kt
  ui/settings/DataBackupActions.kt
  ui/settings/DataDangerActions.kt
  ui/settings/DataSettingsBackup.kt
  ui/settings/DataSettingsDangerDialogs.kt
  ui/settings/DataSettingsHelpers.kt
  ui/settings/SettingsComponents.kt
  ui/NativeI18n.kt
app/src/test/java/app/zerochat/
  ai/AiProtocolTest.kt
  data/ProviderRegistryTest.kt
  sync/SyncCloudflareTest.kt
  sync/SyncIncrementalUploadTest.kt
  sync/SyncMergeTest.kt
  ui/NativeI18nTest.kt
  ui/chat/ChatStateHelpersTest.kt
  ui/chat/ChatMessageRequestPreflightTest.kt
  ui/chat/ChatRequestFeedbackTest.kt
  ui/chat/ChatManualSyncFeedbackTest.kt
  ui/chat/ChatSetupReadinessTest.kt
  ui/chat/ImageMessageRequestHelpersTest.kt
  ui/settings/DataSettingsHelpersTest.kt
  ui/settings/ModelSettingsHelpersTest.kt
  ui/settings/ProviderSettingsHelpersTest.kt
  ui/settings/SkillSettingsHelpersTest.kt
  ui/settings/SyncSettingsHelpersTest.kt
```

## Requirements

- Provider types must support `openai-compatible`, `openai-responses`, and `anthropic`.
- Remote AI calls require an API key; a browser login session cannot replace an API key.
- AI Base URLs must be remote HTTPS URLs. HTTP, localhost, private network, and LAN addresses are rejected.
- Production AI, Cloudflare, and Gist requests must reject automatic redirects before attaching API keys or sync credentials; configure the final trusted endpoint directly.
- The shared sync Ktor client must keep request, connect, and socket timeouts at 60 seconds so a half-open or trickle response cannot block manual sync, auto-sync, or clear-cloud indefinitely.
- Cloudflare and Gist response bodies must use `SyncHttpBody.kt` limits: declared lengths are rejected before buffering, chunked Ktor channels are counted and cancelled on overflow, and snapshot/object/head uploads are UTF-8 byte-checked before send.
- The native AI client must support provider model-list retrieval, Worker proxy action headers, image generation, image editing, and inpainting through the shared provider contract.
- Cloudflare sync must support `DELETE /sync/clear` for clearing remote ZeroChat sync data without deleting local data.
- GitHub Token remains local to the device. Cloudflare access is derived from the data encryption password, and AI API keys are synchronized only inside the end-to-end encrypted vault.
- The Compose Material 3 theme uses the PRD Indigo brand palette and, on Android
  12+, layers ZeroChat brand primary colors over Dynamic Color surfaces.
- The launcher activity enables Android's predictive-back callback path for
  Android 13/14+ system navigation.
- The launcher activity calls `enableEdgeToEdge()`, the Android theme keeps
  transparent status/navigation bars, and the composer/settings surfaces retain
  navigation-bar and IME inset padding.
- Cloudflare auto-sync creates a quiet Android notification channel for sync
  status updates. On Android 13+, the app declares `POST_NOTIFICATIONS` and
  posts only when the OS permission is already granted, so sync never interrupts
  first-run setup with a permission prompt.
- The chat transcript exposes Material 3 pull-to-refresh for manual
  Gist/Cloudflare sync. It reuses the same encrypted cloud vault paths as
  auto-sync, works even when the auto-sync toggle is off, and refuses to run
  while a response is actively streaming.
- The Android home-screen Widget exposes a localized Quick Ask entry. It uses
  the native AppWidget provider stack, reuses the branded monochrome icon,
  exposes an Android 12+ picker preview with 2x2 target-cell metadata, and
  opens `zerochat://quick-ask` into the existing activity so a fresh
  conversation is focused without auto-sending. Runtime RemoteViews also set a
  localized card-level accessibility label. The emulator UI smoke now verifies
  the installed APK's AppWidget receiver through `dumpsys package` and `dumpsys
  appwidget`; physical launcher gallery placement and rendered widget-card QA
  still need a target Android device.
- Production local data should use Room and DataStore. Secrets should use Android Keystore and EncryptedSharedPreferences.

`ai/AiProtocol.kt` owns the shared native AI provider protocol boundary for
Android: remote HTTPS endpoint safety, private/LAN host rejection, Cloudflare
Worker proxy action headers, chat context trimming, OpenAI Chat/Responses and
Anthropic request shaping, streaming SSE delta parsing, model-list parsing, and
generated-image response parsing. `ai/AiClient.kt` keeps the public async chat,
streaming, model-list, image generation, and image-edit entry points plus HTTP
status/error handling.

## UI Scope

The Compose UI includes the native parity baseline: a PRD Indigo Material 3 theme with Android 12+ Dynamic Color surface support, predictive-back manifest wiring, edge-to-edge transparent system bars with IME/navigation inset protection, a quiet cloud sync-status notification channel, pull-to-refresh manual Gist/Cloudflare sync on the chat transcript, a localized home-screen Quick Ask Widget, conversation chips, merged provider/model selection, user-message edit and resend, AI regenerate/delete controls, native system sharing for assistant replies, text-to-image/edit/inpaint controls, six settings tabs, provider secrets in EncryptedSharedPreferences, model fetching/manual entry/reordering, Skill import/add/edit/delete settings, sync mode explanations, data encryption password save/reset controls with high-risk change warnings, reset local data, and Gist/Cloudflare clear-remote-data source paths that still need device-level release QA.

When Cloudflare sync is configured, provider calls can reuse the sync Worker as the proxy if a provider-specific proxy URL is blank. The Android client derives the Cloudflare access key from the data encryption password, matching the Web/PWA Worker configuration.

`sync/SyncClient.kt` owns the public Gist/Cloudflare sync strategy entry points
and Cloudflare incremental orchestration, while `sync/SyncCloudflare.kt` owns
Cloudflare Worker endpoint validation, legacy snapshot envelope/vault transport,
incremental head/object transport, rollback/stale object deletes, legacy
snapshot cleanup, and clear-cloud fallback cleanup. `sync/SyncGist.kt` owns
GitHub Gist HTTP transport, Gist ID/file validation, private encrypted Gist
creation, selected-file patching, encrypted vault serialization, and clear-cloud
null patches. `sync/SyncClient.kt` also installs the shared 60-second Ktor
request/connect/socket timeout budget. `sync/SyncHttpBody.kt` owns shared declared/streamed byte limits,
bounded UTF-8/JSON reads, error-body limits, and immediate channel cancellation
on overflow. `sync/SyncObjectKeys.kt` owns shared Cloudflare object-key
generation and safety validation. `sync/SyncIncrementalUpload.kt` owns
Cloudflare incremental object assembly, and `sync/SyncMerge.kt` owns first-sync
merge/remote-acceptance rules.

The Android sync settings screen must stay honest about release confidence:
Gist and Cloudflare encrypted sync are wired in source, and Cloudflare is
covered by an emulator E2E smoke that drives the UI against a temporary
Worker-compatible endpoint, uploads and decrypts a real encrypted vault, and
verifies Skill add/delete propagation. Live disposable Worker/Gist,
physical-device restore, and incremental R2 cleanup QA still need final release
passes.

User Skill data is part of the shared snapshot contract. Android now has a Compose Skill editor/import surface in source, and the repeatable emulator UI smoke adds, edits, saves, and deletes a pasted Skill. Physical-device runtime QA and disposable live cloud sync cleanup drills are still required before marketing Android Skills as final-release complete.

Encrypted backup import/export now uses Android's system document picker, the shared encrypted vault format, and the same destructive restore confirmation copy as the Web/PWA. Import replaces the local snapshot and provider keys, then follows the normal save and auto-sync path when Gist or Cloudflare sync is configured.

## Build

From the repository root, run the Android preflight first:

```bash
pnpm run check:native-prereqs -- --platform=android
```

Then open `apps/android/` in Android Studio, configure JDK 17 and Android SDK
Platform 36, then run the application or package an APK/AAB.

Command-line build:

```bash
pnpm run check:android-lint
pnpm run build:android:debug
pnpm run build:android:release
pnpm run check:android-release-size
```

The helper detects the recommended local JDK/SDK paths, sets `JAVA_HOME`,
`ANDROID_HOME`, and `ANDROID_SDK_ROOT` for that run only, then calls the
checked-in Gradle Wrapper. The wrapper downloads the pinned Gradle version, so a
new contributor does not need to install Gradle separately.
Run `pnpm run check:android-lint` before packaging; it fails on actionable
Android Lint warnings while leaving dependency upgrade advisories to deliberate
maintenance work.
On Windows repositories whose path contains non-ASCII characters, the helper
runs Gradle through a stable ASCII junction and disables daemon reuse, build
cache, and file-system watching for that invocation. It keeps Gradle's normal
input tracking enabled while the cross-process build lock serializes access to
the shared junction state, so quality checks do not force every task to rebuild.
The release build enables R8 minification and resource shrinking, and
`pnpm run check:android-release-size` enforces the PRD `< 8MB` APK budget while
printing the unsigned release APK byte count and SHA-256 for review.

Runtime smoke after an emulator or device is connected:

```bash
pnpm run qa:android
pnpm run qa:android:current
pnpm run qa:android:refresh-cloud
pnpm run qa:android:reuse-current
pnpm run check:android-contact-sheet
pnpm run check:android-ui-smoke
pnpm run check:android-cloud-sync-smoke
```

`pnpm run qa:android` is the shortest local path: it checks Android
prerequisites, builds the debug APK, reuses a booted emulator or starts the
`ZeroChatPixelAscii` emulator, waits for Android to finish booting, then runs
both smoke tests. The wrapper never selects an attached physical device implicitly;
set `ANDROID_SERIAL` or pass `-- --allow-physical-device` to authorize one.
`-- --avd <name>` forces that AVD even when another device is connected. It stops
the emulator and adb server it started unless `-- --keep-emulator` is passed,
but leaves a pre-existing adb server alone. Use `-- --keep-adb-server` when
another local device tool should keep a QA-owned adb server open, or
`-- --show-emulator` when you want to watch the Android screen while the smoke runs.
After a fresh debug build, `pnpm run qa:android:current` runs the same wrapper
with `--skip-build`; use it when you need to refresh runtime screenshots and
Cloudflare sync proof against the current APK without spending time rebuilding.
If UI smoke already passed against the exact current APK but Cloudflare smoke
failed or timed out, `pnpm run qa:android:refresh-cloud` revalidates the UI
report hash and device, then refreshes only Cloudflare smoke and aggregate
evidence. It reinstalls the APK for a clean sync profile and rejects stale or
cross-device UI evidence.
On slower local machines, budget roughly 50-60 minutes for the full UI plus
Cloudflare sync pass even when the build is skipped. The encrypted Cloudflare
drill alone can take roughly 29 minutes under emulator load, while each child
process remains bounded by a 45-minute parent timeout.
When both individual smoke reports already passed against that exact debug APK,
`pnpm run qa:android:reuse-current` can regenerate only the aggregate report and
contact sheet. It rejects missing/failed reports, different devices, missing
installed-APK proof, or any current-APK bytes/SHA-256 mismatch.
After the smoke reports exist, `pnpm run check:android-contact-sheet` rebuilds
`.manual-qa/android-current-contact-sheet.png` and the matching hash manifest
without touching the emulator.

The UI smoke installs the debug APK, opens the app, checks the main settings
tabs, verifies the Quick Ask AppWidget provider is visible to Android system
services, switches to Chinese, restores Follow system, adds/edits/saves/deletes
a pasted Skill, opens reset-password/reset-local/clear-cloud danger dialogs
without confirming destructive actions, checks chat plus text-to-image, edit,
and inpaint composer modes, closes Settings, and stores screenshots plus
`.manual-qa/android-ui-smoke.json`. The Cloudflare sync smoke starts a temporary
Worker-compatible local endpoint, enters the data password and Worker URL
through the Android UI, waits for an encrypted vault upload, decrypts it with
PBKDF2-SHA-256/AES-256-GCM, verifies Skill add/delete sync propagation, and
proves a real pull-to-refresh gesture uploads a seeded conversation even after
the local snapshot has `autoSync=false`. On Android 13+ it grants
`POST_NOTIFICATIONS` for the disposable profile and verifies posted
`ZeroChat sync` / `Sync complete` sync-status notifications for both initial
Cloudflare sync and manual pull-to-refresh, then writes
`.manual-qa/android-cloud-sync-smoke.json`. After the IME closes, all source,
local replacement, remote restore, and process-relaunch Provider credential
frames must record viewport and field bounds and keep the complete masked input
above system navigation. The wrapper also writes
`.manual-qa/android-emulator-qa.json` linking the two smoke reports and
refreshes the Android contact sheet from the current screenshots. Add
`-- --no-install` to an individual smoke when the APK is already installed.

Manual command-line build:

```bash
cd apps/android
./gradlew assembleDebug
```

On Windows, run `gradlew.bat assembleDebug` from `apps/android`.

If the preflight finds a local JDK but `gradlew.bat` says `JAVA_HOME` is
missing, point `JAVA_HOME` at the actual JDK folder, not the parent cache
folder. For the disposable local QA tools used in this workspace:

```powershell
$env:JAVA_HOME = 'C:\ZeroChatAndroidTools\jdk17\jdk-17.0.19+10'
$env:ANDROID_HOME = 'C:\ZeroChatAndroidTools\sdk'
$env:ANDROID_SDK_ROOT = 'C:\ZeroChatAndroidTools\sdk'
.\gradlew.bat assembleDebug
```
