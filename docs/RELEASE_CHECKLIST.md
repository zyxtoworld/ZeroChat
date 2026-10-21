# Release Checklist

Use this checklist before publishing Web, Worker, or native builds. Keep it short
enough that every release can actually run it.

## `.manual-qa/` Layout

`.manual-qa/` is ignored local release evidence. Keep the canonical current
reports and artifacts at the directory root because the release checkers use
stable paths; do not move or rename them into subdirectories.

- `hosted-native-ci/`: downloaded GitHub Actions native artifacts.
- `web-current-page-visual-audit/`: current Web/PWA screenshots, gallery, and contact sheet.
- `archive/`: historical logs and superseded local attempts only; never use it as current evidence.

## Required Gate

```bash
pnpm install --frozen-lockfile --prod=false
pnpm run verify:release
```

`pnpm run verify -- --help` prints the verifier modes without running checks or
writing a checkpoint. Unknown flags, duplicate flags, and `--help` combined
with a mode fail before the verifier creates paths, starts builds, or refreshes
release diagnostics.

After a disposable live cloud-sync drill has passed, run the strict final
variant as well:

```bash
pnpm run verify:release:live-sync
```

If a release machine has Node and `node_modules` but no package manager command
on `PATH`, run the same gate directly with
`node scripts/verify-release.mjs --release`.
The strict live-sync variant maps to
`node scripts/verify-release.mjs --release --require-live-sync-pass` and fails
fast unless `.manual-qa/live-sync-release-drill.json` is a passing
`releaseEvidence: true` report, then runs the same release gate.

