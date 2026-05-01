# ZeroChat for Android

技术栈：Kotlin + Jetpack Compose。

推荐原因：

- Android 官方主力语言和 UI 框架。
- Compose 对聊天列表、输入框、设置页、动态主题支持好。
- Room、DataStore、Keystore 都是 Android 上稳定的原生方案。

## 计划结构

```text
app/src/main/java/app/zerochat/
  MainActivity.kt
  ai/AiClient.kt
  data/Models.kt
  data/ZeroChatRepository.kt
  security/SecretStore.kt
  sync/SyncClient.kt
  ui/ChatScreen.kt
  ui/SetupScreen.kt
```

正式版本建议：

- 本地数据：Room。
- 普通设置：DataStore。
- 密钥：Android Keystore + EncryptedSharedPreferences。
- 打包：Android Studio / Gradle，输出 APK 或 AAB。
