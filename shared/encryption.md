# ZeroChat Encryption

ZeroChat 同步数据使用端到端加密。Gist、Cloudflare Worker、Cloudflare KV 或其他同步服务器只保存密文。

## 加密对象

同步前先构造 `sync-vault.v1`：

```json
{
  "data": {},
  "secrets": {
    "providerKeys": {}
  }
}
```

其中：

- `data` 是普通应用数据，格式见 `snapshot.schema.json`。
- `secrets.providerKeys` 是各 AI 服务商 API Key。

`GitHub Token` 和 `Cloudflare Worker 同步访问密钥` 不进入加密包，因为新设备必须先用它们取到远端密文。

## 算法

- KDF：PBKDF2-HMAC-SHA-256
- 迭代次数：600,000
- Salt：16 字节随机数
- Cipher：AES-256-GCM
- IV：12 字节随机数，每次加密重新生成
- Tag：128 bit
- AAD：`zerochat:vault:v1:<updatedAt>`

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

## 用户体验

用户只需要在 ZeroChat 里设置一个“同步加密密码/恢复码”。程序负责：

1. 从密码派生加密密钥。
2. 加密聊天、设置、服务商配置和 AI API Key。
3. 上传密文。
4. 在新设备上输入同一个密码后自动解密。

不要让用户安装额外加密工具。
