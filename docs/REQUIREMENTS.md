# ZeroChat 产品需求文档 (PRD)

<!-- zerochat-current-evidence:requirements:start -->
## 当前发布证据覆盖层（2026-10-04 03:24 Asia/Shanghai）

- 注：PRD 只保留当前机器可读 handoff；逐次运行证据写入被忽略的 `.manual-qa` 或 Actions artifacts，不追加到 Git 跟踪文档。

- 当前 release diagnostics：`.manual-qa/release-diagnostics-current.json`（19,761 bytes / SHA-256 `E6A28ABA517DC9BEAAC2CC1518C6DF91C4D6031C5A9F6FE64990B9736E928FC9`，generatedAt `2026-10-03T19:24:40.830Z`，2026-10-04 03:24 Asia/Shanghai，status `blocked`，releaseEvidence false）；release blockers：`.manual-qa/release-blockers-current.json`（50,817 bytes / SHA-256 `A708EA30231916A0B175784FDB021C128A4983A94715D4DF3EBCF05A3C67ADE8`，generatedAt `2026-10-03T19:23:26.088Z`，2026-10-04 03:23 Asia/Shanghai，status `blocked`，releaseEvidence false）；verify-release checkpoint：`.manual-qa/verify-release-current.json`（14,516 bytes / SHA-256 `555E818E3840172D5F87BAC0AE43E6753278546574377C7A1E8700ED79ADD8C6`，generatedAt `2026-10-03T19:24:45.724Z`，2026-10-04 03:24 Asia/Shanghai，status `failed`，releaseEvidence false）。
- 当前 strict preflight：`.manual-qa/strict-release-preflight.json`（6,322 bytes / SHA-256 `7A743C4CC406CF0051445E8FE6A8C55AC77956C509F26280CCD74BC6B4AE7203`，generatedAt `2026-10-03T19:10:01.235Z`，2026-10-04 03:10 Asia/Shanghai，status `blocked`，releaseEvidence false）；Windows host preflight：`.manual-qa/windows-msix-host-preflight.json`（56,823 bytes / SHA-256 `5D7234EB64E7D2C01B5733AC2A027A20B3E79661AFE6099B28F41817665B2E7E`，generatedAt `2026-10-03T19:08:40.3227552Z`，2026-10-04 03:08 Asia/Shanghai，status `blocked`，releaseEvidence false）；Hosted native CI diagnostic：`.manual-qa/hosted-native-ci-evidence.json`（6,405 bytes / SHA-256 `E541D6A761E03D228733E9A7B2E2009EE2669945F6BB83E1DD121FF3FA121C10`，generatedAt `2026-10-03T19:09:17.563Z`，2026-10-04 03:09 Asia/Shanghai，status `missing`，releaseEvidence false）；native prerequisite：`.manual-qa/native-prereq-all-platforms.json`（8,126 bytes / SHA-256 `2C446118749BD5D33DAAA92D9D398FABC3303AEC0E34F9CF1C7DAF4C8D7F416B`，generatedAt `2026-10-03T19:09:38.344Z`，2026-10-04 03:09 Asia/Shanghai，releaseEvidence false）。
- 当前 Web QA：2026-09-12 12:21 Asia/Shanghai 通过 79/79 screenshots；Web source digest `4A7AB406636F3F5D93096501003BA51B4A431592B235EF8465E89C6CA9A7C029`；current dist unknown files / unknown bytes。
- 当前 blocker IDs (7)：`apple-target-runtime-qa`, `linux-target-runtime-qa`, `windows-trusted-msix-release-pass`, `disposable-live-sync-release-pass`, `hosted-native-ci-release-evidence`, `live-provider-full-capability-release-evidence`, `live-provider-web-ui-browser-origin-release-evidence`。
- 当前 native source fingerprint：461 files / 5647191 bytes / SHA-256 `7101891A93A064DF06FA13BA97DF2F252094BB7A4EBF2AB08B0E4052D840EF83`。
- 当前 live-sync diagnostic：`.manual-qa/live-sync-release-drill-current-diagnostic.json`（4,583 bytes / SHA-256 `CD99FCDE64508B25F15E8983DBE8A1E53BD92936CE2D7208E68B636D20916DB8`，generatedAt `2026-10-03T19:09:29.240Z`，2026-10-04 03:09 Asia/Shanghai，status `skipped`，releaseEvidence false）；source fingerprint 65 files / 1017099 bytes / SHA-256 `CF06D480593C9D0A77345314F0277C95F6170972AC950BD515CC578912B22B79`；Drill command `pnpm run drill:live-sync` 与 validation commands `pnpm run check:live-sync-report` / `pnpm run check:live-sync-release-pass` 保持分离。
- 当前 live-provider diagnostic：`.manual-qa/live-provider-smoke-current-diagnostic.json`（5,210 bytes / SHA-256 `8B7A8DF273915DD466429A7894174B9D0921BB1EB3FFAD330BE48DA01492A07E`，generatedAt `2026-10-03T19:09:31.620Z`，2026-10-04 03:09 Asia/Shanghai，status `skipped`，releaseEvidence false）；source fingerprint 112 files / 1891434 bytes / SHA-256 `328C7468893055D6ED5F631208007945DCF45FE8F7309028641E44B2ABB6CABB`；Node-side preflight is not browser-origin release evidence。
- 当前 Windows trusted MSIX blocker 语义：Windows trusted MSIX current blocker semantics: blockerKind `windows-appx-deployment-deleted-package-cleanup-access-denied`, owner `host-windows-appx-deployment-service`; currentTrustedQaState `host-preflight-blocked-or-unproven`; needsElevatedTrustedQaRerun false; nextProofGate `close or restart the reported lock-holder applications (System, WidgetService.exe), then rerun pnpm run report:windows-msix-host-preflight and pnpm run check:windows-msix-host-preflight; repair or replace the host only if unlocked deleted-package targets remain`; hostPreflight status `blocked`, trustedMsixQaReadiness `host-blocked`; historicalTrustedQaFailureKind `windows-appx-deployment-deleted-package-cleanup-access-denied`, historicalTrustedQaFailureOwner `host-windows-appx-deployment-service`.；Current host status is report-derived from `.manual-qa/windows-msix-host-preflight.json`，historical trusted-MSIX diagnostic evidence is preserved separately from current release evidence。
- Windows trusted MSIX install/update/uninstall 当前 runtime QA：当前 host 状态以 `.manual-qa/windows-msix-host-preflight.json` 为准（status: `blocked`, hostReadyForTrustedMsix: false, currentShellElevated: false）。

Current product contract / QA markers:

QA marker: Current verify-release metadata is validated from the checkpoint report, never a hard-coded digest.
- QA marker: Local encryption migration feedback stays localized and contained.
- QA marker: Current Settings dialog roots wrap forward and reverse Tab inside the production focus scope.
- QA marker: Current onboarding and navigation use only production store actions and the single Settings surface.
- QA marker: Current Provider model catalog repairs defaults and exposes add, rename, remove, and reorder only through production Settings.
- QA marker: Current generation runtime retries every production generation capability and contains detached replay failures.
- QA marker: Current offline replay persists exclusive claims and terminal states before Provider or sync effects.
- QA marker: Current image submission clears only the accepted draft and source after durable commit.
- QA marker: Current image submission preserves newer draft and source ownership while a send is pending.
- QA marker: Current audio transcription claims cancellation ownership before proxy token derivation.
- QA marker: Current audio transcription appends only a non-stale result to the latest Composer draft.
- QA marker: Current Settings confirms Skill deletion through the production action boundary.
- QA marker: Current Settings confirms Provider model deletion through the production catalog boundary.

Current live-sync safety contract:

- QA marker: Live-sync drill CLI help and invalid arguments cannot write reports or touch remote storage.
- QA marker: Live-sync release evidence rejects ephemeral tunnel endpoints.
- Live sync release drill rejects invalid CLI arguments before environment-driven report or remote behavior.
- Live sync release-pass drill-name uniqueness guard rejects an epoch-millisecond suffix error before release evidence is accepted.
- A passing live sync release drill report is the only release evidence; diagnostic reports retain requiredInputs, missingInputKeys, and releaseBlockerSummary.
- 当前 live-provider full-capability source binding：Live provider full-capability evidence source binding: preferredProviderBlockerSource `current-diagnostic`; blockerKind `missing-live-provider-release-inputs`; selectedSourceReport `.manual-qa/live-provider-smoke-current-diagnostic.json`, status `skipped`, releaseEvidence false, releaseEndpointEligible false, sourceFingerprintCurrent true, hasCredentialConfirmedProviderAttempt false, hasFullCapabilityAttempt false; currentDiagnosticReport `.manual-qa/live-provider-smoke-current-diagnostic.json`, status `skipped`, releaseEvidence false, releaseEndpointEligible false, sourceFingerprintCurrent true, hasFullCapabilityAttempt false; credentialConfirmedAttemptReport `.manual-qa/live-provider-smoke-attempt-current.json`, status `failed`, releaseEvidence false, releaseEndpointEligible true, sourceFingerprintCurrent false, hasCredentialConfirmedProviderAttempt true, hasFullCapabilityAttempt true, hasReleaseEligibleProviderAttempt true, requestedCapabilities chat true, image true, audio true, lowCost true, realtime true; selectedModels chat `unknown` (unknown), image `unknown` (unknown), audioSpeech `unknown`, audioTranscription `unknown`, embedding `unknown`, moderation `unknown`, realtime `unknown`; capabilityFailureModelAttempts none; capabilityFailureSummary.total 0, affectedCapabilities `none`, routeHealthBlockers `none`. Live provider full-capability required remediation: source `none`; capabilityFailureSummary.total 0; affectedCapabilities `none`; routeHealthBlockers `none`; capabilityRemediationHintCount 0; reportRemediationHintCount 0; remediationTargets `none`; rerunCommands `pnpm run drill:live-provider` / `pnpm run check:live-provider-report` / `pnpm run check:live-provider-full-capability`.
- 当前 live-provider UI browser-origin 证据语义：Live provider UI browser-origin proxy preflight semantics: top-level browserOriginProven false; proxyPreflight.status `passed`, transportPath `node-to-provider`, browserOriginProven false, selectedModel `gpt-5-6-pro`, chatStatus `200`; Node-side preflight is not browser-origin release evidence. Live provider UI browser-origin evidence source binding: preferredUiBlockerSource `current-diagnostic`; blockerKind `missing-live-provider-ui-release-inputs`; selectedFailureKind `unknown`; preservedAttemptFailureKind `unknown`; selectedSourceReport `.manual-qa/live-provider-ui-smoke-current.json`, status `skipped`, releaseEvidence false, releaseEndpointEligible false, sourceFingerprintCurrent true; currentDiagnosticReport `.manual-qa/live-provider-ui-smoke-current.json`, status `skipped`, releaseEvidence false, releaseEndpointEligible false, sourceFingerprintCurrent true; preservedAttemptSourceFingerprintCurrent false; browserOriginProven false; markerCaptured false; browserMessageSent false; requestedInputs proxyConfigured false, syncPassphraseProvided false, workerHostedProviderKeyRequested false; browserProviderKeyInjected false; selectedScreenshot `none`, unknown bytes / SHA-256 `unknown`; preservedAttemptScreenshot `none`, unknown bytes / SHA-256 `unknown`. browserOriginProven false, browserMessageSent false。

