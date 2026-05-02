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
import { streamChat } from './services/chat'
import { decryptVault, encryptVault, isEncryptedSnapshot } from './services/crypto'
import { performSync } from './services/sync'
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
  getGithubToken,
  getProviderKey,
  getProviderProxyToken,
  getSyncPassphrase,
  getWorkerToken,
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
  ProviderConfig,
  SyncMode,
  ThemeMode,
} from './types'

type SettingsTab = 'providers' | 'sync' | 'data'

function now(): number {
  return Date.now()
}

function cleanTitle(text: string): string {
  const title = text.replace(/\s+/g, ' ').trim()
  return title.length > 28 ? `${title.slice(0, 28)}...` : title || '新对话'
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('providers')
  const [guideOpen, setGuideOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [notice, setNotice] = useState('')
  const [loadError, setLoadError] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const dataRef = useRef<AppData | null>(null)

  useEffect(() => {
    let mounted = true

    loadAppData()
      .then((stored) => {
        if (!mounted) {
          return
        }

        const initial = stored ?? createDefaultData()
        setData(initial)
        setSelectedProviderId(initial.providers[0]?.id ?? '')
        setProviderKeys(
          Object.fromEntries(
            initial.providers.map((provider) => [
              provider.id,
              getProviderKey(provider.id),
            ]),
          ),
        )
        setProviderProxyTokens(
          Object.fromEntries(
            initial.providers.map((provider) => [
              provider.id,
              getProviderProxyToken(provider.id),
            ]),
          ),
        )
        setGithubTokenValue(getGithubToken())
        setWorkerTokenValue(getWorkerToken())
        setSyncPassphraseValue(getSyncPassphrase())
      })
      .catch((error: unknown) => {
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

  function updateData(updater: (current: AppData) => AppData): void {
    setData((current) => {
      if (!current) {
        return current
      }

      const next = updater(current)
      dataRef.current = next
      return next
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

  function deleteConversation(conversationId: string): void {
    if (!data) {
      return
    }

    const remaining = data.conversations.filter(
      (conversation) => conversation.id !== conversationId,
    )
    const fallbackProvider = data.providers[0]
    const nextConversations =
      remaining.length > 0
        ? remaining
        : [createConversation(fallbackProvider.id, fallbackProvider.model)]
    const nextActive = nextConversations[0].id

    updateData((current) =>
      bump({
        ...current,
        conversations: nextConversations,
        preferences: {
          ...current.preferences,
          activeConversationId: nextActive,
        },
      }),
    )
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

  function addProviderFromSelectedPreset(): void {
    const preset =
      providerPresets.find((item) => item.id === selectedPresetId) ??
      providerPresets[0]
    const provider = providerFromPreset(preset)

    updateData((current) =>
      bump({
        ...current,
        providers: [...current.providers, provider],
      }),
    )
    setSelectedProviderId(provider.id)
  }

  function removeProvider(providerId: string): void {
    if (!data || data.providers.length <= 1) {
      setNotice('至少保留一个服务商')
      return
    }

    const fallback = data.providers.find((provider) => provider.id !== providerId)

    if (!fallback) {
      return
    }

    updateData((current) =>
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
      return next
    })
    setSelectedProviderId(fallback.id)
  }

  function updateProviderKey(providerId: string, value: string): void {
    setProviderKeys((current) => ({
      ...current,
      [providerId]: value,
    }))
    setProviderKey(providerId, value)
    updateData((current) => bump(current))
  }

  function updateProviderProxyToken(providerId: string, value: string): void {
    setProviderProxyTokens((current) => ({
      ...current,
      [providerId]: value,
    }))
    setProviderProxyToken(providerId, value)
    updateData((current) => bump(current))
  }

  function applySyncedSecrets(
    keys: Record<string, string>,
    proxyTokens: Record<string, string>,
  ): void {
    clearProviderSecrets()
    setProviderKeys(keys)
    setProviderProxyTokens(proxyTokens)

    for (const [providerId, value] of Object.entries(keys)) {
      setProviderKey(providerId, value)
    }

    for (const [providerId, value] of Object.entries(proxyTokens)) {
      setProviderProxyToken(providerId, value)
    }
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

  async function runSync(snapshot?: AppData): Promise<void> {
    const current = snapshot ?? dataRef.current

    if (!current) {
      return
    }

    setSyncing(true)
    setNotice('')

    try {
      const result = await performSync(current, {
        encryptionPassphrase: syncPassphraseValue,
        providerKeys,
        providerProxyTokens,
      })
      dataRef.current = result.data
      setData(result.data)

      if (result.secrets?.providerKeys) {
        applySyncedSecrets(
          result.secrets.providerKeys,
          result.secrets.providerProxyTokens ?? {},
        )
      }

      setNotice(result.message)
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setSyncing(false)
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

    updateData((current) =>
      updateConversation(current, activeConversation.id, (conversation) => ({
        ...conversation,
        title,
        model,
        messages: [...conversation.messages, userMessage, assistantMessage],
      })),
    )

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
      if (snapshot?.sync.autoSync && snapshot.sync.mode !== 'local') {
        await runSync(snapshot)
      }
    } catch (error: unknown) {
      const isAbort =
        error instanceof DOMException && error.name === 'AbortError'
      const message = isAbort
        ? '已停止生成'
        : error instanceof Error
          ? error.message
          : String(error)

      updateData((current) =>
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
      setNotice(message)
    } finally {
      abortRef.current = null
      setSending(false)
    }
  }

  function stopGeneration(): void {
    abortRef.current?.abort()
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendMessage()
    }
  }

  function finishGuide(localOnly = false): void {
    updateData((current) =>
      bump({
        ...current,
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
      }),
    )
    setGuideOpen(false)
  }

  function changeSyncMode(mode: SyncMode): void {
    updateData((current) =>
      bump({
        ...current,
        sync: {
          ...current.sync,
          mode,
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

      setData({
        ...vault.data,
        updatedAt: now(),
      })
      setSelectedProviderId(vault.data.providers[0]?.id ?? '')
      applySyncedSecrets(
        vault.secrets?.providerKeys ?? {},
        vault.secrets?.providerProxyTokens ?? {},
      )
      setNotice('已导入加密备份')
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      event.target.value = ''
    }
  }

  async function resetLocalData(): Promise<void> {
    if (!window.confirm('确定要清空本机聊天记录、配置和本机密钥吗？')) {
      return
    }

    await clearAppData()
    clearZeroChatSecrets()
    const fresh = createDefaultData()
    setData(fresh)
    setSelectedProviderId(fresh.providers[0].id)
    setProviderKeys({})
    setProviderProxyTokens({})
    setGithubTokenValue('')
    setWorkerTokenValue('')
    setSyncPassphraseValue('')
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
            onClick={() => setSettingsOpen(true)}
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
              {activeConversation.model ? ` / ${activeConversation.model}` : ''}
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
            <input
              value={activeConversation.model}
              onChange={(event) => updateConversationModel(event.target.value)}
              placeholder="模型名称"
              aria-label="模型名称"
            />
            <button
              className="icon-button"
              type="button"
              title="删除当前对话"
              onClick={() => deleteConversation(activeConversation.id)}
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
              <p>选择服务商、填写模型名称和 API Key 后即可发送。</p>
            </div>
          ) : (
            activeConversation.messages.map((message) => (
              <article className={assistantMessageClass(message)} key={message.id}>
                <div className="avatar">
                  {message.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                </div>
                <div className="message-body">
                  <div className="message-meta">
                    <strong>{message.role === 'user' ? '你' : 'AI'}</strong>
                    {message.status === 'streaming' ? <span>生成中</span> : null}
                    {message.error ? <span>{message.error}</span> : null}
                  </div>
                  <p>{message.content || '...'}</p>
                </div>
              </article>
            ))
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
                <p>密钥只保存在当前设备。</p>
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
                      <small>{provider.kind}</small>
                    </button>
                  ))}
                  <div className="add-provider">
                    <select
                      value={selectedPresetId}
                      onChange={(event) => setSelectedPresetId(event.target.value)}
                      aria-label="选择预设"
                    >
                      {providerPresets.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={addProviderFromSelectedPreset}
                    >
                      <MessageSquarePlus size={16} />
                      添加
                    </button>
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
                    默认模型
                    <input
                      value={selectedProvider.model}
                      onChange={(event) =>
                        updateProvider(selectedProvider.id, {
                          model: event.target.value,
                        })
                      }
                      placeholder="按平台控制台填写"
                    />
                  </label>
                  <label>
                    API Key
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
                    发送时要求 API Key
                  </label>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => removeProvider(selectedProvider.id)}
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
                      setSyncPassphrase(event.target.value)
                    }}
                    placeholder="用于端到端加密和解密同步数据"
                  />
                </label>
                <p className="settings-note">
                  聊天、设置和 AI API Key 会先在本机加密，再上传到 Gist 或 Cloudflare。
                </p>

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
                          setGithubToken(event.target.value)
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
                          setWorkerToken(event.target.value)
                        }}
                      />
                    </label>
                  </>
                ) : null}

                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={data.sync.autoSync}
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
                  回复完成后自动同步
                </label>

                <button
                  className="primary-button"
                  type="button"
                  onClick={() => runSync()}
                  disabled={syncing}
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
                  onClick={() => setGuideOpen(true)}
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
                    onChange={(event) => setSelectedPresetId(event.target.value)}
                  >
                    {providerPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={addProviderFromSelectedPreset}
                >
                  <Check size={16} />
                  使用这个预设
                </button>
                {selectedProvider ? (
                  <>
                    <label>
                      默认模型
                      <input
                        value={selectedProvider.model}
                        onChange={(event) =>
                          updateProvider(selectedProvider.id, {
                            model: event.target.value,
                          })
                        }
                        placeholder="按平台控制台填写"
                      />
                    </label>
                    <label>
                      API Key
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

            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => finishGuide(true)}>
                跳过，先本地使用
              </button>
              <button className="primary-button" type="button" onClick={() => finishGuide()}>
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
