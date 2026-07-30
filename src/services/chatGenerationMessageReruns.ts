import type { NoticeTarget } from '../components/Notice'
import type { Translator } from '../i18n'
import type {
  AppData,
  ChatMessage,
  Conversation,
  ProviderConfig,
} from '../types'
import {
  now,
  updateConversation,
} from './appData'
import { accessKeyFromPassword as defaultAccessKeyFromPassword } from './accessKey'
import { cleanConversationTitle } from './conversations'
import {
  generationPreflightRequirement,
  generationRequirement,
  generationRequiresProxyToken,
} from './generationRequirements'
import {
  restoredImageEditFilesFromMessage,
} from './chatGenerationImageAttachments'
import {
  runImageAssistantGeneration as defaultRunImageAssistantGeneration,
  runTextAssistantGeneration as defaultRunTextAssistantGeneration,
} from './chatGenerationAssistantRun'
import type { GenerationAutoRetryOptions } from './chatGenerationRuntime'
import {
  registerGenerationAbortController,
  reportGenerationNotice as reportMessageRerunNotice,
} from './chatGenerationRuntime'
import {
  commitSubmittedGenerationStart,
  persistUnexpectedAssistantFailure,
} from './chatGenerationSubmitPersistence'
import { hasImageAttachment } from './imageAttachments'
import {
  browserProviderKey,
  providerForAiRequest,
} from './providerConfig'
import { defaultModelForProvider } from './providerModels'
import type { NoticeTone } from './uiRuntime'
import type { LocalSaveCommitPrecondition } from './localSaveQueueController'

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

type RunGenerationWithAutoRetry = <T>(
  operation: () => Promise<T>,
  options: Omit<GenerationAutoRetryOptions, 'setNotice' | 't'>,
) => Promise<T>

type RunTextAssistantGeneration = typeof defaultRunTextAssistantGeneration
type RunImageAssistantGeneration = typeof defaultRunImageAssistantGeneration

export { reportMessageRerunNotice }

function reportMessageRerunTargetNotice(
  setNotice: SetNotice,
  messageId: string,
  getMessage: () => string,
  tone?: NoticeTone,
): void {
  reportMessageRerunNotice(setNotice, getMessage, tone, 'message', messageId)
}

interface MessageRerunSharedOptions {
  abortRef: MutableRef<AbortController | null>
  activeImageModel: string
  activeModel: string
  activeProvider: ProviderConfig | null
  chatContextMessageLimit: number
  clearEditingMessage: () => void
  commitPublishedLocalSnapshot: (
    snapshot: AppData,
    precondition?: LocalSaveCommitPrecondition,
  ) => Promise<void>
  dataRef: MutableRef<AppData | null>
  errorMessage: (error: unknown) => string
  finishSending: () => void
  flushStreamingAssistantContent: (
    conversationId: string,
    messageId: string,
    content: string,
  ) => void
  providerKeysRef: MutableRef<Record<string, string>>
  resetAssistantForRetry: (conversationId: string, messageId: string) => void
  runGenerationWithAutoRetry: RunGenerationWithAutoRetry
  scheduleAutoSync: (snapshot: AppData, delay?: number) => void
  sending: boolean
  setNotice: SetNotice
  startSending: () => void
  syncPassphraseRef: MutableRef<string>
  t: Translator
  updateData: UpdateData
}

type ClaimedMessageRerunRequest = readonly [
  provider: ProviderConfig,
  apiKey: string,
  proxyToken: string,
  controller: AbortController,
]

function releaseMessageRerunClaim(
  options: MessageRerunSharedOptions,
  controller: AbortController,
): void {
  if (options.abortRef.current === controller) {
    options.abortRef.current = null
  }
  options.finishSending()
}

