# ZeroChat for Apple Platforms

技术栈：Swift + SwiftUI。

覆盖：

- iOS
- iPadOS
- macOS

推荐原因：

- Apple 平台官方主力语言和 UI 框架。
- SwiftUI 对多窗口、深浅色、动态字体、iPad 布局适配好。
- Keychain、URLSession、SwiftData 都是系统原生能力。

## 工程落地方式

用 Xcode 创建 Multiplatform App：

```text
Product Name: ZeroChat
Organization Identifier: app.zerochat
Bundle Identifier: app.zerochat.client
Interface: SwiftUI
Language: Swift
```

然后把 `Sources/` 下的代码加入工程。

正式版本建议：

- 本地数据：SwiftData；首版也可以用 Application Support 下的 `snapshot.v1.json`。
- 密钥：Keychain。
- 网络：URLSession streaming。
- 打包：Xcode Archive，iOS 走 TestFlight/App Store，macOS 走 notarized dmg/pkg。
