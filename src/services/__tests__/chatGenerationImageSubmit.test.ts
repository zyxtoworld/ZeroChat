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
import type { RunImageAssistantGenerationOptions } from '../chatGenerationAssistantRun'
import {
  sendImageMessageGeneration as sendImageMessageGenerationRuntime,
  type SendImageMessageGenerationOptions,
} from '../chatGenerationImageSubmit'

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

function sendImageMessageGeneration(
  options: Omit<
    SendImageMessageGenerationOptions,
    | 'commitPublishedLocalSnapshot'
    | 'draftRevision'
    | 'draftRevisionRef'
  > &
    Partial<
      Pick<
        SendImageMessageGenerationOptions,
        | 'commitPublishedLocalSnapshot'
        | 'draftRevision'
        | 'draftRevisionRef'
      >
    >,
): Promise<void> {
  return sendImageMessageGenerationRuntime({
    commitPublishedLocalSnapshot: async () => undefined,
    draftRevision: 0,
    draftRevisionRef: { current: 0 },
    ...options,
  })
}

describe('chat generation image submit runtime', () => {
  it('keeps edit requests out of local history until a source image is selected', async () => {
    const activeProvider = provider()
    const stateRef = { current: appData([conversation()], [activeProvider]) }
    const { updateData } = updaterFor(stateRef)
    const notices: string[] = []
    const runImageAssistantGeneration = vi.fn(
      async (options: RunImageAssistantGenerationOptions) => {
        void options
      },
    )

    await sendImageMessageGeneration({
      abortRef: { current: null },
      accessKeyFromPassword: async () => '',
      activeConversation: stateRef.current.conversations[0],
      activeImageModel: 'image-model',
      activeModel: 'chat-model',
      activeProvider,
      content: 'Edit this',
      data: stateRef.current,
      dataRef: stateRef,
      errorMessage: String,
      finishSending: vi.fn(),
      imageSourceFile: null,
      imageTaskMode: 'edit',
      isOnlineRef: { current: true },
      maskFileFromCanvas: vi.fn(),
      maskTouched: false,
      providerKeys: { 'provider-1': 'key' },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: (operation) => operation(),
      runImageAssistantGeneration,
      scheduleAutoSync: vi.fn(),
      setDraft: vi.fn(),
      setImageSource: vi.fn(),
      setNotice: (message) => notices.push(message),
      startSending: vi.fn(),
      syncPassphraseRef: { current: '' },
      t,
      updateData,
    })

    expect(notices).toEqual(['notice.imageRequired'])
    expect(updateData).not.toHaveBeenCalled()
    expect(runImageAssistantGeneration).not.toHaveBeenCalled()
  })

  it('blocks image generation while offline instead of queueing an unsupported image turn', async () => {
    const activeProvider = provider()
    const stateRef = { current: appData([conversation()], [activeProvider]) }
    const { updateData } = updaterFor(stateRef)
    const notices: Array<{
      message: string
      target: string | undefined
      tone: string | undefined
    }> = []
    const runImageAssistantGeneration = vi.fn(
      async (options: RunImageAssistantGenerationOptions) => {
        void options
      },
    )

    await sendImageMessageGeneration({
      abortRef: { current: null },
      accessKeyFromPassword: async () => '',
      activeConversation: stateRef.current.conversations[0],
      activeImageModel: 'image-model',
      activeModel: 'chat-model',
      activeProvider,
      content: 'Paint a quiet workspace',
      data: stateRef.current,
      dataRef: stateRef,
      errorMessage: String,
      finishSending: vi.fn(),
      imageSourceFile: null,
      imageTaskMode: 'generate',
      isOnlineRef: { current: false },
      maskFileFromCanvas: vi.fn(),
      maskTouched: false,
      providerKeys: { 'provider-1': 'key' },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: (operation) => operation(),
      runImageAssistantGeneration,
      scheduleAutoSync: vi.fn(),
      setDraft: vi.fn(),
      setImageSource: vi.fn(),
      setNotice: (message, tone, target) =>
        notices.push({ message, tone, target }),
      startSending: vi.fn(),
      syncPassphraseRef: { current: '' },
      t,
      updateData,
    })

    expect(notices).toEqual([
      {
        message: 'notice.offlineImageUnavailable',
        tone: 'warning',
        target: 'chat',
      },
    ])
    expect(updateData).not.toHaveBeenCalled()
    expect(runImageAssistantGeneration).not.toHaveBeenCalled()
  })

  it('contains offline image notice reporter failures without leaking the promise', async () => {
    const activeProvider = provider()
    const stateRef = { current: appData([conversation()], [activeProvider]) }
    const { updateData } = updaterFor(stateRef)
    const runImageAssistantGeneration = vi.fn(
      async (options: RunImageAssistantGenerationOptions) => {
        void options
      },
    )

    await expect(
      sendImageMessageGeneration({
        abortRef: { current: null },
        accessKeyFromPassword: async () => '',
        activeConversation: stateRef.current.conversations[0],
        activeImageModel: 'image-model',
        activeModel: 'chat-model',
        activeProvider,
        content: 'Paint a quiet workspace',
        data: stateRef.current,
        dataRef: stateRef,
        errorMessage: String,
        finishSending: vi.fn(),
        imageSourceFile: null,
        imageTaskMode: 'generate',
        isOnlineRef: { current: false },
        maskFileFromCanvas: vi.fn(),
        maskTouched: false,
        providerKeys: { 'provider-1': 'key' },
        resetAssistantForRetry: vi.fn(),
        runGenerationWithAutoRetry: (operation) => operation(),
        runImageAssistantGeneration,
        scheduleAutoSync: vi.fn(),
        setDraft: vi.fn(),
        setImageSource: vi.fn(),
        setNotice: vi.fn(() => {
          throw new Error('notice unavailable')
        }),
        startSending: vi.fn(),
        syncPassphraseRef: { current: '' },
        t,
        updateData,
      }),
    ).resolves.toBeUndefined()

    expect(updateData).not.toHaveBeenCalled()
    expect(runImageAssistantGeneration).not.toHaveBeenCalled()
  })

  it('starts direct browser image generation without deriving a proxy access key', async () => {
    const activeProvider = provider()
    const stateRef = { current: appData([conversation()], [activeProvider]) }
    const { updateData } = updaterFor(stateRef)
    const accessKeyFromPassword = vi.fn(async () => {
      throw new Error('crypto unavailable')
    })
    const runImageAssistantGeneration = vi.fn(
      async (options: RunImageAssistantGenerationOptions) => {
        expect(options.proxyToken).toBe('')
      },
    )

    await sendImageMessageGeneration({
      abortRef: { current: null },
      accessKeyFromPassword,
      activeConversation: stateRef.current.conversations[0],
      activeImageModel: 'image-model',
      activeModel: 'chat-model',
      activeProvider,
      content: 'Paint a quiet workspace',
      data: stateRef.current,
      dataRef: stateRef,
      errorMessage: String,
      finishSending: vi.fn(),
      imageSourceFile: null,
      imageTaskMode: 'generate',
      isOnlineRef: { current: true },
      maskFileFromCanvas: vi.fn(),
      maskTouched: false,
      providerKeys: { 'provider-1': 'key' },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: (operation) => operation(),
      runImageAssistantGeneration,
      scheduleAutoSync: vi.fn(),
      setDraft: vi.fn(),
      setImageSource: vi.fn(),
      setNotice: vi.fn(),
      startSending: vi.fn(),
      syncPassphraseRef: { current: 'sync-passphrase' },
      t,
      updateData,
    })

    expect(accessKeyFromPassword).not.toHaveBeenCalled()
    expect(runImageAssistantGeneration).toHaveBeenCalledTimes(1)
  })

  it('waits for the durable image turn before dispatching generation', async () => {
    const activeProvider = provider()
    const stateRef = { current: appData([conversation()], [activeProvider]) }
    const { updateData } = updaterFor(stateRef)
    const persistence = deferred<void>()
    const commitPublishedLocalSnapshot = vi.fn(() => persistence.promise)
    const runImageAssistantGeneration = vi.fn(async () => undefined)
    const setDraft = vi.fn()
    const setImageSource = vi.fn()

    const submission = sendImageMessageGeneration({
      abortRef: { current: null },
      accessKeyFromPassword: async () => '',
      activeConversation: stateRef.current.conversations[0],
      activeImageModel: 'image-model',
      activeModel: 'chat-model',
      activeProvider,
      commitPublishedLocalSnapshot,
      content: 'Paint a durable workspace',
      data: stateRef.current,
      dataRef: stateRef,
      errorMessage: String,
      finishSending: vi.fn(),
      imageSourceFile: null,
      imageTaskMode: 'generate',
      isOnlineRef: { current: true },
      maskFileFromCanvas: vi.fn(),
      maskTouched: false,
      providerKeys: { 'provider-1': 'key' },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: (operation) => operation(),
      runImageAssistantGeneration,
      scheduleAutoSync: vi.fn(),
      setDraft,
      setImageSource,
      setNotice: vi.fn(),
      startSending: vi.fn(),
      syncPassphraseRef: { current: '' },
      t,
      updateData,
    })

    await vi.waitFor(() => {
      expect(commitPublishedLocalSnapshot).toHaveBeenCalledTimes(1)
    })
    expect(runImageAssistantGeneration).not.toHaveBeenCalled()
    expect(setDraft).not.toHaveBeenCalled()
    expect(setImageSource).not.toHaveBeenCalled()

    persistence.resolve(undefined)
    await submission

    expect(runImageAssistantGeneration).toHaveBeenCalledTimes(1)
    expect(setDraft).toHaveBeenCalledWith('')
    expect(setImageSource).toHaveBeenCalledWith(null)
  })

  it('preserves a newer draft typed while the image turn becomes durable', async () => {
    const activeProvider = provider()
    const stateRef = { current: appData([conversation()], [activeProvider]) }
    const { updateData } = updaterFor(stateRef)
    const persistence = deferred<void>()
    const commitPublishedLocalSnapshot = vi.fn(() => persistence.promise)
    let currentDraft = 'Paint a durable workspace'
    const setDraft = vi.fn((value: string) => {
      currentDraft = value
    })
    const draftRevisionRef = { current: 1 }

    const submission = sendImageMessageGeneration({
      abortRef: { current: null },
      accessKeyFromPassword: async () => '',
      activeConversation: stateRef.current.conversations[0],
      activeImageModel: 'image-model',
      activeModel: 'chat-model',
      activeProvider,
      commitPublishedLocalSnapshot,
      content: currentDraft,
      data: stateRef.current,
      dataRef: stateRef,
      draftRevision: 1,
      draftRevisionRef,
      errorMessage: String,
      finishSending: vi.fn(),
      imageSourceFile: null,
      imageTaskMode: 'generate',
      isOnlineRef: { current: true },
      maskFileFromCanvas: vi.fn(),
      maskTouched: false,
      providerKeys: { 'provider-1': 'key' },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: (operation) => operation(),
      runImageAssistantGeneration: vi.fn(async () => undefined),
      scheduleAutoSync: vi.fn(),
      setDraft,
      setImageSource: vi.fn(),
      setNotice: vi.fn(),
      startSending: vi.fn(),
      syncPassphraseRef: { current: '' },
      t,
      updateData,
    })

    await vi.waitFor(() => {
      expect(commitPublishedLocalSnapshot).toHaveBeenCalledTimes(1)
    })
    currentDraft = 'Keep this new image prompt'
    draftRevisionRef.current = 2

    persistence.resolve(undefined)
    await submission

    expect(currentDraft).toBe('Keep this new image prompt')
    expect(setDraft).not.toHaveBeenCalled()
  })

  it('persists an unexpected image runner failure before reporting or scheduling sync', async () => {
    const activeProvider = provider()
    const stateRef = { current: appData([conversation()], [activeProvider]) }
    const { updateData } = updaterFor(stateRef)
    const terminalPersistence = deferred<void>()
    const commitPublishedLocalSnapshot = vi
      .fn<(snapshot: AppData) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => terminalPersistence.promise)
    const scheduleAutoSync = vi.fn()
    const setNotice = vi.fn()

    const submission = sendImageMessageGeneration({
      abortRef: { current: null },
      accessKeyFromPassword: async () => '',
      activeConversation: stateRef.current.conversations[0],
      activeImageModel: 'image-model',
      activeModel: 'chat-model',
      activeProvider,
      commitPublishedLocalSnapshot,
      content: 'Paint a resilient workspace',
      data: stateRef.current,
      dataRef: stateRef,
      errorMessage: (error) =>
        error instanceof Error ? error.message : String(error),
      finishSending: vi.fn(),
      imageSourceFile: null,
      imageTaskMode: 'generate',
      isOnlineRef: { current: true },
      maskFileFromCanvas: vi.fn(),
      maskTouched: false,
      providerKeys: { 'provider-1': 'key' },
      randomId: idSequence('user-id', 'assistant-id'),
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: (operation) => operation(),
      runImageAssistantGeneration: vi.fn(async () => {
        throw new Error('image runner exploded')
      }),
      scheduleAutoSync,
      setDraft: vi.fn(),
      setImageSource: vi.fn(),
      setNotice,
      startSending: vi.fn(),
      syncPassphraseRef: { current: '' },
      t,
      updateData,
    })

    await vi.waitFor(() => {
      expect(commitPublishedLocalSnapshot).toHaveBeenCalledTimes(2)
    })
    expect(stateRef.current.conversations[0].messages[1]).toMatchObject({
      content: 'image runner exploded',
      error: 'image runner exploded',
      status: 'error',
    })
    expect(scheduleAutoSync).not.toHaveBeenCalled()
    expect(setNotice).not.toHaveBeenCalledWith(
      'notice.messageGenerationFailed:{"message":"image runner exploded"}',
      'error',
      'message',
      'assistant-id',
    )

    terminalPersistence.resolve(undefined)
    await submission

    expect(scheduleAutoSync).toHaveBeenCalledWith(stateRef.current, 0)
    expect(setNotice).toHaveBeenCalledWith(
      'notice.messageGenerationFailed:{"message":"image runner exploded"}',
      'error',
      'message',
      'assistant-id',
    )
  })

  it('surfaces proxy access-key derivation failures before starting image generation', async () => {
    const activeProvider = provider({
      needsApiKey: false,
      proxyUrl: 'https://worker.example.com',
    })
    const stateRef = { current: appData([conversation()], [activeProvider]) }
    const { updateData } = updaterFor(stateRef)
    const notices: Array<{
      message: string
      target: string | undefined
      tone: string | undefined
    }> = []
    const runImageAssistantGeneration = vi.fn(
      async (options: RunImageAssistantGenerationOptions) => {
        void options
      },
    )

    await sendImageMessageGeneration({
      abortRef: { current: null },
      accessKeyFromPassword: vi.fn(async () => {
        throw new Error('crypto unavailable')
      }),
      activeConversation: stateRef.current.conversations[0],
      activeImageModel: 'image-model',
      activeModel: 'chat-model',
      activeProvider,
      content: 'Paint a quiet workspace',
      data: stateRef.current,
      dataRef: stateRef,
      errorMessage: (error) =>
        error instanceof Error ? error.message : String(error),
      finishSending: vi.fn(),
      imageSourceFile: null,
      imageTaskMode: 'generate',
      isOnlineRef: { current: true },
      maskFileFromCanvas: vi.fn(),
      maskTouched: false,
      providerKeys: {},
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: (operation) => operation(),
      runImageAssistantGeneration,
      scheduleAutoSync: vi.fn(),
      setDraft: vi.fn(),
      setImageSource: vi.fn(),
      setNotice: (message, tone, target) =>
        notices.push({ message, tone, target }),
      startSending: vi.fn(),
      syncPassphraseRef: { current: 'sync-passphrase' },
      t,
      updateData,
    })

    expect(notices).toEqual([
      {
        message: '',
        tone: undefined,
        target: undefined,
      },
      {
        message:
          'notice.messageGenerationFailed:{"message":"crypto unavailable"}',
        tone: 'error',
        target: 'chat',
      },
    ])
    expect(updateData).not.toHaveBeenCalled()
    expect(runImageAssistantGeneration).not.toHaveBeenCalled()
  })

  it('claims image submission before async source preparation can overlap', async () => {
    const activeProvider = provider()
    const sourceFile = new File(['source'], 'source.png', { type: 'image/png' })
    const stateRef = { current: appData([conversation()], [activeProvider]) }
    const abortRef = { current: null as AbortController | null }
    const sourceRead = deferred<string>()
    const fileToDataUrl = vi.fn(() => sourceRead.promise)
    const finishSending = vi.fn()
    const startSending = vi.fn()
    const { updateData } = updaterFor(stateRef)
    const runImageAssistantGeneration = vi.fn(
      async (options: RunImageAssistantGenerationOptions) => {
        expect(options.controller).toBe(abortRef.current)
      },
    )
    const options = {
      abortRef,
      accessKeyFromPassword: async () => '',
      activeConversation: stateRef.current.conversations[0],
      activeImageModel: 'image-model',
      activeModel: 'chat-model',
      activeProvider,
      content: 'Edit this once',
      data: stateRef.current,
      dataRef: stateRef,
      errorMessage: String,
      fileToDataUrl,
      finishSending,
      imageSourceFile: sourceFile,
      imageTaskMode: 'edit' as const,
      isOnlineRef: { current: true },
      maskFileFromCanvas: vi.fn(),
      maskTouched: false,
      providerKeys: { 'provider-1': 'key' },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: <T>(operation: () => Promise<T>) => operation(),
      runImageAssistantGeneration,
      scheduleAutoSync: vi.fn(),
      setDraft: vi.fn(),
      setImageSource: vi.fn(),
      setNotice: vi.fn(),
      startSending,
      syncPassphraseRef: { current: '' },
      t,
      updateData,
    }

    const first = sendImageMessageGeneration(options)
    const duplicate = sendImageMessageGeneration(options)

    expect(fileToDataUrl).toHaveBeenCalledTimes(1)
    expect(startSending).toHaveBeenCalledTimes(1)
    expect(abortRef.current).toBeInstanceOf(AbortController)

    sourceRead.resolve('data:image/png;base64,c291cmNl')
    await Promise.all([first, duplicate])

    expect(updateData).toHaveBeenCalledTimes(1)
    expect(runImageAssistantGeneration).toHaveBeenCalledTimes(1)
    expect(finishSending).toHaveBeenCalledTimes(1)
    expect(abortRef.current).toBeNull()
  })

  it('stops image submission while source preparation is pending', async () => {
    const activeProvider = provider()
    const sourceFile = new File(['source'], 'source.png', { type: 'image/png' })
    const stateRef = { current: appData([conversation()], [activeProvider]) }
    const abortRef = { current: null as AbortController | null }
    const sourceRead = deferred<string>()
    const notices: Array<{
      message: string
      target: string | undefined
      tone: string | undefined
    }> = []
    const finishSending = vi.fn()
    const startSending = vi.fn()
    const { updateData } = updaterFor(stateRef)
    const runImageAssistantGeneration = vi.fn()

    const submission = sendImageMessageGeneration({
      abortRef,
      accessKeyFromPassword: async () => '',
      activeConversation: stateRef.current.conversations[0],
      activeImageModel: 'image-model',
      activeModel: 'chat-model',
      activeProvider,
      content: 'Stop this edit',
      data: stateRef.current,
      dataRef: stateRef,
      errorMessage: String,
      fileToDataUrl: () => sourceRead.promise,
      finishSending,
      imageSourceFile: sourceFile,
      imageTaskMode: 'edit',
      isOnlineRef: { current: true },
      maskFileFromCanvas: vi.fn(),
      maskTouched: false,
      providerKeys: { 'provider-1': 'key' },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: (operation) => operation(),
      runImageAssistantGeneration,
      scheduleAutoSync: vi.fn(),
      setDraft: vi.fn(),
      setImageSource: vi.fn(),
      setNotice: (message, tone, target) =>
        notices.push({ message, tone, target }),
      startSending,
      syncPassphraseRef: { current: '' },
      t,
      updateData,
    })

    abortRef.current?.abort()
    sourceRead.resolve('data:image/png;base64,c291cmNl')
    await submission

    expect(notices).toEqual([
      { message: '', tone: undefined, target: undefined },
      { message: 'notice.stopped', tone: 'warning', target: 'chat' },
    ])
    expect(updateData).not.toHaveBeenCalled()
    expect(runImageAssistantGeneration).not.toHaveBeenCalled()
    expect(startSending).toHaveBeenCalledTimes(1)
    expect(finishSending).toHaveBeenCalledTimes(1)
    expect(abortRef.current).toBeNull()
  })

  it('keeps image draft and source when the message cannot be saved', async () => {
    const activeProvider = provider()
    const sourceFile = new File(['source'], 'source.png', { type: 'image/png' })
    const stateRef = { current: appData([conversation()], [activeProvider]) }
    const drafts: string[] = []
    const imageSources: Array<File | null> = []
    const notices: Array<{
      message: string
      target: string | undefined
      tone: string | undefined
    }> = []
    const finishSending = vi.fn()
    const runImageAssistantGeneration = vi.fn(
      async (options: RunImageAssistantGenerationOptions) => {
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

    await sendImageMessageGeneration({
      abortRef: { current: null },
      accessKeyFromPassword: async () => '',
      activeConversation: stateRef.current.conversations[0],
      activeImageModel: 'image-model',
      activeModel: 'chat-model',
      activeProvider,
      content: 'Edit this without dropping the draft',
      data: stateRef.current,
      dataRef: stateRef,
      errorMessage: String,
      fileToDataUrl: async (file) => `data:${file.name}`,
      finishSending,
      imageSourceFile: sourceFile,
      imageTaskMode: 'edit',
      isOnlineRef: { current: true },
      maskFileFromCanvas: vi.fn(),
      maskTouched: false,
      providerKeys: { 'provider-1': 'key' },
      randomId: idSequence('source-id', 'user-id', 'assistant-id'),
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: (operation) => operation(),
      runImageAssistantGeneration,
      scheduleAutoSync: vi.fn(),
      setDraft: (value) => drafts.push(value),
      setImageSource: (file) => imageSources.push(file),
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
    expect(imageSources).toEqual([])
    expect(startSending).toHaveBeenCalledTimes(1)
    expect(finishSending).toHaveBeenCalledTimes(1)
    expect(runImageAssistantGeneration).not.toHaveBeenCalled()
    expect(stateRef.current.conversations[0].messages).toEqual([])
  })

  it('contains image save failure notice reporter failures without clearing composer state', async () => {
    const activeProvider = provider()
    const sourceFile = new File(['source'], 'source.png', { type: 'image/png' })
    const stateRef = { current: appData([conversation()], [activeProvider]) }
    const drafts: string[] = []
    const imageSources: Array<File | null> = []
    const finishSending = vi.fn()
    const runImageAssistantGeneration = vi.fn(
      async (options: RunImageAssistantGenerationOptions) => {
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

    await expect(
      sendImageMessageGeneration({
        abortRef: { current: null },
        accessKeyFromPassword: async () => '',
        activeConversation: stateRef.current.conversations[0],
        activeImageModel: 'image-model',
        activeModel: 'chat-model',
        activeProvider,
        content: 'Edit this without dropping the draft',
        data: stateRef.current,
        dataRef: stateRef,
        errorMessage: String,
        fileToDataUrl: async (file) => `data:${file.name}`,
        finishSending,
        imageSourceFile: sourceFile,
        imageTaskMode: 'edit',
        isOnlineRef: { current: true },
        maskFileFromCanvas: vi.fn(),
        maskTouched: false,
        providerKeys: { 'provider-1': 'key' },
        randomId: idSequence('source-id', 'user-id', 'assistant-id'),
        resetAssistantForRetry: vi.fn(),
        runGenerationWithAutoRetry: (operation) => operation(),
        runImageAssistantGeneration,
        scheduleAutoSync: vi.fn(),
        setDraft: (value) => drafts.push(value),
        setImageSource: (file) => imageSources.push(file),
        setNotice: vi.fn(() => {
          throw new Error('notice unavailable')
        }),
        startSending,
        syncPassphraseRef: { current: '' },
        t,
        updateData,
      }),
    ).resolves.toBeUndefined()

    expect(updateData).toHaveBeenCalledTimes(1)
    expect(drafts).toEqual([])
    expect(imageSources).toEqual([])
    expect(startSending).toHaveBeenCalledTimes(1)
    expect(finishSending).toHaveBeenCalledTimes(1)
    expect(runImageAssistantGeneration).not.toHaveBeenCalled()
    expect(stateRef.current.conversations[0].messages).toEqual([])
  })

  it('keeps the image composer intact when source image preparation fails', async () => {
    const activeProvider = provider()
    const sourceFile = new File(['source'], 'source.png', { type: 'image/png' })
    const stateRef = { current: appData([conversation()], [activeProvider]) }
    const drafts: string[] = []
    const imageSources: Array<File | null> = []
    const notices: Array<{
      message: string
      target: string | undefined
      tone: string | undefined
    }> = []
    const finishSending = vi.fn()
    const runImageAssistantGeneration = vi.fn(
      async (options: RunImageAssistantGenerationOptions) => {
        void options
      },
    )
    const startSending = vi.fn()
    const { updateData } = updaterFor(stateRef)

    await sendImageMessageGeneration({
      abortRef: { current: null },
      accessKeyFromPassword: async () => '',
      activeConversation: stateRef.current.conversations[0],
      activeImageModel: 'image-model',
      activeModel: 'chat-model',
      activeProvider,
      content: 'Edit this after the file read works',
      data: stateRef.current,
      dataRef: stateRef,
      errorMessage: (error) =>
        error instanceof Error ? error.message : String(error),
      fileToDataUrl: async () => {
        throw new Error('file read blocked')
      },
      finishSending,
      imageSourceFile: sourceFile,
      imageTaskMode: 'edit',
      isOnlineRef: { current: true },
      maskFileFromCanvas: vi.fn(),
      maskTouched: false,
      providerKeys: { 'provider-1': 'key' },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: (operation) => operation(),
      runImageAssistantGeneration,
      scheduleAutoSync: vi.fn(),
      setDraft: (value) => drafts.push(value),
      setImageSource: (file) => imageSources.push(file),
      setNotice: (message, tone, target) =>
        notices.push({ message, tone, target }),
      startSending,
      syncPassphraseRef: { current: '' },
      t,
      updateData,
    })

    expect(notices).toEqual([
      {
        message: '',
        tone: undefined,
        target: undefined,
      },
      {
        message: 'notice.imagePreparationFailed:{"message":"file read blocked"}',
        tone: 'error',
        target: 'chat',
      },
    ])
    expect(updateData).not.toHaveBeenCalled()
    expect(drafts).toEqual([])
    expect(imageSources).toEqual([])
    expect(startSending).toHaveBeenCalledTimes(1)
    expect(finishSending).toHaveBeenCalledTimes(1)
    expect(runImageAssistantGeneration).not.toHaveBeenCalled()
    expect(stateRef.current.conversations[0].messages).toEqual([])
  })

  it('keeps inpaint drafts and source images when mask preparation fails', async () => {
    const activeProvider = provider()
    const sourceFile = new File(['source'], 'source.png', { type: 'image/png' })
    const stateRef = { current: appData([conversation()], [activeProvider]) }
    const drafts: string[] = []
    const imageSources: Array<File | null> = []
    const notices: Array<{
      message: string
      target: string | undefined
      tone: string | undefined
    }> = []
    const finishSending = vi.fn()
    const runImageAssistantGeneration = vi.fn(
      async (options: RunImageAssistantGenerationOptions) => {
        void options
      },
    )
    const startSending = vi.fn()
    const { updateData } = updaterFor(stateRef)

    await sendImageMessageGeneration({
      abortRef: { current: null },
      accessKeyFromPassword: async () => '',
      activeConversation: stateRef.current.conversations[0],
      activeImageModel: 'image-model',
      activeModel: 'chat-model',
      activeProvider,
      content: 'Inpaint this after mask export works',
      data: stateRef.current,
      dataRef: stateRef,
      errorMessage: (error) =>
        error instanceof Error ? error.message : String(error),
      fileToDataUrl: async (file) => `data:${file.name}`,
      finishSending,
      imageSourceFile: sourceFile,
      imageTaskMode: 'inpaint',
      isOnlineRef: { current: true },
      maskFileFromCanvas: async () => {
        throw new Error('mask export blocked')
      },
      maskTouched: true,
      providerKeys: { 'provider-1': 'key' },
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: (operation) => operation(),
      runImageAssistantGeneration,
      scheduleAutoSync: vi.fn(),
      setDraft: (value) => drafts.push(value),
      setImageSource: (file) => imageSources.push(file),
      setNotice: (message, tone, target) =>
        notices.push({ message, tone, target }),
      startSending,
      syncPassphraseRef: { current: '' },
      t,
      updateData,
    })

    expect(notices).toEqual([
      {
        message: '',
        tone: undefined,
        target: undefined,
      },
      {
        message: 'notice.imagePreparationFailed:{"message":"mask export blocked"}',
        tone: 'error',
        target: 'chat',
      },
    ])
    expect(updateData).not.toHaveBeenCalled()
    expect(drafts).toEqual([])
    expect(imageSources).toEqual([])
    expect(startSending).toHaveBeenCalledTimes(1)
    expect(finishSending).toHaveBeenCalledTimes(1)
    expect(runImageAssistantGeneration).not.toHaveBeenCalled()
    expect(stateRef.current.conversations[0].messages).toEqual([])
  })

  it('stores source and mask attachments before dispatching an inpaint generation', async () => {
    const activeProvider = provider({
      imageModel: 'dall-e-3',
      models: ['chat-model', 'dall-e-3', 'gpt-image-1'],
    })
    const sourceFile = new File(['source'], 'source.png', { type: 'image/png' })
    const maskFile = new File(['mask'], 'mask.png', { type: 'image/png' })
    const stateRef = { current: appData([conversation()], [activeProvider]) }
    const { options, updateData } = updaterFor(stateRef)
    const drafts: string[] = []
    const imageSources: Array<File | null> = []
    const notices: string[] = []
    const sendingTransitions: string[] = []
    const runImageAssistantGeneration = vi.fn(
      async (options: RunImageAssistantGenerationOptions) => {
        void options
      },
    )

    await sendImageMessageGeneration({
      abortRef: { current: null },
      accessKeyFromPassword: async () => '',
      activeConversation: stateRef.current.conversations[0],
      activeImageModel: 'dall-e-3',
      activeModel: 'chat-model',
      activeProvider,
      content: 'Inpaint this',
      data: stateRef.current,
      dataRef: stateRef,
      errorMessage: String,
      fileToDataUrl: async (file) => `data:${file.name}`,
      finishSending: () => sendingTransitions.push('stop'),
      imageSourceFile: sourceFile,
      imageTaskMode: 'inpaint',
      isOnlineRef: { current: true },
      maskFileFromCanvas: async () => maskFile,
      maskTouched: true,
      now: () => 42,
      providerKeys: { 'provider-1': 'key' },
      randomId: idSequence('source-id', 'mask-id', 'user-id', 'assistant-id'),
      resetAssistantForRetry: vi.fn(),
      runGenerationWithAutoRetry: (operation) => operation(),
      runImageAssistantGeneration,
      scheduleAutoSync: vi.fn(),
      setDraft: (value) => drafts.push(value),
      setImageSource: (file) => imageSources.push(file),
      setNotice: (message) => notices.push(message),
      startSending: () => sendingTransitions.push('start'),
      syncPassphraseRef: { current: '' },
      t,
      updateData,
    })

    const messages = stateRef.current?.conversations[0].messages ?? []
    expect(options).toEqual([{ autoSync: false }])
    expect(drafts).toEqual([''])
    expect(imageSources).toEqual([null])
    expect(notices).toEqual([''])
    expect(sendingTransitions).toEqual(['start', 'stop'])
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({
      id: 'user-id',
      role: 'user',
      content: 'Inpaint this',
      attachments: [
        {
          id: 'source-id',
          purpose: 'source',
          dataUrl: 'data:source.png',
          alt: 'message.sourceImage',
        },
        {
          id: 'mask-id',
          purpose: 'mask',
          dataUrl: 'data:mask.png',
          alt: 'message.maskImage',
        },
      ],
    })
    expect(messages[1]).toMatchObject({
      id: 'assistant-id',
      role: 'assistant',
      status: 'streaming',
    })
    expect(runImageAssistantGeneration).toHaveBeenCalledTimes(1)
    expect(runImageAssistantGeneration.mock.calls[0][0]).toMatchObject({
      assistantId: 'assistant-id',
      conversationId: 'conversation-1',
      image: sourceFile,
      mask: maskFile,
      model: 'gpt-image-1',
      prompt: 'Inpaint this',
      provider: { id: 'provider-1' },
    })
  })

  it('contains post-save clear notice reporter failures while dispatching image generation', async () => {
    const activeProvider = provider()
    const stateRef = { current: appData([conversation()], [activeProvider]) }
    const { updateData } = updaterFor(stateRef)
    const drafts: string[] = []
    const imageSources: Array<File | null> = []
    const sendingTransitions: string[] = []
    const runImageAssistantGeneration = vi.fn(
      async (options: RunImageAssistantGenerationOptions) => {
        void options
      },
    )

    await expect(
      sendImageMessageGeneration({
        abortRef: { current: null },
        accessKeyFromPassword: async () => '',
        activeConversation: stateRef.current.conversations[0],
        activeImageModel: 'image-model',
        activeModel: 'chat-model',
        activeProvider,
        content: 'Paint a quiet workspace',
        data: stateRef.current,
        dataRef: stateRef,
        errorMessage: String,
        finishSending: () => sendingTransitions.push('stop'),
        imageSourceFile: null,
        imageTaskMode: 'generate',
        isOnlineRef: { current: true },
        maskFileFromCanvas: vi.fn(),
        maskTouched: false,
        providerKeys: { 'provider-1': 'key' },
        randomId: idSequence('user-id', 'assistant-id'),
        resetAssistantForRetry: vi.fn(),
        runGenerationWithAutoRetry: (operation) => operation(),
        runImageAssistantGeneration,
        scheduleAutoSync: vi.fn(),
        setDraft: (value) => drafts.push(value),
        setImageSource: (file) => imageSources.push(file),
        setNotice: vi.fn((message) => {
          if (message === '') {
            throw new Error('notice unavailable')
          }
        }),
        startSending: () => sendingTransitions.push('start'),
        syncPassphraseRef: { current: '' },
        t,
        updateData,
      }),
    ).resolves.toBeUndefined()

    expect(drafts).toEqual([''])
    expect(imageSources).toEqual([null])
    expect(sendingTransitions).toEqual(['start', 'stop'])
    expect(stateRef.current?.conversations[0].messages).toHaveLength(2)
    expect(runImageAssistantGeneration).toHaveBeenCalledTimes(1)
  })
})
