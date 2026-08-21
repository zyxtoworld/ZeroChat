# QA Audit

QA marker: Temporary Worker deployment credentials use an explicit one-shot token input and delete the temporary Worker without global Wrangler logout.

# 当前 Web 审计权威与历史证据边界

> 生产页面唯一入口为 `index.html -> src/app/bootstrap.tsx`。当前 Web 发布审计只认生产可达的 `src/app/**`、共享 `src/services/**`、`src/workers/**`、`src/storage/**`、`src/platform/**` 及当前合同测试；`src/services/syncRuntimeController.ts`、旧 `src/components/**`、旧 App shell、旧 settings/provider/visual controller 及其专用测试已经不可达或删除。历史段落中的旧路径、覆盖率、测试数量和“现在/当前”描述均标记为 superseded 语义，不是当前 checkpoint。

> 映射：同步 owner/generation、pending strategy、secret/AppData 生命周期、Provider 删除与 clear/reset/import 统一由 `src/app/store.ts`、`src/app/__tests__/store.test.ts` 和 `scripts/current-web-sync-contract.mjs` 证明；当前视觉/浏览器行为由 `scripts/visual-audit.mjs`、`scripts/browser-skill-smoke.mjs` 和真实生产图证明；非 UI/native、安全、CI、发布证据合同仍必须由当前对应 source/checker 证明。历史记录保留用于追溯，但不能因旧 controller marker 通过而使当前发布变绿。

> **SUPERSEDED_WEB_CONTROLLER_HISTORY**：本审计中任何后续历史段落若出现 `syncRuntimeController`、`src/services/*Controller.ts`、`src/components/**`、旧 App shell、旧 startup bundle 或其专用测试/覆盖率数字，即使保留“now/current/现在/当前”原文，也只能解释为 superseded 历史证据；current checkpoint、生产可达图和发布 gate 不得读取这些旧路径作为现行实现证明。当前 Web 同步、Skill、Settings 和生成边界只认 `src/app/**`、共享生产可达模块、当前行为测试、`current-web-sync-contract` 与真实生产图。协议/API/schema 的合法版本字段不属于前端代际叙事。

> 运行时副作用映射：旧 `appRuntimeController` 的历史条目不再描述现行文件。当前 system-language/locale ownership 在 `src/app/App.tsx` + `src/app/store.ts`，主题与 `theme-color` 在 `src/app/theme.ts`，按网络条件执行的 idle lazy warmup 在 `src/app/runtimeWarmup.ts`，代理 access-key 派生在当前 store 用户动作边界复验 credential owner 并收口稳定通知；`store.test.ts`、`i18n-theme.test.ts`、`runtime-warmup.test.ts` 和 `current-web-app-shell-contract` 是现行可执行证据。
>
> 聊天生成映射：当前 `src/app/store.ts` 统一拥有文字、图片、朗读、音频转写、消息删除与离线重放生命周期，所有生产能力复用生产可达的 `src/services/chatGenerationRuntime.ts` 三次可取消自动重试；`src/services/offlineQueue.ts` 只拥有 queued snapshot、精确 prompt、captured Provider/model、claim 与终态 metadata 的纯规则。普通离线文本只有在完整 queued snapshot 持久化后才返回成功，保存失败保留 Composer 输入，离线图片附件在入队前被本地化阻止。图片提交只在 durable accepted 后清理本次提交拥有的草稿与源图；等待期间用户输入的新草稿或新选图片保留。音频转写在代理 token 派生前领取可取消 owner，重复提交被拒绝，Stop 或会话切换后即使 Provider 晚到也不应用；成功结果只追加到完成时的最新 Composer 草稿。消息删除先本地化确认，再在共享 lifecycle lane 中持久化目标签名与 queued prompt/assistant 对；保存失败或并发修改时保留当前消息，成功后才发布并排自动同步。停止操作优先 abort 当前 owner；若 owner 已丢失但快照仍有 streaming 消息，则按调用时签名在同一 lifecycle lane 中持久化终态，保存失败保持 streaming 状态，不伪装成功。重放先 durable 处理 orphan/Provider/key/model 预检，再持久化独占 claim；冲突恢复后只有最终持久化 owner 可以派生当前 proxy token 并调用 Provider。在线 relay 与离线重放都在首个异步凭据边界前领取可取消 owner；成功、失败或掉线回队的终态都先持久化并清除 claim，成功终态保存失败时禁止同步。在线事件的 detached replay 拒绝由当前事件边界收口为开发诊断和稳定本地化提示，speech object URL 回收异常不能卡住播放状态。`src/app/composerSubmission.ts` 保留草稿并收口 React 提交拒绝。现行证据是 current store/runtime/Composer/纯规则行为测试、生产可达图与 current app-shell 逐 marker 变异；旧 `chatGenerationController.ts`、`chatGenerationTextSubmit.ts`、`chatGenerationOfflineQueue.ts`、`chatGenerationMessageActions.ts`、`chatGenerationMessageReruns.ts`、`chatGenerationStop.ts`、`chatGenerationImageSubmit.ts`、`chatGenerationAudioTranscription.ts` 及其专用测试只属于 superseded 历史记录。QA marker: Web/PWA src/app/store.ts owns confirmed and durable message deletion in the production store. QA marker: Web/PWA current store tests lock queued-turn deletion, title repair, save failure rollback, and concurrent-edit ownership. QA marker: Web/PWA src/app/store.ts owns durable stale-stream termination in production. QA marker: Web/PWA current store tests lock durable stale-stream stop success and save-failure preservation.

Current Web audio transcription is owned by the production store and Composer boundary. The current authority is `src/app/store.ts`, `src/app/components/Composer.tsx`, `src/app/composerSubmission.ts`, `src/app/__tests__/store.test.ts`, and `src/app/__tests__/composer-submission.test.ts`. Current Web store and composer tests lock transcription owner, cancellation, and latest-draft writeback.

