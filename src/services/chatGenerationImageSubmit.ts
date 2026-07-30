import type { Translator } from '../i18n'
import type { NoticeTarget } from '../components/Notice'
import {
  now as currentNow,
  updateConversation,
} from './appData'
import { cleanConversationTitle } from './conversations'
import { fileToDataUrl as defaultFileToDataUrl } from './imageAttachments'
import type { ImageTaskMode } from './imageComposerChrome'
import {
  generationPreflightRequirement,
  generationRequirement,
  generationRequiresProxyToken,
} from './generationRequirements'
import {
  runImageAssistantGeneration as defaultRunImageAssistantGeneration,
} from './chatGenerationAssistantRun'
import type { GenerationAutoRetryOptions } from './chatGenerationRuntime'
import {
  registerGenerationAbortController,
  reportGenerationNotice as reportImageSubmitNotice,
} from './chatGenerationRuntime'
import {
  commitSubmittedGenerationStart,
  persistUnexpectedAssistantFailure,
} from './chatGenerationSubmitPersistence'
import {
  defaultModelForProvider,
  modelForProviderCapability,
} from './providerModels'
import {
  browserProviderKey,
  providerForAiRequest,
} from './providerConfig'
import { accessKeyFromPassword as defaultAccessKeyFromPassword } from './accessKey'
import type { NoticeTone } from './uiRuntime'
import type { LocalSaveCommitPrecondition } from './localSaveQueueController'
import type {
  AppData,
  ChatMessage,
  Conversation,
  MessageAttachment,
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

type RunGenerationWithAutoRetry = <T>(
  operation: () => Promise<T>,
  options: Omit<GenerationAutoRetryOptions, 'setNotice' | 't'>,
) => Promise<T>

type RunImageAssistantGeneration = typeof defaultRunImageAssistantGeneration

interface ImageSubmitServices {
  accessKeyFromPassword?: typeof defaultAccessKeyFromPassword
  fileToDataUrl?: typeof defaultFileToDataUrl
  now?: () => number
  randomId?: () => string
  runImageAssistantGeneration?: RunImageAssistantGeneration
}

export interface SendImageMessageGenerationOptions extends ImageSubmitServices {
  abortRef: MutableRef<AbortController | null>
  activeConversation: Conversation
  activeImageModel: string
  activeModel: string
  activeProvider: ProviderConfig
  commitPublishedLocalSnapshot: (
    snapshot: AppData,
    precondition?: LocalSaveCommitPrecondition,
  ) => Promise<void>
  content: string
  data: AppData
  dataRef: MutableRef<AppData | null>
  draftRevision: number
  draftRevisionRef: MutableRef<number>
  errorMessage: (error: unknown) => string
  finishSending: () => void
  imageSourceFile: File | null
  imageTaskMode: ImageTaskMode
  isOnlineRef: MutableRef<boolean>
  maskFileFromCanvas: () => Promise<File>
  maskTouched: boolean
  providerKeys: Record<string, string>
  resetAssistantForRetry: (conversationId: string, messageId: string) => void
  runGenerationWithAutoRetry: RunGenerationWithAutoRetry
  scheduleAutoSync: (snapshot: AppData, delay?: number) => void
  setDraft: (value: string) => void
  setImageSource: (file: File | null) => void
  setNotice: SetNotice
  startSending: () => void
  syncPassphraseRef: MutableRef<string>
  t: Translator
  updateData: UpdateData
}

export { reportImageSubmitNotice }

function reportStoppedImageSubmit(setNotice: SetNotice, t: Translator): void {
  reportImageSubmitNotice(
    setNotice,
    () => t('notice.stopped'),
    'warning',
    'chat',
  )
}

export async function sendImageMessageGeneration({
  abortRef,
  accessKeyFromPassword = defaultAccessKeyFromPassword,
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
  fileToDataUrl = defaultFileToDataUrl,
  finishSending,
  imageSourceFile,
  imageTaskMode,
  isOnlineRef,
  maskFileFromCanvas,
  maskTouched,
  now = currentNow,
  providerKeys,
  randomId = () => crypto.randomUUID(),
  resetAssistantForRetry,
  runGenerationWithAutoRetry,
  runImageAssistantGeneration = defaultRunImageAssistantGeneration,
  scheduleAutoSync,
  setDraft,
  setImageSource,
  setNotice,
  startSending,
  syncPassphraseRef,
  t,
  updateData,
}: SendImageMessageGenerationOptions): Promise<void> {
  const sourceFile = imageSourceFile

  if (imageTaskMode !== 'generate') {
    if (!sourceFile) {
      reportImageSubmitNotice(setNotice, () => t('notice.imageRequired'))
      return
    }
  }

  if (imageTaskMode === 'inpaint') {
    if (!maskTouched) {
      reportImageSubmitNotice(setNotice, () => t('notice.maskRequired'))
      return
    }
  }

  const requestProvider = providerForAiRequest(activeProvider, data)
  const model =
    imageTaskMode === 'generate'
      ? activeImageModel
      : modelForProviderCapability(activeProvider, 'image-editing')
  const chatModel = activeModel || defaultModelForProvider(activeProvider)
  const apiKey = browserProviderKey(requestProvider, providerKeys)
  const preflightRequirement = generationPreflightRequirement({
    provider: requestProvider,
    model,
    providerKey: apiKey,
    t,
  })

  if (preflightRequirement) {
    reportImageSubmitNotice(setNotice, () => preflightRequirement)
    return
  }

  if (!isOnlineRef.current) {
    reportImageSubmitNotice(
      setNotice,
      () => t('notice.offlineImageUnavailable'),
      'warning',
      'chat',
    )
    return
  }

  if (abortRef.current) {
    return
  }

  const controller = registerGenerationAbortController(abortRef)
  startSending()
  reportImageSubmitNotice(setNotice, () => '')

  try {
    let sourceDataUrl = ''
    let maskFile: File | undefined
    let maskDataUrl = ''

    try {
      if (imageTaskMode !== 'generate' && sourceFile) {
        sourceDataUrl = await fileToDataUrl(sourceFile)
        controller.signal.throwIfAborted()
      }

      if (imageTaskMode === 'inpaint') {
        maskFile = await maskFileFromCanvas()
        controller.signal.throwIfAborted()
        maskDataUrl = await fileToDataUrl(maskFile)
        controller.signal.throwIfAborted()
      }
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        reportStoppedImageSubmit(setNotice, t)
        return
      }

      reportImageSubmitNotice(
        setNotice,
        () =>
          t('notice.imagePreparationFailed', { message: errorMessage(error) }),
        'error',
        'chat',
      )
      return
    }

    let proxyToken = ''
    if (generationRequiresProxyToken(requestProvider)) {
      try {
        proxyToken = await accessKeyFromPassword(syncPassphraseRef.current)
        controller.signal.throwIfAborted()
      } catch (error: unknown) {
        if (controller.signal.aborted) {
          reportStoppedImageSubmit(setNotice, t)
          return
        }

        reportImageSubmitNotice(
          setNotice,
          () =>
            t('notice.messageGenerationFailed', { message: errorMessage(error) }),
          'error',
          'chat',
        )
        return
      }
    }

    const requirement = generationRequirement({
      provider: requestProvider,
      model,
      providerKey: apiKey,
      proxyToken,
      t,
    })

    if (requirement) {
      reportImageSubmitNotice(setNotice, () => requirement)
      return
    }

    const userAttachments = imageSubmitUserAttachments({
      imageTaskMode,
      maskDataUrl,
      maskFile,
      now,
      randomId,
      sourceDataUrl,
      sourceFile,
      t,
    })
    const userMessage: ChatMessage = {
      id: randomId(),
      role: 'user',
      content,
      createdAt: now(),
      status: 'done',
      attachments: userAttachments.length ? userAttachments : undefined,
    }
    const assistantMessage: ChatMessage = {
      id: randomId(),
      role: 'assistant',
      content: '',
      createdAt: now(),
      status: 'streaming',
    }
    const title =
      activeConversation.messages.length === 0
        ? cleanConversationTitle(content, t)
        : activeConversation.title

    const saved = updateData((current) =>
      updateConversation(current, activeConversation.id, (conversation) => ({
        ...conversation,
        title,
        providerId: activeProvider.id,
        model: chatModel,
        messages: [...conversation.messages, userMessage, assistantMessage],
      })),
      { autoSync: false },
    )

    if (!saved) {
      reportImageSubmitNotice(
        setNotice,
        () => t('notice.messageSaveUnavailable'),
        'error',
        'chat',
      )
      return
    }

    if (
      !(await commitSubmittedGenerationStart({
        assistantId: assistantMessage.id,
        commitPublishedLocalSnapshot,
        controller,
        conversationId: activeConversation.id,
        scheduleAutoSync,
        setNotice,
        snapshot: saved,
        t,
        updateData,
      }))
    ) {
      return
    }

    if (draftRevisionRef.current === draftRevision) {
      setDraft('')
    }
    setImageSource(null)

    const stoppedContent = t('notice.stopped')

    try {
      await runImageAssistantGeneration({
        abortRef,
        apiKey,
        assistantId: assistantMessage.id,
        commitPublishedLocalSnapshot,
        controller,
        conversationId: activeConversation.id,
        dataRef,
        errorMessage,
        image: imageTaskMode === 'generate' ? undefined : sourceFile ?? undefined,
        mask: maskFile,
        model,
        prompt: content,
        provider: requestProvider,
        proxyToken,
        responsesModel: chatModel,
        resetAssistantForRetry,
        runGenerationWithAutoRetry,
        scheduleAutoSync,
        setNotice,
        stoppedContent,
        t,
        updateData,
      })
    } catch (error: unknown) {
      await persistUnexpectedAssistantFailure({
        assistantId: assistantMessage.id,
        commitPublishedLocalSnapshot,
        conversationId: activeConversation.id,
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
  } finally {
    if (abortRef.current === controller) {
      abortRef.current = null
    }
    finishSending()
  }
}

function imageSubmitUserAttachments({
  imageTaskMode,
  maskDataUrl,
  maskFile,
  now,
  randomId,
  sourceDataUrl,
  sourceFile,
  t,
}: {
  imageTaskMode: ImageTaskMode
  maskDataUrl: string
  maskFile: File | undefined
  now: () => number
  randomId: () => string
  sourceDataUrl: string
  sourceFile: File | null
  t: Translator
}): MessageAttachment[] {
  if (imageTaskMode === 'generate') {
    return []
  }

  const sourceAttachment: MessageAttachment = {
    id: randomId(),
    kind: 'image',
    purpose: 'source',
    mimeType: sourceFile?.type || 'image/png',
    dataUrl: sourceDataUrl,
    alt: t('message.sourceImage'),
    createdAt: now(),
  }
  const maskAttachment: MessageAttachment | null =
    maskFile && maskDataUrl
      ? {
          id: randomId(),
          kind: 'image',
          purpose: 'mask',
          mimeType: 'image/png',
          dataUrl: maskDataUrl,
          alt: t('message.maskImage'),
          createdAt: now(),
        }
      : null

  return maskAttachment ? [sourceAttachment, maskAttachment] : [sourceAttachment]
}
