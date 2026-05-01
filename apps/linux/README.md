# ZeroChat for Linux

技术栈：Rust + GTK4/libadwaita。

推荐原因：

- Rust 启动快、内存占用低，适合轻量桌面工具。
- GTK4/libadwaita 与 GNOME、Flatpak、Secret Service 集成自然。
- Linux 发行版差异大，Rust 二进制 + Flatpak 是最稳的分发路径。

## 构建

需要系统安装 GTK4 和 libadwaita 开发包。

```bash
cargo run
cargo build --release
```

正式版本建议：

- 本地数据：SQLite。
- 密钥：Secret Service。
- 打包：Flatpak，另提供 AppImage。
