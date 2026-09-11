# Current local release blocker evidence

**Goal:** Refresh every release artifact this Windows host can prove from the current source and packages, while leaving external platform, credential, and trusted-host blockers explicitly fail-closed.
**Why planning is required:** The work launches native runtimes, owns emulator/browser process trees, updates generated release evidence, and may expose consequential external-state prerequisites.
**Acceptance:** Official generators bind evidence to the current source/artifact; only task-owned processes and temporary resources are stopped; no report, hash, blocker, preserve snapshot, bundle threshold, system policy, credential, or external platform result is fabricated; each runtime command has a captured exit status and cleanup proof.

### Outcome 1: Current Windows WebView runtime evidence
- Status: Complete. The current 52-file / 1,034,552-byte `dist` matched the runtime copy, the real app-window and tray flow passed, and the owned process residue was zero.
- Work: Run the repository WebView Release build and real runtime smoke against current `dist`, validate the generated screenshot/metadata and copied asset manifest, and confirm the owned app/WebView process tree is gone.
- Risks/open questions: The smoke launches the actual unpackaged app. Stop if cleanup cannot identify ownership exactly or if a non-ZeroChat process would be affected.
- Verify: `pnpm run qa:windows-webview`

### Outcome 2: Current Android emulator evidence
- Status: In progress. The global broadcast-idle probe was removed with focused red/green evidence. A first current-APK run reached the assistant share chooser, where persistent dropbox evidence showed guest system starvation rather than a blocked ZeroChat business stack. The same data and share flow passed with host GPU, 4 GiB RAM, and a real-Launcher readiness gate; the focused readiness/cleanup/timeout matrix is 13/13 green.
- Work: Run one current-APK QA pass on `ZeroChatPixelAscii` through the ASCII SDK path with the corrected runtime owner. Preserve UI/cloud-sync screenshots and aggregate metadata only when bound to the current APK/source.
- Risks/open questions: Never run a second emulator concurrently. Stop on ambiguous process ownership, BIOS/path regression, offline device, or failed cleanup; inspect before any differentiated retry.
- Verify: `pnpm run qa:android:current -- --avd ZeroChatPixelAscii`

### Outcome 3: Current Windows trusted-MSIX host state
- Work: Run the official non-mutating host preflight, enumerate exact lock holders and package state, and separate task-owned cleanup from user or elevated actions. Do not install trust, alter policy, close user applications, or mutate packages without existing explicit authorization.
- Risks/open questions: Restart, disposable-profile creation, elevation, user application closure, and trust-store mutation remain user actions.
- Verify: `pnpm run report:windows-msix-host-preflight`

### Outcome 4: Local capability and external-input inventory
- Work: Inspect WSL state, GitHub remote/workflows, and live sync/provider scripts without network mutations. Record exact credential variable names, file inputs, minimum scopes, external data/cost, and whether existing authorized local inputs are available without reading or printing values.
- Risks/open questions: Do not install Windows features, start external drills, expose secrets, or claim macOS/Linux/hosted evidence from this host.
- Verify: `git remote -v`

### Outcome 5: Source-bound release summaries
- Work: After each material local runtime artifact, regenerate strict preflight and blocker summaries only through official scripts; validate freshness, input binding, blocker counts, and final owned-resource cleanup. Classify remaining blockers as locally completed, requiring user input/action, or requiring macOS/hosted runners.
- Risks/open questions: Blocked reports are valid evidence; they must retain `releaseEvidence=false` until every required external result exists.
- Verify: `pnpm run check:strict-release-preflight && pnpm run check:release-blockers`