### Release 阻塞残项

- [ ] 当前 release blocker `apple-target-runtime-qa`：status `blocked`，blockerKind `missing-apple-target-runtime-prerequisites`，owner `target-host-macos-xcode-swift`；next action：Run the Apple QA entry on macOS with Xcode/Swift installed.
- [ ] 当前 release blocker `linux-target-runtime-qa`：status `blocked`，blockerKind `missing-linux-target-runtime-prerequisites`，owner `target-host-linux-gtk-secret-service`；next action：Run the Linux QA entry inside Linux or WSL with GTK4/libadwaita and Secret Service available.
- [ ] 当前 release blocker `windows-trusted-msix-release-pass`：status `blocked`，blockerKind `windows-appx-deployment-deleted-package-cleanup-access-denied`，owner `host-windows-appx-deployment-service`；next action：Treat this as external lock-holder/AppX package lifecycle state, not as ZeroChat release-pass evidence.
- [ ] 当前 release blocker `disposable-live-sync-release-pass`：status `skipped`，blockerKind `missing-live-sync-release-inputs`，owner `release-operator-disposable-sync-credentials`；next action：Configure disposable Cloudflare or Gist sync credentials, use the destructive confirmation value, then rerun the live sync release drill.
- [ ] 当前 release blocker `hosted-native-ci-release-evidence`：status `missing`，blockerKind `missing-hosted-native-ci-release-evidence`，owner `release-operator-github-actions`；next action：Resolve hosted native CI local prerequisites (clean-git-worktree) before claiming artifact evidence.
- [ ] 当前 release blocker `live-provider-full-capability-release-evidence`：status `skipped`，blockerKind `missing-live-provider-release-inputs`，owner `external-provider-or-third-party-relay`；next action：Treat the preserved credential-confirmed full-capability API attempt as historical diagnostic context; rerun pnpm run drill:live-provider after applying its route/service remediation so the report matches the current source fingerprint.
- [ ] 当前 release blocker `live-provider-web-ui-browser-origin-release-evidence`：status `skipped`，blockerKind `missing-live-provider-ui-release-inputs`，owner `browser-allowed-ai-proxy-or-cloudflare-worker`；next action：Configure a browser-allowed AI proxy/Cloudflare Worker root through ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL; direct provider mode is diagnostic-only and cannot produce browser-origin release evidence.

---
<!-- zerochat-current-evidence:requirements:end -->

> 历史发布证据不写入 Git 跟踪文档；逐次运行证据保留在被忽略的 .manual-qa 或 Actions artifacts。

## 一、产品定位

### 1.1 一句话描述

ZeroChat 是一个隐私优先、全平台原生的 AI 聊天客户端——用户自带 API Key，数据端到端加密，跨设备同步，零服务器依赖。

### 1.2 核心价值主张

| 价值 | 说明 |
|------|------|
| 隐私第一 | 所有数据本地加密存储，远端只存密文，零明文泄露 |
| 全平台原生 | 每个平台用最适合的语言和框架，不套壳不妥协 |
| 极致轻量 | Web 首屏 < 120KB gzip，原生端冷启动 < 800ms |
| 小白友好 | 首次使用只需选 Provider + 填 Key，3 步开聊 |
| 自主可控 | 无账号体系，无订阅，无后端服务器，用户完全拥有数据 |

### 1.3 目标用户

- 关注隐私的 AI 重度用户
- 多设备切换的知识工作者
- 不想被单一平台锁定的技术爱好者
- 想要简洁无广告 AI 聊天体验的普通用户（小白）

### 1.4 竞品对标

| 维度 | ChatGPT App | Claude App | ZeroChat 目标 |
|------|-------------|------------|---------------|
| 隐私 | 服务端存储 | 服务端存储 | 端到端加密，零明文 |
| 多 Provider | 仅 OpenAI | 仅 Anthropic | 任意 Provider |
| 跨平台 | 全平台 | Web+iOS+Android | 全平台原生 |
| 离线 | 不支持 | 不支持 | PWA 离线可用 |
| 数据所有权 | 平台所有 | 平台所有 | 用户完全拥有 |
| 启动速度 | 2-4s | 2-3s | < 1.2s (Web) / < 800ms (原生) |

---

## 二、技术栈选型

### 2.1 各平台技术选型及理由

| 平台 | 语言 | 框架 | 选型理由 |
|------|------|------|----------|
| Web/PWA | TypeScript | React 19 + Vite 6 | 生态最成熟，Tree-shaking 最优，Vite 冷启动极快 |
| Android | Kotlin | Jetpack Compose | Google 官方推荐，声明式 UI 性能最优，APK 体积可控 |
| iOS | Swift | SwiftUI + async/await | Apple 原生最佳实践，编译优化最好，内存管理自动 |
| macOS | Swift | SwiftUI + AppKit | 复用 iOS 核心代码，AppKit 补充桌面级功能（多窗口、菜单栏） |
| Windows | C++ | WinUI 3 + WebView2 | WinUI 3 提供原生窗口壳，WebView2 复用 Web UI 减少维护成本 |
| Linux | Rust | GTK4 + libadwaita | Rust 零开销抽象 + 内存安全，GTK4 是 GNOME 原生，libadwaita 自适应布局 |

### 2.2 为什么不用跨平台框架

| 方案 | 否决理由 |
|------|----------|
| Electron | 内存占用 200MB+，启动慢，包体 150MB+ |
| Flutter | 非原生渲染，无法使用平台原生控件，文字渲染有差异 |
| React Native | 性能瓶颈在 JS Bridge，不适合流式文本密集场景 |
| Tauri | 比 Electron 好但仍是 WebView 套壳，Linux/Windows 体验不够原生 |

### 2.3 共享逻辑策略

各平台独立实现 UI 层，但以下逻辑保持协议一致：
- 加密算法：AES-256-GCM + PBKDF2-SHA256 600k 迭代（各平台用原生 crypto 库实现）
- 同步协议：相同的 API 接口和数据格式
- Provider 协议：OpenAI Chat/Responses API 兼容格式
- 数据模型：相同的 JSON schema

---

## 三、设计系统

### 3.1 设计哲学

ZeroChat 的视觉语言追求：**安静但不无聊，简洁但有层次，专业但有温度**。

设计原则（按优先级排序）：

1. **呼吸感** — 大量留白，元素之间有足够的空间，不拥挤
2. **层次感** — 通过微妙的阴影、透明度和模糊区分前景/背景
3. **流动感** — 所有状态变化都有平滑过渡，让界面"活"起来
4. **一致性** — 同类元素在所有平台上保持相同的视觉权重和交互模式
5. **可达性** — WCAG 2.1 AA 对比度，支持键盘导航和屏幕阅读器

### 3.2 色彩系统（2026-08 当前设计刷新）

品牌色刷新为 ZeroChat Blue（`#0A7CFF`，深色 `#3B93FF`）。当前 Web 前端（`src/app/app.css`）与原生平台主题（Android `ZeroChatApp.kt`、Apple `ZeroChatTheme.swift`、Linux `theme.rs`）共用同一组令牌：

```
品牌色系（Light Mode）:
  --brand-primary: #0A7CFF      // 主操作、发送按钮、用户气泡
  --brand-primary-hover: #0069E0
  --brand-soft: rgba(10,124,255,0.10)
  --brand-border: #CDD2DA

表面色系（Light Mode）:
  --bg-base: #F7F8FA
  --bg-surface: #FFFFFF          // 卡片/面板/AI 气泡
  --bg-sunken: #EEF0F3           // 输入框/凹陷区

文字色系:
  --text-primary: #16181D
  --text-secondary: #5B6472
  --text-tertiary: #8A93A3
  --text-inverse: #FFFFFF

边框色系:
  --border-default: #E3E6EB
  --border-strong: #CDD2DA
  --border-focus: #0A7CFF

语义色:
  --success: #17803D
  --error: #D93025

品牌色系（Dark Mode）:
  --brand-primary: #3B93FF
  --brand-primary-hover: #63AAFF
  --brand-soft: rgba(59,147,255,0.16)
  --brand-border: #384050

表面色系（Dark Mode）:
  --bg-base: #0F1115
  --bg-surface: #171A21
  --bg-sunken: #0B0D11
  --bubble-ai: #1C2029

文字色系（Dark Mode）:
  --text-primary: #E8EAF0
  --text-secondary: #A4ADBC
  --text-tertiary: #6E7789

边框色系（Dark Mode）:
  --border-default: #262B36
  --border-strong: #384050
  --border-focus: #3B93FF
```

历史版本（Indigo #6366F1 / #818CF8）已被当前设计取代，存档备查。
### 3.3 字体系统

```
--font-sans: "Inter Variable", "SF Pro Display", -apple-system,
             BlinkMacSystemFont, "Segoe UI Variable", sans-serif;
--font-mono: "JetBrains Mono", "SF Mono", "Cascadia Code",
             "Fira Code", ui-monospace, monospace;

字号阶梯:
  --text-xs: 11px / 1.45
  --text-sm: 13px / 1.5
  --text-base: 15px / 1.6
  --text-lg: 17px / 1.5
  --text-xl: 20px / 1.35
  --text-2xl: 24px / 1.3
  --text-3xl: 30px / 1.2

字重:
  --font-normal: 400
  --font-medium: 500
  --font-semibold: 600
  --font-bold: 700
```

### 3.4 间距系统

基于 4px 网格：

```
--space-1: 4px
--space-2: 8px
--space-3: 12px
--space-4: 16px
--space-5: 20px
--space-6: 24px
--space-8: 32px
--space-10: 40px
--space-12: 48px
--space-16: 64px
```

### 3.5 圆角系统

```
--radius-sm: 6px       // 小元素（tag、badge）
--radius-md: 10px      // 按钮、输入框
--radius-lg: 14px      // 卡片、面板、消息气泡
--radius-xl: 20px      // 大面板、模态框
--radius-full: 9999px  // 圆形（头像、胶囊按钮）
```

### 3.6 阴影系统

```
--shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.04);
--shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.06);
--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);
--shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.12);
--shadow-xl: 0 16px 48px rgba(0, 0, 0, 0.16);

Dark Mode 阴影加深 1.5x opacity
```

