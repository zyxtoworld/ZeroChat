# ZeroChat for Windows

Stack: C++/WinRT + WinUI 3 + WebView2.

Rationale:

- WinUI 3 provides native Windows desktop window behavior.
- WebView2 loads the same lightweight PWA UI used by the web build, so Windows
  receives the same i18n, Skill, sync, provider/model, and responsive UI fixes
  as the browser without duplicating every screen in C++.
- Windows Credential Locker can be used directly for secret storage.
- HTTP, file access, notifications, tray integration, and window control use native Windows APIs.
- Minimizing to tray collapses the WebView2 control and calls
  `CoreWebView2.TrySuspendAsync()`; opening the tray app calls `Resume()` and
  makes the WebView visible again so hidden renderer resources are released.
- Packaged builds register Windows Jump List tasks for Quick Ask, Search Chats,
  and Settings. Those tasks launch the app with `--quick-ask`,
  `--search-chats`, or `--settings`, then the WebView2 shell waits for the
  shared PWA surface and routes to a fresh composer, the conversation search
  field, or Settings > Appearance.
- The WebView2 host accepts sanitized `zerochat.syncStatus` WebMessage payloads
  from the shared PWA and mirrors sync-complete and sync-failed states into
  Windows Notification Center without passing tokens,
  passphrases, Gist ids, Worker endpoints, or chat content.
- `MainWindowSyncNotifications.cpp` owns that sync-status notification bridge,
  while `MainWindow.xaml.cpp` stays focused on the WebView shell, native
  fallback dispatch, window icon, and tray behavior.
- `MainWindowTray.cpp` owns minimize-to-tray, tray menu commands, WebView2
  suspend/resume, and the Win32 window-procedure bridge, while the shell keeps
  only the calls that initialize and clean up the tray surface. It also enforces
  the PRD desktop window floor: launch and tray-restore paths clamp undersized
  bounds to the monitor work area, `WM_GETMINMAXINFO` sets a 900x600 minimum
  track size, and undersized recovery targets 1280x735.
- `MainWindowFallback.cpp` owns the read-only native fallback surface shown only
  when the bundled Web/PWA cannot load, including its layout, disabled controls,
  accessibility labels, and fallback event hooks. `MainWindow.xaml.cpp` must
  not keep a second inline XAML fallback copy.
- `MainWindowFallbackControls.cpp` owns the native fallback control factories
  and read-only disable helper (`FallbackText`, `FallbackButton`,
  `FallbackCombo`, `FallbackInfoBar`, and `DisableFallbackControl`) so the
  fallback surface file stays focused on layout and cannot quietly re-enable
  emergency chat, sync, backup, or destructive settings controls.
- `MainWindowWebRecovery.cpp` owns the localized recovery HTML shown when the
  copied `web\index.html` bundle is missing, including RTL direction, the
  `pnpm run build` repair command, and the no-inline-recovery-page boundary for
  `MainWindow.xaml.cpp`.
- `MainWindowText.cpp` owns the localized native fallback text table used by
  the Windows shell, so `MainWindow.xaml.cpp` can stay focused on window state,
  WebView startup, fallback dispatch, and control binding.
- `AiClientProtocol.cpp` owns Windows provider protocol helpers: AI endpoint
  HTTPS/private-host safety checks, Cloudflare Worker proxy headers, chat
  context trimming, request-body shaping, model parsing, and chat/image
  response parsing. `AiClient.cpp` stays focused on the actual HTTP calls and
  multipart upload plumbing.

## Project Setup

The repository now includes a checked-in Visual Studio solution and C++/WinRT
project under `apps/windows/ZeroChat.sln`. Build the Web/PWA once, then
restore/build Windows from a Visual Studio Developer PowerShell with the Windows
App SDK and C++ workloads installed:

The checked-in project file is intentional: users should not have to recreate a
WinUI project manually in Visual Studio just to build the Windows app.
The project writes build outputs to the ignored project-local
`.local/zerochat/artifacts/windows-build` directory by default so
C++/WinRT metadata tools keep working even when the repository path contains
non-ASCII characters.

From the repository root, run the Windows preflight first:

```powershell
pnpm run check:native-prereqs -- --platform=windows
```

