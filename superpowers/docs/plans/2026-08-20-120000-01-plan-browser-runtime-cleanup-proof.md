# ZeroChat browser runtime cleanup proof

**Goal:** 修复浏览器测试运行时在 POSIX 未建立独立进程组时的泄漏，并让 Windows 清理只有在原 child 与 exact profile 归属证据齐全时才能恢复。
**Why planning is required:** 任务涉及跨平台进程终止、测试临时目录删除和高风险外部状态验证。
**Acceptance:** 所有共享进程树清理的 POSIX spawn 显式建立独立进程组；未 detached/无组证据时 helper fail-closed 且不静默成功；Windows settle 仅接受原 child 已退出并由 exact profile sweep 证明无 owned process 的恢复；focused、settings smoke、local cleanup、完整 `verify:web-local`、证据同步与用户视角验收均有真实结果。

### Outcome 1: 建立并验证跨平台清理契约
- Work: 审计 `stopChildProcessTree` 的全部调用者与 spawn 选项；新增真实非-detached POSIX 回归测试和 Windows 双证据 settle 测试。
- Risks/open questions: 仅允许本轮 ZeroChat 测试进程、唯一 profile、记录 PID/CDP 端口和对应 OS temp 目录；任何普通浏览器或其他项目对象均不得触碰。
- Verify: `pnpm exec vitest run scripts/__tests__/browser-runtime-cleanup.test.mjs`

### Outcome 2: 修复 helper 与调用者
- Work: 为需要树清理的 POSIX spawn 设置 `detached:true`；helper 对无独立组证据 fail-closed；Windows settle 接收并验证 child-exit/profile-sweep 证据，聚合 cleanup 错误并继续执行后续 cleanup。
- Verify: `pnpm exec vitest run scripts/__tests__/browser-runtime-cleanup.test.mjs scripts/__tests__/repository-health-current-orchestration-contracts.test.mjs`

### Outcome 3: 运行浏览器与本地清理验证
- Work: 运行 settings overlay smoke 和 local cleanup，清理仅由 exact ZeroChat profile/PID/CDP 证明归属的测试资源。
- Verify: `pnpm run check:settings-overlay-preload-smoke`；`pnpm run check:local-runtime-cleanup`

### Outcome 4: 完成发布证据链
- Work: 使用唯一日志运行完整 `verify:web-local`；成功后运行官方 `sync:current-evidence`，刷新并检查 current evidence、completion audit、repository health。
- Verify: `pnpm run verify:web-local`；`pnpm run sync:current-evidence`；`pnpm run check:current-evidence`；`pnpm run check:completion-audit`；`pnpm run check:repo`

### Outcome 5: 用户视角验收与边界报告
- Work: 对本地 settings overlay/浏览器 smoke 做用户视角检查，记录真实外部阻塞（Apple/Linux/elevated MSIX/live provider/hosted CI 等）而不虚报。
- Verify: 复核 smoke 日志、截图/报告和 OS temp 资源清单；确认无 ZeroChat 测试 profile 残留。

### Outcome 6: 修复 release checkpoint 编排的自失效顺序
- Work: 让依赖 `.manual-qa/verify-release-current.json` 的 Repository health 只读取当前 source-bound checkpoint；release 初始检查不得消费旧 checkpoint，最终检查仍必须验证刷新后的完整 checkpoint。保留真实外部 blocker，不用无改动重跑掩盖顺序错误。
- Risks/open questions: 回归必须覆盖“旧 checkpoint + 合法源变更”场景；若外部平台证据缺失，只能准确报告对应 blocker，不能把它降级为编排通过。
- Verify: `pnpm exec vitest run scripts/__tests__/verify-release-check-order.test.mjs scripts/__tests__/verify-release-checkpoint-binding.test.mjs`; 最终只以修复后的 `pnpm run verify:release` 真实退出与 failedStep 判定。

### Outcome 7: 收敛项目外生成物与 worktree 到项目内本地目录
- Work: 先只读盘点项目根外可确认归属的 archive、worktree、verify/log/artifact、临时脚本和项目专用材料；复用或建立精确忽略的 `.local/codex/{artifacts,archives,worktrees,logs,private,recovery}`。注册 worktree 只能用 Git worktree 支持的迁移/收口方式，保留脏状态与分支引用；普通产物逐项可恢复迁移，不复制留双份，并更新引用后复核。
- Risks/open questions: 不触碰 Codex state/thread history/rollout/automation、系统配置、Git 全局配置、浏览器资料、用户原有文件、共享服务数据或归属不明凭据；任何被进程使用或含独有改动的路径先停止迁移并保留原状。迁移失败即停止该项并保留证据。
- Verify: `git worktree list --porcelain`; `git check-ignore -v .local/codex/...`; `git status --short`; 精确源/目标存在性、内容/HEAD/dirty/引用核对；复查 `E:\项目`、`%USERPROFILE%`、`%LOCALAPPDATA%\Temp` 中不再有可确认的 ZeroChat 项目残留。