### 3.7 动效系统

```
过渡时长:
  --duration-fast: 120ms     // hover、focus
  --duration-normal: 200ms   // 展开、折叠
  --duration-slow: 320ms     // 页面切换、模态框

缓动函数:
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1)      // 弹出
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1)    // 通用
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1) // 弹性（按钮回弹）

必须有动效的场景:
  - 消息出现：从下方 fade + slide up (12px, 200ms)
  - AI 打字：光标闪烁 + 文字逐字出现
  - 侧边栏展开/收起：slide + fade (200ms)
  - 模态框：scale(0.95) + fade in (200ms)
  - 按钮 hover：背景色过渡 + 微缩放 scale(1.02)
  - 发送按钮：点击时 scale(0.92) 回弹
  - 通知/toast：从顶部 slide down (300ms)
  - 页面切换：crossfade (150ms)
  - 骨架屏：shimmer 动画（1.5s 循环）
  - Provider 卡片展开：height auto + fade (200ms)

禁止动效的场景:
  - prefers-reduced-motion 时全部降级为 instant
  - 列表滚动中不触发入场动画
```

### 3.8 组件规范

#### 按钮

| 类型 | 用途 | 样式 |
|------|------|------|
| Primary | 主操作（发送、保存） | 实心品牌色，白色文字，hover 加深 |
| Secondary | 次要操作（取消、返回） | 透明底 + 边框，hover 浅色填充 |
| Ghost | 工具栏操作 | 无边框，hover 显示背景 |
| Danger | 删除、重置 | 红色边框/文字，hover 红色浅底 |
| Icon | 图标按钮 | 36x36 圆角方形，居中图标 |

所有按钮:
- 最小高度 40px（移动端 44px 触摸目标）
- 内边距 0 16px
- 圆角 --radius-md
- 禁用态 opacity: 0.5 + cursor: not-allowed
- 加载态显示 spinner 替换文字/图标
- 点击反馈 transform: scale(0.96) 持续 100ms

#### 输入框

- 高度 44px
- 圆角 --radius-md
- 边框 1px --border-default
- 聚焦态：边框变 --border-focus + 外发光 0 0 0 3px brand-soft
- 错误态：边框变 --error + 外发光 error-soft
- 标签在输入框上方，13px --text-secondary
- placeholder 用 --text-tertiary

#### 消息气泡

- AI 消息：左对齐，--bg-surface 底色，1px --border-subtle 边框，左侧有 AI 头像
- 用户消息：右对齐，--brand-primary 底色，白色文字，右侧有用户头像
- 最大宽度 min(680px, calc(100% - 44px))
- 圆角 --radius-lg
- 内边距 14px 18px
- 消息间距 24px
- 代码块：独立容器，顶部 header（语言名 + 复制按钮），--bg-input 底色

#### 侧边栏

- 宽度 280px（桌面），可折叠
- 背景 --bg-sidebar
- 右边框 1px --border-subtle
- 会话列表项：padding 10px 12px，圆角 --radius-md
- 选中态：--brand-soft 底色 + 左侧 3px 品牌色条
- hover 态：--bg-input 背景

#### 模态框

- 最大宽度 560px（小型）/ 720px（中型）/ 920px（大型）
- 圆角 --radius-xl
- 阴影 --shadow-xl
- 背景遮罩 rgba(0,0,0,0.4) + backdrop-filter: blur(4px)
- 入场动画 scale(0.95) + opacity(0) → scale(1) + opacity(1)

---

## 四、Web/PWA 界面设计

### 4.1 整体布局

```
┌─────────────────────────────────────────────────────────┐
│ ┌──────────┐ ┌────────────────────────────────────────┐ │
│ │          │ │  Header: 会话标题 + Provider/Model 选择  │ │
│ │  侧边栏   │ ├────────────────────────────────────────┤ │
│ │          │ │                                        │ │
│ │ - 搜索    │ │         消息列表（居中，max 780px）      │ │
│ │ - 会话列表 │ │                                        │ │
│ │          │ │                                        │ │
│ │          │ │                                        │ │
│ │          │ ├────────────────────────────────────────┤ │
│ │ - 新建    │ │  Composer: 输入框 + 模式切换 + 发送     │ │
│ │ - 设置    │ └────────────────────────────────────────┘ │
│ └──────────┘                                            │
└─────────────────────────────────────────────────────────┘
```

响应式断点：
- ≥ 860px：双栏布局（侧边栏 + 聊天区）
- < 860px：单栏布局，侧边栏隐藏，通过汉堡菜单呼出
- < 480px：Composer 模式切换按钮隐藏，Model 选择器简化

### 4.2 首次使用流程（Onboarding）

目标：3 步开聊，不超过 60 秒。零学习成本，小白一看就会。

```
Step 1: 欢迎页
  - 居中大标题 "ZeroChat"（品牌色渐变）
  - 副标题 "隐私优先的 AI 聊天"（--text-secondary）
  - 一个大按钮 "开始设置"（Primary 样式，宽度 200px）
  - 底部小字 "也可以跳过，稍后在设置中配置"（可点击，Ghost 样式）
  - 背景：微妙的品牌色渐变光晕（纯装饰）

Step 2: 选择 Provider
  - 标题 "选择你的 AI 服务"
  - 副标题 "你可以随时添加更多"
  - 卡片网格（2列）展示主流 Provider：
    · OpenAI（绿色图标 #10A37F）
    · Anthropic（橙色图标 #D97757）
    · Google Gemini（蓝色图标 #4285F4）
    · DeepSeek（蓝紫图标 #4D6BFE）
    · xAI（黑色图标）
    · OpenRouter（紫色图标）
  - 每张卡片：彩色圆形图标 + Provider 名称 + 一句话说明
  - 选中态：品牌色边框 + 浅色底 + 左上角勾选标记
  - 底部 "自定义 Relay" 入口（文字链接）
  - "下一步" 按钮（选中后才可点击）

Step 3: 输入 API Key
  - 标题 "输入 [Provider名] API Key"
  - 大输入框（password 模式，右侧眼睛图标切换可见）
  - 输入框下方：
    · 链接 "如何获取 API Key？" → 跳转对应 Provider 文档
    · 提示文字 "Key 加密存储在本地，不会上传到任何服务器"
  - "完成" 按钮
  - 点击完成后自动验证 Key（调用 /models 接口）
  - 验证中：按钮显示 spinner + "验证中..."
  - 验证成功：绿色勾 + "连接成功！" → 1s 后自动跳转聊天
  - 验证失败：红色提示 "Key 无效，请检查后重试" + 输入框红色边框

完成后直接进入聊天界面，自动创建第一个会话 "新对话"。
```

### 4.3 聊天界面细节

**消息列表**:
- 消息区域居中，最大宽度 780px，两侧自动 margin
- AI 消息左侧有小头像（32x32，品牌色浅底 + AI 图标）
- 用户消息右侧有小头像（32x32，灰色底 + 用户图标）
- 消息之间 24px 间距
- AI 正在回复时显示打字指示器（三个跳动的点，品牌色）
- 流式输出时文字逐步出现，末尾有闪烁光标（|，品牌色，0.8s 闪烁）
- 新消息出现时自动滚动到底部（如果用户已在底部附近 100px 内）
- 用户向上滚动时不自动滚动，显示 "↓ 新消息" 浮动按钮

**空会话状态**:
- 居中显示欢迎卡片：
  · 品牌图标（64x64）
  · "有什么我可以帮你的？"
  · 4 个快捷提示卡片（2x2 网格）：
    - "解释一段代码"
    - "帮我写一封邮件"
    - "翻译这段文字"
    - "头脑风暴"
  · 点击快捷提示直接填入输入框

**Composer（输入区）**:
- 固定在底部，与消息列表有 16px 间距
- 容器：圆角 --radius-lg，1px 边框，--bg-surface 底色，--shadow-sm
- 聚焦时：边框变品牌色，外发光 3px brand-soft
- 内部三栏布局：[模式切换] [输入框] [发送按钮]
- 输入框自动增高（1-5 行），超过后内部滚动
- 左侧模式切换：两个小按钮（"聊天"/"图片"），选中态品牌色底
- 右侧发送按钮：38x38 圆角方形，品牌色底，白色箭头图标
- 发送按钮在输入为空时：opacity 0.5，不可点击
- 快捷键：Ctrl+Enter（Windows/Linux）或 Cmd+Enter（macOS）发送
- Shift+Enter 换行

**Header**:
- 左侧：会话标题（可点击进入编辑模式，回车确认，Esc 取消）
- 右侧：Provider/Model 选择器
- 选择器样式：圆角胶囊形（--radius-full），1px 边框
- 选择器内容：Provider 名 + Model 名（两行，小字）
- 点击展开浮动面板：按 Provider 分组显示可用 Model
- 面板中每个 Model 显示名称，选中态品牌色高亮

### 4.4 设置界面

全屏页面（非模态框），左侧 Tab 导航 + 右侧内容区：

```
┌─────────────────────────────────────────────────┐
│  ← 返回聊天          设置                        │
├──────────┬──────────────────────────────────────┤
│          │                                      │
│ 外观      │   [当前 Tab 的设置内容]               │
│ AI 服务   │                                      │
│ 模型      │   内容区最大宽度 640px，居中           │
│ 技能      │                                      │
│ 同步      │                                      │
│ 数据      │                                      │
│          │                                      │
├──────────┤                                      │
│ v1.0.0   │                                      │
└──────────┴──────────────────────────────────────┘
```

**Tab 导航**:
- 宽度 220px，--bg-sidebar 底色
- 每个 Tab：左侧图标 + 文字，padding 10px 12px
- 选中态：--brand-soft 底色 + 品牌色文字 + 左侧 3px 品牌色条
- 顶部 "← 返回聊天" 按钮
- 底部版本号

**AI 服务 Tab**:
- Provider 卡片列表（以 `src/app/components/SettingsView.tsx` 的当前实现和视觉审计为准）
- 每张卡片：左侧彩色图标 + Provider 名 + 模型数量 + 右侧连接状态
- 连接状态：绿色圆点 "已连接" / 灰色圆点 "未连接"
- 点击卡片展开详情表单
- 表单字段：名称、协议（只读）、Base URL、API Key（密码框+眼睛）、Worker URL
- 底部操作：检测连接（Primary）+ 删除 Provider（Danger）
- 右上角 "+ 添加" 按钮

**外观 Tab**:
- 主题切换：浅色/深色/跟随系统（三选一，Radio 或 Segmented Control）
- 字号调节：滑块或 +/- 按钮
- 消息密度：紧凑/标准/宽松

**同步 Tab**:
- 同步方式选择：GitHub Gist / Cloudflare Worker
- 对应配置表单
- 同步密码设置
- 手动同步按钮 + 上次同步时间