async function claimMessageRerunRequest(
  options: MessageRerunSharedOptions,
  activeProvider: ProviderConfig,
  model: string,
  messageId: string,
  accessKeyFromPassword: typeof defaultAccessKeyFromPassword,
): Promise<ClaimedMessageRerunRequest | null> {
  const {
    abortRef,
    dataRef,
    errorMessage,
    providerKeysRef,
    setNotice,
    startSending,
    syncPassphraseRef,
    t,
  } = options
  const provider = providerForAiRequest(activeProvider, dataRef.current)
  const apiKey = browserProviderKey(provider, providerKeysRef.current)
  const preflightRequirement = generationPreflightRequirement({
    provider,
    model,
    providerKey: apiKey,
    t,
  })

  if (preflightRequirement) {
    reportMessageRerunTargetNotice(
      setNotice,
      messageId,
      () => preflightRequirement,
      undefined,
    )
    return null
  }

  if (abortRef.current) {
    return null
  }

  const controller = registerGenerationAbortController(abortRef)
  startSending()
  reportMessageRerunNotice(setNotice, () => '')
  let handedOff = false

  try {
    let proxyToken = ''
    if (generationRequiresProxyToken(provider)) {
      try {
        proxyToken = await accessKeyFromPassword(syncPassphraseRef.current)
        controller.signal.throwIfAborted()
      } catch (error: unknown) {
        reportMessageRerunTargetNotice(
          setNotice,
          messageId,
          () =>
            controller.signal.aborted
              ? t('notice.stopped')
              : t('notice.messageGenerationFailed', {
                  message: errorMessage(error),
                }),
          controller.signal.aborted ? 'warning' : 'error',
        )
        return null
      }
    }

    const requirement = generationRequirement({
      provider,
      model,
      providerKey: apiKey,
      proxyToken,
      t,
    })

    if (requirement) {
      reportMessageRerunTargetNotice(
        setNotice,
        messageId,
        () => requirement,
        undefined,
      )
      return null
    }

    handedOff = true
    return [provider, apiKey, proxyToken, controller]
  } finally {
    if (!handedOff) {
      releaseMessageRerunClaim(options, controller)
    }
  }
}

async function runMessageRerunGeneration(
  options: MessageRerunSharedOptions,
  runImageAssistantGeneration: RunImageAssistantGeneration,
  runTextAssistantGeneration: RunTextAssistantGeneration,
  provider: ProviderConfig,
  apiKey: string,
  proxyToken: string,
  conversationId: string,
  assistantId: string,
  model: string,
  conversationModel: string,
  baseMessages: ChatMessage[],
  promptMessage: ChatMessage,
  shouldGenerateImage: boolean,
  controller: AbortController,
): Promise<void> {
  const {
    abortRef,
    chatContextMessageLimit,
    commitPublishedLocalSnapshot,
    dataRef,
    errorMessage,
    flushStreamingAssistantContent,
    resetAssistantForRetry,
    runGenerationWithAutoRetry,
    scheduleAutoSync,
    setNotice,
    t,
    updateData,
  } = options
  const stoppedContent = t('notice.stopped')
  const generationOptions = {
    abortRef,
    apiKey,
    commitPublishedLocalSnapshot,
    controller,
    conversationId,
    dataRef,
    errorMessage,
    model,
    provider,
    proxyToken,
    resetAssistantForRetry,
    runGenerationWithAutoRetry,
    scheduleAutoSync,
    setNotice,
    stoppedContent,
    t,
    updateData,
  }

  try {
    if (shouldGenerateImage) {
      const { maskFile, sourceFile } =
        restoredImageEditFilesFromMessage(promptMessage)

      await runImageAssistantGeneration({
        ...generationOptions,
        assistantId,
        image: sourceFile ?? undefined,
        mask: maskFile ?? undefined,
        prompt: promptMessage.content,
        responsesModel: conversationModel,
      })
    } else {
      await runTextAssistantGeneration({
        ...generationOptions,
        assistantId,
        baseMessages,
        contextMessageLimit: chatContextMessageLimit,
        flushStreamingAssistantContent,
        latestInput: promptMessage.content,
      })
    }
  } catch (error: unknown) {
    await persistUnexpectedAssistantFailure({
      assistantId,
      commitPublishedLocalSnapshot,
      conversationId,
      dataRef,
      error,
      errorMessage,
      scheduleAutoSync,
      setNotice,
      stoppedContent,
      t,
      updateData,
    })
  }
}

