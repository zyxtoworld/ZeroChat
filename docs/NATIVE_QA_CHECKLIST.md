# Native QA Checklist

Use this checklist before calling an Android, Apple, Windows, or Linux build
release-ready. Source parity checks are useful, but they are not a substitute
for running the native app on the target SDK and looking at the UI by eye.

Do not claim release parity for a native platform until every required item for
that platform has passed on a real SDK machine, simulator, emulator, or device.

## Shared Gate

Run these from the repository root before platform-specific QA. The native
preflight checks both required project files and local build tools:

```bash
pnpm install --frozen-lockfile --prod=false
pnpm run verify:release
pnpm run verify:all-platforms
```

If the target machine only builds one platform, run
`pnpm run check:native-prereqs -- --platform=android`, `apple`, `windows`,
`linux`, or `current` before that platform's runtime QA.
Add `--report=.manual-qa/native-prereq-<platform>.json` when you need a
machine-readable record of missing SDKs or host requirements for the QA audit;
the report is evidence of the blocker only, not a substitute for the build or
runtime screenshots. The JSON report intentionally carries
`releaseEvidence: false`, `safeToPublish: true`, `runtimeQaRequired: true`,
and a reviewer checklist, so reviewers know native build, launch, screenshot,
and visual review are still required before release. The report's
`nextSteps.platformQaCommands` table names the repeatable target-host runtime
QA commands for Android, Apple, Windows, and Linux so a blocked preflight can be
handed to the right machine without turning the preflight itself into runtime
QA evidence. The Windows handoff includes
`pnpm run check:windows-msix-trusted-report` after trusted MSIX QA so a
pass/failure report is validated before reviewers rerun the broader runtime
artifact gate. The Apple and Linux handoffs include their target package-size
checks, so IPA, macOS `.app`, and Linux release-binary budget evidence stay
paired with the runtime smoke handoff instead of being remembered separately.
The same `nextSteps` object also carries
`releaseGateCommands` and `releaseEvidenceCommands`, which point reviewers at
the staged all-platform release gates plus the native runtime, hosted native CI,
and live-provider full-capability evidence checks that must still pass before
final release. The current blocker map derives disposable live sync from the
canonical report's source fingerprint: a current passed report closes it, while
a stale, skipped, or missing report keeps it open. The final gate validates that
binding so a stale diagnostic cannot replace current release evidence. Each
report also carries a
`sourceFingerprint` for the guarded native source tree; rerun
`native-build-prereq-check.mjs` after native source, project, workflow, or
packaging changes so the focused runtime-artifact validator can reject stale
preflight reports instead of preserving yesterday's blocker as today's state.

Hosted Linux and macOS CI smoke jobs validate their captured PNG/JSON runtime
artifacts with `node scripts/runtime-smoke-artifact-check.mjs` before upload.
That catches blank, collapsed, or metadata-mismatched screenshots, but it is
still evidence to review, not a substitute for device-level QA.

Use disposable sync credentials for release drills. Do not use a personal
production vault for first-pass cloud sync testing.

For every platform, verify:

- First launch follows the operating system language when supported.
- Switching language changes visible settings, chat, Skills, and danger-dialog
  copy without restarting.
- Arabic switches the visible layout direction to right-to-left, and switching
  back to English or another LTR language restores left-to-right layout.
- Chat works with a temporary provider key that is not committed.
- Saving, changing, and clearing a provider key updates the provider timestamp,
  triggers the same encrypted secret-sync path as other local edits when remote
  sync is enabled, and does not write the key to project files or plaintext
  local snapshots.
- Unsafe provider Base URLs are rejected: HTTP, localhost, loopback/private
  networks, LAN suffixes, embedded credentials, query strings, and fragments.
- Model fetching, manual model entry, provider/model switching, stop,
  regenerate, edit-and-resend, and delete all work.
- Text-to-image, image edit, and inpainting controls are visible and sized
  correctly, even when the platform cannot complete the remote image request in
  the test environment.
- Settings categories stay aligned with the Web/PWA: Appearance, AI providers,
  Models, Skills, Sync, and Data.
- The branded app icon is visible in the launcher/window/sidebar surface, the
  cloud-sync status entry is visible on the home/sidebar surface, and tapping or
  clicking that cloud-sync entry opens Settings > Sync directly. Keep platform
  evidence for the guarded redlines: Android `zerochat-app-icon` and
  `zerochat-cloud-sync-status`, Apple `AppleCloudSyncStatusStrip`, Windows
  `ZeroChat.ico` plus `ApplyWindowIcon()`, and Linux branded sidebar icon plus
  direct Settings > Sync routing.
- First-sync conflict offers cloud, local, and merge choices when both sides
  contain data. A locally added provider counts as local data even if no chat
  has been sent yet.
- If automatic native cloud sync is not fully wired and device-tested, the UI
  must keep upload actions disabled or describe the state as local-only; do not
  imply that local edits already upload from the native app.
- Sync password change and reset show high-risk warnings.
- Reset local data and clear cloud data require destructive confirmation. The
  confirmation body must name the remote ciphertext that is deleted, state that
  local data stays on the device, and explain that the next sync starts fresh.
- Skill add, edit, delete, enable, disable, matching mode, and sync propagation
  are tested where the native UI exposes enabled controls. If a platform keeps
  Skill editing disabled in a read-only recovery screen, verify the fallback
  explanation is visible and synced Skill data is preserved.
- Encrypted backup import/export must use a trusted native file picker, the
  shared encrypted vault format, provider-key replacement, and an explicit
  destructive restore confirmation. If a platform intentionally exposes only an
  read-only recovery screen, it must keep backup actions disabled and explain
  the restore-safety reason without implying that the normal app backup flow is
  unfinished.
- Narrow windows, mobile portrait, mobile landscape, keyboard/IME opening,
  scrolling panels, dialogs, and sidebars are checked by eye for clipping,
  overlap, off-center text, and unreachable buttons.