**数据 Tab**:
- 导出所有数据（JSON）
- 导入数据
- 清除所有数据（Danger，需二次确认）

### 4.5 小白友好设计细节

**渐进式引导**:
- 首次进入每个功能区域时，显示轻量 tooltip 提示（只显示一次）
- 所有危险操作（删除、清除）需要二次确认弹窗
- 错误信息用人话，不显示技术细节（如 "网络连接失败，请检查网络" 而非 "ERR_NETWORK"）
- 成功操作有明确的视觉反馈（绿色 toast 或勾选动画）

**空状态设计**:
- 无会话时：欢迎卡片 + 快捷提示
- 无 Provider 时：引导卡片 "添加你的第一个 AI 服务" + 大按钮
- 同步未配置时：简洁说明 + "开始配置" 按钮
- 搜索无结果时："没有找到相关会话" + 建议

**错误处理 UX**:
- API Key 无效：红色边框 + "Key 无效，请检查是否复制完整"
- 网络超时：黄色 toast "网络较慢，正在重试..." + 自动重试 3 次
- 余额不足：明确提示 "API 余额不足，请充值后重试"
- Provider 不可用：灰色状态 + "服务暂时不可用"
- 所有错误都有 "重试" 按钮

**可发现性**:
- 所有可交互元素有明确的 hover 态变化
- 图标按钮有 tooltip（悬停 500ms 后显示）
- 快捷键在 tooltip 中显示（如 "发送 (Ctrl+Enter)"）
- 设置项有 hint 文字解释用途

---

## 五、架构设计

### 5.1 Web/PWA 代码结构

```
src/
├── app/
│   ├── bootstrap.tsx        // index.html 唯一生产页面入口
│   ├── App.tsx              // 启动状态、导航壳和当前页面组合
│   ├── app.css              // 自包含设计变量、布局、响应式和动画
│   ├── theme.ts             // light/dark/system 主题解析与监听
│   ├── i18n.ts              // 运行时 locale 解析与切换
│   ├── strings.ts            // 当前 UI 的类型化文案契约
│   ├── store.ts              // Zustand AppState 与持久化/运行时动作
│   └── components/           // 当前唯一 UI 组件树
│       ├── ChatView.tsx
│       ├── Composer.tsx
│       ├── ImageComposerPanel.tsx
│       ├── Markdown.tsx
│       ├── MessageList.tsx
│       ├── Onboarding.tsx
│       ├── RuntimeBoundary.tsx
│       ├── SettingsView.tsx
│       ├── Sidebar.tsx
│       └── Toast.tsx
├── services/                 // 可测试的领域控制器、Provider、同步和 UI runtime
│   ├── chat*.ts              // 聊天生成、流式响应与停止/重放
│   ├── provider*.ts          // Provider 安全、模型与能力检查
│   ├── sync*.ts              // Cloudflare/Gist 同步与冲突处理
│   ├── settings*.ts          // 设置、Skill、数据动作控制器
│   ├── markdown*.ts          // Markdown worker 客户端与渲染
│   └── __tests__/             // 当前生产服务的行为契约
├── data/                     // Provider 预设与静态数据
├── storage/                  // IndexedDB AppData 与本机秘密存储
├── types.ts                  // 跨 UI/service/storage 的数据契约
└── workers/markdown.worker.ts // 生产可达的 module Worker 入口
```

### 5.2 状态管理（当前 AppState）

`src/app/store.ts` 导出唯一的 `useAppStore`，以 Zustand 管理 `AppData`、启动状态、当前设置/侧栏、Composer、同步、流式生成、待处理图片、通知和运行时 loader。持久化数据仍通过 `src/storage/db` 与 `src/storage/secrets` 进入既有加密和原子保存边界；聊天、Provider、同步、Skill 与设置的异步业务由 `src/services` 控制器承载，组件只组合当前 UI 和用户动作。新增状态必须先进入这些现有契约，并由 `src/app/__tests__` 或 `src/services/__tests__` 锁定行为。

### 5.3 代码分割策略

使用当前构建入口和服务级动态导入实现分割，不能凭空维护不存在的页面 chunk：

```
固定首屏:
  - index.html -> src/app/bootstrap.tsx
  - App/Onboarding/Chat/Settings 的当前组件树
  - app.css、theme、i18n 和 store

按需资源:
  - chat / sync / syncGist / skills / crypto 服务
  - locale-[lang] 语言包
  - markdown.worker.ts 及其 module Worker client

验收:
  - pnpm run check:bundle
  - pnpm run check:web-production-reachability
  - pnpm run check:service-worker
```

### 5.4 原生端代码结构

**Android (Kotlin)**:
```
app/src/main/java/app/zerochat/
├── ZeroChatApp.kt           // Application
├── MainActivity.kt          // 单 Activity
├── ai/
│   ├── AiClient.kt          // 流式 SSE 客户端
│   ├── ProviderRegistry.kt  // Provider 管理
│   └── ModelDiscovery.kt    // 模型发现
├── data/
│   ├── Models.kt            // 数据模型
│   ├── Database.kt          // Room 数据库
│   └── Migrations.kt        // 数据库迁移
├── crypto/
│   ├── CryptoEngine.kt      // AES-256-GCM
│   └── KeyDerivation.kt     // PBKDF2
├── sync/
│   ├── SyncClient.kt        // 同步客户端
│   └── AutoSync.kt          // 自动同步
├── security/
│   └── SecretStore.kt       // EncryptedSharedPreferences
└── ui/
    ├── chat/
    │   ├── ChatScreen.kt
    │   ├── MessageList.kt
    │   ├── MessageContentBlocks.kt
    │   ├── MessageMarkdownBlocks.kt
    │   └── Composer.kt
    ├── settings/
    │   └── SettingsScreen.kt
    ├── onboarding/
    │   └── OnboardingScreen.kt
    └── theme/
        └── Theme.kt         // Material You 主题
```

**iOS/macOS (Swift)**:
```
Sources/ZeroChatCore/        // 共享核心（Swift Package）
├── Models.swift
├── AiClient.swift           // 流式 URLSession
├── CryptoEngine.swift       // CryptoKit AES-256-GCM
├── SyncClient.swift
├── KeychainStore.swift
└── ProviderRegistry.swift

App/                         // iOS App
├── ZeroChatApp.swift
├── ChatView.swift
├── MessageBubble.swift
├── ComposerView.swift
├── SettingsView.swift
└── OnboardingView.swift

MacApp/                      // macOS App（独立 target）
├── MacApp.swift
├── MacChatView.swift
├── MacSidebar.swift
├── MacSettingsWindow.swift
└── MenuBarExtra.swift
```

**Linux (Rust)**:
```
src/
├── main.rs                  // GTK Application 启动（< 50 行）
├── app.rs                   // AdwApplication 配置
├── window.rs                // 主窗口
├── ui/
│   ├── chat_view.rs         // 聊天视图
│   ├── message_row.rs       // 消息行 widget
│   ├── composer.rs          // 输入区
│   ├── sidebar.rs           // 侧边栏
│   └── settings_window.rs   // 设置窗口
├── ai/
│   ├── client.rs            // reqwest 流式客户端
│   ├── providers.rs         // Provider 管理
│   └── models.rs            // 数据模型
├── crypto/
│   ├── encrypt.rs           // ring AES-256-GCM
│   └── key_derive.rs        // PBKDF2
├── sync/
│   ├── client.rs            // 同步客户端
│   └── auto_sync.rs         // 自动同步
├── storage/
│   └── db.rs                // SQLite (rusqlite)
└── secret_store.rs          // Secret Service D-Bus
```

### 5.5 原生端流式响应

所有原生端必须实现流式输出（SSE）：

- **Android**: Ktor `HttpStatement.execute { response -> }` + `ByteReadChannel` 逐行读取
- **iOS/macOS**: `URLSession.bytes(for:)` async sequence，逐行解析 SSE
- **Linux**: `reqwest::Response::bytes_stream()` + tokio 异步流
- **Windows**: WebView2 内 Web 端已实现流式，无需额外处理
- Web/PWA and native clients request an SSE response explicitly and normalize cumulative or replayed provider text before publishing it, so a provider snapshot cannot duplicate already visible output.

流式输出 UI 要求：
- 逐 token 更新消息内容，不能等完整响应
- 更新频率：每收到数据立即渲染，但 UI 刷新限制在 60fps
- 流式中显示 "停止" 按钮，点击立即中断连接
- 流式完成后触发自动同步

### 5.6 测试要求

```
Web/PWA:
  - 单元测试: Vitest（覆盖 services/、state/、hooks/）
  - 组件测试: Vitest + Testing Library
  - E2E 测试: Playwright（核心流程：发送消息、切换 Provider、同步）
  - 覆盖率目标: services/ > 90%, state/ > 85%, 组件 > 70%

Android:
  - 单元测试: JUnit 5 + MockK
  - UI 测试: Compose UI Test
  - 覆盖率: 核心逻辑 > 80%

iOS/macOS:
  - 单元测试: XCTest
  - UI 测试: XCUITest
  - 覆盖率: 核心逻辑 > 80%

Linux:
  - 单元测试: #[cfg(test)] + cargo test
  - 集成测试: tests/ 目录
  - 覆盖率: > 75%
```

---

## 六、功能需求

### 6.1 核心功能（P0 — 必须实现）

#### 6.1.1 AI 聊天

| 需求 | 说明 |
|------|------|
| 多 Provider 支持 | OpenAI、Anthropic、Gemini、DeepSeek、xAI、OpenRouter 等 |
| 流式输出 | 所有平台必须支持 SSE 流式，逐 token 显示 |
| 多会话管理 | 创建、切换、重命名、删除会话 |
| 消息操作 | 用户消息可编辑重发，AI 消息可重新生成、删除 |
| 上下文窗口 | 自动截取最近 N 条消息（可配置），system prompt 始终保留 |
| Markdown 渲染 | AI 回复支持完整 Markdown：标题、列表、代码块、表格、链接；常见 HTML/XML 包装在展示与复制前归一化为安全 Markdown/纯文本，脚本与工具调用包装不泄露 |
| 代码高亮 | 代码块支持语法高亮（至少 20 种语言），带复制按钮和语言标签 |
| 停止生成 | 流式输出中可随时停止，已输出内容保留 |
| 错误恢复 | 网络错误/API 错误显示友好提示，可一键重试 |

#### 6.1.2 图片生成

| 需求 | 说明 |
|------|------|
| 文生图 | 输入 prompt 生成图片 |
| 图片编辑 | 上传原图 + prompt 编辑 |
| Inpainting | 画笔涂抹蒙版区域 + prompt 重绘 |
| 图片下载 | 生成的图片可下载到本地 |
| 模型选择 | 自动识别图片模型（gpt-image-*、dall-e-*、flux 等） |

