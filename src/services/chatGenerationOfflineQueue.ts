import type { NoticeTarget } from '../components/Notice'
import type { Translator } from '../i18n'
import type {
  AppData,
  Conversation,
  OfflineReplayClaim,
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
  appendOfflineQueuedTextTurn,
  completeQueuedTextAssistant,
  enabledProviderForQueuedText,
  findFirstOrphanedQueuedTextAssistant,
  findFirstQueuedTextAssistant,
  queuedTextAssistantFailurePatch,
  removeOfflineQueuedTextTurn,
  updateQueuedTextAssistant,
} from './offlineQueue'
import {
  persistPublishedLocalSnapshot,
  type LocalSaveCommitPrecondition,
} from './localSaveQueueController'
import {
  browserProviderKey,
  providerForAiRequest,
} from './providerConfig'
import { defaultModelForProvider } from './providerModels'
import {
  streamAssistantText as defaultStreamAssistantText,
  type StreamAssistantTextOptions,
} from './chatGenerationTextStream'
import {
  type GenerationAutoRetryOptions,
  registerGenerationAbortController,
  reportGenerationNotice as reportOfflineQueueNotice,
} from './chatGenerationRuntime'
import { isAbortError, type NoticeTone } from './uiRuntime'

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

type StreamAssistantText = (
  options: StreamAssistantTextOptions,
) => Promise<void>

type CommitPublishedLocalSnapshot = (
  snapshot: AppData,
  precondition?: LocalSaveCommitPrecondition,
) => Promise<void>

async function commitOfflineQueuedSnapshot(snapshot: AppData): Promise<void> {
  await persistPublishedLocalSnapshot(snapshot)
}

let defaultOfflineReplayOwner: string | null = null

function getDefaultOfflineReplayOwner(): string {
  defaultOfflineReplayOwner ??= crypto.randomUUID()
  return defaultOfflineReplayOwner
}

function ownsOfflineReplayClaim(
  snapshot: AppData | null,
  conversationId: string,
  assistantId: string,
  claim: OfflineReplayClaim,
): boolean {
  const assistant = snapshot?.conversations
    .find((conversation) => conversation.id === conversationId)
    ?.messages.find((message) => message.id === assistantId)

  return (
    assistant?.status === 'streaming' &&
    assistant.offlineReplayClaim?.claimId === claim.claimId &&
    assistant.offlineReplayClaim.owner === claim.owner
  )
}

function clearOfflineReplayClaim(
  conversation: Conversation,
  assistantId: string,
): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => {
      if (
        message.id !== assistantId ||
        message.offlineReplayClaim === undefined
      ) {
        return message
      }

      const cleared = { ...message }
      delete cleared.offlineReplayClaim
      return cleared
    }),
  }
}

function updateQueuedTextAssistantWithoutReplayClaim(
  conversation: Conversation,
  assistantId: string,
  patch: Parameters<typeof updateQueuedTextAssistant>[2],
): Conversation {
  return clearOfflineReplayClaim(
    updateQueuedTextAssistant(conversation, assistantId, patch),
    assistantId,
  )
}

export { reportOfflineQueueNotice }

function releaseOfflineQueueAbortController(
  abortRef: MutableRef<AbortController | null>,
  controller: AbortController,
): void {
  if (abortRef.current === controller) {
    abortRef.current = null
  }
}

export interface QueueOfflineTextMessageOptions {
  activeConversation: Conversation | null
  activeProvider: ProviderConfig | null
  commitPublishedLocalSnapshot?: CommitPublishedLocalSnapshot
  content: string
  draftRevision: number
  draftRevisionRef: MutableRef<number>
  idFactory?: () => string
  model: string
  nowMs?: () => number
  setDraft: (value: string) => void
  setNotice: SetNotice
  t: Translator
  updateData: UpdateData
}