- App restart restores local data, selected language mode, compact display, sync
  mode, provider/model settings, and encrypted secret availability.
- Where automatic native cloud sync is enabled and device-tested, adding,
  editing, and deleting local data uploads to the cloud without leaving stale
  Skill or message objects after cleanup. Where it is not enabled yet, verify
  the native UI keeps the relevant controls disabled or local-only and does not
  imply that native local edits already upload automatically.
- Where automatic native cloud sync is enabled and device-tested, edit a
  provider API key as its own action and confirm another client can restore the
  changed key from the encrypted vault or manifest with the same data password.

Record the build command, device or simulator name, OS version, and screenshots
for first run, chat, Settings > Skills, Settings > Sync, Settings > Data, first
sync conflict choices, encrypted backup import/export, clear-cloud scope warning,
sync-password change/reset warnings, an image mode, and the smallest supported
viewport/window.

## Android

Prerequisites:

- Android Studio
- JDK 17
- The checked-in Gradle Wrapper under `apps/android`
- Android emulator or a physical device

Commands:

```bash
pnpm run check:native-prereqs -- --platform=android
pnpm run qa:android
pnpm run qa:android:current
pnpm run qa:android:refresh-cloud
pnpm run qa:android:reuse-current
pnpm run check:android-contact-sheet
pnpm run check:android-lint
pnpm run build:android:debug
pnpm run build:android:release
pnpm run check:android-release-size
pnpm run check:android-ui-smoke
pnpm run check:android-cloud-sync-smoke
```

The build helper detects the recommended local JDK/SDK paths and injects
`JAVA_HOME`, `ANDROID_HOME`, and `ANDROID_SDK_ROOT` for that run. For the
static Android quality gate, run `pnpm run check:android-lint`; it treats every
actionable Android Lint warning as a build failure while keeping dependency
upgrade advisories separate from source correctness. For the
shortest local pass, `pnpm run qa:android` checks prerequisites, builds the APK,
reuses or starts a local AVD, waits for boot, runs the
UI and Cloudflare sync smokes, regenerates
`.manual-qa/android-current-contact-sheet.png` and its hash manifest from the
current screenshots, then stops the emulator and adb server it started. A
pre-existing adb server remains externally owned and is recorded rather than
stopped. It does not select an attached physical device unless `ANDROID_SERIAL` or
`-- --allow-physical-device` explicitly authorizes it. Pass
`-- --keep-emulator` to leave that emulator open, `-- --keep-adb-server` to keep
adb running for another local device tool, `-- --show-emulator` to watch the
run, or `-- --avd <name>` to pick a specific AVD. After a fresh debug APK build,
`pnpm run qa:android:current` runs the same wrapper with `--skip-build` so
reviewers can refresh UI, Cloudflare sync, and contact-sheet evidence against
the current APK without rebuilding first; reserve roughly 50-60 minutes for the
full pass on slower local machines. The current encrypted Cloudflare drill alone
has taken roughly 29 minutes under emulator load, so each UI/cloud child keeps a
finite 45-minute parent budget rather than relying on optimistic host timing. If
only Cloudflare smoke failed after a current UI pass,
`pnpm run qa:android:refresh-cloud` revalidates the UI report's APK hash and
device before reinstalling the APK and rerunning sync. After both individual
smoke reports have already passed against the current debug APK,
`pnpm run qa:android:reuse-current`
may rebuild only the aggregate report and contact sheet. That path fails closed
unless both reports are passed, use the same device, prove installed/local APK
equality, and match the current APK bytes and SHA-256. For a connected emulator or device,
`pnpm run check:android-ui-smoke` installs the debug APK, opens the app,
opens Settings through the exact first-run action, checks
Settings > Appearance, AI providers, Models, Skills, Sync, and Data, switches to
the Android dark theme and captures it, switches back to System, switches to
Arabic for RTL layout proof, switches back to English, switches to Chinese,
restores Follow system, opens the `zerochat://quick-ask` route and verifies a
fresh focused composer without auto-send, adds, edits, saves, and deletes a
pasted Skill,
including its Pinned toggle, opens the
Data reset/clear-cloud warning dialogs without confirming destructive actions,
enters a temporary data password and verifies encrypted-backup export/import
open Android's system document picker, while import first requires the
destructive acknowledgement dialog,
verifies the native `zerochat_sync_status` notification channel through
`dumpsys notification --noredact`,
checks chat/image composer modes including text-to-image, edit, and inpaint,
types into the conversation search field to verify message-content filtering,
localized no-results guidance, and clear-to-restore behavior,
seeds a local conversation through debug `run-as`, verifies message edit,
regenerate, and delete actions are not permanently visible under message
bubbles, opens the delete-conversation confirmation without deleting the seeded
chat, dismisses it with Android system Back, long-presses a user message and an
assistant message, confirms their role-specific operation menus, asserts that
the Settings UI returned to the device's resolved system language, and writes
55 screenshots plus
`.manual-qa/android-ui-smoke.json` to `.manual-qa/`. The Quick Ask proof must
include `.manual-qa/android-ui-smoke-01a-quick-ask-route.png`; the report also
records `quickAskWidget` evidence from `dumpsys package` and `dumpsys
appwidget` proving Android system services see the AppWidget provider after
install. The long-press
menu proof must include `.manual-qa/android-ui-smoke-16-message-menu-user.png` and
`.manual-qa/android-ui-smoke-17-message-menu-assistant.png`; the theme proof
must include `.manual-qa/android-ui-smoke-03b-dark-theme.png`, and the system
Back proof must include
`.manual-qa/android-ui-smoke-15c-delete-dialog-back-dismissed.png`. The backup
picker proof must include
`.manual-qa/android-ui-smoke-08d-backup-export-picker.png`,
`.manual-qa/android-ui-smoke-08e-backup-import-confirmation.png`, and
`.manual-qa/android-ui-smoke-08f-backup-import-picker.png`.
The Provider pass must also prove a same-process Activity recreation instead of
treating `force-stop` as a substitute. Debug-only sanitized lifecycle markers
must show one configuration-change destruction and a distinct Activity instance
under the same PID for the landscape transition, then another such transition
when the original orientation is restored. The committed Provider credential
must remain masked with Save disabled in both orientations, and the harness must
restore and re-read the exact original `accelerometer_rotation` and
`user_rotation` values on every exit. Required frames are
`.manual-qa/android-ui-smoke-04c-activity-recreation.png` and
`.manual-qa/android-ui-smoke-04d-activity-recreation-restored.png`. The later
force-stop proof remains a separate process-relaunch persistence check.
The Android smokes intentionally tap exact settings-tab labels for Sync so the
top explanatory copy can mention sync without stealing the automation tap.
Pass `-- --no-install` if the current APK is already installed and should not
be replaced. For a manual build, run
`./gradlew assembleDebug` from `apps/android`; on Windows, use `gradlew.bat
assembleDebug`.
For release-package evidence, run `pnpm run build:android:release` followed by
`pnpm run check:android-release-size`. The check enforces the PRD `< 8MB` APK
budget against `apps/android/app/build/outputs/apk/release/app-release-unsigned.apk`
and writes `.manual-qa/android-release-size.json` with reviewer-friendly
byte/SHA-256, APK ZIP structure, and R8/resource-shrinking evidence.
Hosted CI also builds debug/release APKs and uploads them as artifacts after
the Android preflight, JVM unit-test, and release-size gates. The release APK
artifact must include `android-release-size.json` so
`scripts/hosted-native-ci-evidence-check.mjs` can bind the downloaded APK's
bytes/SHA-256 back to the PRD `< 8MB` gate, but those APK artifacts are not emulator or physical-device runtime QA. Keep `pnpm run
qa:android`/`pnpm run qa:android:current` as the runtime evidence path until a
dedicated emulator/device CI job exists and is proven reliable.

