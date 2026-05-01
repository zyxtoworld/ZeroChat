# ZeroChat Shared Contract

这个目录只放跨平台共享约定，不放 UI 代码。

- `snapshot.schema.json`：所有端必须读写的数据格式。
- `sync-vault.schema.json`：进入加密包的完整同步数据，包括 AI API Key。
- `encrypted-snapshot.schema.json`：远端实际保存的密文信封。
- `examples/snapshot.v1.json`：最小可用样例。
- `sync-api.openapi.yaml`：同步服务 HTTP 协议。
- `encryption.md`：端到端加密方案。
- `ai-provider-contract.md`：AI 服务商请求约定。

各平台可以用自己的语言和本地数据库，但同步时必须上传 `encrypted-snapshot.v1`，不能上传明文 snapshot。
