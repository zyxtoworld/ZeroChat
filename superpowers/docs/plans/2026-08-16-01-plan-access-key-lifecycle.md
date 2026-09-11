# 访问密钥生命周期审计计划

## Goal

证明 `src/services/accessKey.ts` 及其真实生产调用者在并发派生、失败、口令轮换、删除/重建和持久化边界上不会缓存旧凭据、粘住失败或把迟到结果发布回当前状态。

## Why planning is required

访问密钥是敏感状态。任何改动必须由生产可达调用链的确定性旧红态驱动，测试不得输出真实凭据，也不得用静态 marker 替代行为证据。

## Acceptance

- 明确 `accessKey.ts` 是否有缓存/共享 Promise/持久化副作用，以及每个真实 caller 的 owner 边界。
- 先拿到当前实现必失败的 focused 行为测试，才允许修改生产代码。
- 若当前实现无红态，保留生产代码不变，记录 no-red 证据并转下一条 owner。
- 只运行本地 focused、TypeScript、ESLint/diff 检查；不触碰 preserve/provenance、bundle、release 或外部服务。

## Outcomes

1. 真实入口与现有合同映射。
2. 并发/失败/轮换/删除场景的可执行结果。
3. 若必要，最小根修及回归证据；否则明确 no-red 结论。
