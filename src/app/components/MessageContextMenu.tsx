import {
  Copy,
  Download,
  Pencil,
  RefreshCw,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { flushSync } from 'react-dom'
import type { KeyboardEvent, RefObject } from 'react'

import {
  downloadableMessageAttachment,
  messageAccessibleName,
  messageActionAccessibleName,
  messageCanSpeak,
} from '../../services/messageRendering'
import {
  runMessageContextMenuAsyncAction,
  type MessageContextMenuState,
} from '../../services/messageContextMenu'
import type { ChatMessage, MessageAttachment } from '../../types'
import { formatTime, type AppLocale } from '../i18n'
import type { AppStringKey } from '../strings'

type Translate = (key: AppStringKey) => string

interface MessageContextMenuProps {
  conversationMutationPending: boolean
  lastAssistant: boolean
  locale: AppLocale
  menu: MessageContextMenuState
  menuRef: RefObject<HTMLDivElement | null>
  message: ChatMessage
  sending: boolean
  speakingMessageId: string
  streaming: boolean
  t: Translate
  onClose: () => void
  onCloseAndRestoreFocus: () => void
  onCloseForAsyncAction: () => () => void
  onCopyMessage: (message: ChatMessage) => Promise<void>
  onDeleteMessage: (messageId: string) => Promise<boolean>
  onDownloadAttachment: (
    message: ChatMessage,
    attachment: MessageAttachment,
  ) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  onRegenerate: () => void
  onRetry: (messageId: string) => void
  onSpeakMessage: (message: ChatMessage) => Promise<void>
  onStartEditingMessage: (message: ChatMessage) => void
}

export function MessageContextMenu({
  conversationMutationPending,
  lastAssistant,
  locale,
  menu,
  menuRef,
  message,
  sending,
  speakingMessageId,
  streaming,
  t,
  onClose,
  onCloseAndRestoreFocus,
  onCloseForAsyncAction,
  onCopyMessage,
  onDeleteMessage,
  onDownloadAttachment,
  onKeyDown,
  onRegenerate,
  onRetry,
  onSpeakMessage,
  onStartEditingMessage,
}: MessageContextMenuProps) {
  const status = message.status ?? 'done'
  const ready = status !== 'streaming' && status !== 'queued'
  const downloadableAttachment = downloadableMessageAttachment(message)
  const senderLabel = message.role === 'user' ? t('message.you') : t('message.assistant')
  const messageLabel = messageAccessibleName({
    message,
    senderLabel,
    timeLabel: formatTime(message.createdAt, locale),
  })
  const actionLabel = (action: string, subject?: string) =>
    messageActionAccessibleName(action, messageLabel, subject)
  const isAssistantRegeneration = message.role === 'assistant' && status === 'done'
  const canSpeakMessage = messageCanSpeak(message)
  const speaking = speakingMessageId === message.id
  const regenerationDisabled =
    !lastAssistant || streaming || sending || !isAssistantRegeneration
  const closeBeforeAction = (restoreFocus = false) =>
    flushSync(restoreFocus ? onCloseAndRestoreFocus : onClose)
  const runAsyncAction = (action: () => Promise<unknown>) => {
    const restoreFocus = flushSync(onCloseForAsyncAction)
    void runMessageContextMenuAsyncAction(action, restoreFocus).catch(() => undefined)
  }

  return (
    <div
      ref={menuRef}
      className="zc-message-context-menu"
      data-zc-message-context-menu="true"
      role="menu"
      aria-label={messageLabel}
      onKeyDown={onKeyDown}
      style={{ left: menu.x, top: menu.y }}
    >
      <button
        type="button"
        role="menuitem"
        data-zc-message-context-copy="true"
        aria-label={actionLabel(t('message.copy'))}
        onClick={() => {
          runAsyncAction(() => onCopyMessage(message))
        }}
      >
        <Copy size={15} aria-hidden="true" />
        {t('message.copy')}
      </button>
      {(canSpeakMessage || speaking) && (
        <button
          type="button"
          role="menuitem"
          data-zc-message-context-speak="true"
          disabled={conversationMutationPending && !speaking}
          aria-label={actionLabel(
            t(speaking ? 'message.stopReading' : 'message.readAloud'),
          )}
          onClick={() => {
            runAsyncAction(() => onSpeakMessage(message))
          }}
        >
          {speaking ? (
            <VolumeX size={15} aria-hidden="true" />
          ) : (
            <Volume2 size={15} aria-hidden="true" />
          )}
          {t(speaking ? 'message.stopReading' : 'message.readAloud')}
        </button>
      )}
      {downloadableAttachment && (
        <button
          type="button"
          role="menuitem"
          data-zc-message-context-download="true"
          aria-label={actionLabel(
            t('message.downloadImage'),
            downloadableAttachment.alt?.trim() || t('message.image'),
          )}
          onClick={() => {
            closeBeforeAction(true)
            onDownloadAttachment(message, downloadableAttachment)
          }}
        >
          <Download size={15} aria-hidden="true" />
          {t('message.downloadImage')}
        </button>
      )}
      {message.role === 'user' ? (
        <button
          type="button"
          role="menuitem"
          data-zc-message-context-edit="true"
          aria-label={actionLabel(t('message.edit'))}
          disabled={!ready || sending || conversationMutationPending}
          onClick={() => {
            closeBeforeAction()
            onStartEditingMessage(message)
          }}
        >
          <Pencil size={15} aria-hidden="true" />
          {t('message.edit')}
        </button>
      ) : (
        <button
          type="button"
          role="menuitem"
          data-zc-message-context-regenerate="true"
          aria-label={actionLabel(
            status === 'error' ? t('message.retry') : t('message.regenerate'),
          )}
          disabled={
            conversationMutationPending ||
            (status === 'error'
              ? !ready || streaming || sending
              : regenerationDisabled)
          }
          onClick={() => {
            closeBeforeAction()
            if (status === 'error') onRetry(message.id)
            else onRegenerate()
          }}
        >
          <RefreshCw size={15} aria-hidden="true" />
          {status === 'error' ? t('message.retry') : t('message.regenerate')}
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        data-zc-message-context-delete="true"
        aria-label={actionLabel(t('message.delete'))}
        disabled={conversationMutationPending}
        onClick={() => {
          runAsyncAction(() => onDeleteMessage(message.id))
        }}
      >
        <Trash2 size={15} aria-hidden="true" />
        {t('message.delete')}
      </button>
    </div>
  )
}
