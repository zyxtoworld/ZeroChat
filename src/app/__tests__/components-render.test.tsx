import { renderToStaticMarkup } from 'preact-render-to-string'
import { afterEach, describe, expect, it, vi } from 'vitest'

type HarnessState = Record<string, unknown>
type HarnessStore = {
  state: HarnessState | null
  useAppStore: ((selector: (state: HarnessState) => unknown) => unknown) & {
    getState: () => HarnessState | null
    setState: (patch: HarnessState) => void
  }
}

const storeHarness = vi.hoisted((): HarnessStore => {
  const harness: HarnessStore = {
    state: null,
    useAppStore: undefined as unknown as HarnessStore['useAppStore'],
  }
  const useAppStore = ((selector: (state: HarnessState) => unknown) =>
    selector(harness.state as HarnessState)) as HarnessStore['useAppStore']
  useAppStore.getState = () => harness.state
  useAppStore.setState = (patch: Record<string, unknown>) => {
    harness.state = { ...harness.state, ...patch }
  }
  harness.useAppStore = useAppStore
  return harness
})

vi.mock('../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store')>()
  return { ...actual, useAppStore: storeHarness.useAppStore }
})

vi.mock('lucide-react', () => {
  const names = [
    'ArrowLeft',
    'Check',
    'ChevronDown',
    'ChevronUp',
    'Copy',
    'Download',
    'Eye',
    'EyeOff',
    'GripVertical',
    'ImagePlus',
    'Lightbulb',
    'Menu',
    'PanelLeft',
    'PanelRight',
    'Pencil',
    'Plus',
    'RefreshCw',
    'RotateCcw',
    'Send',
    'SendHorizonal',
    'Settings',
    'Square',
    'Trash2',
    'Undo2',
    'Upload',
    'Volume2',
    'VolumeX',
    'X',
  ]
  return {
    ...Object.fromEntries(names.map((name) => [name, () => null])),
    RefreshCw: ({
      className,
      'aria-hidden': ariaHidden,
    }: {
      className?: string
      'aria-hidden'?: boolean | 'true' | 'false'
    }) => (
      <svg
        className={['lucide lucide-refresh-cw', className].filter(Boolean).join(' ')}
        aria-hidden={ariaHidden}
      />
    ),
  }
})

import type { ChatMessage, Conversation } from '../../types'
import { providerPresets } from '../../data/presets'
import { loadLocale, setRuntimeLocale, translate } from '../../i18n'
import { runtimeFailureCopy } from '../../services/startupFatalError'
import { createDefaultData } from '../../storage/db'
import { App, SettingsLoadingFallback } from '../App'
import { ChatView } from '../components/ChatView'
import { FeatureHint } from '../components/FeatureHint'
import { MessageContextMenu } from '../components/MessageContextMenu'
import { MessageList } from '../components/MessageList'
import { Onboarding } from '../components/Onboarding'
import { RuntimeBoundary } from '../components/RuntimeBoundary'
import { SecretInput } from '../components/SecretInput'
import {
  DataTab,
  GeneralTab,
  SettingsView,
  SkillsTab,
  SyncTab,
} from '../components/SettingsView'
import { Sidebar } from '../components/Sidebar'
import { Toasts } from '../components/Toast'
import { useAppStore } from '../store'

function message(
  id: string,
  role: ChatMessage['role'],
  content: string,
  patch: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    role,
    content,
    createdAt: 1,
    status: 'done',
    ...patch,
  }
}

function seedData(messages: ChatMessage[] = []): Conversation {
  const data = structuredClone(createDefaultData())
  const conversation = {
    ...data.conversations[0],
    messages,
  }
  data.preferences.language = 'en-US'
  data.preferences.firstRunDone = true
  data.preferences.activeConversationId = conversation.id
  data.conversations = [conversation]
  useAppStore.setState({
    conversationMutationPending: false,
    data,
    loadError: '',
    settingsOpen: false,
    sidebarCollapsed: false,
    status: 'ready',
    toasts: [],
  })
  return conversation
}

const noOp = () => undefined
const asyncNoOp = async () => undefined
const asyncTrue = async () => true

function markupHasTag(
  markup: string,
  tagName: string,
  attributes: RegExp[],
): boolean {
  const tags = markup.match(new RegExp(`<${tagName}\\b[^>]*>`, 'gu')) ?? []
  return tags.some((tag) => attributes.every((attribute) => attribute.test(tag)))
}

afterEach(() => {
  vi.unstubAllGlobals()
  useAppStore.setState({
    conversationMutationPending: false,
    data: null,
    loadError: '',
    settingsOpen: false,
    sidebarCollapsed: false,
    status: 'loading',
    toasts: [],
  })
})

