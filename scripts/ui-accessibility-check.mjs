import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const [
  appShellSource,
  appRootSource,
  readyStageProviderControllersSource,
  appRootStateControllerSource,
  appRootBridgeControllerSource,
  cssSource,
  indexCssSource,
  tokensCssSource,
  indexHtmlSource,
  startupScriptSource,
  i18nSource,
  localeKeysSource,
  zhLocaleSource,
  visualAuditSource,
  browserSmokeSource,
  chatContextWindowSmokeSource,
  composerAutosizeSmokeSource,
  messageVirtualizationSmokeSource,
  typesSource,
  presetsSource,
  appDataSource,
  chatServiceSource,
  lazySource,
  markdownSource,
  uiRuntimeSource,
  imageAttachmentsSource,
  providerConfigSource,
  providerStatusSource,
  providerSettingsControllerSource,
  providerConnectivityChecksSource,
  providerSettingsControllerTestSource,
  firstRunGuideStateSource,
  firstRunGuideControllerSource,
  firstRunGuideControllerTestSource,
  providerModelsSource,
  providerModelEditorControllerSource,
  chatModelMenuSource,
  chatModelMenuControllerSource,
  conversationTitleEditSource,
  conversationTitleEditControllerSource,
  conversationLifecycleControllerSource,
  conversationLifecycleControllerTestSource,
  composerFocusSource,
  interactionFocusSource,
  interactionFocusTestSource,
  dangerConfirmationSource,
  dangerConfirmationControllerSource,
  modalFocusSource,
  modalFocusControllerSource,
  sidebarChromeSource,
  sidebarControllerSource,
  settingsSkillListSource,
  settingsSkillListControllerSource,
  settingsSkillActionsSource,
  settingsSkillControllerSource,
  syncSettingsControllerSource,
  syncRuntimeControllerSource,
  syncRuntimeControllerTestSource,
  settingsViewportControllerSource,
  composerLayoutSource,
  composerChromeSource,
  composerReadinessSource,
  chatSessionStateSource,
  chatGenerationControllerSource,
  chatGenerationTextSubmitSource,
  chatGenerationImageAttachmentsSource,
  chatGenerationImageSubmitSource,
  chatGenerationMessageActionsSource,
  chatGenerationRuntimeSource,
  chatGenerationControllerTestSource,
  imageComposerChromeSource,
  imageComposerControllerSource,
  appLogoSource,
  appStateScreensSource,
  appReadyStageSource,
  appMainViewSource,
  chatPaneViewSource,
  chatPaneTypesSource,
  chatPaneMessageSectionSource,
  chatPaneComposerSectionSource,
  appOverlaysViewSource,
  settingsOverlayHostSource,
  settingsOverlaySource,
  settingsOverlayPagePropsSource,
  chatComposerSource,
  composerToolbarSource,
  imageComposerPanelSource,
  imageComposerPanelTestSource,
  audioComposerPanelSource,
  chatHeaderSource,
  chatHeaderTitleSource,
  chatProviderModelMenuSource,
  messageListSource,
  messageBubbleSource,
  messageContextMenuSource,
  messageContextMenuServiceSource,
  messageContextMenuControllerSource,
  noticeSource,
  appNoticeControllerSource,
  appMessageControllerSource,
  appMessageControllerTestSource,
  appBootstrapControllerSource,
  appBootstrapControllerTestSource,
  appNavigationControllerSource,
  appNavigationControllerTestSource,
  appRuntimeControllerSource,
  appRuntimeControllerTestSource,
  appChromeControllerSource,
  appChromeControllerTestSource,
  appInteractionControllerSource,
  appInteractionControllerTestSource,
  appEscapeControllerSource,
  appEscapeControllerTestSource,
  delayedTooltipSource,
  delayedTooltipDomSource,
  delayedTooltipTestSource,
  featureHintSource,
  featureHintsSource,
  featureHintControllerSource,
  firstRunGuideShellSource,
  firstRunGuideProviderPickerSource,
  firstRunGuideProviderFieldsSource,
  firstRunGuideSyncPanelSource,
  firstRunGuideActionsSource,
  secretInputSource,
  secretInputRendererSource,
  settingsNavSource,
  settingsNavTestSource,
  settingsPageSource,
  settingsDialogChromeSource,
  settingsPanelRouterSource,
  settingsPageTypesSource,
  sidebarSource,
  syncStatusButtonSource,
  appearanceSettingsPanelSource,
  providerSettingsPanelSource,
  providerSettingsListSource,
  providerSettingsEditorSource,
  modelSettingsPanelSource,
  modelProviderListSource,
  modelDefaultsPanelSource,
  modelCatalogEditorSource,
  modelCatalogEditorTestSource,
  skillSettingsPanelSource,
  skillImportPanelSource,
  skillListPanelSource,
  skillRowSource,
  skillComposerPanelSource,
  syncSettingsPanelSource,
  dataSettingsPanelSource,
  welcomePanelSource,
  messageContentSource,
  messageContentCopyFeedbackSource,
  confirmationDialogsSource,
  messageVirtualizationSource,
  messageVirtualizationControllerSource,
  messageRenderingSource,
  clipboardSource,
  syncChromeSource,
  appUiStoreSource,
] =
  await Promise.all([
    readFile('src/App.tsx', 'utf8'),
    readFile('src/ZeroChatAppRoot.tsx', 'utf8'),
    readFile('src/readyStageProviderControllers.ts', 'utf8'),
    readFile('src/services/appRootStateController.ts', 'utf8'),
    readFile('src/services/appRootBridgeController.ts', 'utf8'),
    readFile('src/App.css', 'utf8'),
    readFile('src/index.css', 'utf8'),
    readFile('src/design-system/tokens.css', 'utf8'),
    readFile('index.html', 'utf8'),
    readFile('public/zerochat-startup.js', 'utf8'),
    readFile('src/i18n.ts', 'utf8'),
    readFile('src/locales/keys.ts', 'utf8'),
    readFile('src/locales/zh-CN.ts', 'utf8'),
    readFile('scripts/visual-audit.mjs', 'utf8'),
    readFile('scripts/browser-skill-smoke.mjs', 'utf8'),
    readFile('scripts/chat-context-window-smoke.mjs', 'utf8'),
    readFile('scripts/composer-autosize-smoke.mjs', 'utf8'),
    readFile('scripts/message-virtualization-smoke.mjs', 'utf8'),
    readFile('src/types.ts', 'utf8'),
    readFile('src/data/presets.ts', 'utf8'),
    readFile('src/services/appData.ts', 'utf8'),
    readFile('src/services/chat.ts', 'utf8'),
    readFile('src/services/lazy.ts', 'utf8'),
    readFile('src/services/markdown.ts', 'utf8'),
    readFile('src/services/uiRuntime.ts', 'utf8'),
    readFile('src/services/imageAttachments.ts', 'utf8'),
    readFile('src/services/providerConfig.ts', 'utf8'),
    readFile('src/services/providerStatus.ts', 'utf8'),
    readFile('src/services/providerSettingsController.ts', 'utf8'),
    readFile('src/services/providerConnectivityChecks.ts', 'utf8'),
    readFile('src/services/__tests__/providerSettingsController.test.ts', 'utf8'),
    readFile('src/services/firstRunGuideState.ts', 'utf8'),
    readFile('src/services/firstRunGuideController.ts', 'utf8'),
    readFile('src/services/__tests__/firstRunGuideController.test.ts', 'utf8'),
    readFile('src/services/providerModels.ts', 'utf8'),
    readFile('src/services/providerModelEditorController.ts', 'utf8'),
    readFile('src/services/chatModelMenu.ts', 'utf8'),
    readFile('src/services/chatModelMenuController.ts', 'utf8'),
    readFile('src/services/conversationTitleEdit.ts', 'utf8'),
    readFile('src/services/conversationTitleEditController.ts', 'utf8'),
    readFile('src/services/conversationLifecycleController.ts', 'utf8'),
    readFile('src/services/__tests__/conversationLifecycleController.test.ts', 'utf8'),
    readFile('src/services/composerFocus.ts', 'utf8'),
    readFile('src/services/interactionFocus.ts', 'utf8'),
    readFile('src/services/__tests__/interactionFocus.test.ts', 'utf8'),
    readFile('src/services/dangerConfirmation.ts', 'utf8'),
    readFile('src/services/dangerConfirmationController.ts', 'utf8'),
    readFile('src/services/modalFocus.ts', 'utf8'),
    readFile('src/services/modalFocusController.ts', 'utf8'),
    readFile('src/services/sidebarChrome.ts', 'utf8'),
    readFile('src/services/sidebarController.ts', 'utf8'),
    readFile('src/services/settingsSkillList.ts', 'utf8'),
    readFile('src/services/settingsSkillListController.ts', 'utf8'),
    readFile('src/services/settingsSkillActions.ts', 'utf8'),
    readFile('src/services/settingsSkillController.ts', 'utf8'),
    readFile('src/services/syncSettingsController.ts', 'utf8'),
    readFile('src/services/syncRuntimeController.ts', 'utf8'),
    readFile('src/services/__tests__/syncRuntimeController.test.ts', 'utf8'),
    readFile('src/services/settingsViewportController.ts', 'utf8'),
    readFile('src/services/composerLayout.ts', 'utf8'),
    readFile('src/services/composerChrome.ts', 'utf8'),
    readFile('src/services/composerReadiness.ts', 'utf8'),
    readFile('src/services/chatSessionState.ts', 'utf8'),
    readFile('src/services/chatGenerationController.ts', 'utf8'),
    readFile('src/services/chatGenerationTextSubmit.ts', 'utf8'),
    readFile('src/services/chatGenerationImageAttachments.ts', 'utf8'),
    readFile('src/services/chatGenerationImageSubmit.ts', 'utf8'),
    readFile('src/services/chatGenerationMessageActions.ts', 'utf8'),
    readFile('src/services/chatGenerationRuntime.ts', 'utf8'),
    readFile('src/services/__tests__/chatGenerationController.test.ts', 'utf8'),
    readFile('src/services/imageComposerChrome.ts', 'utf8'),
    readFile('src/services/imageComposerController.ts', 'utf8'),
    readFile('src/components/AppLogo.tsx', 'utf8'),
    readFile('src/components/AppStateScreens.tsx', 'utf8'),
    readFile('src/components/AppReadyStage.tsx', 'utf8'),
    readFile('src/components/AppMainView.tsx', 'utf8'),
    readFile('src/components/ChatPaneView.tsx', 'utf8'),
    readFile('src/components/ChatPaneTypes.ts', 'utf8'),
    readFile('src/components/ChatPaneMessageSection.tsx', 'utf8'),
    readFile('src/components/ChatPaneComposerSection.tsx', 'utf8'),
    readFile('src/components/AppOverlaysView.tsx', 'utf8'),
    readFile('src/components/SettingsOverlayHost.tsx', 'utf8'),
    readFile('src/components/SettingsOverlay.tsx', 'utf8'),
    readFile('src/components/SettingsOverlayPageProps.tsx', 'utf8'),
    readFile('src/components/ChatComposer.tsx', 'utf8'),
    readFile('src/components/ComposerToolbar.tsx', 'utf8'),
    readFile('src/components/ImageComposerPanel.tsx', 'utf8'),
    readFile('src/components/__tests__/ImageComposerPanel.test.tsx', 'utf8'),
    readFile('src/components/AudioComposerPanel.tsx', 'utf8'),
    readFile('src/components/ChatHeader.tsx', 'utf8'),
    readFile('src/components/ChatHeaderTitle.tsx', 'utf8'),
    readFile('src/components/ChatProviderModelMenu.tsx', 'utf8'),
    readFile('src/components/MessageList.tsx', 'utf8'),
    readFile('src/components/MessageBubble.tsx', 'utf8'),
    readFile('src/components/MessageContextMenu.tsx', 'utf8'),
    readFile('src/services/messageContextMenu.ts', 'utf8'),
    readFile('src/services/messageContextMenuController.ts', 'utf8'),
    readFile('src/components/Notice.tsx', 'utf8'),
    readFile('src/services/appNoticeController.ts', 'utf8'),
    readFile('src/services/appMessageController.ts', 'utf8'),
    readFile('src/services/__tests__/appMessageController.test.ts', 'utf8'),
    readFile('src/services/appBootstrapController.ts', 'utf8'),
    readFile('src/services/__tests__/appBootstrapController.test.ts', 'utf8'),
    readFile('src/services/appNavigationController.ts', 'utf8'),
    readFile('src/services/__tests__/appNavigationController.test.ts', 'utf8'),
    readFile('src/services/appRuntimeController.ts', 'utf8'),
    readFile('src/services/__tests__/appRuntimeController.test.ts', 'utf8'),
    readFile('src/services/appChromeController.ts', 'utf8'),
    readFile('src/services/__tests__/appChromeController.test.ts', 'utf8'),
    readFile('src/services/appInteractionController.ts', 'utf8'),
    readFile('src/services/__tests__/appInteractionController.test.ts', 'utf8'),
    readFile('src/services/appEscapeController.ts', 'utf8'),
    readFile('src/services/__tests__/appEscapeController.test.ts', 'utf8'),
    readFile('src/components/DelayedTooltip.tsx', 'utf8'),
    readFile('src/components/delayedTooltipDom.ts', 'utf8'),
    readFile('src/components/__tests__/DelayedTooltip.test.tsx', 'utf8'),
    readFile('src/components/FeatureHint.tsx', 'utf8'),
    readFile('src/services/featureHints.ts', 'utf8'),
    readFile('src/services/featureHintController.tsx', 'utf8'),
    readFile('src/components/FirstRunGuide.tsx', 'utf8'),
    readFile('src/components/FirstRunGuideProviderPicker.tsx', 'utf8'),
    readFile('src/components/FirstRunGuideProviderFields.tsx', 'utf8'),
    readFile('src/components/FirstRunGuideSyncPanel.tsx', 'utf8'),
    readFile('src/components/FirstRunGuideActions.tsx', 'utf8'),
    readFile('src/components/SecretInput.tsx', 'utf8'),
    readFile('src/services/secretInputRenderer.tsx', 'utf8'),
    readFile('src/components/SettingsNav.tsx', 'utf8'),
    readFile('src/components/__tests__/SettingsNav.test.tsx', 'utf8'),
    readFile('src/components/SettingsPage.tsx', 'utf8'),
    readFile('src/components/SettingsDialogChrome.tsx', 'utf8'),
    readFile('src/components/SettingsPanelRouter.tsx', 'utf8'),
    readFile('src/components/SettingsPageTypes.ts', 'utf8'),
    readFile('src/components/Sidebar.tsx', 'utf8'),
    readFile('src/components/SyncStatusButton.tsx', 'utf8'),
    readFile('src/components/AppearanceSettingsPanel.tsx', 'utf8'),
    readFile('src/components/ProviderSettingsPanel.tsx', 'utf8'),
    readFile('src/components/ProviderSettingsList.tsx', 'utf8'),
    readFile('src/components/ProviderSettingsEditor.tsx', 'utf8'),
    readFile('src/components/ModelSettingsPanel.tsx', 'utf8'),
    readFile('src/components/ModelProviderList.tsx', 'utf8'),
    readFile('src/components/ModelDefaultsPanel.tsx', 'utf8'),
    readFile('src/components/ModelCatalogEditor.tsx', 'utf8'),
    readFile('src/components/__tests__/ModelCatalogEditor.test.tsx', 'utf8'),
    readFile('src/components/SkillSettingsPanel.tsx', 'utf8'),
    readFile('src/components/SkillImportPanel.tsx', 'utf8'),
    readFile('src/components/SkillListPanel.tsx', 'utf8'),
    readFile('src/components/SkillRow.tsx', 'utf8'),
    readFile('src/components/SkillComposerPanel.tsx', 'utf8'),
    readFile('src/components/SyncSettingsPanel.tsx', 'utf8'),
    readFile('src/components/DataSettingsPanel.tsx', 'utf8'),
    readFile('src/components/WelcomePanel.tsx', 'utf8'),
    readFile('src/components/MessageContent.tsx', 'utf8'),
    readFile('src/components/messageContentCopyFeedback.ts', 'utf8'),
    readFile('src/components/ConfirmationDialogs.tsx', 'utf8'),
    readFile('src/services/messageVirtualization.ts', 'utf8'),
    readFile('src/services/messageVirtualizationController.ts', 'utf8'),
    readFile('src/services/messageRendering.ts', 'utf8'),
    readFile('src/services/clipboard.ts', 'utf8'),
    readFile('src/services/syncChrome.ts', 'utf8'),
    readFile('src/state/store.ts', 'utf8'),
  ])
const [
  lazyOverlayRecoverySource,
  lazyOverlayLoaderSource,
  lazyOverlayRecoveryTestSource,
  settingsOverlayPreloadSmokeSource,
] = await Promise.all([
  readFile('src/components/LazyOverlayRecovery.tsx', 'utf8'),
  readFile('src/components/lazyOverlayLoader.ts', 'utf8'),
  readFile('src/components/__tests__/LazyOverlayRecovery.test.tsx', 'utf8'),
  readFile('scripts/settings-overlay-preload-smoke.mjs', 'utf8'),
])
const [
  mainEntrySource,
  appRuntimeBoundarySource,
  appRuntimeBoundaryTestSource,
  startupFatalErrorSource,
  startupFatalErrorTestSource,
] = await Promise.all([
  readFile('src/main.tsx', 'utf8'),
  readFile('src/components/AppRuntimeBoundary.tsx', 'utf8'),
  readFile('src/components/__tests__/AppRuntimeBoundary.test.tsx', 'utf8'),
  readFile('src/services/startupFatalError.ts', 'utf8'),
  readFile('src/services/__tests__/startupFatalError.test.ts', 'utf8'),
])
const webTsxButtonSources = await Promise.all(
  (await listTsxPaths('src')).map(async (path) => [
    path.replace(/\\/gu, '/'),
    await readFile(path, 'utf8'),
  ]),
)
const appSource = `${appShellSource}\n${appRootSource}`
const chatPaneSurfaceSource = [
  chatPaneViewSource,
  chatPaneTypesSource,
  chatPaneMessageSectionSource,
  chatPaneComposerSectionSource,
].join('\n')
const firstRunGuideSource = [
  firstRunGuideShellSource,
  firstRunGuideProviderPickerSource,
  firstRunGuideProviderFieldsSource,
  firstRunGuideSyncPanelSource,
  firstRunGuideActionsSource,
].join('\n')
const providerSettingsSource = [
  providerSettingsPanelSource,
  providerSettingsListSource,
  providerSettingsEditorSource,
].join('\n')
const modelSettingsSource = [
  modelSettingsPanelSource,
  modelProviderListSource,
  modelDefaultsPanelSource,
  modelCatalogEditorSource,
].join('\n')
const composerSurfaceSource = [
  chatComposerSource,
  composerToolbarSource,
  imageComposerPanelSource,
].join('\n')
const skillSettingsSource = [
  skillSettingsPanelSource,
  skillImportPanelSource,
  skillListPanelSource,
  skillRowSource,
  skillComposerPanelSource,
].join('\n')
const failures = []

function expect(condition, message) {
  if (!condition) {
    failures.push(message)
  }
}

function has(pattern, source = appSource) {
  return pattern instanceof RegExp ? pattern.test(source) : source.includes(pattern)
}

function countOccurrences(pattern, source = appSource) {
  return pattern instanceof RegExp
    ? [...source.matchAll(pattern)].length
    : source.split(pattern).length - 1
}

async function listTsxPaths(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const paths = []

  for (const entry of entries) {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) {
      paths.push(...(await listTsxPaths(path)))
    } else if (entry.isFile() && path.endsWith('.tsx')) {
      paths.push(path)
    }
  }

  return paths
}

function implicitSubmitButtonViolations(sourceEntries) {
  const violations = []

  for (const [path, source] of sourceEntries) {
    for (const match of source.matchAll(/<button\b[\s\S]*?>/gu)) {
      if (/\btype\s*=/u.test(match[0])) {
        continue
      }

      const line = source.slice(0, match.index).split(/\r?\n/u).length
      const tag = match[0].replace(/\s+/gu, ' ').slice(0, 140)
      violations.push(`${path}:${line} ${tag}`)
    }
  }

  return violations
}

function lineCount(source) {
  return source.trimEnd().split(/\r?\n/).length
}

function doubleQuotedStringValues(source, sourcePath) {
  const values = []

  for (const match of source.matchAll(/"(?:\\.|[^"\\])*"/g)) {
    try {
      values.push(JSON.parse(match[0]))
    } catch (error) {
      failures.push(`Unable to parse string literal in ${sourcePath}: ${error.message}`)
    }
  }

  return values
}

const translationKeyList = doubleQuotedStringValues(localeKeysSource, 'src/locales/keys.ts')
const implicitSubmitButtons = implicitSubmitButtonViolations(webTsxButtonSources)
expect(
  implicitSubmitButtons.length === 0,
  `All Web/PWA <button> elements must declare an explicit type. Missing: ${implicitSubmitButtons.join('; ')}`,
)

function localeValue(localeSource, sourcePath, key) {
  const keyIndex = translationKeyList.indexOf(key)

  if (keyIndex === -1) {
    failures.push(`Missing translation key ${key} in src/locales/keys.ts.`)
    return null
  }

  const values = doubleQuotedStringValues(localeSource, sourcePath)

  if (values.length !== translationKeyList.length) {
    failures.push(
      `${sourcePath} has ${values.length} locale values for ${translationKeyList.length} translation keys.`,
    )
  }

  return values[keyIndex] ?? null
}

function localeHasValue(localeSource, sourcePath, key, expected) {
  return localeValue(localeSource, sourcePath, key) === expected
}

expect(
  lineCount(appShellSource) < 50 &&
    has("from './ZeroChatAppRoot'", appShellSource) &&
    has('<ZeroChatAppRoot />', appShellSource) &&
    !has('useState(', appShellSource) &&
    !has('useEffect(', appShellSource) &&
    !has('<AppMainView', appShellSource) &&
    !has('<AppOverlaysView', appShellSource),
  'App.tsx must stay a PRD-thin entry point under 50 lines and delegate runtime UI to ZeroChatAppRoot.',
)
expect(
  has('export function ZeroChatAppRoot()', appRootSource) &&
    lineCount(appRootSource) < 1014 &&
    has("import { RootReadinessScreen } from './components/AppStateScreens'", appRootSource) &&
    has("from './services/appRootStateController'", appRootSource) &&
    has("from './services/appRootBridgeController'", appRootSource) &&
    !has('useState(', appRootSource) &&
    !has('useRef(', appRootSource) &&
    has('export function useAppRootStateController()', appRootStateControllerSource) &&
    has('const [data, setData] = useState<AppData | null>(null)', appRootStateControllerSource) &&
    has('const dataRef = useRef<AppData | null>(null)', appRootStateControllerSource) &&
    has('export function useCommitEditsOnBlur', appRootBridgeControllerSource) &&
    has('export function useSyncControllerRefs', appRootBridgeControllerSource) &&
    has('export function useOfflineQueueFlushRef', appRootBridgeControllerSource) &&
    has('export function messageForContextMenu', appRootBridgeControllerSource) &&
    has('rootGuideVisible(', appRootSource) &&
    has('guideSuccessPending,', appRootSource) &&
    has('export function rootGuideVisible', appRootBridgeControllerSource) &&
    has('const syncFirstConflictPromptOpen = rootPromptOpen(syncFirstConflictPrompt)', appRootSource) &&
    has('const dangerPromptOpen = rootPromptOpen(dangerPrompt)', appRootSource) &&
    has('export function rootPromptOpen', appRootBridgeControllerSource) &&
    has('const rootBridgeState = deriveRootSessionBridgeState({ activeConversation, data })', appRootSource) &&
    has('export function deriveRootSessionBridgeState', appRootBridgeControllerSource) &&
    has('const rootReadiness = deriveRootReadinessState({', appRootSource) &&
    has("if (rootReadiness.kind !== 'ready')", appRootSource) &&
    has('export function deriveRootReadinessState', appRootBridgeControllerSource) &&
    has('export function RootReadinessScreen', appStateScreensSource) &&
    !has('<AppLoadErrorState', appRootSource) &&
    !has('<AppLoadingState', appRootSource) &&
    !has('<ProviderEmptyState', appRootSource) &&
    !has('<ConversationEmptyState', appRootSource) &&
    has('useDangerWarningBridge({', appRootSource) &&
    has('export function isRootDangerWarningDismissed', appRootBridgeControllerSource) &&
    has('export function dismissRootDangerWarning', appRootBridgeControllerSource) &&
    has('export function useDangerWarningBridge', appRootBridgeControllerSource) &&
    !has('function commitEditsOnBlur', appRootSource) &&
    !has('dangerWarningDismissed', appRootSource) &&
    !has('dismissDangerWarningInData', appRootSource) &&
    !has('function hasDismissedDangerWarning', appRootSource) &&
    !has('function dismissDangerWarning', appRootSource) &&
    !has('DangerWarningId', appRootSource) &&
    !has('Boolean(syncFirstConflictPrompt)', appRootSource) &&
    !has('Boolean(dangerPrompt)', appRootSource) &&
    !has('activeConversation?.id', appRootSource) &&
    !has('data?.sync.mode', appRootSource) &&
    !has('Boolean(data?.preferences.firstRunDone)', appRootSource) &&
    has("import { AppReadyStage } from './components/AppReadyStage'", appRootSource) &&
    has('<AppReadyStage', appRootSource) &&
    has('export function AppReadyStage', appReadyStageSource) &&
    has('<AppMainView {...props} />', appReadyStageSource) &&
    has('<AppOverlaysView {...props} />', appReadyStageSource),
  'ZeroChatAppRoot must own runtime composition while root state, readiness screens, and bridge glue stay in focused controllers.',
)

function varsFromBlock(pattern, fallback = {}) {
  const block = tokensCssSource.match(pattern)?.[1] ?? ''
  const rawVars = Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2].trim(),
    ]),
  )
  const resolved = { ...fallback }

  function resolve(name, stack = []) {
    if (resolved[name]) {
      return resolved[name]
    }

    const value = rawVars[name]
    if (!value || stack.includes(name)) {
      return undefined
    }

    const hex = value.match(/^#[0-9a-fA-F]{6}\b/)
    if (hex) {
      resolved[name] = hex[0]
      return resolved[name]
    }

    const alias = value.match(/^var\(--([\w-]+)\)$/)
    if (alias) {
      const aliasValue = resolve(alias[1], [...stack, name])
      if (aliasValue) {
        resolved[name] = aliasValue
      }
      return aliasValue
    }

    return undefined
  }

  for (const name of Object.keys(rawVars)) {
    resolve(name)
  }

  return resolved
}

function luminance(hex) {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
  const [red, green, blue] = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  )

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function hslFromHex(hex) {
  const [red, green, blue] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2

  if (max === min) {
    return { hue: 0, lightness, saturation: 0 }
  }

  const delta = max - min
  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let hue =
    max === red
      ? (green - blue) / delta + (green < blue ? 6 : 0)
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4
  hue *= 60

  return { hue, lightness, saturation }
}

function contrastRatio(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
    (left, right) => right - left,
  )

  return (lighter + 0.05) / (darker + 0.05)
}

function expectContrast(vars, foreground, background, minimum, label) {
  expect(
    Boolean(vars[foreground]) &&
      Boolean(vars[background]) &&
      contrastRatio(vars[foreground], vars[background]) >= minimum,
    `${label} contrast must be at least ${minimum}:1.`,
  )
}

function expectCrispLightSurface(vars, name) {
  const value = vars[name]
  const { hue, lightness, saturation } = value ? hslFromHex(value) : {}
  const warmCreamHue = saturation > 0.04 && hue >= 35 && hue <= 80

  expect(Boolean(value), `light ${name} color token must exist.`)
  expect(
    lightness >= 0.93,
    `light ${name} must stay bright and clean instead of muddy: ${value}.`,
  )
  expect(
    !warmCreamHue,
    `light ${name} must avoid cream/tan hue dominance: ${value}.`,
  )
}

const lightVars = varsFromBlock(/:root\s*\{([\s\S]*?)\n\}/)
const darkVars = varsFromBlock(/:root\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/, lightVars)

for (const token of ['bg', 'side', 'surface', 'field']) {
  expectCrispLightSurface(lightVars, token)
}
expect(
  has('aria-labelledby="settings-title"', settingsDialogChromeSource) &&
    has('aria-describedby="settings-description"', settingsDialogChromeSource) &&
    has('id="settings-title"', settingsDialogChromeSource) &&
    has('id="settings-description"', settingsDialogChromeSource) &&
    has('aria-label={t(\'button.closeSettings\')}', settingsDialogChromeSource),
  'Settings dialog must have a labelled title, description, and close button.',
)
for (const [theme, vars] of [
  ['light', lightVars],
  ['dark', darkVars],
]) {
  expectContrast(vars, 'text', 'bg', 4.5, `${theme} body text`)
  expectContrast(vars, 'text-strong', 'surface', 4.5, `${theme} strong text`)
  expectContrast(vars, 'muted', 'surface', 4.5, `${theme} muted text`)
  expectContrast(vars, 'danger', 'danger-soft', 4.5, `${theme} danger text`)
  expectContrast(vars, 'warning', 'warning-soft', 4.5, `${theme} warning text`)
  expectContrast(vars, 'accent-contrast', 'accent', 4.5, `${theme} accent button`)
}
expect(
  has('color: var(--accent-contrast);', cssSource),
  'Accent buttons and user avatars must use theme-specific contrast text instead of hardcoded white.',
)
const unlabeledIconButtons = [...appSource.matchAll(/<button[\s\S]*?className=(?:\{[^}]*icon-button[^}]*\}|"[^"]*icon-button[^"]*")[\s\S]*?<\/button>/g)]
  .filter((match) => !match[0].includes('aria-label='))
  .map((match) => appSource.slice(0, match.index).split('\n').length)
const titledButtonsWithoutLabel = [...appSource.matchAll(/<button[\s\S]*?<\/button>/g)]
  .filter((match) => match[0].includes('title=') && !match[0].includes('aria-label='))
  .map((match) => appSource.slice(0, match.index).split('\n').length)

