# Restore Release Audit Contracts

**Goal:** Recover every unrelated release, native, security, provider, synchronization, evidence, and CI contract removed from the repository-health, completion, browser, and accessibility audit entry points while keeping `src/app/bootstrap.tsx` as the only Web UI entry.

**Root cause:** The single-frontend migration removed entire audit systems instead of replacing only assertions tied to the deleted Web implementation. The resulting green checks no longer prove the repository contracts that `verify-release` consumes.

## Contract mapping

| HEAD contract family | Required destination | Deletion rule |
| --- | --- | --- |
| Release diagnostics, checkpoint freshness, blocker ownership, report locks, sanitized evidence, current-evidence overlays, SHA/source fingerprints | Restored completion/repository audit and existing release-report modules | Keep all; a diagnostic checkpoint must never become release evidence |
| Windows MSIX package/stage freshness, Web payload parity, trusted-host preflight and remediation | Restored release audit plus existing MSIX checks | Keep all; trusted-host blockers remain explicit |
| Hosted native CI workflow/jobs and current-source artifact coverage | Restored repository/completion audit plus workflow contract | Keep all; missing or stale CI evidence fails |
| Windows SecretStore, native credential boundaries, worker/security scans | Restored repository/completion audit plus existing contract tests | Keep all; no secret-shaped fixture may pass |
| Live sync/provider reports, capability markers, browser-origin UI evidence, source fingerprints | Restored completion/repository audit plus existing report modules | Keep all; no credential or URL output is emitted |
| Android, Apple, Linux, Windows source/parity/i18n/native prerequisites | Restored repository/completion audit | Keep all; only obsolete Web component paths may be remapped |
| Web behavior, accessibility, browser smoke and visual evidence | Current `src/app` production graph and runtime behavior | Migrate valid behavior assertions; remove only unreachable old selectors/branches |
| Deleted `src/App.tsx`, `src/main.tsx`, `src/ZeroChatAppRoot.tsx`, `src/components`, and startup bundle | Production reachability/single-implementation gates | Delete only after no production or audit dependency remains |

## Execution

1. Keep the reapply patch small and replayable: require `index.html` to point only at `src/app/bootstrap.tsx`, invoke `assertWebProductionExecutionModel` for static module/Worker/Service Worker reachability, reject deleted Web roots, and invoke `assertFrontendSingleImplementation` for UI-only narrative checks. This patch must not recreate any deleted UI source.
2. Restore the exact HEAD audit bodies only for the three checker paths, then merge the reapply patch above.
3. Run the restored audits once to enumerate concrete old-Web failures; migrate each valid Web assertion to `src/app` or remove it with a recorded reason. No broad line-count reduction is acceptable.
4. Add deterministic negative tests that mutate representative MSIX freshness, live-provider fingerprint, Windows SecretStore, and Hosted CI native-job fixtures and assert `check:repo`/`check:completion-audit` reject them.
5. Run focused tests, TypeScript, build, production reachability, repository health, completion audit, and documentation checks. Do not refresh the stale release checkpoint until this batch is stable.
6. At a stable stop, refresh only the necessary Web/Windows evidence and preserve external blockers as blockers; never report `releaseEvidence=false` diagnostics as a release pass.
7. Current-evidence docs must fail closed when the verify-release checkpoint predates any directly rendered current Web QA report; only the verifier-owned pre-checkpoint bootstrap may use the scoped stale-checkpoint override.

## Acceptance

- Every deleted HEAD contract is mapped to a restored checker/module or has a specific recorded removal reason.
- `check:repo` and `check:completion-audit` fail closed for each representative non-UI mutation.
- The production graph has exactly one Web page entry, includes static module Workers, separately gates the Service Worker, and contains no deleted UI roots.
- Browser/accessibility audits inspect only the reachable `src/app` UI while retaining non-UI release contracts.
- No release checkpoint is claimed current until it is generated after the final production-source change.
- A standalone current-evidence check or docs sync cannot combine a stale verify-release checkpoint with newer current Web evidence.

## Current failure map (2026-08-11 Asia/Shanghai)

- Preserve provenance is externally verifiable for the current audit batch: the two independent pre-transform snapshots under the user-provided Temp paths were read directly, their SHA-256 values matched the manifest declarations, and the generator/provenance gate replayed the real files. This evidence is scoped to the current checker snapshots and does not make any external release blocker pass.
- The migration harness has focused embedded-contract tests, but they prove only that the manifest and current checker are internally consistent. They must not be described as preserve-to-current raw-diff or release evidence, and no HEAD/current/temp snapshot may be promoted to fill the missing provenance.
- Current local audits remain conditional: the production graph and current Web behavior checks are green, while the two total audits retain stale-evidence/external blocker failures. No release or checker pass may be inferred from the candidate manifest.
- Checkpoint contract: the single `zerochat.verifyReleaseCheckpoint.v1` format binds the verification source tree plus release diagnostics, release blockers, strict preflight, and directly rendered Web QA by SHA-256. The focused gate runs binding mutations before artifact validation, and reports without the required `inputBinding` fail closed. Generated build caches are excluded, while dotted TypeScript module basenames remain source-reachable.
- Intentionally stale: `.manual-qa/verify-release-current.json` is still the 2026-08-08 v1 diagnostic, has no `inputBinding`, and is not release evidence. Focused checkpoint validation and current-evidence check/write both fail before publishing docs.
- Current total-audit evidence: repository health passes after the disposable live-sync documentation assertion was bound to current machine-readable state; completion audit still fails on current MSIX/hosted-CI/live-sync/live-provider/native diagnostic hashes and generated Requirements/QA freshness mismatches. The old unconditional Gist assertion is gone from both checkers, while these remaining evidence/blocker conflicts are not permission to mark a release pass or rewrite unchecked blockers.
- Runtime evidence still requiring a new background-safe run or external host: Windows WebView, Android runtime artifacts, canonical disposable live-sync release pass, trusted MSIX host, Apple/Linux target runtime, hosted native CI, and Provider full-capability/browser-origin evidence.
- Do not manually rewrite generated evidence docs or rerun the full verifier until the stale runtime-artifact set can be refreshed without activating a user-visible window. A partial diagnostic refresh must not create or bless a checkpoint.

## Current UI audit finding (2026-08-12 Asia/Shanghai)

- Headless Axe initially found four serious Settings contrast violations because the 150ms fixed probe delay could sample the finite Settings fade animation before it settled, blending every foreground color with the dark surface.
- `scripts/axe-accessibility-check.mjs` now waits for running finite animations before each Axe sample; the WCAG rule set is unchanged. `pnpm run check:axe` passes with zero violations across seven first-run, chat, Settings, RTL, compact-data, and reset-action states.
