import { createRoot } from 'react-dom/client'

import './app.css'
import { App } from './App'
import { RuntimeBoundary } from './components/RuntimeBoundary'
import { RuntimeFailureSmoke } from './components/RuntimeFailureSmoke'
import { installServiceWorkerRegistration } from '../services/serviceWorkerRegistration'
import { reportStartupRenderFailure } from '../services/startupFatalError'
import { saveAppData } from '../storage/db'
import { applyStartupShell } from './startupShell'
import {
  appTestBridgeRequested,
  runtimeFailureProbeRequested,
} from './runtimeFailureProbe'
import { appT, useAppStore } from './store'
import { applyTheme } from './theme'
import type { ProviderConfig, UserSkill } from '../types'

declare global {
  interface BrowserSmokeSyncDiagnostics {
    dataPasswordLength: number
    savedPassphrasePresent: boolean
    savedPassphraseLength: number
  }

  interface Window {
    __zerochatAppTest?: {
      closeSettings: () => void
      currentLocalDataWriteConflictMessage: () => string
      flushLocalSaves: () => Promise<void>
      resetAllFixture: () => Promise<void>
      setSyncingFixture: (syncing: boolean) => void
      setSyncConflictFixture: (syncConflict: boolean) => void
      prepareStreamingFixture: (
        syncEndpoint?: string,
        options?: { deferAutoSync?: boolean },
      ) => Promise<BrowserSmokeSyncDiagnostics>
      setProviderRetryFixtureEnabled: (enabled: boolean) => Promise<string>
      seedOnboardingSnapshot: () => Promise<void>
      seedProviderlessSnapshot: () => Promise<void>
      seedPerformanceConversation: () => Promise<void>
      appendPerformanceMessage: () => void
      seedLargeSkillLibrary: (count?: number) => Promise<void>
    }
  }
}

const browserSmokeProviderKey = 'browser-smoke-key'
const startupFailureSmokeSentinel = 'startup-failure-smoke-sentinel'
let browserSmokeProviderRetryOriginal: ProviderConfig | null = null

function testFailureRequested(name: string): boolean {
  return runtimeFailureProbeRequested(name, window.location)
}

async function prepareStreamingFixture(
  syncEndpoint = '',
  options: { deferAutoSync?: boolean } = {},
): Promise<BrowserSmokeSyncDiagnostics> {
  const state = useAppStore.getState()
  if (!state.data) {
    await state.init()
  }
  const current = useAppStore.getState()
  const data = current.data
  const provider = data?.providers[0]
  if (!data || !provider) {
    throw new Error('app streaming fixture requires a provider')
  }
  if (syncEndpoint.trim()) {
    // Credential setup itself can queue auto-sync. Keep fixture preparation
    // side-effect free until the final synced Cloudflare snapshot is ready.
    useAppStore.setState({
      data: {
        ...data,
        sync: { ...data.sync, autoSync: false },
      },
    })
  }
  await current.saveProviderKey(provider.id, browserSmokeProviderKey)
  await useAppStore.getState().skipOnboarding()
  if (syncEndpoint.trim()) {
    await useAppStore.getState().setSyncPassphrase('browser-smoke-passphrase')
    // Configure the browser fixture before installing its fetch interceptor;
    // the public settings actions intentionally schedule an automatic sync.
    // Starting that request here would race the fixture and look like a
    // duplicate terminal publish.
    const configured = useAppStore.getState().data
    if (configured) {
      useAppStore.setState({
        data: {
          ...configured,
          sync: {
            ...configured.sync,
            autoSync: !options.deferAutoSync,
            encryptionEnabled: true,
            mode: 'cloudflare',
            workerEndpoint: syncEndpoint,
            lastSyncAt: configured.updatedAt,
          },
        },
      })
    }
  }
  await useAppStore.getState().flushLocalSaves()
  const prepared = useAppStore.getState()
  return {
    dataPasswordLength: 0,
    savedPassphrasePresent: prepared.syncPassphrase.length > 0,
    savedPassphraseLength: prepared.syncPassphrase.length,
  }
}

