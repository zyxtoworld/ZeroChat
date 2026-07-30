import type {
  FormEvent,
  KeyboardEvent,
} from 'react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { flushSync } from 'react-dom'
import type { Translator } from '../i18n'
import type { NoticeTarget } from '../components/Notice'
import {
  updateConversation,
} from './appData'
import { accessKeyFromPassword } from './accessKey'
import {
  type DangerPrompt,
} from './dangerConfirmation'
import type {
  ComposerMode,
  ImageTaskMode,
} from './imageComposerChrome'
import { sendAudioTranscription } from './chatGenerationAudioTranscription'
import { sendImageMessageGeneration } from './chatGenerationImageSubmit'
import { sendTextMessageGeneration } from './chatGenerationTextSubmit'
import {
  flushQueuedOfflineTextMessages,
} from './chatGenerationOfflineQueue'
import { stopStaleStreamingGeneration } from './chatGenerationStop'
import { createChatGenerationMessageActions } from './chatGenerationMessageActions'
import { generationRequiresProxyToken } from './generationRequirements'
import {
  generationOwnership,
  updateGenerationMessage,
  type GenerationIncarnation,
} from './generationOwnership'
import type { LocalSaveCommitPrecondition } from './localSaveQueueController'
import {
  browserProviderKey,
  providerForAiRequest,
} from './providerConfig'
import { messageCanSpeak } from './messageRendering'
import {
  regenerateAssistantMessageGeneration,
  submitEditedUserMessageGeneration,
  synthesizeSpeechAudio,
} from './lazy'
import type { NoticeTone } from './uiRuntime'
import {
  createGenerationRuntimeGate,
  type GenerationAutoRetryOptions,
  registerGenerationAbortController,
  withGenerationAutoRetry as runGenerationWithAutoRetry,
} from './chatGenerationRuntime'
import type {
  AppData,
  ChatMessage,
  Conversation,
  ProviderConfig,
} from '../types'

type MutableRef<T> = {
  current: T
}

type SetNotice = (
  message: string,
  tone?: NoticeTone,
  target?: NoticeTarget,
  anchorId?: string,
) => void

type UpdateData = (
  updater: (current: AppData) => AppData,
  options?: { autoSync?: boolean },
) => AppData | null

interface ChatGenerationControllerOptions {
  activeConversation: Conversation | null
  activeImageModel: string
  activeModel: string
  activeProvider: ProviderConfig | null
  audioSourceFile: File | null
  chatContextMessageLimit: number
  composerMode: ComposerMode
  commitPublishedLocalSnapshot: (
    snapshot: AppData,
    precondition?: LocalSaveCommitPrecondition,
  ) => Promise<void>
  data: AppData | null
  dataRef: MutableRef<AppData | null>
  draft: string
  draftRef: MutableRef<string>
  draftRevisionRef: MutableRef<number>
  imageSourceFile: File | null
  imageTaskMode: ImageTaskMode
  isOnlineRef: MutableRef<boolean>
  maskFileFromCanvas: () => Promise<File>
  maskTouched: boolean
  providerKeys: Record<string, string>
  providerKeysRef: MutableRef<Record<string, string>>
  requestDangerConfirmation: (prompt: DangerPrompt) => Promise<boolean>
  scheduleAutoSync: (snapshot: AppData, delay?: number) => void
  setAudioSource: (file: File | null) => void
  setComposerMode: (mode: 'chat') => void
  setDraft: (value: string) => void
  setImageSource: (file: File | null) => void
  setNotice: SetNotice
  setSending: (sending: boolean) => void
  sending: boolean
  syncPassphraseRef: MutableRef<string>
  t: Translator
  updateData: UpdateData
  errorMessage: (error: unknown) => string
}

export interface ChatGenerationController {
  cancelEditingMessage: () => void
  copyMessage: (message: ChatMessage) => Promise<void>
  deleteMessage: (messageId: string) => Promise<void>
  editingContent: string
  editingMessageId: string
  flushOfflineQueue: () => void
  handleDraftKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  regenerateAssistantMessage: (messageId: string) => Promise<void>
  sendMessage: (event?: FormEvent) => void
  pauseGenerationRuntime: () => Promise<() => void>
  setEditingContent: (value: string) => void
  speakMessage: (message: ChatMessage) => Promise<void>
  speakingMessageId: string
  startEditingMessage: (message: ChatMessage) => void
  stopSpeakingMessage: () => void
  stopGeneration: () => void
  submitEditedUserMessage: () => Promise<void>
}

