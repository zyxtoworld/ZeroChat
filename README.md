# ZeroChat

ZeroChat 是一个原生优先的轻量 AI 聊天工具。目标是浏览器、Windows、Android、iOS、macOS、Linux 都能用，并且数据可以通过免费工具同步。

## 当前路线

按平台使用更适合该平台的语言和框架：

| 平台 | 语言 | 框架 | 目录 |
| --- | --- | --- | --- |
| Web/PWA | TypeScript | React | `src/` |
| Windows | C++ | WinUI 3 / C++/WinRT | `apps/windows/` |
| Android | Kotlin | Jetpack Compose | `apps/android/` |
| iOS/macOS | Swift | SwiftUI | `apps/apple/` |
| Linux | Rust | GTK4 / libadwaita | `apps/linux/` |
| 同步后端 | JavaScript | Cloudflare Worker + KV | `cloudflare/` |

Web/PWA 仍然保留，因为它部署最省力，也适合 Cloudflare Pages。桌面和手机 App 不再依赖 Web 壳作为主路线。

## 已有内容

- Web/PWA 首版可运行。
- Cloudflare Worker 同步和 AI 代理。
- GitHub Gist 同步。
- 共享 snapshot v1 数据格式。
- Windows C++/WinUI 3 原生骨架。
- Android Kotlin/Compose 原生骨架。
- iOS/macOS SwiftUI 原生骨架。
- Linux Rust/GTK4 原生骨架。
- 中文配置、同步、打包说明。

## Web/PWA 本地运行

```bash
npm install
npm run dev
```

构建：

```bash
npm run build
```

`dist/` 可以部署到 Cloudflare Pages、Netlify、Vercel、GitHub Pages 或任意静态服务器。

## 原生端

### Windows

目录：`apps/windows/`

使用 C++/WinUI 3。用 Visual Studio 创建 WinUI 3 C++ 项目后，把 `apps/windows/ZeroChat/` 下的源文件加入工程。

推荐打包：MSIX。

### Android

目录：`apps/android/`

使用 Kotlin + Jetpack Compose。用 Android Studio 打开该目录，配置 JDK/SDK 后运行或打包 APK/AAB。

推荐密钥存储：Android Keystore + EncryptedSharedPreferences。

### iOS/macOS

目录：`apps/apple/`

使用 Swift + SwiftUI。用 Xcode 创建 Multiplatform App 后，把 `Sources/ZeroChatCore/` 和 `App/` 下的代码加入工程。

推荐密钥存储：Keychain。iOS 真机运行和上架必须使用 macOS + Xcode。

### Linux

目录：`apps/linux/`

使用 Rust + GTK4/libadwaita。安装 GTK4/libadwaita 开发包后：

```bash
cargo run
cargo build --release
```

推荐分发：Flatpak，另提供 AppImage。

## 加密同步

共享数据格式见：

- `shared/snapshot.schema.json`
- `shared/sync-vault.schema.json`
- `shared/encrypted-snapshot.schema.json`
- `shared/examples/snapshot.v1.json`
- `shared/sync-api.openapi.yaml`

会同步：

- 聊天记录
- 服务商名称、类型、Base URL、代理地址、默认模型
- AI API Key
- 主题、紧凑模式、当前对话
- 同步方式、Gist ID、Gist 文件名、Worker 地址

不会同步：

- GitHub Token
- Cloudflare Worker 同步访问密钥
- 各平台系统凭据

同步数据会先由 ZeroChat 在本机端到端加密，然后再上传。远端只保存 `encrypted-snapshot.v1` 密文。新设备需要输入同一个“同步加密密码/恢复码”才能解密恢复数据，不需要额外安装加密工具。

当前加密方案：

- AES-256-GCM
- PBKDF2-HMAC-SHA-256
- 600,000 次迭代
- 每次同步生成新的 16 字节 salt 和 12 字节 IV

## Cloudflare Worker 同步

1. 在 Cloudflare 创建 KV namespace。
2. 复制 `cloudflare/wrangler.toml.example` 为 `cloudflare/wrangler.toml`。
3. 填写 KV namespace id。
4. 设置一个足够长的 `SYNC_TOKEN`。
5. 部署：

```bash
npx wrangler deploy
```

客户端配置：

- 同步方式选 `Cloudflare`
- Worker 地址填你的 Worker URL
- 同步密钥填 `SYNC_TOKEN`
- 同步加密密码填你自己设置的恢复码

如果某个 AI 厂商在浏览器或移动网络下直连失败，把同一个 Worker URL 填到服务商的“代理地址”。

## GitHub Gist 同步

1. 创建 GitHub Fine-grained token，权限只给 Gist 读写。
2. ZeroChat 设置里选择 `GitHub Gist`。
3. 首次同步时 Gist ID 可以留空，应用会创建私有 Gist。
4. 其他设备填同一个 Gist ID、token 和同步加密密码。

## 架构文档

详细设计见：

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/SECURITY.md](docs/SECURITY.md)
