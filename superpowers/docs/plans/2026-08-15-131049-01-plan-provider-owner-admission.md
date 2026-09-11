# Provider owner admission boundary

**Goal:** 让会改变 Provider 网络语义的设置动作只在真实持久化准入成功后失效旧异步 owner。
**Why planning is required:** 这是生产状态、异步所有权与持久化交错的高风险修复。
**Acceptance:** 被 replacement/mutation gate 拒绝的动作不取消现有 Provider 检查；成功提交后才失效受影响 owner/result；name-only 展示编辑继续保持不取消；现有 endpoint/type/key/replacement 合同不回退。

### Outcome 1: Capture the regression
- Work: 用当前 Store 的真实 Provider check owner、replacement lease 与 `setSyncMode` caller 构造确定性交错，证明拒绝动作会取消旧检查。
- Risks/open questions: 不扩大到外部 Provider；只使用 deferred 本地 mock。
- Verify: `D:\Node.js\pnpm.CMD exec vitest run src/app/__tests__/store.test.ts -t "sync mode.*replacement|Provider check"`

### Outcome 2: Move invalidation to the accepted commit
- Work: 删除准入前的预测失效，提交成功后基于实际新 AppData 计算受影响 Provider 并失效 owner/结果；保留 name-only no-op 语义。
- Verify: focused Store/provider tests、TypeScript、ESLint。

### Outcome 3: Recheck adjacent contracts
- Work: 检查 endpoint/type/key/same-id replacement 的既有行为，确认没有旧结果写回或误清新 owner。
- Verify: Store/provider service tests、production build；保留 release/provenance blocker。
