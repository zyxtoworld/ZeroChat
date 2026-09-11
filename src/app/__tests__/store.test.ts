import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h } from 'preact'
import { renderToStaticMarkup } from 'preact-render-to-string'

vi.mock('zustand', async () => {
  const { createStore } = await vi.importActual<typeof import('zustand/vanilla')>(
    'zustand/vanilla',
  )

  const bind = (initializer: (...args: never[]) => unknown) => {
    const api = createStore(initializer as never)
    return Object.assign(
      (selector?: (state: unknown) => unknown) =>
        selector ? selector(api.getState()) : api.getState(),
      api,
    )
  }
  const create = (initializer?: (...args: never[]) => unknown) =>
    initializer ? bind(initializer) : bind

  return { create }
})

vi.mock('lucide-react', () => {
  const names = [
    'ArrowLeft',
    'Check',
    'ChevronDown',
    'ChevronUp',
    'Copy',
    'Eye',
    'EyeOff',
    'GripVertical',
    'Lightbulb',
    'Menu',
    'PanelLeft',
    'PanelRight',
    'Pencil',
    'Plus',
    'RefreshCw',
    'Send',
    'SendHorizonal',
    'Settings',
    'Square',
    'Trash2',
    'X',
  ]
  return Object.fromEntries(names.map((name) => [name, () => null]))
})

import type {
  AppData,
  ChatMessage,
  Conversation,
  SyncResult,
  UserSkill,
} from '../../types'
import { AppDataWriteConflictError } from '../../storage/appDataWriteConflict'
import { defaultModelForProvider } from '../../services/providerModels'
import { isSyncVaultShape } from '../../services/syncShared'
import { deleteProviderFromAppData } from '../providerMutation'
import { createSettingsActionOwner } from '../settingsDataAction'
import { installAppGlobalListeners } from '../appKeyboard'

const dbMocks = vi.hoisted(() => ({
  deleteSkillContentRefs: vi.fn(async (refs: string[]) => {
    void refs
    return undefined
  }),
  deleteSkillContents: vi.fn(async () => undefined),
  getSkillContent: vi.fn(async () => ''),
  loadAppData: vi.fn(async (): Promise<AppData | null> => null),
  loadSkillContents: vi.fn(async () => ''),
  materializeAppDataSkillContents: vi.fn(async (data: unknown) => data),
  persistAppDataSkillContents: vi.fn(async (data: unknown) => data),
  persistExternalAppDataSkillContents: vi.fn(async (data: unknown) => data),
  persistSkillContents: vi.fn(async (skill: unknown) => skill),
  persistSkillsContents: vi.fn(async (skills: unknown) => skills),
  replaceLocalDataDocuments: vi.fn(async () => undefined),
  saveAppData: vi.fn(async (data: unknown): Promise<void> => {
    void data
  }),
}))

const secretMocks = vi.hoisted(() => ({
  clearPendingProviderSecretCleanupById: vi.fn(),
  clearProviderSecretsById: vi.fn(async () => undefined),
  clearZeroChatSecrets: vi.fn(async () => undefined),
  commitProviderSecretSnapshotWithAppData: vi.fn(),
  commitZeroChatSecretSnapshotWithAppData: vi.fn(),
  getSyncPassphrase: vi.fn(async () => ''),
  getPendingProviderSecretCleanupIds: vi.fn((): string[] => []),
  loadZeroChatSecrets: vi.fn(async () => ({
    githubToken: '',
    providerKeys: {},
  })),
  setGithubToken: vi.fn(async () => undefined),
  setProviderKey: vi.fn(async () => undefined),
  setSyncPassphrase: vi.fn(async () => undefined),
  queueProviderSecretCleanupById: vi.fn(),
}))

const providerConfigMocks = vi.hoisted(() => ({
  actualNormalizeOfficialProviderContracts: undefined as
    | typeof import('../../services/providerConfig').normalizeOfficialProviderContracts
    | undefined,
  normalizeOfficialProviderContracts: vi.fn(),
}))

const providerSafetyMocks = vi.hoisted(() => ({
  actualPruneProviderSecrets: undefined as
    | typeof import('../../services/providerSafety').pruneProviderSecrets
    | undefined,
  actualSanitizeRemoteOnlyAppData: undefined as
    | typeof import('../../services/providerSafety').sanitizeRemoteOnlyAppData
    | undefined,
  pruneProviderSecrets: vi.fn(),
  sanitizeRemoteOnlyAppData: vi.fn(),
}))

const cryptoMocks = vi.hoisted(() => ({
  decryptVault: vi.fn(),
  encryptVault: vi.fn(),
  isEncryptedSnapshot: vi.fn(),
}))

const imageMocks = vi.hoisted(() => ({
  fileToDataUrl: vi.fn(async () => 'data:image/png;base64,AAAA'),
}))

const accessKeyMocks = vi.hoisted(() => ({
  accessKeyFromPassword: vi.fn(async () => 'proxy-token'),
}))

const clipboardMocks = vi.hoisted(() => ({
  writeClipboardText: vi.fn(async () => undefined),
}))

const downloadMocks = vi.hoisted(() => ({
  downloadJsonFile: vi.fn(() => true),
}))

const lazyMocks = vi.hoisted(() => ({
  loadSkillService: vi.fn(),
}))

const i18nMocks = vi.hoisted(() => ({
  actualLoadLocale: undefined as
    | typeof import('../../i18n').loadLocale
    | undefined,
  loadLocale: vi.fn(),
}))

const streamMocks = vi.hoisted(() => ({
  streamAssistantText: vi.fn(),
}))

const syncMocks = vi.hoisted(() => ({
  clearRemoteSyncData: vi.fn(),
  performSync: vi.fn(),
}))

const providerConnectivityMocks = vi.hoisted(() => ({
  actualCreateProviderConnectivityCheckActions: undefined as
    | typeof import('../../services/providerConnectivityChecks').createProviderConnectivityCheckActions
    | undefined,
  createProviderConnectivityCheckActions: vi.fn(),
}))

const providerModelMocks = vi.hoisted(() => ({
  actualModelForProviderCapability: undefined as
    | typeof import('../../services/providerModels').modelForProviderCapability
    | undefined,
  modelForProviderCapability: vi.fn(),
}))

vi.mock('../../storage/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage/db')>()
  return { ...actual, ...dbMocks }
})

vi.mock('../../storage/secrets', () => secretMocks)
vi.mock('../../services/crypto', () => cryptoMocks)

vi.mock('../../services/providerConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/providerConfig')>()
  providerConfigMocks.actualNormalizeOfficialProviderContracts =
    actual.normalizeOfficialProviderContracts
  providerConfigMocks.normalizeOfficialProviderContracts.mockImplementation(
    actual.normalizeOfficialProviderContracts,
  )
  return { ...actual, ...providerConfigMocks }
})

vi.mock('../../services/providerSafety', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/providerSafety')>()
  providerSafetyMocks.actualPruneProviderSecrets = actual.pruneProviderSecrets
  providerSafetyMocks.actualSanitizeRemoteOnlyAppData =
    actual.sanitizeRemoteOnlyAppData
  providerSafetyMocks.pruneProviderSecrets.mockImplementation(
    actual.pruneProviderSecrets,
  )
  providerSafetyMocks.sanitizeRemoteOnlyAppData.mockImplementation(
    actual.sanitizeRemoteOnlyAppData,
  )
  return { ...actual, ...providerSafetyMocks }
})

vi.mock('../../services/imageAttachments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/imageAttachments')>()
  return { ...actual, ...imageMocks }
})
vi.mock('../../services/accessKey', () => accessKeyMocks)
vi.mock('../../services/clipboard', () => clipboardMocks)
vi.mock('../../services/downloadJsonFile', () => downloadMocks)

vi.mock('../../services/lazy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/lazy')>()
  return { ...actual, ...lazyMocks }
})
vi.mock('../../services/chatGenerationTextStream', () => streamMocks)
vi.mock('../../services/sync', () => syncMocks)
vi.mock('../../i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../i18n')>()
  i18nMocks.actualLoadLocale = actual.loadLocale
  i18nMocks.loadLocale.mockImplementation(actual.loadLocale)
  return { ...actual, loadLocale: i18nMocks.loadLocale }
})
vi.mock('../../services/providerConnectivityChecks', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../services/providerConnectivityChecks')>()
  providerConnectivityMocks.actualCreateProviderConnectivityCheckActions =
    actual.createProviderConnectivityCheckActions
  return {
    ...actual,
    createProviderConnectivityCheckActions:
      providerConnectivityMocks.createProviderConnectivityCheckActions,
  }
})

vi.mock('../../services/providerModels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/providerModels')>()
  providerModelMocks.actualModelForProviderCapability =
    actual.modelForProviderCapability
  providerModelMocks.modelForProviderCapability.mockImplementation(
    actual.modelForProviderCapability,
  )
  return {
    ...actual,
    modelForProviderCapability: providerModelMocks.modelForProviderCapability,
  }
})

import { createDefaultData } from '../../storage/db'
import { rt, setRuntimeLocale, translate } from '../../i18n'
import { fallbackCapabilitiesForProvider } from '../../services/providerConfig'
import { CONVERSATION_PLACEHOLDER_TITLE } from '../../services/conversations'
import {
  activeConversationOf,
  conversationFromUserText,
  imageAttachmentSrc,
  MAX_IMAGE_BYTES,
  newId,
  providerOfConversation,
  shouldRenderMarkdown,
  useAppStore,
  appT,
  type ChatRuntime,
} from '../store'
import { localizedConversationTitle } from '../i18n'
import { SettingsView } from '../components/SettingsView'
import { commitProviderKeyDraft } from '../settingsDraftPersistence'

const defaultNotify = useAppStore.getState().notify

type ProviderConnectivityCheckContext = Parameters<
  typeof import('../../services/providerConnectivityChecks').createProviderConnectivityCheckActions
>[0]

const runtime = {
  editImage: vi.fn(),
  generateImage: vi.fn(),
  listProviderModels: vi.fn(),
  streamChat: vi.fn(),
  synthesizeSpeechAudio: vi.fn(),
  transcribeAudioFile: vi.fn(),
} as unknown as ChatRuntime & {
  editImage: ReturnType<typeof vi.fn>
  generateImage: ReturnType<typeof vi.fn>
  listProviderModels: ReturnType<typeof vi.fn>
  streamChat: ReturnType<typeof vi.fn>
  synthesizeSpeechAudio: ReturnType<typeof vi.fn>
  transcribeAudioFile: ReturnType<typeof vi.fn>
}

function freshData(): AppData {
  const data = structuredClone(createDefaultData())
  data.preferences.firstRunDone = true
  return data
}

function resetStore(data = freshData()): AppData {
  const providerId = data.providers[0]?.id ?? ''
  useAppStore.setState({
    abortController: null,
    composerImages: [],
    composerMode: 'chat',
    data,
    checkingProviderId: '',
    fetchingModelsFor: '',
    githubToken: '',
    keys: providerId ? { [providerId]: 'test-key' } : {},
    loadError: '',
    notify: defaultNotify,
    runtimeLoader: async () => runtime,
    providerConnectivityResults: {},
    sending: false,
    settingsOpen: false,
    settingsDataActionPending: false,
    skillMutationPending: false,
    settingsEntryTarget: null,
    sidebarCollapsed: false,
    speakingMessageId: '',
    status: 'ready',
    streaming: false,
    syncConflict: false,
    syncPassphrase: '',
    syncing: false,
    transcribingAudio: false,
    toasts: [],
  })
  return data
}

function beginMockedHydration(label: string): Promise<void> {
  if (useAppStore.getState().status !== 'loading') {
    throw new Error(`${label}: set status to loading before init()`)
  }
  return useAppStore.getState().init()
}

function expectConsoleErrorDoesNotExpose(
  consoleError: ReturnType<typeof vi.spyOn>,
  error: unknown,
): void {
  const sentinel = error instanceof Error ? error.message : String(error)
  expect(
    consoleError.mock.calls.some((call: unknown[]) =>
      call.some((argument: unknown) => {
        if (argument === error) return true
        if (argument instanceof Error) {
          return argument.message.includes(sentinel) || String(argument).includes(sentinel)
        }
        return typeof argument === 'string' && argument.includes(sentinel)
      }),
    ),
  ).toBe(false)
}

function blockSkillRefCleanupUntilReleased(): {
  release: () => void
  attempts: () => number
} {
  let released = false
  dbMocks.deleteSkillContentRefs.mockImplementation(async () => {
    if (!released) throw new Error('Skill cleanup unavailable')
  })
  return {
    release: () => {
      released = true
    },
    attempts: () => dbMocks.deleteSkillContentRefs.mock.calls.length,
  }
}

function message(
  id: string,
  role: ChatMessage['role'],
  content: string,
  patch: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    content,
    createdAt: 1,
    id,
    role,
    status: 'done',
    ...patch,
  }
}

function withMessages(data: AppData, messages: ChatMessage[]): Conversation {
  const conversation = data.conversations[0]
  const next = { ...conversation, messages }
  useAppStore.setState({
    data: {
      ...data,
      conversations: [next, ...data.conversations.slice(1)],
    },
  })
  return next
}

function skill(id: string, patch: Partial<UserSkill> = {}): UserSkill {
  return {
    autoMatch: true,
    chunks: [],
    contentHash: `${id}-hash`,
    contentType: 'markdown',
    createdAt: 1,
    description: `${id} description`,
    enabled: true,
    fileName: `${id}.md`,
    fixed: false,
    id,
    keywords: [],
    name: id,
    sourceSize: 10,
    updatedAt: 1,
    ...patch,
  }
}

function syncResult(data: AppData): SyncResult {
  const providerId = data.providers[0]?.id
  return {
    data,
    message: 'sync complete',
    remoteAccepted: true,
    secrets: {
      providerKeys: providerId ? { [providerId]: 'synced-key' } : {},
    },
  }
}

function imageFile(name = 'source.png', type = 'image/png'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type })
}

function stubGenerationRetryTimers(): void {
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  dbMocks.deleteSkillContentRefs.mockReset()
  dbMocks.deleteSkillContentRefs.mockResolvedValue(undefined)
  secretMocks.commitProviderSecretSnapshotWithAppData.mockReset()
  secretMocks.commitZeroChatSecretSnapshotWithAppData.mockReset()
  cryptoMocks.decryptVault.mockReset()
  cryptoMocks.encryptVault.mockReset()
  cryptoMocks.isEncryptedSnapshot.mockReset()
  providerConfigMocks.normalizeOfficialProviderContracts.mockReset()
  providerConfigMocks.normalizeOfficialProviderContracts.mockImplementation(
    providerConfigMocks.actualNormalizeOfficialProviderContracts!,
  )
  providerSafetyMocks.pruneProviderSecrets.mockReset()
  providerSafetyMocks.pruneProviderSecrets.mockImplementation(
    providerSafetyMocks.actualPruneProviderSecrets!,
  )
  providerSafetyMocks.sanitizeRemoteOnlyAppData.mockReset()
  providerSafetyMocks.sanitizeRemoteOnlyAppData.mockImplementation(
    providerSafetyMocks.actualSanitizeRemoteOnlyAppData!,
  )
  providerConnectivityMocks.createProviderConnectivityCheckActions.mockReset()
  providerModelMocks.modelForProviderCapability.mockReset()
  providerModelMocks.modelForProviderCapability.mockImplementation(
    providerModelMocks.actualModelForProviderCapability!,
  )
  i18nMocks.loadLocale.mockReset()
  i18nMocks.loadLocale.mockImplementation(i18nMocks.actualLoadLocale!)
  vi.stubGlobal('navigator', { language: 'en-US', onLine: true })
  vi.stubGlobal('confirm', vi.fn(() => true))

  dbMocks.loadAppData.mockResolvedValue(null)
  dbMocks.loadSkillContents.mockResolvedValue('skill body')
  dbMocks.materializeAppDataSkillContents.mockImplementation(
    async (data: unknown) => data,
  )
  dbMocks.persistAppDataSkillContents.mockImplementation(
    async (data: unknown) => data,
  )
  dbMocks.persistExternalAppDataSkillContents.mockImplementation(
    async (data: unknown) => data,
  )
  dbMocks.persistSkillContents.mockImplementation(async (value: unknown) => value)
  dbMocks.persistSkillsContents.mockImplementation(async (value: unknown) => value)
  dbMocks.saveAppData.mockResolvedValue(undefined)
  dbMocks.replaceLocalDataDocuments.mockResolvedValue(undefined)

  secretMocks.commitZeroChatSecretSnapshotWithAppData.mockImplementation(
    async (
      _previous: unknown,
      _next: unknown,
      target: AppData,
      persist: (snapshot: AppData) => Promise<AppData>,
    ) => persist(target),
  )
  secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementation(
    async (
      _previous: unknown,
      _next: unknown,
      target: AppData,
      persist: (snapshot: AppData) => Promise<AppData>,
    ) => persist(target),
  )
  cryptoMocks.isEncryptedSnapshot.mockReturnValue(false)

  secretMocks.getSyncPassphrase.mockResolvedValue('')
  secretMocks.getPendingProviderSecretCleanupIds.mockReturnValue([])
  secretMocks.clearPendingProviderSecretCleanupById.mockImplementation(
    () => undefined,
  )
  secretMocks.clearProviderSecretsById.mockResolvedValue(undefined)
  secretMocks.queueProviderSecretCleanupById.mockImplementation(() => undefined)
  secretMocks.loadZeroChatSecrets.mockResolvedValue({
    githubToken: '',
    providerKeys: {},
  })

  imageMocks.fileToDataUrl.mockResolvedValue('data:image/png;base64,AAAA')
  accessKeyMocks.accessKeyFromPassword.mockReset()
  accessKeyMocks.accessKeyFromPassword.mockResolvedValue('proxy-token')
  clipboardMocks.writeClipboardText.mockReset()
  clipboardMocks.writeClipboardText.mockResolvedValue(undefined)
  downloadMocks.downloadJsonFile.mockReset()
  downloadMocks.downloadJsonFile.mockReturnValue(true)

  runtime.editImage.mockResolvedValue({
    dataUrl: 'data:image/png;base64,AAAA',
    mimeType: 'image/png',
    revisedPrompt: 'edited',
  })
  runtime.generateImage.mockResolvedValue({
    dataUrl: 'data:image/png;base64,AAAA',
    mimeType: 'image/png',
    revisedPrompt: 'generated',
  })
  runtime.listProviderModels.mockResolvedValue(['model-a', 'model-b'])
  runtime.streamChat.mockImplementation(
    async ({ onToken }: { onToken: (token: string) => void }) => {
      onToken('reply')
    },
  )
  streamMocks.streamAssistantText.mockReset()
  streamMocks.streamAssistantText.mockImplementation(
    async ({ onToken }: { onToken: (token: string) => void }) => {
      onToken('replayed')
    },
  )
  syncMocks.performSync.mockImplementation(async (data: AppData) => syncResult(data))
  syncMocks.clearRemoteSyncData.mockImplementation(async (data: AppData) =>
    syncResult(data),
  )

  resetStore()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('app store helpers', () => {
  it('normalizes conversation titles and resolves active providers', () => {
    expect(conversationFromUserText('  one   two  ')).toBe('one two')
    expect(conversationFromUserText('123456789012345678901234567890')).toBe(
      '1234567890123456789012345678…',
    )
    const family = '👩‍💻'
    expect(conversationFromUserText(`${'a'.repeat(23)}${family}`)).toBe(
      `${'a'.repeat(23)}${family}`,
    )
    expect(conversationFromUserText('alpha\u0000beta\u007Fgamma')).toBe(
      'alpha beta gamma',
    )

    const data = freshData()
    const conversation = data.conversations[0]
    expect(activeConversationOf(null)).toBeNull()
    expect(activeConversationOf(data)).toBe(conversation)
    data.preferences.activeConversationId = 'missing'
    expect(activeConversationOf(data)).toBe(conversation)
    expect(
      activeConversationOf({
        ...data,
        conversations: [],
        preferences: { ...data.preferences, activeConversationId: 'missing' },
      }),
    ).toBeNull()
    expect(providerOfConversation(null, conversation)).toBeNull()
    expect(providerOfConversation(data, null)).toBeNull()
    expect(providerOfConversation(data, conversation)).toBe(data.providers[0])
    expect(
      providerOfConversation(data, { ...conversation, providerId: 'missing' }),
    ).toBe(data.providers[0])
    expect(providerOfConversation({ ...data, providers: [] }, conversation)).toBeNull()
    
    data.providers[0].enabled = false
    expect(providerOfConversation(data, conversation)).toBe(data.providers[0])
    expect(appT({ ...data, preferences: { ...data.preferences, language: 'zh-CN' } }, 'app.newChat')).toBe(
      '新会话',
    )
    expect(appT(null, 'missing.key' as never)).toBe('missing.key')
    expect(newId()).not.toBe(newId())
    expect(shouldRenderMarkdown('plain text')).toBe(false)
    expect(shouldRenderMarkdown('# heading')).toBe(true)
    expect(
      imageAttachmentSrc({
        createdAt: 1,
        id: 'x',
        kind: 'image',
        mimeType: 'image/png',
      }),
    ).toBe('')
    expect(
      imageAttachmentSrc({
        dataUrl: 'data:image/png;base64,AAAA',
        createdAt: 1,
        id: 'image',
        kind: 'image',
        mimeType: 'image/png',
      }),
    ).toBe('data:image/png;base64,AAAA')
  })

  it('keeps an explicitly renamed placeholder literal out of localization', async () => {
    const data = resetStore()
    await useAppStore.getState().flushLocalSaves()
    await i18nMocks.loadLocale('zh-CN')

    await expect(
      useAppStore
        .getState()
        .renameConversation(data.conversations[0].id, 'New chat'),
    ).resolves.toBe(true)

    const renamedData = useAppStore.getState().data as AppData
    const renamed = renamedData.conversations[0]
    expect(renamed.title).toBe('New chat')
    expect(
      localizedConversationTitle(
        {
          ...renamedData,
          preferences: { ...renamedData.preferences, language: 'zh-CN' },
        },
        renamed.title,
      ),
    ).toBe('New chat')
  })

  it('stores the canonical placeholder when a conversation is renamed to blank', async () => {
    const data = resetStore()
    data.preferences.language = 'zh-CN'
    await useAppStore.getState().flushLocalSaves()
    await i18nMocks.loadLocale('zh-CN')

    await expect(
      useAppStore
        .getState()
        .renameConversation(data.conversations[0].id, ' \t\n '),
    ).resolves.toBe(true)

    const renamedData = useAppStore.getState().data as AppData
    expect(renamedData.conversations[0].title).toBe(
      CONVERSATION_PLACEHOLDER_TITLE,
    )

    const zhData = {
      ...renamedData,
      preferences: { ...renamedData.preferences, language: 'zh-CN' as const },
    }
    const enData = {
      ...renamedData,
      preferences: { ...renamedData.preferences, language: 'en-US' as const },
    }
    expect(
      localizedConversationTitle(zhData, CONVERSATION_PLACEHOLDER_TITLE),
    ).toBe(translate('zh-CN', CONVERSATION_PLACEHOLDER_TITLE))
    expect(
      localizedConversationTitle(enData, CONVERSATION_PLACEHOLDER_TITLE),
    ).toBe(translate('en-US', CONVERSATION_PLACEHOLDER_TITLE))
  })

  it('creates unique Store conversations when WebCrypto collides or fails', async () => {
    const data = resetStore()
    const restoredId = data.conversations[0].id
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => restoredId) })

    await expect(useAppStore.getState().createNewConversation()).resolves.toBe(true)
    const collision = useAppStore.getState().data?.conversations[0]
    expect(collision?.id).not.toBe(restoredId)

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => {
        throw new Error('randomUUID unavailable')
      }),
    })
    await expect(useAppStore.getState().createNewConversation()).resolves.toBe(true)
    const fallback = useAppStore.getState().data?.conversations[0]

    expect(fallback?.id).not.toBe(collision?.id)
    expect(fallback?.id).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(fallback?.title).toBe('conversation.newTitle')
  })

  it('uses the runtime-id owner when send creates the first conversation', async () => {
    const data = freshData()
    const restoredId = data.conversations[0].id
    data.conversations = []
    data.preferences.activeConversationId = undefined
    resetStore(data)
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => restoredId) })

    await expect(useAppStore.getState().sendMessage('first turn')).resolves.toBe(true)

    const created = useAppStore.getState().data?.conversations[0]
    expect(created?.id).not.toBe(restoredId)
    expect(created?.title).toBe('first turn')
  })

  it('updates conversations, providers, preferences, and settings state', async () => {
    const data = resetStore()
    const firstId = data.conversations[0].id
    const firstProviderId = data.providers[0].id

    useAppStore.getState().setSettingsOpen(true)
    useAppStore.getState().setSidebarCollapsed(true)
    useAppStore.getState().setComposerMode('image')
    useAppStore.getState().setImageTaskMode('inpaint')
    expect(useAppStore.getState()).toMatchObject({
      composerMode: 'image',
      imageTaskMode: 'inpaint',
      settingsOpen: true,
      sidebarCollapsed: true,
    })

    await useAppStore.getState().skipOnboarding()
    await useAppStore.getState().createNewConversation()
    const created = useAppStore.getState().data?.conversations[0]
    expect(created?.id).not.toBe(firstId)
    expect(useAppStore.getState().data?.preferences.activeConversationId).toBe(
      created?.id,
    )

    await useAppStore.getState().renameConversation(created?.id ?? '', '  Renamed  ')
    await useAppStore.getState().renameConversation(created?.id ?? '', '   ')
    await useAppStore
      .getState()
      .setConversationModelChoice(created?.id ?? '', firstProviderId, '')
    expect(useAppStore.getState().data?.conversations[0]).toMatchObject({
      model: data.providers[0].model,
      title: CONVERSATION_PLACEHOLDER_TITLE,
    })

    await useAppStore.getState().addProvider('gemini')
    const addedProvider = useAppStore.getState().data?.providers.at(-1)
    expect(addedProvider).toBeDefined()
    useAppStore.getState().updateProvider(addedProvider?.id ?? '', {
      model: 'updated-model',
      name: 'Updated provider',
    })
    await useAppStore.getState().deleteProvider(addedProvider?.id ?? '')
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalled()
    expect(secretMocks.setProviderKey).not.toHaveBeenCalled()

    await useAppStore.getState().setActiveConversation(firstId)
    await useAppStore.getState().deleteConversation(created?.id ?? '')
    expect(useAppStore.getState().data?.preferences.activeConversationId).toBe(firstId)

    const documentStub = { documentElement: { dir: '', lang: '' } }
    vi.stubGlobal('document', documentStub)
    useAppStore.getState().setTheme('dark')
    await useAppStore.getState().setLanguage('ar-SA')
    useAppStore.getState().toggleCompact()
    useAppStore.getState().setChatContextMessageLimit(999)
    expect(documentStub.documentElement).toEqual({ dir: 'rtl', lang: 'ar-SA' })
    expect(useAppStore.getState().data?.preferences).toMatchObject({
      compactMode: true,
      chatContextMessageLimit: 200,
      language: 'ar-SA',
      theme: 'dark',
    })

    await useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncAutoSync(true)
    useAppStore.getState().setSyncGistId('gist-id')
    useAppStore.getState().setSyncGistFile('backup.json')
    useAppStore.getState().setSyncWorkerEndpoint('https://worker.invalid')
    expect(useAppStore.getState().data?.sync).toMatchObject({
      autoSync: true,
      gistFile: 'backup.json',
      gistId: 'gist-id',
      mode: 'gist',
      workerEndpoint: 'https://worker.invalid',
    })
  })

  it('keeps a newly added Provider id under the runtime-id owner', async () => {
    resetStore()
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => 'provider-runtime-id'),
    })

    await expect(useAppStore.getState().addProvider('gemini')).resolves.toBe(true)

    expect(useAppStore.getState().data?.providers.at(-1)?.id).toBe(
      'provider-runtime-id',
    )
  })

  it('keeps Settings open while a Data action owns the shared pending gate', async () => {
    resetStore()
    useAppStore.getState().setSettingsOpen(true)
    const owner = createSettingsActionOwner()
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const action = owner.run(
      () => held,
      useAppStore.getState().setSettingsDataActionPending,
    )

    useAppStore.getState().setSettingsOpen(false)

    expect(useAppStore.getState().settingsOpen).toBe(true)
    expect(useAppStore.getState().settingsDataActionPending).toBe(true)

    release()
    await expect(action).resolves.toBe(true)
    expect(useAppStore.getState().settingsDataActionPending).toBe(false)
    useAppStore.getState().setSettingsOpen(false)
    expect(useAppStore.getState().settingsOpen).toBe(false)
  })

  it('releases the shared Settings close gate after a Data action failure', async () => {
    resetStore()
    useAppStore.getState().setSettingsOpen(true)
    const owner = createSettingsActionOwner()

    await expect(
      owner.run(
        async () => {
          throw new Error('expected data action failure')
        },
        useAppStore.getState().setSettingsDataActionPending,
      ),
    ).rejects.toThrow('expected data action failure')

    expect(useAppStore.getState().settingsDataActionPending).toBe(false)
    useAppStore.getState().setSettingsOpen(false)
    expect(useAppStore.getState().settingsOpen).toBe(false)
  })

  it('owns lazy Settings provider-entry focus until the overlay consumes it', () => {
    resetStore()

    useAppStore.getState().openProviderSettings()
    expect(useAppStore.getState()).toMatchObject({
      settingsEntryTarget: 'provider-key',
      settingsOpen: true,
    })

    useAppStore.getState().consumeSettingsEntryTarget('provider-key')
    expect(useAppStore.getState().settingsEntryTarget).toBeNull()

    useAppStore.getState().openProviderSettings()
    useAppStore.getState().setSettingsOpen(false)
    expect(useAppStore.getState()).toMatchObject({
      settingsEntryTarget: null,
      settingsOpen: false,
    })
  })

  it('completes onboarding through the current Provider-settings, conversation, and skip actions', async () => {
    const providerSetup = freshData()
    providerSetup.preferences.firstRunDone = false
    providerSetup.preferences.activeConversationId = undefined
    providerSetup.conversations = []
    resetStore(providerSetup)

    useAppStore.getState().openProviderSettings()
    expect(useAppStore.getState()).toMatchObject({
      settingsEntryTarget: 'provider-key',
      settingsOpen: true,
    })
    expect(useAppStore.getState().data?.preferences.firstRunDone).toBe(false)

    useAppStore.getState().setSettingsOpen(false)
    await useAppStore.getState().createNewConversation()
    expect(useAppStore.getState().data?.preferences.firstRunDone).toBe(true)
    expect(useAppStore.getState().data?.preferences.activeConversationId).toBe(
      useAppStore.getState().data?.conversations[0]?.id,
    )

    const localOnly = freshData()
    localOnly.preferences.firstRunDone = false
    localOnly.preferences.activeConversationId = undefined
    localOnly.conversations = []
    resetStore(localOnly)
    await useAppStore.getState().skipOnboarding()

    expect(useAppStore.getState().data?.preferences.firstRunDone).toBe(true)
    expect(useAppStore.getState().data?.conversations).toHaveLength(0)
  })

  it('publishes skipped onboarding only after its snapshot is durable', async () => {
    const data = freshData()
    data.preferences.firstRunDone = false
    data.preferences.activeConversationId = undefined
    data.conversations = []
    resetStore(data)
    let releaseSave!: () => void
    const pendingSave = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    dbMocks.saveAppData.mockImplementationOnce(async () => pendingSave)

    const skip = useAppStore.getState().skipOnboarding()
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())

    expect(useAppStore.getState().conversationMutationPending).toBe(true)
    expect(useAppStore.getState().data?.preferences.firstRunDone).toBe(false)

    releaseSave()
    await expect(skip).resolves.toBe(true)
    expect(useAppStore.getState().conversationMutationPending).toBe(false)
    expect(useAppStore.getState().data?.preferences.firstRunDone).toBe(true)
  })

  it('keeps onboarding visible when the skip snapshot cannot persist', async () => {
    const data = freshData()
    data.preferences.firstRunDone = false
    data.preferences.activeConversationId = undefined
    data.conversations = []
    resetStore(data)
    dbMocks.saveAppData.mockRejectedValueOnce(new Error('private skip failure'))

    await expect(useAppStore.getState().skipOnboarding()).resolves.toBe(false)

    expect(useAppStore.getState().conversationMutationPending).toBe(false)
    expect(useAppStore.getState().data?.preferences.firstRunDone).toBe(false)
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: appT(data, 'settings.saveFailed'),
      tone: 'error',
    })
  })

  it('keeps local Provider patches monotonic and aligns the active empty conversation model', () => {
    vi.setSystemTime(1_000)
    const data = freshData()
    const provider = data.providers[0]
    const conversation = data.conversations[0]
    data.updatedAt = 5_000
    data.preferences.activeConversationId = conversation.id
    data.conversations[0] = {
      ...conversation,
      messages: [],
      model: 'previous-model',
      providerId: provider.id,
    }
    resetStore(data)

    useAppStore.getState().updateProvider(provider.id, { model: 'next-model' })

    const updated = useAppStore.getState().data
    expect(updated?.updatedAt).toBeGreaterThan(5_000)
    expect(updated?.providers[0].model).toBe('next-model')
    expect(updated?.conversations[0].model).toBe('next-model')

    useAppStore.setState({
      data: {
        ...updated!,
        conversations: [
          {
            ...updated!.conversations[0],
            messages: [message('existing', 'user', 'keep the selected model')],
          },
        ],
      },
    })
    useAppStore.getState().updateProvider(provider.id, { model: 'later-model' })
    expect(useAppStore.getState().data?.conversations[0].model).toBe('next-model')
  })

  it('normalizes Provider transport patches and invalidates only affected diagnostics', () => {
    const data = resetStore()
    const provider = data.providers[0]
    data.providers[0] = {
      ...provider,
      clientRequestMode: undefined,
      proxyUrl: 'https://proxy.example.test',
    }
    const result = {
      field: 'none' as const,
      message: 'Passed',
      retryable: false,
      tone: 'success' as const,
    }
    useAppStore.setState({
      data,
      providerConnectivityResults: { [provider.id]: result },
    })

    useAppStore.getState().updateProvider(provider.id, { name: 'Renamed' })
    expect(useAppStore.getState().providerConnectivityResults[provider.id]).toBe(
      result,
    )

    useAppStore.getState().updateProvider(provider.id, {
      clientRequestMode: true,
    })
    expect(useAppStore.getState().data?.providers[0].proxyUrl).toBeUndefined()
    expect(useAppStore.getState().providerConnectivityResults[provider.id]).toBeUndefined()

    useAppStore.setState({
      providerConnectivityResults: { [provider.id]: result },
    })
    useAppStore.getState().updateProvider(provider.id, {
      proxyUrl: 'https://next-proxy.example.test',
    })
    expect(
      useAppStore.getState().data?.providers[0].clientRequestMode,
    ).toBeUndefined()
    expect(useAppStore.getState().providerConnectivityResults[provider.id]).toBeUndefined()
  })

  it('publishes a newly added Provider only after its snapshot is durable', async () => {
    const data = resetStore()
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseSave!: () => void
    const save = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    dbMocks.saveAppData.mockImplementationOnce(async (snapshot: unknown) => {
      expect((snapshot as AppData).providers).toHaveLength(
        data.providers.length + 1,
      )
      await save
    })

    const addition = Promise.resolve(
      useAppStore.getState().addProvider('gemini'),
    )
    let settled = false
    void addition.then(() => {
      settled = true
    })
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())
    const settledBeforeRelease = settled
    const dataBeforeRelease = useAppStore.getState().data

    releaseSave()
    const accepted = await addition

    expect(settledBeforeRelease).toBe(false)
    expect(dataBeforeRelease).toBe(data)
    expect(accepted).toBe(true)
    expect(useAppStore.getState().data?.providers).toHaveLength(
      data.providers.length + 1,
    )
  })

  it('keeps the Provider list unchanged when an add snapshot fails', async () => {
    const data = resetStore()
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    const failure = new Error(
      'C:\\private\\provider-add sk-private-provider-add-secret',
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    dbMocks.saveAppData.mockRejectedValueOnce(failure)

    const accepted = await Promise.resolve(
      useAppStore.getState().addProvider('gemini'),
    )

    expect(accepted).toBe(false)
    expect(useAppStore.getState().data).toBe(data)
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: appT(data, 'settings.saveFailed'),
      tone: 'error',
    })
    expect(consoleError).toHaveBeenCalledWith('[app] Provider add failed')
    expectConsoleErrorDoesNotExpose(consoleError, failure)
    expect(syncMocks.performSync).not.toHaveBeenCalled()
  })

  it('rejects a duplicate Provider add while the first snapshot is pending', async () => {
    const data = resetStore()
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseSave!: () => void
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    dbMocks.saveAppData.mockImplementationOnce(
      async () => {
        await saveGate
      },
    )

    const first = useAppStore.getState().addProvider('gemini')
    const duplicate = useAppStore.getState().addProvider('gemini')
    await expect(duplicate).resolves.toBe(false)
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())

    expect(useAppStore.getState().data).toBe(data)

    releaseSave()
    await expect(first).resolves.toBe(true)
    expect(useAppStore.getState().data?.providers).toHaveLength(
      data.providers.length + 1,
    )
    expect(dbMocks.saveAppData).toHaveBeenCalledOnce()
  })

  it('reorders providers within their enabled group and persists the new order', async () => {
    const data = resetStore()
    const template = data.providers[0]
    data.providers = [
      { ...template, id: 'enabled-a', name: 'Enabled A', enabled: true },
      { ...template, id: 'enabled-b', name: 'Enabled B', enabled: true },
      { ...template, id: 'disabled-a', name: 'Disabled A', enabled: false },
      { ...template, id: 'disabled-b', name: 'Disabled B', enabled: false },
    ]
    resetStore(data)

    await useAppStore.getState().reorderProvider('enabled-b', 'enabled-a')
    expect(useAppStore.getState().data?.providers.map(({ id }) => id)).toEqual([
      'enabled-b',
      'enabled-a',
      'disabled-a',
      'disabled-b',
    ])

    await useAppStore.getState().reorderProvider('disabled-b', 'disabled-a')
    expect(useAppStore.getState().data?.providers.map(({ id }) => id)).toEqual([
      'enabled-b',
      'enabled-a',
      'disabled-b',
      'disabled-a',
    ])

    await useAppStore.getState().reorderProvider('enabled-b', 'disabled-a')
    await useAppStore.getState().reorderProvider('missing', 'enabled-a')
    expect(useAppStore.getState().data?.providers.map(({ id }) => id)).toEqual([
      'enabled-b',
      'enabled-a',
      'disabled-b',
      'disabled-a',
    ])

    await useAppStore.getState().flushLocalSaves()
    expect(dbMocks.saveAppData).toHaveBeenLastCalledWith(
      expect.objectContaining({
        providers: expect.arrayContaining([
          expect.objectContaining({ id: 'enabled-b' }),
          expect.objectContaining({ id: 'disabled-b' }),
        ]),
      }),
    )
    const persisted = dbMocks.saveAppData.mock.calls.at(-1)?.[0] as AppData
    expect(persisted.providers.map(({ id }) => id)).toEqual([
      'enabled-b',
      'enabled-a',
      'disabled-b',
      'disabled-a',
    ])
  })

  it('publishes a Provider reorder only after its snapshot is durable', async () => {
    const data = freshData()
    const template = data.providers[0]
    data.providers = [
      { ...template, id: 'provider-a', name: 'Provider A' },
      { ...template, id: 'provider-b', name: 'Provider B' },
    ]
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseSave!: () => void
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve
        }),
    )

    const reorder = Promise.resolve(
      useAppStore.getState().reorderProvider('provider-b', 'provider-a'),
    )
    let settled = false
    void reorder.then(() => {
      settled = true
    })
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())
    const settledBeforeRelease = settled
    const orderBeforeRelease = useAppStore
      .getState()
      .data?.providers.map(({ id }) => id)

    releaseSave()
    const accepted = await reorder

    expect(settledBeforeRelease).toBe(false)
    expect(orderBeforeRelease).toEqual(['provider-a', 'provider-b'])
    expect(accepted).toBe(true)
    expect(useAppStore.getState().data?.providers.map(({ id }) => id)).toEqual([
      'provider-b',
      'provider-a',
    ])
  })

  it('keeps the Provider order when its durable reorder fails', async () => {
    const data = freshData()
    const template = data.providers[0]
    data.providers = [
      { ...template, id: 'provider-a', name: 'Provider A' },
      { ...template, id: 'provider-b', name: 'Provider B' },
    ]
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    const failure = new Error(
      'C:\\private\\provider-reorder sk-private-provider-reorder-secret',
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    dbMocks.saveAppData.mockRejectedValueOnce(failure)

    const accepted = await Promise.resolve(
      useAppStore.getState().reorderProvider('provider-b', 'provider-a'),
    )

    expect(accepted).toBe(false)
    expect(useAppStore.getState().data).toBe(data)
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: appT(data, 'settings.saveFailed'),
      tone: 'error',
    })
    expect(consoleError).toHaveBeenCalledWith('[app] Provider reorder failed')
    expectConsoleErrorDoesNotExpose(consoleError, failure)
    expect(syncMocks.performSync).not.toHaveBeenCalled()
  })

  it('rebases a Provider list commit over a concurrent text-field edit', async () => {
    const data = freshData()
    const template = data.providers[0]
    data.providers = [
      { ...template, id: 'provider-a', name: 'Provider A' },
      { ...template, id: 'provider-b', name: 'Provider B' },
    ]
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseSave!: () => void
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve
        }),
    )

    const reorder = useAppStore
      .getState()
      .reorderProvider('provider-b', 'provider-a')
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())
    useAppStore.getState().updateProvider('provider-a', {
      name: 'Renamed while saving',
    })

    releaseSave()
    await expect(reorder).resolves.toBe(true)
    await useAppStore.getState().flushLocalSaves()

    expect(useAppStore.getState().data?.providers.map(({ id }) => id)).toEqual([
      'provider-b',
      'provider-a',
    ])
    expect(
      useAppStore.getState().data?.providers.find(({ id }) => id === 'provider-a')
        ?.name,
    ).toBe('Renamed while saving')
    const persisted = dbMocks.saveAppData.mock.calls.at(-1)?.[0] as AppData
    expect(persisted.providers.map(({ id }) => id)).toEqual([
      'provider-b',
      'provider-a',
    ])
    expect(
      persisted.providers.find(({ id }) => id === 'provider-a')?.name,
    ).toBe('Renamed while saving')
  })

  it('publishes Provider disabling and conversation fallback only after durable save', async () => {
    const data = freshData()
    const source = {
      ...data.providers[0],
      id: 'provider-source',
      model: 'source-model',
      name: 'Source Provider',
    }
    const fallback = {
      ...data.providers[0],
      id: 'provider-fallback',
      model: 'fallback-model',
      name: 'Fallback Provider',
    }
    data.providers = [source, fallback]
    data.conversations[0] = {
      ...data.conversations[0],
      model: source.model,
      providerId: source.id,
    }
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseSave!: () => void
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve
        }),
    )

    const disabling = Promise.resolve(
      useAppStore.getState().setProviderEnabled(source.id, false),
    )
    let settled = false
    void disabling.then(() => {
      settled = true
    })
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())
    const settledBeforeRelease = settled
    const dataBeforeRelease = useAppStore.getState().data

    releaseSave()
    const accepted = await disabling

    expect(settledBeforeRelease).toBe(false)
    expect(dataBeforeRelease).toBe(data)
    expect(accepted).toBe(true)
    expect(useAppStore.getState().data?.providers[0].enabled).toBe(false)
    expect(useAppStore.getState().data?.conversations[0]).toMatchObject({
      model: defaultModelForProvider(fallback),
      providerId: fallback.id,
    })
  })

  it('rejects a stale conversation model choice after its Provider is disabled', async () => {
    const data = freshData()
    const source = {
      ...data.providers[0],
      id: 'provider-source-model-race',
      model: 'source-model',
      name: 'Source Provider',
    }
    const fallback = {
      ...data.providers[0],
      id: 'provider-fallback-model-race',
      model: 'fallback-model',
      name: 'Fallback Provider',
    }
    data.providers = [source, fallback]
    data.conversations[0] = {
      ...data.conversations[0],
      model: source.model,
      providerId: source.id,
    }
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseSave!: () => void
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve
        }),
    )

    const disabling = useAppStore
      .getState()
      .setProviderEnabled(source.id, false)
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())

    const staleSelection = useAppStore
      .getState()
      .setConversationModelChoice(
        data.conversations[0].id,
        source.id,
        source.model,
      )

    releaseSave()
    await expect(disabling).resolves.toBe(true)
    await expect(staleSelection).resolves.toBe(false)

    expect(useAppStore.getState().data?.conversations[0]).toMatchObject({
      model: defaultModelForProvider(fallback),
      providerId: fallback.id,
    })
  })

  it('rejects Provider disabling while an admitted generation is deriving its proxy token', async () => {
    const data = freshData()
    const source = {
      ...data.providers[0],
      clientRequestMode: false,
      id: 'provider-source',
      model: 'source-model',
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    const fallback = {
      ...data.providers[0],
      id: 'provider-fallback',
      model: 'fallback-model',
    }
    data.providers = [source, fallback]
    data.conversations[0] = {
      ...data.conversations[0],
      model: source.model,
      providerId: source.id,
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'proxy-passphrase' })
    let releaseDerivation!: (value: string) => void
    accessKeyMocks.accessKeyFromPassword.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseDerivation = resolve
        }),
    )

    const generation = useAppStore
      .getState()
      .sendMessage('generation keeps Provider routing')
    await vi.waitFor(() =>
      expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledOnce(),
    )

    await expect(
      useAppStore.getState().setProviderEnabled(source.id, false),
    ).resolves.toBe(false)
    expect(dbMocks.saveAppData).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.providers[0].enabled).toBe(true)
    expect(useAppStore.getState().data?.conversations[0]).toMatchObject({
      model: source.model,
      providerId: source.id,
    })
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: appT(data, 'settings.providerMutationBusy'),
      tone: 'info',
    })

    releaseDerivation('proxy-token')
    await generation
    expect(runtime.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: source.model,
        provider: expect.objectContaining({ id: source.id }),
      }),
    )
  })

  it('does not admit generation while Provider disabling owns its durable route change', async () => {
    const data = freshData()
    const source = { ...data.providers[0], id: 'provider-source' }
    const fallback = { ...data.providers[0], id: 'provider-fallback' }
    data.providers = [source, fallback]
    data.conversations[0] = {
      ...data.conversations[0],
      providerId: source.id,
    }
    resetStore(data)
    const messagesBefore = structuredClone(data.conversations[0].messages)
    let releaseSave!: () => void
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve
        }),
    )

    const disabling = useAppStore
      .getState()
      .setProviderEnabled(source.id, false)
    await vi.waitFor(() => expect(releaseSave).toBeTypeOf('function'))
    let generationOwnerPublished = false
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.sending || state.streaming) generationOwnerPublished = true
    })

    const generation = useAppStore
      .getState()
      .sendMessage('must not cross Provider fallback')
    await Promise.resolve()

    expect(generationOwnerPublished).toBe(false)
    expect(runtime.streamChat).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.conversations[0].messages).toEqual(
      messagesBefore,
    )

    releaseSave()
    await disabling
    await expect(generation).resolves.toBe(false)
    unsubscribe()
  })

  it.each([
    ['enable', false, true],
    ['disable', true, false],
  ] as const)(
    'keeps Provider state when a durable %s fails',
    async (_kind, initialEnabled, nextEnabled) => {
      const data = freshData()
      const target = {
        ...data.providers[0],
        enabled: initialEnabled,
        id: 'provider-target',
      }
      const fallback = {
        ...data.providers[0],
        id: 'provider-fallback',
        name: 'Fallback Provider',
      }
      data.providers = [target, fallback]
      resetStore(data)
      await useAppStore.getState().flushLocalSaves()
      dbMocks.saveAppData.mockClear()
      const failure = new Error(
        'C:\\private\\provider-enabled sk-private-provider-enabled-secret',
      )
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)
      dbMocks.saveAppData.mockRejectedValueOnce(failure)

      const accepted = await Promise.resolve(
        useAppStore.getState().setProviderEnabled(target.id, nextEnabled),
      )
      await useAppStore.getState().flushLocalSaves().catch(() => undefined)

      expect(accepted).toBe(false)
      expect(useAppStore.getState().data).toBe(data)
      expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
        message: appT(data, 'settings.saveFailed'),
        tone: 'error',
      })
      expect(consoleError).toHaveBeenCalledWith(
        '[app] Provider enabled-state change failed',
      )
      expectConsoleErrorDoesNotExpose(consoleError, failure)
      expect(syncMocks.performSync).not.toHaveBeenCalled()
    },
  )

  it('reorders Provider models without changing the selected default model', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    data.providers[0] = {
      ...data.providers[0],
      model: 'model-b',
      models: ['model-a', 'model-b', 'model-c'],
    }
    resetStore(data)

    await useAppStore
      .getState()
      .reorderProviderModel(providerId, 'model-c', 'model-a')

    expect(useAppStore.getState().data?.providers[0]).toMatchObject({
      model: 'model-b',
      models: ['model-c', 'model-a', 'model-b'],
    })

    await useAppStore
      .getState()
      .reorderProviderModel(providerId, 'missing', 'model-b')
    expect(useAppStore.getState().data?.providers[0].models).toEqual([
      'model-c',
      'model-a',
      'model-b',
    ])
  })

  it('commits Provider model add, rename, remove, and reorder through the current store', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    data.providers[0] = {
      ...data.providers[0],
      model: 'gpt-5',
      imageModel: 'gpt-image-1',
      models: ['gpt-5', 'gpt-4.1', 'gpt-image-1'],
    }
    resetStore(data)

    await expect(
      useAppStore.getState().appendProviderModels(providerId, 'gpt-5.1, gpt-image-2'),
    ).resolves.toBe(true)
    await expect(
      useAppStore.getState().renameProviderModel(providerId, 'gpt-5', 'gpt-5.2'),
    ).resolves.toBe(true)
    await expect(
      useAppStore.getState().removeProviderModel(providerId, 'gpt-image-1'),
    ).resolves.toBe(true)
    await expect(
      useAppStore.getState().reorderProviderModel(providerId, 'gpt-5.1', 'gpt-4.1'),
    ).resolves.toBe(true)

    expect(useAppStore.getState().data?.providers[0]).toMatchObject({
      model: 'gpt-5.2',
      imageModel: 'gpt-image-2',
      models: ['gpt-5.2', 'gpt-5.1', 'gpt-4.1', 'gpt-image-2'],
    })
  })

  it('publishes a Provider model removal only after its snapshot is durable', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    data.providers[0] = {
      ...data.providers[0],
      model: 'model-a',
      models: ['model-a', 'model-b'],
    }
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseSave!: () => void
    const save = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    dbMocks.saveAppData.mockImplementationOnce(async (snapshot: unknown) => {
      expect((snapshot as AppData).providers[0]?.models).toEqual(['model-a'])
      await save
    })

    const removal = Promise.resolve(
      useAppStore.getState().removeProviderModel(providerId, 'model-b'),
    )
    let settled = false
    void removal.then(() => {
      settled = true
    })
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())
    const settledBeforeRelease = settled
    const modelsBeforeRelease = useAppStore.getState().data?.providers[0]?.models

    releaseSave()
    const accepted = await removal
    await vi.runAllTimersAsync()
    await useAppStore.getState().flushLocalSaves()

    expect(settledBeforeRelease).toBe(false)
    expect(modelsBeforeRelease).toEqual(['model-a', 'model-b'])
    expect(accepted).toBe(true)
    expect(useAppStore.getState().data?.providers[0]?.models).toEqual(['model-a'])
    expect(dbMocks.saveAppData).toHaveBeenCalledOnce()
  })

  it.each([
    ['append', (providerId: string) =>
      useAppStore.getState().appendProviderModels(providerId, 'model-c')],
    ['rename', (providerId: string) =>
      useAppStore.getState().renameProviderModel(providerId, 'model-a', 'renamed')],
    ['remove', (providerId: string) =>
      useAppStore.getState().removeProviderModel(providerId, 'model-b')],
    ['reorder', (providerId: string) =>
      useAppStore.getState().reorderProviderModel(providerId, 'model-b', 'model-a')],
  ] as const)(
    'keeps the Provider model catalog when a durable %s fails',
    async (_kind, mutate) => {
      const data = resetStore()
      const providerId = data.providers[0].id
      data.providers[0] = {
        ...data.providers[0],
        model: 'model-a',
        models: ['model-a', 'model-b'],
      }
      resetStore(data)
      await useAppStore.getState().flushLocalSaves()
      dbMocks.saveAppData.mockClear()
      const failure = new Error(
        'C:\\private\\provider-model sk-private-provider-model-secret',
      )
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      dbMocks.saveAppData.mockRejectedValueOnce(failure)

      const accepted = await Promise.resolve(mutate(providerId))
      const stateAfterAction = useAppStore.getState().data
      await vi.runAllTimersAsync()
      await useAppStore.getState().flushLocalSaves().catch(() => undefined)

      expect(accepted).toBe(false)
      expect(stateAfterAction).toBe(data)
      expect(consoleError).toHaveBeenCalledWith('[app] Provider model mutation failed')
      expectConsoleErrorDoesNotExpose(consoleError, failure)
    },
  )

  it('reports detached local-save failures without leaking details and keeps the save queue retryable', async () => {
    const data = resetStore()
    const failure = new Error(
      'C:\\private\\workspace\\save.db Bearer local-secret-123456789',
    )
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    dbMocks.saveAppData.mockRejectedValueOnce(failure)

    useAppStore.getState().setTheme('dark')
    await vi.advanceTimersByTimeAsync(300)

    expect(dbMocks.saveAppData).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().toasts.at(-1)).toEqual(
      expect.objectContaining({
        message: appT(data, 'settings.saveFailed'),
        tone: 'error',
      }),
    )
    const userMessage = useAppStore.getState().toasts.at(-1)?.message ?? ''
    expect(userMessage).not.toContain('private')
    expect(userMessage).not.toContain('local-secret')
    expect(userMessage).not.toContain(failure.message)
    expect(userMessage).not.toContain(String(failure))
    expect(consoleError).toHaveBeenCalledWith('[app] save failed')
    expectConsoleErrorDoesNotExpose(consoleError, failure)

    useAppStore.getState().setTheme('light')
    await useAppStore.getState().flushLocalSaves()

    expect(dbMocks.saveAppData).toHaveBeenCalledTimes(2)
    expect(dbMocks.saveAppData).toHaveBeenLastCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({ theme: 'light' }),
      }),
    )
  })

  it('queues Skill refs written before a failed local AppData save for cleanup', async () => {
    const data = resetStore()
    const inlineSkill = skill('inline-skill', {
      chunks: [
        {
          content: 'inline body',
          heading: 'Body',
          id: 'inline-chunk',
          keywords: [],
          tokenEstimate: 2,
        },
      ],
    })
    resetStore({ ...data, skills: [inlineSkill] })

    const persisted = structuredClone({ ...data, skills: [inlineSkill] })
    persisted.skills[0].chunks = [
      {
        ...persisted.skills[0].chunks[0],
        content: undefined,
        contentPreview: 'inline body',
        contentRef: 'skill-chunk:failed-save',
      },
    ]
    dbMocks.persistAppDataSkillContents.mockResolvedValueOnce(persisted)
    dbMocks.saveAppData.mockRejectedValueOnce(new Error('local AppData save failed'))

    useAppStore.getState().setTheme('dark')
    await vi.advanceTimersByTimeAsync(300)

    expect(dbMocks.saveAppData).toHaveBeenCalledOnce()
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith([
      'skill-chunk:failed-save',
    ])
  })

  it('cleans newly materialized Skill refs when a Provider mutation save fails', async () => {
    const data = freshData()
    const inlineSkill = skill('inline-skill', {
      chunks: [
        {
          content: 'inline body',
          heading: 'Body',
          id: 'inline-chunk',
          keywords: [],
          tokenEstimate: 2,
        },
      ],
    })
    const targetProvider = {
      ...data.providers[0],
      enabled: false,
      id: 'provider-mutation-target',
    }
    const withSkill = {
      ...data,
      providers: [targetProvider],
      skills: [inlineSkill],
    }
    resetStore(withSkill)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.persistAppDataSkillContents.mockClear()
    dbMocks.saveAppData.mockClear()

    const persisted = structuredClone(withSkill)
    persisted.skills[0].chunks = [
      {
        ...persisted.skills[0].chunks[0],
        content: undefined,
        contentPreview: 'inline body',
        contentRef: 'skill-chunk:provider-failed-save',
      },
    ]
    dbMocks.persistAppDataSkillContents.mockResolvedValueOnce(persisted)
    dbMocks.saveAppData.mockRejectedValueOnce(new Error('Provider save failed'))

    await expect(
      useAppStore.getState().setProviderEnabled(targetProvider.id, true),
    ).resolves.toBe(false)

    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith([
      'skill-chunk:provider-failed-save',
    ])
  })

  it('serializes local AppData writes and coalesces in-flight changes to the latest snapshot', async () => {
    resetStore()
    let releaseFirstSave!: () => void
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseFirstSave = resolve
        }),
    )

    useAppStore.getState().setTheme('dark')
    await vi.advanceTimersByTimeAsync(300)
    expect(dbMocks.saveAppData).toHaveBeenCalledTimes(1)

    useAppStore.getState().setTheme('light')
    useAppStore.getState().toggleCompact()
    await vi.advanceTimersByTimeAsync(300)
    expect(dbMocks.saveAppData).toHaveBeenCalledTimes(1)

    releaseFirstSave()
    await useAppStore.getState().flushLocalSaves()

    expect(dbMocks.saveAppData).toHaveBeenCalledTimes(2)
    expect(dbMocks.saveAppData).toHaveBeenLastCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({
          compactMode: true,
          theme: 'light',
        }),
      }),
    )
  })

  it('retries the unchanged current snapshot on an explicit flush after a detached save failure without spinning', async () => {
    resetStore()
    dbMocks.saveAppData
      .mockRejectedValueOnce(new Error('detached save failed'))
      .mockResolvedValue(undefined)

    useAppStore.getState().setTheme('dark')
    await vi.advanceTimersByTimeAsync(300)

    expect(dbMocks.saveAppData).toHaveBeenCalledTimes(1)
    await vi.runAllTimersAsync()
    expect(dbMocks.saveAppData).toHaveBeenCalledTimes(1)

    await expect(useAppStore.getState().flushLocalSaves()).resolves.toBeUndefined()
    expect(dbMocks.saveAppData).toHaveBeenCalledTimes(2)
    expect(dbMocks.saveAppData).toHaveBeenLastCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({ theme: 'dark' }),
      }),
    )
  })

  it('persists a revert to the durable value while an earlier snapshot is in flight', async () => {
    const data = resetStore()
    const durableTheme = data.preferences.theme
    let releaseFirstSave!: () => void
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseFirstSave = resolve
        }),
    )

    useAppStore.getState().setTheme('dark')
    await vi.advanceTimersByTimeAsync(300)
    expect(dbMocks.saveAppData).toHaveBeenCalledTimes(1)

    useAppStore.getState().setTheme(durableTheme)
    await vi.advanceTimersByTimeAsync(300)
    expect(dbMocks.saveAppData).toHaveBeenCalledTimes(1)

    releaseFirstSave()
    await useAppStore.getState().flushLocalSaves()

    expect(dbMocks.saveAppData).toHaveBeenCalledTimes(2)
    expect(dbMocks.saveAppData).toHaveBeenLastCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({ theme: durableTheme }),
      }),
    )
  })

  it('exports the authoritative snapshot after a pending local flush settles', async () => {
    resetStore()
    useAppStore.setState({ syncPassphrase: 'backup-passphrase' })
    let releaseFirstPersist!: () => void
    const firstPersist = new Promise<void>((resolve) => {
      releaseFirstPersist = resolve
    })
    dbMocks.persistAppDataSkillContents.mockImplementationOnce(
      async (data: unknown) => {
        await firstPersist
        return data
      },
    )
    cryptoMocks.encryptVault.mockResolvedValueOnce({
      kind: 'zerochat.encrypted',
      version: 1,
    })

    useAppStore.getState().setTheme('dark')
    await vi.advanceTimersByTimeAsync(300)
    expect(dbMocks.persistAppDataSkillContents).toHaveBeenCalledOnce()

    const exported = useAppStore.getState().exportBackup()
    useAppStore.getState().setTheme('light')
    releaseFirstPersist()
    await exported

    expect(cryptoMocks.encryptVault).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          preferences: expect.objectContaining({ theme: 'light' }),
        }),
      }),
      'backup-passphrase',
    )
  })

  it('does not start backup export before conflict-recovery edits are durable', async () => {
    const base = freshData()
    const remote = structuredClone(base)
    remote.preferences.compactMode = true
    remote.updatedAt = base.updatedAt + 1
    dbMocks.loadAppData
      .mockResolvedValueOnce(base)
      .mockResolvedValueOnce(remote)

    useAppStore.setState({ status: 'loading' })
    await beginMockedHydration('backup export conflict recovery')
    useAppStore.setState({ syncPassphrase: 'backup-passphrase' })
    dbMocks.saveAppData.mockClear()
    cryptoMocks.encryptVault.mockClear()

    let saveCalls = 0
    let releaseRetry!: () => void
    const retrySave = new Promise<void>((resolve) => {
      releaseRetry = resolve
    })
    dbMocks.saveAppData.mockImplementation(async () => {
      saveCalls += 1
      if (saveCalls === 1) throw new AppDataWriteConflictError()
      if (saveCalls === 2) {
        useAppStore.getState().setTheme('light')
        return
      }
      await retrySave
      throw new Error('rebase save failed')
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    useAppStore.getState().setTheme('dark')
    const exporting = useAppStore.getState().exportBackup()
    await vi.waitFor(() => expect(saveCalls).toBeGreaterThanOrEqual(2))
    await Promise.resolve()

    expect(cryptoMocks.encryptVault).not.toHaveBeenCalled()
    expect(saveCalls).toBe(3)

    releaseRetry()
    await exporting

    expect(cryptoMocks.encryptVault).not.toHaveBeenCalled()
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: appT(useAppStore.getState().data, 'settings.saveFailed'),
      tone: 'error',
    })
  })

  it('merges a concurrent AppData revision and keeps the local save queue writable', async () => {
    const base = freshData()
    base.preferences.compactMode = false
    base.preferences.theme = 'system'
    const remote = structuredClone(base)
    remote.preferences.compactMode = true
    remote.updatedAt = base.updatedAt + 1
    dbMocks.loadAppData
      .mockResolvedValueOnce(base)
      .mockResolvedValueOnce(remote)

    useAppStore.setState({ status: 'loading' })
    await beginMockedHydration('concurrent AppData revision')
    dbMocks.saveAppData.mockClear()
    dbMocks.saveAppData
      .mockRejectedValueOnce(new AppDataWriteConflictError())
      .mockResolvedValue(undefined)

    useAppStore.getState().setTheme('dark')
    await expect(useAppStore.getState().flushLocalSaves()).resolves.toBeUndefined()

    expect(useAppStore.getState().data?.preferences).toMatchObject({
      compactMode: true,
      theme: 'dark',
    })
    expect(dbMocks.saveAppData).toHaveBeenLastCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({
          compactMode: true,
          theme: 'dark',
        }),
      }),
    )

    useAppStore.getState().setTheme('light')
    await expect(useAppStore.getState().flushLocalSaves()).resolves.toBeUndefined()
    expect(dbMocks.saveAppData).toHaveBeenLastCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({
          compactMode: true,
          theme: 'light',
        }),
      }),
    )
  })

  it('does not resurrect a remotely deleted Provider during Store conflict recovery', async () => {
    const base = freshData()
    const remote = deleteProviderFromAppData(
      structuredClone(base),
      base.providers[0].id,
    )
    dbMocks.loadAppData
      .mockResolvedValueOnce(base)
      .mockResolvedValueOnce(remote)

    useAppStore.setState({ status: 'loading' })
    await beginMockedHydration('Provider deletion conflict recovery')
    dbMocks.saveAppData.mockClear()
    dbMocks.saveAppData.mockRejectedValueOnce(new AppDataWriteConflictError())

    useAppStore.getState().setTheme('dark')
    await expect(useAppStore.getState().flushLocalSaves()).resolves.toBeUndefined()

    expect(useAppStore.getState().data?.providers).toEqual([])
    expect(dbMocks.saveAppData).toHaveBeenLastCalledWith(
      expect.objectContaining({ providers: [] }),
    )
  })

  it('does not resolve a local flush before conflict-recovery edits are durable', async () => {
    const base = freshData()
    const remote = structuredClone(base)
    remote.preferences.compactMode = true
    remote.updatedAt = base.updatedAt + 1
    dbMocks.loadAppData
      .mockResolvedValueOnce(base)
      .mockResolvedValueOnce(remote)

    useAppStore.setState({ status: 'loading' })
    await beginMockedHydration('local flush conflict recovery')
    dbMocks.saveAppData.mockClear()

    let saveCalls = 0
    let releaseRetry!: () => void
    const retrySave = new Promise<void>((resolve) => {
      releaseRetry = resolve
    })
    dbMocks.saveAppData.mockImplementation(async () => {
      saveCalls += 1
      if (saveCalls === 1) {
        throw new AppDataWriteConflictError()
      }
      if (saveCalls === 2) {
        useAppStore.getState().setTheme('light')
        return
      }
      await retrySave
    })

    useAppStore.getState().setTheme('dark')
    let settled = false
    const flushing = useAppStore.getState().flushLocalSaves().then(() => {
      settled = true
    })

    await vi.waitFor(() => expect(saveCalls).toBeGreaterThanOrEqual(2))
    await Promise.resolve()
    expect(settled).toBe(false)

    if (saveCalls < 3) {
      await vi.advanceTimersByTimeAsync(300)
      await vi.waitFor(() => expect(saveCalls).toBeGreaterThanOrEqual(3))
    }
    releaseRetry()
    await flushing

    expect(useAppStore.getState().data?.preferences).toMatchObject({
      compactMode: true,
      theme: 'light',
    })
    expect(dbMocks.saveAppData).toHaveBeenLastCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({
          compactMode: true,
          theme: 'light',
        }),
      }),
    )
  })

  it('invalidates pending read-aloud when write-conflict recovery replaces its Provider request', async () => {
    const base = freshData()
    const assistant = message(
      'assistant-speech-write-conflict',
      'assistant',
      'Do not play after conflict recovery',
    )
    base.conversations[0] = {
      ...base.conversations[0],
      messages: [assistant],
    }
    const remote = structuredClone(base)
    remote.providers[0] = {
      ...remote.providers[0],
      baseUrl: 'https://remote-provider.invalid/v1',
      updatedAt: remote.providers[0].updatedAt + 10,
    }
    remote.updatedAt = base.updatedAt + 10
    dbMocks.loadAppData
      .mockResolvedValueOnce(base)
      .mockResolvedValueOnce(remote)
    secretMocks.loadZeroChatSecrets.mockResolvedValueOnce({
      githubToken: '',
      providerKeys: { [base.providers[0].id]: 'test-key' },
    })
    useAppStore.setState({ status: 'loading' })
    await beginMockedHydration('read-aloud conflict recovery')

    let resolveSpeech: ((value: { blob: Blob; model: string }) => void) | undefined
    runtime.synthesizeSpeechAudio.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSpeech = resolve
        }),
    )
    const AudioMock = vi.fn(function AudioMock() {
      return { pause: vi.fn(), play: vi.fn(async () => undefined) }
    })
    vi.stubGlobal('Audio', AudioMock)
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:write-conflict-stale-speech'),
      revokeObjectURL: vi.fn(),
    })
    const running = useAppStore.getState().speakMessage(assistant)
    await vi.waitFor(() =>
      expect(runtime.synthesizeSpeechAudio).toHaveBeenCalledOnce(),
    )
    const signal = runtime.synthesizeSpeechAudio.mock.calls[0]?.[0]?.signal as
      | AbortSignal
      | undefined

    dbMocks.saveAppData.mockRejectedValueOnce(new AppDataWriteConflictError())
    useAppStore.getState().setTheme('dark')
    await useAppStore.getState().flushLocalSaves()

    expect(useAppStore.getState().data?.providers[0].baseUrl).toBe(
      'https://remote-provider.invalid/v1',
    )
    expect(signal?.aborted).toBe(true)
    expect(useAppStore.getState().speakingMessageId).toBe('')
    resolveSpeech?.({
      blob: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
      model: 'speech-model',
    })
    await running
    expect(AudioMock).not.toHaveBeenCalled()
  })

  it('contains detached local-save notification failures without poisoning later saves', async () => {
    resetStore()
    const originalNotify = useAppStore.getState().notify
    const failingNotify = vi.fn(() => {
      throw new Error('notification channel unavailable')
    })
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    useAppStore.setState({ notify: failingNotify })
    dbMocks.saveAppData.mockRejectedValueOnce(new Error('first save failed'))

    useAppStore.getState().setTheme('dark')
    await vi.advanceTimersByTimeAsync(300)

    expect(failingNotify).toHaveBeenCalledWith(
      appT(useAppStore.getState().data, 'settings.saveFailed'),
      'error',
    )
    expect(consoleError).toHaveBeenCalled()

    useAppStore.setState({ notify: originalNotify })
    useAppStore.getState().setTheme('light')
    await expect(useAppStore.getState().flushLocalSaves()).resolves.toBeUndefined()
    expect(dbMocks.saveAppData).toHaveBeenCalledTimes(2)
  })

  it('uses the latest notification channel when an in-flight detached save fails', async () => {
    const data = resetStore()
    const originalNotify = useAppStore.getState().notify
    const initialNotify = vi.fn()
    const latestNotify = vi.fn()
    let rejectSave!: (error: unknown) => void
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject
        }),
    )
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    useAppStore.setState({ notify: initialNotify })

    useAppStore.getState().setTheme('dark')
    await vi.advanceTimersByTimeAsync(300)
    expect(dbMocks.saveAppData).toHaveBeenCalledOnce()

    useAppStore.setState({ notify: latestNotify })
    rejectSave(new Error('save failed after notice target changed'))
    await vi.waitFor(() =>
      expect(latestNotify).toHaveBeenCalledWith(
        appT(data, 'settings.saveFailed'),
        'error',
      ),
    )

    expect(initialNotify).not.toHaveBeenCalled()
    useAppStore.setState({ notify: originalNotify })
  })

  it('does not rewrite a hydrated snapshot during an explicit flush', async () => {
    const data = freshData()
    dbMocks.loadAppData.mockResolvedValueOnce(data)

    useAppStore.setState({ status: 'loading' })
    await beginMockedHydration('hydrated explicit flush')
    dbMocks.saveAppData.mockClear()

    await useAppStore.getState().flushLocalSaves()

    expect(dbMocks.saveAppData).not.toHaveBeenCalled()
  })

  it('does not repeat an explicit flush after non-identity skill persistence', async () => {
    const data = resetStore()
    const inlineSkill = skill('inline-skill', {
      chunks: [
        {
          content: 'inline body',
          heading: 'Body',
          id: 'inline-chunk',
          keywords: [],
          tokenEstimate: 2,
        },
      ],
    })
    const inlineData = {
      ...data,
      skills: [inlineSkill],
    }
    resetStore(inlineData)
    const persisted = structuredClone(inlineData)
    persisted.skills[0].chunks = [
      {
        ...persisted.skills[0].chunks[0],
        content: undefined,
        contentRef: 'skill-chunk:stored',
        contentPreview: 'inline body',
      },
    ]
    dbMocks.persistAppDataSkillContents.mockResolvedValueOnce(persisted)

    useAppStore.getState().setTheme('dark')
    await expect(useAppStore.getState().flushLocalSaves()).resolves.toBeUndefined()
    dbMocks.saveAppData.mockClear()

    await expect(useAppStore.getState().flushLocalSaves()).resolves.toBeUndefined()

    expect(dbMocks.persistAppDataSkillContents).toHaveBeenCalledTimes(1)
    expect(dbMocks.saveAppData).not.toHaveBeenCalled()
  })

  it('publishes canonical skill refs before an unrelated edit is saved', async () => {
    const data = resetStore()
    const inlineSkill = skill('inline-skill', {
      chunks: [
        {
          content: 'inline body',
          heading: 'Body',
          id: 'inline-chunk',
          keywords: [],
          tokenEstimate: 2,
        },
      ],
    })
    resetStore({ ...data, skills: [inlineSkill] })

    let contentWriteCount = 0
    dbMocks.persistAppDataSkillContents.mockImplementation(
      async (value: unknown) => {
        const snapshot = structuredClone(value as AppData)
        snapshot.skills = snapshot.skills.map((item) => ({
          ...item,
          chunks: item.chunks.map((chunk) => {
            const content = chunk.content?.trim()
            if (!content) return chunk
            contentWriteCount += 1
            const canonical = {
              ...chunk,
              contentPreview: content,
              contentRef: `skill-chunk:write-${contentWriteCount}`,
            }
            delete canonical.content
            return canonical
          }),
        }))
        return snapshot
      },
    )

    useAppStore.getState().setTheme('dark')
    await expect(useAppStore.getState().flushLocalSaves()).resolves.toBeUndefined()

    const firstRef = useAppStore.getState().data?.skills[0]?.chunks[0]?.contentRef
    expect(firstRef).toBe('skill-chunk:write-1')
    expect(useAppStore.getState().data?.skills[0]?.chunks[0]?.content).toBeUndefined()

    useAppStore.getState().setTheme('light')
    await expect(useAppStore.getState().flushLocalSaves()).resolves.toBeUndefined()

    expect(contentWriteCount).toBe(1)
    expect(useAppStore.getState().data?.skills[0]?.chunks[0]?.contentRef).toBe(
      firstRef,
    )
    expect(dbMocks.saveAppData).toHaveBeenLastCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({ theme: 'light' }),
        skills: [
          expect.objectContaining({
            chunks: [expect.objectContaining({ contentRef: firstRef })],
          }),
        ],
      }),
    )
  })

  it('does not orphan a canonical skill ref when an unrelated edit overlaps saving', async () => {
    const data = resetStore()
    const inlineSkill = skill('inline-skill', {
      chunks: [
        {
          content: 'inline body',
          heading: 'Body',
          id: 'inline-chunk',
          keywords: [],
          tokenEstimate: 2,
        },
      ],
    })
    resetStore({ ...data, skills: [inlineSkill] })

    let contentWriteCount = 0
    const writtenRefs: string[] = []
    dbMocks.persistAppDataSkillContents.mockImplementation(
      async (value: unknown) => {
        const snapshot = structuredClone(value as AppData)
        snapshot.skills = snapshot.skills.map((item) => ({
          ...item,
          chunks: item.chunks.map((chunk) => {
            const content = chunk.content?.trim()
            if (!content) return chunk
            const contentRef = `skill-chunk:write-${++contentWriteCount}`
            writtenRefs.push(contentRef)
            return {
              ...chunk,
              content: undefined,
              contentPreview: content,
              contentRef,
            }
          }),
        }))
        return snapshot
      },
    )

    let saveCount = 0
    const savedSnapshots: AppData[] = []
    let releaseFirstSave!: () => void
    const firstSave = new Promise<void>((resolve) => {
      releaseFirstSave = resolve
    })
    dbMocks.saveAppData.mockImplementation(async (value: unknown) => {
      saveCount += 1
      savedSnapshots.push(structuredClone(value as AppData))
      if (saveCount === 1) await firstSave
    })

    useAppStore.getState().setTheme('dark')
    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(() => expect(saveCount).toBe(1))

    useAppStore.getState().setTheme('light')
    await vi.advanceTimersByTimeAsync(300)
    expect(contentWriteCount).toBe(1)

    releaseFirstSave()
    await vi.waitFor(() => expect(saveCount).toBe(2))
    await expect(useAppStore.getState().flushLocalSaves()).resolves.toBeUndefined()

    expect(useAppStore.getState().data?.preferences.theme).toBe('light')
    expect(contentWriteCount).toBe(1)
    expect(writtenRefs).toEqual(['skill-chunk:write-1'])
    expect(savedSnapshots.at(-1)).toMatchObject({
      preferences: { theme: 'light' },
      skills: [
        {
          chunks: [
            expect.objectContaining({ contentRef: 'skill-chunk:write-1' }),
          ],
        },
      ],
    })
  })

  it('does not rebase a concurrently edited Skill onto an older ref', async () => {
    const data = resetStore()
    const inlineSkill = skill('inline-skill', {
      chunks: [
        {
          content: 'inline body',
          heading: 'Body',
          id: 'inline-chunk',
          keywords: [],
          tokenEstimate: 2,
        },
      ],
    })
    resetStore({ ...data, skills: [inlineSkill] })

    let contentWriteCount = 0
    dbMocks.persistAppDataSkillContents.mockImplementation(
      async (value: unknown) => {
        const snapshot = structuredClone(value as AppData)
        snapshot.skills = snapshot.skills.map((item) => ({
          ...item,
          chunks: item.chunks.map((chunk) => {
            const content = chunk.content?.trim()
            if (!content) return chunk
            const contentRef = `skill-chunk:write-${++contentWriteCount}`
            return {
              ...chunk,
              content: undefined,
              contentPreview: content,
              contentRef,
            }
          }),
        }))
        return snapshot
      },
    )

    let saveCount = 0
    const savedSnapshots: AppData[] = []
    let releaseFirstSave!: () => void
    const firstSave = new Promise<void>((resolve) => {
      releaseFirstSave = resolve
    })
    dbMocks.saveAppData.mockImplementation(async (value: unknown) => {
      saveCount += 1
      savedSnapshots.push(structuredClone(value as AppData))
      if (saveCount === 1) await firstSave
    })

    useAppStore.getState().setTheme('dark')
    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(() => expect(saveCount).toBe(1))

    const current = useAppStore.getState().data
    expect(current).toBeDefined()
    useAppStore.setState({
      data: {
        ...current!,
        skills: current!.skills.map((item) => ({
          ...item,
          chunks: item.chunks.map((chunk) => ({
            ...chunk,
            content: 'edited body',
            contentPreview: undefined,
            contentRef: undefined,
          })),
        })),
      },
    })
    useAppStore.getState().toggleCompact()
    await vi.advanceTimersByTimeAsync(300)

    releaseFirstSave()
    await vi.waitFor(() => expect(saveCount).toBe(2))
    await expect(useAppStore.getState().flushLocalSaves()).resolves.toBeUndefined()

    expect(contentWriteCount).toBe(2)
    expect(useAppStore.getState().data?.skills[0]?.chunks[0]).toMatchObject({
      contentPreview: 'edited body',
      contentRef: 'skill-chunk:write-2',
    })
    expect(savedSnapshots.at(-1)?.skills[0]?.chunks[0]).toMatchObject({
      contentRef: 'skill-chunk:write-2',
      content: undefined,
      contentPreview: 'edited body',
    })
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith([
      'skill-chunk:write-1',
    ])
  })

  it('cleans refs materialized after conflict recovery when the rebase save fails', async () => {
    const data = resetStore()
    const inlineSkill = skill('inline-skill', {
      chunks: [
        {
          content: 'inline body',
          heading: 'Body',
          id: 'inline-chunk',
          keywords: [],
          tokenEstimate: 2,
        },
      ],
    })
    resetStore({ ...data, skills: [inlineSkill] })
    await useAppStore.getState().flushLocalSaves()

    let contentWriteCount = 0
    dbMocks.persistAppDataSkillContents.mockImplementation(
      async (value: unknown) => {
        const snapshot = structuredClone(value as AppData)
        snapshot.skills = snapshot.skills.map((item) => ({
          ...item,
          chunks: item.chunks.map((chunk) => {
            const content = chunk.content?.trim()
            if (!content) return chunk
            const contentRef = `skill-chunk:conflict-${++contentWriteCount}`
            return {
              ...chunk,
              content: undefined,
              contentPreview: content,
              contentRef,
            }
          }),
        }))
        return snapshot
      },
    )

    const remote = structuredClone(useAppStore.getState().data)
    dbMocks.loadAppData.mockResolvedValue(remote as AppData)
    let saveCalls = 0
    dbMocks.saveAppData.mockImplementation(async () => {
      saveCalls += 1
      if (saveCalls === 1) {
        throw new AppDataWriteConflictError()
      }
      if (saveCalls === 2) {
        // A real user edit can arrive while conflict recovery is writing its
        // merged snapshot. It must remain inline until its next save owns the
        // newly materialized ref.
        useAppStore.getState().setTheme('light')
        return
      }
      if (saveCalls === 3) throw new Error('rebase save failed')
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    useAppStore.getState().setTheme('dark')
    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(() => expect(saveCalls).toBe(2))
    expect(contentWriteCount).toBe(1)
    expect(dbMocks.deleteSkillContentRefs).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(() => expect(saveCalls).toBe(3))

    expect(contentWriteCount).toBe(2)
    expect(useAppStore.getState().data?.preferences.theme).toBe('light')
    expect(dbMocks.deleteSkillContentRefs.mock.calls).toEqual([
      [['skill-chunk:conflict-2']],
    ])

    useAppStore.getState().setTheme('dark')
    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(() => expect(saveCalls).toBe(4))

    expect(contentWriteCount).toBe(3)
    expect(dbMocks.deleteSkillContentRefs.mock.calls).toEqual([
      [['skill-chunk:conflict-2']],
      [['skill-chunk:conflict-1']],
    ])
  })

  it('does not rematerialize Skill refs during a conversation deletion conflict recovery', async () => {
    const data = resetStore()
    const inlineSkill = skill('inline-skill', {
      chunks: [
        {
          content: 'inline body',
          heading: 'Body',
          id: 'inline-chunk',
          keywords: [],
          tokenEstimate: 2,
        },
      ],
    })
    resetStore({ ...data, skills: [inlineSkill] })
    await useAppStore.getState().flushLocalSaves()

    let contentWriteCount = 0
    dbMocks.persistAppDataSkillContents.mockImplementation(
      async (value: unknown) => {
        const snapshot = structuredClone(value as AppData)
        snapshot.skills = snapshot.skills.map((item) => ({
          ...item,
          chunks: item.chunks.map((chunk) => {
            const content = chunk.content?.trim()
            if (!content) return chunk
            const contentRef = `skill-chunk:conversation-conflict-${++contentWriteCount}`
            return {
              ...chunk,
              content: undefined,
              contentPreview: content,
              contentRef,
            }
          }),
        }))
        return snapshot
      },
    )

    const remote = structuredClone(useAppStore.getState().data)
    dbMocks.loadAppData.mockResolvedValue(remote as AppData)
    let saveCalls = 0
    dbMocks.saveAppData.mockImplementation(async () => {
      saveCalls += 1
      if (saveCalls === 1) {
        throw new AppDataWriteConflictError()
      }
      if (saveCalls === 2) {
        useAppStore.getState().setTheme('light')
        return
      }
      if (saveCalls === 3) throw new Error('conversation rebase save failed')
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const conversationId = data.conversations[0]!.id
    await expect(
      useAppStore.getState().deleteConversation(conversationId),
    ).resolves.toBe(true)
    expect(saveCalls).toBe(2)
    expect(contentWriteCount).toBe(1)
    expect(dbMocks.deleteSkillContentRefs).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(() => expect(saveCalls).toBe(3))

    expect(contentWriteCount).toBe(2)
    expect(useAppStore.getState().data?.preferences.theme).toBe('light')
    expect(dbMocks.deleteSkillContentRefs.mock.calls).toEqual([
      [['skill-chunk:conversation-conflict-2']],
    ])

    useAppStore.getState().setTheme('dark')
    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(() => expect(saveCalls).toBe(4))

    expect(contentWriteCount).toBe(3)
    expect(dbMocks.deleteSkillContentRefs.mock.calls).toEqual([
      [['skill-chunk:conversation-conflict-2']],
      [['skill-chunk:conversation-conflict-1']],
    ])
  })

  it('retries pending Skill ref cleanup during a no-op flush', async () => {
    const data = resetStore()
    const inlineSkill = skill('inline-skill', {
      chunks: [
        {
          content: 'inline body',
          heading: 'Body',
          id: 'inline-chunk',
          keywords: [],
          tokenEstimate: 2,
        },
      ],
    })
    resetStore({ ...data, skills: [inlineSkill] })

    let contentWriteCount = 0
    dbMocks.persistAppDataSkillContents.mockImplementation(
      async (value: unknown) => {
        const snapshot = structuredClone(value as AppData)
        snapshot.skills = snapshot.skills.map((item) => ({
          ...item,
          chunks: item.chunks.map((chunk) => {
            const content = chunk.content?.trim()
            if (!content) return chunk
            const contentRef = `skill-chunk:write-${++contentWriteCount}`
            return {
              ...chunk,
              content: undefined,
              contentPreview: content,
              contentRef,
            }
          }),
        }))
        return snapshot
      },
    )

    let saveCount = 0
    let releaseFirstSave!: () => void
    const firstSave = new Promise<void>((resolve) => {
      releaseFirstSave = resolve
    })
    dbMocks.saveAppData.mockImplementation(async () => {
      saveCount += 1
      if (saveCount === 1) await firstSave
    })

    let deleteAttempts = 0
    dbMocks.deleteSkillContentRefs.mockImplementation(async (refs: string[]) => {
      deleteAttempts += 1
      if (deleteAttempts === 1) throw new Error('cleanup unavailable')
      void refs
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    useAppStore.getState().setTheme('dark')
    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(() => expect(saveCount).toBe(1))

    const current = useAppStore.getState().data
    expect(current).toBeDefined()
    useAppStore.setState({
      data: {
        ...current!,
        skills: current!.skills.map((item) => ({
          ...item,
          chunks: item.chunks.map((chunk) => ({
            ...chunk,
            content: 'edited body',
            contentPreview: undefined,
            contentRef: undefined,
          })),
        })),
      },
    })
    useAppStore.getState().toggleCompact()
    await vi.advanceTimersByTimeAsync(300)

    releaseFirstSave()
    await vi.waitFor(() => expect(saveCount).toBe(2))

    expect(contentWriteCount).toBe(2)
    expect(useAppStore.getState().data?.skills[0]?.chunks[0]).toMatchObject({
      contentPreview: 'edited body',
      contentRef: 'skill-chunk:write-2',
    })
    expect(deleteAttempts).toBe(1)
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith([
      'skill-chunk:write-1',
    ])
    expect(consoleError).toHaveBeenCalledWith(
      '[app] stale skill ref cleanup failed',
    )

    await expect(useAppStore.getState().flushLocalSaves()).resolves.toBeUndefined()

    expect(deleteAttempts).toBe(2)
    expect(dbMocks.saveAppData).toHaveBeenCalledTimes(2)
    expect(contentWriteCount).toBe(2)

    await expect(useAppStore.getState().flushLocalSaves()).resolves.toBeUndefined()
    expect(deleteAttempts).toBe(2)
  })

  it('does not publish a stale canonical skill snapshot over a concurrent edit', async () => {
    const data = resetStore()
    const inlineSkill = skill('inline-skill', {
      chunks: [
        {
          content: 'inline body',
          heading: 'Body',
          id: 'inline-chunk',
          keywords: [],
          tokenEstimate: 2,
        },
      ],
    })
    resetStore({ ...data, skills: [inlineSkill] })

    let persistCalls = 0
    let releaseSecondPersist!: () => void
    const secondPersist = new Promise<void>((resolve) => {
      releaseSecondPersist = resolve
    })
    dbMocks.persistAppDataSkillContents.mockImplementation(
      async (value: unknown) => {
        persistCalls += 1
        if (persistCalls === 2) await secondPersist
        return structuredClone(value as AppData)
      },
    )

    let releaseFirstSave!: () => void
    const firstSave = new Promise<void>((resolve) => {
      releaseFirstSave = resolve
    })
    dbMocks.saveAppData.mockImplementationOnce(async () => {
      await firstSave
    })

    useAppStore.getState().setTheme('dark')
    await vi.advanceTimersByTimeAsync(300)
    expect(dbMocks.saveAppData).toHaveBeenCalledOnce()

    useAppStore.getState().setTheme('light')
    await vi.advanceTimersByTimeAsync(300)
    releaseFirstSave()
    await vi.waitFor(() => expect(persistCalls).toBe(2))

    expect(useAppStore.getState().data?.preferences.theme).toBe('light')

    releaseSecondPersist()
    await expect(useAppStore.getState().flushLocalSaves()).resolves.toBeUndefined()
    expect(useAppStore.getState().data?.preferences.theme).toBe('light')
    expect(dbMocks.saveAppData).toHaveBeenLastCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({ theme: 'light' }),
      }),
    )
  })

  it('commits a language only after its locale chunk loads', async () => {
    const data = freshData()
    data.preferences.language = 'en-US'
    resetStore(data)
    await i18nMocks.actualLoadLocale!('en-US')
    await i18nMocks.actualLoadLocale!('ar-SA')
    setRuntimeLocale('en-US')
    const documentStub = { documentElement: { dir: 'ltr', lang: 'en-US' } }
    vi.stubGlobal('document', documentStub)
    let resolveLocaleLoad!: () => void
    const localeLoad = new Promise<void>((resolve) => {
      resolveLocaleLoad = resolve
    })
    i18nMocks.loadLocale.mockReturnValueOnce(localeLoad)

    const change = useAppStore.getState().setLanguage('ar-SA')

    expect(useAppStore.getState().data?.preferences.language).toBe('en-US')
    expect(documentStub.documentElement).toEqual({ dir: 'ltr', lang: 'en-US' })
    expect(rt('button.clearCloudData')).toBe(
      translate('en-US', 'button.clearCloudData'),
    )

    resolveLocaleLoad()
    await change

    expect(useAppStore.getState().data?.preferences.language).toBe('ar-SA')
    expect(documentStub.documentElement).toEqual({ dir: 'rtl', lang: 'ar-SA' })
    expect(rt('button.clearCloudData')).toBe(
      translate('ar-SA', 'button.clearCloudData'),
    )
  })

  it('lets only the latest pending language request commit', async () => {
    const data = freshData()
    data.preferences.language = 'en-US'
    resetStore(data)
    await i18nMocks.actualLoadLocale!('en-US')
    await i18nMocks.actualLoadLocale!('ar-SA')
    await i18nMocks.actualLoadLocale!('zh-CN')
    setRuntimeLocale('en-US')
    const documentStub = { documentElement: { dir: 'ltr', lang: 'en-US' } }
    vi.stubGlobal('document', documentStub)
    let resolveArabic!: () => void
    let resolveChinese!: () => void
    const arabicLoad = new Promise<void>((resolve) => {
      resolveArabic = resolve
    })
    const chineseLoad = new Promise<void>((resolve) => {
      resolveChinese = resolve
    })
    i18nMocks.loadLocale.mockImplementation((locale: string) =>
      locale === 'ar-SA' ? arabicLoad : chineseLoad,
    )

    const arabicChange = useAppStore.getState().setLanguage('ar-SA')
    const chineseChange = useAppStore.getState().setLanguage('zh-CN')
    resolveArabic()
    await arabicChange

    expect(useAppStore.getState().data?.preferences.language).toBe('en-US')
    expect(documentStub.documentElement).toEqual({ dir: 'ltr', lang: 'en-US' })

    resolveChinese()
    await chineseChange

    expect(useAppStore.getState().data?.preferences.language).toBe('zh-CN')
    expect(documentStub.documentElement).toEqual({ dir: 'ltr', lang: 'zh-CN' })
    expect(rt('button.clearCloudData')).toBe(
      translate('zh-CN', 'button.clearCloudData'),
    )
  })

  it('does not let a pending language request overwrite reset data', async () => {
    const data = freshData()
    data.preferences.language = 'en-US'
    resetStore(data)
    await i18nMocks.actualLoadLocale!('en-US')
    await i18nMocks.actualLoadLocale!('fr-FR')
    setRuntimeLocale('en-US')
    const documentStub = { documentElement: { dir: 'ltr', lang: 'en-US' } }
    vi.stubGlobal('document', documentStub)
    let resolveLocaleLoad!: () => void
    i18nMocks.loadLocale.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveLocaleLoad = resolve
      }),
    )

    const staleChange = useAppStore.getState().setLanguage('fr-FR')
    await vi.waitFor(() => expect(i18nMocks.loadLocale).toHaveBeenCalledOnce())
    await useAppStore.getState().resetAll()
    const resetData = useAppStore.getState().data
    const resetLanguage = resetData?.preferences.language

    resolveLocaleLoad()
    await staleChange

    expect(useAppStore.getState().data).toBe(resetData)
    expect(useAppStore.getState().data?.preferences.language).toBe(resetLanguage)
    expect(documentStub.documentElement).toEqual({ dir: 'ltr', lang: 'en-US' })
  })

  it('cancels an in-flight system language refresh when the App listener owner unmounts', async () => {
    const data = freshData()
    data.preferences.language = 'system'
    resetStore(data)
    await i18nMocks.actualLoadLocale!('en-US')
    await i18nMocks.actualLoadLocale!('ar-SA')
    setRuntimeLocale('en-US')
    const navigatorStub = {
      language: 'ar-SA',
      languages: ['ar-SA'],
      onLine: true,
    }
    vi.stubGlobal('navigator', navigatorStub)
    const documentStub = { documentElement: { dir: 'ltr', lang: 'en-US' } }
    vi.stubGlobal('document', documentStub)

    let resolveLocaleLoad!: () => void
    i18nMocks.loadLocale.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveLocaleLoad = resolve
        }),
    )

    const listeners = new Map<string, EventListener>()
    const target = {
      addEventListener: (type: string, listener: EventListener) => {
        listeners.set(type, listener)
      },
      removeEventListener: (type: string) => {
        listeners.delete(type)
      },
    }
    const languageRefreshController = new AbortController()
    let refresh!: Promise<void>
    const cleanup = installAppGlobalListeners(target, {
      onLanguageChange: () => {
        refresh = useAppStore
          .getState()
          .refreshSystemLanguage(languageRefreshController.signal)
      },
      onKeyDown: vi.fn(),
    })

    listeners.get('languagechange')?.(new Event('languagechange'))
    await vi.waitFor(() => expect(i18nMocks.loadLocale).toHaveBeenCalledWith('ar-SA'))

    languageRefreshController.abort()
    cleanup()
    resolveLocaleLoad()
    await refresh

    expect(documentStub.documentElement).toEqual({ dir: 'ltr', lang: 'en-US' })
    expect(useAppStore.getState().data?.preferences.language).toBe('system')
    expect(dbMocks.saveAppData).not.toHaveBeenCalled()
    expect(listeners.size).toBe(0)
  })

  it('lets the latest App languagechange refresh win over an older event', async () => {
    const data = freshData()
    data.preferences.language = 'system'
    resetStore(data)
    await i18nMocks.actualLoadLocale!('en-US')
    await i18nMocks.actualLoadLocale!('ar-SA')
    await i18nMocks.actualLoadLocale!('zh-CN')
    setRuntimeLocale('en-US')
    const navigatorStub = {
      language: 'ar-SA',
      languages: ['ar-SA'],
      onLine: true,
    }
    vi.stubGlobal('navigator', navigatorStub)
    const documentStub = { documentElement: { dir: 'ltr', lang: 'en-US' } }
    vi.stubGlobal('document', documentStub)

    let resolveArabic!: () => void
    let resolveChinese!: () => void
    const arabicLoad = new Promise<void>((resolve) => {
      resolveArabic = resolve
    })
    const chineseLoad = new Promise<void>((resolve) => {
      resolveChinese = resolve
    })
    i18nMocks.loadLocale.mockImplementation((locale: string) =>
      locale === 'ar-SA' ? arabicLoad : chineseLoad,
    )

    const listeners = new Map<string, EventListener>()
    const target = {
      addEventListener: (type: string, listener: EventListener) => {
        listeners.set(type, listener)
      },
      removeEventListener: (type: string) => {
        listeners.delete(type)
      },
    }
    const languageRefreshController = new AbortController()
    const refreshes: Promise<void>[] = []
    const cleanup = installAppGlobalListeners(target, {
      onLanguageChange: () => {
        refreshes.push(
          useAppStore
            .getState()
            .refreshSystemLanguage(languageRefreshController.signal),
        )
      },
      onKeyDown: vi.fn(),
    })

    const languageListener = listeners.get('languagechange')!
    languageListener(new Event('languagechange'))
    navigatorStub.language = 'zh-CN'
    navigatorStub.languages = ['zh-CN']
    languageListener(new Event('languagechange'))
    await vi.waitFor(() => expect(refreshes).toHaveLength(2))

    resolveChinese()
    await refreshes[1]
    expect(documentStub.documentElement).toEqual({ dir: 'ltr', lang: 'zh-CN' })

    resolveArabic()
    await refreshes[0]
    expect(documentStub.documentElement).toEqual({ dir: 'ltr', lang: 'zh-CN' })
    expect(useAppStore.getState().data?.preferences.language).toBe('system')
    expect(dbMocks.saveAppData).not.toHaveBeenCalled()

    languageRefreshController.abort()
    cleanup()
  })

  it('ignores a stale locale failure after a newer request commits', async () => {
    const data = freshData()
    data.preferences.language = 'en-US'
    resetStore(data)
    await i18nMocks.actualLoadLocale!('en-US')
    await i18nMocks.actualLoadLocale!('zh-CN')
    setRuntimeLocale('en-US')
    const documentStub = { documentElement: { dir: 'ltr', lang: 'en-US' } }
    vi.stubGlobal('document', documentStub)
    const staleError = new Error('C:\\private\\stale-locale-secret')
    let rejectArabic!: (error: unknown) => void
    let resolveChinese!: () => void
    const arabicLoad = new Promise<void>((_resolve, reject) => {
      rejectArabic = reject
    })
    const chineseLoad = new Promise<void>((resolve) => {
      resolveChinese = resolve
    })
    i18nMocks.loadLocale.mockImplementation((locale: string) =>
      locale === 'ar-SA' ? arabicLoad : chineseLoad,
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const staleChange = useAppStore.getState().setLanguage('ar-SA')
    const currentChange = useAppStore.getState().setLanguage('zh-CN')
    resolveChinese()
    await currentChange
    rejectArabic(staleError)
    await staleChange

    expect(useAppStore.getState().data?.preferences.language).toBe('zh-CN')
    expect(documentStub.documentElement).toEqual({ dir: 'ltr', lang: 'zh-CN' })
    expect(useAppStore.getState().toasts).toHaveLength(0)
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('refreshes a system locale after browser languages change without rewriting preferences', async () => {
    const data = freshData()
    data.preferences.language = 'system'
    resetStore(data)
    await i18nMocks.actualLoadLocale!('en-US')
    await i18nMocks.actualLoadLocale!('ar-SA')
    setRuntimeLocale('en-US')
    const navigatorStub = {
      language: 'en-US',
      languages: ['en-US'],
      onLine: true,
    }
    vi.stubGlobal('navigator', navigatorStub)
    const documentStub = { documentElement: { dir: 'ltr', lang: 'en-US' } }
    vi.stubGlobal('document', documentStub)
    navigatorStub.language = 'ar-SA'
    navigatorStub.languages = ['ar-SA']

    await useAppStore.getState().refreshSystemLanguage()

    expect(useAppStore.getState().data?.preferences.language).toBe('system')
    expect(documentStub.documentElement).toEqual({ dir: 'rtl', lang: 'ar-SA' })
    expect(rt('button.clearCloudData')).toBe(
      translate('ar-SA', 'button.clearCloudData'),
    )
    expect(dbMocks.saveAppData).not.toHaveBeenCalled()

    data.preferences.language = 'zh-CN'
    resetStore(data)
    i18nMocks.loadLocale.mockClear()
    documentStub.documentElement = { dir: 'ltr', lang: 'zh-CN' }
    await useAppStore.getState().refreshSystemLanguage()
    expect(i18nMocks.loadLocale).not.toHaveBeenCalled()
    expect(documentStub.documentElement).toEqual({ dir: 'ltr', lang: 'zh-CN' })
  })

  it('keeps the previous locale and reports a stable localized notice on load failure', async () => {
    const data = freshData()
    data.preferences.language = 'en-US'
    resetStore(data)
    await i18nMocks.actualLoadLocale!('en-US')
    setRuntimeLocale('en-US')
    const documentStub = { documentElement: { dir: 'ltr', lang: 'en-US' } }
    vi.stubGlobal('document', documentStub)
    const sentinel = 'C:\\private\\locale-secret-token'
    const error = new Error(sentinel)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    i18nMocks.loadLocale.mockRejectedValueOnce(error)

    await useAppStore.getState().setLanguage('fr-FR')
    await Promise.resolve()

    const notice = useAppStore.getState().toasts.at(-1)?.message ?? ''
    expect(useAppStore.getState().data?.preferences.language).toBe('en-US')
    expect(documentStub.documentElement).toEqual({ dir: 'ltr', lang: 'en-US' })
    expect(rt('button.clearCloudData')).toBe(
      translate('en-US', 'button.clearCloudData'),
    )
    expect(notice).toBe(translate('en-US', 'notice.localeLoadFailed'))
    expect(notice).not.toContain(sentinel)
    expect(notice).not.toContain(error.message)
    expect(notice).not.toContain(String(error))
    expect(consoleError).toHaveBeenCalledWith('[app] locale load failed')
    expectConsoleErrorDoesNotExpose(consoleError, error)
  })

  it('contains locale-load notification failures and keeps the previous locale', async () => {
    const data = freshData()
    data.preferences.language = 'en-US'
    resetStore(data)
    await i18nMocks.actualLoadLocale!('en-US')
    setRuntimeLocale('en-US')
    const error = new Error('locale load failed')
    i18nMocks.loadLocale.mockRejectedValueOnce(error)
    useAppStore.setState({
      notify: () => {
        throw new Error('notification channel unavailable')
      },
    })

    await expect(useAppStore.getState().setLanguage('fr-FR')).resolves.toBeUndefined()

    expect(useAppStore.getState().data?.preferences.language).toBe('en-US')
  })

  it('does not publish provider deletion when the secret/data transition fails', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const beforeData = structuredClone(data)
    const beforeKeys = { ...useAppStore.getState().keys }
    secretMocks.commitProviderSecretSnapshotWithAppData.mockRejectedValueOnce(
      new Error('transition failed'),
    )

    await expect(
      useAppStore.getState().deleteProvider(providerId),
    ).resolves.toBe(false)

    expect(useAppStore.getState().data).toEqual(beforeData)
    expect(useAppStore.getState().keys).toEqual(beforeKeys)
    expect(dbMocks.saveAppData).not.toHaveBeenCalledWith(
      expect.objectContaining({ providers: [] }),
    )
    expect(useAppStore.getState().toasts.at(-1)?.message).toBe(
      'Save failed. Try again.',
    )
    await useAppStore.getState().setSyncPassphrase('still-usable')
    expect(useAppStore.getState().syncPassphrase).toBe('still-usable')
  })

  it('contains provider deletion notification failures after a durable error', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const beforeKeys = { ...useAppStore.getState().keys }
    secretMocks.commitProviderSecretSnapshotWithAppData.mockRejectedValueOnce(
      new Error('transition failed'),
    )
    useAppStore.setState({
      notify: () => {
        throw new Error('notification channel unavailable')
      },
    })

    await expect(useAppStore.getState().deleteProvider(providerId)).resolves.toBe(false)

    expect(useAppStore.getState().data).toBe(data)
    expect(useAppStore.getState().keys).toEqual(beforeKeys)
  })

  it('deletes a Provider through the enabled fallback and queues one durable auto-sync', async () => {
    const data = freshData()
    const base = data.providers[0]
    const removed = { ...base, id: 'removed-provider', model: 'removed-model' }
    const disabled = {
      ...base,
      enabled: false,
      id: 'disabled-provider',
      model: 'disabled-model',
      name: 'Disabled provider',
    }
    const enabled = {
      ...base,
      enabled: true,
      id: 'enabled-provider',
      model: 'enabled-model',
      models: ['enabled-model'],
      name: 'Enabled provider',
    }
    const conversation = {
      ...data.conversations[0],
      model: removed.model,
      providerId: removed.id,
    }
    data.providers = [removed, disabled, enabled]
    data.conversations = [conversation]
    data.preferences.activeConversationId = conversation.id
    data.sync = { ...data.sync, autoSync: true, mode: 'gist' }
    resetStore(data)
    useAppStore.setState({
      githubToken: 'github-token',
      keys: {
        [disabled.id]: 'disabled-key',
        [enabled.id]: 'enabled-key',
        [removed.id]: 'removed-key',
      },
      providerConnectivityResults: {
        [removed.id]: {
          field: 'providerKey',
          message: 'stale deleted-provider diagnostic',
          retryable: true,
          tone: 'error',
        },
      },
      syncPassphrase: 'passphrase',
    })

    let finishSync: ((result: SyncResult) => void) | undefined
    syncMocks.performSync.mockImplementationOnce(
      (published: AppData, options: { providerKeys: Record<string, string> }) =>
        new Promise<SyncResult>((resolve) => {
          finishSync = () =>
            resolve({
              ...syncResult(published),
              remoteAccepted: false,
              secrets: { providerKeys: options.providerKeys },
            })
        }),
    )

    await useAppStore.getState().deleteProvider(removed.id)
    await vi.waitFor(() => expect(syncMocks.performSync).toHaveBeenCalledTimes(1))

    const current = useAppStore.getState()
    expect(current.data?.providers.map(({ id }) => id)).toEqual([
      disabled.id,
      enabled.id,
    ])
    expect(current.data?.conversations[0]).toMatchObject({
      model: enabled.model,
      providerId: enabled.id,
    })
    expect(current.keys).toEqual({
      [disabled.id]: 'disabled-key',
      [enabled.id]: 'enabled-key',
    })
    expect(current.providerConnectivityResults[removed.id]).toBeUndefined()
    expect(syncMocks.performSync.mock.calls[0]?.[1]).toMatchObject({
      providerKeys: {
        [disabled.id]: 'disabled-key',
        [enabled.id]: 'enabled-key',
      },
    })

    finishSync?.(syncResult(current.data!))
    await vi.waitFor(() => expect(useAppStore.getState().syncing).toBe(false))
  })

  it('publishes a changed sync passphrase only after durable storage and queues one current-owner sync', async () => {
    const data = resetStore()
    const previousUpdatedAt = data.updatedAt
    useAppStore.setState({
      data: {
        ...data,
        sync: { ...data.sync, autoSync: true, mode: 'gist' },
      },
      githubToken: 'github-token',
      syncPassphrase: 'old-passphrase',
    })

    let resolveWrite!: () => void
    secretMocks.setSyncPassphrase.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          resolveWrite = () => resolve(undefined)
        }),
    )
    syncMocks.performSync.mockImplementationOnce(async (latest: AppData) => ({
      ...syncResult(latest),
      remoteAccepted: false,
    }))

    const mutation = useAppStore
      .getState()
      .setSyncPassphrase('new-passphrase')
    await vi.waitFor(() =>
      expect(secretMocks.setSyncPassphrase).toHaveBeenCalledWith(
        'new-passphrase',
      ),
    )
    expect(useAppStore.getState().syncPassphrase).toBe('old-passphrase')
    expect(syncMocks.performSync).not.toHaveBeenCalled()

    resolveWrite()
    await mutation
    await vi.waitFor(() =>
      expect(syncMocks.performSync).toHaveBeenCalledTimes(1),
    )

    expect(useAppStore.getState().syncPassphrase).toBe('new-passphrase')
    expect(useAppStore.getState().data?.updatedAt).toBeGreaterThan(
      previousUpdatedAt,
    )
    expect(syncMocks.performSync).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ encryptionPassphrase: 'new-passphrase' }),
    )
  })

  it('keeps the committed sync passphrase and skips sync when durable storage rejects the change', async () => {
    const data = resetStore()
    useAppStore.setState({
      data: {
        ...data,
        sync: { ...data.sync, autoSync: true, mode: 'gist' },
      },
      githubToken: 'github-token',
      syncPassphrase: 'old-passphrase',
    })
    secretMocks.setSyncPassphrase.mockRejectedValueOnce(
      new Error('passphrase write blocked'),
    )

    await expect(
      useAppStore.getState().setSyncPassphrase('new-passphrase'),
    ).rejects.toThrow('passphrase write blocked')

    expect(useAppStore.getState().syncPassphrase).toBe('old-passphrase')
    expect(useAppStore.getState().data?.updatedAt).toBe(data.updatedAt)
    expect(syncMocks.performSync).not.toHaveBeenCalled()
  })

  it('keeps provider deletion behind an active sync commit', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')

    let resolveCommit: (() => void) | undefined
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (...args: unknown[]) => {
        const target = args[2] as AppData
        return new Promise<AppData>((resolve) => {
          resolveCommit = () => resolve(target)
        })
      },
    )

    const sync = useAppStore.getState().syncNow()
    await vi.waitFor(() =>
      expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledTimes(1),
    )
    const deletion = useAppStore.getState().deleteProvider(providerId)
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledTimes(1)

    resolveCommit?.()
    await sync
    await deletion
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledTimes(2)
    expect(useAppStore.getState().data?.providers).toEqual([])
    expect(useAppStore.getState().keys).toEqual({})
  })

  it('keeps provider deletion behind a durable provider-key write', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    let resolveWrite: (() => void) | undefined
    secretMocks.setProviderKey.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          resolveWrite = () => resolve(undefined)
        }),
    )

    const mutation = useAppStore.getState().saveProviderKey(providerId, 'new-key')
    await vi.waitFor(() =>
      expect(secretMocks.setProviderKey).toHaveBeenCalledWith(providerId, 'new-key'),
    )
    const deletion = useAppStore.getState().deleteProvider(providerId)
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).not.toHaveBeenCalled()

    resolveWrite?.()
    await mutation
    await deletion
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().data?.providers).toEqual([])
    expect(useAppStore.getState().keys).toEqual({})
  })

  it('does not delete a Provider while an admitted generation is deriving its proxy token', async () => {
    const data = freshData()
    const provider = data.providers[0]
    data.providers[0] = {
      ...provider,
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'proxy-passphrase' })

    let releaseDerivation!: (value: string) => void
    accessKeyMocks.accessKeyFromPassword.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseDerivation = resolve
        }),
    )

    const generation = useAppStore
      .getState()
      .sendMessage('generation keeps Provider ownership')
    await vi.waitFor(() =>
      expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledOnce(),
    )

    await useAppStore.getState().deleteProvider(provider.id)

    expect(
      secretMocks.commitProviderSecretSnapshotWithAppData,
    ).not.toHaveBeenCalled()
    expect(
      useAppStore.getState().data?.providers.some(({ id }) => id === provider.id),
    ).toBe(true)

    releaseDerivation('proxy-token')
    await generation
    expect(runtime.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ id: provider.id }),
      }),
    )
  })

  it('does not admit generation while Provider deletion owns its durable transaction', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const messagesBefore = structuredClone(data.conversations[0].messages)
    let releaseDeletion!: () => void
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await new Promise<void>((resolve) => {
          releaseDeletion = resolve
        })
        return persist(target)
      },
    )

    const deletion = useAppStore.getState().deleteProvider(providerId)
    await vi.waitFor(() =>
      expect(
        secretMocks.commitProviderSecretSnapshotWithAppData,
      ).toHaveBeenCalledOnce(),
    )

    let generationOwnerPublished = false
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.sending || state.streaming) generationOwnerPublished = true
    })
    const generation = useAppStore
      .getState()
      .sendMessage('must wait for Provider deletion')
    await Promise.resolve()

    expect(generationOwnerPublished).toBe(false)
    expect(runtime.streamChat).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.conversations[0].messages).toEqual(
      messagesBefore,
    )

    releaseDeletion()
    await deletion
    await expect(generation).resolves.toBe(false)
    unsubscribe()
    expect(runtime.streamChat).not.toHaveBeenCalled()
  })

  it('does not delete a Provider while offline replay is persisting its claim', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('queued Provider owner')
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    secretMocks.commitProviderSecretSnapshotWithAppData.mockClear()

    let releaseClaimSave!: () => void
    dbMocks.saveAppData.mockImplementationOnce(
      async (snapshot: unknown) => {
        const assistant = (snapshot as AppData).conversations[0].messages.at(-1)
        expect(assistant).toMatchObject({
          offlineReplayClaim: expect.objectContaining({ owner: expect.any(String) }),
          status: 'streaming',
        })
        await new Promise<void>((resolve) => {
          releaseClaimSave = resolve
        })
      },
    )

    navigatorStub.onLine = true
    const replay = useAppStore.getState().flushOfflineQueue()
    await vi.waitFor(() => expect(releaseClaimSave).toBeTypeOf('function'))
    expect(useAppStore.getState()).toMatchObject({
      abortController: null,
      streaming: false,
    })

    await useAppStore.getState().deleteProvider(providerId)

    expect(
      secretMocks.commitProviderSecretSnapshotWithAppData.mock.calls.some(
        ([, , target]) =>
          !(target as AppData).providers.some(({ id }) => id === providerId),
      ),
    ).toBe(false)
    expect(
      useAppStore.getState().data?.providers.some(({ id }) => id === providerId),
    ).toBe(true)
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: appT(data, 'settings.providerMutationBusy'),
      tone: 'info',
    })

    releaseClaimSave()
    await replay
    expect(streamMocks.streamAssistantText).toHaveBeenCalledOnce()
  })

  it('does not admit offline replay while Provider deletion owns its durable transaction', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('queued behind Provider deletion')
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseDeletion!: () => void
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await new Promise<void>((resolve) => {
          releaseDeletion = resolve
        })
        return persist(target)
      },
    )
    const deletion = useAppStore.getState().deleteProvider(providerId)
    await vi.waitFor(() => expect(releaseDeletion).toBeTypeOf('function'))

    navigatorStub.onLine = true
    await useAppStore.getState().flushOfflineQueue()

    expect(streamMocks.streamAssistantText).not.toHaveBeenCalled()
    expect(
      dbMocks.saveAppData.mock.calls.some(([snapshot]) =>
        (snapshot as AppData).conversations.some((conversation) =>
          conversation.messages.some((message) => message.offlineReplayClaim),
        ),
      ),
    ).toBe(false)

    releaseDeletion()
    await deletion
  })

  it('serializes concurrent Provider deletions without dropping the later request', async () => {
    const data = freshData()
    const first = data.providers[0]
    const second = { ...first, id: 'second-provider', name: 'Second Provider' }
    data.providers = [first, second]
    resetStore(data)
    let releaseFirst!: () => void
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
        return persist(target)
      },
    )

    const firstDeletion = useAppStore.getState().deleteProvider(first.id)
    await vi.waitFor(() => expect(releaseFirst).toBeTypeOf('function'))
    let secondSettled = false
    const secondDeletion = useAppStore
      .getState()
      .deleteProvider(second.id)
      .finally(() => {
        secondSettled = true
      })
    await Promise.resolve()

    expect(secondSettled).toBe(false)
    expect(
      secretMocks.commitProviderSecretSnapshotWithAppData,
    ).toHaveBeenCalledOnce()

    releaseFirst()
    await Promise.all([firstDeletion, secondDeletion])
    expect(
      secretMocks.commitProviderSecretSnapshotWithAppData,
    ).toHaveBeenCalledTimes(2)
    expect(useAppStore.getState().data?.providers).toEqual([])
  })

  it('releases Provider deletion ownership after a durable failure', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    secretMocks.commitProviderSecretSnapshotWithAppData.mockRejectedValueOnce(
      new Error('provider deletion failed'),
    )

    await useAppStore.getState().deleteProvider(providerId)
    expect(
      useAppStore.getState().data?.providers.some(({ id }) => id === providerId),
    ).toBe(true)

    await expect(
      useAppStore.getState().sendMessage('generation after failed deletion'),
    ).resolves.toBe(true)
    expect(runtime.streamChat).toHaveBeenCalledOnce()
  })

  it('preserves concurrent AppData changes while provider deletion is committing', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    let releaseCommit!: () => void
    const commitBlocked = new Promise<void>((resolve) => {
      releaseCommit = resolve
    })
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await commitBlocked
        return persist(target)
      },
    )

    const deletion = useAppStore.getState().deleteProvider(providerId)
    await vi.waitFor(() =>
      expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
    )

    useAppStore.getState().setTheme('dark')
    expect(useAppStore.getState().data?.preferences.theme).toBe('dark')
    await useAppStore.getState().flushLocalSaves()
    expect(
      dbMocks.saveAppData.mock.calls.some(
        ([snapshot]) => (snapshot as AppData).preferences.theme === 'dark',
      ),
    ).toBe(false)
    releaseCommit()
    await deletion
    await vi.advanceTimersByTimeAsync(300)

    expect(useAppStore.getState().data?.preferences.theme).toBe('dark')
    expect(useAppStore.getState().data?.providers).toEqual([])
    expect(useAppStore.getState().keys).toEqual({})
    expect(dbMocks.saveAppData).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({ theme: 'dark' }),
        providers: [],
      }),
    )
  })

  it('keeps ordinary saves debounced after provider deletion deferral', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    let releaseCommit!: () => void
    const commitBlocked = new Promise<void>((resolve) => {
      releaseCommit = resolve
    })
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await commitBlocked
        return persist(target)
      },
    )
    dbMocks.saveAppData.mockClear()

    const deletion = useAppStore.getState().deleteProvider(providerId)
    await vi.waitFor(() =>
      expect(
        secretMocks.commitProviderSecretSnapshotWithAppData,
      ).toHaveBeenCalledOnce(),
    )

    useAppStore.getState().setTheme('dark')
    releaseCommit()
    await deletion
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve()

    expect(dbMocks.saveAppData).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(299)
    expect(dbMocks.saveAppData).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledTimes(3))
    expect(dbMocks.saveAppData).toHaveBeenLastCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({ theme: 'dark' }),
        providers: [],
      }),
    )
  })

  it('replays concurrent AppData changes when provider deletion fails', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const previousKeys = { ...useAppStore.getState().keys }
    let rejectCommit!: () => void
    const commitBlocked = new Promise<void>((_resolve, reject) => {
      rejectCommit = () => reject(new Error('transition failed'))
    })
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async () => {
        await commitBlocked
        throw new Error('unreachable provider deletion commit')
      },
    )

    const deletion = useAppStore.getState().deleteProvider(providerId)
    await vi.waitFor(() =>
      expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
    )

    useAppStore.getState().setTheme('dark')
    expect(useAppStore.getState().data?.preferences.theme).toBe('dark')
    rejectCommit()
    await deletion
    await vi.advanceTimersByTimeAsync(300)

    expect(useAppStore.getState().data?.preferences.theme).toBe('dark')
    expect(useAppStore.getState().data?.providers.map(({ id }) => id)).toContain(
      providerId,
    )
    expect(useAppStore.getState().keys).toEqual(previousKeys)
    expect(dbMocks.saveAppData).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({ theme: 'dark' }),
        providers: expect.arrayContaining([
          expect.objectContaining({ id: providerId }),
        ]),
      }),
    )
  })

  it('does not save a queued Provider key after that Provider was deleted', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    let releaseDeletion!: () => void
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await new Promise<void>((resolve) => {
          releaseDeletion = resolve
        })
        return persist(target)
      },
    )

    const deletion = useAppStore.getState().deleteProvider(providerId)
    await vi.waitFor(() =>
      expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledTimes(1),
    )
    const keyWrite = useAppStore.getState().saveProviderKey(providerId, 'orphan-key')
    expect(secretMocks.setProviderKey).not.toHaveBeenCalled()

    releaseDeletion()
    await Promise.all([deletion, keyWrite])

    expect(secretMocks.setProviderKey).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.providers).toEqual([])
    expect(useAppStore.getState().keys).toEqual({})
  })

  it('keeps toast state bounded and dismisses notifications on schedule', () => {
    const store = useAppStore.getState()
    for (let index = 0; index < 5; index += 1) {
      store.notify(`toast-${index}`, index % 2 ? 'error' : 'info')
    }
    expect(useAppStore.getState().toasts).toHaveLength(4)
    const first = useAppStore.getState().toasts[0].id
    store.dismissToast(first)
    expect(useAppStore.getState().toasts.some((toast) => toast.id === first)).toBe(false)
    vi.advanceTimersByTime(4200)
    expect(useAppStore.getState().toasts).toHaveLength(0)
  })

  it('rolls back page flush listeners when visibility registration fails', async () => {
    const data = freshData()
    const windowListeners = new Map<string, () => void>()
    const documentListeners = new Map<string, () => void>()
    const failVisibilityRegistration = true
    const windowStub = {
      addEventListener: vi.fn((event: string, listener: () => void) => {
        windowListeners.set(event, listener)
      }),
      removeEventListener: vi.fn((event: string, listener: () => void) => {
        if (windowListeners.get(event) === listener) windowListeners.delete(event)
      }),
    }
    const documentStub = {
      addEventListener: vi.fn((event: string, listener: () => void) => {
        if (failVisibilityRegistration && event === 'visibilitychange') {
          throw new Error('visibility listener unavailable')
        }
        documentListeners.set(event, listener)
      }),
      removeEventListener: vi.fn((event: string, listener: () => void) => {
        if (documentListeners.get(event) === listener) documentListeners.delete(event)
      }),
      documentElement: { dir: '', lang: '' },
      visibilityState: 'visible',
    }
    vi.stubGlobal('window', windowStub)
    vi.stubGlobal('document', documentStub)
    dbMocks.loadAppData.mockResolvedValueOnce(data as never)
    useAppStore.setState({ status: 'loading' })

    await beginMockedHydration('page flush listener rollback')

    expect(useAppStore.getState().status).toBe('error')
    expect(windowListeners.has('pagehide')).toBe(false)
    expect(documentListeners.size).toBe(0)
    expect(windowStub.removeEventListener).toHaveBeenCalledWith(
      'pagehide',
      expect.any(Function),
    )
  })

  it('rolls back online replay registration when the online listener fails', async () => {
    const data = freshData()
    const windowListeners = new Map<string, () => void>()
    const documentListeners = new Map<string, () => void>()
    const windowStub = {
      addEventListener: vi.fn((event: string, listener: () => void) => {
        if (event === 'online') {
          throw new Error('online listener unavailable')
        }
        windowListeners.set(event, listener)
      }),
      removeEventListener: vi.fn((event: string, listener: () => void) => {
        if (windowListeners.get(event) === listener) windowListeners.delete(event)
      }),
    }
    const documentStub = {
      addEventListener: vi.fn((event: string, listener: () => void) => {
        documentListeners.set(event, listener)
      }),
      removeEventListener: vi.fn((event: string, listener: () => void) => {
        if (documentListeners.get(event) === listener) documentListeners.delete(event)
      }),
      documentElement: { dir: '', lang: '' },
      visibilityState: 'visible',
    }
    vi.stubGlobal('window', windowStub)
    vi.stubGlobal('document', documentStub)
    dbMocks.loadAppData.mockResolvedValue(data as never)

    useAppStore.setState({ status: 'loading' })
    await beginMockedHydration('online replay listener rollback')

    expect(useAppStore.getState().status).toBe('error')
    expect(windowListeners.has('online')).toBe(false)
    expect(windowListeners.has('pagehide')).toBe(false)
    expect(documentListeners.has('visibilitychange')).toBe(false)
    expect(windowStub.removeEventListener).toHaveBeenCalledWith(
      'online',
      expect.any(Function),
    )

    useAppStore.setState({ status: 'loading' })
    await beginMockedHydration('online replay listener rollback retry')

    expect(useAppStore.getState().status).toBe('error')
    expect(
      windowStub.addEventListener.mock.calls.filter(([event]) => event === 'online'),
    ).toHaveLength(2)
    expect(windowStub.removeEventListener).toHaveBeenCalledTimes(4)
    expect(windowListeners.has('online')).toBe(false)
    expect(windowListeners.has('pagehide')).toBe(false)
    expect(documentListeners.has('visibilitychange')).toBe(false)
  })

  it('initializes stored data, flushes deferred pagehide saves, and reports initialization failures', async () => {
    const data = freshData()
    dbMocks.loadAppData.mockResolvedValue(null)
    useAppStore.setState({ status: 'loading' })
    await beginMockedHydration('initial stored data')
    expect(dbMocks.saveAppData).toHaveBeenCalled()
    expect(useAppStore.getState().status).toBe('ready')

    const windowListeners = new Map<string, () => void>()
    const windowStub = {
      addEventListener: vi.fn((event: string, listener: () => void) => {
        windowListeners.set(event, listener)
      }),
      removeEventListener: vi.fn((event: string, listener: () => void) => {
        if (windowListeners.get(event) === listener) windowListeners.delete(event)
      }),
    }
    const documentStub = {
      addEventListener: vi.fn(),
      documentElement: { dir: '', lang: '' },
      visibilityState: 'visible',
    }
    vi.stubGlobal('window', windowStub)
    vi.stubGlobal('document', documentStub)
    dbMocks.loadAppData.mockResolvedValue(data as never)
    secretMocks.loadZeroChatSecrets.mockResolvedValue({
      githubToken: 'github-token',
      providerKeys: { [data.providers[0].id]: 'provider-key' },
    })
    secretMocks.getSyncPassphrase.mockResolvedValue('passphrase')

    useAppStore.setState({ status: 'loading' })
    await beginMockedHydration('stored data after page flush')
    expect(useAppStore.getState()).toMatchObject({
      githubToken: 'github-token',
      keys: { [data.providers[0].id]: 'provider-key' },
      status: 'ready',
      syncPassphrase: 'passphrase',
    })
    dbMocks.saveAppData.mockClear()
    useAppStore.getState().setTheme('dark')
    expect(dbMocks.saveAppData).not.toHaveBeenCalled()
    windowListeners.get('pagehide')?.()
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())
    expect(dbMocks.saveAppData).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({ theme: 'dark' }),
      }),
    )

    useAppStore.setState({ syncPassphrase: 'pagehide-passphrase' })
    let releaseMaterialization!: () => void
    const heldMaterialization = new Promise<void>((resolve) => {
      releaseMaterialization = resolve
    })
    dbMocks.materializeAppDataSkillContents.mockImplementationOnce(
      async (snapshot: unknown) => {
        await heldMaterialization
        return snapshot
      },
    )
    cryptoMocks.encryptVault.mockResolvedValueOnce({
      kind: 'zerochat.encrypted',
      version: 1,
    })
    const exporting = useAppStore.getState().exportBackup()
    await vi.waitFor(() =>
      expect(dbMocks.materializeAppDataSkillContents).toHaveBeenCalledOnce(),
    )
    windowListeners.get('pagehide')?.()
    releaseMaterialization()
    await exporting
    expect(downloadMocks.downloadJsonFile).not.toHaveBeenCalled()

    const visibilityListener = documentStub.addEventListener.mock.calls.find(
      ([event]) => event === 'visibilitychange',
    )?.[1] as (() => void) | undefined
    const onlineListener = windowStub.addEventListener.mock.calls.find(
      ([event]) => event === 'online',
    )?.[1] as (() => void) | undefined
    documentStub.visibilityState = 'hidden'
    visibilityListener?.()

    const providerId = data.providers[0].id
    let releaseProviderDeletion!: () => void
    const providerDeletionCommit = new Promise<void>((resolve) => {
      releaseProviderDeletion = resolve
    })
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await providerDeletionCommit
        return persist(target)
      },
    )
    dbMocks.saveAppData.mockClear()
    const deletingProvider = useAppStore.getState().deleteProvider(providerId)
    await vi.waitFor(() =>
      expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
    )
    useAppStore.getState().setTheme('light')
    windowListeners.get('pagehide')?.()
    releaseProviderDeletion()
    await deletingProvider
    expect(dbMocks.saveAppData.mock.calls).toContainEqual([
      expect.objectContaining({
        preferences: expect.objectContaining({ theme: 'light' }),
        providers: [],
      }),
    ])

    const importedData = structuredClone(data)
    importedData.preferences.theme = 'light'
    importedData.updatedAt += 1
    useAppStore.setState({ syncPassphrase: 'passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: importedData,
      secrets: { providerKeys: {} },
    })
    useAppStore.getState().setTheme('system')

    let releaseLocalSave!: () => void
    const localSave = new Promise<void>((resolve) => {
      releaseLocalSave = resolve
    })
    let localSaveStarted!: () => void
    const localSaveStart = new Promise<void>((resolve) => {
      localSaveStarted = resolve
    })
    let releaseImportSave!: () => void
    const importSave = new Promise<void>((resolve) => {
      releaseImportSave = resolve
    })
    let importSaveStarted!: () => void
    const importSaveStart = new Promise<void>((resolve) => {
      importSaveStarted = resolve
    })
    dbMocks.saveAppData.mockClear()
    dbMocks.saveAppData.mockImplementation(async (snapshot: unknown) => {
      const theme = (snapshot as AppData).preferences.theme
      if (theme === 'system') {
        localSaveStarted()
        await localSave
      }
      if (theme === 'light') {
        importSaveStarted()
        await importSave
      }
    })

    const importing = useAppStore.getState().importBackup(
      new File(['{}'], 'pagehide-import.json', { type: 'application/json' }),
    )
    await localSaveStart
    windowListeners.get('pagehide')?.()
    releaseLocalSave()
    await importSaveStart
    releaseImportSave()
    await importing

    const persistedThemes = dbMocks.saveAppData.mock.calls.map(
      ([snapshot]) => (snapshot as AppData).preferences.theme,
    )
    expect(persistedThemes).toEqual(['system', 'light'])
    expect(persistedThemes.slice(2)).not.toContain('system')
    expect(useAppStore.getState().data?.preferences.theme).toBe('light')

    dbMocks.saveAppData.mockResolvedValue(undefined)

    const replaySentinel = new Error(
      'C:\\private\\offline-replay sk-test-secret-1234567890',
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const flushOfflineQueue = useAppStore.getState().flushOfflineQueue
    useAppStore.setState({
      flushOfflineQueue: vi.fn().mockRejectedValueOnce(replaySentinel),
    })
    onlineListener?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(consoleError).toHaveBeenCalledWith('[app] offline replay failed')
    expectConsoleErrorDoesNotExpose(consoleError, replaySentinel)
    const replayFailure = useAppStore.getState().toasts.at(-1)?.message ?? ''
    expect(replayFailure).toBe(appT(data, 'toast.sendFailed'))
    expect(replayFailure).not.toContain(replaySentinel.message)
    useAppStore.setState({ flushOfflineQueue })

    dbMocks.loadAppData.mockRejectedValue(new Error('load failed'))
    useAppStore.setState({ data: null, status: 'loading' })
    await beginMockedHydration('load failure')
    expect(useAppStore.getState()).toMatchObject({
      loadError: '',
      status: 'error',
    })
  })

  it('cleans startup-materialized Skill refs when the AppData publish fails', async () => {
    const stored = freshData()
    const inlineSkill = skill('startup-inline-skill', {
      chunks: [
        {
          content: 'startup inline body',
          heading: 'Body',
          id: 'startup-inline-chunk',
          keywords: [],
          tokenEstimate: 3,
        },
      ],
    })
    stored.skills = [inlineSkill]
    const persisted = structuredClone(stored)
    persisted.skills[0].chunks[0] = {
      ...persisted.skills[0].chunks[0],
      content: undefined,
      contentPreview: 'startup inline body',
      contentRef: 'skill-chunk:startup-materialized',
    }
    dbMocks.loadAppData.mockResolvedValueOnce(stored as never)
    dbMocks.persistAppDataSkillContents.mockResolvedValueOnce(persisted)
    dbMocks.saveAppData.mockRejectedValueOnce(new Error('startup publish failed'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    useAppStore.setState({ data: null, status: 'loading' })

    try {
      await beginMockedHydration('startup materialized Skill cleanup')
    } finally {
      consoleError.mockRestore()
    }

    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith([
      'skill-chunk:startup-materialized',
    ])
    expect(useAppStore.getState().status).toBe('error')
  })

  it('retries startup Skill ref cleanup after an earlier cleanup failure', async () => {
    const stored = freshData()
    const inlineSkill = skill('startup-retry-skill', {
      chunks: [
        {
          content: 'startup retry body',
          heading: 'Body',
          id: 'startup-retry-chunk',
          keywords: [],
          tokenEstimate: 3,
        },
      ],
    })
    stored.skills = [inlineSkill]
    const persisted = structuredClone(stored)
    persisted.skills[0].chunks[0] = {
      ...persisted.skills[0].chunks[0],
      content: undefined,
      contentPreview: 'startup retry body',
      contentRef: 'skill-chunk:startup-retry',
    }
    const retryPersisted = structuredClone(persisted)
    retryPersisted.skills[0].chunks[0].contentRef =
      'skill-chunk:startup-retry-2'
    dbMocks.loadAppData.mockResolvedValue(stored as never)
    dbMocks.persistAppDataSkillContents
      .mockResolvedValueOnce(persisted)
      .mockResolvedValue(retryPersisted)
    dbMocks.saveAppData
      .mockRejectedValueOnce(new Error('startup publish failed'))
      .mockResolvedValue(undefined)
    dbMocks.deleteSkillContentRefs.mockRejectedValueOnce(
      new Error('startup cleanup blocked'),
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    useAppStore.setState({ data: null, status: 'loading' })

    try {
      await expect(
        beginMockedHydration('startup cleanup retry first attempt'),
      ).resolves.toBeUndefined()
      expect(useAppStore.getState()).toMatchObject({
        data: null,
        loadError: '',
        status: 'error',
      })
      expect(dbMocks.saveAppData).toHaveBeenCalledTimes(1)
      expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledTimes(1)
      expect(consoleError).toHaveBeenCalledWith(
        '[app] stale skill ref cleanup failed',
      )
      expect(consoleError).toHaveBeenCalledWith('[app] init failed')
      useAppStore.setState({ status: 'loading' })
      await beginMockedHydration('startup cleanup retry second attempt')
    } finally {
      consoleError.mockRestore()
    }

    expect(dbMocks.deleteSkillContentRefs.mock.calls).toEqual([
      [['skill-chunk:startup-retry']],
      [['skill-chunk:startup-retry']],
    ])
    expect(dbMocks.saveAppData.mock.calls[1]?.[0]).toMatchObject({
      skills: [
        {
          chunks: [{ contentRef: 'skill-chunk:startup-retry-2' }],
        },
      ],
    })
    expect(dbMocks.deleteSkillContentRefs).not.toHaveBeenCalledWith([
      'skill-chunk:startup-retry-2',
    ])
    expect(useAppStore.getState().status).toBe('ready')
  })

  it('falls back to the English runtime locale when the startup locale chunk fails', async () => {
    const data = freshData()
    data.preferences.language = 'fr-FR'
    dbMocks.loadAppData.mockResolvedValue(data as never)
    useAppStore.setState({ data: null, status: 'loading' })
    await i18nMocks.actualLoadLocale!('en-US')
    setRuntimeLocale('en-US')

    const loadedLocales: string[] = []
    const failure = new Error('C:\\private\\startup-locale-secret')
    i18nMocks.loadLocale.mockImplementation(async (locale: string) => {
      loadedLocales.push(locale)
      if (locale === 'fr-FR') throw failure
      await i18nMocks.actualLoadLocale!('en-US')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await beginMockedHydration('startup locale fallback')

    expect(loadedLocales).toEqual(['fr-FR', 'en-US'])
    expect(useAppStore.getState().status).toBe('ready')
    expect(rt('button.clearCloudData')).toBe(
      translate('en-US', 'button.clearCloudData'),
    )
    expect(consoleError).toHaveBeenCalledWith('[app] locale load failed')
  })

  it('coalesces concurrent startup hydration into one current store owner', async () => {
    let resolveStored!: (value: AppData | null) => void
    dbMocks.loadAppData.mockImplementationOnce(
      () =>
        new Promise<AppData | null>((resolve) => {
          resolveStored = resolve
        }) as never,
    )
    useAppStore.setState({ data: null, status: 'loading' })

    const first = beginMockedHydration('concurrent startup hydration')
    const second = useAppStore.getState().init()

    expect(dbMocks.loadAppData).toHaveBeenCalledTimes(1)
    resolveStored(null)
    await Promise.all([first, second])

    expect(dbMocks.loadAppData).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().status).toBe('ready')
  })

  it('does not let startup hydration publish after a completed data replacement', async () => {
    const startupData = freshData()
    startupData.preferences.theme = 'light'
    dbMocks.loadAppData.mockResolvedValueOnce(startupData as never)
    useAppStore.setState({ status: 'loading' })

    let markSecretsStarted!: () => void
    const secretsStarted = new Promise<void>((resolve) => {
      markSecretsStarted = resolve
    })
    let releaseSecrets!: () => void
    const secretsReady = new Promise<void>((resolve) => {
      releaseSecrets = resolve
    })
    secretMocks.loadZeroChatSecrets.mockImplementationOnce(async () => {
      markSecretsStarted()
      await secretsReady
      return { githubToken: '', providerKeys: {} }
    })

    const initialization = beginMockedHydration(
      'startup hydration before data replacement',
    )
    await secretsStarted

    const importedData = structuredClone(startupData)
    importedData.preferences.theme = 'dark'
    importedData.updatedAt += 1
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: importedData,
      secrets: { providerKeys: {} },
    })

    const importing = useAppStore.getState().importBackup(
      new File(['{}'], 'backup.json', { type: 'application/json' }),
    )
    await Promise.resolve()
    expect(cryptoMocks.decryptVault).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.preferences.theme).toBe('system')

    releaseSecrets()
    await initialization
    useAppStore.setState({ syncPassphrase: 'passphrase' })
    await importing

    expect(cryptoMocks.decryptVault).toHaveBeenCalledOnce()
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce()
    expect(useAppStore.getState().data?.preferences.theme).toBe('dark')
  })

  it('does not let remounted startup hydration overwrite an imported replacement', async () => {
    const data = resetStore()
    const staleHydratedData = structuredClone(data)
    staleHydratedData.preferences.theme = 'system'
    const importedData = structuredClone(data)
    importedData.preferences.theme = 'light'
    importedData.updatedAt += 1
    useAppStore.setState({ syncPassphrase: 'passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: importedData,
      secrets: { providerKeys: {} },
    })

    let releaseImportCommit!: () => void
    const importCommitReady = new Promise<void>((resolve) => {
      releaseImportCommit = resolve
    })
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await importCommitReady
        return persist(target)
      },
    )

    const importing = useAppStore.getState().importBackup(
      new File(['{}'], 'remount-import.json', { type: 'application/json' }),
    )
    await vi.waitFor(() =>
      expect(
        secretMocks.commitProviderSecretSnapshotWithAppData,
      ).toHaveBeenCalledOnce(),
    )

    let releaseHydratedSecrets!: () => void
    const hydratedSecretsReady = new Promise<void>((resolve) => {
      releaseHydratedSecrets = resolve
    })
    dbMocks.loadAppData.mockImplementation(async () => staleHydratedData as never)
    secretMocks.loadZeroChatSecrets.mockImplementation(async () => {
      await hydratedSecretsReady
      return { githubToken: '', providerKeys: {} }
    })

    const remountedInitialization = useAppStore.getState().init()
    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve()

    releaseImportCommit()
    await importing
    expect(useAppStore.getState().data?.preferences.theme).toBe('light')

    releaseHydratedSecrets()
    await remountedInitialization

    expect(dbMocks.loadAppData).not.toHaveBeenCalled()
    expect(secretMocks.loadZeroChatSecrets).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.preferences.theme).toBe('light')
  })

  it('does not reset while startup hydration is still pending', async () => {
    const startupData = freshData()
    startupData.preferences.theme = 'light'
    dbMocks.loadAppData.mockResolvedValueOnce(startupData as never)
    useAppStore.setState({ status: 'loading' })

    let markSecretsStarted!: () => void
    const secretsStarted = new Promise<void>((resolve) => {
      markSecretsStarted = resolve
    })
    let releaseSecrets!: () => void
    const secretsReady = new Promise<void>((resolve) => {
      releaseSecrets = resolve
    })
    secretMocks.loadZeroChatSecrets.mockImplementationOnce(async () => {
      markSecretsStarted()
      await secretsReady
      return { githubToken: '', providerKeys: {} }
    })

    const initialization = beginMockedHydration(
      'startup hydration before reset',
    )
    await secretsStarted

    const resetting = useAppStore.getState().resetAll()
    await Promise.resolve()
    expect(secretMocks.commitZeroChatSecretSnapshotWithAppData).not.toHaveBeenCalled()

    releaseSecrets()
    await initialization
    await resetting

    expect(secretMocks.commitZeroChatSecretSnapshotWithAppData).toHaveBeenCalledOnce()
    expect(useAppStore.getState().data?.preferences.theme).toBe('system')
  })

  it.each(['Provider key', 'sync passphrase', 'GitHub token'] as const)(
    'does not let startup secret hydration overwrite a %s mutation while it is pending',
    async (kind) => {
      const startupData = freshData()
      const providerId = startupData.providers[0].id
      resetStore(startupData)
      useAppStore.setState({ status: 'loading' })
      dbMocks.loadAppData.mockResolvedValueOnce(startupData as never)

      let markSecretsStarted!: () => void
      const secretsStarted = new Promise<void>((resolve) => {
        markSecretsStarted = resolve
      })
      let releaseSecrets!: () => void
      const secretsReady = new Promise<void>((resolve) => {
        releaseSecrets = resolve
      })
      secretMocks.loadZeroChatSecrets.mockImplementationOnce(async () => {
        markSecretsStarted()
        await secretsReady
        return {
          githubToken: 'hydrated-token',
          providerKeys: { [providerId]: 'hydrated-key' },
        }
      })

      const initialization = beginMockedHydration(
        `startup hydration before ${kind} mutation`,
      )
      await secretsStarted

      let saving: Promise<boolean>
      if (kind === 'Provider key') {
        saving = useAppStore.getState().saveProviderKey(providerId, 'new-key')
      } else if (kind === 'sync passphrase') {
        saving = useAppStore.getState().setSyncPassphrase('new-passphrase')
      } else {
        saving = useAppStore.getState().saveGithubToken('new-token')
      }
      let savingSettled = false
      void saving.then(() => {
        savingSettled = true
      })
      await Promise.resolve()
      expect(savingSettled).toBe(false)
      if (kind === 'Provider key') {
        expect(secretMocks.setProviderKey).not.toHaveBeenCalledWith(
          providerId,
          'new-key',
        )
      } else if (kind === 'sync passphrase') {
        expect(secretMocks.setSyncPassphrase).not.toHaveBeenCalledWith(
          'new-passphrase',
        )
      } else {
        expect(secretMocks.setGithubToken).not.toHaveBeenCalledWith('new-token')
      }

      releaseSecrets()
      await Promise.all([initialization, saving])
      if (kind === 'Provider key') {
        expect(useAppStore.getState().keys[providerId]).toBe('new-key')
      } else if (kind === 'sync passphrase') {
        expect(useAppStore.getState().syncPassphrase).toBe('new-passphrase')
      } else {
        expect(useAppStore.getState().githubToken).toBe('new-token')
      }
    },
  )

  it('does not let startup hydration overwrite an active conversation mutation', async () => {
    const startupData = freshData()
    const second = {
      ...startupData.conversations[0],
      id: 'startup-second-conversation',
      title: 'Second conversation',
    }
    startupData.conversations = [startupData.conversations[0], second]
    startupData.preferences.activeConversationId = startupData.conversations[0].id
    resetStore(startupData)
    useAppStore.setState({ status: 'loading' })
    dbMocks.loadAppData.mockResolvedValueOnce(startupData as never)

    let markSecretsStarted!: () => void
    const secretsStarted = new Promise<void>((resolve) => {
      markSecretsStarted = resolve
    })
    let releaseSecrets!: () => void
    const secretsReady = new Promise<void>((resolve) => {
      releaseSecrets = resolve
    })
    secretMocks.loadZeroChatSecrets.mockImplementationOnce(async () => {
      markSecretsStarted()
      await secretsReady
      return { githubToken: '', providerKeys: {} }
    })

    const initialization = beginMockedHydration(
      'startup hydration before conversation mutation',
    )
    await secretsStarted

    const switching = useAppStore
      .getState()
      .setActiveConversation(second.id)
    let switchingSettled = false
    void switching.then(() => {
      switchingSettled = true
    })
    await Promise.resolve()
    expect(switchingSettled).toBe(false)
    expect(useAppStore.getState().data?.preferences.activeConversationId).toBe(
      startupData.conversations[0].id,
    )

    releaseSecrets()
    await Promise.all([initialization, switching])
    expect(useAppStore.getState().data?.preferences.activeConversationId).toBe(
      second.id,
    )
  })

  it('does not let a repeated startup hydration overwrite a committed conversation mutation', async () => {
    const data = resetStore()
    const first = data.conversations[0]
    const second = { ...structuredClone(first), id: 'repeated-init-second' }
    data.conversations.push(second)

    const staleHydratedData = structuredClone(data)
    staleHydratedData.preferences.activeConversationId = first.id
    dbMocks.loadAppData.mockImplementation(async () => staleHydratedData as never)

    const hydration = useAppStore.getState().init()
    await hydration

    await expect(
      useAppStore.getState().setActiveConversation(second.id),
    ).resolves.toBe(true)
    expect(useAppStore.getState().data?.preferences.activeConversationId).toBe(
      second.id,
    )

    expect(dbMocks.loadAppData).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.preferences.activeConversationId).toBe(
      second.id,
    )
  })

  it('sanitizes startup AppData before loading secrets and cleans removed Provider tombstones', async () => {
    const stored = freshData()
    const activeProvider = stored.providers[0]
    const unsafeProvider = {
      ...activeProvider,
      id: 'unsafe-provider',
      name: 'Unsafe Provider',
      baseUrl: 'http://127.0.0.1/v1',
    }
    stored.providers = [activeProvider, unsafeProvider]
    const sanitizedData = {
      ...stored,
      providers: [activeProvider],
      updatedAt: stored.updatedAt + 1,
    }
    let resolveSanitization!: (value: {
      changed: boolean
      data: AppData
      removedProviderIds: string[]
    }) => void
    let markSanitizationStarted!: () => void
    const sanitizationStarted = new Promise<void>((resolve) => {
      markSanitizationStarted = resolve
    })
    providerSafetyMocks.sanitizeRemoteOnlyAppData.mockImplementation(
      () => {
        markSanitizationStarted()
        return new Promise((resolve) => {
          resolveSanitization = resolve
        })
      },
    )
    providerConfigMocks.normalizeOfficialProviderContracts.mockImplementation(
      (data: AppData) => data,
    )
    dbMocks.loadAppData.mockResolvedValue(stored as never)
    secretMocks.getPendingProviderSecretCleanupIds.mockReturnValue([
      activeProvider.id,
      'pending-deleted-provider',
    ])
    secretMocks.loadZeroChatSecrets.mockResolvedValue({
      githubToken: 'startup-token',
      providerKeys: { [activeProvider.id]: 'startup-key' },
    })
    useAppStore.setState({ data: null, status: 'loading' })

    const initialization = beginMockedHydration(
      'startup sanitization and Provider tombstone cleanup',
    )
    await sanitizationStarted
    const secretLoadsBeforeSanitizationFinished =
      secretMocks.loadZeroChatSecrets.mock.calls.length
    resolveSanitization({
      changed: true,
      data: sanitizedData,
      removedProviderIds: [unsafeProvider.id],
    })
    await initialization

    expect(dbMocks.persistAppDataSkillContents).toHaveBeenCalledWith(stored)
    expect(providerSafetyMocks.sanitizeRemoteOnlyAppData).toHaveBeenCalledWith(
      stored,
    )
    expect(secretLoadsBeforeSanitizationFinished).toBe(0)
    expect(secretMocks.queueProviderSecretCleanupById).toHaveBeenCalledWith([
      unsafeProvider.id,
    ])
    const savedStartupData = (
      dbMocks.saveAppData.mock.calls as unknown as Array<[AppData]>
    ).at(-1)?.[0]
    expect(savedStartupData?.providers).toEqual([activeProvider])
    expect(secretMocks.clearProviderSecretsById).toHaveBeenCalledWith([
      unsafeProvider.id,
      'pending-deleted-provider',
    ])
    expect(
      secretMocks.clearPendingProviderSecretCleanupById.mock.calls,
    ).toEqual([
      [[activeProvider.id]],
      [[unsafeProvider.id, 'pending-deleted-provider']],
    ])
    expect(secretMocks.loadZeroChatSecrets).toHaveBeenCalledWith([
      activeProvider.id,
    ])
    expect(useAppStore.getState()).toMatchObject({
      githubToken: 'startup-token',
      keys: { [activeProvider.id]: 'startup-key' },
      status: 'ready',
    })
    expect(useAppStore.getState().data).toBe(savedStartupData)
  })

  it('fails startup before persistence and secrets when removed Provider cleanup cannot be journaled', async () => {
    const stored = freshData()
    const unsafeProvider = {
      ...stored.providers[0],
      id: 'unsafe-provider',
      baseUrl: 'http://127.0.0.1/v1',
    }
    stored.providers = [unsafeProvider]
    const sanitizedData = freshData()
    dbMocks.loadAppData.mockResolvedValue(stored as never)
    providerSafetyMocks.sanitizeRemoteOnlyAppData.mockReturnValue({
      changed: true,
      data: sanitizedData,
      removedProviderIds: [unsafeProvider.id],
    })
    secretMocks.queueProviderSecretCleanupById.mockImplementation(() => {
      throw new Error('cleanup journal blocked')
    })
    useAppStore.setState({ data: null, status: 'loading' })

    await beginMockedHydration('startup Provider cleanup journal failure')

    expect(dbMocks.saveAppData).not.toHaveBeenCalled()
    expect(secretMocks.clearProviderSecretsById).not.toHaveBeenCalled()
    expect(secretMocks.loadZeroChatSecrets).not.toHaveBeenCalled()
    expect(useAppStore.getState()).toMatchObject({
      loadError: '',
      status: 'error',
    })
  })

  it.each(['repaired AppData save', 'canonical secret cleanup'] as const)(
    'keeps removed Provider cleanup journaled when %s fails',
    async (failurePoint) => {
      const stored = freshData()
      const unsafeProvider = {
        ...stored.providers[0],
        id: 'unsafe-provider',
        baseUrl: 'http://127.0.0.1/v1',
      }
      stored.providers = [unsafeProvider]
      const repaired = freshData()
      dbMocks.loadAppData.mockResolvedValue(stored as never)
      providerSafetyMocks.sanitizeRemoteOnlyAppData.mockReturnValue({
        changed: true,
        data: repaired,
        removedProviderIds: [unsafeProvider.id],
      })
      if (failurePoint === 'repaired AppData save') {
        dbMocks.saveAppData.mockRejectedValueOnce(
          new Error('startup repair save blocked'),
        )
      } else {
        secretMocks.clearProviderSecretsById.mockRejectedValueOnce(
          new Error('startup canonical cleanup blocked'),
        )
      }
      useAppStore.setState({ data: null, status: 'loading' })

      await beginMockedHydration(`startup cleanup failure: ${failurePoint}`)

      expect(secretMocks.queueProviderSecretCleanupById).toHaveBeenCalledWith([
        unsafeProvider.id,
      ])
      expect(
        secretMocks.clearPendingProviderSecretCleanupById,
      ).not.toHaveBeenCalled()
      expect(secretMocks.loadZeroChatSecrets).not.toHaveBeenCalled()
      if (failurePoint === 'repaired AppData save') {
        expect(secretMocks.clearProviderSecretsById).not.toHaveBeenCalled()
      } else {
        expect(secretMocks.clearProviderSecretsById).toHaveBeenCalledWith([
          unsafeProvider.id,
        ])
      }
      expect(useAppStore.getState().status).toBe('error')
    },
  )

  it('keeps startup usable when tombstone finalization fails after canonical cleanup', async () => {
    const stored = freshData()
    const activeProviderId = stored.providers[0].id
    dbMocks.loadAppData.mockResolvedValue(stored as never)
    secretMocks.getPendingProviderSecretCleanupIds.mockReturnValue([
      activeProviderId,
      'deleted-provider',
    ])
    secretMocks.clearPendingProviderSecretCleanupById.mockImplementation(() => {
      throw new Error('tombstone finalization blocked')
    })
    useAppStore.setState({ data: null, status: 'loading' })

    await beginMockedHydration('startup tombstone finalization failure')

    expect(secretMocks.clearProviderSecretsById).toHaveBeenCalledWith([
      'deleted-provider',
    ])
    expect(secretMocks.clearProviderSecretsById).not.toHaveBeenCalledWith([
      activeProviderId,
    ])
    expect(secretMocks.loadZeroChatSecrets).toHaveBeenCalledWith([
      activeProviderId,
    ])
    expect(useAppStore.getState().status).toBe('ready')
  })

  it('blocks startup secrets when the cleanup tombstone queue is corrupted', async () => {
    dbMocks.loadAppData.mockResolvedValue(freshData() as never)
    secretMocks.getPendingProviderSecretCleanupIds.mockImplementation(() => {
      throw new Error('provider cleanup queue is corrupted')
    })
    useAppStore.setState({ data: null, status: 'loading' })

    await beginMockedHydration('startup cleanup queue corruption')

    expect(secretMocks.clearProviderSecretsById).not.toHaveBeenCalled()
    expect(secretMocks.loadZeroChatSecrets).not.toHaveBeenCalled()
    expect(useAppStore.getState().status).toBe('error')
  })

  it('skips empty removed Provider cleanup during a harmless startup repair', async () => {
    const stored = freshData()
    const repaired = { ...stored, updatedAt: stored.updatedAt + 1 }
    dbMocks.loadAppData.mockResolvedValue(stored as never)
    providerSafetyMocks.sanitizeRemoteOnlyAppData.mockReturnValue({
      changed: true,
      data: repaired,
      removedProviderIds: [],
    })
    providerConfigMocks.normalizeOfficialProviderContracts.mockReturnValue(
      repaired,
    )
    useAppStore.setState({ data: null, status: 'loading' })

    await beginMockedHydration('startup harmless repair')

    expect(dbMocks.saveAppData).toHaveBeenCalledWith(repaired)
    expect(secretMocks.clearProviderSecretsById).not.toHaveBeenCalled()
    expect(secretMocks.loadZeroChatSecrets).toHaveBeenCalledWith([
      repaired.providers[0].id,
    ])
    expect(useAppStore.getState().status).toBe('ready')
  })

  it('fetches provider models, merges them, and surfaces runtime errors', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    await useAppStore.getState().fetchModels(providerId)
    expect(runtime.listProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({ provider: expect.objectContaining({ id: providerId }) }),
    )
    expect(useAppStore.getState().data?.providers[0].models).toEqual(
      expect.arrayContaining(['model-a', 'model-b']),
    )
    expect(useAppStore.getState().fetchingModelsFor).toBe('')

    runtime.listProviderModels.mockRejectedValueOnce(new Error('models failed'))
    await useAppStore.getState().fetchModels(providerId)
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'models failed',
      tone: 'error',
    })

    await i18nMocks.actualLoadLocale!('en-US')
    setRuntimeLocale('en-US')
    runtime.listProviderModels.mockRejectedValueOnce(
      Object.assign(new Error('api_key=sk-provider-secret-123456789'), {
        code: 'auth',
      }),
    )
    await useAppStore.getState().fetchModels(providerId)
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: translate('en-US', 'error.apiKeyInvalid'),
      tone: 'error',
    })
    expect(useAppStore.getState().toasts.at(-1)?.message).not.toContain(
      'provider-secret',
    )

    runtime.listProviderModels.mockRejectedValueOnce(
      new Error(
        'Provider rejected api_key=sk-provider-secret-123456789 at https://relay.example.test/v1/models',
      ),
    )
    await useAppStore.getState().fetchModels(providerId)
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'Provider rejected api_key: [redacted] at [redacted-url]',
      tone: 'error',
    })

    runtime.listProviderModels.mockResolvedValueOnce([])
    await useAppStore.getState().fetchModels(providerId)
    expect(useAppStore.getState().fetchingModelsFor).toBe('')

    useAppStore.setState({ fetchingModelsFor: 'busy' })
    await useAppStore.getState().fetchModels(providerId)
    expect(runtime.listProviderModels).toHaveBeenCalledTimes(5)
  })

  it('keeps an in-flight model refresh when only Provider display metadata changes', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    let releaseModels!: (models: string[]) => void
    runtime.listProviderModels.mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          releaseModels = resolve
        }),
    )

    const refresh = useAppStore.getState().fetchModels(providerId)
    await vi.waitFor(() =>
      expect(runtime.listProviderModels).toHaveBeenCalledOnce(),
    )

    useAppStore.getState().updateProvider(providerId, {
      name: 'Renamed display label',
    })
    expect(useAppStore.getState().fetchingModelsFor).toBe(providerId)

    releaseModels(['display-safe-model'])
    await refresh

    expect(useAppStore.getState().data?.providers[0]).toMatchObject({
      id: providerId,
      name: 'Renamed display label',
      models: expect.arrayContaining(['display-safe-model']),
    })
    expect(useAppStore.getState().fetchingModelsFor).toBe('')
  })

  it('deduplicates fetched and locally configured Provider models', async () => {
    const data = freshData()
    const provider = data.providers[0]
    data.providers[0] = {
      ...provider,
      model: 'shared-model',
      models: ['shared-model', 'local-only'],
    }
    resetStore(data)
    runtime.listProviderModels.mockResolvedValueOnce([
      'remote-only',
      'shared-model',
      'remote-only',
    ])

    await useAppStore.getState().fetchModels(provider.id)

    expect(useAppStore.getState().data?.providers[0].models).toEqual([
      'remote-only',
      'shared-model',
      'local-only',
    ])
    expect(useAppStore.getState().data?.providers[0].model).toBe('shared-model')
  })

  it('publishes fetched Provider models and success feedback only after durable save', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const previousModels = data.providers[0].models
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    runtime.listProviderModels.mockResolvedValueOnce(['durable-fetched-model'])

    let releaseSave!: () => void
    const save = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    dbMocks.saveAppData.mockImplementationOnce(async (snapshot: unknown) => {
      expect((snapshot as AppData).providers[0]?.models).toContain(
        'durable-fetched-model',
      )
      await save
    })

    const refresh = useAppStore.getState().fetchModels(providerId)
    let settled = false
    void refresh.then(() => {
      settled = true
    })
    await vi.waitFor(() => expect(runtime.listProviderModels).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())
    const settledBeforeRelease = settled
    const modelsBeforeRelease = useAppStore.getState().data?.providers[0]?.models
    const successBeforeRelease = useAppStore
      .getState()
      .toasts.some((toast) => toast.message === appT(data, 'toast.saved'))

    releaseSave()
    await refresh

    expect(settledBeforeRelease).toBe(false)
    expect(modelsBeforeRelease).toEqual(previousModels)
    expect(successBeforeRelease).toBe(false)
    expect(useAppStore.getState().data?.providers[0]?.models).toContain(
      'durable-fetched-model',
    )
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: appT(data, 'toast.saved'),
      tone: 'success',
    })
  })

  it('drops a late successful model refresh notice after Provider deletion owns the lifecycle', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    runtime.listProviderModels.mockResolvedValueOnce(['late-model'])

    let releaseModelSave!: () => void
    const modelSave = new Promise<void>((resolve) => {
      releaseModelSave = resolve
    })
    dbMocks.saveAppData.mockImplementationOnce(async (snapshot: unknown) => {
      expect((snapshot as AppData).providers[0]?.models).toContain('late-model')
      await modelSave
    })

    const refresh = useAppStore.getState().fetchModels(providerId)
    await vi.waitFor(() => expect(runtime.listProviderModels).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())

    vi.mocked(globalThis.confirm).mockReturnValueOnce(true)
    const deletion = useAppStore.getState().deleteProvider(providerId)
    const toastCount = useAppStore.getState().toasts.length

    releaseModelSave()
    await refresh

    expect(useAppStore.getState().toasts).toHaveLength(toastCount)
    expect(useAppStore.getState().data?.providers[0]?.models).not.toContain(
      'late-model',
    )

    await expect(deletion).resolves.toBe(true)
  })

  it('drops a late connectivity result after Provider deletion owns the lifecycle', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    let releaseCheck!: () => void
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockImplementationOnce(
      (context: ProviderConnectivityCheckContext) => ({
        runProviderConnectivityCheck: vi.fn(
          () =>
            new Promise<null>((resolve) => {
              releaseCheck = () => {
                context.setProviderConnectivityResults((current) => ({
                  ...current,
                  [providerId]: {
                    field: 'none',
                    message: 'late connectivity result',
                    retryable: false,
                    tone: 'success',
                  },
                }))
                context.setNotice('late connectivity notice', 'success')
                resolve(null)
              }
            }),
        ),
      }),
    )

    const checking = useAppStore.getState().checkProviderConnectivity(providerId)
    await vi.waitFor(() => expect(releaseCheck).toEqual(expect.any(Function)))

    let releaseDeletion!: () => void
    const deletionCommit = new Promise<void>((resolve) => {
      releaseDeletion = resolve
    })
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await deletionCommit
        return persist(target)
      },
    )
    vi.mocked(globalThis.confirm).mockReturnValueOnce(true)
    const deletion = useAppStore.getState().deleteProvider(providerId)
    await vi.waitFor(() =>
      expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
    )
    const toastCount = useAppStore.getState().toasts.length

    releaseCheck()
    await checking

    expect(useAppStore.getState().providerConnectivityResults[providerId]).toBeUndefined()
    expect(useAppStore.getState().toasts).toHaveLength(toastCount)

    releaseDeletion()
    await expect(deletion).resolves.toBe(true)
  })

  it('keeps model refresh successful when its success notification fails', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    runtime.listProviderModels.mockResolvedValueOnce(['model-c'])
    useAppStore.setState({
      notify: () => {
        throw new Error('notification channel unavailable')
      },
    })

    await expect(useAppStore.getState().fetchModels(providerId)).resolves.toBeUndefined()

    expect(useAppStore.getState().data?.providers[0].models).toEqual(
      expect.arrayContaining(['model-c']),
    )
    expect(useAppStore.getState().fetchingModelsFor).toBe('')
  })

  it('contains model refresh failure notification failures', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    runtime.listProviderModels.mockRejectedValueOnce(new Error('models failed'))
    useAppStore.setState({
      notify: () => {
        throw new Error('notification channel unavailable')
      },
    })

    await expect(useAppStore.getState().fetchModels(providerId)).resolves.toBeUndefined()

    expect(useAppStore.getState().fetchingModelsFor).toBe('')
  })

  it('drops a late model refresh failure once Provider deletion owns the lifecycle', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    let rejectModels!: (error: unknown) => void
    runtime.listProviderModels.mockImplementationOnce(
      () =>
        new Promise<string[]>((_resolve, reject) => {
          rejectModels = reject
        }),
    )

    const refresh = useAppStore.getState().fetchModels(providerId)
    await vi.waitFor(() =>
      expect(runtime.listProviderModels).toHaveBeenCalledOnce(),
    )

    let releaseDeletion!: () => void
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (...args: unknown[]) => {
        const target = args[2] as AppData
        return new Promise<AppData>((resolve) => {
          releaseDeletion = () => resolve(target)
        })
      },
    )
    const deletion = useAppStore.getState().deleteProvider(providerId)
    await vi.waitFor(() =>
      expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
    )
    expect(useAppStore.getState().data?.providers).toHaveLength(1)

    const toastCount = useAppStore.getState().toasts.length
    rejectModels(new Error('late model refresh failure'))
    await refresh
    expect(useAppStore.getState().toasts).toHaveLength(toastCount)

    releaseDeletion()
    await deletion
  })

  it('invalidates a proxy model refresh before token derivation settles', async () => {
    const data = freshData()
    const provider = data.providers[0]
    data.providers[0] = {
      ...provider,
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'old-passphrase' })

    let resolveDerivation!: (value: string) => void
    accessKeyMocks.accessKeyFromPassword.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveDerivation = resolve
        }),
    )
    let releaseDeletion!: () => void
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (...args: unknown[]) => {
        const target = args[2] as AppData
        return new Promise<AppData>((resolve) => {
          releaseDeletion = () => resolve(target)
        })
      },
    )

    const refresh = useAppStore.getState().fetchModels(provider.id)
    await vi.waitFor(() =>
      expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledWith(
        'old-passphrase',
      ),
    )
    const deletion = useAppStore.getState().deleteProvider(provider.id)
    await vi.waitFor(() =>
      expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
    )

    resolveDerivation('stale-proxy-token')
    await refresh

    expect(runtime.listProviderModels).not.toHaveBeenCalled()
    expect(useAppStore.getState().fetchingModelsFor).toBe('')
    expect(useAppStore.getState().toasts).toHaveLength(0)

    releaseDeletion()
    await deletion
  })

  it('coalesces duplicate model refreshes while proxy access-key derivation is pending', async () => {
    const data = freshData()
    const provider = data.providers[0]
    data.providers[0] = {
      ...provider,
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'old-passphrase' })

    let resolveDerivation!: (value: string) => void
    accessKeyMocks.accessKeyFromPassword.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveDerivation = resolve
        }),
    )

    const first = useAppStore.getState().fetchModels(provider.id)
    await vi.waitFor(() =>
      expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledOnce(),
    )
    expect(useAppStore.getState().fetchingModelsFor).toBe(provider.id)

    const second = useAppStore.getState().fetchModels(provider.id)
    resolveDerivation('proxy-token')

    await Promise.all([first, second])
    expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledOnce()
    expect(runtime.listProviderModels).toHaveBeenCalledOnce()
    expect(useAppStore.getState().fetchingModelsFor).toBe('')
  })

  it('keeps a restarted model refresh owned when the old derivation rejects', async () => {
    const data = freshData()
    const provider = data.providers[0]
    data.providers[0] = {
      ...provider,
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'old-passphrase' })

    let rejectOldDerivation!: (error: unknown) => void
    accessKeyMocks.accessKeyFromPassword
      .mockImplementationOnce(
        () =>
          new Promise<string>((_resolve, reject) => {
            rejectOldDerivation = reject
          }),
      )
      .mockResolvedValueOnce('new-proxy-token')
    let releaseSecondRequest!: (models: string[]) => void
    runtime.listProviderModels.mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          releaseSecondRequest = resolve
        }),
    )

    const first = useAppStore.getState().fetchModels(provider.id)
    await vi.waitFor(() =>
      expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledOnce(),
    )
    useAppStore.getState().updateProvider(provider.id, { model: 'new-model' })
    const second = useAppStore.getState().fetchModels(provider.id)
    await vi.waitFor(() =>
      expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledTimes(2),
    )
    await vi.waitFor(() =>
      expect(runtime.listProviderModels).toHaveBeenCalledOnce(),
    )
    expect(useAppStore.getState().fetchingModelsFor).toBe(provider.id)

    rejectOldDerivation(new Error('stale model refresh failure'))
    await first
    expect(useAppStore.getState().toasts).toHaveLength(0)
    expect(useAppStore.getState().fetchingModelsFor).toBe(provider.id)

    releaseSecondRequest(['new-model'])
    await second
    expect(runtime.listProviderModels).toHaveBeenCalledOnce()
    expect(useAppStore.getState().fetchingModelsFor).toBe('')
  })

  it.each([
    ['a Provider update', (providerId: string) => {
      useAppStore.getState().updateProvider(providerId, { model: 'new-model' })
    }],
    ['a Provider key save', (providerId: string) => {
      void useAppStore.getState().saveProviderKey(providerId, 'new-key')
    }],
  ])(
    'invalidates a proxy model refresh before token derivation settles after %s',
    async (_label, invalidate) => {
      const data = freshData()
      const provider = data.providers[0]
      data.providers[0] = {
        ...provider,
        clientRequestMode: false,
        needsApiKey: false,
        proxyUrl: 'https://proxy.invalid',
      }
      resetStore(data)
      useAppStore.setState({ syncPassphrase: 'old-passphrase' })

      let resolveDerivation!: (value: string) => void
      accessKeyMocks.accessKeyFromPassword.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveDerivation = resolve
          }),
      )

      const refresh = useAppStore.getState().fetchModels(provider.id)
      await vi.waitFor(() =>
        expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledOnce(),
      )
      invalidate(provider.id)
      resolveDerivation('stale-proxy-token')

      await refresh
      expect(runtime.listProviderModels).not.toHaveBeenCalled()
      expect(useAppStore.getState().fetchingModelsFor).toBe('')
      expect(useAppStore.getState().toasts).toHaveLength(0)
    },
  )

  it('invalidates a proxy model refresh when local reset starts during token derivation', async () => {
    const data = freshData()
    const provider = data.providers[0]
    data.providers[0] = {
      ...provider,
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'old-passphrase' })

    let resolveDerivation!: (value: string) => void
    accessKeyMocks.accessKeyFromPassword.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveDerivation = resolve
        }),
    )

    const refresh = useAppStore.getState().fetchModels(provider.id)
    await vi.waitFor(() =>
      expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledOnce(),
    )
    const reset = useAppStore.getState().resetAll()
    resolveDerivation('stale-proxy-token')

    await refresh
    await reset
    expect(runtime.listProviderModels).not.toHaveBeenCalled()
    expect(useAppStore.getState().fetchingModelsFor).toBe('')
    expect(useAppStore.getState().toasts).toHaveLength(1)
  })

  it('invalidates a proxy model refresh when backup import starts during token derivation', async () => {
    const data = freshData()
    const provider = data.providers[0]
    data.providers[0] = {
      ...provider,
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'old-passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    let resolveDecrypt!: (value: unknown) => void
    cryptoMocks.decryptVault.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDecrypt = resolve
        }),
    )

    let resolveDerivation!: (value: string) => void
    accessKeyMocks.accessKeyFromPassword.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveDerivation = resolve
        }),
    )

    const refresh = useAppStore.getState().fetchModels(provider.id)
    await vi.waitFor(() =>
      expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledOnce(),
    )
    const imported = useAppStore.getState().importBackup(
      new File(['{}'], 'backup.json', { type: 'application/json' }),
    )
    await vi.waitFor(() =>
      expect(cryptoMocks.decryptVault).toHaveBeenCalledOnce(),
    )
    resolveDecrypt({
      data: structuredClone(data),
      secrets: { providerKeys: {} },
    })
    await vi.waitFor(() =>
      expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
    )
    resolveDerivation('stale-proxy-token')

    await refresh
    await imported
    expect(runtime.listProviderModels).not.toHaveBeenCalled()
    expect(useAppStore.getState().fetchingModelsFor).toBe('')
    expect(useAppStore.getState().toasts).toHaveLength(1)
  })

  it('runs full Provider capability checks through the current store', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const checkProviderFullCapabilities = vi.fn(async (id: string) => {
      expect(id).toBe(providerId)
    })
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockReturnValue({
      checkProviderFullCapabilities,
    })

    await useAppStore.getState().checkProviderFullCapabilities(providerId)

    expect(providerConnectivityMocks.createProviderConnectivityCheckActions)
      .toHaveBeenCalledOnce()
    const context = providerConnectivityMocks.createProviderConnectivityCheckActions
      .mock.calls[0]?.[0]
    expect(context.dataRef.current).toBe(data)
    expect(context.providerKeysRef.current).toEqual({ [providerId]: 'test-key' })
    expect(checkProviderFullCapabilities).toHaveBeenCalledOnce()
    expect(useAppStore.getState().checkingProviderId).toBe('')

    useAppStore.setState({ checkingProviderId: 'busy' })
    await useAppStore.getState().checkProviderFullCapabilities(providerId)
    expect(checkProviderFullCapabilities).toHaveBeenCalledOnce()

    useAppStore.setState({ checkingProviderId: '' })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    checkProviderFullCapabilities.mockRejectedValueOnce(
      new Error('C:\\private\\provider sk-sentinel-secret'),
    )
    await useAppStore.getState().checkProviderFullCapabilities(providerId)
    expect(useAppStore.getState().checkingProviderId).toBe('')
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'Capability check failed. Try again.',
      tone: 'error',
    })
    expect(useAppStore.getState().toasts.at(-1)?.message).not.toContain(
      'sentinel',
    )
    consoleError.mockRestore()
  })

  it('drops a late Provider capability result after that Provider is deleted', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    let releaseCheck!: () => void
    const cancel = vi.fn(() => {
      throw new Error('capability cancel failed')
    })
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockImplementationOnce(
      (context: ProviderConnectivityCheckContext) => {
        context.modelLoadProviderIdRef.cancel = cancel
        return {
        checkProviderFullCapabilities: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releaseCheck = resolve
            }),
        ),
        }
      },
    )

    const checking = useAppStore.getState().checkProviderFullCapabilities(providerId)
    await vi.waitFor(() =>
      expect(
        providerConnectivityMocks.createProviderConnectivityCheckActions,
      ).toHaveBeenCalledOnce(),
    )
    await vi.waitFor(() =>
      expect(releaseCheck).toEqual(expect.any(Function)),
    )

    const deleted = useAppStore.getState().deleteProvider(providerId)
    await deleted
    expect(cancel).toHaveBeenCalledOnce()
    expect(useAppStore.getState().data?.providers).toHaveLength(0)
    expect(useAppStore.getState().checkingProviderId).toBe('')

    releaseCheck()
    await checking

    expect(useAppStore.getState().providerConnectivityResults).toEqual({})
    expect(useAppStore.getState().toasts).toHaveLength(0)
    expect(useAppStore.getState().checkingProviderId).toBe('')
  })

  it('does not start a Provider check while deletion owns its durable transaction', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    let releaseCommit!: () => void
    const commitBlocked = new Promise<void>((resolve) => {
      releaseCommit = resolve
    })
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await commitBlocked
        return persist(target)
      },
    )

    const cancel = vi.fn(() => {
      throw new Error('late capability cancel failed')
    })
    const checkProviderFullCapabilities = vi.fn()
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockImplementationOnce(
      (context: ProviderConnectivityCheckContext) => {
        context.modelLoadProviderIdRef.cancel = cancel
        return {
          checkProviderFullCapabilities,
        }
      },
    )

    const deletion = useAppStore.getState().deleteProvider(providerId)
    await vi.waitFor(() =>
      expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
    )
    const checking = useAppStore
      .getState()
      .checkProviderFullCapabilities(providerId)
    await checking

    expect(checkProviderFullCapabilities).not.toHaveBeenCalled()
    expect(useAppStore.getState().checkingProviderId).toBe('')
    expect(useAppStore.getState().providerConnectivityResults).toEqual({})

    releaseCommit()
    await deletion
  })

  it('does not start a Provider check while its credential mutation is durable', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    let releaseKeyWrite!: () => void
    secretMocks.setProviderKey.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releaseKeyWrite = () => resolve(undefined)
        }),
    )

    const saving = useAppStore.getState().saveProviderKey(providerId, 'new-key')
    await vi.waitFor(() =>
      expect(secretMocks.setProviderKey).toHaveBeenCalledWith(
        providerId,
        'new-key',
      ),
    )

    const checkProviderFullCapabilities = vi.fn(async () => undefined)
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockReturnValueOnce(
      { checkProviderFullCapabilities },
    )

    await useAppStore.getState().checkProviderFullCapabilities(providerId)

    expect(checkProviderFullCapabilities).not.toHaveBeenCalled()
    releaseKeyWrite()
    await saving
  })

  it('does not start a Provider model refresh while its credential mutation is durable', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    let releaseKeyWrite!: () => void
    secretMocks.setProviderKey.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releaseKeyWrite = () => resolve(undefined)
        }),
    )

    const saving = useAppStore.getState().saveProviderKey(providerId, 'new-key')
    await vi.waitFor(() =>
      expect(secretMocks.setProviderKey).toHaveBeenCalledWith(
        providerId,
        'new-key',
      ),
    )

    runtime.listProviderModels.mockClear()
    const refreshing = useAppStore.getState().fetchModels(providerId)
    try {
      await Promise.resolve()
      await Promise.resolve()
      expect(runtime.listProviderModels).not.toHaveBeenCalled()
    } finally {
      releaseKeyWrite()
      await Promise.all([saving, refreshing])
    }
  })

  it('cancels a pending Provider check before publishing a remote Provider replacement', async () => {
    const data = freshData()
    const providerId = data.providers[0].id
    data.sync = { ...data.sync, mode: 'gist' }
    resetStore(data)
    useAppStore.setState({
      githubToken: 'github-token',
      syncPassphrase: 'passphrase',
    })

    let releaseCheck!: () => void
    const cancel = vi.fn()
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockImplementationOnce(
      (context: ProviderConnectivityCheckContext) => {
        context.modelLoadProviderIdRef.cancel = cancel
        return {
          checkProviderFullCapabilities: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                releaseCheck = () => {
                  context.setProviderConnectivityResults((current) => ({
                    ...current,
                    [providerId]: {
                      field: 'none',
                      message: 'late remote replacement result',
                      retryable: false,
                      tone: 'success',
                    },
                  }))
                  resolve()
                }
              }),
          ),
        }
      },
    )
    syncMocks.performSync.mockImplementationOnce(async (current: AppData) => ({
      data: { ...current, providers: [] },
      message: 'remote Provider replacement',
      remoteAccepted: true,
      secrets: { providerKeys: {} },
    }))

    const checking = useAppStore
      .getState()
      .checkProviderFullCapabilities(providerId)
    await vi.waitFor(() => expect(releaseCheck).toEqual(expect.any(Function)))

    await useAppStore.getState().syncNow()

    expect(cancel).toHaveBeenCalledOnce()
    expect(useAppStore.getState().checkingProviderId).toBe('')
    expect(useAppStore.getState().data?.providers).toEqual([])
    releaseCheck()
    await checking
    expect(useAppStore.getState().providerConnectivityResults).toEqual({})
  })

  it('clears completed Provider results when sync replaces their runtime inputs', async () => {
    const data = freshData()
    const providerId = data.providers[0].id
    data.sync = { ...data.sync, mode: 'gist' }
    resetStore(data)
    useAppStore.setState({
      githubToken: 'github-token',
      syncPassphrase: 'passphrase',
    })

    providerConnectivityMocks.createProviderConnectivityCheckActions.mockImplementationOnce(
      (context: ProviderConnectivityCheckContext) => ({
        checkProviderFullCapabilities: vi.fn(async () => {
          context.setProviderConnectivityResults((current) => ({
            ...current,
            [providerId]: {
              field: 'none',
              message: 'completed before sync replacement',
              retryable: false,
              tone: 'success',
            },
          }))
        }),
      }),
    )

    await useAppStore.getState().checkProviderFullCapabilities(providerId)
    expect(useAppStore.getState().providerConnectivityResults[providerId]).toBeDefined()

    syncMocks.performSync.mockImplementationOnce(async (current: AppData) => ({
      data: { ...current, providers: [] },
      message: 'remote Provider replacement',
      remoteAccepted: true,
      secrets: { providerKeys: {} },
    }))

    await useAppStore.getState().syncNow()

    expect(useAppStore.getState().providerConnectivityResults).toEqual({})
  })

  it('cancels pending audio transcription before publishing a remote Provider replacement', async () => {
    const data = freshData()
    data.sync = { ...data.sync, mode: 'gist' }
    resetStore(data)
    useAppStore.setState({
      githubToken: 'github-token',
      syncPassphrase: 'passphrase',
    })
    let resolveTranscription:
      | ((value: { model: string; text: string }) => void)
      | undefined
    runtime.transcribeAudioFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTranscription = resolve
        }),
    )
    syncMocks.performSync.mockImplementationOnce(async (current: AppData) => ({
      data: { ...current, providers: [] },
      message: 'remote Provider replacement',
      remoteAccepted: true,
      secrets: { providerKeys: {} },
    }))

    const pending = useAppStore
      .getState()
      .transcribeAudio(new File(['audio'], 'pending.wav', { type: 'audio/wav' }))
    await vi.waitFor(() =>
      expect(runtime.transcribeAudioFile).toHaveBeenCalledOnce(),
    )
    const signal = runtime.transcribeAudioFile.mock.calls[0]?.[0]?.signal as
      | AbortSignal
      | undefined

    await useAppStore.getState().syncNow()

    expect(signal?.aborted).toBe(true)
    expect(useAppStore.getState().data?.providers).toEqual([])
    resolveTranscription?.({
      model: 'transcription-model',
      text: 'stale remote transcript',
    })
    await expect(pending).resolves.toBeNull()
    expect(useAppStore.getState().transcribingAudio).toBe(false)
    expect(useAppStore.getState().toasts.map(({ message }) => message)).not.toContain(
      appT(data, 'composer.audioTranscriptionComplete'),
    )
  })

  it('keeps pending read-aloud when sync changes only an unrelated Provider name', async () => {
    const data = freshData()
    const activeProvider = data.providers[0]
    const unrelatedProvider = {
      ...activeProvider,
      id: 'unrelated-provider',
      name: 'Unrelated Provider',
      createdAt: activeProvider.createdAt + 1,
      updatedAt: activeProvider.updatedAt + 1,
    }
    data.providers = [activeProvider, unrelatedProvider]
    data.sync = { ...data.sync, mode: 'gist' }
    const assistant = message(
      'assistant-speech-unrelated-sync',
      'assistant',
      'Keep playing through unrelated sync changes',
    )
    data.conversations[0] = {
      ...data.conversations[0],
      messages: [assistant],
      providerId: activeProvider.id,
    }
    resetStore(data)
    useAppStore.setState({
      githubToken: 'github-token',
      syncPassphrase: 'passphrase',
    })
    let resolveSpeech: ((value: { blob: Blob; model: string }) => void) | undefined
    runtime.synthesizeSpeechAudio.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSpeech = resolve
        }),
    )
    const audio = {
      pause: vi.fn(),
      play: vi.fn(async () => undefined),
    }
    const AudioMock = vi.fn(function AudioMock() {
      return audio
    })
    vi.stubGlobal('Audio', AudioMock)
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:unrelated-sync-speech'),
      revokeObjectURL: vi.fn(),
    })
    syncMocks.performSync.mockImplementationOnce(async (current: AppData) => ({
      data: {
        ...current,
        providers: current.providers.map((provider) =>
          provider.id === unrelatedProvider.id
            ? { ...provider, name: 'Renamed Elsewhere', updatedAt: provider.updatedAt + 1 }
            : provider,
        ),
      },
      message: 'unrelated Provider metadata sync',
      remoteAccepted: true,
      secrets: { providerKeys: { [activeProvider.id]: 'test-key' } },
    }))

    const running = useAppStore.getState().speakMessage(assistant)
    await vi.waitFor(() =>
      expect(runtime.synthesizeSpeechAudio).toHaveBeenCalledOnce(),
    )
    const signal = runtime.synthesizeSpeechAudio.mock.calls[0]?.[0]?.signal as
      | AbortSignal
      | undefined

    await useAppStore.getState().syncNow()

    expect(signal?.aborted).toBe(false)
    resolveSpeech?.({
      blob: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
      model: 'speech-model',
    })
    await running
    expect(AudioMock).toHaveBeenCalledOnce()
    expect(audio.play).toHaveBeenCalledOnce()
    expect(useAppStore.getState().speakingMessageId).toBe(assistant.id)
  })

  it('cancels a pending Provider check when reset owns data replacement', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    useAppStore.setState({
      providerConnectivityResults: {
        [providerId]: {
          field: 'none',
          message: 'result before reset',
          retryable: false,
          tone: 'success',
        },
      },
    })
    let releaseCheck!: () => void
    const cancel = vi.fn()
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockImplementationOnce(
      (context: ProviderConnectivityCheckContext) => {
        context.modelLoadProviderIdRef.cancel = cancel
        return {
          checkProviderFullCapabilities: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                releaseCheck = () => {
                  context.setProviderConnectivityResults((current) => ({
                    ...current,
                    [providerId]: {
                      field: 'none',
                      message: 'stale reset result',
                      retryable: false,
                      tone: 'success',
                    },
                  }))
                  resolve()
                }
              }),
          ),
        }
      },
    )

    const checking = useAppStore
      .getState()
      .checkProviderFullCapabilities(providerId)
    await vi.waitFor(() => expect(releaseCheck).toEqual(expect.any(Function)))

    await useAppStore.getState().resetAll()

    expect(cancel).toHaveBeenCalledOnce()
    expect(useAppStore.getState().checkingProviderId).toBe('')
    releaseCheck()
    await checking
    expect(useAppStore.getState().providerConnectivityResults).toEqual({})
    expect(useAppStore.getState().checkingProviderId).toBe('')
  })

  it('rejects a pending Provider check after importing the same Provider id', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    await useAppStore.getState().setSyncPassphrase('passphrase')
    useAppStore.setState({
      providerConnectivityResults: {
        [providerId]: {
          field: 'none',
          message: 'result before import',
          retryable: false,
          tone: 'success',
        },
      },
    })
    let releaseCheck!: () => void
    const cancel = vi.fn()
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockImplementationOnce(
      (context: ProviderConnectivityCheckContext) => {
        context.modelLoadProviderIdRef.cancel = cancel
        return {
          checkProviderFullCapabilities: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                releaseCheck = () => {
                  context.setProviderModels(
                    providerId,
                    ['stale-import-model'],
                    'stale-import-model',
                  )
                  context.setProviderConnectivityResults((current) => ({
                    ...current,
                    [providerId]: {
                      field: 'none',
                      message: 'stale import result',
                      retryable: false,
                      tone: 'success',
                    },
                  }))
                  context.setNotice('stale import notice', 'error')
                  resolve()
                }
              }),
          ),
        }
      },
    )
    cryptoMocks.isEncryptedSnapshot.mockReturnValueOnce(true)
    cryptoMocks.decryptVault.mockResolvedValueOnce({
      data: structuredClone(data),
      secrets: { providerKeys: { [providerId]: 'imported-key' } },
    })

    const checking = useAppStore
      .getState()
      .checkProviderFullCapabilities(providerId)
    await vi.waitFor(() => expect(releaseCheck).toEqual(expect.any(Function)))
    await useAppStore
      .getState()
      .importBackup(new File(['{}'], 'backup.json', { type: 'application/json' }))

    expect(cancel).toHaveBeenCalledOnce()
    expect(useAppStore.getState().checkingProviderId).toBe('')
    releaseCheck()
    await checking

    expect(useAppStore.getState().data?.providers[0]?.models).not.toContain(
      'stale-import-model',
    )
    expect(
      useAppStore.getState().providerConnectivityResults[providerId],
    ).toBeUndefined()
    expect(useAppStore.getState().toasts).not.toContainEqual(
      expect.objectContaining({ message: 'stale import notice' }),
    )
    expect(useAppStore.getState().checkingProviderId).toBe('')
  })

  it('contains Provider capability notices when notification delivery fails', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    let completed = false
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockImplementationOnce(
      (context: ProviderConnectivityCheckContext) => ({
        checkProviderFullCapabilities: vi.fn(async () => {
          context.setNotice('capability notice', 'warning')
          completed = true
        }),
      }),
    )
    useAppStore.setState({
      notify: () => {
        throw new Error('notification channel unavailable')
      },
    })

    await expect(
      useAppStore.getState().checkProviderFullCapabilities(providerId),
    ).resolves.toBeUndefined()

    expect(completed).toBe(true)
    expect(consoleError).not.toHaveBeenCalled()
    expect(useAppStore.getState().checkingProviderId).toBe('')
    consoleError.mockRestore()
  })

  it('contains Provider capability failure notices after the action error is handled', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockReturnValue({
      checkProviderFullCapabilities: vi.fn(async () => {
        throw new Error('C:\\private\\provider sk-sentinel-secret')
      }),
    })
    useAppStore.setState({
      notify: () => {
        throw new Error('notification channel unavailable')
      },
    })

    await expect(
      useAppStore.getState().checkProviderFullCapabilities(providerId),
    ).resolves.toBeUndefined()

    expect(consoleError).toHaveBeenCalledOnce()
    expect(useAppStore.getState().checkingProviderId).toBe('')
    expect(useAppStore.getState().toasts).toHaveLength(0)
    consoleError.mockRestore()
  })

  it('runs the Provider model-list and chat connectivity check through the current store', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const runProviderConnectivityCheck = vi.fn(async (id: string) => {
      expect(id).toBe(providerId)
      return null
    })
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockReturnValue({
      runProviderConnectivityCheck,
    })

    await useAppStore.getState().checkProviderConnectivity(providerId)

    expect(runProviderConnectivityCheck).toHaveBeenCalledOnce()
    expect(useAppStore.getState().checkingProviderId).toBe('')
  })

  it('passes path-safe Provider diagnostics through the current Store action boundary', async () => {
    const data = freshData()
    const providerId = data.providers[0].id
    data.providers[0] = {
      ...data.providers[0],
      capabilities: ['chat', 'embeddings'],
      embeddingModel: 'provider-embedding',
      kind: 'openai-compatible',
      model: 'provider-chat',
      models: ['provider-chat'],
    }
    resetStore(data)
    const failure = Object.assign(
      new Error(
        'C:\\private\\provider.log \\\\host\\share\\secret \\\\?\\D:\\QA\\private.txt /home/alice/.config/zerochat /tmp/zerochat https://relay.example.test/v1/models api_key=sk-provider-secret',
      ),
      { code: 'server', retryable: true, status: 502 },
    )
    failure.message += ' "\\\\quoted-host\\share with spaces\\private secret.txt"'
    runtime.listProviderModels.mockResolvedValueOnce(['provider-chat'])
    runtime.streamChat.mockRejectedValueOnce(failure)
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockImplementationOnce(
      (context, services) =>
        providerConnectivityMocks.actualCreateProviderConnectivityCheckActions!(
          context,
          services,
        ),
    )

    await i18nMocks.actualLoadLocale!('en-US')
    await useAppStore.getState().checkProviderConnectivity(providerId)

    const result = useAppStore.getState().providerConnectivityResults[providerId]
    expect(runtime.listProviderModels).toHaveBeenCalledOnce()
    expect(runtime.streamChat).toHaveBeenCalledOnce()
    expect(result?.message).toContain('/chat/completions · provider-chat · HTTP 502')
    expect(result?.message).not.toContain('C:\\private\\provider.log')
    expect(result?.message).not.toContain('\\\\quoted-host\\share with spaces\\private secret.txt')
    expect(result?.message).not.toContain('private secret.txt')
    expect(result?.message).not.toContain('\\\\host\\share\\secret')
    expect(result?.message).not.toContain('\\\\?\\D:\\QA\\private.txt')
    expect(result?.message).not.toContain('/home/alice/.config/zerochat')
    expect(result?.message).not.toContain('/tmp/zerochat')
    expect(result?.message).not.toContain('sk-provider-secret')
    expect(result?.message).toContain('[redacted-path]')
    expect(result?.message).toContain('[redacted-url]')
    const toast = useAppStore.getState().toasts.at(-1)?.message ?? ''
    expect(toast).toBe(result?.message)
    expect(toast).not.toContain('C:\\private\\provider.log')
    expect(toast).not.toContain('\\\\quoted-host\\share with spaces\\private secret.txt')
    expect(toast).not.toContain('private secret.txt')
    expect(toast).not.toContain('\\\\host\\share\\secret')
    expect(toast).not.toContain('\\\\?\\D:\\QA\\private.txt')
    expect(toast).not.toContain('/home/alice/.config/zerochat')
    expect(toast).not.toContain('/tmp/zerochat')
    expect(toast).not.toContain('sk-provider-secret')

    const markup = renderToStaticMarkup(h(SettingsView, {}))
    expect(markup).toContain(result?.message ?? '')
    expect(markup).not.toContain('C:\\private\\provider.log')
    expect(markup).not.toContain('\\\\quoted-host\\share with spaces\\private secret.txt')
    expect(markup).not.toContain('private secret.txt')
    expect(markup).not.toContain('\\\\host\\share\\secret')
    expect(markup).not.toContain('\\\\?\\D:\\QA\\private.txt')
    expect(markup).not.toContain('/home/alice/.config/zerochat')
    expect(markup).not.toContain('/tmp/zerochat')
    expect(markup).not.toContain('sk-provider-secret')
  })

  it('keeps a Provider connectivity check owned through a display-name edit', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    let releaseCheck!: () => void
    const cancel = vi.fn()
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockImplementationOnce(
      (context: ProviderConnectivityCheckContext) => {
        context.modelLoadProviderIdRef.cancel = cancel
        return {
          runProviderConnectivityCheck: vi.fn(
            () =>
              new Promise<null>((resolve) => {
                releaseCheck = () => {
                  context.setProviderConnectivityResults((current) => ({
                    ...current,
                    [providerId]: {
                      field: 'none',
                      message: 'display-name-stable result',
                      retryable: false,
                      tone: 'success',
                    },
                  }))
                  resolve(null)
                }
              }),
          ),
        }
      },
    )

    const checking = useAppStore
      .getState()
      .checkProviderConnectivity(providerId)
    await vi.waitFor(() => expect(releaseCheck).toEqual(expect.any(Function)))

    useAppStore.getState().updateProvider(providerId, {
      name: 'Renamed Provider',
    })

    expect(cancel).not.toHaveBeenCalled()
    expect(useAppStore.getState().checkingProviderId).toBe(
      `provider:${providerId}`,
    )

    releaseCheck()
    await checking

    expect(useAppStore.getState().providerConnectivityResults[providerId]).toMatchObject({
      message: 'display-name-stable result',
    })
    expect(useAppStore.getState().checkingProviderId).toBe('')
  })

  it('rejects a late full-capability result when a name changes its fallback plan', async () => {
    const data = resetStore()
    const provider = data.providers[0]
    const providerId = provider.id
    provider.baseUrl = 'https://relay.example.com/v1'
    provider.capabilities = undefined
    provider.name = 'OpenAI'
    expect(fallbackCapabilitiesForProvider(provider)).toContain('moderation')

    let releaseCheck!: () => void
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockImplementationOnce(
      (context: ProviderConnectivityCheckContext) => ({
        checkProviderFullCapabilities: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releaseCheck = () => {
                context.setProviderConnectivityResults((current) => ({
                  ...current,
                  [providerId]: {
                    field: 'none',
                    message: 'stale fallback capability result',
                    retryable: false,
                    tone: 'success',
                  },
                }))
                resolve()
              }
            }),
        ),
      }),
    )

    const checking = useAppStore.getState().checkProviderFullCapabilities(providerId)
    await vi.waitFor(() => expect(releaseCheck).toEqual(expect.any(Function)))

    useAppStore.getState().updateProvider(providerId, {
      name: 'Generic Relay',
    })
    expect(fallbackCapabilitiesForProvider(
      useAppStore.getState().data!.providers[0]!,
    )).not.toContain('moderation')

    releaseCheck()
    await checking

    expect(useAppStore.getState().providerConnectivityResults[providerId]).toBeUndefined()
  })

  it('clears a completed full-capability result when a name changes its fallback plan', () => {
    const data = resetStore()
    const provider = data.providers[0]
    const providerId = provider.id
    provider.baseUrl = 'https://relay.example.com/v1'
    provider.capabilities = undefined
    provider.name = 'OpenAI'
    expect(fallbackCapabilitiesForProvider(provider)).toContain('moderation')
    useAppStore.setState({
      providerConnectivityResults: {
        [providerId]: {
          capabilityResults: {
            moderation: {
              message: 'previous moderation result',
              model: 'provider-chat',
              status: 'passed',
              tone: 'success',
            },
          },
          field: 'none',
          message: 'previous capability result',
          retryable: false,
          tone: 'success',
        },
      },
    })

    useAppStore.getState().updateProvider(providerId, {
      name: 'Generic Relay',
    })

    expect(useAppStore.getState().providerConnectivityResults[providerId]).toBeUndefined()
  })

  it('rejects stale Provider check writes after a transport owner changes', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    let releaseCheck!: () => void
    const pendingCheck = new Promise<void>((resolve) => {
      releaseCheck = resolve
    })
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockImplementation(
      (context: ProviderConnectivityCheckContext) => ({
        checkProviderFullCapabilities: vi.fn(async () => {
          await pendingCheck
          context.setProviderModels(
            providerId,
            ['stale-model'],
            'stale-model',
          )
          context.setProviderConnectivityResults((current) => ({
            ...current,
            [providerId]: {
              field: 'none',
              message: 'stale result',
              retryable: false,
              tone: 'success',
            },
          }))
        }),
      }),
    )

    const run = useAppStore
      .getState()
      .checkProviderFullCapabilities(providerId)
    await vi.waitFor(() => {
      expect(
        providerConnectivityMocks.createProviderConnectivityCheckActions,
      ).toHaveBeenCalledOnce()
    })

    useAppStore.getState().updateProvider(providerId, {
      baseUrl: 'https://changed.invalid/v1',
    })
    releaseCheck()
    await run

    expect(useAppStore.getState().data?.providers[0]).toMatchObject({
      baseUrl: 'https://changed.invalid/v1',
    })
    expect(useAppStore.getState().data?.providers[0].models).not.toContain(
      'stale-model',
    )
    expect(
      useAppStore.getState().providerConnectivityResults[providerId],
    ).toBeUndefined()
  })

  it('rejects a Provider check while a model catalog mutation is becoming durable', async () => {
    const data = freshData()
    const providerId = data.providers[0].id
    data.providers[0] = {
      ...data.providers[0],
      model: 'model-a',
      models: ['model-a', 'model-b'],
    }
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseCheck!: () => void
    const pendingCheck = new Promise<void>((resolve) => {
      releaseCheck = resolve
    })
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockImplementation(
      (context: ProviderConnectivityCheckContext) => ({
        checkProviderFullCapabilities: vi.fn(async () => {
          await pendingCheck
          context.setProviderModels(providerId, ['stale-model'], 'stale-model')
          context.setNotice('stale model catalog notice', 'error')
          context.setProviderConnectivityResults((current) => ({
            ...current,
            [providerId]: {
              field: 'none',
              message: 'stale model catalog result',
              retryable: false,
              tone: 'success',
            },
          }))
        }),
      }),
    )

    const checking = useAppStore
      .getState()
      .checkProviderFullCapabilities(providerId)
    await vi.waitFor(() =>
      expect(
        providerConnectivityMocks.createProviderConnectivityCheckActions,
      ).toHaveBeenCalledOnce(),
    )

    let releaseSave!: () => void
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve
        }),
    )
    const renaming = useAppStore
      .getState()
      .renameProviderModel(providerId, 'model-a', 'renamed-model')
    await vi.waitFor(() => expect(releaseSave).toEqual(expect.any(Function)))

    releaseCheck()
    await checking

    expect(useAppStore.getState().data?.providers[0]).toMatchObject({
      model: 'model-a',
      models: ['model-a', 'model-b'],
    })
    expect(
      useAppStore.getState().providerConnectivityResults[providerId],
    ).toBeUndefined()
    expect(useAppStore.getState().toasts).toHaveLength(0)

    releaseSave()
    await expect(renaming).resolves.toBe(true)
    expect(useAppStore.getState().data?.providers[0]).toMatchObject({
      model: 'renamed-model',
      models: ['renamed-model', 'model-b'],
    })
  })

  it('drops a Provider check that starts after an admitted model mutation commits', async () => {
    const data = freshData()
    const providerId = data.providers[0].id
    data.providers[0] = {
      ...data.providers[0],
      model: 'model-a',
      models: ['model-a', 'model-b'],
    }
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseSave!: () => void
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve
        }),
    )

    let releaseCheck!: () => void
    const cancel = vi.fn()
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockImplementationOnce(
      (context: ProviderConnectivityCheckContext) => {
        context.modelLoadProviderIdRef.cancel = cancel
        return {
          checkProviderFullCapabilities: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                releaseCheck = resolve
              }).then(() => {
                context.setProviderModels(providerId, ['stale-model'], 'stale-model')
                context.setNotice('stale model mutation notice', 'error')
                context.setProviderConnectivityResults((current) => ({
                  ...current,
                  [providerId]: {
                    field: 'none',
                    message: 'stale model mutation result',
                    retryable: false,
                    tone: 'success',
                  },
                }))
              }),
          ),
        }
      },
    )

    const renaming = useAppStore
      .getState()
      .renameProviderModel(providerId, 'model-a', 'renamed-model')
    await vi.waitFor(() => expect(releaseSave).toEqual(expect.any(Function)))

    const checking = useAppStore
      .getState()
      .checkProviderFullCapabilities(providerId)
    await vi.waitFor(() => expect(releaseCheck).toEqual(expect.any(Function)))

    releaseSave()
    await expect(renaming).resolves.toBe(true)
    expect(useAppStore.getState().data?.providers[0]).toMatchObject({
      model: 'renamed-model',
      models: ['renamed-model', 'model-b'],
    })
    expect(cancel).toHaveBeenCalledOnce()

    releaseCheck()
    await checking

    expect(useAppStore.getState().data?.providers[0]).toMatchObject({
      model: 'renamed-model',
      models: ['renamed-model', 'model-b'],
    })
    expect(
      useAppStore.getState().providerConnectivityResults[providerId],
    ).toBeUndefined()
    expect(useAppStore.getState().toasts).toHaveLength(0)
  })

  it('rejects a Provider check after its effective Worker endpoint changes', async () => {
    const data = freshData()
    const providerId = data.providers[0].id
    data.providers[0] = {
      ...data.providers[0],
      clientRequestMode: false,
      proxyUrl: undefined,
    }
    data.sync = {
      ...data.sync,
      mode: 'cloudflare',
      workerEndpoint: 'https://old-worker.invalid',
    }
    resetStore(data)

    let releaseCheck!: () => void
    const pendingCheck = new Promise<void>((resolve) => {
      releaseCheck = resolve
    })
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockImplementation(
      (context: ProviderConnectivityCheckContext) => ({
        checkProviderFullCapabilities: vi.fn(async () => {
          await pendingCheck
          context.setNotice('stale Worker endpoint notice', 'error')
          context.setProviderConnectivityResults((current) => ({
            ...current,
            [providerId]: {
              field: 'none',
              message: 'stale Worker endpoint result',
              retryable: false,
              tone: 'success',
            },
          }))
        }),
      }),
    )

    const checking = useAppStore
      .getState()
      .checkProviderFullCapabilities(providerId)
    await vi.waitFor(() =>
      expect(
        providerConnectivityMocks.createProviderConnectivityCheckActions,
      ).toHaveBeenCalledOnce(),
    )

    useAppStore
      .getState()
      .setSyncWorkerEndpoint('https://new-worker.invalid')
    releaseCheck()
    await checking

    expect(useAppStore.getState().data?.sync.workerEndpoint).toBe(
      'https://new-worker.invalid',
    )
    expect(
      useAppStore.getState().providerConnectivityResults[providerId],
    ).toBeUndefined()
    expect(useAppStore.getState().toasts).toHaveLength(0)
    expect(useAppStore.getState().checkingProviderId).toBe('')
  })

  it('keeps a restarted Provider check owned when the stale same-key run settles', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const releases: Array<() => void> = []
    const cancels: Array<ReturnType<typeof vi.fn>> = []
    let invocation = 0
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockImplementation(
      (context: ProviderConnectivityCheckContext) => {
        const currentInvocation = ++invocation
        const cancel = vi.fn()
        cancels.push(cancel)
        context.modelLoadProviderIdRef.cancel = cancel
        return {
          checkProviderFullCapabilities: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                releases.push(() => {
                  context.setProviderConnectivityResults((current) => ({
                    ...current,
                    [providerId]: {
                      field: 'none',
                      message: `run ${currentInvocation}`,
                      retryable: false,
                      tone: 'success',
                    },
                  }))
                  resolve()
                })
              }),
          ),
        }
      },
    )

    const firstRun = useAppStore
      .getState()
      .checkProviderFullCapabilities(providerId)
    await vi.waitFor(() => expect(releases).toHaveLength(1))
    useAppStore.getState().updateProvider(providerId, {
      baseUrl: 'https://changed.invalid/v1',
    })
    expect(cancels[0]).toHaveBeenCalledOnce()

    const secondRun = useAppStore
      .getState()
      .checkProviderFullCapabilities(providerId)
    await vi.waitFor(() => expect(releases).toHaveLength(2))
    releases[0]()
    await firstRun

    expect(useAppStore.getState().checkingProviderId).toBe(
      `${providerId}:capabilities`,
    )
    expect(
      useAppStore.getState().providerConnectivityResults[providerId],
    ).toBeUndefined()

    releases[1]()
    await secondRun
    expect(useAppStore.getState().providerConnectivityResults[providerId]).toMatchObject(
      { message: 'run 2' },
    )
    expect(useAppStore.getState().checkingProviderId).toBe('')
  })

  it('invalidates a Provider check before a durable credential write settles', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    let releaseCheck!: () => void
    let releaseKeyWrite!: () => void
    const pendingCheck = new Promise<void>((resolve) => {
      releaseCheck = resolve
    })
    secretMocks.setProviderKey.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releaseKeyWrite = () => resolve(undefined)
        }),
    )
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockImplementation(
      (context: ProviderConnectivityCheckContext) => ({
        checkProviderFullCapabilities: vi.fn(async () => {
          await pendingCheck
          context.setProviderConnectivityResults((current) => ({
            ...current,
            [providerId]: {
              field: 'none',
              message: 'stale credential result',
              retryable: false,
              tone: 'success',
            },
          }))
        }),
      }),
    )

    const checkRun = useAppStore
      .getState()
      .checkProviderFullCapabilities(providerId)
    await vi.waitFor(() => {
      expect(
        providerConnectivityMocks.createProviderConnectivityCheckActions,
      ).toHaveBeenCalledOnce()
    })
    const keyWrite = useAppStore.getState().saveProviderKey(providerId, 'new-key')
    await vi.waitFor(() => expect(secretMocks.setProviderKey).toHaveBeenCalledOnce())

    releaseCheck()
    await checkRun
    expect(
      useAppStore.getState().providerConnectivityResults[providerId],
    ).toBeUndefined()

    releaseKeyWrite()
    await keyWrite
    expect(useAppStore.getState().keys[providerId]).toBe('new-key')
  })

  it('invalidates a proxied Provider capability check before a sync passphrase write settles', async () => {
    const data = freshData()
    const providerId = data.providers[0].id
    data.providers[0] = {
      ...data.providers[0],
      capabilities: ['chat', 'embeddings', 'model-list'],
      clientRequestMode: false,
      embeddingModel: 'embedding-model',
      model: 'chat-model',
      models: ['chat-model', 'embedding-model'],
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'old-passphrase' })

    let releaseAccessKey!: (value: string) => void
    accessKeyMocks.accessKeyFromPassword.mockImplementationOnce(
      () => {
        return new Promise<string>((resolve) => {
          releaseAccessKey = resolve
        })
      },
    )
    const fetch = vi.fn(async () => {
      throw new Error('stale Provider capability request')
    })
    vi.stubGlobal('fetch', fetch)
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockImplementationOnce(
      (context, services) =>
        providerConnectivityMocks.actualCreateProviderConnectivityCheckActions!(
          context,
          services,
        ),
    )

    const checking = useAppStore
      .getState()
      .checkProviderCapability(providerId, 'embeddings')
    await vi.waitFor(() =>
      expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledWith(
        'old-passphrase',
      ),
    )

    await useAppStore.getState().setSyncPassphrase('new-passphrase')
    releaseAccessKey('stale-proxy-token')
    await checking

    expect(fetch).not.toHaveBeenCalled()
    expect(useAppStore.getState().providerConnectivityResults).toEqual({})
    expect(useAppStore.getState().toasts).toHaveLength(0)
    expect(useAppStore.getState().checkingProviderId).toBe('')
  })

  it('clears only proxy Provider capability results after a sync passphrase changes', async () => {
    const data = freshData()
    const proxyProvider = {
      ...data.providers[0],
      clientRequestMode: false,
      id: 'proxy-provider',
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    const directProvider = {
      ...data.providers[0],
      clientRequestMode: true,
      id: 'direct-provider',
      name: 'Direct Provider',
      proxyUrl: undefined,
    }
    data.providers = [proxyProvider, directProvider]
    resetStore(data)
    useAppStore.setState({
      providerConnectivityResults: {
        [proxyProvider.id]: {
          field: 'none',
          message: 'proxy result from old passphrase',
          retryable: false,
          tone: 'success',
        },
        [directProvider.id]: {
          field: 'none',
          message: 'direct result remains valid',
          retryable: false,
          tone: 'success',
        },
      },
    })

    await useAppStore.getState().setSyncPassphrase('new-passphrase')

    expect(useAppStore.getState().providerConnectivityResults).toEqual({
      [directProvider.id]: expect.objectContaining({
        message: 'direct result remains valid',
      }),
    })
  })

  it('runs one Provider capability through the current store with a scoped busy owner', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    let resolveCheck!: () => void
    const pendingCheck = new Promise<void>((resolve) => {
      resolveCheck = resolve
    })
    const checkProviderCapability = vi.fn(() => pendingCheck)
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockReturnValue({
      checkProviderCapability,
    })

    const run = useAppStore
      .getState()
      .checkProviderCapability(providerId, 'image-generation')

    expect(useAppStore.getState().checkingProviderId).toBe(
      `${providerId}:capability:image-generation`,
    )
    await vi.waitFor(() => {
      expect(checkProviderCapability).toHaveBeenCalledTimes(1)
    })
    await useAppStore
      .getState()
      .checkProviderCapability(providerId, 'moderation')
    expect(checkProviderCapability).toHaveBeenCalledTimes(1)

    resolveCheck()
    await run

    expect(checkProviderCapability).toHaveBeenCalledWith(
      providerId,
      'image-generation',
    )
    expect(useAppStore.getState().checkingProviderId).toBe('')
  })

  it('contains missing-Provider notices before opening Settings', async () => {
    const data = freshData()
    data.providers = []
    data.conversations = []
    data.preferences.activeConversationId = undefined
    resetStore(data)
    useAppStore.setState({
      settingsOpen: false,
      notify: () => {
        throw new Error('notification channel unavailable')
      },
    })

    await expect(useAppStore.getState().createNewConversation()).resolves.toBe(false)

    expect(useAppStore.getState().settingsOpen).toBe(true)
    expect(useAppStore.getState().data).toBe(data)
  })

  it('exercises state guards for empty data, credentials, models, and images', async () => {
    resetStore()
    useAppStore.setState({ data: null })
    await expect(useAppStore.getState().createNewConversation()).resolves.toBe(false)
    await expect(
      useAppStore.getState().setActiveConversation('missing'),
    ).resolves.toBe(false)
    expect(await useAppStore.getState().sendMessage('ignored')).toBe(false)

    const noProvider = freshData()
    noProvider.providers = []
    noProvider.conversations = []
    noProvider.preferences.activeConversationId = undefined
    useAppStore.setState({ data: noProvider, keys: {}, settingsOpen: false })
    await expect(useAppStore.getState().createNewConversation()).resolves.toBe(false)
    expect(useAppStore.getState().settingsOpen).toBe(true)
    expect(await useAppStore.getState().sendMessage('needs provider')).toBe(false)
    expect(useAppStore.getState().toasts.at(-1)?.tone).toBe('error')

    resetStore()
    await expect(
      useAppStore.getState().setConversationModelChoice('missing', 'missing', ''),
    ).resolves.toBe(false)
    await useAppStore.getState().fetchModels('missing')
    await useAppStore.getState().attachImage(new File([], 'bad.txt', { type: 'text/plain' }))
    const tooLarge = imageFile()
    Object.defineProperty(tooLarge, 'size', { value: MAX_IMAGE_BYTES + 1 })
    await useAppStore.getState().attachImage(tooLarge)
    await useAppStore.getState().attachImage(imageFile())
    expect(useAppStore.getState().composerImages).toHaveLength(1)
    const attachedId = useAppStore.getState().composerImages[0].id
    expect(await useAppStore.getState().sendMessage('')).toBe(true)
    expect(useAppStore.getState().data?.conversations[0].messages[0]).toMatchObject({
      content: '',
      role: 'user',
    })
    useAppStore.getState().removeImage(attachedId)
    useAppStore.getState().notify('default tone')

    expect(await useAppStore.getState().sendMessage('')).toBe(false)
    expect(await useAppStore.getState().sendMessage('', { mode: 'image' })).toBe(false)
    useAppStore.setState({ sending: true })
    expect(await useAppStore.getState().sendMessage('already sending')).toBe(false)
    useAppStore.setState({ sending: false, keys: {} })
    expect(await useAppStore.getState().sendMessage('needs key')).toBe(false)
    expect(useAppStore.getState().settingsOpen).toBe(true)

    const noModel = freshData()
    noModel.providers[0] = {
      ...noModel.providers[0],
      model: '',
      models: [],
    }
    noModel.conversations[0] = {
      ...noModel.conversations[0],
      model: '',
      providerId: noModel.providers[0].id,
    }
    useAppStore.setState({
      data: noModel,
      keys: { [noModel.providers[0].id]: 'test-key' },
      settingsOpen: false,
    })
    expect(await useAppStore.getState().sendMessage('needs model')).toBe(false)
    expect(useAppStore.getState().toasts.at(-1)?.message).toContain('Model')

    const imageInvalid = freshData()
    useAppStore.setState({
      data: imageInvalid,
      keys: { [imageInvalid.providers[0].id]: 'test-key' },
      settingsOpen: false,
    })
    expect(await useAppStore.getState().sendMessage('bad source', {
      imageSourceFile: imageFile('bad.txt', 'text/plain'),
      imageTaskMode: 'edit',
      mode: 'image',
    })).toBe(false)
    expect(await useAppStore.getState().sendMessage('missing mask', {
      imageSourceFile: imageFile(),
      imageTaskMode: 'inpaint',
      mode: 'image',
    })).toBe(false)
    const noImageModel = freshData()
    noImageModel.providers[0] = {
      ...noImageModel.providers[0],
      imageModel: '',
      models: ['chat-model'],
    }
    noImageModel.conversations[0] = {
      ...noImageModel.conversations[0],
      model: 'chat-model',
      providerId: noImageModel.providers[0].id,
    }
    useAppStore.setState({
      data: noImageModel,
      keys: { [noImageModel.providers[0].id]: 'test-key' },
      settingsOpen: false,
    })
    expect(await useAppStore.getState().sendMessage('needs image model', {
      mode: 'image',
      imageTaskMode: 'generate',
    })).toBe(false)
    expect(useAppStore.getState().settingsOpen).toBe(true)

    const proxyData = freshData()
    proxyData.providers[0] = {
      ...proxyData.providers[0],
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    useAppStore.setState({ data: proxyData, syncPassphrase: '' })
    expect(await useAppStore.getState().sendMessage('needs passphrase')).toBe(false)
    expect(useAppStore.getState().data?.conversations[0].messages).toHaveLength(0)
    await useAppStore.getState().fetchModels(proxyData.providers[0].id)
    expect(useAppStore.getState().toasts.at(-1)?.message).toContain('passphrase')
  })

  it('contains image attachment read failures without exposing the raw error', async () => {
    const data = resetStore()
    const sentinel = 'C:\\private\\image-upload sk-secret-1234567890'
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    imageMocks.fileToDataUrl.mockRejectedValueOnce(new Error(sentinel))

    await expect(useAppStore.getState().attachImage(imageFile())).resolves.toBeUndefined()

    expect(useAppStore.getState().composerImages).toEqual([])
    const notice = useAppStore.getState().toasts.at(-1)?.message ?? ''
    expect(notice).toBe(appT(data, 'composer.unsupportedImage'))
    expect(notice).not.toContain(sentinel)
    expect(consoleError).toHaveBeenCalledWith('[app] image attachment read failed')
    expectConsoleErrorDoesNotExpose(consoleError, sentinel)
  })

  it('drops an image attachment that finishes after local data reset', async () => {
    resetStore()
    let resolveFile!: (dataUrl: string) => void
    const pendingRead = new Promise<string>((resolve) => {
      resolveFile = resolve
    })
    imageMocks.fileToDataUrl.mockReturnValueOnce(pendingRead)

    const attaching = useAppStore.getState().attachImage(imageFile())
    await vi.waitFor(() =>
      expect(imageMocks.fileToDataUrl).toHaveBeenCalledOnce(),
    )

    await useAppStore.getState().resetAll()
    expect(useAppStore.getState().composerImages).toEqual([])

    resolveFile('data:image/png;base64,STALE')
    await attaching

    expect(useAppStore.getState().composerImages).toEqual([])
  })

  it('ignores a stale image attachment read failure after local data reset', async () => {
    resetStore()
    let rejectFile!: (reason?: unknown) => void
    const pendingRead = new Promise<string>((_resolve, reject) => {
      rejectFile = reject
    })
    imageMocks.fileToDataUrl.mockReturnValueOnce(pendingRead)

    const attaching = useAppStore.getState().attachImage(imageFile())
    await vi.waitFor(() =>
      expect(imageMocks.fileToDataUrl).toHaveBeenCalledOnce(),
    )

    await useAppStore.getState().resetAll()
    const noticesAfterReset = useAppStore.getState().toasts
    rejectFile(new Error('C:\\private\\stale-image-read'))
    await attaching

    expect(useAppStore.getState().composerImages).toEqual([])
    expect(useAppStore.getState().toasts).toEqual(noticesAfterReset)
  })

  it('keeps a pending image attachment across an ordinary AppData update', async () => {
    resetStore()
    let resolveFile!: (dataUrl: string) => void
    const pendingRead = new Promise<string>((resolve) => {
      resolveFile = resolve
    })
    imageMocks.fileToDataUrl.mockReturnValueOnce(pendingRead)

    const attaching = useAppStore.getState().attachImage(imageFile())
    await vi.waitFor(() =>
      expect(imageMocks.fileToDataUrl).toHaveBeenCalledOnce(),
    )

    useAppStore.getState().setTheme('dark')
    resolveFile('data:image/png;base64,ORDINARY_UPDATE')
    await attaching

    expect(useAppStore.getState().composerImages).toHaveLength(1)
    expect(useAppStore.getState().composerImages[0].dataUrl).toBe(
      'data:image/png;base64,ORDINARY_UPDATE',
    )
  })

  it('drops a pending image attachment when a durable conversation switch changes its owner', async () => {
    const data = resetStore()
    const first = data.conversations[0]
    const second = { ...structuredClone(first), id: 'image-switch-second' }
    data.conversations.push(second)
    await useAppStore.getState().flushLocalSaves()

    let resolveFile!: (dataUrl: string) => void
    const pendingRead = new Promise<string>((resolve) => {
      resolveFile = resolve
    })
    imageMocks.fileToDataUrl.mockReturnValueOnce(pendingRead)

    const attaching = useAppStore
      .getState()
      .attachImage(imageFile('before-conversation-switch.png'))
    await vi.waitFor(() =>
      expect(imageMocks.fileToDataUrl).toHaveBeenCalledOnce(),
    )

    await expect(
      useAppStore.getState().setActiveConversation(second.id),
    ).resolves.toBe(true)
    expect(useAppStore.getState().data?.preferences.activeConversationId).toBe(
      second.id,
    )

    resolveFile('data:image/png;base64,STALE_AFTER_CONVERSATION_SWITCH')
    await attaching

    expect(useAppStore.getState().composerImages).toEqual([])
  })

  it('keeps a pending image attachment when a conversation switch fails', async () => {
    const data = resetStore()
    const first = data.conversations[0]
    const second = { ...structuredClone(first), id: 'image-switch-failed-second' }
    data.conversations.push(second)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockRejectedValueOnce(new Error('conversation switch failed'))

    let resolveFile!: (dataUrl: string) => void
    const pendingRead = new Promise<string>((resolve) => {
      resolveFile = resolve
    })
    imageMocks.fileToDataUrl.mockReturnValueOnce(pendingRead)

    const attaching = useAppStore
      .getState()
      .attachImage(imageFile('before-failed-switch.png'))
    await vi.waitFor(() =>
      expect(imageMocks.fileToDataUrl).toHaveBeenCalledOnce(),
    )

    await expect(
      useAppStore.getState().setActiveConversation(second.id),
    ).resolves.toBe(false)
    expect(useAppStore.getState().data?.preferences.activeConversationId).toBe(
      first.id,
    )

    resolveFile('data:image/png;base64,KEEP_AFTER_FAILED_SWITCH')
    await attaching

    expect(useAppStore.getState().composerImages).toEqual([
      expect.objectContaining({
        dataUrl: 'data:image/png;base64,KEEP_AFTER_FAILED_SWITCH',
        name: 'before-failed-switch.png',
      }),
    ])
  })

  it('drops a pending image attachment when its active conversation is deleted', async () => {
    const data = resetStore()
    const first = data.conversations[0]
    const second = { ...structuredClone(first), id: 'image-delete-fallback' }
    data.conversations.push(second)
    await useAppStore.getState().flushLocalSaves()

    let resolveFile!: (dataUrl: string) => void
    const pendingRead = new Promise<string>((resolve) => {
      resolveFile = resolve
    })
    imageMocks.fileToDataUrl.mockReturnValueOnce(pendingRead)

    const attaching = useAppStore
      .getState()
      .attachImage(imageFile('before-conversation-delete.png'))
    await vi.waitFor(() =>
      expect(imageMocks.fileToDataUrl).toHaveBeenCalledOnce(),
    )

    await expect(
      useAppStore.getState().deleteConversation(first.id),
    ).resolves.toBe(true)
    expect(useAppStore.getState().data?.preferences.activeConversationId).toBe(
      second.id,
    )

    resolveFile('data:image/png;base64,STALE_AFTER_CONVERSATION_DELETE')
    await attaching

    expect(useAppStore.getState().composerImages).toEqual([])
  })

  it('keeps concurrent image attachments from cancelling one another', async () => {
    resetStore()
    let resolveFirst!: (dataUrl: string) => void
    let resolveSecond!: (dataUrl: string) => void
    const firstRead = new Promise<string>((resolve) => {
      resolveFirst = resolve
    })
    const secondRead = new Promise<string>((resolve) => {
      resolveSecond = resolve
    })
    imageMocks.fileToDataUrl
      .mockImplementationOnce(() => firstRead)
      .mockImplementationOnce(() => secondRead)

    const first = useAppStore.getState().attachImage(imageFile('first.png'))
    const second = useAppStore.getState().attachImage(imageFile('second.png'))
    await vi.waitFor(() =>
      expect(imageMocks.fileToDataUrl).toHaveBeenCalledTimes(2),
    )

    resolveSecond('data:image/png;base64,SECOND')
    resolveFirst('data:image/png;base64,FIRST')
    await Promise.all([first, second])

    expect(useAppStore.getState().composerImages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'first.png', dataUrl: 'data:image/png;base64,FIRST' }),
        expect.objectContaining({ name: 'second.png', dataUrl: 'data:image/png;base64,SECOND' }),
      ]),
    )
  })

  it('drops an attachment that finishes after a text send takes ownership', async () => {
    resetStore()
    let resolveFile!: (dataUrl: string) => void
    const pendingRead = new Promise<string>((resolve) => {
      resolveFile = resolve
    })
    imageMocks.fileToDataUrl.mockReturnValueOnce(pendingRead)

    const attaching = useAppStore.getState().attachImage(imageFile())
    await vi.waitFor(() =>
      expect(imageMocks.fileToDataUrl).toHaveBeenCalledOnce(),
    )
    const sending = useAppStore.getState().sendMessage('take the composer')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())

    resolveFile('data:image/png;base64,STALE_AFTER_SEND')
    await attaching
    await sending

    expect(useAppStore.getState().composerImages).toEqual([])
  })

  it('contains rejected notification delivery for unsupported image attachments', async () => {
    resetStore()
    useAppStore.setState({
      notify: () => {
        throw new Error('notification channel unavailable')
      },
    })

    await expect(
      useAppStore
        .getState()
        .attachImage(new File([], 'bad.txt', { type: 'text/plain' })),
    ).resolves.toBeUndefined()

    expect(useAppStore.getState().composerImages).toEqual([])
  })

  it('contains rejected notification delivery for oversized image attachments', async () => {
    resetStore()
    const file = imageFile()
    Object.defineProperty(file, 'size', { value: MAX_IMAGE_BYTES + 1 })
    useAppStore.setState({
      notify: () => {
        throw new Error('notification channel unavailable')
      },
    })

    await expect(useAppStore.getState().attachImage(file)).resolves.toBeUndefined()

    expect(useAppStore.getState().composerImages).toEqual([])
  })

  it('contains proxy access-key derivation failures across current user actions', async () => {
    await i18nMocks.actualLoadLocale!('en-US')
    setRuntimeLocale('en-US')
    const sentinel = 'C:\\private\\proxy-access-key-secret'
    const error = new Error(sentinel)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    accessKeyMocks.accessKeyFromPassword.mockRejectedValue(error)
    const expectedNotice = translate(
      'en-US',
      'notice.syncAccessKeyDerivationFailed',
    )
    const resetProxiedStore = () => {
      const data = freshData()
      data.preferences.language = 'en-US'
      data.providers[0] = {
        ...data.providers[0],
        clientRequestMode: false,
        needsApiKey: false,
        proxyUrl: 'https://proxy.invalid',
      }
      resetStore(data)
      useAppStore.setState({ syncPassphrase: 'test-passphrase' })
      return data
    }
    const expectStableNotice = () => {
      const notice = useAppStore.getState().toasts.at(-1)?.message ?? ''
      expect(notice).toBe(expectedNotice)
      expect(notice).not.toContain(sentinel)
      expect(notice).not.toContain(error.message)
      expect(notice).not.toContain(String(error))
    }

    resetProxiedStore()
    await expect(useAppStore.getState().sendMessage('hello')).resolves.toBe(false)
    expect(runtime.streamChat).not.toHaveBeenCalled()
    expect(useAppStore.getState().sending).toBe(false)
    expectStableNotice()

    resetProxiedStore()
    await expect(
      useAppStore.getState().sendMessage('image', {
        imageTaskMode: 'generate',
        mode: 'image',
      }),
    ).resolves.toBe(false)
    expect(runtime.generateImage).not.toHaveBeenCalled()
    expect(useAppStore.getState().sending).toBe(false)
    expectStableNotice()

    const modelData = resetProxiedStore()
    await expect(
      useAppStore.getState().fetchModels(modelData.providers[0].id),
    ).resolves.toBeUndefined()
    expect(runtime.listProviderModels).not.toHaveBeenCalled()
    expect(useAppStore.getState().fetchingModelsFor).toBe('')
    expectStableNotice()

    const speechData = resetProxiedStore()
    const assistant = message('speech', 'assistant', 'Read this')
    withMessages(speechData, [assistant])
    await expect(useAppStore.getState().speakMessage(assistant)).resolves.toBeUndefined()
    expect(runtime.synthesizeSpeechAudio).not.toHaveBeenCalled()
    expect(useAppStore.getState().speakingMessageId).toBe('')
    expectStableNotice()

    resetProxiedStore()
    await expect(
      useAppStore.getState().transcribeAudio(
        new File(['audio'], 'clip.webm', { type: 'audio/webm' }),
      ),
    ).resolves.toBeNull()
    expect(runtime.transcribeAudioFile).not.toHaveBeenCalled()
    expect(useAppStore.getState().transcribingAudio).toBe(false)
    expectStableNotice()
    expect(consoleError).toHaveBeenCalledTimes(5)
  })

  it('ignores a stale proxy access-key failure after the passphrase owner changes', async () => {
    await i18nMocks.actualLoadLocale!('en-US')
    setRuntimeLocale('en-US')
    const data = freshData()
    data.preferences.language = 'en-US'
    data.providers[0] = {
      ...data.providers[0],
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'old-passphrase' })
    let rejectDerivation!: (error: unknown) => void
    accessKeyMocks.accessKeyFromPassword.mockReturnValueOnce(
      new Promise<string>((_resolve, reject) => {
        rejectDerivation = reject
      }),
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const send = useAppStore.getState().sendMessage('hello')
    await vi.waitFor(() =>
      expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledWith(
        'old-passphrase',
      ),
    )
    await useAppStore.getState().setSyncPassphrase('new-passphrase')
    rejectDerivation(new Error('C:\\private\\stale-proxy-secret'))

    await expect(send).resolves.toBe(false)
    expect(runtime.streamChat).not.toHaveBeenCalled()
    expect(useAppStore.getState().toasts).toHaveLength(0)
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('resolves an accepted proxy generation after its sync passphrase changes', async () => {
    const data = freshData()
    data.providers[0] = {
      ...data.providers[0],
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'old-passphrase' })

    let streamSignal: AbortSignal | undefined
    let releaseStream!: () => void
    runtime.streamChat.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<void>((resolve, reject) => {
          streamSignal = signal
          releaseStream = resolve
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        }),
    )

    const sending = useAppStore.getState().sendMessage('old proxy request')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())

    await useAppStore.getState().setSyncPassphrase('new-passphrase')

    expect(streamSignal?.aborted).toBe(true)
    releaseStream?.()
    await expect(sending).resolves.toBe(true)
  })

  it('sends text through the configured Cloudflare Worker route', async () => {
    const data = freshData()
    const provider = data.providers[0]
    data.sync = {
      ...data.sync,
      mode: 'cloudflare',
      workerEndpoint: 'https://worker.invalid',
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'worker-passphrase' })

    await expect(
      useAppStore.getState().sendMessage('use the Worker route'),
    ).resolves.toBe(true)

    expect(runtime.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({
          id: provider.id,
          proxyUrl: 'https://worker.invalid',
        }),
      }),
    )
  })

  it('does not send a captured Provider key after a newer key becomes durable', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    useAppStore.setState({ keys: { [providerId]: 'old-provider-key' } })
    let resolveRuntime!: (value: ChatRuntime) => void
    const runtimeLoader = vi.fn(
      () =>
        new Promise<ChatRuntime>((resolve) => {
          resolveRuntime = resolve
        }),
    )
    useAppStore.setState({ runtimeLoader })

    const sending = useAppStore.getState().sendMessage('do not use a stale key')
    await vi.waitFor(() => expect(runtimeLoader).toHaveBeenCalledOnce())

    await useAppStore
      .getState()
      .saveProviderKey(providerId, 'new-provider-key')
    resolveRuntime(runtime)

    await expect(sending).resolves.toBe(true)
    expect(runtime.streamChat).not.toHaveBeenCalled()
    expect(useAppStore.getState().keys[providerId]).toBe('new-provider-key')
    expect(
      useAppStore.getState().data?.conversations[0].messages.at(-1),
    ).toMatchObject({ role: 'assistant', status: 'done' })
  })

  it('does not start audio transcription after stop wins while runtime loading', async () => {
    resetStore()
    let resolveRuntime!: (value: ChatRuntime) => void
    const runtimeLoader = vi.fn(
      () =>
        new Promise<ChatRuntime>((resolve) => {
          resolveRuntime = resolve
        }),
    )
    useAppStore.setState({ runtimeLoader })

    const pending = useAppStore
      .getState()
      .transcribeAudio(new File(['audio'], 'loader-pending.wav', { type: 'audio/wav' }))
    await vi.waitFor(() => expect(runtimeLoader).toHaveBeenCalledOnce())

    useAppStore.getState().stopAudioTranscription()
    resolveRuntime(runtime)

    await expect(pending).resolves.toBeNull()
    expect(runtime.transcribeAudioFile).not.toHaveBeenCalled()
    expect(useAppStore.getState().transcribingAudio).toBe(false)
  })

  it('does not start read-aloud after stop wins while runtime loading', async () => {
    const data = resetStore()
    const assistant = message(
      'speech-loader-pending',
      'assistant',
      'Do not read after stop wins',
    )
    withMessages(data, [assistant])
    let resolveRuntime!: (value: ChatRuntime) => void
    const runtimeLoader = vi.fn(
      () =>
        new Promise<ChatRuntime>((resolve) => {
          resolveRuntime = resolve
        }),
    )
    useAppStore.setState({ runtimeLoader })

    const pending = useAppStore.getState().speakMessage(assistant)
    await vi.waitFor(() => expect(runtimeLoader).toHaveBeenCalledOnce())

    useAppStore.getState().stopSpeakingMessage()
    resolveRuntime(runtime)

    await pending
    expect(runtime.synthesizeSpeechAudio).not.toHaveBeenCalled()
    expect(useAppStore.getState().speakingMessageId).toBe('')
  })

  it('does not let an admitted generation reach the Provider while its key write is pending', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    useAppStore.setState({ keys: { [providerId]: 'old-provider-key' } })
    let resolveRuntime!: (value: ChatRuntime) => void
    const runtimeLoader = vi.fn(
      () =>
        new Promise<ChatRuntime>((resolve) => {
          resolveRuntime = resolve
        }),
    )
    let releaseKeyWrite!: () => void
    secretMocks.setProviderKey.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releaseKeyWrite = () => resolve(undefined)
        }),
    )
    useAppStore.setState({ runtimeLoader })

    const sending = useAppStore.getState().sendMessage('wait for credential owner')
    await vi.waitFor(() => expect(runtimeLoader).toHaveBeenCalledOnce())
    const saving = useAppStore
      .getState()
      .saveProviderKey(providerId, 'new-provider-key')
    await vi.waitFor(() => expect(releaseKeyWrite).toBeTypeOf('function'))

    resolveRuntime(runtime)
    await sending
    releaseKeyWrite()
    await saving

    expect(runtime.streamChat).not.toHaveBeenCalled()
    expect(useAppStore.getState().keys[providerId]).toBe('new-provider-key')
  })

  it('does not admit generation while its Provider key write is pending', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    let releaseKeyWrite!: () => void
    secretMocks.setProviderKey.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releaseKeyWrite = () => resolve(undefined)
        }),
    )

    const saving = useAppStore
      .getState()
      .saveProviderKey(providerId, 'new-provider-key')
    await vi.waitFor(() => expect(releaseKeyWrite).toBeTypeOf('function'))

    const admitted = await useAppStore
      .getState()
      .sendMessage('blocked by credential owner')
    releaseKeyWrite()
    await saving

    expect(admitted).toBe(false)
    expect(runtime.streamChat).not.toHaveBeenCalled()
  })

  it('does not send through a captured Provider route after the route changes', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    let resolveRuntime!: (value: ChatRuntime) => void
    const runtimeLoader = vi.fn(
      () =>
        new Promise<ChatRuntime>((resolve) => {
          resolveRuntime = resolve
        }),
    )
    useAppStore.setState({ runtimeLoader })

    const sending = useAppStore.getState().sendMessage('do not use a stale route')
    await vi.waitFor(() => expect(runtimeLoader).toHaveBeenCalledOnce())

    useAppStore.getState().updateProvider(providerId, {
      baseUrl: 'https://replacement.invalid/v1',
    })
    resolveRuntime(runtime)

    await expect(sending).resolves.toBe(true)
    expect(runtime.streamChat).not.toHaveBeenCalled()
    expect(
      useAppStore.getState().data?.conversations[0].messages.at(-1),
    ).toMatchObject({ role: 'assistant', status: 'done' })
  })

  it('keeps an admitted generation when only Provider display metadata changes', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    let resolveRuntime!: (value: ChatRuntime) => void
    const runtimeLoader = vi.fn(
      () =>
        new Promise<ChatRuntime>((resolve) => {
          resolveRuntime = resolve
        }),
    )
    useAppStore.setState({ runtimeLoader })

    const sending = useAppStore.getState().sendMessage('keep the current route')
    await vi.waitFor(() => expect(runtimeLoader).toHaveBeenCalledOnce())

    useAppStore.getState().updateProvider(providerId, { name: 'Renamed Provider' })
    resolveRuntime(runtime)

    await expect(sending).resolves.toBe(true)
    expect(runtime.streamChat).toHaveBeenCalledOnce()
    expect(runtime.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ id: providerId }),
      }),
    )
  })

  it('aborts an in-flight generation when its Provider route changes', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    let finishStream!: () => void
    runtime.streamChat.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishStream = resolve
        }),
    )

    const sending = useAppStore.getState().sendMessage('stop the old route')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())
    const signal = runtime.streamChat.mock.calls[0]?.[0]?.signal as
      | AbortSignal
      | undefined

    useAppStore.getState().updateProvider(providerId, {
      baseUrl: 'https://replacement.invalid/v1',
    })

    expect(signal?.aborted).toBe(true)
    finishStream()
    await sending
  })

  it('keeps an in-flight generation when only Provider display metadata changes', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    let finishStream!: () => void
    runtime.streamChat.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishStream = resolve
        }),
    )

    const sending = useAppStore.getState().sendMessage('keep the live route')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())
    const signal = runtime.streamChat.mock.calls[0]?.[0]?.signal as
      | AbortSignal
      | undefined

    useAppStore.getState().updateProvider(providerId, { name: 'Renamed Provider' })

    expect(signal?.aborted).toBe(false)
    finishStream()
    await sending
  })

  it('keeps an in-flight generation when only Provider preset identity changes', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    let finishStream!: () => void
    runtime.streamChat.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishStream = resolve
        }),
    )

    const sending = useAppStore.getState().sendMessage('keep the preset identity')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())
    const signal = runtime.streamChat.mock.calls[0]?.[0]?.signal as
      | AbortSignal
      | undefined

    useAppStore.getState().updateProvider(providerId, { custom: true })

    expect(signal?.aborted).toBe(false)
    finishStream()
    await sending
  })

  it('does not generate an image with a captured Provider key after a newer key becomes durable', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    useAppStore.setState({ keys: { [providerId]: 'old-provider-key' } })
    let resolveRuntime!: (value: ChatRuntime) => void
    const runtimeLoader = vi.fn(
      () =>
        new Promise<ChatRuntime>((resolve) => {
          resolveRuntime = resolve
        }),
    )
    useAppStore.setState({ runtimeLoader })

    const sending = useAppStore.getState().sendMessage('draw safely', {
      imageTaskMode: 'generate',
      mode: 'image',
    })
    await vi.waitFor(() => expect(runtimeLoader).toHaveBeenCalledOnce())

    await useAppStore
      .getState()
      .saveProviderKey(providerId, 'new-provider-key')
    resolveRuntime(runtime)

    await expect(sending).resolves.toBe(true)
    expect(runtime.generateImage).not.toHaveBeenCalled()
    expect(useAppStore.getState().keys[providerId]).toBe('new-provider-key')
    expect(
      useAppStore.getState().data?.conversations[0].messages.at(-1),
    ).toMatchObject({ role: 'assistant', status: 'done' })
  })

  it('does not generate an image through a captured Provider route after the route changes', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    let resolveRuntime!: (value: ChatRuntime) => void
    const runtimeLoader = vi.fn(
      () =>
        new Promise<ChatRuntime>((resolve) => {
          resolveRuntime = resolve
        }),
    )
    useAppStore.setState({ runtimeLoader })

    const sending = useAppStore.getState().sendMessage('draw on the current route', {
      imageTaskMode: 'generate',
      mode: 'image',
    })
    await vi.waitFor(() => expect(runtimeLoader).toHaveBeenCalledOnce())

    useAppStore.getState().updateProvider(providerId, {
      baseUrl: 'https://replacement.invalid/v1',
    })
    resolveRuntime(runtime)

    await expect(sending).resolves.toBe(true)
    expect(runtime.generateImage).not.toHaveBeenCalled()
    expect(
      useAppStore.getState().data?.conversations[0].messages.at(-1),
    ).toMatchObject({ role: 'assistant', status: 'done' })
  })

  it('does not edit an image while its Provider key write is pending', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    let resolveRuntime!: (value: ChatRuntime) => void
    const runtimeLoader = vi.fn(
      () =>
        new Promise<ChatRuntime>((resolve) => {
          resolveRuntime = resolve
        }),
    )
    let releaseKeyWrite!: () => void
    secretMocks.setProviderKey.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releaseKeyWrite = () => resolve(undefined)
        }),
    )
    useAppStore.setState({ runtimeLoader })

    const sending = useAppStore.getState().sendMessage('edit safely', {
      imageSourceFile: imageFile(),
      imageTaskMode: 'edit',
      mode: 'image',
    })
    await vi.waitFor(() => expect(runtimeLoader).toHaveBeenCalledOnce())
    const saving = useAppStore
      .getState()
      .saveProviderKey(providerId, 'new-provider-key')
    await vi.waitFor(() => expect(releaseKeyWrite).toBeTypeOf('function'))

    resolveRuntime(runtime)
    await sending
    releaseKeyWrite()
    await saving

    expect(runtime.editImage).not.toHaveBeenCalled()
  })

  it('copies the current derived Cloudflare access key through the shared clipboard boundary', async () => {
    await i18nMocks.actualLoadLocale!('en-US')
    setRuntimeLocale('en-US')
    const data = resetStore()
    data.preferences.language = 'en-US'
    useAppStore.setState({ data, syncPassphrase: 'test-passphrase' })

    await expect(
      useAppStore.getState().copySyncAccessKey(),
    ).resolves.toBeUndefined()

    expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledWith(
      'test-passphrase',
    )
    expect(clipboardMocks.writeClipboardText).toHaveBeenCalledWith('proxy-token')
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'Access key copied',
      tone: 'success',
    })
  })

  it('orders access-key copy after an already queued passphrase write', async () => {
    const data = resetStore()
    useAppStore.setState({ data, syncPassphrase: 'old-passphrase' })
    let releasePassphraseWrite!: () => void
    secretMocks.setSyncPassphrase.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releasePassphraseWrite = () => resolve(undefined)
        }),
    )

    const saving = useAppStore.getState().setSyncPassphrase('new-passphrase')
    await vi.waitFor(() =>
      expect(secretMocks.setSyncPassphrase).toHaveBeenCalledWith('new-passphrase'),
    )
    const copying = useAppStore.getState().copySyncAccessKey()
    await Promise.resolve()
    await Promise.resolve()

    expect(accessKeyMocks.accessKeyFromPassword).not.toHaveBeenCalled()
    expect(clipboardMocks.writeClipboardText).not.toHaveBeenCalled()

    releasePassphraseWrite()
    await Promise.all([saving, copying])

    expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledOnce()
    expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledWith('new-passphrase')
    expect(clipboardMocks.writeClipboardText).toHaveBeenCalledWith('proxy-token')
  })

  it('does not copy the previous access key when a queued passphrase write fails', async () => {
    const data = resetStore()
    useAppStore.setState({ data, syncPassphrase: 'old-passphrase' })
    let rejectPassphraseWrite!: (error: Error) => void
    secretMocks.setSyncPassphrase.mockImplementationOnce(
      () =>
        new Promise<undefined>((_resolve, reject) => {
          rejectPassphraseWrite = reject
        }),
    )

    const saving = useAppStore.getState().setSyncPassphrase('new-passphrase')
    await vi.waitFor(() =>
      expect(secretMocks.setSyncPassphrase).toHaveBeenCalledWith('new-passphrase'),
    )
    const copying = useAppStore.getState().copySyncAccessKey()
    rejectPassphraseWrite(new Error('passphrase write failed'))

    await expect(saving).rejects.toThrow('passphrase write failed')
    await expect(copying).resolves.toBeUndefined()
    expect(accessKeyMocks.accessKeyFromPassword).not.toHaveBeenCalled()
    expect(clipboardMocks.writeClipboardText).not.toHaveBeenCalled()
    expect(useAppStore.getState().toasts).toHaveLength(0)

    await expect(
      useAppStore.getState().copySyncAccessKey(),
    ).resolves.toBeUndefined()
    expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledWith(
      'old-passphrase',
    )
    expect(clipboardMocks.writeClipboardText).toHaveBeenCalledWith('proxy-token')
  })

  it('does not wait for unrelated durable lifecycle work before copying the access key', async () => {
    const data = resetStore()
    useAppStore.setState({ data, syncPassphrase: 'passphrase' })
    let releaseGithubTokenWrite!: () => void
    secretMocks.setGithubToken.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releaseGithubTokenWrite = () => resolve(undefined)
        }),
    )

    const saving = useAppStore.getState().saveGithubToken('github-token')
    await vi.waitFor(() =>
      expect(secretMocks.setGithubToken).toHaveBeenCalledWith('github-token'),
    )
    const copying = useAppStore.getState().copySyncAccessKey()

    await vi.waitFor(() =>
      expect(clipboardMocks.writeClipboardText).toHaveBeenCalledWith('proxy-token'),
    )
    releaseGithubTokenWrite()
    await Promise.all([saving, copying])
  })

  it('does not copy an access key while an import replacement owns the lease', async () => {
    const data = resetStore()
    const imported = structuredClone(data)
    useAppStore.setState({ data, syncPassphrase: 'passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: imported,
      secrets: { providerKeys: {} },
    })

    let releaseReplacement!: () => void
    const replacementCommit = new Promise<void>((resolve) => {
      releaseReplacement = resolve
    })
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await replacementCommit
        return persist(target)
      },
    )

    const importing = useAppStore
      .getState()
      .importBackup(new File(['{}'], 'backup.json', { type: 'application/json' }))
    await vi.waitFor(() =>
      expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
    )

    const copying = useAppStore.getState().copySyncAccessKey()
    await Promise.resolve()
    await Promise.resolve()

    expect(accessKeyMocks.accessKeyFromPassword).not.toHaveBeenCalled()
    expect(clipboardMocks.writeClipboardText).not.toHaveBeenCalled()

    releaseReplacement()
    await Promise.all([importing, copying])
    expect(accessKeyMocks.accessKeyFromPassword).not.toHaveBeenCalled()
    expect(clipboardMocks.writeClipboardText).not.toHaveBeenCalled()
  })

  it('waits for a pending reset before deciding whether an access key remains', async () => {
    const data = resetStore()
    useAppStore.setState({ data, syncPassphrase: 'passphrase' })
    let releaseReset!: () => void
    const resetCommit = new Promise<void>((resolve) => {
      releaseReset = resolve
    })
    secretMocks.commitZeroChatSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await resetCommit
        return persist(target)
      },
    )

    const resetting = useAppStore.getState().resetAll()
    await vi.waitFor(() =>
      expect(secretMocks.commitZeroChatSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
    )
    const copying = useAppStore.getState().copySyncAccessKey()
    await Promise.resolve()
    await Promise.resolve()

    expect(accessKeyMocks.accessKeyFromPassword).not.toHaveBeenCalled()
    expect(clipboardMocks.writeClipboardText).not.toHaveBeenCalled()

    releaseReset()
    await Promise.all([resetting, copying])
    expect(accessKeyMocks.accessKeyFromPassword).not.toHaveBeenCalled()
    expect(clipboardMocks.writeClipboardText).not.toHaveBeenCalled()
  })

  it('coalesces concurrent Cloudflare access-key copy actions', async () => {
    const data = freshData()
    data.preferences.language = 'en-US'
    data.providers[0] = {
      ...data.providers[0],
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    resetStore(data)
    useAppStore.setState({ data, syncPassphrase: 'test-passphrase' })

    let resolveAccessKey!: (value: string) => void
    const pendingAccessKey = new Promise<string>((resolve) => {
      resolveAccessKey = resolve
    })
    accessKeyMocks.accessKeyFromPassword.mockReturnValue(pendingAccessKey)

    const first = useAppStore.getState().copySyncAccessKey()
    await vi.waitFor(() =>
      expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledOnce(),
    )
    const second = useAppStore.getState().copySyncAccessKey()

    expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledOnce()
    resolveAccessKey('proxy-token')
    await Promise.all([first, second])

    expect(clipboardMocks.writeClipboardText).toHaveBeenCalledOnce()
    expect(useAppStore.getState().toasts).toHaveLength(1)
  })

  it('contains Cloudflare access-key copy failures without exposing clipboard diagnostics', async () => {
    await i18nMocks.actualLoadLocale!('en-US')
    setRuntimeLocale('en-US')
    const data = resetStore()
    data.preferences.language = 'en-US'
    useAppStore.setState({ data, syncPassphrase: 'test-passphrase' })
    const sentinel = 'C:\\private\\clipboard-secret=sk-test-1234567890'
    const error = new Error(sentinel)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    clipboardMocks.writeClipboardText.mockRejectedValueOnce(error)

    await expect(
      useAppStore.getState().copySyncAccessKey(),
    ).resolves.toBeUndefined()

    const notice = useAppStore.getState().toasts.at(-1)
    expect(notice).toMatchObject({ message: 'Copy failed', tone: 'error' })
    expect(notice?.message).not.toContain(sentinel)
    expect(notice?.message).not.toContain(error.message)
    expect(notice?.message).not.toContain(String(error))
    expect(consoleError).toHaveBeenCalledWith('[app] Cloudflare access-key copy failed')
    expectConsoleErrorDoesNotExpose(consoleError, error)
  })

  it('does not copy or report a stale derived access key after the passphrase owner changes', async () => {
    const data = resetStore()
    useAppStore.setState({ data, syncPassphrase: 'old-passphrase' })
    let resolveDerivation!: (value: string) => void
    accessKeyMocks.accessKeyFromPassword.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveDerivation = resolve
      }),
    )

    const copy = useAppStore.getState().copySyncAccessKey()
    await vi.waitFor(() =>
      expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledWith(
        'old-passphrase',
      ),
    )
    await useAppStore.getState().setSyncPassphrase('new-passphrase')
    resolveDerivation('stale-access-key')

    await expect(copy).resolves.toBeUndefined()
    expect(clipboardMocks.writeClipboardText).not.toHaveBeenCalled()
    expect(useAppStore.getState().toasts).toHaveLength(0)
  })

  it('keeps a newer access-key copy owner when a stale copy settles', async () => {
    const data = resetStore()
    useAppStore.setState({ data, syncPassphrase: 'old-passphrase' })
    let resolveOldDerivation!: (value: string) => void
    let resolveNewDerivation!: (value: string) => void
    const oldDerivation = new Promise<string>((resolve) => {
      resolveOldDerivation = resolve
    })
    const newDerivation = new Promise<string>((resolve) => {
      resolveNewDerivation = resolve
    })
    accessKeyMocks.accessKeyFromPassword
      .mockImplementationOnce(() => oldDerivation)
      .mockImplementationOnce(() => newDerivation)

    const oldCopy = useAppStore.getState().copySyncAccessKey()
    await vi.waitFor(() =>
      expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledWith(
        'old-passphrase',
      ),
    )
    await useAppStore.getState().setSyncPassphrase('new-passphrase')
    const newCopy = useAppStore.getState().copySyncAccessKey()
    await vi.waitFor(() =>
      expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledWith(
        'new-passphrase',
      ),
    )

    resolveOldDerivation('stale-access-key')
    await oldCopy
    const joinedNewCopy = useAppStore.getState().copySyncAccessKey()
    expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledTimes(2)

    resolveNewDerivation('current-access-key')
    await Promise.all([newCopy, joinedNewCopy])
    expect(clipboardMocks.writeClipboardText).toHaveBeenCalledOnce()
    expect(clipboardMocks.writeClipboardText).toHaveBeenCalledWith(
      'current-access-key',
    )
  })

  it('sends online chat turns, handles errors, and supports cancellation', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    expect(await useAppStore.getState().sendMessage('  hello world  ')).toBe(true)
    const sent = useAppStore.getState().data?.conversations[0].messages
    expect(sent).toHaveLength(2)
    expect(sent?.[0]).toMatchObject({ content: 'hello world', role: 'user' })
    expect(sent?.[1]).toMatchObject({ content: 'reply', role: 'assistant', status: 'done' })
    expect(runtime.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'test-key',
        model: data.providers[0].model,
        provider: expect.objectContaining({ id: providerId }),
      }),
    )

    const errorData = resetStore()
    errorData.preferences.firstRunDone = false
    runtime.streamChat.mockRejectedValueOnce(new Error('chat failed'))
    expect(await useAppStore.getState().sendMessage('will fail')).toBe(true)
    const failed = useAppStore.getState().data?.conversations[0].messages.at(-1)
    expect(failed).toMatchObject({ error: 'chat failed', status: 'error' })
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'chat failed',
      tone: 'error',
    })
    expect(useAppStore.getState().data?.preferences.firstRunDone).toBe(true)

    const controller = new AbortController()
    useAppStore.setState({ abortController: controller })
    useAppStore.getState().stopStreaming()
    expect(controller.signal.aborted).toBe(true)
  })

  it('keeps persisted system prompts in a normal send request', async () => {
    const data = resetStore()
    const systemPrompt = message(
      'send-system-prompt',
      'system',
      'Base system prompt must stay',
    )
    withMessages(data, [systemPrompt])

    await expect(useAppStore.getState().sendMessage('normal prompt')).resolves.toBe(
      true,
    )

    expect(runtime.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            id: systemPrompt.id,
            role: 'system',
            content: systemPrompt.content,
          }),
        ]),
      }),
    )
  })

  it('keeps persisted system prompts when editing and resending a message', async () => {
    const data = resetStore()
    const systemPrompt = message(
      'rerun-system-prompt',
      'system',
      'Injected Skill prompt must stay',
    )
    const userPrompt = message('rerun-user-prompt', 'user', 'old prompt')
    withMessages(data, [systemPrompt, userPrompt])

    await expect(
      useAppStore.getState().editAndResendMessage(userPrompt.id, 'new prompt'),
    ).resolves.toBe(true)

    expect(runtime.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            id: systemPrompt.id,
            role: 'system',
            content: systemPrompt.content,
          }),
        ]),
      }),
    )
  })

  it('does not expose raw Provider stream errors in message state or toast', async () => {
    resetStore()
    const sentinel =
      'C:\\private\\chat-response.json https://provider.invalid/v1/chat?api_key=sk-chat-error-1234567890 Bearer sk-bearer-error-1234567890'
    runtime.streamChat.mockRejectedValueOnce(new Error(sentinel))

    await expect(
      useAppStore.getState().sendMessage('redact Provider failure'),
    ).resolves.toBe(true)

    const assistant = useAppStore.getState().data?.conversations[0].messages.at(-1)
    const toast = useAppStore.getState().toasts.at(-1)?.message ?? ''
    expect(assistant).toMatchObject({ status: 'error' })
    expect(assistant?.error).not.toContain(sentinel)
    expect(assistant?.error).not.toContain('C:\\private')
    expect(assistant?.error).not.toContain('sk-chat-error-1234567890')
    expect(assistant?.error).not.toContain('sk-bearer-error-1234567890')
    expect(assistant?.error).not.toContain('provider.invalid')
    expect(toast).not.toContain(sentinel)
    expect(toast).not.toContain('C:\\private')
    expect(toast).not.toContain('sk-chat-error-1234567890')
    expect(toast).not.toContain('sk-bearer-error-1234567890')
    expect(toast).not.toContain('provider.invalid')
  })

  it('coalesces a pending auto-sync with the terminal sync for one chat turn', async () => {
    resetStore()
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().setSyncMode('cloudflare')
    useAppStore.getState().setSyncWorkerEndpoint('https://worker.invalid')
    await useAppStore.getState().setSyncAutoSync(true)

    syncMocks.performSync.mockClear()
    await expect(
      useAppStore.getState().sendMessage('one terminal publish'),
    ).resolves.toBe(true)

    await vi.waitFor(() =>
      expect(syncMocks.performSync).toHaveBeenCalled(),
    )
    expect(syncMocks.performSync).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().data?.sync.mode).toBe('cloudflare')
  })

  it('durably terminalizes stale streaming messages when no abort owner remains', async () => {
    const data = resetStore()
    const user = message('stale-stop-user', 'user', 'question')
    const partial = message('stale-stop-partial', 'assistant', 'partial answer', {
      error: 'old provider error',
      offlineReplayClaim: { claimId: 'claim-1', owner: 'tab-1' },
      queuedTextRequest: {
        providerId: data.providers[0].id,
        model: data.providers[0].model,
        promptMessageId: user.id,
      },
      status: 'streaming',
    })
    const empty = message('stale-stop-empty', 'assistant', '', {
      status: 'streaming',
    })
    withMessages(data, [user, partial, empty])
    useAppStore.setState({ abortController: null, sending: true, streaming: true })
    await useAppStore.getState().flushLocalSaves()

    let releaseSave: (() => void) | undefined
    dbMocks.saveAppData.mockClear()
    dbMocks.saveAppData.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseSave = resolve
      }),
    )
    let settled = false
    const stopping = Promise.resolve(useAppStore.getState().stopStreaming()).then(
      (result) => {
        settled = true
        return result
      },
    )
    await vi.advanceTimersByTimeAsync(300)
    const pendingBeforeDurableSave =
      dbMocks.saveAppData.mock.calls.length === 1 &&
      !settled &&
      useAppStore.getState().streaming
    releaseSave?.()

    await expect(stopping).resolves.toBe(true)
    expect(pendingBeforeDurableSave).toBe(true)
    expect(useAppStore.getState()).toMatchObject({ sending: false, streaming: false })
    const stoppedMessages = useAppStore.getState().data?.conversations[0].messages
    expect(stoppedMessages).toEqual([
      user,
      expect.objectContaining({
        content: 'partial answer',
        error: undefined,
        id: partial.id,
        status: 'done',
      }),
      expect.objectContaining({
        content: translate('en-US', 'notice.stopped'),
        id: empty.id,
        status: 'done',
      }),
    ])
    expect(stoppedMessages?.[1]).not.toHaveProperty('offlineReplayClaim')
    expect(stoppedMessages?.[1]).not.toHaveProperty('queuedTextRequest')
  })

  it('keeps stale streaming state visible when stop persistence fails', async () => {
    const data = resetStore()
    const assistant = message('stale-stop-failure', 'assistant', 'partial', {
      status: 'streaming',
    })
    withMessages(data, [assistant])
    useAppStore.setState({ abortController: null, sending: true, streaming: true })
    await useAppStore.getState().flushLocalSaves()
    const sentinel = 'C:\\private\\stop-secret'
    dbMocks.saveAppData.mockRejectedValueOnce(new Error(sentinel))

    await expect(
      Promise.resolve(useAppStore.getState().stopStreaming()),
    ).resolves.toBe(false)

    expect(useAppStore.getState()).toMatchObject({ sending: true, streaming: true })
    expect(useAppStore.getState().data?.conversations[0].messages).toEqual([
      assistant,
    ])
    expect(useAppStore.getState().toasts.at(-1)?.message).not.toContain(sentinel)
  })

  it('retries a transient chat failure through the shared generation runtime', async () => {
    stubGenerationRetryTimers()
    resetStore()
    runtime.streamChat
      .mockRejectedValueOnce(
        Object.assign(new Error('temporary network failure'), { retryable: true }),
      )
      .mockImplementationOnce(
        async ({ onToken }: { onToken: (token: string) => void }) => {
          onToken('retried reply')
        },
      )

    const sending = useAppStore.getState().sendMessage('retry this turn')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(400)

    await expect(sending).resolves.toBe(true)
    expect(runtime.streamChat).toHaveBeenCalledTimes(2)
    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      content: 'retried reply',
      status: 'done',
    })
    expect(useAppStore.getState().toasts).toContainEqual(
      expect.objectContaining({
        message: translate('en-US', 'notice.networkRetrying', {
          attempt: 1,
          total: 3,
        }),
        tone: 'info',
      }),
    )
  })

  it('does not publish a retry after stopping a chat before its retryable failure settles', async () => {
    resetStore()
    let rejectStream!: (error: unknown) => void
    runtime.streamChat.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectStream = reject
        }),
    )

    const sending = useAppStore.getState().sendMessage('stop before retryable failure')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())
    await expect(useAppStore.getState().stopStreaming()).resolves.toBe(true)

    rejectStream(
      Object.assign(new Error('temporary network failure'), { retryable: true }),
    )
    await expect(sending).resolves.toBe(true)

    expect(runtime.streamChat).toHaveBeenCalledOnce()
    expect(useAppStore.getState().toasts).not.toContainEqual(
      expect.objectContaining({
        message: translate('en-US', 'notice.networkRetrying', {
          attempt: 1,
          total: 3,
        }),
      }),
    )
    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      status: 'done',
    })
  })

  it('drops a token delivered after stopping a Provider that ignores abort', async () => {
    resetStore()
    let publishLateToken!: (token: string) => void
    let finishStream!: () => void
    runtime.streamChat.mockImplementationOnce(
      async ({ onToken }: { onToken: (token: string) => void }) => {
        publishLateToken = onToken
        await new Promise<void>((resolve) => {
          finishStream = resolve
        })
      },
    )

    const sending = useAppStore.getState().sendMessage('stop before late token')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())
    const assistantBeforeStop = structuredClone(
      useAppStore.getState().data?.conversations[0].messages.at(-1),
    )

    await expect(useAppStore.getState().stopStreaming()).resolves.toBe(true)
    publishLateToken('late provider output')
    await vi.advanceTimersByTimeAsync(40)

    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toEqual(
      assistantBeforeStop,
    )

    finishStream()
    await expect(sending).resolves.toBe(true)
  })

  it('drops a late token before a conversation switch commits its new owner', async () => {
    const data = freshData()
    const first = data.conversations[0]
    const second = { ...structuredClone(first), id: 'late-token-second-conversation' }
    data.conversations.push(second)
    resetStore(data)

    let publishLateToken!: (token: string) => void
    let finishStream!: () => void
    let streamSignal!: AbortSignal
    runtime.streamChat.mockImplementationOnce(
      async ({
        onToken,
        signal,
      }: {
        onToken: (token: string) => void
        signal: AbortSignal
      }) => {
        publishLateToken = onToken
        streamSignal = signal
        await new Promise<void>((resolve) => {
          finishStream = resolve
        })
      },
    )

    const sending = useAppStore.getState().sendMessage('switch after late token')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())
    const assistantBeforeSwitch = structuredClone(
      useAppStore.getState().data?.conversations[0].messages.at(-1),
    )

    const switching = useAppStore.getState().setActiveConversation(second.id)
    await Promise.resolve()
    expect(streamSignal.aborted).toBe(true)
    expect(useAppStore.getState().data?.preferences.activeConversationId).toBe(
      first.id,
    )
    publishLateToken('late switched provider output')
    await vi.advanceTimersByTimeAsync(40)

    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toEqual(
      assistantBeforeSwitch,
    )

    finishStream()
    await vi.advanceTimersByTimeAsync(100)
    await expect(sending).resolves.toBe(true)
    await expect(switching).resolves.toBe(true)
    expect(useAppStore.getState().data?.preferences.activeConversationId).toBe(
      second.id,
    )
  })

  it('keeps the generation owner when the active conversation is reselected', async () => {
    resetStore()
    let finishStream!: () => void
    let streamSignal!: AbortSignal
    runtime.streamChat.mockImplementationOnce(
      async ({ signal }: { signal: AbortSignal }) => {
        streamSignal = signal
        await new Promise<void>((resolve) => {
          finishStream = resolve
        })
      },
    )

    const sending = useAppStore.getState().sendMessage('reselect current owner')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())
    const activeId = useAppStore.getState().data?.preferences.activeConversationId

    await expect(
      useAppStore.getState().setActiveConversation(activeId ?? ''),
    ).resolves.toBe(true)
    expect(streamSignal.aborted).toBe(false)

    finishStream()
    await expect(sending).resolves.toBe(true)
  })

  it('does not retry chat with a stale key while its Provider key write is pending', async () => {
    stubGenerationRetryTimers()
    const data = resetStore()
    const providerId = data.providers[0].id
    runtime.streamChat.mockRejectedValueOnce(
      Object.assign(new Error('temporary network failure'), { retryable: true }),
    )
    let releaseKeyWrite!: () => void
    secretMocks.setProviderKey.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releaseKeyWrite = () => resolve(undefined)
        }),
    )

    const sending = useAppStore.getState().sendMessage('do not retry stale')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())
    const saving = useAppStore
      .getState()
      .saveProviderKey(providerId, 'new-provider-key')
    await vi.waitFor(() => expect(releaseKeyWrite).toBeTypeOf('function'))
    await vi.advanceTimersByTimeAsync(400)

    await sending
    releaseKeyWrite()
    await saving

    expect(runtime.streamChat).toHaveBeenCalledOnce()
  })

  it('does not call the text Provider when the generation turn cannot persist', async () => {
    resetStore()
    const failure = new Error(
      'C:\\private\\generation-start sk-test-secret-1234567890',
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    dbMocks.saveAppData.mockRejectedValueOnce(failure)

    await expect(
      useAppStore.getState().sendMessage('persist before Provider'),
    ).resolves.toBe(false)

    expect(runtime.streamChat).not.toHaveBeenCalled()
    expect(useAppStore.getState()).toMatchObject({ sending: false, streaming: false })
    expect(consoleError).toHaveBeenCalledWith('[app] generation start save failed')
    expectConsoleErrorDoesNotExpose(consoleError, failure)
    expect(useAppStore.getState().toasts.map((toast) => toast.message).join(' '))
      .not.toContain(failure.message)
  })

  it('does not expose raw generation persistence failures in console diagnostics', async () => {
    resetStore()
    const sentinel = 'C:\\private\\generation-console-secret=sk-console-1234567890'
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    dbMocks.saveAppData.mockRejectedValueOnce(new Error(sentinel))

    await expect(
      useAppStore.getState().sendMessage('diagnostic redaction'),
    ).resolves.toBe(false)

    expect(
      consoleError.mock.calls.some((call) =>
        call.some(
          (argument) =>
            argument === sentinel ||
            (argument instanceof Error && argument.message.includes(sentinel)) ||
            String(argument).includes(sentinel),
        ),
      ),
    ).toBe(false)
  })

  it('waits for the durable text turn before calling the Provider', async () => {
    resetStore()
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    let releaseTurnSave!: () => void
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseTurnSave = resolve
        }),
    )

    const sending = useAppStore.getState().sendMessage('durable request start')
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())
    expect(dbMocks.saveAppData.mock.calls[0]?.[0]).toMatchObject({
      conversations: [
        expect.objectContaining({
          messages: [
            expect.objectContaining({ content: 'durable request start', role: 'user' }),
            expect.objectContaining({ role: 'assistant', status: 'streaming' }),
          ],
        }),
      ],
    })
    expect(runtime.streamChat).not.toHaveBeenCalled()

    releaseTurnSave()
    await expect(sending).resolves.toBe(true)
    expect(runtime.streamChat).toHaveBeenCalledOnce()
  })

  it('does not publish a pre-publish text turn into a same-id conversation replacement', async () => {
    const data = resetStore()
    data.sync = { ...data.sync, autoSync: false, mode: 'gist' }
    useAppStore.setState({
      data,
      githubToken: 'github-token',
      syncPassphrase: 'sync-passphrase',
    })
    await useAppStore.getState().flushLocalSaves()

    let releasePersist!: () => void
    let persistStarted!: () => void
    const persistReady = new Promise<void>((resolve) => {
      persistStarted = resolve
    })
    const persistGate = new Promise<void>((resolve) => {
      releasePersist = resolve
    })
    dbMocks.persistAppDataSkillContents.mockImplementationOnce(
      async (snapshot: unknown) => {
        persistStarted()
        await persistGate
        return snapshot
      },
    )

    const sending = useAppStore.getState().sendMessage('old pre-publish turn')
    await persistReady

    const replacement = structuredClone(data)
    replacement.conversations = replacement.conversations.map((conversation) => ({
      ...conversation,
      createdAt: conversation.createdAt + 100,
      updatedAt: conversation.updatedAt + 100,
      messages: [],
    }))
    replacement.updatedAt += 100
    syncMocks.performSync.mockResolvedValueOnce({
      data: replacement,
      message: 'sync replacement',
      remoteAccepted: true,
      secrets: {
        providerKeys: { [replacement.providers[0]!.id]: 'synced-key' },
      },
    })

    await useAppStore.getState().syncNow()
    expect(
      useAppStore.getState().data?.conversations[0]?.createdAt,
    ).toBe(replacement.conversations[0]!.createdAt)

    releasePersist()
    await expect(sending).resolves.toBe(false)

    expect(runtime.streamChat).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.conversations[0]?.messages).toEqual([])
    expect(
      dbMocks.saveAppData.mock.calls.some(([snapshot]) =>
        JSON.stringify(snapshot).includes('old pre-publish turn'),
      ),
    ).toBe(false)
  })

  it('does not publish a pre-publish text turn into a same-id replacement with the same conversation identity', async () => {
    const data = resetStore()
    data.sync = { ...data.sync, autoSync: false, mode: 'gist' }
    useAppStore.setState({
      data,
      githubToken: 'github-token',
      syncPassphrase: 'sync-passphrase',
    })
    await useAppStore.getState().flushLocalSaves()

    let releasePersist!: () => void
    let persistStarted!: () => void
    const persistReady = new Promise<void>((resolve) => {
      persistStarted = resolve
    })
    const persistGate = new Promise<void>((resolve) => {
      releasePersist = resolve
    })
    dbMocks.persistAppDataSkillContents.mockImplementationOnce(
      async (snapshot: unknown) => {
        persistStarted()
        await persistGate
        return snapshot
      },
    )

    const sending = useAppStore.getState().sendMessage('old same-identity turn')
    await persistReady

    const replacement = structuredClone(data)
    replacement.conversations = replacement.conversations.map((conversation) => ({
      ...conversation,
      updatedAt: conversation.updatedAt + 100,
      messages: [],
    }))
    replacement.updatedAt += 100
    syncMocks.performSync.mockResolvedValueOnce({
      data: replacement,
      message: 'sync same-identity replacement',
      remoteAccepted: true,
      secrets: {
        providerKeys: { [replacement.providers[0]!.id]: 'synced-key' },
      },
    })

    await useAppStore.getState().syncNow()
    expect(useAppStore.getState().data?.conversations[0]?.messages).toEqual([])

    releasePersist()
    await expect(sending).resolves.toBe(false)

    expect(runtime.streamChat).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.conversations[0]?.messages).toEqual([])
    expect(
      dbMocks.saveAppData.mock.calls.some(([snapshot]) =>
        JSON.stringify(snapshot).includes('old same-identity turn'),
      ),
    ).toBe(false)
  })

  it('does not publish a pre-publish image turn into a same-id conversation replacement', async () => {
    const data = resetStore()
    data.sync = { ...data.sync, autoSync: false, mode: 'gist' }
    useAppStore.setState({
      data,
      githubToken: 'github-token',
      syncPassphrase: 'sync-passphrase',
    })
    await useAppStore.getState().flushLocalSaves()

    let releasePersist!: () => void
    let persistStarted!: () => void
    const persistReady = new Promise<void>((resolve) => {
      persistStarted = resolve
    })
    const persistGate = new Promise<void>((resolve) => {
      releasePersist = resolve
    })
    dbMocks.persistAppDataSkillContents.mockImplementationOnce(
      async (snapshot: unknown) => {
        persistStarted()
        await persistGate
        return snapshot
      },
    )

    const sending = useAppStore.getState().sendMessage('old pre-publish image', {
      mode: 'image',
    })
    await persistReady

    const replacement = structuredClone(data)
    replacement.conversations = replacement.conversations.map((conversation) => ({
      ...conversation,
      createdAt: conversation.createdAt + 100,
      updatedAt: conversation.updatedAt + 100,
      messages: [],
    }))
    replacement.updatedAt += 100
    syncMocks.performSync.mockResolvedValueOnce({
      data: replacement,
      message: 'sync replacement',
      remoteAccepted: true,
      secrets: {
        providerKeys: { [replacement.providers[0]!.id]: 'synced-key' },
      },
    })

    await useAppStore.getState().syncNow()
    expect(
      useAppStore.getState().data?.conversations[0]?.createdAt,
    ).toBe(replacement.conversations[0]!.createdAt)

    releasePersist()
    await expect(sending).resolves.toBe(false)

    expect(runtime.generateImage).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.conversations[0]?.messages).toEqual([])
    expect(
      dbMocks.saveAppData.mock.calls.some(([snapshot]) =>
        JSON.stringify(snapshot).includes('old pre-publish image'),
      ),
    ).toBe(false)
  })

  it('stops proxied text submission while access-key derivation is pending', async () => {
    const data = freshData()
    data.providers[0] = {
      ...data.providers[0],
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'proxy-passphrase' })
    let finishDerivation!: (token: string) => void
    accessKeyMocks.accessKeyFromPassword.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishDerivation = resolve
        }),
    )

    const sending = useAppStore.getState().sendMessage('cancel pending relay')
    await vi.waitFor(() =>
      expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledOnce(),
    )
    useAppStore.getState().stopStreaming()
    finishDerivation('unused-proxy-token')

    await expect(sending).resolves.toBe(false)
    expect(runtime.streamChat).not.toHaveBeenCalled()
    expect(useAppStore.getState()).toMatchObject({
      abortController: null,
      sending: false,
      streaming: false,
    })
    expect(useAppStore.getState().data?.conversations[0].messages).toEqual([])
  })

  it('stops a proxied text rerun while access-key derivation is pending', async () => {
    const data = freshData()
    data.providers[0] = {
      ...data.providers[0],
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    resetStore(data)
    const user = message('rerun-proxy-user', 'user', 'rerun through relay')
    const assistant = message(
      'rerun-proxy-assistant',
      'assistant',
      'existing answer',
    )
    withMessages(data, [user, assistant])
    useAppStore.setState({ syncPassphrase: 'proxy-passphrase' })
    let finishDerivation!: (token: string) => void
    accessKeyMocks.accessKeyFromPassword.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishDerivation = resolve
        }),
    )

    const rerun = useAppStore.getState().regenerate()
    await vi.waitFor(() =>
      expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledOnce(),
    )
    expect(useAppStore.getState().abortController).toBeInstanceOf(AbortController)
    useAppStore.getState().stopStreaming()
    finishDerivation('unused-proxy-token')

    await expect(rerun).resolves.toBeUndefined()
    expect(runtime.streamChat).not.toHaveBeenCalled()
    expect(useAppStore.getState()).toMatchObject({
      abortController: null,
      sending: false,
      streaming: false,
    })
    expect(useAppStore.getState().data?.conversations[0].messages).toEqual([
      user,
      assistant,
    ])
  })

  it.each(['text', 'image'] as const)(
    'does not report a cancelled %s proxy derivation failure',
    async (mode) => {
      const data = freshData()
      data.providers[0] = {
        ...data.providers[0],
        clientRequestMode: false,
        needsApiKey: false,
        proxyUrl: 'https://proxy.invalid',
      }
      resetStore(data)
      useAppStore.setState({ syncPassphrase: 'proxy-passphrase' })

      let rejectDerivation!: (error: unknown) => void
      accessKeyMocks.accessKeyFromPassword.mockImplementationOnce(
        () =>
          new Promise<string>((_resolve, reject) => {
            rejectDerivation = reject
          }),
      )
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)
      const sentinel = 'C:\\private\\cancelled-proxy-secret'
      const pending =
        mode === 'text'
          ? useAppStore.getState().sendMessage('cancelled relay')
          : useAppStore.getState().sendMessage('cancelled image relay', {
              mode: 'image',
              imageTaskMode: 'generate',
            })

      await vi.waitFor(() =>
        expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledOnce(),
      )
      await expect(useAppStore.getState().stopStreaming()).resolves.toBe(true)
      rejectDerivation(new Error(sentinel))

      await expect(pending).resolves.toBe(false)
      expect(consoleError).not.toHaveBeenCalled()
      expect(useAppStore.getState().toasts).toHaveLength(0)
      expect(useAppStore.getState().data?.conversations[0].messages).toEqual([])
    },
  )

  it('does not call the Provider after replacement aborts while Skill context is loading', async () => {
    const data = freshData()
    data.skills = [skill('deferred-context')]
    resetStore(data)

    let releaseSkillService!: () => void
    const skillServiceReady = new Promise<void>((resolve) => {
      releaseSkillService = resolve
    })
    lazyMocks.loadSkillService.mockImplementationOnce(async () => {
      await skillServiceReady
      return {
        buildSkillSystemMessage: async () => '',
      }
    })

    const sending = useAppStore.getState().sendMessage('cancel Skill context')
    await vi.waitFor(() => expect(lazyMocks.loadSkillService).toHaveBeenCalledOnce())

    const resetting = useAppStore.getState().resetAll()
    await vi.waitFor(() =>
      expect(useAppStore.getState().abortController?.signal.aborted).toBe(true),
    )
    expect(secretMocks.commitZeroChatSecretSnapshotWithAppData).not.toHaveBeenCalled()

    releaseSkillService()
    await expect(sending).resolves.toBe(true)
    expect(runtime.streamChat).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(50)
    await resetting
  })

  it('terminalizes an aborted generation when replacement persistence fails', async () => {
    const data = freshData()
    data.skills = [skill('deferred-context-failure')]
    resetStore(data)

    let releaseSkillService!: () => void
    const skillServiceReady = new Promise<void>((resolve) => {
      releaseSkillService = resolve
    })
    lazyMocks.loadSkillService.mockImplementationOnce(async () => {
      await skillServiceReady
      return {
        buildSkillSystemMessage: async () => '',
      }
    })

    const sending = useAppStore.getState().sendMessage('replacement failure')
    await vi.waitFor(() => expect(lazyMocks.loadSkillService).toHaveBeenCalledOnce())
    const assistantId = useAppStore
      .getState()
      .data?.conversations[0]?.messages.at(-1)?.id
    expect(assistantId).toBeTruthy()

    const persistenceFailure = new Error('replacement persistence failed')
    secretMocks.commitZeroChatSecretSnapshotWithAppData.mockRejectedValueOnce(
      persistenceFailure,
    )
    const resetting = useAppStore.getState().resetAll()
    await vi.waitFor(() =>
      expect(useAppStore.getState().abortController?.signal.aborted).toBe(true),
    )

    releaseSkillService()
    await expect(sending).resolves.toBe(true)
    expect(runtime.streamChat).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(50)
    await resetting

    const assistant = useAppStore
      .getState()
      .data?.conversations[0]?.messages.find(
        (message) => message.id === assistantId,
      )
    expect(assistant).toMatchObject({
      id: assistantId,
      status: 'done',
    })
    expect(useAppStore.getState()).toMatchObject({
      abortController: null,
      sending: false,
      streaming: false,
    })
  })

  it('compensates the lease-base snapshot after an allowed data mutation', async () => {
    const data = freshData()
    data.skills = [skill('deferred-context-after-theme')]
    resetStore(data)

    let releaseSkillService!: () => void
    const skillServiceReady = new Promise<void>((resolve) => {
      releaseSkillService = resolve
    })
    lazyMocks.loadSkillService.mockImplementationOnce(async () => {
      await skillServiceReady
      return {
        buildSkillSystemMessage: async () => '',
      }
    })

    const sending = useAppStore.getState().sendMessage('theme mutation')
    await vi.waitFor(() => expect(lazyMocks.loadSkillService).toHaveBeenCalledOnce())
    const assistantId = useAppStore
      .getState()
      .data?.conversations[0]?.messages.at(-1)?.id
    expect(assistantId).toBeTruthy()

    useAppStore.getState().setTheme('dark')
    expect(useAppStore.getState().data?.preferences.theme).toBe('dark')
    secretMocks.commitZeroChatSecretSnapshotWithAppData.mockRejectedValueOnce(
      new Error('replacement persistence failed after theme change'),
    )
    const resetting = useAppStore.getState().resetAll()
    await vi.waitFor(() =>
      expect(useAppStore.getState().abortController?.signal.aborted).toBe(true),
    )

    releaseSkillService()
    await expect(sending).resolves.toBe(true)
    expect(runtime.streamChat).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(50)
    await resetting

    const current = useAppStore.getState()
    const assistant = current.data?.conversations[0]?.messages.find(
      (message) => message.id === assistantId,
    )
    expect(current.data?.preferences.theme).toBe('dark')
    expect(assistant).toMatchObject({
      id: assistantId,
      status: 'done',
    })
    expect(current).toMatchObject({
      abortController: null,
      sending: false,
      streaming: false,
    })
  })

  it('terminalizes an aborted generation when import persistence fails', async () => {
    const data = freshData()
    data.skills = [skill('deferred-import-context')]
    resetStore(data)
    await useAppStore.getState().setSyncPassphrase('passphrase')
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: freshData(),
      secrets: { providerKeys: {} },
    })

    let releaseSkillService!: () => void
    const skillServiceReady = new Promise<void>((resolve) => {
      releaseSkillService = resolve
    })
    lazyMocks.loadSkillService.mockImplementationOnce(async () => {
      await skillServiceReady
      return {
        buildSkillSystemMessage: async () => '',
      }
    })

    const sending = useAppStore.getState().sendMessage('import failure')
    await vi.waitFor(() => expect(lazyMocks.loadSkillService).toHaveBeenCalledOnce())
    const assistantId = useAppStore
      .getState()
      .data?.conversations[0]?.messages.at(-1)?.id
    expect(assistantId).toBeTruthy()

    secretMocks.commitProviderSecretSnapshotWithAppData.mockRejectedValueOnce(
      new Error('import persistence failed'),
    )
    const importing = useAppStore.getState().importBackup(
      new File(['{}'], 'backup.json', { type: 'application/json' }),
    )
    await vi.waitFor(() =>
      expect(useAppStore.getState().abortController?.signal.aborted).toBe(true),
    )

    releaseSkillService()
    await expect(sending).resolves.toBe(true)
    expect(runtime.streamChat).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(50)
    await importing

    const assistant = useAppStore
      .getState()
      .data?.conversations[0]?.messages.find(
        (message) => message.id === assistantId,
      )
    expect(assistant).toMatchObject({
      id: assistantId,
      status: 'done',
    })
    expect(useAppStore.getState()).toMatchObject({
      abortController: null,
      sending: false,
      streaming: false,
    })
  })

  it('persists a stopped text turn when cancellation wins the durable start wait', async () => {
    resetStore()
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    let releaseStart!: () => void
    let startBlocked = false
    dbMocks.saveAppData.mockImplementation(async () => {
      if (!startBlocked) {
        startBlocked = true
        await new Promise<void>((resolve) => {
          releaseStart = resolve
        })
      }
    })

    const sending = useAppStore.getState().sendMessage('cancel during save')
    await vi.waitFor(() => expect(releaseStart).toBeTypeOf('function'))
    useAppStore.getState().stopStreaming()
    releaseStart()
    await expect(sending).resolves.toBe(true)

    expect(runtime.streamChat).not.toHaveBeenCalled()
    expect(useAppStore.getState()).toMatchObject({
      abortController: null,
      sending: false,
      streaming: false,
    })
    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'done',
    })
    expect(dbMocks.saveAppData.mock.calls.at(-1)?.[0]).toMatchObject({
      conversations: [
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'assistant', status: 'done' }),
          ]),
        }),
      ],
    })
  })

  it('admits only one same-tick text submission owner', async () => {
    resetStore()
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    let releaseStart!: () => void
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseStart = resolve
        }),
    )

    const first = useAppStore.getState().sendMessage('first owner')
    const second = useAppStore.getState().sendMessage('duplicate owner')
    await vi.waitFor(() => expect(releaseStart).toBeTypeOf('function'))
    await expect(second).resolves.toBe(false)
    releaseStart()
    await expect(first).resolves.toBe(true)

    expect(runtime.streamChat).toHaveBeenCalledOnce()
    expect(
      useAppStore.getState().data?.conversations[0].messages.filter(
        (entry) => entry.role === 'user',
      ),
    ).toHaveLength(1)
  })

  it('contains text preflight notification failures', async () => {
    const data = freshData()
    data.providers = []
    resetStore(data)
    useAppStore.setState({
      notify: () => {
        throw new Error('broken notification channel')
      },
    })

    await expect(useAppStore.getState().sendMessage('missing Provider')).resolves.toBe(false)
    expect(runtime.streamChat).not.toHaveBeenCalled()
  })

  it('contains text start-save notification failures without contacting the Provider', async () => {
    resetStore()
    dbMocks.saveAppData.mockRejectedValueOnce(new Error('start save failed'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    useAppStore.setState({
      notify: () => {
        throw new Error('broken notification channel')
      },
    })

    await expect(useAppStore.getState().sendMessage('failed durable start')).resolves.toBe(false)
    expect(runtime.streamChat).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.conversations[0].messages).toEqual([])
  })

  it('contains text terminal notification failures after durable failure', async () => {
    resetStore()
    runtime.streamChat.mockRejectedValueOnce(new Error('terminal Provider failure'))
    useAppStore.setState({
      notify: () => {
        throw new Error('broken notification channel')
      },
    })

    await expect(useAppStore.getState().sendMessage('durable terminal failure')).resolves.toBe(true)
    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'error',
    })
    expect(dbMocks.saveAppData.mock.calls.at(-1)?.[0]).toMatchObject({
      conversations: [
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'assistant', status: 'error' }),
          ]),
        }),
      ],
    })
  })

  it('persists successful and failed text terminal states before settling', async () => {
    resetStore()
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    await expect(useAppStore.getState().sendMessage('persist success')).resolves.toBe(true)
    expect(dbMocks.saveAppData.mock.calls.at(-1)?.[0]).toMatchObject({
      conversations: [
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ content: 'reply', status: 'done' }),
          ]),
        }),
      ],
    })

    const failedData = resetStore()
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    runtime.streamChat.mockRejectedValueOnce(new Error('Provider failed'))

    await expect(useAppStore.getState().sendMessage('persist failure')).resolves.toBe(true)
    expect(dbMocks.saveAppData.mock.calls.at(-1)?.[0]).toMatchObject({
      conversations: [
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ status: 'error' }),
          ]),
        }),
      ],
    })
    expect(failedData.conversations[0].messages).toHaveLength(0)
  })

  it('preserves partial assistant text when a stream fails', async () => {
    resetStore()
    runtime.streamChat.mockImplementationOnce(
      async ({ onToken }: { onToken: (token: string) => void }) => {
        onToken('partial answer')
        throw new Error('stream failed')
      },
    )

    await expect(
      useAppStore.getState().sendMessage('keep partial output'),
    ).resolves.toBe(true)

    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      content: 'partial answer',
      role: 'assistant',
      status: 'error',
    })
    expect(dbMocks.saveAppData.mock.calls.at(-1)?.[0]).toMatchObject({
      conversations: [
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: 'partial answer',
              status: 'error',
            }),
          ]),
        }),
      ],
    })
  })

  it('persists an image attachment terminal state before settling', async () => {
    resetStore()
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    await expect(
      useAppStore.getState().sendMessage('persist generated image', {
        mode: 'image',
        imageTaskMode: 'generate',
      }),
    ).resolves.toBe(true)

    expect(dbMocks.saveAppData.mock.calls.at(-1)?.[0]).toMatchObject({
      conversations: [
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              attachments: [expect.objectContaining({ purpose: 'generated' })],
              status: 'done',
            }),
          ]),
        }),
      ],
    })
  })

  it('does not sync a terminal turn whose final durable save fails', async () => {
    const data = resetStore()
    data.sync = {
      ...data.sync,
      autoSync: true,
      mode: 'cloudflare',
      workerEndpoint: 'https://sync.example.test',
    }
    useAppStore.setState({ data, syncPassphrase: 'test-passphrase' })
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    const failure = new Error(
      'C:\\private\\terminal-save sk-test-secret-1234567890',
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    dbMocks.saveAppData.mockImplementation(async (snapshot: unknown) => {
      const assistant = (snapshot as AppData).conversations[0]?.messages.at(-1)
      if (assistant?.status === 'done') throw failure
    })

    await expect(
      useAppStore.getState().sendMessage('terminal save must win'),
    ).resolves.toBe(true)

    expect(syncMocks.performSync).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      content: 'reply',
      status: 'done',
    })
    expect(useAppStore.getState()).toMatchObject({ sending: false, streaming: false })
    expect(consoleError).toHaveBeenCalledWith('[app] generation terminal save failed')
    expectConsoleErrorDoesNotExpose(consoleError, failure)
    const notice = useAppStore.getState().toasts.at(-1)?.message ?? ''
    expect(notice).toBe(appT(data, 'settings.saveFailed'))
    expect(notice).not.toContain(failure.message)
  })

  it('publishes buffered assistant tokens while the current stream is still pending', async () => {
    resetStore()
    let publishToken!: (token: string) => void
    let finishStream!: () => void
    runtime.streamChat.mockImplementationOnce(
      async ({ onToken }: { onToken: (token: string) => void }) => {
        publishToken = onToken
        await new Promise<void>((resolve) => {
          finishStream = resolve
        })
      },
    )

    const send = useAppStore.getState().sendMessage('stream this')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())
    publishToken('partial')
    await vi.advanceTimersByTimeAsync(40)

    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      content: 'partial',
      status: 'streaming',
    })
    expect(useAppStore.getState()).toMatchObject({ sending: true, streaming: true })

    finishStream()
    await expect(send).resolves.toBe(true)
    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      content: 'partial',
      status: 'done',
    })
  })

  it('does not let a completed generation write a late token into an imported snapshot', async () => {
    resetStore()
    let publishLateToken!: (token: string) => void
    runtime.streamChat.mockImplementationOnce(
      async ({ onToken }: { onToken: (token: string) => void }) => {
        publishLateToken = onToken
      },
    )

    await expect(useAppStore.getState().sendMessage('finish before import')).resolves.toBe(true)
    expect(publishLateToken).toBeTypeOf('function')

    const imported = structuredClone(useAppStore.getState().data!)
    const conversation = imported.conversations[0]
    const assistant = conversation.messages.find((message) => message.role === 'assistant')
    expect(assistant).toBeTruthy()
    assistant!.content = 'imported answer'
    conversation.updatedAt += 1
    imported.updatedAt += 1
    const providerId = imported.providers[0]?.id ?? ''
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValueOnce({
      data: imported,
      secrets: { providerKeys: { [providerId]: 'imported-key' } },
    })
    useAppStore.setState({ syncPassphrase: 'import-passphrase' })

    await useAppStore
      .getState()
      .importBackup(new File(['{}'], 'backup.json', { type: 'application/json' }))

    publishLateToken('late provider output')
    await vi.advanceTimersByTimeAsync(40)

    const importedAssistant = useAppStore
      .getState()
      .data?.conversations[0]?.messages.find((message) => message.id === assistant!.id)
    expect(importedAssistant).toMatchObject({
      id: assistant!.id,
      content: 'imported answer',
    })
  })

  it('does not let an old stream write into a same-id message incarnation adopted by sync', async () => {
    const data = resetStore()
    data.sync = { ...data.sync, autoSync: false, mode: 'gist' }
    useAppStore.setState({
      data,
      githubToken: 'github-token',
      syncPassphrase: 'sync-passphrase',
    })

    let publishLateToken!: (token: string) => void
    let finishStream!: () => void
    let streamSignal!: AbortSignal
    runtime.streamChat.mockImplementationOnce(
      async ({
        onToken,
        signal,
      }: {
        onToken: (token: string) => void
        signal: AbortSignal
      }) => {
        publishLateToken = onToken
        streamSignal = signal
        await new Promise<void>((resolve) => {
          finishStream = resolve
        })
      },
    )

    const sending = useAppStore.getState().sendMessage('old stream')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())

    const current = structuredClone(useAppStore.getState().data!)
    const conversation = current.conversations[0]!
    const oldAssistant = conversation.messages.at(-1)!
    const replacementAssistant = {
      ...oldAssistant,
      content: 'replacement incarnation',
      createdAt: oldAssistant.createdAt + 1,
      status: 'done' as const,
    }
    const remote = structuredClone(current)
    remote.conversations[0] = {
      ...conversation,
      messages: conversation.messages.map((message) =>
        message.id === oldAssistant.id ? replacementAssistant : message,
      ),
      updatedAt: conversation.updatedAt + 1,
    }
    remote.updatedAt += 1
    const providerId = remote.providers[0]!.id
    syncMocks.performSync.mockResolvedValueOnce({
      data: remote,
      message: 'sync complete',
      remoteAccepted: true,
      secrets: { providerKeys: { [providerId]: 'test-key' } },
    })

    await useAppStore.getState().syncNow()
    expect(streamSignal.aborted).toBe(true)
    expect(
      useAppStore.getState().data?.conversations[0]?.messages.at(-1),
    ).toMatchObject({
      id: oldAssistant.id,
      createdAt: replacementAssistant.createdAt,
      content: 'replacement incarnation',
      status: 'done',
    })

    publishLateToken('stale token')
    await vi.advanceTimersByTimeAsync(40)
    expect(
      useAppStore.getState().data?.conversations[0]?.messages.at(-1),
    ).toMatchObject({
      id: oldAssistant.id,
      createdAt: replacementAssistant.createdAt,
      content: 'replacement incarnation',
      status: 'done',
    })

    finishStream()
    await sending
    expect(
      useAppStore.getState().data?.conversations[0]?.messages.at(-1),
    ).toMatchObject({
      id: oldAssistant.id,
      createdAt: replacementAssistant.createdAt,
      content: 'replacement incarnation',
      status: 'done',
    })
  })

  it('does not let an old stream write into a same-id same-timestamp message adopted by sync', async () => {
    const data = resetStore()
    data.sync = { ...data.sync, autoSync: false, mode: 'gist' }
    useAppStore.setState({
      data,
      githubToken: 'github-token',
      syncPassphrase: 'sync-passphrase',
    })

    let publishLateToken!: (token: string) => void
    let finishStream!: () => void
    let streamSignal!: AbortSignal
    runtime.streamChat.mockImplementationOnce(
      async ({
        onToken,
        signal,
      }: {
        onToken: (token: string) => void
        signal: AbortSignal
      }) => {
        publishLateToken = onToken
        streamSignal = signal
        await new Promise<void>((resolve) => {
          finishStream = resolve
        })
      },
    )

    const sending = useAppStore.getState().sendMessage('old stream same timestamp')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())

    const current = structuredClone(useAppStore.getState().data!)
    const conversation = current.conversations[0]!
    const oldAssistant = conversation.messages.at(-1)!
    const remote = structuredClone(current)
    remote.conversations[0] = {
      ...conversation,
      messages: conversation.messages.map((message) =>
        message.id === oldAssistant.id
          ? {
              ...message,
              content: 'replacement same-timestamp incarnation',
              status: 'done' as const,
            }
          : message,
      ),
      updatedAt: conversation.updatedAt + 1,
    }
    remote.updatedAt += 1
    const providerId = remote.providers[0]!.id
    syncMocks.performSync.mockResolvedValueOnce({
      data: remote,
      message: 'sync complete',
      remoteAccepted: true,
      secrets: { providerKeys: { [providerId]: 'test-key' } },
    })

    await useAppStore.getState().syncNow()
    expect(streamSignal.aborted).toBe(true)
    expect(
      useAppStore.getState().data?.conversations[0]?.messages.at(-1),
    ).toMatchObject({
      id: oldAssistant.id,
      createdAt: oldAssistant.createdAt,
      content: 'replacement same-timestamp incarnation',
      status: 'done',
    })

    publishLateToken('stale same-timestamp token')
    await vi.advanceTimersByTimeAsync(40)
    expect(
      useAppStore.getState().data?.conversations[0]?.messages.at(-1),
    ).toMatchObject({
      id: oldAssistant.id,
      createdAt: oldAssistant.createdAt,
      content: 'replacement same-timestamp incarnation',
      status: 'done',
    })

    finishStream()
    await sending
    expect(
      useAppStore.getState().data?.conversations[0]?.messages.at(-1),
    ).toMatchObject({
      id: oldAssistant.id,
      createdAt: oldAssistant.createdAt,
      content: 'replacement same-timestamp incarnation',
      status: 'done',
    })
  })

  it('does not let an old stream write into a same-id same-timestamp streaming incarnation adopted by sync', async () => {
    const data = resetStore()
    data.sync = { ...data.sync, autoSync: false, mode: 'gist' }
    useAppStore.setState({
      data,
      githubToken: 'github-token',
      syncPassphrase: 'sync-passphrase',
    })

    let publishLateToken!: (token: string) => void
    let finishStream!: () => void
    let streamSignal!: AbortSignal
    runtime.streamChat.mockImplementationOnce(
      async ({
        onToken,
        signal,
      }: {
        onToken: (token: string) => void
        signal: AbortSignal
      }) => {
        publishLateToken = onToken
        streamSignal = signal
        await new Promise<void>((resolve) => {
          finishStream = resolve
        })
      },
    )

    const sending = useAppStore
      .getState()
      .sendMessage('old stream same timestamp new generation')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())

    const current = structuredClone(useAppStore.getState().data!)
    const conversation = current.conversations[0]!
    const oldAssistant = conversation.messages.at(-1)!
    const replacementAssistant = {
      ...oldAssistant,
      content: 'replacement same-timestamp streaming incarnation',
      generationId: 'remote-generation',
      status: 'streaming' as const,
    }
    const remote = structuredClone(current)
    remote.conversations[0] = {
      ...conversation,
      messages: conversation.messages.map((message) =>
        message.id === oldAssistant.id ? replacementAssistant : message,
      ),
      updatedAt: conversation.updatedAt + 1,
    }
    remote.updatedAt += 1
    const providerId = remote.providers[0]!.id
    syncMocks.performSync.mockResolvedValueOnce({
      data: remote,
      message: 'sync complete',
      remoteAccepted: true,
      secrets: { providerKeys: { [providerId]: 'test-key' } },
    })

    await useAppStore.getState().syncNow()
    expect(streamSignal.aborted).toBe(true)
    expect(
      useAppStore.getState().data?.conversations[0]?.messages.at(-1),
    ).toMatchObject({
      id: oldAssistant.id,
      createdAt: oldAssistant.createdAt,
      content: 'replacement same-timestamp streaming incarnation',
      status: 'streaming',
    })

    publishLateToken('stale same-timestamp streaming token')
    await vi.advanceTimersByTimeAsync(40)
    expect(
      useAppStore.getState().data?.conversations[0]?.messages.at(-1),
    ).toMatchObject({
      id: oldAssistant.id,
      createdAt: oldAssistant.createdAt,
      content: 'replacement same-timestamp streaming incarnation',
      status: 'streaming',
    })

    finishStream()
    await sending
    expect(
      useAppStore.getState().data?.conversations[0]?.messages.at(-1),
    ).toMatchObject({
      id: oldAssistant.id,
      createdAt: oldAssistant.createdAt,
      content: 'replacement same-timestamp streaming incarnation',
      status: 'streaming',
    })
  })

  it('does not let terminal-save fallback patch a same-id replacement generation', async () => {
    const data = resetStore()
    data.sync = { ...data.sync, autoSync: false, mode: 'gist' }
    useAppStore.setState({
      data,
      githubToken: 'github-token',
      syncPassphrase: 'sync-passphrase',
    })

    let finishStream!: () => void
    let streamSignal!: AbortSignal
    runtime.streamChat.mockImplementationOnce(
      async ({ signal }: { signal: AbortSignal }) => {
        streamSignal = signal
        await new Promise<void>((resolve) => {
          finishStream = resolve
        })
      },
    )

    const sending = useAppStore.getState().sendMessage('old terminal owner')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())

    const current = structuredClone(useAppStore.getState().data!)
    const conversation = current.conversations[0]!
    const oldAssistant = conversation.messages.at(-1)!
    const replacementAssistant = {
      ...oldAssistant,
      content: 'new generation must remain streaming',
      status: 'streaming' as const,
    }
    const remote = structuredClone(current)
    remote.conversations[0] = {
      ...conversation,
      createdAt: conversation.createdAt + 1,
      updatedAt: conversation.updatedAt + 1,
      messages: conversation.messages.map((message) =>
        message.id === oldAssistant.id ? replacementAssistant : message,
      ),
    }
    remote.updatedAt += 1
    const providerId = remote.providers[0]!.id
    syncMocks.performSync.mockResolvedValueOnce({
      data: remote,
      message: 'sync complete',
      remoteAccepted: true,
      secrets: { providerKeys: { [providerId]: 'test-key' } },
    })

    let releaseTerminalPersist!: () => void
    let attemptedTerminalSnapshot: AppData | undefined
    const terminalPersist = new Promise<AppData>((resolve) => {
      releaseTerminalPersist = () => resolve(attemptedTerminalSnapshot!)
    })
    dbMocks.persistAppDataSkillContents.mockImplementationOnce(
      async (snapshot: unknown) => {
        attemptedTerminalSnapshot = structuredClone(snapshot as AppData)
        return terminalPersist
      },
    )
    finishStream()
    await vi.waitFor(() => expect(attemptedTerminalSnapshot).toBeDefined())

    await useAppStore.getState().syncNow()
    expect(streamSignal.aborted).toBe(true)
    expect(
      useAppStore.getState().data?.conversations[0]?.messages.at(-1),
    ).toMatchObject({
      id: oldAssistant.id,
      createdAt: oldAssistant.createdAt,
      content: 'new generation must remain streaming',
      status: 'streaming',
    })

    const terminalFailure = new Error('terminal fallback save failed')
    dbMocks.saveAppData.mockRejectedValueOnce(terminalFailure)
    releaseTerminalPersist()
    await expect(sending).resolves.toBe(true)

    expect(attemptedTerminalSnapshot?.conversations[0]?.messages.at(-1)).toMatchObject({
      id: oldAssistant.id,
      createdAt: oldAssistant.createdAt,
      status: 'done',
    })
    expect(
      useAppStore.getState().data?.conversations[0]?.messages.at(-1),
    ).toMatchObject({
      id: oldAssistant.id,
      createdAt: oldAssistant.createdAt,
      content: 'new generation must remain streaming',
      status: 'streaming',
    })
  })

  it('aborts an active stream when sync deletes its conversation', async () => {
    const data = resetStore()
    data.sync = { ...data.sync, autoSync: false, mode: 'gist' }
    useAppStore.setState({
      data,
      githubToken: 'github-token',
      syncPassphrase: 'sync-passphrase',
    })

    let publishToken!: (token: string) => void
    let finishStream!: () => void
    let streamSignal!: AbortSignal
    runtime.streamChat.mockImplementationOnce(
      async ({
        onToken,
        signal,
      }: {
        onToken: (token: string) => void
        signal: AbortSignal
      }) => {
        publishToken = onToken
        streamSignal = signal
        await new Promise<void>((resolve) => {
          finishStream = resolve
        })
      },
    )

    const sending = useAppStore.getState().sendMessage('delete this stream')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())
    publishToken('partial before deletion')
    await vi.advanceTimersByTimeAsync(40)

    const current = structuredClone(useAppStore.getState().data!)
    const secondConversation = {
      ...structuredClone(current.conversations[0]!),
      id: 'sync-delete-survivor',
      messages: [],
      createdAt: current.conversations[0]!.createdAt + 1,
      updatedAt: current.conversations[0]!.updatedAt + 1,
    }
    current.conversations.push(secondConversation)
    const remote = structuredClone(current)
    remote.conversations = remote.conversations.filter(
      (conversation) => conversation.id !== data.conversations[0]!.id,
    )
    remote.preferences = {
      ...remote.preferences,
      activeConversationId: secondConversation.id,
    }
    remote.updatedAt += 1
    const providerId = remote.providers[0]!.id
    syncMocks.performSync.mockResolvedValueOnce({
      data: remote,
      message: 'sync complete',
      remoteAccepted: true,
      secrets: { providerKeys: { [providerId]: 'test-key' } },
    })

    await useAppStore.getState().syncNow()
    expect(streamSignal.aborted).toBe(true)
    expect(
      useAppStore.getState().data?.conversations.map((conversation) => conversation.id),
    ).toEqual([secondConversation.id])

    publishToken('late after deletion')
    finishStream()
    await sending
    expect(
      useAppStore.getState().data?.conversations.map((conversation) => conversation.id),
    ).toEqual([secondConversation.id])
  })

  it('aborts an active stream when sync deletes only its assistant message', async () => {
    const data = resetStore()
    data.sync = { ...data.sync, autoSync: false, mode: 'gist' }
    useAppStore.setState({
      data,
      githubToken: 'github-token',
      syncPassphrase: 'sync-passphrase',
    })

    let publishToken!: (token: string) => void
    let finishStream!: () => void
    let streamSignal!: AbortSignal
    runtime.streamChat.mockImplementationOnce(
      async ({
        onToken,
        signal,
      }: {
        onToken: (token: string) => void
        signal: AbortSignal
      }) => {
        publishToken = onToken
        streamSignal = signal
        await new Promise<void>((resolve) => {
          finishStream = resolve
        })
      },
    )

    const sending = useAppStore.getState().sendMessage('delete this answer')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())
    publishToken('partial before message deletion')
    await vi.advanceTimersByTimeAsync(40)

    const current = structuredClone(useAppStore.getState().data!)
    const localConversation = current.conversations[0]!
    const remote = structuredClone(current)
    remote.conversations = remote.conversations.map((conversation) =>
      conversation.id === localConversation.id
        ? {
            ...conversation,
            messages: conversation.messages.filter(
              (message) => message.role !== 'assistant',
            ),
            updatedAt: conversation.updatedAt + 1,
          }
        : conversation,
    )
    remote.updatedAt += 1
    const providerId = remote.providers[0]!.id
    syncMocks.performSync.mockResolvedValueOnce({
      data: remote,
      message: 'sync complete',
      remoteAccepted: true,
      secrets: { providerKeys: { [providerId]: 'test-key' } },
    })

    await useAppStore.getState().syncNow()
    expect(streamSignal.aborted).toBe(true)
    expect(
      useAppStore.getState().data?.conversations[0]?.messages,
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'assistant' }),
      ]),
    )

    publishToken('late after message deletion')
    finishStream()
    await sending

    expect(
      useAppStore.getState().data?.conversations[0]?.messages,
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: 'late after message deletion' }),
      ]),
    )
    expect(dbMocks.saveAppData.mock.calls.at(-1)?.[0]).not.toEqual(
      expect.objectContaining({
        conversations: expect.arrayContaining([
          expect.objectContaining({
            messages: expect.arrayContaining([
              expect.objectContaining({ role: 'assistant' }),
            ]),
          }),
        ]),
      }),
    )
  })

  it('covers fallback model selection, system language, active deletion, and masks', async () => {
    const data = resetStore()
    const conversation = data.conversations[0]
    const provider = data.providers[0]
    provider.model = ''
    provider.models = ['fallback-model']
    conversation.model = ''
    const documentStub = { documentElement: { dir: '', lang: '' } }
    vi.stubGlobal('document', documentStub)
    await useAppStore.getState().setLanguage('system')
    await useAppStore
      .getState()
      .setConversationModelChoice(conversation.id, provider.id, '')
    expect(useAppStore.getState().data?.conversations[0].model).toBe(
      'fallback-model',
    )

    await useAppStore.getState().setActiveConversation(conversation.id)
    await useAppStore.getState().deleteConversation(conversation.id)
    expect(useAppStore.getState().data?.conversations).toHaveLength(0)

    const imageData = resetStore()
    expect(await useAppStore.getState().sendMessage('inpaint', {
      imageSourceFile: imageFile('source.png'),
      imageTaskMode: 'inpaint',
      maskFile: imageFile('mask.png'),
      mode: 'image',
    })).toBe(true)
    expect(runtime.editImage).toHaveBeenCalledWith(
      expect.objectContaining({ mask: expect.any(File) }),
    )
    expect(imageData.conversations[0].messages).toHaveLength(0)
  })

  it('aborts and drains an active generation before deleting its conversation', async () => {
    const data = resetStore()
    const conversation = data.conversations[0]
    let finishStream!: () => void
    let streamSignal!: AbortSignal
    runtime.streamChat.mockImplementationOnce(
      async ({ signal }: { signal: AbortSignal }) => {
        streamSignal = signal
        await new Promise<void>((resolve) => {
          finishStream = resolve
        })
      },
    )

    const sending = useAppStore.getState().sendMessage('delete active stream')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())

    vi.mocked(globalThis.confirm).mockReturnValueOnce(true)
    const deletion = useAppStore.getState().deleteConversation(conversation.id)

    await vi.waitFor(() => expect(streamSignal.aborted).toBe(true))
    expect(useAppStore.getState().data?.conversations).toContainEqual(
      expect.objectContaining({ id: conversation.id }),
    )

    finishStream()
    await vi.advanceTimersByTimeAsync(50)
    await expect(sending).resolves.toBe(true)
    await expect(deletion).resolves.toBe(true)
    expect(useAppStore.getState().data?.conversations).not.toContainEqual(conversation)
  })

  it('aborts and drains an active generation before deleting its message', async () => {
    resetStore()
    let finishStream!: () => void
    let streamSignal!: AbortSignal
    runtime.streamChat.mockImplementationOnce(
      async ({ signal }: { signal: AbortSignal }) => {
        streamSignal = signal
        await new Promise<void>((resolve) => {
          finishStream = resolve
        })
      },
    )

    const sending = useAppStore.getState().sendMessage('delete active message')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())
    const assistant = useAppStore.getState().data?.conversations[0].messages.at(-1)
    expect(assistant).toMatchObject({ role: 'assistant', status: 'streaming' })

    vi.mocked(globalThis.confirm).mockReturnValueOnce(true)
    const deletion = useAppStore.getState().deleteMessage(assistant!.id)

    await vi.waitFor(() => expect(streamSignal.aborted).toBe(true))
    expect(
      useAppStore.getState().data?.conversations[0].messages,
    ).toContainEqual(assistant)

    finishStream()
    await vi.advanceTimersByTimeAsync(50)
    await expect(sending).resolves.toBe(true)
    await expect(deletion).resolves.toBe(true)
    expect(
      useAppStore.getState().data?.conversations[0].messages,
    ).not.toContainEqual(expect.objectContaining({ id: assistant!.id }))
  })

  it('deletes an unrelated conversation without cancelling the active generation', async () => {
    const data = freshData()
    const activeConversation = data.conversations[0]
    const unrelatedConversation = {
      ...structuredClone(activeConversation),
      id: 'unrelated-generation-delete-target',
      title: 'Unrelated conversation',
    }
    data.conversations.push(unrelatedConversation)
    resetStore(data)

    let finishStream!: () => void
    let streamSignal!: AbortSignal
    runtime.streamChat.mockImplementationOnce(
      async ({ signal }: { signal: AbortSignal }) => {
        streamSignal = signal
        await new Promise<void>((resolve) => {
          finishStream = resolve
        })
      },
    )

    const sending = useAppStore.getState().sendMessage('keep active generation')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())

    await expect(
      useAppStore.getState().deleteConversation(unrelatedConversation.id),
    ).resolves.toBe(true)
    expect(streamSignal.aborted).toBe(false)
    expect(
      useAppStore
        .getState()
        .data?.conversations.some(
          (conversation) => conversation.id === unrelatedConversation.id,
        ),
    ).toBe(false)

    finishStream()
    await expect(sending).resolves.toBe(true)
  })

  it('publishes a conversation title only after the rename is durable and owns duplicate submits', async () => {
    const data = resetStore()
    const conversation = data.conversations[0]
    const originalTitle = conversation.title
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseSave!: () => void
    const save = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    dbMocks.saveAppData.mockImplementationOnce(async (snapshot: unknown) => {
      expect((snapshot as AppData).conversations[0]?.title).toBe('Renamed')
      await save
    })

    const renaming = Promise.resolve(
      useAppStore.getState().renameConversation(conversation.id, '  Renamed  '),
    )
    let settled = false
    void renaming.then(() => {
      settled = true
    })
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())

    const settledBeforeRelease = settled
    const titleBeforeRelease = useAppStore.getState().data?.conversations[0]?.title
    const duplicate = Promise.resolve(
      useAppStore.getState().renameConversation(conversation.id, 'Duplicate'),
    )
    releaseSave()
    const [renameAccepted, duplicateAccepted] = await Promise.all([
      renaming,
      duplicate,
    ])
    await vi.runAllTimersAsync()
    await useAppStore.getState().flushLocalSaves()

    expect(settledBeforeRelease).toBe(false)
    expect(titleBeforeRelease).toBe(originalTitle)
    expect(duplicateAccepted).toBe(false)
    expect(renameAccepted).toBe(true)
    expect(useAppStore.getState().data?.conversations[0]?.title).toBe('Renamed')
    expect(dbMocks.saveAppData).toHaveBeenCalledOnce()
  })

  it('keeps the conversation title when its durable rename fails without exposing diagnostics', async () => {
    const data = resetStore()
    const conversation = data.conversations[0]
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    const failure = new Error(
      'C:\\private\\conversation-title sk-private-title-secret',
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    dbMocks.saveAppData.mockRejectedValueOnce(failure)

    await expect(
      Promise.resolve(
        useAppStore.getState().renameConversation(conversation.id, 'Lost title'),
      ),
    ).resolves.toBe(false)

    expect(useAppStore.getState().data?.conversations[0]).toBe(conversation)
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: appT(data, 'settings.saveFailed'),
      tone: 'error',
    })
    expect(consoleError).toHaveBeenCalledWith('[app] conversation rename failed')
    expectConsoleErrorDoesNotExpose(consoleError, failure)
  })

  it('publishes a new conversation only after its snapshot is durable', async () => {
    const data = resetStore()
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseSave!: () => void
    const save = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    dbMocks.saveAppData.mockImplementationOnce(async (snapshot: unknown) => {
      expect((snapshot as AppData).conversations).toHaveLength(2)
      await save
    })

    const creation = Promise.resolve(useAppStore.getState().createNewConversation())
    let settled = false
    void creation.then(() => {
      settled = true
    })
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())
    const settledBeforeRelease = settled
    const dataBeforeRelease = useAppStore.getState().data

    releaseSave()
    const accepted = await creation
    await vi.runAllTimersAsync()
    await useAppStore.getState().flushLocalSaves()

    expect(settledBeforeRelease).toBe(false)
    expect(dataBeforeRelease).toBe(data)
    expect(accepted).toBe(true)
    expect(useAppStore.getState().data?.conversations).toHaveLength(2)
    expect(useAppStore.getState().data?.preferences.activeConversationId).toBe(
      useAppStore.getState().data?.conversations[0]?.id,
    )
    expect(dbMocks.saveAppData).toHaveBeenCalledOnce()
  })

  it('publishes an active conversation switch only after its snapshot is durable', async () => {
    const data = resetStore()
    const first = data.conversations[0]
    const second = { ...structuredClone(first), id: 'durable-active-second' }
    data.conversations.push(second)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseSave!: () => void
    const save = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    dbMocks.saveAppData.mockImplementationOnce(async (snapshot: unknown) => {
      expect((snapshot as AppData).preferences.activeConversationId).toBe(second.id)
      await save
    })

    const switching = Promise.resolve(
      useAppStore.getState().setActiveConversation(second.id),
    )
    let settled = false
    void switching.then(() => {
      settled = true
    })
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())
    const settledBeforeRelease = settled
    const activeBeforeRelease =
      useAppStore.getState().data?.preferences.activeConversationId

    releaseSave()
    const accepted = await switching
    await vi.runAllTimersAsync()
    await useAppStore.getState().flushLocalSaves()

    expect(settledBeforeRelease).toBe(false)
    expect(activeBeforeRelease).toBe(first.id)
    expect(accepted).toBe(true)
    expect(useAppStore.getState().data?.preferences.activeConversationId).toBe(
      second.id,
    )
    expect(dbMocks.saveAppData).toHaveBeenCalledOnce()
  })

  it.each(['create', 'activate'] as const)(
    'keeps conversation state when a durable %s action fails',
    async (action) => {
      const data = resetStore()
      const first = data.conversations[0]
      const second = { ...structuredClone(first), id: 'failed-active-second' }
      data.conversations.push(second)
      await useAppStore.getState().flushLocalSaves()
      dbMocks.saveAppData.mockClear()
      const failure = new Error(
        `C:\\private\\conversation-${action} sk-private-conversation-secret`,
      )
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      dbMocks.saveAppData.mockRejectedValueOnce(failure)

      const result =
        action === 'create'
          ? useAppStore.getState().createNewConversation()
          : useAppStore.getState().setActiveConversation(second.id)
      const accepted = await Promise.resolve(result)
      const dataAfterAction = useAppStore.getState().data
      const activeAfterAction = dataAfterAction?.preferences.activeConversationId
      const toastAfterAction = useAppStore.getState().toasts.at(-1)
      await vi.runAllTimersAsync()
      await useAppStore.getState().flushLocalSaves().catch(() => undefined)

      expect(accepted).toBe(false)
      expect(dataAfterAction).toBe(data)
      expect(activeAfterAction).toBe(first.id)
      expect(toastAfterAction).toMatchObject({
        message: appT(data, 'settings.saveFailed'),
        tone: 'error',
      })
      expect(consoleError).toHaveBeenCalledWith(
        `[app] conversation ${action === 'create' ? 'creation' : 'activation'} failed`,
      )
      expectConsoleErrorDoesNotExpose(consoleError, failure)
    },
  )

  it('publishes a conversation model choice only after its snapshot is durable', async () => {
    const data = resetStore()
    const conversation = data.conversations[0]
    const provider = data.providers[0]
    const previousModel = conversation.model
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseSave!: () => void
    const save = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    dbMocks.saveAppData.mockImplementationOnce(async (snapshot: unknown) => {
      expect((snapshot as AppData).conversations[0]?.model).toBe('durable-model')
      await save
    })

    const selection = Promise.resolve(
      useAppStore
        .getState()
        .setConversationModelChoice(
          conversation.id,
          provider.id,
          'durable-model',
        ),
    )
    let settled = false
    void selection.then(() => {
      settled = true
    })
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())
    const settledBeforeRelease = settled
    const pendingBeforeRelease =
      useAppStore.getState().conversationMutationPending
    const modelBeforeRelease = useAppStore.getState().data?.conversations[0]?.model

    releaseSave()
    const accepted = await selection
    await vi.runAllTimersAsync()
    await useAppStore.getState().flushLocalSaves()

    expect(settledBeforeRelease).toBe(false)
    expect(pendingBeforeRelease).toBe(true)
    expect(useAppStore.getState().conversationMutationPending).toBe(false)
    expect(modelBeforeRelease).toBe(previousModel)
    expect(accepted).toBe(true)
    expect(useAppStore.getState().data?.conversations[0]).toMatchObject({
      model: 'durable-model',
      providerId: provider.id,
    })
    expect(dbMocks.saveAppData).toHaveBeenCalledOnce()
  })

  it.each(['send', 'regenerate', 'retry', 'edit-and-resend'] as const)(
    'rejects %s generation admission while a conversation mutation is durable',
    async (action) => {
      const data = resetStore()
      const conversation = data.conversations[0]
      const provider = data.providers[0]
      const user = message('conversation-gate-user', 'user', 'original prompt')
      const assistant = message(
        'conversation-gate-assistant',
        'assistant',
        'previous failure',
        { error: 'previous failure', status: 'error' },
      )
      withMessages(data, [user, assistant])
      const composerImage = {
        dataUrl: 'data:image/png;base64,AAAA',
        id: 'conversation-gate-composer-image',
        mimeType: 'image/png',
        name: 'conversation-gate.png',
      }
      useAppStore.setState({ composerImages: [composerImage] })
      await useAppStore.getState().flushLocalSaves()
      dbMocks.saveAppData.mockClear()
      runtime.streamChat.mockClear()
      runtime.generateImage.mockClear()
      runtime.editImage.mockClear()

      let releaseSave!: () => void
      const blockedSave = new Promise<void>((resolve) => {
        releaseSave = resolve
      })
      dbMocks.saveAppData.mockImplementationOnce(async () => blockedSave)

      const selection = useAppStore
        .getState()
        .setConversationModelChoice(
          conversation.id,
          provider.id,
          'durable-next-model',
        )
      await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())
      const messagesBefore = structuredClone(
        useAppStore.getState().data?.conversations[0].messages,
      )
      let generationOwnerPublished = false
      const unsubscribe = useAppStore.subscribe((state) => {
        if (state.sending || state.streaming) generationOwnerPublished = true
      })

      const generation =
        action === 'send'
          ? useAppStore.getState().sendMessage('new prompt')
          : action === 'regenerate'
            ? useAppStore.getState().regenerate()
            : action === 'retry'
              ? useAppStore.getState().retryMessage(assistant.id)
              : useAppStore
                  .getState()
                  .editAndResendMessage(user.id, 'edited prompt')

      await Promise.resolve()
      const admissionState = {
        sending: useAppStore.getState().sending,
        streaming: useAppStore.getState().streaming,
      }

      releaseSave()
      await selection
      const accepted = await generation
      unsubscribe()

      expect(admissionState).toEqual({ sending: false, streaming: false })
      expect(generationOwnerPublished).toBe(false)
      if (action === 'send' || action === 'edit-and-resend') {
        expect(accepted).toBe(false)
      }
      expect(useAppStore.getState().composerImages).toEqual([composerImage])
      expect(runtime.streamChat).not.toHaveBeenCalled()
      expect(runtime.generateImage).not.toHaveBeenCalled()
      expect(runtime.editImage).not.toHaveBeenCalled()
      expect(useAppStore.getState().data?.conversations[0].messages).toEqual(
        messagesBefore,
      )
    },
  )

  it('rejects a conversation model mutation while an admitted generation is deriving its proxy token', async () => {
    const data = freshData()
    const conversation = data.conversations[0]
    const provider = data.providers[0]
    const originalModel = conversation.model
    const nextModel = 'next-conversation-model'
    data.providers[0] = {
      ...provider,
      clientRequestMode: false,
      models: [...(provider.models ?? []), nextModel],
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'proxy-passphrase' })

    let releaseDerivation!: (value: string) => void
    accessKeyMocks.accessKeyFromPassword.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseDerivation = resolve
        }),
    )

    const generation = useAppStore
      .getState()
      .sendMessage('generation owns the current model')
    await vi.waitFor(() =>
      expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledOnce(),
    )
    expect(useAppStore.getState()).toMatchObject({
      sending: true,
      streaming: true,
    })

    await expect(
      useAppStore
        .getState()
        .setConversationModelChoice(conversation.id, provider.id, nextModel),
    ).resolves.toBe(false)
    expect(dbMocks.saveAppData).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.conversations[0].model).toBe(
      originalModel,
    )

    releaseDerivation('proxy-token')
    await generation

    expect(runtime.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({ model: originalModel }),
    )
    expect(useAppStore.getState().data?.conversations[0].model).toBe(
      originalModel,
    )
  })

  it.each(['audio-transcription', 'speech-playback'] as const)(
    'rejects %s Provider media admission while a conversation mutation is durable',
    async (action) => {
      const data = resetStore()
      const conversation = data.conversations[0]
      const provider = data.providers[0]
      const assistant = message(
        'conversation-gate-media-assistant',
        'assistant',
        'Read without crossing the model owner',
      )
      withMessages(data, [assistant])
      await useAppStore.getState().flushLocalSaves()
      dbMocks.saveAppData.mockClear()
      runtime.synthesizeSpeechAudio.mockClear()
      runtime.transcribeAudioFile.mockClear()

      let releaseSave!: () => void
      const blockedSave = new Promise<void>((resolve) => {
        releaseSave = resolve
      })
      dbMocks.saveAppData.mockImplementationOnce(async () => blockedSave)
      const selection = useAppStore
        .getState()
        .setConversationModelChoice(
          conversation.id,
          provider.id,
          'durable-media-model',
        )
      await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())

      if (action === 'audio-transcription') {
        await expect(
          useAppStore
            .getState()
            .transcribeAudio(
              new File(['audio'], 'blocked.wav', { type: 'audio/wav' }),
            ),
        ).resolves.toBeNull()
      } else {
        await expect(
          useAppStore.getState().speakMessage(assistant),
        ).resolves.toBeUndefined()
      }

      releaseSave()
      await selection

      expect(runtime.transcribeAudioFile).not.toHaveBeenCalled()
      expect(runtime.synthesizeSpeechAudio).not.toHaveBeenCalled()
      expect(useAppStore.getState()).toMatchObject({
        speakingMessageId: '',
        transcribingAudio: false,
      })
    },
  )

  it('keeps the current conversation model when its durable selection fails', async () => {
    const data = resetStore()
    const conversation = data.conversations[0]
    const provider = data.providers[0]
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    const failure = new Error(
      'C:\\private\\conversation-model sk-private-model-secret',
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    dbMocks.saveAppData.mockRejectedValueOnce(failure)

    await expect(
      Promise.resolve(
        useAppStore
          .getState()
          .setConversationModelChoice(
            conversation.id,
            provider.id,
            'lost-model',
          ),
      ),
    ).resolves.toBe(false)

    expect(useAppStore.getState().data).toBe(data)
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: appT(data, 'settings.saveFailed'),
      tone: 'error',
    })
    expect(consoleError).toHaveBeenCalledWith(
      '[app] conversation model selection failed',
    )
    expectConsoleErrorDoesNotExpose(consoleError, failure)
  })

  it('publishes a confirmed conversation deletion only after it is durable', async () => {
    const data = resetStore()
    const conversation = data.conversations[0]
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    const confirm = vi.mocked(globalThis.confirm)
    confirm.mockReturnValueOnce(false)

    await expect(
      Promise.resolve(useAppStore.getState().deleteConversation(conversation.id)),
    ).resolves.toBe(false)
    expect(dbMocks.saveAppData).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.conversations).toContainEqual(conversation)

    let finishSave!: () => void
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve
        }),
    )
    let settled = false
    const deletion = Promise.resolve(
      useAppStore.getState().deleteConversation(conversation.id),
    ).finally(() => {
      settled = true
    })
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())

    expect(settled).toBe(false)
    expect(useAppStore.getState().data?.conversations).toContainEqual(conversation)
    finishSave()
    await expect(deletion).resolves.toBe(true)
    expect(useAppStore.getState().data?.conversations).toHaveLength(0)
  })

  it('does not open deletion confirmation while another conversation mutation is durable', async () => {
    const data = resetStore()
    const conversation = data.conversations[0]
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseRename!: () => void
    const renameSave = new Promise<void>((resolve) => {
      releaseRename = resolve
    })
    dbMocks.saveAppData.mockImplementationOnce(async () => renameSave)

    const renaming = useAppStore
      .getState()
      .renameConversation(conversation.id, 'Renamed while deleting')
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())
    expect(useAppStore.getState().conversationMutationPending).toBe(true)

    const confirm = vi.mocked(globalThis.confirm)
    confirm.mockClear()
    confirm.mockReturnValueOnce(true)

    await expect(
      Promise.resolve(useAppStore.getState().deleteConversation(conversation.id)),
    ).resolves.toBe(false)
    expect(confirm).not.toHaveBeenCalled()
    expect(dbMocks.saveAppData).toHaveBeenCalledOnce()
    expect(useAppStore.getState().data?.conversations).toContainEqual(conversation)

    releaseRename()
    await expect(renaming).resolves.toBe(true)
  })

  it('does not let an older delayed save resurrect a deleted conversation', async () => {
    const data = resetStore()
    const conversation = data.conversations[0]
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseOldSave!: () => void
    const oldSave = new Promise<void>((resolve) => {
      releaseOldSave = resolve
    })
    dbMocks.saveAppData.mockImplementationOnce(async (snapshot: unknown) => {
      expect((snapshot as AppData).conversations).toContainEqual(conversation)
      await oldSave
    })

    useAppStore.getState().setTheme('dark')
    const flushing = useAppStore.getState().flushLocalSaves()
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())

    vi.mocked(globalThis.confirm).mockReturnValueOnce(true)
    let deletionSettled = false
    const deletion = useAppStore.getState().deleteConversation(conversation.id).finally(() => {
      deletionSettled = true
    })
    await Promise.resolve()

    expect(deletionSettled).toBe(false)
    expect(useAppStore.getState().data?.conversations).toContainEqual(conversation)

    releaseOldSave()
    await flushing
    await expect(deletion).resolves.toBe(true)
    await useAppStore.getState().flushLocalSaves()

    expect(useAppStore.getState().data?.conversations).not.toContainEqual(conversation)
    expect(
      (dbMocks.saveAppData.mock.calls.at(-1)?.[0] as AppData).conversations,
    ).not.toContainEqual(conversation)
  })

  it('contains a rejected conversation deletion confirmation', async () => {
    const data = resetStore()
    const conversation = data.conversations[0]
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    const sentinel = new Error('C:\\private\\confirm-delete sk-private')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(globalThis.confirm).mockImplementationOnce(() => {
      throw sentinel
    })

    await expect(
      useAppStore.getState().deleteConversation(conversation.id),
    ).resolves.toBe(false)

    expect(dbMocks.saveAppData).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.conversations).toContainEqual(conversation)
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: appT(data, 'settings.saveFailed'),
      tone: 'error',
    })
    expect(consoleError).toHaveBeenCalledWith(
      '[app] conversation deletion confirmation failed',
    )
    expectConsoleErrorDoesNotExpose(consoleError, sentinel)
  })

  it('keeps a conversation when its confirmed deletion cannot persist', async () => {
    const data = resetStore()
    const conversation = data.conversations[0]
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    const sentinel = new Error('C:\\private\\conversation-delete sk-private')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    dbMocks.saveAppData.mockRejectedValueOnce(sentinel)

    await expect(
      Promise.resolve(useAppStore.getState().deleteConversation(conversation.id)),
    ).resolves.toBe(false)

    expect(useAppStore.getState().data?.conversations).toContainEqual(conversation)
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: appT(data, 'settings.saveFailed'),
      tone: 'error',
    })
    expect(consoleError).toHaveBeenCalledWith('[app] conversation deletion failed')
    expectConsoleErrorDoesNotExpose(consoleError, sentinel)
  })

  it('queues offline text and replays it when the network returns', async () => {
    const data = resetStore()
    data.sync = {
      ...data.sync,
      autoSync: true,
      mode: 'cloudflare',
      workerEndpoint: 'http://127.0.0.1',
    }
    useAppStore.setState({ data, syncPassphrase: 'test-passphrase' })
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    expect(await useAppStore.getState().sendMessage('offline message')).toBe(true)
    let messages = useAppStore.getState().data?.conversations[0].messages ?? []
    expect(messages.at(-1)).toMatchObject({ status: 'queued' })

    navigatorStub.onLine = true
    await useAppStore.getState().flushOfflineQueue()
    messages = useAppStore.getState().data?.conversations[0].messages ?? []
    expect(messages.at(-1)).toMatchObject({ content: 'replayed', status: 'done' })
    expect(streamMocks.streamAssistantText).toHaveBeenCalledTimes(1)
    expect(syncMocks.performSync).toHaveBeenCalledTimes(1)

    const missingProvider = freshData()
    missingProvider.conversations[0].messages = [
      message('orphan-prompt', 'user', 'queued prompt'),
      message('orphan', 'assistant', 'queued', {
        status: 'queued',
        queuedTextRequest: {
          model: missingProvider.providers[0].model,
          providerId: 'missing-provider',
          promptMessageId: 'orphan-prompt',
        },
      }),
    ]
    useAppStore.setState({ data: missingProvider })
    await useAppStore.getState().flushOfflineQueue()
    expect(useAppStore.getState().data?.conversations[0].messages[1]).toMatchObject({
      content: appT(missingProvider, 'composer.addProviderFirst'),
      status: 'error',
    })
  })

  it('keeps persisted system prompts in an offline replay request', async () => {
    const data = resetStore()
    const systemPrompt = message(
      'offline-system-prompt',
      'system',
      'Offline system prompt must stay',
    )
    withMessages(data, [systemPrompt])
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)

    await expect(useAppStore.getState().sendMessage('offline prompt')).resolves.toBe(
      true,
    )

    navigatorStub.onLine = true
    await useAppStore.getState().flushOfflineQueue()

    expect(streamMocks.streamAssistantText).toHaveBeenCalledWith(
      expect.objectContaining({
        baseMessages: expect.arrayContaining([
          expect.objectContaining({
            id: systemPrompt.id,
            role: 'system',
            content: systemPrompt.content,
          }),
        ]),
      }),
    )
  })

  it('replays each offline turn with its captured Provider and model', async () => {
    const data = freshData()
    const firstProvider = {
      ...data.providers[0],
      id: 'provider-first',
      model: 'captured-model-first',
      name: 'First Provider',
    }
    const secondProvider = {
      ...firstProvider,
      id: 'provider-second',
      model: 'captured-model-second',
      name: 'Second Provider',
    }
    data.providers = [firstProvider, secondProvider]
    data.conversations[0] = {
      ...data.conversations[0],
      providerId: firstProvider.id,
      model: firstProvider.model,
    }
    resetStore(data)
    useAppStore.setState({
      keys: {
        [firstProvider.id]: 'first-key',
        [secondProvider.id]: 'second-key',
      },
    })
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('first captured turn')
    const afterFirst = useAppStore.getState().data!
    useAppStore.setState({
      data: {
        ...afterFirst,
        conversations: afterFirst.conversations.map((conversation, index) =>
          index === 0
            ? {
                ...conversation,
                providerId: secondProvider.id,
                model: secondProvider.model,
              }
            : conversation,
        ),
      },
    })
    await useAppStore.getState().sendMessage('second captured turn')
    const requests: Array<{ providerId: string; model: string; prompt: string }> = []
    streamMocks.streamAssistantText.mockImplementation(
      async ({
        latestInput,
        model,
        onToken,
        provider,
      }: {
        latestInput: string
        model: string
        onToken: (token: string) => void
        provider: { id: string }
      }) => {
        requests.push({ providerId: provider.id, model, prompt: latestInput })
        onToken(`reply:${latestInput}`)
      },
    )

    navigatorStub.onLine = true
    await useAppStore.getState().flushOfflineQueue()

    expect(requests).toEqual([
      {
        providerId: firstProvider.id,
        model: firstProvider.model,
        prompt: 'first captured turn',
      },
      {
        providerId: secondProvider.id,
        model: secondProvider.model,
        prompt: 'second captured turn',
      },
    ])
  })

  it('does not reroute a queued turn after its captured Provider is disabled', async () => {
    const data = freshData()
    const capturedProvider = {
      ...data.providers[0],
      id: 'provider-captured',
      model: 'captured-model',
      name: 'Captured Provider',
    }
    const fallbackProvider = {
      ...capturedProvider,
      id: 'provider-fallback',
      model: 'fallback-model',
      name: 'Fallback Provider',
    }
    data.providers = [capturedProvider, fallbackProvider]
    data.conversations[0] = {
      ...data.conversations[0],
      providerId: capturedProvider.id,
      model: capturedProvider.model,
    }
    resetStore(data)
    useAppStore.setState({
      keys: {
        [capturedProvider.id]: 'captured-key',
        [fallbackProvider.id]: 'fallback-key',
      },
    })
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('captured while enabled')
    const queued = useAppStore.getState().data!
    useAppStore.setState({
      data: {
        ...queued,
        providers: queued.providers.map((provider) =>
          provider.id === capturedProvider.id
            ? { ...provider, enabled: false }
            : provider,
        ),
      },
    })

    navigatorStub.onLine = true
    await useAppStore.getState().flushOfflineQueue()

    expect(streamMocks.streamAssistantText).not.toHaveBeenCalled()
    const assistant = useAppStore.getState().data?.conversations[0].messages.at(-1)
    expect(assistant).toMatchObject({ role: 'assistant', status: 'error' })
    expect(assistant).not.toHaveProperty('queuedTextRequest')
  })

  it('accepts an offline text turn only after its queued snapshot is durable', async () => {
    resetStore()
    vi.stubGlobal('navigator', { language: 'en-US', onLine: false })
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    let releaseQueuedTurn!: () => void
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseQueuedTurn = resolve
        }),
    )

    let settled = false
    const sending = useAppStore.getState().sendMessage('durable offline turn')
      .finally(() => {
        settled = true
      })
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())
    const settledBeforePersistence = settled
    const sendingBeforePersistence = useAppStore.getState().sending
    const queuedSnapshot = dbMocks.saveAppData.mock.calls[0]?.[0]

    releaseQueuedTurn()
    const accepted = await sending

    expect(settledBeforePersistence).toBe(false)
    expect(sendingBeforePersistence).toBe(true)
    expect(queuedSnapshot).toMatchObject({
      conversations: [
        expect.objectContaining({
          messages: [
            expect.objectContaining({
              content: 'durable offline turn',
              role: 'user',
            }),
            expect.objectContaining({ role: 'assistant', status: 'queued' }),
          ],
        }),
      ],
    })

    expect(accepted).toBe(true)
    expect(useAppStore.getState()).toMatchObject({ sending: false })
  })

  it('contains offline queued success notification failures after durable enqueue', async () => {
    resetStore()
    vi.stubGlobal('navigator', { language: 'en-US', onLine: false })
    useAppStore.setState({
      notify: () => {
        throw new Error('broken notification channel')
      },
    })

    await expect(
      useAppStore.getState().sendMessage('durable despite notification'),
    ).resolves.toBe(true)

    expect(dbMocks.saveAppData).toHaveBeenCalled()
    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      status: 'queued',
    })
  })

  it('keeps an offline turn unpublished when its queued snapshot cannot persist', async () => {
    const data = resetStore()
    vi.stubGlobal('navigator', { language: 'en-US', onLine: false })
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    const failure = new Error(
      'C:\\private\\offline-queue sk-test-secret-1234567890',
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    dbMocks.saveAppData.mockRejectedValueOnce(failure)

    await expect(
      useAppStore.getState().sendMessage('keep this offline draft'),
    ).resolves.toBe(false)

    expect(useAppStore.getState()).toMatchObject({
      composerImages: [],
      sending: false,
    })
    expect(useAppStore.getState().data?.conversations[0].messages).toEqual([])
    expect(consoleError).toHaveBeenCalledWith('[app] offline queue save failed')
    expectConsoleErrorDoesNotExpose(consoleError, failure)
    const notice = useAppStore.getState().toasts.at(-1)?.message ?? ''
    expect(notice).toBe(appT(data, 'settings.saveFailed'))
    expect(notice).not.toContain(failure.message)
  })

  it('keeps unsupported image attachments out of the offline text queue', async () => {
    resetStore()
    vi.stubGlobal('navigator', { language: 'en-US', onLine: false })
    const composerImage = {
      id: 'offline-image',
      dataUrl: 'data:image/png;base64,AAAA',
      mimeType: 'image/png',
      name: 'offline.png',
    }
    useAppStore.setState({ composerImages: [composerImage] })
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    await expect(
      useAppStore.getState().sendMessage('unsupported offline vision turn'),
    ).resolves.toBe(false)

    expect(dbMocks.saveAppData).not.toHaveBeenCalled()
    expect(useAppStore.getState().composerImages).toEqual([composerImage])
    expect(useAppStore.getState().data?.conversations[0].messages).toEqual([])
    expect(useAppStore.getState().toasts.at(-1)?.message).toBe(
      appT(useAppStore.getState().data, 'composer.offlineImageUnavailable'),
    )
  })

  it('persists an orphaned queued turn as an error before settling replay', async () => {
    const data = freshData()
    data.conversations[0].messages = [
      message('orphan-assistant', 'assistant', 'queued', {
        status: 'queued',
        queuedTextRequest: {
          model: data.providers[0].model,
          providerId: data.providers[0].id,
          promptMessageId: 'missing-prompt',
        },
      }),
    ]
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    let releaseError!: () => void
    dbMocks.saveAppData.mockImplementation(async (snapshot: unknown) => {
      const assistant = (snapshot as AppData).conversations[0].messages[0]
      if (assistant.status === 'error') {
        await new Promise<void>((resolve) => {
          releaseError = resolve
        })
      }
    })

    let settled = false
    const replay = useAppStore.getState().flushOfflineQueue().finally(() => {
      settled = true
    })
    await vi.waitFor(() => expect(releaseError).toBeTypeOf('function'))
    const settledBeforePersistence = settled
    const providerCallsBeforePersistence =
      streamMocks.streamAssistantText.mock.calls.length

    releaseError()
    await replay
    expect(settledBeforePersistence).toBe(false)
    expect(providerCallsBeforePersistence).toBe(0)
    const assistant = useAppStore.getState().data?.conversations[0].messages[0]
    expect(assistant).toMatchObject({ status: 'error' })
    expect(assistant).not.toHaveProperty('queuedTextRequest')
  })

  it('persists an orphaned queued turn before replaying a later valid turn', async () => {
    const data = freshData()
    data.conversations[0].messages = [
      message('orphan-assistant', 'assistant', 'queued', {
        status: 'queued',
        queuedTextRequest: {
          model: data.providers[0].model,
          providerId: data.providers[0].id,
          promptMessageId: 'missing-prompt',
        },
      }),
      message('valid-prompt', 'user', 'valid queued prompt'),
      message('valid-assistant', 'assistant', 'queued', {
        status: 'queued',
        queuedTextRequest: {
          model: data.providers[0].model,
          providerId: data.providers[0].id,
          promptMessageId: 'valid-prompt',
        },
      }),
    ]
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    let releaseOrphan!: () => void
    let orphanSaveBlocked = false
    dbMocks.saveAppData.mockImplementation(async (snapshot: unknown) => {
      const orphan = (snapshot as AppData).conversations[0].messages[0]
      if (orphan.status === 'error' && !orphanSaveBlocked) {
        orphanSaveBlocked = true
        await new Promise<void>((resolve) => {
          releaseOrphan = resolve
        })
      }
    })

    const replay = useAppStore.getState().flushOfflineQueue()
    await vi.waitFor(() => expect(releaseOrphan).toBeTypeOf('function'))
    expect(streamMocks.streamAssistantText).not.toHaveBeenCalled()
    releaseOrphan()
    await replay

    expect(streamMocks.streamAssistantText).toHaveBeenCalledOnce()
    expect(streamMocks.streamAssistantText).toHaveBeenCalledWith(
      expect.objectContaining({ latestInput: 'valid queued prompt' }),
    )
    expect(useAppStore.getState().data?.conversations[0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'orphan-assistant', status: 'error' }),
        expect.objectContaining({ id: 'valid-assistant', status: 'done' }),
      ]),
    )
  })

  it('durably rejects a queued turn whose Provider key was removed', async () => {
    resetStore()
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('credential disappeared')
    await useAppStore.getState().flushLocalSaves()
    useAppStore.setState({ keys: {} })
    dbMocks.saveAppData.mockClear()

    navigatorStub.onLine = true
    await useAppStore.getState().flushOfflineQueue()

    expect(streamMocks.streamAssistantText).not.toHaveBeenCalled()
    expect(dbMocks.saveAppData.mock.calls.at(-1)?.[0]).toMatchObject({
      conversations: [
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'assistant', status: 'error' }),
          ]),
        }),
      ],
    })
    const assistant = useAppStore.getState().data?.conversations[0].messages.at(-1)
    expect(assistant).not.toHaveProperty('queuedTextRequest')
  })

  it('does not replay with a captured Provider key after a newer key becomes durable', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    useAppStore.setState({ keys: { [providerId]: 'old-provider-key' } })
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('queued with an old key')
    await useAppStore.getState().flushLocalSaves()

    let releaseClaim!: () => void
    dbMocks.saveAppData.mockImplementationOnce(
      (snapshot: unknown) =>
        new Promise<void>((resolve) => {
          expect(
            (snapshot as AppData).conversations[0].messages.at(-1),
          ).toHaveProperty('offlineReplayClaim')
          releaseClaim = resolve
        }),
    )
    navigatorStub.onLine = true
    const replay = useAppStore.getState().flushOfflineQueue()
    await vi.waitFor(() => expect(releaseClaim).toBeTypeOf('function'))

    await useAppStore
      .getState()
      .saveProviderKey(providerId, 'new-provider-key')
    releaseClaim()
    await replay

    expect(streamMocks.streamAssistantText).toHaveBeenCalledOnce()
    expect(streamMocks.streamAssistantText).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'new-provider-key' }),
    )
    expect(
      streamMocks.streamAssistantText.mock.calls.some(
        ([request]) => request.apiKey === 'old-provider-key',
      ),
    ).toBe(false)
    expect(useAppStore.getState().keys[providerId]).toBe('new-provider-key')
    expect(
      useAppStore.getState().data?.conversations[0].messages.at(-1),
    ).toMatchObject({ content: 'replayed', status: 'done' })
  })

  it('does not replay through a captured Provider route after the route changes', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const originalBaseUrl = data.providers[0].baseUrl
    const replacementBaseUrl = 'https://replacement.invalid/v1'
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('queued on an old route')
    await useAppStore.getState().flushLocalSaves()

    let releaseClaim!: () => void
    dbMocks.saveAppData.mockImplementationOnce(
      (snapshot: unknown) =>
        new Promise<void>((resolve) => {
          expect(
            (snapshot as AppData).conversations[0].messages.at(-1),
          ).toHaveProperty('offlineReplayClaim')
          releaseClaim = resolve
        }),
    )
    navigatorStub.onLine = true
    const replay = useAppStore.getState().flushOfflineQueue()
    await vi.waitFor(() => expect(releaseClaim).toBeTypeOf('function'))

    useAppStore.getState().updateProvider(providerId, {
      baseUrl: replacementBaseUrl,
    })
    releaseClaim()
    await replay

    expect(streamMocks.streamAssistantText).toHaveBeenCalledOnce()
    expect(streamMocks.streamAssistantText).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ baseUrl: replacementBaseUrl }),
      }),
    )
    expect(
      streamMocks.streamAssistantText.mock.calls.some(
        ([request]) => request.provider.baseUrl === originalBaseUrl,
      ),
    ).toBe(false)
    expect(
      useAppStore.getState().data?.conversations[0].messages.at(-1),
    ).toMatchObject({ content: 'replayed', status: 'done' })
  })

  it('repairs its own replay claim after a durable requeue failure', async () => {
    const data = freshData()
    data.providers[0] = {
      ...data.providers[0],
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'proxy-passphrase' })
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('recover my failed claim')
    await useAppStore.getState().flushLocalSaves()

    let releaseAccessKey!: (value: string) => void
    accessKeyMocks.accessKeyFromPassword.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseAccessKey = resolve
        }),
    )
    let rejectRequeue = false
    let rejectedRequeues = 0
    dbMocks.saveAppData.mockImplementation(async (snapshot: unknown) => {
      const assistant = (snapshot as AppData).conversations[0].messages.at(-1)
      if (
        rejectRequeue &&
        assistant?.status === 'queued' &&
        !assistant.offlineReplayClaim
      ) {
        rejectedRequeues += 1
        throw new Error('durable replay requeue failed')
      }
    })
    secretMocks.commitZeroChatSecretSnapshotWithAppData.mockRejectedValueOnce(
      new Error('replacement reset failed'),
    )

    navigatorStub.onLine = true
    const firstReplay = useAppStore.getState().flushOfflineQueue()
    await vi.waitFor(() =>
      expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledOnce(),
    )
    expect(
      useAppStore.getState().data?.conversations[0].messages.at(-1),
    ).toMatchObject({
      status: 'streaming',
      offlineReplayClaim: expect.any(Object),
    })

    rejectRequeue = true
    const replacement = useAppStore.getState().resetAll()
    releaseAccessKey('proxy-token')
    const [replayResult] = await Promise.allSettled([firstReplay, replacement])

    expect(rejectedRequeues).toBeGreaterThan(0)
    expect(streamMocks.streamAssistantText).not.toHaveBeenCalled()
    expect(
      useAppStore.getState().data?.conversations[0].messages.at(-1),
    ).toMatchObject({
      status: 'queued',
      queuedTextRequest: expect.any(Object),
    })
    expect(
      useAppStore.getState().data?.conversations[0].messages.at(-1),
    ).not.toHaveProperty('offlineReplayClaim')
    expect(replayResult.status).toBe('fulfilled')

    rejectRequeue = false
    dbMocks.saveAppData.mockResolvedValue(undefined)
    await useAppStore.getState().flushOfflineQueue()

    expect(streamMocks.streamAssistantText).toHaveBeenCalledOnce()
    expect(
      useAppStore.getState().data?.conversations[0].messages.at(-1),
    ).toMatchObject({ content: 'replayed', status: 'done' })
  })

  it('derives the current proxy token before replaying a queued relay turn', async () => {
    const data = freshData()
    data.providers[0] = {
      ...data.providers[0],
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'offline-passphrase' })
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('queued relay turn')
    await useAppStore.getState().flushLocalSaves()
    accessKeyMocks.accessKeyFromPassword.mockResolvedValueOnce(
      'derived-offline-proxy-token',
    )

    navigatorStub.onLine = true
    await useAppStore.getState().flushOfflineQueue()

    expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledWith(
      'offline-passphrase',
    )
    expect(streamMocks.streamAssistantText).toHaveBeenCalledWith(
      expect.objectContaining({ proxyToken: 'derived-offline-proxy-token' }),
    )
  })

  it('does not replay a relay turn whose proxy token cannot be derived', async () => {
    await i18nMocks.actualLoadLocale!('en-US')
    setRuntimeLocale('en-US')
    const data = freshData()
    data.preferences.language = 'en-US'
    data.providers[0] = {
      ...data.providers[0],
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'offline-passphrase' })
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('queued relay failure')
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    const failure = new Error(
      'C:\\private\\offline-proxy sk-test-secret-1234567890',
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    accessKeyMocks.accessKeyFromPassword.mockRejectedValueOnce(failure)

    navigatorStub.onLine = true
    await useAppStore.getState().flushOfflineQueue()

    expect(streamMocks.streamAssistantText).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith('[app] proxy access-key derivation failed')
    expectConsoleErrorDoesNotExpose(consoleError, failure)
    const notice = useAppStore.getState().toasts.at(-1)?.message ?? ''
    expect(notice).toBe(
      translate('en-US', 'notice.syncAccessKeyDerivationFailed'),
    )
    expect(notice).not.toContain(failure.message)
    expect(dbMocks.saveAppData.mock.calls.at(-1)?.[0]).toMatchObject({
      conversations: [
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'assistant', status: 'error' }),
          ]),
        }),
      ],
    })
  })

  it('contains proxy failure notification errors after durable replay failure', async () => {
    const data = freshData()
    data.providers[0] = {
      ...data.providers[0],
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'offline-passphrase' })
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('queued proxy failure')
    await useAppStore.getState().flushLocalSaves()
    accessKeyMocks.accessKeyFromPassword.mockRejectedValueOnce(
      new Error('proxy derivation failed'),
    )
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    useAppStore.setState({
      notify: () => {
        throw new Error('broken notification channel')
      },
    })

    navigatorStub.onLine = true
    await expect(useAppStore.getState().flushOfflineQueue()).resolves.toBeUndefined()

    expect(streamMocks.streamAssistantText).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'error',
    })
  })

  it('rejects a new send while offline replay owns generation', async () => {
    resetStore()
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('queued owner')
    await useAppStore.getState().flushLocalSaves()
    let finishOfflineReplay!: () => void
    streamMocks.streamAssistantText.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishOfflineReplay = resolve
        }),
    )

    navigatorStub.onLine = true
    const replay = useAppStore.getState().flushOfflineQueue()
    await vi.waitFor(() =>
      expect(streamMocks.streamAssistantText).toHaveBeenCalledOnce(),
    )
    let secondSettled = false
    let secondAccepted = false
    const second = useAppStore.getState().sendMessage('must wait').then((accepted) => {
      secondAccepted = accepted
      secondSettled = true
    })
    await vi.waitFor(() =>
      expect(secondSettled || runtime.streamChat.mock.calls.length > 0).toBe(true),
    )
    const onlineProviderCallsBeforeRelease = runtime.streamChat.mock.calls.length
    finishOfflineReplay()
    await replay
    await second
    expect(secondAccepted).toBe(false)
    expect(onlineProviderCallsBeforeRelease).toBe(0)
  })

  it('rejects a new text generation while an offline replay claim is pending', async () => {
    resetStore()
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('queued before a live turn')
    await useAppStore.getState().flushLocalSaves()

    let releaseClaim!: () => void
    dbMocks.saveAppData.mockImplementationOnce(async (snapshot: unknown) => {
      const assistant = (snapshot as AppData).conversations[0].messages.at(-1)
      expect(assistant).toMatchObject({
        status: 'streaming',
        offlineReplayClaim: expect.any(Object),
      })
      await new Promise<void>((resolve) => {
        releaseClaim = resolve
      })
    })

    navigatorStub.onLine = true
    const replay = useAppStore.getState().flushOfflineQueue()
    await vi.waitFor(() => expect(releaseClaim).toBeTypeOf('function'))

    const liveTurn = useAppStore.getState().sendMessage('must wait for replay claim')
    await Promise.resolve()
    expect(runtime.streamChat).not.toHaveBeenCalled()

    releaseClaim()
    await replay
    await expect(liveTurn).resolves.toBe(false)
    expect(runtime.streamChat).not.toHaveBeenCalled()
  })

  it('cancels a pre-claim offline replay before switching conversations', async () => {
    const data = resetStore()
    const first = data.conversations[0]
    const second = { ...structuredClone(first), id: 'offline-switch-target', messages: [] }
    data.conversations.push(second)
    await useAppStore.getState().flushLocalSaves()

    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('queued before conversation switch')
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseClaim!: () => void
    dbMocks.saveAppData.mockImplementationOnce(async (snapshot: unknown) => {
      const assistant = (snapshot as AppData).conversations[0].messages.at(-1)
      expect(assistant).toMatchObject({
        status: 'streaming',
        offlineReplayClaim: expect.any(Object),
      })
      await new Promise<void>((resolve) => {
        releaseClaim = resolve
      })
    })

    navigatorStub.onLine = true
    const replay = useAppStore.getState().flushOfflineQueue()
    await vi.waitFor(() => expect(releaseClaim).toBeTypeOf('function'))

    let switchSettled = false
    const switching = useAppStore
      .getState()
      .setActiveConversation(second.id)
      .finally(() => {
        switchSettled = true
      })

    await Promise.resolve()
    expect(switchSettled).toBe(false)
    expect(streamMocks.streamAssistantText).not.toHaveBeenCalled()

    releaseClaim()
    await Promise.all([replay, switching])

    expect(streamMocks.streamAssistantText).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.preferences.activeConversationId).toBe(
      second.id,
    )
    expect(
      useAppStore
        .getState()
        .data?.conversations.find((conversation) => conversation.id === first.id)
        ?.messages.at(-1),
    ).toMatchObject({ status: 'queued' })
    expect(
      useAppStore
        .getState()
        .data?.conversations.find((conversation) => conversation.id === first.id)
        ?.messages.at(-1),
    ).not.toHaveProperty('offlineReplayClaim')
  })

  it('cancels a pre-claim offline replay before deleting its queued prompt', async () => {
    resetStore()
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('queued before message deletion')
    await useAppStore.getState().flushLocalSaves()
    const queuedPrompt = useAppStore.getState().data?.conversations[0].messages[0]
    expect(queuedPrompt).toMatchObject({ role: 'user' })

    let releaseClaim!: () => void
    dbMocks.saveAppData.mockImplementationOnce(async (snapshot: unknown) => {
      const assistant = (snapshot as AppData).conversations[0].messages.at(-1)
      expect(assistant).toMatchObject({
        status: 'streaming',
        offlineReplayClaim: expect.any(Object),
      })
      await new Promise<void>((resolve) => {
        releaseClaim = resolve
      })
    })

    navigatorStub.onLine = true
    const replay = useAppStore.getState().flushOfflineQueue()
    await vi.waitFor(() => expect(releaseClaim).toBeTypeOf('function'))

    vi.mocked(globalThis.confirm).mockReturnValueOnce(true)
    const deletion = useAppStore.getState().deleteMessage(queuedPrompt!.id)
    await Promise.resolve()
    expect(streamMocks.streamAssistantText).not.toHaveBeenCalled()

    releaseClaim()
    const [, deletionResult] = await Promise.all([replay, deletion])

    expect(streamMocks.streamAssistantText).not.toHaveBeenCalled()
    expect(deletionResult).toBe(true)
    expect(useAppStore.getState().data?.conversations[0].messages).toEqual([])
  })

  it('cancels a pre-claim offline replay before deleting its conversation', async () => {
    const data = resetStore()
    const conversationId = data.conversations[0].id
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('queued before conversation deletion')
    await useAppStore.getState().flushLocalSaves()

    let releaseClaim!: () => void
    dbMocks.saveAppData.mockImplementationOnce(async (snapshot: unknown) => {
      const assistant = (snapshot as AppData).conversations[0].messages.at(-1)
      expect(assistant).toMatchObject({
        status: 'streaming',
        offlineReplayClaim: expect.any(Object),
      })
      await new Promise<void>((resolve) => {
        releaseClaim = resolve
      })
    })

    navigatorStub.onLine = true
    const replay = useAppStore.getState().flushOfflineQueue()
    await vi.waitFor(() => expect(releaseClaim).toBeTypeOf('function'))

    vi.mocked(globalThis.confirm).mockReturnValueOnce(true)
    const deletion = useAppStore.getState().deleteConversation(conversationId)
    await Promise.resolve()
    expect(streamMocks.streamAssistantText).not.toHaveBeenCalled()

    releaseClaim()
    const [, deletionResult] = await Promise.all([replay, deletion])

    expect(streamMocks.streamAssistantText).not.toHaveBeenCalled()
    expect(deletionResult).toBe(true)
    expect(
      useAppStore.getState().data?.conversations.some(
        (conversation) => conversation.id === conversationId,
      ),
    ).toBe(false)
  })

  it('requeues a pre-claim offline replay when the network drops before its claim settles', async () => {
    resetStore()
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('queued before network drop')
    await useAppStore.getState().flushLocalSaves()

    let releaseClaim!: () => void
    dbMocks.saveAppData.mockImplementationOnce(async (snapshot: unknown) => {
      const assistant = (snapshot as AppData).conversations[0].messages.at(-1)
      expect(assistant).toMatchObject({
        status: 'streaming',
        offlineReplayClaim: expect.any(Object),
      })
      await new Promise<void>((resolve) => {
        releaseClaim = resolve
      })
    })

    navigatorStub.onLine = true
    const replay = useAppStore.getState().flushOfflineQueue()
    await vi.waitFor(() => expect(releaseClaim).toBeTypeOf('function'))
    navigatorStub.onLine = false
    releaseClaim()
    await replay

    expect(streamMocks.streamAssistantText).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      status: 'queued',
      queuedTextRequest: expect.any(Object),
    })
    expect(
      useAppStore.getState().data?.conversations[0].messages.at(-1),
    ).not.toHaveProperty('offlineReplayClaim')

    navigatorStub.onLine = true
    await useAppStore.getState().flushOfflineQueue()
    expect(streamMocks.streamAssistantText).toHaveBeenCalledOnce()
  })

  it('stops offline replay before starting the next queued turn', async () => {
    resetStore()
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('queued first')
    await useAppStore.getState().sendMessage('queued second')
    await useAppStore.getState().flushLocalSaves()
    streamMocks.streamAssistantText.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('Stopped', 'AbortError'))
          }, { once: true })
        }),
    )

    navigatorStub.onLine = true
    const replay = useAppStore.getState().flushOfflineQueue()
    await vi.waitFor(() =>
      expect(streamMocks.streamAssistantText).toHaveBeenCalledOnce(),
    )
    useAppStore.getState().stopStreaming()
    await replay

    expect(streamMocks.streamAssistantText).toHaveBeenCalledTimes(1)
    const messages = useAppStore.getState().data?.conversations[0].messages ?? []
    expect(messages.filter((message) => message.status === 'queued')).toHaveLength(1)
    expect(messages).not.toContainEqual(
      expect.objectContaining({ content: 'unexpected second replay' }),
    )
  })

  it('drops a late offline replay token after stopping a Provider that ignores abort', async () => {
    resetStore()
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('queued late-token turn')
    await useAppStore.getState().flushLocalSaves()

    let publishLateToken!: (token: string) => void
    let finishReplay!: () => void
    streamMocks.streamAssistantText.mockImplementationOnce(
      async ({ onToken }: { onToken: (token: string) => void }) => {
        publishLateToken = onToken
        await new Promise<void>((resolve) => {
          finishReplay = resolve
        })
      },
    )

    navigatorStub.onLine = true
    const replay = useAppStore.getState().flushOfflineQueue()
    await vi.waitFor(() =>
      expect(streamMocks.streamAssistantText).toHaveBeenCalledOnce(),
    )
    const assistantBeforeStop = structuredClone(
      useAppStore.getState().data?.conversations[0].messages.at(-1),
    )

    useAppStore.getState().stopStreaming()
    publishLateToken('late offline provider output')
    await vi.advanceTimersByTimeAsync(40)

    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toEqual(
      assistantBeforeStop,
    )

    finishReplay()
    await replay
  })

  it('does not let an earlier replay claim write after sync adopts a newer claim', async () => {
    const data = resetStore()
    data.sync = {
      ...data.sync,
      autoSync: false,
      mode: 'cloudflare',
      workerEndpoint: 'https://worker.invalid',
    }
    useAppStore.setState({ data, syncPassphrase: 'sync-passphrase' })
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('queued claim handoff')
    await useAppStore.getState().flushLocalSaves()

    let publishA!: (token: string) => void
    let finishA!: () => void
    streamMocks.streamAssistantText.mockImplementationOnce(
      async ({ onToken }: { onToken: (token: string) => void }) => {
        publishA = onToken
        await new Promise<void>((resolve) => {
          finishA = resolve
        })
      },
    )

    navigatorStub.onLine = true
    const replayA = useAppStore.getState().flushOfflineQueue()
    await vi.waitFor(() =>
      expect(streamMocks.streamAssistantText).toHaveBeenCalledOnce(),
    )

    const remote = structuredClone(useAppStore.getState().data!)
    const remoteAssistant = remote.conversations[0].messages.at(-1)!
    remoteAssistant.content = 'B content'
    remoteAssistant.status = 'streaming'
    remoteAssistant.offlineReplayClaim = {
      claimId: 'claim-b',
      owner: 'other-tab',
    }
    remote.updatedAt += 1
    remote.conversations[0].updatedAt = remote.updatedAt
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => persist(target),
    )
    syncMocks.performSync.mockResolvedValueOnce({
      data: remote,
      message: 'sync complete',
      remoteAccepted: true,
      secrets: { providerKeys: { [data.providers[0].id]: 'test-key' } },
    })

    await useAppStore.getState().syncNow()
    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      content: 'B content',
      status: 'streaming',
      offlineReplayClaim: { claimId: 'claim-b', owner: 'other-tab' },
    })

    publishA('late A token')
    await vi.advanceTimersByTimeAsync(40)
    finishA()
    await replayA
    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      content: 'B content',
      status: 'streaming',
      offlineReplayClaim: { claimId: 'claim-b', owner: 'other-tab' },
    })
  })

  it('does not let an earlier replay failure write after sync adopts a newer claim', async () => {
    const data = resetStore()
    data.sync = {
      ...data.sync,
      autoSync: false,
      mode: 'cloudflare',
      workerEndpoint: 'https://worker.invalid',
    }
    useAppStore.setState({ data, syncPassphrase: 'sync-passphrase' })
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('queued failed claim handoff')
    await useAppStore.getState().flushLocalSaves()

    let rejectA!: (error: Error) => void
    let publishA!: (token: string) => void
    streamMocks.streamAssistantText.mockImplementationOnce(
      async ({ onToken }: { onToken: (token: string) => void }) => {
        publishA = onToken
        await new Promise<void>((_resolve, reject) => {
          rejectA = reject
        })
      },
    )

    navigatorStub.onLine = true
    const replayA = useAppStore.getState().flushOfflineQueue()
    await vi.waitFor(() =>
      expect(streamMocks.streamAssistantText).toHaveBeenCalledOnce(),
    )

    const remote = structuredClone(useAppStore.getState().data!)
    const remoteAssistant = remote.conversations[0].messages.at(-1)!
    remoteAssistant.content = 'B content'
    remoteAssistant.status = 'streaming'
    remoteAssistant.offlineReplayClaim = {
      claimId: 'claim-b',
      owner: 'other-tab',
    }
    remote.updatedAt += 1
    remote.conversations[0].updatedAt = remote.updatedAt
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => persist(target),
    )
    syncMocks.performSync.mockResolvedValueOnce({
      data: remote,
      message: 'sync complete',
      remoteAccepted: true,
      secrets: { providerKeys: { [data.providers[0].id]: 'test-key' } },
    })

    await useAppStore.getState().syncNow()
    publishA('late failed A token')
    await vi.advanceTimersByTimeAsync(40)
    rejectA(new Error('late A failure'))
    await replayA

    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      content: 'B content',
      status: 'streaming',
      offlineReplayClaim: { claimId: 'claim-b', owner: 'other-tab' },
    })
  })

  it('does not let an earlier replay retry after sync adopts a newer claim', async () => {
    const data = resetStore()
    data.sync = {
      ...data.sync,
      autoSync: false,
      mode: 'cloudflare',
      workerEndpoint: 'https://worker.invalid',
    }
    useAppStore.setState({ data, syncPassphrase: 'sync-passphrase' })
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('queued retry claim handoff')
    await useAppStore.getState().flushLocalSaves()

    let syncB!: Promise<void>
    streamMocks.streamAssistantText.mockImplementationOnce(async () => {
      syncB = useAppStore.getState().syncNow()
      await syncB
      throw Object.assign(new Error('retry after claim handoff'), {
        retryable: true,
      })
    })

    const remote = structuredClone(useAppStore.getState().data!)
    const remoteAssistant = remote.conversations[0].messages.at(-1)!
    remoteAssistant.content = 'B content'
    remoteAssistant.status = 'streaming'
    remoteAssistant.offlineReplayClaim = {
      claimId: 'claim-b',
      owner: 'other-tab',
    }
    remote.updatedAt += 1
    remote.conversations[0].updatedAt = remote.updatedAt
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => persist(target),
    )
    syncMocks.performSync.mockResolvedValueOnce({
      data: remote,
      message: 'sync complete',
      remoteAccepted: true,
      secrets: { providerKeys: { [data.providers[0].id]: 'test-key' } },
    })

    navigatorStub.onLine = true
    const replayA = useAppStore.getState().flushOfflineQueue()
    await vi.waitFor(() =>
      expect(streamMocks.streamAssistantText).toHaveBeenCalledOnce(),
    )
    await vi.waitFor(() => expect(syncB).toBeDefined())
    await vi.advanceTimersByTimeAsync(1000)
    await replayA

    expect(streamMocks.streamAssistantText).toHaveBeenCalledOnce()
    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      content: 'B content',
      status: 'streaming',
      offlineReplayClaim: { claimId: 'claim-b', owner: 'other-tab' },
    })
  })

  it('stops offline replay while the proxy token is still being derived', async () => {
    const data = freshData()
    data.providers[0] = {
      ...data.providers[0],
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'offline-passphrase' })
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('queued relay first')
    await useAppStore.getState().sendMessage('queued relay second')
    await useAppStore.getState().flushLocalSaves()
    let finishDerivation!: (token: string) => void
    accessKeyMocks.accessKeyFromPassword.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishDerivation = resolve
        }),
    )

    navigatorStub.onLine = true
    const replay = useAppStore.getState().flushOfflineQueue()
    await vi.waitFor(() =>
      expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledOnce(),
    )
    useAppStore.getState().stopStreaming()
    finishDerivation('unused-proxy-token')
    await replay

    expect(streamMocks.streamAssistantText).not.toHaveBeenCalled()
    expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledTimes(1)
    const messages = useAppStore.getState().data?.conversations[0].messages ?? []
    expect(messages.filter((message) => message.status === 'queued')).toHaveLength(1)
  })

  it('preserves newer generation ownership after offline replay completes', async () => {
    resetStore()
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('queued owner handoff')
    await useAppStore.getState().flushLocalSaves()
    let finishReplay!: () => void
    streamMocks.streamAssistantText.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishReplay = resolve
        }),
    )

    navigatorStub.onLine = true
    const replay = useAppStore.getState().flushOfflineQueue()
    await vi.waitFor(() =>
      expect(streamMocks.streamAssistantText).toHaveBeenCalledOnce(),
    )
    const newerOwner = new AbortController()
    useAppStore.setState({ abortController: newerOwner, streaming: true })
    finishReplay()
    await replay

    expect(useAppStore.getState().abortController).toBe(newerOwner)
    expect(useAppStore.getState().streaming).toBe(true)
  })

  it('persists an offline replay claim before contacting the Provider', async () => {
    resetStore()
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('durable queued replay')
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseClaim!: () => void
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseClaim = resolve
        }),
    )

    navigatorStub.onLine = true
    const replay = useAppStore.getState().flushOfflineQueue()
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())
    const firstPersistedSnapshot = dbMocks.saveAppData.mock.calls[0]?.[0]
    const contactedProviderBeforeClaim =
      streamMocks.streamAssistantText.mock.calls.length > 0

    releaseClaim()
    await replay

    expect(firstPersistedSnapshot).toMatchObject({
      conversations: [
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              offlineReplayClaim: {
                claimId: expect.any(String),
                owner: expect.any(String),
              },
              role: 'assistant',
              status: 'streaming',
            }),
          ]),
        }),
      ],
    })
    expect(contactedProviderBeforeClaim).toBe(false)
    expect(streamMocks.streamAssistantText).toHaveBeenCalledOnce()
  })

  it('does not contact the Provider when another tab owns the replay claim', async () => {
    resetStore()
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('claim conflict')
    await useAppStore.getState().flushLocalSaves()

    const remote = structuredClone(useAppStore.getState().data!)
    const remoteAssistant = remote.conversations[0].messages.at(-1)!
    remoteAssistant.content = ''
    remoteAssistant.status = 'streaming'
    remoteAssistant.offlineReplayClaim = {
      claimId: 'remote-claim',
      owner: 'remote-tab',
    }
    remote.updatedAt += 1
    remote.conversations[0].updatedAt = remote.updatedAt
    dbMocks.saveAppData.mockClear()
    dbMocks.saveAppData
      .mockRejectedValueOnce(new AppDataWriteConflictError())
      .mockResolvedValue(undefined)
    dbMocks.loadAppData.mockResolvedValue(remote)

    navigatorStub.onLine = true
    await useAppStore.getState().flushOfflineQueue()

    expect(streamMocks.streamAssistantText).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.conversations[0].messages.at(-1))
      .toMatchObject({
        offlineReplayClaim: remoteAssistant.offlineReplayClaim,
        status: 'streaming',
      })
  })

  it('settles offline replay only after the terminal snapshot is durable', async () => {
    resetStore()
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('durable replay terminal')
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseTerminal!: () => void
    dbMocks.saveAppData.mockImplementation(async (snapshot: unknown) => {
      const assistant = (snapshot as AppData).conversations[0].messages.at(-1)
      if (assistant?.status === 'done') {
        await new Promise<void>((resolve) => {
          releaseTerminal = resolve
        })
      }
    })

    navigatorStub.onLine = true
    let settled = false
    const replay = useAppStore.getState().flushOfflineQueue().finally(() => {
      settled = true
    })
    await vi.waitFor(() => expect(releaseTerminal).toBeTypeOf('function'))
    expect(settled).toBe(false)
    const terminalSnapshot = dbMocks.saveAppData.mock.calls.at(-1)?.[0] as AppData
    expect(terminalSnapshot).toMatchObject({
      conversations: [
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              status: 'done',
            }),
          ]),
        }),
      ],
    })
    const terminalAssistant = terminalSnapshot.conversations[0].messages.at(-1)
    expect(terminalAssistant).not.toHaveProperty('offlineReplayClaim')
    expect(terminalAssistant).not.toHaveProperty('queuedTextRequest')

    releaseTerminal()
    await replay
    expect(settled).toBe(true)
  })

  it('shares one pending offline replay across concurrent callers', async () => {
    resetStore()
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('one replay owner')
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseClaim!: () => void
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseClaim = resolve
        }),
    )

    navigatorStub.onLine = true
    const first = useAppStore.getState().flushOfflineQueue()
    const second = useAppStore.getState().flushOfflineQueue()
    expect(second).toBe(first)
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())
    expect(streamMocks.streamAssistantText).not.toHaveBeenCalled()

    releaseClaim()
    await Promise.all([first, second])
    expect(streamMocks.streamAssistantText).toHaveBeenCalledOnce()
  })

  it('drains more than one bounded batch of queued turns in persisted order', async () => {
    const data = freshData()
    const provider = data.providers[0]
    const queuedMessages = Array.from({ length: 51 }, (_, index) => {
      const promptId = `offline-prompt-${index}`
      return [
        message(promptId, 'user', `offline-${index}`),
        message(`offline-assistant-${index}`, 'assistant', 'queued', {
          status: 'queued',
          queuedTextRequest: {
            model: provider.model,
            providerId: provider.id,
            promptMessageId: promptId,
          },
        }),
      ]
    }).flat()
    data.conversations[0] = {
      ...data.conversations[0],
      messages: queuedMessages,
    }
    resetStore(data)
    vi.stubGlobal('navigator', { language: 'en-US', onLine: true })
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    const replayedPrompts: string[] = []
    streamMocks.streamAssistantText.mockImplementation(
      async ({
        latestInput,
        onToken,
      }: {
        latestInput: string
        onToken: (token: string) => void
      }) => {
        replayedPrompts.push(latestInput)
        onToken(`reply:${latestInput}`)
      },
    )

    await useAppStore.getState().flushOfflineQueue()

    expect(replayedPrompts).toHaveLength(51)
    expect(replayedPrompts.at(-1)).toBe('offline-50')
    const assistants = useAppStore
      .getState()
      .data?.conversations[0].messages.filter(
        (current) => current.role === 'assistant',
      )
    expect(assistants).toHaveLength(51)
    expect(assistants?.every((current) => current.status === 'done')).toBe(true)
  })

  it('durably returns a dropped offline replay to the queue without its claim', async () => {
    const data = resetStore()
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('requeue after drop')
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    streamMocks.streamAssistantText.mockImplementationOnce(async () => {
      navigatorStub.onLine = false
      throw Object.assign(new Error('network dropped'), { retryable: false })
    })

    navigatorStub.onLine = true
    await useAppStore.getState().flushOfflineQueue()

    const assistant = useAppStore.getState().data?.conversations[0].messages.at(-1)
    expect(assistant).toMatchObject({
      content: appT(data, 'message.queued'),
      status: 'queued',
    })
    expect(assistant).not.toHaveProperty('offlineReplayClaim')
    expect(assistant).toHaveProperty('queuedTextRequest')
    expect(dbMocks.saveAppData.mock.calls.at(-1)?.[0]).toMatchObject({
      conversations: [
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ status: 'queued' }),
          ]),
        }),
      ],
    })
    expect(syncMocks.performSync).not.toHaveBeenCalled()
  })

  it('does not sync or leak an offline terminal state that cannot persist', async () => {
    const data = resetStore()
    data.sync = {
      ...data.sync,
      autoSync: true,
      mode: 'cloudflare',
      workerEndpoint: 'https://sync.example.test',
    }
    useAppStore.setState({ data, syncPassphrase: 'test-passphrase' })
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('failed replay terminal save')
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    const failure = new Error(
      'C:\\private\\offline-terminal sk-test-secret-1234567890',
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    dbMocks.saveAppData.mockImplementation(async (snapshot: unknown) => {
      const assistant = (snapshot as AppData).conversations[0].messages.at(-1)
      if (assistant?.status === 'done') throw failure
    })

    navigatorStub.onLine = true
    await useAppStore.getState().flushOfflineQueue()

    expect(syncMocks.performSync).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith('[app] generation terminal save failed')
    expectConsoleErrorDoesNotExpose(consoleError, failure)
    const notice = useAppStore.getState().toasts.at(-1)?.message ?? ''
    expect(notice).toBe(appT(data, 'settings.saveFailed'))
    expect(notice).not.toContain(failure.message)
    const assistant = useAppStore.getState().data?.conversations[0].messages.at(-1)
    expect(assistant).toMatchObject({ content: 'replayed', status: 'done' })
    expect(assistant).not.toHaveProperty('offlineReplayClaim')
  })

  it('contains offline replay notification failures after persisting terminal failure', async () => {
    resetStore()
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('queued terminal failure')
    await useAppStore.getState().flushLocalSaves()
    streamMocks.streamAssistantText.mockRejectedValueOnce(
      new Error('Provider terminal failure'),
    )
    useAppStore.setState({
      notify: () => {
        throw new Error('broken notification channel')
      },
    })

    navigatorStub.onLine = true
    await expect(useAppStore.getState().flushOfflineQueue()).resolves.toBeUndefined()

    expect(dbMocks.saveAppData.mock.calls.at(-1)?.[0]).toMatchObject({
      conversations: [
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'assistant', status: 'error' }),
          ]),
        }),
      ],
    })
  })

  it('retries a transient offline replay failure through the shared generation runtime', async () => {
    stubGenerationRetryTimers()
    resetStore()
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    expect(await useAppStore.getState().sendMessage('retry queued turn')).toBe(true)
    streamMocks.streamAssistantText
      .mockRejectedValueOnce(
        Object.assign(new Error('temporary replay failure'), { retryable: true }),
      )
      .mockImplementationOnce(
        async ({ onToken }: { onToken: (token: string) => void }) => {
          onToken('replayed after retry')
        },
      )

    navigatorStub.onLine = true
    const replay = useAppStore.getState().flushOfflineQueue()
    await vi.waitFor(() =>
      expect(streamMocks.streamAssistantText).toHaveBeenCalledTimes(1),
    )
    await vi.advanceTimersByTimeAsync(400)
    await replay

    expect(streamMocks.streamAssistantText).toHaveBeenCalledTimes(2)
    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      content: 'replayed after retry',
      status: 'done',
    })
  })

  it('validates and completes image generation and editing turns', async () => {
    resetStore()
    expect(await useAppStore.getState().sendMessage('draw a tree', {
      mode: 'image',
      imageTaskMode: 'generate',
    })).toBe(true)
    let messages = useAppStore.getState().data?.conversations[0].messages ?? []
    expect(messages.at(-1)).toMatchObject({ role: 'assistant', status: 'done' })
    expect(messages.at(-1)?.attachments?.[0]).toMatchObject({
      mimeType: 'image/png',
      purpose: 'generated',
    })
    expect(runtime.generateImage).toHaveBeenCalledTimes(1)

    expect(await useAppStore.getState().sendMessage('edit it', {
      mode: 'image',
      imageTaskMode: 'edit',
    })).toBe(false)
    expect(useAppStore.getState().toasts.at(-1)?.message).toContain('source')

    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    expect(await useAppStore.getState().sendMessage('offline image', {
      mode: 'image',
      imageTaskMode: 'generate',
    })).toBe(false)
    expect(useAppStore.getState().toasts.at(-1)?.message).toContain('network')
    navigatorStub.onLine = true

    const editData = resetStore()
    expect(await useAppStore.getState().sendMessage('edit source', {
      imageSourceFile: imageFile(),
      imageTaskMode: 'edit',
      mode: 'image',
    })).toBe(true)
    messages = useAppStore.getState().data?.conversations[0].messages ?? []
    expect(messages.at(-1)?.attachments?.[0]).toMatchObject({
      alt: 'edited',
      purpose: 'generated',
    })
    expect(runtime.editImage).toHaveBeenCalledWith(
      expect.objectContaining({
        image: expect.any(File),
        model: expect.any(String),
      }),
    )
    expect(editData.conversations[0].messages).toHaveLength(0)
  })

  it('preserves composer images when image submission is rejected before admission', async () => {
    resetStore()
    const draftImage = {
      dataUrl: 'data:image/png;base64,draft',
      id: 'draft-image',
      mimeType: 'image/png',
      name: 'draft.png',
    }
    useAppStore.setState({ composerImages: [draftImage], keys: {} })

    await expect(
      useAppStore.getState().sendMessage('draw with the draft', {
        mode: 'image',
        imageTaskMode: 'generate',
      }),
    ).resolves.toBe(false)

    expect(useAppStore.getState().composerImages).toEqual([draftImage])
    expect(runtime.generateImage).not.toHaveBeenCalled()
    expect(runtime.editImage).not.toHaveBeenCalled()
  })

  it('preserves composer images when text submission cannot persist its turn', async () => {
    resetStore()
    const draftImage = {
      dataUrl: 'data:image/png;base64,text-draft',
      id: 'text-draft-image',
      mimeType: 'image/png',
      name: 'text-draft.png',
    }
    useAppStore.setState({ composerImages: [draftImage] })
    dbMocks.saveAppData.mockRejectedValueOnce(new Error('text turn save failed'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(
      useAppStore.getState().sendMessage('send with the draft'),
    ).resolves.toBe(false)

    expect(useAppStore.getState().composerImages).toEqual([draftImage])
    expect(runtime.streamChat).not.toHaveBeenCalled()
  })

  it('does not create an empty conversation when credential preflight rejects a send', async () => {
    const data = freshData()
    data.conversations = []
    data.preferences.activeConversationId = undefined
    resetStore(data)
    useAppStore.setState({ keys: {}, settingsOpen: false })

    await expect(useAppStore.getState().sendMessage('needs a key')).resolves.toBe(false)

    expect(useAppStore.getState().data?.conversations).toEqual([])
    expect(useAppStore.getState().settingsOpen).toBe(true)
    expect(runtime.streamChat).not.toHaveBeenCalled()
  })

  it('queues an offline proxy turn without requiring a sync passphrase', async () => {
    const data = freshData()
    data.conversations = []
    data.preferences.activeConversationId = undefined
    data.providers[0] = {
      ...data.providers[0],
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    resetStore(data)
    useAppStore.setState({ keys: {}, syncPassphrase: '' })
    vi.stubGlobal('navigator', { language: 'en-US', onLine: false })

    await expect(
      useAppStore.getState().sendMessage('queue while offline'),
    ).resolves.toBe(true)

    const messages = useAppStore.getState().data?.conversations[0]?.messages ?? []
    expect(messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'queued',
      queuedTextRequest: expect.objectContaining({
        providerId: data.providers[0].id,
      }),
    })
    expect(runtime.streamChat).not.toHaveBeenCalled()
  })

  it('does not persist first-run completion when synchronous admission rejects', async () => {
    const data = freshData()
    data.preferences.firstRunDone = false
    resetStore(data)
    useAppStore.setState({ keys: {}, settingsOpen: false })

    await expect(useAppStore.getState().sendMessage('needs a key')).resolves.toBe(false)

    expect(useAppStore.getState().data?.preferences.firstRunDone).toBe(false)
    expect(runtime.streamChat).not.toHaveBeenCalled()
  })

  it('does not create an empty conversation when image capability admission rejects', async () => {
    const data = freshData()
    data.conversations = []
    data.preferences.activeConversationId = undefined
    data.providers[0] = {
      ...data.providers[0],
      capabilities: [],
      imageModel: '',
      models: [],
    }
    resetStore(data)

    await expect(
      useAppStore.getState().sendMessage('draw without an image model', {
        mode: 'image',
        imageTaskMode: 'generate',
      }),
    ).resolves.toBe(false)

    expect(useAppStore.getState().data?.conversations).toEqual([])
    expect(useAppStore.getState().settingsOpen).toBe(true)
    expect(runtime.generateImage).not.toHaveBeenCalled()
  })

  it('rejects image admission when its Provider changes during catalog loading', async () => {
    const data = freshData()
    data.conversations = []
    data.preferences.activeConversationId = undefined
    resetStore(data)

    let releaseCatalog!: (model: string) => void
    providerModelMocks.modelForProviderCapability.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseCatalog = resolve
        }),
    )

    const sending = useAppStore.getState().sendMessage('stale image', {
      mode: 'image',
      imageTaskMode: 'generate',
    })
    await vi.waitFor(() =>
      expect(providerModelMocks.modelForProviderCapability).toHaveBeenCalledOnce(),
    )

    useAppStore.getState().updateProvider(data.providers[0].id, {
      baseUrl: 'https://replacement.invalid/v1',
    })
    releaseCatalog('image-model')

    await expect(sending).resolves.toBe(false)
    expect(useAppStore.getState().data?.conversations).toEqual([])
    expect(runtime.generateImage).not.toHaveBeenCalled()
    expect(runtime.editImage).not.toHaveBeenCalled()
  })

  it('rejects image admission when its Provider is deleted during catalog loading', async () => {
    const data = freshData()
    data.conversations = []
    data.preferences.activeConversationId = undefined
    resetStore(data)

    let releaseCatalog!: (model: string) => void
    providerModelMocks.modelForProviderCapability.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseCatalog = resolve
        }),
    )

    const sending = useAppStore.getState().sendMessage('deleted image', {
      mode: 'image',
      imageTaskMode: 'generate',
    })
    await vi.waitFor(() =>
      expect(providerModelMocks.modelForProviderCapability).toHaveBeenCalledOnce(),
    )

    await expect(useAppStore.getState().deleteProvider(data.providers[0].id)).resolves.toBe(true)
    releaseCatalog('image-model')

    await expect(sending).resolves.toBe(false)
    expect(useAppStore.getState().data?.providers).toEqual([])
    expect(useAppStore.getState().data?.conversations).toEqual([])
    expect(runtime.generateImage).not.toHaveBeenCalled()
    expect(runtime.editImage).not.toHaveBeenCalled()
  })

  it('rejects image admission when the active conversation changes during catalog loading', async () => {
    const data = freshData()
    const first = data.conversations[0]
    const second = {
      ...first,
      createdAt: first.createdAt + 1,
      id: 'conversation-image-admission-b',
      messages: [],
    }
    data.conversations = [first, second]
    resetStore(data)

    let releaseCatalog!: (model: string) => void
    providerModelMocks.modelForProviderCapability.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseCatalog = resolve
        }),
    )

    const sending = useAppStore.getState().sendMessage('switched image', {
      mode: 'image',
      imageTaskMode: 'generate',
    })
    await vi.waitFor(() =>
      expect(providerModelMocks.modelForProviderCapability).toHaveBeenCalledOnce(),
    )

    await expect(
      useAppStore.getState().setActiveConversation(second.id),
    ).resolves.toBe(true)
    releaseCatalog('image-model')

    await expect(sending).resolves.toBe(false)
    expect(activeConversationOf(useAppStore.getState().data)).toBe(
      useAppStore.getState().data?.conversations[1],
    )
    expect(useAppStore.getState().data?.conversations).toHaveLength(2)
    expect(runtime.generateImage).not.toHaveBeenCalled()
    expect(runtime.editImage).not.toHaveBeenCalled()
  })

  it('rejects image admission when data replacement completes during catalog loading', async () => {
    const data = freshData()
    data.conversations = []
    data.preferences.activeConversationId = undefined
    resetStore(data)

    let releaseCatalog!: (model: string) => void
    providerModelMocks.modelForProviderCapability.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseCatalog = resolve
        }),
    )

    const sending = useAppStore.getState().sendMessage('replaced image', {
      mode: 'image',
      imageTaskMode: 'generate',
    })
    await vi.waitFor(() =>
      expect(providerModelMocks.modelForProviderCapability).toHaveBeenCalledOnce(),
    )

    await useAppStore.getState().resetAll()
    releaseCatalog('image-model')

    await expect(sending).resolves.toBe(false)
    expect(useAppStore.getState().data).not.toBe(data)
    expect(runtime.generateImage).not.toHaveBeenCalled()
    expect(runtime.editImage).not.toHaveBeenCalled()
  })

  it('retries a transient image generation failure through the shared generation runtime', async () => {
    stubGenerationRetryTimers()
    resetStore()
    runtime.generateImage
      .mockRejectedValueOnce(
        Object.assign(new Error('temporary image failure'), { retryable: true }),
      )
      .mockResolvedValueOnce({
        dataUrl: 'data:image/png;base64,AAAA',
        mimeType: 'image/png',
        revisedPrompt: 'retried image',
      })

    const generation = useAppStore.getState().sendMessage('draw after retry', {
      mode: 'image',
      imageTaskMode: 'generate',
    })
    await vi.waitFor(() => expect(runtime.generateImage).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(400)
    await expect(generation).resolves.toBe(true)

    expect(runtime.generateImage).toHaveBeenCalledTimes(2)
    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      attachments: [expect.objectContaining({ alt: 'retried image' })],
      status: 'done',
    })
  })

  it('does not call the image Provider when the generation turn cannot persist', async () => {
    resetStore()
    const failure = new Error('image generation start persistence failed')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    dbMocks.saveAppData.mockRejectedValueOnce(failure)

    await expect(
      useAppStore.getState().sendMessage('persist image turn', {
        mode: 'image',
        imageTaskMode: 'generate',
      }),
    ).resolves.toBe(false)

    expect(runtime.generateImage).not.toHaveBeenCalled()
    expect(useAppStore.getState()).toMatchObject({ sending: false, streaming: false })
  })

  it('stops proxied image generation while access-key derivation is pending', async () => {
    const data = freshData()
    data.providers[0] = {
      ...data.providers[0],
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'proxy-passphrase' })
    let finishDerivation!: (token: string) => void
    accessKeyMocks.accessKeyFromPassword.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishDerivation = resolve
        }),
    )

    const sending = useAppStore.getState().sendMessage('cancel pending image', {
      imageTaskMode: 'generate',
      mode: 'image',
    })
    await vi.waitFor(() =>
      expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledOnce(),
    )
    expect(useAppStore.getState().abortController).toBeInstanceOf(AbortController)
    useAppStore.getState().stopStreaming()
    finishDerivation('unused-proxy-token')

    await expect(sending).resolves.toBe(false)
    expect(runtime.generateImage).not.toHaveBeenCalled()
    expect(runtime.editImage).not.toHaveBeenCalled()
    expect(useAppStore.getState()).toMatchObject({
      abortController: null,
      sending: false,
      streaming: false,
    })
    expect(useAppStore.getState().data?.conversations[0].messages).toEqual([])
  })

  it('admits only one image submission while source preparation is pending', async () => {
    resetStore()
    let finishSourceRead!: (dataUrl: string) => void
    imageMocks.fileToDataUrl.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishSourceRead = resolve
        }),
    )

    const first = useAppStore.getState().sendMessage('first image owner', {
      imageSourceFile: imageFile(),
      imageTaskMode: 'edit',
      mode: 'image',
    })
    await vi.waitFor(() => expect(finishSourceRead).toBeTypeOf('function'))
    const duplicate = useAppStore.getState().sendMessage('duplicate image owner', {
      imageSourceFile: imageFile('duplicate.png'),
      imageTaskMode: 'edit',
      mode: 'image',
    })

    await expect(duplicate).resolves.toBe(false)
    finishSourceRead('data:image/png;base64,AAAA')
    await expect(first).resolves.toBe(true)
    expect(runtime.editImage).toHaveBeenCalledOnce()
  })

  it('stops image submission while source preparation is pending', async () => {
    resetStore()
    let finishSourceRead!: (dataUrl: string) => void
    let sourceSignal!: AbortSignal
    imageMocks.fileToDataUrl.mockImplementationOnce(
      (...args: never[]) => {
        sourceSignal = args[1] as AbortSignal
        return new Promise<string>((resolve) => {
          finishSourceRead = resolve
        })
      },
    )

    const sending = useAppStore.getState().sendMessage('cancel image source', {
      imageSourceFile: imageFile(),
      imageTaskMode: 'edit',
      mode: 'image',
    })
    await vi.waitFor(() => expect(finishSourceRead).toBeTypeOf('function'))
    expect(sourceSignal).toBeInstanceOf(AbortSignal)
    useAppStore.getState().stopStreaming()
    expect(sourceSignal.aborted).toBe(true)
    finishSourceRead('data:image/png;base64,AAAA')

    await expect(sending).resolves.toBe(false)
    expect(runtime.editImage).not.toHaveBeenCalled()
    expect(runtime.generateImage).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.conversations[0].messages).toEqual([])
    expect(useAppStore.getState()).toMatchObject({
      abortController: null,
      sending: false,
      streaming: false,
    })
  })

  it('drops a generated image delivered after stopping a Provider that ignores abort', async () => {
    resetStore()
    let resolveImage!: (value: {
      dataUrl: string
      mimeType: string
      revisedPrompt: string
    }) => void
    runtime.generateImage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveImage = resolve
        }),
    )

    const sending = useAppStore.getState().sendMessage('stop before late image', {
      imageTaskMode: 'generate',
      mode: 'image',
    })
    await vi.waitFor(() => expect(runtime.generateImage).toHaveBeenCalledOnce())

    await expect(useAppStore.getState().stopStreaming()).resolves.toBe(true)
    resolveImage({
      dataUrl: 'data:image/png;base64,bGF0ZQ==',
      mimeType: 'image/png',
      revisedPrompt: 'late image',
    })

    await expect(sending).resolves.toBe(true)
    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'done',
    })
    expect(
      useAppStore.getState().data?.conversations[0].messages.at(-1)?.attachments,
    ).toBeUndefined()
  })

  it('deletes an image message by draining its active generation before switching', async () => {
    const data = freshData()
    const first = data.conversations[0]
    const second = {
      ...structuredClone(first),
      id: 'image-owner-second-conversation',
      messages: [],
      title: 'Second image conversation',
    }
    data.conversations = [first, second]
    resetStore(data)

    let resolveImage!: (value: {
      dataUrl: string
      mimeType: string
      revisedPrompt: string
    }) => void
    runtime.generateImage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveImage = resolve
        }),
    )

    const firstGeneration = useAppStore.getState().sendMessage('image owner A', {
      imageTaskMode: 'generate',
      mode: 'image',
    })
    await vi.waitFor(() => expect(runtime.generateImage).toHaveBeenCalledOnce())

    const firstMessages = useAppStore.getState().data?.conversations[0].messages ?? []
    const firstPrompt = firstMessages[0]
    const firstAssistant = firstMessages.at(-1)
    expect(firstPrompt?.role).toBe('user')
    expect(firstAssistant).toMatchObject({ role: 'assistant', status: 'streaming' })
    const imageSignal = runtime.generateImage.mock.calls[0]?.[0]?.signal as
      | AbortSignal
      | undefined

    vi.mocked(globalThis.confirm).mockReturnValueOnce(true)
    const deletion = useAppStore.getState().deleteMessage(firstAssistant?.id ?? '')
    await vi.waitFor(() => expect(imageSignal?.aborted).toBe(true))
    await expect(
      useAppStore.getState().sendMessage('image owner B', {
        imageTaskMode: 'generate',
        mode: 'image',
      }),
    ).resolves.toBe(false)
    await expect(
      Promise.resolve(useAppStore.getState().retryMessage(firstAssistant?.id ?? '')),
    ).resolves.toBeUndefined()
    await expect(Promise.resolve(useAppStore.getState().regenerate())).resolves.toBeUndefined()
    await expect(
      useAppStore
        .getState()
        .editAndResendMessage(firstPrompt?.id ?? '', 'replacement prompt'),
    ).resolves.toBe(false)

    resolveImage({
      dataUrl: 'data:image/png;base64,QU',
      mimeType: 'image/png',
      revisedPrompt: 'late A',
    })
    await expect(firstGeneration).resolves.toBe(true)
    await vi.advanceTimersByTimeAsync(100)
    await expect(deletion).resolves.toBe(true)

    expect(
      useAppStore
        .getState()
        .data?.conversations.find((conversation) => conversation.id === first.id)
        ?.messages,
    ).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: firstAssistant?.id })]))

    const switching = useAppStore.getState().setActiveConversation(second.id)
    await expect(switching).resolves.toBe(true)
    expect(useAppStore.getState().data?.preferences.activeConversationId).toBe(second.id)

    await expect(
      useAppStore.getState().sendMessage('image owner B', {
        imageTaskMode: 'generate',
        mode: 'image',
      }),
    ).resolves.toBe(true)
    expect(
      useAppStore
        .getState()
        .data?.conversations.find((conversation) => conversation.id === second.id)
        ?.messages.at(-1),
    ).toMatchObject({
      role: 'assistant',
      status: 'done',
      attachments: [expect.objectContaining({ purpose: 'generated' })],
    })
  })

  it('drops a generated image when stopping wins between retry completion and terminal commit', async () => {
    resetStore()
    let resolveImage!: (value: {
      dataUrl: string
      mimeType: string
      revisedPrompt: string
    }) => void
    let imageResult!: Promise<{
      dataUrl: string
      mimeType: string
      revisedPrompt: string
    }>
    runtime.generateImage.mockImplementationOnce(
      () =>
        (imageResult = new Promise((resolve) => {
          resolveImage = resolve
        })),
    )

    const sending = useAppStore.getState().sendMessage('stop after image resolve', {
      imageTaskMode: 'generate',
      mode: 'image',
    })
    await vi.waitFor(() => expect(runtime.generateImage).toHaveBeenCalledOnce())

    resolveImage({
      dataUrl: 'data:image/png;base64,bGF0ZQ==',
      mimeType: 'image/png',
      revisedPrompt: 'late image',
    })
    void imageResult.then(() => {
      void useAppStore.getState().stopStreaming()
    })

    await expect(sending).resolves.toBe(true)
    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'done',
    })
    expect(
      useAppStore.getState().data?.conversations[0].messages.at(-1)?.attachments,
    ).toBeUndefined()
  })

  it('does not persist a generated image after backup import takes ownership', async () => {
    resetStore()
    let resolveImage!: (value: {
      dataUrl: string
      mimeType: string
      revisedPrompt: string
    }) => void
    runtime.generateImage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveImage = resolve
        }),
    )

    const sending = useAppStore.getState().sendMessage('image before import', {
      imageTaskMode: 'generate',
      mode: 'image',
    })
    await vi.waitFor(() => expect(runtime.generateImage).toHaveBeenCalledOnce())

    const imported = structuredClone(useAppStore.getState().data!)
    imported.preferences.theme = 'dark'
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: imported,
      secrets: { providerKeys: {} },
    })
    useAppStore.setState({ syncPassphrase: 'passphrase' })
    const saveCallStart = dbMocks.saveAppData.mock.calls.length

    const importing = useAppStore
      .getState()
      .importBackup(new File(['{}'], 'image-import.json', { type: 'application/json' }))
    await vi.waitFor(() => expect(cryptoMocks.decryptVault).toHaveBeenCalledOnce())
    await vi.waitFor(() =>
      expect(useAppStore.getState().abortController?.signal.aborted).toBe(true),
    )

    resolveImage({
      dataUrl: 'data:image/png;base64,SU1QT1JUT1JF',
      mimeType: 'image/png',
      revisedPrompt: 'must not persist',
    })
    await expect(sending).resolves.toBe(true)
    await vi.waitFor(() =>
      expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
    )
    await importing

    const lateGeneratedSaves = dbMocks.saveAppData.mock.calls
      .slice(saveCallStart)
      .filter(([candidate]) =>
        (candidate as AppData).conversations.some((conversation) =>
          conversation.messages.some((message) =>
            message.attachments?.some((attachment) => attachment.purpose === 'generated'),
          ),
        ),
      )
    expect(lateGeneratedSaves).toHaveLength(0)
    expect(useAppStore.getState().data?.preferences.theme).toBe('dark')
  })

  it('does not persist a generated image after reset owns the replacement lease', async () => {
    resetStore()
    let resolveImage!: (value: {
      dataUrl: string
      mimeType: string
      revisedPrompt: string
    }) => void
    let imageResult!: Promise<{
      dataUrl: string
      mimeType: string
      revisedPrompt: string
    }>
    runtime.generateImage.mockImplementationOnce(
      () =>
        (imageResult = new Promise((resolve) => {
          resolveImage = resolve
        })),
    )

    const sending = useAppStore.getState().sendMessage('image before reset', {
      imageTaskMode: 'generate',
      mode: 'image',
    })
    await vi.waitFor(() => expect(runtime.generateImage).toHaveBeenCalledOnce())
    const saveCallStart = dbMocks.saveAppData.mock.calls.length
    const resetting = imageResult.then(() => useAppStore.getState().resetAll())

    resolveImage({
      dataUrl: 'data:image/png;base64,UkVTRVQ=',
      mimeType: 'image/png',
      revisedPrompt: 'must not persist after reset',
    })
    await expect(sending).resolves.toBe(true)

    const lateGeneratedSaves = dbMocks.saveAppData.mock.calls
      .slice(saveCallStart)
      .filter(([candidate]) =>
        (candidate as AppData).conversations.some((conversation) =>
          conversation.messages.some((message) =>
            message.attachments?.some((attachment) => attachment.purpose === 'generated'),
          ),
        ),
      )
    expect(lateGeneratedSaves).toHaveLength(0)
    await resetting
    expect(useAppStore.getState().data?.conversations).toHaveLength(1)
    expect(useAppStore.getState().data?.conversations[0]?.messages).toEqual([])
  })

  it('does not persist a generated image after a conversation switch owns the stop', async () => {
    const data = freshData()
    const first = data.conversations[0]
    const second = {
      ...structuredClone(first),
      id: 'image-switch-target',
      messages: [],
      title: 'Second conversation',
    }
    data.conversations = [first, second]
    resetStore(data)

    let resolveImage!: (value: {
      dataUrl: string
      mimeType: string
      revisedPrompt: string
    }) => void
    let imageResult!: Promise<{
      dataUrl: string
      mimeType: string
      revisedPrompt: string
    }>
    runtime.generateImage.mockImplementationOnce(
      () =>
        (imageResult = new Promise((resolve) => {
          resolveImage = resolve
        })),
    )

    const sending = useAppStore.getState().sendMessage('image before switch', {
      imageTaskMode: 'generate',
      mode: 'image',
    })
    await vi.waitFor(() => expect(runtime.generateImage).toHaveBeenCalledOnce())
    const saveCallStart = dbMocks.saveAppData.mock.calls.length
    const switching = imageResult.then(() =>
      useAppStore.getState().setActiveConversation(second.id),
    )

    resolveImage({
      dataUrl: 'data:image/png;base64, U1dJVENI',
      mimeType: 'image/png',
      revisedPrompt: 'must not persist after switch',
    })
    await expect(sending).resolves.toBe(true)
    await vi.waitFor(() =>
      expect(useAppStore.getState().data?.preferences.activeConversationId).toBe(
        second.id,
      ),
    )
    await switching

    const lateGeneratedSaves = dbMocks.saveAppData.mock.calls
      .slice(saveCallStart)
      .filter(([candidate]) =>
        (candidate as AppData).conversations.some((conversation) =>
          conversation.messages.some((message) =>
            message.attachments?.some((attachment) => attachment.purpose === 'generated'),
          ),
        ),
      )
    expect(lateGeneratedSaves).toHaveLength(0)
    expect(useAppStore.getState().data?.preferences.activeConversationId).toBe(
      second.id,
    )
    expect(
      useAppStore
        .getState()
        .data?.conversations.find((conversation) => conversation.id === first.id)
        ?.messages,
    ).toHaveLength(2)
  })

  it('persists a stopped image turn when cancellation wins the durable start wait', async () => {
    resetStore()
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    let releaseStart!: () => void
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseStart = resolve
        }),
    )

    const sending = useAppStore.getState().sendMessage('cancel image save', {
      imageTaskMode: 'generate',
      mode: 'image',
    })
    await vi.waitFor(() => expect(releaseStart).toBeTypeOf('function'))
    expect(useAppStore.getState().abortController).toBeInstanceOf(AbortController)
    useAppStore.getState().stopStreaming()
    releaseStart()
    await expect(sending).resolves.toBe(true)

    expect(runtime.generateImage).not.toHaveBeenCalled()
    expect(runtime.editImage).not.toHaveBeenCalled()
    expect(useAppStore.getState()).toMatchObject({
      abortController: null,
      sending: false,
      streaming: false,
    })
    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'done',
    })
  })

  it('contains image preflight notification failures', async () => {
    resetStore()
    useAppStore.setState({
      keys: {},
      notify: () => {
        throw new Error('broken notification channel')
      },
    })

    await expect(
      useAppStore.getState().sendMessage('missing image key', {
        imageTaskMode: 'generate',
        mode: 'image',
      }),
    ).resolves.toBe(false)

    expect(runtime.generateImage).not.toHaveBeenCalled()
    expect(useAppStore.getState()).toMatchObject({ sending: false, streaming: false })
  })

  it('contains image start-save notification failures without contacting the Provider', async () => {
    resetStore()
    dbMocks.saveAppData.mockRejectedValueOnce(new Error('image start save failed'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    useAppStore.setState({
      notify: () => {
        throw new Error('broken notification channel')
      },
    })

    await expect(
      useAppStore.getState().sendMessage('failed durable image start', {
        imageTaskMode: 'generate',
        mode: 'image',
      }),
    ).resolves.toBe(false)

    expect(runtime.generateImage).not.toHaveBeenCalled()
    expect(useAppStore.getState()).toMatchObject({ sending: false, streaming: false })
  })

  it('contains image terminal notification failures after durable failure', async () => {
    resetStore()
    runtime.generateImage.mockRejectedValueOnce(new Error('image Provider failed'))
    useAppStore.setState({
      notify: () => {
        throw new Error('broken notification channel')
      },
    })

    await expect(
      useAppStore.getState().sendMessage('terminal image failure', {
        imageTaskMode: 'generate',
        mode: 'image',
      }),
    ).resolves.toBe(true)

    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'error',
    })
    expect(useAppStore.getState()).toMatchObject({ sending: false, streaming: false })
  })

  it('does not expose image source read errors in user notifications', async () => {
    resetStore()
    const sentinel = 'C:\\private\\image sk-secret-1234567890'
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    imageMocks.fileToDataUrl.mockRejectedValueOnce(new Error(sentinel))

    await expect(
      useAppStore.getState().sendMessage('read image source', {
        imageSourceFile: imageFile(),
        imageTaskMode: 'edit',
        mode: 'image',
      }),
    ).resolves.toBe(false)

    const output = useAppStore.getState().toasts.map((toast) => toast.message).join(' ')
    expect(output).not.toContain(sentinel)
    expect(output).toContain('PNG')
    expect(runtime.editImage).not.toHaveBeenCalled()
    expect(useAppStore.getState()).toMatchObject({ sending: false, streaming: false })
  })

  it('reruns an edited image with its captured source, mask, and image model', async () => {
    const data = resetStore()
    const prompt = message('image-rerun-user', 'user', 'replace the sky', {
      attachments: [
        {
          alt: 'source',
          createdAt: 1,
          dataUrl: 'data:image/png;base64,AAAA',
          id: 'image-rerun-source',
          kind: 'image',
          mimeType: 'image/png',
          purpose: 'source',
        },
        {
          alt: 'mask',
          createdAt: 1,
          dataUrl: 'data:image/png;base64,AAAA',
          id: 'image-rerun-mask',
          kind: 'image',
          mimeType: 'image/png',
          purpose: 'mask',
        },
      ],
    })
    const assistant = message(
      'image-rerun-assistant',
      'assistant',
      '',
      {
        attachments: [
          {
            alt: 'previous result',
            createdAt: 2,
            dataUrl: 'data:image/png;base64,AAAA',
            id: 'image-rerun-result',
            kind: 'image',
            mimeType: 'image/png',
            model: 'captured-image-model',
            purpose: 'generated',
          },
        ],
        createdAt: 2,
      },
    )
    withMessages(data, [prompt, assistant])

    await useAppStore.getState().retryMessage(assistant.id)

    expect(runtime.editImage).toHaveBeenCalledWith(
      expect.objectContaining({
        image: expect.any(File),
        mask: expect.any(File),
        model: 'captured-image-model',
        prompt: 'replace the sky',
      }),
    )
    expect(runtime.streamChat).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.conversations[0].messages).toEqual([
      prompt,
      expect.objectContaining({
        id: assistant.id,
        status: 'done',
        attachments: [
          expect.objectContaining({
            model: 'captured-image-model',
            purpose: 'generated',
          }),
        ],
      }),
    ])
  })

  it('regenerates an image with the model captured by the previous result', async () => {
    const data = resetStore()
    const prompt = message('image-regenerate-user', 'user', 'draw a lighthouse')
    const assistant = message(
      'image-regenerate-assistant',
      'assistant',
      '',
      {
        attachments: [
          {
            alt: 'previous lighthouse',
            createdAt: 2,
            dataUrl: 'data:image/png;base64,AAAA',
            id: 'image-regenerate-result',
            kind: 'image',
            mimeType: 'image/png',
            model: 'captured-generation-model',
            purpose: 'generated',
          },
        ],
        createdAt: 2,
      },
    )
    withMessages(data, [prompt, assistant])

    await useAppStore.getState().regenerate()

    expect(runtime.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'captured-generation-model',
        prompt: 'draw a lighthouse',
      }),
    )
    expect(runtime.editImage).not.toHaveBeenCalled()
    expect(runtime.streamChat).not.toHaveBeenCalled()
  })

  it('resends an edited image prompt with its original source and mask', async () => {
    const data = resetStore()
    const prompt = message('image-edit-user', 'user', 'old image prompt', {
      attachments: [
        {
          createdAt: 1,
          dataUrl: 'data:image/png;base64,AAAA',
          id: 'image-edit-source',
          kind: 'image',
          mimeType: 'image/png',
          purpose: 'source',
        },
        {
          createdAt: 1,
          dataUrl: 'data:image/png;base64,AAAA',
          id: 'image-edit-mask',
          kind: 'image',
          mimeType: 'image/png',
          purpose: 'mask',
        },
      ],
    })
    const assistant = message('image-edit-assistant', 'assistant', '', {
      attachments: [
        {
          createdAt: 2,
          dataUrl: 'data:image/png;base64,AAAA',
          id: 'image-edit-result',
          kind: 'image',
          mimeType: 'image/png',
          model: 'captured-edit-model',
          purpose: 'generated',
        },
      ],
      createdAt: 2,
    })
    withMessages(data, [prompt, assistant])

    await useAppStore.getState().editAndResendMessage(
      prompt.id,
      'new image prompt',
    )

    expect(runtime.editImage).toHaveBeenCalledWith(
      expect.objectContaining({
        image: expect.any(File),
        mask: expect.any(File),
        model: 'captured-edit-model',
        prompt: 'new image prompt',
      }),
    )
    expect(runtime.streamChat).not.toHaveBeenCalled()
    const messages = useAppStore.getState().data?.conversations[0].messages ?? []
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({
      content: 'new image prompt',
      role: 'user',
      attachments: prompt.attachments,
    })
    expect(messages[0].id).not.toBe(prompt.id)
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      status: 'done',
      attachments: [
        expect.objectContaining({
          model: 'captured-edit-model',
          purpose: 'generated',
        }),
      ],
    })
    expect(messages[1].id).not.toBe(assistant.id)
  })

  it('does not replace an image rerun target recreated by another tab', async () => {
    const data = resetStore()
    withMessages(data, [
      message('image-conflict-user', 'user', 'draw through conflict'),
      message('image-conflict-assistant', 'assistant', '', {
        attachments: [
          {
            createdAt: 2,
            dataUrl: 'data:image/png;base64,AAAA',
            id: 'image-conflict-result',
            kind: 'image',
            mimeType: 'image/png',
            model: 'image-conflict-model',
            purpose: 'generated',
          },
        ],
        createdAt: 2,
      }),
    ])
    await useAppStore.getState().flushLocalSaves()
    const remote = structuredClone(useAppStore.getState().data!)
    remote.conversations[0].messages[1] = message(
      'image-conflict-assistant',
      'assistant',
      'new remote result',
      { createdAt: 500 },
    )
    remote.conversations[0].updatedAt = 500
    remote.updatedAt = 500
    dbMocks.saveAppData.mockClear()
    dbMocks.saveAppData
      .mockRejectedValueOnce(new AppDataWriteConflictError())
      .mockResolvedValue(undefined)
    dbMocks.loadAppData.mockResolvedValue(remote)

    await useAppStore.getState().retryMessage('image-conflict-assistant')

    expect(runtime.generateImage).not.toHaveBeenCalled()
    expect(runtime.editImage).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.conversations[0].messages[1]).toMatchObject({
      content: 'new remote result',
      createdAt: 500,
      status: 'done',
    })
  })

  it('returns true when an edited-message resend owns the durable turn and edits, deletes, regenerates, retries, and resends user messages', async () => {
    const data = resetStore()
    const user = message('user-1', 'user', 'first')
    const assistant = message('assistant-1', 'assistant', 'old', {
      status: 'error',
      error: 'old error',
    })
    withMessages(data, [user, assistant])
    useAppStore.getState().editMessage('user-1', 'edited')
    expect(useAppStore.getState().data?.conversations[0].messages[0].content).toBe(
      'edited',
    )
    await useAppStore.getState().deleteMessage('assistant-1')
    expect(useAppStore.getState().data?.conversations[0].messages).toHaveLength(1)

    withMessages(data, [user, assistant])
    await useAppStore.getState().retryMessage('assistant-1')
    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      content: 'reply',
      status: 'done',
    })

    withMessages(data, [user, assistant])
    await useAppStore.getState().regenerate()
    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      content: 'reply',
      status: 'done',
    })

    const imageUser = message('image-user', 'user', 'with image', {
      attachments: [
        {
          alt: 'source.png',
          dataUrl: 'data:image/png;base64,AAAA',
          id: 'image-1',
          kind: 'image',
          mimeType: 'image/png',
          purpose: 'source',
          createdAt: 1,
        },
      ],
    })
    withMessages(data, [imageUser])
    await expect(
      useAppStore.getState().editAndResendMessage('image-user', 'resend'),
    ).resolves.toBe(true)
    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      content: 'reply',
      status: 'done',
    })
  })

  it('keeps message deletion behind confirmation and a durable queued-turn commit', async () => {
    const data = resetStore()
    data.conversations[0].title = 'stale title'
    const keepUser = message('delete-keep-user', 'user', '  Keep this title  ')
    const keepAssistant = message('delete-keep-assistant', 'assistant', 'keep')
    const queuedUser = message('delete-queued-user', 'user', 'queued prompt')
    const queuedAssistant = message('delete-queued-assistant', 'assistant', 'queued', {
      queuedTextRequest: {
        providerId: data.providers[0].id,
        model: data.providers[0].model,
        promptMessageId: queuedUser.id,
      },
      status: 'queued',
    })
    withMessages(data, [keepUser, keepAssistant, queuedUser, queuedAssistant])
    await useAppStore.getState().flushLocalSaves()

    const confirm = vi.mocked(globalThis.confirm)
    confirm.mockReturnValueOnce(false)
    await expect(
      Promise.resolve(useAppStore.getState().deleteMessage(queuedUser.id)),
    ).resolves.toBe(false)
    expect(useAppStore.getState().data?.conversations[0].messages).toHaveLength(4)

    let releaseSave!: () => void
    const heldSave = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    dbMocks.saveAppData.mockClear()
    dbMocks.saveAppData.mockReturnValueOnce(heldSave)
    let settled = false
    const deletion = Promise.resolve(
      useAppStore.getState().deleteMessage(queuedUser.id),
    ).then((result) => {
      settled = true
      return result
    })

    await vi.advanceTimersByTimeAsync(300)
    const pendingBeforeDurableSave =
      dbMocks.saveAppData.mock.calls.length === 1 &&
      !settled &&
      useAppStore.getState().data?.conversations[0].messages.length === 4
    releaseSave()
    const result = await deletion

    expect(pendingBeforeDurableSave).toBe(true)
    expect(result).toBe(true)
    expect(useAppStore.getState().data?.conversations[0]).toMatchObject({
      title: 'Keep this title',
      messages: [
        expect.objectContaining({ id: keepUser.id }),
        expect.objectContaining({ id: keepAssistant.id }),
      ],
    })
  })

  it('owns message deletion until its durable commit settles and rejects duplicates before confirmation', async () => {
    const data = resetStore()
    const user = message('delete-owner-user', 'user', 'keep this prompt')
    const assistant = message(
      'delete-owner-assistant',
      'assistant',
      'delete this answer',
    )
    withMessages(data, [user, assistant])
    await useAppStore.getState().flushLocalSaves()

    let releaseSave!: () => void
    dbMocks.saveAppData.mockClear()
    dbMocks.saveAppData.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseSave = resolve
      }),
    )
    const confirm = vi.mocked(globalThis.confirm)
    confirm.mockClear()
    confirm.mockReturnValue(true)

    const first = useAppStore.getState().deleteMessage(assistant.id)
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())

    expect(useAppStore.getState().conversationMutationPending).toBe(true)
    const duplicate = useAppStore.getState().deleteMessage(assistant.id)
    await expect(duplicate).resolves.toBe(false)
    expect(confirm).toHaveBeenCalledOnce()
    expect(dbMocks.saveAppData).toHaveBeenCalledOnce()

    releaseSave()
    await expect(first).resolves.toBe(true)
    expect(useAppStore.getState().conversationMutationPending).toBe(false)
  })

  it('keeps the message visible when its durable deletion fails', async () => {
    const data = resetStore()
    const user = message('delete-failure-user', 'user', 'keep this prompt')
    const assistant = message('delete-failure-assistant', 'assistant', 'keep this answer')
    withMessages(data, [user, assistant])
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockRejectedValueOnce(new Error('C:\\private\\delete-secret'))

    await expect(
      Promise.resolve(useAppStore.getState().deleteMessage(assistant.id)),
    ).resolves.toBe(false)

    expect(useAppStore.getState().data?.conversations[0].messages).toEqual([
      user,
      assistant,
    ])
    expect(useAppStore.getState().toasts.at(-1)?.message).not.toContain(
      'delete-secret',
    )
  })

  it('does not overwrite a message edited while its deletion is being saved', async () => {
    const data = resetStore()
    const user = message('delete-race-user', 'user', 'keep this prompt')
    const assistant = message('delete-race-assistant', 'assistant', 'old answer')
    withMessages(data, [user, assistant])
    await useAppStore.getState().flushLocalSaves()

    let releaseDeletionSave!: () => void
    dbMocks.saveAppData.mockClear()
    dbMocks.saveAppData.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseDeletionSave = resolve
      }),
    )
    const deletion = useAppStore.getState().deleteMessage(assistant.id)
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledTimes(1))

    useAppStore.getState().editMessage(assistant.id, 'new local answer')
    releaseDeletionSave()

    await expect(deletion).resolves.toBe(false)
    await useAppStore.getState().flushLocalSaves()
    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      content: 'new local answer',
      id: assistant.id,
    })
    expect(dbMocks.saveAppData.mock.calls.at(-1)?.[0]).toMatchObject({
      conversations: [
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: 'new local answer',
              id: assistant.id,
            }),
          ]),
        }),
      ],
    })
  })

  it('returns false when an edited-message resend is rejected before durable takeover (blank draft)', async () => {
    const data = resetStore()
    const user = message('blank-edit-user', 'user', 'keep this prompt')
    const assistant = message('blank-edit-assistant', 'assistant', 'keep this answer')
    withMessages(data, [user, assistant])

    await expect(
      useAppStore.getState().editAndResendMessage(user.id, '   '),
    ).resolves.toBe(false)

    expect(runtime.streamChat).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.conversations[0].messages).toEqual([
      user,
      assistant,
    ])
    expect(useAppStore.getState().toasts).toHaveLength(1)
    expect(useAppStore.getState().toasts[0]?.message).toContain('prompt')
  })

  it('contains edited-message preflight notification failures', async () => {
    const data = resetStore()
    const user = message('preflight-edit-user', 'user', 'old prompt')
    const assistant = message('preflight-edit-assistant', 'assistant', 'old answer')
    withMessages(data, [user, assistant])
    useAppStore.setState({
      keys: {},
      notify: () => {
        throw new Error('broken notification channel')
      },
    })

    await expect(
      useAppStore.getState().editAndResendMessage(user.id, 'new prompt'),
    ).resolves.toBe(false)

    expect(runtime.streamChat).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.conversations[0].messages).toEqual([
      user,
      assistant,
    ])
    expect(useAppStore.getState()).toMatchObject({ sending: false, streaming: false })
  })

  it('does not replace a rerun target when its generation turn cannot persist', async () => {
    const data = resetStore()
    const user = message('rerun-user', 'user', 'original prompt')
    const assistant = message('rerun-assistant', 'assistant', 'original answer')
    withMessages(data, [user, assistant])
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    dbMocks.saveAppData.mockRejectedValueOnce(new Error('rerun save failed'))

    await useAppStore.getState().regenerate()

    expect(runtime.streamChat).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.conversations[0].messages).toEqual([
      user,
      assistant,
    ])
    expect(useAppStore.getState()).toMatchObject({ sending: false, streaming: false })
  })

  it('does not replace a rerun target recreated by another tab during start commit', async () => {
    const data = resetStore()
    withMessages(data, [
      message('rerun-user', 'user', 'rerun prompt'),
      message('rerun-assistant', 'assistant', 'original answer', { createdAt: 2 }),
    ])
    await useAppStore.getState().flushLocalSaves()
    const remote = structuredClone(useAppStore.getState().data!)
    remote.conversations[0].messages[1] = message(
      'rerun-assistant',
      'assistant',
      'replacement answer',
      { createdAt: 500 },
    )
    remote.conversations[0].updatedAt = 500
    remote.updatedAt = 500
    dbMocks.saveAppData.mockClear()
    dbMocks.saveAppData
      .mockRejectedValueOnce(new AppDataWriteConflictError())
      .mockResolvedValue(undefined)
    dbMocks.loadAppData.mockResolvedValue(remote)

    await useAppStore.getState().retryMessage('rerun-assistant')

    expect(runtime.streamChat).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.conversations[0].messages[1]).toMatchObject({
      id: 'rerun-assistant',
      content: 'replacement answer',
      createdAt: 500,
      status: 'done',
    })
  })

  it('does not overwrite a same-id assistant recreated during rerun terminal commit', async () => {
    const data = resetStore()
    withMessages(data, [
      message('terminal-user', 'user', 'terminal prompt'),
      message('terminal-assistant', 'assistant', 'old answer'),
    ])
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    let remote: AppData | null = null
    let terminalConflictInjected = false
    dbMocks.saveAppData.mockImplementation(async (snapshot: unknown) => {
      const persisted = snapshot as AppData
      const assistant = persisted.conversations[0].messages.at(-1)
      if (
        !terminalConflictInjected &&
        assistant?.role === 'assistant' &&
        assistant.status === 'done' &&
        assistant.id !== 'terminal-assistant'
      ) {
        terminalConflictInjected = true
        remote = structuredClone(persisted)
        const replacement = remote.conversations[0].messages.at(-1)!
        replacement.content = 'replacement terminal answer'
        replacement.createdAt += 1
        remote.conversations[0].updatedAt = persisted.conversations[0].updatedAt + 1
        remote.updatedAt = persisted.updatedAt + 1
        throw new AppDataWriteConflictError()
      }
    })
    dbMocks.loadAppData.mockImplementation(async () => remote)

    await useAppStore.getState().retryMessage('terminal-assistant')

    expect(terminalConflictInjected).toBe(true)
    expect(useAppStore.getState().data?.conversations[0].messages.at(-1)).toMatchObject({
      content: 'replacement terminal answer',
      status: 'done',
    })
  })

  it('admits only one same-tick regenerate owner', async () => {
    const data = resetStore()
    withMessages(data, [
      message('regenerate-user', 'user', 'regenerate once'),
      message('regenerate-assistant', 'assistant', 'old answer'),
    ])

    const first = useAppStore.getState().regenerate()
    const duplicate = useAppStore.getState().regenerate()
    await Promise.all([first, duplicate])

    expect(runtime.streamChat).toHaveBeenCalledOnce()
    const assistants =
      useAppStore.getState().data?.conversations[0].messages.filter(
        (candidate) => candidate.role === 'assistant',
      ) ?? []
    expect(assistants).toHaveLength(1)
  })

  it('admits only one same-tick edited-message resend owner', async () => {
    const data = resetStore()
    const user = message('edited-user', 'user', 'old prompt')
    const assistant = message('edited-assistant', 'assistant', 'old answer')
    withMessages(data, [user, assistant])

    const first = useAppStore.getState().editAndResendMessage(user.id, 'new prompt')
    const duplicate = useAppStore.getState().editAndResendMessage(user.id, 'new prompt')
    const [firstResult, duplicateResult] = await Promise.all([first, duplicate])

    expect(firstResult).toBe(true)
    expect(duplicateResult).toBe(false)

    expect(runtime.streamChat).toHaveBeenCalledOnce()
    const messages = useAppStore.getState().data?.conversations[0].messages ?? []
    expect(messages.filter((candidate) => candidate.role === 'user')).toHaveLength(1)
    expect(messages.filter((candidate) => candidate.role === 'assistant')).toHaveLength(1)
  })

  it('preserves the edited-message history when its resend turn cannot persist', async () => {
    const data = resetStore()
    const user = message('edit-save-user', 'user', 'old prompt')
    const assistant = message('edit-save-assistant', 'assistant', 'old answer')
    withMessages(data, [user, assistant])
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    dbMocks.saveAppData.mockRejectedValueOnce(new Error('edited resend save failed'))

    await expect(
      useAppStore.getState().editAndResendMessage(user.id, 'new prompt'),
    ).resolves.toBe(false)

    expect(runtime.streamChat).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.conversations[0].messages).toEqual([
      user,
      assistant,
    ])
    expect(useAppStore.getState()).toMatchObject({ sending: false, streaming: false })
  })

  it('reads completed assistant text aloud with owned cleanup and stable failures', async () => {
    const data = resetStore()
    const assistant = message('assistant-speech', 'assistant', 'Read this response')
    const user = message('user-speech', 'user', 'Do not read this')
    withMessages(data, [user, assistant])

    const audio = {
      onended: null as (() => void) | null,
      onerror: null as (() => void) | null,
      pause: vi.fn(),
      play: vi.fn(async () => undefined),
    }
    const createObjectURL = vi.fn(() => 'blob:assistant-speech')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('Audio', vi.fn(function AudioMock() {
      return audio
    }))
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    runtime.synthesizeSpeechAudio.mockResolvedValue({
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }),
      model: 'speech-model',
    })

    await useAppStore.getState().speakMessage(assistant)

    expect(runtime.synthesizeSpeechAudio).toHaveBeenCalledTimes(1)
    expect(runtime.synthesizeSpeechAudio).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Read this response' }),
    )
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().speakingMessageId).toBe(assistant.id)

    await useAppStore.getState().speakMessage(assistant)
    expect(audio.pause).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:assistant-speech')
    expect(useAppStore.getState().speakingMessageId).toBe('')

    runtime.synthesizeSpeechAudio.mockClear()
    await useAppStore.getState().speakMessage(user)
    expect(runtime.synthesizeSpeechAudio).not.toHaveBeenCalled()

    const sentinel = 'C:\\private\\speech-secret-token'
    runtime.synthesizeSpeechAudio.mockRejectedValueOnce(new Error(sentinel))
    await useAppStore.getState().speakMessage(assistant)
    const failure = useAppStore.getState().toasts.at(-1)?.message ?? ''
    expect(failure).toBe(appT(data, 'message.readFailed'))
    expect(failure).not.toContain(sentinel)
    expect(useAppStore.getState().speakingMessageId).toBe('')
  })

  it('clears speech playback when the media element aborts', async () => {
    const data = resetStore()
    const assistant = message(
      'assistant-speech-abort',
      'assistant',
      'Read this response',
    )
    withMessages(data, [assistant])

    const audio = {
      onabort: null as (() => void) | null,
      onended: null as (() => void) | null,
      onerror: null as (() => void) | null,
      pause: vi.fn(),
      play: vi.fn(async () => undefined),
    }
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('Audio', vi.fn(function AudioMock() {
      return audio
    }))
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:aborted-speech'),
      revokeObjectURL,
    })
    runtime.synthesizeSpeechAudio.mockResolvedValueOnce({
      blob: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
      model: 'speech-model',
    })

    await useAppStore.getState().speakMessage(assistant)
    expect(useAppStore.getState().speakingMessageId).toBe(assistant.id)

    audio.onabort?.()

    expect(audio.pause).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:aborted-speech')
    expect(useAppStore.getState().speakingMessageId).toBe('')
  })

  it('ignores late events from a speech element after a newer playback owns the store', async () => {
    const data = resetStore()
    const first = message('assistant-speech-late-first', 'assistant', 'Read first')
    const second = message(
      'assistant-speech-late-second',
      'assistant',
      'Read second',
    )
    withMessages(data, [first, second])

    const firstAudio = {
      onabort: null as (() => void) | null,
      onended: null as (() => void) | null,
      onerror: null as (() => void) | null,
      pause: vi.fn(),
      play: vi.fn(async () => undefined),
    }
    const secondAudio = {
      onabort: null as (() => void) | null,
      onended: null as (() => void) | null,
      onerror: null as (() => void) | null,
      pause: vi.fn(),
      play: vi.fn(async () => undefined),
    }
    const audios = [firstAudio, secondAudio]
    const AudioMock = vi.fn(function AudioMock() {
      return audios.shift()
    })
    vi.stubGlobal('Audio', AudioMock)
    vi.stubGlobal('URL', {
      createObjectURL: vi
        .fn()
        .mockReturnValueOnce('blob:late-first')
        .mockReturnValueOnce('blob:late-second'),
      revokeObjectURL: vi.fn(),
    })
    runtime.synthesizeSpeechAudio.mockResolvedValue({
      blob: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
      model: 'speech-model',
    })

    await useAppStore.getState().speakMessage(first)
    await useAppStore.getState().speakMessage(second)
    const toastCount = useAppStore.getState().toasts.length

    firstAudio.onended?.()
    firstAudio.onabort?.()
    firstAudio.onerror?.()

    expect(firstAudio.pause).toHaveBeenCalledOnce()
    expect(secondAudio.pause).not.toHaveBeenCalled()
    expect(useAppStore.getState().speakingMessageId).toBe(second.id)
    expect(useAppStore.getState().toasts).toHaveLength(toastCount)

    useAppStore.getState().stopSpeakingMessage()
  })

  it('accepts a current message value after its AppData snapshot is rebuilt', async () => {
    const data = resetStore()
    const assistant = message(
      'assistant-speech-rebuilt',
      'assistant',
      'Read the rebuilt response',
    )
    withMessages(data, [assistant])
    const audio = {
      onended: null as (() => void) | null,
      onerror: null as (() => void) | null,
      pause: vi.fn(),
      play: vi.fn(async () => undefined),
    }
    vi.stubGlobal('Audio', vi.fn(function AudioMock() {
      return audio
    }))
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:rebuilt-speech'),
      revokeObjectURL: vi.fn(),
    })
    runtime.synthesizeSpeechAudio.mockResolvedValueOnce({
      blob: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
      model: 'speech-model',
    })

    const rebuiltData = structuredClone(useAppStore.getState().data)
    useAppStore.setState({ data: rebuiltData })

    await expect(
      useAppStore.getState().speakMessage(structuredClone(assistant)),
    ).resolves.toBeUndefined()

    expect(runtime.synthesizeSpeechAudio).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Read the rebuilt response' }),
    )
    expect(useAppStore.getState().speakingMessageId).toBe(assistant.id)
    useAppStore.getState().stopSpeakingMessage()
  })

  it.each([
    {
      label: 'content',
      update: (current: ChatMessage) => {
        current.content = 'A newer response'
      },
    },
    {
      label: 'role',
      update: (current: ChatMessage) => {
        current.role = 'user'
      },
    },
    {
      label: 'createdAt',
      update: (current: ChatMessage) => {
        current.createdAt += 1
      },
    },
  ])(
    'keeps current speech when a same-id $label change rejects a stale read-aloud request',
    async ({ update }) => {
      const data = resetStore()
      const assistant = message(
        'assistant-speech-stale-snapshot',
        'assistant',
        'Keep reading this response',
      )
      withMessages(data, [assistant])
      const audio = {
        onended: null as (() => void) | null,
        onerror: null as (() => void) | null,
        pause: vi.fn(),
        play: vi.fn(async () => undefined),
      }
      vi.stubGlobal('Audio', vi.fn(function AudioMock() {
        return audio
      }))
      vi.stubGlobal('URL', {
        createObjectURL: vi.fn(() => 'blob:stale-snapshot-speech'),
        revokeObjectURL: vi.fn(),
      })
      runtime.synthesizeSpeechAudio.mockResolvedValueOnce({
        blob: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
        model: 'speech-model',
      })

      await useAppStore.getState().speakMessage(assistant)
      runtime.synthesizeSpeechAudio.mockClear()

      const changedData = structuredClone(useAppStore.getState().data)
      const current = changedData?.conversations[0]?.messages.find(
        (candidate) => candidate.id === assistant.id,
      )
      if (!current) {
        throw new Error('speech test message missing from rebuilt snapshot')
      }
      update(current)
      useAppStore.setState({ data: changedData })

      await useAppStore.getState().speakMessage(assistant)

      expect(runtime.synthesizeSpeechAudio).not.toHaveBeenCalled()
      expect(audio.pause).not.toHaveBeenCalled()
      expect(useAppStore.getState().speakingMessageId).toBe(assistant.id)
      useAppStore.getState().stopSpeakingMessage()
    },
  )

  it('does not stop current speech when an invalid read-aloud request is rejected', async () => {
    const data = resetStore()
    const assistant = message('assistant-speech-owner', 'assistant', 'Keep reading this')
    const user = message('user-speech-invalid', 'user', 'This cannot be read aloud')
    withMessages(data, [user, assistant])

    const audio = {
      onended: null as (() => void) | null,
      onerror: null as (() => void) | null,
      pause: vi.fn(),
      play: vi.fn(async () => undefined),
    }
    vi.stubGlobal('Audio', vi.fn(function AudioMock() {
      return audio
    }))
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:invalid-read-request'),
      revokeObjectURL: vi.fn(),
    })
    runtime.synthesizeSpeechAudio.mockResolvedValueOnce({
      blob: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
      model: 'speech-model',
    })

    await useAppStore.getState().speakMessage(assistant)
    expect(useAppStore.getState().speakingMessageId).toBe(assistant.id)

    await useAppStore.getState().speakMessage(user)

    expect(audio.pause).not.toHaveBeenCalled()
    expect(useAppStore.getState().speakingMessageId).toBe(assistant.id)
    expect(runtime.synthesizeSpeechAudio).toHaveBeenCalledOnce()
    useAppStore.getState().stopSpeakingMessage()
  })

  it('does not stop current speech when a read-aloud request lacks its browser key', async () => {
    const data = resetStore()
    const current = message('assistant-speech-key-owner', 'assistant', 'Keep this playing')
    const missingKey = message('assistant-speech-key-missing', 'assistant', 'Missing key')
    withMessages(data, [current, missingKey])

    const audio = {
      onended: null as (() => void) | null,
      onerror: null as (() => void) | null,
      pause: vi.fn(),
      play: vi.fn(async () => undefined),
    }
    vi.stubGlobal('Audio', vi.fn(function AudioMock() {
      return audio
    }))
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:missing-key-read-request'),
      revokeObjectURL: vi.fn(),
    })
    runtime.synthesizeSpeechAudio.mockResolvedValueOnce({
      blob: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
      model: 'speech-model',
    })

    await useAppStore.getState().speakMessage(current)
    useAppStore.setState({ keys: {} })
    await useAppStore.getState().speakMessage(missingKey)

    expect(audio.pause).not.toHaveBeenCalled()
    expect(useAppStore.getState().speakingMessageId).toBe(current.id)
    expect(runtime.synthesizeSpeechAudio).toHaveBeenCalledOnce()
    useAppStore.getState().stopSpeakingMessage()
  })

  it('does not stop current speech when a proxied read-aloud request lacks its passphrase', async () => {
    const data = freshData()
    const provider = data.providers[0]
    data.providers[0] = {
      ...provider,
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    const current = message('assistant-speech-passphrase-owner', 'assistant', 'Keep this proxy read playing')
    const missingPassphrase = message(
      'assistant-speech-passphrase-missing',
      'assistant',
      'Missing passphrase',
    )
    resetStore(data)
    withMessages(data, [current, missingPassphrase])
    useAppStore.setState({ syncPassphrase: 'valid-passphrase' })

    const audio = {
      onended: null as (() => void) | null,
      onerror: null as (() => void) | null,
      pause: vi.fn(),
      play: vi.fn(async () => undefined),
    }
    vi.stubGlobal('Audio', vi.fn(function AudioMock() {
      return audio
    }))
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:missing-passphrase-read-request'),
      revokeObjectURL: vi.fn(),
    })
    runtime.synthesizeSpeechAudio.mockResolvedValueOnce({
      blob: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
      model: 'speech-model',
    })

    await useAppStore.getState().speakMessage(current)
    expect(runtime.synthesizeSpeechAudio).toHaveBeenCalledOnce()
    expect(useAppStore.getState().speakingMessageId).toBe(current.id)
    useAppStore.setState({ syncPassphrase: '' })
    await useAppStore.getState().speakMessage(missingPassphrase)

    expect(audio.pause).not.toHaveBeenCalled()
    expect(useAppStore.getState().speakingMessageId).toBe(current.id)
    expect(runtime.synthesizeSpeechAudio).toHaveBeenCalledOnce()
    useAppStore.getState().stopSpeakingMessage()
  })

  it('contains read-aloud notification failures at the action boundary', async () => {
    resetStore()
    const user = message('user-speech-notice', 'user', 'Do not read this')
    useAppStore.setState({
      notify: () => {
        throw new Error('notification channel unavailable')
      },
    })

    await expect(useAppStore.getState().speakMessage(user)).resolves.toBeUndefined()

    expect(runtime.synthesizeSpeechAudio).not.toHaveBeenCalled()
    expect(useAppStore.getState().speakingMessageId).toBe('')
  })

  it('retries a transient speech failure through the shared generation runtime', async () => {
    stubGenerationRetryTimers()
    const data = resetStore()
    const assistant = message('assistant-speech-retry', 'assistant', 'Read after retry')
    withMessages(data, [assistant])
    const audio = {
      onended: null as (() => void) | null,
      onerror: null as (() => void) | null,
      pause: vi.fn(),
      play: vi.fn(async () => undefined),
    }
    vi.stubGlobal('Audio', vi.fn(function AudioMock() {
      return audio
    }))
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:speech-retry'),
      revokeObjectURL: vi.fn(),
    })
    runtime.synthesizeSpeechAudio
      .mockRejectedValueOnce(
        Object.assign(new Error('temporary speech failure'), { retryable: true }),
      )
      .mockResolvedValueOnce({
        blob: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
        model: 'speech-model',
      })

    const playback = useAppStore.getState().speakMessage(assistant)
    await vi.waitFor(() =>
      expect(runtime.synthesizeSpeechAudio).toHaveBeenCalledTimes(1),
    )
    await vi.advanceTimersByTimeAsync(400)
    await playback

    expect(runtime.synthesizeSpeechAudio).toHaveBeenCalledTimes(2)
    expect(audio.play).toHaveBeenCalledOnce()
    expect(useAppStore.getState().speakingMessageId).toBe(assistant.id)
  })

  it('contains speech object URL cleanup failures without leaving playback state stuck', async () => {
    const data = resetStore()
    const assistant = message(
      'assistant-speech-cleanup',
      'assistant',
      'Read and release this response',
    )
    withMessages(data, [assistant])
    const audio = {
      onended: null as (() => void) | null,
      onerror: null as (() => void) | null,
      pause: vi.fn(),
      play: vi.fn(async () => undefined),
    }
    const cleanupFailure = new Error('object URL cleanup failed')
    const revokeObjectURL = vi.fn(() => {
      throw cleanupFailure
    })
    vi.stubGlobal('Audio', vi.fn(function AudioMock() {
      return audio
    }))
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:cleanup-failure'),
      revokeObjectURL,
    })
    runtime.synthesizeSpeechAudio.mockResolvedValue({
      blob: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
      model: 'speech-model',
    })

    await useAppStore.getState().speakMessage(assistant)
    expect(useAppStore.getState().speakingMessageId).toBe(assistant.id)

    expect(() => useAppStore.getState().stopSpeakingMessage()).not.toThrow()
    expect(audio.pause).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:cleanup-failure')
    expect(useAppStore.getState().speakingMessageId).toBe('')
  })

  it('contains stopped-speech notification failures after playback state is cleared', () => {
    resetStore()
    useAppStore.setState({
      speakingMessageId: 'stopped-message',
      notify: () => {
        throw new Error('notification channel unavailable')
      },
    })

    expect(() => useAppStore.getState().stopSpeakingMessage()).not.toThrow()
    expect(useAppStore.getState().speakingMessageId).toBe('')
  })

  it('invalidates pending read-aloud ownership when the target message is deleted', async () => {
    const data = resetStore()
    const assistant = message('assistant-speech-stale', 'assistant', 'Pending speech')
    withMessages(data, [assistant])

    let resolveSpeech: ((value: { blob: Blob; model: string }) => void) | undefined
    runtime.synthesizeSpeechAudio.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSpeech = resolve
        }),
    )
    const AudioMock = vi.fn(function AudioMock() {
      return { pause: vi.fn(), play: vi.fn(async () => undefined) }
    })
    vi.stubGlobal('Audio', AudioMock)
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:stale-speech'),
      revokeObjectURL: vi.fn(),
    })

    const running = useAppStore.getState().speakMessage(assistant)
    await Promise.resolve()
    const signal = runtime.synthesizeSpeechAudio.mock.calls[0]?.[0]?.signal as
      | AbortSignal
      | undefined
    expect(useAppStore.getState().speakingMessageId).toBe(assistant.id)

    await useAppStore.getState().deleteMessage(assistant.id)
    expect(signal?.aborted).toBe(true)
    expect(useAppStore.getState().speakingMessageId).toBe('')

    resolveSpeech?.({ blob: new Blob([new Uint8Array([1])]), model: 'speech-model' })
    await running
    expect(AudioMock).not.toHaveBeenCalled()
  })

  it('invalidates pending read-aloud when the active Provider key changes', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const assistant = message(
      'assistant-speech-provider-key-stale',
      'assistant',
      'Do not play with stale credentials',
    )
    withMessages(data, [assistant])
    useAppStore.setState({ keys: { [providerId]: 'old-provider-key' } })

    let resolveSpeech: ((value: { blob: Blob; model: string }) => void) | undefined
    runtime.synthesizeSpeechAudio.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSpeech = resolve
        }),
    )
    const AudioMock = vi.fn(function AudioMock() {
      return { pause: vi.fn(), play: vi.fn(async () => undefined) }
    })
    vi.stubGlobal('Audio', AudioMock)
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:stale-provider-speech'),
      revokeObjectURL: vi.fn(),
    })

    const running = useAppStore.getState().speakMessage(assistant)
    await vi.waitFor(() =>
      expect(runtime.synthesizeSpeechAudio).toHaveBeenCalledOnce(),
    )
    const signal = runtime.synthesizeSpeechAudio.mock.calls[0]?.[0]?.signal as
      | AbortSignal
      | undefined

    await useAppStore.getState().saveProviderKey(providerId, 'new-provider-key')

    expect(signal?.aborted).toBe(true)
    resolveSpeech?.({
      blob: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
      model: 'speech-model',
    })
    await running
    expect(AudioMock).not.toHaveBeenCalled()
    expect(useAppStore.getState().speakingMessageId).toBe('')
    expect(useAppStore.getState().toasts).toHaveLength(0)
  })

  it('keeps pending read-aloud when the normalized Provider key is unchanged', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const assistant = message(
      'assistant-speech-provider-key-unchanged',
      'assistant',
      'Keep playing with the same credentials',
    )
    withMessages(data, [assistant])
    useAppStore.setState({ keys: { [providerId]: 'same-provider-key' } })
    let resolveSpeech: ((value: { blob: Blob; model: string }) => void) | undefined
    runtime.synthesizeSpeechAudio.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSpeech = resolve
        }),
    )
    const audio = {
      pause: vi.fn(),
      play: vi.fn(async () => undefined),
    }
    const AudioMock = vi.fn(function AudioMock() {
      return audio
    })
    vi.stubGlobal('Audio', AudioMock)
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:unchanged-provider-key-speech'),
      revokeObjectURL: vi.fn(),
    })

    const running = useAppStore.getState().speakMessage(assistant)
    await vi.waitFor(() =>
      expect(runtime.synthesizeSpeechAudio).toHaveBeenCalledOnce(),
    )
    const signal = runtime.synthesizeSpeechAudio.mock.calls[0]?.[0]?.signal as
      | AbortSignal
      | undefined

    await useAppStore
      .getState()
      .saveProviderKey(providerId, '  same-provider-key  ')

    expect(signal?.aborted).toBe(false)
    resolveSpeech?.({
      blob: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
      model: 'speech-model',
    })
    await running
    expect(AudioMock).toHaveBeenCalledOnce()
    expect(audio.play).toHaveBeenCalledOnce()
    expect(useAppStore.getState().speakingMessageId).toBe(assistant.id)
  })

  it('invalidates pending read-aloud when the active Provider configuration changes', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const assistant = message(
      'assistant-speech-provider-config-stale',
      'assistant',
      'Do not play after a Provider switch',
    )
    withMessages(data, [assistant])
    let resolveSpeech: ((value: { blob: Blob; model: string }) => void) | undefined
    runtime.synthesizeSpeechAudio.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSpeech = resolve
        }),
    )
    const AudioMock = vi.fn(function AudioMock() {
      return { pause: vi.fn(), play: vi.fn(async () => undefined) }
    })
    vi.stubGlobal('Audio', AudioMock)
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:stale-provider-config-speech'),
      revokeObjectURL: vi.fn(),
    })

    const running = useAppStore.getState().speakMessage(assistant)
    await vi.waitFor(() =>
      expect(runtime.synthesizeSpeechAudio).toHaveBeenCalledOnce(),
    )
    const signal = runtime.synthesizeSpeechAudio.mock.calls[0]?.[0]?.signal as
      | AbortSignal
      | undefined

    useAppStore.getState().updateProvider(providerId, {
      baseUrl: 'https://replacement.invalid/v1',
    })

    expect(signal?.aborted).toBe(true)
    resolveSpeech?.({
      blob: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
      model: 'speech-model',
    })
    await running
    expect(AudioMock).not.toHaveBeenCalled()
    expect(useAppStore.getState().speakingMessageId).toBe('')
  })

  it('keeps pending read-aloud when only Provider display metadata changes', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const assistant = message(
      'assistant-speech-provider-metadata',
      'assistant',
      'Keep playing after a display-name edit',
    )
    withMessages(data, [assistant])
    let resolveSpeech: ((value: { blob: Blob; model: string }) => void) | undefined
    runtime.synthesizeSpeechAudio.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSpeech = resolve
        }),
    )
    const audio = {
      pause: vi.fn(),
      play: vi.fn(async () => undefined),
    }
    const AudioMock = vi.fn(function AudioMock() {
      return audio
    })
    vi.stubGlobal('Audio', AudioMock)
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:provider-metadata-speech'),
      revokeObjectURL: vi.fn(),
    })

    const running = useAppStore.getState().speakMessage(assistant)
    await vi.waitFor(() =>
      expect(runtime.synthesizeSpeechAudio).toHaveBeenCalledOnce(),
    )
    const signal = runtime.synthesizeSpeechAudio.mock.calls[0]?.[0]?.signal as
      | AbortSignal
      | undefined

    useAppStore.getState().updateProvider(providerId, { name: 'Renamed Provider' })

    expect(signal?.aborted).toBe(false)
    resolveSpeech?.({
      blob: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
      model: 'speech-model',
    })
    await running
    expect(AudioMock).toHaveBeenCalledOnce()
    expect(audio.play).toHaveBeenCalledOnce()
    expect(useAppStore.getState().speakingMessageId).toBe(assistant.id)
  })

  it('invalidates pending read-aloud when the resolved speech model changes with the catalog', async () => {
    const data = freshData()
    const providerId = data.providers[0].id
    data.providers[0] = {
      ...data.providers[0],
      audioSpeechModel: undefined,
      models: ['tts-1'],
    }
    const assistant = message(
      'assistant-speech-catalog-change',
      'assistant',
      'Do not play with the old resolved model',
    )
    data.conversations[0] = {
      ...data.conversations[0],
      messages: [assistant],
    }
    resetStore(data)
    let resolveSpeech: ((value: { blob: Blob; model: string }) => void) | undefined
    runtime.synthesizeSpeechAudio.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSpeech = resolve
        }),
    )
    const AudioMock = vi.fn(function AudioMock() {
      return { pause: vi.fn(), play: vi.fn(async () => undefined) }
    })
    vi.stubGlobal('Audio', AudioMock)
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:stale-speech-catalog'),
      revokeObjectURL: vi.fn(),
    })

    const running = useAppStore.getState().speakMessage(assistant)
    await vi.waitFor(() =>
      expect(runtime.synthesizeSpeechAudio).toHaveBeenCalledOnce(),
    )
    const signal = runtime.synthesizeSpeechAudio.mock.calls[0]?.[0]?.signal as
      | AbortSignal
      | undefined

    useAppStore.getState().updateProvider(providerId, {
      models: ['gpt-4o-mini-tts', 'tts-1'],
    })

    expect(signal?.aborted).toBe(true)
    resolveSpeech?.({
      blob: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
      model: 'tts-1',
    })
    await running
    expect(AudioMock).not.toHaveBeenCalled()
    expect(useAppStore.getState().speakingMessageId).toBe('')
  })

  it('keeps pending read-aloud when only the transcription model changes', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const assistant = message(
      'assistant-speech-transcription-model-change',
      'assistant',
      'Keep playing through a transcription-only edit',
    )
    withMessages(data, [assistant])
    let resolveSpeech: ((value: { blob: Blob; model: string }) => void) | undefined
    runtime.synthesizeSpeechAudio.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSpeech = resolve
        }),
    )
    const audio = {
      pause: vi.fn(),
      play: vi.fn(async () => undefined),
    }
    const AudioMock = vi.fn(function AudioMock() {
      return audio
    })
    vi.stubGlobal('Audio', AudioMock)
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:transcription-model-speech'),
      revokeObjectURL: vi.fn(),
    })

    const running = useAppStore.getState().speakMessage(assistant)
    await vi.waitFor(() =>
      expect(runtime.synthesizeSpeechAudio).toHaveBeenCalledOnce(),
    )
    const signal = runtime.synthesizeSpeechAudio.mock.calls[0]?.[0]?.signal as
      | AbortSignal
      | undefined

    useAppStore.getState().updateProvider(providerId, {
      audioTranscriptionModel: 'whisper-1',
    })

    expect(signal?.aborted).toBe(false)
    resolveSpeech?.({
      blob: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
      model: 'speech-model',
    })
    await running
    expect(AudioMock).toHaveBeenCalledOnce()
    expect(audio.play).toHaveBeenCalledOnce()
    expect(useAppStore.getState().speakingMessageId).toBe(assistant.id)
  })

  it('clears pending read-aloud ownership when a new conversation becomes active', async () => {
    const data = resetStore()
    const assistant = message(
      'assistant-speech-new-conversation',
      'assistant',
      'Do not keep playing in another conversation',
    )
    withMessages(data, [assistant])
    let resolveSpeech: ((value: { blob: Blob; model: string }) => void) | undefined
    runtime.synthesizeSpeechAudio.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSpeech = resolve
        }),
    )
    const AudioMock = vi.fn(function AudioMock() {
      return { pause: vi.fn(), play: vi.fn(async () => undefined) }
    })
    vi.stubGlobal('Audio', AudioMock)
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:new-conversation-stale-speech'),
      revokeObjectURL: vi.fn(),
    })

    const running = useAppStore.getState().speakMessage(assistant)
    await vi.waitFor(() =>
      expect(runtime.synthesizeSpeechAudio).toHaveBeenCalledOnce(),
    )
    const signal = runtime.synthesizeSpeechAudio.mock.calls[0]?.[0]?.signal as
      | AbortSignal
      | undefined

    await useAppStore.getState().createNewConversation()

    expect(signal?.aborted).toBe(true)
    expect(useAppStore.getState().speakingMessageId).toBe('')
    resolveSpeech?.({
      blob: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
      model: 'speech-model',
    })
    await running
    expect(AudioMock).not.toHaveBeenCalled()
  })

  it('drops proxy read-aloud work when the active conversation changes during derivation', async () => {
    const data = freshData()
    const provider = data.providers[0]
    const first = data.conversations[0]
    const second: Conversation = {
      ...structuredClone(first),
      id: 'speech-second-conversation',
      title: 'Second conversation',
    }
    data.conversations = [first, second]
    data.providers[0] = {
      ...provider,
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    const assistant = message('proxy-speech-stale', 'assistant', 'Read this later')
    first.messages = [assistant]
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'speech-passphrase' })

    let rejectDerivation!: (error: unknown) => void
    accessKeyMocks.accessKeyFromPassword.mockImplementationOnce(
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectDerivation = reject
        }),
    )

    const playback = useAppStore.getState().speakMessage(assistant)
    await vi.waitFor(() =>
      expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledWith(
        'speech-passphrase',
      ),
    )
    await useAppStore.getState().setActiveConversation(second.id)
    rejectDerivation(new Error('stale speech derivation failure'))

    await playback
    expect(runtime.synthesizeSpeechAudio).not.toHaveBeenCalled()
    expect(useAppStore.getState().speakingMessageId).toBe('')
    expect(useAppStore.getState().toasts).toHaveLength(0)
  })

  it('does not let a superseded proxy read-aloud request reach synthesis', async () => {
    const data = freshData()
    const provider = data.providers[0]
    data.providers[0] = {
      ...provider,
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    const first = message('proxy-speech-first', 'assistant', 'Read first')
    const second = message('proxy-speech-second', 'assistant', 'Read second')
    data.conversations[0] = {
      ...data.conversations[0],
      messages: [first, second],
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'speech-passphrase' })

    let resolveFirst!: (value: string) => void
    let resolveSecond!: (value: string) => void
    accessKeyMocks.accessKeyFromPassword
      .mockImplementationOnce(
        () => new Promise<string>((resolve) => { resolveFirst = resolve }),
      )
      .mockImplementationOnce(
        () => new Promise<string>((resolve) => { resolveSecond = resolve }),
      )
    const audio = {
      onended: null as (() => void) | null,
      onerror: null as (() => void) | null,
      pause: vi.fn(),
      play: vi.fn(async () => undefined),
    }
    vi.stubGlobal('Audio', vi.fn(function AudioMock() { return audio }))
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:proxy-speech'),
      revokeObjectURL: vi.fn(),
    })
    runtime.synthesizeSpeechAudio.mockResolvedValue({
      blob: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
      model: 'speech-model',
    })

    const firstRun = useAppStore.getState().speakMessage(first)
    await vi.waitFor(() =>
      expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledOnce(),
    )
    const secondRun = useAppStore.getState().speakMessage(second)
    await vi.waitFor(() =>
      expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledTimes(2),
    )

    resolveFirst('first-token')
    resolveSecond('second-token')
    await Promise.all([firstRun, secondRun])

    expect(runtime.synthesizeSpeechAudio).toHaveBeenCalledOnce()
    expect(runtime.synthesizeSpeechAudio).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Read second' }),
    )
    expect(useAppStore.getState().speakingMessageId).toBe(second.id)
  })

  it('transcribes supported audio through the current store without leaking failures', async () => {
    const data = resetStore()
    const file = new File([new Uint8Array([1, 2, 3])], 'voice.wav', {
      type: 'audio/wav',
    })
    runtime.transcribeAudioFile.mockResolvedValueOnce({
      model: 'transcription-model',
      text: 'transcribed text',
    })

    await expect(useAppStore.getState().transcribeAudio(file)).resolves.toBe(
      'transcribed text',
    )
    expect(runtime.transcribeAudioFile).toHaveBeenCalledWith(
      expect.objectContaining({ file }),
    )
    expect(accessKeyMocks.accessKeyFromPassword).not.toHaveBeenCalled()
    expect(useAppStore.getState().transcribingAudio).toBe(false)

    const sentinel = 'C:\\private\\audio-transcription-secret-token'
    runtime.transcribeAudioFile.mockRejectedValueOnce(new Error(sentinel))
    await expect(useAppStore.getState().transcribeAudio(file)).resolves.toBeNull()
    const failure = useAppStore.getState().toasts.at(-1)?.message ?? ''
    expect(failure).toBe(appT(data, 'composer.audioTranscriptionFailed'))
    expect(failure).not.toContain(sentinel)
    expect(useAppStore.getState().transcribingAudio).toBe(false)

    runtime.transcribeAudioFile.mockClear()
    vi.stubGlobal('navigator', { language: 'en-US', onLine: false })
    await expect(useAppStore.getState().transcribeAudio(file)).resolves.toBeNull()
    expect(runtime.transcribeAudioFile).not.toHaveBeenCalled()
  })

  it('rejects audio transcription before runtime admission when the browser key is missing', async () => {
    const data = resetStore()
    useAppStore.setState({ keys: {} })

    await expect(
      useAppStore.getState().transcribeAudio(
        new File(['audio'], 'missing-key.wav', { type: 'audio/wav' }),
      ),
    ).resolves.toBeNull()

    expect(runtime.transcribeAudioFile).not.toHaveBeenCalled()
    expect(useAppStore.getState().transcribingAudio).toBe(false)
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: appT(data, 'error.providerKeyRequired'),
      tone: 'error',
    })
  })

  it('contains audio transcription notices when no Provider is configured', async () => {
    const data = freshData()
    data.providers = []
    data.conversations = []
    data.preferences.activeConversationId = undefined
    resetStore(data)
    useAppStore.setState({
      notify: () => {
        throw new Error('notification channel unavailable')
      },
    })

    await expect(
      useAppStore
        .getState()
        .transcribeAudio(new File(['audio'], 'clip.webm', { type: 'audio/webm' })),
    ).resolves.toBeNull()

    expect(useAppStore.getState().transcribingAudio).toBe(false)
    expect(useAppStore.getState().data).toBe(data)
  })

  it('admits only one proxied audio transcription before access-key derivation settles', async () => {
    const data = freshData()
    data.providers[0] = {
      ...data.providers[0],
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'proxy-passphrase' })
    let finishDerivation!: (token: string) => void
    accessKeyMocks.accessKeyFromPassword.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishDerivation = resolve
        }),
    )
    runtime.transcribeAudioFile.mockResolvedValueOnce({
      model: 'transcription-model',
      text: 'first transcript',
    })
    const firstFile = new File(['first'], 'first.webm', { type: 'audio/webm' })
    const secondFile = new File(['second'], 'second.webm', {
      type: 'audio/webm',
    })

    const first = useAppStore.getState().transcribeAudio(firstFile)
    await vi.waitFor(() =>
      expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledOnce(),
    )
    expect(useAppStore.getState().transcribingAudio).toBe(true)

    await expect(
      useAppStore.getState().transcribeAudio(secondFile),
    ).resolves.toBeNull()
    expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledOnce()

    finishDerivation('proxy-token')
    await expect(first).resolves.toBe('first transcript')
    expect(runtime.transcribeAudioFile).toHaveBeenCalledOnce()
    expect(runtime.transcribeAudioFile).toHaveBeenCalledWith(
      expect.objectContaining({ file: firstFile, proxyToken: 'proxy-token' }),
    )
    expect(useAppStore.getState().transcribingAudio).toBe(false)
  })

  it('stops proxied audio transcription while access-key derivation is pending', async () => {
    const data = freshData()
    data.providers[0] = {
      ...data.providers[0],
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'proxy-passphrase' })
    let finishDerivation!: (token: string) => void
    accessKeyMocks.accessKeyFromPassword.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishDerivation = resolve
        }),
    )
    const file = new File(['pending'], 'pending.webm', { type: 'audio/webm' })

    const pending = useAppStore.getState().transcribeAudio(file)
    await vi.waitFor(() =>
      expect(accessKeyMocks.accessKeyFromPassword).toHaveBeenCalledOnce(),
    )
    expect(useAppStore.getState().transcribingAudio).toBe(true)

    useAppStore.getState().stopAudioTranscription()
    expect(useAppStore.getState().transcribingAudio).toBe(false)
    finishDerivation('unused-proxy-token')

    await expect(pending).resolves.toBeNull()
    expect(runtime.transcribeAudioFile).not.toHaveBeenCalled()
    expect(useAppStore.getState().toasts).toHaveLength(0)
  })

  it('ignores a late audio transcript after stop when the Provider ignores abort', async () => {
    resetStore()
    let finishTranscription!: (value: { model: string; text: string }) => void
    runtime.transcribeAudioFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishTranscription = resolve
        }),
    )
    const file = new File(['pending'], 'pending.wav', { type: 'audio/wav' })

    const pending = useAppStore.getState().transcribeAudio(file)
    await vi.waitFor(() =>
      expect(runtime.transcribeAudioFile).toHaveBeenCalledOnce(),
    )
    const signal = runtime.transcribeAudioFile.mock.calls[0]?.[0]?.signal as
      | AbortSignal
      | undefined
    expect(signal?.aborted).toBe(false)

    useAppStore.getState().stopAudioTranscription()
    expect(signal?.aborted).toBe(true)
    finishTranscription({
      model: 'transcription-model',
      text: 'stale transcript',
    })

    await expect(pending).resolves.toBeNull()
    expect(useAppStore.getState().transcribingAudio).toBe(false)
    expect(useAppStore.getState().toasts).toHaveLength(0)
  })

  it.each(['success', 'error'] as const)(
    'keeps a stopped audio transcription from affecting a replacement request (%s)',
    async (lateOutcome) => {
      resetStore()
      let resolveFirst:
        | ((value: { model: string; text: string }) => void)
        | undefined
      let rejectFirst: ((error: Error) => void) | undefined
      runtime.transcribeAudioFile.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            resolveFirst = resolve
            rejectFirst = reject
          }),
      )
      const firstFile = new File(['first'], 'first.wav', { type: 'audio/wav' })
      const secondFile = new File(['second'], 'second.wav', { type: 'audio/wav' })

      const first = useAppStore.getState().transcribeAudio(firstFile)
      await vi.waitFor(() =>
        expect(runtime.transcribeAudioFile).toHaveBeenCalledOnce(),
      )
      const firstSignal = runtime.transcribeAudioFile.mock.calls[0]?.[0]?.signal as
        | AbortSignal
        | undefined

      useAppStore.getState().stopAudioTranscription()
      expect(firstSignal?.aborted).toBe(true)

      let resolveSecond!: (value: { model: string; text: string }) => void
      runtime.transcribeAudioFile.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve
          }),
      )
      const second = useAppStore.getState().transcribeAudio(secondFile)
      await vi.waitFor(() =>
        expect(runtime.transcribeAudioFile).toHaveBeenCalledTimes(2),
      )
      const secondSignal = runtime.transcribeAudioFile.mock.calls[1]?.[0]?.signal as
        | AbortSignal
        | undefined
      expect(secondSignal?.aborted).toBe(false)
      expect(useAppStore.getState().transcribingAudio).toBe(true)

      if (lateOutcome === 'success') {
        resolveFirst?.({ model: 'transcription-model', text: 'stale transcript' })
      } else {
        rejectFirst?.(new Error('stale transcription failure'))
      }
      await expect(first).resolves.toBeNull()
      expect(secondSignal?.aborted).toBe(false)
      expect(useAppStore.getState().transcribingAudio).toBe(true)
      expect(useAppStore.getState().toasts).toHaveLength(0)

      resolveSecond({ model: 'transcription-model', text: 'fresh transcript' })
      await expect(second).resolves.toBe('fresh transcript')
      expect(useAppStore.getState().transcribingAudio).toBe(false)
      expect(useAppStore.getState().toasts).toHaveLength(1)
    },
  )

  it('invalidates pending audio transcription when the active Provider key changes', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    useAppStore.setState({ keys: { [providerId]: 'old-provider-key' } })
    let resolveTranscription:
      | ((value: { model: string; text: string }) => void)
      | undefined
    runtime.transcribeAudioFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTranscription = resolve
        }),
    )
    const file = new File(['pending'], 'provider-key-stale.wav', {
      type: 'audio/wav',
    })

    const pending = useAppStore.getState().transcribeAudio(file)
    await vi.waitFor(() =>
      expect(runtime.transcribeAudioFile).toHaveBeenCalledOnce(),
    )
    const signal = runtime.transcribeAudioFile.mock.calls[0]?.[0]?.signal as
      | AbortSignal
      | undefined

    await useAppStore.getState().saveProviderKey(providerId, 'new-provider-key')

    expect(signal?.aborted).toBe(true)
    resolveTranscription?.({
      model: 'transcription-model',
      text: 'stale provider transcript',
    })
    await expect(pending).resolves.toBeNull()
    expect(useAppStore.getState().transcribingAudio).toBe(false)
    expect(useAppStore.getState().toasts).toHaveLength(0)
  })

  it('invalidates pending proxied audio transcription when the sync passphrase changes', async () => {
    const data = freshData()
    data.providers[0] = {
      ...data.providers[0],
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'old-passphrase' })
    let resolveTranscription:
      | ((value: { model: string; text: string }) => void)
      | undefined
    runtime.transcribeAudioFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTranscription = resolve
        }),
    )
    const file = new File(['pending'], 'proxy-passphrase-stale.wav', {
      type: 'audio/wav',
    })

    const pending = useAppStore.getState().transcribeAudio(file)
    await vi.waitFor(() =>
      expect(runtime.transcribeAudioFile).toHaveBeenCalledOnce(),
    )
    const signal = runtime.transcribeAudioFile.mock.calls[0]?.[0]?.signal as
      | AbortSignal
      | undefined

    await useAppStore.getState().setSyncPassphrase('new-passphrase')

    expect(signal?.aborted).toBe(true)
    resolveTranscription?.({
      model: 'transcription-model',
      text: 'stale proxy transcript',
    })
    await expect(pending).resolves.toBeNull()
    expect(useAppStore.getState().transcribingAudio).toBe(false)
    expect(useAppStore.getState().toasts).toHaveLength(0)
  })

  it('invalidates pending proxied audio transcription when the Worker endpoint changes', async () => {
    const data = freshData()
    data.providers[0] = {
      ...data.providers[0],
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: undefined,
    }
    data.sync = {
      ...data.sync,
      mode: 'cloudflare',
      workerEndpoint: 'https://worker-a.invalid',
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'proxy-passphrase' })
    let resolveTranscription:
      | ((value: { model: string; text: string }) => void)
      | undefined
    runtime.transcribeAudioFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTranscription = resolve
        }),
    )

    const pending = useAppStore
      .getState()
      .transcribeAudio(new File(['audio'], 'worker-change.wav', { type: 'audio/wav' }))
    await vi.waitFor(() =>
      expect(runtime.transcribeAudioFile).toHaveBeenCalledOnce(),
    )
    const signal = runtime.transcribeAudioFile.mock.calls[0]?.[0]?.signal as
      | AbortSignal
      | undefined

    useAppStore
      .getState()
      .setSyncWorkerEndpoint('https://worker-b.invalid')

    expect(signal?.aborted).toBe(true)
    resolveTranscription?.({
      model: 'transcription-model',
      text: 'stale worker transcript',
    })
    await expect(pending).resolves.toBeNull()
    expect(useAppStore.getState().transcribingAudio).toBe(false)
    expect(useAppStore.getState().toasts).toHaveLength(0)
  })

  it('retries a transient audio transcription failure through the shared generation runtime', async () => {
    stubGenerationRetryTimers()
    resetStore()
    const file = new File([new Uint8Array([1, 2, 3])], 'retry.wav', {
      type: 'audio/wav',
    })
    runtime.transcribeAudioFile
      .mockRejectedValueOnce(
        Object.assign(new Error('temporary transcription failure'), {
          retryable: true,
        }),
      )
      .mockResolvedValueOnce({
        model: 'transcription-model',
        text: 'transcribed after retry',
      })

    const transcription = useAppStore.getState().transcribeAudio(file)
    await vi.waitFor(() =>
      expect(runtime.transcribeAudioFile).toHaveBeenCalledTimes(1),
    )
    await vi.advanceTimersByTimeAsync(400)
    await expect(transcription).resolves.toBe('transcribed after retry')

    expect(runtime.transcribeAudioFile).toHaveBeenCalledTimes(2)
    expect(useAppStore.getState().transcribingAudio).toBe(false)
  })

  it('invalidates pending audio transcription when the active conversation changes', async () => {
    const data = resetStore()
    const first = data.conversations[0]
    const second: Conversation = {
      ...structuredClone(first),
      id: 'audio-transcription-second-conversation',
      title: 'Second conversation',
    }
    useAppStore.setState({
      data: {
        ...data,
        conversations: [first, second],
      },
    })

    let resolveTranscription:
      | ((value: { model: string; text: string }) => void)
      | undefined
    runtime.transcribeAudioFile.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          expect(signal.aborted).toBe(false)
          resolveTranscription = resolve
        }),
    )
    const file = new File([new Uint8Array([1, 2, 3])], 'pending.wav', {
      type: 'audio/wav',
    })

    const pending = useAppStore.getState().transcribeAudio(file)
    await vi.waitFor(() => {
      expect(useAppStore.getState().transcribingAudio).toBe(true)
      expect(runtime.transcribeAudioFile).toHaveBeenCalledTimes(1)
    })
    const signal = runtime.transcribeAudioFile.mock.calls[0]?.[0]?.signal as
      | AbortSignal
      | undefined

    await useAppStore.getState().setActiveConversation(second.id)

    expect(signal?.aborted).toBe(true)
    expect(useAppStore.getState().transcribingAudio).toBe(false)
    resolveTranscription?.({
      model: 'transcription-model',
      text: 'stale transcript',
    })
    await expect(pending).resolves.toBeNull()
    expect(useAppStore.getState().toasts).toHaveLength(0)
  })

  it('cancels pending audio transcription before a durable conversation switch settles', async () => {
    const data = resetStore()
    const first = data.conversations[0]
    const second: Conversation = {
      ...structuredClone(first),
      id: 'audio-switch-durable-second-conversation',
      title: 'Second conversation',
    }
    useAppStore.setState({
      data: {
        ...data,
        conversations: [first, second],
      },
    })

    let resolveTranscription:
      | ((value: { model: string; text: string }) => void)
      | undefined
    runtime.transcribeAudioFile.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          expect(signal.aborted).toBe(false)
          resolveTranscription = resolve
        }),
    )
    const file = new File([new Uint8Array([1, 2, 3])], 'switch.wav', {
      type: 'audio/wav',
    })
    const pending = useAppStore.getState().transcribeAudio(file)
    await vi.waitFor(() => {
      expect(useAppStore.getState().transcribingAudio).toBe(true)
      expect(runtime.transcribeAudioFile).toHaveBeenCalledTimes(1)
    })
    const signal = runtime.transcribeAudioFile.mock.calls[0]?.[0]?.signal as
      | AbortSignal
      | undefined

    let releaseSwitchSave!: () => void
    const switchSave = new Promise<void>((resolve) => {
      releaseSwitchSave = resolve
    })
    dbMocks.saveAppData.mockImplementation(async (snapshot: unknown) => {
      if (
        (snapshot as AppData).preferences.activeConversationId === second.id
      ) {
        await switchSave
      }
    })

    const switching = useAppStore.getState().setActiveConversation(second.id)
    await vi.waitFor(() =>
      expect(dbMocks.saveAppData).toHaveBeenCalledWith(
        expect.objectContaining({
          preferences: expect.objectContaining({
            activeConversationId: second.id,
          }),
        }),
      ),
    )

    expect(signal?.aborted).toBe(true)
    expect(useAppStore.getState().transcribingAudio).toBe(false)

    resolveTranscription?.({
      model: 'transcription-model',
      text: 'stale switch transcript',
    })
    releaseSwitchSave()
    await expect(pending).resolves.toBeNull()
    await switching
    dbMocks.saveAppData.mockResolvedValue(undefined)
  })

  it('does not cancel audio transcription when a rejected conversation switch is not admitted', async () => {
    const data = resetStore()
    const first = data.conversations[0]
    const second: Conversation = {
      ...structuredClone(first),
      id: 'audio-switch-rejected-conversation',
      title: 'Second conversation',
    }
    data.conversations.push(second)

    let resolveTranscription:
      | ((value: { model: string; text: string }) => void)
      | undefined
    runtime.transcribeAudioFile.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          expect(signal.aborted).toBe(false)
          resolveTranscription = resolve
        }),
    )
    const transcription = useAppStore.getState().transcribeAudio(
      new File([new Uint8Array([1, 2, 3])], 'rejected-switch.wav', {
        type: 'audio/wav',
      }),
    )
    await vi.waitFor(() => {
      expect(useAppStore.getState().transcribingAudio).toBe(true)
      expect(runtime.transcribeAudioFile).toHaveBeenCalledTimes(1)
    })
    const signal = runtime.transcribeAudioFile.mock.calls[0]?.[0]?.signal as
      | AbortSignal
      | undefined

    let releaseCreation!: () => void
    const pendingCreationSave = new Promise<void>((resolve) => {
      releaseCreation = resolve
    })
    dbMocks.saveAppData.mockImplementationOnce(async () => pendingCreationSave)
    const creation = useAppStore.getState().createNewConversation()
    await vi.waitFor(() => {
      expect(dbMocks.saveAppData).toHaveBeenCalledOnce()
      expect(useAppStore.getState().conversationMutationPending).toBe(true)
    })

    await expect(
      useAppStore.getState().setActiveConversation(second.id),
    ).resolves.toBe(false)
    expect(signal?.aborted).toBe(false)
    expect(useAppStore.getState().transcribingAudio).toBe(true)

    releaseCreation()
    await expect(creation).resolves.toBe(true)
    resolveTranscription?.({ model: 'transcription-model', text: 'stale' })
    await expect(transcription).resolves.toBeNull()
    expect(useAppStore.getState().transcribingAudio).toBe(false)
  })

  it('stores provider credentials and skill content through the state boundary', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    await useAppStore.getState().saveProviderKey(providerId, '  new-key  ')
    expect(secretMocks.setProviderKey).toHaveBeenCalledWith(providerId, 'new-key')
    expect(useAppStore.getState().keys[providerId]).toBe('new-key')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('  github-token  ')
    expect(useAppStore.getState()).toMatchObject({
      githubToken: 'github-token',
      syncPassphrase: 'passphrase',
    })

    const created = skill('created')
    const rebuilt = skill('rebuilt')
    const service = {
      createUserSkillFromContent: vi.fn(async () => created),
      createUserSkillFromFile: vi.fn(async () => skill('imported')),
      editableSkillContent: vi.fn(async () => 'skill body'),
    }
    lazyMocks.loadSkillService.mockResolvedValue(service)

    await useAppStore.getState().addSkill('', '')
    expect(useAppStore.getState().toasts.at(-1)?.tone).toBe('error')
    await useAppStore.getState().addSkill('Rules', 'Do the thing')
    expect(useAppStore.getState().data?.skills).toHaveLength(1)

    const skillId = useAppStore.getState().data?.skills[0].id ?? ''
    expect(await useAppStore.getState().loadSkillContent(skillId)).toBe('skill body')
    expect(await useAppStore.getState().loadSkillContent('missing')).toBe('')
    await useAppStore.getState().setSkillToggle(skillId, 'enabled', false)
    expect(useAppStore.getState().data?.skills[0].enabled).toBe(false)

    service.createUserSkillFromContent.mockResolvedValue(rebuilt)
    await useAppStore.getState().saveSkillContent(skillId, 'Updated', 'New body')
    expect(useAppStore.getState().data?.skills[0].name).toBe('rebuilt')
    await useAppStore.getState().saveSkillContent(skillId, '', '')
    expect(useAppStore.getState().toasts.at(-1)?.tone).toBe('error')

    await useAppStore.getState().importSkills([{ name: 'rules.md' } as File])
    expect(useAppStore.getState().data?.skills).toHaveLength(2)
    await useAppStore.getState().deleteSkill(skillId)
    expect(useAppStore.getState().data?.skills).toHaveLength(1)
  })

  it('returns false for empty Skill creation when notification delivery fails', async () => {
    const data = resetStore()
    const before = useAppStore.getState().data
    dbMocks.saveAppData.mockClear()
    useAppStore.setState({
      notify: () => {
        throw new Error('notification channel unavailable')
      },
    })

    await expect(useAppStore.getState().addSkill('', '')).resolves.toBe(false)

    expect(useAppStore.getState().data).toBe(before)
    expect(dbMocks.saveAppData).not.toHaveBeenCalled()
    expect(data.skills).toHaveLength(0)
  })

  it('returns false for empty Skill edits when notification delivery fails', async () => {
    const original = skill('original')
    const data = freshData()
    data.skills = [original]
    resetStore(data)
    const before = useAppStore.getState().data
    dbMocks.saveAppData.mockClear()
    useAppStore.setState({
      notify: () => {
        throw new Error('notification channel unavailable')
      },
    })

    await expect(
      useAppStore.getState().saveSkillContent(original.id, '', ''),
    ).resolves.toBe(false)

    expect(useAppStore.getState().data).toBe(before)
    expect(dbMocks.saveAppData).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.skills).toEqual([original])
  })

  it('keeps a new Provider credential unpublished when its durable write fails', async () => {
    const data = freshData()
    const providerId = data.providers[0]?.id ?? ''
    data.sync = { ...data.sync, autoSync: true, mode: 'gist' }
    resetStore(data)
    useAppStore.setState({
      githubToken: 'github-token',
      keys: {},
      syncPassphrase: 'passphrase',
    })
    const previousUpdatedAt = useAppStore.getState().data?.updatedAt
    secretMocks.setProviderKey.mockRejectedValueOnce(
      new Error('durable Provider credential write failed'),
    )

    await expect(
      useAppStore.getState().saveProviderKey(providerId, 'new-key'),
    ).rejects.toThrow('durable Provider credential write failed')

    expect(secretMocks.setProviderKey).toHaveBeenCalledWith(providerId, 'new-key')
    expect(useAppStore.getState().keys[providerId]).toBeUndefined()
    expect(useAppStore.getState().data?.updatedAt).toBe(previousUpdatedAt)
    expect(syncMocks.performSync).not.toHaveBeenCalled()
  })

  it('keeps an active generation when a Provider credential write fails', async () => {
    const data = resetStore()
    const providerId = data.providers[0]?.id ?? ''
    useAppStore.setState({ keys: { [providerId]: 'old-provider-key' } })

    let releaseStream!: () => void
    let streamSignal!: AbortSignal
    runtime.streamChat.mockImplementationOnce(
      async ({
        signal,
        onToken,
      }: {
        signal: AbortSignal
        onToken: (token: string) => void
      }) => {
        streamSignal = signal
        await new Promise<void>((resolve) => {
          releaseStream = resolve
        })
        onToken('continued')
      },
    )

    const sending = useAppStore.getState().sendMessage('keep this generation')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())

    const failure = new Error('Provider credential write failed')
    secretMocks.setProviderKey.mockRejectedValueOnce(failure)
    await expect(
      useAppStore.getState().saveProviderKey(providerId, 'new-provider-key'),
    ).rejects.toThrow('Provider credential write failed')

    expect(streamSignal.aborted).toBe(false)
    releaseStream()
    await expect(sending).resolves.toBe(true)
  })

  it('clamps global Skill matching settings at the store boundary', async () => {
    const data = resetStore()

    await useAppStore.getState().setGlobalSkillAutoMatch(false)
    useAppStore.getState().updateSkillSettings({
      contextBudget: 99_999,
      maxAutoSkills: 0,
    })

    expect(useAppStore.getState().data?.skillSettings).toEqual({
      ...data.skillSettings,
      autoMatch: false,
      contextBudget: 8_000,
      maxAutoSkills: 1,
    })
  })

  it('publishes a sync mode change only after its snapshot is durable', async () => {
    const data = freshData()
    data.sync = { ...data.sync, autoSync: true, mode: 'gist' }
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseSave!: () => void
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve
        }),
    )

    const change = useAppStore.getState().setSyncMode('local')
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())
    const modeBeforeSaveSettles = useAppStore.getState().data?.sync.mode

    releaseSave()
    await expect(change).resolves.toBe(true)
    expect(modeBeforeSaveSettles).toBe(data.sync.mode)
    expect(useAppStore.getState().data?.sync.mode).toBe('local')
  })

  it('publishes automatic sync only after its snapshot is durable', async () => {
    const data = freshData()
    data.sync = { ...data.sync, autoSync: true, mode: 'gist' }
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseSave!: () => void
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve
        }),
    )

    const change = useAppStore.getState().setSyncAutoSync(false)
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())
    const autoSyncBeforeSaveSettles = useAppStore.getState().data?.sync.autoSync

    releaseSave()
    await expect(change).resolves.toBe(true)
    expect(autoSyncBeforeSaveSettles).toBe(data.sync.autoSync)
    expect(useAppStore.getState().data?.sync.autoSync).toBe(false)
  })

  it('rejects a duplicate sync-setting mutation while the first save is pending', async () => {
    const data = freshData()
    data.sync = { ...data.sync, autoSync: true, mode: 'gist' }
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseSave!: () => void
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve
        }),
    )

    const modeChange = useAppStore.getState().setSyncMode('local')
    const duplicate = useAppStore.getState().setSyncAutoSync(false)
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())

    await expect(duplicate).resolves.toBe(false)
    releaseSave()
    await expect(modeChange).resolves.toBe(true)
    expect(useAppStore.getState().data?.sync).toMatchObject({
      autoSync: false,
      mode: 'local',
    })
    expect(dbMocks.saveAppData).toHaveBeenCalledOnce()
  })

  it('does not cancel a Provider check when a rejected sync mode change predicts a route change', async () => {
    const data = freshData()
    data.sync = {
      ...data.sync,
      autoSync: true,
      mode: 'cloudflare',
      workerEndpoint: 'https://worker.invalid',
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'sync-passphrase' })
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseSave!: () => void
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve
        }),
    )

    const firstSetting = useAppStore.getState().setSyncAutoSync(false)
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())

    const providerId = data.providers[0]!.id
    let releaseCheck!: () => void
    const cancel = vi.fn()
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockImplementationOnce(
      (context: ProviderConnectivityCheckContext) => {
        context.modelLoadProviderIdRef.cancel = cancel
        return {
          checkProviderFullCapabilities: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                releaseCheck = resolve
              }),
          ),
        }
      },
    )

    const checking = useAppStore
      .getState()
      .checkProviderFullCapabilities(providerId)
    await vi.waitFor(() => expect(releaseCheck).toEqual(expect.any(Function)))

    await expect(useAppStore.getState().setSyncMode('local')).resolves.toBe(
      false,
    )
    expect(cancel).not.toHaveBeenCalled()
    expect(useAppStore.getState().checkingProviderId).toBe(
      `${providerId}:capabilities`,
    )

    releaseCheck()
    releaseSave()
    await Promise.all([checking, firstSetting])
  })

  it('does not cancel a Provider check when a rejected enabled-state mutation is not admitted', async () => {
    const data = resetStore()
    data.providers[0] = { ...data.providers[0]!, enabled: true }
    data.providers.push({
      ...data.providers[0]!,
      id: 'provider-enabled-fallback',
      name: 'Enabled fallback',
    })
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    const providerId = data.providers[0]!.id
    let releaseSave!: () => void
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve
        }),
    )
    const firstMutation = useAppStore
      .getState()
      .setProviderEnabled(providerId, false)

    let releaseCheck!: () => void
    const cancel = vi.fn()
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockImplementationOnce(
      (context: ProviderConnectivityCheckContext) => {
        context.modelLoadProviderIdRef.cancel = cancel
        return {
          checkProviderFullCapabilities: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                releaseCheck = resolve
              }),
          ),
        }
      },
    )

    const checking = useAppStore
      .getState()
      .checkProviderFullCapabilities(providerId)
    await vi.waitFor(() => expect(releaseCheck).toEqual(expect.any(Function)))

    await expect(
      useAppStore.getState().setProviderEnabled(providerId, false),
    ).resolves.toBe(false)
    expect(cancel).not.toHaveBeenCalled()
    expect(useAppStore.getState().checkingProviderId).toBe(
      `${providerId}:capabilities`,
    )

    releaseCheck()
    await checking
    releaseSave()
    await firstMutation
  })

  it('does not cancel a Provider check when a failed Provider deletion publishes nothing', async () => {
    const data = resetStore()
    const providerId = data.providers[0]!.id
    let releaseCheck!: () => void
    const cancel = vi.fn()
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockImplementationOnce(
      (context: ProviderConnectivityCheckContext) => {
        context.modelLoadProviderIdRef.cancel = cancel
        return {
          checkProviderFullCapabilities: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                releaseCheck = resolve
              }),
          ),
        }
      },
    )

    const checking = useAppStore
      .getState()
      .checkProviderFullCapabilities(providerId)
    await vi.waitFor(() => expect(releaseCheck).toEqual(expect.any(Function)))

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    secretMocks.commitProviderSecretSnapshotWithAppData.mockRejectedValueOnce(
      new Error('provider deletion failed'),
    )
    await expect(useAppStore.getState().deleteProvider(providerId)).resolves.toBe(
      false,
    )

    expect(cancel).not.toHaveBeenCalled()
    expect(useAppStore.getState().checkingProviderId).toBe(
      `${providerId}:capabilities`,
    )
    expect(useAppStore.getState().data?.providers).toHaveLength(1)

    releaseCheck()
    await checking
    consoleError.mockRestore()
  })

  it('does not cancel a Provider check when a failed model catalog mutation publishes nothing', async () => {
    const data = freshData()
    const providerId = data.providers[0]!.id
    data.providers[0] = {
      ...data.providers[0]!,
      model: 'model-a',
      models: ['model-a', 'model-b'],
    }
    resetStore(data)

    let releaseCheck!: () => void
    const cancel = vi.fn()
    providerConnectivityMocks.createProviderConnectivityCheckActions.mockImplementationOnce(
      (context: ProviderConnectivityCheckContext) => {
        context.modelLoadProviderIdRef.cancel = cancel
        return {
          checkProviderFullCapabilities: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                releaseCheck = resolve
              }),
          ),
        }
      },
    )

    const checking = useAppStore
      .getState()
      .checkProviderFullCapabilities(providerId)
    await vi.waitFor(() => expect(releaseCheck).toEqual(expect.any(Function)))

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    dbMocks.saveAppData.mockRejectedValueOnce(new Error('model catalog failed'))
    await expect(
      useAppStore.getState().renameProviderModel(providerId, 'model-a', 'renamed-model'),
    ).resolves.toBe(false)

    expect(cancel).not.toHaveBeenCalled()
    expect(useAppStore.getState().checkingProviderId).toBe(
      `${providerId}:capabilities`,
    )
    expect(useAppStore.getState().data?.providers[0]?.models).toEqual([
      'model-a',
      'model-b',
    ])

    releaseCheck()
    await checking
    consoleError.mockRestore()
  })

  it.each([
    ['sync mode', () => useAppStore.getState().setSyncMode('local')],
    ['automatic sync', () => useAppStore.getState().setSyncAutoSync(false)],
  ])('keeps the committed %s setting when its durable save fails', async (_label, change) => {
    const data = freshData()
    data.sync = { ...data.sync, autoSync: true, mode: 'gist' }
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    const failure = new Error(
      'C:\\private\\sync-setting sk-sync-setting-secret',
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    dbMocks.saveAppData.mockRejectedValueOnce(failure)

    const result = change()
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())
    await expect(result).resolves.toBe(false)

    expect(useAppStore.getState().data?.sync).toEqual(data.sync)
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'Save failed. Try again.',
      tone: 'error',
    })
    expect(consoleError).toHaveBeenCalledWith('[app] sync setting save failed')
    expectConsoleErrorDoesNotExpose(consoleError, failure)
  })

  it('publishes a Skill toggle only after its snapshot is durable', async () => {
    const data = freshData()
    data.skills = [skill('toggle-target', { enabled: true })]
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseSave!: () => void
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve
        }),
    )

    const toggle = Promise.resolve(
      useAppStore.getState().setSkillToggle('toggle-target', 'enabled', false),
    )
    let settled = false
    void toggle.then(() => {
      settled = true
    })
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())
    const settledBeforeRelease = settled
    const dataBeforeRelease = useAppStore.getState().data

    releaseSave()
    const accepted = await toggle

    expect(settledBeforeRelease).toBe(false)
    expect(dataBeforeRelease).toBe(data)
    expect(accepted).toBe(true)
    expect(useAppStore.getState().data?.skills[0].enabled).toBe(false)
  })

  it('cleans materialized refs from a stale Skill toggle save', async () => {
    const data = freshData()
    data.skills = [
      skill('toggle-ref-race', {
        chunks: [
          {
            contentRef: 'skill-chunk:toggle-ref-old',
            heading: 'Body',
            id: 'toggle-ref-chunk',
            keywords: [],
            tokenEstimate: 2,
          },
        ],
      }),
    ]
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    dbMocks.deleteSkillContentRefs.mockClear()

    const persisted = structuredClone(data)
    persisted.skills[0].enabled = false
    persisted.skills[0].updatedAt += 1
    persisted.skills[0].chunks[0] = {
      ...persisted.skills[0].chunks[0],
      contentPreview: 'toggle ref race body',
      contentRef: 'skill-chunk:toggle-ref-new',
    }
    dbMocks.persistAppDataSkillContents.mockImplementationOnce(
      async () => persisted,
    )

    let releaseSave!: () => void
    const pendingSave = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    dbMocks.saveAppData.mockImplementationOnce(async () => pendingSave)

    const toggle = useAppStore.getState().setSkillToggle(
      'toggle-ref-race',
      'enabled',
      false,
    )
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())

    useAppStore.getState().setTheme('dark')
    releaseSave()
    await expect(toggle).resolves.toBe(true)

    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith([
      'skill-chunk:toggle-ref-new',
    ])
    expect(useAppStore.getState().data?.skills[0].enabled).toBe(false)
    expect(useAppStore.getState().data?.preferences.theme).toBe('dark')
  })

  it('cleans materialized refs when a Skill toggle precondition rejects', async () => {
    const data = freshData()
    data.skills = [
      skill('toggle-precondition-ref', {
        chunks: [
          {
            contentRef: 'skill-chunk:toggle-precondition-old',
            heading: 'Body',
            id: 'toggle-precondition-chunk',
            keywords: [],
            tokenEstimate: 2,
          },
        ],
      }),
    ]
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    dbMocks.deleteSkillContentRefs.mockClear()

    const persisted = structuredClone(data)
    persisted.skills[0].chunks[0] = {
      ...persisted.skills[0].chunks[0],
      contentPreview: 'toggle precondition body',
      contentRef: 'skill-chunk:toggle-precondition-new',
    }
    dbMocks.persistAppDataSkillContents.mockImplementationOnce(
      async () => persisted,
    )

    await expect(
      useAppStore.getState().setSkillToggle(
        'toggle-precondition-ref',
        'enabled',
        false,
      ),
    ).resolves.toBe(false)

    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith([
      'skill-chunk:toggle-precondition-new',
    ])
    expect(useAppStore.getState().data).toBe(data)
  })

  it.each([
    [
      'Skill flag',
      (target: UserSkill) =>
        useAppStore
          .getState()
          .setSkillToggle(target.id, 'autoMatch', false),
    ],
    [
      'global Skill auto-match',
      () => useAppStore.getState().setGlobalSkillAutoMatch(false),
    ],
  ] as const)(
    'keeps %s state when its durable toggle fails',
    async (_kind, toggle) => {
      const data = freshData()
      const target = skill('toggle-target', { autoMatch: true })
      data.skills = [target]
      data.skillSettings = { ...data.skillSettings, autoMatch: true }
      resetStore(data)
      await useAppStore.getState().flushLocalSaves()
      dbMocks.saveAppData.mockClear()
      const failure = new Error(
        'C:\\private\\skill-toggle sk-private-skill-toggle-secret',
      )
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)
      dbMocks.saveAppData.mockRejectedValueOnce(failure)

      const accepted = await Promise.resolve(toggle(target))
      await useAppStore.getState().flushLocalSaves().catch(() => undefined)

      expect(accepted).toBe(false)
      expect(useAppStore.getState().data).toBe(data)
      expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
        message: appT(data, 'settings.saveFailed'),
        tone: 'error',
      })
      expect(consoleError).toHaveBeenCalledWith('[app] Skill toggle failed')
      expectConsoleErrorDoesNotExpose(consoleError, failure)
      expect(syncMocks.performSync).not.toHaveBeenCalled()
    },
  )

  it('requests configured cloud auto-sync after a global Skill setting changes', async () => {
    const data = freshData()
    data.sync = { ...data.sync, autoSync: true, mode: 'gist' }
    resetStore(data)
    useAppStore.setState({
      githubToken: 'github-token',
      syncPassphrase: 'passphrase',
    })

    useAppStore.getState().updateSkillSettings({ contextBudget: 2_400 })

    await vi.waitFor(() =>
      expect(syncMocks.performSync).toHaveBeenCalledTimes(1),
    )
    expect(syncMocks.performSync.mock.calls[0]?.[0].skillSettings).toMatchObject({
      contextBudget: 2_400,
    })
  })

  it('publishes a durable Provider key as a new auto-sync owner', async () => {
    const data = resetStore()
    const providerId = data.providers[0]?.id ?? ''
    const previousDataUpdatedAt = data.updatedAt
    const previousProviderUpdatedAt = data.providers[0]?.updatedAt ?? 0
    useAppStore.setState({
      data: {
        ...data,
        sync: { ...data.sync, autoSync: true, mode: 'gist' },
      },
      githubToken: 'github-token',
      providerConnectivityResults: {
        [providerId]: {
          field: 'providerKey',
          message: 'stale authentication failure',
          retryable: true,
          tone: 'error',
        },
      },
      syncPassphrase: 'passphrase',
    })

    let finishSecretWrite: (() => void) | undefined
    secretMocks.setProviderKey.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          finishSecretWrite = () => resolve(undefined)
        }),
    )

    const saving = useAppStore.getState().saveProviderKey(providerId, 'new-key')
    await vi.waitFor(() =>
      expect(secretMocks.setProviderKey).toHaveBeenCalledWith(
        providerId,
        'new-key',
      ),
    )

    expect(useAppStore.getState().keys[providerId]).toBe('test-key')
    expect(useAppStore.getState().data?.updatedAt).toBe(previousDataUpdatedAt)
    expect(syncMocks.performSync).not.toHaveBeenCalled()

    finishSecretWrite?.()
    await saving
    await vi.waitFor(() => expect(syncMocks.performSync).toHaveBeenCalledTimes(1))

    const published = syncMocks.performSync.mock.calls[0]?.[0]
    expect(published.updatedAt).toBeGreaterThan(previousDataUpdatedAt)
    expect(published.providers[0]?.updatedAt).toBeGreaterThan(
      previousProviderUpdatedAt,
    )
    expect(syncMocks.performSync.mock.calls[0]?.[1]).toMatchObject({
      providerKeys: { [providerId]: 'new-key' },
    })
    expect(useAppStore.getState().providerConnectivityResults[providerId]).toBeUndefined()
  })

  it('protects the final enabled Provider and migrates disabling to one auto-sync', async () => {
    const single = resetStore()
    const singleProviderId = single.providers[0]?.id ?? ''
    await useAppStore.getState().setProviderEnabled(singleProviderId, false)
    expect(useAppStore.getState().data?.providers[0]?.enabled).toBe(true)
    expect(syncMocks.performSync).not.toHaveBeenCalled()

    const data = freshData()
    const source = {
      ...data.providers[0],
      id: 'source-provider',
      model: 'source-model',
      models: ['source-model'],
    }
    const fallback = {
      ...data.providers[0],
      id: 'fallback-provider',
      model: 'fallback-model',
      models: ['fallback-model'],
      name: 'Fallback provider',
    }
    const conversation = {
      ...data.conversations[0],
      model: source.model,
      providerId: source.id,
    }
    data.providers = [source, fallback]
    data.conversations = [conversation]
    data.preferences.activeConversationId = conversation.id
    data.sync = { ...data.sync, autoSync: true, mode: 'gist' }
    resetStore(data)
    useAppStore.setState({
      githubToken: 'github-token',
      keys: {
        [fallback.id]: 'fallback-key',
        [source.id]: 'source-key',
      },
      syncPassphrase: 'passphrase',
    })

    await useAppStore.getState().setProviderEnabled(source.id, false)
    await vi.waitFor(() => expect(syncMocks.performSync).toHaveBeenCalledTimes(1))

    const published = syncMocks.performSync.mock.calls[0]?.[0]
    expect(published.providers[0]).toMatchObject({
      enabled: false,
      id: source.id,
    })
    expect(published.conversations[0]).toMatchObject({
      model: fallback.model,
      providerId: fallback.id,
    })
  })

  it('resolves Skill creation only after the AppData snapshot is durable', async () => {
    const data = resetStore()
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    const created = skill('created', {
      chunks: [
        {
          contentRef: 'created-ref',
          heading: 'Created',
          id: 'created-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    lazyMocks.loadSkillService.mockResolvedValue({
      createUserSkillFromContent: vi.fn(async () => created),
      createUserSkillFromFile: vi.fn(),
      editableSkillContent: vi.fn(),
    })
    let finishSave: (() => void) | undefined
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve
        }),
    )

    let settled = false
    const adding = useAppStore
      .getState()
      .addSkill('Rules', 'Do the thing')
      .finally(() => {
        settled = true
      })
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledTimes(1))

    const settledWhileSaving = settled
    const dataWhileSaving = useAppStore.getState().data
    finishSave?.()
    await expect(adding).resolves.toBe(true)
    expect(settledWhileSaving).toBe(false)
    expect(dataWhileSaving).toBe(data)
    expect(dataWhileSaving?.skills).toHaveLength(0)
    expect(useAppStore.getState().data?.skills).toEqual([created])
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: appT(useAppStore.getState().data, 'skills.saveDone'),
      tone: 'success',
    })
  })

  it('admits one same-tick Skill creation owner and blocks Settings close', async () => {
    resetStore()
    useAppStore.getState().setSettingsOpen(true)
    const firstCreated = skill('first-created')
    const secondCreated = skill('second-created')
    const createUserSkillFromContent = vi
      .fn()
      .mockResolvedValueOnce(firstCreated)
      .mockResolvedValueOnce(secondCreated)
    lazyMocks.loadSkillService.mockResolvedValue({
      createUserSkillFromContent,
      createUserSkillFromFile: vi.fn(),
      editableSkillContent: vi.fn(),
    })

    const first = useAppStore.getState().addSkill('Rules', 'Do the thing')
    const second = useAppStore.getState().addSkill('Rules', 'Do the thing')
    useAppStore.getState().setSettingsOpen(false)

    await expect(Promise.all([first, second])).resolves.toEqual([true, false])
    expect(createUserSkillFromContent).toHaveBeenCalledOnce()
    expect(useAppStore.getState().data?.skills).toEqual([firstCreated])
    expect(useAppStore.getState().settingsOpen).toBe(true)
  })

  it('blocks other Skill mutations while an import owns the mutation', async () => {
    const original = skill('original')
    const imported = skill('imported')
    const data = freshData()
    data.skills = [original]
    resetStore(data)
    const createUserSkillFromContent = vi.fn(async () => skill('unexpected'))
    let finishImport!: (value: UserSkill) => void
    const createUserSkillFromFile = vi.fn(
      () =>
        new Promise<UserSkill>((resolve) => {
          finishImport = resolve
        }),
    )
    lazyMocks.loadSkillService.mockResolvedValue({
      createUserSkillFromContent,
      createUserSkillFromFile,
      editableSkillContent: vi.fn(),
    })

    const importing = useAppStore
      .getState()
      .importSkills([new File(['body'], 'rules.md', { type: 'text/markdown' })])
    await vi.waitFor(() => expect(createUserSkillFromFile).toHaveBeenCalledOnce())

    expect(useAppStore.getState().skillMutationPending).toBe(true)
    await expect(
      useAppStore.getState().addSkill('Blocked', 'Blocked body'),
    ).resolves.toBe(false)
    await expect(
      useAppStore.getState().setSkillToggle(original.id, 'enabled', false),
    ).resolves.toBe(false)
    useAppStore.getState().updateSkillSettings({ contextBudget: 900 })
    expect(createUserSkillFromContent).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.skills).toEqual([original])
    expect(useAppStore.getState().data?.skillSettings).toEqual(
      data.skillSettings,
    )

    finishImport(imported)
    await importing
    expect(useAppStore.getState().skillMutationPending).toBe(false)
    expect(useAppStore.getState().data?.skills).toEqual([original, imported])
  })

  it('releases Skill mutation ownership after an import failure', async () => {
    resetStore()
    const created = skill('created-after-failure')
    const createUserSkillFromContent = vi.fn(async () => created)
    const createUserSkillFromFile = vi
      .fn()
      .mockRejectedValueOnce(new Error('contained import failure'))
    lazyMocks.loadSkillService.mockResolvedValue({
      createUserSkillFromContent,
      createUserSkillFromFile,
      editableSkillContent: vi.fn(),
    })

    await useAppStore
      .getState()
      .importSkills([new File(['bad'], 'bad.md', { type: 'text/markdown' })])

    expect(useAppStore.getState().skillMutationPending).toBe(false)
    await expect(
      useAppStore.getState().addSkill('Recovered', 'Recovered body'),
    ).resolves.toBe(true)
    expect(createUserSkillFromContent).toHaveBeenCalledOnce()
    expect(useAppStore.getState().data?.skills).toEqual([created])
  })

  it('keeps a durably created Skill when its success notification fails', async () => {
    const data = resetStore()
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    const created = skill('created', {
      chunks: [
        {
          contentRef: 'created-ref',
          heading: 'Created',
          id: 'created-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    lazyMocks.loadSkillService.mockResolvedValue({
      createUserSkillFromContent: vi.fn(async () => created),
      createUserSkillFromFile: vi.fn(),
      editableSkillContent: vi.fn(),
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    useAppStore.setState({
      notify: () => {
        throw new Error('success notification failed')
      },
    })

    await expect(
      useAppStore.getState().addSkill('Rules', 'Do the thing'),
    ).resolves.toBe(true)

    expect(useAppStore.getState().data?.skills).toEqual([created])
    expect(dbMocks.deleteSkillContentRefs).not.toHaveBeenCalledWith([
      'created-ref',
    ])
    expect(dbMocks.saveAppData).toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalledWith('[app] Skill creation failed')
    expect(data.skills).toHaveLength(0)
  })

  it('keeps durably imported Skills when their success notification fails', async () => {
    const data = resetStore()
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    const imported = skill('imported', {
      chunks: [
        {
          contentRef: 'imported-ref',
          heading: 'Imported',
          id: 'imported-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    lazyMocks.loadSkillService.mockResolvedValue({
      createUserSkillFromContent: vi.fn(),
      createUserSkillFromFile: vi.fn(async () => imported),
      editableSkillContent: vi.fn(),
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    useAppStore.setState({
      notify: () => {
        throw new Error('success notification failed')
      },
    })

    await expect(
      useAppStore.getState().importSkills([
        new File(['body'], 'rules.md', { type: 'text/markdown' }),
      ]),
    ).resolves.toBeUndefined()

    expect(useAppStore.getState().data?.skills).toEqual([imported])
    expect(dbMocks.deleteSkillContentRefs).not.toHaveBeenCalledWith([
      'imported-ref',
    ])
    expect(dbMocks.saveAppData).toHaveBeenCalled()
    expect(data.skills).toHaveLength(0)
  })

  it('rolls back unpublished Skill refs when the durable add snapshot fails', async () => {
    const data = resetStore()
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    const created = skill('created', {
      chunks: [
        {
          contentRef: 'created-ref',
          heading: 'Created',
          id: 'created-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    lazyMocks.loadSkillService.mockResolvedValue({
      createUserSkillFromContent: vi.fn(async () => created),
      createUserSkillFromFile: vi.fn(),
      editableSkillContent: vi.fn(),
    })
    const sentinel = 'C:\\private\\skills\\provider-secret=sk-add'
    const failure = new Error(sentinel)
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    dbMocks.saveAppData.mockRejectedValueOnce(failure)

    await expect(
      useAppStore.getState().addSkill('Rules', 'Do the thing'),
    ).resolves.toBe(false)

    expect(useAppStore.getState().data).toBe(data)
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith(['created-ref'])
    const notice = useAppStore.getState().toasts.at(-1)
    expect(notice).toMatchObject({
      message: appT(data, 'settings.saveFailed'),
      tone: 'error',
    })
    expect(notice?.message).not.toContain(sentinel)
    expect(consoleError).toHaveBeenCalledWith('[app] Skill creation failed')
    expectConsoleErrorDoesNotExpose(consoleError, failure)
  })

  it('keeps old Skill refs published when an edit snapshot fails', async () => {
    const original = skill('retained', {
      chunks: [
        {
          contentRef: 'old-ref',
          heading: 'Old',
          id: 'old-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const data = freshData()
    data.skills = [original]
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    const rebuilt = skill('rebuilt', {
      chunks: [
        {
          contentRef: 'new-ref',
          heading: 'New',
          id: 'new-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    lazyMocks.loadSkillService.mockResolvedValue({
      createUserSkillFromContent: vi.fn(async () => rebuilt),
      createUserSkillFromFile: vi.fn(),
      editableSkillContent: vi.fn(),
    })
    dbMocks.saveAppData.mockRejectedValueOnce(new Error('edit save failed'))

    await expect(
      useAppStore
        .getState()
        .saveSkillContent(original.id, 'Updated', 'New body'),
    ).resolves.toBe(false)

    expect(useAppStore.getState().data?.skills).toEqual([original])
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith(['new-ref'])
    expect(dbMocks.deleteSkillContentRefs).not.toHaveBeenCalledWith(['old-ref'])
    expect(dbMocks.deleteSkillContents).not.toHaveBeenCalled()
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: appT(data, 'settings.saveFailed'),
      tone: 'error',
    })
  })

  it('rejects a second Skill edit while the first owns the mutation', async () => {
    const original = skill('edited-twice', {
      chunks: [
        {
          contentRef: 'old-ref',
          heading: 'Old',
          id: 'old-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const firstRebuilt = skill('first-rebuilt', {
      chunks: [
        {
          contentRef: 'first-ref',
          heading: 'First',
          id: 'first-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const data = freshData()
    data.skills = [original]
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    const createUserSkillFromContent = vi
      .fn()
      .mockResolvedValueOnce(firstRebuilt)
    lazyMocks.loadSkillService.mockResolvedValue({
      createUserSkillFromContent,
      createUserSkillFromFile: vi.fn(),
      editableSkillContent: vi.fn(),
    })
    let finishFirstSave: (() => void) | undefined
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirstSave = resolve
        }),
    )

    const firstEdit = useAppStore
      .getState()
      .saveSkillContent(original.id, 'First', 'First body')
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledTimes(1))
    const secondEdit = useAppStore
      .getState()
      .saveSkillContent(original.id, 'Second', 'Second body')

    finishFirstSave?.()
    await expect(firstEdit).resolves.toBe(true)
    await expect(secondEdit).resolves.toBe(false)

    expect(useAppStore.getState().data?.skills[0]?.chunks).toEqual(
      firstRebuilt.chunks,
    )
    expect(createUserSkillFromContent).toHaveBeenCalledTimes(1)
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith(['old-ref'])
    expect(dbMocks.deleteSkillContentRefs).not.toHaveBeenCalledWith(['first-ref'])
  })

  it('publishes an imported Skill set atomically and cleans failed candidates', async () => {
    const data = resetStore()
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    const imported = skill('imported', {
      chunks: [
        {
          contentRef: 'imported-ref',
          heading: 'Imported',
          id: 'imported-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    lazyMocks.loadSkillService.mockResolvedValue({
      createUserSkillFromContent: vi.fn(),
      createUserSkillFromFile: vi.fn(async () => imported),
      editableSkillContent: vi.fn(),
    })
    dbMocks.saveAppData.mockRejectedValueOnce(new Error('import save failed'))

    await expect(
      useAppStore
        .getState()
        .importSkills([new File(['body'], 'rules.md', { type: 'text/markdown' })]),
    ).resolves.toBeUndefined()

    expect(dbMocks.persistSkillsContents).toHaveBeenCalledWith([imported])
    expect(dbMocks.persistSkillContents).not.toHaveBeenCalled()
    expect(useAppStore.getState().data).toBe(data)
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith(['imported-ref'])
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: appT(data, 'settings.saveFailed'),
      tone: 'error',
    })
  })

  it('deletes Skill refs only after the row removal is durable', async () => {
    const retained = skill('retained', {
      chunks: [
        {
          contentRef: 'retained-ref',
          heading: 'Retained',
          id: 'retained-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const data = freshData()
    data.skills = [retained]
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    let finishSave: (() => void) | undefined
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve
        }),
    )

    const deleting = useAppStore.getState().deleteSkill(retained.id)
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledTimes(1))

    const skillsWhileSaving = useAppStore.getState().data?.skills
    const refsDeletedWhileSaving = dbMocks.deleteSkillContentRefs.mock.calls.length
    const contentsDeletedWhileSaving = dbMocks.deleteSkillContents.mock.calls.length
    finishSave?.()
    await expect(deleting).resolves.toBe(true)
    expect(skillsWhileSaving).toEqual([retained])
    expect(refsDeletedWhileSaving).toBe(0)
    expect(contentsDeletedWhileSaving).toBe(0)
    expect(useAppStore.getState().data?.skills).toHaveLength(0)
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith(['retained-ref'])
  })

  it('rejects Skill deletion while an edit owns the mutation', async () => {
    const original = skill('edited-then-deleted', {
      chunks: [
        {
          contentRef: 'old-ref',
          heading: 'Old',
          id: 'old-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const rebuilt = skill('rebuilt', {
      chunks: [
        {
          contentRef: 'new-ref',
          heading: 'New',
          id: 'new-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const data = freshData()
    data.skills = [original]
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    lazyMocks.loadSkillService.mockResolvedValue({
      createUserSkillFromContent: vi.fn(async () => rebuilt),
      createUserSkillFromFile: vi.fn(),
      editableSkillContent: vi.fn(),
    })
    let finishEditSave: (() => void) | undefined
    dbMocks.saveAppData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishEditSave = resolve
        }),
    )

    const editing = useAppStore
      .getState()
      .saveSkillContent(original.id, 'Updated', 'New body')
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledTimes(1))
    const deleting = useAppStore.getState().deleteSkill(original.id)

    finishEditSave?.()
    await expect(editing).resolves.toBe(true)
    await expect(deleting).resolves.toBe(false)

    expect(useAppStore.getState().data?.skills).toHaveLength(1)
    expect(useAppStore.getState().data?.skills[0]).toMatchObject({
      ...rebuilt,
      id: original.id,
    })
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith(['old-ref'])
    expect(dbMocks.deleteSkillContentRefs).not.toHaveBeenCalledWith(['new-ref'])
  })

  it('retains a Skill and hides diagnostics when its delete snapshot fails', async () => {
    const retained = skill('retained', {
      chunks: [
        {
          contentRef: 'retained-ref',
          heading: 'Retained',
          id: 'retained-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const data = freshData()
    data.skills = [retained]
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    const sentinel = 'C:\\private\\skills\\provider-secret=sk-delete'
    dbMocks.saveAppData.mockRejectedValueOnce(new Error(sentinel))

    await expect(
      useAppStore.getState().deleteSkill(retained.id),
    ).resolves.toBe(false)

    expect(useAppStore.getState().data?.skills).toEqual([retained])
    expect(dbMocks.deleteSkillContentRefs).not.toHaveBeenCalled()
    expect(dbMocks.deleteSkillContents).not.toHaveBeenCalled()
    const notice = useAppStore.getState().toasts.at(-1)
    expect(notice).toMatchObject({
      message: appT(data, 'skills.deleteFailed'),
      tone: 'error',
    })
    expect(notice?.message).not.toContain(sentinel)
  })

  it('keeps Skill persistence behind a durable secret mutation', async () => {
    const data = resetStore()
    const providerId = data.providers[0]?.id ?? ''
    const created = skill('created')
    const createUserSkillFromContent = vi.fn(async () => created)
    lazyMocks.loadSkillService.mockResolvedValue({
      createUserSkillFromContent,
      createUserSkillFromFile: vi.fn(),
      editableSkillContent: vi.fn(),
    })
    let finishSecretWrite: (() => void) | undefined
    secretMocks.setProviderKey.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          finishSecretWrite = () => resolve(undefined)
        }),
    )

    const secretWrite = useAppStore
      .getState()
      .saveProviderKey(providerId, 'new-key')
    await vi.waitFor(() =>
      expect(secretMocks.setProviderKey).toHaveBeenCalledWith(
        providerId,
        'new-key',
      ),
    )
    const adding = useAppStore
      .getState()
      .addSkill('Rules', 'Do the thing')
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()

    expect(createUserSkillFromContent).not.toHaveBeenCalled()
    expect(dbMocks.persistSkillContents).not.toHaveBeenCalled()

    finishSecretWrite?.()
    await secretWrite
    await expect(adding).resolves.toBe(true)
    expect(createUserSkillFromContent).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().data?.skills).toEqual([created])
  })

  it('does not delete a Skill ref that remains visible through another row', async () => {
    const removed = skill('removed', {
      chunks: [
        {
          contentRef: 'shared-ref',
          heading: 'Removed',
          id: 'removed-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const retained = skill('retained', {
      chunks: [
        {
          contentRef: 'shared-ref',
          heading: 'Retained',
          id: 'retained-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const data = freshData()
    data.skills = [removed, retained]
    resetStore(data)

    await useAppStore.getState().deleteSkill(removed.id)

    expect(useAppStore.getState().data?.skills).toEqual([retained])
    expect(dbMocks.deleteSkillContentRefs).not.toHaveBeenCalled()
  })

  it('keeps a durably deleted Skill removed when ref cleanup fails', async () => {
    const removed = skill('removed', {
      chunks: [
        {
          contentRef: 'removed-ref',
          heading: 'Removed',
          id: 'removed-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const data = freshData()
    data.skills = [removed]
    resetStore(data)
    const sentinel = 'C:\\private\\skills\\cleanup-secret=sk-delete'
    dbMocks.deleteSkillContentRefs.mockRejectedValueOnce(new Error(sentinel))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await useAppStore.getState().deleteSkill(removed.id)

    expect(useAppStore.getState().data?.skills).toHaveLength(0)
    const notice = useAppStore.getState().toasts.at(-1)
    expect(notice).toMatchObject({
      message: appT(data, 'skills.deleteFailed'),
      tone: 'error',
    })
    expect(notice?.message).not.toContain(sentinel)

    dbMocks.deleteSkillContentRefs.mockResolvedValue(undefined)
    await useAppStore.getState().flushLocalSaves()
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith(['removed-ref'])
  })

  it('retries unpublished Skill cleanup after a failed add without a new edit', async () => {
    const data = resetStore()
    await useAppStore.getState().flushLocalSaves()
    const created = skill('retry-add', {
      chunks: [
        {
          contentRef: 'retry-add-ref',
          heading: 'Created',
          id: 'retry-add-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    lazyMocks.loadSkillService.mockResolvedValue({
      createUserSkillFromContent: vi.fn(async () => created),
      createUserSkillFromFile: vi.fn(),
      editableSkillContent: vi.fn(),
    })
    dbMocks.saveAppData.mockRejectedValueOnce(new Error('add save failed'))
    const cleanup = blockSkillRefCleanupUntilReleased()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(
      useAppStore.getState().addSkill('Rules', 'Do the thing'),
    ).resolves.toBe(false)

    expect(useAppStore.getState().data).toBe(data)
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith([
      'retry-add-ref',
    ])
    const attemptsBeforeRetry = cleanup.attempts()
    cleanup.release()

    await useAppStore.getState().flushLocalSaves()
    expect(cleanup.attempts()).toBe(attemptsBeforeRetry + 1)
    await useAppStore.getState().flushLocalSaves()
    expect(cleanup.attempts()).toBe(attemptsBeforeRetry + 1)
  })

  it('retries unpublished Skill cleanup after a failed import without a new edit', async () => {
    const data = resetStore()
    await useAppStore.getState().flushLocalSaves()
    const imported = skill('retry-import', {
      chunks: [
        {
          contentRef: 'retry-import-ref',
          heading: 'Imported',
          id: 'retry-import-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    lazyMocks.loadSkillService.mockResolvedValue({
      createUserSkillFromContent: vi.fn(),
      createUserSkillFromFile: vi.fn(async () => imported),
      editableSkillContent: vi.fn(),
    })
    dbMocks.saveAppData.mockRejectedValueOnce(new Error('import save failed'))
    const cleanup = blockSkillRefCleanupUntilReleased()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(
      useAppStore
        .getState()
        .importSkills([new File(['body'], 'rules.md', { type: 'text/markdown' })]),
    ).resolves.toBeUndefined()

    expect(useAppStore.getState().data).toBe(data)
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith([
      'retry-import-ref',
    ])
    const attemptsBeforeRetry = cleanup.attempts()
    cleanup.release()

    await useAppStore.getState().flushLocalSaves()
    expect(cleanup.attempts()).toBe(attemptsBeforeRetry + 1)
    await useAppStore.getState().flushLocalSaves()
    expect(cleanup.attempts()).toBe(attemptsBeforeRetry + 1)
  })

  it('retries replaced Skill cleanup after a successful edit without a new edit', async () => {
    const original = skill('retry-edit-original', {
      chunks: [
        {
          contentRef: 'retry-edit-old-ref',
          heading: 'Old',
          id: 'retry-edit-old-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const rebuilt = skill('retry-edit-rebuilt', {
      chunks: [
        {
          contentRef: 'retry-edit-new-ref',
          heading: 'New',
          id: 'retry-edit-new-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const data = freshData()
    data.skills = [original]
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    lazyMocks.loadSkillService.mockResolvedValue({
      createUserSkillFromContent: vi.fn(async () => rebuilt),
      createUserSkillFromFile: vi.fn(),
      editableSkillContent: vi.fn(),
    })
    const cleanup = blockSkillRefCleanupUntilReleased()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(
      useAppStore
        .getState()
        .saveSkillContent(original.id, 'Updated', 'New body'),
    ).resolves.toBe(true)

    expect(useAppStore.getState().data?.skills[0]?.chunks).toEqual(
      rebuilt.chunks,
    )
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith([
      'retry-edit-old-ref',
    ])
    const attemptsBeforeRetry = cleanup.attempts()
    cleanup.release()

    await useAppStore.getState().flushLocalSaves()
    expect(cleanup.attempts()).toBe(attemptsBeforeRetry + 1)
    await useAppStore.getState().flushLocalSaves()
    expect(cleanup.attempts()).toBe(attemptsBeforeRetry + 1)
  })

  it('retries unpublished Skill cleanup after an edit is cancelled without a new edit', async () => {
    const original = skill('retry-edit-cancelled-original', {
      chunks: [
        {
          contentRef: 'retry-edit-cancelled-old-ref',
          heading: 'Old',
          id: 'retry-edit-cancelled-old-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const rebuilt = skill('retry-edit-cancelled-rebuilt', {
      chunks: [
        {
          contentRef: 'retry-edit-cancelled-new-ref',
          heading: 'New',
          id: 'retry-edit-cancelled-new-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const data = freshData()
    data.skills = [original]
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    let finishBuild: ((skill: UserSkill) => void) | undefined
    lazyMocks.loadSkillService.mockResolvedValue({
      createUserSkillFromContent: vi.fn(
        () =>
          new Promise<UserSkill>((resolve) => {
            finishBuild = resolve
          }),
      ),
      createUserSkillFromFile: vi.fn(),
      editableSkillContent: vi.fn(),
    })
    const cleanup = blockSkillRefCleanupUntilReleased()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const editing = useAppStore
      .getState()
      .saveSkillContent(original.id, 'Updated', 'New body')
    await vi.waitFor(() => expect(finishBuild).toBeTypeOf('function'))
    useAppStore.setState({ data: { ...data, skills: [] } })
    finishBuild?.(rebuilt)

    await expect(editing).resolves.toBe(false)
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith([
      'retry-edit-cancelled-new-ref',
    ])
    const attemptsBeforeRetry = cleanup.attempts()
    cleanup.release()

    await useAppStore.getState().flushLocalSaves()
    expect(cleanup.attempts()).toBe(attemptsBeforeRetry + 1)
    await useAppStore.getState().flushLocalSaves()
    expect(cleanup.attempts()).toBe(attemptsBeforeRetry + 1)
  })

  it('retries removed Skill cleanup after a successful delete without a new edit', async () => {
    const removed = skill('retry-delete', {
      chunks: [
        {
          contentRef: 'retry-delete-ref',
          heading: 'Removed',
          id: 'retry-delete-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const data = freshData()
    data.skills = [removed]
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    const cleanup = blockSkillRefCleanupUntilReleased()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(useAppStore.getState().deleteSkill(removed.id)).resolves.toBe(
      true,
    )

    expect(useAppStore.getState().data?.skills).toEqual([])
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith([
      'retry-delete-ref',
    ])
    const attemptsBeforeRetry = cleanup.attempts()
    cleanup.release()

    await useAppStore.getState().flushLocalSaves()
    expect(cleanup.attempts()).toBe(attemptsBeforeRetry + 1)
    await useAppStore.getState().flushLocalSaves()
    expect(cleanup.attempts()).toBe(attemptsBeforeRetry + 1)
  })

  it('coalesces concurrent pending Skill cleanup without losing its lifecycle', async () => {
    const removed = skill('concurrent-cleanup', {
      chunks: [
        {
          contentRef: 'concurrent-cleanup-ref',
          heading: 'Removed',
          id: 'concurrent-cleanup-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const data = freshData()
    data.skills = [removed]
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()

    let releaseFirstCleanup!: () => void
    const firstCleanup = new Promise<void>((resolve) => {
      releaseFirstCleanup = resolve
    })
    let cleanupCalls = 0
    dbMocks.deleteSkillContentRefs.mockImplementation(async (refs) => {
      cleanupCalls += 1
      expect(refs).toEqual(['concurrent-cleanup-ref'])
      if (cleanupCalls === 1) {
        await firstCleanup
        return
      }
      throw new Error('duplicate cleanup must not start')
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const deleting = useAppStore.getState().deleteSkill(removed.id)
    await vi.waitFor(() => expect(cleanupCalls).toBe(1))

    let flushSettled = false
    const flushing = useAppStore
      .getState()
      .flushLocalSaves()
      .then(() => {
        flushSettled = true
      })
    await Promise.resolve()
    await Promise.resolve()

    expect(flushSettled).toBe(false)
    expect(cleanupCalls).toBe(1)

    releaseFirstCleanup()
    await Promise.all([deleting, flushing])
    expect(cleanupCalls).toBe(1)

    await useAppStore.getState().flushLocalSaves()
    expect(cleanupCalls).toBe(1)
  })

  it('routes sync actions and keeps required configuration explicit', async () => {
    const data = resetStore()
    const postMessage = vi.fn()
    vi.stubGlobal('window', { chrome: { webview: { postMessage } } })
    useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().syncNow()
    expect(useAppStore.getState().toasts.at(-1)?.message).toContain('passphrase')

    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().syncNow()
    expect(useAppStore.getState().toasts.at(-1)?.message).toContain('token')
    await useAppStore.getState().clearRemoteSync()
    expect(useAppStore.getState().toasts.at(-1)?.message).toContain('token')
    await useAppStore.getState().saveGithubToken('github-token')
    await useAppStore.getState().syncNow()
    expect(syncMocks.performSync).toHaveBeenCalled()
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalled()
    expect(postMessage).toHaveBeenLastCalledWith({
      kind: 'zerochat.syncStatus',
      message: 'sync complete',
      status: 'complete',
    })
    expect(useAppStore.getState().syncing).toBe(false)

    await useAppStore.getState().clearRemoteSync()
    expect(syncMocks.clearRemoteSyncData).toHaveBeenCalled()

    useAppStore.getState().setSyncMode('cloudflare')
    await useAppStore.getState().syncNow()
    expect(useAppStore.getState().toasts.at(-1)?.message).toContain('endpoint')
    useAppStore.getState().setSyncWorkerEndpoint('https://worker.invalid')
    syncMocks.performSync.mockRejectedValueOnce(new Error('sync failed'))
    await useAppStore.getState().syncNow()
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'sync failed',
      tone: 'error',
    })
    expect(postMessage).toHaveBeenLastCalledWith({
      kind: 'zerochat.syncStatus',
      message: 'sync failed',
      status: 'failed',
    })

    useAppStore.setState({ syncConflict: true })
    useAppStore.getState().setSyncMode('local')
    await useAppStore.getState().resolveSyncConflict('use-local')
    expect(useAppStore.getState().syncConflict).toBe(false)
    expect(data.sync.mode).toBe('local')
  })

  it('keeps first-sync conflict choices visible until an explicit resolution commits', async () => {
    const data = freshData()
    data.sync = { ...data.sync, autoSync: false, mode: 'gist' }
    resetStore(data)
    useAppStore.setState({
      githubToken: 'github-token',
      syncConflict: true,
      syncPassphrase: 'passphrase',
    })
    let resolveSync: ((result: SyncResult) => void) | undefined
    syncMocks.performSync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSync = resolve
        }),
    )

    const resolving = useAppStore.getState().resolveSyncConflict('use-local')
    await vi.waitFor(() =>
      expect(syncMocks.performSync).toHaveBeenCalledOnce(),
    )

    expect(useAppStore.getState()).toMatchObject({
      syncConflict: true,
      syncing: true,
    })

    resolveSync?.(syncResult(useAppStore.getState().data as AppData))
    await resolving
    expect(useAppStore.getState()).toMatchObject({
      syncConflict: false,
      syncing: false,
    })
  })

  it('keeps first-sync conflict choices after an explicit resolution fails', async () => {
    const data = freshData()
    data.sync = { ...data.sync, autoSync: false, mode: 'gist' }
    resetStore(data)
    useAppStore.setState({
      githubToken: 'github-token',
      syncConflict: true,
      syncPassphrase: 'passphrase',
    })
    syncMocks.performSync.mockRejectedValueOnce(
      new Error('explicit conflict resolution failed'),
    )

    await useAppStore.getState().resolveSyncConflict('use-remote')

    expect(useAppStore.getState()).toMatchObject({
      syncConflict: true,
      syncing: false,
    })
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'explicit conflict resolution failed',
      tone: 'error',
    })
  })

  it('contains sync configuration notification failures', async () => {
    resetStore()
    await useAppStore.getState().setSyncMode('gist')
    const before = useAppStore.getState().data
    useAppStore.setState({
      notify: () => {
        throw new Error('notification channel unavailable')
      },
    })

    await expect(useAppStore.getState().syncNow()).resolves.toBeUndefined()

    expect(useAppStore.getState().data).toBe(before)
    expect(syncMocks.performSync).not.toHaveBeenCalled()
    expect(useAppStore.getState().syncing).toBe(false)
  })

  it('contains clear-sync configuration notification failures', async () => {
    resetStore()
    await useAppStore.getState().setSyncMode('gist')
    const before = useAppStore.getState().data
    useAppStore.setState({
      notify: () => {
        throw new Error('notification channel unavailable')
      },
    })

    await expect(useAppStore.getState().clearRemoteSync()).resolves.toBeUndefined()

    expect(useAppStore.getState().data).toBe(before)
    expect(syncMocks.clearRemoteSyncData).not.toHaveBeenCalled()
    expect(useAppStore.getState().syncing).toBe(false)
  })

  it('keeps a committed sync successful when its success notification fails', async () => {
    resetStore()
    await useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')
    expect(useAppStore.getState().data?.sync.mode).toBe('gist')
    expect(useAppStore.getState().syncPassphrase).toBe('passphrase')
    await useAppStore.getState().flushLocalSaves()
    syncMocks.performSync.mockClear()
    secretMocks.commitProviderSecretSnapshotWithAppData.mockClear()
    useAppStore.setState({
      notify: () => {
        throw new Error('notification channel unavailable')
      },
    })

    await expect(useAppStore.getState().syncNow()).resolves.toBeUndefined()

    expect(syncMocks.performSync).toHaveBeenCalledTimes(1)
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().syncing).toBe(false)
  })

  it('contains sync failure notification failures after the remote error is handled', async () => {
    resetStore()
    useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')
    await useAppStore.getState().flushLocalSaves()
    syncMocks.performSync.mockRejectedValueOnce(new Error('remote failure'))
    useAppStore.setState({
      notify: () => {
        throw new Error('notification channel unavailable')
      },
    })

    await expect(useAppStore.getState().syncNow()).resolves.toBeUndefined()

    expect(syncMocks.performSync).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().syncing).toBe(false)
  })

  it('keeps remote clearing successful when its success notification fails', async () => {
    resetStore()
    useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')
    await useAppStore.getState().flushLocalSaves()
    syncMocks.clearRemoteSyncData.mockClear()
    secretMocks.commitProviderSecretSnapshotWithAppData.mockClear()
    useAppStore.setState({
      notify: () => {
        throw new Error('notification channel unavailable')
      },
    })

    await expect(useAppStore.getState().clearRemoteSync()).resolves.toBeUndefined()

    expect(syncMocks.clearRemoteSyncData).toHaveBeenCalledTimes(1)
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().syncing).toBe(false)
  })

  it('contains remote-clearing failure notification failures', async () => {
    resetStore()
    useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')
    await useAppStore.getState().flushLocalSaves()
    syncMocks.clearRemoteSyncData.mockRejectedValueOnce(new Error('remote failure'))
    useAppStore.setState({
      notify: () => {
        throw new Error('notification channel unavailable')
      },
    })

    await expect(useAppStore.getState().clearRemoteSync()).resolves.toBeUndefined()

    expect(syncMocks.clearRemoteSyncData).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().syncing).toBe(false)
  })

  it('does not publish remote data when the Provider/AppData transition fails', async () => {
    resetStore()
    useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')
    const previousData = useAppStore.getState().data
    const previousKeys = useAppStore.getState().keys
    secretMocks.commitProviderSecretSnapshotWithAppData.mockRejectedValueOnce(
      new Error('sync credential transition failed'),
    )

    await useAppStore.getState().syncNow()

    expect(useAppStore.getState().data).toBe(previousData)
    expect(useAppStore.getState().keys).toBe(previousKeys)
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'sync credential transition failed',
      tone: 'error',
    })
    expect(useAppStore.getState().data?.sync.mode).toBe('gist')
  })

  it('does not contact the remote when the durable baseline save fails', async () => {
    resetStore()
    useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')
    dbMocks.saveAppData.mockRejectedValueOnce(new Error('baseline save failed'))

    await useAppStore.getState().syncNow()

    expect(syncMocks.performSync).not.toHaveBeenCalled()
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'baseline save failed',
      tone: 'error',
    })
  })

  it('keeps newer AppData edits and queues the latest owner after an old remote result', async () => {
    const data = resetStore()
    useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')

    let resolveFirst: ((result: SyncResult) => void) | undefined
    syncMocks.performSync.mockImplementationOnce(
      () =>
        new Promise<SyncResult>((resolve) => {
          resolveFirst = resolve
        }),
    )
    syncMocks.performSync.mockImplementationOnce(async (latest: AppData) =>
      syncResult(latest),
    )

    const first = useAppStore.getState().syncNow()
    await vi.waitFor(() => expect(syncMocks.performSync).toHaveBeenCalledTimes(1))
    const remoteWriteGuard =
      syncMocks.performSync.mock.calls[0]?.[1].shouldDeferRemoteWrite
    expect(remoteWriteGuard?.()).toBe(false)
    useAppStore.getState().setSyncGistFile('latest.json')
    expect(remoteWriteGuard?.()).toBe(true)
    const latest = useAppStore.getState().data
    expect(latest?.sync.gistFile).toBe('latest.json')

    resolveFirst?.(syncResult(data))
    await first

    expect(syncMocks.performSync).toHaveBeenCalledTimes(2)
    expect(syncMocks.performSync.mock.calls[1]?.[0].sync.gistFile).toBe(
      'latest.json',
    )
    expect(useAppStore.getState().data?.sync.gistFile).toBe('latest.json')
  })

  it('does not report a late remote failure after a newer sync owner takes over', async () => {
    resetStore()
    useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')
    useAppStore.setState({ toasts: [] })

    let rejectFirst!: (error: Error) => void
    let rejectSecond!: (error: Error) => void
    syncMocks.performSync.mockImplementationOnce(
      () =>
        new Promise<SyncResult>((_resolve, reject) => {
          rejectFirst = reject
        }),
    )
    syncMocks.performSync.mockImplementationOnce(
      () =>
        new Promise<SyncResult>((_resolve, reject) => {
          rejectSecond = reject
        }),
    )

    const active = useAppStore.getState().syncNow()
    await vi.waitFor(() => expect(syncMocks.performSync).toHaveBeenCalledOnce())
    useAppStore.getState().setSyncGistFile('new-owner.json')
    const newer = useAppStore.getState().syncNow()

    rejectFirst(new Error('stale remote failure'))
    await vi.waitFor(() => expect(syncMocks.performSync).toHaveBeenCalledTimes(2))
    rejectSecond(new Error('new owner failure'))
    await Promise.all([active, newer])

    expect(useAppStore.getState().toasts).toEqual([
      expect.objectContaining({
        message: 'new owner failure',
        tone: 'error',
      }),
    ])
    expect(useAppStore.getState().data?.sync.gistFile).toBe('new-owner.json')
    expect(useAppStore.getState().syncing).toBe(false)
  })

  it('keeps newer Provider keys and queues the latest credential owner after an old remote result', async () => {
    const data = resetStore()
    const providerId = data.providers[0]?.id ?? ''
    useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')

    let resolveFirst: ((result: SyncResult) => void) | undefined
    syncMocks.performSync.mockImplementationOnce(
      () =>
        new Promise<SyncResult>((resolve) => {
          resolveFirst = resolve
        }),
    )
    syncMocks.performSync.mockImplementationOnce(async (latest: AppData) => ({
      ...syncResult(latest),
      remoteAccepted: false,
      secrets: { providerKeys: { [providerId]: 'new-key' } },
    }))

    const first = useAppStore.getState().syncNow()
    await vi.waitFor(() => expect(syncMocks.performSync).toHaveBeenCalledTimes(1))
    const mutation = useAppStore.getState().saveProviderKey(providerId, 'new-key')
    resolveFirst?.(syncResult(data))
    await first
    await mutation
    await vi.waitFor(() =>
      expect(syncMocks.performSync).toHaveBeenCalledTimes(2),
    )

    expect(syncMocks.performSync).toHaveBeenCalledTimes(2)
    expect(syncMocks.performSync.mock.calls[1]?.[1]).toMatchObject({
      providerKeys: { [providerId]: 'new-key' },
    })
    expect(useAppStore.getState().keys).toEqual({ [providerId]: 'new-key' })
  })

  it.each([
    ['Provider key', 'provider'] as const,
    ['sync passphrase', 'passphrase'] as const,
    ['GitHub token', 'github'] as const,
  ])(
    'invalidates the sync owner before a durable %s write and serializes the retry',
    async (_label, kind) => {
      const data = resetStore()
      const providerId = data.providers[0]?.id ?? ''
      useAppStore.getState().setSyncMode('gist')
      await useAppStore.getState().setSyncPassphrase('old-passphrase')
      await useAppStore.getState().saveGithubToken('old-token')
      secretMocks.setProviderKey.mockClear()
      secretMocks.setSyncPassphrase.mockClear()
      secretMocks.setGithubToken.mockClear()

      let resolveFirst: ((result: SyncResult) => void) | undefined
      syncMocks.performSync.mockImplementationOnce(
        () =>
          new Promise<SyncResult>((resolve) => {
            resolveFirst = resolve
          }),
      )
      syncMocks.performSync.mockImplementation(async (latest: AppData) =>
        syncResult(latest),
      )

      let resolveWrite: (() => void) | undefined
      if (kind === 'provider') {
        secretMocks.setProviderKey.mockImplementationOnce(
          () =>
            new Promise<undefined>((resolve) => {
              resolveWrite = () => resolve(undefined)
            }),
        )
      } else if (kind === 'passphrase') {
        secretMocks.setSyncPassphrase.mockImplementationOnce(
          () =>
            new Promise<undefined>((resolve) => {
              resolveWrite = () => resolve(undefined)
            }),
        )
      } else {
        secretMocks.setGithubToken.mockImplementationOnce(
          () =>
            new Promise<undefined>((resolve) => {
              resolveWrite = () => resolve(undefined)
            }),
        )
      }

      const first = useAppStore.getState().syncNow()
      await vi.waitFor(() =>
        expect(syncMocks.performSync).toHaveBeenCalledTimes(1),
      )

      const mutation =
        kind === 'provider'
          ? useAppStore.getState().saveProviderKey(providerId, 'new-key')
          : kind === 'passphrase'
            ? useAppStore.getState().setSyncPassphrase('new-passphrase')
            : useAppStore.getState().saveGithubToken('new-token')

      resolveFirst?.(syncResult(data))
      await first
      expect(syncMocks.performSync).toHaveBeenCalledTimes(1)

      await vi.waitFor(() => {
        if (kind === 'provider') {
          expect(secretMocks.setProviderKey).toHaveBeenCalledTimes(1)
        } else if (kind === 'passphrase') {
          expect(secretMocks.setSyncPassphrase).toHaveBeenCalledTimes(1)
        } else {
          expect(secretMocks.setGithubToken).toHaveBeenCalledTimes(1)
        }
      })
      resolveWrite?.()
      await mutation
      await vi.waitFor(() =>
        expect(syncMocks.performSync).toHaveBeenCalledTimes(2),
      )

      const retryOptions = syncMocks.performSync.mock.calls[1]?.[1]
      if (kind === 'provider') {
        expect(retryOptions).toMatchObject({
          providerKeys: { [providerId]: 'new-key' },
        })
      } else if (kind === 'passphrase') {
        expect(retryOptions).toMatchObject({
          encryptionPassphrase: 'new-passphrase',
        })
      } else {
        expect(retryOptions).toMatchObject({ githubToken: 'new-token' })
      }
    },
  )

  it('evaluates queued sync-passphrase changes against the value at execution time', async () => {
    resetStore()
    const releases: Array<() => void> = []
    const blockedWrite = () =>
      new Promise<undefined>((resolve) => {
        releases.push(() => resolve(undefined))
      })
    secretMocks.setSyncPassphrase
      .mockImplementationOnce(blockedWrite)
      .mockImplementationOnce(blockedWrite)

    const first = useAppStore.getState().setSyncPassphrase('temporary-passphrase')
    await vi.waitFor(() =>
      expect(secretMocks.setSyncPassphrase).toHaveBeenCalledTimes(1),
    )
    const second = useAppStore.getState().setSyncPassphrase('')

    releases[0]?.()
    await vi.waitFor(() =>
      expect(secretMocks.setSyncPassphrase).toHaveBeenCalledTimes(2),
    )
    await vi.waitFor(() =>
      expect(useAppStore.getState().syncPassphrase).toBe('temporary-passphrase'),
    )
    const firstMutationUpdatedAt = useAppStore.getState().data?.updatedAt ?? 0

    releases[1]?.()
    await Promise.all([first, second])

    expect(useAppStore.getState().syncPassphrase).toBe('')
    expect(useAppStore.getState().data?.updatedAt).toBeGreaterThan(
      firstMutationUpdatedAt,
    )
  })

  it('does not persist a secret mutation while an old sync is in its commit stage', async () => {
    const data = resetStore()
    const providerId = data.providers[0]?.id ?? ''
    useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')

    let resolveStage: (() => void) | undefined
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await new Promise<void>((resolve) => {
          resolveStage = resolve
        })
        return persist(target)
      },
    )

    const sync = useAppStore.getState().syncNow()
    await vi.waitFor(() =>
      expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalled(),
    )

    const mutation = useAppStore.getState().saveProviderKey(providerId, 'new-key')
    await Promise.resolve()
    expect(secretMocks.setProviderKey).not.toHaveBeenCalled()

    resolveStage?.()
    await sync
    await mutation
    expect(secretMocks.setProviderKey).toHaveBeenCalledWith(providerId, 'new-key')
  })

  it.each(['Provider key', 'sync passphrase'] as const)(
    'finishes an already-admitted %s before a later failed reset replacement',
    async (kind) => {
      const data = resetStore()
      const providerId = data.providers[0].id
      const previousProviderUpdatedAt = data.providers[0].updatedAt
      const previousDataUpdatedAt = data.updatedAt
      let releaseSecretWrite!: () => void
      const secretWrite = new Promise<void>((resolve) => {
        releaseSecretWrite = resolve
      })

      if (kind === 'Provider key') {
        secretMocks.setProviderKey.mockImplementationOnce(async () => {
          await secretWrite
        })
      } else {
        secretMocks.setSyncPassphrase.mockImplementationOnce(async () => {
          await secretWrite
        })
      }

      const mutation =
        kind === 'Provider key'
          ? useAppStore.getState().saveProviderKey(providerId, 'new-key')
          : useAppStore.getState().setSyncPassphrase('new-passphrase')

      await vi.waitFor(() => {
        if (kind === 'Provider key') {
          expect(secretMocks.setProviderKey).toHaveBeenCalledWith(
            providerId,
            'new-key',
          )
        } else {
          expect(secretMocks.setSyncPassphrase).toHaveBeenCalledWith(
            'new-passphrase',
          )
        }
      })

      secretMocks.commitZeroChatSecretSnapshotWithAppData.mockRejectedValueOnce(
        new Error('later reset failed'),
      )
      const resetting = useAppStore.getState().resetAll()
      releaseSecretWrite()

      await mutation
      await resetting

      if (kind === 'Provider key') {
        expect(useAppStore.getState().keys[providerId]).toBe('new-key')
        expect(
          useAppStore.getState().data?.providers[0]?.updatedAt,
        ).toBeGreaterThan(previousProviderUpdatedAt)
      } else {
        expect(useAppStore.getState().syncPassphrase).toBe('new-passphrase')
        expect(useAppStore.getState().data?.updatedAt).toBeGreaterThan(
          previousDataUpdatedAt,
        )
      }
    },
  )

  it('does not publish a remote result when AppData or keys change during the commit await', async () => {
    const data = resetStore()
    const providerId = data.providers[0]?.id ?? ''
    useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')

    let resolveCommit: ((data: AppData) => void) | undefined
    syncMocks.performSync.mockImplementationOnce(async (latest: AppData) =>
      syncResult(latest),
    )
    syncMocks.performSync.mockImplementationOnce(async (latest: AppData) => ({
      ...syncResult(latest),
      remoteAccepted: false,
      secrets: { providerKeys: { [providerId]: 'edited-key' } },
    }))
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      (
        _previous: unknown,
        _next: unknown,
        target: AppData,
      ) =>
        new Promise<AppData>((resolve) => {
          resolveCommit = () => resolve(target)
        }),
    )

    const first = useAppStore.getState().syncNow()
    await vi.waitFor(() =>
      expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalled(),
    )
    useAppStore.getState().setSyncGistFile('edited-during-commit.json')
    const mutation = useAppStore.getState().saveProviderKey(providerId, 'edited-key')
    resolveCommit?.(data)
    await first
    await mutation
    await vi.waitFor(() =>
      expect(syncMocks.performSync).toHaveBeenCalledTimes(2),
    )
    await vi.waitFor(() => expect(useAppStore.getState().syncing).toBe(false))

    expect(useAppStore.getState().data?.sync.gistFile).toBe(
      'edited-during-commit.json',
    )
    expect(useAppStore.getState().keys).toEqual({ [providerId]: 'edited-key' })
    expect(useAppStore.getState().syncing).toBe(false)
  })

  it('waits for an active sync before clearing remote data', async () => {
    resetStore()
    useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')
    let resolveFirst: ((result: SyncResult) => void) | undefined
    syncMocks.performSync.mockImplementationOnce(
      () =>
        new Promise<SyncResult>((resolve) => {
          resolveFirst = resolve
        }),
    )

    const active = useAppStore.getState().syncNow()
    await vi.waitFor(() => expect(syncMocks.performSync).toHaveBeenCalledTimes(1))
    const clear = useAppStore.getState().clearRemoteSync()
    await Promise.resolve()
    expect(syncMocks.clearRemoteSyncData).not.toHaveBeenCalled()

    resolveFirst?.(syncResult(useAppStore.getState().data as AppData))
    await active
    await clear
    expect(syncMocks.clearRemoteSyncData).toHaveBeenCalledTimes(1)
  })

  it('coalesces duplicate remote-clear requests into one destructive lifecycle', async () => {
    resetStore()
    await useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')
    let releaseClear!: () => void
    syncMocks.clearRemoteSyncData.mockImplementationOnce(
      async (latest: AppData) => {
        await new Promise<void>((resolve) => {
          releaseClear = resolve
        })
        return syncResult(latest)
      },
    )

    const first = useAppStore.getState().clearRemoteSync()
    const duplicate = useAppStore.getState().clearRemoteSync()
    await vi.waitFor(() =>
      expect(syncMocks.clearRemoteSyncData).toHaveBeenCalledTimes(1),
    )

    releaseClear()
    await Promise.all([first, duplicate])

    expect(syncMocks.clearRemoteSyncData).toHaveBeenCalledTimes(1)
  })

  it('defers a stale remote clear before its destructive write', async () => {
    resetStore()
    useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')
    await useAppStore.getState().flushLocalSaves()
    secretMocks.commitProviderSecretSnapshotWithAppData.mockClear()
    useAppStore.setState({ toasts: [] })

    let releasePreparation: (() => void) | undefined
    let remoteWrites = 0
    syncMocks.clearRemoteSyncData.mockImplementationOnce(
      async (
        latest: AppData,
        context: { shouldDeferRemoteWrite?: () => boolean },
      ) => {
        await new Promise<void>((resolve) => {
          releasePreparation = resolve
        })
        if (context.shouldDeferRemoteWrite?.()) {
          throw new Error('zerochat.sync.remoteWriteDeferred')
        }
        remoteWrites += 1
        return syncResult(latest)
      },
    )

    const clear = useAppStore.getState().clearRemoteSync()
    await vi.waitFor(() =>
      expect(syncMocks.clearRemoteSyncData).toHaveBeenCalledTimes(1),
    )
    useAppStore.getState().setSyncGistFile('changed-during-clear.json')
    releasePreparation?.()
    await clear

    expect(remoteWrites).toBe(0)
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.sync.gistFile).toBe(
      'changed-during-clear.json',
    )
    expect(useAppStore.getState().toasts).toEqual([])
    expect(useAppStore.getState().syncing).toBe(false)
  })

  it('durably adopts the returned local sync state after remote data is cleared', async () => {
    const data = resetStore()
    useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')
    const clearedData = {
      ...(useAppStore.getState().data as AppData),
      sync: {
        ...(useAppStore.getState().data as AppData).sync,
        lastSyncStatus: 'remote data cleared',
        lastSyncedAt: 456,
      },
    }
    syncMocks.clearRemoteSyncData.mockResolvedValueOnce(syncResult(clearedData))

    await useAppStore.getState().clearRemoteSync()

    expect(syncMocks.clearRemoteSyncData).toHaveBeenCalledWith(
      expect.objectContaining({ sync: expect.objectContaining({ mode: 'gist' }) }),
      expect.objectContaining({
        encryptionPassphrase: 'passphrase',
        githubToken: 'github-token',
      }),
    )
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalled()
    expect(useAppStore.getState().data?.sync).toMatchObject({
      lastSyncStatus: 'remote data cleared',
      lastSyncedAt: 456,
    })
    expect(useAppStore.getState().syncing).toBe(false)
    expect(data.sync.lastSyncStatus).not.toBe('remote data cleared')
  })

  it('waits for an active sync before resetting local data', async () => {
    resetStore()
    useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')
    let resolveFirst: ((result: SyncResult) => void) | undefined
    syncMocks.performSync.mockImplementationOnce(
      () =>
        new Promise<SyncResult>((resolve) => {
          resolveFirst = resolve
        }),
    )

    const active = useAppStore.getState().syncNow()
    await vi.waitFor(() => expect(syncMocks.performSync).toHaveBeenCalledTimes(1))
    const reset = useAppStore.getState().resetAll()
    await Promise.resolve()
    expect(secretMocks.commitZeroChatSecretSnapshotWithAppData).not.toHaveBeenCalled()

    resolveFirst?.(syncResult(useAppStore.getState().data as AppData))
    await active
    await reset
    expect(secretMocks.commitZeroChatSecretSnapshotWithAppData).toHaveBeenCalledTimes(1)
  })

  it('shares the pending reset lifecycle with concurrent callers', async () => {
    resetStore()
    let releaseReset!: () => void
    secretMocks.commitZeroChatSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await new Promise<void>((resolve) => {
          releaseReset = resolve
        })
        return persist(target)
      },
    )

    const first = useAppStore.getState().resetAll()
    await vi.waitFor(() =>
      expect(secretMocks.commitZeroChatSecretSnapshotWithAppData).toHaveBeenCalledTimes(1),
    )
    let secondSettled = false
    const second = useAppStore.getState().resetAll().finally(() => {
      secondSettled = true
    })
    await Promise.resolve()

    expect(secondSettled).toBe(false)
    releaseReset()
    await Promise.all([first, second])
    expect(secondSettled).toBe(true)
    expect(secretMocks.commitZeroChatSecretSnapshotWithAppData).toHaveBeenCalledTimes(1)
  })

  it('keeps reset pending until aborted generation cleanup settles', async () => {
    resetStore()
    let releaseGenerationCleanup!: () => void
    const generationCleanup = new Promise<void>((resolve) => {
      releaseGenerationCleanup = resolve
    })
    let generationAborted!: () => void
    const abortObserved = new Promise<void>((resolve) => {
      generationAborted = resolve
    })
    runtime.streamChat.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              generationAborted()
              void generationCleanup.then(() => {
                reject(new DOMException('Aborted', 'AbortError'))
              })
            },
            { once: true },
          )
        }),
    )

    const sending = useAppStore.getState().sendMessage('hold generation cleanup')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())
    expect(useAppStore.getState().streaming).toBe(true)
    let resetSettled = false
    const reset = useAppStore
      .getState()
      .resetAll()
      .finally(() => {
        resetSettled = true
      })

    await abortObserved
    await vi.advanceTimersByTimeAsync(100)
    expect(resetSettled).toBe(false)
    expect(secretMocks.commitZeroChatSecretSnapshotWithAppData).not.toHaveBeenCalled()

    releaseGenerationCleanup()
    await vi.advanceTimersByTimeAsync(100)
    await sending
    await reset
    expect(secretMocks.commitZeroChatSecretSnapshotWithAppData).toHaveBeenCalledTimes(1)
  })

  it('waits for an admitted generation to exit before importing a backup', async () => {
    const data = resetStore()
    const importedData = structuredClone(data)
    importedData.preferences.theme = 'dark'
    importedData.updatedAt += 1
    useAppStore.setState({ syncPassphrase: 'passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: importedData,
      secrets: { providerKeys: {} },
    })

    let releaseGenerationCleanup!: () => void
    const generationCleanup = new Promise<void>((resolve) => {
      releaseGenerationCleanup = resolve
    })
    let generationAborted!: () => void
    const generationWasAborted = new Promise<void>((resolve) => {
      generationAborted = resolve
    })
    runtime.streamChat.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              generationAborted()
              void generationCleanup.then(() =>
                reject(new DOMException('Aborted', 'AbortError')),
              )
            },
            { once: true },
          )
        }),
    )

    const activeGeneration = useAppStore
      .getState()
      .sendMessage('old generation')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())

    const importing = useAppStore.getState().importBackup(
      new File(['{}'], 'backup.json', { type: 'application/json' }),
    )
    await generationWasAborted
    await Promise.resolve()

    expect(secretMocks.commitProviderSecretSnapshotWithAppData).not.toHaveBeenCalled()
    releaseGenerationCleanup()

    await activeGeneration
    await vi.advanceTimersByTimeAsync(100)
    await importing
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce()
    expect(useAppStore.getState().data?.preferences.theme).toBe('dark')
    expect(useAppStore.getState().data?.conversations[0]?.messages).toEqual([])
  })

  it('does not apply a conversation mutation queued before import to the imported snapshot', async () => {
    const data = resetStore()
    const importedData = structuredClone(data)
    importedData.conversations[0].title = 'Imported title'
    importedData.updatedAt += 1
    useAppStore.setState({ syncPassphrase: 'passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: importedData,
      secrets: { providerKeys: {} },
    })

    let releaseReplacement!: () => void
    const replacementCommit = new Promise<void>((resolve) => {
      releaseReplacement = resolve
    })
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await replacementCommit
        return persist(target)
      },
    )

    const importing = useAppStore.getState().importBackup(
      new File(['{}'], 'backup.json', { type: 'application/json' }),
    )
    await vi.waitFor(() =>
      expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
    )

    const rename = useAppStore
      .getState()
      .renameConversation(data.conversations[0].id, 'Stale pre-import title')
    let renameSettled = false
    void rename.then(() => {
      renameSettled = true
    })
    await Promise.resolve()

    await expect(rename).resolves.toBe(false)
    expect(renameSettled).toBe(true)
    releaseReplacement()
    await importing

    expect(useAppStore.getState().data?.conversations[0]?.title).toBe(
      'Imported title',
    )
  })

  it('rejects a Provider deletion while import owns the replacement lease', async () => {
    const data = resetStore()
    const importedData = structuredClone(data)
    importedData.providers[0].name = 'Imported Provider'
    importedData.updatedAt += 1
    useAppStore.setState({ syncPassphrase: 'passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: importedData,
      secrets: { providerKeys: {} },
    })

    let releaseReplacement!: () => void
    const replacementCommit = new Promise<void>((resolve) => {
      releaseReplacement = resolve
    })
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await replacementCommit
        return persist(target)
      },
    )

    const importing = useAppStore.getState().importBackup(
      new File(['{}'], 'backup.json', { type: 'application/json' }),
    )
    await vi.waitFor(() =>
      expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
    )

    const deletion = useAppStore
      .getState()
      .deleteProvider(data.providers[0].id)
    let deletionSettled = false
    void deletion.then(() => {
      deletionSettled = true
    })
    await Promise.resolve()

    await expect(deletion).resolves.toBe(false)
    expect(deletionSettled).toBe(true)
    releaseReplacement()
    await importing

    expect(useAppStore.getState().data?.providers[0]).toMatchObject({
      id: data.providers[0].id,
      name: 'Imported Provider',
    })
  })

  it('rejects a Provider key write while import owns the replacement lease', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const importedData = structuredClone(data)
    importedData.updatedAt += 1
    useAppStore.setState({ syncPassphrase: 'passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: importedData,
      secrets: { providerKeys: { [providerId]: 'imported-key' } },
    })

    let releaseReplacement!: () => void
    const replacementCommit = new Promise<void>((resolve) => {
      releaseReplacement = resolve
    })
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await replacementCommit
        return persist(target)
      },
    )

    const importing = useAppStore.getState().importBackup(
      new File(['{}'], 'backup.json', { type: 'application/json' }),
    )
    await vi.waitFor(() =>
      expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
    )

    const savingKey = useAppStore.getState().saveProviderKey(providerId, 'stale-key')
    let keySaveSettled = false
    void savingKey.then(() => {
      keySaveSettled = true
    })
    await Promise.resolve()

    await expect(savingKey).resolves.toBe(false)
    expect(keySaveSettled).toBe(true)
    releaseReplacement()
    await importing

    expect(secretMocks.setProviderKey).not.toHaveBeenCalledWith(
      providerId,
      'stale-key',
    )
    expect(useAppStore.getState().keys).toEqual({ [providerId]: 'imported-key' })
  })

  it('keeps a Provider key draft when the real store rejects it during import', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const importedData = structuredClone(data)
    importedData.updatedAt += 1
    useAppStore.setState({ syncPassphrase: 'passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: importedData,
      secrets: { providerKeys: { [providerId]: 'imported-key' } },
    })

    let releaseReplacement!: () => void
    const replacementCommit = new Promise<void>((resolve) => {
      releaseReplacement = resolve
    })
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await replacementCommit
        return persist(target)
      },
    )

    const importing = useAppStore.getState().importBackup(
      new File(['{}'], 'backup.json', { type: 'application/json' }),
    )
    await vi.waitFor(() =>
      expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
    )

    const clear = vi.fn()
    const savingDraft = commitProviderKeyDraft({
      clear,
      draft: 'stale-key',
      onError: vi.fn(),
      save: (value) => useAppStore.getState().saveProviderKey(providerId, value),
    })

    await expect(savingDraft).resolves.toBe(false)
    expect(clear).not.toHaveBeenCalled()
    expect(secretMocks.setProviderKey).not.toHaveBeenCalledWith(
      providerId,
      'stale-key',
    )

    releaseReplacement()
    await importing
  })

  it.each(['provider key', 'sync passphrase', 'GitHub token'] as const)(
    'rejects a %s write while import owns the replacement lease',
    async (kind) => {
      const data = resetStore()
      const providerId = data.providers[0].id
      useAppStore.setState({ syncPassphrase: 'import-passphrase' })
      const importedData = structuredClone(data)
      importedData.updatedAt += 1
      cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
      cryptoMocks.decryptVault.mockResolvedValue({
        data: importedData,
        secrets: { providerKeys: { [providerId]: 'imported-key' } },
      })

      let releaseReplacement!: () => void
      const replacementCommit = new Promise<void>((resolve) => {
        releaseReplacement = resolve
      })
      secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
        async (
          _previous: unknown,
          _next: unknown,
          target: AppData,
          persist: (snapshot: AppData) => Promise<AppData>,
        ) => {
          await replacementCommit
          return persist(target)
        },
      )

      const importing = useAppStore.getState().importBackup(
        new File(['{}'], 'backup.json', { type: 'application/json' }),
      )
      await vi.waitFor(() =>
        expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
      )

      const before = useAppStore.getState()
      let action: Promise<boolean>
      if (kind === 'provider key') {
        action = useAppStore.getState().saveProviderKey(providerId, 'stale-key')
      } else if (kind === 'sync passphrase') {
        action = useAppStore.getState().setSyncPassphrase('stale-passphrase')
      } else {
        action = useAppStore.getState().saveGithubToken('stale-token')
      }

      await action
      expect(useAppStore.getState().data).toBe(before.data)
      expect(useAppStore.getState().keys).toBe(before.keys)
      expect(useAppStore.getState().syncPassphrase).toBe('import-passphrase')
      expect(useAppStore.getState().githubToken).toBe(before.githubToken)
      expect(secretMocks.setProviderKey).not.toHaveBeenCalledWith(
        providerId,
        'stale-key',
      )
      expect(secretMocks.setSyncPassphrase).not.toHaveBeenCalledWith(
        'stale-passphrase',
      )
      expect(secretMocks.setGithubToken).not.toHaveBeenCalledWith('stale-token')

      releaseReplacement()
      await importing
    },
  )

  it('does not apply a Skill deletion queued before import to the imported snapshot', async () => {
    const original = skill('original-skill', {
      chunks: [
        {
          id: 'original-chunk',
          heading: 'Original skill',
          content: 'Original skill content',
          keywords: [],
          tokenEstimate: 3,
        },
      ],
    })
    original.name = 'Original skill'
    const data = freshData()
    data.skills = [original]
    resetStore(data)
    const importedData = structuredClone(data)
    importedData.skills[0] = {
      ...importedData.skills[0],
      name: 'Imported skill',
    }
    importedData.updatedAt += 1
    useAppStore.setState({ syncPassphrase: 'passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: importedData,
      secrets: { providerKeys: {} },
    })

    let releaseReplacement!: () => void
    const replacementCommit = new Promise<void>((resolve) => {
      releaseReplacement = resolve
    })
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await replacementCommit
        return persist(target)
      },
    )

    const importing = useAppStore.getState().importBackup(
      new File(['{}'], 'backup.json', { type: 'application/json' }),
    )
    await vi.waitFor(() =>
      expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
    )

    const deletion = useAppStore.getState().deleteSkill(original.id)
    let deletionSettled = false
    void deletion.then(() => {
      deletionSettled = true
    })
    await Promise.resolve()

    await expect(deletion).resolves.toBe(false)
    expect(deletionSettled).toBe(true)
    releaseReplacement()
    await importing
    expect(useAppStore.getState().data?.skills[0]).toMatchObject({
      id: original.id,
      name: 'Imported skill',
    })
  })

  it('does not apply a sync setting queued before import to the imported snapshot', async () => {
    const data = resetStore()
    const importedData = structuredClone(data)
    importedData.sync = { ...importedData.sync, mode: 'local' }
    importedData.updatedAt += 1
    useAppStore.setState({ syncPassphrase: 'passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: importedData,
      secrets: { providerKeys: {} },
    })

    let releaseReplacement!: () => void
    const replacementCommit = new Promise<void>((resolve) => {
      releaseReplacement = resolve
    })
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await replacementCommit
        return persist(target)
      },
    )

    const importing = useAppStore.getState().importBackup(
      new File(['{}'], 'backup.json', { type: 'application/json' }),
    )
    await vi.waitFor(() =>
      expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
    )

    const setting = useAppStore.getState().setSyncMode('gist')
    let settingSettled = false
    void setting.then(() => {
      settingSettled = true
    })
    await Promise.resolve()

    await expect(setting).resolves.toBe(false)
    expect(settingSettled).toBe(true)
    releaseReplacement()
    await importing
    expect(useAppStore.getState().data?.sync.mode).toBe('local')
  })

  it.each(['feature hint', 'remote clear'] as const)(
    'rejects a %s action while import owns the replacement lease',
    async (kind) => {
      const data = resetStore()
      const importedData = structuredClone(data)
      importedData.updatedAt += 1
      useAppStore.setState({ syncPassphrase: 'passphrase' })
      if (kind === 'remote clear') {
        importedData.sync = { ...importedData.sync, mode: 'gist' }
        useAppStore.setState({
          githubToken: 'github-token',
          syncPassphrase: 'passphrase',
        })
      } else {
        importedData.preferences.dismissedFeatureHints = []
      }
      cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
      cryptoMocks.decryptVault.mockResolvedValue({
        data: importedData,
        secrets: { providerKeys: {} },
      })

      let releaseReplacement!: () => void
      const replacementCommit = new Promise<void>((resolve) => {
        releaseReplacement = resolve
      })
      secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
        async (
          _previous: unknown,
          _next: unknown,
          target: AppData,
          persist: (snapshot: AppData) => Promise<AppData>,
        ) => {
          await replacementCommit
          return persist(target)
        },
      )

      const importing = useAppStore.getState().importBackup(
        new File(['{}'], 'backup.json', { type: 'application/json' }),
      )
      await vi.waitFor(() =>
        expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
      )

      const action =
        kind === 'feature hint'
          ? useAppStore.getState().dismissFeatureHint('chat')
          : useAppStore.getState().clearRemoteSync()
      let actionSettled = false
      void action.then(() => {
        actionSettled = true
      })
      await Promise.resolve()

      expect(actionSettled).toBe(true)
      if (kind === 'remote clear') {
        expect(syncMocks.clearRemoteSyncData).not.toHaveBeenCalled()
      }
      releaseReplacement()
      await importing

      if (kind === 'feature hint') {
        expect(useAppStore.getState().data?.preferences.dismissedFeatureHints).toEqual(
          [],
        )
      } else {
        expect(useAppStore.getState().data?.sync.mode).toBe('gist')
      }
    },
  )

  it.each(['model refresh', 'connectivity check'] as const)(
    'does not start a %s while import owns the replacement lease',
    async (kind) => {
      const data = resetStore()
      const providerId = data.providers[0].id
      const importedData = structuredClone(data)
      importedData.updatedAt += 1
      useAppStore.setState({ syncPassphrase: 'passphrase' })
      cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
      cryptoMocks.decryptVault.mockResolvedValue({
        data: importedData,
        secrets: { providerKeys: {} },
      })

      const runProviderConnectivityCheck = vi.fn(async () => undefined)
      if (kind === 'connectivity check') {
        providerConnectivityMocks.createProviderConnectivityCheckActions.mockReturnValue(
          { runProviderConnectivityCheck },
        )
      }

      let releaseReplacement!: () => void
      const replacementCommit = new Promise<void>((resolve) => {
        releaseReplacement = resolve
      })
      secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
        async (
          _previous: unknown,
          _next: unknown,
          target: AppData,
          persist: (snapshot: AppData) => Promise<AppData>,
        ) => {
          await replacementCommit
          return persist(target)
        },
      )

      const importing = useAppStore.getState().importBackup(
        new File(['{}'], 'backup.json', { type: 'application/json' }),
      )
      await vi.waitFor(() =>
        expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
      )

      runtime.listProviderModels.mockClear()
      const action =
        kind === 'model refresh'
          ? useAppStore.getState().fetchModels(providerId)
          : useAppStore.getState().checkProviderConnectivity(providerId)
      await action

      expect(runtime.listProviderModels).not.toHaveBeenCalled()
      expect(runProviderConnectivityCheck).not.toHaveBeenCalled()
      releaseReplacement()
      await importing
    },
  )

  it.each([
    'theme',
    'sync gist id',
    'provider name',
    'skill settings',
    'message content',
  ] as const)(
    'does not admit the direct %s AppData mutation while import owns the lease',
    async (kind) => {
      const data = resetStore()
      const conversation = data.conversations[0]
      const user = message('replacement-direct-user', 'user', 'original')
      data.conversations = [
        { ...conversation, messages: [user] },
        ...data.conversations.slice(1),
      ]
      resetStore(data)
      const importedData = structuredClone(data)
      importedData.updatedAt += 1
      useAppStore.setState({ syncPassphrase: 'passphrase' })
      cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
      cryptoMocks.decryptVault.mockResolvedValue({
        data: importedData,
        secrets: { providerKeys: {} },
      })

      let releaseReplacement!: () => void
      const replacementCommit = new Promise<void>((resolve) => {
        releaseReplacement = resolve
      })
      secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
        async (
          _previous: unknown,
          _next: unknown,
          target: AppData,
          persist: (snapshot: AppData) => Promise<AppData>,
        ) => {
          await replacementCommit
          return persist(target)
        },
      )

      const importing = useAppStore.getState().importBackup(
        new File(['{}'], 'backup.json', { type: 'application/json' }),
      )
      await vi.waitFor(() =>
        expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
      )

      const beforeMutation = useAppStore.getState().data
      switch (kind) {
        case 'theme':
          useAppStore.getState().setTheme('dark')
          break
        case 'sync gist id':
          useAppStore.getState().setSyncGistId('stale-gist')
          break
        case 'provider name':
          useAppStore.getState().updateProvider(
            data.providers[0].id,
            { name: 'stale-provider-name' },
          )
          break
        case 'skill settings':
          useAppStore.getState().updateSkillSettings({ contextBudget: 2400 })
          break
        case 'message content':
          useAppStore.getState().editMessage(user.id, 'stale message')
          break
      }

      expect(useAppStore.getState().data).toBe(beforeMutation)
      releaseReplacement()
      await importing
      const finalData = useAppStore.getState().data
      if (!finalData) throw new Error('import did not publish AppData')
      expect({ ...finalData, updatedAt: importedData.updatedAt }).toEqual(importedData)
      expect(finalData.updatedAt).toBeGreaterThanOrEqual(importedData.updatedAt)
    },
  )

  it('does not schedule auto-sync for a rejected Skill settings mutation', async () => {
    const data = resetStore()
    data.sync = {
      ...data.sync,
      autoSync: true,
      gistFile: 'backup.json',
      gistId: 'gist-id',
      mode: 'gist',
    }
    resetStore(data)
    useAppStore.setState({
      githubToken: 'github-token',
      syncPassphrase: 'passphrase',
    })
    const importedData = structuredClone(data)
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: importedData,
      secrets: { providerKeys: {} },
    })

    let releaseReplacement!: () => void
    const replacementCommit = new Promise<void>((resolve) => {
      releaseReplacement = resolve
    })
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await replacementCommit
        return persist(target)
      },
    )

    const importing = useAppStore.getState().importBackup(
      new File(['{}'], 'backup.json', { type: 'application/json' }),
    )
    await vi.waitFor(() =>
      expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
    )
    syncMocks.performSync.mockClear()
    useAppStore.getState().updateSkillSettings({ contextBudget: 2400 })
    expect(useAppStore.getState().data).not.toBeNull()

    releaseReplacement()
    await importing
    await vi.advanceTimersByTimeAsync(25)
    expect(syncMocks.performSync).not.toHaveBeenCalled()
  })

  it.each(['import', 'reset'] as const)(
    'blocks text and image admission while a %s replacement is committing',
    async (kind) => {
      const data = resetStore()
      let releaseReplacement!: () => void
      const replacementCommit = new Promise<void>((resolve) => {
        releaseReplacement = resolve
      })

      let replacement: Promise<void>
      if (kind === 'import') {
        useAppStore.setState({ syncPassphrase: 'passphrase' })
        cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
        cryptoMocks.decryptVault.mockResolvedValue({
          data: structuredClone(data),
          secrets: { providerKeys: {} },
        })
        secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
          async (
            _previous: unknown,
            _next: unknown,
            target: AppData,
            persist: (snapshot: AppData) => Promise<AppData>,
          ) => {
            await replacementCommit
            return persist(target)
          },
        )
        replacement = useAppStore.getState().importBackup(
          new File(['{}'], 'backup.json', { type: 'application/json' }),
        )
      } else {
        secretMocks.commitZeroChatSecretSnapshotWithAppData.mockImplementationOnce(
          async (
            _previous: unknown,
            _next: unknown,
            target: AppData,
            persist: (snapshot: AppData) => Promise<AppData>,
          ) => {
            await replacementCommit
            return persist(target)
          },
        )
        replacement = useAppStore.getState().resetAll()
      }

      await vi.waitFor(() => {
        if (kind === 'import') {
          expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce()
        } else {
          expect(secretMocks.commitZeroChatSecretSnapshotWithAppData).toHaveBeenCalledOnce()
        }
      })

      await expect(
        useAppStore.getState().sendMessage('blocked text'),
      ).resolves.toBe(false)
      await expect(
        useAppStore.getState().sendMessage('blocked image', {
          mode: 'image',
          imageTaskMode: 'generate',
        }),
      ).resolves.toBe(false)
      expect(runtime.streamChat).not.toHaveBeenCalled()
      expect(runtime.generateImage).not.toHaveBeenCalled()

      releaseReplacement()
      await replacement
    },
  )

  it.each([
    ['reset', 'conversation'],
    ['reset', 'message'],
    ['import', 'conversation'],
    ['import', 'message'],
  ] as const)(
    'does not show the %s deletion confirmation while a replacement owns the lease',
    async (replacementKind, kind) => {
      const data = resetStore()
      const conversation = data.conversations[0]
      const targetMessage = message(
        'replacement-delete-user',
        'user',
        'delete after replacement',
      )
      withMessages(data, [targetMessage])
      let releaseReplacement!: () => void
      const replacementCommit = new Promise<void>((resolve) => {
        releaseReplacement = resolve
      })
      let replacement: Promise<void>
      if (replacementKind === 'import') {
        const importedData = structuredClone(useAppStore.getState().data!)
        importedData.preferences.theme = 'dark'
        importedData.updatedAt += 1
        useAppStore.setState({ syncPassphrase: 'passphrase' })
        cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
        cryptoMocks.decryptVault.mockResolvedValue({
          data: importedData,
          secrets: { providerKeys: {} },
        })
        secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
          async (
            _previous: unknown,
            _next: unknown,
            target: AppData,
            persist: (snapshot: AppData) => Promise<AppData>,
          ) => {
            await replacementCommit
            return persist(target)
          },
        )
        replacement = useAppStore.getState().importBackup(
          new File(['{}'], 'backup.json', { type: 'application/json' }),
        )
      } else {
        secretMocks.commitZeroChatSecretSnapshotWithAppData.mockImplementationOnce(
          async (
            _previous: unknown,
            _next: unknown,
            target: AppData,
            persist: (snapshot: AppData) => Promise<AppData>,
          ) => {
            await replacementCommit
            return persist(target)
          },
        )
        replacement = useAppStore.getState().resetAll()
      }
      await vi.waitFor(() => {
        if (replacementKind === 'import') {
          expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce()
        } else {
          expect(secretMocks.commitZeroChatSecretSnapshotWithAppData).toHaveBeenCalledOnce()
        }
      })
      const before = useAppStore.getState().data
      const confirm = vi.mocked(globalThis.confirm)
      confirm.mockClear()
      dbMocks.saveAppData.mockClear()

      const deleting =
        kind === 'conversation'
          ? useAppStore.getState().deleteConversation(conversation.id)
          : useAppStore.getState().deleteMessage(targetMessage.id)

      try {
        await expect(deleting).resolves.toBe(false)
        expect(confirm).not.toHaveBeenCalled()
        expect(dbMocks.saveAppData).not.toHaveBeenCalled()
        expect(useAppStore.getState().data).toBe(before)
      } finally {
        releaseReplacement()
        await replacement
      }
    },
  )

  it('does not show the missing-Provider new-conversation notice while reset owns the lease', async () => {
    const data = freshData()
    data.providers = []
    data.conversations = []
    data.preferences.activeConversationId = undefined
    resetStore(data)

    let releaseReset!: () => void
    const pendingResetCommit = new Promise<void>((resolve) => {
      releaseReset = resolve
    })
    secretMocks.commitZeroChatSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await pendingResetCommit
        return persist(target)
      },
    )

    const resetting = useAppStore.getState().resetAll()
    await vi.waitFor(() =>
      expect(secretMocks.commitZeroChatSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
    )
    const beforeToasts = useAppStore.getState().toasts

    await expect(useAppStore.getState().createNewConversation()).resolves.toBe(false)
    expect(useAppStore.getState().settingsOpen).toBe(false)
    expect(useAppStore.getState().toasts).toEqual(beforeToasts)

    releaseReset()
    await resetting
  })

  it('does not start a new image attachment while reset owns the lease', async () => {
    resetStore()

    let releaseReset!: () => void
    const pendingResetCommit = new Promise<void>((resolve) => {
      releaseReset = resolve
    })
    secretMocks.commitZeroChatSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await pendingResetCommit
        return persist(target)
      },
    )

    const resetting = useAppStore.getState().resetAll()
    await vi.waitFor(() =>
      expect(secretMocks.commitZeroChatSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
    )

    await useAppStore.getState().attachImage(imageFile('blocked.png'))
    expect(imageMocks.fileToDataUrl).not.toHaveBeenCalled()
    expect(useAppStore.getState().composerImages).toEqual([])

    releaseReset()
    await resetting
  })

  it('does not show a Provider busy notice for a disable rejected by reset admission', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    let releaseStream!: () => void
    runtime.streamChat.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<void>((resolve) => {
          expect(signal.aborted).toBe(false)
          releaseStream = resolve
        }),
    )

    const sending = useAppStore.getState().sendMessage('reset before disable')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())

    let releaseReset!: () => void
    const pendingResetCommit = new Promise<void>((resolve) => {
      releaseReset = resolve
    })
    secretMocks.commitZeroChatSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await pendingResetCommit
        return persist(target)
      },
    )

    const resetting = useAppStore.getState().resetAll()
    await vi.waitFor(() =>
      expect(useAppStore.getState().abortController?.signal.aborted).toBe(true),
    )
    const beforeToasts = useAppStore.getState().toasts

    await expect(
      useAppStore.getState().setProviderEnabled(providerId, false),
    ).resolves.toBe(false)
    expect(useAppStore.getState().toasts).toEqual(beforeToasts)

    releaseStream()
    await sending
    await vi.waitFor(() =>
      expect(secretMocks.commitZeroChatSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
    )
    releaseReset()
    await resetting
  })

  it('does not freeze generation for an unrelated secret lifecycle write', async () => {
    const data = freshData()
    const unrelatedProvider = {
      ...data.providers[0],
      id: 'unrelated-provider',
      name: 'Unrelated Provider',
    }
    data.providers.push(unrelatedProvider)
    resetStore(data)
    let releaseKeyWrite!: () => void
    const keyWrite = new Promise<void>((resolve) => {
      releaseKeyWrite = resolve
    })
    secretMocks.setProviderKey.mockImplementationOnce(async () => {
      await keyWrite
    })

    const savingKey = useAppStore
      .getState()
      .saveProviderKey(unrelatedProvider.id, 'new-key')
    await vi.waitFor(() => expect(secretMocks.setProviderKey).toHaveBeenCalledOnce())

    await expect(useAppStore.getState().sendMessage('during key write')).resolves.toBe(true)
    expect(runtime.streamChat).toHaveBeenCalledOnce()

    releaseKeyWrite()
    await savingKey
  })

  it.each(['regenerate', 'retry', 'edit'] as const)(
    'does not admit %s while a replacement lease is held',
    async (kind) => {
      const data = resetStore()
      const user = message('replacement-user', 'user', 'old prompt')
      const assistant = message('replacement-assistant', 'assistant', 'old reply', {
        error: 'old error',
        status: 'error',
      })
      withMessages(data, [user, assistant])

      let releaseReplacement!: () => void
      const replacementCommit = new Promise<void>((resolve) => {
        releaseReplacement = resolve
      })
      secretMocks.commitZeroChatSecretSnapshotWithAppData.mockImplementationOnce(
        async (
          _previous: unknown,
          _next: unknown,
          target: AppData,
          persist: (snapshot: AppData) => Promise<AppData>,
        ) => {
          await replacementCommit
          return persist(target)
        },
      )

      const resetting = useAppStore.getState().resetAll()
      await vi.waitFor(() =>
        expect(secretMocks.commitZeroChatSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
      )
      const before = useAppStore.getState().data

      if (kind === 'regenerate') {
        await useAppStore.getState().regenerate()
      } else if (kind === 'retry') {
        await useAppStore.getState().retryMessage(assistant.id)
      } else {
        await expect(
          useAppStore.getState().editAndResendMessage(user.id, 'new prompt'),
        ).resolves.toBe(false)
      }

      expect(useAppStore.getState().data).toBe(before)
      expect(runtime.streamChat).not.toHaveBeenCalled()
      expect(runtime.generateImage).not.toHaveBeenCalled()

      releaseReplacement()
      await resetting
    },
  )

  it('does not admit offline replay while a reset replacement owns the lease', async () => {
    const data = resetStore()
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('queued before reset')
    await useAppStore.getState().flushLocalSaves()

    let releaseReplacement!: () => void
    const replacementCommit = new Promise<void>((resolve) => {
      releaseReplacement = resolve
    })
    secretMocks.commitZeroChatSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await replacementCommit
        return persist(target)
      },
    )

    const resetting = useAppStore.getState().resetAll()
    await vi.waitFor(() =>
      expect(secretMocks.commitZeroChatSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
    )

    navigatorStub.onLine = true
    const replay = useAppStore.getState().flushOfflineQueue()
    await Promise.resolve()
    await Promise.resolve()

    expect(streamMocks.streamAssistantText).not.toHaveBeenCalled()

    releaseReplacement()
    await resetting
    await replay
    expect(useAppStore.getState().data).not.toBe(data)
  })

  it.each(['import', 'reset'] as const)(
    'requeues a claimed offline replay before a failed %s replacement can publish',
    async (kind) => {
      const data = resetStore()
      const navigatorStub = { language: 'en-US', onLine: false }
      vi.stubGlobal('navigator', navigatorStub)
      await useAppStore.getState().sendMessage('requeue before replacement')
      await useAppStore.getState().flushLocalSaves()
      dbMocks.saveAppData.mockClear()

      const originalStopAudioTranscription =
        useAppStore.getState().stopAudioTranscription
      const stopAudioTranscription = vi.fn()
      useAppStore.setState({ stopAudioTranscription })

      const events: string[] = []
      let releaseClaim!: () => void
      const claimSave = new Promise<void>((resolve) => {
        releaseClaim = resolve
      })
      let claimSaveSeen = false
      dbMocks.saveAppData.mockImplementation(async (snapshot: unknown) => {
        const assistant = (snapshot as AppData).conversations[0]?.messages.at(-1)
        events.push(
          assistant?.status === 'streaming' ? 'claim-save' : 'queued-save',
        )
        if (!claimSaveSeen) {
          claimSaveSeen = true
          await claimSave
        }
      })

      let replacementCommitStarted = false
      if (kind === 'import') {
        useAppStore.setState({ syncPassphrase: 'passphrase' })
        cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
        cryptoMocks.decryptVault.mockResolvedValue({
          data: structuredClone(data),
          secrets: { providerKeys: {} },
        })
        secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
          async () => {
            replacementCommitStarted = true
            events.push('replacement-commit')
            throw new Error('replacement import failed')
          },
        )
      } else {
        secretMocks.commitZeroChatSecretSnapshotWithAppData.mockImplementationOnce(
          async () => {
            replacementCommitStarted = true
            events.push('replacement-commit')
            throw new Error('replacement reset failed')
          },
        )
      }

      navigatorStub.onLine = true
      const replay = useAppStore.getState().flushOfflineQueue()
      await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())
      const replacement =
        kind === 'import'
          ? useAppStore.getState().importBackup(
              new File(['{}'], 'backup.json', { type: 'application/json' }),
            )
          : useAppStore.getState().resetAll()
      await vi.waitFor(() =>
        expect(stopAudioTranscription).toHaveBeenCalledOnce(),
      )
      await Promise.resolve()
      await Promise.resolve()
      expect(replacementCommitStarted).toBe(false)

      releaseClaim()
      await Promise.all([replay, replacement])
      useAppStore.setState({ stopAudioTranscription: originalStopAudioTranscription })

      expect(events).toEqual(['claim-save', 'queued-save', 'replacement-commit'])
      const requeued = useAppStore.getState().data?.conversations[0].messages.at(-1)
      expect(requeued).toMatchObject({
        content: appT(data, 'message.queued'),
        status: 'queued',
      })
      expect(requeued).not.toHaveProperty('offlineReplayClaim')
      expect(requeued).toHaveProperty('queuedTextRequest')
      expect(streamMocks.streamAssistantText).not.toHaveBeenCalled()

      await useAppStore.getState().flushOfflineQueue()
      expect(streamMocks.streamAssistantText).toHaveBeenCalledOnce()
    },
  )

  it.each(['import', 'reset'] as const)(
    'drains a claimed offline replay before a successful %s replacement publishes',
    async (kind) => {
      const data = resetStore()
      const navigatorStub = { language: 'en-US', onLine: false }
      vi.stubGlobal('navigator', navigatorStub)
      await useAppStore.getState().sendMessage('old replay must not publish')
      await useAppStore.getState().flushLocalSaves()
      const oldAssistantId = useAppStore
        .getState()
        .data?.conversations[0].messages.at(-1)?.id
      dbMocks.saveAppData.mockClear()
      const originalStopAudioTranscription =
        useAppStore.getState().stopAudioTranscription
      const stopAudioTranscription = vi.fn()
      useAppStore.setState({ stopAudioTranscription })

      const events: string[] = []
      let releaseClaim!: () => void
      const claimSave = new Promise<void>((resolve) => {
        releaseClaim = resolve
      })
      let claimSaveSeen = false
      let replacementCommitStarted = false
      dbMocks.saveAppData.mockImplementation(async (snapshot: unknown) => {
        const assistant = (snapshot as AppData).conversations[0]?.messages.at(-1)
        if (!claimSaveSeen) {
          claimSaveSeen = true
          events.push('claim-save')
          await claimSave
          return
        }
        events.push(replacementCommitStarted ? 'replacement-save' : 'requeue-save')
        if (assistant?.status === 'streaming') {
          throw new Error('unexpected second claim')
        }
      })

      const publishedSnapshots: AppData[] = []
      if (kind === 'import') {
        const importedData = freshData()
        importedData.preferences.theme = 'dark'
        useAppStore.setState({ syncPassphrase: 'passphrase' })
        cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
        cryptoMocks.decryptVault.mockResolvedValue({
          data: importedData,
          secrets: { providerKeys: {} },
        })
        secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
          async (
            _previous: unknown,
            _next: unknown,
            target: AppData,
            persist: (snapshot: AppData) => Promise<AppData>,
          ) => {
            replacementCommitStarted = true
            events.push('replacement-commit')
            publishedSnapshots.push(target)
            return persist(target)
          },
        )
      } else {
        secretMocks.commitZeroChatSecretSnapshotWithAppData.mockImplementationOnce(
          async (
            _previous: unknown,
            _next: unknown,
            target: AppData,
            persist: (snapshot: AppData) => Promise<AppData>,
          ) => {
            replacementCommitStarted = true
            events.push('replacement-commit')
            publishedSnapshots.push(target)
            return persist(target)
          },
        )
      }

      navigatorStub.onLine = true
      const replay = useAppStore.getState().flushOfflineQueue()
      await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())
      const replacement =
        kind === 'import'
          ? useAppStore.getState().importBackup(
              new File(['{}'], 'backup.json', { type: 'application/json' }),
            )
          : useAppStore.getState().resetAll()
      await vi.waitFor(() =>
        expect(stopAudioTranscription).toHaveBeenCalledOnce(),
      )

      releaseClaim()
      await Promise.all([replay, replacement])
      useAppStore.setState({ stopAudioTranscription: originalStopAudioTranscription })

      const requeueIndex = events.indexOf('requeue-save')
      const publishIndex = events.indexOf('replacement-commit')
      expect(requeueIndex).toBeGreaterThanOrEqual(0)
      expect(publishIndex).toBeGreaterThan(requeueIndex)
      expect(publishedSnapshots).toHaveLength(1)
      const publishedMessages = publishedSnapshots[0].conversations.flatMap(
        (conversation) => conversation.messages,
      )
      expect(publishedMessages.some((message) => message.id === oldAssistantId)).toBe(false)
      expect(publishedMessages.some((message) => message.offlineReplayClaim)).toBe(false)
      expect(publishedMessages.some((message) => message.content === 'replayed')).toBe(false)
      expect(streamMocks.streamAssistantText).not.toHaveBeenCalled()
      expect(data.conversations[0].messages).toHaveLength(0)
    },
  )

  it('does not yield between a replay lease check and its next Provider side effect', async () => {
    const data = freshData()
    data.providers[0] = {
      ...data.providers[0],
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'proxy-passphrase' })
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    const originalStopStreaming = useAppStore.getState().stopStreaming
    useAppStore.setState({ stopStreaming: vi.fn(async () => false) })
    await useAppStore.getState().sendMessage('microtask lease ordering')
    await useAppStore.getState().flushLocalSaves()

    const events: string[] = []
    let replacement: Promise<void> | undefined
    secretMocks.commitZeroChatSecretSnapshotWithAppData.mockImplementationOnce(
      async () => {
        throw new Error('microtask replacement failed')
      },
    )
    accessKeyMocks.accessKeyFromPassword.mockImplementationOnce(
      () =>
        ({
          then(resolve: (value: string) => void) {
            resolve('proxy-token')
            queueMicrotask(() => {
              queueMicrotask(() => {
                events.push('replacement-start')
                replacement = useAppStore.getState().resetAll()
              })
            })
          },
        }) as unknown as Promise<string>,
    )
    streamMocks.streamAssistantText.mockImplementationOnce(
      async () => {
        events.push('provider')
      },
    )

    navigatorStub.onLine = true
    const replay = useAppStore.getState().flushOfflineQueue()
    try {
      await vi.waitFor(() =>
        expect(streamMocks.streamAssistantText).toHaveBeenCalledOnce(),
      )
      await vi.waitFor(() => expect(replacement).toBeDefined())
      await replay
      await replacement

      expect(events.indexOf('provider')).toBeGreaterThanOrEqual(0)
      expect(events.indexOf('replacement-start')).toBeGreaterThanOrEqual(0)
      expect(events.indexOf('provider')).toBeLessThan(
        events.indexOf('replacement-start'),
      )

      const requeued = useAppStore.getState().data?.conversations[0].messages.at(-1)
      expect(requeued).toMatchObject({
        content: appT(data, 'message.queued'),
        status: 'queued',
      })
      expect(requeued).not.toHaveProperty('offlineReplayClaim')
      expect(requeued).toHaveProperty('queuedTextRequest')

      await useAppStore.getState().flushOfflineQueue()
      expect(
        useAppStore.getState().data?.conversations[0].messages.at(-1),
      ).toMatchObject({ content: 'replayed', status: 'done' })
    } finally {
      useAppStore.setState({ stopStreaming: originalStopStreaming })
    }
  })

  it('does not leave a claimed replay when a replacement starts after stream completion', async () => {
    const data = freshData()
    data.providers[0] = {
      ...data.providers[0],
      clientRequestMode: false,
      needsApiKey: false,
      proxyUrl: 'https://proxy.invalid',
    }
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'proxy-passphrase' })
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    const originalStopStreaming = useAppStore.getState().stopStreaming
    useAppStore.setState({ stopStreaming: vi.fn(async () => false) })
    await useAppStore.getState().sendMessage('post-stream lease ordering')
    await useAppStore.getState().flushLocalSaves()

    const events: string[] = []
    let replacement: Promise<void> | undefined
    secretMocks.commitZeroChatSecretSnapshotWithAppData.mockImplementationOnce(
      async () => {
        events.push('replacement-commit')
        throw new Error('post-stream replacement failed')
      },
    )
    dbMocks.saveAppData.mockImplementation(async (snapshot: unknown) => {
      const assistant = (snapshot as AppData).conversations[0]?.messages.at(-1)
      if (assistant?.status === 'done') events.push('terminal-save')
    })
    streamMocks.streamAssistantText.mockImplementationOnce(
      () =>
        ({
          then(resolve: (value: void) => void) {
            resolve(undefined)
            queueMicrotask(() => {
              queueMicrotask(() => {
                events.push('replacement-start')
                replacement = useAppStore.getState().resetAll()
              })
            })
          },
        }) as unknown as Promise<void>,
    )

    navigatorStub.onLine = true
    const replay = useAppStore.getState().flushOfflineQueue()
    try {
      await vi.waitFor(() =>
        expect(streamMocks.streamAssistantText).toHaveBeenCalledOnce(),
      )
      await vi.waitFor(() => expect(replacement).toBeDefined())
      await Promise.all([replay, replacement])

      const assistant = useAppStore
        .getState()
        .data?.conversations[0].messages.at(-1)
      expect(assistant).toMatchObject({ status: 'queued' })
      expect(assistant).not.toHaveProperty('offlineReplayClaim')
      expect(assistant).toHaveProperty('queuedTextRequest')
      expect(events).toContain('replacement-commit')
    } finally {
      useAppStore.setState({ stopStreaming: originalStopStreaming })
    }
  })

  it('cleans old Skill refs after a reset replacement is durable', async () => {
    const oldRef = 'skill-chunk:reset-old'
    const data = resetStore({
      ...freshData(),
      skills: [
        skill('reset-skill', {
          chunks: [
            {
              contentRef: oldRef,
              heading: 'Old body',
              id: 'reset-chunk',
              keywords: [],
              tokenEstimate: 1,
            },
          ],
        }),
      ],
    })
    const events: string[] = []
    secretMocks.commitZeroChatSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        events.push('replacement-start')
        const persisted = await persist(target)
        events.push('replacement-committed')
        return persisted
      },
    )
    dbMocks.deleteSkillContentRefs.mockImplementationOnce(async (refs) => {
      events.push(`cleanup:${refs.join(',')}`)
    })

    await useAppStore.getState().resetAll()

    expect(events).toEqual([
      'replacement-start',
      'replacement-committed',
      `cleanup:${oldRef}`,
    ])
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith([oldRef])
    expect(useAppStore.getState().data?.skills).toEqual([])
    expect(data.skills).toHaveLength(1)
  })

  it('drains an in-flight local save before publishing a reset replacement', async () => {
    resetStore()
    let releaseSave!: () => void
    const localSave = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    dbMocks.saveAppData.mockImplementationOnce(async () => {
      await localSave
    })

    useAppStore.getState().setTheme('dark')
    await vi.advanceTimersByTimeAsync(300)
    expect(dbMocks.saveAppData).toHaveBeenCalledOnce()

    const resetting = useAppStore.getState().resetAll()
    await Promise.resolve()
    expect(secretMocks.commitZeroChatSecretSnapshotWithAppData).not.toHaveBeenCalled()

    releaseSave()
    await resetting
    expect(secretMocks.commitZeroChatSecretSnapshotWithAppData).toHaveBeenCalledOnce()
    expect(useAppStore.getState().data?.preferences.theme).toBe('system')
    expect(dbMocks.saveAppData).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({ theme: 'dark' }),
      }),
    )
  })

  it('drains an in-flight local save before publishing an imported replacement', async () => {
    const data = resetStore()
    const importedData = structuredClone(data)
    importedData.preferences.theme = 'light'
    importedData.updatedAt += 1
    useAppStore.setState({ syncPassphrase: 'passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: importedData,
      secrets: { providerKeys: {} },
    })

    let releaseSave!: () => void
    const localSave = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    dbMocks.saveAppData.mockImplementationOnce(async () => {
      await localSave
    })
    useAppStore.getState().setTheme('dark')
    await vi.advanceTimersByTimeAsync(300)
    expect(dbMocks.saveAppData).toHaveBeenCalledOnce()

    const importing = useAppStore.getState().importBackup(
      new File(['{}'], 'backup.json', { type: 'application/json' }),
    )
    await Promise.resolve()
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).not.toHaveBeenCalled()

    releaseSave()
    await importing
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce()
    expect(useAppStore.getState().data?.preferences.theme).toBe('light')
    const saves = dbMocks.saveAppData.mock.calls.map(([snapshot]) => snapshot as AppData)
    const importedIndex = saves.findIndex(
      (snapshot) => snapshot.preferences.theme === 'light',
    )
    expect(importedIndex).toBeGreaterThanOrEqual(0)
    expect(
      saves.slice(importedIndex + 1).some(
        (snapshot) => snapshot.preferences.theme === 'dark',
      ),
    ).toBe(false)
  })

  it('does not stop a generation when import validation fails before replacement ownership', async () => {
    resetStore()
    const stopAudioTranscription = vi.fn()
    useAppStore.setState({
      stopAudioTranscription: stopAudioTranscription as () => void,
    })
    runtime.streamChat.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        }),
    )
    const generation = useAppStore.getState().sendMessage('keep running')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())

    cryptoMocks.isEncryptedSnapshot.mockReturnValue(false)
    await useAppStore.getState().importBackup(
      new File(['{}'], 'invalid.json', { type: 'application/json' }),
    )

    expect(useAppStore.getState().streaming).toBe(true)
    expect(stopAudioTranscription).not.toHaveBeenCalled()
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).not.toHaveBeenCalled()

    await useAppStore.getState().stopStreaming()
    await generation
  })

  it('does not stop a generation when backup decryption fails before replacement ownership', async () => {
    resetStore()
    const keys = useAppStore.getState().keys
    const stopAudioTranscription = vi.fn()
    useAppStore.setState({
      stopAudioTranscription: stopAudioTranscription as () => void,
      syncPassphrase: 'backup-passphrase',
    })

    runtime.streamChat.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        }),
    )
    const generation = useAppStore.getState().sendMessage('keep running')
    await vi.waitFor(() => expect(runtime.streamChat).toHaveBeenCalledOnce())
    const activeData = useAppStore.getState().data

    let rejectDecrypt!: (error: Error) => void
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectDecrypt = reject
        }),
    )

    const importing = useAppStore.getState().importBackup(
      new File(['{}'], 'decrypt-failure.json', { type: 'application/json' }),
    )
    await vi.waitFor(() => expect(cryptoMocks.decryptVault).toHaveBeenCalledOnce())

    expect(useAppStore.getState().streaming).toBe(true)
    expect(stopAudioTranscription).not.toHaveBeenCalled()
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).not.toHaveBeenCalled()

    rejectDecrypt(new Error('backup decryption failed'))
    await importing

    expect(useAppStore.getState().data).toBe(activeData)
    expect(useAppStore.getState().keys).toBe(keys)
    expect(useAppStore.getState().streaming).toBe(true)
    expect(stopAudioTranscription).not.toHaveBeenCalled()

    await useAppStore.getState().stopStreaming()
    await generation
  })

  it('releases a failed import replacement gate and preserves the old state', async () => {
    const data = resetStore()
    const previousKeys = useAppStore.getState().keys
    useAppStore.setState({ syncPassphrase: 'passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: freshData(),
      secrets: { providerKeys: {} },
    })
    secretMocks.commitProviderSecretSnapshotWithAppData.mockRejectedValueOnce(
      new Error('import commit failed'),
    )

    await useAppStore.getState().importBackup(
      new File(['{}'], 'backup.json', { type: 'application/json' }),
    )

    expect(useAppStore.getState().data).toBe(data)
    expect(useAppStore.getState().keys).toBe(previousKeys)
    await expect(
      useAppStore.getState().sendMessage('send after failed import'),
    ).resolves.toBe(true)
    expect(runtime.streamChat).toHaveBeenCalledOnce()
  })

  it('keeps sync behind a reset already in the lifecycle lane', async () => {
    resetStore()
    let resolveReset: (() => void) | undefined
    secretMocks.commitZeroChatSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await new Promise<void>((resolve) => {
          resolveReset = resolve
        })
        return persist(target)
      },
    )

    const reset = useAppStore.getState().resetAll()
    await vi.waitFor(() =>
      expect(secretMocks.commitZeroChatSecretSnapshotWithAppData).toHaveBeenCalled(),
    )
    const sync = useAppStore.getState().syncNow()
    await Promise.resolve()
    expect(syncMocks.performSync).not.toHaveBeenCalled()

    resolveReset?.()
    await reset
    await sync
    expect(syncMocks.performSync).toHaveBeenCalledTimes(1)
  })

  it('keeps sync behind an encrypted backup replacement in the lifecycle lane', async () => {
    const data = resetStore()
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: structuredClone(data),
      secrets: { providerKeys: {} },
    })
    await useAppStore.getState().setSyncPassphrase('passphrase')

    let resolveImport: (() => void) | undefined
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await new Promise<void>((resolve) => {
          resolveImport = resolve
        })
        return persist(target)
      },
    )

    const imported = useAppStore.getState().importBackup(
      new File(['{}'], 'backup.json', { type: 'application/json' }),
    )
    await vi.waitFor(() =>
      expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalled(),
    )
    const sync = useAppStore.getState().syncNow()
    await Promise.resolve()
    expect(syncMocks.performSync).not.toHaveBeenCalled()

    resolveImport?.()
    await imported
    await sync
    expect(syncMocks.performSync).toHaveBeenCalledTimes(1)
  })

  it('does not publish an active sync result after an imported replacement takes ownership', async () => {
    resetStore()
    await useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')
    expect(useAppStore.getState().data?.sync.mode).toBe('gist')
    expect(useAppStore.getState().syncPassphrase).toBe('passphrase')

    const current = useAppStore.getState().data as AppData
    const staleSyncData = structuredClone(current)
    staleSyncData.preferences.theme = 'light'
    staleSyncData.updatedAt += 1
    let resolveSync!: (result: SyncResult) => void
    syncMocks.performSync.mockImplementationOnce(
      () =>
        new Promise<SyncResult>((resolve) => {
          resolveSync = resolve
        }),
    )

    const activeSync = useAppStore.getState().syncNow()
    await vi.waitFor(() => expect(syncMocks.performSync).toHaveBeenCalledOnce())

    const importedData = structuredClone(current)
    importedData.preferences.theme = 'dark'
    importedData.updatedAt += 2
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: importedData,
      secrets: { providerKeys: {} },
    })

    const importing = useAppStore.getState().importBackup(
      new File(['{}'], 'active-sync-import.json', { type: 'application/json' }),
    )
    await vi.waitFor(() => expect(cryptoMocks.decryptVault).toHaveBeenCalledOnce())
    expect(cryptoMocks.isEncryptedSnapshot).toHaveBeenCalledWith({})
    await vi.waitFor(() =>
      expect(
        syncMocks.performSync.mock.calls[0]?.[1]?.shouldDeferRemoteWrite?.(),
      ).toBe(true),
    )
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).not.toHaveBeenCalled()

    resolveSync(syncResult(staleSyncData))
    await activeSync
    await importing

    expect(
      secretMocks.commitProviderSecretSnapshotWithAppData.mock.calls
        .map(([, , target]) => (target as AppData).preferences.theme),
    ).not.toContain('light')
    expect(useAppStore.getState().data?.preferences.theme).toBe('dark')
  })

  it('coalesces a sync request that arrives while the current publish is active', async () => {
    const data = resetStore()
    useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')

    let resolveFirst: ((result: SyncResult) => void) | undefined
    syncMocks.performSync.mockImplementationOnce(
      () =>
        new Promise<SyncResult>((resolve) => {
          resolveFirst = resolve
        }),
    )
    let resolveSecond: ((result: SyncResult) => void) | undefined
    syncMocks.performSync.mockImplementationOnce(
      () =>
        new Promise<SyncResult>((resolve) => {
          resolveSecond = resolve
        }),
    )

    const first = useAppStore.getState().syncNow()
    await vi.waitFor(() => expect(syncMocks.performSync).toHaveBeenCalledTimes(1))
    let secondSettled = false
    const second = useAppStore.getState().syncNow()
    void second.then(() => {
      secondSettled = true
    })
    expect(syncMocks.performSync).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(secondSettled).toBe(false)

    resolveFirst?.(syncResult(data))
    await vi.waitFor(() => expect(syncMocks.performSync).toHaveBeenCalledTimes(2))
    expect(secondSettled).toBe(false)
    resolveSecond?.(syncResult(data))
    await first
    await second
    expect(secondSettled).toBe(true)
  })

  it('settles queued sync callers after the next attempt reports an error', async () => {
    const data = resetStore()
    useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')

    let resolveFirst: ((result: SyncResult) => void) | undefined
    syncMocks.performSync.mockImplementationOnce(
      () =>
        new Promise<SyncResult>((resolve) => {
          resolveFirst = resolve
        }),
    )
    let rejectSecond: ((error: Error) => void) | undefined
    syncMocks.performSync.mockImplementationOnce(
      () =>
        new Promise<SyncResult>((_resolve, reject) => {
          rejectSecond = reject
        }),
    )

    const first = useAppStore.getState().syncNow()
    await vi.waitFor(() => expect(syncMocks.performSync).toHaveBeenCalledTimes(1))
    const second = useAppStore.getState().syncNow()
    let secondSettled = false
    void second.then(() => {
      secondSettled = true
    })
    resolveFirst?.(syncResult(data))

    await vi.waitFor(() => expect(syncMocks.performSync).toHaveBeenCalledTimes(2))
    expect(secondSettled).toBe(false)
    rejectSecond?.(new Error('queued sync failed'))
    await first
    await second
    expect(secondSettled).toBe(true)
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'queued sync failed',
      tone: 'error',
    })
    expect(useAppStore.getState().syncing).toBe(false)
  })

  it('keeps a queued explicit conflict strategy ahead of a later automatic request', async () => {
    const data = resetStore()
    useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')

    let resolveFirst: ((result: SyncResult) => void) | undefined
    let resolveSecond: ((result: SyncResult) => void) | undefined
    syncMocks.performSync.mockImplementationOnce(
      () =>
        new Promise<SyncResult>((resolve) => {
          resolveFirst = resolve
        }),
    )
    syncMocks.performSync.mockImplementationOnce(
      () =>
        new Promise<SyncResult>((resolve) => {
          resolveSecond = resolve
        }),
    )

    const first = useAppStore.getState().syncNow()
    await vi.waitFor(() => expect(syncMocks.performSync).toHaveBeenCalledTimes(1))
    const explicit = useAppStore.getState().resolveSyncConflict('use-local')
    const automatic = useAppStore.getState().syncNow()
    let explicitSettled = false
    let automaticSettled = false
    void explicit.then(() => {
      explicitSettled = true
    })
    void automatic.then(() => {
      automaticSettled = true
    })

    resolveFirst?.(syncResult(data))
    await vi.waitFor(() => expect(syncMocks.performSync).toHaveBeenCalledTimes(2))
    expect(syncMocks.performSync.mock.calls[1]?.[1]).toMatchObject({
      firstSyncStrategy: 'use-local',
    })
    expect(explicitSettled).toBe(false)
    expect(automaticSettled).toBe(false)

    resolveSecond?.(syncResult(data))
    await Promise.all([first, explicit, automatic])
    expect(explicitSettled).toBe(true)
    expect(automaticSettled).toBe(true)
  })

  it('keeps foreground pulls read-only while a queued manual sync owns the next write', async () => {
    const data = resetStore()
    useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')
    let resolvePull!: (result: SyncResult) => void
    let resolveManual!: (result: SyncResult) => void
    syncMocks.performSync.mockImplementationOnce(
      () =>
        new Promise<SyncResult>((resolve) => {
          resolvePull = resolve
        }),
    )
    syncMocks.performSync.mockImplementationOnce(
      () =>
        new Promise<SyncResult>((resolve) => {
          resolveManual = resolve
        }),
    )

    const pull = useAppStore.getState().runAutomaticSync(true)
    await vi.waitFor(() => expect(syncMocks.performSync).toHaveBeenCalledTimes(1))
    const pullContext = syncMocks.performSync.mock.calls[0]?.[1]
    expect(pullContext?.shouldDeferRemoteWrite?.()).toBe(true)

    const manual = useAppStore.getState().syncNow('use-local')
    resolvePull(syncResult(data))
    await vi.waitFor(() => expect(syncMocks.performSync).toHaveBeenCalledTimes(2))
    const manualContext = syncMocks.performSync.mock.calls[1]?.[1]
    expect(manualContext).toMatchObject({ firstSyncStrategy: 'use-local' })
    expect(manualContext?.shouldDeferRemoteWrite?.()).toBe(false)

    resolveManual(syncResult(useAppStore.getState().data as AppData))
    await Promise.all([pull, manual])
  })

  it('preserves an explicit strategy when a stale owner is retried', async () => {
    const data = resetStore()
    useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')

    let resolveFirst: ((result: SyncResult) => void) | undefined
    syncMocks.performSync.mockImplementationOnce(
      () =>
        new Promise<SyncResult>((resolve) => {
          resolveFirst = resolve
        }),
    )
    syncMocks.performSync.mockImplementationOnce(async (latest: AppData) =>
      syncResult(latest),
    )

    const first = useAppStore.getState().syncNow('use-remote')
    await vi.waitFor(() =>
      expect(syncMocks.performSync).toHaveBeenCalledTimes(1),
    )
    useAppStore.getState().setSyncGistFile('stale-owner.json')
    const queued = useAppStore.getState().syncNow()
    resolveFirst?.(syncResult(data))

    await first
    await queued
    await vi.waitFor(() =>
      expect(syncMocks.performSync).toHaveBeenCalledTimes(2),
    )
    expect(syncMocks.performSync.mock.calls[1]?.[1]).toMatchObject({
      firstSyncStrategy: 'use-remote',
    })
  })

  it('reclaims replaced Skill refs for an unaccepted sync without deleting retained duplicates', async () => {
    const data = resetStore()
    useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')

    const previousA = skill('previous-a', {
      chunks: [
        {
          contentRef: 'old-ref',
          heading: 'A',
          id: 'a',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const previousB = skill('previous-b', {
      chunks: [
        {
          contentRef: 'old-ref',
          heading: 'B',
          id: 'b',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const replacement = skill('replacement', {
      chunks: [
        {
          contentRef: 'source-ref',
          heading: 'Replacement',
          id: 'replacement',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const retained = skill('retained', {
      chunks: [
        {
          contentRef: 'old-ref',
          heading: 'Retained',
          id: 'retained',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })

    const local = { ...data, skills: [previousA, previousB] }
    useAppStore.setState({ data: local })
    dbMocks.persistExternalAppDataSkillContents.mockImplementation(
      async (value: unknown) => {
        const next = value as AppData
        return {
          ...next,
          skills: next.skills.map((item) => ({
            ...item,
            chunks: item.chunks.map((chunk) => ({
              ...chunk,
              contentRef:
                item.id === 'retained'
                  ? chunk.contentRef
                  : `new-${chunk.contentRef}`,
            })),
          })),
        }
      },
    )
    syncMocks.performSync.mockResolvedValueOnce({
      ...syncResult({ ...local, skills: [replacement] }),
      data: { ...local, skills: [replacement] },
      remoteAccepted: false,
    })

    await useAppStore.getState().syncNow()
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith(['old-ref'])
    expect(useAppStore.getState().data?.skills[0].chunks[0].contentRef).toBe(
      'new-source-ref',
    )

    dbMocks.deleteSkillContentRefs.mockClear()
    useAppStore.setState({ data: local })
    syncMocks.performSync.mockResolvedValueOnce({
      ...syncResult({ ...local, skills: [replacement, retained] }),
      data: { ...local, skills: [replacement, retained] },
      remoteAccepted: false,
    })

    await useAppStore.getState().syncNow()
    expect(dbMocks.deleteSkillContentRefs).not.toHaveBeenCalled()
    expect(useAppStore.getState().data?.skills[1].chunks[0].contentRef).toBe(
      'old-ref',
    )
  })

  it('cleans stale Skill refs after accepted sync and unpublished refs after a failed commit', async () => {
    resetStore()
    useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')
    const data = useAppStore.getState().data
    if (!data) throw new Error('test data is unavailable')
    const previous = skill('previous', {
      chunks: [
        {
          contentRef: 'previous-ref',
          heading: 'Previous',
          id: 'previous-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const next = skill('next', {
      chunks: [
        {
          contentRef: 'next-ref',
          heading: 'Next',
          id: 'next-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const local = { ...data, skills: [previous] }
    useAppStore.setState({ data: local })
    const remote = { ...local, skills: [next] }
    syncMocks.performSync.mockResolvedValueOnce({
      ...syncResult(remote),
      data: remote,
    })

    await useAppStore.getState().syncNow()
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith(['previous-ref'])

    dbMocks.deleteSkillContentRefs.mockClear()
    useAppStore.setState({ data: local })
    secretMocks.commitProviderSecretSnapshotWithAppData.mockRejectedValueOnce(
      new Error('commit failed'),
    )
    syncMocks.performSync.mockResolvedValueOnce({
      ...syncResult(remote),
      data: remote,
    })

    await useAppStore.getState().syncNow()
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith(['next-ref'])
  })

  it('retries stale Skill ref cleanup after an accepted sync without a new edit', async () => {
    const data = resetStore()
    useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')
    await useAppStore.getState().flushLocalSaves()
    dbMocks.deleteSkillContentRefs.mockClear()
    dbMocks.saveAppData.mockClear()

    const previous = skill('sync-cleanup-previous', {
      chunks: [
        {
          contentRef: 'sync-cleanup-old-ref',
          heading: 'Previous',
          id: 'sync-cleanup-previous-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const next = skill('sync-cleanup-next', {
      chunks: [
        {
          contentRef: 'sync-cleanup-new-ref',
          heading: 'Next',
          id: 'sync-cleanup-next-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const local = { ...data, skills: [previous] }
    const remote = { ...local, skills: [next] }
    useAppStore.setState({ data: local })
    dbMocks.deleteSkillContentRefs.mockRejectedValueOnce(
      new Error('sync cleanup unavailable'),
    )
    syncMocks.performSync.mockResolvedValueOnce({
      ...syncResult(remote),
      data: remote,
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await useAppStore.getState().syncNow()
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith([
      'sync-cleanup-old-ref',
    ])

    await useAppStore.getState().flushLocalSaves()
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledTimes(2)
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenLastCalledWith([
      'sync-cleanup-old-ref',
    ])

    await useAppStore.getState().flushLocalSaves()
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledTimes(2)
  })

  it('keeps the sync lifecycle pending until stale Skill ref cleanup settles', async () => {
    resetStore()
    useAppStore.getState().setSyncMode('gist')
    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore.getState().saveGithubToken('github-token')

    const data = useAppStore.getState().data
    if (!data) throw new Error('test data is unavailable')
    const previous = skill('sync-previous', {
      chunks: [
        {
          contentRef: 'sync-old-ref',
          heading: 'Previous',
          id: 'sync-previous-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const next = skill('sync-next', {
      chunks: [
        {
          contentRef: 'sync-new-ref',
          heading: 'Next',
          id: 'sync-next-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const local = { ...data, skills: [previous] }
    const remote = { ...local, skills: [next] }
    useAppStore.setState({ data: local })
    syncMocks.performSync.mockResolvedValueOnce({
      ...syncResult(remote),
      data: remote,
    })

    let releaseCleanup!: () => void
    const cleanup = new Promise<void>((resolve) => {
      releaseCleanup = resolve
    })
    dbMocks.deleteSkillContentRefs.mockImplementationOnce(async (refs) => {
      expect(refs).toEqual(['sync-old-ref'])
      await cleanup
    })

    const syncing = useAppStore.getState().syncNow()
    await vi.waitFor(() =>
      expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith([
        'sync-old-ref',
      ]),
    )
    const reused = skill('sync-reused', {
      chunks: [
        {
          contentRef: 'sync-old-ref',
          heading: 'Reused',
          id: 'sync-reused-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    lazyMocks.loadSkillService.mockResolvedValueOnce({
      createUserSkillFromContent: vi.fn(async () => reused),
      createUserSkillFromFile: vi.fn(),
      editableSkillContent: vi.fn(),
    })
    const adding = useAppStore.getState().addSkill('Reused', 'Body')
    await Promise.resolve()
    await Promise.resolve()

    expect(dbMocks.persistSkillContents).not.toHaveBeenCalled()
    releaseCleanup()
    await Promise.all([syncing, adding])
    expect(useAppStore.getState().data?.skills).toEqual([next, reused])
  })

  it('resets local state and exposes a replaceable runtime loader', async () => {
    const loader = vi.fn(async () => runtime)
    useAppStore.getState().setRuntimeLoader(loader)
    expect(useAppStore.getState().runtimeLoader).toBe(loader)
    await useAppStore.getState().resetAll()
    expect(secretMocks.commitZeroChatSecretSnapshotWithAppData).toHaveBeenCalledTimes(1)
    expect(secretMocks.clearZeroChatSecrets).not.toHaveBeenCalled()
    expect(useAppStore.getState()).toMatchObject({
      githubToken: '',
      settingsOpen: false,
      status: 'ready',
      syncPassphrase: '',
    })
    expect(useAppStore.getState().data?.preferences.firstRunDone).toBe(true)
  })

  it('keeps a completed local reset successful when its notice fails', async () => {
    const before = resetStore()
    useAppStore.setState({
      notify: () => {
        throw new Error('notification channel unavailable')
      },
    })

    await expect(useAppStore.getState().resetAll()).resolves.toBeUndefined()

    expect(useAppStore.getState().data).not.toBe(before)
    expect(useAppStore.getState().data?.preferences.firstRunDone).toBe(true)
    expect(useAppStore.getState().keys).toEqual({})
  })

  it('contains encrypted backup export failures behind stable localized feedback', async () => {
    const sentinel = 'C:\\private\\backup\\provider-secret=sk-export-sentinel'
    resetStore()
    useAppStore.setState({ syncPassphrase: 'backup-passphrase' })
    cryptoMocks.encryptVault.mockRejectedValueOnce(new Error(sentinel))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(useAppStore.getState().exportBackup()).resolves.toBeUndefined()

    expect(downloadMocks.downloadJsonFile).not.toHaveBeenCalled()
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'Backup download failed. Try again.',
      tone: 'error',
    })
    expect(useAppStore.getState().toasts.map((toast) => toast.message).join(' ')).not.toContain(
      sentinel,
    )
    consoleError.mockRestore()
  })

  it('contains a durable flush failure before backup export starts', async () => {
    resetStore()
    const failure = new Error(
      'C:\\private\\backup\\flush-secret=sk-export-flush-sentinel',
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    useAppStore.setState({ syncPassphrase: 'backup-passphrase' })
    dbMocks.saveAppData.mockRejectedValueOnce(failure)
    useAppStore.getState().setTheme('dark')

    await expect(useAppStore.getState().exportBackup()).resolves.toBeUndefined()

    expect(downloadMocks.downloadJsonFile).not.toHaveBeenCalled()
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'Save failed. Try again.',
      tone: 'error',
    })
    const notice = useAppStore.getState().toasts.at(-1)?.message ?? ''
    expect(notice).not.toContain(failure.message)
    expect(consoleError).toHaveBeenCalledWith('[app] export failed')
    expectConsoleErrorDoesNotExpose(consoleError, failure)
    consoleError.mockRestore()
  })

  it('contains encrypted backup export notice failures', async () => {
    resetStore()
    useAppStore.setState({
      notify: () => {
        throw new Error('notice unavailable')
      },
      syncPassphrase: 'backup-passphrase',
    })
    cryptoMocks.encryptVault.mockRejectedValueOnce(new Error('private export failure'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(useAppStore.getState().exportBackup()).resolves.toBeUndefined()

    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('contains backup preflight notice failures before opening Settings', async () => {
    resetStore()
    useAppStore.setState({
      notify: () => {
        throw new Error('notification channel unavailable')
      },
      settingsOpen: false,
      syncPassphrase: '',
    })

    await expect(useAppStore.getState().exportBackup()).resolves.toBeUndefined()

    expect(useAppStore.getState().settingsOpen).toBe(true)
  })

  it('keeps a completed backup export successful when its notice fails', async () => {
    resetStore()
    useAppStore.setState({
      notify: () => {
        throw new Error('notification channel unavailable')
      },
      syncPassphrase: 'backup-passphrase',
    })
    cryptoMocks.encryptVault.mockResolvedValueOnce({
      kind: 'zerochat.encrypted',
      version: 1,
    })
    downloadMocks.downloadJsonFile.mockReturnValueOnce(true)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(useAppStore.getState().exportBackup()).resolves.toBeUndefined()

    expect(downloadMocks.downloadJsonFile).toHaveBeenCalledOnce()
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('exports one coherent data, Provider-key, and passphrase snapshot', async () => {
    const original = resetStore()
    const providerId = original.providers[0]?.id ?? ''
    useAppStore.setState({
      keys: { [providerId]: 'original-key' },
      syncPassphrase: 'original-passphrase',
    })
    let releaseMaterialization!: () => void
    const heldMaterialization = new Promise<void>((resolve) => {
      releaseMaterialization = resolve
    })
    dbMocks.materializeAppDataSkillContents.mockImplementationOnce(
      async (data: unknown) => {
        await heldMaterialization
        return data
      },
    )
    const envelope = { kind: 'zerochat.encrypted', version: 1 }
    cryptoMocks.encryptVault.mockResolvedValueOnce(envelope)

    const exported = useAppStore.getState().exportBackup()
    await vi.waitFor(() =>
      expect(dbMocks.materializeAppDataSkillContents).toHaveBeenCalledWith(original),
    )
    const changed = structuredClone(original)
    changed.updatedAt += 1
    useAppStore.setState({
      data: changed,
      keys: { [providerId]: 'changed-key' },
      syncPassphrase: 'changed-passphrase',
    })
    releaseMaterialization()
    await exported

    expect(cryptoMocks.encryptVault).toHaveBeenCalledWith(
      {
        data: original,
        secrets: { providerKeys: { [providerId]: 'original-key' } },
      },
      'original-passphrase',
    )
    expect(downloadMocks.downloadJsonFile).toHaveBeenCalledWith(
      envelope,
      expect.stringMatching(/^zerochat-backup-\d{4}-\d{2}-\d{2}\.json$/u),
    )
  })

  it('does not publish a backup export after reset takes the data replacement owner', async () => {
    resetStore()
    useAppStore.setState({ syncPassphrase: 'original-passphrase' })

    let releaseMaterialization!: () => void
    const heldMaterialization = new Promise<void>((resolve) => {
      releaseMaterialization = resolve
    })
    dbMocks.materializeAppDataSkillContents.mockImplementationOnce(
      async (data: unknown) => {
        await heldMaterialization
        return data
      },
    )
    cryptoMocks.encryptVault.mockResolvedValueOnce({
      kind: 'zerochat.encrypted',
      version: 1,
    })

    const exporting = useAppStore.getState().exportBackup()
    await vi.waitFor(() =>
      expect(dbMocks.materializeAppDataSkillContents).toHaveBeenCalledOnce(),
    )

    await useAppStore.getState().resetAll()
    const resetToastCount = useAppStore.getState().toasts.length

    releaseMaterialization()
    await exporting

    expect(downloadMocks.downloadJsonFile).not.toHaveBeenCalled()
    expect(useAppStore.getState().toasts).toHaveLength(resetToastCount)
  })

  it('imports encrypted backups through the provider/AppData transition', async () => {
    const data = resetStore()
    const imported = structuredClone(data)
    const providerId = imported.providers[0]?.id ?? ''
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: imported,
      secrets: { providerKeys: { [providerId]: 'imported-key' } },
    })

    await useAppStore.getState().setSyncPassphrase('passphrase')
    await useAppStore
      .getState()
      .importBackup(new File(['{}'], 'backup.json', { type: 'application/json' }))

    expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledTimes(1)
    expect(secretMocks.setProviderKey).not.toHaveBeenCalled()
    expect(useAppStore.getState().keys).toEqual({ [providerId]: 'imported-key' })
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'Backup imported.',
      tone: 'success',
    })
  })

  it('synchronizes the runtime locale after importing a backup language', async () => {
    const data = resetStore()
    data.preferences.language = 'en-US'
    await i18nMocks.actualLoadLocale!('en-US')
    await i18nMocks.actualLoadLocale!('ar-SA')
    setRuntimeLocale('en-US')
    const documentStub = { documentElement: { dir: 'ltr', lang: 'en-US' } }
    vi.stubGlobal('document', documentStub)
    i18nMocks.loadLocale.mockClear()
    i18nMocks.loadLocale.mockResolvedValue(undefined)

    const importedData = structuredClone(data)
    importedData.preferences.language = 'ar-SA'
    importedData.updatedAt += 1
    useAppStore.setState({ syncPassphrase: 'passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: importedData,
      secrets: { providerKeys: {} },
    })

    await useAppStore
      .getState()
      .importBackup(new File(['{}'], 'arabic-backup.json', { type: 'application/json' }))

    expect(i18nMocks.loadLocale).toHaveBeenCalledWith('ar-SA')
    expect(documentStub.documentElement).toEqual({ dir: 'rtl', lang: 'ar-SA' })
    expect(rt('button.clearCloudData')).toBe(
      translate('ar-SA', 'button.clearCloudData'),
    )
  })

  it('keeps an imported snapshot durable when its locale chunk fails', async () => {
    const data = resetStore()
    await i18nMocks.actualLoadLocale!('en-US')
    setRuntimeLocale('en-US')
    const importedData = structuredClone(data)
    importedData.preferences.language = 'fr-FR'
    importedData.updatedAt += 1
    useAppStore.setState({ syncPassphrase: 'passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: importedData,
      secrets: { providerKeys: {} },
    })
    const localeFailure = new Error('C:\\private\\locale-import-secret')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    i18nMocks.loadLocale.mockRejectedValueOnce(localeFailure)

    try {
      await expect(
        useAppStore
          .getState()
          .importBackup(new File(['{}'], 'failed-locale-backup.json')),
      ).resolves.toBeUndefined()
      expect(consoleError).toHaveBeenCalledWith('[app] locale load failed')
      expectConsoleErrorDoesNotExpose(consoleError, localeFailure)
    } finally {
      consoleError.mockRestore()
    }

    expect(useAppStore.getState().data?.preferences.language).toBe('fr-FR')
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce()
    expect(useAppStore.getState().toasts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'Backup imported.', tone: 'success' }),
        expect.objectContaining({
          message: translate('en-US', 'notice.localeLoadFailed'),
          tone: 'error',
        }),
      ]),
    )
  })

  it('drops an image attachment that finishes after backup import replaces local data', async () => {
    const data = resetStore()
    const imported = structuredClone(data)
    imported.preferences.theme = 'dark'
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: imported,
      secrets: { providerKeys: {} },
    })
    useAppStore.setState({ syncPassphrase: 'passphrase' })

    let resolveFile!: (dataUrl: string) => void
    const pendingRead = new Promise<string>((resolve) => {
      resolveFile = resolve
    })
    imageMocks.fileToDataUrl.mockReturnValueOnce(pendingRead)

    const attaching = useAppStore
      .getState()
      .attachImage(imageFile('before-import.png'))
    await vi.waitFor(() =>
      expect(imageMocks.fileToDataUrl).toHaveBeenCalledOnce(),
    )

    await useAppStore
      .getState()
      .importBackup(new File(['{}'], 'backup.json', { type: 'application/json' }))

    expect(useAppStore.getState().data?.preferences.theme).toBe('dark')
    resolveFile('data:image/png;base64,STALE_AFTER_IMPORT')
    await attaching

    expect(useAppStore.getState().composerImages).toEqual([])
  })

  it('orders backup decryption after an already queued passphrase write', async () => {
    const data = resetStore()
    const imported = structuredClone(data)
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: imported,
      secrets: { providerKeys: {} },
    })
    useAppStore.setState({ syncPassphrase: 'old-passphrase' })

    let releasePassphraseWrite!: () => void
    const passphraseWrite = new Promise<undefined>((resolve) => {
      releasePassphraseWrite = () => resolve(undefined)
    })
    secretMocks.setSyncPassphrase.mockImplementationOnce(
      () => passphraseWrite,
    )

    const saving = useAppStore.getState().setSyncPassphrase('new-passphrase')
    await vi.waitFor(() =>
      expect(secretMocks.setSyncPassphrase).toHaveBeenCalledWith(
        'new-passphrase',
      ),
    )
    const importing = useAppStore
      .getState()
      .importBackup(new File(['{}'], 'backup.json', { type: 'application/json' }))

    await vi.waitFor(() =>
      expect(cryptoMocks.isEncryptedSnapshot).toHaveBeenCalledOnce(),
    )
    expect(cryptoMocks.decryptVault).not.toHaveBeenCalled()

    releasePassphraseWrite()
    await saving
    await importing

    expect(cryptoMocks.decryptVault).toHaveBeenCalledOnce()
    expect(cryptoMocks.decryptVault).toHaveBeenCalledWith(
      expect.anything(),
      'new-passphrase',
    )
  })

  it('waits for a passphrase mutation that starts while backup file text is pending', async () => {
    const data = resetStore()
    const imported = structuredClone(data)
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: imported,
      secrets: { providerKeys: {} },
    })
    useAppStore.setState({ syncPassphrase: 'old-passphrase' })

    let releaseFileText!: (value: string) => void
    let fileTextStarted!: () => void
    const fileText = new Promise<string>((resolve) => {
      releaseFileText = resolve
    })
    const fileTextStart = new Promise<void>((resolve) => {
      fileTextStarted = resolve
    })
    const file = new File(['{}'], 'deferred-backup.json', {
      type: 'application/json',
    })
    Object.defineProperty(file, 'text', {
      configurable: true,
      value: vi.fn(() => {
        fileTextStarted()
        return fileText
      }),
    })

    let releasePassphraseWrite!: () => void
    const passphraseWrite = new Promise<void>((resolve) => {
      releasePassphraseWrite = resolve
    })
    secretMocks.setSyncPassphrase.mockImplementationOnce(async () => {
      await passphraseWrite
    })

    const importing = useAppStore.getState().importBackup(file)
    await fileTextStart

    const saving = useAppStore.getState().setSyncPassphrase('new-passphrase')
    await vi.waitFor(() =>
      expect(secretMocks.setSyncPassphrase).toHaveBeenCalledWith(
        'new-passphrase',
      ),
    )

    releaseFileText('{}')
    await vi.waitFor(() =>
      expect(cryptoMocks.isEncryptedSnapshot).toHaveBeenCalledOnce(),
    )

    expect(cryptoMocks.decryptVault).not.toHaveBeenCalled()

    releasePassphraseWrite()
    await saving
    await importing

    expect(cryptoMocks.decryptVault).toHaveBeenCalledWith(
      expect.anything(),
      'new-passphrase',
    )
  })

  it('fails closed when a passphrase mutation started during backup file text fails', async () => {
    const data = resetStore()
    const keys = useAppStore.getState().keys
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    useAppStore.setState({ syncPassphrase: 'old-passphrase' })

    let releaseFileText!: (value: string) => void
    let fileTextStarted!: () => void
    const fileText = new Promise<string>((resolve) => {
      releaseFileText = resolve
    })
    const fileTextStart = new Promise<void>((resolve) => {
      fileTextStarted = resolve
    })
    const file = new File(['{}'], 'deferred-failed-backup.json', {
      type: 'application/json',
    })
    Object.defineProperty(file, 'text', {
      configurable: true,
      value: vi.fn(() => {
        fileTextStarted()
        return fileText
      }),
    })

    let rejectPassphraseWrite!: (error: Error) => void
    secretMocks.setSyncPassphrase.mockImplementationOnce(
      () =>
        new Promise<undefined>((_resolve, reject) => {
          rejectPassphraseWrite = reject
        }),
    )

    const importing = useAppStore.getState().importBackup(file)
    await fileTextStart
    const saving = useAppStore.getState().setSyncPassphrase('new-passphrase')
    await vi.waitFor(() =>
      expect(secretMocks.setSyncPassphrase).toHaveBeenCalledWith(
        'new-passphrase',
      ),
    )

    releaseFileText('{}')
    await vi.waitFor(() =>
      expect(cryptoMocks.isEncryptedSnapshot).toHaveBeenCalledOnce(),
    )
    rejectPassphraseWrite(new Error('passphrase write failed'))

    await expect(saving).rejects.toThrow('passphrase write failed')
    await importing

    expect(cryptoMocks.decryptVault).not.toHaveBeenCalled()
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).not.toHaveBeenCalled()
    expect(useAppStore.getState().data).toBe(data)
    expect(useAppStore.getState().keys).toBe(keys)
  })

  it('fails closed when a newer passphrase mutation fails during backup decryption', async () => {
    const data = resetStore()
    const keys = useAppStore.getState().keys
    const imported = structuredClone(data)
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    useAppStore.setState({ syncPassphrase: 'old-passphrase' })

    let releaseDecrypt!: (value: {
      data: AppData
      secrets: { providerKeys: Record<string, string> }
    }) => void
    const decrypt = new Promise<{
      data: AppData
      secrets: { providerKeys: Record<string, string> }
    }>((resolve) => {
      releaseDecrypt = resolve
    })
    cryptoMocks.decryptVault.mockImplementationOnce(() => decrypt)

    const importing = useAppStore
      .getState()
      .importBackup(
        new File(['{}'], 'deferred-decrypt-backup.json', {
          type: 'application/json',
        }),
      )
    await vi.waitFor(() => expect(cryptoMocks.decryptVault).toHaveBeenCalledOnce())

    secretMocks.setSyncPassphrase.mockRejectedValueOnce(
      new Error('new passphrase write failed'),
    )
    const saving = useAppStore.getState().setSyncPassphrase('new-passphrase')
    await expect(saving).rejects.toThrow('new passphrase write failed')

    releaseDecrypt({ data: imported, secrets: { providerKeys: {} } })
    await importing

    expect(secretMocks.commitProviderSecretSnapshotWithAppData).not.toHaveBeenCalled()
    expect(useAppStore.getState().data).toBe(data)
    expect(useAppStore.getState().keys).toBe(keys)
  })

  it('does not notify from a superseded import preflight', async () => {
    resetStore()
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)

    const deferredFile = (name: string) => {
      let releaseText!: (value: string) => void
      let started!: () => void
      const text = new Promise<string>((resolve) => {
        releaseText = resolve
      })
      const startedPromise = new Promise<void>((resolve) => {
        started = resolve
      })
      const file = new File(['{}'], name, { type: 'application/json' })
      Object.defineProperty(file, 'text', {
        configurable: true,
        value: vi.fn(() => {
          started()
          return text
        }),
      })
      return {
        file,
        releaseText,
        started: startedPromise,
      }
    }

    const first = deferredFile('first-backup.json')
    const second = deferredFile('second-backup.json')
    const firstImport = useAppStore.getState().importBackup(first.file)
    await first.started
    const secondImport = useAppStore.getState().importBackup(second.file)
    await second.started

    first.releaseText('{}')
    await firstImport
    expect(useAppStore.getState().toasts).toEqual([])

    second.releaseText('{}')
    await secondImport
    expect(useAppStore.getState().toasts).toHaveLength(1)
    expect(useAppStore.getState().toasts[0]).toMatchObject({ tone: 'error' })
  })

  it('keeps a newer Provider key saved during backup decryption', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const imported = structuredClone(data)
    imported.updatedAt += 1
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    useAppStore.setState({ syncPassphrase: 'backup-passphrase' })

    let releaseDecrypt!: (value: {
      data: AppData
      secrets: { providerKeys: Record<string, string> }
    }) => void
    cryptoMocks.decryptVault.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseDecrypt = resolve
        }),
    )

    let releasePrune!: (value: { providerKeys: Record<string, string> }) => void
    providerSafetyMocks.pruneProviderSecrets.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releasePrune = resolve
        }),
    )

    let releaseKeyWrite!: () => void
    secretMocks.setProviderKey.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releaseKeyWrite = () => resolve(undefined)
        }),
    )

    const importing = useAppStore.getState().importBackup(
      new File(['{}'], 'deferred-provider-key-backup.json', {
        type: 'application/json',
      }),
    )
    await vi.waitFor(() => expect(cryptoMocks.decryptVault).toHaveBeenCalledOnce())

    const savingKey = useAppStore.getState().saveProviderKey(providerId, 'new-key')
    await vi.waitFor(() =>
      expect(secretMocks.setProviderKey).toHaveBeenCalledWith(providerId, 'new-key'),
    )
    releaseDecrypt({
      data: imported,
      secrets: { providerKeys: { [providerId]: 'imported-key' } },
    })

    await vi.waitFor(() => expect(releasePrune).toBeTypeOf('function'))
    releasePrune({ providerKeys: { [providerId]: 'imported-key' } })
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).not.toHaveBeenCalled()
    releaseKeyWrite()
    await savingKey
    await importing

    expect(useAppStore.getState().keys[providerId]).toBe('new-key')
  })

  it('waits for a Provider key mutation that starts after backup decryption', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const imported = structuredClone(data)
    imported.updatedAt += 1
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: imported,
      secrets: { providerKeys: { [providerId]: 'imported-key' } },
    })
    useAppStore.setState({ syncPassphrase: 'backup-passphrase' })

    let releasePrune!: (value: { providerKeys: Record<string, string> }) => void
    providerSafetyMocks.pruneProviderSecrets.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releasePrune = resolve
        }),
    )

    let releaseKeyWrite!: () => void
    secretMocks.setProviderKey.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releaseKeyWrite = () => resolve(undefined)
        }),
    )

    const importing = useAppStore.getState().importBackup(
      new File(['{}'], 'post-decrypt-provider-key-backup.json', {
        type: 'application/json',
      }),
    )
    await vi.waitFor(() => expect(releasePrune).toBeTypeOf('function'))

    const savingKey = useAppStore.getState().saveProviderKey(providerId, 'new-key')
    await vi.waitFor(() =>
      expect(secretMocks.setProviderKey).toHaveBeenCalledWith(providerId, 'new-key'),
    )

    releasePrune({ providerKeys: { [providerId]: 'imported-key' } })
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).not.toHaveBeenCalled()

    releaseKeyWrite()
    await savingKey
    await importing

    expect(useAppStore.getState().keys[providerId]).toBe('new-key')
  })

  it('lets a later backup import replace a Provider key mutation already in flight', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const imported = structuredClone(data)
    imported.updatedAt += 1
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: imported,
      secrets: { providerKeys: { [providerId]: 'imported-key' } },
    })
    useAppStore.setState({ syncPassphrase: 'backup-passphrase' })

    let releaseKeyWrite!: () => void
    secretMocks.setProviderKey.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releaseKeyWrite = () => resolve(undefined)
        }),
    )

    const savingKey = useAppStore.getState().saveProviderKey(providerId, 'stale-key')
    await vi.waitFor(() =>
      expect(secretMocks.setProviderKey).toHaveBeenCalledWith(
        providerId,
        'stale-key',
      ),
    )

    let importSettled = false
    const importing = useAppStore.getState().importBackup(
      new File(['{}'], 'later-provider-key-backup.json', {
        type: 'application/json',
      }),
    )
    void importing.then(() => {
      importSettled = true
    })
    await vi.waitFor(() => expect(cryptoMocks.decryptVault).toHaveBeenCalledOnce())
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()

    expect(importSettled).toBe(false)
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).not.toHaveBeenCalled()

    releaseKeyWrite()
    await savingKey
    await importing

    expect(useAppStore.getState().keys[providerId]).toBe('imported-key')
  })

  it('uses the imported Provider key when a newer key write fails during backup decryption', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const imported = structuredClone(data)
    imported.updatedAt += 1
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    useAppStore.setState({ syncPassphrase: 'backup-passphrase' })

    let releaseDecrypt!: (value: {
      data: AppData
      secrets: { providerKeys: Record<string, string> }
    }) => void
    cryptoMocks.decryptVault.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseDecrypt = resolve
        }),
    )
    let rejectKeyWrite!: (error: Error) => void
    secretMocks.setProviderKey.mockImplementationOnce(
      () =>
        new Promise<undefined>((_resolve, reject) => {
          rejectKeyWrite = reject
        }),
    )

    const importing = useAppStore.getState().importBackup(
      new File(['{}'], 'deferred-failed-provider-key-backup.json', {
        type: 'application/json',
      }),
    )
    await vi.waitFor(() => expect(cryptoMocks.decryptVault).toHaveBeenCalledOnce())

    const savingKey = useAppStore.getState().saveProviderKey(providerId, 'failed-key')
    await vi.waitFor(() =>
      expect(secretMocks.setProviderKey).toHaveBeenCalledWith(
        providerId,
        'failed-key',
      ),
    )
    releaseDecrypt({
      data: imported,
      secrets: { providerKeys: { [providerId]: 'imported-key' } },
    })
    rejectKeyWrite(new Error('Provider key write failed'))
    await expect(savingKey).rejects.toThrow('Provider key write failed')
    await importing

    expect(useAppStore.getState().keys[providerId]).toBe('imported-key')
  })

  it('does not restore a Provider deleted while backup decryption is pending', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const imported = structuredClone(data)
    imported.updatedAt += 1
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    let releaseDecrypt!: (value: {
      data: AppData
      secrets: { providerKeys: Record<string, string> }
    }) => void
    cryptoMocks.decryptVault.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseDecrypt = resolve
        }),
    )
    useAppStore.setState({ syncPassphrase: 'backup-passphrase' })

    const importing = useAppStore.getState().importBackup(
      new File(['{}'], 'provider-delete-during-decrypt.json', {
        type: 'application/json',
      }),
    )
    await vi.waitFor(() => expect(cryptoMocks.decryptVault).toHaveBeenCalledOnce())

    const deletion = useAppStore.getState().deleteProvider(providerId)
    await expect(deletion).resolves.toBe(true)
    expect(useAppStore.getState().data?.providers).toEqual([])

    releaseDecrypt({
      data: imported,
      secrets: { providerKeys: { [providerId]: 'imported-key' } },
    })
    await importing

    expect(useAppStore.getState().data?.providers).toEqual([])
    expect(useAppStore.getState().keys).toEqual({})
  })

  it('lets a later backup import restore a Provider deletion already in flight', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const imported = structuredClone(data)
    imported.providers[0].name = 'Imported Provider'
    imported.updatedAt += 1
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: imported,
      secrets: { providerKeys: { [providerId]: 'imported-key' } },
    })
    useAppStore.setState({ syncPassphrase: 'backup-passphrase' })

    let releaseDeletion!: () => void
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async (
        _previous: unknown,
        _next: unknown,
        target: AppData,
        persist: (snapshot: AppData) => Promise<AppData>,
      ) => {
        await new Promise<void>((resolve) => {
          releaseDeletion = resolve
        })
        return persist(target)
      },
    )

    const deletion = useAppStore.getState().deleteProvider(providerId)
    await vi.waitFor(() =>
      expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
    )

    let importSettled = false
    const importing = useAppStore.getState().importBackup(
      new File(['{}'], 'later-provider-delete-backup.json', {
        type: 'application/json',
      }),
    )
    void importing.then(() => {
      importSettled = true
    })
    await vi.waitFor(() => expect(cryptoMocks.decryptVault).toHaveBeenCalledOnce())
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()

    expect(importSettled).toBe(false)
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce()

    releaseDeletion()
    await deletion
    await importing

    expect(useAppStore.getState().data?.providers[0]?.name).toBe(
      'Imported Provider',
    )
    expect(useAppStore.getState().keys[providerId]).toBe('imported-key')
  })

  it('waits for a later Provider key mutation inserted during deletion tail drain', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const imported = structuredClone(data)
    imported.providers[0].name = 'Imported Provider'
    imported.updatedAt += 1
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: imported,
      secrets: { providerKeys: { [providerId]: 'imported-key' } },
    })
    useAppStore.setState({ syncPassphrase: 'backup-passphrase' })

    let releasePrune!: (value: { providerKeys: Record<string, string> }) => void
    providerSafetyMocks.pruneProviderSecrets.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releasePrune = resolve
        }),
    )

    let rejectDeletion!: (error: Error) => void
    secretMocks.commitProviderSecretSnapshotWithAppData.mockImplementationOnce(
      async () =>
        new Promise((_resolve, reject) => {
          rejectDeletion = reject
        }),
    )

    const importing = useAppStore.getState().importBackup(
      new File(['{}'], 'provider-tail-interleave-backup.json', {
        type: 'application/json',
      }),
    )
    await vi.waitFor(() => expect(cryptoMocks.decryptVault).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(releasePrune).toBeTypeOf('function'))

    const deletion = useAppStore.getState().deleteProvider(providerId)
    await vi.waitFor(() =>
      expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce(),
    )

    releasePrune({ providerKeys: { [providerId]: 'imported-key' } })
    await Promise.resolve()
    await Promise.resolve()

    let releaseKeyWrite!: () => void
    secretMocks.setProviderKey.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releaseKeyWrite = () => resolve(undefined)
        }),
    )
    let importSettled = false
    void importing.then(() => {
      importSettled = true
    })
    const savingKey = useAppStore.getState().saveProviderKey(providerId, 'new-key')
    await Promise.resolve()
    expect(secretMocks.setProviderKey).not.toHaveBeenCalled()

    rejectDeletion(new Error('deletion failed after import read'))
    await expect(deletion).resolves.toBe(false)
    await vi.waitFor(() =>
      expect(secretMocks.setProviderKey).toHaveBeenCalledWith(providerId, 'new-key'),
    )
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()

    expect(importSettled).toBe(false)
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce()

    releaseKeyWrite()
    await savingKey
    await importing

    expect(useAppStore.getState().data?.providers[0]?.name).toBe(
      'Imported Provider',
    )
    expect(useAppStore.getState().keys[providerId]).toBe('new-key')
  })

  it('keeps backup import valid when a newer Provider deletion fails', async () => {
    const data = resetStore()
    const providerId = data.providers[0].id
    const imported = structuredClone(data)
    imported.providers[0].name = 'Imported Provider'
    imported.updatedAt += 1
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    let releaseDecrypt!: (value: {
      data: AppData
      secrets: { providerKeys: Record<string, string> }
    }) => void
    cryptoMocks.decryptVault.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseDecrypt = resolve
        }),
    )
    useAppStore.setState({ syncPassphrase: 'backup-passphrase' })
    secretMocks.commitProviderSecretSnapshotWithAppData.mockRejectedValueOnce(
      new Error('provider deletion failed'),
    )

    const importing = useAppStore.getState().importBackup(
      new File(['{}'], 'failed-provider-delete-during-decrypt.json', {
        type: 'application/json',
      }),
    )
    await vi.waitFor(() => expect(cryptoMocks.decryptVault).toHaveBeenCalledOnce())

    await expect(useAppStore.getState().deleteProvider(providerId)).resolves.toBe(false)
    releaseDecrypt({
      data: imported,
      secrets: { providerKeys: { [providerId]: 'imported-key' } },
    })
    await importing

    expect(useAppStore.getState().data?.providers[0]?.name).toBe(
      'Imported Provider',
    )
  })

  it('does not decrypt a backup after an already queued passphrase write fails', async () => {
    const data = resetStore()
    const keys = useAppStore.getState().keys
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    useAppStore.setState({ syncPassphrase: 'old-passphrase' })

    let rejectPassphraseWrite!: (error: Error) => void
    secretMocks.setSyncPassphrase.mockImplementationOnce(
      () =>
        new Promise<undefined>((_resolve, reject) => {
          rejectPassphraseWrite = reject
        }),
    )

    const saving = useAppStore.getState().setSyncPassphrase('new-passphrase')
    await vi.waitFor(() =>
      expect(secretMocks.setSyncPassphrase).toHaveBeenCalledWith(
        'new-passphrase',
      ),
    )
    const importing = useAppStore
      .getState()
      .importBackup(new File(['{}'], 'backup.json', { type: 'application/json' }))

    rejectPassphraseWrite(new Error('passphrase write failed'))
    await expect(saving).rejects.toThrow('passphrase write failed')
    await importing

    expect(cryptoMocks.decryptVault).not.toHaveBeenCalled()
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).not.toHaveBeenCalled()
    expect(useAppStore.getState().data).toBe(data)
    expect(useAppStore.getState().keys).toBe(keys)
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'Invalid backup file.',
      tone: 'error',
    })
  })

  it('uses the latest app locale when backup decryption fails', async () => {
    const data = resetStore()
    useAppStore.setState({ syncPassphrase: 'backup-passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    let rejectDecrypt!: (error: Error) => void
    cryptoMocks.decryptVault.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectDecrypt = reject
        }),
    )

    const importing = useAppStore
      .getState()
      .importBackup(new File(['{}'], 'backup.json', { type: 'application/json' }))
    await vi.waitFor(() => expect(cryptoMocks.decryptVault).toHaveBeenCalledOnce())

    const localized = {
      ...data,
      preferences: { ...data.preferences, language: 'zh-CN' as const },
    }
    useAppStore.setState({ data: localized })
    rejectDecrypt(new Error('C:\\private\\backup-secret'))
    await importing

    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: appT(localized, 'settings.importFailed'),
      tone: 'error',
    })
    expect(useAppStore.getState().toasts.at(-1)?.message).not.toBe(
      appT(data, 'settings.importFailed'),
    )
  })

  it('contains backup import preflight notice failures without changing local state', async () => {
    const data = resetStore()
    const keys = useAppStore.getState().keys
    cryptoMocks.isEncryptedSnapshot.mockReturnValueOnce(true)
    useAppStore.setState({
      notify: () => {
        throw new Error('notification channel unavailable')
      },
      syncPassphrase: '',
    })

    await expect(
      useAppStore
        .getState()
        .importBackup(new File(['{}'], 'backup.json', { type: 'application/json' })),
    ).resolves.toBeUndefined()

    expect(useAppStore.getState().data).toBe(data)
    expect(useAppStore.getState().keys).toBe(keys)
  })

  it('adopts the atomically replaced reset snapshot without duplicating the fresh AppData save', async () => {
    const data = resetStore()
    data.preferences.compactMode = true
    dbMocks.saveAppData.mockClear()

    await useAppStore.getState().resetAll()

    expect(dbMocks.replaceLocalDataDocuments).toHaveBeenCalledTimes(1)
    expect(dbMocks.saveAppData).toHaveBeenCalledTimes(1)
    expect(dbMocks.saveAppData).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({ compactMode: true }),
      }),
    )
    expect(dbMocks.saveAppData).not.toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({ compactMode: false }),
      }),
    )
    expect(useAppStore.getState().data?.preferences).toMatchObject({
      compactMode: false,
      firstRunDone: true,
    })
  })

  it('cleans only unpublished imported Skill refs when the durable import fails', async () => {
    const data = resetStore()
    const previous = skill('previous', {
      chunks: [
        {
          contentRef: 'shared-ref',
          heading: 'Previous',
          id: 'previous-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const importedSkill = skill('imported', {
      chunks: [
        {
          contentRef: 'source-ref',
          heading: 'Imported',
          id: 'imported-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
        {
          contentRef: 'shared-ref',
          heading: 'Shared',
          id: 'shared-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const visible = { ...data, skills: [previous] }
    const imported = { ...data, skills: [importedSkill] }
    useAppStore.setState({ data: visible })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: imported,
      secrets: { providerKeys: {} },
    })
    dbMocks.persistExternalAppDataSkillContents.mockImplementationOnce(
      async (value: unknown) => {
        const next = value as AppData
        return {
          ...next,
          skills: next.skills.map((item) => ({
            ...item,
            chunks: item.chunks.map((chunk) => ({
              ...chunk,
              contentRef:
                chunk.contentRef === 'source-ref'
                  ? 'new-import-ref'
                  : chunk.contentRef,
            })),
          })),
        }
      },
    )
    secretMocks.commitProviderSecretSnapshotWithAppData.mockRejectedValueOnce(
      new Error('import commit failed'),
    )

    await useAppStore.getState().setSyncPassphrase('passphrase')
    const visibleBeforeImport = useAppStore.getState().data
    await useAppStore
      .getState()
      .importBackup(new File(['{}'], 'backup.json', { type: 'application/json' }))

    expect(useAppStore.getState().data).toBe(visibleBeforeImport)
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith(['new-import-ref'])
    expect(dbMocks.deleteSkillContentRefs).not.toHaveBeenCalledWith(['shared-ref'])
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'Invalid backup file.',
      tone: 'error',
    })
  })

  it('contains import cleanup failures without losing the primary import error or retry', async () => {
    const data = resetStore()
    const imported = {
      ...data,
      skills: [
        skill('imported-with-cleanup-failure', {
          chunks: [
            {
              contentRef: 'source-ref',
              heading: 'Imported',
              id: 'imported-cleanup-failure-chunk',
              keywords: [],
              tokenEstimate: 1,
            },
          ],
        }),
      ],
    }
    useAppStore.setState({ syncPassphrase: 'passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: imported,
      secrets: { providerKeys: {} },
    })
    dbMocks.persistExternalAppDataSkillContents.mockImplementationOnce(
      async (value: unknown) => {
        const next = value as AppData
        return {
          ...next,
          skills: next.skills.map((item) => ({
            ...item,
            chunks: item.chunks.map((chunk) => ({
              ...chunk,
              contentRef: 'new-import-ref',
            })),
          })),
        }
      },
    )
    secretMocks.commitProviderSecretSnapshotWithAppData.mockRejectedValueOnce(
      new Error('import commit failed'),
    )
    dbMocks.deleteSkillContentRefs.mockRejectedValueOnce(
      new Error('import cleanup failed'),
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const importing = useAppStore
      .getState()
      .importBackup(new File(['{}'], 'backup.json', { type: 'application/json' }))

    await expect(importing).resolves.toBeUndefined()
    expect(useAppStore.getState().data).toBe(data)
    expect(useAppStore.getState().keys).toEqual({
      [data.providers[0].id]: 'test-key',
    })
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'Invalid backup file.',
      tone: 'error',
    })

    dbMocks.deleteSkillContentRefs.mockResolvedValue(undefined)
    await useAppStore.getState().flushLocalSaves()
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledTimes(2)
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenLastCalledWith([
      'new-import-ref',
    ])
    consoleError.mockRestore()
  })

  it('does not admit a Skill mutation after import returns before stale ref cleanup settles', async () => {
    const previous = skill('previous', {
      chunks: [
        {
          contentRef: 'old-ref',
          heading: 'Previous',
          id: 'previous-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const data = freshData()
    data.skills = [previous]
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'passphrase' })

    const imported = structuredClone(data)
    imported.skills = []
    imported.updatedAt += 1
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: imported,
      secrets: { providerKeys: {} },
    })

    let releaseCleanup!: () => void
    const cleanup = new Promise<void>((resolve) => {
      releaseCleanup = resolve
    })
    dbMocks.deleteSkillContentRefs.mockImplementationOnce(async (refs) => {
      expect(refs).toEqual(['old-ref'])
      await cleanup
    })

    const importing = useAppStore
      .getState()
      .importBackup(new File(['{}'], 'backup.json', { type: 'application/json' }))
    await vi.waitFor(() =>
      expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith(['old-ref']),
    )

    const reused = skill('reused', {
      chunks: [
        {
          contentRef: 'old-ref',
          heading: 'Reused',
          id: 'reused-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    lazyMocks.loadSkillService.mockResolvedValueOnce({
      createUserSkillFromContent: vi.fn(async () => reused),
      createUserSkillFromFile: vi.fn(),
      editableSkillContent: vi.fn(),
    })
    await expect(useAppStore.getState().addSkill('Reused', 'Body')).resolves.toBe(
      false,
    )

    expect(useAppStore.getState().data?.skills).toEqual([])
    expect(dbMocks.persistSkillContents).not.toHaveBeenCalled()

    releaseCleanup()
    await Promise.all([importing])
    expect(useAppStore.getState().data?.skills).toEqual([])
  })

  it('retries stale Skill ref cleanup after a successful import without a new edit', async () => {
    const previous = skill('import-cleanup-previous', {
      chunks: [
        {
          contentRef: 'import-cleanup-old-ref',
          heading: 'Previous',
          id: 'import-cleanup-previous-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const data = freshData()
    data.skills = [previous]
    resetStore(data)
    useAppStore.setState({ syncPassphrase: 'passphrase' })

    const imported = structuredClone(data)
    imported.skills = []
    imported.updatedAt += 1
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: imported,
      secrets: { providerKeys: {} },
    })
    dbMocks.deleteSkillContentRefs.mockRejectedValueOnce(
      new Error('import cleanup unavailable'),
    )
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await useAppStore
      .getState()
      .importBackup(new File(['{}'], 'backup.json', { type: 'application/json' }))

    expect(useAppStore.getState().data?.skills).toEqual([])
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith([
      'import-cleanup-old-ref',
    ])

    await useAppStore.getState().flushLocalSaves()
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledTimes(2)
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenLastCalledWith([
      'import-cleanup-old-ref',
    ])

    await useAppStore.getState().flushLocalSaves()
    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledTimes(2)
  })

  it('does not let an older import preflight overwrite a newer replacement', async () => {
    const data = resetStore()
    useAppStore.setState({ syncPassphrase: 'passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)

    const firstImported = structuredClone(data)
    firstImported.preferences.theme = 'dark'
    firstImported.updatedAt += 1
    const secondImported = structuredClone(data)
    secondImported.preferences.theme = 'light'
    secondImported.updatedAt += 2

    let resolveFirst!: (value: { data: AppData; secrets: { providerKeys: Record<string, string> } }) => void
    let resolveSecond!: (value: { data: AppData; secrets: { providerKeys: Record<string, string> } }) => void
    cryptoMocks.decryptVault
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve
          }),
      )

    const firstImport = useAppStore
      .getState()
      .importBackup(new File(['{}'], 'first.json', { type: 'application/json' }))
    await vi.waitFor(() => expect(cryptoMocks.decryptVault).toHaveBeenCalledTimes(1))

    const secondImport = useAppStore
      .getState()
      .importBackup(new File(['{}'], 'second.json', { type: 'application/json' }))
    await vi.waitFor(() => expect(cryptoMocks.decryptVault).toHaveBeenCalledTimes(2))

    resolveSecond({ data: secondImported, secrets: { providerKeys: {} } })
    await secondImport
    expect(useAppStore.getState().data?.preferences.theme).toBe('light')

    resolveFirst({ data: firstImported, secrets: { providerKeys: {} } })
    await firstImport

    expect(useAppStore.getState().data?.preferences.theme).toBe('light')
  })

  it('does not let an older import preflight overwrite a newer reset', async () => {
    const data = resetStore()
    useAppStore.setState({ syncPassphrase: 'passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    const importedData = structuredClone(data)
    importedData.preferences.theme = 'dark'
    importedData.updatedAt += 1

    let resolveImport!: (value: {
      data: AppData
      secrets: { providerKeys: Record<string, string> }
    }) => void
    cryptoMocks.decryptVault.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveImport = resolve
        }),
    )

    const importing = useAppStore
      .getState()
      .importBackup(new File(['{}'], 'slow.json', { type: 'application/json' }))
    await vi.waitFor(() => expect(cryptoMocks.decryptVault).toHaveBeenCalledOnce())

    await useAppStore.getState().resetAll()
    expect(useAppStore.getState().data?.preferences.theme).toBe('system')

    resolveImport({ data: importedData, secrets: { providerKeys: {} } })
    await importing

    expect(useAppStore.getState().data?.preferences.theme).toBe('system')
    expect(useAppStore.getState().keys).toEqual({})
  })

  it('keeps an already-admitted import ahead of a later import intent', async () => {
    const data = resetStore()
    useAppStore.setState({ syncPassphrase: 'passphrase' })
    await useAppStore.getState().flushLocalSaves()
    useAppStore.getState().setTheme('dark')
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)

    const firstImported = structuredClone(data)
    firstImported.preferences.theme = 'dark'
    firstImported.updatedAt += 1
    const secondImported = structuredClone(data)
    secondImported.preferences.theme = 'light'
    secondImported.updatedAt += 2
    cryptoMocks.decryptVault
      .mockResolvedValueOnce({ data: firstImported, secrets: { providerKeys: {} } })
      .mockResolvedValueOnce({ data: secondImported, secrets: { providerKeys: {} } })

    let releaseLocalSave!: () => void
    const localSave = new Promise<void>((resolve) => {
      releaseLocalSave = resolve
    })
    let localSaveStarted!: () => void
    const localSaveStart = new Promise<void>((resolve) => {
      localSaveStarted = resolve
    })
    dbMocks.persistAppDataSkillContents.mockImplementationOnce(async (value) => {
      localSaveStarted()
      await localSave
      return value
    })

    const firstImport = useAppStore
      .getState()
      .importBackup(new File(['{}'], 'first.json', { type: 'application/json' }))
    await localSaveStart

    const secondImport = useAppStore
      .getState()
      .importBackup(new File(['{}'], 'second.json', { type: 'application/json' }))
    await vi.waitFor(() => expect(cryptoMocks.decryptVault).toHaveBeenCalledTimes(2))

    releaseLocalSave()
    await Promise.all([firstImport, secondImport])

    expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledTimes(2)
    expect(
      secretMocks.commitProviderSecretSnapshotWithAppData.mock.calls.map(
        ([, , target]) => (target as AppData).preferences.theme,
      ),
    ).toEqual(['dark', 'light'])
    expect(useAppStore.getState().data?.preferences.theme).toBe('light')
  })

  it('rejects plaintext backups before touching local state', async () => {
    const previous = useAppStore.getState().data
    const previousKeys = useAppStore.getState().keys

    await useAppStore
      .getState()
      .importBackup(new File(['{"kind":"zerochat.backup"}'], 'backup.json'))

    expect(useAppStore.getState().data).toBe(previous)
    expect(useAppStore.getState().keys).toBe(previousKeys)
    expect(secretMocks.commitProviderSecretSnapshotWithAppData).not.toHaveBeenCalled()
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'Invalid backup file.',
      tone: 'error',
    })
  })

  it('rejects decrypted backups outside the canonical sync vault shape', async () => {
    const previous = resetStore()
    useAppStore.setState({ syncPassphrase: 'backup-passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({ data: previous, secrets: null })

    await useAppStore
      .getState()
      .importBackup(new File(['{}'], 'backup.json', { type: 'application/json' }))

    expect(secretMocks.commitProviderSecretSnapshotWithAppData).not.toHaveBeenCalled()
    expect(useAppStore.getState().data).toBe(previous)
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'Invalid backup file.',
      tone: 'error',
    })
  })

  it('rejects an imported vault with duplicate Skill ids before publishing it', async () => {
    const previous = resetStore()
    useAppStore.setState({ syncPassphrase: 'backup-passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    const duplicateA = skill('duplicate-skill', {
      name: 'First duplicate',
      chunks: [
        {
          contentRef: 'duplicate-ref-a',
          heading: 'First',
          id: 'duplicate-chunk-a',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    const duplicateB = skill('duplicate-skill', {
      name: 'Second duplicate',
      chunks: [
        {
          contentRef: 'duplicate-ref-b',
          heading: 'Second',
          id: 'duplicate-chunk-b',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    cryptoMocks.decryptVault.mockResolvedValue({
      data: { ...previous, skills: [duplicateA, duplicateB] },
      secrets: { providerKeys: {} },
    })

    await expect(
      useAppStore
        .getState()
        .importBackup(new File(['{}'], 'duplicate-skills.json', { type: 'application/json' })),
    ).resolves.toBeUndefined()

    expect(secretMocks.commitProviderSecretSnapshotWithAppData).not.toHaveBeenCalled()
    expect(useAppStore.getState().data).toBe(previous)
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'Invalid backup file.',
      tone: 'error',
    })
  })

  it('rejects an imported vault with duplicate conversation ids before publishing it', async () => {
    const previous = resetStore()
    useAppStore.setState({ syncPassphrase: 'backup-passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    const original = previous.conversations[0]
    const duplicateConversations = [
      { ...original, title: 'First duplicate conversation' },
      { ...original, title: 'Second duplicate conversation' },
    ]
    cryptoMocks.decryptVault.mockResolvedValue({
      data: {
        ...previous,
        conversations: duplicateConversations,
        preferences: {
          ...previous.preferences,
          activeConversationId: original.id,
        },
      },
      secrets: { providerKeys: {} },
    })

    await expect(
      useAppStore
        .getState()
        .importBackup(new File(['{}'], 'duplicate-conversations.json', { type: 'application/json' })),
    ).resolves.toBeUndefined()

    expect(secretMocks.commitProviderSecretSnapshotWithAppData).not.toHaveBeenCalled()
    expect(useAppStore.getState().data).toBe(previous)
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'Invalid backup file.',
      tone: 'error',
    })
  })

  it('rejects an imported conversation with duplicate message ids before publishing it', async () => {
    const previous = resetStore()
    useAppStore.setState({ syncPassphrase: 'backup-passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    const original = previous.conversations[0]
    const duplicateMessage = message('duplicate-message', 'user', 'First message')
    const duplicateMessages = [
      duplicateMessage,
      { ...duplicateMessage, role: 'assistant', content: 'Second message' },
    ]
    cryptoMocks.decryptVault.mockResolvedValue({
      data: {
        ...previous,
        conversations: [{ ...original, messages: duplicateMessages }],
      },
      secrets: { providerKeys: {} },
    })

    await expect(
      useAppStore
        .getState()
        .importBackup(new File(['{}'], 'duplicate-messages.json', { type: 'application/json' })),
    ).resolves.toBeUndefined()

    expect(secretMocks.commitProviderSecretSnapshotWithAppData).not.toHaveBeenCalled()
    expect(useAppStore.getState().data).toBe(previous)
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'Invalid backup file.',
      tone: 'error',
    })
  })

  it('rejects malformed conversation and message entries without throwing', async () => {
    const previous = resetStore()
    expect(() =>
      isSyncVaultShape({
        data: { ...previous, conversations: [null] },
        secrets: { providerKeys: {} },
      }),
    ).not.toThrow()
    expect(() =>
      isSyncVaultShape({
        data: {
          ...previous,
          conversations: [{
            ...previous.conversations[0],
            messages: [null],
          }],
        },
        secrets: { providerKeys: {} },
      }),
    ).not.toThrow()

    useAppStore.setState({ syncPassphrase: 'backup-passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: { ...previous, conversations: [null] },
      secrets: { providerKeys: {} },
    })

    await expect(
      useAppStore
        .getState()
        .importBackup(new File(['{}'], 'malformed-conversations.json', { type: 'application/json' })),
    ).resolves.toBeUndefined()

    expect(secretMocks.commitProviderSecretSnapshotWithAppData).not.toHaveBeenCalled()
    expect(useAppStore.getState().data).toBe(previous)
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'Invalid backup file.',
      tone: 'error',
    })
  })

  it('normalizes a dangling imported active conversation id to the first valid conversation', async () => {
    const previous = resetStore()
    const imported = structuredClone(previous)
    imported.preferences.activeConversationId = 'missing-conversation'
    useAppStore.setState({ syncPassphrase: 'backup-passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: imported,
      secrets: { providerKeys: {} },
    })

    await useAppStore
      .getState()
      .importBackup(new File(['{}'], 'dangling-active.json', { type: 'application/json' }))

    expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce()
    expect(useAppStore.getState().data?.preferences.activeConversationId).toBe(
      imported.conversations[0]?.id,
    )
  })

  it('rejects malformed Skill entries without throwing before publishing them', async () => {
    const previous = resetStore()
    expect(() =>
      isSyncVaultShape({
        data: { ...previous, skills: [null] },
        secrets: { providerKeys: {} },
      }),
    ).not.toThrow()
    useAppStore.setState({ syncPassphrase: 'backup-passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    cryptoMocks.decryptVault.mockResolvedValue({
      data: { ...previous, skills: [null] },
      secrets: { providerKeys: {} },
    })

    await expect(
      useAppStore
        .getState()
        .importBackup(new File(['{}'], 'malformed-skills.json', { type: 'application/json' })),
    ).resolves.toBeUndefined()

    expect(secretMocks.commitProviderSecretSnapshotWithAppData).not.toHaveBeenCalled()
    expect(useAppStore.getState().data).toBe(previous)
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'Invalid backup file.',
      tone: 'error',
    })
  })

  it('rejects an imported Skill with duplicate chunk ids before publishing it', async () => {
    const previous = resetStore()
    useAppStore.setState({ syncPassphrase: 'backup-passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    const duplicateChunks = skill('duplicate-chunk-skill', {
      chunks: [
        {
          contentRef: 'duplicate-ref-a',
          heading: 'First',
          id: 'duplicate-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
        {
          contentRef: 'duplicate-ref-b',
          heading: 'Second',
          id: 'duplicate-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    cryptoMocks.decryptVault.mockResolvedValue({
      data: { ...previous, skills: [duplicateChunks] },
      secrets: { providerKeys: {} },
    })

    await expect(
      useAppStore
        .getState()
        .importBackup(new File(['{}'], 'duplicate-chunks.json', { type: 'application/json' })),
    ).resolves.toBeUndefined()

    expect(secretMocks.commitProviderSecretSnapshotWithAppData).not.toHaveBeenCalled()
    expect(useAppStore.getState().data).toBe(previous)
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'Invalid backup file.',
      tone: 'error',
    })
  })

  it('allows an imported Skill to replace an existing same-id row', async () => {
    const previous = freshData()
    previous.skills = [
      skill('replaceable-skill', {
        chunks: [
          {
            contentRef: 'replaceable-old-ref',
            heading: 'Old',
            id: 'replaceable-old-chunk',
            keywords: [],
            tokenEstimate: 1,
          },
        ],
      }),
    ]
    resetStore(previous)
    useAppStore.setState({ syncPassphrase: 'backup-passphrase' })
    cryptoMocks.isEncryptedSnapshot.mockReturnValue(true)
    const replacement = skill('replaceable-skill', {
      name: 'Replacement Skill',
      chunks: [
        {
          contentRef: 'replaceable-new-ref',
          heading: 'New',
          id: 'replaceable-new-chunk',
          keywords: [],
          tokenEstimate: 1,
        },
      ],
    })
    cryptoMocks.decryptVault.mockResolvedValue({
      data: { ...previous, skills: [replacement] },
      secrets: { providerKeys: {} },
    })

    await useAppStore
      .getState()
      .importBackup(new File(['{}'], 'replacement.json', { type: 'application/json' }))

    expect(secretMocks.commitProviderSecretSnapshotWithAppData).toHaveBeenCalledOnce()
    expect(useAppStore.getState().data?.skills).toEqual([replacement])
  })

  it('does not publish a reset when the durable secret/AppData transition fails', async () => {
    const previous = useAppStore.getState().data
    const previousKeys = useAppStore.getState().keys
    const failure = new Error('reset persistence failed')
    secretMocks.commitZeroChatSecretSnapshotWithAppData.mockRejectedValueOnce(failure)

    await useAppStore.getState().resetAll()

    expect(useAppStore.getState().data).toBe(previous)
    expect(useAppStore.getState().keys).toBe(previousKeys)
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: 'Reset failed; local data was not changed. Try again.',
      tone: 'error',
    })
    expect(dbMocks.replaceLocalDataDocuments).not.toHaveBeenCalled()
  })

  it('publishes a feature-hint dismissal only after the preference is durable and only once', async () => {
    resetStore()
    let releaseDismissSave!: () => void
    const dismissSave = new Promise<void>((resolve) => {
      releaseDismissSave = resolve
    })
    dbMocks.saveAppData.mockImplementation(async (value: unknown) => {
      const snapshot = value as AppData
      if (snapshot.preferences.dismissedFeatureHints?.includes('chat')) {
        await dismissSave
      }
    })

    const dismissal = useAppStore.getState().dismissFeatureHint('chat')
    await vi.waitFor(() => {
      expect(dbMocks.saveAppData).toHaveBeenCalledWith(
        expect.objectContaining({
          preferences: expect.objectContaining({
            dismissedFeatureHints: ['chat'],
          }),
        }),
      )
    })
    expect(useAppStore.getState().data?.preferences.dismissedFeatureHints).not.toContain(
      'chat',
    )

    releaseDismissSave()
    await expect(dismissal).resolves.toBe(true)
    expect(useAppStore.getState().data?.preferences.dismissedFeatureHints).toEqual([
      'chat',
    ])

    const persistedDismissals = dbMocks.saveAppData.mock.calls.filter(
      ([snapshot]) =>
        (snapshot as AppData).preferences.dismissedFeatureHints?.includes('chat'),
    )
    await expect(
      useAppStore.getState().dismissFeatureHint('chat'),
    ).resolves.toBe(true)
    expect(
      dbMocks.saveAppData.mock.calls.filter(
        ([snapshot]) =>
          (snapshot as AppData).preferences.dismissedFeatureHints?.includes('chat'),
      ),
    ).toHaveLength(persistedDismissals.length)
  })

  it('keeps a feature hint visible when persistence fails without exposing diagnostics', async () => {
    const data = resetStore()
    const failure = new Error(
      'C:\\private\\workspace\\settings.db Bearer feature-secret-123456789',
    )
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    dbMocks.saveAppData.mockImplementation(async (value: unknown) => {
      const snapshot = value as AppData
      if (snapshot.preferences.dismissedFeatureHints?.includes('chat')) {
        throw failure
      }
    })

    await expect(
      useAppStore.getState().dismissFeatureHint('chat'),
    ).resolves.toBe(false)

    expect(useAppStore.getState().data?.preferences.dismissedFeatureHints).not.toContain(
      'chat',
    )
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
      message: appT(data, 'settings.saveFailed'),
      tone: 'error',
    })
    const userMessage = useAppStore.getState().toasts.at(-1)?.message ?? ''
    expect(userMessage).not.toContain('private')
    expect(userMessage).not.toContain('feature-secret')
    expect(userMessage).not.toContain(failure.message)
    expect(userMessage).not.toContain(String(failure))
    expect(consoleError).toHaveBeenCalledWith('[app] feature hint dismissal save failed')
    expectConsoleErrorDoesNotExpose(consoleError, failure)
  })

  it('queues newly materialized Skill refs when feature-hint persistence fails', async () => {
    const data = freshData()
    data.skills = [
      skill('feature-hint-cleanup', {
        chunks: [
          {
            contentRef: 'skill-chunk:feature-hint-old',
            heading: 'Body',
            id: 'feature-hint-chunk',
            keywords: [],
            tokenEstimate: 2,
          },
        ],
      }),
    ]
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    dbMocks.deleteSkillContentRefs.mockClear()

    const persisted = structuredClone(data)
    persisted.skills[0].chunks[0] = {
      ...persisted.skills[0].chunks[0],
      contentPreview: 'feature hint body',
      contentRef: 'skill-chunk:feature-hint-new',
    }
    dbMocks.persistAppDataSkillContents.mockResolvedValueOnce(persisted)
    dbMocks.saveAppData.mockRejectedValueOnce(new Error('feature hint save failed'))

    await expect(
      useAppStore.getState().dismissFeatureHint('chat'),
    ).resolves.toBe(false)

    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith([
      'skill-chunk:feature-hint-new',
    ])
  })

  it('cleans materialized Skill refs from a stale feature-hint save', async () => {
    const data = freshData()
    data.skills = [
      skill('feature-hint-race', {
        chunks: [
          {
            contentRef: 'skill-chunk:feature-hint-race-old',
            heading: 'Body',
            id: 'feature-hint-race-chunk',
            keywords: [],
            tokenEstimate: 2,
          },
        ],
      }),
    ]
    resetStore(data)
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()
    dbMocks.deleteSkillContentRefs.mockClear()

    const persisted = structuredClone(data)
    persisted.preferences.dismissedFeatureHints = ['chat']
    persisted.skills[0].chunks[0] = {
      ...persisted.skills[0].chunks[0],
      contentPreview: 'feature hint race body',
      contentRef: 'skill-chunk:feature-hint-race-new',
    }
    dbMocks.persistAppDataSkillContents.mockImplementationOnce(
      async () => persisted,
    )

    let releaseSave!: () => void
    const pendingSave = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    dbMocks.saveAppData.mockImplementationOnce(async () => pendingSave)

    const dismissal = useAppStore.getState().dismissFeatureHint('chat')
    await vi.waitFor(() => expect(dbMocks.saveAppData).toHaveBeenCalledOnce())

    useAppStore.getState().setTheme('dark')
    releaseSave()
    await expect(dismissal).resolves.toBe(true)

    expect(dbMocks.deleteSkillContentRefs).toHaveBeenCalledWith([
      'skill-chunk:feature-hint-race-new',
    ])
    expect(useAppStore.getState().data?.preferences).toMatchObject({
      dismissedFeatureHints: ['chat'],
      theme: 'dark',
    })
  })

  it('preserves a concurrent AppData revision while a feature-hint dismissal is saving', async () => {
    resetStore()
    let targetSaveCount = 0
    let releaseFirstTargetSave!: () => void
    const firstTargetSave = new Promise<void>((resolve) => {
      releaseFirstTargetSave = resolve
    })
    dbMocks.saveAppData.mockImplementation(async (value: unknown) => {
      const snapshot = value as AppData
      if (!snapshot.preferences.dismissedFeatureHints?.includes('chat')) return
      targetSaveCount += 1
      if (targetSaveCount === 1) await firstTargetSave
    })

    const dismissal = useAppStore.getState().dismissFeatureHint('chat')
    await vi.waitFor(() => expect(targetSaveCount).toBe(1))
    useAppStore.getState().setTheme('dark')
    releaseFirstTargetSave()

    await expect(dismissal).resolves.toBe(true)
    expect(targetSaveCount).toBe(2)
    expect(useAppStore.getState().data?.preferences).toMatchObject({
      dismissedFeatureHints: ['chat'],
      theme: 'dark',
    })
  })

  it('serializes feature-hint persistence with a concurrent local save', async () => {
    resetStore()
    await useAppStore.getState().flushLocalSaves()
    dbMocks.saveAppData.mockClear()

    let releaseHintPersist!: () => void
    const hintPersist = new Promise<void>((resolve) => {
      releaseHintPersist = resolve
    })
    let hintPersistCount = 0
    let themeSaveStarted = false
    let releaseThemeSave!: () => void
    const themeSave = new Promise<void>((resolve) => {
      releaseThemeSave = resolve
    })
    let activeSaves = 0
    let maximumActiveSaves = 0

    dbMocks.persistAppDataSkillContents.mockImplementation(
      async (value: unknown) => {
        const snapshot = value as AppData
        if (
          snapshot.preferences.dismissedFeatureHints?.includes('chat') &&
          hintPersistCount++ === 0
        ) {
          await hintPersist
        }
        return value
      },
    )
    dbMocks.saveAppData.mockImplementation(async (value: unknown) => {
      activeSaves += 1
      maximumActiveSaves = Math.max(maximumActiveSaves, activeSaves)
      try {
        const snapshot = value as AppData
        if (
          snapshot.preferences.theme === 'dark' &&
          !themeSaveStarted
        ) {
          themeSaveStarted = true
          await themeSave
        }
      } finally {
        activeSaves -= 1
      }
    })

    const dismissal = useAppStore.getState().dismissFeatureHint('chat')
    await vi.waitFor(() => expect(hintPersistCount).toBe(1))

    useAppStore.getState().setTheme('dark')
    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(() => expect(themeSaveStarted).toBe(true))

    releaseHintPersist()
    await Promise.resolve()
    expect(maximumActiveSaves).toBe(1)

    releaseThemeSave()
    await expect(dismissal).resolves.toBe(true)
    expect(maximumActiveSaves).toBe(1)
    expect(useAppStore.getState().data?.preferences).toMatchObject({
      dismissedFeatureHints: ['chat'],
      theme: 'dark',
    })
  })

  it('does not patch a same-id replacement after an orphaned replay terminalization starts', async () => {
    const data = resetStore()
    data.sync = { ...data.sync, autoSync: false, mode: 'gist' }
    useAppStore.setState({
      data,
      githubToken: 'github-token',
      syncPassphrase: 'sync-passphrase',
    })

    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('queued orphan terminal')
    await useAppStore.getState().flushLocalSaves()

    const queuedData = structuredClone(useAppStore.getState().data!)
    const queuedConversation = queuedData.conversations[0]!
    const queuedAssistant = queuedConversation.messages.at(-1)!
    queuedAssistant.queuedTextRequest!.providerId = 'missing-provider'
    useAppStore.setState({ data: queuedData })

    let releaseTerminalPersist!: () => void
    let terminalPersistStarted = false
    dbMocks.persistAppDataSkillContents.mockImplementation(
      async (value: unknown) => {
        const snapshot = value as AppData
        const assistant = snapshot.conversations[0]?.messages.at(-1)
        if (assistant?.status === 'error' && !terminalPersistStarted) {
          terminalPersistStarted = true
          await new Promise<void>((resolve) => {
            releaseTerminalPersist = resolve
          })
        }
        return value
      },
    )

    const replacement = structuredClone(queuedData)
    const replacementAssistant = replacement.conversations[0]!.messages.at(-1)!
    replacementAssistant.content = 'new generation content'
    replacementAssistant.createdAt += 100
    replacementAssistant.generationId = 'new-generation'
    replacementAssistant.status = 'streaming'
    delete replacementAssistant.queuedTextRequest
    delete replacementAssistant.offlineReplayClaim
    replacement.conversations[0]!.updatedAt += 1
    replacement.updatedAt += 1

    syncMocks.performSync.mockResolvedValueOnce(syncResult(replacement))
    navigatorStub.onLine = true
    const replay = useAppStore.getState().flushOfflineQueue()
    await vi.waitFor(() => expect(terminalPersistStarted).toBe(true))

    const syncing = useAppStore.getState().syncNow()
    await vi.waitFor(() =>
      expect(
        useAppStore.getState().data?.conversations[0]?.messages.at(-1),
      ).toMatchObject({
        id: replacementAssistant.id,
        createdAt: replacementAssistant.createdAt,
        generationId: 'new-generation',
        status: 'streaming',
      }),
    )

    releaseTerminalPersist()
    await Promise.all([replay, syncing])

    expect(
      useAppStore.getState().data?.conversations[0]?.messages.at(-1),
    ).toMatchObject({
      id: replacementAssistant.id,
      createdAt: replacementAssistant.createdAt,
      content: 'new generation content',
      generationId: 'new-generation',
      status: 'streaming',
    })
  })

  it('drains a claimed offline replay before deleting its conversation', async () => {
    const data = resetStore()
    const conversationId = data.conversations[0]!.id
    const navigatorStub = { language: 'en-US', onLine: false }
    vi.stubGlobal('navigator', navigatorStub)
    await useAppStore.getState().sendMessage('claimed replay deletion')
    await useAppStore.getState().flushLocalSaves()

    let publishToken!: (token: string) => void
    let finishReplay!: () => void
    let replaySignal!: AbortSignal
    streamMocks.streamAssistantText.mockImplementationOnce(
      async ({
        onToken,
        signal,
      }: {
        onToken: (token: string) => void
        signal: AbortSignal
      }) => {
        publishToken = onToken
        replaySignal = signal
        await new Promise<void>((resolve) => {
          finishReplay = resolve
        })
      },
    )

    navigatorStub.onLine = true
    const replay = useAppStore.getState().flushOfflineQueue()
    await vi.waitFor(() =>
      expect(streamMocks.streamAssistantText).toHaveBeenCalledOnce(),
    )
    publishToken('partial before delete')
    await vi.advanceTimersByTimeAsync(40)

    vi.mocked(globalThis.confirm).mockReturnValueOnce(true)
    const deletion = useAppStore.getState().deleteConversation(conversationId)
    await vi.waitFor(() => expect(replaySignal.aborted).toBe(true))
    await Promise.resolve()
    expect(useAppStore.getState().data?.conversations).toContainEqual(
      expect.objectContaining({ id: conversationId }),
    )

    publishToken('late after claimed delete')
    finishReplay()
    await Promise.all([replay, deletion])

    expect(useAppStore.getState().data?.conversations).not.toContainEqual(
      expect.objectContaining({ id: conversationId }),
    )
    expect(
      useAppStore.getState().data?.conversations.some((conversation) =>
        conversation.messages.some((message) =>
          message.content.includes('late after claimed delete'),
        ),
      ),
    ).toBe(false)
  })
})