Current Web image submission is owned by the production store and Composer boundary. The current authority is `src/app/store.ts`, `src/app/components/Composer.tsx`, `src/app/composerSubmission.ts`, `src/app/__tests__/store.test.ts`, and `src/app/__tests__/composer-submission.test.ts`. Current Web store and composer tests lock durable image submission and input ownership.
>
> 不可达 Web 辅助链映射：`src/services/chatGenerationAssistantRun.ts`、`chatGenerationSubmitPersistence.ts`、`generationRequirements.ts`、`generationOwnership.ts`、`composerReadiness.ts`、`composerChrome.ts`、`composerFocus.ts`、`conversationTitleEdit.ts`、`actionGate.ts`、`chatModelMenu.ts`、`chatSessionState.ts`、`dangerConfirmation.ts`、`providerConnectivityFocus.ts`、`providerModelCatalogMutation.ts`、`providerModelCatalogUpdater.ts`、`sidebarChrome.ts`、`syncChrome.ts`、`src/app/settingsTypes.ts` 及其专用测试已由当前 `src/app/store.ts`、`Composer.tsx`、`ChatView.tsx`、`SettingsView.tsx`、`Sidebar.tsx`、`composerSubmission.ts`、生产可达共享 helper 和现行行为测试取代；下文相关路径、测试数和“当前”措辞只保留历史追溯意义，不能作为生产或发布权威。
>
> Settings 对话框焦点映射：当前唯一 `SettingsView` dialog 通过生产可达 `settingsDialogFocus.ts` 处理首尾、根节点和外部焦点的 Tab/Shift+Tab 环回，通过 `settingsFocusOwnership.ts` 管理打开/关闭 owner，并复用 `interactionFocus.ts` 收口 detached 或拒绝聚焦。纯规则测试、current app-shell mutation 与隐藏 Chromium 根节点按键断言是现行证据；旧 `modalFocus*`、Guide/Danger/first-sync modal controller 记录均为 superseded。
>
> Settings Data 映射：当前 `SettingsView.tsx` 与 `settingsDataAction.ts` 只在原生确认成功后同步领取一个 Data action owner；重复入口不执行。pending 时导航、header、内容均为原生 inert/busy，inert 外的 polite status 获得焦点，取消确认保持触发按钮。当前 store 导出只使用一个 AppData/Provider-key/passphrase 快照并将任意原始失败收口为稳定本地化通知；导入先验证 canonical sync vault，再通过 recoverable Provider-secret/AppData transition 发布；reset/import/sync/secret 共用 durable lifecycle lane。`downloadJsonFile.ts` 及其直接测试证明临时 anchor、timer 和 object URL 的成功/失败清理，隐藏 Chromium 通过真实 Data reset 按钮阻塞旧 AppData 加密写入并观察 pending/focus/最终 durable reset。旧 `settingsDataController*`、runtime/loader、`settingsActions.ts` 和专用测试仅是 superseded 历史证据。Current backup actions snapshot data, Provider keys, and passphrase coherently. QA marker: Current Settings Data action ownership keeps the production dialog inert, announced, and focus-stable.
>
> 用户错误呈现映射：旧 `appMessageController` 及其专用测试仅是历史证据。当前权威是生产可达的 `src/app/errorPresentation.ts`、`src/app/store.ts` 与 `src/app/components/SettingsView.tsx`：Provider 错误码本地化、URL/secret 脱敏、detached local-save 稳定通知和持久化同步状态翻译均由当前 store/component 行为测试与 `current-web-app-shell-contract` 约束；旧路径存在与否都不能使门禁变绿。
>
> 通知与密钥输入映射：旧 `appNoticeController`、`secretInputRenderer` 及其专用测试只保留为历史记录。当前通知由 `src/app/store.ts` 的有界队列和根级 `src/app/components/Toast.tsx` 统一呈现；Provider key、GitHub token、同步口令由当前 `src/app/components/SecretInput.tsx` 统一掩码与显隐语义。当前组件/store 测试、`current-web-app-shell-contract` 和后台 browser smoke 是可执行证据。QA marker: Current notice and secret-input authority lives only in the production app store and components.
>
> 会话搜索映射：当前 Sidebar 通过生产可达 `src/app/conversationSearch.ts` 复用共享归一化逻辑，覆盖标题、模型、消息正文；无结果时发布 polite status、可见说明与清除动作，清除后恢复完整列表。纯函数测试、current app-shell mutation contract 与后台 Chromium 是现行证据。QA marker: Current Sidebar search normalizes matching and offers an announced clear recovery action.
>
> 会话标题映射：当前 `ChatView` 的 `ConversationTitle` 显式拥有重复打开的输入焦点、Escape/保存后的触发按钮回焦、header/Sidebar 同步更新和紧凑 header 几何；旧 lifecycle controller 不是现行 UI 权威。共享 focus helper、current app-shell mutation contract 与后台 Chromium 是可执行证据。QA marker: Current conversation title editing owns repeatable focus, cancel, save, and compact geometry.
>
> 新会话快捷键映射：当前 `appKeyboard.ts` 分类 Ctrl/Cmd+N 的单次、未处理事件，`App.tsx` 创建一个 active chat 并在新 Composer 挂载后安全聚焦空 textarea；Sidebar 的新会话按钮公开同一 `aria-keyshortcuts`。纯函数测试、current app-shell mutation contract 与后台 Chromium 是现行证据。QA marker: Current Ctrl/Cmd+N creates one active chat and transfers focus to its Composer.
>
> 超窄页眉映射：当前 300px CSS 只收起装饰性标题图标并限制原生模型选择器宽度；隐藏 Chromium 在 260×560 生产 DOM 上量取标题文本、模型选择器和两侧动作，默认短标题必须无文本溢出且所有控件留在 `.zc-chat-header` 内。current app-shell mutation contract 同时绑定 CSS 与视觉断言。QA marker: Current compact chat header keeps short default titles visible.
>
> 聊天模型选择映射：当前 `src/app/components/ChatView.tsx` 使用原生 `<select>/<optgroup>` 呈现启用 Provider 的模型，并由后台 Chromium 证明 change、Escape、正向 Tab、反向 Shift+Tab 的原生焦点顺序；visual audit 同时量取紧凑页眉边界。历史 `ChatProviderModelMenu`、折叠 Provider 行与 chevron CSS 已 superseded。QA marker: Current chat model selection uses the production native select and document focus order.
>
> 首启与导航映射：当前 Onboarding 只通过 `src/app/store.ts` 进入唯一 Settings > Providers、创建会话或提交“稍后设置”；当前 ProviderCard/store 统一承载 Base URL、模型、密钥与连通性检查。Settings 打开/关闭由当前 focus owner 回到真实触发控件，空会话提示只填入当前 Composer 草稿且不发送。`appNavigationController.ts`、`firstRunGuideController.ts`、`firstRunGuideState.ts` 及其专用测试已作为旧 UI 状态机删除；success-delay、guide notice target 和 guide return-tab 只保留在下文历史记录中。当前 store/组件测试、current app-shell 逐 marker 变异、79 帧 visual 与后台 browser smoke 是现行证据。QA marker: Current first-run setup opens Provider settings and keeps optional Sync independently reachable.
>
> Settings 视口映射：当前 `SettingsView.tsx` 在懒加载覆盖层实际挂载后消费 store 的一次性 Provider 入口意图，滚动并聚焦真实密钥字段；关闭覆盖层清除未消费意图。后台 visual audit 对紧凑 `.zc-settings-scroll` 与字段边界做运行时断言。旧 `settingsViewportController.ts` 及专用测试已删除。QA marker: Current Settings consumes viewport entry intent only after the production overlay mounts.

> 紧凑侧栏映射：当前 320×640 Sidebar 由生产 backdrop 关闭；折叠状态同时使用 `aria-hidden` 与 `inert`，browser smoke 强制聚焦内部控件时必须失败。QA marker: Current compact Sidebar closes through its backdrop and remains inert while collapsed.
>
> 同步入口映射：当前 `src/app/components/Sidebar.tsx` 只保留一个 Settings 入口，`src/app/components/SettingsView.tsx` 的唯一 Sync tab 统一拥有同步模式、状态与操作。历史 Sidebar cloud-sync strip、`variant="sidebar"` 和 direct Sync shortcut 已 superseded，不能作为当前 UI 或发布证据；current app-shell、组件测试和后台 Chromium 证明 Settings 与 Sync tab 可达。QA marker: Current Web cloud sync lives in the single Settings Sync tab instead of a duplicate Sidebar action.
>
> 同步设置与口令映射：当前同步模式、端点、自动同步和 GitHub token 只由生产 `src/app/store.ts` 与 `SettingsView.tsx` 提交，secret/AppData 变更从调用时进入共享 durable lifecycle lane。`settingsDraftPersistence.ts` 在修改已有口令前确认，取消后恢复已提交值与输入焦点；持久化、确认或通知失败均收口为稳定本地化反馈，Cloudflare access key 复制复用共享 clipboard fallback。旧 `syncPassphraseController.ts`、`syncSettingsController.ts` 及专用测试已 superseded，不能证明当前发布。当前行为测试、current-web-sync 逐 marker 变异与后台 Chromium 是现行证据。QA marker: Current sync settings and passphrase rotation use the production store and Settings persistence boundary.
>
> Provider 模型目录映射：当前 `src/app/providerModelCatalog.ts` 复用共享模型分类/默认值修复算法，唯一 `SettingsView.tsx` 和当前 store 提交按逗号/空白解析的新增、IME-safe 重命名、本地化确认删除与拖拽/按钮重排；无效/stale 操作 fail closed，所有能力默认字段在目录变化后保持有效。旧 `providerModelEditorController.ts` 与专用测试已删除，只保留下文历史记录。纯函数、store、组件渲染、current app-shell mutation 与后台 Chromium 是现行证据。
>
> Provider 设置与 AppData 修改映射：当前 `src/app/providerMutation.ts` 只承载可复用的数据规则，`src/app/store.ts` 统一拥有 Provider 新增/编辑/重排、durable credential 发布、检查 generation 与 lifecycle-serialized 删除，唯一 `SettingsView.tsx` 只接线这些生产动作。当前测试证明新密钥持久化失败不发布、transport 修改使旧检查失效、删除失败不发布半事务、删除与 sync/secret 串行、停用迁移启用 fallback。旧 `appDataMutationController.ts`、`providerSettingsController.ts` 和专用测试只保留为下文历史证据，不能让当前 gate 变绿。现行权威是生产可达图、store/providerMutation/Settings 行为测试与 current app-shell mutation contract。QA marker: Current Provider settings publish only through the production store and durable secret/AppData boundaries.
>
> Markdown 失败回退映射：生产可达的 `src/app/components/Markdown.tsx` 与 `src/app/markdownRenderState.ts` 只向状态保留当前内容、已清理 HTML 或失败标志，不保存原始异常；内容或渲染模式变化立即让旧状态失效。失败正文按纯文本显示，并通过本地化 polite status 告知用户。focused 行为测试、UI 负向变异和 current app-shell 逐 marker 变异共同证明。QA marker: Current Markdown fallback state is content-owned, localized, polite, and diagnostic-free.
>
> 空会话与消息行映射：当前 `src/app/components/Onboarding.tsx` 统一拥有首次进入、无会话与无 Provider 恢复态；当前 `src/app/components/MessageList.tsx` 的 memoized `MessageRow` 与虚拟窗口、行高测量和消息动作保持同一所有权边界。历史 `WelcomePanel`/独立 Web `MessageBubble` 记录已 superseded，不能作为当前发布证据。组件行为测试、UI mutation、current app-shell 与后台 Chromium 共同证明。QA marker: Current transcript and empty-state authority lives in production Onboarding and MessageList.
>
> 空会话起始操作映射：当前 `ConversationStarters.tsx` 只在生产空会话中渲染四个本地化 `type="button"`，并由具名 group 统一暴露；当前 `Composer.tsx` 在自身 draft 所有权内填入所选建议并于下一帧聚焦 textarea，不触发提交。`components-render` 证明非空会话不渲染该组，UI mutation 删除 group 语义会失败，后台 Chromium 同时断言消息行和 CDP Network 请求均未增加。历史 `WelcomePanel` 仅是 superseded 记录。QA marker: Empty conversations expose one current named starter group that fills and focuses without sending.
>
> 托管代理 host 维护映射：当前 `src/app/proxyHostMaintenance.ts` 只拥有稳定 owner ref、当前数据/口令调度与动态加载 hook，生产可达的 `src/services/proxyHostMaintenanceQueue.ts` 以串行 latest-wins 队列和可取消请求维护 Worker allowlist，`App.tsx` 只负责提供最新数据/口令并发布脱敏本地化通知。失败不会推进 remembered groups，队列重建继续使用最后成功状态，reporter 失败不会形成 detached rejection。旧 `managedProxyHostController.ts`、旧 hook 与专用测试的所有后文记录均是历史证据；现行证明来自新行为测试、`providerProxyHosts.test.ts`、app-shell mutation 和生产图。QA marker: Current proxy-host maintenance serializes the latest production App input and retains only successful remote groups.