describe('app component render contracts', () => {
  it('renders every Skill mutation control inert while the shared owner is pending', async () => {
    seedData()
    await loadLocale('en-US')
    const data = useAppStore.getState()?.data as ReturnType<typeof createDefaultData>
    data.skills = [
      {
        autoMatch: true,
        chunks: [],
        contentHash: 'pending-skill-hash',
        contentType: 'markdown',
        createdAt: 1,
        description: 'Pending Skill',
        enabled: true,
        fileName: 'pending.md',
        fixed: false,
        id: 'pending-skill',
        keywords: [],
        name: 'Pending Skill',
        sourceSize: 10,
        updatedAt: 1,
      },
    ]
    useAppStore.setState({
      addSkill: async () => false,
      data,
      deleteSkill: asyncTrue,
      importSkills: async () => undefined,
      loadSkillContent: async () => '',
      notify: noOp,
      saveSkillContent: async () => false,
      setGlobalSkillAutoMatch: asyncTrue,
      setSkillToggle: asyncTrue,
      skillMutationPending: true,
      updateSkillSettings: noOp,
    })

    const markup = renderToStaticMarkup(<SkillsTab />)

    expect(markup).toContain('<div aria-busy="true">')
    expect(markup).toMatch(/<input[^>]*type="file"[^>]*disabled/)
    expect(markup).toMatch(/type="submit"[^>]*disabled[^>]*class="zc-btn primary"/)
    expect(markup.match(/role="switch"[^>]*disabled/g)).toHaveLength(3)
    expect(markup.match(/type="number"[^>]*disabled/g)).toHaveLength(2)
    expect(markup.match(/readonly/g)).toHaveLength(2)
    expect(markup.match(/disabled class="zc-icon-btn/g)).toHaveLength(2)
  })

  it('renders a localized accessible feature hint until its preference is dismissed', async () => {
    seedData()
    await loadLocale('en-US')
    useAppStore.setState({ dismissFeatureHint: asyncTrue })

    const visible = renderToStaticMarkup(
      <FeatureHint id="chat" restoreFocus={() => null} />,
    )

    expect(visible).toContain('data-feature-hint="chat"')
    expect(visible).toContain('role="status"')
    expect(visible).toContain('aria-live="polite"')
    expect(visible).toContain('aria-atomic="true"')
    expect(visible).toContain(translate('en-US', 'featureHint.chat'))
    expect(visible).toContain('Got it')

    const data = useAppStore.getState()?.data as ReturnType<typeof createDefaultData>
    data.preferences.dismissedFeatureHints = ['chat']
    useAppStore.setState({ data })

    expect(
      renderToStaticMarkup(<FeatureHint id="chat" restoreFocus={() => null} />),
    ).toBe('')
  })

  it('wires the chat feature hint to the active composer without announcing it behind Settings', async () => {
    seedData()
    await loadLocale('en-US')
    useAppStore.setState({
      composerMode: 'chat',
      composerImages: [],
      deleteMessage: asyncTrue,
      dismissFeatureHint: asyncTrue,
      editAndResendMessage: asyncTrue,
      regenerate: asyncNoOp,
      renameConversation: asyncTrue,
      retryMessage: asyncNoOp,
      sending: false,
      imageTaskMode: 'generate',
      setConversationModelChoice: asyncTrue,
      setSettingsOpen: noOp,
      setSidebarCollapsed: noOp,
      settingsOpen: false,
      sidebarCollapsed: false,
      streaming: false,
      transcribingAudio: false,
    })

    expect(renderToStaticMarkup(<ChatView />)).toContain(
      'data-feature-hint="chat"',
    )

    const emptyChat = renderToStaticMarkup(<ChatView />)
    expect(emptyChat).toContain('data-conversation-starters="true"')
    expect(emptyChat).toContain('role="group"')
    expect(emptyChat.match(/data-conversation-starter="/g)).toHaveLength(4)
    expect(emptyChat.match(/data-conversation-starter="[^"]+" type="button"/g)).toHaveLength(4)

    seedData([message('user-1', 'user', 'Already started')])
    expect(renderToStaticMarkup(<ChatView />)).not.toContain(
      'data-conversation-starters="true"',
    )

    useAppStore.setState({ composerMode: 'image' })
    const imageMode = renderToStaticMarkup(<ChatView />)
    expect(imageMode).toContain('data-feature-hint="image"')
    expect(imageMode).not.toContain('data-feature-hint="chat"')

    useAppStore.setState({ settingsOpen: true })
    expect(renderToStaticMarkup(<ChatView />)).not.toContain(
      'data-feature-hint=',
    )
  })

  it('disables all composer modes while audio transcription owns the composer', async () => {
    seedData()
    await loadLocale('en-US')
    useAppStore.setState({
      composerMode: 'chat',
      composerImages: [],
      deleteMessage: asyncTrue,
      dismissFeatureHint: asyncTrue,
      editAndResendMessage: asyncTrue,
      imageTaskMode: 'generate',
      regenerate: asyncNoOp,
      renameConversation: asyncTrue,
      retryMessage: asyncNoOp,
      sending: false,
      setConversationModelChoice: asyncTrue,
      setSettingsOpen: noOp,
      setSidebarCollapsed: noOp,
      settingsOpen: false,
      sidebarCollapsed: false,
      streaming: false,
      transcribingAudio: true,
    })

    const markup = renderToStaticMarkup(<ChatView />)
    expect(
      markup.match(/data-zc-composer-mode="[^"]+"[^>]*disabled/g),
    ).toHaveLength(3)
  })

  it.each(['sending', 'streaming'] as const)(
    'disables conversation model selection while %s owns generation',
    (owner) => {
      seedData()
      useAppStore.setState({
        composerMode: 'chat',
        composerImages: [],
        deleteMessage: asyncTrue,
        dismissFeatureHint: asyncTrue,
        editAndResendMessage: asyncTrue,
        imageTaskMode: 'generate',
        regenerate: asyncNoOp,
        renameConversation: asyncTrue,
        retryMessage: asyncNoOp,
        sending: owner === 'sending',
        setConversationModelChoice: asyncTrue,
        setSettingsOpen: noOp,
        setSidebarCollapsed: noOp,
        settingsOpen: false,
        sidebarCollapsed: false,
        streaming: owner === 'streaming',
        transcribingAudio: false,
      })

      const markup = renderToStaticMarkup(<ChatView />)
      expect(
        markupHasTag(markup, 'select', [
          /class="zc-model-select"/u,
          /disabled/u,
        ]),
      ).toBe(true)
    },
  )

  it('keeps disabled Provider model groups visible but unavailable', () => {
    const conversation = seedData()
    const data = useAppStore.getState().data as ReturnType<typeof createDefaultData>
    const enabledProvider = data.providers[0]
    const disabledProvider = {
      ...enabledProvider,
      enabled: false,
      id: 'disabled-provider',
      model: 'disabled-model',
      models: ['disabled-model'],
      name: 'Disabled Provider',
    }
    conversation.providerId = disabledProvider.id
    conversation.model = disabledProvider.model
    data.providers = [enabledProvider, disabledProvider]
    useAppStore.setState({
      composerMode: 'chat',
      composerImages: [],
      data,
      deleteMessage: asyncTrue,
      dismissFeatureHint: asyncTrue,
      editAndResendMessage: asyncTrue,
      imageTaskMode: 'generate',
      regenerate: asyncNoOp,
      renameConversation: asyncTrue,
      retryMessage: asyncNoOp,
      sending: false,
      setConversationModelChoice: asyncTrue,
      setSettingsOpen: noOp,
      setSidebarCollapsed: noOp,
      settingsOpen: false,
      sidebarCollapsed: false,
      streaming: false,
      transcribingAudio: false,
    })

    const markup = renderToStaticMarkup(<ChatView />)

    expect(
      markupHasTag(markup, 'optgroup', [
        /label="Disabled Provider"/u,
        /\bdisabled(?:="")?/u,
      ]),
    ).toBe(true)
  })

  it('renders the configurable chat context window with bounded guidance', () => {
    seedData()
    useAppStore.setState({
      setChatContextMessageLimit: noOp,
      setLanguage: asyncNoOp,
      setTheme: noOp,
      toggleCompact: noOp,
    })

    const markup = renderToStaticMarkup(<GeneralTab />)

    expect(markup).toContain('data-zc-compact-toggle="true"')
    expect(markup).toContain('data-chat-context-setting="true"')
    expect(markup).toContain('min="4"')
    expect(markup).toContain('max="200"')
    expect(markup).toContain('aria-describedby="settings-chat-context-help"')
    expect(markup).toContain('id="settings-chat-context-help"')
  })

  it('renders sync mode selection as an accessible named group', () => {
    seedData()
    useAppStore.setState({
      clearRemoteSync: async () => undefined,
      copySyncAccessKey: async () => undefined,
      githubToken: '',
      notify: noOp,
      resolveSyncConflict: async () => undefined,
      saveGithubToken: asyncTrue,
      setSyncAutoSync: asyncTrue,
      setSyncGistFile: noOp,
      setSyncGistId: noOp,
      setSyncMode: asyncTrue,
      setSyncWorkerEndpoint: noOp,
      syncConflict: false,
      syncing: false,
      syncNow: async () => undefined,
    })

    const markup = renderToStaticMarkup(<SyncTab />)

    expect(markup).toContain('role="group"')
    expect(markup).toContain('aria-describedby="settings-sync-mode-help"')
    expect(markup).toContain('id="settings-sync-mode-help"')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('aria-pressed="false"')
    expect(markup).toContain('data-zc-sync-now="true"')
  })

  it('animates the sync status icon only while synchronization is active', () => {
    seedData()
    useAppStore.setState({
      clearRemoteSync: async () => undefined,
      copySyncAccessKey: async () => undefined,
      githubToken: '',
      notify: noOp,
      resolveSyncConflict: async () => undefined,
      saveGithubToken: asyncTrue,
      setSyncAutoSync: asyncTrue,
      setSyncGistFile: noOp,
      setSyncGistId: noOp,
      setSyncMode: asyncTrue,
      setSyncWorkerEndpoint: noOp,
      syncConflict: false,
      syncing: false,
      syncNow: async () => undefined,
    })

    const idleMarkup = renderToStaticMarkup(<SyncTab />)
    expect(idleMarkup).not.toContain('zc-sync-spinner')

    useAppStore.setState({ syncing: true })
    const syncingMarkup = renderToStaticMarkup(<SyncTab />)
    expect(syncingMarkup).toContain(
      'class="lucide lucide-refresh-cw zc-sync-spinner"',
    )
    expect(syncingMarkup).toMatch(/<svg[^>]*aria-hidden="true"/)
  })

  it('renders the derived Cloudflare access-key copy action in the current Sync surface', () => {
    seedData()
    const data = useAppStore.getState()?.data as ReturnType<typeof createDefaultData>
    data.sync = { ...data.sync, mode: 'cloudflare' }
    useAppStore.setState({
      clearRemoteSync: async () => undefined,
      copySyncAccessKey: async () => undefined,
      data,
      githubToken: '',
      notify: noOp,
      resolveSyncConflict: async () => undefined,
      saveGithubToken: asyncTrue,
      setSyncAutoSync: asyncTrue,
      setSyncGistFile: noOp,
      setSyncGistId: noOp,
      setSyncMode: asyncTrue,
      setSyncWorkerEndpoint: noOp,
      syncConflict: false,
      syncing: false,
      syncNow: async () => undefined,
      syncPassphrase: '',
    })

    const withoutPassphrase = renderToStaticMarkup(<SyncTab />)
    expect(withoutPassphrase).toContain('data-zc-cloudflare-access-key="true"')
    expect(withoutPassphrase).toContain('Cloudflare access key')
    expect(withoutPassphrase).toMatch(
      /aria-label="Copy: Cloudflare access key"[^>]*disabled/,
    )
    expect(withoutPassphrase).toContain('placeholder="Auto-generated"')
    expect(withoutPassphrase).toContain('role="status"')
    expect(withoutPassphrase).toContain(
      'Set an encryption passphrase in the Data tab first',
    )

    useAppStore.setState({ syncPassphrase: 'saved-passphrase' })
    const withPassphrase = renderToStaticMarkup(<SyncTab />)
    expect(withPassphrase).toContain('placeholder="Auto-generated"')
    expect(withPassphrase).not.toMatch(
      /aria-label="Copy: Cloudflare access key"[^>]*disabled/,
    )
  })

  it('localizes a persisted sync status through the active app locale', async () => {
    seedData()
    const data = useAppStore.getState()?.data as ReturnType<typeof createDefaultData>
    data.preferences.language = 'zh-CN'
    data.sync = {
      ...data.sync,
      lastSyncAt: 1,
      lastSyncStatus: 'Sync complete',
      mode: 'gist',
    }
    await loadLocale('zh-CN')
    useAppStore.setState({
      clearRemoteSync: async () => undefined,
      data,
      githubToken: '',
      notify: noOp,
      resolveSyncConflict: async () => undefined,
      saveGithubToken: asyncTrue,
      setSyncAutoSync: asyncTrue,
      setSyncGistFile: noOp,
      setSyncGistId: noOp,
      setSyncMode: asyncTrue,
      setSyncWorkerEndpoint: noOp,
      syncConflict: false,
      syncing: false,
      syncNow: async () => undefined,
    })

    const markup = renderToStaticMarkup(<SyncTab />)

    expect(markup).toContain('同步完成')
    expect(markup).not.toContain('Sync complete')
  })

  it('redacts untrusted persisted sync status before rendering the Sync tab', async () => {
    seedData()
    const data = useAppStore.getState()?.data as ReturnType<typeof createDefaultData>
    const path = 'C:\\private\\sync.log'
    const url = 'https://relay.example.test/v1?key=sk-sync-secret-1234567890'
    data.preferences.language = 'en-US'
    data.sync = {
      ...data.sync,
      lastSyncAt: 1,
      lastSyncStatus: `Sync failed ${path} ${url}`,
      mode: 'gist',
    }
    await loadLocale('en-US')
    useAppStore.setState({
      clearRemoteSync: async () => undefined,
      data,
      githubToken: '',
      notify: noOp,
      resolveSyncConflict: async () => undefined,
      saveGithubToken: asyncTrue,
      setSyncAutoSync: asyncTrue,
      setSyncGistFile: noOp,
      setSyncGistId: noOp,
      setSyncMode: asyncTrue,
      setSyncWorkerEndpoint: noOp,
      syncConflict: false,
      syncing: false,
      syncNow: async () => undefined,
    })

    const markup = renderToStaticMarkup(<SyncTab />)

    expect(markup).not.toContain(path)
    expect(markup).not.toContain(url)
    expect(markup).not.toContain('sk-sync-secret-1234567890')
    expect(markup).toContain('[redacted-path]')
    expect(markup).toContain('[redacted-url]')
  })

  it('renders first-sync choices as an inline alert inside the current Settings surface', () => {
    seedData()
    useAppStore.setState({
      clearRemoteSync: async () => undefined,
      githubToken: '',
      notify: noOp,
      resolveSyncConflict: async () => undefined,
      saveGithubToken: asyncTrue,
      setSyncAutoSync: asyncTrue,
      setSyncGistFile: noOp,
      setSyncGistId: noOp,
      setSyncMode: asyncTrue,
      setSyncWorkerEndpoint: noOp,
      syncConflict: true,
      syncing: false,
      syncNow: async () => undefined,
    })

    const markup = renderToStaticMarkup(<SyncTab />)

    expect(markup).toMatch(/role="alert" class="zc-sync-conflict"/)
    expect(markup).toContain('Use local data')
    expect(markup).toContain('Use remote data')
    expect(markup).toContain('Merge both')
    expect(markup.match(/<button type="button" class="zc-btn/g)).toHaveLength(3)
    expect(markup).not.toContain('role="dialog"')
  })

  it('renders Provider capability readiness, cost guidance, and result semantics', async () => {
    const conversation = seedData()
    const data = useAppStore.getState()?.data as ReturnType<typeof createDefaultData>
    const providerId = data.providers[0].id
    const providerName = 'Provider with a deliberately long accessible display name'
    data.providers[0] = {
      ...data.providers[0],
      name: providerName,
      proxyUrl: 'https://proxy.example',
    }
    data.conversations[0] = conversation
    await loadLocale('en-US')
    useAppStore.setState({
      addProvider: asyncTrue,
      checkProviderFullCapabilities: async () => undefined,
      checkingProviderId: '',
      deleteProvider: asyncTrue,
      fetchModels: async () => undefined,
      fetchingModelsFor: '',
      keys: { [providerId]: 'test-key' },
      notify: noOp,
      providerConnectivityResults: {
        [providerId]: {
          capabilityResults: {
            'image-generation': {
              message: 'Image generation passed',
              model: data.providers[0].imageModel ?? '',
              status: 'passed',
              tone: 'success',
            },
          },
          field: 'none',
          message: 'Capability checks complete',
          retryable: false,
          tone: 'success',
        },
      },
      saveProviderKey: asyncTrue,
      setSettingsOpen: noOp,
      updateProvider: noOp,
    })

    const markup = renderToStaticMarkup(<SettingsView />)

    expect(markup).toMatch(
      /role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="settings-dialog-title"[^>]*aria-describedby="settings-dialog-description"/,
    )
    expect(markup).toContain('<h2 id="settings-dialog-title">Settings</h2>')
    expect(markup).toContain(
      '<h3 id="settings-dialog-description">Providers</h3>',
    )
    expect(markup).toContain('data-feature-hint="providers"')
    expect(markup).toContain('data-provider-connectivity-check="true"')
    expect(markup).toContain('>Check connection</button>')
    expect(markup).toContain('data-provider-full-capability-check="true"')
    expect(markup).toContain('aria-describedby="provider-capability-cost-')
    expect(markup).toContain('data-provider-capability-readiness="ready"')
    expect(markup).toContain('role="list"')
    expect(markup).toContain('role="listitem"')
    expect(markup).toContain('Image generation passed')
    expect(markup).toContain('data-provider-capability-notice="true"')
    expect(markup).toContain('Capability checks complete')
    expect(markup).toContain('data-provider-key-clear="true"')
    expect(markup).toContain('>Clear key</button>')
    expect(markup).not.toContain('data-provider-connectivity-retry-action=')
    expect(markup).toContain(`aria-label="${providerName}"`)
    expect(markup).toContain(`data-tooltip="${providerName}"`)
    expect(markup).toContain('tabindex="0"')
    expect(markup).not.toContain(`title="${providerName}"`)

    useAppStore.setState({
      providerConnectivityResults: {
        [providerId]: {
          field: 'none',
          message: 'Connection failed',
          retryAction: 'fullCapabilities',
          retryable: true,
          tone: 'error',
        },
      },
    })
    const retryMarkup = renderToStaticMarkup(<SettingsView />)
    expect(retryMarkup).toContain(
      'data-provider-connectivity-retry-action="fullCapabilities"',
    )
    expect(retryMarkup).toContain(`aria-label="Retry: ${providerName}"`)
    expect(retryMarkup).toContain('>Retry</button>')

    useAppStore.setState({
      checkingProviderId: `${providerId}:capability:image-generation`,
    })
    const singleCheckMarkup = renderToStaticMarkup(<SettingsView />)
    expect(singleCheckMarkup).toContain(
      'data-provider-capability-action="image-generation"',
    )
    expect(singleCheckMarkup).toContain('aria-label="Checking…: Image generation"')
    expect(singleCheckMarkup).toMatch(
      /aria-label="Check capability: Image editing"[^>]*disabled/,
    )

    data.providers[0] = {
      ...data.providers[0],
      imageModel: '',
      models: [],
    }
    useAppStore.setState({
      checkingProviderId: '',
      data,
      providerConnectivityResults: {},
    })
    const blockedMarkup = renderToStaticMarkup(<SettingsView />)
    expect(blockedMarkup).toContain(
      'data-provider-capability-readiness="missing-models"',
    )
    expect(blockedMarkup).toMatch(
      /data-provider-full-capability-check="true"[^>]*disabled/,
    )
  })

  it('renders only path-safe Provider connectivity diagnostics in the current Settings DOM', async () => {
    const conversation = seedData()
    const data = useAppStore.getState()?.data as ReturnType<typeof createDefaultData>
    const providerId = data.providers[0].id
    data.conversations[0] = conversation
    await loadLocale('en-US')

    const safeMessage =
      'Models · HTTP 502 · [redacted-path] · [redacted-url] · [redacted]'
    useAppStore.setState({
      data,
      keys: { [providerId]: 'test-key' },
      providerConnectivityResults: {
        [providerId]: {
          field: 'baseUrl',
          message: safeMessage,
          retryable: true,
          tone: 'error',
        },
      },
    })

    const markup = renderToStaticMarkup(<SettingsView />)

    expect(markup).toContain(safeMessage)
    expect(markup).not.toContain('C:\\private\\provider.log')
    expect(markup).not.toContain('\\\\host\\share\\secret')
    expect(markup).not.toContain('/home/alice/.config/zerochat')
    expect(markup).not.toContain('/tmp/zerochat')
    expect(markup).not.toContain('sk-provider-secret')
  })

  it('renders the current Provider Base URL and keyed credential task', () => {
    seedData()
    useAppStore.setState({
      addProvider: asyncTrue,
      deleteProvider: asyncTrue,
      fetchModels: async () => undefined,
      fetchingModelsFor: '',
      keys: {},
      notify: noOp,
      saveProviderKey: asyncTrue,
      setSettingsOpen: noOp,
      updateProvider: noOp,
    })

    const markup = renderToStaticMarkup(<SettingsView />)

    expect(markup).toContain('placeholder="https://api.example.com/v1"')
    expect(markup).toContain('data-provider-id=')
    expect(markup).toContain('data-provider-key-input="true"')
    expect(markup).toContain('data-provider-key-save="true"')
  })

  it('disables Provider deletion while generation owns the active request', () => {
    seedData()
    const data = useAppStore.getState().data as ReturnType<typeof createDefaultData>
    data.providers = [
      data.providers[0],
      {
        ...data.providers[0],
        enabled: false,
        id: 'disabled-provider',
        name: 'Disabled Provider',
      },
    ]
    useAppStore.setState({
      addProvider: asyncTrue,
      checkProviderFullCapabilities: async () => undefined,
      checkingProviderId: '',
      deleteProvider: asyncTrue,
      fetchModels: async () => undefined,
      fetchingModelsFor: '',
      keys: {},
      notify: noOp,
      providerConnectivityResults: {},
      saveProviderKey: asyncTrue,
      streaming: true,
      updateProvider: noOp,
      data,
    })

    const markup = renderToStaticMarkup(<SettingsView />)

    expect(
      markupHasTag(markup, 'button', [
        /class="zc-btn danger"/u,
        /disabled/u,
      ]),
    ).toBe(true)
    expect(
      markupHasTag(markup, 'button', [
        /role="switch"/u,
        /aria-label="Enabled"/u,
        /disabled/u,
      ]),
    ).toBe(true)
    expect(
      markupHasTag(markup, 'button', [
        /role="switch"/u,
        /aria-label="Disabled"/u,
        /disabled/u,
      ]),
    ).toBe(false)
  })

  it('keeps provider preset option labels unique without changing preset ids', async () => {
    seedData()
    useAppStore.setState({
      addProvider: asyncTrue,
      checkProviderFullCapabilities: async () => undefined,
      checkingProviderId: '',
      deleteProvider: asyncTrue,
      fetchModels: async () => undefined,
      fetchingModelsFor: '',
      keys: {},
      notify: noOp,
      providerConnectivityResults: {},
      saveProviderKey: asyncTrue,
      setSettingsOpen: noOp,
      updateProvider: noOp,
    })

    for (const locale of [
      'zh-CN',
      'en-US',
      'es-ES',
      'hi-IN',
      'ar-SA',
      'pt-BR',
      'ru-RU',
      'ja-JP',
      'ko-KR',
      'fr-FR',
    ] as const) {
      await loadLocale(locale)
      const data = useAppStore.getState()?.data as ReturnType<typeof createDefaultData>
      data.preferences.language = locale
      useAppStore.setState({ data })

      const markup = renderToStaticMarkup(<SettingsView />)
      const selectMarkup = markup.match(
        /<select[^>]*aria-label="[^"]+"[\s\S]*?<\/select>/,
      )?.[0]
      const options = [
        ...(selectMarkup?.matchAll(
          /<option\b[^>]*\bvalue="([^"]+)"[^>]*>([^<]*)<\/option>/g,
        ) ?? []),
      ].map(([, value, label]) => ({ value, label: label.trim() }))

      expect(options.map((option) => option.value), locale).toEqual(
        providerPresets.map((preset) => preset.id),
      )
      expect(options.every((option) => option.label.length > 0), locale).toBe(true)
      expect(new Set(options.map((option) => option.label)).size, locale).toBe(
        options.length,
      )
      expect(selectMarkup?.match(/\bdata-tooltip="([^"]+)"/)?.[1]?.trim(), locale).toBeTruthy()
    }
  })

  it('renders contextual Provider reorder controls with bounded actions', () => {
    seedData()
    const data = useAppStore.getState()?.data as ReturnType<typeof createDefaultData>
    const first = data.providers[0]
    data.providers = [
      { ...first, id: 'provider-alpha', name: 'Alpha', enabled: true },
      { ...first, id: 'provider-beta', name: 'Beta', enabled: true },
    ]
    useAppStore.setState({
      addProvider: asyncTrue,
      checkProviderFullCapabilities: async () => undefined,
      checkingProviderId: '',
      deleteProvider: asyncTrue,
      fetchModels: async () => undefined,
      fetchingModelsFor: '',
      keys: {},
      notify: noOp,
      providerConnectivityResults: {},
      reorderProvider: asyncTrue,
      saveProviderKey: asyncTrue,
      setSettingsOpen: noOp,
      updateProvider: noOp,
    })

    const markup = renderToStaticMarkup(<SettingsView />)

    expect(markup.match(/class="zc-provider-drag-handle"/g)).toHaveLength(2)
    expect(markup).toContain('role="group"')
    expect(markup).toContain('data-tooltip="Drag to reorder provider: Alpha"')
    expect(markup).toMatch(/aria-label="Move provider up: Alpha"[^>]*disabled/)
    expect(markup).toContain('aria-label="Move provider down: Alpha"')
    expect(markup).toContain('aria-label="Move provider up: Beta"')
    expect(markup).toMatch(/aria-label="Move provider down: Beta"[^>]*disabled/)
    expect(markup).not.toContain('title="Drag to reorder provider:')
  })

  it('renders contextual model reorder controls with bounded actions', () => {
    seedData()
    const data = useAppStore.getState()?.data as ReturnType<typeof createDefaultData>
    data.providers[0] = {
      ...data.providers[0],
      models: ['model-alpha', 'model-beta'],
    }
    useAppStore.setState({
      addProvider: asyncTrue,
      checkProviderCapability: async () => undefined,
      checkProviderFullCapabilities: async () => undefined,
      checkingProviderId: '',
      deleteProvider: asyncTrue,
      fetchModels: async () => undefined,
      fetchingModelsFor: '',
      keys: {},
      notify: noOp,
      providerConnectivityResults: {},
      reorderProvider: asyncTrue,
      reorderProviderModel: asyncTrue,
      saveProviderKey: asyncTrue,
      setSettingsOpen: noOp,
      updateProvider: noOp,
    })

    const markup = renderToStaticMarkup(<SettingsView />)

    expect(markup).toContain('data-provider-model-drag="model-alpha"')
    expect(markup).toContain(
      'data-tooltip="Drag to reorder model: model-alpha"',
    )
    expect(markup).toMatch(
      /aria-label="Move model up: model-alpha"[^>]*disabled/,
    )
    expect(markup).toContain('aria-label="Move model down: model-alpha"')
    expect(markup).toMatch(
      /aria-label="Move model down: model-beta"[^>]*disabled/,
    )
    expect(markup).toContain('aria-label="Rename model: model-alpha"')
    expect(markup).toContain('data-tooltip="Rename model: model-alpha"')
  })

  it('keeps disabled model actions discoverable without mislabeling another Provider fetch', () => {
    seedData()
    useAppStore.setState({
      addProvider: asyncTrue,
      checkProviderCapability: async () => undefined,
      checkProviderFullCapabilities: async () => undefined,
      checkingProviderId: '',
      deleteProvider: asyncTrue,
      fetchModels: async () => undefined,
      fetchingModelsFor: 'another-provider',
      keys: {},
      notify: noOp,
      providerConnectivityResults: {},
      reorderProvider: asyncTrue,
      reorderProviderModel: asyncTrue,
      saveProviderKey: asyncTrue,
      setSettingsOpen: noOp,
      updateProvider: noOp,
    })

    const markup = renderToStaticMarkup(<SettingsView />)

    expect(markup).toMatch(
      /data-tooltip="Model name required"[^>]*tabindex="0"/,
    )
    expect(markup).toMatch(/data-provider-model-add-action="true"[^>]*disabled/)
    expect(markup).toMatch(
      /data-tooltip="Wait for the current model fetch to finish"[^>]*tabindex="0"/,
    )
    expect(markup).toMatch(/data-provider-model-fetch-action="true"[^>]*disabled/)
    expect(markup).toContain('>Fetch models</button>')
    expect(markup).not.toContain('>Fetching…</button>')
  })

  it('binds the Data passphrase input to localized guidance and keeps it masked', () => {
    seedData()
    useAppStore.setState({
      exportBackup: async () => undefined,
      importBackup: async () => undefined,
      notify: noOp,
      resetAll: async () => undefined,
      setSyncPassphrase: asyncTrue,
      syncPassphrase: '',
    })

    const markup = renderToStaticMarkup(<DataTab />)

    expect(markup).toContain('data-zc-reset-local="true"')
    expect(markup).toContain(
      'aria-describedby="settings-sync-passphrase-help"',
    )
    expect(markup).toMatch(
      /<input(?=[^>]*type="password")(?=[^>]*aria-describedby="settings-sync-passphrase-help")[^>]*>/,
    )
    expect(markup).toContain('id="settings-sync-passphrase-help"')
    expect(markup).toContain('Stored only on this device.')
  })

  it('disables every Data mutation control while one action owns the panel', () => {
    seedData()
    const markup = renderToStaticMarkup(<DataTab dataActionPending />)

    expect(markup).toMatch(/data-zc-export-backup="true"[^>]*disabled/)
    expect(markup).toMatch(/data-zc-import-backup="true"[^>]*disabled/)
    expect(markup).toMatch(/data-zc-reset-local="true"[^>]*disabled/)
    expect(markup).toMatch(/type="file"[^>]*aria-disabled="true"[^>]*disabled/)
  })

  it('renders message roles, attachments, statuses, and terminal actions', () => {
    const conversation = seedData([
      message('user', 'user', 'hello', {
        attachments: [
          {
            id: 'image',
            kind: 'image',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,AAAA',
            createdAt: 1,
          },
          {
            id: 'mask',
            kind: 'image',
            purpose: 'mask',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,AAAA',
            createdAt: 1,
          },
        ],
      }),
      message('queued', 'assistant', 'queued', { status: 'queued' }),
      message('streaming', 'assistant', '', { status: 'streaming' }),
      message('error', 'assistant', 'failed', {
        status: 'error',
        error: 'retry me',
      }),
      message('latest', 'assistant', 'latest answer'),
    ])

    const markup = renderToStaticMarkup(
      <MessageList
        conversation={conversation}
        streaming={false}
        onRegenerate={noOp}
        onRetry={noOp}
        onDelete={asyncTrue}
        onEdit={async () => true}
      />,
    )

    expect(markup).toContain('role="log"')
    expect(markup).toContain('data-message-id="user"')
    expect(markup).toContain('retry me')
    expect(markup).toContain('Download image')
    expect(markup).toContain('Regenerate')
    expect(markup).toContain('Retry')
  })

  it('does not render unsafe persisted image URLs into MessageList markup', () => {
    const conversation = seedData([
      message('unsafe', 'assistant', '', {
        attachments: [
          {
            id: 'private-image',
            kind: 'image',
            mimeType: 'image/png',
            url: 'https://127.0.0.1/private.png',
            createdAt: 1,
          },
          {
            id: 'control-image',
            kind: 'image',
            mimeType: 'image/png',
            url: '\nhttps://cdn.example/image.png',
            createdAt: 1,
          },
        ],
      }),
    ])

    const markup = renderToStaticMarkup(
      <MessageList
        conversation={conversation}
        streaming={false}
        onRegenerate={noOp}
        onRetry={noOp}
        onDelete={asyncTrue}
        onEdit={async () => true}
      />,
    )

    expect(markup).not.toContain('<img')
    expect(markup).not.toContain('127.0.0.1')
    expect(markup).not.toContain('cdn.example/image.png')
  })

  it('keeps provider or sync Markdown content inert in the MessageList caller', () => {
    const content = [
      '<svg onload="alert(1)"><script>alert(2)</script></svg>',
      '[bad](javascript:alert(3))',
    ].join('\n\n')
    const conversation = seedData([message('remote-markdown', 'assistant', content)])

    const markup = renderToStaticMarkup(
      <MessageList
        conversation={conversation}
        streaming={false}
        onRegenerate={noOp}
        onRetry={noOp}
        onDelete={asyncTrue}
        onEdit={async () => true}
      />,
    )

    expect(markup).not.toMatch(/<svg[^>]*\bonload=/iu)
    expect(markup).not.toMatch(/<script\b/iu)
    expect(markup).not.toContain('href="javascript:')
    expect(markup).toContain('&lt;svg onload=')
    expect(markup).toContain('[bad](javascript:alert(3))')
  })

  it('redacts persisted message errors before rendering them', () => {
    const sentinel =
      'C:\\private\\restored-error sk-live-1234567890 https://relay.example.test/v1/models'
    const conversation = seedData([
      message('error', 'assistant', 'failed', {
        status: 'error',
        error: sentinel,
      }),
    ])

    const markup = renderToStaticMarkup(
      <MessageList
        conversation={conversation}
        streaming={false}
        onRegenerate={noOp}
        onRetry={noOp}
        onDelete={asyncTrue}
        onEdit={async () => true}
      />,
    )

    expect(markup).not.toContain('C:\\private\\restored-error')
    expect(markup).not.toContain('sk-live-1234567890')
    expect(markup).not.toContain('https://relay.example.test/v1/models')
    expect(markup).toContain('[redacted-path]')
    expect(markup).toContain('[redacted]')
    expect(markup).toContain('[redacted-url]')
  })

  it.each([
    { activity: 'streaming', sending: false, streaming: true },
    { activity: 'sending', sending: true, streaming: false },
  ])(
    'keeps retry disabled but allows deletion while message generation is $activity',
    ({ sending, streaming }) => {
      const failed = message('failed-action', 'assistant', 'failed', {
        error: 'retry me',
        status: 'error',
      })
      const conversation = seedData([failed])
      useAppStore.setState({ sending })

      const listMarkup = renderToStaticMarkup(
        <MessageList
          conversation={conversation}
          streaming={streaming}
          onRegenerate={noOp}
          onRetry={noOp}
          onDelete={asyncTrue}
          onEdit={asyncTrue}
        />,
      )
      expect(
        markupHasTag(listMarkup, 'button', [/aria-label="Retry"/u, /disabled/u]),
      ).toBe(true)
      expect(
        markupHasTag(listMarkup, 'button', [/aria-label="Delete"/u, /disabled/u]),
      ).toBe(false)

      const labels: Record<string, string> = {
        'message.assistant': 'Assistant',
        'message.copy': 'Copy',
        'message.delete': 'Delete',
        'message.image': 'Image',
        'message.readAloud': 'Read aloud',
        'message.regenerate': 'Regenerate',
        'message.retry': 'Retry',
        'message.you': 'You',
      }
      const menuMarkup = renderToStaticMarkup(
        <MessageContextMenu
          conversationMutationPending={false}
          lastAssistant
          locale="en"
          menu={{ message: failed, messageId: failed.id, x: 10, y: 12 }}
          menuRef={{ current: null }}
          message={failed}
          sending={sending}
          speakingMessageId=""
          streaming={streaming}
          t={(key) => labels[key] ?? key}
          onClose={noOp}
          onCloseAndRestoreFocus={noOp}
          onCloseForAsyncAction={() => noOp}
          onCopyMessage={asyncNoOp}
          onDeleteMessage={asyncTrue}
          onDownloadAttachment={noOp}
          onKeyDown={noOp}
          onRegenerate={noOp}
          onRetry={noOp}
          onSpeakMessage={asyncNoOp}
          onStartEditingMessage={noOp}
        />,
      )
      expect(
        markupHasTag(menuMarkup, 'button', [
          /data-zc-message-context-regenerate="true"/u,
          /disabled/u,
        ]),
      ).toBe(true)
      expect(
        markupHasTag(menuMarkup, 'button', [
          /data-zc-message-context-delete="true"/u,
          /disabled/u,
        ]),
      ).toBe(false)
    },
  )

  it('renders a bounded virtualized window for long conversations', () => {
    const messages = Array.from({ length: 60 }, (_, index) =>
      message(
        `message-${index}`,
        index % 2 === 0 ? 'user' : 'assistant',
        `message ${index}`,
      ),
    )
    const conversation = seedData(messages)
    const markup = renderToStaticMarkup(
      <MessageList
        conversation={conversation}
        streaming={false}
        onRegenerate={noOp}
        onRetry={noOp}
        onDelete={asyncTrue}
        onEdit={async () => true}
      />,
    )

    expect(markup).toContain('data-message-virtual-spacer="top"')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('data-message-id="message-59"')
    expect(markup).not.toContain('data-message-id="message-0"')
  })

  it('renders the current message context menu with target message labels', () => {
    const currentMessage = message('context', 'user', 'copy this')
    const labels: Record<string, string> = {
      'message.you': 'You',
      'message.assistant': 'Assistant',
      'message.copy': 'Copy',
      'message.downloadImage': 'Download image',
      'message.image': 'Image',
      'message.edit': 'Edit',
      'message.retry': 'Retry',
      'message.regenerate': 'Regenerate',
      'message.delete': 'Delete',
      'message.readAloud': 'Read aloud',
      'message.stopReading': 'Stop reading',
    }
    const markup = renderToStaticMarkup(
      <MessageContextMenu
        conversationMutationPending={false}
        lastAssistant={false}
        locale="en"
        menu={{ message: currentMessage, messageId: currentMessage.id, x: 10, y: 12 }}
        menuRef={{ current: null }}
        message={currentMessage}
        sending={false}
        speakingMessageId=""
        streaming={false}
        t={(key) => labels[key] ?? key}
        onClose={noOp}
        onCloseAndRestoreFocus={noOp}
        onCloseForAsyncAction={() => noOp}
        onCopyMessage={async () => undefined}
        onDeleteMessage={asyncTrue}
        onDownloadAttachment={noOp}
        onKeyDown={noOp}
        onRegenerate={noOp}
        onRetry={noOp}
        onSpeakMessage={async () => undefined}
        onStartEditingMessage={noOp}
      />,
    )

    expect(markup).toContain('data-zc-message-context-menu="true"')
    expect(markup).toContain('role="menu"')
    expect(markup).toContain('data-zc-message-context-copy="true"')
    expect(markup).toContain('data-zc-message-context-edit="true"')
    expect(markup).toContain('data-zc-message-context-delete="true"')
    expect(markup).toContain('aria-label="Copy: You')
    expect(markup).toContain('aria-label="Edit: You')
    expect(markup).not.toContain('data-zc-message-context-speak="true"')

    const assistantMessage = message('assistant-context', 'assistant', 'read this')
    const assistantMarkup = renderToStaticMarkup(
      <MessageContextMenu
        conversationMutationPending={false}
        lastAssistant
        locale="en"
        menu={{ message: assistantMessage, messageId: assistantMessage.id, x: 10, y: 12 }}
        menuRef={{ current: null }}
        message={assistantMessage}
        sending={false}
        speakingMessageId=""
        streaming={false}
        t={(key) => labels[key] ?? key}
        onClose={noOp}
        onCloseAndRestoreFocus={noOp}
        onCloseForAsyncAction={() => noOp}
        onCopyMessage={async () => undefined}
        onDeleteMessage={asyncTrue}
        onDownloadAttachment={noOp}
        onKeyDown={noOp}
        onRegenerate={noOp}
        onRetry={noOp}
        onSpeakMessage={async () => undefined}
        onStartEditingMessage={noOp}
      />,
    )
    expect(assistantMarkup).toContain('data-zc-message-context-speak="true"')
    expect(assistantMarkup).toContain('data-zc-message-context-regenerate="true"')
    expect(assistantMarkup).toContain('Read aloud')
    expect(assistantMarkup).toContain('Regenerate')

    const speakingMarkup = renderToStaticMarkup(
      <MessageContextMenu
        conversationMutationPending
        lastAssistant
        locale="en"
        menu={{ message: assistantMessage, messageId: assistantMessage.id, x: 10, y: 12 }}
        menuRef={{ current: null }}
        message={assistantMessage}
        sending={false}
        speakingMessageId={assistantMessage.id}
        streaming={false}
        t={(key) => labels[key] ?? key}
        onClose={noOp}
        onCloseAndRestoreFocus={noOp}
        onCloseForAsyncAction={() => noOp}
        onCopyMessage={async () => undefined}
        onDeleteMessage={asyncTrue}
        onDownloadAttachment={noOp}
        onKeyDown={noOp}
        onRegenerate={noOp}
        onRetry={noOp}
        onSpeakMessage={async () => undefined}
        onStartEditingMessage={noOp}
      />,
    )
    expect(speakingMarkup).toContain('Stop reading')
    expect(
      markupHasTag(speakingMarkup, 'button', [
        /data-zc-message-context-speak="true"/u,
        /disabled/u,
      ]),
    ).toBe(false)

    const mutationPendingMarkup = renderToStaticMarkup(
      <MessageContextMenu
        conversationMutationPending
        lastAssistant
        locale="en"
        menu={{ message: assistantMessage, messageId: assistantMessage.id, x: 10, y: 12 }}
        menuRef={{ current: null }}
        message={assistantMessage}
        sending={false}
        speakingMessageId=""
        streaming={false}
        t={(key) => labels[key] ?? key}
        onClose={noOp}
        onCloseAndRestoreFocus={noOp}
        onCloseForAsyncAction={() => noOp}
        onCopyMessage={async () => undefined}
        onDeleteMessage={asyncTrue}
        onDownloadAttachment={noOp}
        onKeyDown={noOp}
        onRegenerate={noOp}
        onRetry={noOp}
        onSpeakMessage={async () => undefined}
        onStartEditingMessage={noOp}
      />,
    )
    expect(
      markupHasTag(mutationPendingMarkup, 'button', [
        /data-zc-message-context-speak="true"/u,
        /disabled/u,
      ]),
    ).toBe(true)
    expect(
      markupHasTag(mutationPendingMarkup, 'button', [
        /data-zc-message-context-regenerate="true"/u,
        /disabled/u,
      ]),
    ).toBe(true)
    expect(
      markupHasTag(mutationPendingMarkup, 'button', [
        /data-zc-message-context-copy="true"/u,
        /disabled/u,
      ]),
    ).toBe(false)
    expect(
      markupHasTag(mutationPendingMarkup, 'button', [
        /data-zc-message-context-delete="true"/u,
        /disabled/u,
      ]),
    ).toBe(true)
  })

  it('renders both onboarding branches with one Provider entry and no setup shortcuts', () => {
    const data = structuredClone(createDefaultData())
    data.preferences.language = 'en-US'
    data.preferences.firstRunDone = false
    data.conversations = []
    useAppStore.setState({ data, status: 'ready' })
    const firstRun = renderToStaticMarkup(
      <Onboarding onCreateNewConversation={noOp} onSkipOnboarding={noOp} />,
    )
    expect(firstRun).toContain('Welcome to ZeroChat')
    expect(firstRun).toContain('Set up later')
    expect(firstRun.match(/>Add provider<\/button>/g)).toHaveLength(1)
    expect(firstRun).toContain('data-zc-provider-settings-entry="true"')
    expect(firstRun).not.toContain('Base URL')
    expect(firstRun).not.toContain('Cloudflare')
    expect(firstRun).not.toContain('Worker')

    data.preferences.firstRunDone = true
    const returningUser = renderToStaticMarkup(
      <Onboarding onCreateNewConversation={noOp} onSkipOnboarding={noOp} />,
    )
    expect(returningUser).toContain('No chats')
    expect(returningUser).not.toContain('Skip for now')
  })

  it('renders a providerless stored snapshot as a recoverable empty state', () => {
    const data = structuredClone(createDefaultData())
    data.preferences.language = 'en-US'
    data.preferences.firstRunDone = true
    data.preferences.activeConversationId = undefined
    data.providers = []
    data.conversations = []
    useAppStore.setState({ data, status: 'ready' })

    const markup = renderToStaticMarkup(
      <Onboarding onCreateNewConversation={noOp} onSkipOnboarding={noOp} />,
    )
    expect(markup).toContain('provider-empty-state')
    expect(markup).toContain('No chats')
    expect(markup).toContain('Add provider')
    expect(markup).toContain('data-zc-provider-settings-entry="true"')
    expect(markup).not.toContain('Start chatting')
    expect(markup).not.toContain('Skip for now')
  })

  it('identifies the active chat and names repeated sidebar actions by title', () => {
    const conversation = seedData()
    conversation.title = 'Quarterly plan'

    const markup = renderToStaticMarkup(
      <Sidebar
        onCreateNewConversation={noOp}
        onSelectConversation={noOp}
      />,
    )

    expect(markup).toContain('aria-current="page"')
    expect(markup).toContain('aria-label="Delete chat: Quarterly plan"')
  })

  it('renders conversation actions inert while a durable mutation owns the shared gate', () => {
    seedData([
      message('pending-user', 'user', 'user draft'),
      message('pending-assistant', 'assistant', 'assistant reply'),
    ])
    const pendingData = useAppStore.getState().data
    if (pendingData) pendingData.preferences.firstRunDone = false
    useAppStore.setState({
      composerImages: [],
      composerMode: 'chat',
      conversationMutationPending: true,
      createNewConversation: asyncTrue,
      deleteConversation: asyncTrue,
      deleteMessage: asyncTrue,
      dismissFeatureHint: asyncTrue,
      editAndResendMessage: asyncTrue,
      imageTaskMode: 'generate',
      notify: noOp,
      openProviderSettings: noOp,
      regenerate: asyncNoOp,
      renameConversation: asyncTrue,
      retryMessage: asyncNoOp,
      sending: false,
      setActiveConversation: asyncTrue,
      setConversationModelChoice: asyncTrue,
      setSettingsOpen: noOp,
      setSidebarCollapsed: noOp,
      settingsOpen: false,
      sidebarCollapsed: false,
      skipOnboarding: asyncTrue,
      streaming: false,
      transcribingAudio: false,
    })

    const sidebar = renderToStaticMarkup(
      <Sidebar
        onCreateNewConversation={noOp}
        onSelectConversation={noOp}
      />,
    )
    const chat = renderToStaticMarkup(<ChatView />)
    const onboarding = renderToStaticMarkup(
      <Onboarding onCreateNewConversation={noOp} onSkipOnboarding={noOp} />,
    )

    expect(
      markupHasTag(sidebar, 'button', [/class="zc-new-chat"/u, /disabled/u]),
    ).toBe(true)
    expect(sidebar).toContain('aria-disabled="true"')
    expect(
      markupHasTag(sidebar, 'button', [
        /aria-label="Delete chat:[^"]+"/u,
        /disabled/u,
      ]),
    ).toBe(true)
    expect(
      markupHasTag(chat, 'select', [
        /class="zc-model-select"/u,
        /aria-busy="true"/u,
        /disabled/u,
      ]),
    ).toBe(true)
    expect(
      markupHasTag(chat, 'textarea', [
        /data-composer-autosize="true"/u,
        /disabled/u,
      ]),
    ).toBe(true)
    expect(
      markupHasTag(chat, 'button', [
        /class="zc-send-btn send-button"/u,
        /disabled/u,
      ]),
    ).toBe(true)
    expect(
      markupHasTag(chat, 'button', [/aria-label="Edit"/u, /disabled/u]),
    ).toBe(true)
    expect(
      markupHasTag(chat, 'button', [
        /aria-label="Regenerate"/u,
        /disabled/u,
      ]),
    ).toBe(true)
    expect(
      markupHasTag(chat, 'button', [/aria-label="Copy"/u, /disabled/u]),
    ).toBe(false)
    expect(
      markupHasTag(chat, 'button', [/aria-label="Delete"/u, /disabled/u]),
    ).toBe(true)
    expect(
      markupHasTag(onboarding, 'button', [
        /class="zc-btn primary"/u,
        /disabled/u,
      ]),
    ).toBe(true)
    expect(
      markupHasTag(onboarding, 'button', [
        /class="zc-btn"/u,
        /disabled/u,
      ]),
    ).toBe(true)
  })

  it('localizes stored default conversation titles in the Sidebar and chat header', async () => {
    const conversation = seedData()
    const data = useAppStore.getState()?.data as ReturnType<typeof createDefaultData>
    data.preferences.language = 'zh-CN'
    conversation.title = 'conversation.newTitle'
    await loadLocale('zh-CN')
    useAppStore.setState({
      composerMode: 'chat',
      composerImages: [],
      data,
      deleteMessage: asyncTrue,
      dismissFeatureHint: asyncTrue,
      editAndResendMessage: asyncTrue,
      imageTaskMode: 'generate',
      regenerate: asyncNoOp,
      renameConversation: asyncTrue,
      retryMessage: asyncNoOp,
      sending: false,
      setConversationModelChoice: asyncTrue,
      setSettingsOpen: noOp,
      setSidebarCollapsed: noOp,
      settingsOpen: false,
      sidebarCollapsed: false,
      streaming: false,
      transcribingAudio: false,
    })

    const markup = `${renderToStaticMarkup(<Sidebar onCreateNewConversation={noOp} onSelectConversation={noOp} />)}${renderToStaticMarkup(<ChatView />)}`
    const localizedTitle = translate('zh-CN', 'conversation.newTitle')

    expect(markup).toContain(localizedTitle)
    expect(markup).not.toContain('conversation.newTitle')
  })

  it('localizes a storage-created placeholder after the user changes locale', async () => {
    await loadLocale('en-US')
    setRuntimeLocale('en-US')
    const data = createDefaultData()
    data.preferences.language = 'zh-CN'
    data.preferences.firstRunDone = true
    data.preferences.activeConversationId = data.conversations[0].id
    await loadLocale('zh-CN')
    useAppStore.setState({
      composerMode: 'chat',
      composerImages: [],
      data,
      deleteMessage: asyncTrue,
      dismissFeatureHint: asyncTrue,
      editAndResendMessage: asyncTrue,
      imageTaskMode: 'generate',
      regenerate: asyncNoOp,
      renameConversation: asyncTrue,
      retryMessage: asyncNoOp,
      sending: false,
      setConversationModelChoice: asyncTrue,
      setSettingsOpen: noOp,
      setSidebarCollapsed: noOp,
      settingsOpen: false,
      sidebarCollapsed: false,
      streaming: false,
      transcribingAudio: false,
    })

    const markup = `${renderToStaticMarkup(<Sidebar onCreateNewConversation={noOp} onSelectConversation={noOp} />)}${renderToStaticMarkup(<ChatView />)}`

    expect(data.conversations[0].title).toBe('conversation.newTitle')
    expect(markup).toContain(translate('zh-CN', 'conversation.newTitle'))
  })

  it('isolates the app surface while the narrow Sidebar overlay is open', () => {
    const conversation = seedData()
    const data = useAppStore.getState()?.data as ReturnType<typeof createDefaultData>
    data.preferences.firstRunDone = false
    data.preferences.activeConversationId = conversation.id
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        addEventListener: noOp,
        matches: true,
        removeEventListener: noOp,
      })),
    )

    const openMarkup = renderToStaticMarkup(<App />)
    const openSurface = openMarkup.match(
      /<div[^>]*class="zc-app-surface"[^>]*>/u,
    )?.[0]
    expect(openSurface).toContain('aria-hidden="true"')
    expect(openSurface).toContain(' inert')

    useAppStore.setState({ sidebarCollapsed: true })
    const closedMarkup = renderToStaticMarkup(<App />)
    const closedSurface = closedMarkup.match(
      /<div[^>]*class="zc-app-surface"[^>]*>/u,
    )?.[0]
    expect(closedSurface).toBeDefined()
    expect(closedSurface).not.toContain('aria-hidden="true"')
    expect(closedSurface).not.toContain(' inert')
  })

  it('announces progress while the Settings chunk is loading', async () => {
    const data = createDefaultData()
    data.preferences.language = 'en-US'
    await loadLocale('en-US')
    setRuntimeLocale('en-US')
    const markup = renderToStaticMarkup(<SettingsLoadingFallback data={data} />)

    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain('Loading...')
  })

  it('keeps loading and failure shells reachable without exposing diagnostics', () => {
    useAppStore.setState({ status: 'loading', data: null })
    expect(renderToStaticMarkup(<App />)).toContain('ZeroChat')

    const failureData = createDefaultData()
    failureData.preferences.language = 'en-US'
    useAppStore.setState({
      status: 'error',
      data: failureData,
      loadError: 'load failed',
    })
    const failure = renderToStaticMarkup(<App />)
    expect(failure).toContain('Failed to load local data')
    expect(failure).toContain('Reload')
    expect(failure).not.toContain('load failed')
  })

  it('keeps descendant render recovery localized and assertive', () => {
    const boundary = new RuntimeBoundary({ children: null })
    boundary.state = { failed: true }

    const markup = renderToStaticMarkup(<>{boundary.render()}</>)
    const copy = runtimeFailureCopy()

    expect(markup).toContain('runtime-failure-state')
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('aria-live="assertive"')
    expect(markup).toContain(`<h1>${copy.title}</h1>`)
    expect(markup).toContain(`<p>${copy.description}</p>`)
    expect(markup).toContain(copy.reloadLabel)
    expect(markup).not.toContain('Error:')
  })

  it('localizes toast dismissal controls with the app locale', () => {
    const data = structuredClone(createDefaultData())
    data.preferences.language = 'zh-CN'
    useAppStore.setState({
      data,
      toasts: [{ id: 'toast', message: '已保存', tone: 'success' }],
    })

    const markup = renderToStaticMarkup(<Toasts />)

    expect(markup).toContain('关闭提示')
    expect(markup).not.toContain('aria-label="Dismiss"')
  })

  it('keeps shared credential inputs masked and exposes a named reveal control', () => {
    const markup = renderToStaticMarkup(
      <SecretInput
        value=""
        aria-describedby="credential-help"
        autoComplete="off"
        revealLabel="Show credential"
        hideLabel="Hide credential"
        onChange={() => undefined}
        onKeyDown={() => undefined}
      />,
    )

    expect(markup).toContain('type="password"')
    expect(markup).toContain('aria-describedby="credential-help"')
    expect(markup).toContain('autocomplete="off"')
    expect(markup).toContain('type="button"')
    expect(markup).toContain('aria-label="Show credential"')
    expect(markup).not.toContain('aria-label="Hide credential"')
  })
})