Then run `pnpm run check:android-cloud-sync-smoke`. It starts a temporary
Worker-compatible endpoint, drives Settings > Data and Settings > Sync through
UIAutomator, verifies that Android can upload encrypted sync data, and decrypts
the PBKDF2-SHA-256/AES-256-GCM vault with the same data password. Current
Android source writes the shared Cloudflare incremental manifest/message/Skill
object protocol when those Worker endpoints are available, and falls back to
the legacy `zerochat.encryptedSnapshot` path only for older Workers. This smoke
uses an `adb reverse` loopback URL, reads entered fields back from UIAutomator,
verifies Skill add/delete cleanup in the decrypted vault, grants
`POST_NOTIFICATIONS` on Android 13+ for the disposable profile, and verifies
posted `ZeroChat sync` / `Sync complete` sync-status notifications for initial
Cloudflare sync and manual pull-to-refresh. It does not
replace a disposable live Worker/R2 cleanup drill or physical-device release
pass. Exact-text automation rejects candidate button centers outside the current
hierarchy viewport's safe region so an offscreen Save node cannot tap the system
navigation area. After the IME closes, the source, local replacement, remote
restore, and process-relaunch credential captures must record viewport and field
bounds, then keep complete masked Provider fields above system navigation. The
manual-refresh upload wait remains finite but allows 360
polls for per-object PBKDF2 derivation on a slow emulator. The smoke writes
`.manual-qa/android-cloud-sync-smoke.json`, and
`pnpm run qa:android` then folds both Android smoke reports into the current
contact sheet so reviewers do not accidentally rely on stale overview images.
If the smoke screenshots already exist and only the overview needs refreshing,
run `pnpm run check:android-contact-sheet`.
`pnpm run qa:android` writes `.manual-qa/android-emulator-qa.json` linking the
two Android reports. Both Android smokes also pull the installed
`/data/app/.../base.apk` into `.manual-qa/`, hash that pulled copy, and require
it to match the freshly built debug APK. `pnpm run check:runtime-artifacts`
validates those reports, the installed-APK evidence, 55 Android UI screenshots,
15 Android Cloudflare screenshots, the combined 70-screenshot emulator QA
report, the 70-screenshot contact sheet, and the required quick-ask route,
dark-theme, system-Back, backup-picker, conversation-search,
delete-conversation, IME-open composer, message-menu, assistant Share chooser,
offline/reconnect Cloudflare sync, posted sync-status notification, and
pull-to-refresh Cloudflare sync, first-sync conflict, remote Provider-key
restore, safe credential framing, same-process Activity recreation, exact
rotation-setting restoration, and process-relaunch persistence screenshots when
they exist.

If preflight reports a JDK path but the Gradle Wrapper cannot find Java, set
`JAVA_HOME` to the JDK root that contains `bin\java.exe`, or add that `bin`
folder to `PATH`, then rerun the command. A parent tools directory is not enough
for `gradlew.bat`.

If the individual smoke test says no Android device or emulator is connected,
run `pnpm run qa:android` to let the helper start a local AVD. To do it
manually, start one of the listed AVDs first and wait for Android to finish
booting. On the bundled Windows test tools path that usually looks like:

```powershell
C:\ZeroChatAndroidTools\sdk\emulator\emulator.exe -avd ZeroChatPixelAscii -no-snapshot -no-audio -no-boot-anim
C:\ZeroChatAndroidTools\sdk\platform-tools\adb.exe kill-server
C:\ZeroChatAndroidTools\sdk\platform-tools\adb.exe start-server
C:\ZeroChatAndroidTools\sdk\platform-tools\adb.exe devices
```

Only rerun `pnpm run check:android-ui-smoke` or
`pnpm run check:android-cloud-sync-smoke` after `adb devices` shows a device in
the `device` state.

If the repository path contains non-ASCII characters and the emulator fails to
load QEMU BIOS files, keep the repository where it is and expose the temporary
Android SDK through an ASCII path or junction before creating the AVD. The APK
build itself should still run from the repository path.

