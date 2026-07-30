import type {
  MouseEvent as ReactMouseEvent,
  ReactElement,
} from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type {
  AppData,
  ProviderConfig,
} from '../../types'
import { SettingsOverlay } from '../SettingsOverlay'

const t = ((key: string) => key) as Translator

type OverlayProps = Parameters<typeof SettingsOverlay>[0]

interface SettingsOverlayCallbacks {
  onCloseSettings: (
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => void
  onSelectModelProvider: (providerId: string) => void
  onSelectProvider: (providerId: string) => void
}

function provider(id = 'openai'): ProviderConfig {
  return {
    id,
    baseUrl: 'https://api.example.test/v1',
    capabilities: ['chat', 'image-generation'],
    createdAt: 1,
    enabled: true,
    imageModel: 'image-model',
    kind: 'openai-compatible',
    model: 'chat-model',
    models: ['chat-model', 'image-model'],
    name: id,
    needsApiKey: true,
    updatedAt: 1,
  }
}

function appData(providers: ProviderConfig[]): AppData {
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
    providers,
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

function overlayProps(overrides: Partial<OverlayProps> = {}): OverlayProps {
  const selectedProvider = provider('provider-1')
  const otherProvider = provider('provider-2')

  return {
    currentNotice: {
      anchorId: '',
      target: 'providers',
      text: '',
      tone: 'success',
    },
    data: appData([selectedProvider, otherProvider]),
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
    providerConnectivityResults: {},
    providerKeys: {},
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
    visibleProviders: [selectedProvider, otherProvider],
    chatContextMessageLimit: 12,
    checkingProviderId: '',
    cloudflareAccessKey: '',
    editingModelDraft: '',
    editingModelProviderId: '',
    editingModelSource: '',
    editingSkillId: '',
    githubTokenValue: '',
    hasMoreRenderedSkills: false,
    loadingModelsProviderId: '',
    modelDraft: '',
    modelDraftProviderId: '',
    renderedSkillLimit: 0,
    renderedSkills: [],
    settingsTab: 'providers',
    skillCount: 0,
    skillDraftContent: '',
    skillDraftName: '',
    skillEditContent: '',
    skillEditLoading: false,
    skillEditName: '',
    skillEditSaving: false,
    skillImporting: false,
    syncPassphraseValue: '',
    syncing: false,
    addProviderFromPresetSelect: vi.fn(),
    addSkillFromDraft: vi.fn(),
    beginEditProviderModel: vi.fn(),
    cancelEditingSkill: vi.fn(),
    changeChatContextMessageLimit: vi.fn(),
    changeLanguage: vi.fn(),
    changeSyncMode: vi.fn(),
    changeTheme: vi.fn(),
    checkProviderCapability: vi.fn(),
    checkProviderConnectivity: vi.fn(),
    checkProviderFullCapabilities: vi.fn(),
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
    handleModelRenameKeyDown: vi.fn(),
    handleProviderDragStart: vi.fn(),
    handleProviderDrop: vi.fn(),
    importData: vi.fn(),
    importSkillFiles: vi.fn(),
    moveProvider: vi.fn(),
    moveProviderModel: vi.fn(),
    onCompactModeChange: vi.fn(),
    onResetSyncPassphrase: vi.fn(),
    onSelectTab: vi.fn(),
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
  } as unknown as OverlayProps
}

function renderOverlay(
  overrides: Partial<OverlayProps> = {},
): ReactElement<SettingsOverlayCallbacks> {
  return SettingsOverlay(overlayProps(overrides)) as ReactElement<SettingsOverlayCallbacks>
}

describe('SettingsOverlay', () => {
  it('contains settings-overlay clear-notice reporter failures', () => {
    const setSelectedProviderId = vi.fn()
    const setNotice = vi.fn(() => {
      throw new Error('notice failed')
    }) as OverlayProps['setNotice']
    const tree = renderOverlay({
      setNotice,
      setSelectedProviderId,
    })

    expect(() => tree.props.onSelectModelProvider('provider-2')).not.toThrow()
    expect(setSelectedProviderId).toHaveBeenCalledWith('provider-2')
    expect(setNotice).toHaveBeenCalledWith('')
  })

  it('keeps settings close actions when notice clearing fails', () => {
    const blur = vi.fn()
    const setSettingsOpen = vi.fn()
    const suppressSettingsReturnFocus = vi.fn()
    const setNotice = vi.fn(() => {
      throw new Error('notice failed')
    }) as OverlayProps['setNotice']
    const tree = renderOverlay({
      setNotice,
      setSettingsOpen,
      suppressSettingsReturnFocus,
    })

    expect(() =>
      tree.props.onCloseSettings({
        currentTarget: { blur },
        detail: 1,
      } as unknown as ReactMouseEvent<HTMLButtonElement>),
    ).not.toThrow()
    expect(suppressSettingsReturnFocus).toHaveBeenCalledTimes(1)
    expect(blur).toHaveBeenCalledTimes(1)
    expect(setSettingsOpen).toHaveBeenCalledWith(false)
    expect(setNotice).toHaveBeenCalledWith('')
  })

  it('keeps model provider selection when notice clearing fails', () => {
    const setSelectedProviderId = vi.fn()
    const setNotice = vi.fn(() => {
      throw new Error('notice failed')
    }) as OverlayProps['setNotice']
    const tree = renderOverlay({
      setNotice,
      setSelectedProviderId,
    })

    expect(() => tree.props.onSelectModelProvider('provider-2')).not.toThrow()
    expect(setSelectedProviderId).toHaveBeenCalledWith('provider-2')
    expect(setNotice).toHaveBeenCalledWith('')
  })

  it('keeps provider selection and draft commit when notice clearing fails', () => {
    const commitModelDraft = vi.fn()
    const setSelectedProviderId = vi.fn()
    const setNotice = vi.fn(() => {
      throw new Error('notice failed')
    }) as OverlayProps['setNotice']
    const tree = renderOverlay({
      commitModelDraft,
      setNotice,
      setSelectedProviderId,
    })

    expect(() => tree.props.onSelectProvider('provider-2')).not.toThrow()
    expect(commitModelDraft).toHaveBeenCalledWith('provider-1')
    expect(setSelectedProviderId).toHaveBeenCalledWith('provider-2')
    expect(setNotice).toHaveBeenCalledWith('')
  })
})
