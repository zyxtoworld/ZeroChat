# 平台实现细节

## Windows

- 语言：C++
- UI：WinUI 3
- 网络：Windows.Web.Http 或 C++ HTTP 客户端
- 本地数据：SQLite，首版可用 LocalFolder JSON
- 密钥：Windows Credential Locker；同步前进入 AES-256-GCM 加密 vault
- 打包：MSIX

优先实现：

1. 首次配置向导
2. 聊天列表和消息流
3. 服务商设置
4. Cloudflare/Gist 同步
5. 系统托盘和快捷键

## Android

- 语言：Kotlin
- UI：Jetpack Compose
- 网络：Ktor Client
- 本地数据：Room
- 设置：DataStore
- 密钥：Android Keystore + EncryptedSharedPreferences
- 同步加密：PBKDF2-HMAC-SHA-256 + AES-256-GCM
- 打包：APK/AAB

优先实现：

1. 单手可用的聊天界面
2. 输入法适配和长文本编辑
3. 通知和分享入口
4. 后台限制下的手动同步

## iOS/macOS

- 语言：Swift
- UI：SwiftUI
- 网络：URLSession
- 本地数据：SwiftData 或 SQLite
- 密钥：Keychain
- 同步加密：PBKDF2-HMAC-SHA-256 + AES-256-GCM
- 打包：Xcode Archive

优先实现：

1. iPhone、iPad、macOS 自适应布局
2. Keychain 密钥保存
3. 分享扩展
4. macOS 多窗口

## Linux

- 语言：Rust
- UI：GTK4/libadwaita
- 网络：reqwest
- 本地数据：SQLite
- 密钥：Secret Service
- 同步加密：PBKDF2-HMAC-SHA-256 + AES-256-GCM
- 打包：Flatpak/AppImage

优先实现：

1. 低内存常驻
2. Wayland/X11 兼容
3. GNOME/KDE 桌面集成
4. Flatpak 权限清单

## Web/PWA

- 语言：TypeScript
- UI：React
- 本地数据：IndexedDB 加密记录
- 密钥：Web Crypto 不可导出 AES-GCM 本机密钥；同步密码仅会话保存
- 同步加密：Web Crypto API PBKDF2 + AES-GCM
- 部署：Cloudflare Pages

Web 是最容易试用和自部署的版本，但不是桌面/移动端主路线。
