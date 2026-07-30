import type { Translator } from '../i18n'
import type { NoticeTarget } from '../components/Notice'
import {
  now as currentNow,
  updateConversation,
} from './appData'
import { accessKeyFromPassword as defaultAccessKeyFromPassword } from './accessKey'
import {
  runTextAssistantGeneration as defaultRunTextAssistantGeneration,
} from './chatGenerationAssistantRun'
import type { RunTextAssistantGenerationOptions } from './chatGenerationAssistantRun'
import type { GenerationAutoRetryOptions } from './chatGenerationRuntime'
import {
  registerGenerationAbortController,
  reportGenerationNotice as reportTextSubmitNotice,
} from './chatGenerationRuntime'
import {
  commitSubmittedGenerationStart,
  persistUnexpectedAssistantFailure,
} from './chatGenerationSubmitPersistence'
import {
  queueOfflineTextMessage as defaultQueueOfflineTextMessage,
} from './chatGenerationOfflineQueue'
import type { QueueOfflineTextMessageOptions } from './chatGenerationOfflineQueue'
import { cleanConversationTitle } from './conversations'
import {
  generationPreflightRequirement,
  generationRequirement,
  generationRequiresProxyToken,
} from './generationRequirements'
import {
  browserProviderKey,
  providerForAiRequest,
} from './providerConfig'
import type { NoticeTone } from './uiRuntime'
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

type RunGenerationWithAutoRetry = <T>(
  operation: () => Promise<T>,
  options: Omit<GenerationAutoRetryOptions, 'setNotice' | 't'>,
) => Promise<T>

type QueueOfflineTextMessage = (
  options: QueueOfflineTextMessageOptions,
) => boolean

type RunTextAssistantGeneration = typeof defaultRunTextAssistantGeneration

interface TextSubmitServices {
  accessKeyFromPassword?: typeof defaultAccessKeyFromPassword
  now?: () => number
  queueOfflineTextMessage?: QueueOfflineTextMessage
  randomId?: () => string
  runTextAssistantGeneration?: RunTextAssistantGeneration
}

export interface SendTextMessageGenerationOptions extends TextSubmitServices {
  abortRef: MutableRef<AbortController | null>
  activeConversation: Conversation
  activeModel: string
  activeProvider: ProviderConfig
  chatContextMessageLimit: number
  commitPublishedLocalSnapshot: (snapshot: AppData) => Promise<void>
  content: string
  data: AppData
  dataRef: MutableRef<AppData | null>
  draftRevision: number
  draftRevisionRef: MutableRef<number>
  errorMessage: (error: unknown) => string
  finishSending: () => void
  flushStreamingAssistantContent: (
    conversationId: string,
    messageId: string,
    content: string,
  ) => void
  isOnlineRef: MutableRef<boolean>
  providerKeys: Record<string, string>
  resetAssistantForRetry: (conversationId: string, messageId: string) => void
  runGenerationWithAutoRetry: RunGenerationWithAutoRetry
  scheduleAutoSync: (snapshot: AppData, delay?: number) => void
  setDraft: (value: string) => void
  setNotice: SetNotice
  startSending: () => void
  syncPassphraseRef: MutableRef<string>
  t: Translator
  updateData: UpdateData
}

export { reportTextSubmitNotice }

export async function sendTextMessageGeneration({
  abortRef,
  accessKeyFromPassword = defaultAccessKeyFromPassword,
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
  finishSending,
  flushStreamingAssistantContent,
  isOnlineRef,
  now = currentNow,
  providerKeys,
  queueOfflineTextMessage = defaultQueueOfflineTextMessage,
  randomId = () => crypto.randomUUID(),
  resetAssistantForRetry,
  runGenerationWithAutoRetry,
  runTextAssistantGeneration = defaultRunTextAssistantGeneration,
  scheduleAutoSync,
  setDraft,
  setNotice,
  startSending,
  syncPassphraseRef,
  t,
  updateData,
}: SendTextMessageGenerationOptions): Promise<void> {
  const model = activeModel
  const requestProvider = providerForAiRequest(activeProvider, data)
  const apiKey = browserProviderKey(requestProvider, providerKeys)
  const preflightRequirement = generationPreflightRequirement({
    provider: requestProvider,
    model,
    providerKey: apiKey,
    t,
  })

  if (preflightRequirement) {
    reportTextSubmitNotice(setNotice, () => preflightRequirement)
    return
  }

  if (!isOnlineRef.current) {
    queueOfflineTextMessage({
      activeConversation,
      activeProvider,
      commitPublishedLocalSnapshot,
      content,
      draftRevision,
      draftRevisionRef,
      model,
      setDraft,
      setNotice,
      t,
      updateData,
    })
    return
  }

  if (abortRef.current) {
    return
  }

  const controller = registerGenerationAbortController(abortRef)
  startSending()
  reportTextSubmitNotice(setNotice, () => '')

  try {
    let proxyToken = ''
    if (generationRequiresProxyToken(requestProvider)) {
      try {
        proxyToken = await accessKeyFromPassword(syncPassphraseRef.current)
        controller.signal.throwIfAborted()
      } catch (error: unknown) {
        if (controller.signal.aborted) {
          reportTextSubmitNotice(
            setNotice,
            () => t('notice.stopped'),
            'warning',
            'chat',
          )
          return
        }

        reportTextSubmitNotice(
          setNotice,
          () =>
            t('notice.messageGenerationFailed', {
              message: errorMessage(error),
            }),
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
      reportTextSubmitNotice(setNotice, () => requirement)
      return
    }

    const userMessage: ChatMessage = {
      id: randomId(),
      role: 'user',
      content,
      createdAt: now(),
      status: 'done',
    }
    const assistantMessage: ChatMessage = {
      id: randomId(),
      role: 'assistant',
      content: '',
      createdAt: now(),
      status: 'streaming',
    }
    const baseRequestMessages = [...activeConversation.messages, userMessage]
    const title =
      activeConversation.messages.length === 0
        ? cleanConversationTitle(content, t)
        : activeConversation.title

    const saved = updateData((current) =>
      updateConversation(current, activeConversation.id, (conversation) => ({
        ...conversation,
        title,
        providerId: activeProvider.id,
        model,
        messages: [...conversation.messages, userMessage, assistantMessage],
      })),
      { autoSync: false },
    )

    if (!saved) {
      reportTextSubmitNotice(
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

    const stoppedContent = t('notice.stopped')

    try {
      await runTextAssistantGeneration({
        abortRef,
        apiKey,
        assistantId: assistantMessage.id,
        baseMessages: baseRequestMessages,
        commitPublishedLocalSnapshot,
        contextMessageLimit: chatContextMessageLimit,
        controller,
        conversationId: activeConversation.id,
        dataRef,
        errorMessage,
        flushStreamingAssistantContent,
        latestInput: content,
        model,
        provider: requestProvider,
        proxyToken,
        resetAssistantForRetry,
        runGenerationWithAutoRetry,
        scheduleAutoSync,
        setNotice,
        stoppedContent,
        t,
        updateData,
      } satisfies RunTextAssistantGenerationOptions)
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