export interface SubmitEditedUserMessageGenerationOptions
  extends MessageRerunSharedOptions {
  accessKeyFromPassword?: typeof defaultAccessKeyFromPassword
  activeConversation: Conversation | null
  editingContent: string
  editingMessageId: string
  idFactory?: () => string
  nowMs?: () => number
  runImageAssistantGeneration?: RunImageAssistantGeneration
  runTextAssistantGeneration?: RunTextAssistantGeneration
}

export async function submitEditedUserMessageGeneration(
  options: SubmitEditedUserMessageGenerationOptions,
): Promise<boolean> {
  const {
    accessKeyFromPassword = defaultAccessKeyFromPassword,
    activeConversation,
    activeImageModel,
    activeModel,
    activeProvider,
    clearEditingMessage,
    editingContent,
    editingMessageId,
    idFactory = () => crypto.randomUUID(),
    nowMs = now,
    runImageAssistantGeneration = defaultRunImageAssistantGeneration,
    runTextAssistantGeneration = defaultRunTextAssistantGeneration,
    sending,
    setNotice,
    t,
    updateData,
  } = options
  if (!activeConversation || !activeProvider || !editingMessageId || sending) {
    return false
  }

  const targetIndex = activeConversation.messages.findIndex(
    (message) => message.id === editingMessageId,
  )
  const target = activeConversation.messages[targetIndex]

  if (!target || target.role !== 'user') {
    clearEditingMessage()
    return false
  }

  const content = editingContent.trim()

  if (!content) {
    reportMessageRerunTargetNotice(
      setNotice,
      editingMessageId,
      () => t('notice.messageContentRequired'),
      'warning',
    )
    return true
  }

  const nextAssistant = activeConversation.messages[targetIndex + 1]
  const shouldGenerateImage = hasImageAttachment(nextAssistant)
  const model = shouldGenerateImage
    ? (nextAssistant?.attachments?.find((attachment) => attachment.kind === 'image')
        ?.model ?? activeImageModel)
    : activeModel
  const conversationModel = shouldGenerateImage
    ? activeModel || defaultModelForProvider(activeProvider)
    : model
  const request = await claimMessageRerunRequest(
    options,
    activeProvider,
    model,
    editingMessageId,
    accessKeyFromPassword,
  )

  if (!request) {
    return true
  }

  const [requestProvider, apiKey, proxyToken, controller] = request

  try {
    const updatedUserMessage: ChatMessage = {
      ...target,
      content,
      status: 'done',
      error: undefined,
    }
    const assistantMessage: ChatMessage = {
      id: idFactory(),
      role: 'assistant',
      content: '',
      createdAt: nowMs(),
      status: 'streaming',
    }
    const baseRequestMessages = [
      ...activeConversation.messages.slice(0, targetIndex),
      updatedUserMessage,
    ]
    const firstUserIndex = activeConversation.messages.findIndex(
      (message) => message.role === 'user',
    )
    const title =
      firstUserIndex === targetIndex
        ? cleanConversationTitle(content, t)
        : activeConversation.title

    const saved = updateData(
      (current) =>
        updateConversation(current, activeConversation.id, (conversation) => ({
          ...conversation,
          title,
          providerId: activeProvider.id,
          model: conversationModel,
          messages: [
            ...conversation.messages.slice(0, targetIndex),
            updatedUserMessage,
            assistantMessage,
          ],
        })),
      { autoSync: false },
    )

    if (!saved) {
      reportMessageRerunTargetNotice(
        setNotice,
        editingMessageId,
        () => t('notice.messageSaveUnavailable'),
        'error',
      )
      return true
    }

    if (
      !(await commitSubmittedGenerationStart({
        assistantId: assistantMessage.id,
        commitPublishedLocalSnapshot: options.commitPublishedLocalSnapshot,
        controller,
        conversationId: activeConversation.id,
        scheduleAutoSync: options.scheduleAutoSync,
        setNotice,
        snapshot: saved,
        t,
        updateData,
      }))
    ) {
      return true
    }

    clearEditingMessage()

    await runMessageRerunGeneration(
      options,
      runImageAssistantGeneration,
      runTextAssistantGeneration,
      requestProvider,
      apiKey,
      proxyToken,
      activeConversation.id,
      assistantMessage.id,
      model,
      conversationModel,
      baseRequestMessages,
      updatedUserMessage,
      shouldGenerateImage,
      controller,
    )

    return true
  } finally {
    releaseMessageRerunClaim(options, controller)
  }
}

