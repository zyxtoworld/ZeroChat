# ZeroChat 当前产品审计与交付验证

**Goal:** 以 `docs/REQUIREMENTS.md` 为权威，验证并改进当前 `src/app` 前端及跨平台交付，同时保留真实未满足的外部证据边界。
**Why planning is required:** 任务跨越生产入口、删除旧实现、用户数据生命周期、视觉/可访问性、跨平台构建和外部凭据；误删或误报通过都会造成不可逆或错误交付。
**Acceptance:** 当前生产图只包含现行实现；真实 caller 的需求行为有可执行证据；发现的确定性缺陷完成红测→最小根修→回归；本地可执行的平台门禁与视觉检查有真实退出码；外部/签名/设备证据单独保持 fail-closed；秘密不进入文件、日志、报告或提交。

### Outcome 1: 建立当前状态与需求基线
- Work: 读取现行入口、生产可达图、`docs/REQUIREMENTS.md`、发布/QA 规则和完整脏工作树；区分用户既有改动、当前前端删除范围、旧历史证据与现行合同。
- Risks/open questions: 旧目录的删除是否完整必须以 production reachability 和构建产物证明，不能按文件名猜测；现有跨平台改动不能被本轮 Web 修复覆盖。
- Verify: `git status --short`, `node scripts/web-production-reachability.mjs`, `node scripts/frontend-single-implementation-check.mjs --production-artifacts`

### Outcome 2: 验证现行 Web 行为并修复确定性缺陷
- Work: 按需求逐项检查 Chat、Composer、Settings、Provider、Sync、Data、Skill、Onboarding、Markdown、安全和错误呈现的真实 `src/app` caller；先用窄行为测试或 headless DOM/geometry 复现，再做最小根修；不得为绿灯放宽安全、尺寸或 bundle 合同。
- Risks/open questions: 视觉检查必须使用生产构建和无前台浏览器；API key 只允许通过临时进程环境传递，不能写入源码、报告、截图或命令记录。
- Verify: 受影响 Vitest/Node contract、`tsc --noEmit`、ESLint、`pnpm run qa:web-current`、`pnpm run check:bundle`、`pnpm run check:ui`

### Outcome 3: 评估旧实现删除与跨平台一致性
- Work: 仅删除被 production graph、构建、测试和文档现行合同共同证明不可达的旧 Web 文件；核对 Android/Apple/Linux/Windows/Cloudflare 当前 caller 与合同，不把无法运行的设备/签名/外部服务证据伪装为通过。
- Risks/open questions: native toolchain、签名证书、模拟器、可信宿主和 live Provider 可能不可用；任何删除前必须可恢复且先完成精确引用盘点。
- Verify: `pnpm run check:native-parity`, 各平台可用的 contract/build checks、`pnpm run check:repo`、`git diff --check`

### Outcome 4: 完成发布前证据审计
- Work: 汇总 release blocker、`releaseEvidence`、provenance、bundle、秘密扫描和当前 QA 产物；只在所有适用本地门禁真实通过后考虑交付动作，外部证据保持原状态。
- Risks/open questions: 不修改 preserve 快照、manifest/hash/checkpoint 来制造绿色；不启动可见 Windows WebView/ZeroChat.exe，不提交或推送，除非用户在后续明确授权且交付门满足。
- Verify: `node scripts/release-blocker-report.mjs --check`, `node scripts/release-diagnostics-refresh.mjs --check`, `node scripts/repository-health-check.mjs`, preserve SHA256 只读核对
