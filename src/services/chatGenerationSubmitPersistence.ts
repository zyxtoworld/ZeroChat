import type { NoticeTarget } from '../components/Notice'
import type { Translator } from '../i18n'
import type { AppData } from '../types'
import { updateConversation } from './appData'
import {
  messageGenerationFailurePatch,
  reportGenerationNotice,
} from './chatGenerationRuntime'
import type { NoticeTone } from './uiRuntime'

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

interface CommitSubmittedGenerationStartOptions {
  assistantId: string
  commitPublishedLocalSnapshot: (snapshot: AppData) => Promise<void>
  controller: AbortController
  conversationId: string
  scheduleAutoSync: (snapshot: AppData, delay?: number) => void
  setNotice: SetNotice
  snapshot: AppData
  t: Translator
  updateData: UpdateData
}

interface PersistUnexpectedAssistantFailureOptions {
  assistantId: string
  commitPublishedLocalSnapshot: (snapshot: AppData) => Promise<void>
  conversationId: string
  dataRef: MutableRef<AppData | null>
  error: unknown
  errorMessage: (error: unknown) => string
  scheduleAutoSync: (snapshot: AppData, delay?: number) => void
  setNotice: SetNotice
  stoppedContent: string
  t: Translator
  updateData: UpdateData
}

async function persistTerminalSnapshot(
  snapshot: AppData | null,
  commitPublishedLocalSnapshot: (snapshot: AppData) => Promise<void>,
  scheduleAutoSync: (snapshot: AppData, delay?: number) => void,
): Promise<boolean> {
  if (!snapshot) {
    return false
  }

  try {
    await commitPublishedLocalSnapshot(snapshot)
    scheduleAutoSync(snapshot, 0)
    return true
  } catch {
    return false
  }
}

export async function persistUnexpectedAssistantFailure({
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
}: PersistUnexpectedAssistantFailureOptions): Promise<boolean> {
  const pendingAssistant = dataRef.current?.conversations
    .find((conversation) => conversation.id === conversationId)
    ?.messages.find((message) => message.id === assistantId)

  if (!pendingAssistant || pendingAssistant.status !== 'streaming') {
    return false
  }

  let patched = false
  let saved: AppData | null

  try {
    saved = updateData(
      (current) =>
        updateConversation(current, conversationId, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) => {
            if (message.id !== assistantId || message.status !== 'streaming') {
              return message
            }

            patched = true
            return messageGenerationFailurePatch({
              assistantContent: message.content,
              error,
              errorMessage,
              message,
              stoppedContent,
            })
          }),
        })),
      { autoSync: false },
    )
  } catch {
    saved = null
  }

  if (!saved || !patched) {
    reportGenerationNotice(
      setNotice,
      () => t('notice.messageSaveUnavailable'),
      'error',
      'message',
      assistantId,
    )
    return false
  }

  try {
    await commitPublishedLocalSnapshot(saved)
  } catch {
    reportGenerationNotice(
      setNotice,
      () => t('notice.messageSaveUnavailable'),
      'error',
      'message',
      assistantId,
    )
    return false
  }

  try {
    scheduleAutoSync(saved, 0)
  } catch {
    // The local terminal commit owns correctness; the data effect can retry sync.
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    reportGenerationNotice(setNotice, () => '', undefined, 'message', assistantId)
    return true
  }

  reportGenerationNotice(
    setNotice,
    () => t('notice.messageGenerationFailed', { message: errorMessage(error) }),
    'error',
    'message',
    assistantId,
  )
  return true
}

export async function commitSubmittedGenerationStart({
  assistantId,
  commitPublishedLocalSnapshot,
  controller,
  conversationId,
  scheduleAutoSync,
  setNotice,
  snapshot,
  t,
  updateData,
}: CommitSubmittedGenerationStartOptions): Promise<boolean> {
  try {
    await commitPublishedLocalSnapshot(snapshot)
  } catch {
    const failed = updateData(
      (current) =>
        updateConversation(current, conversationId, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  error: t('notice.messageSaveUnavailable'),
                  status: 'error',
                }
              : message,
          ),
        })),
      { autoSync: false },
    )

    await persistTerminalSnapshot(
      failed,
      commitPublishedLocalSnapshot,
      scheduleAutoSync,
    )
    reportGenerationNotice(
      setNotice,
      () => t('notice.messageSaveUnavailable'),
      'error',
      'message',
      assistantId,
    )
    return false
  }

  if (!controller.signal.aborted) {
    return true
  }

  const stopped = updateData(
    (current) =>
      updateConversation(current, conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                content: t('notice.stopped'),
                error: undefined,
                status: 'done',
              }
            : message,
        ),
      })),
    { autoSync: false },
  )

  const persisted = await persistTerminalSnapshot(
    stopped,
    commitPublishedLocalSnapshot,
    scheduleAutoSync,
  )

  reportGenerationNotice(
    setNotice,
    () => persisted
      ? t('notice.stopped')
      : t('notice.messageSaveUnavailable'),
    persisted ? 'warning' : 'error',
    'message',
    assistantId,
  )
  return false
}