export interface RegenerateAssistantMessageGenerationOptions
  extends MessageRerunSharedOptions {
  accessKeyFromPassword?: typeof defaultAccessKeyFromPassword
  activeConversation: Conversation | null
  data: AppData | null
  messageId: string
  runImageAssistantGeneration?: RunImageAssistantGeneration
  runTextAssistantGeneration?: RunTextAssistantGeneration
}

export async function regenerateAssistantMessageGeneration(
  options: RegenerateAssistantMessageGenerationOptions,
): Promise<boolean> {
  const {
    accessKeyFromPassword = defaultAccessKeyFromPassword,
    activeConversation,
    activeImageModel,
    activeModel,
    activeProvider,
    clearEditingMessage,
    data,
    messageId,
    runImageAssistantGeneration = defaultRunImageAssistantGeneration,
    runTextAssistantGeneration = defaultRunTextAssistantGeneration,
    sending,
    setNotice,
    t,
    updateData,
  } = options
  if (!data || !activeConversation || !activeProvider || sending) {
    return false
  }

  const targetIndex = activeConversation.messages.findIndex(
    (message) => message.id === messageId,
  )
  const target = activeConversation.messages[targetIndex]

  if (!target || target.role !== 'assistant' || target.status === 'streaming') {
    return false
  }

  const baseRequestMessages = activeConversation.messages.slice(0, targetIndex)
  const promptMessage = [...baseRequestMessages]
    .reverse()
    .find((message) => message.role === 'user')

  if (!promptMessage) {
    reportMessageRerunTargetNotice(
      setNotice,
      messageId,
      () => t('notice.noUserMessageToRegenerate'),
      'warning',
    )
    return true
  }

  const shouldGenerateImage = hasImageAttachment(target)
  const previousGeneratedImage =
    target.attachments?.find(
      (attachment) => attachment.purpose === 'generated',
    ) ?? target.attachments?.find((attachment) => attachment.kind === 'image')
  const model = shouldGenerateImage
    ? (previousGeneratedImage?.model ?? activeImageModel)
    : activeModel
  const conversationModel = shouldGenerateImage
    ? activeModel || defaultModelForProvider(activeProvider)
    : model
  const request = await claimMessageRerunRequest(
    options,
    activeProvider,
    model,
    messageId,
    accessKeyFromPassword,
  )

  if (!request) {
    return true
  }

  const [requestProvider, apiKey, proxyToken, controller] = request

  try {
    const saved = updateData(
      (current) =>
        updateConversation(current, activeConversation.id, (conversation) => ({
          ...conversation,
          providerId: activeProvider.id,
          model: conversationModel,
          messages: conversation.messages
            .slice(0, targetIndex + 1)
            .map((message, index) =>
              index === targetIndex
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

    if (!saved) {
      reportMessageRerunTargetNotice(
        setNotice,
        messageId,
        () => t('notice.messageSaveUnavailable'),
        'error',
      )
      return true
    }

    if (
      !(await commitSubmittedGenerationStart({
        assistantId: messageId,
        commitPublishedLocalSnapshot: options.commitPublishedLocalSnapshot,
        controller,
        conversationId: activeConversation.id,
        scheduleAutoSync: options.scheduleAutoSync,
        setNotice,
        snapshot: saved,
        t,
        updateData,
      }))
    ) {
      return true
    }

    clearEditingMessage()

    await runMessageRerunGeneration(
      options,
      runImageAssistantGeneration,
      runTextAssistantGeneration,
      requestProvider,
      apiKey,
      proxyToken,
      activeConversation.id,
      messageId,
      model,
      conversationModel,
      baseRequestMessages,
      promptMessage,
      shouldGenerateImage,
      controller,
    )

    return true
  } finally {
    releaseMessageRerunClaim(options, controller)
  }
}
