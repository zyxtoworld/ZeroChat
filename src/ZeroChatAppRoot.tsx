import { useCallback } from 'react'

import { RootReadinessScreen } from './components/AppStateScreens'
import { AppReadyStage } from './components/AppReadyStage'
import { useReadyStageProviderControllers } from './readyStageProviderControllers'
import { useAppNoticeController } from './services/appNoticeController'
import { useAudioComposerController } from './services/audioComposerController'
import { useImageComposerController } from './services/imageComposerController'
import { useFeatureHintController } from './services/featureHintController'
import { useSecretInputRenderer } from './services/secretInputRenderer'
import { useMessageVirtualizationController } from './services/messageVirtualizationController'
import { useLocalSaveQueueController } from './services/localSaveQueueController'
import { useSyncPassphraseController } from './services/syncPassphraseController'
import { useAutoSyncController } from './services/autoSyncController'
import { useManagedProxyHostController } from './services/managedProxyHostController'
import { useSettingsDataController } from './services/settingsDataRuntimeController'
import { useSettingsViewportController } from './services/settingsViewportController'
import { useVisualSmokeController } from './services/visualSmokeControllerLoader'
import { useSettingsSkillController } from './services/settingsSkillController'
import { useSyncSettingsController } from './services/syncSettingsController'
import { focusProviderConnectivityField } from './services/providerConnectivityFocus'
import { useSyncRuntimeController } from './services/syncRuntimeController'
import { useChatGenerationController } from './services/chatGenerationController'
import { useConversationLifecycleController } from './services/conversationLifecycleController'
import { useFirstRunGuideController } from './services/firstRunGuideController'
import { useLegacyMigrationNoticeController } from './services/legacyMigrationNoticeController'
import { useAppNavigationController } from './services/appNavigationController'
import { useAppBootstrapController } from './services/appBootstrapController'
import { useAppRuntimeController } from './services/appRuntimeController'
import { useAppDataMutationController } from './services/appDataMutationController'
import { useAppEscapeController } from './services/appEscapeController'
import { useAppMessageController } from './services/appMessageController'
import {
  deriveRootSessionBridgeState,
  deriveRootReadinessState,
  messageForContextMenu,
  reportRootLocalizedNotice,
  reportRootNotice,
  rootGuideVisible,
  rootPromptOpen,
  useAudioSourceNotices,
  useCommitEditsOnBlur,
  useDangerWarningBridge,
  useOfflineQueueFlushRef,
  useSyncControllerRefs,
  useUnsupportedImageSourceNotice,
} from './services/appRootBridgeController'
import { useAppRootStateController } from './services/appRootStateController'
import {
  deriveAppComposerChromeState,
  deriveAppDataChrome,
  useAppChatSessionController,
  useAppLocaleController,
} from './services/appChromeController'
import { useAppInteractionController } from './services/appInteractionController'
import { saveAppData } from './storage/db'
import { recoverAppDataWriteConflict } from './storage/appDataConflictRecovery'
import { setSyncPassphrase } from './storage/secrets'