The gate builds the Web/PWA, checks lint, deployment portability, Worker
security, bundle budgets, documentation links, Windows WebView shell contract,
i18n coverage, native i18n, native feature parity, the live sync release drill
safety gate, the live provider smoke safety gate, Cloud sync E2E through the
real Worker code, Gist sync E2E through a mocked GitHub API, and repository
hygiene. The bundle gate enforces the PRD HTML shell, first-load gzip, entry JS,
the complete entry-plus-modulepreload JavaScript graph, total static gzip, lazy
service, and lazy locale budgets; the Lighthouse
gate requires 95+ scores and the PRD FCP/TTI startup thresholds. The browser smoke test launches the app
in Chrome/Chromium, clicks through setup/settings/Skills/image controls, checks
RTL language switching, and validates multiple desktop/mobile viewport sizes.
The same gate runs `pnpm run check:redlines` as the Icon/cloud-sync redlines
guard: Web Settings > Sync keeps the current local-only mode, its concise
`仅本机` label, the no-upload explanation, and the visible `上次同步`/`立即同步`
controls. The `云同步` labelled mode group uses pressed-state native buttons;
when their mode permits, these actions are keyboard-focusable, pointer-clickable,
and remain absent from deprecated duplicate sidebar/header sync controls;
Android must keep `zerochat-app-icon`,
`zerochat-cloud-sync-status`, Settings > Sync routing, and the Cloudflare sync
smoke; Apple must keep `AppleCloudSyncStatusStrip`; Windows must keep
`ZeroChat.ico` plus `ApplyWindowIcon()`; and Linux must keep the branded
sidebar app icon plus direct Settings > Sync routing.
The verification gate also ends with a final local runtime cleanup check:
`pnpm run check:local-cleanup` rejects ZeroChat-owned listeners on the watched
local preview ports and directly rejects workspace-owned Vite or QA browser
runtimes even when they moved to an unwatched port. It flags stale ZeroChat app
processes, prints `NO_EMULATOR_OR_ADB_PROCESSES`, `NO_ZEROCHAT_PROCESSES`, and
`NO_ZEROCHAT_RUNTIME_PROCESSES` on a clean machine, and documents any tolerated
outside-workspace listeners instead of treating an unrelated local Vite server
as ZeroChat release evidence.
Runtime artifact blockers are intentionally checked before UI accessibility,
axe, and Lighthouse work in `verify:release`, after build/bundle/docs/completion
guards and the release-blocker summary validator have run, so stale blocker
handoff data or failed release evidence stops the gate before the slower
browser/performance checks.
When native/MSIX/runtime evidence is expected to remain blocked but Web/PWA
polish still needs a fresh local proof pass, run `pnpm run verify:web-local`.
That focused command builds the Web app, runs Web/source quality gates, browser
and visual smokes, starts an isolated local preview for current-page QA, checks
`--only-web-local-artifacts`, and then runs local cleanup. It is diagnostic
Web/PWA evidence only; it does not replace `pnpm run verify:release` and cannot
close native runtime, trusted MSIX, hosted CI, live-provider full-capability,
or browser-origin UI release blockers. It also cannot replace the separate
validated live-sync release-pass report when that evidence is stale or missing.
It deliberately does not read or refresh all-platform release diagnostics and
does not write the release checkpoint or generated current-evidence docs.
Native and aggregate diagnostic freshness belongs to `verify:release`; the
focused command fails closed only on its own Web/source/browser/PWA/visual
evidence.
The visual audit captures screenshots to `.visual-audit/` so the UI can be
checked by eye before publishing. It also rejects browser runtime errors,
wrong-size PNGs, and screenshots that appear blank or visually collapsed; open
`.visual-audit/visual-audit-gallery.html` for the ordered review page. When
local visual artifacts already exist, `pnpm run check:runtime-artifacts`
validates `.visual-audit/visual-audit-manifest.json`, the current screenshot set
listed by the manifest, viewport dimensions and byte counts, required compact/RTL/danger
screenshots, `visual-audit-gallery.html`, and
`visual-audit-contact-sheet.jpg`. The manifest records contact sheet byte,
SHA-256, width, and height evidence, and the artifact checker rejects contact
sheets that are too narrow for reviewer use. The full release gate also repeats
that artifact validation after `Visual audit` regenerates screenshots, so the
exact fresh visual evidence from the release run is checked before the command
can pass. The checked-in CI workflow is configured for clean-checkout Web/PWA
evidence, and the GitHub Pages workflow mirrors it: both run `pnpm run
verify:web-local`, then upload the visual audit screenshots and gallery as
artifacts. That hosted Web/PWA gate is intentionally narrower than the local
`pnpm run verify:release` gate because `.manual-qa/` diagnostics are ignored and
must not be required for ordinary PR or Pages deploy jobs. Those hosted Web/PWA
jobs keep a 35-minute timeout so browser and visual QA can finish without
hanging indefinitely. The CI workflow is
also configured to run a Windows `windows-latest` job that checks Windows
prerequisites, builds the `-MsixReady` Release WebView2 shell, packages an
unsigned MSIX, and runs the dry-run MSIX install helper. Trusted signed
install/update/uninstall QA is intentionally a disposable-machine task; run
`pnpm run qa:windows-msix-trusted:elevated` from an elevated disposable QA
profile to refresh host preflight, rebuild the current Web/PWA bundle and
Windows MSIX-ready output, run trusted install/update/uninstall QA, validate
trusted/full runtime artifacts, verify cleanup, and refresh the evidence
recorded in `docs/QA_AUDIT.md`. The wrapper requires the refreshed preflight to
be currently clear before any build, certificate, signing, or install work. An
unreadable AppX event log fails closed and leaves the previous report untouched.
The lower-level
`pnpm run qa:windows-msix-trusted` script remains the wrapper's implementation,
not the primary release rerun handoff. A separate
manual
`Windows Signed MSIX` workflow can read `WINDOWS_SIGNING_PFX_BASE64`,
`WINDOWS_SIGNING_PFX_PASSWORD`, and optional `WINDOWS_TIMESTAMP_URL` from
repository Secrets, run the Windows WebView/MSIX packaging guards, sign the
MSIX, dry-run inspect it without installing or trusting the certificate, clean
up the temporary PFX, verify that PFX path is gone, and upload the signed
artifact with `if-no-files-found: error`. The same CI workflow is
configured to run Android SDK 36 Android Lint plus debug and release APK builds on Ubuntu, run
`pnpm run check:android-release-size` against the release APK, write
`.manual-qa/android-release-size.json`, and upload both APK artifacts plus the
downloadable release-size JSON. APK artifacts; emulator/physical-device QA remains a native release task. CI is
configured to install the pinned pnpm workspace on Linux, install
GTK4/libadwaita development packages on Ubuntu, run a locked Linux
`cargo check`, build the release binary, run an Xvfb smoke that captures the
GTK app window itself, validate that PNG/JSON smoke artifact and
launched-binary hash evidence, enforce the PRD `< 10MB` Linux binary budget,
verify the downloaded `zerochat-linux` is an ELF executable, and upload the
binary plus screenshot and metadata artifacts; Linux runtime
visual QA still needs the target desktop session. CI is configured to install
the pinned pnpm workspace on macOS, run the Apple native preflight, build the
SwiftPM `ZeroChatAppleApp` target on macOS, build the checked-in
`ZeroChat.xcodeproj` shared scheme for both macOS and `generic/platform=iOS Simulator`
without signing credentials, then run a macOS smoke that captures the ZeroChat
app window itself, validate that PNG/JSON smoke artifact plus
launched-executable and app-bundle hash evidence with
`--only-runtime-artifact --require-runtime-artifact=apple`, enforce the PRD
`< 15MB` macOS `.app` bundle budget when that artifact exists, and upload
screenshot metadata plus the iOS Simulator app build product;
iOS/iPadOS/macOS simulator/device visual QA is still required before Apple can
be called release-ready. Linux hosted CI likewise validates its Xvfb GTK
runtime screenshot with
`--only-runtime-artifact --require-runtime-artifact=linux` before upload. Each
hosted native CI job
also writes a `zerochat.nativeBuildPrereqReport` report at
`.manual-qa/native-prereq-<platform>.json` (`windows`, `android`, `linux`,
`apple`), immediately validates it with
`node scripts/runtime-smoke-artifact-check.mjs --only-native-prereq-report --require-native-prereq=...`,
and uploads it with that platform's artifacts, so a failed preflight still
leaves machine-readable blocker evidence for
`pnpm run check:runtime-artifacts`. Each native prerequisite report includes a
`sourceFingerprint` over the guarded native source/project/workflow/package
files, and the validator recomputes that fingerprint before accepting the
report. Rerun the native preflight after source changes; stale reports must not
stand in for the current tree. Because this local workspace
cannot prove hosted GitHub Actions
execution, the first real pull request or push run must pass before treating
these CI jobs as verified release evidence. After the Windows, Android, Linux,
and Apple native jobs succeed in the same run, the `hosted-native-ci-evidence`
job uses read-only `actions: read` / `contents: read` workflow permissions to
download the seven native artifacts back under
`.manual-qa/hosted-native-ci/`, runs
`node scripts/hosted-native-ci-evidence-report.mjs --repository=${{ github.repository }} --run-id=${{ github.run_id }} --run-attempt=${{ github.run_attempt }} --head-sha=${{ github.sha }} --jobs-success`,
validates the generated report with
`node scripts/hosted-native-ci-evidence-check.mjs --report=.manual-qa/hosted-native-ci-evidence.json --require`,
and uploads `.manual-qa/hosted-native-ci-evidence.json` as
`hosted-native-ci-evidence`. Prefer that workflow-produced report for the
first hosted run handoff.
If you need to reproduce or inspect the report locally, download the native
workflow artifacts under `.manual-qa/hosted-native-ci/`, preferably export the
run metadata directly from GitHub CLI, then run
`pnpm run report:hosted-native-ci -- --run-metadata=.manual-qa/hosted-native-ci-run.json`.
The metadata export command is:
`gh run view <run-id> --repo <owner/name> --json attempt,conclusion,databaseId,headSha,jobs,status,url,workflowName > .manual-qa/hosted-native-ci-run.json`.
The generator rejects this metadata unless the workflow is `CI`, the run is
`completed`/`success`, and the expected native jobs have completed
successfully. If a metadata export is unavailable, use
`pnpm run report:hosted-native-ci -- --repository=<owner/name> --run-id=<run-id> --run-attempt=<attempt> --head-sha=<head-sha> --jobs-success`
to record the GitHub Actions run id, run attempt, repository slug, run URL,
head SHA, successful native job conclusions, every job/artifact's matching run
id and run attempt, and every downloaded file's byte/SHA-256 evidence in
`.manual-qa/hosted-native-ci-evidence.json`. Use repeated
`--job=<id>:success` values instead of `--jobs-success` if job conclusions are
copied one by one. File paths must resolve inside
`.manual-qa/hosted-native-ci/`; string-prefix matches with `../` traversal are
rejected before hashing. Job names, artifact names, and file paths within each
artifact must be unique so reviewers cannot hide conflicting evidence behind
the first matching entry. Then run
`node scripts/hosted-native-ci-evidence-check.mjs --require`. The checker
compares the evidence report head SHA with the current Git HEAD from
`git rev-parse HEAD`, so every source change requires a fresh hosted native CI
run for the current commit instead of reusing older artifacts. The checker also
parses the downloaded native prerequisite reports, hosted runtime-smoke JSON
metadata, Android release-size JSON, and Apple iOS Simulator `ZeroChat.app/Info.plist`
plus `ZeroChat.app/ZeroChat` executable, and it validates downloaded runtime
screenshots as real PNG files with IHDR dimensions matching
their metadata. It also validates
that downloaded Android APK and Windows MSIX artifacts are real ZIP-based
package files above the minimum expected evidence size. The Android release
APK artifact must include `android-release-size.json`, and the checker
keeps a missing-report state auditable without closing the blocker: when the
required report is absent it writes a safe
`zerochat.hostedNativeCiEvidenceDiagnostic` report with
`releaseEvidence: false`, `status: "missing"`, current Git HEAD, expected CI
jobs/artifacts, the `.manual-qa/hosted-native-ci/` artifact root, and the
exact `gh run view`, `gh run download`, report-generation, diagnostic
validation, and required release-pass validation commands. Non-required `pnpm run check:hosted-native-ci-report` validates
that diagnostic shape, but
`pnpm run check:hosted-native-ci-release-pass` still fails until a real
`zerochat.hostedNativeCiEvidence` release report is generated from a successful
GitHub Actions run.
Use `pnpm run check:hosted-native-ci -- --help` to inspect the command without
reading or writing report artifacts. The diagnostic-refresh shortcut owns write
mode; appended help, unknown arguments, duplicate flags, or a conflicting
require action fail before the diagnostic can be rewritten.
When the current workstation cannot fetch hosted artifacts directly, refresh the
safe local handoff diagnostic with `pnpm run report:hosted-native-ci-diagnostic`.
It records only boolean/count local prerequisites and safe aliases such as
`git-remote-origin`, `github-cli-gh`, `github-cli-auth`,
`clean-git-worktree`, and `clean-native-source-worktree`; it must not record GitHub tokens,
remote URLs, file lists, or artifact payloads, and it never closes the hosted CI blocker.
The local artifact-fetch readiness boolean requires `git remote get-url origin`,
`gh --version`, and `gh auth status` to pass.
The separate hosted-CI coverage booleans require both the full Git worktree and
the guarded native source roots from `.manual-qa/native-prereq-all-platforms.json`
to be clean; real release evidence is rejected if either tree is dirty because
the hosted run can prove only a commit, not uncommitted local source.
recomputes the downloaded APK bytes/SHA-256 before accepting the PRD `< 8MB`
budget evidence. The Apple iOS Simulator artifact must include a Mach-O
`ZeroChat.app/ZeroChat` executable above the minimum expected evidence size, so same-name files
cannot stand in for passing preflight/runtime/package evidence. The Linux
artifact must likewise include an ELF `zerochat-linux` binary under the
PRD `< 10MB` budget, and the checker binds `linux-runtime-smoke.json`
`binaryEvidence` bytes/SHA-256 to that downloaded file.
The normal release gate runs the same checker without `--require`, which keeps the
workflow/artifact contract guarded while still making the absence of a hosted
run an explicit remaining release blocker.

For a final all-platform release, also run the stricter native preflight gate:

```bash
pnpm run verify:all-platforms
```

After both native platform prerequisites and disposable live cloud-sync
release-pass evidence are ready, use the combined final gate:

```bash
pnpm run verify:all-platforms:live-sync
```

After Windows, Android, Apple, and Linux runtime smoke artifacts have all been
captured on their target hosts, use the native-runtime strict gate:

```bash
pnpm run verify:all-platforms:runtime
```

For the final local release command that requires native prerequisites, native
runtime artifacts, and disposable live cloud-sync release-pass evidence, run:

```bash
pnpm run verify:all-platforms:runtime-live-sync
```

After the first real hosted native CI run has produced downloaded artifact
evidence, use the hosted-artifact final gate:

```bash
pnpm run verify:all-platforms:runtime-live-sync-hosted
```