Runtime checks:

- Run `pnpm run check:android-ui-smoke` and inspect the generated screenshots by
  eye before accepting the APK, including the dark-theme settings surface and
  the user and assistant long-press message menus. The automated smoke also
  verifies Android system Back closes Settings to Home and dismisses the
  delete-chat confirmation without deleting the chat.
- Inspect the required Activity-recreation frames and report. Confirm the PID is
  unchanged, Activity instance ids are distinct, the old instance reports a
  configuration-change destruction, the Provider credential stays masked with
  Save disabled, and the exact original rotation settings are restored. Repeat
  on a physical device when available; emulator proof does not replace manual
  device rotation and lifecycle QA.
- Install the debug APK on an emulator and on one physical phone if available.
- Verify one-handed chat ergonomics, system back behavior, IME open/close,
  long composer text, attachment controls, and destructive dialogs.
- Confirm the Android activity is edge-to-edge: the status and navigation bars
  are transparent over the app surface, the top app bar is not hidden under the
  status bar, and the composer/settings sheet stay above the navigation bar and
  IME in gesture and three-button navigation modes.
- On Android 12+, compare the app under at least two wallpaper/theme palettes:
  surfaces may follow Material You Dynamic Color, but primary actions must
  remain on the ZeroChat Indigo brand color. On Android 13/14+, use gesture
  navigation and confirm the predictive-back preview animation matches the
  automated system-Back close behavior instead of jumping or exiting
  unexpectedly.
- Use the Android conversation search field above the horizontal chat list:
  type text that matches a title, model, or previous message and confirm the
  list filters; type a non-matching term and confirm the localized no-results
  state appears, then clear search and confirm every chat returns.
- Add the Android home-screen widget, confirm its localized Quick Ask card uses
  the branded icon without clipped text, shows the checked-in picker preview
  and 2x2 target-cell sizing, exposes one localized card-level accessibility
  label, tap it from a cold start and while ZeroChat is already open, and
  verify each tap opens one fresh conversation with the composer focused. It
  must not auto-send, create duplicate app instances, or lose the previous app
  state. The automated emulator smoke verifies provider registration through
  Android system services; launcher gallery placement and rendered widget card
  still need manual device QA.
- Long-press an assistant reply and confirm the Material menu includes Share,
  Copy, Regenerate, and Delete. Tap Share, confirm Android opens the system
  share chooser with the assistant text, then cancel and verify the chat state
  is unchanged. Long-press a user message and confirm it keeps Edit and resend
  instead of the assistant-only Share action.
- Switch the app language after syncing or creating providers and confirm
  default relay names relocalize while user-renamed provider names stay intact.
- Confirm encrypted backup export/import use Android's system document picker;
  the automated smoke covers picker launch and import acknowledgement, while a
  physical-device or full manual restore pass should still import a real
  disposable backup file and verify the restored provider keys and Skill data.
- Confirm Android Keystore or EncryptedSharedPreferences secrets survive app
  restart but not uninstall/reinstall.
- Configure Cloudflare mode with a disposable Worker, enter a data password,
  edit a provider, Skill, and conversation, then confirm Android writes the
  same encrypted data the Web/PWA can decrypt with the same password. On a
  current Worker, verify `/sync/head` points to a manifest object, message
  chunks are restored on Web/PWA, Skill add/edit/delete changes sync, and stale
  `skill-*.json`/`chunk-*.json` objects are cleaned after the new head is
  accepted. Repeat after app restart.
- With Cloudflare configured, pull down on the Android chat transcript. Confirm
  the Material 3 refresh indicator triggers the encrypted Cloudflare sync path,
  succeeds even if the Cloudflare auto-sync toggle is off, shows localized
  status, and refuses to refresh while an assistant response is streaming.
- In Android system notification settings, confirm ZeroChat exposes the
  `zerochat_sync_status` sync-status channel. On Android 13+, grant
  notifications for a disposable profile before a sync pass and verify waiting,
  failed, and completed sync notifications are quiet, use the branded small
  icon, and open ZeroChat when tapped. The automated Cloudflare smoke covers the
  granted-permission and posted completed-notification proof for the emulator;
  physical-device shade behavior still needs a manual release pass.
- Export and import an encrypted backup through the Android document picker in a
  disposable profile, then confirm restored provider keys, Skill content, and
  next sync behavior match the Web/PWA vault protocol.
- Put the device offline, edit local data, reconnect, and confirm foreground
  sync resolves cleanly.

## Apple

Prerequisites:

- macOS
- Xcode
- Swift toolchain
- Checked-in `ZeroChat.xcodeproj` shared `ZeroChat` scheme that includes `App/`
  and links `ZeroChatCore`
- iOS simulator, macOS run target, and physical iPhone or iPad when available

Commands:

```bash
pnpm run check:native-prereqs -- --platform=apple
pnpm run qa:apple
cd apps/apple
swift build
xcodebuild -project ZeroChat.xcodeproj -scheme ZeroChat -destination 'platform=macOS' -derivedDataPath ../../.manual-qa/apple-derived-data CODE_SIGNING_ALLOWED=NO build
cd ../..
bash scripts/apple-runtime-smoke.sh .manual-qa/apple-derived-data/Build/Products/Debug/ZeroChat.app
node scripts/runtime-smoke-artifact-check.mjs --only-native-prereq-report --require-native-prereq=.manual-qa/native-prereq-apple.json
node scripts/runtime-smoke-artifact-check.mjs --only-runtime-artifact --require-runtime-artifact=apple
```

`pnpm run qa:apple` is the repeatable target-host macOS runtime-smoke entry:
it writes `.manual-qa/native-prereq-apple.json`, compiles the SwiftPM app
product, builds the Xcode shared scheme into `.manual-qa/apple-derived-data`,
captures `.manual-qa/apple-runtime-smoke.png`, writes
`.manual-qa/apple-runtime-smoke.json`, and validates the preflight report plus
runtime artifacts with focused gates. It must run on macOS with Xcode/Swift installed and still does not
replace the iOS/iPad simulator, physical-device, archive/signing/notarization,
sync, file-picker, Keychain, or destructive-action passes below.