#### 6.1.3 端到端加密同步

| 需求 | 说明 |
|------|------|
| 加密方案 | AES-256-GCM + PBKDF2-SHA256 600k 迭代 |
| 同步后端 | GitHub Gist（轻量）或 Cloudflare Worker+KV+R2（推荐） |
| 增量同步 | Cloudflare 模式只上传变化的 chunk |
| 即时同步 | 发送消息、AI 回复完成后立即触发同步 |
| 首次同步冲突 | 双端有数据时必须让用户选择方向（本地覆盖远端/远端覆盖本地） |
| 密码管理 | 修改已同步密码需要显式确认 |

#### 6.1.4 Provider 管理

| 需求 | 说明 |
|------|------|
| 预设 Provider | 内置 20+ 主流 Provider 预设（含 logo、默认 URL、协议类型） |
| 自定义 Relay | 支持添加 OpenAI 兼容/Responses/Anthropic 格式的自定义 Relay |
| 连接检测 | 一键检测 Base URL + Key 是否有效 |
| 模型发现 | 自动获取 Provider 支持的模型列表 |
| 手动模型 | 支持手动输入模型名称（用于未公开模型） |
| Worker 代理 | Web 端可配置 Cloudflare Worker 解决 CORS |
| 安全校验 | 拒绝 HTTP/localhost/私网/LAN 地址的 Base URL |

### 6.2 增强功能（P1 — 应该实现）

#### 6.2.1 Skills（知识库）

| 需求 | 说明 |
|------|------|
| 导入 | 支持 .md/.txt/.json 文件导入为 Skill |
| 自动匹配 | 根据用户消息关键词自动注入相关 Skill 片段到 system prompt |
| 手动选择 | 用户可手动选择本次对话使用哪些 Skill |
| 管理 | 创建、编辑、删除、启用/禁用 Skill |

#### 6.2.2 多语言

| 需求 | 说明 |
|------|------|
| 默认语言 | 中文（zh-CN） |
| 支持语言 | 中文、English、日本語 |
| 切换方式 | 设置中选择，即时生效无需重启 |
| 翻译覆盖 | 所有 UI 文字必须走 i18n，不允许硬编码 |

#### 6.2.3 PWA 离线

| 需求 | 说明 |
|------|------|
| Service Worker | 缓存所有静态资源，离线可打开 App |
| 离线提示 | 离线时顶部显示黄色 banner "当前离线，消息将在联网后发送" |
| 队列发送 | 离线时发送的消息进入队列，联网后自动发送 |

---

## 七、极致性能优化

### 7.1 性能指标（硬性要求）

| 指标 | Web/PWA | Android | iOS | macOS | Windows | Linux |
|------|---------|---------|-----|-------|---------|-------|
| 冷启动 | FCP < 1.2s | < 800ms | < 600ms | < 500ms | < 1.0s | < 700ms |
| 热启动 | < 300ms | < 200ms | < 150ms | < 150ms | < 400ms | < 200ms |
| 首次可交互 | TTI < 2.0s | < 1.2s | < 800ms | < 700ms | < 1.5s | < 1.0s |
| 消息渲染 | < 16ms/帧 | < 16ms/帧 | < 16ms/帧 | < 16ms/帧 | < 16ms/帧 | < 16ms/帧 |
| 内存占用 | < 80MB | < 120MB | < 80MB | < 100MB | < 150MB | < 80MB |
| 滚动帧率 | 60fps | 60fps | 60fps | 60fps | 60fps | 60fps |

### 7.2 Web/PWA 性能优化

**构建优化**:
- Vite 6 + Rollup：Tree-shaking 移除所有未使用代码
- 代码分割：路由级 + 功能级 lazy loading
- 资源压缩：Brotli 压缩（比 gzip 小 15-20%）
- 图片：所有图标用 inline SVG，不加载图片文件
- 字体：Inter Variable 子集化（仅中英文常用字符），woff2 格式
- CSS：提取 critical CSS 内联到 HTML，其余异步加载

**运行时优化**:
- React 19 Compiler：自动 memo 化，减少不必要重渲染
- 虚拟滚动：消息列表超过 50 条时启用虚拟化（仅渲染可见区域 ± 5 条）
- Web Worker：Markdown 解析、加密运算放入 Worker 线程
- requestIdleCallback：非关键任务（预加载、统计）在空闲时执行
- 防抖/节流：输入框 onChange 防抖 150ms，滚动事件节流 16ms
- IndexedDB 批量写入：消息更新合并为单次事务

**加载策略**:
```
Critical Path（阻塞渲染）:
  1. HTML shell（< 5KB）
  2. Critical CSS（内联，< 3KB）
  3. React + 主包 JS（< 80KB gzip）

Non-Critical（异步加载）:
  4. 字体文件（swap 显示）
  5. 设置页 chunk
  6. 加密模块 chunk
  7. 同步模块 chunk
  8. i18n 语言包
  9. Service Worker 注册
```

**缓存策略**:
- 静态资源：content-hash 文件名 + Cache-Control: immutable
- Service Worker：Stale-While-Revalidate 策略
- IndexedDB：本地数据持久化，启动时直接读取

### 7.3 Android 性能优化

**启动优化**:
- App Startup Library：延迟初始化非关键组件
- Baseline Profile：预编译热路径（聊天页 Compose 布局）
- 启动画面：使用 SplashScreen API，冷启动时显示品牌图标
- 延迟加载：设置页、同步模块、加密模块按需初始化

**运行时优化**:
- Compose 性能：
  · 使用 `key()` 避免不必要的重组
  · LazyColumn 用于消息列表（自动回收）
  · `derivedStateOf` 减少状态变化传播
  · 避免在 Composable 中创建对象（提升到 remember）
- 内存：
  · 图片缓存使用 Coil（自动内存/磁盘缓存）
  · 大消息列表分页加载（每页 50 条）
  · 及时释放 Bitmap 引用
- 网络：
  · Ktor + OkHttp 引擎：连接池复用
  · 流式响应零拷贝读取

**包体优化**:
- 目标 APK 大小：< 8MB
- R8 全量混淆 + 资源缩减
- 仅包含 arm64-v8a + armeabi-v7a（覆盖 99% 设备）
- 移除未使用的 AndroidX 模块
- 图标使用 Vector Drawable（非 PNG）

### 7.4 iOS 性能优化

**启动优化**:
- 减少 dylib 数量（合并为单一 framework）
- 预热：`UIApplication.shared.beginBackgroundTask` 预加载数据
- 启动闭包最小化：仅初始化 UI + 数据库连接
- 后台预取：低优先级加载 Provider 列表和模型缓存

**运行时优化**:
- SwiftUI 性能：
  · `@Observable` 宏（iOS 17+）替代 ObservableObject，减少视图刷新
  · `LazyVStack` 用于消息列表
  · `.task` modifier 管理异步操作生命周期
  · `equatable()` 避免不必要的视图重绘
- 内存：
  · ARC 自动管理，注意避免循环引用（weak self）
  · 大文本使用 AttributedString 懒渲染
- 并发：
  · Swift Concurrency（async/await + TaskGroup）
  · 加密运算在后台 actor 执行
  · MainActor 仅用于 UI 更新

**包体优化**:
- 目标 IPA 大小：< 12MB
- Asset Catalog 优化：仅 @2x @3x（移除 @1x）
- 编译优化：-Osize（优化体积）
- 移除未使用的系统 framework

### 7.5 macOS 性能优化

**启动优化**:
- Universal Binary（Apple Silicon + Intel），但按架构分发
- 窗口恢复：记住上次窗口位置和大小
- 延迟加载设置窗口和同步模块

**运行时优化**:
- 同 iOS SwiftUI 优化
- 多窗口：每个窗口独立的状态作用域
- 大屏优化：消息列表宽度上限 720pt，避免过长行

**包体优化**:
- 目标 .app 大小：< 15MB（Universal）
- 代码签名 + 公证（Notarization）
- Hardened Runtime

### 7.6 Windows 性能优化

**启动优化**:
- WebView2 Runtime 预检：首次启动检测是否已安装
- 预创建 WebView2 环境：Application 启动时即初始化
- 本地资源加载：WebView2 加载 dist/ 目录（非网络请求）
- 窗口显示：先显示窗口壳（Mica 背景），再加载 WebView 内容

**运行时优化**:
- WebView2 与宿主通信：使用 `PostWebMessageAsJson` 最小化序列化开销
- 内存：WebView2 进程隔离，崩溃不影响宿主
- 渲染：启用 GPU 加速

**包体优化**:
- 目标 MSIX 大小：< 20MB（不含 WebView2 Runtime）
- WebView2 Runtime 由系统提供（Windows 11 内置）
- 仅打包 x64 + arm64

### 7.7 Linux 性能优化

**启动优化**:
- Rust 零成本抽象：编译期优化，无运行时开销
- 静态链接关键依赖：减少动态库查找时间
- 延迟初始化：GTK 窗口显示后再初始化网络和加密模块
- Profile-Guided Optimization (PGO)：基于实际使用模式优化

**运行时优化**:
- 异步运行时：tokio 多线程 runtime
- 零拷贝：流式响应直接写入 UI buffer
- 内存池：消息对象复用，减少分配
- GTK 主循环：所有 UI 更新通过 `glib::idle_add` 调度

**包体优化**:
- 目标二进制大小：< 10MB（strip + LTO）
- 编译选项：`opt-level = "z"` + `lto = true` + `strip = true`
- 依赖精简：仅链接必要的 GTK4/libadwaita 模块
- Flatpak 分发：共享运行时减少实际下载量

---

## 八、安全设计

### 8.1 加密方案

```
密钥派生:
  算法: PBKDF2-SHA256
  迭代: 600,000 次
  盐: 随机 16 字节（每设备独立）
  输出: 256-bit 密钥

数据加密:
  算法: AES-256-GCM
  IV: 随机 12 字节（每次加密独立）
  认证标签: 128-bit

存储:
  - API Key: 平台原生安全存储（Keychain/Credential Locker/Secret Service）
  - 同步数据: 加密后上传，远端只存密文
  - 本地数据: 明文存储在 IndexedDB/SQLite（设备级安全由 OS 保证）
```

### 8.2 安全规则

- 所有 API Key 必须使用平台原生安全存储，不得明文存储
- 同步密码不得以任何形式上传到远端
- Provider Base URL 必须校验：拒绝 HTTP、localhost、私网 IP、LAN 地址，以及 documentation/benchmark/multicast/reserved 等特殊用途 IP 地址
- Web 端 CSP 策略：禁止 inline script、限制 connect-src
- 所有用户输入必须转义后渲染（防 XSS）
- Markdown 渲染禁止执行 HTML 标签中的 JS

---

## 九、国际化

### 9.1 支持语言

