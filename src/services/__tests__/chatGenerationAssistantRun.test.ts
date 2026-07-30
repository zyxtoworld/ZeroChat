import { describe, expect, it, vi } from 'vitest'

import { providerFromPreset, providerPresets } from '../../data/presets'
import type { Translator } from '../../i18n'
import type {
  AppData,
  ChatMessage,
  Conversation,
  ProviderConfig,
} from '../../types'
import { defaultSkillSettings } from '../appData'
import {
  reportAssistantRunNotice,
  runImageAssistantGeneration,
  runTextAssistantGeneration,
} from '../chatGenerationAssistantRun'
import type { StreamAssistantTextOptions } from '../chatGenerationTextStream'
import type { LocalSaveCommitPrecondition } from '../localSaveQueueController'

const t: Translator = (key, values) =>
  values && typeof values === 'object'
    ? `${key}:${JSON.stringify(values)}`
    : key

function provider(id = 'provider-1'): ProviderConfig {
  return {
    ...providerFromPreset(providerPresets[0]),
    id,
  }
}

function conversation(messages: ChatMessage[]): Conversation {
  return {
    id: 'conversation-1',
    title: 'Chat',
    providerId: 'provider-1',
    model: 'chat-model',
    messages,
    createdAt: 1,
    updatedAt: 1,
  }
}

function appData(conversations: Conversation[]): AppData {
  return {
    version: 1,
    providers: [provider()],
    conversations,
    skills: [],
    skillSettings: defaultSkillSettings(),
    sync: {
      mode: 'local',
      autoSync: false,
      encryptionEnabled: true,
    },
    preferences: {
      firstRunDone: true,
      theme: 'system',
      language: 'system',
      compactMode: false,
    },
    updatedAt: 1,
  }
}

function streamingAssistant(): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    createdAt: 2,
    status: 'streaming',
  }
}

function updaterFor(stateRef: { current: AppData | null }) {
  return vi.fn((
    updater: (current: AppData) => AppData,
    _options?: { autoSync?: boolean },
  ) => {
    void _options

    if (!stateRef.current) {
      return null
    }

    stateRef.current = updater(stateRef.current)
    return stateRef.current
  })
}

async function commitPublishedLocalSnapshot(snapshot: AppData): Promise<void> {
  void snapshot
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, reject, resolve }
}

function expectAssistantTerminalSingleQueue(
  updateData: ReturnType<typeof updaterFor>,
): void {
  expect(updateData).toHaveBeenLastCalledWith(
    expect.any(Function),
    { autoSync: false },
  )
}