After the full-capability provider report is also passing, use the strictest
combined final gate:

```bash
pnpm run verify:all-platforms:runtime-live-sync-hosted-provider
```

This first runs a strict preflight for every external evidence set requested by
the command, then runs the normal release gate only if every required evidence
set is present. On machines that cannot prove every native prerequisite, such
as a Windows machine without Xcode or Linux/WSL, it still writes
`.manual-qa/native-prereq-all-platforms.json` as a
`zerochat.nativeBuildPrereqReport` and automatically validates that report with
`node scripts/runtime-smoke-artifact-check.mjs --only-native-prereq-report --require-native-prereq=.manual-qa/native-prereq-all-platforms.json`.
Native-runtime variants also require Apple/Linux/Android/Windows WebView runtime
smoke artifacts plus Windows trusted MSIX install/update/uninstall packaged-app
evidence, live-sync variants require a passing
`.manual-qa/live-sync-release-drill.json`, the hosted variant requires
`.manual-qa/hosted-native-ci-evidence.json`, and the provider variant requires
`.manual-qa/live-provider-smoke-full-current.json` to pass
`--require-live-provider-full-capability-report`. If more than one requested
evidence set is missing, the gate prints
`Strict release preflight blockers remain` with every failing category and does
not start the slower Web/release checks. Expected preflight failures are
compacted into a release-audit summary, so reviewers see missing evidence paths
and the native prerequisite table without internal Node stack traces. Treat
that failure as a release blocker for all-platform marketing, not as a Web/PWA
failure. A blocked strict preflight writes
`.manual-qa/strict-release-preflight.json` with `releaseEvidence: false` and
`safeToPublish: true`, then refreshes
`.manual-qa/release-blockers-current.json`. Validate those handoff reports with
`pnpm run check:strict-release-preflight` and `pnpm run check:release-blockers`
before attaching or sharing them. A successful strict preflight writes the same
sanitized diagnostic schema with `status: "passed"`, `blockerCount: 0`, and an
empty blocker list; it is still not release evidence.
If native source/project/workflow/package files changed and existing local
`.manual-qa/native-prereq-*.json` diagnostics are still needed for blocker
handoff, run `pnpm run report:native-prereqs` before regenerating strict
preflight or release-blocker summaries. It refreshes the current native source
fingerprint for every existing native prerequisite report, accepts the expected
missing-toolchain preflight exit code, and immediately validates each report
with the focused native-prereq runtime-artifact checker. It does not create
runtime QA or release evidence. Use `pnpm run report:native-prereqs -- --help`
to inspect the command without reading or writing reports. Help combined with
other flags, unknown input, empty values, duplicate flags, or an invalid
refresh report set fail before a native prerequisite report is changed.
To refresh the safe local handoff stack in one command, run
`pnpm run report:release-diagnostics`. It runs the Windows MSIX host preflight,
hosted native CI missing-evidence diagnostic, live-sync no-credential
diagnostic, live-provider no-credential diagnostic, native prerequisite refresh,
strict release preflight diagnostic, release-blocker validation, an expected
runtime-artifact blocker audit, and final local cleanup in order. The wrapper
audits the full `pnpm run check:runtime-artifacts` failure shape and succeeds
only when the remaining broad runtime-artifact failure matches the exact audited
blocker set derived from current reports, including trusted-MSIX host state and
live-sync source freshness.
It accepts either a blocked AppX host preflight or a clear host that still needs
an elevated rerun. Current host status is report-derived, never hard-coded in
this guide; use `.manual-qa/windows-msix-host-preflight.json` and the generated
current-evidence handoff for the active state.
Stale Web current-page digests, stale native
fingerprints, live-sync release-pass mistakes, hosted-CI overclaims, or
live-provider full-capability overclaims fail the aggregate diagnostic. The
wrapper strips `ZEROCHAT_LIVE_PROVIDER*`,
`ZEROCHAT_LIVE_SYNC*`, `GH_TOKEN`, `GITHUB_TOKEN`, and related provider/GitHub
credential environment variables before launching child commands, so it cannot
touch provider APIs, disposable sync remotes, or GitHub on behalf of the
operator. Treat the refreshed reports as `sanitized-diagnostic-only`;
`releaseEvidence: false` artifacts are blocker handoffs, not release readiness.
The command also writes `.manual-qa/release-diagnostics-current.json`, a
safe-to-publish `zerochat.releaseDiagnosticsRefresh.v1` summary that records
relative report paths, bytes, SHA-256 hashes, sanitized credential environment
families, the expected runtime-artifact blocker audit result, and the remaining
release blockers without recording provider keys, URLs, tokens, passphrases, or
payloads. To validate that existing aggregate summary without refreshing the
source diagnostic reports or their timestamps, run
`pnpm run check:release-diagnostics`; it rehashes the summarized reports, reruns
the read-only expected runtime-artifact blocker audit, and keeps
`releaseEvidence: false` / `safeToPublish: true` scope enforced.
After the aggregate JSON is current, run `pnpm run report:current-evidence` to
print a sanitized Markdown handoff of the current report hashes, blocker IDs,
 and next actions. Run `pnpm run sync:current-evidence` to update the generated
 current-evidence blocks in `docs/REQUIREMENTS.md` and `docs/QA_AUDIT.md`, then
 run `pnpm run check:current-evidence` afterward to verify those docs contain the
 current hashes and diagnostic timestamp without refreshing any source report.
To inspect the current-evidence command surface without reading evidence or
writing documents, run `pnpm run report:current-evidence -- --help`.
`sync:current-evidence` owns write mode, so appended help or invalid arguments
fail before document writes rather than changing the generated overlays.
For the other release-artifact writers, inspect modes without I/O through
`pnpm run report:release-diagnostics -- --help` and
`pnpm run report:release-blockers -- --help`. Appended help, unknown arguments,
conflicting modes, or orphan UI-report overrides fail before either command reads
or writes report artifacts.
Run `pnpm run report:strict-release-preflight` to regenerate and validate the
current strict-preflight handoff in one step. It accepts either a fresh blocked
state with `Strict release preflight blockers remain` or a fresh zero-blocker
passed state, then validates the strict report and refreshed release-blocker
summary. Both reports remain `releaseEvidence: false`; this is not a replacement
for the final release gate.
For a short current-state handoff after that, run
`pnpm run report:release-blockers`. It validates the existing native prereq,
strict preflight, live-sync, hosted native CI, and live-provider diagnostic
reports before writing `.manual-qa/release-blockers-current.json`. The summary
must stay `releaseEvidence: false` and `evidenceType:
"release-blocker-summary-diagnostic"`; it is only a blocker map, not release
evidence. To validate the existing blocker map without refreshing the
`generatedAt` timestamp or report hash, run
`pnpm run check:release-blockers`.
The summary also records this command in `nextSteps.validationCommands` so the
handoff artifact is self-validating instead of relying on memory of a raw Node
invocation.
Per-blocker `nextActions` are sanitized and normalized before writing, and
`pnpm run check:release-blockers` rejects duplicate normalized handoff actions
so the blocker map stays concise without dropping required rerun or validation
commands.
That focused validation also binds the strict blocker text to the current
diagnostic artifacts when live sync is still skipped, hosted native CI is still
missing, or the live-provider full-capability smoke is still failed, so a stale
or generic blocker summary cannot be mistaken for current release evidence.
The preflight report is still checked before exiting, so the requested
platform, host platform, missing checks, and
`passed: false` state are checked before the failed release audit is filed or
shared. The focused `--only-native-prereq-report` mode validates only the named
preflight report, so stale or unrelated runtime artifacts cannot hide whether
the all-platform blocker report itself is well-formed. These toolchain
preflight reports are not runtime QA or release evidence; even a passing report
only proves the build tools are present and must be followed by native build,
launch, screenshot, and visual review. Each report also carries a
`sourceFingerprint` that must match the current guarded native source tree, plus
`nextSteps.platformQaCommands` with the repeatable target-host commands for
Android, Apple, Windows, and Linux, so reviewers know exactly which runtime QA
entry to run after moving the blocker to the right SDK machine. The Windows
entry also names `pnpm run check:windows-msix-trusted-report`, keeping the
trusted MSIX pass/failure report validator in the handoff before the broader
runtime-artifact gate is rerun. The Apple and Linux entries also name their
target package-size gates so IPA, macOS `.app`, and Linux release-binary budget
evidence travel with the runtime QA handoff. The same
`nextSteps` object also carries `releaseGateCommands` and
`releaseEvidenceCommands` so a native prerequisite blocker still hands off the
staged all-platform gates plus the native runtime, hosted native CI, and
live-provider full-capability evidence checks that remain before final release.
The same handoff keeps the validated live-sync release-pass report in the final
gate so stale or skipped sync diagnostics cannot replace the current pass.
The combined live-sync variant adds the same
`--require-live-sync-passed-report=.manual-qa/live-sync-release-drill.json`
requirement before the normal release gate, so an all-platform release cannot
be claimed from native preflight evidence plus a skipped cloud-sync diagnostic.
The native-runtime variants additionally run
`node scripts/runtime-smoke-artifact-check.mjs --only-runtime-artifact --require-runtime-artifact=windows --require-runtime-artifact=windows-msix-trusted --require-runtime-artifact=android --require-runtime-artifact=apple --require-runtime-artifact=linux`;
`android` requires the emulator QA, Cloudflare sync smoke, UI smoke, and contact
sheet evidence together.