- 当前同步结果在 durable AppData/Provider-key 提交前后复验 owner，只由 `setDataAndKeys` 发布一次；远端请求或提交等待期间的新编辑使旧结果失效，并由排队的最新 owner 重跑。QA marker: Current store sync results publish only through an owner-checked durable AppData and Provider-key commit.
- 当前 Provider 删除与 sync/secret/reset/import 共用排他 lifecycle lane；删除候选优先选择仍启用的 fallback Provider，原子提交 AppData/keys 后才清除旧诊断并排队一次远端自动同步。QA marker: Current store Provider deletion uses an enabled fallback and queues one post-commit auto-sync.
- 当前 Provider 停用在生产 mutation helper 内拒绝移除最后一个启用 owner；否则原子迁移会话与 fallback 模型，当前 store 仅在修改实际提交后清除旧诊断并启动一次自动同步。QA marker: Current store Provider disabling protects the last enabled owner and migrates conversations before auto-sync.
- 当前 `src/app/automaticSync.ts` 在本地修改后 debounce 上传，并在启动、周期、focus、online、重新可见时选择脏快照上传或干净快照 read-only pull；当前 store 让手动写压过 pull-only，并用 owner-aware remote-write guard 阻止旧运行发布。配置错误和 detached runner 失败经本地化、脱敏通知收口。QA marker: Current automatic sync owns debounced uploads and read-only foreground pulls.
- 当前 `src/app/store.ts` 直接拥有唯一常规 AppData `saveChain`；`updateData(...)` 只向该链调度，阻塞首个保存期间的连续修改不会并发写，后继保存读取并持久化最终快照。当前 Store 行为测试覆盖失败快照显式重试且不自旋、在途回退、已水合快照去重、最新通知通道、冲突 rebase，以及 reset/import 的本地保存 drain；旧 `useLocalSaveQueueController` 实现和专用测试已删除，不再是现行权威。QA marker: Current store serializes local AppData writes and coalesces in-flight changes to the latest snapshot.
- 当前证据同步要求唯一的 verify-release checkpoint 格式精确绑定当前验证源码、聚合 diagnostics、blockers、strict preflight 和直接渲染的 Web current-page QA 内容哈希，再比较生成时间；普通 check/write-docs 在 `inputBinding` 缺失、漂移或 checkpoint 较旧时写入前 fail closed，只有完整 verifier 的 pre-checkpoint bootstrap 拥有受限 override。旧的缺字段记录明确为 stale/pending，不是当前发布 checkpoint。QA marker: Current evidence rejects a checkpoint older than directly rendered Web QA outside the verifier bootstrap. QA marker: Current evidence accepts only a source-and-report-bound verify-release checkpoint.
- 当前全局 Skill 匹配设置由 `src/app/store.ts` 归一化并发布；配置了远端自动同步时，同一当前 store 边界请求一次 owner-aware 同步，行为测试直接观察 `performSync` 收到已提交设置。QA marker: Current global Skill settings request configured cloud auto-sync after normalization.
- 当前 detached local-save 失败只向用户显示稳定本地化错误，原始路径/secret 留在开发诊断；通知通道失败不污染后续保存。Provider 错误码与持久化同步状态通过当前错误呈现边界本地化并脱敏。QA marker: Current app error presentation localizes Provider and sync outcomes without leaking detached save diagnostics.
- 当前 `src/app/appEscape.ts` 忽略非 Escape 与已被内层控件处理的事件，每次只关闭一个当前拥有的界面：Settings 优先，其次仅紧凑视口的移动侧栏；桌面持久侧栏不受影响。QA marker: Current App Escape closes exactly one owned surface without cascading through an already-handled event.
- 当前 `src/app/providerMutation.ts` 与 `src/app/store.ts` 保证本地 AppData 时间戳严格单调、空会话模型与 Provider 默认值一致、直连/代理传输配置互斥，并仅按连接相关字段清除目标 Provider 诊断。QA marker: Current store Provider mutations stay monotonic, transport-consistent, and diagnostic-aware.
- 当前 Provider 能力检查在 `src/app/store.ts` 捕获 generation 与 invocation owner；transport、模型或凭据变化立即失效旧 run，迟到回调无法写模型、诊断或通知，同一操作键重开后旧 run 也不能清除新 owner。QA marker: Current Provider checks reject stale writes by generation and invocation ownership.
- 当前一次性功能提示由生产可达的 `src/app/components/FeatureHint.tsx`、`src/app/featureHints.ts` 与 current store 拥有：Chat 按模式、Settings 按 tab 各显示至多一个 polite/atomic status；关闭偏好先 durable save，再以 AppData revision 复验发布，失败不隐藏、不泄露异常。成功发布后的数据变更由统一 automatic-sync data effect 处理；旧 controller scheduler 与自定义 Provider/model menu 焦点状态机均不是现行证据。后台 browser smoke 断言 `Current chat feature hint must expose polite atomic status semantics`，并证明 Settings 关闭后不重复及 chat/image 偏好独立；visual audit 量取提示位于 header 下、composer 上且不溢出紧凑视口。QA marker: Current feature hints publish dismissal only after durable local persistence and flow through automatic sync.
- 当前 Settings secret 表单在 durable 写入完成前不清草稿；失败只走稳定本地化通知，原始异常与通知通道失败均被动作边界收口。QA marker: Current Settings secret writes wait for durable storage and expose only stable localized failures.
- 当前 `SyncTab` 的 use-local/use-remote/merge 三个冲突动作均走共享异步 action containment；拒绝时显示稳定本地化错误且不泄露异常。QA marker: Current Settings sync conflict actions contain rejected promises behind localized feedback.

## 当前 Web 视觉审计合同（2026-08-11 Asia/Shanghai）

