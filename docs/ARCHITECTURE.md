# ZeroChat 原生优先架构

ZeroChat 采用“各平台原生 UI + 共享数据协议”的结构。

## 平台技术栈

| 平台 | 语言 | UI / 系统框架 | 本地数据 | 密钥存储 |
| --- | --- | --- | --- | --- |
| Web/PWA | TypeScript | React | IndexedDB | localStorage |
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
- `shared/sync-api.openapi.yaml`
- `shared/ai-provider-contract.md`
- `cloudflare/sync-worker.js`

所有端导入、导出、同步时必须兼容 snapshot v1。

## 同步冲突策略

首版采用个人应用最可靠的策略：

1. 本地和远端都带 `updatedAt`。
2. 同步时先读取远端。
3. 如果远端 `updatedAt` 更新，采用远端 snapshot。
4. 否则上传本地 snapshot。
5. 密钥永远不进 snapshot，只留在本机。

后续如果需要多人协作或频繁多端离线编辑，再把对话消息升级为按消息级别合并。

## AI 请求策略

原生端优先直连 AI 厂商接口。只有 Web 或特殊网络环境遇到 CORS/代理需求时，才填写 `proxyUrl` 走自己的 Cloudflare Worker。