| 语言 | 代码 | 优先级 |
|------|------|--------|
| 简体中文 | zh-CN | 默认 |
| English | en | P0 |
| 日本語 | ja | P1 |

### 9.2 实现要求

- 所有 UI 文字必须走 i18n 系统，不允许硬编码字符串
- 语言包按需加载（非默认语言懒加载）
- 日期/时间格式跟随 locale
- 数字格式跟随 locale
- 布局支持 RTL（为未来阿拉伯语预留）

---

## 十、可访问性

- WCAG 2.1 AA 对比度（文字 4.5:1，大文字 3:1）
- 所有交互元素可键盘访问（Tab 导航 + Enter/Space 激活）
- 屏幕阅读器支持：所有图标有 aria-label，动态内容有 aria-live
- 焦点可见：聚焦态有明确的视觉指示（品牌色外发光）
- 触摸目标：移动端最小 44x44px
- 动效：尊重 prefers-reduced-motion
- 颜色：不仅靠颜色传达信息（错误状态同时有图标+文字）

---

## 十一、部署与分发

| 平台 | 分发渠道 | 格式 |
|------|----------|------|
| Web/PWA | Cloudflare Pages / Vercel | 静态文件 |
| Android | Google Play + APK 直下 | AAB / APK |
| iOS | App Store | IPA |
| macOS | App Store + DMG 直下 | .app (Universal) |
| Windows | Microsoft Store + 官网 | MSIX |
| Linux | Flathub + AppImage | Flatpak / AppImage |

CI/CD 流程：
```
Push to main:
  - TypeScript 类型检查
  - ESLint
  - Vitest 单元测试 + 覆盖率
  - Playwright E2E
  - Bundle size check
  - 各原生平台编译检查

Release tag:
  - 所有上述 + visual audit + bundle size check
  - 自动构建各平台产物
  - 自动发布到各平台分发渠道
```

---

## 十二、质量门禁

以下检查必须全部通过才能合并到 main：

| 检查项 | 工具 | 阈值 |
|--------|------|------|
| TypeScript 类型检查 | tsc --noEmit | 0 errors |
| ESLint | eslint | 0 errors, 0 warnings |
| 单元测试 | vitest | 100% pass |
| 测试覆盖率 | vitest --coverage | services > 90% |
| Bundle 大小 | 自定义脚本 | 主包 < 80KB gzip |
| Lighthouse 性能 | lighthouse CI | > 95 |
| 可访问性 | axe-core | 0 violations |
| 安全检查 | 自定义脚本 | 0 findings |
| i18n 完整性 | 自定义脚本 | 所有 key 有翻译 |
| 原生编译 | 各平台 CI | 0 errors |

---

## 十三、里程碑

> 里程碑只记录当前产品目标与仍未关闭的真实发布门槛；逐次运行证据保留在被忽略的 `.manual-qa` 或 Actions artifacts。

### Phase 1: 基础重构

- [x] Web 生产入口、当前状态管理、核心服务测试与消息渲染已落地并由 release gate 守护。
- [x] 当前 Web 设计系统、PWA 离线能力、Provider/SSE 边界与本地加密存储已由源码合同覆盖。

### Phase 2: UI 升级

- [x] Onboarding、聊天、Settings overlay、响应式布局、暗色模式、可访问性与多语言已纳入当前 Web/Android 验收。

### Phase 3: 原生端补齐

- [x] Android 当前 emulator QA、云同步冲突/恢复/重启与原生合同测试已通过。
- [x] Apple、Linux、Windows 的源码级合同与本机可执行门禁保留；目标主机 runtime 证据仍按下方 blocker 管理。

### Phase 4: 质量收尾

- [x] Web/PWA 当前本地完整验证、覆盖率、浏览器 smoke、云/Gist 合同与资源清理已通过。
- [ ] 各平台包体大小优化
- [ ] 各平台 runtime QA

### Release 阻塞残项

- [ ] Apple iOS/iPadOS/macOS 目标 runtime build/visual/sync QA
- [ ] Linux GTK/Secret Service 目标 runtime build/visual/sync QA
- [ ] Windows trusted MSIX install/update/uninstall 当前 runtime QA
- [ ] Disposable live sync release-pass：当前 canonical Gist pass 的 source fingerprint 已过期；使用一次性 Cloudflare/Gist 凭据、throwaway sync passphrase 与 destructive confirmation 重跑 `pnpm run drill:live-sync`，并通过 `pnpm run check:live-sync-release-pass`。
- [ ] Hosted native CI 首次真实 push/PR 运行
- [ ] Live-provider full capability release evidence
- [ ] Live-provider Web UI browser-origin pass evidence

---

## 十四、各平台 UI 设计规范

### 14.1 Android（Kotlin / Jetpack Compose）

**设计语言**: Material Design 3 (Material You)

**布局**:
- 单栏布局为主，会话列表和聊天页通过导航切换（非分栏）
- 平板/折叠屏使用 Adaptive Layout：左侧会话列表 320dp + 右侧聊天
- 底部无导航栏，保持聊天沉浸感
- 输入框固定在底部，键盘弹出时自动上推（WindowInsets 处理）
- 状态栏透明，内容延伸到状态栏下方

**配色映射**:
```
Material You Dynamic Color:
  Primary → Brand Indigo (#6366F1)
  OnPrimary → White
  PrimaryContainer → Brand Soft (#EEF2FF)
  Surface → #FAFBFC
  SurfaceVariant → #F4F6F8
  Outline → #E5E7EB
  OutlineVariant → #F3F4F6

Dark Theme:
  Primary → #818CF8
  PrimaryContainer → #1E1B4B
  Surface → #0F1117
  SurfaceVariant → #1A1D27
```

**组件规范**:
- 消息气泡：用户消息 `PrimaryContainer` 底色右对齐，AI 消息 `Surface` 底色左对齐
- 输入框：`OutlinedTextField`，圆角 28dp，高度自适应 1-5 行
- 发送按钮：`FilledIconButton`，圆形，Primary 色
- 会话列表：`LazyColumn` + `ListItem`，滑动删除（SwipeToDismiss）
- 顶部栏：`TopAppBar`（Medium），显示会话标题 + Model 选择
- 设置页：`Scaffold` + `NavigationDrawer` 或 `LazyColumn` 分组
- 底部 Sheet：Provider 选择、Model 选择用 `ModalBottomSheet`

**交互**:
- 下拉刷新同步（PullToRefresh）
- 长按消息弹出操作菜单（复制、编辑、重新生成、删除）
- 返回手势：系统预测性返回动画
- 分享：可将 AI 回复分享到其他 App

**字体**:
- 使用系统默认（Roboto / Noto Sans CJK）
- 代码块用 JetBrains Mono（bundled，仅 Regular 权重）

**特殊要求**:
- 支持 Android 13+ 的 Themed Icon
- 支持 Android 14+ 的 Predictive Back
- 最低支持 Android 8.0 (API 26)
- 支持 Dynamic Color（Android 12+）
- 通知渠道：同步状态通知
- Widget：快速发起新对话（可选）

---

### 14.2 iOS（Swift / SwiftUI）

**设计语言**: Apple Human Interface Guidelines (iOS 17+)

**布局**:
- iPhone：单栏导航（NavigationStack），会话列表 → 聊天页
- iPad：NavigationSplitView，侧边栏(320pt) + 聊天区
- 输入框固定底部，键盘弹出时自动上推
- 安全区域适配（刘海、灵动岛、Home Indicator）

**配色映射**:
```
iOS 语义色:
  .tint → Indigo (#6366F1)
  .background → systemBackground
  .secondaryBackground → secondarySystemBackground
  .groupedBackground → systemGroupedBackground

自定义色（Asset Catalog, Any/Dark）:
  BrandPrimary: #6366F1 / #818CF8
  BrandSoft: #EEF2FF / #1E1B4B
  BrandBorder: #A5B4FC / #4338CA
```

**组件规范**:
- 消息气泡：用户消息品牌色底右对齐，AI 消息系统灰底左对齐
- 输入框：圆角容器（cornerRadius 22），1-5 行自适应
- 发送按钮：圆形，SF Symbol `arrow.up`，品牌色底
- 会话列表：`List` + `.swipeActions`（删除、置顶）
- 导航栏：`.navigationBarTitleDisplayMode(.inline)`
- 设置页：`Form` + `Section`，iOS 原生分组样式
- 搜索：`.searchable` modifier

**交互**:
- 下拉刷新同步
- 长按消息弹出 Context Menu（复制、编辑、重新生成、删除）
- 3D Touch / Haptic Touch 预览
- 键盘快捷键（外接键盘）：Cmd+N 新建，Cmd+Enter 发送

**字体**:
- SF Pro（系统默认），代码块用 SF Mono
- 支持 Dynamic Type（尊重系统字号设置）

**特殊要求**:
- 支持 iOS 17+ 的 TipKit（首次使用提示）
- 支持 ShareExtension（从其他 App 分享文本到 ZeroChat）
- 支持 Spotlight 搜索（会话标题可搜索）
- Keychain 存储 API Key
- 支持 iPad 多任务（Split View、Slide Over）
- 最低支持 iOS 16

---

### 14.3 macOS（Swift / SwiftUI + AppKit）

**设计语言**: macOS Human Interface Guidelines (macOS 14+)

**布局**:
- 三栏布局：侧边栏(240pt) + 会话列表(280pt) + 聊天区
- 或双栏：侧边栏(280pt，含会话列表) + 聊天区
- 支持多窗口（每个窗口独立会话）
- 支持 macOS 原生 Tab（窗口合并）
- 最小窗口尺寸 900x600
- 支持全屏模式

**配色**: 同 iOS，使用 Asset Catalog 的 Any/Dark appearance

**组件规范**:
- 侧边栏会话列表：原生 `List` + `.sidebar` 样式，选中态系统高亮
- 消息气泡：同 iOS 设计，但宽度上限更大（max 720pt）
- 输入框：底部固定，圆角容器，支持多行（最多 8 行后滚动）
- 工具栏按钮：使用 SF Symbols，`.toolbar` 标准位置
- 设置窗口：独立窗口，`TabView` 分页（外观、AI 服务、模型、技能、同步、数据）
- 右键菜单：消息右键弹出操作（复制、编辑、重新生成、删除）

**交互**:
- Cmd+N 新建会话
- Cmd+W 关闭窗口
- Cmd+, 打开设置
- Cmd+K 搜索会话
- Cmd+Enter 发送消息
- Cmd+. 停止生成
- 拖拽文件到输入框（未来：附件功能）
- Touch Bar 支持（如果有）：发送按钮、停止按钮

**字体**:
- SF Pro（系统默认），代码块用 SF Mono
- 尊重系统字号设置

