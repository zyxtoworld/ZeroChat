import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type {
  AppData,
  ProviderConfig,
} from '../../types'
import { settingsPagePropsFromOverlay } from '../SettingsOverlayPageProps'
import type { SettingsOverlayProps } from '../SettingsOverlayTypes'

const t = ((key: string) => key) as Translator

function provider(): ProviderConfig {
  return {
    id: 'openai',
    baseUrl: 'https://api.example.test/v1',
    capabilities: ['chat', 'embeddings'],
    createdAt: 1,
    enabled: true,
    embeddingModel: 'embedding-model',
    kind: 'openai-compatible',
    model: 'chat-model',
    models: ['chat-model', 'embedding-model'],
    name: 'OpenAI',
    needsApiKey: true,
    updatedAt: 1,
  }
}

function appData(selectedProvider: ProviderConfig): AppData {
  return {
    version: 1,
    conversations: [],
    preferences: {
      activeConversationId: undefined,
      compactMode: false,
      dismissedDangerWarnings: [],
      dismissedFeatureHints: [],
      firstRunDone: true,
      language: 'system',
      theme: 'system',
    },
    providers: [selectedProvider],
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    skills: [],
    sync: {
      autoSync: false,
      encryptionEnabled: true,
      mode: 'local',
    },
    updatedAt: 1,
  }
}

function overlayProps(
  overrides: Partial<SettingsOverlayProps> = {},
): SettingsOverlayProps {
  const selectedProvider = provider()

  return {
    currentNotice: {
      anchorId: '',
      target: 'providers',
      text: '',
      tone: 'success',
    },
    data: appData(selectedProvider),
    guideState: {
      selectedProviderAudioSpeechModels: [],
      selectedProviderAudioTranscriptionModels: [],
      selectedProviderChatModels: [],
      selectedProviderEmbeddingModels: [],
      selectedProviderImageModels: [],
      selectedProviderModerationModels: [],
      selectedProviderModels: [],
      selectedProviderRealtimeModels: [],
    },
    providerKeys: {},
    providerConnectivityResults: {},
    selectedProvider,
    settingsModalRef: { current: null },
    skillListMoreRef: { current: null },
    syncChrome: {
      mode: 'local',
      modeLabel: 'sync.mode.local',
      pillLabel: 'sync',
      pillText: 'sync.mode.local',
      requirement: '',
      statusText: 'sync.local',
    },
    syncConfigRef: { current: null },
    systemDateLocales: ['en-US'],
    t,
    visibleProviders: [selectedProvider],
    addProviderFromPresetSelect: vi.fn(),
    addSkillFromDraft: vi.fn(),
    beginEditProviderModel: vi.fn(),
    cancelEditingSkill: vi.fn(),
    changeChatContextMessageLimit: vi.fn(),
    changeLanguage: vi.fn(),
    changeSyncMode: vi.fn(),
    changeTheme: vi.fn(),
    checkProviderCapability: vi.fn(),
    checkProviderFullCapabilities: vi.fn(),
    checkProviderConnectivity: vi.fn(),
    checkSelectedModel: vi.fn(),
    clearCloudData: vi.fn(),
    clearModelRenameDraft: vi.fn(),
    commitEditsOnBlur: vi.fn(),
    commitModelDraft: vi.fn(),
    commitProviderModelRename: vi.fn(),
    commitSyncPassphraseOnBlur: vi.fn(),
    copyCloudflareAccessKey: vi.fn(),
    deleteSkill: vi.fn(),
    exportData: vi.fn(),
    handleModelDraftChange: vi.fn(),
    handleModelDraftKeyDown: vi.fn(),
    handleModelDragStart: vi.fn(),
    handleModelDrop: vi.fn(),
    handleProviderDragStart: vi.fn(),
    handleProviderDrop: vi.fn(),
    importData: vi.fn(),
    importSkillFiles: vi.fn(),
    moveProvider: vi.fn(),
    moveProviderModel: vi.fn(),
    handleModelRenameKeyDown: vi.fn(),
    openFirstProviderSetup: vi.fn(),
    openGuide: vi.fn(),
    refreshProviderModels: vi.fn(),
    removeProvider: vi.fn(),
    removeProviderModel: vi.fn(),
    renderFeatureHint: vi.fn(() => null),
    renderSecretInput: vi.fn(() => null),
    resetLocalData: vi.fn(),
    runSync: vi.fn(),
    saveEditingSkill: vi.fn(),
    selectProviderAudioSpeechModel: vi.fn(),
    selectProviderAudioTranscriptionModel: vi.fn(),
    selectProviderEmbeddingModel: vi.fn(),
    selectProviderImageModel: vi.fn(),
    selectProviderModerationModel: vi.fn(),
    selectProviderModel: vi.fn(),
    selectProviderRealtimeModel: vi.fn(),
    onCompactModeChange: vi.fn(),
    onResetSyncPassphrase: vi.fn(),
    onSelectTab: vi.fn(),
    setEditingModelDraft: vi.fn(),
    setNotice: vi.fn(),
    setProviderEnabled: vi.fn(),
    setSelectedProviderId: vi.fn(),
    setSettingsOpen: vi.fn(),
    setSkillDraftContent: vi.fn(),
    setSkillDraftName: vi.fn(),
    setSkillEditContent: vi.fn(),
    setSkillEditName: vi.fn(),
    showMoreSkills: vi.fn(),
    startEditingSkill: vi.fn(),
    suppressSettingsReturnFocus: vi.fn(),
    updateGithubTokenSecret: vi.fn(),
    updateProvider: vi.fn(),
    updateProviderKey: vi.fn(),
    updateSkill: vi.fn(),
    updateSkillSettings: vi.fn(),
    updateSyncAutoSync: vi.fn(),
    updateSyncGistFile: vi.fn(),
    updateSyncGistId: vi.fn(),
    updateSyncPassphraseDraft: vi.fn(),
    updateSyncWorkerEndpoint: vi.fn(),
    ...overrides,
  } as unknown as SettingsOverlayProps
}