export function queueOfflineTextMessage({
  activeConversation,
  activeProvider,
  commitPublishedLocalSnapshot = commitOfflineQueuedSnapshot,
  content,
  draftRevision,
  draftRevisionRef,
  idFactory = () => crypto.randomUUID(),
  model,
  nowMs = now,
  setDraft,
  setNotice,
  t,
  updateData,
}: QueueOfflineTextMessageOptions): boolean {
  if (!activeConversation || !activeProvider) {
    return false
  }

  const title =
    activeConversation.messages.length === 0
      ? cleanConversationTitle(content, t)
      : activeConversation.title
  const userMessageId = idFactory()
  const assistantMessageId = idFactory()

  const saved = updateData((current) =>
    updateConversation(current, activeConversation.id, (conversation) =>
      appendOfflineQueuedTextTurn({
        conversation,
        providerId: activeProvider.id,
        model,
        content,
        title,
        userMessageId,
        assistantMessageId,
        createdAt: nowMs(),
        queuedAssistantContent: t('message.offlineQueued'),
      }),
    ),
  )

  if (!saved) {
    reportOfflineQueueNotice(
      setNotice,
      () => t('notice.messageSaveUnavailable'),
      'error',
      'chat',
    )
    return false
  }

  const rollbackQueuedTurn = (): void => {
    updateData(
      (current) =>
        updateConversation(current, activeConversation.id, (conversation) =>
          removeOfflineQueuedTextTurn(
            conversation,
            userMessageId,
            assistantMessageId,
          ),
        ),
      { autoSync: false },
    )
    reportOfflineQueueNotice(
      setNotice,
      () => t('notice.messageSaveUnavailable'),
      'error',
      'chat',
    )
  }

  try {
    void commitPublishedLocalSnapshot(saved).then(
      () => {
        if (draftRevisionRef.current === draftRevision) {
          setDraft('')
        }
        reportOfflineQueueNotice(
          setNotice,
          () => t('notice.offlineMessageQueued'),
          'warning',
          'chat',
        )
      },
      rollbackQueuedTurn,
    )
  } catch {
    rollbackQueuedTurn()
  }

  return true
}

export interface FlushQueuedOfflineTextMessagesOptions {
  abortRef: MutableRef<AbortController | null>
  accessKeyFromPassword?: typeof defaultAccessKeyFromPassword
  chatContextMessageLimit: number
  dataRef: MutableRef<AppData | null>
  errorMessage: (error: unknown) => string
  flushStreamingAssistantContent: (
    conversationId: string,
    messageId: string,
    content: string,
  ) => void
  isOnlineRef: MutableRef<boolean>
  offlineQueueRunningRef: MutableRef<boolean>
  onQueueRunFinished: () => void
  onQueueRunStarted: () => void
  commitPublishedLocalSnapshot: CommitPublishedLocalSnapshot
  providerKeysRef: MutableRef<Record<string, string>>
  resetAssistantForRetry: (conversationId: string, messageId: string) => void
  replayClaimIdFactory?: () => string
  replayClaimOwner?: string
  runGenerationWithAutoRetry: RunGenerationWithAutoRetry
  scheduleAutoSync: (snapshot: AppData, delay?: number) => void
  setNotice: SetNotice
  streamAssistantText?: StreamAssistantText
  syncPassphraseRef: MutableRef<string>
  t: Translator
  updateData: UpdateData
}

