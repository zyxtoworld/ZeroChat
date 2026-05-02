# Security Model

ZeroChat 的同步安全目标是：远端同步服务可以保存和传输数据，但不能读懂用户数据。

## 端到端加密

同步前，客户端构造 `sync-vault.v1`：

- 聊天记录
- 用户设置
- 服务商配置
- AI API Key
- Worker 代理访问密钥

然后用用户设置的“同步加密密码/恢复码”在本机加密成 `encrypted-snapshot.v1`。

远端只保存密文。Cloudflare Worker、KV、GitHub Gist 和静态托管服务都不应该看到明文。

## 算法选择

- AES-256-GCM：认证加密，同时提供机密性和完整性校验。
- PBKDF2-HMAC-SHA-256：从用户同步密码派生 256 bit AES key。
- 600,000 次迭代：作为默认成本，后续可按设备性能调优。
- 16 字节 salt：每次加密随机生成。
- 12 字节 IV：每次加密随机生成，避免 GCM IV 重用。
- 128 bit tag：拒绝被篡改的密文。

## 不同步的内容

以下内容不进入 vault：

- GitHub Token
- Cloudflare Worker 同步访问密钥

原因是新设备必须先用它们取到远端密文。它们只能保存在本机安全存储里。

## 平台密钥存储

- Web/PWA：当前使用浏览器本地存储，后续可增加“不保存同步密码”的高安全模式。
- Windows：Windows Credential Locker。
- Android：Android Keystore + EncryptedSharedPreferences。
- iOS/macOS：Keychain。
- Linux：Secret Service。

## 恢复码要求

同步加密密码至少 12 个字符。建议用户使用密码管理器生成更长的随机恢复码。

如果用户忘记恢复码，远端密文无法解密。这是端到端加密的预期结果。
