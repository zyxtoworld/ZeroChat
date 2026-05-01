# ZeroChat Shared Contract

这个目录只放跨平台共享约定，不放 UI 代码。

- `snapshot.schema.json`：所有端必须读写的数据格式。
- `examples/snapshot.v1.json`：最小可用样例。
- `sync-api.openapi.yaml`：同步服务 HTTP 协议。
- `ai-provider-contract.md`：AI 服务商请求约定。

各平台可以用自己的语言和本地数据库，但导入、导出、同步时必须兼容这里的 snapshot v1。