- 当前 `scripts/visual-audit.mjs` 从唯一生产入口生成 69 个固定命名场景，并按 `src/i18n.ts` 的 `supportedLocales` 自动追加 10 个紧凑语言场景。当前清单为 Visual screenshots `01`-`79`；增删语言或固定场景时，脚本期望数、manifest 和本节必须一起更新。
- Current visual audit uses named scenarios from the generated manifest instead of historical screenshot indices. 当前音频场景为 `audio-composer-mobile`, `audio-composer-compact-mobile`, and `audio-composer-micro-desktop`；320x640 场景使用真实长文件名并断言截断不挤压操作，260x560 场景执行转写按钮可见性和面板边界断言。browser smoke 还会证明不支持的文件不会替换已接受的音频，也不会把文件名哨兵泄露到通知。其它当前命名场景覆盖首次引导、Provider/模型/Skill/同步/数据设置、RTL/各语言、侧栏、删除确认、亮色/紧凑/横屏、启动窄屏与离线队列。
- 权威产物是 `.visual-audit/visual-audit-manifest.json`、`.visual-audit/visual-audit-gallery.html` 与 `.visual-audit/visual-audit-contact-sheet.jpg`。历史记录中的 118/120 张、旧序号和旧文件名只描述当时证据，不代表当前清单，也不得使当前门禁变绿。
- 本机新鲜 headless Chromium 运行已通过 79/79；这只证明当前 Web 响应式视觉与几何合同，不替代 Apple/Linux 目标运行时、Windows trusted MSIX、hosted native CI、live sync 或 Provider full-capability 证据。
- 当前聊天头部的 Provider/模型选择器使用原生 `select/optgroup`；browser smoke 已真实发送 Tab 与 Shift+Tab，分别证明焦点前进到设置按钮和返回选择器。QA marker: Native provider/model select preserves forward and reverse document focus order.
- 当前 Composer 的 chat/image/audio 三个模式按钮在生成或音频转写期间统一使用原生 `disabled`，流式 partial 状态保持禁用，terminal 状态恢复启用；UI mutation harness 删除该接线时会让 `check:ui` 失败。QA marker: Composer mode controls expose native disabled semantics throughout generation and transcription.
- 当前 providerless 恢复态在 320×640 视口使用独立 `provider-empty-state` 布局；visual audit 要求卡片顶部位于 40–72px、主动作结束于半屏之前，组件和 CSS 任一接线被删除都会使 UI mutation gate 失败。QA marker: Provider empty state stays top-aligned on compact mobile.
- 当前首次引导在 280×560 视口直接量取可见子元素，最大内部间距不超过 24px，卡片完整落在视口内。QA marker: First-run micro layout stays content-tight.
- 当前图片编辑/局部重绘场景通过 Files API 注入真实 PNG，分别在 320×640 与 280×560 验证原生模型选择、短标题、源图和 mask canvas 几何。QA marker: Current image composer keeps short-viewport controls inside the production header and composer.
- 当前大 Skill 场景通过仅限 loopback HTTP(S) 且要求显式 `app-test=1` 的 app-test bridge 幂等替换 241 项数据；公网与 file-based WebView 不安装该持久化测试入口。visual audit 先证明首批严格渲染 80 行，再按 80/80/1 的批次滚到末项并要求 `Visual Skill 241` 完整位于滚动容器内。QA marker: Current large Skill library visual fixture is deterministic and idempotent.
- 当前 Skill 生产权威只有 `src/app/components/SettingsView.tsx`、`src/app/store.ts` 与 `src/app/skillList.ts`。新增/批量导入/编辑/删除共享 durable lifecycle lane；AppData 快照落盘后才发布内存状态，旧或失败候选 ref 只按当前可见差集清理，批量导入只开一次 chunk 写事务。列表先渲染 80 行，再以 80 行批次渐进加载并保留手动 fallback。当前 store/Skill-list 行为测试、`scripts/skill-system-check.mjs` 与后台 Chromium 是现行证据；旧 `settingsSkillController`、`settingsSkillActions*`、`settingsSkillList*` 及专用测试仅是历史证据。QA marker: Current Skill mutations publish AppData before cleaning content refs.
- 当前 `settings-overlay-preload-smoke.mjs` 在隐藏 headless Chromium 的独立 target 中分别注入 React 后代渲染失败和 pre-React 启动失败；桌面/移动两档都要求 `role=alert`、`aria-live=assertive`、reload 初始获焦、原始 sentinel 不进入 DOM、window error/unhandled rejection 为零且无横向溢出，并比较两条路径的共享标题与说明。QA marker: Root runtime render failures recover without exposing raw errors.
- pre-React 失败只由 `reportStartupRenderFailure` 在初始 DOM 上渲染一次，React boundary 复用同一 `runtimeFailureCopy`；bootstrap 不再调用随后会被覆盖的第二套 startup-shell fallback。故障 probe 仅在 loopback HTTP(S) 且显式 `app-test`/命名参数同时存在时启用，公网与 file-based WebView fail closed。产物写入当前四张非敏感截图。QA marker: Pre-React startup failures share localized recovery and contain diagnostic failures.

