# ZeroChat Encryption

ZeroChat 同步数据使用端到端加密。Gist、Cloudflare Worker、Cloudflare KV 或其他同步服务器只保存密文。

## 加密对象

同步前先构造 `sync-vault.v1`：

```json
{
  "data": {},
  "secrets": {
    "providerKeys": {},
    "providerProxyTokens": {}
  }
}
```

其中：

- `data` 是普通应用数据，格式见 `snapshot.schema.json`。
- `secrets.providerKeys` 是各 AI 服务商 API Key。
- `secrets.providerProxyTokens` 是各服务商的 Worker 代理访问密钥。

`GitHub Token` 和 `Cloudflare Worker 同步访问密钥` 不进入加密包，因为新设备必须先用它们取到远端密文。

## 算法

- KDF：PBKDF2-HMAC-SHA-256
- 迭代次数：600,000
- Salt：16 字节随机数
- Cipher：AES-256-GCM
- IV：12 字节随机数，每次加密重新生成
- Tag：128 bit
- AAD：`zerochat:vault:v1:<updatedAt>`

客户端必须验证：

- `kind` 是 `zerochat.encryptedSnapshot`，`version` 是 `1`。
- `iterations` 是 `600000`，或者在明确协议升级后按新版本处理。
- `salt` 解码后是 16 字节，`iv` 解码后是 12 字节。
- `aad` 解码后必须等于 `zerochat:vault:v1:<updatedAt>`。
- 解密后的 `vault.data.updatedAt` 必须等于信封的 `updatedAt`。

## 远端格式

远端保存 `encrypted-snapshot.v1`：

```json
{
  "kind": "zerochat.encryptedSnapshot",
  "version": 1,
  "encryptedAt": 1760000002000,
  "updatedAt": 1760000001000,
  "crypto": {
    "cipher": "AES-256-GCM",
    "kdf": "PBKDF2-SHA256",
    "iterations": 600000,
    "salt": "...",
    "iv": "...",
    "aad": "..."
  },
  "payload": "..."
}
```

## Cloudflare 增量同步

Cloudflare 推荐使用增量对象，不再每次上传完整 snapshot。

KV 只保存当前 head：

```json
{
  "kind": "zerochat.incrementalHead",
  "version": 1,
  "manifestKey": "manifest-<uuid>.json",
  "updatedAt": 1760000001000
}
```

R2 保存两类 `zerochat.encryptedObject`：

- `manifest-<uuid>.json`：加密 manifest，包含普通设置、服务商配置、密钥、会话元数据和 chunk 引用。
- `chunk-<uuid>.json`：加密消息分块，当前 Web/PWA 每 60 条消息一个 chunk。

增量对象使用：

- AAD：`zerochat:object:v1:<objectType>:<updatedAt>`
- 压缩：优先 `gzip`，浏览器不支持时退回 `none`
- KDF、salt、iv、cipher、tag 与完整快照一致

客户端同步时会先解密远端 manifest，按 chunk fingerprint 复用未变化分块，只上传新增或改变过的分块。新 head 写入成功后，客户端会请求 Worker 删除旧 manifest 和不再引用的旧 chunk，节省 R2 免费空间。

## 用户体验

用户只需要在 ZeroChat 里设置一个“同步加密密码/恢复码”。程序负责：

1. 从密码派生加密密钥。
2. 加密聊天、设置、服务商配置、AI API Key 和代理访问密钥。
3. 上传密文。
4. 在新设备上输入同一个密码后自动解密。

不要让用户安装额外加密工具。