describe('chat generation assistant run helpers', () => {
  it('contains assistant-run notice reporter failures', () => {
    const setNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })

    expect(() =>
      reportAssistantRunNotice(
        setNotice,
        () => 'notice.messageSaveUnavailable',
        'error',
        'message',
        'assistant-1',
      ),
    ).not.toThrow()

    expect(setNotice).toHaveBeenCalledWith(
      'notice.messageSaveUnavailable',
      'error',
      'message',
      'assistant-1',
    )
  })

  it('streams text tokens into a terminal assistant message before scheduling sync', async () => {
    const stateRef = {
      current: appData([
        conversation([
          {
            id: 'user-1',
            role: 'user',
            content: 'Hello',
            createdAt: 1,
            status: 'done',
          },
          streamingAssistant(),
        ]),
      ]),
    }
    const updateData = updaterFor(stateRef)
    const streamedContent: string[] = []
    const notices: string[] = []
    const syncedSnapshots: AppData[] = []
    const retryOptions: unknown[] = []
    const streamAssistantText = vi.fn(
      async (options: StreamAssistantTextOptions) => {
        expect(options.latestInput).toBe('Hello')
        expect(options.contextMessageLimit).toBe(8)
        options.onToken('Hi ')
        options.onToken('there')
      },
    )

    await runTextAssistantGeneration({
      abortRef: { current: null },
      apiKey: 'sk-test',
      assistantId: 'assistant-1',
      baseMessages: stateRef.current.conversations[0].messages.slice(0, 1),
      contextMessageLimit: 8,
      conversationId: 'conversation-1',
      commitPublishedLocalSnapshot,
      dataRef: stateRef,
      errorMessage: (error) => String(error),
      flushStreamingAssistantContent: (_conversationId, _messageId, content) =>
        streamedContent.push(content),
      latestInput: 'Hello',
      model: 'chat-model',
      provider: provider(),
      proxyToken: '',
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation, options) => {
        retryOptions.push(options)
        return operation()
      },
      scheduleAutoSync: (snapshot) => syncedSnapshots.push(snapshot),
      setNotice: (message) => notices.push(message),
      stoppedContent: 'Stopped',
      t,
      streamAssistantText,
      updateData,
    })

    expect(streamedContent).toEqual(['Hi ', 'Hi there'])
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      content: 'Hi there',
      status: 'done',
    })
    expect(notices).toEqual([''])
    expect(retryOptions).toHaveLength(1)
    expect(syncedSnapshots).toHaveLength(1)
    expectAssistantTerminalSingleQueue(updateData)
  })

  it('contains terminal sync scheduler failures after a durable assistant commit', async () => {
    const stateRef = {
      current: appData([
        conversation([
          {
            id: 'user-1',
            role: 'user',
            content: 'Hello',
            createdAt: 1,
            status: 'done',
          },
          streamingAssistant(),
        ]),
      ]),
    }
    const commitSnapshot = vi.fn(commitPublishedLocalSnapshot)
    const scheduleAutoSync = vi.fn(() => {
      throw new Error('sync scheduler unavailable')
    })
    const setNotice = vi.fn()
    const updateData = updaterFor(stateRef)

    await expect(
      runTextAssistantGeneration({
        abortRef: { current: null },
        apiKey: 'sk-test',
        assistantId: 'assistant-1',
        baseMessages: stateRef.current.conversations[0].messages.slice(0, 1),
        commitPublishedLocalSnapshot: commitSnapshot,
        contextMessageLimit: 8,
        conversationId: 'conversation-1',
        dataRef: stateRef,
        errorMessage: (error) => String(error),
        flushStreamingAssistantContent: vi.fn(),
        latestInput: 'Hello',
        model: 'chat-model',
        provider: provider(),
        proxyToken: '',
        resetAssistantForRetry: vi.fn(),
        runGenerationWithAutoRetry: async (operation) => operation(),
        scheduleAutoSync,
        setNotice,
        stoppedContent: 'Stopped',
        streamAssistantText: async (options) => options.onToken('saved answer'),
        t,
        updateData,
      }),
    ).resolves.toBeUndefined()

    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      content: 'saved answer',
      status: 'done',
    })
    expect(commitSnapshot).toHaveBeenCalledTimes(1)
    expect(scheduleAutoSync).toHaveBeenCalledTimes(1)
    expect(setNotice).toHaveBeenCalledWith('')
  })

  it('waits for a completed text assistant turn to persist before clearing notice or scheduling sync', async () => {
    const stateRef = {
      current: appData([
        conversation([
          {
            id: 'user-1',
            role: 'user',
            content: 'Hello',
            createdAt: 1,
            status: 'done',
          },
          streamingAssistant(),
        ]),
      ]),
    }
    const persistence = deferred<void>()
    const commitSnapshot = vi.fn(() => persistence.promise)
    const scheduleAutoSync = vi.fn()
    const setNotice = vi.fn()
    const updateData = updaterFor(stateRef)

    const pending = runTextAssistantGeneration({
      abortRef: { current: null },
      apiKey: 'sk-test',
      assistantId: 'assistant-1',
      baseMessages: stateRef.current.conversations[0].messages.slice(0, 1),
      commitPublishedLocalSnapshot: commitSnapshot,
      contextMessageLimit: 8,
      conversationId: 'conversation-1',
      dataRef: stateRef,
      errorMessage: (error) => String(error),
      flushStreamingAssistantContent: vi.fn(),
      latestInput: 'Hello',
      model: 'chat-model',
      provider: provider(),
      proxyToken: '',
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync,
      setNotice,
      stoppedContent: 'Stopped',
      streamAssistantText: async (options) => options.onToken('durable answer'),
      t,
      updateData,
    })

    await vi.waitFor(() => expect(commitSnapshot).toHaveBeenCalledTimes(1))
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      content: 'durable answer',
      status: 'done',
    })
    expect(scheduleAutoSync).not.toHaveBeenCalled()
    expect(setNotice).not.toHaveBeenCalled()

    persistence.resolve()
    await pending

    expect(scheduleAutoSync).toHaveBeenCalledWith(stateRef.current, 0)
    expect(setNotice).toHaveBeenCalledWith('')
  })

  it('keeps completed text visible and unsynced when its terminal commit fails', async () => {
    const stateRef = {
      current: appData([
        conversation([
          {
            id: 'user-1',
            role: 'user',
            content: 'Hello',
            createdAt: 1,
            status: 'done',
          },
          streamingAssistant(),
        ]),
      ]),
    }
    const scheduleAutoSync = vi.fn()
    const setNotice = vi.fn()

    await runTextAssistantGeneration({
      abortRef: { current: null },
      apiKey: 'sk-test',
      assistantId: 'assistant-1',
      baseMessages: stateRef.current.conversations[0].messages.slice(0, 1),
      commitPublishedLocalSnapshot: vi.fn(async () => {
        throw new Error('stale revision')
      }),
      contextMessageLimit: 8,
      conversationId: 'conversation-1',
      dataRef: stateRef,
      errorMessage: (error) => String(error),
      flushStreamingAssistantContent: vi.fn(),
      latestInput: 'Hello',
      model: 'chat-model',
      provider: provider(),
      proxyToken: '',
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync,
      setNotice,
      stoppedContent: 'Stopped',
      streamAssistantText: async (options) => options.onToken('keep this'),
      t,
      updateData: updaterFor(stateRef),
    })

    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      content: 'keep this',
      status: 'done',
    })
    expect(scheduleAutoSync).not.toHaveBeenCalled()
    expect(setNotice).toHaveBeenCalledWith(
      'notice.messageSaveUnavailable',
      'error',
      'message',
      'assistant-1',
    )
  })

  it('contains text terminal clear-notice reporter failures after saving and scheduling sync', async () => {
    const stateRef = {
      current: appData([
        conversation([
          {
            id: 'user-1',
            role: 'user',
            content: 'Hello',
            createdAt: 1,
            status: 'done',
          },
          streamingAssistant(),
        ]),
      ]),
    }
    const abortRef = { current: null as AbortController | null }
    const updateData = updaterFor(stateRef)
    const scheduleAutoSync = vi.fn()
    const setNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })

    await expect(
      runTextAssistantGeneration({
        abortRef,
        apiKey: 'sk-test',
        assistantId: 'assistant-1',
        baseMessages: stateRef.current.conversations[0].messages.slice(0, 1),
        contextMessageLimit: 8,
        conversationId: 'conversation-1',
        commitPublishedLocalSnapshot,
        dataRef: stateRef,
        errorMessage: (error) => String(error),
        flushStreamingAssistantContent: vi.fn(),
        latestInput: 'Hello',
        model: 'chat-model',
        provider: provider(),
        proxyToken: '',
        resetAssistantForRetry: vi.fn(),
        runGenerationWithAutoRetry: async (operation) => operation(),
        scheduleAutoSync,
        setNotice,
        stoppedContent: 'Stopped',
        streamAssistantText: async (options) => options.onToken('done'),
        t,
        updateData,
      }),
    ).resolves.toBeUndefined()

    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      content: 'done',
      status: 'done',
    })
    expect(setNotice).toHaveBeenCalledWith('')
    expect(scheduleAutoSync).toHaveBeenCalledWith(stateRef.current, 0)
    expect(abortRef.current).toBeNull()
  })

  it('surfaces text terminal save failures before scheduling sync', async () => {
    const stateRef = {
      current: appData([
        conversation([
          {
            id: 'user-1',
            role: 'user',
            content: 'Hello',
            createdAt: 1,
            status: 'done',
          },
          streamingAssistant(),
        ]),
      ]),
    }
    const abortRef = { current: null as AbortController | null }
    const notices: string[] = []
    const syncedSnapshots: AppData[] = []
    const updateData = vi.fn((updater: (current: AppData) => AppData) => {
      void updater
      return null
    })

    await runTextAssistantGeneration({
      abortRef,
      apiKey: 'sk-test',
      assistantId: 'assistant-1',
      baseMessages: stateRef.current.conversations[0].messages.slice(0, 1),
      contextMessageLimit: 8,
      conversationId: 'conversation-1',
      commitPublishedLocalSnapshot,
      dataRef: stateRef,
      errorMessage: (error) => String(error),
      flushStreamingAssistantContent: vi.fn(),
      latestInput: 'Hello',
      model: 'chat-model',
      provider: provider(),
      proxyToken: '',
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync: (snapshot) => syncedSnapshots.push(snapshot),
      setNotice: (message, tone, target, anchorId) =>
        notices.push(`${message}|${tone ?? ''}|${target ?? ''}|${anchorId ?? ''}`),
      stoppedContent: 'Stopped',
      streamAssistantText: async (options) => options.onToken('done'),
      t,
      updateData,
    })

    expect(updateData).toHaveBeenCalledTimes(1)
    expect(updateData).toHaveBeenCalledWith(
      expect.any(Function),
      { autoSync: false },
    )
    expect(notices).toEqual([
      'notice.messageSaveUnavailable|error|message|assistant-1',
    ])
    expect(syncedSnapshots).toEqual([])
    expect(abortRef.current).toBeNull()
  })

  it('contains text terminal save-failure notice reporter failures without scheduling sync', async () => {
    const stateRef = {
      current: appData([
        conversation([
          {
            id: 'user-1',
            role: 'user',
            content: 'Hello',
            createdAt: 1,
            status: 'done',
          },
          streamingAssistant(),
        ]),
      ]),
    }
    const scheduleAutoSync = vi.fn()
    const updateData = vi.fn((updater: (current: AppData) => AppData) => {
      void updater
      return null
    })
    const setNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })

    await expect(
      runTextAssistantGeneration({
        abortRef: { current: null },
        apiKey: 'sk-test',
        assistantId: 'assistant-1',
        baseMessages: stateRef.current.conversations[0].messages.slice(0, 1),
        contextMessageLimit: 8,
        conversationId: 'conversation-1',
        commitPublishedLocalSnapshot,
        dataRef: stateRef,
        errorMessage: (error) => String(error),
        flushStreamingAssistantContent: vi.fn(),
        latestInput: 'Hello',
        model: 'chat-model',
        provider: provider(),
        proxyToken: '',
        resetAssistantForRetry: vi.fn(),
        runGenerationWithAutoRetry: async (operation) => operation(),
        scheduleAutoSync,
        setNotice,
        stoppedContent: 'Stopped',
        streamAssistantText: async (options) => options.onToken('done'),
        t,
        updateData,
      }),
    ).resolves.toBeUndefined()

    expect(setNotice).toHaveBeenCalledWith(
      'notice.messageSaveUnavailable',
      'error',
      'message',
      'assistant-1',
    )
    expect(scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('preserves partial text when a streamed assistant run fails', async () => {
    const stateRef = {
      current: appData([
        conversation([
          {
            id: 'user-1',
            role: 'user',
            content: 'Hello',
            createdAt: 1,
            status: 'done',
          },
          streamingAssistant(),
        ]),
      ]),
    }
    const updateData = updaterFor(stateRef)
    const syncedSnapshots: AppData[] = []
    const streamAssistantText = vi.fn(
      async (options: StreamAssistantTextOptions) => {
        options.onToken('partial')
        throw new Error('network down')
      },
    )

    await runTextAssistantGeneration({
      abortRef: { current: null },
      apiKey: 'sk-test',
      assistantId: 'assistant-1',
      baseMessages: stateRef.current.conversations[0].messages.slice(0, 1),
      contextMessageLimit: 8,
      conversationId: 'conversation-1',
      commitPublishedLocalSnapshot,
      dataRef: stateRef,
      errorMessage: (error) =>
        error instanceof Error ? error.message : String(error),
      flushStreamingAssistantContent: vi.fn(),
      latestInput: 'Hello',
      model: 'chat-model',
      provider: provider(),
      proxyToken: '',
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync: (snapshot) => syncedSnapshots.push(snapshot),
      setNotice: vi.fn(),
      stoppedContent: 'Stopped',
      t,
      streamAssistantText,
      updateData,
    })

    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      content: 'partial',
      status: 'error',
      error: 'network down',
    })
    expect(syncedSnapshots).toHaveLength(1)
    expectAssistantTerminalSingleQueue(updateData)
  })

  it('waits for a failed text assistant turn to persist before clearing notice or scheduling sync', async () => {
    const stateRef = {
      current: appData([
        conversation([
          {
            id: 'user-1',
            role: 'user',
            content: 'Hello',
            createdAt: 1,
            status: 'done',
          },
          streamingAssistant(),
        ]),
      ]),
    }
    const persistence = deferred<void>()
    const commitSnapshot = vi.fn(() => persistence.promise)
    const scheduleAutoSync = vi.fn()
    const setNotice = vi.fn()

    const pending = runTextAssistantGeneration({
      abortRef: { current: null },
      apiKey: 'sk-test',
      assistantId: 'assistant-1',
      baseMessages: stateRef.current.conversations[0].messages.slice(0, 1),
      commitPublishedLocalSnapshot: commitSnapshot,
      contextMessageLimit: 8,
      conversationId: 'conversation-1',
      dataRef: stateRef,
      errorMessage: (error) =>
        error instanceof Error ? error.message : String(error),
      flushStreamingAssistantContent: vi.fn(),
      latestInput: 'Hello',
      model: 'chat-model',
      provider: provider(),
      proxyToken: '',
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync,
      setNotice,
      stoppedContent: 'Stopped',
      streamAssistantText: async (options) => {
        options.onToken('partial')
        throw new Error('network down')
      },
      t,
      updateData: updaterFor(stateRef),
    })

    await vi.waitFor(() => expect(commitSnapshot).toHaveBeenCalledTimes(1))
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      content: 'partial',
      error: 'network down',
      status: 'error',
    })
    expect(scheduleAutoSync).not.toHaveBeenCalled()
    expect(setNotice).not.toHaveBeenCalled()

    persistence.resolve()
    await pending

    expect(scheduleAutoSync).toHaveBeenCalledWith(stateRef.current, 0)
    expect(setNotice).toHaveBeenCalledWith('')
  })

  it('contains failed-stream clear-notice reporter failures after patching assistant', async () => {
    const stateRef = {
      current: appData([
        conversation([
          {
            id: 'user-1',
            role: 'user',
            content: 'Hello',
            createdAt: 1,
            status: 'done',
          },
          streamingAssistant(),
        ]),
      ]),
    }
    const updateData = updaterFor(stateRef)
    const scheduleAutoSync = vi.fn()
    const setNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })

    await expect(
      runTextAssistantGeneration({
        abortRef: { current: null },
        apiKey: 'sk-test',
        assistantId: 'assistant-1',
        baseMessages: stateRef.current.conversations[0].messages.slice(0, 1),
        contextMessageLimit: 8,
        conversationId: 'conversation-1',
        commitPublishedLocalSnapshot,
        dataRef: stateRef,
        errorMessage: (error) =>
          error instanceof Error ? error.message : String(error),
        flushStreamingAssistantContent: vi.fn(),
        latestInput: 'Hello',
        model: 'chat-model',
        provider: provider(),
        proxyToken: '',
        resetAssistantForRetry: vi.fn(),
        runGenerationWithAutoRetry: async (operation) => operation(),
        scheduleAutoSync,
        setNotice,
        stoppedContent: 'Stopped',
        streamAssistantText: async (options) => {
          options.onToken('partial')
          throw new Error('network down')
        },
        t,
        updateData,
      }),
    ).resolves.toBeUndefined()

    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      content: 'partial',
      status: 'error',
      error: 'network down',
    })
    expect(setNotice).toHaveBeenCalledWith('')
    expect(scheduleAutoSync).toHaveBeenCalledWith(stateRef.current, 0)
  })

  it('surfaces failed-stream terminal save failures before clearing notice', async () => {
    const stateRef = {
      current: appData([
        conversation([
          {
            id: 'user-1',
            role: 'user',
            content: 'Hello',
            createdAt: 1,
            status: 'done',
          },
          streamingAssistant(),
        ]),
      ]),
    }
    const notices: string[] = []
    const syncedSnapshots: AppData[] = []
    const updateData = vi.fn((updater: (current: AppData) => AppData) => {
      void updater
      return null
    })

    await runTextAssistantGeneration({
      abortRef: { current: null },
      apiKey: 'sk-test',
      assistantId: 'assistant-1',
      baseMessages: stateRef.current.conversations[0].messages.slice(0, 1),
      contextMessageLimit: 8,
      conversationId: 'conversation-1',
      commitPublishedLocalSnapshot,
      dataRef: stateRef,
      errorMessage: (error) =>
        error instanceof Error ? error.message : String(error),
      flushStreamingAssistantContent: vi.fn(),
      latestInput: 'Hello',
      model: 'chat-model',
      provider: provider(),
      proxyToken: '',
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync: (snapshot) => syncedSnapshots.push(snapshot),
      setNotice: (message, tone, target, anchorId) =>
        notices.push(`${message}|${tone ?? ''}|${target ?? ''}|${anchorId ?? ''}`),
      stoppedContent: 'Stopped',
      streamAssistantText: async (options) => {
        options.onToken('partial')
        throw new Error('network down')
      },
      t,
      updateData,
    })

    expect(updateData).toHaveBeenCalledTimes(1)
    expect(updateData).toHaveBeenCalledWith(
      expect.any(Function),
      { autoSync: false },
    )
    expect(notices).toEqual([
      'notice.messageSaveUnavailable|error|message|assistant-1',
    ])
    expect(syncedSnapshots).toEqual([])
  })

  it('contains failed-stream save-failure notice reporter failures without scheduling sync', async () => {
    const stateRef = {
      current: appData([
        conversation([
          {
            id: 'user-1',
            role: 'user',
            content: 'Hello',
            createdAt: 1,
            status: 'done',
          },
          streamingAssistant(),
        ]),
      ]),
    }
    const scheduleAutoSync = vi.fn()
    const updateData = vi.fn((updater: (current: AppData) => AppData) => {
      void updater
      return null
    })
    const setNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })

    await expect(
      runTextAssistantGeneration({
        abortRef: { current: null },
        apiKey: 'sk-test',
        assistantId: 'assistant-1',
        baseMessages: stateRef.current.conversations[0].messages.slice(0, 1),
        contextMessageLimit: 8,
        conversationId: 'conversation-1',
        commitPublishedLocalSnapshot,
        dataRef: stateRef,
        errorMessage: (error) =>
          error instanceof Error ? error.message : String(error),
        flushStreamingAssistantContent: vi.fn(),
        latestInput: 'Hello',
        model: 'chat-model',
        provider: provider(),
        proxyToken: '',
        resetAssistantForRetry: vi.fn(),
        runGenerationWithAutoRetry: async (operation) => operation(),
        scheduleAutoSync,
        setNotice,
        stoppedContent: 'Stopped',
        streamAssistantText: async (options) => {
          options.onToken('partial')
          throw new Error('network down')
        },
        t,
        updateData,
      }),
    ).resolves.toBeUndefined()

    expect(setNotice).toHaveBeenCalledWith(
      'notice.messageSaveUnavailable',
      'error',
      'message',
      'assistant-1',
    )
    expect(scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('does not persist or sync a text completion after another tab deletes its message', async () => {
    const stateRef = {
      current: appData([
        conversation([
          {
            id: 'user-1',
            role: 'user',
            content: 'Hello',
            createdAt: 1,
            status: 'done',
          },
          streamingAssistant(),
        ]),
      ]),
    }
    const updateData = updaterFor(stateRef)
    const scheduleAutoSync = vi.fn()
    const commitSnapshot = vi.fn(
      async (
        snapshot: AppData,
        precondition?: LocalSaveCommitPrecondition,
      ) => {
        const remote = {
          ...snapshot,
          conversations: snapshot.conversations.map((item) => ({
            ...item,
            messages: item.messages.filter(
              (message) => message.id !== 'assistant-1',
            ),
            updatedAt: 100,
          })),
          updatedAt: 100,
        }
        stateRef.current = remote
        expect(precondition?.isSatisfied(remote)).toBe(false)
        precondition?.onOutcome?.(null)
      },
    )

    await runTextAssistantGeneration({
      abortRef: { current: null },
      apiKey: 'sk-test',
      assistantId: 'assistant-1',
      baseMessages: stateRef.current.conversations[0].messages.slice(0, 1),
      commitPublishedLocalSnapshot: commitSnapshot,
      contextMessageLimit: 8,
      conversationId: 'conversation-1',
      dataRef: stateRef,
      errorMessage: String,
      flushStreamingAssistantContent: vi.fn(),
      latestInput: 'Hello',
      model: 'chat-model',
      provider: provider(),
      proxyToken: '',
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: (operation) => operation(),
      scheduleAutoSync,
      setNotice: vi.fn(),
      stoppedContent: 'Stopped',
      streamAssistantText: async (options) => options.onToken('Late answer'),
      t,
      updateData,
    })

    expect(commitSnapshot).toHaveBeenCalledTimes(1)
    expect(
      stateRef.current.conversations[0].messages.some(
        (message) => message.id === 'assistant-1',
      ),
    ).toBe(false)
    expect(scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('does not overwrite a same-id assistant recreated in another tab', async () => {
    const stateRef = {
      current: appData([conversation([streamingAssistant()])]),
    }
    const scheduleAutoSync = vi.fn()
    const commitSnapshot = vi.fn(
      async (
        snapshot: AppData,
        precondition?: LocalSaveCommitPrecondition,
      ) => {
        const remote = {
          ...snapshot,
          conversations: snapshot.conversations.map((item) => ({
            ...item,
            messages: item.messages.map((message) => ({
              ...message,
              content: 'New incarnation',
              createdAt: 200,
              status: 'done' as const,
            })),
            updatedAt: 200,
          })),
          updatedAt: 200,
        }
        stateRef.current = remote
        expect(precondition?.isSatisfied(remote)).toBe(false)
        precondition?.onOutcome?.(null)
      },
    )

    await runTextAssistantGeneration({
      abortRef: { current: null },
      apiKey: 'sk-test',
      assistantId: 'assistant-1',
      baseMessages: [],
      commitPublishedLocalSnapshot: commitSnapshot,
      contextMessageLimit: 8,
      conversationId: 'conversation-1',
      dataRef: stateRef,
      errorMessage: String,
      flushStreamingAssistantContent: vi.fn(),
      latestInput: 'Hello',
      model: 'chat-model',
      provider: provider(),
      proxyToken: '',
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: (operation) => operation(),
      scheduleAutoSync,
      setNotice: vi.fn(),
      stoppedContent: 'Stopped',
      streamAssistantText: async (options) => options.onToken('Late answer'),
      t,
      updateData: updaterFor(stateRef),
    })

    expect(stateRef.current.conversations[0].messages[0]).toMatchObject({
      id: 'assistant-1',
      content: 'New incarnation',
      createdAt: 200,
    })
    expect(scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('does not persist or sync an image completion after another tab deletes its conversation', async () => {
    const stateRef = {
      current: appData([conversation([streamingAssistant()])]),
    }
    const scheduleAutoSync = vi.fn()
    const commitSnapshot = vi.fn(
      async (
        snapshot: AppData,
        precondition?: LocalSaveCommitPrecondition,
      ) => {
        const remote = {
          ...snapshot,
          conversations: [
            {
              ...conversation([]),
              id: 'conversation-fallback',
              createdAt: 300,
              updatedAt: 300,
            },
          ],
          updatedAt: 300,
        }
        stateRef.current = remote
        expect(precondition?.isSatisfied(remote)).toBe(false)
        precondition?.onOutcome?.(null)
      },
    )

    await runImageAssistantGeneration({
      abortRef: { current: null },
      apiKey: 'sk-test',
      assistantId: 'assistant-1',
      commitPublishedLocalSnapshot: commitSnapshot,
      conversationId: 'conversation-1',
      dataRef: stateRef,
      errorMessage: String,
      generateImage: async () => ({
        dataUrl: 'data:image/png;base64,AAA=',
        mimeType: 'image/png',
      }),
      model: 'image-model',
      prompt: 'Draw',
      provider: provider(),
      proxyToken: '',
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: (operation) => operation(),
      scheduleAutoSync,
      setNotice: vi.fn(),
      stoppedContent: 'Stopped',
      t,
      updateData: updaterFor(stateRef),
    })

    expect(stateRef.current.conversations).toHaveLength(1)
    expect(stateRef.current.conversations[0].id).toBe('conversation-fallback')
    expect(scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('writes generated image attachments as terminal assistant messages', async () => {
    const stateRef = {
      current: appData([
        conversation([
          {
            id: 'user-1',
            role: 'user',
            content: 'Draw a quiet workspace',
            createdAt: 1,
            status: 'done',
          },
          streamingAssistant(),
        ]),
      ]),
    }
    const updateData = updaterFor(stateRef)
    const syncedSnapshots: AppData[] = []
    const generateImage = vi.fn(async () => ({
      dataUrl: 'data:image/png;base64,AAA=',
      mimeType: 'image/png',
      revisedPrompt: 'A quiet workspace',
    }))

    await runImageAssistantGeneration({
      abortRef: { current: null },
      apiKey: 'sk-test',
      assistantId: 'assistant-1',
      conversationId: 'conversation-1',
      commitPublishedLocalSnapshot,
      dataRef: stateRef,
      errorMessage: (error) => String(error),
      generateImage,
      model: 'image-model',
      prompt: 'Draw a quiet workspace',
      provider: provider(),
      proxyToken: '',
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync: (snapshot) => syncedSnapshots.push(snapshot),
      setNotice: vi.fn(),
      stoppedContent: 'Stopped',
      t,
      updateData,
    })

    expect(generateImage).toHaveBeenCalledTimes(1)
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      content: '',
      status: 'done',
      attachments: [
        {
          kind: 'image',
          purpose: 'generated',
          alt: 'A quiet workspace',
          model: 'image-model',
        },
      ],
    })
    expect(syncedSnapshots).toHaveLength(1)
    expectAssistantTerminalSingleQueue(updateData)
  })

  it('waits for a generated image turn to persist before clearing notice or scheduling sync', async () => {
    const stateRef = {
      current: appData([
        conversation([
          {
            id: 'user-1',
            role: 'user',
            content: 'Draw a quiet workspace',
            createdAt: 1,
            status: 'done',
          },
          streamingAssistant(),
        ]),
      ]),
    }
    const persistence = deferred<void>()
    const commitSnapshot = vi.fn(() => persistence.promise)
    const scheduleAutoSync = vi.fn()
    const setNotice = vi.fn()

    const pending = runImageAssistantGeneration({
      abortRef: { current: null },
      apiKey: 'sk-test',
      assistantId: 'assistant-1',
      commitPublishedLocalSnapshot: commitSnapshot,
      conversationId: 'conversation-1',
      dataRef: stateRef,
      errorMessage: (error) => String(error),
      generateImage: vi.fn(async () => ({
        dataUrl: 'data:image/png;base64,AAA=',
        mimeType: 'image/png',
      })),
      model: 'image-model',
      prompt: 'Draw a quiet workspace',
      provider: provider(),
      proxyToken: '',
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync,
      setNotice,
      stoppedContent: 'Stopped',
      t,
      updateData: updaterFor(stateRef),
    })

    await vi.waitFor(() => expect(commitSnapshot).toHaveBeenCalledTimes(1))
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      status: 'done',
      attachments: [{ kind: 'image', purpose: 'generated' }],
    })
    expect(scheduleAutoSync).not.toHaveBeenCalled()
    expect(setNotice).not.toHaveBeenCalled()

    persistence.resolve()
    await pending

    expect(scheduleAutoSync).toHaveBeenCalledWith(stateRef.current, 0)
    expect(setNotice).toHaveBeenCalledWith('')
  })

  it('contains image terminal clear-notice reporter failures after saving and scheduling sync', async () => {
    const stateRef = {
      current: appData([
        conversation([
          {
            id: 'user-1',
            role: 'user',
            content: 'Draw a quiet workspace',
            createdAt: 1,
            status: 'done',
          },
          streamingAssistant(),
        ]),
      ]),
    }
    const updateData = updaterFor(stateRef)
    const scheduleAutoSync = vi.fn()
    const setNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })

    await expect(
      runImageAssistantGeneration({
        abortRef: { current: null },
        apiKey: 'sk-test',
        assistantId: 'assistant-1',
        conversationId: 'conversation-1',
        commitPublishedLocalSnapshot,
        dataRef: stateRef,
        errorMessage: (error) => String(error),
        generateImage: vi.fn(async () => ({
          dataUrl: 'data:image/png;base64,AAA=',
          mimeType: 'image/png',
        })),
        model: 'image-model',
        prompt: 'Draw a quiet workspace',
        provider: provider(),
        proxyToken: '',
        resetAssistantForRetry: vi.fn(),
        runGenerationWithAutoRetry: async (operation) => operation(),
        scheduleAutoSync,
        setNotice,
        stoppedContent: 'Stopped',
        t,
        updateData,
      }),
    ).resolves.toBeUndefined()

    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      content: '',
      status: 'done',
      attachments: [expect.objectContaining({ kind: 'image' })],
    })
    expect(setNotice).toHaveBeenCalledWith('')
    expect(scheduleAutoSync).toHaveBeenCalledWith(stateRef.current, 0)
  })

  it('surfaces image terminal save failures before scheduling sync', async () => {
    const stateRef = {
      current: appData([
        conversation([
          {
            id: 'user-1',
            role: 'user',
            content: 'Draw a quiet workspace',
            createdAt: 1,
            status: 'done',
          },
          streamingAssistant(),
        ]),
      ]),
    }
    const notices: string[] = []
    const syncedSnapshots: AppData[] = []
    const generateImage = vi.fn(async () => ({
      dataUrl: 'data:image/png;base64,AAA=',
      mimeType: 'image/png',
    }))
    const updateData = vi.fn((updater: (current: AppData) => AppData) => {
      void updater
      return null
    })

    await runImageAssistantGeneration({
      abortRef: { current: null },
      apiKey: 'sk-test',
      assistantId: 'assistant-1',
      conversationId: 'conversation-1',
      commitPublishedLocalSnapshot,
      dataRef: stateRef,
      errorMessage: (error) => String(error),
      generateImage,
      model: 'image-model',
      prompt: 'Draw a quiet workspace',
      provider: provider(),
      proxyToken: '',
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync: (snapshot) => syncedSnapshots.push(snapshot),
      setNotice: (message, tone, target, anchorId) =>
        notices.push(`${message}|${tone ?? ''}|${target ?? ''}|${anchorId ?? ''}`),
      stoppedContent: 'Stopped',
      t,
      updateData,
    })

    expect(generateImage).toHaveBeenCalledTimes(1)
    expect(updateData).toHaveBeenCalledTimes(1)
    expect(updateData).toHaveBeenCalledWith(
      expect.any(Function),
      { autoSync: false },
    )
    expect(notices).toEqual([
      'notice.messageSaveUnavailable|error|message|assistant-1',
    ])
    expect(syncedSnapshots).toEqual([])
  })

  it('contains image terminal save-failure notice reporter failures without scheduling sync', async () => {
    const stateRef = {
      current: appData([
        conversation([
          {
            id: 'user-1',
            role: 'user',
            content: 'Draw a quiet workspace',
            createdAt: 1,
            status: 'done',
          },
          streamingAssistant(),
        ]),
      ]),
    }
    const scheduleAutoSync = vi.fn()
    const setNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })
    const updateData = vi.fn((updater: (current: AppData) => AppData) => {
      void updater
      return null
    })

    await expect(
      runImageAssistantGeneration({
        abortRef: { current: null },
        apiKey: 'sk-test',
        assistantId: 'assistant-1',
        conversationId: 'conversation-1',
        commitPublishedLocalSnapshot,
        dataRef: stateRef,
        errorMessage: (error) => String(error),
        generateImage: vi.fn(async () => ({
          dataUrl: 'data:image/png;base64,AAA=',
          mimeType: 'image/png',
        })),
        model: 'image-model',
        prompt: 'Draw a quiet workspace',
        provider: provider(),
        proxyToken: '',
        resetAssistantForRetry: vi.fn(),
        runGenerationWithAutoRetry: async (operation) => operation(),
        scheduleAutoSync,
        setNotice,
        stoppedContent: 'Stopped',
        t,
        updateData,
      }),
    ).resolves.toBeUndefined()

    expect(setNotice).toHaveBeenCalledWith(
      'notice.messageSaveUnavailable',
      'error',
      'message',
      'assistant-1',
    )
    expect(scheduleAutoSync).not.toHaveBeenCalled()
  })
})
