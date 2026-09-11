# Strict Preflight Timeout Ownership

**Goal:** Give the strict release preflight freshness check an explicit, bounded timeout contract derived from its child phases so normal `verify:release` does not misclassify a near-300-second legal diagnostic run as a hung check.
**Why planning is required:** This changes release-gate process ownership and failure cleanup across multiple scripts.
**Acceptance:** The strict aggregate uses a dedicated phase-derived budget, each strict child is independently bounded and tree-cleaned, ordinary checks retain the generic timeout, fake-child tests prove success/timeout/exactly-once settlement, and one official `verify:release` produces current fail-closed evidence with cleanup.

### Outcome 1: Establish the timeout contract
- Work: Add the existing preflight policy module's phase budgets and aggregate calculation; keep the generic `300000 ms` timeout unchanged for unrelated checks.
- Risks/open questions: The budget must remain finite and large enough for the measured source refresh and strict gate without becoming an unbounded release wait.
- Verify: Focused preflight policy and check-order tests.

### Outcome 2: Enforce child and aggregate ownership
- Work: Make strict reporter child execution timeout-aware with injected spawn/cleanup seams, wait for process-tree cleanup before settling, and make `verify-release` select the dedicated budget only for the strict freshness label.
- Risks/open questions: Cleanup failure must fail closed and must never permit a later stage to run as if the timed-out child completed.
- Verify: Deterministic fake-child success, timeout, late-close, and single-settlement tests; syntax check.

### Outcome 3: Re-run the official gate
- Work: Run the focused tests, then one unbypassed `pnpm run verify:release` with the existing external preserve declaration; inspect current checkpoint/input binding, diagnostic status, releaseEvidence, and owned-process cleanup.
- Risks/open questions: External evidence blockers are expected to remain; they must remain explicit rather than being bypassed or rewritten.
- Verify: Exact command exit codes, current report metadata, and zero owned runner/profile residue.
