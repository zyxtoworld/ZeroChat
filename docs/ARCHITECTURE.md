# ZeroChat 原生优先架构

ZeroChat 采用“各平台原生 UI + 共享数据协议”的结构。

## 平台技术栈

| 平台 | 语言 | UI / 系统框架 | 本地数据 | 密钥存储 |
| --- | --- | --- | --- | --- |
| Web/PWA | TypeScript | React | IndexedDB 加密记录 | Web Crypto 不可导出密钥 |
| Windows | C++ | WinUI 3 / C++/WinRT | SQLite 或 LocalFolder JSON | Windows Credential Locker |
| Android | Kotlin | Jetpack Compose | Room | Android Keystore + EncryptedSharedPreferences |
| iOS | Swift | SwiftUI | SwiftData 或 SQLite | Keychain |
| macOS | Swift | SwiftUI / AppKit interop | SwiftData 或 SQLite | Keychain |
| Linux | Rust | GTK4 / libadwaita | SQLite | Secret Service |

## 为什么不再用一个 Web 壳包所有平台

Web/PWA 仍然保留，因为浏览器和 Cloudflare Pages 是最省力的使用方式。但桌面和手机 App 不再以 Tauri/Capacitor 作为主路线：

- Windows 用 WinUI 3，系统通知、窗口、凭据和安装体验更贴近 Windows。
- Android 用 Kotlin/Compose，列表、输入法、后台限制和系统分享更自然。
- iOS/macOS 用 SwiftUI，Keychain、文件、窗口、多设备体验最稳。
- Linux 用 Rust/GTK4，启动快、内存低、桌面环境集成直接。

## 共享边界

共享的不是 UI 代码，而是：

- `shared/snapshot.schema.json`
- `shared/sync-vault.schema.json`
- `shared/encrypted-snapshot.schema.json`
- `shared/encrypted-object.schema.json`
- `shared/encryption.md`
- `shared/sync-api.openapi.yaml`
- `shared/ai-provider-contract.md`
- `cloudflare/sync-worker.js`

所有端本地可以使用自己的数据库。Gist 同步和 Cloudflare 兜底模式使用完整 `sync-vault.v1`，加密成 `encrypted-snapshot.v1`。Cloudflare 推荐模式使用增量同步：KV 保存最新 manifest 指针，R2 保存加密 manifest 和加密消息分块。远端不能保存明文 snapshot、manifest 或 chunk。

## 隐私和安全

同步采用端到端加密：

1. 用户在 ZeroChat 内设置同步加密密码。
2. 客户端用 PBKDF2-HMAC-SHA-256 派生 AES-256-GCM 密钥。
3. 聊天、服务商设置、普通设置和 AI API Key 组成 vault。
4. vault 在本机加密后上传。
5. Gist、Cloudflare Worker、KV 和服务器都只能看到密文。

GitHub Token 和 Cloudflare Worker 同步访问密钥不进入 vault，因为新设备必须先用它们获取远端密文。
Web/PWA 本机落盘数据也会用浏览器内的不可导出 AES-GCM 密钥加密，降低浏览器配置文件或 IndexedDB 被直接读取时的泄露风险。

## 同步冲突策略

首版采用个人应用最可靠的策略：

1. 本地和远端都带 `updatedAt`。
2. 同步时先读取远端。
3. 如果远端 `updatedAt` 更新，采用远端数据。
4. 新设备没有本地用户内容时，即使本机默认数据时间较新，也优先采用远端，避免首次同步覆盖云端。
5. 否则上传本地数据。
6. Cloudflare 增量同步只上传新增或改变过的消息分块，并复用远端未变化分块。当前实现每 60 条消息一个分块，但未满 60 条的最后一个分块也会立即上传，60 只是节省空间和流量的存储粒度。
7. Worker 会拒绝旧快照或旧 head 覆盖较新的已存数据。
8. AI API Key 只进入加密 vault 或加密 manifest，不进入明文远端数据。

Web/PWA 的即时同步策略是：发送消息后立刻排队上传当前会话状态；AI 回复完成、停止或失败后再上传最终状态；编辑或删除已完成消息、重新生成 AI 回复后，也会立即上传新的分块和 manifest。普通设置改动使用短延迟合并。其他设备切回前台、恢复网络和保持前台时做只读拉取，只有检测到本机有未同步改动时才会写远端。

如果后续需要多人协作或频繁多端离线编辑，再把对话消息升级为按消息级别合并。个人使用优先保证同步速度、空间节省和可恢复性。

## AI 请求策略

原生端优先直连 AI 厂商接口。只有 Web 或特殊网络环境遇到 CORS/代理需求时，才填写 `proxyUrl` 走自己的 Cloudflare Worker。
