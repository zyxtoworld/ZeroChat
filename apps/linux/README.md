# ZeroChat for Linux

Stack: Rust + GTK4/libadwaita.

Rationale:

- Rust provides fast startup, low memory overhead, and strong implementation safety for a lightweight desktop tool.
- GTK4/libadwaita integrates naturally with GNOME, Flatpak, and the Secret Service ecosystem.
- Linux distribution differences are significant; a Rust binary with Flatpak packaging provides a stable distribution path.

## Build

Run Linux QA on a real Linux host or inside WSL. Windows/macOS `cargo` is not
enough because GTK4/libadwaita runtime behavior must be checked on Linux.

From the repository root, run the preflight first:

```bash
pnpm run check:native-prereqs -- --platform=linux
```

For the repeatable target runtime-smoke pass from the repository root, prefer:

```bash
pnpm run qa:linux
```

It writes `.manual-qa/native-prereq-linux.json`, builds the locked release
binary, runs `scripts/linux-runtime-smoke.sh` under Xvfb against
`apps/linux/target/release/zerochat-linux`, captures
`.manual-qa/linux-runtime-smoke.png`, writes
`.manual-qa/linux-runtime-smoke.json`, and validates both the preflight and
runtime smoke artifacts. This command must run on Linux or WSL with Rust,
`pkg-config`, GTK4, libadwaita, Secret Service tooling, Xvfb, xdotool,
ImageMagick, and `dbus-x11`; it still does not replace interactive GNOME visual
QA, sync, file-picker, Secret Service, or destructive-action checks.

Then install Rust plus the GTK4/libadwaita development packages for the target
distribution. The Rust `gtk4` bindings use `pkg-config`, so `pkg-config` must
also be available on `PATH`.

Common package names:

- Debian/Ubuntu: `pkg-config libgtk-4-dev libadwaita-1-dev libsecret-tools`
- Fedora: `pkgconf-pkg-config gtk4-devel libadwaita-devel libsecret`
- Arch Linux: `pkgconf gtk4 libadwaita libsecret`

```bash
cd apps/linux
cargo check
cargo run
cargo build --release
```

For a headless CI smoke on Linux, install `xvfb`, `xdotool`, `imagemagick`, and
`dbus-x11`, then run from the repository root:

```bash
bash scripts/linux-runtime-smoke.sh apps/linux/target/release/zerochat-linux
```

This only proves the GTK app can open a nonblank window and produce
`.manual-qa/linux-runtime-smoke.png`; it does not replace the interactive
desktop checks below.

For focused Linux package-size evidence, keep the checked release binary under
`.manual-qa/` and run:

```bash
pnpm run check:linux-release-size -- --binary=.manual-qa/<file>
node scripts/runtime-smoke-artifact-check.mjs --require-runtime-artifact=linux-release-binary
```

The size check writes `.manual-qa/linux-release-size.json`, records binary
byte/SHA-256 evidence with a repo-relative path, marks the report
`safeToPublish`, verifies the file has ELF magic, and enforces the PRD `< 10MB`
Linux release binary budget. It is package-size evidence only, not GTK runtime,
Secret Service, sync, file-picker, Flatpak/AppImage sandbox, or destructive-action
QA.

Do not call Linux release QA complete until `cargo check`, an interactive
`cargo run`, small-window visual QA, language switching, provider/model setup,
image file picking/generation, Skills, sync conflict choices, and destructive
confirmations have all been checked on the target Linux desktop session.

## Requirements

- Provider types must support `openai-compatible`, `openai-responses`, and `anthropic`.
- AI API keys are required and synchronized only after entering the end-to-end encrypted vault.
- AI Base URLs must be remote HTTPS URLs. HTTP, localhost, private network, and LAN addresses are rejected.
- Production AI, Cloudflare, and Gist reqwest clients must reject automatic redirects before attaching API keys or sync credentials; configure the final trusted endpoint directly.
- The shared sync reqwest client must keep both connect and total request timeouts at 60 seconds so headers or streamed bodies cannot retain synchronization work indefinitely.
- Cloudflare and Gist responses must use `sync_http_body.rs` streaming limits: reject oversized declared lengths, stop consuming the reqwest byte stream on overflow, and byte-check snapshot/object/head uploads before send.
- The native AI client must support provider model-list retrieval, Worker proxy action headers, image generation, image editing, and inpainting through the shared provider contract.
- `src/main.rs` stays a PRD-thin binary launcher that calls
  `zerochat_linux::run()`, while `src/lib.rs` owns the Linux crate module tree
  and public run wrapper.
