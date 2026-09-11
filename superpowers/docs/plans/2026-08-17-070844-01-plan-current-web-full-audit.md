# 当前 Web 全量需求审计

**Goal:** 按 `docs/REQUIREMENTS.md` 的当前 Web 权威入口完成前端行为、可访问性、安全、持久化与生命周期审计，并以可重复证据交付可用的当前实现。

**Why planning is required:** 任务包含删除旧实现、跨模块行为修改、全平台验证和潜在外部服务测试，涉及不可逆文件状态、用户数据边界与发布证据边界。

**Acceptance:** 当前生产入口只使用 `src/app/**` 及真实可达共享模块；每个现行需求条目都有源码、行为测试或无窗口运行证据；缺陷必须由真实 caller 的 deterministic red test 证明后再修；不把旧代码、临时快照、未签名产物、外部服务或用户凭据当作完成证据。

### Outcome 1: Establish the current implementation boundary

- Work: Read the current requirements, production entry graph, package scripts, existing QA contracts, and worktree state. Classify old frontend paths as removable only when the production graph and tests prove they are unreachable.
- Risks/open questions: The worktree is already heavily modified. Preserve all user changes and never use `HEAD`, reset, checkout, or broad cleanup as a recovery mechanism.
- Verify: `pnpm exec vitest run scripts/__tests__/frontend-single-implementation.test.mjs scripts/__tests__/web-production-reachability.test.mjs`

### Outcome 2: Build a requirement-to-evidence matrix

- Work: Map the current requirements for onboarding, settings/data, provider/model, sync, generation, messages, accessibility, security, persistence, and release boundaries to current source files and executable checks. Record missing or indirect evidence without converting historical markers into current proof.
- Risks/open questions: Preserve source provenance and external/native release evidence may remain unavailable; those blockers stay fail-closed and are reported separately from local Web correctness.
- Verify: Relevant current source contracts, `pnpm run check:web-production-reachability`, and focused behavior suites selected from the matrix.

### Outcome 3: Repair only proven production defects

- Work: For each high-risk gap, construct a real Store/service/component caller red test with deferred barriers or deterministic DOM state. Apply the smallest root-cause fix, preserve owner/revision/tombstone semantics, and add a regression test at the production boundary.
- Risks/open questions: Do not use a provided API key in source, fixtures, logs, artifacts, or responses. Any external API test must be explicitly isolated, headless, bounded, and never used as a substitute for deterministic local evidence; stop immediately on unexpected data or cost behavior.
- Verify: Focused red-to-green tests, adjacent tests, ESLint, TypeScript, and `git diff --check` for each change.

### Outcome 4: Validate the current Web experience without visible windows

- Work: Run the current Web shell, accessibility, visual geometry, security, service-worker, bundle, and headless browser checks. Inspect generated screenshots/artifacts only when the check itself is authorized and does not launch a visible desktop host.
- Risks/open questions: Do not run Windows WebView/`ZeroChat.exe`, emulator, signed-host, deployment, or external-provider drills unless separately authorized and safe. Keep the existing 96 KiB bundle blocker and release/provenance blockers unchanged.
- Verify: `pnpm run check:unit`, `pnpm run check:ui`, `pnpm run audit:visual`, `pnpm run check:browser-smoke`, `pnpm run build`, and the applicable current Web shell contracts, with exact exit codes recorded.

### Outcome 5: Review and hand off with explicit residual risk

- Work: Review the final diff including untracked current-app files, confirm no temporary diagnostics or secrets remain, separate this turn's changes from pre-existing user changes, and report every unmet requirement or unavailable platform evidence.
- Risks/open questions: Do not declare release completion while preserve provenance, external/native runtime, trusted-host, or bundle blockers remain unresolved. Do not delete a legacy path until a current production graph and negative fixture prove it is unreachable.
- Verify: `git status --short --untracked-files=all`, targeted source scans, `git diff --check`, and the final evidence matrix.