Open the checked-in app target in Xcode for iOS/iPadOS simulator, device,
archive, signing, and notarization QA.

Runtime checks:

- Test iPhone portrait, iPhone landscape, iPad split view, and macOS resizable
  windows.
- On macOS, confirm the main window opens at a practical desktop size and
  cannot be resized below the PRD minimum 900x600; inspect the smallest allowed
  window by eye for clipped controls, overlapped text, and unreachable actions.
- Review `.manual-qa/apple-runtime-smoke.png` after the headless macOS smoke;
  the script captures the ZeroChat app window itself, and it must show the app
  opened and painted, not a blank or collapsed screenshot.
- Review `.manual-qa/apple-runtime-smoke.json` with the screenshot; it records
  the captured process, window id/title, dimensions, byte size, sampled colors,
  launched executable byte/SHA-256 evidence, the app bundle file manifest, and
  `captureTarget: "app-window"`.
- Switch the app language after syncing or creating providers and confirm
  default relay names relocalize while user-renamed provider names stay intact.
- Verify Keychain secrets survive restart and behave correctly on clean
  simulator/device installs.
- On iPhone and iPad, pull down in both the conversation list and the active
  chat transcript. Confirm the native refresh spinner triggers the Cloudflare
  encrypted sync path, shows localized success/waiting/error status, and refuses
  to run while an assistant response is still streaming.
- Check keyboard avoidance, scroll position, sidebar behavior, menus, native
  file pickers, and high-risk dialogs.
- Press `Cmd+N` from the chat window and confirm Apple creates exactly one new
  empty conversation, selects it, and moves focus to the composer so hardware
  keyboard users can type immediately.
- On macOS, use the native menu commands: File > New Chat (`Cmd+N`) must create
  exactly one conversation and focus the composer, File > New Window
  (`Shift+Cmd+N`) must open another main window, Chat > Search Chats (`Cmd+K`)
  must focus the sidebar search, and Chat > Stop (`Cmd+.`) must be disabled
  until streaming and then stop the active generation.
- With at least two macOS main windows open, use the system Window menu to merge
  windows into native tabs and confirm both tabbed windows remain usable.
- With two macOS main windows open, select different conversations in each
  window. Confirm changing the sidebar selection, model, prompt draft, sending,
  regenerating, and deleting a message in one window does not force the other
  window to switch away from its selected conversation.
- On macOS, use the ZeroChat menu-bar icon and confirm it renders the branded
  monochrome glyph instead of a system placeholder. Confirm Show main window
  reopens and activates the app, New chat creates exactly one conversation
  through the same shared chat state, and Quit exits through the native app
  termination path.
- On macOS Sonoma+, add the ZeroChat Quick Ask Desktop Widget to the desktop or
  Notification Center, confirm the localized compact widget renders without
  clipped text in small and medium families, mirrors Arabic RTL layout when the
  system language is Arabic, exposes one localized VoiceOver label plus hint,
  click it, and confirm ZeroChat opens a fresh conversation with the composer
  focused. It must not auto-send, duplicate a chat, or lose the existing app
  state.
- Press `Cmd+K` from the chat window and confirm Apple presents the native
  SwiftUI `.searchable` conversation search field. Type text that matches a
  title, model, or previous message and confirm the list filters; type a
  non-matching term and confirm the localized no-results state appears, then
  clear search and confirm every chat returns.
- On a fresh iOS 17+ or macOS 14+ profile, open an empty chat and confirm the
  TipKit first-use prompt appears on the native setup action that matches the
  current gap, such as Add provider key, Add model, or Add AI provider, with
  localized copy. Confirm iOS 16 launches the same screen without the TipKit
  prompt and without a crash.
- On iOS/iPadOS/macOS, create or rename a conversation, background the app, and
  confirm Spotlight/system search can find the conversation by title and reopen
  the ZeroChat app. Also confirm deleted conversations disappear from Spotlight
  after the next app save.
- From Safari, Notes, and another text-heavy app, use the iOS/iPadOS system
  share sheet, choose Send to ZeroChat, and confirm the Share Extension accepts
  text and URLs, opens ZeroChat, puts the shared content into the composer as a
  draft, focuses the composer, and does not send or sync anything until the user
  taps Send.
- Press `Cmd+,` from the chat window and confirm macOS opens the independent
  Settings window on the Appearance tab with native tab pagination. On iOS and
  iPadOS, confirm the same action path still opens the Settings sheet with the
  same state as the toolbar gear button.
- Press `Cmd+W` from the chat window and confirm Apple closes the active app
  window through the native window close path without adding a visible in-chat
  control.
- Type a chat prompt, press `Cmd+Enter`, and confirm Apple sends through the
  same validation path as the Send button; while streaming, confirm the same
  shortcut activates the visible Stop state instead of creating another turn.
- While Apple is streaming a response, press `Cmd+.` and confirm it stops the
  current generation, preserves the partial assistant text, and does not create
  another user or assistant turn.
- Long-press on a user message and an assistant message, or right-click on
  macOS, and verify the native context menu exposes Copy plus the role-specific
  edit-and-resend or regenerate action and Delete. These actions must not stay
  permanently visible under every message bubble.
- On iOS/iPadOS, long-press user and assistant messages and confirm the Haptic
  Touch preview card shows the message text, timestamp, and attachment preview
  before choosing an action. On macOS, confirm right-click still opens the menu
  even though the platform does not show the SwiftUI preview card.
- Configure a disposable Cloudflare Worker that already contains Web/PWA
  incremental sync data, enter the same data password, and confirm Apple
  restores the remote manifest, message chunks, Skill chunks, and provider keys
  without asking users to clear cloud data. Then edit a Skill and conversation
  on Apple and confirm Web/PWA receives the incremental update and stale remote
  objects are cleaned.
