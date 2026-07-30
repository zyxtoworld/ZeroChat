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
  flushQueuedOfflineTextMessages as flushQueuedOfflineTextMessagesRuntime,
  queueOfflineTextMessage as queueOfflineTextMessageRuntime,
  reportOfflineQueueNotice,
  type QueueOfflineTextMessageOptions,
} from '../chatGenerationOfflineQueue'
import type { StreamAssistantTextOptions } from '../chatGenerationTextStream'
import { mergeConcurrentAppData } from '../concurrentAppDataMerge'
import { createLocalSaveQueue } from '../localSaveQueueController'
import { appendOfflineQueuedTextTurn } from '../offlineQueue'
import { recoverAppDataWriteConflict } from '../../storage/appDataConflictRecovery'
import { AppDataWriteConflictError } from '../../storage/appDataWriteConflict'

const t: Translator = (key, values) =>
  values && typeof values === 'object'
    ? `${key}:${JSON.stringify(values)}`
    : key

function queueOfflineTextMessage(
  options: Omit<
    QueueOfflineTextMessageOptions,
    'draftRevision' | 'draftRevisionRef'
  > &
    Partial<
      Pick<
        QueueOfflineTextMessageOptions,
        'draftRevision' | 'draftRevisionRef'
      >
    >,
): boolean {
  return queueOfflineTextMessageRuntime({
    draftRevision: 0,
    draftRevisionRef: { current: 0 },
    ...options,
  })
}

function provider(id = 'provider-1'): ProviderConfig {
  return {
    ...providerFromPreset(providerPresets[0]),
    id,
  }
}

function conversation(messages: ChatMessage[] = []): Conversation {
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

function queuedConversation(seedProvider = provider()): Conversation {
  return appendOfflineQueuedTextTurn({
    conversation: conversation(),
    providerId: seedProvider.id,
    model: seedProvider.model,
    content: 'Hello offline',
    title: 'Hello offline',
    userMessageId: 'user-1',
    assistantMessageId: 'assistant-1',
    createdAt: 10,
    queuedAssistantContent: 'message.offlineQueued',
  })
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
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, reject, resolve }
}

function cloneAppData(snapshot: AppData): AppData {
  return structuredClone(snapshot)
}

function createRevisionFakeStore(initialSnapshot: AppData) {
  let persistedSnapshot = cloneAppData(initialSnapshot)
  let revision = 0
  let revisionConflicts = 0
  let initialRevisionWriters = 0
  const initialRevisionRace = deferred<void>()

  return {
    createClient: () => {
      let loadedRevision = revision

      return {
        load: async (): Promise<AppData> => {
          loadedRevision = revision
          return cloneAppData(persistedSnapshot)
        },
        save: async (snapshot: AppData): Promise<void> => {
          const expectedRevision = loadedRevision

          if (expectedRevision === 0) {
            initialRevisionWriters += 1
            if (initialRevisionWriters === 2) {
              initialRevisionRace.resolve(undefined)
            }
            await initialRevisionRace.promise
          }

          if (expectedRevision !== revision) {
            revisionConflicts += 1
            throw new AppDataWriteConflictError()
          }

          persistedSnapshot = cloneAppData(snapshot)
          revision += 1
          loadedRevision = revision
        },
      }
    },
    conflictCount: () => revisionConflicts,
    read: () => cloneAppData(persistedSnapshot),
  }
}

type FlushQueuedOfflineTextMessagesOptions = Parameters<
  typeof flushQueuedOfflineTextMessagesRuntime
>[0]

function flushQueuedOfflineTextMessages(
  options: Omit<
    FlushQueuedOfflineTextMessagesOptions,
    'commitPublishedLocalSnapshot'
  > &
    Partial<
      Pick<FlushQueuedOfflineTextMessagesOptions, 'commitPublishedLocalSnapshot'>
    >,
): Promise<void> {
  return flushQueuedOfflineTextMessagesRuntime({
    commitPublishedLocalSnapshot: async (snapshot, precondition) => {
      precondition?.onOutcome?.(
        precondition.isSatisfied(snapshot) ? snapshot : null,
      )
    },
    ...options,
  })
}