async function setProviderRetryFixtureEnabled(enabled: boolean): Promise<string> {
  const store = useAppStore.getState()
  if (!store.data) {
    await store.init()
  }
  const current = useAppStore.getState()
  const data = current.data
  const provider = data?.providers[0]
  if (!data || !provider) {
    throw new Error('app Provider retry fixture requires a provider')
  }
  if (enabled) {
    browserSmokeProviderRetryOriginal = structuredClone(provider)
    useAppStore.setState({
      data: {
        ...data,
        providers: data.providers.map((candidate) =>
          candidate.id === provider.id
            ? {
                ...candidate,
                capabilities: ['embeddings', 'moderation'],
                embeddingModel:
                  candidate.embeddingModel?.trim() || 'text-embedding-3-small',
                models: [
                  candidate.embeddingModel?.trim() || 'text-embedding-3-small',
                  candidate.moderationModel?.trim() || 'omni-moderation-latest',
                ],
                moderationModel:
                  candidate.moderationModel?.trim() || 'omni-moderation-latest',
              }
            : candidate,
        ),
      },
    })
  }
  await current.saveProviderKey(provider.id, enabled ? browserSmokeProviderKey : '')
  if (!enabled) {
    const latest = useAppStore.getState().data
    const original = browserSmokeProviderRetryOriginal
    useAppStore.setState({
      data:
        latest && original
          ? {
              ...latest,
              providers: latest.providers.map((candidate) =>
                candidate.id === original.id ? original : candidate,
              ),
            }
          : latest,
      providerConnectivityResults: {},
    })
    browserSmokeProviderRetryOriginal = null
  }
  return provider.id
}