- On macOS, allow notifications when prompted, perform a manual Cloudflare
  refresh, and confirm Notification Center receives the localized sync-complete
  notification. Then make several rapid local edits and confirm automatic sync
  completion notifications are throttled instead of spamming Notification
  Center.
- With iCloud Handoff enabled on an iPhone/iPad and Mac signed into the same
  Apple ID, open a synced conversation on one device, use the Handoff entry on
  the other, and confirm ZeroChat opens the same conversation and focuses the
  composer without creating a duplicate chat.
- On a MacBook Pro with Touch Bar, confirm the Touch Bar shows the localized
  Send control when a valid prompt is ready, disables it for invalid empty
  input, and changes to Stop while an assistant response is streaming.
- Export and import an encrypted backup through SwiftUI document import/export
  in a disposable profile, then confirm restored provider keys, Skill content,
  and next sync behavior match the Web/PWA vault protocol.
- Archive once in Xcode before release and confirm there are no signing,
  entitlement, or localization warnings.

## Windows

Prerequisites:

- Windows 11
- Visual Studio with C++ workload
- Windows App SDK / WinUI 3
- MSBuild
- A checked-in `.sln`, `.vcxproj`, or packaging project so the app can be built
  without manually recreating the Visual Studio project

Commands:

```powershell
pnpm run check:native-prereqs -- --platform=windows
pnpm run qa:windows
pnpm run build
pnpm run build:windows:release
pnpm run qa:windows-webview
msbuild apps\windows\ZeroChat.sln /restore /p:Configuration=Debug /p:Platform=x64
msbuild apps\windows\ZeroChat.sln /restore /p:Configuration=Release /p:Platform=x64
pnpm run build:windows:msix
pnpm run package:windows:msix
pnpm run qa:windows-msix
pnpm run qa:windows-msix-trusted:elevated
pnpm run check:windows-msix-trusted-report
```

Build the checked-in WinUI solution or project, then package MSIX from the same
configuration used for release. `pnpm run qa:windows` is the shortest local
pass: it runs the WebView runtime smoke, rebuilds the MSIX-ready Release output,
packages a fresh local MSIX, and runs the default non-mutating install QA dry
run. The Windows build helper now SHA-256 verifies
the copied Debug and Release WebView `web\` folders against current `dist\`.
Run `pnpm run qa:windows-webview` after the unpackaged Release build to open
`ZeroChat.exe`, capture `.manual-qa\windows-webview-runtime-smoke.png` from the
actual app window, write `.manual-qa\windows-webview-runtime-smoke.json`, reject
blank/collapsed screenshots, record the current `dist\` and copied `web\`
SHA-256 manifests, close the app, and require the shared runtime-artifact gate
with `--only-runtime-artifact --require-runtime-artifact=windows` before
continuing to MSIX packaging.
Use `-MsixReady` before packaging so the executable uses packaged Windows App
Runtime activation instead of the unpackaged bootstrapper. The checked-in
package script produces an unsigned local MSIX by default and can sign it when
`-CertificatePath` points to a PFX. It also refuses to package stale copied
Web/PWA assets when the release output `web\` folder differs from current
`dist\`, and rejects Windows output missing the `zerochat-build-mode.txt`
MSIX-ready marker. The install QA helper
inspects the newest `.manual-qa\ZeroChat_*.msix` when no package path is passed
and defaults to a non-mutating dry run. This deliberately includes a fresh
unsigned package so stale signed artifacts cannot hide the current build. If the
  package is unsigned, dry run reports that status and tells the tester to sign
first instead of mutating the Windows profile. Signed dry runs also report
whether the signature is trusted and whether certificate trust is still
required. Use `-Install` for first-install QA, `-Update` only after a previous
signed build is already installed, and `-Uninstall` for cleanup. For self-signed
QA packages, Windows App Installer must trust the signing leaf in Local Machine
Trusted People before install/update QA; use a disposable QA profile and an
elevated PowerShell. Pass `-TrustMachineCertificate` and
`-TrustedCertificatePath <public .cer>` for that disposable pass, then pair
`-RemoveTrustedMachineCertificate` with `-Uninstall`. Do not import a leaf
package-signing certificate into Current User Trusted People or Local Machine
Root. The optional `-TrustSigningRoot` path is reserved for an actual CA root
and rejects non-CA certificates. The low-level helper exposes no Current User
trust switch; only the outer cleanup retains historical-residue removal.
`pnpm run qa:windows-msix-trusted:elevated` is the repeatable
one-command path for the disposable current-package pass: it refreshes host
preflight, rebuilds the current Web/PWA bundle and Windows MSIX-ready Release
output, and signs previous/current MSIX packages from that output only after
the refreshed preflight passes the strict current-clear gate. An unreadable
AppXDeploymentServer log aborts without replacing the previous report. It then installs the
previous version, captures the packaged app window, updates, captures again,
uninstalls, removes temporary trust/private key/package data/workspace
directories, validates the trusted/full runtime-artifact gates, validates
cleanup, and writes
`.manual-qa\windows-msix-current-trusted-install-update-qa.json` with package
byte/SHA-256 evidence and `dist\` versus packaged `web\` asset manifests. The
lower-level `pnpm run qa:windows-msix-trusted` script remains the wrapper's
implementation. Pass trust, install, update, or cleanup switches only on a
disposable QA machine or profile.
If the host AppX deployment service blocks that pass before ZeroChat can
complete install/update/uninstall proof, the same command writes
`.manual-qa\windows-msix-current-trusted-install-update-qa.failure.json` as
diagnostic-only host AppX evidence with `releaseEvidence: false`; older failed
runs are historical diagnostic evidence. Historical diagnostic reports can classify
`windows-appx-deployment-deleted-package-cleanup-access-denied` under
`C:\Program Files\WindowsApps\Deleted`, but the latest historical failure report
remains diagnostic-only. Current host status is report-derived, never hard-coded
in this guide: inspect `.manual-qa/windows-msix-host-preflight.json`. A blocked
host must be repaired or replaced before trusted QA; a clear non-elevated host
must rerun from an elevated disposable Windows profile. If preflight reports the
Deleted cleanup classifier, use a fresh disposable profile or VM, or repair the
external AppX cleanup state, before rerunning
`pnpm run qa:windows-msix-trusted:elevated`,
`pnpm run check:windows-msix-trusted-report`, and
`pnpm run check:runtime-artifacts`.
To check that host state without importing certificates or installing packages,
run `pnpm run report:windows-msix-host-preflight` followed by
`pnpm run check:windows-msix-host-preflight`; the read-only report records
recent AppXDeploymentServer cleanup events, AppX service state, sanitized
Windows Restart Manager lock holders, and whether the known WindowsApps
Deleted cleanup blocker is still visible. Restart reported lock-holder
applications first; if unlocked targets remain after the next preflight, then
repair the wider AppX state or use a fresh disposable profile/VM.
When that current failure report is still present, the trusted QA helper fails
fast before creating another temp run. After verifying the host has been
repaired, rerun
`pnpm run qa:windows-msix-trusted:elevated -- -SkipKnownHostBlockerPreflight`
only to bypass the historical-report preflight.
Runtime-artifact validation treats a newer failure report as the current
trusted-MSIX blocker until a newer passing report exists.

Runtime checks:

- Test normal desktop size, narrow window, high DPI scaling, keyboard-only tab
  order, and dialog focus return.
- Resize from a normal desktop window to the 900x600 floor and confirm Windows
  cannot shrink below it. After minimize-to-tray restore, confirm
  `.manual-qa\windows-webview-runtime-smoke.json` records at least 900x600 and
  the screenshot remains nonblank.
- Run `pnpm run qa:windows-webview` and inspect
  `.manual-qa\windows-webview-runtime-smoke.png` by eye. Also inspect
  `.manual-qa\windows-webview-runtime-smoke.json`; it records the executable,
  Web index, process id, window handle, window rectangle, dimensions, screenshot
  bytes, sampled colors, non-dark ratio, current/captured Web asset manifests,
  and `CaptureTarget = "app-window"`.
- Verify the WebView2 shell loads the copied PWA bundle through the virtual HTTPS
  host instead of a blank `file://` page.
