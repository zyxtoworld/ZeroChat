import {
  Bot,
  Check,
  Cloud,
  Download,
  GitBranch,
  HardDrive,
  KeyRound,
  Menu,
  MessageSquarePlus,
  Pencil,
  RefreshCw,
  RotateCcw,
  Send,
  Settings,
  Square,
  Trash2,
  Upload,
  User,
  X,
} from 'lucide-react'
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { providerFromPreset, providerPresets } from './data/presets'
import { listProviderModels, streamChat } from './services/chat'
import { decryptVault, encryptVault, isEncryptedSnapshot } from './services/crypto'
import {
  pruneProviderSecrets,
  sanitizeRemoteOnlyAppData,
} from './services/providerSafety'
import { performSync, pullRemoteChanges } from './services/sync'
import {
  clearAppData,
  createConversation,
  createDefaultData,
  loadAppData,
  saveAppData,
} from './storage/db'
import {
  clearZeroChatSecrets,
  clearProviderSecrets,
  clearProviderSecretsById,
  getSyncPassphrase,
  loadZeroChatSecrets,
  setGithubToken,
  setProviderKey,
  setProviderProxyToken,
  setSyncPassphrase,
  setWorkerToken,
} from './storage/secrets'
import type {
  AppData,
  ChatMessage,
  Conversation,
  DangerWarningId,
  ProviderConfig,
  SyncMode,
  ThemeMode,
} from './types'

type SettingsTab = 'providers' | 'sync' | 'data'

interface DangerPrompt {
  id: DangerWarningId
  title: string
  body: string
  details: string[]
  confirmLabel: string
}

const AUTO_SYNC_DEBOUNCE_MS = 1200
const REMOTE_PULL_INTERVAL_MS = 20_000

interface RunSyncOptions {
  silent?: boolean
  pullOnly?: boolean
}

interface PendingSyncRun {
  snapshot: AppData
  options: RunSyncOptions
}

function now(): number {
  return Date.now()
}

function cleanTitle(text: string): string {
  const title = text.replace(/\s+/g, ' ').trim()
  return title.length > 28 ? `${title.slice(0, 28)}...` : title || '新对话'
}

function preferredProviderId(data: AppData): string {
  const active =
    data.conversations.find(
      (conversation) =>
        conversation.id === data.preferences.activeConversationId,
    ) ?? data.conversations[0]

  return active?.providerId ?? data.providers[0]?.id ?? ''
}

function presetIdForProvider(provider: ProviderConfig): string {
  const exact = providerPresets.find(
    (preset) =>
      preset.kind === provider.kind &&
      preset.name === provider.name &&
      preset.baseUrl === provider.baseUrl,
  )

  if (exact) {
    return exact.id
  }

  if (provider.kind === 'anthropic') {
    return 'custom-anthropic-relay'
  }

  if (provider.kind === 'openai-responses') {
    return 'custom-responses-relay'
  }

  return 'custom-openai-relay'
}

function providerKindLabel(kind: ProviderConfig['kind']): string {
  if (kind === 'anthropic') {
    return 'Anthropic'
  }

  if (kind === 'openai-responses') {
    return 'OpenAI Responses'
  }

  return 'OpenAI 兼容'
}

function presetById(presetId: string) {
  return (
    providerPresets.find((item) => item.id === presetId) ?? providerPresets[0]
  )
}

function presetProviderPatch(
  preset: (typeof providerPresets)[number],
): Partial<ProviderConfig> {
  return {
    name: preset.name,
    kind: preset.kind,
    baseUrl: preset.baseUrl,
    model: preset.model,
    needsApiKey: preset.needsApiKey,
  }
}