For the shortest local build path, use the helper. It finds MSBuild through
`vswhere`, builds the Web/PWA bundle, uses the ASCII build root, and verifies
with SHA-256 hashes that the copied `web\` bundle matches current `dist\`:

```powershell
pnpm run build:windows:release
```

To verify the Windows app actually opens the shared WebView2 UI, run:

```powershell
pnpm run qa:windows-webview
```

That command rebuilds the unpackaged Release output, launches
`ZeroChat.exe`, captures `.manual-qa\windows-webview-runtime-smoke.png` from
the actual app window with `PrintWindow`, writes
`.manual-qa\windows-webview-runtime-smoke.json` with the window and screenshot
metadata plus current `dist\` and copied `web\` SHA-256 manifests, rejects
blank/collapsed screenshots, closes the app, and then runs
`node scripts/runtime-smoke-artifact-check.mjs --require-runtime-artifact=windows`.
Use this before MSIX packaging so the desktop launch path does not rely only on
static project checks.
For manual tray QA, minimize the window, confirm only the tray icon remains,
then open it from the tray menu; the source path should have called
`TrySuspendAsync()` while hidden and `Resume()` before the WebView becomes
visible again. System-level restores such as `ShowWindow(SW_RESTORE)` also
resume the WebView on `WM_SIZE/SIZE_RESTORED`, which keeps the runtime smoke and
non-menu restore paths honest.
The runtime smoke rejects restored windows below 900x600; manual QA should drag
the window down to the minimum track size and confirm all visible controls remain
reachable.
For packaged Start/taskbar QA, right-click the installed ZeroChat shortcut and
run Quick Ask, Search Chats, and Settings from the Jump List. Quick Ask should
open a new composer-focused chat, Search Chats should focus the conversation
search field, and Settings should open Settings > Appearance after the shared
PWA surface is ready.
For manual sync-notification QA in the packaged app, configure a disposable Gist
or Cloudflare target, complete a sync and force one failure, then confirm
Windows Notification Center shows localized sync status without revealing any
remote endpoint or credential.

For the shortest local Windows QA pass, run:

```powershell
pnpm run qa:windows
```

That command runs the WebView runtime smoke, rebuilds the Release output in
MSIX-ready mode, creates a fresh local `.msix`, and runs the default dry-run
install QA. The dry run does not change the Windows profile; unsigned packages
correctly report that signing is required before install/update QA.

For the disposable signed install/update/uninstall pass, use an elevated
PowerShell on a QA profile:

```powershell
pnpm run qa:windows-msix-trusted:elevated
```

That wrapper refreshes read-only host preflight, creates a short-lived
self-signed certificate, rebuilds the current Web/PWA bundle and Windows
MSIX-ready Release output, and signs previous and current MSIX packages from that
output only after the refreshed preflight passes the strict current-clear gate.
If the AppXDeploymentServer event log cannot be read, the wrapper stops before
build or certificate work and preserves the previous diagnostic report. It then
installs the previous version, captures the packaged app window, updates
to the current version, captures again, uninstalls, removes the temporary
certificate trust/private key, removes package local data and its temporary
certificate workspace, validates the trusted/full runtime-artifact gates,
validates cleanup, and writes
`.manual-qa\windows-msix-current-trusted-install-update-qa.json` with package
byte/SHA-256 evidence plus `dist\` and packaged `web\` asset manifests. The
lower-level `pnpm run qa:windows-msix-trusted` script remains the wrapper's
implementation.
If the local host blocks `Add-AppxPackage` before ZeroChat can complete that
install/update/uninstall proof, the same helper writes
`.manual-qa\windows-msix-current-trusted-install-update-qa.failure.json` as
diagnostic-only host AppX evidence with `releaseEvidence: false`; older failed
runs are historical diagnostic evidence. Historical diagnostic reports can classify
`windows-appx-deployment-deleted-package-cleanup-access-denied` under
`C:\Program Files\WindowsApps\Deleted`, but the latest historical failure report
remains diagnostic-only. Current host status is report-derived, never hard-coded
in this guide: inspect `.manual-qa/windows-msix-host-preflight.json`. A blocked
host must be repaired or replaced before trusted QA; a clear non-elevated host
must run `pnpm run qa:windows-msix-trusted:elevated` from an elevated disposable
Windows profile. If preflight reports the Deleted cleanup classifier, use a
fresh disposable profile or VM, or repair the external AppX cleanup state,
before rerunning the trusted QA wrapper. To inspect the host without importing certificates or
installing packages, run `pnpm run report:windows-msix-host-preflight` and then
`pnpm run check:windows-msix-host-preflight`; the report records recent
AppXDeploymentServer cleanup events, service state, and sanitized Windows
Restart Manager lock-holder evidence as diagnostic-only host evidence. If a
deleted target is still held by an application, close or restart the reported
lock-holder first, rerun the preflight, and only then repair the wider AppX
state or move to a disposable profile/VM if unlocked targets remain. When a
holder process is active, do not interrupt it; use a fresh disposable profile/VM
or rerun the preflight after the holder exits. When a current failure report is
present and the preflight still classifies the known host blocker, the trusted
QA helper fails fast before starting another install/update run; after a verified
host repair, run
`pnpm run qa:windows-msix-trusted:elevated -- -SkipKnownHostBlockerPreflight`
only to bypass the historical-report preflight. `pnpm run
check:windows-msix-trusted-report` validates only the current trusted-MSIX
pass/failure report, and `pnpm run check:runtime-artifacts`
treats a newer failure report as the current trusted-MSIX blocker until a newer
passing report exists.

Use `-Configuration All` before a broad local QA pass. Before creating an MSIX,
build the Release output in package mode so the executable does not use the
unpackaged Windows App Runtime bootstrapper:

```powershell
pnpm run build:windows:msix
```

The direct PowerShell form remains available when you need custom parameters:
`.\scripts\build-windows.ps1 -Configuration Release -Platform x64`.

```powershell
pnpm run build
msbuild apps\windows\ZeroChat.sln /restore /p:Configuration=Debug /p:Platform=x64
msbuild apps\windows\ZeroChat.sln /restore /p:Configuration=Release /p:Platform=x64
```

The Windows project copies `dist` into `web\` beside `ZeroChat.exe`. If `dist`
is missing, the app opens a small in-window recovery message instead of a blank
screen.

If the repository path contains non-ASCII characters and C++/WinRT tools fail
while merging generated metadata, keep the repo path unchanged and make sure the
ASCII build root is still being used:

```powershell
msbuild apps\windows\ZeroChat.sln /restore /p:Configuration=Debug /p:Platform=x64 /p:ZeroChatBuildRoot=.local\zerochat\artifacts\windows-build
msbuild apps\windows\ZeroChat.sln /restore /p:Configuration=Release /p:Platform=x64 /p:ZeroChatBuildRoot=.local\zerochat\artifacts\windows-build
```

MSIX signing and install/update/uninstall QA now has a repeatable helper path,
but production release evidence still needs a current passing trusted report on
a clean host plus the final certificate, timestamp, and distribution-channel
pass described in the native QA checklist.

The repository includes the MSIX manifest and visual assets under
`apps/windows/msix`. The manifest declares the Windows App Runtime framework
dependency required by the packaged app. The `Assets` folder includes both the
tile logos and the `Square44x44Logo.targetsize-*` / `*_altform-unplated`
variants Windows uses for crisp taskbar, Start menu, app-list, and Alt-Tab
icons. After the Web/PWA and Windows `-MsixReady` Release build pass, create an
unsigned local package with:

```powershell
pnpm run package:windows:msix
```

The script uses Windows SDK `makeappx.exe`, stages the Release output, excludes
`.pdb` symbols by default, copies the bundled `web\` directory, refuses stale
copied Web/PWA assets when the release output differs from current `dist\`, and
requires the `zerochat-build-mode.txt` marker written by `-MsixReady`. It writes
the unsigned package to `.manual-qa\ZeroChat_<version>_x64.msix`. Sign the
package with a trusted certificate before installing or distributing it.

For local signing QA, pass a PFX certificate explicitly:

```powershell
.\scripts\package-windows-msix.ps1 -BuildRoot .local\zerochat\artifacts\windows-build -Configuration Release -Platform x64 -CertificatePath .local\zerochat\private\ZeroChat.DevSign.pfx -CertificatePassword "<password>"
```

The repository never stores signing certificates or passwords. Production
packages should use a trusted certificate and timestamp URL.

Before changing the current Windows profile, run the install QA helper in its
default dry-run mode:

```powershell
pnpm run qa:windows-msix
```

The helper only installs when `-Install` is passed. For upgrade QA, first install
the previous signed build in a disposable profile, then run the helper with
`-Update`; it requires the new MSIX version to be higher and confirms the
installed package version after `Add-AppxPackage`. When no `-PackagePath` is
passed, the helper inspects the newest `.manual-qa\ZeroChat_*.msix`, including a
fresh unsigned package, so stale signed artifacts cannot hide the current build.
For disposable self-signed install/update QA, run from an elevated PowerShell
and pass `-TrustMachineCertificate -TrustedCertificatePath <public .cer>`; the
helper imports the leaf certificate only into Local Machine Trusted People,
then rechecks trust before calling `Add-AppxPackage`. App Installer does not use
Current User trust for this path, and a package-signing leaf must not be placed
in Local Machine Root. The optional `-TrustSigningRoot` switch accepts only an
actual CA root according to X509 Basic Constraints. Keep machine trust outside
normal daily-use profiles. The install helper no longer exposes ineffective
Current User trust switches; only the outer QA cleanup checks that store for
historical residue. Cleanup should pass
`-RemoveTrustedMachineCertificate` with `-Uninstall`. Unsigned packages produce
a dry-run report that says to sign first; they are still rejected for install or
update actions. Signed dry runs also show `SignatureTrusted` and `TrustRequired`
so an untrusted local certificate is obvious before install/update QA.

## Requirements

- Provider types must support `openai-compatible`, `openai-responses`, and `anthropic`.
- API keys are required, stored in Windows Credential Locker, and synchronized only inside the end-to-end encrypted vault.
- AI Base URLs must be remote HTTPS URLs. HTTP, localhost, private network, and LAN addresses are rejected.
- The native AI client must support provider model-list retrieval, Worker proxy action headers, image generation, image editing, and inpainting through the shared provider contract.
- Every native AI transport disables automatic HTTP redirects before provider API keys or Worker access keys are attached. Redirect responses fail locally, and users must configure the final trusted provider or proxy URL.
- Cloudflare sync must support `DELETE /sync/clear` for clearing remote ZeroChat sync data without deleting local data.
- Cloudflare sync and clear-cloud fallback paths must drain tolerated response bodies before continuing, so unsupported incremental endpoints and missing legacy objects cannot leave unread HTTP content behind.
- Native Cloudflare snapshot sync validates the exact encrypted v1 envelope, algorithm suite, safe timestamps, canonical base64, salt/IV sizes, timestamp-bound AAD, and authenticated-payload minimum before publishing local data or delivering remote data to a callback.
- Native sync drains every completed HTTP response and maps status codes to bounded actionable messages; untrusted Worker response bodies are never forwarded into the app UI or notification text.
- Native snapshot sync and clear-cloud operations share one asynchronous process gate, so concurrent syncs cannot publish from the same stale read and a clear operation cannot report success before an in-flight sync resurrects remote data. Result callbacks run only after the gate is released.
- Native Cloudflare sync disables HTTP automatic redirects before attaching the bearer access key. A 30x response fails with a bounded message, so credentials cannot be forwarded to an unvalidated redirect host; users must configure the final trusted Worker URL.
- Every native Cloudflare sync request shares the cross-platform 60-second transport deadline across response headers, content-stream acquisition, and each 8 KiB read. Timeout cancellation unwinds the shared sync lease, so one unresponsive Worker cannot permanently block later sync or clear-cloud actions.
- Native sync rejects oversized declared response lengths and closes streamed bodies as soon as endpoint-specific snapshot/head/error byte budgets are crossed. Local encrypted snapshots are UTF-8 byte-checked before any request starts; `ResponseContentRead` must not be restored.
- GitHub Token remains local to the device. Cloudflare access is derived from the data encryption password.
- Local persistence uses LocalFolder `snapshot.v1.json` aligned with `shared/snapshot.schema.json`. Production builds may move to SQLite without changing the sync schema.
- Recommended package format: MSIX.

## UI Scope

The visible Windows app shell now loads the shared PWA UI in WebView2. This keeps
the conversation list, merged provider/model picker, chat/image composer modes,
image edit/inpaint controls, message actions, six settings sections, provider
configuration, model management, Skill management, sync conflict choices, data
encryption password warnings, reset local data, and clear cloud data entry
points visually and behaviorally aligned with the web app. The packaged Windows
shell also exposes Jump List Quick Ask, Search Chats, and Settings tasks that
route through startup arguments into the loaded WebView2 surface.

User Skill data is part of the shared snapshot contract. Because the Windows
shell uses the shared PWA UI, Skill add/edit/delete, lazy chunk storage, automatic
matching, and sync behavior match the web build.

The C++ core still parses chat text from OpenAI-compatible, OpenAI Responses, and
Anthropic response shapes, serializes/deserializes the local snapshot, lists
models, generates/edits images, and clears Cloudflare sync data. The next
Windows-specific product task is deciding which native services should replace
browser storage/HTTP behind the WebView bridge.