**特殊要求**:
- 支持 macOS Sonoma+ 的 Desktop Widget（快速提问）
- 支持 Notification Center 通知（同步完成）
- 支持 Handoff（iPhone 上的会话在 Mac 上继续）
- 菜单栏图标（MenuBarExtra，快速发起新对话）
- Keychain 存储 API Key
- 沙盒化（App Store 分发）
- Universal Binary（Apple Silicon + Intel）
- 支持 Stage Manager

---

### 14.4 Windows（C++ / WinUI 3 + WebView2）

**设计语言**: Windows 11 Design (WinUI 3 / Fluent Design)

**策略**: Windows 端使用 WinUI 3 作为宿主窗口，通过 WebView2 加载 Web/PWA 界面。
视觉效果直接复用 Web 端设计系统，宿主提供原生窗口体验。

**宿主窗口要求**:
- 标题栏：自定义标题栏，融入 Mica/Acrylic 材质
- 窗口圆角：跟随 Windows 11 系统圆角
- 最小窗口尺寸 800x500
- 支持 Snap Layout（窗口分屏）
- 支持深色/浅色模式跟随系统
- 系统托盘图标（最小化到托盘，右键菜单：打开/新对话/退出）

**原生集成**:
- Windows Credential Locker 存储 API Key（通过 JS ↔ C++ 桥接）
- Windows 通知中心（同步状态）
- 启动时自动加载 WebView2 Runtime
- MSIX 打包，支持 Microsoft Store 分发
- 支持 Windows Hello（可选：解锁加密数据）

**WebView2 桥接**:
- JS → C++：密钥存取、文件选择器、系统通知、窗口控制
- C++ → JS：系统主题变化、窗口状态变化
- WebView2 加载本地 dist/ 目录（非远程 URL）
- 离线可用（所有资源本地打包）

**性能要求**:
- WebView2 进程预创建，窗口显示时内容已就绪
- 最小化到托盘时释放 WebView2 渲染资源
- 支持 GPU 加速渲染

---

### 14.5 Linux（Rust / GTK4 + libadwaita）

**设计语言**: GNOME Human Interface Guidelines (libadwaita)

**布局**:
- `AdwNavigationSplitView`：侧边栏(280px) + 内容区
- 窄窗口时自动折叠为单栏导航（libadwaita 自适应）
- 使用 `AdwHeaderBar` 替代传统标题栏
- 设置页使用 `AdwPreferencesWindow`

**配色映射**:
```
libadwaita 语义色:
  @accent_color → Indigo (#6366F1)
  @accent_bg_color → #6366F1
  @accent_fg_color → #FFFFFF
  @window_bg_color → #FAFBFC (light) / #0F1117 (dark)
  @view_bg_color → #FFFFFF (light) / #1A1D27 (dark)
  @headerbar_bg_color → #F8F9FB (light) / #141720 (dark)
  @card_bg_color → #FFFFFF (light) / #1A1D27 (dark)

自定义 CSS（通过 GtkCssProvider）:
  .message-user { background: #EEF2FF; border-radius: 14px; }
  .message-ai { background: @view_bg_color; border: 1px solid @borders; }
```

**组件规范**:
- 会话列表：`GtkListBox` + `AdwActionRow`，选中态使用 accent 色
- 消息列表：`GtkListBox` 或 `GtkScrolledWindow` + 自定义 widget
- 输入框：`GtkTextView`，多行，圆角容器包裹
- 发送按钮：`AdwButtonContent`，圆形，accent 色
- 设置窗口：`AdwPreferencesWindow` + `AdwPreferencesGroup`
- 对话框：`AdwMessageDialog`（确认删除等）

**交互**:
- Ctrl+N 新建会话
- Ctrl+W 关闭窗口
- Ctrl+, 打开设置（如果 GNOME 支持）
- Ctrl+Enter 发送
- 右键菜单：`GtkPopoverMenu`

**字体**:
- 系统默认（Cantarell / Noto Sans CJK）
- 代码块用 Source Code Pro 或 JetBrains Mono

**特殊要求**:
- 遵循 XDG 目录规范（数据存 ~/.local/share/zerochat/）
- Secret Service D-Bus API 存储 API Key
- 支持 GNOME 暗色模式偏好（`org.freedesktop.appearance color-scheme`）
- Flatpak 沙盒兼容
- 支持 Wayland + X11
- 最低 GTK 4.12 + libadwaita 1.4

---

## 附录 A：Provider 预设列表

| Provider | 协议 | 默认 Base URL | 图标色 |
|----------|------|---------------|--------|
| OpenAI | OpenAI Chat/Responses | https://api.openai.com/v1 | #10A37F |
| Anthropic | Anthropic Messages | https://api.anthropic.com | #D97757 |
| Google Gemini | OpenAI Compatible | https://generativelanguage.googleapis.com/v1beta | #4285F4 |
| DeepSeek | OpenAI Compatible | https://api.deepseek.com/v1 | #4D6BFE |
| xAI (Grok) | OpenAI Compatible | https://api.x.ai/v1 | #000000 |
| OpenRouter | OpenAI Compatible | https://openrouter.ai/api/v1 | #6B5CE7 |
| Mistral | OpenAI Compatible | https://api.mistral.ai/v1 | #F97316 |
| Groq | OpenAI Compatible | https://api.groq.com/openai/v1 | #F55036 |
| Together AI | OpenAI Compatible | https://api.together.xyz/v1 | #0EA5E9 |
| Perplexity | OpenAI Compatible | https://api.perplexity.ai | #20B2AA |

---

## 附录 B：CSS Token 完整参考

所有 CSS 变量、布局和动画定义在当前生产 `src/app/app.css` 的 `:root` 与 `[data-theme='dark']` 中，主题解析由 `src/app/theme.ts` 负责。视觉行为以当前组件树和 `scripts/visual-audit.mjs`、`scripts/web-current-page-qa.mjs` 的真实浏览器截图为准；修改样式必须重新跑视觉审计并检查桌面、移动、RTL 和 Windows WebView，不再通过静态 HTML/CSS 副本验收。

---

## 附录 C：包体大小预算

| 平台 | 目标大小 | 包含内容 |
|------|----------|----------|
| Web/PWA | 主包 < 80KB gzip，总资源 < 300KB | JS + CSS + 字体子集 |
| Android APK | < 8MB | Kotlin + Compose + Ktor |
| iOS IPA | < 12MB | Swift + SwiftUI |
| macOS .app | < 15MB (Universal) | Swift + SwiftUI + AppKit |
| Windows MSIX | < 20MB | WinUI 3 + Web dist（不含 WebView2 Runtime） |
| Linux Flatpak | < 10MB（不含共享运行时） | Rust + GTK4 |

---