export function reportOfflineQueueFlushFailure({
  error,
  errorMessage,
  setNotice,
  t,
}: {
  error: unknown
  errorMessage: (error: unknown) => string
  setNotice: SetNotice
  t: Translator
}): void {
  setNotice(
    t('notice.messageGenerationFailed', { message: errorMessage(error) }),
    'error',
    'chat',
  )
}

export function reportDetachedChatGenerationFailure(
  error: unknown,
  onFailure: (error: unknown) => void,
): void {
  try {
    onFailure(error)
  } catch {
    // The detached boundary has no fallback UI channel. Keep reporter failures contained.
  }
}

export function consumeDetachedChatGenerationFailure(
  promise: Promise<void>,
  onFailure: (error: unknown) => void,
): Promise<void> {
  return promise.catch((error: unknown) => {
    reportDetachedChatGenerationFailure(error, onFailure)
  })
}

export function runOfflineQueueFlush(
  flushOfflineQueue: () => Promise<void>,
  onFailure: (error: unknown) => void,
): void {
  try {
    void consumeDetachedChatGenerationFailure(flushOfflineQueue(), onFailure)
  } catch (error: unknown) {
    reportDetachedChatGenerationFailure(error, onFailure)
  }
}

export function reportSubmittedChatMessageFailure({
  error,
  errorMessage,
  setNotice,
  t,
}: {
  error: unknown
  errorMessage: (error: unknown) => string
  setNotice: SetNotice
  t: Translator
}): void {
  setNotice(
    t('notice.messageGenerationFailed', { message: errorMessage(error) }),
    'error',
    'chat',
  )
}

export function runSubmittedChatMessage(
  submitChatMessage: () => Promise<void>,
  onFailure: (error: unknown) => void,
): void {
  try {
    void consumeDetachedChatGenerationFailure(submitChatMessage(), onFailure)
  } catch (error: unknown) {
    reportDetachedChatGenerationFailure(error, onFailure)
  }
}

export function reportChatSpeechNotice(
  setNotice: SetNotice,
  getMessage: () => string,
  tone?: NoticeTone,
  target?: NoticeTarget,
  anchorId?: string,
): void {
  try {
    setNotice(getMessage(), tone, target, anchorId)
  } catch {
    // Message speech actions are invoked fire-and-forget from bubbles and menus.
  }
}

export function revokeSpeechObjectUrl(url: string): boolean {
  if (!url) {
    return true
  }

  try {
    URL.revokeObjectURL(url)
    return true
  } catch {
    // Speech playback cleanup is best-effort; speaking state owns the user-visible result.
    return false
  }
}

export function abortActiveChatGeneration(
  abortRef: MutableRef<AbortController | null>,
): boolean {
  const controller = abortRef.current

  if (!controller) {
    return false
  }

  try {
    controller.abort()
    return true
  } catch {
    return false
  }
}

export function speechRequestIsCurrent(
  speechAbortRef: MutableRef<AbortController | null>,
  controller: AbortController,
): boolean {
  return speechAbortRef.current === controller && !controller.signal.aborted
}

export interface SpeechPlaybackOwner {
  conversationCreatedAt: number
  conversationId: string
  content: string
  messageCreatedAt: number
  messageId: string
  messageRole: ChatMessage['role']
}

export function captureSpeechPlaybackOwner(
  conversation: Conversation,
  message: ChatMessage,
): SpeechPlaybackOwner | null {
  const currentMessage = conversation.messages.find(
    (candidate) => candidate.id === message.id,
  )

  if (
    !currentMessage ||
    currentMessage.createdAt !== message.createdAt ||
    currentMessage.role !== message.role ||
    currentMessage.content !== message.content
  ) {
    return null
  }

  return {
    conversationCreatedAt: conversation.createdAt,
    conversationId: conversation.id,
    content: currentMessage.content,
    messageCreatedAt: currentMessage.createdAt,
    messageId: currentMessage.id,
    messageRole: currentMessage.role,
  }
}

