import { describe, expect, it, vi } from 'vitest'

import { providerFromPreset, providerPresets } from '../../data/presets'
import type { Translator } from '../../i18n'
import type {
  AppData,
  ChatMessage,
  Conversation,
  MessageAttachment,
  ProviderConfig,
} from '../../types'
import { defaultSkillSettings } from '../appData'
import {
  runTextAssistantGeneration as completeTextAssistantGeneration,
  type RunImageAssistantGenerationOptions,
  type RunTextAssistantGenerationOptions,
} from '../chatGenerationAssistantRun'
import type { LocalSaveCommitPrecondition } from '../localSaveQueueController'
import {
  regenerateAssistantMessageGeneration,
  reportMessageRerunNotice,
  submitEditedUserMessageGeneration,
} from '../chatGenerationMessageReruns'

const t: Translator = (key, values) =>
  values && typeof values === 'object'
    ? `${key}:${JSON.stringify(values)}`
    : key

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    ...providerFromPreset(providerPresets[0]),
    id: 'provider-1',
    name: 'Provider One',
    model: 'chat-model',
    imageModel: 'image-model',
    ...patch,
  }
}

function conversation(messages: ChatMessage[]): Conversation {
  return {
    id: 'conversation-1',
    title: 'Original title',
    providerId: 'provider-1',
    model: 'chat-model',
    messages,
    createdAt: 1,
    updatedAt: 1,
  }
}