## Web/PWA

- Confirm the beginner deployment guides still match the current Cloudflare and
  GitHub Pages flows in every interface language: [DEPLOY_WEB.md](DEPLOY_WEB.md)
  and the localized `DEPLOY_WEB.*.md` files.
- Run the app once from `dist/` or a preview server.
- Run the real-browser smoke test locally or in CI.
- If `pnpm run verify:release` stops before browser work because a newer native
  runtime diagnostic is correctly blocking release, run `pnpm run verify:web-local`
  to refresh Web/PWA browser, visual, and current-page evidence without claiming
  release readiness.
- Treat browser-smoke UI quality failures as release blockers: it checks real
  interaction states for horizontal overflow, clipped controls, compact
  placeholders that do not fit, off-center button content, small tap targets,
  dialog semantics, focus restoration, and mobile sidebar/model-menu behavior.
- When refreshing current-page evidence with `pnpm run qa:web-current`, the
  default command first rebuilds the current Web/PWA production bundle, then
  auto-starts and cleans up its temporary Vite preview on
  `http://127.0.0.1:5173/` when no local target is already reachable. Pass
  `-- --url http://127.0.0.1:<port>/` to validate an exact app that is already
  open without rebuilding it. The default command prints a concise summary and
  keeps the complete machine-readable report in
  `.manual-qa/web-current-page-qa.json`; use `-- --json` only when stdout needs
  the full JSON. Keep that report together with
  `.manual-qa/web-current-icon-sync-dom.json`. The runtime-artifact gate now
  rejects a current-page QA set that does not prove the branded `favicon.svg`
  app logo is visible. The same evidence must prove deprecated sidebar
  (`sync-pill`) and chat-header (`chat-sync-strip`) sync controls are absent;
  the only current Web sync controls live in Settings > Sync and are guarded by
  the source/render/browser contracts instead of duplicated header actions.
  The current-page QA target must be the ZeroChat app itself; the script checks
  the local HTML shell for ZeroChat title, root, loading, favicon, and manifest
  markers before collecting screenshots so an unrelated local Vite server cannot
  be mistaken for release evidence.
- Review `.visual-audit/visual-audit-gallery.html` for desktop, narrow browser
  windows, mobile and compact mobile widths, sidebars, settings tabs, RTL,
  localized skill management, disabled primary/send button states, image
  generation/edit/inpaint modes, and model menus.
- Complete first-run setup with a temporary provider key that is not committed.
- Fetch models, send one short message, stop/regenerate once, and delete one
  disposable message.
- Confirm unsafe provider Base URLs are blocked before sending any request:
  HTTP, localhost/private-network/LAN addresses, credentials, query strings, and
  fragments.