*文档结束。本文档是 ZeroChat 项目的唯一实现依据。*
- [x] Windows MSIX clear-host 历史审计与当前阻塞分离（2026-07-20 Asia/Shanghai）：host preflight 已能把历史 AppX cleanup 事件与当前目标存在性分开，但 downstream release blocker 自检仍要求 `status=clear` 时 `matchedEventIds` 必须为空，与上游“resolved target 保留历史 event audit context”的 self-test 直接冲突。现在 release blocker 显式携带 `historicalCleanupFailureDetected / resolved / currentPresence` 和 target count；clear 仅在无历史事件，或历史事件对应的全部安全目标均可靠确认为 `absent` 时成立，历史 event/package/failure-code 继续保留用于审计但不再冒充当前 host blocker。focused checker fixture、release-blocker 自检和 completion audit 独立锁定两种 clear 状态。QA marker: Clear Windows MSIX host summaries retain resolved historical cleanup audit context. 这是诊断真值修复，不替代 elevated trusted install/update/uninstall release evidence。
- [x] 同版本 relay 模型优先级跨端一致（2026-07-19 Asia/Shanghai）：根因是数字版本相同时按字典序选择，`gpt-5.6-luna` 会压过同版本的 frontier/balanced 变体，无法满足“优先最先进模型”的目标。现在 Web/Node、Android、Apple、Linux、Windows 以及 API/UI smoke 统一按 `sol > terra > luna` 选择同版本变体，只有真实请求失败才回退；Windows 原生 contract 11/11 也锁定该排序，Windows Release x64 C++ 实编译为 0 warnings / 0 errors，WebView runtime 的 42 个资源与当前 dist 一致。历史 full-capability drill 曾先尝试 `gpt-5.6-sol`，失败后回退 `gpt-5.6-terra` 并完成 chat；当前 live-provider 状态、失败能力、报告 hash 与时间统一由 current evidence overlay 生成，不在此重复。QA marker: Same-revision relay model variants prefer frontier sol before terra/luna and fall back only after a real request failure.
- Windows same-revision relay variants prefer frontier sol before terra/luna and fall back only after a real request failure.
- 当前 live-provider 状态、失败能力、报告 hash 与时间由 `Current diagnostic overlay` 根据 `.manual-qa/release-diagnostics-current.json` 和 `.manual-qa/release-blockers-current.json` 生成；本条模型选择记录不复制可变诊断证据，避免刷新报告后出现文档漂移。
- [x] Live-sync 演练命令行 fail-closed（2026-07-23 Asia/Shanghai）：根因是环境驱动的 `scripts/live-sync-release-drill.mjs` 原先完全忽略命令行参数，操作员在已配置 disposable 凭据的终端输入 `--help` 仍可能直接进入远端演练。现在仅单独的 `--help`/`-h` 会在读取环境、写入报告或触及远端前输出说明；任何未知或组合参数统一以不回显输入的错误退出。`check:live-sync-drill` 在看似已配置但本地拒绝的临时环境下验证 help、未知和组合三种调用均没有报告输出，因而不能产生远端副作用。 这是 disposable live-sync 破坏性演练的操作安全加固，不替代真实 Cloudflare/Gist release-pass、Apple/Linux target runtime、Windows trusted MSIX、hosted CI 或全能力 Provider release evidence。
- [x] Linux stop/resend stream ownership 防漂移（2026-07-25 Asia/Shanghai）：根因是请求 A 停止后，请求 B 已取得 active stream，但迟到的 `Done(A)` 无条件 `take()`，会夺走 B 的所有权并让 B 永久停在 streaming。`chat_send_actions.rs` 现在只允许与 `assistant_message_id` 匹配的完成事件原子取得 active stream，chat/image 两条完成路径共用该边界；确定性交错测试锁定 `start A -> stop A -> start B -> Done(A) -> Done(B)`。Windows host 上 `check:linux-fmt` 与 `check:linux-packaging` 通过；Linux GTK target runtime 仍必须在合格 Linux host 上完成，不以本条替代。QA marker: Linux stale chat completions cannot take replacement stream ownership.
- [x] Web Provider/Model 菜单提示键盘所有权（2026-07-25 Asia/Shanghai）：根因是首次提示的关闭按钮位于 `role="menu"` 内，却不是菜单项，箭头导航无法到达，Tab 又会关闭菜单。提示关闭按钮现在以 `menuitem` 参与统一菜单选择器，说明文本通过 `aria-describedby` 关联；菜单控制器在下一帧解析首项，关闭后焦点续接到仍存在的菜单项。组件单测与真实 Chromium smoke 证明键盘聚焦触发器后按 Enter 打开、提示取得首焦点、再按 Enter 关闭时菜单保持打开且焦点仍在菜单项。QA marker: Provider model menu hints stay keyboard-navigable.
- [x] Apple Provider 删除事务一致性（2026-07-26 Asia/Shanghai）：删除不再由编辑器先清 Keychain、再异步提交快照。`SnapshotStore` 在 actor 内比较持久化观察值并保存候选；ViewModel 等待已有保存队列，捕获 revision，清除密钥后执行 CAS，只在 CAS 和 revision 复检都成功后发布 Provider/会话迁移并触发同步。CAS 拒绝、写入失败或并发 revision 漂移会恢复最新快照，并且只在密钥仍为空且当前快照仍拥有该 Provider 时恢复旧密钥，避免覆盖用户并发写入。该边界是进程内失败与竞争的补偿事务，不宣称跨 Keychain/文件系统的崩溃级 ACID。QA marker: Apple Provider deletion publishes only after snapshot CAS and conditionally compensates Keychain.
- [x] 当前源码 Provider 浏览器链路 release-pass（2026-07-26 Asia/Shanghai）：使用 Wrangler temporary HTTPS Worker 承载一次性 Provider Key 与严格 origin/host allowlist，浏览器仅保存随机一次性数据口令派生的 Worker access key，Provider Key 注入为 false。真实 Chromium 完成首次配置、发送一条消息、收到唯一 marker 并生成脱敏截图；报告与 attempt 报告均为 `passed / safeToPublish / releaseEvidence`，且 source fingerprint 与当前 Web/Worker/演练源码一致。Wrangler 临时凭据清理失败会使演练失败。QA marker: Current-source live-provider browser UI passes through a temporary Worker without browser Provider keys.
- [x] Android Provider 凭据事务与崩溃恢复（2026-07-26 Asia/Shanghai）：普通密钥输入现在每次变化都进入应用根层的串行保存队列，并通过 repository CAS 提交带单调时间戳的快照，再在 `NonCancellable + Dispatchers.IO` 中提交 `EncryptedSharedPreferences`；CAS 拒绝不写密钥，revision 漂移或密钥写失败会补偿快照，错误在设置页内本地化提示。Provider 删除先原子写入 pending credential intent，再通过 repository CAS 提交会话迁移快照，最后一次提交同时删除密钥和 intent；CAS 拒绝、可见 revision 漂移或密钥完成失败会补偿快照/intent。启动时按持久化快照是否仍包含 Provider 决定取消 intent 或完成密钥清理，因此进程可在任一步退出而不永久丢失仍在使用的密钥或遗留已删除 Provider 的密钥。QA marker: Android Provider credentials auto-save on input and deletion recovers across snapshot/keystore crashes.
- [x] Android 同步凭据显式保存与快照补偿（2026-07-26 Asia/Shanghai）：GitHub Token 输入现在只修改 Compose 内存草稿，用户点击保存后才由应用根层在串行队列的 `NonCancellable + Dispatchers.IO` 段提交加密存储，失败保留草稿并在设置页提示，彻底移除逐键主线程写盘。远端模式下同步口令保存先对带单调 `updatedAt` 的快照执行 repository CAS，复核可见 revision 后再写加密凭据；CAS 冲突不写口令，revision 漂移或凭据失败会补偿快照，成功发布后才排队自动同步。本地模式不制造无意义快照，只串行提交凭据。共享事务保留取消语义并由确定性测试覆盖。QA marker: Android sync credentials save explicitly off the main thread and compensate snapshot failures.
- [x] Android 本地重置跨存储崩溃恢复（2026-07-26 Asia/Shanghai）：根因是旧实现先清空 `EncryptedSharedPreferences`、再保存默认快照，进程在两步之间退出会永久丢失仍由旧快照引用的 Provider 密钥、GitHub Token 与同步口令，而且加密偏好 I/O 仍可能阻塞 Compose 主线程。现在重置先在一次加密偏好提交中把所有凭据及 Provider 删除待办封装为恢复记录并清空活动凭据，再以 repository CAS 提交默认快照，最后清除恢复记录；启动按源/候选快照的确定性 SHA-256 指纹恢复旧凭据或完成清除，未知快照拒绝猜测。自动同步在事务期间排他排空，revision 漂移、CAS/磁盘失败与凭据完成失败均有补偿；损坏快照恢复模式在替换写入前失败时恢复凭据，替换写入后清理失败则保留待办供下次启动完成。UI 只等待根事务并在完成前禁用重复重置，所有加密存储操作都位于 `NonCancellable + Dispatchers.IO`。QA marker: Android local reset recovers credentials across snapshot/keystore crashes.
- [x] Android 加密备份导入跨存储崩溃恢复（2026-07-26 Asia/Shanghai）：根因是旧导入控制器先逐把覆盖 `EncryptedSharedPreferences` 中的 Provider 密钥，再保存导入快照，只有当前进程内的 `catch` 能回滚；进程在两种存储之间退出会让旧快照永久配上新密钥，而且事务使用的是 Compose 捕获的旧 `snapshot`。现在文件选择器只负责解密并把 snapshot/key map 交给应用根层；根层排空自动同步、进入进程级快照队列，从最新源快照构造单调候选和完整 Provider ID 集合。SecretStore 用一次加密偏好提交同时写入规范化新密钥与包含旧/新密钥、源/候选指纹的 durable intent，随后 repository CAS 提交候选，最后清除 intent；CAS 拒绝、可见 revision 漂移、快照/密钥收尾失败均按当前持久化快照补偿。启动在任何 UI 或快照规范化前按 raw snapshot 指纹恢复旧密钥或保留新密钥，未知快照拒绝猜测；损坏快照无法加载时恢复旧密钥，显式恢复导入则把 intent 保留到替换快照真正落盘。QA marker: Android backup import recovers Provider keys across snapshot/keystore crashes.
- [x] Partial strict preflight 范围隔离与 Gist release-pass（2026-07-28 Asia/Shanghai）：真实 disposable Gist 演练已完成首次上传、第二设备拉取、编辑上传/拉取、删除上传/拉取和远端清空；新建 secret Gist 在读回确认清空后被删除，账户匹配残留为 0，脱敏报告无 token、URL 或环境变量名。随后 `verify:release:live-sync` 暴露状态机根因：仅请求 live-sync 的 strict pass 被当成全证据 pass，错误关闭未请求的 Windows/hosted-CI/provider baseline，并且 checkpoint 只保留变体命令而缺基线 release rerun。`release-blocker-state` 现在按 `requestedEvidence` 覆盖范围闭合、与当前 source-derived candidates 求交，未知/矛盾范围 fail closed；CLI 纯函数同时返回精确 `verify:release:live-sync` 与基线 `verify:release`。确定性测试覆盖 partial pass、partial failure、候选交集及命令映射。QA marker: Partial strict preflight passes close only their requested release evidence. 这关闭 disposable live-sync blocker，但不替代 Apple/Linux target runtime、Windows trusted MSIX、hosted native CI 或 provider full-capability release evidence。
- [x] Web 音频转写上传格式与大小边界（2026-07-28 Asia/Shanghai）：根因是旧规则把任意 `audio/*` / `video/*` 当成可转写输入，只解决 hover/drop 一致性，却会让 MIDI、QuickTime 等端点不支持的文件进入网络请求，并且完全没有本地 25 MB 上限。现在 `audioAttachments.ts` 以单一严格契约只接受 MP3、MP4、MPEG/MPGA、M4A、WAV 与 WebM，导出同源 browser `accept` 值，并在 picker、可判定的 drag affordance、drop、提交前和底层 adapter 请求前统一拒绝不支持格式及超过 25,000,000 bytes 的文件；过大与格式错误分别走本地化 warning，全部 10 个 Web locale 的提示明确格式、大小和“转写先留在草稿”。7 个 focused test files / 57 tests、TypeScript、focused ESLint 与 i18n 检查通过；当前源码 `qa:web-current` 再通过生产构建、browser smoke、118/118 视觉帧和 artifact validation，四个音频窄视口帧及总联系表肉眼复核无重叠或裁切。Bundle 仍在门内：first load 109.99 KiB gzip、total static 295.96 KiB gzip、entry 78.18 KiB gzip。QA marker: Audio transcription uploads reject unsupported formats and files above 25 MB before network dispatch. 这不宣称当前外部 Provider 已提供可用的 audio transcription route，也不替代 native target runtime、hosted CI 或 trusted MSIX release evidence。
- [x] Worker 上游 HTML 响应来源可审计（2026-07-28 Asia/Shanghai）：根因是临时 Worker 已通过精确部署就绪探针后，上游仍可能向 Worker 出口返回通用 HTML 404；旧烟测没有可验证的转发来源，只能把它误报成宿主机 `/models` 不可达。现在 Worker 仅对真正完成上游 `fetch` 的响应写入固定 `X-ZeroChat-Proxy-Response-Source: upstream`，并通过 CORS 暴露该固定值和受限的 edge 分类；Worker 自己生成的鉴权、参数与路由错误绝不携带该标记，原始 `Server`、`CF-Ray`、URL 和标识符仍不外泄。UI 预检据此把通用 HTML 明确归为 Provider/relay 对 Worker 出口的上游阻塞，并保留“直连宿主机成功不能证明 Worker 出口可达”的证据边界。QA marker: ZeroChat proxy upstream HTML failures retain safe response provenance. 这是诊断归因修复，不宣称当前 relay 已允许 Worker 出口，也不替代全能力 Provider release-pass。
- [x] Live-provider 浏览器控制超时与产品网络边界对齐（2026-07-28 Asia/Shanghai）：真实临时 Worker 已通过部署签名，Node 预检和浏览器 `/models`/chat 均返回 200，但首配仍显示“正在检查”时，共享 CDP 的默认 20 秒命令上限先于产品 60 秒聊天请求边界终止 `Runtime.evaluate`。共享 CDP 现在保留普通命令 20 秒默认值，同时允许调用点提供单条有界 deadline；UI app-ready 等待使用 40 秒，完整首配/发送/marker 流程使用 360 秒，首配连接结果等待为 90 秒，确保页面自己的有界错误或成功先结算。`scripts/browser-cdp.mjs` 也已加入 UI source fingerprint roots，控制层变化会使旧浏览器证据失效。QA marker: Live-provider browser flows outlive their bounded in-page network waits. 这只修复演练控制真值，不把 Node 预检或 HTTP 200 冒充浏览器 marker release-pass。