export function ZeroChatAppRoot() {
  const {
    data, dataRef, draft, draftRef, draftRevisionRef, setData, setDraft,
    providerKeys, providerKeysRef, setProviderKeys,
    githubTokenValue, githubTokenRef, setGithubTokenValue,
    cloudflareAccessKey, setCloudflareAccessKey,
    selectedProviderId, selectedPresetId, setSelectedProviderId, setSelectedPresetId,
    loadingModelsProviderId, checkingProviderId, modelLoadProviderIdRef,
    setLoadingModelsProviderId, setCheckingProviderId,
    providerConnectivityResults, setProviderConnectivityResults,
    settingsOpen, settingsTab, guideOpen, guideSuccessPending,
    setSettingsOpen, setSettingsTab, setGuideOpen, setGuideSuccessPending,
    conversationSearch, setConversationSearch,
    syncFirstConflictPrompt, setSyncFirstConflictPrompt,
    isOnline, isOnlineRef, setIsOnline,
    sending, setSending,
    composerMode, imageTaskMode, setComposerMode, setImageTaskMode,
    syncing, syncingRef, setSyncing,
    loadError, setLoadError,
    systemLanguagesKey, setSystemLanguagesKey, setI18nRevision,
    pendingSyncRef, clearScheduledSyncRef, scheduleAutoSyncRef,
    flushOfflineQueueRef, composerTextareaRef,
  } = useAppRootStateController()
  const languageMode = data?.preferences.language ?? 'system'
  const { locale, setLocale, systemDateLocales, t, targetLocale } = useAppLocaleController({
    languageMode,
    systemLanguagesKey,
  })
  const { chatContextMessageLimit, dataLoaded, generationActive, hasEnabledSkills, syncMode } =
    deriveAppDataChrome({ data, sending })
  const guideVisibleForNotice = rootGuideVisible(data, guideOpen, guideSuccessPending)
  const { clearNotice, currentNotice, setNotice } = useAppNoticeController({
    guideVisible: guideVisibleForNotice,
    settingsOpen,
    settingsTab,
  })
  const syncFirstConflictPromptOpen = rootPromptOpen(syncFirstConflictPrompt)
  const { errorMessage, reportLocalSaveError, syncMessage } = useAppMessageController({
    locale,
    setNotice,
    t,
  })
  const handleLocaleLoadFailure = useCallback(() => {
    reportRootLocalizedNotice({ setNotice, t }, 'notice.localeLoadFailed', 'error')
  }, [setNotice, t])
  const handleCloudflareAccessKeyDerivationFailure = useCallback((error: unknown) => {
    reportRootNotice({ setNotice }, () => t('notice.syncAccessKeyDerivationFailed', { message: errorMessage(error) }), 'error', 'sync')
  }, [errorMessage, setNotice, t])
  useLegacyMigrationNoticeController({ errorMessage, setNotice, t })
  const publishRebasedLocalSnapshot = useCallback((snapshot: NonNullable<typeof data>) => {
    dataRef.current = snapshot
    setData(snapshot)
  }, [dataRef, setData])
  const { commitPublishedLocalSnapshot, markPersistedSnapshot, persistLocalSnapshot, queueLocalSave } = useLocalSaveQueueController({
    data, dataRef,
    onError: reportLocalSaveError,
    onSnapshotRebased: publishRebasedLocalSnapshot,
    recoverSaveConflict: recoverAppDataWriteConflict,
    save: saveAppData,
  })
  const commitEditsOnBlur = useCommitEditsOnBlur({
    dataRef,
    queueLocalSave,
    scheduleAutoSyncRef,
  })
  const { reportSecretWrite, updateData, updateProvider } = useAppDataMutationController({
    dataRef,
    formatErrorMessage: errorMessage,
    scheduleAutoSyncRef,
    setData,
    setNotice,
  })
  const { dismissDangerWarning, isDangerWarningDismissed } = useDangerWarningBridge({
    dataRef,
    setNotice,
    t,
    updateData,
  })
  const interaction = useAppInteractionController({
    data,
    guideOpen,
    guideSuccessPending,
    isWarningDismissed: isDangerWarningDismissed,
    onDismissWarning: dismissDangerWarning,
    settingsOpen,
    syncFirstConflictPromptOpen,
  })
  const {
    allowSettingsReturnFocus,
    cancelDangerPrompt,
    closeChatModelMenu,
    closeSidebar,
    dangerPrompt,
    guideVisible,
    hasActiveModal,
    messageContextMenu,
    rememberSettingsReturnFocusTarget,
    requestDangerConfirmation,
    selectChatModelMenuOption,
    showDangerPrompt,
    sidebarDocked,
    sidebarOpen,
    sidebarOpenButtonRef,
  } = interaction
  const dangerPromptOpen = rootPromptOpen(dangerPrompt)
  const {
    activeSyncPassphraseAvailable,
    activeSyncPassphraseRevision,
    clearSyncPassphrase,
    commitSyncPassphraseOnBlur,
    hydrateSyncPassphrase,
    markSyncPassphraseSynced,
    passphraseRotationPendingRef,
    resetSyncPassphrase,
    syncPassphraseRef,
    syncPassphraseValue,
    updateSyncPassphraseDraft,
  } = useSyncPassphraseController({
    commitEditsOnBlur,
    dataRef,
    persistSyncPassphrase: setSyncPassphrase,
    requestDangerConfirmation,
    scheduleAutoSync: (snapshot, delayMs) => scheduleAutoSyncRef.current(snapshot, delayMs),
    setNotice, t,
    updateData,
  })
  const showUnsupportedImageSourceNotice = useUnsupportedImageSourceNotice({
    setNotice,
    t,
  })
  const audioSourceNotices = useAudioSourceNotices({ setNotice, t })
  const audioComposer = useAudioComposerController({
    generationActive,
    ...audioSourceNotices,
    onClearNotice: clearNotice,
  })
  const imageComposer = useImageComposerController({
    generationActive,
    maskRequiredMessage: t('notice.maskRequired'),
    onClearNotice: clearNotice,
    onImageSourcePreviewFailed: () => {
      reportRootLocalizedNotice({ setNotice, t }, 'notice.imagePreviewFailed', 'error', 'chat')
    },
    onUnsupportedImageSource: showUnsupportedImageSourceNotice,
  })
  const { audioSourceFile, setAudioSource } = audioComposer
  const { imageSourceFile, maskFileFromCanvas, maskTouched, setImageSource } = imageComposer

  useAppRuntimeController({
    composerMode,
    composerTextareaRef,
    data,
    dataLoaded,
    dataRef,
    draft,
    flushOfflineQueueRef,
    githubTokenRef,
    githubTokenValue,
    hasEnabledSkills,
    imageTaskMode,
    isOnline,
    isOnlineRef,
    locale,
    onCloudflareAccessKeyDerivationFailure: handleCloudflareAccessKeyDerivationFailure,
    onLocaleLoadFailure: handleLocaleLoadFailure,
    providerKeys,
    providerKeysRef,
    setCloudflareAccessKey,
    setI18nRevision,
    setIsOnline,
    setLocale,
    setSystemLanguagesKey,
    settingsOpen,
    settingsTab,
    syncMode,
    syncPassphraseValue,
    targetLocale,
  })

  const { requestSyncConfigScroll, scrollSettingsTargetIntoView, settingsModalRef, syncConfigRef } =
    useSettingsViewportController({
    composerMode,
    imageTaskMode,
    settingsOpen,
    settingsTab,
    syncMode,
  })
  const syncRuntime = useSyncRuntimeController({
    clearScheduledSync: () => clearScheduledSyncRef.current(),
    dataRef,
    formatErrorMessage: errorMessage,
    githubTokenRef,
    localizeSyncMessage: syncMessage,
    markSyncPassphraseSynced,
    passphraseRotationPendingRef,
    pendingSyncRef,
    persistLocalSnapshot,
    providerKeysRef,
    requestDangerConfirmation,
    setData,
    setNotice,
    setProviderKeys,
    setSettingsOpen,
    setSettingsTab,
    setSyncFirstConflictPrompt,
    setSyncing,
    settingsOpen,
    settingsTab,
    syncFirstConflictPrompt,
    syncingRef,
    syncPassphraseRef,
    t,
  })
  const {
    cancelSyncRuntime,
    currentSyncCredentials,
    runSync,
    warnSyncConfigLocalSaved,
  } = syncRuntime

  useAppBootstrapController({
    dataRef,
    githubTokenRef,
    hydrateSyncPassphrase,
    providerKeysRef,
    setData,
    setGithubTokenValue,
    setI18nRevision,
    setLoadError,
    setLocale,
    setProviderKeys,
    setSelectedProviderId,
  })

  const { clearScheduledSync, scheduleAutoSync } = useAutoSyncController({
    activeSyncPassphraseRevision,
    data,
    dataRef,
    getSyncCredentials: currentSyncCredentials,
    githubTokenValue,
    isOnlineRef,
    onDetachedSyncError: (error) => reportRootNotice({ setNotice }, () => t('notice.syncConfigErrorLocalSaved', { message: errorMessage(error) }), 'error', 'sync'),
    runSync,
    warnSyncConfigLocalSaved,
  })
  useSyncControllerRefs({
    clearScheduledSync,
    clearScheduledSyncRef,
    scheduleAutoSync,
    scheduleAutoSyncRef,
  })
  const settingsSkill = useSettingsSkillController({
    data,
    dataRef,
    formatErrorMessage: errorMessage,
    requestDangerConfirmation,
    scheduleAutoSync,
    scrollSettingsTargetIntoView,
    settingsModalRef,
    settingsOpen,
    settingsTab,
    setNotice,
    t,
    updateData,
  })
  const { resetRenderedSkillList } = settingsSkill
  useManagedProxyHostController({
    activeSyncPassphraseAvailable,
    activeSyncPassphraseRevision,
    data,
    dataRef,
    formatErrorMessage: errorMessage,
    setNotice,
    syncPassphraseRef,
    t,
  })

  const chatSession = useAppChatSessionController({
    conversationSearch,
    data,
    selectedProviderId,
    t,
  })
  const {
    activeConversation,
    activeConversationTitle,
    activeImageModel,
    activeModel,
    activeProvider,
    enabledChatProviders,
    selectedProvider,
  } = chatSession
  const navigation = useAppNavigationController({
    activeProvider,
    allowSettingsReturnFocus,
    closeChatModelMenu,
    closeSidebar,
    composerTextareaRef, hasActiveModal,
    rememberSettingsReturnFocusTarget,
    resetRenderedSkillList,
    setComposerMode,
    setDraft,
    setGuideOpen,
    setGuideSuccessPending,
    setNotice,
    setSelectedPresetId,
    setSelectedProviderId,
    setSettingsOpen,
    setSettingsTab,
    settingsOpen,
    settingsTab,
    sidebarDocked,
    sidebarOpen,
    sidebarOpenButtonRef,
    scheduleAutoSync,
    t,
    updateData,
  })
  const { closeGuide } = navigation
  const messageContextMenuMessage = messageForContextMenu(activeConversation, messageContextMenu)
  const rootBridgeState = deriveRootSessionBridgeState({ activeConversation, data })
  const messageVirtualization = useMessageVirtualizationController({
    activeConversation,
  })
  useAppEscapeController({
    cancelDangerPrompt,
    clearNotice,
    closeGuide,
    closeSidebar,
    dangerPromptOpen,
    firstRunDone: rootBridgeState.firstRunDone,
    guideOpen,
    setSettingsOpen,
    setSyncFirstConflictPrompt,
    settingsOpen,
    sidebarOpen,
    syncFirstConflictPromptOpen,
  })

  const syncSettings = useSyncSettingsController({
    currentSyncMode: rootBridgeState.currentSyncMode,
    githubTokenRef,
    requestSyncConfigScroll,
    reportSecretWrite,
    scheduleAutoSync,
    setGithubTokenValue,
    setNotice,
    t,
    updateData,
  })

  const { providerModelEditorOptions, providerSettings } =
    useReadyStageProviderControllers({
      activeConversationId: rootBridgeState.activeConversationId,
      checkingProviderId,
      data,
      dataRef,
      formatErrorMessage: errorMessage,
      guideVisible,
      modelLoadProviderIdRef,
      providerKeysRef,
      reportSecretWrite,
      requestDangerConfirmation,
      scheduleAutoSync,
      scheduleAutoSyncRef,
      selectedProviderId,
      selectChatModelMenuOption,
      setCheckingProviderId,
      setLoadingModelsProviderId,
      setNotice,
      setProviderConnectivityResults,
      setProviderKeys,
      setSelectedPresetId,
      setSelectedProviderId,
      syncPassphraseRef,
      t,
      updateData,
      updateProvider,
    })
  const { addProviderFromPresetId, runProviderConnectivityCheck } = providerSettings

  const firstRunGuide = useFirstRunGuideController({
    checkingProviderId,
    closeGuide,
    commitSyncPassphraseOnBlur,
    data,
    dataRef,
    formatErrorMessage: errorMessage,
    focusProviderConnectivityField,
    providerConnectivityResults,
    providerKeys,
    runProviderConnectivityCheck,
    scheduleAutoSync,
    selectedPresetId,
    selectedProvider,
    setGuideSuccessPending,
    setNotice,
    t,
    updateData,
  })

  const conversationLifecycle = useConversationLifecycleController({
    activeConversationId: rootBridgeState.activeConversationId,
    activeConversationTitle,
    addProviderFromPresetId,
    closeSidebar,
    composerTextareaRef,
    data,
    dataRef,
    dangerPromptOpen,
    guideOpen,
    requestDangerConfirmation,
    scheduleAutoSync,
    setConversationSearch,
    setNotice,
    setSelectedPresetId,
    setSelectedProviderId,
    setSettingsOpen,
    setSettingsTab,
    settingsOpen,
    syncFirstConflictPromptOpen,
    t,
    updateData,
  })
  const { createNewConversation, openFirstProviderSetup } = conversationLifecycle

  useVisualSmokeController({
    cancelEditingSkill: settingsSkill.cancelEditingSkill,
    clearNotice,
    dataRef,
    resetRenderedSkillList,
    setData,
    setNotice,
    setSettingsOpen,
    setSettingsTab,
    setSyncFirstConflictPrompt,
    showDangerPrompt,
    t,
  })

  const chatGeneration = useChatGenerationController({
    activeConversation,
    activeImageModel,
    activeModel,
    activeProvider,
    audioSourceFile,
    chatContextMessageLimit,
    composerMode,
    data,
    dataRef,
    draft,
    draftRef,
    draftRevisionRef,
    imageSourceFile,
    imageTaskMode,
    isOnlineRef,
    maskFileFromCanvas,
    maskTouched,
    commitPublishedLocalSnapshot, providerKeys, providerKeysRef,
    requestDangerConfirmation,
    scheduleAutoSync,
    setAudioSource,
    setComposerMode,
    setDraft,
    setImageSource,
    setNotice,
    setSending,
    sending,
    syncPassphraseRef,
    t,
    updateData,
    errorMessage,
  })
  const { flushOfflineQueue } = chatGeneration

  const settingsData = useSettingsDataController({
    cancelSyncRuntime,
    clearSyncPassphrase,
    dataRef,
    formatErrorMessage: errorMessage,
    githubTokenRef,
    markPersistedSnapshot,
    pauseGenerationRuntime: chatGeneration.pauseGenerationRuntime,
    persistLocalSnapshot,
    providerKeysRef,
    requestDangerConfirmation,
    scheduleAutoSync,
    setData,
    setGithubTokenValue,
    setNotice,
    setProviderKeys,
    setSelectedProviderId,
    setSettingsTab,
    syncPassphraseRef,
    t,
  })

  useOfflineQueueFlushRef({ flushOfflineQueue, flushOfflineQueueRef })

  const renderFeatureHint = useFeatureHintController({
    dangerPromptOpen,
    dismissedFeatureHints: data?.preferences.dismissedFeatureHints,
    guideVisible,
    scheduleAutoSync,
    setNotice,
    settingsOpen,
    syncFirstConflictPromptOpen,
    t,
    updateData,
  })
  const renderSecretInput = useSecretInputRenderer({
    onDefaultBlur: commitEditsOnBlur,
    t,
  })

  const rootReadiness = deriveRootReadinessState({
    activeConversation,
    activeProvider,
    data,
    loadError,
  })

  if (rootReadiness.kind !== 'ready') {
    return (
      <RootReadinessScreen
        readiness={rootReadiness}
        t={t}
        onAddFirstProvider={openFirstProviderSetup}
        onCreateConversation={createNewConversation}
        onReload={() => window.location.reload()}
      />
    )
  }

  const { activeConversation: readyActiveConversation, activeProvider: readyActiveProvider, data: readyData } = rootReadiness

  const {
    composerChrome,
    composerReadiness,
    newConversationShortcut,
    newConversationTitle,
    syncChrome,
  } = deriveAppComposerChromeState({
    activeSyncPassphraseAvailable,
    activeImageModel,
    activeModel,
    activeProvider: readyActiveProvider,
    audioSourceFile,
    composerMode,
    data: readyData,
    draft,
    enabledChatProviders,
    generationActive,
    githubTokenValue,
    imageSourceFile,
    imageTaskMode,
    maskTouched,
    providerKeys,
    syncMessage,
    syncPassphraseValue,
    t,
  })

  return (
    <AppReadyStage
        {...chatGeneration}
        {...chatSession}
        {...conversationLifecycle}
        {...firstRunGuide}
        {...audioComposer}
        {...imageComposer}
        {...interaction}
        {...messageVirtualization}
        providerModelEditorOptions={providerModelEditorOptions}
        {...navigation}
        {...providerSettings}
        {...settingsData}
        {...settingsSkill}
        {...syncRuntime}
        {...syncSettings}
        activeConversation={readyActiveConversation}
        activeProvider={readyActiveProvider}
        composerChrome={composerChrome}
        composerMode={composerMode}
        composerReadiness={composerReadiness}
        composerTextareaRef={composerTextareaRef}
        conversationSearch={conversationSearch}
        currentNotice={currentNotice}
        data={readyData}
        draft={draft}
        generationActive={generationActive}
        imageTaskMode={imageTaskMode}
        isOnline={isOnline}
        messageContextMenuMessage={messageContextMenuMessage}
        newConversationShortcut={newConversationShortcut}
        newConversationTitle={newConversationTitle}
        renderFeatureHint={renderFeatureHint}
        settingsOpen={settingsOpen}
        sending={sending}
        syncChrome={syncChrome}
        syncing={syncing}
        systemDateLocales={systemDateLocales}
        t={t}
        setComposerMode={setComposerMode}
        setConversationSearch={setConversationSearch}
        setDraft={setDraft}
        setImageTaskMode={setImageTaskMode}
        setNotice={setNotice}
        chatContextMessageLimit={chatContextMessageLimit}
        checkingProviderId={checkingProviderId}
        cloudflareAccessKey={cloudflareAccessKey}
        githubTokenValue={githubTokenValue}
        guideSuccessPending={guideSuccessPending}
        loadingModelsProviderId={loadingModelsProviderId}
        providerConnectivityResults={providerConnectivityResults}
        providerKeys={providerKeys}
        selectedPresetId={selectedPresetId}
        settingsModalRef={settingsModalRef}
        settingsTab={settingsTab}
        syncConfigRef={syncConfigRef}
        syncFirstConflictPromptOpen={syncFirstConflictPromptOpen}
        syncPassphraseValue={syncPassphraseValue}
        commitEditsOnBlur={commitEditsOnBlur}
        commitSyncPassphraseOnBlur={commitSyncPassphraseOnBlur}
        renderSecretInput={renderSecretInput}
        resetSyncPassphrase={resetSyncPassphrase}
        setSelectedProviderId={setSelectedProviderId}
        setSettingsOpen={setSettingsOpen}
        updateProvider={providerSettings.updateProviderSettings}
        updateSyncPassphraseDraft={updateSyncPassphraseDraft}
        onCancelSyncFirstConflict={() => setSyncFirstConflictPrompt(null)}
      />
  )
}
