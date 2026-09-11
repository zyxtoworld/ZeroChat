# Current-source Windows trusted MSIX release evidence

**Goal:** Bind trusted Windows install, update, launch, and uninstall evidence to the current source and Web bundle.
**Why planning is required:** The QA run temporarily changes LocalMachine certificate trust and installed AppX state from an elevated shell.
**Acceptance:** Run only after the read-only host preflight is clear and no ZeroChat process exists; stop on any failed stage; preserve failure diagnostics; finish with no ZeroChat package, test certificate, package data, temporary QA directory, or runtime process; validate the report against the current source and `dist`.

### Outcome 1: Prove the host is ready
- Work: Build the current Windows Release output, verify its Web assets match `dist`, and require a clear AppX host preflight before elevation.
- Risks/open questions: A new WindowsApps cleanup event or lock holder must stop the trusted run before package or certificate changes.
- Verify: `D:\Node.js\pnpm.CMD run check:windows-msix-host-preflight-clear`

### Outcome 2: Produce current trusted runtime evidence
- Work: Use the repository elevated wrapper to install the derived previous MSIX, update to the current MSIX, launch and capture runtime evidence, then uninstall and remove temporary trust material.
- Risks/open questions: UAC approval is required; the wrapper must retain a failure report if AppX deployment fails and must execute its cleanup path before returning.
- Verify: `D:\Node.js\pnpm.CMD run check:windows-msix-trusted-report`

### Outcome 3: Prove cleanup and release-gate binding
- Work: Validate the full runtime artifact gate and independently confirm no ZeroChat AppX package or test certificate remains.
- Verify: `D:\Node.js\pnpm.CMD run check:local-cleanup`

## Result

- The current Windows Release and WebView runtime builds pass with 42 Web files / 1,117,386 bytes matching `dist`; the 1280x735 runtime screenshot is nonblank and visually reviewed.
- The current unsigned package candidate is 1,379,060 bytes / SHA-256 `265BADC08EC3A03D505241AEE951F38EF5D827F141453B5B3C43F4829B60615C`. Its staged and package-internal Web trees both match `dist` at 42 files / 1,117,386 bytes / SHA-256 `2ABEA03BA0236507CD412A7D5A4D7BC15CDE83322F869912E5B49824A7585645`.
- The read-only host preflight is clear with no active lock holder, but the current shell is not elevated. The UAC launch was cancelled before the elevated wrapper started, so no package or certificate state changed and no trusted runtime evidence was claimed.
- `verify:release` reaches every local gate and retains only the audited `windows-trusted-msix-needs-elevated-current-source-rerun` runtime blocker. Outcome 2 remains open until the elevated install/update/launch/uninstall flow completes.
