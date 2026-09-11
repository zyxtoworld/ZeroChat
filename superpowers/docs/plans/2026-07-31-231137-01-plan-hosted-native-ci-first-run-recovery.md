# Hosted native CI first-run recovery

**Goal:** Make a clean checked-in source revision capable of reaching every hosted Web and native CI proof gate without deterministic workflow or compile failures.
**Why planning is required:** This recovery crosses GitHub Actions, the focused Web verifier, Swift, and GTK/Rust source. Local Windows checks can prove contracts and source integrity, but only a later hosted run can prove Apple/Linux target builds and artifact aggregation.
**Acceptance:** Clean-checkout jobs install locked dependencies before Node validators; Android license acceptance cannot fail from `pipefail`; `verify:web-local` never refreshes all-platform diagnostics or mutates release evidence; the reported Apple and Linux compile errors are fixed at their source; local tests, format checks, repository guards, docs guards, security, and cleanup pass. Do not claim hosted evidence until a current-source GitHub Actions run succeeds.

### Outcome 1: Restore clean-checkout workflow prerequisites
- Work: Move locked workspace installation ahead of Windows and Android Node validators, add the missing Android pnpm/cache setup, and make Android SDK license acceptance tolerate `yes` closing after `sdkmanager` succeeds.
- Verify: Focused workflow contract tests plus repository and completion-audit guards.

### Outcome 2: Isolate focused Web verification from native release diagnostics
- Work: Keep Web build, browser, accessibility, visual, artifact, and cleanup checks, while disabling all-platform diagnostic bootstrap and release-checkpoint/doc mutation in `--web-local` mode.
- Risks/open questions: Full `--release` and strict all-platform modes must retain their current diagnostic and checkpoint behavior.
- Verify: Red-first verifier order/policy tests and a focused Web-local run.

### Outcome 3: Fix Apple and Linux target compile failures
- Work: Correct Swift timestamp closure arity and resolve Linux imports, visibility, API-version, ownership, type, and schema drift errors reported by the hosted target compilers.
- Risks/open questions: Windows cannot substitute for macOS/Xcode or Linux GTK target compilation. Local contract/static checks are necessary but not target-runtime evidence.
- Verify: Swift source contracts, Linux Rustfmt/contracts, and source-level regression guards; later hosted target builds remain required.

### Outcome 4: Re-run release integrity gates and record residual blockers accurately
- Work: Run focused and broad local gates, update durable QA records only with fresh evidence, and retain Windows elevation, target runtime, disposable sync, hosted-run, and Provider capability gaps as blockers until independently proven.
- Verify: `D:\Node.js\pnpm.CMD run check:repo`, `check:completion-audit`, `check:docs`, `check:security`, and `check:local-cleanup`.

## Result

- Source recovery implemented. Windows and Android clean-checkout dependency ordering, Android pnpm/cache setup, and `sdkmanager` pipefail handling are guarded by focused workflow contracts and repository/completion audits.
- Focused Web verification is isolated from all-platform diagnostics and release checkpoint/current-evidence writes. Ordering/policy regressions and the complete 206-file / 1,862-test, two-times-120-screenshot Web-local run pass; pre/post hashes prove the release checkpoint and current-evidence docs were untouched during the run.
- Apple source contracts pass after correcting timestamp callback arity. Linux `cargo check --locked --tests`, Rustfmt, and Linux contracts 4/4 pass locally after resolving the hosted compiler errors; the temporary Windows `pkg-config` discovery shim is type-check support only, not target-host runtime evidence. A full release run exposed and the follow-up fixed one stale native-parity regex that still expected consuming Gist response validation.
- A current-source hosted GitHub Actions run and Apple/Linux target-host runtime evidence remain required. No hosted or target-runtime pass is claimed from these local results.
- After the trusted-MSIX trust-scope hardening, the fresh full release checkpoint (`2026-07-31T17:40:10.043Z`) executed 52 checks and failed exactly one expected step: `Runtime smoke artifacts` / `windows-trusted-msix-release-pass-missing`. Native parity, browser/PWA, 120-frame visual audit, Android Lint, Apple 5/5, Linux 4/4, Windows 26/26, ordinary and coverage 207-file / 1,865-test runs, safety checks, and cleanup passed. The current 1,379,051-byte MSIX candidate and both staged/package-internal 42-file / 1,117,386-byte Web trees match `dist`; trusted install/update/uninstall still requires an explicitly elevated disposable Windows profile.
- Read-only inspection of the only remote run (`30565599494`, commit `3e318060be6912f3df4e5b2a36c91a53f92a865a`) maps every deterministic failure to the current recovery: Ubuntu Web diagnostics called unavailable `powershell`; Windows and Android validated before workspace installation; Android also rejected the successful `sdkmanager` result after `yes` received a closed pipe; Apple hit the timestamp closure arity errors; Linux emitted the 39 compile errors fixed locally. Current workflows pass an independent actionlint v1.7.12 check and focused contracts, but the stale failed run is not promoted as release evidence.
- A post-gate read-only reprobe still found no alternate target execution path without external state: WSL is present only as an install prompt with no distribution, Docker/Podman and Swift/Xcode are absent, Windows Sudo is disabled, the current shell is not elevated, the repository has zero self-hosted runners and no open PR, and GitHub still has only stale run `30565599494` for the old HEAD. No UAC prompt, token scope, system component, commit, branch, or remote state was changed during this audit.