<!-- zerochat-current-evidence:qa-overlay:start -->
Current diagnostic overlay: the latest aggregate diagnostic batch superseding
older current-labelled diagnostic rows and the older long-form release-gates
table row was generated on 2026-08-21 20:38 Asia/Shanghai by
`D:\Node.js\pnpm.CMD run report:release-diagnostics` and summarized by
`D:\Node.js\pnpm.CMD run report:current-evidence` after the current Web,
Windows WebView, MSIX package-candidate, and release blocker refresh.
`.manual-qa/release-diagnostics-current.json` is 19,762 bytes / SHA-256
`DEBD698A724C1266E149DAA0194FA0B11B0041A5140A9EA35763EB8250942E84`, generatedAt `2026-08-21T12:38:43.847Z`
(2026-08-21 20:38 Asia/Shanghai), status `blocked`, releaseEvidence
false. `.manual-qa/release-blockers-current.json` is 52,427 bytes / SHA-256
`40FF87D6EBEB8434F56EF4F4C8B85ED5069FA51789BA5E75225CA87BB54BA072`, generatedAt `2026-08-21T12:38:17.583Z`
(2026-08-21 20:38 Asia/Shanghai), status `blocked`, blockerCount `7`.
Release blocker ownership matrix: `apple-target-runtime-qa` status `blocked`, blockerKind `missing-apple-target-runtime-prerequisites`, owner `target-host-macos-xcode-swift`; `linux-target-runtime-qa` status `blocked`, blockerKind `missing-linux-target-runtime-prerequisites`, owner `target-host-linux-gtk-secret-service`; `windows-trusted-msix-release-pass` status `blocked`, blockerKind `windows-appx-deployment-deleted-package-cleanup-failure`, owner `host-windows-appx-deployment-service`; `disposable-live-sync-release-pass` status `skipped`, blockerKind `missing-live-sync-release-inputs`, owner `release-operator-disposable-sync-credentials`; `hosted-native-ci-release-evidence` status `missing`, blockerKind `missing-hosted-native-ci-release-evidence`, owner `release-operator-github-actions`; `live-provider-full-capability-release-evidence` status `skipped`, blockerKind `missing-live-provider-release-inputs`, owner `external-provider-or-third-party-relay`; `live-provider-web-ui-browser-origin-release-evidence` status `skipped`, blockerKind `missing-live-provider-ui-release-inputs`, owner `browser-allowed-ai-proxy-or-cloudflare-worker`.
`.manual-qa/verify-release-current.json` is 24,112 bytes / SHA-256
`E3BEF47B290B9D338ECB518B42BA53B96D8BD5F42E783580998F5D0AB0312142`, generatedAt `2026-08-21T12:38:52.140Z`
(2026-08-21 20:38 Asia/Shanghai), status `failed`, failedStepLabels
[`Runtime smoke artifacts`], and remains reproducibly checked by
`pnpm run check:verify-release-checkpoint`.
Verify-release checkpoint failure detail: failed `Runtime smoke artifacts` is expected blocker `windows-trusted-msix-release-pass-missing`; current release blockerKind is `windows-appx-deployment-deleted-package-cleanup-failure`, owner `host-windows-appx-deployment-service`; Windows host preflight status `blocked`, trustedMsixQaReadiness `host-blocked`; current MSIX package-candidate staged web matches dist: `true`, package-internal web matches dist: `true`, package-internal web matches stage: `true`; next proof gate `Codex is an active WindowsApps Deleted lock holder; do not interrupt an active Codex work session. Use a fresh disposable Windows profile or VM for trusted MSIX QA, or rerun the host preflight after Codex exits; repair or replace the host only if unlocked deleted-package targets remain`; this is diagnostic-only and not release evidence.
Windows trusted MSIX current blocker semantics: blockerKind `windows-appx-deployment-deleted-package-cleanup-failure`, owner `host-windows-appx-deployment-service`; currentTrustedQaState `host-preflight-blocked-or-unproven`; needsElevatedTrustedQaRerun false; nextProofGate `Codex is an active WindowsApps Deleted lock holder; do not interrupt an active Codex work session. Use a fresh disposable Windows profile or VM for trusted MSIX QA, or rerun the host preflight after Codex exits; repair or replace the host only if unlocked deleted-package targets remain`; hostPreflight status `blocked`, trustedMsixQaReadiness `host-blocked`; historicalTrustedQaFailureKind `windows-appx-deployment-deleted-package-cleanup-access-denied`, historicalTrustedQaFailureOwner `host-windows-appx-deployment-service`.
`.manual-qa/strict-release-preflight.json` is 6,372 bytes / SHA-256
`8D0DEFEEE514CF15F994CE2812166AC98F3D32947CFCF1E3D3BB01AE51A6DBBB`, generatedAt `2026-08-21T12:11:49.817Z`
(2026-08-21 20:11 Asia/Shanghai), status `blocked`.
Aggregate diagnostic child safety: 26/26 child summaries are `safeToPublish: true`, 25/26 are `releaseEvidence: false`, and 1/26 are validated child release evidence; `pnpm run check:release-diagnostics` rejects unsafe or invalid child summaries without promoting the aggregate.
Expected red gate audit: runtimeArtifactExpectedBlocker.status = expected-blocker, actualExitCode = 1, unexpectedBulletLineCount = 0. Full runtime-artifact gate still fails on the current trusted MSIX host AppX cleanup blocker. The current sync source also needs a fresh disposable live-sync release drill.
Aggregate diagnostic child hashes: Windows host preflight
`E7322D7D734E21A4423BFB7A9D61B2061C08B8608C95B3874A188C82BA3C9E1B`; Hosted native CI
Windows trusted MSIX current pass `CABC8D113A4C0A0FE831269E2F2E1DFA623B8352939718EB321A56042B20BCFC`;
`AAF8DA4C3F9A7153494FA1C9A00ABFB39CD8D81C66C9CA16267551CCCFF02C77`; Live sync canonical release pass
`496875247981F21F59784CEEB168E12C900C1B4E75DD157C7E2A7BF69C8106CF`; Live sync current diagnostic `7E42538F024E2E539CC773E6D8EF1E6171FA0AFEDB634F3ED3B84A525C90B91E`;
Live provider ordinary API `4460F61DA0794698BD3B4E2F83FA93B61A602A5A2B4B375E60FF7773671B8B0E`;
Live provider current diagnostic `4460F61DA0794698BD3B4E2F83FA93B61A602A5A2B4B375E60FF7773671B8B0E`;
Live provider credential-confirmed full-capability attempt `F284A79F80C6F5EE0B7F35A9CA0EB08E35CF777A69ED444373A83D12F3776D61`;
Live provider UI current `5F1CE4AD6050B551678AFB2F2C8599342AB1CE60BE2823A8D34B9BD6F804A009`;
Live provider UI preserved attempt `D4688430106EEA0240A304D877E59E846998AC44BF874F3092D37F32A08E047D`;
Native prereq `1377D95066CEC6B6B940E11C7F361AF180204EA31153685932B82DB108E31AC4`.
Hosted native CI handoff coverage: current-source coverage `gitWorktreeDirty: true`, `nativeSourceWorktreeDirty: true`, `gitStatusEntryCount: 906`, `nativeSourceStatusEntryCount: 156`, `hostedCiCoversCurrentWorktree: false`, `hostedCiCoversCurrentNativeSource: false`, `releaseEvidenceHandoffReady: false`; current missing aliases `clean-git-worktree` / `clean-native-source-worktree`.
Apple target-host runtime evidence: targetRuntimeEvidenceRequired true; targetHost `macOS with Xcode/Swift`; currentHostSatisfiesTargetRuntime false; localPreflightIsRuntimeEvidence false; runtimeQaMustRunOnTargetHost true; requiredHostTools `swift` / `xcodebuild`; requiredProof `target-host build log` / `target-host runtime screenshot` / `target-host visual QA` / `target-host sync QA` / `target-host package-size evidence`.
Linux target-host runtime evidence: targetRuntimeEvidenceRequired true; targetHost `Linux or WSL with GTK4/libadwaita and Secret Service`; currentHostSatisfiesTargetRuntime false; localPreflightIsRuntimeEvidence false; runtimeQaMustRunOnTargetHost true; requiredHostTools `cargo` / `pkg-config` / `secret-tool` / `pkg-config gtk4` / `pkg-config libadwaita-1`; deferredTargetChecks `cargo` / `pkg-config` / `secret-tool` / `pkg-config gtk4` / `pkg-config libadwaita-1`; requiredProof `target-host build log` / `target-host runtime screenshot` / `target-host visual QA` / `target-host sync QA` / `target-host Secret Service QA` / `target-host package-size evidence`.
Live sync canonical release pass is missing or not current-passed at `.manual-qa/live-sync-release-drill.json` (status `passed`, releaseEvidence true, SHA-256 `496875247981F21F59784CEEB168E12C900C1B4E75DD157C7E2A7BF69C8106CF`); the current sanitized diagnostic is `.manual-qa/live-sync-release-drill-current-diagnostic.json` (status `skipped`, SHA-256 `7E42538F024E2E539CC773E6D8EF1E6171FA0AFEDB634F3ED3B84A525C90B91E`). Live sync release-pass input binding: blockerKind `missing-live-sync-release-inputs`; mode `none`; remoteTouched false; missingInputKeys `liveSyncMode` / `providerSpecificDisposableCredential` / `destructiveConfirmation` / `throwawaySyncPassphrase`; supportedModes `cloudflare` / `gist`; sourceFingerprint.current true, 65 files / 1,017,099 bytes / SHA-256 `CF06D480593C9D0A77345314F0277C95F6170972AC950BD515CC578912B22B79`.
Live provider full-capability evidence source binding: preferredProviderBlockerSource `current-diagnostic`; blockerKind `missing-live-provider-release-inputs`; selectedSourceReport `.manual-qa/live-provider-smoke-current-diagnostic.json`, status `skipped`, releaseEvidence false, releaseEndpointEligible false, sourceFingerprintCurrent true, hasCredentialConfirmedProviderAttempt false, hasFullCapabilityAttempt false; currentDiagnosticReport `.manual-qa/live-provider-smoke-current-diagnostic.json`, status `skipped`, releaseEvidence false, releaseEndpointEligible false, sourceFingerprintCurrent true, hasFullCapabilityAttempt false; credentialConfirmedAttemptReport `.manual-qa/live-provider-smoke-attempt-current.json`, status `failed`, releaseEvidence false, releaseEndpointEligible true, sourceFingerprintCurrent false, hasCredentialConfirmedProviderAttempt true, hasFullCapabilityAttempt true, hasReleaseEligibleProviderAttempt true, requestedCapabilities chat true, image true, audio true, lowCost true, realtime true; selectedModels chat `unknown` (unknown), image `unknown` (unknown), audioSpeech `unknown`, audioTranscription `unknown`, embedding `unknown`, moderation `unknown`, realtime `unknown`; capabilityFailureModelAttempts none; capabilityFailureSummary.total 0, affectedCapabilities `none`, routeHealthBlockers `none`.
Live provider full-capability required remediation: source `none`; capabilityFailureSummary.total 0; affectedCapabilities `none`; routeHealthBlockers `none`; capabilityRemediationHintCount 0; reportRemediationHintCount 0; remediationTargets `none`; rerunCommands `pnpm run drill:live-provider` / `pnpm run check:live-provider-report` / `pnpm run check:live-provider-full-capability`.
Live provider UI browser-origin proxy preflight semantics: top-level browserOriginProven false; proxyPreflight.status `passed`, transportPath `node-to-provider`, browserOriginProven false, selectedModel `gpt-5-6-pro`, chatStatus `200`; Node-side preflight is not browser-origin release evidence.
Live provider UI loopback Worker contract diagnostic: path `.manual-qa/live-provider-ui-local-proxy-diagnostic.json`, status `skipped`, releaseEvidence false, browserUiExecuted false, browserOriginProven false, workerHostedProviderKeyConfigured true, providerKeyBrowserExposed false, requestCredentialsAbsent false, modelListStatus `unknown`, chatStatus `unknown`, selectedModel `unknown`, markerCaptured false, harnessClosed false, sourceFingerprintCurrent true; loopback contract proof is diagnostic-only and does not prove a deployed browser origin.
Live provider UI browser-origin evidence source binding: preferredUiBlockerSource `current-diagnostic`; blockerKind `missing-live-provider-ui-release-inputs`; selectedFailureKind `unknown`; preservedAttemptFailureKind `unknown`; selectedSourceReport `.manual-qa/live-provider-ui-smoke-current.json`, status `skipped`, releaseEvidence false, releaseEndpointEligible false, sourceFingerprintCurrent true; currentDiagnosticReport `.manual-qa/live-provider-ui-smoke-current.json`, status `skipped`, releaseEvidence false, releaseEndpointEligible false, sourceFingerprintCurrent true; preservedAttemptSourceFingerprintCurrent false; browserOriginProven false; markerCaptured false; browserMessageSent false; requestedInputs proxyConfigured false, syncPassphraseProvided false, workerHostedProviderKeyRequested false; browserProviderKeyInjected false; selectedScreenshot `none`, unknown bytes / SHA-256 `unknown`; preservedAttemptScreenshot `none`, unknown bytes / SHA-256 `unknown`.
Live provider UI required remediation: kind `missing-live-provider-ui-inputs`; browserAllowedProxyRequired true; requiresProxyUrl true; requiresSyncPassphrase true; requiresWorkerHostedProviderKey true; actionCount 4; actions `Configure a browser-allowed AI proxy/Cloudflare Worker root through ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL; direct provider mode is diagnostic-only and cannot produce browser-origin release evidence.` / `Provide ZEROCHAT_LIVE_PROVIDER_UI_SYNC_PASSPHRASE so the browser can derive the Worker access key.` / `Set ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY=true, store the provider key as a Worker secret, and do not inject the provider key into the browser.` / `Provide remaining release UI inputs (providerBaseUrl, sendConfirmation) before rerunning pnpm run drill:live-provider-ui.`.
Current Web/Windows evidence: Web .opus MIME parity and Windows trusted MSIX host AppX blocker refresh remain diagnostic-only.
Web source digest
  `0E446D59C5EA9F5EBEE983136743A84CDE6E56CCBB031337A08FDF5050FC080E`
