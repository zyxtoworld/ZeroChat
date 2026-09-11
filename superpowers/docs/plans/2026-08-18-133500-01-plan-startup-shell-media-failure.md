# 启动壳宿主媒体查询失败隔离

**目标：** 确保首屏启动壳在宿主 `matchMedia` 同步异常时仍能完成可见加载壳初始化，并把异常限制在媒体偏好读取边界。
**需要计划的原因：** 这是生产启动路径的安全/可用性边界，错误可能阻断 React 首次挂载。
**验收：** 真实 `applyStartupShell` caller 在 `matchMedia` 缺失、抛错和正常返回三种宿主状态下都不泄漏异常；语言、方向和加载文案仍按现有合同设置。

### 结果 1：建立可执行红测
- 工作：在 `startupShell` 的真实公开函数测试中让浏览器媒体查询同步抛错，断言启动壳仍返回 locale、更新 loading 文案，不让异常越过边界。
- 风险/开放问题：只隔离媒体偏好读取；语言解析和 DOM 写入错误不在本次范围。
- 验证：`pnpm exec vitest run src/app/__tests__/startupShell.test.ts`

### 结果 2：最小生产修复并复核启动接线
- 工作：让 `browserPrefersDark` 对同步宿主异常 fail closed 为浅色，不改变显式 `prefersDark` 选项和 bootstrap 调用顺序。
- 验证：启动壳 focused、相关 TypeScript/ESLint、`git diff --check`。

### 结果 3：审计本轮边界
- 工作：确认只新增该行为所需测试/实现/计划，不改变 release/provenance、preserve 快照或外部 blocker。
- 验证：读取 preserve SHA256、发布摘要 `releaseEvidence`，并复核最终 diff。
