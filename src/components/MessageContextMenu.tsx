import {
  Copy as CopyIcon,
  Download,
  Pencil,
  RefreshCw,
  Square,
  Trash2,
  Volume2,
} from 'lucide-react'
import type {
  KeyboardEvent,
  ReactElement,
  RefObject,
} from 'react'
import { flushSync } from 'react-dom'
import type { Translator } from '../i18n'
import type { MessageContextMenuState } from '../services/messageContextMenu'
import {
  downloadableMessageAttachment,
  messageActionAccessibleName,
  messageCanSpeak,
  messageAccessibleName,
} from '../services/messageRendering'
import type {
  ChatMessage,
  MessageAttachment,
} from '../types'
import {
  runMessageAction,
  type MessageActionResult,
} from './MessageActionBoundary'

interface MessageContextMenuProps {
  formatMessageTime: (value: number) => string
  menu: MessageContextMenuState
  menuRef: RefObject<HTMLDivElement | null>
  message: ChatMessage
  sending: boolean
  speakingMessageId: string
  t: Translator
  onClose: () => void
  onCopyMessage: (message: ChatMessage) => MessageActionResult
  onDeleteMessage: (messageId: string) => MessageActionResult
  onDownloadAttachment: (
    message: ChatMessage,
    attachment: MessageAttachment,
  ) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  onRegenerateAssistantMessage: (
    messageId: string,
  ) => MessageActionResult
  onSpeakMessage: (message: ChatMessage) => MessageActionResult
  onStartEditingMessage: (message: ChatMessage) => void
  onStopSpeakingMessage: () => void
}

export function MessageContextMenu({
  formatMessageTime,
  menu,
  menuRef,
  message,
  sending,
  speakingMessageId,
  t,
  onClose,
  onCopyMessage,
  onDeleteMessage,
  onDownloadAttachment,
  onKeyDown,
  onRegenerateAssistantMessage,
  onSpeakMessage,
  onStartEditingMessage,
  onStopSpeakingMessage,
}: MessageContextMenuProps): ReactElement {
  const downloadableAttachment = downloadableMessageAttachment(message)
  const ready = message.status !== 'streaming' && message.status !== 'queued'
  const isError = message.status === 'error'
  const canSpeakMessage = messageCanSpeak(message)
  const isSpeaking = speakingMessageId === message.id
  const senderLabel =
    message.role === 'user'
      ? t('message.role.user')
      : t('message.role.assistant')
  const messageTime = formatMessageTime(message.createdAt)
  const messageAccessibleLabel = messageAccessibleName({
    message,
    senderLabel,
    timeLabel: messageTime,
  })
  const messageContextActionLabel = (
    action: string,
    subject?: string,
  ): string =>
    messageActionAccessibleName(action, messageAccessibleLabel, subject)
  const copyMessageLabel = messageContextActionLabel(t('button.copy'))
  const speakMessageLabel = messageContextActionLabel(
    isSpeaking ? t('button.stopSpeaking') : t('button.speakMessage'),
  )
  const downloadMessageLabel = messageContextActionLabel(
    t('button.downloadImage'),
    downloadableAttachment?.alt?.trim() || t('message.imageGenerated'),
  )
  const editMessageLabel = messageContextActionLabel(t('button.editMessage'))
  const retryMessageLabel = messageContextActionLabel(
    isError ? t('button.retry') : t('button.regenerate'),
  )
  const deleteMessageLabel = messageContextActionLabel(t('button.deleteMessage'))
  const closeBeforeAction = (): void => {
    flushSync(onClose)
  }

  return (
    <div
      ref={menuRef}
      className="message-context-menu"
      data-message-context-menu="true"
      role="menu"
      aria-label={messageAccessibleLabel}
      onKeyDown={onKeyDown}
      style={{
        left: menu.x,
        top: menu.y,
      }}
    >
      <button
        type="button"
        role="menuitem"
        data-message-context-copy="true"
        aria-label={copyMessageLabel}
        onClick={() => {
          closeBeforeAction()
          runMessageAction(onCopyMessage, message)
        }}
      >
        <CopyIcon size={15} />
        {t('button.copy')}
      </button>
      {canSpeakMessage ? (
        <button
          type="button"
          role="menuitem"
          data-message-context-speak="true"
          aria-label={speakMessageLabel}
          disabled={sending && !isSpeaking}
          onClick={() => {
            closeBeforeAction()
            if (isSpeaking) {
              onStopSpeakingMessage()
            } else {
              runMessageAction(onSpeakMessage, message)
            }
          }}
        >
          {isSpeaking ? <Square size={15} /> : <Volume2 size={15} />}
          {isSpeaking ? t('button.stopSpeaking') : t('button.speakMessage')}
        </button>
      ) : null}
      {downloadableAttachment ? (
        <button
          type="button"
          role="menuitem"
          data-message-context-download="true"
          aria-label={downloadMessageLabel}
          onClick={() => {
            closeBeforeAction()
            onDownloadAttachment(message, downloadableAttachment)
          }}
        >
          <Download size={15} />
          {t('button.downloadImage')}
        </button>
      ) : null}
      {message.role === 'user' ? (
        <button
          type="button"
          role="menuitem"
          data-message-context-edit="true"
          aria-label={editMessageLabel}
          disabled={!ready || sending}
          onClick={() => {
            closeBeforeAction()
            onStartEditingMessage(message)
          }}
        >
          <Pencil size={15} />
          {t('button.editMessage')}
        </button>
      ) : (
        <button
          type="button"
          role="menuitem"
          data-message-context-regenerate="true"
          aria-label={retryMessageLabel}
          disabled={!ready || sending}
          onClick={() => {
            closeBeforeAction()
            runMessageAction(onRegenerateAssistantMessage, message.id)
          }}
        >
          <RefreshCw size={15} />
          {isError ? t('button.retry') : t('button.regenerate')}
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        data-message-context-delete="true"
        aria-label={deleteMessageLabel}
        disabled={!ready || sending}
        onClick={() => {
          closeBeforeAction()
          runMessageAction(onDeleteMessage, message.id)
        }}
      >
        <Trash2 size={15} />
        {t('button.deleteMessage')}
      </button>
    </div>
  )
}
