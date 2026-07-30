import type { NoticeTarget } from '../components/Notice'
import type { Translator } from '../i18n'
import type {
  AppData,
  ChatMessage,
  Conversation,
} from '../types'
import { updateConversation } from './appData'
import { reportDetachedNotice } from './detachedFailureReporting'
import {
  deleteMessageDangerPrompt,
  type DangerPrompt,
} from './dangerConfirmation'
import { cleanConversationTitle } from './conversations'
import { generationOwnership } from './generationOwnership'
import { writeClipboardText as defaultWriteClipboardText } from './clipboard'
import { messageCopyText as defaultMessageCopyText } from './messageRendering'
import type { NoticeTone } from './uiRuntime'

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

export interface ChatGenerationMessageActionContext {
  activeConversation: Conversation | null
  dataRef: { current: AppData | null }
  editingMessageId: string
  errorMessage: (error: unknown) => string
  requestDangerConfirmation: (prompt: DangerPrompt) => Promise<boolean>
  scheduleAutoSync: (snapshot: AppData, delay?: number) => void
  setEditingContent: (value: string) => void
  setEditingMessageId: (value: string) => void
  setNotice: SetNotice
  t: Translator
  updateData: UpdateData
}

export interface ChatGenerationMessageActionServices {
  messageCopyText: (
    message: ChatMessage,
    generatedImageLabel: string,
  ) => string
  writeClipboardText: (value: string) => Promise<void>
}

export interface ChatGenerationMessageActions {
  cancelEditingMessage: () => void
  copyMessage: (message: ChatMessage) => Promise<void>
  deleteMessage: (messageId: string) => Promise<boolean>
  startEditingMessage: (message: ChatMessage) => void
}

const defaultChatGenerationMessageActionServices: ChatGenerationMessageActionServices = {
  messageCopyText: defaultMessageCopyText,
  writeClipboardText: defaultWriteClipboardText,
}

export function reportMessageActionNotice(
  context: Pick<ChatGenerationMessageActionContext, 'setNotice'>,
  message: () => string,
  tone?: NoticeTone,
  target?: NoticeTarget,
  anchorId?: string,
): void {
  reportDetachedNotice(context.setNotice, message, tone, target, anchorId)
}

export function createChatGenerationMessageActions(
  context: ChatGenerationMessageActionContext,
  services: ChatGenerationMessageActionServices =
    defaultChatGenerationMessageActionServices,
): ChatGenerationMessageActions {
  function cancelEditingMessage(): void {
    context.setEditingMessageId('')
    context.setEditingContent('')
  }

  function startEditingMessage(message: ChatMessage): void {
    if (message.role !== 'user' || message.status === 'streaming') {
      return
    }

    context.setEditingMessageId(message.id)
    context.setEditingContent(message.content)
  }

  function reportMessageSaveUnavailable(messageId: string): void {
    reportMessageActionNotice(
      context,
      () => context.t('notice.messageSaveUnavailable'),
      'error',
      'message',
      messageId,
    )
  }

  async function copyMessage(message: ChatMessage): Promise<void> {
    try {
      await services.writeClipboardText(
        services.messageCopyText(message, context.t('message.imageGenerated')),
      )
      reportMessageActionNotice(
        context,
        () => context.t('button.copied'),
        'success',
        'message',
        message.id,
      )
    } catch {
      reportMessageActionNotice(
        context,
        () => context.t('button.copyFailed'),
        'error',
        'message',
        message.id,
      )
    }
  }

  async function deleteMessage(messageId: string): Promise<boolean> {
    const { activeConversation } = context

    if (!activeConversation || generationOwnership.active) {
      return false
    }

    const target = activeConversation.messages.find(
      (message) => message.id === messageId,
    )

    if (!target) {
      return false
    }

    reportMessageActionNotice(context, () => '')
    const kind =
      target.role === 'assistant'
        ? context.t('danger.deleteMessage.assistant')
        : context.t('danger.deleteMessage.user')
    let confirmed: boolean

    try {
      confirmed = await context.requestDangerConfirmation(
        deleteMessageDangerPrompt(context.t, kind),
      )
    } catch {
      reportMessageSaveUnavailable(messageId)
      return false
    }

    if (!confirmed) {
      return false
    }

    if (generationOwnership.active) {
      return false
    }

    const conversationId = activeConversation.id

    if (
      !context.dataRef.current?.conversations.some(
        (conversation) =>
          conversation.id === conversationId &&
          conversation.messages.some((message) => message.id === messageId),
      )
    ) {
      return false
    }

    const saved = context.updateData(
      (current) =>
        updateConversation(current, conversationId, (conversation) => {
          const currentTarget = conversation.messages.find(
            (message) => message.id === messageId,
          )
          const queuedPromptId =
            currentTarget?.role === 'assistant' &&
            currentTarget.status === 'queued'
              ? currentTarget.queuedTextRequest?.promptMessageId
              : currentTarget?.role === 'user' &&
                  conversation.messages.some(
                    (message) =>
                      message.role === 'assistant' &&
                      message.status === 'queued' &&
                      message.queuedTextRequest?.promptMessageId === messageId,
                  )
                ? messageId
                : undefined
          const messages = conversation.messages.filter(
            (message) =>
              message.id !== messageId &&
              message.id !== queuedPromptId &&
              !(
                queuedPromptId &&
                message.role === 'assistant' &&
                message.status === 'queued' &&
                message.queuedTextRequest?.promptMessageId === queuedPromptId
              ),
          )
          const firstUserMessage = messages.find(
            (message) => message.role === 'user',
          )

          return {
            ...conversation,
            title: firstUserMessage
              ? cleanConversationTitle(firstUserMessage.content, context.t)
              : context.t('conversation.newTitle'),
            messages,
          }
        }),
      { autoSync: false },
    )

    if (!saved) {
      reportMessageSaveUnavailable(messageId)
      return false
    }

    if (
      context.editingMessageId &&
      !saved.conversations.some(
        (conversation) =>
          conversation.id === conversationId &&
          conversation.messages.some(
            (message) => message.id === context.editingMessageId,
          ),
      )
    ) {
      cancelEditingMessage()
    }

    context.scheduleAutoSync(saved, 0)
    return true
  }

  return {
    cancelEditingMessage,
    copyMessage,
    deleteMessage,
    startEditingMessage,
  }
}