export function speechPlaybackOwnerIsCurrent(
  snapshot: AppData | null,
  activeConversationId: string,
  owner: SpeechPlaybackOwner,
): boolean {
  if (activeConversationId !== owner.conversationId) {
    return false
  }

  const conversation = snapshot?.conversations.find(
    (candidate) =>
      candidate.id === owner.conversationId &&
      candidate.createdAt === owner.conversationCreatedAt,
  )
  const message = conversation?.messages.find(
    (candidate) => candidate.id === owner.messageId,
  )

  return Boolean(
    message &&
      message.createdAt === owner.messageCreatedAt &&
      message.role === owner.messageRole &&
      message.content === owner.content,
  )
}

export function useChatGenerationController({
  activeConversation,
  activeImageModel,
  activeModel,
  activeProvider,
  audioSourceFile,
  chatContextMessageLimit,
  composerMode,
  commitPublishedLocalSnapshot,
  data,
  dataRef,
  draft,
  draftRef,
  draftRevisionRef,
  imageSourceFile,
  imageTaskMode,
  isOnlineRef,
  maskFileFromCanvas,
  maskTouched,
  providerKeys,
  providerKeysRef,
  requestDangerConfirmation,
  scheduleAutoSync,
  setAudioSource,
  setComposerMode,
  setDraft,
  setImageSource,
  setNotice,
  setSending,
  sending,
  syncPassphraseRef,
  t,
  updateData,
  errorMessage,
}: ChatGenerationControllerOptions): ChatGenerationController {
  const [editingMessageId, setEditingMessageId] = useState('')
  const [editingContent, setEditingContent] = useState('')
  const [speakingMessageId, setSpeakingMessageId] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const speechAbortRef = useRef<AbortController | null>(null)
  const speechAudioRef = useRef<HTMLAudioElement | null>(null)
  const speechObjectUrlRef = useRef('')
  const speechPlaybackOwnerRef = useRef<SpeechPlaybackOwner | null>(null)
  const activeConversationIdRef = useRef(activeConversation?.id ?? '')
  const offlineQueueRunningRef = useRef(false)
  const [generationRuntimeGate] = useState(createGenerationRuntimeGate)
  const flushOfflineTextQueueRef = useRef<() => Promise<void>>(
    async () => undefined,
  )
  activeConversationIdRef.current = activeConversation?.id ?? ''

  const releaseSpeechPlaybackResources = useCallback(() => {
    speechAudioRef.current?.pause()
    speechAudioRef.current = null
    speechPlaybackOwnerRef.current = null

    if (speechObjectUrlRef.current) {
      const objectUrl = speechObjectUrlRef.current
      speechObjectUrlRef.current = ''
      revokeSpeechObjectUrl(objectUrl)
    }
  }, [])

  const clearSpeechPlayback = useCallback(() => {
    releaseSpeechPlaybackResources()
    setSpeakingMessageId('')
  }, [releaseSpeechPlaybackResources])

  useEffect(
    () => () => {
      abortActiveChatGeneration(abortRef)
      generationOwnership.active = false
      speechAbortRef.current?.abort()
      speechAbortRef.current = null
      releaseSpeechPlaybackResources()
    },
    [releaseSpeechPlaybackResources],
  )

  useEffect(() => {
    const owner = speechPlaybackOwnerRef.current

    if (
      !owner ||
      speechPlaybackOwnerIsCurrent(
        data,
        activeConversation?.id ?? '',
        owner,
      )
    ) {
      return
    }

    speechAbortRef.current?.abort()
    speechAbortRef.current = null
    clearSpeechPlayback()
  }, [activeConversation?.id, clearSpeechPlayback, data])

  async function withGenerationAutoRetry<T>(
    operation: () => Promise<T>,
    options: Omit<GenerationAutoRetryOptions, 'setNotice' | 't'>,
  ): Promise<T> {
    return runGenerationWithAutoRetry(operation, { ...options, setNotice, t })
  }

  function resetAssistantForRetry(
    conversationId: string,
    messageId: string,
  ): void {
    updateData(
      (current) =>
        updateConversation(current, conversationId, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  content: '',
                  status: 'streaming',
                  error: undefined,
                  attachments: undefined,
                }
              : message,
          ),
        })),
      { autoSync: false },
    )
  }

  function flushStreamingAssistantContent(
    conversationId: string,
    messageId: string,
    content: string,
    incarnation?: GenerationIncarnation,
  ): void {
    flushSync(() => {
      updateData(
        (current) =>
          incarnation
            ? updateGenerationMessage(current, incarnation, (message) => ({
                ...message,
                content,
                status: 'streaming',
              }))
            : updateConversation(current, conversationId, (conversation) => ({
                ...conversation,
                messages: conversation.messages.map((message) =>
                  message.id === messageId
                    ? { ...message, content, status: 'streaming' }
                    : message,
                ),
              })),
        { autoSync: false },
      )
    })
  }

  async function flushOfflineTextQueue(): Promise<void> {
    await (generationRuntimeGate.run(() =>
      flushQueuedOfflineTextMessages({
        abortRef,
        chatContextMessageLimit,
        dataRef,
        errorMessage,
        flushStreamingAssistantContent,
        isOnlineRef,
        offlineQueueRunningRef,
        onQueueRunFinished: () => setSending(false),
        onQueueRunStarted: () => flushSync(() => setSending(true)),
        commitPublishedLocalSnapshot,
        providerKeysRef,
        resetAssistantForRetry,
        runGenerationWithAutoRetry: withGenerationAutoRetry,
        scheduleAutoSync,
        setNotice,
        syncPassphraseRef,
        t,
        updateData,
      }),
    ) ?? Promise.resolve())
  }

  useEffect(() => {
    flushOfflineTextQueueRef.current = flushOfflineTextQueue
  })

  function flushOfflineQueue(): void {
    runOfflineQueueFlush(flushOfflineTextQueueRef.current, (error) =>
      reportOfflineQueueFlushFailure({
        error,
        errorMessage,
        setNotice,
        t,
      }),
    )
  }

  async function sendImageMessage(
    content: string,
    draftRevision: number,
  ): Promise<void> {
    if (!data || !activeConversation || !activeProvider || sending) {
      return
    }

    await sendImageMessageGeneration({
      abortRef,
      activeConversation,
      activeImageModel,
      activeModel,
      activeProvider,
      commitPublishedLocalSnapshot,
      content,
      data,
      dataRef,
      draftRevision,
      draftRevisionRef,
      errorMessage,
      finishSending: () => setSending(false),
      imageSourceFile,
      imageTaskMode,
      isOnlineRef,
      maskFileFromCanvas,
      maskTouched,
      providerKeys,
      resetAssistantForRetry,
      runGenerationWithAutoRetry: withGenerationAutoRetry,
      scheduleAutoSync,
      setDraft,
      setImageSource,
      setNotice,
      startSending: () => flushSync(() => setSending(true)),
      syncPassphraseRef,
      t,
      updateData,
    })
  }

  async function submitChatMessage(): Promise<void> {
    if (!data || !activeConversation || !activeProvider || sending) {
      return
    }

    if (composerMode === 'audio') {
      await sendAudioTranscription({
        abortRef,
        activeProvider,
        audioSourceFile,
        data,
        draft,
        draftRef,
        errorMessage,
        finishSending: () => setSending(false),
        isOnlineRef,
        providerKeys,
        runGenerationWithAutoRetry: withGenerationAutoRetry,
        setAudioSource,
        setComposerMode,
        setDraft,
        setNotice,
        startSending: () => flushSync(() => setSending(true)),
        syncPassphraseRef,
        t,
      })
      return
    }

    const content = draft.trim()
    const draftRevision = draftRevisionRef.current

    if (!content) {
      return
    }

    if (composerMode === 'image') {
      await sendImageMessage(content, draftRevision)
      return
    }

    await sendTextMessageGeneration({
      abortRef,
      activeConversation,
      activeModel,
      activeProvider,
      chatContextMessageLimit,
      commitPublishedLocalSnapshot,
      content,
      data,
      dataRef,
      draftRevision,
      draftRevisionRef,
      errorMessage,
      finishSending: () => setSending(false),
      flushStreamingAssistantContent,
      isOnlineRef,
      providerKeys,
      resetAssistantForRetry,
      runGenerationWithAutoRetry: withGenerationAutoRetry,
      scheduleAutoSync,
      setDraft,
      setNotice,
      startSending: () => flushSync(() => setSending(true)),
      syncPassphraseRef,
      t,
      updateData,
    })
  }

  function sendMessage(event?: FormEvent): void {
    event?.preventDefault()
    runSubmittedChatMessage(
      () =>
        generationRuntimeGate.run(() => submitChatMessage()) ??
        Promise.resolve(),
      (error) =>
        reportSubmittedChatMessageFailure({
          error,
          errorMessage,
          setNotice,
          t,
        }),
    )
  }

  function stopGeneration(): void {
    if (abortActiveChatGeneration(abortRef)) {
      return
    }

    const stoppedContent = t('notice.stopped')

    stopStaleStreamingGeneration({
      data: dataRef.current,
      stoppedContent,
      updateData,
      scheduleAutoSync,
      setSending,
      onSaveFailure: (messageId) =>
        setNotice(
          t('notice.messageSaveUnavailable'),
          'error',
          'message',
          messageId,
        ),
    })
  }

  async function pauseGenerationRuntime(): Promise<() => void> {
    const release = await generationRuntimeGate.pause(() => {
      abortActiveChatGeneration(abortRef)
      stopSpeakingPlayback({ notify: false })
    })
    setSending(false)
    return release
  }

  function stopSpeakingPlayback(options: { notify?: boolean } = {}): void {
    const notify = options.notify ?? true
    const stoppedMessageId = speakingMessageId

    speechAbortRef.current?.abort()
    speechAbortRef.current = null
    clearSpeechPlayback()

    if (notify && stoppedMessageId) {
      reportChatSpeechNotice(
        setNotice,
        () => t('notice.audioSpeechStopped'),
        'warning',
        'message',
        stoppedMessageId,
      )
    }
  }

  function stopSpeakingMessage(): void {
    stopSpeakingPlayback()
  }

  async function speakMessage(message: ChatMessage): Promise<void> {
    const currentPlaybackOwner = speechPlaybackOwnerRef.current

    if (
      currentPlaybackOwner &&
      currentPlaybackOwner.conversationId === activeConversation?.id &&
      currentPlaybackOwner.messageId === message.id
    ) {
      stopSpeakingMessage()
      return
    }

    speechAbortRef.current?.abort()
    speechAbortRef.current = null
    clearSpeechPlayback()

    if (!messageCanSpeak(message)) {
      reportChatSpeechNotice(
        setNotice,
        () => t('notice.audioSpeechEmpty'),
        'warning',
        'message',
        message.id,
      )
      return
    }

    const text = message.content.trim()

    if (!data || !activeConversation || !activeProvider) {
      return
    }

    const playbackOwner = captureSpeechPlaybackOwner(
      activeConversation,
      message,
    )

    if (!playbackOwner) {
      return
    }

    if (!isOnlineRef.current) {
      reportChatSpeechNotice(
        setNotice,
        () => t('notice.offlineAudioSpeechUnavailable'),
        'warning',
        'message',
        message.id,
      )
      return
    }

    const requestProvider = providerForAiRequest(activeProvider, data)
    const apiKey = browserProviderKey(requestProvider, providerKeys)
    const controller = registerGenerationAbortController(speechAbortRef)
    speechPlaybackOwnerRef.current = playbackOwner
    setSpeakingMessageId(message.id)
    reportChatSpeechNotice(setNotice, () => '')
    let proxyToken = ''
    const requestOwnsCurrentMessage = (): boolean =>
      speechRequestIsCurrent(speechAbortRef, controller) &&
      speechPlaybackOwnerIsCurrent(
        dataRef.current,
        activeConversationIdRef.current,
        playbackOwner,
      )
    const clearOwnedStaleRequest = (): void => {
      if (speechAbortRef.current !== controller) {
        return
      }

      speechAbortRef.current = null
      clearSpeechPlayback()
    }

    try {
      if (generationRequiresProxyToken(requestProvider)) {
        proxyToken = await accessKeyFromPassword(syncPassphraseRef.current)
      }

      if (!requestOwnsCurrentMessage()) {
        clearOwnedStaleRequest()
        return
      }

      const result = await withGenerationAutoRetry(
        () =>
          synthesizeSpeechAudio({
            apiKey,
            provider: requestProvider,
            proxyToken,
            signal: controller.signal,
            text,
          }),
        {
          anchorId: message.id,
          signal: controller.signal,
          target: 'message',
        },
      )

      if (!requestOwnsCurrentMessage()) {
        clearOwnedStaleRequest()
        return
      }

      const objectUrl = URL.createObjectURL(result.blob)
      speechObjectUrlRef.current = objectUrl
      const audio = new Audio(objectUrl)
      speechAudioRef.current = audio
      audio.onended = () => {
        if (speechAudioRef.current === audio) {
          speechAbortRef.current = null
          clearSpeechPlayback()
        }
      }
      audio.onerror = () => {
        if (speechAudioRef.current !== audio) {
          return
        }

        speechAbortRef.current = null
        clearSpeechPlayback()
        reportChatSpeechNotice(
          setNotice,
          () => t('notice.audioSpeechFailed', {
            message: t('error.capabilityResponseInvalid'),
          }),
          'error',
          'message',
          message.id,
        )
      }
      await audio.play()
      if (
        !requestOwnsCurrentMessage() ||
        speechAudioRef.current !== audio
      ) {
        clearOwnedStaleRequest()
        return
      }
      reportChatSpeechNotice(
        setNotice,
        () => t('notice.audioSpeechPlaying', { model: result.model }),
        'success',
        'message',
        message.id,
      )
    } catch (error: unknown) {
      if (!requestOwnsCurrentMessage()) {
        clearOwnedStaleRequest()
        return
      }

      speechAbortRef.current = null
      clearSpeechPlayback()

      if (error instanceof DOMException && error.name === 'AbortError') {
        reportChatSpeechNotice(
          setNotice,
          () => t('notice.audioSpeechStopped'),
          'warning',
          'message',
          message.id,
        )
        return
      }

      reportChatSpeechNotice(
        setNotice,
        () => t('notice.audioSpeechFailed', { message: errorMessage(error) }),
        'error',
        'message',
        message.id,
      )
    }
  }

  const {
    cancelEditingMessage,
    copyMessage,
    deleteMessage: deleteMessageAction,
    startEditingMessage,
  } = createChatGenerationMessageActions({
    activeConversation,
    dataRef,
    editingMessageId,
    errorMessage,
    requestDangerConfirmation,
    scheduleAutoSync,
    setEditingContent,
    setEditingMessageId,
    setNotice,
    t,
    updateData,
  })

  async function deleteMessage(messageId: string): Promise<void> {
    const deleted = await deleteMessageAction(messageId)
    const currentPlaybackOwner = speechPlaybackOwnerRef.current

    if (
      deleted &&
      currentPlaybackOwner &&
      currentPlaybackOwner.conversationId === activeConversation?.id &&
      currentPlaybackOwner.messageId === messageId
    ) {
      stopSpeakingPlayback({ notify: false })
    }
  }

  async function submitEditedUserMessage(): Promise<void> {
    await (generationRuntimeGate.run(() => submitEditedUserMessageGeneration({
      abortRef,
      activeConversation,
      activeImageModel,
      activeModel,
      activeProvider,
      chatContextMessageLimit,
      clearEditingMessage: cancelEditingMessage,
      commitPublishedLocalSnapshot,
      dataRef,
      editingContent,
      editingMessageId,
      errorMessage,
      finishSending: () => setSending(false),
      flushStreamingAssistantContent,
      providerKeysRef,
      resetAssistantForRetry,
      runGenerationWithAutoRetry: withGenerationAutoRetry,
      scheduleAutoSync,
      sending,
      setNotice,
      startSending: () => flushSync(() => setSending(true)),
      syncPassphraseRef,
      t,
      updateData,
    })) ?? Promise.resolve())
  }

  async function regenerateAssistantMessage(messageId: string): Promise<void> {
    await (generationRuntimeGate.run(() => regenerateAssistantMessageGeneration({
      abortRef,
      activeConversation,
      activeImageModel,
      activeModel,
      activeProvider,
      chatContextMessageLimit,
      clearEditingMessage: cancelEditingMessage,
      commitPublishedLocalSnapshot,
      data,
      dataRef,
      errorMessage,
      finishSending: () => setSending(false),
      flushStreamingAssistantContent,
      messageId,
      providerKeysRef,
      resetAssistantForRetry,
      runGenerationWithAutoRetry: withGenerationAutoRetry,
      scheduleAutoSync,
      sending,
      setNotice,
      startSending: () => flushSync(() => setSending(true)),
      syncPassphraseRef,
      t,
      updateData,
    })) ?? Promise.resolve())
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      (event.ctrlKey || event.metaKey)
    ) {
      event.preventDefault()
      sendMessage()
    }
  }

  return {
    cancelEditingMessage,
    copyMessage,
    deleteMessage,
    editingContent,
    editingMessageId,
    flushOfflineQueue,
    handleDraftKeyDown,
    regenerateAssistantMessage,
    sendMessage,
    pauseGenerationRuntime,
    setEditingContent,
    speakMessage,
    speakingMessageId,
    startEditingMessage,
    stopSpeakingMessage,
    stopGeneration,
    submitEditedUserMessage,
  }
}
