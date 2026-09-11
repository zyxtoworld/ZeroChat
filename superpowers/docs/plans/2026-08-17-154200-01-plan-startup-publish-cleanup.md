# 启动发布后 Skill 清理边界

**Goal:** 验证并在必要时修正当前 `src/app/store.ts` 启动 hydration 中 AppData 发布成功后 Skill 引用清理失败的状态语义。
**Why planning is required:** 该路径跨越启动状态、IndexedDB 持久化和可重试清理，错误处理会影响用户数据可用性。
**Acceptance:** 真实 Store caller 的 focused 行为测试证明发布成功与清理失败的状态合同；若旧代码失败，修复后保留引用重试能力且不回滚已发布 AppData；不改变 release/provenance/bundle 证据。

### Outcome 1: 旧红与根因
- Work: 通过源码和真实 `init()` 测试核对主发布失败与发布后清理失败；`cleanupPendingSkillContentRefs()` 已在自身边界收容删除失败并保留 pending，未形成旧红。
- Verify: `pnpm exec vitest run src/app/__tests__/store.test.ts -t startup`（17/17）。

### Outcome 2: 最小生产修复
- Work: 无生产修复；当前行为已满足该候选边界，避免重复施工。
- Verify: 启动 focused 17/17；Windows 托盘/WebView 静态生命周期合同 10/10。

### Outcome 3: 影响面验收
- Work: 检查当前 diff、生产入口和无敏感错误日志；不修改 preserve snapshots、migration manifest 或 release evidence。
- Verify: `pnpm exec tsc -p tsconfig.app.json --noEmit --pretty false`、定向 ESLint、`git diff --check`。