- `src/ai.rs` stays focused on the native `AiClient` request dispatch surface,
  while `src/ai_protocol.rs` owns Provider request DTOs, context trimming, safe
  remote HTTPS URL validation, Cloudflare proxy headers, model/image response
  parsing, and OpenAI/Responses/Anthropic SSE delta parsing.
- `src/chat_view.rs` stays focused on the main chat page, message list, and
  setup CTA shell, while `src/chat_composer.rs` owns the composer surface,
  Ctrl+Enter routing, and refresh loop. `src/chat_send_actions.rs` owns
  send/Stop dispatch, streaming UI state, and chat/image request completion
  wiring. `src/chat_mode_controls.rs` owns the chat/image and
  generate/edit/inpaint mode toggles, and `src/chat_image_controls.rs` owns
  image source/mask picker rows, clear actions, and compact-window visibility
  updates for image edit and inpaint mode.
- `src/settings_window.rs` stays focused on the inline Settings page and native
  `AdwPreferencesWindow` shell, while `src/appearance_settings.rs` owns theme,
  language, compact display, and settings-surface refresh after Appearance
  changes.
- Cloudflare sync must support `DELETE /sync/clear` for clearing remote ZeroChat sync data without deleting local data.
- GitHub Token remains local to the device and uses Secret Service when available. Cloudflare access is derived from the data encryption password.
- The first local persistence implementation may use `snapshot.v1.json`. Production builds should use SQLite.
- Provider keys and the data encryption password use Secret Service through
  `secret-tool` when available, with session-memory fallback when the desktop
  secret service is missing or locked.
- Desktop integration uses app id `app.zerochat.client`, a checked-in
  `.desktop` entry, hicolor scalable/symbolic SVG icons, and the GTK window
  `icon_name` binding so installed builds present the branded app icon. The
  sidebar brand row also renders the same app id icon beside the ZeroChat title
  so source builds do not look like a text-only shell.
- The same desktop entry exposes localized launcher actions for Quick Ask,
  Search Chats, and Settings. `zerochat-linux --quick-ask` opens a fresh chat
  with composer focus, `zerochat-linux --search-chats` focuses the conversation
  search field, and `zerochat-linux --settings` opens the native Settings
  window on launch.
- Packaging metadata uses the same app id through
  `data/app.zerochat.client.metainfo.xml` and
  `packaging/flatpak/app.zerochat.client.yml`. AppImage target-host packaging
  starts from `packaging/appimage/build-appimage.sh`, which stages the same
  binary, desktop entry, AppStream metadata, and hicolor icons into an AppDir
  before invoking `linuxdeploy` or `appimagetool`. Run
  `pnpm run check:linux-packaging` before target-host Flatpak/AppImage work;
  this source check validates the desktop entry, AppStream launchable metadata,
  GNOME 50 Flatpak runtime, Secret Service D-Bus permission, network/window
  sandbox permissions, AppImage AppDir staging, and icon installation paths.
- The main GTK window opens at 1180x760 and requests a 900x600 minimum so the
  sidebar, settings groups, dialogs, and composer have a concrete visual QA
  boundary instead of shrinking into unusable layouts.
- Settings opens as a native `AdwPreferencesWindow` with
  `AdwPreferencesPage`/`AdwPreferencesGroup` sections for Appearance,
  providers, models, Skills, Sync, and Data.
- The main chat shell uses `AdwNavigationSplitView` with `AdwNavigationPage`
  sidebar/content pages and a 280px target sidebar, so narrow GNOME windows can
  collapse through libadwaita instead of a hand-rolled fixed horizontal box.
- Destructive confirmations use `AdwMessageDialog` with cancel as the close and
  default response plus libadwaita destructive styling for the accepted action.
- Recommended distribution formats: Flatpak and AppImage. The checked-in
  Flatpak manifest and AppImage AppDir script are packaging metadata/source
  evidence only; they still need Linux target-host package builds plus sandbox,
  Secret Service, file-picker, sync, and visual QA before release claims.

## UI Scope

The GTK/libadwaita app now exposes the native parity screen surface:
`AdwNavigationSplitView` conversation/content layout, merged provider/model
dropdown, live chat/image composer modes, native source/mask image picking,
image generation/edit/inpaint request paths, generated-image attachment
actions, right-click/long-press message popover actions, command-line routed
launcher actions for Quick Ask/search/Settings, a native `AdwPreferencesWindow`
settings surface with six grouped sections, `AdwMessageDialog` destructive
confirmations, provider configuration, model management, Skill management
controls, Gist/Cloudflare sync mode explanations and manual sync actions, data
encryption password save/reset controls with high-risk change warnings, reset
local data, a 1180x760 default desktop window with a 900x600 minimum,
Flatpak/AppImage/AppStream packaging metadata, and Gist/Cloudflare clear-cloud
actions that still need Linux runtime release QA.