function appData(
  conversations: Conversation[],
  providers: ProviderConfig[] = [provider()],
): AppData {
  return {
    version: 1,
    providers,
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

function userMessage(id: string, content: string): ChatMessage {
  return {
    id,
    role: 'user',
    content,
    createdAt: 1,
    status: 'done',
  }
}

function assistantMessage(
  id: string,
  patch: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: 'Old answer',
    createdAt: 2,
    status: 'done',
    ...patch,
  }
}

function imageAttachment(
  id: string,
  purpose: MessageAttachment['purpose'],
  model?: string,
): MessageAttachment {
  return {
    id,
    kind: 'image',
    purpose,
    mimeType: 'image/png',
    dataUrl: 'data:image/png;base64,AA==',
    alt: id,
    model,
    createdAt: 3,
  }
}

function updaterFor(stateRef: { current: AppData | null }) {
  const options: Array<{ autoSync?: boolean } | undefined> = []
  const updateData = vi.fn(
    (
      updater: (current: AppData) => AppData,
      updateOptions?: { autoSync?: boolean },
    ) => {
      if (!stateRef.current) {
        return null
      }

      options.push(updateOptions)
      stateRef.current = updater(stateRef.current)
      return stateRef.current
    },
  )

  return { options, updateData }
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

function sharedRerunOptions({
  stateRef,
  activeProvider = provider(),
  notices = [],
  sendingEvents = [],
  clearedEditing = [],
}: {
  activeProvider?: ProviderConfig | null
  clearedEditing?: string[]
  notices?: string[]
  sendingEvents?: string[]
  stateRef: { current: AppData | null }
}) {
  const { options, updateData } = updaterFor(stateRef)

  return {
    abortRef: { current: null } as { current: AbortController | null },
    activeImageModel: 'fallback-image-model',
    activeModel: 'chat-model',
    activeProvider,
    accessKeyFromPassword: vi.fn(async () => 'proxy-token'),
    chatContextMessageLimit: 8,
    clearEditingMessage: () => clearedEditing.push('clear'),
    commitPublishedLocalSnapshot: vi.fn(async () => {}),
    dataRef: stateRef,
    errorMessage: (error: unknown) =>
      error instanceof Error ? error.message : String(error),
    finishSending: () => sendingEvents.push('finish'),
    flushStreamingAssistantContent: vi.fn(),
    options,
    providerKeysRef: {
      current: activeProvider ? { [activeProvider.id]: 'sk-test' } : {},
    },
    resetAssistantForRetry: vi.fn(),
    runGenerationWithAutoRetry: async <T>(operation: () => Promise<T>) =>
      operation(),
    scheduleAutoSync: vi.fn(),
    sending: false,
    setNotice: (message: string, tone?: string, target?: string, anchorId?: string) =>
      notices.push(`${message}|${tone ?? ''}|${target ?? ''}|${anchorId ?? ''}`),
    startSending: () => sendingEvents.push('start'),
    syncPassphraseRef: { current: 'sync-passphrase' },
    t,
    updateData,
  }
}

describe('chat generation message rerun helpers', () => {
  it('contains message rerun notice reporter failures', () => {
    const setNotice = vi.fn(() => {
      throw new Error('notice exploded')
    })

    expect(() =>
      reportMessageRerunNotice(
        setNotice,
        () => 'notice.messageGenerationFailed',
        'error',
        'message',
        'assistant-1',
      ),
    ).not.toThrow()
    expect(() =>
      reportMessageRerunNotice(setNotice, () => {
        throw new Error('translate exploded')
      }),
    ).not.toThrow()
    expect(setNotice).toHaveBeenCalledTimes(1)
  })

  it('reruns an edited text message with a fresh streaming assistant turn', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData(
        [
          conversation([
            userMessage('user-1', 'Old prompt'),
            assistantMessage('assistant-old'),
            userMessage('later-user', 'A later branch'),
          ]),
        ],
        [activeProvider],
      ),
    }
    const notices: string[] = []
    const sendingEvents: string[] = []
    const clearedEditing: string[] = []
    const runTextAssistantGeneration = vi.fn(
      async (options: RunTextAssistantGenerationOptions) => {
        void options
      },
    )
    const shared = sharedRerunOptions({
      activeProvider,
      clearedEditing,
      notices,
      sendingEvents,
      stateRef,
    })

    const handled = await submitEditedUserMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      editingContent: '  Updated prompt  ',
      editingMessageId: 'user-1',
      idFactory: () => 'assistant-new',
      nowMs: () => 42,
      runTextAssistantGeneration,
    })

    const messages = stateRef.current.conversations[0].messages
    const runOptions = runTextAssistantGeneration.mock.calls[0][0]

    expect(handled).toBe(true)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({
      id: 'user-1',
      content: 'Updated prompt',
      error: undefined,
      status: 'done',
    })
    expect(messages[1]).toMatchObject({
      id: 'assistant-new',
      content: '',
      createdAt: 42,
      status: 'streaming',
    })
    expect(runTextAssistantGeneration).toHaveBeenCalledTimes(1)
    expect(runOptions).toMatchObject({
      apiKey: 'sk-test',
      assistantId: 'assistant-new',
      contextMessageLimit: 8,
      latestInput: 'Updated prompt',
      model: 'chat-model',
      proxyToken: '',
    })
    expect(runOptions.controller).toBeInstanceOf(AbortController)
    expect(runOptions.baseMessages.map((message) => message.id)).toEqual(['user-1'])
    expect(clearedEditing).toEqual(['clear'])
    expect(sendingEvents).toEqual(['start', 'finish'])
    expect(shared.abortRef.current).toBeNull()
    expect(notices).toEqual(['|||'])
    expect(shared.options).toContainEqual({ autoSync: false })
  })

  it('waits for an edited rerun turn to persist before clearing editing or starting text generation', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData(
        [conversation([userMessage('user-1', 'Old prompt')])],
        [activeProvider],
      ),
    }
    const persistence = deferred<void>()
    const clearedEditing: string[] = []
    const runTextAssistantGeneration = vi.fn(async () => {})
    const shared = sharedRerunOptions({
      activeProvider,
      clearedEditing,
      stateRef,
    })
    shared.commitPublishedLocalSnapshot.mockImplementation(
      () => persistence.promise,
    )

    const pending = submitEditedUserMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      editingContent: 'Updated prompt',
      editingMessageId: 'user-1',
      idFactory: () => 'assistant-new',
      runTextAssistantGeneration,
    })

    await vi.waitFor(() =>
      expect(shared.commitPublishedLocalSnapshot).toHaveBeenCalledTimes(1),
    )
    expect(runTextAssistantGeneration).not.toHaveBeenCalled()
    expect(clearedEditing).toEqual([])
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      id: 'assistant-new',
      status: 'streaming',
    })

    persistence.resolve()
    await expect(pending).resolves.toBe(true)

    expect(runTextAssistantGeneration).toHaveBeenCalledTimes(1)
    expect(clearedEditing).toEqual(['clear'])
  })

  it('does not start an edited rerun when its durable turn commit fails', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData(
        [conversation([userMessage('user-1', 'Old prompt')])],
        [activeProvider],
      ),
    }
    const clearedEditing: string[] = []
    const runTextAssistantGeneration = vi.fn(async () => {})
    const shared = sharedRerunOptions({
      activeProvider,
      clearedEditing,
      stateRef,
    })
    shared.commitPublishedLocalSnapshot
      .mockRejectedValueOnce(new Error('stale revision'))
      .mockResolvedValueOnce(undefined)

    const handled = await submitEditedUserMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      editingContent: 'Updated prompt',
      editingMessageId: 'user-1',
      idFactory: () => 'assistant-new',
      runTextAssistantGeneration,
    })

    expect(handled).toBe(true)
    expect(runTextAssistantGeneration).not.toHaveBeenCalled()
    expect(clearedEditing).toEqual([])
    expect(shared.commitPublishedLocalSnapshot).toHaveBeenCalledTimes(2)
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      id: 'assistant-new',
      error: 'notice.messageSaveUnavailable',
      status: 'error',
    })
    expect(shared.scheduleAutoSync).toHaveBeenCalledWith(stateRef.current, 0)
  })

  it('reruns direct browser text messages without deriving a proxy access key', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData(
        [conversation([userMessage('user-1', 'Old prompt')])],
        [activeProvider],
      ),
    }
    const runTextAssistantGeneration = vi.fn(
      async (options: RunTextAssistantGenerationOptions) => {
        expect(options.proxyToken).toBe('')
      },
    )
    const shared = sharedRerunOptions({
      activeProvider,
      stateRef,
    })
    vi.mocked(shared.accessKeyFromPassword).mockRejectedValueOnce(
      new Error('crypto unavailable'),
    )

    const handled = await submitEditedUserMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      editingContent: 'Updated prompt',
      editingMessageId: 'user-1',
      idFactory: () => 'assistant-new',
      runTextAssistantGeneration,
    })

    expect(handled).toBe(true)
    expect(shared.accessKeyFromPassword).not.toHaveBeenCalled()
    expect(runTextAssistantGeneration).toHaveBeenCalledTimes(1)
  })

  it('claims edited-message reruns before duplicate local turns can be saved', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData(
        [conversation([userMessage('user-1', 'Old prompt')])],
        [activeProvider],
      ),
    }
    const sendingEvents: string[] = []
    const runTextAssistantGeneration = vi.fn(async () => {})
    const shared = sharedRerunOptions({
      activeProvider,
      sendingEvents,
      stateRef,
    })
    const options = {
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      editingContent: 'Updated prompt',
      editingMessageId: 'user-1',
      idFactory: () => 'assistant-new',
      runTextAssistantGeneration,
    }

    const first = submitEditedUserMessageGeneration(options)
    const duplicate = submitEditedUserMessageGeneration(options)

    await expect(duplicate).resolves.toBe(true)
    await expect(first).resolves.toBe(true)

    expect(shared.updateData).toHaveBeenCalledTimes(1)
    expect(runTextAssistantGeneration).toHaveBeenCalledTimes(1)
    expect(sendingEvents).toEqual(['start', 'finish'])
  })

  it('reports rejected edited-message generation runners without leaking the promise', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData(
        [conversation([userMessage('user-1', 'Old prompt')])],
        [activeProvider],
      ),
    }
    const notices: string[] = []
    const sendingEvents: string[] = []
    const runTextAssistantGeneration = vi.fn(async () => {
      throw new Error('runner exploded')
    })
    const shared = sharedRerunOptions({
      activeProvider,
      notices,
      sendingEvents,
      stateRef,
    })

    const handled = await submitEditedUserMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      editingContent: 'Updated prompt',
      editingMessageId: 'user-1',
      idFactory: () => 'assistant-new',
      runTextAssistantGeneration,
    })

    const messages = stateRef.current.conversations[0].messages

    expect(handled).toBe(true)
    expect(messages[1]).toMatchObject({
      id: 'assistant-new',
      content: 'runner exploded',
      error: 'runner exploded',
      status: 'error',
    })
    expect(notices).toEqual([
      '|||',
      'notice.messageGenerationFailed:{"message":"runner exploded"}|error|message|assistant-new',
    ])
    expect(sendingEvents).toEqual(['start', 'finish'])
    expect(shared.scheduleAutoSync).toHaveBeenCalledTimes(1)
    expect(shared.scheduleAutoSync).toHaveBeenCalledWith(stateRef.current, 0)
  })

  it('persists an unexpected rerun runner failure before reporting it or scheduling sync', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData(
        [conversation([userMessage('user-1', 'Old prompt')])],
        [activeProvider],
      ),
    }
    const terminalPersistence = deferred<void>()
    const notices: string[] = []
    const runTextAssistantGeneration = vi.fn(async () => {
      throw new Error('runner exploded')
    })
    const shared = sharedRerunOptions({
      activeProvider,
      notices,
      stateRef,
    })
    shared.commitPublishedLocalSnapshot
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => terminalPersistence.promise)

    const pending = submitEditedUserMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      editingContent: 'Updated prompt',
      editingMessageId: 'user-1',
      idFactory: () => 'assistant-new',
      runTextAssistantGeneration,
    })

    await vi.waitFor(() =>
      expect(shared.commitPublishedLocalSnapshot).toHaveBeenCalledTimes(2),
    )
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      id: 'assistant-new',
      error: 'runner exploded',
      status: 'error',
    })
    expect(shared.scheduleAutoSync).not.toHaveBeenCalled()
    expect(notices).toEqual(['|||'])

    terminalPersistence.resolve()
    await expect(pending).resolves.toBe(true)

    expect(shared.scheduleAutoSync).toHaveBeenCalledWith(stateRef.current, 0)
    expect(notices).toEqual([
      '|||',
      'notice.messageGenerationFailed:{"message":"runner exploded"}|error|message|assistant-new',
    ])
  })

  it('keeps an unexpected rerun runner failure visible and unsynced when terminal persistence fails', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData(
        [conversation([userMessage('user-1', 'Old prompt')])],
        [activeProvider],
      ),
    }
    const notices: string[] = []
    const runTextAssistantGeneration = vi.fn(async () => {
      throw new Error('runner exploded')
    })
    const shared = sharedRerunOptions({
      activeProvider,
      notices,
      stateRef,
    })
    shared.commitPublishedLocalSnapshot
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('stale revision'))

    const handled = await submitEditedUserMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      editingContent: 'Updated prompt',
      editingMessageId: 'user-1',
      idFactory: () => 'assistant-new',
      runTextAssistantGeneration,
    })

    expect(handled).toBe(true)
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      id: 'assistant-new',
      error: 'runner exploded',
      status: 'error',
    })
    expect(shared.scheduleAutoSync).not.toHaveBeenCalled()
    expect(notices).toEqual([
      '|||',
      'notice.messageSaveUnavailable|error|message|assistant-new',
    ])
  })

  it('keeps edited-message state when the replacement turn cannot be saved', async () => {
    const activeProvider = provider()
    const originalMessages = [
      userMessage('user-1', 'Old prompt'),
      assistantMessage('assistant-old'),
    ]
    const stateRef = {
      current: appData([conversation(originalMessages)], [activeProvider]),
    }
    const notices: string[] = []
    const sendingEvents: string[] = []
    const clearedEditing: string[] = []
    const runTextAssistantGeneration = vi.fn(
      async (options: RunTextAssistantGenerationOptions) => {
        void options
      },
    )
    const shared = sharedRerunOptions({
      activeProvider,
      clearedEditing,
      notices,
      sendingEvents,
      stateRef,
    })
    const updateData = vi.fn(
      (
        updater: (current: AppData) => AppData,
        updateOptions?: { autoSync?: boolean },
      ) => {
        void updater
        void updateOptions
        return null
      },
    )

    const handled = await submitEditedUserMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      editingContent: 'Updated prompt',
      editingMessageId: 'user-1',
      runTextAssistantGeneration,
      updateData,
    })

    expect(handled).toBe(true)
    expect(updateData).toHaveBeenCalledTimes(1)
    expect(updateData.mock.calls[0][1]).toEqual({ autoSync: false })
    expect(notices).toEqual([
      '|||',
      'notice.messageSaveUnavailable|error|message|user-1',
    ])
    expect(clearedEditing).toEqual([])
    expect(sendingEvents).toEqual(['start', 'finish'])
    expect(runTextAssistantGeneration).not.toHaveBeenCalled()
    expect(stateRef.current.conversations[0].messages).toEqual(originalMessages)
  })

  it('surfaces edited-message proxy access-key failures before starting generation', async () => {
    const activeProvider = provider({
      needsApiKey: false,
      proxyUrl: 'https://worker.example.com',
    })
    const stateRef = {
      current: appData(
        [conversation([userMessage('user-1', 'Old prompt')])],
        [activeProvider],
      ),
    }
    const notices: string[] = []
    const sendingEvents: string[] = []
    const clearedEditing: string[] = []
    const runTextAssistantGeneration = vi.fn(
      async (options: RunTextAssistantGenerationOptions) => {
        void options
      },
    )
    const shared = sharedRerunOptions({
      activeProvider,
      clearedEditing,
      notices,
      sendingEvents,
      stateRef,
    })
    vi.mocked(shared.accessKeyFromPassword).mockRejectedValueOnce(
      new Error('crypto unavailable'),
    )

    const handled = await submitEditedUserMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      editingContent: 'Updated prompt',
      editingMessageId: 'user-1',
      runTextAssistantGeneration,
    })

    expect(handled).toBe(true)
    expect(notices).toEqual([
      '|||',
      'notice.messageGenerationFailed:{"message":"crypto unavailable"}|error|message|user-1',
    ])
    expect(clearedEditing).toEqual([])
    expect(sendingEvents).toEqual(['start', 'finish'])
    expect(shared.updateData).not.toHaveBeenCalled()
    expect(runTextAssistantGeneration).not.toHaveBeenCalled()
  })

  it('blocks blank edited messages before mutating the conversation', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData(
        [conversation([userMessage('user-1', 'Old prompt')])],
        [activeProvider],
      ),
    }
    const notices: string[] = []
    const runTextAssistantGeneration = vi.fn(
      async (options: RunTextAssistantGenerationOptions) => {
        void options
      },
    )
    const shared = sharedRerunOptions({
      activeProvider,
      notices,
      stateRef,
    })

    const handled = await submitEditedUserMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      editingContent: '   ',
      editingMessageId: 'user-1',
      runTextAssistantGeneration,
    })

    expect(handled).toBe(true)
    expect(notices).toEqual([
      'notice.messageContentRequired|warning|message|user-1',
    ])
    expect(runTextAssistantGeneration).not.toHaveBeenCalled()
    expect(shared.updateData).not.toHaveBeenCalled()
  })

  it('contains blank edited-message notice reporter failures', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData(
        [conversation([userMessage('user-1', 'Old prompt')])],
        [activeProvider],
      ),
    }
    const runTextAssistantGeneration = vi.fn(
      async (options: RunTextAssistantGenerationOptions) => {
        void options
      },
    )
    const shared = sharedRerunOptions({
      activeProvider,
      stateRef,
    })

    const handled = await submitEditedUserMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      editingContent: '   ',
      editingMessageId: 'user-1',
      runTextAssistantGeneration,
      setNotice: () => {
        throw new Error('notice exploded')
      },
    })

    expect(handled).toBe(true)
    expect(runTextAssistantGeneration).not.toHaveBeenCalled()
    expect(shared.updateData).not.toHaveBeenCalled()
    expect(stateRef.current.conversations[0].messages[0]).toMatchObject({
      id: 'user-1',
      content: 'Old prompt',
      status: 'done',
    })
  })

  it('contains edited-message save failure notice reporter failures without clearing edit state', async () => {
    const activeProvider = provider()
    const originalMessages = [
      userMessage('user-1', 'Old prompt'),
      assistantMessage('assistant-old'),
    ]
    const stateRef = {
      current: appData([conversation(originalMessages)], [activeProvider]),
    }
    const sendingEvents: string[] = []
    const clearedEditing: string[] = []
    const runTextAssistantGeneration = vi.fn(
      async (options: RunTextAssistantGenerationOptions) => {
        void options
      },
    )
    const shared = sharedRerunOptions({
      activeProvider,
      clearedEditing,
      sendingEvents,
      stateRef,
    })
    const updateData = vi.fn(
      (
        updater: (current: AppData) => AppData,
        updateOptions?: { autoSync?: boolean },
      ) => {
        void updater
        void updateOptions
        return null
      },
    )

    const handled = await submitEditedUserMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      editingContent: 'Updated prompt',
      editingMessageId: 'user-1',
      runTextAssistantGeneration,
      setNotice: () => {
        throw new Error('notice exploded')
      },
      updateData,
    })

    expect(handled).toBe(true)
    expect(clearedEditing).toEqual([])
    expect(sendingEvents).toEqual(['start', 'finish'])
    expect(runTextAssistantGeneration).not.toHaveBeenCalled()
    expect(stateRef.current.conversations[0].messages).toEqual(originalMessages)
  })

  it('contains edited-message post-save clear notice reporter failures while dispatching generation', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData(
        [conversation([userMessage('user-1', 'Old prompt')])],
        [activeProvider],
      ),
    }
    const sendingEvents: string[] = []
    const clearedEditing: string[] = []
    const runTextAssistantGeneration = vi.fn(
      async (options: RunTextAssistantGenerationOptions) => {
        void options
      },
    )
    const shared = sharedRerunOptions({
      activeProvider,
      clearedEditing,
      sendingEvents,
      stateRef,
    })

    const handled = await submitEditedUserMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      editingContent: 'Updated prompt',
      editingMessageId: 'user-1',
      idFactory: () => 'assistant-new',
      runTextAssistantGeneration,
      setNotice: () => {
        throw new Error('notice exploded')
      },
    })

    expect(handled).toBe(true)
    expect(clearedEditing).toEqual(['clear'])
    expect(sendingEvents).toEqual(['start', 'finish'])
    expect(runTextAssistantGeneration).toHaveBeenCalledTimes(1)
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      id: 'assistant-new',
      status: 'streaming',
    })
  })

  it('contains edited-message runner failure notice reporter failures after patching assistant', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData(
        [conversation([userMessage('user-1', 'Old prompt')])],
        [activeProvider],
      ),
    }
    const sendingEvents: string[] = []
    const runTextAssistantGeneration = vi.fn(async () => {
      throw new Error('runner exploded')
    })
    const shared = sharedRerunOptions({
      activeProvider,
      sendingEvents,
      stateRef,
    })

    const handled = await submitEditedUserMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      editingContent: 'Updated prompt',
      editingMessageId: 'user-1',
      idFactory: () => 'assistant-new',
      runTextAssistantGeneration,
      setNotice: () => {
        throw new Error('notice exploded')
      },
    })

    expect(handled).toBe(true)
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      id: 'assistant-new',
      content: 'runner exploded',
      error: 'runner exploded',
      status: 'error',
    })
    expect(sendingEvents).toEqual(['start', 'finish'])
    expect(shared.scheduleAutoSync).toHaveBeenCalledTimes(1)
  })

  it('regenerates image assistant turns with restored source and mask files', async () => {
    const activeProvider = provider()
    const promptWithSource: ChatMessage = {
      ...userMessage('user-1', 'Paint the scene again'),
      attachments: [
        imageAttachment('source', 'source'),
        imageAttachment('mask', 'mask'),
      ],
    }
    const stateRef = {
      current: appData(
        [
          conversation([
            promptWithSource,
            assistantMessage('assistant-image', {
              attachments: [
                imageAttachment('generated', 'generated', 'previous-image-model'),
              ],
            }),
            userMessage('later-user', 'A later branch'),
          ]),
        ],
        [activeProvider],
      ),
    }
    const sendingEvents: string[] = []
    const runImageAssistantGeneration = vi.fn(
      async (options: RunImageAssistantGenerationOptions) => {
        void options
      },
    )
    const shared = sharedRerunOptions({
      activeProvider,
      sendingEvents,
      stateRef,
    })

    const handled = await regenerateAssistantMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      data: stateRef.current,
      messageId: 'assistant-image',
      runImageAssistantGeneration,
    })

    const messages = stateRef.current.conversations[0].messages
    const runOptions = runImageAssistantGeneration.mock.calls[0][0]

    expect(handled).toBe(true)
    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({
      id: 'assistant-image',
      content: '',
      error: undefined,
      status: 'streaming',
    })
    expect(messages[1].attachments).toBeUndefined()
    expect(runImageAssistantGeneration).toHaveBeenCalledTimes(1)
    expect(runOptions).toMatchObject({
      apiKey: 'sk-test',
      assistantId: 'assistant-image',
      model: 'previous-image-model',
      prompt: 'Paint the scene again',
      proxyToken: '',
    })
    expect(runOptions.image).toBeInstanceOf(File)
    expect(runOptions.mask).toBeInstanceOf(File)
    expect(stateRef.current.conversations[0].model).toBe('chat-model')
    expect(sendingEvents).toEqual(['start', 'finish'])
    expect(shared.options).toContainEqual({ autoSync: false })
  })

  it('waits for a regenerated image turn to persist before starting image generation', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData(
        [
          conversation([
            userMessage('user-1', 'Paint again'),
            assistantMessage('assistant-image', {
              attachments: [
                imageAttachment('generated', 'generated', 'image-model'),
              ],
            }),
          ]),
        ],
        [activeProvider],
      ),
    }
    const persistence = deferred<void>()
    const runImageAssistantGeneration = vi.fn(async () => {})
    const shared = sharedRerunOptions({
      activeProvider,
      stateRef,
    })
    shared.commitPublishedLocalSnapshot.mockImplementation(
      () => persistence.promise,
    )

    const pending = regenerateAssistantMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      data: stateRef.current,
      messageId: 'assistant-image',
      runImageAssistantGeneration,
    })

    await vi.waitFor(() =>
      expect(shared.commitPublishedLocalSnapshot).toHaveBeenCalledTimes(1),
    )
    expect(runImageAssistantGeneration).not.toHaveBeenCalled()
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      id: 'assistant-image',
      attachments: undefined,
      status: 'streaming',
    })

    persistence.resolve()
    await expect(pending).resolves.toBe(true)

    expect(runImageAssistantGeneration).toHaveBeenCalledTimes(1)
  })

  it('persists a stopped regenerated turn without starting the provider after cancellation during commit', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData(
        [
          conversation([
            userMessage('user-1', 'Prompt'),
            assistantMessage('assistant-1'),
          ]),
        ],
        [activeProvider],
      ),
    }
    const persistence = deferred<void>()
    const runTextAssistantGeneration = vi.fn(async () => {})
    const shared = sharedRerunOptions({
      activeProvider,
      stateRef,
    })
    shared.commitPublishedLocalSnapshot.mockImplementation(
      () => persistence.promise,
    )

    const pending = regenerateAssistantMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      data: stateRef.current,
      messageId: 'assistant-1',
      runTextAssistantGeneration,
    })

    await vi.waitFor(() =>
      expect(shared.commitPublishedLocalSnapshot).toHaveBeenCalledTimes(1),
    )
    shared.abortRef.current?.abort()
    persistence.resolve()

    await expect(pending).resolves.toBe(true)

    expect(runTextAssistantGeneration).not.toHaveBeenCalled()
    expect(shared.commitPublishedLocalSnapshot).toHaveBeenCalledTimes(2)
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      id: 'assistant-1',
      content: 'notice.stopped',
      error: undefined,
      status: 'done',
    })
    expect(shared.scheduleAutoSync).toHaveBeenCalledWith(stateRef.current, 0)
  })

  it('reports rejected regenerate generation runners without leaking the promise', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData(
        [
          conversation([
            userMessage('user-1', 'Prompt'),
            assistantMessage('assistant-1'),
          ]),
        ],
        [activeProvider],
      ),
    }
    const notices: string[] = []
    const sendingEvents: string[] = []
    const runTextAssistantGeneration = vi.fn(async () => {
      throw new Error('runner exploded')
    })
    const shared = sharedRerunOptions({
      activeProvider,
      notices,
      sendingEvents,
      stateRef,
    })

    const handled = await regenerateAssistantMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      data: stateRef.current,
      messageId: 'assistant-1',
      runTextAssistantGeneration,
    })

    const message = stateRef.current.conversations[0].messages[1]

    expect(handled).toBe(true)
    expect(message).toMatchObject({
      id: 'assistant-1',
      content: 'runner exploded',
      error: 'runner exploded',
      status: 'error',
    })
    expect(notices).toEqual([
      '|||',
      'notice.messageGenerationFailed:{"message":"runner exploded"}|error|message|assistant-1',
    ])
    expect(sendingEvents).toEqual(['start', 'finish'])
    expect(shared.scheduleAutoSync).toHaveBeenCalledTimes(1)
    expect(shared.scheduleAutoSync).toHaveBeenCalledWith(stateRef.current, 0)
  })

  it('surfaces regenerate proxy access-key failures before resetting the assistant', async () => {
    const activeProvider = provider({
      needsApiKey: false,
      proxyUrl: 'https://worker.example.com',
    })
    const stateRef = {
      current: appData(
        [
          conversation([
            userMessage('user-1', 'Prompt'),
            assistantMessage('assistant-1'),
          ]),
        ],
        [activeProvider],
      ),
    }
    const notices: string[] = []
    const sendingEvents: string[] = []
    const runTextAssistantGeneration = vi.fn(
      async (options: RunTextAssistantGenerationOptions) => {
        void options
      },
    )
    const shared = sharedRerunOptions({
      activeProvider,
      notices,
      sendingEvents,
      stateRef,
    })
    vi.mocked(shared.accessKeyFromPassword).mockRejectedValueOnce(
      new Error('crypto unavailable'),
    )

    const handled = await regenerateAssistantMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      data: stateRef.current,
      messageId: 'assistant-1',
      runTextAssistantGeneration,
    })

    expect(handled).toBe(true)
    expect(notices).toEqual([
      '|||',
      'notice.messageGenerationFailed:{"message":"crypto unavailable"}|error|message|assistant-1',
    ])
    expect(sendingEvents).toEqual(['start', 'finish'])
    expect(shared.updateData).not.toHaveBeenCalled()
    expect(runTextAssistantGeneration).not.toHaveBeenCalled()
  })

  it('stops assistant regeneration while access-key derivation is pending', async () => {
    const activeProvider = provider({
      needsApiKey: false,
      proxyUrl: 'https://worker.example.com',
    })
    const originalMessages = [
      userMessage('user-1', 'Prompt'),
      assistantMessage('assistant-1'),
    ]
    const stateRef = {
      current: appData([conversation(originalMessages)], [activeProvider]),
    }
    const accessKey = deferred<string>()
    const notices: string[] = []
    const sendingEvents: string[] = []
    const runTextAssistantGeneration = vi.fn(async () => {})
    const shared = sharedRerunOptions({
      activeProvider,
      notices,
      sendingEvents,
      stateRef,
    })
    vi.mocked(shared.accessKeyFromPassword).mockReturnValueOnce(accessKey.promise)

    const pending = regenerateAssistantMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      data: stateRef.current,
      messageId: 'assistant-1',
      runTextAssistantGeneration,
    })

    expect(shared.abortRef.current).toBeInstanceOf(AbortController)
    shared.abortRef.current?.abort()
    accessKey.resolve('proxy-token')

    await expect(pending).resolves.toBe(true)

    expect(notices).toEqual([
      '|||',
      'notice.stopped|warning|message|assistant-1',
    ])
    expect(sendingEvents).toEqual(['start', 'finish'])
    expect(shared.abortRef.current).toBeNull()
    expect(shared.updateData).not.toHaveBeenCalled()
    expect(runTextAssistantGeneration).not.toHaveBeenCalled()
    expect(stateRef.current.conversations[0].messages).toEqual(originalMessages)
  })

  it('keeps the assistant message when regeneration reset cannot be saved', async () => {
    const activeProvider = provider()
    const originalMessages = [
      userMessage('user-1', 'Prompt'),
      assistantMessage('assistant-1'),
    ]
    const stateRef = {
      current: appData([conversation(originalMessages)], [activeProvider]),
    }
    const notices: string[] = []
    const sendingEvents: string[] = []
    const clearedEditing: string[] = []
    const runTextAssistantGeneration = vi.fn(
      async (options: RunTextAssistantGenerationOptions) => {
        void options
      },
    )
    const shared = sharedRerunOptions({
      activeProvider,
      clearedEditing,
      notices,
      sendingEvents,
      stateRef,
    })
    const updateData = vi.fn(
      (
        updater: (current: AppData) => AppData,
        updateOptions?: { autoSync?: boolean },
      ) => {
        void updater
        void updateOptions
        return null
      },
    )

    const handled = await regenerateAssistantMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      data: stateRef.current,
      messageId: 'assistant-1',
      runTextAssistantGeneration,
      updateData,
    })

    expect(handled).toBe(true)
    expect(updateData).toHaveBeenCalledTimes(1)
    expect(updateData.mock.calls[0][1]).toEqual({ autoSync: false })
    expect(notices).toEqual([
      '|||',
      'notice.messageSaveUnavailable|error|message|assistant-1',
    ])
    expect(clearedEditing).toEqual([])
    expect(sendingEvents).toEqual(['start', 'finish'])
    expect(runTextAssistantGeneration).not.toHaveBeenCalled()
    expect(stateRef.current.conversations[0].messages).toEqual(originalMessages)
  })

  it('surfaces provider requirements before regenerating assistant messages', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData(
        [
          conversation([
            userMessage('user-1', 'Hello'),
            assistantMessage('assistant-1'),
          ]),
        ],
        [activeProvider],
      ),
    }
    const notices: string[] = []
    const sendingEvents: string[] = []
    const runTextAssistantGeneration = vi.fn(
      async (options: RunTextAssistantGenerationOptions) => {
        void options
      },
    )
    const shared = sharedRerunOptions({
      activeProvider,
      notices,
      sendingEvents,
      stateRef,
    })

    const handled = await regenerateAssistantMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      data: stateRef.current,
      messageId: 'assistant-1',
      providerKeysRef: { current: {} },
      runTextAssistantGeneration,
    })

    expect(handled).toBe(true)
    expect(notices[0]).toContain('notice.sendMissingProviderKey')
    expect(notices[0]).toContain('|message|assistant-1')
    expect(runTextAssistantGeneration).not.toHaveBeenCalled()
    expect(shared.updateData).not.toHaveBeenCalled()
    expect(sendingEvents).toEqual([])
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      id: 'assistant-1',
      content: 'Old answer',
      status: 'done',
    })
  })

  it('contains regenerate preflight notice reporter failures without mutating assistant', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData(
        [
          conversation([
            userMessage('user-1', 'Hello'),
            assistantMessage('assistant-1'),
          ]),
        ],
        [activeProvider],
      ),
    }
    const sendingEvents: string[] = []
    const runTextAssistantGeneration = vi.fn(
      async (options: RunTextAssistantGenerationOptions) => {
        void options
      },
    )
    const shared = sharedRerunOptions({
      activeProvider,
      sendingEvents,
      stateRef,
    })

    const handled = await regenerateAssistantMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      data: stateRef.current,
      messageId: 'assistant-1',
      providerKeysRef: { current: {} },
      runTextAssistantGeneration,
      setNotice: () => {
        throw new Error('notice exploded')
      },
    })

    expect(handled).toBe(true)
    expect(runTextAssistantGeneration).not.toHaveBeenCalled()
    expect(shared.updateData).not.toHaveBeenCalled()
    expect(sendingEvents).toEqual([])
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      id: 'assistant-1',
      content: 'Old answer',
      status: 'done',
    })
  })

  it('contains regenerate save failure notice reporter failures without resetting assistant', async () => {
    const activeProvider = provider()
    const originalMessages = [
      userMessage('user-1', 'Prompt'),
      assistantMessage('assistant-1'),
    ]
    const stateRef = {
      current: appData([conversation(originalMessages)], [activeProvider]),
    }
    const sendingEvents: string[] = []
    const clearedEditing: string[] = []
    const runTextAssistantGeneration = vi.fn(
      async (options: RunTextAssistantGenerationOptions) => {
        void options
      },
    )
    const shared = sharedRerunOptions({
      activeProvider,
      clearedEditing,
      sendingEvents,
      stateRef,
    })
    const updateData = vi.fn(
      (
        updater: (current: AppData) => AppData,
        updateOptions?: { autoSync?: boolean },
      ) => {
        void updater
        void updateOptions
        return null
      },
    )

    const handled = await regenerateAssistantMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      data: stateRef.current,
      messageId: 'assistant-1',
      runTextAssistantGeneration,
      setNotice: () => {
        throw new Error('notice exploded')
      },
      updateData,
    })

    expect(handled).toBe(true)
    expect(clearedEditing).toEqual([])
    expect(sendingEvents).toEqual(['start', 'finish'])
    expect(runTextAssistantGeneration).not.toHaveBeenCalled()
    expect(stateRef.current.conversations[0].messages).toEqual(originalMessages)
  })

  it('contains regenerate post-save clear notice reporter failures while dispatching generation', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData(
        [
          conversation([
            userMessage('user-1', 'Prompt'),
            assistantMessage('assistant-1'),
          ]),
        ],
        [activeProvider],
      ),
    }
    const sendingEvents: string[] = []
    const clearedEditing: string[] = []
    const runTextAssistantGeneration = vi.fn(
      async (options: RunTextAssistantGenerationOptions) => {
        void options
      },
    )
    const shared = sharedRerunOptions({
      activeProvider,
      clearedEditing,
      sendingEvents,
      stateRef,
    })

    const handled = await regenerateAssistantMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      data: stateRef.current,
      messageId: 'assistant-1',
      runTextAssistantGeneration,
      setNotice: () => {
        throw new Error('notice exploded')
      },
    })

    expect(handled).toBe(true)
    expect(clearedEditing).toEqual(['clear'])
    expect(sendingEvents).toEqual(['start', 'finish'])
    expect(runTextAssistantGeneration).toHaveBeenCalledTimes(1)
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      id: 'assistant-1',
      content: '',
      error: undefined,
      status: 'streaming',
    })
  })

  it('does not let a rerun completion overwrite a same-id assistant recreated by another tab', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData(
        [
          conversation([
            userMessage('user-1', 'Prompt'),
            assistantMessage('assistant-1'),
          ]),
        ],
        [activeProvider],
      ),
    }
    const shared = sharedRerunOptions({ activeProvider, stateRef })
    const commitPublishedLocalSnapshot = vi.fn(
      async (
        snapshot: AppData,
        precondition?: LocalSaveCommitPrecondition,
      ) => {
        if (!precondition) {
          return
        }

        const remote = {
          ...snapshot,
          conversations: snapshot.conversations.map((item) => ({
            ...item,
            messages: item.messages.map((message) =>
              message.id === 'assistant-1'
                ? {
                    ...message,
                    content: 'Replacement answer',
                    createdAt: 500,
                    status: 'done' as const,
                  }
                : message,
            ),
            updatedAt: 500,
          })),
          updatedAt: 500,
        }
        stateRef.current = remote
        expect(precondition.isSatisfied(remote)).toBe(false)
        precondition.onOutcome?.(null)
      },
    )

    const handled = await regenerateAssistantMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      commitPublishedLocalSnapshot,
      data: stateRef.current,
      messageId: 'assistant-1',
      runTextAssistantGeneration: (options) =>
        completeTextAssistantGeneration({
          ...options,
          streamAssistantText: async (streamOptions) =>
            streamOptions.onToken('Late rerun answer'),
        }),
    })

    expect(handled).toBe(true)
    expect(commitPublishedLocalSnapshot).toHaveBeenCalledTimes(2)
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      id: 'assistant-1',
      content: 'Replacement answer',
      createdAt: 500,
      status: 'done',
    })
    expect(shared.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('contains regenerate runner failure notice reporter failures after patching assistant', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData(
        [
          conversation([
            userMessage('user-1', 'Prompt'),
            assistantMessage('assistant-1'),
          ]),
        ],
        [activeProvider],
      ),
    }
    const sendingEvents: string[] = []
    const runTextAssistantGeneration = vi.fn(async () => {
      throw new Error('runner exploded')
    })
    const shared = sharedRerunOptions({
      activeProvider,
      sendingEvents,
      stateRef,
    })

    const handled = await regenerateAssistantMessageGeneration({
      ...shared,
      activeConversation: stateRef.current.conversations[0],
      data: stateRef.current,
      messageId: 'assistant-1',
      runTextAssistantGeneration,
      setNotice: () => {
        throw new Error('notice exploded')
      },
    })

    expect(handled).toBe(true)
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      id: 'assistant-1',
      content: 'runner exploded',
      error: 'runner exploded',
      status: 'error',
    })
    expect(sendingEvents).toEqual(['start', 'finish'])
    expect(shared.scheduleAutoSync).toHaveBeenCalledTimes(1)
  })
})
