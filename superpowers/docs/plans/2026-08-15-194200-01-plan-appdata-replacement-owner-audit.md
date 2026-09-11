# AppData 替换所有权审计

**目标：** 证明当前生产 `src/app/store.ts` 的导入、重置与恢复边界不会让旧的异步预处理、密钥写入或本地保存覆盖更新后的 AppData。
**为什么需要计划：** 这是跨 AppData、Provider secrets、同步口令与页面生命周期的生产数据一致性修改。
**验收：** 只修有确定性红态的真实 caller；校验失败不改变当前数据/密钥/运行时；更新请求不会被旧预处理覆盖；失败提交释放 owner 且保留可重试状态；不修改 release/provenance，不启动可见窗口。

### 结果 1：导入/重置预处理所有权
- 工作：审计并覆盖慢解密、重复导入、导入与重置交错，以及新请求后的旧通知/状态写回。
- 验证：`D:\Node.js\pnpm.CMD exec vitest run src/app/__tests__/store.test.ts -t import`、`... -t reset`

### 结果 2：Provider secret 与 durable AppData 交接
- 工作：只在真实 provider-key/passphrase caller 产生红态时修复，确认失败不清理旧快照且后续请求可继续。
- 验证：受影响 Store focused tests、`D:\Node.js\pnpm.CMD exec eslint src/app/store.ts src/app/__tests__/store.test.ts`、TypeScript build。

### 结果 3：页面生命周期与发布产物
- 工作：核对 pagehide/visibility flush 与 replacement owner 的迟到写回，清除临时诊断；不触碰用户进程和外部证据。
- 验证：`D:\Node.js\pnpm.CMD run build`、`D:\Node.js\pnpm.CMD run check:bundle`、`git diff --check`；release/provenance 保持 fail-closed。