Appearance settings now read and write the shared `snapshot.v1.json` store:
theme, language, and compact display are applied immediately and persisted for
the next launch. This is still source-level evidence in this Windows workspace;
Linux desktop runtime QA remains required before release.

Chat turns now read from and write to the shared `conversations` snapshot data:
sending a message creates or updates the active conversation, appends the user
turn plus a pending assistant turn, injects only pinned/relevant Skill snippets
within the context budget, and calls the native `AiClient` on a background
thread so GTK stays responsive. The completed assistant turn is saved through
the same `snapshot.v1.json` and auto-sync path. Persisted message rows expose
Copy, edit-and-resend or regenerate, and Delete through a GTK popover menu
instead of permanent inline action buttons. Those actions rewrite the shared
snapshot safely, but their live re-run path still needs target Linux runtime QA
before being advertised as release-complete.
`src/messages.rs` owns message bubble layout and streaming display text, while
`src/message_actions.rs` owns the right-click/long-press copy, edit-and-resend,
assistant regenerate, and delete popover actions. `src/app_state/chat_state.rs`
keeps the save/provider-dispatch orchestration, while
`src/app_state/chat_message_state.rs` owns the pure active-message delete,
assistant regenerate, user edit-and-resend, streaming update, and
completion/attachment replacement rules with focused Rust unit tests for the
mutation edge cases.

Image mode now uses real GTK toggles instead of disabled preview buttons. Text
to image calls the native `AiClient.generate_image` path; edit and inpaint use
the GTK file picker for source and mask images, then call
`AiClient.edit_image` with multipart uploads. Source, mask, and generated image
attachments are written to the shared conversation snapshot so the normal
encrypted save/sync path sees the same data. `src/message_attachments.rs` owns
generated image attachment labels, download-to-Downloads, and desktop open
actions.
Download/open actions for generated image attachments are source-wired, but
target Linux runtime QA is still needed for file picker behavior, provider
responses, and desktop opener integration.

The sidebar is no longer a static preview for chat state: it keeps the branded
app icon beside the ZeroChat title, exposes a cloud-sync status button with
local/Gist/Cloudflare mode icons that opens Settings > Sync directly, New chat
creates an empty local conversation, selecting a conversation updates
`preferences.activeConversationId`, and the header provider/model dropdown is
generated from the provider/model records in the same snapshot. Choosing a
provider/model now saves it to the active conversation, creating an empty
conversation first if needed. Delete now uses an explicit confirmation dialog,
removes the local conversation from `snapshot.v1.json`, and moves the active
selection to the next local chat. Linux runtime QA is still required before
release, and verified cloud cleanup/readback claims still require final Linux
sync checks.

AI provider settings now persist the non-secret parts of each provider record:
display name, Base URL, optional AI proxy URL, direct-request mode, and enabled
state. Users can now add an OpenAI-compatible custom provider and delete
providers while keeping at least one fallback provider; conversations pointing to
a deleted provider are moved to the fallback. Provider API keys can now be saved
or cleared through Linux Secret Service via `secret-tool` when available, with a
session-memory fallback when the desktop service is missing or locked; when sync
is configured, they are included only inside the end-to-end encrypted vault. The
connection check now reads only the provider model list through `AiClient` on a
background thread and reports the result inline. Target Linux runtime QA still
needs to verify the Secret Service prompt/readback path on a real desktop
session.

Model settings now persist manual model data in the same snapshot: the provider
model list, default chat model, and image model can be edited locally. Fetching
models from a provider now uses the same native `AiClient` model-list path,
stores the returned list in the shared snapshot, and keeps the UI responsive
while the request is running. Target Linux runtime QA is still required before
release claims.