- Minimize the window to tray, confirm the desktop window disappears while the
  tray icon remains, then restore from the tray menu. The guarded source path
  must collapse the WebView2 control and call `TrySuspendAsync()` while hidden,
  then call `Resume()` and show the WebView again before user interaction.
  Also run `pnpm run qa:windows-webview`; its Win32 restore probe uses
  `ShowWindow(SW_RESTORE)` and should still capture a nonblank WebView.
- In the packaged Windows app, right-click the Start/taskbar shortcut and run
  the Jump List Quick Ask, Search Chats, and Settings tasks. Confirm Quick Ask
  opens a new composer-focused chat, Search Chats focuses the conversation
  search field, and Settings opens Settings > Appearance after the WebView2
  surface finishes loading.
- In the packaged Windows app, configure a disposable Gist or Cloudflare sync
  target, run sync-complete and sync-failure passes, and confirm Windows Notification Center receives the localized sync-status toast without showing
  tokens, passphrases, Gist ids, Worker endpoints, or chat content.
- Switch the app language after syncing or creating providers and confirm
  default relay names relocalize while user-renamed provider names stay intact.
- Verify Skill add, edit, delete, lazy chunk storage, and sync behavior in the
  Windows shell match the Web/PWA visual audit.
- If the native bridge is enabled for secrets or storage, verify Credential
  Locker storage survives restart and fails safely after credential removal.
- Check MSIX install, launch, update over the previous build, and uninstall.
  Prefer `pnpm run qa:windows-msix-trusted:elevated` on an elevated disposable QA
  profile for the repeatable current-package evidence.
- Check the installed app in Start, taskbar, Alt-Tab, and the tray: the branded
  icon should render sharply at small sizes. The package must keep the
  `Square44x44Logo.targetsize-*` and `*_altform-unplated` assets alongside the
  tile logos.

## Linux

Prerequisites:

- Linux desktop host or WSL distro for build/runtime QA
- Rust toolchain
- `pkg-config`
- GTK4 development packages
- libadwaita development packages
- For CI/headless smoke: `xvfb`, `xdotool`, `imagemagick`, and `dbus-x11`
- Secret Service provider, such as GNOME Keyring or KWallet

Commands:

```bash
pnpm run check:native-prereqs -- --platform=linux
pnpm run check:linux-packaging
pnpm run qa:linux
cd apps/linux
cargo check
cargo build --release
cd ../..
bash scripts/linux-runtime-smoke.sh apps/linux/target/release/zerochat-linux
node scripts/runtime-smoke-artifact-check.mjs --only-native-prereq-report --require-native-prereq=.manual-qa/native-prereq-linux.json
node scripts/runtime-smoke-artifact-check.mjs --only-runtime-artifact --require-runtime-artifact=linux
```

`pnpm run qa:linux` is the repeatable target-host Linux runtime-smoke entry:
it writes `.manual-qa/native-prereq-linux.json`, builds the locked release
binary, captures `.manual-qa/linux-runtime-smoke.png` under Xvfb, writes
`.manual-qa/linux-runtime-smoke.json`, and validates the preflight report plus
runtime artifacts with focused gates. It must run on Linux or WSL with Rust, `pkg-config`, GTK4,
libadwaita, Secret Service tooling, Xvfb, xdotool, ImageMagick, and `dbus-x11`
installed, and still does not replace the interactive desktop, sync,
file-picker, Secret Service, or destructive-action passes below.
`pnpm run check:linux-packaging` validates the checked-in
`app.zerochat.client` desktop entry, AppStream metainfo, GNOME 50 Flatpak
manifest, Secret Service D-Bus permission, network/window sandbox permissions,
AppImage AppDir staging script, linuxdeploy/appimagetool handoff, and icon
install paths. It is source/package metadata evidence only; it does not build
or launch a Flatpak/AppImage package or sandbox on Windows.