async function seedPerformanceConversation(): Promise<void> {
  const store = useAppStore.getState()
  if (!store.data) {
    await store.init()
  }
  const data = useAppStore.getState().data
  if (!data) {
    throw new Error('app data is not ready')
  }
  await useAppStore.getState().flushLocalSaves()
  const provider = data.providers[0]
  if (!provider) {
    throw new Error('app performance seed requires a provider')
  }
  const timestamp = Date.now()
  const messages = Array.from({ length: 300 }, (_, index) => ({
    id: `perf-${index}`,
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content:
      index === 299
        ? [
            '# Markdown 安全边界',
            '',
            '- Browser list item',
            '',
            '| Contract | Result |',
            '| --- | --- |',
            '| Markdown table | table-ok |',
            '',
            '[Browser external link](https://example.com/guide)',
            '',
            '<script>window.__markdownRawHtmlExecuted = true</script>',
            '',
            '[Blocked custom link](intent://open/settings)',
            '',
            '![remote image](https://remote.invalid/should-not-load.png)',
            '',
            '```tsx',
            'const value: number = 42',
            'const view = <Button>{value}</Button>',
            '```',
          ].join('\n')
        : `性能测试消息 ${index}：这是一段用于填充长列表的消息内容，` +
          '包含足够文本来模拟真实气泡高度。\n\n' +
          '第二段落保证每条消息都有多行渲染成本。',
    createdAt: timestamp - (300 - index) * 60_000,
    status: 'done' as const,
  }))
  await saveAppData({
    ...data,
    conversations: [
      {
        id: 'perf-conv',
        title: 'perf',
        providerId: provider.id,
        model: provider.model,
        messages,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      ...data.conversations,
    ],
    preferences: {
      ...data.preferences,
      firstRunDone: true,
      activeConversationId: 'perf-conv',
    },
  })
}

function appendPerformanceMessage(): void {
  const data = useAppStore.getState().data
  const activeConversationId = data?.preferences.activeConversationId
  const activeConversation = data?.conversations.find(
    (conversation) => conversation.id === activeConversationId,
  )
  if (!data || !activeConversation || activeConversation.id !== 'perf-conv') {
    throw new Error('app performance message fixture requires the active performance conversation')
  }

  const timestamp = Date.now()
  useAppStore.setState({
    data: {
      ...data,
      conversations: data.conversations.map((conversation) =>
        conversation.id === activeConversation.id
          ? {
              ...conversation,
              messages: [
                ...conversation.messages,
                {
                  id: `perf-incoming-${timestamp}`,
                  role: 'assistant',
                  content: 'Incoming performance fixture message',
                  createdAt: timestamp,
                  status: 'done',
                },
              ],
              updatedAt: timestamp,
            }
          : conversation,
      ),
      updatedAt: timestamp,
    },
  })
}

async function seedProviderlessSnapshot(): Promise<void> {
  const store = useAppStore.getState()
  if (!store.data) {
    await store.init()
  }
  const data = useAppStore.getState().data
  if (!data) {
    throw new Error('app providerless fixture requires loaded data')
  }
  await useAppStore.getState().flushLocalSaves()
  await saveAppData({
    ...data,
    providers: [],
    conversations: [],
    preferences: {
      ...data.preferences,
      firstRunDone: true,
      activeConversationId: undefined,
    },
  })
}

async function seedOnboardingSnapshot(): Promise<void> {
  const store = useAppStore.getState()
  if (!store.data) {
    await store.init()
  }
  const data = useAppStore.getState().data
  const activeConversationId =
    data?.preferences.activeConversationId ?? data?.conversations[0]?.id
  if (!data || !activeConversationId) {
    throw new Error('app onboarding fixture requires a conversation')
  }
  await useAppStore.getState().flushLocalSaves()
  await saveAppData({
    ...data,
    preferences: {
      ...data.preferences,
      firstRunDone: false,
      activeConversationId,
    },
  })
}

async function seedLargeSkillLibrary(count = 241): Promise<void> {
  if (!Number.isInteger(count) || count < 1 || count > 500) {
    throw new Error('app large Skill fixture count must be between 1 and 500')
  }
  const store = useAppStore.getState()
  if (!store.data) {
    await store.init()
  }
  const data = useAppStore.getState().data
  if (!data) {
    throw new Error('app large Skill fixture requires loaded data')
  }
  await useAppStore.getState().flushLocalSaves()
  const timestamp = Date.now()
  const skills: UserSkill[] = Array.from({ length: count }, (_, index) => {
    const ordinal = index + 1
    const name = `Visual Skill ${String(ordinal).padStart(3, '0')}`
    const content = `${name} keeps large-library rendering deterministic.`
    return {
      id: `visual-skill-${ordinal}`,
      name,
      description: content,
      fileName: `visual-skill-${ordinal}.md`,
      contentType: 'markdown',
      sourceSize: content.length,
      contentHash: ordinal.toString(16).padStart(64, '0'),
      keywords: ['visual', 'skill'],
      chunks: [
        {
          id: `visual-skill-${ordinal}-chunk`,
          heading: name,
          content,
          keywords: ['visual', 'skill'],
          tokenEstimate: 12,
        },
      ],
      fixed: false,
      enabled: ordinal % 3 !== 0,
      autoMatch: ordinal % 2 === 0,
      createdAt: timestamp - (count - ordinal),
      updatedAt: timestamp - (count - ordinal),
    }
  })
  const nextData = { ...data, skills }
  await saveAppData(nextData)
  useAppStore.setState({ data: nextData })
}

function installTestBridge(): void {
  if (!appTestBridgeRequested(window.location)) return
  window.__zerochatAppTest = {
    closeSettings: () => useAppStore.getState().setSettingsOpen(false),
    currentLocalDataWriteConflictMessage: () =>
      appT(useAppStore.getState().data, 'error.localDataWriteConflict'),
    flushLocalSaves: () => useAppStore.getState().flushLocalSaves(),
    resetAllFixture: () => useAppStore.getState().resetAll(),
    setSyncingFixture: (syncing) => useAppStore.setState({ syncing }),
    setSyncConflictFixture: (syncConflict) =>
      useAppStore.setState({ syncConflict }),
    prepareStreamingFixture,
    setProviderRetryFixtureEnabled,
    seedOnboardingSnapshot,
    seedProviderlessSnapshot,
    seedPerformanceConversation,
    appendPerformanceMessage,
    seedLargeSkillLibrary,
  }
}

function bootstrap(): void {
  applyStartupShell()
  if (testFailureRequested('zerochat-startup-failure-smoke')) {
    throw new Error(startupFailureSmokeSentinel)
  }

  // Apply the persisted theme before first paint to avoid a flash.
  applyTheme(useAppStore.getState().data?.preferences.theme ?? 'system')

  // The saved preference only exists after init(); sync it once data is ready.
  const syncSavedLocale = () => {
    const localeTag =
      useAppStore.getState().data?.preferences.language ?? 'system'
    if (localeTag !== 'system') {
      document.documentElement.lang = localeTag
      document.documentElement.dir = localeTag === 'ar-SA' ? 'rtl' : 'ltr'
    }
  }
  let subscriptionActive = true
  let unsubscribe: (() => void) | null = null
  const releaseSubscription = () => {
    if (!subscriptionActive) return
    subscriptionActive = false
    unsubscribe?.()
    unsubscribe = null
  }

  unsubscribe = useAppStore.subscribe((state, prev) => {
    if (state.status === 'ready' && prev.status !== 'ready') {
      releaseSubscription()
      syncSavedLocale()
    }
  })

  try {
    const container = document.getElementById('root')
    if (!container) {
      throw new Error('[app] #root element missing')
    }

    createRoot(container).render(
      <RuntimeBoundary>
        {testFailureRequested('zerochat-runtime-failure-smoke') ? (
          <RuntimeFailureSmoke />
        ) : (
          <App />
        )}
      </RuntimeBoundary>,
    )
    installTestBridge()
  } catch (error) {
    releaseSubscription()
    throw error
  }
}

try {
  bootstrap()
} catch (error) {
  reportStartupRenderFailure(error)
}

installServiceWorkerRegistration()
