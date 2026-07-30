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
import type { RunTextAssistantGenerationOptions } from '../chatGenerationAssistantRun'
import {
  reportTextSubmitNotice,
  sendTextMessageGeneration as sendTextMessageGenerationRuntime,
  type SendTextMessageGenerationOptions,
} from '../chatGenerationTextSubmit'

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

function conversation(messages: ChatMessage[] = []): Conversation {
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

function idSequence(...ids: string[]) {
  const queue = [...ids]
  return () => queue.shift() ?? 'extra-id'
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}

function sendTextMessageGeneration(
  options: Omit<
    SendTextMessageGenerationOptions,
    | 'commitPublishedLocalSnapshot'
    | 'draftRevision'
    | 'draftRevisionRef'
  > &
    Partial<
      Pick<
        SendTextMessageGenerationOptions,
        | 'commitPublishedLocalSnapshot'
        | 'draftRevision'
        | 'draftRevisionRef'
      >
    >,
): Promise<void> {
  return sendTextMessageGenerationRuntime({
    commitPublishedLocalSnapshot: async () => undefined,
    draftRevision: 0,
    draftRevisionRef: { current: 0 },
    ...options,
  })
}

function textSubmitFixture(
  overrides: Partial<SendTextMessageGenerationOptions> = {},
) {
  const activeProvider = provider()
  const stateRef = { current: appData([conversation()], [activeProvider]) }
  const { updateData } = updaterFor(stateRef)
  const runTextAssistantGeneration = vi.fn(
    async (options: RunTextAssistantGenerationOptions) => {
      void options
    },
  )
  const options: SendTextMessageGenerationOptions = {
    abortRef: { current: null },
    accessKeyFromPassword: vi.fn(async () => 'proxy-token'),
    activeConversation: stateRef.current.conversations[0],
    activeModel: 'chat-model',
    activeProvider,
    chatContextMessageLimit: 12,
    commitPublishedLocalSnapshot: async () => undefined,
    content: 'Explain the release plan',
    data: stateRef.current,
    dataRef: stateRef,
    draftRevision: 0,
    draftRevisionRef: { current: 0 },
    errorMessage: (error: unknown) =>
      error instanceof Error ? error.message : String(error),
    finishSending: vi.fn(),
    flushStreamingAssistantContent: vi.fn(),
    isOnlineRef: { current: true },
    providerKeys: { [activeProvider.id]: 'key' },
    randomId: idSequence('user-id', 'assistant-id'),
    resetAssistantForRetry: vi.fn(),
    runGenerationWithAutoRetry: (operation) => operation(),
    runTextAssistantGeneration,
    scheduleAutoSync: vi.fn(),
    setDraft: vi.fn(),
    setNotice: vi.fn(),
    startSending: vi.fn(),
    syncPassphraseRef: { current: 'passphrase' },
    t,
    updateData,
    ...overrides,
  }

  return {
    options,
    runTextAssistantGeneration,
    stateRef,
    updateData,
  }
}

describe('chat generation text submit runtime', () => {
  it('contains text submit notice reporter failures', () => {
    const setNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })

    expect(() =>
      reportTextSubmitNotice(setNotice, () => {
        throw new Error('locale unavailable')
      }, 'error', 'chat'),
    ).not.toThrow()
    expect(setNotice).not.toHaveBeenCalled()

    expect(() =>
      reportTextSubmitNotice(
        setNotice,
        () => 'notice.messageSaveUnavailable',
        'error',
        'chat',
      ),
    ).not.toThrow()
    expect(setNotice).toHaveBeenCalledWith(
      'notice.messageSaveUnavailable',
      'error',
      'chat',
    )
  })

  it('saves a text turn before dispatching generation', async () => {
    const activeProvider = provider()
    const stateRef = { current: appData([conversation()], [activeProvider]) }
    const { options, updateData } = updaterFor(stateRef)
    const drafts: string[] = []
    const notices: string[] = []
    const sendingTransitions: string[] = []
    const runTextAssistantGeneration = vi.fn(
      async (options: RunTextAssistantGenerationOptions) => {
        void options
      },
    )

    await sendTextMessageGeneration({
      abortRef: { current: null },
      accessKeyFromPassword: async () => '',
      activeConversation: stateRef.current.conversations[0],
      activeModel: 'chat-model',
      activeProvider,
      chatContextMessageLimit: 12,
      content: 'Explain the release plan',
      data: stateRef.current,
      dataRef: stateRef,
      errorMessage: String,
      finishSending: () => sendingTransitions.push('stop'),
      flushStreamingAssistantContent: vi.fn(),
      isOnlineRef: { current: true },
      now: () => 42,
      providerKeys: { 'provider-1': 'key' },
      randomId: idSequence('user-id', 'assistant-id'),
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: (operation) => operation(),
      runTextAssistantGeneration,
      scheduleAutoSync: vi.fn(),
      setDraft: (value) => drafts.push(value),
      setNotice: (message) => notices.push(message),
      startSending: () => sendingTransitions.push('start'),
      syncPassphraseRef: { current: '' },
      t,
      updateData,
    })

    const messages = stateRef.current?.conversations[0].messages ?? []
    expect(options).toEqual([{ autoSync: false }])
    expect(drafts).toEqual([''])
    expect(notices).toEqual([''])
    expect(sendingTransitions).toEqual(['start', 'stop'])
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({
      id: 'user-id',
      role: 'user',
      content: 'Explain the release plan',
      status: 'done',
    })
    expect(messages[1]).toMatchObject({
      id: 'assistant-id',
      role: 'assistant',
      status: 'streaming',
    })
    expect(runTextAssistantGeneration).toHaveBeenCalledTimes(1)
    expect(runTextAssistantGeneration.mock.calls[0][0]).toMatchObject({
      assistantId: 'assistant-id',
      baseMessages: [
        {
          id: 'user-id',
          role: 'user',
          content: 'Explain the release plan',
        },
      ],
      contextMessageLimit: 12,
      conversationId: 'conversation-1',
      latestInput: 'Explain the release plan',
      model: 'chat-model',
      provider: { id: 'provider-1' },
    })
    expect(runTextAssistantGeneration.mock.calls[0][0].controller).toBeInstanceOf(
      AbortController,
    )
  })

  it('waits for the durable text turn before dispatching generation', async () => {
    const persistence = deferred<void>()
    const commitPublishedLocalSnapshot = vi.fn(() => persistence.promise)
    const { options, runTextAssistantGeneration } = textSubmitFixture({
      commitPublishedLocalSnapshot,
    })

    const submission = sendTextMessageGeneration(options)

    await vi.waitFor(() => {
      expect(commitPublishedLocalSnapshot).toHaveBeenCalledTimes(1)
    })
    expect(runTextAssistantGeneration).not.toHaveBeenCalled()
    expect(options.setDraft).not.toHaveBeenCalled()

    persistence.resolve(undefined)
    await submission

    expect(runTextAssistantGeneration).toHaveBeenCalledTimes(1)
    expect(options.setDraft).toHaveBeenCalledWith('')
  })

  it('preserves a newer draft typed while the text turn becomes durable', async () => {
    const persistence = deferred<void>()
    const commitPublishedLocalSnapshot = vi.fn(() => persistence.promise)
    const draftState = { current: 'Explain the release plan' }
    const setDraft = vi.fn((value: string) => {
      draftState.current = value
    })
    const draftRevisionRef = { current: 1 }
    const { options } = textSubmitFixture({
      commitPublishedLocalSnapshot,
      draftRevision: 1,
      draftRevisionRef,
      setDraft,
    })

    const submission = sendTextMessageGeneration(options)

    await vi.waitFor(() => {
      expect(commitPublishedLocalSnapshot).toHaveBeenCalledTimes(1)
    })
    draftState.current = 'Prepare the follow-up question'
    draftRevisionRef.current = 2

    persistence.resolve(undefined)
    await submission

    expect(draftState.current).toBe('Prepare the follow-up question')
    expect(setDraft).not.toHaveBeenCalled()
  })

  it('does not contact the provider when durable text submission fails', async () => {
    const commitPublishedLocalSnapshot = vi
      .fn<(snapshot: AppData) => Promise<void>>()
      .mockRejectedValueOnce(new Error('write conflict'))
      .mockResolvedValue(undefined)
    const { options, runTextAssistantGeneration, stateRef } = textSubmitFixture({
      commitPublishedLocalSnapshot,
    })

    await sendTextMessageGeneration(options)

    expect(commitPublishedLocalSnapshot).toHaveBeenCalledTimes(2)
    expect(runTextAssistantGeneration).not.toHaveBeenCalled()
    expect(options.setDraft).not.toHaveBeenCalled()
    expect(stateRef.current?.conversations[0].messages[1]).toMatchObject({
      error: 'notice.messageSaveUnavailable',
      status: 'error',
    })
    expect(options.scheduleAutoSync).toHaveBeenCalledTimes(1)
    expect(options.setNotice).toHaveBeenLastCalledWith(
      'notice.messageSaveUnavailable',
      'error',
      'message',
      'assistant-id',
    )
  })

  it('persists a stopped text turn when cancellation wins the commit wait', async () => {
    const persistence = deferred<void>()
    const commitPublishedLocalSnapshot = vi
      .fn<(snapshot: AppData) => Promise<void>>()
      .mockImplementationOnce(() => persistence.promise)
      .mockResolvedValue(undefined)
    const { options, runTextAssistantGeneration, stateRef } = textSubmitFixture({
      commitPublishedLocalSnapshot,
    })

    const submission = sendTextMessageGeneration(options)
    await vi.waitFor(() => {
      expect(commitPublishedLocalSnapshot).toHaveBeenCalledTimes(1)
    })

    options.abortRef.current?.abort()
    persistence.resolve(undefined)
    await submission

    expect(commitPublishedLocalSnapshot).toHaveBeenCalledTimes(2)
    expect(runTextAssistantGeneration).not.toHaveBeenCalled()
    expect(options.setDraft).not.toHaveBeenCalled()
    expect(stateRef.current?.conversations[0].messages[1]).toMatchObject({
      content: 'notice.stopped',
      status: 'done',
    })
    expect(options.scheduleAutoSync).toHaveBeenCalledTimes(1)
    expect(options.setNotice).toHaveBeenLastCalledWith(
      'notice.stopped',
      'warning',
      'message',
      'assistant-id',
    )
  })

  it('claims direct text submission before duplicate local turns can be saved', async () => {
    const generation = deferred<void>()
    const runTextAssistantGeneration = vi.fn(
      async (options: RunTextAssistantGenerationOptions) => {
        expect(options.controller).toBe(options.abortRef.current)
        await generation.promise
      },
    )
    const { options, stateRef, updateData } = textSubmitFixture({
      runTextAssistantGeneration,
    })

    const first = sendTextMessageGeneration(options)
    const duplicate = sendTextMessageGeneration(options)

    expect(updateData).toHaveBeenCalledTimes(1)
    expect(options.startSending).toHaveBeenCalledTimes(1)
    expect(stateRef.current?.conversations[0].messages).toHaveLength(2)
    await vi.waitFor(() => {
      expect(runTextAssistantGeneration).toHaveBeenCalledTimes(1)
    })

    generation.resolve()
    await Promise.all([first, duplicate])

    expect(options.finishSending).toHaveBeenCalledTimes(1)
    expect(options.abortRef.current).toBeNull()
  })

  it('stops proxied text submission while access-key derivation is pending', async () => {
    const activeProvider = provider({
      needsApiKey: false,
      proxyUrl: 'https://worker.example.com',
    })
    const stateRef = { current: appData([conversation()], [activeProvider]) }
    const accessKey = deferred<string>()
    const update = updaterFor(stateRef)
    const { options, runTextAssistantGeneration } = textSubmitFixture({
      accessKeyFromPassword: () => accessKey.promise,
      activeConversation: stateRef.current.conversations[0],
      activeProvider,
      data: stateRef.current,
      dataRef: stateRef,
      providerKeys: {},
      updateData: update.updateData,
    })

    const submission = sendTextMessageGeneration(options)

    options.abortRef.current?.abort()
    accessKey.resolve('proxy-token')
    await submission

    expect(update.updateData).not.toHaveBeenCalled()
    expect(runTextAssistantGeneration).not.toHaveBeenCalled()
    expect(options.setNotice).toHaveBeenCalledWith(
      'notice.stopped',
      'warning',
      'chat',
    )
    expect(options.startSending).toHaveBeenCalledTimes(1)
    expect(options.finishSending).toHaveBeenCalledTimes(1)
    expect(options.abortRef.current).toBeNull()
  })

  it('queues offline proxied text without deriving an access key', async () => {
    const activeProvider = provider({
      needsApiKey: false,
      proxyUrl: 'https://worker.example.com',
    })
    const stateRef = { current: appData([conversation()], [activeProvider]) }
    const accessKeyFromPassword = vi.fn(async () => 'proxy-token')
    const queueOfflineTextMessage = vi.fn()
    const { options, runTextAssistantGeneration } = textSubmitFixture({
      accessKeyFromPassword,
      activeConversation: stateRef.current.conversations[0],
      activeProvider,
      data: stateRef.current,
      dataRef: stateRef,
      isOnlineRef: { current: false },
      providerKeys: {},
      queueOfflineTextMessage,
    })

    await sendTextMessageGeneration(options)

    expect(queueOfflineTextMessage).toHaveBeenCalledTimes(1)
    expect(accessKeyFromPassword).not.toHaveBeenCalled()
    expect(options.startSending).not.toHaveBeenCalled()
    expect(options.finishSending).not.toHaveBeenCalled()
    expect(runTextAssistantGeneration).not.toHaveBeenCalled()
    expect(options.abortRef.current).toBeNull()
  })

  it('keeps the text draft when the message cannot be saved', async () => {
    const activeProvider = provider()
    const stateRef = { current: appData([conversation()], [activeProvider]) }
    const drafts: string[] = []
    const notices: Array<{
      message: string
      target: string | undefined
      tone: string | undefined
    }> = []
    const finishSending = vi.fn()
    const runTextAssistantGeneration = vi.fn(
      async (options: RunTextAssistantGenerationOptions) => {
        void options
      },
    )
    const startSending = vi.fn()
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

    await sendTextMessageGeneration({
      abortRef: { current: null },
      accessKeyFromPassword: async () => '',
      activeConversation: stateRef.current.conversations[0],
      activeModel: 'chat-model',
      activeProvider,
      chatContextMessageLimit: 12,
      content: 'Do not drop this prompt',
      data: stateRef.current,
      dataRef: stateRef,
      errorMessage: String,
      finishSending,
      flushStreamingAssistantContent: vi.fn(),
      isOnlineRef: { current: true },
      providerKeys: { 'provider-1': 'key' },
      randomId: idSequence('user-id', 'assistant-id'),
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: (operation) => operation(),
      runTextAssistantGeneration,
      scheduleAutoSync: vi.fn(),
      setDraft: (value) => drafts.push(value),
      setNotice: (message, tone, target) =>
        notices.push({ message, tone, target }),
      startSending,
      syncPassphraseRef: { current: '' },
      t,
      updateData,
    })

    expect(updateData).toHaveBeenCalledTimes(1)
    expect(updateData.mock.calls[0][1]).toEqual({ autoSync: false })
    expect(notices).toEqual([
      {
        message: '',
        tone: undefined,
        target: undefined,
      },
      {
        message: 'notice.messageSaveUnavailable',
        tone: 'error',
        target: 'chat',
      },
    ])
    expect(drafts).toEqual([])
    expect(startSending).toHaveBeenCalledTimes(1)
    expect(finishSending).toHaveBeenCalledTimes(1)
    expect(runTextAssistantGeneration).not.toHaveBeenCalled()
    expect(stateRef.current.conversations[0].messages).toEqual([])
  })

  it('contains preflight notice reporter failures without leaking the promise', async () => {
    const activeProvider = provider()
    const stateRef = { current: appData([conversation()], [activeProvider]) }
    const update = updaterFor(stateRef)
    const { options, runTextAssistantGeneration } = textSubmitFixture({
      activeConversation: stateRef.current.conversations[0],
      activeProvider,
      data: stateRef.current,
      dataRef: stateRef,
      providerKeys: {},
      setNotice: vi.fn(() => {
        throw new Error('notice channel unavailable')
      }),
      updateData: update.updateData,
    })

    await expect(sendTextMessageGeneration(options)).resolves.toBeUndefined()

    expect(update.updateData).not.toHaveBeenCalled()
    expect(options.setDraft).not.toHaveBeenCalled()
    expect(options.startSending).not.toHaveBeenCalled()
    expect(options.finishSending).not.toHaveBeenCalled()
    expect(runTextAssistantGeneration).not.toHaveBeenCalled()
  })

  it('contains access-key failure notice reporter failures before starting text generation', async () => {
    const activeProvider = provider({
      needsApiKey: false,
      proxyUrl: 'https://worker.example.com',
    })
    const stateRef = { current: appData([conversation()], [activeProvider]) }
    const update = updaterFor(stateRef)
    const { options, runTextAssistantGeneration } = textSubmitFixture({
      activeConversation: stateRef.current.conversations[0],
      activeProvider,
      data: stateRef.current,
      dataRef: stateRef,
      providerKeys: {},
      accessKeyFromPassword: vi.fn(async () => {
        throw new Error('crypto unavailable')
      }),
      setNotice: vi.fn(() => {
        throw new Error('notice channel unavailable')
      }),
      updateData: update.updateData,
    })

    await expect(sendTextMessageGeneration(options)).resolves.toBeUndefined()

    expect(update.updateData).not.toHaveBeenCalled()
    expect(options.setDraft).not.toHaveBeenCalled()
    expect(options.startSending).toHaveBeenCalledTimes(1)
    expect(options.finishSending).toHaveBeenCalledTimes(1)
    expect(runTextAssistantGeneration).not.toHaveBeenCalled()
  })

  it('contains save failure notice reporter failures without clearing the text draft', async () => {
    const updateData = vi.fn(() => null)
    const { options, runTextAssistantGeneration } = textSubmitFixture({
      setNotice: vi.fn(() => {
        throw new Error('notice channel unavailable')
      }),
      updateData,
    })

    await expect(sendTextMessageGeneration(options)).resolves.toBeUndefined()

    expect(updateData).toHaveBeenCalledTimes(1)
    expect(options.setDraft).not.toHaveBeenCalled()
    expect(options.startSending).toHaveBeenCalledTimes(1)
    expect(options.finishSending).toHaveBeenCalledTimes(1)
    expect(runTextAssistantGeneration).not.toHaveBeenCalled()
  })

  it('persists an unexpected text runner failure before reporting or scheduling sync', async () => {
    const terminalPersistence = deferred<void>()
    const commitPublishedLocalSnapshot = vi
      .fn<(snapshot: AppData) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => terminalPersistence.promise)
    const scheduleAutoSync = vi.fn()
    const setNotice = vi.fn()
    const { options, stateRef } = textSubmitFixture({
      commitPublishedLocalSnapshot,
      runTextAssistantGeneration: vi.fn(async () => {
        throw new Error('runner exploded')
      }),
      scheduleAutoSync,
      setNotice,
    })

    const submission = sendTextMessageGeneration(options)

    await vi.waitFor(() => {
      expect(commitPublishedLocalSnapshot).toHaveBeenCalledTimes(2)
    })
    expect(stateRef.current?.conversations[0].messages[1]).toMatchObject({
      content: 'runner exploded',
      error: 'runner exploded',
      status: 'error',
    })
    expect(scheduleAutoSync).not.toHaveBeenCalled()
    expect(setNotice).not.toHaveBeenCalledWith(
      'notice.messageGenerationFailed:{"message":"runner exploded"}',
      'error',
      'message',
      'assistant-id',
    )

    terminalPersistence.resolve(undefined)
    await submission

    expect(scheduleAutoSync).toHaveBeenCalledWith(stateRef.current, 0)
    expect(setNotice).toHaveBeenCalledWith(
      'notice.messageGenerationFailed:{"message":"runner exploded"}',
      'error',
      'message',
      'assistant-id',
    )
    expect(options.finishSending).toHaveBeenCalledTimes(1)
  })

  it('keeps an unexpected text runner failure visible and unsynced when terminal persistence fails', async () => {
    const commitPublishedLocalSnapshot = vi
      .fn<(snapshot: AppData) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('terminal write failed'))
    const scheduleAutoSync = vi.fn()
    const setNotice = vi.fn()
    const { options, stateRef } = textSubmitFixture({
      commitPublishedLocalSnapshot,
      runTextAssistantGeneration: vi.fn(async () => {
        throw new Error('runner exploded')
      }),
      scheduleAutoSync,
      setNotice,
    })

    await expect(sendTextMessageGeneration(options)).resolves.toBeUndefined()

    expect(stateRef.current?.conversations[0].messages[1]).toMatchObject({
      content: 'runner exploded',
      error: 'runner exploded',
      status: 'error',
    })
    expect(scheduleAutoSync).not.toHaveBeenCalled()
    expect(setNotice).toHaveBeenCalledWith(
      'notice.messageSaveUnavailable',
      'error',
      'message',
      'assistant-id',
    )
    expect(setNotice).not.toHaveBeenCalledWith(
      'notice.messageGenerationFailed:{"message":"runner exploded"}',
      'error',
      'message',
      'assistant-id',
    )
  })

  it('contains post-save clear notice reporter failures while dispatching text generation', async () => {
    const { options, runTextAssistantGeneration, stateRef } = textSubmitFixture({
      setNotice: vi.fn((message: string) => {
        if (message === '') {
          throw new Error('notice channel unavailable')
        }
      }),
    })

    await expect(sendTextMessageGeneration(options)).resolves.toBeUndefined()

    expect(options.setDraft).toHaveBeenCalledWith('')
    expect(options.startSending).toHaveBeenCalledTimes(1)
    expect(runTextAssistantGeneration).toHaveBeenCalledTimes(1)
    expect(options.finishSending).toHaveBeenCalledTimes(1)
    expect(stateRef.current?.conversations[0].messages).toHaveLength(2)
  })
})