expect(
  unlabeledIconButtons.length === 0,
  `Icon-only buttons must expose aria-label. Missing at lines: ${unlabeledIconButtons.join(', ')}`,
)
expect(
  titledButtonsWithoutLabel.length === 0,
  `Buttons with title text must also expose aria-label. Missing at lines: ${titledButtonsWithoutLabel.join(', ')}`,
)
expect(
  has('const messageAccessibleLabel = messageAccessibleName({', messageBubbleSource) &&
    has('const messageActionLabel = (action: string, subject?: string): string => {', messageBubbleSource) &&
    !has('title={speakMessageLabel}', messageBubbleSource) &&
    has('data-tooltip={speakMessageLabel}', messageBubbleSource) &&
    has('aria-label={speakMessageLabel}', messageBubbleSource) &&
    !has('title={downloadMessageLabel}', messageBubbleSource) &&
    has('data-tooltip={downloadMessageLabel}', messageBubbleSource) &&
    has('aria-label={downloadMessageLabel}', messageBubbleSource) &&
    !has('title={editMessageLabel}', messageBubbleSource) &&
    has('data-tooltip={editMessageLabel}', messageBubbleSource) &&
    has('aria-label={editMessageLabel}', messageBubbleSource) &&
    !has('title={retryMessageLabel}', messageBubbleSource) &&
    has('data-tooltip={retryMessageLabel}', messageBubbleSource) &&
    has('aria-label={retryMessageLabel}', messageBubbleSource) &&
    !has('title={deleteMessageLabel}', messageBubbleSource) &&
    has('data-tooltip={deleteMessageLabel}', messageBubbleSource) &&
    has('aria-label={deleteMessageLabel}', messageBubbleSource) &&
    !has('title={attachmentDownloadLabel}', messageBubbleSource) &&
    has('data-tooltip={attachmentDownloadLabel}', messageBubbleSource) &&
    has('aria-label={attachmentDownloadLabel}', messageBubbleSource),
  'Message action and attachment icon buttons must expose message-contextual aria-label and app-level tooltip text.',
)
expect(
  has("from './MessageContextMenu'", chatPaneMessageSectionSource) &&
    has("from './services/appInteractionController'", appRootSource) &&
    has("from './messageContextMenuController'", appInteractionControllerSource) &&
    has('<MessageContextMenu', chatPaneMessageSectionSource) &&
    has('export interface MessageContextMenuState', messageContextMenuServiceSource) &&
    has('export interface MessageLongPressState', messageContextMenuServiceSource) &&
    has('export function useMessageContextMenuController(', messageContextMenuControllerSource) &&
    has('const [messageContextMenu, setMessageContextMenu]', messageContextMenuControllerSource) &&
    has('const messageContextMenuRef = useRef<HTMLDivElement | null>(null)', messageContextMenuControllerSource) &&
    has('const messageContextMenuReturnTargetRef = useRef<HTMLElement | null>(null)', messageContextMenuControllerSource) &&
    has('const messageLongPressRef = useRef<MessageLongPressState | null>(null)', messageContextMenuControllerSource) &&
    has('export const MESSAGE_LONG_PRESS_DELAY_MS = 520', messageContextMenuServiceSource) &&
    has('export const MESSAGE_LONG_PRESS_MOVE_TOLERANCE_PX = 12', messageContextMenuServiceSource) &&
    has('export function boundedMessageContextMenuPosition(', messageContextMenuServiceSource) &&
    has('export function shouldStartMessageLongPress(', messageContextMenuServiceSource) &&
    has('export function messageLongPressMovedTooFar(', messageContextMenuServiceSource) &&
    has('export function messageContextMenuNavigationIndex(', messageContextMenuServiceSource) &&
    has('onContextMenu={(event) => onMessageContextMenu(event, message)}', messageBubbleSource) &&
    has('onMessageContextMenu={openMessageContextMenu}', chatPaneMessageSectionSource) &&
    has('const formatMessageTime = (value: number): string =>', chatPaneMessageSectionSource) &&
    has('formatMessageTime={formatMessageTime}', chatPaneMessageSectionSource) &&
    has('onPointerDown={(event) => onMessageLongPressStart(event, message)}', messageBubbleSource) &&
    has('onMessageLongPressStart={startMessageLongPress}', chatPaneMessageSectionSource) &&
    has('onPointerMove={onMessageLongPressMove}', messageBubbleSource) &&
    has('onPointerUp={onFinishLongPress}', messageBubbleSource) &&
    has('onPointerCancel={onFinishLongPress}', messageBubbleSource) &&
    has('menuRef={messageContextMenuRef}', chatPaneMessageSectionSource) &&
    has('message={messageContextMenuMessage}', chatPaneMessageSectionSource) &&
    has('onKeyDown={handleMessageContextMenuKeyDown}', chatPaneMessageSectionSource) &&
    has('onKeyDown={onKeyDown}', messageContextMenuSource) &&
    has('const openMessageContextMenuAt = useCallback(', messageContextMenuControllerSource) &&
    has('const openMessageContextMenu = useCallback(', messageContextMenuControllerSource) &&
    has('const startMessageLongPress = useCallback(', messageContextMenuControllerSource) &&
    has('const moveMessageLongPress = useCallback(', messageContextMenuControllerSource) &&
    has('const finishMessageLongPress = useCallback(', messageContextMenuControllerSource) &&
    has('const messageContextMenuItems = useCallback(', messageContextMenuControllerSource) &&
    has('const handleMessageContextMenuKeyDown = useCallback(', messageContextMenuControllerSource) &&
    has('focusInteractionElement(items[nextIndex])', messageContextMenuControllerSource) &&
    has('button[role=menuitem]:not(:disabled)', messageContextMenuControllerSource) &&
    has('focusInteractionElement(messageContextMenuItems()[0])', messageContextMenuControllerSource) &&
    has('scheduleInteractionFocus(() => returnTarget)', messageContextMenuControllerSource) &&
    has('event.currentTarget.contains(activeElement)', messageContextMenuControllerSource) &&
    has('tabIndex={-1}', messageBubbleSource) &&
    has("document.addEventListener('mousedown', handlePointerDown)", messageContextMenuControllerSource) &&
    has("window.addEventListener('resize', closeMessageContextMenu)", messageContextMenuControllerSource) &&
    has('useEffect(() => cancelMessageLongPress, [cancelMessageLongPress])', messageContextMenuControllerSource) &&
    has("key === 'ArrowDown'", messageContextMenuServiceSource) &&
    has("key === 'ArrowUp'", messageContextMenuServiceSource) &&
    has("key === 'Home'", messageContextMenuServiceSource) &&
    has("key === 'End'", messageContextMenuServiceSource) &&
    has('shouldStartMessageLongPress(', messageContextMenuControllerSource) &&
    has('isMessageInteractiveTarget(event.target)', messageContextMenuControllerSource) &&
    has('async function copyMessage(message: ChatMessage)', chatGenerationMessageActionsSource) &&
    has('export function messageCopyText(', messageRenderingSource) &&
    has('export async function writeClipboardText', clipboardSource) &&
    has('function textareaClipboardFallback(value: string): boolean', clipboardSource) &&
    has("return document.execCommand('copy')", clipboardSource) &&
    has('textarea.remove()', clipboardSource) &&
    has("from './clipboard'", chatGenerationMessageActionsSource) &&
    has('await services.writeClipboardText(', chatGenerationMessageActionsSource) &&
    has("context.t('button.copyFailed')", chatGenerationMessageActionsSource) &&
    has(
      "services.messageCopyText(message, context.t('message.imageGenerated'))",
      chatGenerationMessageActionsSource,
    ) &&
    has('await services.writeClipboardText(accessKey)', syncSettingsControllerSource) &&
    !has('navigator.clipboard.writeText(cloudflareAccessKey)') &&
    has('downloadableMessageAttachment(message)', messageContextMenuSource) &&
    has('messageActionAccessibleName(action, messageAccessibleLabel, subject)', messageContextMenuSource) &&
    has('const messageAccessibleLabel = messageAccessibleName({', messageContextMenuSource) &&
    has('aria-label={messageAccessibleLabel}', messageContextMenuSource) &&
    has('aria-label={copyMessageLabel}', messageContextMenuSource) &&
    has('aria-label={speakMessageLabel}', messageContextMenuSource) &&
    has('aria-label={downloadMessageLabel}', messageContextMenuSource) &&
    has('aria-label={editMessageLabel}', messageContextMenuSource) &&
    has('aria-label={retryMessageLabel}', messageContextMenuSource) &&
    has('aria-label={deleteMessageLabel}', messageContextMenuSource) &&
    has('data-message-context-menu="true"', messageContextMenuSource) &&
    has('role="menu"', messageContextMenuSource) &&
    has('role="menuitem"', messageContextMenuSource) &&
    has('data-message-context-copy="true"', messageContextMenuSource) &&
    has('data-message-context-speak="true"', messageContextMenuSource) &&
    has('data-message-context-edit="true"', messageContextMenuSource) &&
    has('data-message-context-regenerate="true"', messageContextMenuSource) &&
    has('data-message-context-delete="true"', messageContextMenuSource) &&
    has(/\.message-context-menu\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*35;[^}]*max-width:\s*min\(240px, calc\(100vw - 16px\)\);/s, cssSource) &&
    has(/\.message-context-menu button\s*\{[^}]*min-height:\s*36px;[^}]*grid-template-columns:\s*18px minmax\(0, 1fr\);/s, cssSource) &&
    has('exerciseMessageContextMenu', browserSmokeSource) &&
    has('waitForMessageContextMenuFocus', browserSmokeSource) &&
    has('pressMessageContextMenuKey', browserSmokeSource) &&
    has('message context menu should focus the first item and support arrow/Home/End keyboard navigation', browserSmokeSource) &&
    has('message context menu Escape should restore focus to its invoking message', browserSmokeSource) &&
    has('keyboard-invoked message context menu Escape should restore the exact invoking control', browserSmokeSource) &&
    has('openMessageLongPressMenuForText', browserSmokeSource) &&
    has('message long-press menu should open without blocking normal touch scrolling before the delay', browserSmokeSource) &&
    has('message context menu should expose copy/edit/delete for user messages and copy/speak/regenerate/delete for assistant messages', browserSmokeSource),
  'Messages must expose a bounded, keyboard-navigable, message-contextual right-click and touch long-press context menu with copy/speak/edit/regenerate/delete actions and browser-smoke coverage.',
)
expect(
  has('data-attachment-download="true"', messageBubbleSource) &&
    has('className="attachment-download-button"', messageBubbleSource) &&
    has(/\.attachment-frame\s*\{[^}]*position:\s*relative;[^}]*min-width:\s*52px;[^}]*min-height:\s*52px;/s, cssSource) &&
    has(/\.generated-image\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*52px;[^}]*min-height:\s*52px;/s, cssSource) &&
    has(/\.attachment-download-button\s*\{[^}]*position:\s*absolute;[^}]*inset-inline-end:\s*8px;[^}]*width:\s*34px;[^}]*min-width:\s*34px;[^}]*height:\s*34px;[^}]*min-height:\s*34px;/s, cssSource) &&
    has('exerciseInlineImageDownload', browserSmokeSource) &&
    has('inlineImageDownloadState.dataTooltip', browserSmokeSource) &&
    has('inline image download action should trigger an image download href', browserSmokeSource),
  'Rendered image attachments must expose an inline, accessible, app-tooltipped download action anchored to the image frame.',
)
expect(
  has(
    /className="model-chip-delete"[\s\S]*?aria-label=\{deleteModelLabel\}/,
    modelCatalogEditorSource,
  ),
  'Model chip delete icon buttons must expose contextual aria-label.',
)
expect(
  has("const modelDragLabel = `${model}: ${t('settings.dragModelHint')}`", modelCatalogEditorSource) &&
    !has('title={modelDragLabel}', modelCatalogEditorSource) &&
    !has('data-tooltip={modelDragLabel}', modelCatalogEditorSource) &&
    has('[draggable]', delayedTooltipSource) &&
    has('modelChipTooltipState()', browserSmokeSource) &&
    has("waitForTooltipForSelector('.model-chip[draggable=\"true\"]')", browserSmokeSource) &&
    has(
      'Model chips should expose contextual drag reorder hints through the app tooltip without native titles',
      browserSmokeSource,
    ),
  'Model drag chips must expose model-contextual reorder hints through the app tooltip without native titles.',
)
expect(
  has("aria-label={`${t('button.up')}: ${model}`}", modelCatalogEditorSource) &&
    has("aria-label={`${t('button.down')}: ${model}`}", modelCatalogEditorSource) &&
    has('className="model-chip-move"', modelCatalogEditorSource) &&
    has('[class$=move],[class$=delete]', delayedTooltipSource),
  'Model chips must expose contextual keyboard move-up and move-down actions with matching app tooltips instead of relying only on drag reorder.',
)
expect(
  has('aria-labelledby="guide-title"', firstRunGuideSource) &&
    has('aria-describedby="guide-description"', firstRunGuideSource) &&
    has('id="guide-title"', firstRunGuideSource) &&
    has('id="guide-description"', firstRunGuideSource) &&
    has('aria-label={t(\'button.closeGuide\')}', firstRunGuideSource),
  'Guide dialog must have a labelled title, description, and close button.',
)
expect(
  has(
    'const guideProviderKeyHelpId = `guide-provider-key-help-${selectedProvider.id}`',
    firstRunGuideProviderFieldsSource,
  ) &&
    has(
      'const guideProviderKeyLocalNoteId = `guide-provider-key-local-note-${selectedProvider.id}`',
      firstRunGuideProviderFieldsSource,
    ) &&
    has('const providerKeyDescriptionIds = [', firstRunGuideProviderFieldsSource) &&
    has('providerKeyStatusDescriptionId', firstRunGuideProviderFieldsSource) &&
    has('describedBy: providerKeyDescriptionIds', firstRunGuideProviderFieldsSource) &&
    has('id={guideProviderKeyHelpId}', firstRunGuideProviderFieldsSource) &&
    has('id={guideProviderKeyLocalNoteId}', firstRunGuideProviderFieldsSource) &&
    has("t('guide.providerKeyHelpLink')", firstRunGuideProviderFieldsSource) &&
    has("t('guide.providerKeyLocalOnly')", firstRunGuideProviderFieldsSource),
  'First-run guide API key field must expose visible help, local-only guidance, and connectivity feedback through aria-describedby.',
)
expect(
  has(
    'const guideProviderNameHintId = `guide-provider-name-hint-${selectedProvider.id}`',
    firstRunGuideProviderFieldsSource,
  ) &&
    has('id={guideProviderNameHintId}', firstRunGuideProviderFieldsSource) &&
    has("t('settings.providerNameHint')", firstRunGuideProviderFieldsSource) &&
    has('aria-describedby={guideProviderNameHintId}', firstRunGuideProviderFieldsSource),
  'First-run guide custom Provider name field must expose localized display-name guidance through aria-describedby.',
)
expect(
  has(
    'const guideInterfaceTypeLabelId = `guide-interface-type-label-${selectedProvider.id}`',
    firstRunGuideProviderFieldsSource,
  ) &&
    has(
      'const guideInterfaceTypeHintId = `guide-interface-type-hint-${selectedProvider.id}`',
      firstRunGuideProviderFieldsSource,
    ) &&
    has('role="note"', firstRunGuideProviderFieldsSource) &&
    has('aria-labelledby={guideInterfaceTypeLabelId}', firstRunGuideProviderFieldsSource) &&
    has('aria-describedby={guideInterfaceTypeHintId}', firstRunGuideProviderFieldsSource) &&
    has('id={guideInterfaceTypeHintId}', firstRunGuideProviderFieldsSource) &&
    has("t('settings.interfaceTypeNoteCustom')", firstRunGuideProviderFieldsSource),
  'First-run guide custom Provider interface type note must expose fixed-protocol guidance through labelled describedby semantics.',
)
expect(
  has('const guideBaseUrlHintId = `guide-base-url-hint-${selectedProvider.id}`', firstRunGuideProviderFieldsSource) &&
    has('const baseUrlDescriptionIds = [', firstRunGuideProviderFieldsSource) &&
    has('baseUrlStatusDescriptionId', firstRunGuideProviderFieldsSource) &&
    has('id={guideBaseUrlHintId}', firstRunGuideProviderFieldsSource) &&
    has("t('settings.providerBaseUrlHint')", firstRunGuideProviderFieldsSource) &&
    has('aria-describedby={baseUrlDescriptionIds}', firstRunGuideProviderFieldsSource),
  'First-run guide custom Provider Base URL field must expose localized safe remote URL guidance and validation feedback through aria-describedby.',
)
expect(
  has('const guideProxyUrlHintId = `guide-proxy-url-hint-${selectedProvider.id}`', firstRunGuideProviderFieldsSource) &&
    has('const guideClientRequestModeHintId = `guide-client-request-mode-hint-${selectedProvider.id}`', firstRunGuideProviderFieldsSource) &&
    has('const guideWorkerHostedKeyHintId = `guide-worker-hosted-key-hint-${selectedProvider.id}`', firstRunGuideProviderFieldsSource) &&
    has('const proxyUrlDescriptionIds = [', firstRunGuideProviderFieldsSource) &&
    has('const requestUsesProxy = Boolean(selectedProviderRequest.proxyUrl?.trim())', firstRunGuideProviderFieldsSource) &&
    has('{requestUsesProxy ? (', firstRunGuideProviderFieldsSource) &&
    has('disabled: !shouldUseBrowserProviderKey(selectedProviderRequest)', firstRunGuideProviderFieldsSource) &&
    has('proxyUrlStatusDescriptionId', firstRunGuideProviderFieldsSource) &&
    has('aria-describedby={proxyUrlDescriptionIds}', firstRunGuideProviderFieldsSource) &&
    has('aria-describedby={guideClientRequestModeHintId}', firstRunGuideProviderFieldsSource) &&
    has('aria-describedby={guideWorkerHostedKeyHintId}', firstRunGuideProviderFieldsSource) &&
    has("t('settings.proxyUrlNote')", firstRunGuideProviderFieldsSource) &&
    has(
      'data-provider-connectivity-inline-error="proxyUrl"',
      firstRunGuideProviderFieldsSource,
    ) &&
    has("t('settings.clientRequestModeNote')", firstRunGuideProviderFieldsSource) &&
    has("t('settings.workerHostedKeyNote')", firstRunGuideProviderFieldsSource),
  'First-run guide custom relay proxy controls must expose proxy errors, direct-request guidance, Worker-fallback proxy state, and Worker-hosted-key privacy guidance.',
)
expect(
  has(
    'const guideDefaultModelHintId = `guide-default-model-hint-${selectedProvider.id}`',
    firstRunGuideProviderFieldsSource,
  ) &&
    has('className="sr-only"', firstRunGuideProviderFieldsSource) &&
    has('id={guideDefaultModelHintId}', firstRunGuideProviderFieldsSource) &&
    has("t('placeholder.manualOrFetchModel')", firstRunGuideProviderFieldsSource) &&
    countOccurrences(
      'aria-describedby={guideDefaultModelHintId}',
      firstRunGuideProviderFieldsSource,
    ) >= 2,
  'First-run guide default model controls must expose the visible manual-or-fetch guidance through aria-describedby.',
)
expect(
  has("const guideSyncNoteId = 'guide-sync-note'", firstRunGuideSyncPanelSource) &&
    has('id={guideSyncNoteId}', firstRunGuideSyncPanelSource) &&
    has('role="group"', firstRunGuideSyncPanelSource) &&
    has('aria-describedby={guideSyncNoteId}', firstRunGuideSyncPanelSource) &&
    has("t('setting.sync')", firstRunGuideSyncPanelSource) &&
    has("aria-pressed={data.sync.mode === 'local'}", firstRunGuideSyncPanelSource) &&
    has("aria-pressed={data.sync.mode === 'gist'}", firstRunGuideSyncPanelSource) &&
    has("aria-pressed={data.sync.mode === 'cloudflare'}", firstRunGuideSyncPanelSource) &&
    has('guideSyncNote', firstRunGuideSyncPanelSource),
  'First-run guide sync mode group must expose a named group, visible guidance, and selected mode state through aria-describedby and aria-pressed.',
)
expect(
  has("from './MessageActionBoundary'", firstRunGuideSyncPanelSource) &&
    has('onCommitSyncPassphraseOnBlur: () => LeafActionResult', firstRunGuideSyncPanelSource) &&
    has('void runLeafAction(onCommitSyncPassphraseOnBlur)', firstRunGuideSyncPanelSource),
  'First-run guide sync passphrase blur must keep contained leaf action wiring.',
)
expect(
  has('role="alertdialog"', confirmationDialogsSource) &&
    has('aria-labelledby="danger-title"', confirmationDialogsSource) &&
    has('aria-describedby="danger-description"', confirmationDialogsSource) &&
    has('id="danger-title"', confirmationDialogsSource) &&
    has('id="danger-description"', confirmationDialogsSource) &&
    has('<DangerPromptDialog', appOverlaysViewSource),
  'Danger dialog must keep its alertdialog role, accessible title, and description.',
)
expect(
  has('aria-labelledby="sync-conflict-title"', confirmationDialogsSource) &&
    has('aria-describedby="sync-conflict-description"', confirmationDialogsSource) &&
    has('id="sync-conflict-title"', confirmationDialogsSource) &&
    has('id="sync-conflict-description"', confirmationDialogsSource) &&
    has("from './MessageActionBoundary'", confirmationDialogsSource) &&
    has("runLeafAction(onResolve, 'merge')", confirmationDialogsSource) &&
    has("runLeafAction(onResolve, 'use-remote')", confirmationDialogsSource) &&
    has("runLeafAction(onResolve, 'use-local')", confirmationDialogsSource) &&
    has('<SyncFirstConflictDialog', appOverlaysViewSource),
  'First-sync conflict dialog must keep its accessible title, description, and contained resolution actions.',
)
expect(
  has('className="modal-backdrop compact-dialog-backdrop"', confirmationDialogsSource) &&
    has(
      'className="modal-backdrop danger-backdrop compact-dialog-backdrop"',
      confirmationDialogsSource,
    ) &&
    has(/@media \(max-width: 520px\)[\s\S]*?\.compact-dialog-backdrop\s*\{[^}]*place-items:\s*center;/s, cssSource) &&
    has(/@media \(max-width: 520px\)[\s\S]*?\.compact-dialog-backdrop \.danger-modal\s*\{[^}]*width:\s*min\(100%, 560px\);/s, cssSource) &&
    has(/@media \(max-width: 520px\)[\s\S]*?\.compact-dialog-backdrop \.sync-conflict-modal\s*\{[^}]*width:\s*min\(100%, 680px\);/s, cssSource),
  'Compact danger and first-sync dialogs must stay centered content-sized overlays instead of stretching full-screen.',
)
expect(
  has('function noticeA11yProps(tone: NoticeTone)', noticeSource) &&
    has("role: tone === 'error' ? 'alert' : 'status'", noticeSource) &&
    has("'aria-live': tone === 'error' ? 'assertive' : 'polite'", noticeSource) &&
    has("'aria-atomic': true", noticeSource) &&
    has('export function Notice(', noticeSource) &&
    has('export function TargetNotice(', noticeSource) &&
    has('export function MessageNotice(', noticeSource) &&
    has('<TargetNotice notice={currentNotice}', appMainViewSource) &&
    has('<MessageNotice', chatPaneMessageSectionSource),
  'Visual notice messages must also expose status/alert live-region semantics.',
)
expect(
  has("import { SyncStatusButton } from './SyncStatusButton'", sidebarSource) &&
    has('<SyncStatusButton', sidebarSource) &&
    has('variant="sidebar"', sidebarSource) &&
    has("onOpenSyncSettings={(event) => onOpenSettings(event, 'sync')}", sidebarSource) &&
    has("'sync-pill ghost-button'", syncStatusButtonSource) &&
    has('type="button"', syncStatusButtonSource) &&
    has('data-settings-opener="true"', syncStatusButtonSource) &&
    has('data-tooltip={syncChrome.pillLabel}', syncStatusButtonSource) &&
    has('aria-label={syncChrome.pillLabel}', syncStatusButtonSource) &&
    !has('title={syncChrome.pillLabel}', syncStatusButtonSource) &&
    has('className="sync-pill-status"', syncStatusButtonSource) &&
    has('role="status"', syncStatusButtonSource) &&
    has('aria-live="polite"', syncStatusButtonSource) &&
    has('aria-busy={syncing}', syncStatusButtonSource),
  'Sidebar sync status must expose live and busy semantics and open Sync settings directly.',
)
expect(
  has("from './services/appBootstrapController'") &&
    has('useAppBootstrapController({') &&
    !has('const bootstrapped = await hydrateAppBootstrap()') &&
    !has("setLoadError(redactSensitiveText(") &&
    has('export function redactSensitiveText(', uiRuntimeSource) &&
    has("export const REDACTED_URL = '[redacted-url]'", uiRuntimeSource) &&
    has('export function useAppBootstrapController', appBootstrapControllerSource) &&
    has('export function applyAppBootstrapResult', appBootstrapControllerSource) &&
    has('export function formatAppBootstrapError', appBootstrapControllerSource) &&
    has('redactSensitiveText(error instanceof Error', appBootstrapControllerSource) &&
    has(
      'hydrates refs and UI state from the startup result in one focused path',
      appBootstrapControllerTestSource,
    ) &&
    has(
      'redacts secrets before surfacing startup load failures',
      appBootstrapControllerTestSource,
    ) &&
    has('<AppLoadErrorState', appStateScreensSource) &&
    has('export function AppLoadErrorState(', appStateScreensSource) &&
    has("t('ui.loadFailed')", appStateScreensSource) &&
    has("t('button.reload')", appStateScreensSource) &&
    has('window.location.reload()'),
  'Startup load failures must show a safe, localized retry path instead of a dead-end error.',
)
expect(
  has('<noscript>', await readFile('index.html', 'utf8')) &&
    has('ZeroChat 需要 JavaScript', await readFile('index.html', 'utf8')) &&
    has('ZeroChat needs JavaScript', await readFile('index.html', 'utf8')),
  'The Web/PWA shell must explain the JavaScript requirement instead of rendering a blank page.',
)
expect(
  has('<span>{t(\'danger.skip\')}</span>', confirmationDialogsSource) &&
    has(/\.danger-skip\s*\{[^}]*box-sizing:\s*border-box;[^}]*display:\s*flex;[^}]*width:\s*100%;/s, cssSource) &&
    has(/\.danger-skip span\s*\{[^}]*flex:\s*1 1 180px;[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/s, cssSource),
  'Danger skip confirmation text must wrap safely on compact mobile dialogs.',
)
expect(
  has("id: 'rotate-sync-passphrase'", dangerConfirmationSource) &&
    has("id: 'reset-sync-passphrase'", dangerConfirmationSource) &&
    has('prompt.allowSkip !== false', confirmationDialogsSource) &&
    has("confirmIcon: 'key'", dangerConfirmationSource),
  'Sync password change/reset confirmations must be non-skippable high-risk dialogs.',
)
expect(
  has("t('button.resetSyncPassword')", dataSettingsPanelSource) &&
    has('onClick={() => runLeafAction(onResetSyncPassphrase)}', dataSettingsPanelSource) &&
    has(
      'onResetSyncPassphrase={() => runLeafAction(resetSyncPassphrase)}',
      settingsOverlayHostSource,
    ),
  'Data settings must expose a reset sync password action.',
)
expect(
  has("const syncPassphraseHintId = 'data-sync-passphrase-hint'", dataSettingsPanelSource) &&
    has('describedBy: syncPassphraseHintId', dataSettingsPanelSource) &&
    has('id={syncPassphraseHintId}', dataSettingsPanelSource) &&
    has("t('settings.syncEncryptedNote')", dataSettingsPanelSource),
  'Data settings sync passphrase field must expose visible encrypted-sync guidance through aria-describedby.',
)
expect(
  has("const backupActionsTitleId = 'data-backup-actions-title'", dataSettingsPanelSource) &&
    has("const backupActionsDescriptionId = 'data-backup-actions-description'", dataSettingsPanelSource) &&
    has("const dangerActionsTitleId = 'data-danger-actions-title'", dataSettingsPanelSource) &&
    has("const dangerActionsDescriptionId = 'data-danger-actions-description'", dataSettingsPanelSource) &&
    has("const resetLocalDataDescriptionId = 'data-reset-local-description'", dataSettingsPanelSource) &&
    has("const clearCloudDataDescriptionId = 'data-clear-cloud-description'", dataSettingsPanelSource) &&
    has('className="data-backup-actions"', dataSettingsPanelSource) &&
    has('aria-labelledby={backupActionsTitleId}', dataSettingsPanelSource) &&
    has('aria-describedby={backupActionsDescriptionId}', dataSettingsPanelSource) &&
    has('className="data-danger-actions"', dataSettingsPanelSource) &&
    has('aria-labelledby={dangerActionsTitleId}', dataSettingsPanelSource) &&
    has('aria-describedby={dangerActionsDescriptionId}', dataSettingsPanelSource) &&
    has('aria-describedby={resetLocalDataDescriptionId}', dataSettingsPanelSource) &&
    has('aria-describedby={clearCloudDataDescriptionId}', dataSettingsPanelSource) &&
    has("t('danger.review')", dataSettingsPanelSource) &&
    has("t('settings.clearCloudNote')", dataSettingsPanelSource),
  'Data settings backup and high-risk actions must expose named groups and scoped cloud-clear guidance.',
)
expect(
    has("t('field.compactDisplay')", appearanceSettingsPanelSource) &&
    has('checked={compactMode}', appearanceSettingsPanelSource) &&
    has('onCompactModeChange(event.target.checked)', appearanceSettingsPanelSource) &&
    has('onCompactModeChange={changeCompactMode}', settingsOverlayHostSource) &&
    has('document.documentElement.dataset.compact = String(', appRuntimeControllerSource),
  'Web appearance settings must expose the compact display preference that the app already applies.',
)
expect(
  has(/\{t\('field\.theme'\)\}[\s\S]*?<select[\s\S]*?aria-describedby=\{themeHintId\}[\s\S]*?value=\{theme\}/, appearanceSettingsPanelSource) &&
    has(/\{t\('field\.language'\)\}[\s\S]*?<select[\s\S]*?aria-describedby=\{languageHintId\}[\s\S]*?value=\{language\}/, appearanceSettingsPanelSource),
  'Appearance theme and language selects must expose visible labels and guidance.',
)
expect(
  has("const themeHintId = 'appearance-theme-hint'", appearanceSettingsPanelSource) &&
    has("const languageHintId = 'appearance-language-hint'", appearanceSettingsPanelSource) &&
    has("const compactDisplayHintId = 'appearance-compact-display-hint'", appearanceSettingsPanelSource) &&
    has('aria-describedby={themeHintId}', appearanceSettingsPanelSource) &&
    has('aria-describedby={languageHintId}', appearanceSettingsPanelSource) &&
    has('aria-describedby={compactDisplayHintId}', appearanceSettingsPanelSource) &&
    has('id={themeHintId}', appearanceSettingsPanelSource) &&
    has('id={languageHintId}', appearanceSettingsPanelSource) &&
    has('id={compactDisplayHintId}', appearanceSettingsPanelSource) &&
    has("t('settings.themeHint')", appearanceSettingsPanelSource) &&
    has("t('settings.languageHint')", appearanceSettingsPanelSource) &&
    has("t('settings.compactDisplayHint')", appearanceSettingsPanelSource),
  'Appearance settings controls must expose visible localized guidance through aria-describedby.',
)
expect(
  has('meta[name="theme-color"]', appRuntimeControllerSource) &&
    has("window.matchMedia('(prefers-color-scheme: dark)')", appRuntimeControllerSource) &&
    has('themeColorForPreference(', appRuntimeControllerSource) &&
    has("systemTheme.addEventListener('change', applyThemeColor)", appRuntimeControllerSource) &&
    has("systemTheme.removeEventListener('change', applyThemeColor)", appRuntimeControllerSource),
  'PWA theme-color must follow light/dark/system theme changes.',
)
expect(
  has("from './services/appNoticeController'") &&
    has('useAppNoticeController({') &&
    !has('function defaultNoticeTarget(') &&
    !has('function setNotice(') &&
    !has('setNoticeText(') &&
    !has('setNoticeTarget(') &&
    has('export function useAppNoticeController', appNoticeControllerSource) &&
    has('export function defaultAppNoticeTarget', appNoticeControllerSource) &&
    has('noticeToneFor(message)', appNoticeControllerSource),
  'App notices must keep state, tone classification, and default target routing in the focused notice controller.',
)
expect(
  has("from './services/appMessageController'") &&
    has('useAppMessageController({') &&
    !has('function errorMessage(') &&
    !has('function syncMessage(') &&
    !has('const reportLocalSaveError = useCallback') &&
    !has('providerErrorCode(error)') &&
    has('export function formatAppErrorMessage', appMessageControllerSource) &&
    has('export function localizeSyncRuntimeMessage', appMessageControllerSource) &&
    has('export function localizeLocalSaveError', appMessageControllerSource) &&
    has('redactSensitiveText(localizeKnownMessage', appMessageControllerSource) &&
    has("error.name === 'ProviderRequestError'", appMessageControllerSource) &&
    has('maps provider error codes to localized user-facing copy', appMessageControllerTestSource) &&
    has(
      'preserves focused browser CORS guidance for provider connection failures',
      appMessageControllerTestSource,
    ) &&
    has(
      'redacts secrets and provider URLs from unknown error text before showing it',
      appMessageControllerTestSource,
    ) &&
    has(
      'localizes known sync runtime messages without involving App.tsx',
      appMessageControllerTestSource,
    ),
  'App feedback text must keep provider error mapping, local-save notices, sync-message localization, and secret redaction in appMessageController.',
)
expect(
  has('viewport-fit=cover', await readFile('index.html', 'utf8')) &&
    has('--safe-area-top: env(safe-area-inset-top, 0px);', indexCssSource) &&
    has('--safe-area-bottom: env(safe-area-inset-bottom, 0px);', indexCssSource) &&
    has('padding-top: var(--safe-area-top);', cssSource) &&
    has('padding-bottom: var(--safe-area-bottom);', cssSource) &&
    has('calc(100svh - 36px - var(--safe-area-top) - var(--safe-area-bottom))', cssSource),
  'Mobile/PWA layout must account for iOS safe-area insets.',
)
expect(
  has("from './services/secretInputRenderer'") &&
    has('const renderSecretInput = useSecretInputRenderer({') &&
    !has("from './components/SecretInput'") &&
    !has('<SecretInput') &&
    !has('function renderSecretInput(') &&
    has("from '../components/SecretInput'", secretInputRendererSource) &&
    has('export function useSecretInputRenderer', secretInputRendererSource) &&
    has('<SecretInput', secretInputRendererSource) &&
    has('onBlur={options.onBlur ?? onDefaultBlur}', secretInputRendererSource) &&
    has(/export function SecretInput[\s\S]*?<input[\s\S]*?dir="auto"/, secretInputSource) &&
    has('id={id}', secretInputSource) &&
    has('className="secret-toggle"', secretInputSource) &&
    has('aria-label={toggleLabel}', secretInputSource) &&
    has("import type { SecretInputOptions } from './SecretInput'", settingsPageTypesSource) &&
    has(
      /<input[\s\S]*?dir="auto"[\s\S]*?placeholder=\{t\('placeholder\.baseUrl'\)\}/,
      providerSettingsSource,
    ) &&
    has(
      /<input[\s\S]*?dir="auto"[\s\S]*?placeholder=\{t\('placeholder\.baseUrl'\)\}/,
      firstRunGuideSource,
    ) &&
    has(
      /<input[\s\S]*?dir="auto"[\s\S]*?placeholder=\{t\('placeholder\.workerEndpoint'\)\}/,
      syncSettingsPanelSource,
    ) &&
    has("value={data.sync.gistId ?? ''}", syncSettingsPanelSource) &&
    has("value={data.sync.gistFile ?? 'zerochat-sync.json'}", syncSettingsPanelSource) &&
    has(/className="model-chip-input"[\s\S]*?dir="auto"/, modelSettingsSource) &&
    has(
      /aria-describedby=\{field\.hintId\}[\s\S]*?dir="auto"/,
      modelSettingsSource,
    ),
  'RTL locales must keep secrets, URLs, Gist fields, and model identifiers in content-based text direction.',
)
expect(
  has('data-provider-capability-readiness={providerCapabilityReadinessState}', providerSettingsSource) &&
    has('role="status"', providerSettingsSource) &&
    has('providerCapabilityCheckReadiness', providerSettingsSource) &&
    has("'server-drill'", providerSettingsSource) &&
    has(/\.provider-capability-readiness\s*\{[^}]*border-left:\s*3px solid var\(--accent\);[^}]*line-height:\s*1\.45;/s, cssSource) &&
    has(/\.provider-capability-readiness-note\s*\{[^}]*color:\s*var\(--muted\);/s, cssSource),
  'Provider full-capability readiness must expose a stable status selector, localized missing-model/server-drill copy, and compact readable styling.',
)
expect(
  has(/html,\s*body,\s*#root\s*\{[^}]*min-width:\s*0;/s, indexCssSource) &&
    !has(/html,\s*body,\s*#root\s*\{[^}]*min-width:\s*300px;/s, indexCssSource),
  'Root shell must not force a 300px minimum width; tiny desktop windows should shrink without horizontal clipping.',
)
expect(
  has(/\.empty-state\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*overflow:\s*hidden;/s, cssSource) &&
    has(/\.empty-state h1\s*\{[^}]*max-width:\s*100%;[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/s, cssSource) &&
    has(/\.empty-state p\s*\{[^}]*max-width:\s*100%;[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/s, cssSource) &&
    has(/\.empty-state \.primary-button\s*\{[^}]*max-width:\s*100%;[^}]*min-width:\s*0;[^}]*white-space:\s*normal;/s, cssSource) &&
    has(/@media \(max-width: 520px\)[\s\S]*?\.provider-empty-state\s*\{[^}]*align-content:\s*start;[^}]*justify-items:\s*center;[^}]*padding-block:\s*48px 24px;/s, cssSource) &&
    has('providerEmptyPrimaryActionNearTop', visualAuditSource) &&
    has(/@media \(max-width: 280px\)[\s\S]*?\.empty-state\s*\{[^}]*padding:\s*14px;/s, cssSource) &&
    has('<main class="initial-state" aria-live="polite">', indexHtmlSource) &&
    has('<img class="app-logo app-logo-empty" src="./favicon.svg" alt="" aria-hidden="true" />', indexHtmlSource) &&
    has('<img src="./favicon.svg" width="64" height="64" alt="" aria-hidden="true" />', indexHtmlSource) &&
    has('data-initial-loading', indexHtmlSource) &&
    has('src="%BASE_URL%zerochat-startup.js" defer vite-ignore', indexHtmlSource) &&
    has('[navigator.language,...navigator.languages]', startupScriptSource) &&
    has('.map(l=>a.find(', startupScriptSource) &&
    has('d=document.documentElement', startupScriptSource) &&
    has("d.dir=l==='ar-SA'?'rtl':'ltr'", startupScriptSource) &&
    has("document.querySelector('[data-initial-loading]')", startupScriptSource) &&
    !has(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i, indexHtmlSource) &&
    has('#root {\n          display: none;', indexHtmlSource) &&
    has(/\.initial-state\s*\{[^}]*min-height:\s*100svh;[^}]*width:\s*100%;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*overflow:\s*hidden;/s, indexCssSource) &&
    has(/\.initial-state h1\s*\{[^}]*max-width:\s*100%;[^}]*overflow-wrap:\s*anywhere;/s, indexCssSource) &&
    has(/\.initial-state p\s*\{[^}]*max-width:\s*100%;[^}]*overflow-wrap:\s*anywhere;/s, indexCssSource) &&
    has(/@media \(max-width: 280px\)[\s\S]*?\.initial-state\s*\{[^}]*padding:\s*14px;/s, indexCssSource) &&
    has("from './components/AppStateScreens'") &&
    has('<AppLoadErrorState', appStateScreensSource) &&
    has('<AppLoadingState', appStateScreensSource) &&
    has('export function AppLoadErrorState(', appStateScreensSource) &&
    has('export function AppLoadingState(', appStateScreensSource) &&
    has('<AppLogo size="empty" />', appStateScreensSource) &&
    has('className="empty-state"', appStateScreensSource),
  'Startup loading and failure states must show the app icon and stay centered and unclipped in ultra-narrow windows.',
)
expect(
  has('data.providers.length === 0 || !activeProvider', appRootBridgeControllerSource) &&
    has('function openFirstProviderSetup', conversationLifecycleControllerSource) &&
    has('createConversationIfMissing: true', conversationLifecycleControllerSource) &&
    has('<ProviderEmptyState', appStateScreensSource) &&
    has('export function ProviderEmptyState(', appStateScreensSource) &&
    has('data-add-first-provider="true"', appStateScreensSource) &&
    has("t('provider.emptyTitle')", appStateScreensSource) &&
    has("t('button.addFirstProvider')", appStateScreensSource) &&
    has("t('notice.addProviderFirst')", conversationLifecycleControllerSource) &&
    has(/\.settings-empty-panel\s*\{[^}]*min-height:\s*320px;[^}]*justify-items:\s*center;/s, cssSource) &&
    has(/\.settings-empty-panel p\s*\{[^}]*overflow-wrap:\s*anywhere;/s, cssSource),
  'Providerless snapshots must show a real first-provider empty state with a large recoverable action.',
)
expect(
  has('padding-left: var(--safe-area-left);', cssSource) &&
    has('padding-right: var(--safe-area-right);', cssSource) &&
    has('horizontalSafeAreaState()', browserSmokeSource) &&
    has('landscape mobile shell should consume both horizontal safe-area insets', browserSmokeSource),
  'Landscape Web layouts must keep sidebar and chat controls inside horizontal safe areas.',
)
expect(
  has('export const MESSAGE_AUTO_SCROLL_THRESHOLD_PX = 100', composerLayoutSource) &&
    has('export function isMessageListNearBottom', composerLayoutSource) &&
    has("from './services/messageVirtualizationController'") &&
    has("import { appUiStore } from '../state/store'", messageVirtualizationControllerSource) &&
    has('state.showNewMessagesButton', messageVirtualizationControllerSource) &&
    has('messageListPinnedToBottomRef.current', messageVirtualizationControllerSource) &&
    has('onScroll={handleMessageListScroll}', chatPaneMessageSectionSource) &&
    has('onScroll={onScroll}', messageListSource) &&
    has('!shouldAutoScroll', messageVirtualizationControllerSource) &&
    has('showNewMessagesButtonState()', messageVirtualizationControllerSource) &&
    has('hideNewMessagesButtonState()', messageVirtualizationControllerSource) &&
    has('jumpToLatestMessages', messageVirtualizationControllerSource) &&
    has('scrollInteractionElementTo,', messageVirtualizationControllerSource) &&
    has('export function scrollMessagesElementToLatest(', messageVirtualizationControllerSource) &&
    has('if (scrollMessagesElementToLatest(messageList, behavior))', messageVirtualizationControllerSource) &&
    !has('messageList.scrollTo({', messageVirtualizationControllerSource) &&
    has("t('button.newMessages')", messageListSource) &&
    has('waitForNewMessagesButtonVisible', browserSmokeSource) &&
    has('messageScrollState', browserSmokeSource) &&
    has('new messages button should appear without forcing the reader to the bottom', browserSmokeSource) &&
    has(/\.message-scroll-region\s*\{[^}]*position:\s*relative;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s, cssSource) &&
    has(/\.new-messages-button\s*\{[^}]*position:\s*absolute;[^}]*bottom:\s*16px;[^}]*max-width:\s*min\(260px,\s*calc\(100% - 28px\)\);/s, cssSource),
  'Chat scrolling must preserve the reader position and offer a bounded New messages jump button instead of always forcing the list to the bottom.',
)
expect(
  has("from './AppMainView'", appReadyStageSource) &&
    has('<AppMainView {...props} />', appReadyStageSource) &&
    has('export function AppMainView', appMainViewSource) &&
    has("from './Sidebar'", appMainViewSource) &&
    has("from './ChatPaneView'", appMainViewSource) &&
    has("from './ChatHeader'", chatPaneViewSource) &&
    has("from './ChatPaneMessageSection'", chatPaneViewSource) &&
    has("from './ChatPaneComposerSection'", chatPaneViewSource) &&
    has("from './MessageList'", chatPaneMessageSectionSource) &&
    has("from './MessageContextMenu'", chatPaneMessageSectionSource) &&
    has("from './ChatComposer'", chatPaneComposerSectionSource),
  'AppReadyStage must delegate the main chat surface to AppMainView while ChatPaneView keeps the visible header and focused message/composer section split.',
)
expect(
    has("from './AppOverlaysView'", appReadyStageSource) &&
    has('<AppOverlaysView {...props} />', appReadyStageSource) &&
    has('export function AppOverlaysView', appOverlaysViewSource) &&
    has("import('./SettingsOverlayHost')", appOverlaysViewSource) &&
    has(
      'recoverLazyOverlay(loadSettingsOverlayHost, SettingsOverlayLoadFailure)',
      appOverlaysViewSource,
    ) &&
    has('shouldWarmLazyServices()', appOverlaysViewSource) &&
    has('<LazySettingsOverlayHost {...props} />', appOverlaysViewSource) &&
    has('export function SettingsOverlayHost', settingsOverlayHostSource) &&
    has("from './SettingsOverlay'", settingsOverlayHostSource) &&
    has('<SettingsOverlay', settingsOverlayHostSource) &&
    has("from './SettingsPage'", settingsOverlaySource) &&
    has("from './SettingsOverlayPageProps'", settingsOverlaySource) &&
    has('settingsPagePropsFromOverlay(props,', settingsOverlaySource) &&
    has("import('./FirstRunGuide')", appOverlaysViewSource) &&
    has('recoverLazyOverlay<FirstRunGuideProps>(', appOverlaysViewSource) &&
    has('<LazyFirstRunGuide', appOverlaysViewSource) &&
    has("from './ConfirmationDialogs'", appOverlaysViewSource) &&
    has("from './DelayedTooltip'", appOverlaysViewSource) &&
    has('onRunSync: () => runLeafAction(runSync)', settingsOverlayPagePropsSource) &&
    has('suppressSettingsReturnFocus()', settingsOverlaySource) &&
    !has("from './components/SettingsPage'") &&
    !has("from './components/FirstRunGuide'") &&
    !has("from './components/ConfirmationDialogs'") &&
    !has("from './components/DelayedTooltip'"),
  'AppReadyStage must delegate Settings, guide, dialogs, tooltip, and manual-sync overlay wiring to AppOverlaysView, SettingsOverlayHost, and SettingsOverlay.',
)
expect(
  has('export async function recoverLazyOverlay<Props>(', lazyOverlayLoaderSource) &&
    has('return { default: fallback }', lazyOverlayLoaderSource) &&
    has('export function LazyOverlayState(', lazyOverlayRecoverySource) &&
    has('role="dialog"', lazyOverlayRecoverySource) &&
    has('aria-busy={!failed}', lazyOverlayRecoverySource) &&
    has("role={failed ? 'alert' : 'status'}", lazyOverlayRecoverySource) &&
    has("aria-live={failed ? 'assertive' : 'polite'}", lazyOverlayRecoverySource) &&
    has('function focusLazyOverlayRecovery(', lazyOverlayRecoverySource) &&
    has('ref={focusLazyOverlayRecovery}', lazyOverlayRecoverySource) &&
    has(
      'className="modal-backdrop compact-dialog-backdrop"',
      lazyOverlayRecoverySource,
    ) &&
    has('.compact-dialog-backdrop .lazy-overlay-modal', cssSource) &&
    has('mode="loading"', appOverlaysViewSource) &&
    has("description={t('error.interfaceLoadFailed')}", appOverlaysViewSource) &&
    has(
      'onClose={data.preferences.firstRunDone ? onCloseGuide : undefined}',
      appOverlaysViewSource,
    ) &&
    !has('fallback={null}', appOverlaysViewSource) &&
    has('"error.interfaceLoadFailed"', localeKeysSource) &&
    has(
      'renders a closable loading dialog without reload actions',
      lazyOverlayRecoveryTestSource,
    ) &&
    has(
      'renders an assertive failed dialog with a reload action',
      lazyOverlayRecoveryTestSource,
    ) &&
    has("urls: ['*FirstRunGuide-*.js*']", settingsOverlayPreloadSmokeSource) &&
    has('recoveryState.reloadFocused', settingsOverlayPreloadSmokeSource) &&
    has('recoveryState.closeButtonCount', settingsOverlayPreloadSmokeSource) &&
    has(
      'mobileLayout.scrollWidth <= mobileLayout.viewportWidth',
      settingsOverlayPreloadSmokeSource,
    ) &&
    has(
      "window.__zeroChatSmoke.waitForElement('.guide-modal .guide-provider-picker')",
      browserSmokeSource,
    ),
  'Critical Settings and first-run lazy overlays must expose visible localized loading, contain chunk failures, and provide accessible close/reload recovery without allowing mandatory setup dismissal.',
)
expect(
  has("from './components/AppRuntimeBoundary.tsx'", mainEntrySource) &&
    has('<AppRuntimeBoundary>', mainEntrySource) &&
    has('<RuntimeFailureSmokeProbe />', mainEntrySource) &&
    has("new Set(['127.0.0.1', 'localhost', '::1'])", mainEntrySource) &&
    has("['http:', 'https:'].includes(url.protocol)", mainEntrySource) &&
    has(
      "const STARTUP_FAILURE_SMOKE_PARAM = 'zerochat-startup-failure-smoke'",
      mainEntrySource,
    ) &&
    has('export class AppRuntimeBoundary extends Component<', appRuntimeBoundarySource) &&
    has('static getDerivedStateFromError()', appRuntimeBoundarySource) &&
    has('componentDidCatch(error: Error, info: ErrorInfo)', appRuntimeBoundarySource) &&
    has('role="alert"', appRuntimeBoundarySource) &&
    has('aria-live="assertive"', appRuntimeBoundarySource) &&
    has('aria-labelledby="runtime-failure-title"', appRuntimeBoundarySource) &&
    has('aria-describedby="runtime-failure-description"', appRuntimeBoundarySource) &&
    has('ref={focusRuntimeFailureReload}', appRuntimeBoundarySource) &&
    has('<RefreshCw aria-hidden="true"', appRuntimeBoundarySource) &&
    has(
      'const { description, reloadLabel, title } = runtimeFailureCopy()',
      appRuntimeBoundarySource,
    ) &&
    has('export function runtimeFailureCopy()', startupFatalErrorSource) &&
    has("'error.interfaceLoadFailed'", startupFatalErrorSource) &&
    has("translatedOrFallback('button.reload'", startupFatalErrorSource) &&
    has("translatedOrFallback('ui.loadFailed'", startupFatalErrorSource) &&
    has('function reportStartupFailure(', startupFatalErrorSource) &&
    has(
      'contains child render failures without exposing raw error text',
      appRuntimeBoundaryTestSource,
    ) &&
    has(
      'keeps the recovery state usable when the host logger throws',
      appRuntimeBoundaryTestSource,
    ) &&
    has(
      "reloadButton.addEventListener('click', () => {",
      startupFatalErrorSource,
    ) &&
    has('reloadButton.focus()', startupFatalErrorSource) &&
    has('expect(reloadPage).toHaveBeenCalledOnce()', startupFatalErrorTestSource) &&
    has(
      'uses the loaded runtime locale for pre-React recovery copy',
      startupFatalErrorTestSource,
    ) &&
    has(
      'renders recovery even when the diagnostic logger throws',
      startupFatalErrorTestSource,
    ) &&
    has(
      'contains reload failures without destroying the recovery state',
      startupFatalErrorTestSource,
    ) &&
    has(
      /\.startup-failure-state button\s*\{[^}]*min-height:\s*44px;[^}]*display:\s*inline-flex;/s,
      indexCssSource,
    ) &&
    has('runtimeFailureState.reloadFocused', settingsOverlayPreloadSmokeSource) &&
    has('runtimeFailureState.rawErrorVisible', settingsOverlayPreloadSmokeSource) &&
    has('runtimeFailureState.windowErrors', settingsOverlayPreloadSmokeSource) &&
    has(
      '.manual-qa/web-runtime-failure-recovery-current.png',
      settingsOverlayPreloadSmokeSource,
    ) &&
    has(
      '.manual-qa/web-runtime-failure-recovery-mobile-current.png',
      settingsOverlayPreloadSmokeSource,
    ) &&
    has(
      'runtimeFailureMobileState.scrollWidth <=',
      settingsOverlayPreloadSmokeSource,
    ) &&
    has(
      "startupFailureUrl.searchParams.set('zerochat-startup-failure-smoke', '1')",
      settingsOverlayPreloadSmokeSource,
    ) &&
    has(
      '.startup-failure-state:not(.runtime-failure-state)',
      settingsOverlayPreloadSmokeSource,
    ) &&
    has('startupFailureState.reloadFocused', settingsOverlayPreloadSmokeSource) &&
    has(
      '.manual-qa/web-startup-failure-recovery-current.png',
      settingsOverlayPreloadSmokeSource,
    ) &&
    has(
      '.manual-qa/web-startup-failure-recovery-mobile-current.png',
      settingsOverlayPreloadSmokeSource,
    ) &&
    has(
      'startupFailureMobileState.scrollWidth <=',
      settingsOverlayPreloadSmokeSource,
    ),
  'Root runtime render failures must produce localized, assertive, focused desktop/mobile recovery without exposing raw errors or enabling fault injection outside localhost.',
)
expect(
  has('export const MESSAGE_VIRTUALIZATION_THRESHOLD = 50', messageVirtualizationSource) &&
    has('export const MESSAGE_VIRTUALIZATION_OVERSCAN = 5', messageVirtualizationSource) &&
    has('export const MESSAGE_LIST_GAP_PX = 18', messageVirtualizationSource) &&
    has('export function calculateMessageVirtualRange(', messageVirtualizationSource) &&
    has('export function deriveResolvedMessageVirtualRange(', messageVirtualizationSource) &&
    has('export function sumMessageVirtualHeights(', messageVirtualizationSource) &&
    has('Math.max(0, end - start - 1) * rowGap', messageVirtualizationSource) &&
    has("from './services/messageVirtualizationController'") &&
    has('export function useMessageVirtualizationController(', messageVirtualizationControllerSource) &&
    has('const renderedMessages = messageVirtualizationEnabled', messageVirtualizationControllerSource) &&
    has('renderedMessages.map((message) =>', messageListSource) &&
    has('data-message-virtual-spacer="top"', messageListSource) &&
    has('data-message-virtual-spacer="bottom"', messageListSource) &&
    has('<MessageBubble', messageListSource) &&
    has('data-message-id={message.id}', messageBubbleSource) &&
    !has('activeConversation.messages.map((message) =>') &&
    has(/\.message-list\s*\{[^}]*gap:\s*18px;/s, cssSource) &&
    has(/\.message-virtual-spacer\s*\{[^}]*flex:\s*0 0 auto;[^}]*pointer-events:\s*none;/s, cssSource) &&
    has('const MESSAGE_COUNT = 72', messageVirtualizationSmokeSource) &&
    has('MAX_RENDERED_MESSAGES = 50', messageVirtualizationSmokeSource) &&
    has('Message virtualization smoke passed', messageVirtualizationSmokeSource),
  'Virtualized message lists over 50 messages must render only the visible window plus five-message overscan while preserving scroll height.',
)
expect(
  has("from './MessageList'", chatPaneMessageSectionSource) &&
    has('<MessageList', chatPaneMessageSectionSource) &&
    has('export function MessageList(', messageListSource) &&
    has("from './MessageBubble'", messageListSource) &&
    has('export function MessageBubble(', messageBubbleSource) &&
    has('className="message-list"', messageListSource) &&
    has('role="log"', messageListSource) &&
    has("aria-label={t('message.transcriptLabel')}", messageListSource) &&
    has('aria-relevant="additions text"', messageListSource) &&
    has('aria-atomic="false"', messageListSource) &&
    has('className="new-messages-button"', messageListSource) &&
    has('onMessageContextMenu={openMessageContextMenu}', chatPaneMessageSectionSource) &&
    has('onOpenWelcomeSettings={(event) =>', chatPaneMessageSectionSource),
  'Web/PWA message list shell must be split into a focused MessageList component without losing scroll, context-menu, or setup routing.',
)
expect(
  has("from './MessageContent'", messageBubbleSource) &&
    has('<MessageContent', messageBubbleSource) &&
    has('messageAccessibleName({', messageBubbleSource) &&
    has('aria-label={messageAccessibleLabel}', messageBubbleSource) &&
    has('messageStatusText(message, {', messageBubbleSource) &&
    has("export function messageAccessibleName", messageRenderingSource) &&
    has("export function messageStatusText", messageRenderingSource) &&
    has('export function MessageContent', messageContentSource) &&
    has('data-message-content="true"', messageContentSource) &&
    has('loadMarkdownService()', messageContentSource) &&
    has("type MarkdownService = typeof import('./markdownWorkerClient')", lazySource) &&
    has('dangerouslySetInnerHTML={{ __html: rendered.html }}', messageContentSource) &&
    has('writeClipboardText(code)', messageContentSource) &&
    has("applyMarkdownCopyFeedback(button, 'copied')", messageContentSource) &&
    has("applyMarkdownCopyFeedback(button, 'failed')", messageContentSource) &&
    has('export function applyMarkdownCopyFeedback', messageContentCopyFeedbackSource) &&
    has('showMarkdownCopyFailureFeedback(button)', messageContentCopyFeedbackSource) &&
    has("copyFailedLabel={t('button.copyFailed')}", messageBubbleSource) &&
    has("copyCodeLabel={t('button.copyCode')}", messageBubbleSource) &&
    has("copiedLabel={t('button.copied')}", messageBubbleSource) &&
    has('data-copy-code-label=', markdownSource) &&
    has('data-copied-label=', markdownSource) &&
    has('data-copy-failed-label=', markdownSource) &&
    has("tsx: 'typescript'", markdownSource) &&
    has('dockerfile:', markdownSource) &&
    has('powershell:', markdownSource) &&
    has('markdownHighlightLanguageCount', markdownSource) &&
    has('aria-live="polite"', markdownSource) &&
    has('\\`\\`\\`tsx\\\\nconst value: number = 42', browserSmokeSource) &&
    has("state.codeLanguage === 'typescript'", browserSmokeSource) &&
    has("state.codeText.includes('<Button>{value}</Button>')", browserSmokeSource) &&
    has('Markdown code copy button should expose a code-specific accessible label', browserSmokeSource) &&
    has('Markdown code copy should show a localized copied state', browserSmokeSource) &&
    has(/\.message-markdown\s*\{[^}]*display:\s*grid;[^}]*gap:\s*8px;[^}]*overflow-wrap:\s*anywhere;/s, cssSource) &&
    has(/\.markdown-table-scroll\s*\{[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto;[^}]*border:\s*1px solid var\(--border\);/s, cssSource) &&
    has(/\.markdown-code-block\s*\{[^}]*overflow:\s*hidden;[^}]*border:\s*1px solid var\(--border\);[^}]*background:\s*var\(--field\);/s, cssSource) &&
    has(/\.markdown-code-header\s*\{[^}]*min-height:\s*34px;[^}]*justify-content:\s*space-between;/s, cssSource) &&
    has(/\.code-copy-button\s*\{[^}]*min-height:\s*28px;[^}]*cursor:\s*pointer;/s, cssSource) &&
    has(/\.code-copy-button\[data-copied='true'\]\s*\{[^}]*color:\s*var\(--success\);/s, cssSource) &&
    has(/\.code-copy-button\[data-copy-failed='true'\]\s*\{[^}]*color:\s*var\(--danger\);/s, cssSource),
  'Chat messages must render Markdown lazily with bounded tables/code blocks, language headers, accessible copy buttons, and copied/failed copy feedback.',
)
expect(
    has("message.status === 'streaming' ? 'streaming' : ''", messageRenderingSource) &&
    has("from '../services/messageRendering'", messageBubbleSource) &&
    has('export function StreamingTypingIndicator', messageContentSource) &&
    has('data-streaming-typing-indicator="true"', messageContentSource) &&
    has('data-streaming-cursor="true"', messageContentSource) &&
    has('streaming={isStreaming && message.role === \'assistant\'}', messageBubbleSource) &&
    has('<StreamingTypingIndicator label={t(\'message.streaming\')} />', messageBubbleSource) &&
    has(/\.streaming-typing-indicator\s*\{[^}]*display:\s*inline-flex;[^}]*gap:\s*5px;[^}]*color:\s*var\(--accent\);/s, cssSource) &&
    has(/\.streaming-typing-indicator span\s*\{[^}]*width:\s*6px;[^}]*height:\s*6px;[^}]*animation:\s*typing-bounce 1\.2s ease-in-out infinite;/s, cssSource) &&
    has(/\.message-streaming-cursor::after\s*\{[^}]*content:\s*'\|';/s, cssSource) &&
    has(/@keyframes typing-bounce\s*\{/s, cssSource) &&
    has(/@keyframes streaming-cursor-blink\s*\{/s, cssSource) &&
    has('typingIndicatorCount', browserSmokeSource) &&
    has('streaming smoke should show a three-dot typing indicator before the first token', browserSmokeSource) &&
    has('streaming smoke should show a blinking cursor while partial text is streaming', browserSmokeSource),
  'Streaming assistant turns must have visible PRD feedback: a three-dot typing indicator before the first token and a blinking cursor while text streams.',
)
expect(
  has("from './chatGenerationRuntime'", chatGenerationControllerSource) &&
    has('withGenerationAutoRetry', chatGenerationControllerSource) &&
    has('MAX_GENERATION_AUTO_RETRIES = 3', chatGenerationRuntimeSource) &&
    has('export async function withGenerationAutoRetry', chatGenerationRuntimeSource) &&
    has("options.t('notice.networkRetrying'", chatGenerationRuntimeSource) &&
    has(
      'preserves partial streamed assistant content when a text generation fails',
      chatGenerationControllerTestSource,
    ) &&
    has("new DOMException('aborted', 'AbortError')", chatGenerationControllerTestSource) &&
    has('retries retryable generation failures three times before resolving', chatGenerationControllerTestSource) &&
    has('data-message-retry-action=', messageBubbleSource) &&
    has("t('button.retry')", messageBubbleSource) &&
    has(/\.message-actions \.message-retry-button\s*\{[^}]*width:\s*auto;[^}]*min-width:\s*72px;[^}]*display:\s*inline-flex;/s, cssSource) &&
    has('waitForManualRetryError', browserSmokeSource) &&
    has('Manual retry smoke should auto-retry three times', browserSmokeSource) &&
    has('Failed terminal sync smoke should hide raw provider details', browserSmokeSource),
  'Failed assistant turns must show friendly retry UX: automatic retry, explicit retry button, and browser-smoke coverage.',
)
expect(
  has('export function keyboardSendShortcut(', uiRuntimeSource) &&
    has('Ctrl+Enter', uiRuntimeSource) &&
    has('Cmd+Enter', uiRuntimeSource) &&
    has("t('button.actionWithShortcut'", appChromeControllerSource) &&
    has('submitAccessibleLabel:', composerChromeSource) &&
    has('submitAccessibleLabel={composerChrome.submitAccessibleLabel}', chatPaneComposerSectionSource) &&
    has('className="composer-mode-tooltip-target"', composerToolbarSource) &&
    has("generationActive ? t('message.streaming')", composerToolbarSource) &&
    has(/\.composer-mode-tooltip-target button:disabled\s*\{[^}]*pointer-events:\s*none;/s, cssSource) &&
    has('locked composer mode controls should expose the busy reason through tooltip targets without duplicating button titles', browserSmokeSource) &&
    has('locked composer mode controls should show the busy reason in the delayed app tooltip', browserSmokeSource) &&
    has('className="send-button-tooltip-target"', chatComposerSource) &&
    has('const sendButtonTooltip = composerCanSubmit', chatComposerSource) &&
    !has('title={sendButtonTooltip}', chatComposerSource) &&
    !has('title={stopTitle}', chatComposerSource) &&
    has('data-tooltip={sendButtonTooltip}', chatComposerSource) &&
    has('aria-label={submitAccessibleLabel}', chatComposerSource) &&
    has(/\.send-button-tooltip-target \.send-button:disabled\s*\{[^}]*pointer-events:\s*none;/s, cssSource) &&
    has('Disabled composer send button should expose its human-readable blocking reason through aria-label and wrapper tooltip', browserSmokeSource) &&
    has('Disabled composer send button should show the same blocking reason in the delayed app tooltip', browserSmokeSource) &&
    has('event.ctrlKey || event.metaKey', chatGenerationControllerSource) &&
    has('!event.shiftKey', chatGenerationControllerSource) &&
    has('Keyboard shortcut smoke sent by shortcut', browserSmokeSource) &&
    has('Plain Enter must not submit the composer', browserSmokeSource) &&
    has('Shift+Enter must not submit the composer', browserSmokeSource),
  'Composer send behavior must match the PRD: tooltip exposes Ctrl/Cmd+Enter, plain/Shift+Enter stay in the textarea, and Ctrl/Cmd+Enter submits.',
)
expect(
  has('export function keyboardNewConversationShortcut(', uiRuntimeSource) &&
    has('aria-keyshortcuts={newConversationShortcut}', sidebarSource) &&
    has('handleGlobalNewConversationShortcut', conversationLifecycleControllerSource) &&
    has('aria-label={newConversationTitle}', sidebarSource) &&
    has('scheduleComposerTextareaFocusToEnd(context.composerTextareaRef)', conversationLifecycleControllerSource) &&
    has('textarea.focus({ preventScroll: true })', composerFocusSource) &&
    has('focusComposerTextareaToEnd(composerTextareaRef.current)', composerFocusSource) &&
    has(
      'creates a new conversation, activates it, closes the sidebar, and focuses the composer',
      conversationLifecycleControllerTestSource,
    ) &&
    has(
      'contains new-conversation composer focus failures after save',
      conversationLifecycleControllerTestSource,
    ) &&
    has('New chat button should rely on the app tooltip instead of a native title', browserSmokeSource) &&
    has('Ctrl/Cmd+N should create exactly one new conversation', browserSmokeSource) &&
    has('Ctrl/Cmd+N should focus the composer in the new active chat', browserSmokeSource),
  'New chat must expose the desktop Ctrl/Cmd+N shortcut with tooltip, aria-keyshortcuts, runtime creation, and composer focus.',
)
expect(
  has('export const COMPOSER_MIN_ROWS = 1', composerLayoutSource) &&
    has('export const COMPOSER_MAX_ROWS = 5', composerLayoutSource) &&
    has('export function resizeComposerTextarea(', composerLayoutSource) &&
    has('textarea.style.height = \'auto\'', composerLayoutSource) &&
    has('scrollHeight > maxHeight + 1 ? \'auto\' : \'hidden\'', composerLayoutSource) &&
    has("from './composerLayout'", appRuntimeControllerSource) &&
    has('data-composer-autosize="true"', chatComposerSource) &&
    has('rows={COMPOSER_MIN_ROWS}', chatComposerSource) &&
    has(/\.composer textarea\s*\{[^}]*overflow-y:\s*hidden;[^}]*resize:\s*none;/s, cssSource) &&
    has('const LONG_PROMPT_LINES = 8', composerAutosizeSmokeSource) &&
    has('Composer autosize smoke passed', composerAutosizeSmokeSource) &&
    has('composer should grow from one to three rows', composerAutosizeSmokeSource) &&
    has('composer should cap at five rows', composerAutosizeSmokeSource) &&
    has('composer should scroll internally after five rows', composerAutosizeSmokeSource),
  'Composer textarea must auto-grow from 1 to 5 rows, then scroll internally with runtime smoke coverage.',
)
expect(
    has('export const TOOLTIP_DELAY_MS = 500', delayedTooltipSource) &&
    has("from './delayedTooltipDom'", delayedTooltipSource) &&
    has("export const APP_TOOLTIP_ID = 'zerochat-app-tooltip'", delayedTooltipDomSource) &&
    has('export const TOOLTIP_VIEWPORT_MARGIN = 12', delayedTooltipDomSource) &&
    has('const TOOLTIP_MAX_WIDTH_PX = 260', delayedTooltipDomSource) &&
    has('const TOOLTIP_TOP_PLACEMENT_MIN_Y = 96', delayedTooltipDomSource) &&
    has('export function DelayedTooltip()', delayedTooltipSource) &&
    has('TOOLTIP_TRIGGER_SELECTOR', delayedTooltipSource) &&
    has('function tooltipCenterXForRect(rect: DOMRectReadOnly)', delayedTooltipDomSource) &&
    has('function tooltipPositionForRect(', delayedTooltipDomSource) &&
    has('window.innerWidth - TOOLTIP_VIEWPORT_MARGIN * 2', delayedTooltipDomSource) &&
    has('rect.top >= TOOLTIP_TOP_PLACEMENT_MIN_Y ? \'top\' : \'bottom\'', delayedTooltipDomSource) &&
    has('export function readTooltipTriggerText', delayedTooltipDomSource) &&
    has('export function tooltipPositionForTrigger', delayedTooltipDomSource) &&
    has('export function restoreTooltipTriggerDescription', delayedTooltipDomSource) &&
    has('export function describeTooltipTrigger', delayedTooltipDomSource) &&
    has('function restoreTriggerDescription()', delayedTooltipSource) &&
    has('function describeTriggerWithTooltip(trigger: HTMLElement)', delayedTooltipSource) &&
    has("const TOOLTIP_DESCRIPTION_ATTRIBUTE = 'aria-describedby'", delayedTooltipDomSource) &&
    has('trigger.setAttribute(TOOLTIP_DESCRIPTION_ATTRIBUTE', delayedTooltipDomSource) &&
    has('trigger.removeAttribute(TOOLTIP_DESCRIPTION_ATTRIBUTE)', delayedTooltipDomSource) &&
    has('document.contains(activeTrigger)', delayedTooltipSource) &&
    has('const position = tooltipPositionForTrigger(activeTrigger)', delayedTooltipSource) &&
    has('if (!position || !describeTriggerWithTooltip(activeTrigger))', delayedTooltipSource) &&
    has('contains tooltip trigger description failures', delayedTooltipTestSource) &&
    has('contains tooltip trigger restore failures', delayedTooltipTestSource) &&
    has('contains tooltip trigger measurement failures', delayedTooltipTestSource) &&
    has('id={APP_TOOLTIP_ID}', delayedTooltipSource) &&
    !has("trigger.matches(':disabled')", delayedTooltipSource) &&
    has("document.addEventListener('pointerover', handleHoverOver)", delayedTooltipSource) &&
    has("document.addEventListener('pointerout', handleHoverOut)", delayedTooltipSource) &&
    has('role="tooltip"', delayedTooltipSource) &&
    has("from './DelayedTooltip'", appOverlaysViewSource) &&
    has('<DelayedTooltip />', appOverlaysViewSource) &&
    has(/\.app-tooltip\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*120;[^}]*pointer-events:\s*none;/s, cssSource) &&
    has(/@keyframes app-tooltip-in\s*\{/s, cssSource) &&
    has('waitForTooltipForSelector', browserSmokeSource) &&
    has('App tooltip should wait roughly 500ms before appearing', browserSmokeSource) &&
    has('App tooltip should expose the composer keyboard shortcut', browserSmokeSource),
  'Icon and composer controls must use an app-level delayed tooltip that exposes keyboard shortcuts without relying only on native title text.',
)
expect(
  has('role="tablist"', settingsNavSource) &&
    has('role="tab"', settingsNavSource) &&
    has('aria-controls={`settings-panel-${id}`}', settingsNavSource) &&
    has('links every settings tab to its controlled panel', settingsNavTestSource) &&
    ['appearance', 'providers', 'models', 'skills', 'sync', 'data'].every((tab) =>
      has(`['${tab}',`, settingsNavSource) &&
      has(`'settings-panel-${tab}'`, settingsNavTestSource),
    ) &&
    has('id="settings-panel-appearance"', appearanceSettingsPanelSource) &&
    has('id="settings-panel-providers"', providerSettingsPanelSource) &&
    has('id="settings-panel-models"', modelSettingsSource) &&
    has('id="settings-panel-skills"', skillSettingsSource) &&
    has('id="settings-panel-sync"', syncSettingsPanelSource) &&
    has('id="settings-panel-data"', dataSettingsPanelSource) &&
    (
      `${appSource}\n${appearanceSettingsPanelSource}\n${providerSettingsSource}\n${modelSettingsSource}\n${skillSettingsSource}\n${syncSettingsPanelSource}\n${dataSettingsPanelSource}`.match(
        /role="tabpanel"/g,
      ) ?? []
    ).length >= 6,
  'Settings navigation must expose tablist, tab, tabpanel, and tab-to-panel control semantics.',
)
expect(
    has('aria-selected={settingsTab === id}', settingsNavSource) &&
    has('id={`settings-tab-${id}`}', settingsNavSource) &&
    has('onClick={() => onSelectTab(id)}', settingsNavSource) &&
    has('onSelectTab={selectSettingsTabWithDataPrewarm}', settingsOverlayHostSource) &&
    has('selectSettingsTab(tab)', settingsOverlayHostSource) &&
    has('function selectSettingsTab(tab: SettingsTab): void', appNavigationControllerSource) &&
    has('switches to the Skills tab with a fresh rendered list', appNavigationControllerTestSource),
  'Every settings tab must expose selected state.',
)
expect(
    has('tabIndex={settingsTab === id ? 0 : -1}', settingsNavSource) &&
    has('onKeyDown={(event) => handleTabKeyDown(event, index)}', settingsNavSource) &&
    has('const key = event.key', settingsNavSource) &&
    has("key[0] === 'H'", settingsNavSource) &&
    has("key === 'End'", settingsNavSource) &&
    has("key.startsWith('Arrow')", settingsNavSource) &&
    has("key.endsWith('Left') || key.endsWith('Up')", settingsNavSource) &&
    has('settingsTabs.length', settingsNavSource) &&
    has('onSelectTab(settingsTabs[nextIndex][0])', settingsNavSource) &&
    !has('nextTabButton.click()', settingsNavSource) &&
    has('supports expected tablist keyboard navigation', settingsNavTestSource) &&
    has('does not route keyboard navigation through DOM click', settingsNavTestSource) &&
    has("'ArrowRight', 'skills'", settingsNavTestSource) &&
    has("'ArrowLeft', 'providers'", settingsNavTestSource) &&
    has("'Home', 'appearance'", settingsNavTestSource) &&
    has("'End', 'data'", settingsNavTestSource),
  'Settings tablist must support roving focus and expected keyboard navigation.',
)
expect(
  has('settings-tab-${settingsTab}', settingsViewportControllerSource) &&
    has('scrollInteractionElementIntoView(', settingsViewportControllerSource) &&
    has("inline: 'center'", settingsViewportControllerSource),
  'Selected settings tab must scroll into view on narrow screens.',
)
expect(
  has("from './services/settingsViewportController'") &&
    has('const settingsModalRef = useRef<HTMLElement | null>(null)', settingsViewportControllerSource) &&
    has('scrollInteractionElementTo(settingsModalRef.current, {', settingsViewportControllerSource) &&
    has("top: 0,\n    })", settingsViewportControllerSource) &&
    has('ref={settingsModalRef}', settingsDialogChromeSource),
  'Switching settings tabs must reset the scrollable settings content to the top.',
)
expect(
  has('const syncConfigRef = useRef<HTMLDivElement | null>(null)', settingsViewportControllerSource) &&
    has('const pendingSyncConfigScrollRef = useRef(false)', settingsViewportControllerSource) &&
    has('const scrollSyncConfigIntoView = useCallback((): void => {', settingsViewportControllerSource) &&
    has('scrollInteractionElementIntoView(target, {', settingsViewportControllerSource) &&
    has('const visibleTop = Math.max(modalRect.top, stickyBottom) + 12', settingsViewportControllerSource) &&
    has('scrollInteractionElementTo(modal, {', settingsViewportControllerSource) &&
    has('Math.max(0, modal.scrollTop + targetRect.top - visibleTop)', settingsViewportControllerSource) &&
    has('scrollSyncConfigIntoView()', settingsViewportControllerSource) &&
    has("settingsTab === 'sync' && mode !== 'local'", settingsViewportControllerSource) &&
    has('requestSyncConfigScroll(mode, context.currentSyncMode)', syncSettingsControllerSource) &&
    has('useSyncSettingsController({') &&
    has("data.sync.mode !== 'local' ? (", syncSettingsPanelSource) &&
    has('className="settings-note guide-requirement"', syncSettingsPanelSource) &&
    has('className="sync-config-fields"', syncSettingsPanelSource) &&
    has(/\.sync-config-fields\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*gap:\s*12px;[^}]*scroll-margin-top:\s*12px;/s, cssSource) &&
    has(/@media \(max-width: 520px\)[\s\S]*?\.sync-settings\s*\{[^}]*padding-bottom:\s*220px;/s, cssSource) &&
    has(/@media \(max-width: 360px\)[\s\S]*?\.sync-settings\s*\{[^}]*padding-bottom:\s*960px;/s, cssSource) &&
    has('settings-modal-${settingsTab}', settingsDialogChromeSource) &&
    has(/@media \(max-width: 360px\)[\s\S]*?\.settings-modal-sync::after\s*\{[^}]*height:\s*720px;/s, cssSource),
  'Sync settings must bring Gist/Cloudflare configuration fields into view after selecting a cloud sync mode.',
)
expect(
  has("const syncConfigTitleId = 'sync-config-title'", syncSettingsPanelSource) &&
    has("const syncConfigDescriptionId = 'sync-config-description'", syncSettingsPanelSource) &&
    has('className="sync-config-fields"', syncSettingsPanelSource) &&
    has('role="group"', syncSettingsPanelSource) &&
    has('aria-labelledby={syncConfigTitleId}', syncSettingsPanelSource) &&
    has('aria-describedby={syncConfigDescriptionId}', syncSettingsPanelSource) &&
    has('id={syncConfigTitleId}', syncSettingsPanelSource) &&
    has('{syncModeLabel}', syncSettingsPanelSource) &&
    has('id={syncConfigDescriptionId}', syncSettingsPanelSource) &&
    has('{syncStatusText}', syncSettingsPanelSource),
  'Sync settings cloud configuration fields must expose a named group for the selected cloud mode.',
)
expect(
  has("const syncCompareTitleId = 'sync-compare-title'", syncSettingsPanelSource) &&
    has("const syncCompareDescriptionId = 'sync-compare-description'", syncSettingsPanelSource) &&
    has('className="sync-compare"', syncSettingsPanelSource) &&
    has('aria-labelledby={syncCompareTitleId}', syncSettingsPanelSource) &&
    has('aria-describedby={syncCompareDescriptionId}', syncSettingsPanelSource) &&
    has('className="sync-compare-grid"', syncSettingsPanelSource) &&
    has('role="group"', syncSettingsPanelSource) &&
    has('className="sr-only"', syncSettingsPanelSource) &&
    has('id={syncCompareTitleId}', syncSettingsPanelSource) &&
    has("t('sync.compare.title')", syncSettingsPanelSource) &&
    has('id={syncCompareDescriptionId}', syncSettingsPanelSource) &&
    has("t('sync.compare.encrypted')", syncSettingsPanelSource) &&
    has("aria-pressed={data.sync.mode === 'local'}", syncSettingsPanelSource) &&
    has("aria-pressed={data.sync.mode === 'gist'}", syncSettingsPanelSource) &&
    has("aria-pressed={data.sync.mode === 'cloudflare'}", syncSettingsPanelSource),
  'Sync settings mode chooser must expose a stable accessible title, encrypted-sync description, and selected mode state.',
)
expect(
  has("const syncRequirementId = 'sync-requirement'", syncSettingsPanelSource) &&
    has("const syncRecentStatusId = 'sync-recent-status'", syncSettingsPanelSource) &&
    has('const syncNowDescriptionIds = [', syncSettingsPanelSource) &&
    has("syncRequirement ? syncRequirementId : ''", syncSettingsPanelSource) &&
    has('syncRecentStatusId,', syncSettingsPanelSource) &&
    has("].filter(Boolean).join(' ')", syncSettingsPanelSource) &&
    has('className="settings-note guide-requirement"', syncSettingsPanelSource) &&
    has('id={syncRequirementId}', syncSettingsPanelSource) &&
    has('const syncNowTooltip = syncRequirement || recentSyncText', syncSettingsPanelSource) &&
    has('className="sync-now-tooltip-target"', syncSettingsPanelSource) &&
    !has('title={syncNowTooltip}', syncSettingsPanelSource) &&
    has('data-tooltip={syncNowTooltip}', syncSettingsPanelSource) &&
    has('disabled={syncing || !!syncRequirement}', syncSettingsPanelSource) &&
    has('onClick={() => runLeafAction(onRunSync)}', syncSettingsPanelSource) &&
    has(/\.sync-now-tooltip-target \.primary-button:disabled\s*\{[^}]*pointer-events:\s*none;/s, cssSource) &&
    has('aria-busy={syncing || undefined}', syncSettingsPanelSource) &&
    has('aria-describedby={syncNowDescriptionIds}', syncSettingsPanelSource) &&
    has('Disabled Sync now button should show its blocking reason in the delayed app tooltip', browserSmokeSource) &&
    has('id={syncRecentStatusId}', syncSettingsPanelSource) &&
    has('role="status"', syncSettingsPanelSource) &&
    has('aria-live="polite"', syncSettingsPanelSource) &&
    has('aria-atomic="true"', syncSettingsPanelSource),
  'Sync settings Sync now button must expose requirement-blocked, recent-sync, and busy states to assistive technology.',
)
expect(
  has("const syncAutoSyncStatusId = 'sync-auto-sync-status'", syncSettingsPanelSource) &&
    has('className="provider-list-toggle sync-auto-toggle"', syncSettingsPanelSource) &&
    has("t('field.autoSync')", syncSettingsPanelSource) &&
    has("t('sync.autoSync.on')", syncSettingsPanelSource) &&
    has("t('sync.autoSync.off')", syncSettingsPanelSource) &&
    has('aria-describedby={syncAutoSyncStatusId}', syncSettingsPanelSource) &&
    has('id={syncAutoSyncStatusId}', syncSettingsPanelSource) &&
    has('checked={data.sync.autoSync}', syncSettingsPanelSource) &&
    has('onAutoSyncChange(event.target.checked)', syncSettingsPanelSource),
  'Sync settings automatic-sync checkbox must expose its current behavior note through aria-describedby.',
)
expect(
  has("const gistIdHintId = 'sync-gist-id-hint'", syncSettingsPanelSource) &&
    has("const gistFileHintId = 'sync-gist-file-hint'", syncSettingsPanelSource) &&
    has("const githubTokenHintId = 'sync-github-token-hint'", syncSettingsPanelSource) &&
    has("const cloudflareWorkerHintId = 'sync-cloudflare-worker-url-hint'", syncSettingsPanelSource) &&
    has("const cloudflareAccessKeyHintId = 'sync-cloudflare-access-key-hint'", syncSettingsPanelSource) &&
    has("t('settings.gistIdHint')", syncSettingsPanelSource) &&
    has("t('settings.gistFileHint')", syncSettingsPanelSource) &&
    has("t('settings.githubTokenHint')", syncSettingsPanelSource) &&
    has("t('settings.cloudflareWorkerUrlHint')", syncSettingsPanelSource) &&
    has("t('settings.cloudflareAccessKeyFieldHint')", syncSettingsPanelSource) &&
    has('aria-describedby={gistIdHintId}', syncSettingsPanelSource) &&
    has('aria-describedby={gistFileHintId}', syncSettingsPanelSource) &&
    has('describedBy: githubTokenHintId', syncSettingsPanelSource) &&
    has('aria-describedby={cloudflareWorkerHintId}', syncSettingsPanelSource) &&
    has('describedBy: cloudflareAccessKeyDescriptionIds', syncSettingsPanelSource),
  'Sync configuration fields must expose visible localized Gist and Cloudflare guidance through aria-describedby.',
)
expect(
  has(
    "const deleteProviderLabel = `${t('button.deleteProvider')}: ${selectedProviderName}`",
    providerSettingsEditorSource,
  ) &&
    has('data-provider-delete-action="true"', providerSettingsEditorSource) &&
    has('aria-label={deleteProviderLabel}', providerSettingsEditorSource) &&
    !has('title={deleteProviderLabel}', providerSettingsEditorSource) &&
    has('data-tooltip={deleteProviderLabel}', providerSettingsEditorSource),
  'Provider settings delete action must expose the selected Provider name in its accessible name and tooltip.',
)
expect(
  has(
    "const cloudflareAccessKeyCopyLabel = `${t('button.copy')}: ${t('field.cloudflareAccessKey')}`",
    syncSettingsPanelSource,
  ) &&
    has('aria-label={cloudflareAccessKeyCopyLabel}', syncSettingsPanelSource) &&
    !has('title={cloudflareAccessKeyCopyLabel}', syncSettingsPanelSource) &&
    has('data-tooltip={cloudflareAccessKeyCopyLabel}', syncSettingsPanelSource) &&
    has('onClick={() => runLeafAction(onCopyCloudflareAccessKey)}', syncSettingsPanelSource) &&
    has('const scrollTarget = target', visualAuditSource) &&
    has('assertFieldNearViewportTop', visualAuditSource) &&
    has("assertFieldNearViewportTop(['Cloudflare 访问密钥', 'Cloudflare access key'])", visualAuditSource),
  'Sync settings Cloudflare access-key copy action must expose the copied target in its accessible name and tooltip, and visual audit must anchor the compact access-key screenshot to that target field.',
)
expect(
  has("from './services/syncRuntimeController'") &&
    has('useSyncRuntimeController({') &&
    has('export function useSyncRuntimeController', syncRuntimeControllerSource) &&
    has('services.materializeAppDataSkillContents(current)', syncRuntimeControllerSource) &&
    has('deleteSkillContentRefs: deleteSkillContentRefsDefault', syncRuntimeControllerSource) &&
    has('async function cleanupUnpublishedSkillContentRefs(', syncRuntimeControllerSource) &&
    has('unpublishedSkillContentRefs = resultSkillContentRefs.filter(', syncRuntimeControllerSource) &&
    has('await cleanupUnpublishedSkillContentRefs(unpublishedSkillContentRefs)', syncRuntimeControllerSource) &&
    has('pendingSyncRunFor(', syncRuntimeControllerSource) &&
    has('shouldDeferSilentRemoteWrite(', syncRuntimeControllerSource) &&
    has('isSyncRemoteWriteDeferredError(error) && options.silent', syncRuntimeControllerSource) &&
    has('clearCloudDataDangerPrompt(context.t, modeLabel)', syncRuntimeControllerSource) &&
    has('opens the first-sync conflict prompt instead of overwriting remote data', syncRuntimeControllerTestSource) &&
    has('silently defers an automatic remote write when generation starts mid-sync', syncRuntimeControllerTestSource) &&
    has('clears cloud data only after confirmation and reports failures in the Data panel', syncRuntimeControllerTestSource) &&
    !has('async function runSync(') &&
    !has('async function clearCloudData(): Promise<void>'),
  'Cloud sync runtime actions must stay in syncRuntimeController with conflict protection, Skill materialization, pending sync coalescing, pending-generation remote-write deferral, and clear-cloud confirmation coverage.',
)
expect(
  has(/\.settings-sticky\s*\{[^}]*top:\s*-18px;[^}]*padding:\s*36px 18px 16px;/s, cssSource) &&
    has(/\.settings-sticky::before\s*\{[^}]*top:\s*-72px;[^}]*z-index:\s*1;[^}]*height:\s*72px;[^}]*background:\s*var\(--surface\);/s, cssSource) &&
    has(/\.settings-sticky \.modal-header,\s*\.settings-sticky \.segmented\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*2;/s, cssSource),
  'Sticky settings header must cover scrolled content above it so lower form sections do not bleed into the header.',
)
expect(
  has("window.addEventListener('resize', scrollActiveTabIntoView)", settingsViewportControllerSource) &&
    has("window.removeEventListener('resize', scrollActiveTabIntoView)", settingsViewportControllerSource),
  'Selected settings tab must stay visible after viewport changes.',
)
expect(
  has('role="menu"', chatProviderModelMenuSource) &&
    (chatProviderModelMenuSource.match(/role="menuitem"/g) ?? []).length >= 1 &&
    has('role="menuitemradio"', chatProviderModelMenuSource) &&
    has('aria-checked={selected}', chatProviderModelMenuSource) &&
    has("const label = providerName + ': ' + model", chatProviderModelMenuSource) &&
    has('aria-label={label}', chatProviderModelMenuSource) &&
    has('data-tooltip={label}', chatProviderModelMenuSource) &&
    has("from './services/appInteractionController'", appRootSource) &&
    has("from './chatModelMenuController'", appInteractionControllerSource) &&
    has('export function useChatModelMenuController(', chatModelMenuControllerSource) &&
    has("import { appUiStore } from '../state/store'", chatModelMenuControllerSource) &&
    has('state.chatModelMenuOpen', chatModelMenuControllerSource) &&
    has('toggleChatModelMenuState(', chatModelMenuControllerSource) &&
    has('const chatModelMenuRef = useRef<HTMLDivElement | null>(null)', chatModelMenuControllerSource) &&
    has('const chatModelTriggerRef = useRef<HTMLButtonElement | null>(null)', chatModelMenuControllerSource) &&
    has('focusInteractionElement(chatModelTriggerRef.current)', chatModelMenuControllerSource) &&
    has("document.addEventListener('mousedown', handlePointerDown)", chatModelMenuControllerSource) &&
    has('handleChatModelMenuKeyDown', chatModelMenuControllerSource) &&
    has("menuRoot?.addEventListener('keydown', handleChatModelMenuKeyDown)", chatModelMenuControllerSource) &&
    has('export function defaultChatModelMenuExpandedProviderId(', chatModelMenuSource) &&
    has('export function nextChatModelMenuExpandedProviderId(', chatModelMenuSource) &&
    has('ref={chatModelTriggerRef}', chatProviderModelMenuSource) &&
    has('<ChatProviderModelMenu', chatHeaderSource),
  'Provider/model menu must expose menu semantics and restore focus to its trigger.',
)
expect(
  has("from './services/appEscapeController'") &&
    has('useAppEscapeController({') &&
    appEscapeControllerSource.includes('export function escapeActionForState') &&
    appEscapeControllerSource.indexOf("return 'danger'") <
      appEscapeControllerSource.indexOf("return 'sync-conflict'") &&
    appEscapeControllerSource.indexOf("return 'sync-conflict'") <
      appEscapeControllerSource.indexOf("return 'settings'") &&
    appEscapeControllerSource.includes("hasDangerModal: Boolean(document.querySelector('.danger-modal'))") &&
    appEscapeControllerSource.includes("hasGuideModal: Boolean(document.querySelector('.guide-modal'))") &&
    appEscapeControllerTestSource.includes(
      'closes sync conflict before the underlying settings modal',
    ) &&
    appEscapeControllerTestSource.includes(
      'keeps required first-run guide open until setup is done',
    ),
  'Escape must close the topmost sync conflict dialog before closing the underlying settings modal.',
)
expect(
  has("from './services/appInteractionController'") &&
    has("from './dangerConfirmationController'", appInteractionControllerSource) &&
    has('export function useDangerConfirmationController(', dangerConfirmationControllerSource) &&
    has('export function shouldBypassDangerConfirmation(', dangerConfirmationSource) &&
    has('const dangerResolverRef = useRef', dangerConfirmationControllerSource) &&
    has('const dangerReturnFocusRef', dangerConfirmationControllerSource) &&
    has('export function focusDangerConfirmationReturnTarget', dangerConfirmationControllerSource) &&
    has('target.focus({ preventScroll: true })', dangerConfirmationControllerSource) &&
    has('focusDangerConfirmationReturnTarget(target)', dangerConfirmationControllerSource) &&
    has('restoreFocusTo(returnTarget)', dangerConfirmationControllerSource) &&
    has("from './modalFocusController'", appInteractionControllerSource) &&
    has('export function useAppInteractionController', appInteractionControllerSource) &&
    has('export function deriveAppOverlayChrome', appInteractionControllerSource) &&
    has('export function useModalFocusController(', modalFocusControllerSource) &&
    has('export function deriveModalFocusState(', modalFocusSource) &&
    has('MODAL_FOCUSABLE_SELECTOR', modalFocusSource) &&
    has("selector: '.danger-modal'", modalFocusSource) &&
    has("selector: '.sync-conflict-modal'", modalFocusSource) &&
    has("selector: '.settings-modal'", modalFocusSource) &&
    has("selector: '.guide-modal'", modalFocusSource) &&
    has('const modalReturnFocusRef = useRef<HTMLElement | null>(null)', modalFocusControllerSource) &&
    has('const activeModalKeyRef = useRef', modalFocusControllerSource) &&
    has('shouldUseSettingsFallbackReturnTarget(', modalFocusControllerSource) &&
    has('export function focusModalElement', modalFocusControllerSource) &&
    has('target.focus({ preventScroll: true })', modalFocusControllerSource) &&
    has('focusModalElement(target)', modalFocusControllerSource) &&
    has('document.addEventListener(\'keydown\', handleTabKey)', modalFocusControllerSource) &&
    has("if (event.key !== 'Tab')", modalFocusControllerSource) &&
    has('settings-modal-${settingsTab}', settingsDialogChromeSource) &&
    has('ref={settingsModalRef}', settingsDialogChromeSource) &&
    has('tabIndex={-1}', settingsDialogChromeSource) &&
    has('focusModalElement(first)', modalFocusControllerSource) &&
    has('focusModalElement(last)', modalFocusControllerSource) &&
    has("modal.querySelector<HTMLElement>('[data-modal-initial-focus=\"true\"]')", modalFocusControllerSource),
  'Topmost modal dialogs must move, trap, and restore keyboard focus.',
)
expect(
  has('className="settings-modal-navigation"', settingsDialogChromeSource) &&
    has('className="settings-modal-content"', settingsDialogChromeSource) &&
    has('className="settings-data-progress"', settingsDialogChromeSource) &&
    has('data-modal-initial-focus="true"', settingsDialogChromeSource) &&
    has('role="status"', settingsDialogChromeSource) &&
    has('aria-live="polite"', settingsDialogChromeSource) &&
    has('tabIndex={0}', settingsDialogChromeSource) &&
    has('disabled={settingsDataPending}', settingsDialogChromeSource) &&
    (settingsDialogChromeSource.match(/inert=\{settingsDataPending\}/g) ?? []).length === 2 &&
    (settingsDialogChromeSource.match(/aria-busy=\{settingsDataPending\}/g) ?? []).length === 2 &&
    has("Boolean(target.closest('[inert]'))", modalFocusControllerSource) &&
    has("modal.querySelector<HTMLElement>('[data-modal-initial-focus=\"true\"]')", modalFocusControllerSource) &&
    has("state.progressRole === 'status'", browserSmokeSource) &&
    has("state.progressLive === 'polite'", browserSmokeSource) &&
    has("state.activeDataAction === 'reset-local'", browserSmokeSource),
  'Settings Data pending must keep dialog semantics and an announced focus target accessible while only mutation surfaces are inert, then restore focus after reset.',
)
expect(
  has('className="sidebar-backdrop mobile-only"', sidebarSource) &&
    has("aria-label={t('button.closeSidebar')}", sidebarSource) &&
    has('if (event.detail > 0)', sidebarSource) &&
    has('onCloseSidebar(false)', sidebarSource) &&
    has('event.currentTarget.blur()', sidebarSource) &&
    has('onCloseSidebar()', sidebarSource),
  'Mobile sidebar must expose a labelled outside-click backdrop that closes by pointer without leaving a focus ring, while keyboard close still restores focus.',
)
expect(
  has("from './services/appInteractionController'") &&
    has("from './sidebarController'", appInteractionControllerSource) &&
    has('export function useSidebarController(', sidebarControllerSource) &&
    has('shouldCloseMobileSidebarForDanger({', appInteractionControllerSource) &&
    has('export function deriveSidebarChrome(', sidebarChromeSource) &&
    has('const sidebarInteractive = sidebarDocked || sidebarOpen', sidebarChromeSource) &&
    has('sidebarTabIndex: sidebarInteractive ? undefined : -1', sidebarChromeSource) &&
    has("import { appUiStore } from '../state/store'", sidebarControllerSource) &&
    has('state.sidebarOpenedByPointer', sidebarControllerSource) &&
    has('openSidebarState(openedByPointer)', sidebarControllerSource) &&
    has('closeSidebarState()', sidebarControllerSource) &&
    has('const openSidebar = useCallback(', sidebarControllerSource) &&
    has('const closeSidebar = useCallback(', sidebarControllerSource) &&
    has('const sidebarOpenButtonRef = useRef<HTMLButtonElement | null>(null)', sidebarControllerSource) &&
    has('const sidebarCloseButtonRef = useRef<HTMLButtonElement | null>(null)', sidebarControllerSource) &&
    has('const sidebarReturnFocusRef = useRef<HTMLElement | null>(null)', sidebarControllerSource) &&
    has("data-pointer-open={openedByPointer ? 'true' : undefined}", sidebarSource) &&
    has(/\.sidebar\[data-pointer-open='true'\]\s+\.brand-row\s+\.icon-button\.mobile-only:focus-visible\s*\{[^}]*box-shadow:\s*none;/s, cssSource) &&
    has('modalOpen: Boolean(', appInteractionControllerSource) &&
    has('keeps first-run guide visibility and modal isolation out of App.tsx', appInteractionControllerTestSource) &&
    has('const mobileSidebarOpen = sidebarOpen && !sidebarDocked', sidebarChromeSource) &&
    has('sidebarHiddenFromAssistiveTech: !sidebarInteractive || modalOpen', sidebarChromeSource) &&
    has('chatPaneHiddenFromAssistiveTech: modalOpen || mobileSidebarOpen', sidebarChromeSource) &&
    has('aria-hidden={hiddenFromAssistiveTech ? true : undefined}', sidebarSource) &&
    has('inert={hiddenFromAssistiveTech ? true : undefined}', sidebarSource) &&
    has('aria-hidden={chatPaneHiddenFromAssistiveTech ? true : undefined}', chatPaneViewSource) &&
    has('inert={chatPaneHiddenFromAssistiveTech ? true : undefined}', chatPaneViewSource) &&
    has('modalBackgroundIsolated', visualAuditSource) &&
    countOccurrences('tabIndex={sidebarTabIndex}', sidebarSource) >= 5 &&
    has('scheduleInteractionFocus(() => sidebarCloseButtonRef.current)', sidebarControllerSource) &&
    has('scheduleInteractionFocus(() => returnTarget)', sidebarControllerSource) &&
    has("window.matchMedia(SIDEBAR_DOCKED_MEDIA_QUERY)", sidebarChromeSource),
  'Closed mobile sidebar must be hidden from assistive tech, removed from keyboard navigation, and restore focus while the desktop sidebar stays interactive.',
)
expect(
  has(/@media \(max-width: 860px\)[\s\S]*?--sidebar-mobile-width:\s*min\(320px,\s*86vw\);/s, cssSource) &&
    has(/@media \(max-width: 860px\)[\s\S]*?\.sidebar\s*\{[^}]*width:\s*var\(--sidebar-mobile-width\);/s, cssSource) &&
    has(/@media \(max-width: 860px\)[\s\S]*?\.sidebar\s*\{[^}]*z-index:\s*15;/s, cssSource) &&
    has(/@media \(max-width: 860px\)[\s\S]*?\.sidebar-backdrop\.mobile-only\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0 0 0 var\(--sidebar-mobile-width\);[^}]*z-index:\s*14;/s, cssSource),
  'Mobile sidebar backdrop must sit behind the open drawer as a real outside-click layer.',
)
expect(
  has('export function focusInteractionElement(', interactionFocusSource) &&
    has('target.focus({ preventScroll: true })', interactionFocusSource) &&
    has('export function scheduleInteractionFocus(', interactionFocusSource) &&
    has('export function scrollInteractionElementIntoView(', interactionFocusSource) &&
    has('export function scrollInteractionElementTo(', interactionFocusSource) &&
    has('contains interaction focus failures', interactionFocusTestSource) &&
    has('contains interaction scroll failures', interactionFocusTestSource) &&
    has('contains interaction scrollTo failures', interactionFocusTestSource) &&
    has('contains interaction scrollTop fallback assignment failures', interactionFocusTestSource) &&
    has('contains tablist keyboard focus failures after changing tabs', settingsNavTestSource) &&
    has('focusInteractionElement(nextTabButton)', settingsNavSource),
  'Shared interaction focus/scroll helpers must contain non-critical focus and scroll failures across menus, sidebars, and settings navigation.',
)
expect(
  countOccurrences("label: 'setting.", settingsNavSource) === 0 &&
    has('t(`setting.${id}` as TranslationKey)', settingsNavSource) &&
    has('className="segmented-label"', settingsNavSource) &&
    has(/\.segmented-label\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s, cssSource),
  'Settings tab labels must use a dedicated no-orphan label wrapper.',
)
expect(
  has(
    /@media \(max-width: 520px\)[\s\S]*?\.segmented\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);[^}]*overflow-x:\s*visible;/s,
    cssSource,
  ),
  'Mobile settings tabs must use a visible 3-column grid so RTL and narrow screens do not clip tabs.',
)
expect(
  has(
    /@media \(max-width: 430px\)[\s\S]*?\.settings-modal\s+\.segmented\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s,
    cssSource,
  ) &&
    has(
      /@media \(max-width: 360px\)[\s\S]*?\.settings-modal\s*\{[^}]*scroll-padding-top:\s*272px;/s,
      cssSource,
    ),
  'Ultra-narrow localized settings tabs must switch to a readable 2-column grid with matching sticky-header scroll padding.',
)
expect(
  has(
    /@media \(max-width: 520px\)[\s\S]*?\.segmented button\s*\{[^}]*min-width:\s*0;[^}]*font-size:\s*12px;[^}]*white-space:\s*nowrap;[^}]*text-align:\s*center;[^}]*overflow-wrap:\s*normal;[^}]*word-break:\s*normal;/s,
    cssSource,
  ),
  'Mobile settings tab labels must avoid splitting localized words into orphan letters.',
)
expect(
  has(
    /@media \(max-width: 520px\)[\s\S]*?\.segmented button\s*\{[^}]*min-height:\s*46px;/s,
    cssSource,
  ) &&
    has(
      /@media \(max-width: 520px\)[\s\S]*?\.settings-modal\s*\{[^}]*scroll-padding-top:\s*210px;/s,
      cssSource,
    ) &&
    has(
      /@media \(max-width: 520px\)[\s\S]*?\.settings-sticky\s*\{[^}]*margin-bottom:\s*16px;[^}]*padding-top:\s*28px;[^}]*padding-bottom:\s*12px;/s,
      cssSource,
    ),
  'Mobile settings header must stay compact enough for the first AI provider API Key field to remain visible on 390px-class screens.',
)
expect(
  has(/\.message-body\s*\{[^}]*max-width:\s*min\(720px, calc\(100% - 44px\)\);/s, cssSource),
  'Message bubbles must keep a readable maximum width.',
)
expect(
  has('className="welcome-actions"', welcomePanelSource) &&
    has('t(\'button.openSettings\')', welcomePanelSource),
  'Empty chat state must provide a direct settings action when setup is incomplete.',
)
expect(
  has('export function deriveComposerChrome(', composerChromeSource) &&
    has('const welcomeSetupRequirement =', composerChromeSource) &&
    has('!activeProviderAvailable ? welcomeGenerationRequirement : \'\'', composerChromeSource) &&
    has('welcomeSetupRequirement ||', composerChromeSource) &&
    has('activeImageInputRequirement ||', composerChromeSource) &&
    has('image.inputPlaceholder', composerChromeSource) &&
    has('setupRequired ? (', welcomePanelSource),
  'Image empty state must explain image-specific setup or source-image blockers instead of reusing chat setup copy.',
)
expect(
  has('export function deriveComposerReadiness(', composerReadinessSource) &&
    has('activeChatRequirement', composerReadinessSource) &&
    has('activeImageRequirement', composerReadinessSource) &&
    has('welcomeGenerationRequirement', composerReadinessSource) &&
    has('shouldUseBrowserProviderKey(welcomeProviderRequest)', composerReadinessSource) &&
    has('export function deriveAppComposerChromeState', appChromeControllerSource) &&
    has('const composerReadiness = deriveComposerReadiness({', appChromeControllerSource) &&
    has('preserves composer readiness, shortcuts, and the local cloud-sync action', appChromeControllerTestSource),
  'Composer provider/model/key readiness must stay in a focused service so empty-state setup guidance remains consistent.',
)
expect(
  has('export function deriveChatSessionState', chatSessionStateSource) &&
    has('activeProviderForConversation(', chatSessionStateSource) &&
    has('conversationMatchesSearch(conversation, normalizedSearchQuery, t)', chatSessionStateSource) &&
    has('modelForConversation(activeConversation, activeProvider)', chatSessionStateSource) &&
    has('imageModelForProvider(activeProvider)', chatSessionStateSource) &&
    has('export function useAppChatSessionController', appChromeControllerSource) &&
    has('deriveChatSessionState({', appChromeControllerSource) &&
    !has('const activeConversation = useMemo(') &&
    !has('const visibleProviders = useMemo(') &&
    !has('const filteredConversations = useMemo(') &&
    !has('const selectedProvider = useMemo('),
  'Active chat session, provider fallback, search filtering, and active model state must stay in a focused service instead of growing App.tsx.',
)
expect(
  has('export function deriveImageComposerChrome(', imageComposerChromeSource) &&
    has("welcomeTitle: t('welcome.imageEditTitle')", imageComposerChromeSource) &&
    has("welcomeTitle: t('welcome.imageInpaintTitle')", imageComposerChromeSource) &&
    has("welcomeTitle: t('welcome.imageTitle')", imageComposerChromeSource) &&
    has("welcomeTitle={", chatPaneMessageSectionSource) &&
    has('welcomeTitle={composerChrome.welcomeTitle}', chatPaneMessageSectionSource),
  'Empty-state title must match chat, image generate, image edit, or image inpaint mode.',
)
expect(
  has('export function AppLogo(', appLogoSource) &&
    has('src={APP_ICON_SRC}', appLogoSource) &&
    has(/\.welcome-panel > \.app-logo\s*\{[^}]*margin:\s*0 auto;/s, cssSource) &&
    !has(/\.welcome-panel \.app-logo\s*\{[^}]*margin:\s*0 auto;/s, cssSource),
  'Welcome app icon styling must target only the direct brand mark.',
)
expect(
  has("import { AppLogo } from './AppLogo'", firstRunGuideSource) &&
    has('<AppLogo size="brand" />', firstRunGuideSource) &&
    has('className="guide-brand-heading"', firstRunGuideSource) &&
    has('className="guide-brand-name"', firstRunGuideSource) &&
    has(/\.guide-brand-heading\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*gap:\s*10px;/s, cssSource) &&
    has(/\.guide-brand-heading \.app-logo\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/s, cssSource),
  'First-run setup must keep the ZeroChat app icon and brand visible while the sidebar is hidden.',
)
expect(
  has('className="guide-sync-panel"', firstRunGuideSource) &&
    has('className="guide-sync-heading"', firstRunGuideSource) &&
    has("<h3>{t('setting.sync')}</h3>", firstRunGuideSource) &&
    has('className="mode-grid"', firstRunGuideSource) &&
    has("aria-label={t('setting.sync')}", firstRunGuideSource) &&
    has("const guideSyncNoteId = 'guide-sync-note'", firstRunGuideSource) &&
    has('aria-describedby={guideSyncNoteId}', firstRunGuideSource) &&
    has(/\.guide-sync-heading\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*flex-start;[^}]*gap:\s*10px;/s, cssSource) &&
    has(/\.guide-sync-heading h3\s*\{[^}]*font-size:\s*15px;/s, cssSource),
  'First-run setup must label cloud sync clearly instead of showing only mode names.',
)
expect(
  has("from './ChatHeader'", chatPaneViewSource) &&
    has('<ChatHeader', chatPaneViewSource) &&
    has('syncChrome={syncChrome}', chatPaneViewSource) &&
    has('const syncChrome = deriveSyncChrome({', appChromeControllerSource) &&
    has("from './services/appChromeController'") &&
    has('export function deriveSyncChrome(', syncChromeSource) &&
    has("t('action.startCloudSync')", syncChromeSource) &&
    has("`${modeLabel} · ${t('action.startCloudSync')}`", syncChromeSource) &&
    has(': requirement ||', syncChromeSource) &&
    has("`${t('setting.sync')}: ${pillText} · ${statusText}`", syncChromeSource) &&
    localeHasValue(zhLocaleSource, 'src/locales/zh-CN.ts', 'action.startCloudSync', '开启云同步') &&
    localeHasValue(zhLocaleSource, 'src/locales/zh-CN.ts', 'sync.status.localMode', '云同步关闭') &&
    has('export function ChatHeader(', chatHeaderSource) &&
    has("import { SyncStatusButton } from './SyncStatusButton'", chatHeaderSource) &&
    has("from './ChatHeaderTitle'", chatHeaderSource) &&
    has('<ChatHeaderTitle', chatHeaderSource) &&
    has("from './ChatProviderModelMenu'", chatHeaderSource) &&
    has('<ChatProviderModelMenu', chatHeaderSource) &&
    has('className="chat-header-logo"', chatHeaderSource) &&
    has('<AppLogo size="brand" />', chatHeaderSource) &&
    has('<SyncStatusButton', chatHeaderSource) &&
    has('variant="header"', chatHeaderSource) &&
    has("onOpenSyncSettings={(event) => onOpenSettings(event, 'sync')}", chatHeaderSource) &&
    has("const openSidebarLabel = t('button.openSidebar')", chatHeaderSource) &&
    has('data-tooltip={openSidebarLabel}', chatHeaderSource) &&
    has("const openSettingsLabel = t('button.openSettings')", chatHeaderSource) &&
    has('data-tooltip={openSettingsLabel}', chatHeaderSource) &&
    has('export function SyncStatusButton(', syncStatusButtonSource) &&
    has('export function SyncModeIcon(', syncStatusButtonSource) &&
    has("'chat-sync-strip ghost-button'", syncStatusButtonSource) &&
    has('data-tooltip={syncChrome.pillLabel}', syncStatusButtonSource) &&
    !has('title={syncChrome.pillLabel}', syncStatusButtonSource) &&
    has('<HardDrive size={size}', syncStatusButtonSource) &&
    has('<GitBranch size={size}', syncStatusButtonSource) &&
    has('<Cloud size={size}', syncStatusButtonSource) &&
    !has('function renderSyncModeIcon', appSource) &&
    !has('syncModeIcon={renderSyncModeIcon()}', appSource) &&
    has(/\.chat-header-logo\s*\{[^}]*display:\s*none;/s, cssSource) &&
    has(/\.chat-sync-strip\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*42px;[^}]*border-color:\s*var\(--accent-border\);/s, cssSource) &&
    has(/@media \(max-width: 860px\)[\s\S]*?\.chat-pane\s*\{[^}]*grid-template-rows:\s*max-content auto minmax\(0, 1fr\) auto auto;/s, cssSource) &&
    has(/@media \(max-width: 860px\)[\s\S]*?\.chat-header\s*\{[^}]*grid-template-columns:\s*38px 32px minmax\(0, 1fr\) 38px;/s, cssSource) &&
    has(/@media \(max-width: 860px\)[\s\S]*?\.chat-header\s*\{[^}]*grid-template-rows:\s*minmax\(38px, auto\) auto auto;/s, cssSource) &&
    has(/@media \(max-width: 860px\)[\s\S]*?\.chat-header\s*\{[^}]*min-height:\s*max-content;/s, cssSource) &&
    has(/@media \(max-width: 860px\)[\s\S]*?\.chat-header-logo\s*\{[^}]*display:\s*flex;/s, cssSource) &&
    has(/@media \(max-width: 860px\)[\s\S]*?\.header-controls\s*\{[^}]*grid-row:\s*2;/s, cssSource) &&
    has(/@media \(max-width: 860px\)[\s\S]*?\.chat-sync-strip\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*36px;/s, cssSource),
  'Chat header must keep the branded app icon on mobile and a direct cloud-sync status action visible without opening the sidebar.',
)
expect(
  has('const promptCards = [', welcomePanelSource) &&
    has("t('welcome.quickPrompt.code')", welcomePanelSource) &&
    has("t('welcome.quickPrompt.email')", welcomePanelSource) &&
    has("t('welcome.quickPrompt.translate')", welcomePanelSource) &&
    has("t('welcome.quickPrompt.brainstorm')", welcomePanelSource) &&
    has('<Code2 size={18} />', welcomePanelSource) &&
    has('<Mail size={18} />', welcomePanelSource) &&
    has('<Languages size={18} />', welcomePanelSource) &&
    has('<Lightbulb size={18} />', welcomePanelSource) &&
    has('className="welcome-prompts"', welcomePanelSource) &&
    has('role="group"', welcomePanelSource) &&
    has("aria-label={t('welcome.quickPromptGroup')}", welcomePanelSource) &&
    has('data-welcome-prompt={card.id}', welcomePanelSource) &&
    has("const actionLabel = t('welcome.quickPromptUse', {", welcomePanelSource) &&
    has('data-tooltip={actionLabel}', welcomePanelSource) &&
    has('aria-label={actionLabel}', welcomePanelSource) &&
    !has('title={actionLabel}', welcomePanelSource) &&
    has('onClick={() => onApplyPrompt(card.prompt)}', welcomePanelSource) &&
    has('welcomeQuickPromptInitialState.tooltips.every(', browserSmokeSource) &&
    !has('const welcomePromptCards', appSource) &&
    !has('welcomePromptCards={welcomePromptCards}', appSource) &&
    !has('promptCards={welcomePromptCards}', messageListSource) &&
    has('context.focusComposerToEnd()', appNavigationControllerSource) &&
    has(
      'expect(harness.context.focusComposerToEnd).toHaveBeenCalledTimes(1)',
      appNavigationControllerTestSource,
    ) &&
    has(/\.welcome-prompts\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s, cssSource) &&
    has(/\.welcome-prompt-card\s*\{[^}]*min-height:\s*58px;[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\);/s, cssSource),
  'WelcomePanel must own four 2x2 quick prompt cards as a named group that fill and focus the App-owned composer.',
)
expect(
  has(
    'export function initialConversationSearchUiState()',
    appUiStoreSource,
  ) &&
    has(
      'export function initialProviderSelectionUiState()',
      appUiStoreSource,
    ) &&
    has("import { appUiStore } from '../state/store'", appRootStateControllerSource) &&
    has('state.conversationSearch', appRootStateControllerSource) &&
    has('state.setConversationSearchState', appRootStateControllerSource) &&
    has('state.selectedProviderId', appRootStateControllerSource) &&
    has('state.setSelectedProviderIdState', appRootStateControllerSource) &&
    !has(
      'const [conversationSearch, setConversationSearch] = useState',
      appRootStateControllerSource,
    ) &&
    !has(
      "const [selectedProviderId, setSelectedProviderId] = useState('')",
      appRootStateControllerSource,
    ) &&
    has("from './services/appChromeController'") &&
    has("from './chatSessionState'", appChromeControllerSource) &&
    has('conversationMatchesSearch(conversation, normalizedSearchQuery, t)', chatSessionStateSource) &&
    has('conversations={filteredConversations}', appMainViewSource) &&
    has('role="search"', sidebarSource) &&
    has("aria-label={t('conversation.searchLabel')}", sidebarSource) &&
    has("placeholder={t('conversation.searchPlaceholder')}", sidebarSource) &&
    has('conversations.map((conversation)', sidebarSource) &&
    has('className="conversation-empty" role="status" aria-live="polite"', sidebarSource) &&
    has("t('conversation.searchNoResultsTitle')", sidebarSource) &&
    has("t('conversation.searchNoResultsBody')", sidebarSource) &&
    has(/\.conversation-search\s*\{[^}]*position:\s*relative;[^}]*display:\s*flex;/s, cssSource) &&
    has(/\.conversation-search input:focus\s*\{[^}]*box-shadow:\s*0 0 0 3px var\(--focus\);/s, cssSource) &&
    has(/\.conversation-empty\s*\{[^}]*min-height:\s*180px;[^}]*text-align:\s*center;/s, cssSource),
  'Sidebar and Settings provider selection must use the shared appUiStore while preserving searchable conversations with a localized no-results empty state and focus styling.',
)
expect(
  has('export function initialSettingsOverlayUiState()', appUiStoreSource) &&
    has('state.settingsOpen', appRootStateControllerSource) &&
    has('state.setSettingsOpenState', appRootStateControllerSource) &&
    has('state.settingsTab', appRootStateControllerSource) &&
    has('state.setSettingsTabState', appRootStateControllerSource) &&
    has('state.guideOpen', appRootStateControllerSource) &&
    has('state.setGuideOpenState', appRootStateControllerSource) &&
    !has(
      'const [settingsOpen, setSettingsOpen] = useState(false)',
      appRootStateControllerSource,
    ) &&
    !has(
      "const [settingsTab, setSettingsTab] = useState<SettingsTab>('providers')",
      appRootStateControllerSource,
    ) &&
    !has(
      'const [guideOpen, setGuideOpen] = useState(false)',
      appRootStateControllerSource,
    ) &&
    has('aria-selected={settingsTab === id}', settingsNavSource) &&
    has('rootGuideVisible(', appRootSource) &&
      has('guideSuccessPending,', appRootSource),
  'Settings and first-run guide overlay state must live in the shared appUiStore while preserving tab aria selection and guide visibility routing.',
)
expect(
  has("from './services/conversationLifecycleController'") &&
    has("from './conversationTitleEditController'", conversationLifecycleControllerSource) &&
    has('export function useConversationTitleEditController(', conversationTitleEditControllerSource) &&
    has("import { appUiStore } from '../state/store'", conversationTitleEditControllerSource) &&
    has('state.editingConversationTitleId', conversationTitleEditControllerSource) &&
    has('state.conversationTitleDraft', conversationTitleEditControllerSource) &&
    has('startConversationTitleEditState(', conversationTitleEditControllerSource) &&
    has('clearConversationTitleEditState(', conversationTitleEditControllerSource) &&
    has('const conversationTitleCancelledRef = useRef(false)', conversationTitleEditControllerSource) &&
    has('export function focusConversationTitleElement', conversationTitleEditControllerSource) &&
    has('element.focus({ preventScroll: true })', conversationTitleEditControllerSource) &&
    has('element.select()', conversationTitleEditControllerSource) &&
    has('focusConversationTitleElement(conversationTitleButtonRef.current)', conversationTitleEditControllerSource) &&
    has(
      'focusConversationTitleElement(conversationTitleInputRef.current, {\n              select: true,\n            })',
      conversationTitleEditControllerSource,
    ) &&
    has('export function conversationTitleEditKeyAction(', conversationTitleEditSource) &&
    has('export function conversationTitleEditIsActive(', conversationTitleEditSource) &&
    has('function commitConversationTitle(', conversationLifecycleControllerSource) &&
    has(
      'renames conversations through updateData and schedules immediate sync',
      conversationLifecycleControllerTestSource,
    ) &&
    has(
      'contains conversation title focus failures',
      conversationLifecycleControllerTestSource,
    ) &&
    has(
      'contains conversation title selection failures after focus succeeds',
      conversationLifecycleControllerTestSource,
    ) &&
    has("const renameLabel = t('conversation.renameLabel')", chatHeaderTitleSource) &&
    has('aria-label={renameLabel}', chatHeaderTitleSource) &&
    has("placeholder={t('conversation.renamePlaceholder')}", chatHeaderTitleSource) &&
    !has("title={t('conversation.renameHint')}", chatHeaderTitleSource) &&
    has("const renameHint = t('conversation.renameHint')", chatHeaderTitleSource) &&
    has('data-tooltip={renameHint}', chatHeaderTitleSource) &&
    has('onConversationTitleKeyDown={handleConversationTitleKeyDown}', chatPaneViewSource) &&
    has('onKeyDown={onConversationTitleKeyDown}', chatHeaderTitleSource) &&
    has('conversationTitleInitialState.tooltip === conversationTitleInitialState.hint', browserSmokeSource) &&
    has(/\.conversation-title-button:focus-visible\s*\{[^}]*box-shadow:\s*0 0 0 3px var\(--focus\);/s, cssSource) &&
    has(/\.conversation-title-input\s*\{[^}]*width:\s*min\(100%, 520px\);[^}]*box-shadow:\s*0 0 0 3px var\(--focus\);/s, cssSource),
  'Chat header title must be a keyboard-accessible, app-tooltipped rename control with visible focus and a stable edit field.',
)
expect(
    has(/\.provider-model-trigger\s*\{[^}]*border-radius:\s*999px;/s, cssSource) &&
    has(/\.provider-model-trigger\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/s, cssSource) &&
    has("aria-label={t('field.providerModel')}", chatProviderModelMenuSource) &&
    has('aria-haspopup="menu"', chatProviderModelMenuSource) &&
    has('role="menuitemradio"', chatProviderModelMenuSource) &&
    has('aria-checked={selected}', chatProviderModelMenuSource) &&
    has('aria-label={label}', chatProviderModelMenuSource) &&
    has('data-tooltip={label}', chatProviderModelMenuSource) &&
    has('providerModelTriggerState()', browserSmokeSource) &&
    has('provider/model header selector should render as a labelled pill', browserSmokeSource),
  'Chat header Provider/Model selector must match the PRD pill shape, stay labelled at runtime, and expose checked models as provider-contextual radio menu items.',
)
expect(
    has('DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT = 24', appDataSource) &&
    has('MIN_CHAT_CONTEXT_MESSAGE_LIMIT = 4', appDataSource) &&
    has('MAX_CHAT_CONTEXT_MESSAGE_LIMIT = 200', appDataSource) &&
    has('function normalizeChatContextMessageLimit', appDataSource) &&
    has('export function updateConversation', appDataSource) &&
    has('export function hasStreamingMessage', appDataSource) &&
    has('export function hasPendingGenerationMessage', appDataSource) &&
    has('export function mergeSyncIdentifiers', appDataSource) &&
    has('chatContextMessageLimit?: number', typesSource) &&
    has('DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT', appDataSource) &&
    has('chatContextMessageLimit: normalizeChatContextMessageLimit', appChromeControllerSource) &&
    has('data-chat-context-setting="true"', modelSettingsSource) &&
    has("t('field.chatContextMessageLimit')", modelSettingsSource) &&
    has('min={MIN_CHAT_CONTEXT_MESSAGE_LIMIT}', modelSettingsSource) &&
    has('max={MAX_CHAT_CONTEXT_MESSAGE_LIMIT}', modelSettingsSource) &&
    has('data-chat-context-window-note="true"', modelSettingsSource) &&
    has("t('settings.chatContextWindowNote'", modelSettingsSource) &&
    has('contextMessageLimit: chatContextMessageLimit', chatGenerationTextSubmitSource) &&
    has(
      'contextMessageLimit: DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT',
      providerConnectivityChecksSource,
    ) &&
    has('export function selectContextMessages', chatServiceSource) &&
    has('.slice(-normalizedLimit)', chatServiceSource) &&
    has("message.role === 'system' && message.content.trim()", chatServiceSource) &&
    has('return [...systemMessages, ...chatMessages]', chatServiceSource) &&
    has('const CONTEXT_LIMIT = 6', chatContextWindowSmokeSource) &&
    has('Base system prompt must stay', chatContextWindowSmokeSource) &&
    has('Injected Skill prompt must stay', chatContextWindowSmokeSource) &&
    has('Context turn 26', chatContextWindowSmokeSource) &&
    has('Context window final prompt', chatContextWindowSmokeSource) &&
    has('data-chat-context-setting="true"', chatContextWindowSmokeSource) &&
    has('Chat context window smoke passed', chatContextWindowSmokeSource),
  'Chat context window must be configurable, clamped, visible in settings, runtime-smoked, and preserve system/Skill prompts while trimming recent chat turns.',
)
expect(
  has('const defaultModelHintId = `default-model-hint-${selectedProvider.id}`', modelSettingsSource) &&
    has('const imageModelHintId = `image-model-hint-${selectedProvider.id}`', modelSettingsSource) &&
    has('const audioSpeechModelHintId =', modelSettingsSource) &&
    has('const audioTranscriptionModelHintId =', modelSettingsSource) &&
    has('const embeddingModelHintId = `embedding-model-hint-${selectedProvider.id}`', modelSettingsSource) &&
    has('const moderationModelHintId = `moderation-model-hint-${selectedProvider.id}`', modelSettingsSource) &&
    has('const realtimeModelHintId = `realtime-model-hint-${selectedProvider.id}`', modelSettingsSource) &&
    has('const modelConnectivityHintId = `model-connectivity-check-hint-${selectedProvider.id}`', modelSettingsSource) &&
    has('const chatContextHintId = `chat-context-message-limit-hint-${selectedProvider.id}`', modelSettingsSource) &&
    has("hintKey: 'settings.defaultModelHint'", modelSettingsSource) &&
    has("hintKey: 'settings.imageModelHint'", modelSettingsSource) &&
    has("hintKey: 'settings.audioSpeechModelHint'", modelSettingsSource) &&
    has("hintKey: 'settings.audioTranscriptionModelHint'", modelSettingsSource) &&
    has("hintKey: 'settings.embeddingModelHint'", modelSettingsSource) &&
    has("hintKey: 'settings.moderationModelHint'", modelSettingsSource) &&
    has("hintKey: 'settings.realtimeModelHint'", modelSettingsSource) &&
    has("t(field.hintKey)", modelSettingsSource) &&
    has("t('settings.modelConnectivityCheckNote')", modelSettingsSource) &&
    has('const modelCheckInProgress = Boolean(checkingProviderId)', modelSettingsSource) &&
    has("import { modelCheckKey } from '../services/providerStatus'", modelDefaultsPanelSource) &&
    has('const modelChecking =', modelDefaultsPanelSource) &&
    has('modelCheckKey(selectedProvider.id, field.kind)', modelDefaultsPanelSource) &&
    has('const modelCheckLabel = modelChecking', modelDefaultsPanelSource) &&
    has('function modelCheckTooltip(', modelSettingsSource) &&
    has('aria-label={`${modelCheckLabel}: ${fieldLabel}`}', modelDefaultsPanelSource) &&
    has('<span>{fieldLabel}</span>', modelSettingsSource) &&
    has('aria-describedby={field.hintId}', modelSettingsSource) &&
    has('dir="auto"', modelSettingsSource) &&
    countOccurrences('aria-describedby={modelConnectivityHintId}', modelSettingsSource) >= 1 &&
    has('声明能力未出现在 /models 时可能显示备用 ID', zhLocaleSource) &&
    has('className="model-check-tooltip-target"', modelSettingsSource) &&
    has("kind: 'chat'", modelSettingsSource) &&
    has("kind: 'image'", modelSettingsSource) &&
    has("kind: 'audio-speech'", modelSettingsSource) &&
    has("kind: 'audio-transcription'", modelSettingsSource) &&
    has("kind: 'embeddings'", modelSettingsSource) &&
    has("kind: 'moderation'", modelSettingsSource) &&
    has("kind: 'realtime'", modelSettingsSource) &&
    has('data-model-check-kind={field.kind}', modelSettingsSource) &&
    has('data-tooltip={tooltip}', modelSettingsSource) &&
    has('disabled={field.models.length === 0 || modelCheckInProgress}', modelSettingsSource) &&
    has('id={modelConnectivityHintId}', modelSettingsSource) &&
    has('aria-describedby={chatContextHintId}', modelSettingsSource) &&
    has(/\.model-check-tooltip-target \.ghost-button:disabled\s*\{[^}]*pointer-events:\s*none;/s, cssSource) &&
    has("waitForTooltipForSelector('.model-check-tooltip-target')", browserSmokeSource) &&
    has('state.image.targetTooltip === state.image.noteText && state.image.text !== state.chat.text', browserSmokeSource) &&
    has('loading model check buttons should scope the busy reason to the active field while disabled idle fields keep guidance', browserSmokeSource) &&
    has('loading model check button should show its busy reason in the delayed app tooltip', browserSmokeSource),
  'Model defaults fields must expose visible localized hints, contextual model-check names, aria-describedby bindings, and disabled tooltip targets for chat model, image model, model checks, and context limit.',
)
expect(
  has("aria-label={`${selectedProvider.name}: ${t('field.models')}`}", modelCatalogEditorSource) &&
    has('names the model chip list with the selected provider', modelCatalogEditorTestSource) &&
    has('const modelListHintId = `model-list-hint-${selectedProvider.id}`', modelCatalogEditorSource) &&
    has('role="group"', modelCatalogEditorSource) &&
    has("const modelNameLabel = `${t('field.modelName')}: ${model}`", modelCatalogEditorSource) &&
    has('aria-label={modelNameLabel}', modelCatalogEditorSource) &&
    countOccurrences('aria-describedby={modelListHintId}', modelCatalogEditorSource) >= 3 &&
    countOccurrences('type="button"', modelCatalogEditorSource) >= 5 &&
    has('keeps model catalog action buttons out of implicit form submission', modelCatalogEditorTestSource) &&
    has("t('settings.modelListNote')", modelCatalogEditorSource) &&
    has('event.preventDefault()', modelCatalogEditorSource) &&
    has(
      "import { setDataTransferDropEffect } from '../services/dragDropEffects'",
      modelCatalogEditorSource,
    ) &&
    has("setDataTransferDropEffect(event.dataTransfer, 'move')", modelCatalogEditorSource) &&
    has(
      'contains model catalog drag dropEffect setter failures',
      modelCatalogEditorTestSource,
    ),
  'Model catalog editor must expose visible model-list guidance, contextual model-name inputs, non-submit action buttons, and contained drag cursor hints.',
)
expect(
  has("import { modelCapabilitiesForModel } from '../services/providerModels'", modelCatalogEditorSource) &&
    has('const modelCapabilities = modelCapabilitiesForModel(model)', modelCatalogEditorSource) &&
    has('data-model-capabilities={modelCapabilities.join(\' \')}', modelCatalogEditorSource) &&
    has('className="model-chip-capabilities"', modelCatalogEditorSource) &&
    has('className="model-chip-capability"', modelCatalogEditorSource) &&
    has('data-tooltip={label}', modelCatalogEditorSource) &&
    has("const deleteModelLabel = `${t('button.deleteModel')}: ${model}`", modelCatalogEditorSource) &&
    has('aria-label={deleteModelLabel}', modelCatalogEditorSource) &&
    has(/\.model-chip\s*\{[^}]*flex-wrap:\s*wrap;[^}]*gap:\s*4px;[^}]*overflow:\s*visible;/s, cssSource) &&
    has(/\.model-chip-capability\s*\{[^}]*border-radius:\s*999px;[^}]*white-space:\s*nowrap;/s, cssSource),
  'Model catalog editor must show localized per-model capability badges without clipping compact model chips.',
)
expect(
    has('modelCapabilitiesForModels(providerModels)', modelProviderListSource) &&
    has('className="model-provider-capabilities"', modelProviderListSource) &&
    has('role="list"', modelProviderListSource) &&
    has('className="model-provider-capability"', modelProviderListSource) &&
    has('role="listitem"', modelProviderListSource) &&
    has('aria-label={`${providerName}: ${capabilitySummary}`}', modelProviderListSource) &&
    has('data-tooltip={label}', modelProviderListSource) &&
    has(/\.model-provider-capabilities\s*\{[^}]*flex-wrap:\s*wrap;[^}]*overflow:\s*visible;/s, cssSource) &&
    has(/\.model-provider-capability\s*\{[^}]*border-radius:\s*999px;[^}]*white-space:\s*nowrap;/s, cssSource),
  'Model provider list must summarize each provider model catalog with localized listed capability badges that can wrap without clipping.',
)
expect(
  has("from './chatGenerationImageSubmit'", chatGenerationControllerSource) &&
    has('sendImageMessageGeneration({', chatGenerationControllerSource) &&
    has('export async function sendImageMessageGeneration', chatGenerationImageSubmitSource) &&
    has("t('notice.imageRequired')", chatGenerationImageSubmitSource) &&
    has("t('notice.offlineImageUnavailable')", chatGenerationImageSubmitSource) &&
    has("purpose: 'source'", chatGenerationImageSubmitSource) &&
    has("purpose: 'mask'", chatGenerationImageSubmitSource) &&
    !has('const userAttachments: MessageAttachment[]', chatGenerationControllerSource) &&
    !has('fileToDataUrl(', chatGenerationControllerSource) &&
    !has('runImageAssistantGeneration({', chatGenerationControllerSource),
  'Image generation/edit/inpaint submit preflight, local attachment assembly, and ready dispatch must stay in chatGenerationImageSubmit instead of the broad generation controller.',
)
expect(
  has("from '../services/imageAttachments'", chatPaneMessageSectionSource) &&
    has('downloadMessageImageAttachment({', chatPaneMessageSectionSource) &&
    has('onDownloadAttachment={downloadMessageAttachment}', chatPaneMessageSectionSource) &&
    has("from './imageAttachments'", chatGenerationImageAttachmentsSource) &&
    has('attachmentByPurpose,', chatGenerationImageAttachmentsSource) &&
    has('fileFromAttachment,', chatGenerationImageAttachmentsSource) &&
    has('export function restoredImageEditFilesFromMessage', chatGenerationImageAttachmentsSource) &&
    has('export function attachmentByPurpose', imageAttachmentsSource) &&
    has('export function downloadImageAttachment', imageAttachmentsSource) &&
    has('export function cleanupImageAttachmentDownloadAnchor', imageAttachmentsSource) &&
    has('export function reportImageDownloadFailureNotice', imageAttachmentsSource) &&
    has('export function downloadMessageImageAttachment', imageAttachmentsSource) &&
    has("setNotice(t('notice.imageDownloadFailed'), 'error', 'message', message.id)", imageAttachmentsSource) &&
    has('reportImageDownloadFailureNotice({ message, setNotice, t })', imageAttachmentsSource) &&
    has('export function fileFromAttachment', imageAttachmentsSource) &&
    !has('function attachmentByPurpose(', chatGenerationControllerSource) &&
    !has('function downloadImageAttachment(', chatGenerationControllerSource) &&
    !has('function fileFromAttachment(', chatGenerationControllerSource),
  'Image attachment source/mask lookup, DOM download, message-anchored download failure notices, and File restoration helpers must stay in the focused imageAttachments service.',
)
expect(
  has(/button\s*\{[^}]*line-height:\s*1;/s, cssSource) &&
    has(/\.primary-button[\s\S]*line-height:\s*1;/, cssSource),
  'Buttons must use a stable line-height so CJK text stays visually centered.',
)
expect(
  has(
    /\.primary-button:disabled,\s*\.send-button:disabled\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--field\) 86%, var\(--surface\)\);[^}]*color:\s*var\(--muted\);[^}]*opacity:\s*1;[^}]*cursor:\s*not-allowed;/s,
    cssSource,
  ),
  'Disabled primary and send buttons must look unavailable instead of like active accent actions.',
)
expect(
  has('const skillDraftEmpty = skillDraftContent.trim().length === 0', skillComposerPanelSource) &&
    has('const skillAddBlocked = skillMutationPending || skillDraftEmpty', skillComposerPanelSource) &&
    has('disabled={skillAddBlocked}', skillComposerPanelSource),
  'Skill add button must stay disabled until trimmed draft content is non-empty.',
)
expect(
  has("from './services/settingsSkillController'") &&
    has('useSettingsSkillListController({', settingsSkillControllerSource) &&
    has('export function useSettingsSkillListController(', settingsSkillListControllerSource) &&
    has(
      "const [pendingSkillRevealId, setPendingSkillRevealId] = useState('')",
      settingsSkillListControllerSource,
    ) &&
    !has('pendingSkillRevealIdRef', settingsSkillListControllerSource) &&
    has('setPendingSkillRevealId(skillId)', settingsSkillListControllerSource) &&
    has("setPendingSkillRevealId('')", settingsSkillListControllerSource) &&
    has('scrollSettingsTargetIntoView(target)', settingsSkillListControllerSource) &&
    has('querySelectorAll<HTMLElement>(', settingsSkillListControllerSource) &&
    has("'[data-skill-id]'", settingsSkillListControllerSource) &&
    has("getAttribute('data-skill-id') === skillId", settingsSkillListControllerSource) &&
    has('data-skill-id={skill.id}', skillSettingsSource),
  'Adding or importing Skills must reveal the new Skill row instead of leaving users at the bottom paste form.',
)
expect(
    has('export const INITIAL_SKILL_RENDER_COUNT = 80', settingsSkillListSource) &&
    has('export const SKILL_RENDER_BATCH_SIZE = 80', settingsSkillListSource) &&
    has('export function deriveRenderedSkillList(', settingsSkillListSource) &&
    has('nextSkillRenderCount(current, skillCount)', settingsSkillListControllerSource) &&
    has('renderedSkills.map((skill)', skillSettingsSource) &&
    has('renderedSkillLimit,', settingsSkillControllerSource) &&
    has('skillListMoreRef', settingsSkillControllerSource) &&
    has('new IntersectionObserver', settingsSkillListControllerSource) &&
    has("t('settings.skillListProgress'", skillSettingsSource) &&
    has("t('button.showMoreSkills')", skillSettingsSource) &&
    has("renderSkillListProgress('top')", skillSettingsSource) &&
    has("renderSkillListProgress('bottom')", skillSettingsSource) &&
    has(/\.skill-list-more\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/s, cssSource) &&
    has(/\.skill-list-more-bottom\s*\{[^}]*justify-items:\s*center;/s, cssSource),
  'Large Skill libraries must render progressively with an accessible show-more fallback instead of mounting every row at once.',
)
expect(
  has("const skillBudgetHintId = 'skill-budget-hint'", skillComposerPanelSource) &&
    countOccurrences('aria-describedby={skillBudgetHintId}', skillComposerPanelSource) >= 2 &&
    has('id={skillBudgetHintId}', skillComposerPanelSource) &&
    has("t('settings.skillBudgetNote')", skillComposerPanelSource),
  'Skill budget fields must expose visible localized budget guidance through aria-describedby.',
)
expect(
  has("const skillDraftHintId = 'skill-draft-hint'", skillComposerPanelSource) &&
    countOccurrences('aria-describedby={skillDraftHintId}', skillComposerPanelSource) >= 2 &&
    has('id={skillDraftHintId}', skillComposerPanelSource) &&
    has("t('settings.skillsHelp')", skillComposerPanelSource),
  'Manual Skill creation fields must expose visible localized privacy and loading guidance through aria-describedby.',
)
expect(
  has("const skillImportHintId = 'skill-import-hint'", skillImportPanelSource) &&
    countOccurrences('aria-describedby={skillImportHintId}', skillImportPanelSource) >= 2 &&
    has('id={skillImportHintId}', skillImportPanelSource) &&
    has("t('settings.skillsHelp')", skillImportPanelSource),
  'Skill import control must expose visible encrypted-storage guidance through aria-describedby.',
)
expect(
    has("const skillAddRequirementId = 'skill-add-requirement'", skillComposerPanelSource) &&
    has('const skillAddDescriptionIds = skillAddBlocked', skillComposerPanelSource) &&
    has('const skillAddRequirement = skillMutationPending', skillComposerPanelSource) &&
    has('const skillAddTooltip = skillAddBlocked ? skillAddRequirement : t', skillComposerPanelSource) &&
    has('className="skill-add-tooltip-target"', skillComposerPanelSource) &&
    !has('title={skillAddTooltip}', skillComposerPanelSource) &&
    has('data-tooltip={skillAddTooltip}', skillComposerPanelSource) &&
    has('aria-describedby={skillAddDescriptionIds}', skillComposerPanelSource) &&
    has('id={skillAddRequirementId}', skillComposerPanelSource) &&
    has('aria-live="polite"', skillComposerPanelSource) &&
    has("t('notice.skillContentRequired')", skillComposerPanelSource) &&
    has(/\.skill-add-tooltip-target \.primary-button:disabled\s*\{[^}]*pointer-events:\s*none;/s, cssSource) &&
    has("waitForTooltipForSelector('.skill-add-tooltip-target')", browserSmokeSource) &&
    has('Disabled Add skill button should show its blocking reason in the delayed app tooltip', browserSmokeSource),
  'Skill add action must expose the visible disabled requirement through aria-describedby and the delayed tooltip target.',
)
expect(
  has('const skillEditHintId = `skill-edit-hint-${skill.id}`', skillRowSource) &&
    has('const skillEditRequirementId = `skill-edit-requirement-${skill.id}`', skillRowSource) &&
    has('const skillEditContentMissing = skillEditContent.trim().length === 0', skillRowSource) &&
    has('const skillEditDescriptionIds = skillEditBlocked', skillRowSource) &&
    has('const skillEditRequirement =', skillRowSource) &&
    has('const skillEditTooltip = skillEditBlocked', skillRowSource) &&
    countOccurrences('aria-describedby={skillEditHintId}', skillRowSource) >= 2 &&
    has('className="skill-save-tooltip-target"', skillRowSource) &&
    !has('title={skillEditTooltip}', skillRowSource) &&
    has('data-tooltip={skillEditTooltip}', skillRowSource) &&
    has('aria-describedby={skillEditDescriptionIds}', skillRowSource) &&
    has('id={skillEditHintId}', skillRowSource) &&
    has('id={skillEditRequirementId}', skillRowSource) &&
    has('aria-live="polite"', skillRowSource) &&
    has("t('settings.skillsHelp')", skillRowSource) &&
    has("t('notice.skillContentRequired')", skillRowSource) &&
    has(/\.skill-save-tooltip-target \.primary-button:disabled\s*\{[^}]*pointer-events:\s*none;/s, cssSource) &&
    has("waitForTooltipForSelector('.skill-save-tooltip-target')", browserSmokeSource) &&
    has('Disabled Skill save button should show its blocking reason in the delayed app tooltip', browserSmokeSource),
  'Skill edit form fields and save action must expose visible privacy guidance, disabled requirements, and the delayed tooltip target.',
)
expect(
  has('export function deleteSkillDangerPrompt(', dangerConfirmationSource) &&
    has("id: 'delete-skill'", dangerConfirmationSource) &&
    has("t('danger.deleteSkill.title')", dangerConfirmationSource) &&
    has("t('danger.deleteSkill.body', { name })", dangerConfirmationSource) &&
    has("t('danger.confirmDeleteSkill')", dangerConfirmationSource) &&
    has('requestDangerConfirmation: (prompt: DangerPrompt) => Promise<boolean>', settingsSkillActionsSource) &&
    has('confirmed = await context.requestDangerConfirmation(dangerPrompt)', settingsSkillActionsSource) &&
    has(/catch \{\s*reportSkillSaveUnavailable\(context\)\s*return\s*\}/, settingsSkillActionsSource) &&
    has('deleteSkillDangerPrompt(context.t, skill.name)', settingsSkillActionsSource) &&
    has('async function deleteSkill(skillId: string): Promise<void>', settingsSkillActionsSource) &&
    has('runLeafAction(onDeleteSkill, skill.id)', skillRowSource),
  'Skill deletion must use the shared danger confirmation flow before removing local Skill content.',
)
expect(
  has(/\.welcome-actions \.primary-button\s*\{[^}]*min-height:\s*44px;[^}]*min-width:\s*144px;/s, cssSource),
  'Empty-state primary action must keep a stable, centered tap target.',
)
expect(
  has(/\.model-chip-delete\s*\{[^}]*width:\s*28px;[^}]*min-width:\s*28px;[^}]*height:\s*28px;[^}]*min-height:\s*28px;/s, cssSource),
  'Model chip delete buttons must keep at least a 28px action target.',
)
expect(
  has(/\.provider-list-move,\s*\.model-chip-move\s*\{[^}]*width:\s*28px;[^}]*min-width:\s*28px;[^}]*height:\s*28px;[^}]*min-height:\s*28px;/s, cssSource),
  'Provider and model keyboard reorder buttons must keep stable 28px action targets.',
)
expect(
  has('export function deleteModelDangerPrompt(', dangerConfirmationSource) &&
    has("id: 'delete-model'", dangerConfirmationSource) &&
    has("t('danger.deleteModel.body', { model, provider: providerName })", dangerConfirmationSource) &&
    has("t('danger.confirmDeleteModel')", dangerConfirmationSource) &&
    has('requestDangerConfirmation: (prompt: DangerPrompt) => Promise<boolean>', providerModelEditorControllerSource) &&
    has('export async function confirmProviderModelRemoval(', providerModelEditorControllerSource) &&
    has('deleteModelDangerPrompt(t, model, provider.name)', providerModelEditorControllerSource) &&
    has('await confirmProviderModelRemoval({', providerModelEditorControllerSource) &&
    has('void removeProviderModel(providerId, lastModel)', providerModelEditorControllerSource) &&
    has(
      /runLeafAction\(\s*onRemoveProviderModel,\s*selectedProvider\.id,\s*model,\s*\)/,
      modelSettingsSource,
    ),
  'Model deletion must use the shared danger confirmation flow from both chip and Backspace removal paths.',
)
expect(
  has("from '../services/providerModelEditorController'", settingsOverlayHostSource) &&
    has('export function SettingsOverlayRuntimeHost(', settingsOverlayHostSource) &&
    has('useProviderModelEditorController(', settingsOverlayHostSource) &&
    has('default: module.SettingsOverlayRuntimeHost', appOverlaysViewSource) &&
    has('export function useProviderModelEditorController(', providerModelEditorControllerSource) &&
    has('providerModelPatchAfterRename', providerModelEditorControllerSource) &&
    has('providerModelPatchAfterReorder', providerModelEditorControllerSource) &&
    has('parseProviderModelDraft', providerModelEditorControllerSource) &&
    has('onModelDragStart: handleModelDragStart', settingsOverlayPagePropsSource) &&
    has('onModelDrop: handleModelDrop', settingsOverlayPagePropsSource) &&
    has('onModelDraftChange: handleModelDraftChange', settingsOverlayPagePropsSource) &&
    has('onCommitProviderModelRename: commitProviderModelRename', settingsOverlayPagePropsSource),
  'Provider model add/remove/rename/reorder behavior must stay in a focused controller while ModelSettingsPanel keeps the visible chip editor wiring.',
)
expect(
    has("t('button.addModel')", modelSettingsSource) &&
    has('const modelAddTooltip = canCommitModelDraft', modelSettingsSource) &&
    has('className="model-add-tooltip-target"', modelSettingsSource) &&
    !has('title={modelAddTooltip}', modelSettingsSource) &&
    has('data-tooltip={modelAddTooltip}', modelSettingsSource) &&
    has('aria-describedby={modelListHintId}', modelSettingsSource) &&
    has('disabled={!canCommitModelDraft}', modelSettingsSource) &&
    has(/\.model-add-tooltip-target \.ghost-button:disabled\s*\{[^}]*pointer-events:\s*none;/s, cssSource) &&
    has("waitForTooltipForSelector('.model-add-tooltip-target')", browserSmokeSource) &&
    has('disabled Add model button should show the model-list guidance in the delayed app tooltip', browserSmokeSource) &&
    has(/\.model-list-actions\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-start;/s, cssSource),
  'Model settings must expose a stable explicit Add model action with disabled guidance instead of relying only on keyboard separators.',
)
expect(
  has("t('button.fetchModels')", modelSettingsSource) &&
    has("t('button.fetchingModels')", modelSettingsSource) &&
    has('const modelFetchInProgress = Boolean(loadingModelsProviderId)', modelSettingsSource) &&
    has('const modelFetchCurrent = loadingModelsProviderId === selectedProvider.id', modelSettingsSource) &&
    has('const modelFetchTooltip = modelFetchCurrent', modelSettingsSource) &&
    has('className="model-fetch-tooltip-target"', modelSettingsSource) &&
    has('data-model-fetch-button="settings"', modelSettingsSource) &&
    !has('title={modelFetchTooltip}', modelSettingsSource) &&
    has('data-tooltip={modelFetchTooltip}', modelSettingsSource) &&
    has('aria-describedby={modelListHintId}', modelSettingsSource) &&
    has('disabled={modelFetchInProgress}', modelSettingsSource) &&
    has('const guideModelFetchInProgress = Boolean(loadingModelsProviderId)', firstRunGuideProviderFieldsSource) &&
    has('const guideModelFetchCurrent =', firstRunGuideProviderFieldsSource) &&
    has('loadingModelsProviderId === selectedProvider.id', firstRunGuideProviderFieldsSource) &&
    has('const guideModelFetchTooltip = guideModelFetchCurrent', firstRunGuideProviderFieldsSource) &&
    has('data-model-fetch-button="guide"', firstRunGuideProviderFieldsSource) &&
    !has('title={guideModelFetchTooltip}', firstRunGuideProviderFieldsSource) &&
    has('data-tooltip={guideModelFetchTooltip}', firstRunGuideProviderFieldsSource) &&
    has('disabled={guideModelFetchInProgress}', firstRunGuideProviderFieldsSource) &&
    has(/\.model-fetch-tooltip-target \.ghost-button:disabled\s*\{[^}]*pointer-events:\s*none;/s, cssSource) &&
    has("waitForTooltipForSelector('.model-fetch-tooltip-target')", browserSmokeSource) &&
    has('loading Fetch models button should show its busy reason in the delayed app tooltip', browserSmokeSource),
  'Fetch models actions must expose fetching progress through stable selectors, disabled tooltip targets, aria-describedby, and browser-smoked delayed tooltips in Settings and first-run setup.',
)
expect(
  has(/\.icon-button\.conversation-delete\s*\{[^}]*width:\s*30px;[^}]*min-width:\s*30px;[^}]*height:\s*30px;[^}]*min-height:\s*30px;[^}]*padding:\s*0;/s, cssSource),
  'Conversation delete buttons must stay compact in the sidebar instead of inheriting the larger generic icon-button size.',
)
expect(
  has(/\.composer-toolbar button\s*\{[^}]*justify-content:\s*center;/s, cssSource) &&
    has(/\.image-mode-tabs button\s*\{[^}]*justify-content:\s*center;/s, cssSource),
  'Composer mode buttons must explicitly center their icon and label content.',
)
expect(
  has('const COMPOSER_MODE_BUTTONS = [', composerToolbarSource) &&
    has("mode: 'chat'", composerToolbarSource) &&
    has("mode: 'image'", composerToolbarSource) &&
    has("mode: 'audio'", composerToolbarSource) &&
    has('const active = composerMode === mode', composerToolbarSource) &&
    has('data-compose-mode={mode}', composerToolbarSource) &&
    has('aria-pressed={active}', composerToolbarSource),
  'Composer mode buttons must expose the selected chat/image/audio mode through aria-pressed.',
)
expect(
  has("mode: 'chat'", composerToolbarSource) &&
    has("mode: 'image'", composerToolbarSource) &&
    countOccurrences('disabled={generationActive}', composerSurfaceSource) >= 5 &&
    has('aria-disabled={generationActive}', imageComposerPanelSource) &&
    has('const maskUndoTooltip = generationActive', imageComposerPanelSource) &&
    has('const maskClearTooltip = generationActive', imageComposerPanelSource) &&
    has("t('notice.maskRequired')", imageComposerPanelSource) &&
    countOccurrences('className="mask-action-tooltip-target"', imageComposerPanelSource) >= 2 &&
    has("imageTaskMode === 'inpaint' && imageSourceUrl", imageComposerPanelSource) &&
    has('keeps inpaint mask controls hidden until a source image exists', imageComposerPanelTestSource) &&
    has('shows inpaint mask controls once a source image exists', imageComposerPanelTestSource) &&
    has('data-mask-action="undo"', imageComposerPanelSource) &&
    has('data-mask-action="clear"', imageComposerPanelSource) &&
    !has('title={maskUndoTooltip}', imageComposerPanelSource) &&
    has('data-tooltip={maskClearTooltip}', imageComposerPanelSource) &&
    countOccurrences('aria-describedby="mask-keyboard-help"', imageComposerPanelSource) >= 3 &&
    has('disabled={generationActive || !maskTouched}', imageComposerPanelSource) &&
    has('disabled={generationActive || !maskUndoAvailable}', imageComposerPanelSource) &&
    has('const undoMaskCanvas = useCallback', imageComposerControllerSource) &&
    has("t('button.undoMask')", imageComposerPanelSource) &&
    has('maskUndoStackRef', imageComposerControllerSource) &&
    has('generationActive: sending || Boolean(data && hasStreamingMessage(data))', appChromeControllerSource) &&
    has(/\.composer-toolbar button:disabled,\s*\.image-mode-tabs button:disabled\s*\{[^}]*opacity:\s*0\.55;[^}]*cursor:\s*not-allowed;/s, cssSource) &&
    has(/\.mask-controls input\[type='range'\]:disabled\s*\{[^}]*opacity:\s*0\.55;[^}]*cursor:\s*not-allowed;/s, cssSource) &&
    has(/\.mask-action-tooltip-target \.ghost-button:disabled\s*\{[^}]*pointer-events:\s*none;/s, cssSource) &&
    has("waitForTooltipForSelector('.mask-action-tooltip-target')", browserSmokeSource) &&
    has('disabled inpaint mask action should show its missing-mask reason in the delayed app tooltip', browserSmokeSource),
  'Image composer controls must lock and look unavailable while explaining disabled mask actions through aria-describedby and title-free delayed tooltip targets.',
)
expect(
  has(/\.chat-pane-image-tools \.message-list\s*\{[^}]*padding-block:\s*18px 12px;/s, cssSource) &&
    countOccurrences('padding-block: 18px 12px;', cssSource) >= 2 &&
    has(/\.composer\.composer-image-edit \.image-preview-stack,\s*\.composer\.composer-image-inpaint \.image-preview-stack,\s*\.composer\.composer-image-edit \.image-source-preview,\s*\.composer\.composer-image-inpaint \.image-source-preview\s*\{[^}]*max-height:\s*min\(28svh, 150px\);/s, cssSource) &&
    has(/@media \(max-width: 860px\)[\s\S]*?\.chat-pane\s*\{[^}]*grid-template-rows:\s*max-content auto minmax\(0, 1fr\) auto auto;/s, cssSource) &&
    has(/@media \(max-width: 860px\)[\s\S]*?\.header-controls\s*\{[^}]*grid-row:\s*2;/s, cssSource) &&
    has(/@media \(max-width: 860px\)[\s\S]*?\.chat-sync-strip\s*\{[^}]*grid-row:\s*3;/s, cssSource) &&
    has(/@media \(max-width: 300px\)[\s\S]*?\.chat-header\s*\{[^}]*grid-template-columns:\s*38px minmax\(0, 1fr\) 38px;/s, cssSource) &&
    has(/@media \(max-width: 300px\)[\s\S]*?\.chat-header-logo\s*\{[^}]*display:\s*none;/s, cssSource) &&
    has(/@media \(max-width: 300px\)[\s\S]*?\.title-stack\s*\{[^}]*grid-column:\s*2;/s, cssSource) &&
    has(/@media \(max-width: 300px\)[\s\S]*?\.chat-header > \.icon-button\[data-settings-opener='true'\]\s*\{[^}]*grid-column:\s*3;/s, cssSource) &&
    has('chatHeaderContainsProviderTrigger', visualAuditSource) &&
    has('compactChatTitleDefaultVisible', visualAuditSource) &&
    has('imageToolHintClearsHeader', visualAuditSource) &&
    has("document.querySelector('.provider-model-trigger')", visualAuditSource) &&
    has('sticky header should contain the Provider/Model trigger instead of letting it overflow', visualAuditSource) &&
    has('compact chat header should keep short default conversation titles fully visible', visualAuditSource) &&
    has('image tool feature hint should not be covered by the sticky header', visualAuditSource),
  'Image edit/inpaint short viewports must keep the Provider/Model trigger inside the sticky header, keep short default titles visible, and keep the feature hint clear below it.',
)
expect(
  has(/@media \(max-width: 300px\)[\s\S]*?\.composer-toolbar > \.composer-mode-tooltip-target\s*\{[^}]*flex-basis:\s*calc\(33\.333% - 2px\);/s, cssSource) &&
    has(/@media \(max-width: 300px\) and \(max-height: 580px\)[\s\S]*?\.composer-audio \.audio-source-panel\s*\{[^}]*max-height:\s*min\(18svh, 92px\);[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/s, cssSource) &&
    has(/@media \(max-width: 300px\) and \(max-height: 580px\)[\s\S]*?\.composer-audio \.audio-source-name\s*\{[^}]*max-height:\s*2\.9em;[^}]*overflow-y:\s*auto;/s, cssSource) &&
    has('audioComposerSubmissionVisible', visualAuditSource) &&
    has('audio composer textarea and transcribe action should stay visible in the short viewport', visualAuditSource),
  'Audio composer short viewports must bound long source previews and prove the textarea plus transcribe action stay visible.',
)
expect(
  has('exerciseMaskUndo', browserSmokeSource) &&
    has('maskUndoState.afterUndoPixels === 0', browserSmokeSource) &&
    has(
      'maskUndoState.afterClearUndoPixels === maskUndoState.afterSecondPaintPixels',
      browserSmokeSource,
    ),
  'Image inpaint mask controls must have browser-smoke coverage for undoing a stroke and undoing a clear.',
)
expect(
  has(
    'export function abandonUncapturedMaskPointerStroke',
    imageComposerControllerSource,
  ) &&
    has(
      'maskDrawingPointerIdRef.current = abandonUncapturedMaskPointerStroke',
      imageComposerControllerSource,
    ) &&
    has('onPointerOut={onMaskPointerCaptureBoundary}', imageComposerPanelSource) &&
    has(
      'onLostPointerCapture={onMaskPointerCaptureBoundary}',
      imageComposerPanelSource,
    ) &&
    has(
      'onMaskPointerCaptureBoundary={abandonMaskStrokeIfUncaptured}',
      chatPaneComposerSectionSource,
    ) &&
    has('maskUndoState.captureFailurePaintPixels > 0', browserSmokeSource) &&
    has(
      'maskUndoState.captureFailureRecoveryUndoPixels ===',
      browserSmokeSource,
    ) &&
    has('maskUndoState.captureFailurePaintPixels', browserSmokeSource),
  'Image inpaint mask ownership must recover when pointer capture is unavailable or lost.',
)
expect(
  has('const handleMaskCanvasKeyDown = useCallback', imageComposerControllerSource) &&
    has('paintMaskAtKeyboardCursor', imageComposerControllerSource) &&
    has('maskKeyboardCursorRef', imageComposerControllerSource) &&
    has('aria-describedby="mask-keyboard-help"', imageComposerPanelSource) &&
    has('onMaskKeyDown={handleMaskCanvasKeyDown}', chatPaneComposerSectionSource) &&
    has('onKeyDown={onMaskKeyDown}', imageComposerPanelSource) &&
    has("t('hint.maskKeyboard')", imageComposerPanelSource) &&
    has(/\.sr-only\s*\{[^}]*clip:\s*rect\(0 0 0 0\);[^}]*white-space:\s*nowrap;/s, cssSource) &&
    has(/\.mask-canvas:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus\);/s, cssSource) &&
    has(/\.mask-keyboard-cursor\s*\{[^}]*pointer-events:\s*none;[^}]*transform:\s*translate\(-50%, -50%\);/s, cssSource) &&
    has('keyboardPaintPixels > 0', browserSmokeSource),
  'Image inpaint mask canvas must support keyboard painting with a visible focus/cursor path and screen-reader instructions.',
)
expect(
  has(/\.file-button input\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*border:\s*0;[^}]*padding:\s*0;/s, cssSource),
  'Hidden file inputs must not inherit visible input dimensions that can distort upload buttons.',
)
expect(
  has(/\.file-button:focus-within\s*\{[^}]*border-color:\s*var\(--accent\);[^}]*box-shadow:\s*0 0 0 3px var\(--focus\);/s, cssSource),
  'Visible file buttons must show a focus ring when their transparent file input receives keyboard focus.',
)
expect(
  has('const imageSourceHelpId = useId()', imageComposerPanelSource) &&
    has('aria-label={t(\'field.sourceImage\')}', imageComposerPanelSource) &&
    has('aria-describedby={imageSourceHelpId}', imageComposerPanelSource) &&
    has('<span id={imageSourceHelpId} className="sr-only">', imageComposerPanelSource) &&
    has("t('hint.sourceImagePaste')", imageComposerPanelSource) &&
    has('className="image-source-name"', imageComposerPanelSource) &&
    has('<output className="image-source-name"', imageComposerPanelSource) &&
    !has('aria-live="polite"', imageComposerPanelSource) &&
    !has('role="status"', imageComposerPanelSource) &&
    has('dir="auto"', imageComposerPanelSource) &&
    has('const audioSourceHelpId = useId()', audioComposerPanelSource) &&
    has('role="group"', imageComposerPanelSource) &&
    has('role="group"', audioComposerPanelSource) &&
    has('aria-label={t(\'button.chooseAudio\')}', audioComposerPanelSource) &&
    has('aria-describedby={audioSourceHelpId}', audioComposerPanelSource) &&
    has('<p id={audioSourceHelpId} className="audio-source-note">', audioComposerPanelSource) &&
    has("t('hint.audioTranscription')", audioComposerPanelSource) &&
    has('className="audio-source-name"', audioComposerPanelSource) &&
    has('<output', audioComposerPanelSource) &&
    !has('role="status"', audioComposerPanelSource) &&
    !has('aria-live="polite"', audioComposerPanelSource) &&
    has('dir="auto"', audioComposerPanelSource) &&
    !has('tabIndex={generationActive ? undefined : 0}', audioComposerPanelSource) &&
    !has(/\.audio-source-panel:focus-visible/, cssSource),
  'Image source paste panel must stay focusable as a described group, while the audio drop zone must stay a described group without a dead tab stop and expose the selected source as live status text.',
)
expect(
  has('onImageSourceDragEnter={handleImageSourceDragEnter}', chatPaneComposerSectionSource) &&
    has('onDragEnter={onImageSourceDragEnter}', imageComposerPanelSource) &&
    has('onImageSourceDrop={handleImageSourceDrop}', chatPaneComposerSectionSource) &&
    has('onDrop={onImageSourceDrop}', imageComposerPanelSource) &&
    has('onImageSourcePaste={handleImageSourcePaste}', chatPaneComposerSectionSource) &&
    has('onPaste={onImageSourcePaste}', imageComposerPanelSource) &&
    has('acceptedImageSourceFromClipboard', imageComposerControllerSource) &&
    has('transferHasFile', imageComposerControllerSource) &&
    has('onImageSourcePreviewFailed()', imageComposerControllerSource) &&
    has(
      'nextImageSourceUrl = replaceOwnedImageSourcePreviewUrl',
      imageComposerControllerSource,
    ) &&
    has("const imageSourceUrlOwnerRef = useRef('')", imageComposerControllerSource) &&
    has(
      'releaseOwnedImageSourcePreviewUrl(imageSourceUrlOwnerRef)',
      imageComposerControllerSource,
    ) &&
    has("from './services/imageComposerController'", appRootSource) &&
    has("reportRootLocalizedNotice({ setNotice, t }, 'notice.imagePreviewFailed', 'error', 'chat')", appRootSource) &&
    has("data-tooltip={t('hint.sourceImagePaste')}", imageComposerPanelSource) &&
    has('tabIndex={generationActive ? undefined : 0}', imageComposerPanelSource) &&
    has('data-drag-active=', imageComposerPanelSource) &&
    has('data-drag-rejected=', imageComposerPanelSource) &&
    has("t('notice.imageSourceUnsupported')", appRootBridgeControllerSource) &&
    has(/\.image-source-panel\[data-drag-active\],\s*\.audio-source-panel\[data-drag-active\]\s*\{[^}]*border-color:\s*var\(--accent\);[^}]*background:\s*var\(--accent-soft\);/s, cssSource) &&
    has(/\.image-source-panel\[data-drag-rejected\],\s*\.audio-source-panel\[data-drag-rejected\]\s*\{[^}]*border-color:\s*var\(--warning\);[^}]*background:\s*color-mix\(in srgb, var\(--warning-soft\) 76%, var\(--field\)\);/s, cssSource) &&
    has(/\.image-source-panel:focus-visible\s*\{[^}]*border-color:\s*var\(--accent\);[^}]*box-shadow:\s*0 0 0 3px var\(--focus\);/s, cssSource) &&
    has('dropTinyImage', browserSmokeSource) &&
    has('pasteTinyImage', browserSmokeSource) &&
    has('startImagePreviewObjectUrlTracking', browserSmokeSource) &&
    has('imagePreviewObjectUrlState', browserSmokeSource) &&
    has('revokeCounts: [1, 0]', browserSmokeSource) &&
    has('dropUnsupportedImageSource', browserSmokeSource) &&
    has('pasteUnsupportedImageSource', browserSmokeSource) &&
    has('pastePlainTextOnSourcePanel', browserSmokeSource) &&
    has('dropping an image on the source panel should attach it without using the file picker', browserSmokeSource) &&
    has('pasting an image on the focused source panel should attach it without using the file picker', browserSmokeSource) &&
    has('dropping an unsupported source file should show rejected drop feedback without replacing the image', browserSmokeSource) &&
    has('pasting an unsupported source file should explain the accepted formats without replacing the image', browserSmokeSource) &&
    has('plain text pasted on the source panel should not be intercepted as an image paste', browserSmokeSource),
  'Image edit/inpaint source panels must accept drag-and-drop and pasted images with visible focus/drop feedback, rejected-format feedback, and real browser-smoke coverage.',
)
expect(
  has('aria-disabled={skillMutationPending}', skillSettingsSource) &&
    has("skillMutationPending ? 'disabled' : ''", skillSettingsSource) &&
    has(/\.file-button\.disabled,\s*\.file-button\[aria-disabled='true'\]\s*\{[^}]*opacity:\s*0\.55;[^}]*cursor:\s*not-allowed;/s, cssSource) &&
    has(/\.file-button\.disabled input,\s*\.file-button\[aria-disabled='true'\] input\s*\{[^}]*cursor:\s*not-allowed;/s, cssSource) &&
    has(/\.file-button:not\(\.disabled\):not\(\[aria-disabled='true'\]\):hover\s*\{/s, cssSource),
  'Busy file-upload labels must expose disabled semantics and a visible unavailable state without hover affordance when their hidden input is disabled.',
)
expect(
  has(/\.message-actions button:not\(:disabled\):hover\s*\{/s, cssSource) &&
    has(/\.icon-button:not\(:disabled\):hover,\s*\.ghost-button:not\(:disabled\):hover,/s, cssSource) &&
    has(/\.danger-button:not\(:disabled\):hover\s*\{/s, cssSource),
  'Disabled action buttons must not receive hover styling that implies they are clickable.',
)
expect(
  has(/\.icon-button,\s*\.ghost-button,\s*\.primary-button,\s*\.danger-button,\s*\.send-button,\s*\.file-button\s*\{[^}]*transition:[^}]*transform 100ms var\(--ease-spring\);/s, cssSource) &&
    has(/\.primary-button:not\(:disabled\):hover,\s*\.send-button:not\(:disabled\):hover\s*\{[^}]*transform:\s*scale\(1\.02\);/s, cssSource) &&
    has(/\.icon-button:not\(:disabled\):active,[\s\S]*?\.file-button:not\(\.disabled\):not\(\[aria-disabled='true'\]\):active\s*\{[^}]*transform:\s*scale\(0\.96\);/s, cssSource) &&
    has(/\.send-button:not\(:disabled\):active\s*\{[^}]*transform:\s*scale\(0\.92\);/s, cssSource) &&
    has('installButtonFeedbackProbe', browserSmokeSource) &&
    has('button hover feedback should micro-scale to roughly 1.02', browserSmokeSource) &&
    has('send button active feedback should press down to roughly scale(0.92)', browserSmokeSource),
  'Buttons must match the PRD motion feedback: transform transition, hover micro-scale, generic press scale(0.96), and stronger send-button press scale(0.92).',
)
expect(
  has(/\.icon-button:focus-visible,\s*\.ghost-button:focus-visible,\s*\.primary-button:focus-visible,\s*\.danger-button:focus-visible,\s*\.send-button:focus-visible\s*\{[^}]*border-color:\s*var\(--accent\);[^}]*box-shadow:\s*0 0 0 3px var\(--focus\);[^}]*outline:\s*none;/s, cssSource),
  'Keyboard-focused buttons must expose the same visible focus ring as form fields.',
)
expect(
  has('export function initialComposerModeUiState()', appUiStoreSource) &&
    has('setComposerModeState: (mode: ComposerMode) => void', appUiStoreSource) &&
    has('setImageTaskModeState: (mode: ImageTaskMode) => void', appUiStoreSource) &&
    has('state.composerMode', appRootStateControllerSource) &&
    has('state.setComposerModeState', appRootStateControllerSource) &&
    has('state.imageTaskMode', appRootStateControllerSource) &&
    has('state.setImageTaskModeState', appRootStateControllerSource) &&
    !has(
      "const [composerMode, setComposerMode] = useState<ComposerMode>('chat')",
      appRootStateControllerSource,
    ) &&
    !has(
      "const [imageTaskMode, setImageTaskMode] = useState<ImageTaskMode>('generate')",
      appRootStateControllerSource,
    ),
  'Chat/image composer mode must live in the shared appUiStore while preserving image task mode accessibility.',
)
expect(
  composerToolbarSource.indexOf('className="image-mode-tabs"') >
    composerToolbarSource.indexOf('className="composer-toolbar"') &&
  composerToolbarSource.indexOf('className="image-mode-tabs"') >
      composerToolbarSource.indexOf('data-compose-mode={mode}') &&
    !has('className="image-mode-tabs"', imageComposerPanelSource),
  'Image task mode tabs must sit inside the main composer toolbar after the Image button.',
)
expect(
  has('export function imageModeShortLabel(', imageComposerChromeSource) &&
    has("return t('mode.imageGenerateShort')", imageComposerChromeSource) &&
    has("return t('mode.imageEditShort')", imageComposerChromeSource) &&
    has("return t('mode.imageInpaintShort')", imageComposerChromeSource) &&
    has('IMAGE_TASK_MODES.map((mode)', composerToolbarSource) &&
    has('const label = imageModeLabel(t, mode)', composerToolbarSource) &&
    has("const streamingTooltip = generationActive ? t('message.streaming') : ''", composerToolbarSource) &&
    has('const tooltip = streamingTooltip || label', composerToolbarSource) &&
    has('aria-label={label}', composerToolbarSource) &&
    !has('title={tooltip}', composerToolbarSource) &&
    has('data-tooltip={tooltip}', composerToolbarSource) &&
    has('className="image-mode-label-full"', composerToolbarSource) &&
    has('className="image-mode-label-compact"', composerToolbarSource) &&
    has('imageTaskModeState()', browserSmokeSource) &&
    has('!tab.targetTitle', browserSmokeSource) &&
    has('tab.ariaLabel === tab.targetTooltip', browserSmokeSource) &&
    has(/\.image-mode-label-compact\s*\{[^}]*display:\s*none;/s, cssSource) &&
    has(/@media \(max-width: 360px\)[\s\S]*?\.image-mode-label-full\s*\{[^}]*display:\s*none;/s, cssSource) &&
    has(/@media \(max-width: 360px\)[\s\S]*?\.image-mode-label-compact\s*\{[^}]*display:\s*inline;/s, cssSource),
  'Compact image task tabs must use short visible labels while preserving full accessible names and app tooltips.',
)
expect(
  has('export function deriveImageComposerChrome(', imageComposerChromeSource) &&
    has('imageTaskMode === \'edit\'', imageComposerChromeSource) &&
    has('submitLabel: t(\'button.editImage\')', imageComposerChromeSource) &&
    has('imageTaskMode === \'inpaint\'', imageComposerChromeSource) &&
    has('submitLabel: t(\'mode.imageInpaint\')', imageComposerChromeSource) &&
    has('submitLabel: t(\'button.generateImage\')', imageComposerChromeSource) &&
    has('submitButtonLabel:', composerChromeSource) &&
    has('composerChrome.submitButtonLabel', chatPaneComposerSectionSource) &&
    has('submitLabel={', chatPaneComposerSectionSource) &&
    has('{submitLabel}', chatComposerSource),
  'Image composer submit button copy must reflect generate, edit, and inpaint instead of using one generic image action.',
)
expect(
  has(/\.composer-toolbar\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*overflow-x:\s*auto;/s, cssSource) &&
    has(/\.composer-toolbar button\s*\{[^}]*white-space:\s*nowrap;/s, cssSource) &&
    has(/\.image-mode-tabs\s*\{[^}]*display:\s*inline-flex;[^}]*flex-wrap:\s*nowrap;[^}]*border-left:\s*1px solid var\(--border\);/s, cssSource),
  'Image task mode tabs must stay compact inside the scroll-safe composer toolbar.',
)
expect(
  has(/\.composer-toolbar\s*\{[^}]*scrollbar-width:\s*none;/s, cssSource) &&
    has(/\.composer-toolbar::\-webkit-scrollbar\s*\{[^}]*height:\s*0;/s, cssSource),
  'Composer mode toolbar must hide horizontal scrollbar chrome in compact layouts.',
)
expect(
  has(
    /@media \(max-width: 360px\)[\s\S]*?\.composer-toolbar\s*\{[^}]*width:\s*100%;[^}]*flex-wrap:\s*wrap;[^}]*overflow-x:\s*visible;/s,
    cssSource,
  ) &&
      has(
        /@media \(max-width: 360px\)[\s\S]*?\.image-mode-tabs\s*\{[^}]*width:\s*100%;[^}]*flex:\s*1 1 100%;[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);[^}]*border-top:\s*1px solid var\(--border\);[^}]*border-left:\s*0;/s,
        cssSource,
      ),
  'Compact mobile composer controls must wrap image task modes into a full-width row inside the same toolbar.',
)
expect(
  has(
    /@media \(max-width: 280px\)[\s\S]*?\.image-mode-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/s,
    cssSource,
  ) &&
    has(
      /@media \(max-width: 280px\)[\s\S]*?\.image-mode-tabs button\s*\{[^}]*padding-inline:\s*2px;/s,
      cssSource,
    ) &&
    !has(/\.image-mode-tabs button:last-child\s*\{[^}]*grid-column:\s*1 \/ -1;/s, cssSource),
  'Ultra-narrow image task tabs must keep the short Generate/Edit/Inpaint labels in one full-width row.',
)
expect(
  has(
    /@media \(max-width: 300px\)[\s\S]*?\.composer-image-generate\s*\{[^}]*grid-template-columns:\s*1fr;/s,
    cssSource,
  ) &&
    has(
      /@media \(max-width: 300px\)[\s\S]*?\.composer-image-generate \.send-button\s*\{[^}]*width:\s*100%;[^}]*min-height:\s*42px;/s,
      cssSource,
    ),
  'Ultra-narrow image generation must stack the prompt field above the action button so CJK placeholders do not squeeze into single-character wraps.',
)
expect(
  has(/@media \(max-width: 360px\)[\s\S]*?\.image-source-actions,\s*\.audio-source-actions\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\);/s, cssSource) &&
    has(/@media \(max-width: 360px\)[\s\S]*?\.image-source-name,\s*\.audio-source-name\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s, cssSource),
  'Compact image source status text must move below the upload controls instead of being squeezed beside the choose-image button.',
)
expect(
  has(/@media \(max-width: 860px\)[\s\S]*?\.message-list\s*\{[^}]*scrollbar-width:\s*none;/s, cssSource) &&
    has(/@media \(max-width: 860px\)[\s\S]*?\.message-list::\-webkit-scrollbar\s*\{[^}]*width:\s*0;[^}]*height:\s*0;/s, cssSource),
  'Narrow chat layout must hide the internal message scrollbar gutter so the welcome panel aligns with the composer.',
)
expect(
  has(/@media \(max-width: 860px\)[\s\S]*?\.composer\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/s, cssSource) &&
    has(/@media \(max-width: 860px\)[\s\S]*?\.send-button\s*\{[^}]*width:\s*auto;[^}]*min-width:\s*74px;[^}]*align-self:\s*end;/s, cssSource),
  'Narrow chat composer must keep the Send button compact beside the input instead of stretching into a tall rail.',
)
expect(
  has(/@media \(max-width: 520px\)[\s\S]*?\.modal\s*\{[^}]*scrollbar-width:\s*none;/s, cssSource) &&
    has(/@media \(max-width: 520px\)[\s\S]*?\.modal::\-webkit-scrollbar\s*\{[^}]*width:\s*0;[^}]*height:\s*0;/s, cssSource),
  'Narrow full-screen modals must not shift content width when their body starts scrolling.',
)
expect(
  has(/@media \(max-width: 520px\)[\s\S]*?\.guide-modal\s*\{[^}]*height:\s*100svh;[^}]*display:\s*flex;[^}]*overflow:\s*hidden;/s, cssSource) &&
    has(/@media \(max-width: 520px\)[\s\S]*?\.guide-modal \.guide-layout\s*\{[^}]*max-height:\s*none;[^}]*flex:\s*0 1 auto;[^}]*overflow:\s*auto;/s, cssSource),
  'Mobile first-run guide must keep actions visible while the setup body scrolls.',
)
expect(
  firstRunGuideShellSource.indexOf('<FirstRunGuideProviderFields') <
      firstRunGuideShellSource.indexOf('<FirstRunGuideSyncPanel') &&
    !has(/@media \(max-width: 520px\)[\s\S]*?\.guide-provider-fields\s*\{[^}]*order:/s, cssSource) &&
    !has(/@media \(max-width: 520px\)[\s\S]*?\.guide-layout > \.form-stack:nth-child\(2\)\s*\{[^}]*order:/s, cssSource) &&
    has('if (!guide || !requirement) return true', visualAuditSource) &&
    has('guideSyncModeButtonsReachable', visualAuditSource) &&
    has('guideProviderBeforeSync', visualAuditSource) &&
    has(
      'first-run sync choices should remain reachable in the setup scroll area',
      visualAuditSource,
    ) &&
    has('guideRequiredFieldsVisible', visualAuditSource) &&
    has("[data-provider-base-url-field='true']", visualAuditSource) &&
    has('waitForGuideProviderSelection', visualAuditSource) &&
    has('first-run-guide-custom-relay-short-desktop', visualAuditSource) &&
    has('first-run-guide-custom-relay-compact-mobile', visualAuditSource) &&
    has(
      'first-run blocking requirement should keep its required field visible in the current viewport',
      visualAuditSource,
    ),
  'Mobile first-run guide must keep Provider setup before secondary sync in both visual and focus order, with blocking fields visible in every audited viewport.',
)
expect(
  has(/export const GUIDE_FEATURED_PROVIDER_IDS = new Set\(\[[\s\S]*?'openai',[\s\S]*?'anthropic',[\s\S]*?'gemini',[\s\S]*?'deepseek',[\s\S]*?'xai',[\s\S]*?'openrouter',[\s\S]*?\]\)/s, providerConfigSource) &&
    has("from './providerConfig'", firstRunGuideStateSource) &&
    has('const guideProviderCardPresets =', firstRunGuideStateSource) &&
    !has('guideCustomProviderPresets', firstRunGuideStateSource) &&
    has('className="guide-provider-picker"', firstRunGuideSource) &&
    has('role="group"', firstRunGuideProviderPickerSource) &&
    has("aria-label={t('field.provider')}", firstRunGuideProviderPickerSource) &&
    has('className="guide-provider-grid"', firstRunGuideSource) &&
    has("className={`guide-provider-card ${active ? 'active' : ''}`}", firstRunGuideSource) &&
    has('data-guide-provider-card={preset.id}', firstRunGuideSource) &&
    has('const providerMeta = providerPresetMeta(preset, t)', firstRunGuideSource) &&
    has('const providerTooltip = `${providerLabel} · ${providerMeta}`', firstRunGuideSource) &&
    has('data-tooltip={providerTooltip}', firstRunGuideSource) &&
    has('aria-label={providerTooltip}', firstRunGuideSource) &&
    !has('title={providerTooltip}', firstRunGuideSource) &&
    has('data-provider-accent={providerAccentIdForPresetId(preset.id)}', firstRunGuideSource) &&
    has('{providerPresetBadgeText(preset, t)}', firstRunGuideSource) &&
    has('{providerMeta}', firstRunGuideSource) &&
    !has('guide-custom-relay', firstRunGuideProviderPickerSource) &&
    !has('settings.customRelayHelp', firstRunGuideProviderPickerSource) &&
    has("<optgroup label={t('settings.providerGroupCustom')}>", firstRunGuideProviderPickerSource) &&
    has('className="guide-provider-select-row"', firstRunGuideSource) &&
    has('apiKeyUrl?: string', typesSource) &&
    has("apiKeyUrl: 'https://platform.openai.com/api-keys'", presetsSource) &&
    has("apiKeyUrl: 'https://platform.claude.com/settings/keys'", presetsSource) &&
    has("apiKeyUrl: 'https://aistudio.google.com/app/apikey'", presetsSource) &&
    has("apiKeyUrl: 'https://platform.deepseek.com/api_keys'", presetsSource) &&
    has("apiKeyUrl: 'https://console.x.ai/team/default/api-keys'", presetsSource) &&
    has("apiKeyUrl: 'https://openrouter.ai/settings/keys'", presetsSource) &&
    has('guideProviderKeyHelpUrl: guidePreset.apiKeyUrl', firstRunGuideStateSource) &&
    has('guideProviderKeyTitle: selectedProvider', firstRunGuideStateSource) &&
    has("t('guide.providerKeyTitle'", firstRunGuideStateSource) &&
    has('className="guide-key-help"', firstRunGuideSource) &&
    has('className="guide-key-heading"', firstRunGuideSource) &&
    has('rel="noreferrer"', firstRunGuideSource) &&
    localeHasValue(
      zhLocaleSource,
      'src/locales/zh-CN.ts',
      'guide.providerKeyHelpLink',
      '如何获取 API Key？',
    ) &&
    localeHasValue(
      zhLocaleSource,
      'src/locales/zh-CN.ts',
      'guide.providerKeyTitle',
      '输入 {provider} API Key',
    ) &&
    localeValue(zhLocaleSource, 'src/locales/zh-CN.ts', 'guide.providerKeyLocalOnly') != null &&
    has('不会上传到任何服务器', zhLocaleSource) &&
    has('async function finishGuide(localOnly = false): Promise<void>', firstRunGuideControllerSource) &&
    has('context.runProviderConnectivityCheck(', firstRunGuideControllerSource) &&
    has('models?: string[]', providerStatusSource) &&
    has('export function providerModelPatchFromModels(', providerModelsSource) &&
    has('connectivityResult.models?.length', firstRunGuideControllerSource) &&
    has('providerForGuideWithModels', firstRunGuideControllerSource) &&
    has('connectivityResult?.tone !== \'success\'', firstRunGuideControllerSource) &&
    has('validates the selected provider, stores returned models, and enters chat', firstRunGuideControllerTestSource) &&
    has('const guideCheckInProgress = Boolean(checkingProviderId)', firstRunGuideActionsSource) &&
    has('const guideBlockedByOtherCheck = guideCheckInProgress && !guideCheckingProvider', firstRunGuideActionsSource) &&
    has('disabled={!guideCanFinish || guideCheckInProgress || guideSuccessPending}', firstRunGuideActionsSource) &&
    has('data-provider-connectivity-status="true"', firstRunGuideSource) &&
    has(/\.guide-provider-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s, cssSource) &&
    has(/\.guide-provider-card\s*\{[^}]*min-height:\s*66px;[^}]*border-radius:\s*8px;[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto;/s, cssSource) &&
    has(/\.guide-key-help\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.45;/s, cssSource) &&
    has(/\.guide-key-heading\s*\{[^}]*font-size:\s*15px;[^}]*line-height:\s*1\.3;/s, cssSource) &&
    has(/@media \(max-width: 360px\)[\s\S]*?\.guide-provider-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/s, cssSource) &&
    has('guideProviderKeyHelpState()', browserSmokeSource) &&
    has('waitForGuideProviderKeyHelpState', browserSmokeSource) &&
    has('zerochat-guide-invalid', browserSmokeSource) &&
    has("{ id: 'gpt-image-2' }", browserSmokeSource) &&
    has('modelRequestCount: window.__zeroChatModelsRequestCount', browserSmokeSource) &&
    has("providerMetaText.includes('3')", browserSmokeSource) &&
    has('platform.openai.com/api-keys', browserSmokeSource) &&
    has('aistudio.google.com/app/apikey', browserSmokeSource) &&
    has('guideProviderPickerState()', browserSmokeSource) &&
    has("selectGuideProviderPreset('custom-openai-relay')", browserSmokeSource) &&
    has('enableGuideWorkerHostedKeyRelay', browserSmokeSource) &&
    has('providerKeyValueLength === 0', browserSmokeSource),
  'First-run provider setup must be a card-first mainstream provider picker with custom relays available only through the complete Provider menu, official API-key help, a local encryption note, compact CSS, and browser-smoke coverage.',
)
expect(
  has('export const GUIDE_SUCCESS_CLOSE_DELAY_MS = 1000', uiRuntimeSource) &&
    has('export function waitForGuideSuccessClose(', uiRuntimeSource) &&
    has('export function initialFirstRunGuideUiState()', appUiStoreSource) &&
    has('export function initialProviderSelectionUiState()', appUiStoreSource) &&
    has('setSelectedProviderIdState: (providerId: string) => void', appUiStoreSource) &&
    has('setSelectedPresetIdState: (presetId: string) => void', appUiStoreSource) &&
    has(
      'state.guideSuccessPending',
      appRootStateControllerSource,
    ) &&
    has('state.setGuideSuccessPendingState', appRootStateControllerSource) &&
    has('state.selectedPresetId', appRootStateControllerSource) &&
    has('state.setSelectedPresetIdState', appRootStateControllerSource) &&
    has('state.selectedProviderId', appRootStateControllerSource) &&
    has('state.setSelectedProviderIdState', appRootStateControllerSource) &&
    !has(
      'const [guideSuccessPending, setGuideSuccessPending] = useState(false)',
      appRootStateControllerSource,
    ) &&
    !has(
      'const [selectedPresetId, setSelectedPresetId] = useState(providerPresets[0].id)',
      appRootStateControllerSource,
    ) &&
    !has(
      "const [selectedProviderId, setSelectedProviderId] = useState('')",
      appRootStateControllerSource,
    ) &&
    has('const guideCheckInProgress = Boolean(checkingProviderId)', firstRunGuideActionsSource) &&
    has('const guideBlockedByOtherCheck = guideCheckInProgress && !guideCheckingProvider', firstRunGuideActionsSource) &&
    has("reportFirstRunGuideNotice(\n        context,\n        () => context.t('notice.guideConnectivityPassed'),", firstRunGuideControllerSource) &&
    has('await guideServices.waitForGuideSuccessClose()', firstRunGuideControllerSource) &&
    has("className={`primary-button ${guideSuccessPending ? 'guide-success-button' : ''}`}", firstRunGuideSource) &&
    has('disabled={!guideCanFinish || guideCheckInProgress || guideSuccessPending}', firstRunGuideActionsSource) &&
    has('disabled={guideSuccessPending}', firstRunGuideActionsSource) &&
    has(/guideSuccessPending[\s\S]*?\? t\('button\.connected'\)/, firstRunGuideSource) &&
    localeHasValue(zhLocaleSource, 'src/locales/zh-CN.ts', 'button.connected', '连接成功') &&
    localeHasValue(
      zhLocaleSource,
      'src/locales/zh-CN.ts',
      'notice.guideConnectivityPassed',
      '连接成功！正在进入聊天...',
    ) &&
    has(/\.primary-button\.guide-success-button,[\s\S]*?\.primary-button\.guide-success-button:disabled\s*\{[\s\S]*?background:\s*var\(--success\);/s, cssSource) &&
    has(/\.notice\.success\s*\{[\s\S]*?border-left-color:\s*var\(--success\);/s, cssSource) &&
    has(/\.provider-connectivity-status\.success\s*\{[\s\S]*?border-left-color:\s*var\(--success\);/s, cssSource) &&
    has('noticeText: notice?.textContent?.trim() ??', browserSmokeSource) &&
    has("connectedGuideState.noticeTone === 'success'", browserSmokeSource) &&
    has('doneText: doneButton ? this.textOf(doneButton) :', browserSmokeSource) &&
    has('first-run guide should show a success confirmation before closing', browserSmokeSource) &&
    has("state.statusTone === 'success' && state.doneDisabled", browserSmokeSource),
  'First-run guide must show a green connected confirmation for one second, disable guide actions, then automatically enter chat after a successful /models validation.',
)
expect(
  has('guideModelChoicesVisible: selectedProviderChatModels.length > 1', firstRunGuideStateSource) &&
    has("guideModelChoicesVisible ? 'with-select' : ''", firstRunGuideSource) &&
    has('{guideModelChoicesVisible ? (', firstRunGuideSource),
  'First-run guide must not show a duplicate model select until multiple model choices exist.',
)
expect(
  has('className="settings-note guide-sync-note"', firstRunGuideSource) &&
    has("const guideSyncNoteId = 'guide-sync-note'", firstRunGuideSource) &&
    has('id={guideSyncNoteId}', firstRunGuideSource) &&
    has('aria-describedby={guideSyncNoteId}', firstRunGuideSource) &&
    has(/\.guide-sync-note\s*\{[^}]*margin:\s*0;/s, cssSource) &&
    has(/@media \(max-width: 520px\)[\s\S]*?\.guide-sync-note\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.35;/s, cssSource) &&
    has(/@media \(max-width: 360px\) and \(max-height: 680px\)[\s\S]*?\.guide-sync-note\s*\{[^}]*display:\s*none;/s, cssSource),
  'Compact first-run guide must avoid half-clipped explanatory text above the action bar.',
)
expect(
  has("const guideRequirementId = 'guide-requirement'", firstRunGuideSource) &&
    has('id={guideRequirementId}', firstRunGuideSource) &&
    has('guideRequirement={guideRequirement}', firstRunGuideSource) &&
    has('guideRequirementId={guideRequirement ? guideRequirementId : undefined}', firstRunGuideSource) &&
    has('guideRequirement: string', firstRunGuideActionsSource) &&
    has('guideRequirementId?: string', firstRunGuideActionsSource) &&
    has("const guideBusyHintId = 'guide-check-busy'", firstRunGuideActionsSource) &&
    has('const guideBlockedByOtherCheck =', firstRunGuideActionsSource) &&
    has('const guideDoneDescriptionId = !guideCanFinish', firstRunGuideActionsSource) &&
    has("t('guide.requirement.waitForCheck')", firstRunGuideActionsSource) &&
    has('className="guide-done-tooltip-target"', firstRunGuideActionsSource) &&
    !has('title={guideDoneTooltip}', firstRunGuideActionsSource) &&
    has('data-tooltip={guideDoneTooltip}', firstRunGuideActionsSource) &&
    has('aria-describedby={guideDoneDescriptionId}', firstRunGuideActionsSource) &&
    has('id={guideBusyHintId}', firstRunGuideActionsSource) &&
    localeHasValue(
      zhLocaleSource,
      'src/locales/zh-CN.ts',
      'guide.requirement.waitForCheck',
      '请等待当前检查结束。',
    ) &&
    has(/\.guide-done-tooltip-target \.primary-button:disabled\s*\{[^}]*pointer-events:\s*none;/s, cssSource) &&
    has("waitForTooltipForSelector('.guide-done-tooltip-target')", browserSmokeSource) &&
    has('disabled first-run Done button should show its blocking reason in the delayed app tooltip', browserSmokeSource),
  'First-run guide disabled Done action must expose the current visible requirement or scoped wait reason through aria-describedby and the delayed tooltip target.',
)
expect(
  localeHasValue(
    zhLocaleSource,
    'src/locales/zh-CN.ts',
    'guide.requirement.key',
    '请填写 API Key；也可以先跳过。',
  ) &&
    !has('只想先看界面，可以跳过配置', zhLocaleSource) &&
    !has('可以跳过配置', zhLocaleSource),
  'Chinese first-run requirement copy must stay short enough to avoid awkward CJK word breaks on 280px-class windows.',
)
expect(
  has(/@media \(max-width: 360px\) and \(max-height: 580px\)[\s\S]*?\.guide-modal\s*\{[^}]*overflow:\s*hidden;/s, cssSource) &&
    has(/@media \(max-width: 360px\) and \(max-height: 580px\)[\s\S]*?\.guide-modal\s*\{[^}]*padding-block:\s*14px 10px;/s, cssSource) &&
    has(/@media \(max-width: 360px\) and \(max-height: 580px\)[\s\S]*?\.guide-modal \.modal-header\s*\{[^}]*padding-bottom:\s*10px;/s, cssSource) &&
    has(/@media \(max-width: 360px\) and \(max-height: 580px\)[\s\S]*?\.guide-modal \.modal-header p\s*\{[^}]*display:\s*none;/s, cssSource) &&
    has(/@media \(max-width: 360px\) and \(max-height: 580px\)[\s\S]*?\.guide-modal \.guide-layout\s*\{[^}]*flex:\s*0 1 auto;[^}]*overflow:\s*auto;/s, cssSource) &&
    has(/@media \(max-width: 360px\) and \(max-height: 580px\)[\s\S]*?\.guide-modal \.guide-requirement\s*\{[^}]*margin-top:\s*8px;[^}]*padding-block:\s*8px;/s, cssSource) &&
    has(/@media \(max-width: 360px\) and \(max-height: 580px\)[\s\S]*?\.guide-modal \.modal-actions\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*justify-items:\s*stretch;/s, cssSource) &&
    has(/@media \(max-width: 360px\) and \(max-height: 580px\)[\s\S]*?\.guide-modal \.modal-actions button\s*\{[^}]*width:\s*100%;[^}]*min-height:\s*40px;[^}]*min-width:\s*0;[^}]*white-space:\s*normal;/s, cssSource) &&
    !has(
      /@media \(max-width: 360px\) and \(max-height: 580px\)[\s\S]*?\.guide-modal \.mode-grid\s*\{[^}]*display:\s*none;/s,
      cssSource,
    ),
  'Extreme tiny first-run windows must keep sync-mode shortcuts visible without colliding with the action area.',
)
expect(
  has(/@media \(max-width: 860px\) and \(max-height: 700px\)[\s\S]*?\.welcome-panel\s*\{[^}]*padding:\s*16px;/s, cssSource) &&
    has(/@media \(max-width: 860px\) and \(max-height: 700px\)[\s\S]*?\.welcome-actions \.primary-button\s*\{[^}]*min-height:\s*40px;/s, cssSource),
  'Compact-height chat must shrink the welcome panel so it is not clipped by a tall composer.',
)
expect(
  has(/@media \(max-height: 460px\) and \(orientation: landscape\)[\s\S]*?\.welcome-panel\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;[^}]*padding:\s*9px 12px;[^}]*text-align:\s*left;/s, cssSource) &&
    has(/@media \(max-height: 460px\) and \(orientation: landscape\)[\s\S]*?\.welcome-panel > \.app-logo\s*\{[^}]*display:\s*none;/s, cssSource) &&
    has(/@media \(max-height: 460px\) and \(orientation: landscape\)[\s\S]*?\.welcome-panel h2\s*\{[^}]*grid-column:\s*1;[^}]*font-size:\s*17px;/s, cssSource) &&
    has(/@media \(max-height: 460px\) and \(orientation: landscape\)[\s\S]*?\.welcome-panel p\s*\{[^}]*grid-column:\s*1;[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.25;/s, cssSource) &&
    has(/@media \(max-height: 460px\) and \(orientation: landscape\)[\s\S]*?\.welcome-actions\s*\{[^}]*display:\s*flex;[^}]*grid-row:\s*1 \/ span 2;[^}]*grid-column:\s*2;/s, cssSource) &&
    has(/@media \(max-height: 460px\) and \(orientation: landscape\)[\s\S]*?\.welcome-actions \.primary-button\s*\{[^}]*min-height:\s*34px;[^}]*min-width:\s*116px;/s, cssSource) &&
    has(/@media \(max-height: 460px\) and \(orientation: landscape\)[\s\S]*?\.composer textarea\s*\{[^}]*min-height:\s*36px;[^}]*max-height:\s*88px;/s, cssSource),
  'Low-height landscape chat must keep the welcome action visible while compacting the panel and composer.',
)
const compactImageRuleIndex = cssSource.indexOf('@media (max-width: 360px) and (max-height: 680px)')
const lowHeightLandscapeRuleIndex = cssSource.indexOf('@media (max-height: 460px) and (orientation: landscape)')
expect(
  compactImageRuleIndex !== -1 &&
    lowHeightLandscapeRuleIndex !== -1 &&
    lowHeightLandscapeRuleIndex > compactImageRuleIndex,
  'Low-height landscape compacting must come after narrow compact rules so the cascade keeps enough welcome/composer separation.',
)
expect(
  has(/@media \(max-width: 360px\) and \(max-height: 680px\)[\s\S]*?\.composer textarea\s*\{[^}]*min-height:\s*48px;/s, cssSource),
  'Ultra-compact image placeholders must have enough textarea height to wrap instead of clipping.',
)
expect(
  has(/\.icon-button:disabled,\s*\.ghost-button:disabled,\s*\.danger-button:disabled\s*\{[^}]*opacity:\s*0\.55;[^}]*cursor:\s*not-allowed;/s, cssSource),
  'Disabled secondary, icon, and danger buttons must communicate unavailable state without implying background loading.',
)
expect(
  has(/@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?transition-duration:\s*0\.001ms !important;[\s\S]*?animation-duration:\s*0\.001ms !important;[\s\S]*?\.spin\s*\{[^}]*animation:\s*none !important;/s, cssSource),
  'Motion-sensitive users must be able to reduce transitions and sync spinner animation.',
)
expect(
  has("from './services/appRuntimeController'") &&
    has('useAppRuntimeController({') &&
    !has("window.addEventListener('languagechange'") &&
    !has('loadLocale(targetLocale)') &&
    !has('document.documentElement.dataset.theme = data.preferences.theme') &&
    has('document.documentElement.dataset.theme = data.preferences.theme', appRuntimeControllerSource) &&
    has('themeColorForPreference(', appRuntimeControllerSource) &&
    has('onlineStateFromEvent(', appRuntimeControllerSource) &&
    has('derives the PWA theme color from explicit and system theme preferences', appRuntimeControllerTestSource),
  'Runtime locale, online, and theme DOM side effects must stay in appRuntimeController so App.tsx remains a shrinking shell.',
)
expect(
  has(/scrollbar-color:\s*color-mix\(in srgb, var\(--muted\) 42%, transparent\)\s*transparent;/s, indexCssSource) &&
    has(/\*::\-webkit-scrollbar-thumb\s*\{[^}]*border-radius:\s*999px;[^}]*background:\s*color-mix\(in srgb, var\(--muted\) 38%, transparent\);/s, indexCssSource),
  'Scrollable panels must use quiet theme-aware scrollbars instead of raw browser chrome.',
)
expect(
  has('data-image-task-mode={mode}', composerToolbarSource) &&
    has('scrollActiveImageModeIntoView', settingsViewportControllerSource) &&
    has("window.addEventListener('resize', scrollActiveImageModeIntoView)", settingsViewportControllerSource),
  'Selected image task mode must scroll into view after mode or viewport changes.',
)
expect(
  has("mode: 'chat'", composerToolbarSource) &&
    has("mode: 'image'", composerToolbarSource),
  'Composer mode controls must expose stable selectors for browser QA.',
)
expect(
  has('data-provider-api-key-field="true"', providerSettingsEditorSource) &&
    has("settingsTab !== 'providers' || !settingsOpen", settingsViewportControllerSource) &&
    has("window.matchMedia('(min-width: 521px)').matches", settingsViewportControllerSource) &&
    has("scrollSettingsTargetIntoView(target)", settingsViewportControllerSource),
  'Mobile provider settings must keep the API Key field visible after first-entry hints reserve sticky space.',
)
expect(
  has('async function checkProviderConnectivity(providerId: string)', providerConnectivityChecksSource) &&
    has('async function runProviderConnectivityCheck', providerConnectivityChecksSource) &&
    has('export function useProviderSettingsController(', providerSettingsControllerSource) &&
    has('surfaces provider-key requirements before network checks', providerSettingsControllerTestSource) &&
    has('refreshes provider models through the guarded model-loading state', providerSettingsControllerTestSource) &&
    has('function providerListStatus(', providerConfigSource) &&
    has('function providerAccentId(provider: ProviderConfig): string', providerConfigSource) &&
    has('function providerListMeta(', providerConfigSource) &&
    has('export function providerCheckKey(', providerStatusSource) &&
    has('export function modelCheckKey(', providerStatusSource) &&
    has('export function providerConnectivityErrorField(', providerStatusSource) &&
    has("field: 'providerKey'", providerConnectivityChecksSource) &&
    has("import type {\n  ProviderConnectivityCheckActions,", providerSettingsControllerSource) &&
    has('loadCachedLazyService,', providerSettingsControllerSource) &&
    has('return loadCachedLazyService(', providerSettingsControllerSource) &&
    has("() => import('./providerConnectivityChecks')", providerSettingsControllerSource) &&
    !has("providerConnectivityChecksPromise ??= import('./providerConnectivityChecks')", providerSettingsControllerSource) &&
    has('function createLazyProviderConnectivityCheckActions(', providerSettingsControllerSource) &&
    has('const loadChecks =', providerSettingsControllerSource) &&
    has('await loadChecks()', providerSettingsControllerSource) &&
    has('createProviderConnectivityCheckActions(context, services)', providerSettingsControllerSource) &&
    has('retries provider connectivity actions after a rejected lazy import', providerSettingsControllerTestSource) &&
    !has("import {\n  createProviderConnectivityCheckActions", providerSettingsControllerSource) &&
    has("from './services/providerSettingsController'", readyStageProviderControllersSource) &&
    has('useProviderSettingsController({', readyStageProviderControllersSource) &&
    has("from './readyStageProviderControllers'", appRootSource) &&
    has('useReadyStageProviderControllers({', appRootSource) &&
    !has('useProviderSettingsController({', appRootSource) &&
    has("from '../services/providerStatus'", providerSettingsEditorSource) &&
    has("from '../services/providerStatus'", modelSettingsSource) &&
    !has('async function runProviderConnectivityCheck', appSource) &&
    !has('async function removeProvider(providerId: string)', appSource) &&
    !has('function providerCheckKey(', appSource) &&
    !has('function modelCheckKey(', appSource) &&
    !has('function providerConnectivityErrorField(', appSource) &&
    !has('function providerCheckKey(', providerSettingsSource) &&
    !has('function modelCheckKey(', modelSettingsSource) &&
    has('className="provider-avatar"', providerSettingsListSource) &&
    has('data-provider-accent={providerAccentId(provider)}', providerSettingsListSource) &&
    has('{providerBadgeText(provider, t)}', providerSettingsListSource) &&
    has('{providerListMeta(provider, t)}', providerSettingsListSource) &&
    has(
      "const providerDragLabel = `${providerName}: ${t('settings.dragProviderHint')}`",
      providerSettingsListSource,
    ) &&
    !has('title={providerDragLabel}', providerSettingsListSource) &&
    has('event.preventDefault()', providerSettingsListSource) &&
    has(
      "import { setDataTransferDropEffect } from '../services/dragDropEffects'",
      providerSettingsListSource,
    ) &&
    has("setDataTransferDropEffect(event.dataTransfer, 'move')", providerSettingsListSource) &&
    !has('data-tooltip={providerDragLabel}', providerSettingsListSource) &&
    has('[draggable]', delayedTooltipSource) &&
    has("aria-label={`${t('button.up')}: ${providerName}`}", providerSettingsListSource) &&
    has("aria-label={`${t('button.down')}: ${providerName}`}", providerSettingsListSource) &&
    has('className="provider-list-move"', providerSettingsListSource) &&
    has('[class$=move],[class$=delete]', delayedTooltipSource) &&
    has(
      'Provider list rows should expose contextual drag reorder hints through the app tooltip without native titles',
      browserSmokeSource,
    ) &&
    has("waitForTooltipForSelector('.provider-list-row[draggable=\"true\"]')", browserSmokeSource) &&
    has('data-provider-list-status="true"', providerSettingsListSource) &&
    has('data-provider-list-status-tone={providerStatus.tone}', providerSettingsListSource) &&
    has('data-provider-connectivity-check="true"', providerSettingsEditorSource) &&
    has('data-provider-connectivity-status="true"', providerSettingsEditorSource) &&
    has('data-provider-connectivity-retry="true"', providerSettingsEditorSource) &&
    has('className="provider-connectivity-tooltip-target"', providerSettingsEditorSource) &&
    has('const providerConnectivityChecking =', providerSettingsEditorSource) &&
    has('const providerCheckBlockedByOtherCheck =', providerSettingsEditorSource) &&
    has('const providerRetryChecking =', providerSettingsEditorSource) &&
    has('const providerRetryBlockedByOtherCheck =', providerSettingsEditorSource) &&
    has("t('settings.waitForCheck')", providerSettingsEditorSource) &&
    translationKeyList.includes('settings.waitForCheck') &&
    localeHasValue(
      zhLocaleSource,
      'src/locales/zh-CN.ts',
      'settings.waitForCheck',
      '请等待当前检查结束。',
    ) &&
    !has('title={providerCheckTooltip}', providerSettingsEditorSource) &&
    has('data-tooltip={providerCheckTooltip}', providerSettingsEditorSource) &&
    !has('title={providerRetryTooltip}', providerSettingsEditorSource) &&
    has('data-tooltip={providerRetryTooltip}', providerSettingsEditorSource) &&
    has('aria-invalid={invalid || undefined}', secretInputSource) &&
    has(/\.provider-connectivity-tooltip-target \.primary-button:disabled,[\s\S]*?\.provider-connectivity-tooltip-target \.ghost-button:disabled\s*\{[^}]*pointer-events:\s*none;/s, cssSource) &&
    has("waitForTooltipForSelector('.provider-connectivity-tooltip-target')", browserSmokeSource) &&
    has('loading Provider connection button should show its busy reason in the delayed app tooltip', browserSmokeSource) &&
    has(/\.provider-avatar\s*\{[^}]*--provider-accent:\s*#64748b;[^}]*border-radius:\s*999px;[^}]*font-weight:\s*700;/s, cssSource) &&
    has(/\.provider-avatar\[data-provider-accent='openai'\]\s*\{[^}]*--provider-accent:\s*#10a37f;/s, cssSource) &&
    has(/\.provider-avatar\[data-provider-accent='anthropic'\]\s*\{[^}]*--provider-accent:\s*#d97757;/s, cssSource) &&
    has(/\.provider-avatar\[data-provider-accent='gemini'\]\s*\{[^}]*--provider-accent:\s*#4285f4;/s, cssSource) &&
    has(/\.provider-avatar\[data-provider-accent='deepseek'\]\s*\{[^}]*--provider-accent:\s*#4d6bfe;/s, cssSource) &&
    has(/\.provider-status-dot\s*\{[^}]*background:\s*currentColor;/s, cssSource) &&
    has(/\.form-stack label\.field-has-error > input,[\s\S]*?\.input-icon\.invalid\s*\{[^}]*border-color:\s*var\(--danger\);/s, cssSource) &&
    has(/\.provider-connectivity-status\.error\s*\{[^}]*border-left-color:\s*var\(--danger\);/s, cssSource),
  'Provider connection checks must surface field-level invalid states, branded list identity, model count metadata, human-readable status, action retry affordances, and rejected lazy-import recovery.',
)
expect(
  has('const providerNameHintId = `provider-name-hint-${selectedProvider.id}`', providerSettingsEditorSource) &&
    has('const providerKeyHintId = `provider-key-hint-${selectedProvider.id}`', providerSettingsEditorSource) &&
    has('const providerBaseUrlHintId = `provider-base-url-hint-${selectedProvider.id}`', providerSettingsEditorSource) &&
    has('const providerProxyUrlHintId = `provider-proxy-url-hint-${selectedProvider.id}`', providerSettingsEditorSource) &&
    has("t('settings.providerNameHint')", providerSettingsEditorSource) &&
    has("t('settings.providerKeyHint')", providerSettingsEditorSource) &&
    has("t('settings.providerBaseUrlHint')", providerSettingsEditorSource) &&
    has("t('settings.proxyUrlNote')", providerSettingsEditorSource) &&
    has(
      'data-provider-connectivity-inline-error="proxyUrl"',
      providerSettingsEditorSource,
    ) &&
    has('aria-describedby={providerNameHintId}', providerSettingsEditorSource) &&
    has('describedBy: providerKeyDescriptionIds', providerSettingsEditorSource) &&
    has('aria-describedby={providerBaseUrlDescriptionIds}', providerSettingsEditorSource) &&
    has('aria-describedby={providerProxyUrlDescriptionIds}', providerSettingsEditorSource),
  'Provider setup fields must expose visible localized hints and aria-describedby bindings for Provider name, API key, Base URL, and proxy URL.',
)
expect(
  has('const providerClientRequestModeHintId = `provider-client-request-mode-hint-${selectedProvider.id}`', providerSettingsEditorSource) &&
    has('const providerWorkerHostedKeyHintId = `provider-worker-hosted-key-hint-${selectedProvider.id}`', providerSettingsEditorSource) &&
    has('const providerConnectivityCheckHintId = `provider-connectivity-check-hint-${selectedProvider.id}`', providerSettingsEditorSource) &&
    has('const providerConnectivityActionDescriptionIds = [', providerSettingsEditorSource) &&
    has('aria-describedby={providerClientRequestModeHintId}', providerSettingsEditorSource) &&
    has('aria-describedby={providerWorkerHostedKeyHintId}', providerSettingsEditorSource) &&
    has('aria-describedby={providerConnectivityActionDescriptionIds}', providerSettingsEditorSource) &&
    has('id={providerClientRequestModeHintId}', providerSettingsEditorSource) &&
    has('id={providerWorkerHostedKeyHintId}', providerSettingsEditorSource) &&
    has('id={providerConnectivityCheckHintId}', providerSettingsEditorSource) &&
    has("t('settings.clientRequestModeNote')", providerSettingsEditorSource) &&
    has("t('settings.workerHostedKeyNote')", providerSettingsEditorSource) &&
    has("t('settings.connectivityCheckNote')", providerSettingsEditorSource),
  'Provider privacy toggles and connectivity check must expose their visible guidance through aria-describedby.',
)
expect(
  has('const providerCapabilityBusyHintId =', providerSettingsEditorSource) &&
    has('const capabilityDisabledByReadiness =', providerSettingsEditorSource) &&
    has('const capabilityBlockedByOtherCheck =', providerSettingsEditorSource) &&
    has('const capabilityBusyDescriptionId =', providerSettingsEditorSource) &&
    has('const capabilityCheckTooltip = capabilityChecking', providerSettingsEditorSource) &&
    has('id={providerCapabilityBusyHintId}', providerSettingsEditorSource) &&
    has('aria-describedby={capabilityCheckDescriptionIds}', providerSettingsEditorSource) &&
    !has('title={capabilityCheckTooltip}', providerSettingsEditorSource) &&
    has('data-tooltip={capabilityCheckTooltip}', providerSettingsEditorSource) &&
    has("t('settings.waitForCheck')", providerSettingsEditorSource),
  'Provider single-capability checks must expose scoped active/wait/readiness tooltips and descriptions.',
)
expect(
  has("from './services/featureHintController'") &&
    has("from '../components/FeatureHint'", featureHintControllerSource) &&
    has("from './featureHints'", featureHintControllerSource) &&
    has('<FeatureHint', featureHintControllerSource) &&
    has("export type FeatureHintPlacement = 'chat' | 'menu' | 'settings'", featureHintsSource) &&
    has('type FeatureHintId', typesSource) &&
    has('dismissedFeatureHints?: FeatureHintId[]', typesSource) &&
    has('export function useFeatureHintController(', featureHintControllerSource) &&
    has('const renderFeatureHint = useFeatureHintController({') &&
    has('data-feature-hint={id}', featureHintSource) &&
    has("role={menuHint ? 'none' : 'status'}", featureHintSource) &&
    has("aria-live={menuHint ? undefined : 'polite'}", featureHintSource) &&
    has("aria-atomic={menuHint ? undefined : 'true'}", featureHintSource) &&
    has("role={menuHint ? 'menuitem' : undefined}", featureHintSource) &&
    has('aria-describedby={menuHint ? descriptionId : undefined}', featureHintSource) &&
    has('scheduleInteractionFocus(() =>', featureHintSource) &&
    has('feature-hint-dismiss', featureHintSource) &&
    has("t('featureHint.dismiss')", featureHintSource) &&
    has('export function shouldShowFeatureHint(', featureHintsSource) &&
    has('export function dismissFeatureHintId(', featureHintsSource) &&
    has('guideVisible ||', featureHintsSource) &&
    has('dangerPromptOpen ||', featureHintsSource) &&
    has('syncFirstConflictPromptOpen ||', featureHintsSource) &&
    has("(settingsOpen && placement !== 'settings')", featureHintsSource) &&
    has('dismissFeatureHintId(', featureHintControllerSource) &&
    !has('function renderFeatureHint(') &&
    !has('function dismissFeatureHint(') &&
    !has('function featureHintDismissed('),
  'Feature hints must be lightweight inline UI, dismissible, one-time persisted, and hidden under blocking overlays.',
)
expect(
  has("renderFeatureHint('provider-model', 'menu')", chatPaneViewSource) &&
    has("composerMode === 'image' ? 'image' : 'chat'", chatPaneViewSource) &&
    has('renderFeatureHint(settingsTab, \'settings\')', settingsDialogChromeSource),
  'Feature hints must cover chat, image mode, provider/model menu, and every settings tab entry point.',
)
expect(
  has(/\.feature-hint\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto;/s, cssSource) &&
    has(/\.feature-hint p\s*\{[^}]*overflow-wrap:\s*anywhere;/s, cssSource) &&
    has(/@media \(max-width: 520px\)[\s\S]*?\.feature-hint\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\);/s, cssSource) &&
    has(/@media \(max-width: 520px\)[\s\S]*?\.feature-hint-dismiss\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*width:\s*100%;/s, cssSource),
  'Feature hints must wrap cleanly and keep the dismiss action usable on narrow mobile viewports.',
)
expect(
  has("window.__zeroChatSmoke.waitForFeatureHint('chat')", browserSmokeSource) &&
    has("window.__zeroChatSmoke.dismissFeatureHint('chat')", browserSmokeSource) &&
    has("window.__zeroChatSmoke.waitForFeatureHint('image')", browserSmokeSource) &&
    has("window.__zeroChatSmoke.waitForFeatureHintDismissFocus('provider-model')", browserSmokeSource) &&
    has("window.__zeroChatSmoke.waitForFeatureHint('providers')", browserSmokeSource) &&
    has("window.__zeroChatSmoke.waitForFeatureHint('models')", browserSmokeSource) &&
    has("window.__zeroChatSmoke.waitForFeatureHint('providers', false)", browserSmokeSource) &&
    has("chatFeatureHintState.role === 'status'", browserSmokeSource) &&
    has("modelsFeatureHintState.live === 'polite'", browserSmokeSource) &&
    has("providerModelFeatureHintState.dismissRole === 'menuitem'", browserSmokeSource) &&
    has('providerModelFeatureHintState.dismissFocused', browserSmokeSource) &&
    has('providerModelFeatureHintState.dismissDescriptionLinked', browserSmokeSource) &&
    has("providerModelFeatureHintState.role === 'none'", browserSmokeSource) &&
    has('providerModelHintKeyboardDismissState.focusedMenuItem', browserSmokeSource),
  'Browser smoke must prove ordinary feature hints announce politely while menu hints remain keyboard-owned, dismissible, and non-repeating.',
)

if (failures.length) {
  throw new Error(`UI accessibility checks failed:\n- ${failures.join('\n- ')}`)
}

console.log('UI accessibility checks passed')