Runtime checks:

- Test on Wayland and X11 if possible.
- Review `.manual-qa/linux-runtime-smoke.png` when running the headless smoke;
  the script captures the ZeroChat GTK window itself after checking its geometry.
  It only proves the app opens a nonblank window, not full release quality.
- Review `.manual-qa/linux-runtime-smoke.json` with the screenshot; it records
  the captured binary, window id/title, window dimensions, screenshot size,
  distinct colors, launched binary byte/SHA-256 evidence, and
  `captureTarget: "app-window"`.
- Confirm installed Linux builds expose the `app.zerochat.client` desktop entry
  with the branded hicolor app icon in the launcher/task switcher.
- From the desktop shell launcher menu, trigger Quick Ask, Search Chats, and
  Settings actions. Confirm Quick Ask opens a fresh conversation with composer
  focus, Search Chats focuses the sidebar search field, and Settings opens the
  native `AdwPreferencesWindow` on the Appearance page. If the shell exposes
  localized action labels, verify the label language matches the current
  desktop locale.
- Resize from wide desktop to the requested 900x600 minimum and confirm the GTK
  window does not shrink below that boundary. Inspect settings, sidebars,
  dialogs, and composer controls at 900x600 and confirm they remain reachable.
- Confirm the main Linux shell is backed by `AdwNavigationSplitView`: the
  sidebar/content pages are visible at desktop width, the sidebar target width
  is about 280px, and narrow GNOME windows collapse through the libadwaita
  navigation behavior instead of squeezing a fixed two-column box.
- Press `Ctrl+N` from the GTK window and confirm Linux creates exactly one new
  empty conversation, selects it, and moves focus to the composer so keyboard
  users can type immediately.
- Press `Ctrl+K` from the GTK window and confirm Linux moves focus to the
  sidebar conversation search field. Type text that matches a title, model, or
  previous message and confirm the list filters; type a non-matching term and
  confirm the localized no-results state appears, then clear search and confirm
  every chat returns.
- Press `Ctrl+,` from the GTK window and confirm Linux opens a native
  `AdwPreferencesWindow` with grouped Appearance, AI providers, Models, Skills,
  Sync, and Data pages. Confirm the header Settings button opens the same
  window instead of replacing the chat surface in the main window.
- Trigger delete conversation, reset local data, reset/change sync password,
  clear cloud data, and encrypted-backup import confirmations. Confirm each
  one is an attached `AdwMessageDialog`, Esc/window close keeps the cancel
  path, and the accepted destructive action uses the libadwaita destructive
  response styling.
- Press `Ctrl+W` from the GTK window and confirm Linux closes the active GTK
  application window.
- Type a chat prompt, press `Ctrl+Enter`, and confirm Linux sends through the
  same validation path as the Send button; while streaming, confirm the same
  shortcut activates the visible Stop state instead of creating another turn.
- Switch the app language after syncing or creating providers and confirm
  default relay names relocalize while user-renamed provider names stay intact.
- Edit an existing user message, confirm the GTK dialog keeps text readable,
  rejects empty content, removes stale later replies, saves the edited turn, and
  enqueues the normal sync path.
- Regenerate an existing assistant message, confirm GTK keeps the earlier prompt,
  removes stale later replies, updates the assistant row, and enqueues the normal
  sync path.
- Right-click and long-press a user message and an assistant message, confirm the
  GTK popover menu exposes Copy plus the role-specific edit-and-resend or
  regenerate action and Delete, and confirm those actions are not permanently
  visible under every message bubble.
- Reset local data from the Data screen, confirm the warning copy says cloud
  ciphertext is not actively deleted, cancel once, then confirm once and verify
  the app returns to the default local state.
- Save a data password in Data settings, confirm the password field clears, make
  a local edit, and verify Cloudflare auto-sync uses the session secret without
  writing the password to `snapshot.v1.json`; reset the sync password and confirm
  the high-risk warning explains old cloud data still needs the old password.
- Export an encrypted backup, import it through the GTK confirmation flow in a
  disposable profile, and confirm the restored snapshot, provider keys, and next
  sync behavior match the Web/PWA vault protocol.
- Save and clear a provider API key, confirm the field clears after save, and
  verify the key is not written to `snapshot.v1.json`. With sync configured,
  verify the key appears only inside the encrypted vault and is not exposed as
  plaintext local data.
- Verify Secret Service storage, offline edits, reconnect sync, and clear-cloud
  cleanup.
- Configure a disposable Cloudflare Worker that already contains Web/PWA
  incremental sync data, enter the same data password, and confirm Linux
  restores the remote manifest, message chunks, Skill chunks, and provider keys
  without asking users to clear cloud data. Then edit a Skill and conversation
  on Linux and confirm Web/PWA receives the incremental update and stale remote
  objects are cleaned.
- Confirm Linux Skill settings, paste add, file import, edit, toggles, delete,
  and persistence behave correctly on the target GTK runtime before treating
  Linux Skill editing as release-complete.
- Package once as Flatpak or AppImage before release. For Flatpak, start from
  `apps/linux/packaging/flatpak/app.zerochat.client.yml`, run the target-host
  build, install the package, and verify sandbox permissions match sync,
  network, Secret Service, Downloads, file handoff, Wayland, and X11 fallback
  needs. For AppImage, start from
  `apps/linux/packaging/appimage/build-appimage.sh --appdir-only`, inspect the
  staged AppDir desktop entry, AppStream metadata, icon roots, and `AppRun`,
  then rerun without `--appdir-only` with `linuxdeploy` or `appimagetool`
  installed and smoke the resulting `.AppImage`.
