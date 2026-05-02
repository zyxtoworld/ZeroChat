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

远端只保存密文。Cloudflare Worker、KV、R2、GitHub Gist 和静态托管服务都不应该看到明文。

Cloudflare 推荐使用增量同步：

- KV 保存 `incremental-head`，里面只有最新 manifest 对象名和 `updatedAt`。
- R2 保存 `zerochat.encryptedObject` 格式的加密 manifest 和加密消息分块。
- manifest 解密后才知道每个会话有哪些 chunk，Worker 和 R2 只能看到随机对象名。
- 客户端会复用未变化分块，并在新 head 写入成功后清理旧 manifest 和旧 chunk。

## 算法选择

- AES-256-GCM：认证加密，同时提供机密性和完整性校验。
- PBKDF2-HMAC-SHA-256：从用户同步密码派生 256 bit AES key。
- 600,000 次迭代：当前协议固定值；客户端会拒绝过低或异常过高的迭代次数。
- 16 字节 salt：每次加密随机生成。
- 12 字节 IV：每次加密随机生成，避免 GCM IV 重用。
- 128 bit tag：拒绝被篡改的密文。
- AAD 绑定 `updatedAt`，客户端和 Worker 都会拒绝 AAD 不匹配的快照。

## 本机落盘加密

Web/PWA 会用 Web Crypto 生成本机 AES-GCM 密钥，并以不可导出的 `CryptoKey` 形式保存到 IndexedDB。聊天数据、设置和本机密钥记录写入浏览器存储前都会加密；旧版明文 `localStorage` 密钥会在读取时迁移为加密记录并删除。

同步加密密码只放在 `sessionStorage`，刷新页面后仍可使用，关闭标签页后需要重新输入。这样避免把恢复码长期明文保存在浏览器配置里。

浏览器端无法完全防住同源 XSS，因为恶意脚本一旦在同一 Origin 执行，就能调用应用自己的解密流程。因此应用不使用 `dangerouslySetInnerHTML`，并且 Worker 和客户端会拒绝不安全的 HTTP、localhost、内网、局域网和带凭据的 AI 端点。ZeroChat 不内置本地 AI 服务商。

## 危险操作提示

Web/PWA 对删除聊天记录、删除整个对话、删除服务商、导入覆盖和重置本机数据使用统一确认框。删除类操作会明确提示：如果已开启即时自动同步，云端加密数据也会删除对应记录。用户确认并勾选“不再提醒”后，偏好会写入 `preferences.dismissedDangerWarnings`，跟随端到端加密同步。

## 不同步的内容

以下内容不进入 vault：

- GitHub Token
- Cloudflare Worker 同步访问密钥

原因是新设备必须先用它们取到远端密文。它们只能保存在本机安全存储里。

## 平台密钥存储

- Web/PWA：IndexedDB 加密记录 + 不可导出 Web Crypto 本机密钥；同步密码仅会话保存。
- Windows：Windows Credential Locker。
- Android：Android Keystore + EncryptedSharedPreferences。
- iOS/macOS：Keychain。
- Linux：Secret Service。

## Worker 安全边界

- `/snapshot` 只接受 `encrypted-snapshot.v1`，拒绝明文 snapshot。
- `/snapshot` 会拒绝旧 `updatedAt` 覆盖较新的已存快照。
- `/sync/head` 只保存增量 manifest 指针，并拒绝旧 head 覆盖新 head。
- `/sync/object/<key>` 只接受 `zerochat.encryptedObject`，并校验 KDF、AAD、salt、iv、payload。
- `/proxy` 必须提供 `PROXY_TOKEN`，并且上游地址必须是 HTTPS。
- `/proxy` 会拒绝 localhost、内网、局域网和带用户名密码的上游地址，避免把代理变成内网请求通道。
- `ALLOWED_HOSTS` 是必填白名单，只允许代理到明确列出的 AI API 域名。
- `ALLOWED_ORIGINS` 可选；配置后浏览器跨源请求只允许来自指定页面。

## 恢复码要求

同步加密密码至少 12 个字符。建议用户使用密码管理器生成更长的随机恢复码。

如果用户忘记恢复码，远端密文无法解密。这是端到端加密的预期结果。