Sync mode, Gist ID/file, and Cloudflare Worker URL now use the same local
snapshot store too, so users can configure sync natively instead of treating
Gist as a Web-only path.
`src/sync_settings.rs` owns the Sync settings form and provider-specific fields,
while `src/sync_settings/sync_actions.rs` owns manual sync, blocked-reason
copy, localized status, and first-sync conflict choices. The data password
field now saves through the same Secret Service-backed Linux secret store with
session-memory fallback, derives the Cloudflare access key, and triggers the
normal save/sync queue without writing the password to `snapshot.v1.json`.
Reset sync password uses a GTK warning dialog and clears only that remembered
device password. GitHub Token now saves through Secret Service with
session-memory fallback and is not written to `snapshot.v1.json`. Gist and
Cloudflare clear-cloud are source-wired behind mode-specific readiness checks,
use a GTK danger confirmation, and run the remote delete in the background
without saving local data afterward.
The Data screen now wires Reset local data through a GTK warning dialog; after
explicit confirmation it clears the local snapshot and remembered provider/data
password secret material, returns to the default local state, and does not claim
to delete encrypted cloud data.
Encrypted backup import/export now uses GTK file chooser dialogs, the shared
encrypted vault format, and a destructive restore confirmation. Import replaces
the local snapshot and provider keys, then follows the normal save and auto-sync
path when Gist or Cloudflare sync is configured.

The Linux core sync source now includes the shared encrypted snapshot vault
contract for both Gist and Cloudflare: PBKDF2-HMAC-SHA-256 plus AES-256-GCM,
provider keys inside the encrypted vault, a local GitHub token for Gist, a
derived Worker access key for Cloudflare, a 700ms debounced auto-sync
coordinator, first-sync conflict protection, and a wrong-password guard that
decrypts existing cloud data before upload. Gist sync can read the selected
file, create a private `ZeroChat encrypted sync vault` Gist when no ID is
configured, and patch the selected file with encrypted vault content. The GTK
state layer now enqueues that coordinator after foreground saves, Cloudflare
clear-cloud uses the same `DELETE /sync/clear` plus legacy cleanup client path,
drains tolerated cleanup response bodies before returning or falling back, Gist
clear-cloud PATCHes the selected file to null, and `SnapshotStore`
serializes local UI writes with background sync status writes.
`src/auto_sync.rs` owns the queue, network, secret, and save coordination, while
`src/auto_sync_state.rs` owns pure state decisions: sync-status timestamping,
stale-result detection including Gist ID/file changes, merge policy,
first-sync local-content detection, and provider-only local content detection.
`src/sync.rs` owns the 60-second reqwest connect/total timeout, sync policy, and first-sync choice handling while delegating
incremental vault reads and writes to `src/sync_incremental_engine.rs`.
`src/sync_incremental_engine.rs` owns remote incremental state reads,
manifest-to-vault materialization, upload rollback, legacy snapshot cleanup,
and stale-object cleanup; `src/sync_cloudflare.rs`
owns Cloudflare Worker endpoint validation, legacy encrypted snapshot transport,
encrypted snapshot-vault fallback, and `/sync/clear` plus head/snapshot
clear-cloud fallback with tolerated response-body drains;
`src/sync_gist.rs` owns Gist HTTP transport, Gist ID/file
validation, private Gist creation, encrypted vault serialization, selected-file
patching, and Gist clear-cloud null patches;
`src/sync_http_body.rs` owns shared declared/streamed byte budgets, bounded
UTF-8/JSON reads, error-body drains, and outbound UTF-8 size checks;
`src/sync_incremental_helpers.rs` owns chunk sizing, Skill manifest redaction,
chunk fingerprints, object keys, object types, Skill ref keys, and safe
object-key validation; `src/sync_incremental_read.rs`,
`src/sync_incremental_remote.rs`, and `src/sync_incremental_upload.rs` keep the
focused readback, Worker object transport, and upload assembly primitives used
by the engine; and `src/sync_merge.rs` owns remote-vault acceptance and
first-sync merge policy for conversations, providers, Skills, Skill settings,
sync config, and provider secrets.
The GTK sync settings screen must stay honest until Linux runtime release QA is
complete. The Linux sync source path is wired, but a target desktop still needs
to prove Gist upload/restore, Cloudflare upload/restore, merge, clear-cloud, and
post-clear readback before those paths are marketed as release-complete. Until
Linux final sync QA passes, users who need a verified cloud-sync path should use
the Web/PWA surface.

User Skill data is part of the shared snapshot contract. Linux now wires GTK Skill settings, paste add, file import, edit, enabled/fixed/auto toggles, and delete controls to `snapshot.v1.json`. `src/skill_settings.rs` owns the GTK Skill settings page shell, global Skill settings, import, and paste-add entry, while `src/skill_list.rs` owns progressive list rendering, Skill card editing, save, and delete controls. This is still source-level evidence on this Windows machine; target GTK runtime and visual QA must pass before Linux Skill editing is advertised as release-complete.

The next Linux-specific work is target runtime QA for the native `AiClient`
send/model-list paths, Secret Service prompt/readback behavior, and
Cloudflare/Gist upload-restore on a real Linux desktop. The UI must remain
native GTK and must not fall back to a WebView wrapper.
