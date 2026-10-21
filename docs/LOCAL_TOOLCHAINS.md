# Local Toolchains

ZeroChat keeps disposable, non-system Android build tools under the ignored
`.local/zerochat/toolchains/` directory. The repository does not require these
archives to be committed.

Current layout:

```text
.local/zerochat/toolchains/
├─ jdk17/                         # extracted Temurin JDK 17
├─ android-sdk/
│  ├─ cmdline-tools/latest/       # extracted Android command-line tools
│  ├─ platform-tools/             # extracted adb
│  ├─ platforms/android-36/
│  └─ build-tools/36.0.0/
└─ cache/                         # downloaded archives and license answers
```

The Android build helpers discover these paths automatically. For direct tool
usage in the current shell, set environment variables without installing system
packages:

```powershell
$env:JAVA_HOME = "$pwd\.local\zerochat\toolchains\jdk17"
$env:ANDROID_SDK_ROOT = "$pwd\.local\zerochat\toolchains\android-sdk"
$env:ANDROID_HOME = $env:ANDROID_SDK_ROOT
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_SDK_ROOT\platform-tools;$env:Path"
```

The local SDK is used only for Android compilation and emulator tooling. The
runtime application does not depend on the toolchain directory. Remove the
entire `.local/zerochat/toolchains/` directory to reclaim disk space; source
and release behavior are unchanged.