export async function flushQueuedOfflineTextMessages({
  abortRef,
  accessKeyFromPassword = defaultAccessKeyFromPassword,
  chatContextMessageLimit,
  dataRef,
  errorMessage,
  flushStreamingAssistantContent,
  isOnlineRef,
  offlineQueueRunningRef,
  onQueueRunFinished,
  onQueueRunStarted,
  commitPublishedLocalSnapshot,
  providerKeysRef,
  resetAssistantForRetry,
  replayClaimIdFactory = () => crypto.randomUUID(),
  replayClaimOwner = getDefaultOfflineReplayOwner(),
  runGenerationWithAutoRetry,
  scheduleAutoSync,
  setNotice,
  streamAssistantText = defaultStreamAssistantText,
  syncPassphraseRef,
  t,
  updateData,
}: FlushQueuedOfflineTextMessagesOptions): Promise<void> {
  if (
    offlineQueueRunningRef.current ||
    !isOnlineRef.current ||
    abortRef.current
  ) {
    return
  }

  offlineQueueRunningRef.current = true
  onQueueRunStarted()
  const reportQueuedAssistantSaveFailure = (assistantId: string): void => {
    reportOfflineQueueNotice(
      setNotice,
      () => t('notice.messageSaveUnavailable'),
      'error',
      'message',
      assistantId,
    )
  }
  const persistQueuedAssistantSnapshot = async (
    snapshot: AppData | null,
    assistantId: string,
  ): Promise<AppData | null> => {
    if (!snapshot) {
      reportQueuedAssistantSaveFailure(assistantId)
      return null
    }

    try {
      await commitPublishedLocalSnapshot(snapshot)
      return snapshot
    } catch {
      reportQueuedAssistantSaveFailure(assistantId)
      return null
    }
  }

  try {
    while (isOnlineRef.current) {
      const current = dataRef.current

      if (!current) {
        break
      }

      const orphaned = findFirstOrphanedQueuedTextAssistant(current)
      if (orphaned) {
        const error = t('notice.offlinePromptUnavailable')
        const saved = updateData((latest) =>
          updateConversation(
            latest,
            orphaned.conversation.id,
            (conversation) =>
              updateQueuedTextAssistantWithoutReplayClaim(
                conversation,
                orphaned.assistant.id,
                {
                  content: error,
                  status: 'error',
                  error,
                },
              ),
          ),
        )
        if (!(await persistQueuedAssistantSnapshot(saved, orphaned.assistant.id))) {
          break
        }
        continue
      }

      const queued = findFirstQueuedTextAssistant(current)
      if (!queued) {
        break
      }

      const provider = enabledProviderForQueuedText(
        current,
        queued.request,
      )

      if (!provider) {
        const error = t('error.apiUnavailable')
        const saved = updateData((latest) =>
          updateConversation(latest, queued.conversation.id, (conversation) =>
            updateQueuedTextAssistantWithoutReplayClaim(
              conversation,
              queued.assistant.id,
              {
                content: error,
                status: 'error',
                error,
              },
            ),
          ),
        )
        if (!(await persistQueuedAssistantSnapshot(saved, queued.assistant.id))) {
          break
        }
        continue
      }

      const model = queued.request.model || defaultModelForProvider(provider)
      const requestProvider = providerForAiRequest(provider, current)
      const apiKey = browserProviderKey(requestProvider, providerKeysRef.current)
      const preflightRequirement = generationPreflightRequirement({
        provider: requestProvider,
        model,
        providerKey: apiKey,
        t,
      })

      if (preflightRequirement) {
        const saved = updateData((latest) =>
          updateConversation(latest, queued.conversation.id, (conversation) =>
            updateQueuedTextAssistantWithoutReplayClaim(
              conversation,
              queued.assistant.id,
              {
                content: preflightRequirement,
                status: 'error',
                error: preflightRequirement,
              },
            ),
          ),
        )
        if (!(await persistQueuedAssistantSnapshot(saved, queued.assistant.id))) {
          break
        }
        continue
      }

      const controller = registerGenerationAbortController(abortRef)
      let assistantContent = ''
      try {
        let proxyToken = ''
        if (generationRequiresProxyToken(requestProvider)) {
          try {
            proxyToken = await accessKeyFromPassword(syncPassphraseRef.current)
            controller.signal.throwIfAborted()
          } catch (error: unknown) {
            if (isAbortError(error)) {
              throw error
            }

            const failure = t('notice.messageGenerationFailed', {
              message: errorMessage(error),
            })
            reportOfflineQueueNotice(
              setNotice,
              () => failure,
              'error',
              'message',
              queued.assistant.id,
            )
            const saved = updateData((latest) =>
              updateConversation(
                latest,
                queued.conversation.id,
                (conversation) =>
                  updateQueuedTextAssistantWithoutReplayClaim(
                    conversation,
                    queued.assistant.id,
                    {
                      content: failure,
                      status: 'error',
                      error: failure,
                    },
                  ),
              ),
            )
            if (!(await persistQueuedAssistantSnapshot(saved, queued.assistant.id))) {
              break
            }
            continue
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
          const saved = updateData((latest) =>
            updateConversation(latest, queued.conversation.id, (conversation) =>
              updateQueuedTextAssistantWithoutReplayClaim(
                conversation,
                queued.assistant.id,
                {
                  content: requirement,
                  status: 'error',
                  error: requirement,
                },
              ),
            ),
          )
          if (!(await persistQueuedAssistantSnapshot(saved, queued.assistant.id))) {
            break
          }
          continue
        }

        const baseRequestMessages = queued.conversation.messages.slice(
          0,
          queued.assistantIndex,
        )

        const replayClaim: OfflineReplayClaim = {
          claimId: replayClaimIdFactory(),
          owner: replayClaimOwner,
        }
        const started = updateData(
          (latest) =>
            updateConversation(latest, queued.conversation.id, (conversation) =>
              updateQueuedTextAssistant(
                conversation,
                queued.assistant.id,
                {
                  content: '',
                  status: 'streaming',
                  error: undefined,
                  offlineReplayClaim: replayClaim,
                },
              ),
            ),
          { autoSync: false },
        )

        if (!started) {
          reportQueuedAssistantSaveFailure(queued.assistant.id)
          break
        }

        let replayClaimOutcome: boolean | null = null
        const replayClaimPrecondition: LocalSaveCommitPrecondition = {
          isSatisfied: (snapshot) =>
            ownsOfflineReplayClaim(
              snapshot,
              queued.conversation.id,
              queued.assistant.id,
              replayClaim,
            ),
          onOutcome: (snapshot) => {
            replayClaimOutcome = ownsOfflineReplayClaim(
              snapshot,
              queued.conversation.id,
              queued.assistant.id,
              replayClaim,
            )
          },
        }

        try {
          await commitPublishedLocalSnapshot(started, replayClaimPrecondition)
        } catch {
          updateData(
            (latest) =>
              updateConversation(latest, queued.conversation.id, (conversation) =>
                updateQueuedTextAssistantWithoutReplayClaim(
                  conversation,
                  queued.assistant.id,
                  {
                    content: queued.assistant.content,
                    status: 'queued',
                    error: undefined,
                  },
                ),
              ),
            { autoSync: false },
          )
          reportQueuedAssistantSaveFailure(queued.assistant.id)
          break
        }

        const replayClaimWon =
          replayClaimOutcome ??
          replayClaimPrecondition.isSatisfied(dataRef.current)
        if (!replayClaimWon) {
          break
        }

        await runGenerationWithAutoRetry(
          async () => {
            assistantContent = ''
            await streamAssistantText({
              provider: requestProvider,
              apiKey,
              proxyToken,
              model,
              baseMessages: baseRequestMessages,
              latestInput: queued.prompt.content,
              snapshot: dataRef.current,
              contextMessageLimit: chatContextMessageLimit,
              signal: controller.signal,
              onToken: (token) => {
                assistantContent += token
                flushStreamingAssistantContent(
                  queued.conversation.id,
                  queued.assistant.id,
                  assistantContent,
                )
              },
            })
          },
          {
            signal: controller.signal,
            target: 'message',
            anchorId: queued.assistant.id,
            onRetry: () =>
              resetAssistantForRetry(
                queued.conversation.id,
                queued.assistant.id,
              ),
          },
        )

        const completed = updateData(
          (latest) =>
            updateConversation(latest, queued.conversation.id, (conversation) =>
              clearOfflineReplayClaim(
                completeQueuedTextAssistant(
                  conversation,
                  queued.assistant.id,
                  assistantContent,
                ),
                queued.assistant.id,
              ),
            ),
          { autoSync: false },
        )

        const persistedCompletion = await persistQueuedAssistantSnapshot(
          completed,
          queued.assistant.id,
        )
        if (!persistedCompletion) {
          break
        }

        reportOfflineQueueNotice(setNotice, () => '')
        scheduleAutoSync(persistedCompletion, 0)
      } catch (error: unknown) {
        const isAbort = isAbortError(error)
        const failure = queuedTextAssistantFailurePatch({
          aborted: isAbort,
          online: isOnlineRef.current,
          assistantContent,
          queuedContent: t('message.offlineQueued'),
          stoppedContent: t('notice.stopped'),
          errorContent: errorMessage(error),
        })

        const saved = updateData((latest) =>
          updateConversation(latest, queued.conversation.id, (conversation) =>
            updateQueuedTextAssistantWithoutReplayClaim(
              conversation,
              queued.assistant.id,
              failure.patch,
            ),
          ),
        )

        if (!(await persistQueuedAssistantSnapshot(saved, queued.assistant.id))) {
          break
        }

        if (isAbort || failure.shouldStayQueued) {
          break
        }
      } finally {
        releaseOfflineQueueAbortController(abortRef, controller)
      }
    }
  } finally {
    offlineQueueRunningRef.current = false
    onQueueRunFinished()
  }
}