Web current-page QA report hash `1BCE5F4359B339BDD06C1748F0509E3BC81B6A1374A9FA609215BF5B89E5CB76`; current-page visual-audit manifest hash `4A73CF589D352D70D2DE1C34B571BFA7DDC0B5E58E0CC0A9204E27CEB89122ED`; release visual-audit manifest hash `E49346321C0F85924CDF21528CBAF08B87A93C74838CFA192271753D8F9B6111`.
Android emulator runtime QA 当前 2026-08-20 15:02 Asia/Shanghai 通过 70 screenshots（UI 55 / Cloudflare sync 15），`.manual-qa/android-emulator-qa.json` 为 8,744 bytes / SHA-256 `734A875B01BD91DF4A099DB8BE83C7AF5356AE20184C09838E787B0D45CD9B4F`，UI smoke 为 21,020 bytes / SHA-256 `755BD210020031E5D2748969ECEF483B0C90808210A014CE09CD22E5520B28AF`，Cloudflare sync smoke 为 9,856 bytes / SHA-256 `179372467D9BEB00E28889BE829CAE5934AAD976F3CD7AF63792B0A5F6B0C578`，contact sheet report 为 25,202 bytes / SHA-256 `1952CC442C1B4F3DE0A0E2DF22A194170BA4A4BD6FF4FD775AC8425EA53C196A`，contact sheet PNG 为 1,549,729 bytes / SHA-256 `BA03B247FD7A19CACCBAB27A9880996B2D039560D7DBDA5A7239B616D4F69007`，debug APK SHA-256 `AF0F77330C07FA1CDEE47485352F854248E4066AE91366BC9F33887921DABBE0`。三份 Android runtime 报告均绑定当前 source-bound debug APK（16,380,694 bytes / SHA-256 `AF0F77330C07FA1CDEE47485352F854248E4066AE91366BC9F33887921DABBE0`）和同一 Android source fingerprint。QA marker: Current Android runtime evidence refuses stale APK reports.
Current Web/Windows refresh recorded release-build `dist/index.html` SHA-256 `6B9B699CADA71719A7E6CC62F7B0D6FF95CE1FBE8AB6A92F64D63EA056BAB300`.
Current MSIX package-candidate `.manual-qa/ZeroChat_0.0.1.0_x64.msix` is 1,382,360 bytes / SHA-256 `2C8980E6F4FEBAE56AEF79E5B07D58B948837F4B367A477AC6E72BB1A82151CD`; staged MSIX web tree matches current `dist` at 52 files / 1,034,526 bytes / SHA-256 `1F2718F6F896A487B131BD259A63CB882D0F9E16A45E8C89F1A519039FF4DFC7`, stageWebMatchesDist: true; package-internal web tree matches current `dist` and stage at 52 files / 1,034,526 bytes / SHA-256 `1F2718F6F896A487B131BD259A63CB882D0F9E16A45E8C89F1A519039FF4DFC7`, packageWebMatchesDist: true, packageWebMatchesStage: true. This is package-candidate freshness only, not trusted install/update/uninstall release evidence.
Current Web QA timestamp: 2026-08-21 19:39 Asia/Shanghai.
- Windows trusted MSIX install/update/uninstall 当前 runtime QA：当前 host 状态以 `.manual-qa/windows-msix-host-preflight.json` 为准（status: `blocked`, hostReadyForTrustedMsix: false, currentShellElevated: false）。

Current product contract / QA markers:

QA marker: Current verify-release metadata is validated from the checkpoint report, never a hard-coded digest.
- QA marker: Local encryption migration feedback stays localized and contained.
- QA marker: Current Settings dialog roots wrap forward and reverse Tab inside the production focus scope.
- QA marker: Current onboarding and navigation use only production store actions and the single Settings surface.
- QA marker: Current Provider model catalog repairs defaults and exposes add, rename, remove, and reorder only through production Settings.
- QA marker: Current generation runtime retries every production generation capability and contains detached replay failures.
- QA marker: Current image submission clears only the accepted draft and source after durable commit.
- QA marker: Current image submission preserves newer draft and source ownership while a send is pending.
- QA marker: Current audio transcription claims cancellation ownership before proxy token derivation.
- QA marker: Current audio transcription appends only a non-stale result to the latest Composer draft.
- QA marker: Current Settings confirms Skill deletion through the production action boundary.
- QA marker: Current Settings confirms Provider model deletion through the production catalog boundary.
- QA marker: Current offline replay persists exclusive claims and terminal states before Provider or sync effects.

Current live-sync safety contract:

- QA marker: Live-sync drill CLI help and invalid arguments cannot write reports or touch remote storage.
- QA marker: Live-sync release evidence rejects ephemeral tunnel endpoints.
- Live sync release drill rejects invalid CLI arguments before environment-driven report or remote behavior.
- Live sync release-pass drill-name uniqueness guard rejects an epoch-millisecond suffix error before release evidence is accepted.
- A passing live sync release drill report is the only release evidence; diagnostic reports retain requiredInputs, missingInputKeys, and releaseBlockerSummary.

Current live-provider API/UI smoke safety contract:

- Temporary provider API and UI smoke must normalize known endpoint-suffixed Base URLs, require minimal streaming `ZeroChat OK` proof, and retain redacted per-candidate status summaries.
- Browser-origin UI smoke records `assistant-marker` and `ZC_LIVE_UI_PASS_`, uses `ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL` when a browser-allowed relay is required, and fails quickly with visible-page diagnostics.
- Low-cost embedding/moderation capability smoke is also separately confirmed.
- Audio speech/transcription round-trip smoke is separately confirmed.
- Current browser-origin artifacts include `web-live-ui-provider-smoke.png`, `web-live-ui-provider-smoke-current.png`, and `web-live-ui-provider-smoke-current-relay.png`; live provider UI screenshots are checked by `check:live-provider-ui-screenshot`.
- Live provider full-capability current source fingerprint guard and Live provider diagnostic current source fingerprint guard bind sanitized evidence to the current source tree.
- Live provider API smoke report artifact is sanitized before validation or upload; sourceFingerprint and model-selection source evidence remain current-source bound.
historical trusted MSIX diagnostic evidence is preserved separately from current release evidence.
Windows trusted MSIX run `20260615-092543` remains the current host AppXDeploymentServer `windows-appx-deployment-deleted-package-cleanup-access-denied` diagnostic for the historical 31-file `951885`-byte `dist`, does not match the current 52-file `1034526`-byte `dist`, and trusted install/update was not rerun because host preflight is still blocked
current Windows MSIX same-bundle diagnostic evidence in `.manual-qa/windows-msix-current-trusted-install-update-qa.failure.json` remains report-derived and is not a trusted release pass.
current trusted MSIX install/update/uninstall release-pass remains blocked by the host AppX cleanup diagnostic; releaseEvidence remains false.
The current trusted MSIX self-signed install/update/uninstall attempt only produced `.manual-qa\windows-msix-current-trusted-install-update-qa.failure.json` diagnostic evidence.
The current trusted MSIX attempt is diagnostic-only failure evidence; it is not a trusted release pass.
Current visual audit uses named scenarios from the generated manifest instead of historical screenshot indices.
`audio-composer-mobile` and `audio-composer-micro-desktop`
`src/i18n.ts` 的 `supportedLocales`
.visual-audit/visual-audit-manifest.json
.visual-audit/visual-audit-contact-sheet.jpg
custom relay 不再复制首启专用字段
Web/PWA src/app/store.ts owns the production Skill mutation boundary
Web/PWA SettingsView.tsx owns the production Skill settings shell
Web/PWA current store tests lock durable add/import/edit/delete and stale ref cleanup
current trusted MSIX install/update/uninstall release-pass remains blocked
Windows trusted MSIX historical run `20260615-092543` remains stale-dist AppXDeploymentServer diagnostic context `windows-appx-deployment-deleted-package-cleanup-access-denied` for the historical 31-file `951885`-byte `dist`; it does not match the current 52-file `1034526`-byte `dist`, and the current blocker is the missing elevated current-source trusted MSIX release-pass.
The current Web current-page refresh covers digest `0E446D59C5EA9F5EBEE983136743A84CDE6E56CCBB031337A08FDF5050FC080E`, recorded by focused Web-local current-page QA, and the latest Windows WebView runtime evidence now targets the 52-file `1034526`-byte `dist`; the full release gate currently stops at Runtime smoke artifacts on the Windows trusted MSIX blocker plus additional blocker(s) `disposable-live-sync-release-pass`.
Windows trusted MSIX run `20260615-092543` is a host AppX deployment diagnostic, not release evidence. Report: `.manual-qa/windows-msix-current-trusted-install-update-qa.failure.json`, SHA-256 `B9C3EABF2BD707B375818C79D89E4BE52634853C9F8477A3EF74F8B6E0E942C4`.
Live-provider route remediation boundary: owner `external-provider-or-third-party-relay`; ZeroChat Worker coverage `covered-by-cloudflare-sync-worker-and-check-security`, guarded by `pnpm run check:security`; Worker proxy action paths `image-generations->/images/generations`, `image-edits->/images/edits`, `image-responses->/responses`, `audio-speech->/audio/speech`, `audio-transcriptions->/audio/transcriptions`, `embeddings->/embeddings`, `moderations->/moderations`, `realtime->/realtime`, `realtime-client-secrets->/realtime/client_secrets`. Third-party relay/provider 404/503 route or service failures remain external remediation and cannot be counted as ZeroChat release evidence.
Live-provider source fingerprint schema `zerochat.liveProviderSourceFingerprint.v1`; 112 files / 1,889,955 bytes; SHA-256 `4C4FB35B5B599BD27F14B13C5A9DDB613DE16221CDDB78F389118A7096682BB9`.
Live-provider UI source fingerprint schema `zerochat.liveProviderUiSourceFingerprint.v1`; 261 files / 2,805,890 bytes; SHA-256 `93CDA924607AE98B60E18A400981D476EC4D9E63D6858B70B2FF40CC3A58113D`.
Live-sync source fingerprint schema `zerochat.liveSyncSourceFingerprint.v1`; 65 files / 1,017,099 bytes; SHA-256 `CF06D480593C9D0A77345314F0277C95F6170972AC950BD515CC578912B22B79`.
Native source fingerprint: 461 files / 5,633,241 bytes; SHA-256 `E8B802B80E08A0C5EFCB3019603CC1C27E03395B82E0670061977E224EB55E4E`.
Native README and platform docs now scope clear-cloud-data; copy guard rejects the old unqualified native clear-cloud-data wording, and Cloudflare remote-clear wording remains platform-scoped.
Windows now uses the shared PWA Skill UI through WebView2; Linux now wires Skill settings and the shared snapshot store in source, while target-host runtime QA remains required.
Current diagnostic timestamps: native prereq 2026-08-21 20:11 Asia/Shanghai;
live sync diagnostic 2026-08-21 20:11 Asia/Shanghai; live provider diagnostic
2026-08-21 20:11 Asia/Shanghai; hosted native CI diagnostic 2026-08-21 20:11 Asia/Shanghai.
Completion verdict: not complete as an all-platform release because the
current
2026-08-18 01:21 Asia/Shanghai live-provider full-current report is a failed
full-capability diagnostic.
Current full release verifier checkpoint: `.manual-qa/verify-release-current.json` was refreshed at 2026-08-21 20:38 Asia/Shanghai
(`2026-08-21T12:38:52.140Z`), is 24,112 bytes / SHA-256
`E3BEF47B290B9D338ECB518B42BA53B96D8BD5F42E783580998F5D0AB0312142`, status `failed`, releaseEvidence false, failedStepLabels [`Runtime smoke artifacts`],
Verify-release checkpoint failure detail: failed `Runtime smoke artifacts` is expected blocker `windows-trusted-msix-release-pass-missing`; current release blockerKind is `windows-appx-deployment-deleted-package-cleanup-failure`, owner `host-windows-appx-deployment-service`; Windows host preflight status `blocked`, trustedMsixQaReadiness `host-blocked`; current MSIX package-candidate staged web matches dist: `true`, package-internal web matches dist: `true`, package-internal web matches stage: `true`; next proof gate `Codex is an active WindowsApps Deleted lock holder; do not interrupt an active Codex work session. Use a fresh disposable Windows profile or VM for trusted MSIX QA, or rerun the host preflight after Codex exits; repair or replace the host only if unlocked deleted-package targets remain`; this is diagnostic-only and not release evidence. It is rechecked by `pnpm run check:verify-release-checkpoint`.
<!-- zerochat-current-evidence:qa-overlay:end -->

## 当前发布残余清单

- [ ] 当前 release blocker `apple-target-runtime-qa`：status `blocked`，blockerKind `missing-apple-target-runtime-prerequisites`，owner `target-host-macos-xcode-swift`；next action：Run the Apple QA entry on macOS with Xcode/Swift installed.
- [ ] 当前 release blocker `linux-target-runtime-qa`：status `blocked`，blockerKind `missing-linux-target-runtime-prerequisites`，owner `target-host-linux-gtk-secret-service`；next action：Run the Linux QA entry inside Linux or WSL with GTK4/libadwaita and Secret Service available.
- [ ] 当前 release blocker `windows-trusted-msix-release-pass`：status `blocked`，blockerKind `windows-appx-deployment-deleted-package-cleanup-failure`，owner `host-windows-appx-deployment-service`；next action：Treat this as external lock-holder/AppX package lifecycle state, not as ZeroChat release-pass evidence.
- [ ] 当前 release blocker `disposable-live-sync-release-pass`：status `skipped`，blockerKind `missing-live-sync-release-inputs`，owner `release-operator-disposable-sync-credentials`；next action：Configure disposable Cloudflare or Gist sync credentials, use the destructive confirmation value, then rerun the live sync release drill.
- [ ] 当前 release blocker `hosted-native-ci-release-evidence`：status `missing`，blockerKind `missing-hosted-native-ci-release-evidence`，owner `release-operator-github-actions`；next action：Resolve hosted native CI local prerequisites (clean-git-worktree, clean-native-source-worktree) before claiming artifact evidence.
- [ ] 当前 release blocker `live-provider-full-capability-release-evidence`：status `skipped`，blockerKind `missing-live-provider-release-inputs`，owner `external-provider-or-third-party-relay`；next action：Treat the preserved credential-confirmed full-capability API attempt as historical diagnostic context; rerun pnpm run drill:live-provider after applying its route/service remediation so the report matches the current source fingerprint.
- [ ] 当前 release blocker `live-provider-web-ui-browser-origin-release-evidence`：status `skipped`，blockerKind `missing-live-provider-ui-release-inputs`，owner `browser-allowed-ai-proxy-or-cloudflare-worker`；next action：Configure a browser-allowed AI proxy/Cloudflare Worker root through ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL; direct provider mode is diagnostic-only and cannot produce browser-origin release evidence.

## Open Gaps

Top current blocker summary: 7 residual blockers remain:
  `apple-target-runtime-qa` / `linux-target-runtime-qa` / `windows-trusted-msix-release-pass` / `disposable-live-sync-release-pass` / `hosted-native-ci-release-evidence` / `live-provider-full-capability-release-evidence` / `live-provider-web-ui-browser-origin-release-evidence`.

- Current trusted MSIX install/update/uninstall release-pass remains blocked.
- current trusted
  install/update/uninstall release-pass evidence remains reopened on run
  `20260615-092543`