- For a live relay/provider smoke, run `pnpm run drill:live-provider` and
  `pnpm run drill:live-provider-ui` only with disposable credentials. Set
  `ZEROCHAT_LIVE_PROVIDER_BASE_URL`, `ZEROCHAT_LIVE_PROVIDER_API_KEY`, and
  `ZEROCHAT_LIVE_PROVIDER_CONFIRM=SEND_ONE_TEST_MESSAGE`; optionally set
  `ZEROCHAT_LIVE_PROVIDER_MODEL`. The Base URL may be an API root or a known
  endpoint path such as `/chat/completions`, `/responses`, `/messages`,
  `/models`, `/images/generations`, `/images/edits`, `/audio/speech`,
   `/audio/transcriptions`, `/embeddings`, `/moderations`, or `/realtime`; the
   smokes normalize it back to the API root before building requests.
   Both drill CLIs accept `--help` (or `-h`) for a no-request, no-report mode;
   they reject unknown or combined command modes before reading report paths or
   provider inputs.
   When the Base URL uses an RFC-reserved example/test/invalid host, the actual API drill
   rejects it before any model request or report creation. Only
   `--validate-inputs-only` accepts such a host, and it performs no network
   request. API report evidence records `releaseEndpointEligible`; a report is
   eligible for release promotion only when that field is `true`.
   When no model override is provided, both smokes sort chat-like `/models` candidates by
  capability preference, run a minimal streaming `ZeroChat OK` proof, use the
  first truly usable model, and fail with redacted per-candidate status
  summaries if every candidate is unusable. Non-chat ids are tried only when
  the catalog exposes no chat-like model ids. The API script lists models,
  sends one streaming chat request, expects `ZeroChat OK`, and never prints the
  key. To collect a publishable API smoke artifact, set
  `ZEROCHAT_LIVE_PROVIDER_REPORT=.manual-qa/live-provider-smoke.json`; the API
  script writes skipped, failed, or passed JSON with `safeToPublish: true` and
  excludes provider keys, URLs/endpoints, request payloads, and generated
  payloads. Validate that report with `node scripts/runtime-smoke-artifact-check.mjs --only-live-provider-api-report --require-live-provider-api-report=.manual-qa/live-provider-smoke.json`;
   skipped and failed reports are diagnostic only, while passed reports must
   prove both `releaseEndpointEligible: true` and the `ZeroChat OK` chat reply
   before becoming release evidence.
  To refresh a current safe diagnostic without overwriting the canonical
  full-capability path, run `pnpm run report:live-provider-diagnostic`; it
  writes `.manual-qa/live-provider-smoke-current-diagnostic.json` by default
  (or `ZEROCHAT_LIVE_PROVIDER_DIAGNOSTIC_REPORT` under `.manual-qa`) and then
  validates that artifact with the focused API report gate.
  For the canonical current full-capability diagnostic handoff, use
  `pnpm run check:live-provider-report`; it validates
  `.manual-qa/live-provider-smoke-full-current.json` as diagnostic evidence and
  must not be treated as the full-capability release pass.
  Skipped and failed diagnostic reports must include reviewer-safe `requiredInputs`,
  `reviewerChecklist`, and `nextSteps` fields; passed reports must not keep
  those diagnostic handoff fields. For
  final provider release evidence, also run
  `pnpm run check:live-provider-full-capability`; it validates
  `.manual-qa/live-provider-smoke-full-current.json` with
  `--require-live-provider-full-capability-report` and requires chat, image
  generation/edit/inpaint, audio speech plus transcription, embeddings,
  moderation, and Realtime proof. The report must be generated within 72 hours
  of release verification; rerun the disposable provider smoke before release
  if the full-current report is older. New provider reports include
  `startedAt`, `finishedAt`, and `durationMs` timing evidence, plus a
  `sourceFingerprint` over the
  guarded provider smoke, UI smoke, runtime validator, AI provider contract,
  provider request/response/model selection, image, audio transcription, chat
  streaming, and settings source. The focused API report gate recomputes that
  fingerprint for skipped, failed, and passed provider reports so diagnostic
  handoffs cannot be reused after live-provider source changes. Passing
  full-capability release reports must also keep `generatedAt` equal to
  `finishedAt` so freshness is based on the completed smoke rather than process
  start; the strict full-capability gate keeps the same current-source
  fingerprint check plus the 72-hour freshness window. A chat+image-only passed report is
  not enough for that final provider gate. The strict full-capability validator also
  checks the sanitized `modelCandidateCounts`, `modelCandidateSamples`,
  `selectedCandidateModels`, `modelSelectionSources`, and
  `catalogMissingButOverrideProvided` matrix: the selected
  chat/image/audio speech/transcription/embedding/moderation/Realtime
  candidates must match the exact model ids used by the successful endpoint
  evidence, and image `responsesModel` must match the selected chat model. If
  `/models` omits a valid endpoint-specific model, a safe explicit override is
  acceptable only when it appears in `selectedCandidateModels`,
  `modelSelectionSources` marks it as `requested-override`,
  `catalogMissingButOverrideProvided` names the affected capability, and the
  matching endpoint smoke passes; `missingReleaseCapabilities` and
  `requiredModelOverrideKeys` must remain empty in a passing full-capability
  report. Failed full-capability
  diagnostics should use structured `capabilityFailures` with normalized
  `endpointPath`, HTTP `status` when available, a normalized `failureKind`
  such as `route-missing` or `service-unavailable`, and a sanitized
  `errorSummary`, plus a deterministic `capabilityFailureSummary` grouping
  counts by failure kind/status and listing affected capabilities, normalized
  endpoint paths, and route-health blockers, so route-health blockers are not
  confused with missing model-catalog entries. Skipped and failed live-provider
  diagnostics also include a diagnostic-only `releaseBlockerSummary` with
  `releaseEvidence: false`, the blocker kind, required release capabilities,
  safe missing-input aliases when applicable, the derived capability-failure
  summary, package-level validation commands, and live-provider drill commands;
  passing full-capability reports must not keep that diagnostic-only summary.
  To prove image
  endpoints for a disposable relay, additionally set
  `ZEROCHAT_LIVE_PROVIDER_IMAGE_CONFIRM=GENERATE_ONE_TEST_IMAGE` and optionally
  `ZEROCHAT_LIVE_PROVIDER_IMAGE_MODEL`; for slow image relays, optionally set
  `ZEROCHAT_LIVE_PROVIDER_IMAGE_TIMEOUT_MS` between `30000` and `600000`
  milliseconds. The API script then tests `/images/generations`, ordinary
  `/images/edits`, and masked inpaint by sending an in-memory transparent
  `mask` PNG to `/images/edits`. If the generation or ordinary edit route is
  unavailable at the relay layer, it also tries the OpenAI Responses
  `image_generation` tool on `/responses` with the selected text model; masked
  inpaint still requires the dedicated Image API mask upload path. It prints
  only selected model ids, bounded timeout, status/path, generated-result
  availability, and byte-length summaries, never image, URL, or mask payloads.
  To prove audio speech plus
   transcription for a disposable relay, additionally set
   `ZEROCHAT_LIVE_PROVIDER_AUDIO_CONFIRM=RUN_ONE_AUDIO_ROUNDTRIP` and optionally
   set `ZEROCHAT_LIVE_PROVIDER_AUDIO_SPEECH_MODEL`,
   `ZEROCHAT_LIVE_PROVIDER_AUDIO_TRANSCRIPTION_MODEL`, or
   `ZEROCHAT_LIVE_PROVIDER_AUDIO_TIMEOUT_MS` between `30000` and `300000`
   milliseconds. The API script then sends one short `/audio/speech` request,
   submits the returned audio bytes to `/audio/transcriptions`, expects the
   transcript marker back, and prints only status, selected model ids,
   bounded timeout, content-type, generated-audio extension, byte count,
   generated-speech transcription source, and a short transcript preview. Treat
   an `audio` preview model as insufficient by itself; the round-trip requires
   one speech-capable model and one transcription-capable model, or explicit
   safe overrides for both ids. If either required audio model is missing, the script
   fails after `/models` and before sending the chat request. To prove low-cost embedding or
   moderation endpoints for a disposable relay, additionally set
  `ZEROCHAT_LIVE_PROVIDER_CAPABILITY_CONFIRM=CHECK_LOW_COST_CAPABILITIES` and
  optionally set `ZEROCHAT_LIVE_PROVIDER_EMBEDDING_MODEL`,
  `ZEROCHAT_LIVE_PROVIDER_MODERATION_MODEL`, or
  `ZEROCHAT_LIVE_PROVIDER_CAPABILITY_TIMEOUT_MS` between `10000` and `120000`
  milliseconds. The API script then tests `/embeddings` and/or `/moderations`
  when matching model ids are present or explicitly provided, and prints only
  bounded timeout, status, model id, vector dimensions, flagged boolean, and
  non-empty category counts.
  To prove the Realtime endpoint for a disposable relay, additionally set
  `ZEROCHAT_LIVE_PROVIDER_REALTIME_CONFIRM=CHECK_ONE_REALTIME_SESSION` and
  optionally set `ZEROCHAT_LIVE_PROVIDER_REALTIME_MODEL` or
  `ZEROCHAT_LIVE_PROVIDER_REALTIME_TIMEOUT_MS` between `10000` and `120000`
  milliseconds. The API script then opens an authenticated WebSocket session at
  `/realtime?model=<selected realtime model>`, sends a minimal text-only
  `conversation.item.create` plus `response.create`, waits for
  `session.created` and `response.done`, and prints only selected model id,
  bounded timeout, transport, 101 handshake status, event-type/byte-count
  summaries, and timeout; the full-capability gate rejects Realtime evidence
  whose summarized event types include `error`.
  The UI script opens an isolated browser
  profile, completes the first-run custom relay form, sends one message through
  the Web UI, verifies the assistant message card, captures
  `.manual-qa/web-live-ui-provider-smoke-current-relay.png`, and then deletes the temporary
  browser profile. If you override
  `ZEROCHAT_LIVE_PROVIDER_UI_URL`, point it either at a local ZeroChat app URL
  on `127.0.0.1`, `localhost`, or `[::1]`, or at the exact HTTPS root of the
  configured Worker in Worker-hosted-key mode. The remote app and proxy Origins
  must match exactly; all other remote pages, credentials, query strings,
  fragments, and non-root paths are refused before any browser or Provider
  request. The anonymous temporary-Worker drill builds the current production
  `dist`, deploys the app and Worker together, and locks a second deployment to
  that exact same Origin so Cloudflare cannot interpose an unsolvable
  cross-origin preflight challenge. To prove the browser UI path through a deployed AI
  proxy/Worker, set `ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL` to the remote HTTPS
  Worker root; the UI smoke rejects local/private-network proxy hosts,
  credentials, query strings, fragments, and provider Base URL lookalikes before
  it fetches provider models, then fills the first-run `AI proxy URL` field
  without printing the URL in the result. RFC-reserved example/test/invalid
  hosts are accepted only by `--validate-inputs-only`; an actual drill rejects
  them before browser launch or report creation. If you override
  `ZEROCHAT_LIVE_PROVIDER_UI_SCREENSHOT`,
  keep it under `.manual-qa` and name it `web-live-ui-provider-smoke*.png` so
  the evidence path cannot overwrite unrelated files. If the provider works
  from terminal tools but blocks
  browser-origin requests, the UI script should fail with the visible CORS guidance and the failure screenshot; use a configured Cloudflare Worker or
  another browser-allowed disposable relay for a full UI assistant-message pass.
  `pnpm run drill:live-provider-ui-local-proxy` is available when a live relay
  needs an isolated local verification of the same Worker `/proxy` contract:
  it starts a Fetch-safe loopback harness, gives that Worker a process-local
  hosted provider key, sends only a derived Worker access key on the client
  request, and records model-list plus one production-aligned streaming chat-marker result in
  `.manual-qa/live-provider-ui-local-proxy-diagnostic.json`. It requires the
  same temporary provider Base URL/API key and
  `ZEROCHAT_LIVE_PROVIDER_CONFIRM=SEND_ONE_TEST_MESSAGE`. The command never
  launches the Web UI and always writes `releaseEvidence: false` and
  `browserOriginProven: false`; it is a contract diagnostic, not a substitute
  for a deployed HTTPS Worker or `pnpm run drill:live-provider-ui` browser-origin
  evidence.
  Validate a local UI pass or failure screenshot with
  `pnpm run check:live-provider-ui-screenshot`, or use the focused command
  `node scripts/runtime-smoke-artifact-check.mjs
  --only-live-provider-ui-screenshot
  --require-live-provider-ui-screenshot=.manual-qa/web-live-ui-provider-smoke-current-relay.png`
  when reviewing an explicitly named diagnostic screenshot.
  If you override `ZEROCHAT_LIVE_PROVIDER_MODEL`,
  `ZEROCHAT_LIVE_PROVIDER_IMAGE_MODEL`,
  `ZEROCHAT_LIVE_PROVIDER_AUDIO_SPEECH_MODEL`,
  `ZEROCHAT_LIVE_PROVIDER_AUDIO_TRANSCRIPTION_MODEL`,
  `ZEROCHAT_LIVE_PROVIDER_EMBEDDING_MODEL`, or
  `ZEROCHAT_LIVE_PROVIDER_MODERATION_MODEL`, or
  `ZEROCHAT_LIVE_PROVIDER_REALTIME_MODEL`, provide only the provider model id, not a URL,
  query string, token, environment variable name,
  whitespace/control-character value, or other secret-bearing input.
  The runtime artifact gate validates those provider UI screenshots for PNG
  bytes, dimensions, sampled pixel diversity, and blank/collapsed captures
  whenever they exist locally or in a collected QA artifact set.