function timeLabel(value?: number): string {
  if (!value) {
    return '尚未同步'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

function bump(data: AppData): AppData {
  return {
    ...data,
    updatedAt: now(),
  }
}

function updateConversation(
  data: AppData,
  conversationId: string,
  updater: (conversation: Conversation) => Conversation,
): AppData {
  return bump({
    ...data,
    conversations: data.conversations.map((conversation) =>
      conversation.id === conversationId
        ? { ...updater(conversation), updatedAt: now() }
        : conversation,
    ),
  })
}

function assistantMessageClass(message: ChatMessage): string {
  return ['message', message.role, message.status === 'error' ? 'error' : '']
    .filter(Boolean)
    .join(' ')
}

function hasStreamingMessage(data: AppData): boolean {
  return data.conversations.some((conversation) =>
    conversation.messages.some((message) => message.status === 'streaming'),
  )
}

function mergeSyncIdentifiers(current: AppData, synced: AppData): AppData {
  const sameMode = current.sync.mode === synced.sync.mode

  return {
    ...current,
    sync: {
      ...current.sync,
      encryptionEnabled: true,
      gistId: sameMode
        ? synced.sync.gistId ?? current.sync.gistId
        : current.sync.gistId,
      gistFile: sameMode
        ? synced.sync.gistFile ?? current.sync.gistFile
        : current.sync.gistFile,
      workerEndpoint: sameMode
        ? synced.sync.workerEndpoint ?? current.sync.workerEndpoint
        : current.sync.workerEndpoint,
    },
  }
}

function App() {
  const [data, setData] = useState<AppData | null>(null)
  const [draft, setDraft] = useState('')
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({})
  const [providerProxyTokens, setProviderProxyTokens] = useState<Record<string, string>>({})
  const [githubTokenValue, setGithubTokenValue] = useState('')
  const [workerTokenValue, setWorkerTokenValue] = useState('')
  const [syncPassphraseValue, setSyncPassphraseValue] = useState('')
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [selectedPresetId, setSelectedPresetId] = useState(providerPresets[0].id)
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({})
  const [loadingModelsProviderId, setLoadingModelsProviderId] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('providers')
  const [guideOpen, setGuideOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [editingMessageId, setEditingMessageId] = useState('')
  const [editingContent, setEditingContent] = useState('')
  const [dangerPrompt, setDangerPrompt] = useState<DangerPrompt | null>(null)
  const [dangerSkipChecked, setDangerSkipChecked] = useState(false)
  const [sending, setSending] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [notice, setNotice] = useState('')
  const [loadError, setLoadError] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const dataRef = useRef<AppData | null>(null)
  const providerKeysRef = useRef<Record<string, string>>({})
  const providerProxyTokensRef = useRef<Record<string, string>>({})
  const githubTokenRef = useRef('')
  const workerTokenRef = useRef('')
  const syncPassphraseRef = useRef('')
  const syncTimerRef = useRef<number | null>(null)
  const syncingRef = useRef(false)
  const pendingSyncRef = useRef<PendingSyncRun | null>(null)
  const modelLoadProviderIdRef = useRef('')
  const dangerResolverRef = useRef<((confirmed: boolean) => void) | null>(null)

  useEffect(() => {
    let mounted = true

    async function hydrate(): Promise<void> {
      const stored = await loadAppData()
      const sanitized = sanitizeRemoteOnlyAppData(stored ?? createDefaultData())
      const initial = sanitized.data

      if (sanitized.changed) {
        await Promise.all([
          saveAppData(initial),
          clearProviderSecretsById(sanitized.removedProviderIds),
        ])
      }

      const secrets = await loadZeroChatSecrets(
        initial.providers.map((provider) => provider.id),
      )

      if (mounted) {
        const syncPassphrase = getSyncPassphrase()
        providerKeysRef.current = secrets.providerKeys
        providerProxyTokensRef.current = secrets.providerProxyTokens
        githubTokenRef.current = secrets.githubToken
        workerTokenRef.current = secrets.workerToken
        syncPassphraseRef.current = syncPassphrase
        dataRef.current = initial
        setData(initial)
        setSelectedProviderId(preferredProviderId(initial))
        setProviderKeys(secrets.providerKeys)
        setProviderProxyTokens(secrets.providerProxyTokens)
        setGithubTokenValue(secrets.githubToken)
        setWorkerTokenValue(secrets.workerToken)
        setSyncPassphraseValue(syncPassphrase)
      }
    }

    hydrate().catch((error: unknown) => {
      if (!mounted) {
        return
      }

      setLoadError(error instanceof Error ? error.message : String(error))
    })

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    dataRef.current = data
  }, [data])

  useEffect(() => {
    providerKeysRef.current = providerKeys
  }, [providerKeys])

  useEffect(() => {
    providerProxyTokensRef.current = providerProxyTokens
  }, [providerProxyTokens])

  useEffect(() => {
    githubTokenRef.current = githubTokenValue
  }, [githubTokenValue])

  useEffect(() => {
    workerTokenRef.current = workerTokenValue
  }, [workerTokenValue])

  useEffect(() => {
    syncPassphraseRef.current = syncPassphraseValue
  }, [syncPassphraseValue])

  useEffect(() => {
    return () => {
      if (syncTimerRef.current !== null) {
        window.clearTimeout(syncTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!data) {
      return
    }

    document.documentElement.dataset.theme = data.preferences.theme
    document.documentElement.dataset.compact = String(
      data.preferences.compactMode,
    )
  }, [data])

  useEffect(() => {
    if (!data) {
      return
    }

    const handle = window.setTimeout(() => {
      saveAppData(data).catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : String(error))
      })
    }, 250)

    return () => window.clearTimeout(handle)
  }, [data])

  useEffect(() => {
    if (!data) {
      return
    }

    if (hasStreamingMessage(data)) {
      clearScheduledSync()
      return
    }

    scheduleAutoSync(data)
    // Sync helpers read current credentials and data through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, githubTokenValue, syncPassphraseValue, workerTokenValue])

  useEffect(() => {
    if (!data || !canPullRemote(data)) {
      return
    }

    let disposed = false
    const pullLatest = (): void => {
      if (disposed) {
        return
      }

      const snapshot = dataRef.current

      if (!snapshot || !canPullRemote(snapshot)) {
        return
      }

      if (hasUnsyncedLocalChanges(snapshot)) {
        scheduleAutoSync(snapshot)
        return
      }

      void runSync(snapshot, {
        pullOnly: true,
        silent: true,
      })
    }
    const pullWhenVisible = (): void => {
      if (document.visibilityState === 'visible') {
        pullLatest()
      }
    }
    const startupHandle = window.setTimeout(pullLatest, 600)
    const intervalHandle = window.setInterval(
      pullWhenVisible,
      REMOTE_PULL_INTERVAL_MS,
    )

    window.addEventListener('focus', pullLatest)
    window.addEventListener('online', pullLatest)
    document.addEventListener('visibilitychange', pullWhenVisible)

    return () => {
      disposed = true
      window.clearTimeout(startupHandle)
      window.clearInterval(intervalHandle)
      window.removeEventListener('focus', pullLatest)
      window.removeEventListener('online', pullLatest)
      document.removeEventListener('visibilitychange', pullWhenVisible)
    }
    // Remote pull should only restart when sync configuration changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    data?.sync.autoSync,
    data?.sync.gistId,
    data?.sync.mode,
    data?.sync.workerEndpoint,
    githubTokenValue,
    syncPassphraseValue,
    workerTokenValue,
  ])

  const activeConversation = useMemo(() => {
    if (!data) {
      return null
    }

    return (
      data.conversations.find(
        (conversation) =>
          conversation.id === data.preferences.activeConversationId,
      ) ?? data.conversations[0]
    )
  }, [data])

  const activeProvider = useMemo(() => {
    if (!data || !activeConversation) {
      return null
    }

    return (
      data.providers.find(
        (provider) => provider.id === activeConversation.providerId,
      ) ?? data.providers[0]
    )
  }, [activeConversation, data])

  const selectedProvider = useMemo(() => {
    if (!data) {
      return null
    }

    return (
      data.providers.find((provider) => provider.id === selectedProviderId) ??
      data.providers[0]
    )
  }, [data, selectedProviderId])

  const guideVisible = Boolean(
    data && (!data.preferences.firstRunDone || guideOpen),
  )
  const activeProviderModels = activeProvider
    ? providerModels[activeProvider.id] ?? []
    : []
  const activeModel =
    activeConversation && activeProvider
      ? activeConversation.model || activeProvider.model
      : ''
  const selectedProviderModels = selectedProvider
    ? providerModels[selectedProvider.id] ?? []
    : []
  const selectedProviderKey = selectedProvider
    ? providerKeys[selectedProvider.id] ?? ''
    : ''
  const guideMissingBaseUrl = Boolean(
    selectedProvider && !selectedProvider.baseUrl.trim(),
  )
  const guideMissingModel = Boolean(
    selectedProvider && !selectedProvider.model.trim(),
  )
  const guideMissingKey = Boolean(
    selectedProvider?.needsApiKey && !selectedProviderKey.trim(),
  )
  const guideCanFinish = Boolean(
    selectedProvider &&
      !guideMissingBaseUrl &&
      !guideMissingModel &&
      !guideMissingKey,
  )
  const guideRequirement = guideMissingBaseUrl
    ? '填写 HTTPS Base URL 后即可继续；自定义中转也必须是远程地址。'
    : guideMissingModel
      ? selectedProvider?.needsApiKey
        ? '填写默认模型和服务商密钥后即可使用；只想先看界面可以跳过。'
        : '填写默认模型后即可使用；只想先看界面可以跳过。'
      : guideMissingKey
        ? '填写服务商密钥后即可使用；只想先看界面可以跳过。'
        : ''

  function updateData(updater: (current: AppData) => AppData): AppData | null {
    const current = dataRef.current

    if (!current) {
      return null
    }

    const next = updater(current)
    dataRef.current = next
    setData(next)
    return next
  }

  function reportSecretWrite(promise: Promise<void>): void {
    void promise.catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : String(error))
    })
  }

  function setActiveConversation(conversationId: string): void {
    updateData((current) =>
      bump({
        ...current,
        preferences: {
          ...current.preferences,
          activeConversationId: conversationId,
        },
      }),
    )
    setSidebarOpen(false)
  }

  function createNewConversation(): void {
    if (!data) {
      return
    }

    const provider = data.providers[0]
    const conversation = createConversation(provider.id, provider.model)

    updateData((current) =>
      bump({
        ...current,
        conversations: [conversation, ...current.conversations],
        preferences: {
          ...current.preferences,
          activeConversationId: conversation.id,
        },
      }),
    )
    setSidebarOpen(false)
  }

  async function deleteConversation(conversationId: string): Promise<void> {
    const current = dataRef.current

    if (!current) {
      return
    }

    if (sending) {
      setNotice('请先停止或等待当前生成完成，再删除对话')
      return
    }

    const target = current.conversations.find(
      (conversation) => conversation.id === conversationId,
    )

    if (!target) {
      return
    }

    const confirmed = await requestDangerConfirmation({
      id: 'delete-conversation',
      title: '删除整个对话',
      body: `将永久删除「${target.title}」这整个对话。`,
      details: [
        '如果已开启即时自动同步，云端加密数据也会同步删除这个对话。',
        '同步完成后，其他设备会看不到这段记录。',
        '这个操作不能从 ZeroChat 内恢复，只能依赖你之前导出的加密备份。',
      ],
      confirmLabel: '删除对话',
    })

    if (!confirmed) {
      return
    }

    const remaining = current.conversations.filter(
      (conversation) => conversation.id !== conversationId,
    )
    const fallbackProvider = current.providers[0]
    const nextConversations =
      remaining.length > 0
        ? remaining
        : [createConversation(fallbackProvider.id, fallbackProvider.model)]
    const nextActive = nextConversations[0].id

    const saved = updateData((current) =>
      bump({
        ...current,
        conversations: nextConversations,
        preferences: {
          ...current.preferences,
          activeConversationId: nextActive,
        },
      }),
    )

    if (saved) {
      scheduleAutoSync(saved, 0, { allowStreaming: true })
    }
  }

  function updateProvider(providerId: string, patch: Partial<ProviderConfig>): void {
    updateData((current) =>
      bump({
        ...current,
        providers: current.providers.map((provider) =>
          provider.id === providerId
            ? { ...provider, ...patch, updatedAt: now() }
            : provider,
        ),
      }),
    )
  }

  function addProviderFromPresetId(presetId: string): ProviderConfig {
    const preset = presetById(presetId)
    const provider = providerFromPreset(preset)

    updateData((current) =>
      bump({
        ...current,
        providers: [...current.providers, provider],
      }),
    )
    setSelectedProviderId(provider.id)
    return provider
  }

  function addProviderFromPresetSelect(presetId: string): void {
    if (!presetId) {
      return
    }

    addProviderFromPresetId(presetId)
  }

  function applyGuidePreset(presetId: string): void {
    const preset = presetById(presetId)
    const current = dataRef.current

    setSelectedPresetId(preset.id)

    const existing = current?.providers.find(
      (provider) =>
        provider.kind === preset.kind &&
        provider.name === preset.name &&
        provider.baseUrl === preset.baseUrl,
    )

    if (existing) {
      setSelectedProviderId(existing.id)

      if (!existing.model.trim() && preset.model) {
        updateProvider(existing.id, { model: preset.model })
      }

      return
    }

    if (
      selectedProviderId &&
      current?.providers.some((provider) => provider.id === selectedProviderId)
    ) {
      updateProvider(selectedProviderId, presetProviderPatch(preset))
      return
    }

    addProviderFromPresetId(preset.id)
  }

  async function removeProvider(providerId: string): Promise<void> {
    const currentData = dataRef.current

    if (!currentData || currentData.providers.length <= 1) {
      setNotice('至少保留一个服务商')
      return
    }

    const target = currentData.providers.find((provider) => provider.id === providerId)
    const fallback = currentData.providers.find(
      (provider) => provider.id !== providerId,
    )

    if (!target || !fallback) {
      return
    }

    const confirmed = await requestDangerConfirmation({
      id: 'delete-provider',
      title: '删除服务商配置',
      body: `将删除「${target.name}」的服务商配置和本机服务商密钥。`,
      details: [
        '如果已开启即时自动同步，云端加密数据里对应的服务商配置和密钥也会被删除。',
        `使用这个服务商的对话会改用「${fallback.name}」。`,
        '删除后需要重新添加服务商并输入密钥才能恢复发送能力。',
      ],
      confirmLabel: '删除服务商',
    })

    if (!confirmed) {
      return
    }

    const saved = updateData((current) =>
      bump({
        ...current,
        providers: current.providers.filter(
          (provider) => provider.id !== providerId,
        ),
        conversations: current.conversations.map((conversation) =>
          conversation.providerId === providerId
            ? {
                ...conversation,
                providerId: fallback.id,
                model: fallback.model,
                updatedAt: now(),
              }
            : conversation,
        ),
      }),
    )
    setProviderKeys((current) => {
      const next = { ...current }
      delete next[providerId]
      providerKeysRef.current = next
      return next
    })
    setProviderProxyTokens((current) => {
      const next = { ...current }
      delete next[providerId]
      providerProxyTokensRef.current = next
      return next
    })
    setSelectedProviderId(fallback.id)

    if (saved) {
      scheduleAutoSync(saved, 0, { allowStreaming: true })
    }
  }

  function updateProviderKey(providerId: string, value: string): void {
    setProviderKeys((current) => ({
      ...current,
      [providerId]: value,
    }))
    providerKeysRef.current = {
      ...providerKeysRef.current,
      [providerId]: value,
    }
    reportSecretWrite(setProviderKey(providerId, value))
    updateData((current) => bump(current))
  }

  function updateProviderProxyToken(providerId: string, value: string): void {
    setProviderProxyTokens((current) => ({
      ...current,
      [providerId]: value,
    }))
    providerProxyTokensRef.current = {
      ...providerProxyTokensRef.current,
      [providerId]: value,
    }
    reportSecretWrite(setProviderProxyToken(providerId, value))
    updateData((current) => bump(current))
  }

  async function refreshProviderModels(
    providerId: string,
    options: { useAsConversationModel?: boolean; useAsProviderModel?: boolean } = {},
  ): Promise<void> {
    if (modelLoadProviderIdRef.current) {
      return
    }

    const provider = dataRef.current?.providers.find((item) => item.id === providerId)

    if (!provider) {
      return
    }

    modelLoadProviderIdRef.current = providerId
    setLoadingModelsProviderId(providerId)
    setNotice('')

    try {
      const models = await listProviderModels({
        provider,
        apiKey: providerKeysRef.current[providerId] ?? '',
        proxyToken:
          providerProxyTokensRef.current[providerId] ?? workerTokenRef.current,
      })
      setProviderModels((current) => ({
        ...current,
        [providerId]: models,
      }))
      setNotice(`已获取 ${models.length} 个模型`)

      const firstModel = models[0]

      if (!firstModel) {
        return
      }

      if (options.useAsProviderModel && !provider.model.trim()) {
        updateProvider(providerId, { model: firstModel })
      }

      const currentConversation = dataRef.current?.conversations.find(
        (conversation) =>
          conversation.id === dataRef.current?.preferences.activeConversationId,
      )

      if (
        options.useAsConversationModel &&
        currentConversation?.providerId === providerId &&
        !currentConversation.model.trim()
      ) {
        updateConversationModel(firstModel)
      }
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      modelLoadProviderIdRef.current = ''
      setLoadingModelsProviderId('')
    }
  }

  async function applySyncedSecrets(
    keys: Record<string, string>,
    proxyTokens: Record<string, string>,
  ): Promise<void> {
    await clearProviderSecrets()
    setProviderKeys(keys)
    setProviderProxyTokens(proxyTokens)
    providerKeysRef.current = keys
    providerProxyTokensRef.current = proxyTokens

    await Promise.all([
      ...Object.entries(keys).map(([providerId, value]) =>
        setProviderKey(providerId, value),
      ),
      ...Object.entries(proxyTokens).map(([providerId, value]) =>
        setProviderProxyToken(providerId, value),
      ),
    ])
  }

  function hasDismissedDangerWarning(id: DangerWarningId): boolean {
    return Boolean(
      dataRef.current?.preferences.dismissedDangerWarnings?.includes(id),
    )
  }

  function dismissDangerWarning(id: DangerWarningId): void {
    updateData((current) => {
      const dismissed = current.preferences.dismissedDangerWarnings ?? []

      if (dismissed.includes(id)) {
        return current
      }

      return bump({
        ...current,
        preferences: {
          ...current.preferences,
          dismissedDangerWarnings: [...dismissed, id],
        },
      })
    })
  }

  function requestDangerConfirmation(prompt: DangerPrompt): Promise<boolean> {
    if (hasDismissedDangerWarning(prompt.id)) {
      return Promise.resolve(true)
    }

    return new Promise((resolve) => {
      dangerResolverRef.current = resolve
      setDangerSkipChecked(false)
      setDangerPrompt(prompt)
    })
  }

  function closeDangerPrompt(confirmed: boolean): void {
    const prompt = dangerPrompt
    const resolve = dangerResolverRef.current

    if (confirmed && dangerSkipChecked && prompt) {
      dismissDangerWarning(prompt.id)
    }

    dangerResolverRef.current = null
    setDangerPrompt(null)
    setDangerSkipChecked(false)
    resolve?.(confirmed)
  }

  function hasSyncCredentials(snapshot: AppData): boolean {
    if (!snapshot.sync.autoSync || snapshot.sync.mode === 'local') {
      return false
    }

    if (!syncPassphraseRef.current) {
      return false
    }

    if (snapshot.sync.mode === 'gist') {
      return Boolean(githubTokenRef.current.trim())
    }

    return Boolean(
      snapshot.sync.workerEndpoint?.trim() && workerTokenRef.current.trim(),
    )
  }

  function canPullRemote(snapshot: AppData): boolean {
    if (!hasSyncCredentials(snapshot)) {
      return false
    }

    return snapshot.sync.mode !== 'gist' || Boolean(snapshot.sync.gistId?.trim())
  }

  function hasUnsyncedLocalChanges(snapshot: AppData): boolean {
    return snapshot.updatedAt > (snapshot.sync.lastSyncAt ?? 0)
  }

  function clearScheduledSync(): void {
    if (syncTimerRef.current !== null) {
      window.clearTimeout(syncTimerRef.current)
      syncTimerRef.current = null
    }
  }

  function queuePendingSync(snapshot: AppData, options: RunSyncOptions): void {
    const pullOnly = Boolean(options.pullOnly)
    const pending = pendingSyncRef.current

    if (pending && !pending.options.pullOnly && pullOnly) {
      pendingSyncRef.current = {
        snapshot,
        options: pending.options,
      }
      return
    }

    pendingSyncRef.current = {
      snapshot,
      options: {
        pullOnly,
        silent: options.silent ?? true,
      },
    }
  }

  function scheduleAutoSync(
    snapshot: AppData,
    delayMs = AUTO_SYNC_DEBOUNCE_MS,
    options: { allowStreaming?: boolean } = {},
  ): void {
    if (!hasSyncCredentials(snapshot) || !hasUnsyncedLocalChanges(snapshot)) {
      return
    }

    if (!options.allowStreaming && hasStreamingMessage(snapshot)) {
      return
    }

    clearScheduledSync()
    syncTimerRef.current = window.setTimeout(() => {
      syncTimerRef.current = null
      const latest = dataRef.current ?? snapshot

      if (!hasSyncCredentials(latest) || !hasUnsyncedLocalChanges(latest)) {
        return
      }

      if (!options.allowStreaming && hasStreamingMessage(latest)) {
        return
      }

      void runSync(latest, { silent: true })
    }, delayMs)
  }

  function changeActiveProvider(providerId: string): void {
    if (!activeConversation || !data) {
      return
    }

    const provider = data.providers.find((item) => item.id === providerId)

    if (!provider) {
      return
    }

    updateData((current) =>
      updateConversation(current, activeConversation.id, (conversation) => ({
        ...conversation,
        providerId,
        model: provider.model,
      })),
    )
    setSelectedProviderId(providerId)
  }

  function updateConversationModel(model: string): void {
    if (!activeConversation) {
      return
    }

    updateData((current) =>
      updateConversation(current, activeConversation.id, (conversation) => ({
        ...conversation,
        model,
      })),
    )
  }

  async function runSync(
    snapshot?: AppData,
    options: RunSyncOptions = {},
  ): Promise<void> {
    const current = snapshot ?? dataRef.current

    if (!current) {
      return
    }

    clearScheduledSync()

    if (syncingRef.current) {
      queuePendingSync(current, options)
      return
    }

    syncingRef.current = true
    setSyncing(true)

    if (!options.silent) {
      setNotice('')
    }

    try {
      const syncContext = {
        encryptionPassphrase: syncPassphraseRef.current,
        githubToken: githubTokenRef.current,
        providerKeys: providerKeysRef.current,
        providerProxyTokens: providerProxyTokensRef.current,
        workerToken: workerTokenRef.current,
      }
      const result = options.pullOnly
        ? await pullRemoteChanges(current, syncContext)
        : await performSync(current, syncContext)
      const sanitized = sanitizeRemoteOnlyAppData(result.data)
      const resultData = sanitized.data
      const resultSecrets = result.secrets
        ? pruneProviderSecrets(
            result.secrets,
            resultData.providers.map((provider) => provider.id),
          )
        : undefined
      const latest = dataRef.current
      const changedWhileSyncing = Boolean(
        latest && latest.updatedAt !== current.updatedAt,
      )

      if (changedWhileSyncing) {
        if (result.remoteAccepted) {
          setNotice('同步期间本机也有新改动，已保留本机数据，请再同步一次')
        } else if (!options.pullOnly && latest) {
          const merged = mergeSyncIdentifiers(latest, resultData)
          dataRef.current = merged
          setData(merged)
        }
      } else {
        dataRef.current = resultData
        setData(resultData)
      }

      if (sanitized.removedProviderIds.length > 0) {
        await clearProviderSecretsById(sanitized.removedProviderIds)
      }

      if (!changedWhileSyncing && result.remoteAccepted && resultSecrets) {
        await applySyncedSecrets(
          resultSecrets.providerKeys,
          resultSecrets.providerProxyTokens ?? {},
        )
      }

      if (!changedWhileSyncing && (!options.silent || result.remoteAccepted)) {
        setNotice(
          sanitized.changed
            ? `${result.message}；已移除本地或不安全的服务商配置`
            : result.message,
        )
      }
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      syncingRef.current = false
      setSyncing(false)

      const pending = pendingSyncRef.current
      pendingSyncRef.current = null

      if (pending) {
        window.setTimeout(() => {
          void runSync(pending.snapshot, pending.options)
        }, 0)
      }
    }
  }

  async function sendMessage(event?: FormEvent): Promise<void> {
    event?.preventDefault()

    if (!data || !activeConversation || !activeProvider || sending) {
      return
    }

    const content = draft.trim()

    if (!content) {
      return
    }

    const model = activeConversation.model || activeProvider.model
    const apiKey = providerKeys[activeProvider.id] ?? ''
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      createdAt: now(),
      status: 'done',
    }
    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      createdAt: now(),
      status: 'streaming',
    }
    const requestMessages = [...activeConversation.messages, userMessage]
    const title =
      activeConversation.messages.length === 0
        ? cleanTitle(content)
        : activeConversation.title

    setDraft('')
    setSending(true)
    setNotice('')

    const submitted = updateData((current) =>
      updateConversation(current, activeConversation.id, (conversation) => ({
        ...conversation,
        title,
        model,
        messages: [...conversation.messages, userMessage, assistantMessage],
      })),
    )

    if (submitted) {
      scheduleAutoSync(submitted, 0, { allowStreaming: true })
    }

    const controller = new AbortController()
    abortRef.current = controller
    let assistantContent = ''

    try {
      await streamChat({
        provider: activeProvider,
        apiKey,
        proxyToken: providerProxyTokens[activeProvider.id] ?? workerTokenValue,
        model,
        messages: requestMessages,
        signal: controller.signal,
        onToken: (token) => {
          assistantContent += token
          updateData((current) =>
            updateConversation(current, activeConversation.id, (conversation) => ({
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.id === assistantMessage.id
                  ? { ...message, content: assistantContent, status: 'streaming' }
                  : message,
              ),
            })),
          )
        },
      })

      updateData((current) =>
        updateConversation(current, activeConversation.id, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.id === assistantMessage.id
              ? { ...message, content: assistantContent, status: 'done' }
              : message,
          ),
        })),
      )

      const snapshot = dataRef.current
      if (snapshot) {
        scheduleAutoSync(snapshot, 0, { allowStreaming: true })
      }
    } catch (error: unknown) {
      const isAbort =
        error instanceof DOMException && error.name === 'AbortError'
      const message = isAbort
        ? '已停止生成'
        : error instanceof Error
          ? error.message
          : String(error)

      const failed = updateData((current) =>
        updateConversation(current, activeConversation.id, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((item) =>
            item.id === assistantMessage.id
              ? {
                  ...item,
                  content: assistantContent || message,
                  status: isAbort ? 'done' : 'error',
                  error: isAbort ? undefined : message,
                }
              : item,
          ),
        })),
      )
      if (failed) {
        scheduleAutoSync(failed, 0, { allowStreaming: true })
      }
      setNotice('')
    } finally {
      abortRef.current = null
      setSending(false)
    }
  }

  function stopGeneration(): void {
    abortRef.current?.abort()
  }

  function startEditingMessage(message: ChatMessage): void {
    if (message.status === 'streaming') {
      return
    }

    setEditingMessageId(message.id)
    setEditingContent(message.content)
  }

  function cancelEditingMessage(): void {
    setEditingMessageId('')
    setEditingContent('')
  }

  function saveEditingMessage(): void {
    if (!activeConversation || !editingMessageId) {
      return
    }

    const content = editingContent.trim()

    if (!content) {
      setNotice('消息内容不能为空')
      return
    }

    const saved = updateData((current) =>
      updateConversation(current, activeConversation.id, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.id === editingMessageId
            ? {
                ...message,
                content,
                status: 'done',
                error: undefined,
              }
            : message,
        ),
      })),
    )

    cancelEditingMessage()

    if (saved) {
      scheduleAutoSync(saved, 0, { allowStreaming: true })
    }
  }

  async function deleteMessage(messageId: string): Promise<void> {
    if (!activeConversation || sending) {
      return
    }

    const target = activeConversation.messages.find(
      (message) => message.id === messageId,
    )

    if (!target) {
      return
    }

    const confirmed = await requestDangerConfirmation({
      id: 'delete-message',
      title: '删除聊天记录',
      body: `将永久删除这条${target.role === 'assistant' ? 'AI 回复' : '用户消息'}。`,
      details: [
        '如果已开启即时自动同步，云端加密数据也会同步删除这条记录。',
        '同步完成后，其他设备会看不到这条记录。',
        '这个操作不能从 ZeroChat 内恢复，只能依赖你之前导出的加密备份。',
      ],
      confirmLabel: '删除记录',
    })

    if (!confirmed) {
      return
    }

    const saved = updateData((current) =>
      updateConversation(current, activeConversation.id, (conversation) => ({
        ...conversation,
        messages: conversation.messages.filter((message) => message.id !== messageId),
      })),
    )

    if (editingMessageId === messageId) {
      cancelEditingMessage()
    }

    if (saved) {
      scheduleAutoSync(saved, 0, { allowStreaming: true })
    }
  }

  async function regenerateAssistantMessage(messageId: string): Promise<void> {
    if (!data || !activeConversation || !activeProvider || sending) {
      return
    }

    const targetIndex = activeConversation.messages.findIndex(
      (message) => message.id === messageId,
    )
    const target = activeConversation.messages[targetIndex]

    if (!target || target.role !== 'assistant' || target.status === 'streaming') {
      return
    }

    const requestMessages = activeConversation.messages.slice(0, targetIndex)

    if (!requestMessages.some((message) => message.role === 'user')) {
      setNotice('没有可用于重新生成的用户消息')
      return
    }

    const model = activeConversation.model || activeProvider.model
    const apiKey = providerKeysRef.current[activeProvider.id] ?? ''

    cancelEditingMessage()
    setSending(true)
    setNotice('')

    const prepared = updateData((current) =>
      updateConversation(current, activeConversation.id, (conversation) => ({
        ...conversation,
        model,
        messages: conversation.messages
          .slice(0, targetIndex + 1)
          .map((message, index) =>
            index === targetIndex
              ? {
                  ...message,
                  content: '',
                  status: 'streaming',
                  error: undefined,
                }
              : message,
          ),
      })),
    )

    if (prepared) {
      scheduleAutoSync(prepared, 0, { allowStreaming: true })
    }

    const controller = new AbortController()
    abortRef.current = controller
    let assistantContent = ''

    try {
      await streamChat({
        provider: activeProvider,
        apiKey,
        proxyToken:
          providerProxyTokensRef.current[activeProvider.id] ?? workerTokenRef.current,
        model,
        messages: requestMessages,
        signal: controller.signal,
        onToken: (token) => {
          assistantContent += token
          updateData((current) =>
            updateConversation(current, activeConversation.id, (conversation) => ({
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.id === messageId
                  ? { ...message, content: assistantContent, status: 'streaming' }
                  : message,
              ),
            })),
          )
        },
      })

      updateData((current) =>
        updateConversation(current, activeConversation.id, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.id === messageId
              ? { ...message, content: assistantContent, status: 'done' }
              : message,
          ),
        })),
      )

      const snapshot = dataRef.current
      if (snapshot) {
        scheduleAutoSync(snapshot, 0, { allowStreaming: true })
      }
    } catch (error: unknown) {
      const isAbort =
        error instanceof DOMException && error.name === 'AbortError'
      const message = isAbort
        ? '已停止生成'
        : error instanceof Error
          ? error.message
          : String(error)

      const failed = updateData((current) =>
        updateConversation(current, activeConversation.id, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((item) =>
            item.id === messageId
              ? {
                  ...item,
                  content: assistantContent || message,
                  status: isAbort ? 'done' : 'error',
                  error: isAbort ? undefined : message,
                }
              : item,
          ),
        })),
      )

      if (failed) {
        scheduleAutoSync(failed, 0, { allowStreaming: true })
      }
      setNotice('')
    } finally {
      abortRef.current = null
      setSending(false)
    }
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendMessage()
    }
  }

  function finishGuide(localOnly = false): void {
    if (!localOnly && !guideCanFinish) {
      setNotice(
        guideRequirement ||
          '请先完成模型配置；只想先试用界面可以选择跳过。',
      )
      return
    }

    const providerForGuide = localOnly ? null : selectedProvider

    updateData((current) =>
      bump(
        {
          ...current,
          conversations:
            providerForGuide && current.preferences.activeConversationId
              ? current.conversations.map((conversation) =>
                  conversation.id === current.preferences.activeConversationId
                    ? {
                        ...conversation,
                        providerId: providerForGuide.id,
                        model: providerForGuide.model.trim(),
                        updatedAt: now(),
                      }
                    : conversation,
                )
              : current.conversations,
          sync: localOnly
            ? {
                ...current.sync,
                mode: 'local',
                autoSync: false,
                encryptionEnabled: true,
              }
            : current.sync,
          preferences: {
            ...current.preferences,
            firstRunDone: true,
          },
        },
      ),
    )
    setNotice('')
    setGuideOpen(false)
  }

  function openSettings(): void {
    if (activeProvider) {
      setSelectedProviderId(activeProvider.id)
    }

    setSettingsOpen(true)
  }

  function openGuide(): void {
    if (activeProvider) {
      setSelectedProviderId(activeProvider.id)
      setSelectedPresetId(presetIdForProvider(activeProvider))
    }

    setNotice('')
    setGuideOpen(true)
  }

  function changeSyncMode(mode: SyncMode): void {
    updateData((current) =>
      bump({
        ...current,
        sync: {
          ...current.sync,
          mode,
          autoSync: mode === 'local' ? false : current.sync.autoSync,
          encryptionEnabled: true,
        },
      }),
    )
  }

  function changeTheme(theme: ThemeMode): void {
    updateData((current) =>
      bump({
        ...current,
        preferences: {
          ...current.preferences,
          theme,
        },
      }),
    )
  }

  async function exportData(): Promise<void> {
    if (!data) {
      return
    }

    if (!syncPassphraseValue) {
      setNotice('请先填写同步加密密码，再导出加密备份')
      return
    }

    try {
      const envelope = await encryptVault(
        {
          data,
          secrets: {
            providerKeys,
            providerProxyTokens,
          },
        },
        syncPassphraseValue,
      )
      const blob = new Blob([JSON.stringify(envelope, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `zerochat-encrypted-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  async function importData(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    try {
      const confirmed = await requestDangerConfirmation({
        id: 'import-backup-overwrite',
        title: '导入会覆盖当前数据',
        body: '导入加密备份会替换当前本机聊天记录、服务商配置、设置和已同步的服务商密钥。',
        details: [
          '如果导入后的数据开启了即时自动同步，之后同步时可能会把云端也改成导入的版本。',
          '当前未导出的本机改动可能无法恢复。',
          '建议先导出一份当前加密备份，再继续导入。',
        ],
        confirmLabel: '继续导入',
      })

      if (!confirmed) {
        return
      }

      if (!syncPassphraseValue) {
        throw new Error('请先填写同步加密密码，再导入加密备份')
      }

      const parsed = JSON.parse(await file.text()) as unknown

      if (!isEncryptedSnapshot(parsed)) {
        throw new Error('为保护隐私，当前只支持导入加密备份')
      }

      const vault = await decryptVault(parsed, syncPassphraseValue)

      if (vault.data.version !== 1 || !Array.isArray(vault.data.conversations)) {
        throw new Error('文件格式不正确')
      }

      const sanitizedImport = sanitizeRemoteOnlyAppData({
        ...vault.data,
        updatedAt: now(),
      })
      const imported = sanitizedImport.data
      const importedSecrets = pruneProviderSecrets(
        {
          providerKeys: vault.secrets?.providerKeys ?? {},
          providerProxyTokens: vault.secrets?.providerProxyTokens ?? {},
        },
        imported.providers.map((provider) => provider.id),
      )
      dataRef.current = imported
      setData(imported)
      setSelectedProviderId(preferredProviderId(imported))
      await applySyncedSecrets(
        importedSecrets.providerKeys,
        importedSecrets.providerProxyTokens,
      )
      if (sanitizedImport.removedProviderIds.length > 0) {
        await clearProviderSecretsById(sanitizedImport.removedProviderIds)
      }
      setNotice(
        sanitizedImport.changed
          ? '已导入加密备份；本地或不安全的服务商配置已移除'
          : '已导入加密备份',
      )
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      event.target.value = ''
    }
  }

  async function resetLocalData(): Promise<void> {
    const confirmed = await requestDangerConfirmation({
      id: 'reset-local-data',
      title: '重置本机数据',
      body: '将清空本机聊天记录、配置、服务商密钥、GitHub Token、Worker 同步密钥和同步加密密码。',
      details: [
        '这个操作不会主动删除云端同步库里的密文。',
        '如果没有加密备份或同步加密密码，旧数据可能无法在本机恢复。',
        '重置后会回到首次启动状态。',
      ],
      confirmLabel: '重置本机',
    })

    if (!confirmed) {
      return
    }

    await clearAppData()
    await clearZeroChatSecrets()
    const dismissedDangerWarnings =
      dataRef.current?.preferences.dismissedDangerWarnings ?? []
    const fresh = createDefaultData()
    fresh.preferences.dismissedDangerWarnings = dismissedDangerWarnings
    dataRef.current = fresh
    setData(fresh)
    setSelectedProviderId(preferredProviderId(fresh))
    setProviderKeys({})
    setProviderProxyTokens({})
    setGithubTokenValue('')
    setWorkerTokenValue('')
    setSyncPassphraseValue('')
    providerKeysRef.current = {}
    providerProxyTokensRef.current = {}
    githubTokenRef.current = ''
    workerTokenRef.current = ''
    syncPassphraseRef.current = ''
    setNotice('已重置本地数据')
  }

  if (loadError) {
    return (
      <main className="empty-state">
        <h1>ZeroChat</h1>
        <p>{loadError}</p>
      </main>
    )
  }

  if (!data || !activeConversation || !activeProvider) {
    return (
      <main className="empty-state">
        <h1>ZeroChat</h1>
        <p>正在载入...</p>
      </main>
    )
  }

  const welcomeHint = activeModel.trim()
    ? activeProvider.needsApiKey
      ? '确认服务商密钥已填写后即可发送。'
      : '输入消息即可发送。'
    : activeProvider.needsApiKey
      ? '填写服务商密钥，并获取或填写模型名称后即可发送。'
      : '获取或填写模型名称后即可发送。'
  const syncRequirement =
    data.sync.mode === 'local'
      ? '本地模式不会上传数据；需要跨设备时选择 Gist 或 Cloudflare。'
      : !syncPassphraseValue.trim()
        ? '请先填写同步加密密码。'
        : data.sync.mode === 'gist' && !githubTokenValue.trim()
          ? '请先填写 GitHub Token。'
          : data.sync.mode === 'cloudflare' &&
              !data.sync.workerEndpoint?.trim()
            ? '请先填写 Worker 地址。'
            : data.sync.mode === 'cloudflare' && !workerTokenValue.trim()
              ? '请先填写同步密钥。'
              : ''
  const remoteSyncReady = data.sync.mode !== 'local' && !syncRequirement
  const manualSyncReady = data.sync.mode === 'local' || remoteSyncReady

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand-row">
          <button
            className="icon-button mobile-only"
            type="button"
            title="关闭边栏"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={18} />
          </button>
          <div>
            <strong>ZeroChat</strong>
            <span>本地优先</span>
          </div>
          <button
            className="icon-button"
            type="button"
            title="新对话"
            onClick={createNewConversation}
          >
            <MessageSquarePlus size={18} />
          </button>
        </div>

        <div className="sync-pill">
          {data.sync.mode === 'local' ? (
            <HardDrive size={15} />
          ) : data.sync.mode === 'gist' ? (
            <GitBranch size={15} />
          ) : (
            <Cloud size={15} />
          )}
          <span>{data.sync.lastSyncStatus || '本地已保存'}</span>
        </div>

        <nav className="conversation-list" aria-label="对话列表">
          {data.conversations.map((conversation) => (
            <button
              className={`conversation-item ${
                conversation.id === activeConversation.id ? 'active' : ''
              }`}
              key={conversation.id}
              type="button"
              onClick={() => setActiveConversation(conversation.id)}
            >
              <span>{conversation.title}</span>
              <small>{timeLabel(conversation.updatedAt)}</small>
            </button>
          ))}
        </nav>

        <div className="sidebar-actions">
          <button className="ghost-button" type="button" onClick={() => runSync()}>
            <RefreshCw size={16} className={syncing ? 'spin' : ''} />
            同步
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={openSettings}
          >
            <Settings size={16} />
            设置
          </button>
        </div>
      </aside>

      <main className="chat-pane">
        <header className="chat-header">
          <button
            className="icon-button mobile-only"
            type="button"
            title="打开边栏"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={18} />
          </button>
          <div className="title-stack">
            <h1>{activeConversation.title}</h1>
            <span>
              {activeProvider.name}
              {activeModel ? ` / ${activeModel}` : ''}
            </span>
          </div>
          <div className="header-controls">
            <select
              value={activeConversation.providerId}
              onChange={(event) => changeActiveProvider(event.target.value)}
              aria-label="选择服务商"
            >
              {data.providers
                .filter((provider) => provider.enabled)
                .map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
            </select>
            <div className="model-picker">
              <div className="model-row">
                <input
                  value={activeModel}
                  onChange={(event) => updateConversationModel(event.target.value)}
                  placeholder="模型名称"
                  aria-label="模型名称"
                />
                <button
                  className="icon-button"
                  type="button"
                  title="从服务商获取模型"
                  onClick={() =>
                    void refreshProviderModels(activeProvider.id, {
                      useAsConversationModel: true,
                    })
                  }
                  disabled={Boolean(loadingModelsProviderId)}
                >
                  <RefreshCw
                    size={16}
                    className={
                      loadingModelsProviderId === activeProvider.id ? 'spin' : ''
                    }
                  />
                </button>
              </div>
              {activeProviderModels.length > 0 ? (
                <select
                  value={
                    activeProviderModels.includes(activeModel)
                      ? activeModel
                      : ''
                  }
                  onChange={(event) => updateConversationModel(event.target.value)}
                  aria-label="选择已获取的模型"
                >
                  <option value="">选择模型</option>
                  {activeProviderModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
            <button
              className="icon-button"
              type="button"
              title="删除当前对话"
              onClick={() => void deleteConversation(activeConversation.id)}
            >
              <Trash2 size={18} />
            </button>
          </div>
        </header>

        <section className="message-list" aria-live="polite">
          {activeConversation.messages.length === 0 ? (
            <div className="welcome-panel">
              <Bot size={28} />
              <h2>开始对话</h2>
              <p>{welcomeHint}</p>
            </div>
          ) : (
            activeConversation.messages.map((message) => {
              const isEditing = editingMessageId === message.id
              const isStreaming = message.status === 'streaming'
              const showErrorInMeta =
                Boolean(message.error) && message.error !== message.content

              return (
                <article className={assistantMessageClass(message)} key={message.id}>
                  <div className="avatar">
                    {message.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                  </div>
                  <div className="message-body">
                    <div className="message-meta">
                      <strong>{message.role === 'user' ? '你' : 'AI'}</strong>
                      {isStreaming ? <span>生成中</span> : null}
                      {showErrorInMeta ? <span>{message.error}</span> : null}
                      {!showErrorInMeta && message.status === 'error' ? (
                        <span>生成失败</span>
                      ) : null}
                      {!isStreaming ? (
                        <div className="message-actions">
                          <button
                            type="button"
                            title="编辑消息"
                            onClick={() => startEditingMessage(message)}
                            disabled={sending}
                          >
                            <Pencil size={14} />
                          </button>
                          {message.role === 'assistant' ? (
                            <button
                              type="button"
                              title="重新生成"
                              onClick={() => void regenerateAssistantMessage(message.id)}
                              disabled={sending}
                            >
                              <RefreshCw size={14} />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            title="删除消息"
                            onClick={() => void deleteMessage(message.id)}
                            disabled={sending}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {isEditing ? (
                      <div className="message-editor">
                        <textarea
                          value={editingContent}
                          onChange={(event) => setEditingContent(event.target.value)}
                          rows={Math.min(
                            8,
                            Math.max(3, editingContent.split('\n').length),
                          )}
                          aria-label="编辑消息"
                        />
                        <div className="message-editor-actions">
                          <button type="button" onClick={saveEditingMessage}>
                            <Check size={14} />
                            保存
                          </button>
                          <button type="button" onClick={cancelEditingMessage}>
                            <X size={14} />
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p>{message.content || '...'}</p>
                    )}
                  </div>
                </article>
              )
            })
          )}
        </section>

        {notice ? <div className="notice">{notice}</div> : null}

        <form className="composer" onSubmit={sendMessage}>
          <textarea
            value={draft}
            rows={1}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleDraftKeyDown}
            placeholder="输入消息"
            aria-label="输入消息"
          />
          {sending ? (
            <button className="send-button" type="button" onClick={stopGeneration}>
              <Square size={18} />
              停止
            </button>
          ) : (
            <button className="send-button" type="submit">
              <Send size={18} />
              发送
            </button>
          )}
        </form>
      </main>

      {settingsOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal settings-modal">
            <div className="modal-header">
              <div>
                <h2>设置</h2>
                <p>服务商密钥会端到端加密同步；同步访问密钥只留在本机。</p>
              </div>
              <button
                className="icon-button"
                type="button"
                title="关闭设置"
                onClick={() => setSettingsOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="segmented">
              <button
                type="button"
                className={settingsTab === 'providers' ? 'active' : ''}
                onClick={() => setSettingsTab('providers')}
              >
                模型
              </button>
              <button
                type="button"
                className={settingsTab === 'sync' ? 'active' : ''}
                onClick={() => setSettingsTab('sync')}
              >
                同步
              </button>
              <button
                type="button"
                className={settingsTab === 'data' ? 'active' : ''}
                onClick={() => setSettingsTab('data')}
              >
                数据
              </button>
            </div>

            {settingsTab === 'providers' && selectedProvider ? (
              <div className="settings-grid">
                <div className="provider-list">
                  {data.providers.map((provider) => (
                    <button
                      key={provider.id}
                      type="button"
                      className={
                        provider.id === selectedProvider.id ? 'active' : ''
                      }
                      onClick={() => setSelectedProviderId(provider.id)}
                    >
                      <span>{provider.name}</span>
                      <small>{providerKindLabel(provider.kind)}</small>
                    </button>
                  ))}
                  <div className="add-provider">
                    <select
                      value=""
                      onChange={(event) =>
                        addProviderFromPresetSelect(event.target.value)
                      }
                      aria-label="选择并添加服务商"
                    >
                      <option value="" disabled>
                        添加服务商...
                      </option>
                      {providerPresets.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-stack">
                  <label>
                    名称
                    <input
                      value={selectedProvider.name}
                      onChange={(event) =>
                        updateProvider(selectedProvider.id, {
                          name: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    接口类型
                    <select
                      value={selectedProvider.kind}
                      onChange={(event) =>
                        updateProvider(selectedProvider.id, {
                          kind: event.target.value as ProviderConfig['kind'],
                        })
                      }
                    >
                      <option value="openai-compatible">OpenAI 兼容</option>
                      <option value="openai-responses">OpenAI Responses</option>
                      <option value="anthropic">Anthropic</option>
                    </select>
                  </label>
                  <label>
                    Base URL
                    <input
                      value={selectedProvider.baseUrl}
                      onChange={(event) =>
                        updateProvider(selectedProvider.id, {
                          baseUrl: event.target.value,
                        })
                      }
                      placeholder="https://api.example.com/v1"
                    />
                  </label>
                  <label>
                    代理地址
                    <input
                      value={selectedProvider.proxyUrl ?? ''}
                      onChange={(event) =>
                        updateProvider(selectedProvider.id, {
                          proxyUrl: event.target.value.trim() || undefined,
                        })
                      }
                      placeholder="可留空；浏览器直连失败时填写 Worker 地址"
                    />
                  </label>
                  <label>
                    代理访问密钥
                    <input
                      type="password"
                      value={providerProxyTokens[selectedProvider.id] ?? ''}
                      onChange={(event) =>
                        updateProviderProxyToken(
                          selectedProvider.id,
                          event.target.value,
                        )
                      }
                      placeholder="Worker PROXY_TOKEN"
                    />
                  </label>
                  <label>
                    服务商密钥
                    <div className="input-icon">
                      <KeyRound size={16} />
                      <input
                        type="password"
                        value={providerKeys[selectedProvider.id] ?? ''}
                        onChange={(event) =>
                          updateProviderKey(
                            selectedProvider.id,
                            event.target.value,
                          )
                        }
                        placeholder={
                          selectedProvider.needsApiKey ? 'sk-...' : '可留空'
                        }
                      />
                    </div>
                  </label>
                  <label>
                    默认模型
                    <div className="model-picker">
                      <div className="model-row">
                        <input
                          value={selectedProvider.model}
                          onChange={(event) =>
                            updateProvider(selectedProvider.id, {
                              model: event.target.value,
                            })
                          }
                          placeholder="可手填，也可从服务商获取"
                        />
                        <button
                          className="icon-button"
                          type="button"
                          title="从服务商获取模型"
                          onClick={() =>
                            void refreshProviderModels(selectedProvider.id, {
                              useAsProviderModel: true,
                            })
                          }
                          disabled={Boolean(loadingModelsProviderId)}
                        >
                          <RefreshCw
                            size={16}
                            className={
                              loadingModelsProviderId === selectedProvider.id
                                ? 'spin'
                                : ''
                            }
                          />
                        </button>
                      </div>
                      {selectedProviderModels.length > 0 ? (
                        <select
                          value={
                            selectedProviderModels.includes(selectedProvider.model)
                              ? selectedProvider.model
                              : ''
                          }
                          onChange={(event) =>
                            updateProvider(selectedProvider.id, {
                              model: event.target.value,
                            })
                          }
                          aria-label="选择已获取的默认模型"
                        >
                          <option value="">选择模型</option>
                          {selectedProviderModels.map((model) => (
                            <option key={model} value={model}>
                              {model}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                  </label>
                  <label className="switch-row">
                    <input
                      type="checkbox"
                      checked={selectedProvider.enabled}
                      onChange={(event) =>
                        updateProvider(selectedProvider.id, {
                          enabled: event.target.checked,
                        })
                      }
                    />
                    启用
                  </label>
                  <label className="switch-row">
                    <input
                      type="checkbox"
                      checked={selectedProvider.needsApiKey}
                      onChange={(event) =>
                        updateProvider(selectedProvider.id, {
                          needsApiKey: event.target.checked,
                        })
                      }
                    />
                    需要服务商密钥
                  </label>
                  <p className="settings-note">
                    官方服务商通常需要开启；如果你的中转服务已经代管密钥，可以关闭。
                  </p>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => void removeProvider(selectedProvider.id)}
                  >
                    <Trash2 size={16} />
                    删除服务商
                  </button>
                </div>
              </div>
            ) : null}

            {settingsTab === 'sync' ? (
              <div className="form-stack sync-settings">
                <div className="mode-grid">
                  <button
                    type="button"
                    className={data.sync.mode === 'local' ? 'active' : ''}
                    onClick={() => changeSyncMode('local')}
                  >
                    <HardDrive size={18} />
                    本地
                  </button>
                  <button
                    type="button"
                    className={data.sync.mode === 'gist' ? 'active' : ''}
                    onClick={() => changeSyncMode('gist')}
                  >
                    <GitBranch size={18} />
                    GitHub Gist
                  </button>
                  <button
                    type="button"
                    className={data.sync.mode === 'cloudflare' ? 'active' : ''}
                    onClick={() => changeSyncMode('cloudflare')}
                  >
                    <Cloud size={18} />
                    Cloudflare
                  </button>
                </div>

                <label>
                  同步加密密码
                  <input
                    type="password"
                    value={syncPassphraseValue}
                    onChange={(event) => {
                      setSyncPassphraseValue(event.target.value)
                      syncPassphraseRef.current = event.target.value
                      setSyncPassphrase(event.target.value)
                    }}
                    placeholder="用于端到端加密和解密同步数据"
                  />
                </label>
                <p className="settings-note">
                  聊天、设置和服务商密钥会先在本机加密，再上传到 Gist 或 Cloudflare。
                </p>
                {syncRequirement ? (
                  <p className="settings-note guide-requirement">
                    {syncRequirement}
                  </p>
                ) : null}

                {data.sync.mode === 'gist' ? (
                  <>
                    <label>
                      Gist ID
                      <input
                        value={data.sync.gistId ?? ''}
                        onChange={(event) =>
                          updateData((current) =>
                            bump({
                              ...current,
                              sync: {
                                ...current.sync,
                                gistId: event.target.value.trim() || undefined,
                              },
                            }),
                          )
                        }
                        placeholder="首次同步可留空"
                      />
                    </label>
                    <label>
                      文件名
                      <input
                        value={data.sync.gistFile ?? 'zerochat-sync.json'}
                        onChange={(event) =>
                          updateData((current) =>
                            bump({
                              ...current,
                              sync: {
                                ...current.sync,
                                gistFile: event.target.value,
                              },
                            }),
                          )
                        }
                      />
                    </label>
                    <label>
                      GitHub Token
                      <input
                        type="password"
                        value={githubTokenValue}
                        onChange={(event) => {
                          setGithubTokenValue(event.target.value)
                          githubTokenRef.current = event.target.value
                          reportSecretWrite(setGithubToken(event.target.value))
                        }}
                        placeholder="Fine-grained token"
                      />
                    </label>
                  </>
                ) : null}

                {data.sync.mode === 'cloudflare' ? (
                  <>
                    <label>
                      Worker 地址
                      <input
                        value={data.sync.workerEndpoint ?? ''}
                        onChange={(event) =>
                          updateData((current) =>
                            bump({
                              ...current,
                              sync: {
                                ...current.sync,
                                workerEndpoint:
                                  event.target.value.trim() || undefined,
                              },
                            }),
                          )
                        }
                        placeholder="https://zerochat-sync.example.workers.dev"
                      />
                    </label>
                    <label>
                      同步密钥
                      <input
                        type="password"
                        value={workerTokenValue}
                        onChange={(event) => {
                          setWorkerTokenValue(event.target.value)
                          workerTokenRef.current = event.target.value
                          reportSecretWrite(setWorkerToken(event.target.value))
                        }}
                      />
                    </label>
                  </>
                ) : null}

                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={data.sync.autoSync}
                    disabled={!remoteSyncReady}
                    onChange={(event) =>
                      updateData((current) =>
                        bump({
                          ...current,
                          sync: {
                            ...current.sync,
                            autoSync: event.target.checked,
                          },
                        }),
                      )
                    }
                  />
                  即时自动同步
                </label>

                <button
                  className="primary-button"
                  type="button"
                  onClick={() => runSync()}
                  disabled={syncing || !manualSyncReady}
                >
                  <RefreshCw size={16} className={syncing ? 'spin' : ''} />
                  立即同步
                </button>
                <p className="settings-note">
                  最近同步：{timeLabel(data.sync.lastSyncAt)}
                </p>
              </div>
            ) : null}

            {settingsTab === 'data' ? (
              <div className="form-stack">
                <label>
                  主题
                  <select
                    value={data.preferences.theme}
                    onChange={(event) => changeTheme(event.target.value as ThemeMode)}
                  >
                    <option value="system">跟随系统</option>
                    <option value="light">浅色</option>
                    <option value="dark">深色</option>
                  </select>
                </label>
                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={data.preferences.compactMode}
                    onChange={(event) =>
                      updateData((current) =>
                        bump({
                          ...current,
                          preferences: {
                            ...current.preferences,
                            compactMode: event.target.checked,
                          },
                        }),
                      )
                    }
                  />
                  紧凑显示
                </label>
                <div className="button-row">
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => void exportData()}
                  >
                    <Download size={16} />
                    导出加密备份
                  </button>
                  <label className="file-button">
                    <Upload size={16} />
                    导入加密备份
                    <input
                      type="file"
                      accept="application/json"
                      onChange={(event) => void importData(event)}
                    />
                  </label>
                </div>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={openGuide}
                >
                  <RotateCcw size={16} />
                  打开配置引导
                </button>
                <button
                  className="danger-button"
                  type="button"
                  onClick={() => void resetLocalData()}
                >
                  <Trash2 size={16} />
                  重置本机数据
                </button>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {dangerPrompt ? (
        <div
          className="modal-backdrop danger-backdrop"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="danger-title"
        >
          <section className="modal danger-modal">
            <div className="modal-header">
              <div>
                <h2 id="danger-title">{dangerPrompt.title}</h2>
                <p>请先确认这个操作的影响。</p>
              </div>
              <button
                className="icon-button"
                type="button"
                title="取消"
                onClick={() => closeDangerPrompt(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="danger-copy">
              <p>{dangerPrompt.body}</p>
              <ul>
                {dangerPrompt.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            </div>
            <label className="switch-row danger-skip">
              <input
                type="checkbox"
                checked={dangerSkipChecked}
                onChange={(event) => setDangerSkipChecked(event.target.checked)}
              />
              我已理解这个风险，以后不再提醒这类操作
            </label>
            <div className="modal-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={() => closeDangerPrompt(false)}
              >
                取消
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={() => closeDangerPrompt(true)}
              >
                <Trash2 size={16} />
                {dangerPrompt.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {guideVisible ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal guide-modal">
            <div className="modal-header">
              <div>
                <h2>首次配置</h2>
                <p>先接入一个模型；同步可以稍后再开。</p>
              </div>
              {data.preferences.firstRunDone ? (
                <button
                  className="icon-button"
                  type="button"
                  title="关闭引导"
                  onClick={() => setGuideOpen(false)}
                >
                  <X size={18} />
                </button>
              ) : null}
            </div>

            <div className="guide-layout">
              <div className="form-stack">
                <label>
                  服务商
                  <select
                    value={selectedPresetId}
                    onChange={(event) => applyGuidePreset(event.target.value)}
                  >
                    {providerPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedProvider ? (
                  <>
                    <label>
                      名称
                      <input
                        value={selectedProvider.name}
                        onChange={(event) =>
                          updateProvider(selectedProvider.id, {
                            name: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      接口类型
                      <select
                        value={selectedProvider.kind}
                        onChange={(event) =>
                          updateProvider(selectedProvider.id, {
                            kind: event.target.value as ProviderConfig['kind'],
                          })
                        }
                      >
                        <option value="openai-compatible">OpenAI 兼容</option>
                        <option value="openai-responses">OpenAI Responses</option>
                        <option value="anthropic">Anthropic</option>
                      </select>
                    </label>
                    <label>
                      Base URL
                      <input
                        value={selectedProvider.baseUrl}
                        onChange={(event) =>
                          updateProvider(selectedProvider.id, {
                            baseUrl: event.target.value,
                          })
                        }
                        placeholder="https://api.example.com/v1"
                      />
                    </label>
                    <label className="inline-check">
                      <input
                        type="checkbox"
                        checked={selectedProvider.needsApiKey}
                        onChange={(event) =>
                          updateProvider(selectedProvider.id, {
                            needsApiKey: event.target.checked,
                          })
                        }
                      />
                      <span>需要服务商密钥</span>
                    </label>
                    <label>
                      服务商密钥
                      <input
                        type="password"
                        value={providerKeys[selectedProvider.id] ?? ''}
                        onChange={(event) =>
                          updateProviderKey(
                            selectedProvider.id,
                            event.target.value,
                          )
                        }
                        placeholder={
                          selectedProvider.needsApiKey ? 'sk-...' : '可留空'
                        }
                      />
                    </label>
                    <label>
                      默认模型
                      <div className="model-picker">
                        <div className="model-row">
                          <input
                            value={selectedProvider.model}
                            onChange={(event) =>
                              updateProvider(selectedProvider.id, {
                                model: event.target.value,
                              })
                            }
                            placeholder="可手填，也可从服务商获取"
                          />
                          <button
                            className="icon-button"
                            type="button"
                            title="从服务商获取模型"
                            onClick={() =>
                              void refreshProviderModels(selectedProvider.id, {
                                useAsProviderModel: true,
                              })
                            }
                            disabled={Boolean(loadingModelsProviderId)}
                          >
                            <RefreshCw
                              size={16}
                              className={
                                loadingModelsProviderId === selectedProvider.id
                                  ? 'spin'
                                  : ''
                              }
                            />
                          </button>
                        </div>
                        {selectedProviderModels.length > 0 ? (
                          <select
                            value={
                              selectedProviderModels.includes(
                                selectedProvider.model,
                              )
                                ? selectedProvider.model
                                : ''
                            }
                            onChange={(event) =>
                              updateProvider(selectedProvider.id, {
                                model: event.target.value,
                              })
                            }
                            aria-label="选择已获取的默认模型"
                          >
                            <option value="">选择模型</option>
                            {selectedProviderModels.map((model) => (
                              <option key={model} value={model}>
                                {model}
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </div>
                    </label>
                  </>
                ) : null}
              </div>

              <div className="form-stack">
                <div className="mode-grid">
                  <button
                    type="button"
                    className={data.sync.mode === 'local' ? 'active' : ''}
                    onClick={() => changeSyncMode('local')}
                  >
                    <HardDrive size={18} />
                    本地
                  </button>
                  <button
                    type="button"
                    className={data.sync.mode === 'gist' ? 'active' : ''}
                    onClick={() => changeSyncMode('gist')}
                  >
                    <GitBranch size={18} />
                    Gist
                  </button>
                  <button
                    type="button"
                    className={data.sync.mode === 'cloudflare' ? 'active' : ''}
                    onClick={() => changeSyncMode('cloudflare')}
                  >
                    <Cloud size={18} />
                    Worker
                  </button>
                </div>
                <p className="settings-note">
                  本地模式不需要账号；Gist 和 Worker 配置在设置里补齐即可同步。
                </p>
              </div>
            </div>

            {guideRequirement ? (
              <p className="settings-note guide-requirement">{guideRequirement}</p>
            ) : null}

            {notice ? <div className="notice modal-notice">{notice}</div> : null}

            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => finishGuide(true)}>
                跳过，先本地使用
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => finishGuide()}
                disabled={!guideCanFinish}
              >
                <Check size={16} />
                完成
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}

export default App