- Current trusted MSIX install/update/uninstall QA is reopened: run
  `20260615-092543` remains diagnostic-only host AppX
  evidence for the historical 31-file
  `951885`-byte `dist`; it does not match the current
  52-file `1034526`-byte `dist`, and trusted install/update was
  not rerun while host preflight is blocked

- Current trusted MSIX install/update/uninstall release-pass is still missing:
  historical run `20260615-092543` remains diagnostic-only
  host AppX
  evidence for the historical 31-file
  `951885`-byte `dist`; it does not match the current
  52-file `1034526`-byte `dist`, and trusted install/update was
  not rerun while host preflight is blocked.
  The historical trusted-MSIX AppX failure is stale-dist diagnostic context, not the current blocker root.
  Windows trusted MSIX run
  `20260615-092543` remains a historical AppXDeploymentServer
  `windows-appx-deployment-deleted-package-cleanup-access-denied`
  diagnostic for the historical 31-file `951885`-byte `dist`, does not
  match the current 52-file `1034526`-byte `dist`, and trusted install/update was
  not rerun while host preflight is blocked. Current host preflight
  `.manual-qa/windows-msix-host-preflight.json` was refreshed at
  2026-08-21 20:10 Asia/Shanghai (`2026-08-21T12:10:23.8809707Z`) with
  `status: "blocked"`, `hostReadyForTrustedMsix: false`,
  `currentShellElevated: false`, `trustedMsixQaReadiness: "host-blocked"`,
  blockerClassification `windows-appx-deployment-deleted-package-cleanup-failure`,
  and SHA-256
  `E7322D7D734E21A4423BFB7A9D61B2061C08B8608C95B3874A188C82BA3C9E1B`. The current package candidate is
  `.manual-qa/ZeroChat_0.0.1.0_x64.msix` (1,382,360 bytes / SHA-256
  `2C8980E6F4FEBAE56AEF79E5B07D58B948837F4B367A477AC6E72BB1A82151CD`) with a staged web tree matching current `dist` at
  52 files / 1,034,526 bytes / SHA-256
  `1F2718F6F896A487B131BD259A63CB882D0F9E16A45E8C89F1A519039FF4DFC7`, stageWebMatchesDist: true.
  The package-internal web tree matches current `dist` and staged web at
  52 files / 1,034,526 bytes / SHA-256
  `1F2718F6F896A487B131BD259A63CB882D0F9E16A45E8C89F1A519039FF4DFC7`, packageWebMatchesDist: true, packageWebMatchesStage: true.
- The active host path is report-derived from `.manual-qa/windows-msix-host-preflight.json`; current trusted MSIX release evidence remains blocked until that report and target-host proof pass.
- This remains packaging freshness, not release-pass evidence; current trusted
  install/update/uninstall release-pass evidence is still missing, while run
  `20260615-092543` is historical diagnostic context; currentShellElevated: false.
  Windows trusted MSIX current blocker semantics: blockerKind `windows-appx-deployment-deleted-package-cleanup-failure`, owner `host-windows-appx-deployment-service`; currentTrustedQaState `host-preflight-blocked-or-unproven`; needsElevatedTrustedQaRerun false; nextProofGate `Codex is an active WindowsApps Deleted lock holder; do not interrupt an active Codex work session. Use a fresh disposable Windows profile or VM for trusted MSIX QA, or rerun the host preflight after Codex exits; repair or replace the host only if unlocked deleted-package targets remain`; hostPreflight status `blocked`, trustedMsixQaReadiness `host-blocked`; historicalTrustedQaFailureKind `windows-appx-deployment-deleted-package-cleanup-access-denied`, historicalTrustedQaFailureOwner `host-windows-appx-deployment-service`.
  blocked by Windows AppXDeploymentServer cleanup access-denied state, so that
  run is historical diagnostic evidence only and the next proof must come from
  a repaired or clean disposable Windows host before trusted MSIX QA can be
  rerun.
- Apple and Linux still need real platform builds and visual QA on machines with
  the required SDKs. Windows Debug/Release build, visual smoke, MSIX manifest
  readiness, `makeappx` packaging, SignTool signing, unsigned dry-run, and
  signed-but-untrusted dry-run are covered locally, but current trusted
  install/update/uninstall release-pass evidence remains open. Use
  `pnpm run report:windows-msix-host-preflight`, then only after a clear
  elevated host run `pnpm run qa:windows-msix-trusted:elevated`,
  `pnpm run check:windows-msix-trusted-report`,
  `pnpm run check:runtime-artifacts`, and `pnpm run check:local-cleanup`.
- Live-provider full-capability release evidence remains open: current 2026-08-18 01:21 Asia/Shanghai
  full-current report status is `failed`; current
  no-credential diagnostic refreshed at 2026-08-21 20:11 Asia/Shanghai has SHA-256
  `4460F61DA0794698BD3B4E2F83FA93B61A602A5A2B4B375E60FF7773671B8B0E`, while Live provider credential-confirmed full-capability attempt SHA-256 is
  `F284A79F80C6F5EE0B7F35A9CA0EB08E35CF777A69ED444373A83D12F3776D61`, with source fingerprint 112 files / 1,889,955 / SHA-256
  `4C4FB35B5B599BD27F14B13C5A9DDB613DE16221CDDB78F389118A7096682BB9`.
  Live provider full-capability required remediation: source `none`; capabilityFailureSummary.total 0; affectedCapabilities `none`; routeHealthBlockers `none`; capabilityRemediationHintCount 0; reportRemediationHintCount 0; remediationTargets `none`; rerunCommands `pnpm run drill:live-provider` / `pnpm run check:live-provider-report` / `pnpm run check:live-provider-full-capability`.
  Live provider UI loopback Worker contract diagnostic: path `.manual-qa/live-provider-ui-local-proxy-diagnostic.json`, status `skipped`, releaseEvidence false, browserUiExecuted false, browserOriginProven false, workerHostedProviderKeyConfigured true, providerKeyBrowserExposed false, requestCredentialsAbsent false, modelListStatus `unknown`, chatStatus `unknown`, selectedModel `unknown`, markerCaptured false, harnessClosed false, sourceFingerprintCurrent true; loopback contract proof is diagnostic-only and does not prove a deployed browser origin.
- Live-provider Web UI browser-origin release evidence remains open: the
  credential-confirmed UI attempt hash is `D4688430106EEA0240A304D877E59E846998AC44BF874F3092D37F32A08E047D`,
  generatedAt `2026-08-06T00:35:19.546Z`, selected model `gpt-5-6-pro`, with UI source fingerprint schema `zerochat.liveProviderUiSourceFingerprint.v1`, 261 files / 2,805,890 / SHA-256 `93CDA924607AE98B60E18A400981D476EC4D9E63D6858B70B2FF40CC3A58113D`; it needs
  a browser-allowed AI proxy or Cloudflare Worker root before release-pass UI
  evidence can exist.
  Live provider UI required remediation: kind `missing-live-provider-ui-inputs`; browserAllowedProxyRequired true; requiresProxyUrl true; requiresSyncPassphrase true; requiresWorkerHostedProviderKey true; actionCount 4; actions `Configure a browser-allowed AI proxy/Cloudflare Worker root through ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL; direct provider mode is diagnostic-only and cannot produce browser-origin release evidence.` / `Provide ZEROCHAT_LIVE_PROVIDER_UI_SYNC_PASSPHRASE so the browser can derive the Worker access key.` / `Set ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY=true, store the provider key as a Worker secret, and do not inject the provider key into the browser.` / `Provide remaining release UI inputs (providerBaseUrl, sendConfirmation) before rerunning pnpm run drill:live-provider-ui.`.
- Disposable Cloudflare/Gist live-sync release-pass and hosted native CI remain open. Current 2026-08-21 20:11 Asia/Shanghai
  live-sync diagnostic hash is `7E42538F024E2E539CC773E6D8EF1E6171FA0AFEDB634F3ED3B84A525C90B91E`, with source fingerprint
  65 files / 1,017,099 /
  SHA-256 `CF06D480593C9D0A77345314F0277C95F6170972AC950BD515CC578912B22B79`; current 2026-08-21 20:11 Asia/Shanghai
  hosted native CI diagnostic hash is `AAF8DA4C3F9A7153494FA1C9A00ABFB39CD8D81C66C9CA16267551CCCFF02C77`.
- Native prerequisite diagnostic remains current at 2026-08-21 20:11 Asia/Shanghai; Apple and Linux target runtime QA still require target hosts.