- For hosted disposable checks, open the manual `Live Release Drills` GitHub
  Actions workflow. Set repository Secrets with the same `ZEROCHAT_LIVE_*`
  values, then enable the provider smoke toggle, optional provider image/audio/
  low-cost capability/realtime toggles, or choose `cloudflare`/`gist` sync mode
  in the workflow inputs. The workflow runs the safety guards first and does
  not store secrets in the repository. Provider API and UI smokes are
  separate proof objects: the UI smoke runs after the API smoke has produced a
  validated sanitized report, even when optional full-capability API routes
  fail, reads the optional `ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL` repository
  Secret for browser-allowed Worker/proxy passes, validates the sanitized UI
  JSON report with `node scripts/release-blocker-report.mjs
  --check-live-provider-ui-report
  --live-provider-ui-report=.manual-qa/live-provider-ui-smoke-current.json
  --live-provider-ui-attempt-report=.manual-qa/live-provider-ui-smoke-attempt-current.json`,
  and uploads `live-provider-ui-smoke-report` only after that report validator
  succeeds. The screenshot artifact uploads only after the UI report validator
  and PNG validator both pass, so browser diagnostics survive CORS/provider
  failures without treating a standalone screenshot as release evidence or
  requiring a fake screenshot for missing-secret or invalid API-report failures.
  A passed UI report must carry top-level `browserOriginProven: true` together
  with `browserMessageSent: true` and `markerCaptured: true`; the nested
  `proxyPreflight.browserOriginProven: false` remains the explicit statement
  that Node-side model/chat preflight is not browser-origin release evidence.
  The API smoke writes
  `.manual-qa/live-provider-smoke.json`, validates it with `node scripts/runtime-smoke-artifact-check.mjs --only-live-provider-api-report --require-live-provider-api-report=.manual-qa/live-provider-smoke.json`,
  and uploads it as `live-provider-smoke-report` after either a successful API
  smoke or a failed API smoke that still wrote a validated, sanitized
  diagnostic report. Missing-secret preflight failures still do not invent an
  artifact. When provider image, audio, low-cost capability, and Realtime
  toggles are all enabled, the workflow also validates the same report with
  `node scripts/runtime-smoke-artifact-check.mjs --only-live-provider-api-report --require-live-provider-full-capability-report=.manual-qa/live-provider-smoke.json`
  then copies it to the canonical local release path
  `.manual-qa/live-provider-smoke-full-current.json`, reruns the same strict
  gate against that promoted path, and uploads a separate
  `live-provider-full-capability-report` artifact only after the promoted
  canonical report validates. Before UI screenshot upload, the workflow sets
  `ZEROCHAT_LIVE_PROVIDER_UI_REPORT=.manual-qa/live-provider-ui-smoke-current.json`,
  `ZEROCHAT_LIVE_PROVIDER_UI_ATTEMPT_REPORT=.manual-qa/live-provider-ui-smoke-attempt-current.json`,
  and `ZEROCHAT_LIVE_PROVIDER_UI_SCREENSHOT=.manual-qa/web-live-ui-provider-smoke.png`,
  validates the two UI JSON report paths, then runs
  `node scripts/runtime-smoke-artifact-check.mjs
  --only-live-provider-ui-screenshot
  --require-live-provider-ui-screenshot=.manual-qa/web-live-ui-provider-smoke.png`
  and uploads the screenshot only after both validations succeed. When a live
  sync mode is selected, the drill itself writes a sanitized blocked report if
  required secrets are missing or the destructive confirmation is absent. The
  workflow first validates `.manual-qa/live-sync-release-drill.json` with the
  same diagnostic gate exposed locally as `pnpm run check:live-sync-report`
  so skipped/blocked/failed diagnostics are structurally safe to review. If a
  Cloudflare or Gist drill step succeeds, the workflow then validates the same
  report with the passed-only gate exposed locally as
  `pnpm run check:live-sync-release-pass`;
  the upload step requires the diagnostic gate and either a successful
  passed-only gate or a skipped passed-only gate. This keeps blocked/failure
  stage and cleanup evidence reviewable without exposing endpoints, tokens, or
  passphrases, while preventing a successful hosted drill from becoming release
  evidence unless the report is truly passing. The workflow ends with
  `Check local runtime cleanup` under `if: ${{ always() }}`, running
  `pnpm run check:local-cleanup` after provider UI smoke, Cloudflare/Gist live
  sync attempts, report validation, and upload decisions.
- Switch language from System to one non-default language and back.
- Confirm installability through the manifest and service worker.
- Deploy to Cloudflare Pages or GitHub Pages only after
  `pnpm run verify:release` passes.

## Cloudflare Worker

- Bind `zerochat_kv`.
- Bind `zerochat_r2` for image-heavy or long-history sync.
- Set `ZEROCHAT_ACCESS_KEY` from the app's derived Cloudflare access key.
- Use Worker secrets for provider keys when browser key exposure should be
  avoided.
- Keep `AUTO_ALLOWED_ORIGINS` and `AUTO_ALLOWED_HOSTS` enabled for easy personal
  deployments, or set explicit allowlists for locked-down deployments.
- Verify `DELETE /sync/clear` in a disposable test namespace before production
  use.

## Native Platforms

- Run `pnpm run check:native-prereqs -- --platform=current` on the machine that
  will build native packages, or pass a target platform explicitly, then install
  any missing SDK/toolchain before visual QA.
- Complete [NATIVE_QA_CHECKLIST.md](NATIVE_QA_CHECKLIST.md) on the target SDK,
  simulator, emulator, or device before calling a native platform release-ready.
- Do not market a native build as full feature parity until native Skill
  import/edit/delete is built and visually tested on that platform. Current
  native source includes Skill management surfaces and must preserve synced
  Skill data, but runtime QA is still required per platform.
- Do not market native encrypted backup import/export as release-complete until
  that platform has passed runtime visual QA with its trusted file picker,
  explicit destructive restore confirmation, provider-key replacement, and
  next-sync behavior. Android, Apple, and Linux now have those source paths;
  Windows uses the shared PWA backup UI through WebView2.
- Do not market native clear-cloud-data as complete until a disposable platform
  run verifies upload, restore, clear, and post-clear readback on that OS. Until
  then, document it as core/source support or use the Web/PWA verified path.
