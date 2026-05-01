# ZeroChat for Windows

技术栈：C++/WinRT + WinUI 3。

推荐原因：

- Windows 桌面原生 UI 和窗口体验最好。
- 启动和运行开销低于 Web 壳。
- 可以直接使用 Windows Credential Locker 保存密钥。
- HTTP、文件、通知、托盘、窗口控制都走 Windows 原生 API。

## 工程落地方式

用 Visual Studio 创建：

```text
Blank App, Packaged (WinUI 3 in Desktop)
Project name: ZeroChat
Language: C++
Package name: app.zerochat.client
```

然后把本目录 `ZeroChat/` 下的源文件放进项目。

正式版本建议：

- 本地数据：SQLite。
- 首版可先用 LocalFolder 下的 `snapshot.json`。
- 密钥：Windows Credential Locker。
- 打包：MSIX。