describe('chat generation offline queue runtime', () => {
  it('contains offline queue notice reporter failures', () => {
    const setNotice = vi.fn(() => {
      throw new Error('notice exploded')
    })

    expect(() =>
      reportOfflineQueueNotice(
        setNotice,
        () => 'notice.offlineMessageQueued',
        'warning',
        'chat',
      ),
    ).not.toThrow()
    expect(() =>
      reportOfflineQueueNotice(setNotice, () => {
        throw new Error('translate exploded')
      }),
    ).not.toThrow()
    expect(setNotice).toHaveBeenCalledTimes(1)
  })

  it('clears offline text only after the queued turn is durably saved', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData([conversation()], [activeProvider]),
    }
    const { updateData } = updaterFor(stateRef)
    const persistence = deferred<void>()
    const commitPublishedLocalSnapshot = vi.fn(() => persistence.promise)
    const notices: string[] = []
    const drafts: string[] = []
    const ids = ['user-queued', 'assistant-queued']

    const queued = queueOfflineTextMessage({
      activeConversation: stateRef.current.conversations[0],
      activeProvider,
      commitPublishedLocalSnapshot,
      content: 'Offline prompt',
      idFactory: () => ids.shift() ?? 'extra-id',
      model: 'offline-model',
      nowMs: () => 42,
      setDraft: (value) => drafts.push(value),
      setNotice: (message, tone, target) =>
        notices.push(`${message}|${tone}|${target}`),
      t,
      updateData,
    })

    expect(queued).toBe(true)
    expect(commitPublishedLocalSnapshot).toHaveBeenCalledTimes(1)
    expect(drafts).toEqual([])
    expect(notices).toEqual([])
    expect(stateRef.current.conversations[0]).toMatchObject({
      providerId: activeProvider.id,
      model: 'offline-model',
      title: 'Offline prompt',
    })
    expect(stateRef.current.conversations[0].messages).toEqual([
      {
        id: 'user-queued',
        role: 'user',
        content: 'Offline prompt',
        createdAt: 42,
        status: 'done',
      },
      {
        id: 'assistant-queued',
        role: 'assistant',
        content: 'message.offlineQueued',
        createdAt: 42,
        status: 'queued',
        queuedTextRequest: {
          providerId: activeProvider.id,
          model: 'offline-model',
          promptMessageId: 'user-queued',
        },
      },
    ])

    persistence.resolve(undefined)
    await vi.waitFor(() => {
      expect(drafts).toEqual([''])
      expect(notices).toEqual(['notice.offlineMessageQueued|warning|chat'])
    })
  })

  it('preserves a newer draft typed while the offline turn becomes durable', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData([conversation()], [activeProvider]),
    }
    const { updateData } = updaterFor(stateRef)
    const persistence = deferred<void>()
    const draftState = { current: 'Offline prompt' }
    const draftRevisionRef = { current: 1 }
    const setDraft = vi.fn((value: string) => {
      draftState.current = value
    })

    queueOfflineTextMessage({
      activeConversation: stateRef.current.conversations[0],
      activeProvider,
      commitPublishedLocalSnapshot: () => persistence.promise,
      content: draftState.current,
      draftRevision: 1,
      draftRevisionRef,
      idFactory: vi
        .fn()
        .mockReturnValueOnce('user-queued')
        .mockReturnValueOnce('assistant-queued'),
      model: 'offline-model',
      nowMs: () => 42,
      setDraft,
      setNotice: vi.fn(),
      t,
      updateData,
    })

    draftState.current = 'Next question'
    draftRevisionRef.current = 2
    persistence.resolve(undefined)
    await vi.waitFor(() => {
      expect(stateRef.current.conversations[0].messages).toHaveLength(2)
    })

    expect(draftState.current).toBe('Next question')
    expect(setDraft).not.toHaveBeenCalled()
  })

  it('rolls back the queued turn and keeps the draft when durable save fails', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData([conversation()], [activeProvider]),
    }
    const { options, updateData } = updaterFor(stateRef)
    const commitPublishedLocalSnapshot = vi.fn(async () => {
      throw new Error('local storage unavailable')
    })
    const notices: string[] = []
    const drafts: string[] = []
    const ids = ['user-queued', 'assistant-queued']

    const queued = queueOfflineTextMessage({
      activeConversation: stateRef.current.conversations[0],
      activeProvider,
      commitPublishedLocalSnapshot,
      content: 'Offline prompt',
      idFactory: () => ids.shift() ?? 'extra-id',
      model: 'offline-model',
      nowMs: () => 42,
      setDraft: (value) => drafts.push(value),
      setNotice: (message, tone, target) =>
        notices.push(`${message}|${tone}|${target}`),
      t,
      updateData,
    })

    expect(queued).toBe(true)
    await vi.waitFor(() => {
      expect(notices).toEqual(['notice.messageSaveUnavailable|error|chat'])
    })
    expect(commitPublishedLocalSnapshot).toHaveBeenCalledTimes(1)
    expect(drafts).toEqual([])
    expect(stateRef.current.conversations[0].messages).toEqual([])
    expect(options).toEqual([undefined, { autoSync: false }])
  })

  it('keeps the draft when an offline queued text turn cannot be saved', () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData([conversation()], [activeProvider]),
    }
    const updateData = vi.fn(() => null)
    const notices: string[] = []
    const drafts: string[] = []

    const queued = queueOfflineTextMessage({
      activeConversation: stateRef.current.conversations[0],
      activeProvider,
      content: 'Offline prompt',
      idFactory: vi.fn(() => 'unused-id'),
      model: 'offline-model',
      nowMs: () => 42,
      setDraft: (value) => drafts.push(value),
      setNotice: (message, tone, target) =>
        notices.push(`${message}|${tone}|${target}`),
      t,
      updateData,
    })

    expect(queued).toBe(false)
    expect(drafts).toEqual([])
    expect(notices).toEqual(['notice.messageSaveUnavailable|error|chat'])
    expect(stateRef.current.conversations[0].messages).toEqual([])
  })

  it('contains offline queued success notice reporter failures after saving and clearing draft', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData([conversation()], [activeProvider]),
    }
    const { updateData } = updaterFor(stateRef)
    const drafts: string[] = []
    const ids = ['user-queued', 'assistant-queued']

    const queued = queueOfflineTextMessage({
      activeConversation: stateRef.current.conversations[0],
      activeProvider,
      commitPublishedLocalSnapshot: async () => undefined,
      content: 'Offline prompt',
      idFactory: () => ids.shift() ?? 'extra-id',
      model: 'offline-model',
      nowMs: () => 42,
      setDraft: (value) => drafts.push(value),
      setNotice: () => {
        throw new Error('notice exploded')
      },
      t,
      updateData,
    })

    expect(queued).toBe(true)
    await vi.waitFor(() => {
      expect(drafts).toEqual([''])
    })
    expect(stateRef.current.conversations[0].messages).toHaveLength(2)
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      id: 'assistant-queued',
      content: 'message.offlineQueued',
      status: 'queued',
    })
  })

  it('contains offline queue save-failure notice reporter failures without clearing draft', () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData([conversation()], [activeProvider]),
    }
    const updateData = vi.fn(() => null)
    const drafts: string[] = []

    const queued = queueOfflineTextMessage({
      activeConversation: stateRef.current.conversations[0],
      activeProvider,
      content: 'Offline prompt',
      idFactory: vi.fn(() => 'unused-id'),
      model: 'offline-model',
      nowMs: () => 42,
      setDraft: (value) => drafts.push(value),
      setNotice: () => {
        throw new Error('notice exploded')
      },
      t,
      updateData,
    })

    expect(queued).toBe(false)
    expect(drafts).toEqual([])
    expect(stateRef.current.conversations[0].messages).toEqual([])
  })

  it('flushes queued text through the provider stream and schedules sync after completion', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData([queuedConversation(activeProvider)], [activeProvider]),
    }
    const { options, updateData } = updaterFor(stateRef)
    const sendingEvents: string[] = []
    const notices: string[] = []
    const streamedContent: string[] = []
    const syncedSnapshots: AppData[] = []
    const retryOptions: unknown[] = []
    const streamAssistantText = vi.fn(
      async (options: StreamAssistantTextOptions) => {
        expect(options.apiKey).toBe('sk-test')
        expect(options.proxyToken).toBe('')
        expect(options.latestInput).toBe('Hello offline')
        options.onToken('Hello ')
        options.onToken('world')
      },
    )

    await flushQueuedOfflineTextMessages({
      abortRef: { current: null },
      accessKeyFromPassword: vi.fn(async () => 'proxy-token'),
      chatContextMessageLimit: 8,
      dataRef: stateRef,
      errorMessage: (error) => String(error),
      flushStreamingAssistantContent: (_conversationId, _messageId, content) =>
        streamedContent.push(content),
      isOnlineRef: { current: true },
      offlineQueueRunningRef: { current: false },
      onQueueRunFinished: () => sendingEvents.push('finished'),
      onQueueRunStarted: () => sendingEvents.push('started'),
      providerKeysRef: { current: { [activeProvider.id]: 'sk-test' } },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation, options) => {
        retryOptions.push(options)
        return operation()
      },
      scheduleAutoSync: (snapshot) => syncedSnapshots.push(snapshot),
      setNotice: (message) => notices.push(message),
      streamAssistantText,
      syncPassphraseRef: { current: 'sync-passphrase' },
      t,
      updateData,
    })

    const assistant = stateRef.current?.conversations[0].messages[1]

    expect(streamAssistantText).toHaveBeenCalledTimes(1)
    expect(streamedContent).toEqual(['Hello ', 'Hello world'])
    expect(assistant).toMatchObject({
      id: 'assistant-1',
      content: 'Hello world',
      status: 'done',
      error: undefined,
    })
    expect(sendingEvents).toEqual(['started', 'finished'])
    expect(notices).toEqual([''])
    expect(retryOptions).toHaveLength(1)
    expect(syncedSnapshots).toHaveLength(1)
    expect(options).toEqual([{ autoSync: false }, { autoSync: false }])
  })

  it('persists the replay claim before the provider request', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData([queuedConversation(activeProvider)], [activeProvider]),
    }
    const { updateData } = updaterFor(stateRef)
    const claim = deferred<void>()
    const commitPublishedLocalSnapshot = vi.fn(
      async (
        snapshot: AppData,
        precondition?: Parameters<
          FlushQueuedOfflineTextMessagesOptions['commitPublishedLocalSnapshot']
        >[1],
      ) => {
        await claim.promise
        precondition?.onOutcome?.(
          precondition.isSatisfied(snapshot) ? snapshot : null,
        )
      },
    )
    const streamAssistantText = vi.fn(async () => undefined)

    const flush = flushQueuedOfflineTextMessages({
      abortRef: { current: null },
      chatContextMessageLimit: 8,
      dataRef: stateRef,
      errorMessage: (error) => String(error),
      flushStreamingAssistantContent: vi.fn(),
      isOnlineRef: { current: true },
      offlineQueueRunningRef: { current: false },
      onQueueRunFinished: vi.fn(),
      onQueueRunStarted: vi.fn(),
      commitPublishedLocalSnapshot,
      providerKeysRef: { current: { [activeProvider.id]: 'sk-test' } },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync: vi.fn(),
      setNotice: vi.fn(),
      streamAssistantText,
      syncPassphraseRef: { current: '' },
      t,
      updateData,
    })

    await vi.waitFor(() => {
      expect(commitPublishedLocalSnapshot).toHaveBeenCalledTimes(1)
    })
    expect(commitPublishedLocalSnapshot.mock.calls[0][0].conversations[0].messages[1]).toMatchObject({
      id: 'assistant-1',
      status: 'streaming',
      queuedTextRequest: {
        providerId: activeProvider.id,
        model: activeProvider.model,
      },
      offlineReplayClaim: {
        claimId: expect.any(String),
        owner: expect.any(String),
      },
    })
    expect(streamAssistantText).not.toHaveBeenCalled()

    claim.resolve(undefined)
    await flush

    expect(streamAssistantText).toHaveBeenCalledTimes(1)
  })

  it('keeps the first durable replay claim when concurrent snapshots merge', () => {
    const activeProvider = provider()
    const base = appData([queuedConversation(activeProvider)], [activeProvider])
    const claimSnapshot = (
      claimId: string,
      owner: string,
      updatedAt: number,
    ): AppData => ({
      ...base,
      conversations: base.conversations.map((item) => ({
        ...item,
        messages: item.messages.map((message) =>
          message.id === 'assistant-1'
            ? {
                ...message,
                content: '',
                status: 'streaming',
                offlineReplayClaim: { claimId, owner },
              }
            : message,
        ),
        updatedAt,
      })),
      updatedAt,
    })

    const remote = claimSnapshot('claim-first', 'tab-first', 20)
    const local = claimSnapshot('claim-second', 'tab-second', 30)
    const merged = mergeConcurrentAppData(base, remote, local, 40)

    expect(
      merged.conversations[0].messages.find(
        (message) => message.id === 'assistant-1',
      )?.offlineReplayClaim,
    ).toEqual({
      claimId: 'claim-first',
      owner: 'tab-first',
    })
  })

  it('allows exactly one provider request across two revision-backed local-save queues', async () => {
    const activeProvider = provider()
    const initialSnapshot = appData(
      [queuedConversation(activeProvider)],
      [activeProvider],
    )
    const store = createRevisionFakeStore(initialSnapshot)
    const requestCounts = [0, 0]

    const createTab = (index: number) => {
      const stateRef = { current: cloneAppData(initialSnapshot) }
      const client = store.createClient()
      const { updateData } = updaterFor(stateRef)
      const localSaveQueue = createLocalSaveQueue({
        onError: vi.fn(),
        onSnapshotRebased: (snapshot) => {
          stateRef.current = snapshot
        },
        readCurrentSnapshot: () => stateRef.current,
        recoverSaveConflict: (error, base, local, precondition) =>
          recoverAppDataWriteConflict(
            error,
            base,
            local,
            client,
            precondition,
          ),
        save: client.save,
      })
      localSaveQueue.markPersistedSnapshot(stateRef.current)

      return flushQueuedOfflineTextMessages({
        abortRef: { current: null },
        chatContextMessageLimit: 8,
        commitPublishedLocalSnapshot:
          localSaveQueue.commitPublishedLocalSnapshot,
        dataRef: stateRef,
        errorMessage: (error) => String(error),
        flushStreamingAssistantContent: vi.fn(),
        isOnlineRef: { current: true },
        offlineQueueRunningRef: { current: false },
        onQueueRunFinished: vi.fn(),
        onQueueRunStarted: vi.fn(),
        providerKeysRef: { current: { [activeProvider.id]: 'fake-key' } },
        replayClaimIdFactory: () => `claim-${index}`,
        replayClaimOwner: `tab-${index}`,
        resetAssistantForRetry: vi.fn(),
        runGenerationWithAutoRetry: async (operation) => operation(),
        scheduleAutoSync: vi.fn(),
        setNotice: vi.fn(),
        streamAssistantText: async (options) => {
          requestCounts[index] += 1
          options.onToken(`answer-${index}`)
        },
        syncPassphraseRef: { current: '' },
        t,
        updateData,
      })
    }

    await Promise.all([createTab(0), createTab(1)])

    expect([...requestCounts].sort()).toEqual([0, 1])
    expect(requestCounts[0] + requestCounts[1]).toBe(1)
    expect(store.conflictCount()).toBe(1)
    const persistedAssistant =
      store.read().conversations[0].messages[1]
    expect(persistedAssistant.status).toBe('done')
    expect(persistedAssistant.offlineReplayClaim).toBeUndefined()
    expect(persistedAssistant.queuedTextRequest).toBeUndefined()
  })

  it('does not contact the provider when another tab wins the replay claim', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData([queuedConversation(activeProvider)], [activeProvider]),
    }
    const { options, updateData } = updaterFor(stateRef)
    const commitPublishedLocalSnapshot = vi.fn(async () => {
      throw new Error('cross-tab write conflict')
    })
    const streamAssistantText = vi.fn(async () => undefined)
    const notices: string[] = []

    await flushQueuedOfflineTextMessages({
      abortRef: { current: null },
      chatContextMessageLimit: 8,
      dataRef: stateRef,
      errorMessage: (error) => String(error),
      flushStreamingAssistantContent: vi.fn(),
      isOnlineRef: { current: true },
      offlineQueueRunningRef: { current: false },
      onQueueRunFinished: vi.fn(),
      onQueueRunStarted: vi.fn(),
      commitPublishedLocalSnapshot,
      providerKeysRef: { current: { [activeProvider.id]: 'sk-test' } },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync: vi.fn(),
      setNotice: (message, tone, target, anchorId) =>
        notices.push(`${message}|${tone}|${target}|${anchorId}`),
      streamAssistantText,
      syncPassphraseRef: { current: '' },
      t,
      updateData,
    })

    expect(commitPublishedLocalSnapshot).toHaveBeenCalledTimes(1)
    expect(streamAssistantText).not.toHaveBeenCalled()
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      id: 'assistant-1',
      content: 'message.offlineQueued',
      status: 'queued',
      queuedTextRequest: {
        providerId: activeProvider.id,
        model: activeProvider.model,
      },
    })
    expect(notices).toEqual([
      'notice.messageSaveUnavailable|error|message|assistant-1',
    ])
    expect(options).toEqual([{ autoSync: false }, { autoSync: false }])
  })

  it('persists completion before clearing notice and scheduling sync', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData([queuedConversation(activeProvider)], [activeProvider]),
    }
    const { updateData } = updaterFor(stateRef)
    const completion = deferred<void>()
    const commitPublishedLocalSnapshot = vi.fn((snapshot: AppData) => {
      const assistant = snapshot.conversations[0].messages[1]
      return assistant.status === 'done'
        ? completion.promise
        : Promise.resolve()
    })
    const scheduleAutoSync = vi.fn()
    const notices: string[] = []

    const flush = flushQueuedOfflineTextMessages({
      abortRef: { current: null },
      chatContextMessageLimit: 8,
      dataRef: stateRef,
      errorMessage: (error) => String(error),
      flushStreamingAssistantContent: vi.fn(),
      isOnlineRef: { current: true },
      offlineQueueRunningRef: { current: false },
      onQueueRunFinished: vi.fn(),
      onQueueRunStarted: vi.fn(),
      commitPublishedLocalSnapshot,
      providerKeysRef: { current: { [activeProvider.id]: 'sk-test' } },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync,
      setNotice: (message) => notices.push(message),
      streamAssistantText: async (options) => options.onToken('answer'),
      syncPassphraseRef: { current: '' },
      t,
      updateData,
    })

    await vi.waitFor(() => {
      expect(commitPublishedLocalSnapshot).toHaveBeenCalledTimes(2)
    })
    expect(commitPublishedLocalSnapshot.mock.calls[1][0].conversations[0].messages[1]).toMatchObject({
      content: 'answer',
      status: 'done',
    })
    expect(scheduleAutoSync).not.toHaveBeenCalled()
    expect(notices).toEqual([])

    completion.resolve(undefined)
    await flush

    expect(scheduleAutoSync).toHaveBeenCalledTimes(1)
    expect(notices).toEqual([''])
  })

  it('does not sync an offline replay completion that failed to persist', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData([queuedConversation(activeProvider)], [activeProvider]),
    }
    const { updateData } = updaterFor(stateRef)
    let persistCount = 0
    const commitPublishedLocalSnapshot = vi.fn(async () => {
      persistCount += 1
      if (persistCount === 2) {
        throw new Error('completion write failed')
      }
    })
    const scheduleAutoSync = vi.fn()
    const notices: string[] = []

    await flushQueuedOfflineTextMessages({
      abortRef: { current: null },
      chatContextMessageLimit: 8,
      dataRef: stateRef,
      errorMessage: (error) => String(error),
      flushStreamingAssistantContent: vi.fn(),
      isOnlineRef: { current: true },
      offlineQueueRunningRef: { current: false },
      onQueueRunFinished: vi.fn(),
      onQueueRunStarted: vi.fn(),
      commitPublishedLocalSnapshot,
      providerKeysRef: { current: { [activeProvider.id]: 'sk-test' } },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync,
      setNotice: (message, tone, target, anchorId) =>
        notices.push(`${message}|${tone}|${target}|${anchorId}`),
      streamAssistantText: async (options) => options.onToken('answer'),
      syncPassphraseRef: { current: '' },
      t,
      updateData,
    })

    expect(commitPublishedLocalSnapshot).toHaveBeenCalledTimes(2)
    expect(scheduleAutoSync).not.toHaveBeenCalled()
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      content: 'answer',
      status: 'done',
    })
    expect(notices).toEqual([
      'notice.messageSaveUnavailable|error|message|assistant-1',
    ])
  })

  it('replays each queued turn with its captured provider and model', async () => {
    const firstProvider = {
      ...provider('provider-1'),
      model: 'model-1',
    }
    const secondProvider = {
      ...provider('provider-2'),
      model: 'model-2',
    }
    const firstQueued = appendOfflineQueuedTextTurn({
      conversation: conversation(),
      providerId: firstProvider.id,
      model: firstProvider.model,
      content: 'First offline prompt',
      title: 'Offline queue',
      userMessageId: 'user-1',
      assistantMessageId: 'assistant-1',
      createdAt: 10,
      queuedAssistantContent: 'message.offlineQueued',
    })
    const queued = appendOfflineQueuedTextTurn({
      conversation: firstQueued,
      providerId: secondProvider.id,
      model: secondProvider.model,
      content: 'Second offline prompt',
      title: 'Offline queue',
      userMessageId: 'user-2',
      assistantMessageId: 'assistant-2',
      createdAt: 20,
      queuedAssistantContent: 'message.offlineQueued',
    })
    const stateRef = {
      current: appData([queued], [firstProvider, secondProvider]),
    }
    const { updateData } = updaterFor(stateRef)
    const requests: Array<{
      providerId: string
      model: string
      prompt: string
    }> = []

    await flushQueuedOfflineTextMessages({
      abortRef: { current: null },
      chatContextMessageLimit: 8,
      dataRef: stateRef,
      errorMessage: (error) => String(error),
      flushStreamingAssistantContent: vi.fn(),
      isOnlineRef: { current: true },
      offlineQueueRunningRef: { current: false },
      onQueueRunFinished: vi.fn(),
      onQueueRunStarted: vi.fn(),
      providerKeysRef: {
        current: {
          [firstProvider.id]: 'first-key',
          [secondProvider.id]: 'second-key',
        },
      },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync: vi.fn(),
      setNotice: vi.fn(),
      streamAssistantText: async (options) => {
        requests.push({
          providerId: options.provider.id,
          model: options.model,
          prompt: options.latestInput,
        })
        options.onToken(`reply:${options.latestInput}`)
      },
      syncPassphraseRef: { current: '' },
      t,
      updateData,
    })

    expect(requests).toEqual([
      {
        providerId: firstProvider.id,
        model: firstProvider.model,
        prompt: 'First offline prompt',
      },
      {
        providerId: secondProvider.id,
        model: secondProvider.model,
        prompt: 'Second offline prompt',
      },
    ])
    expect(stateRef.current.conversations[0]).toMatchObject({
      providerId: secondProvider.id,
      model: secondProvider.model,
    })
    expect(
      stateRef.current.conversations[0].messages.filter(
        (message) => message.role === 'assistant',
      ),
    ).toEqual([
      expect.objectContaining({
        id: 'assistant-1',
        content: 'reply:First offline prompt',
        status: 'done',
      }),
      expect.objectContaining({
        id: 'assistant-2',
        content: 'reply:Second offline prompt',
        status: 'done',
      }),
    ])
    expect(
      stateRef.current.conversations[0].messages.some(
        (message) => message.queuedTextRequest !== undefined,
      ),
    ).toBe(false)
  })

  it('does not reroute a queued turn when its captured provider is disabled', async () => {
    const disabledProvider = {
      ...provider('provider-disabled'),
      enabled: false,
      model: 'disabled-model',
    }
    const fallbackProvider = provider('provider-enabled')
    const stateRef = {
      current: appData(
        [queuedConversation(disabledProvider)],
        [disabledProvider, fallbackProvider],
      ),
    }
    const { updateData } = updaterFor(stateRef)
    const streamAssistantText = vi.fn()

    await flushQueuedOfflineTextMessages({
      abortRef: { current: null },
      chatContextMessageLimit: 8,
      dataRef: stateRef,
      errorMessage: (error) => String(error),
      flushStreamingAssistantContent: vi.fn(),
      isOnlineRef: { current: true },
      offlineQueueRunningRef: { current: false },
      onQueueRunFinished: vi.fn(),
      onQueueRunStarted: vi.fn(),
      providerKeysRef: { current: { [fallbackProvider.id]: 'fallback-key' } },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync: vi.fn(),
      setNotice: vi.fn(),
      streamAssistantText,
      syncPassphraseRef: { current: '' },
      t,
      updateData,
    })

    expect(streamAssistantText).not.toHaveBeenCalled()
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      content: 'error.apiUnavailable',
      status: 'error',
      error: 'error.apiUnavailable',
    })
    expect(
      stateRef.current.conversations[0].messages[1].queuedTextRequest,
    ).toBeUndefined()
  })

  it('persists orphaned queued turns as errors before sending later valid turns', async () => {
    const activeProvider = provider()
    const orphanedAssistant: ChatMessage = {
      id: 'assistant-orphaned',
      role: 'assistant',
      content: 'message.offlineQueued',
      createdAt: 2,
      status: 'queued',
      queuedTextRequest: {
        providerId: activeProvider.id,
        model: activeProvider.model,
        promptMessageId: 'user-missing',
      },
    }
    const validTurn = appendOfflineQueuedTextTurn({
      conversation: conversation(),
      providerId: activeProvider.id,
      model: activeProvider.model,
      content: 'Valid offline prompt',
      title: 'Valid offline prompt',
      userMessageId: 'user-valid',
      assistantMessageId: 'assistant-valid',
      createdAt: 3,
      queuedAssistantContent: 'message.offlineQueued',
    })
    const queued = conversation([
      {
        id: 'user-old',
        role: 'user',
        content: 'Do not replay this prompt',
        createdAt: 1,
        status: 'done',
      },
      orphanedAssistant,
      ...validTurn.messages,
    ])
    const stateRef = {
      current: appData([queued], [activeProvider]),
    }
    const { updateData } = updaterFor(stateRef)
    const committedSnapshots: AppData[] = []
    const streamAssistantText = vi.fn(
      async (options: StreamAssistantTextOptions) => {
        options.onToken('Valid reply')
      },
    )

    await flushQueuedOfflineTextMessages({
      abortRef: { current: null },
      chatContextMessageLimit: 8,
      commitPublishedLocalSnapshot: async (snapshot, precondition) => {
        committedSnapshots.push(cloneAppData(snapshot))
        precondition?.onOutcome?.(
          precondition.isSatisfied(snapshot) ? snapshot : null,
        )
      },
      dataRef: stateRef,
      errorMessage: (error) => String(error),
      flushStreamingAssistantContent: vi.fn(),
      isOnlineRef: { current: true },
      offlineQueueRunningRef: { current: false },
      onQueueRunFinished: vi.fn(),
      onQueueRunStarted: vi.fn(),
      providerKeysRef: { current: { [activeProvider.id]: 'provider-key' } },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync: vi.fn(),
      setNotice: vi.fn(),
      streamAssistantText,
      syncPassphraseRef: { current: '' },
      t,
      updateData,
    })

    expect(streamAssistantText).toHaveBeenCalledTimes(1)
    expect(streamAssistantText).toHaveBeenCalledWith(
      expect.objectContaining({ latestInput: 'Valid offline prompt' }),
    )
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      id: 'assistant-orphaned',
      content: 'notice.offlinePromptUnavailable',
      status: 'error',
      error: 'notice.offlinePromptUnavailable',
    })
    expect(
      stateRef.current.conversations[0].messages[1].queuedTextRequest,
    ).toBeUndefined()
    expect(stateRef.current.conversations[0].messages[3]).toMatchObject({
      id: 'assistant-valid',
      content: 'Valid reply',
      status: 'done',
    })
    expect(committedSnapshots[0].conversations[0].messages[1]).toMatchObject({
      id: 'assistant-orphaned',
      status: 'error',
    })
  })

  it('defers replay while another generation owns cancellation', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData([queuedConversation(activeProvider)], [activeProvider]),
    }
    const activeController = new AbortController()
    const abortRef = { current: activeController }
    const offlineQueueRunningRef = { current: false }
    const onQueueRunStarted = vi.fn()
    const onQueueRunFinished = vi.fn()
    const accessKeyFromPassword = vi.fn(async () => 'proxy-token')
    const streamAssistantText = vi.fn(
      async (options: StreamAssistantTextOptions) => {
        void options
      },
    )

    await flushQueuedOfflineTextMessages({
      abortRef,
      accessKeyFromPassword,
      chatContextMessageLimit: 8,
      dataRef: stateRef,
      errorMessage: (error) => String(error),
      flushStreamingAssistantContent: vi.fn(),
      isOnlineRef: { current: true },
      offlineQueueRunningRef,
      onQueueRunFinished,
      onQueueRunStarted,
      providerKeysRef: { current: { [activeProvider.id]: 'sk-test' } },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync: vi.fn(),
      setNotice: vi.fn(),
      streamAssistantText,
      syncPassphraseRef: { current: 'sync-passphrase' },
      t,
      updateData: vi.fn(),
    })

    expect(abortRef.current).toBe(activeController)
    expect(offlineQueueRunningRef.current).toBe(false)
    expect(onQueueRunStarted).not.toHaveBeenCalled()
    expect(onQueueRunFinished).not.toHaveBeenCalled()
    expect(accessKeyFromPassword).not.toHaveBeenCalled()
    expect(streamAssistantText).not.toHaveBeenCalled()
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      content: 'message.offlineQueued',
      status: 'queued',
    })
  })

  it('preserves a newer generation controller after queued completion', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData([queuedConversation(activeProvider)], [activeProvider]),
    }
    const { updateData } = updaterFor(stateRef)
    const abortRef: { current: AbortController | null } = { current: null }
    const replacementController = new AbortController()

    await flushQueuedOfflineTextMessages({
      abortRef,
      chatContextMessageLimit: 8,
      dataRef: stateRef,
      errorMessage: (error) => String(error),
      flushStreamingAssistantContent: vi.fn(),
      isOnlineRef: { current: true },
      offlineQueueRunningRef: { current: false },
      onQueueRunFinished: vi.fn(),
      onQueueRunStarted: vi.fn(),
      providerKeysRef: { current: { [activeProvider.id]: 'sk-test' } },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync: vi.fn(),
      setNotice: vi.fn(),
      streamAssistantText: async (options) => {
        abortRef.current = replacementController
        options.onToken('Hello world')
      },
      syncPassphraseRef: { current: '' },
      t,
      updateData,
    })

    expect(abortRef.current).toBe(replacementController)
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      content: 'Hello world',
      status: 'done',
    })
  })

  it('keeps a queued turn queued when replay start cannot be saved', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData([queuedConversation(activeProvider)], [activeProvider]),
    }
    const sendingEvents: string[] = []
    const notices: string[] = []
    const syncedSnapshots: AppData[] = []
    const streamAssistantText = vi.fn(
      async (options: StreamAssistantTextOptions) => {
        void options
      },
    )
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

    await flushQueuedOfflineTextMessages({
      abortRef: { current: null },
      accessKeyFromPassword: vi.fn(async () => 'proxy-token'),
      chatContextMessageLimit: 8,
      dataRef: stateRef,
      errorMessage: (error) => String(error),
      flushStreamingAssistantContent: vi.fn(),
      isOnlineRef: { current: true },
      offlineQueueRunningRef: { current: false },
      onQueueRunFinished: () => sendingEvents.push('finished'),
      onQueueRunStarted: () => sendingEvents.push('started'),
      providerKeysRef: { current: { [activeProvider.id]: 'sk-test' } },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync: (snapshot) => syncedSnapshots.push(snapshot),
      setNotice: (message, tone, target, anchorId) =>
        notices.push(`${message}|${tone}|${target}|${anchorId}`),
      streamAssistantText,
      syncPassphraseRef: { current: 'sync-passphrase' },
      t,
      updateData,
    })

    expect(updateData).toHaveBeenCalledTimes(1)
    expect(updateData.mock.calls[0][1]).toEqual({ autoSync: false })
    expect(streamAssistantText).not.toHaveBeenCalled()
    expect(notices).toEqual([
      'notice.messageSaveUnavailable|error|message|assistant-1',
    ])
    expect(syncedSnapshots).toEqual([])
    expect(sendingEvents).toEqual(['started', 'finished'])
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      id: 'assistant-1',
      content: 'message.offlineQueued',
      status: 'queued',
    })
  })

  it('contains replay start save-failure notice reporter failures without streaming', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData([queuedConversation(activeProvider)], [activeProvider]),
    }
    const sendingEvents: string[] = []
    const syncedSnapshots: AppData[] = []
    const streamAssistantText = vi.fn(
      async (options: StreamAssistantTextOptions) => {
        void options
      },
    )
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

    await flushQueuedOfflineTextMessages({
      abortRef: { current: null },
      accessKeyFromPassword: vi.fn(async () => 'proxy-token'),
      chatContextMessageLimit: 8,
      dataRef: stateRef,
      errorMessage: (error) => String(error),
      flushStreamingAssistantContent: vi.fn(),
      isOnlineRef: { current: true },
      offlineQueueRunningRef: { current: false },
      onQueueRunFinished: () => sendingEvents.push('finished'),
      onQueueRunStarted: () => sendingEvents.push('started'),
      providerKeysRef: { current: { [activeProvider.id]: 'sk-test' } },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync: (snapshot) => syncedSnapshots.push(snapshot),
      setNotice: () => {
        throw new Error('notice exploded')
      },
      streamAssistantText,
      syncPassphraseRef: { current: 'sync-passphrase' },
      t,
      updateData,
    })

    expect(streamAssistantText).not.toHaveBeenCalled()
    expect(syncedSnapshots).toEqual([])
    expect(sendingEvents).toEqual(['started', 'finished'])
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      id: 'assistant-1',
      content: 'message.offlineQueued',
      status: 'queued',
    })
  })

  it('surfaces queued completion save failures before scheduling sync', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData([queuedConversation(activeProvider)], [activeProvider]),
    }
    const notices: string[] = []
    const streamedContent: string[] = []
    const syncedSnapshots: AppData[] = []
    const streamAssistantText = vi.fn(
      async (options: StreamAssistantTextOptions) => {
        options.onToken('Hello world')
      },
    )
    let updateAttempt = 0
    const updateData = vi.fn(
      (
        updater: (current: AppData) => AppData,
        updateOptions?: { autoSync?: boolean },
      ) => {
        updateAttempt += 1
        if (
          updateAttempt === 1 &&
          updateOptions?.autoSync === false &&
          stateRef.current
        ) {
          stateRef.current = updater(stateRef.current)
          return stateRef.current
        }

        return null
      },
    )

    await flushQueuedOfflineTextMessages({
      abortRef: { current: null },
      accessKeyFromPassword: vi.fn(async () => 'proxy-token'),
      chatContextMessageLimit: 8,
      dataRef: stateRef,
      errorMessage: (error) => String(error),
      flushStreamingAssistantContent: (_conversationId, _messageId, content) =>
        streamedContent.push(content),
      isOnlineRef: { current: true },
      offlineQueueRunningRef: { current: false },
      onQueueRunFinished: vi.fn(),
      onQueueRunStarted: vi.fn(),
      providerKeysRef: { current: { [activeProvider.id]: 'sk-test' } },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync: (snapshot) => syncedSnapshots.push(snapshot),
      setNotice: (message, tone, target, anchorId) =>
        notices.push(`${message}|${tone}|${target}|${anchorId}`),
      streamAssistantText,
      syncPassphraseRef: { current: 'sync-passphrase' },
      t,
      updateData,
    })

    expect(streamAssistantText).toHaveBeenCalledTimes(1)
    expect(updateData).toHaveBeenNthCalledWith(
      2,
      expect.any(Function),
      { autoSync: false },
    )
    expect(streamedContent).toEqual(['Hello world'])
    expect(notices).toEqual([
      'notice.messageSaveUnavailable|error|message|assistant-1',
    ])
    expect(syncedSnapshots).toEqual([])
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      id: 'assistant-1',
      content: '',
      status: 'streaming',
    })
  })

  it('marks queued proxy turns failed when access-key derivation fails before streaming', async () => {
    const activeProvider = {
      ...provider(),
      needsApiKey: false,
      proxyUrl: 'https://worker.example.com',
    }
    const stateRef = {
      current: appData([queuedConversation(activeProvider)], [activeProvider]),
    }
    const { updateData } = updaterFor(stateRef)
    const sendingEvents: string[] = []
    const notices: string[] = []
    const streamAssistantText = vi.fn(
      async (options: StreamAssistantTextOptions) => {
        void options
      },
    )

    await flushQueuedOfflineTextMessages({
      abortRef: { current: null },
      accessKeyFromPassword: vi.fn(async () => {
        throw new Error('crypto unavailable')
      }),
      chatContextMessageLimit: 8,
      dataRef: stateRef,
      errorMessage: (error) =>
        error instanceof Error ? error.message : String(error),
      flushStreamingAssistantContent: vi.fn(),
      isOnlineRef: { current: true },
      offlineQueueRunningRef: { current: false },
      onQueueRunFinished: () => sendingEvents.push('finished'),
      onQueueRunStarted: () => sendingEvents.push('started'),
      providerKeysRef: { current: {} },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync: vi.fn(),
      setNotice: (message, tone, target, anchorId) =>
        notices.push(`${message}|${tone}|${target}|${anchorId}`),
      streamAssistantText,
      syncPassphraseRef: { current: 'sync-passphrase' },
      t,
      updateData,
    })

    expect(stateRef.current?.conversations[0].messages[1]).toMatchObject({
      id: 'assistant-1',
      content:
        'notice.messageGenerationFailed:{"message":"crypto unavailable"}',
      status: 'error',
      error: 'notice.messageGenerationFailed:{"message":"crypto unavailable"}',
    })
    expect(notices).toEqual([
      'notice.messageGenerationFailed:{"message":"crypto unavailable"}|error|message|assistant-1',
    ])
    expect(sendingEvents).toEqual(['started', 'finished'])
    expect(streamAssistantText).not.toHaveBeenCalled()
  })

  it('claims cancellation before proxy key derivation and stops the queue run', async () => {
    const activeProvider = {
      ...provider(),
      needsApiKey: false,
      proxyUrl: 'https://worker.example.com',
    }
    const firstConversation = queuedConversation(activeProvider)
    const secondConversation = {
      ...queuedConversation(activeProvider),
      id: 'conversation-2',
      messages: queuedConversation(activeProvider).messages.map(
        (message, index) =>
          index === 0
            ? { ...message, id: 'user-2' }
            : {
                ...message,
                id: 'assistant-2',
                queuedTextRequest: message.queuedTextRequest
                  ? {
                      ...message.queuedTextRequest,
                      promptMessageId: 'user-2',
                    }
                  : undefined,
              },
      ),
    }
    const stateRef = {
      current: appData(
        [firstConversation, secondConversation],
        [activeProvider],
      ),
    }
    const { updateData } = updaterFor(stateRef)
    const abortRef: { current: AbortController | null } = { current: null }
    const accessKey = deferred<string>()
    const sendingEvents: string[] = []
    const streamAssistantText = vi.fn(
      async (options: StreamAssistantTextOptions) => {
        void options
      },
    )

    const flush = flushQueuedOfflineTextMessages({
      abortRef,
      accessKeyFromPassword: () => accessKey.promise,
      chatContextMessageLimit: 8,
      dataRef: stateRef,
      errorMessage: (error) => String(error),
      flushStreamingAssistantContent: vi.fn(),
      isOnlineRef: { current: true },
      offlineQueueRunningRef: { current: false },
      onQueueRunFinished: () => sendingEvents.push('finished'),
      onQueueRunStarted: () => sendingEvents.push('started'),
      providerKeysRef: { current: {} },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync: vi.fn(),
      setNotice: vi.fn(),
      streamAssistantText,
      syncPassphraseRef: { current: 'sync-passphrase' },
      t,
      updateData,
    })

    await vi.waitFor(() => {
      expect(abortRef.current).toBeInstanceOf(AbortController)
    })
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      content: 'message.offlineQueued',
      status: 'queued',
    })

    abortRef.current?.abort()
    accessKey.resolve('proxy-token')
    await flush

    expect(streamAssistantText).not.toHaveBeenCalled()
    expect(abortRef.current).toBeNull()
    expect(sendingEvents).toEqual(['started', 'finished'])
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      content: 'notice.stopped',
      status: 'done',
      error: undefined,
    })
    expect(stateRef.current.conversations[1].messages[1]).toMatchObject({
      id: 'assistant-2',
      content: 'message.offlineQueued',
      status: 'queued',
    })
  })

  it('contains queued access-key failure notice reporter failures after marking assistant failed', async () => {
    const activeProvider = {
      ...provider(),
      needsApiKey: false,
      proxyUrl: 'https://worker.example.com',
    }
    const stateRef = {
      current: appData([queuedConversation(activeProvider)], [activeProvider]),
    }
    const { updateData } = updaterFor(stateRef)
    const sendingEvents: string[] = []
    const streamAssistantText = vi.fn(
      async (options: StreamAssistantTextOptions) => {
        void options
      },
    )

    await flushQueuedOfflineTextMessages({
      abortRef: { current: null },
      accessKeyFromPassword: vi.fn(async () => {
        throw new Error('crypto unavailable')
      }),
      chatContextMessageLimit: 8,
      dataRef: stateRef,
      errorMessage: (error) =>
        error instanceof Error ? error.message : String(error),
      flushStreamingAssistantContent: vi.fn(),
      isOnlineRef: { current: true },
      offlineQueueRunningRef: { current: false },
      onQueueRunFinished: () => sendingEvents.push('finished'),
      onQueueRunStarted: () => sendingEvents.push('started'),
      providerKeysRef: { current: {} },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync: vi.fn(),
      setNotice: () => {
        throw new Error('notice exploded')
      },
      streamAssistantText,
      syncPassphraseRef: { current: 'sync-passphrase' },
      t,
      updateData,
    })

    expect(stateRef.current?.conversations[0].messages[1]).toMatchObject({
      id: 'assistant-1',
      content:
        'notice.messageGenerationFailed:{"message":"crypto unavailable"}',
      status: 'error',
      error: 'notice.messageGenerationFailed:{"message":"crypto unavailable"}',
    })
    expect(sendingEvents).toEqual(['started', 'finished'])
    expect(streamAssistantText).not.toHaveBeenCalled()
  })

  it('contains queued completion clear-notice reporter failures while scheduling sync', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData([queuedConversation(activeProvider)], [activeProvider]),
    }
    const { options, updateData } = updaterFor(stateRef)
    const syncedSnapshots: AppData[] = []
    const streamAssistantText = vi.fn(
      async (options: StreamAssistantTextOptions) => {
        options.onToken('Hello world')
      },
    )

    await flushQueuedOfflineTextMessages({
      abortRef: { current: null },
      accessKeyFromPassword: vi.fn(async () => 'proxy-token'),
      chatContextMessageLimit: 8,
      dataRef: stateRef,
      errorMessage: (error) => String(error),
      flushStreamingAssistantContent: vi.fn(),
      isOnlineRef: { current: true },
      offlineQueueRunningRef: { current: false },
      onQueueRunFinished: vi.fn(),
      onQueueRunStarted: vi.fn(),
      providerKeysRef: { current: { [activeProvider.id]: 'sk-test' } },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync: (snapshot) => syncedSnapshots.push(snapshot),
      setNotice: () => {
        throw new Error('notice exploded')
      },
      streamAssistantText,
      syncPassphraseRef: { current: 'sync-passphrase' },
      t,
      updateData,
    })

    expect(stateRef.current?.conversations[0].messages[1]).toMatchObject({
      id: 'assistant-1',
      content: 'Hello world',
      status: 'done',
      error: undefined,
    })
    expect(syncedSnapshots).toHaveLength(1)
    expect(options).toEqual([{ autoSync: false }, { autoSync: false }])
  })

  it('keeps a queued turn queued when the connection drops during flush', async () => {
    const activeProvider = provider()
    const stateRef = {
      current: appData([queuedConversation(activeProvider)], [activeProvider]),
    }
    const { updateData } = updaterFor(stateRef)
    const isOnlineRef = { current: true }
    const syncedSnapshots: AppData[] = []
    const streamAssistantText = vi.fn(
      async (options: StreamAssistantTextOptions) => {
        options.onToken('partial')
        isOnlineRef.current = false
        throw new Error('network down')
      },
    )

    await flushQueuedOfflineTextMessages({
      abortRef: { current: null },
      accessKeyFromPassword: vi.fn(async () => ''),
      chatContextMessageLimit: 8,
      dataRef: stateRef,
      errorMessage: (error) =>
        error instanceof Error ? error.message : String(error),
      flushStreamingAssistantContent: vi.fn(),
      isOnlineRef,
      offlineQueueRunningRef: { current: false },
      onQueueRunFinished: vi.fn(),
      onQueueRunStarted: vi.fn(),
      providerKeysRef: { current: { [activeProvider.id]: 'sk-test' } },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: async (operation) => operation(),
      scheduleAutoSync: (snapshot) => syncedSnapshots.push(snapshot),
      setNotice: vi.fn(),
      streamAssistantText,
      syncPassphraseRef: { current: '' },
      t,
      updateData,
    })

    expect(stateRef.current?.conversations[0].messages[1]).toMatchObject({
      id: 'assistant-1',
      content: 'partial',
      status: 'queued',
      error: undefined,
    })
    expect(syncedSnapshots).toEqual([])
  })
})