- Windows: build the checked-in WinUI 3 solution/project in both Debug and
  Release, verify Credential Locker storage, then rebuild Release with
  `pnpm run build:windows:msix`
  before you package as MSIX with `pnpm run package:windows:msix`. Start with
  `pnpm run qa:windows-msix` in dry-run mode, or run `pnpm run qa:windows` for
  the full local WebView/MSIX dry-run chain. The local `pnpm run
  qa:windows-webview` command now validates its screenshot/metadata with
  `--only-runtime-artifact --require-runtime-artifact=windows` before returning. If no
  `.sln`/`.vcxproj`, MSIX manifest, visual assets, packaging script, or guarded
  install QA helper is checked in, Windows release QA is blocked. The generated
  MSIX package script must reject a copied `web\` bundle that differs from the
  current `dist\` output and must require the `-MsixReady` build marker, so
  stale hashed chunks or unpackaged runtime bootstrapper output cannot ship.
  The focused local WebView command intentionally does not validate trusted
  MSIX install/update evidence; run
  `pnpm run qa:windows-msix-trusted:elevated` as the primary release rerun
  wrapper to capture packaged-app evidence and immediately validate it with
  `pnpm run check:windows-msix-trusted-report`,
  `pnpm run check:runtime-artifacts`, and `pnpm run check:local-cleanup`. The
  lower-level `pnpm run qa:windows-msix-trusted` command is only the trusted QA
  step inside that wrapper.
  Hosted Windows CI now mirrors the visual evidence flow by building the
  unpackaged Release shell, running `scripts/windows-webview-runtime-smoke.ps1`,
  validating `.manual-qa\windows-webview-runtime-smoke.png` and `.json` with
  `--only-runtime-artifact --require-runtime-artifact=windows`, then rebuilding
  as `-MsixReady` for MSIX packaging.
  The generated MSIX must be signed with a trusted certificate before
  install/update/uninstall QA. For disposable self-signed QA packages, use an
  elevated disposable QA profile. Prefer
  `pnpm run qa:windows-msix-trusted:elevated` for the current-package pass; it
  refreshes host preflight, signs previous/current MSIX packages, installs the
  previous version, captures the packaged app window, updates, captures again,
  uninstalls, removes temporary trust/private key/package data/workspace
  directories, validates trusted/full runtime artifacts, validates cleanup, and
  saves
`.manual-qa\windows-msix-current-trusted-install-update-qa.json`. The lower
level helper's primary self-signed QA path uses `-TrustMachineCertificate` and
`-TrustedCertificatePath <public .cer>` to import the leaf certificate into
Local Machine Trusted People before calling `Add-AppxPackage`; normal cleanup
removes that entry with `-RemoveTrustedMachineCertificate`. The release path
must not import the leaf into Current User Trusted People or Local Machine
Root. The optional `-TrustSigningRoot` switch is only for an actual CA root and
rejects a non-CA certificate from its X509 Basic Constraints. The elevated
requirement remains because App Installer checks machine trust. The helper no
longer exposes Current User trust switches; its broader outer cleanup only
removes historical residue left by older QA runs. Use the
  helper's `-Update` mode only after a previous signed build is already
installed so version ordering and the post-update installed version are
checked by the script. The trusted report must also contain the current
`dist\`/packaged `web\` SHA-256 manifests and previous/current package
byte/SHA-256 evidence, which `pnpm run check:runtime-artifacts` rechecks
against the files on disk and enforces the PRD `< 20MB` current MSIX package
budget. If
`.manual-qa\windows-msix-current-trusted-install-update-qa.failure.json` is
newer than the passing report, the runtime-artifact gate treats that failure as
the current trusted MSIX blocker and does not bury it under stale
success-report hash diffs; if a newer passing
`.manual-qa\windows-msix-current-trusted-install-update-qa.json` exists, it
supersedes the older diagnostic failure history. Failure reports are
diagnostic-only host AppX evidence, so final release proof still requires a
newer passing report plus `pnpm run check:windows-msix-trusted-report` and
`pnpm run check:runtime-artifacts`. Before spending a full install/update QA
cycle on a suspect host, run `pnpm run report:windows-msix-host-preflight` and
`pnpm run check:windows-msix-host-preflight`; this read-only diagnostic records
recent AppXDeploymentServer cleanup events, AppX service state, sanitized
Windows Restart Manager lock holders, and host-specific next actions without
importing certificates or installing packages. Restart reported lock-holder
applications and rerun the preflight before escalating to wider AppX repair or
a fresh disposable Windows profile/VM. If it classifies
`windows-appx-deployment-deleted-package-cleanup-access-denied`, the
trusted QA helper fails fast before creating a new temp run so reviewers do not
wait through another install timeout on the same host. After repairing the host
or moving to a fresh disposable Windows profile/VM, rerun
`pnpm run qa:windows-msix-trusted:elevated`; if a repaired host still has the
historical failure report newer than the last passing report, invoke
`pnpm run qa:windows-msix-trusted:elevated -- -SkipKnownHostBlockerPreflight`
for that verified rerun. The manual
`Windows Signed MSIX` workflow can produce a signed artifact from repository
Secrets for this disposable-machine QA after rerunning the Windows WebView
shell and MSIX readiness guards, but it deliberately does not import
certificates or install packages; it also verifies temporary PFX cleanup and
fails if the signed MSIX artifact is missing.
- Android: run `pnpm run qa:android` for the local emulator pass. It builds the
  debug APK, auto-starts an AVD when needed, runs UI and encrypted Cloudflare
  sync smokes, pulls the installed base APK back from the device, verifies its
  byte/SHA-256 evidence against the local debug APK through
  `pnpm run check:runtime-artifacts`, refreshes
  `.manual-qa/android-current-contact-sheet.png`, and leaves screenshots in
  `.manual-qa/`. The helper also stops the emulator and adb server it started
  unless `-- --keep-emulator` or `-- --keep-adb-server` is passed. If only the
  Android overview needs rebuilding from existing screenshots, run
  `pnpm run check:android-contact-sheet`. After a fresh debug build,
  `pnpm run qa:android:current` runs the same emulator QA with `--skip-build`
  against the current APK and is the preferred path for refreshing screenshots,
  Cloudflare sync proof, and the contact sheet after build evidence has already
  been captured. Budget roughly 50-60 minutes for the full Android runtime pass
  on slower local machines; the encrypted Cloudflare drill alone can take roughly
  29 minutes under emulator load. The wrapper never selects an attached physical
  device implicitly; set `ANDROID_SERIAL` or pass `-- --allow-physical-device`
  to authorize one. If UI smoke is current but Cloudflare smoke needs recovery,
  `pnpm run qa:android:refresh-cloud` first revalidates the UI report's APK hash
  and device, then reinstalls the APK and reruns only sync evidence.
  Run `pnpm run check:android-lint`, then build the unsigned release APK with
  `pnpm run build:android:release`, then run
  `pnpm run check:android-release-size`; this enforces the PRD `< 8MB` APK
  budget before any AAB/store packaging work and writes
  `.manual-qa/android-release-size.json` with the APK bytes/SHA-256, ZIP
  structure, and R8/resource-shrinking checks for hosted artifact review.
  Then verify IME behavior and EncryptedSharedPreferences on at least one
  physical device before creating an AAB for release.
- iOS/macOS: build the checked-in `ZeroChat.xcodeproj` shared `ZeroChat` scheme
  with Xcode, confirm it includes `App/` and links `ZeroChatCore`, archive from
  Xcode, verify Keychain storage on a clean simulator or device, then distribute
  through TestFlight/App Store or notarized macOS packaging. After exporting an
  iOS IPA, copy or export it under `.manual-qa/`, then run
  `pnpm run check:apple-ipa-size -- --ipa=.manual-qa/<file>.ipa` to write
  `.manual-qa/apple-ios-ipa-size.json` with repo-relative, publish-safe file
  evidence and enforce the PRD `< 12MB` IPA budget;
  `pnpm run check:runtime-artifacts` also validates that report whenever it
  exists, and target CI/reviewers can require it with
  `--require-runtime-artifact=apple-ios-ipa`. After building or copying a
  macOS `ZeroChat.app` under `.manual-qa/`, run
  `pnpm run check:apple-macos-app-size -- --app=.manual-qa/<file>.app` to write
  `.manual-qa/apple-macos-app-size.json` with repo-relative bundle manifest,
  `Contents/Info.plist`, executable, and PRD `< 15MB` `.app` budget evidence;
  `pnpm run check:runtime-artifacts` validates that report whenever it exists,
  and target CI/reviewers can require it with
  `--require-runtime-artifact=apple-macos-app`. On the macOS target host, run
  `pnpm run qa:apple` first; it writes
  `.manual-qa/native-prereq-apple.json`, builds the SwiftPM product plus Xcode
  shared scheme, captures `.manual-qa/apple-runtime-smoke.png`, writes
  `.manual-qa/apple-runtime-smoke.json`, validates the preflight report and
  runtime artifact with focused gates, and checks the app bundle manifest
  against the PRD `< 15MB` macOS `.app` budget. Treat
  that as a launch/screenshot smoke only, not iOS/iPad/device/signing/sync or
  the `< 12MB` IPA archive release completion.
- Linux: run `cargo check`, `cargo build --release`, and
  `pnpm run check:linux-packaging` on a machine with GTK4 and libadwaita
  development packages, then package with Flatpak or AppImage. On the
  Linux or WSL target host, run `pnpm run qa:linux` first; it writes
  `.manual-qa/native-prereq-linux.json`, builds the locked release binary,
  captures `.manual-qa/linux-runtime-smoke.png` under Xvfb, writes
  `.manual-qa/linux-runtime-smoke.json`, validates the preflight report and
  runtime artifact with focused gates, and checks the launched binary against
  the PRD `< 10MB` Linux binary budget. Treat that
  as a launch/screenshot smoke only, not interactive GNOME, Secret Service,
  file-picker, sync, destructive-action, Flatpak, AppImage, or Flatpak-runtime
  completion. For standalone package-size evidence, copy the target Linux
  release binary under `.manual-qa/`, run
  `pnpm run check:linux-release-size -- --binary=.manual-qa/<file>` to write
  `.manual-qa/linux-release-size.json`, and let target CI/reviewers require it
  with `--require-runtime-artifact=linux-release-binary`; this validates a
  repo-relative ELF file against the PRD `< 10MB` Linux binary budget without
  replacing the Linux runtime smoke. The checked-in Flatpak manifest, AppImage AppDir script, and
  AppStream metainfo are source metadata; they still require real target-host
  Flatpak/AppImage package builds and sandbox QA passes before publishing.

## Data Safety

- For the temporary browser-origin Worker drill, use
  `pnpm run drill:live-provider-ui-temporary-worker` only with a disposable
  Cloudflare token supplied through
  `ZEROCHAT_LIVE_PROVIDER_UI_TEMPORARY_CLOUDFLARE_API_TOKEN_FILE`. The value is
  a path readable by this one run (a short-lived UTF-8 file or anonymous pipe),
  not a token pasted into arguments, reports, or logs. The drill reads it once,
  maps it only to the temporary `CLOUDFLARE_API_TOKEN` of the Wrangler deploy
  and delete children, and keeps the token out of build, browser, and report
  children. Success, failure, timeout, and interruption all delete the exact
  temporary Worker and isolated Wrangler directory; the drill never runs
  `wrangler logout` and cannot clear an existing global Wrangler session.

- Never commit API keys, GitHub Tokens, Cloudflare secrets, browser profiles, or
  generated build directories.
- Test import/export and destructive actions with disposable data first.
- Run the live cloud-sync release drill only with a disposable GitHub Token/Gist
  or a dedicated Cloudflare Worker namespace and KV/R2 buckets:

```bash
pnpm run drill:live-sync
```

  `pnpm run drill:live-sync --help` is a no-report, no-remote usage display.
  The drill accepts no action arguments: any unknown or combined argument fails
  before it reads drill inputs, writes a report, or touches disposable storage,
  and the failure never echoes supplied values.

  Set `ZEROCHAT_LIVE_SYNC_MODE`, `ZEROCHAT_LIVE_SYNC_PASSPHRASE`, and
  `ZEROCHAT_LIVE_SYNC_CONFIRM=DELETE_REMOTE_ZEROCHAT_TEST_DATA`, plus either
  `ZEROCHAT_LIVE_WORKER_ENDPOINT` for Cloudflare or
  `ZEROCHAT_LIVE_GITHUB_TOKEN` for Gist. Do not use a personal production vault
  for the first live E2E pass. Quick Tunnel endpoints are diagnostic-only and
  cannot prove deployed Worker/KV persistence; `*.trycloudflare.com` is rejected
  before any remote write and cannot produce live-sync release evidence. Use a
  deployed disposable Worker endpoint instead. If you override
  `ZEROCHAT_LIVE_GIST_FILE`, keep
  it to a single file name such as `zerochat-sync.json`; the drill blocks before
  touching remote storage when the value is empty, too long, contains a path,
  contains control characters, or looks like a URL, token, environment variable,
  or other secret-bearing input. If you reuse an existing disposable Gist with
  `ZEROCHAT_LIVE_GIST_ID`, provide only the bare 8 to 64 character hexadecimal
  Gist id, not a GitHub URL, owner/id path, query string, token, environment
  variable name, or other secret-bearing input. Blocked and failed drill exits
  rethrow only the sanitized error summary so CI logs do not become a second
  leakage surface.
  A passing run writes `.manual-qa/live-sync-release-drill.json` with
  `evidenceType: "release-pass"`, `releaseEvidence: true`, the mode, a
  `drillName` in the form `ZeroChat live sync release drill <epoch-ms>` whose
  timestamp falls between `startedAt` and `finishedAt`, staged
  upload/pull/edit/delete/clear milestones, stale-object cleanup counts, and
  disposable-Gist cleanup state. Skipped, blocked, and failed runs must label
  themselves as `evidenceType: "diagnostic"` with `releaseEvidence: false`.
  Passing release evidence must not keep diagnostic-only fields such as
  `missingInputKeys`, `releaseBlockerSummary`, `requiredInputs`,
  `reviewerChecklist`, or `nextSteps`; those fields belong only on skipped,
  blocked, or failed reports.
  A skipped no-credentials report also lists the supported disposable modes,
  states that destructive confirmation is required, includes
  `safeToPublish: true`, scopes that to
  `publishSafetyScope: "sanitized-diagnostic-only; not release evidence"`, and
  includes a reviewer checklist, a non-secret `requiredInputs` list with the
  disposable storage, passphrase, provider credential, destructive
  confirmation, and passed-report validation needed for a real rerun, plus
  `missingInputKeys` safe aliases such as `liveSyncMode` and
  `providerSpecificDisposableCredential`, so it cannot be confused with
  release-pass evidence or leak env names. It also includes a
  `releaseBlockerSummary` with `releaseEvidence: false`, `remoteTouched`,
  `missingInputCount`, supported modes, required input count, required action,
  and validation commands so reviewers and CI can compare the summary against
  the report body instead of relying on prose.
  Review or upload that report with the live drill evidence; it must not contain
  tokens, passphrases, Worker endpoints, or provider keys. For release-ready evidence, validate it with
  `pnpm run check:live-sync-release-pass`, which runs
  `node scripts/runtime-smoke-artifact-check.mjs --only-live-sync-report --require-live-sync-passed-report=.manual-qa/live-sync-release-drill.json`;
  the passed-only gate also requires the report `finishedAt` timestamp to be
  within 72 hours of verification, so stale successful reports cannot be reused
  as current release evidence. Passing and diagnostic reports also include a
  `sourceFingerprint` over the guarded sync source, shared schema, Worker, and
  drill/check scripts; the live-sync report validator recomputes that
  fingerprint and rejects reports from an older sync source tree. `pnpm run
  check:live-sync-report` is for preserving skipped/blocked/failed diagnostic
  reports and must not be treated as a live E2E pass. For the final
  local release pass after a disposable drill succeeds, run
  `pnpm run verify:release:live-sync`; it checks the same passed-only report
  first, then continues into the normal full release gate.
- The same drill can be launched from GitHub Actions through the manual
  `Live Release Drills` workflow. Use repository Secrets for
  `ZEROCHAT_LIVE_SYNC_PASSPHRASE`, `ZEROCHAT_LIVE_WORKER_ENDPOINT`, and
  `ZEROCHAT_LIVE_GITHUB_TOKEN`; `ZEROCHAT_LIVE_GIST_ID`,
  `ZEROCHAT_LIVE_GIST_FILE`, and `ZEROCHAT_LIVE_PROVIDER_MODEL` are optional.
  The workflow validates the sanitized live sync drill report with the required
  diagnostic runtime-artifact gate, runs the passed-only gate when a Cloudflare
  or Gist drill step succeeds, then uploads it as
  `live-sync-release-drill-report` after a Cloudflare/Gist drill step succeeds
  or fails, but only when the diagnostic gate succeeds and the passed-only gate
  either succeeds or was skipped for a non-success drill.
  It then runs the final local runtime cleanup step with `always()`, so a
  blocked or failed disposable drill still proves no ZeroChat-owned preview
  server, app process, adb, or emulator residue was left behind.
- Confirm a second device can restore encrypted sync using the same sync settings
  and data encryption password.
- For GitHub Gist sync, confirm first-device upload, second-device restore,
  first-sync conflict handling, merge, wrong-password rejection, Skill
  add/edit/delete propagation, and clear-remote file deletion with a readback
  that shows the ZeroChat sync file is gone.
- With sync enabled in a disposable Web/PWA target, add, edit, and delete one
  test skill, then confirm the second device/profile receives the change and the
  deleted skill does not remain as a stale cloud object. Repeat this on native
  after building that platform's native Skill surface with the target SDK.
- For Cloudflare, confirm `/sync/clear` removes the disposable head, manifest,
  message chunks, and Skill chunks from the test KV/R2 namespace before reusing
  or deleting that namespace. The live drill should also read `/sync/head`,
  `/snapshot`, and previously observed Skill object URLs after clear so stale
  cloud data cannot hide behind a successful delete response.
- If the data encryption password changes, update the Worker
  `ZEROCHAT_ACCESS_KEY` before expecting Cloudflare sync to continue.