describe('settingsPagePropsFromOverlay', () => {
  it('keeps provider setting actions routed through controller-owned promises', () => {
    const setNotice = vi.fn()
    const checkProviderConnectivity = vi.fn(async () => undefined)
    const checkProviderFullCapabilities = vi.fn(async () => undefined)
    const checkProviderCapability = vi.fn(async () => undefined)
    const removeProvider = vi.fn(async () => undefined)
    const pageProps = settingsPagePropsFromOverlay(
      overlayProps({
        checkProviderCapability,
        checkProviderConnectivity,
        checkProviderFullCapabilities,
        removeProvider,
        setNotice,
      }),
      {
        onCloseSettings: vi.fn(),
        onSelectModelProvider: vi.fn(),
        onSelectProvider: vi.fn(),
      },
    )

    pageProps.onCheckProviderConnectivity('openai')
    expect(checkProviderConnectivity).toHaveBeenCalledWith('openai')

    pageProps.onCheckProviderFullCapabilities('openai')
    expect(checkProviderFullCapabilities).toHaveBeenCalledWith('openai')

    pageProps.onCheckProviderCapability('openai', 'embeddings')
    expect(checkProviderCapability).toHaveBeenCalledWith('openai', 'embeddings')

    pageProps.onRemoveProvider('openai')
    expect(removeProvider).toHaveBeenCalledWith('openai')
    expect(setNotice).not.toHaveBeenCalled()
  })

  it('contains synchronous data and sync action failures at the page-props boundary', async () => {
    const event = {} as Parameters<SettingsOverlayProps['importData']>[0]
    const throwingAction = vi.fn(() => {
      throw new Error('sync action failed')
    })
    const copyCloudflareAccessKey = vi.fn(() => {
      throw new Error('copy failed')
    })
    const importData = vi.fn(() => {
      throw new Error('import failed')
    })
    const pageProps = settingsPagePropsFromOverlay(
      overlayProps({
        clearCloudData: throwingAction,
        cloudflareAccessKey: 'access-key',
        commitSyncPassphraseOnBlur: throwingAction,
        copyCloudflareAccessKey,
        exportData: throwingAction,
        importData,
        resetLocalData: throwingAction,
        runSync: throwingAction,
      }),
      {
        onCloseSettings: vi.fn(),
        onSelectModelProvider: vi.fn(),
        onSelectProvider: vi.fn(),
      },
    )

    await expect(pageProps.onClearCloudData()).resolves.toBeUndefined()
    await expect(pageProps.onCopyCloudflareAccessKey()).resolves.toBeUndefined()
    await expect(pageProps.onExportData()).resolves.toBeUndefined()
    await expect(pageProps.onImportData(event)).resolves.toBeUndefined()
    await expect(pageProps.onResetLocalData()).resolves.toBeUndefined()
    await expect(pageProps.onRunSync()).resolves.toBeUndefined()
    await expect(pageProps.onSyncPassphraseBlur()).resolves.toBeUndefined()

    expect(copyCloudflareAccessKey).toHaveBeenCalledWith('access-key')
    expect(importData).toHaveBeenCalledWith(event)
  })

  it('contains rejected data and sync action promises at the page-props boundary', async () => {
    const event = {} as Parameters<SettingsOverlayProps['importData']>[0]
    const rejectedAction = vi.fn(async () => {
      throw new Error('async action failed')
    })
    const copyCloudflareAccessKey = vi.fn(async () => {
      throw new Error('copy failed')
    })
    const importData = vi.fn(async () => {
      throw new Error('import failed')
    })
    const pageProps = settingsPagePropsFromOverlay(
      overlayProps({
        clearCloudData: rejectedAction,
        cloudflareAccessKey: 'access-key',
        commitSyncPassphraseOnBlur: rejectedAction,
        copyCloudflareAccessKey,
        exportData: rejectedAction,
        importData,
        resetLocalData: rejectedAction,
        runSync: rejectedAction,
      }),
      {
        onCloseSettings: vi.fn(),
        onSelectModelProvider: vi.fn(),
        onSelectProvider: vi.fn(),
      },
    )

    await expect(pageProps.onClearCloudData()).resolves.toBeUndefined()
    await expect(pageProps.onCopyCloudflareAccessKey()).resolves.toBeUndefined()
    await expect(pageProps.onExportData()).resolves.toBeUndefined()
    await expect(pageProps.onImportData(event)).resolves.toBeUndefined()
    await expect(pageProps.onResetLocalData()).resolves.toBeUndefined()
    await expect(pageProps.onRunSync()).resolves.toBeUndefined()
    await expect(pageProps.onSyncPassphraseBlur()).resolves.toBeUndefined()

    expect(copyCloudflareAccessKey).toHaveBeenCalledWith('access-key')
    expect(importData).toHaveBeenCalledWith(event)
  })
})
