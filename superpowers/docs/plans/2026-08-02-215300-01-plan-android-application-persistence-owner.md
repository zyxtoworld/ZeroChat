# Android application-owned persistence and sync plan

## Root cause

`SnapshotPersistence` owns a process-lifetime coroutine queue, while `AutoSyncCoordinator` and `acceptSyncedSnapshot` are created by one Compose Activity instance. A queued save can resume after Activity recreation, call the closed coordinator, and publish through the destroyed Composition callback. The new Activity cannot observe that completion, so a durable local edit may never auto-sync until another edit happens.

## Outcome

- Move repository, SecretStore, recovery gate, committed baseline, persistence queue, and AutoSync into one `Application` runtime owner.
- Bind one process-owned sync-result observer when `AutoSyncCoordinator` is constructed; pending work cannot retain per-Composition callbacks.
- Publish save/sync results through replayable observable state collected by the current Composition.
- Keep serialized writes and process-lifetime backup work while eliminating stale UI callback capture from the persistence-to-sync path.
- Close process-owned network resources only with the Application runtime, not during Activity recreation.

## Verification

1. Add a deterministic blocked-save/collector-replacement test before production edits.
2. Update coordinator concurrency tests to constructor-owned publication.
3. Run the focused Android JVM suites, lint, debug build, repository/completion/docs gates, and local cleanup.
4. Refresh emulator/runtime evidence only after the Android source stabilizes.

## Runtime recreation evidence amendment

**Goal:** Prove on the Android emulator that a configuration change destroys and recreates `MainActivity` inside the same application process while committed Provider settings remain usable.

**Why planning is required:** The smoke test temporarily changes device rotation settings and records lifecycle evidence. Every exit path must restore the exact prior device state, and lifecycle output must never contain credentials or user data.

**Acceptance:**

- Debug builds emit fixed-format `MainActivity` create/destroy markers containing only an instance id, process id, and `isChangingConfigurations`.
- A pure parser rejects process replacement, reused Activity ids, missing configuration-change destruction, malformed events, and unexpected instance continuity.
- `android-ui-smoke.mjs` records the original rotation settings before injection, verifies a distinct Activity instance in the same process after rotation, verifies the committed OpenAI Provider key remains masked with Save disabled, and captures both rotated and restored screenshots.
- The smoke test restores `accelerometer_rotation` and `user_rotation` in `finally`, including on assertion failure. If the original values cannot be read, the injection stops before changing device state.
- Runtime-artifact, repository, completion, native-parity, Requirements, and QA guards require the same-process recreation proof without reporting credential plaintext.
- Evidence claims are limited to real Activity recreation and committed-state continuity. In-flight persistence ownership remains covered by deterministic JVM tests.

### Outcome: same-process Activity recreation proof

- Work: add debug-only lifecycle markers, a tested evidence parser, reversible rotation injection in the Android UI smoke, strict report validation, and current emulator screenshots.
- Risks/open questions: emulator rotation can be disabled or delayed; abort if PID or foreground package changes, and always restore the saved settings before reporting failure.
- Verify: `D:\Node.js\pnpm.CMD run qa:android`

### Execution result: 2026-08-03 Asia/Shanghai

- The current emulator run passed under PID `2712`: Activity instances changed `1 -> 2 -> 3`, both replaced instances reported configuration-change destruction, and rotation completed `0 -> 1 -> 0`.
- The saved device values `accelerometer_rotation=1` and `user_rotation=0` were restored and re-read before success. The OpenAI credential stayed at a 26-character mask with Save disabled in both orientations, and the report contains no plaintext.
- `android-ui-smoke-04c-activity-recreation.png` is 2400x1080 / 134,473 bytes / SHA-256 `6EE075D40C1EE4B1141BDEC81A34DE6824C1E2CC2C792DF5CC6D79B817E2571E`; `android-ui-smoke-04d-activity-recreation-restored.png` is 1080x2400 / 228,397 bytes / SHA-256 `2F4041F74950C543E8C7B4AC2497D7258E67075D793056FF321636118AFEEAD0`.
- The same long run exposed two independent harness defects: offscreen exact-text button centers could overlap three-button navigation, and the old manual-refresh wait expired during PBKDF2 work. Safe viewport tap filtering, a 360-attempt upload wait, and bounded 2,700,000 ms UI/cloud parent budgets now have focused regression coverage.
- Current aggregate evidence contains 55 UI plus 15 Cloudflare screenshots. It binds the installed/local 16,360,992-byte APK / SHA-256 `0ECCC8CAC7C9AC0E90EAFD0ECA5639CA7C4637BF113606D0DECB96AEAD164DDA` to 199 Android source files / 1,931,298 bytes / SHA-256 `24E65F8ADD5E87AF2E4CC7086F2A595D0FCEB28A5119E50350CF740C5A3F3A89`.
- This runtime result proves committed-state continuity across real same-process Activity recreation. It does not turn the deterministic JVM in-flight ownership proof into runtime evidence and does not close physical-device, hosted-CI, Apple/Linux target-host, live-sync, or Provider full-capability blockers.

## Credential screenshot safe-framing amendment

### Root cause and acceptance

- The 70-frame contact sheet exposed a QA framing defect: after the IME closed, the cloud smoke accepted a partially visible focused credential field and captured it next to three-button navigation. The product already supplied navigation-bar and IME insets plus scroll tail padding.
- The shared geometry helper must classify the current field bounds as `resolved`, `forward`, or `reverse`; the cloud smoke must perform at most eight bounded scrolls and revalidate focus, password semantics, and masked length before capture.
- The source, local replacement, remote restore, and process-relaunch records must contain only non-sensitive viewport/bounds evidence. The runtime checker must independently recompute that every complete masked Provider field remains above system navigation.

### Execution result: 2026-08-03 Asia/Shanghai

- The stale Android artifact failed the new framing gate first. A real `qa:android:refresh-cloud` rerun then passed at `2026-08-03T11:00:25.769Z` with a 1080x2400 viewport and 2160px safe bottom.
- Source, local replacement, remote restore, and process-relaunch bounds were `[111,1643][969,1906]`, `[111,1704][969,1967]`, `[111,1751][969,2014]`, and `[111,1755][969,2018]`; all four independently resolve inside the safe capture band.
- The refreshed cloud and aggregate reports are 9,858 bytes / SHA-256 `FC333930B0E6DBAE1E4631421099E6E38D2441E88E87CCA583C93196956203D9` and 8,487 bytes / SHA-256 `F8A00487331CE0CE12B620C23DDB82B1A0984EF5CE6171FD64F06BB03C373FBE`. The 70-frame contact sheet is 1,539,519 bytes / SHA-256 `F283526FEC96E55C3B1F29BFC04614E5130BBA855DB6ECF9C69E5C484AA9B206`.
- Original-resolution review of all four credential frames and the full contact sheet found complete masked fields, readable support text, correct disabled Save state, and no plaintext, blank output, overlap, or unreadable clipping.
- This closes the emulator harness and current Android visual-artifact defect only. It does not replace physical-device, hosted-CI, disposable live-sync, Apple/Linux target-host, or Provider full-capability release evidence.
