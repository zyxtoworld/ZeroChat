# Native Apps

ZeroChat 原生端按平台拆分：

- `windows/`：C++/WinUI 3
- `android/`：Kotlin/Jetpack Compose
- `apple/`：Swift/SwiftUI，覆盖 iOS、iPadOS、macOS
- `linux/`：Rust/GTK4

所有端必须兼容 `../shared/snapshot.schema.json`。本目录不共享 UI 代码，只共享协议。
